# Stack internal MCP role access proposal

Decision document for Admin Manager and Worker

Adopt three roles with positive per-tool grants. Admin is the manually started emergency Bot with all internal MCP tools. Manager delegates work, observes results and communicates with its Workers and the human. Worker executes its assignment and reports through its native session. Keep Manager free of emergency and general administration tools.

The per-role permission matrix is proposed and remains unimplemented. The separately authorized Worker change is implemented: every newly started Worker captures the canonical Worker role, with no selectable override or mutable Worker-default substitution. Existing Workers retain their saved launch snapshots. Admin startup and the broader per-tool policy require a separate implementation decision.

Implementation status: the Worker start API rejects `roleId`; the role catalog persists a fixed `worker_role_id`, adopting the existing Role named Worker once during compatible-store migration; and `role_set_worker_default` is retired. This removes one ordinary package tool from the inventory at commit `835ed9d`: the current source defines 286 ordinary tools plus 53 generated event tools, or 339 package tool instances. The five dynamic bridge servers remain available in the proposed design for all three roles. The matrix below lists the 286 current ordinary tools; it does not grant the proposed per-tool policy today.

## Recommended role boundaries

| Role | Ordinary tool baseline | Purpose and limits |
| --- | --- | --- |
| Admin | 286 allowed | All 286 ordinary and 53 generated internal tools, plus all five shared bridge servers. Explicit human launch; privileged actions still require applicable authorization. |
| Manager | 18 scoped | Start and direct approved Workers, read their progress, manage assigned work and ask the human. No package role edits, general process execution or Bot administration; all five bridges remain available. |
| Worker | 2 scoped | Read its own status/output. Use all five bridges and assigned native execution; return results through its native session. |
| Optional Worker capabilities | 27 conditional | Task-bound research, content reading, private artifact writing and scraping. Denied in the baseline; enable only after scope enforcement and explicit task need. |

Agreed shared access: Admin, Manager and Worker all receive codex-computer-use, chrome, messages, computer-history and openai-developer-docs. These bridge connections are an explicit exception to the role-specific package restrictions. Their broad capabilities mean the narrow package list alone cannot establish full role isolation. Existing platform permissions, application authorization and required confirmations still apply.

“Scoped” is a conditional design grant. Until the required server-side ownership and task checks exist, treat that operation as denied for the proposed restricted role. Tool hiding alone is not authorization and does not establish a security boundary.

## Verified inventory and current access

The read-only source inventory at commit 835ed9d contained 16 Stack package MCP servers and 287 ordinary registered tools. Generated event registrations added 53 exact tool instances, giving 340 source-defined package tool instances at that revision. Retiring `role_set_worker_default` leaves 286 ordinary and 339 total source-defined package tool instances. Five additional Codex bridge servers fetch tool catalogs dynamically. Their exact upstream tool names and live availability were not verified because the relevant runtime sockets were absent during the study. The total live internal tool universe remains unresolved.

At inventory revision 835ed9d, the saved catalog had Manager as the Bot default and Worker as the Worker default, with no Admin role. Both saved roles disabled api, had no internal MCP harness filters and had no additional Role MCP servers. Roles selected whole connections rather than individual tools. Manager consequently had up to 284 ordinary tools across 15 enabled package servers, subject to caller checks. Worker had a separate 40-tool manifest allowlist, with 37 ordinary tools reachable in the saved configuration after api was excluded. Both roles included the five bridge connections, subject to upstream availability. After this change, the canonical Worker identity is fixed and the Manager ordinary-tool ceiling is 283. [S1–S4]

### Server access summary

| Server | Ordinary tools | Admin | Manager | Worker |
| --- | --- | --- | --- | --- |
| api | 3 | All | None | None |
| auth | 18 | All | None | None |
| bots | 51 | All | None | None |
| brain | 32 | All | None | 3 optional |
| browse | 10 | All | None | None |
| content | 36 | All | None | 19 optional |
| hud | 14 | All | 7 scoped | None |
| notify | 6 | All | 2 scoped | None |
| proc | 17 | All | None | None |
| roles | 30 | All | None | None |
| scrape | 9 | All | None | 5 optional |
| serve | 4 | All | None | None |
| source | 17 | All | None | None |
| usage | 1 | All | None | None |
| worker | 28 | All | 9 scoped | 2 scoped |
| xcom | 10 | All | None | None |

