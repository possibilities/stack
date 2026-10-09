import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";

// Load the pure stack modules directly without a Next build. Their
// bundler-style imports need extensions when loaded by Node.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/lib/stack/") && specifier.startsWith("./") && !extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { applyInput, continueInventory, continueSubscriptions, groupByOwner, linkNeedsSelection, loadInventory, loadSubscriptions,
  localOperation, localOperations, measured, ownerGaps, planReadiness, relationshipNode } = await import("../lib/stack/state.ts");

const entry = (id, owner, extra = {}) => ({ id, ownerPackage: owner, subject: null, kind: "storage", authority: "authoritative", location: "server", ownership: "stack",
  revision: null, observedAt: "2026-09-30T00:00:00.000Z", coverage: "partial", items: null, bytes: null, sensitivity: "content", relationships: [], reads: [], actions: [],
  retention: "Kept", regeneration: "None", issues: [], ...extra });
const plan = (extra = {}) => ({ id: "11111111-1111-4111-8111-111111111111", ownerPackage: "infer", subject: null, action: "history_clear", revision: "rev-1",
  createdAt: "2026-09-30T00:00:00.000Z", expiresAt: "2026-09-30T01:00:00.000Z", resources: ["request a"], blockedBy: [], retained: [], regeneration: [], ...extra });

/** A serve_state_list stand-in: two pages per observation; the revision changes when `observation` does. */
function inventoryOwner() {
  const owner = { observation: 1, calls: [] };
  owner.call = async (name, args) => {
    owner.calls.push([name, args]);
    const revision = `r${owner.observation}`;
    if (args.revision && args.revision !== revision) throw new Error("aggregate inventory changed; restart paging");
    const all = [entry(`bots:a${owner.observation}`, "bots", { bytes: 10 }), entry("bots:b", "bots"), entry("usage:c", "usage")];
    const page = all.slice(args.offset, args.offset + 2);
    return { entries: page, revision, observedAt: "2026-09-30T00:00:00.000Z", nextOffset: args.offset + 2 < all.length ? args.offset + 2 : null,
      owners: [{ package: "bots", available: true, issue: null }, { package: "usage", available: true, issue: null }, { package: "xcom", available: false, issue: "Owner unavailable" }] };
  };
  return owner;
}

test("inventory paging continues one observation and restarts from the first page when it changed", async () => {
  const owner = inventoryOwner();
  const first = await loadInventory(owner.call, { owners: null, measure: false });
  assert.deepEqual(owner.calls[0], ["serve_state_list", { measure: false, offset: 0, limit: 100 }], "no owners selection means every owner; measurement is explicit");
  assert.deepEqual(first.entries.map((row) => row.id), ["bots:a1", "bots:b"]);
  const all = await continueInventory(owner.call, first);
  assert.deepEqual(owner.calls[1][1], { measure: false, offset: 2, limit: 100, revision: "r1" }, "continuations pin the first page's revision");
  assert.deepEqual(all.entries.map((row) => row.id), ["bots:a1", "bots:b", "usage:c"]);
  assert.equal(all.restarted, false);
  assert.equal(await continueInventory(owner.call, all), all, "a complete observation is not re-read");

  // A stale continuation never mixes observations: it starts again at offset 0 and says so.
  owner.observation = 2;
  const restarted = await continueInventory(owner.call, first);
  assert.deepEqual(restarted.entries.map((row) => row.id), ["bots:a2", "bots:b"]);
  assert.equal(restarted.revision, "r2");
  assert.equal(restarted.restarted, true);

  // Owner selection and measurement are passed exactly; other failures are not treated as restarts.
  await loadInventory(owner.call, { owners: ["bots"], measure: true });
  assert.deepEqual(owner.calls.at(-1)[1], { owners: ["bots"], measure: true, offset: 0, limit: 100 });
  await assert.rejects(continueInventory(async () => { throw new Error("serve WebSocket is not connected"); }, first), /not connected/);
});

test("owners stay visible when unavailable or empty, and unmeasured is never zero", async () => {
  const inventory = await continueInventory(inventoryOwner().call, await loadInventory(inventoryOwner().call, { owners: null, measure: false }));
  const groups = groupByOwner(inventory);
  assert.deepEqual(groups.map((group) => [group.owner.package, group.owner.available, group.entries.length]), [["bots", true, 2], ["usage", true, 1], ["xcom", false, 0]]);
  assert.equal(measured(null, (value) => `${value} B`), "unmeasured");
  assert.equal(measured(0, (value) => `${value} B`), "0 B");
});

test("subscription paging passes exact filters and restarts on a changed observation", async () => {
  let revision = "s1";
  const calls = [];
  const call = async (name, args) => {
    calls.push(args);
    if (args.revision && args.revision !== revision) throw new Error("subscription observation changed; restart paging");
    return { subscriptions: [{ id: `sub-${args.offset}` }], revision, nextOffset: args.offset === 0 ? 1 : null };
  };
  const first = await loadSubscriptions(call, { botId: "alpha", threadId: "", package: undefined });
  assert.deepEqual(calls[0], { botId: "alpha", offset: 0, limit: 100 }, "empty filters are omitted rather than matched literally");
  assert.deepEqual((await continueSubscriptions(call, first)).subscriptions.map((row) => row.id), ["sub-0", "sub-1"]);
  revision = "s2";
  const again = await continueSubscriptions(call, first);
  assert.equal(again.restarted, true);
  assert.deepEqual(again.subscriptions.map((row) => row.id), ["sub-0"]);
});

