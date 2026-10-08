import assert from "node:assert/strict";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { CORPUS_AGGREGATE_MAX_BYTES, CORPUS_ARTIFACT_MAX_BYTES } from "../src/corpus.js";
import { fixture, HTML, inode, MARKDOWN, PRESET, refusal, snapshot, success } from "./support/fs-boundary.js";

test("default capture publishes private replayable success evidence and redacted failure diagnostics offline", async (t) => {
  const f = fixture(t);
  const sample = success(await f.start({ owner: "capture" }).result()) as string;
  assert.equal(sample, join(f.preset, "sample-001"));
  assert.deepEqual(readdirSync(sample).sort(), ["expected.md", "meta.json", "page.html", "selected.html"]);
  assert.equal(readFileSync(join(sample, "page.html"), "utf8"), HTML);
  assert.equal(readFileSync(join(sample, "selected.html"), "utf8"), HTML);
  assert.equal(readFileSync(join(sample, "expected.md"), "utf8"), MARKDOWN);
  const meta = JSON.parse(readFileSync(join(sample, "meta.json"), "utf8"));
  assert.equal(meta.expect, "success");
  assert.equal(meta.preset, PRESET);
  assert.deepEqual(meta.structured, { content: MARKDOWN });
  assert.equal(meta.url, "https://capture.example.test/success");
  for (const directory of [join(f.state, "scrape"), join(f.state, "scrape", "corpus"), f.preset, sample])
    assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  for (const name of readdirSync(sample)) {
    const info = lstatSync(join(sample, name));
    assert.equal(info.mode & 0o777, 0o600);
    assert.equal(info.nlink, 1);
  }
  const replay = success(await f.start({ owner: "replay" }).result());
  assert.equal(replay.failed, 0, replay.lines.join("\n"));
  assert.equal(replay.passed, 1);
  const failed = success(await f.start({ owner: "capture", url: "https://capture.example.test/failure#private-fragment", expectFailure: "TypeError" }).result()) as string;
  const failureMeta = JSON.parse(readFileSync(join(failed, "meta.json"), "utf8"));
  assert.equal(failureMeta.expect, "failure");
  assert.equal(failureMeta.failure.type, "TypeError");
  assert.equal(JSON.stringify(failureMeta).includes("private-secret"), false);
  assert.match(failureMeta.failure.message_captured, /REDACTED/);
  assert.deepEqual(readdirSync(failed), ["meta.json"]);
  assert.deepEqual(readdirSync(f.preset), ["sample-001", "sample-002"]);
});

for (const unsafe of ["symlink", "nonprivate-data-home", "nonprivate-corpus", "nonprivate-preset"] as const)
  test(`default capture refuses ${unsafe} ancestry without changing foreign evidence`, async (t) => {
    const f = fixture(t), corpus = join(f.state, "scrape", "corpus"), external = join(f.root, "external");
    mkdirSync(external, { mode: 0o700 });
    writeFileSync(join(external, "sentinel"), "untouched external evidence", { mode: 0o600 });
    if (unsafe === "symlink") symlinkSync(external, corpus);
    else {
      mkdirSync(corpus, { mode: 0o700 }); mkdirSync(f.preset, { mode: 0o700 });
      chmodSync(unsafe === "nonprivate-data-home" ? join(f.state, "scrape") : unsafe === "nonprivate-corpus" ? corpus : f.preset, 0o750);
    }
    const before = snapshot(f.state), outside = snapshot(external);
    refusal(await f.start({ owner: "capture" }).result(), /plain directory|not private/, "CorpusSecurityError");
    assert.deepEqual(snapshot(f.state), before);
    assert.deepEqual(snapshot(external), outside);
  });

