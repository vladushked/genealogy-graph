import { valueText, type PersonFields } from '../schema';
import { cardBase as sharedCardBase, DEFAULT_FILE_NAME, fileSafe, type Naming } from '../edit';
import { dateYear } from '../dates';
import { t } from '../i18n';
import { familyName, personTitle, type NameScheme } from '../names';

export { familyName };
import type { ImportedPerson, ImportedTree } from './types';

/**
 * What an import will do, computed without touching the vault: which cards are created or completed, where they go,
 * which people are ambiguous, and where the source contradicts itself. Shared by all import formats.
 */

/** A person card already in the vault, in canonical fields (see schema.readFields). */
export interface ExistingCard { path: string; fields: PersonFields }

export interface PlanOptions {
  folderMode: 'family' | 'single';
  /** Target folder in `single` mode (and the root of family folders, empty = vault root). */
  folder: string;
  /** Vault folder for media files. */
  filesFolder: string;
  /** Name of the source file, recorded in `sources`. */
  sourceName: string;
  /** Program or format the file comes from, as shown in `sources`: «Древо Жизни», GEDCOM. */
  sourceLabel: string;
  /** Manual decisions for ambiguous people: existing card path, or null to create a new card. */
  decisions?: Record<string, string | null>;
  /** Paths of all files in the vault, to keep new names unique. */
  existingPaths: Set<string>;
  /** Name scheme and file name template of the cards; the Russian scheme and `{name} {born}-{died}` by default. */
  naming?: Naming;
}

export interface PlannedCard {
  key: string;
  action: 'create' | 'update';
  path: string;
  /** Fields of a new card, or only the fields an existing card lacks. */
  fields: PersonFields;
  /** Text of a new card (empty for updates: their text is left alone). */
  body: string;
  /** Values the source gives differently from an existing card; nothing is overwritten. */
  conflicts: Array<{ field: string; existing: unknown; imported: unknown }>;
}

export interface PlannedMedia { key: string; source: string; target: string }

export interface ImportPlan {
  cards: PlannedCard[];
  media: PlannedMedia[];
  /** People whose card could be one of several existing ones (or a namesake); decided by the user. */
  ambiguous: Array<{ key: string; name: string; candidates: string[] }>;
  /** Groups of people with the same full name. */
  namesakes: string[][];
  counts: { create: number; update: number; unchanged: number };
}

export const sourceRecord = (tree: ImportedTree, key: string) => `${tree.format}:${tree.sourceId}:${key}`;

const normalize = (value: string | undefined) => (value ?? '').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
const year = (date: unknown) => dateYear(date);

export function displayName(person: ImportedPerson, scheme: NameScheme = 'russian'): string {
  return personTitle({ surname: person.surname, given_name: person.givenName, patronymic: person.patronymic, birth_surname: person.birthSurname }, scheme);
}

function cardBase(person: ImportedPerson, naming: Naming): string {
  return sharedCardBase({ surname: person.surname, given_name: person.givenName, patronymic: person.patronymic, birth_surname: person.birthSurname,
    birth_date: person.birthDate, death_date: person.deathDate }, person.lifeStatus, naming);
}

