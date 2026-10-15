// Optional rendered check of the HUD space. The real HUD API runs against a disposable state
// directory; server, auth, worker, bots, usage and discovery are fixtures. Worker associations
// come from a fixture worker_work_list: one Worker with turns on two different Work items.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/hud-browser-check.mjs
// CHROME_BIN may override the local headless Chrome executable. HUD_NEXT=start uses a prior `next build`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { publishedJsonSchema, serveApi, serveSocket, serveWebSocket, socketCall, socketPath } from "@stack/api";
import { api as botsApi } from "../../bots/dist/api.js";
import { api as hudApi } from "../../hud/dist/api.js";
import { authorizeBrowser, fixtureDoc, fixtureOperations, freePort as port, gatewayRoot, root, ui, serveFixture, fixtureServerId } from "./browser-fixture.mjs";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Set PLAYWRIGHT_MODULE to an installed Playwright module");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const require = createRequire(import.meta.url);
const dir = await mkdtemp(join("/tmp", "as-hud-ui-"));
const evidence = process.env.HUD_EVIDENCE_DIR ?? join(dir, "evidence");
await mkdir(evidence, { recursive: true });
const env = { ...process.env, STACK_STATE_DIR: dir, NEXT_TELEMETRY_DISABLED: "1" };
const now = Date.now();
const lateModel = "late-hidden-resource-proof", lateFrame = Promise.withResolvers();
let heldResources = null;
let activeCall = null;
const resourceGates = [];
const bounded = (promise, timeout = 10_000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("Resource proof did not reach its transport barrier")), timeout).unref())]);

const ids = { epic: randomUUID(), design: randomUUID(), implement: randomUUID(), spike: randomUUID(), pilot: randomUUID(), salvage: randomUUID() };
const worker = "22222222-0000-4000-8000-000000000001";
const account = "33333333-0000-4000-8000-000000000001";
const turns = { implement: "44444444-0000-4000-8000-000000000001", design: "44444444-0000-4000-8000-000000000002" };
const admission = (turnId, workItemId, scopeRevision, turnPhase, current) => ({ sequence: current ? 2 : 1, workerId: worker, turnId,
  context: { workItemId, scopeRevision, source: current ? "explicit" : "focus" }, botId: "bot-1", threadId: "main-bot-1", accountId: account,
  provider: "codex", model: "gpt-5.6-sol", effort: "medium", workerPhase: "running", turnPhase, current, createdAt: now - (current ? 60_000 : 3_600_000), updatedAt: now });
const session = { id: worker, botId: "bot-1", threadId: "main-bot-1", accountId: account, provider: "codex", model: "gpt-5.6-sol", effort: "medium",
  repo: "/fixture/stack", cwd: "/fixture/worktrees/hud", branch: "worktree/hud", baseCommit: null, sourceDirty: false, roleId: null, roleRevision: null,
  sessionId: null, runtimeInstance: null, phase: "running", currentTurnId: turns.design, issue: null, createdAt: now - 3_600_000, updatedAt: now,
  turn: { id: turns.design, phase: "running", stopReason: null, issue: null, dispatchedAt: now, createdAt: now, updatedAt: now,
    workContext: { workItemId: ids.design, scopeRevision: 1, source: "explicit" } }, pendingPermissions: 0 };

