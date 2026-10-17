# Named standalone browsers: API contract and UI handoff

Implemented on `feat/standalone-browsers`. This is an integration contract, not a UI design. The approved scope is in [standalone-browsers.md](standalone-browsers.md). Extension support is excluded.

## Ownership and storage

A named standalone browser is a durable Browser profile with `botId: null`, a non-null `name`, and `default: false`. Its UUID identifies the profile incarnation; its name identifies the current browser in that Browse owner's state directory. Deleting and recreating a name creates a new UUID and empty volume. Names are not global across Stack installations.

Existing Bot profiles keep their exclusive Bot assignment, signed provider identity, controller selection and handoff behavior. Legacy unassigned profiles have both `botId: null` and `name: null`; they do not become standalone browsers automatically. Deleting a Bot still retains its unnamed profiles. There is no rename, adoption, ownership transfer or conversion operation.

The additive representation uses `name` and `stopped` alongside the existing profile fields, rather than replacing `botId` with an owner union. The existing version-1 `browser/profiles.json` ledger defaults missing `name` to null, missing `stopped` to false and missing `standaloneBindings` to an empty array. The separate `browser/sessions.json` retains the exact Hypeman instance/volume receipt. Both are under `STACK_STATE_DIR` (default `~/.local/state/stack`); clients must use API reads, not edit either ledger.

Each profile uses the existing local Hypeman backend, pinned Kernel Chrome image, persistent volume mounted at `/home/kernel`, gated loopback CDP relay and observation viewer. Cookies and sign-ins belong to that volume. No existing research store, browser profile or credentials are imported.

## Public Browser profile record

Create, start and stop return this complete record. List and get wrap the same record. The existing operator `browser_profile_list` also includes named profiles. All keys are present in normalized responses.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | UUID string | Durable profile incarnation. |
| `botId` | string or null | Null for standalone browsers. Bot ownership otherwise. |
| `name` | string or null | Unique standalone name within this owner; null for Bot and legacy unassigned profiles. |
| `label` | string | Display label; defaults to the name on standalone creation. |
| `default` | boolean | False for standalone browsers; existing Bot default semantics are unchanged. |
| `createdAt` | ISO timestamp string | Profile creation time. |
| `generation` | nonnegative integer | Existing maintenance generation; initially 0. |
| `maintenanceRequestId` | UUID string or null | Existing unresolved profile-maintenance fence. |
| `stopped` | boolean | Persisted intent to suppress supervision. True can accompany `stopping`, `stopped`, `deleting` or `failed`; it is not proof the VM is stopped. |
| `state` | `starting` / `ready` / `recovering` / `failed` / `stopping` / `stopped` / `deleting` | Lifecycle observation described below. |
| `error` | string or null | Latest lifecycle failure; may remain during recovery until the next successful observation. |
| `observedAt` | ISO timestamp string or null | Latest recorded health/lifecycle observation; not last page activity. |
| `cdpUrl` | string or null | Current managed loopback CDP URL when ready. Not a durable identity. |
| `observation` | object or null | Current observation viewer, with the fields below. |
| `observation.url` | string | Current managed viewer URL. |
| `observation.udpPort` | number | Existing Hypeman/Neko UDP port. |
| `observation.follows` | literal `visible-tab` | Viewer follows the visible tab, not a selected page identity. |
| `observation.verified` | literal false | A URL does not prove delivery or that a person viewed it. |

Name validation is exactly `[a-z0-9-]{1,40}`: lowercase ASCII letters, digits and hyphens, including boundary hyphens. No whitespace, slashes or normalization at the API boundary. A creation label, when supplied, must contain 1–128 characters. Duplicate create preserves the original label, UUID and stopped intent; it is not an update or an implicit start.

## Operations and transports

All eight operations below are declared on the Browse Unix socket, MCP and WebSocket. Inputs are strict objects: unknown keys are rejected. The socket is `<STACK_STATE_DIR>/sockets/browse.sock`. Socket `tools/call` uses `{name, arguments}`. WebSocket `tools/call` uses `{package: "browse", name, arguments}` on the existing authenticated gateway. MCP uses the same names and input objects and returns both structured content and its JSON text representation.

