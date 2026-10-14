import assert from 'node:assert/strict';
import test from 'node:test';
import type { Edge } from '../../src/model';
import { familyShape, groupFamilies, renderSvg, sceneBounds, type Scene, type SceneNode } from '../../src/scene';

const parent = (from: string, to: string): Edge => ({ from, to, relation: 'parent' });
const spouse = (from: string, to: string): Edge => ({ from, to, relation: 'spouse' });
const node = (id: string, x: number, y: number): SceneNode => ({ id, name: id, generation: 0, x, y, color: '#fff' });

test('children are grouped per couple, so each marriage gets its own family', () => {
  const { families, direct } = groupFamilies([
    spouse('father', 'first'), spouse('father', 'second'),
    parent('father', 'a'), parent('first', 'a'), parent('father', 'b'), parent('first', 'b'),
    parent('father', 'c'), parent('second', 'c'),
    parent('mother', 'lone'),
  ]);
  const byParents = new Map(families.map((family) => [family.parents.join('+'), family.children.sort()]));
  assert.deepEqual(byParents.get('father+first'), ['a', 'b']);
  assert.deepEqual(byParents.get('father+second'), ['c']);
  assert.equal(families.length, 2);
  assert.deepEqual(direct.map((edge) => `${edge.relation}:${edge.from}:${edge.to}`).sort(),
    ['parent:mother:lone', 'spouse:father:first', 'spouse:father:second']);
  assert.ok(families.every((family) => !family.implicit));
});

test('parents without a spouse link form an implicit family; a single parent with several children gets a stem', () => {
  const { families } = groupFamilies([parent('x', 'k'), parent('y', 'k'), parent('solo', 'm'), parent('solo', 'n')]);
  assert.equal(families.find((family) => family.parents.length === 2)?.implicit, true);
  assert.deepEqual(families.find((family) => family.parents[0] === 'solo')?.children, ['m', 'n']);
});

test('branches start in the middle between the parents and one reaches each child', () => {
  const nodes = new Map([node('p', -50, 0), node('q', 50, 0), node('a', -60, 200), node('b', 60, 200)].map((item) => [item.id, item]));
  const { families } = groupFamilies([spouse('p', 'q'), parent('p', 'a'), parent('q', 'a'), parent('p', 'b'), parent('q', 'b')]);
  const shape = familyShape(families[0], nodes)!;
  assert.equal(shape.stem, null);
  assert.ok(Math.abs(shape.hub.x) < 1e-9 && Math.abs(shape.hub.y) < 1e-9);
  assert.equal(shape.branches.length, 2);
  for (const branch of shape.branches) {
    const child = nodes.get(branch.child)!;
    assert.ok(Math.abs(Math.hypot(branch.end.x - child.x, branch.end.y - child.y) - 22) < 1e-9);
  }
});

test('an only child of a couple gets a single straight line without a stem', () => {
  const nodes = new Map([node('p', -50, 0), node('q', 50, 0), node('a', 0, 200)].map((item) => [item.id, item]));
  const { families } = groupFamilies([spouse('p', 'q'), parent('p', 'a'), parent('q', 'a')]);
  const shape = familyShape(families[0], nodes)!;
  assert.equal(shape.stem, null);
  assert.equal(shape.branches.length, 1);
});

test('SVG export draws one branch per child instead of one line per parent', () => {
  const scene: Scene = {
    nodes: [node('p', -50, 0), node('q', 50, 0), node('a', -60, 200), node('b', 60, 200)],
    edges: [spouse('p', 'q'), parent('p', 'a'), parent('q', 'a'), parent('p', 'b'), parent('q', 'b')],
  };
  const svg = renderSvg(scene, sceneBounds(scene), 400, 300);
  assert.equal(svg.match(/marker-end="url\(#arrow\)"/g)?.length, 2);
  assert.doesNotMatch(svg, /<circle cx="[^"]+" cy="[^"]+" r="3"/);
});

test('a route entering a family through one parent is drawn over that half of the couple', () => {
  const route = (edge: Edge) => ({ ...edge, pathHighlighted: true });
  const scene: Scene = {
    nodes: [node('p', -50, 0), node('q', 50, 0), node('a', -60, 200), node('b', 60, 200)],
    edges: [spouse('p', 'q'), route(parent('p', 'a')), parent('q', 'a'), parent('p', 'b'), parent('q', 'b')],
  };
  const svg = renderSvg(scene, sceneBounds(scene), 400, 300);
  // The half runs from p's circle (x = -28) to the middle of the couple (x = 0).
  assert.match(svg, /<line x1="-28" y1="0" x2="0" y2="0" stroke="#ffdc69"/);
  assert.doesNotMatch(svg, /<line x1="28" y1="0" x2="0" y2="0" stroke="#ffdc69"/);
});

test('straight lines fan out from a lone parent center and from the middle of a couple ribbon', () => {
  const lone = groupFamilies([parent('p', 'a'), parent('p', 'b'), parent('p', 'c')]).families[0];
  const loneShape = familyShape(lone, new Map([node('p', 0, 0), node('a', 100, 0), node('b', 0, 100), node('c', -100, 0)].map((n) => [n.id, n])))!;
  assert.equal(loneShape.stem, null);
  assert.ok(loneShape.branches.every((branch) => branch.start.x === 0 && branch.start.y === 0 && /^M[^QC]*L[^QC]*$/.test(branch.path)));

  const couple = groupFamilies([spouse('f', 'm'), parent('f', 'a'), parent('m', 'a'), parent('f', 'b'), parent('m', 'b')]).families[0];
  const coupleShape = familyShape(couple, new Map([node('f', -50, 0), node('m', 50, 0), node('a', -80, 200), node('b', 80, 200)].map((n) => [n.id, n])))!;
  assert.equal(coupleShape.stem, null);
  assert.ok(coupleShape.branches.every((branch) => branch.start.x === 0 && branch.start.y === 0 && /^M[^QC]*L[^QC]*$/.test(branch.path)));
});
