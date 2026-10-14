import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from 'd3-force';
import { LiveLayout, type FrameClock } from './layout';
import { nodeRadius, SPOUSE_GAP, type SceneNode } from './scene';

/**
 * The force layout of the live graph, written to run in a Web Worker (the built-in graph view does the same):
 * the main thread only sends the graph and drag positions, and receives coordinates.
 * `createPhysics` holds all the logic, so tests and the in-thread fallback use it directly.
 */

export interface PhysicsNode { id: string; x: number; y: number; radius: number; selected: boolean }
export interface PhysicsLink { source: string; target: string; relation: 'parent' | 'spouse' }

export type ToPhysics =
  /** The visible graph. Known ids keep their simulated position and velocity; new ones start at the given x/y. */
  | { type: 'graph'; version: number; nodes: PhysicsNode[]; links: PhysicsLink[] }
  | { type: 'reheat'; alpha: number; cold: boolean }
  /** «Отпустить граф»: keep simulating forever, or cool to rest after about two seconds. */
  | { type: 'free'; free: boolean }
  /** Physics steps per step of time while free: ×1, ×2, ×3, ×5. */
  | { type: 'hold' } | { type: 'release' }
  /** Pins a node under the pointer; null coordinates release it. */
  | { type: 'fix'; id: string; x: number | null; y: number | null }
  | { type: 'stop' };

/** Coordinates in the order of the nodes of graph `version`: x0, y0, x1, y1, … */
export type FromPhysics = { type: 'frame'; version: number; positions: Float32Array; running: boolean; expanding: boolean };

interface SimNode extends SceneNode {
  vx?: number; vy?: number; fx?: number | null; fy?: number | null;
  /** People the body stands for (a spouse group is one body); it repels as strongly as they would apart. */
  weight?: number;
}
interface SimLink { source: string | SimNode; target: string | SimNode; relation: PhysicsLink['relation'] }

/** Forces of the live layout: strong repulsion, long parent links. Spouse groups are single bodies (see createPhysics). */
export function configureForces(simulation: Simulation<SimNode, SimLink>, links: SimLink[]) {
  simulation
    // Keep the strengthened repulsion through settling so the expanded graph does not collapse again.
    // Selection has no force of its own: choosing people must not move the graph.
    .force('charge', forceManyBody<SimNode>().strength((node) => -310 * 3.2 * (node.weight ?? 1)).distanceMin(30))
    // Stiff links let the layout settle in about two seconds without losing shape (measured on 170–1000 people).
    .force('link', forceLink<SimNode, SimLink>(links.filter((link) => link.relation !== 'spouse')).id((node) => node.id).distance(263).strength(0.9))
    .force('collide', forceCollide<SimNode>((node) => nodeRadius(node) + 20))
    .force('x', forceX<SimNode>(0).strength(0.08))
    .force('y', forceY<SimNode>(0).strength(0.08));
}

interface Movable extends SceneNode { vx?: number; vy?: number; fx?: number | null; fy?: number | null }

/**
 * Spouses side by side and level for the one-off print layout (main.printScene), which runs plain d3 forces: after
 * every step each couple is placed at its exact distance, turned a little toward level, and given one velocity.
 * The live layout does not use it: there spouse groups are single bodies (see createPhysics), because holding
 * spouses together against the forces between them made couples drift while the layout kept cooling.
 */
export function spouseConstraint<N extends Movable>(links: Array<{ source: string | N; target: string | N; relation: string }>) {
  const spouses = links.filter((link) => link.relation === 'spouse');
  let pairs: Array<[N, N]> = [];
  return {
    initialize(nodes: N[]) {
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const resolve = (end: string | N) => byId.get(typeof end === 'string' ? end : end.id);
      pairs = spouses.flatMap((link) => { const a = resolve(link.source); const b = resolve(link.target); return a && b ? [[a, b] as [N, N]] : []; });
    },
    apply() {
      // Twice, so people with several spouses settle among all of them.
      for (let round = 0; round < 2; round++) {
        for (const [a, b] of pairs) {
          let dx = b.x - a.x; const dy = (b.y - a.y) * (1 - LEVEL_STRENGTH);
          if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dx = 1;
          const length = Math.hypot(dx, dy);
          const scale = (nodeRadius(a) + nodeRadius(b) + SPOUSE_GAP) / length;
          const ox = dx * scale; const oy = dy * scale;
          const aFixed = a.fx != null; const bFixed = b.fx != null;
          if (aFixed && bFixed) continue;
          if (aFixed) { b.x = a.x + ox; b.y = a.y + oy; } else if (bFixed) { a.x = b.x - ox; a.y = b.y - oy; } else {
            const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
            a.x = cx - ox / 2; a.y = cy - oy / 2; b.x = cx + ox / 2; b.y = cy + oy / 2;
          }
          const vx = ((a.vx ?? 0) + (b.vx ?? 0)) / 2; const vy = ((a.vy ?? 0) + (b.vy ?? 0)) / 2;
          a.vx = b.vx = vx; a.vy = b.vy = vy;
        }
      }
    },
  };
}

/** Share of the height difference between spouses removed per step. */
const LEVEL_STRENGTH = 0.15;

/** A spouse group simulated as one body: its members sit in a row, `offset` from the body's center. */
interface Body extends SimNode { members: Array<{ id: string; offset: number }> }

/**
 * Spouses linked to one another (a couple, or a chain of remarriages) and their order in a row: a chain is walked
 * from the end that is further left now, a pair keeps its current left-to-right order. Everyone else is alone.
 */
