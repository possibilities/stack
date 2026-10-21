// Optional rendered check of Browse extensions and the agent password manager (ADR 0187). Fixture sockets follow the
// real operation contracts and the real browse WebSocket manifest; a loopback HTTP server stands in for the Neko viewer.
// No live server, browser profile, Hypeman, Vaultwarden or extension download is touched, and no password is entered.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/browse-management-browser-check.mjs
// CHROME_BIN may override the local headless Chrome executable. BROWSE_EVIDENCE_DIR keeps screenshots.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api as botsApi } from "../../bots/dist/api.js";
import { findPackage, publishedJsonSchema, serveSocket, serveWebSocket, socketPath, StateJournal } from "@stack/api";
import { anyObject, fixtureDoc, freePort as port, gatewayRoot, root, ui, z, authorizeBrowser, serveFixture, fixtureServerId, seedRecovery } from "./browser-fixture.mjs";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Set PLAYWRIGHT_MODULE to an installed Playwright module");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const require = createRequire(import.meta.url);
const dir = await mkdtemp(join(tmpdir(), "browse-management-"));
const evidence = process.env.BROWSE_EVIDENCE_DIR ?? join(dir, "evidence");
await mkdir(evidence, { recursive: true });
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("STACK_"))), STACK_STATE_DIR: dir, NEXT_TELEMETRY_DISABLED: "1" };
const { api: browseApi } = await import("../../browse/dist/api.js");
const served = new Map(), calls = [];
let websocket, next, browser, neko, page, log = "", nekoBase = "";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();
const journal = new StateJournal(join(dir, "browse-maintenance.sqlite"), "browse");
const vaultJournal = new StateJournal(join(dir, "vault-maintenance.sqlite"), "browse");
const vaultId = uuid(900);
const connection = { id: vaultId, origin: "https://vault-fixture.stack.invalid:41000", hostname: "vault-fixture.stack.invalid", ip: "192.168.100.1", spki: "fixture-spki-sha256" };
const state = {
  profiles: [], controllers: [], handoffs: [], receipts: new Map(), pages: new Map(), extensions: [], configs: new Map(), backups: [],
  vault: { exists: false, running: false, signups: false, fence: null, revision: 0 },
  // One-shot failures: the owner acted, then the reply was lost.
  drop: new Set(),
};
const publish = (topic) => served.get("browse").publish(topic);
const handoff = (id) => state.handoffs.find((item) => item.id === id);
const profile = (id) => state.profiles.find((item) => item.id === id);
const lost = (name) => { if (state.drop.delete(name)) throw new Error("WebSocket connection closed"); };
const config = (profileId) => {
  if (!state.configs.has(profileId)) state.configs.set(profileId, { profileId, revision: `cfg-${profileId.slice(-3)}-0`, desired: [], applied: null, appliedAt: null, observedAt: null, observed: null, issue: null, vaultId: null, appliedVault: null });
  return state.configs.get(profileId);
};
let revisions = 0;
const extension = (id, char, patch = {}) => ({ id, digest: char.repeat(64), chromeId: (id === "bitwarden" ? "n" : "m").repeat(32), name: id, version: "1.0.0", permissions: ["storage"], hostPermissions: [],
  optionalPermissions: [], optionalHostPermissions: [], contentMatches: [], importedAt: iso(), source: "directory", bytes: 4096, popup: null, options: null, ...patch });
