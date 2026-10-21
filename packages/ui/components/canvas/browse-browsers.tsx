"use client";

import { useId, useState } from "react";
import { AppWindowIcon, EyeIcon, HardDriveIcon, MoreHorizontalIcon, PlayIcon, PlusIcon, SquareIcon, TerminalIcon, Trash2Icon } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { browseCallError, browseLocalReason, heldBy, profileLimit, sortStandalone, standaloneActions, standaloneConnect, standaloneCreateBlock, standaloneStatus, type BrowseCallError } from "@/lib/stack/browse";
import { shortId } from "@/lib/stack/derive";
import type { BrowserProfile } from "@/lib/stack/types";
import { cn } from "@/lib/utils";
import { CopyButton, Empty, Flash, NodeCard, NodeLink, NodeTitle, StatusDot, Time } from "./primitives";
import { useStack, useStore, useViewerWindows, useWorkbench } from "./provider";
import { useBrowseBlocked } from "./browse-handoffs";
import { BrowseMaintenanceFence } from "./browse-maintenance";
import { ProfileExtensionsDialog } from "./browse-extensions";
import { localOperations } from "@/lib/stack/state";
import { PuzzleIcon } from "lucide-react";
import { PendingLabel, useBrowseWrite, WriteError } from "./browse-operator";
import { fieldLabel } from "./scrape-shared";
import { footerButton, Window } from "./window";

const badge = "rounded-md bg-muted px-1.5 py-px font-mono text-[0.64rem] text-muted-foreground";

/** Commands that drive this browser through Stack's agent-browser provider, each ready to copy. */
function ConnectPanel({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-2" aria-label={`Connect an agent to ${name}`} role="group">
      {standaloneConnect(name).map((item) => (
        <div key={item.label} className="group/row flex flex-col gap-0.5">
          <span className={fieldLabel}>{item.label}</span>
          <div className="flex items-start gap-1">
            <code className="min-w-0 flex-1 rounded-md bg-background px-1.5 py-1 font-mono text-[0.68rem] break-all">{item.command}</code>
            <CopyButton value={item.command} label={`${item.label} command`} className="opacity-100" />
          </div>
          <span className="text-[0.64rem] text-pretty text-muted-foreground">{item.hint}</span>
        </div>
      ))}
      <p className="text-[0.64rem] text-pretty text-muted-foreground">
        Attaching starts a stopped browser. Agents with Stack&apos;s browse MCP server manage it by name with the <span className="font-mono">browser_standalone_*</span> tools. Page actions stay in agent-browser.
      </p>
    </div>
  );
}

/**
 * Type the name to delete it. Names are reusable, so the current incarnation is read first and a browser that was
 * deleted and recreated under this name since the page looked is never deleted by mistake.
 */
