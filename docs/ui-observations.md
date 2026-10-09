# Canvas read observations

`packages/ui/lib/stack/observation.ts` owns the browser-safe lifecycle for keyed reads and owner-revision/offset pages. React adapters in `components/canvas/owner-reads.tsx` and the four Serve resources in `lib/stack/store.ts` use this same implementation. Package API contracts are unchanged.

[ADR 0179](adr/0179-canvas-maintenance-and-observation-lifetimes.md) records the decision. Maintenance receipt recovery has its own evidence and scheduling rules in `lib/stack/maintenance.ts`: an ordinary list invalidation must never discard confirmed mutation admission.

## Identity, evidence and demand

An owner binding names semantic query identity, an exact read and, for paging, its append operation and revision-refusal classifier. Identity includes every result-affecting argument: owner operation, subject/incarnation, filters, page size and meaningful order. Only genuinely set-like selections, such as inventory owners, are normalized. Bindings capture parameters when a read is admitted.

`getSnapshot()` is stable until a transition. `evidence: null` means no successful answer; `evidence.value` can itself be null, an empty list or an owner result describing unavailable coverage. Pending, stale, error and transport/exposure unavailability are separate facts. Store projections keep their familiar `data`/`at` fields and also expose `hasRead`, freshness and continuation eligibility.

Subscriptions only project state. `activate()` acquires demand; its idempotent release pauses on the last observer, synchronously fences pending replies and retains same-query evidence as stale. Returning acquires fresh first-page evidence. Store inventory and event subscriptions intentionally hold background leases while the Store runs; completion History and Occurrences have view-owned leases. Store stop fences all four resources, and restart observes current connection/exposure before reading again.

Changing a query fences results, errors and pending completion immediately, including while inactive. A→B→A is a new generation. Connection/exposure loss does not change query identity; it retains stale evidence and disables continuation. Destination replacement remains the provider tree's responsibility under ADR 0167.

React commits query/readiness changes in layout effects and masks snapshots for another render's query. Rendering does not mutate the controller, notify subscribers or dispatch calls. Activity cleanup releases demand rather than permanently disposing the controller. Explicit sensitive disclosure is a separate enablement condition: a row intent-revision change discards consent and its late response cannot reveal content again. Audited Brain content reveal remains an explicit action, not an automatically refreshed observation.

## Scheduling and paging

Repeated refresh commands coalesce. Owner invalidations during a read mark its answer obsolete and owe one follow-up; additional notices coalesce until that follow-up starts. Errors do not self-retry or poll. New query generations and refreshes superseding continuation need not await obsolete transport calls, but obsolete calls cannot change the new snapshot.

Refresh outranks continuation. First-page success replaces the whole loaded prefix without refilling its old depth. Same-query evidence remains stale while refreshing and after a failed refresh; continuation remains unavailable until a successful first page.

More captures the held owner revision and exact next offset. Duplicate requests for the same position coalesce. Append requires a matching revision. An owner-classified refusal (including Worker's branch-inventory wording), or a mismatched successful page, gets one first-page replacement attempt and restart disclosure. Failure of that replacement retains stale evidence and disables More. An ordinary continuation transport failure retains a retryable prefix unless another invalidation/readiness change has made it ineligible.

Only rows accumulate. Every other field comes from the latest successful page, including totals, truncation, owner issues, observation timestamps, publication retained-copy disclosure and Vault commit coverage, paths, remotes and retention. These fields are typed; they are not summed, unioned or inferred from earlier pages.

## Adoption boundaries

The shared revision pager covers Serve inventory/subscription/completion/occurrence resources, Brain's operation-filtered Bot watches, Bot workspace/uploads/recovery/history/queue lists, Worker workspace and retained branches, Browse volumes, Role launch directories, Content blobs and temporary publications, and exact-slug Vault history. Keyed owner reads, exact completion/domain observations and explicit compatible details share its identity/result-acceptance core.

Upload stages have unfenced offsets and no invented revision. Brain's fixed-admission Run set, Bot byte logs, Source watermark/cursors and Watch consumption, Source remote-request history, Worker sequence feeds and Client SSE keep their distinct continuation/event contracts. Their compatible first snapshots may use keyed observations without converting the continuation contract. Maintenance receipts have their own admission-evidence/recovery policy and are not ordinary list freshness.

## Verification

`packages/ui/test/observation.test.mjs` exercises the production interface with deferred owners: both completion orders, inactive identity changes, Activity-like leases, availability loss, coalesced follow-ups, revision restart failure, ordinary More retry and metadata replacement. `state-store.test.mjs` exercises actual socket/gateway wiring and Store lifetime. `state-browser-check.mjs` covers stale History, sensitive intent-revision changes and Activity return in rendered views; `domain-state-browser-check.mjs` covers publication/Vault disclosure. Use disposable fixture state and an isolated UI output tree for rendered checks.
