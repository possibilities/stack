// Optional rendered check of Fleet History after pnpm test. No live server, Bot or provider calls.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/history-browser-check.mjs
// CHROME_BIN may override the local headless Chrome executable; HISTORY_EVIDENCE_DIR keeps screenshots.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishedJsonSchema, serveSocket, serveWebSocket, socketPath } from "@stack/api";
import { api as botsApi } from "../../bots/dist/api.js";
import { revealPane } from "./pane-spaces-browser.mjs";
import { authorizeBrowser, fixtureDoc, fixtureWorkspace, freePort, serveFixture, transport, z } from "./browser-fixture.mjs";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Set PLAYWRIGHT_MODULE to an installed Playwright module");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const require = createRequire(import.meta.url);
const ui = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "stack-history-browser-"));
const evidence = process.env.HISTORY_EVIDENCE_DIR ?? join(dir, "evidence");
await mkdir(evidence, { recursive: true });
const env = { ...process.env, STACK_STATE_DIR: dir, NEXT_TELEMETRY_DISABLED: "1" };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const defaults = { model: "gpt-6-sol", reasoningEffort: "medium", sandboxMode: "danger-full-access", approvalPolicy: "never" };
const bot = (name, state, mainThreadId) => ({ id: name, state, pid: state === "running" ? 321 : null, cwd: "/fixture/workspace", url: state === "running" ? "ws://127.0.0.1:4100" : null,
  account: id(1), runningAccount: state === "running" ? id(1) : null, mainThreadId, recoveryIssue: null, roleId: null, roleRevision: 1, settings: defaults, orientation: null });
let bots = [bot("bot-1", "running", id(10)), bot("bot-2", "stopped", id(20))];

// A remote asset a rendered record must never fetch.
let assetRequests = 0;
const assets = createServer((_request, response) => { assetRequests++; response.end("x"); });
await new Promise((resolve) => assets.listen(0, "127.0.0.1", resolve));
const pixel = `http://127.0.0.1:${assets.address().port}/pixel.png`;

