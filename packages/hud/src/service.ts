import { botInstance, operatorInvocation, packageRole, socketCall, socketPath, stateHash, type InvocationContext, type StateApplyInput } from "@stack/api";
import { listActiveThreads, type ActiveThread } from "@stack/bots";
import { workAdmissionPage } from "./client.js";
import { canonical, HudStore } from "./store.js";
import type { Actor, Change, ChatTarget, HistorySelection, Reference, WorkContext, WorkItem } from "./schema.js";

type Bot = { id: string; state: string; url: string | null; mainThreadId: string | null; recoveryIssue: string | null };
type Caller = { actor: Actor; lineage: string[]; role: "admin" | "manager" };
function path(threads: ActiveThread[], id: string): string[] | null {
  for (const thread of threads) {
    if (thread.id === id) return [id];
    const found = path(thread.children ?? [], id);
    if (found) return [thread.id, ...found];
  }
  return null;
}
export class HudService {
  constructor(readonly store: HudStore, private readonly env: NodeJS.ProcessEnv) {}
  visible(caller: Caller, item: WorkItem): boolean {
    if (caller.role === "admin" || caller.actor.kind === "operator") return true;
    const { botId, mainThreadId } = caller.actor;
    return item.createdBy.kind === "bot" && item.createdBy.botId === botId && item.createdBy.mainThreadId === mainThreadId
      || item.links.some(link => ["lead", "contributor"].includes(link.relation)
        && (link.target.kind === "bot" || link.target.kind === "chat")
        && link.target.botId === botId && link.target.mainThreadId === mainThreadId)
      || this.store.hasBotFocus(item.id, botId, mainThreadId);
  }
  requireVisible(caller: Caller, id: string): WorkItem {
    const item = this.store.get(id);
    if (!this.visible(caller, item)) throw new Error("work belongs to another Manager assignment");
    return item;
  }
  private async bots(): Promise<Bot[]> {
    return (await socketCall(socketPath("bots", this.env), "tools/call", { name: "bot_list", arguments: {} }, { timeoutMs: 2000 }) as { bots: Bot[] }).bots;
  }
  async caller(invocation?: InvocationContext): Promise<Caller> {
    if (operatorInvocation(invocation) || invocation?.transport === "mcp" && !invocation.botId && !invocation.workerId)
      return { actor: { kind: "operator" }, lineage: [], role: "admin" };
    if (!invocation?.botId || !invocation.instance || !invocation.threadId || invocation.workerId)
      throw new Error("hud_caller_unverified: work management requires a sanctioned Bot Chat or operator");
    const bot = (await this.bots()).find(bot => bot.id === invocation.botId);
    if (!bot?.url || bot.state !== "running" || bot.recoveryIssue || !bot.mainThreadId || botInstance(bot.url) !== invocation.instance)
      throw new Error("hud_caller_unverified: Bot launch changed or is unavailable");
    if (invocation.transport === "proc" && (invocation.authority.kind !== "bot" || invocation.authority.mainThreadId !== bot.mainThreadId))
      throw new Error("hud_caller_unverified: scheduled Bot root changed");
    const lineage = path(await listActiveThreads(bot.url, bot.mainThreadId), invocation.threadId);
    if (!lineage || lineage[0] !== bot.mainThreadId) throw new Error("hud_caller_unverified: Chat is outside the sanctioned lineage");
    const current = (await this.bots()).find(value => value.id === bot.id);
    if (current?.url !== bot.url || current.mainThreadId !== bot.mainThreadId || current.state !== "running" || current.recoveryIssue)
      throw new Error("hud_caller_unverified: Bot changed during verification");
    const role = await packageRole({ botId: bot.id, instance: invocation.instance }, this.env);
    if (role !== "manager" && role !== "admin") throw new Error("hud_work_scope: Bot has no Work management grant");
    return { actor: { kind: "bot", botId: bot.id, mainThreadId: bot.mainThreadId, threadId: invocation.threadId }, lineage: lineage.reverse(), role };
  }
  async target(caller: Caller, target?: ChatTarget): Promise<ChatTarget> {
    if (caller.actor.kind === "bot") {
      const { kind: _, ...own } = caller.actor;
      if (target && (target.botId !== own.botId || target.threadId !== own.threadId || target.mainThreadId !== own.mainThreadId))
        throw new Error("hud_focus_owner: Bots may change only their own exact Chat focus");
      return own;
    }
    if (!target) throw new Error("hud_focus_target_required: operators must select an exact Bot Chat");
    await this.validateReference({ kind: "chat", ...target });
    return target;
  }
  async validateReference(ref: Reference, invocation?: InvocationContext): Promise<void> {
    if (ref.kind === "bot" || ref.kind === "chat") {
      const bot = (await this.bots()).find(bot => bot.id === ref.botId);
      if (!bot || !bot.mainThreadId || bot.mainThreadId !== ref.mainThreadId) throw new Error("hud_reference_invalid: Bot root does not match");
      if (ref.kind === "chat") {
        // chat_records enforces sanctioned historical as well as loaded lineage.
        await socketCall(socketPath("bots", this.env), "tools/call", { name: "chat_records", arguments: { botId: ref.botId, threadId: ref.threadId, limit: 1 } }, { timeoutMs: 20_000 });
      }
    } else if (ref.kind === "worker") {
      const value = await socketCall(socketPath("worker", this.env), "tools/call", { name: "worker_status", arguments: { id: ref.workerId },
        ...(invocation ? { invocation } : {}) }, { timeoutMs: 20_000 }) as { worker: { id: string } };
      if (value.worker.id !== ref.workerId) throw new Error("hud_reference_invalid: Worker does not match");
      if (ref.turnId) {
        await socketCall(socketPath("worker", this.env), "tools/call", { name: "worker_turn_context", arguments: { id: ref.workerId, turnId: ref.turnId },
          ...(invocation ? { invocation } : {}) }, { timeoutMs: 20_000 });
      }
    }
    // Other Package API resource locators and URLs are declarations, not claims that a resource exists.
  }
  async apply(requestId: string, changes: Change[], invocation?: InvocationContext) {
    const caller = await this.caller(invocation);
    const created = new Set(changes.filter(change => change.action === "create").map(change => change.id));
    const requireReference = (id: string) => {
      if (created.has(id) && !this.store.has(id)) return;
      this.requireVisible(caller, id);
    };
    for (const change of changes) {
      if (change.action === "create") {
        if (change.parentId) requireReference(change.parentId);
        for (const id of change.dependencies) requireReference(id);
      } else {
        requireReference(change.id);
        if (change.action === "update") {
          if (change.patch.parentId) requireReference(change.patch.parentId);
          for (const id of change.patch.dependencies ?? []) requireReference(id);
        }
      }
    }
    const prior = this.store.replay(requestId, changes, caller.actor);
    if (prior) return prior;
    for (const change of changes) {
      const retained = change.action === "update" && this.store.has(change.id) ? new Set(this.store.get(change.id).links.map(link => canonical(link.target))) : new Set<string>();
      const refs = change.action === "create" ? change.links.map(link => link.target)
        : change.action === "update" ? change.patch.links?.map(link => link.target) ?? [] : change.action === "note" ? change.references : [];
      for (const ref of refs) if (!retained.has(canonical(ref))) await this.validateReference(ref, invocation);
    }
    return this.store.apply(requestId, changes, caller.actor, after => {
      if (caller.role === "admin") return;
      const items = new Map(after.map(item => [item.id, item]));
      for (const change of changes) {
        const item = items.get(change.id)!;
        for (const id of [item.parentId, ...item.dependencies]) {
          if (!id) continue;
          const referenced = items.get(id)!;
          if (!this.visible(caller, referenced)) throw new Error(`hud_work_scope: Work item is outside this Bot's visible scope: ${id}`);
        }
      }
    });
  }
  async resolve(workItemId: string | undefined, invocation?: InvocationContext): Promise<{ context: WorkContext | null }> {
    const caller = await this.caller(invocation);
    let id = workItemId;
    if (id === undefined && caller.actor.kind === "bot") {
      for (const threadId of caller.lineage) {
        const focus = this.store.focus({ botId: caller.actor.botId, mainThreadId: caller.actor.mainThreadId, threadId });
        // Explicit null is an inheritance barrier, distinct from never having selected focus.
        if (focus.revision > 0) { id = focus.workItemId ?? undefined; break; }
      }
    }
    if (!id) return { context: null };
    const item = this.requireVisible(caller, id);
    if (item.contentClearedAt) throw new Error("work_content_cleared: choose new Work before dispatch");
    if (["completed", "cancelled"].includes(item.state)) throw new Error("work_closed: clear Chat focus, choose another item or reopen this work before dispatch");
    return { context: { workItemId: id, scopeRevision: item.scopeRevision, source: workItemId ? "explicit" : "focus" } };
  }
  async resources(id: string, after: number, limit: number, invocation?: InvocationContext) {
    const caller = await this.caller(invocation);
    const item = this.requireVisible(caller, id);
    const focuses = caller.actor.kind === "bot" && caller.role === "manager"
      ? this.store.focusesForBot(id, caller.actor.botId, caller.actor.mainThreadId) : this.store.focuses(id);
    try {
      const workers = workAdmissionPage.parse(await socketCall(socketPath("worker", this.env), "tools/call", {
        name: "worker_work_list", arguments: { workItemId: id, after, limit }, ...(invocation ? { invocation } : {}),
      }, { timeoutMs: 20_000 }));
      return { workItemId: id, scopeRevision: item.scopeRevision, links: item.links, focuses, workers,
        observation: { state: "available" as const, at: Date.now(), issue: null, visibility: caller.role === "manager" ? "own_bot" as const : "all" as const } };
    } catch {
      return { workItemId: id, scopeRevision: item.scopeRevision, links: item.links, focuses, workers: null,
        observation: { state: "unavailable" as const, at: Date.now(), issue: "Worker associations unavailable; retained work remains authoritative", visibility: caller.role === "manager" ? "own_bot" as const : "all" as const } };
    }
  }