Ordinary-tool totals reconcile to 286: 241 Admin-only, 16 Admin plus Manager, 2 Admin plus Manager plus Worker, and 27 Admin plus optional Worker. Admin has 286; Manager has 18; Worker has 2 by default or 29 if every optional package is separately approved and enforced. The 53 generated event tool instances add to Admin only in the proposed baseline. All three roles also receive all five bridge servers by explicit user decision; their dynamic tool counts remain unknown.

## Current controls and required changes

### Authorize each call with an immutable identity

Current roles turn entire connections on or off, and new internal servers are enabled by default. Add a positive manifest of exact server/tool pairs for each role, with default denial for unknown package servers, new package tools, aliases and wildcard expansion. The explicit exception is the user-approved access to all five bridge connections for every role; capture and audit their dynamic catalogs without silently removing that agreed availability. Apply the same policy at discovery and at invocation. Sensitive service handlers must check trusted caller identity, role, assignment and object ownership rather than caller-supplied role or owner fields. [S3–S4]

Bind a Manager to its owned Worker IDs and assigned work IDs. Bind each Worker to one parent, repository/worktree and work item. A list/search call must filter its results; a read/update call must check its target; returned links and handles must not reveal or unlock other objects. Recheck policy after resume, reconnect and role changes. Existing Worker self-record identity checks are useful but do not supply all of these proposed scopes. [S7]

### Prevent role and execution bypasses

At inventory revision 835ed9d, the start path did not hardcode Worker. `worker_start` passed optional `roleId` unchanged; the manager passed it to role resolution, which used the explicit ID or the configurable Worker default. A test confirmed that an explicit role overrode a changed default. No Admin role existed in the inspected catalog, so this was a verified selection gap and a future elevation risk, not evidence of an existing Admin Worker. The implemented change requires every new Worker to use the canonical Worker role, with no selectable override and no mutable-default substitution. Account, model and repository assignment require separate validation. Existing Workers retain saved snapshots on recovery. [S6]

proc_run_start executes arbitrary argv. Native shell/file tools, same-user sockets, project configuration and skills, credential access, additional Role MCP services and bridge proxies can provide other paths to privileged operations. Restrict those paths independently, ideally with process identity, filesystem/network isolation and narrowly scoped service credentials. An MCP allowlist is a disclosure and dispatch control; it is not an OS sandbox. [S4, S8]

### Keep Worker execution practical

The small Worker MCP baseline assumes native tools can read and edit the assigned worktree, run authorized builds/tests and return results in the native Worker session. The exact native tool inventory is outside this internal MCP matrix and must be reviewed before enforcement. Worker output is retained in native transcripts, turns and records; Manager reads it through worker_read and receives status through worker_status. worker_send is Manager-to-Worker follow-up, not a Worker reply path. [S12]

The optional capabilities in the matrix are a decision for adoption, not active grants. Research allows three scoped Brain reads. Content reading allows twelve scoped retrieval tools. Artifact writing allows seven tools over assigned private objects and staging handles. Parsing and network fetching allow five Scrape tools. Scope limits, size/runtime budgets and applicable user confirmations must be enforced before any bundle is enabled. All five bridge servers are available to every role by user decision, including the computer/browser and messaging bridges. Their live tool catalogs still need capture for an exact audit. Package browser profile administration remains Admin-only; this is distinct from the shared bridge access.

## Admin startup and escalation

1. A human deliberately starts an Admin Bot for a stated incident or maintenance task. Use an explicit operator-only role-selection path; do not change the ordinary Bot default to Admin. Record the initiating operator, role manifest version, reason and session identity.

1. Admin receives every internal tool in the reviewed catalog, including api, generated tools and available bridge tools. The five bridge connections are also available to Manager and Worker, as explicitly requested. Capture the exact dynamic catalogs at launch. Ordinary Manager/Worker sessions cannot launch, impersonate, resume into or otherwise elevate themselves to Admin.

