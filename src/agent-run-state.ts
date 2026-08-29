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
  JsonValue,
  Message,
  ModelConfig,
  NestedRunRef,
  OwnershipScope,
  RunDecision,
  RunLimitCounters,
  StickyDecision,
  ToolCallContent,
} from "./contracts.js";
import { AgentLoopStateError, AgentRunStateError } from "./contracts.js";
import type { SecretRedactor } from "./redaction.js";
import { validateLoadedSkillBodies, type LoadedSkillBodiesEntry } from "./skill-load.js";

export const AGENT_RUN_STATE_NAMESPACE = "prism.agent-run";
export const AGENT_RUN_STATE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MAX_AGENT_RUN_STATE_BYTES = 256 * 1024;
export const HARD_MAX_AGENT_RUN_STATE_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_PROPERTIES = 256;

/** One gated tool call awaiting or holding a decision inside a suspended durable run. */
export interface PendingToolCall {
  readonly call: ToolCallContent;
  readonly status: "ready" | "dispatched";
  readonly approvalId: string;
  /** Decision persisted by a partial batch; applied when the run finally resumes. */
  readonly decision?: RunDecision;
}

export interface StoredAgentRunState extends AgentRunState {
  readonly input?: readonly Message[];
  /** Legacy single gated call (pre-0.0.25 checkpoints). New states write `pendingCalls`. */
  readonly pending?: { readonly call: ToolCallContent; readonly status: "ready" | "dispatched" };
  /** Gated calls of the current suspension, in provider-turn order. */
  readonly pendingCalls?: readonly PendingToolCall[];
  /** Suspended nested runs (supervisor children) whose pending decisions surface at this root. */
  readonly nestedRuns?: readonly NestedRunRef[];
  /** Run-scoped sticky decisions; exact scope match, dropped at any terminal status. */
  readonly stickyDecisions?: readonly StickyDecision[];
  readonly interruptBeforeTool?: boolean;
  readonly counters: RunLimitCounters;
  readonly deadlineAt: string;
  /** Loop-local durable state captured by the strategy's snapshot hook at suspension. */
  readonly loopState?: { readonly name: string; readonly revision: string; readonly snapshot: JsonValue };
  /**
   * Opt-in session-level state (plan 015 Task 4): loaded-skill names only; bodies are
   * never persisted and reload on demand from the live registry via `load_skill`.
   * Absent by default (0.1.x checkpoints parse unchanged).
   */
  readonly sessionState?: {
    readonly loadedSkillNames?: readonly string[];
    readonly loadedSkillBodies?: readonly LoadedSkillBodiesEntry[];
  };
}

/** Session-state caps (plan 015 Task 4): bounded names charged against the run-state byte budget. */
export const MAX_PERSISTED_SKILL_NAMES = 64;
export const MAX_PERSISTED_SKILL_NAME_CHARS = 256;

/** Revision stamps of the built-in loops; custom strategies declare their own `revision`. */
export const BUILT_IN_LOOP_REVISIONS: Readonly<Record<string, string>> = {
  "single-shot": "1",
  "generate-validate-revise": "1",
};

/** Validate a strategy snapshot as JSON-compatible and package it for the durable envelope. */
export function boundedLoopSnapshot(name: string, revision: string, snapshot: JsonValue): StoredAgentRunState["loopState"] {
  try {
    assertJsonValue(snapshot, 0);
  } catch (error) {
    if (error instanceof AgentLoopStateError) throw error;
    throw new AgentLoopStateError("ERR_PRISM_LOOP_SNAPSHOT", "Loop snapshot must be JSON-compatible", { cause: error });
  }
  return { name, revision, snapshot };
}

function assertJsonValue(value: unknown, depth: number): asserts value is JsonValue {
  if (depth > MAX_DEPTH) throw new AgentLoopStateError("ERR_PRISM_LOOP_SNAPSHOT", `Loop snapshot exceeds depth ${MAX_DEPTH}`);
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) throw new AgentLoopStateError("ERR_PRISM_LOOP_SNAPSHOT", "Loop snapshot numbers must be finite");
      return;
    case "object": {
      if (value === null) return;
      for (const item of Object.values(value)) assertJsonValue(item, depth + 1);
      return;
    }
    default:
      throw new AgentLoopStateError("ERR_PRISM_LOOP_SNAPSHOT", "Loop snapshot must be JSON-compatible");
  }
}

