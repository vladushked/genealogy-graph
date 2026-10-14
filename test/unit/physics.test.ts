import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhysics, spouseRows, type FromPhysics, type PhysicsNode } from '../../src/physics';

function harness() {
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const messages: FromPhysics[] = [];
  const handle = createPhysics((message) => messages.push(message), {
    request(callback) { frames.set(++nextId, callback); return nextId; },
    cancel(id) { frames.delete(id); },
    now: () => 0,
  });
  let time = 0;
  const run = (count: number) => { for (let i = 0; i < count && frames.size; i++) { time += 1000 / 60; const queued = [...frames.values()]; frames.clear(); for (const callback of queued) callback(time); } };
  return { handle, messages, frames, run, last: () => messages[messages.length - 1] };
}
const node = (id: string, x: number, y: number): PhysicsNode => ({ id, x, y, radius: 22, selected: false });
const at = (message: FromPhysics, index: number) => ({ x: message.positions[index * 2], y: message.positions[index * 2 + 1] });

test('reports coordinates per frame in graph order and goes to sleep when cool', () => {
  const h = harness();
  h.handle({ type: 'graph', version: 1, nodes: [node('a', 0, 0), node('b', 10, 0)], links: [{ source: 'a', target: 'b', relation: 'spouse' }] });
  h.handle({ type: 'reheat', alpha: 1, cold: true });
  h.run(1);
  assert.equal(h.last().version, 1);
  assert.equal(h.last().positions.length, 4);
  assert.equal(h.last().running, true);
  h.run(1000);
  assert.equal(h.frames.size, 0, 'no work at rest');
  assert.equal(h.last().running, false);
  const a = at(h.last(), 0); const b = at(h.last(), 1);
  // Spouses settle side by side, almost touching (radii 22 + 22 + a small gap), and level.
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 52) < 6, `spouses sit next to each other: ${Math.hypot(b.x - a.x, b.y - a.y)}`);
  assert.ok(Math.abs(b.y - a.y) < 2, 'spouses are level');
});

test('a pinned node follows the pointer while the graph stays awake, and the layout sleeps after release', () => {
  const h = harness();
  h.handle({ type: 'graph', version: 1, nodes: [node('a', 0, 0), node('b', 100, 0)], links: [{ source: 'a', target: 'b', relation: 'parent' }] });
  h.handle({ type: 'reheat', alpha: 0.3, cold: false });
  h.handle({ type: 'fix', id: 'a', x: 500, y: 200 });
  h.handle({ type: 'hold' });
  h.run(600);
  assert.deepEqual(at(h.last(), 0), { x: 500, y: 200 });
  assert.ok(h.frames.size > 0, 'dragging keeps the simulation running');
  h.handle({ type: 'fix', id: 'a', x: null, y: null });
  h.handle({ type: 'release' });
  h.run(2000);
  assert.equal(h.frames.size, 0);
  assert.equal(h.last().running, false);
});

test('a new graph keeps the simulated state of known people and places new ones where asked', () => {
  const h = harness();
  h.handle({ type: 'graph', version: 1, nodes: [node('a', 0, 0), node('b', 300, 0)], links: [] });
  h.handle({ type: 'reheat', alpha: 1, cold: true });
  h.run(1000);
  const settled = at(h.last(), 1);
  h.handle({ type: 'graph', version: 2, nodes: [node('c', -500, 400), node('b', -999, -999)], links: [] });
  h.handle({ type: 'reheat', alpha: 0.001, cold: false });
  h.run(1);
  assert.equal(h.last().version, 2);
  const c = at(h.last(), 0); const b = at(h.last(), 1);
  assert.ok(Math.hypot(c.x + 500, c.y - 400) < 5, 'new node starts at the given place');
  assert.ok(Math.hypot(b.x - settled.x, b.y - settled.y) < 5, 'known node keeps its simulated place, not the sent one');
});

test('spouses stay together among other relatives, despite the spacing between people', () => {
  const h = harness();
  const nodes = [node('f', 0, 0), node('m', 0, 80), node('c1', 100, 200), node('c2', -100, 200), node('g', 50, -200)];
  const links = [{ source: 'f', target: 'm', relation: 'spouse' as const }, ...['c1', 'c2'].flatMap((child) => ['f', 'm'].map((parent) => ({ source: parent, target: child, relation: 'parent' as const }))), { source: 'g', target: 'f', relation: 'parent' as const }];
  h.handle({ type: 'graph', version: 1, nodes, links });
  h.handle({ type: 'reheat', alpha: 1, cold: true });
  h.run(1000);
  const f = at(h.last(), 0); const m = at(h.last(), 1);
  assert.ok(Math.hypot(m.x - f.x, m.y - f.y) < 60, `couple apart by ${Math.hypot(m.x - f.x, m.y - f.y)}`);
  assert.ok(Math.abs(m.y - f.y) < 10, 'couple is level');
});

test('a dragged person keeps the spouse beside them, at the couple distance', () => {
  const h = harness();
  h.handle({ type: 'graph', version: 1, nodes: [node('a', 0, 0), node('b', 52, 0), node('c', 0, 300)], links: [{ source: 'a', target: 'b', relation: 'spouse' }, { source: 'a', target: 'c', relation: 'parent' }] });
  h.handle({ type: 'reheat', alpha: 0.3, cold: false });
  h.handle({ type: 'hold' });
  for (let step = 1; step <= 60; step++) {
    h.handle({ type: 'fix', id: 'a', x: step * 15, y: step * 9 });
    h.run(1);
    const a = at(h.last(), 0); const b = at(h.last(), 1);
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 52) < 0.01, `step ${step}: ${Math.hypot(b.x - a.x, b.y - a.y)}`);
  }
});

test('a chain of remarriages is one row, walked from its left end; others stay alone', () => {
  const spouse = (source: string, target: string) => ({ source, target, relation: 'spouse' as const });
  const rows = spouseRows([{ id: 'b', x: 0 }, { id: 'a', x: -50 }, { id: 'c', x: 40 }, { id: 'k', x: 0 }],
    [spouse('a', 'b'), spouse('b', 'c'), { source: 'a', target: 'k', relation: 'parent' as const }]);
  assert.deepEqual(rows, [['a', 'b', 'c'], ['k']]);
});
