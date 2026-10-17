import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/lib/stack/") && specifier.startsWith("./") && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { botHandoff, browseCallError, browseLocalReason, controllerKey, deleteBlock, groupHandoffs, groupProfiles, heldBy, intentFor, loadIntent, saveIntent, siteDataOrigins, handoffContentSelection, volumeSelection,
  isStandalone, sortStandalone, standaloneActions, standaloneConnect, standaloneCreateBlock, standaloneStatus } = await import("../lib/stack/browse.ts");
const { ViewerWindowStore, primaryViewer } = await import("../lib/stack/browse-viewers.ts");

const handoff = (patch = {}) => ({ id: "h1", profileId: "p1", botId: "bot-1", threadId: "t", instance: "i", requestId: "r", targetId: null, targetStatus: "unspecified", message: "Sign in to GitHub",
  state: "awaiting_human", outcome: null, note: null, revision: 3, createdAt: "2026-09-28T10:00:00Z", resolvedAt: null, issue: null, quiesced: true, ...patch });
const profile = (patch = {}) => ({ id: "p1", botId: "bot-1", label: "default", default: true, createdAt: "2026-09-28T09:00:00Z", state: "ready", error: null, observedAt: null, cdpUrl: null, observation: null, ...patch });
const named = (name, patch = {}) => profile({ id: `id-${name}`, botId: null, name, label: name, default: false, stopped: false, generation: 0, maintenanceRequestId: null, ...patch });
const controller = (patch = {}) => ({ botId: "bot-1", instance: "i", session: "default", profileId: "p1", actualProfileId: "p1", targetId: null, cdpUrl: null, state: "connected", revision: 1, observedAt: null, error: null, ...patch });

function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), values };
}

test("browse is never available remotely", () => {
  assert.equal(browseLocalReason(undefined), null);
  assert.equal(browseLocalReason({ scope: "control", scopes: [] }), "Available only on the local UI");
});

test("site-data scope accepts only exact HTTP(S) origins without silently widening page URLs", () => {
  assert.deepEqual(siteDataOrigins("https://example.com\nhttp://localhost:8080\nhttps://example.com"), { origins: ["http://localhost:8080", "https://example.com"], error: null });
  for (const text of ["", "https://example.com/", "https://example.com/path", "https://name:secret@example.com", "https://@example.com", "https://example.com?", "https://example.com#", "file:///path", "https://example.com\\path", "not a URL", Array(51).fill("https://example.com").join("\n")]) {
    assert.ok(siteDataOrigins(text).error, text);
    assert.deepEqual(siteDataOrigins(text).origins, [], "invalid scope cannot leak a normalized origin");
  }
});

test("maintenance selections exclude open/cleared handoffs and referenced/mounted/missing volumes", () => {
  const rows = [handoff({ id: "resolved", state: "resolved" }), handoff({ id: "cleared", state: "resolved", contentClearedAt: "2026-10-01T00:00:00Z" }), handoff()];
  assert.equal(handoffContentSelection(rows, ["resolved"]), true);
  for (const ids of [[], ["cleared"], ["h1"], ["missing"], ["resolved", "resolved"]]) assert.equal(handoffContentSelection(rows, ids), false);
  const volumes = [{ id: "orphan", blockedBy: [] }, { id: "mounted", blockedBy: ["mounted"] }, { id: "receipt", blockedBy: ["referenced"] }];
  assert.equal(volumeSelection(volumes, ["orphan"]), true);
  for (const ids of [[], ["mounted"], ["receipt"], ["missing"], ["orphan", "orphan"], Array(101).fill("orphan")]) assert.equal(volumeSelection(volumes, ids), false);
});