1. Preserve authorization and confirmation safeguards. Current Bot-bound requests can be rejected as operator-only, including account lifecycle and Worker account draining. An Admin role name must not override that check. If the Admin Bot must act for the operator, add an explicit auditable delegation mechanism with the required per-action approvals. [S5, S6]

1. Manager reports the blocked action, target and evidence to the human. Keep worker_respond Admin-only initially: the current handler checks ownership and the offered pending option, but does not compare the native permission with Manager grants. The human or duly authorized Admin handles that response and returns the relevant result. [S10] Prefer returning an outcome over widening Manager permissions.

1. End the privileged session deliberately. Revoke temporary grants, record the outcome and verify that restart/resume cannot silently preserve expired authority. Emergency access must not disable auditing or confirmation requirements.

Current bot_start has no roleId input and Bots resolve the Bot default. Operator-started Admin therefore needs an explicit launch/assignment implementation and restart semantics; adding a row named Admin in the role catalog is insufficient. [S5]

## Implementation acceptance checklist

- Inventory tests reconcile all 286 ordinary tools, every generated event tool instance and every live dynamic bridge entry. A new unreviewed package tool is denied to Manager and Worker. The five shared bridges stay available under the agreed server-level policy, with catalog changes captured and audited.

- Discovery and invocation agree. Calling a hidden tool by exact name, guessed alias, wildcard, bridge or alternate transport fails unless the same grant permits it.

- Manager cannot read, send to, resume, cancel or close another Manager’s Worker; Worker cannot read another Worker or work item. Enumeration and search do not leak those objects.

- worker_start always resolves the canonical Worker role. Explicit roleId, a changed Worker default and alternate start paths cannot select Admin or any other role. Account/repository selection and privileged configuration are separately constrained. Resume and reconnect retain the same restrictions.

- Manager cannot invoke worker_respond in the baseline. Any future bounded relay must bind the original permission, target, exact option and authorized human response without creating broader authority.

- Optional content and research scopes are tested against IDs, search results, links, versions and staging handles. Network requests apply destination and redirect checks and prevent unintended local-network access.

- Native execution, sockets, files, credentials and additional MCP connections are tested as bypass paths. Tool-list filtering alone does not pass this test.

- Admin launch is human-only, auditable and distinct from normal defaults; existing operator-only checks and required confirmations remain effective.

- Positive end-to-end test: Manager starts a permitted Worker, observes progress, asks for a bounded follow-up, receives results, records the outcome and closes the Worker without privileged tools.

## Decisions to resolve before implementation

- Approve the proposed 18-tool Manager and 2-tool Worker baselines, or identify a concrete workflow requiring another operation.

- Decide which optional Worker capabilities to adopt and what constitutes an assigned collection, source, object, URL and private publication destination.

- Choose the Admin operator-delegation and session-expiry model, including restart and recovery behavior.

- Capture the live catalogs of all five already-approved shared bridges. Define audit and confirmation handling without reverting their agreed availability for any role.

- Decide whether emergency Admin must control socket/WebSocket-only Stack functions as well. Those are outside this internal MCP inventory and require a separate surface inventory.

## Full exact tool access matrix

Each ordinary tool appears once under its exact server identifier. Allow means proposed Admin access, subject to caller authority and required confirmations. Scope means a proposed baseline grant with the restrictions stated here. S opt means an optional scoped Worker grant, denied in the baseline. Deny means no grant in this proposal. Mgr means Manager.

All scoped and optional entries require enforcement before activation. “Allow” for Admin does not mean that a presently operator-only operation will accept a Bot caller. Sources and current implementation references follow the matrix.

### api server

Server identifier api. 3 ordinary tools. Sources: packages/api/api.yaml and packages/api/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| docs_list | Allow | Deny | Deny | Broad API discovery is outside the narrow execution and delegation baselines. |
| docs_get | Allow | Deny | Deny | Broad API discovery is outside the narrow execution and delegation baselines. |
| docs_snapshot | Allow | Deny | Deny | Broad API discovery is outside the narrow execution and delegation baselines. |

### auth server

