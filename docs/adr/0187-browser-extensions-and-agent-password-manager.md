# 187. Browser extensions and an agent password manager

Status: accepted, 2026-10-21.

## Decision

Browse owns a general, immutable MV3 extension catalog and per-profile selections. The first supported
password manager is the pinned official Bitwarden extension with an optional managed Vaultwarden service.
This is a dedicated agent account, not an import of a person's existing password manager. The person creates
the account and its master password directly in the upstream web interface inside a Stack browser.

An import snapshots an unpacked directory or ZIP. A catalog ID retains one Chrome public key across versions;
content hashes identify immutable artifacts. The loader preserves the entire manifest, including content
script declarations. Import discloses required and optional permissions and host matches, but executes nothing.
Only explicit operator selection and application admit code into a profile. Research/disposable browsers
never receive these settings. Changed extension identities, symlinks, unsafe archive paths and excessive expansion fail closed.
The official Bitwarden installer verifies the pinned release ZIP hash before import.

Selection is per durable Browser profile, including named standalone browsers. The same profile's tabs and
controllers share its extensions. Saved selection, last successful application and timestamped observation
are distinct. Applying uses Browse's exact plan/receipt/fence contract: stop the assigned Bot, disconnect
controllers and resolve handoffs first. Apply verifies native identity and mount, stages immutable packages,
cleanly restarts that profile, and verifies loaded Chrome IDs and versions. Stopping freezes the Chrome
supervisor before `Browser.close`, waits for Chrome processes to exit, then syncs the guest disk before VM stop.
Failure resumes supervision where possible and never forces a VM stop with unconfirmed writes.

Removing an extension from the selection disables it; it does not erase its data. Re-enabling the same identity
retains storage. Uninstall, individual extension-storage purge, catalog garbage collection, automatic updates,
hot reload and per-launch overrides are separate future controls. Whole-profile reset/deletion remains the
existing explicit destructive boundary. Reset retains desired configuration but clears applied observations
and requires explicit reapplication.

## Password manager service

Vaultwarden runs from a pinned official image in a separate Hypeman VM and persistent `/data` volume. It is
not a Browser profile and never shares Chromium's volume. Its record pins provider destination, resource
identity, image, HTTPS identity, private ingress address and port. Provider changes and installation reset
cannot strand it: exact vault deletion is required first. Status/plan reads never install or start resources.
Explicit start may install the pinned image. Start/stop/backup/restore/delete use durable, revisioned admission
receipts; interrupted effects retain a fence, and repeating a UUID only reads the original receipt.

The service creates its TLS key inside its volume. A TLS passthrough listener binds only the provider's
private guest bridge, accepts guest-subnet sources, and resolves the exact owned VM before forwarding.
It never terminates TLS or sees decrypted credential traffic. This stable address survives guest-IP changes.
Selecting a vault for a profile installs its private hostname mapping and the exact certificate public-key
exception in Chromium's startup flags. It never disables general TLS verification. No public/LAN/tailnet
listener, remote Access grant, native browser installation or OS-wide CA change is introduced.

The service's retained running intent recovers its exact existing resources on owner startup. It does not
replace missing resources or replay interrupted admissions. The private listener closes with its owner;
the service VM may remain running, and a later owner restores the listener. An explicitly stopped service
stays stopped. Registration defaults closed; account setup explicitly opens it, then explicitly stops/starts
closed. Recovery never opens registration on a new service start. There is no admin token or SMTP setup.

Backups quiesce Vaultwarden, sync, export its complete data directory to a private host archive, record a
checksum and service identity, then stop the VM. They contain encrypted vault items, account metadata and
service private keys. Restore requires no existing managed service, the exact retained backup, checksum and
provider destination; it creates a new volume and VM, preserves the HTTPS identity, and starts registration
closed. Restoring older data requires client reauthentication and deliberate reconciliation of newer offline
client changes. Local backups are retained on vault deletion, but an installation reset can remove local
state: copy backups to protected independent storage. Cross-installation disaster recovery and upgrades
require a separately reviewed migration; there is no arbitrary-archive import or automatic version upgrade.

## Human and agent interaction

A local operator may request a handoff without inventing a Bot Chat. Such records have `origin: operator`
and null Bot/thread/launch fields; existing records default to `origin: bot`. They use the same managed drain,
take, finish and retained human-report semantics. Operator handoffs have no Bot completion watch.

While a handoff awaits the person, a separate exact-request operation can open an applied extension's declared
popup/options page or the selected vault's web interface. Navigation admission is recorded first; an uncertain
navigation is never repeated under its UUID. No arbitrary URL or password is accepted by that API. The person
then takes control, uses the upstream UI and finishes the handoff. Page interactions remain in agent-browser.

Unattended operation is an explicit Bitwarden client policy selected during setup, rather than a server claim
that a vault is unlocked. The dedicated agent profile may retain a local decryption key when the person selects
Never as the extension timeout. Anyone with equivalent host/profile authority can use those credentials.
Health, loaded extension identity and human completion never prove login, unlock, sync or successful autofill.
There is no Stack plaintext password CRUD endpoint or master-password field.

## UI boundary

This change exposes backend operations and maintains existing UI types and handoff rendering. It introduces
no new panes, controls or UI dependencies. The UI team's implementation is a separate deliverable: catalog
and permission review, per-profile selection/application, service setup and recovery, backup/restore,
management-page handoffs, and truthful saved/applied/observed/unlocked distinctions. Browse remains local-only
under ADR 0101. The Content Vault is unrelated; use “agent password manager” for this capability.

See the maintained [operator runbook](../browse-password-manager.md).
