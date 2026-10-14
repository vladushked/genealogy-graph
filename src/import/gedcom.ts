import { ImportError, type ImportedMedia, type ImportedPerson, type ImportedTree } from './types';
import { t } from '../i18n';

/**
 * GEDCOM 5.5, 5.5.1 and 7.0 (.ged): people (`INDI`), families (`FAM`), shared notes (`NOTE`, `SNOTE`), media
 * (`OBJE`) and source titles (`SOUR`). Files from other programs add their own `_TAGS`; the common ones are read, the
 * rest of a person's facts land in the card text so nothing is silently lost.
 */

export const GEDCOM_FORMAT = { id: 'gedcom', name: 'GEDCOM (.ged)', label: 'GEDCOM', extensions: ['ged'] };

/** One line of the file with the lines nested under it. */
export interface GedNode { tag: string; xref?: string; value: string; children: GedNode[] }

export function readGedcom(bytes: Uint8Array, fileName = ''): ImportedTree {
  if (!bytes.length) throw new ImportError(t().gedcom.empty);
  const warnings: string[] = [];
  const text = decode(bytes, warnings);
  const { records, skipped } = parseLines(text);
  if (!records.some((record) => record.tag === 'HEAD') && !records.some((record) => record.tag === 'INDI')) {
    throw new ImportError(t().gedcom.notGedcom);
  }
  if (skipped) warnings.push(t().gedcom.skipped(skipped));
  return readTree(records, fileName, warnings);
}

// ── text

/**
 * Text of the file. A byte order mark decides; otherwise UTF-8 when the bytes are valid UTF-8, then the code page the
 * header names. ANSI is read as Windows-1251, the usual code page of Russian files.
 */
export function decode(bytes: Uint8Array, warnings: string[] = []): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  // UTF-16 without a mark: every other byte of "0 HEAD" is zero.
  if (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length > 3 && bytes[0] === 0 && bytes[2] === 0) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* a single-byte code page */ }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const declared = head.match(/^\s*1\s+CHAR\s+(\S+)/m)?.[1]?.toUpperCase() ?? '';
  const codePage = declared.match(/^(?:WINDOWS-?|CP-?)?(125\d|866)$/)?.[1];
  if (codePage) return new TextDecoder(codePage === '866' ? 'ibm866' : `windows-${codePage}`).decode(bytes);
  if (declared === 'ANSEL') { warnings.push(t().gedcom.ansel); return new TextDecoder('latin1').decode(bytes); }
  const guessed = ansiCodePage(bytes);
  if (declared !== 'ANSI') warnings.push(t().gedcom.codePage(declared, `Windows-${guessed}`));
  return new TextDecoder(`windows-${guessed}`).decode(bytes);
}

/**
 * The Windows code page of a single-byte file that does not name one: Cyrillic (1251) when letters above 0xC0 come
 * in runs, as Russian words do; Western European (1252) when they stand alone among ASCII letters, as accents do.
 */
export function ansiCodePage(bytes: Uint8Array): '1251' | '1252' {
  let high = 0; let paired = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0xc0) continue;
    high++;
    if ((i > 0 && bytes[i - 1] >= 0xc0) || (i + 1 < bytes.length && bytes[i + 1] >= 0xc0)) paired++;
  }
  return high && paired / high > 0.5 ? '1251' : '1252';
}

/** Lines into records; `CONT` and `CONC` lines are joined into the value they continue. */
export function parseLines(text: string): { records: GedNode[]; skipped: number } {
  const records: GedNode[] = [];
  const stack: Array<{ level: number; node: GedNode }> = [];
  let skipped = 0;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^\uFEFF/, '');
    if (!line.trim()) continue;
    const match = line.match(/^\s*(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/);
    if (!match) { skipped++; continue; }
    const level = Number(match[1]);
    const value = (match[4] ?? '').replace(/@@/g, '@');
    const tag = match[3].toUpperCase();
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (tag === 'CONT' || tag === 'CONC') {
      if (parent && parent.level === level - 1) { parent.node.value += (tag === 'CONT' ? '\n' : '') + value; continue; }
      skipped++; continue;
    }
    const node: GedNode = { tag, xref: match[2], value, children: [] };
    if (level === 0) records.push(node);
    else if (parent && parent.level === level - 1) parent.node.children.push(node);
    else { skipped++; continue; }
    stack.push({ level, node });
  }
  return { records, skipped };
}

const first = (node: GedNode | undefined, tag: string) => node?.children.find((child) => child.tag === tag);
const all = (node: GedNode | undefined, tag: string) => node?.children.filter((child) => child.tag === tag) ?? [];
const valueOf = (node: GedNode | undefined, tag: string) => first(node, tag)?.value.trim() || undefined;
const pointer = (value: string) => value.match(/^@[^@\s]+@$/)?.[0];

