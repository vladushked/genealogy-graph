import { Modal, Notice, type App } from 'obsidian';
import { pdfDocument, pngBlob, rasterPage, pageSize, cropMarks, svgText } from './export';
import {
  DPIS, MIN_PT, PAPER_GROUPS, PAPERS, READINGS, canvasFits, clampCenter, fitPage, frameSize, maxDpi, mmPerUnit, nameMm,
  namePt, paperById, pixels, readability, readingDistance, regionPage, rollPage, sheetSize, smallestPaper, targetPt,
  tilePages, type ExportSettings, type Finish, type Paper, type PrintPage,
} from './print';
import { t } from './i18n';
import type { PdfFontFile } from './pdf-text';
import { imagePixels, nodeRadius, renderSvg, sceneBounds, type Bounds, type Scene } from './scene';

/** What the dialog needs from the graph view. */
export interface ExportHost {
  plugin: {
    settings: { export: ExportSettings };
    requestSave(): void;
    embedPhotos(scene: Scene, cache: Map<string, Promise<string | undefined>>, size?: number): Promise<Scene>;
    exportFonts(): Promise<PdfFontFile[]>;
  };
  currentScene(): Scene;
  viewportBounds(): Bounds;
  printScene(scene: Scene, ratio: number): Scene;
}

/** The largest PDF page side (PDF 1.x: 200 inches). */
const PDF_MAX_MM = 5080;
const SVG_NS = 'http://www.w3.org/2000/svg';

const decimal = (value: number, digits = 1) => value.toFixed(digits).replace('.', t().export.decimal);
const cm = (mm: number) => mm >= 1000 ? `${decimal(mm / 1000, 2)} ${t().export.m}` : `${Math.round(mm / 10)} ${t().export.cm}`;
const size = (w: number, h: number) => `${Math.round(w)} × ${Math.round(h)} ${t().export.mm}`;
/** A paper's name: rolls by width, the custom size in words. */
const paperLabel = (paper: Paper) => paper.group === 'roll' ? `${paper.w} ${t().export.mm}` : paper.group === 'custom' ? t().export.customSize : paper.label;

/**
 * Export for print or screen. For print, the reading distance fixes the size of names, and that fixes the scale:
 * the whole graph on one sheet (with an honest warning when names get too small, and the sheet that would do),
 * a movable area on a sheet, or the graph over several sheets to glue together. The preview is the sheet itself.
 */
export class ExportModal extends Modal {
  private readonly settings: ExportSettings;
  private readonly scene: Scene;
  private readonly photos = new Map<string, Promise<string | undefined>>();
  private readonly relaid = new Map<string, Scene>();
  private controlsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private overviewEl!: HTMLElement;
  private sheetEl!: HTMLElement;
  private saveButton!: HTMLButtonElement;
  /** Centre of «Область на лист», graph units. */
  private center: { x: number; y: number } | null = null;
  private previewToken = 0;
  private overviewFrame: SVGRectElement | null = null;

  constructor(app: App, private host: ExportHost) {
    super(app);
    this.settings = host.plugin.settings.export;
    this.scene = host.currentScene(); // Snapshot: the live layout keeps moving while the dialog is open.
  }

  onOpen() {
    this.modalEl.addClass('genealogy-export-dialog');
    this.titleEl.setText(t().export.title);
    const body = this.contentEl.createDiv({ cls: 'genealogy-export' });
    const side = body.createDiv({ cls: 'genealogy-export-side' });
    this.controlsEl = side.createDiv({ cls: 'genealogy-export-controls' });
    this.statusEl = side.createDiv({ cls: 'genealogy-export-status' });
    this.saveButton = side.createEl('button', { text: t().export.save, cls: 'mod-cta' });
    this.saveButton.addEventListener('click', () => void this.exportFile());
    const previews = body.createDiv({ cls: 'genealogy-export-previews' });
    this.overviewEl = previews.createDiv({ cls: 'genealogy-export-overview' });
    this.sheetEl = previews.createDiv({ cls: 'genealogy-preview' });
    this.update();
  }

  onClose() { this.contentEl.empty(); }

  private changed() {
    this.host.plugin.requestSave();
    this.update();
  }

