import assert from "node:assert/strict";
import test from "node:test";
import { appendLater, earlierWindow, firstWindow, historyAccess, historyFailure, historyMark, laterAfter, prependEarlier, readFullRecord, recordView } from "../lib/stack/history.ts";

/** chat_records over a rollout: chat records on lines after afterLine, one per line, other lines skipped. */
function owner(lines) {
  return (afterLine, limit) => {
    const records = [];
    for (let i = afterLine; i < lines.length; i++) {
      if (lines[i] === null) continue;
      if (records.length === limit) return { records, nextLine: i };
      records.push({ line: i + 1, timestamp: "", type: "response_item", payload: lines[i], truncated: false });
    }
    return { records, nextLine: null };
  };
}

test("line windows read around a match and extend both ways without gaps or repeats", () => {
  // 130 rollout lines; every fourth is not a chat record (session metadata, turn context).
  const lines = Array.from({ length: 130 }, (_, index) => index % 4 === 3 ? null : `record ${index + 1}`);
  const read = owner(lines);
  const expected = lines.flatMap((value, index) => value === null ? [] : [index + 1]);
  const first = firstWindow(102);
  let window = { ...read(first.afterLine, first.limit), start: first.afterLine };
  assert.ok(window.records.some((record) => record.line === 102), "the matched record is in the first read");
  assert.ok(window.records[0].line < 102, "it arrives with what led to it");
  while (window.start > 0) {
    const earlier = earlierWindow(window.start);
    window = prependEarlier(window, earlier.afterLine, read(earlier.afterLine, earlier.limit).records);
  }
  for (let after = laterAfter(window), guard = 0; window.nextLine !== null && guard < 10; after = laterAfter(window), guard++) window = appendLater(window, read(after, 50));
  assert.deepEqual(window.records.map((record) => record.line), expected);
  // At the end, a later read starts after the last record and only adds what is newer.
  lines.push("record 131");
  window = appendLater(window, read(laterAfter(window), 50));
  assert.deepEqual(window.records.map((record) => record.line), [...expected, 131]);
});

test("full records reassemble UTF-16 chunks exactly and refuse a record that changed", async () => {
  const source = JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `${"x".repeat(9)}😀 é 𝄞`.repeat(5) }] } });
  const reads = [];
  const chunk = (text) => async (offset, length) => {
    reads.push(offset);
    const end = Math.min(text.length, offset + 10);
    return { text: text.slice(offset, end), totalChars: text.length, nextOffset: end < text.length ? end : null, length };
  };
  const progress = [];
  assert.equal(await readFullRecord(chunk(source), (read, total) => progress.push([read, total])), source);
  assert.ok(reads.some((offset) => /[\uDC00-\uDFFF]/.test(source[offset])), "a chunk boundary splits a surrogate pair");
  assert.deepEqual(progress.at(-1), [source.length, source.length]);

  let calls = 0;
  const changing = async (offset) => ({ text: source.slice(offset, offset + 10), totalChars: source.length + (calls++ ? 1 : 0), nextOffset: offset + 10 });
  await assert.rejects(readFullRecord(changing), /changed while it was being read/);
  const skipping = async (offset) => ({ text: source.slice(offset, offset + 10), totalChars: source.length, nextOffset: offset + 20 });
  await assert.rejects(readFullRecord(skipping), /did not continue/);
  const short = async () => ({ text: source.slice(0, 10), totalChars: source.length, nextOffset: null });
  await assert.rejects(readFullRecord(short), /ended before its stated length/);
});

