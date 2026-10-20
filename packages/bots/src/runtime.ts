import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { codexRuntimePath } from "./paths.js";

// Report the installed official package, without launching a process to render the UI.
export async function installedRuntimeVersion(): Promise<string | null> {
  try {
    const binary = await realpath(codexRuntimePath());
    await access(binary, constants.X_OK);
    const receipt: unknown = JSON.parse(await readFile(join(dirname(dirname(binary)), "stack-runtime.json"), "utf8"));
    if (!receipt || typeof receipt !== "object") return null;
    const fields = receipt as Record<string, unknown>;
    if (fields.owner !== "stack-official-codex-v1" || fields.repository !== "openai/codex") return null;
    if (typeof fields.commit !== "string" || !/^[0-9a-f]{40}$/.test(fields.commit)) return null;
    if (typeof fields.version !== "string" || !/^\d+\.\d+\.\d+$/.test(fields.version) || fields.tag !== `rust-v${fields.version}`) return null;
    return fields.version;
  } catch {
    return null;
  }
}
