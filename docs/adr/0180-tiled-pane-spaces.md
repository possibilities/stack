# 180. Tiled pane spaces with retained live bodies

Status: accepted, 2026-10-15. Implementation is incremental. Supersedes the bench geometry and camera portions of [ADR 0058](0058-open-bench-and-global-tools.md) and [ADR 0088](0088-isolated-space-benches.md), the space-menu presentation of [ADR 0061](0061-spaces-menu-and-edge-tools.md), and free-placement sizing in [ADR 0070](0070-windows-grow-with-content.md), [ADR 0072](0072-fluid-drag-and-content-fit-groove.md), [ADR 0089](0089-window-sizes-in-grid-cells.md) and [ADR 0173](0173-resizable-windows-and-compact-fleet.md). Preserves domain workflows, global providers and URL navigation; refines [ADR 0085](0085-pinnable-inspector.md).

## Context

Independent open benches preserve useful state but require camera management and leave windows outside the readable viewport. The approved Tiles design composes each of the existing fifteen spaces as a small application, with splits, tab stacks and curated presets. The synthetic prototype demonstrates arrangement, not live React identity, permissions or operation recovery.

## Decision

Use one tiled host per space and a shared grouped rail. A split tree owns only composition, proportions, active tabs and focus; existing owners retain records, dynamic instance IDs, drafts and operations. The current registration source supplies the full per-space pane catalog, including eligible panes absent from presets. Applying a preset or reset changes presentation only. Extra instances omitted by a preset remain closed and discoverable.

Pane bodies keep stable keyed sibling ancestry independently of the split tree. Project tree rectangles onto those bodies rather than recursively rendering domain bodies under split parents: a key does not preserve state across React parents. Verify real mounted-state and keyboard/accessibility behavior before broad migration. Activity suspends hidden spaces and panes without discarding local state; hidden/inert boundaries exclude them from focus. Browser resources such as viewer iframes also require explicit effective pane visibility, since Activity effect cleanup alone does not stop them.

Shell close hides a pane, retaining its identity, binding and work. It never stops, deletes, finishes a handoff or retries an operation. Existing confirmed record deletion, permission revocation and destination replacement remain authoritative. Last-pane close is disabled; zero eligible registrations produce an honest unavailable surface. Reopening prefers its saved neighbor; it falls back to current focus when that neighbor disappeared. Exact Undo is valid only until another layout/registry change; it must not overwrite subsequent edits.

Presets plus one modified layout per space persist in destination-scoped `uix.panes.v1.<space>` records. Restore waits for destination identity and existing instance stores. New layouts start fresh: the human explicitly declined old-bench compatibility, migration and saved-arrangement rollback requirements. No old bench keys are read. Domain drafts and recovery records are unaffected. Unknown future versions are not silently overwritten. Storage failure leaves arrangement usable in memory, without weakening business save-before-send rules.

Keep canonical space URLs and home destinations, select versus navigate semantics, browser history and exact-record reveal. Reveal opens a closed pane, activates its tab, exits conflicting zoom and then reveals the record within its own scroller. Outdated navigation and destination callbacks cannot steal focus. Inspector/reference and calls remain global. Unpinned inspection floats and contracts on outside interaction; pinned inspection occupies layout width. API reference retains its existing reading/history role.

Use minimum useful sizes, bounded scrolling and a derived narrow layout rather than camera scaling. Narrow presentation does not rewrite desktop proportions. Divider and docking actions have keyboard/menu equivalents. Shortcuts exclude editors, composition and active overlay controls. Motion respects reduced motion and never delays authoritative navigation.

## Consequences

The host can change geometry without rewriting business components, but mounted-state/resource proofs are mandatory. A registry change is different from ordinary live record refresh; dynamic restoration cannot be pruned before stores are ready. The catalog must never expand API exposure or local-only controls. Observation and recovery continue to follow [ADR 0179](0179-canvas-maintenance-and-observation-lifetimes.md); destination isolation follows [ADR 0167](0167-canvas-destination-isolation.md).

The prototype and its synthetic records are not production dependencies. No guest panes, named user layout libraries, new Package API operations or old-bench compatibility shell are introduced. Serving the changed UI still requires a verified build and separately authorized owner restart under ADR 0013.
