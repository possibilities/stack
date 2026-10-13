import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import { activeThreads, listActiveThreads, threadTree, watchThreadEvents } from "../src/threads.js";

test("loaded threads nest subagents under the main thread", () => {
  const threads = activeThreads([
    { id: "gone", preview: "old", status: { type: "notLoaded" } },
    { id: "broken", preview: "err", status: { type: "systemError" } },
    {
      id: "main",
      preview: "plan the change",
      model: "gpt",
      parentThreadId: null,
      status: { type: "idle" },
    },
    {
      id: "child",
      preview: "",
      model: "gpt",
      parentThreadId: "main",
      status: { type: "active", activeFlags: [] },
    },
    {
      id: "ask",
      preview: "need input",
      parentThreadId: "missing-parent",
      status: { type: "active", activeFlags: ["waitingOnUserInput"] },
    },
  ]);
  assert.deepEqual(threadTree(threads), [
    {
      id: "main",
      label: "plan the change",
      model: "gpt",
      activity: "idle",
      parentThreadId: null,
      children: [
        {
          id: "child",
          label: "child",
          model: "gpt",
          activity: "working",
          parentThreadId: "main",
          children: [],
        },
      ],
    },
    {
      id: "ask",
      label: "need input",
      model: null,
      activity: "waiting",
      parentThreadId: "missing-parent",
      children: [],
    },
  ]);
});

test("a parent cycle retains every thread", () => {
  const input = activeThreads([
    { id: "a", parentThreadId: "b", status: { type: "active" } },
    { id: "b", parentThreadId: "c", status: { type: "active" } },
    { id: "c", parentThreadId: "a", status: { type: "active" } },
  ]);
  const tree = threadTree(input);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.id, "a");
  assert.deepEqual([tree[0]?.id, tree[0]?.children?.[0]?.id, tree[0]?.children?.[0]?.children?.[0]?.id], ["a", "c", "b"]);
});

test("thread reads retain successes and notifications invalidate the watcher", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stack-thread-ws-"));
  const path = join(dir, "app.sock");
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  const experimental = new WeakSet();
  wss.on("connection", (peer) => peer.on("message", (raw) => {
    const frame = JSON.parse(String(raw)) as { id?: number; method?: string; params?: { threadId?: string; capabilities?: { experimentalApi?: boolean } } };
    if (frame.method === "initialize") {
      if (frame.params?.capabilities?.experimentalApi) experimental.add(peer);
      peer.send(JSON.stringify({ id: frame.id, result: {} }));
    }
    if (frame.method === "thread/loaded/list") peer.send(JSON.stringify({ id: frame.id, result: { data: ["good", "child", "bad", "other", "other-child"] } }));
    if (frame.method === "thread/read") {
      if (frame.params?.threadId === "good") {
        peer.send(JSON.stringify({ id: frame.id, result: { thread: { id: "good", status: { type: "active" } } } }));
      } else if (frame.params?.threadId === "child" || frame.params?.threadId === "other-child") {
        peer.send(JSON.stringify({ id: frame.id, result: { thread: { id: frame.params.threadId, parentThreadId: frame.params.threadId === "child" ? "good" : "other", status: { type: "active" } } } }));
      } else if (frame.params?.threadId === "other") {
        peer.send(JSON.stringify({ id: frame.id, result: { thread: { id: "other", status: { type: "active" } } } }));
      } else peer.send(JSON.stringify({ id: frame.id, error: { message: "unavailable" } }));
    }
  }));
  await new Promise<void>((resolve) => http.listen(path, resolve));
  let stop: (() => void) | undefined;
  try {
    assert.deepEqual(await listActiveThreads(`unix://${path}`, null), []);
    assert.deepEqual((await listActiveThreads(`unix://${path}`, "good")).map((thread) => thread.id), ["good"]);
    assert.deepEqual((await listActiveThreads(`unix://${path}`, "good"))[0]?.children?.map((thread) => thread.id), ["child"]);
    assert.deepEqual(await listActiveThreads(`unix://${path}`, "missing"), []);
    let changes = 0;
    stop = watchThreadEvents(`unix://${path}`, () => { changes += 1; });
    await until(() => changes === 1);
    for (const peer of wss.clients) peer.send(JSON.stringify({ method: "thread/status/changed" }));
    await until(() => changes === 2);
    // Native transport drops thread/settings/updated unless experimentalApi is enabled.
    for (const peer of wss.clients) if (experimental.has(peer)) peer.send(JSON.stringify({ method: "thread/settings/updated", params: { threadId: "child" } }));
    await until(() => changes === 3);
    for (const method of ["thread/project/updated", "item/started", "thread/name/updated", "thread/closed"])
      for (const peer of wss.clients) peer.send(JSON.stringify({ method, params: { threadId: "child", privateText: "must remain a payload-free invalidation" } }));
    await until(() => changes === 4);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(changes, 4, "a lifecycle/configuration burst is coalesced");
  } finally {
    stop?.();
    for (const peer of wss.clients) peer.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), "expected thread event did not arrive");
}

test("the main-thread event subscription survives refusal and reconnect and ends on stop", async () => {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  const subscribers = new Set<import('ws').WebSocket>();
  let attempts = 0, connected = 0, disconnected = 0, delivered = 0;
  wss.on("connection", (peer) => {
    peer.on("close", () => subscribers.delete(peer));
    peer.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.method === "initialize") peer.send(JSON.stringify({ id: frame.id, result: {} }));
      if (frame.method === "thread/resume") {
        assert.deepEqual(frame.params, { threadId: "main" }, "joining never changes native thread settings or chooses another root");
        attempts++;
        if (attempts === 1) peer.send(JSON.stringify({ id: frame.id, error: { message: "temporarily unavailable" } }));
        else {
          subscribers.add(peer);
          peer.send(JSON.stringify({ id: frame.id, result: { thread: { id: "main" } } }));
          peer.send(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "main", delta: "hello" } }));
        }
      }
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const wait = async (predicate: () => boolean) => {
    for (let n = 0; n < 300 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate(), "expected subscribed event delivery");
  };
  const stop = watchThreadEvents(`ws://127.0.0.1:${(http.address() as { port: number }).port}`, () => {},
    (method) => { if (method === "item/agentMessage/delta") delivered++; }, () => connected++, () => disconnected++, "main");
  try {
    await wait(() => delivered === 1);
    assert.equal(connected, 1, "refused subscriptions must not report readiness");
    assert.equal(disconnected, 1);
    for (const peer of subscribers) peer.terminate();
    await wait(() => delivered === 2);
    assert.equal(connected, 2);
    assert.equal(subscribers.size, 1);
    stop();
    await wait(() => subscribers.size === 0);
  } finally {
    stop();
    for (const peer of wss.clients) peer.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
