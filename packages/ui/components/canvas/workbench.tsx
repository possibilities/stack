"use client";

import { Activity, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookOpenIcon, ChevronDownIcon, LayersIcon, LayoutDashboardIcon, MinusIcon, PanelRightIcon, PlusIcon, ScanIcon, SearchIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activeSurface, dockGeometry, dockMinimum, type BenchSurface } from "@/lib/stack/geometry";
import { emptyLocation, locationHref, navigateTo, parseLocation, type BenchLocation } from "@/lib/stack/navigation";
import { homeOf, spaceAttention, spaceHref, spaces, spaceTitle, type SpaceId } from "@/lib/stack/spaces";
import { nodeKey, type NodeRef, type Snapshot } from "@/lib/stack/types";
import { AuthActionsProvider } from "./auth-actions";
import { BotActionsProvider } from "./bot-actions";
import { Dock, useDockSizes, useInspectorPin } from "./dock";
import { Inspector } from "./inspector";
import { Palette, type PaletteAction } from "./palette";
import { StackProvider, useStack, WorkbenchContext, type WorkbenchValue } from "./provider";
import { Reference } from "./reference";
import { NotifyActionsProvider } from "./notify-actions";
import { RoleActionsProvider } from "./role-actions";
import { ShimActionsProvider } from "./role-shims";
import { ContentActionsProvider } from "./content-actions";
import { Bench, type BenchControls } from "./bench";
import { PaneHost, type PaneControls } from "./pane-host";
import { SpaceBar, SpaceOverview, SpaceRail } from "./space-chrome";
import { panePresets } from "@/lib/stack/pane-presets";
import { CallLauncher, VoiceProvider } from "./voice";

const paneSpaces = new Set<SpaceId>(["hud", "fleet", "workers", "browse", "proc", "accounts", "lab", "inbox", "roles", "content", "signal", "brain", "scrape", "source", "system"]);

export function Workbench({ snapshot, initialSpace, initialFocus, initialLocation }: { snapshot: Snapshot; initialSpace: SpaceId; initialFocus: NodeRef | null; initialLocation?: BenchLocation }) {
  const start = initialLocation ?? (initialFocus ? navigateTo(emptyLocation(initialSpace), initialFocus) : emptyLocation(initialSpace));
  return <StackProvider snapshot={snapshot}><Shell initialLocation={start} /></StackProvider>;
}

