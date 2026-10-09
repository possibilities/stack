import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/lib/stack/") && specifier.startsWith("./") && !extname(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { MaintenanceController, clearRecovery, listRecoveries, readRecovery, saveRecovery, stateOperations } = await import("../lib/stack/maintenance.ts");
const { ScopedStorage, notRecorded } = await import("../lib/stack/destination.ts");
const names = { plan: "infer_history_plan", apply: "infer_history_clear", receipt: "infer_state_receipt_get" };
const ready = { local: true, connected: true, exposed: Object.values(names) };
const key = "infer:history";
const plan = (extra = {}) => ({ id: "11111111-1111-4111-8111-111111111111", ownerPackage: "infer", subject: null, action: "history_clear", revision: "rev-1",
  createdAt: "2026-09-30T00:00:00.000Z", expiresAt: "2026-09-30T01:00:00.000Z", resources: ["request a"], blockedBy: [], retained: [], regeneration: [], ...extra });
const input = (extra = {}) => ({ planId: plan().id, expectedRevision: "rev-1", requestId: "22222222-2222-4222-8222-222222222222", ...extra });
const receipt = (status, extra = {}) => ({ requestId: input().requestId, planId: plan().id, ownerPackage: "infer", subject: null, action: "history_clear",
  status, startedAt: "2026-09-30T00:10:00.000Z", completedAt: status === "completed" ? "2026-09-30T00:11:00.000Z" : null,
  outcomes: [], retained: [], regeneration: [], ...extra });
const answer = (status, extra = {}) => (args) => receipt(status, { requestId: args.requestId, ...extra });
// One event-loop turn drains the promise-driven observation scheduler; no clock polling or real server.
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => Promise.withResolvers();

function fakeStorage(overrides = {}) {
  const values = new Map();
  const area = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); },
    key: (index) => [...values.keys()][index] ?? null, get length() { return values.size; }, ...overrides };
  return { values, area, storage: new ScopedStorage({ serverId: "7f3c1d52-9a64-4be1-8c0a-2d5e6f708192", authority: "local", origin: "http://127.0.0.1:8745" }, () => area) };
}

/** Real named-operation adapter over scripted answers; deferred responses expose admission and acceptance races. */
function scriptedOwner(script = {}, selection = { requestIds: ["a"] }, owner = "infer", operationNames = names) {
  const calls = [];
  const operations = stateOperations(async (pkg, name, args) => {
    const kind = Object.keys(operationNames).find((kind) => operationNames[kind] === name);
    calls.push({ kind, pkg, name, args: structuredClone(args) });
    assert.ok(script[kind]?.length, `unexpected ${name} call`);
    const next = script[kind].shift();
    if (next instanceof Error) throw next;
    const value = await (typeof next === "function" ? next(args) : next);
    return kind === "receipt" ? { receipt: value } : value;
  }, owner, operationNames, selection);
  return { calls, operations, callsOf: (kind) => calls.filter((call) => call.kind === kind) };
}

function fixture(t, script = {}, extra = {}) {
  const owner = scriptedOwner(script);
  const storage = fakeStorage().storage;
  const clock = { time: Date.parse("2026-09-30T00:30:00.000Z"), allocations: 0,
    now() { return this.time; }, uuid() { this.allocations++; return `00000000-0000-4000-8000-${String(this.allocations).padStart(12, "0")}`; } };
  let options = { operations: owner.operations, recoveryKey: key, policy: "identical-retry", recovery: storage, environment: { ...ready }, ...extra };
  const flow = new MaintenanceController(options, clock);
  const release = flow.activate();
  t.after(release);
  return { ...owner, flow, storage, clock, release, snapshot: () => flow.getSnapshot(),
    update(change) { options = { ...options, ...change }; flow.update(options); },
    environment(change) { options = { ...options, environment: { ...options.environment, ...change } }; flow.update(options); } };
}

