/** Reviewed positive grants from the internal MCP role access proposal. Unknown tools are denied to restricted roles. */
export const roleGrants = {
  manager: {
    hud: ["work_create", "work_update", "work_get", "work_list", "work_note_add", "work_context_resolve", "work_resources"],
    notify: ["notification_send", "notification_get"],
    worker: ["worker_list", "worker_status", "worker_read", "worker_catalog", "worker_start", "worker_send", "worker_cancel", "worker_resume", "worker_close"],
  },
  worker: {
    brain: ["search", "get", "context"],
    content: ["collection_get", "item_get", "item_read", "get", "list", "search", "resolve", "links", "backlinks", "artifacts_list", "artifacts_versions", "artifacts_show", "blob_stage_start", "blob_stage_status", "blob_stage_chunk", "blob_stage_finish", "item_put", "artifact_publish", "document_update"],
    scrape: ["scrape_feed_parse", "scrape_convert_html", "scrape_fetch", "scrape_links", "scrape_feed_discover"],
    worker: ["worker_status", "worker_read"],
  },
} as const;
export type PackageRole = "admin" | "manager" | "worker" | "unassigned";
export function packageToolAllowed(role: PackageRole, pkg: string, operation: string): boolean {
  if (role === "admin") return true;
  if (role === "unassigned") return false;
  const selected = roleGrants[role] as Record<string, readonly string[]>;
  return selected[pkg]?.includes(operation) ?? false;
}
