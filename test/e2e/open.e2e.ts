import { browser, expect } from '@wdio/globals';
import { consoleErrors, expected, openVault, state, tabTitle } from './helpers';

describe('[OPEN] opening the graph', () => {
  const want = expected('scenarios');
  before(() => openVault('scenarios'));

  it('[OPEN-01] the command opens the graph with every person and link of the vault', async () => {
    const now = await state();
    expect(now.people).toBe(want.people.count);
    expect(now.status).toBe(`${want.people.count} человек · ${want.edges.count} связей`);
    expect(await tabTitle()).toBe('Родословный граф');
  });

  it('[OPEN-02] broken portraits, strange names and broken links leave no errors in the console', async () => {
    expect(await consoleErrors()).toEqual([]);
  });

  it('[OPEN-03] «Найти себя» selects the «me» card', async () => {
    await browser.$('.genealogy-me-button').click();
    expect((await state()).focus).toEqual([want.self]);
  });
});

describe('[OPEN] an empty vault', () => {
  before(() => openVault('empty'));

  it('[OPEN-04] invites to add the first person', async () => {
    await expect(browser.$('.genealogy-empty')).toBeDisplayed();
    await expect(browser.$('.genealogy-empty-text')).toHaveText('Добавьте первого человека — например, себя');
  });
});
