import { browser, expect } from '@wdio/globals';
import { clickNode, fillForm, formField, selectOnly, formValues, frontmatter, openVault, setSettings, showEditor, state, vaultFiles, waitFile, waitIndexed, waitPeople } from './helpers';

const save = async () => { await showEditor(); await browser.$('.genealogy-editor-actions .mod-cta').click(); };
const addRelative = async (label: string) => { await showEditor(); await browser.$('.genealogy-editor-add').$(`button=${label}`).click(); };
const closeEditor = async () => { await showEditor(); await browser.$('.genealogy-editor-close').click(); };

describe('[EDIT] building a family tree from an empty vault', () => {
  before(() => openVault('empty'));

  it('[EDIT-01] the first person, marked as «me»', async () => {
    await browser.$('.genealogy-empty-add').click();
    await expect(browser.$('.genealogy-editor-title')).toHaveText('Новый человек');
    await fillForm({ Фамилия: 'Озеров', Имя: 'Денис', Отчество: 'Сергеевич', Пол: 'male', 'Дата рождения': '1990-03-14' });
    await expect(browser.$('.genealogy-editor-check input')).toBeSelected();
    await save();
    await waitPeople(1);
    await waitFile('Озеровы/Озеров Денис Сергеевич 1990-?.md');
    expect((await state()).settings.selfPersonId).toBe('Озеровы/Озеров Денис Сергеевич 1990-?.md');
    expect(await frontmatter('Озеровы/Озеров Денис Сергеевич 1990-?.md')).toMatchObject({ type: 'person', name: 'Озеров Денис Сергеевич', sex: 'male', birth_date: '1990-03-14' });
  });

  it('[EDIT-02] a child: the parent, surname and patronymic are filled in; the link is written into both cards', async () => {
    await selectOnly('Озеровы/Озеров Денис Сергеевич 1990-?.md');
    await addRelative('ребёнка');
    await fillForm({ Пол: 'male' });
    expect(await formValues()).toEqual(expect.arrayContaining(['Озеров', 'Денисович']));
    await fillForm({ Имя: 'Лев', 'Дата рождения': '2020' });
    await save();
    await waitPeople(2);
    expect((await frontmatter('Озеровы/Озеров Денис Сергеевич 1990-?.md')).children).toEqual(['[[Озеров Лев Денисович 2020-?]]']);
    expect((await frontmatter('Озеровы/Озеров Лев Денисович 2020-?.md')).parents).toEqual(['[[Озеров Денис Сергеевич 1990-?]]']);
  });

  it('[EDIT-03] a parent: a father named after the patronymic of the child', async () => {
    await selectOnly('Озеровы/Озеров Денис Сергеевич 1990-?.md');
    await addRelative('родителя');
    expect(await formValues()).toEqual(expect.arrayContaining(['Озеров', 'Сергей']));
    await save();
    await waitPeople(3);
    expect((await state()).status).toBe('3 человек · 2 связей');
  });

  it('[EDIT-04] a new birth year renames the card by the template; Obsidian updates the links', async () => {
    await selectOnly('Озеровы/Озеров Денис Сергеевич 1990-?.md');
    await fillForm({ 'Дата рождения': '1991-03-14' });
    await save();
    await waitFile('Озеровы/Озеров Денис Сергеевич 1991-?.md');
    await browser.waitUntil(async () => JSON.stringify(await frontmatter('Озеровы/Озеров Лев Денисович 2020-?.md')).includes('1991'), { timeout: 10000 });
    expect((await state()).settings.selfPersonId).toBe('Озеровы/Озеров Денис Сергеевич 1991-?.md');
  });
});

describe('[EDIT] name hints in other schemes', () => {
  before(() => openVault('international'));

  it('[EDIT-06] Spanish: a child of García Márquez and Barcha Pardo is García Barcha', async () => {
    await setSettings({ nameScheme: 'spanish' });
    await browser.executeObsidianCommand('genealogy-graph:open-person-editor');
    await clickNode('García/Gabriel José García Márquez 1927-2014.md');
    await addRelative('child');
    await fillForm({ Sex: 'male' });
    expect(await formValues()).toContain('García Barcha');
    await closeEditor();
  });

  it('[EDIT-07] Icelandic: a daughter of Jón Sigurðsson is Jónsdóttir, and no surname is asked first', async () => {
    await setSettings({ nameScheme: 'icelandic' });
    await clickNode('Iceland/Jón Sigurðsson 1930-2000.md');
    await addRelative('child');
    await fillForm({ Sex: 'female' });
    const labels = await browser.$$('.genealogy-editor-row label').map((label) => label.getText());
    expect(labels.slice(0, 3)).toEqual(['Given name', 'Patronymic', 'Family name']);
    expect(await formValues()).toContain('Jónsdóttir');
    await closeEditor();
  });

  it('[EDIT-08] a card of its own scheme: in a Russian vault a Spanish father\'s child is Spanish and keeps the scheme', async () => {
    await setSettings({ nameScheme: 'russian' });
    const gabriel = 'García/Gabriel José García Márquez 1927-2014.md';
    await browser.executeObsidian(async ({ app }, path) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await app.fileManager.processFrontMatter(app.vault.getAbstractFileByPath(path) as any, (frontmatter) => { frontmatter.name_scheme = 'spanish'; });
    }, gabriel);
    await browser.pause(500);
    await waitIndexed();
    // «Уточнить» asks him for no patronymic, though the vault's scheme has one.
    const notes = await browser.executeObsidian(({ app }, path) => ((app as any).plugins.plugins['genealogy-graph'].clarifications.get(path) ?? []).map((note: { text: string }) => note.text) as string[], gabriel);
    expect(notes.join(' ')).not.toMatch(/patronymic/i);
    await clickNode(gabriel);
    await addRelative('child');
    await fillForm({ Sex: 'male', 'Given names': 'Tomás' });
    expect(await formValues()).toContain('García Barcha');
    expect(await (await formField('Name scheme')).getValue()).toBe('spanish');
    await save();
    await browser.waitUntil(async () => (await vaultFiles('García')).some((path) => path.includes('Tomás García Barcha')), { timeout: 10000, timeoutMsg: 'no card for Tomás' });
    const path = (await vaultFiles('García')).find((item) => item.includes('Tomás García Barcha'))!;
    await waitFile(path);
    await browser.waitUntil(async () => (await frontmatter(path))?.name_scheme === 'spanish', { timeout: 5000, timeoutMsg: 'the new card has no name_scheme' });
  });

  it('[EDIT-09] a birth place in Spain suggests the Spanish scheme while the card follows the vault\'s', async () => {
    await browser.executeObsidianCommand('genealogy-graph:add-person');
    await showEditor();
    await browser.execute(() => { (document.querySelector('.genealogy-editor-details') as HTMLDetailsElement).open = true; });
    await fillForm({ 'Birth place': 'Sevilla, España' });
    const hint = browser.$('.genealogy-editor-hint');
    await expect(hint).toBeDisplayed();
    await expect(hint).toHaveText(expect.stringContaining('Spanish'));
    await hint.$('button').click();
    expect(await (await formField('Name scheme')).getValue()).toBe('spanish');
    await expect(browser.$('.genealogy-editor-hint')).not.toBeDisplayed();
    const labels = await browser.$$('.genealogy-editor-row label').map((label) => label.getText());
    expect(labels.slice(0, 2)).toEqual(['Given names', 'Surnames']);
    await closeEditor();
  });
});
