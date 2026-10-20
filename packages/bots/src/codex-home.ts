import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { constants } from "node:fs";
import { parent } from "./chat-metadata.js";
import type { StateStore } from "./store.js";

/** Legacy shared rollouts are copied by sanctioned lineage, never moved or mounted as a shared home. */
export async function privateHistoryHome(store: StateStore, id: string, mainThreadId: string | null): Promise<string> {
  const identity = store.stateIdentity(id);
  const generation = store.historyGenerations(id).find(row => row.generation === identity.generation)!;
  if (generation.ownership === "stack") return generation.historyPath;
  const destination = join(store.stateDir, "history", id);
  const receipt = JSON.stringify({ version: 1, botId: id, generation: identity.generation, source: generation.historyPath, mainThreadId });
  const marker = ".stack-history-migration.json";
  const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    if (!existing.isDirectory() || await readFile(join(destination, marker), "utf8") !== receipt)
      throw new Error("Unrecognized private Bot history; inspect it before migrating shared history");
    store.privatizeHistory(id, identity.generation, destination);
    return destination;
  }
  const files: { path: string; id: string; parentId: string | null }[] = [];
  const source = await lstat(generation.historyPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (source && !source.isDirectory()) throw new Error("Shared Bot history must be a real directory");
  const scan = async (directory: string, top = false): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && top) return [];
      throw error;
    });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && (!top || /^\d{4}$/.test(entry.name) || ["sessions", "archived_sessions"].includes(entry.name))) await scan(path);
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        for await (const line of file.readLines()) {
          const record = JSON.parse(line);
          if (record.type !== "session_meta" || typeof record.payload?.id !== "string") break;
          const parentId = parent(record.payload);
          if (parentId !== undefined) files.push({ path, id: record.payload.id, parentId });
          break;
        }
      } finally { await file.close(); }
    }
  };
  await scan(generation.historyPath, true);
  const parents = new Map<string, string | null>();
  for (const file of files) {
    if (parents.has(file.id) && parents.get(file.id) !== file.parentId) throw new Error("Conflicting legacy thread lineage; inspect history before migration");
    parents.set(file.id, file.parentId);
  }
  const sanctioned = (threadId: string): boolean => {
    const seen = new Set<string>();
    let current: string | null = threadId;
    while (current && !seen.has(current)) {
      if (current === mainThreadId) return true;
      seen.add(current); current = parents.get(current) ?? null;
    }
    return false;
  };
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const staging = join(dirname(destination), `.history-${id}-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const file of files.filter(file => sanctioned(file.id))) {
      const path = relative(generation.historyPath, file.path);
      // Earliest stores had date partitions directly under history/.
      const target = join(staging, /^\d{4}\//.test(path) ? "sessions" : "", path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(file.path, target, constants.COPYFILE_EXCL);
      await chmod(target, 0o600);
    }
    await writeFile(join(staging, marker), receipt, { mode: 0o600, flag: "wx" });
    await rename(staging, destination);
    store.privatizeHistory(id, identity.generation, destination);
  } finally { await rm(staging, { recursive: true, force: true }); }
  return destination;
}

/** The conversation owns native state; the current launch owns account and Role inputs. */
export async function prepareCodexHome(home: string, role: string, runtime: string, auth: string | null): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  if (!(await lstat(home)).isDirectory()) throw new Error("Bot Codex home must be a real directory");
  await chmod(home, 0o700);
  if (auth !== null) await writeFile(join(runtime, "auth.json"), auth, { mode: 0o600, flag: "wx" });
  for (const [name, target] of [["auth.json", join(runtime, "auth.json")], ["config.toml", join(role, "config.toml")], ["skills", join(role, "skills")]]) {
    const path = join(home, name);
    const previous = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    // These paths belong to Stack's launch input contract, never to native history.
    // Refuse an unexplained directory instead of recursively deleting it.
    if (previous?.isDirectory()) throw new Error(`Bot Codex home has an unexpected ${name} directory`);
    const temporary = join(home, `.launch-${randomUUID()}`);
    try { await symlink(target, temporary); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
}

/** A stopped or retired conversation must not retain a link into a later account's launch. */
export async function releaseCodexHome(home: string, role: string, runtime: string): Promise<void> {
  for (const [name, target] of [["auth.json", join(runtime, "auth.json")], ["config.toml", join(role, "config.toml")], ["skills", join(role, "skills")]]) {
    const path = join(home, name);
    const link = await readlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "EINVAL") return null;
      throw error;
    });
    if (link === target) await rm(path);
  }
}
