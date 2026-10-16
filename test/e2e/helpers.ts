import * as fs from 'node:fs';
import * as path from 'node:path';
import { browser } from '@wdio/globals';
import { Key } from 'webdriverio';

/** The test vaults: the submodule, or another checkout named by LINEAGE_TEST_VAULTS. */
export const FIXTURES = path.resolve(process.env.LINEAGE_TEST_VAULTS ?? path.join(import.meta.dirname, '..', 'fixtures'));
export const vaultDir = (name: string) => path.join(FIXTURES, 'vaults', name);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const expected = (name: string): any => JSON.parse(fs.readFileSync(path.join(vaultDir(name), 'expected.json'), 'utf8'));
export const importFile = (name: string) => path.join(FIXTURES, 'imports', name);

const PLUGIN = 'genealogy-graph';

/**
 * The layout the UI tests run in: the computer (default), or Obsidian's own mobile mode (app.emulateMobile) in a window
 * the size of a phone or a tablet, set by LAYOUT=phone|tablet (npm run test:e2e:phone, test:e2e:tablet).
 */
export const LAYOUT = (process.env.LAYOUT ?? 'desktop') as 'desktop' | 'phone' | 'tablet';
const WINDOW: Record<typeof LAYOUT, [number, number]> = { desktop: [1600, 1000], phone: [430, 932], tablet: [1180, 820] };

/** Turns Obsidian's mobile mode on or off (the app reloads) and sizes the window for `layout`. */
export async function useLayout(layout: typeof LAYOUT) {
  const mobile = layout !== 'desktop';
  if (await browser.execute(() => document.body.classList.contains('emulate-mobile')) !== mobile) {
    await browser.executeObsidian(({ app }, mobile) => { (app as unknown as { emulateMobile(on: boolean): void }).emulateMobile(mobile); }, mobile);
    await browser.waitUntil(() => browser.execute((mobile) => document.body?.classList.contains('emulate-mobile') === mobile && Boolean((window as unknown as { app?: { workspace?: { layoutReady?: boolean } } }).app?.workspace?.layoutReady), mobile),
      { timeout: 30000, interval: 300, timeoutMsg: 'the app did not reload in the new mode' });
  }
  // WebDriver cannot resize an Electron window; Obsidian's own Electron can.
  await browser.executeObsidian((_, width, height) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const remote = (window as unknown as { require(id: string): { getCurrentWindow(): { setSize(w: number, h: number): void; unmaximize(): void } } }).require('@electron/remote');
    const win = remote.getCurrentWindow(); win.unmaximize(); win.setSize(width, height);
  }, ...WINDOW[layout]);
}

/** Opens a fresh copy of a test vault and the graph in it; errors in the console from then on are collected. */
export async function openVault(name: string, { graph = true } = {}) {
  await browser.reloadObsidian({ vault: vaultDir(name) });
  await useLayout(LAYOUT);
  await browser.pause(300);
  await browser.executeObsidian(() => {
    const errors: string[] = [];
    (window as unknown as { lineageErrors: string[] }).lineageErrors = errors;
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); original(...args); };
    window.addEventListener('error', (event) => errors.push(String(event.message)));
    window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  });
  await waitIndexed();
  if (graph) await openGraph();
}

/** Waits until Obsidian has indexed the vault and the plugin has built its graph from it. */
export async function waitIndexed() {
  await browser.waitUntil(() => browser.executeObsidian(({ app }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = app.metadataCache as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = (app as any).plugins.plugins['genealogy-graph'];
    return Boolean(plugin) && !cache.inProgressTaskCount && plugin.graphVersion > 0 && plugin.refreshTimer === null;
  }), { timeout: 30000, interval: 200, timeoutMsg: 'the vault was not indexed' });
}

export async function openGraph() {
  await browser.executeObsidianCommand(`${PLUGIN}:open-graph`);
  await browser.waitUntil(() => browser.executeObsidian(({ app }) => Boolean(app.workspace.getLeavesOfType('genealogy-graph-view')[0])), { timeout: 20000, timeoutMsg: 'the graph did not open' });
  await waitSettled();
}

export const consoleErrors = () => browser.executeObsidian(() => (window as unknown as { lineageErrors?: string[] }).lineageErrors ?? []);

/** Waits until the layout comes to rest. */
export async function waitSettled(timeout = 20000) {
  await browser.waitUntil(() => browser.executeObsidian(({ app }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0]?.view as any;
    return Boolean(view?.layout) && !view.layout.running && !view.cameraFrame;
  }), { timeout, interval: 200, timeoutMsg: 'the layout did not come to rest' });
}