  private update() {
    this.renderControls();
    this.renderStatus();
    void this.renderPreview();
  }

  // Layout of the print.

  private printing() { return this.settings.purpose === 'print'; }
  private paper() { return paperById(this.settings.paper); }
  private finish(): Finish { return { bleed: this.settings.bleed ? 3 : 0, marks: this.settings.marks }; }

  /** The graph for print: in «Весь граф на лист», optionally laid out again for the sheet's shape. */
  private printScene(aspect: number): Scene {
    if (!(this.settings.mode === 'fit' && this.settings.relayout)) return this.scene;
    const key = aspect.toFixed(2);
    let scene = this.relaid.get(key);
    if (!scene) { scene = this.host.printScene(this.scene, aspect); this.relaid.set(key, scene); }
    return scene;
  }

  /** The sheet's printable aspect (width / height) the layout should fit. */
  private sheetFor(bounds: Bounds): { w: number; h: number } {
    const s = this.settings;
    return sheetSize(this.paper(), s.orientation, bounds.width / bounds.height, s.custom);
  }

  /** Pages to print, the scene they show, and what to say about them. */
  private layout(): { scene: Scene; bounds: Bounds; pages: PrintPage[]; grid?: { cols: number; rows: number }; frame?: { width: number; height: number } } {
    const s = this.settings;
    const target = mmPerUnit(targetPt(s));
    const paper = this.paper();
    let bounds = sceneBounds(this.scene);
    if (s.mode === 'fit') {
      if (paper.group === 'roll') return { scene: this.scene, bounds, pages: [rollPage(bounds, paper.w, s.margin, target)] };
      const sheet = this.sheetFor(bounds);
      const scene = this.printScene((sheet.w - s.margin * 2) / (sheet.h - s.margin * 2));
      bounds = sceneBounds(scene);
      return { scene, bounds, pages: [fitPage(bounds, sheet, s.margin)] };
    }
    if (s.mode === 'region') {
      const sheet = sheetSize(paper, s.orientation, bounds.width / bounds.height, s.custom);
      const frame = frameSize(sheet, s.margin, target);
      this.center = clampCenter(this.center ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, frame, bounds);
      return { scene: this.scene, bounds, pages: [regionPage(this.center, sheet, s.margin, target)], frame };
    }
    // Tiles: with auto orientation, whichever needs fewer sheets.
    const sheets = s.orientation === 'auto'
      ? [sheetSize(paper, 'portrait', 1, s.custom), sheetSize(paper, 'landscape', 1, s.custom)]
      : [sheetSize(paper, s.orientation, 1, s.custom)];
    const best = sheets.map((sheet) => tilePages(bounds, sheet, s.margin, s.overlap, target)).sort((a, b) => a.pages.length - b.pages.length)[0];
    return { scene: this.scene, bounds, pages: best.pages, grid: { cols: best.cols, rows: best.rows } };
  }

  // Controls.

