import { dateYear, parseDate } from './dates';
import { t } from './i18n';

export interface Person {
  id: string;
  name: string;
  generation: number | null;
  photo?: string;
  /** Vault path of the resolved portrait image. */
  portrait?: string;
  status?: string;
  deceased?: boolean;
  lifeYears?: string;
  sex?: 'male' | 'female';
  /** The name over two lines, surname above (see nameLines); absent keeps it on one line. */
  nameLines?: [string, string];
  /** Year of birth, approximate or bounded dates included; dates the years of a generation. */
  birthYear?: number;
}

export type Relation = 'parent' | 'spouse';

export interface Edge {
  from: string;
  to: string;
  relation: Relation;
  /** A parent link that is an adoption rather than birth (drawn dashed). */
  adoptive?: boolean;
}

export interface Issue {
  source: string;
  field: string;
  target: string;
  reason: 'missing' | 'self' | 'generation' | 'invalid' | 'value';
  /** The other person involved, when the link resolved: both cards are marked on the graph. */
  targetId?: string;
}

/** People a list of issues points at: the cards declaring the problem and, when known, the other card. */
export function problemPeople(issues: readonly Issue[]): Map<string, Issue[]> {
  const byPerson = new Map<string, Issue[]>();
  for (const issue of issues) {
    for (const id of new Set([issue.source, issue.targetId].filter((value): value is string => Boolean(value)))) {
      byPerson.set(id, [...(byPerson.get(id) ?? []), issue]);
    }
  }
  return byPerson;
}

export interface Graph {
  people: Person[];
  edges: Edge[];
  issues: Issue[];
}

export interface RawPerson extends Omit<Person, 'generation'> {
  ancestors: unknown;
  descendants: unknown;
  spouses: unknown;
  adoptiveParents?: unknown;
}


/**
 * A date as a year for a label (see dates.ts): `1915`; about or a range `1915?`; before `<1915`, after `>1915`; a
 * decade «1910s» / «1910-е»; `?` when there is no year.
 */
export function yearLabel(value: unknown): string {
  const date = parseDate(value);
  if (!date || date.kind === 'unknown') return '?';
  const year = date.date.year;
  switch (date.kind) {
    case 'exact': return String(year);
    case 'about': case 'between': return `${year}?`;
    case 'before': return `<${year}`;
    case 'after': return `>${year}`;
    case 'decade': return t().decade(year);
  }
}

/**
 * A name over two lines for a label: the surname (with the birth surname in parentheses, if the name has it) on one
 * line, the other names on the other, in the order the name is written — «Зуева (Мельникова)» / «Ольга Ильинична»,
 * «John Ronald» / «Smith (Jones)». A name without a surname stays on one line.
 */
export function nameLines(name: string, surname: unknown): [string, string] | undefined {
  const family = typeof surname === 'string' ? surname.trim() : '';
  if (!family) return undefined;
  const birth = name.match(/\s*(\([^)]*\))\s*$/);
  const plain = birth ? name.slice(0, birth.index).trim() : name;
  const top = birth ? `${family} ${birth[1]}` : family;
  if (plain.startsWith(`${family} `)) { const rest = plain.slice(family.length).trim(); return rest ? [top, rest] : undefined; }
  if (plain.endsWith(` ${family}`)) { const rest = plain.slice(0, -family.length).trim(); return rest ? [rest, top] : undefined; }
  return undefined;
}

/** The year a date names (`1915`, `1915?`, `<1915`, `1910-е`, the start of a range); null without one. */
export function yearOf(value: unknown): number | null { return dateYear(value); }

/** An empty death date means the person is alive; an explicit `?` means the year of death is unknown. */
export function isBlankDate(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

/** Anything in the death field, even `?`, means the person has died. */
export function isDeceased(death: unknown): boolean { return !isBlankDate(death); }

/**
 * Years under a name. Living: `b. 2001` (`р. 2001`); deceased: `1915–1980` (`?` for an unknown year); unknown status: `2001–`,
 * which does not claim the person is alive. Without a status, an empty death date means living (the old rule).
 */
export function lifeYears(birth: unknown, death: unknown, status?: 'living' | 'deceased' | 'unknown'): string {
  const born = yearLabel(birth);
  const state = status ?? (isBlankDate(death) ? 'living' : 'deceased');
  if (state === 'living') return born === '?' ? '' : t().bornYear(born);
  if (state === 'unknown') return born === '?' ? '' : `${born}–`;
  return `${born}–${isBlankDate(death) ? '?' : yearLabel(death)}`;
}

export function references(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return values.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const matches = [...entry.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split('|')[0].split('#')[0].trim());
    return matches.length ? matches.filter(Boolean) : [entry.trim()].filter(Boolean);
  });
}

