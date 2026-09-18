import { createHash } from "node:crypto";
import { agentFingerprint, BUILT_IN_LOOP_REVISIONS } from "./agent-run-state.js";
import type { Agent, AgentSessionConfig, GuardrailStage, Guardrails, RunOptions, ToolDefinition } from "./contracts.js";
import { describeStorage } from "./host-composition.js";
import { canonicalizeJsonSchema } from "./providers/schema.js";
import type { SecretRedactor } from "./redaction.js";
import { resolveRunLimits } from "./run-limits.js";
import { selectRunTools } from "./tools.js";

/** Report format revision. Any shape change bumps this so pinned digests cannot compare across formats. */
export const RUN_BUNDLE_SCHEMA_VERSION = 1;

/** Bounded by construction; a bundle larger than this is a host bug, not a snapshot to retain. */
const MAX_RUN_BUNDLE_BYTES = 512 * 1024;

/** Inspectable projection of the inputs a run actually resolves to. Frozen JSON, safe to persist and diff. */
export interface RunBundleSnapshot {
  readonly schemaVersion: number;
  /** `sha256:<64 hex>` over the canonicalized, redacted snapshot (this field excluded). */
  readonly digest: string;
  /** `agentFingerprint()` of the same agent/revision: the durable-resume identity behind this snapshot. */
  readonly fingerprint: string;
  readonly agent: { readonly id: string; readonly definitionRevision: string | null };
  readonly systemPrompt: {
    readonly disabled: boolean;
    /** Digest of `AgentConfig.instructions`; the body never leaves the process. */
    readonly instructionsDigest: string | null;
    readonly contributions: readonly {
      readonly id: string;
      readonly mode: string | null;
      readonly source: string | null;
      readonly digest: string;
    }[];
  };
  readonly skills: readonly {
    readonly name: string;
    readonly instructionsDigest: string | null;
    readonly toolNames: readonly string[];
  }[];
  /** Effective tool set: `run.toolNames` narrowing already applied, schemas reduced to digests. */
  readonly tools: readonly {
    readonly name: string;
    readonly schemaDigest: string;
    readonly exclusive: boolean;
    readonly effect: string | null;
  }[];
  readonly activeSkills: readonly string[] | null;
  readonly guardrails: readonly {
    readonly name: string;
    readonly stage: GuardrailStage;
    readonly revision: string | null;
  }[];
  readonly loop: { readonly strategy: string; readonly revision: string | null };
  readonly thinkingLevel: string | null;
  readonly limits: Readonly<import("./contracts.js").ResolvedRunLimits>;
  /** Host-shaped JSON as configured (`true`/`false`/options); `null` when unset. */
  readonly attentionCompiler: unknown;
  readonly model: { readonly provider: string | null; readonly model: string | null };
  readonly requestPolicies: readonly string[];
  /** Kinds only — never a connection string, path, or credential. */
  readonly storage: {
    readonly sessionStore: { readonly kind: string; readonly durable: boolean };
    readonly checkpoints: { readonly kind: string; readonly durable: boolean };
    readonly effectStore: { readonly kind: string; readonly durable: boolean };
    readonly memory: { readonly kind: string; readonly durable: boolean };
  };
}

export interface RunBundleSnapshotInput {
  readonly agent: Agent;
  /** Session-level inputs (store, leaf, cache TTL) that change what the run reads and writes. */
  readonly config?: AgentSessionConfig;
  readonly run?: RunOptions;
  /** Optional memory store instance; only its kind/durability label is read, never its contents. */
  readonly memory?: unknown;
}

/**
 * Snapshots the effective run bundle: synchronous, in-memory, zero network and zero store reads.
 * The counterpart of `agentFingerprint` for humans — same inputs, named fields, one stable digest to pin.
 */
