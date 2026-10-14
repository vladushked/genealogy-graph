import assert from 'node:assert/strict';
import test from 'node:test';
import { ancestry, applyCuts, kinAround, buildGraph, hiddenBehind, proposeCut, reachable, shortestPath, isDeceased, lifeYears, type RawPerson } from '../../src/model';
import { setLanguage } from '../../src/i18n';

// Messages and labels below are the Russian ones.
setLanguage('ru');

/** The generation argument documents the family; the graph computes generations itself. */
const person = (id: string, _generation: number, fields: Partial<RawPerson> = {}): RawPerson => ({
  id, name: id, ancestors: [], descendants: [], spouses: [], ...fields,
});
const resolve = (link: string) => link;

test('deduplicates reciprocal parents and spouses; a link that skips a generation is drawn and reported', () => {
  const graph = buildGraph([
    person('grand', -2, { descendants: ['[[parent]]', '[[child]]'] }),
    person('parent', -1, { ancestors: ['[[grand]]'], descendants: ['[[child]]'], spouses: ['[[partner]]'] }),
    person('partner', -1, { spouses: ['[[parent]]'] }),
    person('child', 0, { ancestors: ['[[parent]]', '[[grand]]', '[[child]]', '[[missing]]'] }),
  ], resolve);
  assert.equal(graph.edges.filter((edge) => edge.relation === 'parent').length, 3);
  assert.equal(graph.edges.filter((edge) => edge.relation === 'spouse').length, 1);
  assert.deepEqual(new Set(graph.issues.map((issue) => issue.reason)), new Set(['generation', 'self', 'missing']));
  const skip = graph.issues.find((issue) => issue.reason === 'generation')!;
  assert.deepEqual([skip.source, skip.targetId], ['child', 'grand'], 'the shortcut is reported, not the chain');
  const generation = new Map(graph.people.map((item) => [item.id, item.generation]));
  assert.deepEqual([generation.get('grand'), generation.get('parent'), generation.get('partner'), generation.get('child')], [-2, -1, -1, 0]);
});

test('focus traversal always includes spouses', () => {
  const graph = buildGraph([
    person('a', -1, { descendants: ['[[b]]'], spouses: ['[[s]]'] }),
    person('s', -1), person('b', 0, { descendants: ['[[c]]'] }), person('c', 1), person('island', 0),
  ], resolve);
  assert.deepEqual(reachable(graph, new Set(['b'])), new Set(['a', 'b', 'c', 's']));
  assert.deepEqual(reachable(graph, new Set(['b']), 1), new Set(['a', 'b', 'c']));
});

test('an empty death date means alive; any value, even an unknown one, means deceased', () => {
  for (const value of ['', ' ', null, undefined]) assert.equal(isDeceased(value), false);
  for (const value of ['1945-01-20', '1915?', 1980, '?', 'неизвестно']) assert.equal(isDeceased(value), true);
});

test('life year labels: living people show a birth year only, unknown years keep a question mark', () => {
  assert.equal(lifeYears('1923-05-15', '1983-06-11'), '1923–1983');
  assert.equal(lifeYears('1915?', ''), 'р. 1915?');
  assert.equal(lifeYears('2001-03-01', null), 'р. 2001');
  assert.equal(lifeYears('1915', '?'), '1915–?');
  assert.equal(lifeYears(null, 1945), '?–1945');
  assert.equal(lifeYears(undefined, undefined), '');
  assert.equal(lifeYears(undefined, '?'), '?–?');
});

test('shortest path follows parent and spouse links in either direction', () => {
  const graph = buildGraph([
    person('a', -2, { descendants: ['[[b]]'] }),
    person('b', -1, { spouses: ['[[s]]'], descendants: ['[[c]]'] }),
    person('s', -1, { descendants: ['[[d]]'] }),
    person('c', 0), person('d', 0), person('island', 0),
  ], resolve);
  const path = shortestPath(graph, 'a', 'd');
  assert.deepEqual(path?.nodes, ['a', 'b', 's', 'd']);
  assert.deepEqual(path?.edges.map((edge) => edge.relation), ['parent', 'spouse', 'parent']);
  assert.deepEqual(shortestPath(graph, 'd', 'a')?.nodes, ['d', 's', 'b', 'a']);
  assert.equal(shortestPath(graph, 'a', 'island'), null);
});

