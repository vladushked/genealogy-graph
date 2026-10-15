import { Modal, Notice, normalizePath, Platform, TFile, type App } from 'obsidian';
import type { SqlJsStatic } from 'sql.js';
import { isPersonCard, readFields } from '../schema';
import { AT5_FORMAT, readAt5 } from './at5';
import { GEDCOM_FORMAT, readGedcom } from './gedcom';
import { displayName, planImport, type ExistingCard, type ImportPlan, type PlanOptions } from './plan';
import { ImportError, type ImportedTree } from './types';
import type { Naming } from '../edit';
import { language, t } from '../i18n';
import { writeImport, type MediaSource, type WriteResult } from './write';

/** What the import dialog needs from the plugin. */
export interface ImportHost {
  app: App;
  templatesFolder: string;
  /** Vault folder for imported files. */
  filesFolder: string;
  loadSql: () => Promise<SqlJsStatic>;
  /** Name scheme and file name template of the cards. */
  naming: Naming;
}

interface ImportFormat {
  id: string;
  /** Shown in the dialog. */
  name: string;
  /** Written into `sources` of imported cards. */
  label: string;
  extensions: string[];
  read(bytes: Uint8Array, host: ImportHost, fileName: string): Promise<ImportedTree>;
  /** Folder on disk that media paths of a file are relative to. */
  mediaFolder(filePath: string): string;
}

const FORMATS: ImportFormat[] = [
  { ...GEDCOM_FORMAT, read: async (bytes, _host, fileName) => readGedcom(bytes, fileName), mediaFolder: (path) => path.replace(/[\\/][^\\/]*$/, '') },
  // «Древо Жизни» keeps media in «<file name>.files» next to the archive.
  { ...AT5_FORMAT, read: async (bytes, host) => readAt5(bytes, await host.loadSql()), mediaFolder: (path) => path.replace(/\.[^./\\]+$/, '.files') },
];

/** The name and the `sources` label of a format in the current language. */
const formatName = (format: ImportFormat) => t().importer.formats[format.id]?.[0] ?? format.name;
const formatLabel = (format: ImportFormat) => t().importer.formats[format.id]?.[1] ?? format.label;

/** «Импортировать родословную»: choose a file, review what will happen, then write. */
export class ImportModal extends Modal {
  private tree: ImportedTree | null = null;
  private fileName = '';
  private readMedia: MediaSource | null = null;
  private mediaNote = '';
  private options!: PlanOptions;
  private decisions: Record<string, string | null> = {};
  private existing: ExistingCard[] = [];
  private plan: ImportPlan | null = null;

  constructor(app: App, private host: ImportHost) { super(app); }

  onOpen() {
    this.titleEl.setText(t().importer.title);
    this.renderChooser();
  }

  onClose() { this.contentEl.empty(); }

