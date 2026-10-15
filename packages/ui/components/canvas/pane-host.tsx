"use client";

import { Activity, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PanelsTopLeftIcon, RotateCcwIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { homeOf, spaceTitle, type SpaceId } from "@/lib/stack/spaces";
import { nodeKey, type NodeRef } from "@/lib/stack/types";
import { neighborPane, paneGap, paneIds, projectLayout, resizeSplit, tabs, type Direction, type Divider, type PaneNode, type Placement, type StackRect } from "@/lib/stack/pane-layout";
import { panePresets } from "@/lib/stack/pane-presets";
import { PaneLayoutStore, type PaneLayout } from "@/lib/stack/pane-state";
import { cn } from "@/lib/utils";
import { useChatWindows, useDestination, useProcWindows, useStack, useViewerWindows, useWorkerWindows } from "./provider";
import { paneDefinitions, paneRegistryReady, type WindowDef } from "./spaces";
import { PlacementContext, type WindowPlacement } from "./window";
import { PaneContext } from "./pane-context";
import { PaneCatalog } from "./pane-catalog";

export type PaneControls = {
  space: SpaceId; layout: PaneLayout; panes: { id: string; title: string }[];
  goToNode(ref: NodeRef): void; catalog(): void; preset(id: string): void; zoom(): void; reveal(id: string, focus?: boolean): void; undo(): void;
};
type Drop = { target: string; side: Placement; rect: StackRect };
const noop = () => {};
const excluded = 'input,textarea,select,[contenteditable=true],[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=combobox],[role=separator],[role=tablist]';

export function PaneHost({ space, blocked, onControls, onArrive }: {
  space: SpaceId; blocked: boolean; onControls(controls: PaneControls | null): void; onArrive(ref: NodeRef): void;
}) {
  const state = useStack();
  const { windows: chats, chats: chatStore } = useChatWindows();
  const { windows: workers, workerWindows } = useWorkerWindows();
  const { windows: viewers, viewers: viewerStore } = useViewerWindows();
  const { windows: procRuns, procWindows } = useProcWindows();
  const defs = paneDefinitions(space, state, { chats, workers, viewers, procRuns });
  const registryReady = paneRegistryReady(space, state);
  const signature = JSON.stringify(defs.map((def) => def.id));
  const minimums = useMemo(() => Object.fromEntries(defs.map((def) => [def.id, def.minimum])), [signature]);
  const ids: string[] = useMemo(() => JSON.parse(signature), [signature]);
  const [store] = useState(() => new PaneLayoutStore(space, panePresets[space], ids));
  const layout = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const { local, restored } = useDestination();
  const instancesRestored = restored && chats === chatStore.getWindows() && workers === workerWindows.getWindows() && viewers === viewerStore.getWindows() && procRuns === procWindows.getWindows();
  const viewport = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [catalog, setCatalog] = useState<{ side?: Placement } | null>(null);
  const [draft, setDraft] = useState<PaneNode | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragging, setDragging] = useState(false);
  const [leader, setLeader] = useState(false);
  const [help, setHelp] = useState(false);
  const cancelGesture = useRef<(() => void) | null>(null);
  const pending = useRef<{ ref: NodeRef; pane: string; token: number; notified: boolean; placed: boolean; side?: Placement; target: string | null } | null>(null);
  const sequence = useRef(0);
  const [navigation, setNavigation] = useState(0);
  const frame = useRef<number | null>(null);
  const visited = useRef(new Set<string>());

  useLayoutEffect(() => { if (registryReady) store.configure(ids); }, [store, ids, registryReady]);
  useEffect(() => {
    if (!instancesRestored || !registryReady || !local) return;
    store.attach(local);
    const hidden = () => { if (document.visibilityState === "hidden") store.flush(); };
    window.addEventListener("pagehide", store.flush);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", store.flush); document.removeEventListener("visibilitychange", hidden); store.attach(null); };
  }, [store, instancesRestored, registryReady, local]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth && element.clientHeight) setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => {
    cancelGesture.current?.(); pending.current = null; sequence.current++;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);
  useEffect(() => { cancelGesture.current?.(); }, [signature, size.width, size.height, blocked]);
  useEffect(() => { if (blocked || catalog) setLeader(false); }, [blocked, catalog]);
  useEffect(() => { if (leader) { const timer = setTimeout(() => setLeader(false), 2500); return () => clearTimeout(timer); } }, [leader]);

  const tree = draft ?? layout.tree;
  const projection = useMemo(() => {
    if (layout.zoom && paneIds(tree).includes(layout.zoom)) return projectLayout(tabs(layout.zoom), size, layout.zoom, minimums);
    return projectLayout(tree, size, layout.focus, minimums);
  }, [tree, size, layout.zoom, layout.focus, minimums]);
  const current = useRef({ projection, layout, ids });
  useLayoutEffect(() => { current.current = { projection, layout, ids }; });
  const focusFrame = useCallback((id: string, preserve = false) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const pane = root.current?.querySelector<HTMLElement>(`[data-pane-frame="${CSS.escape(id)}"]`);
      if (pane && (!preserve || !pane.contains(document.activeElement))) pane.focus({ preventScroll: true });
      frame.current = null;
    });
  }, []);
  const reveal = useCallback((id: string, focus = true) => {
    const focused = document.activeElement?.closest<HTMLElement>("[data-pane-frame]")?.dataset.paneFrame;
    const { projection } = current.current;
    const replacesFocus = focused !== id && (projection.compact || projection.stacks.some((stack) => stack.tabs.includes(id) && stack.tabs.includes(focused ?? "")));
    pending.current = null; store.focus(id);
    if (focus || replacesFocus) focusFrame(id, !focus);
  }, [store, focusFrame]);
  const showCatalog = useCallback((side?: Placement) => setCatalog({ side }), []);
  const goToNode = useCallback((ref: NodeRef, side?: Placement) => {
    const home = homeOf(ref);
    if (home.kind !== "space" || home.space !== space) return;
    pending.current = { ref, pane: home.window, token: ++sequence.current, notified: false, placed: false, side, target: store.getSnapshot().focus };
    setNavigation(sequence.current);
    setCatalog(null);
  }, [space, store]);
  useEffect(() => {
    const request = pending.current;
    if (!request || !ids.includes(request.pane)) return;
    if (!request.placed) {
      request.placed = true;
      if (request.side && request.target && paneIds(store.getSnapshot().tree).includes(request.target)) store.move(request.pane, request.target, request.side);
      else store.open(request.pane);
    }
    const rootElement = root.current;
    if (!rootElement) return;
    let done = false;
    const arrive = () => {
      if (done || pending.current !== request || request.token !== sequence.current) return;
      const pane = rootElement.querySelector<HTMLElement>(`[data-pane-frame="${CSS.escape(request.pane)}"]`);
      if (!pane || pane.hidden) return;
      if (!request.notified) { request.notified = true; onArrive(request.ref); }
      const node = pane.querySelector<HTMLElement>(`[data-node="${CSS.escape(nodeKey(request.ref))}"]`);
      if (!node) return;
      for (let parent = node.parentElement; parent && parent !== pane; parent = parent.parentElement) {
        if (parent.hasAttribute("data-scroll")) {
          const a = node.getBoundingClientRect(), b = parent.getBoundingClientRect();
          parent.scrollTop += a.top - b.top - Math.max(0, (b.height - a.height) / 2);
        }
      }
      done = true; pending.current = null; focusFrame(request.pane);
    };
    const observer = new MutationObserver(arrive);
    observer.observe(rootElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "data-node"] });
    const timer = setTimeout(() => { if (pending.current === request) { pending.current = null; focusFrame(request.pane); } observer.disconnect(); }, 5000);
    const raf = requestAnimationFrame(arrive);
    return () => { observer.disconnect(); clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [layout.tree, navigation, ids, store, onArrive, focusFrame]);

  const controls = useMemo<PaneControls>(() => ({ space, layout, panes: defs.map(({ id, title }) => ({ id, title })), goToNode, catalog: showCatalog, preset: (id) => store.preset(id), zoom: () => store.zoom(), reveal, undo: () => store.undo() }), [space, layout, signature, goToNode, showCatalog, store, reveal]);
  useEffect(() => { onControls(controls); return () => onControls(null); }, [controls, onControls]);

  const key = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || blocked || catalog || !(event.target instanceof Element) || event.target.closest(excluded) || !root.current?.contains(event.target)) return;
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "b") { event.preventDefault(); setLeader((value) => !value); return; }
    if (event.metaKey || event.ctrlKey) return;
    const direction = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as Record<string, Direction>)[event.key];
    if (event.altKey && direction && layout.focus) {
      const next = neighborPane(projection.stacks, layout.focus, direction);
      if (next) { if (event.shiftKey) store.swap(layout.focus, next); else reveal(next); }
      event.preventDefault(); return;
    }
    if (event.altKey || (!leader && event.target.closest("button,a"))) return;
    const index = leader && /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
    if (index >= 0) { if (projection.stacks[index]) reveal(projection.stacks[index].active); setLeader(false); event.preventDefault(); return; }
    if (event.key === "Escape" && dragging) cancelGesture.current?.();
    else if (event.key === "Escape" && leader) setLeader(false);
    else if ((event.key === "Escape" && layout.zoom) || event.key === "z") store.zoom();
    else if (event.key === "?") setHelp(true);
    else if (event.key === "x" && layout.focus) { store.close(layout.focus); const id = store.getSnapshot().focus; if (id) focusFrame(id); }
    else if (event.key === "\\" || event.key === "%") showCatalog("right");
    else if (event.key === "-" || event.key === '"') showCatalog("below");
    else return;
    event.preventDefault(); setLeader(false);
  };

  const beginDrag = useCallback((id: string, event: React.PointerEvent) => {
    const interactive = (event.target as Element).closest("button,a,input,select,textarea,[data-interactive],[tabindex]");
    if (event.button !== 0 || !event.currentTarget.contains(event.target as Node) || (interactive && event.currentTarget.contains(interactive))) return;
    const host = viewport.current;
    if (!host) return;
    cancelGesture.current?.();
    const origin = host.getBoundingClientRect(), start = { x: event.clientX, y: event.clientY }, pointer = event.pointerId;
    const handle = event.currentTarget;
    let active = false, target: Drop | null = null;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!active && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      active = true; setDragging(true);
      const x = e.clientX - origin.left, y = e.clientY - origin.top;
      const rect = current.current.projection.stacks.find((s) => s.active !== id && x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);
      if (rect) {
        const rx = (x - rect.x) / rect.width, ry = (y - rect.y) / rect.height;
        const side: Placement = rx < 0.25 ? "left" : rx > 0.75 ? "right" : ry < 0.25 ? "above" : ry > 0.75 ? "below" : "tab";
        target = { target: rect.active, side, rect };
      } else target = null;
      setDrop(target);
    };
    const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", escape); if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer); setDragging(false); setDrop(null); cancelGesture.current = null; };
    const cancel = () => cleanup();
    const up = (e: PointerEvent) => { if (e.pointerId !== pointer) return; const next = target; cleanup(); if (active && next) { store.move(id, next.target, next.side); focusFrame(id); } };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cleanup(); } };
    handle.setPointerCapture(pointer);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("keydown", escape);
    cancelGesture.current = cleanup;
  }, [store, focusFrame]);

  const resize = (divider: Divider, event: React.PointerEvent) => {
    if (event.button !== 0 || !layout.tree || !viewport.current) return;
    event.preventDefault(); cancelGesture.current?.();
    const origin = viewport.current.getBoundingClientRect(), handle = event.currentTarget, pointer = event.pointerId, before = layout.tree;
    const dimension = divider.axis === "x" ? "width" : "height";
    let fraction = divider.fraction, raf: number | null = null;
    const clamp = (value: number) => Math.max(divider.min, Math.min(divider.max, value));
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      fraction = clamp(((divider.axis === "x" ? e.clientX - origin.left : e.clientY - origin.top) - divider.pair[divider.axis] - paneGap / 2) / (divider.pair[dimension] - paneGap));
      if (raf === null) raf = requestAnimationFrame(() => { setDraft(resizeSplit(before, divider.split, divider.index, fraction)); raf = null; });
    };
    const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", escape); if (raf !== null) cancelAnimationFrame(raf); if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer); setDraft(null); setDragging(false); cancelGesture.current = null; };
    const cancel = () => cleanup();
    const up = (e: PointerEvent) => { if (e.pointerId === pointer) { cleanup(); store.resize(divider.split, divider.index, fraction); } };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cleanup(); } };
    handle.setPointerCapture(pointer); setDragging(true);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("keydown", escape);
    cancelGesture.current = cleanup;
  };

  const pin = space === "fleet" ? { title: "Pin another chat", create: (side?: Placement) => goToNode({ kind: "chat", id: chatStore.open(null) }, side) }
    : space === "workers" ? { title: "Pin another Worker", create: (side?: Placement) => goToNode({ kind: "worker-window", id: workerWindows.open(null) }, side) }
    : space === "browse" ? { title: "Pin another viewer", create: (side?: Placement) => goToNode({ kind: "browser-viewer", id: viewerStore.open(null) }, side) }
    : space === "proc" ? { title: "Pin another run", create: (side?: Placement) => goToNode({ kind: "proc-run-window", id: procWindows.open(null) }, side) } : undefined;
  const open = paneIds(layout.tree);
  const renderPane = (def: WindowDef, rect?: StackRect) => {
    const visible = Boolean(rect && rect.active === def.id);
    if (visible) visited.current.add(def.id);
    const tabHeight = rect && rect.tabs.length > 1 ? 34 : 0;
    const placement: WindowPlacement = { x: 0, y: 0, z: 0, width: rect?.width ?? 0, height: (rect?.height ?? 0) - tabHeight, sized: true, collapsed: false, animating: false, dragging, active: false, settling: false, target: null,
      onHeaderPointerDown: (event) => beginDrag(def.id, event), onResizePointerDown: noop, onResetSize: noop, onFocusWithin: () => store.focus(def.id), onToggleCollapse: noop, register: noop };
    const pane = { visible, focused: layout.focus === def.id, zoomed: layout.zoom === def.id, canClose: open.length > 1,
      destinations: defs.filter((other) => other.id !== def.id && open.includes(other.id)).map(({ id, title }) => ({ id, title: `${title}${/-\d+$/.test(id) ? ` · ${id}` : ""}` })),
      close: () => { store.close(def.id); const focus = store.getSnapshot().focus; if (focus) focusFrame(focus); }, zoom: () => { store.zoom(def.id); focusFrame(def.id); },
      catalog: (side: Placement) => { store.focus(def.id); showCatalog(side); }, move: (target: string, side: Placement) => { store.move(def.id, target, side); focusFrame(def.id); } };
    return <div key={`pane:${def.id}`} id={`pane-${def.id}`} data-pane-frame={def.id} tabIndex={visible ? 0 : -1} role={rect && rect.tabs.length > 1 ? "tabpanel" : "region"} aria-label={def.title} aria-labelledby={rect && rect.tabs.length > 1 ? `pane-tab-${def.id}` : undefined}
      hidden={!visible} inert={!visible} onFocusCapture={() => { if (visible) store.focus(def.id); }}
      className="absolute min-h-0 min-w-0 rounded-xl outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      style={rect ? { left: rect.x, top: rect.y + tabHeight, width: rect.width, height: Math.max(0, rect.height - tabHeight) } : undefined}>
      {leader && visible ? <span aria-hidden className="pointer-events-none absolute top-1 right-1 z-20 rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">{projection.stacks.indexOf(rect!) + 1}</span> : null}
      <PaneContext value={pane}><PlacementContext value={() => placement}><Activity mode={visible ? "visible" : "hidden"}>{visited.current.has(def.id) ? def.element : null}</Activity></PlacementContext></PaneContext>
    </div>;
  };
  const tiles: React.ReactNode[] = [];
  for (const rect of projection.stacks) {
    if (rect.tabs.length > 1) tiles.push(<div key={`tabs:${rect.id}`} role="tablist" aria-label="Pane tabs" className="absolute flex items-center gap-1 overflow-x-auto rounded-t-xl bg-muted/50 px-1" style={{ left: rect.x, top: rect.y, width: rect.width, height: 32 }}>
      {rect.tabs.map((id, index) => <button key={id} id={`pane-tab-${id}`} type="button" role="tab" aria-selected={rect.active === id} aria-controls={`pane-${id}`} tabIndex={rect.active === id ? 0 : -1}
        className={cn("shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring", rect.active === id && "bg-card text-foreground shadow-sm")}
        onClick={() => store.focus(id)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % rect.tabs.length : event.key === "ArrowLeft" ? (index + rect.tabs.length - 1) % rect.tabs.length : event.key === "Home" ? 0 : event.key === "End" ? rect.tabs.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); store.focus(rect.tabs[next]); document.getElementById(`pane-tab-${rect.tabs[next]}`)?.focus(); }
        }}>{defs.find((def) => def.id === id)?.title ?? id}{/-\d+$/.test(id) ? ` · ${id.split("-").at(-1)}` : ""}</button>)}
    </div>);
    for (const id of rect.tabs) { const def = defs.find((def) => def.id === id); if (def) tiles.push(renderPane(def, rect)); }
  }
  const projected = new Set(projection.stacks.flatMap((rect) => rect.tabs));
  for (const def of defs) if (!projected.has(def.id)) tiles.push(renderPane(def));

  const cancelArrival = () => {
    if (pending.current) { pending.current = null; setNavigation(++sequence.current); }
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
  };
  return <main ref={root} onPointerDownCapture={cancelArrival} onKeyDownCapture={cancelArrival} onKeyDown={key} data-canvas="workbench" data-space={space} tabIndex={-1} aria-label={`${spaceTitle(space)} panes`} className="fixed top-16 bottom-0 flex min-h-0 min-w-0 flex-col px-2 pb-2 outline-none" style={{ left: "var(--rail, 0px)", right: "var(--sheet, 0px)", bottom: "var(--call-height, 0px)" }}>
    <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 pb-2" data-chrome>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto"><ToggleGroup size="sm" spacing={0} aria-label={`${spaceTitle(space)} layout preset`} value={[layout.preset]} onValueChange={(values) => { if (values[0]) store.preset(String(values[0])); }}>
        {panePresets[space].map((preset) => <ToggleGroupItem key={preset.id} value={preset.id}>{preset.title}</ToggleGroupItem>)}
      </ToggleGroup>{layout.modified ? <span className="text-xs text-muted-foreground">Modified</span> : null}</div>
      <div className="flex items-center gap-1">
        {layout.canUndo ? <Button variant="ghost" size="sm" onClick={() => store.undo()}><Undo2Icon data-icon="inline-start" />Undo close</Button> : null}
        {layout.zoom ? <Button variant="outline" size="sm" onClick={() => store.zoom()}>Restore panes</Button> : null}
        <Button variant="ghost" size="icon-sm" aria-label="Reset pane layout" onClick={() => store.preset(layout.preset)}><RotateCcwIcon /></Button>
        <Button variant="outline" size="sm" onClick={() => showCatalog()}><PanelsTopLeftIcon data-icon="inline-start" />Panes{layout.closed.length ? <Badge variant="secondary">{layout.closed.length} closed</Badge> : null}</Button>
      </div>
    </div>
    {layout.warning ? <p role="status" className="pb-2 text-xs text-warning">{layout.warning}</p> : null}
    <div ref={viewport} className="relative min-h-0 flex-1" data-pane-viewport>
      {tiles}
      {!defs.length ? <p role="status" className="p-8 text-sm text-muted-foreground">No panes are available in this space.</p> : null}
      {projection.dividers.map((divider) => <div key={`${divider.split}:${divider.index}`} role="separator" tabIndex={0} aria-label="Resize pane split" aria-orientation={divider.axis === "x" ? "vertical" : "horizontal"} aria-valuenow={Math.round(divider.fraction * 100)} aria-valuemin={Math.round(divider.min * 100)} aria-valuemax={Math.round(divider.max * 100)}
        className={cn("absolute touch-none rounded-md hover:bg-ring/30 focus-visible:bg-ring/30 focus-visible:outline-2 focus-visible:outline-ring", divider.axis === "x" ? "cursor-col-resize" : "cursor-row-resize")}
        style={{ left: divider.x, top: divider.y, width: divider.width, height: divider.height }} onPointerDown={(event) => resize(divider, event)} onDoubleClick={() => store.resize(divider.split, divider.index, Math.max(divider.min, Math.min(divider.max, 0.5)))} onKeyDown={(event) => {
          const delta = (divider.axis === "x" ? { ArrowLeft: -0.03, ArrowRight: 0.03 } : { ArrowUp: -0.03, ArrowDown: 0.03 })[event.key as "ArrowLeft"];
          if (delta || event.key === "Home") { event.preventDefault(); store.resize(divider.split, divider.index, Math.max(divider.min, Math.min(divider.max, event.key === "Home" ? 0.5 : divider.fraction + (delta ?? 0)))); }
        }} />)}
      {drop ? <div aria-hidden className="pointer-events-none absolute rounded-xl border-2 border-ring bg-ring/15" style={{ left: drop.rect.x + (drop.side === "right" ? drop.rect.width / 2 : 0), top: drop.rect.y + (drop.side === "below" ? drop.rect.height / 2 : 0), width: drop.rect.width / (["left", "right"].includes(drop.side) ? 2 : 1), height: drop.rect.height / (["above", "below"].includes(drop.side) ? 2 : 1) }} /> : null}
    </div>
    <div className="flex min-h-7 shrink-0 items-center justify-between gap-2 pt-1 text-[0.65rem] text-muted-foreground"><span>{projection.compact ? "Compact · desktop layout retained" : `${open.length} open · ${defs.length} available`}</span><span className="hidden md:inline">{leader ? "1–9 focus · Z zoom · X close · \\ beside · − below · Esc cancel" : "⌥ arrows focus · Z zoom · ⌃B pane keys"}</span><Button variant="ghost" size="xs" aria-label="Pane keyboard shortcuts" onClick={() => setHelp(true)}>Keys</Button></div>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent finalFocus={() => root.current}><DialogHeader><DialogTitle>Pane keyboard shortcuts</DialogTitle><DialogDescription>Use these in the workspace, not while typing or using a dialog. Every arrangement also has a pane menu.</DialogDescription></DialogHeader><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      <dt>Option + arrows</dt><dd>Focus a neighboring pane</dd><dt>Option + Shift + arrows</dt><dd>Swap neighboring panes</dd><dt>Ctrl B, then 1–9</dt><dd>Focus a numbered pane; expires after 2.5 seconds</dd><dt>Z / Escape</dt><dd>Zoom / restore the focused pane</dd><dt>X</dt><dd>Close the focused pane; keep at least one open</dd><dt>\ / −</dt><dd>Open the catalog beside / below</dd><dt>Arrows / Home</dt><dd>Resize / equalize a focused separator</dd><dt>O / Cmd or Ctrl K</dt><dd>Space overview / command palette</dd><dt>Escape</dt><dd>Cancel a gesture or leader first</dd>
    </dl></DialogContent></Dialog>
    {catalog ? <PaneCatalog key={catalog.side ?? "restore"} title={spaceTitle(space)} defs={defs} layout={layout} visible={projection.stacks.map((stack) => stack.active)} store={store} side={catalog.side} onClose={() => setCatalog(null)} onReveal={focusFrame} pin={pin} /> : null}
  </main>;
}