test('among routes of one length, the shortest path takes the one with fewer marriages', () => {
  // The child reached through its mother's husband or through its own father: the father wins.
  const graph = buildGraph([
    person('me', 0, { ancestors: ['[[father]]'], spouses: ['[[wife]]'] }),
    person('wife', 0, { descendants: ['[[child]]'] }),
    person('father', -1, { descendants: ['[[child]]'] }),
    person('child', 1),
  ], resolve);
  assert.deepEqual(shortestPath(graph, 'me', 'child')?.nodes, ['me', 'father', 'child']);
  assert.deepEqual(shortestPath(graph, 'child', 'me')?.nodes, ['child', 'father', 'me']);
});

test('approximate years and decades are shown instead of an unknown year', () => {
  assert.equal(lifeYears('~1915', 'около 1980'), '1915?–1980?');
  assert.equal(lifeYears('ок. 1890', '1910-е'), '1890?–1910-е');
  assert.equal(lifeYears('весна', '1950-е гг.'), '?–1950-е');
});

test('a generation mismatch declared from both notes is reported once', () => {
  const graph = buildGraph([
    person('old', -2, { descendants: ['[[young]]', '[[mid]]'] }),
    person('mid', -1, { descendants: ['[[young]]'] }),
    person('young', 0, { ancestors: ['[[old]]'] }),
  ], resolve);
  assert.equal(graph.issues.filter((issue) => issue.reason === 'generation').length, 1);
});

const family = () => buildGraph([
  person('grand', -2, { descendants: ['[[father]]', '[[uncle]]'] }),
  person('father', -1, { descendants: ['[[me]]', '[[sister]]', '[[brother]]'], spouses: ['[[mother]]'] }),
  person('mother', -1, { descendants: ['[[me]]', '[[sister]]', '[[brother]]'] }),
  person('uncle', -1), person('me', 0), person('sister', 0), person('brother', 0), person('island', 0),
], resolve);

test('cutting the link to a grandparent hides that side and keeps the whole nuclear family', () => {
  const graph = family();
  const link = graph.edges.find((edge) => edge.from === 'grand' && edge.to === 'father')!;
  const proposal = proposeCut(graph, [link], ['grand'], ['father'], ['me'])!;
  assert.deepEqual(proposal.cut.hide, ['grand']);
  const all = new Set(graph.people.map((p) => p.id));
  const { hidden } = applyCuts(graph, [proposal.cut], all, new Set(['me']));
  assert.deepEqual(hidden, new Set(['grand', 'uncle']));
  const counts = hiddenBehind(graph, new Set([...all].filter((id) => !hidden.has(id))));
  assert.equal(counts.get('father'), 2);
  assert.equal(counts.has('mother'), false);
});

test('a link that does not separate anything is not cut', () => {
  const graph = family();
  const spouse = graph.edges.find((edge) => edge.relation === 'spouse')!;
  assert.equal(proposeCut(graph, [spouse], ['father'], ['mother'], ['me']), null); // Still linked through the children.
});

test('without a center the smaller side is hidden', () => {
  const graph = family();
  const link = graph.edges.find((edge) => edge.from === 'grand' && edge.to === 'uncle')!;
  assert.deepEqual(proposeCut(graph, [link], ['grand'], ['uncle'], [])!.cut.hide, ['uncle']);
});

test('depth-limited views report hidden relatives behind the boundary', () => {
  const graph = family();
  const visible = reachable(graph, new Set(['me']), 1);
  const counts = hiddenBehind(graph, visible);
  assert.equal(counts.get('father'), 4); // grand and uncle, plus the siblings two steps away
  assert.equal(counts.get('mother'), 2); // the siblings
  assert.equal(counts.has('me'), false);
});

