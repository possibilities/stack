"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { DownloadIcon, PackagePlusIcon, PuzzleIcon, RefreshCwIcon, RotateCcwIcon, SaveIcon, ScanEyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { browseLocalReason, heldBy, isStandalone, profileName } from "@/lib/stack/browse";
import { appliedObservations, catalogGroups, chooseVersion, draftBlock, draftChanged, draftFrom, extensionKey, extensionLabel, findExtension, importBlock,
  selectionChanges, setInput, staleConfiguration, type ExtensionDraft } from "@/lib/stack/browse-management";
import { shortId } from "@/lib/stack/derive";
import { stateOperations } from "@/lib/stack/maintenance";
import { formatBytes } from "@/lib/stack/resources";
import { localOperations } from "@/lib/stack/state";
import type { BrowserExtension, BrowserExtensionConfiguration, BrowserExtensionRef, BrowserProfile } from "@/lib/stack/types";
import { cn } from "@/lib/utils";
import { CopyButton, Empty, Flash, Row, StatusDot, Time } from "./primitives";
import { useStack, useStore } from "./provider";
import { useBrowseBlocked } from "./browse-handoffs";
import { BrowseMaintenanceFence } from "./browse-maintenance";
import { useBoundedPoll, useManagedRead } from "./browse-management-pages";
import { PendingLabel, useBrowseWrite, WriteError } from "./browse-operator";
import { ObservationStatus } from "./owner-reads";
import { fieldLabel } from "./scrape-shared";
import { Choice, StateFlowView, useStateFlow } from "./state-flow";
import { Section, Window } from "./window";

const hint = "text-[0.66rem] text-pretty text-muted-foreground";
const badge = "rounded-md bg-muted px-1.5 py-px font-mono text-[0.64rem] text-muted-foreground";
export const extensionApplyOperations = { plan: "browser_profile_extensions_plan", apply: "browser_profile_extensions_apply", receipt: "browse_state_receipt_get" };

function Names({ title, items, tone }: { title: string; items: readonly string[]; tone?: "warning" }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={fieldLabel}>{title} <span className="tabular-nums">{items.length}</span></span>
      <ul className={cn("flex flex-wrap gap-1", tone === "warning" && "text-warning")}>{items.map((item) => <li key={item} className={cn(badge, tone === "warning" && "text-warning")}>{item}</li>)}</ul>
    </div>
  );
}

/** Declared permissions and entry points, as text. Imported code runs with the profile's browser privileges once applied. */
export function ExtensionPermissions({ record }: { record: BrowserExtension }) {
  const none = !record.permissions.length && !record.hostPermissions.length && !record.optionalPermissions.length && !record.optionalHostPermissions.length && !record.contentMatches.length;
  return (
    <div className="flex flex-col gap-1.5">
      {none ? <p className={hint}>Declares no permissions, host access or content scripts.</p> : null}
      <Names title="Required permissions" items={record.permissions} />
      <Names title="Host access" items={record.hostPermissions} tone="warning" />
      <Names title="Content scripts on" items={record.contentMatches} tone="warning" />
      <Names title="Optional permissions" items={record.optionalPermissions} />
      <Names title="Optional host access" items={record.optionalHostPermissions} />
      <p className={hint}>Entry points: {[record.popup ? `popup ${record.popup}` : null, record.options ? `options ${record.options}` : null].filter(Boolean).join(" · ") || "none declared"}</p>
    </div>
  );
}

