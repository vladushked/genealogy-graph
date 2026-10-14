import type { Edge } from './model';
import type { Sex } from './schema';

/**
 * Kinship terms for «Маршрут родства»: what the last person of a route is to the first, in Russian or English,
 * worked out from the steps of the route (to a parent, to a child, to a spouse) and the sexes of the people on it.
 * Blood kin are any number of steps up and then down; in-laws are blood kin with one marriage at either end.
 * A route of another shape (two marriages, down and up again) has no term, only its chain of roles.
 */

export type { Lang } from './i18n';
import type { Lang } from './i18n';
/** What the next person on a route is to the previous one. */
export type Step = 'parent' | 'child' | 'spouse';

export interface Kinship {
  /** What the last person is to the first; null when no term fits the route. */
  term: string | null;
  /** The role of each next person to the previous one: «мать → брат → сын». */
  chain: string[];
}

export interface KinshipPeople {
  sex(id: string): Sex;
  /** Known parents of a person; tells half siblings from full ones. */
  parents(id: string): string[];
}

/** What `nodes[last]` is to `nodes[0]` along a route whose `edges[i]` joins `nodes[i]` and `nodes[i + 1]`. */
export function describeRoute(nodes: string[], edges: Edge[], people: KinshipPeople, lang: Lang): Kinship {
  const steps: Step[] = edges.map((edge, index) => edge.relation === 'spouse' ? 'spouse' : edge.from === nodes[index + 1] ? 'parent' : 'child');
  const words = lang === 'ru' ? RU : EN;
  const chain = steps.map((step, index) => words.role(step, people.sex(nodes[index + 1])));
  if (!steps.length) return { term: null, chain };
  const sexes = nodes.map((id) => people.sex(id));
  const adoptive = edges.length === 1 && Boolean(edges[0].adoptive);
  return { term: kinshipTerm(steps, sexes, lang, { adoptive, half: halfSiblings(nodes, steps, people) }), chain };
}

/** Siblings sharing one of their parents: each has two known parents, and only one of them is common. */
function halfSiblings(nodes: string[], steps: Step[], people: KinshipPeople): Sex | null {
  if (steps.length !== 2 || steps[0] !== 'parent' || steps[1] !== 'child') return null;
  const a = people.parents(nodes[0]); const b = people.parents(nodes[2]);
  const shared = a.filter((id) => b.includes(id));
  return a.length === 2 && b.length === 2 && shared.length === 1 ? people.sex(shared[0]) : null;
}

/**
 * The term for a route given by its steps and the sexes of everyone on it (`sexes[0]` the first person). `half` is the
 * sex of the one parent shared by half siblings, `adoptive` marks a single adoption step.
 */
export function kinshipTerm(steps: Step[], sexes: Sex[], lang: Lang, extra: { adoptive?: boolean; half?: Sex | null } = {}): string | null {
  const words = lang === 'ru' ? RU : EN;
  const last = sexes[sexes.length - 1];
  const spouses = steps.filter((step) => step === 'spouse').length;
  if (spouses === 0) {
    const blood = bloodShape(steps);
    return blood ? words.blood(blood.up, blood.down, last, extra) : null;
  }
  if (spouses > 1) return null;
  if (steps.length === 1) return words.role('spouse', last);
  // A step-sibling: a child of a parent's spouse.
  if (steps.length === 3 && steps[0] === 'parent' && steps[1] === 'spouse' && steps[2] === 'child') return words.stepSibling(last);
  if (steps[0] === 'spouse') {
    const blood = bloodShape(steps.slice(1));
    return blood ? words.ofSpouse(blood.up, blood.down, sexes[1], last) : null;
  }
  if (steps[steps.length - 1] === 'spouse') {
    const blood = bloodShape(steps.slice(0, -1));
    return blood ? words.spouseOf(blood.up, blood.down, sexes[sexes.length - 2], last) : null;
  }
  return null;
}

