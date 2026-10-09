import { notRecorded, waitingForIdentity, type ScopedStorage } from "./destination";
import { applyInput, planReadiness } from "./state";
import type { StateApplyInput, StatePlan, StateReceipt } from "./types";

type Identity = Record<string, string>;
export type RecoveryStore = Pick<ScopedStorage, "getItem" | "setItem" | "removeItem" | "keys">;
export type StateRecovery = { input: StateApplyInput & Identity; at: number };
const prefix = "state-flow.";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const sameInput = (a: StateApplyInput & Identity, b: StateApplyInput): boolean => {
  const other = b as StateApplyInput & Identity;
  return Object.keys(a).length === Object.keys(other).length && Object.entries(a).every(([key, value]) => other[key] === value);
};
const fingerprint = (value: unknown): string => JSON.stringify(value, (_key, part) => part && typeof part === "object" && !Array.isArray(part)
  ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
function immutable<T>(value: T): T {
  if (value && typeof value === "object") { for (const part of Object.values(value)) immutable(part); Object.freeze(value); }
  return value;
}

export function readRecovery(storage: RecoveryStore | null, key: string): StateRecovery | null {
  try {
    const value = JSON.parse(storage?.getItem(prefix + key) ?? "null") as StateRecovery | null;
    if (!value?.input || [value.input.planId, value.input.expectedRevision, value.input.requestId].some(part => typeof part !== "string" || !part)) return null;
    if (Object.values(value.input).some(part => typeof part !== "string")) return null;
    return value;
  } catch { return null; }
}

export function saveRecovery(storage: RecoveryStore | null, key: string, input: StateApplyInput & Identity): boolean {
  if (!storage) return false;
  try {
    const raw = JSON.stringify({ input, at: Date.now() } satisfies StateRecovery);
    storage.setItem(prefix + key, raw);
    return storage.getItem(prefix + key) === raw;
  } catch { return false; }
}

export function clearRecovery(storage: RecoveryStore | null, key: string): boolean {
  if (!storage) return false;
  try { storage.removeItem(prefix + key); return storage.getItem(prefix + key) === null; } catch { return false; }
}

export function listRecoveries(storage: RecoveryStore | null, start: string): { key: string; at: number }[] {
  try {
    return (storage?.keys(prefix + start) ?? []).flatMap(stored => {
      const key = stored.slice(prefix.length), saved = readRecovery(storage, key);
      return saved ? [{ key, at: saved.at }] : [];
    }).sort((a, b) => a.at - b.at);
  } catch { return []; }
}

/** Operation names and selection travel with the adapter: exposure cannot drift from the calls it makes. */
export type StateOperations<Extra extends Identity = Record<string, never>> = {
  readonly owner: string;
  readonly names: Readonly<{ plan: string; apply: string; receipt: string }>;
  readonly selection: Readonly<Record<string, unknown>>;
  prepare(): Promise<StatePlan>;
  apply(input: StateApplyInput & Extra): Promise<StateReceipt>;
  readReceipt(requestId: string): Promise<StateReceipt | null>;
};

export function stateOperations<Extra extends Identity = Record<string, never>>(
  call: <T>(pkg: string, name: string, args?: Record<string, unknown>) => Promise<T>,
  owner: string, names: { plan: string; apply: string; receipt: string }, selection: Record<string, unknown>,
): StateOperations<Extra> {
  const captured = immutable(structuredClone(selection)), operations = { ...names };
  return Object.freeze({ owner, names: Object.freeze(operations), selection: captured,
    prepare: () => call<StatePlan>(owner, operations.plan, structuredClone(captured)),
    apply: (input: StateApplyInput & Extra) => call<StateReceipt>(owner, operations.apply, input),
    readReceipt: async (requestId: string) => (await call<{ receipt: StateReceipt | null }>(owner, operations.receipt, { requestId })).receipt,
  });
}

export type MaintenancePolicy = "identical-retry" | "receipt-only" | "saved-only";
export type StateFlow =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "prepare-failed"; error: string }
  | { phase: "preview"; plan: StatePlan; refused?: string }
  | { phase: "applying"; plan: StatePlan | null; input: StateApplyInput }
  | { phase: "checking"; plan: StatePlan | null; input: StateApplyInput; error: string | null }
  | { phase: "uncertain"; plan: StatePlan | null; input: StateApplyInput; error: string }
  | { phase: "receipt"; plan: StatePlan | null; input: StateApplyInput; receipt: StateReceipt };

