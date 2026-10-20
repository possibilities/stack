# 184. Fleet History reads retained Bot conversations

Status: accepted, 2026-10-19. Adds a pane to Fleet within the tiled hosts of
[ADR 0180](0180-tiled-pane-spaces.md), beside the live Chat windows of
[ADR 0080](0080-fleet-chat-windows.md), using the read lifetimes of
[ADR 0179](0179-canvas-maintenance-and-observation-lifetimes.md). Remote reads follow
[ADR 0101](0101-remote-uix-through-access.md) unchanged.

## Context

`chat_search` can aggregate every Bot, and a hit can be a stopped Bot or a descendant thread. Chat windows
follow one running Bot's main thread and their composer admits work, so they cannot show these results
faithfully. `chat_open` admits work; it is not a way to view a conversation.

## Decision

**History** (`bot-history`) is one Fleet pane holding search results and a selected conversation reader.

- Search covers all Bots on the server or one exact Bot. Queries are 1–512 characters; an empty query is not
  searched. With one Bot and no query the pane lists that Bot's conversations through `chat_list`. Each
  result is a conversation with one representative match, bound to its own `(botId, threadId, line)`.
- The reader is bound to that exact Bot, thread and rollout line, never to a selection elsewhere. It reads
  `chat_records` from a few lines before the match, focuses the match, and continues earlier and later by
  line. Oversized records load only on request through `chat_record_chunk`, reassembled in UTF-16 order and
  refused if their length or continuation changes. Records render as escaped text; Markdown omits raw HTML
  and names images instead of fetching them.
- Reading calls only `chat_search`, `chat_list`, `chat_records` and `chat_record_chunk`. It never starts a
  Bot, opens a chat or admits input. A stopped Bot's Chat window links to its History instead of asking for a
  start.
- None of these reads has an owner revision, total or completeness marker. Search pages are offsets from an
  explicit read; a full page permits a next-page read without claiming more exist, and a conversation repeated
  on a later page is listed once. A Bot's `bots_changed`, `threads_changed`, `chats_changed` or a scoped
  reconnect marks covered evidence stale and fences continuation until it is read again; the UI does not
  re-read automatically or invent a revision.
- Each read is gated on its live WebSocket exposure and connection. A refusal, a missing or reset history and
  a removed Bot read differently from an empty answer.

`bot-history` is a node kind keyed by Bot ID with its home in this pane; it has no inspectable record.

## Consequences

Stopped history is readable without a lifecycle change. Results can be out of date between explicit reads,
and concatenated records are not snapshots; stronger guarantees need an owner API change. Resume and send
controls stay in Chat and are not offered from History.