test("state operations are local-only and follow the live WebSocket selection", () => {
  const catalog = { data: [{ name: "serve", transports: [{ type: "mcp", operations: ["serve_status"] }, { type: "websocket", operations: ["serve_state_list"] }] }] };
  assert.deepEqual(localOperation({ catalog }, "serve", "serve_state_list"), { available: true });
  assert.equal(localOperation({ catalog, remote: { scope: "control" } }, "serve", "serve_state_list").available, false, "remote Access never gets state controls");
  assert.match(localOperation({ catalog }, "serve", "serve_subscription_remove").reason, /does not expose serve_subscription_remove/);
  assert.match(localOperation({ catalog }, "bots", "bots_state_read").reason, /not in API discovery/);
  assert.match(localOperation({ catalog: { data: null } }, "serve", "serve_state_list").reason, /discovery/);
});

test("a control needs its plan, apply and receipt operations, not only the plan", () => {
  const websocket = (operations) => ({ name: "hud", transports: [{ type: "websocket", operations }] });
  const names = ["hud_history_plan", "hud_history_clear", "hud_state_receipt_get"];
  assert.deepEqual(localOperations({ catalog: { data: [websocket(names)] } }, "hud", names), { available: true });
  const withoutApply = localOperations({ catalog: { data: [websocket(["hud_history_plan", "hud_state_receipt_get"])] } }, "hud", names);
  assert.equal(withoutApply.available, false);
  assert.match(withoutApply.reason, /does not expose hud_history_clear/, "a plan that could never be applied is not offered");
  assert.match(localOperations({ catalog: { data: [websocket(names.slice(0, 2))] } }, "hud", names).reason, /hud_state_receipt_get/, "nor one whose receipt could not be read back");
  assert.equal(localOperations({ catalog: { data: [websocket(names)] }, remote: { scope: "control" } }, "hud", names).available, false, "remote Access never gets state controls");
});

test("shipped controls disclose remaining limits rather than claiming their maintenance is unsupported", () => {
  for (const owner of ["hud", "bots", "infer", "proc"]) assert.doesNotMatch(ownerGaps[owner], /is not supported\.$/, `${owner} no longer claims its shipped control is unsupported`);
  assert.match(ownerGaps.hud, /backup erasure.*other owners' copies/);
  assert.match(ownerGaps.bots, /Native Codex queue and history copies/);
  assert.match(ownerGaps.infer, /memory-only and leaves no receipt/);
  assert.match(ownerGaps.proc, /removed schedules only/);
  assert.match(ownerGaps.signal, /not historical replay or transcript erase/);
  assert.match(ownerGaps.roles, /missing\/legacy locks.*block/);
  assert.match(ownerGaps.auth, /Devin\/Claude.*unsupported/);
  assert.match(ownerGaps.access, /Audit has no manual prune/);
  assert.match(ownerGaps.content, /exact claimed dead-writer paths only/);
  assert.match(ownerGaps.content, /read-only disclosure, not Git-history purge or rewrite/);
  assert.match(ownerGaps.content, /Remotes, backups and device copies remain independent/);
  assert.match(ownerGaps.content, /no device-local reset/);
});

test("inventory links with empty arguments are drill-downs, and relationships link only known records", () => {
  assert.equal(linkNeedsSelection({ package: "bots", operation: "bot_state_plan", arguments: {} }), true);
  assert.equal(linkNeedsSelection({ package: "bots", operation: "bot_state_read", arguments: { botId: "a" } }), false);
  assert.deepEqual(relationshipNode({ relation: "automatic-input", package: "serve", kind: "subscription", id: "s" }), { kind: "subscription", id: "s" });
  assert.deepEqual(relationshipNode({ relation: "writer", package: "proc", kind: "run", id: "r" }), { kind: "proc-run", id: "r" });
  assert.equal(relationshipNode({ relation: "x", package: "hud", kind: "focus", id: "f" }), null);
});

test("blocked and expired plans cannot apply, and apply input binds the plan revision and owner identity", () => {
  const now = Date.parse("2026-09-30T00:30:00.000Z");
  assert.deepEqual(planReadiness(plan(), now), { canApply: true, blocked: false, expired: false, reason: null });
  const blocked = planReadiness(plan({ blockedBy: ["Stop Bot alpha"] }), now);
  assert.equal(blocked.canApply, false);
  assert.match(blocked.reason, /blocker/);
  const expired = planReadiness(plan(), Date.parse("2026-09-30T01:00:00.000Z"));
  assert.equal(expired.canApply, false);
  assert.match(expired.reason, /expired/);
  assert.deepEqual(applyInput(plan(), "req", { botId: "alpha" }), { planId: plan().id, expectedRevision: "rev-1", requestId: "req", botId: "alpha" });
});
