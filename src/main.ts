import { AbstractInputSuggest, App, ItemView, Menu, Notice, Plugin, PluginSettingTab, Scope, Setting, TFile, getLanguage, normalizePath, requireApiVersion, setIcon, type SettingDefinitionItem, type HoverParent, type HoverPopover, type TAbstractFile, type WorkspaceLeaf } from 'obsidian';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { references, adjacency, ancestry, applyCuts, kinAround, buildGraph, edgeKey, problemPeople, hiddenBehind, proposeCut, reachable, shortestPath, type Cut, type Edge, type Graph, type Issue, type GraphPath, type RawPerson } from './model';
import { groupOf, inFolder, normalizeFolder, relativeGroups, restoreSettings, type SettingsData } from './settings';
import { isPersonCard, rawPerson, readFields, readPerson, type LifeStatus, type PersonFields } from './schema';
import { Cards } from './cards';
import { cardBase, clarifyCards, DEFAULT_FILE_NAME, type Clarification, type Relation } from './edit';
import { language, resolveLanguage, setLanguage, t } from './i18n';
import { NAME_SCHEMES, type NameScheme } from './names';
import { EDITOR_VIEW_TYPE, PersonEditorView, relationTitle, type EditorHost } from './editor';
import { ImportModal } from './import/modal';
import { loadSqlJs } from './import/sqljs';
import { imageMime, resolvePhotoFile } from './photos';
import { NODE_RADIUS, hslHex, nodeRadius, nodeOutline, visualRadius, generationRadius, generationGradient, heatColor, edgeEndpoints, spouseCapsule, spouseGroups, labelSide, labelLayout, labelLines, nodeFill, sceneBounds, familyShape, groupFamilies, SPOUSE_FILL_OPACITY, SPOUSE_PAD, type Family, type Bounds, type Scene, type SceneNode } from './scene';
import { describeRoute, kinshipSaying } from './kinship';
import { selectionForce } from './layout';
import { spouseConstraint } from './physics';
import { Fader } from './fade';
import { PhysicsClient } from './physics-client';
import { hoverIndex } from './hover';
import { drawFrame, type Frame, type LabelItem, type Layer, type NodeItem, type Palette, type ShapeItem } from './canvas';
import { hitTest, type Hit, type HitNode } from './hit';
import { portraitDataUrl } from './export';
import { isTrueType, type PdfFontFile } from './pdf-text';
import { ExportModal } from './export-modal';
import { ProfileModal } from './profile';

const VIEW_TYPE = 'genealogy-graph-view';
/** Zoom range over which person labels fade from invisible to fully opaque. */
const LABELS_HIDDEN_BELOW = 0.2;
const LABELS_SHOWN_ABOVE = 0.45;
/** Number of label fade steps between those zoom levels. */
const LABEL_STEPS = 20;

/** Generation range of the vault; generation colors spread evenly over it (see scene.generationGradient). */
export interface GenerationRange { min: number; max: number }
function generationColor(generation: number | null, range: GenerationRange | null): string {
  return generation === null ? '#8993a3' : generationGradient(generation, range);
}

/** A generation as written on the graph: −2, −1, 0, +1. */
function generationLabel(generation: number): string {
  return generation < 0 ? `−${-generation}` : generation > 0 ? `+${generation}` : '0';
}


function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

interface ForceNode extends SceneNode {
  vx?: number; vy?: number; fx?: number | null; fy?: number | null;
  /** Size the physics sees: like the drawn radius, but independent of the selection, so selecting moves nothing. */
  layoutRadius?: number;
}
interface ForceEdge { source: string | ForceNode; target: string | ForceNode; relation: Edge['relation'] }
/** Visual state of a link or person, mirroring the former CSS classes. */
type Tone = '' | 'route' | 'muted' | 'context';
interface NodeView {
  node: ForceNode;
  /** Vault path of the portrait, if any; the decoded image lives in the view's portrait cache. */
  portrait: string | null;
  tone: Tone; endpoint: boolean; pinned: boolean;
  /** False when generations are highlighted and this person's is not among them. */
  lit: boolean;
  /** Entries of Проблемы involving this person: the node gets a red ring while the problems list is open. */
  problems: Issue[];
  /** Size the person is heading to; the drawn size eases toward it. */
  radius: number;
  /** "+N" hidden relatives. */
  badge: { text: string; width: number } | null;
}
interface EdgeView { edge: Edge; a: ForceNode; b: ForceNode; tone: Tone; key: string }
/** Spouses linked to one another: one merged shape around them (see scene.spouseCapsule). */
interface SpouseGroupView { edges: EdgeView[]; members: ForceNode[] }
interface FamilyView {
  family: Family; connectorTone: Tone;
  /** Parents and children, for culling off-screen families. */
  members: ForceNode[];
  halves: Array<{ parent: string; onRoute: boolean }>;
  branches: Array<{ child: string; edges: Edge[]; tone: Tone; key: string }>;
}
interface CameraTarget { cx: number; cy: number; zoom: number }
/** A clickable link: cutting its edges separates `sideA` from `sideB`. */
interface LinkTarget {
  id: string; edges: Edge[]; sideA: string[]; sideB: string[]; mid: { x: number; y: number };
  /** Where the link is drawn now, for hit testing; set while composing each frame. */
  line: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Half-width of the clickable band when wider than a line: the shape around spouses. */
  reach?: number;
}
/** Opacity of a link or person in each tone (the old CSS opacities). */
const TONE_ALPHA: Record<Tone, number> = { '': 1, route: 1, muted: 0.2, context: 0.6 };
/** Opacity of the rest of the graph while selected people keep their relatives highlighted. */
const FOCUS_DIM = 0.4;
/** A hovered person is drawn this much larger. */
const HOVER_GROW = 1.12;
/** Selecting people fits them and their closest relatives, zooming in no further than this. */
const SELECTION_MAX_ZOOM = 1.6;
/** «Поколение за поколением»: time between generations. */
const TIMELAPSE_STEP_MS = 1600;
/** How long the last generation's titles stay after «Поколение за поколением» ends. */
const TIMELAPSE_HOLD_MS = 2500;
/** Earlier generations while the newest one comes in: dimmer than the rest, lighter than a highlight. */
const TIMELAPSE_DIM = 0.45;
/** Two clicks on the same person within this time open the note. */
const DOUBLE_CLICK_MS = 400;
/** Holding a finger this long on a person opens their menu, as the right click does. */
const LONG_PRESS_MS = 500;
/** How a problem is named in Проблемы and in the tooltip of a marked person. */
const issueText = (issue: Issue) => `${t().graph.issues[issue.reason]} · ${issue.field}: ${issue.target}`;
/** Opacity of people and links outside the highlighted generations. */
const GENERATION_DIM = 0.2;
/** People with nothing on the open Проблемы or Уточнить list. */
const AUDIT_NEUTRAL = '#7c828c';
/** Pixel size of the circular portrait thumbnails drawn on the canvas. */
const PORTRAIT_PIXELS = 160;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
/** Zoom per unit of wheel delta: one notch (deltaY 100) zooms by about 40%, as in the built-in graph view. */
const WHEEL_ZOOM_RATE = 0.0034;
/** Time constant of the wheel zoom glide: ~95% of a notch is reached in three of these (150 ms). */
const WHEEL_EASE_MS = 50;
/** Largest zoom change per 60 Hz frame of the glide, as a log-ratio (≈8%). */
const WHEEL_MAX_STEP = 0.08;
type SettingsChange = 'colors' | 'filter' | 'self' | 'view';

export default class GenealogyGraphPlugin extends Plugin {
  settings: SettingsData = restoreSettings(null);
  graph: Graph = { people: [], edges: [], issues: [] };
  views = new Set<GenealogyGraphView>();
  private settingsTab: GenealogySettingsTab | null = null;
  generationRange: GenerationRange | null = null;
  /** Bumped whenever the graph changes. */
  graphVersion = 0;
  personIds = new Set<string>();
  private graphSignature = '';
  private refreshTimer: number | null = null;
  private saveTimer: number | null = null;
  private noteLeaf: WorkspaceLeaf | null = null;
  cards = new Cards(this.app, () => ({ cardsFolder: this.settings.cardsFolder, template: this.settings.cardTemplate, naming: this.naming() }));
  /** «Уточнить»: what is still to be clarified about each person (see edit.clarifications). */
  clarifications = new Map<string, Clarification[]>();
  /** While a relationship field of the editor is armed, clicking a person on the graph adds them to it. */
  picker: { label: string; pick: (id: string) => void } | null = null;
  /** File name each card should have by the naming scheme, as of the last refresh. */
  private expectedNames = new Map<string, string>();
  /** Person cards whose properties changed since the last refresh: only these may be renamed. */
  private changedPaths = new Set<string>();
  private renameWarned = false;
  /** A card created in the editor, to select once it appears on the graph. */
  private pendingSelect: string | null = null;

  async onload() {
    const saved: unknown = await this.loadData();
    this.settings = restoreSettings(saved, getLanguage());
    setLanguage(resolveLanguage(this.settings.language, getLanguage()));
    if (saved && typeof saved === 'object' && ('selfPath' in saved || 'showSpouses' in saved || 'mode' in saved || !('language' in saved))) {
      await this.saveData(this.settings);
    }
    this.registerView(VIEW_TYPE, (leaf) => new GenealogyGraphView(leaf, this));
    this.registerView(EDITOR_VIEW_TYPE, (leaf) => new PersonEditorView(leaf, this.editorHost()));
    const words = t().graph;
    this.addCommand({ id: 'open-person-editor', name: words.commands.openEditor, callback: () => void this.openEditor() });
    this.addCommand({ id: 'add-person', name: words.commands.addPerson, callback: () => void this.startCreate(null, null) });
    this.registerHoverLinkSource(VIEW_TYPE, { display: words.name, defaultMod: true });
    this.addRibbonIcon('network', words.name, () => void this.openGraph());
    this.addCommand({ id: 'open-graph', name: words.commands.openGraph, callback: () => void this.openGraph() });
    this.addCommand({ id: 'focus-current-person', name: words.commands.focusCurrent, callback: () => void this.focusCurrent() });
    this.addCommand({ id: 'import-family-tree', name: words.commands.importTree, callback: () => this.openImport() });
    this.settingsTab = new GenealogySettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    // Only person notes and images can change the graph; edits elsewhere in the vault are ignored.
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (this.personIds.has(file.path) || this.isPersonFile(file)) { this.changedPaths.add(file.path); this.scheduleRefresh(); }
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.settings.selfPersonId === oldPath && file instanceof TFile) {
        this.settings.selfPersonId = file.path;
        void this.saveSettings();
      }
      if (JSON.stringify(this.settings.cuts).includes(JSON.stringify(oldPath).slice(1, -1))) {
        const renameId = (id: string) => id === oldPath ? file.path : id;
        const renameKey = (key: string) => { const [relation, from, to] = key.split(':'); return `${relation}:${renameId(from)}:${renameId(to)}`; };
        this.settings.cuts = this.settings.cuts.map((cut) => ({ edges: cut.edges.map(renameKey), hide: cut.hide.map(renameId), keep: cut.keep.map(renameId) }));
        void this.saveSettings();
      }
      const expected = this.expectedNames.get(oldPath);
      if (expected) { this.expectedNames.delete(oldPath); this.expectedNames.set(file.path, expected); }
      for (const view of this.views) view.renamed(oldPath, file.path);
      this.editor()?.renamed(oldPath, file.path);
      if (this.personIds.has(oldPath) || this.affectsGraph(file)) this.scheduleRefresh();
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (this.personIds.has(file.path) || this.affectsGraph(file)) this.scheduleRefresh();
    }));
    // On a cold start the metadata cache may still be indexing: rebuild once it has resolved everything. Listening
    // from the start, not from layout ready, so a fast first indexing (a small fresh vault) is not missed.
    const resolved = this.app.metadataCache.on('resolved', () => { this.app.metadataCache.offref(resolved); this.scheduleRefresh(); });
    this.registerEvent(resolved);
    this.app.workspace.onLayoutReady(() => void this.refreshGraph());
  }

  onunload() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); void this.saveData(this.settings); }
  }

  async saveSettings() { await this.saveData(this.settings); }

  /** Name scheme and file name template of new cards. */
  naming() { return { scheme: this.settings.nameScheme, template: this.settings.fileNameTemplate }; }

  /** The language setting changed: open graphs and the person form are drawn again in the new language. */
  async languageChanged() {
    setLanguage(resolveLanguage(this.settings.language, getLanguage()));
    this.graphSignature = '';
    await this.refreshGraph();
    for (const view of [...this.views]) await view.redraw();
    this.editor()?.redraw();
    // Obsidian 1.13+ keeps the settings' names for its search: give it the new language.
    if (requireApiVersion('1.13.0')) this.settingsTab?.update();
  }

  /** Debounced save for controls that fire continuously, such as color pickers. */
  requestSave() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; void this.saveSettings(); }, 400);
  }

  settingsChanged(change: SettingsChange) {
    // Generations count from «me», so choosing another person renumbers them.
    if (change === 'self') { this.graphSignature = ''; void this.refreshGraph(); }
    for (const view of this.views) view.settingsChanged(change);
  }

  private isPersonFile(file: TAbstractFile): boolean {
    if (!(file instanceof TFile) || file.extension !== 'md' || inFolder(file.path, this.settings.templatesFolder)) return false;
    return isPersonCard(this.app.metadataCache.getFileCache(file)?.frontmatter);
  }

  private affectsGraph(file: TAbstractFile): boolean {
    return file instanceof TFile && (this.isPersonFile(file) || Boolean(imageMime(file.extension)));
  }

  scheduleRefresh() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { this.refreshTimer = null; void this.refreshGraph(); }, 250);
  }

  async refreshGraph() {
    const raw: RawPerson[] = [];
    const problems: Graph['issues'] = [];
    const clarified = new Map<string, Clarification[]>();
    const cards: Array<{ path: string; fields: PersonFields; lifeStatus: LifeStatus; hasPhoto: boolean }> = [];
    const naming = new Map<string, string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (inFolder(file.path, this.settings.templatesFolder)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || !isPersonCard(fm)) continue;
      const person = readPerson(fm);
      const { fields, unknown } = readFields(fm);
      naming.set(file.path, cardBase(fields, person.lifeStatus, this.naming()));
      for (const entry of unknown) problems.push({ source: file.path, field: entry.field, target: String(entry.value), reason: 'value' });
      const photo = person.photo;
      const portrait = this.resolvePhoto(file.path, photo, cache?.embeds)?.path;
      cards.push({ path: file.path, fields, lifeStatus: person.lifeStatus, hasPhoto: Boolean(portrait) });
      raw.push(rawPerson(file.path, file.basename, fm, portrait));
    }
    const graph = buildGraph(raw, (link, source) => this.app.metadataCache.getFirstLinkpathDest(link, source)?.path ?? null, this.settings.selfPersonId || null);
    graph.issues.unshift(...problems);
    const resolve = (link: string, source: string) => this.app.metadataCache.getFirstLinkpathDest(link, source)?.path ?? null;
    for (const [path, notes] of clarifyCards(graph, cards, resolve, this.settings.nameScheme)) clarified.set(path, notes);
    this.renameToScheme(naming);
    // Skip redraws when an edit did not change anything the graph shows.
    const signature = JSON.stringify([graph, [...clarified]]);
    if (signature === this.graphSignature) { this.editor()?.graphChanged(); return; }
    this.clarifications = clarified;
    this.graphSignature = signature;
    this.graph = graph;
    this.graphVersion++;
    const generations = graph.people.map((person) => person.generation).filter((value): value is number => value !== null && Number.isInteger(value));
    this.generationRange = generations.length ? { min: Math.min(...generations), max: Math.max(...generations) } : null;
    this.personIds = new Set(graph.people.map((person) => person.id));
    for (const view of this.views) view.setGraph(graph);
    if (this.pendingSelect && this.personIds.has(this.pendingSelect)) {
      const id = this.pendingSelect; this.pendingSelect = null;
      for (const view of this.views) view.addFocus(id, true);
    }
    this.editor()?.graphChanged();
  }

  /**
   * Renames cards whose name or dates changed, when their file name still followed the naming scheme before the
   * change. Cards named by hand are never touched. Links are
   * updated by Obsidian, so this waits for «Автоматически обновлять внутренние ссылки».
   */
  private renameToScheme(naming: Map<string, string>) {
    const previous = this.expectedNames;
    const changed = this.changedPaths;
    this.expectedNames = naming; this.changedPaths = new Set();
    if (!this.settings.renameCards) return;
    const updatesLinks = (this.app.vault as unknown as { getConfig?(key: string): unknown }).getConfig?.('alwaysUpdateLinks') === true;
    for (const path of changed) {
      const before = previous.get(path); const now = naming.get(path);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!before || !now || !(file instanceof TFile)) continue;
      if (file.basename !== before || now === before) continue;
      if (!updatesLinks) {
        if (!this.renameWarned) new Notice(t().graph.renameNeedsLinks, 10000);
        this.renameWarned = true;
        continue;
      }
      const target = (file.parent && file.parent.path !== '/' ? `${file.parent.path}/` : '') + `${now}.md`;
      if (this.app.vault.getAbstractFileByPath(target)) continue;
      void this.app.fileManager.renameFile(file, target).catch((error: unknown) => new Notice(t().graph.renameFailed(file.basename, error instanceof Error ? error.message : String(error))));
    }
  }

  // ── editor

  editor(): PersonEditorView | null {
    const view = this.app.workspace.getLeavesOfType(EDITOR_VIEW_TYPE)[0]?.view;
    return view instanceof PersonEditorView ? view : null;
  }

  async openEditor(): Promise<PersonEditorView> {
    let leaf = this.app.workspace.getLeavesOfType(EDITOR_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('split');
      await leaf.setViewState({ type: EDITOR_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view as PersonEditorView;
  }

  /** Opens the form for a new person, alone or as a relative of `anchor`. */
  async startCreate(relation: Relation | null, anchor: string | null) {
    const editor = await this.openEditor();
    editor.startCreate(relation, anchor);
  }

  selectionChanged(ids: string[]) { this.editor()?.follow(ids); }

  startPick(label: string, pick: (id: string) => void) {
    this.picker = { label, pick };
    for (const view of this.views) view.pickingChanged();
  }

  /** Ends picking; `fromGraph` when Esc on the graph ended it, so the editor updates its field. */
  stopPick(fromGraph = false) {
    if (!this.picker) return;
    this.picker = null;
    for (const view of this.views) view.pickingChanged();
    if (fromGraph) this.editor()?.pickEnded();
  }

  private editorHost(): EditorHost {
    return {
      cards: this.cards,
      people: () => this.graph.people.map((person) => ({ id: person.id, name: person.name, lifeYears: person.lifeYears })),
      isEmpty: () => this.graph.people.length === 0,
      selfPath: () => this.personIds.has(this.settings.selfPersonId) ? this.settings.selfPersonId : '',
      scheme: () => this.settings.nameScheme,
      setSelf: async (path) => { this.settings.selfPersonId = path; await this.saveSettings(); this.settingsChanged('self'); },
      startPick: (label, pick) => this.startPick(label, pick),
      stopPick: () => this.stopPick(),
      openNote: (path) => void this.openNote(path),
      selection: () => [...this.views][0]?.selection() ?? [],
      select: (path) => {
        if (this.personIds.has(path)) for (const view of this.views) view.addFocus(path, true);
        else this.pendingSelect = path;
      },
    };
  }

  /** Vault folder for imported files: the setting, else Obsidian's attachment folder when it is one fixed folder. */
  filesFolder(): string {
    if (this.settings.filesFolder) return this.settings.filesFolder;
    const configured = (this.app.vault as unknown as { getConfig?(key: string): unknown }).getConfig?.('attachmentFolderPath');
    const folder = typeof configured === 'string' ? normalizeFolder(configured) : '';
    // "./…" means "next to each note" and "/" means the vault root: neither is one folder for the whole vault.
    return folder && !folder.startsWith('.') ? folder : 'files';
  }

  /** The plugin's own settings tab, where «me» is chosen. */
  openSettings() {
    const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
    setting.open(); setting.openTabById(this.manifest.id);
  }

  openImport() {
    new ImportModal(this.app, {
      app: this.app, templatesFolder: this.settings.templatesFolder, filesFolder: this.filesFolder(), loadSql: loadSqlJs, naming: this.naming(),
    }).open();
  }

  async openGraph(): Promise<GenealogyGraphView> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view as GenealogyGraphView;
  }

  async focusCurrent() {
    const active = this.app.workspace.getActiveFile();
    const view = await this.openGraph();
    if (active && this.personIds.has(active.path)) view.addFocus(active.path, true);
    else new Notice(t().graph.notAPerson);
  }

  /** Opens a person note, reusing one tab for plain clicks so the graph does not spawn a tab per click. */
  async openNote(id: string, newTab = false) {
    const file = this.app.vault.getAbstractFileByPath(id);
    if (!(file instanceof TFile)) return;
    let leaf = newTab ? null : this.noteLeaf;
    if (leaf) {
      let attached = false;
      this.app.workspace.iterateAllLeaves((item) => { if (item === leaf) attached = true; });
      if (!attached || leaf.view.getViewType() === VIEW_TYPE) leaf = null;
    }
    leaf ??= this.app.workspace.getLeaf('tab');
    if (!newTab) this.noteLeaf = leaf;
    await leaf.openFile(file, { active: true });
  }

  private resolvePhoto(id: string, photo: string | undefined, embeds: readonly { link: string }[] | undefined): TFile | null {
    return resolvePhotoFile(photo, embeds, (link) => {
      const file = this.app.metadataCache.getFirstLinkpathDest(link, id) ?? this.app.vault.getAbstractFileByPath(link);
      return file instanceof TFile ? file : null;
    });
  }

  resourcePath(path: string): string | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
  }

  /**
   * The fonts chosen for PDFs (settings «Шрифты для PDF»), as base64. Only TrueType outlines work in jsPDF: an
   * OpenType/CFF font or a collection is refused with a message naming it.
   */
  async exportFonts(): Promise<PdfFontFile[]> {
    const fonts: PdfFontFile[] = [];
    for (const [index, path] of this.settings.exportFonts.entries()) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) { new Notice(t().export.fontFailed(path)); continue; }
      const bytes = new Uint8Array(await this.app.vault.readBinary(file));
      if (!isTrueType(bytes)) { new Notice(t().export.fontFailed(path)); continue; }
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      fonts.push({ name: `GenealogyFont${index + 1}`, base64: btoa(binary) });
    }
    return fonts;
  }

  /** Embeds downscaled portraits; `cache` lets one export dialog read each photo once. */
  /** Portraits as data URLs of `size` pixels, enough for the largest person at the print's resolution. */
  async embedPhotos(scene: Scene, cache: Map<string, Promise<string | undefined>>, size = 256): Promise<Scene> {
    const nodes = await Promise.all(scene.nodes.map(async (node) => {
      if (!node.portrait) return { ...node, image: undefined };
      const key = `${node.portrait}@${size}`;
      let pending = cache.get(key);
      if (!pending) { pending = this.loadPortrait(node.portrait, size); cache.set(key, pending); }
      return { ...node, image: await pending };
    }));
    return { nodes, edges: scene.edges };
  }

  private async loadPortrait(path: string, size: number): Promise<string | undefined> {
    const file = this.app.vault.getAbstractFileByPath(path);
    const mime = file instanceof TFile ? imageMime(file.extension) : null;
    if (!(file instanceof TFile) || !mime) return undefined;
    try { return await portraitDataUrl(await this.app.vault.readBinary(file), mime, size); } catch { return undefined; }
  }
}

