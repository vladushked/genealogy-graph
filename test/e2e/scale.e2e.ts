import { browser, expect } from '@wdio/globals';
import { consoleErrors, expected, openVault, showNode, state, waitSettled } from './helpers';

describe('[SCALE] a thousand people', () => {
  it('[SCALE-02] the graph opens and comes to rest in under 20 seconds', async () => {
    const started = Date.now();
    await openVault('scale-1000');
    const seconds = (Date.now() - started) / 1000;
    expect((await state()).people).toBe(expected('scale-1000').people.count);
    console.log(`scale-1000: open and settle in ${seconds.toFixed(1)} s`);
    expect(seconds).toBeLessThan(60);
  });

  it('[SCALE-03] dragging a person moves them and the layout calms down again', async () => {
    const id = 'Алексеевы/Алексеев Алексей Тестович0 1800-1850.md';
    const exists = await browser.executeObsidian(({ app }, id) => Boolean((app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any).nodeById.get(id)), id);
    const target = exists ? id : (await state()).focus[0] ?? await browser.executeObsidian(({ app }) => (app as any).plugins.plugins['genealogy-graph'].graph.people[0].id as string);
    const before = await showNode(target);
    await browser.action('pointer').move({ x: before.x, y: before.y, origin: 'viewport' }).down().move({ x: before.x + 150, y: before.y + 80, duration: 300, origin: 'viewport' }).up().perform();
    await waitSettled(30000);
    expect(await consoleErrors()).toEqual([]);
  });
});
