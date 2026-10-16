import { references, type Graph } from './model';
import type { LifeStatus, PersonFields, Sex } from './schema';
import { dateYear } from './dates';
import { t } from './i18n';
import { personTitle, schemeOf, usesPatronymic, usesSurname, type NameScheme, type Relative } from './names';
export type { Relative } from './names';

/**
 * Pure rules of the card editor: card file names, edits of link lists and the
 * «Уточнить» list. Writing to the vault lives in cards.ts.
 */

export type Relation = 'parent' | 'child' | 'spouse' | 'sibling';
export type RelationField = 'parents' | 'children' | 'spouses';
export const RELATION_FIELDS: RelationField[] = ['parents', 'children', 'spouses'];
/** The field of the other card that points back: a parent lists the person among its children, and so on. */
export const REVERSE: Record<RelationField, RelationField> = { parents: 'children', children: 'parents', spouses: 'spouses' };
/** Stands in the parents of a new sibling whose relative has no parents yet: a common parent created as a hypothesis. */
export const NEW_PARENT = '\u0000new-parent';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
/** Characters Obsidian refuses in file names; `?` stays, as the card naming rules use it for unknown parts. */
const unsafe = /[\\/:*"<>|#^[\]]/g;
export const fileSafe = (value: string) => value.replace(unsafe, ' ').replace(/\s+/g, ' ').trim();

/** How new cards are named: the name scheme and the file name template (see cardBase). */
export interface Naming { scheme: NameScheme; template: string }
/** `Фамилия Имя Отчество ГГГГ-ГГГГ` in the Russian scheme, `Given Surname YYYY-YYYY` in the western. */
export const DEFAULT_FILE_NAME = '{name} {born}-{died}';
export const FILE_NAME_PLACEHOLDERS = ['name', 'surname', 'given', 'patronymic', 'birth_surname', 'born', 'died'] as const;

/**
 * Card file name without extension, by the template: `{name}` is the full name in the scheme's order (with a
 * different birth surname in parentheses), `{surname}`, `{given}`, `{patronymic}`, `{birth_surname}` its parts,
 * `{born}` and `{died}` the years (`?` unknown; `{died}` is empty for the living). Spaces left by empty parts and
 * empty parentheses are dropped.
 */
export function cardBase(fields: PersonFields, lifeStatus: LifeStatus, naming: Naming): string {
  const year = (value: unknown) => { const found = dateYear(value); return found === null ? null : String(found); };
  const hasParts = Boolean(text(fields.surname) || text(fields.given_name) || text(fields.patronymic));
  const values: Record<(typeof FILE_NAME_PLACEHOLDERS)[number], string> = {
    name: hasParts ? personTitle(fields, schemeOf(fields.name_scheme, naming.scheme)) : text(fields.name) || '?',
    surname: text(fields.surname), given: text(fields.given_name), patronymic: text(fields.patronymic), birth_surname: text(fields.birth_surname),
    born: year(fields.birth_date) ?? '?',
    died: lifeStatus === 'living' ? '' : lifeStatus === 'deceased' ? year(fields.death_date) ?? '?' : '?',
  };
  const template = naming.template.trim() || DEFAULT_FILE_NAME;
  const filled = template.replace(/\{(\w+)\}/g, (whole, key: string) => key in values ? values[key as keyof typeof values] : whole)
    .replace(/\(\s*\)|\[\s*\]/g, '');
  const base = fileSafe(filled).replace(/^[\s,;·–-]+(?=\S)/, '').replace(/[\s,;·]+$/, '');
  return base || '?';
}

/** Sex suggested for a new parent: the opposite of a parent already known, otherwise a father first. */
export function parentSex(existingParents: Relative[]): Sex {
  if (existingParents.some((parent) => parent.sex === 'male')) return 'female';
  return 'male';
}

// ── link lists

/** A relationship property as a list, adding a link unless one already points to the same card. */
export function addLink(value: unknown, link: string, sameCard: (reference: string) => boolean): unknown[] {
  const list = asList(value);
  return list.some((entry) => references(entry).some(sameCard)) ? list : [...list, link];
}

/** A relationship property as a list without the entries that point to a card. */
export function removeLink(value: unknown, sameCard: (reference: string) => boolean): unknown[] {
  return asList(value).filter((entry) => !references(entry).some(sameCard));
}

const asList = (value: unknown): unknown[] => Array.isArray(value) ? [...(value as unknown[])] : value == null || value === '' ? [] : [value];

// ── «Уточнить»

/** What the card alone cannot say: relatives found on the graph and whether a portrait was found. */
export interface ClarifyContext { parents: number; children: number; hasPhoto: boolean; lifeStatus: LifeStatus }

/** One thing to clarify: an empty field, or a note (unconfirmed identity, an open question). */
export interface Clarification { kind: 'missing' | 'note'; text: string }

/**
 * What is still to be clarified about a person: every empty field of the main card (name parts, sex,
 * parents, children, dates, life status, photo), an identity that is not confirmed, and open questions.
 */
export function clarifications(fields: PersonFields, context: ClarifyContext, scheme: NameScheme = 'russian'): Clarification[] {
  const out: Clarification[] = [];
  const words = t().clarify;
  const missing = (text: string) => out.push({ kind: 'missing', text });
  const blank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && (!value.trim() || value.trim() === '?'));
  if (usesSurname(scheme) && blank(fields.surname)) missing(words.surname);
  if (blank(fields.given_name)) missing(words.given);
  if (usesPatronymic(scheme) && blank(fields.patronymic)) missing(words.patronymic);
  if (fields.sex !== 'male' && fields.sex !== 'female') missing(words.sex);
  if (context.parents === 0) missing(words.parents); else if (context.parents === 1) missing(words.secondParent);
  if (context.children === 0) missing(words.children);
  if (blank(fields.birth_date)) missing(words.birthDate);
  if (context.lifeStatus === 'unknown') missing(words.lifeStatus);
  else if (context.lifeStatus === 'deceased' && blank(fields.death_date)) missing(words.deathDate);
  if (!context.hasPhoto) missing(words.photo);
  if (fields.identity === 'hypothesis') out.push({ kind: 'note', text: words.hypothesis });
  else if (fields.identity === 'probable') out.push({ kind: 'note', text: words.probable });
  for (const question of asList(fields.questions)) {
    const value = text(question);
    if (value) out.push({ kind: 'note', text: words.question(value) });
  }
  return out;
}