class GenealogyGraphView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private graph: Graph = { people: [], edges: [], issues: [] };
  private focus = new Set<string>();
  private pathMode = false;
  private pathEndpoints: string[] = [];
  /** «Корни»: the chosen people whose ancestry is shown, with kin around it up to settings.rootsDepth. */
  private rootsMode = false;
  private rootIds: string[] = [];
  private rootsCache: { graph: Graph; key: string; tree: GraphPath } | null = null;
  /** The route card says what the first person is to the second, instead of the second to the first. */
  private pathCache: { graph: Graph; key: string; path: GraphPath | null } | null = null;
  private nodes: ForceNode[] = [];
  private nodeById = new Map<string, ForceNode>();
  private visibleIds = new Set<string>();
  private hiddenCounts = new Map<string, number>();
  private cutRegions = new Map<Cut, Set<string>>();
  private links = new Map<string, LinkTarget>();
  private selectedLink: string | null = null;
  private linkProposal: ReturnType<typeof proposeCut> = null;
  private visibleNodes: ForceNode[] = [];
  private visibleEdges: Edge[] = [];
  /** Force layout, computed in a Web Worker. */
  private layout!: PhysicsClient<ForceNode>;
  /** Receives pan, zoom, pointer and keyboard input; holds the canvas. */
  private panel!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private palette!: Palette;
  private renderFrame: number | null = null;
  /** Decoded circular portraits by vault path; null while loading or when the image cannot be read. */
  private portraits = new Map<string, HTMLCanvasElement | null>();
  private hoverElements = new Map<string, Set<string>>();
  /** Drawing parts (see hoverIndex) highlighted with the selected people; null when nobody is selected. */
  private litKeys: Set<string> | null = null;
  /** Eases opacities and sizes toward their targets, so highlights blend in and out. */
  private fader = new Fader();
  /** While the problems list is open, the people it names get a red ring. */
  private showProblems = false;
  private problemsEl!: HTMLElement;
  private problemsButton!: HTMLElement;
  private generationRail!: HTMLElement;
  /** Relative count groups of the visible people and the largest count, for the «Число родственников» focus. */
  private relativeGroups: Array<{ from: number; to: number | null }> = [];
  private maxLinks = 0;
  private spouseViews: SpouseGroupView[] = [];
  /** «Поколение за поколением»: generations shown so far, oldest first; null when everyone is shown. */
  private timelapse: { generations: Array<number | null>; shown: number; timer: number } | null = null;
  private timelapseButtons: HTMLElement[] = [];
  /** The generation «Поколение за поколением» added last, highlighted under its titles; undefined when not running. */
  private newestGeneration: number | null | undefined = undefined;
  private credits!: HTMLElement;
  private creditsTimer = 0;
  /** Each person's visible spouses, for placing names beside the shape around a couple. */
  private spousesOf = new Map<string, ForceNode[]>();
  /** Set while a profile covers the graph: nothing moves or draws; `running` says whether to wake the layout after. */
  private frozen: { running: boolean } | null = null;
  /** The last click on a person, to recognise a double click. */
  private lastClick: { id: string; time: number; x: number; y: number } | null = null;
  private cutPreview = new Set<string>();
  /** People in drawing order, for hit testing. */
  private hitNodes: HitNode[] = [];
  private eyeAt: { x: number; y: number } | null = null;
  private pointer: {
    id: number; kind: 'pan' | 'node' | 'press'; hit: Hit;
    startX: number; startY: number; lastX: number; lastY: number; originX: number; originY: number; moved: boolean;
  } | null = null;
  /** Fingers (and pens) down on the canvas, for the pinch. */
  private touches = new Map<number, { x: number; y: number }>();
  /** Two fingers zooming and panning: their last distance and midpoint (client coordinates). */
  private pinch: { distance: number; x: number; y: number } | null = null;
  private longPressTimer: number | null = null;
  /** The finger whose long press opened the menu: its release must not reach the menu. */
  private longPressed: number | null = null;
  private labelLevel = 1;
  /** Zoom the wheel is gliding toward, around the pointer position (panel coordinates). */
  private wheelZoom: { target: number; x: number; y: number } | null = null;
  private wheelFrame: number | null = null;
  private wheelTime: number | null = null;
  private status!: HTMLElement;
  private dock!: HTMLElement;
  /** The side panel with search, filters and view settings, and its folded button. */
  private controls!: HTMLElement;
  private sections = new Map<string, HTMLElement>();
  private searchInput!: HTMLInputElement;
  private nodeViews = new Map<string, NodeView>();
  private edgeViews: EdgeView[] = [];
  private familyViews: FamilyView[] = [];
  private hoverId: string | null = null;
  private cameraX = 0;
  private cameraY = 0;
  private zoom = 1;
  private cameraTouched = false;
  private cameraTarget: CameraTarget | null = null;
  private cameraFrame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private viewport = { width: 0, height: 0 };
  private initialCameraPending = false;
  /** «+» beside the one selected person: adds a relative. */
  private nodePlus!: HTMLElement;
  /** «+» at the bottom of the graph, always there; and the large one in the middle of an empty vault. */
  private addButton!: HTMLElement;
  private pathButton!: HTMLElement;
  private rootsButton!: HTMLElement;
  private meButton!: HTMLElement;
  private routeCard!: HTMLElement;
  private emptyState!: HTMLElement;
  /** Shown while clicking a person adds them to a field of the editor. */
  private pickHint!: HTMLElement;
  /** While the «Уточнить» list is open, the people it names get a yellow ring. */
  private showClarify = false;
  private clarifyButton!: HTMLElement;
  private clarifyEl!: HTMLElement;
  /** Node size and node color modes as buttons on the graph. */
  /** «Отпустить граф», under the gear next to «Поколение за поколением». */
  private freeButton!: HTMLElement;
  private colorBar!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, readonly plugin: GenealogyGraphPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t().graph.name; }
  getIcon() { return 'network'; }

  async onOpen() {
    this.plugin.views.add(this);
    // Ctrl+F (⌘F) in the graph finds a person, as it finds text in a note.
    this.scope = new Scope(this.app.scope);
    this.scope.register(['Mod'], 'f', () => { this.searchInput.focus(); this.searchInput.select(); return false; });
    this.contentEl.empty(); this.contentEl.addClass('genealogy-view');
    this.panel = this.contentEl.createDiv({ cls: 'genealogy-panel', attr: { tabindex: '0' } });
    // The graph is drawn on a canvas, like the built-in graph view: thousands of SVG elements could not keep up.
    this.canvas = this.panel.createEl('canvas', { cls: 'genealogy-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    this.readPalette();
    this.registerEvent(this.app.workspace.on('css-change', () => { this.readPalette(); this.requestRender(); }));
    const zoomControls = this.panel.createDiv({ cls: 'genealogy-zoom' });
    const zoomButton = (cls: string, label: string, title: string, action: () => void) => {
      const button = zoomControls.createEl('button', { cls, text: label, attr: { type: 'button', 'aria-label': title, title } });
      button.addEventListener('click', action);
    };
    // On a touch screen fingers zoom, and only «⤢» is left (styles.css).
    zoomButton('genealogy-zoom-step', '+', t().graph.zoomIn, () => this.zoomBy(1.4));
    zoomButton('genealogy-zoom-step', '−', t().graph.zoomOut, () => this.zoomBy(1 / 1.4));
    zoomButton('genealogy-zoom-fit', '⤢', t().graph.fit, () => this.followGraph());
    this.status = this.panel.createDiv({ cls: 'genealogy-status' });
    this.buildControls();
    this.layout = new PhysicsClient<ForceNode>(() => {
      this.render();
      if (!this.cameraTouched && !this.layout.expanding) this.animateCamera(this.followTarget());
    });
    this.layout.setFree(this.plugin.settings.freeLayout);
    this.installInput();
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      this.viewport = { width: entry.contentRect.width, height: entry.contentRect.height };
      this.markRailScroll();
      if (!this.viewport.width || !this.viewport.height) return;
      const ratio = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(this.viewport.width * ratio); this.canvas.height = Math.round(this.viewport.height * ratio);
      if (this.initialCameraPending && !this.cameraTouched) this.startCamera();
      else if (!this.cameraTouched && !this.layout.expanding) this.animateCamera(this.followTarget());
      else if (this.cameraTarget) this.animateCamera(this.cameraTarget);
      this.render();
    });
    this.resizeObserver.observe(this.panel);
    this.setGraph(this.plugin.graph);
  }

  /** Builds the view again, in the current language; people keep their places. */
  async redraw() {
    await this.onClose();
    await this.onOpen();
    (this.leaf as unknown as { updateHeader?(): void }).updateHeader?.();
  }

  async onClose() {
    this.plugin.views.delete(this);
    this.stopTimelapse(false);
    window.clearTimeout(this.creditsTimer);
    this.layout?.dispose();
    this.resizeObserver?.disconnect();
    if (this.cameraFrame !== null) window.cancelAnimationFrame(this.cameraFrame);
    if (this.renderFrame !== null) window.cancelAnimationFrame(this.renderFrame);
    this.cameraFrame = null; this.renderFrame = null;
    this.cancelWheelZoom();
    this.cameraTarget = null;
  }

  /** Colors of the live graph come from the theme's CSS variables (see styles.css), read again on theme change. */
  private readPalette(attempt = 0) {
    const style = getComputedStyle(this.contentEl);
    // The plugin's stylesheet can arrive after the view opens (on start, or when the plugin is reloaded): until its
    // variables resolve, the fallbacks below are dark-theme colors. Read again on the next frames until they do.
    if (!style.getPropertyValue('--genealogy-text').trim() && attempt < 120 && this.contentEl.isConnected) {
      window.requestAnimationFrame(() => { this.readPalette(attempt + 1); this.requestRender(); });
    }
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    this.palette = {
      edge: read('--genealogy-edge', '#8091a8'), spouse: read('--genealogy-spouse', '#f5a1a1'), route: read('--genealogy-route', '#ffdc69'),
      ring: read('--genealogy-ring', '#e8edf5'), selected: read('--genealogy-selected', '#dadada'), hypothesis: read('--genealogy-hypothesis', '#f2bd5a'),
      text: read('--genealogy-text', '#dadada'), years: read('--genealogy-years', '#999'), halo: read('--genealogy-halo', '#1e1e1e'),
      accent: read('--interactive-accent', '#7f6df2'), onAccent: read('--text-on-accent', '#fff'),
      disabled: read('--background-modifier-border', '#444'), font: read('--font-interface', 'sans-serif'),
      error: read('--text-error', '#e5484d'),
    };
  }

  setGraph(graph: Graph) {
    const previous = this.nodeById;
    const neighbors = adjacency(graph);
    const firstLayout = this.visibleNodes.length === 0;
    this.graph = graph;
    this.nodes = graph.people.map((person, index) => {
      const color = generationColor(person.generation, this.plugin.generationRange);
      const old = previous.get(person.id);
      if (old) return { ...person, color, x: old.x, y: old.y, vx: old.vx, vy: old.vy };
      // A new card appears next to a relative that is already on screen, so the layout grows instead of reshuffling.
      const anchor = (neighbors.get(person.id) ?? []).map(({ next }) => previous.get(next)).find(Boolean);
      if (anchor) return { ...person, color, x: anchor.x + (Math.random() - 0.5) * 60, y: anchor.y + (Math.random() - 0.5) * 60 };
      const angle = index * 2.39996; const radius = Math.sqrt(index) * 10;
      return { ...person, color, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
    this.nodeById = new Map(this.nodes.map((node) => [node.id, node]));
    this.focus = new Set([...this.focus].filter((id) => this.nodeById.has(id)));
    this.pathEndpoints = this.pathEndpoints.filter((id) => this.nodeById.has(id));
    this.rootIds = this.rootIds.filter((id) => this.nodeById.has(id));
    if (this.hoverId && !this.nodeById.has(this.hoverId)) this.hoverId = null;
    if (!this.canvas) return;
    this.rebuild(firstLayout ? 1 : 0.3);
  }

  settingsChanged(change: SettingsChange) {
    if (!this.canvas) return;
    this.layout.setFree(this.plugin.settings.freeLayout);
    if (change === 'colors') this.restyle();
    else if (change === 'filter' || change === 'view') this.refresh();
  }

  addFocus(id: string, replace = false) {
    if (this.rootsMode) { this.chooseRoot(id); return; }
    if (this.pathMode) {
      this.choosePathPerson(id);
      if (this.pathEndpoints.length === 1) this.centerOn([id]);
      return;
    }
    if (replace) this.focus.clear();
    this.focus.add(id);
    this.refresh();
    this.frameSelection();
  }

  /** People selected now (none in route mode or «Корни»). */
  selection(): string[] { return this.special() ? [] : [...this.focus]; }

  /** «Маршрут родства» or «Корни»: clicks choose the people of the mode instead of selecting. */
  private special(): boolean { return this.pathMode || this.rootsMode; }

  renamed(oldPath: string, newPath: string) {
    if (this.focus.delete(oldPath)) this.focus.add(newPath);
    this.pathEndpoints = this.pathEndpoints.map((id) => id === oldPath ? newPath : id);
    this.rootIds = this.rootIds.map((id) => id === oldPath ? newPath : id);
  }

  pickingChanged() {
    const picker = this.plugin.picker;
    this.panel.toggleClass('is-picking', Boolean(picker));
    this.pickHint.setText(picker ? t().graph.pickHint(picker.label) : '');
    this.pickHint.toggle(Boolean(picker));
  }

  /** The relatives that can be added to a person, at the «+» beside them or at the bottom button. */
  private addMenu(id: string, event: MouseEvent) {
    const parents = this.graph.edges.filter((edge) => edge.relation === 'parent' && edge.to === id).length;
    const menu = new Menu();
    const icons: Record<Relation, string> = { parent: 'arrow-up', child: 'arrow-down', spouse: 'heart', sibling: 'arrow-left-right' };
    for (const relation of ['parent', 'child', 'spouse', 'sibling'] as Relation[]) {
      menu.addItem((item) => {
        item.setTitle(relationTitle(relation)).setIcon(icons[relation]).onClick(() => void this.plugin.startCreate(relation, id));
        if (relation === 'parent' && parents >= 2) item.setDisabled(true);
      });
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t().graph.unlinked).setIcon('user-plus').onClick(() => void this.plugin.startCreate(null, null)));
    menu.showAtMouseEvent(event);
  }

  /** Keeps the «+» beside the one selected person; hidden otherwise. */
  private placeNodePlus() {
    const id = !this.special() && this.focus.size === 1 ? [...this.focus][0] : null;
    const node = id ? this.nodeById.get(id) : undefined;
    if (!node || !this.nodeViews.has(node.id)) { this.nodePlus.hide(); return; }
    const radius = node.radius ?? 22;
    const x = this.cameraX + (node.x + radius * 0.75) * this.zoom + 6;
    const y = this.cameraY + (node.y + radius * 0.75) * this.zoom + 6;
    this.nodePlus.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.nodePlus.show();
  }

  private toggleFocus(id: string) {
    if (this.focus.has(id)) this.deselect(id); else this.focusPerson(id, true);
  }

  /** Removes one person from the selection and fits whoever stays selected; with nobody left the camera stays. */
  private deselect(id: string) {
    this.focus.delete(id);
    this.refresh();
    if (this.focus.size) this.frameSelection();
  }

  /** A route end chosen again is removed alone; a third person takes the place of the second. */
  private choosePathPerson(id: string) {
    if (!this.pathMode) return;
    if (this.pathEndpoints.includes(id)) this.pathEndpoints = this.pathEndpoints.filter((item) => item !== id);
    else if (this.pathEndpoints.length === 2) this.pathEndpoints = [this.pathEndpoints[0], id];
    else this.pathEndpoints = [...this.pathEndpoints, id];
    this.refresh();
    this.fitPath();
  }

  private togglePathMode() {
    this.pathMode = !this.pathMode;
    if (this.pathMode && this.rootsMode) { this.rootsMode = false; this.rootIds = []; }
    if (this.pathMode) {
      this.pathEndpoints = this.focus.size <= 2 ? [...this.focus] : [];
      this.focus.clear();
    } else this.pathEndpoints = [];
    this.refresh();
    this.fitPath();
  }

  /** A root chosen again is removed; anyone else joins the roots. */
  private chooseRoot(id: string) {
    if (!this.rootsMode) return;
    this.rootIds = this.rootIds.includes(id) ? this.rootIds.filter((item) => item !== id) : [...this.rootIds, id];
    this.refresh();
    this.followGraph();
  }

  /** «Корни»: starts from the selected people, or from «me» when nobody is selected. */
  private toggleRootsMode() {
    this.rootsMode = !this.rootsMode;
    if (this.rootsMode && this.pathMode) { this.pathMode = false; this.pathEndpoints = []; }
    if (this.rootsMode) {
      const self = this.plugin.settings.selfPersonId;
      this.rootIds = this.focus.size ? [...this.focus] : this.nodeById.has(self) ? [self] : [];
      this.focus.clear();
    } else this.rootIds = [];
    this.refresh();
    // The camera follows the tree while the layout settles it.
    this.followGraph();
  }

  /**
   * «Поколение за поколением», like the timelapse of Obsidian's graph view: starts from the oldest generation and
   * adds the next one every TIMELAPSE_STEP_MS, each newcomer next to a relative already shown. People without a
   * generation come last. The camera follows the growing graph. A second press stops it and shows everyone.
   */
  private toggleTimelapse() {
    if (this.timelapse) { this.stopTimelapse(); return; }
    const generations = [...new Set(this.nodes.map((node) => node.generation))]
      .sort((a, b) => a === null ? 1 : b === null ? -1 : a - b);
    if (generations.length < 2) return;
    window.clearTimeout(this.creditsTimer);
    this.timelapse = { generations, shown: 0, timer: 0 };
    this.cameraTouched = false;
    this.stepTimelapse();
  }

  private stepTimelapse() {
    const timelapse = this.timelapse;
    if (!timelapse) return;
    timelapse.shown++;
    this.newestGeneration = timelapse.generations[timelapse.shown - 1];
    this.showCredits(this.newestGeneration);
    const before = new Set(this.visibleIds);
    const visible = this.computeVisibleIds();
    // Newcomers start beside a relative already on screen, so each generation grows out of the previous one.
    const neighbors = adjacency(this.graph);
    for (const id of visible) {
      if (before.has(id)) continue;
      const node = this.nodeById.get(id)!;
      const anchor = (neighbors.get(id) ?? []).map(({ next }) => before.has(next) ? this.nodeById.get(next) : undefined).find(Boolean);
      if (anchor) { node.x = anchor.x + (Math.random() - 0.5) * 80; node.y = anchor.y + (Math.random() - 0.5) * 80; }
      node.vx = 0; node.vy = 0;
    }
    this.rebuild(timelapse.shown === 1 ? 0.3 : 0.6);
    if (!this.cameraTouched) this.animateCamera(this.followTarget());
    if (timelapse.shown >= timelapse.generations.length) {
      this.timelapse = null;
      this.updateTimelapseButtons();
      // The last titles stay a moment, then everyone is lit again.
      this.creditsTimer = window.setTimeout(() => this.endCredits(), TIMELAPSE_HOLD_MS);
      return;
    }
    timelapse.timer = window.setTimeout(() => this.stepTimelapse(), TIMELAPSE_STEP_MS);
    this.updateTimelapseButtons();
  }

  private stopTimelapse(showAll = true) {
    if (!this.timelapse) return;
    window.clearTimeout(this.timelapse.timer);
    this.timelapse = null;
    this.updateTimelapseButtons();
    this.endCredits(false);
    if (showAll) this.refresh();
  }

  /**
   * Titles at the top while «Поколение за поколением» runs: the generation, the years its people were born, how many
   * they are, and how far the generation is from you.
   */
  private showCredits(generation: number | null) {
    const people = this.nodes.filter((node) => node.generation === generation);
    const years = people.map((node) => node.birthYear).filter((year): year is number => year !== undefined);
    const first = Math.min(...years); const last = Math.max(...years);
    const self = this.plugin.settings.selfPersonId;
    const distance = generation === null || !this.nodeById.has(self) ? null
      : generation === 0 ? t().graph.yourGeneration : t().graph.distance(Math.abs(generation), generation < 0);
    for (const old of Array.from(this.credits.children)) { old.addClass('is-leaving'); window.setTimeout(() => old.remove(), 600); }
    const card = this.credits.createDiv({ cls: 'genealogy-credits-card' });
    card.createDiv({ cls: 'genealogy-credits-title', text: generation === null ? t().graph.noGeneration : t().graph.generation(generationLabel(generation)) });
    const facts = [years.length ? first === last ? String(first) : `${first} – ${last}` : '', t().graph.people(people.length)].filter(Boolean);
    card.createDiv({ cls: 'genealogy-credits-years', text: facts.join(' · ') });
    if (distance) card.createDiv({ cls: 'genealogy-credits-caption', text: distance });
  }

  /** Takes the titles away and lights everyone again. */
  private endCredits(restyle = true) {
    window.clearTimeout(this.creditsTimer);
    for (const old of Array.from(this.credits.children)) { old.addClass('is-leaving'); window.setTimeout(() => old.remove(), 600); }
    if (this.newestGeneration === undefined) return;
    this.newestGeneration = undefined;
    if (restyle) this.restyle();
  }

  private updateTimelapseButtons() {
    for (const button of this.timelapseButtons) {
      button.toggleClass('is-active', Boolean(this.timelapse));
      button.setAttribute('aria-label', this.timelapse ? t().graph.timelapseStop : t().graph.timelapse);
      setIcon(button, this.timelapse ? 'square' : 'play');
    }
  }

  /** Esc and «Снять выбор»: clears the selection and fits the whole graph. */
  /** Esc in steps: the first clears the selection where the camera is; the next, with nothing selected, shows the whole graph. */
  private clearSelection() {
    if (this.focus.size) this.deselectAll();
    else this.followGraph();
  }

  /** Clears the selection (or the route ends) where the camera is. */
  private deselectAll() {
    if (!this.focus.size && !this.pathEndpoints.length && !this.rootIds.length) return;
    this.focus.clear(); this.pathEndpoints = []; this.rootIds = [];
    this.refresh();
  }

  /** «Откуда» and «Куда» trade places; the same route is kept, read from the other end. */
  private swapPathEnds() {
    if (this.pathEndpoints.length !== 2) return;
    const path = this.currentPath();
    this.pathEndpoints = [...this.pathEndpoints].reverse();
    if (path) this.pathCache = { graph: this.graph, key: this.pathEndpoints.join('\n'), path: { nodes: [...path.nodes].reverse(), edges: [...path.edges].reverse() } };
    this.refresh();
  }

  private currentPath(): GraphPath | null {
    if (!this.pathMode || this.pathEndpoints.length !== 2) return null;
    const key = this.pathEndpoints.join('\n');
    if (this.pathCache?.graph !== this.graph || this.pathCache.key !== key) {
      this.pathCache = { graph: this.graph, key, path: shortestPath(this.graph, this.pathEndpoints[0], this.pathEndpoints[1]) };
    }
    return this.pathCache.path;
  }

  /** «Корни»: the ancestry of the roots, or null with no roots. */
  private currentRoots(): GraphPath | null {
    if (!this.rootsMode || !this.rootIds.length) return null;
    const key = this.rootIds.join('\n');
    if (this.rootsCache?.graph !== this.graph || this.rootsCache.key !== key) this.rootsCache = { graph: this.graph, key, tree: ancestry(this.graph, this.rootIds) };
    return this.rootsCache.tree;
  }

  /** What is highlighted as the route: the path between two, or the ancestry in «Корни». */
  private route(): GraphPath | null { return this.pathMode ? this.currentPath() : this.currentRoots(); }

  /** Fits the route or the ancestry above the card that describes it. */
  private fitPath() {
    const path = this.route();
    if (!path) return;
    // The route card and the search sit over the bottom of the graph; keep the route above them.
    const covered = this.panel.getBoundingClientRect().bottom - this.routeCard.getBoundingClientRect().top;
    this.fitNodes(path.nodes, 70, this.routeCard.isShown() ? Math.max(0, covered) : 0);
  }

  /** Selected people, route ends and «me»: when a link is hidden, the side holding them stays. */
  private roots(): string[] {
    const self = this.plugin.settings.selfPersonId;
    return [...new Set([...this.focus, ...this.pathEndpoints, ...this.rootIds, ...(this.nodeById.has(self) ? [self] : [])])];
  }

  /**
   * In route mode, a depth other than «вся семья» shows only the route and its side branches; in «Корни», any
   * threshold but «все» shows only the ancestry and the kin around it.
   */
  private routeLimited(path: GraphPath | null): boolean {
    if (!path) return false;
    return this.pathMode ? this.plugin.settings.depth !== 0 : this.rootsMode && this.plugin.settings.rootsDepth !== -1;
  }

  private computeVisibleIds(): Set<string> {
    const settings = this.plugin.settings;
    const allowed = new Set(this.nodes.map((node) => node.id));
    const steps = settings.depth < 0 ? 0 : settings.depth > 0 ? settings.depth : Infinity;
    const keepOnly = (ids: Set<string>) => { for (const id of allowed) if (!ids.has(id)) allowed.delete(id); };
    const path = this.route();
    if (this.rootsMode) {
      // The ancestry alone, or with kin around it; a marriage takes no step.
      const depth = settings.rootsDepth;
      if (path && this.routeLimited(path)) keepOnly(depth === 0 ? new Set(path.nodes) : kinAround(this.graph, path.nodes, depth));
    } else if (this.pathMode) {
      if (path && this.routeLimited(path)) keepOnly(reachable(this.graph, new Set(path.nodes), steps));
    } else if (this.focus.size && (settings.hideDisconnected || settings.depth !== 0)) {
      keepOnly(reachable(this.graph, this.focus, steps));
    } else if (settings.hideDisconnected) {
      const linked = adjacency(this.graph);
      for (const id of allowed) if (!linked.has(id)) allowed.delete(id);
    }
    if (this.timelapse) {
      const shown = new Set(this.timelapse.generations.slice(0, this.timelapse.shown));
      for (const id of allowed) if (!shown.has(this.nodeById.get(id)?.generation ?? null)) allowed.delete(id);
    }
    const protect = new Set([...this.roots(), ...(path?.nodes ?? [])]);
    const { hidden, regions } = applyCuts(this.graph, settings.cuts, allowed, protect);
    for (const id of hidden) allowed.delete(id);
    this.cutRegions = regions;
    // Every way of hiding relatives (depth, route, hidden links) is reported as "+N" on the person they hang from.
    this.hiddenCounts = hiddenBehind(this.graph, allowed);
    return allowed;
  }

  private selectLink(id: string | null) {
    this.selectedLink = id && this.links.has(id) ? id : null;
    const link = this.selectedLink ? this.links.get(this.selectedLink)! : null;
    this.linkProposal = link ? proposeCut(this.graph, link.edges, link.sideA, link.sideB, this.roots(), this.plugin.settings.cuts) : null;
    this.applyLinkSelection();
  }

  /** Marks the chosen link and previews which people its eye would hide. */
  private applyLinkSelection() {
    this.cutPreview = this.selectedLink ? this.linkProposal?.region ?? new Set<string>() : new Set<string>();
    this.panel.title = this.eyeTitle();
    this.requestRender();
  }

  private hideSelectedLink() {
    if (!this.linkProposal) {
      new Notice(t().graph.linkNoBranch);
      return;
    }
    this.plugin.settings.cuts = [...this.plugin.settings.cuts, this.linkProposal.cut];
    this.selectLink(null);
    void this.plugin.saveSettings();
    this.plugin.settingsChanged('filter');
  }

  /** "+N" click: restores the hidden links behind this person. */
  private revealAt(id: string) {
    const neighbors = (adjacency(this.graph).get(id) ?? []).map(({ next }) => next);
    const restored = [...this.cutRegions].filter(([, region]) => neighbors.some((next) => region.has(next))).map(([cut]) => cut);
    if (!restored.length) {
      new Notice(this.rootsMode ? t().graph.hiddenByRoots : this.pathMode ? t().graph.hiddenByPath : t().graph.hiddenByDepth);
      return;
    }
    this.plugin.settings.cuts = this.plugin.settings.cuts.filter((cut) => !restored.includes(cut));
    void this.plugin.saveSettings();
    this.plugin.settingsChanged('filter');
  }

  private showAllLinks() {
    this.plugin.settings.cuts = [];
    void this.plugin.saveSettings();
    this.plugin.settingsChanged('filter');
  }

  /** Applies a state change: rebuilds the DOM only when the set of visible people changed. */
  private refresh() {
    if (!sameSet(this.computeVisibleIds(), this.visibleIds)) { this.rebuild(0.3); return; }
    const before = this.visibleNodes.map((node) => node.layoutRadius).join();
    this.restyle();
    // Only a change the physics can see (sizes) wakes the layout; selecting people or a route leaves it still.
    if (this.visibleNodes.map((node) => node.layoutRadius).join() === before) return;
    this.configureForces();
    this.reheat(0.3);
  }

  private rebuild(alpha: number) {
    this.visibleIds = this.computeVisibleIds();
    this.visibleNodes = this.nodes.filter((node) => this.visibleIds.has(node.id));
    this.visibleEdges = this.graph.edges.filter((edge) => this.visibleIds.has(edge.from) && this.visibleIds.has(edge.to));
    this.nodeViews.clear(); this.edgeViews = []; this.familyViews = []; this.links.clear();
    const { families, direct } = groupFamilies(this.visibleEdges);
    const noTone: Tone = '';
    for (const family of families) {
      const branches = family.children.map((child) => ({ child, edges: family.edges.filter((edge) => edge.to === child), tone: noTone, key: `b:${family.key}>${child}` }));
      const members = [...family.parents, ...family.children].map((id) => this.nodeById.get(id)!);
      this.familyViews.push({ family, members, connectorTone: '', halves: family.parents.length === 2 ? family.parents.map((parent) => ({ parent, onRoute: false })) : [], branches });
      for (const branch of branches) this.addLink(branch.key, branch.edges, family.parents, [branch.child]);
    }
    for (const edge of direct) {
      const key = `e:${edgeKey(edge)}`;
      this.edgeViews.push({ edge, a: this.nodeById.get(edge.from)!, b: this.nodeById.get(edge.to)!, tone: '', key });
      this.addLink(key, [edge], [edge.from], [edge.to]);
    }
    const byEdge = new Map(this.edgeViews.map((view) => [view.edge, view]));
    this.spouseViews = spouseGroups(this.visibleEdges).map((group) => {
      const edges = group.map((edge) => byEdge.get(edge)!);
      return { edges, members: [...new Set(edges.flatMap((view) => [view.a, view.b]))] };
    });
    this.spousesOf = new Map();
    for (const view of this.spouseViews.flatMap((group) => group.edges)) {
      this.spousesOf.set(view.a.id, [...(this.spousesOf.get(view.a.id) ?? []), view.b]);
      this.spousesOf.set(view.b.id, [...(this.spousesOf.get(view.b.id) ?? []), view.a]);
    }
    const problems = problemPeople(this.graph.issues);
    for (const node of this.visibleNodes) {
      this.nodeViews.set(node.id, { node, portrait: node.portrait ?? null, tone: '', endpoint: false, pinned: false, lit: true, badge: null, radius: node.radius ?? 22, problems: problems.get(node.id) ?? [] });
      if (node.portrait) this.loadPortrait(node.portrait);
    }
    // Highlight sets by drawing part key: `n:` people, `e:` direct links, `b:` family branches, `c:` dashed unions.
    this.hoverElements = hoverIndex<string>(this.graph,
      new Map([...this.nodeViews.keys()].map((id) => [id, `n:${id}`])),
      this.edgeViews.map((view) => ({ edge: view.edge, element: view.key })),
      this.familyViews.map((view) => ({
        family: view.family, stem: `s:${view.family.key}`, hub: `s:${view.family.key}`,
        connector: view.family.implicit ? `c:${view.family.key}` : null,
        branches: view.branches.map((branch) => ({ child: branch.child, element: branch.key })),
      })));
    this.restyle();
    this.configureForces();
    if (alpha === 1) { this.initialCameraPending = true; this.startCamera(); }
    this.reheat(alpha);
    this.render();
  }

  private addLink(id: string, edges: Edge[], sideA: string[], sideB: string[]) {
    this.links.set(id, { id, edges, sideA, sideB, mid: { x: 0, y: 0 }, line: null });
  }

  /** Decodes a portrait once into a small circular image, which the canvas then draws without clipping. */
  private loadPortrait(path: string) {
    if (this.portraits.has(path)) return;
    this.portraits.set(path, null);
    const href = this.plugin.resourcePath(path);
    if (!href) return;
    const image = new Image();
    image.onload = () => {
      const canvas = createEl('canvas');
      canvas.width = canvas.height = PORTRAIT_PIXELS;
      const ctx = canvas.getContext('2d')!;
      ctx.beginPath(); ctx.arc(PORTRAIT_PIXELS / 2, PORTRAIT_PIXELS / 2, PORTRAIT_PIXELS / 2, 0, Math.PI * 2); ctx.clip();
      // Cover the circle, cropping the longer side (xMidYMid slice).
      const scale = Math.max(PORTRAIT_PIXELS / (image.naturalWidth || 1), PORTRAIT_PIXELS / (image.naturalHeight || 1));
      const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
      ctx.drawImage(image, (PORTRAIT_PIXELS - width) / 2, (PORTRAIT_PIXELS - height) / 2, width, height);
      this.portraits.set(path, canvas);
      this.requestRender();
    };
    image.src = href;
  }

  /** Recomputes tones, sizes and badges; drawing reads them on the next frame. */
  private restyle() {
    const path = this.route();
    const pathNodes = new Set(path?.nodes ?? (this.rootsMode ? this.rootIds : this.pathEndpoints));
    const pathEdges = new Set(path?.edges ?? []);
    // Sizes are measured from the middle generation of the graph, not from the selection: selecting people only adds
    // a little to their own size, so drawn sizes stay what the layout spaced (spouses do not overlap).
    const everyone = this.visibleNodes.map((node) => node.generation).filter((value): value is number => value !== null).sort((a, b) => a - b);
    const layoutReference = everyone.length ? everyone[Math.floor(everyone.length / 2)] : null;
    const relatives = adjacency(this.graph);
    const settings = this.plugin.settings;
    const known = this.visibleNodes.map((node) => node.generation).filter((generation): generation is number => generation !== null);
    const range = known.length ? { min: Math.min(...known), max: Math.max(...known) } : null;
    const maxLinks = this.maxLinks = Math.max(0, ...this.visibleNodes.map((node) => relatives.get(node.id)?.length ?? 0));
    const byRelatives = settings.focus === 'relatives';
    const groups = this.relativeGroups = relativeGroups(this.visibleNodes.map((node) => relatives.get(node.id)?.length ?? 0));
    const highlighted = new Set(byRelatives ? settings.highlightRelatives : settings.highlightGenerations);
    // While Проблемы or Уточнить is open, generation colors and sizes step aside: everyone is a plain gray node of one
    // size, and people on the list are red or yellow, deeper with more entries.
    const audit = this.auditMode();
    const auditCount = (id: string) => audit === 'problems' ? this.nodeViews.get(id)?.problems.length ?? 0 : audit === 'clarify' ? this.plugin.clarifications.get(id)?.length ?? 0 : 0;
    const auditMax = audit ? Math.max(1, ...this.visibleNodes.map((node) => auditCount(node.id))) : 1;
    // With a limited route, side branches are context: lighter than the fully muted rest of the graph.
    const limited = this.routeLimited(path);
    for (const view of this.nodeViews.values()) {
      const node = view.node;
      const links = relatives.get(node.id)?.length ?? 0;
      node.color = byRelatives ? heatColor(links, maxLinks) : generationColor(node.generation, this.plugin.generationRange);
      const highlightKey = byRelatives ? groupOf(links, groups) : node.generation;
      view.lit = this.newestGeneration !== undefined ? node.generation === this.newestGeneration
        : !highlighted.size || (highlightKey !== null && highlighted.has(highlightKey));
      node.selected = !this.special() && this.focus.has(node.id);
      node.pathHighlighted = this.special() && pathNodes.has(node.id);
      node.pathEndpoint = this.special() && (this.rootsMode ? this.rootIds : this.pathEndpoints).includes(node.id);
      const aside = Boolean(path) && !pathNodes.has(node.id);
      node.dimmed = aside && !limited;
      const radius = view.radius = byRelatives
        ? visualRadius(node.generation, layoutReference, Boolean(view.portrait), node.selected, links)
        : generationRadius(node.generation, range, settings.generationSize === 'older', Boolean(view.portrait), node.selected);
      if (audit) {
        const count = auditCount(node.id);
        const depth = auditMax > 1 ? (count - 1) / (auditMax - 1) : 1;
        node.color = !count ? AUDIT_NEUTRAL : audit === 'problems' ? hslHex(0, 0.8, 0.72 - 0.3 * depth) : hslHex(45, 0.95, 0.78 - 0.33 * depth);
        view.radius = NODE_RADIUS;
      }
      node.layoutRadius = byRelatives
        ? visualRadius(node.generation, layoutReference, Boolean(view.portrait), false, links)
        : generationRadius(node.generation, range, settings.generationSize === 'older', Boolean(view.portrait), false);
      view.tone = node.pathHighlighted ? 'route' : node.dimmed ? 'muted' : aside && limited ? 'context' : '';
      view.endpoint = Boolean(node.pathEndpoint);
      view.pinned = Boolean(node.selected || node.pathHighlighted);
      node.radius ??= radius; // A new person starts at full size; later changes ease in (see composeFrame).
      const hiddenCount = this.hiddenCounts.get(node.id);
      view.badge = hiddenCount ? { text: `+${hiddenCount}`, width: 8 + `+${hiddenCount}`.length * 6.5 } : null;
    }
    const offPath: Tone = path ? limited ? 'context' : 'muted' : '';
    const tone = (onPath: boolean): Tone => onPath ? 'route' : offPath;
    for (const view of this.edgeViews) view.tone = tone(pathEdges.has(view.edge));
    for (const view of this.familyViews) {
      view.connectorTone = offPath;
      for (const half of view.halves) half.onRoute = view.family.edges.some((edge) => edge.from === half.parent && pathEdges.has(edge));
      for (const branch of view.branches) branch.tone = tone(branch.edges.some((edge) => pathEdges.has(edge)));
    }
    // The link preview also depends on the current center, so recompute it.
    this.selectLink(this.selectedLink);
    this.applyHover();
    this.updateControls();
    this.requestRender();
  }

  /** Sends the visible graph to the physics worker; radii and selection shape its forces. */
  private configureForces() {
    this.layout.setGraph(this.visibleNodes, this.visibleEdges.map((edge) => ({ source: edge.from, target: edge.to, relation: edge.relation })));
  }

  /** Wakes the living layout without scattering it: the graph settles from where it is. */
  private reheat(alpha: number) {
    if (!this.visibleNodes.length) { this.layout.stop(); return; }
    this.layout.reheat(alpha, alpha === 1);
  }

  /** Draws on the next display frame; several requests in one frame draw once. */
  private requestRender() {
    if (this.renderFrame === null && this.canvas && !this.frozen) this.renderFrame = window.requestAnimationFrame(() => { this.renderFrame = null; this.render(); });
  }

  private render() {
    if (this.renderFrame !== null) { window.cancelAnimationFrame(this.renderFrame); this.renderFrame = null; }
    if (this.frozen) return;
    if (!this.canvas || !this.viewport.width || !this.viewport.height) return;
    this.fader.begin(performance.now());
    drawFrame(this.ctx, this.composeFrame(), this.palette);
    this.fader.end();
    this.placeNodePlus();
    // Keep drawing while a highlight or a size change is still easing in.
    if (this.fader.moving) this.requestRender();
  }

  /**
   * Builds this frame's draw items from the people's current positions and the view's state. Opacities and sizes
   * go through the fader, so selecting people or highlighting generations eases in and out instead of jumping.
   */
  private composeFrame(): Frame {
    const palette = this.palette;
    const fade = this.fader;
    const lifted = this.litKeys;
    const base: Layer = { edges: [], nodes: [], labels: [] };
    const top: Layer = { edges: [], nodes: [], labels: [] };
    const layerOf = (key: string) => lifted?.has(key) ? top : base;
    const alphaOf = (key: string, tone: Tone, previewed: boolean, lit = true) =>
      fade.value(key, (previewed ? 0.2 : TONE_ALPHA[tone]) * (lifted && !lifted.has(key) ? FOCUS_DIM : 1) * (lit ? 1 : this.newestGeneration !== undefined ? TIMELAPSE_DIM : GENERATION_DIM), 0);
    // A link stays bright when both of its ends are in highlighted generations.
    const lit = (id: string) => this.nodeViews.get(id)?.lit ?? true;
    const toneColor = (tone: Tone, normal: string) => tone === 'route' ? palette.route : normal;
    const preview = this.cutPreview;
    const previewed = (link: LinkTarget) => preview.size > 0 && link.id !== this.selectedLink && (link.sideA.some((id) => preview.has(id)) || link.sideB.some((id) => preview.has(id)));
    // Sizes first: links end at the circles and the shapes around spouses follow them.
    for (const view of this.nodeViews.values()) {
      const target = view.radius * (view.node.id === this.hoverId ? HOVER_GROW : 1);
      view.node.radius = fade.value(`r:${view.node.id}`, target, target);
    }
    // Geometry is computed only for links that can reach the screen; the rest keep their last hit line.
    const margin = 60 / this.zoom + 80;
    const screen = {
      left: -this.cameraX / this.zoom - margin, top: -this.cameraY / this.zoom - margin,
      right: (this.viewport.width - this.cameraX) / this.zoom + margin, bottom: (this.viewport.height - this.cameraY) / this.zoom + margin,
    };
    const onScreen = (nodes: ForceNode[]) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const node of nodes) { minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x); minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y); }
      return maxX >= screen.left && minX <= screen.right && maxY >= screen.top && minY <= screen.bottom;
    };
    // Spouses: one merged shape per group. Capsules that look the same go into one path, so overlaps stay even.
    for (const group of this.spouseViews) {
      if (!onScreen(group.members)) continue;
      const shapes = new Map<string, ShapeItem>();
      for (const view of group.edges) {
        const { a, b } = view;
        const link = this.links.get(view.key)!;
        link.line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        link.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        link.reach = Math.min(nodeRadius(a), nodeRadius(b)) + SPOUSE_PAD;
        const selected = link.id === this.selectedLink;
        const color = selected ? palette.accent : toneColor(view.tone, palette.spouse);
        const alpha = (selected ? 1.6 : alphaOf(view.key, view.tone, previewed(link), lit(a.id) && lit(b.id))) * SPOUSE_FILL_OPACITY;
        const layer = layerOf(view.key);
        const style = `${layer === top ? 't' : 'b'}${color}${alpha.toFixed(3)}`;
        let shape = shapes.get(style);
        if (!shape) { shape = { kind: 'shape', outlines: [], color, alpha }; shapes.set(style, shape); layer.edges.push(shape); }
        shape.outlines.push(spouseCapsule(a, b).outline);
      }
    }
    for (const view of this.familyViews) {
      if (!onScreen(view.members)) continue;
      const shape = familyShape(view.family, this.nodeById);
      if (!shape) continue;
      if (shape.connector) {
        const key = `c:${view.family.key}`;
        layerOf(key).edges.push({ kind: 'line', x1: shape.connector.start.x, y1: shape.connector.start.y, x2: shape.connector.end.x, y2: shape.connector.end.y,
          color: palette.edge, width: 1.2, dash: [3, 4], alpha: alphaOf(key, view.connectorTone, false, view.family.parents.every(lit)) });
      }
      for (const [index, branch] of shape.branches.entries()) {
        const branchView = view.branches[index];
        const link = this.links.get(branchView.key)!;
        link.line = { x1: branch.start.x, y1: branch.start.y, x2: branch.end.x, y2: branch.end.y };
        link.mid = { x: (branch.start.x + branch.end.x) / 2, y: (branch.start.y + branch.end.y) / 2 };
        const selected = link.id === this.selectedLink;
        layerOf(branchView.key).edges.push({ kind: 'line', ...link.line, arrow: true,
          color: selected ? palette.accent : toneColor(branchView.tone, palette.edge), width: branchView.tone === 'route' ? 4 : 1.7,
          alpha: selected ? 1 : alphaOf(branchView.key, branchView.tone, previewed(link), lit(branchView.child) && view.family.parents.some(lit)) });
      }
      for (const [index, half] of shape.halves.entries()) {
        if (!view.halves[index]?.onRoute) continue;
        const key = `h:${view.family.key}>${half.parent}`;
        base.edges.push({ kind: 'line', x1: half.start.x, y1: half.start.y, x2: half.end.x, y2: half.end.y, color: palette.route, width: 4, round: true, alpha: alphaOf(key, '', false) });
      }
    }
    for (const view of this.edgeViews) {
      if (view.edge.relation === 'spouse') continue; // Drawn above as shapes.
      const a = view.a; const b = view.b;
      if (!onScreen([a, b])) continue;
      const link = this.links.get(view.key)!;
      const { start, end } = edgeEndpoints(a, b);
      link.line = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
      link.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const selected = link.id === this.selectedLink;
      layerOf(view.key).edges.push({ kind: 'line', ...link.line, arrow: true, dash: view.edge.adoptive ? [6, 4] : undefined,
        color: selected ? palette.accent : toneColor(view.tone, palette.edge), width: view.tone === 'route' ? 4 : 1.7,
        alpha: selected ? 1 : alphaOf(view.key, view.tone, previewed(link), lit(a.id) && lit(b.id)) });
    }
    const hitBase: HitNode[] = []; const hitTop: HitNode[] = [];
    const colors = { route: palette.route, selected: palette.accent, hypothesis: palette.hypothesis };
    const audit = this.auditMode();
    for (const view of this.nodeViews.values()) {
      const node = view.node; const key = `n:${node.id}`;
      const radius = node.radius ?? 22;
      const route = view.tone === 'route';
      const portrait = view.portrait ? this.portraits.get(view.portrait) ?? null : null;
      const nodeAlpha = alphaOf(key, route ? '' : view.tone, this.cutPreview.has(node.id), view.lit);
      const chosen = fade.value(`s:${node.id}`, node.selected ? 1 : 0, 0);
      // Portraits fade out together with the names; far out every person is a plain colored node.
      const image = portrait && this.labelLevel > 0 && !audit ? portrait : null;
      const badge = view.badge ? { ...view.badge, x: radius * 0.72, y: -radius * 0.72 } : null;
      const item: NodeItem = {
        x: node.x, y: node.y, radius, alpha: nodeAlpha, fill: audit ? node.color : nodeFill(node), image, imageAlpha: this.labelLevel, veil: Boolean(node.deceased && image),
        // The selection ring fades in over the usual outline.
        outline: nodeOutline({ ...node, selected: false, pathEndpoint: view.endpoint }, colors, Boolean(portrait)),
        ring: !route && chosen > 0 ? { color: palette.accent, width: 3, alpha: chosen } : null,
        halo: route ? { color: palette.route, opacity: 0.35 } : chosen > 0.01 ? { color: palette.accent, opacity: 0.3 * chosen } : null,
        badge,
      };
      const layer = layerOf(key);
      layer.nodes.push(item);
      (layer === top ? hitTop : hitBase).push({ id: node.id, x: node.x, y: node.y, radius, badge });
      const pinned = fade.value(`p:${node.id}`, view.pinned ? 1 : 0, 0);
      const labelAlpha = Math.max(pinned, this.labelLevel) * nodeAlpha;
      if (labelAlpha > 0) {
        const lines = labelLines(node);
        const place = labelLayout(node, radius, labelSide(node, (this.spousesOf.get(node.id) ?? [])), Boolean(node.lifeYears), lines.length);
        layer.labels.push({ ...place, name: lines, years: node.lifeYears ?? '', alpha: labelAlpha } satisfies LabelItem);
      }
    }
    this.hitNodes = [...hitBase, ...hitTop];
    const link = this.selectedLink ? this.links.get(this.selectedLink) : null;
    this.eyeAt = link ? link.mid : null;
    return {
      width: this.viewport.width, height: this.viewport.height, ratio: this.canvas.width / this.viewport.width,
      camera: { x: this.cameraX, y: this.cameraY, zoom: this.zoom },
      layers: [base, top],
      eye: link ? { x: link.mid.x, y: link.mid.y, disabled: !this.linkProposal } : null,
    };
  }

  private setHover(id: string | null) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.applyHover();
  }

  /**
   * Highlights the selected people with their relatives and links; the rest fades (see advanceHover). Hovering only
   * enlarges the person under the pointer (see composeFrame) and does not change the highlight.
   */
  private applyHover() {
    const sources = this.special() ? [] : [...this.focus].filter((id) => this.nodeViews.has(id));
    if (sources.length) {
      const keys = new Set<string>();
      for (const id of sources) for (const key of this.hoverElements.get(id) ?? []) keys.add(key);
      this.litKeys = keys;
    } else this.litKeys = null;
    this.requestRender();
  }

  private eyeTitle(): string {
    return this.selectedLink ? this.linkProposal ? t().graph.hideCount(this.linkProposal.region.size) : t().graph.notBranch : '';
  }

  private hitAt(event: MouseEvent): Hit {
    const rect = this.panel.getBoundingClientRect();
    const x = (event.clientX - rect.left - this.cameraX) / this.zoom;
    const y = (event.clientY - rect.top - this.cameraY) / this.zoom;
    const links = [...this.links.values()].flatMap((link) => link.line ? [{ id: link.id, ...link.line, reach: link.reach }] : []);
    return hitTest(x, y, this.zoom, this.hitNodes, links, this.eyeAt);
  }

  private hover(event: MouseEvent, hit: Hit) {
    this.panel.style.cursor = hit ? hit.kind === 'eye' && !this.linkProposal ? 'not-allowed' : 'pointer' : '';
    const problems = hit?.kind === 'node' ? this.nodeViews.get(hit.id)?.problems ?? [] : [];
    this.panel.title = problems.length
      ? `${t().graph.problems}:\n${problems.map(issueText).join('\n')}`
      : this.eyeTitle();
    const id = hit?.kind === 'node' ? hit.id : null;
    if (id === this.hoverId) return;
    this.setHover(id);
    if (id) this.app.workspace.trigger('hover-link', { event, source: VIEW_TYPE, hoverParent: this, targetEl: this.canvas, linktext: id, sourcePath: id });
  }

  /**
   * A click selects only this person and zooms in; Shift+click adds to the selection instead. A click (with or
   * without Shift) on a selected person deselects them where the camera is. A double click, or Ctrl/Cmd+click,
   * opens the note and leaves the person selected.
   */
  private nodeClick(id: string, event: MouseEvent) {
    if (this.plugin.picker) { this.plugin.picker.pick(id); return; }
    this.lastClick = { id, time: performance.now(), x: event.clientX, y: event.clientY };
    if (this.rootsMode) { this.chooseRoot(id); return; }
    if (this.pathMode) { this.choosePathPerson(id); return; }
    if (event.ctrlKey || event.metaKey) { void this.plugin.openNote(id); return; }
    if (this.focus.has(id)) { this.deselect(id); return; }
    this.focusPerson(id, event.shiftKey);
  }

  /** Selects a person alone, or adds them to the selection, and brings the selection into view. */
  /** The person's profile over the graph; the graph freezes under it (see freeze). */
  openProfile(id: string) {
    const { app, plugin } = this;
    const file = (path: string) => { const found = app.vault.getAbstractFileByPath(path); return found instanceof TFile ? found : null; };
    const person = (path: string) => plugin.graph.people.find((item) => item.id === path);
    new ProfileModal(app, {
      graph: () => plugin.graph,
      selfId: () => plugin.settings.selfPersonId,
      fields: (path) => { const target = file(path); const fm = target && app.metadataCache.getFileCache(target)?.frontmatter; return fm ? readFields(fm).fields : null; },
      body: async (path) => {
        const target = file(path);
        if (!target) return '';
        const text = await app.vault.cachedRead(target);
        const end = app.metadataCache.getFileCache(target)?.frontmatterPosition?.end.offset;
        return end ? text.slice(end) : text;
      },
      portrait: (path) => {
        const found = person(path)?.portrait;
        const url = found ? plugin.resourcePath(found) : null;
        if (!found || !url) return null;
        const photo = references(person(path)?.photo)[0];
        return { url, links: [found, found.split('/').pop()!, ...(photo ? [photo] : [])] };
      },
      personAt: (link, source) => { const target = app.metadataCache.getFirstLinkpathDest(link, source); return target && plugin.personIds.has(target.path) ? target.path : null; },
      openLink: (link, source) => void app.workspace.openLinkText(link, source),
      openNote: (path) => void plugin.openNote(path),
      showOnGraph: (path) => { if (this.special()) this.centerOn([path]); else this.focusPerson(path); },
      edit: (path) => { if (!this.special()) this.focusPerson(path); void plugin.openEditor(); },
      freeze: () => this.freeze(),
      thaw: () => this.thaw(),
    }, id, language()).open();
  }

  /** Stops the layout and drawing while something covers the graph, so it spends nothing in the background. */
  private freeze() {
    if (this.frozen) return;
    this.frozen = { running: this.layout.running || this.plugin.settings.freeLayout };
    this.stopTimelapse();
    this.layout.stop();
  }

  private thaw() {
    const frozen = this.frozen;
    if (!frozen) return;
    this.frozen = null;
    if (frozen.running && this.visibleNodes.length) this.layout.reheat(0.1);
    this.requestRender();
  }

  private focusPerson(id: string, add = false) {
    const changed = add ? !this.focus.has(id) : !(this.focus.size === 1 && this.focus.has(id));
    if (changed) {
      if (!add) this.focus.clear();
      this.focus.add(id);
      this.refresh();
    }
    this.frameSelection();
  }

  /** Fits the selected people with their parents, children and spouses: one generation each way, no further. */
  private frameSelection() {
    const ids = new Set(this.focus);
    const neighbors = adjacency(this.graph);
    for (const id of this.focus) for (const { next } of neighbors.get(id) ?? []) if (this.visibleIds.has(next)) ids.add(next);
    const nodes = [...ids].map((id) => this.nodeById.get(id)).filter((node): node is ForceNode => Boolean(node));
    const target = this.fitTarget(nodes, 60);
    if (!target) return;
    this.stopFollowing();
    this.animateCamera({ ...target, zoom: Math.min(target.zoom, SELECTION_MAX_ZOOM) });
  }

  /** A person chosen in the search: selected (or a route end in route mode). */
  private pickPerson(id: string) {
    if (!this.visibleIds.has(id)) {
      // Hidden by a filter or a hidden branch: show everyone again so the person can be reached.
      this.plugin.settings.cuts = this.plugin.settings.cuts.filter((cut) => !cut.hide.includes(id));
    }
    if (this.rootsMode) { this.chooseRoot(id); return; }
    if (this.pathMode) { this.choosePathPerson(id); this.centerOn([id]); return; }
    this.focusPerson(id);
  }

  /** All pointer, wheel and keyboard input of the graph: the canvas has no elements to listen on. */
  private installInput() {
    const panel = this.panel;
    const onCanvas = (event: Event) => event.target === this.canvas;
    panel.addEventListener('pointerdown', (event) => {
      // Controls inside the panel (zoom buttons, the side panel) handle their own clicks.
      if (event.button !== 0 || !onCanvas(event)) return;
      if (event.pointerType !== 'mouse') this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size === 2) { panel.setPointerCapture(event.pointerId); this.startPinch(); return; }
      if (this.touches.size > 2 || this.pinch) return;
      panel.focus({ preventScroll: true });
      const hit = this.hitAt(event);
      const node = hit?.kind === 'node' ? this.nodeById.get(hit.id) : undefined;
      this.pointer = { id: event.pointerId, kind: node ? 'node' : hit ? 'press' : 'pan', hit,
        startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, originX: node?.x ?? 0, originY: node?.y ?? 0, moved: false };
      panel.setPointerCapture(event.pointerId);
      if (!hit) this.cancelWheelZoom(); // Grabbing the background stops a zoom glide, as it stops following.
      // iOS sends no contextmenu for a held finger, so the long press is timed here.
      if (event.pointerType !== 'mouse' && hit?.kind === 'node') {
        const id = hit.id;
        this.longPressTimer = window.setTimeout(() => {
          this.longPressTimer = null;
          const pointer = this.pointer;
          if (!pointer || pointer.id !== event.pointerId || pointer.moved) return;
          this.pointer = null; this.lastClick = null; this.holdMenu(pointer.id);
          this.nodeMenu(id).showAtPosition({ x: pointer.lastX, y: pointer.lastY });
        }, LONG_PRESS_MS);
      }
    });
    panel.addEventListener('pointermove', (event) => {
      if (this.touches.has(event.pointerId)) this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch) { if (this.touches.has(event.pointerId)) this.movePinch(); return; }
      const pointer = this.pointer;
      if (!pointer || pointer.id !== event.pointerId) { if (!this.touches.has(event.pointerId)) this.hover(event, onCanvas(event) ? this.hitAt(event) : null); return; }
      // A finger trembles more than a mouse: it needs a longer way to count as a drag.
      if (!pointer.moved && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > (event.pointerType === 'mouse' ? 3 : 8)) {
        pointer.moved = true;
        this.cancelLongPress();
        if (pointer.kind !== 'press') this.stopFollowing(); // The camera stays put while the pointer drags.
        // A drag wakes the layout only once the pointer really moves: a plain click leaves the graph still.
        if (pointer.kind === 'node' && pointer.hit?.kind === 'node') { this.layout.fix(pointer.hit.id, pointer.originX, pointer.originY); this.layout.hold(); }
      }
      if (pointer.kind === 'node' && pointer.hit?.kind === 'node' && pointer.moved) {
        this.layout.fix(pointer.hit.id, pointer.originX + (event.clientX - pointer.startX) / this.zoom, pointer.originY + (event.clientY - pointer.startY) / this.zoom);
      } else if (pointer.kind === 'pan') {
        this.cameraX += event.clientX - pointer.lastX; this.cameraY += event.clientY - pointer.lastY;
        this.applyCamera();
      }
      pointer.lastX = event.clientX; pointer.lastY = event.clientY;
    });
    const finish = (event: PointerEvent, completed: boolean) => {
      this.touches.delete(event.pointerId);
      if (this.pinch) {
        this.pinch = this.touches.size >= 2 ? this.pinchState() : null;
        if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId);
        return;
      }
      if (this.longPressed === event.pointerId) {
        this.longPressed = null;
        if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId);
        return;
      }
      const pointer = this.pointer;
      if (!pointer || pointer.id !== event.pointerId) return;
      this.pointer = null;
      this.cancelLongPress();
      if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId);
      const hit = pointer.hit;
      if (pointer.kind === 'node' && hit?.kind === 'node' && pointer.moved) {
        this.layout.fix(hit.id, null, null);
        this.layout.release();
      }
      if (!completed || pointer.moved) return;
      // A second click at the same spot soon after a click on a person is a double click on that person, even if the
      // camera has meanwhile moved them away from the pointer (the browser's dblclick would come too late for that).
      const last = this.lastClick;
      if (last && !this.plugin.picker && performance.now() - last.time < DOUBLE_CLICK_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < (event.pointerType === 'mouse' ? 6 : 24)) {
        this.lastClick = null;
        if (!this.special() && !this.focus.has(last.id)) { this.focus.add(last.id); this.refresh(); }
        if (event.pointerType !== 'mouse') this.keepTouchEnd();
        this.openProfile(last.id);
        return;
      }
      this.lastClick = null;
      if (hit?.kind === 'node') this.nodeClick(hit.id, event);
      else if (hit?.kind === 'eye') this.hideSelectedLink();
      else if (hit?.kind === 'badge') this.revealAt(hit.id);
      else if (hit?.kind === 'link') { this.deselectAll(); this.selectLink(this.selectedLink === hit.id ? null : hit.id); }
      else { this.deselectAll(); this.selectLink(null); }
    };
    panel.addEventListener('pointerup', (event) => finish(event, true));
    panel.addEventListener('pointercancel', (event) => finish(event, false));
    panel.addEventListener('lostpointercapture', (event) => finish(event, false));
    panel.addEventListener('pointerleave', () => { if (!this.pointer) { this.setHover(null); panel.style.removeProperty('cursor'); } });
    panel.addEventListener('contextmenu', (event) => {
      // Android also sends contextmenu for a held finger: one menu is enough.
      if (this.longPressed !== null) { event.preventDefault(); return; }
      const hit = onCanvas(event) ? this.hitAt(event) : null;
      if (hit?.kind !== 'node') return;
      event.preventDefault();
      if (this.pointer && this.touches.has(this.pointer.id)) { this.cancelLongPress(); this.holdMenu(this.pointer.id); this.pointer = null; }
      this.nodeMenu(hit.id).showAtMouseEvent(event);
    });
    panel.addEventListener('auxclick', (event) => {
      if (event.button !== 1 || !onCanvas(event)) return;
      const hit = this.hitAt(event);
      if (hit?.kind !== 'node') return;
      event.preventDefault();
      void this.plugin.openNote(hit.id, true);
    });
    panel.addEventListener('wheel', (event) => {
      if (!onCanvas(event)) return; // Scrolling the side panel scrolls it.
      event.preventDefault();
      this.stopFollowing();
      const rect = panel.getBoundingClientRect();
      // The wheel moves a target; the camera glides to it (see stepWheelZoom), so notches blend into one motion.
      const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (this.wheelZoom?.target ?? this.zoom) * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE)));
      this.wheelZoom = { target, x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (this.wheelFrame === null) { this.wheelTime = null; this.wheelFrame = window.requestAnimationFrame((time) => this.stepWheelZoom(time)); }
    }, { passive: false });
    panel.addEventListener('keydown', (event) => {
      if (event.key === '+' || event.key === '=') this.zoomBy(1.4);
      else if (event.key === '-' || event.key === '_') this.zoomBy(1 / 1.4);
      else if (event.key === '0') this.followGraph();
      else if (event.key === 'Escape' && this.plugin.picker) this.plugin.stopPick(true);
      else if (event.key === 'Escape') { if (this.selectedLink) this.selectLink(null); else if (this.rootsMode) this.toggleRootsMode(); else if (this.pathMode) this.togglePathMode(); else this.clearSelection(); }
      else return;
      event.preventDefault();
    });
  }

  /** The menu of a person: right click, or a long press on a touch screen. */
  private nodeMenu(id: string): Menu {
    const menu = new Menu();
    const words = t().graph.menu;
    menu.addItem((item) => item.setTitle(words.profile).setIcon('id-card').onClick(() => this.openProfile(id)));
    menu.addItem((item) => item.setTitle(words.openNote).setIcon('file-text').onClick(() => void this.plugin.openNote(id)));
    menu.addItem((item) => item.setTitle(words.openTab).setIcon('file-plus').onClick(() => void this.plugin.openNote(id, true)));
    menu.addItem((item) => item.setTitle(words.edit).setIcon('user-round-pen').onClick(() => { this.focusPerson(id); void this.plugin.openEditor(); }));
    menu.addSeparator();
    for (const relation of ['parent', 'child', 'spouse', 'sibling'] as Relation[]) {
      menu.addItem((item) => item.setTitle(words.add(relationTitle(relation))).setIcon('plus').onClick(() => void this.plugin.startCreate(relation, id)));
    }
    if (this.rootsMode) {
      menu.addItem((item) => item.setTitle(this.rootIds.includes(id) ? words.removeRoot : words.addRoot).setIcon('sprout').onClick(() => this.chooseRoot(id)));
    } else if (!this.pathMode) {
      menu.addItem((item) => item.setTitle(this.focus.has(id) ? words.deselect : words.select).setIcon('target').onClick(() => this.toggleFocus(id)));
    }
    return menu;
  }

  /** A second finger turns the gesture into a pinch: whatever the first finger was doing stops. */
  private startPinch() {
    this.cancelLongPress();
    const pointer = this.pointer;
    this.pointer = null; this.lastClick = null;
    if (pointer?.kind === 'node' && pointer.hit?.kind === 'node' && pointer.moved) { this.layout.fix(pointer.hit.id, null, null); this.layout.release(); }
    this.stopFollowing(); this.cancelWheelZoom();
    this.pinch = this.pinchState();
  }

  private pinchState(): { distance: number; x: number; y: number } {
    const [a, b] = [...this.touches.values()];
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** The graph follows the fingers: the midpoint pans it, the spread zooms it around the midpoint. */
  private movePinch() {
    const last = this.pinch!, next = this.pinchState();
    const rect = this.panel.getBoundingClientRect();
    this.cameraX += next.x - last.x; this.cameraY += next.y - last.y;
    this.zoomAround(this.zoom * next.distance / last.distance, next.x - rect.left, next.y - rect.top);
    this.pinch = next;
  }

  /** The finger that opened a menu is still down; its release must not close the menu (see keepTouchEnd). */
  private holdMenu(pointerId: number) {
    this.longPressed = pointerId;
    this.keepTouchEnd();
  }

  /**
   * After a finger lifts, the browser follows touchend with mousedown, mouseup and click for old pages. When the touch
   * has just opened a menu or a modal, that mousedown outside it would close it at once: touchend cancels them.
   */
  private keepTouchEnd() {
    this.panel.addEventListener('touchend', (event) => { if (event.cancelable) event.preventDefault(); }, { once: true, passive: false });
  }

  private cancelLongPress() {
    if (this.longPressTimer !== null) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  /** Eases the zoom toward the wheel's target around the pointer, frame-rate independently. */
  private stepWheelZoom(time: number) {
    this.wheelFrame = null;
    const wheel = this.wheelZoom;
    if (!wheel) return;
    const elapsed = this.wheelTime === null ? 1000 / 60 : Math.min(100, time - this.wheelTime);
    this.wheelTime = time;
    const remaining = Math.log(wheel.target / this.zoom);
    const done = Math.abs(remaining) < 0.002;
    // Geometric easing: equal wheel notches feel equal at any zoom level.
    const step = remaining * (1 - Math.exp(-elapsed / WHEEL_EASE_MS));
    // Fast scrolling stacks notches; capping the per-frame step keeps that glide as smooth as a single notch.
    const capped = Math.sign(step) * Math.min(Math.abs(step), WHEEL_MAX_STEP * elapsed / (1000 / 60));
    this.zoomAround(done ? wheel.target : this.zoom * Math.exp(capped), wheel.x, wheel.y);
    if (done) { this.wheelZoom = null; return; }
    this.wheelFrame = window.requestAnimationFrame((next) => this.stepWheelZoom(next));
  }

  private cancelWheelZoom() {
    if (this.wheelFrame !== null) window.cancelAnimationFrame(this.wheelFrame);
    this.wheelFrame = null; this.wheelZoom = null;
  }

  private zoomAround(next: number, mx: number, my: number) {
    next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    const factor = next / this.zoom;
    this.cameraX = mx - (mx - this.cameraX) * factor;
    this.cameraY = my - (my - this.cameraY) * factor;
    this.zoom = next; this.applyCamera();
  }

  private zoomBy(factor: number) {
    const center = this.cameraCenter();
    this.stopFollowing();
    this.animateCamera({ ...center, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor)) });
  }

  private applyCamera() {
    this.updateLabels();
    this.requestRender();
  }

  /** Names fade out as the graph zooms out and are not drawn at all below that, like labels in the built-in graph. */
  private updateLabels() {
    this.labelLevel = Math.round(Math.max(0, Math.min(1, (this.zoom - LABELS_HIDDEN_BELOW) / (LABELS_SHOWN_ABOVE - LABELS_HIDDEN_BELOW))) * LABEL_STEPS) / LABEL_STEPS;
  }

  private cameraCenter(): { cx: number; cy: number } {
    return { cx: (this.viewport.width / 2 - this.cameraX) / this.zoom, cy: (this.viewport.height / 2 - this.cameraY) / this.zoom };
  }

  /** `bottomInset`: screen pixels at the bottom covered by the dock and its card; the nodes fit above them. */
  /** A camera showing `nodes`, between `topInset` and `bottomInset` pixels covered by panels at the edges. */
  private fitTarget(nodes: SceneNode[], padding = 50, bottomInset = 0, topInset = 0): CameraTarget | null {
    const rect = this.viewport;
    if (!rect.width || !rect.height || !nodes.length) return null;
    // On a phone the dock and Obsidian's navigation bar under it always cover the bottom.
    if (document.body.hasClass('is-phone') && this.dock) bottomInset = Math.max(bottomInset, this.panel.getBoundingClientRect().bottom - this.dock.getBoundingClientRect().top);
    const bounds = sceneBounds({ nodes, edges: [] }, padding);
    const height = Math.max(rect.height / 2, rect.height - bottomInset - topInset);
    const zoom = Math.min(3, Math.max(0.1, Math.min(rect.width / bounds.width, height / bounds.height) * 0.9));
    // The free band sits between the insets: its middle is shifted from the panel's by half their difference.
    const covered = bottomInset + topInset;
    const shift = covered ? (rect.height - height) * (bottomInset - topInset) / covered / 2 : 0;
    return { cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height / 2 + shift / zoom, zoom };
  }

  private startCamera() {
    const target = this.fitTarget(this.visibleNodes);
    if (!target || this.cameraTouched) return;
    this.initialCameraPending = false;
    // Reserve space for the spread, rather than showing it clipped and then shrinking the camera.
    const expectedSpan = Math.sqrt(this.visibleNodes.length) * 263;
    const spreadZoom = Math.min(this.viewport.width, this.viewport.height) / expectedSpan * 0.9;
    this.snapCamera({ ...target, zoom: Math.max(0.1, Math.min(1, target.zoom, spreadZoom)) });
  }

  /** Fits the whole visible graph and keeps following it while the layout moves. */
  private followGraph() {
    this.cameraTouched = false;
    this.animateCamera(this.followTarget());
  }

  /** Everyone visible, kept above the route card while it is open. */
  private followTarget(): CameraTarget | null {
    const panel = this.panel.getBoundingClientRect();
    const covered = this.routeCard?.isShown() ? panel.bottom - this.routeCard.getBoundingClientRect().top : 0;
    // «Поколение за поколением» keeps people below its titles.
    const titles = this.credits?.childElementCount ? this.credits.getBoundingClientRect().bottom - panel.top : 0;
    return this.fitTarget(this.visibleNodes, 50, Math.max(0, covered), Math.max(0, titles));
  }

  private stopFollowing() {
    this.cameraTouched = true;
    this.initialCameraPending = false;
    this.cameraTarget = null;
  }

  private fitNodes(ids: string[], padding: number, bottomInset = 0) {
    const nodes = ids.map((id) => this.nodeById.get(id)).filter((node): node is ForceNode => Boolean(node));
    const target = this.fitTarget(nodes, padding, bottomInset);
    if (!target) return;
    this.stopFollowing();
    this.animateCamera(target);
  }

  private centerOn(ids: string[]) {
    const nodes = ids.map((id) => this.nodeById.get(id)).filter((node): node is ForceNode => Boolean(node));
    if (!nodes.length) return;
    this.stopFollowing();
    this.animateCamera({
      cx: nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
      cy: nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length,
      zoom: this.zoom,
    });
  }

  private snapCamera(target: CameraTarget | null) {
    if (!target) return;
    const rect = this.viewport;
    if (!rect.width || !rect.height) return;
    this.zoom = target.zoom;
    this.cameraX = rect.width / 2 - target.cx * this.zoom;
    this.cameraY = rect.height / 2 - target.cy * this.zoom;
    this.applyCamera();
  }

  /** Eases the camera toward a target over a few frames instead of jumping. */
  private animateCamera(target: CameraTarget | null) {
    if (!target) return;
    this.cancelWheelZoom();
    this.cameraTarget = target;
    if (this.cameraFrame === null) this.cameraFrame = window.requestAnimationFrame(() => this.stepCamera());
  }

  private stepCamera() {
    this.cameraFrame = null;
    const target = this.cameraTarget;
    if (!target) return;
    if (!this.viewport.width || !this.viewport.height) return;
    const current = this.cameraCenter();
    const k = 0.22;
    const zoom = this.zoom + (target.zoom - this.zoom) * k;
    const cx = current.cx + (target.cx - current.cx) * k;
    const cy = current.cy + (target.cy - current.cy) * k;
    const done = Math.abs(target.zoom - zoom) < 0.002 && Math.hypot(target.cx - cx, target.cy - cy) * zoom < 0.5;
    this.snapCamera(done ? target : { cx, cy, zoom });
    if (done) this.cameraTarget = null;
    else this.cameraFrame = window.requestAnimationFrame(() => this.stepCamera());
  }

  /**
   * The control panel in the corner of the graph. It reuses the markup and classes of Obsidian's graph view
   * (`graph-controls`), so the gear, the close cross in its place, spacing and backgrounds match the built-in one.
   */
  private buildControls() {
    const settings = this.plugin.settings;
    const words = t().graph;
    this.controls = this.panel.createDiv({ cls: 'graph-controls genealogy-controls' });
    const open = this.controls.createDiv({ cls: 'clickable-icon graph-controls-button mod-open', attr: { 'aria-label': words.controlsOpen } });
    setIcon(open, 'settings');
    const close = this.controls.createDiv({ cls: 'clickable-icon graph-controls-button mod-close', attr: { 'aria-label': words.controlsClose } });
    setIcon(close, 'x');
    // On a phone the open panel covers half the graph: it starts folded there, and folding it there is not remembered
    // for the computer, which shares the settings through the vault.
    const phone = document.body.hasClass('is-phone');
    const setOpen = (value: boolean, save = true) => {
      this.controls.toggleClass('is-close', !value);
      if (!save || phone) return;
      settings.controls.open = value;
      this.plugin.requestSave();
    };
    open.addEventListener('click', () => setOpen(true));
    close.addEventListener('click', () => setOpen(false));
    // Under the gear while the panel is folded, as the timelapse button of the graph view.
    const animate = this.controls.createDiv({ cls: 'clickable-icon graph-controls-button mod-animate', attr: { 'aria-label': words.timelapse } });
    setIcon(animate, 'play');
    animate.addEventListener('click', () => this.toggleTimelapse());
    this.timelapseButtons.push(animate);
    // «Отпустить граф» under it: the layout never comes to rest while it is on.
    this.freeButton = this.controls.createDiv({ cls: 'clickable-icon graph-controls-button mod-animate genealogy-free-button' });
    setIcon(this.freeButton, 'wind');
    this.freeButton.addEventListener('click', () => this.changeView((data) => { data.freeLayout = !data.freeLayout; }));
    const sections = Object.entries(words.sections);
    for (const [id, title] of sections) {
      const section = this.controls.createDiv({ cls: 'tree-item graph-control-section' });
      const header = section.createDiv({ cls: 'tree-item-self mod-collapsible' });
      const icon = header.createDiv({ cls: 'tree-item-icon collapse-icon' });
      setIcon(icon, 'right-triangle');
      header.createDiv({ cls: 'tree-item-inner' }).createEl('header', { cls: 'graph-control-section-header', text: title });
      const body = section.createDiv({ cls: 'tree-item-children genealogy-controls-body' });
      this.sections.set(id, body);
      const expanded = () => settings.controls.sections.includes(id);
      const sync = () => {
        section.toggleClass('is-collapsed', !expanded()); icon.toggleClass('is-collapsed', !expanded());
        body.toggle(expanded());
      };
      sync();
      header.addEventListener('click', () => {
        settings.controls.sections = expanded() ? settings.controls.sections.filter((item) => item !== id) : [...settings.controls.sections, id];
        sync();
        this.plugin.requestSave();
      });
    }
    setOpen(settings.controls.open && !phone, false);

    // Problems: a button in the other corner, shown only when there are any; their list opens under it.
    // The top row: problems in the corner, the focus in the middle (on a phone right after them, styles.css).
    const top = this.panel.createDiv({ cls: 'genealogy-top' });
    const corner = top.createDiv({ cls: 'genealogy-corner' });
    this.problemsButton = corner.createDiv({ cls: 'clickable-icon genealogy-problems-button', attr: { 'aria-label': words.problemsButton } });
    this.problemsButton.addEventListener('click', () => this.toggleProblems());
    this.problemsEl = this.panel.createDiv({ cls: 'genealogy-problems' });
    this.problemsEl.hide();

    // «Уточнить»: the same kind of list, in yellow, beside the problems button.
    this.clarifyButton = corner.createDiv({ cls: 'clickable-icon genealogy-clarify-button', attr: { 'aria-label': words.clarifyButton } });
    this.clarifyButton.addEventListener('click', () => this.toggleClarify());
    this.clarifyEl = this.panel.createDiv({ cls: 'genealogy-problems genealogy-clarify' });
    this.clarifyEl.hide();

    // Left side: node colors, then the generations to highlight.
    const left = this.panel.createDiv({ cls: 'genealogy-left' });
    this.generationRail = left.createDiv({ cls: 'genealogy-generation-rail' });
    dragScroll(this.generationRail);
    // Top middle: the focus.
    this.colorBar = top.createDiv({ cls: 'genealogy-mode-bar genealogy-focus-bar' });

    // Adding people.
    this.nodePlus = this.panel.createEl('button', { cls: 'genealogy-node-plus', attr: { type: 'button', 'aria-label': words.addRelative } });
    setIcon(this.nodePlus, 'plus');
    this.nodePlus.addEventListener('click', (event) => { const id = [...this.focus][0]; if (id) this.addMenu(id, event); });
    this.nodePlus.hide();
    // The bottom dock, as a search widget on a phone: «Маршрут родства», the search field and «+».
    // The search field stays across updates, so typing is never interrupted.
    const dock = this.dock = this.panel.createDiv({ cls: 'genealogy-dock' });
    // In path mode a card above the dock shows both route ends, who is still to choose, and the route found.
    this.routeCard = dock.createDiv({ cls: 'genealogy-route-card' });
    this.routeCard.hide();
    // Tooltips of the dock open above it: below, at the bottom of the view, they would cover the buttons.
    const above = { 'data-tooltip-position': 'top' };
    this.meButton = dock.createEl('button', { cls: 'genealogy-dock-button genealogy-me-button', text: words.me, attr: { type: 'button', ...above } });
    this.meButton.addEventListener('click', () => this.showMe());
    this.pathButton = dock.createEl('button', { cls: 'genealogy-dock-button', attr: { type: 'button', ...above } });
    setIcon(this.pathButton, 'route');
    this.pathButton.addEventListener('click', () => this.togglePathMode());
    this.rootsButton = dock.createEl('button', { cls: 'genealogy-dock-button', attr: { type: 'button', ...above } });
    setIcon(this.rootsButton, 'sprout');
    this.rootsButton.addEventListener('click', () => this.toggleRootsMode());
    const search = dock.createDiv({ cls: 'genealogy-dock-search' });
    setIcon(search.createSpan({ cls: 'genealogy-dock-search-icon' }), 'search');
    this.searchInput = search.createEl('input', { type: 'search', attr: { placeholder: words.find, 'aria-label': words.findLabel, ...above } });
    new PersonSuggest(this.app, this.searchInput, () => this.nodes, (node) => { this.searchInput.value = ''; this.pickPerson(node.id); });
    this.addButton = dock.createEl('button', { cls: 'genealogy-add-button', attr: { type: 'button', 'aria-label': words.addPerson, ...above } });
    setIcon(this.addButton, 'plus');
    this.addButton.addEventListener('click', (event) => {
      const chosen = this.selection();
      if (chosen.length === 1) this.addMenu(chosen[0], event); else void this.plugin.startCreate(null, null);
    });
    this.emptyState = this.panel.createDiv({ cls: 'genealogy-empty' });
    const start = this.emptyState.createEl('button', { cls: 'genealogy-empty-add', attr: { type: 'button', 'aria-label': words.addFirst } });
    setIcon(start, 'plus');
    start.addEventListener('click', () => void this.plugin.startCreate(null, null));
    this.emptyState.createDiv({ cls: 'genealogy-empty-text', text: words.empty });
    this.credits = this.panel.createDiv({ cls: 'genealogy-credits' });
    this.pickHint = this.panel.createDiv({ cls: 'genealogy-pick-hint' });
    this.pickHint.hide();
  }

  /** «Я»: selects you and centers on you; until you are chosen, opens the settings where that is done. */
  private showMe() {
    const self = this.plugin.settings.selfPersonId;
    if (self && this.nodeById.has(self)) { this.addFocus(self, true); return; }
    new Notice(t().graph.chooseSelf);
    this.plugin.openSettings();
  }

  /** The route card: «Откуда» and «Куда», each with its person or a prompt to choose one, and what was found. */
  private updateRouteCard() {
    const card = this.routeCard; card.empty();
    card.toggle(this.special());
    if (this.rootsMode) { this.renderRootsCard(card); return; }
    if (!this.pathMode) return;
    const ends = this.pathEndpoints;
    const path = this.currentPath();
    const words = t().graph.route;
    const head = card.createDiv({ cls: 'genealogy-route-head' });
    head.createSpan({ cls: 'genealogy-route-title', text: words.title });
    const steps = path ? path.edges.length : 0;
    // While an end is missing, its highlighted field says what to do.
    const status = ends.length < 2 ? ''
      : !path ? words.notConnected
      : words.steps(steps);
    head.createSpan({ cls: `genealogy-route-status${ends.length === 2 && !path ? ' is-missing' : ends.length === 2 ? ' is-found' : ''}`, text: status });
    const close = head.createEl('button', { cls: 'clickable-icon genealogy-route-close', attr: { type: 'button', 'aria-label': words.exit } });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.togglePathMode());
    // As in a maps app: a ring for each end joined by a dotted line, a field for each person, ⇅ beside them.
    const fields = card.createDiv({ cls: 'genealogy-route-fields' });
    const rail = fields.createDiv({ cls: 'genealogy-route-rail' });
    rail.createSpan({ cls: 'genealogy-route-dot is-from' });
    rail.createSpan({ cls: 'genealogy-route-line' });
    rail.createSpan({ cls: 'genealogy-route-dot is-to' });
    const slots = fields.createDiv({ cls: 'genealogy-route-slots' });
    [words.from, words.to].forEach((label, index) => {
      const id = ends[index];
      const slot = slots.createDiv({ cls: `genealogy-route-slot${id ? ' is-filled' : index === ends.length ? ' is-empty is-next' : ' is-empty'}` });
      if (!id) {
        // The next end to choose takes a name typed here, as well as a click on the graph.
        const input = slot.createEl('input', { cls: 'genealogy-route-input', type: 'search', attr: { placeholder: label } });
        if (index === ends.length) new PersonSuggest(this.app, input, () => this.nodes, (node) => this.choosePathPerson(node.id));
        else input.disabled = true;
        return;
      }
      const node = this.nodeById.get(id);
      // A long name with its years scrolls sideways instead of hiding under the cross.
      const person = slot.createDiv({ cls: 'genealogy-route-person' });
      dragScroll(person, 'x');
      const name = person.createEl('button', { cls: 'genealogy-route-name', text: node?.name ?? id, attr: { type: 'button', 'aria-label': words.show(label) } });
      name.addEventListener('click', () => this.centerOn([id]));
      if (node?.lifeYears) person.createSpan({ cls: 'genealogy-route-years', text: node.lifeYears });
      const remove = slot.createEl('button', { cls: 'clickable-icon genealogy-route-remove', attr: { type: 'button', 'aria-label': words.remove } });
      setIcon(remove, 'x');
      remove.addEventListener('click', () => { this.pathEndpoints = this.pathEndpoints.filter((item) => item !== id); this.refresh(); });
      if (index === 0 && path?.edges.length) this.renderRouteChain(slots, path);
    });
    const swap = fields.createEl('button', { cls: 'clickable-icon genealogy-route-swap', attr: { type: 'button', 'aria-label': words.swap } });
    setIcon(swap, 'arrow-up-down');
    swap.disabled = ends.length !== 2;
    swap.addEventListener('click', () => this.swapPathEnds());
    if (path && path.edges.length) this.renderKinship(card, path);
  }

  /** Thresholds of «Корни»: generations of kin around the ancestry. */
  private static readonly ROOTS_DEPTHS = [0, 1, 2, 3, 4, -1];

  /**
   * The «Корни» card: the chosen people, how many ancestors they have and how far back, the threshold of kin around
   * the ancestry, and the oldest ancestors found.
   */
  private renderRootsCard(card: HTMLElement) {
    const settings = this.plugin.settings;
    const tree = this.currentRoots();
    const ancestors = tree ? tree.nodes.length - this.rootIds.length : 0;
    const generations = (tree?.nodes ?? []).map((id) => this.nodeById.get(id)?.generation).filter((value): value is number => typeof value === 'number');
    const oldest = generations.length ? Math.min(...generations) : null;
    const words = t().graph.roots;
    const head = card.createDiv({ cls: 'genealogy-route-head' });
    head.createSpan({ cls: 'genealogy-route-title', text: words.title });
    const status = !this.rootIds.length ? words.choose
      : !ancestors ? words.noAncestors
      : words.ancestors(ancestors, oldest !== null ? generationLabel(oldest) : null);
    head.createSpan({ cls: `genealogy-route-status${this.rootIds.length && ancestors ? ' is-found' : ''}`, text: status });
    const close = head.createEl('button', { cls: 'clickable-icon genealogy-route-close', attr: { type: 'button', 'aria-label': words.exit } });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.toggleRootsMode());
    const slots = card.createDiv({ cls: 'genealogy-route-slots' });
    this.rootIds.forEach((id) => {
      const node = this.nodeById.get(id);
      const slot = slots.createDiv({ cls: 'genealogy-route-slot is-filled' });
      const person = slot.createDiv({ cls: 'genealogy-route-person' });
      dragScroll(person, 'x');
      const name = person.createEl('button', { cls: 'genealogy-route-name', text: node?.name ?? id, attr: { type: 'button', 'aria-label': words.show } });
      name.addEventListener('click', () => this.centerOn([id]));
      person.createSpan({ cls: 'genealogy-route-years', text: node?.lifeYears ?? '' });
      const remove = slot.createEl('button', { cls: 'clickable-icon genealogy-route-remove', attr: { type: 'button', 'aria-label': words.remove } });
      setIcon(remove, 'x');
      remove.addEventListener('click', () => this.chooseRoot(id));
    });
    if (!this.rootIds.length) {
      const input = slots.createDiv({ cls: 'genealogy-route-slot is-empty is-next' }).createEl('input', { cls: 'genealogy-route-input', type: 'search', attr: { placeholder: words.whose } });
      new PersonSuggest(this.app, input, () => this.nodes, (node) => this.chooseRoot(node.id));
    }
    // The threshold: generations of kin around the ancestry; a marriage takes no step.
    const row = card.createDiv({ cls: 'genealogy-roots-depth' });
    row.createSpan({ cls: 'genealogy-roots-depth-label', text: words.kin });
    const bar = row.createDiv({ cls: 'genealogy-mode-bar' });
    GenealogyGraphView.ROOTS_DEPTHS.forEach((value, index) => {
      const label = value < 0 ? words.all : String(value); const title = t().graph.rootsDepths[index];
      const button = bar.createEl('button', { cls: 'genealogy-mode-button', text: label, attr: { type: 'button', 'aria-label': title } });
      button.toggleClass('is-active', settings.rootsDepth === value);
      button.addEventListener('click', () => { if (settings.rootsDepth !== value) { this.changeFilter((data) => { data.rootsDepth = value; }); this.followGraph(); } });
    });
    // The oldest known ancestors: the top of the lines, oldest generation first.
    if (!tree || !ancestors || oldest === null) return;
    const hasParents = new Set(tree.edges.map((edge) => edge.to));
    const tops = tree.nodes.filter((id) => !hasParents.has(id) && this.nodeById.get(id)?.generation === oldest);
    const line = card.createDiv({ cls: 'genealogy-roots-oldest' });
    line.createSpan({ text: words.oldest(tops.length > 1) });
    tops.slice(0, 3).forEach((id, index) => {
      const node = this.nodeById.get(id);
      if (index) line.appendText(', ');
      const years = node?.lifeYears && /\d/.test(node.lifeYears) ? ` (${node.lifeYears})` : '';
      const name = line.createEl('button', { cls: 'genealogy-kin-step', text: `${node?.name ?? id}${years}`, attr: { type: 'button' } });
      name.addEventListener('click', () => this.centerOn([id]));
    });
    if (tops.length > 3) line.appendText(words.more(tops.length - 3));
  }

  /** Who the people at the route's ends are to each other, and the chain of roles from the first to the second. */
  private kinshipOf(path: GraphPath) {
    const lang = language();
    const neighbors = adjacency(this.graph);
    const people = {
      sex: (id: string) => this.nodeById.get(id)?.sex ?? 'unknown',
      parents: (id: string) => (neighbors.get(id) ?? []).filter(({ edge }) => edge.relation === 'parent' && edge.to === id).map(({ edge }) => edge.from),
    };
    const kinship = describeRoute(path.nodes, path.edges, people, lang);
    return { ...kinship, lang };
  }

  /** Between «Откуда» and «Куда», along the dotted line: the roles, each next person to the previous one; a role centers the graph on that person. */
  private renderRouteChain(parent: HTMLElement, path: GraphPath) {
    const roles = parent.createDiv({ cls: 'genealogy-kin-chain' });
    this.kinshipOf(path).chain.forEach((role, index) => {
      if (index) roles.createSpan({ cls: 'genealogy-kin-arrow', text: '→' });
      const id = path.nodes[index + 1];
      const step = roles.createEl('button', { cls: 'genealogy-kin-step', text: role, attr: { type: 'button', 'aria-label': this.nodeById.get(id)?.name ?? '' } });
      step.addEventListener('click', () => this.centerOn([id]));
    });
  }

  /** Under the people: what «Куда» is to «Откуда» («троюродный дядя»); a route with no short name gets a saying about distant kin. */
  private renderKinship(card: HTMLElement, path: GraphPath) {
    const { term, lang } = this.kinshipOf(path);
    const box = card.createDiv({ cls: 'genealogy-kin' });
    const saying = term ? null : kinshipSaying(path.nodes[0], path.nodes[path.nodes.length - 1], lang);
    if (term) box.createDiv({ cls: 'genealogy-kin-word', text: term });
    else if (saying) box.createDiv({ cls: 'genealogy-kin-word genealogy-kin-saying', text: saying, attr: { 'aria-label': t().graph.route.noTermSaying, 'data-tooltip-position': 'top' } });
    else box.createDiv({ cls: 'genealogy-kin-none', text: t().graph.route.noTerm });
  }

  /** The focus at the top middle of the graph; the active one is highlighted. */
  private updateModeBars() {
    const settings = this.plugin.settings;
    const bar = <T extends string>(el: HTMLElement, current: T, options: Array<[T, string, string, string]>, choose: (value: T) => void) => {
      el.empty();
      for (const [value, icon, label, title] of options) {
        const button = el.createEl('button', { cls: 'genealogy-mode-button', attr: { type: 'button', 'aria-label': title } });
        setIcon(button.createSpan({ cls: 'genealogy-mode-icon' }), icon);
        button.createSpan({ cls: 'genealogy-mode-label', text: label });
        button.toggleClass('is-active', value === current);
        button.addEventListener('click', () => { if (value !== current) choose(value); });
      }
    };
    bar<SettingsData['focus']>(this.colorBar, settings.focus, [
      ['generations', 'layers', t().graph.focus.generations, t().graph.focus.generationsTitle],
      ['relatives', 'users', t().graph.focus.relatives, t().graph.focus.relativesTitle],
    ], (value) => this.changeView((data) => { data.focus = value; }));
    // Sizes and colors are set aside while Проблемы or Уточнить colors the people.
    const audit = Boolean(this.auditMode());
    this.colorBar.toggleClass('is-disabled', audit);
  }

  /** The highlight column: one button per generation (oldest at the top, «Я» on yours), or per relative count. */
  private updateGenerationRail() {
    const rail = this.generationRail; rail.empty();
    const settings = this.plugin.settings;
    const byRelatives = settings.focus === 'relatives';
    // Each button highlights its people; several can be on at once.
    const chips = byRelatives
      ? [...this.relativeGroups].reverse().map((group) => ({
        key: group.from, text: group.to === null ? `${group.from}+` : String(group.from), color: heatColor(group.from, this.maxLinks), zero: false,
        label: t().graph.rail.relatives(group.from, group.to === null),
      }))
      : [...new Set(this.nodes.map((node) => node.generation).filter((value): value is number => value !== null && Number.isInteger(value)))].sort((a, b) => a - b)
        .map((generation) => ({ key: generation, text: generationLabel(generation), color: generationColor(generation, this.plugin.generationRange), zero: generation === 0, label: t().graph.rail.generation(generationLabel(generation)) }));
    if (chips.length < 2) return;
    const list = byRelatives ? settings.highlightRelatives : settings.highlightGenerations;
    const highlighted = new Set(list);
    const save = (next: number[]) => this.changeView((data) => { if (byRelatives) data.highlightRelatives = next; else data.highlightGenerations = next; });
    for (const chip of chips) {
      const button = rail.createEl('button', { text: chip.text, cls: 'genealogy-generation-chip', attr: { type: 'button', 'aria-label': chip.label } });
      button.style.setProperty('--genealogy-chip', chip.color);
      button.toggleClass('is-active', highlighted.has(chip.key));
      // Generations count from «me»: the 0 button says so once you are chosen.
      if (chip.zero && this.nodeById.has(settings.selfPersonId)) button.createSpan({ cls: 'genealogy-me-badge', text: t().graph.me, attr: { 'aria-label': t().graph.rail.yours } });
      button.addEventListener('click', () => {
        const next = highlighted.has(chip.key) ? list.filter((value) => value !== chip.key) : [...list, chip.key].sort((a, b) => a - b);
        // Every button on is the same as none: nothing stands out, as after «все».
        save(chips.every((other) => next.includes(other.key)) ? [] : next);
      });
    }
    if (highlighted.size) {
      rail.createEl('button', { text: t().graph.rail.all, cls: 'genealogy-generation-reset', attr: { type: 'button', 'aria-label': byRelatives ? t().graph.rail.clear : t().graph.rail.clearGenerations } })
        .addEventListener('click', () => save([]));
    }
    this.markRailScroll();
  }

  /** A rail longer than its room scrolls; its ends then fade (styles.css). */
  private markRailScroll() {
    const rail = this.generationRail;
    window.requestAnimationFrame(() => rail.toggleClass('is-scrollable', rail.scrollHeight > rail.clientHeight + 1));
  }

  /** Which list colors the people: Проблемы, Уточнить, or none. */
  private auditMode(): 'problems' | 'clarify' | null { return this.showProblems ? 'problems' : this.showClarify ? 'clarify' : null; }

  private toggleProblems(show = !this.showProblems) {
    this.showProblems = show && this.graph.issues.length > 0;
    if (this.showProblems) { this.showClarify = false; this.updateClarify(); }
    this.updateProblems();
    this.restyle(); // People change colors and sizes while a list is open.
  }

  /** The problems button and, while open, the list of cards with problems; their people get a red ring. */
  private updateProblems() {
    const issues = this.graph.issues;
    if (!issues.length) this.showProblems = false;
    const button = this.problemsButton;
    button.toggle(issues.length > 0);
    button.toggleClass('is-active', this.showProblems);
    button.empty();
    setIcon(button.createSpan({ cls: 'genealogy-problems-icon' }), 'alert-triangle');
    button.createSpan({ text: String(issues.length) });
    const list = this.problemsEl;
    list.toggle(this.showProblems);
    if (!this.showProblems) { list.empty(); delete list.dataset.graph; return; }
    // Rebuilt only when the problems themselves change, so the list keeps its scroll position.
    if (list.dataset.graph === String(this.plugin.graphVersion)) return;
    list.empty();
    list.dataset.graph = String(this.plugin.graphVersion);
    list.createDiv({ cls: 'genealogy-problems-title', text: t().graph.problemsTitle(issues.length) });
    const names = new Map(this.graph.people.map((person) => [person.id, person.name]));
    const bySource = new Map<string, Issue[]>();
    for (const issue of issues) bySource.set(issue.source, [...(bySource.get(issue.source) ?? []), issue]);
    const sources = [...bySource.keys()].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
    for (const source of sources) {
      const group = list.createDiv({ cls: 'genealogy-problems-group' });
      const head = group.createDiv({ cls: 'genealogy-problems-person' });
      const name = head.createEl('a', { text: names.get(source) ?? source, href: '#', attr: { title: t().graph.show } });
      name.addEventListener('click', (event) => { event.preventDefault(); if (this.nodeById.has(source)) this.pickPerson(source); });
      const openNote = head.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t().graph.openNote } });
      setIcon(openNote, 'file-text');
      openNote.addEventListener('click', () => void this.plugin.openNote(source));
      for (const issue of bySource.get(source)!) group.createDiv({ cls: 'genealogy-problems-issue', text: issueText(issue) });
    }
  }

  private toggleClarify(show = !this.showClarify) {
    this.showClarify = show && this.plugin.clarifications.size > 0;
    if (this.showClarify) { this.showProblems = false; this.updateProblems(); }
    this.updateClarify();
    this.restyle(); // People change colors and sizes while a list is open.
  }

  /** The «Уточнить» button and, while open, the list of people with something to clarify; they get a yellow ring. */
  private updateClarify() {
    const notes = this.plugin.clarifications;
    const count = [...notes.values()].reduce((sum, items) => sum + items.length, 0);
    if (!notes.size) this.showClarify = false;
    const button = this.clarifyButton;
    button.toggle(notes.size > 0);
    button.toggleClass('is-active', this.showClarify);
    button.empty();
    setIcon(button.createSpan({ cls: 'genealogy-problems-icon' }), 'help-circle');
    button.createSpan({ text: String(notes.size) });
    button.setAttribute('aria-label', t().graph.clarifyLabel(notes.size, count));
    const list = this.clarifyEl;
    list.toggle(this.showClarify);
    if (!this.showClarify) { list.empty(); delete list.dataset.graph; return; }
    if (list.dataset.graph === String(this.plugin.graphVersion)) return;
    list.empty();
    list.dataset.graph = String(this.plugin.graphVersion);
    list.createDiv({ cls: 'genealogy-problems-title', text: t().graph.clarifyTitle(notes.size) });
    const names = new Map(this.graph.people.map((person) => [person.id, person.name]));
    // The least filled cards first.
    const sources = [...notes.keys()].sort((a, b) => notes.get(b)!.length - notes.get(a)!.length || (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
    for (const source of sources) {
      const group = list.createDiv({ cls: 'genealogy-problems-group' });
      const head = group.createDiv({ cls: 'genealogy-problems-person' });
      const name = head.createEl('a', { text: names.get(source) ?? source, href: '#', attr: { title: t().graph.show } });
      name.addEventListener('click', (event) => { event.preventDefault(); if (this.nodeById.has(source)) this.pickPerson(source); });
      const openNote = head.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t().graph.openNote } });
      setIcon(openNote, 'file-text');
      openNote.addEventListener('click', () => void this.plugin.openNote(source));
      const items = notes.get(source)!;
      const missing = items.filter((item) => item.kind === 'missing').map((item) => item.text);
      if (missing.length) group.createDiv({ cls: 'genealogy-problems-issue', text: t().graph.notFilled(missing.join(', ')) });
      for (const item of items.filter((entry) => entry.kind === 'note')) group.createDiv({ cls: 'genealogy-problems-issue', text: item.text });
    }
  }

  private changeView(change: (settings: SettingsData) => void) {
    change(this.plugin.settings);
    void this.plugin.saveSettings();
    this.plugin.settingsChanged('view');
  }

  private changeFilter(change: (settings: SettingsData) => void) {
    change(this.plugin.settings);
    void this.plugin.saveSettings();
    this.plugin.settingsChanged('filter');
  }

  /** Refreshes the panel's state and the footer; the search field is left alone. */
  private updateControls() {
    const settings = this.plugin.settings;
    const words = t().graph;
    // The dock: in path mode the search picks the route ends, and its placeholder says which one is next.
    this.pathButton.toggleClass('is-active', this.pathMode);
    this.rootsButton.toggleClass('is-active', this.rootsMode);
    this.rootsButton.setAttribute('aria-label', this.rootsMode ? words.roots.exit : words.roots.button);
    this.pathButton.setAttribute('aria-label', this.pathMode ? words.pathExit : words.pathButton);
    const self = settings.selfPersonId && this.nodeById.has(settings.selfPersonId) ? settings.selfPersonId : '';
    this.meButton.toggleClass('is-active', Boolean(self) && !this.special() && this.focus.has(self));
    this.meButton.toggleClass('is-unset', !self);
    this.meButton.setAttribute('aria-label', self ? words.showMe(this.nodeById.get(self)?.name ?? '') : words.meUnset);
    this.searchInput.placeholder = this.rootsMode ? words.search.roots : !this.pathMode ? words.search.find
      : this.pathEndpoints.length === 0 ? words.search.first : this.pathEndpoints.length === 1 ? words.search.second : words.search.replace;
    this.updateRouteCard();

    // Filters.
    const filters = this.sections.get('filters')!; filters.empty();
    new Setting(filters).setName(words.filters.hideDisconnected).setDesc(words.filters.hideDisconnectedDesc)
      .addToggle((toggle) => toggle.setValue(settings.hideDisconnected).onChange((value) => this.changeFilter((data) => { data.hideDisconnected = value; })));
    const depthIdle = this.rootsMode || (!this.pathMode && !this.focus.size);
    new Setting(filters).setName(words.filters.depth)
      .setDesc(this.rootsMode ? words.filters.depthRoots : depthIdle ? words.filters.depthIdle : this.pathMode ? words.filters.depthPath : words.filters.depthSelection)
      .addDropdown((dropdown) => {
        for (const [value, label] of [['0', words.filters.whole], ['-1', this.pathMode ? words.filters.onlyPath : words.filters.onlySelected], ...[1, 2, 3, 4].map((steps) => [String(steps), words.filters.steps(steps)])]) dropdown.addOption(value, label);
        dropdown.setValue(String(settings.depth)).setDisabled(depthIdle).onChange((value) => this.changeFilter((data) => { data.depth = Number(value); }));
      });
    if (settings.cuts.length) {
      new Setting(filters).setName(words.filters.hidden(settings.cuts.length))
        .addButton((button) => button.setButtonText(words.filters.showAll).onClick(() => this.showAllLinks()));
    }

    this.freeButton.toggleClass('is-active', settings.freeLayout);
    this.freeButton.setAttribute('aria-label', settings.freeLayout ? words.freeStop : words.freeRelease);

    // Display: in the generations focus, which end of the family is drawn larger.
    const display = this.sections.get('display')!; display.empty();
    new Setting(display).setName(words.display.size)
      .setDesc(settings.focus === 'generations' ? words.display.sizeDesc : words.display.onlyGenerations)
      .setDisabled(settings.focus !== 'generations')
      .addDropdown((dropdown) => dropdown.addOption('older', words.display.older).addOption('younger', words.display.younger)
        .setValue(settings.generationSize).setDisabled(settings.focus !== 'generations')
        .onChange((value) => this.changeView((data) => { data.generationSize = value === 'younger' ? 'younger' : 'older'; })));

    // Export: the graph as a picture or a document.
    const exports = this.sections.get('export')!; exports.empty();
    new Setting(exports).setName(words.exportName).setDesc(words.exportDesc)
      .addButton((button) => button.setButtonText(words.exportButton).onClick(() => new ExportModal(this.app, this).open()));

    // Import: cards from another program.
    const imports = this.sections.get('import')!; imports.empty();
    new Setting(imports).setName(words.importName).setDesc(words.importDesc)
      .addButton((button) => button.setButtonText(words.importButton).onClick(() => this.plugin.openImport()));

    this.updateModeBars();
    this.updateGenerationRail();
    this.updateProblems();
    this.updateClarify();
    this.emptyState.toggle(this.graph.people.length === 0);
    this.addButton.toggle(this.graph.people.length > 0);
    this.plugin.selectionChanged(this.selection());
    // With generations highlighted, the count is of their people; the total follows.
    const lit = this.visibleNodes.filter((node) => this.nodeViews.get(node.id)?.lit).length;
    const highlight = settings.focus === 'relatives'
      ? settings.highlightRelatives.length ? words.relativesShort(settings.highlightRelatives.map((count) => this.relativeGroups.find((group) => group.from === count)?.to === null ? `${count}+` : String(count)).join(', ')) : ''
      : settings.highlightGenerations.map(generationLabel).join(', ');
    this.status.textContent = !highlight
      ? words.status(this.visibleNodes.length, this.visibleEdges.length)
      : words.statusLit(highlight, lit, this.visibleNodes.length, this.visibleEdges.length);
  }

  currentScene(): Scene {
    const path = this.route();
    const pathEdges = new Set(path?.edges ?? []);
    const muted = Boolean(path) && !this.routeLimited(path);
    return {
      nodes: this.visibleNodes.map((node) => ({ ...node })),
      edges: this.visibleEdges.map((edge) => ({ ...edge, pathHighlighted: pathEdges.has(edge), dimmed: muted && !pathEdges.has(edge) })),
    };
  }

  viewportBounds(): Bounds {
    const rect = this.panel.getBoundingClientRect();
    return { x: -this.cameraX / this.zoom, y: -this.cameraY / this.zoom, width: rect.width / this.zoom, height: rect.height / this.zoom };
  }

  printScene(scene: Scene, ratio: number): Scene {
    const bounds = sceneBounds(scene); const currentRatio = bounds.width / bounds.height;
    const factor = Math.max(0.5, Math.min(2, Math.sqrt(ratio / currentRatio)));
    const nodes = scene.nodes.map((node) => ({ ...node, x: node.x * factor, y: node.y / factor }));
    const goals = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    const links: ForceEdge[] = scene.edges.map((edge) => ({ source: edge.from, target: edge.to, relation: edge.relation }));
    const simulation = forceSimulation(nodes)
      .force('charge', forceManyBody<SceneNode>().strength(-140))
      .force('link', forceLink<SceneNode, ForceEdge>(links.filter((link) => link.relation !== 'spouse')).id((node) => node.id).distance(145).strength(0.15))
      .force('magnets', selectionForce(nodes))
      .force('collide', forceCollide<SceneNode>((node) => node.selected ? nodeRadius(node) + 3 : Math.max(46, nodeRadius(node) + 20)));
    simulation
      .force('x', forceX<SceneNode>((node) => goals.get(node.id)!.x).strength(0.08))
      .force('y', forceY<SceneNode>((node) => goals.get(node.id)!.y).strength(0.08))
      .stop();
    // Spouses side by side, as in the live graph.
    const spouses = spouseConstraint<SceneNode>(links);
    spouses.initialize(nodes);
    for (let step = 0; step < 200; step++) { simulation.tick(); spouses.apply(); }
    return { nodes, edges: scene.edges };
  }
}

