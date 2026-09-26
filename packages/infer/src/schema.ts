import { z } from "zod";

export const accountId = z.uuid();
export const modelId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const effort = z.enum(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
export const model = z.strictObject({ id: modelId, defaultEffort: effort, supportedEfforts: z.array(effort).min(1) });
const timestamp = z.iso.datetime();

export const modelObservation = z.strictObject({
  accountId,
  models: z.array(model).nullable().describe("Last successful discovery, or null before one."),
  observedAt: timestamp.nullable(),
  discovering: z.boolean(),
  error: z.string().nullable().describe("Code from the most recent failed discovery, such as catalog_unavailable."),
});
export const modelsInput = z.strictObject({ accountId: accountId.optional() });
export const modelsOutput = z.strictObject({ accounts: z.array(modelObservation) });
export const discoverInput = z.strictObject({ accountId });

export const requestId = z.uuid().describe("Client-generated idempotency key. Resend identical input after an uncertain response; it never starts a second request.");
export const startInput = z.strictObject({
  requestId, accountId, model: modelId, effort,
  instructions: z.string().min(1).max(4_000),
  input: z.string().min(1).max(16_000),
  maxOutputTokens: z.number().int().min(1).max(1024).default(256),
});
export const usage = z.strictObject({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
});
export const requestState = z.enum(["running", "completed", "failed", "unknown"]).describe(
  "failed is definite: nothing was charged or the backend refused. unknown may have been charged: the request was interrupted after it could have been sent.");
const requestFields = {
  requestId, accountId, model: modelId, effort,
  maxOutputTokens: z.number().int().min(1).max(1024),
  state: requestState,
  error: z.string().nullable().describe("Code for a failed or unknown request, such as model_unavailable, codex_rate_limited, http_502, request_interrupted, response_incomplete or service_restarted."),
  usage: usage.nullable(),
  createdAt: timestamp,
  finishedAt: timestamp.nullable(),
};
export const requestSummary = z.strictObject({
  ...requestFields,
  inputPreview: z.string().max(160),
  textPreview: z.string().max(160).nullable(),
  textChars: z.number().int().nonnegative().nullable(),
});
export const requestRecord = z.strictObject({
  ...requestFields,
  instructions: z.string().max(4_000),
  input: z.string().max(16_000),
  text: z.string().max(16_000).nullable(),
});
export const listInput = z.strictObject({
  limit: z.number().int().min(1).max(50).default(20),
  before: z.number().int().positive().optional().describe("nextBefore from the previous page."),
});
export const listOutput = z.strictObject({ requests: z.array(requestSummary), nextBefore: z.number().int().positive().nullable() });
export const getInput = z.strictObject({ requestId });

export type Model = z.infer<typeof model>;
export type ModelObservation = z.infer<typeof modelObservation>;
export type StartInput = z.infer<typeof startInput>;
export type Usage = z.infer<typeof usage>;
export type RequestState = z.infer<typeof requestState>;
export type RequestRecord = z.infer<typeof requestRecord>;
export type RequestSummary = z.infer<typeof requestSummary>;
