import assert from "node:assert/strict";
import test from "node:test";
import { ReadObservation, pagedObservation, observationResource } from "../lib/stack/observation.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const page = (rows = ["first"], extra = {}) => ({ items: rows, revision: "r1", nextOffset: 1, ...extra });
function owner(paged = true) {
  const calls = [];
  const read = (...args) => {
    const answer = Promise.withResolvers();
    calls.push({ args, ...answer });
    return answer.promise;
  };
  const binding = { key: (query) => query, read, now: () => 42 };
  const observation = paged ? pagedObservation({ ...binding,
    append: (held, next) => ({ ...next, items: [...held.items, ...next.items] }),
    revisionRefused: (error) => /restart paging|Worker branch inventory changed/.test(error.message),
  }) : new ReadObservation(binding);
  observation.setQuery("A");
  return { observation, calls, snapshot: observation.getSnapshot, value: () => observation.getSnapshot().evidence?.value };
}
async function first(owner, value = page()) {
  const release = owner.observation.activate();
  owner.calls.at(-1).resolve(value);
  await tick();
  return release;
}

test("stable snapshots distinguish unread, successful null, empty, stale and unavailable", async () => {
  const o = owner(false), { observation: read } = o;
  const unread = o.snapshot();
  assert.equal(unread, o.snapshot());
  assert.equal(unread.evidence, null);
  const unproject = read.subscribe(() => {});
  await read.refresh();
  assert.equal(o.calls.length, 0, "passive subscribers and refresh without demand do not read");
  const release = await first(o, null);
  assert.deepEqual(o.snapshot().evidence, { value: null, receivedAt: 42 });
  assert.equal(observationResource(o.snapshot()).hasRead, true);
  const refresh = read.refresh();
  assert.equal(o.snapshot().pending, "refresh");
  assert.equal(o.snapshot().stale, true);
  o.calls.at(-1).reject(new Error("offline")); await refresh;
  assert.equal(o.snapshot().evidence.value, null);
  assert.equal(o.snapshot().error, "offline");
  read.setUnavailable("connection closed");
  assert.equal(o.snapshot().unavailable, "connection closed");
  await read.refresh(); assert.equal(o.calls.length, 2);
  read.setUnavailable(null);
  assert.equal(o.calls.length, 3, "same-query readiness recovery reads once");
  o.calls.at(-1).resolve([]); await tick();
  assert.deepEqual(o.value(), []);
  release(); unproject();
});

test("last release fences pending results, retains evidence and resumes reversibly", async () => {
  const o = owner();
  const release = await first(o), second = o.observation.activate();
  const old = o.observation.refresh();
  release(); release();
  assert.equal(o.snapshot().pending, "refresh", "an idempotent release does not consume another lease");
  second();
  assert.equal(o.snapshot().pending, null);
  assert.equal(o.snapshot().stale, true);
  assert.deepEqual(o.value().items, ["first"]);
  o.calls[1].resolve(page(["late"])); await old;
  assert.deepEqual(o.value().items, ["first"]);
  const resume = o.observation.activate();
  assert.deepEqual(o.calls.at(-1).args, ["A", 0, undefined], "return refreshes first page, not held depth");
  o.calls.at(-1).resolve(page(["returned"])); await tick();
  assert.deepEqual(o.value().items, ["returned"]);
  resume();
});

test("query changes while inactive and A→B→A fence old data, failures and pending completion", async () => {
  for (const rejected of [false, true]) {
    const o = owner(), release = o.observation.activate();
    release();
    o.observation.setQuery("B");
    o.observation.setQuery("A");
    assert.equal(o.calls.length, 1);
    const resume = o.observation.activate();
    if (rejected) o.calls[0].reject(new Error("old A failure")); else o.calls[0].resolve(page(["old A"]));
    await tick();
    assert.equal(o.snapshot().evidence, null);
    assert.equal(o.snapshot().error, null);
    assert.equal(o.snapshot().pending, "first");
    o.calls[1].resolve(page(["new A"])); await tick();
    assert.deepEqual(o.value().items, ["new A"]);
    resume();
  }
});

