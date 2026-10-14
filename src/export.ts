import { jsPDF } from 'jspdf';
import { t } from './i18n';
import { canvasFits, finishOffset, jpegWithDpi, MARK_GAP, MARK_LENGTH, pixels, pngWithDpi, type Finish, type PrintPage } from './print';
import { renderSvg, sceneBounds, familyShape, groupFamilies, nodeRadius, nodeOutline, edgeEndpoints, spouseCapsule, spouseGroups, spousePositions, labelSide, labelLayout, labelLines, nodeFill, SPOUSE_COLOR, SPOUSE_FILL_OPACITY, DECEASED_VEIL, PALETTES, type Bounds, type Scene } from './scene';
import fontDataUrl from '../assets/DejaVuSans.ttf';
import { PdfText, type PdfFontFile } from './pdf-text';

/** The bundled font, first in every PDF: Latin, Greek, Cyrillic, Armenian, Georgian, Hebrew and Arabic. */
export const BUNDLED_FONT: PdfFontFile = { name: 'DejaVuSans', base64: fontDataUrl.split(',')[1] };

export type ExportFormat = 'svg' | 'png' | 'pdf';
export function svgText(scene: Scene, bounds: Bounds, width: number, height: number, paper = false) {
  return renderSvg(scene, bounds, width, height, fontDataUrl, paper);
}

export async function pngBlob(svg: string, width: number, height: number): Promise<Blob> {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error(t().export.svgFailed));
      image.src = url;
    });
    const canvas = createEl('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(t().export.pngFailed)), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image); image.onerror = () => reject(new Error(t().export.photoFailed));
    image.src = src;
  });
}

/** Crops a portrait to a centered square no larger than `size` px, so exports do not carry full-resolution photos. */
export async function portraitDataUrl(bytes: ArrayBuffer, mime: string, size = 256): Promise<string> {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const image = await loadImage(url);
    const side = Math.min(image.naturalWidth || size, image.naturalHeight || size);
    const target = Math.max(1, Math.min(size, side));
    const canvas = createEl('canvas'); canvas.width = target; canvas.height = target;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target, target);
    const width = image.naturalWidth || side; const height = image.naturalHeight || side;
    ctx.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, target, target);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(url); }
}

