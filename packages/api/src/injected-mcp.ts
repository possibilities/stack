import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { withLocalAuth } from "./local-auth.js";
import { stateDir } from "./workspace.js";
import type { PackageRole } from "./role-grants.js";

const exec = promisify(execFile);
const launchName = /^(?:codex|claude|opencode)-[A-Za-z0-9]{6}$/;
const roles: readonly string[] = ["admin", "manager", "worker", "unassigned"];
type Binding = { version: 1; launch: string; pid: number; birth: string; role: PackageRole; proof: string };

export async function processBirth(pid: number): Promise<string> {
  const { stdout } = await exec("/bin/ps", ["-p", String(pid), "-o", "lstart="],
    { env: { ...process.env, LC_ALL: "C" }, timeout: 5_000, maxBuffer: 4_096 });
  const birth = stdout.trim();
  if (!birth) throw new Error("launch process identity unavailable");
  return birth;
}

function mac(binding: Omit<Binding, "proof">, env: NodeJS.ProcessEnv): string {
  return withLocalAuth(env, auth => createHmac("sha256", auth.credential("stdio"))
    .update(JSON.stringify(["stack-injected-role-v1", binding.version, binding.launch, binding.pid, binding.birth, binding.role]))
    .digest("hex"));
}

/** A private Role launch receives a scoped proof, never the operator credential. */
export function injectedMcpBinding(launchPath: string, pid: number, birth: string, role: PackageRole,
  env: NodeJS.ProcessEnv = process.env): string {
  const launch = basename(launchPath);
  if (!launchName.test(launch) || !Number.isSafeInteger(pid) || pid <= 0 || !birth || birth.length > 128 || !roles.includes(role))
    throw new Error("invalid injected Role launch");
  const fields = { version: 1 as const, launch, pid, birth, role };
  return Buffer.from(JSON.stringify({ ...fields, proof: mac(fields, env) })).toString("base64url");
}

/** The lock and process birth fence an exited launch even if its config survives a crash. */
export async function verifyInjectedMcpBinding(value: string, env: NodeJS.ProcessEnv = process.env): Promise<{ role: PackageRole; launch: string }> {
  if (!value || value.length > 2_048) throw new Error("invalid injected Role MCP binding");
  let binding: Binding;
  try { binding = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Binding; }
  catch { throw new Error("invalid injected Role MCP binding"); }
  if (!binding || binding.version !== 1 || !launchName.test(binding.launch) || !Number.isSafeInteger(binding.pid) || binding.pid <= 0 ||
    typeof binding.birth !== "string" || !binding.birth || binding.birth.length > 128 || !roles.includes(binding.role) ||
    typeof binding.proof !== "string" || !/^[a-f0-9]{64}$/.test(binding.proof)) throw new Error("invalid injected Role MCP binding");
  const { proof, ...fields } = binding;
  if (!timingSafeEqual(Buffer.from(proof, "hex"), Buffer.from(mac(fields, env), "hex"))) throw new Error("invalid injected Role MCP binding");
  const lock = JSON.parse(await readFile(join(stateDir(env), "roles", "inject", binding.launch, "launch-lock.json"), "utf8")) as Record<string, unknown>;
  if (lock.version !== 1 || lock.state !== "running" || lock.pid !== binding.pid || lock.birth !== binding.birth ||
    await processBirth(binding.pid) !== binding.birth) throw new Error("injected Role launch is no longer running");
  return { role: binding.role, launch: binding.launch };
}