Server identifier auth. 18 ordinary tools. Sources: packages/auth/api.yaml and packages/auth/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| account_list | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| account_set_enabled | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| account_remove | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| account_login_start | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| account_login_replace | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| account_login_status | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| account_login_current | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| account_login_cancel | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_list | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_prepare | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_confirm | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_set_enabled | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_remove | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_login_start | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_login_status | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_login_current | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_login_submit | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |
| worker_account_login_cancel | Allow | Deny | Deny | Operator account and authentication control; keep out of ordinary agent sessions. |

### bots server

Server identifier bots. 51 ordinary tools. Sources: packages/bots/api.yaml and packages/bots/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| bot_settings_catalog | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_settings_read | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_settings_preview | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_settings_patch | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_settings_apply | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_settings_options | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_settings_native_schema | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_start | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_stop | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_assign | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_remove | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_list | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_defaults_get | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| bot_defaults_set | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| voice_status | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| voice_dial | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| voice_speak | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| voice_hangup | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_list | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_tree | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_tree_detail | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_search | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_records | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_record_chunk | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_message_changes | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_thread_read | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_turns | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_items | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_main_live | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_main_items | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_occurrences | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_open | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_send | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_steer | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_interrupt | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_enqueue | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_queue_list | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_queue_resolve | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_codex_queue_add | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_codex_queue_list | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_codex_queue_update | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_codex_queue_delete | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_codex_queue_reorder | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_codex_queue_start | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_upload_start | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_upload_status | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_upload_chunk | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_upload_finish | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_attachment_add | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_attachment_list | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |
| chat_attachment_remove | Allow | Deny | Deny | Bot control, conversations, voice or shared attachments belong to Admin. |

### brain server

Server identifier brain. 32 ordinary tools. Sources: packages/brain/api.yaml and packages/brain/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| stats | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| search | Allow | Deny | S opt | Optional research: retrieve only authorized sources and result fields. |
| get | Allow | Deny | S opt | Optional research: retrieve only authorized sources and result fields. |
| context | Allow | Deny | S opt | Optional research: retrieve only authorized sources and result fields. |
| tags | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| submission_completion | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| sources_sync_completion | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| brain_status | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| jobs_reveal | Allow | Deny | Deny | Potentially sensitive job details require privileged handling. |
| recovery_execute | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| submit | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| jobs_list | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| jobs_show | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| jobs_run | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| jobs_retry | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| jobs_cancel | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| jobs_exclude | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| jobs_stats | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| doctor | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| backup_create | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| backup_verify | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| recovery_import | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| recovery_online | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| delete | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| retag | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| sources_apply | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| sources_list | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| sources_show | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| sources_status | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| sources_sync | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| sources_pause | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |
| sources_resume | Allow | Deny | Deny | Global ingestion, source management, recovery or diagnostics belong to Admin. |

### browse server

Server identifier browse. 10 ordinary tools. Sources: packages/browse/api.yaml and packages/browse/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| browser_profile_list | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_profile_create | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_profile_delete | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_controller_list | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_controller_select | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_handoff_request | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_handoff_get | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_handoff_list | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_handoff_completion | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |
| browser_handoff_cancel | Allow | Deny | Deny | Profile, controller and human handoff administration remain with Admin. |

### content server

Server identifier content. 36 ordinary tools. Sources: packages/content/api.yaml and packages/content/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| collection_list | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| collection_get | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| item_list | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| item_get | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| item_read | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| get | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| list | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| search | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| tags | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| resolve | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| links | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| backlinks | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| graph | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| artifacts_list | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| artifacts_versions | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| artifacts_show | Allow | Deny | S opt | Optional content reading: assigned collections, objects and returned links only. |
| content_status | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| blob_stage_start | Allow | Deny | S opt | Optional artifact writing: assigned private objects and staging handles only. |
| blob_stage_status | Allow | Deny | S opt | Optional artifact writing: assigned private objects and staging handles only. |
| blob_stage_chunk | Allow | Deny | S opt | Optional artifact writing: assigned private objects and staging handles only. |
| blob_stage_finish | Allow | Deny | S opt | Optional artifact writing: assigned private objects and staging handles only. |
| collection_create | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| collection_update | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| collection_delete | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| item_put | Allow | Deny | S opt | Optional artifact writing: assigned private objects and staging handles only. |
| item_move | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| item_delete | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| artifact_publish | Allow | Deny | S opt | Optional artifact writing: assigned private objects and staging handles only. |
| document_update | Allow | Deny | S opt | Optional artifact writing: assigned private objects and staging handles only. |
| new | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| add | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| rm | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| restore | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| artifacts_rm | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| artifacts_restore | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |
| gc | Allow | Deny | Deny | Global/shared content administration is outside assigned execution scope. |

