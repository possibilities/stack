# 75. Asynchronous inference requests with a durable ledger

Status: accepted, 2026-09-26. Amends [ADR 0052](0052-private-experimental-inference.md)'s
one-shot synchronous call and supersedes the `infer` forwarding timeouts and
page-local runs of [ADR 0074](0074-lab-inference-over-websocket.md).

## Context

`infer_complete` held one call open for discovery plus the backend request, up to
about 50 seconds. The WebSocket bridge needed per-operation timeout exceptions to
wait for it. The UI had to guess outcomes from transport errors, and a run's
history lived only in the page. That was a workaround in the UI for an API that
did not fit how the UI reads everything else.

## Decision

`infer` follows the Worker turn pattern: prompt admission, durable records,
payload-free invalidation.

- **The ledger is part of the API.** `infer` owns `<state>/infer/requests.sqlite`
  (mode `0600`). Each admitted request is one row holding the chosen account,
  model, effort, instructions, input, output, token usage, timings and a state:
  `running`, `completed`, `failed` or `unknown`. `failed` is definite: nothing
  was sent, or the backend refused the request. `unknown` may have been charged:
  the request was interrupted after it could have been sent
  (`request_interrupted`), its stream ended early (`response_incomplete`), or
  `infer` restarted while it was running (`service_restarted`). A request finishes
  exactly once, and a late outcome never overwrites a recorded one.
- **`infer_start`** takes a caller-generated `requestId`, admits the request and
  returns its running record before any backend work. Resending identical input
  with the same ID returns that record and never starts a second request; reusing
  an ID for other input is refused (`request_id_reused`). Busy accounts, unusable
  accounts and shutdown are refused at admission and are not recorded. The
  background work is unchanged from ADR 0052: a fresh discovery check, then exactly
  one backend request, with no retries.
- **`infer_request_list`** pages the ledger newest first with short previews;
  **`infer_request_get`** returns one full record.
- **`infer_models`** reads cached discovery per account and never starts it.
  **`infer_discover`** starts a background `model/list`, coalesced per account.
  A request's own fresh discovery also refreshes the cache. Observations are held
  in memory.
- **`infer_changed`** is published for every request or observation change.
- The WebSocket bridge's `infer` timeout exceptions are removed; every `infer`
  operation returns promptly. There is still no MCP Transport.

The Lab's Inference window reads the ledger and the model cache through the shared
store, re-reading after `infer_changed` and after each `infer_start` or
`infer_discover` attempt. Requests survive a reload, and a request is followed
from running to its outcome. If an admission response is lost, the window shows
the request once the ledger lists it; otherwise it offers Resend with the same
request ID.

## Consequences

Prompts and outputs are now stored on disk under AgentStack state, like Worker
transcripts. The ledger has no retention limit or removal operation yet.
`infer_complete` is removed; its only caller was the Lab window. Shutdown cancels
in-flight discovery and requests: one cancelled before sending is `failed`
(`cancelled`), one that may have been sent is `unknown`.
