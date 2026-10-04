"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BookCheckIcon, ListIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  canReadReceipt, destinationKeyValue, entryWords, forget, journalVersion, onJournalChange, readJournal, remoteKindWords, requestEntries, remoteArguments, sendRemote, recover, settle,
  type JournalEntry, type RemoteIo, type RemoteOutcome,
} from "@/lib/stack/source-setup";
import type { GithubRemoteReceipt } from "@/lib/stack/types";
import { CopyButton } from "./primitives";
import { waitingForIdentity } from "@/lib/stack/destination";
import { localOperation } from "@/lib/stack/state";
import { useDestination, useStack, useStore } from "./provider";
import { Stamp, sourceHint, sourceLabel, Word } from "./source-shared";

const none: JournalEntry[] = [];
const held = new Map<string, { version: number; entries: JournalEntry[] }>();

/** This destination's recorded remote requests for one receiver. Re-renders when any is written. */
export function useJournal(endpointId: string): JournalEntry[] {
  const { local } = useDestination();
  const snapshot = useCallback(() => {
    if (!local) return none;
    // Cached per destination: another platform's record is never served from here.
    const key = `${local.prefix}${endpointId}`, version = journalVersion(), cached = held.get(key);
    if (cached && cached.version === version) return cached.entries;
    const entries = readJournal(destinationKeyValue(local), endpointId);
    held.set(key, { version, entries });
    return entries;
  }, [endpointId, local]);
  return useSyncExternalStore(onJournalChange, snapshot, () => none);
}

/** Server-owned history plus this destination's not-yet-confirmed admissions. Empty storage is not empty history. */
export function useRequestHistory(endpointId: string) {
  const state = useStack();
  const store = useStore();
  const pending = useJournal(endpointId);
  const access = localOperation(state, "source", "github_remote_receipt_list");
  const available = access.available && state.status.source === "open";
  const resource = state.sourceReceipts[endpointId];
  useEffect(() => {
    if (available && !store.getState().sourceReceipts[endpointId]?.at && !store.getState().sourceReceiptPending[endpointId]) void store.loadSourceReceipts(endpointId);
  }, [store, endpointId, available]);
  const entries = useMemo(() => requestEntries(resource?.data?.entries ?? [], pending), [resource?.data, pending]);
  const history = { loaded: resource?.data !== null && resource?.data !== undefined,
    error: !access.available ? access.reason : state.status.source !== "open" ? "Source is disconnected" : resource?.error ?? null,
    unsettled: resource?.data?.unsettled ?? 0, more: resource?.data?.nextCursor != null, serverShown: resource?.data?.entries.length ?? 0 };
  return { entries, history, loading: Boolean(state.sourceReceiptPending[endpointId]),
    refresh: () => store.loadSourceReceipts(endpointId), more: () => store.loadSourceReceipts(endpointId, true) };
}

/**
 * Send a hook request exactly as it is recorded: the arguments come from the journal entry, so what was reviewed and recorded is what goes
 * out, with its own request ID. A lost answer is resolved by reading that ID's receipt; nothing here dispatches a request twice.
 */