export function spouseRows(nodes: Array<{ id: string; x: number }>, links: Array<{ source: string; target: string; relation: string }>): string[][] {
  const spouses = new Map<string, string[]>();
  for (const link of links) {
    if (link.relation !== 'spouse' || link.source === link.target) continue;
    spouses.set(link.source, [...(spouses.get(link.source) ?? []), link.target]);
    spouses.set(link.target, [...(spouses.get(link.target) ?? []), link.source]);
  }
  const x = new Map(nodes.map((node) => [node.id, node.x]));
  const placed = new Set<string>();
  const rows: string[][] = [];
  for (const node of nodes) {
    if (placed.has(node.id)) continue;
    // The whole group first, then a walk from its leftmost end (a person with one spouse, if there is one).
    const group: string[] = []; const stack = [node.id]; const seen = new Set([node.id]);
    while (stack.length) {
      const id = stack.pop()!; group.push(id);
      for (const next of spouses.get(id) ?? []) if (!seen.has(next) && x.has(next)) { seen.add(next); stack.push(next); }
    }
    const ends = group.filter((id) => (spouses.get(id) ?? []).filter((next) => x.has(next)).length <= 1);
    const start = (ends.length ? ends : group).reduce((best, id) => x.get(id)! < x.get(best)! ? id : best);
    const row: string[] = []; const walk = [start]; const visited = new Set<string>();
    while (walk.length) {
      const id = walk.pop()!;
      if (visited.has(id)) continue;
      visited.add(id); row.push(id);
      const next = (spouses.get(id) ?? []).filter((other) => x.has(other) && !visited.has(other)).sort((a, b) => x.get(b)! - x.get(a)!);
      walk.push(...next);
    }
    for (const id of row) placed.add(id);
    rows.push(row);
  }
  return rows;
}

/**
 * Spouses are simulated as one body: they sit side by side in a level row, and no force acts between them. Forces
 * between separate people (repulsion, collision spacing) would otherwise push spouses apart, and holding them
 * together against that made couples drift as the layout kept cooling.
 */
export function createPhysics(post: (message: FromPhysics) => void, clock?: FrameClock): (message: ToPhysics) => void {
  const simulation = forceSimulation<SimNode, SimLink>([]).stop();
  let order: string[] = [];
  let bodies: Body[] = [];
  let bodyOf = new Map<string, { body: Body; offset: number }>();
  let version = 0;
  const layout: LiveLayout<SimNode, SimLink> = new LiveLayout(simulation, () => {
    const positions = new Float32Array(order.length * 2);
    order.forEach((id, index) => {
      const { body, offset } = bodyOf.get(id)!;
      positions[index * 2] = body.x + offset; positions[index * 2 + 1] = body.y;
    });
    post({ type: 'frame', version, positions, running: layout.running, expanding: layout.expanding });
  }, () => {}, clock);
  return (message) => {
    switch (message.type) {
      case 'graph': {
        const previous = new Map(bodies.map((body) => [body.id, body]));
        const where = new Map(message.nodes.map((node) => [node.id, node]));
        // Where each person is now: in the simulation if known there, else where the view put them.
        const now = (id: string) => { const known = bodyOf.get(id); return known ? { x: known.body.x + known.offset, y: known.body.y } : where.get(id)!; };
        const rows = spouseRows(message.nodes.map((node) => ({ id: node.id, x: now(node.id).x })), message.links);
        bodies = rows.map((row) => {
          const radii = row.map((id) => where.get(id)!.radius);
          const offsets: number[] = [];
          let cursor = 0;
          row.forEach((_, index) => { if (index) cursor += radii[index - 1] + radii[index] + SPOUSE_GAP; offsets.push(cursor); });
          const left = -radii[0]; const right = cursor + radii[row.length - 1];
          const middle = (left + right) / 2;
          const key = row.join('\n');
          const body: Body = previous.get(key) ?? (() => {
            const points = row.map(now);
            return { id: key, name: key, generation: null, color: '', x: points.reduce((sum, point) => sum + point.x, 0) / row.length, y: points.reduce((sum, point) => sum + point.y, 0) / row.length, members: [] };
          })();
          body.members = row.map((id, index) => ({ id, offset: offsets[index] - middle }));
          body.radius = (right - left) / 2;
          body.weight = row.length;
          body.selected = row.some((id) => where.get(id)!.selected);
          return body;
        });
        bodyOf = new Map(bodies.flatMap((body) => body.members.map((member) => [member.id, { body, offset: member.offset }] as const)));
        order = message.nodes.map((node) => node.id); version = message.version;
        simulation.nodes(bodies);
        // Links between bodies; a parent link inside one spouse group has nothing to pull.
        const links = message.links.filter((link) => link.relation !== 'spouse')
          .map((link) => ({ source: bodyOf.get(link.source)!.body.id, target: bodyOf.get(link.target)!.body.id, relation: link.relation }))
          .filter((link) => link.source !== link.target);
        configureForces(simulation, links);
        break;
      }
      case 'reheat': if (bodies.length) layout.reheat(message.alpha, message.cold); else layout.stop(); break;
      case 'free': layout.setFree(message.free, bodies.length > 0); break;
      case 'hold': layout.hold(); break;
      case 'release': layout.release(); break;
      case 'fix': {
        const known = bodyOf.get(message.id);
        if (known) { known.body.fx = message.x === null ? null : message.x - known.offset; known.body.fy = message.y; }
        break;
      }
      case 'stop': layout.stop(); break;
    }
  };
}