test("a timeout or dropped connection is an unknown outcome; a stale revision is its own case", () => {
  assert.deepEqual(browseCallError(new Error("socket call timed out: tools/call")), { text: "Outcome unknown: socket call timed out: tools/call", uncertain: true, stale: false });
  assert.equal(browseCallError(new Error("connection closed")).uncertain, true);
  assert.equal(browseCallError(new Error("stale handoff revision")).stale, true);
  assert.deepEqual(browseCallError(new Error("handoff is not awaiting human control")), { text: "handoff is not awaiting human control", uncertain: false, stale: false });
});

test("unresolved handoffs group by state oldest first; resolved history is newest first", () => {
  const groups = groupHandoffs([
    handoff({ id: "late", createdAt: "2026-09-28T11:00:00Z" }),
    handoff({ id: "early", createdAt: "2026-09-28T09:00:00Z" }),
    handoff({ id: "prep", state: "preparing" }),
    handoff({ id: "mine", state: "human_controlling" }),
    handoff({ id: "old", state: "resolved", resolvedAt: "2026-09-27T10:00:00Z" }),
    handoff({ id: "new", state: "resolved", resolvedAt: "2026-09-28T12:00:00Z" }),
  ]);
  assert.deepEqual(groups.open.map((group) => [group.state, group.handoffs.map((item) => item.id)]), [["awaiting_human", ["early", "late"]], ["human_controlling", ["mine"]], ["preparing", ["prep"]]]);
  assert.deepEqual(groups.resolved.map((item) => item.id), ["new", "old"]);
});

test("holds, Bot help and deletion blocks mirror the API's rules", () => {
  const list = [handoff({ state: "resolved" }), handoff({ id: "h2", profileId: "p2", state: "human_controlling" })];
  assert.equal(heldBy("p1", list), null);
  assert.equal(heldBy("p2", list)?.id, "h2");
  assert.equal(botHandoff("bot-1", list)?.id, "h2");
  assert.equal(botHandoff("bot-1", [handoff({ state: "preparing" })]), null);
  assert.equal(deleteBlock(profile(), [], []), "A Bot's default profile can't be deleted");
  assert.equal(deleteBlock(profile({ id: "p2", default: false }), [], list), "A handoff holds this profile");
  assert.equal(deleteBlock(profile({ id: "p3", default: false }), [controller({ profileId: "p9", actualProfileId: "p3" })], []), "A controller has this profile selected");
  assert.equal(deleteBlock(profile({ id: "p3", default: false }), [controller()], []), null);
  assert.equal(deleteBlock(profile({ botId: null, maintenanceRequestId: "exact-request" }), [], []), "Profile maintenance is fenced; inspect its receipt before release");
  // A retained, unassigned former default can be deleted.
  assert.equal(deleteBlock(profile({ botId: null }), [], []), null);
  assert.equal(controllerKey(controller()), "bot-1/i/default");
});

test("profiles group by Bot in numeric order, unassigned last, defaults first", () => {
  const groups = groupProfiles([profile({ id: "a", botId: null }), profile({ id: "b", botId: "bot-10", default: false }), profile({ id: "c", botId: "bot-2", default: false, createdAt: "2026-09-28T08:00:00Z" }), profile({ id: "d", botId: "bot-2" })]);
  assert.deepEqual(groups.map((group) => [group.botId, group.profiles.map((item) => item.id)]), [["bot-2", ["d", "c"]], ["bot-10", ["b"]], [null, ["a"]]]);
});

test("named browsers group by name between Bot and legacy unassigned profiles; a legacy profile is never named", () => {
  const legacy = profile({ id: "legacy", botId: null, name: null, default: false });
  const groups = groupProfiles([named("zeta"), legacy, profile({ id: "bot", name: null }), named("alpha")]);
  assert.deepEqual(groups.map((group) => [group.botId, group.standalone, group.profiles.map((item) => item.id)]),
    [["bot-1", false, ["bot"]], [null, true, ["id-alpha", "id-zeta"]], [null, false, ["legacy"]]]);
  assert.deepEqual(groupProfiles([named("only")]).map((group) => group.standalone), [true], "no empty unassigned group is invented");
  assert.equal(isStandalone(legacy), false);
  assert.equal(isStandalone(profile({ name: null })), false);
  assert.equal(isStandalone(named("research")), true);
  assert.deepEqual(sortStandalone([named("b"), named("a-1"), named("a")]).map((item) => item.name), ["a", "a-1", "b"]);
});