for (const cap of ["per-artifact", "aggregate"] as const)
  for (const ancestry of ["missing", "unsafe"] as const)
    test(`capture ${cap} byte preflight precedes ${ancestry} corpus ancestry effects`, async (t) => {
      const f = fixture(t), corpus = join(f.state, "scrape", "corpus"), sibling = join(f.state, "sibling");
      mkdirSync(sibling, { mode: 0o700 });
      writeFileSync(join(sibling, "sentinel"), "unchanged sibling evidence", { mode: 0o600 });
      if (ancestry === "unsafe") symlinkSync(sibling, corpus);
      const before = snapshot(f.state), handlerMarker = join(f.input, "handler-called");
      // Aggregate case keeps each artifact within its own cap. Structured Markdown is also
      // retained in metadata, so the four bodies reach the aggregate cap before metadata overhead.
      const captureBytes = cap === "per-artifact" ? { fullHtml: CORPUS_ARTIFACT_MAX_BYTES + 1 } : {
        fullHtml: CORPUS_ARTIFACT_MAX_BYTES, selectedHtml: CORPUS_ARTIFACT_MAX_BYTES,
        markdown: (CORPUS_AGGREGATE_MAX_BYTES - 2 * CORPUS_ARTIFACT_MAX_BYTES) / 2,
      };
      refusal(await f.start({ owner: "capture", captureBytes, handlerMarker }).result(),
        cap === "per-artifact" ? /text artifact exceeds.*byte limit/ : /text artifacts exceed.*aggregate limit/,
        "AgentscrapeArtifactError");
      assert.equal(readFileSync(handlerMarker, "utf8"), "boundary.capture", "byte refusal must follow actual handler extraction");
      assert.deepEqual(snapshot(f.state), before, "byte preflight must have no persisted ancestry effects");
      if (ancestry === "missing") assert.equal(existsSync(corpus), false);
    });

for (const presetName of ["../sibling", "unsafe\\preset"])
  test(`capture refuses declared unsafe preset name ${JSON.stringify(presetName)} at publication`, async (t) => {
    const f = fixture(t), corpus = join(f.state, "scrape", "corpus"), sibling = join(f.state, "scrape", "sibling");
    mkdirSync(corpus, { mode: 0o700 });
    mkdirSync(sibling, { mode: 0o700 });
    writeFileSync(join(corpus, "sentinel"), "unchanged corpus evidence", { mode: 0o600 });
    writeFileSync(join(sibling, "sentinel"), "unchanged sibling evidence", { mode: 0o600 });
    f.declarePreset(presetName);
    const before = snapshot(f.state), handlerMarker = join(f.input, "handler-called");
    refusal(await f.start({ owner: "capture", presetName, handlerMarker }).result(), /unsafe path name/, "CorpusSecurityError");
    assert.equal(readFileSync(handlerMarker, "utf8"), "boundary.capture", "declared preset must select its handler, not fail registry lookup");
    assert.deepEqual(snapshot(f.state), before, "unsafe preset publication must preserve corpus and sibling generations");
  });

test("capture refuses a preset directory swap and never cleans the replacement staging pathname", async (t) => {
  const f = fixture(t);
  const owner = f.start({ owner: "capture", triggers: [
    { method: "fsyncSync", when: "after", path: "/\\.capture-tmp-[^/]+$" },
  ] });
  const hit = await owner.boundary(), temporaryName = basename(hit.paths[0]!);
  renameSync(f.preset, join(f.root, "original-preset"));
  mkdirSync(f.preset, { mode: 0o700 });
  const replacement = join(f.preset, temporaryName);
  mkdirSync(replacement, { mode: 0o700 });
  writeFileSync(join(replacement, "sentinel"), "foreign replacement", { mode: 0o600 });
  const before = snapshot(f.preset), original = snapshot(join(f.root, "original-preset"));
  await owner.resume();
  refusal(await owner.result(), /directory identity changed/, "CorpusSecurityError");
  assert.deepEqual(snapshot(f.preset), before);
  assert.deepEqual(snapshot(join(f.root, "original-preset")), original);
  assert.equal(readFileSync(join(f.root, "original-preset", temporaryName, "meta.json"), "utf8").includes(PRESET), true);
  assert.equal(readdirSync(f.preset).some((name) => name.startsWith("sample-")), false);
});