test("recovery stores only identity strings and lists only valid records", () => {
  const { storage } = fakeStorage();
  const exact = input({ botId: "alpha" });
  assert.equal(saveRecovery(storage, "bots:alpha:workspace", exact), true);
  assert.deepEqual(readRecovery(storage, "bots:alpha:workspace").input, exact);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem("state-flow.bots:alpha:workspace")).input).sort(), ["botId", "expectedRevision", "planId", "requestId"]);
  storage.setItem("state-flow.bots:bad", JSON.stringify({ input: { ...exact, body: { secret: "never recover authored content" } }, at: 1 }));
  assert.equal(readRecovery(storage, "bots:bad"), null);
  assert.deepEqual(listRecoveries(storage, "bots:").map((item) => item.key), ["bots:alpha:workspace"]);
  assert.equal(clearRecovery(storage, "bots:alpha:workspace"), true);
  assert.equal(readRecovery(storage, "bots:alpha:workspace"), null);
});

test("prepare requires every declared operation, local authority, connection, storage and owner prerequisite", async (t) => {
  const cases = [
    ...Object.values(names).map((missing) => [missing, { environment: { ...ready, exposed: Object.values(names).filter((name) => name !== missing) } }, new RegExp(missing)]),
    ["discovery pending", { environment: { ...ready, exposed: null } }, /discovery/],
    ["remote", { environment: { ...ready, local: false } }, /local UI/],
    ["disconnected", { environment: { ...ready, connected: false } }, /connection/],
    ["unknown destination", { recovery: null }, /destination|identity|server/i],
    ["owner prerequisite", { environment: { ...ready, prerequisite: "Select current closed Workers first" } }, /Select current/],
  ];
  for (const [label, options, reason] of cases) await t.test(label, async (t) => {
    const f = fixture(t, {}, options);
    assert.equal(f.snapshot().actions.prepare.enabled, false);
    assert.match(f.snapshot().actions.prepare.reason, reason);
    await f.flow.prepare(); await f.flow.apply(); await f.flow.retryIdentical(); await f.flow.readReceipt();
    assert.deepEqual(f.calls, [], "no owner call before readiness");
    assert.equal(f.clock.allocations, 0, "refusal does not allocate recovery identity");
    assert.deepEqual(f.storage.keys(), []);
  });
});

test("saved receipt recovery is independent of plan/apply exposure and the former selection's prerequisite", async (t) => {
  const storage = fakeStorage().storage;
  saveRecovery(storage, key, input());
  const callbacks = [];
  const f = fixture(t, { receipt: [receipt("unknown")] }, { recovery: storage, policy: "receipt-only",
    environment: { ...ready, exposed: [names.receipt], prerequisite: "The former selection no longer exists" },
    onReceipt: (value, selection) => callbacks.push({ value, selection }) });
  await settle();
  assert.deepEqual(f.calls.map((call) => [call.name, call.args]), [[names.receipt, { requestId: input().requestId }]]);
  assert.equal(f.snapshot().flow.receipt.status, "unknown");
  assert.equal(f.snapshot().actions.readReceipt.enabled, true);
  assert.equal(callbacks[0].selection, null, "reload never manufactures a captured selection");
  assert.equal(f.clock.allocations, 0);
});

test("apply rechecks readiness, plan blockers and expiry without allocating or saving a request", async (t) => {
  for (const reason of ["blocker", "expiry", "apply exposure", "receipt exposure", "plan exposure", "connection", "prerequisite", "destination"]) await t.test(reason, async (t) => {
    const f = fixture(t, { plan: [plan(reason === "blocker" ? { blockedBy: ["Stop alpha"] } : {})] });
    await f.flow.prepare();
    if (reason === "expiry") f.clock.time = Date.parse(plan().expiresAt);
    if (reason.endsWith("exposure")) f.environment({ exposed: Object.values(names).filter((name) => name !== names[reason.split(" ")[0]]) });
    if (reason === "connection") f.environment({ connected: false });
    if (reason === "prerequisite") f.environment({ prerequisite: "Worker is no longer closed" });
    if (reason === "destination") f.update({ recovery: null });
    await f.flow.apply();
    assert.equal(f.snapshot().flow.phase, "preview");
    assert.equal(f.callsOf("apply").length, 0);
    assert.equal(f.clock.allocations, 0);
    assert.deepEqual(f.storage.keys(), []);
  });
});