test("creation checks the exact name rule without normalizing, and an existing name or a full owner is not offered", () => {
  for (const name of ["research", "major-briggs", "-", "a", "9-lives-", "a".repeat(40)]) assert.equal(standaloneCreateBlock(name, "", [], 3), null, name);
  for (const name of ["Research", "with space", " research", "research ", "a/b", "a_b", "é", "a".repeat(41)]) assert.match(standaloneCreateBlock(name, "", [], 3), /lowercase/, name);
  assert.equal(standaloneCreateBlock("", "", [], 3), "Enter a name");
  assert.match(standaloneCreateBlock("ok", "x".repeat(129), [], 3), /128/);
  assert.equal(standaloneCreateBlock("ok", "x".repeat(128), [], 3), null);
  assert.match(standaloneCreateBlock("research", "", [named("research")], 3), /already exists; creating it again changes nothing/);
  assert.match(standaloneCreateBlock("new", "", [], 16), /All 16 browser profiles are in use, Bot profiles included/);
  assert.equal(standaloneCreateBlock("new", "", null, null), null, "unknown counts never block; the API decides");
});

test("stop intent beside failure means an unconfirmed stop, not a startup failure", () => {
  assert.equal(standaloneStatus({ state: "failed", stopped: true }).label, "Stop failed");
  assert.match(standaloneStatus({ state: "failed", stopped: true }).hint, /VM may still be running/);
  assert.equal(standaloneStatus({ state: "failed", stopped: false }).label, "Failed");
  assert.match(standaloneStatus({ state: "starting", stopped: false }).hint, /not ready/);
  for (const state of ["starting", "ready", "recovering", "failed", "stopping", "stopped", "deleting"]) assert.ok(standaloneStatus({ state, stopped: false }).label, state);
});

test("lifecycle actions follow state, and fences and handoffs block all of them", () => {
  const actions = (patch, handoffs = []) => { const { start, stop, blocked } = standaloneActions(named("research", patch), handoffs); return [start, stop, blocked]; };
  assert.deepEqual(actions({ state: "ready" }), [false, true, null]);
  assert.deepEqual(actions({ state: "starting" }), [false, true, null]);
  assert.deepEqual(actions({ state: "recovering" }), [false, true, null]);
  assert.deepEqual(actions({ state: "stopped", stopped: true }), [true, false, null]);
  assert.deepEqual(actions({ state: "failed", stopped: true }), [true, true, null], "an unconfirmed stop can be retried or reversed");
  assert.deepEqual(actions({ state: "failed" }), [true, true, null]);
  assert.deepEqual(actions({ state: "stopping", stopped: true }), [false, false, null]);
  assert.deepEqual(actions({ state: "deleting", stopped: true }), [false, false, null]);
  assert.deepEqual(actions({ state: "stopped", maintenanceRequestId: "req" }), [false, false, "Profile maintenance is fenced; inspect its receipt before release"]);
  assert.deepEqual(actions({ state: "ready" }, [handoff({ profileId: "id-research" })]), [false, false, "A handoff holds this browser"]);
  assert.deepEqual(actions({ state: "ready" }, [handoff({ profileId: "id-research", state: "resolved" })]), [false, true, null]);
});

test("connection commands name the exact browser and go through the provider, never a raw CDP port", () => {
  const commands = standaloneConnect("major-briggs").map((item) => item.command);
  assert.deepEqual(commands, ["stack browse drive major-briggs -- open https://example.com", "AGENT_BROWSER_STACK_BROWSER=major-briggs agent-browser --session major-briggs open https://example.com"]);
  assert.ok(commands.every((command) => !/--cdp|127\.0\.0\.1/.test(command)));
});

