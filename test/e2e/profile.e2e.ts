import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { clickNode, expected, openVault, state } from './helpers';

describe('[PROFILE] the person profile', () => {
  const want = expected('scenarios');
  before(() => openVault('scenarios'));

  it('[PROFILE-01] a double click opens the profile: life, family as chips, the note text', async () => {
    await clickNode(want.self, { double: true });
    const profile = browser.$('.modal.genealogy-profile');
    await expect(profile).toBeDisplayed();
    await expect(profile.$('.genealogy-profile-name')).toHaveText('Озеров Денис Сергеевич');
    await expect(profile).toHaveText(expect.stringContaining('ЖИЗНЬ'));
    await expect(profile).toHaveText(expect.stringContaining('14 марта 1990'));
    await expect(profile).toHaveText(expect.stringContaining('Широкий портрет'));
    const chips = await profile.$$('.genealogy-profile-chip-name').map((chip) => chip.getText());
    expect(chips).toEqual(expect.arrayContaining(['Озеров Сергей Алексеевич', 'Озеров Лев Денисович', 'Ковалёва Анастасия Сергеевна (Озерова)']));
  });

  it('[PROFILE-02] a relative chip opens their profile, «Назад» returns', async () => {
    const profile = browser.$('.modal.genealogy-profile');
    await profile.$('.genealogy-profile-chip-name=Озеров Сергей Алексеевич').click();
    await expect(profile.$('.genealogy-profile-name')).toHaveText('Озеров Сергей Алексеевич');
    await profile.$('.genealogy-profile-action.is-back').click();
    await expect(profile.$('.genealogy-profile-name')).toHaveText('Озеров Денис Сергеевич');
  });

  it('[PROFILE-03] while the profile is open the graph stops; Esc closes it', async () => {
    expect(await browser.executeObsidian(({ app }) => Boolean((app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any).frozen))).toBe(true);
    await browser.keys(Key.Escape);
    await expect(browser.$('.modal.genealogy-profile')).not.toBeExisting();
  });

  it('[PROFILE-04] the context menu offers the profile, the note, adding relatives', async () => {
    await clickNode(want.self, { right: true });
    const items = await browser.$$('.menu .menu-item-title').map((item) => item.getText());
    expect(items).toEqual(expect.arrayContaining(['Профиль', 'Открыть заметку', 'Добавить: родитель', 'Добавить: ребёнок']));
    await browser.keys(Key.Escape);
    expect((await state()).focus.length).toBeLessThanOrEqual(1);
  });
});
