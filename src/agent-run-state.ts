import { createHash } from "node:crypto";
import type {
  Agent,
  AgentRunInterruption,
  AgentRunRef,
  AgentRunState,
  AgentRunStateOptions,
  AgentRunStatusResult,
  CheckpointRecord,
  CheckpointStore,
  Message,
  ModelConfig,
  OwnershipScope,
  RunLimitCounters,
  ToolCallContent,
} from "./contracts.js";
import { AgentRunStateError } from "./contracts.js";
import type { SecretRedactor } from "./redaction.js";

export const AGENT_RUN_STATE_NAMESPACE = "prism.agent-run";
export const AGENT_RUN_STATE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MAX_AGENT_RUN_STATE_BYTES = 256 * 1024;
export const HARD_MAX_AGENT_RUN_STATE_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_PROPERTIES = 256;

export interface StoredAgentRunState extends AgentRunState {
  readonly input?: readonly Message[];
  readonly pending?: { readonly call: ToolCallContent; readonly status: "ready" | "dispatched" };
  readonly interruptBeforeTool?: boolean;
  readonly counters: RunLimitCounters;
  readonly deadlineAt: string;
}

export function agentFingerprint(agent: Agent, revision: string): string {
  const config = agent.config;
  const tools = !config.tools ? [] : "list" in config.tools ? config.tools.list() : config.tools;
  const guardrails = [
    ...(config.guardrails?.input ?? []),
    ...(config.guardrails?.output ?? []),
    ...(config.guardrails?.toolInput ?? []),
    ...(config.guardrails?.toolOutput ?? []),
  ];
  const value = JSON.stringify({
    id: config.id ?? config.name ?? "agent",
    revision,
    model: config.model,
    tools: tools.map((tool) => ({ name: tool.name, parameters: tool.parameters, exclusive: tool.exclusive })),
    guardrails: guardrails.map((guardrail) => ({ name: guardrail.name, stage: guardrail.stage, revision: guardrail.revision })), 
    loop: typeof config.loop === "object" && config.loop && "strategy" in config.loop ? config.loop.strategy : config.loop?.name ?? "single-shot",
  });
  return createHash("sha256").update(value).digest("hex");
}

export function agentId(agent: Agent): string {
  const id = agent.config.id ?? agent.config.name;
  if (!id?.trim()) throw new AgentRunStateError("Durable agent runs require AgentConfig.id or name");
  return id;
}

export function validateRunStateOptions(options: AgentRunStateOptions): void {
  if (!options.definitionRevision.trim()) throw new AgentRunStateError("Durable agent runs require definitionRevision");
  const bytes = options.maxStateBytes ?? DEFAULT_MAX_AGENT_RUN_STATE_BYTES;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > HARD_MAX_AGENT_RUN_STATE_BYTES) {
    throw new AgentRunStateError(`maxStateBytes must be a positive safe integer at most ${HARD_MAX_AGENT_RUN_STATE_BYTES}`);
  }
}

export async function loadAgentRunState(
  checkpoints: CheckpointStore,
  ref: AgentRunRef,
  ownership?: OwnershipScope,
): Promise<{ readonly record: CheckpointRecord; readonly state: StoredAgentRunState }> {
  const record = await checkpoints.loadCheckpoint({ namespace: AGENT_RUN_STATE_NAMESPACE, key: ref.runId, ...ownership });
  if (!record) throw new AgentRunStateError(`No durable agent run ${ref.runId}`);
  if (ref.sessionId && record.value && typeof record.value === "object" && (record.value as { sessionId?: unknown }).sessionId !== ref.sessionId) {
    throw new AgentRunStateError("Agent run session mismatch");
  }
  return { record, state: parseAgentRunState(record.value, record.version) };
}