/**
 * Builds the graph from cards. Relationships come from both sides (a parent listing a child is the same link as the
 * child listing the parent). Generations are computed, not read: parent −1, child +1, spouse the same. The component
 * holding `anchor` («me») counts from the anchor's 0; other components are shifted so their youngest generation is 0.
 * A parent link whose generations do not fit the rest of the family is still drawn and reported.
 */
export function buildGraph(raw: RawPerson[], resolve: (link: string, source: string) => string | null, anchor: string | null = null): Graph {
  const byId = new Map(raw.map((person) => [person.id, person]));
  const edges = new Map<string, Edge>();
  const issues: Issue[] = [];

  const add = (person: RawPerson, field: string, value: unknown, relation: Relation, reverse = false, adoptive = false) => {
    for (const link of references(value)) {
      const targetId = resolve(link, person.id);
      if (!targetId || !byId.has(targetId)) {
        issues.push({ source: person.id, field, target: link, reason: 'missing' });
        continue;
      }
      if (targetId === person.id) {
        issues.push({ source: person.id, field, target: link, reason: 'self', targetId });
        continue;
      }
      if (relation === 'parent') {
        const from = reverse ? targetId : person.id;
        const to = reverse ? person.id : targetId;
        const existing = edges.get(`p:${from}:${to}`);
        // A birth link declared anywhere wins over the same link declared as an adoption.
        edges.set(`p:${from}:${to}`, adoptive && !existing ? { from, to, relation, adoptive } : existing && !existing.adoptive ? existing : { from, to, relation });
      } else {
        const [a, b] = [person.id, targetId].sort();
        edges.set(`s:${a}:${b}`, { from: a, to: b, relation });
      }
    }
  };

  for (const person of raw) {
    add(person, 'parents', person.ancestors, 'parent', true);
    add(person, 'children', person.descendants, 'parent');
    add(person, 'spouses', person.spouses, 'spouse');
    add(person, 'adoptive_parents', person.adoptiveParents, 'parent', true, true);
  }
  // A parent who is also a spouse, or a link both ways, is drawn as declared; generations report the contradiction.
  const list = [...edges.values()];
  const generation = computeGenerations(raw.map((person) => person.id), list, anchor);
  for (const edge of list) {
    if (edge.relation !== 'parent') continue;
    const parent = generation.get(edge.from); const child = generation.get(edge.to);
    if (parent !== undefined && child !== undefined && child - parent !== 1) {
      issues.push({ source: edge.to, field: edge.adoptive ? 'adoptive_parents' : 'parents', target: edge.from.replace(/^.*\//, '').replace(/\.md$/, ''), reason: 'generation', targetId: edge.from });
    }
  }
  const people = raw.map(({ id, name, photo, portrait, status, deceased, lifeYears, sex, birthYear, nameLines }) => ({ id, name, generation: generation.get(id) ?? null, photo, portrait, status, deceased, lifeYears, sex, birthYear, nameLines }));
  return { people, edges: list, issues };
}

/**
 * Generation of every person: parent −1, child +1, spouse the same. A breadth-first pass places everyone, parent
 * links before spouse links, so a marriage across generations does not shift a whole family. A second pass moves
 * children below their parents (and spouses who have no parents of their own along with them), so a link that skips
 * a generation, not the chain it shortcuts, is the one left contradicting. The caller reports such links.
 */
export function computeGenerations(ids: string[], edges: Edge[], anchor: string | null): Map<string, number> {
  const steps = new Map<string, Array<{ to: string; delta: number; spouse: boolean }>>();
  const children = new Map<string, string[]>(); const spousesOf = new Map<string, string[]>(); const hasParents = new Set<string>();
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); };
  for (const edge of edges) {
    const spouse = edge.relation === 'spouse'; const delta = spouse ? 0 : 1;
    push(steps, edge.from, { to: edge.to, delta, spouse }); push(steps, edge.to, { to: edge.from, delta: -delta, spouse });
    if (spouse) { push(spousesOf, edge.from, edge.to); push(spousesOf, edge.to, edge.from); } else { push(children, edge.from, edge.to); hasParents.add(edge.to); }
  }
  for (const list of steps.values()) list.sort((a, b) => Number(a.spouse) - Number(b.spouse));
  const generation = new Map<string, number>();
  const known = new Set(ids);
  const roots = anchor && known.has(anchor) ? [anchor, ...ids.filter((id) => id !== anchor)] : ids;
  for (const root of roots) {
    if (generation.has(root)) continue;
    generation.set(root, 0);
    const component = [root];
    for (let head = 0; head < component.length; head++) {
      const current = component[head];
      for (const { to, delta } of steps.get(current) ?? []) {
        if (generation.has(to) || !known.has(to)) continue;
        generation.set(to, generation.get(current)! + delta);
        component.push(to);
      }
    }
    // Children below parents. A cycle in the data would push forever, so the moves are capped.
    const queue = [...component];
    let budget = component.length * 20;
    for (let head = 0; head < queue.length && budget > 0; head++) {
      const parent = queue[head];
      const below = generation.get(parent)! + 1;
      for (const child of children.get(parent) ?? []) {
        if (!known.has(child) || generation.get(child)! >= below) continue;
        generation.set(child, below); queue.push(child); budget--;
        for (const spouse of spousesOf.get(child) ?? []) {
          if (known.has(spouse) && !hasParents.has(spouse) && generation.get(spouse)! < below) { generation.set(spouse, below); queue.push(spouse); budget--; }
        }
      }
    }
    const zero = root === anchor ? generation.get(anchor)! : Math.max(...component.map((id) => generation.get(id)!));
    if (zero) for (const id of component) generation.set(id, generation.get(id)! - zero);
  }
  return generation;
}

type Adjacency = Map<string, Array<{ next: string; edge: Edge }>>;
const adjacencyCache = new WeakMap<Graph, Adjacency>();

export function adjacency(graph: Graph): Adjacency {
  let adjacent = adjacencyCache.get(graph);
  if (adjacent) return adjacent;
  adjacent = new Map();
  for (const edge of graph.edges) {
    if (!adjacent.has(edge.from)) adjacent.set(edge.from, []);
    if (!adjacent.has(edge.to)) adjacent.set(edge.to, []);
    adjacent.get(edge.from)!.push({ next: edge.to, edge });
    adjacent.get(edge.to)!.push({ next: edge.from, edge });
  }
  adjacencyCache.set(graph, adjacent);
  return adjacent;
}

export function reachable(graph: Graph, roots: Set<string>, maxDepth = Infinity): Set<string> {
  const adjacent = adjacency(graph);
  const seen = new Set(roots);
  const queue = [...roots].map((id) => ({ id, depth: 0 }));
  for (let head = 0; head < queue.length; head++) {
    const { id, depth } = queue[head];
    if (depth >= maxDepth) continue;
    for (const { next } of adjacent.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push({ id: next, depth: depth + 1 });
      }
    }
  }
  return seen;
}

