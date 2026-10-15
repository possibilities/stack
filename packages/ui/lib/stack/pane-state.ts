import { activatePane, filterTree, paneAnchor, paneIds, parseTree, placePane, removePane, resizeSplit, swapPanes, tabs, tabStacks, type PaneNode, type Placement } from "./pane-layout";
import type { PanePreset } from "./pane-presets";

type Anchor = { neighbor: string; side: Placement };
export type PaneLayout = {
  preset: string; tree: PaneNode | null; closed: string[]; focus: string | null; zoom: string | null;
  anchors: Record<string, Anchor>; modified: boolean; canUndo: boolean; warning: string | null;
};
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export class PaneLayoutStore {
  private state: PaneLayout;
  private readonly serverState: PaneLayout;
  private available: string[];
  private storage: Storage | null = null;
  private attached = new WeakSet<Storage>();
  private writable = true;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private previous: PaneLayout | null = null;
  private listeners = new Set<() => void>();
  private readonly key: string;
  private readonly presets: PanePreset[];

  constructor(space: string, presets: PanePreset[], available: readonly string[]) {
    this.key = `uix.panes.v1.${space}`;
    this.presets = presets;
    this.available = [...available];
    this.state = this.fromPreset(presets[0]);
    this.serverState = this.state;
  }
  getSnapshot = () => this.state;
  getServerSnapshot = () => this.serverState;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  attach(storage: Storage | null): void {
    if (this.storage === storage) return;
    this.flush();
    this.storage = storage;
    if (!storage) return;
    if (this.attached.has(storage)) { this.schedule(); return; }
    this.attached.add(storage);
    this.writable = true;
    try {
      const raw = storage.getItem(this.key);
      if (raw !== null) {
        if (raw.length > 200_000) throw new Error("Invalid layout");
        const saved = JSON.parse(raw);
        if (saved?.version !== 1) {
          this.writable = false;
          this.update({ ...this.state, warning: "Saved layout uses another version. Choose a preset to replace it." }, false);
          return;
        }
        const tree = parseTree(saved.tree);
        if (tree === undefined || !Array.isArray(saved.closed) || saved.closed.length > 256 || !saved.closed.every((id: unknown) => typeof id === "string" && id.length < 256) || !this.presets.some((preset) => preset.id === saved.preset)) throw new Error("Invalid layout");
        const anchors: Record<string, Anchor> = {};
        for (const id of this.available) {
          const anchor = saved.anchors?.[id];
          if (anchor && this.available.includes(anchor.neighbor) && ["left", "right", "above", "below", "tab"].includes(anchor.side)) anchors[id] = { neighbor: anchor.neighbor, side: anchor.side };
        }
        const open = paneIds(tree);
        if (new Set([...open, ...saved.closed]).size !== open.length + saved.closed.length) throw new Error("Duplicate panes");
        this.state = { preset: saved.preset, tree, closed: saved.closed, anchors, focus: typeof saved.focus === "string" ? saved.focus : null, zoom: null, modified: saved.modified === true, canUndo: false, warning: null };
        this.reconcile();
      }
      this.update(this.state);
    } catch {
      this.writable = false;
      this.update({ ...this.state, warning: "This browser could not restore the layout. Choose a preset to replace the saved layout." }, false);
    }
  }
  configure(ids: readonly string[]): void {
    if (ids.length === this.available.length && ids.every((id, index) => id === this.available[index])) return;
    this.available = [...ids];
    this.reconcile();
    this.update(this.state);
  }
  private reconcile(): void {
    const allowed = new Set(this.available);
    let tree = filterTree(this.state.tree, allowed);
    const closed = this.state.closed.filter((id) => allowed.has(id));
    const held = new Set([...paneIds(tree), ...closed]);
    for (const id of this.available) if (!held.has(id)) tree = placePane(tree, id, paneIds(tree)[0] ?? null, "tab");
    if (!tree && this.available.length) {
      const id = closed.shift() ?? this.available[0];
      tree = tabs(id);
    }
    const open = paneIds(tree);
    const focus = this.state.focus && open.includes(this.state.focus) ? this.state.focus : tabStacks(tree)[0]?.active ?? null;
    this.state = { ...this.state, tree: activatePane(tree, focus ?? ""), closed, focus, zoom: this.state.zoom && open.includes(this.state.zoom) ? this.state.zoom : null,
      anchors: Object.fromEntries(Object.entries(this.state.anchors).filter(([id, anchor]) => allowed.has(id) && allowed.has(anchor.neighbor))) };
  }
  private fromPreset(preset: PanePreset): PaneLayout {
    const tree = preset.build(this.available) ?? (this.available[0] ? tabs(this.available[0]) : null);
    const open = new Set(paneIds(tree));
    return { preset: preset.id, tree, closed: this.available.filter((id) => !open.has(id)), focus: tabStacks(tree)[0]?.active ?? null, zoom: null, anchors: {}, modified: false, canUndo: false, warning: null };
  }
  preset(id: string): void {
    const preset = this.presets.find((preset) => preset.id === id);
    if (!preset) return;
    this.writable = true;
    this.update(this.fromPreset(preset));
  }
  focus(id: string): void {
    if (!this.available.includes(id)) return;
    if (!paneIds(this.state.tree).includes(id)) { this.open(id); return; }
    const tree = activatePane(this.state.tree, id);
    const zoom = this.state.zoom && this.state.zoom !== id ? null : this.state.zoom;
    if (this.state.focus === id && tree === this.state.tree && zoom === this.state.zoom) return;
    this.update({ ...this.state, tree, focus: id, zoom });
  }
  open(id: string, side?: Placement, target = this.state.focus): void {
    if (!this.available.includes(id)) return;
    if (paneIds(this.state.tree).includes(id)) { this.focus(id); return; }
    const anchor = this.state.anchors[id];
    const open = paneIds(this.state.tree);
    if (!side && anchor && open.includes(anchor.neighbor)) { target = anchor.neighbor; side = anchor.side; }
    if (!target || !open.includes(target)) target = open[0] ?? null;
    const tree = placePane(this.state.tree, id, target, side ?? "right");
    this.update({ ...this.state, tree, closed: this.state.closed.filter((pane) => pane !== id), focus: id, zoom: null, modified: true });
  }
  close(id: string): void {
    const open = paneIds(this.state.tree);
    if (open.length < 2 || !open.includes(id)) return;
    const before = this.state, anchor = paneAnchor(before.tree, id), tree = removePane(before.tree, id);
    const focus = before.focus !== id ? before.focus : tabStacks(tree)[0]?.active ?? null;
    this.update({ ...before, tree, closed: [...before.closed, id], focus, zoom: before.zoom === id ? null : before.zoom, modified: true, anchors: { ...before.anchors, ...(anchor ? { [id]: anchor } : {}) } }, true, before);
  }
  undo(): void { if (this.previous) this.update(this.previous); }
  move(id: string, target: string, side: Placement): void {
    if (!this.available.includes(id) || !paneIds(this.state.tree).includes(target)) return;
    const tree = placePane(this.state.tree, id, target, side);
    if (tree !== this.state.tree) this.update({ ...this.state, tree, closed: this.state.closed.filter((pane) => pane !== id), focus: id, zoom: null, modified: true });
  }
  swap(a: string, b: string): void {
    const tree = swapPanes(this.state.tree, a, b);
    if (tree !== this.state.tree) this.update({ ...this.state, tree, modified: true });
  }
  resize(id: string, index: number, fraction: number): void {
    if (!this.state.tree) return;
    const tree = resizeSplit(this.state.tree, id, index, fraction);
    if (tree !== this.state.tree) this.update({ ...this.state, tree, modified: true });
  }
  zoom(id = this.state.focus): void {
    if (!id || !paneIds(this.state.tree).includes(id)) return;
    this.update({ ...this.state, tree: activatePane(this.state.tree, id), focus: id, zoom: this.state.zoom === id ? null : id });
  }
  flush = (): void => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || !this.storage || !this.writable) return;
    this.dirty = false;
    let warning: string | null = null;
    try {
      const { preset, tree, closed, anchors, focus, modified } = this.state;
      this.storage.setItem(this.key, JSON.stringify({ version: 1, preset, tree, closed, anchors, focus, modified }));
    } catch { warning = "This browser could not save the layout. Changes are kept in this page only."; }
    if (warning !== this.state.warning) {
      this.state = { ...this.state, warning };
      for (const listener of this.listeners) listener();
    }
  };
  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = this.dirty && this.storage && this.writable ? setTimeout(this.flush, 250) : null;
  }
  private update(next: PaneLayout, persist = true, undo: PaneLayout | null = null): void {
    this.previous = undo;
    this.state = { ...next, warning: persist ? this.state.warning : next.warning, canUndo: undo !== null };
    if (persist) { this.dirty = true; this.schedule(); }
    for (const listener of this.listeners) listener();
  }
}