/** Steps up to a common ancestor, then down; null for any other shape. */
function bloodShape(steps: Step[]): { up: number; down: number } | null {
  let up = 0;
  while (up < steps.length && steps[up] === 'parent') up++;
  let down = 0;
  while (up + down < steps.length && steps[up + down] === 'child') down++;
  return up + down === steps.length ? { up, down } : null;
}

interface Words {
  role(step: Step, sex: Sex): string;
  blood(up: number, down: number, sex: Sex, extra: { adoptive?: boolean; half?: Sex | null }): string;
  stepSibling(sex: Sex): string;
  /** A blood relative of the first person's spouse (whose sex is `spouseSex`). */
  ofSpouse(up: number, down: number, spouseSex: Sex, sex: Sex): string;
  /** The spouse of a blood relative (whose sex is `relativeSex`). */
  spouseOf(up: number, down: number, relativeSex: Sex, sex: Sex): string;
}

// Russian: a term is adjectives and a noun, kept apart so they agree in gender and can be put in the genitive.

type Gender = 'm' | 'f';
interface RuTerm { adjectives: string[]; noun: string }

/** Nouns: masculine and feminine, nominative and genitive. */
const RU_NOUNS: Record<string, { m: [string, string]; f: [string, string] }> = {
  parent: { m: ['отец', 'отца'], f: ['мать', 'матери'] },
  child: { m: ['сын', 'сына'], f: ['дочь', 'дочери'] },
  sibling: { m: ['брат', 'брата'], f: ['сестра', 'сестры'] },
  grandparent: { m: ['дедушка', 'дедушки'], f: ['бабушка', 'бабушки'] },
  grandchild: { m: ['внук', 'внука'], f: ['внучка', 'внучки'] },
  uncle: { m: ['дядя', 'дяди'], f: ['тётя', 'тёти'] },
  nephew: { m: ['племянник', 'племянника'], f: ['племянница', 'племянницы'] },
  spouse: { m: ['муж', 'мужа'], f: ['жена', 'жены'] },
};

/** «двоюродный» for first cousins, «троюродный» for second, and so on. */
const RU_DEGREES = ['двоюродный', 'троюродный', 'четвероюродный', 'пятиюродный', 'шестиюродный', 'семиюродный', 'восьмиюродный', 'девятиюродный', 'десятиюродный'];
const ruDegree = (n: number) => RU_DEGREES[n - 1] ?? `${n + 1}-юродный`;

/** An adjective in «-ый» agreeing with the noun. */
function ruAdjective(word: string, gender: Gender, genitive: boolean): string {
  const stem = word.slice(0, -2);
  return gender === 'm' ? (genitive ? `${stem}ого` : word) : (genitive ? `${stem}ой` : `${stem}ая`);
}

function ruNoun(noun: string, gender: Gender, genitive: boolean): string {
  const prefix = noun.match(/^(?:пра)*/)![0];
  const forms = RU_NOUNS[noun.slice(prefix.length)][gender];
  return prefix + forms[genitive ? 1 : 0];
}

function ruWords(term: RuTerm, gender: Gender, genitive: boolean): string {
  return [...term.adjectives.map((word) => ruAdjective(word, gender, genitive)), ruNoun(term.noun, gender, genitive)].join(' ');
}

/** A term for a known sex, or both forms for an unknown one: «двоюродный брат или двоюродная сестра». */
function ruSay(term: RuTerm, sex: Sex, genitive = false): string {
  if (sex === 'unknown') return `${ruWords(term, 'm', genitive)} или ${ruWords(term, 'f', genitive)}`;
  return ruWords(term, sex === 'male' ? 'm' : 'f', genitive);
}

const pra = (count: number) => 'пра'.repeat(Math.max(0, count));

/** A phrase where Russian has no single word: nominative and genitive. */
type RuPhrase = [string, string];

