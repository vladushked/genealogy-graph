import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { clickNode, expected, focusGraph, openVault, state } from './helpers';

describe('[ROUTE] kinship route', () => {
  const want = expected('scenarios');
  before(() => openVault('scenarios'));

  for (const route of want.routes) {
    it(`[ROUTE-02] ${route.from.replace(/^.*\//, '')} → ${route.to.replace(/^.*\//, '')}: ${route.ru ?? 'not related'}`, async () => {
      if (!(await state()).pathMode) await browser.$('.genealogy-dock-button .svg-icon.lucide-route').parentElement().click();
      await browser.executeObsidian(({ app }) => { const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any; view.pathEndpoints = []; view.refresh(); });
      await clickNode(route.from);
      await clickNode(route.to);
      expect((await state()).pathEnds).toEqual([route.from, route.to]);
      const card = browser.$('.genealogy-route-card');
      if (route.steps === null) { await expect(card).toHaveText(expect.stringContaining('Эти люди не связаны')); return; }
      await expect(card.$('.genealogy-route-status')).toHaveText(expect.stringContaining(`${route.steps} `));
      if (route.ru) await expect(card.$('.genealogy-kin-word')).toHaveText(route.ru);
    });
  }

  it('[ROUTE-03] ⇅ swaps the ends along the same route', async () => {
    const before = (await state()).pathEnds;
    await browser.$('.genealogy-route-swap').click();
    expect((await state()).pathEnds).toEqual([...before].reverse());
  });

  it('[ROUTE-04] Esc leaves the route mode', async () => {
    await focusGraph();
    await browser.keys(Key.Escape);
    expect((await state()).pathMode).toBe(false);
    await expect(browser.$('.genealogy-route-card')).not.toBeDisplayed();
  });
});

describe('[ROOTS] «Корни»', () => {
  const want = expected('scenarios');
  before(() => openVault('scenarios'));

  it('[ROOTS-02] from «me»: the number of ancestors and the oldest one', async () => {
    await browser.$('.genealogy-dock-button .svg-icon.lucide-sprout').parentElement().click();
    const now = await state();
    expect(now.rootsMode).toBe(true);
    expect(now.roots).toEqual([want.self]);
    const card = browser.$('.genealogy-route-card');
    await expect(card.$('.genealogy-route-status')).toHaveText(expect.stringContaining(`${want.roots[0].ancestors} предков`));
    await expect(card.$('.genealogy-roots-oldest')).toHaveText(expect.stringContaining('Озеров ?'));
  });

  it('[ROOTS-03] «Родня вокруг» shows more people at each step', async () => {
    const counts: number[] = [];
    for (const label of ['0', '1', '2']) {
      await browser.$('.genealogy-roots-depth').$(`button=${label}`).click();
      await browser.pause(400);
      counts.push((await state()).visible);
    }
    expect(counts[0]).toBe(want.roots[0].ancestors + 1);
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThanOrEqual(counts[1]);
  });
});
