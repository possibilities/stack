import { profileName } from "./browse";
import { ReadObservation } from "./observation";
import type { BrowserExtension, BrowserExtensionConfiguration, BrowserExtensionRef, BrowserHandoff, BrowserProfile, BrowserVaultBackup, BrowserVaultConnection, BrowserVaultStatus } from "./types";

/*
 * Browser extensions and the agent password manager (ADR 0187). Catalog presence, saved selection, last successful
 * application and timestamped observation are separate facts; so are service health, registration, account sign-in,
 * client unlock and sync. Nothing here infers one from another, and nothing here holds a password.
 */

export const extensionIdPattern = /^[a-z][a-z0-9-]{0,47}$/;
/** The backend's per-profile selection limit: unique catalog IDs. */
export const extensionSelectionLimit = 32;
/** The catalog ID the pinned official installer owns; imports may not use it. */
export const bitwardenId = "bitwarden";

export const extensionKey = (ref: BrowserExtensionRef): string => `${ref.id}@${ref.digest}`;

/** A manifest name that is an unresolved localization key, which says nothing a person can read. */
export function extensionLabel(record: Pick<BrowserExtension, "id" | "name">): { text: string; localized: boolean } {
  return /^__MSG_.+__$/.test(record.name) ? { text: record.id, localized: true } : { text: record.name, localized: false };
}

/** Catalog versions grouped by stable catalog ID, newest import first. Distinct digests stay distinct even when their version labels match. */
export function catalogGroups(extensions: readonly BrowserExtension[]): Array<{ id: string; chromeId: string; versions: BrowserExtension[]; repeatedLabels: string[] }> {
  const groups = new Map<string, BrowserExtension[]>();
  for (const record of extensions) groups.set(record.id, [...(groups.get(record.id) ?? []), record]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([id, versions]) => {
    const sorted = [...versions].sort((a, b) => Date.parse(b.importedAt) - Date.parse(a.importedAt) || a.digest.localeCompare(b.digest));
    const labels = sorted.map((row) => row.version);
    return { id, chromeId: sorted[0].chromeId, versions: sorted, repeatedLabels: [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))] };
  });
}

export function findExtension(catalog: readonly BrowserExtension[] | null, ref: BrowserExtensionRef): BrowserExtension | null {
  return catalog?.find((row) => row.id === ref.id && row.digest === ref.digest) ?? null;
}