Standalone operations require no Bot identity or per-browser grant. Every otherwise-authorized MCP caller can use them, including operators, Workers, injected Roles, and Bots of any Role. The shared role policy allows only these eight exact operation names; it does not grant Bot-profile operations or unrelated Browse administration. Existing MCP authentication, signed managed-launch checks, Bot thread metadata and transport exposure checks remain in effect. The manifest's legacy `workerOperations` disclosure contains only list/get because that selection is read-only; it is not the role-policy allowlist for Worker calls. A running Browse owner is required: “standalone browser” does not mean server-independent execution of an API operation. Remote Access allowlists and scopes are unchanged; this feature adds no remote Browse permission.

| Operation | Input | Output | Behavior |
| --- | --- | --- | --- |
| `browser_standalone_create` | `{name: string, label?: string}` | Browser profile | Idempotent by name. Persists admission, then starts asynchronously. `starting` is not readiness. |
| `browser_standalone_list` | `{}` | `{browsers: BrowserProfile[]}` | Named non-Bot profiles only, including stopped/failed profiles. No pagination. |
| `browser_standalone_get` | `{name: string}` | `{browser: BrowserProfile \| null}` | Null means the name does not exist; does not start it. |
| `browser_standalone_start` | `{name: string}` | Browser profile | Explicitly clears stop intent and attempts readiness while holding the profile lifecycle locks. Rechecks an already-running browser. Startup failure is returned as `state: "failed"` with `error`, not necessarily a transport error. |
| `browser_standalone_stop` | `{name: string}` | Browser profile | Persists stop intent, holds/drains managed CDP, cleanly closes Chrome, stops the exact VM and verifies `Stopped`. Keeps volume and profile. Already-confirmed stopped is a no-op. |
| `browser_standalone_delete` | `{name: string, confirm: "delete"}` | `{deleted: true}` | Destructive: drains the managed gate and removes the exact owned VM, volume, profile and standalone controller records. Missing name succeeds. Can delete a running or stopped browser. |
| `browser_standalone_attach` | `{name: string, session: string}` | `{cdpUrl: string, cleanup: {controller: string, revision: integer}}` | Provider admission. Starts a stopped browser, requires readiness and records an uncertain controller admission. The session is 1–128 characters with no ASCII control characters or DEL. Does not create a missing browser. |
| `browser_standalone_detach` | `{controller: string, revision: integer}` | `{closed: true}` | Provider close notice. Updates only the exact current controller revision. Stale/unknown receipts are harmless no-ops. Never stops/deletes a browser or acts on a Bot controller. |

`cleanup.controller` is an opaque `standalone:`-prefixed identifier. Keep the entire returned cleanup object unchanged for detach. Admission does not prove agent-browser connected; detach is a disconnect notice, not proof of profile shutdown.

## Provider and CLI

The existing `stack` agent-browser plugin accepts `browser=<name>` as its optional argument, or, when there is no argument, `AGENT_BROWSER_STACK_BROWSER=<name>`. An explicit standalone argument wins over the environment. A signed Bot identity argument keeps precedence over a standalone environment variable and follows the unchanged `browser_controller_launch` path. Standalone launches call attach; close notices bearing a standalone cleanup token call detach. Close remains successful when the owner is unavailable, because agent-browser owns its own disconnect. Changing a target for an already-running agent-browser session does not retarget its existing connection; close that session or use a separate session/namespace. The CLI `drive` config isolates namespaces by browser name.

A provider config must point to the installed `packages/browse/dist/src/provider.js`, with provider/plugin name `stack` and capability `browser.provider`. Page operations remain agent-browser operations; the Stack API does not add navigation, clicking or page extraction operations. A raw CDP client is outside the managed provider admission contract.

