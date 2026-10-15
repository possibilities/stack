export type TabStack = { type: "stack"; id: string; tabs: string[]; active: string };
export type PaneSplit = { type: "split"; id: string; axis: "x" | "y"; children: PaneNode[]; weights: number[] };
export type PaneNode = TabStack | PaneSplit;
export type Placement = "left" | "right" | "above" | "below" | "tab";
export type Direction = "left" | "right" | "up" | "down";
export type PaneRect = { x: number; y: number; width: number; height: number };
export type StackRect = TabStack & PaneRect;
export type Divider = PaneRect & { split: string; index: number; axis: "x" | "y"; fraction: number; pair: PaneRect; min: number; max: number };
export const paneGap = 8;
export const paneMinimum = { width: 280, height: 180 };

export const tabs = (...ids: string[]): TabStack => ({ type: "stack", id: `tabs:${ids[0]}`, tabs: ids, active: ids[0] });
export function split(axis: "x" | "y", ...children: [PaneNode, number][]): PaneSplit {
  return { type: "split", id: `${axis}:${children[0][0].id}`, axis, children: children.map(([node]) => node), weights: shares(children.map(([, weight]) => weight)) };
}
const shares = (weights: number[]) => { const total = weights.reduce((a, b) => a + b, 0); return weights.map((weight) => weight / total); };
export const paneIds = (node: PaneNode | null): string[] => !node ? [] : node.type === "stack" ? node.tabs : node.children.flatMap(paneIds);
export const tabStacks = (node: PaneNode | null): TabStack[] => !node ? [] : node.type === "stack" ? [node] : node.children.flatMap(tabStacks);

export function filterTree(node: PaneNode | null, allowed: ReadonlySet<string>): PaneNode | null {
  if (!node) return null;
  if (node.type === "stack") {
    const kept = node.tabs.filter((id) => allowed.has(id));
    if (!kept.length) return null;
    if (kept.length === node.tabs.length) return node;
    const index = node.tabs.indexOf(node.active);
    return { ...node, tabs: kept, active: kept.includes(node.active) ? node.active : kept[Math.min(index, kept.length - 1)] };
  }
  const children: PaneNode[] = [], weights: number[] = [];
  node.children.forEach((child, index) => { const kept = filterTree(child, allowed); if (kept) { children.push(kept); weights.push(node.weights[index]); } });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  if (children.length === node.children.length && children.every((child, index) => child === node.children[index])) return node;
  return { ...node, children, weights: shares(weights) };
}
export const removePane = (tree: PaneNode | null, id: string) => filterTree(tree, new Set(paneIds(tree).filter((pane) => pane !== id)));

