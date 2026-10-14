import { browser, expect } from '@wdio/globals';
import { expected, openVault, setSettings, state, tabTitle } from './helpers';

const CYRILLIC = /[А-Яа-яЁё]/;
/** Every text and tooltip of the graph's own controls (not the people). */
const controlsText = () => browser.executeObsidian(({ app }) => {
  const names: string[] = (app as any).plugins.plugins['genealogy-graph'].graph.people.map((person: { name: string }) => person.name);
  const text = [...document.querySelectorAll('.genealogy-controls, .genealogy-dock, .genealogy-focus-bar, .genealogy-corner, .genealogy-zoom')]
    .flatMap((el) => [el.textContent ?? '', ...[...el.querySelectorAll('[aria-label]')].map((item) => item.getAttribute('aria-label') ?? '')]).join(' | ');
  // People's names are what they are in any language.
  return names.reduce((rest, name) => rest.split(name).join(''), text);
});

describe('[I18N] the interface language', () => {
  before(() => openVault('scenarios'));

  it('[I18N-01] switching to English redraws the graph, its tab and the controls', async () => {
    expect(CYRILLIC.test(await controlsText())).toBe(true);
    await setSettings({ language: 'en' });
    expect(await tabTitle()).toBe('Genealogy graph');
    const want = expected('scenarios');
    expect((await state()).status).toBe(`${want.people.count} people · ${want.edges.count} links`);
    const text = await controlsText();
    expect(text.match(/[А-Яа-яЁё]+/g) ?? []).toEqual([]);
  });

  it('[I18N-02] the settings tab is in English', async () => {
    // The settings window of Obsidian 1.14 is a window of its own: the plugin's tab is drawn here instead.
    const text = await browser.executeObsidian(({ app }) => {
      const tab = (app as any).setting.pluginTabs.find((item: { id: string }) => item.id === 'genealogy-graph');
      tab.display();
      return tab.containerEl.textContent as string;
    });
    expect(text).toContain('Name scheme');
    expect(text).toContain('File name of new cards');
    expect(text).toContain('For example: Озерова Светлана Борисовна (Кравченко) 1915-1980.md');
  });

  it('[I18N-03] back to Russian', async () => {
    await setSettings({ language: 'ru' });
    expect(await tabTitle()).toBe('Родословный граф');
  });
});

describe('[I18N] a vault in English from the start', () => {
  before(() => openVault('international'));

  it('[I18N-04] English labels, life years and kinship words', async () => {
    const want = expected('international');
    expect((await state()).status).toBe(`${want.people.count} people · ${want.edges.count} links`);
    const years = await browser.executeObsidian(({ app }) => Object.fromEntries((app as any).plugins.plugins['genealogy-graph'].graph.people.map((p: any) => [p.id, p.lifeYears])));
    for (const [path, label] of Object.entries(want.labels)) expect(years[path]).toBe(label);
  });
});
