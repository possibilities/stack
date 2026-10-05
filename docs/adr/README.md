# Architecture decision index

Each row links to its complete decision record. Status is taken only from that record’s explicit status field; “Unstated” means no status field was found. The decision text remains authoritative for scope, amendments, and supersession.

| Identifier | Decision record | Recorded status |
| --- | --- | --- |
| 0001 | [Package APIs are typed libraries served by transport](0001-package-apis.md) | Unstated |
| 0002 | [Keep local control on private Unix sockets](0002-private-control-transport.md) | Accepted |
| 0003 | [Require the released codexnk runtime](0003-required-codexnk-runtime.md) | Accepted |
| 0004 | [Bind managed Codex servers to Stack accounts](0004-codex-account-state.md) | Accepted |
| 0005 | [Bind every Codex Server to one main thread](0005-server-main-threads.md) | Superseded |
| 0006 | [Render the Package API reference from discovery](0006-live-package-api-reference.md) | Superseded |
| 0007 | [Filter bot change events by subscription scope](0007-bot-scoped-change-events.md) | Accepted |
| 0008 | [Serve MCP operations through the socket owners](0008-mcp-rpc-transport.md) | Accepted |
| 0009 | [Serve the Package API reference with the owner](0009-serve-docs-with-owner.md) | Superseded |
| 0010 | [Forward WebSocket operations and events through socket owners](0010-shared-websocket-transport.md) | Accepted |
| 0011 | [Run the official Inspector with the owner](0011-owner-managed-mcp-inspector.md) | Accepted |
| 0012 | [Keep Codex account IDs stable and ordinals presentational](0012-stable-codex-account-ids.md) | Accepted |
| 0013 | [Run the standalone UI canvas with the owner](0013-owner-managed-ui-canvas.md) | Accepted |
| 0014 | [Retire superseded runtime copies and drain dependent Servers in order](0014-recovery-and-shutdown-order.md) | Accepted |
| 0015 | [Remove test input observation from Package APIs](0015-remove-test-input-observation-api.md) | Accepted |
| 0016 | [Use the UI root for live local links](0016-live-ui-index-and-system-theme.md) | Accepted |
| 0017 | [Persist caller launch arguments with each Server](0017-persist-server-launch-arguments.md) | Accepted |
| 0018 | [Allow a Server to start without a Codex account](0018-unbound-server-launch.md) | Accepted |
| 0019 | [Serve markdown twins from the local pages](0019-markdown-twins.md) | Superseded |
| 0020 | [Admit WebSocket connections from current Package API configuration](0020-live-websocket-admission.md) | Accepted |
| 0021 | [Connect managed Codex Servers to the owner's MCP Package APIs](0021-managed-servers-inherit-owner-mcp.md) | Accepted |
| 0022 | [Assign a Codex account to an existing Server](0022-server-account-assignment.md) | Accepted |
| 0023 | [Render the reference from one discovery snapshot](0023-discovery-snapshot.md) | Accepted |
| 0024 | [Make the first canvas experiment a live, read-only workbench](0024-live-canvas-workbench.md) | Accepted |
| 0025 | [Verify recovered app-server ownership and use per-launch sockets](0025-app-server-process-ownership.md) | Accepted |
| 0026 | [Operate the auth Package API from the canvas](0026-canvas-auth-controls.md) | Accepted |
| 0026 | [Bind the first durable UI thread as a Server's main thread](0026-lazy-server-main-thread.md) | Accepted |
| 0027 | [Materialize the default capabilities bundle for each managed Codex launch](0027-default-capabilities-bundle.md) | Accepted |
| 0028 | [Dial native realtime into the existing main thread](0028-main-thread-voice-call.md) | Accepted |
| 0029 | [Make Bots the sole managed Codex lifecycle](0029-bots-own-codex-lifecycle.md) | Accepted |
| 0030 | [Name the single launch configuration a Role](0030-single-role-package.md) | Superseded |
| 0031 | [Keep role skills and extra MCP servers in private launch snapshots](0031-role-resources.md) | Accepted |
| 0032 | [Bind internal MCP connections to live Bot launches](0032-bot-mcp-invocation-context.md) | Accepted |
| 0033 | [Deliver Package API event snapshots into subscribed Bot threads](0033-agent-facing-event-subscriptions.md) | Accepted |
| 0034 | [Select project MCP through explicit Role trust](0034-explicit-project-trust-for-role-bots.md) | Accepted |
| 0035 | [Launch Bots with full access by default](0035-full-access-bot-default.md) | Accepted |
| 0035 | [A call dock and shared voice state on the canvas](0035-voice-call-dock.md) | Accepted |
| 0036 | [Bind worker catalogs to isolated native ACP accounts](0036-account-bound-acp-foundation.md) | Accepted |
| 0037 | [Snapshot API-owned launch defaults for each Bot](0037-bot-launch-settings.md) | Accepted |
| 0038 | [Keep ACP Worker sessions and turns durable in owned worktrees](0038-durable-acp-worker-execution.md) | Accepted |
| 0039 | [Re-read Worker state into the originating Bot thread](0039-worker-wakeups-and-scoped-mcp.md) | Accepted |
| 0040 | [Bind Worker accounts and ACP runtimes to OpenCode V2](0040-opencode-v2-worker-accounts.md) | Accepted |
| 0041 | [Port the wiki into an isolated Package API](0041-isolated-wiki-package-api.md) | Accepted |
| 0042 | [Organize the canvas into spaces](0042-canvas-spaces.md) | Superseded |
| 0043 | [Expose sanctioned Codex chats through Bots](0043-bot-chat-apis.md) | Accepted |
| 0044 | [Observe registered accounts without routing them](0044-owner-usage-observations.md) | Accepted |
| 0045 | [Links go to cards; clicking a card inspects it in an edge sheet](0045-canvas-links-and-inspector-sheet.md) | Accepted |
| 0046 | [Recover only the owner's proven-stale socket at startup](0046-owner-stale-socket-recovery.md) | Accepted |
| 0047 | [Unify account management and require an explicit Bot account](0047-unified-account-inventory-and-explicit-bot-choice.md) | Accepted |
| 0048 | [Separate Bot and Worker accounts, correlate only in usage](0048-separate-bot-and-worker-sign-ins.md) | Accepted |
| 0049 | [Operate Worker accounts from the canvas](0049-canvas-worker-account-controls.md) | Accepted |
| 0050 | [API-driven Worker sign-in](0050-api-driven-worker-sign-in.md) | Accepted |
| 0051 | [Explicit inspect controls](0051-explicit-inspect-controls.md) | Accepted |
| 0052 | [Bound experimental inference to an explicit Bot account and private socket](0052-private-experimental-inference.md) | Accepted |
| 0053 | [Submit speech on the exact connected Bot call](0053-voice-speech-submission.md) | Accepted |
| 0054 | [Observe resources from the owner's process ancestry](0054-owner-resource-observations.md) | Accepted |
| 0055 | [Keep agent-tree observations with Bots and Workers](0055-agent-tree-observability.md) | Accepted |
| 0056 | [Operate Bots and inspect provider evidence in Fleet](0056-fleet-usage-catalogs-and-bot-controls.md) | Accepted |
| 0057 | [Make the canvas the UI home](0057-canvas-as-ui-home.md) | Accepted |
| 0058 | [One open bench with global System and API tools](0058-open-bench-and-global-tools.md) | Accepted |
| 0059 | [Isolate Brain and make device clients Stack applications](0059-isolated-brain-and-platform-clients.md) | Accepted |
| 0060 | [Share the Worker lifecycle with native Claude SDK sessions](0060-claude-sdk-workers.md) | Accepted |
| 0060 | [Resizable windows and a compact Fleet](0060-resizable-windows-and-compact-fleet.md) | Accepted |
| 0061 | [A Spaces menu apart from edge-anchored tools](0061-spaces-menu-and-edge-tools.md) | Accepted |
| 0062 | [Uniform usage limits and Grok Bot on the Grok Worker card](0062-usage-limits-and-grok-bot-card.md) | Accepted |
| 0063 | [Usage subscription end and sample age](0063-usage-subscription-end-and-sample-age.md) | Accepted |
| 0064 | [Codex Workers fold into their linked Bot's usage card](0064-codex-workers-fold-into-linked-bot-usage.md) | Accepted |
| 0065 | [Codex Worker accounts are paired with Codex Bot accounts](0065-codex-workers-paired-with-bot-accounts.md) | Accepted |
| 0066 | [Observe Grok Bot usage only beside a signed-in Grok Worker](0066-grok-bot-usage-beside-a-grok-worker.md) | Accepted |
| 0067 | [One Accounts window and bare, fitted empty states](0067-one-accounts-window-and-bare-empty-states.md) | Accepted |
| 0068 | [Create in window footers; overlay the drag grip](0068-window-footers-and-overlaid-drag-grip.md) | Accepted |
| 0069 | [An Accounts space beside Fleet, joined by card links](0069-accounts-space.md) | Accepted |
| 0070 | [Windows grow with their content and push windows below](0070-windows-grow-with-content.md) | Accepted |
| 0071 | [At most one info line on a Usage card](0071-one-line-usage-card-info.md) | Accepted |
| 0072 | [Fluid window gestures and a content-fit groove](0072-fluid-drag-and-content-fit-groove.md) | Accepted |
| 0073 | [A Lab space for experiment windows, starting with Call speech](0073-lab-space-and-call-speech.md) | Accepted |
| 0074 | [Lab inference over the loopback WebSocket](0074-lab-inference-over-websocket.md) | Accepted |
| 0075 | [Interpret newly observed conversation text with a headless attention service](0075-headless-conversation-attention.md) | Accepted |
| 0076 | [Keep disposable browser lifecycle behind agent-browser](0076-internal-disposable-browser-lifecycle.md) | Superseded |
| 0077 | [Content Package API with optional collections and portable identities](0077-content-collections.md) | Accepted |
| 0078 | [Declare HTTP surfaces and select Package API operations per transport](0078-declared-http-surfaces-and-operation-selection.md) | Accepted |
| 0079 | [System becomes a fourth space, showing owner resources](0079-system-space.md) | Accepted |
| 0080 | [Fleet chat windows follow each Bot's main thread](0080-fleet-chat-windows.md) | Accepted |
| 0081 | [The inference request ledger as API, with asynchronous admission](0081-infer-request-ledger-api.md) | Accepted |
| 0082 | [A Roles space for managing instruction fragments](0082-roles-space-for-instruction-fragments.md) | Accepted |
| 0083 | [Durable notifications without a presentation surface](0083-durable-notifications-api.md) | Superseded |
| 0084 | [Present typed Package API output as native MCP content when declared](0084-package-api-mcp-content.md) | Accepted |
| 0085 | [Pinnable inspector dock](0085-pinnable-inspector.md) | Accepted |
| 0086 | [Address Package APIs and subscriptions on one WebSocket connection](0086-multiplex-websocket-connections.md) | Accepted |
| 0087 | [Name the durable notification Package API `notify`](0087-notify-package-name.md) | Accepted |
| 0088 | [Independent open benches for Canvas spaces](0088-isolated-space-benches.md) | Accepted |
| 0089 | [Window sizes in whole grid cells](0089-window-sizes-in-grid-cells.md) | Accepted |
| 0090 | [Keep extraction and preset drift inside Stack Scrape](0090-scrape-package-api.md) | Accepted |
| 0091 | [Shared Access authority and direct tailnet ingress](0091-shared-access-and-direct-tailnet-ingress.md) | Accepted |
| 0092 | [Give Bots durable profiles and independent browser controllers](0092-durable-bot-browser-profiles.md) | Accepted |
| 0093 | [Fence managed browser control during durable human handoff](0093-enforced-browser-handoff.md) | Accepted |
| 0094 | [Name the three Package APIs signal, browse and worker](0094-package-addresses-signal-browse-worker.md) | Accepted |
| 0095 | [Notifications are open or dismissed, with an outcome](0095-one-dismissal-with-an-outcome.md) | Accepted |
| 0096 | [Require independent operation and event selections for MCP and WebSocket](0096-explicit-transport-exposure.md) | Accepted |
| 0097 | [An Inbox space for notifications](0097-inbox-space-for-notifications.md) | Accepted |
| 0098 | [The Roles space manages skills, MCP servers and trusted projects](0098-roles-space-for-launch-resources.md) | Accepted |
| 0099 | [A Signal space for conversation attention](0099-signal-space.md) | Accepted |
| 0100 | [A Content space for the Vault, collections and Artifacts](0100-content-space.md) | Accepted |
| 0101 | [Serve a scoped remote UIX through Access](0101-remote-uix-through-access.md) | Accepted |
| 0102 | [A read-only Workers space](0102-workers-space.md) | Accepted |
| 0103 | [A Scrape space, and Scrape's operator operations on the local WebSocket](0103-scrape-space-and-local-operator-exposure.md) | Accepted |
| 0104 | [Worker diffs and list summaries](0104-worker-diff-and-list-summaries.md) | Accepted |
| 0105 | [Proc owns local scheduling and guarded process execution](0105-proc-local-scheduling-and-process-control.md) | Accepted |
| 0106 | [Keep launch secrets out of ordinary reads and pin browser control origins](0106-local-surface-hardening.md) | Accepted |
| 0107 | [Integrate hardening with the operator UI and authenticated remote gateway](0107-hardening-and-operator-ui-integration.md) | Accepted |
| 0108 | [A Browse space for Browser profiles and human handoff](0108-browse-space.md) | Accepted |
| 0109 | [A Brain space, and Brain change notices on the local WebSocket](0109-brain-space.md) | Accepted |
| 0110 | [Proc schedules retain durable caller authority](0110-proc-durable-caller-authority.md) | Accepted |
| 0111 | [A Proc space for schedules, runs and their output](0111-proc-space.md) | Accepted |
| 0111 | [Keep the following-feed archive separate from Brain](0111-xcom-following-archive.md) | Accepted |
| 0112 | [Enforce research network authority at execution and connection boundaries](0112-research-network-egress.md) | Accepted |
| 0113 | [Authenticate ordinary loopback control clients](0113-authenticated-local-control.md) | Accepted |
| 0114 | [Select Worker-visible reads explicitly](0114-explicit-worker-disclosure.md) | Accepted |
| 0115 | [Name the process package Serve and the canvas package UI](0115-serve-and-ui-names.md) | Accepted |
| 0116 | [Serve the UI at the origin root](0116-ui-at-root.md) | Accepted |
| 0117 | [Package-owned CLI commands](0117-package-cli-exports.md) | Accepted |
| 0117 | [Rename the project identity to Stack](0117-stack-project-identity.md) | Accepted |
| 0118 | [Named Roles with one launch default](0118-multiple-roles-and-default.md) | Accepted |
| 0119 | [Per-Role internal MCP enablement](0119-per-role-internal-mcp.md) | Accepted |
| 0120 | [Let Codex schedule subscribed events and chat input](0120-codex-native-input-admission.md) | Accepted |
| 0121 | [The Roles space manages named Roles and per-Role internal MCP switches](0121-roles-space-for-named-roles.md) | Accepted |
| 0122 | [Select a Worker's Role at creation and deliver capabilities without Role instructions](0122-worker-role-selection-without-instructions.md) | Accepted |
| 0123 | [Inject a Role into one native CLI invocation](0123-role-injection-for-native-clis.md) | Accepted |
| 0124 | [Separate Manager and Worker launch defaults with instruction-capable Workers](0124-manager-and-worker-launch-defaults.md) | Accepted |
| 0125 | [The Roles space sets the Worker default](0125-roles-space-worker-default-control.md) | Accepted |
| 0126 | [The Roles space edits fragment conditions and previews a rendering context](0126-roles-space-fragment-conditions.md) | Accepted |
| 0127 | [QR invitations and delegated device enrollment](0127-qr-device-enrollment.md) | Accepted |
| 0127 | [The Roles space manages Role shims](0127-roles-space-role-shims.md) | Accepted |
| 0128 | [Manage explicit runtime settings with native defaults and separate application evidence](0128-managed-runtime-settings.md) | Accepted |
| 0129 | [Codex tools in the default MCP fleet](0129-codex-tools-in-default-mcp-fleet.md) | Unstated |
| 0130 | [Managed settings editors in Fleet and Workers](0130-managed-settings-editors.md) | Accepted |
| 0131 | [Observe Codex tool bridge availability separately from Role selection](0131-codex-tools-availability.md) | Accepted |
| 0132 | [Own semantic work in a native HUD Package API](0132-native-hud-work-collaboration.md) | Accepted |
| 0133 | [A HUD space for shared Work](0133-hud-space.md) | Accepted |
| 0134 | [Land on the HUD space](0134-hud-at-root.md) | Accepted |
| 0135 | [Owner state inspection and maintenance](0135-owner-state-maintenance.md) | Accepted |
| 0136 | [Show owner state in System and share one plan/receipt flow](0136-system-state-view-and-shared-maintenance-flow.md) | Accepted |
| 0137 | [Inspect and maintain one Bot's state in Fleet](0137-fleet-bot-state.md) | Accepted |
| 0138 | [Global developer mode gates upstream harness-release observations](0138-developer-mode-and-harness-releases.md) | Accepted |
| 0139 | [Owner maintenance in existing spaces](0139-owner-maintenance-in-existing-spaces.md) | Accepted |
| 0140 | [Use native stdio for Stack-provided MCP connections](0140-internal-mcp-over-stdio.md) | Accepted |
| 0141 | [Retire Grok support without deleting stored data](0141-retire-grok-support.md) | Accepted |
| 0141 | [Role-owned bot.md and fenced first-turn orientation](0141-role-bot-personality-and-orientation.md) | Accepted |
| 0142 | [Retire exact Work bodies without deleting semantic identity](0142-exact-work-body-retirement.md) | Accepted |
| 0143 | [Retire terminal Bot queue bodies with atomic admission evidence](0143-terminal-bot-queue-body-retirement.md) | Accepted |
| 0144 | [Brain payload retirement preserves admission and recovery authority](0144-brain-payload-retirement.md) | Accepted |
| 0145 | [Scrape maintenance holds claims and retains permanent generation fences](0145-scrape-maintenance-generation-fences.md) | Accepted |
| 0146 | [Separate internal MCP availability from the Server lifecycle](0146-server-independent-internal-mcp.md) | Accepted |
| 0147 | [Signal checkpoint reset rebaselines exact sources to now](0147-signal-rebaseline-to-now.md) | Accepted |
| 0148 | [Retained Role injection cleanup requires verified teardown](0148-retained-role-launch-liveness.md) | Accepted |
| 0149 | [Settings receipt retirement keeps permanent edit dedupe](0149-settings-receipt-retirement.md) | Accepted |
| 0150 | [Auth cache cleanup selects proven pure-cache bytes only](0150-auth-pure-cache-allow-list.md) | Accepted |
| 0151 | [Access retirement is exact expired metadata, not identity revocation](0151-exact-expired-access-history.md) | Accepted |
| 0152 | [Independent client bootstrap and scoped desktop UI handoffs](0152-independent-client-bootstrap-and-ui-handoffs.md) | Accepted |
| 0153 | [Exact closed-Worker state maintenance](0153-exact-worker-state-maintenance.md) | Accepted |
| 0154 | [Coordinate Notification sends and one-shot dismissal watches in the Server](0154-notification-send-and-watch.md) | Accepted |
| 0155 | [Correlate asynchronous admissions with exact completion and attention reads](0155-correlated-admission-watches.md) | Accepted |
| 0155 | [Exact Browser provider maintenance](0155-exact-browser-provider-maintenance.md) | Accepted |
| 0156 | [Content retention disclosure and publication maintenance](0156-content-retention-and-publication-maintenance.md) | Accepted |
| 0157 | [Device-local clear requests and receipts](0157-device-local-clear-request-and-receipt.md) | Proposed |
| 0158 | [Installation factory reset](0158-installation-factory-reset.md) | Accepted |
| 0159 | [Receive GitHub webhooks durably and expose filtered watch inboxes](0159-github-webhook-ledger-and-watches.md) | Accepted |
| 0160 | [Poll typed occurrences and deliver through backend-owned conversation intake](0160-poll-occurrences-and-runtime-event-intake.md) | Accepted |
| 0161 | [Initialize missing Roles on demand without a Server](0161-on-demand-role-initialization.md) | Accepted |
| 0162 | [Select Role capabilities by the actual launch harness](0162-role-capability-harness-selection.md) | Accepted |
| 0163 | [Page retained completion receipts and resolve exact domain links for the operator](0163-operator-completion-history-reads.md) | Accepted |
| 0164 | [A Source space for webhook receivers, deliveries and original payloads](0164-source-space.md) | Accepted |
| 0165 | [Source watches: definitions, a not-pinned inbox and explicit acknowledgement](0165-source-watches.md) | Accepted |
| 0166 | [Source receiver setup: create, secret, hook plan, probe and redelivery](0166-source-receiver-setup.md) | Accepted |
| 0167 | [Canvas destination isolation](0167-canvas-destination-isolation.md) | Accepted |
| 0168 | [Resolve Content transport configuration once](0168-shared-content-transport-configuration.md) | Accepted |
| 0169 | [Discover Source remote-request history from its server owner](0169-source-server-request-history.md) | Accepted |
| 0170 | [New Workers always use the canonical Worker Role](0170-fixed-worker-role.md) | Accepted |

## Reused identifiers

The following identifiers name more than one existing record. Use the linked filenames to disambiguate them until their identities and inbound references can be reviewed:

- 0026: [0026-canvas-auth-controls.md](0026-canvas-auth-controls.md), [0026-lazy-server-main-thread.md](0026-lazy-server-main-thread.md)
- 0035: [0035-full-access-bot-default.md](0035-full-access-bot-default.md), [0035-voice-call-dock.md](0035-voice-call-dock.md)
- 0060: [0060-claude-sdk-workers.md](0060-claude-sdk-workers.md), [0060-resizable-windows-and-compact-fleet.md](0060-resizable-windows-and-compact-fleet.md)
- 0111: [0111-proc-space.md](0111-proc-space.md), [0111-xcom-following-archive.md](0111-xcom-following-archive.md)
- 0117: [0117-package-cli-exports.md](0117-package-cli-exports.md), [0117-stack-project-identity.md](0117-stack-project-identity.md)
- 0127: [0127-qr-device-enrollment.md](0127-qr-device-enrollment.md), [0127-roles-space-role-shims.md](0127-roles-space-role-shims.md)
- 0141: [0141-retire-grok-support.md](0141-retire-grok-support.md), [0141-role-bot-personality-and-orientation.md](0141-role-bot-personality-and-orientation.md)
- 0155: [0155-correlated-admission-watches.md](0155-correlated-admission-watches.md), [0155-exact-browser-provider-maintenance.md](0155-exact-browser-provider-maintenance.md)

New records must use an unused identifier. Preserve earlier records and their reasoning when a decision changes.
