import { forceLink, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { nodeRadius, type SceneNode } from './scene';

interface MagneticNode extends SceneNode { vx?: number; vy?: number; fx?: number | null; fy?: number | null }
interface MagneticLink<T> { source: string | T; target: string | T }

const STEP_MS = 1000 / 60;
// Half a second of spreading, then cooling: at rest after 2 s (120 steps of 60 Hz physics).
const EXPANSION_STEPS = 30;
const SETTLE_STEPS = 90;
/** Temperature while a person is dragged: the graph follows the hand. */
const HOLD_ALPHA = 0.3;
/** «Отпустить граф»: the layout keeps the dragging temperature instead of cooling to rest, so it moves as it does under the hand. */
const FREE_ALPHA = HOLD_ALPHA;
const ALPHA_MIN = 0.001;
const coolingDecay = (settleSteps: number) => 1 - Math.pow(ALPHA_MIN, 1 / (EXPANSION_STEPS + settleSteps));

export interface FrameClock {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
  now(): number;
}
const browserClock: FrameClock = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (id) => window.cancelAnimationFrame(id),
  now: () => performance.now(),
};

/** Fixed-rate physics, bounded work per paint, and no d3 timer competing with rendering. */
export class LiveLayout<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>> {
  private frame: number | null = null;
  private previousTime: number | null = null;
  private pending = 0;
  private expansionSteps = 0;
  private active = false;
  expanding = false;
  /** «Отпустить граф»: never come to rest; people keep moving under the forces. */
  private free = false;

  /** True while the simulation still moves nodes. */
  get running() { return this.active; }

  constructor(
    private readonly simulation: Simulation<N, L>,
    private readonly paint: () => void,
    private readonly phaseChanged: () => void = () => {},
    private readonly clock: FrameClock = browserClock,
  ) { simulation.stop().alphaMin(ALPHA_MIN); }

  reheat(alpha: number, cold = false) {
    this.expanding = cold;
    this.expansionSteps = 0;
    this.simulation.stop().alpha(Math.max(this.simulation.alpha(), alpha))
      .alphaDecay(coolingDecay(SETTLE_STEPS)).velocityDecay(0.4);
    this.phaseChanged();
    this.wake();
  }

  hold() {
    this.simulation.alphaTarget(HOLD_ALPHA);
    this.reheat(HOLD_ALPHA);
  }

  release() {
    this.simulation.alphaTarget(this.free ? FREE_ALPHA : 0);
    this.reheat(0.3);
  }

  /** Lets the layout run forever (or cool to rest again); a free layout wakes even without changes. */
  setFree(free: boolean, hasNodes: boolean) {
    if (this.free === free) return;
    this.free = free;
    this.simulation.alphaTarget(free ? FREE_ALPHA : 0);
    if (hasNodes) this.reheat(free ? FREE_ALPHA : 0.05);
  }

  stop() {
    this.active = false;
    if (this.frame !== null) this.clock.cancel(this.frame);
    this.frame = null;
    this.previousTime = null;
    this.pending = 0;
    this.simulation.stop();
  }

  private wake() {
    if (!this.active) { this.previousTime = null; this.pending = 0; }
    this.active = true;
    if (this.frame === null) this.frame = this.clock.request((time) => this.step(time));
  }

  private step(time: number) {
    this.frame = null;
    this.pending = Math.min(STEP_MS * 4, this.pending + (this.previousTime === null ? STEP_MS : Math.max(0, time - this.previousTime)));
    this.previousTime = time;
    const started = this.clock.now();
    let steps = 0;
    while (this.active && this.pending + 1e-6 >= STEP_MS && steps < 4) {
      this.simulation.tick();
      this.pending = Math.max(0, this.pending - STEP_MS);
      steps++;
      if (this.expanding && ++this.expansionSteps >= EXPANSION_STEPS) {
        this.expanding = false;
        this.phaseChanged();
      }
      if (this.simulation.alphaTarget() === 0 && this.simulation.alpha() <= ALPHA_MIN * (1 + 1e-8)) this.active = false;
      // Bounded work per frame.
      if (this.clock.now() - started >= 4) break;
    }
    if (steps) this.paint(); // tick() does not dispatch d3's tick/end events.
    if (this.active) this.frame = this.clock.request((next) => this.step(next));
    else { this.previousTime = null; this.pending = 0; }
  }
}

export function selectionForce<T extends MagneticNode>(nodes: T[]) {
  const selected = nodes.filter((node) => node.selected);
  const links: MagneticLink<T>[] = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) links.push({ source: selected[i].id, target: selected[j].id });
  }
  return forceLink<T, MagneticLink<T>>(links)
    .id((node) => node.id)
    .distance((link) => nodeRadius(link.source as T) + nodeRadius(link.target as T) + 4)
    .strength(1.1).iterations(2);
}
