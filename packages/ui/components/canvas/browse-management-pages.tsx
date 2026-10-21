"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppWindowIcon, EyeIcon, LifeBuoyIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { browseCallError, browseLocalReason, type BrowseCallError } from "@/lib/stack/browse";
import { clearOperatorRequest, clearPageOpen, loadOperatorRequest, loadPageOpen, managementEntries, matchOperatorRequest, operatorRequestBlock, pageOpenInput,
  saveOperatorRequest, savePageOpen, type ManagementPage, type OperatorRequestRecord, type PageOpenRecord } from "@/lib/stack/browse-management";
import { notRecorded, waitingForIdentity } from "@/lib/stack/destination";
import { shortId } from "@/lib/stack/derive";
import { observationResource, type ReadObservation } from "@/lib/stack/observation";
import { localOperations } from "@/lib/stack/state";
import type { BrowserHandoff, BrowserProfile } from "@/lib/stack/types";
import { cn } from "@/lib/utils";
import { useDestination, useStack, useStore, useViewerWindows, useWorkbench } from "./provider";

const hint = "text-[0.66rem] text-pretty text-muted-foreground";

/** Hold demand on a store-owned observation while this view is mounted and visible; hidden panes release it. */
export function useManagedRead<V>(observation: Pick<ReadObservation<never, V>, "activate" | "subscribe" | "getSnapshot" | "refresh">) {
  useLayoutEffect(() => observation.activate(), [observation]);
  const snapshot = useSyncExternalStore(observation.subscribe, observation.getSnapshot, observation.getSnapshot);
  return { ...observationResource(snapshot), loading: snapshot.pending !== null, refresh: observation.refresh };
}

/**
 * Re-read on an interval while `active`, this view is visible and the document is shown, at most `limit` times per
 * episode. Hidden panes clean up the timer. Returns true once the bound is spent, so the view can ask for a manual refresh.
 */
export function useBoundedPoll(active: boolean, poll: () => unknown, { interval = 10_000, limit = 30 } = {}): boolean {
  const [spent, setSpent] = useState(false);
  const latest = useRef(poll);
  useLayoutEffect(() => { latest.current = poll; });
  useEffect(() => {
    setSpent(false);
    if (!active) return;
    let count = 0;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (++count > limit) { clearInterval(timer); setSpent(true); return; }
      void latest.current();
    }, interval);
    return () => clearInterval(timer);
  }, [active, interval, limit]);
  return spent && active;
}