/** A portrait cut to a circle, at its own resolution (the portrait is already sized for the print). */
async function circleImage(dataUri: string): Promise<string> {
  const image = await loadImage(dataUri);
  const size = Math.max(1, Math.min(image.width, image.height));
  const canvas = createEl('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, size, size);
  return canvas.toDataURL('image/png');
}

/** Points in a millimetre: font sizes in jsPDF are in points. */
const MM_PT = 72 / 25.4;

/** Draws a scene on the current PDF page: graph unit `v` lands at `x(v)`, `y(v)` mm, `scale` mm per unit. */
async function drawScene(pdf: jsPDF, text: PdfText, scene: Scene, x: (value: number) => number, y: (value: number) => number, scale: number) {
  const colors = PALETTES.paper;
  const mutedState = pdf.GState({ opacity: 0.2, 'stroke-opacity': 0.2 });
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const arrowHead = (fromX: number, fromY: number, ex: number, ey: number) => {
    const angle = Math.atan2(ey - fromY, ex - fromX); const arrow = Math.max(1, 7 * scale);
    pdf.line(ex, ey, ex - arrow * Math.cos(angle - 0.45), ey - arrow * Math.sin(angle - 0.45));
    pdf.line(ex, ey, ex - arrow * Math.cos(angle + 0.45), ey - arrow * Math.sin(angle + 0.45));
  };
  const muted = (dimmed: boolean, draw: () => void) => {
    if (dimmed) { pdf.saveGraphicsState(); pdf.setGState(mutedState); }
    draw();
    if (dimmed) pdf.restoreGraphicsState();
  };
  // The page is opaque white, so translucent spouse shapes are drawn in the blended color and overlaps stay even.
  const blend = (color: string, opacity: number) => {
    const value = parseInt(color.slice(1), 16);
    const mix = (shift: number) => Math.round(((value >> shift) & 255) * opacity + 255 * (1 - opacity)).toString(16).padStart(2, '0');
    return `#${mix(16)}${mix(8)}${mix(0)}`;
  };
  for (const group of spouseGroups(scene.edges)) {
    for (const edge of group) {
      const a = nodes.get(edge.from); const b = nodes.get(edge.to); if (!a || !b) continue;
      const points = spouseCapsule(a, b).outline.map((point) => [x(point.x), y(point.y)]);
      const deltas = points.slice(1).map((point, index) => [point[0] - points[index][0], point[1] - points[index][1]]);
      pdf.setFillColor(blend(edge.pathHighlighted ? colors.route : SPOUSE_COLOR, SPOUSE_FILL_OPACITY * (edge.dimmed ? 0.18 : 1)));
      pdf.lines(deltas, points[0][0], points[0][1], [1, 1], 'F', true);
    }
  }
  const { families, direct } = groupFamilies(scene.edges);
  for (const family of families) {
    const shape = familyShape(family, nodes);
    if (!shape) continue;
    const onRoute = family.edges.some((edge) => edge.pathHighlighted);
    const dimmed = family.edges.every((edge) => edge.dimmed);
    muted(dimmed, () => {
      if (shape.connector) {
        pdf.setDrawColor(colors.edge); pdf.setLineWidth(Math.max(0.1, 1.2 * scale));
        pdf.setLineDashPattern([3 * scale, 4 * scale], 0);
        pdf.line(x(shape.connector.start.x), y(shape.connector.start.y), x(shape.connector.end.x), y(shape.connector.end.y));
        pdf.setLineDashPattern([], 0);
      }
      if (shape.stem) {
        pdf.setDrawColor(onRoute ? colors.route : colors.edge); pdf.setLineWidth(Math.max(0.2, (onRoute ? 4 : 2.2) * scale));
        pdf.line(x(shape.stem.start.x), y(shape.stem.start.y), x(shape.stem.end.x), y(shape.stem.end.y));
        if (family.children.length > 1) { pdf.setFillColor(onRoute ? colors.route : colors.edge); pdf.circle(x(shape.hub.x), y(shape.hub.y), 3 * scale, 'F'); }
      }
    });
    for (const branch of shape.branches) {
      const edges = family.edges.filter((edge) => edge.to === branch.child);
      const on = edges.some((edge) => edge.pathHighlighted);
      muted(edges.every((edge) => edge.dimmed), () => {
        pdf.setDrawColor(on ? colors.route : colors.edge); pdf.setLineWidth(Math.max(0.15, (on ? 4 : 1.7) * scale));
        // jsPDF has cubic curves only; convert the quadratic branch.
        const x0 = x(branch.start.x); const y0 = y(branch.start.y);
        const qx = x(branch.control.x); const qy = y(branch.control.y);
        const ex = x(branch.end.x); const ey = y(branch.end.y);
        const c1 = [x0 + (qx - x0) * 2 / 3, y0 + (qy - y0) * 2 / 3];
        const c2 = [ex + (qx - ex) * 2 / 3, ey + (qy - ey) * 2 / 3];
        pdf.lines([[c1[0] - x0, c1[1] - y0, c2[0] - x0, c2[1] - y0, ex - x0, ey - y0]], x0, y0, [1, 1], 'S', false);
        arrowHead(qx, qy, ex, ey);
      });
    }
  }
  for (const edge of direct) {
    const a = nodes.get(edge.from); const b = nodes.get(edge.to); if (!a || !b) continue;
    muted(Boolean(edge.dimmed), () => {
      if (edge.relation !== 'spouse') {
        pdf.setDrawColor(edge.pathHighlighted ? colors.route : colors.edge);
        pdf.setLineWidth(Math.max(0.15, (edge.pathHighlighted ? 4 : 1.7) * scale));
        const { start, end } = edgeEndpoints(a, b);
        const sx = x(start.x); const sy = y(start.y); const ex = x(end.x); const ey = y(end.y);
        pdf.line(sx, sy, ex, ey);
        arrowHead(sx, sy, ex, ey);
      }
    });
  }
  // A route entering a family through one parent continues between the spouses to the stem.
  pdf.setDrawColor(colors.route); pdf.setLineWidth(Math.max(0.2, 4 * scale));
  for (const family of families) {
    for (const half of familyShape(family, nodes)?.halves ?? []) {
      if (family.edges.some((edge) => edge.pathHighlighted && edge.from === half.parent)) {
        pdf.line(x(half.start.x), y(half.start.y), x(half.end.x), y(half.end.y));
      }
    }
  }
  const spousesOf = spousePositions(scene.edges, nodes);
  for (const node of scene.nodes) {
    const radius = nodeRadius(node);
    const lines = labelLines(node);
    const label = labelLayout(node, radius, labelSide(node, spousesOf.get(node.id) ?? []), Boolean(node.lifeYears), lines.length);
    if (node.dimmed) { pdf.saveGraphicsState(); pdf.setGState(mutedState); }
    pdf.setFillColor(node.image ? '#ffffff' : nodeFill(node));
    pdf.circle(x(node.x), y(node.y), radius * scale, 'F');
    if (node.image) {
      try { pdf.addImage(await circleImage(node.image), 'PNG', x(node.x - radius), y(node.y - radius), radius * 2 * scale, radius * 2 * scale); }
      catch { /* Keep the colored node when an image cannot be decoded. */ }
    }
    if (node.deceased && node.image) {
      pdf.saveGraphicsState(); pdf.setGState(pdf.GState({ opacity: DECEASED_VEIL }));
      pdf.setFillColor('#000000'); pdf.circle(x(node.x), y(node.y), radius * scale, 'F');
      pdf.restoreGraphicsState();
    }
    const outline = nodeOutline(node, colors, Boolean(node.image));
    if (outline) {
      pdf.setDrawColor(outline.color);
      pdf.setLineWidth(Math.max(0.2, outline.width * scale));
      pdf.setLineDashPattern(outline.dashed ? [4 * scale, 3 * scale] : [], 0);
      pdf.circle(x(node.x), y(node.y), radius * scale, 'S');
      pdf.setLineDashPattern([], 0);
    }
    pdf.setTextColor(colors.text);
    pdf.setFontSize(11 * scale * MM_PT);
    lines.forEach((line, index) => text.write(line, x(label.x), y(label.nameY[index]), label.align));
    pdf.setTextColor(colors.years);
    pdf.setFontSize(10 * scale * MM_PT);
    if (node.lifeYears) text.write(node.lifeYears, x(label.x), y(label.yearsY), label.align);
    if (node.dimmed) pdf.restoreGraphicsState();
  }
}

/**
 * The part of a scene a page needs: people within reach of its area and their direct relatives, so links leaving
 * the page are still drawn. Keeps a multi-sheet PDF from repeating the whole graph on every sheet.
 */
export function sceneFor(scene: Scene, view: Bounds, reach = 400): Scene {
  const inside = (node: Scene['nodes'][number]) => node.x >= view.x - reach && node.x <= view.x + view.width + reach && node.y >= view.y - reach && node.y <= view.y + view.height + reach;
  const kept = new Set(scene.nodes.filter(inside).map((node) => node.id));
  for (const edge of scene.edges) if (kept.has(edge.from) || kept.has(edge.to)) { kept.add(edge.from); kept.add(edge.to); }
  return { nodes: scene.nodes.filter((node) => kept.has(node.id)), edges: scene.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)) };
}

