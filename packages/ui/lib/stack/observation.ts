/** Browser-safe read lifecycle shared by React views and Store resources. Subscriptions are passive;
 * only demand leases permit reads. No timer, transport cancellation or mutation recovery lives here. */
export type Evidence<T> = { value: T; receivedAt: number };
export type ObservationSnapshot<T> = {
  key: string | null;
  evidence: Evidence<T> | null;
  pending: "first" | "refresh" | "more" | null;
  stale: boolean;
  unavailable: string | null;
  error: string | null;
  canMore: boolean;
};

export type RevisionPage = { revision: string; nextOffset: number | null };
export type PageRead<T, Details extends object = object> = (offset: number, revision?: string) => Promise<Details & RevisionPage & { items: T[] }>;

type Continuation<V> = {
  next(value: V): { offset: number; revision: string } | null;
  append(held: V, page: V): V;
  revision(value: V): string;
  restart(value: V): V;
  revisionRefused(error: unknown): boolean;
};
type Binding<Q, V> = {
  key(query: Q): string;
  read(query: Q, position?: { offset: number; revision: string }): Promise<V>;
  continuation?: Continuation<V>;
  now?(): number;
};
type Flight = { obsolete: boolean; promise: Promise<void> };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export const emptyObservation = <T>(key: string | null = null, unavailable: string | null = null): ObservationSnapshot<T> => ({
  key, evidence: null, pending: null, stale: false, unavailable, error: null, canMore: false,
});

/** Store projections retain the established Resource shape without becoming observers. */
export type ObservedResource<T> = Omit<ObservationSnapshot<T>, "key" | "evidence"> & { data: T | null; at: number | null; hasRead: boolean };
export function observationResource<T>(snapshot: ObservationSnapshot<T>): ObservedResource<T> {
  const { key: _key, evidence, ...status } = snapshot;
  return { ...status, data: evidence?.value ?? null, at: evidence?.receivedAt ?? null, hasRead: evidence !== null };
}

export class ReadObservation<Q, V> {
  private snapshot = emptyObservation<V>();
  private query: Q | null = null;
  private listeners = new Set<() => void>();
  private demand = 0;
  private flight: Flight | null = null;
  private eligible = false;
  private owed = false;
  private readonly binding: Binding<Q, V>;

  constructor(binding: Binding<Q, V>) { this.binding = binding; }

