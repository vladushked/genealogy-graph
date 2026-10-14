/**
 * A family tree read from another program, before it becomes cards. Every import format produces this shape, and
 * everything after it (matching, generations, file names, writing) is shared by all formats.
 */

export interface ImportedPerson {
  /** Stable key of the record in the source file; part of `source_record`, used to find the card again on re-import. */
  key: string;
  surname?: string;
  givenName?: string;
  patronymic?: string;
  /** Surname at birth (maiden name), when the source keeps a second surname. */
  birthSurname?: string;
  /** Other names the person was known by, as full names. */
  nameVariants: string[];
  sex: 'male' | 'female' | 'unknown';
  /** Dates as card text (see schema.FIELDS): `1915-03-07`, `1915?`, `<1915`, `1915..1920`; `deathDate` `?` = died, date unknown. */
  birthDate?: string;
  birthPlace?: string;
  baptismDate?: string;
  baptismPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  causeOfDeath?: string;
  burialDate?: string;
  burialPlace?: string;
  lifeStatus: 'living' | 'deceased' | 'unknown';
  occupations: string[];
  education: string[];
  military: string[];
  /** Places of residence, each with its date when known: «1926, д. Ивановка». */
  residences: string[];
  religion?: string;
  nationality?: string;
  socialStatus?: string;
  /** Sources cited for this person's facts, as text: «Метрическая книга 1915 г., л. 12». */
  citations: string[];
  /** Free text: the person's notes and other facts without a dedicated field. */
  notes: string[];
  /** Keys of this person's media; the first is the portrait. */
  media: string[];
}

export interface ImportedMedia {
  key: string;
  /** File name inside the source's media folder. */
  path: string;
  title?: string;
}

export interface ImportedTree {
  /** Format id, e.g. `drevo-zhizni`. */
  format: string;
  /** Identifier of the source database, so two different files never share record keys. */
  sourceId: string;
  people: ImportedPerson[];
  parents: Array<{ child: string; parent: string; adoptive?: boolean }>;
  spouses: Array<{ a: string; b: string; marriageDate?: string; marriagePlace?: string; divorced?: boolean; divorceDate?: string }>;
  godparents: Array<{ child: string; godparent: string }>;
  media: ImportedMedia[];
  /** Data problems found while reading (not fatal). */
  warnings: string[];
}

/** An unreadable or damaged source file; the message is shown to the user as is. */
export class ImportError extends Error {}
