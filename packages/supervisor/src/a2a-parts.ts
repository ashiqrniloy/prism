import { A2AError } from "./errors.js";
import type { A2AArtifact, A2ALimits, A2AMessage, A2APart, A2APartPolicy, A2ATask } from "./a2a-types.js";

export const A2A_DEFAULT_LIMITS = { maxRequestBytes: 64*1024, maxResponseBytes: 1024*1024, maxEventBytes: 64*1024, maxStreamBytes: 10*1024*1024, maxStreamEvents: 10_000, maxConcurrentRequests: 16, timeoutMs: 120_000, maxCardBytes: 64*1024, maxIdBytes: 256, maxParts: 32, maxPartBytes: 1024*1024, maxRawBytes: 1024*1024, maxDataBytes: 256*1024, maxArtifacts: 32, maxHistory: 100, maxPageSize: 100, maxCursorBytes: 4096, maxReplayEvents: 1000, maxPushConfigs: 10 } as const;
export const A2A_HARD_LIMITS = { maxRequestBytes: 1024*1024, maxResponseBytes: 8*1024*1024, maxEventBytes: 1024*1024, maxStreamBytes: 64*1024*1024, maxStreamEvents: 100_000, maxConcurrentRequests: 256, timeoutMs: 30*60_000, maxCardBytes: 1024*1024, maxIdBytes: 4096, maxParts: 256, maxPartBytes: 8*1024*1024, maxRawBytes: 8*1024*1024, maxDataBytes: 4*1024*1024, maxArtifacts: 256, maxHistory: 1000, maxPageSize: 1000, maxCursorBytes: 16*1024, maxReplayEvents: 10_000, maxPushConfigs: 100 } as const;
export type ResolvedA2ALimits = { readonly [K in keyof typeof A2A_DEFAULT_LIMITS]: number };

export function resolveA2ALimits(input: A2ALimits = {}): ResolvedA2ALimits {
  const output: Record<string, number> = {};
  for (const key of Object.keys(A2A_DEFAULT_LIMITS) as (keyof typeof A2A_DEFAULT_LIMITS)[]) {
    const value = input[key] ?? A2A_DEFAULT_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > A2A_HARD_LIMITS[key]) throw new A2AError(`${key} is invalid`, 400, "ERR_PRISM_A2A_CONFIG");
    output[key] = value;
  }
  return output as ResolvedA2ALimits;
}

export async function parseA2AMessage(value: unknown, limits: ResolvedA2ALimits, policy: A2APartPolicy = {}): Promise<A2AMessage> {
  if (!record(value) || (value.role !== "user" && value.role !== "ROLE_USER" && value.role !== "agent" && value.role !== "ROLE_AGENT") || !id(value.messageId, limits) || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > limits.maxParts) throw new A2AError("Invalid A2A message", 400, "ERR_PRISM_A2A_MESSAGE");
  const parts: A2APart[] = [];
  for (const part of value.parts) parts.push(await parseA2APart(part, limits, policy));
  const message: A2AMessage = { role: value.role, messageId: value.messageId, parts, contextId: optionalId(value.contextId, limits), taskId: optionalId(value.taskId, limits), metadata: record(value.metadata) ? value.metadata : undefined };
  bounded(message, limits.maxRequestBytes, "A2A message");
  return message;
}

export async function parseA2APart(value: unknown, limits: ResolvedA2ALimits, policy: A2APartPolicy = {}): Promise<A2APart> {
  if (!record(value)) throw new A2AError("Invalid A2A part", 400, "ERR_PRISM_A2A_PART");
  const variants = ["text", "raw", "url", "data"].filter((key) => Object.hasOwn(value, key));
  if (Object.keys(value).some((key) => !["text", "raw", "url", "data", "mediaType", "filename", "metadata"].includes(key))) throw new A2AError("Unknown A2A part field", 400, "ERR_PRISM_A2A_PART");
  if (variants.length !== 1) throw new A2AError("A2A part requires exactly one content field", 400, "ERR_PRISM_A2A_PART");
  const base = { mediaType: optionalString(value.mediaType, 256), filename: optionalString(value.filename, 1024), metadata: record(value.metadata) ? value.metadata : undefined };
  let part: A2APart;
  if (variants[0] === "text" && typeof value.text === "string") part = { ...base, text: value.text };
  else if (variants[0] === "raw" && policy.allowRaw && typeof value.raw === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.raw) && Buffer.from(value.raw, "base64").byteLength <= limits.maxRawBytes) part = { ...base, raw: value.raw };
  else if (variants[0] === "url" && policy.allowUrl && policy.validateUrl && typeof value.url === "string") {
    let url: URL; try { url = new URL(value.url); } catch { throw new A2AError("Invalid A2A file URL", 400, "ERR_PRISM_A2A_PART"); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new A2AError("A2A file URL requires credential-free HTTPS", 403, "ERR_PRISM_A2A_ORIGIN");
    await policy.validateUrl?.(url); // Validation only; never dereference.
    part = { ...base, url: url.href };
  } else if (variants[0] === "data" && policy.allowData) { bounded(value.data, limits.maxDataBytes, "A2A data part"); part = { ...base, data: structuredClone(value.data) }; }
  else throw new A2AError("Unsupported A2A part", 400, "ERR_PRISM_A2A_PART");
  bounded(part, limits.maxPartBytes, "A2A part");
  return part;
}

