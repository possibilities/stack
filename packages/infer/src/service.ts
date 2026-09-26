import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { discoverModels } from "./catalog.js";
import { InferLedger } from "./ledger.js";
import type { Model, ModelObservation, RequestRecord, StartInput, Usage } from "./schema.js";

type Credentials = { access: string; nativeId: string; auth: string };
type Discover = (stateDir: string, auth: string, signal?: AbortSignal) => Promise<Model[]>;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Secrets remain in the private auth store; neither metadata nor failure messages include them. */
export async function readCredentials(stateDir: string, accountId: string): Promise<Credentials> {
  const config = join(stateDir, "configuration.sqlite"), secrets = join(stateDir, "secrets.sqlite");
  for (const path of [config, secrets]) {
    let handle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch { throw new Error("credentials_unavailable"); }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > 32 * 1024 * 1024)
        throw new Error("credentials_unavailable");
    } finally { await handle.close(); }
  }
  try {
    const db = new DatabaseSync(config, { readOnly: true });
    try {
      db.prepare("ATTACH DATABASE ? AS secrets").run(secrets);
      const row = db.prepare("SELECT auth_json FROM accounts JOIN secrets.credentials ON accounts.name = secrets.credentials.name WHERE accounts.name = ? AND accounts.enabled = 1 AND accounts.removing = 0").get(accountId) as { auth_json: string } | undefined;
      if (!row) throw new Error("account_unavailable");
      const auth = object(JSON.parse(row.auth_json)), tokens = object(auth?.tokens);
      const access = tokens?.access_token, nativeId = tokens?.account_id;
      if (auth?.auth_mode !== "chatgpt" || typeof access !== "string" || !access || typeof nativeId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(nativeId))
        throw new Error("credentials_unavailable");
      return { access, nativeId, auth: row.auth_json };
    } finally { db.close(); }
  } catch (error) {
    if (error instanceof Error && ["account_unavailable", "credentials_unavailable"].includes(error.message)) throw error;
    throw new Error("credentials_unavailable");
  }
}

/** Parse only successful terminal SSE; partial deltas never constitute a completed answer. */
export async function readCompletion(response: Response): Promise<{ text: string; usage: Usage }> {
  if (!response.body) throw new Error("response_incomplete");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", text = "", bytes = 0, completed: Record<string, unknown> | null = null, failed = false;
  const consume = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const raw = line.slice(6);
    if (raw === "[DONE]") return;
    const event = object(JSON.parse(raw));
    if (!event) throw new Error("invalid");
    if (event.type === "response.output_text.delta") {
      if (typeof event.delta !== "string") throw new Error("invalid");
      text += event.delta;
      if (text.length > 16_000) throw new Error("invalid");
    } else if (event.type === "response.completed") {
      completed = object(event.response);
      if (!completed || completed.status !== "completed") throw new Error("invalid");
    } else if (event.type === "response.failed" || event.type === "error" || event.type === "response.incomplete") failed = true;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512_000) throw new Error("invalid");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 64_000) throw new Error("invalid");
      let at = buffer.indexOf("\n");
      while (at !== -1) {
        consume(buffer.slice(0, at).replace(/\r$/, ""));
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer) consume(buffer.replace(/\r$/, ""));
    if (failed || !completed) throw new Error("incomplete");
    const usage = object((completed as Record<string, unknown>).usage), details = object(usage?.output_tokens_details);
    return { text, usage: {
      inputTokens: count(usage?.input_tokens), outputTokens: count(usage?.output_tokens),
      totalTokens: count(usage?.total_tokens), reasoningTokens: count(details?.reasoning_tokens),
    } };
  } catch { await reader.cancel().catch(() => {}); throw new Error("response_incomplete"); }
  finally { reader.releaseLock(); }
}

const httpErrors: Record<number, string> = { 401: "codex_sign_in_required", 403: "codex_access_denied", 429: "codex_rate_limited" };

/**
 * Admits inference requests into the durable ledger and runs each one in the
 * background: fresh discovery, then exactly one backend request. Model
 * discovery is cached per account in memory and refreshed only on demand or by a
 * request's own discovery. `onChange` fires for every request or observation change.
 */
export class InferService {
  onChange?: () => void;
  private readonly ledger: InferLedger;
  private readonly running = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private readonly observations = new Map<string, ModelObservation>();
  private readonly discoveries = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private closing = false;

  constructor(readonly stateDir: string, private readonly discover: Discover = (dir, auth, signal) => discoverModels(dir, auth, undefined, signal),
    private readonly fetcher: typeof fetch = fetch, private readonly credentials: typeof readCredentials = readCredentials) {
    this.ledger = new InferLedger(join(stateDir, "infer"));
  }

  models(accountId?: string): ModelObservation[] {
    return [...this.observations.values()].filter((row) => !accountId || row.accountId === accountId);
  }