const handlers = {
  serve_status: () => ({ serverId: fixtureServerId, pid: process.pid, children: [], mcpUrls: {}, indexUrl: null, uiUrl: null, inspectorUrl: null }),
  serve_resource_history: () => ({ snapshots: [], nextCursor: null }),
  // The gateway admits serve only with every operation its manifest selects; this check reads none of them.
  serve_codex_tools: () => { throw new Error("not observed in this fixture"); },
  serve_codex_tools_check: () => { throw new Error("not observed in this fixture"); },
  serve_resources: () => ({ observation: { snapshotId: null, capturedAt: null, ageMs: null, freshness: "unavailable", lastAttemptAt: null, error: "server_missing", source: "unsupported", intervalMs: 5_000, staleAfterMs: 15_000, collectionDurationMs: null, coverage: null },
    host: null, capabilities: { rssBytes: false, virtualBytes: false, cpuTimeMs: false, cpuPercent: false, threads: false, diskIoBytes: false, openFileDescriptors: false, networkBytes: false, gpu: false, perSessionAllocation: false },
    retention: { maxSamples: 0, maxProcessRecords: 0, retainedSamples: 0, oldestAttemptAt: null, newestAttemptAt: null, droppedSamples: 0 }, runtime: null,
    scopes: [], processes: [], page: { offset: 0, limit: 100, total: 0, nextOffset: null } }),
  account_list: () => ({ accounts: [] }), worker_account_list: () => ({ accounts: [] }),
  account_login_current: () => ({ login: null }), worker_account_login_current: () => ({ logins: [] }),
  bot_list: () => ({ bots: [{ id: "bot-1", state: "running", pid: 321, cwd: "/fixture/workspace", url: null, account: null, runningAccount: null, mainThreadId: "main-bot-1", recoveryIssue: null, roleRevision: null, settings: null }] }),
  bot_defaults_get: () => ({ model: "fixture", reasoningEffort: "medium", sandboxMode: "danger-full-access", approvalPolicy: "never" }),
  voice_status: () => ({ call: activeCall }), chat_list: () => ({ chats: [] }), chat_thread_read: () => ({ messages: [] }), chat_records: () => ({ records: [] }),
  worker_list: () => ({ workers: [session] }), worker_runtime_list: () => ({ runtimes: [] }),
  worker_work_list: async ({ workItemId }) => {
    if (workItemId === ids.salvage) throw new Error("worker owner unavailable");
    const entries = workItemId === ids.implement ? [admission(turns.implement, ids.implement, 1, "completed", false)]
      : workItemId === ids.design ? [admission(turns.design, ids.design, 1, "running", true)] : [];
    if (heldResources?.id === workItemId) {
      const gate = heldResources; heldResources = null;
      gate.admitted.resolve();
      await gate.promise;
      if (gate.model) entries[0].model = gate.model;
    }
    return { entries, nextCursor: null };
  },
  usage_snapshot: () => ({ atMs: now, inventoryAtMs: now, inventoryError: null, accounts: [] }),
};
const sockets = new Map();
let websocket, next, browser, hud;
let log = "";
const call = (name, args) => socketCall(socketPath("hud", env), "tools/call", { name, arguments: args });
const get = (id) => call("work_get", { id });

