"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleCheckIcon, CircleDashedIcon, HandIcon, KeySquareIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { browseLocalReason, handoffStates, heldBy, isStandalone, profileName } from "@/lib/stack/browse";
import { bitwardenId, catalogGroups, newestHandoff, setupSteps, vaultActions, vaultPrerequisite, vaultSelection, vaultSettling, vaultStateWords, type SetupStep, type VaultAction } from "@/lib/stack/browse-management";
import { shortId } from "@/lib/stack/derive";
import { stateOperations } from "@/lib/stack/maintenance";
import { formatBytes } from "@/lib/stack/resources";
import { localOperations } from "@/lib/stack/state";
import type { StackStore } from "@/lib/stack/store";
import type { BrowserExtension, BrowserHandoff, BrowserProfile, BrowserVaultBackup, BrowserVaultStatus, StateReceipt } from "@/lib/stack/types";
import { cn } from "@/lib/utils";
import { CopyButton, Empty, NodeLink, Row, StatusDot, Time } from "./primitives";
import { useDestination, useNow, useStack, useStore } from "./provider";
import { HandoffControls, useBrowseBlocked } from "./browse-handoffs";
import { ManagementPages, OperatorRequest, useBoundedPoll, useManagedRead } from "./browse-management-pages";
import { ProfileExtensionsDialog } from "./browse-extensions";
import { PendingLabel, useBrowseWrite, WriteError } from "./browse-operator";
import { ObservationStatus, useKeyedRead } from "./owner-reads";
import { Choice, StateFlowView, StateReceiptView, useStateFlow } from "./state-flow";
import { Section, Window } from "./window";

const hint = "text-[0.66rem] text-pretty text-muted-foreground";
const vaultOperations = { plan: "browser_vault_plan", apply: "browser_vault_apply", receipt: "browser_vault_receipt_get" };
/** The management profile this destination chose; a convenience, never an authority. */
const choiceKey = "uix.browse.password-manager.v1";
type ConfigurationRead = ReturnType<StackStore["browseManagement"]["configuration"]>;

const actionWords: Record<VaultAction, { label: string; apply: string; note: string }> = {
  start: { label: "Start", apply: "Start the service",
    note: "Uses the pinned Vaultwarden image, downloading it and creating the service VM and volume on first start. Registration is chosen explicitly and stays as chosen until an explicit stop and start." },
  stop: { label: "Stop", apply: "Stop the service", note: "Gracefully stops Vaultwarden and its VM. Signed-in extensions keep their local caches; stopping revokes nothing." },
  backup: { label: "Back up", apply: "Stop and back up",
    note: "Downtime: stops the writer, syncs and archives the full data directory, records its checksum and identity, then stops the VM. It does not restart; plan Start separately. Archives are limited to 256 MiB compressed." },
  delete: { label: "Delete", apply: "Delete the service",
    note: "Requires a stopped VM. Removes only the exact owned service VM and data volume. Local backups, extension offline caches and copies elsewhere remain; profile reset is the separate boundary for browser-held data." },
  restore: { label: "Restore", apply: "Restore this backup",
    note: "Requires that no managed service exists: stop and delete it first, separately. Creates a new VM and volume, keeps the service identity and private TLS connection, and starts with registration closed. Clients must sign in again; reconcile newer offline changes deliberately." },
};

function StepIcon({ step }: { step: SetupStep }) {
  if (step.state === "observed") return <CircleCheckIcon aria-label="Observed" className="mt-px size-3.5 shrink-0 text-success" />;
  if (step.state === "human") return <HandIcon aria-label="Human step, not observable" className="mt-px size-3.5 shrink-0 text-muted-foreground" />;
  return <CircleDashedIcon aria-label="Not observed" className="mt-px size-3.5 shrink-0 text-muted-foreground" />;
}