const vaultStatus = () => {
  const vault = state.vault, base = { version: "1.37.4", image: "docker.io/vaultwarden/server@sha256:fixture", desiredRunning: vault.exists && vault.running, signupsAllowed: vault.exists && vault.signups, fence: vault.fence };
  if (!vault.exists) return { ...base, id: null, revision: `absent-${vault.revision}`, state: "absent", healthy: false, instanceId: null, volumeId: null, connection: null, blockedBy: [] };
  return { ...base, id: vaultId, revision: `vault-${vault.revision}`, state: vault.running ? "running" : "stopped", healthy: vault.running, instanceId: "vault-instance-1", volumeId: "vault-volume-1",
    connection: vault.running ? connection : null, blockedBy: vault.fence ? ["Vault effect remains fenced; inspect its receipt before release"] : [] };
};
const vaultPreview = (input) => {
  const vault = state.vault, blockedBy = [];
  if (vault.fence) blockedBy.push("Vault has an unresolved effect fence");
  if (input.action === "start" && vault.running) blockedBy.push("Stop the vault before starting with a new registration policy");
  if (["stop", "backup"].includes(input.action) && !vault.running) blockedBy.push("Vault must be running for graceful stop or backup");
  if (input.action === "restore" && vault.exists) blockedBy.push("Delete the existing service explicitly before restoring a backup");
  return { subject: vault.exists ? { kind: "browser-vault", id: vaultId } : null, action: `browser_vault_${input.action}`, revision: JSON.stringify([input, vaultStatus().revision]),
    resources: vault.exists ? ["vault-instance-1", "vault-volume-1"] : [], blockedBy,
    retained: ["Browser extension sign-ins and decrypted local caches are independent; stopping or deleting the service does not revoke offline clients"],
    regeneration: [input.action === "start" ? `Explicit start uses pinned Vaultwarden 1.37.4; registration ${input.signupsAllowed ? "OPEN until explicitly stopped and restarted closed" : "closed"}` : "No automatic start, account creation, unlock or restoration"] };
};
function act(kind, input) {
  const item = handoff(input.id);
  if (!item) throw new Error("unknown browser handoff");
  const digest = JSON.stringify({ kind, ...input });
  const receipt = state.receipts.get(`${item.id}:${input.requestId}`);
  if (receipt && receipt !== digest) throw new Error("handoff action requestId conflicts with existing intent");
  if (!receipt && input.expectedRevision !== item.revision) throw new Error("stale handoff revision");
  if (receipt) return { handoff: item, controlUrl: item.state === "human_controlling" ? `${nekoBase}/control/` : null };
  state.receipts.set(`${item.id}:${input.requestId}`, digest);
  if (kind === "take") {
    if (item.state !== "awaiting_human") throw new Error("handoff is not awaiting human control");
    Object.assign(item, { state: "human_controlling", revision: item.revision + 1 });
  } else Object.assign(item, { state: "resolved", outcome: input.outcome, note: input.note ?? null, resolvedAt: iso(), revision: item.revision + 2 });
  publish("browser_handoffs_changed");
  return { handoff: item, controlUrl: kind === "take" ? `${nekoBase}/control/` : null };
}
const handlers = {
  browser_status: () => ({ provider: "hypeman", mode: "durable", sessions: 0, profiles: state.profiles.length }),
  browser_profile_list: () => ({ profiles: state.profiles }),
  browser_controller_list: () => ({ controllers: state.controllers }),
  browser_handoff_list: () => ({ handoffs: state.handoffs }),
  browser_handoff_get: (input) => ({ handoff: handoff(input.id) ?? null }),
  browser_handoff_completion: () => ({ result: null }),
  browser_handoff_take: (input) => act("take", input),
  browser_handoff_finish: (input) => act("finish", input),
  browser_standalone_list: () => ({ browsers: state.profiles.filter((row) => row.botId === null && row.name !== null) }),
  browser_standalone_get: (input) => ({ browser: state.profiles.find((row) => row.name === input.name) ?? null }),
  agent_browser_status: () => ({ installed: true, version: "0.38.1", location: "/fixture/agent-browser", latest: "0.38.1", pending: null, checkedAt: iso(), checkError: null, policy: "manual" }),
  agent_browser_detect: () => ({ installations: [] }),
  hypeman_detect: () => ({ installations: [{ root: "/fixture/hypeman", installed: true, selected: true, source: "stack", running: true, issue: null }] }),
  browse_state_receipt_get: ({ requestId }) => ({ receipt: journal.receipt(requestId) }),

  browser_extension_list: () => ({ extensions: state.extensions }),
  browser_extension_install_bitwarden: () => {
    const found = state.extensions.find((row) => row.id === "bitwarden");
    if (found) return found;
    const record = extension("bitwarden", "b", { name: "__MSG_extName__", version: "2026.10.0", source: "bitwarden", popup: "popup/index.html", permissions: ["storage", "tabs", "contextMenus"], hostPermissions: ["<all_urls>"], contentMatches: ["<all_urls>"] });
    state.extensions.push(record); publish("browser_extensions_changed"); return record;
  },
  browser_extension_import: ({ id, path }) => {
    assert.ok(path.startsWith("/"), "server-local absolute path");
    assert.notEqual(id, "bitwarden");
    const record = extension(id, String(state.extensions.length + 1), { options: "options.html" });
    state.extensions.push(record); publish("browser_extensions_changed"); return record;
  },
  browser_profile_extensions_get: ({ profileId }) => config(profileId),
  browser_profile_extensions_set: ({ profileId, expectedRevision, extensions, vaultId: binding }) => {
    const current = config(profileId);
    if (current.revision !== expectedRevision) throw new Error("Extension configuration changed; read it again");
    for (const ref of extensions) assert.ok(state.extensions.some((row) => row.id === ref.id && row.digest === ref.digest), "exact catalog digest");
    Object.assign(current, { desired: [...extensions].sort((a, b) => a.id.localeCompare(b.id)), revision: `cfg-${profileId.slice(-3)}-${++revisions}`, ...(binding !== undefined ? { vaultId: binding } : {}) });
    publish("browser_extensions_changed"); return current;
  },
  browser_profile_extensions_inspect: ({ profileId }) => { const current = config(profileId); current.observedAt = iso(); publish("browser_extensions_changed"); return current; },
  browser_profile_extensions_plan: ({ profileId, configurationRevision }) => {
    const current = config(profileId), row = profile(profileId);
    if (current.revision !== configurationRevision) throw new Error("Extension configuration changed; prepare a new plan");
    const blockedBy = row.botId ? ["Stop and verify the assigned Bot before profile maintenance", "Close all selected/uncertain controllers before profile maintenance"] : [];
    return journal.plan({ subject: { kind: "profile", id: profileId }, action: "browser_extensions", revision: JSON.stringify([profileId, configurationRevision, row.generation]),
      resources: [profileId, "provider-instance-exact-123", "provider-volume-exact-456"], blockedBy, retained: ["Other profiles, foreign/occupied volumes, external copies/backups and other owners' history remain"],
      regeneration: ["Explicit apply stages selected immutable extension versions and restarts this profile; disabled extension data remains in its volume. No account creation or unlock"] }, { kind: "extensions", profileId, configurationRevision });
  },
  browser_profile_extensions_apply: (input) => {
    const old = journal.existing(input); if (old) return old;
    const { plan, payload } = journal.getPlan(input.planId);
    assert.equal(input.expectedRevision, plan.revision); assert.deepEqual(plan.blockedBy, []);
    journal.begin(input, plan);
    const current = config(payload.profileId);
    Object.assign(current, { applied: current.desired, appliedVault: current.vaultId ? connection : null, appliedAt: iso(), observedAt: iso(), issue: null,
      observed: current.desired.map((ref) => { const row = state.extensions.find((item) => item.digest === ref.digest); return { id: row.chromeId, name: row.name, version: row.version }; }) });
    publish("browser_extensions_changed"); publish("browser_profiles_changed");
    return journal.finish(input.requestId, "completed", [{ resource: payload.profileId, outcome: "retained", detail: "Selected extension identities/versions observed after clean VM restart" }]);
  },
  browser_vault_status: () => vaultStatus(),
  browser_vault_backup_list: () => ({ backups: state.backups }),
  browser_vault_plan: (input) => vaultJournal.plan(vaultPreview({ signupsAllowed: false, ...input }), { signupsAllowed: false, ...input }),
  browser_vault_apply: (input) => {
    const old = vaultJournal.existing(input); if (old) return old;
    const { plan, payload } = vaultJournal.getPlan(input.planId);
    assert.equal(plan.revision, input.expectedRevision); assert.equal(vaultPreview(payload).revision, plan.revision, "the service did not change since the plan");
    vaultJournal.begin(input, plan);
    const vault = state.vault, outcomes = [];
    if (payload.action === "start") Object.assign(vault, { exists: true, running: true, signups: payload.signupsAllowed });
    if (payload.action === "stop") vault.running = false;
    if (payload.action === "backup") {
      vault.running = false;
      const path = `${dir}/vault-backups/${input.requestId}.tar.gz`;
      state.backups.push({ id: input.requestId, vaultId, createdAt: iso(), bytes: 52_428, sha256: "c".repeat(64), path });
      outcomes.push({ resource: path, outcome: "retained", detail: "Stopped-writer full /data backup" });
    }
    vault.revision++;
    publish("browser_vault_changed");
    const receipt = vaultJournal.finish(input.requestId, "completed", [...outcomes, { resource: vaultId, outcome: "retained", detail: `Vault ${payload.action} verified` }]);
    lost(`vault:${payload.action}`);
    return receipt;
  },
  browser_vault_receipt_get: ({ requestId }) => ({ receipt: vaultJournal.receipt(requestId) }),
  browser_vault_fence_release: ({ requestId, expectedRevision }) => {
    assert.equal(state.vault.fence, requestId); assert.equal(vaultStatus().revision, expectedRevision);
    state.vault.fence = null; state.vault.revision++; publish("browser_vault_changed"); return vaultStatus();
  },
  browser_operator_handoff_request: ({ profileId, requestId, message, ...rest }) => {
    assert.deepEqual(rest, {}, "no subscribe or invented Bot fields");
    const previous = state.handoffs.find((row) => row.origin === "operator" && row.requestId === requestId);
    if (previous) return previous;
    assert.equal(profile(profileId).state, "ready");
    const item = { origin: "operator", id: uuid(500 + state.handoffs.length), profileId, botId: null, threadId: null, instance: null, requestId, targetId: null, targetStatus: "unspecified", message,
      state: "awaiting_human", outcome: null, note: null, revision: 2, createdAt: iso(), resolvedAt: null, issue: null, quiesced: true, contentClearedAt: null, requestDigest: "digest" };
    state.handoffs.push(item); publish("browser_handoffs_changed");
    lost("handoff:request");
    return item;
  },
  browser_management_page_open: (input) => {
    const item = handoff(input.handoffId), prior = state.pages.get(input.requestId);
    if (prior) { assert.equal(prior, JSON.stringify(input)); return item; }
    if (item.state !== "awaiting_human" || item.revision !== input.expectedRevision) throw new Error("Awaiting handoff and exact revision required");
    const current = config(item.profileId);
    if (input.page.kind === "vault" && !current.appliedVault) throw new Error("Apply a vault connection to this profile first");
    if (input.page.kind === "vault" && input.page.entry === "register" && !state.vault.signups) throw new Error("Registration is closed");
    if (input.page.kind === "extension" && !current.applied?.some((ref) => ref.id === input.page.id)) throw new Error("Extension is not applied to this profile");
    state.pages.set(input.requestId, JSON.stringify(input));
    Object.assign(item, { revision: item.revision + 2, targetId: "T-manage", targetStatus: "present", issue: null });
    publish("browser_handoffs_changed");
    lost("page:open");
    return item;
  },
  serve_status: () => ({ serverId: fixtureServerId, pid: process.pid, startedAt: iso(), nodeVersion: process.version, children: [], mcpUrls: {}, indexUrl: null, uiUrl: null, inspectorUrl: null }),
  bot_list: () => ({ bots: [{ id: "bot-1", state: "running", pid: 321, cwd: "/fixture/workspace", url: null, account: null, runningAccount: null, mainThreadId: null, recoveryIssue: null, roleRevision: 1, settings: null }] }),
  bot_defaults_get: () => ({ model: "fixture", reasoningEffort: "medium", sandboxMode: "danger-full-access", approvalPolicy: "never" }),
  voice_status: () => ({ call: null }),
};

