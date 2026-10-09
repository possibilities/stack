import { pagedObservation } from "./observation";
import type { SpaceId } from "./spaces";
import type { NodeRef, PackageDoc, ServeCompletionPage, ServeCompletionReceipt, ServeOccurrencePage, ServeStateList, ServeSubscriptionPage, StateApplyInput, StateEntry, StateLink, StateOwner, StatePlan, StateReceiptStatus, StateRelationship } from "./types";

/**
 * Owner state inspection, observation bindings and plan/receipt presentation helpers (docs/state-control.md). Pure and
 * browser-safe: the wire types are mirrored in `types.ts`, never imported from the Node-backed `@stack/api`.
 */

type Call = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;

/** Serve observation bindings use the contract's largest page. */
export const statePageLimit = 100;

/** Owners are a selection, never an implied "all known"; null reads every owner the Server lists. */
export type StateSelection = { owners: string[] | null; measure: boolean };

/** Loaded pages of one `serve_state_list` observation. */
export type StateInventory = ServeStateList & {
  selection: StateSelection;
  /** Set when a continuation found the observation changed, so paging started again from the first page. */
  restarted: boolean;
};

export type SubscriptionFilter = { botId?: string; threadId?: string; package?: string };
export type SubscriptionList = ServeSubscriptionPage & { filter: SubscriptionFilter; restarted: boolean };
export type CompletionFilter = { botId?: string; package?: string; state?: ServeCompletionReceipt["state"] };
/** The page filter plus the exact-record arguments domain views add for a single admission. */
export type ReceiptQuery = CompletionFilter & { operation?: string; threadId?: string; recordId?: string; limit?: number };
export type CompletionList = ServeCompletionPage & { filter: ReceiptQuery; restarted: boolean };
export type OccurrenceFilter = { botId?: string; package?: string };
export type OccurrenceList = ServeOccurrencePage & { filter: OccurrenceFilter; restarted: boolean };

/** The owner refused a continuation because its observation changed since the first page. */
export function revisionChanged(error: unknown): boolean {
  return error instanceof Error && /restart paging/.test(error.message);
}

function inventoryArgs(selection: StateSelection, offset: number, revision?: string): Record<string, unknown> {
  return { ...(selection.owners ? { owners: selection.owners } : {}), measure: selection.measure, offset, limit: statePageLimit, ...(revision ? { revision } : {}) };
}

export const inventoryObservation = (call: Call) => pagedObservation({
  key: (selection: StateSelection) => JSON.stringify([selection.owners ? [...selection.owners].sort() : null, selection.measure, statePageLimit]),
  read: async (selection, offset, revision) => ({ ...await call<ServeStateList>("serve_state_list", inventoryArgs(selection, offset, revision)), selection }),
  append: (held, page) => ({ ...page, entries: [...held.entries, ...page.entries] }),
  revisionRefused: revisionChanged,
});

function subscriptionArgs(filter: Record<string, string | number | undefined>, offset: number, revision?: string): Record<string, unknown> {
  const exact = Object.fromEntries(Object.entries(filter).filter(([, value]) => typeof value === "string" && value.length > 0));
  const limit = typeof filter.limit === "number" ? filter.limit : statePageLimit;
  return { ...exact, offset, limit, ...(revision ? { revision } : {}) };
}

const filterKey = (filter: Record<string, string | number | undefined>) => JSON.stringify(Object.entries(subscriptionArgs(filter, 0)).sort(([a], [b]) => a.localeCompare(b)));

export const subscriptionsObservation = (call: Call) => pagedObservation({
  key: (filter: SubscriptionFilter) => filterKey(filter),
  read: async (filter, offset, revision) => ({ ...await call<ServeSubscriptionPage>("serve_subscription_list", subscriptionArgs(filter, offset, revision)), filter }),
  append: (held, page) => ({ ...page, subscriptions: [...held.subscriptions, ...page.subscriptions] }),
  revisionRefused: revisionChanged,
});

export const completionsObservation = (call: Call) => pagedObservation({
  key: (filter: ReceiptQuery) => filterKey(filter),
  read: async (filter, offset, revision) => ({ ...await call<ServeCompletionPage>("serve_completion_list", subscriptionArgs(filter, offset, revision)), filter }),
  append: (held, page) => ({ ...page, completions: [...held.completions, ...page.completions] }),
  revisionRefused: revisionChanged,
});

