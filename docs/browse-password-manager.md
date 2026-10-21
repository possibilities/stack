# Browse extensions and agent password manager

Browse can load MV3 extensions into individual durable profiles. An optional Vaultwarden service supplies
an agent-owned password manager through the official Bitwarden extension. This feature is API-first;
new UI controls are a separate implementation. Existing Browse handoff viewers remain usable.

## Requirements and boundaries

- The installed Browse Hypeman provider and pinned Kernel Chrome for Testing runtime must work first.
  No host Docker or native browser extension installation is required.
- Use a **dedicated agent account**. Do not import personal credentials during setup or testing.
- Operator management uses the local Package API socket or local WebSocket. Browse remains unavailable
  through remote Access sessions. Page actions remain in `agent-browser` and Browser handoffs.
- A catalog import is not installation into a profile. A saved selection is not an applied selection.
  Loaded extension identity, service HTTPS health, login, unlock and sync are separate observations.
- Vaultwarden is AGPL-3.0 software from [dani-garcia/vaultwarden](https://github.com/dani-garcia/vaultwarden).
  The extension is the official [Bitwarden browser release](https://github.com/bitwarden/clients/releases).
  Upstream notices remain in the unmodified runtime assets. Stack modifies the extension manifest only to
  retain a stable unpacked-extension public key where the release does not supply one.

The current pins are declared in `packages/browse/src/vault.ts` and `extensions.ts`: Vaultwarden 1.37.4,
container manifest digest `efb3cde962015fcc036b2ea625242248611943b27212ebf4392841fb30fad055`, and Bitwarden
2026.10.0, release ZIP SHA-256 `7b9ec650b87dd8975e87a0e0bdd0c1f1a0fcf5b0a8da5ae759ec14cdffaad35d`.
There is no automatic extension or vault-server update.

## First setup

Use the live API reference for exact schemas. Every plan/apply pair sends the plan's `id` as `planId`,
its `revision` as `expectedRevision`, and a newly persisted UUID as `requestId`. Retain that exact input
before sending. When a reply is lost, inspect the receipt; do not infer failure or send a replacement UUID.

1. Read `browser_vault_status`. Plan `browser_vault_plan` with
   `{ "action": "start", "signupsAllowed": true }`, inspect blockers, then call `browser_vault_apply`.
   First start explicitly downloads the pinned image if missing and creates its own VM/volume. Read status
   until its receipt is completed and `healthy` is true. This says nothing about an account yet.
2. Call `browser_extension_install_bitwarden`. Retain its `{id, digest}`. Custom extensions instead use
   `browser_extension_import` with a local absolute directory/ZIP path and a catalog ID.
3. Choose or create a named standalone browser with `browser_standalone_create`; wait for its profile to
   be ready. Read `browser_profile_extensions_get`. Save using `browser_profile_extensions_set` with
   `profileId`, the configuration's `expectedRevision`, an array containing the Bitwarden `{id,digest}`,
   and `vaultId` from the healthy service. Omitted `vaultId` preserves its current value; null removes it.
4. Close controllers and resolve handoffs. For a Bot profile, stop its Bot too. Call
   `browser_profile_extensions_plan` with the profile ID and saved `configurationRevision`, then
   `browser_profile_extensions_apply`. The operation retains the profile data but restarts its browser.
   Read its receipt and wait for the profile to recover readiness. Inspect desired/applied/observed sets.
5. Call `browser_operator_handoff_request` with `profileId`, `requestId`, and a short message. When it is
   `awaiting_human`, call `browser_management_page_open` with its `handoffId`, `expectedRevision`, a new
   `requestId`, and `{ "kind": "vault", "entry": "register" }`. This opens the upstream account-creation
   page; it does not create the account. Take the handoff using its returned revision and create the
   account/master password directly in the browser. Use the dedicated agent email/account identity.
6. Finish the handoff. Stop Vaultwarden through a plan/apply pair, then start it with
   `signupsAllowed: false`. Verify the service is healthy and registration is closed. The private address
   and certificate remain the same even when Hypeman changes the VM's guest IP.
7. Request another operator handoff and open
   `{ "kind": "extension", "id": "bitwarden", "entry": "popup" }`. Take control. In the extension,
   choose **self-hosted** and enter `appliedVault.origin` exactly. Log in with the dedicated account.
   The extension may first ask about becoming the default password manager; this is upstream UI.
8. If unattended use is intended, explicitly choose **Never** for the extension's vault timeout and
   acknowledge its warning. That client policy retains decryption capability in the browser profile;
   equivalent host/profile access can use the vault. Stack never asks for or stores the master password.
   Finish the handoff, reconnect the agent controller and verify with a fresh snapshot/autofill attempt.

The account can manage passwords, cards, notes and other supported items in Vaultwarden's existing web
interface. Open it with `{ "kind": "vault" }` through the same handoff workflow. Individual extensions
may provide popup, options, both, or neither; the catalog declares the available entry points.

## Other extensions and updates

Import a directory or ZIP containing `manifest.json` at its root. MV3 is required. Imports reject links,
unsafe/colliding paths, duplicate entries and excessive expansion. Review required/optional permissions,
host access and content-script matches before selecting a version. Imported source executes with the
browser profile's privileges once explicitly applied, so install code you trust.

Re-import an edited development directory under the same catalog ID. A new digest captures the new bytes;
its Chrome ID remains stable. Explicitly select and apply the new digest. Live source edits never change
an already imported artifact. Choosing different sets on different profiles does not affect siblings.
Per-launch overrides, hot reload, stores, automated updates and a cross-browser extension marketplace are
outside this first implementation.

Removing an entry from the desired list and applying disables it while retaining its storage. Selecting
an empty array disables all extensions. These operations are not uninstall or storage purge. Only the
existing whole-profile reset/deletion discards all of that profile's extension data. Catalog versions and
staged older packages are retained; there is no individual purge or catalog garbage-collection control yet.
A profile reset clears applied observations and requires explicit reapplication of its retained selection.

## Recovery

For extension application, use `browse_state_receipt_get`, `browser_profile_extensions_get`, and
`browser_profile_extensions_inspect`. Inspection uses an already running exact owned profile and does not
launch it. Unknown/partial effects remain held by `maintenanceRequestId`. Read the actual loaded IDs and
versions and inspect native resources before using `browse_state_fence_release` with the exact request
and generation. Release acknowledges inspection; it does not complete, retry or roll back the failed apply.
A new plan is a new deliberate action. Never reuse the uncertain apply to trigger another restart.

For vault operations, use `browser_vault_receipt_get` and `browser_vault_status`. An unknown receipt retains
its exact resource lease and fence. `browser_vault_fence_release` requires the receipt UUID and the current
status revision, verifies resources, and performs no lifecycle effect. A partly provisioned service may
require explicit deletion of its exact remaining resources before a fresh start. Foreign or changed
instances, mounts and provider destinations block effects. No similar-looking resources are adopted.

Management-page navigation has its own request UUID in the handoff's retained action history. Repeat only
the identical input to read the existing result; it never opens another tab. If its issue says navigation
is unknown, take the existing handoff and inspect the browser. Handoff completion is a human report to
verify, not proof of credential readiness.

## Backup, restore and deletion

`browser_vault_plan` with `action: "backup"` gracefully stops Vaultwarden's writer, syncs its data, creates a
full `/data` archive with checksum and service identity, and stops its VM. Read the receipt and
`browser_vault_backup_list`. Start the service separately afterward. Archives are bounded at 256 MiB
compressed; larger attachment collections require a separately reviewed backup mechanism. Host files are
private, but archives include service private keys and account metadata as well as encrypted vault items.
Copy the archive, its `.json` metadata and `.record.json` identity sidecar into protected independent storage.
A same-host copy does not survive loss of the host or installation reset.

To restore an owner-local backup, explicitly stop and delete the current service first; a restore never
replaces a live service. Plan `action: "restore"` with its `backupId`, review the rollback consequences and
apply. Restore checks the recorded path, size, checksum, service identity and provider destination, creates
new exact resources, retains the vault's hostname/certificate/private port, and starts registration closed.
Reauthenticate clients and reconcile any more recent offline changes deliberately. Cross-installation
recovery and version upgrades need a separate migration; no arbitrary archive path is accepted here.

Service deletion requires a stopped VM, verifies exact ownership and unmounted volume state, and deletes
its VM and data volume. It retains host backups, browser extension caches and credentials copied elsewhere.
Deleting the service does not revoke offline client data. Explicit browser profile reset/deletion is the
separate destructive boundary for that data. Hypeman selection/uninstall and installation reset are blocked
while the managed vault resource record remains.

## Runtime ownership

The private TLS passthrough listener belongs to Browse and closes when its owner closes. The dedicated VM
can remain running. On owner startup, a retained running intent restores the listener and may restart the
exact stopped VM, with registration closed on that start. An explicitly stopped service stays stopped;
fenced or missing resources are never replaced automatically. Verify service health and client unlock
separately after a host restart. Neither startup nor setup imports a person's native browser credentials.
