import { createServer, connect, type Server, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import { StateJournal, stateHash, type StateApplyInput, type StateOutcome } from "@stack/api";
import type { BrowserSystem } from "./system.js";
import { guestExec } from "./guest-exec.js";

export const VAULT_IMAGE = "docker.io/vaultwarden/server@sha256:efb3cde962015fcc036b2ea625242248611943b27212ebf4392841fb30fad055";
export const VAULT_VERSION = "1.37.4";
const recordSchema = z.strictObject({ image: z.literal(VAULT_IMAGE).default(VAULT_IMAGE), version: z.literal(VAULT_VERSION).default(VAULT_VERSION), id: z.uuid(), provider: z.string(), instanceId: z.string().nullable(), volumeId: z.string().nullable(),
  ingress: z.strictObject({ ip: z.ipv4(), port: z.number().int().min(1024).max(65535) }).nullable().default(null), desiredRunning: z.boolean().default(false),
  certificate: z.string().nullable(), signupsAllowed: z.boolean(), fence: z.uuid().nullable() });
type Record = z.infer<typeof recordSchema>;
export const vaultConnection = z.strictObject({ id: z.uuid(), origin: z.string(), hostname: z.string(), ip: z.ipv4(), spki: z.string() });
export type VaultConnection = z.infer<typeof vaultConnection>;
export const vaultStatus = z.strictObject({ id: z.uuid().nullable(), version: z.string(), image: z.string(), revision: z.string(),
  desiredRunning: z.boolean(),
  state: z.enum(["absent", "running", "stopped", "unavailable"]), healthy: z.boolean(), signupsAllowed: z.boolean(),
  instanceId: z.string().nullable(), volumeId: z.string().nullable(), fence: z.uuid().nullable(), connection: vaultConnection.nullable(), blockedBy: z.array(z.string()) });
export const vaultSelection = z.strictObject({ action: z.enum(["start", "stop", "backup", "delete", "restore"]), signupsAllowed: z.boolean().default(false), backupId: z.uuid().optional() });
type Selection = z.infer<typeof vaultSelection>;
export const vaultBackup = z.strictObject({ id: z.uuid(), vaultId: z.uuid(), createdAt: z.iso.datetime(), bytes: z.number().int(), sha256: z.string(), path: z.string() });
const obj = (value: unknown): any => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider record"); return value; };
const idOf = (value: any): string => { if (typeof value?.id !== "string" || !value.id || value.id.length > 128) throw new Error("Provider resource identity missing"); return value.id; };
const arr = (value: unknown): any[] => { if (!Array.isArray(value)) throw new Error("Invalid provider inventory"); return value; };
const hostname = (r: Record) => `vault-${r.id}.stack.invalid`;
const name = (r: Record, kind: "instance" | "volume") => `stack-vault-${kind}-${r.id}`;
const tags = (r: Record) => ({ "dev.stack.vault": r.id });
const owned = (r: Record, value: any, kind: "instance" | "volume") => value?.name === name(r, kind) && value?.tags?.["dev.stack.vault"] === r.id;

/** Dedicated service, separate from all browser volumes. No plaintext vault items or master passwords enter this API. */
export class Vault {
  readonly journal: StateJournal;
  private queue = Promise.resolve();
  private closing = false;
  private proxy: Server | null = null;
  private sockets = new Set<Socket>();
  onChange?: () => void;
  constructor(private readonly system: BrowserSystem) { this.journal = new StateJournal(join(system.root, "vault-maintenance.sqlite"), "browse"); }
  private get path() { return join(this.system.root, "vaultwarden.json"); }
  private async read(): Promise<Record | null> { try { return recordSchema.parse(JSON.parse(await readFile(this.path, "utf8"))); } catch(e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } }
  private async save(record: Record | null) {
    if (!record) await rm(this.path, { force: true });
    else { const tmp = this.path + "." + randomUUID(); try { await writeFile(tmp, JSON.stringify(record), { flag: "wx", mode: 0o600 }); await rename(tmp, this.path); } finally { await rm(tmp, { force: true }); } }
    this.onChange?.();
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const task = this.queue.then(fn, fn); this.queue = task.then(() => undefined, () => undefined); return task; }
  private async provider() { const connection = await this.system.connection(); return { connection, fingerprint: stateHash([this.system.selectedHypemanRoot(), connection.baseUrl]) }; }
  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const { connection } = await this.provider();
    const response = await fetch(connection.baseUrl + path, { method, headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(30000) });
    if (response.status === 404) return null;
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Vault provider operation failed (${response.status})`); }
    return response.status === 204 ? null : response.json();
  }
  private async inspect() {
    const record = await this.read(), { fingerprint } = await this.provider();
    if (record && record.provider !== fingerprint) throw new Error("Vault belongs to another selected provider");
    const [instances, volumes] = await Promise.all([this.request("GET", "/instances").then(arr), this.request("GET", "/volumes").then(arr)]);
    const i = record ? instances.filter(v => v.name === name(record, "instance") || v.id === record.instanceId) : [];
    const v = record ? volumes.filter(v => v.name === name(record, "volume") || v.id === record.volumeId) : [];
    if (record && (i.length > 1 || v.length > 1 || i.some(x => !owned(record, x, "instance") || record.instanceId && x.id !== record.instanceId)
      || v.some(x => !owned(record, x, "volume") || record.volumeId && x.id !== record.volumeId))) throw new Error("Vault incarnation/name/ownership changed");
    const instance = i[0] ?? null, volume = v[0] ?? null;
    if (volume && instances.some(x => x.id !== instance?.id && x.volumes?.some((m: any) => m.volume_id === volume.id))) throw new Error("Vault volume mounted by another instance");
    if (instance && (!volume || instance.volumes?.length !== 1 || !instance.volumes.some((m: any) => m.volume_id === volume.id && m.mount_path === "/data" && m.readonly === false)
      || instance.image !== record!.image)) throw new Error("Vault image or volume mount changed");
    const ip = instance?.network?.ip;
    if (ip && (typeof ip !== "string" || !(await this.system.guestSubnet())(ip))) throw new Error("Invalid vault guest address");
    return { record, fingerprint, instance, volume, ip, revision: stateHash([record, fingerprint, instance?.id, instance?.state, ip, volume?.id]) };
  }
  async status(): Promise<z.infer<typeof vaultStatus>> {
    const record = await this.read();
    const base = { desiredRunning: record?.desiredRunning ?? false, id: record?.id ?? null, version: record?.version ?? VAULT_VERSION, image: record?.image ?? VAULT_IMAGE, signupsAllowed: record?.signupsAllowed ?? false,
      instanceId: record?.instanceId ?? null, volumeId: record?.volumeId ?? null, fence: record?.fence ?? null };
    if (!record) return { ...base, revision: stateHash(null), state: "absent", healthy: false, connection: null, blockedBy: [] };
    try {
      const current = await this.inspect(), { instance, ip } = current;
      let connection: VaultConnection | null = null, healthy = false;
      if (record.certificate && record.ingress && this.proxy && instance?.state === "Running" && ip) {
        const certificate = new X509Certificate(record.certificate), spki = createHash("sha256").update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64");
        connection = { id: record.id, hostname: hostname(record), origin: `https://${hostname(record)}:${record.ingress.port}`, ip: record.ingress.ip, spki };
        healthy = await this.health({ ...connection, ip }, record.certificate);
      }
      return { ...base, revision: current.revision, state: instance?.state === "Running" ? "running" : instance?.state === "Stopped" ? "stopped" : "unavailable", healthy, connection,
        blockedBy: [...(record.fence ? ["Vault effect remains fenced; inspect its receipt before release"] : []), ...(!instance || !current.volume ? ["Vault resource admission incomplete or resources missing"] : [])] };
    } catch { return { ...base, revision: stateHash(record), state: "unavailable", healthy: false, connection: null, blockedBy: ["Vault provider/resource identity unavailable; no lifecycle effects authorized"] }; }
  }
  private health(connection: VaultConnection, certificate: string): Promise<boolean> {
    return new Promise(resolve => {
      const req = httpsRequest({ hostname: connection.ip, port: 8443, servername: connection.hostname, path: "/alive", ca: certificate, timeout: 3000, method: "GET" }, res => { res.resume(); resolve(res.statusCode === 200); });
      req.on("error", () => resolve(false)); req.on("timeout", () => { req.destroy(); resolve(false); }); req.end();
    });
  }
  async connectionFor(id: string): Promise<VaultConnection> {
    const status = await this.status(); if (status.id !== id || status.fence || !status.healthy || !status.connection) throw new Error("Selected vault is not verified ready"); return status.connection;
  }
  private async preview(selection: Selection) {
    const record = await this.read(); let revision = stateHash(null), blockedBy: string[] = [], resources: string[] = [];
    try {
      const current = await this.inspect(); revision = current.revision;
      resources = [current.instance?.id, current.volume?.id].filter(Boolean);
      if (record?.fence) blockedBy.push("Vault has an unresolved effect fence");
      if (selection.action !== "start" && selection.signupsAllowed) blockedBy.push("Registration selection belongs only to start");
      if (selection.action === "restore") {
        if (record) blockedBy.push("Delete the existing service explicitly before restoring a backup");
        if (!selection.backupId) blockedBy.push("Select an exact backup ID");
        else { const backup = await this.backupSource(selection.backupId); revision = stateHash([revision, backup.metadata, backup.record]); resources.push(backup.metadata.path); if (backup.record.provider !== current.fingerprint) blockedBy.push("Backup belongs to another provider destination"); }
      } else if (selection.backupId) blockedBy.push("backupId belongs only to restore");
      if (selection.action !== "start" && selection.action !== "restore" && !record) blockedBy.push("No managed vault");
      if (selection.action === "start" && current.instance && current.instance.state !== "Stopped") blockedBy.push("Stop the vault before starting with a new registration policy");
      if (["stop", "backup"].includes(selection.action) && current.instance?.state !== "Running") blockedBy.push("Vault must be running for graceful stop or backup");
      if (selection.action === "delete" && current.instance && current.instance.state !== "Stopped") blockedBy.push("Stop the vault before deletion");
      if (selection.action === "start" && record && (!current.instance || !current.volume)) blockedBy.push("Incomplete vault admission; inspect and delete its exact resources before creating a replacement");
    } catch { blockedBy.push("Selected provider/resource identity unavailable"); }
    return { subject: record ? { kind: "browser-vault", id: record.id } : null, action: `browser_vault_${selection.action}`, revision: stateHash([revision, selection]), resources, blockedBy,
      retained: ["Browser extension sign-ins and decrypted local caches are independent; stopping or deleting the service does not revoke offline clients", "Backups contain encrypted vault contents plus account metadata and service private keys; protect them as credentials", "Other provider resources and existing backup files remain"],
      regeneration: [selection.action === "restore" ? "Restore the selected checksum-verified full backup into a new volume and start registration closed. Existing client caches may reflect newer data; reauthenticate clients after rollback" : selection.action === "start" ? `Explicit start uses pinned Vaultwarden ${VAULT_VERSION}; registration ${selection.signupsAllowed ? "OPEN until explicitly stopped and restarted closed" : "closed"}. Account creation and unlock happen in the existing vault/extension UI` : selection.action === "backup" ? "Backup gracefully stops the service and VM; explicit start is required afterward" : "No automatic start, account creation, unlock or restoration"] };
  }
  async plan(input: Selection) { const selection = vaultSelection.parse(input); return this.serial(async () => this.journal.plan(await this.preview(selection), selection)); }
  async apply(input: StateApplyInput) {
    return this.serial(() => this.system.maintainProvider(async () => {
      const previous = this.journal.existing(input); if (previous) return previous;
      if (this.closing) throw new Error("Vault owner is closing");
      const saved = this.journal.getPlan(input.planId), selection = vaultSelection.parse(saved.payload), current = await this.preview(selection);
      if (saved.plan.revision !== input.expectedRevision || current.revision !== input.expectedRevision) throw new Error("Vault changed; prepare a new plan");
      if (current.blockedBy.length) throw new Error(current.blockedBy.join("; "));
      this.journal.begin(input, saved.plan);
      const outcomes: StateOutcome[] = [];
      let record = await this.read();
      try {
        const restore = selection.action === "restore" ? await this.backupSource(selection.backupId!) : null;
        if (restore) record = { ...restore.record, instanceId: null, volumeId: null, desiredRunning: false, fence: null };
        record ??= { image: VAULT_IMAGE, version: VAULT_VERSION, id: randomUUID(), provider: (await this.provider()).fingerprint, instanceId: null, volumeId: null, certificate: null, ingress: null, desiredRunning: false, signupsAllowed: false, fence: null };
        record.fence = input.requestId; await this.save(record);
        if (restore) {
          const native = await this.inspect(); if (native.instance || native.volume) throw new Error("Backup resource names are occupied; never adopt them");
          const { connection } = await this.provider(), query = new URLSearchParams({ name: name(record, "volume"), size_gb: "2", "tags[dev.stack.vault]": record.id });
          const response = await fetch(connection.baseUrl + "/volumes/from-archive?" + query, { method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/gzip" }, body: new Uint8Array(restore.bytes), signal: AbortSignal.timeout(120000), redirect: "error" });
          if (!response.ok) { await response.body?.cancel(); throw new Error("Vault backup restore unconfirmed"); }
          const volume = obj(await response.json()); if (typeof volume.id !== "string") throw new Error("Restored volume identity missing"); record.volumeId = volume.id; await this.save(record);
          await this.start(record, false); record.desiredRunning = true;
        } else if (selection.action === "start") { await this.start(record, selection.signupsAllowed); record.desiredRunning = true; }
        else if (selection.action === "stop" || selection.action === "backup") {
          const native = await this.inspect();
          if (!native.instance || native.instance.state !== "Running") throw new Error("Vault is no longer running");
          await this.stopProcess(native.instance.id);
          if (selection.action === "backup") {
            const bytes = await guestExec((await this.provider()).connection, native.instance.id, ["/bin/sh", "-c", "tar -czf - --exclude=./lost+found -C /data . 2>/dev/null"], 120, 256 * 1024 * 1024);
            const dir = join(this.system.root, "vault-backups"); await mkdir(dir, { recursive: true, mode: 0o700 });
            const path = join(dir, input.requestId + ".tar.gz"); await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
            const metadata = { id: input.requestId, vaultId: record.id, createdAt: new Date().toISOString(), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), path };
            await writeFile(join(dir, input.requestId + ".record.json"), JSON.stringify({ ...record, fence: null, desiredRunning: false }), { flag: "wx", mode: 0o600 });
            await writeFile(join(dir, input.requestId + ".json"), JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
            outcomes.push({ resource: path, outcome: "retained", detail: "Stopped-writer full /data backup, including TLS and signing keys; copy to protected independent storage" });
          }
          await this.request("POST", `/instances/${encodeURIComponent(native.instance.id)}/stop`, {});
          const stopped = await this.inspect(); if (stopped.instance?.state !== "Stopped") throw new Error("Vault stop not confirmed");
          record.desiredRunning = false; await this.closeProxy();
        } else {
          const native = await this.inspect();
          if (native.instance) { await this.request("DELETE", `/instances/${encodeURIComponent(native.instance.id)}`); if ((await this.inspect()).instance) throw new Error("Vault instance removal unconfirmed"); outcomes.push({ resource: native.instance.id, outcome: "removed", detail: "Exact owned vault VM absent" }); }
          if (native.volume) { await this.request("DELETE", `/volumes/${encodeURIComponent(native.volume.id)}`); if ((await this.inspect()).volume) throw new Error("Vault volume removal unconfirmed"); outcomes.push({ resource: native.volume.id, outcome: "removed", detail: "Exact vault data volume absent; external backups and browser caches remain" }); }
        }
        outcomes.push({ resource: record.id, outcome: selection.action === "delete" ? "removed" : "retained", detail: `Vault ${selection.action} verified` });
        const receipt = this.journal.finish(input.requestId, "completed", outcomes);
        if (selection.action === "delete") { await this.closeProxy(); await this.save(null); } else { record.fence = null; await this.save(record); }
        return receipt;
      } catch {
        return this.journal.finish(input.requestId, outcomes.length ? "partial" : "unknown", [...outcomes, { resource: record?.id ?? input.planId, outcome: "unknown", detail: "Vault effect unconfirmed. Inspect resources and receipt; this request never re-executes" }]);
      }
    }));
  }
  private async listen(record: Record) {
    if (this.proxy) return;
    const allowed = await this.system.guestSubnet();
    const addresses = Object.values(networkInterfaces()).flatMap(rows => rows ?? []).filter(row => row.family === "IPv4" && !row.internal && allowed(row.address)).map(row => row.address);
    if (record.ingress && !addresses.includes(record.ingress.ip) || !record.ingress && addresses.length !== 1) throw new Error("Exact private guest bridge address unavailable");
    const ip = record.ingress?.ip ?? addresses[0]!;
    const server = createServer(client => {
      if (!client.remoteAddress || !allowed(client.remoteAddress) || this.sockets.size >= 100) { client.destroy(); return; }
      this.sockets.add(client); client.on("close", () => this.sockets.delete(client)); client.on("error", () => client.destroy());
      void this.inspect().then(native => {
        if (client.destroyed || native.record?.id !== record.id || native.instance?.state !== "Running" || !native.ip) { client.destroy(); return; }
        const upstream = connect({ host: native.ip, port: 8443 }); this.sockets.add(upstream);
        upstream.on("close", () => { this.sockets.delete(upstream); client.destroy(); }); upstream.on("error", () => client.destroy()); client.on("close", () => upstream.destroy()); client.pipe(upstream).pipe(client);
      }).catch(() => client.destroy());
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(record.ingress?.port ?? 0, ip, () => { server.removeListener("error", reject); resolve(); }); });
    server.on("error", () => { void this.closeProxy(); }); this.proxy = server;
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Vault ingress unavailable");
    record.ingress = { ip, port: address.port }; await this.save(record);
  }
  private async closeProxy() { const server = this.proxy; this.proxy = null; for (const socket of this.sockets) socket.destroy(); this.sockets.clear(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); }
  /** Restore only the previously selected service intent; interrupted effects stay fenced. Registration never reopens on owner recovery. */
  async recover() {
    const record = await this.read(); if (!record || record.fence || !record.desiredRunning) return;
    try {
      await this.system.ensureRunning(); const native = await this.inspect();
      if (native.instance?.state === "Running") await this.listen(record);
      else if (native.instance?.state === "Stopped") { const plan = await this.plan({ action: "start", signupsAllowed: false }); if (!plan.blockedBy.length) await this.apply({ planId: plan.id, expectedRevision: plan.revision, requestId: randomUUID() }); }
    } catch { this.onChange?.(); /* Explicit status/receipt inspection; never replace missing resources. */ }
  }

  private boot(record: Record, signupsAllowed: boolean) {
    // Only Stack-generated UUIDs/booleans enter this audited script. Keys stay inside the volume.
    return `set -eu; umask 077; mkdir -p /data/tls; if [ ! -f /data/tls/cert.pem ]; then openssl req -x509 -newkey rsa:3072 -nodes -keyout /data/tls/key.pem -out /data/tls/cert.pem -days 3650 -subj /CN=${hostname(record)} -addext subjectAltName=DNS:${hostname(record)} >/dev/null 2>&1; fi; export DOMAIN=https://${hostname(record)}:${record.ingress!.port} ROCKET_ADDRESS=0.0.0.0 ROCKET_PORT=8443 ROCKET_TLS='{certs="/data/tls/cert.pem",key="/data/tls/key.pem"}' SIGNUPS_ALLOWED=${signupsAllowed} INVITATIONS_ALLOWED=false ADMIN_TOKEN='' DISABLE_ICON_DOWNLOAD=true DATA_FOLDER=/data WEB_VAULT_FOLDER=/web-vault; /vaultwarden & child=$!; echo $child > /run/stack-vault.pid; trap 'kill -TERM $child 2>/dev/null || true; wait $child || true; sync; exit' TERM INT; wait $child || true; sync; while sleep 3600; do :; done`;
  }
  private async start(record: Record, signupsAllowed: boolean) {
    await this.listen(record);
    let image = await this.request("GET", `/images/${encodeURIComponent(record.image)}`);
    if (!image) image = await this.request("POST", "/images", { name: record.image, platform: process.arch === "arm64" ? "linux/arm64" : "linux/amd64" });
    const deadline = Date.now() + 180000;
    while (image?.status !== "ready") { if (image?.status === "failed" || Date.now() > deadline) throw new Error("Pinned vault image is not ready"); await new Promise(r => setTimeout(r, 1000)); image = await this.request("GET", `/images/${encodeURIComponent(record.image)}`); }
    let native = await this.inspect();
    if (!native.volume) { const volume = obj(await this.request("POST", "/volumes", { name: name(record, "volume"), size_gb: 2, tags: tags(record) })); record.volumeId = idOf(volume); await this.save(record); }
    record.signupsAllowed = signupsAllowed; await this.save(record);
    const launch = { entrypoint: ["/bin/sh", "-c"], cmd: [this.boot(record, signupsAllowed)] };
    if (!native.instance) {
      const instance = obj(await this.request("POST", "/instances", { name: name(record, "instance"), image: record.image, platform: process.arch === "arm64" ? "linux/arm64" : "linux/amd64", size: "1G", vcpus: 1, tags: tags(record), volumes: [{ volume_id: record.volumeId, mount_path: "/data", readonly: false }], skip_kernel_headers: true, ...launch }));
      record.instanceId = idOf(instance); await this.save(record);
    } else await this.request("POST", `/instances/${encodeURIComponent(native.instance.id)}/start`, launch);
    for (let i = 0; i < 30; i++) { native = await this.inspect(); if (native.instance?.state === "Running") break; await new Promise(r => setTimeout(r, 1000)); }
    if (!native.instance || native.instance.state !== "Running") throw new Error("Vault VM not running");
    const cert = (await guestExec((await this.provider()).connection, native.instance.id, ["/bin/sh", "-c", "for n in 1 2 3 4 5 6 7 8 9 10; do if test -s /data/tls/cert.pem; then cat /data/tls/cert.pem; exit; fi; sleep 1; done; exit 1"], 20)).toString();
    new X509Certificate(cert); if (record.certificate && record.certificate !== cert) throw new Error("Vault TLS identity changed"); record.certificate = cert; await this.save(record);
    for (let i = 0; i < 30; i++) { if ((await this.status()).healthy) return; await new Promise(r => setTimeout(r, 1000)); }
    throw new Error("Vault HTTPS readiness not verified");
  }
  private async stopProcess(instanceId: string) {
    await guestExec((await this.provider()).connection, instanceId, ["/bin/sh", "-c", "set -eu; pid=$(cat /run/stack-vault.pid); if [ -e /proc/$pid/exe ]; then test \"$(readlink /proc/$pid/exe)\" = /vaultwarden; kill -TERM $pid; fi; n=0; while test -e /proc/$pid/exe; do n=$((n+1)); test $n -lt 25; sleep 1; done; sync"], 30);
  }
  async release(requestId: string, expectedRevision: string) {
    return this.serial(async () => {
      const status = await this.status(), receipt = this.journal.receipt(requestId), native = await this.inspect();
      if (!native.record || native.record.fence !== requestId || status.revision !== expectedRevision || !receipt || receipt.status === "running") throw new Error("Exact vault fence/receipt/revision required");
      // Recover only resources admitted under this recorded lease, never similarly named foreign objects.
      native.record.instanceId = native.instance?.id ?? null; native.record.volumeId = native.volume?.id ?? null;
      native.record.fence = null; await this.save(native.record); return this.status();
    });
  }
  private async backupSource(id: string) {
    z.uuid().parse(id); const dir = join(this.system.root, "vault-backups");
    const metadata = vaultBackup.parse(JSON.parse(await readFile(join(dir, id + ".json"), "utf8")));
    if (metadata.id !== id || metadata.path !== join(dir, id + ".tar.gz") || metadata.bytes > 256 * 1024 * 1024) throw new Error("Backup identity/path/size changed");
    const bytes = await readFile(metadata.path);
    if (bytes.length !== metadata.bytes || createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) throw new Error("Backup checksum mismatch");
    const record = recordSchema.parse(JSON.parse(await readFile(join(dir, id + ".record.json"), "utf8")));
    if (record.id !== metadata.vaultId || !record.certificate || !record.ingress) throw new Error("Backup service identity unavailable");
    return { bytes, metadata, record };
  }
  async backups() { const { readdir } = await import("node:fs/promises"); const dir = join(this.system.root, "vault-backups"); try { const names = await readdir(dir); return Promise.all(names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(async n => vaultBackup.parse(JSON.parse(await readFile(join(dir, n), "utf8"))))); } catch(e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; } }
  async close() { this.closing = true; await this.queue; await this.closeProxy(); this.journal.close(); }
}