### hud server

Server identifier hud. 14 ordinary tools. Sources: packages/hud/api.yaml and packages/hud/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| work_create | Allow | Scope | Deny | Create work only inside the Manager assignment. |
| work_update | Allow | Scope | Deny | Update assigned work; preserve ownership and authorization fields. |
| work_batch | Allow | Deny | Deny | Extended work management is omitted from the minimal Manager baseline. |
| work_get | Allow | Scope | Deny | Read assigned work items only. |
| work_list | Allow | Scope | Deny | Return only assigned work items. |
| work_tree | Allow | Deny | Deny | Extended work management is omitted from the minimal Manager baseline. |
| work_metadata_get | Allow | Deny | Deny | Extended work management is omitted from the minimal Manager baseline. |
| work_metadata_set | Allow | Deny | Deny | Extended work management is omitted from the minimal Manager baseline. |
| work_note_add | Allow | Scope | Deny | Record progress and Worker results on assigned work. |
| work_activity_list | Allow | Deny | Deny | Extended work management is omitted from the minimal Manager baseline. |
| work_focus_get | Allow | Deny | Deny | Extended work management is omitted from the minimal Manager baseline. |
| work_focus_set | Allow | Deny | Deny | Extended work management is omitted from the minimal Manager baseline. |
| work_context_resolve | Allow | Scope | Deny | Resolve only resources already authorized for assigned work. |
| work_resources | Allow | Scope | Deny | Expose only resources linked to authorized assigned work. |

### notify server

Server identifier notify. 6 ordinary tools. Sources: packages/notify/api.yaml and packages/notify/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| notification_send | Allow | Scope | Deny | Contact the designated human for this task; bind replies to the request. |
| notification_get | Allow | Scope | Deny | Read only notifications created for this Manager assignment. |
| notification_list | Allow | Deny | Deny | Global notification inbox access or dismissal belongs to Admin. |
| notification_counts | Allow | Deny | Deny | Global notification inbox access or dismissal belongs to Admin. |
| notification_dismiss | Allow | Deny | Deny | Global notification inbox access or dismissal belongs to Admin. |
| notification_dismiss_all | Allow | Deny | Deny | Global notification inbox access or dismissal belongs to Admin. |

### proc server

Server identifier proc. 17 ordinary tools. Sources: packages/proc/api.yaml and packages/proc/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| proc_schedule_create | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_schedule_update | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_schedule_reauthorize | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_schedule_remove | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_schedule_get | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_schedule_list | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_execution_get | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_execution_list | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_run_start | Allow | Deny | Deny | Arbitrary argv execution can bypass MCP policy; Admin only. |
| proc_run_completion | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_run_get | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_run_list | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_run_read | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_run_wait | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_run_join | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_run_cancel | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |
| proc_status | Allow | Deny | Deny | General processes, schedules and execution diagnostics belong to Admin. |

### roles server

Server identifier roles. 30 ordinary tools after retirement of `role_set_worker_default`. Sources: packages/roles/api.yaml and packages/roles/api.ts.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| roles_snapshot | Allow | Deny | Deny | Manager starts a configured Worker role and needs no global role catalog. |
| role_snapshot | Allow | Deny | Deny | Keep role inspection in Admin; use a fixed approved Worker role. |
| role_create | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| role_update | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| role_set_default | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| role_delete | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| role_internal_mcp_list | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| role_internal_mcp_update | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| role_preview | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| category_create | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| category_update | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| category_delete | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| category_reorder | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| fragment_create | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| fragment_update | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| fragment_delete | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| fragment_reorder | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| fragment_move | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| skill_create | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| skill_update | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| skill_delete | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| skill_reorder | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| mcp_server_create | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| mcp_server_update | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| mcp_server_delete | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| mcp_server_reorder | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| project_create | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| project_update | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| project_delete | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |
| project_reorder | Allow | Deny | Deny | Role, prompt, server and trust policy are privileged configuration. |