/** Exact equality of two selections: same catalog IDs at the same digests. A matching version label is not the same bytes. */
export function sameSelection(a: readonly BrowserExtensionRef[] | null, b: readonly BrowserExtensionRef[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((ref) => b.some((other) => other.id === ref.id && other.digest === ref.digest));
}

export type SelectionChange = { id: string; from: string | null; to: string | null };
/** What applying `next` over `base` would change, by catalog ID and exact digest. Removal disables; it never uninstalls. */
export function selectionChanges(base: readonly BrowserExtensionRef[] | null, next: readonly BrowserExtensionRef[]): SelectionChange[] {
  const ids = [...new Set([...(base ?? []).map((ref) => ref.id), ...next.map((ref) => ref.id)])].sort();
  return ids.flatMap((id) => {
    const from = base?.find((ref) => ref.id === id)?.digest ?? null, to = next.find((ref) => ref.id === id)?.digest ?? null;
    return from === to ? [] : [{ id, from, to }];
  });
}

/** Why an import cannot be sent, or null. The path names a file on the Stack server; nothing is uploaded from this device. */
export function importBlock(id: string, path: string): string | null {
  if (!id) return "Enter a catalog ID";
  if (!extensionIdPattern.test(id)) return "Catalog IDs are a lowercase letter, then up to 47 lowercase letters, digits and hyphens";
  if (id === bitwardenId) return "bitwarden is reserved for the pinned official installer";
  if (!path) return "Enter the absolute directory or ZIP path on the Stack server";
  if (!path.startsWith("/")) return "Use an absolute path on the Stack server";
  if (path.length > 4096) return "Paths are at most 4096 characters";
  return null;
}

/**
 * A person's unsaved choice. `vaultId` is tri-state like the API: undefined preserves the saved binding, null removes
 * it, a UUID sets it. `base` is the configuration revision the draft was started from; it changes only deliberately.
 */
export type ExtensionDraft = { base: string; refs: BrowserExtensionRef[]; vaultId?: string | null };

export function draftFrom(config: BrowserExtensionConfiguration): ExtensionDraft {
  return { base: config.revision, refs: config.desired.map((ref) => ({ ...ref })) };
}

/** Choose one exact version of a catalog ID, or none. */
export function chooseVersion(draft: ExtensionDraft, id: string, digest: string | null): ExtensionDraft {
  const refs = draft.refs.filter((ref) => ref.id !== id);
  return { ...draft, refs: digest ? [...refs, { id, digest }].sort((a, b) => a.id.localeCompare(b.id)) : refs };
}

/** Whether a draft differs from what is saved: selection, or an explicit binding change. */
export function draftChanged(draft: ExtensionDraft, config: BrowserExtensionConfiguration): boolean {
  return !sameSelection(draft.refs, config.desired) || (draft.vaultId !== undefined && draft.vaultId !== config.vaultId);
}

/** Why the draft cannot be saved, or null. A stale base is reported, never silently rebased. */
export function draftBlock(draft: ExtensionDraft, config: BrowserExtensionConfiguration | null, catalog: readonly BrowserExtension[] | null): string | null {
  if (!config || !catalog) return "Read the saved configuration and catalog first";
  if (draft.base !== config.revision) return "The saved configuration changed since this draft began. Review the current values, then rebase deliberately";
  if (draft.refs.length > extensionSelectionLimit) return `Select at most ${extensionSelectionLimit} extensions`;
  if (new Set(draft.refs.map((ref) => ref.id)).size !== draft.refs.length) return "Select each catalog ID once";
  if (draft.refs.some((ref) => !findExtension(catalog, ref))) return "A selected version is not in the catalog";
  if (!draftChanged(draft, config)) return "Nothing to save";
  return null;
}

/** The exact `browser_profile_extensions_set` input. An omitted vaultId preserves the saved binding. */
export function setInput(profileId: string, draft: ExtensionDraft): Record<string, unknown> {
  return { profileId, expectedRevision: draft.base, extensions: draft.refs.map((ref) => ({ id: ref.id, digest: ref.digest })), ...(draft.vaultId !== undefined ? { vaultId: draft.vaultId } : {}) };
}

/** A stale save: the configuration revision moved under this draft. */
export function staleConfiguration(error: unknown): boolean {
  return /configuration changed/i.test(error instanceof Error ? error.message : String(error));
}

export function sameConnection(a: BrowserVaultConnection | null, b: BrowserVaultConnection | null): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.origin === b.origin && a.hostname === b.hostname && a.ip === b.ip && a.spki === b.spki;
}

/** Each applied catalog version beside what the last observation saw of its Chrome identity and version. */
export function appliedObservations(config: BrowserExtensionConfiguration, catalog: readonly BrowserExtension[] | null): Array<{ ref: BrowserExtensionRef; record: BrowserExtension | null; observed: "matching" | "different" | "absent" | "unobserved" }> {
  return (config.applied ?? []).map((ref) => {
    const record = findExtension(catalog, ref);
    if (!config.observed || !record) return { ref, record, observed: "unobserved" as const };
    const loaded = config.observed.find((row) => row.id === record.chromeId);
    return { ref, record, observed: !loaded ? "absent" as const : loaded.version === record.version ? "matching" as const : "different" as const };
  });
}

export type ManagementPage = { kind: "vault"; entry?: "vault" | "register" } | { kind: "extension"; id: string; entry: "popup" | "options" };
export type ManagementEntry = { key: string; label: string; page: ManagementPage; reason: string | null };