test("history evidence goes stale for covered invalidation, reset and removal only", () => {
  const bot = (id, mainThreadId = `${id}-root`) => ({ id, mainThreadId });
  const bots = [bot("a"), bot("b")];
  const one = historyMark(bots, { a: 1, b: 1 }, "a"), all = historyMark(bots, { a: 1, b: 1 }, null);
  assert.equal(historyMark(bots, { a: 1, b: 2 }, "a"), one, "another Bot's notice does not stale a Bot-scoped read");
  assert.notEqual(historyMark(bots, { a: 1, b: 2 }, null), all);
  assert.notEqual(historyMark(bots, { a: 2, b: 1 }, "a"), one);
  assert.notEqual(historyMark([bot("a", "a-new"), bot("b")], { a: 1, b: 1 }, "a"), one, "a reset root changes what is sanctioned");
  assert.notEqual(historyMark([bot("b")], { a: 1, b: 1 }, "a"), one, "removal changes it");
  assert.equal(historyMark([...bots].reverse(), { a: 1, b: 1 }, null), all, "inventory order is not a change");
});

test("reads are gated by live exposure and connection, and refusals stay distinct from missing history", () => {
  const doc = (operations) => ({ name: "bots", operations: [{ name: "chat_search", annotations: { readOnlyHint: true } }],
    transports: [{ type: "websocket", supported: true, operations }] });
  const state = (operations, extra = {}) => ({ catalog: { data: [doc(operations)] }, status: { bots: "open" }, ...extra });
  assert.equal(historyAccess(state(["chat_search"]), "chat_search"), null);
  assert.equal(historyAccess(state(["chat_search"], { remote: { scope: "view" } }), "chat_search"), null, "a read-only remote viewer may read");
  assert.match(historyAccess(state(["chat_records"], { remote: { scope: "control" } }), "chat_search"), /does not expose chat_search/);
  assert.match(historyAccess(state(["chat_search"], { status: { bots: "closed" } }), "chat_search"), /not open/);
  assert.match(historyAccess({ catalog: { data: null }, status: {} }, "chat_search"), /discovery/);

  assert.equal(historyFailure("operation_refused", "a").kind, "refused");
  assert.equal(historyFailure("thread is not in this Bot's main-thread lineage", "a").kind, "missing");
  assert.equal(historyFailure("unknown bot: a", "a").kind, "removed");
  assert.equal(historyFailure("rollout line not found; refresh chat history", "a").kind, "missing");
  assert.deepEqual(historyFailure("bots WebSocket is not connected", "a"), { kind: "error", message: "bots WebSocket is not connected" });
});

test("records read as human, assistant, harness context, tools and events", () => {
  const message = (role, text) => ({ type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] });
  const cases = [
    [["response_item", message("user", "Fix the build")], "human", "Fix the build"],
    [["response_item", message("user", "<environment_context>\n<cwd>/x</cwd>")], "context", "<environment_context>\n<cwd>/x</cwd>"],
    [["response_item", message("developer", "Be brief")], "instructions", "Be brief"],
    [["response_item", message("assistant", "Done <img src=x onerror=alert(1)>")], "assistant", "Done <img src=x onerror=alert(1)>"],
    [["response_item", { type: "reasoning", summary: [{ type: "summary_text", text: "Checking" }], encrypted_content: "opaque" }], "reasoning", "Checking"],
    [["response_item", { type: "function_call", name: "exec", arguments: "{\"cmd\":\"ls\"}", call_id: "c1" }], "tool-call", "{\"cmd\":\"ls\"}"],
    [["response_item", { type: "function_call_output", call_id: "c1", output: { content: "a\nb", success: true } }], "tool-output", "a\nb"],
    [["response_item", { type: "custom_tool_call_output", call_id: "c2", output: "patched" }], "tool-output", "patched"],
    [["event_msg", { type: "agent_message", message: "Done" }], "event", "Done"],
    [["response_item", { type: "something_new" }], "other", ""],
  ];
  for (const [[type, payload], kind, text] of cases) {
    const view = recordView(type, payload);
    assert.deepEqual([view.kind, view.text], [kind, text], `${type} ${payload.type}`);
  }
  assert.equal(recordView("response_item", cases[5][0][1]).name, "exec");
});
