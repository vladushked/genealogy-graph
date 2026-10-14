import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cardBase } from '../../src/edit';
import { setLanguage, type Lang } from '../../src/i18n';
import { describeRoute } from '../../src/kinship';
import { adjacency, ancestry, edgeKey, shortestPath, type Graph } from '../../src/model';
import { suggestNames, type NameScheme, type Relative } from '../../src/names';
import { lifeStatusOf, type Sex } from '../../src/schema';
import { hasFixtures, loadVault, type LoadedVault } from './load';

/** The graph's links in the form expected.json writes them. */
const edgeIds = (graph: Graph) => graph.edges.map((edge) => edge.relation === 'parent' ? `parent:${edge.from}:${edge.to}${edge.adoptive ? ':adoptive' : ''}` : `spouse:${[edge.from, edge.to].sort().join(':')}`);

const kinship = (vault: LoadedVault, from: string, to: string, lang: Lang) => {
  const path = shortestPath(vault.graph, from, to);
  if (!path) return null;
  const neighbors = adjacency(vault.graph);
  const sexOf = new Map<string, Sex>(vault.graph.people.map((person) => [person.id, person.sex ?? 'unknown']));
  return { steps: path.edges.length, ...describeRoute(path.nodes, path.edges, {
    sex: (id) => sexOf.get(id) ?? 'unknown',
    parents: (id) => (neighbors.get(id) ?? []).filter(({ edge }) => edge.relation === 'parent' && edge.to === id).map(({ edge }) => edge.from),
  }, lang) };
};

const VAULTS = ['scenarios', 'international', 'scale-500', 'scale-1000', 'empty'];