  getSnapshot = (): ObservationSnapshot<V> => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<ObservationSnapshot<V>>): void {
    const next = { ...this.snapshot, ...patch };
    next.canMore = this.demand > 0 && !next.unavailable && !next.pending && this.eligible && !next.stale
      && next.evidence !== null && this.binding.continuation?.next(next.evidence.value) != null;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  /** Sever acceptance synchronously, even when inactive. A→B→A never revives an earlier flight. */
  private fence(): void { this.flight = null; this.owed = false; this.eligible = false; }

  /** Atomically commit identity and readiness. Adapters may replace same-key callbacks for future reads;
   * each admitted read keeps the query/callback it captured. Readiness never forms part of query identity. */
  configure(query: Q | null, unavailable: string | null = this.snapshot.unavailable): void {
    const key = query === null ? null : this.binding.key(query);
    const changed = key !== this.snapshot.key;
    const readinessChanged = unavailable !== this.snapshot.unavailable;
    this.query = query;
    if (!changed && !readinessChanged) return;
    this.fence();
    if (changed) this.publish(emptyObservation<V>(key, unavailable));
    else this.publish({ unavailable, pending: null, stale: this.snapshot.evidence !== null });
    if (this.ready()) void this.refresh();
  }

  setQuery(query: Q | null): void { this.configure(query); }
  setUnavailable(reason: string | null): void { this.configure(this.query, reason); }

  activate = (): (() => void) => {
    this.demand++;
    if (this.demand === 1) void this.refresh();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.demand !== 0) return;
      this.fence();
      this.publish({ pending: null, stale: this.snapshot.evidence !== null });
    };
  };

  private ready(): boolean { return this.demand > 0 && this.query !== null && this.snapshot.unavailable === null; }

  /** Repeated user refreshes coalesce. A refresh supersedes a continuation immediately. */
  refresh = (): Promise<void> => {
    if (!this.ready()) return Promise.resolve();
    if (this.flight && this.snapshot.pending !== "more") return this.flight.promise;
    if (this.flight) this.fence();
    return this.run(false);
  };

  /** Invalidation during a read makes that answer obsolete and owes one follow-up. Further notices
   * coalesce until that follow-up starts. Failures never schedule their own retry. */
  invalidate = (): Promise<void> => {
    this.eligible = false;
    if (this.flight) {
      this.flight.obsolete = true;
      this.owed = true;
      this.publish({ stale: this.snapshot.evidence !== null });
      return this.flight.promise;
    }
    this.publish({ stale: this.snapshot.evidence !== null });
    return this.refresh();
  };

  more = (): Promise<void> => {
    if (!this.snapshot.canMore) return this.flight?.promise ?? Promise.resolve();
    return this.run(true);
  };

  private run(more: boolean): Promise<void> {
    if (!this.ready()) return Promise.resolve();
    const query = this.query!, held = this.snapshot.evidence;
    const paging = this.binding.continuation;
    const position = more && held ? paging?.next(held.value) ?? undefined : undefined;
    if (more && !position) return Promise.resolve();
    if (!more) this.eligible = false;
    // Install the flight before publishing or invoking owner code (both can synchronously reenter).
    let finish!: () => void;
    const flight: Flight = { obsolete: false, promise: new Promise<void>((resolve) => { finish = resolve; }) };
    this.flight = flight;
    const current = () => this.flight === flight;
    const accept = () => current() && !flight.obsolete;
    this.publish({ pending: more ? "more" : held ? "refresh" : "first", error: null, stale: more ? this.snapshot.stale : held !== null });
    void (async () => {
      let replacing = !more;
      try {
        if (!accept() || !this.ready()) return;
        let value: V;
        try {
          value = await this.binding.read(query, position);
          if (!accept()) return;
          if (position && paging && held) {
            if (paging.revision(value) !== position.revision) {
              // A successful but mismatched page is also a refusal to continue this prefix.
              replacing = true;
            } else value = paging.append(held.value, value);
          }
        } catch (error) {
          if (!accept()) return;
          if (!position || !paging?.revisionRefused(error)) throw error;
          replacing = true;
        }
        if (more && replacing) {
          this.eligible = false;
          this.publish({ pending: "refresh", stale: held !== null });
          if (!accept() || !this.ready()) return;
          value = await this.binding.read(query);
          if (!accept()) return;
          value = paging!.restart(value);
        }
        if (!accept()) return;
        this.eligible = true;
        this.publish({ evidence: { value: value!, receivedAt: this.binding.now?.() ?? Date.now() }, pending: null, stale: false, error: null });
      } catch (error) {
        if (!accept()) return;
        if (replacing) this.eligible = false;
        this.publish({ pending: null, error: message(error), stale: replacing ? held !== null : this.snapshot.stale });
      } finally {
        if (current()) {
          this.flight = null;
          const follow = this.owed;
          this.owed = false;
          if (follow && this.ready()) await this.run(false);
        }
        finish();
      }
    })();
    return flight.promise;
  }
}

/** Full owner pages are values: append changes only the row field, and keeps the latest page's
 * complete typed metadata. Revision refusal wording belongs to each owner binding. */
export function pagedObservation<Q, P extends RevisionPage>(binding: {
  key(query: Q): string;
  read(query: Q, offset: number, revision?: string): Promise<P>;
  append(held: P, page: P): P;
  revisionRefused(error: unknown): boolean;
  now?(): number;
}): ReadObservation<Q, P & { restarted: boolean }> {
  return new ReadObservation<Q, P & { restarted: boolean }>({
    key: binding.key, now: binding.now,
    read: async (query, position) => ({ ...await binding.read(query, position?.offset ?? 0, position?.revision), restarted: false }),
    continuation: {
      next: (page) => page.nextOffset === null ? null : { offset: page.nextOffset, revision: page.revision },
      revision: (page) => page.revision,
      append: (held, page) => ({ ...binding.append(held, page), restarted: held.restarted }),
      restart: (page) => ({ ...page, restarted: true }),
      revisionRefused: binding.revisionRefused,
    },
  });
}
