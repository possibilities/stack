import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { codexRuntimePath } from "../src/paths.js";
import { Supervisor, appServerArgs, waitForReady } from "../src/supervisor.js";
import { appServerSocket } from "../src/threads.js";
import { chatRpc } from "../src/chats.js";
import { ChatIndex } from "../src/chats.js";

test("installed official Codex consumes and refreshes Role bot.md without replaying the orientation", { skip: !process.env.STACK_TEST_REAL_CODEX, timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "stack-orientation-native-"));
  const requests: Record<string, unknown>[] = [];
  let nextRequest: (() => void) | undefined;
  const model = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (!request.url?.endsWith("/responses")) { response.writeHead(404).end(); return; }
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    nextRequest?.();
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { id: "orientation-response" } },
      { type: "response.output_item.done", item: { id: "introduction", type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi, I'm your research collaborator. I can help investigate a question or review your next idea." }] } },
      { type: "response.completed", response: { id: "orientation-response", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  const supervisor = new Supervisor({ stateDir: root });
  let migrated: Supervisor | undefined;
  try {
    await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`;
    const claims = Buffer.from(JSON.stringify({ email: "fixture@example.test", "https://api.openai.com/auth": { chatgpt_account_id: "orientation-fixture" } })).toString("base64url");
    const credential = (token: string, stamp: string) => JSON.stringify({ last_refresh: stamp,
      tokens: { refresh_token: token, access_token: "fixture-only", id_token: `e30.${claims}.fixture` } });
    const account = supervisor.store.addAccount(credential("fixture-only", "2026-10-01T00:00:00Z")).id;
    const role = supervisor.role.role(supervisor.role.catalog().defaultRoleId!);
    role.update(0, { botMarkdown: "Be a measured research collaborator; your personality marker is native-orientation-fixture." });
    const skill = role.createSkill(role.snapshot().revision, "native-role-fixture", "Disposable native Role skill", "Do nothing.").skills[0]!;
    // A real stdio peer proves native discovery, without an external service or model call.
    const mcpPeer = `const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line); if (m.id === undefined) return;
  const result = m.method === 'initialize' ? { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
    : m.method === 'tools/list' ? { tools: [{ name: 'inspect_fixture', description: 'Read the disposable fixture', inputSchema: { type: 'object', properties: {} } }] }
    : { content: [{ type: 'text', text: 'fixture' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});`;
    const mcp = role.createMcpServer(role.snapshot().revision, "native-role-fixture", "Disposable native Role MCP",
      { type: "stdio", command: process.execPath, args: ["-e", mcpPeer] }).mcpServers[0]!;
    await supervisor.load();
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => { finish = resolve; });
    supervisor.onChange = () => { if (supervisor.list()[0]?.orientation?.state === "completed") finish(); };
    const bot = await supervisor.start({ id: "one", cwd: root, account, args: [
      "-c", 'model_provider="fixture"', "-c", 'model_providers.fixture.name="Fixture"',
      "-c", `model_providers.fixture.base_url=${JSON.stringify(baseUrl)}`, "-c", 'model_providers.fixture.wire_api="responses"',
      "-c", "model_providers.fixture.requires_openai_auth=false", "-c", "model_providers.fixture.request_max_retries=0",
      "-c", "model_providers.fixture.stream_max_retries=0", "-c", "model_providers.fixture.supports_websockets=false",
    ] });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([completed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`native orientation unfinished: ${JSON.stringify(supervisor.list()[0]?.orientation)}`)), 10_000); })]); }
    finally { if (timer) clearTimeout(timer); }
    assert.equal(requests.length, 1);
    const sent = JSON.stringify(requests[0]);
    assert.match(sent, /native-orientation-fixture/);
    assert.match(sent, /initialization request from Stack/);
    const skills = await chatRpc(bot.url!, "skills/list", { cwds: [root], forceReload: true });
    assert.match(JSON.stringify(skills), /native-role-fixture/);
    const servers = await chatRpc(bot.url!, "mcpServerStatus/list", {});
    assert.match(JSON.stringify(servers), /inspect_fixture/);
    const history = await chatRpc(bot.url!, "thread/turns/list", { threadId: bot.mainThreadId, itemsView: "full" });
    assert.match(JSON.stringify(history), /research collaborator/);
    assert.equal((history.data as unknown[]).length, 1);
    role.update(role.snapshot().revision, { botMarkdown: "Your current personality marker is native-next-launch-personality." });
    role.updateSkill(role.snapshot().revision, skill.id, { enabled: false });
    role.updateMcpServer(role.snapshot().revision, mcp.id, { enabled: false });
    await supervisor.stop("one");
    const restarted = await supervisor.start({ id: "one", cwd: root });
    assert.equal(restarted.mainThreadId, bot.mainThreadId);
    assert.equal(restarted.orientation?.state, "completed");
    assert.equal(requests.length, 1, "resuming the exact root does not trigger a new model request");
    assert.doesNotMatch(JSON.stringify(await chatRpc(restarted.url!, "skills/list", { cwds: [root], forceReload: true })), /native-role-fixture/);
    assert.doesNotMatch(JSON.stringify(await chatRpc(restarted.url!, "mcpServerStatus/list", {})), /inspect_fixture/);
    const follow = async (url: string, text: string) => {
      const observed = new Promise<void>((resolve) => { nextRequest = resolve; });
      await chatRpc(url, "turn/start", { threadId: bot.mainThreadId, input: [{ type: "text", text, text_elements: [] }] });
      try { await Promise.race([observed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("native follow-up never reached the fixture model")), 5_000); })]); }
      finally { if (timer) clearTimeout(timer); nextRequest = undefined; }
      return JSON.stringify(requests.at(-1));
    };
    const followUp = await follow(restarted.url!, "A human follow-up after relaunch");
    assert.match(followUp, /native-next-launch-personality/, "the resumed native root receives the newly captured Role personality");
    assert.match(followUp, /A human follow-up after relaunch/);
    role.update(role.snapshot().revision, { botMarkdown: "" });
    await supervisor.stop("one");
    const cleared = await supervisor.start({ id: "one", cwd: root });
    assert.equal(requests.length, 2, "clearing a personality also admits no model turn");
    await follow(cleared.url!, "A human follow-up after clearing");
    const input = requests.at(-1)!.input as Array<{ role?: string; content?: Array<{ text?: string }> }>;
    const snapshots = input.filter((item) => item.role === "developer").flatMap((item) => item.content ?? []).map((part) => part.text ?? "").filter((text) => text.startsWith("[Stack Role launch instructions]"));
    assert.match(snapshots.at(-1)!, /current Role supplies no instruction Fragments or bot.md personality/);
    assert.doesNotMatch(snapshots.at(-1)!, /native-next-launch-personality/);
    // Codex used to own and delete the credential copy during shutdown. A final
    // refresh must survive even when the watcher debounce has not run yet.
    const refreshed = credential("fixture-refreshed", "2026-10-02T00:00:00Z");
    await writeFile(join(root, "history", "one", "auth.json"), refreshed);
    await supervisor.stop("one");
    assert.equal(supervisor.store.accountCredentials(account).auth, refreshed);
    const index = new ChatIndex(root, id => supervisor.store.historyPath(id));
    try {
      await index.refresh("one", bot.mainThreadId);
      assert.equal(index.search("one", bot.mainThreadId, "research collaborator", 10, 0)[0]?.threadId, bot.mainThreadId);
    } finally { index.close(); }

    // Existing shared stores retain rollouts, without the new persistent home DBs.
    // Verify migration and native hydration from those bytes, using the exact root.
    const legacyState = join(root, "legacy");
    await mkdir(join(legacyState, "history"), { recursive: true });
    await cp(join(root, "history", "one", "sessions"), join(legacyState, "history", "sessions"), { recursive: true });
    migrated = new Supervisor({ stateDir: legacyState });
    migrated.store.saveServer({ ...supervisor.store.servers()[0]!, account: null, launchedAccount: null,
      authVersion: null, runtimeRoot: null, roleRoot: null, orientation: null });
    await migrated.load();
    const legacy = await migrated.start({ id: "one", cwd: root });
    assert.equal(legacy.mainThreadId, bot.mainThreadId);
    assert.equal(migrated.store.historyPath("one"), join(legacyState, "history", "one"));
    const restored = await chatRpc(legacy.url!, "thread/turns/list", { threadId: bot.mainThreadId, itemsView: "full" });
    assert.match(JSON.stringify(restored), /research collaborator/);
    assert.equal(requests.length, 3, "history migration and resume admit no model turn");
  } finally {
    if (migrated) { await migrated.stopAll(); await migrated.runtime.close(); migrated.role.close(); migrated.store.close(); }
    await supervisor.stopAll(); await supervisor.runtime.close(); supervisor.role.close(); supervisor.store.close();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("installed official Codex honors Bot launch defaults", { skip: !process.env.STACK_TEST_REAL_CODEX }, async () => {
  const root = await mkdtemp(join(tmpdir(), "stack-settings-native-"));
  const home = join(root, "codex");
  const runtime = join(root, "runtime");
  await Promise.all([home, runtime].map((path) => mkdir(path, { mode: 0o700 })));
  const claims = Buffer.from(JSON.stringify({ email: "native-account@example.test", "https://api.openai.com/auth": { chatgpt_account_id: "native-account-fixture" } })).toString("base64url");
  const fakeAuth = JSON.stringify({ last_refresh: new Date().toISOString(), tokens: {
    refresh_token: "fixture-only", access_token: "fixture-only", id_token: `e30.${claims}.fixture` } });
  await writeFile(join(home, "auth.json"), fakeAuth, { mode: 0o600 });
  const url = `unix://${join(root, "app.sock")}`;
  const env = { ...process.env, TMPDIR: runtime, STACK_STATE_DIR: root, CODEX_HOME: home, CODEX_SQLITE_HOME: home };
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_BASE_URL"]) delete (env as NodeJS.ProcessEnv)[key];
  const child = spawn(codexRuntimePath(), [...appServerArgs([], url, undefined, { model: "gpt-6-sol", model_reasoning_effort: "medium", sandbox_mode: "danger-full-access", approval_policy: "never",
    model_context_window: 120_000, model_auto_compact_token_limit_scope: "body_after_prefix", "agents.default_subagent_reasoning_effort": "high",
    "features.hooks": false, "features.multi_agent_v2.enabled": true, "features.multi_agent_v2.max_concurrent_threads_per_session": 3 }), "-c", 'cli_auth_credentials_store="file"'], {
    env, cwd: root, stdio: "ignore",
  });
  let ws: ReturnType<typeof appServerSocket> | undefined;
  try {
    await waitForReady(url, new Promise((resolve) => child.once("exit", resolve)), 10_000);
    assert.equal(await readFile(join(home, "auth.json"), "utf8"), fakeAuth);
    ws = appServerSocket(url);
    await new Promise<void>((resolve, reject) => { ws!.once("open", () => resolve()); ws!.once("error", reject); });
    const request = (id: number, method: string, params: object) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`${method} timed out`)), 10_000);
      const onMessage = (raw: unknown) => {
        const frame = JSON.parse(String(raw)) as { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
        if (frame.id === id) finish(frame.error ? new Error(frame.error.message ?? method) : null, frame.result);
      };
      const finish = (error: Error | null, result?: Record<string, unknown>) => {
        clearTimeout(timer); ws!.off("message", onMessage);
        if (error) reject(error); else resolve(result ?? {});
      };
      ws!.on("message", onMessage);
      ws!.send(JSON.stringify({ id, method, params }));
    });
    await request(1, "initialize", { clientInfo: { name: "stack-test", version: "0.0.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
    ws.send(JSON.stringify({ method: "initialized" }));
    const result = await request(2, "config/read", { includeLayers: false, cwd: root });
    const account = await request(3, "account/read", { refreshToken: false });
    assert.match(JSON.stringify(account), /native-account@example.test/, "native account reads use this invocation's credential file");
    const config = result.config as { model?: string; model_reasoning_effort?: string; approval_policy?: string; sandbox_mode?: string };
    assert.equal(config.model, "gpt-6-sol");
    assert.equal(config.model_reasoning_effort, "medium");
    assert.equal(config.approval_policy, "never");
    assert.equal(config.sandbox_mode, "danger-full-access");
    const resolved = result.config as Record<string, unknown>;
    assert.equal(resolved.model_context_window, 120_000);
    assert.equal(resolved.model_auto_compact_token_limit_scope, "body_after_prefix");
    assert.equal((resolved.agents as Record<string, unknown>).default_subagent_reasoning_effort, "high");
    const features = resolved.features as Record<string, unknown>;
    assert.equal(features.hooks, false);
    assert.equal((features.multi_agent_v2 as Record<string, unknown>).max_concurrent_threads_per_session, 3);
  } finally {
    ws?.close();
    child.kill("SIGTERM");
    let force: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve) => child.once("close", () => resolve())),
        new Promise<void>((resolve) => { force = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000); }),
      ]);
    } finally { if (force) clearTimeout(force); }
    await rm(root, { recursive: true, force: true });
  }
});