export function agentFingerprint(agent: Agent, revision: string): string {
  const config = agent.config;
  const tools = !config.tools ? [] : "list" in config.tools ? config.tools.list() : config.tools;
  const skills = !config.skills ? [] : "list" in config.skills ? config.skills.list() : config.skills;
  const guardrails = [
    ...(config.guardrails?.input ?? []),
    ...(config.guardrails?.output ?? []),
    ...(config.guardrails?.toolInput ?? []),
    ...(config.guardrails?.toolOutput ?? []),
  ];
  const systemPrompt =
    config.systemPrompt === false || config.systemPrompt === undefined
      ? (config.systemPrompt ?? null)
      : (Array.isArray(config.systemPrompt) ? config.systemPrompt : [config.systemPrompt]).map((c) => ({ id: c.id, text: c.text }));
  const value = JSON.stringify({
    id: config.id ?? config.name ?? "agent",
    revision,
    model: config.model,
    // Instructions/prompt text shapes agent behavior as much as the tool set; a change
    // without a definitionRevision bump must not resume stale durable runs silently.
    instructions: config.instructions ?? null,
    systemPrompt,
    skills: skills.map((skill) => ({ name: skill.name, instructions: skill.instructions, toolNames: skill.toolNames })),
    tools: tools.map((tool) => ({
      name: tool.name,
      parameters: tool.parameters,
      exclusive: tool.exclusive,
      effect: typeof tool.effect === "function" ? "classifier" : tool.effect,
    })),
    guardrails: guardrails.map((guardrail) => ({ name: guardrail.name, stage: guardrail.stage, revision: guardrail.revision })),
    // Loop revision participates so a loop change without a definitionRevision bump fails closed.
    loop:
      typeof config.loop === "object" && config.loop && "strategy" in config.loop
        ? { name: config.loop.strategy, revision: BUILT_IN_LOOP_REVISIONS[config.loop.strategy] ?? null }
        : { name: config.loop?.name ?? "single-shot", revision: config.loop?.revision ?? BUILT_IN_LOOP_REVISIONS["single-shot"] },
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
  if (
    ref.sessionId &&
    record.value &&
    typeof record.value === "object" &&
    (record.value as { sessionId?: unknown }).sessionId !== ref.sessionId
  ) {
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
  const {
    input: _input,
    pending: _pending,
    pendingCalls: _pendingCalls,
    nestedRuns: _nestedRuns,
    interruptBeforeTool: _interruptBeforeTool,
    counters: _counters,
    deadlineAt: _deadlineAt,
    ...publicValue
  } = state;
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
  readonly pendingCalls?: StoredAgentRunState["pendingCalls"];
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
    pendingCalls: input.pendingCalls,
    interruptBeforeTool: input.interruptBeforeTool,
    counters: input.counters,
    deadlineAt: input.deadlineAt,
  };
}

export function parseAgentRunState(value: unknown, version?: number): StoredAgentRunState {
  if (!value || typeof value !== "object") throw new AgentRunStateError("Agent run state must be an object");
  const state = value as Partial<StoredAgentRunState>;
  if (state.schemaVersion !== AGENT_RUN_STATE_SCHEMA_VERSION)
    throw new AgentRunStateError(`Unsupported agent run state schemaVersion ${String(state.schemaVersion)}`);
  if (
    !state.agentId ||
    !state.definitionRevision ||
    !state.fingerprint ||
    !state.runId ||
    !state.sessionId ||
    !state.model ||
    !state.status ||
    !state.counters ||
    !state.deadlineAt
  ) {
    throw new AgentRunStateError("Malformed agent run state");
  }
  if (
    state.pendingCalls !== undefined &&
    (!Array.isArray(state.pendingCalls) ||
      state.pendingCalls.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          !(entry as PendingToolCall).call ||
          typeof (entry as PendingToolCall).approvalId !== "string" ||
          ((entry as PendingToolCall).status !== "ready" && (entry as PendingToolCall).status !== "dispatched"),
      ))
  ) {
    throw new AgentRunStateError("Malformed agent run pending calls");
  }
  if (
    state.stickyDecisions !== undefined &&
    (!Array.isArray(state.stickyDecisions) ||
      state.stickyDecisions.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          !(entry as StickyDecision).scope ||
          ((entry as StickyDecision).outcome !== "allow_for_run" && (entry as StickyDecision).outcome !== "reject_for_run"),
      ))
  ) {
    throw new AgentRunStateError("Malformed agent run sticky decisions");
  }
  if (
    state.nestedRuns !== undefined &&
    (!Array.isArray(state.nestedRuns) ||
      state.nestedRuns.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          typeof (entry as NestedRunRef).runId !== "string" ||
          typeof (entry as NestedRunRef).toolCallId !== "string" ||
          !Array.isArray((entry as NestedRunRef).path) ||
          !Array.isArray((entry as NestedRunRef).approvals) ||
          (entry as NestedRunRef).approvals.some(
            (approval) => typeof approval?.id !== "string" || typeof approval?.childApprovalId !== "string",
          ),
      ))
  ) {
    throw new AgentRunStateError("Malformed agent run nested runs");
  }
  if (
    state.loopState !== undefined &&
    (typeof state.loopState !== "object" ||
      typeof state.loopState.name !== "string" ||
      typeof state.loopState.revision !== "string" ||
      !("snapshot" in state.loopState))
  ) {
    throw new AgentRunStateError("Malformed agent run loop state");
  }
  // Load bounds against the hard cap, not the default: the configured maxStateBytes is a
  // save-side policy knob, while the load-side bound is only a DoS ceiling. States saved
  // with a raised maxStateBytes must remain resumable.
  return boundState({ ...state, version } as StoredAgentRunState, HARD_MAX_AGENT_RUN_STATE_BYTES);
}