function VersionRow({ record, repeated }: { record: BrowserExtension; repeated: boolean }) {
  const label = extensionLabel(record);
  return (
    <li data-node={`browser-extension:${extensionKey(record)}`} className="relative flex flex-col gap-1 rounded-lg border px-2 py-1.5">
      <Flash id={`browser-extension:${extensionKey(record)}`} />
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[0.76rem] font-medium">{record.version}</span>
        <span className="min-w-0 truncate text-[0.72rem]" title={label.localized ? `Declared name ${record.name} is a localization key` : record.name}>{label.text}</span>
        {repeated ? <span className={cn(badge, "bg-warning/15 text-warning")} title="Another import has this version label with different bytes">same label, other bytes</span> : null}
        <span className={cn(badge, "ml-auto")}>{record.source}</span>
      </div>
      <p className="group/row flex min-w-0 flex-wrap items-center gap-x-2 text-[0.66rem] text-muted-foreground">
        <span className="font-mono" title={record.digest}>digest {record.digest.slice(0, 16)}</span>
        <CopyButton value={record.digest} label="digest" />
        <span>{formatBytes(record.bytes)}</span>
        <span>imported <Time at={Date.parse(record.importedAt)} /></span>
      </p>
      <details className="text-[0.7rem]">
        <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">Permissions and entry points</summary>
        <div className="pt-1.5"><ExtensionPermissions record={record} /></div>
      </details>
    </li>
  );
}

/**
 * The immutable extension catalog by stable catalog ID. Presence here is not installation: each profile loads only the
 * exact versions it saved and applied. Imports read a path on the Stack server and execute nothing.
 */