/** Blood kin by steps up and down. */
function ruBlood(up: number, down: number, extra: { adoptive?: boolean; half?: Sex | null } = {}): RuTerm | RuPhrase {
  const adoptive = extra.adoptive ? ['приёмный'] : [];
  if (down === 0) {
    if (up === 1) return { adjectives: adoptive, noun: 'parent' };
    if (up > 5) return [`предок в ${up}-м колене`, `предка в ${up}-м колене`];
    return { adjectives: [], noun: `${pra(up - 2)}grandparent` };
  }
  if (up === 0) {
    if (down === 1) return { adjectives: adoptive, noun: 'child' };
    if (down > 5) return [`потомок в ${down}-м колене`, `потомка в ${down}-м колене`];
    return { adjectives: [], noun: `${pra(down - 2)}grandchild` };
  }
  if (up === down) {
    const half = extra.half === 'male' ? ['единокровный'] : extra.half === 'female' ? ['единоутробный'] : [];
    return up === 1 ? { adjectives: half, noun: 'sibling' } : { adjectives: [ruDegree(up - 1)], noun: 'sibling' };
  }
  if (up > down) {
    // Brother of a parent: дядя; of a grandparent: двоюродный дедушка; cousin of a parent: двоюродный дядя.
    const removed = up - down;
    if (removed === 1) return { adjectives: down > 1 ? [ruDegree(down - 1)] : [], noun: 'uncle' };
    return { adjectives: [ruDegree(down)], noun: `${pra(removed - 2)}grandparent` };
  }
  // Child of a sibling: племянник; grandchild: внучатый племянник; child of a cousin: двоюродный племянник.
  const removed = down - up;
  const degree = up > 1 ? [ruDegree(up - 1)] : [];
  return { adjectives: removed === 1 ? degree : [...degree, `${pra(removed - 2)}внучатый`], noun: 'nephew' };
}

/** Words without a sex: a parent or a child of unknown sex has its own word. */
const RU_NEUTRAL: Record<string, [string, string]> = { parent: ['родитель', 'родителя'], child: ['ребёнок', 'ребёнка'], spouse: ['супруг', 'супруга'] };

function ruSayTerm(term: RuTerm | RuPhrase, sex: Sex, genitive = false): string {
  if (Array.isArray(term)) return term[genitive ? 1 : 0];
  if (sex === 'unknown' && !term.adjectives.length && RU_NEUTRAL[term.noun]) return RU_NEUTRAL[term.noun][genitive ? 1 : 0];
  return ruSay(term, sex, genitive);
}

const ruPick = (sex: Sex, male: string, female: string) => sex === 'male' ? male : sex === 'female' ? female : `${male} или ${female}`;

const RU: Words = {
  role: (step, sex) => ruSayTerm({ adjectives: [], noun: step }, sex),
  blood: (up, down, sex, extra) => ruSayTerm(ruBlood(up, down, extra), sex),
  stepSibling: (sex) => ruPick(sex, 'сводный брат', 'сводная сестра'),
  ofSpouse(up, down, spouseSex, sex) {
    const husband = spouseSex === 'male'; const wife = spouseSex === 'female';
    if (up === 1 && down === 0 && husband) return ruPick(sex, 'свёкор', 'свекровь');
    if (up === 1 && down === 0 && wife) return ruPick(sex, 'тесть', 'тёща');
    if (up === 1 && down === 1 && husband) return ruPick(sex, 'деверь', 'золовка');
    if (up === 1 && down === 1 && wife) return ruPick(sex, 'шурин', 'свояченица');
    if (up === 0 && down === 1) return ruPick(sex, 'пасынок', 'падчерица');
    return `${ruSayTerm(ruBlood(up, down), sex)} ${ruSayTerm({ adjectives: [], noun: 'spouse' }, spouseSex, true)}`;
  },
  spouseOf(up, down, relativeSex, sex) {
    if (up === 1 && down === 0) return ruPick(sex, 'отчим', 'мачеха');
    if (up === 0 && down === 1) return ruPick(sex, 'зять', 'невестка');
    if (up === 1 && down === 1) return ruPick(sex, 'зять', 'невестка');
    return `${ruSayTerm({ adjectives: [], noun: 'spouse' }, sex)} ${ruSayTerm(ruBlood(up, down), relativeSex, true)}`;
  },
};

// English: cousins by degree and removal; greats for direct and collateral lines.