/**
 * The management pages this profile can open now, mirroring the owner's refusals. Entries exist only for an applied
 * vault binding and for declared popup/options paths of applied versions; nothing builds a URL from text.
 */
export function managementEntries(config: BrowserExtensionConfiguration | null, catalog: readonly BrowserExtension[] | null, vault: BrowserVaultStatus | null): ManagementEntry[] {
  if (!config) return [];
  const entries: ManagementEntry[] = [];
  const applied = config.appliedVault;
  const vaultReason = !applied ? "No vault connection is applied to this profile"
    : !vault ? "Read the service status first"
    : vault.id !== applied.id ? "The applied vault is not the current managed service"
    : vault.fence ? "The service has an unresolved effect fence"
    : !vault.healthy || !vault.connection ? "The service is not verified healthy"
    : !sameConnection(vault.connection, applied) ? "The service's verified connection differs from the applied one; reapply this profile's configuration" : null;
  entries.push({ key: "vault", label: "Vault web interface", page: { kind: "vault" }, reason: vaultReason });
  entries.push({ key: "vault:register", label: "Vault account registration", page: { kind: "vault", entry: "register" },
    reason: vaultReason ?? (vault?.signupsAllowed ? null : "Registration is closed on the service") });
  for (const ref of config.applied ?? []) {
    const record = findExtension(catalog, ref);
    if (!record) continue;
    for (const entry of ["popup", "options"] as const) if (record[entry]) {
      entries.push({ key: `extension:${ref.id}:${entry}`, label: `${extensionLabel(record).text} ${entry}`, page: { kind: "extension", id: ref.id, entry }, reason: null });
    }
  }
  return entries;
}

/** The one requested-handoff blocker the owner checks before admission, or null. */
export function operatorRequestBlock(profile: Pick<BrowserProfile, "id" | "state" | "maintenanceRequestId"> | null, handoffs: readonly BrowserHandoff[] | null): string | null {
  if (!profile) return "Choose a profile";
  if (!handoffs) return "Read handoffs first";
  if (profile.maintenanceRequestId) return "Profile maintenance is fenced";
  if (handoffs.some((item) => item.profileId === profile.id && item.state !== "resolved")) return "A handoff already holds this profile";
  if (profile.state !== "ready") return "Start the profile and wait for readiness; requesting never launches it";
  return null;
}

/* ---------- Exact-input records saved before send ---------- */

type Area = { getItem(name: string): string | null; setItem(name: string, value: string): void; removeItem(name: string): void };

export type OperatorRequestRecord = { profileId: string; requestId: string; message: string; at: number };
export type PageOpenRecord = { handoffId: string; expectedRevision: number; requestId: string; page: ManagementPage; at: number };
const operatorKey = (profileId: string) => `uix.browse.operator-request.${profileId}`;
const pageKey = (handoffId: string) => `uix.browse.page-open.${handoffId}`;

function read<T>(storage: Area | null, key: string, valid: (value: Record<string, unknown>) => boolean): T | null | "invalid" {
  let raw: string | null;
  try { raw = storage?.getItem(key) ?? null; } catch { return "invalid"; }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && valid(value) ? value as T : "invalid";
  } catch { return "invalid"; }
}

/** Record exactly, then read back: false means it is not held and the request must not be sent. */
function write(storage: Area | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    const raw = JSON.stringify(value);
    storage.setItem(key, raw);
    return storage.getItem(key) === raw;
  } catch { return false; }
}

function remove(storage: Area | null, key: string): boolean {
  if (!storage) return false;
  try { storage.removeItem(key); return storage.getItem(key) === null; } catch { return false; }
}

const isPage = (page: unknown): page is ManagementPage => {
  if (!page || typeof page !== "object") return false;
  const value = page as Record<string, unknown>;
  if (value.kind === "vault") return value.entry === undefined || value.entry === "vault" || value.entry === "register";
  return value.kind === "extension" && typeof value.id === "string" && (value.entry === "popup" || value.entry === "options");
};

