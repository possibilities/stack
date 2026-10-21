import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/lib/stack/") && specifier.startsWith("./") && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { appliedObservations, catalogGroups, chooseVersion, clearOperatorRequest, clearPageOpen, draftBlock, draftChanged, draftFrom, extensionLabel, importBlock, loadOperatorRequest,
  loadPageOpen, managementEntries, matchOperatorRequest, newestHandoff, operatorRequestBlock, pageOpenInput, sameSelection, saveOperatorRequest, savePageOpen, selectionChanges, setInput,
  setupSteps, staleConfiguration, vaultPrerequisite, vaultSelection, vaultSettling, BrowseManagementReads } = await import("../lib/stack/browse-management.ts");

const digest = (char) => char.repeat(64);
const record = (id, char, patch = {}) => ({ id, digest: digest(char), chromeId: "a".repeat(32), name: id, version: "1.0", permissions: [], hostPermissions: [], optionalPermissions: [], optionalHostPermissions: [],
  contentMatches: [], importedAt: "2026-10-21T10:00:00Z", source: "zip", bytes: 10, popup: null, options: null, ...patch });
const config = (patch = {}) => ({ profileId: "p1", revision: "c1", desired: [], applied: null, appliedAt: null, observedAt: null, observed: null, issue: null, vaultId: null, appliedVault: null, ...patch });
const connection = { id: "v1", origin: "https://vault-v1.stack.invalid:41000", hostname: "vault-v1.stack.invalid", ip: "10.0.0.1", spki: "key" };
const status = (patch = {}) => ({ id: "v1", version: "1.37.4", image: "image", revision: "r1", desiredRunning: true, state: "running", healthy: true, signupsAllowed: false, instanceId: "i", volumeId: "v", fence: null, connection, blockedBy: [], ...patch });
const handoff = (patch = {}) => ({ id: "h1", profileId: "p1", origin: "operator", botId: null, threadId: null, instance: null, requestId: "r1", targetId: null, targetStatus: "unspecified", message: "m",
  state: "awaiting_human", outcome: null, note: null, revision: 2, createdAt: "2026-10-21T10:00:00Z", resolvedAt: null, issue: null, quiesced: true, contentClearedAt: null, requestDigest: null, ...patch });
function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), values };
}

test("catalog groups keep distinct digests with the same version label and never resolve localization keys", () => {
  const groups = catalogGroups([record("zeta", "1"), record("alpha", "2", { importedAt: "2026-10-20T00:00:00Z" }), record("alpha", "3")]);
  assert.deepEqual(groups.map((group) => group.id), ["alpha", "zeta"]);
  assert.deepEqual(groups[0].versions.map((row) => row.digest), [digest("3"), digest("2")], "newest import first");
  assert.deepEqual(groups[0].repeatedLabels, ["1.0"]);
  assert.deepEqual(extensionLabel(record("bitwarden", "4", { name: "__MSG_extName__" })), { text: "bitwarden", localized: true });
  assert.deepEqual(extensionLabel(record("x", "4", { name: "Readable" })), { text: "Readable", localized: false });
});

test("imports name a server-local absolute path and never the reserved Bitwarden ID", () => {
  assert.equal(importBlock("my-ext", "/srv/ext"), null);
  for (const [id, path] of [["", "/x"], ["My", "/x"], ["1x", "/x"], ["bitwarden", "/x"], ["ok", ""], ["ok", "relative/path"], ["ok", `/${"a".repeat(4096)}`], ["a".repeat(49), "/x"]]) assert.ok(importBlock(id, path), `${id} ${path}`);
});

test("selections compare exact digests; removal disables rather than uninstalls", () => {
  const a = [{ id: "x", digest: digest("1") }], b = [{ id: "x", digest: digest("2") }];
  assert.equal(sameSelection(a, a), true);
  assert.equal(sameSelection(a, b), false, "same catalog ID at different bytes differs");
  assert.equal(sameSelection(null, []), false, "never applied is not an empty application");
  assert.deepEqual(selectionChanges(a, []), [{ id: "x", from: digest("1"), to: null }]);
  assert.deepEqual(selectionChanges(null, b), [{ id: "x", from: null, to: digest("2") }]);
});

