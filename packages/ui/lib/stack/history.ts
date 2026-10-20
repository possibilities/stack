import type { Bot, ChatHit, ChatRecord, ChatRecordChunk, OperationDoc, PackageDoc } from "./types";

/**
 * Fleet History: retained Bot conversations read by exact Bot, thread and rollout line. Pure and browser-safe.
 * Reads are chat_search, chat_list, chat_records and chat_record_chunk only; none starts a Bot or admits work.
 * Search pages are unfenced offsets, record pages continue by line and full records by UTF-16 offset: three
 * contracts, none with an owner revision, so nothing here claims a snapshot, a total or completeness.
 */

export type HistoryOperation = "chat_search" | "chat_list" | "chat_records" | "chat_record_chunk";

export const historyQueryLimit = 512;
export const historyPageSize = 25;
/** chat_records' largest page. Each record is one rollout line, so a window of this many lines fits one page. */
export const recordPageSize = 50;
/** Lines before a matched record read with it, so the match arrives with some of what led to it. */
export const leadLines = 8;
export const chunkLength = 65_536;
/** A bounded full-record read: 16M UTF-16 code units. */
export const maxChunks = 256;

type AccessState = { catalog: { data: PackageDoc[] | null }; remote?: { scope: "view" | "control" } | null; status: Record<string, string | undefined> };

/** Discovery is already intersected with the viewer's live exposure; the gateway still decides each call. */
export function historyAccess(state: AccessState, operation: HistoryOperation): string | null {
  if (!state.catalog.data) return "Reading API discovery…";
  const doc = state.catalog.data.find((item) => item.name === "bots");
  if (!doc) return "Bots are not in API discovery.";
  if (!doc.transports.some((transport) => transport.type === "websocket" && transport.supported && transport.operations.includes(operation)))
    return `This server does not expose ${operation} on its WebSocket.`;
  const declared: OperationDoc | undefined = doc.operations.find((item) => item.name === operation);
  if (state.remote?.scope === "view" && declared?.annotations.readOnlyHint !== true) return `${operation} requires ui:control.`;
  if (state.status.bots !== "open") return "The bots connection is not open.";
  return null;
}

/** An empty query is not searched. */
export function searchText(input: string): { query: string | null; issue: string | null } {
  const query = input.trim();
  if (!query) return { query: null, issue: null };
  if (query.length > historyQueryLimit) return { query: null, issue: `Use at most ${historyQueryLimit} characters.` };
  return { query, issue: null };
}

/**
 * What a history read depends on: the covered Bots' sanctioned roots and their invalidation counts. A read
 * keeps the mark it started under; a different current mark means the evidence may be out of date.
 */
export function historyMark(bots: readonly Bot[] | null, invalidations: Readonly<Record<string, number>>, botId: string | null): string {
  if (!bots) return JSON.stringify([botId, null]);
  const covered = bots.filter((bot) => botId === null || bot.id === botId).map((bot) => [bot.id, bot.mainThreadId, invalidations[bot.id] ?? 0]);
  return JSON.stringify([botId, covered.sort(([a], [b]) => String(a).localeCompare(String(b)))]);
}

export const hitKey = (hit: { botId: string; threadId: string }) => `${hit.botId}/${hit.threadId}`;

/** Offset pages over a changing index may repeat a conversation; the first occurrence keeps its place. */
export function appendUnique<T extends { botId: string; threadId: string }>(held: readonly T[], page: readonly T[]): { items: T[]; repeated: number } {
  const seen = new Set(held.map(hitKey));
  const items = [...held];
  let repeated = 0;
  for (const item of page) {
    if (seen.has(hitKey(item))) { repeated++; continue; }
    seen.add(hitKey(item));
    items.push(item);
  }
  return { items, repeated };
}

/** The exact conversation and record a reader is bound to. A null line reads from the start. */
export type HistoryTarget = { botId: string; threadId: string; line: number | null; title: string; parentThreadId: string | null };
export const targetKey = (target: HistoryTarget) => JSON.stringify([target.botId, target.threadId, target.line]);
export const hitTarget = (hit: ChatHit): HistoryTarget => ({ botId: hit.botId, threadId: hit.threadId, line: hit.line, title: hit.title, parentThreadId: hit.parentThreadId });

/**
 * A loaded run of records. `start` is the afterLine of its first read: every chat record on lines after it,
 * up to `nextLine`, has been read. `nextLine` is the owner's continuation, passed back unchanged.
 */
export type RecordWindow = { records: ChatRecord[]; start: number; nextLine: number | null };

export const firstWindow = (line: number | null) => ({ afterLine: line === null ? 0 : Math.max(0, line - 1 - leadLines), limit: recordPageSize });
/** Earlier lines, at most one page of them, so the read is complete up to the window's start. */
export const earlierWindow = (start: number) => ({ afterLine: Math.max(0, start - recordPageSize), limit: recordPageSize });
/** After a null nextLine, the last record read is where newer records would begin. */
export const laterAfter = (window: RecordWindow): number | null => window.nextLine ?? window.records.at(-1)?.line ?? (window.start || null);

export function prependEarlier(window: RecordWindow, afterLine: number, page: readonly ChatRecord[]): RecordWindow {
  const earlier = page.filter((record) => record.line <= window.start);
  return { ...window, records: [...earlier, ...window.records], start: afterLine };
}