export const edgeKey = (edge: Edge) => `${edge.relation}:${edge.from}:${edge.to}`;

/** People reachable from `roots` inside `allowed`, never crossing `blocked` edges. */
export function reachWithin(graph: Graph, roots: Iterable<string>, allowed: Set<string>, blocked: Set<string> = new Set()): Set<string> {
  const adjacent = adjacency(graph);
  const queue = [...roots].filter((id) => allowed.has(id));
  const seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    for (const { next, edge } of adjacent.get(queue[head]) ?? []) {
      if (allowed.has(next) && !seen.has(next) && !blocked.has(edgeKey(edge))) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

/** A hidden link: `hide` is the side that disappears, `keep` the side that stays. */
export interface Cut { edges: string[]; hide: string[]; keep: string[] }

/**
 * Proposes cutting `edges`, which join `sideA` to `sideB`. Returns null when the two sides stay connected another way.
 * The side holding any of `roots` is kept; without roots the smaller side is hidden.
 */
export function proposeCut(graph: Graph, edges: Edge[], sideA: string[], sideB: string[], roots: string[], existing: Cut[] = []): { cut: Cut; region: Set<string> } | null {
  const everyone = new Set(graph.people.map((person) => person.id));
  const blocked = new Set([...existing.flatMap((cut) => cut.edges), ...edges.map(edgeKey)]);
  const regionA = reachWithin(graph, sideA, everyone, blocked);
  if (sideB.some((id) => regionA.has(id))) return null;
  const regionB = reachWithin(graph, sideB, everyone, blocked);
  const rootsInA = roots.some((id) => regionA.has(id)); const rootsInB = roots.some((id) => regionB.has(id));
  const hideA = rootsInA === rootsInB ? regionA.size < regionB.size : rootsInB;
  const [hide, keep, region] = hideA ? [sideA, sideB, regionA] : [sideB, sideA, regionB];
  return { cut: { edges: edges.map(edgeKey), hide, keep }, region };
}

/** People hidden by cuts, per cut; `protect` (selected people, route) always stays visible. */
export function applyCuts(graph: Graph, cuts: Cut[], allowed: Set<string>, protect: Set<string>): { hidden: Set<string>; regions: Map<Cut, Set<string>> } {
  const blocked = new Set(cuts.flatMap((cut) => cut.edges));
  const hidden = new Set<string>();
  const regions = new Map<Cut, Set<string>>();
  for (const cut of cuts) {
    const region = reachWithin(graph, cut.hide, allowed, blocked);
    if (!region.size || cut.keep.some((id) => region.has(id))) continue; // Data changed and the cut no longer separates anything.
    for (const id of protect) region.delete(id);
    regions.set(cut, region);
    for (const id of region) hidden.add(id);
  }
  return { hidden, regions };
}

/** For each visible person, how many hidden people are reachable through them (only across hidden people). */
export function hiddenBehind(graph: Graph, visible: Set<string>): Map<string, number> {
  const adjacent = adjacency(graph);
  const counts = new Map<string, number>();
  for (const id of visible) {
    const start = (adjacent.get(id) ?? []).map(({ next }) => next).filter((next) => !visible.has(next));
    if (!start.length) continue;
    const seen = new Set(start);
    const queue = [...seen];
    for (let head = 0; head < queue.length; head++) {
      for (const { next } of adjacent.get(queue[head]) ?? []) {
        if (!visible.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    counts.set(id, seen.size);
  }
  return counts;
}

export interface GraphPath { nodes: string[]; edges: Edge[] }

/**
 * «Корни»: the chosen people and all their ancestors up to the oldest known, with the parent links between them.
 * Adoptive parents count. Roots come first, then ancestors generation by generation.
 */
export function ancestry(graph: Graph, roots: string[]): GraphPath {
  const adjacent = adjacency(graph);
  const nodes = roots.filter((id) => adjacent.has(id) || graph.people.some((person) => person.id === id));
  const seen = new Set(nodes); const edges: Edge[] = [];
  for (let head = 0; head < nodes.length; head++) {
    for (const { next, edge } of adjacent.get(nodes[head]) ?? []) {
      if (edge.relation !== 'parent' || edge.to !== nodes[head]) continue;
      edges.push(edge);
      if (!seen.has(next)) { seen.add(next); nodes.push(next); }
    }
  }
  return { nodes, edges };
}

/**
 * People within `steps` generations of kin (parent and child links) of `roots`. A marriage takes no step: a
 * relative's spouse comes with them.
 */
export function kinAround(graph: Graph, roots: Iterable<string>, steps: number): Set<string> {
  const adjacent = adjacency(graph);
  const distance = new Map<string, number>();
  const deque: string[] = [];
  for (const id of roots) { distance.set(id, 0); deque.push(id); }
  // 0-1 breadth first: spouses go to the front at the same distance, kin to the back one step further.
  while (deque.length) {
    const id = deque.shift()!;
    const here = distance.get(id)!;
    for (const { next, edge } of adjacent.get(id) ?? []) {
      const cost = edge.relation === 'spouse' ? 0 : 1;
      const there = here + cost;
      if (there > steps || (distance.get(next) ?? Infinity) <= there) continue;
      distance.set(next, there);
      if (cost) deque.push(next); else deque.unshift(next);
    }
  }
  return new Set(distance.keys());
}

/**
 * A shortest route between two people. Among routes of the same length, the one through the fewest marriages wins:
 * through a common grandparent rather than through a parent's spouse, so the route reads as kinship.
 */
export function shortestPath(graph: Graph, from: string, to: string): GraphPath | null {
  if (!graph.people.some((person) => person.id === from) || !graph.people.some((person) => person.id === to)) return null;
  if (from === to) return { nodes: [from], edges: [] };
  const adjacent = adjacency(graph);
  const best = new Map<string, { depth: number; marriages: number; previous: string | null; edge: Edge | null }>([[from, { depth: 0, marriages: 0, previous: null, edge: null }]]);
  const queue = [from];
  // Breadth first: every person of a depth is reached by all of the previous depth before it is expanded.
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const here = best.get(current)!;
    const target = best.get(to);
    if (target && here.depth >= target.depth) break;
    for (const { next, edge } of adjacent.get(current) ?? []) {
      const marriages = here.marriages + (edge.relation === 'spouse' ? 1 : 0);
      const known = best.get(next);
      if (known && (known.depth <= here.depth || known.marriages <= marriages)) continue;
      if (!known) queue.push(next);
      best.set(next, { depth: here.depth + 1, marriages, previous: current, edge });
    }
  }
  if (!best.has(to)) return null;
  const nodes = [to]; const edges: Edge[] = [];
  for (let step = best.get(to)!; step.previous !== null; step = best.get(step.previous)!) { nodes.unshift(step.previous); edges.unshift(step.edge!); }
  return { nodes, edges };
}
