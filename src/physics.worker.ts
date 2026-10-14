// Entry point of the physics Web Worker; bundled into main.js as a string by esbuild.config.mjs.
import { createPhysics, type FromPhysics, type ToPhysics } from './physics';

const scope = self as unknown as {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  postMessage(message: FromPhysics, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToPhysics>) => void) | null;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};
// Workers have no display refresh of their own in every runtime; a 60 Hz timer is the fallback.
const clock = scope.requestAnimationFrame && scope.cancelAnimationFrame
  ? { request: (callback: FrameRequestCallback) => scope.requestAnimationFrame!(callback), cancel: (id: number) => scope.cancelAnimationFrame!(id), now: () => performance.now() }
  : { request: (callback: FrameRequestCallback) => scope.setTimeout(() => callback(performance.now()), 1000 / 60), cancel: (id: number) => scope.clearTimeout(id), now: () => performance.now() };
const handle = createPhysics((message) => scope.postMessage(message, [message.positions.buffer]), clock);
scope.onmessage = (event) => handle(event.data);
