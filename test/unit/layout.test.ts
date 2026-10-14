import assert from 'node:assert/strict';
import test from 'node:test';
import { forceSimulation } from 'd3-force';
import { LiveLayout, selectionForce } from '../../src/layout';
import type { SceneNode } from '../../src/scene';

test('selected nodes pull together without fixed positions or moving unselected nodes', () => {
  const nodes: SceneNode[] = [
    { id: 'a', name: 'А', generation: 1, x: 0, y: 0, color: '#fff', radius: 22, selected: true },
    { id: 'b', name: 'Б', generation: 1, x: 300, y: 0, color: '#fff', radius: 22, selected: true },
    { id: 'c', name: 'В', generation: 1, x: 600, y: 0, color: '#fff', radius: 22 },
  ];
  forceSimulation(nodes).force('magnets', selectionForce(nodes)).stop().tick(100);
  assert.ok(nodes[0].x > 0);
  assert.ok(nodes[1].x < 300);
  assert.ok(nodes[1].x - nodes[0].x < 100);
  assert.equal(nodes[2].x, 600);
  assert.equal('fx' in nodes[0], false);
  assert.equal('fx' in nodes[1], false);
});

function harness(now = () => 0) {
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const nodes: Array<{ x: number; y: number; vx: number; vy: number; fx?: number | null; fy?: number | null }> = [{ x: 0, y: 0, vx: 1, vy: 0 }];
  const simulation = forceSimulation(nodes).stop();
  let ticks = 0; let paints = 0;
  const tick = simulation.tick;
  simulation.tick = (iterations) => { ticks += iterations ?? 1; return tick(iterations); };
  const phases: boolean[] = [];
  const layout = new LiveLayout(simulation, () => paints++, (): void => { phases.push(layout.expanding); }, {
    request(callback) { frames.set(++nextId, callback); return nextId; },
    cancel(id) { frames.delete(id); },
    now,
  });
  const frame = (time: number) => {
    const queued = [...frames.values()]; frames.clear();
    for (const callback of queued) callback(time);
  };
  return { layout, simulation, nodes, frames, phases, frame, ticks: () => ticks, paints: () => paints };
}

test('expands for half a second and settles in 2 seconds independently of display refresh rate', () => {
  for (const hz of [30, 60, 120]) {
    const h = harness();
    h.layout.reheat(1, true);
    let time = 0;
    for (; time < 7000 && h.frames.size; time += 1000 / hz) h.frame(time);
    assert.equal(h.ticks(), 120, `${hz} Hz`);
    assert.ok(Math.abs(time - 2000) < 100, `${hz} Hz finished at ${time} ms`);
    assert.deepEqual(h.phases, [true, false]);
    assert.equal(h.frames.size, 0);
    const paints = h.paints();
    h.frame(8000);
    assert.equal(h.paints(), paints, 'no idle painting');
  }
});

test('keeps cooling and damping continuous when the camera starts following after expansion', () => {
  const h = harness();
  h.layout.reheat(1, true);
  const decay = h.simulation.alphaDecay();
  for (let i = 0; i < 29; i++) h.frame(i * 1000 / 60);
  assert.equal(h.layout.expanding, true);
  h.nodes[0].vx = 1;
  h.frame(29 * 1000 / 60);
  assert.equal(h.layout.expanding, false);
  assert.equal(h.simulation.alphaDecay(), decay);
  assert.equal(h.simulation.velocityDecay(), 0.4);
  assert.equal(h.nodes[0].vx, 0.6);
  assert.ok(h.frames.size > 0, 'settling continues after opening');
  h.layout.stop();
});

test('selection reheats from existing coordinates; dragging holds then releases the simulation', () => {
  const h = harness();
  h.layout.reheat(1, true);
  for (let i = 0; i < 130; i++) h.frame(i * 1000 / 60);
  const x = h.nodes[0].x;
  h.layout.reheat(0.3);
  assert.equal(h.nodes[0].x, x);
  assert.equal(h.layout.expanding, false);
  h.nodes[0].fx = 80;
  h.nodes[0].fy = 40;
  h.layout.hold();
  for (let i = 0; i < 300; i++) h.frame(6000 + i * 1000 / 60);
  assert.equal(h.nodes[0].x, 80);
  assert.ok(h.frames.size > 0, 'dragging must not cool to sleep');
  h.nodes[0].fx = null; h.nodes[0].fy = null;
  h.layout.release();
  for (let i = 0; i < 310; i++) h.frame(11100 + i * 1000 / 60);
  assert.equal(h.frames.size, 0);
  assert.equal(h.simulation.alphaTarget(), 0);
});

test('limits catch-up after a long frame and cancels all physics work on close', () => {
  const h = harness();
  h.layout.reheat(1, true);
  h.frame(0);
  const ticks = h.ticks(), paints = h.paints();
  h.frame(5000);
  assert.equal(h.ticks() - ticks, 4);
  assert.equal(h.paints() - paints, 1);
  h.layout.stop();
  assert.equal(h.frames.size, 0);
  h.frame(6000);
  assert.equal(h.ticks(), ticks + 4);
});

test('yields after a physics step uses the frame budget', () => {
  let elapsed = 0;
  const h = harness(() => elapsed += 5);
  h.layout.reheat(1, true);
  h.frame(0);
  const ticks = h.ticks();
  h.frame(1000);
  assert.equal(h.ticks() - ticks, 1);
  assert.ok(h.frames.size > 0, 'unfinished layout continues next frame');
  h.layout.stop();
});

test('a free layout never rests and moves at the dragging temperature', () => {
  const h = harness();
  h.layout.setFree(true, true);
  for (let time = 0; time <= 3000; time += 1000 / 60) h.frame(time);
  assert.ok(h.layout.running, 'a free layout keeps running');
  const free = h.simulation.alpha();
  h.layout.hold();
  for (let time = 3000; time <= 6000; time += 1000 / 60) h.frame(time);
  assert.ok(Math.abs(h.simulation.alpha() - free) < 0.01, `free ${free} vs held ${h.simulation.alpha()}`);
});