try {
  const serve = await serveFixture(handlers);
  Object.assign(handlers, serve.handlers);
  const definitions = { serve: serve.names, auth: ["account_list", "worker_account_list", "account_login_current", "worker_account_login_current"],
    worker: ["worker_list", "worker_runtime_list", "worker_work_list"], bots: ["bot_list", "bot_defaults_get", "voice_status", "chat_list", "chat_thread_read", "chat_records"], usage: ["usage_snapshot"], api: ["docs_snapshot"] };
  const topics = { serve: serve.topics,
    auth: { accounts_changed: "Fixture", login_changed: "Fixture", worker_accounts_changed: "Fixture", worker_login_changed: "Fixture" },
    worker: { workers_changed: "Fixture" }, bots: botsApi.events.topics, usage: { usage_changed: "Fixture" }, api: {} };
  for (const [name, names] of Object.entries(definitions)) {
    sockets.set(name, await serveSocket({ info: { name, description: name, transportDescription: "Fixture", path: socketPath(name, env) }, context: {},
      operations: fixtureOperations(names, handlers), events: { topics: topics[name], scope: name === "bots" ? { valid: () => true, description: "Fixture", example: "bot-1" } : undefined } }));
  }
  hud = await serveApi({ name: "hud", transport: "socket", env, root });
  websocket = await serveWebSocket({ env, root: await gatewayRoot(dir, ["hud", "serve", "auth", "worker", "bots", "usage", "api"], ["bots", "worker"]), port: 0 });
  const doc = (name, api) => fixtureDoc(name, api, websocket.url, publishedJsonSchema);
  handlers.docs_snapshot = () => ({ packages: [doc("hud", hudApi), doc("bots", botsApi), doc("serve"), doc("auth"), doc("worker"), doc("usage"), doc("api")] });

  // A nested breakdown with a dependency, a closed spike, and open work under cancelled work.
  await call("work_batch", { requestId: randomUUID(), changes: [
    { action: "create", id: ids.epic, title: "Ship the HUD", objective: "One truthful view of shared work", state: "active", attention: "human", nextAction: "Review the design", priority: "high" },
    { action: "create", id: ids.design, parentId: ids.epic, order: 0, title: "Design the space", objective: "Information architecture", state: "review" },
    { action: "create", id: ids.implement, parentId: ids.epic, order: 10, title: "Implement windows", objective: "Build the windows", state: "active", dependencies: [ids.design] },
    { action: "create", id: ids.spike, parentId: ids.epic, order: 20, title: "Old spike", objective: "Try an approach", state: "completed" },
    { action: "create", id: ids.pilot, title: "Cancelled pilot", objective: "Pilot", state: "cancelled" },
    { action: "create", id: ids.salvage, parentId: ids.pilot, title: "Salvage notes", objective: "Keep what we learned", state: "active" },
  ] });
  // A result recorded against the first objective, then a new objective: the result stays, marked as earlier scope.
  await call("work_note_add", { requestId: randomUUID(), id: ids.implement, expectedRevision: 1, kind: "result", body: "First cut of the tree window" });
  await call("work_update", { requestId: randomUUID(), id: ids.implement, expectedRevision: 2, patch: { objective: "Build the windows and their tests" } });
  await call("work_metadata_set", { requestId: randomUUID(), id: ids.implement, expectedRevision: 3, namespace: "correlation", value: { marker: "meta-marker-value" } });

  const nextPort = await port();
  env.STACK_WEBSOCKET_ORIGIN = `http://127.0.0.1:${nextPort}`;
  const mode = process.env.HUD_NEXT === "start" ? "start" : "dev";
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), mode, "--hostname", "127.0.0.1", "--port", String(nextPort)], { cwd: ui, env, stdio: ["ignore", "pipe", "pipe"] });
  next.stdout.on("data", (chunk) => { log += chunk; }); next.stderr.on("data", (chunk) => { log += chunk; });
  const origin = `http://127.0.0.1:${nextPort}`;
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/connect/local`)).ok) break; } catch { /* bounded readiness check */ }
    if (attempt > 2400 || next.exitCode !== null) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const context = await browser.newContext({ viewport: { width: 2400, height: 1300 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => { if (payload.toString().includes(lateModel)) lateFrame.resolve(); }));
  await authorizeBrowser(page, origin, env);
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { errors.push(`dialog: ${dialog.message()}`); void dialog.dismiss(); });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${origin}/`);
  const tree = page.locator('[data-window="hud-work"]');
  const item = page.locator('[data-window="hud-item"]');
  const timeline = page.locator('[data-window="hud-timeline"]');
  const resources = page.locator('[data-window="hud-resources"]');
  const attention = page.locator('[data-window="hud-attention"]');
  const row = (id) => tree.locator(`[data-node="work-item:${id}"]`);
  // A row's select button is named by its state word, then its title; its other buttons expand or focus.
  const pick = (id, title) => row(id).getByRole("button", { name: new RegExp(`^(Planned|Active|Blocked|Waiting|Paused|Review|Completed|Cancelled) ${title}`) });

  // The open view keeps a closed ancestor as context and says what it hid; nothing is re-parented.
  await row(ids.implement).waitFor();
  await row(ids.salvage).waitFor();
  assert.equal(await row(ids.spike).count(), 0, "closed work is hidden in the open view");
  await tree.getByText(/1 closed item hidden/).waitFor();
  assert.match(await row(ids.pilot).getAttribute("class"), /opacity-55/, "the cancelled parent shows as context");
  await tree.getByText("1 unmet dependency").waitFor();
  await attention.getByText("Needs a human · 1").waitFor();
  await attention.getByText("In review · 1").waitFor();
  await page.screenshot({ path: join(evidence, "hud-overview.png"), animations: "disabled" });
  assert.ok(!(await page.locator("body").innerText()).includes("meta-marker-value"), "agent metadata stays out of the ordinary view");

  // Selecting work fills the detail, history and resources.
  await pick(ids.implement, "Implement windows").click();
  await item.getByText("Build the windows and their tests").waitFor();
  await timeline.getByText("First cut of the tree window").waitFor();
  await timeline.getByText(/Recorded for scope 1/).waitFor();
  // One Worker, two items: this item keeps its completed historical turn; its latest turn is elsewhere.
  await resources.getByText("turn 44444444").waitFor();
  await resources.getByText(/Admitted for scope 1; now 2/).waitFor();
  await resources.getByText(/Its latest turn is/).waitFor();
  await resources.getByText("Design the space").waitFor();
  await page.screenshot({ path: join(evidence, "hud-item.png"), animations: "disabled" });

  // Concurrent edit: an agent changes the objective while the human drafts; the draft survives the conflict.
  await item.getByRole("button", { name: "Edit objective" }).click();
  const objective = item.getByRole("textbox", { name: "Objective" });
  await objective.fill("Human draft objective");
  const heldDraft = await objective.elementHandle();
  const retained = async (operation) => {
    assert.equal(await objective.inputValue(), "Human draft objective", `${operation} preserves the unsaved objective`);
    assert.equal(await objective.evaluate((element, original) => element === original, heldDraft), true, `${operation} retains the mounted editor`);
  };
  const layouts = page.locator('[aria-label="HUD layout preset"]');
  for (const preset of ["Focus", "Board", "Triage"]) {
    await layouts.getByRole("button", { name: preset, exact: true }).click();
    await retained(preset);
  }
  const arrange = async (side, target) => {
    await item.getByRole("button", { name: "Arrange Implement windows", exact: true }).click();
    await page.getByRole("menuitem", { name: side, exact: true }).hover();
    await page.getByRole("menu", { name: side, exact: true }).getByRole("menuitem", { name: target, exact: true }).click();
  };
  await arrange("Move below", "Work");
  await page.waitForFunction(() => {
    const item = document.querySelector('[data-pane-frame="hud-item"]').getBoundingClientRect();
    const work = document.querySelector('[data-pane-frame="hud-work"]').getBoundingClientRect();
    return item.top >= work.bottom && Math.abs(item.left - work.left) < 1;
  }, undefined, { timeout: 10_000 });
  await retained("moving between split parents");
  await arrange("Stack with", "Timeline");
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  assert.equal(await objective.isVisible(), false);
  await page.getByRole("tab", { name: "Work item", exact: true }).click();
  await retained("tab switch");
  await item.getByRole("button", { name: "Zoom Implement windows", exact: true }).click();
  assert.equal(await page.locator('[data-pane-frame]:visible').count(), 1);
  await item.getByRole("button", { name: "Close Implement windows", exact: true }).click();
  assert.equal(await objective.isVisible(), false);
  await page.getByRole("button", { name: "Undo close", exact: true }).click();
  await retained("close and undo");
  await item.getByRole("button", { name: "Restore Implement windows", exact: true }).click();
  await item.getByRole("button", { name: "Close Implement windows", exact: true }).click();
  await page.getByRole("button", { name: "Panes 1 closed", exact: true }).click();
  await page.getByRole("combobox", { name: "Find a pane in HUD" }).fill("hud-item");
  await page.keyboard.press("Enter");
  await retained("catalog reopen");
  await page.setViewportSize({ width: 420, height: 900 });
  await retained("compact projection");
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, undefined, { timeout: 2000 });
  await page.screenshot({ path: join(evidence, "hud-pane-draft-narrow.png"), animations: "disabled" });
  await page.setViewportSize({ width: 2400, height: 1300 });
  await page.getByRole("navigation", { name: "Canvas spaces" }).getByRole("link", { name: "Fleet", exact: true }).click();
  assert.equal(await objective.isVisible(), false);
  await page.getByRole("navigation", { name: "Canvas spaces" }).getByRole("link", { name: "HUD", exact: true }).click();
  await retained("space switch");
  await page.getByRole("button", { name: "Reset pane layout", exact: true }).click();
  await timeline.waitFor({ state: "visible" });
  await retained("reset after rearrangement");
  const paneHost = page.locator('[data-canvas="workbench"][data-space="hud"]');
  const frames = paneHost.locator('[data-pane-frame]:visible');
  assert.deepEqual(await frames.evaluateAll((elements) => elements.map((element) => element.dataset.paneFrame)), ["hud-attention", "hud-work", "hud-item", "hud-timeline", "hud-resources"], "reading order follows the composed columns");
  await objective.focus();
  await page.keyboard.press("Control+b");
  assert.equal(await objective.inputValue(), "Human draft objective", "the pane leader does not intercept an editor");
  await paneHost.focus();
  await page.keyboard.press("Control+b");
  await page.keyboard.press("3");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-pane-frame") === "hud-item");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(() => ["hud-attention", "hud-work"].includes(document.activeElement?.getAttribute("data-pane-frame")));
  const separator = paneHost.getByRole("separator", { name: "Resize pane split" }).first();
  await separator.focus();
  const fraction = Number(await separator.getAttribute("aria-valuenow"));
  await page.keyboard.press((await separator.getAttribute("aria-orientation")) === "vertical" ? "ArrowRight" : "ArrowDown");
  await page.waitForFunction(({ fraction, space }) => Number(document.querySelector(`[data-space="${space}"] [role="separator"]`)?.getAttribute("aria-valuenow")) > fraction, { fraction, space: "hud" });
  await page.keyboard.press("Home");
  await paneHost.focus();
  await page.keyboard.press("Control+b");
  await page.keyboard.press("9");
  assert.equal(new URL(page.url()).pathname, "/", "an absent pane number never falls through to space navigation");
  await retained("keyboard focus and separator resize");
  const geometry = () => frames.evaluateAll((elements) => elements.map((element) => { const { x, y, width, height } = element.getBoundingClientRect(); return [element.dataset.paneFrame, x, y, width, height].map((value) => typeof value === "number" ? Math.round(value) : value); }));
  const beforeDrag = await geometry();
  const header = await item.locator("header").first().boundingBox(), target = await timeline.boundingBox();
  const drag = async () => {
    await page.mouse.move(header.x + header.width / 2, header.y + header.height - 6);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
  };
  await drag();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await geometry(), beforeDrag, "Escape cancels a captured drag without changing the arrangement");
  await drag();
  await page.mouse.up();
  await page.getByRole("tab", { name: "Timeline", exact: true }).waitFor();
  await retained("pointer docking across parents");
  await page.getByRole("tab", { name: "Work item", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-selected") === "true" && document.activeElement?.textContent === "Timeline");
  assert.equal(await objective.isVisible(), false, "keyboard tab activation suspends the editor");
  await page.keyboard.press("ArrowRight");
  await retained("keyboard tab return");
  await page.getByRole("button", { name: "Pane keyboard shortcuts" }).click();
  await page.getByRole("dialog", { name: "Pane keyboard shortcuts" }).waitFor();
  await page.keyboard.press("Escape");
  await paneHost.getByRole("button", { name: "Reset pane layout", exact: true }).click();
  const mountedWindows = await page.locator("[data-window]").count();
  await page.getByRole("button", { name: "Space overview", exact: true }).click();
  const overview = page.getByRole("dialog", { name: "Space overview" });
  assert.equal(await overview.getByRole("link").count(), 15);
  await overview.getByRole("link", { name: /^HUD/ }).getByText("Triage · 5 open · 0 closed", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-window]").count(), mountedWindows, "overview does not mount duplicate record views");
  await page.screenshot({ path: join(evidence, "space-overview.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await retained("overview close");
  activeCall = { sessionId: randomUUID(), botId: "bot-1", threadId: "main-bot-1", phase: "connected" };
  sockets.get("bots").publish("voice_changed");
  const callDock = page.getByRole("complementary", { name: "Voice call", exact: true });
  await callDock.getByRole("button", { name: "End call", exact: true }).waitFor();
  const heldCall = await callDock.elementHandle();
  await page.waitForFunction(() => document.querySelector('[data-space="hud"][data-canvas]')?.getBoundingClientRect().bottom <= document.querySelector('[aria-label="Voice call"]')?.getBoundingClientRect().top);
  await resources.getByRole("link", { name: "bot-1", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/fleet");
  await page.getByRole("button", { name: "Back to HUD", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  assert.equal(await callDock.evaluate((element, original) => element === original, heldCall), true, "call controls retain identity across a cross-space link and browser-history return");
  await retained("cross-space history return");
  await page.setViewportSize({ width: 420, height: 900 });
  await paneHost.getByRole("button", { name: /^Panes/ }).click();
  await page.getByRole("combobox", { name: "Find a pane in HUD" }).fill("hud-item");
  await page.keyboard.press("Enter");
  await item.getByRole("button", { name: "Inspect Implement windows", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Inspector", exact: true });
  await inspector.waitFor();
  assert.equal(await callDock.getByRole("button", { name: "End call", exact: true }).isVisible(), true);
  assert.ok((await inspector.boundingBox()).y + (await inspector.boundingBox()).height <= (await callDock.boundingBox()).y, "compact inspection leaves the call controls unobscured");
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  await page.screenshot({ path: join(evidence, "call-inspector-narrow.png"), animations: "disabled" });
  await inspector.getByRole("button", { name: "Close inspector", exact: true }).click();
  await page.setViewportSize({ width: 2400, height: 1300 });
  await retained("compact inspection during a call");
  activeCall = null;
  sockets.get("bots").publish("voice_changed");
  await callDock.waitFor({ state: "hidden" });
  await heldCall.dispose();
  await page.screenshot({ path: join(evidence, "hud-pane-draft.png"), animations: "disabled" });
  assert.equal((await get(ids.implement)).objective, "Build the windows and their tests", "layout operations never submit the draft");
  await heldDraft.dispose();
  const before = await get(ids.implement);
  await call("work_update", { requestId: randomUUID(), id: ids.implement, expectedRevision: before.revision, patch: { objective: "Agent's concurrent objective" } });
  await item.getByText(/changed this while you were editing/).waitFor();
  await item.getByText("Agent's concurrent objective").waitFor();
  await item.getByRole("button", { name: "Save", exact: true }).click();
  await item.getByText(/Someone changed this item after you started/).waitFor();
  assert.equal(await objective.inputValue(), "Human draft objective", "a conflict keeps the draft");
  await page.screenshot({ path: join(evidence, "hud-conflict.png"), animations: "disabled" });
  await item.getByRole("button", { name: /Save mine over revision/ }).click();
  await item.getByText("Human draft objective").waitFor();
  assert.equal((await get(ids.implement)).objective, "Human draft objective");

  const resourceGate = { ...Promise.withResolvers(), admitted: Promise.withResolvers(), id: ids.design, model: lateModel };
  const resumedGate = { ...Promise.withResolvers(), admitted: Promise.withResolvers(), id: ids.design };
  resourceGates.push(resourceGate, resumedGate);
  heldResources = resourceGate;
  await pick(ids.design, "Design the space").click();
  await bounded(resourceGate.admitted.promise);
  await resources.getByRole("button", { name: "Close Resources", exact: true }).click();
  heldResources = resumedGate;
  await page.getByRole("button", { name: "Panes 1 closed", exact: true }).click();
  await page.getByRole("combobox", { name: "Find a pane in HUD" }).fill("hud-resources");
  await page.keyboard.press("Enter");
  await bounded(resumedGate.admitted.promise, 2_000);
  resumedGate.resolve();
  await resources.getByText("Dispatched for this item", { exact: false }).waitFor();
  resourceGate.resolve();
  await bounded(lateFrame.promise);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await resources.getByText(lateModel, { exact: false }).count(), 0, "reopen reads fresh evidence without waiting for or accepting the retired same-query read");
  await pick(ids.implement, "Implement windows").click();
  await resources.getByText("Captured from Chat focus", { exact: false }).waitFor();

  // A note from elsewhere arrives live, without a reload.
  const current = await get(ids.implement);
  await call("work_note_add", { requestId: randomUUID(), id: ids.implement, expectedRevision: current.revision, kind: "decision", body: "Keep metadata behind the disclosure" });
  await timeline.getByText("Keep metadata behind the disclosure").waitFor();

  // Adding a note from the page.
  await timeline.getByRole("textbox", { name: "Note" }).fill("Progress from the human");
  await timeline.getByRole("button", { name: "Add", exact: true }).click();
  await timeline.getByText("Progress from the human").waitFor();

  // Metadata is read only when opened.
  await item.locator("summary", { hasText: "Agent metadata" }).click();
  await item.getByText("meta-marker-value", { exact: false }).waitFor();

  // Creating a child through the page places it under its parent.
  await item.getByRole("button", { name: "Add a child" }).click();
  await item.getByRole("textbox", { name: "Title" }).fill("Write the browser check");
  await item.getByRole("textbox", { name: "Objective" }).first().fill("Prove the space renders");
  await item.getByRole("button", { name: "Create" }).click();
  const child = tree.locator('[data-node^="work-item:"]').filter({ hasText: "Write the browser check" });
  await child.waitFor();

  // Chat focus is set explicitly and shows as a declared selection.
  await pick(ids.implement, "Implement windows").click();
  await resources.getByRole("combobox", { name: "Bot chat" }).selectOption("bot-1");
  await resources.getByText(/never chosen focus/).waitFor();
  await resources.getByRole("button", { name: "Focus", exact: true }).click();
  await resources.getByText("Chat focus · 1").waitFor();

  // An unavailable Worker owner is not an empty inventory.
  await pick(ids.salvage, "Salvage notes").click();
  await resources.getByText("not an empty list").waitFor();

  // Completing a parent with open descendants is offered as one atomic batch.
  await pick(ids.epic, "Ship the HUD").click();
  await item.getByRole("combobox", { name: "State" }).selectOption("completed");
  await page.getByRole("alertdialog").getByText(/open descendants? too/).waitFor();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  assert.equal((await get(ids.epic)).state, "active", "cancelling the dialog changes nothing");

  // Arriving from a link selects the item and reveals it.
  await page.goto(`${origin}/?focus=${encodeURIComponent(`work-item:${ids.design}`)}`);
  await item.getByText("Information architecture").waitFor({ timeout: 10_000 });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: join(evidence, "hud-dark.png"), animations: "disabled" });
  await page.emulateMedia({ colorScheme: "light" });

  assert.equal(consoleErrors.filter((text) => /cannot be a descendant|hydration/i.test(text)).length, 0,
    `no invalid-nesting or hydration console errors: ${consoleErrors.join(" | ")}`);
  assert.deepEqual(errors, []);
  console.log(`hud rendered check passed; evidence in ${evidence}`);
} catch (error) {
  if (browser) {
    const pages = browser.contexts()[0]?.pages() ?? [];
    for (const page of pages) await page.screenshot({ path: join(evidence, "hud-failure.png"), animations: "disabled" }).catch(() => {});
    for (const page of pages) for (const id of ["hud-work", "hud-item", "hud-timeline", "hud-resources", "hud-attention"]) console.error(`${id}:`, await page.locator(`[data-window="${id}"]`).innerText().catch(() => "unavailable"));
  }
  console.error(log.slice(-4000));
  throw error;
} finally {
  for (const gate of resourceGates) gate.resolve();
  await browser?.close();
  if (next && next.exitCode === null) { next.kill("SIGTERM"); await new Promise((resolve) => next.once("exit", resolve)); }
  await websocket?.close();
  for (const socket of sockets.values()) await socket.close();
  await hud?.close();
  if (!process.env.HUD_EVIDENCE_DIR) await rm(dir, { recursive: true, force: true });
}