export const loadOperatorRequest = (storage: Area | null, profileId: string) => read<OperatorRequestRecord>(storage, operatorKey(profileId),
  (value) => value.profileId === profileId && typeof value.requestId === "string" && !!value.requestId && typeof value.message === "string" && typeof value.at === "number");
export const saveOperatorRequest = (storage: Area | null, record: OperatorRequestRecord) => write(storage, operatorKey(record.profileId), record);
export const clearOperatorRequest = (storage: Area | null, profileId: string) => remove(storage, operatorKey(profileId));

export const loadPageOpen = (storage: Area | null, handoffId: string) => read<PageOpenRecord>(storage, pageKey(handoffId),
  (value) => value.handoffId === handoffId && typeof value.requestId === "string" && !!value.requestId && typeof value.expectedRevision === "number" && isPage(value.page) && typeof value.at === "number");
export const savePageOpen = (storage: Area | null, record: PageOpenRecord) => write(storage, pageKey(record.handoffId), record);
export const clearPageOpen = (storage: Area | null, handoffId: string) => remove(storage, pageKey(handoffId));

/** The exact `browser_management_page_open` input a record names. */
export function pageOpenInput(record: PageOpenRecord): Record<string, unknown> {
  return { handoffId: record.handoffId, expectedRevision: record.expectedRevision, requestId: record.requestId, page: record.page };
}

/** The handoff an operator request admitted: same origin, request ID and profile. Anything else is not evidence. */
export function matchOperatorRequest(handoffs: readonly BrowserHandoff[] | null, record: Pick<OperatorRequestRecord, "profileId" | "requestId">): BrowserHandoff | null {
  return handoffs?.find((item) => item.origin === "operator" && item.requestId === record.requestId && item.profileId === record.profileId) ?? null;
}

/** The newer of the store's handoff and one an owner call returned: take must use the revision the owner last answered. */
export function newestHandoff(held: BrowserHandoff | null, returned: BrowserHandoff | null): BrowserHandoff | null {
  if (!returned || returned.id !== held?.id) return held;
  return returned.revision > held.revision ? returned : held;
}

/* ---------- Service status ---------- */

export type VaultAction = "start" | "stop" | "backup" | "delete" | "restore";
export const vaultActions: VaultAction[] = ["start", "stop", "backup", "delete", "restore"];

/** The exact plan selection: registration belongs only to start, a backup only to restore. */
export function vaultSelection(action: VaultAction, signupsAllowed: boolean | null, backupId: string | null): Record<string, unknown> {
  if (action === "start") return { action, signupsAllowed: signupsAllowed === true };
  if (action === "restore") return backupId ? { action, backupId } : { action };
  return { action };
}

/** A domain prerequisite for preparing one action, or null. The owner's plan blockers stay authoritative. */
export function vaultPrerequisite(action: VaultAction, signupsAllowed: boolean | null, backupId: string | null, backups: readonly BrowserVaultBackup[] | null): string | null {
  if (action === "start" && signupsAllowed === null) return "Choose whether registration is open or closed";
  if (action === "restore") {
    if (!backups) return "Read the backup list first";
    if (!backupId) return "Choose an exact listed backup";
    if (!backups.some((row) => row.id === backupId)) return "That backup is no longer listed";
  }
  return null;
}

/** Whether service state can still be settling without an owner notice: worth bounded polling while visible. */
export function vaultSettling(status: BrowserVaultStatus | null): boolean {
  if (!status || status.state === "absent") return false;
  return status.desiredRunning ? status.state !== "running" || !status.healthy : status.state === "running";
}

export const vaultStateWords: Record<BrowserVaultStatus["state"], { label: string; tone: "success" | "warning" | "destructive" | "muted" }> = {
  absent: { label: "No managed service", tone: "muted" },
  running: { label: "VM running", tone: "success" },
  stopped: { label: "VM stopped", tone: "muted" },
  unavailable: { label: "Unavailable", tone: "destructive" },
};

