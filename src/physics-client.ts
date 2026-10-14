import physicsWorkerSource from 'physics-worker';
import { createPhysics, type FromPhysics, type PhysicsLink, type PhysicsNode, type ToPhysics } from './physics';

interface Positioned { id: string; x: number; y: number; radius?: number; layoutRadius?: number; selected?: boolean }

/**
 * Main-thread side of the layout. Physics runs in a Web Worker; coordinates arrive as messages and are applied to
 * the view's nodes at most once per display frame, followed by `paint`. If a worker cannot be started, the same
 * physics runs on the main thread.
 */
export class PhysicsClient<N extends Positioned> {
  private readonly send: (message: ToPhysics) => void;
  private readonly worker: Worker | null = null;
  private workerUrl: string | null = null;
  private version = 0;
  /** Nodes of each graph version still in flight, in the order the worker reports their coordinates. */
  private orders = new Map<number, N[]>();
  private latest: FromPhysics | null = null;
  private frame: number | null = null;
  running = false;
  expanding = false;

  constructor(private readonly paint: () => void, private readonly win: Window = window) {
    try {
      this.workerUrl = URL.createObjectURL(new Blob([physicsWorkerSource], { type: 'text/javascript' }));
      const worker = new Worker(this.workerUrl);
      worker.onmessage = (event: MessageEvent<FromPhysics>) => this.receive(event.data);
      this.worker = worker;
      this.send = (message) => worker.postMessage(message);
    } catch {
      if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
      const handle = createPhysics((message) => this.receive(message));
      this.send = handle;
    }
  }

  /** Sends the visible graph; call again whenever radii, selection or links change. */
  setGraph(nodes: N[], links: PhysicsLink[]) {
    const version = ++this.version;
    this.orders.set(version, nodes);
    const plain: PhysicsNode[] = nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, radius: node.layoutRadius ?? node.radius ?? 22, selected: Boolean(node.selected) }));
    this.send({ type: 'graph', version, nodes: plain, links });
  }

  reheat(alpha: number, cold = false) {
    // Report motion right away, so callers that wait for rest (link click targets) do not act on stale state.
    this.running = true; this.expanding = cold;
    this.send({ type: 'reheat', alpha, cold });
  }
  hold() { this.running = true; this.send({ type: 'hold' }); }
  setFree(free: boolean) { this.send({ type: 'free', free }); }
  release() { this.send({ type: 'release' }); }
  fix(id: string, x: number | null, y: number | null) { this.send({ type: 'fix', id, x, y }); }

  stop() {
    this.send({ type: 'stop' });
    this.running = false;
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  dispose() {
    this.stop();
    this.worker?.terminate();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = null;
  }

  private receive(message: FromPhysics) {
    if (message.version !== this.version) return; // Coordinates of a graph that has since been replaced.
    for (const version of this.orders.keys()) if (version < message.version) this.orders.delete(version);
    this.latest = message;
    if (this.frame === null) this.frame = this.win.requestAnimationFrame(() => this.apply());
  }

  private apply() {
    this.frame = null;
    const message = this.latest;
    const nodes = message && this.orders.get(message.version);
    if (!message || !nodes) return;
    this.latest = null;
    const { positions } = message;
    for (let index = 0; index < nodes.length; index++) {
      nodes[index].x = positions[index * 2]; nodes[index].y = positions[index * 2 + 1];
    }
    this.running = message.running; this.expanding = message.expanding;
    this.paint();
  }
}