try {
  neko = createServer((request, response) => {
    const control = request.url?.startsWith("/control/");
    response.writeHead(request.url?.startsWith("/observe/") || control ? 200 : 404, { "content-type": "text/html" });
    response.end(`<!doctype html><title>neko</title><body style="background:#123;color:#fff"><h1>${control ? "Control fixture" : "Observe fixture"}</h1></body>`);
  });
  await new Promise((resolve) => neko.listen(0, "127.0.0.1", resolve));
  nekoBase = `http://127.0.0.1:${neko.address().port}`;
  const observation = { url: `${nekoBase}/observe/?readOnly=1`, udpPort: 1, follows: "visible-tab", verified: false };
  state.profiles = [
    { id: uuid(1), botId: "bot-1", name: null, label: "default", default: true, stopped: false, generation: 3, maintenanceRequestId: null, createdAt: iso(-3_600_000), state: "ready", error: null, observedAt: iso(-5_000), cdpUrl: "http://127.0.0.1:1", observation },
    { id: uuid(4), botId: null, name: "agent", label: "Agent passwords", default: false, stopped: false, generation: 0, maintenanceRequestId: null, createdAt: iso(-600_000), state: "ready", error: null, observedAt: iso(-5_000), cdpUrl: "http://127.0.0.1:49744", observation },
  ];
  state.controllers = [{ botId: "bot-1", instance: "launch-a", session: "default", profileId: uuid(1), actualProfileId: uuid(1), targetId: "T1", cdpUrl: null, state: "connected", revision: 2, observedAt: iso(-10_000), error: null }];

  const serve = await serveFixture(handlers);
  Object.assign(handlers, serve.handlers);
  const unobserved = (name) => () => { throw new Error(`${name} is not observed in this fixture`); };
  // The real browse WebSocket manifest selects explicit names; the fixture socket serves every one of them.
  const { config: browseManifest } = await findPackage(root, "browse");
  for (const name of browseManifest.websocket.operations) handlers[name] ??= unobserved(name);
  for (const op of botsApi.operations) handlers[op.name] ??= unobserved(op.name);
  const definitions = { browse: browseManifest.websocket.operations, serve: serve.names, bots: botsApi.operations.map((op) => op.name), api: ["docs_snapshot"] };
  const topics = { browse: browseApi.events.topics, serve: serve.topics, bots: botsApi.events.topics, api: {} };
  websocket = await serveWebSocket({ env, root: await gatewayRoot(dir, Object.keys(definitions), ["bots"]), port: 0 });
  const browseDoc = fixtureDoc("browse", browseApi, websocket.url, publishedJsonSchema);
  browseDoc.transports[0].operations = definitions.browse;
  const catalog = [browseDoc, ...["serve", "bots", "api"].map((name) => ({ ...fixtureDoc(name, null, websocket.url, publishedJsonSchema), events: topics[name],
    transports: [{ type: "websocket", description: "Fixture", supported: true, subscriptions: true, endpoint: websocket.url, operations: definitions[name], events: Object.keys(topics[name]), routes: [] }] }))];
  handlers.docs_snapshot = () => ({ packages: catalog });
  for (const [name, names] of Object.entries(definitions)) served.set(name, await serveSocket({ info: { name, description: name, transportDescription: "Fixture", path: socketPath(name, env) }, context: {},
    operations: names.map((operation) => ({ name: operation, description: operation, input: anyObject, output: z.any(), async call(_ctx, input) { calls.push({ name: operation, input }); return handlers[operation](input); } })),
    events: { topics: topics[name], scope: name === "bots" ? { valid: () => true, description: "Fixture", example: "bot-1" } : undefined } }));

  const nextPort = await port();
  env.STACK_WEBSOCKET_ORIGIN = `http://127.0.0.1:${nextPort}`;
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(nextPort)], { cwd: ui, env, stdio: ["ignore", "pipe", "pipe"] });
  next.stdout.on("data", (chunk) => { log += chunk; }); next.stderr.on("data", (chunk) => { log += chunk; });
  const origin = `http://127.0.0.1:${nextPort}`;
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/connect/local`)).ok) break; } catch { /* bounded readiness check */ }
    if (attempt > 1200 || next.exitCode !== null) throw new Error(log.slice(-4000));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const context = await browser.newContext({ viewport: { width: 2200, height: 1300 }, reducedMotion: "reduce" });
  page = await context.newPage();
  await authorizeBrowser(page, origin, env);
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { errors.push(`dialog: ${dialog.message()}`); void dialog.dismiss(); });
  const count = (name) => calls.filter((call) => call.name === name).length;
  const inputs = (name) => calls.filter((call) => call.name === name).map((call) => call.input);

  await page.goto(`${origin}/browse`);
  await page.getByRole("group", { name: "Browse layout preset" }).getByRole("button", { name: "Passwords", exact: true }).click();
  const manager = page.locator('[data-window="browse-password-manager"]');
  const handoffs = page.locator('[data-window="browse-handoffs"]');
  const viewer = page.locator('[data-window="browse-viewer"]');
  await manager.getByText("No managed service yet", { exact: false }).waitFor();
  // Mounting never plans, installs or starts anything.
  assert.equal(count("browser_vault_plan") + count("browser_vault_apply") + count("browser_extension_install_bitwarden"), 0);

  // 1. Start with registration explicitly open: a reviewed plan, an exact apply, a receipt.
  const lifecycle = manager.getByRole("radiogroup", { name: "Action" });
  await lifecycle.getByRole("radio", { name: "Start" }).check();
  const start = manager.getByRole("region", { name: "Start the service" });
  assert.equal(await start.getByRole("button", { name: "Prepare start" }).isDisabled(), true, "registration must be chosen first");
  await start.getByRole("radio", { name: "Open for account setup" }).check();
  await start.getByRole("button", { name: "Prepare start" }).click();
  await start.getByText("OPEN until explicitly stopped").waitFor();
  assert.deepEqual(inputs("browser_vault_plan").at(-1), { action: "start", signupsAllowed: true });
  await start.getByRole("button", { name: "Start the service" }).click();
  await start.getByText("Completed for the declared scope only.").waitFor();
  await manager.getByText("Registration is open.").waitFor();
  const applied = inputs("browser_vault_apply").at(-1);
  assert.deepEqual(Object.keys(applied).sort(), ["expectedRevision", "planId", "requestId"]);
  await page.screenshot({ path: join(evidence, "password-manager-registration-open.png"), animations: "disabled" });

  // 2. Bitwarden is installed explicitly; 3. a dedicated named browser is chosen.
  await manager.getByRole("button", { name: "Install Bitwarden" }).click();
  await manager.getByText(/2026\.10\.0 · digest bbbbbbbbbbbb/).waitFor();
  await manager.getByLabel("Management profile").selectOption(uuid(4));
  await manager.getByRole("link", { name: "Agent passwords · ready" }).waitFor();

  // 4. Save the exact digest and service binding; 5. plan and apply the saved revision.
  await manager.getByRole("button", { name: "Profile extensions…" }).click();
  const dialog = page.getByRole("dialog", { name: /Extensions · Agent passwords/ });
  await dialog.getByText("Never applied").waitFor();
  await dialog.getByRole("button", { name: /Add bitwarden 2026\.10\.0 and bind the managed service to the draft/ }).click();
  assert.equal(count("browser_profile_extensions_set"), 0, "a draft is not a save");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByText("Nothing to save").waitFor();
  assert.deepEqual(inputs("browser_profile_extensions_set").at(-1), { profileId: uuid(4), expectedRevision: "cfg-004-0", extensions: [{ id: "bitwarden", digest: "b".repeat(64) }], vaultId });
  assert.equal(count("browser_profile_extensions_plan"), 0, "saving is not applying");
  await dialog.getByText(/differs from the last applied one|Never applied/).first().waitFor();
  await dialog.getByRole("button", { name: "Prepare applying the saved selection" }).click();
  await dialog.getByRole("button", { name: "Apply and restart this profile" }).click();
  await dialog.getByText("Completed for the declared scope only.").waitFor();
  await dialog.getByText("Loaded at this version").waitFor();
  await dialog.getByText(connection.origin).waitFor();
  await page.screenshot({ path: join(evidence, "profile-extensions-applied.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await manager.getByText("Bitwarden applied · vault connection applied · loaded when observed").waitFor();

  // 6. An operator handoff whose reply is lost is recovered by matching origin, request ID and profile; nothing is resent.
  state.drop.add("handoff:request");
  await manager.getByRole("button", { name: "Request handoff" }).click();
  await manager.getByRole("group", { name: "Management pages" }).waitFor();
  assert.equal(count("browser_operator_handoff_request"), 1);
  assert.deepEqual(Object.keys(inputs("browser_operator_handoff_request")[0]).sort(), ["message", "profileId", "requestId"]);
  await handoffs.getByText("Operator", { exact: true }).first().waitFor();

  // The registration page opens before Take. A lost reply leaves an unconfirmed record, never a resend.
  state.drop.add("page:open");
  const pages = manager.getByRole("group", { name: "Management pages" });
  await pages.getByRole("button", { name: "Vault account registration" }).click();
  await pages.getByText(/is not confirmed\. The owner keeps its admission/).waitFor();
  assert.equal(count("browser_management_page_open"), 1);
  assert.deepEqual(inputs("browser_management_page_open")[0].page, { kind: "vault", entry: "register" });
  const savedRecords = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes("uix.browse.page-open.")));
  assert.equal(savedRecords.length, 1, "the exact page request was recorded under this destination before sending");
  assert.ok(savedRecords[0].startsWith("stack.destination."), "destination-scoped storage only");
  assert.equal(await pages.getByRole("button", { name: "Vault web interface" }).isDisabled(), true, "no second navigation while one is unresolved");
  await pages.getByRole("button", { name: "Forget after inspection" }).click();
  assert.equal(count("browser_management_page_open"), 1);

  // Take uses the revision the owner last answered.
  await manager.getByRole("button", { name: "Take control" }).click();
  await viewer.getByText(/You have control\. Closing this window/).waitFor();
  assert.equal(inputs("browser_handoff_take").at(-1).expectedRevision, 4);
  await page.screenshot({ path: join(evidence, "password-manager-handoff-control.png"), animations: "disabled" });
  await viewer.getByRole("button", { name: "Completed" }).click();
  await manager.getByRole("button", { name: "Request handoff" }).waitFor();
  assert.equal(inputs("browser_handoff_finish").at(-1).outcome, "completed");

  // 7. Close registration: an explicit Stop whose reply is lost, read back from its receipt; then an explicit closed Start.
  state.drop.add("vault:stop");
  await lifecycle.getByRole("radio", { name: "Stop" }).check();
  const stop = manager.getByRole("region", { name: "Stop the service" });
  await stop.getByRole("button", { name: "Prepare stop" }).click();
  await stop.getByRole("button", { name: "Stop the service" }).click();
  await stop.getByText("Completed for the declared scope only.").waitFor();
  assert.equal(count("browser_vault_apply"), 2, "the receipt was read, not the request resent");
  assert.ok(count("browser_vault_receipt_get") >= 1);
  await lifecycle.getByRole("radio", { name: "Start" }).check();
  await start.getByRole("button", { name: "Close receipt" }).click();
  await start.getByRole("radio", { name: "Closed" }).check();
  await start.getByRole("button", { name: "Prepare start" }).click();
  await start.getByRole("button", { name: "Start the service" }).click();
  await start.getByText("Completed for the declared scope only.").waitFor();
  assert.deepEqual(inputs("browser_vault_plan").at(-1), { action: "start", signupsAllowed: false });
  await manager.getByText("Registration is open.").waitFor({ state: "detached" });

  // 8. Backup has downtime and never restarts; its listing is metadata with a copyable path.
  await lifecycle.getByRole("radio", { name: "Back up" }).check();
  const backup = manager.getByRole("region", { name: "Back up the service" });
  await backup.getByText(/It does not restart; plan Start separately/).waitFor();
  await backup.getByRole("button", { name: "Prepare back up" }).click();
  await backup.getByRole("button", { name: "Stop and back up" }).click();
  await backup.getByText("Completed for the declared scope only.").waitFor();
  await manager.getByText(/vault-backups\/.*\.tar\.gz/).first().waitFor();
  assert.equal(vaultStatus().state, "stopped");
  await page.screenshot({ path: join(evidence, "password-manager-backup.png"), animations: "disabled", fullPage: true });

  // 9. The catalog: imports read a server path; same version labels with different bytes stay distinct.
  await page.getByRole("tab", { name: "Extensions", exact: true }).click();
  const extensions = page.locator('[data-window="browse-extensions"]');
  await extensions.getByLabel("Catalog ID").fill("bitwarden");
  await extensions.getByLabel("Directory or ZIP on the Stack server").fill("/srv/ext");
  await extensions.getByText("bitwarden is reserved for the pinned official installer").waitFor();
  await extensions.getByLabel("Catalog ID").fill("my-ext");
  await extensions.getByRole("button", { name: "Import" }).click();
  await extensions.getByText(/In the catalog: my-ext/).waitFor();
  await extensions.getByLabel("Directory or ZIP on the Stack server").fill("/srv/ext");
  await extensions.getByLabel("Catalog ID").fill("my-ext");
  await extensions.getByRole("button", { name: "Import" }).click();
  await extensions.getByText("same label, other bytes").first().waitFor();
  assert.deepEqual(inputs("browser_extension_import").map((input) => input.path), ["/srv/ext", "/srv/ext"]);
  await page.screenshot({ path: join(evidence, "extensions-catalog.png"), animations: "disabled" });

  // 10. A stale save keeps the draft; the Bot profile's plan names its blockers and cannot apply.
  await extensions.getByLabel("Profile to configure").selectOption(uuid(1));
  const botDialog = page.getByRole("dialog", { name: /Extensions · default/ });
  await botDialog.getByLabel("my-ext version").selectOption("3".repeat(64));
  config(uuid(1)).revision = "cfg-001-elsewhere";
  await botDialog.getByRole("button", { name: "Save", exact: true }).click();
  await botDialog.getByText("The saved configuration changed first. It was read again; your draft is kept.").waitFor();
  await botDialog.getByText(/Your draft is kept; compare it/).waitFor();
  assert.equal(await botDialog.getByLabel("my-ext version").inputValue(), "3".repeat(64));
  await botDialog.getByRole("button", { name: "Keep my draft over the current revision" }).click();
  await botDialog.getByRole("button", { name: "Save", exact: true }).click();
  await botDialog.getByText("Nothing to save").waitFor();
  assert.equal(inputs("browser_profile_extensions_set").at(-1).expectedRevision, "cfg-001-elsewhere");
  assert.equal("vaultId" in inputs("browser_profile_extensions_set").at(-1), false, "an untouched binding is omitted, preserving it");
  await botDialog.getByRole("button", { name: "Prepare applying the saved selection" }).click();
  await botDialog.getByText("Stop and verify the assigned Bot before profile maintenance").waitFor();
  assert.equal(await botDialog.getByRole("button", { name: "Apply and restart this profile" }).isDisabled(), true);
  assert.equal(count("browser_profile_extensions_apply"), 1);
  await page.screenshot({ path: join(evidence, "profile-extensions-blocked.png"), animations: "disabled" });
  await botDialog.getByRole("button", { name: "Discard plan" }).click();
  await botDialog.getByRole("button", { name: "Close dialog" }).click();

  // 11. After a reload, a retained unknown backup and its fence are recovered from their exact slot and released only by acknowledgement.
  state.vault.running = true; state.vault.revision++;
  const unknownPlan = vaultJournal.plan(vaultPreview({ action: "backup", signupsAllowed: false }), { action: "backup", signupsAllowed: false });
  const unknown = { planId: unknownPlan.id, expectedRevision: unknownPlan.revision, requestId: uuid(950) };
  vaultJournal.begin(unknown, unknownPlan);
  vaultJournal.finish(unknown.requestId, "unknown", [{ resource: vaultId, outcome: "unknown", detail: "Vault effect unconfirmed. Inspect resources and receipt; this request never re-executes" }]);
  state.vault.fence = unknown.requestId; state.vault.revision++;
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.includes("state-flow.browse:vault:backup")) localStorage.removeItem(key); });
  await seedRecovery(page, origin, "browse:vault:backup", unknown);
  const appliesBefore = count("browser_vault_apply");
  await page.reload();
  await page.getByRole("tab", { name: "Password manager", exact: true }).click().catch(() => {});
  const retained = manager.getByRole("region", { name: "Back up the service" });
  await retained.getByText("retained request").waitFor();
  await retained.getByText(/Unknown\. The owner cannot say what happened/).waitFor();
  assert.equal(await retained.getByRole("button", { name: /Send identical request/ }).count(), 0, "receipt-only: no resend");
  const fence = manager.getByRole("region", { name: "Service effect fence" });
  await fence.getByText(`Request ${unknown.requestId}`).waitFor();
  await page.screenshot({ path: join(evidence, "password-manager-fence.png"), animations: "disabled", fullPage: true });
  await fence.getByRole("button", { name: "Release fence…" }).click();
  const confirm = page.getByRole("dialog", { name: "Release the service fence?" });
  await confirm.getByRole("button", { name: "Release fence" }).click();
  await fence.waitFor({ state: "detached" });
  assert.deepEqual(inputs("browser_vault_fence_release"), [{ requestId: unknown.requestId, expectedRevision: `vault-${state.vault.revision - 1}` }]);
  assert.equal(count("browser_vault_apply"), appliesBefore, "recovery never re-applied");
  await retained.getByText(/Unknown\. The owner cannot say what happened/).waitFor();

  // Narrow layout and no secrets anywhere in browser storage.
  await page.setViewportSize({ width: 430, height: 900 });
  await page.screenshot({ path: join(evidence, "password-manager-narrow.png"), animations: "disabled" });
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
  assert.ok(!stored.includes("/control/"), "control grants are never stored");
  assert.equal(count("browser_extension_install_bitwarden"), 1);
  assert.deepEqual(errors, []);
  console.log(`browse management rendered check passed; evidence in ${evidence}`);
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, "browse-management-failure.png"), animations: "disabled", fullPage: true }).catch(() => {});
  console.error(log.slice(-4000));
  throw error;
} finally {
  await browser?.close();
  if (next && next.exitCode === null) { next.kill("SIGTERM"); await new Promise((resolve) => next.once("exit", resolve)); }
  await websocket?.close();
  for (const socket of served.values()) await socket.close();
  await new Promise((resolve) => neko ? neko.close(resolve) : resolve());
  if (!process.env.BROWSE_EVIDENCE_DIR) await rm(dir, { recursive: true, force: true });
}