export type MaintenanceEnvironment = {
  local: boolean;
  connected: boolean;
  /** Null until live discovery answers. */
  exposed: readonly string[] | null;
  /** Domain prerequisites only; exposure, connection and storage belong to the module. */
  prerequisite?: string | null;
};
export type MaintenanceOptions<Extra extends Identity = Record<string, never>> = {
  operations: StateOperations<Extra>;
  extra?: Extra;
  recoveryKey: string;
  policy: MaintenancePolicy;
  recovery: RecoveryStore | null;
  environment: MaintenanceEnvironment;
  guard?(): string | null;
  onReceipt?(receipt: StateReceipt, selection: Readonly<Record<string, unknown>> | null): void;
};
export type MaintenanceAction = "prepare" | "apply" | "retry" | "readReceipt" | "discardPlan" | "closeReceipt" | "forget";
export type ActionAvailability = { visible: boolean; enabled: boolean; reason: string | null };
export type MaintenanceSnapshot = {
  flow: StateFlow;
  /** The exact prepared selection, or null for identity-only reload recovery. */
  selection: Readonly<Record<string, unknown>> | null;
  policy: MaintenancePolicy;
  actions: Record<MaintenanceAction, ActionAvailability>;
  reading: boolean;
  readError: string | null;
  error: string | null;
};

/** One destination/subject/action's maintenance. Views subscribe to policy; they never supply it at render time. */
export class MaintenanceController<Extra extends Identity = Record<string, never>> {
  private options: MaintenanceOptions<Extra>;
  private readonly binding: string;
  private readonly extra: Extra;
  private flow: StateFlow = { phase: "idle" };
  private snapshot!: MaintenanceSnapshot;
  private listeners = new Set<() => void>();
  private demand = 0;
  private epoch = 0;
  private read: Promise<void> | null = null;
  private sending = false;
  private dirty = false;
  private reading = false;
  private readError: string | null = null;
  private error: string | null = null;
  private callbackError: string | null = null;
  private captured: StateOperations<Extra> | null = null;
  private recovered = false;
  private receiptFingerprint: string | null = null;
  private readonly clock: { now(): number; uuid(): string };

  constructor(options: MaintenanceOptions<Extra>, clock = { now: () => Date.now(), uuid: () => crypto.randomUUID() }) {
    this.clock = clock;
    this.options = options;
    this.extra = immutable(structuredClone(options.extra ?? {})) as Extra;
    this.binding = this.identity(options);
    this.publish();
  }

  private identity(options: MaintenanceOptions<Extra>): string {
    return fingerprint([options.operations.owner, options.operations.names, options.recoveryKey, options.policy, options.extra ?? {}]);
  }
  getState = (): StateFlow => this.flow;
  getSnapshot = (): MaintenanceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  /** Called by the shared adapter after commit, never during React rendering. Binding identity is immutable. */
  update(options: MaintenanceOptions<Extra>): void {
    if (this.identity(options) !== this.binding) throw new Error("A maintenance binding cannot change its owner, routing, policy or recovery slot.");
    const before = this.receiptBlock();
    const changed = JSON.stringify(this.options.environment) !== JSON.stringify(options.environment) || this.options.recovery !== options.recovery;
    this.options = options;
    // Expiry is clock-dependent even when no other input changed.
    if (changed || this.flow.phase === "preview") this.publish();
    if (this.demand && before && !this.receiptBlock()) void this.recoverAndObserve();
  }

