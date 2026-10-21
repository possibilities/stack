/** Shared gateway/scheduler budgets. These are response waits, not cancellation
 * deadlines: losing a reply never establishes that an operation did not run. */
import { codexMcpDefinition } from "./codex-mcp/catalog.js";

export const forwardTimeouts = new Map<string, number>([
  ["auth/account_remove", 300_000],
  ["bots/voice_dial", 75_000],
  ["infer/infer_complete", 75_000],
  ["signal/attention_models", 75_000],
  ["proc/proc_run_join", 310_000],
  // Browser extraction chains bounded steps; feed discovery accepts up to 300s.
  ["scrape/scrape_fetch", 120_000],
  ["scrape/scrape_links", 180_000],
  ["scrape/scrape_feed_discover", 310_000],
  ["scrape/scrape_corpus_replay", 120_000],
  // Canaries and queue processing run sequential live extractions.
  ["scrape/scrape_presets_check", 600_000],
  ["scrape/scrape_queue_process", 600_000],
  // Take drains and grants input; finish closes each bound controller.
  ["browse/browser_handoff_take", 60_000],
  ["browse/browser_operator_handoff_request", 60_000],
  ["browse/browser_management_page_open", 60_000],
  ["browse/browser_extension_install_bitwarden", 180_000],
  ["browse/browser_profile_extensions_apply", 240_000],
  ["browse/browser_vault_apply", 360_000],
  ["browse/browser_handoff_finish", 180_000],
  ["browse/browser_profile_delete", 60_000],
  // Named browser start waits for its VM (30s) and CDP readiness (35s); stop drains, closes Chrome and confirms the VM stopped.
  ["browse/browser_standalone_start", 120_000],
  ["browse/browser_standalone_attach", 120_000],
  ["browse/browser_standalone_stop", 120_000],
  // npm install is bounded at 180s; a policy check may install.
  ["browse/agent_browser_check_updates", 200_000],
  ["browse/agent_browser_install", 200_000],
  ["browse/agent_browser_update_accept", 200_000],
  // Download plus verification and extraction.
  ["browse/hypeman_install", 300_000],
]);

export function forwardTimeout(pkg: string, operation: string): number {
  return forwardTimeouts.get(`${pkg}/${operation}`) ?? 60_000;
}

/** Codex's per-server tool wait must outlast the gateway's longest operation. */
export function mcpToolTimeoutSeconds(pkg: string): number {
  if (codexMcpDefinition(pkg)) return 305;
  return Math.ceil(Math.max(60_000, ...[...forwardTimeouts].filter(([key]) => key.startsWith(`${pkg}/`)).map(([, ms]) => ms)) / 1000) + 5;
}
