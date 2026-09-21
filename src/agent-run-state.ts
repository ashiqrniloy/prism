import { createHash } from "node:crypto";
import {
  type PersistedAttentionFoldLedger,
  type PersistedAttentionStickyFrontier,
  parseAttentionStickyFrontier,
  restoreAttentionFoldLedger,
} from "./attention-compiler.js";
import type {
  Agent,
  AgentRunCheckpointMetadata,
  AgentRunCheckpointMetadataSource,
  AgentRunInterruption,
  AgentRunRef,
  AgentRunState,
  AgentRunStateOptions,
  CheckpointRecord,
  CheckpointStore,
  GuardrailRule,
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
import { type LoadedSkillBodiesEntry, validateLoadedSkillBodies } from "./skill-load.js";
import { HARD_RUN_TOOL_NAMES } from "./tools.js";

export const AGENT_RUN_STATE_NAMESPACE = "prism.agent-run";
export const AGENT_RUN_STATE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MAX_AGENT_RUN_STATE_BYTES = 256 * 1024;
export const HARD_MAX_AGENT_RUN_STATE_BYTES = 1024 * 1024;
/** Sidecar metadata ceiling per checkpoint record (not the run-state value). */
export const MAX_AGENT_RUN_METADATA_BYTES = 4 * 1024;
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
  /** Wall deadline; absent when the run has no wall limit. Old snapshots with a deadline still parse. */
  readonly deadlineAt?: string;
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
    /** Plan 041: tools activated via `search_tools` (names only; inert for absent tools on restore). */
    readonly activatedToolNames?: readonly string[];
    /** Plan 074 P3: sticky attention mutations (thinking hashes + tool-call ids), so a durable
     *  resume keeps its stubs instead of re-deciding on the first turn. Validated on load. */
    readonly attentionSticky?: PersistedAttentionStickyFrontier;
    /** Plan 086 T3: folded bodies (`attention.compiler.durable`), so a resumed fold re-applies
     *  the same stub bytes instead of re-summarizing. Written and restored independently of
     *  `persistSessionState`. Validated on load. */
    readonly attentionFold?: PersistedAttentionFoldLedger;
    /** Plan 104 T2: compiled pack refs plus pack-owned state, so a resume re-enforces exactly what
     *  the suspended run enforced. Written only with `persistSessionState`; validated on load. */
    readonly guardrailPacks?: PersistedGuardrailPacks;
  };
  /** Per-run allow-list (Task 21). Absent = full registered set (legacy checkpoints). */
  readonly toolNames?: readonly string[];
  /**
   * Recorded checkpoint cadence (plan 084 Task 1). Present only for `"every-turn"` runs, so
   * default checkpoints stay byte-identical. A resume of such a state keeps checkpointing each
   * turn without the host repeating the option.
   */
  readonly checkpointPolicy?: "every-turn";
  /**
   * Set when a terminal state was written by a clean run-end stop that leaves the frontier intact:
   * a `RunOptions.turnPolicy` stop (`host_policy`, plan 084 Task 2) or a stop-hook continuation cap
   * (`hook_limit`, plan 106 R1). The run succeeded but `decision: "continue"` may resume it. Absent
   * on every other state — a naturally finished run is never continuable.
   */
  readonly stopReason?: "host_policy" | "hook_limit";
}

/** Session-state caps (plan 015 Task 4): bounded names charged against the run-state byte budget. */
export const MAX_PERSISTED_SKILL_NAMES = 64;
export const MAX_PERSISTED_SKILL_NAME_CHARS = 256;
/** Plan 041: activated-tool names ride the same budget discipline (cap 128; multiple searches accumulate). */
export const MAX_PERSISTED_ACTIVATED_TOOL_NAMES = 128;
/** Plan 104 T2: persisted pack refs and state (cap matches `MAX_GUARDRAIL_PACKS`; ids match the pack cap). */
const MAX_PERSISTED_GUARDRAIL_PACKS = 8;
const MAX_PERSISTED_GUARDRAIL_PACK_ID_CHARS = 96;
const MAX_PERSISTED_GUARDRAIL_PACK_RULES = 64;
/** Per-pack options/state byte ceiling; the whole session state is still bounded by `maxStateBytes`. */
const MAX_PERSISTED_GUARDRAIL_PACK_BYTES = 8 * 1024;

