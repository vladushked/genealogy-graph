import { parseDate, type DatePart } from './dates';
import type { Lang } from './i18n';
import { valueText, type Sex } from './schema';

/**
 * Words of the profile window, per language: the plugin writes a person's facts in the reader's own language, not as
 * the card's English property names, in the plugin's language.
 */
export const PROFILE_TEXT = {
  ru: {
    life: 'Жизнь', about: 'О человеке', family: 'Семья', sources: 'Источники', questions: 'Открытые вопросы', story: 'Заметка',
    birth: 'Рождение', baptism: 'Крещение', death: 'Смерть', age: 'Возраст', lived: 'Прожил(а)', livedMale: 'Прожил', livedFemale: 'Прожила', cause: 'Причина смерти', burial: 'Погребение',
    names: 'Другие имена', occupation: 'Занятие', social: 'Сословие', education: 'Образование', military: 'Военная служба',
    residences: 'Места жительства', religion: 'Вероисповедание', nationality: 'Национальность', marriages: 'Браки',
    parents: 'Родители', adoptive: 'Приёмные родители', spouses: 'Супруги', children: 'Дети', siblings: 'Братья и сёстры', godparents: 'Крёстные',
    hypothesis: 'Гипотеза', probable: 'Частично подтверждён', self: 'Это я', living: 'Жив', livingFemale: 'Жива',
    bornMale: 'урождённый', bornFemale: 'урождённая', bornOther: 'урожд.',
    showOnGraph: 'Показать на графе', edit: 'Изменить', openNote: 'Открыть заметку', back: 'Назад', close: 'Закрыть',
    emptyStory: 'В заметке пока ничего не написано.', emptyStoryHint: 'Историю человека пишут в теле заметки — «Открыть заметку».',
    unknownDate: 'дата неизвестна',
  },
  en: {
    life: 'Life', about: 'About', family: 'Family', sources: 'Sources', questions: 'Open questions', story: 'Note',
    birth: 'Birth', baptism: 'Baptism', death: 'Death', age: 'Age', lived: 'Lived', livedMale: 'Lived', livedFemale: 'Lived', cause: 'Cause of death', burial: 'Burial',
    names: 'Other names', occupation: 'Occupation', social: 'Social status', education: 'Education', military: 'Military service',
    residences: 'Residences', religion: 'Religion', nationality: 'Nationality', marriages: 'Marriages',
    parents: 'Parents', adoptive: 'Adoptive parents', spouses: 'Spouses', children: 'Children', siblings: 'Siblings', godparents: 'Godparents',
    hypothesis: 'Hypothesis', probable: 'Partly confirmed', self: 'This is me', living: 'Living', livingFemale: 'Living',
    bornMale: 'born', bornFemale: 'née', bornOther: 'born',
    showOnGraph: 'Show on graph', edit: 'Edit', openNote: 'Open note', back: 'Back', close: 'Close',
    emptyStory: 'Nothing is written in the note yet.', emptyStoryHint: 'A person’s story goes in the note body — «Open note».',
    unknownDate: 'date unknown',
  },
} satisfies Record<Lang, Record<string, string>>;

export type ProfileWords = typeof PROFILE_TEXT.ru;

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const RU_MONTHS_ALONE = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** One date: `1915`, `1915-03`, `1915-03-07` → «1915», «март 1915», «7 марта 1915». */
function words(date: DatePart, lang: Lang): string {
  const index = date.month ? date.month - 1 : -1;
  if (index < 0) return String(date.year);
  if (!date.day) return `${lang === 'ru' ? RU_MONTHS_ALONE[index] : EN_MONTHS[index]} ${date.year}`;
  return lang === 'ru' ? `${date.day} ${RU_MONTHS[index]} ${date.year}` : `${date.day} ${EN_MONTHS[index]} ${date.year}`;
}

/** A card date in words (see dates.ts): «около 1915», «before 7 March 1915», «1910s». Other text is shown as written. */
export function formatDate(raw: unknown, lang: Lang): string {
  const value = valueText(raw).trim();
  if (!value) return '';
  const date = parseDate(raw);
  if (!date) return value;
  const ru = lang === 'ru';
  switch (date.kind) {
    case 'unknown': return PROFILE_TEXT[lang].unknownDate;
    case 'exact': return words(date.date, lang);
    // «около 1915», but «примерно март 1915»: «около» wants a genitive a month name does not have here.
    case 'about': return `${ru ? date.date.month ? 'примерно' : 'около' : 'about'} ${words(date.date, lang)}`;
    case 'before': return `${ru ? 'до' : 'before'} ${words(date.date, lang)}`;
    case 'after': return `${ru ? 'после' : 'after'} ${words(date.date, lang)}`;
    case 'between': return ru ? `между ${words(date.date, lang)} и ${words(date.to, lang)}` : `between ${words(date.date, lang)} and ${words(date.to, lang)}`;
    case 'decade': return ru ? `${date.date.year}-е` : `${date.date.year}s`;
  }
}

/** Full years between two exact dates; only the years when months are missing (then marked approximate). */
export function ageBetween(birth: unknown, end: unknown): { years: number; approximate: boolean } | null {
  const parse = (value: unknown) => {
    const date = parseDate(value);
    return date?.kind === 'exact' ? { year: date.date.year, month: date.date.month ?? null, day: date.date.day ?? null } : null;
  };
  const from = parse(birth); const to = parse(end);
  if (!from || !to) return null;
  let years = to.year - from.year;
  const precise = from.month !== null && from.day !== null && to.month !== null && to.day !== null;
  if (precise && (to.month! < from.month! || (to.month === from.month && to.day! < from.day!))) years--;
  return years >= 0 && years < 130 ? { years, approximate: !precise } : null;
}

/** «22 года», «около 65 лет»; English «22 years», «about 65 years». */
export function ageLabel(age: { years: number; approximate: boolean }, lang: Lang): string {
  const { years, approximate } = age;
  if (lang === 'en') return `${approximate ? 'about ' : ''}${years} ${years === 1 ? 'year' : 'years'}`;
  const tens = years % 100; const units = years % 10;
  const word = tens >= 11 && tens <= 14 ? 'лет' : units === 1 ? 'год' : units >= 2 && units <= 4 ? 'года' : 'лет';
  return `${approximate ? 'около ' : ''}${years} ${word}`;
}

/** «урождённая Мельникова». */
export function bornAs(surname: string, sex: Sex, lang: Lang): string {
  const words = PROFILE_TEXT[lang];
  return `${sex === 'female' ? words.bornFemale : sex === 'male' ? words.bornMale : words.bornOther} ${surname}`;
}

/** A property value as plain lines: lists stay lists, wiki-links show their text. */
export function textValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => {
    if (entry === null || entry === undefined) return [];
    const text = String(entry).replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target.split('/').pop()!.split('#')[0]).trim();
    return text ? [text] : [];
  });
}

/**
 * The note's story, or null when it holds nothing a reader would want: only headings, empty list items and blank
 * lines (an import leaves «## Из «…»» with an empty «-»), or just the portrait embed.
 */
export function storyText(body: string, portraitLinks: string[] = []): string | null {
  const lines = body.split('\n').filter((line) => {
    const text = line.trim();
    return !portraitLinks.some((link) => text === `![[${link}]]` || text.startsWith(`![[${link}|`));
  });
  const meaningful = lines.some((line) => {
    const text = line.trim();
    return text && !/^#{1,6}\s/.test(text) && !/^[-*+]\s*$/.test(text) && !/^[-*_]{3,}$/.test(text);
  });
  return meaningful ? lines.join('\n').trim() : null;
}