  private renderChooser(error?: string) {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: t().importer.supported(FORMATS.map(formatName).join(', ')) });
    if (error) contentEl.createEl('p', { text: error, cls: 'mod-warning' });
    const input = contentEl.createEl('input', { type: 'file', attr: { accept: FORMATS.flatMap((format) => format.extensions.map((ext) => `.${ext}`)).join(',') } });
    input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void this.load(file); });
  }

  private async load(file: File) {
    const format = FORMATS.find((item) => item.extensions.some((ext) => file.name.toLowerCase().endsWith(`.${ext}`)));
    if (!format) { this.renderChooser(t().importer.unsupported); return; }
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: t().importer.reading(file.name) });
    try {
      this.tree = await format.read(new Uint8Array(await file.arrayBuffer()), this.host, file.name);
    } catch (error) {
      this.renderChooser(error instanceof ImportError ? error.message : t().importer.readFailed((error as Error).message));
      return;
    }
    this.fileName = file.name;
    this.findMedia(file, format);
    this.existing = this.collectExisting();
    this.options = {
      folderMode: 'family', folder: '', filesFolder: this.host.filesFolder, sourceName: file.name, sourceLabel: formatLabel(format), existingPaths: this.vaultPaths(), naming: this.host.naming,
    };
    this.replan();
  }

  /**
   * Media paths are relative to a folder next to the file (Electron gives the file's path on disk). A path may also be
   * absolute, often from another computer: then it is tried as is, and otherwise by file name in that folder.
   */
  private findMedia(file: File, format: ImportFormat) {
    this.readMedia = null; this.mediaNote = '';
    const filePath = (this.tree?.media.length ?? 0) > 0 ? localPath(file) : undefined;
    const mediaDir = filePath ? format.mediaFolder(filePath) : undefined;
    const fs = nodeFs();
    if (mediaDir && fs?.existsSync(mediaDir)) {
      const read = (path: string) => { const data: Uint8Array = fs.readFileSync(path); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer; };
      this.readMedia = async (path) => {
        const absolute = /^([a-z]:)?[\\/]/i.test(path);
        const tries = absolute ? [path, `${mediaDir}/${path.split(/[\\/]/).pop()}`] : [`${mediaDir}/${path}`, `${mediaDir}/${path.split(/[\\/]/).pop()}`];
        for (const candidate of tries) { try { if (fs.existsSync(candidate)) return read(candidate); } catch { /* next */ } }
        return null;
      };
      this.mediaNote = t().importer.mediaFrom(mediaDir);
    } else if (this.tree?.media.length) {
      this.mediaNote = Platform.isMobile ? t().importer.mediaMissingMobile : t().importer.mediaMissing;
    }
  }

  private chooseMediaFolder() {
    // A phone cannot pick a folder: there the photo files themselves are chosen, matched by name as from a folder.
    const input = createEl('input', { type: 'file', attr: Platform.isMobile ? { multiple: '' } : { webkitdirectory: '', multiple: '' } });
    input.addEventListener('change', () => {
      const files = new Map(Array.from(input.files ?? []).map((file) => [file.name, file] as const));
      if (!files.size) return;
      this.readMedia = async (path) => { const file = files.get(path.split(/[\\/]/).pop()!); return file ? file.arrayBuffer() : null; };
      this.mediaNote = t().importer.mediaChosen(files.size);
      this.renderPreview();
    });
    input.click();
  }

  private collectExisting(): ExistingCard[] {
    const cards: ExistingCard[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.host.templatesFolder && file.path.startsWith(`${this.host.templatesFolder}/`)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!isPersonCard(frontmatter)) continue;
      cards.push({ path: file.path, fields: readFields(frontmatter!).fields });
    }
    return cards;
  }

  private vaultPaths() { return new Set(this.app.vault.getFiles().map((file) => file.path)); }

  private replan() {
    if (!this.tree) return;
    this.plan = planImport(this.tree, this.existing, { ...this.options, decisions: this.decisions });
    this.renderPreview();
  }

  private renderPreview() {
    const { contentEl } = this; const tree = this.tree!; const plan = this.plan!;
    contentEl.empty();
    contentEl.addClass('genealogy-import');
    const words = t().importer;
    const names = new Map(tree.people.map((person) => [person.key, displayName(person, this.host.naming.scheme)]));
    const label = (key: string) => {
      const person = tree.people.find((item) => item.key === key)!;
      return `${names.get(key)}${person.birthDate ? ` (${person.birthDate.slice(0, 4)})` : ''}`;
    };
    contentEl.createEl('p', { text: words.summary(this.fileName, tree.people.length, tree.parents.length, tree.spouses.length, tree.media.length) });

    // Folders.
    const folderRow = contentEl.createDiv({ cls: 'genealogy-import-row' });
    folderRow.createEl('label', { text: words.where });
    const mode = folderRow.createEl('select');
    mode.createEl('option', { value: 'family', text: words.family });
    mode.createEl('option', { value: 'single', text: words.single });
    mode.value = this.options.folderMode;
    const folder = folderRow.createEl('input', { type: 'text', value: this.options.folder, attr: { placeholder: this.options.folderMode === 'single' ? words.folder : words.vaultRoot } });
    mode.addEventListener('change', () => { this.options.folderMode = mode.value as PlanOptions['folderMode']; this.replan(); });
    folder.addEventListener('change', () => { this.options.folder = normalizePath(folder.value.trim()).replace(/^\/$/, ''); this.replan(); });
    contentEl.createEl('p', { text: words.filesTo(this.options.filesFolder, this.mediaNote) });
    if (tree.media.length && !this.readMedia) {
      const pick = contentEl.createEl('button', { text: Platform.isMobile ? words.pickFiles : words.pickFolder });
      pick.addEventListener('click', () => this.chooseMediaFolder());
    }

    // Summary.
    const summary = contentEl.createEl('ul');
    summary.createEl('li', { text: words.create(plan.counts.create) });
    summary.createEl('li', { text: words.update(plan.counts.update, plan.counts.unchanged) });
    const conflicts = plan.cards.reduce((sum, card) => sum + card.conflicts.length, 0);
    if (conflicts) summary.createEl('li', { text: words.conflicts(conflicts) });
    summary.createEl('li', { text: words.files(plan.media.length) });
    if (plan.namesakes.length) summary.createEl('li', { text: words.namesakes(plan.namesakes.length) });
    for (const warning of tree.warnings) summary.createEl('li', { text: warning });

    // Ambiguous matches: the user decides.
    if (plan.ambiguous.length) {
      contentEl.createEl('h4', { text: words.maybeExisting(plan.ambiguous.length) });
      for (const item of plan.ambiguous) {
        const row = contentEl.createDiv({ cls: 'genealogy-import-row' });
        row.createSpan({ text: `${label(item.key)} → ` });
        const select = row.createEl('select');
        select.createEl('option', { value: '', text: words.createNew });
        for (const path of item.candidates) select.createEl('option', { value: path, text: words.isCard(path) });
        select.addEventListener('change', () => { this.decisions[item.key] = select.value || null; this.replan(); });
      }
    }

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    const run = buttons.createEl('button', { text: words.run, cls: 'mod-cta' });
    buttons.createEl('button', { text: words.cancel }).addEventListener('click', () => this.close());
    run.addEventListener('click', () => void this.write());
  }

  private async write() {
    const plan = this.plan!;
    const unresolved = plan.ambiguous.filter((item) => !(item.key in this.decisions));
    // Undecided ambiguous people get new cards; the report lists them.
    for (const item of unresolved) this.decisions[item.key] = null;
    const final = planImport(this.tree!, this.existing, { ...this.options, decisions: this.decisions });
    this.contentEl.empty();
    const words = t().importer;
    const status = this.contentEl.createEl('p', { text: words.running });
    let result: WriteResult;
    try {
      result = await writeImport(this.app, final, this.readMedia, (done, total) => status.setText(words.progress(done, total)));
    } catch (error) {
      status.setText(words.aborted((error as Error).message));
      return;
    }
    const report = await this.writeReport(final, result, unresolved.map((item) => item.key));
    status.setText(words.done(result.created, result.updated, result.mediaCopied, result.errors.length));
    const open = this.contentEl.createEl('button', { text: words.openReport, cls: 'mod-cta' });
    open.addEventListener('click', () => { if (report) void this.app.workspace.getLeaf('tab').openFile(report); this.close(); });
    new Notice(words.notice(result.created));
  }

  private async writeReport(plan: ImportPlan, result: WriteResult, undecided: string[]): Promise<TFile | null> {
    const words = t().importer.report;
    const names = new Map(this.tree!.people.map((person) => [person.key, displayName(person, this.host.naming.scheme)]));
    const pathOf = new Map(plan.cards.map((card) => [card.key, card.path.replace(/\.md$/, '')]));
    const ref = (key: string) => pathOf.has(key) ? `[[${pathOf.get(key)}|${names.get(key)}]]` : names.get(key) ?? key;
    const lines = [
      `# ${words.title(this.fileName)}`, '',
      `- ${words.date(new Date().toLocaleString(language()))}`,
      `- ${words.created(result.created, result.updated, plan.counts.unchanged)}`,
      `- ${words.files(result.mediaCopied, result.mediaReused, result.mediaMissing.length)}`,
    ];
    const section = (title: string, items: string[]) => { if (items.length) lines.push('', `## ${title}`, '', ...items.map((item) => `- ${item}`)); };
    section(words.conflicts, plan.cards.flatMap((card) => card.conflicts.map((conflict) => `[[${card.path.replace(/\.md$/, '')}]] · ${words.conflict(conflict.field, String(conflict.existing), String(conflict.imported))}`)));
    section(words.undecided, undecided.map(ref));
    section(words.namesakes, plan.namesakes.map((group) => group.map(ref).join(', ')));
    section(words.missingFiles, result.mediaMissing);
    section(words.warnings, this.tree!.warnings);
    section(words.errors, result.errors);
    const base = normalizePath(`${words.title(this.fileName.replace(/\.[^.]+$/, ''))} ${new Date().toISOString().slice(0, 10)}`);
    let path = `${base}.md`;
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${base} ${n}.md`;
    try { return await this.app.vault.create(path, `${lines.join('\n')}\n`); } catch { return null; }
  }
}

/** Path of a picked file on disk (desktop only). */
function localPath(file: File): string | undefined {
  try {
    const electron = (window as unknown as { require?: (id: string) => { webUtils?: { getPathForFile(file: File): string } } }).require?.('electron');
    const viaUtils = electron?.webUtils?.getPathForFile(file);
    if (viaUtils) return viaUtils;
  } catch { /* older Electron */ }
  return (file as File & { path?: string }).path || undefined;
}

function nodeFs(): { existsSync(path: string): boolean; readFileSync(path: string): Uint8Array } | null {
  try { return (window as unknown as { require?: (id: string) => never }).require?.('fs') ?? null; } catch { return null; }
}