/** Size of a page with its finish: the trim plus bleed and the slug for crop marks on each side. */
export function pageSize(page: PrintPage, finish: Finish): { w: number; h: number; offset: number } {
  const offset = finishOffset(finish);
  return { w: page.trimW + offset * 2, h: page.trimH + offset * 2, offset };
}

/** Crop marks at the trim corners, outside the bleed, as `line(x1, y1, x2, y2)` calls in mm. */
export function cropMarks(page: PrintPage, finish: Finish): Array<[number, number, number, number]> {
  if (!finish.marks) return [];
  const { offset } = pageSize(page, finish);
  const start = finish.bleed + MARK_GAP; const end = start + MARK_LENGTH;
  const marks: Array<[number, number, number, number]> = [];
  for (const cx of [offset, offset + page.trimW]) {
    for (const cy of [offset, offset + page.trimH]) {
      const sx = cx === offset ? -1 : 1; const sy = cy === offset ? -1 : 1;
      marks.push([cx + sx * start, cy, cx + sx * end, cy], [cx, cy + sy * start, cx, cy + sy * end]);
    }
  }
  return marks;
}

/**
 * A PDF of print pages: each page shows its area of the graph in its printable area, with bleed and crop marks.
 * Names are written with the bundled font, then the `fonts` for letters it lacks; `missing` are letters none has.
 */
