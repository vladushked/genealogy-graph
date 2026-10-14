import type { Cut } from './model';
import { restoreExport, type ExportSettings } from './print';
import { DEFAULT_FILE_NAME } from './edit';
import type { LanguageSetting } from './i18n';
import { NAME_SCHEMES, type NameScheme } from './names';

export interface SettingsData {
  /** Language of the plugin: «auto» follows Obsidian. */
  language: LanguageSetting;
  /** How names are built: order, patronymics, hints from relatives (see names.ts). */
  nameScheme: NameScheme;
  /** File name of new cards, with placeholders (see edit.cardBase). */
  fileNameTemplate: string;
  /** Vault paths of TrueType fonts for exported PDFs, for scripts the bundled font lacks (Chinese, Japanese, Korean…). */
  exportFonts: string[];
  selfPersonId: string;
  hideDisconnected: boolean;
  depth: number;
  /** «Корни»: generations of kin shown around the ancestry of the chosen people; 0 only the ancestry, -1 everyone. */
  rootsDepth: number;
  templatesFolder: string;
  /** Links the user hid, with the side that disappears. */
  cuts: Cut[];
  /**
   * What the graph shows by size and color. «Поколения»: colors by generation, sizes older or younger larger, and a
   * column of generations to highlight. «Число родственников»: size and color by how many relatives a person has, and
   * a column of those counts to highlight.
   */
  focus: FocusMode;
  /** In the generations focus: older or younger generations larger. */
  generationSize: GenerationSize;
  /** Generations to highlight; empty highlights everyone. */
  highlightGenerations: number[];
  /** Relative counts to highlight (the first count of a group, see relativeGroups); empty highlights everyone. */
  highlightRelatives: number[];
  /** «Отпустить граф»: the layout never comes to rest, people keep moving under the forces. */
  freeLayout: boolean;
  /** Vault folder for files brought in by imports; empty means Obsidian's attachment folder. */
  filesFolder: string;
  /** Folder for people added in the graph who have no relative to sit next to; empty is the vault root. */
  cardsFolder: string;
  /** Note whose properties and text start every card added in the graph; empty starts from blank. */
  cardTemplate: string;
  /** Rename a card when its name or dates change, if its file name still follows the file name template. */
  renameCards: boolean;
  /** The export dialog's last choices. */
  export: ExportSettings;
  /** The graph's control panel: shown or folded to a button, and which of its sections are expanded. */
  controls: { open: boolean; sections: string[] };
}

export type FocusMode = 'generations' | 'relatives';
export type GenerationSize = 'older' | 'younger';

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : fallback;

/**
 * Settings from saved data. A vault that used the plugin before it was translated keeps Russian and the Russian name
 * scheme; a new one follows Obsidian's language, and takes the name scheme of that language.
 */
export function restoreSettings(value: unknown, obsidianLanguage = 'en'): SettingsData {
  const saved = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const earlier = Object.keys(saved).length > 0 && !('language' in saved);
  const russian = earlier || obsidianLanguage.toLowerCase().startsWith('ru');
  return {
    language: oneOf(saved.language, ['auto', 'en', 'ru'], earlier ? 'ru' : 'auto'),
    nameScheme: oneOf(saved.nameScheme, NAME_SCHEMES, russian ? 'russian' : 'western'),
    fileNameTemplate: typeof saved.fileNameTemplate === 'string' && saved.fileNameTemplate.trim() ? saved.fileNameTemplate.trim() : DEFAULT_FILE_NAME,
    exportFonts: Array.isArray(saved.exportFonts) ? saved.exportFonts.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [],
    selfPersonId: typeof saved.selfPersonId === 'string' ? saved.selfPersonId : '',
    hideDisconnected: saved.hideDisconnected === true,
    // 0 shows everyone, -1 only the selected people (or the route), 1–4 that many steps around them.
    depth: typeof saved.depth === 'number' && [-1, 0, 1, 2, 3, 4].includes(saved.depth) ? saved.depth : 0,
    rootsDepth: typeof saved.rootsDepth === 'number' && [-1, 0, 1, 2, 3, 4].includes(saved.rootsDepth) ? saved.rootsDepth : 0,
    templatesFolder: typeof saved.templatesFolder === 'string' ? normalizeFolder(saved.templatesFolder) : 'templates',
    cuts: Array.isArray(saved.cuts) ? saved.cuts.filter(isCut) : [],
    // Before the focus modes, «Нагрев» colored by relative count and a separate size mode was older or younger.
    focus: oneOf(saved.focus, ['generations', 'relatives'], saved.colorMode === 'heat' ? 'relatives' : 'generations'),
    generationSize: oneOf(saved.generationSize, ['older', 'younger'], saved.nodeSize === 'younger' ? 'younger' : 'older'),
    highlightGenerations: integers(saved.highlightGenerations),
    highlightRelatives: integers(saved.highlightRelatives).filter((value) => value >= 0),
    // A new graph starts released.
    freeLayout: saved.freeLayout !== false,
    filesFolder: typeof saved.filesFolder === 'string' ? normalizeFolder(saved.filesFolder) : '',
    cardsFolder: typeof saved.cardsFolder === 'string' ? normalizeFolder(saved.cardsFolder) : '',
    cardTemplate: typeof saved.cardTemplate === 'string' ? saved.cardTemplate.trim() : '',
    renameCards: saved.renameCards !== false,
    export: restoreExport(saved.export),
    controls: restoreControls(saved.controls),
  };
}

const integers = (value: unknown): number[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is number => Number.isInteger(item)))].sort((a, b) => a - b) : [];

/**
 * Groups of relative counts for the highlight column: one per count present, while there are few; beyond
 * `maxGroups`, the largest counts share the last group («12+»). Each group is named by its first count.
 */
export function relativeGroups(counts: Iterable<number>, maxGroups = 12): Array<{ from: number; to: number | null }> {
  const present = [...new Set(counts)].sort((a, b) => a - b);
  if (present.length <= maxGroups) return present.map((count) => ({ from: count, to: count }));
  const singles = present.slice(0, maxGroups - 1);
  return [...singles.map((count) => ({ from: count, to: count })), { from: present[maxGroups - 1], to: null }];
}

/** The group a count falls into: its first count. */
export function groupOf(count: number, groups: Array<{ from: number; to: number | null }>): number | null {
  return groups.find((group) => count >= group.from && (group.to === null || count <= group.to))?.from ?? null;
}

const DEFAULT_SECTIONS = ['filters'];
function restoreControls(value: unknown): SettingsData['controls'] {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sections = Array.isArray(saved.sections) ? saved.sections.filter((item): item is string => typeof item === 'string') : DEFAULT_SECTIONS;
  return { open: saved.open !== false, sections };
}

export function normalizeFolder(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

export function inFolder(path: string, folder: string): boolean {
  return Boolean(folder) && path.startsWith(`${folder}/`);
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

function isCut(value: unknown): value is Cut {
  if (!value || typeof value !== 'object') return false;
  const cut = value as Record<string, unknown>;
  return strings(cut.edges) && strings(cut.hide) && strings(cut.keep) && cut.edges.length > 0 && cut.hide.length > 0;
}
