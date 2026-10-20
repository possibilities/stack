import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { startOpenCodeHost } from "../src/inject-opencode.js";

// Explicit installed-CLI evidence, independent of release-number qualification.
// No user profile, real credentials, model request or interactive UI is used.
test("installed OpenCode connects to the private Role host and creates a session without a model turn", {
  skip: process.env.STACK_NATIVE_ROLE_OPENCODE_PROBE !== "1", timeout: 60_000,
}, async () => {
  const binary = process.env.STACK_OPENCODE_BIN ?? join(homedir(), ".local", "bin", "opencode");
  const root = await mkdtemp(join(tmpdir(), "stack-role-native-"));
  const config = join(root, "role-config"), ordinary = join(root, "config", "opencode");
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: root, XDG_DATA_HOME: join(root, "data"),
    XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG_DIR: config, OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_PASSWORD: "disposable-native-probe", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_FFF: "1" };
  let host: Awaited<ReturnType<typeof startOpenCodeHost>> | undefined;
  try {
    await mkdir(config, { recursive: true }); await mkdir(ordinary, { recursive: true });
    const ordinaryPath = join(ordinary, "opencode.json"), ordinaryBytes = '{"mcp":{"servers":{}}}\n';
    await writeFile(ordinaryPath, ordinaryBytes);
    await writeFile(join(config, "opencode.json"), JSON.stringify({ plugins: ["-opencode.config.compatibility", "-opencode.config.instruction"], mcp: { servers: {} } }));
    const native = async (args: string[]) => (await promisify(execFile)(binary, args, { env, cwd: root, timeout: 20_000, maxBuffer: 1_000_000 })).stdout;
    for (const command of [[], ["run"], ["mini"]]) assert.match(await native([...command, "--help"]), /(?:^|\s)--server(?:[\s=,]|$)/);
    host = await startOpenCodeHost(env, new AbortController().signal);
    assert.equal((await fetch(`${host.url}/api/config`)).status, 401, "the host requires authentication");
    const observed = JSON.parse(await native(["api", "get", "/api/config", "--server", host.url]));
    assert.ok(Array.isArray(observed));
    assert.ok(observed.length > 0 && observed.every((entry: { path: string }) => entry.path.startsWith(config)));
    const created = JSON.parse(await native(["api", "post", "/api/session", "--server", host.url, "--data",
      JSON.stringify({ title: "Disposable Role compatibility probe", location: { directory: root } })]));
    assert.match(created.data.id, /^ses_/);
    assert.equal(await readFile(ordinaryPath, "utf8"), ordinaryBytes);
    console.log("installed OpenCode authenticated reads and no-turn session creation passed");
  } finally { await host?.stop(); await rm(root, { recursive: true, force: true }); }
});