export async function pdfDocument(scene: Scene, pages: PrintPage[], finish: Finish, fonts: PdfFontFile[] = []): Promise<{ blob: Blob; missing: string[] }> {
  let pdf: jsPDF | null = null;
  let text: PdfText | null = null;
  for (const page of pages) {
    const { w, h, offset } = pageSize(page, finish);
    const orientation = w > h ? 'landscape' : 'portrait';
    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'mm', format: [w, h], compress: true });
      text = new PdfText(pdf, [BUNDLED_FONT, ...fonts]);
    } else pdf.addPage([w, h], orientation);
    // The paper colour fills the trim and the bleed.
    pdf.setFillColor(PALETTES.paper.background);
    pdf.rect(offset - finish.bleed, offset - finish.bleed, page.trimW + finish.bleed * 2, page.trimH + finish.bleed * 2, 'F');
    const left = offset + page.margin; const top = offset + page.margin;
    const width = page.view.width * page.scale; const height = page.view.height * page.scale;
    pdf.saveGraphicsState();
    pdf.rect(left, top, width, height, null); pdf.clip(); pdf.discardPath();
    await drawScene(pdf, text!, sceneFor(scene, page.view), (value) => left + (value - page.view.x) * page.scale, (value) => top + (value - page.view.y) * page.scale, page.scale);
    pdf.restoreGraphicsState();
    if (page.glue) {
      // Where the next sheet's picture starts: glue it over this strip.
      pdf.setDrawColor('#9aa5b5'); pdf.setLineWidth(0.2); pdf.setLineDashPattern([2, 2], 0);
      if (page.glue.right) pdf.line(left + width - page.glue.overlap, top, left + width - page.glue.overlap, top + height);
      if (page.glue.bottom) pdf.line(left, top + height - page.glue.overlap, left + width, top + height - page.glue.overlap);
      pdf.setLineDashPattern([], 0);
    }
    if (page.label && page.margin >= 4) {
      pdf.setTextColor('#7a8494'); pdf.setFontSize(7);
      text!.write(page.label, left, offset + page.trimH - page.margin / 2 + 1, 'left');
    }
    pdf.setDrawColor('#000000'); pdf.setLineWidth(0.1);
    for (const [x1, y1, x2, y2] of cropMarks(page, finish)) pdf.line(x1, y1, x2, y2);
  }
  return { blob: pdf!.output('blob'), missing: [...text!.missing] };
}

/** One print page as PNG or JPEG at `dpi`, with the resolution written into the file. */
export async function rasterPage(scene: Scene, page: PrintPage, finish: Finish, dpi: number, type: 'png' | 'jpeg'): Promise<Blob> {
  const { w, h, offset } = pageSize(page, finish);
  const width = pixels(w, dpi); const height = pixels(h, dpi);
  if (!canvasFits(width, height)) throw new Error(t().export.tooManyPixels(width, height));
  const canvas = createEl('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t().export.noMemory);
  const unit = dpi / 25.4;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  const areaW = pixels(page.view.width * page.scale, dpi); const areaH = pixels(page.view.height * page.scale, dpi);
  const svg = renderSvg(sceneFor(scene, page.view), page.view, areaW, areaH, fontDataUrl, true);
  const image = await svgImage(svg);
  ctx.drawImage(image, Math.round((offset + page.margin) * unit), Math.round((offset + page.margin) * unit), areaW, areaH);
  ctx.strokeStyle = '#000000'; ctx.lineWidth = Math.max(1, 0.1 * unit);
  for (const [x1, y1, x2, y2] of cropMarks(page, finish)) { ctx.beginPath(); ctx.moveTo(x1 * unit, y1 * unit); ctx.lineTo(x2 * unit, y2 * unit); ctx.stroke(); }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error(t().export.imageFailed)), `image/${type}`, 0.92));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob([type === 'png' ? pngWithDpi(bytes, dpi) : jpegWithDpi(bytes, dpi)], { type: `image/${type}` });
}

async function svgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}

export function exportBounds(scene: Scene): Bounds { return sceneBounds(scene); }

