import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRoute, kinshipSaying, kinshipTerm, type Lang, type Step } from '../../src/kinship';
import type { Edge } from '../../src/model';
import type { Sex } from '../../src/schema';

const up = (n: number): Step[] => Array(n).fill('parent');
const down = (n: number): Step[] => Array(n).fill('child');
/** Term for a route whose last person has `sex`; everyone else is male unless given. */
const term = (steps: Step[], sex: Sex, lang: Lang = 'ru', sexes: Sex[] = []) =>
  kinshipTerm(steps, [...Array(steps.length).fill('male').map((value, index) => sexes[index] ?? value), sex], lang);

test('Russian: direct line, siblings, uncles and nephews', () => {
  assert.equal(term(up(1), 'female'), 'мать');
  assert.equal(term(up(1), 'unknown'), 'родитель');
  assert.equal(term(up(2), 'male'), 'дедушка');
  assert.equal(term(up(4), 'female'), 'прапрабабушка');
  assert.equal(term(up(7), 'male'), 'предок в 7-м колене');
  assert.equal(term(down(3), 'female'), 'правнучка');
  assert.equal(term([...up(1), ...down(1)], 'female'), 'сестра');
  assert.equal(term([...up(2), ...down(1)], 'female'), 'тётя');
  assert.equal(term([...up(3), ...down(1)], 'male'), 'двоюродный дедушка');
  assert.equal(term([...up(1), ...down(2)], 'female'), 'племянница');
  assert.equal(term([...up(1), ...down(3)], 'male'), 'внучатый племянник');
  assert.equal(term([...up(1), ...down(4)], 'female'), 'правнучатая племянница');
});

test('Russian: cousins of every degree and removal', () => {
  assert.equal(term([...up(2), ...down(2)], 'male'), 'двоюродный брат');
  assert.equal(term([...up(3), ...down(3)], 'female'), 'троюродная сестра');
  assert.equal(term([...up(7), ...down(7)], 'male'), 'семиюродный брат');
  assert.equal(term([...up(3), ...down(2)], 'male'), 'двоюродный дядя');
  assert.equal(term([...up(4), ...down(2)], 'female'), 'троюродная бабушка');
  assert.equal(term([...up(2), ...down(3)], 'male'), 'двоюродный племянник');
  assert.equal(term([...up(3), ...down(5)], 'female'), 'троюродная внучатая племянница');
  assert.equal(term([...up(2), ...down(2)], 'unknown'), 'двоюродный брат или двоюродная сестра');
});

test('Russian: in-laws, step relatives and spouses of relatives', () => {
  assert.equal(term(['spouse'], 'female'), 'жена');
  assert.equal(term(['spouse', 'parent'], 'female', 'ru', ['female', 'male']), 'свекровь');
  assert.equal(term(['spouse', 'parent'], 'male', 'ru', ['male', 'female']), 'тесть');
  assert.equal(term(['spouse', 'parent', 'child'], 'male', 'ru', ['male', 'female']), 'шурин');
  assert.equal(term(['spouse', 'parent', 'child'], 'female', 'ru', ['female', 'male']), 'золовка');
  assert.equal(term(['spouse', 'child'], 'female'), 'падчерица');
  assert.equal(term(['spouse', ...up(2), ...down(2)], 'male', 'ru', ['male', 'female']), 'двоюродный брат жены');
  assert.equal(term(['parent', 'spouse'], 'female'), 'мачеха');
  assert.equal(term(['child', 'spouse'], 'male'), 'зять');
  assert.equal(term(['parent', 'child', 'spouse'], 'female'), 'невестка');
  assert.equal(term([...up(2), ...down(2), 'spouse'], 'male', 'ru', ['male', 'male', 'male', 'male', 'female']), 'муж двоюродной сестры');
  assert.equal(term(['parent', 'spouse', 'child'], 'male'), 'сводный брат');
});

test('no term for routes of another shape', () => {
  assert.equal(term(['child', 'parent'], 'female'), null);
  assert.equal(term(['spouse', 'parent', 'spouse'], 'female'), null);
  assert.equal(term(['parent', 'spouse', 'parent'], 'male'), null);
});

test('English: direct line, cousins with removal, in-laws', () => {
  assert.equal(term(up(1), 'male', 'en'), 'father');
  assert.equal(term(up(3), 'female', 'en'), 'great-grandmother');
  assert.equal(term(up(6), 'male', 'en'), '4th great-grandfather');
  assert.equal(term(down(2), 'unknown', 'en'), 'grandchild');
  assert.equal(term([...up(3), ...down(1)], 'male', 'en'), 'great-uncle');
  assert.equal(term([...up(1), ...down(3)], 'female', 'en'), 'great-niece');
  assert.equal(term([...up(2), ...down(2)], 'female', 'en'), 'first cousin');
  assert.equal(term([...up(3), ...down(2)], 'male', 'en'), 'first cousin once removed');
  assert.equal(term([...up(4), ...down(7)], 'male', 'en'), 'third cousin 3 times removed');
  assert.equal(term(['spouse', 'parent'], 'female', 'en'), 'mother-in-law');
  assert.equal(term(['spouse', ...up(2), ...down(2)], 'male', 'en', ['male', 'female']), "wife's first cousin");
  assert.equal(term([...up(2), ...down(2), 'spouse'], 'female', 'en'), "first cousin's wife");
  assert.equal(term(['parent', 'spouse'], 'male', 'en'), 'stepfather');
});

test('a route reads its steps from edge directions, with roles, half siblings and adoption', () => {
  const sexes: Record<string, Sex> = { me: 'female', mom: 'female', dad: 'male', other: 'female', bro: 'male', kid: 'male' };
  const parents: Record<string, string[]> = { me: ['mom', 'dad'], bro: ['dad', 'other'] };
  const people = { sex: (id: string) => sexes[id] ?? 'unknown', parents: (id: string) => parents[id] ?? [] };
  const parent = (from: string, to: string, adoptive = false): Edge => ({ from, to, relation: 'parent', ...(adoptive ? { adoptive } : {}) });
  const half = describeRoute(['me', 'dad', 'bro'], [parent('dad', 'me'), parent('dad', 'bro')], people, 'ru');
  assert.deepEqual(half, { term: 'единокровный брат', chain: ['отец', 'сын'] });
  assert.equal(describeRoute(['me', 'dad', 'bro'], [parent('dad', 'me'), parent('dad', 'bro')], people, 'en').term, 'half-brother');
  // Reversed, the same route says what the first person is to the second.
  assert.deepEqual(describeRoute(['bro', 'dad', 'me'], [parent('dad', 'bro'), parent('dad', 'me')], people, 'ru'), { term: 'единокровная сестра', chain: ['отец', 'дочь'] });
  assert.equal(describeRoute(['kid', 'me'], [parent('me', 'kid', true)], people, 'ru').term, 'приёмная мать');
  assert.equal(describeRoute(['me', 'kid'], [parent('me', 'kid', true)], people, 'en').term, 'adopted son');
});

test('a route with no short term gets a saying, the same for the pair either way, Russian only', () => {
  const saying = kinshipSaying('a.md', 'b.md', 'ru');
  assert.ok(saying);
  assert.equal(kinshipSaying('b.md', 'a.md', 'ru'), saying);
  const all = new Set(Array.from({ length: 200 }, (_, index) => kinshipSaying(`p${index}`, 'q', 'ru')));
  assert.ok(all.size > 3, 'different pairs get different sayings');
  assert.equal(kinshipSaying('a.md', 'b.md', 'en'), null);
});
