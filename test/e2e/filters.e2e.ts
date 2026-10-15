import { browser, expect } from '@wdio/globals';
import { clickGraphPoint, clickNode, openControls, openVault, state, waitSettled } from './helpers';

/** The settings panel section of the graph, opened. */
async function section(title: string) {
  await openControls();
  const header = browser.$(`.graph-control-section-header=${title}`);
  const item = header.parentElement().parentElement().parentElement();
  if ((await item.getAttribute('class')).includes('is-collapsed')) await header.click();
  return item;
}

describe('[FILTERS] filters and hidden branches', () => {
  before(() => openVault('scenarios'));

  it('[FILTERS-01] «Скрыть несоединённых» hides people without links', async () => {
    const lonely = await browser.executeObsidian(({ app }) => {
      const plugin = (app as any).plugins.plugins['genealogy-graph'];
      const linked = new Set(plugin.graph.edges.flatMap((edge: { from: string; to: string }) => [edge.from, edge.to]));
      return plugin.graph.people.filter((person: { id: string }) => !linked.has(person.id)).length as number;
    });
    const before = (await state()).visible;
    const filters = await section('Фильтры');
    await filters.$('.setting-item-name=Скрыть несоединённых').parentElement().parentElement().$('.checkbox-container').click();
    await browser.pause(400);
    expect((await state()).visible).toBe(before - lonely);
    await filters.$('.setting-item-name=Скрыть несоединённых').parentElement().parentElement().$('.checkbox-container').click();
  });

  it('[FILTERS-02] «Глубина» limits the view to steps around the selected', async () => {
    await clickNode('Озеровы/Озеров Лев Денисович 2020-.md');
    const filters = await section('Фильтры');
    await filters.$('.setting-item-name=Глубина').parentElement().parentElement().$('select').selectByAttribute('value', '1');
    await browser.pause(400);
    expect((await state()).visible).toBe(3); // Лев and his parents
    await filters.$('.setting-item-name=Глубина').parentElement().parentElement().$('select').selectByAttribute('value', '0');
  });

  it('[FILTERS-03] a link between generations: click, the eye hides the far side, «+N» brings it back', async () => {
    await waitSettled();
    // The link from Пётр Озеров up to his parents Агафья and Иван: the side away from «me» is the smaller one.
    const mid = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any;
      const pyotr = view.nodeById.get('Озеровы/Озеров Пётр Иванович 1862-1931.md');
      view.stopFollowing(); view.snapCamera({ cx: pyotr.x, cy: pyotr.y, zoom: 1 }); view.render();
      const target = [...view.links.values()].find((link: any) => link.edges.some((edge: any) => edge.to === pyotr.id && edge.relation === 'parent') && link.line);
      if (!target) return null;
      // The middle of the link in the middle of the screen: on a phone the generation rail covers the left edge.
      const mid = { x: (target.line.x1 + target.line.x2) / 2, y: (target.line.y1 + target.line.y2) / 2 };
      view.snapCamera({ cx: mid.x, cy: mid.y, zoom: 1 }); view.render();
      return mid;
    });
    if (!mid) throw new Error('no link up from Пётр Озеров on screen');
    await clickGraphPoint(mid.x, mid.y);
    const eye = await browser.executeObsidian(({ app }) => { const view = app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any; view.render(); return view.eyeAt; });
    expect(eye).not.toBeNull();
    const before = (await state()).visible;
    await clickGraphPoint(eye.x, eye.y);
    await browser.pause(400);
    const after = await state();
    expect(after.cuts).toBe(1);
    expect(after.visible).toBeLessThan(before);
    const filters = await section('Фильтры');
    await filters.$('button=Показать всё').click();
    await browser.pause(400);
    expect((await state()).cuts).toBe(0);
    expect((await state()).visible).toBe(before);
  });
});
