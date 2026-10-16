"use client";

import { Activity, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookOpenIcon, LayersIcon, LayoutDashboardIcon, PanelRightIcon, ScanIcon } from "lucide-react";
import { activeSurface, dockGeometry, dockMinimum, type WorkspaceSurface } from "@/lib/stack/dock-layout";
import { emptyLocation, locationHref, navigateTo, parseLocation, type BenchLocation } from "@/lib/stack/navigation";
import { homeOf, spaces, spaceTitle, type SpaceId } from "@/lib/stack/spaces";
import { nodeKey, type NodeRef, type Snapshot } from "@/lib/stack/types";
import { AuthActionsProvider } from "./auth-actions";
import { BotActionsProvider } from "./bot-actions";
import { Dock, useDockSizes, useInspectorPin } from "./dock";
import { Inspector } from "./inspector";
import { Palette, type PaletteAction } from "./palette";
import { StackProvider, WorkbenchContext, type WorkbenchValue } from "./provider";
import { Reference } from "./reference";
import { NotifyActionsProvider } from "./notify-actions";
import { RoleActionsProvider } from "./role-actions";
import { ShimActionsProvider } from "./role-shims";
import { ContentActionsProvider } from "./content-actions";
import { PaneHost, type PaneControls } from "./pane-host";
import { SpaceBar, SpaceOverview, SpaceRail } from "./space-chrome";
import { panePresets } from "@/lib/stack/pane-presets";
import { VoiceProvider } from "./voice";

export function Workbench({ snapshot, initialSpace, initialFocus, initialLocation }: { snapshot: Snapshot; initialSpace: SpaceId; initialFocus: NodeRef | null; initialLocation?: BenchLocation }) {
  const start = initialLocation ?? (initialFocus ? navigateTo(emptyLocation(initialSpace), initialFocus) : emptyLocation(initialSpace));
  return <StackProvider snapshot={snapshot}><Shell initialLocation={start} /></StackProvider>;
}

function Shell({ initialLocation }: { initialLocation: BenchLocation }) {
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
  const pending = useRef<{ space: SpaceId; ref: NodeRef | null; panes?: string[]; focus?: boolean } | null>({ space: initialLocation.space, ref: initialLocation.focus });
  const [screenWidth, setScreenWidth] = useState(1200);
  const [sizes, setSizes] = useDockSizes();
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useInspectorPin();
  const [contracted, setContracted] = useState(false);
  const [surface, setSurface] = useState<WorkspaceSurface>(() => activeSurface(undefined, openDocks(initialLocation)));
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
  const reportPanes = useCallback((next: PaneControls | null) => {
    setPaneControls(next); paneControlsRef.current = next;
    const target = pending.current;
    if (next && target?.space === next.space && target.panes && target.panes.every((id) => next.panes.some((pane) => pane.id === id))) {
      pending.current = null;
      for (const id of target.panes) next.reveal(id, target.focus);
    }
    if (next) setLayouts((held) => held[next.space] === next.layout ? held : { ...held, [next.space]: next.layout });
    if (next && pending.current?.space === next.space) {
      const target = pending.current;
      if (target.ref) next.goToNode(target.ref); else if (!target.panes) pending.current = null;
    }
  }, []);
  const write = useCallback((next: BenchLocation, requestedSurface: WorkspaceSurface = surfaceRef.current) => {
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
      if (paneControlsRef.current?.space === home.space) paneControlsRef.current.goToNode(ref);
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
      // Dock-only history retains the workspace's pane selection.
      if (nodeKeyOrNull(next.focus) !== nodeKeyOrNull(previous.focus) || next.space !== previous.space) {
        if (next.focus && paneControlsRef.current?.space === next.space) paneControlsRef.current.goToNode(next.focus);
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
  // An unpinned inspector contracts on workspace or chrome interaction. The dock itself and portaled popups are not "outside".
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
    ] : []),
  ], [paneControls, location.inspect, openReference, openInspector]);
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
      <a href={`#workspace-${location.space}`} onClick={(event) => { event.preventDefault(); write(locationRef.current, "bench"); focusBench(); }} className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-background focus-visible:px-3 focus-visible:py-2 focus-visible:outline-2 focus-visible:outline-ring">Skip to workspace</a>
      {spaces.map(({ id }) => <div key={id} hidden={id !== location.space || (overlay && rightVisible)} inert={id !== location.space || (overlay && rightVisible)}>
        <Activity mode={id === location.space && !(overlay && rightVisible) ? "visible" : "hidden"}>
          <div className={id === location.space ? "space-enter" : undefined}>
            <PaneHost space={id} blocked={paletteOpen || overviewOpen} onControls={reportPanes} onArrive={flashNow} />
          </div>
        </Activity>
      </div>)}
      <SpaceRail compact={railWidth < 100} openOverview={() => setOverviewOpen(true)} />
      <SpaceBar space={location.space} setSpace={setSpace} back={backLink && typeof window !== "undefined" && `${window.location.pathname}${window.location.search}` === backLink.href ? { title: spaceTitle(backLink.space), run: () => window.history.back() } : undefined} reference={Boolean(location.reference) && rightVisible} inspectorAvailable={Boolean(location.inspect) && !rightVisible} openInspector={openInspector} toggleReference={Boolean(location.reference) && rightVisible ? closeRight : openReference} openPalette={() => setPaletteOpen(true)} openOverview={() => setOverviewOpen(true)} />
      {overviewOpen ? <SpaceOverview layouts={layouts} onClose={() => setOverviewOpen(false)} /> : null}
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
