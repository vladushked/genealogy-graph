/**
 * Card dates. A date is text: `1915`, `1915-03`, `1915-03-07`, or one of the qualified forms people write in Russian
 * or English and GEDCOM uses — about (`1915?`, `~1915`, `около 1915`, `abt 1915`, `c. 1915`, `est 1915`), before
 * (`<1915`, `до 1915`, `bef 1915`, `before 1915`), after (`>1915`, `после 1915`, `aft 1915`), between (`1915..1920`,
 * `между 1915 и 1920`, `bet 1915 and 1920`, `1915–1920`), a decade (`1910-е`, `1910s`); `?` happened on an unknown
 * date. A day may also be written `7 Mar 1915`, `March 7, 1915` or `07.03.1915`.
 */

export interface DatePart { year: number; month?: number; day?: number }
export type ParsedDate =
  | { kind: 'exact' | 'about' | 'before' | 'after'; date: DatePart }
  | { kind: 'between'; date: DatePart; to: DatePart }
  | { kind: 'decade'; date: DatePart }
  | { kind: 'unknown' };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const part = (year: string, month?: string | number, day?: string | number): DatePart | null => {
  const out: DatePart = { year: Number(year) };
  if (month !== undefined && month !== '') {
    const m = Number(month);
    if (!(m >= 1 && m <= 12)) return null;
    out.month = m;
    if (day !== undefined && day !== '') {
      const d = Number(day);
      if (!(d >= 1 && d <= 31)) return null;
      out.day = d;
    }
  }
  return out;
};

/** One point in time without a qualifier. */
function point(text: string): DatePart | null {
  const value = text.trim().replace(/\s+/g, ' ');
  let match = value.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (match) return part(match[1], match[2], match[3]);
  match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) return part(match[3], match[2], match[1]);
  match = value.match(/^(\d{1,2})\.(\d{4})$/);
  if (match) return part(match[2], match[1]);
  match = value.match(/^(?:(\d{1,2}) )?([a-z]{3,9})\.? (\d{4})$/i);
  if (match && MONTHS[match[2].toLowerCase()]) return part(match[3], MONTHS[match[2].toLowerCase()], match[1]);
  match = value.match(/^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i);
  if (match && MONTHS[match[1].toLowerCase()]) return part(match[3], MONTHS[match[1].toLowerCase()], match[2]);
  return null;
}

// A word is taken whole: «ca» must not take the start of «cal», «approx» of «approximately».
const ABOUT = /^(?:~|≈|около|ок\.?|примерно|приблизительно|approximately|approx\.?|about|abt\.?|circa|ca\.?|c\.|estimated|est\.?|calculated|calc\.?|cal\.?)(?![a-zа-яё])\s*/i;
const BEFORE = /^(?:<|до|ранее|не позднее|before|bef\.?)(?![a-zа-яё])\s*/i;
const AFTER = /^(?:>|после|не ранее|after|aft\.?)(?![a-zа-яё])\s*/i;
const BETWEEN = [
  /^(?:между|bet\.?|between)\s+(.+?)\s+(?:и|and)\s+(.+)$/i,
  /^(?:from|с)\s+(.+?)\s+(?:to|по)\s+(.+)$/i,
  /^(.+?)\s*\.\.\s*(.+)$/,
  /^(\d{4})\s*[–—-]\s*(\d{4})$/,
];

/** A card date; null for text that is not a date (`весна`). */
export function parseDate(raw: unknown): ParsedDate | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : { kind: 'exact', date: { year: raw.getUTCFullYear(), month: raw.getUTCMonth() + 1, day: raw.getUTCDate() } };
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 1000 && raw <= 9999 ? { kind: 'exact', date: { year: raw } } : null;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value === '?') return { kind: 'unknown' };
  const exact = point(value);
  if (exact) return { kind: 'exact', date: exact };
  const decade = value.match(/^(\d{3}0)(?:-?е(?:\s*гг?\.?)?|'?s)$/i);
  if (decade) return { kind: 'decade', date: { year: Number(decade[1]) } };
  for (const pattern of BETWEEN) {
    const match = value.match(pattern);
    const from = match && point(match[1]); const to = match && point(match[2]);
    if (from && to) return { kind: 'between', date: from, to };
  }
  for (const [pattern, kind] of [[BEFORE, 'before'], [AFTER, 'after'], [ABOUT, 'about']] as const) {
    if (!pattern.test(value)) continue;
    const rest = value.replace(pattern, '').replace(/\?$/, '');
    const date = point(rest);
    if (date) return { kind, date };
  }
  const questioned = value.match(/^(.+?)\s*\?$/);
  const date = questioned && point(questioned[1]);
  return date ? { kind: 'about', date } : null;
}

/** The year a date names: the date's own, the start of a range or decade; null without one. */
export function dateYear(raw: unknown): number | null {
  const date = parseDate(raw);
  return date && date.kind !== 'unknown' ? date.date.year : null;
}