export function planImport(tree: ImportedTree, existing: ExistingCard[], options: PlanOptions): ImportPlan {
  const naming = options.naming ?? { scheme: 'russian', template: DEFAULT_FILE_NAME };
  const words = t().plan;
  const byKey = new Map(tree.people.map((person) => [person.key, person]));

  // ── matching existing cards
  const bySource = new Map<string, ExistingCard>();
  const byName = new Map<string, ExistingCard[]>();
  for (const card of existing) {
    if (typeof card.fields.source_record === 'string') bySource.set(card.fields.source_record, card);
    for (const surname of [card.fields.surname, card.fields.birth_surname]) {
      if (typeof surname !== 'string' || !surname.trim()) continue;
      const key = [surname, card.fields.given_name, card.fields.patronymic].map((part) => normalize(typeof part === 'string' ? part : '')).join('|');
      byName.set(key, [...(byName.get(key) ?? []), card]);
    }
  }
  const matched = new Map<string, ExistingCard>();
  const ambiguous: ImportPlan['ambiguous'] = [];
  const claimed = new Set<string>();
  for (const person of tree.people) {
    const exact = bySource.get(sourceRecord(tree, person.key));
    if (exact) { matched.set(person.key, exact); claimed.add(exact.path); continue; }
    const decided = options.decisions?.[person.key];
    if (decided !== undefined) {
      const card = decided ? existing.find((item) => item.path === decided) : undefined;
      if (card) { matched.set(person.key, card); claimed.add(card.path); }
      continue;
    }
    const names = [person.surname, person.birthSurname].filter((surname): surname is string => Boolean(surname))
      .map((surname) => [surname, person.givenName, person.patronymic].map(normalize).join('|'));
    const born = year(person.birthDate);
    // A card whose birth year is known and different is someone else.
    const candidates = [...new Set(names.flatMap((name) => byName.get(name) ?? []))]
      .filter((card) => !claimed.has(card.path) && (born === null || year(card.fields.birth_date) === null || year(card.fields.birth_date) === born));
    if (!candidates.length || !person.givenName) continue;
    // The same name and the same birth year on both sides is a match; anything less certain is the user's call.
    const sure = candidates.filter((card) => born !== null && year(card.fields.birth_date) === born);
    if (sure.length === 1) { matched.set(person.key, sure[0]); claimed.add(sure[0].path); }
    else ambiguous.push({ key: person.key, name: displayName(person, naming.scheme), candidates: candidates.map((card) => card.path) });
  }

  // ── folders
  const folderOf = new Map<string, string>();
  const root = options.folder.replace(/^\/+|\/+$/g, '');
  const join = (...parts: string[]) => parts.filter(Boolean).join('/');
  if (options.folderMode === 'single') {
    for (const person of tree.people) folderOf.set(person.key, root);
  } else {
    // A person's line: women by birth surname, everyone else by surname; every surname has its own folder.
    const line = (person: ImportedPerson) => {
      const surname = person.sex === 'female' ? person.birthSurname ?? person.surname : person.surname ?? person.birthSurname;
      return surname ? familyName(surname, naming.scheme) : null;
    };
    const parentsOf = new Map<string, string[]>();
    for (const { child, parent } of tree.parents) parentsOf.set(child, [...(parentsOf.get(child) ?? []), parent]);
    const spousesOf = new Map<string, string[]>();
    for (const { a, b } of tree.spouses) { spousesOf.set(a, [...(spousesOf.get(a) ?? []), b]); spousesOf.set(b, [...(spousesOf.get(b) ?? []), a]); }
    const resolveLine = (key: string, seen: Set<string>): string | null => {
      if (seen.has(key)) return null;
      seen.add(key);
      const person = byKey.get(key)!;
      const own = line(person);
      if (own) return own;
      // People without a surname join their father's line, then mother's, then husband's.
      const parents = (parentsOf.get(key) ?? []).map((parent) => byKey.get(parent)!).filter(Boolean)
        .sort((a, b) => (a.sex === 'male' ? 0 : 1) - (b.sex === 'male' ? 0 : 1));
      for (const parent of parents) { const found = resolveLine(parent.key, seen); if (found) return found; }
      for (const spouse of spousesOf.get(key) ?? []) { const found = resolveLine(spouse, seen); if (found) return found; }
      return null;
    };
    for (const person of tree.people) folderOf.set(person.key, join(root, resolveLine(person.key, new Set()) ?? words.noSurname));
  }

  // ── names: unique within the vault, so plain [[links]] resolve to exactly one card
  const taken = new Set([...options.existingPaths].map((path) => path.replace(/\.md$/, '').split('/').pop()!.toLocaleLowerCase('ru')));
  const baseOf = new Map<string, string>();
  const groups = new Map<string, ImportedPerson[]>();
  for (const person of tree.people) {
    if (matched.has(person.key)) { baseOf.set(person.key, matched.get(person.key)!.path.replace(/\.md$/, '').split('/').pop()!); continue; }
    const base = cardBase(person, naming);
    groups.set(base.toLocaleLowerCase('ru'), [...(groups.get(base.toLocaleLowerCase('ru')) ?? []), person]);
  }
  for (const [lower, people] of groups) {
    people.forEach((person, index) => {
      let base = cardBase(person, naming);
      if (people.length > 1 || taken.has(lower)) {
        const place = person.birthPlace ? ` ${fileSafe(person.birthPlace)}` : '';
        base = place && !taken.has(`${base}${place}`.toLocaleLowerCase('ru')) && people.filter((other) => other.birthPlace === person.birthPlace).length === 1 ? `${base}${place}` : base;
        for (let n = index + 2; taken.has(base.toLocaleLowerCase('ru')); n++) base = `${cardBase(person, naming)} (${n})`;
      }
      taken.add(base.toLocaleLowerCase('ru'));
      baseOf.set(person.key, base);
    });
  }
  const namesakes = [...groups.values()].filter((people) => people.length > 1).map((people) => people.map((person) => person.key));

  // ── media
  const mediaByKey = new Map(tree.media.map((item) => [item.key, item]));
  const usedMedia = [...new Set(tree.people.flatMap((person) => person.media))].filter((key) => mediaByKey.has(key));
  const media: PlannedMedia[] = usedMedia.map((key) => ({ key, source: mediaByKey.get(key)!.path, target: join(options.filesFolder, fileSafe(mediaByKey.get(key)!.path.split(/[\\/]/).pop()!)) }));
  const mediaTarget = new Map(media.map((item) => [item.key, item.target]));

  // ── cards
  const linkTo = (key: string) => `[[${baseOf.get(key)}]]`;
  const relations = (key: string) => ({
    parents: tree.parents.filter((entry) => entry.child === key && !entry.adoptive).map((entry) => linkTo(entry.parent)),
    adoptive_parents: tree.parents.filter((entry) => entry.child === key && entry.adoptive).map((entry) => linkTo(entry.parent)),
    children: tree.parents.filter((entry) => entry.parent === key && !entry.adoptive).map((entry) => linkTo(entry.child)),
    spouses: tree.spouses.filter((entry) => entry.a === key || entry.b === key).map((entry) => linkTo(entry.a === key ? entry.b : entry.a)),
    marriages: tree.spouses.filter((entry) => entry.a === key || entry.b === key).flatMap((entry) => {
      const marriage = [entry.marriageDate, entry.marriagePlace].filter(Boolean).join(', ');
      const divorce = entry.divorced ? [words.divorce, entry.divorceDate].filter(Boolean).join(' ') : '';
      const facts = [marriage && `${words.marriage} ${marriage}`, divorce].filter(Boolean).join('; ');
      return facts ? [`${linkTo(entry.a === key ? entry.b : entry.a)}: ${facts}`] : [];
    }),
    godparents: tree.godparents.filter((entry) => entry.child === key).map((entry) => linkTo(entry.godparent)),
  });
  const cards: PlannedCard[] = [];
  let unchanged = 0;
  for (const person of tree.people) {
    const imported: PersonFields = {
      id: `lg-${hash(sourceRecord(tree, person.key))}`,
      name: displayName(person, naming.scheme),
      surname: person.surname, given_name: person.givenName, patronymic: person.patronymic, birth_surname: person.birthSurname,
      name_variants: person.nameVariants,
      sex: person.sex === 'unknown' ? undefined : person.sex,
      birth_date: person.birthDate, birth_place: person.birthPlace, baptism_date: person.baptismDate, baptism_place: person.baptismPlace,
      death_date: person.deathDate, death_place: person.deathPlace, cause_of_death: person.causeOfDeath,
      burial_date: person.burialDate, burial_place: person.burialPlace,
      life_status: person.lifeStatus === 'unknown' ? undefined : person.lifeStatus,
      occupation: person.occupations.length > 1 ? person.occupations : person.occupations[0],
      education: person.education, military: person.military, residences: person.residences,
      religion: person.religion, nationality: person.nationality, social_status: person.socialStatus,
      photo: person.media[0] && mediaTarget.has(person.media[0]) ? `[[${mediaTarget.get(person.media[0])}]]` : undefined,
      ...relations(person.key),
      sources: [`${options.sourceLabel}: ${options.sourceName}`, ...person.citations],
      source_record: sourceRecord(tree, person.key),
    };
    for (const field of Object.keys(imported) as Array<keyof PersonFields>) {
      const value = imported[field];
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length && field !== 'sources')) delete imported[field];
    }
    const card = matched.get(person.key);
    if (!card) {
      const extra = person.media.slice(1).map((key) => mediaTarget.get(key)).filter(Boolean).map((target) => `![[${target}]]`);
      const body = [`## ${words.from(options.sourceName)}`, '', ...(person.notes.length ? person.notes.map((note) => note.includes('\n') ? note : `- ${note}`) : ['- ']), ...(extra.length ? ['', ...extra] : [])].join('\n');
      cards.push({ key: person.key, action: 'create', path: `${join(folderOf.get(person.key)!, baseOf.get(person.key)!)}.md`, fields: imported, body, conflicts: [] });
      continue;
    }
    const { patch, conflicts } = completion(card.fields, imported);
    if (Object.keys(patch).length || conflicts.length) cards.push({ key: person.key, action: 'update', path: card.path, fields: patch, body: '', conflicts });
    else unchanged++;
  }
  return {
    cards, media, ambiguous, namesakes,
    // A card with only disagreements gains nothing: it counts as unchanged, its conflicts are still reported.
    counts: {
      create: cards.filter((card) => card.action === 'create').length,
      update: cards.filter((card) => card.action === 'update' && Object.keys(card.fields).length).length,
      unchanged: unchanged + cards.filter((card) => card.action === 'update' && !Object.keys(card.fields).length).length,
    },
  };
}