export const occurrencesObservation = (call: Call) => pagedObservation({
  key: (filter: OccurrenceFilter) => filterKey(filter),
  read: async (filter, offset, revision) => ({ ...await call<ServeOccurrencePage>("serve_occurrence_list", subscriptionArgs(filter, offset, revision)), filter }),
  append: (held, page) => ({ ...page, subscriptions: [...held.subscriptions, ...page.subscriptions] }),
  revisionRefused: revisionChanged,
});

export type LocalAccess = { available: true } | { available: false; reason: string };

/**
 * Whether this page may call one state operation. State controls are local operator authority: remote Access
 * refuses them even when read-only, and the live WebSocket selection decides what the local gateway forwards.
 */
export function localOperation(state: { remote?: unknown; catalog: { data: PackageDoc[] | null } }, pkg: string, name: string): LocalAccess {
  if (state.remote) return { available: false, reason: "State inspection and maintenance are available only on the local UI." };
  const doc = state.catalog.data?.find((item) => item.name === pkg);
  if (!state.catalog.data) return { available: false, reason: "Reading API discovery…" };
  if (!doc) return { available: false, reason: `${pkg} is not in API discovery.` };
  const websocket = doc.transports.find((transport) => transport.type === "websocket");
  if (!websocket?.operations.includes(name)) return { available: false, reason: `${pkg} does not expose ${name} on its WebSocket.` };
  return { available: true };
}

/**
 * Whether one control may be used: every operation it calls must be selected on the live WebSocket. A plan, its apply
 * and its receipt read are three independent selections, so a control that checked only the plan could prepare a
 * plan it could never apply or read back.
 */
export function localOperations(state: Parameters<typeof localOperation>[0], pkg: string, names: readonly string[]): LocalAccess {
  for (const name of names) {
    const access = localOperation(state, pkg, name);
    if (!access.available) return access;
  }
  return { available: true };
}

/** Where each owner's existing controls live. The State window links there rather than acting itself. */
export const ownerHomes: Record<string, { space: SpaceId; title: string }> = {
  bots: { space: "fleet", title: "Fleet" }, worker: { space: "workers", title: "Workers" }, signal: { space: "signal", title: "Signal" },
  infer: { space: "lab", title: "Lab" }, notify: { space: "inbox", title: "Inbox" }, content: { space: "content", title: "Content" },
  proc: { space: "proc", title: "Proc" }, usage: { space: "accounts", title: "Accounts" }, auth: { space: "accounts", title: "Accounts" },
  hud: { space: "hud", title: "HUD" }, brain: { space: "brain", title: "Brain" }, browse: { space: "browse", title: "Browse" }, source: { space: "source", title: "Source" },
  roles: { space: "roles", title: "Roles" }, scrape: { space: "scrape", title: "Scrape" }, access: { space: "system", title: "System" },
  serve: { space: "system", title: "System" }, xcom: { space: "system", title: "System" },
};

/** Maintained backend gaps (docs/state-control.md): shown as unsupported, never offered as controls. */
export const ownerGaps: Record<string, string> = {
  worker: "Native purge requires disabled/drained accounts, idle sign-in and verified macOS scope on OpenCode 2.0.16, Devin 3000.11.3 or Claude SDK 0.3.283. Unknown versions, unsafe scope and external writers block it. No session reset/reopening, profile erasure, remote branch or retained-ref collection; native logs/caches/shared blobs, shares and backups remain independent.",
  browse: "Site data is exact HTTP(S) origins and cookies/storage/CacheStorage only; scoped HTTP-cache and persisted-history clearing are unsupported. Native pages/external writers may recreate data; quota checks are not complete local-storage byte proof. Only verified unreferenced/unmounted owned volumes are collectible; bytes are unmeasured. Caller/upstream copies, other profiles and external backups remain independent.",
  brain: "Stranded-Artifact collection remains API-only: no UI surface lists exact stranded digests. Missing/corrupt Artifact paths without exact file snapshots cannot be collected. Indexed documents and immutable recovery authority, independent Artifact/backup copies and device outboxes remain separate from payload maintenance.",
  scrape: "Authenticated browser-session state belongs to Browse. Unattributed publication/retirement quarantine remains under its existing recovery authority. Claims are never broken; external destinations, shipped fixtures/presets/canaries, temporary publications and backups are outside queue/local-capture maintenance. Retry admits a new generation, not extraction completion.",
  roles: "Live launches, missing/legacy locks and interrupted native teardown block launch-directory clearing. External native histories and credentials and Bot/Worker materializations remain separate.",
  auth: "Only Codex OpenCode cache/opencode/models.json is supported after disabled account, idle sign-in and verified drained runtime/catalog/teardown. Devin/Claude and other profile files are unsupported; credentials and native sessions remain.",
  access: "Only expired UI-session, pairing and invitation metadata can be cleared. Active/unexpired authority requires separate revocation. Audit has no manual prune; automatic cleanup can leave more than 1,000 observed rows. Device/browser copies remain independent.",
  hud: "Physical media and backup erasure, and other owners' copies such as Worker-captured Work context, are out of scope.",
  source: "Only original signed payloads of up to 100 exact deliveries can be cleared, from the Source space. Receiver secrets and configuration, summaries, digests, duplicate fences, watch matches and remote request receipts stay, and clearing is neither secure erasure nor recovery of what GitHub did not deliver.",
  bots: "Native Codex queue and history copies and backups are out of scope. Queue entries without a recorded generation can be cleared by exact ID only.",
  signal: "Checkpoint rebaseline skips current upstream messages, not historical replay or transcript erase. Future sources are not included; captured evidence and independent Infer payloads remain.",
  infer: "Catalog eviction is memory-only and leaves no receipt. It never refreshes models or touches dispatched requests, traces or credentials.",
  proc: "Definition redaction covers removed schedules only. Active and Brain-protected schedules, captured executions and process output are separate selections.",
  content: "Temporary publication collection covers exact claimed dead-writer paths only; legacy/unattributed paths and quarantine remain. Vault history is read-only disclosure, not Git-history purge or rewrite. Remotes, backups and device copies remain independent; no device-local reset is available.",
};

