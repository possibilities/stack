import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, copyFile, appendFile, readlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const triple = process.platform === "darwin" ? "aarch64-apple-darwin" : "x86_64-unknown-linux-musl";

async function fixture(run) {
  const home = await mkdtemp(join(tmpdir(), "stack-install-"));
  const checkout = join(home, "checkout"), scripts = join(checkout, "scripts"), bin = join(home, "tools");
  const packageRoot = join(home, "package"), archive = join(home, "package.tgz");
  const pin = JSON.parse(await readFile(join(root, "scripts/codex-release.json"), "utf8"));
  await mkdir(scripts, { recursive: true }); await mkdir(bin); await mkdir(join(checkout, "bin"));
  for (const name of ["install.sh", "install-codex.py"]) await copyFile(join(root, "scripts", name), join(scripts, name));
  for (const name of ["bin/codex", "bin/codex-code-mode-host", "codex-path/rg", "codex-resources/voice/bin/codex-voice-host"]) {
    const path = join(packageRoot, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  }
  await writeFile(join(packageRoot, "codex-package.json"), JSON.stringify({ layoutVersion: 1, version: pin.version,
    target: triple, variant: "codex", entrypoint: "bin/codex", resourcesDir: "codex-resources", pathDir: "codex-path" }));
  const repin = async () => {
    const bytes = await readFile(archive);
    pin.assets[triple] = { name: "package.tgz", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    await writeFile(join(scripts, "codex-release.json"), JSON.stringify(pin));
  };
  const pack = async () => {
    const result = spawnSync("tar", ["-czf", archive, "-C", packageRoot, "bin", "codex-package.json", "codex-path", "codex-resources"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    await repin();
  };
  await pack();
  // The download transport supplies local fixture bytes. Verification and
  // extraction are the production installer, with an independently computed pin.
  await writeFile(join(bin, "gh"), '#!/bin/sh\n[ "${TEST_DOWNLOAD_FAIL:-0}" != 1 ] || exit 42\nwhile [ "$1" != "--dir" ]; do shift; done\ncp "$TEST_RUNTIME_ARCHIVE" "$2/package.tgz"\n', { mode: 0o700 });
  await writeFile(join(bin, "pnpm"), '#!/bin/sh\ntest -x "$HOME/.local/libexec/stack/codex/codex" || exit 51\nprintf "%s\\n" "$*" >> "$HOME/build-calls"\n', { mode: 0o700 });
  const env = { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, TEST_RUNTIME_ARCHIVE: archive,
    STACK_INSTALL_BIN_DIR: join(home, ".local/bin") };
  const invoke = (mode = "--install", extra = {}) => spawnSync("/bin/bash", [join(scripts, "install.sh"), mode], { env: { ...env, ...extra }, encoding: "utf8" });
  try { await run({ home, checkout, archive, packageRoot, pin, pack, repin, invoke }); }
  finally { await rm(home, { recursive: true, force: true }); }
}

test("setup installs the complete official package before building and is repeatable", () => fixture(async ({ home, checkout, pin, invoke }) => {
  for (let i = 0; i < 2; i++) {
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
  }
  const installed = join(home, ".local/libexec/stack/codex", `${pin.version}-${triple}`);
  assert.equal(await readlink(join(home, ".local/libexec/stack/codex/codex")), join(installed, "bin/codex"));
  assert.equal(await readlink(join(home, ".local/bin/stack")), join(await realpath(checkout), "bin/stack"));
  assert.equal(JSON.parse(await readFile(join(installed, "stack-runtime.json"), "utf8")).sha256, pin.assets[triple].sha256);
  assert.equal(await readFile(join(installed, "bin/codex-code-mode-host"), "utf8"), "#!/bin/sh\nexit 0\n");
  assert.deepEqual((await readFile(join(home, "build-calls"), "utf8")).trim().split("\n"), ["install --frozen-lockfile", "build", "install --frozen-lockfile", "build"]);
}));

test("plan is read-only and describes the official pin without a workshop", () => fixture(async ({ home, pin, invoke }) => {
  const plan = invoke("--check");
  assert.equal(plan.status, 0, plan.stderr);
  assert.ok(plan.stdout.includes(`openai/codex rust-v${pin.version}`));
  await assert.rejects(readFile(join(home, "build-calls")), /ENOENT/);
  await assert.rejects(readlink(join(home, ".local/libexec/stack/codex/codex")), /ENOENT/);
}));

test("setup refuses a foreign command before installing anything", () => fixture(async ({ home, invoke }) => {
  const bin = join(home, ".local/bin");
  await mkdir(bin, { recursive: true });
  await symlink("/unrelated/stack", join(bin, "stack"));
  assert.match(invoke().stderr, /Refusing to replace an independent command/);
  await assert.rejects(readlink(join(home, ".local/libexec/stack/codex/codex")), /ENOENT/);
}));

test("failed downloads, corrupt packages and missing companions never reach the build", () => fixture(async ({ home, archive, packageRoot, pack, invoke }) => {
  assert.notEqual(invoke("--install", { TEST_DOWNLOAD_FAIL: "1" }).status, 0);
  await appendFile(archive, "corrupt");
  assert.match(invoke().stderr, /size or SHA-256 mismatch/);
  await rm(join(packageRoot, "bin/codex-code-mode-host")); await pack();
  assert.match(invoke().stderr, /missing an executable companion/);
  await assert.rejects(readFile(join(home, "build-calls")), /ENOENT/);
  await assert.rejects(readlink(join(home, ".local/libexec/stack/codex/codex")), /ENOENT/);
}));

test("even a digest-matching package cannot escape the staging directory", () => fixture(async ({ home, archive, repin, invoke }) => {
  const created = spawnSync("python3", ["-c", "import io,sys,tarfile\nwith tarfile.open(sys.argv[1],'w:gz') as t:\n i=tarfile.TarInfo('../escape');i.size=6;t.addfile(i,io.BytesIO(b'escape'))", archive], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr); await repin();
  assert.match(invoke().stderr, /unsafe official Codex package entry/);
  await assert.rejects(readFile(join(home, ".local/libexec/stack/codex/escape")), /ENOENT/);
  await assert.rejects(readFile(join(home, "build-calls")), /ENOENT/);
}));
