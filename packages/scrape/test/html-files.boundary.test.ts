import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture, inode, refusal, snapshot, SOURCE, success, type Trigger } from "./support/fs-boundary.js";

const publicLink: Trigger = { method: "linkSync", when: "after", path: "/article\\.md$", argument: 1 };
const retire: Trigger = { method: "renameSync", path: "/retired-source$", argument: 1 };
const capture: Trigger = { method: "renameSync", path: "/captured-destination$", argument: 1 };
const publicationSync: Trigger = { method: "fsyncSync", path: "/input$" };
const reserved = (root: string, prefix: string) => readdirSync(root).filter((name) => name.startsWith(prefix)).map((name) => join(root, name));

// Crashes leave owner-generated state, never a handcrafted manifest, receipt or stale PID.
const crashes: Array<{ label: string; trigger: Trigger; committed?: boolean; surface: string }> = [
  { label: "mode-0300 preparation", trigger: { method: "mkdirSync", when: "after", path: "/\\.agentscrape-html-prepare-" }, surface: "prepare" },
  { label: "ready preparation", trigger: { method: "chmodSync", when: "after", path: "/\\.agentscrape-html-prepare-" }, surface: "prepare" },
  { label: "transaction promotion", trigger: { method: "renameSync", when: "after", path: "/\\.agentscrape-html-retire-[^/]+$", argument: 1 }, surface: "retire" },
  { label: "public output publication", trigger: publicLink, surface: "retire" },
  { label: "source retirement", trigger: { ...retire, when: "after" }, surface: "retire" },
  { label: "destination capture", trigger: { ...capture, when: "after" }, surface: "retire" },
  { label: "empty pending commit", trigger: { method: "openSync", when: "after", path: "/committed\\.pending$" }, surface: "retire" },
  { label: "complete pending commit", trigger: { method: "linkSync", path: "/committed$", argument: 1 }, committed: true, surface: "retire" },
  { label: "published commit", trigger: { method: "linkSync", when: "after", path: "/committed$", argument: 1 }, committed: true, surface: "retire" },
  { label: "empty pending cleanup", trigger: { method: "openSync", when: "after", path: "/cleanup-ready\\.pending$" }, committed: true, surface: "retire" },
  { label: "cleanup promotion", trigger: { method: "renameSync", when: "after", path: "/\\.agentscrape-html-cleanup-[^/]+$", argument: 1 }, committed: true, surface: "cleanup" },
  { label: "markerless cleanup tombstone", trigger: { method: "unlinkSync", when: "after", path: "/cleanup-ready$" }, committed: true, surface: "cleanup" },
];

for (const crash of crashes) test(`directory conversion recovers a true process crash at ${crash.label}`, async (t) => {
  const f = fixture(t), source = join(f.input, "article.html"), destination = join(f.input, "article.md");
  writeFileSync(source, SOURCE);
  const owner = f.start({ owner: "convert", path: f.input, triggers: [crash.trigger] });
  await owner.boundary();
  await owner.kill();
  assert.equal((await owner.exited).signal, "SIGKILL");
  assert.equal(reserved(f.input, `.agentscrape-html-${crash.surface}-`).length, 1, "finally cleanup must not have run");
  const lock = JSON.parse(readFileSync(join(f.input, ".agentscrape-html-convert.lock"), "utf8"));
  assert.equal(lock.pid, owner.child.pid);
  const value = success(await f.start({ owner: "convert", path: f.input }).result());
  assert.equal(value, crash.committed ? 0 : 1);
  assert.equal(existsSync(source), false);
  assert.equal(readFileSync(destination, "utf8"), "# Original");
  assert.equal(lstatSync(destination).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(f.input), ["article.md"], "recovery must clear only its owned transaction and dead-lock debris");
  assert.equal(success(await f.start({ owner: "convert", path: f.input }).result()), 0);
});

test("overlapping root and subtree converters refuse a live owner, then reclaim its actual dead claims", async (t) => {
  const f = fixture(t), nested = join(f.input, "nested");
  mkdirSync(nested);
  writeFileSync(join(nested, "article.html"), SOURCE);
  const owner = f.start({ owner: "convert", path: f.input, triggers: [retire] });
  await owner.boundary();
  const held = snapshot(f.input);
  for (const path of [f.input, nested]) {
    refusal(await f.start({ owner: "convert", path }).result(), /Active HTML conversion already holds directory lock/);
    assert.deepEqual(snapshot(f.input), held, "contender may not recover or mutate live work");
  }
  await owner.kill();
  assert.equal(success(await f.start({ owner: "convert", path: f.input }).result()), 1);
  assert.deepEqual(readdirSync(f.input), ["nested"]);
  assert.deepEqual(readdirSync(nested), ["article.md"]);
  assert.equal(readFileSync(join(nested, "article.md"), "utf8"), "# Original");
});

