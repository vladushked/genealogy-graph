import { isBlankDate, lifeYears, nameLines, references, yearOf, type RawPerson } from './model';

/**
 * Person card properties. Flat, so they stay editable in Obsidian's Properties panel, and close to GEDCOM: each
 * property names the GEDCOM tag it corresponds to. The note text is the person's story (GEDCOM `NOTE`). Generations
 * are not stored: the graph computes them from relationships.
 */

export type LifeStatus = 'living' | 'deceased' | 'unknown';
export type Identity = 'confirmed' | 'probable' | 'hypothesis';
export type Sex = 'male' | 'female' | 'unknown';

type Kind = 'text' | 'links' | 'list' | 'enum';
interface FieldSpec {
  kind: Kind;
  /** Allowed values (enums only). */
  values?: readonly string[];
}

/**
 * Dates are text: `1915`, `1915-03`, `1915-03-07`; `1915?` or `~1915` approximate (GEDCOM ABT/EST/CAL), `<1915`
 * before, `>1915` after, `1915..1920` between; `?` known to have happened, date unknown.
 */
export const FIELDS = {
  id: { kind: 'text' }, // GEDCOM UID
  name: { kind: 'text' }, // NAME, as displayed
  surname: { kind: 'text' }, // SURN
  given_name: { kind: 'text' }, // GIVN
  patronymic: { kind: 'text' }, // not in GEDCOM: exported as part of GIVN
  birth_surname: { kind: 'text' }, // NAME with TYPE birth (maiden name)
  name_variants: { kind: 'list' }, // other NAME records
  sex: { kind: 'enum', values: ['male', 'female', 'unknown'] }, // SEX M/F/U
  birth_date: { kind: 'text' }, birth_place: { kind: 'text' }, // BIRT
  baptism_date: { kind: 'text' }, baptism_place: { kind: 'text' }, // BAPM, CHR
  death_date: { kind: 'text' }, death_place: { kind: 'text' }, // DEAT
  cause_of_death: { kind: 'text' }, // DEAT.CAUS
  burial_date: { kind: 'text' }, burial_place: { kind: 'text' }, // BURI
  life_status: { kind: 'enum', values: ['living', 'deceased', 'unknown'] }, // not in GEDCOM: DEAT Y means deceased
  occupation: { kind: 'text' }, // OCCU; a list when there are several
  education: { kind: 'list' }, // EDUC
  military: { kind: 'list' }, // military service (_MILT, EVEN)
  residences: { kind: 'list' }, // RESI, CENS: «1926, д. Ивановка»
  religion: { kind: 'text' }, // RELI
  nationality: { kind: 'text' }, // NATI
  social_status: { kind: 'text' }, // CAST: social estate (крестьянин, мещанин…)
  photo: { kind: 'text' }, // OBJE, the portrait
  parents: { kind: 'links' }, // FAMC → HUSB/WIFE
  adoptive_parents: { kind: 'links' }, // FAMC with PEDI adopted/foster
  children: { kind: 'links' }, // FAMS → CHIL
  spouses: { kind: 'links' }, // FAMS → HUSB/WIFE
  marriages: { kind: 'list' }, // FAM MARR/DIV: «[[Супруг]]: брак 1975-06-12, Москва; развод 1980»
  godparents: { kind: 'links' }, // ASSO with RELA godparent
  identity: { kind: 'enum', values: ['confirmed', 'probable', 'hypothesis'] }, // roughly SOUR.QUAY
  sources: { kind: 'list' }, // SOUR
  questions: { kind: 'list' }, // open research questions
  source_record: { kind: 'text' }, // REFN: the record this card was imported from
} satisfies Record<string, FieldSpec>;

export type FieldName = keyof typeof FIELDS;
/** Values of a person card; missing keys are unknown. Links stay as written (wiki-links or names). */
export type PersonFields = Partial<Record<FieldName, unknown>>;

/** A property value as text, as String() writes it, but objects as JSON rather than «[object Object]». */
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(valueText).join(',');
  return JSON.stringify(value) ?? '';
}

/** Marks a note as a person card. */
export const PERSON_TYPE = 'person';

export function isPersonCard(frontmatter: Record<string, unknown> | undefined | null): boolean {
  return Boolean(frontmatter) && frontmatter!.type === PERSON_TYPE;
}

/** A card's fields, plus the enum values outside the schema (kept as written, reported in Проблемы). */
export function readFields(frontmatter: Record<string, unknown>): { fields: PersonFields; unknown: Array<{ field: FieldName; value: unknown }> } {
  const fields: PersonFields = {}; const unknown: Array<{ field: FieldName; value: unknown }> = [];
  for (const [field, spec] of Object.entries(FIELDS) as Array<[FieldName, FieldSpec]>) {
    const value = frontmatter[field];
    if (value === undefined) continue;
    fields[field] = value;
    if (spec.values && typeof value === 'string' && value.trim() && !spec.values.includes(value)) unknown.push({ field, value });
  }
  return { fields, unknown };
}

/** Properties for fields, with the person type marker. */
export function writeFields(fields: PersonFields): Record<string, unknown> {
  const out: Record<string, unknown> = { type: PERSON_TYPE };
  for (const field of Object.keys(FIELDS) as FieldName[]) if (field in fields) out[field] = fields[field];
  return out;
}

/** What the graph needs from a card, already interpreted. */
export interface PersonView {
  name: string | null;
  photo: string | undefined;
  birth: unknown;
  death: unknown;
  lifeStatus: LifeStatus;
  identity: Identity | null;
  parents: unknown; children: unknown; spouses: unknown; adoptiveParents: unknown;
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Life status a card states, or the one its death date implies; otherwise unknown. */
export function lifeStatusOf(fields: PersonFields): LifeStatus {
  const stated = fields.life_status;
  if (stated === 'living' || stated === 'deceased' || stated === 'unknown') return stated;
  return isBlankDate(fields.death_date) ? 'unknown' : 'deceased';
}

/** Interprets a card for the graph. */
export function readPerson(frontmatter: Record<string, unknown>): PersonView {
  const { fields } = readFields(frontmatter);
  const identity = fields.identity === 'confirmed' || fields.identity === 'probable' || fields.identity === 'hypothesis' ? fields.identity : null;
  return {
    name: text(fields.name),
    photo: typeof fields.photo === 'string' ? fields.photo : undefined,
    birth: fields.birth_date, death: fields.death_date, lifeStatus: lifeStatusOf(fields), identity,
    parents: fields.parents, children: fields.children, spouses: fields.spouses, adoptiveParents: fields.adoptive_parents,
  };
}

/** Links of a relationship field as plain link texts (see model.references). */
export const linkTexts = (value: unknown) => references(value);

/** A card as the graph takes it: `id` is the vault path, `basename` the file name, `portrait` the resolved image. */
export function rawPerson(id: string, basename: string, frontmatter: Record<string, unknown>, portrait?: string): RawPerson {
  const person = readPerson(frontmatter);
  const { fields } = readFields(frontmatter);
  const name = person.name ?? basename;
  return {
    id, name, photo: person.photo, portrait,
    deceased: person.lifeStatus === 'deceased',
    lifeYears: lifeYears(person.birth, person.death, person.lifeStatus),
    sex: fields.sex === 'male' || fields.sex === 'female' ? fields.sex : undefined,
    nameLines: nameLines(name, fields.surname),
    birthYear: yearOf(person.birth) ?? undefined,
    status: person.identity ?? undefined,
    ancestors: person.parents, descendants: person.children, spouses: person.spouses, adoptiveParents: person.adoptiveParents,
  };
}
