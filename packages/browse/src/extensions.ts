import { createHash, createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { z } from "zod";
import { vaultConnection } from "./vault.js";
import { stateHash } from "@stack/api";

export const extensionName = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const extensionRef = z.strictObject({ id: extensionName, digest: z.string().regex(/^[a-f0-9]{64}$/) });
export const extensionSelection = z.array(extensionRef).max(32).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "Select each extension once");
export const extensionRecord = extensionRef.extend({ chromeId: z.string().regex(/^[a-p]{32}$/), name: z.string(), version: z.string(),
  permissions: z.array(z.string()), hostPermissions: z.array(z.string()), optionalPermissions: z.array(z.string()), optionalHostPermissions: z.array(z.string()),
  contentMatches: z.array(z.string()), importedAt: z.string(), source: z.enum(["directory", "zip", "bitwarden"]), bytes: z.number().int(),
  popup: z.string().nullable(), options: z.string().nullable() });
export type ExtensionRef = z.infer<typeof extensionRef>;
export type ExtensionRecord = z.infer<typeof extensionRecord>;
export const extensionConfiguration = z.strictObject({ profileId: z.uuid(), revision: z.string(), desired: extensionSelection, applied: extensionSelection.nullable(),
  appliedAt: z.string().nullable(), observedAt: z.string().nullable(), observed: z.array(z.strictObject({ id: z.string(), name: z.string(), version: z.string() })).nullable(),
  issue: z.string().nullable(), vaultId: z.uuid().nullable().default(null), appliedVault: vaultConnection.nullable().default(null) });
export type ExtensionConfiguration = z.infer<typeof extensionConfiguration>;
const MAX_ZIP = 50 * 1024 * 1024, MAX_TOTAL = 150 * 1024 * 1024, MAX_FILES = 10000;
const manifestSchema = z.object({ manifest_version: z.literal(3), name: z.string().min(1).max(256), version: z.string().regex(/^\d+(?:\.\d+){0,3}$/),
  key: z.string().optional(), permissions: z.array(z.string()).default([]), host_permissions: z.array(z.string()).default([]),
  optional_permissions: z.array(z.string()).default([]), optional_host_permissions: z.array(z.string()).default([]),
  content_scripts: z.array(z.object({ matches: z.array(z.string()).default([]) })).default([]),
  action: z.object({ default_popup: z.string().optional() }).optional(), options_page: z.string().optional(), options_ui: z.object({ page: z.string() }).optional(),
}).passthrough();

function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 512 && !/[\\\x00-\x1f\x7f:]/.test(name) && !name.startsWith("/") && name.replace(/\/$/, "").split("/").every(part => part !== "" && part !== "." && part !== "..");
}
/** Reject ZIP links, duplicate/colliding entries and declared expansion before decompression. Never extract to the host filesystem. */
export function extensionZip(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > MAX_ZIP) throw new Error("Extension ZIP exceeds 50 MiB");
  const view = Buffer.from(bytes); let end = -1;
  for (let i = view.length - 22; i >= Math.max(0, view.length - 65557); i--) if (view.readUInt32LE(i) === 0x06054b50 && i + 22 + view.readUInt16LE(i + 20) === view.length) { end = i; break; }
  if (end < 0 || view.readUInt16LE(end + 4) || view.readUInt16LE(end + 6)) throw new Error("Invalid or multipart extension ZIP");
  const count = view.readUInt16LE(end + 10), names = new Map<string, number>(); let at = view.readUInt32LE(end + 16), total = 0;
  if (count > MAX_FILES || at + view.readUInt32LE(end + 12) !== end) throw new Error("Invalid or oversized extension ZIP directory");
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.readUInt32LE(at) !== 0x02014b50) throw new Error("Invalid extension ZIP entry");
    const length = view.readUInt16LE(at + 28), extra = view.readUInt16LE(at + 30), comment = view.readUInt16LE(at + 32);
    const name = view.subarray(at + 46, at + 46 + length).toString("utf8"), kind = (view.readUInt32LE(at + 38) >>> 16) & 0xf000;
    total += view.readUInt32LE(at + 24);
    if (at + 46 + length + extra + comment > end || !safeName(name) || names.has(name) || (kind && kind !== 0x8000 && kind !== 0x4000)
      || view.readUInt16LE(at + 8) & 1 || total > MAX_TOTAL) throw new Error("Unsafe, duplicate, encrypted or oversized extension ZIP entry");
    names.set(name, view.readUInt32LE(at + 24)); at += 46 + length + extra + comment;
  }
  if (at !== end) throw new Error("Invalid extension ZIP directory length");
  for (const name of names.keys()) {
    const segments = name.replace(/\/$/, "").split("/");
    for (let n = 1; n < segments.length; n++) if (names.has(segments.slice(0, n).join("/"))) throw new Error("Extension file/directory collision");
    if (name.endsWith("/") && names.has(name.slice(0, -1))) throw new Error("Extension file/directory collision");
  }
  const files = unzipSync(bytes, { filter: entry => { if (names.get(entry.name) !== entry.originalSize || entry.originalSize > MAX_TOTAL) throw new Error("Extension ZIP directory mismatch"); return !entry.name.endsWith("/"); } });
  if (Object.keys(files).length > MAX_FILES || Object.values(files).reduce((sum, file) => sum + file.length, 0) > MAX_TOTAL) throw new Error("Extension expands beyond limit");
  return files;
}
async function directory(path: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = Object.create(null); let total = 0, count = 0;
  const walk = async (base: string, prefix: string) => {
    const stat = await lstat(base); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Extension directory must not be a symlink");
    for (const name of (await readdir(base)).sort()) {
      const relative = prefix + name; if (!safeName(relative)) throw new Error("Unsafe extension filename");
      const file = join(base, name), stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error("Extension symlinks are unsupported");
      if (stat.isDirectory()) { if (++count > MAX_FILES) throw new Error("Too many extension entries"); await walk(file, relative + "/"); }
      else {
        total += stat.size;
        if (!stat.isFile() || ++count > MAX_FILES || total > MAX_TOTAL) throw new Error("Invalid or oversized extension directory");
        const content = await readFile(file); if (content.length !== stat.size) throw new Error("Extension changed during import"); files[relative] = content;
      }
    }
  };
  await walk(path, ""); return files;
}
export const BITWARDEN = { version: "2026.10.0", url: "https://github.com/bitwarden/clients/releases/download/browser-v2026.10.0/dist-chrome-2026.10.0.zip",
  sha256: "7b9ec650b87dd8975e87a0e0bdd0c1f1a0fcf5b0a8da5ae759ec14cdffaad35d" } as const;