| CLI | API/effect | Output |
| --- | --- | --- |
| `stack browse ls` | standalone list | One tab-separated line per browser: name, state, CDP URL or `-`, and error when present. |
| `stack browse create NAME [--label LABEL]` | standalone create | One profile line in the same format; success means admission, not readiness. |
| `stack browse start NAME` | standalone start | One profile line; exits 0 only when the result is ready. |
| `stack browse stop NAME` | standalone stop | One profile line on success. |
| `stack browse rm NAME` | standalone delete with `confirm: "delete"` | `deleted NAME`; no interactive confirmation. |
| `stack browse cdp NAME` | standalone get | Current CDP URL; exits 1 for missing/not-ready URL, without starting. |
| `stack browse drive NAME -- <agent-browser args…>` | Runs agent-browser through the provider | Child stdout/stderr and exit status. Defaults to `--session NAME` unless supplied. |

`drive` atomically writes a private config at `<STACK_STATE_DIR>/browser/controllers/standalone-NAME.json`, using the provider from this installation. Its namespace hashes the exact state directory and browser name, preventing ordinary session-name collisions across browsers/installations. It sets `idleTimeout: "0"`, removes inherited `AGENT_BROWSER_*` settings for the child, and supplies its own config and target. `STACK_AGENT_BROWSER` can select an executable; otherwise it runs `agent-browser` from PATH. Explicit agent-browser flags, including a namespace override, remain the caller's responsibility. Missing binaries exit 127; malformed CLI usage exits 1. There is no separate CLI get or attach/detach command. `cdp` is a read; `drive` uses the provider.

Example:

```sh
stack browse create research
stack browse drive research -- --session task open https://example.com
stack browse drive research -- --session task snapshot -i
stack browse stop research
stack browse start research
stack browse rm research
```

## Lifecycle, concurrency and events

Creation returns `starting`; background supervision reports `ready` or `failed`. Running profiles are checked on the existing five-second supervision cycle. `recovering` covers owner restart, retry after failure and native restart; there is no automatic replacement of a missing/changed native VM or volume.

Stop saves `stopped: true` and `state: "stopping"` before native effects. Managed input is held and drained before Chrome's clean close. `state: "stopped"` is written only after Hypeman confirms the exact owned VM stopped; the public CDP/viewer URLs are cleared. Supervision skips every profile with stop intent, including failed stops. Stop failure keeps `stopped: true`, records `failed` plus an error, and throws. The VM may still be running. An interrupted stop/delete is never converted into a successful stop on owner restart. Explicit start/attach can clear stop intent; create/list/get cannot.

Start, attach, stop and deletion share the existing per-profile lifecycle locks. Attach's readiness check and controller admission occur under the same locks. A queued admission cannot revive a deleted profile incarnation. Failed deletion retains the profile with stop intent and an error; supervision cannot recreate resources while deletion is unresolved. There is no background deletion replay. Re-read before explicit recovery, especially after a timeout: failure to receive a reply is not proof that an operation did not run. Name-based calls do not carry an expected UUID, so inspect the current incarnation before acting if other callers may have deleted and reused the name.

Owner shutdown retains volumes, closes managed relays and stops running profile VMs through the existing backend. Owner restart recovers running-intent profiles and clears stale URLs; explicitly stopped profiles stay stopped. Existing maintenance fences block start, stop, attach and deletion. Standalone controller admissions also block maintenance until detached or disconnected by a successful stop. Named standalone browsers do not add a human-handoff workflow; existing handoff checks remain protective.

`browser_standalone_changed` is an unscoped invalidation topic available on socket, MCP and WebSocket. Re-read list/get after it. The owner currently publishes it alongside `browser_profiles_changed` on profile-ledger saves, including controller notices, health observations and unrelated Bot-profile saves. It is not a per-browser transition payload or completion receipt. Existing UI subscriptions to `browser_profiles_changed` already refresh the shared profiles/controllers reads; the UI profile type and state rendering include the added fields/states. The Browse space's Browsers pane ([ADR 0181](adr/0181-browse-named-browsers.md)) reads `browser_standalone_list` and re-reads it on this topic. MCP event subscriptions retain their existing delivery-authority requirements; making the topic available does not give Workers or operators Bot Chat snapshot watches.