/** Each service fact on its own line. Health is HTTPS readiness and private ingress; it never proves a login, unlock or autofill. */
function ServiceFacts({ status }: { status: BrowserVaultStatus }) {
  const words = vaultStateWords[status.state];
  return (
    <div className="flex flex-col gap-2">
      {status.signupsAllowed ? (
        <p role="status" className="flex items-start gap-1.5 rounded-lg border border-warning/50 bg-warning/10 px-2.5 py-1.5 text-[0.74rem] text-pretty text-warning">
          <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span><span className="font-medium">Registration is open.</span> Anything that can reach the private service can create an account until you explicitly stop it and start it with registration closed, each through its own reviewed plan.</span>
        </p>
      ) : null}
      <dl className="flex flex-col">
        <Row label="VM"><span className="flex items-center gap-1.5"><StatusDot tone={words.tone} />{words.label}</span></Row>
        <Row label="Retained intent" hint="What owner startup restores; an explicitly stopped service stays stopped">{status.desiredRunning ? "Keep running" : "Stay stopped"}</Row>
        <Row label="HTTPS health" hint="Verified service readiness and private ingress only">{status.healthy ? <span className="text-success">Verified</span> : "Not verified"}</Row>
        <Row label="Registration">{status.signupsAllowed ? <span className="font-medium text-warning">Open</span> : "Closed"}</Row>
        <Row label="Effect fence" mono copy={status.fence}>{status.fence ?? "none"}</Row>
        <Row label="Service ID" mono copy={status.id}>{status.id ?? "none"}</Row>
        <Row label="Vaultwarden" mono copy={status.image}>{status.version}</Row>
        <Row label="Instance" mono copy={status.instanceId}>{status.instanceId ?? "none"}</Row>
        <Row label="Volume" mono copy={status.volumeId}>{status.volumeId ?? "none"}</Row>
        <Row label="Connection" mono copy={status.connection?.origin}>{status.connection?.origin ?? "No current connection"}</Row>
        <Row label="Revision" mono copy={status.revision}>{shortId(status.revision, 12)}</Row>
      </dl>
      {status.connection ? <p className={cn(hint, "font-mono break-all")}>{status.connection.hostname} · {status.connection.ip} · spki {status.connection.spki}</p> : null}
      {status.blockedBy.length ? <ul aria-label="Blocked by" className="flex flex-col gap-0.5 text-[0.72rem] text-destructive">{status.blockedBy.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      <p className={hint}>Stack has no unlock observation. Service health, a loaded extension or a finished handoff never mean an account exists, is signed in or is unlocked.</p>
    </div>
  );
}

/** A retained service fence: read its exact receipt, then acknowledge inspection against the current status revision. */
function VaultFence({ status, observedAt }: { status: BrowserVaultStatus & { fence: string }; observedAt: number | null }) {
  const state = useStack();
  const store = useStore();
  const now = useNow(15_000);
  const release = useBrowseWrite<BrowserVaultStatus>("browser_vault_fence_release");
  const [confirming, setConfirming] = useState<string | null>(null);
  const receipt = useKeyedRead(() => store.call<{ receipt: StateReceipt | null }>("browse", "browser_vault_receipt_get", { requestId: status.fence }).then((value) => value.receipt),
    status.fence, observedAt ?? 0, { pkg: "browse", operation: "browser_vault_receipt_get" });
  const canRelease = localOperations(state, "browse", ["browser_vault_fence_release"]).available;
  const inspected = !!receipt.data && receipt.data.status !== "running";
  const disabled = release.pending || receipt.loading || receipt.stale || !!receipt.error || !inspected || state.status.browse !== "open";
  const send = async () => {
    if (!confirming || confirming !== status.revision || disabled) return;
    if (await release.run({ requestId: status.fence, expectedRevision: confirming })) setConfirming(null);
  };
  return (
    <section aria-label="Service effect fence" className="flex min-w-0 flex-col gap-2 rounded-lg border border-warning/50 p-2">
      <p className="text-xs font-medium">A service effect remains fenced</p>
      <code className="break-all text-xs">Request {status.fence}</code>
      <ObservationStatus read={receipt} />
      {receipt.error ? <p role="alert" className="text-xs text-destructive">Receipt unavailable: {receipt.error}</p> : null}
      {receipt.data ? <StateReceiptView receipt={receipt.data} now={now} /> : <p className={hint}>{receipt.loading ? "Reading the exact receipt…" : "No receipt available; release is unavailable."}</p>}
      <p className={hint}>Inspect the receipt and the exact service resources above, and verify them on the provider separately. Release only acknowledges inspection: it starts, retries, restores and deletes nothing. Incomplete resources then need an explicit Delete plan; Start refuses to replace them.</p>
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant="outline" disabled={receipt.loading || state.status.browse !== "open"} onClick={() => void receipt.refresh()}>Read fence receipt</Button>
        {canRelease ? <Button size="xs" variant="outline" disabled={disabled} onClick={() => { release.clear(); setConfirming(status.revision); }}>Release fence…</Button> : null}
      </div>
      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!release.pending && !open) setConfirming(null); }}>
        <DialogContent className="[&>*]:min-w-0">
          <DialogHeader><DialogTitle>Release the service fence?</DialogTitle>
            <DialogDescription>Confirm you inspected request {status.fence}, its receipt and the exact service resources. This acknowledges inspection at status revision {confirming ? shortId(confirming, 12) : ""}; partial and unknown results stay that way.</DialogDescription>
          </DialogHeader>
          {confirming !== status.revision ? <p role="alert" className="text-xs text-destructive">The service status changed. Cancel and inspect it again before releasing.</p> : null}
          <WriteError error={release.error} />
          <DialogFooter>
            <Button variant="ghost" disabled={release.pending} onClick={() => setConfirming(null)}>Cancel</Button>
            <Button disabled={disabled || confirming !== status.revision} onClick={() => void send()}><PendingLabel since={release.since}>Release fence</PendingLabel></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * One lifecycle action's own recovery slot. Slots are per action and never keyed by the current service ID, so a
 * deleted and recreated service cannot hide an older unconfirmed request. A non-idle flow stays visible when another
 * action is chosen.
 */
function VaultActionFlow({ action, chosen, status, statusBlock, backups }: {
  action: VaultAction; chosen: boolean; status: BrowserVaultStatus | null; statusBlock: string | null; backups: readonly BrowserVaultBackup[] | null;
}) {
  const store = useStore();
  const [signups, setSignups] = useState<boolean | null>(null);
  const [backupId, setBackupId] = useState<string | null>(null);
  const controls = useStateFlow({ operations: stateOperations(store.call, "browse", vaultOperations, vaultSelection(action, signups, backupId)),
    recoveryKey: `browse:vault:${action}`, policy: "receipt-only", prerequisite: () => statusBlock ?? vaultPrerequisite(action, signups, backupId, backups),
    onReceipt: () => store.browseManagement.vaultChanged() });
  const running = controls.flow.phase === "receipt" && controls.flow.receipt.status === "running";
  const pollSpent = useBoundedPoll(running, controls.readReceipt);
  const { flow } = controls;
  const locked = flow.phase !== "idle";
  if (!chosen && !locked) return null;
  const words = actionWords[action];
  const subject = flow.phase === "receipt" ? flow.receipt.subject?.id ?? null : null;
  return (
    <section aria-label={`${words.label} the service`} className="flex flex-col gap-2 rounded-lg border p-2.5">
      <p className="text-[0.74rem] font-medium">{words.label}{!chosen ? <span className="ml-1.5 text-[0.66rem] font-normal text-muted-foreground">retained request</span> : null}</p>
      <p className={hint}>{words.note}</p>
      {action === "start" ? (
        <Choice label="Registration" value={signups === null ? null : signups ? "open" : "closed"} disabled={locked} onChange={(value) => setSignups(value === "open")}
          options={[["closed", "Closed"], ["open", "Open for account setup", "Open until an explicit stop and a start with registration closed. Use it only while creating the dedicated agent account."]]} />
      ) : null}
      {action === "restore" ? (
        <label className="flex flex-col gap-1 text-[0.72rem]">
          <span className="text-muted-foreground">Listed owner-local backup</span>
          <NativeSelect size="sm" value={backupId ?? ""} disabled={locked || !backups} onChange={(event) => setBackupId(event.target.value || null)}>
            <NativeSelectOption value="">Choose a backup…</NativeSelectOption>
            {(backups ?? []).map((row) => <NativeSelectOption key={row.id} value={row.id}>{new Date(Date.parse(row.createdAt)).toLocaleString()} · {formatBytes(row.bytes)} · {shortId(row.id)}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      ) : null}
      {subject && status?.id && subject !== status.id ? <p className="text-[0.7rem] text-pretty text-warning">This receipt belongs to service {shortId(subject)}, not the current service {shortId(status.id)}.</p> : null}
      <StateFlowView controls={controls} label={`Prepare ${words.label.toLowerCase()}`} applyLabel={words.apply} />
      {pollSpent ? <p className={hint}>Still running. Read the receipt again when ready.</p> : null}
    </section>
  );
}

function Backups({ backups }: { backups: ReturnType<typeof useManagedRead<BrowserVaultBackup[]>> }) {
  const rows = [...(backups.data ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <Section title="Backups" aside={<Button type="button" size="xs" variant="ghost" disabled={backups.loading} onClick={() => void backups.refresh()}>Refresh</Button>}>
      <p className={hint}>Owner-local metadata, never contents. A listing proves the metadata exists, not that an independent copy does. Archives hold encrypted vault items, account metadata and the service&apos;s private keys: protect them as credentials, and copy the archive, its .json metadata and its .record.json identity file to independent storage yourself. Same-host retention is not disaster recovery.</p>
      <ObservationStatus read={backups} />
      {backups.error ? <p role="alert" className="text-xs text-destructive">Backups unavailable: {backups.error}</p> : null}
      {!backups.data ? (!backups.error ? <p className={hint}>{backups.unavailable ?? "Reading backups…"}</p> : null)
        : !rows.length ? <p className={hint}>No completed backups.</p> : (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-0.5 rounded-lg border px-2 py-1.5 text-[0.7rem]">
                <span className="flex items-center gap-2"><Time at={Date.parse(row.createdAt)} /><span>{formatBytes(row.bytes)}</span><span className="ml-auto font-mono text-muted-foreground" title={row.id}>{shortId(row.id)}</span></span>
                <span className="group/row flex min-w-0 items-center gap-1"><span className="min-w-0 truncate font-mono" title={row.path}>{row.path}</span><CopyButton value={row.path} label="backup path" /></span>
                <span className="min-w-0 truncate font-mono text-muted-foreground" title={row.sha256}>sha256 {row.sha256}</span>
                <span className="font-mono text-muted-foreground" title={row.vaultId}>service {shortId(row.vaultId)}</span>
              </li>
            ))}
          </ul>
        )}
      <p className={hint}>There is no download, arbitrary archive import, remote copy, backup deletion or cross-installation restore here.</p>
    </Section>
  );
}

/** The chosen profile's operator handoff: request, open a management page while waiting, then the existing Take and Finish. */
function ManagementHandoff({ profile }: { profile: BrowserProfile }) {
  const { browserHandoffs } = useStack();
  const held = heldBy(profile.id, browserHandoffs.data);
  const [returned, setReturned] = useState<BrowserHandoff | null>(null);
  const handoff = newestHandoff(held, returned);
  if (!handoff) return <OperatorRequest profile={profile} />;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-2">
      <p className="flex flex-wrap items-center gap-x-2 text-[0.72rem]">
        <StatusDot tone={handoffStates[handoff.state].tone} pulse={handoff.state === "awaiting_human"} />
        <NodeLink node={{ kind: "browser-handoff", id: handoff.id }} label="handoff holding this profile" className="font-medium">{handoffStates[handoff.state].label}</NodeLink>
        <span className="text-muted-foreground">{handoff.origin === "operator" ? "Operator handoff" : `Requested by ${handoff.botId}`}</span>
        <span className="ml-auto font-mono text-[0.64rem] text-muted-foreground">revision {handoff.revision}</span>
      </p>
      {profile.botId ? <p className={hint}>Bot {profile.botId}&apos;s maintenance stays blocked until this handoff is resolved.</p> : null}
      {handoff.issue ? <p className="rounded-md bg-warning/10 px-2 py-1 text-[0.7rem] text-pretty text-warning">{handoff.issue}</p> : null}
      {handoff.state === "awaiting_human" ? <ManagementPages handoff={handoff} onOpened={setReturned} /> : null}
      <HandoffControls handoff={handoff} />
      {handoff.state === "human_controlling" ? <p className={hint}>Use the upstream page in the viewer. Finishing returns the whole profile to automation; a standalone agent then reconnects through the named browser provider and takes a fresh snapshot.</p> : null}
    </div>
  );
}