export type SetupStep = { key: string; title: string; state: "observed" | "pending" | "human"; detail: string };

/**
 * First-use setup as facts Stack can observe beside the human steps it cannot. Nothing is marked done because a button
 * was clicked or a handoff was finished; account creation, extension sign-in, the timeout policy and unlock are never observable here.
 */
export function setupSteps({ status, bitwarden, profile, config }: {
  status: BrowserVaultStatus | null; bitwarden: BrowserExtension | null; profile: BrowserProfile | null; config: BrowserExtensionConfiguration | null;
}): SetupStep[] {
  const service = !!status && status.state === "running" && status.healthy && !status.fence;
  const saved = config?.desired.find((ref) => ref.id === bitwardenId) ?? null;
  const applied = config?.applied?.find((ref) => ref.id === bitwardenId) ?? null;
  const record = applied && bitwarden?.digest === applied.digest ? bitwarden : null;
  const loaded = !!record && !!config?.observed?.some((row) => row.id === record.chromeId && row.version === record.version);
  const bound = !!status?.id && config?.vaultId === status.id;
  const connected = !!status?.id && config?.appliedVault?.id === status.id;
  return [
    { key: "service", title: "Service started and verified healthy", state: service ? "observed" : "pending",
      detail: !status ? "Service status not read" : status.state === "absent" ? "No managed service yet: plan Start, with registration open for account creation"
        : service ? `Running · HTTPS verified · registration ${status.signupsAllowed ? "open" : "closed"}` : `${vaultStateWords[status.state].label}${status.healthy ? "" : " · HTTPS not verified"}${status.fence ? " · fenced" : ""}` },
    { key: "bitwarden", title: "Bitwarden in the catalog", state: bitwarden ? "observed" : "pending",
      detail: bitwarden ? `${bitwarden.version} · digest ${bitwarden.digest.slice(0, 12)}` : "Install the pinned release explicitly" },
    { key: "profile", title: "Management profile chosen and ready", state: profile?.state === "ready" ? "observed" : "pending",
      detail: !profile ? "Choose a dedicated named browser" : `${profileName(profile)} · ${profile.state}` },
    { key: "saved", title: "Bitwarden and this service saved on the profile", state: saved && bound ? "observed" : "pending",
      detail: !config ? "Configuration not read" : `${saved ? `Bitwarden ${saved.digest.slice(0, 12)}` : "Bitwarden not saved"} · ${bound ? "service bound" : "service not bound"}` },
    { key: "applied", title: "Saved configuration applied and observed", state: applied && connected && loaded ? "observed" : "pending",
      detail: !config ? "Configuration not read" : `${applied ? "Bitwarden applied" : "Bitwarden not applied"} · ${connected ? "vault connection applied" : "no vault connection applied"} · ${loaded ? "loaded when observed" : "not observed loaded"}` },
    { key: "account", title: "Create the dedicated agent account", state: "human",
      detail: `Through an operator handoff on the registration page, in the upstream form. Registration is ${status?.signupsAllowed ? "open now" : "closed now; it must be open to register"}.` },
    { key: "closed", title: "Registration closed again", state: status && status.state === "running" && status.healthy && !status.signupsAllowed ? "observed" : "pending",
      detail: status?.signupsAllowed ? "Open: explicitly Stop, then Start with registration closed, each with its own reviewed plan" : "Closed on the current service" },
    { key: "extension", title: "Sign in to Bitwarden and choose its timeout", state: "human",
      detail: `In the extension popup: self-hosted at ${config?.appliedVault?.origin ?? "the applied vault origin"}, the dedicated account, and Never only if unattended use is intended.` },
    { key: "verify", title: "Agent verifies with a fresh snapshot", state: "human", detail: "Stack has no unlock observation; health, a loaded extension or a finished handoff never mean unlocked." },
  ];
}

/* ---------- Store-owned observations ---------- */

