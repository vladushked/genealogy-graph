import type { Edge, Person } from './model';

export interface SceneNode extends Person {
  x: number;
  y: number;
  color: string;
  radius?: number;
  selected?: boolean;
  pathHighlighted?: boolean;
  pathEndpoint?: boolean;
  dimmed?: boolean;
  image?: string;
}

export interface SceneEdge extends Edge { pathHighlighted?: boolean; dimmed?: boolean }
export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
}

export interface Bounds { x: number; y: number; width: number; height: number }

export const NODE_RADIUS = 22;
export const PATH_COLOR = '#ffdc69';
export const SPOUSE_COLOR = '#f5a1a1';

export interface ExportPalette {
  background: string; edge: string; route: string; text: string; years: string;
  nodeStroke: string; selected: string; hypothesis: string;
}

/** Colors of exported files; the live view follows the Obsidian theme through styles.css. */
export const PALETTES: Record<'dark' | 'paper', ExportPalette> = {
  dark: { background: '#151923', edge: '#8091a8', route: PATH_COLOR, text: '#e8edf5', years: '#b9c3d3', nodeStroke: '#e8edf5', selected: '#ffffff', hypothesis: '#f2bd5a' },
  paper: { background: '#ffffff', edge: '#586f8a', route: '#aa6200', text: '#19202b', years: '#596372', nodeStroke: '#718096', selected: '#19202b', hypothesis: '#d59631' },
};

export function nodeStrokeWidth(node: SceneNode): number {
  return node.pathEndpoint ? 5 : node.pathHighlighted || node.selected ? 4 : 2;
}

/**
 * The ring around a node, if any. Plain nodes have none; a portrait gets a thick ring in its generation color, so
 * the generation still shows around the photo. Route, selection and hypotheses override that.
 */
export function nodeOutline(node: SceneNode, colors: { route: string; selected: string; hypothesis: string }, hasPhoto: boolean): { color: string; width: number; dashed: boolean } | null {
  if (node.pathHighlighted) return { color: colors.route, width: node.pathEndpoint ? 5 : 4, dashed: false };
  if (node.selected) return { color: colors.selected, width: 3, dashed: false };
  if (node.status === 'hypothesis') return { color: colors.hypothesis, width: 2, dashed: true };
  if (hasPhoto) return { color: nodeFill(node), width: 4, dashed: false };
  return null;
}

/** Rounds coordinates written into SVG attributes; sub-pixel digits only bloat the DOM. */
export const px = (value: number) => Math.round(value * 10) / 10;

export function nodeRadius(node: SceneNode): number { return node.radius ?? NODE_RADIUS; }

export function visualRadius(generation: number | null, referenceGeneration: number | null, hasPhoto: boolean, selected: boolean, connections = 0): number {
  const distance = generation === null || referenceGeneration === null ? 0 : Math.abs(generation - referenceGeneration);
  // Area grows with degree; the multiplier is capped so a large family stays readable, but differences are plain to see.
  const connectionScale = Math.min(2.6, Math.sqrt(1 + Math.max(0, connections) / 2.5));
  return Math.max(10, NODE_RADIUS * Math.pow(0.75, distance)) * connectionScale + (hasPhoto ? 10 : 0) + (selected ? 5 : 0);
}

/**
 * Size by generation: the oldest (or the youngest) generation is largest and each generation step is 28% smaller.
 * People without a generation get the middle size.
 */
export function generationRadius(generation: number | null, range: { min: number; max: number } | null, olderLarger: boolean, hasPhoto: boolean, selected: boolean): number {
  const span = range ? range.max - range.min : 0;
  const steps = generation === null || !range ? span / 2 : olderLarger ? generation - range.min : range.max - generation;
  return Math.max(9, NODE_RADIUS * 2.2 * Math.pow(0.72, steps)) + (hasPhoto ? 10 : 0) + (selected ? 5 : 0);
}