/**
 * The optional managed Vaultwarden service for a dedicated agent account, used through the official Bitwarden
 * extension in a chosen profile. Every lifecycle action is a reviewed plan with its own receipt; account creation and
 * sign-in happen in the upstream UI during an operator handoff. Unrelated to the Content Vault.
 */
export function PasswordManagerWindow() {
  const state = useStack();
  const store = useStore();
  const blocked = useBrowseBlocked();
  const { local } = useDestination();
  const status = useManagedRead(store.browseManagement.vault);
  const backups = useManagedRead(store.browseManagement.backups);
  const catalog = useManagedRead(store.browseManagement.catalog);
  const [action, setAction] = useState<VaultAction | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  useEffect(() => {
    try { const saved = JSON.parse(local?.getItem(choiceKey) ?? "null"); if (typeof saved?.profileId === "string") setProfileId(saved.profileId); } catch { /* optional convenience */ }
  }, [local]);
  const choose = (id: string | null) => {
    setProfileId(id);
    try { local?.setItem(choiceKey, JSON.stringify({ profileId: id })); } catch { /* optional convenience */ }
  };
  const pollSpent = useBoundedPoll(vaultSettling(status.data), status.refresh);
  const profiles = state.browserProfiles.data ?? [];
  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const configuration = useMemo(() => profile ? store.browseManagement.configuration(profile.id) : null, [store, profile]);
  const unavailable = browseLocalReason(state.remote) ?? (!state.endpoints.browse ? "Browse isn't served by this server" : null);
  const bitwarden = catalogGroups(catalog.data ?? []).find((group) => group.id === bitwardenId)?.versions[0] ?? null;
  const canPlan = localOperations(state, "browse", Object.values(vaultOperations)).available;
  const canBackups = localOperations(state, "browse", ["browser_vault_backup_list"]).available;
  const canInstall = localOperations(state, "browse", ["browser_extension_install_bitwarden"]).available;
  const canConfigure = localOperations(state, "browse", ["browser_profile_extensions_get"]).available;
  const installer = useBrowseWrite("browser_extension_install_bitwarden");
  const statusBlock = !status.data ? "Read the service status first." : status.stale || status.error ? "Refresh the service status before preparing." : null;
  const named = profiles.filter(isStandalone);
  return (
    <Window id="browse-password-manager" title="Password manager" icon={KeySquareIcon} accent="browse" subtitle="agent password manager"
      status={state.endpoints.browse ? state.status.browse : undefined} endpoint={state.endpoints.browse} updatedAt={status.at} error={status.error}
      actions={state.endpoints.browse && !state.remote ? (
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Read the service again" title="Read the service again" disabled={state.status.browse !== "open" || status.loading}
          onClick={() => { void status.refresh(); void backups.refresh(); }}><RefreshCwIcon /></Button>
      ) : null}>
      {unavailable ? <Empty icon={KeySquareIcon} title={unavailable} /> : (
        <>
          <p className={cn("px-0.5", hint)}>A managed Vaultwarden service for a dedicated agent account, used through the official Bitwarden extension. Never import personal credentials. Unrelated to the Content Vault.</p>
          <Section title="Service">
            <ObservationStatus read={status} />
            {pollSpent ? <p className={hint}>The service may still be settling. Refresh to read it again.</p> : null}
            {status.data ? <ServiceFacts status={status.data} /> : !status.error ? <p className={hint}>{status.unavailable ?? "Reading the service…"}</p> : null}
            {status.data?.fence ? <VaultFence key={status.data.fence} status={status.data as BrowserVaultStatus & { fence: string }} observedAt={status.at} /> : null}
          </Section>

          <Section title="Setup">
            <ol aria-label="Setup facts and human steps" className="flex flex-col gap-1.5">
              <SetupList status={status.data} bitwarden={bitwarden} profile={profile} configuration={configuration} />
            </ol>
            {!bitwarden && canInstall ? (
              <div className="flex items-center gap-2">
                <span className={cn("min-w-0 flex-1", hint)}>Downloads and checksum-verifies the pinned release into the catalog; selects nothing.</span>
                <Button type="button" size="xs" variant="outline" disabled={Boolean(blocked) || installer.pending} onClick={() => void installer.run()}><PendingLabel since={installer.since}>Install Bitwarden</PendingLabel></Button>
              </div>
            ) : null}
            <WriteError error={installer.error} />
            <label className="flex flex-col gap-1 text-[0.72rem]">
              <span className="text-muted-foreground">Management profile</span>
              <NativeSelect size="sm" value={profileId ?? ""} onChange={(event) => choose(event.target.value || null)}>
                <NativeSelectOption value="">Choose a profile…</NativeSelectOption>
                {named.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name} · named browser</NativeSelectOption>)}
                {profiles.filter((item) => !isStandalone(item)).map((item) => <NativeSelectOption key={item.id} value={item.id}>{profileName(item)} · {item.botId ?? "unassigned"}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            <p className={hint}>Recommended: a dedicated named browser, created and started in Browsers. Every tab and controller of the chosen profile receives its extensions and the credentials signed in there.</p>
            {profileId && !profile && state.browserProfiles.data ? <p className="text-[0.7rem] text-warning">The chosen profile no longer exists. Choose another.</p> : null}
            {profile && !isStandalone(profile) ? <p className="text-[0.7rem] text-pretty text-warning">{profile.botId ? `This profile belongs to Bot ${profile.botId}: its automation shares these credentials.` : "This is a legacy unassigned profile."} A dedicated named browser keeps them separate.</p> : null}
            {profile ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1">
                  <NodeLink node={isStandalone(profile) ? { kind: "standalone-browser", id: profile.name! } : { kind: "browser-profile", id: profile.id }} label={`profile ${profileName(profile)}`} className="text-[0.72rem]">{profileName(profile)} · {profile.state}</NodeLink>
                  {canConfigure ? <Button type="button" size="xs" variant="outline" className="ml-auto" onClick={() => setConfiguring(true)}>Profile extensions…</Button> : null}
                </div>
                <ManagementHandoff key={profile.id} profile={profile} />
              </div>
            ) : null}
          </Section>

          {canPlan ? (
            <Section title="Lifecycle">
              <Choice<VaultAction> label="Action" value={action} disabled={false} onChange={setAction}
                options={vaultActions.map((item): [VaultAction, React.ReactNode] => [item, actionWords[item].label])} />
              {vaultActions.map((item) => <VaultActionFlow key={item} action={item} chosen={action === item} status={status.data} statusBlock={statusBlock} backups={backups.data} />)}
              <p className={hint}>Each step is its own reviewed plan and receipt. Nothing chains actions: closing registration is an explicit Stop followed by an explicit Start with registration closed.</p>
            </Section>
          ) : null}
          {canBackups ? <Backups backups={backups} /> : null}
        </>
      )}
      {configuring && profile ? <ProfileExtensionsDialog key={profile.id} profile={profile} onClose={() => setConfiguring(false)}
        suggestion={bitwarden ? { ref: { id: bitwarden.id, digest: bitwarden.digest }, vaultId: status.data?.id ?? null } : null} /> : null}
    </Window>
  );
}