function Shell({ initialLocation }: { initialLocation: BenchLocation }) {
  const { remote } = useStack();
  const [location, setLocation] = useState(initialLocation);
  const locationRef = useRef(location);
  const referenceReturn = useRef<HTMLElement | null>(null);
  const inspectorReturn = useRef<HTMLElement | null>(null);
  const [hovered, hover] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ key: string; seq: number } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sequence = useRef(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [layouts, setLayouts] = useState<Partial<Record<SpaceId, PaneControls["layout"]>>>({});
  const [backLink, setBackLink] = useState<{ space: SpaceId; href: string } | null>(null);
  const [paneControls, setPaneControls] = useState<PaneControls | null>(null);
  const paneControlsRef = useRef<PaneControls | null>(null);
  const [controls, setControls] = useState<BenchControls | null>(null);
  const controlsRef = useRef<BenchControls | null>(null);
  const pending = useRef<{ space: SpaceId; ref: NodeRef | null; panes?: string[]; focus?: boolean } | null>({ space: initialLocation.space, ref: initialLocation.focus });
  const [scale, setScale] = useState(1);
  const [screenWidth, setScreenWidth] = useState(1200);
  const [sizes, setSizes] = useDockSizes();
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useInspectorPin();
  const [contracted, setContracted] = useState(false);
  const [surface, setSurface] = useState<BenchSurface>(() => activeSurface(undefined, openDocks(initialLocation)));
  const surfaceRef = useRef(surface);
  const benchFocusFrame = useRef<number | undefined>(undefined);
  const rightOpen = Boolean(location.reference || location.inspect);
  // Contraction retains the inspection and hides the dock; reference mode and overlay surfaces are exempt.
  const collapsed = contracted && !pinned && Boolean(location.inspect) && !location.reference;
  const railWidth = screenWidth < 640 ? 0 : screenWidth < 1100 ? 60 : 168;
  const { overlay, rightVisible, rightWidth, rightMax, right } = dockGeometry({
    screenWidth: screenWidth - railWidth, ...openDocks(location), surface,
    rightWidth: location.reference ? sizes.reference : sizes.inspector, expanded: expanded && Boolean(location.reference),
    contracted: collapsed,
  });

  useLayoutEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("surface");
    const initialSurface = activeSurface(requested, openDocks(initialLocation));
    if (requested === "bench") setContracted(true);
    surfaceRef.current = initialSurface;
    setSurface(initialSurface);
    setScreenWidth(window.innerWidth);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const update = () => setScreenWidth(window.innerWidth);
    update(); window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const flashNow = useCallback((ref: NodeRef) => {
    if (pending.current?.ref && nodeKey(pending.current.ref) === nodeKey(ref)) pending.current = null;
    setFlash({ key: nodeKey(ref), seq: ++sequence.current });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1400);
  }, []);
  useEffect(() => () => {
    clearTimeout(flashTimer.current);
    if (benchFocusFrame.current !== undefined) cancelAnimationFrame(benchFocusFrame.current);
  }, []);
  const focusBench = useCallback(() => {
    if (benchFocusFrame.current !== undefined) cancelAnimationFrame(benchFocusFrame.current);
    benchFocusFrame.current = requestAnimationFrame(() => {
      const canvas = document.querySelector<HTMLElement>(`[data-canvas=workbench][data-space="${locationRef.current.space}"]`);
      if (canvas && !canvas.contains(document.activeElement)) canvas.focus({ preventScroll: true });
      benchFocusFrame.current = undefined;
    });
  }, []);
  const reportControls = useCallback((next: BenchControls | null) => {
    controlsRef.current = next; setControls(next);
    if (next && pending.current?.space === next.space) {
      const target = pending.current;
      if (target.ref) next.goToNode(target.ref); else if (!target.panes) pending.current = null;
      // Space-only navigation restores that bench's independent camera.
    }
  }, []);
  const reportPanes = useCallback((next: PaneControls | null) => {
    setPaneControls(next); paneControlsRef.current = next;
    const target = pending.current;
    if (next && target?.space === next.space && target.panes && target.panes.every((id) => next.panes.some((pane) => pane.id === id))) {
      pending.current = null;
      for (const id of target.panes) next.reveal(id, target.focus);
    }
    if (next) setLayouts((held) => held[next.space] === next.layout ? held : { ...held, [next.space]: next.layout });
    reportControls(next ? {
      space: next.space, goToNode: next.goToNode, fit: () => { if (next.layout.zoom) next.zoom(); },
      tidy: () => next.preset(next.layout.preset), zoom: next.zoom,
    } : null);
  }, [reportControls]);
  const write = useCallback((next: BenchLocation, requestedSurface: BenchSurface = surfaceRef.current) => {
    const nextSurface = activeSurface(requestedSurface, openDocks(next));
    const url = new URL(locationHref(next), window.location.origin);
    url.searchParams.set("surface", nextSurface);
    const href = `${url.pathname}${url.search}`;
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.pushState(null, "", href);
    locationRef.current = next; setLocation(next);
    surfaceRef.current = nextSurface; setSurface(nextSurface);
    if (nextSurface === "right") setContracted(false);
    else if (!pinned) setContracted(true);
    document.title = `Stack · ${next.reference && nextSurface === "right" ? "API reference" : spaceTitle(next.space)}`;
  }, [pinned]);
  const setSpace = useCallback((space: SpaceId, pane?: string) => {
    pending.current = pane ? { space, ref: null, panes: [pane] } : null;
    setBackLink(null);
    write({ ...locationRef.current, space, focus: null }, "bench");
    focusBench();
    if (pane && paneControlsRef.current?.space === space) { pending.current = null; paneControlsRef.current.reveal(pane); }
  }, [focusBench, write]);
  const goTo = useCallback((ref: NodeRef) => {
    const home = homeOf(ref);
    if (home.kind === "reference" && !locationRef.current.reference) referenceReturn.current = document.activeElement as HTMLElement;
    if (home.kind === "reference" && !locationRef.current.reference && !locationRef.current.inspect) inspectorReturn.current = document.activeElement as HTMLElement;
    const from = locationRef.current.space;
    write(navigateTo(locationRef.current, ref), home.kind === "space" ? "bench" : "right");
    if (home.kind === "space" && home.space !== from) setBackLink({ space: from, href: `${window.location.pathname}${window.location.search}` });
    if (home.kind === "space") {
      if (controlsRef.current?.space === home.space) controlsRef.current.goToNode(ref);
      else pending.current = { space: home.space, ref };
      focusBench();
    }
  }, [focusBench, write]);
  const select = useCallback((ref: NodeRef | null) => {
    if (ref && homeOf(ref).kind === "reference") { goTo(ref); return; }
    if (ref && !locationRef.current.inspect && !locationRef.current.reference) inspectorReturn.current = document.activeElement as HTMLElement;
    write({ ...locationRef.current, inspect: ref, reference: null }, "right");
  }, [goTo, write]);
  // A removed record closes its inspection without disturbing an open reference.
  const dropInspect = useCallback((ref: NodeRef) => {
    const current = locationRef.current;
    if (current.inspect && nodeKey(current.inspect) === nodeKey(ref)) write({ ...current, inspect: null });
  }, [write]);
  const openReference = useCallback(() => {
    if (!locationRef.current.reference) referenceReturn.current = document.activeElement as HTMLElement;
    if (!locationRef.current.reference && !locationRef.current.inspect) inspectorReturn.current = document.activeElement as HTMLElement;
    write({ ...locationRef.current, reference: locationRef.current.reference ?? "overview" }, "right");
  }, [write]);
  const referenceOverview = useCallback(() => write({ ...locationRef.current, reference: "overview" }, "right"), [write]);
  const openInspector = useCallback(() => {
    if (!locationRef.current.inspect) return;
    inspectorReturn.current = document.activeElement as HTMLElement;
    write({ ...locationRef.current, reference: null }, "right");
  }, [write]);
  const closeRight = useCallback(() => {
    const current = locationRef.current;
    write(current.reference ? { ...current, reference: null } : { ...current, inspect: null });
    if (current.reference && current.inspect) requestAnimationFrame(() => {
      const target = referenceReturn.current;
      if (target?.isConnected && !target.closest("[inert],[hidden]")) target.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("[data-inspector-heading]")?.focus({ preventScroll: true });
    });
  }, [write]);

  useEffect(() => {
    const pop = () => {
      const query = new URLSearchParams(window.location.search);
      const next = parseLocation(window.location.pathname, query);
      if (!next) return;
      setBackLink(null);
      const previous = locationRef.current;
      locationRef.current = next; setLocation(next);
      const nextSurface = activeSurface(query.get("surface"), openDocks(next));
      surfaceRef.current = nextSurface; setSurface(nextSurface);
      if (nextSurface === "right") setContracted(false);
      else if (!pinned) setContracted(true);
      document.title = `Stack · ${next.reference && nextSurface === "right" ? "API reference" : spaceTitle(next.space)}`;
      // Dock/inspection history must never move the camera.
      if (nodeKeyOrNull(next.focus) !== nodeKeyOrNull(previous.focus) || next.space !== previous.space) {
        if (next.focus && controlsRef.current?.space === next.space) controlsRef.current.goToNode(next.focus);
        else pending.current = { space: next.space, ref: next.focus };
      }
      if (nextSurface === "bench") focusBench();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [focusBench, pinned]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((value) => !value); return; }
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || paletteOpen || overviewOpen || (event.target as Element).closest("input,textarea,select,button,a,[contenteditable=true],[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tablist],[role=separator]")) return;
      if (event.key === "o") { event.preventDefault(); setOverviewOpen(true); return; }
      if (event.key === "Escape") {
        if (rightVisible) closeRight(); else return;
        event.preventDefault();
      }
      const space = spaces.find((s) => s.key === event.key);
      if (space) setSpace(space.id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [paletteOpen, overviewOpen, rightVisible, closeRight, setSpace]);

  const pinInspector = useCallback((value: boolean) => { setPinned(value); setContracted(false); }, [setPinned]);
  // An unpinned inspector contracts on bench or chrome interaction. The dock itself and portaled popups are not "outside".
  useEffect(() => {
    if (!(rightVisible && !overlay && !pinned && location.inspect && !location.reference)) return;
    const isOutside = (target: EventTarget | null): target is Element =>
      target instanceof Element && !target.closest('[data-dock="right"]') &&
      Boolean(target.closest('[data-canvas="workbench"],[data-chrome]') || target === document.body || target === document.documentElement);
    // Click, not pointerdown: the capture listener and a card's own onClick → select() → write() → setContracted(false)
    // batch within one discrete event, so inspecting another card swaps content without the dock flashing closed.
    const contract = (event: Event) => {
      if (!isOutside(event.target)) return;
      setContracted(true);
      surfaceRef.current = "bench";
      setSurface("bench");
    };
    const key = (event: KeyboardEvent) => {
      if (!isOutside(event.target)) return;
      if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"].includes(event.key)) return;
      // Activation keys defer to the click they produce, which keeps the batching above.
      if ((event.key === "Enter" || event.key === " ") && (event.target as Element).closest('button,a[href],[role="button"],[role="menuitem"]')) return;
      contract(event);
    };
    window.addEventListener("click", contract, { capture: true });
    window.addEventListener("wheel", contract, { capture: true, passive: true });
    window.addEventListener("keydown", key, { capture: true });
    return () => {
      window.removeEventListener("click", contract, { capture: true });
      window.removeEventListener("wheel", contract, { capture: true });
      window.removeEventListener("keydown", key, { capture: true });
    };
  }, [rightVisible, overlay, pinned, location.inspect, location.reference]);

  const actions: PaletteAction[] = useMemo(() => [
    { id: "reference", label: "Open API reference", icon: BookOpenIcon, run: openReference },
    ...(location.inspect ? [{ id: "inspector", label: "Return to inspector", icon: PanelRightIcon, run: openInspector }] : []),
    { id: "overview", label: "Space overview", shortcut: "O", icon: LayersIcon, run: () => setOverviewOpen(true) },
    ...(paneControls ? [
      { id: "panes", label: "Open pane catalog", icon: LayersIcon, run: paneControls.catalog },
      { id: "zoom-pane", label: paneControls.layout.zoom ? "Restore panes" : "Zoom focused pane", shortcut: "Z", icon: ScanIcon, run: paneControls.zoom },
      ...paneControls.panes.map((pane) => ({ id: `pane:${pane.id}`, label: `${paneControls.layout.closed.includes(pane.id) ? "Reopen" : "Reveal"} ${pane.title}`, icon: LayersIcon, run: () => paneControls.reveal(pane.id) })),
      ...panePresets[paneControls.space].map((preset) => ({ id: `preset:${preset.id}`, label: `Layout: ${preset.title}`, icon: LayoutDashboardIcon, run: () => paneControls.preset(preset.id) })),
      ...(paneControls.layout.canUndo ? [{ id: "undo-close", label: "Undo closed pane", icon: LayersIcon, run: paneControls.undo }] : []),
    ] : controls ? [
      { id: "fit", label: "Fit bench", shortcut: "F", icon: ScanIcon, run: controls.fit },
      { id: "tidy", label: "Reset local window positions", shortcut: "T", icon: LayoutDashboardIcon, run: controls.tidy },
    ] : []),
  ], [controls, paneControls, location.inspect, openReference, openInspector]);
  const revealPane = useCallback((space: SpaceId, pane: string) => {
    if (locationRef.current.space !== space) return;
    if (paneControlsRef.current?.space === space && paneControlsRef.current.panes.some(({ id }) => id === pane)) paneControlsRef.current.reveal(pane, false);
    else {
      const panes = pending.current?.space === space ? pending.current.panes ?? [] : [];
      pending.current = { space, ref: null, panes: [...panes.filter((id) => id !== pane), pane], focus: false };
    }
  }, []);
  const workbench: WorkbenchValue = useMemo(() => ({ space: location.space, setSpace, revealPane, selected: collapsed ? null : location.inspect, hovered, select, hover, goTo, flash }), [location.space, location.inspect, collapsed, setSpace, revealPane, hovered, select, goTo, flash]);
  return <div className="contents" onPointerDownCapture={() => { pending.current = null; }} onKeyDownCapture={() => { pending.current = null; }} style={{ "--sheet": `${location.reference || pinned ? right : 0}px`, "--rail": `${railWidth}px` } as React.CSSProperties}>
    <WorkbenchContext value={workbench}><AuthActionsProvider><VoiceProvider><BotActionsProvider><RoleActionsProvider><ShimActionsProvider><NotifyActionsProvider><ContentActionsProvider>
      {spaces.map(({ id }) => <div key={id} hidden={id !== location.space || (overlay && rightVisible)} inert={id !== location.space || (overlay && rightVisible)}>
        <Activity mode={id === location.space && !(overlay && rightVisible) ? "visible" : "hidden"}>
          <div className={id === location.space ? "bench-enter" : undefined}>
            {paneSpaces.has(id) ? <PaneHost space={id} blocked={paletteOpen || overviewOpen} onControls={reportPanes} onArrive={flashNow} /> : <Bench space={id} blocked={paletteOpen} onControls={reportControls} onScale={setScale} onArrive={flashNow} />}
          </div>
        </Activity>
      </div>)}
      <SpaceRail compact={railWidth < 100} openOverview={() => setOverviewOpen(true)} />
      <SpaceBar space={location.space} setSpace={setSpace} back={backLink && typeof window !== "undefined" && `${window.location.pathname}${window.location.search}` === backLink.href ? { title: spaceTitle(backLink.space), run: () => window.history.back() } : undefined} reference={Boolean(location.reference) && rightVisible} inspectorAvailable={Boolean(location.inspect) && !rightVisible} openInspector={openInspector} toggleReference={Boolean(location.reference) && rightVisible ? closeRight : openReference} openPalette={() => setPaletteOpen(true)} openOverview={() => setOverviewOpen(true)} />
      {overviewOpen ? <SpaceOverview layouts={layouts} onClose={() => setOverviewOpen(false)} /> : null}
      {remote ? <p role="status" data-remote-scope={remote.scope} className="pointer-events-none fixed top-16 left-4 z-30 rounded-md border bg-card/95 px-2 py-1 text-xs shadow-sm">
        Remote Access · {remote.scope === "view" ? "View only. Editing controls require ui:control; sign-in, voice and browser handoff stay local." : "Control granted. Sign-in, voice and browser handoff stay local."}
      </p> : null}
      <div data-chrome hidden={paneSpaces.has(location.space)} className="fixed bottom-4 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-card/95 p-1 shadow-sm" style={{ left: "calc((100% - var(--sheet))/2)" }}>
        <Tool label="Zoom out" onClick={() => controls?.zoom(1 / 1.2)}><MinusIcon /></Tool>
        <Button variant="ghost" size="sm" aria-label="Actual size" className="w-14 tabular-nums" onClick={() => controls?.zoom(1 / scale)}>{Math.round(scale * 100)}%</Button>
        <Tool label="Zoom in" onClick={() => controls?.zoom(1.2)}><PlusIcon /></Tool>
        <Separator orientation="vertical" className="mx-1 h-5! self-center" />
        <Tool label="Fit bench (F)" onClick={() => controls?.fit()}><ScanIcon /></Tool>
        <Tool label="Reset window positions (T)" onClick={() => controls?.tidy()}><LayoutDashboardIcon /></Tool>
      </div>
      <Dock side="right" label={location.reference ? "API reference" : "Inspector"} open={rightVisible} overlay={overlay} floating={!pinned && !location.reference} width={rightWidth} min={dockMinimum.right} max={rightMax}
        onResize={(width) => { setExpanded(false); setSizes((s) => ({ ...s, [location.reference ? "reference" : "inspector"]: width })); }} onClose={closeRight} returnFocus={inspectorReturn} restoreFocusOnHide={!rightOpen && (!overlay || surface === "bench")}>
        <Inspector hidden={Boolean(location.reference)} onGone={dropInspect} pinned={pinned} onPinnedChange={overlay ? undefined : pinInspector} />
        {location.reference ? <Reference target={location.reference} onOverview={referenceOverview} onClose={closeRight} hasInspection={Boolean(location.inspect)} expanded={expanded} onExpand={() => setExpanded((value) => !value)} /> : null}
      </Dock>
      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} actions={actions} />
    </ContentActionsProvider></NotifyActionsProvider></ShimActionsProvider></RoleActionsProvider></BotActionsProvider></VoiceProvider></AuthActionsProvider></WorkbenchContext>
  </div>;
}