  private renderControls() {
    const s = this.settings;
    const root = this.controlsEl; root.empty();
    const row = (label: string) => { const el = root.createDiv({ cls: 'genealogy-export-row' }); el.createSpan({ cls: 'genealogy-export-label', text: label }); return el.createDiv({ cls: 'genealogy-export-field' }); };
    const segmented = <T extends string>(parent: HTMLElement, options: Array<[T, string, boolean?]>, value: T, set: (value: T) => void) => {
      const bar = parent.createDiv({ cls: 'genealogy-mode-bar genealogy-export-segments' });
      for (const [option, text, disabled] of options) {
        const button = bar.createEl('button', { text, cls: 'genealogy-mode-button', attr: { type: 'button' } });
        button.toggleClass('is-active', option === value);
        button.disabled = Boolean(disabled);
        button.addEventListener('click', () => { if (option !== value) { set(option); this.changed(); } });
      }
    };
    const select = (parent: HTMLElement, options: Array<[string, string, boolean?]>, value: string, set: (value: string) => void, groups?: Array<[string, Array<[string, string, boolean?]>]>) => {
      const field = parent.createEl('select', { cls: 'dropdown' });
      const add = (into: HTMLElement, [option, text, disabled]: [string, string, boolean?]) => { const el = into.createEl('option', { text, value: option }); el.disabled = Boolean(disabled); };
      if (groups) for (const [label, items] of groups) { const group = field.createEl('optgroup', { attr: { label } }); for (const item of items) add(group, item); }
      else for (const item of options) add(field, item);
      field.value = value;
      field.addEventListener('change', () => { set(field.value); this.changed(); });
      return field;
    };
    const number = (parent: HTMLElement, value: number, min: number, max: number, set: (value: number) => void, suffix = '') => {
      const input = parent.createEl('input', { type: 'number', value: String(value), cls: 'genealogy-export-number' });
      input.min = String(min); input.max = String(max);
      input.addEventListener('change', () => { set(Math.min(max, Math.max(min, Number(input.value) || min))); this.changed(); });
      if (suffix) parent.createSpan({ cls: 'genealogy-export-suffix', text: suffix });
    };
    const check = (parent: HTMLElement, text: string, value: boolean, set: (value: boolean) => void, title = '') => {
      const label = parent.createEl('label', { cls: 'genealogy-export-check', attr: title ? { title } : {} });
      const input = label.createEl('input', { type: 'checkbox' }); input.checked = value;
      label.appendText(text);
      input.addEventListener('change', () => { set(input.checked); this.changed(); });
    };

    const words = t().export;
    segmented(row(words.purpose), [['print', words.print], ['screen', words.screen]], s.purpose, (value) => { s.purpose = value; });
    if (!this.printing()) {
      segmented(row(words.format), [['png', 'PNG'], ['svg', 'SVG']], s.screenFormat, (value) => { s.screenFormat = value; });
      segmented(row(words.scope), [['full', words.whole], ['viewport', words.visible]], s.screenScope, (value) => { s.screenScope = value; });
      return;
    }

    const reading = row(words.reading);
    select(reading, [...READINGS.map((item): [string, string] => [item.id, `${words.readings[item.id] ?? item.label} · ${item.pt} pt`]), ['custom', words.customReading]], s.reading, (value) => { s.reading = value; });
    if (s.reading === 'custom') { const pt = row(words.names); number(pt, s.customPt, MIN_PT, 96, (value) => { s.customPt = value; }, 'pt'); }

    segmented(row(words.what), [['fit', words.whole], ['region', words.region], ['tiles', words.tiles]], s.mode, (value) => {
      s.mode = value;
      // A roll holds only the whole graph; tiles are a PDF of several sheets.
      if (value !== 'fit' && this.paper().group === 'roll') s.paper = 'A3';
      if (value === 'tiles') s.format = 'pdf';
    });

    const paperField = row(words.paper);
    const groups = PAPER_GROUPS.map(([group, label]): [string, Array<[string, string, boolean?]>] =>
      [words.groups[group] ?? label, PAPERS.filter((paper) => paper.group === group).map((paper): [string, string, boolean?] =>
        [paper.id, paper.group === 'iso' || paper.group === 'us' ? `${paper.label} · ${paper.w}×${paper.h} ${words.mm}` : paperLabel(paper), paper.group === 'roll' && s.mode !== 'fit'])]);
    select(paperField, [], s.paper, (value) => { s.paper = value; }, groups);
    if (this.paper().group === 'custom') {
      const custom = row(words.size);
      number(custom, s.custom.w, 50, PDF_MAX_MM, (value) => { s.custom.w = value; }, '×');
      number(custom, s.custom.h, 50, PDF_MAX_MM, (value) => { s.custom.h = value; });
    }
    if (this.paper().group !== 'roll') {
      select(row(words.orientation), Object.entries(words.orientations), s.orientation, (value) => { s.orientation = value as ExportSettings['orientation']; });
    }
    number(row(words.margins), s.margin, 0, 50, (value) => { s.margin = value; }, words.mm);
    if (s.mode === 'tiles') number(row(words.overlap), s.overlap, 0, 50, (value) => { s.overlap = value; }, words.mm);
    if (s.mode === 'fit' && this.paper().group !== 'roll') {
      check(row(''), words.relayout, s.relayout, (value) => { s.relayout = value; }, words.relayoutTitle);
    }

    segmented(row(words.file), [['pdf', 'PDF'], ['png', 'PNG', s.mode === 'tiles'], ['jpeg', 'JPEG', s.mode === 'tiles']], s.format, (value) => { s.format = value; });
    if (s.format !== 'pdf') {
      select(row(words.resolution), DPIS.map((dpi): [string, string] => [String(dpi), `${dpi} dpi${words.dpiNote(dpi)}`]), String(s.dpi), (value) => { s.dpi = Number(value); });
    }
    const print = row(words.printShop);
    check(print, words.bleed, s.bleed, (value) => { s.bleed = value; }, words.bleedTitle);
    check(print, words.marks, s.marks, (value) => { s.marks = value; }, words.marksTitle);
  }