/** 1st, 2nd, 3rd, 4th… */
const ordinal = (n: number) => {
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
};
const EN_DEGREES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
/** «great-», «great-great-», then «3rd great-». */
const greats = (count: number) => count <= 0 ? '' : count === 1 ? 'great-' : count === 2 ? 'great-great-' : `${ordinal(count)} great-`;
const removedTimes = (count: number) => count === 1 ? 'once removed' : count === 2 ? 'twice removed' : `${count} times removed`;

function enPick(sex: Sex, male: string, female: string, neutral: string) { return sex === 'male' ? male : sex === 'female' ? female : neutral; }

function enBlood(up: number, down: number, sex: Sex, extra: { adoptive?: boolean; half?: Sex | null } = {}): string {
  if (down === 0) {
    if (up === 1) return `${extra.adoptive ? 'adoptive ' : ''}${enPick(sex, 'father', 'mother', 'parent')}`;
    return greats(up - 2) + enPick(sex, 'grandfather', 'grandmother', 'grandparent');
  }
  if (up === 0) {
    if (down === 1) return `${extra.adoptive ? 'adopted ' : ''}${enPick(sex, 'son', 'daughter', 'child')}`;
    return greats(down - 2) + enPick(sex, 'grandson', 'granddaughter', 'grandchild');
  }
  if (up === 1 && down === 1) return `${extra.half ? 'half-' : ''}${enPick(sex, 'brother', 'sister', 'sibling')}`;
  if (down === 1) return greats(up - 2) + enPick(sex, 'uncle', 'aunt', 'uncle or aunt');
  if (up === 1) return greats(down - 2) + enPick(sex, 'nephew', 'niece', 'nephew or niece');
  const degree = Math.min(up, down) - 1; const removed = Math.abs(up - down);
  return `${EN_DEGREES[degree - 1] ?? ordinal(degree)} cousin${removed ? ` ${removedTimes(removed)}` : ''}`;
}

const EN: Words = {
  role(step, sex) {
    return step === 'parent' ? enPick(sex, 'father', 'mother', 'parent') : step === 'child' ? enPick(sex, 'son', 'daughter', 'child') : enPick(sex, 'husband', 'wife', 'spouse');
  },
  blood: (up, down, sex, extra) => enBlood(up, down, sex, extra),
  stepSibling: (sex) => enPick(sex, 'stepbrother', 'stepsister', 'stepsibling'),
  ofSpouse(up, down, spouseSex, sex) {
    if (up === 1 && down === 0) return enPick(sex, 'father-in-law', 'mother-in-law', 'parent-in-law');
    if (up === 1 && down === 1) return enPick(sex, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
    if (up === 0 && down === 1) return enPick(sex, 'stepson', 'stepdaughter', 'stepchild');
    return `${enPick(spouseSex, 'husband', 'wife', 'spouse')}'s ${enBlood(up, down, sex)}`;
  },
  spouseOf(up, down, relativeSex, sex) {
    if (up === 1 && down === 0) return enPick(sex, 'stepfather', 'stepmother', 'step-parent');
    if (up === 0 && down === 1) return enPick(sex, 'son-in-law', 'daughter-in-law', 'child-in-law');
    if (up === 1 && down === 1) return enPick(sex, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
    return `${enBlood(up, down, relativeSex)}'s ${enPick(sex, 'husband', 'wife', 'spouse')}`;
  },
};

/**
 * An easter egg for routes with no short term: a saying about distant kin instead of a dry note. Russian only for now;
 * other languages get null and keep the plain note until their own sayings are chosen.
 */
const RU_SAYINGS = [
  'седьмая вода на киселе',
  'десятая вода на киселе',
  'нашему забору двоюродный плетень',
  'нашему слесарю двоюродный кузнец',
  'наши бабушки в одном пруду бельё полоскали',
  'родня по Адаму',
];

/** The same pair always gets the same saying, whichever end is first, so it does not change on every redraw. */
export function kinshipSaying(from: string, to: string, lang: Lang): string | null {
  if (lang !== 'ru') return null;
  const key = [from, to].sort().join('\n');
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return RU_SAYINGS[hash % RU_SAYINGS.length];
}