export async function saveAgentRunState(input: {
  readonly checkpoints: CheckpointStore;
  readonly state: StoredAgentRunState;
  readonly expectedVersion: number;
  readonly ownership?: OwnershipScope;
  readonly fencingToken?: number;
  readonly redactor?: SecretRedactor;
  readonly maxStateBytes?: number;
}): Promise<{ readonly record: CheckpointRecord; readonly state: StoredAgentRunState }> {
  const bounded = boundState(input.redactor?.redact(input.state) ?? input.state, input.maxStateBytes ?? DEFAULT_MAX_AGENT_RUN_STATE_BYTES);
  const record = await input.checkpoints.saveCheckpoint({
    namespace: AGENT_RUN_STATE_NAMESPACE,
    key: bounded.runId,
    version: input.expectedVersion + 1,
    expectedVersion: input.expectedVersion,
    fencingToken: input.fencingToken,
    value: bounded,
    category: "agent-run",
    ...input.ownership,
  });
  return { record, state: { ...bounded, version: record.version } };
}

export function statusFromState(state: StoredAgentRunState, version: number): AgentRunStatusResult {
  return { state: publicState({ ...state, version }), version };
}

export function publicState(state: StoredAgentRunState): AgentRunState {
  const { input: _input, pending: _pending, interruptBeforeTool: _interruptBeforeTool, counters: _counters, deadlineAt: _deadlineAt, ...publicValue } = state;
  return publicValue;
}

export function initialAgentRunState(input: {
  readonly agent: Agent;
  readonly options: AgentRunStateOptions;
  readonly runId: string;
  readonly sessionId: string;
  readonly leafId?: string;
  readonly model: ModelConfig;
  readonly counters: RunLimitCounters;
  readonly deadlineAt: string;
  readonly status: "suspended" | "running";
  readonly interruption?: AgentRunInterruption;
  readonly messages?: readonly Message[];
  readonly pending?: StoredAgentRunState["pending"];
  readonly interruptBeforeTool?: boolean;
}): StoredAgentRunState {
  validateRunStateOptions(input.options);
  return {
    schemaVersion: AGENT_RUN_STATE_SCHEMA_VERSION,
    agentId: agentId(input.agent),
    definitionRevision: input.options.definitionRevision,
    fingerprint: agentFingerprint(input.agent, input.options.definitionRevision),
    runId: input.runId,
    sessionId: input.sessionId,
    ...(input.leafId ? { leafId: input.leafId } : {}),
    model: input.model,
    status: input.status,
    interruption: input.interruption,
    input: input.messages,
    pending: input.pending,
    interruptBeforeTool: input.interruptBeforeTool,
    counters: input.counters,
    deadlineAt: input.deadlineAt,
  };
}

export function parseAgentRunState(value: unknown, version?: number): StoredAgentRunState {
  if (!value || typeof value !== "object") throw new AgentRunStateError("Agent run state must be an object");
  const state = value as Partial<StoredAgentRunState>;
  if (state.schemaVersion !== AGENT_RUN_STATE_SCHEMA_VERSION) throw new AgentRunStateError(`Unsupported agent run state schemaVersion ${String(state.schemaVersion)}`);
  if (!state.agentId || !state.definitionRevision || !state.fingerprint || !state.runId || !state.sessionId || !state.model || !state.status || !state.counters || !state.deadlineAt) {
    throw new AgentRunStateError("Malformed agent run state");
  }
  return boundState({ ...state, version } as StoredAgentRunState, DEFAULT_MAX_AGENT_RUN_STATE_BYTES);
}

function boundState(state: StoredAgentRunState, maxBytes: number): StoredAgentRunState {
  checkShape(state, 0);
  let text: string;
  try { text = JSON.stringify(state); } catch { throw new AgentRunStateError("Agent run state must be JSON serializable"); }
  if (Buffer.byteLength(text) > maxBytes) throw new AgentRunStateError(`Agent run state exceeds ${maxBytes} bytes`);
  return JSON.parse(text) as StoredAgentRunState;
}

function checkShape(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new AgentRunStateError(`Agent run state exceeds depth ${MAX_DEPTH}`);
  if (!value || typeof value !== "object") return;
  const entries = Array.isArray(value) ? value : Object.values(value);
  if (!Array.isArray(value) && entries.length > MAX_PROPERTIES) throw new AgentRunStateError(`Agent run state exceeds ${MAX_PROPERTIES} properties`);
  for (const item of entries) checkShape(item, depth + 1);
}
