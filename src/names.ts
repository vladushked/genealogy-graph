import type { Sex } from './schema';

/**
 * How names are built in a family tree. The scheme sets the order a name is written in, which parts the form asks
 * for and what the form fills in from relatives:
 * - russian: «Фамилия Имя Отчество»; a patronymic from the father's name, the surname in the person's form
 *   (Озеров ↔ Озерова), a wife's married surname, a father's name from a child's patronymic;
 * - western: «Given Middle Surname»; the father's surname;
 * - spanish: «Nombre Apellido1 Apellido2»; the father's first surname and the mother's first surname;
 * - eastern: «Surname Given» (China, Korea, Japan, Hungary); the father's surname, a wife keeps her own;
 * - icelandic: «Given Patronymic», no surname; the patronymic from the father's name (Jón → Jónsson, Jónsdóttir).
 * People without a surname are fine in every scheme.
 */
export type NameScheme = 'russian' | 'western' | 'spanish' | 'eastern' | 'icelandic';
export const NAME_SCHEMES: NameScheme[] = ['russian', 'western', 'spanish', 'eastern', 'icelandic'];
export type NamePart = 'surname' | 'given_name' | 'patronymic';

/** What the editor knows about a relative, read from its card. */
export interface Relative {
  path: string; name: string; sex: Sex;
  surname: string; given_name: string; patronymic: string; birth_surname: string;
  parents: string[]; children: string[]; spouses: string[];
}

export interface NameParts { surname?: unknown; given_name?: unknown; patronymic?: unknown; birth_surname?: unknown }

const text = (value: unknown) => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';

/** Parts of the name in the order the form asks for them. */
export function nameFields(scheme: NameScheme): NamePart[] {
  switch (scheme) {
    case 'russian': return ['surname', 'given_name', 'patronymic'];
    case 'eastern': return ['surname', 'given_name', 'patronymic'];
    case 'icelandic': return ['given_name', 'patronymic', 'surname'];
    default: return ['given_name', 'patronymic', 'surname'];
  }
}

/** Whether a person of this scheme normally has a patronymic: the form shows the field and «Уточнить» asks for it. */
export const usesPatronymic = (scheme: NameScheme) => scheme === 'russian' || scheme === 'icelandic';
/** Whether a person of this scheme normally has a surname. */
export const usesSurname = (scheme: NameScheme) => scheme !== 'icelandic';

/**
 * The full name in the scheme's order, with a different birth surname in parentheses; `?` when nothing is known.
 * «Озерова Светлана Борисовна (Кравченко)», «Mary Ann Smith (Jones)», «Kim Min-jun», «Jón Sigurðsson».
 */
export function personTitle(parts: NameParts, scheme: NameScheme): string {
  const surname = text(parts.surname); const given = text(parts.given_name); const patronymic = text(parts.patronymic);
  const order = scheme === 'russian' || scheme === 'eastern' ? [surname, given, patronymic] : [given, patronymic, surname];
  const main = order.filter(Boolean).join(' ') || '?';
  const born = text(parts.birth_surname);
  return born && born !== surname ? `${main} (${born})` : main;
}

export interface NameHints { surname: string; given_name: string; patronymic: string }

/**
 * Name hints for a person from the relatives chosen in the form; only suggestions — the form fills them into fields
 * the user has not typed in. What is suggested depends on the scheme (see NameScheme).
 */