export function appendLater(window: RecordWindow, page: { records: readonly ChatRecord[]; nextLine: number | null }): RecordWindow {
  const last = window.records.at(-1)?.line ?? window.start;
  return { ...window, records: [...window.records, ...page.records.filter((record) => record.line > last)], nextLine: page.nextLine };
}

export type RecordKind = "human" | "assistant" | "context" | "instructions" | "reasoning" | "tool-call" | "tool-output" | "event" | "other";
export type RecordView = { kind: RecordKind; label: string; text: string; name: string | null };

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const parts = (value: unknown): string => Array.isArray(value) ? value.map((part) => text(object(part).text)).filter(Boolean).join("\n") : "";
const output = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? parts(value)
  : typeof object(value).content === "string" ? text(object(value).content) : parts(object(value).content);
const json = (value: unknown): string => { try { return JSON.stringify(value, null, 2) ?? ""; } catch { return String(value); } };
/** Harness-supplied user-role input, as the owner's index recognizes it. */
const contextMarkers = ["<environment_context>", "<recommended_plugins>", "<user_instructions>", "# AGENTS.md"];

/**
 * How one raw record reads. Text is content to show escaped, never markup to execute. Event records
 * repeat what response items already carry, so they read as compact events.
 */
export function recordView(type: string, payload: unknown): RecordView {
  const item = object(payload);
  const kind = text(item.type);
  if (type === "event_msg") return { kind: "event", label: kind || "event", text: text(item.message) || text(item.text) || text(item.reason), name: null };
  if (type !== "response_item") return { kind: "other", label: type || "record", text: "", name: null };
  if (kind === "message") {
    const role = text(item.role), body = parts(item.content);
    if (role === "assistant") return { kind: "assistant", label: "Assistant", text: body, name: null };
    if (role === "user") return contextMarkers.some((marker) => body.startsWith(marker))
      ? { kind: "context", label: "Harness context", text: body, name: null } : { kind: "human", label: "Human", text: body, name: null };
    return { kind: "instructions", label: role ? `${role[0]!.toUpperCase()}${role.slice(1)} instructions` : "Instructions", text: body, name: null };
  }
  if (kind === "reasoning") return { kind: "reasoning", label: "Reasoning summary", text: parts(item.summary), name: null };
  if (kind.endsWith("_output")) return { kind: "tool-output", label: "Tool output", text: output(item.output), name: text(item.call_id) || null };
  if (kind.endsWith("_call")) {
    const name = text(item.name) || (kind === "web_search_call" ? "web search" : kind === "local_shell_call" ? "shell" : kind.replace(/_call$/, ""));
    const args = text(item.arguments) || text(item.input) || (item.action !== undefined ? json(item.action) : "");
    return { kind: "tool-call", label: "Tool call", text: args, name };
  }
  return { kind: "other", label: kind || "response item", text: "", name: null };
}

export type HistoryFailure = { kind: "refused" | "missing" | "removed" | "error"; message: string };

/** A refusal, a missing history and a failed read stay distinct from an empty answer. */
export function historyFailure(message: string, botId?: string): HistoryFailure {
  if (/operation_refused|grant_changed|unauthorized|requires ui:|available only on the local UI/i.test(message))
    return { kind: "refused", message: "This session is not permitted to read Bot history." };
  if (/^unknown bot/i.test(message)) return { kind: "removed", message: `${botId ?? "This Bot"} no longer exists on this server.` };
  if (/not in this Bot's main-thread lineage/.test(message))
    return { kind: "missing", message: `This conversation is no longer in ${botId ?? "the Bot"}’s sanctioned history. It may have been reset or removed.` };
  if (/rollout line not found|not a chat record|offset exceeds record length/.test(message))
    return { kind: "missing", message: "That record is no longer where it was read. Read the conversation again." };
  return { kind: "error", message };
}

/**
 * Reassemble one record from bounded UTF-16 chunks in order. The owner has no revision for a record, so a
 * changed length or broken continuation is refused rather than stitched together.
 */
export async function readFullRecord(read: (offset: number, length: number) => Promise<ChatRecordChunk>,
  progress: (read: number, total: number) => void = () => {}): Promise<string> {
  const chunks: string[] = [];
  let offset = 0, total: number | null = null;
  for (let count = 0; count < maxChunks; count++) {
    const chunk = await read(offset, chunkLength);
    if (total !== null && chunk.totalChars !== total) throw new Error("The record changed while it was being read; read it again.");
    total = chunk.totalChars;
    const end = offset + chunk.text.length;
    if (chunk.nextOffset !== null && (chunk.nextOffset !== end || !chunk.text.length)) throw new Error("The record's chunks did not continue where the last one ended; read it again.");
    chunks.push(chunk.text);
    offset = end;
    progress(offset, total);
    if (chunk.nextOffset === null) {
      if (offset !== total) throw new Error("The record ended before its stated length; read it again.");
      return chunks.join("");
    }
  }
  throw new Error(`The record is longer than ${maxChunks} chunks; it was not loaded.`);
}

/** The payload of a full record line, or null when it does not parse as one. */
export function fullPayload(line: string): { type: string; payload: unknown } | null {
  try {
    const value = object(JSON.parse(line));
    return { type: text(value.type), payload: value.payload };
  } catch { return null; }
}