test("write refusal and failed read-back prevent dispatch, and a pre-record guard runs before UUID allocation", async (t) => {
  for (const [label, overrides] of [["quota", { setItem() { throw new Error("quota"); } }], ["not retained", { setItem() {} }]]) await t.test(label, async (t) => {
    const storage = fakeStorage(overrides).storage;
    const f = fixture(t, { plan: [plan()] }, { recovery: storage });
    await f.flow.prepare(); await f.flow.apply();
    assert.equal(f.snapshot().flow.phase, "preview");
    assert.equal(f.snapshot().flow.refused, notRecorded);
    assert.equal(f.callsOf("apply").length, 0);
    assert.equal(readRecovery(storage, key), null);
  });
  const order = [];
  const f = fixture(t, { plan: [plan()], apply: [(args) => { order.push("apply"); assert.deepEqual(readRecovery(f.storage, key).input, args); return answer("completed")(args); }] },
    { guard: () => { order.push("guard refused"); return "Catalog fence was not saved"; } });
  await f.flow.prepare(); await f.flow.apply();
  assert.deepEqual(order, ["guard refused"]);
  assert.equal(f.clock.allocations, 0);
  assert.equal(readRecovery(f.storage, key), null);
  f.update({ guard: () => { order.push("guard saved"); return null; } });
  await f.flow.apply();
  assert.deepEqual(order, ["guard refused", "guard saved", "apply"]);
  assert.equal(f.snapshot().flow.receipt.status, "completed");
});

test("duplicate prepare cannot supersede the admitted selection or make another plan", async (t) => {
  const pending = deferred();
  const f = fixture(t, { plan: [() => pending.promise] });
  const first = f.flow.prepare();
  const duplicate = f.flow.prepare();
  await settle();
  assert.equal(f.snapshot().flow.phase, "preparing");
  assert.equal(f.callsOf("plan").length, 1);
  assert.equal(f.snapshot().actions.prepare.enabled, false);
  pending.resolve(plan());
  await Promise.all([first, duplicate]);
  assert.equal(f.snapshot().flow.plan.id, plan().id);
});

test("prepare captures its selection synchronously before later committed callbacks can replace it", async (t) => {
  const pending = deferred();
  const f = fixture(t, { plan: [() => pending.promise] });
  const preparing = f.flow.prepare();
  const newer = scriptedOwner({ plan: [plan()] }, { requestIds: ["new-choice"] });
  f.update({ operations: newer.operations });
  assert.equal(f.snapshot().flow.phase, "preparing");
  assert.deepEqual(f.callsOf("plan")[0].args, { requestIds: ["a"] });
  pending.resolve(plan()); await preparing;
  assert.deepEqual(f.snapshot().selection, { requestIds: ["a"] });
  assert.deepEqual(newer.calls, []);
});

test("pending apply refuses duplicate effects, replan, discard and close while preserving the exact saved request", async (t) => {
  const pending = deferred();
  const f = fixture(t, { plan: [plan()], apply: [() => pending.promise] });
  await f.flow.prepare();
  const applying = f.flow.apply();
  const saved = readRecovery(f.storage, key);
  assert.equal(f.snapshot().flow.phase, "applying");
  for (const action of ["prepare", "apply", "retry", "discardPlan", "closeReceipt", "forget"]) assert.equal(f.snapshot().actions[action].enabled, false, action);
  await f.flow.apply(); await f.flow.prepare(); await f.flow.retryIdentical();
  f.flow.discardPlan(); f.flow.closeReceipt(); f.flow.forget();
  assert.deepEqual(readRecovery(f.storage, key), saved);
  assert.equal(f.callsOf("plan").length, 1);
  assert.equal(f.callsOf("apply").length, 1);
  assert.equal(f.clock.allocations, 1);
  pending.resolve(answer("running")(saved.input));
  await applying;
  assert.equal(f.snapshot().flow.receipt.status, "running");
});

test("explicit identical retry admits once and resends the original input without a new plan or UUID", async (t) => {
  const pending = deferred();
  const f = fixture(t, { plan: [plan()], apply: [new Error("lost apply"), () => pending.promise], receipt: [null] });
  await f.flow.prepare(); await f.flow.apply();
  assert.equal(f.snapshot().flow.phase, "uncertain");
  assert.equal(f.snapshot().actions.retry.enabled, true);
  const saved = readRecovery(f.storage, key).input;
  const retrying = f.flow.retryIdentical();
  await f.flow.retryIdentical(); await f.flow.apply(); await f.flow.prepare();
  assert.deepEqual(f.callsOf("apply").map((call) => call.args), [saved, saved]);
  assert.equal(f.callsOf("plan").length, 1);
  assert.equal(f.clock.allocations, 1);
  pending.resolve(answer("completed")(saved));
  await retrying;
  assert.equal(readRecovery(f.storage, key), null);
});