/** What the graph shows now. */
export function state() {
  return browser.executeObsidian(({ app }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0]?.view as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = (app as any).plugins.plugins['genealogy-graph'];
    return {
      people: plugin.graph.people.length as number,
      issues: plugin.graph.issues.length as number,
      clarify: plugin.clarifications.size as number,
      visible: view.visibleNodes.length as number,
      visibleEdges: view.visibleEdges.length as number,
      status: view.status.textContent as string,
      focus: [...view.focus] as string[],
      pathMode: view.pathMode as boolean, pathEnds: [...view.pathEndpoints] as string[],
      rootsMode: view.rootsMode as boolean, roots: [...view.rootIds] as string[],
      cuts: plugin.settings.cuts.length as number,
      settings: JSON.parse(JSON.stringify(plugin.settings)),
    };
  });
}

/**
 * Brings a person to the middle of the graph and returns where they are on screen. The camera jumps, it does not
 * glide, so the point is exact.
 */
export async function showNode(id: string): Promise<{ x: number; y: number }> {
  await clearGraph();
  await waitSettled();
  const point = await browser.executeObsidian(({ app }, id) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
    const node = view.nodeById.get(id);
    if (!node || !view.nodeViews.has(id)) return null;
    // The camera stops following the graph, as after the user pans it, so it stays where it is put.
    view.stopFollowing();
    view.snapCamera({ cx: node.x, cy: node.y, zoom: 1.2 });
    view.render();
    const rect = view.panel.getBoundingClientRect();
    return { x: Math.round(rect.left + view.cameraX + node.x * view.zoom), y: Math.round(rect.top + view.cameraY + node.y * view.zoom) };
  }, id);
  if (!point) throw new Error(`${id} is not on the graph`);
  return point;
}

/**
 * On a phone or a tablet Obsidian's sidebars are drawers over the graph, and on a phone the open side panel covers it:
 * before the graph is touched they are put away, as one would do with a finger.
 */
export async function clearGraph() {
  if (LAYOUT === 'desktop') return;
  await browser.executeObsidian(({ app }) => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  if (LAYOUT === 'phone') await browser.execute(() => (document.querySelector('.genealogy-controls:not(.is-close) .mod-close') as HTMLElement | null)?.click());
  await browser.pause(300);
}

/** The side form in sight: on a phone or a tablet its drawer is opened, as one would to edit. */
export async function showEditor() {
  if (LAYOUT === 'desktop') return;
  await browser.executeObsidian(({ app }) => { app.workspace.rightSplit.expand(); });
  await browser.pause(300);
}

/** The generation rail in sight: on a phone it is folded into a button over «Я». */
export async function openRail() {
  await browser.execute(() => {
    const toggle = document.querySelector<HTMLElement>('.genealogy-rail-toggle');
    if (toggle && toggle.getClientRects().length && !toggle.hasClass('is-active')) toggle.click();
  });
  await browser.pause(200);
}

/** The side panel of the graph, folded: on a phone it is folded already at start. */
export async function closeControls() {
  await browser.execute(() => (document.querySelector('.genealogy-controls:not(.is-close) .mod-close') as HTMLElement | null)?.click());
}

/** The side panel of the graph, opened: on a phone it starts folded. */
export async function openControls() {
  await browser.execute(() => (document.querySelector('.genealogy-controls.is-close .mod-open') as HTMLElement | null)?.click());
}

/** A real click on a person: Shift held, or a double click, or the right button. */
export async function clickNode(id: string, { shift = false, double = false, right = false } = {}) {
  const { x, y } = await showNode(id);
  const pointer = browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x, y, origin: 'viewport' });
  const button = right ? 2 : 0;
  pointer.down({ button }).up({ button });
  if (double) pointer.pause(80).down({ button }).up({ button });
  if (shift) await browser.actions([browser.action('key').down(Key.Shift), pointer, browser.action('key').up(Key.Shift)]);
  else await pointer.perform();
  // Every person is brought to the same spot: a next click sooner than the plugin's double-click time (400 ms)
  // would count as a double click.
  await browser.pause(450);
}

/** A click at a point of the graph in its own units (an empty spot, a link). */
export async function clickGraphPoint(gx: number, gy: number) {
  await clearGraph();
  await waitSettled();
  const { x, y } = await browser.executeObsidian(({ app }, gx, gy) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
    const rect = view.panel.getBoundingClientRect();
    return { x: Math.round(rect.left + view.cameraX + gx * view.zoom), y: Math.round(rect.top + view.cameraY + gy * view.zoom) };
  }, gx, gy);
  await browser.action('pointer').move({ x, y, origin: 'viewport' }).down().up().perform();
  await browser.pause(150);
}

/** Sets plugin settings and lets the graph and the form follow, as the settings tab does. */
export async function setSettings(change: Record<string, unknown>) {
  await browser.executeObsidian(async ({ app }, change) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = (app as any).plugins.plugins['genealogy-graph'];
    const language = 'language' in change;
    Object.assign(plugin.settings, change);
    await plugin.saveSettings();
    if (language) await plugin.languageChanged(); else plugin.settingsChanged('view');
  }, change);
  await browser.pause(300);
}

