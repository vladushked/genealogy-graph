// Records the GIFs of the guides (docs/guides) on the fictional vaults of the test vaults repository, in English, on a
// computer, a phone and a tablet: `npm run media:guides`; CLIPS=route,roots records only those. Each clip goes to
// docs/media/.frames-guides/<clip>, and assemble.mjs turns it into guides/<clip>.gif of the media repository (see recording.ts).
import * as path from 'node:path';
import { browser } from '@wdio/globals';
import { Key } from 'webdriverio';
import { focusGraph, importFile, openGraph, openVault, setSettings, useLayout, waitSettled } from '../../test/e2e/helpers';
import {
  center, clickAt, clickEl, glide, hold, MEDIA_DIR, nodePoint, person, pinch, screenshot, showPointer, showTouches, startRecording, stopRecording, swipe, tap, tapEl,
  type Point, type Win,
} from './recording';

const FRAMES = path.resolve(import.meta.dirname, '.frames-guides');
const MEDIA = path.join(MEDIA_DIR, 'guides');
const ONLY = process.env.CLIPS ? process.env.CLIPS.split(',').map((name) => name.trim()) : null;

type Device = 'desktop' | 'phone' | 'tablet';
/** The window of each device in CSS pixels, and the width of its GIF. */
const SCREEN: Record<Device, { width: number; height: number; gif: number }> = {
  desktop: { width: 1200, height: 800, gif: 800 },
  phone: { width: 430, height: 932, gif: 360 },
  tablet: { width: 1180, height: 820, gif: 800 },
};

/** The device's layout: Obsidian's mobile mode for a phone or a tablet, with touch input and a sharp 2x screen. */
async function useDevice(device: Device) {
  const { width, height } = SCREEN[device];
  await useLayout(device);
  await browser.executeObsidian((_, device, width, height) => {
    const remote = (window as unknown as Win).require('@electron/remote');
    if (device === 'desktop') { remote.getCurrentWindow().setContentSize(width, height); return; }
    const contents = remote.getCurrentWebContents();
    try { contents.debugger.attach('1.3'); } catch { /* already attached */ }
    void contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    void contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }, device, width, height);
  await browser.pause(800);
}

/** The English interface, folded panels and sidebars: what a new user sees. */
async function prepare(device: Device, { scheme = 'western', editor = false } = {}) {
  await setSettings({ language: 'en', nameScheme: scheme });
  await browser.executeObsidian(({ app }, editor) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workspace = app.workspace as any;
    workspace.leftSplit.collapse();
    if (!editor) workspace.rightSplit.collapse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app as any).plugins.plugins['genealogy-graph'].settings.controls.open = false;
  }, editor);
  if (device === 'desktop') await showPointer(); else await showTouches();
}

/**
 * A clip: a fresh copy of `vault` on `device`, the graph opened (unless `graph` is false), then `run` recorded.
 */
function clip(name: string, device: Device, vault: string, run: () => Promise<void>, { graph = true, scheme = 'western', editor = false } = {}) {
  (ONLY && !ONLY.includes(name) ? it.skip : it)(name, async () => {
    await openVault(vault, { graph: false });
    await useDevice(device);
    await prepare(device, { scheme, editor });
    if (graph) { await openGraph(); await waitSettled(); }
    await browser.pause(400);
    const dir = path.join(FRAMES, name);
    await startRecording(dir);
    await browser.pause(500);
    await run();
    await browser.pause(700);
    await stopRecording(dir, { device, width: SCREEN[device].gif });
  });
}

const view = () => browser.executeObsidian(({ app }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
  const rect = view.panel.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
});
const middle = async (): Promise<Point> => { const rect = await view(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }; };
const clickPerson = async (name: string, options = {}) => { await waitSettled(); await clickAt(await nodePoint(await person(name)), options); };
const tapPerson = async (name: string, options = {}) => { await waitSettled(); await tap(await nodePoint(await person(name)), options); };
/** Puts a person in the middle of the graph at a readable zoom, as a pan would. */
const bringIntoView = (name: string, zoom = 1.1) => browser.executeObsidian(({ app }, name, zoom) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
  const node = (view.nodes as Array<{ id: string; name: string; x: number; y: number }>).find((item) => item.name === name)!;
  view.stopFollowing(); view.animateCamera({ cx: node.x, cy: node.y, zoom });
}, name, zoom);

