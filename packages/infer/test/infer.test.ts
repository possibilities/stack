import assert from "node:assert/strict";
import { chmodSync, statSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { api } from "../api.js";
import { discoverModels } from "../src/catalog.js";
import { startInput } from "../src/schema.js";
import { InferService, readCompletion, readCredentials } from "../src/service.js";

const accountId = "123e4567-e89b-42d3-a456-426614174000";
const auth = JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: "native_account", access_token: "test-secret" } });
const credentials = async () => ({ access: "test-secret", nativeId: "native_account", auth });
const model = { id: "gpt-6-luna", defaultEffort: "low" as const, supportedEfforts: ["low" as const, "medium" as const] };
let ids = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const input = (extra: object = {}) => startInput.parse({ requestId: nextId(), accountId, model: model.id, effort: "low", instructions: "Classify", input: "example", ...extra });
const event = (value: object) => `data: ${JSON.stringify(value)}\n\n`;
const completion = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } });
const completed = (text = "OK") => completion(event({ type: "response.output_text.delta", delta: text }) +
  event({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 23, output_tokens: 5, total_tokens: 28, output_tokens_details: { reasoning_tokens: 0 } } } }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

async function withState(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "infer-ledger-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function settled(service: InferService, requestId: string) {
  for (let i = 0; i < 500; i++) {
    const record = service.get(requestId);
    if (record.state !== "running") return record;
    await tick();
  }
  throw new Error("request did not finish");
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 500 && !condition(); i++) await tick();
  assert.ok(condition(), "condition not reached");
}
/** A fetch that waits for release() and honors abort, like the real request. */
function gatedFetch() {
  const gate = { calls: 0, release: (_response: Response) => {} };
  const fetcher = ((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    gate.calls++;
    gate.release = resolve;
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })) as typeof fetch;
  return { gate, fetcher };
}

test("the Package API loads with its operations and change event", () => {
  assert.deepEqual(api.operations.map((operation) => operation.name), ["infer_models", "infer_discover", "infer_start", "infer_request_list", "infer_request_get"]);
  assert.deepEqual(Object.keys(api.events!.topics), ["infer_changed"]);
});

test("selects an enabled Bot account without exposing credentials or falling back to another account", async () => {
  await withState(async (dir) => {
    const config = join(dir, "configuration.sqlite"), secrets = join(dir, "secrets.sqlite");
    const db = new DatabaseSync(config);
    db.exec("CREATE TABLE accounts (name TEXT PRIMARY KEY, enabled INTEGER, removing INTEGER)");
    db.prepare("INSERT INTO accounts VALUES (?, 1, 0)").run(accountId);
    db.close();
    const secretDb = new DatabaseSync(secrets);
    secretDb.exec("CREATE TABLE credentials (name TEXT PRIMARY KEY, auth_json TEXT)");
    secretDb.prepare("INSERT INTO credentials VALUES (?, ?)").run(accountId, auth);
    secretDb.close();
    chmodSync(config, 0o600); chmodSync(secrets, 0o600);
    assert.deepEqual(await readCredentials(dir, accountId), { access: "test-secret", nativeId: "native_account", auth });
    const locked = new DatabaseSync(config);
    locked.prepare("UPDATE accounts SET enabled = 0 WHERE name = ?").run(accountId);
    locked.close();
    await assert.rejects(readCredentials(dir, accountId), /account_unavailable/);
  });
});

test("admission returns a running ledger record, then one checked request completes in the background", async () => {
  await withState(async (dir) => {
    let discoveries = 0, requests = 0, changes = 0;
    const service = new InferService(dir, async () => { discoveries++; return [model]; },
      (async (_url, init) => {
        requests++;
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers.Authorization, "Bearer test-secret");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.max_output_tokens, 256);
        assert.equal(body.store, false);
        assert.equal(body.stream, true);
        assert.equal(body.tools, undefined);
        return completed();
      }) as typeof fetch, credentials);
    service.onChange = () => changes++;
    const request = input();
    const admitted = await service.start(request);
    assert.equal(admitted.state, "running");
    assert.equal(admitted.text, null);
    assert.equal(admitted.finishedAt, null);
    const record = await settled(service, request.requestId);
    assert.equal(record.state, "completed");
    assert.equal(record.text, "OK");
    assert.deepEqual(record.usage, { inputTokens: 23, outputTokens: 5, totalTokens: 28, reasoningTokens: 0 });
    assert.ok(record.finishedAt);
    assert.equal(discoveries, 1);
    assert.equal(requests, 1);
    assert.ok(changes >= 2);
    // The request's own fresh discovery refreshes the cached observation.
    assert.deepEqual(service.models(accountId).map((row) => row.models), [[model]]);
    const [summary] = service.list(20).requests;
    assert.equal(summary?.textPreview, "OK");
    assert.equal(summary?.inputPreview, "example");
    assert.equal(summary?.textChars, 2);
    assert.equal("input" in summary!, false);
    assert.equal(statSync(join(dir, "infer", "requests.sqlite")).mode & 0o777, 0o600);
    await service.close();
  });
});