test('generations count from the anchor; other families end at 0; in-laws stand beside their spouse', () => {
  const graph = buildGraph([
    person('grand', -2, { descendants: ['[[father]]'] }),
    person('father', -1, { spouses: ['[[mother]]'], descendants: ['[[me]]'] }),
    person('mother', -1, { descendants: ['[[me]]'] }),
    person('me', 0, { descendants: ['[[son]]'] }), person('son', 1),
    person('other', 0, { descendants: ['[[other-child]]'] }), person('other-child', 0),
  ], resolve, 'me');
  const generation = new Map(graph.people.map((item) => [item.id, item.generation]));
  assert.deepEqual(['grand', 'father', 'mother', 'me', 'son'].map((id) => generation.get(id)), [-2, -1, -1, 0, 1]);
  assert.deepEqual([generation.get('other'), generation.get('other-child')], [-1, 0]);
  assert.equal(graph.issues.length, 0);
  const fromGrand = buildGraph([person('grand', 0, { descendants: ['[[father]]'] }), person('father', 0)], resolve, 'grand');
  assert.deepEqual(fromGrand.people.map((item) => item.generation), [0, 1]);
});

test('a parent cycle in the data ends and is reported', () => {
  const graph = buildGraph([person('a', 0, { descendants: ['[[b]]'] }), person('b', 0, { descendants: ['[[a]]'] })], resolve);
  assert.equal(graph.issues.filter((issue) => issue.reason === 'generation').length, 1);
});

test('both cards of a generation conflict are marked, a missing link marks only its source', async () => {
  const { problemPeople } = await import('../../src/model');
  const graph = buildGraph([
    person('parent', 0, { descendants: ['[[skip]]', '[[nobody]]', '[[child]]'] }),
    person('skip', 2), person('child', 1, { descendants: ['[[skip]]'] }),
  ], resolve);
  const marked = problemPeople(graph.issues);
  assert.deepEqual([...marked.keys()].sort(), ['parent', 'skip']);
  assert.equal(marked.get('parent')!.length, 2);
  assert.equal(marked.get('skip')![0].reason, 'generation');
});

test('ancestry climbs every parent line from the roots, sharing common ancestors', () => {
  const graph = buildGraph([
    person('gp', -2, { descendants: ['[[dad]]', '[[uncle]]'], spouses: ['[[gm]]'] }),
    person('gm', -2, { descendants: ['[[dad]]'] }),
    person('dad', -1, { descendants: ['[[me]]', '[[sis]]'], spouses: ['[[mom]]'] }),
    person('mom', -1, { descendants: ['[[me]]', '[[sis]]'] }),
    person('uncle', -1, { descendants: ['[[cousin]]'] }), person('cousin', 0),
    person('me', 0, { descendants: ['[[kid]]'] }), person('sis', 0), person('kid', 1),
  ], resolve);
  const tree = ancestry(graph, ['me', 'sis']);
  assert.deepEqual(new Set(tree.nodes), new Set(['me', 'sis', 'dad', 'mom', 'gp', 'gm']));
  assert.equal(tree.edges.length, 6, 'two parents each for me, sis and dad');
  assert.deepEqual(tree.nodes.slice(0, 2), ['me', 'sis']);
});

test('kin around counts generations; a marriage takes no step', () => {
  const graph = buildGraph([
    person('gp', -2, { descendants: ['[[dad]]', '[[uncle]]'] }),
    person('dad', -1, { descendants: ['[[me]]'] }),
    person('uncle', -1, { descendants: ['[[cousin]]'], spouses: ['[[aunt]]'] }), person('aunt', -1),
    person('cousin', 0, { spouses: ['[[cousin-wife]]'] }), person('cousin-wife', 0), person('me', 0),
  ], resolve);
  const trunk = ancestry(graph, ['me']).nodes;
  assert.deepEqual(kinAround(graph, trunk, 0), new Set(['me', 'dad', 'gp']));
  assert.deepEqual(kinAround(graph, trunk, 1), new Set(['me', 'dad', 'gp', 'uncle', 'aunt']));
  assert.deepEqual(kinAround(graph, trunk, 2), new Set(['me', 'dad', 'gp', 'uncle', 'aunt', 'cousin', 'cousin-wife']));
});
