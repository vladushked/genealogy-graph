import type { Bounds } from './scene';
import { t } from './i18n';

/**
 * Print geometry. A printed graph starts from how big its text must be to be read where it hangs, not from the
 * sheet: the size of a name fixes how many millimetres one graph unit takes, and the sheet, the area or the number of
 * sheets follow from that. Everything here is in millimetres and graph units; no DOM.
 */

/** Font size of a name in graph units (see scene.renderSvg); years are 10. */
export const NAME_UNITS = 11;
/** Millimetres in a typographic point. */
export const PT_MM = 25.4 / 72;

export type PaperGroup = 'iso' | 'photo' | 'us' | 'roll' | 'custom';
export interface Paper {
  id: string;
  label: string;
  group: PaperGroup;
  /** Short side, mm; a roll's width. */
  w: number;
  /** Long side, mm; null for a roll, whose length follows the graph. */
  h: number | null;
}

/** Paper groups with their English names; the dialog names them in the plugin's language. */
export const PAPER_GROUPS: Array<[PaperGroup, string]> = [['iso', 'ISO (A, B)'], ['photo', 'Photo, cm'], ['us', 'US'], ['roll', 'Plotter roll'], ['custom', 'Custom size']];

export const PAPERS: Paper[] = [
  ...([['A6', 105, 148], ['A5', 148, 210], ['A4', 210, 297], ['A3', 297, 420], ['A2', 420, 594], ['A1', 594, 841], ['A0', 841, 1189], ['2A0', 1189, 1682],
    ['B4', 250, 353], ['B3', 353, 500], ['B2', 500, 707], ['B1', 707, 1000], ['B0', 1000, 1414]] as const)
    .map(([id, w, h]) => ({ id, label: id, group: 'iso' as const, w, h })),
  ...([[10, 15], [13, 18], [15, 21], [20, 30], [30, 40], [30, 45], [40, 50], [50, 70], [60, 90]] as const)
    .map(([w, h]) => ({ id: `photo-${w}x${h}`, label: `${w}×${h}`, group: 'photo' as const, w: w * 10, h: h * 10 })),
  { id: 'letter', label: 'Letter', group: 'us', w: 215.9, h: 279.4 },
  { id: 'legal', label: 'Legal', group: 'us', w: 215.9, h: 355.6 },
  { id: 'tabloid', label: 'Tabloid', group: 'us', w: 279.4, h: 431.8 },
  ...[610, 914, 1067].map((w) => ({ id: `roll-${w}`, label: `${w} mm`, group: 'roll' as const, w, h: null })),
  { id: 'custom', label: 'Custom size', group: 'custom', w: 500, h: 700 },
];

export const paperById = (id: string): Paper => PAPERS.find((paper) => paper.id === id) ?? PAPERS.find((paper) => paper.id === 'A3')!;

/** How the print will be looked at: the size of names that reads comfortably from there. */
export interface Reading { id: string; label: string; pt: number; distance: number }
export const READINGS: Reading[] = [
  { id: 'hands', label: 'In hands, ~40 cm', pt: 9, distance: 0.4 },
  { id: 'near', label: 'On a table or a wall nearby, ~1 m', pt: 14, distance: 1 },
  { id: 'far', label: 'On a wall from afar, ~2 m', pt: 24, distance: 2 },
];
/** Names smaller than this are not offered: they cannot be read on paper at any distance. */
export const MIN_PT = 6;

/** Millimetres per graph unit for names of `pt` points. */
export const mmPerUnit = (pt: number) => pt * PT_MM / NAME_UNITS;
/** Points of a name at `mm` millimetres per graph unit. */
export const namePt = (mm: number) => mm * NAME_UNITS / PT_MM;
/** Height of a name's letters on paper, mm (the font size; capitals are about 0.7 of it). */
export const nameMm = (pt: number) => pt * PT_MM;