/** A card for «Уточнить»: its fields, life status and whether a portrait was found. */
export interface ClarifyCard { path: string; fields: PersonFields; lifeStatus: LifeStatus; hasPhoto: boolean }

/**
 * «Уточнить» for every card. Parents and children count both the links on the graph and those the card itself
 * declares, even when the graph cannot draw them (they are then listed in Проблемы).
 */
export function clarifyCards(graph: Graph, cards: ClarifyCard[], resolve: (link: string, source: string) => string | null, scheme: NameScheme): Map<string, Clarification[]> {
  const relatives = new Map<string, { parents: Set<string>; children: Set<string> }>();
  const of = (id: string) => { let entry = relatives.get(id); if (!entry) { entry = { parents: new Set(), children: new Set() }; relatives.set(id, entry); } return entry; };
  for (const edge of graph.edges) if (edge.relation === 'parent') { of(edge.to).parents.add(edge.from); of(edge.from).children.add(edge.to); }
  const out = new Map<string, Clarification[]>();
  for (const card of cards) {
    const entry = of(card.path);
    for (const link of [...references(card.fields.parents), ...references(card.fields.adoptive_parents)]) { const target = resolve(link, card.path); if (target) entry.parents.add(target); }
    for (const link of references(card.fields.children)) { const target = resolve(link, card.path); if (target) entry.children.add(target); }
    const notes = clarifications(card.fields, { parents: entry.parents.size, children: entry.children.size, hasPhoto: card.hasPhoto, lifeStatus: card.lifeStatus }, schemeOf(card.fields.name_scheme, scheme));
    if (notes.length) out.set(card.path, notes);
  }
  return out;
}