// ── dates

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

/** `7 MAR 1915` → `1915-03-07`, `MAR 1915` → `1915-03`, `1915` → `1915`; null when it is not a plain date. */
function exactDate(text: string): string | null {
  const match = text.trim().toUpperCase().match(/^(?:(\d{1,2})\s+)?(?:([A-Z]{3})\s+)?(\d{3,4})(?:\/\d{1,2})?$/);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = monthName ? MONTHS[monthName] : undefined;
  if (monthName && !month) return null;
  let out = year.padStart(4, '0');
  if (month) out += `-${String(month).padStart(2, '0')}`;
  if (month && day) out += `-${day.padStart(2, '0')}`;
  return out;
}

/**
 * A GEDCOM date as card text: `ABT 1915` → `1915?`, `BEF 1915` → `<1915`, `AFT 1915` → `>1915`,
 * `BET 1915 AND 1920` → `1915..1920`. Julian dates keep their numbers (Russian records before 1918 are old style);
 * other calendars and free phrases stay as written.
 */
export function gedcomDate(raw: string | undefined, warnings?: Set<string>): string | undefined {
  if (!raw?.trim()) return undefined;
  let text = raw.trim().replace(/\s+/g, ' ');
  const phrase = text.match(/\((.*)\)\s*$/)?.[1];
  text = text.replace(/\s*\(.*\)\s*$/, '').replace(/^INT\s+/i, '');
  const calendar = text.match(/@#D([A-Z ]+)@\s*/i)?.[1]?.trim().toUpperCase() ?? text.match(/^(JULIAN|GREGORIAN|HEBREW|FRENCH_R)\s+/i)?.[1]?.toUpperCase();
  text = text.replace(/@#D[A-Z ]+@\s*/gi, '').replace(/^(JULIAN|GREGORIAN|HEBREW|FRENCH_R)\s+/i, '');
  if (calendar && calendar !== 'GREGORIAN' && calendar !== 'JULIAN') { warnings?.add(t().gedcom.calendar(calendar)); return raw.trim(); }
  if (!text) return phrase?.trim() || undefined;
  const upper = text.toUpperCase();
  let match: RegExpMatchArray | null;
  if ((match = upper.match(/^(?:ABT|CAL|EST)\.?\s+(.+)$/))) { const date = exactDate(match[1]); if (date) return `${date}?`; }
  if ((match = upper.match(/^(?:BEF|TO)\.?\s+(.+)$/))) { const date = exactDate(match[1]); if (date) return `<${date}`; }
  if ((match = upper.match(/^(?:AFT|FROM)\.?\s+(.+)$/)) && !/ TO /.test(upper)) { const date = exactDate(match[1]); if (date) return `>${date}`; }
  if ((match = upper.match(/^(?:BET|FROM)\.?\s+(.+?)\s+(?:AND|TO)\s+(.+)$/))) {
    const [from, to] = [exactDate(match[1]), exactDate(match[2])];
    if (from && to) return from === to ? from : `${from}..${to}`;
  }
  return exactDate(text) ?? (phrase?.trim() || raw.trim());
}

// ── names

/** Words that end a Russian patronymic: Иванович, Ильич, Петровна, Кузьминична. */
const PATRONYMIC = /(?:вич|ьич|ич|вна|чна|ична)$/i;

interface Name { surname?: string; given?: string; patronymic?: string; full: string; type: string }

function readName(node: GedNode): Name {
  const value = node.value.trim();
  const slashed = value.match(/\/([^/]*)\/?/)?.[1]?.trim();
  const outside = value.replace(/\/[^/]*\/?/, ' ').replace(/\s+/g, ' ').trim();
  let given = valueOf(node, 'GIVN') ?? (outside || undefined);
  const surname = valueOf(node, 'SURN') ?? (slashed || undefined);
  let patronymic = valueOf(node, '_PATR') ?? valueOf(node, '_PATRONYMIC') ?? valueOf(node, '_MIDN');
  // Russian files usually write the patronymic as the last given name.
  const words = given?.split(' ') ?? [];
  if (!patronymic && words.length >= 2 && PATRONYMIC.test(words[words.length - 1])) { patronymic = words.pop(); given = words.join(' '); }
  if (patronymic && given?.endsWith(` ${patronymic}`)) given = given.slice(0, -patronymic.length - 1);
  const full = [surname, given, patronymic].filter(Boolean).join(' ') || value.replace(/\//g, '').trim();
  return { surname, given, patronymic, full, type: (valueOf(node, 'TYPE') ?? '').toLowerCase() };
}

// ── tree

const MILITARY = /^_?(?:MILT|MILI|MIL|MILITARY|MILITARY_SERVICE|SERVICE)$/;

function readTree(records: GedNode[], fileName: string, warnings: string[]): ImportedTree {
  const words = t().gedcom;
  const byXref = new Map<string, GedNode>();
  for (const record of records) if (record.xref) byXref.set(record.xref, record);
  const head = records.find((record) => record.tag === 'HEAD');
  const sourceId = [valueOf(head, 'SOUR') ?? 'gedcom', valueOf(head, 'FILE') ?? fileName].filter(Boolean).join(':');
  const dateWarnings = new Set<string>();
  const date = (node: GedNode | undefined) => gedcomDate(valueOf(node, 'DATE'), dateWarnings);
  const place = (node: GedNode | undefined) => valueOf(node, 'PLAC') ?? (valueOf(node, 'ADDR')?.replace(/\n/g, ', '));

  /** Text of NOTE / SNOTE lines under a node, resolving shared notes. */
  const notesOf = (node: GedNode | undefined) => [...all(node, 'NOTE'), ...all(node, 'SNOTE')].map((note) => {
    const target = pointer(note.value);
    return (target ? byXref.get(target)?.value ?? '' : note.value).trim();
  }).filter(Boolean);
  /** Source citations under a node: «title, page». */
  const citationsOf = (node: GedNode | undefined) => all(node, 'SOUR').map((sour) => {
    const target = pointer(sour.value);
    const record = target ? byXref.get(target) : undefined;
    const title = record ? valueOf(record, 'TITL') ?? valueOf(record, 'ABBR') ?? record.value.trim() : sour.value.trim();
    return [title, valueOf(sour, 'PAGE')].filter(Boolean).join(', ');
  }).filter(Boolean);

  // Media records and inline media; the key of an inline object is made from its owner.
  const media: ImportedMedia[] = [];
  const mediaKeys = new Set<string>();
  const addMedia = (key: string, node: GedNode) => {
    if (mediaKeys.has(key)) return true;
    const file = first(node, 'FILE');
    const path = file?.value.trim();
    if (!path) return false;
    media.push({ key, path, title: valueOf(file, 'TITL') ?? valueOf(node, 'TITL') });
    mediaKeys.add(key);
    return true;
  };
  for (const record of records) if (record.tag === 'OBJE' && record.xref) addMedia(record.xref, record);
  const isImage = (key: string) => /\.(jpe?g|png|gif|bmp|webp|tiff?|heic)$/i.test(media.find((item) => item.key === key)?.path ?? '');

  const people: ImportedPerson[] = [];
  const byKey = new Map<string, ImportedPerson>();
  const keyOf = new Map<string, string>();
  const famc: Array<{ child: string; family: string; adopted: boolean }> = [];
  const godparents: ImportedTree['godparents'] = [];
  const godparentLinks: Array<{ child: string; target: string }> = [];
  for (const record of records) {
    if (record.tag !== 'INDI' || !record.xref) continue;
    const key = record.xref.replace(/@/g, '');
    keyOf.set(record.xref, key);
    const names = all(record, 'NAME').map(readName);
    const main = names.find((name) => !name.type || name.type === 'birth' || name.type === 'maiden') ?? names[0];
    const married = names.find((name) => name !== main && name.type === 'married')?.surname ?? valueOf(first(record, 'NAME'), '_MARNM');
    const birthName = names.find((name) => name !== main && (name.type === 'birth' || name.type === 'maiden'))?.surname;
    const sexValue = valueOf(record, 'SEX')?.toUpperCase();
    const person: ImportedPerson = {
      key,
      // A married name is the one in use; the main name then is the surname at birth.
      surname: married ?? main?.surname, givenName: main?.given, patronymic: main?.patronymic,
      birthSurname: married && main?.surname !== married ? main?.surname : birthName,
      nameVariants: names.filter((name) => name !== main && name.full !== main?.full).map((name) => name.full),
      sex: sexValue === 'M' ? 'male' : sexValue === 'F' ? 'female' : 'unknown',
      lifeStatus: 'unknown', occupations: [], education: [], military: [], residences: [], citations: citationsOf(record),
      notes: notesOf(record), media: [],
    };
    const fact = (node: GedNode, label?: string) => {
      const what = [label, node.value.trim() || undefined, valueOf(node, 'TYPE') && node.tag !== 'EVEN' && node.tag !== 'FACT' ? valueOf(node, 'TYPE') : undefined].filter(Boolean);
      return [what.join(': '), date(node), place(node)].filter(Boolean).join(', ');
    };
    const withNotes = (node: GedNode, label: string) => {
      for (const note of notesOf(node)) person.notes.push(`${label}: ${note}`);
      for (const citation of citationsOf(node)) if (!person.citations.includes(citation)) person.citations.push(citation);
    };
    let birthSeen = false; let deathSeen = false;
    for (const node of record.children) {
      switch (node.tag) {
        case 'BIRT':
          if (birthSeen) { person.notes.push(`${words.otherBirth}: ${fact(node)}`); break; }
          birthSeen = true; person.birthDate = date(node); person.birthPlace = place(node); withNotes(node, words.birth);
          break;
        case 'CHR': case 'BAPM':
          if (person.baptismDate || person.baptismPlace) { person.notes.push(`${words.baptism}: ${fact(node)}`); break; }
          person.baptismDate = date(node); person.baptismPlace = place(node); withNotes(node, words.baptism);
          for (const asso of all(node, 'ASSO')) godparentLinks.push({ child: key, target: asso.value.trim() });
          break;
        case 'DEAT':
          person.lifeStatus = 'deceased';
          if (deathSeen) { person.notes.push(`${words.otherDeath}: ${fact(node)}`); break; }
          deathSeen = true; person.deathDate = date(node) ?? '?'; person.deathPlace = place(node);
          person.causeOfDeath = valueOf(node, 'CAUS'); withNotes(node, words.death);
          break;
        case 'BURI':
          person.lifeStatus = 'deceased';
          if (person.burialDate || person.burialPlace) { person.notes.push(`${words.burial}: ${fact(node)}`); break; }
          person.burialDate = date(node); person.burialPlace = place(node); withNotes(node, words.burial);
          break;
        case 'CREM':
          person.lifeStatus = 'deceased'; person.notes.push(fact(node, words.labels.CREM));
          break;
        case 'OCCU': { const text = fact(node); if (text) person.occupations.push(text); break; }
        case 'EDUC': { const text = fact(node); if (text) person.education.push(text); break; }
        case 'RESI': case 'CENS': {
          const text = [date(node), place(node) ?? (node.value.trim() || undefined)].filter(Boolean).join(', ');
          if (text) person.residences.push(text); withNotes(node, words.residence);
          break;
        }
        case 'RELI': person.religion ??= node.value.trim() || valueOf(node, 'TYPE'); break;
        case 'NATI': person.nationality ??= node.value.trim() || undefined; break;
        case 'CAST': person.socialStatus ??= node.value.trim() || undefined; break;
        case 'FAMC': {
          const pedigree = (valueOf(node, 'PEDI') ?? '').toLowerCase();
          if (pointer(node.value)) famc.push({ child: key, family: node.value.trim(), adopted: pedigree === 'adopted' || pedigree === 'foster' });
          break;
        }
        case 'ADOP': {
          const family = first(node, 'FAMC');
          if (family && pointer(family.value)) famc.push({ child: key, family: family.value.trim(), adopted: true });
          person.notes.push(fact(node, words.labels.ADOP));
          break;
        }
        case 'ASSO': {
          const relation = `${valueOf(node, 'RELA') ?? ''} ${valueOf(node, 'ROLE') ?? ''} ${valueOf(first(node, 'ROLE'), 'PHRASE') ?? ''}`.toLowerCase();
          if (/god|крест|восприем/.test(relation)) godparentLinks.push({ child: key, target: node.value.trim() });
          else if (pointer(node.value)) person.notes.push(`${words.link(relation.trim())}: ${node.value.trim()}`);
          break;
        }
        case 'OBJE': {
          const target = pointer(node.value);
          const mediaKey = target ?? `${key}-${person.media.length + 1}`;
          if (target ? mediaKeys.has(target) : addMedia(mediaKey, node)) {
            const primary = (valueOf(node, '_PRIM') ?? '').toUpperCase().startsWith('Y');
            if (primary) person.media.unshift(mediaKey); else person.media.push(mediaKey);
          }
          break;
        }
        case 'NAME': case 'SEX': case 'NOTE': case 'SNOTE': case 'SOUR': case 'FAMS': case 'CHAN': case 'CREA': case 'RIN': case 'UID': case '_UID':
        case 'REFN': case 'RFN': case 'AFN': case 'SUBM': case 'RESN': case 'EXID':
          break;
        default: {
          if (MILITARY.test(node.tag) || ((node.tag === 'EVEN' || node.tag === 'FACT') && /milit|воен|арми|служб/i.test(valueOf(node, 'TYPE') ?? ''))) {
            const text = fact(node); if (text) person.military.push(text);
            break;
          }
          // Other programs' own tags are bookkeeping unless they look like an event.
          if (node.tag.startsWith('_') && !['DATE', 'PLAC', 'NOTE'].some((tag) => first(node, tag))) break;
          const label = node.tag === 'EVEN' || node.tag === 'FACT' ? valueOf(node, 'TYPE') ?? words.labels[node.tag] : words.labels[node.tag] ?? node.tag.replace(/^_/, '');
          const text = fact(node, label);
          if (text && (node.value.trim() || node.children.length)) person.notes.push(text);
          withNotes(node, label ?? node.tag);
        }
      }
    }
    // The portrait is the first picture.
    const portrait = person.media.findIndex(isImage);
    if (portrait > 0) person.media.unshift(...person.media.splice(portrait, 1));
    people.push(person); byKey.set(key, person);
  }

  // Families: parents of each child, couples, marriages and divorces.
  const parents: ImportedTree['parents'] = [];
  const parentSeen = new Map<string, ImportedTree['parents'][number]>();
  const addParent = (child: string, parent: string, adoptive: boolean) => {
    const id = `${child}|${parent}`;
    const known = parentSeen.get(id);
    // A birth link declared anywhere wins over the same link declared as an adoption.
    if (known) { if (!adoptive) delete known.adoptive; return; }
    const entry = { child, parent, ...(adoptive ? { adoptive: true } : {}) };
    parentSeen.set(id, entry); parents.push(entry);
  };
  const spouses: ImportedTree['spouses'] = [];
  const couples = new Map<string, ImportedTree['spouses'][number]>();
  let missing = 0;
  const families = new Map<string, { parents: string[]; children: Array<{ key: string; father?: string; mother?: string }> }>();
  for (const record of records) {
    if (record.tag !== 'FAM' || !record.xref) continue;
    const member = (node: GedNode) => { const key = keyOf.get(node.value.trim()); if (!key) missing++; return key; };
    const husband = all(record, 'HUSB').map(member).find(Boolean);
    const wife = all(record, 'WIFE').map(member).find(Boolean);
    const children = all(record, 'CHIL').flatMap((node) => {
      const key = member(node);
      return key ? [{ key, father: valueOf(node, '_FREL')?.toLowerCase(), mother: valueOf(node, '_MREL')?.toLowerCase() }] : [];
    });
    families.set(record.xref, { parents: [husband, wife].filter((key): key is string => Boolean(key)), children });
    for (const child of children) {
      const fromFamc = famc.find((entry) => entry.child === child.key && entry.family === record.xref);
      const adopted = (relation?: string) => fromFamc?.adopted || relation === 'adopted' || relation === 'foster';
      if (husband) addParent(child.key, husband, adopted(child.father));
      if (wife) addParent(child.key, wife, adopted(child.mother));
    }
    if (husband && wife) {
      const [a, b] = [husband, wife].sort();
      let pair = couples.get(`${a}|${b}`);
      if (!pair) { pair = { a, b }; couples.set(`${a}|${b}`, pair); spouses.push(pair); }
      const marriage = first(record, 'MARR');
      if (marriage) { pair.marriageDate ??= date(marriage); pair.marriagePlace ??= place(marriage); }
      const divorce = first(record, 'DIV');
      if (divorce && (divorce.value.trim().toUpperCase() !== 'N')) { pair.divorced = true; pair.divorceDate ??= date(divorce); }
      for (const note of notesOf(record)) for (const key of [husband, wife]) byKey.get(key)?.notes.push(`${words.family}: ${note}`);
    }
  }
  // A child that points to a family the family itself does not list.
  for (const entry of famc) {
    const family = families.get(entry.family);
    if (!family) { missing++; continue; }
    if (!family.children.some((child) => child.key === entry.child)) for (const parent of family.parents) addParent(entry.child, parent, entry.adopted);
  }
  for (const link of godparentLinks) {
    const godparent = keyOf.get(link.target);
    if (godparent && godparent !== link.child && !godparents.some((item) => item.child === link.child && item.godparent === godparent)) godparents.push({ child: link.child, godparent });
  }

  if (missing) warnings.push(words.missingRefs(missing));
  const unnamed = people.filter((person) => !person.surname && !person.givenName).length;
  if (unnamed) warnings.push(words.unnamed(unnamed));
  warnings.push(...dateWarnings);
  for (const person of people) if (person.occupations.length > 1) person.occupations = [...new Set(person.occupations)];
  return { format: GEDCOM_FORMAT.id, sourceId, people, parents, spouses, godparents, media, warnings };
}
