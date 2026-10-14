/** What lies under the pointer on the canvas graph. Coordinates are graph units; `zoom` converts screen sizes. */

export interface HitNode { id: string; x: number; y: number; radius: number; badge?: { x: number; y: number; width: number } | null }
/** `reach`: how close counts as on the link, when wider than a line (the shape around spouses). */
export interface HitLink { id: string; x1: number; y1: number; x2: number; y2: number; reach?: number }

export type Hit =
  | { kind: 'eye' }
  | { kind: 'badge'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'link'; id: string }
  | null;

/** Half of the old 12-unit invisible stroke: how close to a link counts as on it. */
export const LINK_REACH = 6;
/** Radius of the eye button in screen pixels. */
export const EYE_RADIUS = 12;

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1; const dy = y2 - y1; const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Priority follows the drawing order: the eye on top, then badges, then people (last drawn wins), then links.
 * `nodes` is in drawing order.
 */
export function hitTest(
  x: number, y: number, zoom: number,
  nodes: readonly HitNode[], links: Iterable<HitLink>, eye: { x: number; y: number } | null,
): Hit {
  if (eye && Math.hypot(x - eye.x, y - eye.y) <= EYE_RADIUS / zoom) return { kind: 'eye' };
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]; const badge = node.badge;
    if (badge && Math.abs(x - (node.x + badge.x)) <= badge.width / 2 && Math.abs(y - (node.y + badge.y)) <= 8) return { kind: 'badge', id: node.id };
  }
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (Math.hypot(x - node.x, y - node.y) <= node.radius) return { kind: 'node', id: node.id };
  }
  let best: Hit = null; let bestDistance = Infinity;
  for (const link of links) {
    // Measured past the link's own reach, so a thin line next to a wide shape still wins near it.
    const distance = distanceToSegment(x, y, link.x1, link.y1, link.x2, link.y2) - Math.max(0, (link.reach ?? LINK_REACH) - LINK_REACH);
    if (distance <= LINK_REACH && distance <= bestDistance) { best = { kind: 'link', id: link.id }; bestDistance = distance; }
  }
  return best;
}
