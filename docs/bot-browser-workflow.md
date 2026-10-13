# Core Bot and browser workflow

Stack's private Package API sockets are the control boundary. The `auth` owner
retains registered Codex accounts; `bots` runs the pinned codexnk app-server and
owns each Bot's sanctioned main thread, uploads and private workspace. Fleet
(`/fleet`) follows that thread and sends typed chat input. `browse` provisions an
exclusive default profile for each Bot in the selected local Hypeman installation.
The profile's Kernel Chrome user-data volume outlives controller connections,
Bot stops and planned server restarts. Bot deletion retains profiles unassigned.

Browser page and tab commands belong to the pinned agent-browser toolchain. Its
inherited `AGENT_BROWSER_CONFIG` and namespace carry the current Bot launch proof;
an arbitrary session name supplies no identity. Browser control uses the managed
CDP gate. Human handoffs hold the whole profile and use the local Browse UI; a
reported completion must be checked with a fresh agent snapshot. Credentials must
stay in the supported account login flow or the human-controlled profile viewer.
See [browser operations](browser-operations.md) and [the trust boundary](security.md).

## Verification boundaries

`pnpm test` builds packages and runs fixture tests. Run it with Stack stopped or
in a separate checkout: rebuilding the live UI's `.next` directory is unsafe.
Lifecycle tests must use disposable state and must not claim a live socket.

Real verification needs separate evidence for each boundary:

- Service readiness: `serve_status` reports all required children running.
- Codex use: choose an existing enabled account, inspect `bot_settings_options`,
  and observe a harmless `chat_send` turn reach `completed` with its expected
  assistant reply. Admission and a model catalog alone do not establish this.
- Durable chat: wait beyond Codex's idle-unload interval and send another turn on
  the same root. The long-lived Stack watcher must resume that exact root on its
  own connection; a socket that only initializes cannot retain the subscription.
  Reconnect must rejoin it without selecting a different root or changing settings.
- Uploads: transfer a local sample through start/chunk/status/finish, compare its
  SHA-256, then reference the finalized file in a harmless chat turn and verify the Bot's response contains evidence read from that file.
- Container browser: observe the exact Bot profile reach `ready`, use its managed
  controller to fill/click a local sample page and upload only sample bytes.
- Persistence and isolation: set test cookies and storage on a sample origin,
  verify another Bot's empty profile lacks them, then verify the first profile
  retains them after a planned browser-owner shutdown and restart. This models
  persistence without entering real account credentials.

Process launch settings and resumed thread settings are distinct. If a saved
model is unsupported, inspect native choices and explicitly select a supported
model in `chat_send`; restarting with different process defaults need not retune
an existing thread. Keep native failures and uncertain admissions inspectable;
never resend a lost mutation merely to get a clean receipt.

## Successor record: greybird, 2026-10-13

The initial checkout was clean `main` at `f89c54f`. Stack was stopped, with two
enabled Codex accounts, no recorded Bots and one retained unassigned profile.
The QA work created only the named `stack-qa` Bot and its separate default profile;
it does not reset the installation or import credentials, research stores or
personal browser data. The unrelated job-search task is outside this work.

A separate process occupies loopback port 8787. Start this installation with
`STACK_GITHUB_PORT=0 stack serve` to allocate its webhook listener without stopping
that process. This is a launch override, not an external webhook deployment or a
persistent configuration change. Fleet remains at `http://127.0.0.1:8745/fleet`.
The normal local session entry is `stack serve open`; coordinate any local desktop
interaction before opening it. Bootstrap fragments and cookies are secrets and
must never be copied into evidence.

The first saved account returned a routing-authentication 401. The second produced
a completed `STACK_CHAT_OK` response using its advertised `gpt-6-astra` model.
Both account records are retained. The QA Bot uses `workspace-write` and
`on-request`; no permission expansion is part of this work.

The initial live failure also exposed an unsubscribed chat watcher: after 60 idle
seconds Codex unloaded the main thread, and later input failed with `thread not
found`. The regression fixture now delivers item events only to native thread
subscribers. Stack's watcher retains and rejoins the sanctioned root, including
when a new Bot first receives its root. The real root stayed loaded after 115 idle
seconds and completed a second harmless reply without an auxiliary observer.

A second live defect was generic file delivery: native Codex `mention` selects
plugin resources and contributes no message text. Stack now converts its validated
file references into readable paths. Fleet's Tools upload/send flow delivered a
56-byte sample, Codex read that exact file, and Fleet rendered the expected marker.
The upload hash and native read were verified. The complete repository suite
passed all 50 tasks and the four install-script checks; UI typechecking passed.

Browser verification is blocked at the host network boundary. The new QA guest
reports Chrome/CDP and Neko ready internally, but host connections to its private
address fail with `EHOSTUNREACH` on ports 9222, 8080 and 10001. A macOS local-network
permission change requires human coordination; no permission was changed.
Read-only diagnosis confirmed `nehelper` logging “Local network denied by preference
for ChatGPT (com.openai.codex)” during the failures. The exact route is up through
`bridge100`, ARP matches the guest MAC, the retained guest's virtualization process
is alive, and host-to-guest TCP fails immediately before HTTP/CDP. Loopback Hypeman
access succeeds. Guest boot logs show CDP on `0.0.0.0:9222`, Neko on
`0.0.0.0:8080`, and the kernel API on `:10001`; current service responsiveness
remains unverified while host access is denied.

The proposed permission is macOS Local Network for that app. It is persistent and
app-wide, including child processes; the Settings toggle does not restrict the grant
to this one guest. Keep it unchanged until explicit approval and desktop
coordination. Do not route connections through another application or reset privacy
preferences to evade the denial. The old unassigned profile separately reports an
incarnation/ownership mismatch and stays retained. Do not rewrite its receipts, retag its VM or delete its volume to make
this test pass.

Private command logs and successor evidence live under
`~/scratch/stack-core-qa-20261013/`. Read the latest `handoff.md` there before
continuing. It records exact QA identities, current processes, completed checks
and remaining work; it contains no credentials. Existing profiles, auth databases
and unrelated services must be preserved. Changes requiring a factory reset,
credential entry or persistent security changes remain outside this QA authority.