const LIST_FIELDS = new Set(['parents', 'children', 'spouses', 'adoptive_parents', 'godparents', 'marriages', 'sources', 'name_variants', 'education', 'military', 'residences']);
const linkKey = (value: unknown) => String(value).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('/').pop()!.toLocaleLowerCase('ru');

/** Fields an existing card lacks, plus values that differ from it; lists only gain the entries they miss. */
export function completion(existing: PersonFields, imported: PersonFields) {
  const patch: PersonFields = {}; const conflicts: PlannedCard['conflicts'] = [];
  for (const [field, value] of Object.entries(imported) as Array<[keyof PersonFields, unknown]>) {
    if (field === 'id' && existing.id) continue;
    // The display name is formatting, not a fact: fill it when missing, never report it as a disagreement.
    if (field === 'name' && existing.name) continue;
    const current = existing[field];
    if (LIST_FIELDS.has(field)) {
      const have: unknown[] = Array.isArray(current) ? current : current ? [current] : [];
      const known = new Set(have.map(linkKey));
      const missing = (value as unknown[]).filter((entry) => !known.has(linkKey(entry)));
      if (missing.length) patch[field] = [...have, ...missing];
      continue;
    }
    const empty = current === undefined || current === null || (typeof current === 'string' && !current.trim());
    if (empty) patch[field] = value;
    else if (valueText(current).trim() !== valueText(value).trim()) conflicts.push({ field, existing: current, imported: value });
  }
  return { patch, conflicts };
}

/** Short stable hash (FNV-1a, base 36) for ids derived from source records. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { h ^= text.charCodeAt(index); h = Math.imul(h, 0x01000193); }
  let h2 = 0x01000193;
  for (let index = text.length - 1; index >= 0; index--) { h2 ^= text.charCodeAt(index); h2 = Math.imul(h2, 0x811c9dc5); }
  return (h >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