function mapTree(node: PaneNode, apply: (node: PaneNode) => PaneNode): PaneNode {
  const next = apply(node);
  if (next !== node || node.type === "stack") return next;
  const children = node.children.map((child) => mapTree(child, apply));
  return children.every((child, i) => child === node.children[i]) ? node : { ...node, children };
}
export function activatePane(tree: PaneNode | null, id: string): PaneNode | null {
  return tree && mapTree(tree, (node) => node.type === "stack" && node.tabs.includes(id) && node.active !== id ? { ...node, active: id } : node);
}
function uniqueNodeId(tree: PaneNode | null, base: string): string {
  const ids = new Set<string>();
  if (tree) mapTree(tree, (node) => { ids.add(node.id); return node; });
  let id = base, suffix = 2;
  while (ids.has(id)) id = `${base}:${suffix++}`;
  return id;
}
export function placePane(tree: PaneNode | null, id: string, target: string | null, side: Placement): PaneNode | null {
  if (!tree) return tabs(id);
  if (id === target || !target || !paneIds(tree).includes(target)) return tree;
  const without = removePane(tree, id)!;
  const fresh = { ...tabs(id), id: uniqueNodeId(without, `tabs:${id}`) };
  return mapTree(without, (node) => {
    if (node.type !== "stack" || !node.tabs.includes(target)) return node;
    if (side === "tab") return { ...node, tabs: [...node.tabs, id], active: id };
    const first = side === "left" || side === "above";
    return { type: "split", id: uniqueNodeId(without, `split:${id}`), axis: side === "left" || side === "right" ? "x" : "y", children: first ? [fresh, node] : [node, fresh], weights: [0.5, 0.5] };
  });
}
export function swapPanes(tree: PaneNode | null, a: string, b: string): PaneNode | null {
  if (!tree || a === b || ![a, b].every((id) => paneIds(tree).includes(id))) return tree;
  const swap = (id: string) => id === a ? b : id === b ? a : id;
  return mapTree(tree, (node) => node.type === "stack" ? { ...node, tabs: node.tabs.map(swap), active: swap(node.active) } : node);
}
export function resizeSplit(tree: PaneNode, id: string, index: number, fraction: number): PaneNode {
  if (!Number.isFinite(fraction)) return tree;
  return mapTree(tree, (node) => {
    if (node.type !== "split" || node.id !== id || index < 0 || index >= node.weights.length - 1) return node;
    const weights = [...node.weights], total = weights[index] + weights[index + 1];
    const value = Math.max(0.02, Math.min(0.98, fraction));
    weights[index] = total * value; weights[index + 1] = total * (1 - value);
    return { ...node, weights };
  });
}
export function paneAnchor(tree: PaneNode | null, id: string): { neighbor: string; side: Placement } | null {
  if (!tree) return null;
  if (tree.type === "stack") {
    const neighbor = tree.tabs.find((pane) => pane !== id);
    return tree.tabs.includes(id) && neighbor ? { neighbor, side: "tab" } : null;
  }
  const index = tree.children.findIndex((child) => paneIds(child).includes(id));
  if (index < 0) return null;
  const inner = paneAnchor(tree.children[index], id);
  if (inner) return inner;
  const neighbor = tree.children[index === 0 ? 1 : index - 1];
  return { neighbor: tabStacks(neighbor)[0].active, side: tree.axis === "x" ? index === 0 ? "left" : "right" : index === 0 ? "above" : "below" };
}