test("later selection, callback and operation adapters cannot retarget an admitted plan or effect", async (t) => {
  const pending = deferred(), originalSelection = { requestIds: ["a"], filter: { status: "finished" } };
  const original = scriptedOwner({ plan: [() => pending.promise], apply: [new Error("lost")], receipt: [answer("completed")] }, originalSelection);
  const later = scriptedOwner({}, { requestIds: ["b"] });
  const extra = { botId: "alpha" }, callbacks = [];
  const f = fixture(t, {}, { operations: original.operations, extra });
  const preparing = f.flow.prepare();
  await settle();
  originalSelection.requestIds.push("changed outside the flow");
  originalSelection.filter.status = "running";
  extra.botId = "changed outside the flow";
  f.update({ operations: later.operations, extra: { botId: "alpha" }, onReceipt: (value, selection) => callbacks.push({ value, selection }) });
  pending.resolve(plan()); await preparing; await f.flow.apply();
  assert.deepEqual(original.calls[0].args, { requestIds: ["a"], filter: { status: "finished" } });
  assert.equal(original.callsOf("apply")[0].args.botId, "alpha");
  assert.deepEqual(original.callsOf("receipt")[0].args, { requestId: original.callsOf("apply")[0].args.requestId });
  assert.deepEqual(later.calls, [], "all admitted operations keep the captured owner's adapter");
  assert.deepEqual(callbacks[0].selection, { requestIds: ["a"], filter: { status: "finished" } });
  assert.throws(() => f.update({ extra: { botId: "beta" } }), /binding|routing|subject/);
});

test("a receipt must match captured request, plan, owner, action and subject", async (t) => {
  for (const mismatch of [{ requestId: "other" }, { planId: "other" }, { ownerPackage: "worker" }, { action: "other" }, { subject: { kind: "bot", id: "other" } }]) await t.test(JSON.stringify(mismatch), async (t) => {
    const callbacks = [];
    const f = fixture(t, { plan: [plan()], apply: [answer("completed", mismatch)], receipt: [null] }, { onReceipt: (value) => callbacks.push(value) });
    await f.flow.prepare(); await f.flow.apply();
    assert.equal(f.snapshot().flow.phase, "uncertain");
    assert.deepEqual(callbacks, []);
    assert.ok(readRecovery(f.storage, key), "an unrelated receipt cannot retire this request");
    assert.equal(f.callsOf("apply").length, 1);
  });
});

test("receipt-only policy enforces forbidden retry, replan and close commands directly", async (t) => {
  for (const status of ["unconfirmed", "running", "partial", "unknown"]) await t.test(status, async (t) => {
    const f = fixture(t, { plan: [plan()], apply: [status === "unconfirmed" ? new Error("lost") : answer(status)], receipt: [null] }, { policy: "receipt-only" });
    await f.flow.prepare(); await f.flow.apply();
    const before = f.snapshot().flow, saved = readRecovery(f.storage, key);
    for (const action of ["prepare", "retry", "closeReceipt", "discardPlan", "forget"]) assert.equal(f.snapshot().actions[action].enabled, false, action);
    await f.flow.prepare(); await f.flow.retryIdentical(); await f.flow.apply();
    f.flow.closeReceipt(); f.flow.discardPlan(); f.flow.forget();
    assert.deepEqual(f.snapshot().flow, before);
    assert.deepEqual(readRecovery(f.storage, key), saved);
    assert.equal(f.callsOf("plan").length, 1);
    assert.equal(f.callsOf("apply").length, 1);
  });
});

test("receipt-only blocked receipts permit an explicit fresh plan; completed receipts permit close", async (t) => {
  for (const status of ["blocked", "completed"]) await t.test(status, async (t) => {
    const f = fixture(t, { plan: [plan(), plan({ id: "fresh-plan" })], apply: [answer(status)] }, { policy: "receipt-only" });
    await f.flow.prepare(); await f.flow.apply();
    assert.equal(f.snapshot().actions.closeReceipt.enabled, true);
    assert.equal(readRecovery(f.storage, key), null);
    if (status === "blocked") {
      assert.equal(f.snapshot().actions.prepare.enabled, true);
      await f.flow.prepare();
      assert.equal(f.snapshot().flow.plan.id, "fresh-plan");
    } else { f.flow.closeReceipt(); assert.equal(f.snapshot().flow.phase, "idle"); }
    assert.equal(f.callsOf("apply").length, 1);
  });
});