test("a new query starts without awaiting an obsolete transport; old reply cannot clear its loading", async () => {
  const o = owner(), release = o.observation.activate();
  o.observation.setQuery("B");
  assert.deepEqual(o.calls.map((call) => call.args[0]), ["A", "B"]);
  o.calls[0].reject(new Error("old connection failed")); await tick();
  assert.equal(o.snapshot().key, "B");
  assert.equal(o.snapshot().pending, "first");
  assert.equal(o.snapshot().error, null);
  o.calls[1].resolve(page(["B"])); await tick();
  release();
});

test("refresh outranks more in both completion orders, including an obsolete failure", async () => {
  for (const order of ["more-first", "refresh-first"]) for (const rejected of [false, true]) {
    const o = owner(), release = await first(o);
    const more = o.observation.more();
    assert.deepEqual(o.calls[1].args, ["A", 1, "r1"]);
    assert.equal(o.observation.more(), more, "duplicate continuation coalesces");
    const refresh = o.observation.refresh();
    assert.equal(o.calls.length, 3, "refresh can start without awaiting obsolete continuation");
    void o.observation.more();
    assert.equal(o.calls.length, 3, "continuation cannot outrank pending refresh");
    const old = async () => { rejected ? o.calls[1].reject(new Error("late error")) : o.calls[1].resolve(page(["old tail"], { nextOffset: null })); await more; };
    const fresh = async () => { o.calls[2].resolve(page(["fresh"], { revision: "r2" })); await refresh; };
    if (order === "more-first") { await old(); assert.equal(o.snapshot().pending, "refresh"); await fresh(); }
    else { await fresh(); await old(); }
    assert.deepEqual(o.value().items, ["fresh"]);
    assert.equal(o.snapshot().error, null);
    assert.equal(o.snapshot().pending, null);
    assert.equal(o.calls.length, 3, "no implicit refill of former page depth");
    release();
  }
});

test("invalidation bursts obsolete an active read and owe one follow-up, never poll", async () => {
  for (const mode of ["first", "more"]) {
    const o = owner();
    const release = mode === "more" ? await first(o) : o.observation.activate();
    if (mode === "more") void o.observation.more();
    const pending = o.calls.at(-1), count = o.calls.length;
    void o.observation.invalidate(); void o.observation.invalidate(); void o.observation.invalidate();
    void o.observation.refresh(); void o.observation.more();
    // An explicit refresh supersedes more; first-page bursts merely coalesce.
    if (mode === "first") assert.equal(o.calls.length, count);
    pending.resolve(page(["obsolete"])); await tick();
    assert.equal(o.calls.length, count + 1);
    assert.notDeepEqual(o.value()?.items, ["obsolete"]);
    assert.deepEqual(o.calls.at(-1).args, ["A", 0, undefined]);
    o.calls.at(-1).reject(new Error("fresh unavailable")); await tick(); await tick();
    assert.equal(o.calls.length, count + 1);
    assert.equal(o.snapshot().error, "fresh unavailable");
    assert.equal(o.snapshot().canMore, false);
    release();
  }
});

test("successful invalidation follow-up itself accepts a later invalidation without losing it", async () => {
  const o = owner(), release = await first(o);
  const refresh = o.observation.invalidate();
  void o.observation.invalidate(); void o.observation.invalidate();
  o.calls[1].resolve(page(["obsolete"])); await tick();
  assert.equal(o.calls.length, 3);
  void o.observation.invalidate();
  o.calls[2].resolve(page(["also obsolete"])); await tick();
  assert.equal(o.calls.length, 4);
  o.calls[3].resolve(page(["current"])); await refresh;
  assert.deepEqual(o.value().items, ["current"]);
  release();
});

