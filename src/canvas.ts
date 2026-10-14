import type { Point } from './scene';

/**
 * Draws the live graph on a canvas. The view prepares plain draw items (positions, colors, opacity) and this
 * module only paints them, culling what is off screen. Exported files keep using the SVG renderer in scene.ts.
 */

export interface Palette {
  edge: string; spouse: string; route: string; ring: string; selected: string; hypothesis: string;
  text: string; years: string; halo: string; accent: string; onAccent: string; disabled: string; font: string;
  error: string;
}

export interface LineItem {
  kind: 'line';
  x1: number; y1: number; x2: number; y2: number;
  color: string; width: number; alpha: number;
  dash?: number[]; arrow?: boolean; round?: boolean;
}
/** Filled outlines drawn as one path, so overlapping ones merge without darker overlaps (the shape around spouses). */
export interface ShapeItem { kind: 'shape'; outlines: Point[][]; color: string; alpha: number }
export type EdgeItem = LineItem | ShapeItem;

export interface NodeItem {
  x: number; y: number; radius: number; alpha: number;
  fill: string;
  /** Ring around the node: none for plain people, the generation color around portraits (see scene.nodeOutline). */
  outline: { color: string; width: number; dashed: boolean } | null;
  /** Soft ring around selected people and route members. */
  halo: { color: string; opacity: number } | null;
  /** The selection ring, faded in over the outline. */
  ring: { color: string; width: number; alpha: number } | null;
  image: CanvasImageSource | null;
  /** Portraits fade out with the labels as the graph zooms out. */
  imageAlpha: number;
  veil: boolean;
  badge: { text: string; x: number; y: number; width: number } | null;
}

/** A name (one or two lines) and years at their baselines (see scene.labelLayout). */
export interface LabelItem { x: number; nameY: number[]; yearsY: number; align: CanvasTextAlign; name: string[]; years: string; alpha: number }
export interface EyeItem { x: number; y: number; disabled: boolean }

export interface Layer { edges: EdgeItem[]; nodes: NodeItem[]; labels: LabelItem[] }
export interface Frame {
  width: number; height: number; ratio: number;
  camera: { x: number; y: number; zoom: number };
  /** Drawn in order; the hover layer goes last so the highlighted part sits on top. */
  layers: Layer[];
  eye: EyeItem | null;
}

/** Opacity of the dark veil laid over portraits of deceased people (kept equal to the export). */
const VEIL = 0.4;
const ARROW = 9;

export function drawFrame(ctx: CanvasRenderingContext2D, frame: Frame, palette: Palette) {
  const { ratio, camera } = frame;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, frame.width * ratio, frame.height * ratio);
  ctx.setTransform(ratio * camera.zoom, 0, 0, ratio * camera.zoom, ratio * camera.x, ratio * camera.y);
  // Visible area in graph coordinates, with a margin for strokes, arrowheads and labels.
  const margin = 40 / camera.zoom + 60;
  const view = {
    left: -camera.x / camera.zoom - margin, top: -camera.y / camera.zoom - margin,
    right: (frame.width - camera.x) / camera.zoom + margin, bottom: (frame.height - camera.y) / camera.zoom + margin,
  };
  for (const layer of frame.layers) {
    for (const item of layer.edges) drawEdge(ctx, item, view);
    for (const item of layer.nodes) drawNode(ctx, item, view, palette, camera.zoom);
    drawLabels(ctx, layer.labels, view, palette);
  }
  if (frame.eye) drawEye(ctx, frame.eye, camera.zoom, palette);
  ctx.globalAlpha = 1;
}

interface View { left: number; top: number; right: number; bottom: number }

function drawEdge(ctx: CanvasRenderingContext2D, item: EdgeItem, view: View) {
  if (item.alpha <= 0) return;
  ctx.globalAlpha = item.alpha;
  if (item.kind === 'shape') {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    for (const points of item.outlines) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
      ctx.closePath();
    }
    ctx.fill('nonzero');
    return;
  }
  if (outside(Math.min(item.x1, item.x2), Math.min(item.y1, item.y2), Math.max(item.x1, item.x2), Math.max(item.y1, item.y2), view)) return;
  ctx.strokeStyle = item.color; ctx.lineWidth = item.width;
  ctx.lineCap = item.round ? 'round' : 'butt';
  ctx.setLineDash(item.dash ?? []);
  ctx.beginPath(); ctx.moveTo(item.x1, item.y1); ctx.lineTo(item.x2, item.y2); ctx.stroke();
  if (item.dash) ctx.setLineDash([]);
  if (item.arrow) {
    const dx = item.x2 - item.x1; const dy = item.y2 - item.y1; const length = Math.hypot(dx, dy);
    if (length < 1e-6) return;
    const ux = dx / length; const uy = dy / length;
    // Same shape as the SVG marker: a 9×9 triangle whose tip passes the line end by one unit.
    const tipX = item.x2 + ux; const tipY = item.y2 + uy;
    const baseX = tipX - ux * ARROW; const baseY = tipY - uy * ARROW;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX - uy * ARROW / 2, baseY + ux * ARROW / 2);
    ctx.lineTo(baseX + uy * ARROW / 2, baseY - ux * ARROW / 2);
    ctx.closePath(); ctx.fill();
  }
}

