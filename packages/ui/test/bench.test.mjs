// Workspace dock, navigation and transport-reference contracts.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/lib/stack/") && specifier.startsWith("./") && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { activeSurface, dockGeometry, dockMinimum } = await import("../lib/stack/dock-layout.ts");
const { emptyLocation, navigateTo, parseLocation, locationHref } = await import("../lib/stack/navigation.ts");
const { inputTemplate, requestExample, subscriptionExample } = await import("../lib/stack/reference.ts");

test("right dock sizing reserves a usable bench after viewport shrink and expanded reading", () => {
  const options = { rightOpen: true, surface: "right", rightWidth: 1200 };
  const narrow = dockGeometry({ ...options, screenWidth: 900 });
  assert.equal(narrow.overlay, false);
  assert.equal(narrow.rightWidth, 660);
  assert.equal(narrow.rightMax, 660);
  for (const width of [900, 920, 1024, 1100, 1600]) for (const expanded of [true, false]) {
    const value = dockGeometry({ ...options, screenWidth: width, expanded });
    assert.equal(value.overlay, false);
    assert.ok(width - value.right >= dockMinimum.bench);
    assert.ok(value.rightWidth >= dockMinimum.right && value.rightWidth <= value.rightMax);
    if (expanded) assert.equal(value.rightWidth, value.rightMax);
  }
  assert.equal(dockGeometry({ ...options, screenWidth: 500 }).overlay, true);
  const closed = dockGeometry({ ...options, screenWidth: 900, rightOpen: false });
  assert.equal(closed.rightVisible, false);
  assert.equal(closed.right, 0);
  // Contraction hides the right dock on desktop but never overrides the overlay surface choice.
  const contracted = dockGeometry({ ...options, screenWidth: 1600, contracted: true });
  assert.equal(contracted.overlay, false);
  assert.equal(contracted.rightVisible, false);
  assert.equal(contracted.right, 0);
  assert.equal(contracted.rightWidth, 1200);
  assert.equal(dockGeometry({ ...options, screenWidth: 500, contracted: true, surface: "right" }).rightVisible, true);
  assert.equal(dockGeometry({ ...options, screenWidth: 500, contracted: true, surface: "bench" }).rightVisible, false);
});

test("mobile spatial navigation reveals the bench while retaining every dock destination", () => {
  const retained = { ...emptyLocation(), inspect: { kind: "bot", id: "bot-7" }, reference: { kind: "operation", pkg: "bots", id: "bot_status" } };
  const next = navigateTo(retained, { kind: "account", id: "a-1" });
  assert.deepEqual(next.inspect, retained.inspect);
  assert.deepEqual(next.reference, retained.reference);
  const options = { screenWidth: 390, rightOpen: true, rightWidth: 680 };
  const bench = dockGeometry({ ...options, surface: activeSurface("bench", options) });
  assert.equal(bench.rightVisible, false);
  assert.equal(bench.right, 0);
  assert.equal(dockGeometry({ ...options, surface: activeSurface("right", options) }).rightVisible, true);
  const url = new URL(locationHref(next), "http://localhost");
  url.searchParams.set("surface", "bench");
  assert.deepEqual(parseLocation(url.pathname, url.searchParams), next);
  assert.equal(activeSurface(url.searchParams.get("surface"), options), "bench");
  assert.equal(activeSurface(undefined, options), "right");
  assert.equal(activeSurface("right", { rightOpen: false }), "bench");
  assert.equal(activeSurface("left", options), "right");
});

