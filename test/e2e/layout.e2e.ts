import { browser, expect } from '@wdio/globals';
import { clearGraph, closeControls, LAYOUT, openControls, openRail, openVault, tapEmpty } from './helpers';

/** The controls over the graph fit the screen in every layout (LAYOUT=phone|tablet for the mobile ones). */
describe(`[LAYOUT] controls over the graph, ${LAYOUT}`, () => {
  // «scenarios» has both problems and cards to clarify: the top row is at its widest.
  before(async () => { await openVault('scenarios'); await closeControls(); });

  it('[LAYOUT-01] every button shows its icon and its whole text', async () => {
    const broken = await browser.execute(() => [...document.querySelectorAll<HTMLElement>('.genealogy-view button, .genealogy-view .clickable-icon')]
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
      .flatMap((el) => {
        const faults: string[] = [];
        const icon = el.querySelector('svg');
        if (icon && icon.getBoundingClientRect().width < 4) faults.push('icon squeezed');
        if (el.scrollWidth > el.clientWidth + 1) faults.push('text cut');
        return faults.length ? [`${el.getAttribute('aria-label') ?? el.textContent}: ${faults.join(', ')}`] : [];
      }));
    expect(broken).toEqual([]);
  });

  it('[LAYOUT-02] the controls do not cover each other, and Obsidian\'s navigation bar covers none of them', async () => {
    const overlaps = await browser.execute(() => {
      const visible = (el: Element | null) => el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0
        && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
      const parts: Array<[string, Element]> = [];
      for (const [name, selector] of [['corner', '.genealogy-corner > *'], ['focus', '.genealogy-focus-bar'], ['generations', '.genealogy-left'], ['dock', '.genealogy-dock'], ['highlight', '.genealogy-rail-toggle'],
        ['zoom', '.genealogy-zoom'], ['panel', '.genealogy-controls'], ['navigation', '.mobile-navbar']] as const) {
        document.querySelectorAll(selector).forEach((el, i) => { if (visible(el)) parts.push([`${name}${i}`, el]); });
      }
      const found: string[] = [];
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i][1].getBoundingClientRect(), b = parts[j][1].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) found.push(`${parts[i][0]} × ${parts[j][0]}`);
      }
      const panel = document.querySelector('.genealogy-panel')!.getBoundingClientRect();
      for (const [name, el] of parts) {
        const r = el.getBoundingClientRect();
        if (name.startsWith('navigation')) continue;
        if (r.left < panel.left - 1 || r.right > panel.right + 1 || r.top < panel.top - 1 || r.bottom > panel.bottom + 1) found.push(`${name} off the graph`);
      }
      return found;
    });
    expect(overlaps).toEqual([]);
  });

  it('[LAYOUT-03] every highlighted generation keeps its color, not only the last one pressed', async () => {
    await openRail();
    const rail = browser.$('.genealogy-generation-rail');
    for (const label of ['−2', '−1', '+1']) await rail.$(`button*=${label}`).click();
    const chips = await browser.execute(() => [...document.querySelectorAll<HTMLElement>('.genealogy-generation-chip.is-active')].map((chip) => {
      const probe = document.body.createDiv(); probe.style.color = getComputedStyle(chip).getPropertyValue('--genealogy-chip');
      const want = getComputedStyle(probe).color; probe.remove();
      return { text: chip.textContent, background: getComputedStyle(chip).backgroundColor, want };
    }));
    expect(chips.length).toBe(3);
    for (const chip of chips) expect(chip.background).toBe(chip.want);
    await rail.$('.genealogy-generation-reset').click();
  });

  it('[LAYOUT-04] with the keyboard up the search stays above it, and its list opens above the field', async function () {
    if (LAYOUT !== 'phone') this.skip(); // Only Obsidian's phone layout shrinks for the keyboard and floats the dock.
    // Obsidian sets --keyboard-height while the on-screen keyboard is up, and the app shrinks above it.
    await browser.execute(() => document.documentElement.style.setProperty('--keyboard-height', '320px'));
    await browser.pause(300);
    const input = browser.$('.genealogy-dock-search input');
    await input.click();
    await browser.keys('Озер');
    await browser.pause(500);
    const geometry = await browser.execute(() => {
      const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
      const lists = [...document.querySelectorAll('.suggestion-container')].filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect());
      return { keyboardTop: window.innerHeight - 320, dock: rect('.genealogy-dock'), field: rect('.genealogy-dock-search input'), list: lists[0] ? { top: lists[0].top, bottom: lists[0].bottom } : null };
    });
    await browser.keys('Escape');
    await browser.execute(() => document.documentElement.style.removeProperty('--keyboard-height'));
    expect(geometry.dock.bottom).toBeLessThanOrEqual(geometry.keyboardTop - 4); // clear of the keyboard, not touching it
    expect(geometry.dock.top).toBeGreaterThan(geometry.keyboardTop - 120); // right above the keyboard, not floating high
    expect(geometry.list).not.toBeNull();
    expect(geometry.list!.bottom).toBeLessThanOrEqual(geometry.field.top); // not over the field, not under the keyboard
    expect(geometry.list!.top).toBeGreaterThanOrEqual(0);
  });

  it('[LAYOUT-05] phone: the rail folds into a button of dots as wide as two dock buttons; the cross, a free tap or moving the graph fold it', async function () {
    if (LAYOUT !== 'phone') this.skip();
    const toggle = browser.$('.genealogy-rail-toggle');
    const rail = browser.$('.genealogy-left');
    const isOpen = async () => (await toggle.getAttribute('class')).includes('is-active');
    await expect(toggle).toBeDisplayed();
    // LAYOUT-03 left the rail open: the cross folds it.
    if (await isOpen()) await toggle.click();
    await expect(rail).not.toBeDisplayed();
    // No wider than «Я» and the route button together.
    const width = await browser.execute(() => {
      const [me, route] = [...document.querySelectorAll('.genealogy-dock-button')].map((el) => el.getBoundingClientRect());
      return { toggle: document.querySelector('.genealogy-rail-toggle')!.getBoundingClientRect().width, two: route.right - me.left };
    });
    expect(width.toggle).toBeLessThanOrEqual(width.two + 1);
    await browser.pause(500);
    await toggle.click();
    await expect(rail).toBeDisplayed();
    await browser.$('.genealogy-generation-rail').$('button*=0').click();
    // The chosen generation's dot grows; the rail stays open for more, now with «все» on top.
    await expect(toggle.$$('.genealogy-rail-dot.is-active')).toBeElementsArrayOfSize(1);
    await expect(rail).toBeDisplayed();
    await browser.$('.genealogy-generation-reset').waitForDisplayed();
    await browser.pause(300);
    // A tap on empty space folds it, and only that: the highlight stays.
    await tapEmpty();
    await expect(rail).not.toBeDisplayed();
    await expect(toggle.$$('.genealogy-rail-dot.is-active')).toBeElementsArrayOfSize(1);
    // Dragging the graph folds it too.
    await toggle.click();
    await expect(rail).toBeDisplayed();
    await clearGraph();
    const panel = await browser.$('.genealogy-panel').getLocation();
    const size = await browser.$('.genealogy-panel').getSize();
    const x = Math.round(panel.x + size.width * 0.6), y = Math.round(panel.y + size.height * 0.45);
    await browser.action('pointer').move({ x, y, origin: 'viewport' }).down().move({ x: x + 60, y: y + 40, origin: 'viewport', duration: 200 }).up().perform();
    await expect(rail).not.toBeDisplayed();
    await toggle.click();
    await browser.$('.genealogy-generation-reset').click();
    await toggle.click();
    await expect(rail).not.toBeDisplayed();
  });

  it('[LAYOUT-06] Проблемы and Уточнить close by their cross; on a phone a free tap closes them and the side panel', async () => {
    const list = browser.$('.genealogy-clarify');
    await browser.$('.genealogy-clarify-button').click();
    await expect(list).toBeDisplayed();
    await list.$('.genealogy-problems-close').click();
    await expect(list).not.toBeDisplayed();
    if (LAYOUT !== 'phone') return;
    await browser.$('.genealogy-problems-button').click();
    await expect(browser.$('.genealogy-problems')).toBeDisplayed();
    await openControls();
    await tapEmpty();
    await expect(browser.$('.genealogy-problems')).not.toBeDisplayed();
    expect(await browser.$('.genealogy-controls').getAttribute('class')).toContain('is-close');
  });
});
