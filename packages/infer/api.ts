import { operation, stateDir, type PackageApi } from "@agentstack/api";
import { InferService } from "./src/service.js";
import { discoverInput, getInput, listInput, listOutput, modelObservation, modelsInput, modelsOutput, requestRecord, startInput } from "./src/schema.js";

export type InferContext = { service: InferService };
export const inferModels = operation({
  name: "infer_models",
  description: "Read cached model discovery for Bot accounts: picker-visible Codex models and reasoning efforts, observation time, and whether discovery is running. Never starts discovery or inference; a listed model does not guarantee direct-backend access.",
  input: modelsInput, output: modelsOutput,
  annotations: { title: "Read inference models", readOnlyHint: true },
  async call(ctx: InferContext, input) { return { accounts: ctx.service.models(input.accountId) }; },
});
export const inferDiscover = operation({
  name: "infer_discover",
  description: "Start discovering an enabled Bot account's models in the background through an isolated app-server model/list. No thread, turn or inference. Coalesces with a discovery already running; read infer_models after infer_changed.",
  input: discoverInput, output: modelObservation,
  annotations: { title: "Discover inference models", readOnlyHint: false, idempotentHint: true },
  async call(ctx: InferContext, input) { return ctx.service.refreshModels(input.accountId); },
});
export const inferStart = operation({
  name: "infer_start",
  description: "Admit one experimental, non-agentic Codex subscription request for an enabled Bot account into the durable ledger; returns its running record promptly. A fresh model/effort check precedes exactly one backend request that spends shared allowance: no retries, tools, turn or Platform fallback. One running request per account; resending an identical requestId returns the same record.",
  input: startInput, output: requestRecord,
  annotations: { title: "Start one inference", readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  async call(ctx: InferContext, input) { return ctx.service.start(input); },
});
export const inferRequestList = operation({
  name: "infer_request_list",
  description: "Page the durable inference request ledger, newest first, with state, outcome code, usage and short previews. Read infer_request_get for full instructions, input and output.",
  input: listInput, output: listOutput,
  annotations: { title: "List inference requests", readOnlyHint: true },
  async call(ctx: InferContext, input) { return ctx.service.list(input.limit, input.before); },
});
export const inferRequestGet = operation({
  name: "infer_request_get",
  description: "Read one inference request from the durable ledger with its full instructions, input, output text, usage and outcome.",
  input: getInput, output: requestRecord,
  annotations: { title: "Read inference request", readOnlyHint: true },
  async call(ctx: InferContext, input) { return ctx.service.get(input.requestId); },
});
export const topics = { infer_changed: "An inference request or model discovery changed. Re-read infer_request_list, infer_models, or the request you follow." } as const;
export const api: PackageApi<InferContext, keyof typeof topics> = {
  operations: [inferModels, inferDiscover, inferStart, inferRequestList, inferRequestGet],
  events: { topics, start(ctx, publish) {
    ctx.service.onChange = () => publish("infer_changed");
    return () => { ctx.service.onChange = undefined; };
  } },
  async createContext(env) { return { service: new InferService(stateDir(env)) }; },
  prepareCloseContext(ctx) { ctx.service.prepareClose(); },
  async closeContext(ctx) { await ctx.service.close(); },
};