  // Status: how readable the names will be, and what to do when they are not.

  private renderStatus() {
    const root = this.statusEl; root.empty();
    const words = t().export;
    this.saveButton.disabled = false;
    if (!this.printing()) {
      const bounds = this.settings.screenScope === 'viewport' ? this.host.viewportBounds() : sceneBounds(this.scene);
      const [w, h] = imagePixels(bounds, this.settings.screenFormat === 'png' ? 2 : 1);
      root.createDiv({ text: this.settings.screenFormat === 'png' ? words.screenPng(w, h) : words.screenSvg });
      return;
    }
    const s = this.settings;
    const target = targetPt(s);
    const { bounds, pages, grid, frame } = this.layout();
    const page = pages[0];
    const pt = namePt(page.scale);
    const state = readability(pt, target);
    const line = root.createDiv({ cls: `genealogy-export-reading is-${state}` });
    line.createSpan({ cls: 'genealogy-export-reading-pt', text: words.namesPt(decimal(pt)) });
    line.appendText(words.letters(decimal(nameMm(pt))));
    line.appendText(state === 'small' ? words.unreadable : words.readFrom(readingDistance(pt) < 1 ? `${Math.round(readingDistance(pt) * 100)} ${words.cm}` : `${decimal(readingDistance(pt))} ${words.m}`));
    const say = (text: string, cls = '') => root.createDiv({ cls: `genealogy-export-note ${cls}`, text });
    const whole = { w: bounds.width * mmPerUnit(target), h: bounds.height * mmPerUnit(target) };

    if (s.mode === 'fit') {
      const paper = this.paper();
      say(paper.group === 'roll' ? words.roll(paper.w, cm(page.trimH)) : words.sheet(paperLabel(paper), size(page.trimW, page.trimH)));
      if (state !== 'ok') {
        const best = smallestPaper(bounds, mmPerUnit(target), s.margin);
        if (best) {
          const note = root.createDiv({ cls: 'genealogy-export-note' });
          note.appendText(words.needSheet(target, paperLabel(best.paper), best.orientation === 'landscape'));
          const take = note.createEl('button', { text: words.take(paperLabel(best.paper)), cls: 'genealogy-export-inline' });
          take.addEventListener('click', () => { s.paper = best.paper.id; s.orientation = best.orientation; this.changed(); });
        } else {
          say(words.noSheet(target, cm(whole.w), cm(whole.h)), 'is-warning');
        }
      }
      if (paper.group === 'roll' && page.trimH > PDF_MAX_MM) { say(words.tooLong, 'is-error'); this.saveButton.disabled = true; }
    } else if (s.mode === 'region' && frame) {
      const share = Math.min(1, frame.width / bounds.width) * Math.min(1, frame.height / bounds.height);
      say(words.frame(paperLabel(this.paper()), size(page.trimW, page.trimH), Math.round(share * 100)));
      if (share >= 0.999) say(words.fitsWhole);
    } else if (grid) {
      say(words.grid(grid.cols, grid.rows, pages.length, paperLabel(this.paper()), s.overlap, cm(whole.w), cm(whole.h)));
    }

    if (s.format !== 'pdf') {
      const { w, h } = pageSize(page, this.finish());
      const width = pixels(w, s.dpi); const height = pixels(h, s.dpi);
      if (canvasFits(width, height)) say(words.raster(s.format.toUpperCase(), width, height, s.dpi));
      else { say(words.rasterTooLarge(width, height, maxDpi(w, h)), 'is-error'); this.saveButton.disabled = true; }
    } else say(words.pdf);
  }