for (const mutation of ["same-inode rewrite", "replacement inode"] as const)
  test(`crash recovery refuses a public source ${mutation} without discarding uncertain private evidence`, async (t) => {
    const f = fixture(t), source = join(f.input, "article.html");
    writeFileSync(source, SOURCE);
    const selected = inode(source);
    const owner = f.start({ owner: "convert", path: f.input, triggers: [publicLink] });
    await owner.boundary(); await owner.kill();
    if (mutation === "replacement inode") renameSync(source, join(f.input, "original.saved"));
    writeFileSync(source, "<h1>Mutated!</h1>");
    const changed = inode(source);
    assert.equal(changed === selected, mutation === "same-inode rewrite");
    refusal(await f.start({ owner: "convert", path: f.input }).result(), /Source (content|identity) cannot be proven from the manifest/);
    assert.equal(inode(source), changed);
    assert.equal(readFileSync(source, "utf8"), "<h1>Mutated!</h1>");
    assert.equal(existsSync(join(f.input, "article.md")), false);
    const transaction = reserved(f.input, ".agentscrape-html-retire-")[0]!;
    assert.equal(readFileSync(join(transaction, "output"), "utf8"), "# Original");
    if (mutation === "replacement inode") {
      assert.equal(inode(join(f.input, "original.saved")), selected);
      assert.equal(readFileSync(join(f.input, "original.saved"), "utf8"), SOURCE);
    }
    const preserved = snapshot(f.input);
    refusal(await f.start({ owner: "convert", path: f.input }).result(), /Source (content|identity) cannot be proven from the manifest/);
    assert.deepEqual(snapshot(f.input), preserved);
  });

for (const boundary of [
  { label: "the initial descriptor read", trigger: { method: "readSync", when: "after", path: "/article\\.html$" } as Trigger },
  { label: "public output publication", trigger: publicLink },
]) test(`directory conversion refuses a same-inode same-size source rewrite after ${boundary.label}`, async (t) => {
  const f = fixture(t), source = join(f.input, "article.html");
  writeFileSync(source, SOURCE);
  const selected = inode(source), rewritten = "<h1>Mutated!</h1>";
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(SOURCE));
  const owner = f.start({ owner: "convert", path: f.input, triggers: [boundary.trigger] });
  await owner.boundary();
  writeFileSync(source, rewritten);
  assert.equal(inode(source), selected);
  await owner.resume();
  refusal(await owner.result(), /HTML input changed|Source content cannot be proven from the manifest/);
  assert.equal(readFileSync(source, "utf8"), rewritten);
  assert.equal(inode(source), selected);
  assert.deepEqual(readdirSync(f.input), ["article.html"]);
  assert.equal(success(await f.start({ owner: "convert", path: f.input }).result()), 1);
  assert.equal(readFileSync(join(f.input, "article.md"), "utf8"), "# Mutated!");
});

test("source replacement immediately before retirement is restored, not deleted or mistaken for the opened generation", async (t) => {
  const f = fixture(t), source = join(f.input, "article.html"), original = join(f.input, "original.saved");
  writeFileSync(source, SOURCE);
  const selected = inode(source);
  const owner = f.start({ owner: "convert", path: f.input, triggers: [retire] });
  await owner.boundary();
  renameSync(source, original);
  writeFileSync(source, "<h1>Replaced</h1>");
  const replacement = inode(source);
  await owner.resume();
  refusal(await owner.result(), /not the opened generation/);
  assert.equal(inode(source), replacement);
  assert.equal(readFileSync(source, "utf8"), "<h1>Replaced</h1>");
  assert.equal(inode(original), selected);
  assert.equal(readFileSync(original, "utf8"), SOURCE);
  assert.equal(existsSync(join(f.input, "article.md")), false);
  const transaction = reserved(f.input, ".agentscrape-html-retire-")[0]!;
  assert.equal(inode(join(transaction, "retired-source")), replacement);
  const preserved = snapshot(f.input);
  refusal(await f.start({ owner: "convert", path: f.input }).result(), /differs from the manifest generation/);
  assert.deepEqual(snapshot(f.input), preserved, "uncertain recovery must retain both generations and private output");
});

test("a new public source after retirement preserves both generations and resumes only after the conflict is removed", async (t) => {
  const f = fixture(t), source = join(f.input, "article.html");
  writeFileSync(source, SOURCE);
  const selected = inode(source);
  const owner = f.start({ owner: "convert", path: f.input, triggers: [{ ...retire, when: "after" }] });
  await owner.boundary();
  writeFileSync(source, "<h1>New input</h1>");
  const replacement = inode(source);
  await owner.resume();
  refusal(await owner.result(), /concurrent source generation|different public source generation/);
  assert.equal(inode(source), replacement);
  const transaction = reserved(f.input, ".agentscrape-html-retire-")[0]!;
  assert.equal(inode(join(transaction, "retired-source")), selected);
  assert.equal(readFileSync(join(transaction, "retired-source"), "utf8"), SOURCE);
  assert.equal(existsSync(join(f.input, "article.md")), false);
  const preserved = snapshot(f.input);
  refusal(await f.start({ owner: "convert", path: f.input }).result(), /different public source generation/);
  assert.deepEqual(snapshot(f.input), preserved);
  renameSync(source, join(f.input, "replacement.saved"));
  assert.equal(success(await f.start({ owner: "convert", path: f.input }).result()), 1);
  assert.equal(readFileSync(join(f.input, "article.md"), "utf8"), "# Original");
  assert.equal(inode(join(f.input, "replacement.saved")), replacement);
  assert.deepEqual(readdirSync(f.input).sort(), ["article.md", "replacement.saved"]);
});