/** An empty spot of the graph on screen: nothing over the canvas there, and no person or link under it. */
const emptySpot = () => browser.executeObsidian(({ app }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
  const rect = view.panel.getBoundingClientRect();
  for (let sy = 0.3; sy < 0.8; sy += 0.04) for (let sx = 0.55; sx > 0.15; sx -= 0.04) {
    const x = Math.round(rect.left + rect.width * sx), y = Math.round(rect.top + rect.height * sy);
    if (document.elementFromPoint(x, y) === view.canvas && !view.hitAt({ clientX: x, clientY: y })) return { x, y };
  }
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 3) };
});
/** Selects a person unless they are the only one selected already: a click would deselect them. */
async function selectPerson(name: string) {
  const selected = await browser.executeObsidian(({ app }, name) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
    const node = (view.nodes as Array<{ id: string; name: string }>).find((item) => item.name === name);
    return Boolean(node) && view.focus.size === 1 && view.focus.has(node!.id);
  }, name);
  if (!selected) await clickPerson(name);
}

/** Types into a field letter by letter, as a person does. */
async function type(text: string, pause = 70) {
  for (const letter of text) { await browser.keys(letter); await browser.pause(pause); }
}
/** The dock's search: a name typed, the first suggestion taken. */
async function find(name: string) {
  await clickEl('.genealogy-dock-search input');
  await type(name);
  await browser.pause(500);
  await browser.keys(Key.Enter);
  await browser.pause(700);
}
/** A text field of the side form by its label. */
const formInput = (label: string) => browser.$('.genealogy-editor').$(`label=${label}`).parentElement().$('input');

