import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { socketCall, socketPath, stateDir } from "@stack/api";
import { standaloneName } from "./src/profiles.js";

export const usage = `usage: stack browse ls
       stack browse create NAME [--label LABEL]
       stack browse start NAME | stop NAME | rm NAME
       stack browse cdp NAME
       stack browse drive NAME -- <agent-browser args...>
Named standalone browsers are durable Stack browser profiles not tied to a Bot.
drive is thin sugar: it runs agent-browser through Stack's provider with
AGENT_BROWSER_STACK_BROWSER=NAME, so the current CDP relay is resolved on every launch.`;

type Row = { name: string | null; label: string; state: string; cdpUrl: string | null; error: string | null; observation: { url: string } | null };
const call = (name: string, args: Record<string, unknown> = {}) => socketCall(socketPath("browse"), "tools/call", { name, arguments: args }, { timeoutMs: 120_000 });
const line = (b: Row) => `${b.name}\t${b.state}\t${b.cdpUrl ?? "-"}${b.error ? `\t${b.error}` : ""}`;

/** Per-user provider config targeting the named browser via the plugin arg (no env needed). */
export async function standaloneConfig(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  standaloneName.parse(name);
  const provider = join(dirname(fileURLToPath(import.meta.url)), "src", "provider.js");
  const path = join(stateDir(env), "browser", "controllers", `standalone-${name}.json`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const namespace = `ast-sb-${createHash("sha256").update(`${stateDir(env)}\0${name}`).digest("hex").slice(0, 24)}`;
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ provider: "stack", namespace, idleTimeout: "0", plugins: [{ name: "stack", command: process.execPath, args: [provider, `browser=${name}`], capabilities: ["browser.provider"] }] }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
  return path;
}

export default {
  async run(args: string[]): Promise<number> {
    const [command, name, ...rest] = args;
    if (["--help", "-h"].includes(command ?? "") && !name) { console.log(usage); return 0; }
    if (command === "ls" && !name) {
      const { browsers } = await call("browser_standalone_list") as { browsers: Row[] };
      for (const b of browsers) console.log(line(b));
      return 0;
    }
    if (!name || !["create", "start", "stop", "rm", "cdp", "drive"].includes(command!)) { console.error(usage); return 1; }
    standaloneName.parse(name);
    if (command !== "create" && command !== "drive" && rest.length) { console.error(usage); return 1; }
    if (command === "create") {
      if (rest.length && (rest.length !== 2 || rest[0] !== "--label" || !rest[1])) { console.error(usage); return 1; }
      const label = rest[0] === "--label" ? rest[1] : undefined;
      console.log(line(await call("browser_standalone_create", { name, ...(label ? { label } : {}) }) as Row)); return 0;
    }
    if (command === "start") { const browser = await call("browser_standalone_start", { name }) as Row; console.log(line(browser)); return browser.state === "ready" ? 0 : 1; }
    if (command === "stop") { console.log(line(await call("browser_standalone_stop", { name }) as Row)); return 0; }
    if (command === "rm") { await call("browser_standalone_delete", { name, confirm: "delete" }); console.log(`deleted ${name}`); return 0; }
    if (command === "cdp") {
      const { browser } = await call("browser_standalone_get", { name }) as { browser: Row | null };
      if (!browser) { console.error(`unknown standalone browser: ${name}`); return 1; }
      if (!browser.cdpUrl) { console.error(`${name} is ${browser.state}; run stack browse start ${name}`); return 1; }
      console.log(browser.cdpUrl); return 0;
    }
    if (command === "drive") {
      const forwarded = rest[0] === "--" ? rest.slice(1) : [];
      if (!forwarded.length) { console.error(usage); return 1; }
      const config = await standaloneConfig(name);
      const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("AGENT_BROWSER_"))), AGENT_BROWSER_CONFIG: config, AGENT_BROWSER_STACK_BROWSER: name };
      const hasSession = forwarded.some(arg => arg === "--session" || arg.startsWith("--session="));
      const child = spawn(process.env.STACK_AGENT_BROWSER ?? "agent-browser", [...(hasSession ? [] : ["--session", name]), ...forwarded], { stdio: "inherit", env });
      return await new Promise<number>((resolve) => { child.on("exit", (code) => resolve(code ?? 1)); child.on("error", (e) => { console.error(e.message); resolve(127); }); });
    }
    console.error(usage); return 1;
  },
  description: "Manage named standalone (non-Bot) browsers and drive them with agent-browser.",
};
