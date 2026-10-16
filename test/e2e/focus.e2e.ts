import { browser, expect } from '@wdio/globals';
import { closeControls, openVault, state, openRail } from './helpers';

describe('[FOCUS] focus, highlight, generation by generation', () => {
  before(() => openVault('scenarios'));

  it('[FOCUS-01] «Число родственников» changes the focus and the highlight column', async () => {
    // By their tooltips: on a phone the focus buttons are icons only.
    await browser.$('.genealogy-focus-bar').$('button[aria-label^="Фокус на числе"]').click();
    expect((await state()).settings.focus).toBe('relatives');
    await expect(browser.$$('.genealogy-generation-chip')).toBeElementsArrayOfSize({ gte: 2 });
    await browser.$('.genealogy-focus-bar').$('button[aria-label^="Фокус на поколениях"]').click();
    expect((await state()).settings.focus).toBe('generations');
  });

  it('[FOCUS-02] a generation chip highlights its people; «все» clears', async () => {
    await openRail();
    await browser.$('.genealogy-generation-rail').$('button=0').click();
    expect((await state()).settings.highlightGenerations).toEqual([0]);
    expect((await state()).status).toContain('0: '); // The status line is hidden on a phone.
    await browser.$('.genealogy-generation-reset').click();
    expect((await state()).settings.highlightGenerations).toEqual([]);
  });

  it('[FOCUS-02b] every generation chip on is the same as «все»: nothing is highlighted', async () => {
    // The rail is drawn anew after each press: each chip is looked up again.
    await openRail();
    const count = await browser.$$('.genealogy-generation-chip').length;
    for (let i = 0; i < count; i++) await browser.$$('.genealogy-generation-chip')[i].click();
    expect((await state()).settings.highlightGenerations).toEqual([]);
    await expect(browser.$$('.genealogy-generation-chip.is-active')).toBeElementsArrayOfSize(0);
  });

  it('[FOCUS-03] «Поколение за поколением» shows titles and stops on a second press', async () => {
    await closeControls();
    const play = browser.$('.graph-controls-button.mod-animate:not(.genealogy-free-button)');
    await play.click();
    await expect(browser.$('.genealogy-credits-title')).toHaveText(expect.stringContaining('Поколение'));
    await play.click();
    expect((await state()).visible).toBe((await state()).people);
  });

  it('[FOCUS-04] «Отпустить граф» keeps the layout moving until pressed again', async () => {
    const free = browser.$('.genealogy-free-button');
    await free.click();
    expect((await state()).settings.freeLayout).toBe(true);
    await browser.pause(3000);
    expect(await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any).layout.running)).toBe(true);
    await free.click();
    expect((await state()).settings.freeLayout).toBe(false);
  });
});
