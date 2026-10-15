// Records the README GIF and the community directory screenshots on the fictional «showcase» vault of the test
// vaults repository: `npm run media`. Frames come from Electron's capturePage, so nothing else on the screen gets in.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { browser } from '@wdio/globals';
import { Key } from 'webdriverio';
import { focusGraph, openGraph, openVault, waitSettled } from '../../test/e2e/helpers';

const OUT = path.resolve(import.meta.dirname);
const FRAMES = path.join(OUT, '.frames');
const SCREENS = path.join(OUT, 'screenshots');

/** Electron and Node inside Obsidian's window. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = Window & { require(id: string): any; capture?: { stop: boolean; frames: Array<{ file: string; t: number }>; done: Promise<void> } };

/** Captures the window ~15 times a second until stopRecording(). */
const startRecording = () => browser.executeObsidian((_, dir) => {
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
}, FRAMES);

async function stopRecording(): Promise<Array<{ file: string; t: number }>> {
  return browser.executeObsidian(async () => {
    const capture = (window as unknown as Win).capture!;
    capture.stop = true; await capture.done;
    return capture.frames;
  });
}

/** A screenshot of the window for the directory listing. */
const screenshot = (name: string) => browser.executeObsidian(async (_, file) => {
  const win = window as unknown as Win;
  win.require('fs').mkdirSync(win.require('path').dirname(file), { recursive: true });
  const image = await win.require('@electron/remote').getCurrentWebContents().capturePage();
  win.require('fs').writeFileSync(file, image.toPNG());
}, path.join(SCREENS, `${name}.png`));

/** A drawn pointer that follows the mouse: captured frames have no system cursor. */
const showPointer = () => browser.executeObsidian(() => {
  const dot = document.body.createDiv();
  dot.setCssStyles({ position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', zIndex: '100000', pointerEvents: 'none', transform: 'translate(-200px, -200px)' });
  dot.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-3 7z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  window.addEventListener('pointermove', (event) => { dot.style.transform = `translate(${event.clientX - 3}px, ${event.clientY - 2}px)`; }, true);
});

/** Where a person is on screen now, without moving the camera. */
const nodePoint = (id: string) => browser.executeObsidian(({ app }, id) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
  const node = view.nodeById.get(id);
  const rect = view.panel.getBoundingClientRect();
  return { x: Math.round(rect.left + view.cameraX + node.x * view.zoom), y: Math.round(rect.top + view.cameraY + node.y * view.zoom) };
}, id);

type Target = string | ReturnType<typeof browser.$>;
const center = async (target: Target) => {
  const el = typeof target === 'string' ? browser.$(target) : target;
  const { x, y } = await el.getLocation(); const { width, height } = await el.getSize();
  return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
};

/** Where the pointer waits while a screenshot is taken: an empty corner. */
const REST = { x: 1120, y: 300 };

/** Moves the pointer there in a visible glide. */
const glide = ({ x, y }: { x: number; y: number }, duration = 600) =>
  browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x, y, origin: 'viewport', duration }).perform();

async function clickAt(point: { x: number; y: number }, { double = false } = {}) {
  await glide(point);
  const pointer = browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ ...point, origin: 'viewport' }).down().up();
  if (double) pointer.pause(80).down().up();
  await pointer.perform();
  await browser.pause(450);
}
const clickPerson = async (id: string, options = {}) => { await waitSettled(); await clickAt(await nodePoint(id), options); };
const clickEl = async (target: Target) => clickAt(await center(target));

/** Types a name into the dock's search and takes the first suggestion. */
async function pick(name: string) {
  await clickEl('.genealogy-dock-search input');
  for (const letter of name) { await browser.keys(letter); await browser.pause(70); }
  await browser.pause(500);
  await browser.keys(Key.Enter);
  await browser.pause(500);
}

const person = (name: string) => browser.executeObsidian(({ app }, name) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin = (app as any).plugins.plugins['genealogy-graph'];
  return (plugin.graph.people as Array<{ id: string; name: string }>).find((p) => p.name === name)!.id;
}, name);

describe('README GIF and directory screenshots', () => {
  it('records the main features', async () => {
    await openVault('showcase', { graph: false });
    await browser.executeObsidian(({ app }) => {
      const remote = (window as unknown as Win).require('@electron/remote');
      remote.getCurrentWindow().setContentSize(1200, 800);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app.workspace as any).leftSplit.collapse();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugin = (app as any).plugins.plugins['genealogy-graph'];
      plugin.settings.controls.open = false;
    });
    await showPointer();
    await browser.pause(500);
    const emily = await person('Emily Carter'); const robert = await person('Robert Carter');

    await startRecording();
    // The graph opens and spreads out.
    await openGraph();
    await browser.pause(800);
    await screenshot('1-graph');

    // A click shows a person's closest family.
    await clickPerson(emily);
    await browser.pause(1500);

    // Kinship route between two people, picked by name.
    await focusGraph(); await browser.keys(Key.Escape);
    await waitSettled(); await browser.pause(400);
    await clickEl('.genealogy-dock-button .svg-icon.lucide-route');
    await pick('Emily');
    await pick('Edward');
    await waitSettled();
    // The whole route in view, as the plugin frames it when both ends are chosen.
    await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any).fitPath());
    await glide(REST);
    await waitSettled(); await browser.pause(2500);
    await screenshot('2-route');
    await clickEl('.genealogy-dock-button .svg-icon.lucide-route');
    await waitSettled(); await browser.pause(600);

    // Roots: every line of ancestors.
    await clickEl('.genealogy-dock-button .svg-icon.lucide-sprout');
    await glide(REST);
    await waitSettled(); await browser.pause(2200);
    await screenshot('3-roots');
    await clickEl('.genealogy-dock-button .svg-icon.lucide-sprout');
    await waitSettled(); await browser.pause(600);

    // Search, then the profile.
    await pick('Robert');
    await waitSettled(); await browser.pause(700);
    await clickPerson(robert, { double: true });
    await glide(REST);
    await browser.pause(2000);
    await screenshot('4-profile');
    await browser.keys(Key.Escape);
    await browser.pause(600);

    // Export for print.
    await clickEl('.graph-controls-button.mod-open');
    await clickEl('.graph-control-section-header=Export');
    await clickEl('button=Export…');
    await browser.$('.genealogy-export').waitForDisplayed();
    await clickEl(browser.$('.genealogy-export-segments').$('button=Print'));
    await browser.pause(800);
    await clickEl('.genealogy-export-inline');
    await glide(REST);
    await browser.pause(2000);
    await screenshot('5-export');
    await browser.keys(Key.Escape);
    await browser.pause(400);

    const frames = await stopRecording();
    fs.writeFileSync(path.join(FRAMES, 'frames.json'), JSON.stringify(frames));
  });
});