  // Preview: the sheet as it will be printed, and for «Область» and «Склейка» the whole graph with the frame or grid.

  private async renderPreview() {
    const token = ++this.previewToken;
    if (!this.printing()) {
      this.overviewEl.hide();
      const bounds = this.settings.screenScope === 'viewport' ? this.host.viewportBounds() : sceneBounds(this.scene);
      const images = await this.host.plugin.embedPhotos(this.scene, this.photos);
      if (token !== this.previewToken) return;
      const [w, h] = imagePixels(bounds, 1);
      this.sheetEl.replaceChildren(this.parseSvg(renderSvg(images, bounds, w, h)));
      return;
    }
    const { scene, bounds, pages, grid } = this.layout();
    const images = await this.host.plugin.embedPhotos(scene, this.photos);
    if (token !== this.previewToken) return;
    this.overviewEl.toggle(this.settings.mode !== 'fit');
    if (this.settings.mode !== 'fit') this.renderOverview(images, bounds, pages, grid);
    this.sheetEl.replaceChildren(this.sheetSvg(images, pages[0]));
  }

  /** The sheet: bleed, trim, margins, the graph area and crop marks, in millimetres. */
  private sheetSvg(scene: Scene, page: PrintPage): SVGSVGElement {
    const finish = this.finish();
    const { w, h, offset } = pageSize(page, finish);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.addClass('genealogy-sheet');
    const rect = (x: number, y: number, width: number, height: number, cls: string) => {
      const el = svg.createSvg('rect', { attr: { x, y, width, height }, cls }); return el;
    };
    if (finish.bleed) rect(offset - finish.bleed, offset - finish.bleed, page.trimW + finish.bleed * 2, page.trimH + finish.bleed * 2, 'genealogy-sheet-bleed');
    rect(offset, offset, page.trimW, page.trimH, 'genealogy-sheet-paper');
    const areaW = page.view.width * page.scale; const areaH = page.view.height * page.scale;
    const graph = this.parseSvg(renderSvg(scene, page.view, areaW, areaH, undefined, true));
    graph.setAttribute('x', String(offset + page.margin)); graph.setAttribute('y', String(offset + page.margin));
    graph.setAttribute('width', String(areaW)); graph.setAttribute('height', String(areaH));
    svg.appendChild(graph);
    if (page.margin) rect(offset + page.margin, offset + page.margin, areaW, areaH, 'genealogy-sheet-margin');
    for (const [x1, y1, x2, y2] of cropMarks(page, finish)) svg.createSvg('line', { attr: { x1, y1, x2, y2 }, cls: 'genealogy-sheet-mark' });
    return svg;
  }

  /** The whole graph with the region frame (movable) or the grid of sheets. */
  private renderOverview(scene: Scene, bounds: Bounds, pages: PrintPage[], grid?: { cols: number; rows: number }) {
    const view = { x: Math.min(bounds.x, ...pages.map((page) => page.view.x)), y: Math.min(bounds.y, ...pages.map((page) => page.view.y)), width: 0, height: 0 };
    view.width = Math.max(bounds.x + bounds.width, ...pages.map((page) => page.view.x + page.view.width)) - view.x;
    view.height = Math.max(bounds.y + bounds.height, ...pages.map((page) => page.view.y + page.view.height)) - view.y;
    const [w, h] = imagePixels(view, 1, 1200);
    const svg = this.parseSvg(renderSvg(scene, view, w, h, undefined, true));
    svg.addClass('genealogy-overview');
    pages.forEach((page, index) => {
      const frame = svg.createSvg('rect', { attr: { x: page.view.x, y: page.view.y, width: page.view.width, height: page.view.height }, cls: grid ? 'genealogy-overview-tile' : 'genealogy-overview-frame' });
      if (!grid) this.overviewFrame = frame;
      if (grid) {
        const label = svg.createSvg('text', { attr: { x: page.view.x + page.view.width / 2, y: page.view.y + page.view.height / 2 }, cls: 'genealogy-overview-number' });
        label.textContent = String(index + 1);
        label.style.fontSize = `${Math.min(page.view.width, page.view.height) / 4}px`;
      }
    });
    if (!grid) this.dragFrame(svg, bounds);
    this.overviewEl.replaceChildren(svg);
    this.overviewEl.toggleClass('is-draggable', !grid);
  }