test("an identical resend returns the same record; a reused ID with other input is refused", async () => {
  await withState(async (dir) => {
    let requests = 0;
    const service = new InferService(dir, async () => [model], (async () => { requests++; return completed(); }) as typeof fetch, credentials);
    const request = input();
    await service.start(request);
    await settled(service, request.requestId);
    const again = await service.start(request);
    assert.equal(again.requestId, request.requestId);
    assert.equal(again.state, "completed");
    await assert.rejects(service.start({ ...request, input: "other" }), /request_id_reused/);
    assert.equal(requests, 1);
    assert.equal(service.list(20).requests.length, 1);
    await service.close();
  });
});

test("definite failures are recorded as failed, and nothing is sent before a checked model", async () => {
  await withState(async (dir) => {
    let discover = async () => [model], status = 200, requests = 0;
    const service = new InferService(dir, () => discover(), (async () => { requests++; return status === 200 ? completed() : new Response("", { status }); }) as typeof fetch, credentials);
    const outcome = async (request = input()) => { await service.start(request); const { state, error } = await settled(service, request.requestId); return { state, error }; };
    assert.deepEqual(await outcome(input({ effort: "medium", model: "gpt-6-other" })), { state: "failed", error: "model_unavailable" });
    discover = async () => { throw new Error("secret detail"); };
    assert.deepEqual(await outcome(), { state: "failed", error: "catalog_unavailable" });
    assert.equal(requests, 0);
    discover = async () => [model];
    status = 429;
    assert.deepEqual(await outcome(), { state: "failed", error: "codex_rate_limited" });
    status = 502;
    assert.deepEqual(await outcome(), { state: "failed", error: "http_502" });
    assert.equal(requests, 2);
    await service.close();
  });
});

test("an ambiguous network result or partial stream is unknown and never retried", async () => {
  await assert.rejects(readCompletion(completion(event({ type: "response.output_text.delta", delta: "partial" }))), /response_incomplete/);
  await assert.rejects(readCompletion(completion(event({ type: "response.failed" }))), /response_incomplete/);
  await withState(async (dir) => {
    let attempts = 0;
    const service = new InferService(dir, async () => [model], (async () => { attempts++; throw new Error("secret upstream detail"); }) as typeof fetch, credentials);
    const request = input();
    await service.start(request);
    const record = await settled(service, request.requestId);
    assert.deepEqual({ state: record.state, error: record.error }, { state: "unknown", error: "request_interrupted" });
    assert.equal(attempts, 1);
    assert.ok(!JSON.stringify(service.list(20)).includes("secret"));
    await service.close();
  });
});

test("one running request per account refuses concurrent spend without recording it", async () => {
  await withState(async (dir) => {
    const { gate, fetcher } = gatedFetch();
    const service = new InferService(dir, async () => [model], fetcher, credentials);
    const first = input();
    await service.start(first);
    await assert.rejects(service.start(input()), /infer_busy/);
    assert.equal(service.list(20).requests.length, 1);
    await until(() => gate.calls === 1);
    gate.release(completed());
    assert.equal((await settled(service, first.requestId)).state, "completed");
    // The account is free again once the request finishes.
    const second = input();
    for (let i = 0; ; i++) {
      try { await service.start(second); break; }
      catch (error) { if (i > 100 || !/infer_busy/.test((error as Error).message)) throw error; await tick(); }
    }
    await until(() => gate.calls === 2);
    gate.release(completed());
    assert.equal((await settled(service, second.requestId)).state, "completed");
    await service.close();
  });
});

test("a restart marks requests that were running as unknown", async () => {
  await withState(async (dir) => {
    const { gate, fetcher } = gatedFetch();
    const before = new InferService(dir, async () => [model], fetcher, credentials);
    const request = input();
    await before.start(request);
    await until(() => gate.calls === 1);
    const after = new InferService(dir, async () => [model], fetcher, credentials);
    assert.deepEqual((({ state, error }) => ({ state, error }))(after.get(request.requestId)), { state: "unknown", error: "service_restarted" });
    await before.close();
    // A late outcome from the old process never overwrites the recorded one.
    assert.equal(after.get(request.requestId).error, "service_restarted");
    await after.close();
  });
});