/** Catalog artifacts are immutable, content-addressed ZIPs. Per-profile choices are revisioned independently of application. */
export class Extensions {
  private readonly db: DatabaseSync;
  private queue = Promise.resolve();
  onChange?: () => void;
  constructor(readonly root: string) {
    this.db = new DatabaseSync(join(root, "extensions.sqlite"));
    chmodSync(join(root, "extensions.sqlite"), 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS extension_versions(id TEXT NOT NULL,digest TEXT NOT NULL,public_key TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(id,digest)); CREATE TABLE IF NOT EXISTS extension_profiles(id TEXT PRIMARY KEY,record TEXT NOT NULL)");
  }
  async close() { await this.queue; this.db.close(); }
  list(): ExtensionRecord[] { return this.db.prepare("SELECT record FROM extension_versions ORDER BY id,digest").all().map(row => extensionRecord.parse(JSON.parse(String(row.record)))); }
  get(ref: ExtensionRef): ExtensionRecord {
    const row = this.db.prepare("SELECT record FROM extension_versions WHERE id=? AND digest=?").get(ref.id, ref.digest);
    if (!row) throw new Error("Unknown extension version"); return extensionRecord.parse(JSON.parse(String(row.record)));
  }
  async archive(ref: ExtensionRef) {
    this.get(ref); const data = await readFile(join(this.root, "extensions", ref.digest + ".zip"));
    if (createHash("sha256").update(data).digest("hex") !== ref.digest) throw new Error("Extension artifact integrity failed"); return data;
  }
  async import(id: string, source: { path: string } | { bitwarden: true }): Promise<ExtensionRecord> {
    const run = async () => {
      extensionName.parse(id);
      let files: Record<string, Uint8Array>, kind: ExtensionRecord["source"];
      if ("bitwarden" in source) {
        if (id !== "bitwarden") throw new Error("Pinned Bitwarden import uses catalog name bitwarden");
        const response = await fetch(BITWARDEN.url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok || !response.body) throw new Error("Pinned Bitwarden download failed");
        const chunks: Uint8Array[] = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > MAX_ZIP) { throw new Error("Extension download exceeds limit"); } chunks.push(chunk); }
        const bytes = Buffer.concat(chunks);
        if (createHash("sha256").update(bytes).digest("hex") !== BITWARDEN.sha256) throw new Error("Pinned Bitwarden checksum mismatch");
        files = extensionZip(bytes); kind = "bitwarden";
      } else {
        if (id === "bitwarden") throw new Error("bitwarden is reserved for the verified upstream package");
        if (!isAbsolute(source.path)) throw new Error("Import requires an absolute local path");
        const stat = await lstat(source.path); if (stat.isSymbolicLink()) throw new Error("Extension source must not be a symlink");
        kind = stat.isDirectory() ? "directory" : "zip";
        if (stat.isFile() && stat.size <= MAX_ZIP) files = extensionZip(await readFile(source.path));
        else if (stat.isDirectory()) files = await directory(source.path);
        else throw new Error("Invalid or oversized extension source");
      }
      if (!files["manifest.json"] || files["manifest.json"].length > 1024 * 1024) throw new Error("An MV3 manifest.json must be at the extension root");
      const original = JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8"));
      const manifest = manifestSchema.parse(original);
      if (manifest.version.split(".").some((part: string) => Number(part) > 65535 || part.length > 1 && part.startsWith("0")) || !manifest.version.split(".").some((part: string) => Number(part) > 0)) throw new Error("Invalid Chromium extension version");
      const previous = this.db.prepare("SELECT public_key FROM extension_versions WHERE id=? LIMIT 1").get(id);
      const publicKey = manifest.key ?? (previous ? String(previous.public_key) : generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64"));
      const der = createPublicKey({ key: Buffer.from(publicKey, "base64"), type: "spki", format: "der" }).export({ type: "spki", format: "der" });
      if (previous && previous.public_key !== publicKey) throw new Error("Extension public key changed; import under a new catalog name");
      const chromeId = createHash("sha256").update(der).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
      if (this.list().some(row => row.id !== id && row.chromeId === chromeId)) throw new Error("Chrome extension identity already belongs to another catalog entry");
      files["manifest.json"] = Buffer.from(JSON.stringify({ ...original, key: publicKey }));
      const normalized: Zippable = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, [data, { mtime: new Date("2000-01-01T00:00:00Z") }] as [Uint8Array, { mtime: Date }]]));
      const archive = Buffer.from(zipSync(normalized, { level: 6 })); if (archive.length > MAX_ZIP) throw new Error("Normalized extension exceeds 50 MiB");
      const digest = createHash("sha256").update(archive).digest("hex"), found = this.list().find(row => row.id === id && row.digest === digest); if (found) return found;
      const page = (path?: string) => { if (!path) return null; if (!safeName(path) || !files[path]) throw new Error("Extension UI path is missing or unsafe"); return path; };
      const record: ExtensionRecord = { id, digest, chromeId, name: manifest.name, version: manifest.version, permissions: manifest.permissions, hostPermissions: manifest.host_permissions,
        optionalPermissions: manifest.optional_permissions, optionalHostPermissions: manifest.optional_host_permissions, contentMatches: [...new Set(manifest.content_scripts.flatMap(row => row.matches))],
        importedAt: new Date().toISOString(), source: kind, bytes: archive.length, popup: page(manifest.action?.default_popup), options: page(manifest.options_page ?? manifest.options_ui?.page) };
      const dir = join(this.root, "extensions"); await mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = join(dir, randomUUID() + ".tmp");
      try { await writeFile(temp, archive, { flag: "wx", mode: 0o600 }); await rename(temp, join(dir, digest + ".zip")); }
      finally { await rm(temp, { force: true }); }
      this.db.prepare("INSERT INTO extension_versions VALUES(?,?,?,?)").run(id, digest, publicKey, JSON.stringify(record)); this.onChange?.(); return record;
    };
    const task = this.queue.then(run, run); this.queue = task.then(() => undefined, () => undefined); return task;
  }
  configuration(profileId: string): ExtensionConfiguration {
    const row = this.db.prepare("SELECT record FROM extension_profiles WHERE id=?").get(profileId);
    return row ? extensionConfiguration.parse(JSON.parse(String(row.record))) : { profileId, revision: stateHash([]), desired: [], applied: null, appliedAt: null, observedAt: null, observed: null, issue: null, vaultId: null, appliedVault: null };
  }
  private save(value: ExtensionConfiguration) { this.db.prepare("INSERT OR REPLACE INTO extension_profiles VALUES(?,?)").run(value.profileId, JSON.stringify(value)); this.onChange?.(); return value; }
  set(profileId: string, expectedRevision: string, refs: ExtensionRef[], vaultId?: string | null) {
    const current = this.configuration(profileId); if (current.revision !== expectedRevision) throw new Error("Extension configuration changed; read it again");
    const desired = extensionSelection.parse(refs).sort((a,b) => a.id.localeCompare(b.id)); desired.forEach(ref => this.get(ref));
    return this.save({ ...current, desired, vaultId: vaultId === undefined ? current.vaultId : vaultId, revision: randomUUID() });
  }
  applied(profileId: string, refs: ExtensionRef[], observed: ExtensionConfiguration["observed"], appliedVault: ExtensionConfiguration["appliedVault"] = null) { return this.save({ ...this.configuration(profileId), applied: refs, appliedVault, appliedAt: new Date().toISOString(), observedAt: new Date().toISOString(), observed, issue: null }); }
  observe(profileId: string, observed: ExtensionConfiguration["observed"]) { return this.save({ ...this.configuration(profileId), observed, observedAt: new Date().toISOString() }); }
  reset(profileId: string) { return this.save({ ...this.configuration(profileId), applied: null, appliedVault: null, observed: null, observedAt: null, appliedAt: null, issue: "Profile reset; saved extensions and vault connection require explicit reapplication" }); }
  unavailable(profileId: string, issue: string) { return this.save({ ...this.configuration(profileId), observedAt: new Date().toISOString(), observed: null, issue }); }
}
