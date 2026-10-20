import { homedir } from "node:os";
import { join } from "node:path";

// Stack's complete official release package, installed by scripts/install-codex.py.
// Deliberately independent of PATH and per-request or Codex environment settings.
export function codexRuntimePath(): string {
  return join(homedir(), ".local", "libexec", "stack", "codex", "codex");
}

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.STACK_STATE_DIR ?? join(homedir(), ".local", "state", "stack");
}