describe('test vaults', { skip: !hasFixtures() && 'test/fixtures is missing: git submodule update --init' }, () => {
  for (const name of VAULTS) {
    describe(name, () => {
      const vault = hasFixtures() ? loadVault(name) : (null as unknown as LoadedVault);
      const expected = vault?.expected;
      const lang = (vault?.settings.language === 'en' ? 'en' : 'ru') as Lang;

      test('[VAULT-01] person cards: type person, outside the templates folder', () => {
        assert.deepEqual(vault.cards.map((card) => card.path).sort(), expected.people.paths);
      });

      test('[VAULT-02] links: declared from either card, merged, adoptions dashed', () => {
        const actual = edgeIds(vault.graph);
        assert.equal(new Set(actual).size, actual.length, 'no link twice');
        const plain = actual.filter((id) => !expected.edges.ambiguous.some((entry: { source: string }) => id.includes(entry.source)));
        assert.deepEqual(plain.sort(), expected.edges.list.filter((id: string) => !expected.edges.ambiguous.some((entry: { source: string }) => id.includes(entry.source))).sort());
        for (const entry of expected.edges.ambiguous) {
          const linked = actual.filter((id) => id.includes(entry.source));
          assert.equal(linked.length, 1, `${entry.source}: one link`);
          assert.ok(entry.oneOf.some((target: string) => linked[0].includes(target)), `${entry.source} links one of ${entry.oneOf}`);
        }
        assert.equal(vault.graph.edges.length, expected.edges.count);
      });

      test('[AUDIT-01] Проблемы: missing cards, self links, values outside the schema, contradicting generations', () => {
        setLanguage(lang);
        const key = (issue: { source: string; reason: string; field?: string; target?: string; targetId?: string }) =>
          issue.reason === 'generation' ? `${issue.source}|generation|${issue.targetId}` : `${issue.source}|${issue.reason}|${issue.field}|${issue.target}`;
        const oneOf: string[][] = expected.generationIssueOneOf ?? [];
        const actual = vault.graph.issues.map(key);
        const either = oneOf.map(([child, parent]) => `${child}|generation|${parent}`);
        assert.equal(actual.filter((item) => either.includes(item)).length, oneOf.length ? 1 : 0, 'one of the mutual links contradicts');
        assert.deepEqual(actual.filter((item) => !either.includes(item)).sort(), expected.issues.map(key).sort());
      });

      test('[VAULT-03] life years under the names', () => {
        setLanguage(lang);
        const byId = new Map(vault.graph.people.map((person) => [person.id, person]));
        for (const [path, label] of Object.entries(expected.labels)) assert.equal(byId.get(path)?.lifeYears ?? '', label, path);
      });

      test('[AUDIT-02] Уточнить: what each card still lacks', () => {
        setLanguage(lang);
        for (const [path, items] of Object.entries(expected.clarify)) assert.deepEqual(vault.clarify.get(path) ?? [], items, path);
      });

      test('[EDIT-05] file names follow the template, so renaming by the template recognises them', () => {
        setLanguage(lang);
        const naming = { scheme: vault.settings.nameScheme, template: vault.settings.fileNameTemplate };
        const byPath = new Map(vault.cards.map((card) => [card.path, card]));
        for (const path of expected.namedByTemplate) {
          const card = byPath.get(path)!;
          assert.equal(cardBase(card.fields, lifeStatusOf(card.fields), naming), card.basename, path);
        }
      });

      if (name === 'scenarios') {
        test('[VAULT-04] portraits: explicit, embedded, broken, not images', () => {
          const byPath = new Map(vault.cards.map((card) => [card.path, card]));
          for (const [path, has] of Object.entries(expected.portraits)) assert.equal(Boolean(byPath.get(path)?.portrait), has, path);
        });
      }

      test('[ROUTE-01] kinship routes: the chain length and the term in both languages', () => {
        for (const route of expected.routes) {
          for (const lang of ['ru', 'en'] as const) {
            setLanguage(lang);
            const found = kinship(vault, route.from, route.to, lang);
            if (route.steps === null) { assert.equal(found, null, `${route.from} → ${route.to}: not related`); continue; }
            assert.equal(found?.steps, route.steps, `${route.from} → ${route.to}: steps`);
            assert.equal(found?.term ?? null, route[lang], `${route.from} → ${route.to} (${lang})`);
          }
        }
      });

      test('[ROOTS-01] «Корни»: every line of ancestors up to the oldest', () => {
        const generation = new Map(vault.graph.people.map((person) => [person.id, person.generation]));
        for (const roots of expected.roots) {
          const tree = ancestry(vault.graph, roots.from);
          assert.equal(tree.nodes.length - roots.from.length, roots.ancestors);
          const hasParents = new Set(tree.edges.map((edge) => edge.to));
          const oldest = Math.min(...tree.nodes.map((id) => generation.get(id) ?? 0));
          assert.deepEqual(tree.nodes.filter((id) => !hasParents.has(id) && generation.get(id) === oldest).sort(), [...roots.oldest].sort());
        }
      });

      if (name === 'scenarios' || name === 'international') {
        test('[VAULT-05] «me» is generation 0', () => {
          assert.equal(vault.graph.people.find((person) => person.id === expected.self)?.generation, 0);
        });
      }
      if (name.startsWith('scale-')) {
        test('[SCALE-01] a large family builds without problems, generation by generation', () => {
          assert.equal(new Set(vault.graph.people.map((person) => person.generation)).size, expected.generations);
          assert.equal(new Set(vault.graph.edges.map(edgeKey)).size, vault.graph.edges.length);
        });
      }
      if (expected?.hints) {
        test('[EDIT-03] name hints from relatives in every scheme', () => {
          const rel = (over: Partial<Relative>): Relative => ({ path: 'x', name: 'x', sex: 'unknown', surname: '', given_name: '', patronymic: '', birth_surname: '', parents: [], children: [], spouses: [], ...over });
          for (const hint of expected.hints) {
            const parents = [hint.father && rel({ sex: 'male', ...hint.father }), hint.mother && rel({ sex: 'female', ...hint.mother })].filter(Boolean) as Relative[];
            const spouses = hint.husband ? [rel({ sex: 'male', ...hint.husband })] : [];
            assert.deepEqual(suggestNames(hint.scheme as NameScheme, hint.sex, parents, [], spouses), hint.hints, hint.scheme);
          }
        });
      }
    });
  }
});