/** Search suggestions: everyone whose name contains the typed text, names starting with it first; the list scrolls. */
class PersonSuggest extends AbstractInputSuggest<ForceNode> {
  constructor(app: App, private field: HTMLInputElement, private people: () => ForceNode[], private choose: (node: ForceNode) => void) {
    super(app, field);
    this.limit = Number.MAX_SAFE_INTEGER; // Obsidian keeps the first 100 otherwise.
  }

  open() {
    super.open();
    this.placeAbove();
  }

  /**
   * On a phone the list opens above the field, right against it, as tall as the room up there. The field sits at the
   * bottom, over the keyboard, and Obsidian places the list by the whole screen: with the keyboard up it could
   * cover the field, or hide under the keyboard.
   */
  private placeAbove() {
    const list = (this as unknown as { suggestEl?: HTMLElement }).suggestEl;
    if (!list || !document.body.hasClass('is-phone')) return;
    const field = this.field.getBoundingClientRect();
    list.addClass('genealogy-suggest-above');
    list.style.setProperty('--genealogy-suggest-bottom', `${Math.round(window.innerHeight - field.top + 6)}px`);
    list.style.setProperty('--genealogy-suggest-height', `${Math.max(120, Math.round(field.top - 70))}px`);
  }

  getSuggestions(query: string): ForceNode[] {
    // The field moves while the keyboard slides in: the list follows it on every keystroke.
    window.requestAnimationFrame(() => this.placeAbove());
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/ё/g, 'е');
    const text = normalize(query.trim());
    const found = this.people().filter((node) => normalize(node.name).includes(text));
    const starts = (node: ForceNode) => normalize(node.name).startsWith(text) ? 0 : 1;
    return found.sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name));
  }

  renderSuggestion(node: ForceNode, el: HTMLElement) {
    el.createDiv({ text: node.name });
    if (node.lifeYears) el.createDiv({ text: node.lifeYears, cls: 'genealogy-suggest-years' });
  }

  selectSuggestion(node: ForceNode) {
    this.choose(node);
    this.close();
  }
}

