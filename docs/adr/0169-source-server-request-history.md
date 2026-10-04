# 169. Discover Source remote-request history from its server owner

Status: accepted, 2026-10-03. Extends [ADR 0159](0159-github-webhook-ledger-and-watches.md)
and supersedes the browser-history and absent-receipt replay decisions in
[ADR 0166](0166-source-receiver-setup.md). Preserves the destination isolation of
[ADR 0167](0167-canvas-destination-isolation.md).

## Decision

Source retains remote-request receipts, including running and unknown outcomes,
in its existing durable ledger. `github_remote_receipt_list` discovers one
receiver's history without requiring caller-held request IDs. Pages are newest
admission first, bounded to 50 entries, with an exclusive `before` cursor from
`nextCursor`. Status updates do not reorder requests. `unsettled` counts running
and unknown requests across the whole receiver, including outside the page.
New redelivery receipts also retain the exact GitHub `deliveryId`; older receipts
may omit it. No request input, credential or secret is added to the read.

The read requires local operator authority, remains absent from MCP and is fenced
by Access's existing `github_remote_receipt_*` rule. It reads local state only,
never `gh`. The Receivers window and its existing setup facts use this history,
refresh on receiver invalidations/reconnection, disclose unavailable or partial
history and offer explicit older-page reads. Another local browser sees the same
server receipts. Unknown redelivery receipts that do not retain an exact attempt
conservatively hold redelivery for that hook; unread older unsettled receipts hold
new requests until inspected.

Destination-bound browser storage is only the pre-admission uncertainty journal:
the exact request ID and inputs are still recorded before dispatch. A server
receipt confirms admission and removes that browser record, even if its outcome
is running or unknown. Legacy browser history migrates through exact receipt
reads. Missing or unreadable receipts leave the identity unconfirmed. A missing
receipt now cannot prove a delayed request will not arrive later: it never grants
replay authority. The UI never resends uncertain requests, including with the
same ID. Forget removes only unconfirmed browser bookkeeping, not server history
or a delayed request. Retained server receipts have no Forget control.

## Consequences

Recovery history survives a browser change without weakening the server's
non-replaying mutation boundary. Truly unconfirmed admissions remain visible
only in their originating browser until the server records them. Reading a
receipt does not retry, cancel, resolve an unknown outcome, or verify a signed
arrival. Receipt inspection and new deliberate GitHub requests remain distinct.
