import { browser, expect } from '@wdio/globals';
import { expected, openVault, state } from './helpers';

describe('[AUDIT] Проблемы and Уточнить', () => {
  const want = expected('scenarios');
  before(() => openVault('scenarios'));

  it('[AUDIT-03] the problems button counts every problem; its list groups them by card', async () => {
    const count = want.issues.length + (want.generationIssueOneOf ? 1 : 0);
    const button = browser.$('.genealogy-problems-button');
    await expect(button).toHaveText(String(count));
    await button.click();
    await expect(browser.$('.genealogy-problems-title')).toHaveText(`Проблемы в карточках: ${count}`);
    const people = new Set(want.issues.map((issue: { source: string }) => issue.source));
    expect((await browser.$$('.genealogy-problems:not(.genealogy-clarify) .genealogy-problems-group').length)).toBeGreaterThanOrEqual(people.size);
    await expect(browser.$('.genealogy-problems')).toHaveText(expect.stringContaining('самоссылка'));
    await expect(browser.$('.genealogy-problems')).toHaveText(expect.stringContaining('нет карточки'));
    await expect(browser.$('.genealogy-problems')).toHaveText(expect.stringContaining('некорректное значение · sex: мужчина'));
  });

  it('[AUDIT-04] a name in the list shows the person on the graph', async () => {
    await browser.$('.genealogy-problems-person a').click();
    expect((await state()).focus.length).toBe(1);
    await browser.$('.genealogy-problems-button').click();
  });

  it('[AUDIT-05] Уточнить lists the least filled cards first', async () => {
    const now = await state();
    const button = browser.$('.genealogy-clarify-button');
    await expect(button).toHaveText(String(now.clarify));
    await button.click();
    await expect(browser.$('.genealogy-clarify .genealogy-problems-title')).toHaveText(`Уточнить: ${now.clarify} чел.`);
    await expect(browser.$('.genealogy-clarify')).toHaveText(expect.stringContaining('не заполнено: фамилия, отчество'));
  });
});
