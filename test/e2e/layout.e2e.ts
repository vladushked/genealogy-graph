import { browser, expect } from '@wdio/globals';
import { closeControls, LAYOUT, openVault } from './helpers';

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
      const visible = (el: Element | null) => el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
      const parts: Array<[string, Element]> = [];
      for (const [name, selector] of [['corner', '.genealogy-corner > *'], ['focus', '.genealogy-focus-bar'], ['generations', '.genealogy-left'], ['dock', '.genealogy-dock'],
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
});