export function ExtensionsWindow() {
  const state = useStack();
  const store = useStore();
  const blocked = useBrowseBlocked();
  const catalog = useManagedRead(store.browseManagement.catalog);
  const importer = useBrowseWrite<BrowserExtension>("browser_extension_import");
  const installer = useBrowseWrite<BrowserExtension>("browser_extension_install_bitwarden");
  const formId = useId();
  const [draft, setDraft] = useState({ id: "", path: "" });
  const [imported, setImported] = useState<BrowserExtension | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const profiles = state.browserProfiles.data ?? [];
  const chosen = profiles.find((profile) => profile.id === configuring) ?? null;
  const unavailable = browseLocalReason(state.remote) ?? (!state.endpoints.browse ? "Browse isn't served by this server" : null);
  const canImport = localOperations(state, "browse", ["browser_extension_import"]).available;
  const canInstall = localOperations(state, "browse", ["browser_extension_install_bitwarden"]).available;
  const canConfigure = localOperations(state, "browse", ["browser_profile_extensions_get"]).available;
  const invalid = draft.id || draft.path ? importBlock(draft.id, draft.path) : null;
  const groups = catalogGroups(catalog.data ?? []);
  const busy = importer.pending || installer.pending;
  const submit = async () => {
    if (blocked || busy || importBlock(draft.id, draft.path)) return;
    const result = await importer.run({ id: draft.id, path: draft.path });
    if (result) { setImported(result); setDraft({ id: "", path: "" }); }
  };
  const install = async () => {
    if (blocked || busy) return;
    const result = await installer.run();
    if (result) setImported(result);
  };
  return (
    <Window id="browse-extensions" title="Extensions" icon={PuzzleIcon} accent="browse" count={catalog.data ? groups.length : null}
      status={state.endpoints.browse ? state.status.browse : undefined} endpoint={state.endpoints.browse} updatedAt={catalog.at} error={catalog.error}
      actions={state.endpoints.browse && !state.remote ? (
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Read the catalog again" title="Read the catalog again" disabled={state.status.browse !== "open" || catalog.loading} onClick={() => void catalog.refresh()}><RefreshCwIcon /></Button>
      ) : null}>
      {unavailable ? <Empty icon={PuzzleIcon} title={unavailable} /> : (
        <>
          <p className={cn("px-0.5", hint)}>Retained immutable MV3 versions. A catalog entry is not installed anywhere: each profile loads only the exact versions it saved and applied, shared by all of its tabs and controllers.</p>
          <ObservationStatus read={catalog} />
          {canImport || canInstall ? (
            <Section title="Add to the catalog">
              {canImport ? (
                <form className="flex flex-col gap-2 rounded-lg border p-2.5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                  <label htmlFor={`${formId}-id`} className="flex flex-col gap-1">
                    <span className={fieldLabel}>Catalog ID</span>
                    <Input id={`${formId}-id`} value={draft.id} maxLength={48} disabled={busy} placeholder="my-extension" spellCheck={false} autoComplete="off"
                      onChange={(event) => { setDraft({ ...draft, id: event.target.value }); importer.clear(); }} className="h-7 font-mono text-[0.76rem]" />
                  </label>
                  <label htmlFor={`${formId}-path`} className="flex flex-col gap-1">
                    <span className={fieldLabel}>Directory or ZIP on the Stack server</span>
                    <Input id={`${formId}-path`} value={draft.path} maxLength={4096} disabled={busy} placeholder="/absolute/path/to/extension" spellCheck={false} autoComplete="off"
                      onChange={(event) => { setDraft({ ...draft, path: event.target.value }); importer.clear(); }} className="h-7 font-mono text-[0.76rem]" />
                  </label>
                  <p className={hint}>The path is read on the Stack server, not uploaded from this device. Import snapshots it and executes nothing; no browser changes. Re-importing under the same ID keeps its Chrome identity and adds a new digest.</p>
                  <WriteError error={importer.error} />
                  <div className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1", hint, invalid && "text-warning")}>{blocked ?? invalid ?? "MV3 with manifest.json at its root; no links."}</span>
                    <Button type="submit" size="sm" disabled={Boolean(blocked ?? importBlock(draft.id, draft.path)) || busy}><PendingLabel since={importer.since}><PackagePlusIcon data-icon="inline-start" />Import</PendingLabel></Button>
                  </div>
                </form>
              ) : null}
              {canInstall ? (
                <div className="flex flex-col gap-1.5 rounded-lg border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-[0.74rem] font-medium">Official Bitwarden extension</span>
                    <Button type="button" size="sm" variant="outline" disabled={Boolean(blocked) || busy} title={blocked ?? undefined} onClick={() => void install()}>
                      <PendingLabel since={installer.since}><DownloadIcon data-icon="inline-start" />Install pinned release</PendingLabel>
                    </Button>
                  </div>
                  <p className={hint}>Downloads the pinned upstream release and verifies its checksum into the catalog. It selects nothing, restarts no browser, creates no account and unlocks nothing.</p>
                  <WriteError error={installer.error} />
                </div>
              ) : null}
              {imported ? <p role="status" className="text-[0.7rem] text-pretty text-muted-foreground">In the catalog: <span className="font-mono text-foreground">{imported.id}</span> {imported.version} · digest <span className="font-mono">{imported.digest.slice(0, 16)}</span>. Select it on a profile to use it.</p> : null}
            </Section>
          ) : null}
          {canConfigure && profiles.length ? (
            <Section title="Use on a profile">
              <div className="flex items-center gap-1.5">
                <NativeSelect size="sm" aria-label="Profile to configure" value={configuring ?? ""} onChange={(event) => setConfiguring(event.target.value || null)} className="min-w-0 flex-1">
                  <NativeSelectOption value="">Choose a profile…</NativeSelectOption>
                  {profiles.map((profile) => <NativeSelectOption key={profile.id} value={profile.id}>{isStandalone(profile) ? `${profile.name} · named browser` : `${profileName(profile)} · ${profile.botId ?? "unassigned"}`}</NativeSelectOption>)}
                </NativeSelect>
              </div>
            </Section>
          ) : null}
          <Section title="Catalog">
            {!catalog.data ? <p className={hint}>{catalog.unavailable ?? (catalog.error ? `Catalog unavailable: ${catalog.error}` : "Reading the catalog…")}</p>
              : !groups.length ? <Empty icon={PuzzleIcon} title="No extensions imported" hint="Import a directory or ZIP, or install the pinned Bitwarden release." />
              : (
                <ul className="flex flex-col gap-3">
                  {groups.map((group) => (
                    <li key={group.id} className="flex flex-col gap-1.5">
                      <p className="flex min-w-0 items-center gap-2 px-0.5">
                        <span className="font-mono text-[0.78rem] font-semibold">{group.id}</span>
                        <span className="min-w-0 truncate font-mono text-[0.64rem] text-muted-foreground" title="Chrome extension ID, stable across this catalog ID's versions">{group.chromeId}</span>
                        <span className="ml-auto shrink-0 text-[0.64rem] text-muted-foreground">{group.versions.length} version{group.versions.length === 1 ? "" : "s"}</span>
                      </p>
                      <ul className="flex flex-col gap-1">{group.versions.map((record) => <VersionRow key={record.digest} record={record} repeated={group.repeatedLabels.includes(record.version)} />)}</ul>
                    </li>
                  ))}
                </ul>
              )}
            <p className={hint}>Old versions stay retained. There is no store search, update check, individual purge or catalog cleanup.</p>
          </Section>
        </>
      )}
      {chosen ? <ProfileExtensionsDialog key={chosen.id} profile={chosen} onClose={() => setConfiguring(null)} /> : null}
    </Window>
  );
}

