import { createHash } from "node:crypto";

/** Reviewed positive grants. Unknown operations and generated tools are denied to restricted roles. */
const shared = {
  brain: ["search", "get", "context", "tags", "submit", "submission_completion"],
  content: ["blob_stage_start", "blob_stage_status", "blob_stage_chunk", "blob_stage_finish", "collection_create", "collection_list", "collection_get", "collection_update", "item_put", "item_list", "item_get", "item_read", "item_move", "new", "add", "document_update", "get", "list", "search", "tags", "resolve", "links", "backlinks", "graph", "artifacts_list", "artifacts_versions", "artifacts_show"],
  scrape: ["scrape_fetch", "scrape_links", "scrape_feed_discover", "scrape_feed_parse", "scrape_convert_html", "scrape_presets_list", "scrape_preset_show"],
  xcom: ["xcom_articles_pending", "xcom_search", "xcom_context", "xcom_list", "xcom_get", "xcom_users", "xcom_user_get", "xcom_status"],
} as const;
const eventTools = ["events_catalog", "events_subscribe", "events_status", "events_unsubscribe"] as const;

export const roleGrants = {
  manager: {
    ...shared,
    hud: ["work_create", "work_update", "work_batch", "work_get", "work_list", "work_tree", "work_note_add", "work_activity_list", "work_metadata_get", "work_metadata_set", "work_focus_get", "work_focus_set", "work_context_resolve", "work_resources", ...eventTools],
    notify: ["notification_send", "notification_get", "notification_list", "notification_counts", ...eventTools],
    proc: ["proc_schedule_create", "proc_schedule_update", "proc_schedule_remove", "proc_schedule_get", "proc_schedule_list", "proc_execution_get", "proc_execution_list", "proc_run_start", "proc_run_cancel", "proc_run_completion", "proc_run_get", "proc_run_list", "proc_run_read", "proc_run_wait", "proc_run_join", ...eventTools],
    source: ["github_endpoint_list", "github_endpoint_get", "github_event_catalog", "github_event_schema", "github_delivery_list", "github_delivery_get", "github_delivery_payload", "github_watch_create", "github_watch_list", "github_watch_get", "github_watch_read", "github_watch_update", "github_watch_acknowledge", "github_watch_remove", "github_watch_events", ...eventTools, "events_listen"],
    usage: ["usage_snapshot", ...eventTools],
    worker: ["worker_account_list", "worker_catalog", "worker_runtime_list", "worker_start", "worker_list", "worker_resume", "worker_cancel", "worker_close", "worker_send", "worker_respond", "worker_status", "worker_read", "worker_detail", "worker_turn_list", "worker_record_list", "worker_record_read", "worker_tool_list", "worker_diff", "worker_work_list", "worker_turn_context", "worker_turn_observation", "worker_event_list", ...eventTools],
  },
  worker: shared,
} as const;
const managerCompletion = { brain: ["submit"], worker: ["worker_start", "worker_send"], notify: ["notification_send"], proc: ["proc_run_start"] } as const;
/** Stable digest of the static grant rules; live bridge and installed Admin catalogs are separate observations. */
export const rolePolicyVersion = createHash("sha256").update(JSON.stringify({
  admin: "all installed package and generated event tools", bridges: "five shared connections",
  roleGrants, managerCompletion,
})).digest("hex");
export type PackageRole = "admin" | "manager" | "worker" | "unassigned";
export function packageToolAllowed(role: PackageRole, pkg: string, operation: string): boolean {
  if (role === "admin") return true;
  if (role === "unassigned") return false;
  const selected = roleGrants[role] as Record<string, readonly string[]>;
  return selected[pkg]?.includes(operation) ?? false;
}

export function packageServerAllowed(role: PackageRole, pkg: string): boolean {
  return role === "admin" || role !== "unassigned" && Object.hasOwn(roleGrants[role], pkg);
}

/** Completion coordination is independent of generated event-tool grants. */
export function completionWatchAllowed(role: PackageRole, pkg: string, operation: string): boolean {
  return role === "admin" || role === "manager" &&
    ((managerCompletion as Record<string, readonly string[]>)[pkg]?.includes(operation) ?? false);
}