test("saved-only Source recovery reads and Forgets blocked or unknown receipts without inventing an empty-selection plan", async (t) => {
  for (const status of ["blocked", "unknown"]) await t.test(status, async (t) => {
    const storage = fakeStorage().storage;
    saveRecovery(storage, "source:payloads:old-selection", input());
    const sourceNames = { plan: "github_payload_clear_plan", apply: "github_payload_clear", receipt: "source_state_receipt_get" };
    const owner = scriptedOwner({ receipt: [receipt(status, { ownerPackage: "source" }), receipt(status, { ownerPackage: "source" })] }, {}, "source", sourceNames);
    const callbacks = [];
    const f = fixture(t, {}, { operations: owner.operations, recovery: storage, recoveryKey: "source:payloads:old-selection", policy: "saved-only",
      environment: { ...ready, exposed: [sourceNames.receipt], prerequisite: "Select at least one delivery" }, onReceipt: (value, selection) => callbacks.push(selection) });
    await settle();
    assert.equal(f.snapshot().flow.receipt.status, status);
    for (const action of ["prepare", "apply", "retry"]) assert.equal(f.snapshot().actions[action].enabled, false, action);
    await f.flow.prepare(); await f.flow.apply(); await f.flow.retryIdentical();
    assert.equal(f.snapshot().actions.readReceipt.enabled, true);
    await f.flow.readReceipt();
    assert.deepEqual(callbacks, [null], "an identical receipt does not repeat cleanup using current choices");
    assert.equal(f.snapshot().actions.forget.enabled, true);
    f.flow.forget();
    assert.equal(f.snapshot().flow.phase, "idle");
    assert.equal(readRecovery(storage, "source:payloads:old-selection"), null);
    await f.flow.prepare();
    assert.deepEqual(owner.calls.map((call) => call.kind), ["receipt", "receipt"]);
    assert.equal(f.clock.allocations, 0);
  });
});

test("known partial/unknown admission survives failed and absent rereads and never re-enables retry", async (t) => {
  for (const policy of ["identical-retry", "receipt-only"]) for (const status of ["partial", "unknown"]) await t.test(`${policy}: ${status}`, async (t) => {
    const f = fixture(t, { plan: [plan()], apply: [answer(status, { outcomes: [{ resource: "a", outcome: "unknown", detail: "interrupted" }] })], receipt: [new Error("receipt offline"), null] }, { policy });
    await f.flow.prepare(); await f.flow.apply();
    const evidence = structuredClone(f.snapshot().flow.receipt), saved = readRecovery(f.storage, key);
    await f.flow.readReceipt();
    assert.match(f.snapshot().readError, /receipt offline/);
    assert.deepEqual(f.snapshot().flow.receipt, evidence);
    await f.flow.readReceipt();
    assert.ok(f.snapshot().readError, "missing is a read error, not proof of no admission");
    assert.deepEqual(f.snapshot().flow.receipt, evidence);
    assert.equal(f.snapshot().actions.retry.enabled, false);
    await f.flow.retryIdentical();
    assert.equal(f.callsOf("apply").length, 1);
    assert.deepEqual(readRecovery(f.storage, key), saved);
    assert.equal(f.snapshot().actions.readReceipt.enabled, true, "the visible read action must agree with receipt recovery authority");
  });
});

test("lost apply waits for readiness and automatically reads its exact receipt on reconnect without replay", async (t) => {
  const applying = deferred();
  const f = fixture(t, { plan: [plan()], apply: [() => applying.promise], receipt: [null, answer("partial")] });
  await f.flow.prepare();
  const sent = f.flow.apply();
  const saved = readRecovery(f.storage, key);
  f.environment({ connected: false });
  applying.reject(new Error("connection lost")); await sent;
  assert.equal(f.callsOf("receipt").length, 0);
  assert.equal(f.snapshot().flow.phase, "uncertain");
  f.environment({ connected: true, exposed: [names.receipt], prerequisite: "Original resources disappeared" });
  await settle();
  assert.deepEqual(f.callsOf("receipt").map((call) => call.args), [{ requestId: saved.input.requestId }]);
  assert.equal(f.snapshot().flow.phase, "uncertain");
  assert.deepEqual(readRecovery(f.storage, key), saved);
  f.flow.invalidate(); await settle();
  assert.equal(f.snapshot().flow.receipt.status, "partial");
  assert.equal(f.callsOf("apply").length, 1);
  assert.equal(f.clock.allocations, 1);
});