/** A row of the settings tab: its name and description, and the control added to it. */
interface SettingsRow { name: string; desc: string; control: (setting: Setting) => unknown }

/**
 * The settings, described once. Obsidian 1.13+ renders them from getSettingDefinitions(), which also puts them
 * in the settings search; earlier versions call display().
 */
class GenealogySettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: GenealogyGraphPlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.groups().map(({ heading, rows }) => ({
      type: 'group' as const, heading,
      items: rows.map((row) => ({ name: row.name, desc: row.desc, render: (setting: Setting) => { setting.setName(row.name).setDesc(row.desc); row.control(setting); } })),
    }));
  }

  display() {
    this.containerEl.empty();
    for (const { heading, rows } of this.groups()) {
      if (heading) new Setting(this.containerEl).setName(heading).setHeading();
      for (const row of rows) row.control(new Setting(this.containerEl).setName(row.name).setDesc(row.desc));
    }
  }

  private groups(): Array<{ heading?: string; rows: SettingsRow[] }> {
    const settings = this.plugin.settings;
    const words = t().settings;
    return [
      { rows: [
        { name: words.language, desc: words.languageDesc, control: (setting) => setting.addDropdown((dropdown) => {
          for (const [value, label] of Object.entries(words.languageOptions)) dropdown.addOption(value, label);
          dropdown.setValue(settings.language).onChange(async (value) => {
            settings.language = value === 'en' || value === 'ru' ? value : 'auto';
            await this.plugin.saveSettings();
            // languageChanged() refreshes the definitions on Obsidian 1.13+; earlier versions draw the tab again.
            await this.plugin.languageChanged();
            if (!requireApiVersion('1.13.0')) this.display();
          });
        }) },
        { name: words.self, desc: words.selfDesc, control: (setting) => setting.addDropdown((dropdown) => {
          dropdown.addOption('', words.notChosen);
          const people = [...this.plugin.graph.people].sort((a, b) => a.name.localeCompare(b.name));
          for (const person of people) dropdown.addOption(person.id, `${person.name} · ${person.id}`);
          if (settings.selfPersonId && !people.some((person) => person.id === settings.selfPersonId)) {
            dropdown.addOption(settings.selfPersonId, words.notFound(settings.selfPersonId));
          }
          dropdown.setValue(settings.selfPersonId);
          dropdown.onChange((value) => { settings.selfPersonId = value; void this.plugin.saveSettings(); this.plugin.settingsChanged('self'); });
        }) },
        { name: words.filesFolder, desc: words.filesFolderDesc, control: (setting) => setting
          .addText((text) => text.setPlaceholder(this.plugin.filesFolder()).setValue(settings.filesFolder).onChange((value) => {
            settings.filesFolder = normalizeFolder(value);
            this.plugin.requestSave();
          })) },
      ] },
      { heading: words.names, rows: [
        { name: words.nameScheme, desc: words.nameSchemeDesc, control: (setting) => setting.addDropdown((dropdown) => {
          for (const scheme of NAME_SCHEMES) dropdown.addOption(scheme, words.schemes[scheme]);
          dropdown.setValue(settings.nameScheme).onChange((value) => {
            settings.nameScheme = value as NameScheme;
            void this.plugin.saveSettings();
            this.containerEl.querySelectorAll('.genealogy-settings-example').forEach((el) => el.setText(fileNameExample()));
            this.plugin.scheduleRefresh();
          });
        }) },
        { name: words.fileName, desc: words.fileNameDesc, control: (setting) => {
          const example = setting.descEl.createDiv({ cls: 'genealogy-settings-example', text: fileNameExample() });
          setting.addText((text) => text.setPlaceholder(DEFAULT_FILE_NAME).setValue(settings.fileNameTemplate).onChange((value) => {
            settings.fileNameTemplate = value.trim() || DEFAULT_FILE_NAME;
            this.plugin.requestSave();
            example.setText(fileNameExample());
          }));
        } },
      ] },
      { heading: words.newCards, rows: [
        { name: words.cardsFolder, desc: words.cardsFolderDesc, control: (setting) => setting
          .addText((text) => text.setPlaceholder(words.vaultRoot).setValue(settings.cardsFolder).onChange((value) => {
            settings.cardsFolder = normalizeFolder(value);
            this.plugin.requestSave();
          })) },
        { name: words.cardTemplate, desc: words.cardTemplateDesc, control: (setting) => setting
          .addText((text) => text.setPlaceholder(words.templatePlaceholder).setValue(settings.cardTemplate).onChange((value) => {
            settings.cardTemplate = value.trim();
            this.plugin.requestSave();
          })) },
        { name: words.rename, desc: words.renameDesc, control: (setting) => setting
          .addToggle((toggle) => toggle.setValue(settings.renameCards).onChange((value) => {
            settings.renameCards = value;
            this.plugin.requestSave();
          })) },
      ] },
      { heading: words.other, rows: [
        { name: words.exportFonts, desc: words.exportFontsDesc, control: (setting) => setting
          .addTextArea((text) => text.setPlaceholder('fonts/NotoSansSC-Regular.ttf').setValue(settings.exportFonts.join('\n')).onChange((value) => {
            settings.exportFonts = value.split('\n').map((line) => line.trim()).filter(Boolean);
            this.plugin.requestSave();
          })) },
        { name: words.templatesFolder, desc: words.templatesFolderDesc, control: (setting) => setting
          .addText((text) => text.setPlaceholder('Templates').setValue(settings.templatesFolder).onChange((value) => {
            settings.templatesFolder = normalizeFolder(value);
            this.plugin.requestSave();
            this.plugin.scheduleRefresh();
          })) },
      ] },
    ];
    function fileNameExample() { return words.fileNameExample(`${exampleName(settings.nameScheme, settings.fileNameTemplate)}.md`); }
  }
}

