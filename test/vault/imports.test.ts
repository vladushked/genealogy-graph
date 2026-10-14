import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import initSqlJs from 'sql.js';
import { setLanguage } from '../../src/i18n';
import { readAt5 } from '../../src/import/at5';
import { readGedcom } from '../../src/import/gedcom';
import { displayName, planImport, type ExistingCard } from '../../src/import/plan';
import { ImportError, type ImportedTree } from '../../src/import/types';
import type { NameScheme } from '../../src/names';
import { FIXTURES, hasFixtures, loadVault } from './load';

const IMPORTS = path.join(FIXTURES, 'imports');

async function read(file: string): Promise<ImportedTree> {
  const bytes = new Uint8Array(fs.readFileSync(path.join(IMPORTS, file)));
  return file.endsWith('.at5') ? readAt5(bytes, await initSqlJs()) : readGedcom(bytes, file);
}

/** Latin names are in the Western scheme, Cyrillic ones in the Russian. */
const schemeOf = (names: string[]): NameScheme => names.some((name) => /[А-Яа-яЁё]/.test(name)) ? 'russian' : 'western';

describe('import files', { skip: !hasFixtures() && 'test/fixtures is missing: git submodule update --init' }, () => {
  setLanguage('ru');
  const expected = hasFixtures() ? JSON.parse(fs.readFileSync(path.join(IMPORTS, 'expected.json'), 'utf8')) : {};
  for (const [file, want] of Object.entries<Record<string, unknown>>(expected)) {
    if (want.error) {
      test(`[IMPORT-04] ${file}: refused with an explanation`, async () => {
        await assert.rejects(read(file), (error) => error instanceof ImportError && error.message.length > 0);
      });
      continue;
    }
    test(`[IMPORT-01] ${file}: people, families and dates are read`, async () => {
      const tree = await read(file);
      const names = want.names as string[];
      const scheme = schemeOf(names);
      assert.equal(tree.format, want.format);
      assert.equal(tree.people.length, want.people);
      assert.equal(tree.parents.length, want.parents);
      if (want.adoptive !== undefined) assert.equal(tree.parents.filter((entry) => entry.adoptive).length, want.adoptive);
      assert.equal(tree.spouses.length, want.couples);
      if (want.godparents !== undefined) assert.equal(tree.godparents.length, want.godparents);
      assert.deepEqual(tree.people.map((person) => displayName(person, scheme)).sort(), [...names].sort());
      for (const [name, [birth, death]] of Object.entries((want.dates ?? {}) as Record<string, [string | null, string | null]>)) {
        const person = tree.people.find((item) => displayName(item, scheme) === name)!;
        assert.equal(person.birthDate ?? null, birth, `${name}: birth`);
        assert.equal(person.deathDate ?? null, death, `${name}: death`);
      }
    });

    test(`[IMPORT-02] ${file}: into an empty vault every person becomes a card; a second import finds them all`, async () => {
      const tree = await read(file);
      const scheme = schemeOf(want.names as string[]);
      const options = { folderMode: 'family' as const, folder: '', filesFolder: 'files', sourceName: file, sourceLabel: tree.format, existingPaths: new Set<string>(), naming: { scheme, template: '{name} {born}-{died}' } };
      const plan = planImport(tree, [], options);
      assert.equal(plan.counts.create, want.people);
      assert.equal(new Set(plan.cards.map((card) => card.path)).size, plan.cards.length, 'distinct file names');
      const existing: ExistingCard[] = plan.cards.map((card) => ({ path: card.path, fields: card.fields }));
      const again = planImport(tree, existing, { ...options, existingPaths: new Set(existing.map((card) => card.path)) });
      assert.deepEqual([again.counts.create, again.counts.update], [0, 0], 'no duplicates on a re-import');
    });
  }

  test('[IMPORT-03] the 7.0 Озеровы into «scenarios»: a person already there is completed, not duplicated', async () => {
    const vault = loadVault('scenarios');
    setLanguage('ru');
    const tree = await read('family-7.0.ged');
    const existing = vault.cards.map((card) => ({ path: card.path, fields: card.fields }));
    const plan = planImport(tree, existing, { folderMode: 'family', folder: '', filesFolder: 'attachments', sourceName: 'family-7.0.ged', sourceLabel: 'GEDCOM', existingPaths: new Set(vault.files) });
    // Мария Андреевна, born Соколова in 1866, is in the vault: matched by her birth surname and year. The others
    // differ by patronymic (Николай Иванович in the file, Николай Петрович in the vault) and become new cards.
    assert.deepEqual(plan.cards.filter((card) => card.action === 'update').map((card) => card.path), ['Озеровы/Озерова Мария Андреевна (Соколова) 1866-1940.md']);
    assert.equal(plan.counts.create, 3);
    assert.deepEqual(plan.ambiguous, []);
  });
});