test("drafts save exactly, keep omitted and null vault bindings distinct, and refuse a stale base", () => {
  const catalog = [record("x", "1"), record("x", "2"), record("y", "3")];
  const saved = config({ desired: [{ id: "x", digest: digest("1") }], vaultId: "v1" });
  let draft = draftFrom(saved);
  assert.equal(draftBlock(draft, saved, catalog), "Nothing to save");
  draft = chooseVersion(draft, "x", digest("2"));
  assert.equal(draftChanged(draft, saved), true);
  assert.equal(draftBlock(draft, saved, catalog), null);
  assert.deepEqual(setInput("p1", draft), { profileId: "p1", expectedRevision: "c1", extensions: [{ id: "x", digest: digest("2") }] }, "omitted vaultId preserves the binding");
  assert.deepEqual(setInput("p1", { ...draft, vaultId: null }).vaultId, null, "null removes it");
  assert.equal(draftChanged({ ...draftFrom(saved), vaultId: "v1" }, saved), false, "the same binding is not a change");
  assert.equal(draftChanged({ ...draftFrom(saved), vaultId: null }, saved), true);
  assert.deepEqual(chooseVersion(draft, "x", null).refs, [], "an explicit empty selection disables all");
  assert.match(draftBlock(draft, { ...saved, revision: "c2" }, catalog), /changed since this draft began/);
  assert.match(draftBlock(chooseVersion(draft, "z", digest("9")), saved, catalog), /not in the catalog/);
  assert.match(draftBlock({ ...draft, refs: Array.from({ length: 33 }, (_, index) => ({ id: `e${index}`, digest: digest("1") })) }, saved, catalog), /at most 32/);
  assert.equal(staleConfiguration(new Error("Extension configuration changed; read it again")), true);
  assert.equal(staleConfiguration("Extension configuration changed; prepare a new plan"), true);
});

test("applied versions are compared with the observed Chrome identity and version, never assumed loaded", () => {
  const catalog = [record("x", "1", { chromeId: "b".repeat(32), version: "2.0" })];
  const applied = config({ applied: [{ id: "x", digest: digest("1") }] });
  assert.equal(appliedObservations(applied, catalog)[0].observed, "unobserved");
  assert.equal(appliedObservations({ ...applied, observed: [{ id: "b".repeat(32), name: "x", version: "2.0" }] }, catalog)[0].observed, "matching");
  assert.equal(appliedObservations({ ...applied, observed: [{ id: "b".repeat(32), name: "x", version: "1.9" }] }, catalog)[0].observed, "different");
  assert.equal(appliedObservations({ ...applied, observed: [] }, catalog)[0].observed, "absent");
});

test("management pages exist only for an applied binding or declared entry points, mirroring owner refusals", () => {
  const catalog = [record("bitwarden", "1", { popup: "popup/index.html", options: null })];
  const applied = config({ applied: [{ id: "bitwarden", digest: digest("1") }], appliedVault: connection });
  const reasons = (entries) => Object.fromEntries(entries.map((entry) => [entry.key, entry.reason]));
  assert.deepEqual(reasons(managementEntries(applied, catalog, status())), { vault: null, "vault:register": "Registration is closed on the service", "extension:bitwarden:popup": null });
  assert.equal(reasons(managementEntries(applied, catalog, status({ signupsAllowed: true })))["vault:register"], null);
  assert.match(reasons(managementEntries(applied, catalog, status({ connection: { ...connection, spki: "other" } }))).vault, /reapply/);
  assert.match(reasons(managementEntries(applied, catalog, status({ healthy: false }))).vault, /not verified healthy/);
  assert.match(reasons(managementEntries(applied, catalog, status({ id: "v2" }))).vault, /not the current managed service/);
  assert.match(reasons(managementEntries(config({ desired: [{ id: "bitwarden", digest: digest("1") }], vaultId: "v1" }), catalog, status())).vault, /No vault connection is applied/, "saved is not applied");
  assert.deepEqual(managementEntries(config({ desired: [{ id: "bitwarden", digest: digest("1") }] }), catalog, status()).map((entry) => entry.key), ["vault", "vault:register"], "unapplied extensions have no entry");
  assert.deepEqual(managementEntries(null, catalog, status()), []);
});

test("operator requests and page opens record exact input first, recover only by exact evidence, and never mint a replacement", () => {
  const storage = memory();
  const request = { profileId: "p1", requestId: "r1", message: "Setup", at: 1 };
  assert.equal(saveOperatorRequest(null, request), false, "no destination storage means nothing is sent");
  assert.equal(saveOperatorRequest(storage, request), true);
  assert.deepEqual(loadOperatorRequest(storage, "p1"), request);
  assert.equal(loadOperatorRequest(storage, "p2"), null);
  storage.setItem("uix.browse.operator-request.p2", "{bad");
  assert.equal(loadOperatorRequest(storage, "p2"), "invalid", "an unreadable record is preserved, not treated as absent");
  assert.equal(matchOperatorRequest([handoff({ origin: "bot", requestId: "r1" })], request), null, "origin must match");
  assert.equal(matchOperatorRequest([handoff({ profileId: "p2" })], request), null, "profile must match");
  assert.equal(matchOperatorRequest([handoff()], request).id, "h1");
  assert.equal(clearOperatorRequest(storage, "p1"), true);
  const page = { handoffId: "h1", expectedRevision: 2, requestId: "q1", page: { kind: "extension", id: "bitwarden", entry: "popup" }, at: 1 };
  assert.equal(savePageOpen(storage, page), true);
  assert.deepEqual(loadPageOpen(storage, "h1"), page);
  assert.deepEqual(pageOpenInput(page), { handoffId: "h1", expectedRevision: 2, requestId: "q1", page: page.page });
  storage.setItem("uix.browse.page-open.h2", JSON.stringify({ ...page, handoffId: "h2", page: { kind: "url", href: "https://example.com" } }));
  assert.equal(loadPageOpen(storage, "h2"), "invalid", "no arbitrary page shape is accepted");
  assert.equal(clearPageOpen(storage, "h1"), true);
  const failing = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem() {} };
  assert.equal(savePageOpen(failing, page), false);
});