/** A link with empty arguments names an operation, not a resource: it is never callable from the inventory. */
export function linkNeedsSelection(link: StateLink): boolean {
  return Object.keys(link.arguments).length === 0;
}

export function operationNode(link: Pick<StateLink, "package" | "operation">): NodeRef {
  return { kind: "operation", pkg: link.package, id: link.operation };
}

/** Relationships to records the Canvas already shows; anything else is listed without a link. */
export function relationshipNode(relation: StateRelationship): NodeRef | null {
  const key = `${relation.package}/${relation.kind}`;
  const kinds: Record<string, NodeRef["kind"]> = {
    "serve/subscription": "subscription", "proc/schedule": "proc-schedule", "proc/run": "proc-run",
    "browse/browser-profile": "browser-profile", "worker/worker": "worker", "bots/bot": "bot",
  };
  const kind = kinds[key];
  return kind ? { kind, id: relation.id } as NodeRef : null;
}

/** Every owner pages its own categories with `<owner>_state_read`. */
export const ownerStateRead = (pkg: string) => `${pkg}_state_read`;

/** Entries grouped under every selected owner, keeping owners with no loaded entries (and unavailable owners) visible. */
export function groupByOwner(inventory: StateInventory): { owner: StateOwner; entries: StateEntry[] }[] {
  return inventory.owners.map((owner) => ({ owner, entries: inventory.entries.filter((entry) => entry.ownerPackage === owner.package) }));
}

/** Measurement words for one nullable count: null is unmeasured, never zero. */
export function measured(value: number | null, format: (value: number) => string): string {
  return value === null ? "unmeasured" : format(value);
}

export type PlanReadiness = { canApply: boolean; blocked: boolean; expired: boolean; reason: string | null };

export function planReadiness(plan: StatePlan, now: number): PlanReadiness {
  const expired = Date.parse(plan.expiresAt) <= now;
  const blocked = plan.blockedBy.length > 0;
  return { canApply: !expired && !blocked, blocked, expired,
    reason: blocked ? "Resolve every blocker, then prepare a new plan." : expired ? "This plan expired. Prepare a new plan to choose again." : null };
}

/** The exact apply input. Owner-specific identity (a Bot's `botId`) is added by the caller, never inferred. */
export function applyInput<Extra extends Record<string, string>>(plan: StatePlan, requestId: string, extra?: Extra): StateApplyInput & Extra {
  return { planId: plan.id, expectedRevision: plan.revision, requestId, ...(extra ?? {}) } as StateApplyInput & Extra;
}

/** Running is still observed; blocked and completed are settled; partial and unknown stay uncertain until inspected. */
export function receiptTone(status: StateReceiptStatus): "success" | "warning" | "destructive" | "info" {
  return status === "completed" ? "success" : status === "running" ? "info" : status === "blocked" ? "destructive" : "warning";
}

export const receiptWords: Record<StateReceiptStatus, string> = {
  running: "Running. Read this receipt again to observe it.",
  completed: "Completed for the declared scope only.",
  partial: "Partial. Some resources were not processed as planned. Inspect them; this request will not run again.",
  blocked: "Blocked. Nothing past the blocker ran.",
  unknown: "Unknown. The owner cannot say what happened. Inspect the exact resources; this request will not run again.",
};
