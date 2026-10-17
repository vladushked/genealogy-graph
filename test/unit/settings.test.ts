import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreExport } from '../../src/print';
import { groupOf, inFolder, relativeGroups, restoreSettings } from '../../src/settings';

test('old person default and removed mode settings are ignored', () => {
  assert.deepEqual(restoreSettings({ selfPath: 'legacy-person.md', mode: 'hourglass', showSpouses: false }), {
    language: 'ru', nameScheme: 'russian', fileNameTemplate: '{name} {born}-{died}', exportFonts: [],
    selfPersonId: '', hideDisconnected: false, depth: 0, rootsDepth: 0, templatesFolder: 'templates', cuts: [],
    focus: 'generations', generationSize: 'older', highlightGenerations: [], highlightRelatives: [], freeLayout: true, filesFolder: '', cardsFolder: '', cardsFolderMode: 'family', cardTemplate: '', renameCards: true, export: restoreExport(undefined), controls: { open: true, sections: ['filters'] },
  });
});

test('explicitly chosen person and the other settings are restored; old generation colors are dropped', () => {
  assert.deepEqual(restoreSettings({
    selfPersonId: 'family/person.md', colors: { '-8': '#aabbcc', other: 'red' }, hideDisconnected: true, depth: -1, templatesFolder: '/Шаблоны/', collapsed: ['a.md'], cuts: [{ edges: ['parent:a:b'], hide: ['a'], keep: ['b'] }, { edges: [], hide: ['x'], keep: [] }],
  }), {
    language: 'ru', nameScheme: 'russian', fileNameTemplate: '{name} {born}-{died}', exportFonts: [],
    selfPersonId: 'family/person.md', hideDisconnected: true, depth: -1, rootsDepth: 0, templatesFolder: 'Шаблоны', cuts: [{ edges: ['parent:a:b'], hide: ['a'], keep: ['b'] }],
    focus: 'generations', generationSize: 'older', highlightGenerations: [], highlightRelatives: [], freeLayout: true, filesFolder: '', cardsFolder: '', cardsFolderMode: 'family', cardTemplate: '', renameCards: true, export: restoreExport(undefined), controls: { open: true, sections: ['filters'] },
  });
});

test('template folder matches whole path segments only', () => {
  assert.equal(inFolder('templates/person.md', 'templates'), true);
  assert.equal(inFolder('templates-old/person.md', 'templates'), false);
  assert.equal(inFolder('templates/person.md', ''), false);
});

test('view modes are restored when valid and fall back to defaults otherwise', () => {
  const restored = restoreSettings({ focus: 'relatives', generationSize: 'younger', highlightGenerations: [1, -2, 1, 'x', 0.5], highlightRelatives: [3, -1, 2] });
  assert.deepEqual([restored.focus, restored.generationSize], ['relatives', 'younger']);
  assert.deepEqual(restored.highlightGenerations, [-2, 1]);
  assert.deepEqual(restored.highlightRelatives, [2, 3]);
  const fallback = restoreSettings({ focus: 'heat', generationSize: 'huge', highlightGenerations: 'all' });
  assert.deepEqual([fallback.focus, fallback.generationSize, fallback.highlightGenerations], ['generations', 'older', []]);
});

test('the former size and color modes become a focus', () => {
  assert.deepEqual(Object.values(pick(restoreSettings({ nodeSize: 'younger', colorMode: 'heat' }))), ['relatives', 'younger']);
  assert.deepEqual(Object.values(pick(restoreSettings({ nodeSize: 'links', colorMode: 'generation' }))), ['generations', 'older']);
});
const pick = (settings: ReturnType<typeof restoreSettings>) => ({ focus: settings.focus, size: settings.generationSize });

test('relative counts group into one chip per count, the largest sharing the last', () => {
  assert.deepEqual(relativeGroups([3, 1, 3, 2]), [{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: 3 }]);
  const groups = relativeGroups([1, 2, 3, 4, 5, 9], 4);
  assert.deepEqual(groups, [{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: 3 }, { from: 4, to: null }]);
  assert.deepEqual([groupOf(2, groups), groupOf(9, groups), groupOf(0, groups)], [2, 4, null]);
});


test('a vault from before the translation keeps Russian; a new one follows Obsidian', () => {
  assert.deepEqual(pickLanguage(restoreSettings({ depth: 1 }, 'en')), ['ru', 'russian']);
  assert.deepEqual(pickLanguage(restoreSettings(null, 'en')), ['auto', 'western']);
  assert.deepEqual(pickLanguage(restoreSettings(null, 'ru')), ['auto', 'russian']);
  assert.deepEqual(pickLanguage(restoreSettings({ language: 'en', nameScheme: 'spanish' }, 'ru')), ['en', 'spanish']);
  assert.deepEqual(pickLanguage(restoreSettings({ language: 'fr', nameScheme: 'klingon' }, 'en')), ['auto', 'western']);
  const saved = restoreSettings({ language: 'en', fileNameTemplate: '  ', exportFonts: ['fonts/a.ttf', 3, ' '] });
  assert.deepEqual([saved.fileNameTemplate, saved.exportFonts], ['{name} {born}-{died}', ['fonts/a.ttf']]);
});

const pickLanguage = (settings: ReturnType<typeof restoreSettings>) => [settings.language, settings.nameScheme];
