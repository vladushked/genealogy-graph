import { browser, expect } from '@wdio/globals';
import { expected, openVault, showNode, vaultFiles, openControls } from './helpers';

/** Graph input on a touch screen: the gestures of a phone, sent as real touch pointers. */
const camera = () => browser.executeObsidian(({ app }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
  const rect = view.panel.getBoundingClientRect();
  return { zoom: view.zoom as number, x: view.cameraX as number, y: view.cameraY as number,
    cx: Math.round(rect.left + rect.width / 2), cy: Math.round(rect.top + rect.height / 2) };
});

const finger = (name: string) => browser.action('pointer', { id: name, parameters: { pointerType: 'touch' } });

describe('[TOUCH] touch screen', () => {
  const want = expected('scenarios');
  before(async () => { await openVault('scenarios'); });

  it('[TOUCH-01] two fingers spreading apart zoom in around their middle', async () => {
    const before = await camera();
    const { cx, cy } = before;
    const a = finger('a').move({ x: cx - 40, y: cy, origin: 'viewport' }).down().pause(50);
    const b = finger('b').move({ x: cx + 40, y: cy, origin: 'viewport' }).down().pause(50);
    for (let step = 1; step <= 6; step++) {
      a.move({ x: cx - 40 - step * 20, y: cy, origin: 'viewport', duration: 16 });
      b.move({ x: cx + 40 + step * 20, y: cy, origin: 'viewport', duration: 16 });
    }
    a.up(); b.up();
    await browser.actions([a, b]);
    const after = await camera();
    // The fingers went from 80 to 320 px apart: four times closer.
    expect(after.zoom / before.zoom).toBeGreaterThan(3.5);
    expect(after.zoom / before.zoom).toBeLessThan(4.5);
    expect(await browser.$('.menu').isExisting()).toBe(false);
  });

  it('[TOUCH-02] a finger held on a person opens their menu, and lifting it keeps the menu open', async () => {
    const { x, y } = await showNode(want.self);
    await finger('a').move({ x, y, origin: 'viewport' }).down().pause(800).up().perform();
    await browser.pause(300);
    const menu = browser.$('.menu');
    await expect(menu).toBeDisplayed();
    await expect(menu).toHaveText(expect.stringContaining('Открыть заметку'));
    await browser.keys('Escape');
    await expect(menu).not.toBeExisting();
  });

  it('[TOUCH-03] a short tap selects, without a menu', async () => {
    const { x, y } = await showNode(want.self);
    await finger('a').move({ x, y, origin: 'viewport' }).down().pause(60).up().perform();
    await browser.pause(450);
    expect(await browser.$('.menu').isExisting()).toBe(false);
    const focus = await browser.executeObsidian(({ app }) => [...(app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as unknown as { focus: Set<string> }).focus]);
    expect(focus).toEqual([want.self]);
  });

  it('[TOUCH-04] a double tap opens the profile, and lifting the finger keeps it open', async () => {
    const { x, y } = await showNode(want.self);
    await finger('a').move({ x, y, origin: 'viewport' }).down().pause(40).up().pause(120).down().pause(40).up().perform();
    await browser.pause(500);
    const profile = browser.$('.modal.genealogy-profile');
    await expect(profile).toBeDisplayed();
    await browser.keys('Escape');
    await expect(profile).not.toBeExisting();
  });

  it('[TOUCH-05] on a phone the export is saved into the vault, as a download does nothing there', async () => {
    const wasMobile = await browser.executeObsidian(({ obsidian }) => { const platform = obsidian.Platform as { isMobile: boolean }; const was = platform.isMobile; platform.isMobile = true; return was; });
    try {
      await openControls();
      const header = browser.$('.graph-control-section-header=Экспорт');
      const section = header.parentElement().parentElement().parentElement();
      if ((await section.getAttribute('class')).includes('is-collapsed')) await header.click();
      await section.$('button=Экспорт…').click();
      const dialog = browser.$('.genealogy-export');
      await dialog.waitForDisplayed();
      await dialog.$('button=Экран').click();
      await dialog.$('button=SVG').click();
      await browser.$('.genealogy-export-side').$('button=Сохранить файл').click();
      await browser.waitUntil(async () => (await vaultFiles()).some((path) => path.endsWith('genealogy-graph.svg')), { timeout: 30000, timeoutMsg: 'the SVG is not in the vault' });
      await expect(browser.$('.notice-container')).toHaveText(expect.stringContaining('Граф сохранён в хранилище'));
    } finally {
      await browser.executeObsidian(({ obsidian }, was) => { (obsidian.Platform as { isMobile: boolean }).isMobile = was; }, wasMobile);
    }
  });
});
