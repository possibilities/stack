import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyHypemanSourcePackage, type HypemanSource } from "../src/hypeman-artifact.js";

test("source package verification binds provenance and both binaries before execution", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stack-hypeman-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source: HypemanSource = { sourceRepository: "kernel/hypeman", sourceRevision: "a".repeat(40), buildRepository: "possibilities/hypeman", buildRevision: "b".repeat(40), buildRun: "123", platform: "darwin_arm64" };
  const bytes = { "hypeman-api": "fixture server bytes", "hypeman-token": "fixture token utility bytes" };
  const manifest = { schema: 1, ...source, files: Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, createHash("sha256").update(value).digest("hex")])) };
  for (const [name, value] of Object.entries(bytes)) await writeFile(join(root, name), value);
  await writeFile(join(root, "source-provenance.json"), JSON.stringify(manifest));
  await verifyHypemanSourcePackage(root, source);

  await t.test("rejects a different source revision", async () => {
    await assert.rejects(verifyHypemanSourcePackage(root, { ...source, sourceRevision: "c".repeat(40) }), /provenance differs/);
  });
  await t.test("rejects modified binary bytes", async () => {
    await writeFile(join(root, "hypeman-api"), "different server bytes");
    await assert.rejects(verifyHypemanSourcePackage(root, source), /checksum mismatch/);
    await writeFile(join(root, "hypeman-api"), bytes["hypeman-api"]);
  });
  await t.test("rejects a binary symlink even with matching content", async () => {
    await writeFile(join(root, "other"), bytes["hypeman-token"]);
    await rm(join(root, "hypeman-token"));
    await symlink(join(root, "other"), join(root, "hypeman-token"));
    await assert.rejects(verifyHypemanSourcePackage(root, source), /invalid binary/);
  });
});