const message = (role, text) => ({ type: "response_item", payload: { type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] } });
const huge = `${"Long tool output line.\n".repeat(2849)}x😀${"y".repeat(70_000)}TAIL-MARKER`;
/** Rollouts as JSONL lines: line 1 is session metadata; every tenth line is turn context, not a chat record. */
function rollout(threadId) {
  const lines = [{ type: "session_meta", payload: { id: threadId } }];
  for (let line = 2; line <= 120; line++) {
    if (line % 10 === 0) lines.push({ type: "turn_context", payload: { model: "gpt-6-sol" } });
    else if (threadId === id(21) && line === 41) lines.push(message("user", "Please deploy the fixture"));
    else if (threadId === id(21) && line === 42) lines.push(message("assistant", `Deployed. <img src=x onerror="window.__unsafe=1"> **done** ![chart](${pixel})`));
    else if (threadId === id(21) && line === 45) lines.push(message("assistant", huge));
    else if (threadId === id(21) && line === 46) lines.push({ type: "response_item", payload: { type: "function_call", name: "exec", arguments: "{\"cmd\":\"<script>window.__unsafe=2</script>\"}", call_id: "c1" } });
    else if (line % 3 === 0) lines.push({ type: "event_msg", payload: { type: "token_count" } });
    else lines.push(message(line % 2 ? "user" : "assistant", `${threadId === id(21) ? "Descendant" : "Thread"} ${threadId.slice(-3)} record ${line}`));
  }
  return lines.map((line, index) => JSON.stringify({ timestamp: new Date(1_760_000_000_000 + index * 1000).toISOString(), ...line }));
}
const threads = {
  [id(10)]: { botId: "bot-1", parentThreadId: null, title: "Main thread of bot-1" },
  [id(20)]: { botId: "bot-2", parentThreadId: null, title: "Main thread of bot-2" },
  [id(21)]: { botId: "bot-2", parentThreadId: id(20), title: "Deploy the fixture (descendant)" },
  [id(22)]: { botId: "bot-2", parentThreadId: id(20), title: "A thread whose history is gone" },
};
for (let n = 0; n < 30; n++) threads[id(100 + n)] = { botId: n % 2 ? "bot-1" : "bot-2", parentThreadId: n % 2 ? id(10) : id(20), title: `Older deploy ${n}` };
const chat = (threadId) => ({ botId: threads[threadId].botId, threadId, parentThreadId: threads[threadId].parentThreadId, title: threads[threadId].title, cwd: "/fixture", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-18T12:00:00Z", messageCount: 80 });
const hit = (threadId, line) => ({ ...chat(threadId), line, role: "user", snippet: `… please [deploy] the fixture <b>now</b> …`, score: -line });
const ranked = [hit(id(21), 41), hit(id(10), 12), hit(id(22), 5), hit(id(20), 31), ...Array.from({ length: 30 }, (_, n) => hit(id(100 + n), 21))];

const calls = [];
const gates = new Map();
const forbidden = ["bot_start", "bot_stop", "chat_open", "chat_send", "chat_steer", "chat_enqueue", "chat_interrupt", "chat_queue_resolve", "chat_codex_queue_add", "chat_codex_queue_start"];
const handlers = {
  account_list: () => ({ accounts: [{ id: id(1), enabled: true, removing: false, linkedAccounts: [] }] }), worker_account_list: () => ({ accounts: [] }),
  account_login_current: () => ({ login: null }), worker_account_login_current: () => ({ logins: [] }),
  bot_list: () => ({ bots }), bot_defaults_get: () => defaults, voice_status: () => ({ call: null }),
  bot_state_read: () => ({ incarnation: id(50), generation: id(51), maintenanceRequestId: null, entries: [] }),
  bot_history_list: () => ({ generations: [], revision: "fixture", nextOffset: null }),
  chat_main_items: () => ({ threadId: id(10), data: [], nextCursor: null }),
  chat_main_live: () => ({ threadId: id(10), instance: "fixture", revision: 0, activeTurnId: null, activeTurnStartedAt: null, coverage: "partial", reset: true, items: [] }),
  chat_search: ({ botId, query, limit, offset }) => {
    if (query.includes("refused")) throw new Error("operation_refused");
    const matches = ranked.filter((item) => !botId || item.botId === botId);
    // Offsets over a changing index can repeat a conversation on the next page.
    return { hits: [...matches.slice(offset, offset + limit), ...offset ? [matches[0]] : []].slice(0, limit) };
  },
  chat_list: ({ botId, limit, offset }) => ({ chats: Object.keys(threads).filter((thread) => threads[thread].botId === botId).map(chat).slice(offset, offset + limit) }),
  chat_records: async ({ botId, threadId, afterLine, limit }) => {
    await gates.get(threadId)?.promise;
    if (threadId === id(22) || threads[threadId]?.botId !== botId || !bots.some((item) => item.id === botId)) throw new Error("thread is not in this Bot's main-thread lineage");
    const lines = rollout(threadId), records = [];
    for (let i = afterLine; i < lines.length; i++) {
      const value = JSON.parse(lines[i]);
      if (value.type !== "response_item" && value.type !== "event_msg") continue;
      if (records.length === limit) return { records, nextLine: i };
      const truncated = lines[i].length > 65_536;
      records.push({ line: i + 1, timestamp: value.timestamp, type: value.type, payload: truncated ? null : value.payload, truncated });
    }
    return { records, nextLine: null };
  },
  chat_record_chunk: ({ threadId, line, offset, length }) => {
    const source = rollout(threadId)[line - 1];
    const end = Math.min(source.length, offset + length);
    return { text: source.slice(offset, end), totalChars: source.length, nextOffset: end < source.length ? end : null };
  },
};
for (const name of forbidden) handlers[name] = () => { throw new Error(`${name} must not be called by History`); };

const served = new Map();
let websocket, next, browser;
let log = "";
try {
  websocket = await serveWebSocket({ env, root: await fixtureWorkspace(dir, ["serve", "auth", "bots", "api"]), port: 0 });
  const botsDoc = fixtureDoc("bots", botsApi, websocket.url, publishedJsonSchema);
  const catalog = [botsDoc, ...["auth", "serve", "api"].map((name) => ({ name, packageName: `@stack/${name}`, description: "Fixture", events: {}, eventScope: null, operations: [], transports: [transport(websocket.url)] }))];
  handlers.docs_snapshot = () => ({ packages: catalog });
  const serve = await serveFixture(handlers);
  Object.assign(handlers, serve.handlers);
  const operations = (names, api) => names.map((name) => ({ name, description: name, input: api?.operations.find((operation) => operation.name === name)?.input ?? z.looseObject({}), output: z.any(),
    async call(_, input) { calls.push({ name, input }); return handlers[name](input); } }));
  const definitions = { serve: serve.names, auth: ["account_list", "worker_account_list", "account_login_current", "worker_account_login_current"],
    bots: Object.keys(handlers).filter((name) => /^(bot_|voice_|chat_)/.test(name)), api: ["docs_snapshot"] };
  const topics = { serve: serve.topics, auth: Object.fromEntries(["accounts_changed", "worker_accounts_changed", "login_changed", "worker_login_changed"].map((name) => [name, "Fixture"])), bots: botsApi.events.topics, api: {} };
  for (const [name, names] of Object.entries(definitions)) served.set(name, await serveSocket({ info: { name, description: name, transportDescription: "Fixture", path: socketPath(name, env) }, context: {},
    operations: operations(names, name === "bots" ? botsApi : undefined), events: { topics: topics[name], scope: name === "bots" ? { valid: () => true, description: "Fixture", example: "bot-1" } : undefined } }));
  const nextPort = await freePort();
  env.STACK_WEBSOCKET_ORIGIN = `http://127.0.0.1:${nextPort}`;
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), process.env.NEXT_MODE === "dev" ? "dev" : "start", "--hostname", "127.0.0.1", "--port", String(nextPort)], { cwd: ui, env, stdio: ["ignore", "pipe", "pipe"] });
  next.stdout.on("data", (chunk) => { log += chunk; }); next.stderr.on("data", (chunk) => { log += chunk; });
  const origin = `http://127.0.0.1:${nextPort}`;
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/connect/local`)).ok) break; } catch { /* bounded readiness check */ }
    if (attempt > 1800 || next.exitCode !== null) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await authorizeBrowser(page, origin, env);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const named = (name) => calls.filter((call) => call.name === name);
  await page.goto(`${origin}/fleet`);
  await page.locator('[data-node="bot:bot-1"]').waitFor();

  // A stopped Bot's live Chat routes to its retained history without starting it.
  const primaryChat = page.locator('[data-window="chat"]');
  await primaryChat.getByRole("button", { name: "Switch bot", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^bot-2 / }).click();
  await primaryChat.getByText("bot-2 is stopped", { exact: true }).waitFor();
  await primaryChat.getByRole("button", { name: "Read history", exact: true }).click();
  const history = page.locator('[data-window="bot-history"]');
  await history.getByRole("list", { name: "bot-2’s conversations" }).waitFor();
  assert.deepEqual(named("chat_list").at(-1).input, { botId: "bot-2", limit: 25, offset: 0 });
  assert.equal(await history.getByRole("combobox", { name: "Bots to search" }).inputValue(), "bot-2");
  await history.getByRole("button", { name: /^Read history: Main thread of bot-2 / }).click();
  await history.getByText("Thread 020 record 2", { exact: true }).waitFor();
  assert.deepEqual(named("chat_records").at(-1).input, { botId: "bot-2", threadId: id(20), afterLine: 0, limit: 50 });
  await page.getByRole("group", { name: "Fleet layout preset", exact: true }).getByRole("button", { name: "History", exact: true }).click();

  // Search every Bot: exact owners, a full page permits a next-page read, repeats are not listed twice.
  const scope = history.getByRole("combobox", { name: "Bots to search" });
  await scope.selectOption("");
  await history.getByRole("searchbox", { name: "Search Bot history" }).fill("deploy");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  const results = history.getByRole("list", { name: "Results for “deploy” in all Bots" });
  await results.waitFor();
  assert.deepEqual(named("chat_search").at(-1).input, { query: "deploy", limit: 25, offset: 0 }, "an all-Bots search omits botId");
  assert.equal(await results.getByRole("listitem").count(), 25);
  await history.getByText("<b>now</b>", { exact: false }).first().waitFor();
  assert.equal(await history.locator("b").count(), 0, "snippets render as text");
  await history.getByRole("button", { name: "Read next page", exact: true }).click();
  await history.getByText("1 conversation already listed appeared again on a later page and was not repeated.").waitFor();
  assert.equal(await results.getByRole("listitem").count(), 34);
  assert.equal(named("chat_search").at(-1).input.offset, 25);
  await history.getByText("No further results in this read.", { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, "history-results.png"), animations: "disabled" });

  // Refusal and an empty answer stay distinct.
  await history.getByRole("searchbox", { name: "Search Bot history" }).fill("refused please");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await history.getByText("Not permitted", { exact: true }).waitFor();
  assert.equal(await history.getByText(/matched “refused please”/).count(), 0);

  // A Bot-scoped search never asks for another Bot's history.
  await scope.selectOption("bot-1");
  await history.getByRole("list", { name: "Results for “refused please” in bot-1" }).or(history.getByText("Not permitted", { exact: true })).first().waitFor();
  await history.getByRole("searchbox", { name: "Search Bot history" }).fill("deploy");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await history.getByRole("list", { name: "Results for “deploy” in bot-1" }).waitFor();
  assert.equal(named("chat_search").at(-1).input.botId, "bot-1");
  assert.ok((await history.getByRole("list", { name: "Results for “deploy” in bot-1" }).locator("li").allInnerTexts()).every((text) => !text.includes("bot-2")));

  // Read a stopped Bot's descendant at its match, with the keyboard.
  await scope.selectOption("");
  await results.waitFor();
  const read = history.getByRole("button", { name: /^Read history: Deploy the fixture \(descendant\) \(bot-2, descendant\)/ });
  await read.focus();
  await page.keyboard.press("Enter");
  await history.locator('[data-line="41"]').waitFor();
  assert.deepEqual(named("chat_records").at(-1).input, { botId: "bot-2", threadId: id(21), afterLine: 32, limit: 50 });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-line")), "41", "the matched record takes focus");
  await history.getByText("Deployed.", { exact: false }).waitFor();
  await history.getByText("[image: chart]", { exact: true }).waitFor();
  await history.getByText("<script>window.__unsafe=2</script>", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__unsafe), undefined, "record content never executes");
  assert.equal(assetRequests, 0, "embedded remote assets are not fetched");

  // An oversized record loads explicitly through UTF-16 chunks.
  const big = history.locator('[data-line="45"]');
  await big.getByText("Too large for a page; its content is not shown.").waitFor();
  await big.getByRole("button", { name: "Load full record", exact: true }).click();
  await big.getByText(/^Showing 6,000 of/).waitFor();
  assert.deepEqual(named("chat_record_chunk").map((call) => call.input.offset), [0, 65_536, 131_072]);
  await big.getByRole("button", { name: "Show more", exact: true }).click();
  await big.getByText("TAIL-MARKER", { exact: false }).waitFor();

  // Earlier and later records continue by line.
  await history.getByRole("button", { name: "Read earlier records", exact: true }).click();
  await history.getByText("Start of the conversation", { exact: true }).waitFor();
  assert.deepEqual(named("chat_records").at(-1).input, { botId: "bot-2", threadId: id(21), afterLine: 0, limit: 50 });
  const end = history.getByText("End of the conversation as last read.", { exact: true });
  for (let pages = 0; !(await end.isVisible()) && pages < 5; pages++) {
    const later = named("chat_records").length;
    await history.getByRole("button", { name: "Read later records", exact: true }).click();
    while (named("chat_records").length === later) await page.waitForTimeout(20);
    await history.getByRole("button", { name: /^(Read later records|Check for newer records)$/ }).and(page.locator(":enabled")).waitFor();
  }
  await history.locator('[data-line="119"]').waitFor({ state: "attached" });
  await end.waitFor();

  // An invalidation fences continuation until the conversation is read again.
  served.get("bots").publish("chats_changed", "bot-2");
  await history.getByText(/History changed since these records were read/).waitFor();
  assert.equal(await history.getByRole("button", { name: "Check for newer records", exact: true }).isDisabled(), true);
  await history.getByRole("button", { name: "Read again", exact: true }).first().click();
  await history.getByText(/History changed since these records were read|Reading these records again/).waitFor({ state: "hidden" });
  // A fresh read starts again at the match; continuation is available once it lands.
  await history.getByRole("button", { name: "Read later records", exact: true }).and(page.locator(":enabled")).waitFor();
  assert.equal(await history.getByText("Start of the conversation", { exact: true }).count(), 0);
  await page.screenshot({ path: join(evidence, "history-reader.png"), animations: "disabled" });

  // A late answer for a conversation no longer selected never replaces the current one.
  const gate = Promise.withResolvers();
  gates.set(id(20), gate);
  await history.getByRole("button", { name: /^Read history: Main thread of bot-2 / }).click();
  await history.getByText("Reading the conversation…", { exact: true }).waitFor();
  await history.getByRole("button", { name: /^Read history: Main thread of bot-1 / }).click();
  await history.getByText("Thread 010 record 11", { exact: true }).waitFor();
  gates.delete(id(20)); gate.resolve();
  await page.waitForTimeout(300);
  assert.equal(await history.getByText("Thread 020 record 31", { exact: true }).count(), 0);

  // Missing history is shown as such, never as the main thread.
  await history.getByRole("button", { name: /^Read history: A thread whose history is gone / }).click();
  await history.getByText("History unavailable", { exact: true }).waitFor();
  assert.equal(await history.locator("[data-line]").count(), 0);

  // Closing hides the pane; reopening reads afresh.
  await history.getByRole("button", { name: /^Read history: Deploy the fixture/ }).click();
  await history.locator('[data-line="41"]').waitFor();
  const before = named("chat_records").length;
  await history.locator("header").first().getByRole("button", { name: "Close History", exact: true }).click();
  await revealPane(page, "Fleet", "bot-history");
  await history.locator('[data-line="41"]').waitFor();
  for (let attempt = 0; named("chat_records").length === before && attempt < 100; attempt++) await page.waitForTimeout(20);
  assert.ok(named("chat_records").length > before, "a shown pane reads afresh");

  // Removal: the reader keeps what it read, labelled, and stops reading.
  bots = bots.filter((item) => item.id !== "bot-2");
  served.get("bots").publish("bots_changed", "bot-2");
  await history.getByText("bot-2 no longer exists on this server.", { exact: false }).first().waitFor();
  assert.equal(await history.getByRole("button", { name: "Read again", exact: true }).isDisabled(), true);

  // Narrow: results and reader alternate; Back returns to the result.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(evidence, "history-narrow-reader.png"), fullPage: true, animations: "disabled" });
  await history.getByRole("button", { name: "Back to results", exact: true }).click();
  await results.waitFor();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: join(evidence, "history-narrow-results-dark.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // An operation the server does not expose is never called.
  botsDoc.transports[0].operations = botsDoc.transports[0].operations.filter((name) => name !== "chat_search");
  const searches = named("chat_search").length;
  await page.reload();
  await revealPane(page, "Fleet", "bot-history");
  await history.getByRole("searchbox", { name: "Search Bot history" }).fill("deploy");
  await history.getByRole("button", { name: "Search", exact: true }).click();
  await history.getByText("This server does not expose chat_search on its WebSocket.", { exact: false }).waitFor();
  assert.equal(named("chat_search").length, searches);

  assert.deepEqual(calls.filter((call) => forbidden.includes(call.name)), [], "History never starts a Bot or admits input");
  assert.deepEqual(errors, [], "browser has no uncaught application errors");
  console.log(JSON.stringify({ ok: true, evidence, reads: Object.fromEntries(["chat_search", "chat_list", "chat_records", "chat_record_chunk"].map((name) => [name, named(name).length])) }, null, 2));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: join(evidence, "failure.png"), animations: "disabled" }).catch(() => undefined);
  throw error;
} finally {
  for (const gate of gates.values()) gate.resolve();
  await browser?.close();
  if (next && next.exitCode === null) { next.kill("SIGTERM"); await new Promise((resolve) => next.once("exit", resolve)); }
  await websocket?.close();
  await Promise.all([...served.values()].map((socket) => socket.close()));
  await new Promise((resolve) => assets.close(resolve));
  if (process.env.HISTORY_EVIDENCE_DIR) await rm(dir, { recursive: true, force: true });
}