/** Distance in metres from which names of `pt` points read comfortably: between the presets, then proportionally. */
export function readingDistance(pt: number): number {
  const points: Array<[number, number]> = [[MIN_PT, 0.25], ...READINGS.map((reading): [number, number] => [reading.pt, reading.distance])];
  if (pt <= points[0][0]) return points[0][1] * pt / points[0][0];
  for (let i = 1; i < points.length; i++) {
    const [p0, d0] = points[i - 1]; const [p1, d1] = points[i];
    if (pt <= p1) return d0 + (d1 - d0) * (pt - p0) / (p1 - p0);
  }
  const [p, d] = points[points.length - 1];
  return d * pt / p;
}

/** Whether names of `pt` read where they are meant to be read (`target` points). */
export function readability(pt: number, target: number): 'ok' | 'near' | 'small' {
  return pt < MIN_PT ? 'small' : pt + 0.05 < target ? 'near' : 'ok';
}

export type Orientation = 'auto' | 'portrait' | 'landscape';

/** Sheet width and height in mm for an orientation; `auto` follows the shape it holds (`aspect` is width / height). */
export function sheetSize(paper: Paper, orientation: Orientation, aspect: number, custom: { w: number; h: number }): { w: number; h: number } {
  const [short, long] = paper.group === 'custom' ? [Math.min(custom.w, custom.h), Math.max(custom.w, custom.h)] : [paper.w, paper.h ?? paper.w];
  const landscape = orientation === 'landscape' || (orientation === 'auto' && aspect > 1);
  return landscape ? { w: long, h: short } : { w: short, h: long };
}

/**
 * One printed sheet: the graph area `view` (graph units) fills the printable area, the trimmed sheet less its
 * margins, at `scale` mm per unit.
 */
export interface PrintPage {
  view: Bounds; trimW: number; trimH: number; margin: number; scale: number;
  /** «Склейка»: the sheet's place, and which of its edges the next sheet is glued over (`overlap` mm repeated). */
  label?: string; glue?: { right: boolean; bottom: boolean; overlap: number };
}

const printable = (sheet: { w: number; h: number }, margin: number) => ({ w: Math.max(1, sheet.w - margin * 2), h: Math.max(1, sheet.h - margin * 2) });

/** The whole graph on one sheet, as large as the sheet allows. */
export function fitPage(bounds: Bounds, sheet: { w: number; h: number }, margin: number): PrintPage {
  const area = printable(sheet, margin);
  const scale = Math.min(area.w / bounds.width, area.h / bounds.height);
  const w = area.w / scale; const h = area.h / scale;
  return { view: { x: bounds.x - (w - bounds.width) / 2, y: bounds.y - (h - bounds.height) / 2, width: w, height: h }, trimW: sheet.w, trimH: sheet.h, margin, scale };
}

/** The whole graph on a roll of `width` mm at `scale`, or narrower if the roll is too narrow; the length follows. */
export function rollPage(bounds: Bounds, width: number, margin: number, scale: number): PrintPage {
  const areaW = Math.max(1, width - margin * 2);
  const fitted = Math.min(scale, areaW / bounds.width);
  const w = areaW / fitted;
  const length = bounds.height * fitted + margin * 2;
  return { view: { x: bounds.x - (w - bounds.width) / 2, y: bounds.y, width: w, height: bounds.height }, trimW: width, trimH: length, margin, scale: fitted };
}

/** Size of the area a sheet shows at `scale`, graph units: the frame of «Область на лист». */
export function frameSize(sheet: { w: number; h: number }, margin: number, scale: number): { width: number; height: number } {
  const area = printable(sheet, margin);
  return { width: area.w / scale, height: area.h / scale };
}

/** «Область на лист»: the sheet showing the area centred at `center`. */
export function regionPage(center: { x: number; y: number }, sheet: { w: number; h: number }, margin: number, scale: number): PrintPage {
  const frame = frameSize(sheet, margin, scale);
  return { view: { x: center.x - frame.width / 2, y: center.y - frame.height / 2, ...frame }, trimW: sheet.w, trimH: sheet.h, margin, scale };
}