type SetupFacts = { status: BrowserVaultStatus | null; bitwarden: BrowserExtension | null; profile: BrowserProfile | null };

/** Without a chosen profile there is no configuration to observe; with one, its configuration read is held only while shown. */
function SetupList({ configuration, ...facts }: SetupFacts & { configuration: ConfigurationRead | null }) {
  return configuration ? <ConfiguredSteps {...facts} configuration={configuration} /> : <Steps steps={setupSteps({ ...facts, config: null })} />;
}

function ConfiguredSteps({ configuration, ...facts }: SetupFacts & { configuration: ConfigurationRead }) {
  const config = useManagedRead(configuration);
  return <Steps steps={setupSteps({ ...facts, config: config.data })} />;
}

function Steps({ steps }: { steps: SetupStep[] }) {
  return <>{steps.map((step) => (
    <li key={step.key} className="flex items-start gap-1.5 text-[0.72rem]">
      <StepIcon step={step} />
      <span className="flex min-w-0 flex-col">
        <span className={cn(step.state === "observed" ? "text-foreground" : "text-foreground/90")}>{step.title}{step.state === "human" ? <span className="ml-1 text-[0.64rem] text-muted-foreground">human step · not observable</span> : null}</span>
        <span className={hint}>{step.detail}</span>
      </span>
    </li>
  ))}</>;
}