export function suggestNames(scheme: NameScheme, sex: Sex, parents: Relative[], children: Relative[], spouses: Relative[]): NameHints {
  const hints: NameHints = { surname: '', given_name: '', patronymic: '' };
  const father = parents.find((parent) => parent.sex === 'male');
  const mother = parents.find((parent) => parent.sex === 'female');
  const child = children.find((item) => item.surname || item.patronymic || item.birth_surname);
  // A daughter's surname at birth is her father's; a married one may be her husband's.
  const childSurname = child ? child.birth_surname || child.surname : '';
  const fatherSurname = father ? father.birth_surname || father.surname : '';
  switch (scheme) {
    case 'russian': {
      const husband = sex === 'female' ? spouses.find((spouse) => spouse.sex === 'male' && spouse.surname) : undefined;
      if (husband) hints.surname = genderSurname(husband.surname, 'female');
      else if (father?.surname) hints.surname = genderSurname(father.surname, sex);
      else if (childSurname && sex !== 'unknown') hints.surname = genderSurname(childSurname, sex);
      else if (mother?.surname && !father) hints.surname = genderSurname(mother.surname, sex);
      if (father?.given_name) hints.patronymic = patronymicOf(father.given_name, sex);
      if (sex === 'male' && child?.patronymic) hints.given_name = fatherName(child.patronymic);
      break;
    }
    case 'spanish': {
      const paternal = father ? firstSurname(fatherSurname) : '';
      const maternal = mother ? firstSurname(mother.birth_surname || mother.surname) : '';
      if (paternal || maternal) hints.surname = [paternal, maternal].filter(Boolean).join(' ');
      else if (childSurname && sex === 'male') hints.surname = firstSurname(childSurname);
      else if (childSurname && sex === 'female') hints.surname = secondSurname(childSurname);
      break;
    }
    case 'icelandic':
      if (father?.given_name) hints.patronymic = icelandicPatronymic(father.given_name, sex);
      break;
    default:
      if (fatherSurname) hints.surname = fatherSurname;
      else if (childSurname && sex === 'male') hints.surname = childSurname;
      else if (mother && !father) hints.surname = mother.birth_surname || mother.surname;
  }
  return hints;
}

/**
 * The common parent assumed for a new sibling of a person without parents: their father, named after the person's
 * patronymic when the scheme has one, with the family surname. Not a card yet — see cards.create.
 */
export function assumedParent(sibling: Relative, scheme: NameScheme, newParent: string): Relative {
  const given = scheme === 'russian' ? fatherName(sibling.patronymic) : '';
  const born = sibling.birth_surname || sibling.surname;
  const surname = scheme === 'russian' ? given ? genderSurname(born, 'male') : born
    : scheme === 'spanish' ? firstSurname(born) : scheme === 'icelandic' ? '' : born;
  const sex: Sex = given ? 'male' : 'unknown';
  return {
    path: newParent, name: personTitle({ surname, given_name: given || '?' }, scheme), sex,
    surname, given_name: given, patronymic: '', birth_surname: '',
    parents: [], children: [sibling.path], spouses: [],
  };
}

/** Folder name for a family of a surname: Озеров/Озерова → Озеровы in the Russian scheme; the first surname in the Spanish. */
export function familyName(surname: string, scheme: NameScheme): string {
  const word = surname.trim();
  if (scheme === 'spanish') return firstSurname(word);
  if (scheme !== 'russian') return word;
  const rules: Array<[RegExp, string]> = [
    [/(ов|ев|ёв|ин|ын)а$/i, '$1ы'], [/(ов|ев|ёв|ин|ын)$/i, '$1ы'],
    [/(ск|цк)(ий|ая)$/i, '$1ие'], [/(ой|ая)$/i, 'ие'],
  ];
  for (const [pattern, replacement] of rules) if (pattern.test(word)) return word.replace(pattern, replacement);
  return word;
}

// ── Russian names

const SURNAME_FORMS: Array<[RegExp, string, RegExp, string]> = [
  // male pattern, female replacement, female pattern, male replacement
  [/(ов|ев|ёв|ин|ын)$/i, '$1а', /(ов|ев|ёв|ин|ын)а$/i, '$1'],
  [/(ск|цк)ий$/i, '$1ая', /(ск|цк)ая$/i, '$1ий'],
  [/ой$/i, 'ая', /^$/, ''],
  [/ый$/i, 'ая', /^$/, ''],
];

/** A surname in the form for a sex: Озеров ↔ Озерова, Бельский ↔ Бельская; others stay as they are. */
export function genderSurname(surname: string, sex: Sex): string {
  const word = surname.trim();
  if (!word || sex === 'unknown') return word;
  for (const [male, female, femalePattern, maleForm] of SURNAME_FORMS) {
    if (sex === 'female' && male.test(word)) return word.replace(male, female);
    if (sex === 'male' && femalePattern.source !== '^$' && femalePattern.test(word)) return word.replace(femalePattern, maleForm);
  }
  return word;
}