export function snapshotRunBundle(input: RunBundleSnapshotInput): RunBundleSnapshot {
  const config = input.agent.config;
  const run = input.run;
  const redactor = run?.redactor ?? config.redactor;
  const definitionRevision = run?.runState?.definitionRevision ?? config.runState?.definitionRevision ?? null;

  const tools = selectRunTools(listTools(config.tools), run?.toolNames).tools;
  const skills = listSkills(config.skills, run?.skills);
  const model = run?.model ?? config.model;
  const effectiveLoop = run?.loop ?? config.loop;
  const systemPrompt = run?.systemPrompt ?? config.systemPrompt;
  const policies = run?.providerRequestPolicies ?? config.providerRequestPolicies;

  const snapshot: Omit<RunBundleSnapshot, "digest"> = {
    schemaVersion: RUN_BUNDLE_SCHEMA_VERSION,
    fingerprint: agentFingerprint(input.agent, definitionRevision ?? ""),
    agent: { id: agentId(input.agent), definitionRevision },
    systemPrompt: {
      disabled: systemPrompt === false,
      instructionsDigest: hashText(config.instructions),
      contributions:
        systemPrompt === false || systemPrompt === undefined
          ? []
          : (Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt]).map((contribution) => ({
              id: contribution.id,
              mode: contribution.mode ?? null,
              source: contribution.source ?? null,
              digest: hashText(contribution.text) ?? "",
            })),
    },
    skills: skills.map((skill) => ({
      name: skill.name,
      instructionsDigest: hashText(skill.instructions),
      toolNames: skill.toolNames ?? [],
    })),
    tools: tools.map((tool) => ({
      name: tool.name,
      schemaDigest: hashJson(canonicalizeJsonSchema(tool.parameters ?? { type: "object" })) as string,
      exclusive: tool.exclusive === true,
      effect: tool.effect === undefined ? null : typeof tool.effect === "function" ? "classifier" : tool.effect.kind,
    })),
    activeSkills: run?.activeSkills ?? null,
    guardrails: guardrailRows(config.guardrails, run?.guardrails),
    loop: loopIdentity(effectiveLoop),
    thinkingLevel: run?.thinkingLevel ?? config.thinkingLevel ?? null,
    limits: resolveRunLimits(config.limits, run?.limits),
    attentionCompiler: run?.attentionCompiler ?? config.attentionCompiler ?? null,
    model: {
      provider: typeof model === "string" ? (config.provider?.id ?? null) : (model?.provider ?? null),
      model: typeof model === "string" ? model : (model?.model ?? null),
    },
    requestPolicies: policies === undefined ? [] : (Array.isArray(policies) ? policies : [policies]).map((policy) => policy.name),
    storage: {
      sessionStore: kindOf(describeStorage(input.config?.store ?? config.store, undefined)),
      checkpoints: kindOf(describeStorage(undefined, (run?.runState ?? config.runState)?.checkpoints)),
      effectStore: kindOf(describeStorage(run?.effectStore ?? config.effectStore, undefined)),
      memory: kindOf(describeStorage(input.memory, undefined)),
    },
  };

  const redacted = redactStrings(snapshot, redactor) as Omit<RunBundleSnapshot, "digest">;
  const bundle: RunBundleSnapshot = deepFreeze({ ...redacted, digest: hashJson(canonicalizeJsonSchema(redacted)) as string });
  const bytes = Buffer.byteLength(JSON.stringify(bundle), "utf8");
  if (bytes > MAX_RUN_BUNDLE_BYTES) {
    throw new TypeError(`Run bundle snapshot exceeds ${MAX_RUN_BUNDLE_BYTES} bytes`);
  }
  return bundle;
}

/** Keeps a store label a label: a declared `kind` that is really a connection string or path becomes `custom`. */
function kindOf(described: { readonly kind: string; readonly durable: boolean }): { readonly kind: string; readonly durable: boolean } {
  const raw = described.kind.toLowerCase();
  return { kind: /^[a-z0-9_.-]{1,64}$/.test(raw) ? raw : "custom", durable: described.durable };
}

function agentId(agent: Agent): string {
  return agent.config.id ?? agent.config.name ?? "agent";
}

function listTools(tools: Agent["config"]["tools"]): readonly ToolDefinition[] {
  if (!tools) return [];
  return "list" in tools ? tools.list() : tools;
}

function listSkills(
  skills: Agent["config"]["skills"],
  runSkills: RunOptions["skills"],
): readonly { readonly name: string; readonly instructions?: string; readonly toolNames?: readonly string[] }[] {
  const listed = !skills ? [] : "list" in skills ? skills.list() : skills;
  const byName = new Map(listed.map((skill) => [skill.name, skill]));
  for (const skill of runSkills ?? []) byName.set(skill.name, skill);
  return [...byName.values()];
}

function guardrailRows(
  configGuardrails: Guardrails | undefined,
  runGuardrails: Guardrails | undefined,
): readonly { readonly name: string; readonly stage: GuardrailStage; readonly revision: string | null }[] {
  const rows: { name: string; stage: GuardrailStage; revision: string | null }[] = [];
  for (const guardrails of [configGuardrails, runGuardrails]) {
    if (!guardrails) continue;
    for (const stage of ["input", "output", "tool_input", "tool_output"] as const) {
      const key = stage === "tool_input" ? "toolInput" : stage === "tool_output" ? "toolOutput" : stage;
      for (const guardrail of guardrails[key] ?? []) {
        rows.push({ name: guardrail.name, stage, revision: guardrail.revision ?? null });
      }
    }
  }
  return rows;
}

function loopIdentity(loop: RunOptions["loop"]): { readonly strategy: string; readonly revision: string | null } {
  if (typeof loop === "object" && loop && "strategy" in loop) {
    return { strategy: loop.strategy, revision: BUILT_IN_LOOP_REVISIONS[loop.strategy] ?? null };
  }
  return {
    strategy: loop?.name ?? "single-shot",
    revision: loop?.revision ?? BUILT_IN_LOOP_REVISIONS["single-shot"] ?? null,
  };
}

/** `sha256:<64 hex>` over UTF-8 text — the same convention as `hashPromptBody` in `@arnilo/prism-core`. */
function hashText(text: string | undefined): string | null {
  if (text === undefined) return null;
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

/** Redacts every string field so a pinned snapshot can never carry a secret. */
function redactStrings(value: unknown, redactor: SecretRedactor | undefined): unknown {
  if (typeof value === "string") return redactor ? redactor.redact(value) : value;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, redactor));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactStrings(item, redactor)]));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