  /** «Область»: drag the frame (or click anywhere) to choose what the sheet shows. */
  private dragFrame(svg: SVGSVGElement, bounds: Bounds) {
    const toGraph = (event: PointerEvent) => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      return { x: point.x, y: point.y };
    };
    let grab: { dx: number; dy: number } | null = null;
    const move = (event: PointerEvent) => {
      const point = toGraph(event); const frame = this.overviewFrame;
      if (!point || !grab || !frame) return;
      const size = { width: Number(frame.getAttribute('width')), height: Number(frame.getAttribute('height')) };
      this.center = clampCenter({ x: point.x - grab.dx, y: point.y - grab.dy }, size, bounds);
      frame.setAttribute('x', String(this.center.x - size.width / 2)); frame.setAttribute('y', String(this.center.y - size.height / 2));
    };
    svg.addEventListener('pointerdown', (event) => {
      const point = toGraph(event); const frame = this.overviewFrame;
      if (!point || !frame) return;
      const x = Number(frame.getAttribute('x')); const y = Number(frame.getAttribute('y'));
      const width = Number(frame.getAttribute('width')); const height = Number(frame.getAttribute('height'));
      const inside = point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
      // Grabbing the frame keeps the hand where it took it; a click elsewhere centres the frame there.
      grab = inside ? { dx: point.x - (x + width / 2), dy: point.y - (y + height / 2) } : { dx: 0, dy: 0 };
      svg.setPointerCapture(event.pointerId);
      move(event);
    });
    svg.addEventListener('pointermove', move);
    const end = () => { if (!grab) return; grab = null; this.renderStatus(); void this.renderPreview(); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }

  private parseSvg(markup: string): SVGSVGElement {
    return document.importNode(new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement, true) as unknown as SVGSVGElement;
  }

  // Export.

  private async exportFile() {
    const s = this.settings;
    try {
      this.saveButton.disabled = true; this.saveButton.setText(t().export.preparing);
      let blob: Blob; let name: string;
      if (!this.printing()) {
        const bounds = s.screenScope === 'viewport' ? this.host.viewportBounds() : sceneBounds(this.scene);
        const [width, height] = imagePixels(bounds, s.screenFormat === 'png' ? 2 : 1);
        const images = await this.host.plugin.embedPhotos(this.scene, this.photos);
        const svg = svgText(images, bounds, width, height, false);
        blob = s.screenFormat === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await pngBlob(svg, width, height);
        name = `genealogy-graph.${s.screenFormat}`;
      } else {
        const { scene, pages } = this.layout();
        // Portraits as sharp as the print: the largest person's diameter at the print's resolution.
        const dpi = s.format === 'pdf' ? 300 : s.dpi;
        const largest = Math.max(0, ...scene.nodes.map((node) => nodeRadius(node))) * 2 * pages[0].scale;
        const images = await this.host.plugin.embedPhotos(scene, this.photos, Math.min(1024, Math.max(128, pixels(largest, dpi))));
        if (s.format === 'pdf') {
          const pdf = await pdfDocument(images, pages, this.finish(), await this.host.plugin.exportFonts());
          blob = pdf.blob;
          if (pdf.missing.length) new Notice(t().export.missingGlyphs(pdf.missing.slice(0, 24).join(' ')), 12000);
        } else blob = await rasterPage(images, pages[0], this.finish(), s.dpi, s.format);
        const paper = this.paper();
        name = `genealogy-graph-${paper.group === 'custom' ? `${s.custom.w}x${s.custom.h}` : paper.id}.${s.format === 'jpeg' ? 'jpg' : s.format}`;
      }
      const url = URL.createObjectURL(blob);
      const anchor = createEl('a'); anchor.href = url; anchor.download = name;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      new Notice(t().export.saved(name)); this.close();
    } catch (error) {
      new Notice(t().export.failed(error instanceof Error ? error.message : String(error)));
      this.saveButton.disabled = false; this.saveButton.setText(t().export.save);
    }
  }
}