const nodeKeyOrNull = (ref: NodeRef | null) => ref ? nodeKey(ref) : null;
const openDocks = (location: BenchLocation) => ({ rightOpen: Boolean(location.reference || location.inspect) });
function Tool({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

/** Places and tools are separate: the Spaces menu switches benches; API reference opens the right dock. */
function TopBar({ space, setSpace, compact, reference, inspectorAvailable, openInspector, toggleReference, openPalette, fit }: {
  space: SpaceId; setSpace(space: SpaceId): void; compact: boolean; reference: boolean; inspectorAvailable: boolean; openInspector(): void; toggleReference(): void; openPalette(): void; fit(): void;
}) {
  const state = useStack();
  const attention = spaceAttention(state);
  const elsewhere = spaces.some((item) => item.id !== (space as string) && (attention as Record<string, string[]>)[item.id].length > 0);
  const dot = <span role="img" className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="needs attention" />;
  return <header data-chrome className="pointer-events-none fixed top-3 z-30 flex items-start justify-between gap-2" style={{ left: 12, right: "calc(var(--sheet) + 12px)" }}>
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-card/95 p-1 shadow-sm">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={`Spaces · ${spaceTitle(space)}`} className="gap-1.5 font-semibold" />}>
          <LayersIcon data-icon="inline-start" />{!compact ? spaceTitle(space) : null}{attention[space].length || elsewhere ? dot : null}<ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60">
          <DropdownMenuGroup>
            {spaces.map((item) => (
              <DropdownMenuItem key={item.id} aria-current={item.id === space ? "location" : undefined} title={attention[item.id].join(" · ") || undefined}
                render={<a href={spaceHref(item.id)} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setSpace(item.id); } }} />}>
                <LayersIcon />
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5 font-medium">{item.title}{attention[item.id].length ? dot : null}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.description}</span>
                </span>
                <DropdownMenuShortcut>{item.key}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={fit}><ScanIcon />Show all<DropdownMenuShortcut>F</DropdownMenuShortcut></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {/* Mirrors the left pill: same surface, same ghost buttons, the dock toggle on the outer edge. */}
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-card/95 p-1 shadow-sm">
      {!compact ? <CallLauncher /> : null}
      <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Jump to (Command K)" onClick={openPalette} />}><SearchIcon /></TooltipTrigger><TooltipContent side="bottom">Jump to <kbd className="ml-1 font-sans opacity-70">⌘K</kbd></TooltipContent></Tooltip>
      {inspectorAvailable ? <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Return to inspector" onClick={openInspector} />}><PanelRightIcon /></TooltipTrigger><TooltipContent side="bottom">Inspector</TooltipContent></Tooltip> : null}
      {!compact ? <Separator orientation="vertical" className="mx-0.5 h-5! self-center" /> : null}
      <Tooltip><TooltipTrigger render={<Button data-dock-trigger="right" variant="ghost" size="sm" aria-label="Show API reference" aria-pressed={reference} onClick={toggleReference} className="aria-pressed:bg-muted" />}>
        <BookOpenIcon data-icon="inline-start" />{!compact ? "API" : null}{attention.api.length ? dot : null}
      </TooltipTrigger><TooltipContent side="bottom" className="max-w-80">{attention.api.length ? attention.api.join(" · ") : "Package API reference"}</TooltipContent></Tooltip>
    </div>
  </header>;
}