export function useRemoteRequests(endpointId: string) {
  const store = useStore();
  const { local } = useDestination();
  const journal = useMemo(() => destinationKeyValue(local), [local]);
  const history = useRequestHistory(endpointId);
  const state = useStack();
  const canRecover = localOperation(state, "source", "github_remote_receipt_get").available && state.status.source === "open";
  const historyAt = state.sourceReceipts[endpointId]?.at;
  // Only the open setup panel migrates legacy browser history, using exact
  // receipt reads. Cards share list reads; no effect ever dispatches a mutation.
  useEffect(() => {
    if (!canRecover || !local || !historyAt) return;
    let stopped = false;
    const kv = destinationKeyValue(local);
    void (async () => {
      for (const entry of readJournal(kv, endpointId)) {
        if (stopped) break;
        try {
          const { receipt } = await store.call<{ receipt: GithubRemoteReceipt | null }>("source", "github_remote_receipt_get", { requestId: entry.requestId });
          if (!stopped && receipt) settle(kv, endpointId, entry.requestId, receipt);
        } catch { /* Failed reads keep the exact identity unconfirmed. */ }
      }
    })();
    return () => { stopped = true; };
  }, [store, endpointId, canRecover, local, historyAt]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const io = useMemo<RemoteIo>(() => ({
    dispatch: (entry) => {
      const request = remoteArguments(entry);
      if (!request) throw new Error("This request cannot be rebuilt from its record.");
      return store.call<GithubRemoteReceipt>("source", request.name, request.args);
    },
    readReceipt: async (requestId) => (await store.call<{ receipt: GithubRemoteReceipt | null }>("source", "github_remote_receipt_get", { requestId })).receipt,
  }), [store]);
  const note = (requestId: string, text: string | null) => setNotes((held) => { const next = { ...held }; if (text) next[requestId] = text; else delete next[requestId]; return next; });
  const describe = (outcome: RemoteOutcome): string | null => !outcome.sent ? outcome.reason
    : outcome.readError ? `The receipt could not be read: ${outcome.readError}` : outcome.error && outcome.entry.status !== "succeeded" ? `Answer received: ${outcome.error}` : null;
  // Each request is recorded before it is sent, so none is sent while this destination has nowhere to record it.
  const unseenUnsettled = history.history.unsettled > history.entries.filter(entry => entry.status === "running" || entry.status === "unknown").length;
  const waiting = !local ? waitingForIdentity : history.history.error ? `Read server request history before sending: ${history.history.error}`
    : !history.history.loaded ? "Reading server request history…" : unseenUnsettled ? "Older running or unknown requests exist. Read older receipts before sending a new request." : null;
  const send = async (entry: JournalEntry): Promise<RemoteOutcome> => {
    if (waiting) return { sent: false, reason: waiting };
    setBusy(entry.requestId); note(entry.requestId, null);
    try { const outcome = await sendRemote(journal, io, entry); note(entry.requestId, describe(outcome)); return outcome; } finally { setBusy(null); void history.refresh(); }
  };
  const read = async (entry: JournalEntry): Promise<RemoteOutcome> => {
    setBusy(entry.requestId); note(entry.requestId, null);
    try { const outcome = await recover(journal, io, entry); note(entry.requestId, outcome.readError ? `The receipt could not be read: ${outcome.readError}` : null); return outcome; } finally { setBusy(null); void history.refresh(); }
  };
  return { ...history, busy, notes, waiting, send, read, forget: (entry: JournalEntry) => { forget(journal, entry.endpointId, entry.requestId); note(entry.requestId, null); } };
}
export type RemoteRequests = ReturnType<typeof useRemoteRequests>;

/** The owner's retained requests are visible in every local browser. Only an unconfirmed browser record can be forgotten here. */
export function RequestList({ requests, connected, className }: { requests: RemoteRequests; connected: boolean; className?: string }) {
  const { entries } = requests;
  const unconfirmed = entries.filter(entry => entry.status === "pending").length;
  return (
    <section aria-label="Recorded requests" className={className ?? "flex flex-col gap-2"}>
      <span className={sourceLabel}>Remote request history</span>
      {requests.history.error ? <p role="alert" className="text-[0.72rem] text-warning">Request history unavailable: {requests.history.error}. Previously read receipts may be stale.</p>
        : !requests.history.loaded ? <p className={sourceHint}>Reading server request history…</p>
        : !entries.length ? <p className={sourceHint}>No requests recorded for this receiver on this server.</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="outline" disabled={!connected || requests.loading} onClick={() => void requests.refresh()}>
          {requests.loading ? <Spinner data-icon="inline-start" /> : <BookCheckIcon data-icon="inline-start" />}Read request history
        </Button>
        {requests.history.more ? <Button size="xs" variant="outline" disabled={!connected || requests.loading} onClick={() => void requests.more()}><ListIcon data-icon="inline-start" />Read older receipts</Button> : null}
      </div>
      {requests.history.loaded ? <p className={sourceHint}>{requests.history.serverShown} server receipts shown, newest admission first{requests.history.more ? "; older server receipts are available" : "; end of server history"}. {requests.history.unsettled} running or unknown across this receiver&rsquo;s server history.
        {unconfirmed ? ` ${unconfirmed} unconfirmed browser ${unconfirmed === 1 ? "request is" : "requests are"} shown first, separately from server history.` : ""}</p> : null}
      <ul className="flex flex-col gap-2">
        {[...entries].reverse().map((entry) => {
          const view = entryWords(entry), working = requests.busy === entry.requestId;
          return (
            <li key={entry.requestId} data-request={entry.requestId} data-status={entry.status} className="flex flex-col gap-1 rounded-lg border bg-background/60 p-2 text-[0.72rem]">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{remoteKindWords[entry.kind]}</span>
                <Word tone={view.tone} className="text-[0.72rem]">{view.word}</Word>
                <Stamp at={entry.at} className="ml-auto text-muted-foreground" />
              </div>
              {entry.status === "pending" ? <p className={sourceHint}>Unconfirmed request recorded in this browser</p> : null}
              <p className="min-w-0 break-words text-muted-foreground">{entry.intent}</p>
              <p className="flex min-w-0 items-center gap-1 text-[0.68rem] text-muted-foreground">Request <code className="min-w-0 truncate font-mono" title={entry.requestId}>{entry.requestId}</code>
                <CopyButton value={entry.requestId} label="request ID" className="opacity-100" /></p>
              <p className="text-pretty">{view.text}</p>
              {requests.notes[entry.requestId] ? <p role="status" className="text-warning">{requests.notes[entry.requestId]}</p> : null}
              <div className="flex flex-wrap items-center gap-1.5">
                {canReadReceipt(entry) ? (
                  <Button size="xs" variant="outline" disabled={!connected || working} onClick={() => void requests.read(entry)}>
                    {working ? <Spinner data-icon="inline-start" /> : <BookCheckIcon data-icon="inline-start" />}Read receipt
                  </Button>
                ) : null}
                {entry.status === "pending" ? <Button size="xs" variant="ghost" disabled={working} onClick={() => requests.forget(entry)} title="Forgets only this unconfirmed browser record. It does not cancel a delayed request or remove server history.">
                  <Trash2Icon data-icon="inline-start" />Forget this request
                </Button> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className={sourceHint}>Reading changes nothing at GitHub. Uncertain requests are never resent. Server receipts cannot be forgotten from this view; browser storage keeps only not-yet-confirmed admissions.</p>
    </section>
  );
}
