import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/lib/stack/") && specifier.startsWith("./") && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { tabs, split, paneIds, removePane, placePane, activatePane, resizeSplit, projectLayout, neighborPane, parseTree } = await import("../lib/stack/pane-layout.ts");

const initial = () => split("x", [tabs("list"), 0.3], [split("y", [tabs("editor", "preview"), 0.6], [tabs("history"), 0.4]), 0.7]);

test("moving between split parents preserves each pane once and collapses empty containers", () => {
  const original = initial();
  const frozen = JSON.stringify(original);
  const moved = placePane(original, "history", "list", "left");
  assert.deepEqual(paneIds(moved), ["history", "list", "editor", "preview"]);
  assert.equal(moved.children[1].type, "stack");
  assert.equal(JSON.stringify(original), frozen);
  const tabbed = placePane(moved, "list", "editor", "tab");
  assert.deepEqual(paneIds(tabbed), ["history", "editor", "preview", "list"]);
  assert.equal(tabbed.children[1].active, "list");
  assert.equal(placePane(tabbed, "list", "list", "right"), tabbed);
  assert.equal(placePane(tabbed, "list", "missing", "right"), tabbed);
  assert.equal(removePane(tabs("last"), "last"), null);
});

test("tab activation and removal select an existing neighboring tab without changing other stacks", () => {
  const tree = tabs("a", "b", "c");
  const active = activatePane(tree, "b");
  assert.equal(active.active, "b");
  assert.equal(removePane(active, "b").active, "c");
  assert.equal(removePane(activatePane(tree, "c"), "c").active, "b");
  assert.equal(activatePane(tree, "missing"), tree);
});

test("projected tiles and dividers exactly share the viewport; focus uses visual neighbors", () => {
  const tree = initial();
  const { stacks, dividers, compact } = projectLayout(tree, { width: 1200, height: 800 });
  assert.equal(compact, false);
  assert.equal(stacks.length, 3);
  const left = stacks.find((s) => s.tabs.includes("list"));
  const editor = stacks.find((s) => s.tabs.includes("editor"));
  const history = stacks.find((s) => s.tabs.includes("history"));
  assert.equal(editor.x + editor.width, 1200);
  assert.equal(history.y + history.height, 800);
  assert.equal(editor.x, left.width + 8);
  assert.equal(history.y, editor.height + 8);
  assert.equal(dividers.length, 2);
  assert.equal(neighborPane(stacks, "editor", "down"), "history");
  assert.equal(neighborPane(stacks, "history", "left"), "list");
  assert.equal(neighborPane(stacks, "list", "left"), null);
  const resized = resizeSplit(tree, tree.id, 0, 0.5);
  const wide = projectLayout(resized, { width: 1200, height: 800 });
  assert.equal(wide.stacks[0].width, 596);
  assert.deepEqual(paneIds(resized), ["list", "editor", "preview", "history"]);
});

test("narrow projection does not rewrite desktop proportions or create unreadably small panes", () => {
  const tree = initial();
  const saved = JSON.stringify(tree);
  const narrow = projectLayout(tree, { width: 320, height: 600 }, "preview");
  assert.equal(narrow.compact, true);
  assert.deepEqual(narrow.stacks[0].tabs, ["list", "editor", "preview", "history"]);
  assert.equal(narrow.stacks[0].active, "preview");
  assert.equal(narrow.stacks[0].width, 320);
  assert.deepEqual(narrow.dividers, []);
  assert.equal(JSON.stringify(tree), saved);
  const reading = projectLayout(tree, { width: 1200, height: 800 }, "editor", { editor: { width: 1000, height: 240 } });
  assert.equal(reading.compact, true);
  assert.equal(reading.stacks[0].active, "editor");
});

test("stored trees reject ambiguous identities, invalid weights and excessive depth before traversal", () => {
  const valid = initial();
  assert.deepEqual(parseTree(JSON.parse(JSON.stringify(valid))), valid);
  for (const invalid of [
    { ...tabs("a", "b"), active: "missing" },
    { ...valid, weights: [NaN, 1] },
    { ...valid, weights: [0, 1] },
    { ...valid, children: [tabs("same"), tabs("same")] },
    { ...valid, children: [tabs("a"), { ...tabs("b"), id: "tabs:a" }] },
  ]) assert.equal(parseTree(invalid), undefined);
  let deep = tabs("bottom");
  for (let i = 0; i < 40; i++) deep = split("x", [tabs(`level-${i}`), 1], [deep, 1]);
  assert.equal(parseTree(deep), undefined);
});

const { PaneLayoutStore } = await import("../lib/stack/pane-state.ts");
const { panePresets } = await import("../lib/stack/pane-presets.ts");
const { ScopedStorage } = await import("../lib/stack/destination.ts");
const presets = [{ id: "default", title: "Default", build: () => initial() }, { id: "writing", title: "Writing", build: () => tabs("editor", "preview") }];
const ids = ["list", "editor", "preview", "history"];
const memory = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key), key: (i) => [...data.keys()][i] ?? null, get length() { return data.size; } };
};