/** Names whose patronymics do not follow the regular endings. */
const IRREGULAR: Array<[string, string, string]> = [
  ['Илья', 'Ильич', 'Ильинична'], ['Кузьма', 'Кузьмич', 'Кузьминична'], ['Фома', 'Фомич', 'Фоминична'], ['Лука', 'Лукич', 'Лукинична'],
  ['Яков', 'Яковлевич', 'Яковлевна'], ['Лев', 'Львович', 'Львовна'], ['Павел', 'Павлович', 'Павловна'], ['Пётр', 'Петрович', 'Петровна'], ['Михаил', 'Михайлович', 'Михайловна'],
];

/** Patronymic from a father's name: Иван → Иванович / Ивановна, Сергей → Сергеевич, Василий → Васильевич. */
export function patronymicOf(fatherName: string, sex: Sex): string {
  const name = fatherName.trim();
  if (!name || sex === 'unknown') return '';
  const male = sex === 'male';
  const irregular = IRREGULAR.find(([given]) => given === name);
  if (irregular) return male ? irregular[1] : irregular[2];
  const ending = (base: string, soft: boolean) => base + (soft ? male ? 'евич' : 'евна' : male ? 'ович' : 'овна');
  if (/[^аеёиоуыэюя][^аеёиоуыэюя]ий$/i.test(name)) return ending(name.slice(0, -1), true); // Дмитрий → Дмитриевич
  if (/ий$/i.test(name)) return ending(`${name.slice(0, -2)}ь`, true); // Василий → Васильевич
  if (/[ейь]$/i.test(name)) return ending(name.slice(0, -1), true); // Сергей → Сергеевич, Игорь → Игоревич
  if (/[ая]$/i.test(name)) return name.slice(0, -1) + (male ? 'ич' : 'ична'); // Никита → Никитич
  if (/[жшчщц]$/i.test(name)) return ending(name, true);
  return ending(name, false);
}

/**
 * The father's name a patronymic implies: Иванович → Иван, Сергеевна → Сергей, Васильевич → Василий,
 * Дмитриевич → Дмитрий, Игоревич → Игорь, Никитична → Никита; '' when the word is not a patronymic.
 */
export function fatherName(patronymic: string): string {
  const word = patronymic.trim();
  const irregular = IRREGULAR.find(([, male, female]) => male === word || female === word);
  if (irregular) return irregular[0];
  let match: RegExpMatchArray | null;
  if ((match = word.match(/^(.+)[ьи]ев(?:ич|на)$/i))) return `${match[1]}ий`;
  if ((match = word.match(/^(.+[аеёиоуыэюя])ев(?:ич|на)$/i))) return `${match[1]}й`;
  if ((match = word.match(/^(.+[жшчщц])ев(?:ич|на)$/i))) return match[1];
  if ((match = word.match(/^(.+)ев(?:ич|на)$/i))) return `${match[1]}ь`;
  if ((match = word.match(/^(.+)ов(?:ич|на)$/i))) return match[1];
  if ((match = word.match(/^(.+)(?:ич|ична)$/i))) return `${match[1]}а`;
  return '';
}

// ── Spanish and Icelandic names

/** Particles that belong to the surname after them: «de la Fuente», «del Valle». */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'das', 'do', 'dos', 'san', 'santa']);

/** The first of two Spanish surnames: «García Márquez» → «García», «de la Fuente López» → «de la Fuente». */
export function firstSurname(surname: string): string {
  const words = surname.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    out.push(word);
    if (!PARTICLES.has(word.toLowerCase())) break;
  }
  return out.join(' ');
}

/** The second Spanish surname, the mother's: «García Márquez» → «Márquez», «Ortega y Gasset» → «Gasset». */
export function secondSurname(surname: string): string {
  return surname.trim().slice(firstSurname(surname).length).trim().replace(/^y\s+/i, '');
}

/**
 * An Icelandic patronymic from the father's name in the genitive: Jón → Jónsson, Jónsdóttir; Guðmundur → Guðmundsson;
 * Helgi → Helgason; Magnús → Magnússon.
 */
export function icelandicPatronymic(fatherName: string, sex: Sex): string {
  const name = fatherName.trim();
  if (!name || sex === 'unknown') return '';
  const genitive = /ur$/.test(name) ? `${name.slice(0, -2)}s` : /i$/.test(name) ? `${name.slice(0, -1)}a` : /s$/.test(name) ? name : `${name}s`;
  return genitive + (sex === 'male' ? 'son' : 'dóttir');
}