  private async historyDependencies(selection: HistorySelection) {
    const closure = this.store.historyClosure(selection.items);
    const resources: string[] = [], blockedBy: string[] = [], observations: unknown[] = [];
    for (const item of closure) {
      try {
        let after = 0, count = 0;
        do {
          const page = workAdmissionPage.parse(await socketCall(socketPath("worker", this.env), "tools/call", {
            name: "worker_work_list", arguments: { workItemId: item.id, after, limit: 50 },
          }, { timeoutMs: 5000 }));
          observations.push(page.entries); count += page.entries.length;
          if (count > 1000) throw new Error("too many associations");
          for (const entry of page.entries) {
            resources.push(`worker:${entry.workerId}:turn:${entry.turnId}:work:${item.id}`);
            if (!["closed", "failed"].includes(entry.workerPhase) || ["queued", "running", "awaiting_input", "cancelling"].includes(entry.turnPhase))
              blockedBy.push(`Close Worker ${entry.workerId}; admission ${entry.turnId} holds Work ${item.id}`);
          }
          if (page.nextCursor === null) break;
          if (page.nextCursor <= after) throw new Error("association cursor did not advance");
          after = page.nextCursor;
        } while (true);
      } catch { blockedBy.push(`Worker associations unavailable or exceed the observation bound for Work ${item.id}`); }
    }
    const focuses = closure.flatMap(item => {
      const page = this.store.focuses(item.id);
      if (page.truncated) blockedBy.push(`Chat focus inventory exceeds the bound for Work ${item.id}`);
      return page.entries;
    });
    if (focuses.length) {
      try {
        const bots = await this.bots();
        const roots = focuses.map(focus => ({ focus, live: bots.some(bot => bot.id === focus.botId && bot.mainThreadId === focus.mainThreadId) }));
        observations.push(roots);
        for (const { focus, live } of roots) {
          resources.push(`focus:${canonical(focus)}`);
          if (live) blockedBy.push(`Clear live Chat focus ${focus.botId}/${focus.threadId} before Work maintenance`);
        }
      } catch { blockedBy.push("Bot roots unavailable; cannot establish retired Chat focus"); }
    }
    return { revision: stateHash([observations, blockedBy]), blockedBy, resources };
  }
  async historyPlan(selection: HistorySelection) { return this.store.historyPlan(selection, await this.historyDependencies(selection)); }
  async historyClear(input: StateApplyInput) {
    const prior = this.store.maintenance.existing(input); if (prior) return prior;
    const { payload } = this.store.maintenance.getPlan(input.planId);
    return this.store.historyClear(input, await this.historyDependencies(payload as HistorySelection));
  }
}
