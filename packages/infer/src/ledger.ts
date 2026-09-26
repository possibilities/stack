import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RequestRecord, RequestState, RequestSummary, StartInput, Usage } from "./schema.js";

type Row = Record<string, unknown>;
const previewChars = 160;
const iso = (ms: unknown) => new Date(ms as number).toISOString();
const digest = ({ requestId: _, ...intent }: StartInput) => createHash("sha256").update(JSON.stringify(intent)).digest("hex");
const preview = (text: string) => text.length > previewChars ? `${text.slice(0, previewChars - 1)}…` : text;

/**
 * Durable record of every admitted inference request under `<state>/infer`. A
 * request is admitted as running and finishes exactly once. Prompts and outputs
 * are kept for the ledger's readers; credentials never enter it.
 */
export class InferLedger {
  private readonly db: DatabaseSync;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "requests.sqlite");
    try { closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    chmodSync(path, 0o600);
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = DELETE;
      CREATE TABLE IF NOT EXISTS requests (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, input_digest TEXT NOT NULL,
        account_id TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL,
        instructions TEXT NOT NULL, input TEXT NOT NULL, max_output_tokens INTEGER NOT NULL,
        state TEXT NOT NULL, error TEXT, text TEXT,
        input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, reasoning_tokens INTEGER,
        created_at INTEGER NOT NULL, finished_at INTEGER
      );
    `);
    // Whatever was in flight when the service stopped may already have been charged.
    this.db.prepare("UPDATE requests SET state = 'unknown', error = 'service_restarted', finished_at = ? WHERE state = 'running'").run(Date.now());
  }

  close(): void { this.db.close(); }

  /** The existing request for this idempotency key, or null; reusing a key for different input is refused. */
  find(input: StartInput): RequestRecord | null {
    const row = this.db.prepare("SELECT * FROM requests WHERE request_id = ?").get(input.requestId) as Row | undefined;
    if (!row) return null;
    if (row.input_digest !== digest(input)) throw new Error("request_id_reused");
    return this.record(row);
  }

  admit(input: StartInput): RequestRecord {
    this.db.prepare(`INSERT INTO requests (request_id, input_digest, account_id, model, effort, instructions, input, max_output_tokens, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`).run(input.requestId, digest(input), input.accountId, input.model, input.effort,
      input.instructions, input.input, input.maxOutputTokens, Date.now());
    return this.get(input.requestId)!;
  }

  /** Records the single terminal outcome; a request that already finished is left untouched. */
  finish(requestId: string, outcome: { state: Exclude<RequestState, "running">; error?: string; text?: string; usage?: Usage }): void {
    const { usage } = outcome;
    this.db.prepare(`UPDATE requests SET state = ?, error = ?, text = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?, reasoning_tokens = ?, finished_at = ?
      WHERE request_id = ? AND state = 'running'`).run(outcome.state, outcome.error ?? null, outcome.text ?? null,
      usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.totalTokens ?? null, usage?.reasoningTokens ?? null, Date.now(), requestId);
  }

  get(requestId: string): RequestRecord | null {
    const row = this.db.prepare("SELECT * FROM requests WHERE request_id = ?").get(requestId) as Row | undefined;
    return row ? this.record(row) : null;
  }

  /** Newest first; `nextBefore` continues the listing. */
  list(limit: number, before?: number): { requests: RequestSummary[]; nextBefore: number | null } {
    const rows = this.db.prepare("SELECT * FROM requests WHERE seq < ? ORDER BY seq DESC LIMIT ?").all(before ?? Number.MAX_SAFE_INTEGER, limit + 1) as Row[];
    const page = rows.slice(0, limit);
    return {
      requests: page.map((row) => {
        const { instructions: _, input, text, ...fields } = this.record(row);
        return { ...fields, inputPreview: preview(input), textPreview: text === null ? null : preview(text), textChars: text?.length ?? null };
      }),
      nextBefore: rows.length > limit ? page.at(-1)!.seq as number : null,
    };
  }

  private record(row: Row): RequestRecord {
    const finished = row.state !== "running";
    return {
      requestId: row.request_id as string, accountId: row.account_id as string, model: row.model as string,
      effort: row.effort as RequestRecord["effort"], maxOutputTokens: row.max_output_tokens as number,
      state: row.state as RequestState, error: row.error as string | null,
      usage: row.state === "completed" ? { inputTokens: row.input_tokens as number | null, outputTokens: row.output_tokens as number | null,
        totalTokens: row.total_tokens as number | null, reasoningTokens: row.reasoning_tokens as number | null } : null,
      createdAt: iso(row.created_at), finishedAt: finished && row.finished_at !== null ? iso(row.finished_at) : null,
      instructions: row.instructions as string, input: row.input as string, text: row.text as string | null,
    };
  }
}
