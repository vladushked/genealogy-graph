// Recording in a real Obsidian for the README GIF (record.media.ts) and the guides (guides.media.ts): frames from
// Electron's capturePage, so nothing else on the screen gets in, a drawn mouse pointer or drawn fingertips (captured
// frames have neither), and the gestures that move them.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { browser } from '@wdio/globals';

/**
 * The clone of the media repository (github.com/vladushked/genealogy-graph-media) the GIFs and screenshots go to:
 * next to the plugin's, or MEDIA_DIR. The plugin's README and guides show them by their raw URLs there.
 */
export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR ?? path.join(import.meta.dirname, '..', '..', '..', 'genealogy-graph-media'));

/** Electron and Node inside Obsidian's window. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Win = Window & { require(id: string): any; capture?: { stop: boolean; frames: Array<{ file: string; t: number }>; done: Promise<void> } };
export interface Frame { file: string; t: number }
export interface Point { x: number; y: number }

/** Captures the window ~15 times a second into `dir` until stopRecording(). */
export const startRecording = (dir: string) => browser.executeObsidian((_, dir) => {
  const win = window as unknown as Win;
  const fs = win.require('fs'); const path = win.require('path');
  const contents = win.require('@electron/remote').getCurrentWebContents();
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const capture = { stop: false, frames: [] as Array<{ file: string; t: number }>, done: Promise.resolve() };
  win.capture = capture;
  capture.done = (async () => {
    for (let n = 0; !capture.stop; n++) {
      const t = performance.now();
      const image = await contents.capturePage();
      const file = path.join(dir, `${String(n).padStart(5, '0')}.png`);
      fs.writeFileSync(file, image.toPNG());
      capture.frames.push({ file, t });
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1000 / 15 - (performance.now() - t))));
    }
  })();
}, dir);

/** Stops the capture; with `dir`, writes frames.json there for assemble.mjs, with `meta` (device, width). */
export async function stopRecording(dir?: string, meta: Record<string, unknown> = {}): Promise<Frame[]> {
  const frames = await browser.executeObsidian(async () => {
    const capture = (window as unknown as Win).capture!;
    capture.stop = true; await capture.done;
    return capture.frames;
  });
  if (dir) fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ ...meta, frames }));
  return frames;
}

/** A screenshot of the window. */
export const screenshot = (file: string) => browser.executeObsidian(async (_, file) => {
  const win = window as unknown as Win;
  win.require('fs').mkdirSync(win.require('path').dirname(file), { recursive: true });
  const image = await win.require('@electron/remote').getCurrentWebContents().capturePage();
  win.require('fs').writeFileSync(file, image.toPNG());
}, file);

/** A drawn arrow that follows the mouse. */
export const showPointer = () => browser.executeObsidian(() => {
  const dot = document.body.createDiv();
  dot.setCssStyles({ position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', zIndex: '100000', pointerEvents: 'none', transform: 'translate(-200px, -200px)' });
  dot.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-3 7z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  window.addEventListener('pointermove', (event) => { if (event.pointerType === 'mouse') dot.style.transform = `translate(${event.clientX - 3}px, ${event.clientY - 2}px)`; }, true);
});

/** Drawn fingertips: a soft circle under each finger while it touches the screen. */
export const showTouches = () => browser.executeObsidian(() => {
  const dots = new Map<number, HTMLElement>();
  const place = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    let dot = dots.get(event.pointerId);
    if (!dot) {
      if (event.type !== 'pointerdown') return;
      dot = document.body.createDiv();
      dot.setCssStyles({ position: 'fixed', left: '0', top: '0', width: '36px', height: '36px', borderRadius: '50%', zIndex: '100000', pointerEvents: 'none',
        background: 'rgba(110, 110, 120, 0.35)', border: '2px solid rgba(255, 255, 255, 0.95)', boxShadow: '0 0 8px rgba(0, 0, 0, 0.35)' });
      dots.set(event.pointerId, dot);
    }
    dot.style.transform = `translate(${event.clientX - 18}px, ${event.clientY - 18}px)`;
  };
  const lift = (event: PointerEvent) => {
    const dot = dots.get(event.pointerId);
    if (!dot) return;
    dots.delete(event.pointerId);
    window.setTimeout(() => dot.remove(), 120);
  };
  window.addEventListener('pointerdown', place, true); window.addEventListener('pointermove', place, true);
  window.addEventListener('pointerup', lift, true); window.addEventListener('pointercancel', lift, true);
});

type Target = string | ReturnType<typeof browser.$>;
/** The middle of an element on screen. */
export const center = async (target: Target): Promise<Point> => {
  const el = typeof target === 'string' ? browser.$(target) : target;
  const { x, y } = await el.getLocation(); const { width, height } = await el.getSize();
  return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
};

/** Where a person is on screen now, without moving the camera. */
export const nodePoint = (id: string) => browser.executeObsidian(({ app }, id) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
  const node = view.nodeById.get(id);
  const rect = view.panel.getBoundingClientRect();
  return { x: Math.round(rect.left + view.cameraX + node.x * view.zoom), y: Math.round(rect.top + view.cameraY + node.y * view.zoom) };
}, id);