Standalone controller records are private ledger bookkeeping, not new `browser_controller_list` rows. Their fields are `controller: string`, `profileId: UUID`, `session: string`, `revision: nonnegative integer`, `state: "unknown" | "disconnected"`, and `observedAt: ISO timestamp`. Attach increments revision; successful stop invalidates prior cleanup revisions; owner restart advances revisions and marks running-intent admissions unknown, while confirmed-stopped profiles retain disconnected bindings. There is no standalone controller-list/selection API in this change. Bot controller records and APIs are unchanged.

## Errors and limits

Socket validation and definite pre-effect refusals use the existing `stack_operation_rejected` code with a message. Ordinary runtime errors need not carry that code. MCP reports tool failures with `isError: true` and text; WebSocket retains its existing error envelope. No new numeric domain error-code taxonomy is introduced.

| Error/observation | Meaning and handling |
| --- | --- |
| Name/label/session validation, unknown input key, wrong delete confirmation | Input rejected before dispatch. Correct the input. |
| `unknown standalone browser: NAME` | Start/stop/attach target does not exist. Get returns null; delete succeeds when absent. |
| `standalone browser was deleted` / `…was replaced` | Another lifecycle operation removed/replaced the selected incarnation before execution. Re-read. |
| `browser profile limit reached (16)` | Standalone create sees 16 existing durable profiles, including Bot and legacy profiles. |
| `all disposable browser session slots are occupied` | Existing backend wording for its 16-reservation limit, shared by durable profiles and disposable sessions. A durable row may already exist in failed state. |
| `local Hypeman has insufficient disk capacity for a browser target` | Provisioning requires at least 12 GiB free as reported by Hypeman. Each profile volume is 2 GiB. |
| `Profile maintenance remains fenced` | Inspect/recover the existing maintenance receipt before the existing exact release flow. No implicit release. |
| Unresolved/held handoff or unknown CDP quiescence | Managed work cannot safely drain; stop/delete/admission is refused or fails without enabling supervision. |
| Missing/disabled/stopped Hypeman installation | Configure/enable the local backend through its existing operator toolchain. An external Hypeman service is not implicitly started. |
| Changed/foreign VM or volume, missing recorded VM, changed mount | Exact ownership verification failed. Retain evidence and inspect; no automatic replacement or foreign-resource deletion. |
| Incomplete provisioning / `stop cannot confirm native absence` | Reservation exists without a complete native receipt; stop cannot claim success. Explicit deletion can reconcile resources bearing that exact reservation's ownership tags. |
| Chrome readiness/close timeout, refused close, VM stop unconfirmed | Read the profile's current state/error. Stop intent stays set after failed stop; an explicit recovery decision is required. |
| Owner unavailable/shutting down or response timeout | Read the current state once available. No automatic ambiguous-call replay. |

Names are shared within the same-user local trust boundary, not reserved to the creator. Any authorized standalone caller can stop/delete another named browser. There is no per-name access grant, quota, TTL, automatic expiry, rename, extension management, account sign-in automation, or public stable CDP URL. Session names do not confer Bot identity. Health timestamps are not a last-used audit; the CLI does not claim to report last page activity.

## Verification and remaining work

Fixture tests exercise name validation/idempotency, list/get isolation, clean stop and retained volume, owner reconstruction, supervision suppression, start/attach, stale detach receipts, deletion/maintenance races, provider routing and Bot identity precedence. MCP ingress tests cover operator, Worker and unassigned Bot calls with existing managed identity checks. Discovery tests and existing Bot/Worker/Role launch expectations include standalone exposure.

The isolated real-owner e2e was started, then explicitly deferred to the supervisor because the host denied Node/Python connections to the guest while curl could reach it. The separate owner was stopped, its exact test VM and volume were removed, and the remaining Hypeman inventory matched the initial inventory. Read-only checks confirmed the live `stack-qa` profile remained ready and its CDP `/json/version` responded. Page interaction and cookie persistence across a real VM stop/start remain for that separate e2e; no success is claimed here. Command output is retained at `/tmp/standalone-e2e.log` on the verification host.
