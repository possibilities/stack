import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { accountRoot, prepareAccountProfile, type WorkerAccount } from "@stack/auth";
import { observeNativeSession, purgeNativeSession } from "../src/native-session.js";
import { WorkerLedger } from "../src/ledger.js";

test("native purge checks capabilities and storage on demand, binds the executable and verifies deletion", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "stack-purge-contract-")));
  const ledger = new WorkerLedger(root);
  const account: WorkerAccount = { id: randomUUID(), provider: "devin", ready: true, enabled: false, removing: false };
  try {
    await prepareAccountProfile(root, account);
    const cwd = join(root, "cwd"); await mkdir(cwd);
    const reserved = ledger.reserve({ botId: "_local_operator", threadId: "", accountId: account.id, provider: "devin",
      model: "fixture", effort: null, repo: cwd, baseRef: null, task: "fixture", requestId: randomUUID() });
    ledger.setWorktree(reserved.worker.id, { repo: cwd, cwd, branch: "fixture", baseCommit: "f".repeat(40), sourceDirty: false, roleId: randomUUID(), roleRevision: 1 });
    ledger.setSession(reserved.worker.id, "selected-session"); ledger.setWorkerPhase(reserved.worker.id, "closed");
    const worker = ledger.worker(reserved.worker.id)!;
    const data = join(accountRoot(root, account.id), "data", "devin"); await mkdir(join(data, "cli"), { recursive: true });
    const path = join(data, "cli", "sessions.db"), credential = join(data, "credentials.toml");
    await writeFile(credential, "credential sentinel");
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY, working_directory TEXT);
      CREATE TABLE prompt_history(id INTEGER PRIMARY KEY, session_id TEXT, content TEXT);`);
    for (const id of ["selected-session", "sibling-session"]) {
      db.prepare("INSERT INTO sessions VALUES(?,?)").run(id, cwd);
      db.prepare("INSERT INTO prompt_history(session_id,content) VALUES(?,?)").run(id, id + " prompt");
    }
    db.close();
    // This fixture implements only command discovery. A deletion call is a no-op,
    // so the owner must refuse to report a completed purge.
    const binary = join(root, "devin"), env = { ...process.env, STACK_DEVIN_BIN: binary };
    const script = (help: string) => `#!/bin/sh\ncase "$1" in\n--version) echo 'devin 9999.0.0';;\nrm) if [ "$2" = --help ]; then echo '${help}'; fi;;\nesac\n`;
    await writeFile(binary, script("Usage: devin rm [OPTIONS] <TARGET> --force"), { mode: 0o700 });
    const initial = await observeNativeSession(root, worker, env);
    assert.deepEqual(initial.blockedBy, [], "a new release with the required contract is accepted");

    await writeFile(binary, script("Usage: devin rm [OPTIONS] <TARGET>"));
    await assert.rejects(observeNativeSession(root, worker, env), /command.*incompatible/);
    await writeFile(binary, script("Usage: devin rm [OPTIONS] <TARGET> --force") + "# replacement\n");
    await assert.rejects(purgeNativeSession(root, worker, env, initial.revision), /changed/);

    const schema = new DatabaseSync(path); schema.exec("ALTER TABLE prompt_history RENAME COLUMN session_id TO conversation_id"); schema.close();
    await assert.rejects(observeNativeSession(root, worker, env), /schema.*incompatible/);
    const restored = new DatabaseSync(path); restored.exec("ALTER TABLE prompt_history RENAME COLUMN conversation_id TO session_id"); restored.close();
    const current = await observeNativeSession(root, worker, env);
    await assert.rejects(purgeNativeSession(root, worker, env, current.revision), /preservation could not be verified/);
    const retained = new DatabaseSync(path, { readOnly: true });
    assert.equal(retained.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n, 2);
    assert.equal(retained.prepare("SELECT COUNT(*) AS n FROM prompt_history").get()!.n, 2); retained.close();
    assert.equal(await readFile(credential, "utf8"), "credential sentinel");
  } finally { ledger.close(); await rm(root, { recursive: true, force: true }); }
});