function drawNode(ctx: CanvasRenderingContext2D, item: NodeItem, view: View, palette: Palette, zoom: number) {
  const r = item.radius;
  if (item.alpha <= 0 || outside(item.x - r - 8, item.y - r - 8, item.x + r + 8, item.y + r + 8, view)) return;
  ctx.globalAlpha = item.alpha;
  if (item.halo) {
    ctx.globalAlpha = item.alpha * item.halo.opacity;
    ctx.strokeStyle = item.halo.color; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(item.x, item.y, r + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = item.alpha;
  }
  ctx.beginPath(); ctx.arc(item.x, item.y, r, 0, Math.PI * 2);
  ctx.fillStyle = item.fill; ctx.fill();
  if (item.image && item.imageAlpha > 0) {
    // Portraits are pre-cut into circles (see the view), so no clipping is needed here.
    ctx.globalAlpha = item.alpha * item.imageAlpha;
    ctx.drawImage(item.image, item.x - r, item.y - r, r * 2, r * 2);
    if (item.veil) {
      ctx.globalAlpha = item.alpha * item.imageAlpha * VEIL; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(item.x, item.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = item.alpha;
  }
  if (item.outline) {
    // Drawn inside the edge, so a thick ring does not make the node look bigger.
    const width = item.outline.width;
    ctx.strokeStyle = item.outline.color; ctx.lineWidth = width;
    ctx.setLineDash(item.outline.dashed ? [4, 3] : []);
    ctx.beginPath(); ctx.arc(item.x, item.y, Math.max(1, r - width / 2), 0, Math.PI * 2); ctx.stroke();
    if (item.outline.dashed) ctx.setLineDash([]);
  }
  if (item.ring && item.ring.alpha > 0) {
    ctx.globalAlpha = item.alpha * item.ring.alpha;
    ctx.strokeStyle = item.ring.color; ctx.lineWidth = item.ring.width;
    ctx.beginPath(); ctx.arc(item.x, item.y, Math.max(1, r - item.ring.width / 2), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = item.alpha;
  }
  if (item.badge) {
    const { x, y, width, text } = item.badge;
    ctx.fillStyle = palette.accent; ctx.strokeStyle = palette.halo; ctx.lineWidth = 1.5;
    roundedRect(ctx, item.x + x - width / 2, item.y + y - 8, width, 16, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = palette.onAccent; ctx.font = `600 10px ${palette.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, item.x + x, item.y + y + 4);
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, labels: LabelItem[], view: View, palette: Palette) {
  if (!labels.length) return;
  // Plain text, without an outline.
  ctx.textBaseline = 'alphabetic';
  // Names and years separately, so the font is set twice per frame rather than twice per person.
  const off = (label: LabelItem, y: number) => {
    const left = label.align === 'center' ? label.x - 120 : label.align === 'right' ? label.x - 240 : label.x;
    return outside(left, y - 12, left + 240, y + 4, view);
  };
  ctx.font = `11px ${palette.font}`; ctx.fillStyle = palette.text;
  for (const label of labels) {
    if (label.alpha <= 0) continue;
    ctx.globalAlpha = label.alpha; ctx.textAlign = label.align;
    label.name.forEach((line, index) => { if (line && !off(label, label.nameY[index])) ctx.fillText(line, label.x, label.nameY[index]); });
  }
  ctx.font = `10px ${palette.font}`; ctx.fillStyle = palette.years;
  for (const label of labels) {
    if (label.alpha <= 0 || !label.years || off(label, label.yearsY)) continue;
    ctx.globalAlpha = label.alpha; ctx.textAlign = label.align;
    ctx.fillText(label.years, label.x, label.yearsY);
  }
}

/** The "hide this side" button on a selected link; constant size on screen. */
function drawEye(ctx: CanvasRenderingContext2D, eye: EyeItem, zoom: number, palette: Palette) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.translate(eye.x, eye.y); ctx.scale(1 / zoom, 1 / zoom);
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = eye.disabled ? palette.disabled : palette.accent; ctx.fill();
  ctx.strokeStyle = palette.halo; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = palette.onAccent; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-7, 0); ctx.quadraticCurveTo(0, -7, 7, 0); ctx.quadraticCurveTo(0, 7, -7, 0); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = palette.onAccent; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(6, -6); ctx.stroke();
  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

const outside = (left: number, top: number, right: number, bottom: number, view: View) =>
  right < view.left || left > view.right || bottom < view.top || top > view.bottom;