/** A file name the template gives for a sample person of the scheme, shown under the setting. */
function exampleName(scheme: NameScheme, template: string): string {
  const samples: Record<NameScheme, PersonFields> = {
    russian: { surname: 'Озерова', given_name: 'Светлана', patronymic: 'Борисовна', birth_surname: 'Кравченко' },
    western: { surname: 'Smith', given_name: 'Mary Ann', birth_surname: 'Jones' },
    spanish: { surname: 'García Márquez', given_name: 'Gabriel José' },
    eastern: { surname: 'Kim', given_name: 'Min-jun' },
    icelandic: { given_name: 'Jón', patronymic: 'Sigurðsson' },
  };
  return cardBase({ ...samples[scheme], birth_date: '1915', death_date: '1980' }, 'deceased', { scheme, template });
}

/**
 * A mouse drags a scrolling strip like a finger does (a finger scrolls it natively): the generation rail and a long
 * name in the route card scroll with a mouse too, as in the mobile layout on a computer. A drag does not click the
 * button it started on.
 */
function dragScroll(el: HTMLElement, axis: 'x' | 'y' = 'y') {
  el.addEventListener('pointerdown', (down) => {
    const vertical = axis === 'y';
    const room = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    if (down.pointerType !== 'mouse' || down.button !== 0 || room <= 0) return;
    const start = vertical ? down.clientY : down.clientX, startScroll = vertical ? el.scrollTop : el.scrollLeft;
    let dragged = false;
    const move = (event: PointerEvent) => {
      const shift = (vertical ? event.clientY : event.clientX) - start;
      if (!dragged && Math.abs(shift) < 4) return;
      dragged = true;
      if (vertical) el.scrollTop = startScroll - shift; else el.scrollLeft = startScroll - shift;
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (dragged) el.addEventListener('click', (event) => { event.stopPropagation(); event.preventDefault(); }, { capture: true, once: true });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
}
