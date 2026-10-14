import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { t } from '../i18n';
import { ImportError, type ImportedMedia, type ImportedPerson, type ImportedTree } from './types';

/**
 * «Древо Жизни 5» (.at5): an SQLite database. Values live in typed tables keyed by field id and record
 * (`ValuesStr`, `ValuesDates`, `ValuesLinks`), events link people through roles (`EventDetails`, `EventRoles`).
 * Field and role codes below were read from real archives; event types are found by their GEDCOM tags.
 */

const TABLE = { document: 4, event: 7, person: 13, place: 14 } as const;
const FIELD = {
  documentTitle: 9, eventDate: 29, eventPlace: 28,
  surname: 64, otherSurname: 65, givenName: 66, patronymic: 67, comment: 89, occupation: 73,
  residence: 63, portrait: 68, placeName: 93,
} as const;
const REQUIRED_TABLES = ['Persons', 'Events', 'EventDetails', 'EventRoles', 'EventTypes', 'ValuesStr', 'ValuesDates', 'ValuesLinks', 'Documents', '__Recs', 'Global'];
const SQLITE_HEADER = 'SQLite format 3\u0000';

export const AT5_FORMAT = { id: 'drevo-zhizni', name: '«Древо Жизни» (.at5)', label: '«Древо Жизни»', extensions: ['at5'] };

export function readAt5(bytes: Uint8Array, SQL: SqlJsStatic): ImportedTree {
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  if (!bytes.length) throw new ImportError(t().gedcom.empty);
  if (header !== SQLITE_HEADER) {
    const empty = bytes.every((byte) => byte === 0);
    throw new ImportError(empty
      ? t().at5.zeros
      : t().at5.notSqlite);
  }
  let db: Database;
  try { db = new SQL.Database(bytes); } catch { throw new ImportError(t().at5.cannotOpen); }
  try {
    const check = db.exec('PRAGMA quick_check')[0]?.values[0]?.[0];
    if (check !== 'ok') throw new ImportError(t().at5.damaged(String(check ?? t().at5.noAnswer)));
    const tables = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name)));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length) throw new ImportError(t().at5.tables(missing.join(', ')));
    return readTree(db);
  } finally {
    db.close();
  }
}

type Row = Record<string, SqlValue>;
function rows(db: Database, sql: string, params: SqlValue[] = []): Row[] {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const out: Row[] = [];
    while (statement.step()) out.push(statement.getAsObject());
    return out;
  } finally { statement.free(); }
}

const decoder = new TextDecoder('utf-8');
const clean = (value: unknown) => {
  const text = typeof value === 'string' ? value : value instanceof Uint8Array ? decoder.decode(value) : '';
  return text.replace(/\r\n?/g, '\n').trim() || undefined;
};