test("owner invalidations during a read coalesce into one follow-up, retain admission and never poll after errors", async (t) => {
  const first = deferred(), followup = deferred(), callbacks = [];
  const f = fixture(t, { plan: [plan()], apply: [answer("running")], receipt: [() => first.promise, () => followup.promise] }, { onReceipt: (value) => callbacks.push(value.status) });
  await f.flow.prepare(); await f.flow.apply();
  const reading = f.flow.readReceipt();
  f.flow.invalidate(); f.flow.invalidate(); f.flow.invalidate();
  assert.equal(f.callsOf("receipt").length, 1);
  first.resolve(answer("partial")(f.snapshot().flow.input)); await reading; await settle();
  assert.equal(f.snapshot().flow.receipt.status, "partial", "a newer invalidation must not discard admission evidence");
  assert.equal(f.callsOf("receipt").length, 2);
  assert.equal(f.snapshot().reading, true);
  followup.reject(new Error("owner went away")); await settle(); await settle();
  assert.equal(f.snapshot().flow.receipt.status, "partial");
  assert.deepEqual(callbacks, ["running", "partial"]);
  assert.match(f.snapshot().readError, /owner went away/);
  assert.equal(f.callsOf("receipt").length, 2, "an error alone owes no further read");
});

test("an owner invalidation raised synchronously as receipt observation starts owes only one follow-up", async (t) => {
  const current = deferred();
  const f = fixture(t, { plan: [plan()], apply: [answer("running")], receipt: [() => {
    f.flow.invalidate(); f.flow.invalidate(); return current.promise;
  }, answer("unknown")] });
  await f.flow.prepare(); await f.flow.apply();
  const reading = f.flow.readReceipt();
  assert.equal(f.callsOf("receipt").length, 1);
  current.resolve(receipt("running", { requestId: f.snapshot().flow.input.requestId }));
  await reading; await settle();
  assert.equal(f.callsOf("receipt").length, 2);
  assert.equal(f.snapshot().flow.receipt.status, "unknown");
});

test("identical accepted receipts do not repeat callbacks or create a resource-refresh/read loop", async (t) => {
  const callbacks = [];
  const f = fixture(t, { plan: [plan()], apply: [answer("running")], receipt: [answer("running"), answer("completed"), answer("completed")] },
    { onReceipt: (value, selection) => { callbacks.push({ status: value.status, selection }); f.environment({ connected: true }); } });
  await f.flow.prepare(); await f.flow.apply(); await settle();
  assert.equal(f.callsOf("receipt").length, 0, "a successful owner refresh is not an invalidation");
  await f.flow.readReceipt(); await f.flow.readReceipt(); await f.flow.readReceipt();
  assert.deepEqual(callbacks.map((value) => value.status), ["running", "completed"]);
  assert.deepEqual(callbacks[1].selection, { requestIds: ["a"] });
  f.flow.invalidate(); await settle();
  assert.equal(f.callsOf("receipt").length, 3, "completed receipt ends automatic observation");
});

test("callback failure is a presentation error, never admission uncertainty or retry authority", async (t) => {
  const f = fixture(t, { plan: [plan()], apply: [answer("completed")], receipt: [answer("completed")] }, { onReceipt: () => { throw new Error("refresh failed"); } });
  await f.flow.prepare(); await f.flow.apply();
  assert.equal(f.snapshot().flow.phase, "receipt");
  assert.equal(f.snapshot().flow.receipt.status, "completed");
  assert.match(f.snapshot().error, /refresh failed/);
  assert.equal(f.snapshot().actions.retry.enabled, false);
  assert.equal(readRecovery(f.storage, key), null);
  await f.flow.retryIdentical();
  assert.equal(f.callsOf("apply").length, 1);
});