/** Keeps a frame's centre so the frame stays over the graph (centred on an axis where it is larger than the graph). */
export function clampCenter(center: { x: number; y: number }, frame: { width: number; height: number }, bounds: Bounds): { x: number; y: number } {
  const axis = (value: number, size: number, start: number, length: number) => size >= length ? start + length / 2
    : Math.min(start + length - size / 2, Math.max(start + size / 2, value));
  return { x: axis(center.x, frame.width, bounds.x, bounds.width), y: axis(center.y, frame.height, bounds.y, bounds.height) };
}

/**
 * «Склейка»: the graph at `scale` over a grid of sheets. Neighbouring sheets repeat `overlap` mm of the graph, so they
 * can be glued edge over edge; the grid is centred on the graph.
 */
export function tilePages(bounds: Bounds, sheet: { w: number; h: number }, margin: number, overlap: number, scale: number): { cols: number; rows: number; pages: PrintPage[] } {
  const area = printable(sheet, margin);
  const overlapUnits = Math.min(overlap, area.w / 2, area.h / 2) / scale;
  const stepW = area.w / scale - overlapUnits; const stepH = area.h / scale - overlapUnits;
  const cols = Math.max(1, Math.ceil((bounds.width - overlapUnits) / stepW));
  const rows = Math.max(1, Math.ceil((bounds.height - overlapUnits) / stepH));
  const totalW = cols * stepW + overlapUnits; const totalH = rows * stepH + overlapUnits;
  const x0 = bounds.x - (totalW - bounds.width) / 2; const y0 = bounds.y - (totalH - bounds.height) / 2;
  const pages: PrintPage[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      pages.push({
        view: { x: x0 + col * stepW, y: y0 + row * stepH, width: area.w / scale, height: area.h / scale },
        trimW: sheet.w, trimH: sheet.h, margin, scale,
        label: t().export.sheetLabel(row * cols + col + 1, rows * cols, row + 1, col + 1),
        glue: { right: col < cols - 1, bottom: row < rows - 1, overlap: overlapUnits * scale },
      });
    }
  }
  return { cols, rows, pages };
}

/** The smallest standard sheet (by area) holding the whole graph at `scale`, in either orientation; null if none. */
export function smallestPaper(bounds: Bounds, scale: number, margin: number): { paper: Paper; orientation: 'portrait' | 'landscape' } | null {
  const needW = bounds.width * scale + margin * 2; const needH = bounds.height * scale + margin * 2;
  const candidates = PAPERS.filter((paper) => paper.h !== null && paper.group !== 'custom')
    .sort((a, b) => a.w * a.h! - b.w * b.h!);
  for (const paper of candidates) {
    if (paper.w >= needW && paper.h! >= needH) return { paper, orientation: 'portrait' };
    if (paper.h! >= needW && paper.w >= needH) return { paper, orientation: 'landscape' };
  }
  return null;
}

/** Bleed and crop marks around the trimmed sheet. */
export interface Finish { bleed: number; marks: boolean }
/** Length of a crop mark, mm, and its gap from the bleed. */
export const MARK_LENGTH = 5; export const MARK_GAP = 2;
/** Space outside the trim on each side: the bleed, and the slug holding crop marks. */
export const finishOffset = (finish: Finish) => finish.bleed + (finish.marks ? MARK_GAP + MARK_LENGTH + 1 : 0);

/** Pixels of a raster page of `mm` at `dpi`. */
export const pixels = (mm: number, dpi: number) => Math.max(1, Math.round(mm / 25.4 * dpi));

/** Browser canvas limits (Chromium): longest side and area. */
export const CANVAS_MAX_SIDE = 32767; export const CANVAS_MAX_AREA = 268_435_456;
export const canvasFits = (width: number, height: number) => width <= CANVAS_MAX_SIDE && height <= CANVAS_MAX_SIDE && width * height <= CANVAS_MAX_AREA;
/** The highest of the usual print resolutions that still fits the canvas for a page of `w`×`h` mm. */
export function maxDpi(w: number, h: number): number {
  const side = CANVAS_MAX_SIDE / (Math.max(w, h) / 25.4);
  const area = Math.sqrt(CANVAS_MAX_AREA / ((w / 25.4) * (h / 25.4)));
  return Math.floor(Math.min(side, area));
}

