import assert from "node:assert/strict";
import { existsSync, linkSync, lstatSync, readFileSync, readdirSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture, inode, refusal, success } from "./support/fs-boundary.js";

test("retained text publication writes complete private UTF-8 bytes and clears owned staging", async (t) => {
  const f = fixture(t), destination = join(f.input, "sidecar.html"), content = "<main>Private café 🧭</main>";
  writeFileSync(destination, "old bytes", { mode: 0o644 });
  success(await f.start({ owner: "artifacts", path: destination, content }).result());
  assert.deepEqual(readFileSync(destination), Buffer.from(content));
  assert.equal(lstatSync(destination).mode & 0o777, 0o600);
  assert.equal(lstatSync(destination).nlink, 1);
  assert.deepEqual(readdirSync(f.input), ["sidecar.html"]);
});

for (const kind of ["file", "symlink", "hardlink"] as const)
  test(`retained text refuses a ${kind} staging replacement without publishing or unlinking it`, async (t) => {
    const f = fixture(t), destination = join(f.input, "sidecar.html");
    writeFileSync(destination, "old destination");
    const selected = inode(destination);
    const owner = f.start({ owner: "artifacts", path: destination, content: "owned artifact", triggers: [
      { method: "lstatSync", path: "/\\.agentscrape-artifact-[^/]+\\.tmp$" },
    ] });
    const hit = await owner.boundary(), temporary = hit.paths[0]!;
    renameSync(temporary, join(f.input, "owned.saved"));
    const victim = join(f.input, "victim");
    writeFileSync(victim, "alien artifact", { mode: 0o600 });
    if (kind === "file") writeFileSync(temporary, "alien artifact", { mode: 0o600 });
    else if (kind === "symlink") symlinkSync(victim, temporary);
    else linkSync(victim, temporary);
    const replacement = inode(temporary), victimIdentity = inode(victim);
    await owner.resume();
    refusal(await owner.result(), /failed to retain a text artifact/, "AgentscrapeArtifactError");
    assert.equal(inode(destination), selected);
    assert.equal(readFileSync(destination, "utf8"), "old destination");
    assert.equal(inode(temporary), replacement, "cleanup must not unlink a foreign staging generation");
    assert.equal(readFileSync(temporary, "utf8"), "alien artifact");
    if (kind === "symlink") assert.equal(readlinkSync(temporary), victim);
    if (kind === "hardlink") assert.equal(lstatSync(victim).nlink, 2);
    assert.equal(inode(victim), victimIdentity);
    assert.equal(readFileSync(victim, "utf8"), "alien artifact");
    assert.equal(readFileSync(join(f.input, "owned.saved"), "utf8"), "owned artifact");
  });

test("retained text refuses a final pathname replacement and preserves that replacement", async (t) => {
  const f = fixture(t), destination = join(f.input, "sidecar.html");
  const owner = f.start({ owner: "artifacts", path: destination, content: "owned artifact", triggers: [
    { method: "renameSync", when: "after", path: "/sidecar\\.html$", argument: 1 },
  ] });
  const hit = await owner.boundary();
  renameSync(destination, join(f.input, "owned.saved"));
  writeFileSync(destination, "alien artifact", { mode: 0o600 });
  const replacement = inode(destination);
  await owner.resume();
  refusal(await owner.result(), /failed to retain a text artifact/, "AgentscrapeArtifactError");
  assert.equal(inode(destination), replacement);
  assert.equal(readFileSync(destination, "utf8"), "alien artifact");
  assert.equal(readFileSync(join(f.input, "owned.saved"), "utf8"), "owned artifact");
  assert.equal(existsSync(hit.paths[0]!), false);
});