function boundState(state: StoredAgentRunState, maxBytes: number): StoredAgentRunState {
  validateSessionState(state.sessionState);
  checkShape(state, 0);
  let text: string;
  try {
    text = JSON.stringify(state);
  } catch {
    throw new AgentRunStateError("Agent run state must be JSON serializable");
  }
  if (Buffer.byteLength(text) > maxBytes) throw new AgentRunStateError(`Agent run state exceeds ${maxBytes} bytes`);
  return JSON.parse(text) as StoredAgentRunState;
}

function checkShape(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new AgentRunStateError(`Agent run state exceeds depth ${MAX_DEPTH}`);
  if (!value || typeof value !== "object") return;
  const entries = Array.isArray(value) ? value : Object.values(value);
  if (!Array.isArray(value) && entries.length > MAX_PROPERTIES)
    throw new AgentRunStateError(`Agent run state exceeds ${MAX_PROPERTIES} properties`);
  for (const item of entries) checkShape(item, depth + 1);
}

/** Fail-closed validation of the opt-in session-state block (load and save sides). */
function validateSessionState(sessionState: StoredAgentRunState["sessionState"]): void {
  if (sessionState === undefined) return;
  if (!sessionState || typeof sessionState !== "object") {
    throw new AgentRunStateError("Malformed agent run session state");
  }
  const bodies = sessionState.loadedSkillBodies;
  if (bodies !== undefined) {
    try {
      validateLoadedSkillBodies(bodies);
    } catch (error) {
      throw new AgentRunStateError(error instanceof Error ? error.message : String(error));
    }
  }
  const names = sessionState.loadedSkillNames;
  if (names === undefined) return;
  if (!Array.isArray(names) || names.length > MAX_PERSISTED_SKILL_NAMES) {
    throw new AgentRunStateError(`Loaded-skill names exceed ${MAX_PERSISTED_SKILL_NAMES} entries`);
  }
  for (const name of names) {
    if (typeof name !== "string" || name.length > MAX_PERSISTED_SKILL_NAME_CHARS) {
      throw new AgentRunStateError(`Loaded-skill name exceeds ${MAX_PERSISTED_SKILL_NAME_CHARS} chars`);
    }
  }
}