export async function validateA2ATask(task: A2ATask, limits: ResolvedA2ALimits, policy: A2APartPolicy = { allowRaw: true, allowUrl: true, allowData: true }): Promise<A2ATask> {
  if (!id(task.id, limits) || !id(task.contextId, limits) || !task.status || !TASK_STATES.has(task.status.state) || !Number.isFinite(Date.parse(task.status.timestamp))) throw new A2AError("Invalid A2A task", 500, "ERR_PRISM_A2A_TASK");
  if ((task.artifacts?.length ?? 0) > limits.maxArtifacts || (task.history?.length ?? 0) > limits.maxHistory) throw new A2AError("A2A task collection limit exceeded", 507, "ERR_PRISM_A2A_RESPONSE_LIMIT");
  for (const artifact of task.artifacts ?? []) await validateArtifact(artifact, limits, policy);
  for (const message of task.history ?? []) await parseA2AMessage(message, limits, policy);
  bounded(task, limits.maxResponseBytes, "A2A task");
  return task;
}

async function validateArtifact(value: A2AArtifact, limits: ResolvedA2ALimits, policy: A2APartPolicy): Promise<void> {
  if (!id(value.artifactId, limits) || !value.parts.length || value.parts.length > limits.maxParts) throw new A2AError("Invalid A2A artifact", 500, "ERR_PRISM_A2A_TASK");
  for (const part of value.parts) await parseA2APart(part, limits, policy);
}
export function requireId(value: unknown, limits: ResolvedA2ALimits, label = "task id"): string { if (!id(value, limits)) throw new A2AError(`Invalid A2A ${label}`, 400, "ERR_PRISM_A2A_REQUEST"); return value; }
export function optionalCursor(value: unknown, limits: ResolvedA2ALimits): string | undefined { if (value === undefined || value === "") return undefined; if (typeof value !== "string" || Buffer.byteLength(value) > limits.maxCursorBytes) throw new A2AError("Invalid A2A page/event cursor", 400, "ERR_PRISM_A2A_REQUEST"); return value; }
export function bounded<T>(value: T, maxBytes: number, label: string): T {
  let properties = 0; const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }]; const seen = new Set<object>();
  while (stack.length) { const item = stack.pop()!; if (typeof item.value === "number" && !Number.isFinite(item.value)) throw new A2AError(`${label} contains non-finite number`, 400, "ERR_PRISM_A2A_REQUEST"); if (!item.value || typeof item.value !== "object") continue; if (item.depth > 64 || seen.has(item.value)) throw new A2AError(`${label} exceeds JSON depth or is cyclic`, 400, "ERR_PRISM_A2A_REQUEST"); seen.add(item.value); const values = Array.isArray(item.value) ? item.value : Object.values(item.value); properties += values.length; if (properties > 10_000) throw new A2AError(`${label} exceeds JSON property limit`, 400, "ERR_PRISM_A2A_REQUEST"); for (const child of values) stack.push({ value: child, depth: item.depth + 1 }); }
  let json: string; try { json = JSON.stringify(value); } catch { throw new A2AError(`${label} is not JSON`, 400, "ERR_PRISM_A2A_REQUEST"); } if (Buffer.byteLength(json) > maxBytes) throw new A2AError(`${label} exceeds max bytes`, 507, "ERR_PRISM_A2A_RESPONSE_LIMIT"); return value;
}
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function id(value: unknown, limits: ResolvedA2ALimits): value is string { return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= limits.maxIdBytes; }
function optionalId(value: unknown, limits: ResolvedA2ALimits): string | undefined { return value === undefined ? undefined : requireId(value, limits); }
function optionalString(value: unknown, max: number): string | undefined { if (value === undefined) return undefined; if (typeof value !== "string" || Buffer.byteLength(value) > max) throw new A2AError("Invalid A2A part metadata", 400, "ERR_PRISM_A2A_PART"); return value; }
const TASK_STATES = new Set(["TASK_STATE_SUBMITTED","TASK_STATE_WORKING","TASK_STATE_COMPLETED","TASK_STATE_FAILED","TASK_STATE_CANCELED","TASK_STATE_INPUT_REQUIRED","TASK_STATE_REJECTED","TASK_STATE_AUTH_REQUIRED"]);