function Problem({ error }: { error: BrowseCallError | null }) {
  if (!error) return null;
  return <p role="alert" className={cn("rounded-lg px-2.5 py-1.5 text-[0.72rem] text-pretty", error.uncertain ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive")}>{error.text}</p>;
}

function pageLabel(page: ManagementPage): string {
  return page.kind === "vault" ? page.entry === "register" ? "vault registration" : "vault" : `${page.id} ${page.entry}`;
}

/**
 * Management pages for a handoff that is waiting for a person, opened before Take. Each request records its exact
 * input under this destination first. An unconfirmed result is inspected through the handoff and its viewer, never
 * resent; a new navigation is a separate decision after the person forgets the old one.
 */
export function ManagementPages({ handoff, onOpened }: { handoff: BrowserHandoff; onOpened?(handoff: BrowserHandoff): void }) {
  const state = useStack();
  if (!localOperations(state, "browse", ["browser_management_page_open", "browser_profile_extensions_get", "browser_extension_list"]).available) return null;
  return <Pages key={handoff.id} handoff={handoff} onOpened={onOpened} />;
}

function Pages({ handoff, onOpened }: { handoff: BrowserHandoff; onOpened?(handoff: BrowserHandoff): void }) {
  const state = useStack();
  const store = useStore();
  const { local } = useDestination();
  const { viewers } = useViewerWindows();
  const { goTo } = useWorkbench();
  const configuration = useMemo(() => store.browseManagement.configuration(handoff.profileId), [store, handoff.profileId]);
  const config = useManagedRead(configuration);
  const catalog = useManagedRead(store.browseManagement.catalog);
  const vault = useManagedRead(store.browseManagement.vault);
  const [record, setRecord] = useState<PageOpenRecord | null | "invalid">(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BrowseCallError | null>(null);
  useEffect(() => { setRecord(loadPageOpen(local, handoff.id)); }, [local, handoff.id]);
  const entries = managementEntries(config.data, catalog.data, vault.data);
  const blocked = browseLocalReason(state.remote) ?? (state.status.browse !== "open" ? "Browse reconnecting"
    : !local ? waitingForIdentity
    : handoff.state !== "awaiting_human" ? "Pages open only while the handoff waits for you, before Take"
    : !config.data ? config.error ? `Configuration unavailable: ${config.error}` : "Reading this profile's configuration…"
    : config.stale ? "Refresh this profile's configuration first" : null);
  const open = async (page: ManagementPage) => {
    if (pending || blocked) return;
    // Another view may have recorded one since this one read storage.
    const held = record ?? loadPageOpen(local, handoff.id);
    if (held) { setRecord(held); setError({ text: "An earlier page request for this handoff is unresolved. Inspect it, then forget it before deciding again.", uncertain: false, stale: false }); return; }
    const next: PageOpenRecord = { handoffId: handoff.id, expectedRevision: handoff.revision, requestId: crypto.randomUUID(), page, at: Date.now() };
    if (!savePageOpen(local, next)) { setError({ text: notRecorded, uncertain: false, stale: false }); return; }
    setRecord(next); setPending(true); setError(null);
    try {
      const result = await store.browse<BrowserHandoff>("browser_management_page_open", pageOpenInput(next));
      clearPageOpen(local, handoff.id); setRecord(null);
      onOpened?.(result);
    } catch (cause) {
      const failure = browseCallError(cause);
      if (!failure.uncertain) { clearPageOpen(local, handoff.id); setRecord(null); }
      setError(failure.uncertain ? { ...failure, text: `${failure.text}. The navigation may have been admitted; inspect the handoff and its viewer. Nothing is resent.` } : failure);
    } finally { setPending(false); }
  };
  const forget = () => { if (clearPageOpen(local, handoff.id)) { setRecord(null); setError(null); } else setError({ text: "The saved page request could not be cleared; it remains held.", uncertain: false, stale: false }); };
  const watch = () => goTo({ kind: "browser-viewer", id: viewers.show(handoff.profileId) });
  if (!entries.length && !record) return null;
  return (
    <div role="group" aria-label="Management pages" className="flex flex-col gap-1.5 rounded-lg border border-dashed p-2">
      <p className="flex items-center gap-1.5 text-[0.72rem] font-medium"><AppWindowIcon aria-hidden className="size-3.5" />Open a management page, then Take control</p>
      {record && !pending ? (
        <div role="status" className="flex flex-col gap-1 rounded-md bg-warning/10 px-2 py-1.5 text-[0.7rem] text-pretty text-warning">
          {record === "invalid" ? <span>A saved page request for this handoff is unreadable. It was preserved for inspection; nothing was sent.</span>
            : <span>Page request <span className="font-mono" title={record.requestId}>{shortId(record.requestId)}</span> for the {pageLabel(record.page)} at revision {record.expectedRevision} is not confirmed. The owner keeps its admission and never opens another tab for it; inspect the handoff&apos;s target and issue and the viewer. Nothing is resent.</span>}
          <span className="flex flex-wrap gap-1">
            <Button type="button" size="xs" variant="outline" onClick={watch}><EyeIcon data-icon="inline-start" />Watch</Button>
            <Button type="button" size="xs" variant="ghost" onClick={forget}><XIcon data-icon="inline-start" />Forget after inspection</Button>
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {entries.map((entry) => (
          <Button key={entry.key} type="button" size="xs" variant="outline" disabled={Boolean(blocked ?? entry.reason) || pending || !!record}
            title={blocked ?? entry.reason ?? `Open the ${entry.label} in this held profile`} onClick={() => void open(entry.page)}>
            {pending ? <Spinner data-icon="inline-start" /> : null}{entry.label}
          </Button>
        ))}
      </div>
      {blocked && blocked !== "Pages open only while the handoff waits for you, before Take" ? <p className={hint}>{blocked}</p> : null}
      {entries.filter((entry) => entry.reason).map((entry) => <p key={entry.key} className={hint}>{entry.label}: {entry.reason}</p>)}
      <Problem error={error} />
      <p className={hint}>Only applied bindings and declared extension entry points open; there is no arbitrary URL. Create accounts and enter passwords in the upstream page after taking control, never in Stack.</p>
    </div>
  );
}

/**
 * An operator handoff for a ready profile, with no Bot Chat. The exact request is recorded before it is sent; an
 * unconfirmed one is recovered by finding a handoff with operator origin, this request ID and this profile.
 */
export function OperatorRequest({ profile }: { profile: BrowserProfile }) {
  const state = useStack();
  if (!localOperations(state, "browse", ["browser_operator_handoff_request"]).available) return null;
  return <Request key={profile.id} profile={profile} />;
}

function Request({ profile }: { profile: BrowserProfile }) {
  const state = useStack();
  const store = useStore();
  const { local } = useDestination();
  const [record, setRecord] = useState<OperatorRequestRecord | null | "invalid">(null);
  const [message, setMessage] = useState("Agent password manager setup");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BrowseCallError | null>(null);
  useEffect(() => { setRecord(loadOperatorRequest(local, profile.id)); }, [local, profile.id]);
  const match = record && record !== "invalid" ? matchOperatorRequest(state.browserHandoffs.data, record) : null;
  // Evidence found: the request was admitted. Its record is no longer needed for recovery.
  useEffect(() => { if (match && clearOperatorRequest(local, profile.id)) setRecord(null); }, [match, local, profile.id]);
  const text = message.trim();
  const blocked = browseLocalReason(state.remote) ?? (state.status.browse !== "open" ? "Browse reconnecting" : !local ? waitingForIdentity
    : operatorRequestBlock(profile, state.browserHandoffs.data) ?? (!text ? "Enter a short message" : text.length > 4000 ? "Messages are at most 4000 characters" : null));
  const send = async () => {
    if (pending || blocked || record) return;
    const next: OperatorRequestRecord = { profileId: profile.id, requestId: crypto.randomUUID(), message: text, at: Date.now() };
    if (!saveOperatorRequest(local, next)) { setError({ text: notRecorded, uncertain: false, stale: false }); return; }
    setRecord(next); setPending(true); setError(null);
    try {
      await store.browse<BrowserHandoff>("browser_operator_handoff_request", { profileId: next.profileId, requestId: next.requestId, message: next.message });
      clearOperatorRequest(local, profile.id); setRecord(null);
    } catch (cause) {
      const failure = browseCallError(cause);
      if (!failure.uncertain) { clearOperatorRequest(local, profile.id); setRecord(null); }
      setError(failure);
    } finally { setPending(false); }
  };
  const forget = () => { if (clearOperatorRequest(local, profile.id)) { setRecord(null); setError(null); } else setError({ text: "The saved request could not be cleared; it remains held.", uncertain: false, stale: false }); };
  if (record && !pending && !match) {
    return (
      <div role="status" className="flex flex-col gap-1 rounded-lg bg-warning/10 px-2.5 py-2 text-[0.72rem] text-pretty text-warning">
        {record === "invalid" ? <span>A saved handoff request for this profile is unreadable. It was preserved for inspection; nothing was sent.</span>
          : <span>Handoff request <span className="font-mono" title={record.requestId}>{shortId(record.requestId)}</span> is not confirmed. No handoff with operator origin, this request ID and this profile has been observed. It is never resent; a new request is a separate decision after you forget this one.</span>}
        <span className="flex flex-wrap gap-1">
          <Button type="button" size="xs" variant="outline" disabled={state.status.browse !== "open"} onClick={store.refreshBrowse}><RotateCcwIcon data-icon="inline-start" />Read handoffs again</Button>
          <Button type="button" size="xs" variant="ghost" onClick={forget}><XIcon data-icon="inline-start" />Forget after inspection</Button>
        </span>
        <Problem error={error} />
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-1.5 rounded-lg border p-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label className="flex flex-col gap-1 text-[0.72rem]">
        <span className="text-muted-foreground">Handoff message</span>
        <Textarea value={message} maxLength={4000} disabled={pending} onChange={(event) => { setMessage(event.target.value); setError(null); }} className="min-h-8 max-h-24 text-[0.74rem]" />
      </label>
      <p className={hint}>Never put a password here: handoff content is retained until explicit history redaction. Requesting holds this ready profile and drains its automation; it never launches or navigates the browser.</p>
      <Problem error={error} />
      <div className="flex items-center gap-2">
        <span className={cn("min-w-0 flex-1", hint)}>{blocked ?? "Then open a management page and take control."}</span>
        <Button type="submit" size="sm" disabled={Boolean(blocked) || pending}>{pending ? <Spinner data-icon="inline-start" /> : <LifeBuoyIcon data-icon="inline-start" />}Request handoff</Button>
      </div>
    </form>
  );
}