for (const kind of ["nonprivate", "symlink", "hardlink"] as const)
  test(`capture refuses a ${kind} retained artifact without deleting ambiguous staging evidence`, async (t) => {
    const f = fixture(t);
    const owner = f.start({ owner: "capture", triggers: [
      { method: "fsyncSync", when: "after", path: "/\\.capture-tmp-[^/]+$" },
    ] });
    const hit = await owner.boundary(), temporary = hit.paths[0]!, meta = join(temporary, "meta.json");
    const victim = join(f.root, "victim");
    writeFileSync(victim, "foreign bytes", { mode: 0o600 });
    if (kind === "nonprivate") chmodSync(meta, 0o640);
    else {
      renameSync(meta, join(f.root, "meta.saved"));
      if (kind === "symlink") symlinkSync(victim, meta);
      else linkSync(victim, meta);
    }
    const replacement = snapshot(meta), external = snapshot(victim);
    await owner.resume();
    refusal(await owner.result(), /nonprivate|symbolic-link/, "CorpusSecurityError");
    assert.deepEqual(snapshot(meta), replacement);
    assert.deepEqual(snapshot(victim), external);
    assert.equal(readdirSync(f.preset).some((name) => name.startsWith("sample-")), false);
  });

test("capture sequence advances above real maintenance retirements and sparse existing samples", async (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 3; n += 1)
    assert.equal(basename(success(await f.start({ owner: "capture" }).result())), `sample-00${n}`);
  const receipt = success(await f.start({ owner: "retire", ids: ["sample-001", "sample-003"] }).result());
  assert.equal(receipt.status, "completed");
  assert.deepEqual(readdirSync(f.preset), ["sample-002"]);
  const survivor = snapshot(join(f.preset, "sample-002"));
  assert.equal(basename(success(await f.start({ owner: "capture" }).result())), "sample-004");
  assert.equal(existsSync(join(f.preset, "sample-001")), false);
  assert.equal(existsSync(join(f.preset, "sample-003")), false);
  renameSync(join(f.preset, "sample-004"), join(f.preset, "sample-010"));
  assert.equal(basename(success(await f.start({ owner: "capture" }).result())), "sample-011");
  assert.deepEqual(snapshot(join(f.preset, "sample-002")), survivor);
  assert.deepEqual(readdirSync(f.preset).sort(), ["sample-002", "sample-010", "sample-011"]);
});

test("overlapping captures refuse an occupied next ID, preserve the winner, and can resume as a new sample", async (t) => {
  const f = fixture(t);
  const owner = f.start({ owner: "capture", triggers: [
    { method: "readdirSync", when: "after", path: `/${PRESET}$` },
  ] });
  await owner.boundary();
  const winner = success(await f.start({ owner: "capture" }).result()) as string;
  const published = snapshot(winner);
  await owner.resume();
  refusal(await owner.result(), /next corpus sample path is already occupied/, "CorpusSecurityError");
  assert.deepEqual(snapshot(winner), published);
  assert.deepEqual(readdirSync(f.preset), ["sample-001"], "loser may clean only its own unpublished temporary");
  assert.equal(basename(success(await f.start({ owner: "capture" }).result())), "sample-002");
  assert.deepEqual(snapshot(winner), published);
});

test("overlay replay refuses a sample directory replacement while preserving both fixture generations", async (t) => {
  const f = fixture(t), sample = success(await f.start({ owner: "capture" }).result()) as string;
  const owner = f.start({ owner: "replay", triggers: [
    // Select the guarded read, not an incidental count of earlier whole-overlay walks.
    { method: "readdirSync", path: "/sample-001$", whileOpen: "/sample-001$" },
  ] });
  await owner.boundary();
  renameSync(sample, join(f.root, "original-sample"));
  mkdirSync(sample, { mode: 0o700 });
  writeFileSync(join(sample, "sentinel"), "replacement fixture", { mode: 0o600 });
  const original = snapshot(join(f.root, "original-sample")), replacement = snapshot(sample);
  await owner.resume();
  refusal(await owner.result(), /directory identity changed/, "CorpusSecurityError");
  assert.deepEqual(snapshot(sample), replacement);
  assert.deepEqual(snapshot(join(f.root, "original-sample")), original);
  assert.equal(inode(sample) === inode(join(f.root, "original-sample")), false);
});