  /** Starts a background discovery, coalescing with one already running. An unusable account is refused and forgotten. */
  async refreshModels(accountId: string): Promise<ModelObservation> {
    if (this.closing) throw new Error("infer_closing");
    let credentials: Credentials;
    try { credentials = await this.credentials(this.stateDir, accountId); }
    catch (error) {
      if (this.observations.delete(accountId)) this.changed();
      throw error;
    }
    if (this.closing) throw new Error("infer_closing");
    if (!this.discoveries.has(accountId)) {
      const controller = new AbortController();
      this.observe(accountId, { discovering: true });
      const task = this.discover(this.stateDir, credentials.auth, controller.signal)
        .then((models) => this.observe(accountId, { models, observedAt: new Date().toISOString(), discovering: false, error: null }),
          () => this.observe(accountId, { discovering: false, error: "catalog_unavailable" }))
        .finally(() => this.discoveries.delete(accountId));
      this.discoveries.set(accountId, { controller, task });
    }
    return this.observations.get(accountId)!;
  }

  /**
   * Admits one request and returns its running record before any backend work.
   * An identical resend returns the existing record; it never starts a second request.
   */
  async start(input: StartInput): Promise<RequestRecord> {
    const existing = this.ledger.find(input);
    if (existing) return existing;
    if (this.closing) throw new Error("infer_closing");
    // One request per account at a time; callers must not flood shared Codex allowance.
    if (this.running.has(input.accountId) || this.running.size >= 2) throw new Error("infer_busy");
    const controller = new AbortController();
    const slot = { controller, task: Promise.resolve() };
    this.running.set(input.accountId, slot);
    let credentials: Credentials;
    try {
      credentials = await this.credentials(this.stateDir, input.accountId);
      if (this.closing) throw new Error("infer_closing");
    } catch (error) {
      this.running.delete(input.accountId);
      throw error;
    }
    const record = this.ledger.admit(input);
    slot.task = this.execute(input, credentials, controller.signal).catch((error: unknown) => {
      console.error(`infer request ${input.requestId} bookkeeping failed: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      this.running.delete(input.accountId);
      this.changed();
    });
    this.changed();
    return record;
  }

  list(limit: number, before?: number) { return this.ledger.list(limit, before); }

  get(requestId: string): RequestRecord {
    const record = this.ledger.get(requestId);
    if (!record) throw new Error("unknown_request");
    return record;
  }

  /** Refuses new work and cancels in-flight discovery and requests; a cancelled request that may have been sent is unknown. */
  prepareClose(): void {
    this.closing = true;
    for (const { controller } of [...this.running.values(), ...this.discoveries.values()]) controller.abort();
  }

  async close(): Promise<void> {
    this.prepareClose();
    await Promise.allSettled([...this.running.values(), ...this.discoveries.values()].map(({ task }) => task));
    this.ledger.close();
  }

  private async execute(input: StartInput, credentials: Credentials, signal: AbortSignal): Promise<void> {
    const finish = (outcome: Parameters<InferLedger["finish"]>[1]) => this.ledger.finish(input.requestId, outcome);
    let models: Model[];
    try { models = await this.discover(this.stateDir, credentials.auth, signal); }
    catch { return finish({ state: "failed", error: signal.aborted ? "cancelled" : "catalog_unavailable" }); }
    this.observe(input.accountId, { models, observedAt: new Date().toISOString(), error: null });
    if (!models.some((row) => row.id === input.model && row.supportedEfforts.includes(input.effort))) return finish({ state: "failed", error: "model_unavailable" });
    if (signal.aborted) return finish({ state: "failed", error: "cancelled" });
    let response: Response;
    try {
      response = await this.fetcher("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST", redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        headers: { Authorization: `Bearer ${credentials.access}`, "chatgpt-account-id": credentials.nativeId,
          "Content-Type": "application/json", Accept: "text/event-stream", originator: "codex_cli_rs", session_id: input.requestId },
        body: JSON.stringify({ model: input.model, instructions: input.instructions,
          input: [{ role: "user", content: [{ type: "input_text", text: input.input }] }],
          reasoning: { effort: input.effort }, max_output_tokens: input.maxOutputTokens, stream: true, store: false }),
      });
    } catch { return finish({ state: "unknown", error: "request_interrupted" }); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return finish({ state: "failed", error: httpErrors[response.status] ?? `http_${response.status}` });
    }
    try { finish({ state: "completed", ...await readCompletion(response) }); }
    catch { finish({ state: "unknown", error: "response_incomplete" }); }
  }

  private observe(accountId: string, patch: Partial<Omit<ModelObservation, "accountId">>): void {
    const current = this.observations.get(accountId) ?? { accountId, models: null, observedAt: null, discovering: false, error: null };
    this.observations.set(accountId, { ...current, ...patch });
    this.changed();
  }

  private changed(): void { this.onChange?.(); }
}
