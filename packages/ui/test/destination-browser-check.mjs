// Optional rendered check of Canvas destination isolation (ADR 0167) after pnpm test and a ui build. Platform roots are
// disposable state directories; each runs the real notify API behind fixture serve/bots/discovery sockets and its own
// `next start` on the SAME origin and port, one after another, so a single browser context shares one localStorage across them.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/destination-browser-check.mjs
// DESTINATION_EVIDENCE_DIR keeps a JSON inventory of the keys each phase left. CHROME_BIN may override local Chrome. No live server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { publishedJsonSchema, serveApi, serveSocket, serveWebSocket, socketCall, socketPath } from "@stack/api";
import { api as botsApi } from "../../bots/dist/api.js";
import { api as notifyApi } from "../../notify/dist/api.js";
import { destinationKey, fixtureDoc, fixtureOperations, freePort as port, gatewayRoot, root, ui, authorizeBrowser, serveFixture, seedRecovery } from "./browser-fixture.mjs";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Set PLAYWRIGHT_MODULE to an installed Playwright module");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const require = createRequire(import.meta.url);
const evidence = process.env.DESTINATION_EVIDENCE_DIR ?? await mkdtemp(join("/tmp", "di-evidence-"));
await mkdir(evidence, { recursive: true });

const idA = "7f3c1d52-9a64-4be1-8c0a-2d5e6f708192";
const idB = "0b9a4c1e-5d27-4f83-a1b6-93c70e2d8f45";
const nextPort = await port();
// Every platform keeps the same gateway endpoint too: Compose drafts are endpoint-pinned, so only the destination can separate them.
const gatewayPort = await port();
const origin = `http://127.0.0.1:${nextPort}`;
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (condition, what) => { for (let attempt = 0; attempt < 200 && !condition(); attempt++) await settle(50); assert.ok(condition(), what); };

