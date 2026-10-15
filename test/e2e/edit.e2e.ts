import { browser, expect } from '@wdio/globals';
import { clickNode, fillForm, selectOnly, formValues, frontmatter, openVault, setSettings, showEditor, state, waitFile, waitPeople } from './helpers';

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
    await waitFile('Озеров Денис Сергеевич 1990-?.md');
    expect((await state()).settings.selfPersonId).toBe('Озеров Денис Сергеевич 1990-?.md');
    expect(await frontmatter('Озеров Денис Сергеевич 1990-?.md')).toMatchObject({ type: 'person', name: 'Озеров Денис Сергеевич', sex: 'male', birth_date: '1990-03-14' });
  });

  it('[EDIT-02] a child: the parent, surname and patronymic are filled in; the link is written into both cards', async () => {
    await selectOnly('Озеров Денис Сергеевич 1990-?.md');
    await addRelative('ребёнка');
    await fillForm({ Пол: 'male' });
    expect(await formValues()).toEqual(expect.arrayContaining(['Озеров', 'Денисович']));
    await fillForm({ Имя: 'Лев', 'Дата рождения': '2020' });
    await save();
    await waitPeople(2);
    expect((await frontmatter('Озеров Денис Сергеевич 1990-?.md')).children).toEqual(['[[Озеров Лев Денисович 2020-?]]']);
    expect((await frontmatter('Озеров Лев Денисович 2020-?.md')).parents).toEqual(['[[Озеров Денис Сергеевич 1990-?]]']);
  });

  it('[EDIT-03] a parent: a father named after the patronymic of the child', async () => {
    await selectOnly('Озеров Денис Сергеевич 1990-?.md');
    await addRelative('родителя');
    expect(await formValues()).toEqual(expect.arrayContaining(['Озеров', 'Сергей']));
    await save();
    await waitPeople(3);
    expect((await state()).status).toBe('3 человек · 2 связей');
  });

  it('[EDIT-04] a new birth year renames the card by the template; Obsidian updates the links', async () => {
    await selectOnly('Озеров Денис Сергеевич 1990-?.md');
    await fillForm({ 'Дата рождения': '1991-03-14' });
    await save();
    await waitFile('Озеров Денис Сергеевич 1991-?.md');
    await browser.waitUntil(async () => JSON.stringify(await frontmatter('Озеров Лев Денисович 2020-?.md')).includes('1991'), { timeout: 10000 });
    expect((await state()).settings.selfPersonId).toBe('Озеров Денис Сергеевич 1991-?.md');
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
});