test("last Activity release fences a pending receipt; reactivation reads again and rejects the old reply", async (t) => {
  const old = deferred(), current = deferred(), storage = fakeStorage().storage, callbacks = [];
  saveRecovery(storage, key, input());
  const f = fixture(t, { receipt: [() => old.promise, () => current.promise] }, { recovery: storage, onReceipt: (value) => callbacks.push(value.status) });
  assert.equal(f.callsOf("receipt").length, 1);
  f.release(); f.release();
  assert.equal(f.snapshot().reading, false);
  assert.deepEqual(readRecovery(storage, key).input, input());
  f.flow.invalidate(); await settle();
  assert.equal(f.callsOf("receipt").length, 1);
  const release = f.flow.activate(); t.after(release);
  assert.equal(f.callsOf("receipt").length, 2);
  old.resolve(receipt("completed")); await settle();
  assert.equal(f.snapshot().reading, true, "obsolete read cannot finish current progress");
  assert.deepEqual(callbacks, []);
  assert.ok(readRecovery(storage, key));
  current.resolve(receipt("unknown")); await settle();
  assert.equal(f.snapshot().flow.receipt.status, "unknown");
  assert.deepEqual(callbacks, ["unknown"]);
});

test("an interrupted prepare cannot replace the next activation's preview", async (t) => {
  const old = deferred();
  const f = fixture(t, { plan: [() => old.promise, plan({ id: "new-plan" })] });
  const preparing = f.flow.prepare(); await settle();
  f.release();
  assert.equal(f.snapshot().flow.phase, "idle");
  const release = f.flow.activate(); t.after(release);
  await f.flow.prepare();
  old.resolve(plan({ id: "old-plan" })); await preparing;
  assert.equal(f.snapshot().flow.plan.id, "new-plan");
  assert.equal(f.callsOf("apply").length, 0);
  assert.equal(f.clock.allocations, 0);
});

test("Activity release during apply retains dispatch bookkeeping and resumes only through receipt observation", async (t) => {
  const sent = deferred(), callbacks = [];
  const f = fixture(t, { plan: [plan()], apply: [() => sent.promise], receipt: [answer("partial")] }, { onReceipt: (value) => callbacks.push(value.status) });
  await f.flow.prepare();
  const applying = f.flow.apply(), saved = readRecovery(f.storage, key);
  f.release();
  const release = f.flow.activate(); t.after(release);
  await f.flow.prepare(); await f.flow.apply(); await f.flow.retryIdentical();
  assert.equal(f.callsOf("receipt").length, 0, "pending effect is not mistaken for an unconfirmed resendable request");
  sent.resolve(answer("completed")(saved.input)); await applying;
  assert.equal(f.callsOf("apply").length, 1);
  assert.equal(f.callsOf("receipt").length, 1);
  assert.equal(f.snapshot().flow.receipt.status, "partial", "resumption observes owner evidence instead of accepting a detached presentation reply");
  assert.deepEqual(callbacks, ["partial"]);
  assert.deepEqual(readRecovery(f.storage, key), saved);
});

test("an apply settling while inactive is preserved until a readiness-gated reactivation", async (t) => {
  const sent = deferred();
  const f = fixture(t, { plan: [plan()], apply: [() => sent.promise], receipt: [answer("unknown")] });
  await f.flow.prepare(); const applying = f.flow.apply();
  const saved = readRecovery(f.storage, key);
  f.release(); sent.reject(new Error("lost")); await applying;
  assert.equal(f.snapshot().flow.phase, "uncertain");
  assert.equal(f.callsOf("receipt").length, 0);
  f.environment({ connected: false });
  const release = f.flow.activate(); t.after(release); await settle();
  assert.equal(f.callsOf("receipt").length, 0);
  f.environment({ connected: true }); await settle();
  assert.equal(f.snapshot().flow.receipt.status, "unknown");
  assert.equal(f.callsOf("apply").length, 1);
  assert.deepEqual(readRecovery(f.storage, key), saved);
});

