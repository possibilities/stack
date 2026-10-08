import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

export const PRESET = "boundary-fixture";
export const HTML = "<main><h1>Boundary</h1><p>Sensitive café</p></main>";
export const MARKDOWN = "# Boundary\n\nSensitive café";
export const SOURCE = "<h1>Original</h1>";

export interface Trigger {
  method: string;
  when?: "before" | "after";
  path: string;
  argument?: number;
  whileOpen?: string;
}
interface Request {
  owner: "convert" | "artifacts" | "capture" | "replay" | "retire";
  path?: string;
  content?: string;
  url?: string;
  expectFailure?: string;
  presetName?: string;
  captureBytes?: { fullHtml?: number; selectedHtml?: number; markdown?: number };
  handlerMarker?: string;
  ids?: string[];
  triggers?: Trigger[];
}
interface Hit { kind: "boundary"; method: string; paths: string[] }
interface Ready { kind: "ready"; port: number }
export type Outcome =
  | { kind: "result"; ok: true; value: any }
  | { kind: "result"; ok: false; error: { name: string; message: string; code?: string } };

const DEADLINE = 20_000;

/** The owner stays on its main thread (it uses umask); a worker wakes its Atomics gate. */
class BoundaryProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private outcome?: Outcome;
  private hits: Hit[] = [];
  private waiting?: { resolve: (hit: Hit) => void; reject: (error: Error) => void };
  private stderr = "";
  private port?: number;

  constructor(request: Request, state: string) {
    this.child = fork(fileURLToPath(import.meta.url), ["--fs-boundary-child", JSON.stringify(request)], {
      execArgv: [],
      env: { ...process.env, STACK_STATE_DIR: state, AGENTSCRAPE_AGENT_BROWSER_BIN: join(state, "no-browser") },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    this.child.stderr!.on("data", (chunk) => { this.stderr += chunk; });
    this.child.on("message", (message: Hit | Ready | Outcome) => {
      if (message.kind === "ready") this.port = message.port;
      else if (message.kind === "result") this.outcome = message;
      else if (this.waiting) {
        const waiting = this.waiting;
        this.waiting = undefined;
        waiting.resolve(message);
      } else this.hits.push(message);
    });
    this.exited = new Promise((resolve, reject) => {
      this.child.once("error", reject);
      this.child.once("exit", (code, signal) => {
        this.waiting?.reject(new Error(`Child exited before boundary: ${JSON.stringify(this.outcome)} ${this.stderr}`));
        this.waiting = undefined;
        resolve({ code, signal });
      });
    });
  }

  async boundary(): Promise<Hit> {
    const queued = this.hits.shift();
    if (queued) return queued;
    assert.equal(this.waiting, undefined, "only one boundary waiter per child");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = undefined;
        reject(new Error(`Filesystem boundary not reached: ${this.stderr}`));
      }, DEADLINE);
      this.waiting = {
        resolve: (hit) => { clearTimeout(timer); resolve(hit); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        const waiting = this.waiting;
        this.waiting = undefined;
        waiting.reject(new Error(`Child already exited: ${JSON.stringify(this.outcome)} ${this.stderr}`));
      }
    });
  }

  async resume(fail = false): Promise<void> {
    assert.ok(this.port, "child control worker must be ready before a boundary");
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: this.port! });
      socket.once("error", reject);
      socket.once("connect", () => socket.end(fail ? "1" : "0"));
      socket.once("close", () => resolve());
    });
  }

  async kill(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
    await this.exited;
  }

  async result(): Promise<Outcome> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const exit = await Promise.race([
        this.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Child did not finish: ${this.stderr}`)), DEADLINE);
        }),
      ]);
      assert.equal(exit.code, 0, this.stderr);
      assert.ok(this.outcome, "child must return an owner result");
      return this.outcome;
    } finally { clearTimeout(timer); }
  }
}

export function fixture(t: TestContext) {
  // Canonicalize macOS's /var -> /private/var alias; corpus ancestry deliberately rejects symlinks.
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "scrape-boundary-"));
  const state = join(root, "state"), input = join(root, "input");
  for (const path of [state, input, join(state, "scrape"), join(state, "scrape", "presets")])
    fs.mkdirSync(path, { mode: 0o700 });
  const declarePreset = (name: string) => fs.writeFileSync(join(state, "scrape", "presets", "boundary.json"), JSON.stringify({
    name, summary: "Offline boundary fixture", domain: "capture.example.test", mode: "content",
    url_patterns: ["^https://capture\\.example\\.test/.*$"], handler: "boundary.capture", schema: "BoundaryPage",
  }), { mode: 0o600 });
  declarePreset(PRESET);
  const children: BoundaryProcess[] = [];
  const start = (request: Request) => {
    const child = new BoundaryProcess(request, state);
    children.push(child);
    return child;
  };
  t.after(async () => {
    await Promise.all(children.map((child) => child.kill()));
    const makeEnumerable = (path: string) => {
      if (!fs.lstatSync(path).isDirectory()) return;
      fs.chmodSync(path, 0o700);
      for (const name of fs.readdirSync(path)) makeEnumerable(join(path, name));
    };
    // A failed crash assertion can leave an authentic mode-0300 preparation behind.
    makeEnumerable(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, state, input, preset: join(state, "scrape", "corpus", PRESET), declarePreset, start };
}

export function success(outcome: Outcome): any {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (outcome.ok) return outcome.value;
}
export function refusal(outcome: Outcome, pattern: RegExp, name?: string): void {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) {
    assert.match(outcome.error.message, pattern);
    if (name) assert.equal(outcome.error.name, name);
  }
}
export function inode(path: string): string {
  const stat = fs.lstatSync(path, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
}
export function snapshot(root: string): unknown {
  const walk = (path: string): unknown => {
    const stat = fs.lstatSync(path);
    return { inode: inode(path), mode: stat.mode & 0o777,
      value: stat.isSymbolicLink() ? fs.readlinkSync(path) : stat.isDirectory()
        ? Object.fromEntries(fs.readdirSync(path).sort().map((name) => [name, walk(join(path, name))]))
        : fs.readFileSync(path).toString("base64") };
  };
  return walk(root);
}

function installBoundaries(triggers: Trigger[], gate: Int32Array): void {
  const descriptors = new Map<number, string>();
  const methods = new Set(["openSync", "closeSync", ...triggers.map((trigger) => trigger.method)]);
  const original = fs as unknown as Record<string, (...args: any[]) => any>;
  let index = 0;
  const check = (method: string, when: string, args: any[]) => {
    const trigger = triggers[index];
    if (!trigger || trigger.method !== method || (trigger.when ?? "before") !== when) return;
    if (trigger.whileOpen && ![...descriptors.values()].some((path) => new RegExp(trigger.whileOpen!).test(path))) return;
    const paths = args.map((arg) => typeof arg === "number" ? descriptors.get(arg) ?? "" : typeof arg === "string" ? arg : "");
    if (!new RegExp(trigger.path).test(paths[trigger.argument ?? 0] ?? "")) return;
    index += 1;
    Atomics.store(gate, 0, 0);
    process.send!({ kind: "boundary", method, paths });
    if (Atomics.wait(gate, 0, 0, DEADLINE) === "timed-out") throw new Error("test filesystem boundary timed out");
    if (Atomics.load(gate, 1)) throw Object.assign(new Error("injected filesystem EIO"), { code: "EIO" });
  };
  for (const method of methods) {
    const forward = original[method]!;
    original[method] = (...args: any[]) => {
      check(method, "before", args);
      const value = forward(...args);
      if (method === "openSync") descriptors.set(value, String(args[0]));
      check(method, "after", args);
      if (method === "closeSync") descriptors.delete(args[0]);
      return value;
    };
  }
  syncBuiltinESMExports();
}

async function runOwner(request: Request): Promise<unknown> {
  if (request.owner === "convert") {
    const { convertHtmlDirectory } = await import("../../src/html-files.js");
    return convertHtmlDirectory(request.path!);
  }
  if (request.owner === "artifacts") {
    const { preflightTextArtifacts, writePreparedTextArtifacts } = await import("../../src/artifacts.js");
    writePreparedTextArtifacts(preflightTextArtifacts([{ path: request.path!, content: request.content! }]));
    return null;
  }
  if (request.owner === "retire") {
    const { api } = await import("../../api.js");
    const ctx = await api.createContext!({} as never);
    const call = async (name: string, input: unknown) => {
      const op = api.operations.find((op) => op.name === name)!;
      return op.output.parse(await op.call(ctx, op.input.parse(input))) as any;
    };
    try {
      const plan = await call("scrape_corpus_plan", { captures: request.ids!.map((id) => ({ preset: PRESET, id })) });
      return await call("scrape_corpus_clear", { planId: plan.id, expectedRevision: plan.revision, requestId: randomUUID() });
    } finally { await api.prepareCloseContext?.(ctx); await api.closeContext?.(ctx); }
  }
  const { registerContentHandler } = await import("../../src/presets.js");
  const { ScrapeSchema } = await import("../../src/schemas.js");
  const { convertHtml } = await import("../../src/html.js");
  class BoundaryPage extends ScrapeSchema {
    constructor(readonly content: string) { super(); }
    toMarkdown() { return this.content; }
  }
  const unregister = registerContentHandler({
    handlerName: "boundary.capture", schemaName: "BoundaryPage", schema: BoundaryPage,
    handler: async (url, options) => {
      if (request.handlerMarker) fs.writeFileSync(request.handlerMarker, "boundary.capture", { mode: 0o600 });
      if (url.includes("/failure")) throw new TypeError(`Capture failed at ${url}; token=private-secret`);
      const html = options?.html ?? HTML;
      // Sized UTF-8 handler output exercises live publication without parsing multi-megabyte HTML.
      const sized = (bytes: number) => "é".repeat(Math.floor(bytes / 2)) + (bytes % 2 ? "x" : "");
      const structured = new BoundaryPage(request.captureBytes?.markdown === undefined
        ? convertHtml(html) : sized(request.captureBytes.markdown));
      return {
        full_html: request.captureBytes?.fullHtml === undefined ? html : sized(request.captureBytes.fullHtml),
        selected_html: request.captureBytes?.selectedHtml === undefined ? html : sized(request.captureBytes.selectedHtml),
        markdown: structured.toMarkdown(), structured,
      };
    },
  });
  try {
    const { captureCorpus, testCorpus } = await import("../../src/corpus.js");
    return request.owner === "replay" ? await testCorpus(PRESET)
      : await captureCorpus(request.url ?? "https://capture.example.test/success#private-fragment", { preset: request.presetName ?? PRESET, expectFailure: request.expectFailure });
  } finally { unregister(); }
}

function diagnostic(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return [error.message, ...(error instanceof AggregateError ? error.errors.map(diagnostic) : []),
    ...(error.cause ? [diagnostic(error.cause)] : [])].join("; ");
}

if (!isMainThread && workerData?.scrapeBoundary) {
  const gate = new Int32Array(workerData.gate);
  const server = createServer((socket) => {
    socket.once("data", (data) => {
      Atomics.store(gate, 1, Number(data.toString()));
      Atomics.store(gate, 0, 1); Atomics.notify(gate, 0);
      socket.end();
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no control port");
    parentPort!.postMessage({ kind: "ready", port: address.port });
  });
} else if (process.argv[2] === "--fs-boundary-child") {
  const request: Request = JSON.parse(process.argv[3]!);
  let worker: Worker | undefined;
  const finish = (outcome: Outcome) => process.send!(outcome, async () => {
    await worker?.terminate(); process.disconnect!();
  });
  const run = () => {
    void runOwner(request).then(
      (value) => finish({ kind: "result", ok: true, value }),
      (error) => finish({ kind: "result", ok: false,
        error: { name: error?.constructor?.name ?? "Error", message: diagnostic(error), code: error?.code } }),
    );
  };
  if (request.triggers?.length) {
    const gate = new Int32Array(new SharedArrayBuffer(8));
    worker = new Worker(new URL(import.meta.url), { workerData: { scrapeBoundary: true, gate: gate.buffer } });
    worker.once("message", (ready: Ready) => {
      process.send!(ready);
      installBoundaries(request.triggers!, gate);
      run();
    });
    worker.on("error", (error) => {
      finish({ kind: "result", ok: false, error: { name: "Error", message: diagnostic(error) } });
    });
  } else run();
}