/** Plan 104 T2: one replayable pack row — the id, the version it was compiled at, and host options. */
interface PersistedGuardrailPackRef {
  readonly id: string;
  readonly version: number;
  readonly options?: Readonly<Record<string, unknown>>;
  /** Inline pattern rules; closures and `RegExp` patterns never reach a checkpoint (refused at save). */
  readonly rules?: readonly GuardrailRule[];
}

/**
 * Plan 104 T2: the checkpoint-side pack block written with `persistSessionState`. Rows replay a
 * registered pack by `id`/`version` or an inline pack by its pattern `rules` (plan 104 T3).
 */
export interface PersistedGuardrailPacks {
  readonly packs: readonly PersistedGuardrailPackRef[];
  readonly state?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

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
  if (options.checkpointPolicy !== undefined && options.checkpointPolicy !== "decision" && options.checkpointPolicy !== "every-turn") {
    throw new AgentRunStateError('checkpointPolicy must be "decision" or "every-turn"');
  }
}

export async function loadAgentRunState(
  checkpoints: CheckpointStore,
  ref: AgentRunRef,
  ownership?: OwnershipScope,
): Promise<{ readonly record: CheckpointRecord; readonly state: StoredAgentRunState; readonly metadata?: AgentRunCheckpointMetadata }> {
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
  const metadata = readCheckpointMetadata(record.metadata);
  return { record, state: parseAgentRunState(record.value, record.version), ...(metadata ? { metadata } : {}) };
}

/** Resolve a host metadata source. A throwing provider fails the checkpoint write (fail closed). */
export function resolveCheckpointMetadata(source: AgentRunCheckpointMetadataSource | undefined): AgentRunCheckpointMetadata | undefined {
  return typeof source === "function" ? source() : source;
}

function checkpointMetadataBytes(metadata: Readonly<Record<string, string>>): number {
  return Buffer.byteLength(JSON.stringify(metadata), "utf8");
}

/**
 * Redact + bound a sidecar metadata map for a checkpoint write. Values must be strings;
 * redaction runs first so a replacement marker is still charged against the 4 KiB ceiling.
 */
export function boundCheckpointMetadata(metadata: AgentRunCheckpointMetadata, redactor?: SecretRedactor): AgentRunCheckpointMetadata {
  const redacted = redactor?.redact(metadata) ?? metadata;
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
    throw new AgentRunStateError("Checkpoint metadata must be an object");
  }
  const bounded: Record<string, string> = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (typeof value !== "string") throw new AgentRunStateError(`Checkpoint metadata value for ${key} must be a string`);
    bounded[key] = value;
  }
  if (checkpointMetadataBytes(bounded) > MAX_AGENT_RUN_METADATA_BYTES) {
    throw new AgentRunStateError(`Checkpoint metadata exceeds ${MAX_AGENT_RUN_METADATA_BYTES} bytes`);
  }
  return Object.freeze(bounded);
}

/**
 * Read-side normalization (legacy tolerance): absent, oversize, or non-string entries are
 * dropped, never thrown — a malformed sidecar must not block a resume.
 */
export function readCheckpointMetadata(metadata: unknown): AgentRunCheckpointMetadata | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const bounded: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") bounded[key] = value;
  }
  if (Object.keys(bounded).length === 0 || checkpointMetadataBytes(bounded) > MAX_AGENT_RUN_METADATA_BYTES) return undefined;
  return Object.freeze(bounded);
}