test("passive subscribers create no observation demand and one of two releases does not pause the other", async (t) => {
  const storage = fakeStorage().storage, pending = deferred();
  saveRecovery(storage, key, input());
  const owner = scriptedOwner({ receipt: [() => pending.promise] });
  const flow = new MaintenanceController({ operations: owner.operations, recovery: storage, recoveryKey: key, policy: "receipt-only", environment: ready });
  const unsubscribe = flow.subscribe(() => {}); t.after(unsubscribe);
  await settle(); assert.deepEqual(owner.calls, []);
  const a = flow.activate(), b = flow.activate(); t.after(a); t.after(b);
  a(); a();
  pending.resolve(receipt("unknown")); await settle();
  assert.equal(flow.getSnapshot().flow.receipt.status, "unknown");
  assert.equal(owner.callsOf("receipt").length, 1);
});

test("an existing invalid or differently routed recovery record blocks new decisions without removing it", async (t) => {
  for (const value of ["not json", JSON.stringify({ input: input({ botId: "beta" }), at: 1 })]) await t.test(value, async (t) => {
    const storage = fakeStorage().storage;
    storage.setItem(`state-flow.${key}`, value);
    const f = fixture(t, {}, { recovery: storage, extra: { botId: "alpha" } });
    await f.flow.prepare(); await f.flow.apply();
    assert.deepEqual(f.calls, []);
    assert.equal(storage.getItem(`state-flow.${key}`), value);
    assert.equal(f.snapshot().actions.prepare.enabled, false);
  });
});

test("a record that appears after preview prevents apply without overwriting the other request", async (t) => {
  const f = fixture(t, { plan: [plan()] });
  await f.flow.prepare();
  saveRecovery(f.storage, key, input());
  const other = f.storage.getItem(`state-flow.${key}`);
  await f.flow.apply();
  assert.equal(f.callsOf("apply").length, 0);
  assert.equal(f.storage.getItem(`state-flow.${key}`), other);
});

test("identical retry verifies every saved input field and refuses a changed recovery record", async (t) => {
  const f = fixture(t, { plan: [plan()], apply: [new Error("lost")], receipt: [null] });
  await f.flow.prepare(); await f.flow.apply();
  saveRecovery(f.storage, key, { ...f.snapshot().flow.input, expectedRevision: "changed" });
  const other = f.storage.getItem(`state-flow.${key}`);
  await f.flow.retryIdentical();
  assert.equal(f.callsOf("apply").length, 1);
  assert.equal(f.storage.getItem(`state-flow.${key}`), other);
  assert.equal(f.snapshot().actions.retry.enabled, false);
});

test("discarding an unsubmitted preview must preserve a request written into its recovery slot by another flow", async (t) => {
  const f = fixture(t, { plan: [plan()] });
  await f.flow.prepare(); saveRecovery(f.storage, key, input());
  const other = f.storage.getItem(`state-flow.${key}`);
  f.flow.discardPlan();
  assert.equal(f.storage.getItem(`state-flow.${key}`), other, "discard owns the preview, not an unrelated recovery record");
});

test("explicit replan must not erase a conflicting saved request", async (t) => {
  const f = fixture(t, { plan: [plan(), plan({ id: "new-plan" })], apply: [new Error("lost")], receipt: [null] });
  await f.flow.prepare(); await f.flow.apply();
  saveRecovery(f.storage, key, input({ requestId: "another-request" }));
  const other = f.storage.getItem(`state-flow.${key}`);
  await f.flow.prepare();
  assert.equal(f.storage.getItem(`state-flow.${key}`), other);
  assert.equal(f.callsOf("plan").length, 1, "conflict is refused before a new plan");
});

test("settled receipt cleanup compares the full stored identity before removing its recovery record", async (t) => {
  const pending = deferred();
  const f = fixture(t, { plan: [plan()], apply: [() => pending.promise] });
  await f.flow.prepare(); const applying = f.flow.apply();
  const own = f.snapshot().flow.input;
  saveRecovery(f.storage, key, { ...own, expectedRevision: "different-revision" });
  const other = f.storage.getItem(`state-flow.${key}`);
  pending.resolve(answer("completed")(own)); await applying;
  assert.equal(f.snapshot().flow.receipt.status, "completed", "conflicting storage does not erase accepted admission evidence");
  assert.equal(f.storage.getItem(`state-flow.${key}`), other, "same request/plan IDs do not make changed exact input ours to delete");
  f.flow.closeReceipt();
  assert.equal(f.storage.getItem(`state-flow.${key}`), other);
});
