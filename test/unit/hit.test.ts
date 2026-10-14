import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceToSegment, hitTest, LINK_REACH, type HitNode } from '../../src/hit';

const node = (id: string, x: number, y: number, radius = 20, badge: HitNode['badge'] = null): HitNode => ({ id, x, y, radius, badge });

test('distance to a segment is measured to its nearest point, not to the infinite line', () => {
  assert.equal(distanceToSegment(5, 3, 0, 0, 10, 0), 3);
  assert.equal(distanceToSegment(14, 3, 0, 0, 10, 0), 5);
  assert.equal(distanceToSegment(2, 2, 1, 1, 1, 1), Math.SQRT2);
});

test('people drawn later win, badges sit above people, and the eye above everything', () => {
  const nodes = [node('below', 0, 0), node('above', 10, 0, 20, { x: 14, y: -14, width: 22 })];
  assert.deepEqual(hitTest(5, 0, 1, nodes, [], null), { kind: 'node', id: 'above' });
  assert.deepEqual(hitTest(-15, 0, 1, nodes, [], null), { kind: 'node', id: 'below' });
  assert.deepEqual(hitTest(24, -14, 1, nodes, [], null), { kind: 'badge', id: 'above' });
  assert.deepEqual(hitTest(5, 0, 1, nodes, [], { x: 8, y: 0 }), { kind: 'eye' });
});

test('links are hit within their reach, the nearest wins, and people cover links', () => {
  const links = [{ id: 'a', x1: 0, y1: 0, x2: 100, y2: 0 }, { id: 'b', x1: 0, y1: 8, x2: 100, y2: 8 }];
  assert.deepEqual(hitTest(50, 2, 1, [], links, null), { kind: 'link', id: 'a' });
  assert.deepEqual(hitTest(50, 6, 1, [], links, null), { kind: 'link', id: 'b' });
  assert.equal(hitTest(50, -LINK_REACH - 1, 1, [], links, null), null);
  assert.deepEqual(hitTest(0, 0, 1, [node('p', 0, 0)], links, null), { kind: 'node', id: 'p' });
});

test('the eye keeps its screen size at any zoom', () => {
  assert.deepEqual(hitTest(5, 0, 0.5, [], [], { x: 0, y: 0 }), { kind: 'eye' });
  assert.equal(hitTest(5, 0, 4, [], [], { x: 0, y: 0 }), null);
});