/** One platform root: its own state directory, real notify API, fixtures, and a Next server on the shared origin. */
async function startPlatform(label, serverId) {
  const dir = await mkdtemp(join("/tmp", `di-${label}-`));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("STACK_"))), STACK_STATE_DIR: dir,
    NEXT_TELEMETRY_DISABLED: "1", STACK_WEBSOCKET_ORIGIN: origin, STACK_UI_PORT: String(nextPort) };
  let developerMode = false, settingsGate = null, settingsError = false;
  const handlers = {
    serve_settings_read: async () => {
      const gate = settingsGate;
      gate?.entered.resolve();
      await gate?.promise;
      if (settingsError) throw new Error("Settings unavailable");
      return { developerMode, revision: 1, updatedAt: null };
    },
    serve_status: () => ({ serverId, pid: process.pid, startedAt: new Date().toISOString(), nodeVersion: process.version, children: [], mcpUrls: {}, indexUrl: null, uiUrl: null, inspectorUrl: null }),
    bot_list: () => ({ bots: [{ id: "fixture-bot", state: "stopped", pid: null, cwd: "/fixture", url: null, account: null, runningAccount: null, mainThreadId: null, recoveryIssue: null, roleRevision: null, settings: null }] }),
    bot_defaults_get: () => ({ model: "fixture", reasoningEffort: "medium", sandboxMode: "danger-full-access", approvalPolicy: "never" }),
    voice_status: () => ({ call: null }),
  };
  const sockets = [];
  const notify = await serveApi({ name: "notify", transport: "socket", env, root });
  const websocket = await serveWebSocket({ env, root: await gatewayRoot(dir, ["notify", "serve", "bots", "api"]), port: gatewayPort });
  const doc = (name, api) => fixtureDoc(name, api, websocket.url, publishedJsonSchema);
  const catalog = [doc("notify", notifyApi), doc("bots", botsApi), doc("serve"), doc("api")];
  handlers.docs_snapshot = () => ({ packages: catalog });
  const serve = await serveFixture(handlers);
  Object.assign(handlers, serve.handlers);
  for (const [name, names, topics] of [["serve", serve.names, serve.topics], ["bots", botsApi.operations.map((operation) => operation.name), botsApi.events.topics], ["api", ["docs_snapshot"], {}]]) {
    sockets.push(await serveSocket({ info: { name, description: name, transportDescription: "Fixture", path: socketPath(name, env) }, context: {}, operations: fixtureOperations(name === "serve" ? serve.names : names, handlers),
      events: { topics, scope: name === "bots" ? { valid: () => true, description: "Fixture", example: "bot-1" } : undefined } }));
  }
  const notification = await socketCall(socketPath("notify", env), "tools/call", { name: "notification_send", arguments: { title: `Notice from ${label}`, message: `Held by platform ${label}.`, source: "fixture" } });
  // A dismissed notification whose content can be selected for clearing, so a state flow has something to prepare.
  const dismissed = await socketCall(socketPath("notify", env), "tools/call", { name: "notification_send", arguments: { title: `Dismissed from ${label}`, message: `Closed on platform ${label}.`, source: "fixture" } });
  await socketCall(socketPath("notify", env), "tools/call", { name: "notification_dismiss", arguments: { id: dismissed.id } });
  let log = "";
  const next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(nextPort)], { cwd: ui, env, stdio: ["ignore", "pipe", "pipe"] });
  next.stdout.on("data", (chunk) => { log = (log + chunk).slice(-12_000); }); next.stderr.on("data", (chunk) => { log = (log + chunk).slice(-12_000); });
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/connect/local`)).ok) break; } catch { /* bounded readiness check */ }
    if (attempt > 200 || next.exitCode !== null) throw new Error(log.split("\n").slice(-40).join("\n"));
    await settle(50);
  }
  return {
    label, env, notification,
    identify(id) { serverId = id; sockets[0].publish("pids_changed"); },
    developer(value, error = false) { developerMode = value; settingsError = error; sockets[0].publish("serve_settings_changed"); },
    holdSettings() {
      settingsGate = { ...Promise.withResolvers(), entered: Promise.withResolvers() };
      return settingsGate;
    },
    async stop() {
      settingsGate?.resolve();
      if (next.exitCode === null) { const exited = once(next, "exit"); next.kill(); await exited; }
      await websocket.close();
      for (const socket of sockets) await socket.close();
      await notify.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
let platform = null;
try {
  // One context, one page: the same browser storage serves every platform that answers at this origin.
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    window.paneStorageReads = [];
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.includes("uix.panes.v1.")) window.paneStorageReads.push(key);
      return read.call(this, key);
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /hydrat|did not match|#418|#423|#425/i.test(message.text())) problems.push(message.text()); });
  const receiptReads = [];
  const maintenance = [];
  await page.routeWebSocket(/\/websocket/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method === "tools/call" && request.params?.name === "notify_state_receipt_get") receiptReads.push(request.params.arguments.requestId);
      if (request.method === "tools/call" && ["notification_history_plan", "notification_history_clear"].includes(request.params?.name)) maintenance.push(request.params.name);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });

  const storage = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((name) => [name, localStorage.getItem(name)])));
  const owned = (all, id) => Object.fromEntries(Object.entries(all).filter(([name]) => name.startsWith(destinationKey(origin, "", { serverId: id }))));
  const compose = page.locator('[data-window="notify-compose"]');
  const title = compose.getByLabel("Title", { exact: true });
  const pin = page.getByRole("button", { name: "Pin inspector", exact: true });
  const inboxWindow = page.locator('[data-window="notify-inbox"]');
  const point = () => inboxWindow.evaluate((element) => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y }));
  const open = async (current) => {
    await authorizeBrowser(page, origin, current.env);
    await page.goto(`${origin}/inbox?inspect=notification:${current.notification.id}`);
    await inboxWindow.waitFor();
    await inboxWindow.locator("[data-notification]").first().waitFor();
  };
  // The Inbox's payload-clearing flow keeps its request under `notify:history`; showing it shows whether a saved request was recovered.
  const showClearFlow = async () => {
    await inboxWindow.getByRole("radio", { name: "Dismissed" }).or(inboxWindow.getByRole("button", { name: "Dismissed", exact: true })).click();
    await inboxWindow.getByRole("button", { name: /^Select to clear content/ }).click();
  };
  const readSaved = async () => {
    await inboxWindow.getByText("Result not confirmed").waitFor();
    await inboxWindow.getByRole("button", { name: "Read receipt", exact: true }).click();
    await until(() => receiptReads.includes(requestA.requestId), "the saved request is read back by its own id");
    assert.ok(receiptReads.every((id) => id === requestA.requestId), `only the destination's own request is ever dispatched: ${receiptReads}`);
  };
  const leave = async () => { await page.goto("about:blank"); await platform.stop(); platform = null; };
  const requestA = { planId: randomUUID(), expectedRevision: "rev-a", requestId: randomUUID() };
  const legacyRequest = { planId: randomUUID(), expectedRevision: "rev-legacy", requestId: randomUUID() };
  const legacy = {
    "stack.state-flow.notify:history": JSON.stringify({ input: legacyRequest, at: 1 }), "stack.uix.bench.v1": JSON.stringify({ space: "inbox", layout: { positions: { "notify-inbox": { x: 7, y: 7 } }, manual: { "notify-inbox": true } } }),
    "stack.uix.inspector.v1": JSON.stringify({ pinned: true }), "stack.uix.docks.v1": JSON.stringify({ inspector: 900 }), "stack.worker-catalog-held.v1": JSON.stringify(["legacy"]),
  };
  const report = {};
  const hud = page.getByRole("main", { name: "HUD panes", exact: true });
  const presets = hud.getByRole("group", { name: "HUD layout preset", exact: true });
  const paneKey = (id) => destinationKey(origin, "uix.panes.v1.hud", { serverId: id });
  const readLayout = (id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), paneKey(id));
  const waitLayout = (id, preset, closed = []) => page.waitForFunction(([key, preset, closed]) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    return saved?.preset === preset && JSON.stringify(saved.closed) === JSON.stringify(closed);
  }, [paneKey(id), preset, closed]);
  const openHud = async () => { await page.goto(`${origin}/`); await hud.waitFor(); };
  const hiddenPane = (id) => page.locator(`[data-pane-frame="${id}"]`).waitFor({ state: "hidden" });

  // ---- Platform A: arrange, pin, draft and leave an unconfirmed request; also seed unqualified legacy records ----
  platform = await startPlatform("a", idA);
  await open(platform);
  await title.waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-window="notify-compose"] input')?.disabled);
  const home = await point();
  await title.fill("Draft for A");
  await pin.click();
  assert.equal(await pin.getAttribute("aria-pressed"), "true");
  const header = await inboxWindow.locator("header").boundingBox();
  await page.mouse.move(header.x + 40, header.y + 20);
  await page.keyboard.down("Alt");
  await page.mouse.down(); await page.mouse.move(header.x + 130, header.y + 70, { steps: 4 }); await page.mouse.up();
  await page.keyboard.up("Alt");
  const moved = await point();
  assert.ok(Math.abs(moved.x - home.x) > 20, `the window moved ${JSON.stringify(home)} -> ${JSON.stringify(moved)}`);
  const prefixA = destinationKey(origin, "", { serverId: idA });
  await page.waitForFunction(([name, window]) => JSON.parse(localStorage.getItem(name) ?? "{}").layout?.manual?.[window] === true, [`${prefixA}uix.bench.v2.inbox`, "notify-inbox"]);
  await page.waitForFunction((name) => localStorage.getItem(name) !== null, `${prefixA}uix.inspector.v1`);
  await page.waitForFunction((prefix) => Object.keys(localStorage).some((name) => name.startsWith(`${prefix}uix.notify-compose.v1.`)), prefixA);
  await seedRecovery(page, origin, "notify:history", requestA, { serverId: idA });
  await page.evaluate((records) => { for (const [name, value] of Object.entries(records)) localStorage.setItem(name, value); }, legacy);
  await page.reload();
  await inboxWindow.waitFor();
  await showClearFlow();
  await readSaved();
  let all = await storage();
  assert.ok(Object.keys(all).every((name) => name.startsWith("stack.destination.") || name in legacy), `only namespaced keys (and the seeded legacy ones) exist: ${Object.keys(all)}`);
  const aKeys = Object.keys(owned(all, idA));
  for (const name of ["uix.bench.v2.inbox", "uix.inspector.v1", "state-flow.notify:history"]) assert.ok(aKeys.includes(`${prefixA}${name}`), `${name} is stored under A`);
  assert.ok(aKeys.some((name) => name.startsWith(`${prefixA}uix.notify-compose.v1.`)), "the Compose draft is stored under A");
  for (const [name, value] of Object.entries(legacy)) assert.equal(all[name], value, `${name} is untouched`);
  await openHud();
  await presets.getByRole("button", { name: "Focus", exact: true }).click();
  await waitLayout(idA, "focus");
  await page.evaluate((key) => {
    document.querySelector('[aria-label="Close Work"]').click();
    window.addEventListener("pagehide", () => {
      sessionStorage.setItem("fixture-pane-exit", localStorage.getItem(key));
    }, { once: true });
    location.assign("about:blank");
  }, paneKey(idA));
  await page.waitForURL("about:blank");
  await openHud();
  await hiddenPane("hud-work");
  const paneA = await readLayout(idA);
  assert.equal(paneA.preset, "focus");
  assert.deepEqual(paneA.closed, ["hud-work"], "leaving immediately after close flushes the committed edit");
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-pane-exit"))), paneA, "the final layout was recorded before pagehide finished");
  assert.equal(await presets.getByRole("button", { name: "Focus", exact: true }).getAttribute("aria-pressed"), "true");
  all = await storage();
  report.afterA = Object.keys(all);
  report.paneA = paneA;
  const snapshotA = owned(all, idA);
  assert.deepEqual(problems, [], "no hydration or page errors on platform A");
  await leave();

  // ---- Platform B: another root at the same origin sees none of it ----
  platform = await startPlatform("b", idB);
  receiptReads.length = 0;
  await open(platform);
  await title.waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-window="notify-compose"] input')?.disabled);
  await settle(1200);
  assert.equal(await title.inputValue(), "", "A's draft is not B's");
  assert.equal(await pin.getAttribute("aria-pressed"), "false", "A's inspector pin is not B's");
  assert.ok(Math.abs((await point()).x - home.x) < 2 && Math.abs((await point()).y - home.y) < 2, "A's bench arrangement is not B's");
  // Pin first: an unpinned inspector contracts on any other interaction with the bench.
  await pin.click();
  const prefixB = destinationKey(origin, "", { serverId: idB });
  await page.waitForFunction((name) => JSON.parse(localStorage.getItem(name) ?? "{}").pinned === true, `${prefixB}uix.inspector.v1`);
  await title.fill("Draft for B");
  await page.waitForFunction((prefix) => Object.keys(localStorage).some((name) => name.startsWith(`${prefix}uix.notify-compose.v1.`)), prefixB);
  await showClearFlow();
  await inboxWindow.getByRole("button", { name: /^Prepare clearing/ }).waitFor();
  assert.equal(await inboxWindow.getByText("Result not confirmed").count(), 0, "A's unconfirmed request is not B's");
  assert.deepEqual(receiptReads, [], "nothing stored for A or in legacy form is dispatched to B");
  // Named, the same flow prepares a plan for a selected dismissed notification and offers to apply it (then it is discarded).
  await inboxWindow.getByRole("checkbox", { name: /^Select Dismissed from b/ }).check();
  await inboxWindow.getByRole("button", { name: "Prepare clearing 1 notification" }).click();
  await inboxWindow.getByRole("button", { name: "Clear this content" }).waitFor();
  assert.deepEqual(maintenance, ["notification_history_plan"], "a named destination prepares its plan");
  await inboxWindow.getByRole("button", { name: "Discard plan" }).click();
  maintenance.length = 0;
  await openHud();
  await waitLayout(idB, "triage");
  assert.equal(await page.locator('[data-pane-frame="hud-work"]').isVisible(), true, "B does not restore A's closed pane");
  await presets.getByRole("button", { name: "Board", exact: true }).click();
  await waitLayout(idB, "board");
  const paneB = await readLayout(idB);
  all = await storage();
  assert.deepEqual(owned(all, idA), snapshotA, "B never read, wrote, merged or removed anything of A's");
  for (const [name, value] of Object.entries(legacy)) assert.equal(all[name], value, `${name} is still untouched`);
  assert.ok(Object.keys(owned(all, idB)).length >= 2, "B keeps its own state under its own namespace");
  report.afterB = Object.keys(all);
  assert.deepEqual(problems, [], "no hydration or page errors on platform B");
  await leave();

  // ---- A server that has not named itself: nothing is read, written or recovered ----
  platform = await startPlatform("unnamed", null);
  receiptReads.length = 0;
  maintenance.length = 0;
  const kept = all;
  await open(platform);
  await inboxWindow.locator("[data-notification]").first().waitFor();
  await page.getByText(/Waiting for the server to name itself/).first().waitFor();
  await settle(1200);
  const before = await storage();
  assert.deepEqual(before, kept, "loading under an unnamed destination wrote nothing");
  assert.equal(await title.isDisabled(), true, "Compose cannot be used, so nothing is sent without a place to record it");
  await pin.click();
  const unnamedHeader = await inboxWindow.locator("header").boundingBox();
  await page.mouse.move(unnamedHeader.x + 40, unnamedHeader.y + 20);
  await page.keyboard.down("Alt");
  await page.mouse.down(); await page.mouse.move(unnamedHeader.x + 90, unnamedHeader.y + 50, { steps: 3 }); await page.mouse.up();
  await page.keyboard.up("Alt");
  await settle(1500);
  assert.deepEqual(await storage(), before, "an unnamed destination writes nothing");
  await showClearFlow();
  await inboxWindow.getByRole("button", { name: /^Prepare clearing/ }).waitFor();
  assert.equal(await inboxWindow.getByText("Result not confirmed").count(), 0, "and recovers nothing");
  assert.deepEqual(receiptReads, [], "nor reads any stored request back");
  // A state flow saves its request before sending it, so with nowhere to save it the flow cannot even prepare: its control is
  // disabled and says why, and nothing reaches the owner.
  await inboxWindow.getByRole("checkbox", { name: /^Select Dismissed from unnamed/ }).check();
  const prepare = inboxWindow.getByRole("button", { name: "Prepare clearing 1 notification" });
  assert.equal(await prepare.isDisabled(), true, "a flow that cannot record its request cannot be prepared");
  await inboxWindow.getByText("Waiting for the server to name itself…", { exact: true }).waitFor();
  await prepare.click({ force: true, timeout: 1000 }).catch(() => {});
  await settle(500);
  assert.deepEqual(maintenance, [], "no plan or apply is sent");
  assert.equal(await inboxWindow.getByRole("button", { name: "Clear this content" }).count(), 0);
  assert.deepEqual(await storage(), before, "and nothing is recorded");
  await openHud();
  await presets.getByRole("button", { name: "Board", exact: true }).click();
  await hud.getByRole("button", { name: "Close Work", exact: true }).click();
  await hiddenPane("hud-work");
  await settle(400);
  assert.deepEqual(await page.evaluate(() => window.paneStorageReads), [], "unknown identity reads no saved pane layouts");
  assert.deepEqual(await storage(), before, "unknown identity keeps pane edits in memory only");
  const lateId = "ab8e0c19-7183-46bb-b9e5-97de92fa405a";
  platform.identify(lateId);
  await waitLayout(lateId, "board", ["hud-work"]);
  assert.equal(await page.locator('[data-pane-frame="hud-work"]').isVisible(), false, "first identity without a saved layout retains page-local work");
  platform.identify(idA);
  await hiddenPane("hud-work");
  await page.waitForFunction((key) => window.paneStorageReads.includes(key), paneKey(idA));
  assert.deepEqual(await readLayout(idA), paneA, "live destination replacement restores A rather than copying the unnamed page's work");
  platform.identify(idB);
  await page.locator('[data-pane-frame="hud-work"]').waitFor();
  await page.waitForFunction((key) => window.paneStorageReads.includes(key), paneKey(idB));
  assert.equal(await presets.getByRole("button", { name: "Board", exact: true }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(await readLayout(idB), paneB);
  assert.deepEqual(await readLayout(idA), paneA, "retired destination writes never overwrite A");
  platform.identify(null);
  await openHud();
  await presets.getByRole("button", { name: "Triage", exact: true }).click();
  await hud.getByRole("button", { name: "Close Timeline", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.paneStorageReads), [], "a fresh unnamed page does not read an existing save");
  platform.identify(idA);
  await page.waitForFunction((key) => window.paneStorageReads.includes(key), paneKey(idA));
  await hiddenPane("hud-work");
  await settle(400);
  assert.equal(await presets.getByRole("button", { name: "Focus", exact: true }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(await readLayout(idA), paneA, "first late identity restores an existing save before an unnamed edit can overwrite it");
  assert.deepEqual(problems, [], "no hydration or page errors with no identity or live replacement");
  await leave();

  // ---- A again: the same installation restores exactly what it saved, and reads its own request back ----
  platform = await startPlatform("a-again", idA);
  receiptReads.length = 0;
  await open(platform);
  await title.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-window="notify-compose"] input')?.value === "Draft for A");
  await page.waitForFunction(() => document.querySelector('[aria-label="Pin inspector"]')?.getAttribute("aria-pressed") === "true");
  await showClearFlow();
  await readSaved();
  const restored = await point();
  assert.ok(Math.abs(restored.x - moved.x) < 2 && Math.abs(restored.y - moved.y) < 2, `A's arrangement is restored ${JSON.stringify(moved)} -> ${JSON.stringify(restored)}`);
  assert.deepEqual(problems, [], "no hydration or page errors on A again");
  await openHud();
  await hiddenPane("hud-work");
  assert.deepEqual(await readLayout(idA), paneA);
  for (const kind of ["unavailable", "quota"]) {
    const blocked = await context.newPage();
    blocked.on("pageerror", (error) => problems.push(error.message));
    await blocked.addInitScript((kind) => {
      if (kind === "unavailable") Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
      else {
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.includes("uix.panes.v1.")) throw new DOMException("Full", "QuotaExceededError");
          return write.call(this, key, value);
        };
      }
    }, kind);
    await blocked.goto(`${origin}/`);
    const host = blocked.getByRole("main", { name: "HUD panes", exact: true });
    await host.getByRole("button", { name: "Triage", exact: true }).click();
    await host.getByRole("button", { name: "Close Work", exact: true }).click();
    await host.getByText(/could not save the layout/).waitFor();
    await host.getByRole("button", { name: "Undo close", exact: true }).click();
    await blocked.locator('[data-pane-frame="hud-work"]').waitFor();
    await host.getByText(/could not save the layout/).waitFor();
    await blocked.close();
    assert.deepEqual(await readLayout(idA), paneA, `${kind} storage leaves the saved layout untouched while close/undo work in memory`);
  }
  assert.deepEqual(problems, [], "storage denial does not crash the page");
  const revealPane = async (host, space, id) => {
    await host.getByRole("button", { name: /^Panes/ }).click();
    await page.getByRole("combobox", { name: `Find a pane in ${space}`, exact: true }).fill(id);
    await page.keyboard.press("Enter");
  };
  await page.goto(`${origin}/fleet`);
  await page.locator('[data-window="chat"]').waitFor();
  const fleet = page.getByRole("main", { name: "Fleet panes", exact: true });
  if (await fleet.count()) {
    await page.locator('[data-window="chat"]').getByRole("button", { name: "New chat window", exact: true }).click();
    const chat = page.locator('[data-window="chat-2"]');
    await chat.getByRole("button", { name: "Switch bot", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^fixture-bot/ }).click();
    await chat.getByText("fixture-bot is stopped", { exact: true }).waitFor();
    await page.getByRole("navigation", { name: "Canvas spaces" }).getByRole("link", { name: "Fleet", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("focus"), null, "cold layout restore must not request a deep-link reveal");
    await chat.getByRole("button", { name: "Close fixture-bot", exact: true }).click();
    const key = destinationKey(origin, "uix.panes.v1.fleet", { serverId: idA });
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? "{}").closed?.includes("chat-2"), key);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.reload();
    await fleet.waitFor();
    await page.waitForFunction((key) => window.paneStorageReads.includes(key), key);
    await settle(400);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), saved, `dynamic instance restoration precedes layout reconciliation (${page.url()})`);
    await revealPane(fleet, "Fleet", "chat-2");
    await chat.getByText("fixture-bot is stopped", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-pane-frame="chat-2"]').count(), 1, "reopening reuses the restored binding without duplicating it");
    report.dynamicRestore = "passed";
  } else report.dynamicRestore = "skipped: Fleet still uses Bench";

  platform.developer(true);
  await page.goto(`${origin}/system`);
  const server = page.locator('[data-window="server"]');
  await server.waitFor();
  const system = page.getByRole("main", { name: "System panes", exact: true });
  if (await system.count()) {
    await server.getByRole("switch", { name: "Developer mode" }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-window="server"] [role="switch"]')?.getAttribute("aria-checked") === "true");
    await revealPane(system, "System", "developer");
    await page.getByRole("button", { name: "Close Developer", exact: true }).click();
    const key = destinationKey(origin, "uix.panes.v1.system", { serverId: idA });
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? "{}").closed?.includes("developer"), key);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    const gate = platform.holdSettings();
    await page.reload();
    await server.getByText("Reading the current setting…", { exact: true }).waitFor();
    await gate.entered.promise;
    await settle(400);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), saved, "unknown registration cannot erase the saved Developer pane");
    gate.resolve();
    await page.waitForFunction(() => document.querySelector('[data-window="server"] [role="switch"]')?.getAttribute("aria-checked") === "true");
    await settle(400);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), saved, "a delayed known registration restores the saved closed state");
    platform.developer(true, true);
    await server.getByText("Unknown: Settings unavailable", { exact: true }).waitFor();
    await settle(400);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), saved, "a failed settings read is not confirmed removal");
    platform.developer(true);
    await page.waitForFunction(() => document.querySelector('[data-window="server"] [role="switch"]')?.getAttribute("aria-checked") === "true");
    await revealPane(system, "System", "developer");
    await page.getByRole("button", { name: "Close Developer", exact: true }).waitFor();
    platform.developer(false);
    await page.locator('[data-pane-frame="developer"]').waitFor({ state: "detached" });
    await page.waitForFunction((key) => !localStorage.getItem(key)?.includes('"developer"'), key);
    report.conditionalRegistry = "passed";
  } else report.conditionalRegistry = "skipped: System still uses Bench";
  assert.deepEqual(problems, [], "restoring registrations has no page errors");
  report.final = Object.keys(await storage());
  await writeFile(join(evidence, "destination-keys.json"), JSON.stringify({ origin, idA, idB, legacy: Object.keys(legacy), ...report }, null, 2));
  console.log(`destination isolation check passed; evidence in ${evidence}`);
} finally {
  await browser.close();
  await platform?.stop();
}
