import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { clickGraphPoint, clickNode, emptyPoint, expected, focusGraph, formValues, openVault, state } from './helpers';

describe('[SELECT] selecting people', () => {
  const want = expected('scenarios');
  const denis = want.self;
  const elena = 'Озеровы/Озерова Елена Викторовна (Орлова) 1992-.md';
  before(async () => {
    await openVault('scenarios');
    await browser.executeObsidianCommand('genealogy-graph:open-person-editor');
  });

  it('[SELECT-01] a click selects a person and the side form shows their card', async () => {
    await clickNode(denis);
    expect((await state()).focus).toEqual([denis]);
    await expect(browser.$('.genealogy-editor-title')).toHaveText('Озеров Денис Сергеевич');
    expect(await formValues()).toEqual(expect.arrayContaining(['Озеров', 'Денис', 'Сергеевич', '1990-03-14']));
  });

  it('[SELECT-02] Shift adds to the selection, a click on a selected person deselects them', async () => {
    await clickNode(elena, { shift: true });
    expect((await state()).focus.sort()).toEqual([denis, elena].sort());
    await clickNode(denis);
    expect((await state()).focus).toEqual([elena]);
  });

  it('[SELECT-03] Esc clears the selection', async () => {
    await clickNode(elena);
    await focusGraph();
    await browser.keys(Key.Escape);
    expect((await state()).focus).toEqual([]);
  });

  it('[SELECT-04] a click on an empty spot clears the selection', async () => {
    await clickNode(denis);
    const spot = await emptyPoint();
    await clickGraphPoint(spot.x, spot.y);
    expect((await state()).focus).toEqual([]);
  });

  it('[SELECT-05] Ctrl+F searches people; namesakes differ by their years', async () => {
    await focusGraph();
    await browser.keys([Key.Ctrl, 'f']);
    await expect(browser.$('.genealogy-dock-search input')).toBeFocused();
    await browser.keys('Громов Александр');
    const items = browser.$$('.suggestion-container .suggestion-item');
    await expect(items).toBeElementsArrayOfSize(2);
    const texts = await items.map((item) => item.getText());
    expect(texts.join('\n')).toContain('1925–2001');
    expect(texts.join('\n')).toContain('р. 1968');
    await items[1].click();
    expect((await state()).focus.length).toBe(1);
  });
});