type Call = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
type Query = { scope: string; profileId?: string };
export const browseManagementReads = {
  catalog: "browser_extension_list", configuration: "browser_profile_extensions_get", vault: "browser_vault_status", backups: "browser_vault_backup_list",
} as const;
const key = (operation: string) => (query: Query) => JSON.stringify([query.scope, operation, query.profileId ?? null]);

/**
 * Catalog, service status, backups and per-profile configurations. Views hold demand leases; hidden panes release them,
 * which fences late answers without forgetting evidence. Owner notices invalidate; they carry no records.
 */
export class BrowseManagementReads {
  readonly catalog: ReadObservation<Query, BrowserExtension[]>;
  readonly vault: ReadObservation<Query, BrowserVaultStatus>;
  readonly backups: ReadObservation<Query, BrowserVaultBackup[]>;
  private readonly configurations = new Map<string, ReadObservation<Query, BrowserExtensionConfiguration>>();
  private scope = "unnamed";
  private readiness: (operation: string) => string | null = () => "Store is stopped.";
  private readonly call: Call;

  constructor(call: Call, now?: () => number) {
    this.call = call;
    this.catalog = new ReadObservation({ key: key(browseManagementReads.catalog), now, read: () => this.call<{ extensions: BrowserExtension[] }>(browseManagementReads.catalog).then((value) => value.extensions) });
    this.vault = new ReadObservation({ key: key(browseManagementReads.vault), now, read: () => this.call<BrowserVaultStatus>(browseManagementReads.vault) });
    this.backups = new ReadObservation({ key: key(browseManagementReads.backups), now, read: () => this.call<{ backups: BrowserVaultBackup[] }>(browseManagementReads.backups).then((value) => value.backups) });
    this.sync(this.scope, this.readiness);
  }

  /** One profile's configuration observation, created on first use and keyed by its exact profile ID. */
  configuration(profileId: string): ReadObservation<Query, BrowserExtensionConfiguration> {
    let observation = this.configurations.get(profileId);
    if (!observation) {
      observation = new ReadObservation<Query, BrowserExtensionConfiguration>({ key: key(browseManagementReads.configuration),
        read: (query) => this.call<BrowserExtensionConfiguration>(browseManagementReads.configuration, { profileId: query.profileId }) });
      observation.configure({ scope: this.scope, profileId }, this.readiness(browseManagementReads.configuration));
      this.configurations.set(profileId, observation);
    }
    return observation;
  }

  /** Commit destination scope and per-operation readiness; a changed scope drops held evidence. */
  sync(scope: string, readiness: (operation: string) => string | null): void {
    this.scope = scope;
    this.readiness = readiness;
    this.catalog.configure({ scope }, readiness(browseManagementReads.catalog));
    this.vault.configure({ scope }, readiness(browseManagementReads.vault));
    this.backups.configure({ scope }, readiness(browseManagementReads.backups));
    for (const [profileId, observation] of this.configurations) observation.configure({ scope, profileId }, readiness(browseManagementReads.configuration));
  }

  extensionsChanged(): void {
    void this.catalog.invalidate();
    for (const observation of this.configurations.values()) void observation.invalidate();
  }

  vaultChanged(): void {
    void this.vault.invalidate();
    void this.backups.invalidate();
  }

  /** Notices are not replayed: a (re)connect re-reads everything demanded. */
  reconnected(): void {
    this.extensionsChanged();
    this.vaultChanged();
  }

  /** After a settled browse write, re-read only what it can change, either way: a lost acknowledgement may still have acted. */
  settled(name: string, args: Record<string, unknown>): void {
    if (name === "browser_extension_import" || name === "browser_extension_install_bitwarden") void this.catalog.invalidate();
    if ((name === "browser_profile_extensions_set" || name === "browser_profile_extensions_inspect") && typeof args.profileId === "string") void this.configuration(args.profileId).invalidate();
    if (name.startsWith("browser_vault_")) this.vaultChanged();
  }
}