export async function saveAgentRunState(input: {
  readonly checkpoints: CheckpointStore;
  readonly state: StoredAgentRunState;
  readonly expectedVersion: number;
  readonly ownership?: OwnershipScope;
  readonly fencingToken?: number;
  readonly redactor?: SecretRedactor;
  readonly maxStateBytes?: number;
  readonly metadata?: AgentRunCheckpointMetadata;
}): Promise<{ readonly record: CheckpointRecord; readonly state: StoredAgentRunState }> {
  const bounded = boundState(input.redactor?.redact(input.state) ?? input.state, input.maxStateBytes ?? DEFAULT_MAX_AGENT_RUN_STATE_BYTES);
  const metadata = input.metadata === undefined ? undefined : boundCheckpointMetadata(input.metadata, input.redactor);
  const record = await input.checkpoints.saveCheckpoint({
    namespace: AGENT_RUN_STATE_NAMESPACE,
    key: bounded.runId,
    version: input.expectedVersion + 1,
    expectedVersion: input.expectedVersion,
    fencingToken: input.fencingToken,
    value: bounded,
    category: "agent-run",
    ...(metadata ? { metadata } : {}),
    ...input.ownership,
  });
  return { record, state: { ...bounded, version: record.version } };
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
    toolNames: _toolNames,
    checkpointPolicy: _checkpointPolicy,
    stopReason: _stopReason,
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
  readonly deadlineAt?: string;
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
    ...(input.options.checkpointPolicy === "every-turn" ? { checkpointPolicy: "every-turn" as const } : {}),
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
    !state.counters
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
  if (state.toolNames !== undefined) {
    if (!Array.isArray(state.toolNames) || state.toolNames.length > HARD_RUN_TOOL_NAMES) {
      throw new AgentRunStateError(`Run toolNames exceed ${HARD_RUN_TOOL_NAMES} entries`);
    }
    for (const name of state.toolNames) {
      if (typeof name !== "string" || name.length === 0 || name.length > MAX_PERSISTED_SKILL_NAME_CHARS) {
        throw new AgentRunStateError("Malformed agent run toolNames");
      }
    }
  }
  if (state.checkpointPolicy !== undefined && state.checkpointPolicy !== "every-turn") {
    throw new AgentRunStateError("Malformed agent run checkpoint policy");
  }
  if (state.stopReason !== undefined && state.stopReason !== "host_policy" && state.stopReason !== "hook_limit") {
    throw new AgentRunStateError("Malformed agent run stop reason");
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
  if (names !== undefined) {
    if (!Array.isArray(names) || names.length > MAX_PERSISTED_SKILL_NAMES) {
      throw new AgentRunStateError(`Loaded-skill names exceed ${MAX_PERSISTED_SKILL_NAMES} entries`);
    }
    for (const name of names) {
      if (typeof name !== "string" || name.length > MAX_PERSISTED_SKILL_NAME_CHARS) {
        throw new AgentRunStateError(`Loaded-skill name exceeds ${MAX_PERSISTED_SKILL_NAME_CHARS} chars`);
      }
    }
  }
  const activated = sessionState.activatedToolNames;
  if (activated !== undefined) {
    if (!Array.isArray(activated) || activated.length > MAX_PERSISTED_ACTIVATED_TOOL_NAMES) {
      throw new AgentRunStateError(`Activated-tool names exceed ${MAX_PERSISTED_ACTIVATED_TOOL_NAMES} entries`);
    }
    for (const name of activated) {
      if (typeof name !== "string" || name.length > MAX_PERSISTED_SKILL_NAME_CHARS) {
        throw new AgentRunStateError(`Activated-tool name exceeds ${MAX_PERSISTED_SKILL_NAME_CHARS} chars`);
      }
    }
  }
  const attention = sessionState.attentionSticky;
  // Both arrays are capped by the parser, and a malformed frontier is dropped rather than
  // failing the resume: re-deciding a mutation is safe, refusing to resume is not.
  if (attention !== undefined && parseAttentionStickyFrontier(attention) === undefined) {
    throw new AgentRunStateError("Malformed agent run attention frontier");
  }
  // Plan 086 T3: the fold ledger gets the same treatment — malformed entries are dropped by the
  // parser, a malformed shape fails the load rather than the first provider turn.
  const fold = sessionState.attentionFold;
  if (fold !== undefined && restoreAttentionFoldLedger(fold) === undefined) {
    throw new AgentRunStateError("Malformed agent run attention fold ledger");
  }
  validateGuardrailPackState(sessionState.guardrailPacks);
}

/**
 * Plan 104 T2/T3: bounds for the persisted pack block. Rows replay a registered pack by id/version or
 * an inline pack by its pattern rules, and state may only name those rows — anything else fails the
 * load, because a dropped pack silently re-allows what it existed to deny. Rule data is re-validated
 * (pattern compile, id/reason caps) by the compiler that replays it; this checks the JSON envelope.
 */
function validateGuardrailPackState(value: PersistedGuardrailPacks | undefined): void {
  if (value === undefined) return;
  const raw = value as { readonly packs?: unknown; readonly state?: unknown };
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.packs)) {
    throw new AgentRunStateError("Malformed agent run guardrail pack state");
  }
  if (raw.packs.length > MAX_PERSISTED_GUARDRAIL_PACKS) {
    throw new AgentRunStateError(`Persisted guardrail packs exceed ${MAX_PERSISTED_GUARDRAIL_PACKS} entries`);
  }
  const ids = new Set<string>();
  for (const row of raw.packs) {
    if (!isPlainObject(row)) throw new AgentRunStateError("Malformed agent run guardrail pack row");
    const { id, version, options } = row as { readonly id?: unknown; readonly version?: unknown; readonly options?: unknown };
    if (typeof id !== "string" || !id.trim() || id.length > MAX_PERSISTED_GUARDRAIL_PACK_ID_CHARS) {
      throw new AgentRunStateError(
        `Persisted guardrail pack ids must be non-empty strings of at most ${MAX_PERSISTED_GUARDRAIL_PACK_ID_CHARS} chars`,
      );
    }
    if (ids.has(id)) throw new AgentRunStateError(`Duplicate persisted guardrail pack id "${id}"`);
    ids.add(id);
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
      throw new AgentRunStateError(`Persisted guardrail pack "${id}" version must be a positive integer`);
    }
    if (options !== undefined && !isPlainObject(options)) {
      throw new AgentRunStateError(`Persisted guardrail pack "${id}" options must be an object`);
    }
    if (options !== undefined) boundPackBytes(options, `Pack "${id}" options`);
    validatePersistedPackRules(id, row as { readonly rules?: unknown });
  }
  if (raw.state === undefined) return;
  if (!isPlainObject(raw.state)) throw new AgentRunStateError("Malformed agent run guardrail pack state");
  for (const [id, state] of Object.entries(raw.state as Record<string, unknown>)) {
    if (!ids.has(id)) throw new AgentRunStateError(`Persisted guardrail pack state names unknown pack "${id}"`);
    if (!isPlainObject(state)) throw new AgentRunStateError(`Persisted guardrail pack "${id}" state must be an object`);
    boundPackBytes(state, `Pack "${id}" state`);
  }
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Plan 104 T3: a persisted inline pack must be pattern data — a closure or `RegExp` cannot restore. */
function validatePersistedPackRules(id: string, row: { readonly rules?: unknown }): void {
  if (row.rules === undefined) return;
  if (!Array.isArray(row.rules)) throw new AgentRunStateError(`Persisted guardrail pack "${id}" rules must be an array`);
  if (row.rules.length === 0 || row.rules.length > MAX_PERSISTED_GUARDRAIL_PACK_RULES) {
    throw new AgentRunStateError(`Persisted guardrail pack "${id}" rules must number 1..${MAX_PERSISTED_GUARDRAIL_PACK_RULES}`);
  }
  for (const rule of row.rules) {
    if (!isPlainObject(rule)) throw new AgentRunStateError(`Persisted guardrail pack "${id}" rule must be an object`);
    const { id: ruleId, pattern, deny } = rule as { readonly id?: unknown; readonly pattern?: unknown; readonly deny?: unknown };
    if (typeof ruleId !== "string" || !ruleId.trim() || ruleId.length > MAX_PERSISTED_GUARDRAIL_PACK_ID_CHARS) {
      throw new AgentRunStateError(`Persisted guardrail pack "${id}" rule ids must be non-empty strings`);
    }
    if (deny !== undefined) throw new AgentRunStateError(`Persisted guardrail pack "${id}" rule "${ruleId}" carries a deny predicate`);
    if (pattern !== undefined && typeof pattern !== "string") {
      throw new AgentRunStateError(`Persisted guardrail pack "${id}" rule "${ruleId}" pattern must be a string`);
    }
    boundPackBytes(rule, `Pack "${id}" rule "${ruleId}"`);
  }
}

/** A pack's state must be JSON and under its per-pack ceiling: refuse, never truncate. */
function boundPackBytes(value: unknown, label: string): void {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new AgentRunStateError(`${label} must be JSON serializable`);
  }
  if ((text ? Buffer.byteLength(text) : 0) > MAX_PERSISTED_GUARDRAIL_PACK_BYTES) {
    throw new AgentRunStateError(`${label} exceeds ${MAX_PERSISTED_GUARDRAIL_PACK_BYTES} bytes`);
  }
}