test("dock and card destinations retain inspection; complete URLs restore the dock and target", () => {
  const selected = { kind: "account", id: "account: with spaces" };
  const base = { ...emptyLocation(), inspect: selected };
  const card = navigateTo(base, { kind: "bot", id: "bot-7" });
  const system = navigateTo(card, { kind: "child", id: "ui" });
  assert.equal(system.space, "system");
  assert.deepEqual(system.focus, { kind: "child", id: "ui" });
  const resource = navigateTo(system, { kind: "resource", id: "component:ui" });
  assert.equal(resource.space, "system");
  assert.deepEqual(resource.focus, { kind: "resource", id: "component:ui" });
  const process = navigateTo(system, { kind: "process", id: "process:9:ab" });
  assert.equal(process.space, "system");
  assert.deepEqual(process.focus, { kind: "process", id: "process:9:ab" });
  const reference = navigateTo(process, { kind: "operation", pkg: "bots", id: "bot_status" });
  assert.deepEqual(reference.inspect, selected);
  assert.deepEqual(reference.focus, process.focus);
  assert.equal(reference.space, "system");
  const url = new URL(locationHref(reference), "http://localhost");
  assert.deepEqual(parseLocation(url.pathname, url.searchParams), reference);
  // The retired `system` dock parameter is ignored; only real destinations resolve.
  assert.deepEqual(parseLocation("/", new URLSearchParams("reference=overview&system=open")), { ...emptyLocation(), reference: "overview" });
  assert.deepEqual(parseLocation("/system", new URLSearchParams()), { ...emptyLocation("system") });
  assert.deepEqual(parseLocation("/", new URLSearchParams("reference=bot:bad&inspect=package:bots&system=account:bad")), emptyLocation());
});

test("a card link crosses spaces: Bot to account lands in Accounts and back, keeping inspection", () => {
  const inspect = { kind: "bot", id: "bot-1" };
  const onAccount = navigateTo({ ...emptyLocation("fleet"), inspect }, { kind: "account", id: "a1" });
  assert.equal(onAccount.space, "accounts");
  assert.deepEqual(onAccount.focus, { kind: "account", id: "a1" });
  assert.deepEqual(onAccount.inspect, inspect);
  assert.equal(locationHref(onAccount), "/accounts?focus=account%3Aa1&inspect=bot%3Abot-1");
  const back = navigateTo(onAccount, inspect);
  assert.equal(back.space, "fleet");
  assert.deepEqual(parseLocation("/", new URLSearchParams("focus=usage-account%3Abot%3Aa1")).space, "accounts");
});

test("transport templates never invent input values or unsupported call/subscription transports", () => {
  const operation = { name: "write", inputSchema: { type: "object", required: ["count", "id", "nested"], properties: { count: { type: "number" }, id: { type: "string", format: "uuid" }, nested: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } }, optional: { type: "string" } } } };
  assert.deepEqual(inputTemplate(operation.inputSchema), { count: "<replace: number>", id: "<replace: string>", nested: { enabled: "<replace: boolean>" } });
  const socket = { type: "socket", supported: true, subscriptions: true, operations: ["write"], events: ["changed"] };
  const ws = { ...socket, type: "websocket" };
  const mcp = { ...socket, type: "mcp" };
  assert.equal(JSON.parse(requestExample(operation, socket, "bots")).jsonrpc, undefined);
  assert.equal(JSON.parse(requestExample(operation, ws, "bots")).method, "tools/call");
  assert.equal(JSON.parse(requestExample(operation, ws, "bots")).params.package, "bots");
  assert.equal(JSON.parse(requestExample(operation, mcp, "bots")).jsonrpc, "2.0");
  assert.equal(requestExample(operation, { ...socket, supported: false }, "bots"), null);
  assert.equal(requestExample(operation, { ...socket, type: "unknown" }, "bots"), null);
  const doc = { name: "bots", events: { changed: "Changed" }, eventScope: { required: true, example: "bot-1" } };
  assert.equal(subscriptionExample(doc, mcp), null);
  assert.equal(subscriptionExample(doc, { ...socket, subscriptions: false }), null);
  assert.equal(subscriptionExample(doc, { ...socket, events: [] }), null);
  assert.deepEqual(JSON.parse(subscriptionExample({ ...doc, events: { changed: "Changed", hidden: "Hidden" } }, ws)).params.topics, ["changed"]);
  assert.equal(requestExample(operation, { ...socket, operations: [] }, "bots"), null);
  const sub = JSON.parse(subscriptionExample(doc, ws));
  assert.equal(sub.method, "events/subscribe");
  assert.equal(sub.params.package, "bots");
  assert.equal(sub.params.subscription, "<replace: subscription id>");
  assert.equal(sub.params.scope, "<replace: subscription scope>");
  assert.deepEqual(sub.params.topics, ["changed"]);
});