describe('Guide GIFs', () => {
  // ── computer

  clip('desktop-build', 'desktop', 'empty', async () => {
    // The first person: yourself.
    await clickEl('.genealogy-empty-add');
    await browser.pause(500);
    await clickEl(await formInput('Given names')); await type('Emma');
    await clickEl(await formInput('Surname')); await type('Lane');
    await clickEl(await formInput('Birth date')); await type('1990');
    await clickEl(browser.$('.genealogy-editor-check'));
    await clickEl(browser.$('.genealogy-editor-actions').$('button=Create card'));
    await waitSettled(); await browser.pause(800);
    // A parent from the «+» beside her: the surname comes by itself.
    await selectPerson('Emma Lane');
    await waitSettled(); await browser.pause(500);
    await clickEl('.genealogy-node-plus');
    await clickEl(browser.$('.menu').$('.menu-item-title=Parent'));
    await browser.pause(500);
    await clickEl(await formInput('Given names')); await type('Thomas');
    await clickEl(await formInput('Birth date')); await type('1962');
    await clickEl(browser.$('.genealogy-editor-actions').$('button=Create card'));
    await waitSettled(); await browser.pause(1200);
  }, { graph: true, editor: true });

  clip('desktop-select', 'desktop', 'showcase', async () => {
    await clickPerson('Emily Carter');
    await browser.pause(1400);
    await clickPerson('Robert Carter', { shift: true });
    await browser.pause(1400);
    await focusGraph(); await browser.keys(Key.Escape);
    await browser.pause(1200);
  });

  clip('desktop-profile', 'desktop', 'showcase', async () => {
    await bringIntoView('Emily Carter'); await waitSettled();
    await clickPerson('Emily Carter', { double: true });
    await browser.pause(1600);
    const chip = browser.$('.genealogy-profile').$$('.genealogy-profile-chip')[0];
    await clickEl(chip);
    await browser.pause(1400);
    await browser.keys(Key.Escape);
    await browser.pause(600);
  });

  clip('desktop-search', 'desktop', 'showcase', async () => {
    await focusGraph();
    await browser.keys([Key.Ctrl, 'f']);
    await browser.pause(300);
    await type('Rob', 120);
    await browser.pause(800);
    await browser.keys(Key.Enter);
    await waitSettled(); await browser.pause(1200);
  });

  clip('desktop-generations', 'desktop', 'showcase', async () => {
    await clickEl(browser.$('.genealogy-generation-rail').$('button*=−1'));
    await browser.pause(900);
    await clickEl(browser.$('.genealogy-generation-rail').$('button*=−2'));
    await browser.pause(1100);
    await clickEl('.genealogy-generation-reset');
    await browser.pause(700);
    await clickEl('.genealogy-focus-bar button[aria-label^="Focus on the number"]');
    await browser.pause(1600);
    await clickEl('.genealogy-focus-bar button[aria-label^="Focus on generations"]');
    await browser.pause(900);
  });

  clip('desktop-route', 'desktop', 'showcase', async () => {
    await clickEl('.genealogy-dock-button .svg-icon.lucide-route');
    await find('Emily');
    await find('Edward');
    await waitSettled();
    await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as unknown as { fitPath(): void }).fitPath());
    await waitSettled(); await browser.pause(2400);
    await clickEl('.genealogy-route-close');
    await browser.pause(600);
  });

  clip('desktop-roots', 'desktop', 'showcase', async () => {
    await clickEl('.genealogy-dock-button .svg-icon.lucide-sprout');
    await waitSettled(); await browser.pause(1600);
    await clickEl(browser.$('.genealogy-roots-depth').$('button=1'));
    await waitSettled(); await browser.pause(1400);
    await clickEl(browser.$('.genealogy-roots-depth').$('button=0'));
    await waitSettled(); await browser.pause(1000);
    await clickEl('.genealogy-route-close');
    await browser.pause(600);
  });

  clip('desktop-hide', 'desktop', 'showcase', async () => {
    // The link from Emily up to her parents: hiding it hides her ancestors, «me» stays.
    await bringIntoView('Emily Carter', 0.9); await waitSettled();
    const mid = await browser.executeObsidian(({ app }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
      const emily = (view.nodes as Array<{ id: string; name: string }>).find((node) => node.name === 'Emily Carter')!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const link = [...view.links.values()].find((item: any) => item.edges.some((edge: any) => edge.to === emily.id && edge.relation === 'parent') && item.line);
      const rect = view.panel.getBoundingClientRect();
      const x = (link.line.x1 + link.line.x2) / 2, y = (link.line.y1 + link.line.y2) / 2;
      return { x: Math.round(rect.left + view.cameraX + x * view.zoom), y: Math.round(rect.top + view.cameraY + y * view.zoom) };
    });
    await clickAt(mid);
    await browser.pause(1200);
    const eye = await browser.executeObsidian(({ app }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
      view.render();
      const rect = view.panel.getBoundingClientRect();
      return { x: Math.round(rect.left + view.cameraX + view.eyeAt.x * view.zoom), y: Math.round(rect.top + view.cameraY + view.eyeAt.y * view.zoom) };
    });
    await clickAt(eye);
    await waitSettled(); await browser.pause(1500);
    // «+N» on Emily brings them back.
    const badge = await browser.executeObsidian(({ app }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const node = view.hitNodes.find((item: any) => item.badge);
      const rect = view.panel.getBoundingClientRect();
      return { x: Math.round(rect.left + view.cameraX + (node.x + node.badge.x) * view.zoom), y: Math.round(rect.top + view.cameraY + (node.y + node.badge.y) * view.zoom) };
    });
    await clickAt(badge);
    await waitSettled(); await browser.pause(1400);
  });

  clip('desktop-checks', 'desktop', 'showcase', async () => {
    await clickEl('.genealogy-clarify-button');
    await browser.pause(1400);
    await clickEl(browser.$('.genealogy-clarify').$$('.genealogy-problems-person a')[1]);
    await waitSettled(); await browser.pause(1400);
    await clickEl(browser.$('.genealogy-clarify').$('.genealogy-problems-close'));
    await browser.pause(800);
  });

  clip('desktop-timelapse', 'desktop', 'showcase', async () => {
    await clickEl('.graph-controls-button.mod-animate:not(.genealogy-free-button)');
    await browser.pause(6500);
    await clickEl('.graph-controls-button.mod-animate:not(.genealogy-free-button)');
    await waitSettled(); await browser.pause(800);
  });

  clip('desktop-panel', 'desktop', 'showcase', async () => {
    await clickPerson('Emily Carter');
    await browser.pause(700);
    await clickEl('.graph-controls-button.mod-open');
    await browser.pause(600);
    const depth = browser.$('.genealogy-controls').$('.setting-item-name=Depth').parentElement().parentElement().$('select');
    await clickEl(depth);
    await depth.selectByAttribute('value', '1');
    await browser.keys(Key.Escape);
    await waitSettled(); await browser.pause(1500);
    await depth.selectByAttribute('value', '0'); // whole family
    await waitSettled(); await browser.pause(900);
    await clickEl('.graph-controls-button.mod-close');
    await browser.pause(600);
  });

  // ── phone

  clip('phone-gestures', 'phone', 'showcase', async () => {
    const at = await middle();
    await pinch(at, 80, 260);
    await waitSettled(); await browser.pause(500);
    await swipe({ x: at.x + 60, y: at.y + 40 }, { x: at.x - 40, y: at.y - 60 });
    await browser.pause(500);
    await bringIntoView('Emily Carter', 1.2); await waitSettled();
    await tapPerson('Emily Carter');
    await waitSettled(); await browser.pause(900);
    await tapPerson('Emily Carter', { double: true });
    await browser.pause(1600);
    await tapEl('.genealogy-profile .genealogy-profile-action:has(.lucide-x)');
    await browser.pause(600);
    await hold(await nodePoint(await person('Emily Carter')));
    await browser.pause(1400);
    await tap({ x: at.x, y: Math.round(at.y * 0.35) }); // outside the menu sheet
    await browser.pause(600);
  });

  clip('phone-generations', 'phone', 'showcase', async () => {
    await tapEl('.genealogy-rail-toggle');
    await browser.pause(700);
    await tapEl(browser.$('.genealogy-generation-rail').$('button*=−1'));
    await browser.pause(700);
    await tapEl(browser.$('.genealogy-generation-rail').$('button*=−2'));
    await browser.pause(900);
    await tap(await emptySpot());
    await browser.pause(1200);
    await tapEl('.genealogy-rail-toggle');
    await browser.pause(500);
    await tapEl('.genealogy-generation-reset');
    await browser.pause(500);
    await tapEl('.genealogy-rail-toggle');
    await browser.pause(700);
  });

  clip('phone-panels', 'phone', 'showcase', async () => {
    await tapEl('.genealogy-controls .mod-open');
    await browser.pause(1300);
    await tap(await emptySpot());
    await browser.pause(800);
    await tapEl('.genealogy-clarify-button');
    await browser.pause(1300);
    await tapEl(browser.$('.genealogy-clarify').$('.genealogy-problems-close'));
    await browser.pause(800);
  });

  // ── tablet

  clip('tablet-overview', 'tablet', 'showcase', async () => {
    const at = await middle();
    await pinch(at, 120, 320);
    await waitSettled(); await browser.pause(500);
    await bringIntoView('Emily Carter', 1.1); await waitSettled();
    await tapPerson('Emily Carter');
    await waitSettled(); await browser.pause(900);
    await hold(await nodePoint(await person('Robert Carter')));
    await browser.pause(1400);
    await tap({ x: Math.round(at.x * 1.6), y: Math.round(at.y * 0.4) });
    await browser.pause(600);
  });

  // ── import and export

  clip('import', 'desktop', 'empty', async () => {
    await browser.executeObsidianCommand('genealogy-graph:import-family-tree');
    const modal = browser.$('.modal');
    await modal.$('input[type=file]').waitForExist();
    await browser.pause(800);
    await modal.$('input[type=file]').setValue(importFile('family-7.0.ged'));
    await modal.$('button=Import').waitForExist({ timeout: 15000 });
    await glide(await center(modal.$('.genealogy-import-row')));
    await browser.pause(2200);
    await clickEl(modal.$('button=Import'));
    await browser.pause(1600);
    await clickEl(modal.$('button=Open report'));
    await waitSettled(); await browser.pause(1200);
    await browser.executeObsidian(async ({ app }) => { await app.workspace.revealLeaf(app.workspace.getLeavesOfType('genealogy-graph-view')[0]); });
    await waitSettled(); await browser.pause(1400);
  });

  clip('export-print', 'desktop', 'showcase', async () => {
    await clickEl('.graph-controls-button.mod-open');
    await clickEl('.graph-control-section-header=Export');
    await clickEl('button=Export…');
    const dialog = browser.$('.genealogy-export');
    await dialog.waitForDisplayed();
    await clickEl(dialog.$('.genealogy-export-segments').$('button=Print'));
    await browser.pause(1200);
    await clickEl(dialog.$('.genealogy-export-inline'));
    await browser.pause(1400);
    await clickEl(dialog.$('button=Area'));
    await browser.pause(1000);
    const frame = await center(dialog.$('.genealogy-overview-frame'));
    await glide(frame);
    await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ ...frame, origin: 'viewport' }).down()
      .move({ x: frame.x + 60, y: frame.y + 30, origin: 'viewport', duration: 900 }).up().perform();
    await browser.pause(1200);
    await clickEl(dialog.$('button=Tiles'));
    await browser.pause(1600);
    await browser.keys(Key.Escape);
    await browser.pause(500);
  });

  // ── a card, for the data guide

  (ONLY && !ONLY.includes('data-card') ? it.skip : it)('data-card', async () => {
    await openVault('showcase', { graph: false });
    await useDevice('desktop');
    await prepare('desktop');
    await browser.executeObsidian(async ({ app }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugin = (app as any).plugins.plugins['genealogy-graph'];
      const id = (plugin.graph.people as Array<{ id: string; name: string }>).find((item) => item.name === 'Emily Carter')!.id;
      await app.workspace.openLinkText(id, '', false);
    });
    await browser.pause(1500);
    await screenshot(path.join(MEDIA, 'data-card.png'));
  });
});
