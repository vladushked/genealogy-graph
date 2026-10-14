import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { clarifyCards, type ClarifyCard } from '../../src/edit';
import { setLanguage } from '../../src/i18n';
import { buildGraph, type Graph, type RawPerson } from '../../src/model';
import type { NameScheme } from '../../src/names';
import { resolvePhotoFile } from '../../src/photos';
import { isPersonCard, lifeStatusOf, rawPerson, readFields, type PersonFields } from '../../src/schema';
import { restoreSettings, inFolder, type SettingsData } from '../../src/settings';

/**
 * A test vault read from disk the way the plugin reads Obsidian's metadata cache in refreshGraph: person cards by
 * their frontmatter, links resolved as getFirstLinkpathDest does (a path, otherwise the one file of that name,
 * nearest to the linking note when there are several), portraits from `photo` or the embeds of the body.
 */

/** Root of the test vaults repository: the submodule, or another checkout named by LINEAGE_TEST_VAULTS. */
export const FIXTURES = path.resolve(process.env.LINEAGE_TEST_VAULTS ?? path.join(import.meta.dirname, '..', 'fixtures'));

export interface Card { path: string; basename: string; frontmatter: Record<string, unknown>; fields: PersonFields; portrait?: string }

export interface LoadedVault {
  name: string;
  root: string;
  settings: SettingsData;
  files: string[];
  cards: Card[];
  graph: Graph;
  clarify: Map<string, string[]>;
  resolve(link: string, source: string): string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expected: any;
}

const walk = (root: string, dir = ''): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  if (entry.name.startsWith('.')) return [];
  const relative = dir ? `${dir}/${entry.name}` : entry.name;
  return entry.isDirectory() ? walk(root, relative) : [relative];
});

const frontmatterOf = (text: string): Record<string, unknown> | null => {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const value = parse(match[1]) as unknown;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
};

export function linkResolver(files: string[]) {
  const byBase = new Map<string, string[]>();
  for (const file of files) {
    const base = file.replace(/^.*\//, '');
    for (const key of [base, base.replace(/\.md$/, '')]) byBase.set(key, [...(byBase.get(key) ?? []), file]);
  }
  const all = new Set(files);
  return (link: string, source: string): string | null => {
    const target = link.trim();
    if (!target) return null;
    for (const candidate of [target, `${target}.md`]) if (all.has(candidate)) return candidate;
    const name = target.replace(/^.*\//, '');
    const matches = (byBase.get(name) ?? []).filter((file) => !target.includes('/') || file.endsWith(`/${target}`) || file.endsWith(`/${target}.md`));
    if (matches.length <= 1) return matches[0] ?? null;
    const folder = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
    return matches.find((file) => file.startsWith(`${folder}/`)) ?? [...matches].sort((a, b) => a.length - b.length)[0];
  };
}

export function loadVault(name: string): LoadedVault {
  const root = path.join(FIXTURES, 'vaults', name);
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.obsidian', 'plugins', 'genealogy-graph', 'data.json'), 'utf8'));
  const settings = restoreSettings(saved, 'en');
  // Life years and «Уточнить» are worded in the vault's language.
  setLanguage(settings.language === 'ru' ? 'ru' : 'en');
  const files = walk(root);
  const resolve = linkResolver(files);
  const cards: Card[] = [];
  for (const file of files.filter((item) => item.endsWith('.md'))) {
    if (inFolder(file, settings.templatesFolder)) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const frontmatter = frontmatterOf(text);
    if (!frontmatter || !isPersonCard(frontmatter)) continue;
    const embeds = [...text.slice(text.indexOf('---', 3)).matchAll(/!\[\[([^\]]+)\]\]/g)].map((match) => ({ link: match[1] }));
    const portrait = resolvePhotoFile(frontmatter.photo, embeds, (link) => {
      const found = resolve(link, file);
      return found ? { path: found, extension: found.replace(/^.*\./, '') } : null;
    })?.path;
    cards.push({ path: file, basename: file.replace(/^.*\//, '').replace(/\.md$/, ''), frontmatter, fields: readFields(frontmatter).fields, portrait });
  }
  const raw: RawPerson[] = cards.map((card) => rawPerson(card.path, card.basename, card.frontmatter, card.portrait));
  const graph = buildGraph(raw, resolve, settings.selfPersonId || null);
  // Values outside the schema come first, as refreshGraph puts them.
  graph.issues.unshift(...cards.flatMap((card) => readFields(card.frontmatter).unknown.map((entry) => ({ source: card.path, field: entry.field, target: String(entry.value), reason: 'value' as const }))));
  const clarifyInput: ClarifyCard[] = cards.map((card) => ({ path: card.path, fields: card.fields, lifeStatus: lifeStatusOf(card.fields), hasPhoto: Boolean(card.portrait) }));
  const clarify = new Map([...clarifyCards(graph, clarifyInput, resolve, settings.nameScheme as NameScheme)].map(([key, notes]) => [key, notes.map((note) => note.text)]));
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json'), 'utf8'));
  return { name, root, settings, files, cards, graph, clarify, resolve, expected };
}

export const hasFixtures = () => fs.existsSync(path.join(FIXTURES, 'vaults'));