test("a same-size rewrite of the retired inode is preserved as uncertain evidence across restart", async (t) => {
  const f = fixture(t), source = join(f.input, "article.html");
  writeFileSync(source, SOURCE);
  const selected = inode(source);
  const owner = f.start({ owner: "convert", path: f.input, triggers: [{ ...retire, when: "after" }] });
  const hit = await owner.boundary(), retired = hit.paths[1]!;
  writeFileSync(retired, "<h1>Mutated!</h1>");
  await owner.resume();
  refusal(await owner.result(), /content changed/);
  assert.equal(inode(source), selected);
  assert.equal(inode(retired), selected);
  assert.equal(readFileSync(source, "utf8"), "<h1>Mutated!</h1>");
  assert.equal(existsSync(join(f.input, "article.md")), false);
  const preserved = snapshot(f.input);
  refusal(await f.start({ owner: "convert", path: f.input }).result(), /differs from the manifest generation/);
  assert.deepEqual(snapshot(f.input), preserved);
});

for (const kind of ["file", "symlink", "directory"] as const)
  test(`rollback preserves a foreign ${kind} inserted after its destination ownership check`, async (t) => {
    const f = fixture(t), source = join(f.input, "article.html"), destination = join(f.input, "article.md");
    writeFileSync(source, SOURCE);
    const owner = f.start({ owner: "convert", path: f.input, triggers: [publicLink, publicationSync, capture] });
    await owner.boundary();
    await owner.resume();
    await owner.boundary();
    await owner.resume(true); // Actual publication succeeded; an IO failure now invokes real rollback.
    await owner.boundary();
    renameSync(destination, join(f.input, "output.saved"));
    if (kind === "file") writeFileSync(destination, "foreign destination");
    else if (kind === "symlink") symlinkSync("foreign-target", destination);
    else { mkdirSync(destination); writeFileSync(join(destination, "body"), "foreign directory"); }
    const replacement = kind === "symlink" ? null : inode(destination);
    await owner.resume();
    refusal(await owner.result(), /injected filesystem EIO/);
    if (replacement) assert.equal(inode(destination), replacement);
    if (kind === "file") assert.equal(readFileSync(destination, "utf8"), "foreign destination");
    if (kind === "symlink") assert.equal(readlinkSync(destination), "foreign-target");
    if (kind === "directory") assert.equal(readFileSync(join(destination, "body"), "utf8"), "foreign directory");
    assert.equal(readFileSync(source, "utf8"), SOURCE);
    assert.equal(readFileSync(join(f.input, "output.saved"), "utf8"), "# Original");
    assert.equal(readdirSync(f.input).some((name) => name.startsWith(".agentscrape-html-")), false);
    assert.equal(success(await f.start({ owner: "convert", path: f.input }).result()), 0, "occupied replacement is never overwritten");
  });

test("rollback retains a captured foreign destination when a later public generation prevents restoration", async (t) => {
  const f = fixture(t), source = join(f.input, "article.html"), destination = join(f.input, "article.md");
  writeFileSync(source, SOURCE);
  const owner = f.start({ owner: "convert", path: f.input, triggers: [publicLink, publicationSync, capture, { ...capture, when: "after" }] });
  await owner.boundary(); await owner.resume();
  await owner.boundary(); await owner.resume(true);
  await owner.boundary();
  renameSync(destination, join(f.input, "output.saved"));
  writeFileSync(destination, "first foreign generation");
  const first = inode(destination);
  await owner.resume();
  const hit = await owner.boundary();
  writeFileSync(destination, "later foreign generation");
  const later = inode(destination);
  await owner.resume();
  refusal(await owner.result(), /concurrent destination prevents safe restoration/);
  assert.equal(inode(hit.paths[1]!), first);
  assert.equal(readFileSync(hit.paths[1]!, "utf8"), "first foreign generation");
  assert.equal(inode(destination), later);
  assert.equal(readFileSync(destination, "utf8"), "later foreign generation");
  const preserved = snapshot(f.input);
  refusal(await f.start({ owner: "convert", path: f.input }).result(), /concurrent destination prevents safe restoration/);
  assert.deepEqual(snapshot(f.input), preserved);
  renameSync(destination, join(f.input, "later.saved"));
  assert.equal(success(await f.start({ owner: "convert", path: f.input }).result()), 0);
  assert.equal(inode(destination), first);
  assert.equal(inode(join(f.input, "later.saved")), later);
  assert.equal(readFileSync(source, "utf8"), SOURCE);
});
