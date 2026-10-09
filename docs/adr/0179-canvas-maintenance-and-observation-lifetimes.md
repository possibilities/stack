# 0179: Headless Canvas maintenance and observation lifetimes

Status: Accepted

Date: 2026-10-09

## Context

Canvas maintenance policy was split between a permissive controller, per-owner
exposure checks and the shared renderer. A hidden button was sometimes the only
barrier to replacing an uncertain request. Receipt-read failure also replaced
known owner evidence with unconfirmed admission. Separately, Store and hook reads
implemented their own request generations, invalidation and revision pagination;
changing a filter while inactive could let an older result enter the new view.

Canvas benches use React Activity. Effect cleanup can suspend a view while its
state survives. Destination replacement, query change, temporary suspension and
explicit dismissal therefore require distinct lifetime decisions.

## Decision

Use two browser-safe behavioral modules under `packages/ui/lib/stack/`:
`maintenance.ts` owns permitted maintenance transitions and receipt recovery;
`observation.ts` owns read identity, result acceptance, freshness and genuine
owner-revision pagination. Thin React adapters and Store projections use the same
headless interfaces as behavioral tests. Neither module requires a new Package
API operation or wire field.

### Maintenance

An immutable owner binding declares the operation names, routing, recovery key
and explicit per-action policy. The module derives readiness from those names,
local authority, connection and destination-scoped storage. Owners supply only
their domain prerequisites and explicit pre-record guards. Preparation and apply
require all three operations; receipt recovery requires only permitted receipt
access and never depends on the old selection remaining selectable.

Preparation captures the selection and effect/receipt adapter. Apply rechecks
readiness and plan eligibility, records exact input before sending, and refuses
detectable storage conflicts. Duplicate or conflicting commands cannot erase a
pending effect's identity. Identical retry is explicit and possible only under
its named policy with no known receipt. Receipt-only flows refuse retry,
replanning and close-and-rearm for unconfirmed, partial or unknown results.
Discarding an unsubmitted plan, closing a permitted receipt and leaving a view
are separate commands; there is no universal reset escape hatch.

Source's existing abandoned-selection payload recovery has a separate saved-only
policy: receipt observation and explicit local Forget, never preparation for an
empty selection. This does not apply to server-owned GitHub remote-request
receipts, which retain their independent no-replay/no-Forget contract.

Known receipt evidence survives failed or missing rereads. Read progress/errors
are separate from admission evidence. Recovery, reconnect and owner invalidations
read the exact unresolved request when ready. Triggers coalesce into one owed
follow-up; errors never create polling or effect retries. Resource-read timestamps
are not maintenance invalidations. Identical receipts do not repeatedly invoke
owner refresh callbacks, and callback errors cannot demote confirmed admission.
Selection callbacks receive captured selection or null after identity-only reload.

The last active observer pauses reads and fences late presentation results without
forgetting persisted uncertainty. Reactivation resumes readiness-gated receipt
observation. An already dispatched effect is not cancelled or resent by suspension.
Existing recovery keys and destination isolation remain authoritative.

### Observation

Each observation has one semantic query, an independent client generation and
explicit demand. Every committed query change fences previous results, including
A→B→A and changes made while inactive. Owner revision, row/intent revision,
navigation requests and destination epoch remain separate authorities. Sensitive
detail reveal is explicit and clears on its intent revision changing.

Same-query evidence remains visible and labelled stale through refresh, failure,
disconnect and suspension. Successful null is distinct from never-read. The last
demand release fences pending results; return reads afresh. There is no per-filter
cache. Passive state subscriptions do not imply demand; background Store reads
hold explicit Store-owned demand.

Refresh takes priority over continuation. Invalidation during a read owes one
fresh follow-up. A successful refresh replaces the first page and does not rebuild
previous depth. Continuation captures the held owner revision and offset, appends
only matching revisions, and retains complete typed latest-page metadata. A
classified revision refusal attempts one first-page replacement and discloses the
restart. A failed refresh/restart retains stale evidence and disables continuation
until a successful first page. An ordinary continuation transport failure can be
explicitly retried against an otherwise still-current prefix.

Distinct continuation contracts remain distinct: upload stages without a genuine
owner revision, Brain fixed-Run admission sets, Bot byte logs, Source cursors and
Watch consumption, Worker sequences and Client SSE are not converted to offset
pagination.

## Consequences

Existing controls receive authoritative availability and existing views disclose
staleness and read errors. Owner-specific selection, routing, prerequisites and
recovery policy remain explicit at their call sites. Deferred adapter tests can
prove ordering and recovery without real owner effects or a running Server.

This introduces no global recovery scanner, cross-tab locking protocol, automatic
effect replay, new UI workflow or backend authority. Owner receipts and plans
remain authoritative; detecting a conflicting storage record is not atomic
cross-tab exclusion.

Related: [0136](0136-system-state-view-and-shared-maintenance-flow.md),
[0139](0139-owner-maintenance-in-existing-spaces.md),
[0167](0167-canvas-destination-isolation.md),
[0169](0169-source-server-request-history.md).