### scrape server

Server identifier scrape. 9 ordinary tools. Sources: packages/scrape/api.yaml and packages/scrape/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| scrape_feed_parse | Allow | Deny | S opt | Optional parsing: task-provided input and bounded output/resources only. |
| scrape_convert_html | Allow | Deny | S opt | Optional parsing: task-provided input and bounded output/resources only. |
| scrape_presets_list | Allow | Deny | Deny | Preset, fleet or canary diagnostics are unnecessary for task execution. |
| scrape_preset_show | Allow | Deny | Deny | Preset, fleet or canary diagnostics are unnecessary for task execution. |
| scrape_canary_inventory | Allow | Deny | Deny | Preset, fleet or canary diagnostics are unnecessary for task execution. |
| scrape_status | Allow | Deny | Deny | Preset, fleet or canary diagnostics are unnecessary for task execution. |
| scrape_fetch | Allow | Deny | S opt | Optional fetching: authorized destinations with redirect and network controls. |
| scrape_links | Allow | Deny | S opt | Optional fetching: authorized destinations with redirect and network controls. |
| scrape_feed_discover | Allow | Deny | S opt | Optional fetching: authorized destinations with redirect and network controls. |

### serve server

Server identifier serve. 4 ordinary tools. Sources: packages/serve/api.yaml and packages/serve/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| serve_status | Allow | Deny | Deny | Machine, service and bridge diagnostics belong to Admin. |
| serve_codex_tools | Allow | Deny | Deny | Machine, service and bridge diagnostics belong to Admin. |
| serve_resources | Allow | Deny | Deny | Machine, service and bridge diagnostics belong to Admin. |
| serve_resource_history | Allow | Deny | Deny | Machine, service and bridge diagnostics belong to Admin. |

### source server

Server identifier source. 17 ordinary tools. Sources: packages/source/api.yaml and packages/source/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| github_watch_events | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_status | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_event_catalog | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_event_schema | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_endpoint_list | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_endpoint_get | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_setup_read | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_delivery_list | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_delivery_get | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_delivery_payload | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_watch_create | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_watch_list | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_watch_get | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_watch_read | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_watch_update | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_watch_acknowledge | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |
| github_watch_remove | Allow | Deny | Deny | Global GitHub receiver and watch administration belong to Admin. |

### usage server

Server identifier usage. 1 ordinary tools. Sources: packages/usage/api.yaml and packages/usage/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| usage_snapshot | Allow | Deny | Deny | Account-wide usage is outside assigned work scope. |

### worker server

Server identifier worker. 28 ordinary tools. Sources: packages/worker/api.yaml and packages/worker/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| worker_list | Allow | Scope | Deny | Return only Workers owned by this Manager. |
| worker_status | Allow | Scope | Scope | Manager sees owned Workers; Worker sees itself only. |
| worker_read | Allow | Scope | Scope | Manager reads owned Worker output; Worker reads itself only. |
| worker_detail | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_turn_list | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_record_list | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_record_read | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_tool_list | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_diff | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_turn_context | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_event_list | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_catalog | Allow | Scope | Deny | Only approved Worker accounts and models; role selection is hardcoded. |
| worker_runtime_list | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_start | Allow | Scope | Deny | Hardcode the canonical Worker role; assigned repository and work item only. |
| worker_send | Allow | Scope | Deny | Send task instructions to Workers owned by this Manager only. |
| worker_respond | Allow | Deny | Deny | Admin-only: offered native approvals can exceed Manager authority. |
| worker_cancel | Allow | Scope | Deny | Cancel an owned Worker turn; preserve records and worktree. |
| worker_resume | Allow | Scope | Deny | Resume an owned Worker with its original bounded role and assignment. |
| worker_close | Allow | Scope | Deny | Close an owned Worker; never imply permission to discard its worktree. |
| worker_work_list | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_turn_observation | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_settings_catalog | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_settings_read | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_settings_preview | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_settings_patch | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_settings_apply | Allow | Deny | Deny | Deep execution inspection or administrative control is outside the baseline. |
| worker_account_drain | Allow | Deny | Deny | Account-wide draining is operator administration. |
| worker_remove | Allow | Deny | Deny | Worktree discard or record removal requires privileged handling. |