/** Vault paths of the files under a folder ('' for all). */
export const vaultFiles = (folder = '') => browser.executeObsidian(({ app }, folder) => app.vault.getFiles().map((file) => file.path).filter((p) => !folder || p.startsWith(`${folder}/`)).sort(), folder);

export const readNote = (path: string) => browser.executeObsidian(async ({ app, obsidian }, path) => {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof obsidian.TFile ? app.vault.read(file) : null;
}, path);

/** Waits for the plugin to rebuild the graph after a change in the vault. */
export async function waitPeople(count: number) {
  await browser.waitUntil(async () => (await state()).people === count, { timeout: 15000, timeoutMsg: `the graph does not have ${count} people` });
}

/** The title on the graph's tab. */
export const tabTitle = () => browser.executeObsidian(({ app }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaf = app.workspace.getLeavesOfType('genealogy-graph-view')[0] as any;
  return leaf?.tabHeaderInnerTitleEl?.textContent as string | undefined;
});

/** A point of the graph in its own units with no person and no link near it, inside the view. */
export const emptyPoint = async () => { await waitSettled(); return browser.executeObsidian(({ app }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
  const rect = view.panel.getBoundingClientRect();
  for (let sy = 0.3; sy < 0.8; sy += 0.05) for (let sx = 0.2; sx < 0.8; sx += 0.05) {
    const gx = (rect.width * sx - view.cameraX) / view.zoom; const gy = (rect.height * sy - view.cameraY) / view.zoom;
    const clientX = rect.left + rect.width * sx; const clientY = rect.top + rect.height * sy;
    if (document.elementFromPoint(clientX, clientY) !== view.canvas || view.hitAt({ clientX, clientY })) continue;
    const near = view.visibleNodes.some((node: { x: number; y: number }) => Math.hypot(node.x - gx, node.y - gy) < 90);
    if (!near) return { x: gx, y: gy };
  }
  throw new Error('no empty spot on the graph');
}); };

/** A tap on an empty spot of the graph as it is now, with whatever is open over it left in place. */
export async function tapEmpty() {
  const point = await browser.executeObsidian(({ app }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
    const rect = view.panel.getBoundingClientRect();
    for (let sy = 0.25; sy < 0.85; sy += 0.04) for (let sx = 0.15; sx < 0.9; sx += 0.04) {
      const clientX = Math.round(rect.left + rect.width * sx), clientY = Math.round(rect.top + rect.height * sy);
      if (document.elementFromPoint(clientX, clientY) === view.canvas && !view.hitAt({ clientX, clientY })) return { x: clientX, y: clientY };
    }
    return null;
  });
  if (!point) throw new Error('no empty spot on the graph');
  await browser.action('pointer').move({ ...point, origin: 'viewport' }).down().up().perform();
  await browser.pause(450);
}

/** Keyboard focus on the graph, as after a click on it. */
export const focusGraph = () => browser.executeObsidian(({ app }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
  app.workspace.setActiveLeaf(view.leaf, { focus: true });
  view.panel.focus();
});

/** Values of the text fields of the side form, in order. */
export const formValues = () => browser.executeObsidian(() => [...document.querySelectorAll<HTMLInputElement>('.genealogy-editor input[type=text]')].map((input) => input.value));

/** A field of the side form by its label: a text input or a dropdown. */
export async function formField(label: string) {
  await showEditor();
  const row = browser.$('.genealogy-editor').$(`label=${label}`).parentElement();
  const select = row.$('select');
  return (await select.isExisting()) ? select : row.$('input');
}

export async function fillForm(values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    const field = await formField(label);
    if ((await field.getTagName()) === 'select') await field.selectByAttribute('value', value);
    else await field.setValue(value);
  }
}

/** Waits for a file to appear in the vault. */
export async function waitFile(path: string, timeout = 15000) {
  await browser.waitUntil(async () => (await vaultFiles()).includes(path), { timeout, timeoutMsg: `${path} did not appear` });
}

/** The frontmatter of a note as Obsidian's metadata cache has it. */
export const frontmatter = (path: string) => browser.executeObsidian(({ app, obsidian }, path) => {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof obsidian.TFile ? JSON.parse(JSON.stringify(app.metadataCache.getFileCache(file)?.frontmatter ?? null)) : null;
}, path);

/** Selects one person, unless they are the only one selected already (a click would deselect them). */
export async function selectOnly(id: string) {
  const now = await browser.executeObsidian(({ app }) => [...(app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any).focus] as string[]);
  if (now.length === 1 && now[0] === id) return;
  await clickNode(id);
}
