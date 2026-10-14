import { adjacency, type Edge, type Graph } from './model';
import type { Family } from './scene';

/** Index actual drawing elements once, including the shared parts of family links. */
export function hoverIndex<T>(
  graph: Graph,
  nodes: Map<string, T>,
  direct: Array<{ edge: Edge; element: T }>,
  families: Array<{ family: Family; stem: T; hub: T; connector: T | null; branches: Array<{ child: string; element: T }> }>,
): Map<string, Set<T>> {
  const index = new Map<string, Set<T>>();
  const neighbors = adjacency(graph);
  for (const [id, node] of nodes) {
    const elements = new Set([node]);
    for (const { next } of neighbors.get(id) ?? []) {
      const relative = nodes.get(next);
      if (relative !== undefined) elements.add(relative);
    }
    index.set(id, elements);
  }
  for (const { edge, element } of direct) {
    index.get(edge.from)?.add(element);
    index.get(edge.to)?.add(element);
  }
  for (const { family, stem, hub, connector, branches } of families) {
    for (const id of [...family.parents, ...family.children]) {
      const elements = index.get(id);
      if (!elements) continue;
      elements.add(stem); elements.add(hub);
      if (connector !== null) elements.add(connector);
    }
    for (const { child, element } of branches) {
      index.get(child)?.add(element);
      for (const parent of family.parents) index.get(parent)?.add(element);
    }
  }
  return index;
}
