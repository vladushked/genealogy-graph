import { browser, expect } from '@wdio/globals';
import { importFile, openVault, state, vaultFiles, waitPeople } from './helpers';

async function chooseFile(name: string) {
  await browser.executeObsidianCommand('genealogy-graph:import-family-tree');
  const input = browser.$('.modal input[type=file]');
  await input.waitForExist();
  await input.setValue(importFile(name));
  await browser.$('.modal').$('button=Импортировать').waitForExist({ timeout: 15000 });
}

describe('[IMPORT] importing a family tree', () => {
  before(() => openVault('empty'));

  it('[IMPORT-05] GEDCOM: the summary, then cards in family folders and a report note', async () => {
    await chooseFile('family-7.0.ged');
    const modal = browser.$('.modal');
    await expect(modal).toHaveText(expect.stringContaining('family-7.0.ged: 4 человек'));
    await expect(modal).toHaveText(expect.stringContaining('Новых карточек: 4'));
    await modal.$('button=Импортировать').click();
    await expect(modal).toHaveText(expect.stringContaining('Готово: создано 4'));
    await modal.$('button=Открыть отчёт').click();
    await waitPeople(4);
    const files = await vaultFiles();
    expect(files).toEqual(expect.arrayContaining(['Озеровы/Озеров Иван Петрович 1862-1931.md', 'Соколовы/Соколова Мария Андреевна 1866-?.md']));
    expect(files.some((file) => /^Импорт family-7\.0 \d{4}-\d{2}-\d{2}\.md$/.test(file))).toBe(true);
    expect((await state()).status).toBe('4 человек · 5 связей');
  });

  it('[IMPORT-06] the same file again creates no duplicates', async () => {
    await chooseFile('family-7.0.ged');
    await expect(browser.$('.modal')).toHaveText(expect.stringContaining('Новых карточек: 0'));
    await browser.$('.modal').$('button=Отмена').click();
  });

  it('[IMPORT-07] a file that is not a family tree is refused with an explanation', async () => {
    await browser.executeObsidianCommand('genealogy-graph:import-family-tree');
    await browser.$('.modal input[type=file]').setValue(importFile('broken.ged'));
    await expect(browser.$('.modal .mod-warning')).toHaveText(expect.stringContaining('Это не файл GEDCOM'));
    await browser.keys('Escape');
  });
});
