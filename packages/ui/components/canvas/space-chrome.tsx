"use client";

import { ArrowLeftIcon, BookOpenIcon, BotIcon, BrainIcon, ChevronDownIcon, CompassIcon, FileTextIcon, FlaskConicalIcon, GlobeIcon, InboxIcon, LayoutDashboardIcon, LibraryIcon, ListTreeIcon, MonitorIcon, PanelRightIcon, RadioIcon, SearchIcon, Settings2Icon, SquareTerminalIcon, UsersIcon, WebhookIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { panePresets, spaceGroups } from "@/lib/stack/pane-presets";
import { homeOf, parseNodeKey, spaceAttention, spaceHref, spaces, spaceTitle, type SpaceId } from "@/lib/stack/spaces";
import { cn } from "@/lib/utils";
import { useChatWindows, useProcWindows, useStack, useViewerWindows, useWorkbench, useWorkerWindows } from "./provider";
import { paneDefinitions } from "./spaces";
import { paneIds, projectLayout, tabs } from "@/lib/stack/pane-layout";
import type { PaneLayout } from "@/lib/stack/pane-state";
import { CallLauncher } from "./voice";

const icons: Record<SpaceId, typeof BotIcon> = { hud: ListTreeIcon, fleet: BotIcon, accounts: UsersIcon, workers: SquareTerminalIcon, roles: Settings2Icon, browse: MonitorIcon, brain: BrainIcon, inbox: InboxIcon, signal: RadioIcon, content: LibraryIcon, scrape: GlobeIcon, proc: SquareTerminalIcon, source: WebhookIcon, system: LayoutDashboardIcon, lab: FlaskConicalIcon };
const accent: Record<SpaceId, string> = { hud: "text-pkg-hud", fleet: "text-pkg-bots", accounts: "text-pkg-auth", workers: "text-pkg-worker", roles: "text-pkg-roles", browse: "text-pkg-browse", brain: "text-pkg-brain", inbox: "text-pkg-notify", signal: "text-pkg-events", content: "text-pkg-content", scrape: "text-pkg-scrape", proc: "text-pkg-proc", source: "text-pkg-source", system: "text-pkg-server", lab: "text-pkg-api" };
const plainClick = (event: React.MouseEvent) => !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0;

export function SpaceRail({ compact, openOverview }: { compact: boolean; openOverview(): void }) {
  const state = useStack();
  const { space, setSpace, hovered } = useWorkbench();
  const attention = spaceAttention(state);
  const ref = hovered ? parseNodeKey(hovered) : null, home = ref ? homeOf(ref) : null;
  return <aside data-chrome className="fixed inset-y-0 left-0 z-30 hidden w-[var(--rail)] flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground sm:flex">
    <div className="flex h-16 shrink-0 items-center justify-center gap-2 px-3 font-semibold tracking-tight"><span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background"><LayersMark /></span>{!compact ? <span className="mr-auto">Stack</span> : null}</div>
    <nav aria-label="Canvas spaces" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3">
      {spaceGroups.map((group) => <div key={group.title} className="flex flex-col gap-0.5" role="group" aria-label={group.title}>
        {compact ? <div className="mx-2 border-t border-border/50" /> : <h2 className="px-2 pb-1 text-[0.6rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{group.title}</h2>}
        {group.spaces.map((id) => {
          const item = spaces.find((item) => item.id === id)!, Icon = icons[id], reasons = attention[id];
          return <Tooltip key={id}><TooltipTrigger render={<a href={spaceHref(id)} aria-label={item.title} aria-current={space === id ? "page" : undefined} onClick={(event) => { if (plainClick(event)) { event.preventDefault(); setSpace(id); } }}
            className={cn("relative flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring", compact && "justify-center px-0", space === id && "bg-sidebar-accent font-medium text-sidebar-accent-foreground", home?.kind === "space" && home.space === id && id !== space && "ring-1 ring-ring")} />}>
            <Icon className={cn("size-4 shrink-0", space === id && accent[id])} />{!compact ? <span className="truncate">{item.title}</span> : null}
            {reasons.length ? <span aria-label={`${reasons.length} attention reasons`} className={cn("size-1.5 shrink-0 rounded-full bg-warning", compact ? "absolute top-1 right-1" : "ml-auto")} /> : null}
          </TooltipTrigger><TooltipContent side="right" className="max-w-72"><span>{item.title} · {item.key}{reasons.length ? ` — ${reasons.join(" · ")}` : ""}</span></TooltipContent></Tooltip>;
        })}
      </div>)}
    </nav>
    <div className="shrink-0 border-t border-border/60 p-2"><Button variant="ghost" size={compact ? "icon" : "sm"} className={compact ? "w-full" : "w-full justify-start"} aria-label="Space overview" onClick={openOverview}><CompassIcon data-icon="inline-start" />{compact ? null : "Overview"}</Button></div>
  </aside>;
}
function LayersMark() { return <FileTextIcon className="size-4" />; }

export function SpaceBar({ space, setSpace, back, reference, inspectorAvailable, openInspector, toggleReference, openPalette, openOverview }: {
  space: SpaceId; setSpace(space: SpaceId): void; back?: { title: string; run(): void }; reference: boolean; inspectorAvailable: boolean; openInspector(): void; toggleReference(): void; openPalette(): void; openOverview(): void;
}) {
  const state = useStack();
  const attention = spaceAttention(state);
  const item = spaces.find((item) => item.id === space)!, Icon = icons[space];
  const remoteNotice = state.remote ? `Remote Access · ${state.remote.scope === "view" ? "View only. Editing controls require ui:control; sign-in, voice and browser handoff stay local." : "Control granted. Sign-in, voice and browser handoff stay local."}` : null;
  return <header data-chrome className="fixed top-0 z-30 flex h-16 items-center justify-between gap-2 px-3" style={{ left: "var(--rail, 0px)", right: "var(--sheet, 0px)" }}>
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 flex-col">
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={`Spaces · ${item.title}`} className="max-w-full min-w-0 self-start gap-2 px-1" />}><Icon data-icon="inline-start" className={accent[space]} /><h1 className="truncate text-base font-semibold tracking-tight">{item.title}</h1><ChevronDownIcon data-icon="inline-end" /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[80dvh] overflow-y-auto">
          {spaceGroups.map((group) => <DropdownMenuGroup key={group.title}><DropdownMenuLabel>{group.title}</DropdownMenuLabel>{group.spaces.map((id) => <DropdownMenuItem key={id} aria-current={id === space ? "location" : undefined} title={attention[id].join(" · ") || undefined} render={<a href={spaceHref(id)} onClick={(event) => { if (plainClick(event)) { event.preventDefault(); setSpace(id); } }} />}>{spaceTitle(id)}{attention[id].length ? <span className="ml-auto size-1.5 rounded-full bg-warning" /> : null}</DropdownMenuItem>)}</DropdownMenuGroup>)}
          <DropdownMenuGroup><DropdownMenuItem onClick={openOverview}><CompassIcon />Space overview</DropdownMenuItem></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {remoteNotice ? <p role="status" data-remote-scope={state.remote?.scope} title={remoteNotice} className="max-w-56 truncate px-1 text-[0.65rem] text-muted-foreground">{remoteNotice}</p> : null}
      </div>
      {back ? <Button variant="ghost" size="sm" aria-label={`Back to ${back.title}`} title={`Back to ${back.title}`} onClick={back.run}><ArrowLeftIcon data-icon="inline-start" /><span className="hidden sm:inline">{back.title}</span></Button> : null}
      <p className="hidden max-w-72 truncate border-l pl-3 text-xs text-muted-foreground lg:block" title={item.description}>{item.description}</p>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <CallLauncher />
      <Button variant="ghost" size="icon-sm" aria-label="Jump to (Command K)" title="Jump to (Command K)" onClick={openPalette}><SearchIcon /></Button>
      {inspectorAvailable ? <Button variant="ghost" size="icon-sm" aria-label="Return to inspector" onClick={openInspector}><PanelRightIcon /></Button> : null}
      <Button data-dock-trigger="right" variant="ghost" size="icon-sm" aria-label="Show API reference" title="API reference" aria-pressed={reference} className="aria-pressed:bg-muted" onClick={toggleReference}><BookOpenIcon /></Button>
    </div>
  </header>;
}

export function SpaceOverview({ layouts, onClose }: { layouts: Partial<Record<SpaceId, PaneLayout>>; onClose(): void }) {
  const { space, setSpace } = useWorkbench();
  const state = useStack(), attention = spaceAttention(state);
  const { windows: chats } = useChatWindows(), { windows: workers } = useWorkerWindows(), { windows: viewers } = useViewerWindows(), { windows: procRuns } = useProcWindows();
  return <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-6xl"><DialogHeader><DialogTitle>Space overview</DialogTitle><DialogDescription>Choose a space. Attention comes from the current owner observations.</DialogDescription></DialogHeader>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {spaceGroups.map((group) => <section key={group.title} className="flex flex-col gap-2"><h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</h2>{group.spaces.map((id) => {
        const item = spaces.find((item) => item.id === id)!, Icon = icons[id];
        const ids = paneDefinitions(id, state, { chats, workers, viewers, procRuns }).map((def) => def.id), layout = layouts[id];
        const tree = layout ? layout.zoom ? tabs(layout.zoom) : layout.tree : panePresets[id][0].build(ids);
        const preview = projectLayout(tree, { width: 1600, height: 1000 });
        const open = layout ? paneIds(layout.tree).length : paneIds(tree).length;
        return <a key={id} href={spaceHref(id)} aria-current={space === id ? "page" : undefined} onClick={(event) => { if (plainClick(event)) { event.preventDefault(); setSpace(id); onClose(); } }} className="flex items-start gap-3 rounded-xl border p-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"><Icon className={cn("mt-0.5 size-4 shrink-0", accent[id])} /><span className="flex min-w-0 flex-1 flex-col gap-1"><span className="text-sm font-medium">{item.title}</span>
          <svg aria-hidden viewBox="0 0 1600 1000" className="my-1 h-12 w-full rounded bg-muted/30">{preview.stacks.map((rect) => <rect key={rect.id} x={rect.x + 8} y={rect.y + 8} width={Math.max(0, rect.width - 16)} height={Math.max(0, rect.height - 16)} rx={24} fill={rect.active === layout?.focus ? "var(--primary)" : "var(--muted)"} fillOpacity={rect.active === layout?.focus ? 0.4 : 1} stroke="var(--border)" strokeWidth={8} />)}</svg>
          <span className="text-xs text-muted-foreground">{layout?.modified ? "Modified layout" : layout ? panePresets[id].find((preset) => preset.id === layout.preset)?.title : "Default layout"} · {open} open · {layout?.closed.length ?? Math.max(0, ids.length - open)} closed</span><span className="line-clamp-2 text-xs text-muted-foreground">{item.description}</span>{attention[id].length ? <span className="text-xs text-warning">{attention[id].join(" · ")}</span> : null}</span></a>;
      })}</section>)}
    </div>
  </DialogContent></Dialog>;
}