test("shutdown refuses admission and marks a possibly sent request unknown", async () => {
  await withState(async (dir) => {
    const { gate, fetcher } = gatedFetch();
    const service = new InferService(dir, async () => [model], fetcher, credentials);
    const request = input();
    await service.start(request);
    await until(() => gate.calls === 1);
    service.prepareClose();
    await assert.rejects(service.start(input()), /infer_closing/);
    await assert.rejects(service.refreshModels(accountId), /infer_closing/);
    await service.close();
    const reopened = new InferService(dir, async () => [model], fetcher, credentials);
    assert.deepEqual((({ state, error }) => ({ state, error }))(reopened.get(request.requestId)), { state: "unknown", error: "request_interrupted" });
    await reopened.close();
  });
});

test("the ledger pages newest first", async () => {
  await withState(async (dir) => {
    const service = new InferService(dir, async () => [model], (async () => completed()) as typeof fetch, credentials);
    const requests = [input(), input(), input()];
    for (const request of requests) { await service.start(request); await settled(service, request.requestId); }
    const first = service.list(2);
    assert.deepEqual(first.requests.map((row) => row.requestId), [requests[2]!.requestId, requests[1]!.requestId]);
    assert.ok(first.nextBefore);
    const second = service.list(2, first.nextBefore!);
    assert.deepEqual(second.requests.map((row) => row.requestId), [requests[0]!.requestId]);
    assert.equal(second.nextBefore, null);
    assert.throws(() => service.get(nextId()), /unknown_request/);
    await service.close();
  });
});

test("model discovery is cached, coalesced, and forgets an unusable account", async () => {
  await withState(async (dir) => {
    let calls = 0, release = () => {}, fail = false, usable = true;
    const service = new InferService(dir, () => new Promise((resolve, reject) => { calls++; release = () => fail ? reject(new Error("secret")) : resolve([model]); }),
      fetch, async () => { if (!usable) throw new Error("account_unavailable"); return credentials(); });
    assert.deepEqual(service.models(), []);
    const first = await service.refreshModels(accountId);
    await service.refreshModels(accountId);
    assert.equal(calls, 1);
    assert.deepEqual({ ...first, observedAt: undefined }, { accountId, models: null, observedAt: undefined, discovering: true, error: null });
    release();
    await until(() => !service.models(accountId)[0]?.discovering);
    const [observed] = service.models(accountId);
    assert.deepEqual(observed?.models, [model]);
    assert.ok(observed?.observedAt);
    fail = true;
    await service.refreshModels(accountId);
    release();
    await until(() => !service.models(accountId)[0]?.discovering);
    assert.deepEqual((({ models, error }) => ({ models, error }))(service.models(accountId)[0]!), { models: [model], error: "catalog_unavailable" });
    usable = false;
    await assert.rejects(service.refreshModels(accountId), /account_unavailable/);
    assert.deepEqual(service.models(), []);
    await service.close();
  });
});

test("isolated app-server discovery handshakes, paginates, aborts and leaves no credential copy", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "infer-catalog-test-"));
  try {
    const bin = join(stateDir, "fake-codex");
    await writeFile(bin, `#!${process.execPath}\n` + `
const fs = require("node:fs");
const readline = require("node:readline");
const at = process.argv.indexOf("--identity");
if (!process.argv.includes("--stdio") || at < 0 || !fs.readFileSync(process.argv[at+1] + "/auth.json", "utf8").includes("test-secret")) process.exit(1);
let initialized = false;
readline.createInterface({input: process.stdin}).on("line", line => {
  const req = JSON.parse(line);
  if (req.method === "initialize") console.log(JSON.stringify({id:req.id,result:{userAgent:"test"}}));
  else if (req.method === "initialized") initialized = true;
  else if (req.method === "model/list" && initialized && req.params.includeHidden === false) {
    const second = req.params.cursor === "next";
    console.log(JSON.stringify({id:req.id,result:{data:[{
      id:second?"gpt-6-sol":"gpt-6-luna",defaultReasoningEffort:"low",
      supportedReasoningEfforts:[{reasoningEffort:"low"}]
    }],nextCursor:second?null:"next"}}));
  }
});
`, { mode: 0o700 });
    const models = await discoverModels(stateDir, auth, bin);
    assert.deepEqual(models.map((row) => row.id), ["gpt-6-luna", "gpt-6-sol"]);
    assert.deepEqual(await readdir(stateDir), ["fake-codex"]);
    const hang = join(stateDir, "hanging-codex");
    await writeFile(hang, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    const controller = new AbortController();
    const started = Date.now();
    const aborted = discoverModels(stateDir, auth, hang, controller.signal);
    setTimeout(() => controller.abort(), 200);
    await assert.rejects(aborted, /catalog_unavailable/);
    assert.ok(Date.now() - started < 5_000, "abort stops discovery before its own timeout");
    assert.deepEqual((await readdir(stateDir)).sort(), ["fake-codex", "hanging-codex"]);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});
