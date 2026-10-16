import * as fs from 'node:fs';
import * as path from 'node:path';
import { browser } from '@wdio/globals';
import { expected, openGraph, openVault, showNode, useLayout, waitSettled } from './helpers';

/**
 * Obsidian's own mobile mode (app.emulateMobile) on a screen the size of an iPhone 16 Pro Max, with touch input, and
 * screenshots of the graph in test-results/phone/. It is Chromium, not iOS WebKit: the layout and the gestures show,
 * Safari's own quirks do not.
 */
const SHOTS = path.resolve('test-results', 'phone');
const WIDTH = 430, HEIGHT = 932;
const shot = async (name: string) => { await browser.pause(400); await browser.saveScreenshot(path.join(SHOTS, `${name}.png`)); };
const finger = () => browser.action('pointer', { id: 'finger', parameters: { pointerType: 'touch' } });
const tap = async (selector: string) => { await browser.execute((selector) => (document.querySelector(selector) as HTMLElement | null)?.click(), selector); await browser.pause(300); };

/** The phone layout, and touch input for the gestures. */
async function phoneScreen() {
  await useLayout('phone');
  await browser.executeObsidian((_, width, height) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = (window as any).require('@electron/remote').getCurrentWebContents();
    try { contents.debugger.attach('1.3'); } catch { /* already attached */ }
    void contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
    void contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }, WIDTH, HEIGHT);
  await browser.pause(800);
}

describe('[PHONE] the graph on a phone', () => {
  const self = expected('showcase').self;
  before(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await openVault('showcase', { graph: false });
    await phoneScreen();
    await openGraph();
  });

  it('screens', async () => {
    await waitSettled();
    await shot('1-graph');
    await tap('.genealogy-rail-toggle');
    await browser.execute(() => [...document.querySelectorAll<HTMLElement>('.genealogy-generation-chip')].find((chip) => chip.textContent?.startsWith('−1'))?.click());
    await shot('1b-generations');
    await tap('.genealogy-rail-toggle');
    await shot('1c-folded');
    await tap('.genealogy-controls .mod-open');
    await shot('2-controls');
    await tap('.genealogy-controls .mod-close');
    let { x, y } = await showNode(self);
    await finger().move({ x, y, origin: 'viewport' }).down().pause(40).up().perform();
    await waitSettled();
    await shot('3-selected');
    ({ x, y } = await showNode(self));
    await finger().move({ x, y, origin: 'viewport' }).down().pause(800).up().perform();
    await shot('4-menu');
    // The phone menu is a sheet that a tap outside closes.
    await finger().move({ x: Math.round(WIDTH / 2), y: 120, origin: 'viewport' }).down().pause(40).up().perform();
    await browser.waitUntil(async () => !(await browser.$('.menu').isExisting()), { timeout: 3000, timeoutMsg: 'the menu stayed open' });
    await browser.pause(450);
    ({ x, y } = await showNode(self));
    await finger().move({ x, y, origin: 'viewport' }).down().pause(40).up().pause(120).down().pause(40).up().perform();
    await shot('5-profile');
    await browser.keys('Escape');
    await tap('.genealogy-dock .genealogy-dock-button:nth-of-type(2)');
    await shot('6-route');
    await tap('.genealogy-dock .genealogy-dock-button:nth-of-type(2)');
    await tap('.genealogy-clarify-button');
    await shot('7-clarify');
    await tap('.genealogy-clarify-button');
    await tap('.genealogy-controls .mod-open');
    await browser.execute(() => {
      const header = [...document.querySelectorAll<HTMLElement>('.genealogy-controls .graph-control-section-header')].find((el) => /Export|Экспорт/.test(el.textContent ?? ''));
      const section = header?.closest('.graph-control-section');
      if (section?.hasClass('is-collapsed')) header!.click();
    });
    await browser.pause(300);
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>('.genealogy-controls button')].find((el) => /Export…|Экспорт…/.test(el.textContent ?? ''))?.click());
    await browser.$('.genealogy-export').waitForDisplayed();
    await shot('8-export');
  });
});
