import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { zipSync, unzipSync } from "fflate";
import { Extensions, extensionZip } from "../src/extensions.js";

const manifest = { manifest_version: 3, name: "Test", version: "1.0", background: { service_worker: "worker.js", type: "module" },
  content_scripts: [{ matches: ["https://example.com/*"], js: ["worker.js"], run_at: "document_start" }], action: { default_popup: "popup.html", default_title: "Test popup" } };

test("extension import snapshots executable bytes and full manifest, preserves identity across updates and fences stale selections", async () => {
  const root = await mkdtemp(join(tmpdir(), "stack-extensions-")), source = join(root, "source"); await mkdir(source);
  let catalog = new Extensions(root);
  try {
    await writeFile(join(source, "manifest.json"), JSON.stringify(manifest)); await writeFile(join(source, "worker.js"), "console.log('original')"); await writeFile(join(source, "popup.html"), "<title>Test</title>");
    const first = await catalog.import("custom", { path: source });
    const files = unzipSync(await catalog.archive(first)), normalized = JSON.parse(Buffer.from(files["manifest.json"]!).toString());
    assert.deepEqual(normalized.content_scripts, manifest.content_scripts); assert.deepEqual(normalized.action, manifest.action); assert.deepEqual(normalized.background, manifest.background);
    assert.equal(Buffer.from(files["worker.js"]!).toString(), "console.log('original')");
    assert.deepEqual(await catalog.import("custom", { path: source }), first, "identical import is immutable");
    await writeFile(join(source, "worker.js"), "console.log('updated')"); await writeFile(join(source, "manifest.json"), JSON.stringify({ ...manifest, version: "1.1" }));
    const next = await catalog.import("custom", { path: source }); assert.equal(next.chromeId, first.chromeId); assert.notEqual(next.digest, first.digest);
    const firstRef = { id: first.id, digest: first.digest }, nextRef = { id: next.id, digest: next.digest };
    const id = randomUUID(), empty = catalog.configuration(id), saved = catalog.set(id, empty.revision, [firstRef]); assert.equal(saved.applied, null);
    assert.throws(() => catalog.set(id, empty.revision, [nextRef]), /changed/);
    catalog.applied(id, [firstRef], [{ id: first.chromeId, name: first.name, version: first.version }]);
    const disabled = catalog.set(id, saved.revision, []); assert.deepEqual(disabled.applied, [firstRef]); assert.deepEqual(disabled.desired, []);
    const enabled = catalog.set(id, disabled.revision, [firstRef]); assert.notEqual(enabled.revision, saved.revision, "ABA saves cannot resurrect stale plans");
    catalog.reset(id); assert.equal(catalog.configuration(id).applied, null); assert.deepEqual(catalog.configuration(id).desired, [firstRef]);
    await catalog.close(); catalog = new Extensions(root); assert.deepEqual(catalog.get(first), first);
    await writeFile(join(root, "extensions", first.digest + ".zip"), "tampered"); await assert.rejects(catalog.archive(first), /integrity/);
  } finally { await catalog.close(); await rm(root, { recursive: true, force: true }); }
});

test("ZIP and directory imports reject traversal, links, collisions, oversized expansion, reserved identities and missing UI paths", async () => {
  for (const name of ["../outside", "/absolute", "a/../../escape", "a\\escape", "a//b", "a/./b", "C:escape"]) assert.throws(() => extensionZip(zipSync({ [name]: new Uint8Array([1]) })), /Unsafe/);
  assert.throws(() => extensionZip(zipSync({ a: new Uint8Array([1]), "a/child": new Uint8Array([2]) })), /collision/);
  const link = zipSync({ link: [new Uint8Array([1]), { os: 3, attrs: 0xa1ff << 16 }] }); assert.throws(() => extensionZip(link), /Unsafe/);
  const bomb = Buffer.from(zipSync({ file: new Uint8Array([1]) })); const central = bomb.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); bomb.writeUInt32LE(151 * 1024 * 1024, central + 24); assert.throws(() => extensionZip(bomb), /oversized/);
  const root = await mkdtemp(join(tmpdir(), "stack-extension-unsafe-")), source = join(root, "source"); await mkdir(source); const catalog = new Extensions(root);
  try {
    await writeFile(join(source, "manifest.json"), JSON.stringify(manifest)); await symlink("/etc/hosts", join(source, "link"));
    await assert.rejects(catalog.import("unsafe", { path: source }), /symlink/); await rm(join(source, "link"));
    await assert.rejects(catalog.import("bitwarden", { path: source }), /reserved/);
    await assert.rejects(catalog.import("unsafe", { path: source }), /UI path/);
    await writeFile(join(source, "manifest.json"), JSON.stringify({ ...manifest, manifest_version: 2 })); await assert.rejects(catalog.import("legacy", { path: source }));
    assert.equal(catalog.list().length, 0);
  } finally { await catalog.close(); await rm(root, { recursive: true, force: true }); }
});