test("an identical retry reuses the stored intent; a new decision mints a new request", () => {
  let n = 0;
  const mint = () => `req-${++n}`;
  const take = intentFor("take", handoff(), null, {}, mint);
  assert.deepEqual(take, { kind: "take", args: { id: "h1", expectedRevision: 3, requestId: "req-1" } });
  // Unknown outcome, nothing changed: the same request.
  assert.equal(intentFor("take", handoff(), take, {}, mint), take);
  // The take landed and the page reloaded: Reopen repeats the original take despite the newer revision.
  assert.equal(intentFor("take", handoff({ state: "human_controlling", revision: 5 }), take, {}, mint), take);
  // Someone else moved it on: a fresh request against the current revision.
  assert.deepEqual(intentFor("take", handoff({ revision: 6 }), take, {}, mint).args, { id: "h1", expectedRevision: 6, requestId: "req-2" });

  const finish = intentFor("finish", handoff({ state: "human_controlling", revision: 5 }), take, { outcome: "completed", note: "  Signed in  " }, mint);
  assert.deepEqual(finish.args, { id: "h1", expectedRevision: 5, requestId: "req-3", outcome: "completed", note: "Signed in" });
  assert.equal(intentFor("finish", handoff({ state: "returning", revision: 6 }), finish, { outcome: "completed", note: "Signed in" }, mint), finish);
  // A different choice is a different intent.
  assert.notEqual(intentFor("finish", handoff({ state: "human_controlling", revision: 5 }), finish, { outcome: "skipped" }, mint), finish);
  assert.equal("note" in intentFor("finish", handoff(), null, { outcome: "skipped", note: " " }, mint).args, false);
});

test("intents persist per handoff and ignore malformed storage", () => {
  const storage = memory();
  const intent = { kind: "take", args: { id: "h1", expectedRevision: 3, requestId: "req-1" } };
  saveIntent(storage, intent, "h1");
  assert.deepEqual(loadIntent(storage, "h1"), intent);
  assert.equal(loadIntent(storage, "h2"), null);
  storage.setItem("uix.browse.intent.h3", "{not json");
  assert.equal(loadIntent(storage, "h3"), null);
  storage.setItem("uix.browse.intent.h4", JSON.stringify({ kind: "take", args: { id: "other", requestId: "x" } }));
  assert.equal(loadIntent(storage, "h4"), null);
  saveIntent(storage, null, "h1");
  assert.equal(loadIntent(storage, "h1"), null);
  assert.equal(loadIntent(null, "h1"), null);
});

test("viewer windows switch the primary, keep pinned viewers, prune deleted profiles and never persist grants", () => {
  const storage = memory();
  const store = new ViewerWindowStore();
  store.attach(storage);
  assert.equal(store.show("p1"), primaryViewer);
  const second = store.open("p2");
  assert.equal(second, "browse-viewer-2");
  assert.equal(store.show("p2"), second);
  store.grant("h1", "http://127.0.0.1:1/secret/");
  assert.deepEqual(store.getGrants(), { h1: "http://127.0.0.1:1/secret/" });
  assert.ok(![...storage.values.values()].some((value) => value.includes("secret")), "grants stay in memory");
  store.pruneGrants(new Set(["h9"]));
  assert.deepEqual(store.getGrants(), {});
  store.prune(new Set(["p2"]));
  assert.deepEqual(store.getWindows(), [{ id: primaryViewer, profileId: null }, { id: second, profileId: "p2" }]);
  const restored = new ViewerWindowStore();
  storage.setItem("uix.browse-viewers.v1", JSON.stringify([{ id: "browse-viewer-3", profileId: "p3" }, { id: "evil", profileId: "p4" }, { id: "browse-viewer-3", profileId: "dup" }]));
  restored.attach(storage);
  assert.deepEqual(restored.getWindows(), [{ id: primaryViewer, profileId: null }, { id: "browse-viewer-3", profileId: "p3" }]);
});