  activate = (): (() => void) => {
    if (++this.demand === 1) { this.publish(); void this.recoverAndObserve(); }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.demand !== 0) return;
      this.epoch++;
      this.dirty = false;
      this.read = null;
      this.reading = false;
      if (this.flow.phase === "preparing") this.flow = { phase: "idle" };
      if (this.flow.phase === "checking") this.flow = { ...this.flow, phase: "uncertain", error: "Receipt observation was paused. Read this request again when ready." };
      this.publish();
    };
  };

  /** Actual owner notices only. Successful inventory reads are not invalidations. */
  invalidate = (): void => { if (this.demand && this.unresolved()) void this.readReceipt(); };

  private receiptBlock(): string | null {
    const { environment: env, recovery, operations } = this.options;
    if (!env.local) return "State inspection and maintenance are available only on the local UI.";
    if (!recovery) return waitingForIdentity;
    if (!env.exposed) return "Reading API discovery…";
    if (!env.exposed.includes(operations.names.receipt)) return `${operations.owner} does not expose ${operations.names.receipt} on its WebSocket.`;
    if (!env.connected) return `The ${operations.owner} connection is not open.`;
    if (!this.demand) return "Maintenance observation is inactive.";
    return null;
  }
  private decisionBlock(): string | null {
    const blocked = this.receiptBlock();
    if (blocked) return blocked;
    for (const name of [this.options.operations.names.plan, this.options.operations.names.apply]) {
      if (!this.options.environment.exposed!.includes(name)) return `${this.options.operations.owner} does not expose ${name} on its WebSocket.`;
    }
    return this.error ?? this.options.environment.prerequisite ?? null;
  }
  private unresolved(): boolean {
    return "input" in this.flow && !(this.flow.phase === "receipt" && ["completed", "blocked"].includes(this.flow.receipt.status));
  }

  private availability(): Record<MaintenanceAction, ActionAvailability> {
    const { phase } = this.flow, policy = this.options.policy;
    const busy = this.sending || this.reading || phase === "preparing";
    const standard = policy === "identical-retry", saved = policy === "saved-only";
    const settled = phase === "receipt" && ["completed", "blocked"].includes(this.flow.receipt.status);
    const readiness = phase === "preview" ? planReadiness(this.flow.plan, this.clock.now()) : null;
    const prepare = !saved && (phase === "idle" || phase === "prepare-failed" || phase === "preview" && !!readiness && !readiness.canApply
      || phase === "uncertain" && standard || phase === "receipt" && (this.flow.receipt.status === "blocked" || standard && ["partial", "unknown"].includes(this.flow.receipt.status)));
    const choice = (visible: boolean, reason: string | null = null): ActionAvailability => ({ visible, enabled: visible && !!this.demand && !busy && !reason, reason: reason ?? (!this.demand ? "Maintenance observation is inactive." : busy ? "Wait for the current request." : null) });
    return {
      prepare: choice(prepare, this.decisionBlock()),
      apply: choice(phase === "preview", this.decisionBlock() ?? readiness?.reason ?? null),
      retry: choice(phase === "uncertain" && standard, this.decisionBlock()),
      readReceipt: choice("input" in this.flow && (!settled || saved), this.receiptBlock()),
      discardPlan: choice(phase === "preview" || phase === "prepare-failed"),
      closeReceipt: choice(phase === "receipt" && (standard || settled)),
      // Source's explicit local Forget may detach a pending read. It never cancels an effect.
      forget: { visible: saved && "input" in this.flow, enabled: saved && "input" in this.flow && !!this.demand && !!this.options.recovery && !this.sending,
        reason: !this.options.recovery ? waitingForIdentity : null },
    };
  }
  private publish(): void {
    const next: MaintenanceSnapshot = { flow: this.flow, selection: this.recovered ? null : this.captured?.selection ?? null,
      policy: this.options.policy, actions: this.availability(), reading: this.reading, readError: this.readError, error: this.error ?? this.callbackError };
    if (this.snapshot && this.snapshot.flow === next.flow && this.snapshot.reading === next.reading && this.snapshot.readError === next.readError && this.snapshot.error === next.error && JSON.stringify(this.snapshot.actions) === JSON.stringify(next.actions)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  private allowed(action: MaintenanceAction): boolean { return this.availability()[action].enabled; }

  private async recoverAndObserve(): Promise<void> {
    if (this.receiptBlock()) return;
    if (this.flow.phase === "idle") {
      let raw: string | null;
      try { raw = this.options.recovery!.getItem(prefix + this.options.recoveryKey); }
      catch { this.error = "Recovery storage is unavailable. Preserve the saved request before making another decision."; this.publish(); return; }
      if (raw !== null) {
        const saved = readRecovery(this.options.recovery, this.options.recoveryKey);
        if (!saved) { this.error = "The saved maintenance request is invalid. Preserve it for inspection; nothing was sent."; this.publish(); return; }
        for (const [name, value] of Object.entries(this.extra)) if (saved.input[name] !== value) {
          this.error = "The saved maintenance request belongs to a different subject. Nothing was sent."; this.publish(); return;
        }
        this.recovered = true;
        this.captured = this.options.operations;
        this.flow = { phase: "uncertain", plan: null, input: saved.input, error: "Reading the saved request’s receipt." };
        this.publish();
      }
    }
    if (this.unresolved() && !this.sending) await this.readReceipt();
  }

  prepare = async (): Promise<void> => {
    if (!this.allowed("prepare")) return;
    // A request in the slot must be recovered, never overwritten by an idle view.
    if (this.flow.phase === "idle") {
      void this.recoverAndObserve();
      if (this.flow.phase !== "idle" || !this.allowed("prepare")) return;
    }
    if (!this.removeRecovery("input" in this.flow ? this.flow.input : undefined)) return;
    const epoch = ++this.epoch;
    this.captured = Object.freeze({ ...this.options.operations, selection: immutable(structuredClone(this.options.operations.selection)) });
    this.recovered = false;
    this.receiptFingerprint = null;
    this.readError = null;
    this.callbackError = null;
    this.flow = { phase: "preparing" };
    this.publish();
    try {
      const plan = await this.captured.prepare();
      if (epoch !== this.epoch) return;
      if (plan.ownerPackage !== this.captured.owner) throw new Error("The plan names a different maintenance owner.");
      this.flow = { phase: "preview", plan: immutable(structuredClone(plan)) };
    } catch (error) { if (epoch === this.epoch) this.flow = { phase: "prepare-failed", error: message(error) }; }
    if (epoch === this.epoch) this.publish();
  };

  apply = async (): Promise<void> => {
    if (!this.allowed("apply") || this.flow.phase !== "preview") return;
    let refusal: string | null | undefined;
    try { refusal = this.options.guard?.(); } catch (error) { refusal = message(error); }
    if (refusal) { this.flow = { ...this.flow, refused: refusal }; this.publish(); return; }
    const input = immutable(applyInput(this.flow.plan, this.clock.uuid(), this.extra));
    let existing: string | null;
    try { existing = this.options.recovery!.getItem(prefix + this.options.recoveryKey); } catch { existing = "unavailable"; }
    if (existing !== null || !saveRecovery(this.options.recovery, this.options.recoveryKey, input)) {
      this.flow = { ...this.flow, refused: existing !== null ? "Recovery storage already holds a request or is unavailable. Nothing was sent." : notRecorded };
      this.publish(); return;
    }
    await this.send(this.flow.plan, input);
  };

  retryIdentical = async (): Promise<void> => {
    if (!this.allowed("retry") || this.flow.phase !== "uncertain") return;
    const saved = readRecovery(this.options.recovery, this.options.recoveryKey);
    if (!saved || !sameInput(saved.input, this.flow.input)) {
      this.error = "The saved request changed or is unavailable. Nothing was resent."; this.publish(); return;
    }
    await this.send(this.flow.plan, this.flow.input as StateApplyInput & Extra);
  };

  private async send(plan: StatePlan | null, input: StateApplyInput & Extra): Promise<void> {
    const epoch = ++this.epoch, operations = this.captured!;
    this.sending = true;
    this.flow = { phase: "applying", plan, input };
    this.publish();
    let answer: StateReceipt | null = null, failure: string | null = null;
    try { answer = await operations.apply({ ...input }); } catch (error) { failure = message(error); }
    this.sending = false;
    // An effect is not cancelled by Activity cleanup. Keep its identity recoverable;
    // only a still-current activation can accept this presentation result.
    if (epoch !== this.epoch) {
      this.flow = { phase: "uncertain", plan, input, error: "The view paused while applying. Read the exact request’s receipt." };
      this.publish();
      if (this.demand) await this.readReceipt();
      return;
    }
    if (answer && this.accept(answer, plan, input)) return;
    this.flow = { phase: "uncertain", plan, input, error: failure ?? this.readError ?? "The owner returned no valid receipt." };
    this.publish();
    if (!this.receiptBlock()) await this.readReceipt();
  }

  private accept(receipt: StateReceipt, plan: StatePlan | null, input: StateApplyInput): boolean {
    if (receipt.requestId !== input.requestId || receipt.planId !== input.planId || receipt.ownerPackage !== this.options.operations.owner
      || plan && (receipt.action !== plan.action || fingerprint(receipt.subject) !== fingerprint(plan.subject))) {
      this.readError = "The receipt does not match this exact maintenance request."; return false;
    }
    this.flow = { phase: "receipt", plan, input, receipt: immutable(structuredClone(receipt)) };
    this.readError = null;
    if (["completed", "blocked"].includes(receipt.status)) this.removeRecovery(input);
    const acceptedFingerprint = fingerprint(receipt);
    this.publish();
    if (acceptedFingerprint !== this.receiptFingerprint) {
      this.receiptFingerprint = acceptedFingerprint;
      try { this.options.onReceipt?.(receipt, this.recovered ? null : this.captured?.selection ?? null); }
      catch (error) { this.callbackError = `Receipt observed; refreshing its view failed: ${message(error)}`; this.publish(); }
    }
    return true;
  }

  readReceipt = (): Promise<void> => {
    if (!this.demand || this.receiptBlock() || this.sending || !("input" in this.flow)) return Promise.resolve();
    if (this.reading) { this.dirty = true; return this.read ?? Promise.resolve(); }
    const epoch = this.epoch;
    const current = this.flow;
    const operations = this.captured ?? this.options.operations;
    this.reading = true;
    this.dirty = false;
    if (current.phase !== "receipt") this.flow = { phase: "checking", plan: current.plan, input: current.input, error: current.phase === "uncertain" ? current.error : null };
    this.publish();
    const task = (async () => {
      let receipt: StateReceipt | null = null, failure: string | null = null;
      try { receipt = await operations.readReceipt(current.input.requestId); }
      catch (error) { failure = `Receipt read failed: ${message(error)}`; }
      if (epoch !== this.epoch || !this.demand) return;
      if (!receipt || !this.accept(receipt, current.plan, current.input)) {
        this.readError = receipt ? this.readError : failure ?? "The owner has no receipt for this request ID.";
        if (current.phase === "receipt") this.flow = current;
        else this.flow = { phase: "uncertain", plan: current.plan, input: current.input, error: this.readError ?? "No matching receipt was observed." };
      }
    })();
    this.read = task;
    return task.finally(() => {
      if (this.read !== task) return;
      this.read = null;
      this.reading = false;
      this.publish();
      const again = this.dirty;
      this.dirty = false;
      if (again && this.demand && this.unresolved() && !this.receiptBlock()) void this.readReceipt();
    });
  };

  private removeRecovery(expected?: StateApplyInput): boolean {
    const storage = this.options.recovery;
    if (!storage) return false;
    try {
      const raw = storage.getItem(prefix + this.options.recoveryKey);
      if (raw === null) return true;
      if (!expected) { this.error = "Recovery storage already holds a request. It was preserved for inspection."; this.publish(); return false; }
      if (expected) {
        const saved = readRecovery(storage, this.options.recoveryKey);
        if (!saved || !sameInput(saved.input, expected)) {
          this.error = "Recovery storage names another request; it was preserved."; this.publish(); return false;
        }
      }
      if (clearRecovery(storage, this.options.recoveryKey)) return true;
    } catch { /* retain the record on uncertain storage */ }
    this.error = "The recovery record could not be cleared. It remains held for inspection."; this.publish(); return false;
  }
  private leave(): void {
    if (!this.removeRecovery("input" in this.flow ? this.flow.input : undefined)) return;
    this.epoch++;
    this.captured = null;
    this.readError = null;
    this.error = null;
    this.callbackError = null;
    this.read = null;
    this.reading = false;
    this.dirty = false;
    this.flow = { phase: "idle" };
    this.publish();
  }
  discardPlan = (): void => { if (this.allowed("discardPlan")) this.leave(); };
  closeReceipt = (): void => { if (this.allowed("closeReceipt")) this.leave(); };
  forget = (): void => { if (this.allowed("forget")) this.leave(); };
}
