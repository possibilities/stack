# 170. New Workers always use the canonical Worker Role

Status: accepted. This supersedes the Worker-selection portions of [ADR 0124](0124-manager-and-worker-launch-defaults.md) and [ADR 0125](0125-roles-space-worker-default-control.md). Their Bot-default behavior remains in force.

Every new Worker captures the fixed Worker Role. `worker_start` accepts no `roleId`, and the internal `role_launch_snapshot` rejects an explicit Role when its audience is `worker`. The `role_set_worker_default` operation and its Roles UI control are removed. The Bot default remains independently selectable.

The Role catalog stores `worker_role_id` as the canonical identity and returns it through `workerDefaultRoleId` for wire compatibility. A fresh catalog provisions Manager and Worker. On first opening a compatible older catalog, the migration adopts the existing Role named Worker, or provisions an empty Worker Role when none exists. It never takes the old mutable Worker-default pointer as authority; it synchronizes that legacy column to the canonical ID. The canonical Role cannot be renamed or deleted, but its instructions, skills and MCP connections remain editable for later launches.

Existing Worker records retain their saved Role snapshots across recovery and follow-up. Older incompatible Role catalogs continue to fail closed under the existing compatibility rules. This decision only fixes new Worker Role selection; it does not grant the proposed Admin, Manager and Worker per-tool policy in [the internal MCP role access proposal](../internal-mcp-role-access-proposal.md).