test("ordinary more failure preserves a retryable prefix; failed refresh disables continuation", async () => {
  const o = owner(), release = await first(o);
  const more = o.observation.more(); o.calls[1].reject(new Error("temporary transport failure")); await more;
  assert.deepEqual(o.value().items, ["first"]);
  assert.equal(o.snapshot().stale, false);
  assert.equal(o.snapshot().canMore, true);
  const again = o.observation.more();
  assert.deepEqual(o.calls[2].args, o.calls[1].args);
  o.calls[2].resolve(page(["tail"], { nextOffset: null })); await again;
  const refresh = o.observation.refresh(); o.calls[3].reject(new Error("refresh failed")); await refresh;
  assert.deepEqual(o.value().items, ["first", "tail"]);
  assert.equal(o.snapshot().stale, true);
  await o.observation.more(); assert.equal(o.calls.length, 4);
  release();
});

test("classified revision refusals and mismatched replies restart once; failed restart preserves stale prefix", async () => {
  for (const kind of ["refusal", "worker", "mismatch"]) for (const fail of [false, true]) {
    const o = owner(), release = await first(o);
    const more = o.observation.more();
    if (kind === "mismatch") o.calls[1].resolve(page(["wrong revision tail"], { revision: "r2" }));
    else o.calls[1].reject(new Error(kind === "worker" ? "Worker branch inventory changed" : "restart paging"));
    await tick();
    assert.equal(o.calls.length, 3);
    assert.deepEqual(o.calls[2].args, ["A", 0, undefined]);
    assert.equal(o.snapshot().canMore, false);
    if (fail) o.calls[2].reject(new Error("restart paging")); else o.calls[2].resolve(page(["replacement"], { revision: "r2" }));
    await more;
    assert.equal(o.calls.length, 3, "first-page refusal is not recursively retried");
    if (fail) {
      assert.deepEqual(o.value().items, ["first"]);
      assert.equal(o.snapshot().stale, true);
      await o.observation.more(); assert.equal(o.calls.length, 3);
      const refresh = o.observation.refresh(); o.calls[3].resolve(page(["recovered"], { revision: "r3" })); await refresh;
      assert.equal(o.snapshot().canMore, true);
    } else {
      assert.deepEqual(o.value().items, ["replacement"]);
      assert.equal(o.value().restarted, true);
    }
    release();
  }
});

test("continuation keeps full latest-page metadata, without sums, unions or first-page retention", async () => {
  const o = owner();
  const firstMeta = { total: 50, truncated: true, observedAt: "first", commitsScanned: 7, paths: ["old"], remotes: ["old"], retained: ["old"], owners: [{ available: false, issue: "first" }] };
  const latest = { total: 8, truncated: false, observedAt: "latest", commitsScanned: 9, paths: ["new"], remotes: [], retained: ["Independent copies stay"], owners: [{ available: true, issue: null }] };
  const release = await first(o, page(["a"], firstMeta));
  const more = o.observation.more(); o.calls[1].resolve(page(["b"], { ...latest, nextOffset: null })); await more;
  assert.deepEqual(o.value(), { ...page(["a", "b"], { ...latest, nextOffset: null }), restarted: false });
  release();
});

test("availability loss fences more and errors; reconnect requires a fresh first page", async () => {
  const o = owner(), release = await first(o);
  const more = o.observation.more();
  o.observation.setUnavailable("operation no longer exposed");
  o.calls[1].reject(new Error("old failure")); await more;
  assert.equal(o.snapshot().error, null);
  assert.equal(o.snapshot().canMore, false);
  assert.equal(o.snapshot().stale, true);
  o.observation.setUnavailable(null);
  assert.deepEqual(o.calls[2].args, ["A", 0, undefined]);
  o.calls[2].resolve(page(["new"])); await tick();
  release();
});

test("admitted calls capture their binding and explicit reveal query removal fences sensitive late answers", async () => {
  const answers = [Promise.withResolvers(), Promise.withResolvers()];
  const read = new ReadObservation({ key: (query) => query.key, read: (query) => query.read() });
  read.setQuery({ key: "row:r1", read: () => answers[0].promise });
  const release = read.activate();
  read.setQuery(null);
  read.setQuery({ key: "row:r2", read: () => answers[1].promise });
  answers[0].resolve("old sensitive arguments"); await tick();
  assert.equal(read.getSnapshot().evidence, null);
  answers[1].resolve(null); await tick();
  assert.equal(read.getSnapshot().evidence.value, null, "successful missing lookup remains different from unread");
  release();
});