export function minimumSize(node: PaneNode): { width: number; height: number } {
  if (node.type === "stack") return paneMinimum;
  const children = node.children.map(minimumSize);
  return {
    width: node.axis === "x" ? children.reduce((sum, size) => sum + size.width, paneGap * (children.length - 1)) : Math.max(...children.map((size) => size.width)),
    height: node.axis === "y" ? children.reduce((sum, size) => sum + size.height, paneGap * (children.length - 1)) : Math.max(...children.map((size) => size.height)),
  };
}
function extents(total: number, weights: number[], minimum: number[]): number[] {
  const sizes = weights.map((weight) => total * weight);
  let free = total, remaining = weights.map((_, i) => i);
  while (remaining.length) {
    const sum = remaining.reduce((value, i) => value + weights[i], 0);
    const small = remaining.filter((i) => free * weights[i] / sum < minimum[i]);
    if (!small.length) { for (const i of remaining) sizes[i] = free * weights[i] / sum; break; }
    for (const i of small) { sizes[i] = minimum[i]; free -= sizes[i]; }
    remaining = remaining.filter((i) => !small.includes(i));
  }
  return sizes;
}
export function projectLayout(tree: PaneNode | null, viewport: { width: number; height: number }, focus?: string | null): { stacks: StackRect[]; dividers: Divider[]; compact: boolean } {
  const stacks: StackRect[] = [], dividers: Divider[] = [];
  if (!tree) return { stacks, dividers, compact: false };
  const width = Math.max(0, viewport.width), height = Math.max(0, viewport.height);
  const min = minimumSize(tree), compact = width < min.width || height < min.height;
  if (compact) {
    const ids = paneIds(tree);
    return { stacks: [{ ...tabs(...ids), id: "compact", active: focus && ids.includes(focus) ? focus : tabStacks(tree)[0].active, x: 0, y: 0, width, height }], dividers, compact };
  }
  const visit = (node: PaneNode, rect: PaneRect) => {
    if (node.type === "stack") { stacks.push({ ...node, ...rect }); return; }
    const dimension = node.axis === "x" ? "width" : "height", coordinate = node.axis;
    const minimum = node.children.map((child) => minimumSize(child)[dimension]);
    const sizes = extents(rect[dimension] - paneGap * (node.children.length - 1), node.weights, minimum);
    let cursor = rect[coordinate];
    node.children.forEach((child, index) => {
      const area = { ...rect, [coordinate]: cursor, [dimension]: sizes[index] };
      visit(child, area);
      cursor += sizes[index];
      if (index < sizes.length - 1) {
        const pair = { ...area, [dimension]: sizes[index] + paneGap + sizes[index + 1] };
        const usable = sizes[index] + sizes[index + 1];
        dividers.push({ ...rect, [coordinate]: cursor, [dimension]: paneGap, split: node.id, index, axis: node.axis, fraction: sizes[index] / usable, pair, min: minimum[index] / usable, max: 1 - minimum[index + 1] / usable });
        cursor += paneGap;
      }
    });
  };
  visit(tree, { x: 0, y: 0, width, height });
  return { stacks, dividers, compact };
}
export function neighborPane(stacks: StackRect[], id: string, direction: Direction): string | null {
  const current = stacks.find((stack) => stack.tabs.includes(id));
  if (!current) return null;
  const horizontal = direction === "left" || direction === "right";
  const primary = horizontal ? "x" : "y", secondary = horizontal ? "y" : "x";
  const size = horizontal ? "width" : "height", otherSize = horizontal ? "height" : "width";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const center = current[primary] + current[size] / 2, cross = current[secondary] + current[otherSize] / 2;
  return stacks.filter((stack) => stack !== current && sign * (stack[primary] + stack[size] / 2 - center) > 1)
    .map((stack) => ({ id: stack.active, score: Math.abs(stack[primary] + stack[size] / 2 - center) + 2 * Math.abs(stack[secondary] + stack[otherSize] / 2 - cross) }))
    .sort((a, b) => a.score - b.score)[0]?.id ?? null;
}

export function parseTree(value: unknown): PaneNode | null | undefined {
  const nodes = new Set<string>(), panes = new Set<string>();
  let count = 0;
  const identifier = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length < 256 && /^[a-zA-Z0-9:_-]+$/.test(id);
  const parse = (input: unknown, depth: number): PaneNode => {
    if (!input || typeof input !== "object" || depth > 24 || ++count > 512) throw new Error("Invalid pane tree");
    const node = input as Record<string, unknown>;
    if (!identifier(node.id) || nodes.has(node.id)) throw new Error("Invalid node identity");
    nodes.add(node.id);
    if (node.type === "stack") {
      if (!Array.isArray(node.tabs) || !node.tabs.length || node.tabs.length > 256 || !identifier(node.active)) throw new Error("Invalid tabs");
      const ids: string[] = [];
      for (const id of node.tabs) {
        if (!identifier(id) || panes.has(id) || panes.size >= 256) throw new Error("Invalid pane identity");
        panes.add(id); ids.push(id);
      }
      if (!ids.includes(node.active)) throw new Error("Invalid active tab");
      return { type: "stack", id: node.id, tabs: ids, active: node.active };
    }
    if (node.type !== "split" || !["x", "y"].includes(String(node.axis)) || !Array.isArray(node.children) || node.children.length < 2 || node.children.length > 256 || !Array.isArray(node.weights) || node.weights.length !== node.children.length || !node.weights.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1)) throw new Error("Invalid split");
    const total = node.weights.reduce((a: number, b: number) => a + b, 0);
    if (Math.abs(total - 1) > 0.000001) throw new Error("Invalid proportions");
    return { type: "split", id: node.id, axis: node.axis as "x" | "y", children: node.children.map((child) => parse(child, depth + 1)), weights: [...node.weights] as number[] };
  };
  if (value === null) return null;
  try { return parse(value, 0); } catch { return undefined; }
}