/** "Heat" by relationship count on a log scale: cold blue for the fewest links, red for the most. */
export function heatColor(count: number, maxCount: number): string {
  const t = maxCount > 0 ? Math.log1p(Math.max(0, count)) / Math.log1p(maxCount) : 0;
  return hslHex(220 * (1 - t), 0.75, 0.58);
}

/**
 * Generation colors: the generations present are spread evenly over the color wheel, oldest violet to youngest red,
 * so neighbouring generations differ and no color repeats however deep the tree is.
 */
export function generationGradient(generation: number, range: { min: number; max: number } | null): string {
  const span = range ? range.max - range.min : 0;
  const t = span > 0 ? (Math.round(generation) - range!.min) / span : 0.5;
  return hslHex(275 - 275 * Math.max(0, Math.min(1, t)), 0.62, 0.62);
}

export function hslHex(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Deceased people keep their generation hue, only darker and slightly muted, so living relatives stand out. */
export function deceasedColor(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const shade = (channel: number) => Math.round((channel * 0.75 + gray * 0.25) * 0.6);
  return `#${[shade(r), shade(g), shade(b)].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function nodeFill(node: SceneNode): string { return node.deceased ? deceasedColor(node.color) : node.color; }

/** Opacity of the dark veil laid over portraits of deceased people. */
export const DECEASED_VEIL = 0.4;

export interface Point { x: number; y: number }
export interface Outline { outline: Point[]; path: string }

export function edgeEndpoints(a: SceneNode, b: SceneNode): { start: Point; end: Point } {
  const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length; const uy = dy / length;
  return { start: { x: a.x + ux * nodeRadius(a), y: a.y + uy * nodeRadius(a) }, end: { x: b.x - ux * nodeRadius(b), y: b.y - uy * nodeRadius(b) } };
}

/** Gap between the circles of spouses, who sit side by side. */
export const SPOUSE_GAP = 8;
/** How far the shape around spouses extends past their circles. */
export const SPOUSE_PAD = 6;
/** Opacity of the shape around spouses. */
export const SPOUSE_FILL_OPACITY = 0.35;
/** Points per half circle of a spouse capsule. */
export const CAPSULE_STEPS = 12;

/**
 * The outline around two spouses: both circles widened by `pad` and joined by their outer tangents — a pill for
 * equal sizes. Every outline turns the same way, so the capsules of one family filled as one path (nonzero rule)
 * merge into one shape: a chain for remarriages, a rounded triangle for three people married to one another.
 */
export function spouseCapsule(a: SceneNode, b: SceneNode, pad = SPOUSE_PAD): Outline {
  const ra = nodeRadius(a) + pad; const rb = nodeRadius(b) + pad;
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const arc = (center: Point, radius: number, from: number, to: number, steps: number) => {
    const points: Point[] = [];
    for (let step = 0; step <= steps; step++) {
      const angle = from + (to - from) * step / steps;
      points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
    }
    return points;
  };
  let outline: Point[];
  if (distance <= Math.abs(ra - rb) + 1e-6) {
    // One circle holds the other: the shape is just the larger circle.
    const [center, radius] = ra >= rb ? [a, ra] : [b, rb];
    outline = arc(center, radius, 0, Math.PI * 2, CAPSULE_STEPS * 2).slice(0, -1);
  } else {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    // The tangent points sit at ±(90° − tilt) from the line between the centers; the larger circle wraps more.
    const tilt = Math.asin((ra - rb) / distance);
    outline = [
      ...arc(a, ra, angle + Math.PI / 2 - tilt, angle + Math.PI * 3 / 2 + tilt, CAPSULE_STEPS),
      ...arc(b, rb, angle - Math.PI / 2 + tilt, angle + Math.PI / 2 - tilt, CAPSULE_STEPS),
    ];
  }
  return { outline, path: `M${outline.map((point) => `${px(point.x)} ${px(point.y)}`).join('L')}Z` };
}

/** Spouses linked to one another, directly or through a shared spouse: each group gets one merged shape. */
export function spouseGroups<E extends Edge>(edges: E[]): E[][] {
  const owner = new Map<string, string>();
  const find = (id: string): string => { let root = id; while (owner.has(root) && owner.get(root) !== root) root = owner.get(root)!; return root; };
  const spouseEdges = edges.filter((edge) => edge.relation === 'spouse');
  for (const edge of spouseEdges) {
    for (const id of [edge.from, edge.to]) if (!owner.has(id)) owner.set(id, id);
    const a = find(edge.from); const b = find(edge.to);
    if (a !== b) owner.set(b, a);
  }
  const groups = new Map<string, E[]>();
  for (const edge of spouseEdges) {
    const root = find(edge.from);
    groups.set(root, [...(groups.get(root) ?? []), edge]);
  }
  return [...groups.values()];
}

/** Positions of each person's spouses, for labelSide. */
export function spousePositions(edges: Edge[], nodes: Map<string, Point>): Map<string, Point[]> {
  const result = new Map<string, Point[]>();
  for (const edge of edges) {
    if (edge.relation !== 'spouse') continue;
    const a = nodes.get(edge.from); const b = nodes.get(edge.to);
    if (!a || !b) continue;
    result.set(edge.from, [...(result.get(edge.from) ?? []), b]);
    result.set(edge.to, [...(result.get(edge.to) ?? []), a]);
  }
  return result;
}

/** A label's lines: baselines of the name's lines (one or two), then of the years. */
export interface LabelLayout { x: number; nameY: number[]; yearsY: number; align: 'center' | 'left' | 'right' }

/** Spacing of name lines and the gap down to the years. */
const NAME_LINE = 13; const YEARS_LINE = 14;

/** The lines of a person's name on a label: two when the name splits at the surname, otherwise one. */
export function labelLines(person: { name: string; nameLines?: [string, string] }): string[] {
  return person.nameLines ? [...person.nameLines] : [person.name];
}

/** Baselines of a person's name lines and years: under the circle, or beside it, the block vertically centered. */
export function labelLayout(node: Point, radius: number, side: LabelSide, hasYears: boolean, lines = 1): LabelLayout {
  const from = (first: number) => {
    const nameY = Array.from({ length: lines }, (_, index) => first + index * NAME_LINE);
    return { nameY, yearsY: nameY[nameY.length - 1] + YEARS_LINE };
  };
  if (side === 'below') return { x: node.x, ...from(node.y + radius + 15), align: 'center' };
  const height = (lines - 1) * NAME_LINE + (hasYears ? YEARS_LINE : 0);
  const offset = radius + SPOUSE_PAD + 6;
  return { x: side === 'left' ? node.x - offset : node.x + offset, ...from(node.y - height / 2 + 4), align: side === 'left' ? 'right' : 'left' };
}

export type LabelSide = 'below' | 'left' | 'right';

/**
 * Where a person's name goes. Spouses sit side by side, so names under both would overlap: a person whose spouses
 * all sit to one side gets the name on the other side. Everyone else (no spouse, spouses on both sides) has it below.
 */
export function labelSide(node: Point, spouses: Point[]): LabelSide {
  if (!spouses.length) return 'below';
  const sideways = (spouse: Point) => Math.abs(spouse.x - node.x) > Math.abs(spouse.y - node.y) * 0.7;
  if (spouses.every((spouse) => spouse.x > node.x && sideways(spouse))) return 'left';
  if (spouses.every((spouse) => spouse.x < node.x && sideways(spouse))) return 'right';
  return 'below';
}

/** Children who share the same known parents; drawn as one stem from the couple with a branch per child. */
export interface Family<E extends Edge = Edge> {
  key: string;
  parents: string[];
  children: string[];
  edges: E[];
  /** Two parents that are not linked as spouses. */
  implicit: boolean;
}

/** Splits edges into families and edges drawn one by one (spouses, lone parent–child pairs, inconsistent data). */
export function groupFamilies<E extends Edge>(edges: E[]): { families: Family<E>[]; direct: E[] } {
  const spouses = new Set(edges.filter((edge) => edge.relation === 'spouse').map((edge) => [edge.from, edge.to].sort().join('\n')));
  const byChild = new Map<string, E[]>();
  const direct: E[] = [];
  for (const edge of edges) {
    // Adoptions are drawn as their own dashed lines, not as part of a birth family.
    if (edge.relation !== 'parent' || edge.adoptive) { direct.push(edge); continue; }
    byChild.set(edge.to, [...(byChild.get(edge.to) ?? []), edge]);
  }
  const groups = new Map<string, Family<E>>();
  for (const [child, list] of byChild) {
    const parents = [...new Set(list.map((edge) => edge.from))].sort();
    if (parents.length > 2) { direct.push(...list); continue; } // Inconsistent data: keep one line per parent.
    const key = parents.join('\n');
    let family = groups.get(key);
    if (!family) {
      family = { key, parents, children: [], edges: [], implicit: parents.length === 2 && !spouses.has(key) };
      groups.set(key, family);
    }
    family.children.push(child); family.edges.push(...list);
  }
  const families: Family<E>[] = [];
  for (const family of groups.values()) {
    if (family.parents.length === 1 && family.children.length === 1) direct.push(...family.edges);
    else families.push(family);
  }
  return { families, direct };
}

export interface FamilyBranch { child: string; start: Point; control: Point; end: Point; path: string }
export interface FamilyShape {
  hub: Point;
  /** Always null now: branches start at the couple's middle or at a lone parent's center. */
  stem: { start: Point; end: Point } | null;
  /** Dashed link between two parents who are not recorded as spouses. */
  connector: { start: Point; end: Point } | null;
  /** Segments from each parent to the middle of the couple, shown when a route enters the family through that parent. */
  halves: Array<{ parent: string; start: Point; end: Point }>;
  branches: FamilyBranch[];
}

const unit = (from: Point, to: Point) => {
  const dx = to.x - from.x; const dy = to.y - from.y; const length = Math.hypot(dx, dy);
  return length < 1e-6 ? null : { x: dx / length, y: dy / length, length };
};

export function familyShape(family: Family, nodes: Map<string, SceneNode>): FamilyShape | null {
  const parents = family.parents.map((id) => nodes.get(id)).filter((node): node is SceneNode => Boolean(node));
  const children = family.children.map((id) => nodes.get(id)).filter((node): node is SceneNode => Boolean(node));
  if (parents.length !== family.parents.length || !children.length) return null;
  let origin: Point; let connector: FamilyShape['connector'] = null;
  let halves: FamilyShape['halves'] = [];
  if (parents.length === 2) {
    const ends = edgeEndpoints(parents[0], parents[1]);
    origin = { x: (ends.start.x + ends.end.x) / 2, y: (ends.start.y + ends.end.y) / 2 };
    halves = [{ parent: parents[0].id, start: ends.start, end: origin }, { parent: parents[1].id, start: ends.end, end: origin }];
    if (family.implicit) connector = ends;
  } else origin = { x: parents[0].x, y: parents[0].y };
  // No stem: straight lines fan out from the middle of the couple's ribbon, or from the center of a lone parent's node.
  const stem: FamilyShape['stem'] = null; const hub = origin;
  const branches = children.map((child) => {
    const inward = unit(hub, child) ?? { x: 0, y: 1, length: 0 };
    const radius = nodeRadius(child);
    const end = { x: child.x - inward.x * radius, y: child.y - inward.y * radius };
    const control = { x: (hub.x + end.x) / 2, y: (hub.y + end.y) / 2 }; // On the line, so curve-midpoint math stays valid.
    return { child: child.id, start: hub, control, end, path: `M${px(hub.x)} ${px(hub.y)}L${px(end.x)} ${px(end.y)}` };
  });
  return { hub, stem, connector, halves, branches };
}

export function sceneBounds(scene: Scene, padding = 50): Bounds {
  if (!scene.nodes.length) return { x: -200, y: -150, width: 400, height: 300 };
  const width = (node: SceneNode) => Math.max(nodeRadius(node), ...labelLines(node).map((line) => line.length * 3.8));
  const minX = Math.min(...scene.nodes.map((node) => node.x - width(node)));
  const maxX = Math.max(...scene.nodes.map((node) => node.x + width(node)));
  const minY = Math.min(...scene.nodes.map((node) => node.y - nodeRadius(node)));
  const maxY = Math.max(...scene.nodes.map((node) => node.y + nodeRadius(node) + 40 + (labelLines(node).length - 1) * NAME_LINE));
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

/** Pixel size of a free-form (not print-fitted) image: keeps the graph's aspect ratio and stays within canvas limits. */
export function imagePixels(bounds: Bounds, scale = 2, maxSide = 8000): [number, number] {
  const factor = Math.min(scale, maxSide / Math.max(bounds.width, bounds.height, 1));
  return [Math.max(1, Math.round(bounds.width * factor)), Math.max(1, Math.round(bounds.height * factor))];
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]!);

export function renderSvg(scene: Scene, bounds: Bounds, width: number, height: number, fontDataUrl?: string, paper = false): string {
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const colors = paper ? PALETTES.paper : PALETTES.dark;
  const font = fontDataUrl ? `@font-face{font-family:GenealogyExport;src:url('${fontDataUrl}')}text{font-family:GenealogyExport,sans-serif}` : 'text{font-family:sans-serif}';
  const { families, direct } = groupFamilies(scene.edges);
  const line = (start: Point, end: Point, attrs: string) => `<line x1="${px(start.x)}" y1="${px(start.y)}" x2="${px(end.x)}" y2="${px(end.y)}" ${attrs}/>`;
  const familyMarkup = families.map((family) => {
    const shape = familyShape(family, nodes);
    if (!shape) return '';
    const onRoute = family.edges.some((edge) => edge.pathHighlighted);
    const muted = (edges: SceneEdge[]) => edges.every((edge) => edge.dimmed) ? ' opacity="0.18"' : '';
    const stroke = onRoute ? colors.route : colors.edge;
    const connector = shape.connector ? line(shape.connector.start, shape.connector.end, `stroke="${colors.edge}" stroke-width="1.2" stroke-dasharray="3 4"${muted(family.edges)}`) : '';
    const stem = shape.stem ? line(shape.stem.start, shape.stem.end, `stroke="${stroke}" stroke-width="${onRoute ? 4 : 2.2}" stroke-linecap="round"${muted(family.edges)}`) : '';
    const hub = shape.stem && family.children.length > 1 ? `<circle cx="${px(shape.hub.x)}" cy="${px(shape.hub.y)}" r="3" fill="${stroke}"${muted(family.edges)}/>` : '';
    const branches = shape.branches.map((branch) => {
      const edges = family.edges.filter((edge) => edge.to === branch.child);
      const on = edges.some((edge) => edge.pathHighlighted);
      return `<path d="${branch.path}" fill="none" stroke="${on ? colors.route : colors.edge}" stroke-width="${on ? 4 : 1.7}" marker-end="url(#${on ? 'path-arrow' : 'arrow'})"${muted(edges)}/>`;
    }).join('');
    return connector + stem + branches + hub;
  }).join('');
  const routeHalves = families.map((family) => {
    const shape = familyShape(family, nodes);
    return (shape?.halves ?? []).filter((half) => family.edges.some((edge) => edge.pathHighlighted && edge.from === half.parent))
      .map((half) => line(half.start, half.end, `stroke="${colors.route}" stroke-width="4" stroke-linecap="round"`)).join('');
  }).join('');
  // Each group of spouses is one merged shape: its capsules are drawn opaque inside a translucent group.
  const spouseMarkup = spouseGroups(scene.edges).map((group) => {
    const capsules = group.map((edge) => {
      const a = nodes.get(edge.from); const b = nodes.get(edge.to);
      return a && b ? `<path d="${spouseCapsule(a, b).path}" fill="${edge.pathHighlighted ? colors.route : SPOUSE_COLOR}"/>` : '';
    }).join('');
    const opacity = SPOUSE_FILL_OPACITY * (group.every((edge) => edge.dimmed) ? 0.18 : 1);
    return `<g opacity="${px(opacity * 100) / 100}">${capsules}</g>`;
  }).join('');
  const edgeMarkup = spouseMarkup + familyMarkup + direct.map((edge) => {
    const a = nodes.get(edge.from); const b = nodes.get(edge.to);
    if (!a || !b || edge.relation === 'spouse') return '';
    const opacity = edge.dimmed ? ' opacity="0.18"' : '';
    const { start, end } = edgeEndpoints(a, b);
    return line(start, end, `stroke="${edge.pathHighlighted ? colors.route : colors.edge}" stroke-width="${edge.pathHighlighted ? 4 : 1.7}"${edge.adoptive ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#${edge.pathHighlighted ? 'path-arrow' : 'arrow'})"${opacity}`);
  }).join('') + routeHalves;
  const spousesOf = spousePositions(scene.edges, nodes);
  const nodeMarkup = scene.nodes.map((node) => {
    const radius = nodeRadius(node);
    const lines = labelLines(node);
    const label = labelLayout(node, radius, labelSide(node, spousesOf.get(node.id) ?? []), Boolean(node.lifeYears), lines.length);
    const anchor = label.align === 'center' ? 'middle' : label.align === 'right' ? 'end' : 'start';
    const name = lines.map((line, index) => `<text x="${px(label.x)}" y="${px(label.nameY[index])}" text-anchor="${anchor}" font-size="11" fill="${colors.text}">${escapeXml(line)}</text>`).join('');
    const image = node.image ? `<image href="${escapeXml(node.image)}" x="${px(node.x - radius)}" y="${px(node.y - radius)}" width="${px(radius * 2)}" height="${px(radius * 2)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#portrait)"/>` : '';
    const veil = node.deceased && node.image ? `<circle cx="${px(node.x)}" cy="${px(node.y)}" r="${px(radius)}" fill="#000" fill-opacity="${DECEASED_VEIL}"/>` : '';
    const outline = nodeOutline(node, colors, Boolean(node.image));
    const opacity = node.dimmed ? ' opacity="0.2"' : '';
    return `<g${opacity}><circle cx="${px(node.x)}" cy="${px(node.y)}" r="${px(radius)}" fill="${node.image ? '#fff' : escapeXml(nodeFill(node))}"/>${image}${veil}${outline ? `<circle cx="${px(node.x)}" cy="${px(node.y)}" r="${px(radius)}" fill="none" stroke="${escapeXml(outline.color)}" stroke-width="${outline.width}"${outline.dashed ? ' stroke-dasharray="4 3"' : ''}/>` : ''}${name}${node.lifeYears ? `<text x="${px(label.x)}" y="${px(label.yearsY)}" text-anchor="${anchor}" font-size="10" fill="${colors.years}">${escapeXml(node.lifeYears)}</text>` : ''}</g>`;
  }).join('');
  const arrow = (id: string, fill: string) => `<marker id="${id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="${fill}"/></marker>`;
  const clip = '<clipPath id="portrait" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><defs>${arrow('arrow', colors.edge)}${arrow('path-arrow', colors.route)}${clip}</defs><style>${font}</style><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${colors.background}"/>${edgeMarkup}${nodeMarkup}</svg>`;
}