test("requests need a ready, unfenced, unheld profile; take uses the newest revision the owner answered", () => {
  const profile = { id: "p1", state: "ready", maintenanceRequestId: null };
  assert.equal(operatorRequestBlock(profile, []), null);
  assert.match(operatorRequestBlock({ ...profile, state: "stopped" }, []), /never launches/);
  assert.match(operatorRequestBlock({ ...profile, maintenanceRequestId: "m" }, []), /fenced/);
  assert.match(operatorRequestBlock(profile, [handoff()]), /already holds/);
  assert.equal(operatorRequestBlock(profile, [handoff({ state: "resolved" })]), null);
  assert.equal(operatorRequestBlock(profile, null), "Read handoffs first");
  assert.equal(newestHandoff(handoff({ revision: 2 }), handoff({ revision: 4 })).revision, 4);
  assert.equal(newestHandoff(handoff({ revision: 5 }), handoff({ revision: 4 })).revision, 5);
  assert.equal(newestHandoff(handoff({ id: "h2" }), handoff()).id, "h2", "a reply for another handoff never substitutes");
  assert.equal(newestHandoff(null, handoff()), null);
});

test("vault selections carry registration only on start and a listed backup only on restore", () => {
  assert.deepEqual(vaultSelection("start", true, "b"), { action: "start", signupsAllowed: true });
  assert.deepEqual(vaultSelection("stop", true, "b"), { action: "stop" });
  assert.deepEqual(vaultSelection("restore", true, "b"), { action: "restore", backupId: "b" });
  assert.match(vaultPrerequisite("start", null, null, null), /registration/);
  assert.equal(vaultPrerequisite("start", false, null, null), null);
  assert.match(vaultPrerequisite("restore", null, "b", [{ id: "a" }]), /no longer listed/);
  assert.equal(vaultPrerequisite("restore", null, "a", [{ id: "a" }]), null);
  assert.equal(vaultSettling(status()), false);
  assert.equal(vaultSettling(status({ healthy: false })), true);
  assert.equal(vaultSettling(status({ desiredRunning: false })), true, "running against stopped intent may still be stopping");
  assert.equal(vaultSettling(status({ state: "absent" })), false);
});

test("setup facts never infer human steps or unlock from health, application or a finished handoff", () => {
  const bitwarden = record("bitwarden", "1", { chromeId: "c".repeat(32), version: "2026.10.0" });
  const profile = { id: "p1", label: "agent", name: "agent", botId: null, state: "ready" };
  const done = config({ desired: [{ id: "bitwarden", digest: digest("1") }], vaultId: "v1", applied: [{ id: "bitwarden", digest: digest("1") }], appliedVault: connection,
    observed: [{ id: "c".repeat(32), name: "Bitwarden", version: "2026.10.0" }] });
  const steps = Object.fromEntries(setupSteps({ status: status(), bitwarden, profile, config: done }).map((step) => [step.key, step.state]));
  assert.deepEqual(steps, { service: "observed", bitwarden: "observed", profile: "observed", saved: "observed", applied: "observed", account: "human", closed: "observed", extension: "human", verify: "human" });
  const saved = Object.fromEntries(setupSteps({ status: status(), bitwarden, profile, config: { ...done, applied: null, appliedVault: null } }).map((step) => [step.key, step.state]));
  assert.equal(saved.saved, "observed");
  assert.equal(saved.applied, "pending", "saving is not applying");
  assert.equal(Object.fromEntries(setupSteps({ status: status({ signupsAllowed: true }), bitwarden, profile, config: done }).map((step) => [step.key, step.state])).closed, "pending");
});

test("configuration observations are per profile: a late answer for one never reaches another", async () => {
  const pending = new Map();
  const reads = new BrowseManagementReads((name, args) => new Promise((resolve) => pending.set(args?.profileId ?? name, resolve)));
  reads.sync("server", () => null);
  const one = reads.configuration("p1"), two = reads.configuration("p2");
  assert.equal(reads.configuration("p1"), one, "the same profile reuses its observation");
  const release = [one.activate(), two.activate()];
  pending.get("p2")(config({ profileId: "p2", revision: "two" }));
  pending.get("p1")(config({ profileId: "p1", revision: "one" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(one.getSnapshot().evidence.value.revision, "one");
  assert.equal(two.getSnapshot().evidence.value.revision, "two");
  // A changed destination scope drops held evidence rather than presenting another server's records.
  reads.sync("other-server", () => null);
  assert.equal(one.getSnapshot().evidence, null);
  release.forEach((done) => done());
});