function RefList({ refs, catalog, empty }: { refs: readonly BrowserExtensionRef[] | null; catalog: readonly BrowserExtension[] | null; empty: string }) {
  if (!refs?.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {refs.map((ref) => {
        const record = findExtension(catalog, ref);
        return <li key={extensionKey(ref)} className="min-w-0 truncate font-mono text-[0.68rem]" title={`${ref.id}@${ref.digest}`}>{ref.id} {record ? record.version : ""} · {ref.digest.slice(0, 12)}</li>;
      })}
    </ul>
  );
}

const observedWords = { matching: ["success", "Loaded at this version"], different: ["warning", "Loaded at a different version"], absent: ["destructive", "Not loaded when observed"], unobserved: ["muted", "Not observed"] } as const;

/** Saved, last applied and last observed, each in its own words. None is a runtime health feed. */
function ConfigurationFacts({ config, catalog }: { config: BrowserExtensionConfiguration; catalog: readonly BrowserExtension[] | null }) {
  const pending = config.applied === null ? null : selectionChanges(config.applied, config.desired);
  return (
    <div className="flex flex-col gap-2 text-[0.72rem]">
      <dl className="flex flex-col">
        <Row label="Saved selection"><RefList refs={config.desired} catalog={catalog} empty="None: applying disables every extension" /></Row>
        <Row label="Last applied" hint={config.appliedAt ? undefined : "No successful application is recorded"}>
          {config.applied === null ? <span className="text-muted-foreground">Never applied</span>
            : <div className="flex flex-col items-end gap-0.5"><RefList refs={config.applied} catalog={catalog} empty="Successfully applied: none" />{config.appliedAt ? <Time at={Date.parse(config.appliedAt)} className="text-[0.64rem] text-muted-foreground" /> : null}</div>}
        </Row>
        <Row label="Observed" hint={config.observedAt ? "Retained observation of loaded IDs and versions, not a live feed or a digest audit" : null}>
          {config.observed === null ? <span className="text-muted-foreground">Unavailable</span>
            : <div className="flex flex-col items-end gap-0.5">
              {config.observed.length ? config.observed.map((row) => {
                // The runtime reports the declared name, which may be an unresolved localization key; the Chrome ID names the catalog entry.
                const known = catalog?.find((item) => item.chromeId === row.id);
                const name = /^__MSG_.+__$/.test(row.name) ? known?.id ?? row.id : row.name;
                return <span key={row.id} className="font-mono text-[0.66rem]" title={`Chrome ID ${row.id}`}>{name} {row.version}</span>;
              }) : <span>No extensions loaded</span>}
              {config.observedAt ? <span className="text-[0.64rem] text-muted-foreground">observed <Time at={Date.parse(config.observedAt)} /></span> : null}
            </div>}
        </Row>
        <Row label="Saved vault binding" mono copy={config.vaultId}>{config.vaultId ?? "none"}</Row>
        <Row label="Applied vault" mono copy={config.appliedVault?.origin}>{config.appliedVault ? config.appliedVault.origin : "none applied"}</Row>
      </dl>
      {config.appliedVault ? <p className={cn(hint, "font-mono break-all")}>{config.appliedVault.hostname} · {config.appliedVault.ip} · spki {config.appliedVault.spki}</p> : null}
      {config.applied ? (
        <ul aria-label="Applied versions against the last observation" className="flex flex-col gap-0.5">
          {appliedObservations(config, catalog).map(({ ref, observed }) => (
            <li key={extensionKey(ref)} className="flex items-center gap-1.5 text-[0.68rem]">
              <StatusDot tone={observedWords[observed][0]} label={observedWords[observed][1]} /><span className="font-mono">{ref.id}</span><span className="text-muted-foreground">{observedWords[observed][1]}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {pending?.length ? <p className="text-[0.7rem] text-pretty text-warning">The saved selection differs from the last applied one ({pending.map((change) => change.id).join(", ")}). The browser changes only when you apply it.</p> : null}
      {config.issue ? <p role="status" className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-[0.72rem] text-pretty text-warning">{config.issue}</p> : null}
    </div>
  );
}

export type ExtensionSuggestion = { ref: BrowserExtensionRef; vaultId: string | null };

/**
 * One profile's extensions: an unsaved draft, an explicit revisioned Save, and an explicit plan/apply of the saved
 * revision. Saving never starts or restarts a browser; removing an extension and applying disables it and keeps its data.
 */
export function ProfileExtensionsDialog({ profile, suggestion, onClose }: { profile: BrowserProfile; suggestion?: ExtensionSuggestion | null; onClose(): void }) {
  const state = useStack();
  const store = useStore();
  const blocked = useBrowseBlocked();
  const configuration = useMemo(() => store.browseManagement.configuration(profile.id), [store, profile.id]);
  const config = useManagedRead(configuration);
  const catalog = useManagedRead(store.browseManagement.catalog);
  const vault = useManagedRead(store.browseManagement.vault);
  const save = useBrowseWrite<BrowserExtensionConfiguration>("browser_profile_extensions_set");
  const inspect = useBrowseWrite<BrowserExtensionConfiguration>("browser_profile_extensions_inspect");
  const [draft, setDraft] = useState<ExtensionDraft | null>(null);
  useEffect(() => { if (!draft && config.data) setDraft(draftFrom(config.data)); }, [draft, config.data]);
  const canSave = localOperations(state, "browse", ["browser_profile_extensions_set"]).available;
  const canInspect = localOperations(state, "browse", ["browser_profile_extensions_inspect"]).available;
  const canBind = localOperations(state, "browse", ["browser_vault_status"]).available;
  const saved = config.data;
  const changed = !!draft && !!saved && draftChanged(draft, saved);
  const saveBlock = blocked ?? (profile.maintenanceRequestId ? "Profile maintenance is fenced" : !draft ? "Reading the saved configuration…" : draftBlock(draft, saved, catalog.data));
  const applyUnavailable = !saved ? "Read the saved configuration first."
    : config.stale || config.error ? "Refresh the saved configuration before preparing."
    : changed ? "Save or discard the draft first: apply uses the saved revision only." : null;
  const controls = useStateFlow({ operations: stateOperations(store.call, "browse", extensionApplyOperations, { profileId: profile.id, configurationRevision: saved?.revision ?? "" }),
    recoveryKey: `browse:extensions:${profile.id}`, policy: "receipt-only", prerequisite: () => applyUnavailable,
    onReceipt: (receipt) => { if (receipt.status !== "running") { store.refreshBrowse(); void configuration.invalidate(); } } });
  const running = controls.flow.phase === "receipt" && controls.flow.receipt.status === "running";
  const pollSpent = useBoundedPoll(running, controls.readReceipt);
  const busy = save.pending || ["preparing", "applying", "checking"].includes(controls.flow.phase);
  const locked = save.pending || controls.flow.phase !== "idle";
  const groups = catalogGroups(catalog.data ?? []);
  const unsaved = draft && saved ? selectionChanges(saved.desired, draft.refs) : [];
  const held = heldBy(profile.id, state.browserHandoffs.data);
  const controllers = (state.browserControllers.data ?? []).filter((item) => (item.profileId === profile.id || item.actualProfileId === profile.id) && item.state !== "disconnected");
  const bot = profile.botId ? state.bots.data?.find((item) => item.id === profile.botId) : null;
  const onSave = async () => {
    if (!draft || saveBlock) return;
    const result = await save.run(setInput(profile.id, draft));
    if (result) setDraft(draftFrom(result));
  };
  const vaultChoice = draft?.vaultId === undefined ? "keep" : draft.vaultId === null ? "none" : "service";
  const serviceId = vault.data?.id ?? null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Extensions · {profileName(profile)}</DialogTitle>
          <DialogDescription>Every tab and controller of this profile shares its extensions{isStandalone(profile) ? "" : profile.botId ? `, including Bot ${profile.botId}'s automation` : ""}. Saving changes nothing in the browser; applying restarts only this profile.</DialogDescription>
        </DialogHeader>
        <p className={hint}>Profile <code className="break-all">{profile.id}</code> · {profile.state} · generation {profile.generation}</p>
        <ObservationStatus read={config} />
        {config.error ? <p role="alert" className="text-xs text-destructive">Configuration unavailable: {config.error}</p> : null}
        {saved ? <ConfigurationFacts config={saved} catalog={catalog.data} /> : !config.error ? <p className={hint}>{config.unavailable ?? "Reading the saved configuration…"}</p> : null}
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="xs" variant="ghost" disabled={config.loading || state.status.browse !== "open"} onClick={() => void config.refresh()}><RefreshCwIcon data-icon="inline-start" />Read saved configuration</Button>
          {canInspect ? <Button type="button" size="xs" variant="ghost" disabled={Boolean(blocked) || inspect.pending} title="Observe loaded IDs and versions in the already-running profile. Never launches, applies or releases a fence"
            onClick={() => void inspect.run({ profileId: profile.id })}><PendingLabel since={inspect.since}><ScanEyeIcon data-icon="inline-start" />Inspect running profile</PendingLabel></Button> : null}
        </div>
        <WriteError error={inspect.error} />
        <BrowseMaintenanceFence profile={profile} />

        {canSave && draft && saved ? (
          <section aria-label="Draft selection" className="flex flex-col gap-2 rounded-lg border p-2.5">
            <p className="text-[0.74rem] font-medium">Draft{changed ? <span className="ml-1.5 text-[0.66rem] font-normal text-warning">unsaved</span> : null}</p>
            {draft.base !== saved.revision ? (
              <div role="status" className="flex flex-col gap-1 rounded-md bg-warning/10 px-2 py-1.5 text-[0.7rem] text-pretty text-warning">
                <span>The saved configuration changed since this draft began. Your draft is kept; compare it with the saved values above before choosing.</span>
                <span className="flex flex-wrap gap-1">
                  <Button type="button" size="xs" variant="outline" disabled={locked} onClick={() => setDraft({ ...draft, base: saved.revision })}>Keep my draft over the current revision</Button>
                  <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={() => setDraft(draftFrom(saved))}><RotateCcwIcon data-icon="inline-start" />Start again from saved</Button>
                </span>
              </div>
            ) : null}
            {suggestion && (!draft.refs.some((ref) => ref.id === suggestion.ref.id && ref.digest === suggestion.ref.digest)
              || (suggestion.vaultId !== null && (draft.vaultId === undefined ? saved.vaultId : draft.vaultId) !== suggestion.vaultId)) ? (
              <Button type="button" size="xs" variant="outline" className="w-fit" disabled={locked} onClick={() => setDraft({ ...chooseVersion(draft, suggestion.ref.id, suggestion.ref.digest), ...(suggestion.vaultId ? { vaultId: suggestion.vaultId } : {}) })}>
                Add {suggestion.ref.id} {findExtension(catalog.data, suggestion.ref)?.version ?? ""}{suggestion.vaultId ? " and bind the managed service" : ""} to the draft
              </Button>
            ) : null}
            {!groups.length ? <p className={hint}>{catalog.data ? "The catalog is empty. Import or install an extension first." : catalog.unavailable ?? "Reading the catalog…"}</p> : (
              <ul className="flex flex-col gap-2">
                {groups.map((group) => {
                  const chosen = draft.refs.find((ref) => ref.id === group.id) ?? null;
                  const record = chosen ? findExtension(catalog.data, chosen) : null;
                  return (
                    <li key={group.id} className="flex flex-col gap-1">
                      <label className="flex min-w-0 items-center gap-2 text-[0.72rem]">
                        <span className="w-28 shrink-0 truncate font-mono" title={group.id}>{group.id}</span>
                        <NativeSelect size="sm" value={chosen?.digest ?? ""} disabled={locked} aria-label={`${group.id} version`} className="min-w-0 flex-1"
                          onChange={(event) => setDraft(chooseVersion(draft, group.id, event.target.value || null))}>
                          <NativeSelectOption value="">Off (disabled; data kept)</NativeSelectOption>
                          {group.versions.map((version) => <NativeSelectOption key={version.digest} value={version.digest}>{version.version} · {version.digest.slice(0, 12)}</NativeSelectOption>)}
                        </NativeSelect>
                      </label>
                      {record ? <details className="pl-30 text-[0.7rem]"><summary className="cursor-pointer text-muted-foreground select-none">Review {record.version} permissions</summary><div className="pt-1"><ExtensionPermissions record={record} /></div></details> : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {draft.refs.filter((ref) => !groups.some((group) => group.id === ref.id)).map((ref) => <p key={extensionKey(ref)} className="text-[0.7rem] text-warning">Saved {ref.id} · {ref.digest.slice(0, 12)} is not in the catalog read.</p>)}
            {canBind ? (
              <Choice label="Vault binding" value={vaultChoice} disabled={locked} onChange={(choice) => setDraft({ ...draft, vaultId: choice === "keep" ? undefined : choice === "none" ? null : serviceId })}
                options={[
                  ["keep", `Keep the saved binding (${saved.vaultId ? shortId(saved.vaultId) : "none"})`],
                  ["service", serviceId ? `Bind the managed service ${shortId(serviceId)}` : "Bind the managed service", vault.data && !vault.data.healthy ? "The service is not verified healthy now; planning checks it again." : undefined, !serviceId],
                  ["none", "Remove the binding", "Applying then removes the private vault connection from this profile."],
                ]} />
            ) : null}
            {unsaved.length ? <p className={hint}>Unsaved: {unsaved.map((change) => `${change.id} ${change.to ? change.from ? "changes version" : "added" : "disabled"}`).join(" · ")}. Disabling keeps the extension&apos;s storage; it is not uninstall.</p> : null}
            <WriteError error={save.error && staleConfiguration(save.error.text) ?{ ...save.error, text: "The saved configuration changed first. It was read again; your draft is kept." } : save.error} />
            {save.error?.uncertain ? <p className={hint}>The configuration was read again. Compare its revision and selection with your draft before saving again.</p> : null}
            <div className="flex items-center gap-2">
              <span className={cn("min-w-0 flex-1", hint)}>{saveBlock ?? "Saves the exact digests. Nothing restarts until you apply."}</span>
              {changed ? <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => { setDraft(draftFrom(saved)); save.clear(); }}>Discard draft</Button> : null}
              <Button type="button" size="sm" disabled={Boolean(saveBlock) || locked} onClick={() => void onSave()}><PendingLabel since={save.since}><SaveIcon data-icon="inline-start" />Save</PendingLabel></Button>
            </div>
          </section>
        ) : null}

        {localOperations(state, "browse", [extensionApplyOperations.plan, extensionApplyOperations.apply, extensionApplyOperations.receipt]).available ? (
          <section aria-label="Apply saved selection" className="flex flex-col gap-2 rounded-lg border p-2.5">
            <p className="text-[0.74rem] font-medium">Apply the saved revision</p>
            <p className={hint}>Stages the saved versions, cleanly restarts only this profile with its data kept, then verifies the loaded Chrome IDs and versions. First resolve what the plan names yourself: {bot ? `stop Bot ${bot.id} (${bot.state}), ` : ""}{controllers.length ? `close ${controllers.length} controller${controllers.length === 1 ? "" : "s"}, ` : ""}{held ? "finish the handoff holding it, " : ""}and wait for the profile to be ready. Nothing here stops a Bot, closes a controller or finishes a handoff.</p>
            {saved ? <p className={cn(hint, "font-mono break-all")}>configuration revision {saved.revision}</p> : null}
            <StateFlowView controls={controls} label="Prepare applying the saved selection" applyLabel="Apply and restart this profile" />
            {pollSpent ? <p className={hint}>Still running. Read the receipt again when ready.</p> : null}
          </section>
        ) : null}
        <DialogFooter><Button variant="ghost" disabled={busy} onClick={onClose}>Close dialog</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