/** The card path of the person with this name. */
export const person = (name: string) => browser.executeObsidian(({ app }, name) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin = (app as any).plugins.plugins['genealogy-graph'];
  return (plugin.graph.people as Array<{ id: string; name: string }>).find((p) => p.name === name)!.id;
}, name);

// ── mouse

const mouse = () => browser.action('pointer', { parameters: { pointerType: 'mouse' } });

/** Moves the pointer there in a visible glide. */
export const glide = ({ x, y }: Point, duration = 600) => mouse().move({ x, y, origin: 'viewport', duration }).perform();

export async function clickAt(point: Point, { double = false, shift = false } = {}) {
  await glide(point);
  const pointer = mouse().move({ ...point, origin: 'viewport' }).down().up();
  if (double) pointer.pause(80).down().up();
  if (shift) await browser.actions([browser.action('key').down(''), pointer, browser.action('key').up('')]);
  else await pointer.perform();
  await browser.pause(450);
}
export const clickEl = async (target: Target) => clickAt(await center(target));

// ── fingers

const finger = (id = 'finger') => browser.action('pointer', { id, parameters: { pointerType: 'touch' } });

export async function tap(point: Point, { double = false } = {}) {
  const action = finger().move({ ...point, origin: 'viewport' }).down().pause(90).up();
  if (double) action.pause(110).down().pause(70).up();
  await action.perform();
  await browser.pause(450);
}
export const tapEl = async (target: Target) => tap(await center(target));

/** A finger held still: the person's menu after half a second. */
export async function hold(point: Point, ms = 800) {
  await finger().move({ ...point, origin: 'viewport' }).down().pause(ms).up().perform();
  await browser.pause(400);
}

/** One finger dragging from `from` to `to`. */
export async function swipe(from: Point, to: Point, duration = 600) {
  await finger().move({ ...from, origin: 'viewport' }).down().pause(60).move({ ...to, origin: 'viewport', duration }).pause(60).up().perform();
  await browser.pause(300);
}

/** Two fingers around `at`, from `start` to `end` pixels apart: apart zooms in, together zooms out. */
export async function pinch(at: Point, start: number, end: number, steps = 12) {
  const a = finger('a').move({ x: at.x - start / 2, y: at.y, origin: 'viewport' }).down().pause(80);
  const b = finger('b').move({ x: at.x + start / 2, y: at.y, origin: 'viewport' }).down().pause(80);
  for (let step = 1; step <= steps; step++) {
    const half = (start + (end - start) * step / steps) / 2;
    a.move({ x: Math.round(at.x - half), y: at.y, origin: 'viewport', duration: 40 });
    b.move({ x: Math.round(at.x + half), y: at.y, origin: 'viewport', duration: 40 });
  }
  a.pause(80).up(); b.pause(80).up();
  await browser.actions([a, b]);
  await browser.pause(400);
}