function DeleteBrowserDialog({ browser, open, onOpenChange }: { browser: BrowserProfile; open: boolean; onOpenChange(open: boolean): void }) {
  const store = useStore();
  const write = useBrowseWrite("browser_standalone_delete");
  const blocked = useBrowseBlocked();
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<BrowseCallError | null>(null);
  // The incarnation the person opened this dialog for; a later read of the list never retargets it.
  const [expected] = useState(browser.id);
  const name = browser.name ?? "";
  const pending = checking || write.pending;
  const remove = async () => {
    setChecking(true);
    setCheck(null);
    write.clear();
    try {
      const { browser: current } = await store.call<{ browser: BrowserProfile | null }>("browse", "browser_standalone_get", { name });
      if (current && current.id !== expected) {
        setCheck({ text: `${name} now names a different browser (${shortId(current.id)}). Review it before deleting.`, uncertain: false, stale: true });
        store.refreshBrowse();
        return;
      }
    } catch (cause) {
      setCheck(browseCallError(cause));
      return;
    } finally { setChecking(false); }
    if (await write.run({ name, confirm: "delete" })) onOpenChange(false);
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!pending) { onOpenChange(next); setTyped(""); setCheck(null); write.clear(); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its VM and volume are removed, with every sign-in, cookie and stored page. Agents using it lose it. This cannot be undone; creating {name} again starts empty.
            Type <span className="font-mono font-medium text-foreground">{name}</span> to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input value={typed} autoFocus spellCheck={false} autoComplete="off" aria-label="Browser name" disabled={pending} onChange={(event) => setTyped(event.target.value)} className="font-mono" />
        <p className="text-[0.66rem] text-muted-foreground">Profile <span className="font-mono">{expected}</span></p>
        <WriteError error={check ?? write.error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={typed !== name || pending || Boolean(blocked)} title={blocked ?? undefined} onClick={() => void remove()}>
            {pending ? <Spinner data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}Delete browser
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BrowserRow({ browser }: { browser: BrowserProfile }) {
  const state = useStack();
  const { browserHandoffs } = state;
  const blocked = useBrowseBlocked();
  const { viewers } = useViewerWindows();
  const { goTo } = useWorkbench();
  const start = useBrowseWrite<BrowserProfile>("browser_standalone_start");
  const stop = useBrowseWrite<BrowserProfile>("browser_standalone_stop");
  const [deleting, setDeleting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [extensions, setExtensions] = useState(false);
  const name = browser.name ?? "";
  const node = { kind: "standalone-browser" as const, id: name };
  const status = standaloneStatus(browser);
  const actions = standaloneActions(browser, browserHandoffs.data);
  const held = heldBy(browser.id, browserHandoffs.data);
  const reason = blocked ?? actions.blocked;
  const busy = start.pending || stop.pending;
  const viewable = browser.state === "ready" && browser.observation !== null;
  const settling = ["starting", "recovering", "stopping", "deleting"].includes(browser.state);
  return (
    <li data-node={`standalone-browser:${name}`} className="relative">
      <Flash id={`standalone-browser:${name}`} />
      <NodeCard node={node} label={name} variant="row">
        <div className="flex items-center gap-2">
          <StatusDot tone={status.tone} label={status.label} pulse={settling} />
          <NodeTitle node={node} label={`browser ${name}`} className="min-w-0 truncate font-mono text-[0.78rem] font-medium">{name}</NodeTitle>
          {browser.label !== name ? <span className="min-w-0 truncate text-[0.7rem] text-muted-foreground" title="Label">{browser.label}</span> : null}
          {held ? <NodeLink node={{ kind: "browser-handoff", id: held.id }} label="handoff holding this browser" className={cn(badge, "bg-warning/15 text-warning")}>held</NodeLink> : null}
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {actions.start ? (
              <Button type="button" size="xs" variant="outline" disabled={Boolean(reason) || busy} title={reason ?? "Start it and wait until it is ready; its data is kept"}
                onClick={() => void start.run({ name })}><PendingLabel since={start.since}><PlayIcon data-icon="inline-start" />Start</PendingLabel></Button>
            ) : null}
            {actions.stop ? (
              <Button type="button" size="xs" variant="ghost" disabled={Boolean(reason) || busy} title={reason ?? "Close Chrome cleanly and stop its VM. Agents using it are disconnected; sign-ins and data are kept"}
                onClick={() => void stop.run({ name })}><PendingLabel since={stop.since}><SquareIcon data-icon="inline-start" />{browser.stopped && browser.state === "failed" ? "Stop again" : "Stop"}</PendingLabel></Button>
            ) : null}
            <Button type="button" size="xs" variant="ghost" disabled={!viewable} title={viewable ? "Watch in the viewer" : `Browser ${status.label.toLowerCase()}`}
              onClick={() => goTo({ kind: "browser-viewer", id: viewers.show(browser.id) })}><EyeIcon data-icon="inline-start" />View</Button>
            <Button type="button" size="xs" variant="ghost" aria-expanded={connecting} title="How to drive it with agent-browser" onClick={() => setConnecting(!connecting)}>
              <TerminalIcon data-icon="inline-start" />Connect
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" size="icon-xs" variant="ghost" aria-label={`More for ${name}`} className="text-muted-foreground" />}><MoreHorizontalIcon /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={!viewable} onClick={() => goTo({ kind: "browser-viewer", id: viewers.open(browser.id) })}><EyeIcon />Open in a new viewer</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => goTo({ kind: "browser-profile", id: browser.id })}><HardDriveIcon />Show its profile</DropdownMenuItem>
                  {localOperations(state, "browse", ["browser_profile_extensions_get"]).available ? <DropdownMenuItem onClick={() => setExtensions(true)}><PuzzleIcon />Extensions…</DropdownMenuItem> : null}
                  <DropdownMenuItem variant="destructive" disabled={Boolean(reason)} title={reason ?? undefined} onClick={() => setDeleting(true)}>
                    <Trash2Icon />{actions.blocked ?? "Delete browser…"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
        <p className="flex min-w-0 flex-wrap gap-x-2 text-[0.66rem] text-muted-foreground">
          <span>{status.label}</span>
          {browser.observedAt ? <span>observed <Time at={Date.parse(browser.observedAt)} /></span> : null}
          <span className="ml-auto font-mono" title={browser.id}>{shortId(browser.id)}</span>
        </p>
        {browser.state === "ready" ? null : <p className="text-[0.66rem] text-pretty text-muted-foreground">{status.hint}</p>}
        {browser.cdpUrl ? (
          <p className="group/row flex min-w-0 items-center gap-1.5 text-[0.66rem]" title="The current managed relay. It changes when the browser or Stack restarts, and a raw CDP client bypasses managed admission: prefer agent-browser.">
            <span className="text-muted-foreground">CDP</span>
            <span className="min-w-0 truncate font-mono">{browser.cdpUrl}</span>
            <CopyButton value={browser.cdpUrl} label="CDP URL" />
          </p>
        ) : null}
        {browser.error ? <p className="text-[0.68rem] break-words text-destructive">{browser.error}</p> : null}
        <WriteError error={start.error ?? stop.error} />
        <BrowseMaintenanceFence profile={browser} />
        {connecting ? <ConnectPanel name={name} /> : null}
      </NodeCard>
      {deleting ? <DeleteBrowserDialog browser={browser} open={deleting} onOpenChange={setDeleting} /> : null}
      {extensions ? <ProfileExtensionsDialog key={browser.id} profile={browser} onClose={() => setExtensions(false)} /> : null}
    </li>
  );
}

/**
 * Named standalone browsers: durable profiles that belong to no Bot, addressed by name. Any local agent can drive
 * one through agent-browser and Stack's provider. Starting, stopping and deleting are explicit; nothing is retried.
 */
export function BrowsersWindow() {
  const { status, endpoints, browserStandalone, browserProfiles, remote } = useStack();
  const blocked = useBrowseBlocked();
  const { goTo } = useWorkbench();
  const create = useBrowseWrite<BrowserProfile>("browser_standalone_create");
  const formId = useId();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ name: "", label: "" });
  const browsers = sortStandalone(browserStandalone.data ?? []);
  const unavailable = browseLocalReason(remote) ?? (!endpoints.browse ? "Browse isn't served by this server" : null);
  const used = browserProfiles.data?.length ?? null;
  const label = draft.label.trim();
  const invalid = draft.name ? standaloneCreateBlock(draft.name, label, browserStandalone.data, used) : null;
  const submit = async () => {
    if (blocked || invalid || create.pending || !draft.name) return;
    const result = await create.run(label ? { name: draft.name, label } : { name: draft.name });
    if (result?.name) { setDraft({ name: "", label: "" }); setComposing(false); goTo({ kind: "standalone-browser", id: result.name }); }
  };
  return (
    <Window id="browse-browsers" title="Browsers" icon={AppWindowIcon} accent="browse" count={browserStandalone.data ? browsers.length : null}
      status={endpoints.browse ? status.browse : undefined} endpoint={endpoints.browse} updatedAt={browserStandalone.at} error={browserStandalone.error}
      footer={unavailable ? undefined : (
        <Button variant="ghost" size="sm" className={footerButton} aria-expanded={composing} onClick={() => setComposing(!composing)}><PlusIcon data-icon="inline-start" />New browser…</Button>
      )}>
      {composing ? (
        <form className="flex flex-col gap-2 rounded-lg border p-2.5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor={`${formId}-name`} className="flex flex-col gap-1">
            <span className={fieldLabel}>Name</span>
            <Input id={`${formId}-name`} value={draft.name} maxLength={40} autoFocus disabled={create.pending} placeholder="research" spellCheck={false} autoComplete="off" aria-invalid={Boolean(invalid)}
              onChange={(event) => { setDraft({ ...draft, name: event.target.value }); create.clear(); }} className="h-7 font-mono text-[0.76rem]" />
          </label>
          <label htmlFor={`${formId}-label`} className="flex flex-col gap-1">
            <span className={fieldLabel}>Label <span className="normal-case tracking-normal">(optional)</span></span>
            <Input id={`${formId}-label`} value={draft.label} maxLength={128} disabled={create.pending} placeholder={draft.name || "Defaults to the name"} spellCheck={false} autoComplete="off"
              onChange={(event) => { setDraft({ ...draft, label: event.target.value }); create.clear(); }} className="h-7 text-[0.76rem]" />
          </label>
          <WriteError error={create.error} />
          <div className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 text-[0.66rem] text-pretty", invalid ? "text-warning" : "text-muted-foreground")}>
              {blocked ?? invalid ?? `Lowercase letters, digits and hyphens. Starts empty in the background and never copies sign-ins.${used === null ? "" : ` ${used} of ${profileLimit} profiles in use, Bot profiles included.`}`}
            </span>
            <Button type="submit" size="sm" disabled={Boolean(blocked ?? invalid) || create.pending || !draft.name}>
              {create.pending ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}Create
            </Button>
          </div>
        </form>
      ) : null}
      {unavailable ? <Empty icon={AppWindowIcon} title={unavailable} />
        : !browserStandalone.data ? <Empty icon={AppWindowIcon} title="Reading browsers…" />
        : !browsers.length ? (composing ? null : <Empty icon={AppWindowIcon} title="No named browsers" hint="Create one here or with stack browse create NAME. Any local agent can then drive it by name." />)
        : (
          <>
            <p className="px-0.5 text-[0.66rem] text-pretty text-muted-foreground">Not tied to any Bot. Any local agent can drive, stop or delete one by name.</p>
            {/* Keyed by name: a reused name keeps its row, so an open deletion can say its incarnation changed. */}
            <ul className="flex flex-col gap-0.5">{browsers.map((browser) => <BrowserRow key={browser.name} browser={browser} />)}</ul>
          </>
        )}
    </Window>
  );
}
