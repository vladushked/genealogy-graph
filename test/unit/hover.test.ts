import assert from 'node:assert/strict';
import test from 'node:test';
import { hoverIndex } from '../../src/hover';
import { groupFamilies } from '../../src/scene';
import type { Graph } from '../../src/model';

const graph: Graph = {
  people: ['p', 'q', 'c', 'd', 'island'].map((id) => ({ id, name: id, generation: null })),
  edges: [
    { from: 'p', to: 'q', relation: 'spouse' },
    ...['p', 'q'].flatMap((from) => ['c', 'd'].map((to) => ({ from, to, relation: 'parent' as const }))),
  ],
  issues: [],
};

test('child hover highlights only its parents and branch; parent hover includes spouse and all children', () => {
  const grouped = groupFamilies(graph.edges);
  const family = grouped.families[0];
  const index = hoverIndex(graph, new Map(graph.people.map((node) => [node.id, node.id])),
    grouped.direct.map((edge) => ({ edge, element: 'spouse' })), [
      { family, stem: 'stem', hub: 'hub', connector: null, branches: [{ child: 'c', element: 'c-branch' }, { child: 'd', element: 'd-branch' }] },
    ]);
  assert.deepEqual(index.get('c'), new Set(['c', 'p', 'q', 'stem', 'hub', 'c-branch']));
  assert.deepEqual(index.get('p'), new Set(['p', 'q', 'c', 'd', 'spouse', 'stem', 'hub', 'c-branch', 'd-branch']));
  assert.deepEqual(index.get('island'), new Set(['island']));
});

test('hidden relatives have no drawing reference and implicit family connectors are highlighted', () => {
  const family = groupFamilies(graph.edges.filter((edge) => edge.relation === 'parent')).families[0];
  const index = hoverIndex(graph, new Map([['p', 'p'], ['q', 'q'], ['c', 'c']]), [], [
    { family: { ...family, children: ['c'] }, stem: 'stem', hub: 'hub', connector: 'union', branches: [{ child: 'c', element: 'c-branch' }] },
  ]);
  assert.equal(index.has('d'), false);
  assert.equal(index.get('p')?.has('d'), false);
  assert.equal(index.get('c')?.has('union'), true);
});