test("close, reopen, undo and presets retain membership without replaying stale layout history", () => {
  const store = new PaneLayoutStore("test", presets, ids);
  const original = store.getSnapshot().tree;
  store.close("history");
  assert.deepEqual(store.getSnapshot().closed, ["history"]);
  assert.equal(store.getSnapshot().canUndo, true);
  store.undo();
  assert.deepEqual(store.getSnapshot().tree, original);
  store.close("history");
  store.open("history");
  assert.deepEqual(paneIds(store.getSnapshot().tree), ids);
  store.close("history");
  store.move("preview", "list", "left");
  const edited = store.getSnapshot();
  store.undo();
  assert.equal(store.getSnapshot(), edited);
  store.preset("writing");
  assert.deepEqual(store.getSnapshot().closed, ["list", "history"]);
  store.close("preview");
  store.close("editor");
  assert.deepEqual(paneIds(store.getSnapshot().tree), ["editor"]);
  store.configure([]);
  assert.equal(store.getSnapshot().tree, null);
  assert.equal(store.getSnapshot().focus, null);
});

test("layout restore is scoped, waits for attached storage, and never imports bench records", () => {
  const area = memory();
  const first = new ScopedStorage({ serverId: "a", authority: "local", origin: "http://localhost" }, () => area);
  const second = new ScopedStorage({ serverId: "b", authority: "local", origin: "http://localhost" }, () => area);
  area.setItem("uix.bench.v2.test", "legacy");
  const store = new PaneLayoutStore("test", presets, ids);
  store.close("history");
  store.attach(null);
  assert.equal(area.length, 1);
  store.attach(first);
  assert.deepEqual(store.getSnapshot().closed, ["history"]);
  const restored = new PaneLayoutStore("test", presets, ids);
  restored.attach(first);
  assert.deepEqual(restored.getSnapshot().closed, ["history"]);
  const other = new PaneLayoutStore("test", presets, ids);
  other.attach(second);
  assert.deepEqual(other.getSnapshot().closed, []);
  assert.equal(area.getItem("uix.bench.v2.test"), "legacy");
  restored.attach(null);
  restored.preset("writing");
  const again = new PaneLayoutStore("test", presets, ids);
  again.attach(first);
  assert.deepEqual(again.getSnapshot().closed, ["history"]);
});

test("unrecognized saved versions and failed storage leave layout usable without silently overwriting evidence", () => {
  const storage = memory();
  storage.setItem("uix.panes.v1.test", JSON.stringify({ version: 99 }));
  const store = new PaneLayoutStore("test", presets, ids);
  store.attach(storage);
  store.close("history");
  assert.equal(JSON.parse(storage.getItem("uix.panes.v1.test")).version, 99);
  assert.match(store.getSnapshot().warning, /version/i);
  store.preset("writing");
  assert.equal(JSON.parse(storage.getItem("uix.panes.v1.test")).version, 1);
  store.attach({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  store.open("history");
  assert.ok(paneIds(store.getSnapshot().tree).includes("history"));
  assert.match(store.getSnapshot().warning, /browser/i);
});

test("registration reconciliation adds instances once, removes unavailable panes and does not reset user edits", () => {
  const store = new PaneLayoutStore("test", presets, ids);
  store.move("history", "list", "left");
  const edited = store.getSnapshot();
  store.configure([...ids]);
  assert.equal(store.getSnapshot(), edited);
  store.configure([...ids, "chat-2"]);
  assert.equal(paneIds(store.getSnapshot().tree).filter((id) => id === "chat-2").length, 1);
  store.close("chat-2");
  store.configure([...ids, "chat-2"]);
  assert.ok(store.getSnapshot().closed.includes("chat-2"));
  store.configure(ids.filter((id) => id !== "editor"));
  assert.ok(!paneIds(store.getSnapshot().tree).includes("editor"));
  assert.ok(!store.getSnapshot().closed.includes("chat-2"));
});

test("preset compositions use only supplied instances and never invent comparison records", () => {
  for (const [space, available] of [["fleet", ["bots", "bot-state", "chat", "chat-9"]], ["workers", ["workers", "worker-runtimes", "worker", "worker-4"]], ["browse", ["browse-handoffs", "browse-viewer", "browse-viewer-7"]], ["proc", ["proc-runs", "proc-run", "proc-run-8"]]]) {
    for (const preset of panePresets[space]) {
      const tree = preset.build(available);
      assert.notEqual(parseTree(tree), undefined);
      assert.ok(paneIds(tree).every((id) => available.includes(id)));
    }
    assert.ok(panePresets[space].some((preset) => paneIds(preset.build(available)).includes(available.at(-1))));
  }
});
