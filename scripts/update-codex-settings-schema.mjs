import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Regenerate only from the consumer's exact runtime pin, never a moving checkout HEAD.
const root = resolve(import.meta.dirname, "..");
const revision = JSON.parse(readFileSync(resolve(root, "scripts/codex-release.json"), "utf8")).commit;
if (!/^[a-f0-9]{40}$/.test(revision) || process.argv.length > 3) throw new Error("Usage: node scripts/update-codex-settings-schema.mjs [/path/to/official-codex-source]");
let source;
if (process.argv[2]) source = execFileSync("git", ["show", `${revision}:codex-rs/core/config.schema.json`], { cwd: process.argv[2], encoding: "utf8", maxBuffer: 4_000_000 });
else {
  const response = await fetch(`https://raw.githubusercontent.com/openai/codex/${revision}/codex-rs/core/config.schema.json`);
  if (!response.ok) throw new Error(`Official config schema download failed: ${response.status}`);
  source = await response.text();
}
const schema = JSON.parse(source);
writeFileSync(resolve(root, "packages/settings/src/codex-schema.json"), JSON.stringify({ revision, schema }, null, 2) + "\n");