// Resolution in raster files: without it a print shop reads 72 dpi and prints at the wrong size.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A PNG with a pHYs chunk saying `dpi` (any existing one is replaced). */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [png.subarray(0, 8)];
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(21);
  const view = new DataView(phys.buffer);
  view.setUint32(0, 9); phys.set([0x70, 0x48, 0x59, 0x73], 4); view.setUint32(8, ppm); view.setUint32(12, ppm); phys[16] = 1;
  view.setUint32(17, crc32(phys.subarray(4, 17)));
  for (let offset = 8; offset < png.length;) {
    const length = new DataView(png.buffer, png.byteOffset + offset).getUint32(0);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (type !== 'pHYs') chunks.push(png.subarray(offset, end));
    if (type === 'IHDR') chunks.push(phys);
    offset = end;
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0; for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

/** A JPEG whose JFIF header says `dpi`; returned unchanged without a JFIF header. */
export function jpegWithDpi(jpeg: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(jpeg);
  const jfif = out[2] === 0xff && out[3] === 0xe0 && String.fromCharCode(...out.subarray(6, 11)) === 'JFIF\0';
  if (!jfif) return out;
  const view = new DataView(out.buffer);
  out[13] = 1; view.setUint16(14, Math.round(dpi)); view.setUint16(16, Math.round(dpi));
  return out;
}

/** What the export dialog remembers. */
export interface ExportSettings {
  purpose: 'print' | 'screen';
  reading: string;
  /** Name size for the «Свой размер» reading, pt. */
  customPt: number;
  mode: 'fit' | 'region' | 'tiles';
  paper: string;
  custom: { w: number; h: number };
  orientation: Orientation;
  margin: number;
  overlap: number;
  format: 'pdf' | 'png' | 'jpeg';
  dpi: number;
  bleed: boolean;
  marks: boolean;
  /** «Подстроить раскладку под лист» in «Весь граф на лист». */
  relayout: boolean;
  screenFormat: 'svg' | 'png';
  screenScope: 'full' | 'viewport';
}

export const DPIS = [150, 300, 600];

export function restoreExport(value: unknown): ExportSettings {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const oneOf = <T extends string | number>(item: unknown, options: readonly T[], fallback: T): T => options.includes(item as T) ? item as T : fallback;
  const number = (item: unknown, min: number, max: number, fallback: number) => typeof item === 'number' && Number.isFinite(item) ? Math.min(max, Math.max(min, item)) : fallback;
  const custom = saved.custom && typeof saved.custom === 'object' ? saved.custom as Record<string, unknown> : {};
  return {
    purpose: oneOf(saved.purpose, ['print', 'screen'], 'print'),
    reading: oneOf(saved.reading, [...READINGS.map((reading) => reading.id), 'custom'], 'hands'),
    customPt: number(saved.customPt, MIN_PT, 96, 9),
    mode: oneOf(saved.mode, ['fit', 'region', 'tiles'], 'fit'),
    paper: oneOf(saved.paper, PAPERS.map((paper) => paper.id), 'A3'),
    custom: { w: number(custom.w, 50, 5000, 500), h: number(custom.h, 50, 5000, 700) },
    orientation: oneOf(saved.orientation, ['auto', 'portrait', 'landscape'], 'auto'),
    margin: number(saved.margin, 0, 50, 10),
    overlap: number(saved.overlap, 0, 50, 10),
    format: oneOf(saved.format, ['pdf', 'png', 'jpeg'], 'pdf'),
    dpi: oneOf(saved.dpi, DPIS, 300),
    bleed: saved.bleed === true,
    marks: saved.marks === true,
    relayout: saved.relayout === true,
    screenFormat: oneOf(saved.screenFormat, ['svg', 'png'], 'png'),
    screenScope: oneOf(saved.screenScope, ['full', 'viewport'], 'full'),
  };
}

/** The name size the chosen reading asks for, pt. */
export const targetPt = (settings: ExportSettings) => settings.reading === 'custom' ? settings.customPt : READINGS.find((reading) => reading.id === settings.reading)?.pt ?? 9;