### xcom server

Server identifier xcom. 10 ordinary tools. Sources: packages/xcom/api.yaml and packages/xcom/api.ts at revision 835ed9d.

| Exact tool | Admin | Manager | Worker | Reason and required scope |
| --- | --- | --- | --- | --- |
| xcom_status | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_sync | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_articles_sync | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_search | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_context | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_list | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_articles_pending | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_get | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_users | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |
| xcom_user_get | Allow | Deny | Deny | Private archive access is global and lacks an assigned-task boundary. |

## Generated event tool access

These are exact generated MCP tool instances, counted by server plus tool name. The source defines 53 for a Bot: twelve servers with four each, plus source with five. api, scrape and xcom have none. The saved api exclusion does not reduce the event count. Current Worker disclosure includes four source instances; the proposed Worker baseline grants none of the package event tools. [S9]

Admin is allowed all 53. Manager and Worker are denied all generated event tools in the baseline; Manager can observe progress with worker_status and worker_read. If push updates are later needed, the twelve worker/hud/notify event instances can be considered as an additional scoped Manager capability, restricted to permitted operations, owned Workers and the sanctioned Bot Chat. This is not an adopted baseline grant.

| Server | Exact generated tool | Admin | Mgr | Worker |
| --- | --- | --- | --- | --- |
| auth | events_catalog | Allow | Deny | Deny |
| auth | events_subscribe | Allow | Deny | Deny |
| auth | events_status | Allow | Deny | Deny |
| auth | events_unsubscribe | Allow | Deny | Deny |
| bots | events_catalog | Allow | Deny | Deny |
| bots | events_subscribe | Allow | Deny | Deny |
| bots | events_status | Allow | Deny | Deny |
| bots | events_unsubscribe | Allow | Deny | Deny |
| brain | events_catalog | Allow | Deny | Deny |
| brain | events_subscribe | Allow | Deny | Deny |
| brain | events_status | Allow | Deny | Deny |
| brain | events_unsubscribe | Allow | Deny | Deny |
| browse | events_catalog | Allow | Deny | Deny |
| browse | events_subscribe | Allow | Deny | Deny |
| browse | events_status | Allow | Deny | Deny |
| browse | events_unsubscribe | Allow | Deny | Deny |
| content | events_catalog | Allow | Deny | Deny |
| content | events_subscribe | Allow | Deny | Deny |
| content | events_status | Allow | Deny | Deny |
| content | events_unsubscribe | Allow | Deny | Deny |
| hud | events_catalog | Allow | Deny | Deny |
| hud | events_subscribe | Allow | Deny | Deny |
| hud | events_status | Allow | Deny | Deny |
| hud | events_unsubscribe | Allow | Deny | Deny |
| notify | events_catalog | Allow | Deny | Deny |
| notify | events_subscribe | Allow | Deny | Deny |
| notify | events_status | Allow | Deny | Deny |
| notify | events_unsubscribe | Allow | Deny | Deny |
| proc | events_catalog | Allow | Deny | Deny |
| proc | events_subscribe | Allow | Deny | Deny |
| proc | events_status | Allow | Deny | Deny |
| proc | events_unsubscribe | Allow | Deny | Deny |
| roles | events_catalog | Allow | Deny | Deny |
| roles | events_subscribe | Allow | Deny | Deny |
| roles | events_status | Allow | Deny | Deny |
| roles | events_unsubscribe | Allow | Deny | Deny |
| serve | events_catalog | Allow | Deny | Deny |
| serve | events_subscribe | Allow | Deny | Deny |
| serve | events_status | Allow | Deny | Deny |
| serve | events_unsubscribe | Allow | Deny | Deny |
| usage | events_catalog | Allow | Deny | Deny |
| usage | events_subscribe | Allow | Deny | Deny |
| usage | events_status | Allow | Deny | Deny |
| usage | events_unsubscribe | Allow | Deny | Deny |
| worker | events_catalog | Allow | Deny | Deny |
| worker | events_subscribe | Allow | Deny | Deny |
| worker | events_status | Allow | Deny | Deny |
| worker | events_unsubscribe | Allow | Deny | Deny |
| source | events_catalog | Allow | Deny | Deny |
| source | events_subscribe | Allow | Deny | Deny |
| source | events_status | Allow | Deny | Deny |
| source | events_unsubscribe | Allow | Deny | Deny |
| source | events_listen | Allow | Deny | Deny |

