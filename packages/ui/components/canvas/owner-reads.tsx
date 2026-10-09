"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { emptyObservation, pagedObservation, ReadObservation, type ObservationSnapshot, type PageRead } from "@/lib/stack/observation";
import { localOperation, revisionChanged } from "@/lib/stack/state";
import { useStack } from "./provider";

export type ReadOwner = { pkg: string; operation: string; enabled?: boolean; revisionRefused?(error: unknown): boolean };
type Query<R> = { key: string; read: R };

/** Readiness is independent of identity. Owners declare their read operation, not duplicate transport checks. */
export function useReadUnavailable(owner: ReadOwner): string | null {
  const state = useStack();
  const access = localOperation(state, owner.pkg, owner.operation);
  return !access.available ? access.reason : state.status[owner.pkg] !== "open" ? `The ${owner.pkg} connection is not open.` : null;
}

/** Commit bindings outside render, before acquiring demand. A render for another query masks the old
 * snapshot immediately; Activity cleanup only releases demand, and is reversible. */
function useObservation<R, V>(observation: ReadObservation<Query<R>, V>, read: R, key: string | null, observe: unknown, unavailable: string | null) {
  const committed = useRef<{ key: string | null; observe: unknown; unavailable: string | null } | null>(null);
  useLayoutEffect(() => {
    const prior = committed.current;
    observation.configure(key === null ? null : { key, read }, unavailable);
    committed.current = { key, observe, unavailable };
    if (prior?.key === key && prior.unavailable === unavailable && !Object.is(prior.observe, observe)) void observation.invalidate();
  });
  useLayoutEffect(() => observation.activate(), [observation]);
  const snapshot = useSyncExternalStore(observation.subscribe, observation.getSnapshot, observation.getSnapshot);
  const current = snapshot.key === key ? snapshot : emptyObservation<V>(key, unavailable);
  // A readiness loss is also reflected in the render before the binding commit.
  return { ...current, unavailable, stale: current.stale || (unavailable !== null && current.evidence !== null),
    canMore: current.canMore && unavailable === null, refresh: observation.refresh, more: observation.more };
}

/** Single reads use precisely the same identity, acceptance and demand lifecycle as paged reads. */
export function useKeyedRead<T>(read: () => Promise<T>, key: string | null, observe: unknown, owner: ReadOwner) {
  const [observation] = useState(() => new ReadObservation<Query<() => Promise<T>>, T>({ key: (query) => query.key, read: (query) => query.read() }));
  const identity = key === null || owner.enabled === false ? null : JSON.stringify([owner.pkg, owner.operation, key]);
  const result = useObservation(observation, read, identity, observe, useReadUnavailable(owner));
  return { ...result, data: result.evidence?.value ?? null, hasRead: result.evidence !== null,
    loading: result.pending !== null, reload: result.refresh };
}

/** Sensitive details need a fresh explicit reveal for each intent identity. Ordinary invalidation
 * refreshes an open disclosure; a changed intent drops consent as well as fencing its answer. */
export function useRevealedRead<T>(read: () => Promise<T>, intent: string, observe: unknown, owner: ReadOwner) {
  const [consent, setConsent] = useState<string | null>(null);
  const committedIntent = useRef(intent);
  useLayoutEffect(() => { if (committedIntent.current !== intent) { committedIntent.current = intent; setConsent(null); } }, [intent]);
  const shown = consent === intent;
  const result = useKeyedRead(read, shown ? intent : null, observe, owner);
  return { ...result, shown, reveal: () => { if (shown) void result.refresh(); else setConsent(intent); }, hide: () => setConsent(null) };
}

/** Only genuinely revision-fenced owner pages use this adapter. Full latest-page metadata is typed
 * alongside accumulated items; no cast or first-page metadata cache is needed by a consumer. */
export function usePagedRead<T, Details extends object = object>(read: PageRead<T, Details>, key: string | null, observe: unknown, owner: ReadOwner) {
  const [observation] = useState(() => pagedObservation({
    key: (query: Query<PageRead<T, Details>>) => query.key,
    read: (query, offset, revision) => query.read(offset, revision),
    append: (held, page) => ({ ...page, items: [...held.items, ...page.items] }),
    revisionRefused: owner.revisionRefused ?? revisionChanged,
  }));
  const identity = key === null || owner.enabled === false ? null : JSON.stringify([owner.pkg, owner.operation, key]);
  const result = useObservation(observation, read, identity, observe, useReadUnavailable(owner));
  return { ...result, page: result.evidence?.value ?? null, loading: result.pending !== null };
}

/** Existing views use the same freshness vocabulary while retaining their owner-specific errors. */
export function ObservationStatus({ read }: { read: Pick<ObservationSnapshot<unknown>, "stale" | "pending" | "unavailable"> }) {
  const text = [read.unavailable, read.stale ? `Showing stale evidence${read.pending ? " · refreshing…" : "; refresh before relying on it."}` : null].filter(Boolean).join(" · ");
  return text ? <p role="status" className="text-xs text-pretty text-muted-foreground">{text}</p> : null;
}