function readTree(db: Database): ImportedTree {
  const warnings: string[] = [];
  // 64-bit identifiers are read as text: as JavaScript numbers they would lose digits.
  const sourceId = String(rows(db, 'SELECT CAST(guid AS TEXT) AS guid FROM Global LIMIT 1')[0]?.guid ?? 'unknown');

  // Strings: the long comment may be cut in `vstr`, the full text sits in `vblob`.
  const strings = new Map<string, string>();
  for (const row of rows(db, 'SELECT f_id, rec_id, rec_table, vstr, vblob FROM ValuesStr')) {
    const text = clean(row.vblob) ?? clean(row.vstr);
    if (text) strings.set(`${String(row.rec_table)}:${String(row.rec_id)}:${String(row.f_id)}`, text);
  }
  const str = (table: number, id: SqlValue, field: number) => strings.get(`${table}:${String(id)}:${field}`);
  const links = new Map<string, number[]>();
  for (const row of rows(db, 'SELECT f_id, rec_id, rec_table, vlink_id FROM ValuesLinks')) {
    const key = `${String(row.rec_table)}:${String(row.rec_id)}:${String(row.f_id)}`;
    links.set(key, [...(links.get(key) ?? []), Number(row.vlink_id)]);
  }
  const link = (table: number, id: SqlValue, field: number) => links.get(`${table}:${String(id)}:${field}`)?.[0];
  const placeName = (id: number | undefined) => id === undefined ? undefined : str(TABLE.place, id, FIELD.placeName);
  const dates = new Map<number, string>();
  for (const row of rows(db, `SELECT rec_id, d, m, y, y2, type FROM ValuesDates WHERE rec_table = ${TABLE.event} AND f_id = ${FIELD.eventDate}`)) {
    const text = dateText(row);
    if (text) dates.set(Number(row.rec_id), text);
  }

  // Events by GEDCOM tag; roles of their participants.
  const types = new Map(rows(db, 'SELECT id, gedname FROM EventTypes').map((row) => [Number(row.id), String(row.gedname ?? '')]));
  const events = new Map(rows(db, 'SELECT id, et_id, alive FROM Events').map((row) => [Number(row.id), { tag: types.get(Number(row.et_id)) ?? '', alive: row.alive }]));
  // Within an event type, roles are ordered: the main person (child, adoptee) first, then the others.
  const roleOrder = new Map(rows(db, 'SELECT id, et_id, ord, ismain FROM EventRoles ORDER BY et_id, ord, id').map((row) => [Number(row.id), { main: Number(row.ismain) === 1 }]));
  const participants = new Map<number, Array<{ person: number; role: number; main: boolean }>>();
  for (const row of rows(db, 'SELECT e_id, p_id, er_id FROM EventDetails')) {
    const event = Number(row.e_id);
    participants.set(event, [...(participants.get(event) ?? []), { person: Number(row.p_id), role: Number(row.er_id), main: roleOrder.get(Number(row.er_id))?.main ?? false }]);
  }

  const guid = new Map(rows(db, `SELECT rec_id, CAST(rec_guid AS TEXT) AS rec_guid FROM __Recs WHERE rec_table = ${TABLE.person}`).map((row) => [Number(row.rec_id), String(row.rec_guid)]));
  const keyOf = (id: number) => guid.get(id) ?? `id${id}`;
  const sexOf = new Map<number, ImportedPerson['sex']>();
  const people: ImportedPerson[] = [];
  const byId = new Map<number, ImportedPerson>();
  for (const row of rows(db, 'SELECT id, sex, birth_id, death_id FROM Persons ORDER BY id')) {
    const id = Number(row.id);
    const sex = row.sex === 1 ? 'male' : row.sex === 2 ? 'female' : 'unknown';
    sexOf.set(id, sex);
    const birth = row.birth_id === null ? undefined : Number(row.birth_id);
    const death = row.death_id === null ? undefined : Number(row.death_id);
    const alive = birth !== undefined ? events.get(birth)?.alive : null;
    const notes: string[] = [];
    const residence = placeName(link(TABLE.person, id, FIELD.residence));
    const comment = str(TABLE.person, id, FIELD.comment);
    if (comment) notes.push(comment);
    const person: ImportedPerson = {
      key: keyOf(id), sex,
      surname: str(TABLE.person, id, FIELD.surname), givenName: str(TABLE.person, id, FIELD.givenName),
      patronymic: str(TABLE.person, id, FIELD.patronymic), birthSurname: str(TABLE.person, id, FIELD.otherSurname), nameVariants: [],
      occupations: [str(TABLE.person, id, FIELD.occupation)].filter((value): value is string => Boolean(value)),
      education: [], military: [], residences: residence ? [residence] : [], citations: [],
      birthDate: birth !== undefined ? dates.get(birth) : undefined,
      birthPlace: birth !== undefined ? placeName(link(TABLE.event, birth, FIELD.eventPlace)) : undefined,
      // A death event without a date still says the person died.
      deathDate: death !== undefined ? dates.get(death) ?? '?' : undefined,
      deathPlace: death !== undefined ? placeName(link(TABLE.event, death, FIELD.eventPlace)) : undefined,
      lifeStatus: death !== undefined || alive === 0 ? 'deceased' : alive === 1 ? 'living' : 'unknown',
      notes, media: [],
    };
    people.push(person); byId.set(id, person);
  }

  const parents: ImportedTree['parents'] = [];
  const spouses: ImportedTree['spouses'] = [];
  const couple = new Map<string, ImportedTree['spouses'][number]>();
  const eventDate = (id: number) => dates.get(id);
  const eventPlace = (id: number) => placeName(link(TABLE.event, id, FIELD.eventPlace));
  for (const [eventId, list] of participants) {
    const tag = events.get(eventId)?.tag;
    const known = list.filter((entry) => byId.has(entry.person));
    if (tag === 'BAPM' || tag === 'CHR' || tag === 'BURI') {
      for (const entry of known.filter((item) => item.main)) {
        const person = byId.get(entry.person)!;
        if (tag === 'BURI') { person.burialDate ??= eventDate(eventId); person.burialPlace ??= eventPlace(eventId); }
        else { person.baptismDate ??= eventDate(eventId); person.baptismPlace ??= eventPlace(eventId); }
      }
    } else if (tag === 'BIRT' || tag === 'ADOP') {
      const children = known.filter((entry) => entry.main);
      for (const child of children) for (const parent of known.filter((entry) => !entry.main)) {
        parents.push({ child: keyOf(child.person), parent: keyOf(parent.person), ...(tag === 'ADOP' ? { adoptive: true } : {}) });
      }
    } else if (tag === 'MARR' || tag === 'DIV') {
      if (known.length !== 2) { if (known.length) warnings.push(t().at5.skipped(tag === 'MARR', known.length)); continue; }
      const [a, b] = known.map((entry) => keyOf(entry.person)).sort();
      const pair = couple.get(`${a}|${b}`) ?? { a, b };
      if (tag === 'DIV') { pair.divorced = true; pair.divorceDate ??= eventDate(eventId); }
      else { pair.marriageDate ??= eventDate(eventId); pair.marriagePlace ??= eventPlace(eventId); }
      if (!couple.has(`${a}|${b}`)) { couple.set(`${a}|${b}`, pair); spouses.push(pair); }
    }
  }

  // Media: the portrait (a person field) first, then the person's other documents in their order.
  const media: ImportedMedia[] = [];
  const documents = new Map(rows(db, 'SELECT id, path FROM Documents').map((row) => [Number(row.id), String(row.path ?? '')]));
  const mediaKey = (id: number) => `doc${id}`;
  for (const [id, path] of documents) {
    if (path) media.push({ key: mediaKey(id), path, title: str(TABLE.document, id, FIELD.documentTitle) });
  }
  const withMedia = new Set(media.map((item) => item.key));
  for (const [id, person] of byId) {
    const portrait = link(TABLE.person, id, FIELD.portrait);
    if (portrait !== undefined && withMedia.has(mediaKey(portrait))) person.media.push(mediaKey(portrait));
  }
  if (rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'DocumentDetails'").length) {
    for (const row of rows(db, `SELECT d_id, rec_id FROM DocumentDetails WHERE rec_table = ${TABLE.person} ORDER BY rec_id, r_ord, d_ord`)) {
      const person = byId.get(Number(row.rec_id)); const key = mediaKey(Number(row.d_id));
      if (person && withMedia.has(key) && !person.media.includes(key)) person.media.push(key);
    }
  }
  return { format: AT5_FORMAT.id, sourceId, people, parents, spouses, godparents: [], media, warnings };
}

/** `ValuesDates` row → `1915-03-07`, `1915-03`, `1915`; a range or a non-exact date type is marked approximate. */
function dateText(row: Row): string | undefined {
  const y = Number(row.y) || 0;
  if (!y) return undefined;
  const m = Number(row.m) || 0; const d = Number(row.d) || 0;
  let text = String(y).padStart(4, '0');
  if (m) text += `-${String(m).padStart(2, '0')}`;
  if (m && d) text += `-${String(d).padStart(2, '0')}`;
  const approximate = Number(row.type) !== 0 || (Number(row.y2) || 0) > 0;
  return approximate ? `${String(y).padStart(4, '0')}?` : text;
}