events_catalog discovers event/read options; events_subscribe creates a Bot Chat snapshot watch; events_status reads watch/receipt state; events_unsubscribe stops a watch; events_listen receives typed occurrences. source.github_watch_events supplies the current occurrence intake. operation_watch is an internal completion path; events/list and events/poll are protocol methods, not additional listed tools. [S9]

## Shared dynamic bridge access

The following are exact server names, not tool names. All five are available to all three roles by explicit user decision. Their tools are fetched from live upstream plugin catalogs, so no invented or guessed tool names are included. A running authorized serve_codex_tools observation is needed to capture an exact runtime list. [S11]

| Exact bridge server | Admin | Manager | Worker | Tool inventory |
| --- | --- | --- | --- | --- |
| codex-computer-use | Allow | Allow | Allow | Dynamic; not observed |
| chrome | Allow | Allow | Allow | Dynamic; not observed |
| messages | Allow | Allow | Allow | Dynamic; not observed |
| computer-history | Allow | Allow | Allow | Dynamic; not observed |
| openai-developer-docs | Allow | Allow | Allow | Dynamic; not observed |

The final source-defined package count is 339 tool instances: 286 ordinary plus 53 generated. Dynamic bridge tools are additional and uncounted. The saved Manager configuration exposes up to 336 known package instances (283 ordinary plus 53 generated); the saved Worker configuration exposes 41 (37 ordinary plus four generated), plus the bridge connections. Proposed package baselines are Admin 339, Manager 18 and Worker 2; optional Worker capabilities add 27. No live-runtime completeness claim is made.

## Source references

Source repository: ~/code/stack on the inspected greybird computer. Revision: 835ed9d. File paths below are relative to that repository. The study read source, manifests and the local Roles catalog; it did not modify them. The 16 server sections identify each package manifest and implementation used for the exact ordinary-tool inventory.

### S1 Current roles and defaults

packages/roles/src/schema.ts:54–59; docs/default-role.md:3; local Roles catalog read during the study.

### S2 Package server registration

packages/api/src/mcp.ts:17–26; packages/{server}/api.yaml:5 and packages/{server}/api.ts for each of the 16 enumerated servers.

### S3 Whole connection role selection

docs/adr/0119-per-role-internal-mcp.md:8–43; packages/roles/src/capabilities.ts:35–50.

### S4 Worker disclosure and native boundary

packages/api/src/exposure.ts:56–69; docs/adr/0114-explicit-worker-disclosure.md:20–24.

### S5 Bot launch and operator authority

packages/bots/api.ts:89–99; docs/adr/0124-manager-and-worker-launch-defaults.md:8–12; packages/auth/api.ts:119; packages/worker/api.ts:106–107.

### S6 Worker role selection call chain and test

packages/worker/api.ts:113–119; packages/worker/src/manager.ts:464–468, 493–497; packages/worker/src/resources.ts:19–20; packages/roles/src/store.ts:141–148; packages/roles/api.ts:119–122; packages/worker/test/execution.test.ts:455–457, 473–487.

### S7 Worker self identity enforcement

packages/worker/src/manager.ts:166–176.

### S8 Additional Role MCP services

packages/roles/src/bundle.ts:33–49; docs/adr/0114-explicit-worker-disclosure.md:20–24.

### S9 Generated event tools and conditional registration

packages/api/src/mcp-events.ts:9–19; packages/api/src/mcp-package.ts:32–36; package event selections and occurrence-source declarations reconciled in the read-only study.

### S10 Native Worker permission responses

packages/worker/src/manager.ts:629–641.

### S11 Dynamic bridge catalog and proxy

packages/api/src/codex-mcp/catalog.ts:2–8; packages/api/src/codex-mcp/server.ts:13–23.

### S12 Manager and Worker communication

docs/operations.md:27–29, 41.
