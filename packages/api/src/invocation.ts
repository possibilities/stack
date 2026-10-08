import { z } from "zod";

const identity = z.string().min(1).max(256);
export const scheduledAuthority = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("operator") }),
  z.strictObject({ kind: z.literal("bot"), botId: identity, mainThreadId: identity, threadId: identity }),
  z.strictObject({ kind: z.literal("system"), name: z.literal("brain-source-sync") }),
]);
export type ScheduledAuthority = z.infer<typeof scheduledAuthority>;

const caller = {
  botId: identity.nullable(), instance: identity.nullable(), threadId: identity.nullable(), sessionId: identity.nullable(),
  workerId: identity.nullable().optional(), workerInstance: identity.nullable().optional(),
};
/** Private-socket provenance. Proc resolves a live instance, never fabricates an MCP launch proof. */
export const invocationContext = z.discriminatedUnion("transport", [
  z.strictObject({ transport: z.literal("mcp"), ...caller,
    completionWatchId: z.uuid().optional(),
    injected: z.strictObject({ role: z.enum(["admin", "manager", "worker", "unassigned"]), launch: identity }).optional(),
  }).superRefine((value, ctx) => {
    if (value.injected && (value.botId || value.instance || value.workerId || value.workerInstance))
      ctx.addIssue({ code: "custom", message: "injected Role cannot claim a managed Bot or Worker identity" });
  }),
  z.strictObject({ transport: z.literal("proc"), ...caller,
    scheduleId: z.uuid(), executionId: z.uuid(), authority: scheduledAuthority,
  }).superRefine((value, ctx) => {
    const bot = value.authority.kind === "bot" ? value.authority : null;
    if (value.workerId || value.workerInstance || value.sessionId !== null
      || (bot ? value.botId !== bot.botId || value.threadId !== bot.threadId || !value.instance
        : value.botId !== null || value.threadId !== null || value.instance !== null)) {
      ctx.addIssue({ code: "custom", message: "scheduled caller does not match its authority" });
    }
  }),
]);
export type InvocationContext = z.infer<typeof invocationContext>;

/** Operator schedules and signed injected Admin launches have local operator target permissions. */
export function operatorInvocation(invocation?: InvocationContext): boolean {
  return !invocation || invocation.transport === "proc" && invocation.authority.kind === "operator"
    || invocation.transport === "mcp" && invocation.injected?.role === "admin";
}
