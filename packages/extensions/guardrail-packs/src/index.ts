/**
 * `@arnilo/prism-extensions/guardrail-packs` — the built-in guardrail packs as one package.
 *
 * Restrictive-only packs compile once in `setup`. Tool-call rules (`coding-standard`,
 * `destructive-commands`, `validation-respect`, `secrets-hygiene`) run on the `tool.call` decide seam
 * and can `deny`, `tripwire`, or `ask`. Content rules (`pii`, `output-secrets`, `injection-markers`,
 * or an inline rule with a `stage`) run on `run.input`, `model.response`, and `tool.result` and can
 * `deny`, `redact`, or `flag`. A pack never grants a capability, widens a tool allow-list, or adds
 * content. Pack-owned state lives in package session state, so it survives a resume and forks with
 * the session. A hook is registered only for a stage some configured rule uses.
 *
 * ```ts
 * import guardrailPacks from "@arnilo/prism-extensions/guardrail-packs";
 *
 * packages: [guardrailPacks({ packs: ["destructive-commands", "secrets-hygiene", "injection-markers"] })];
 * ```
 */

import {
  definePackage,
  type HookContext,
  type JsonValue,
  type PackageAPI,
  type ToolCallDecision,
  type ToolCallHookPayload,
  type ToolResult,
} from "@arnilo/prism";
import manifest from "../../package.json" with { type: "json" };
import {
  describeGuardrailPacks,
  GUARDRAIL_PACKS_PACKAGE,
  type GuardrailPackRow,
  guardrailRefusalText,
  observeGuardrail,
  type ResolvedPack,
  resolveGuardrailPacks,
  ruleGuardrail,
  runGuardrailList,
  snapshotPackState,
} from "./compile.js";
import { type GuardrailPacksConfig, guardrailPacksConfigSchema } from "./config.js";
import { DEFAULT_MAX_SCAN_CHARS, installContentStages } from "./content.js";
import { createJudgeRunner } from "./judge.js";

export type { GuardrailPackRow, GuardrailRunResult, ResolvedPack, RunGuardrailListOptions } from "./compile.js";
export {
  describeGuardrailPacks,
  GuardrailError,
  GuardrailPackError,
  guardrailRefusalText,
  observeGuardrail,
  resolveGuardrailPacks,
  ruleGuardrail,
  runGuardrailList,
  snapshotPackState,
} from "./compile.js";
export type { GuardrailPacksConfig } from "./config.js";
export { guardrailPacksConfigSchema } from "./config.js";
export type { ContentAction, ContentHit, ContentRule, ContentScanResult, ContentStage } from "./content.js";
export { applyContentRules, DEFAULT_MAX_SCAN_CHARS, GUARDRAIL_CONTENT_PRIORITY } from "./content.js";
export type { GuardrailPackInput, GuardrailPackRef, GuardrailRule, GuardrailRuleAction, GuardrailRuleStage } from "./contracts.js";
export type { ContentDetector } from "./detectors/index.js";
export { CONTENT_DETECTOR_IDS, CONTENT_DETECTORS, luhnValid } from "./detectors/index.js";
export type {
  GuardrailJudge,
  JudgeErrorKind,
  JudgeVerdict,
  ResolvedJudge,
} from "./judge.js";
export {
  DEFAULT_JUDGE_MAX_INPUT_CHARS,
  DEFAULT_JUDGE_THRESHOLD,
  DEFAULT_JUDGE_TIMEOUT_MS,
  JUDGE_INSTRUCTION,
  MAX_JUDGE_CACHE_ENTRIES_PER_RUN,
} from "./judge.js";
export { codingStandardPack } from "./packs/coding-standard.js";
export { destructiveCommandsPack } from "./packs/destructive-commands.js";
export { BUILT_IN_GUARDRAIL_PACK_IDS, BUILT_IN_GUARDRAIL_PACKS } from "./packs/index.js";
export { injectionMarkersPack } from "./packs/injection-markers.js";
export { outputSecretsPack } from "./packs/output-secrets.js";
export { piiPack } from "./packs/pii.js";
export { secretsHygienePack } from "./packs/secrets-hygiene.js";
export type { GuardrailPackDefinition, GuardrailPackRules } from "./packs/types.js";
export { validationRespectPack } from "./packs/validation-respect.js";

const PACKAGE = "@arnilo/prism-extensions/guardrail-packs";

/** The service name another package consumes for the enforced rows (replaces the retired run-bundle rows). */
export const GUARDRAIL_PACKS_DESCRIBE_SERVICE = "guardrail-packs.describe";

/** The rows a `guardrail-packs:describe` call returns. */
export interface GuardrailPacksDescribeResult {
  readonly rows: readonly GuardrailPackRow[];
}

/**
 * Rebuild each pack's live state from the session's persisted snapshot. A pack that has persisted
 * state but declares no codec, or a snapshot the codec refuses, fails closed (the caller's hook
 * throws; a `tool.call` throw is a deny, a `tool.result` throw rejects the run).
 */
function readPackState(packs: readonly ResolvedPack[], persisted: JsonValue | undefined): Map<string, Record<string, unknown>> {
  const map = persisted && typeof persisted === "object" && !Array.isArray(persisted) ? (persisted as Record<string, unknown>) : {};
  const state = new Map<string, Record<string, unknown>>();
  for (const pack of packs) {
    const value = map[pack.id];
    if (value === undefined) {
      state.set(pack.id, {});
      continue;
    }
    if (!pack.stateCodec) throw new Error(`guardrail pack "${pack.id}" has persisted state but declares no state codec`);
    state.set(pack.id, pack.stateCodec.parse(value));
  }
  return state;
}

function packGuardrails(packs: readonly ResolvedPack[], state: Map<string, Record<string, unknown>>) {
  return packs.flatMap((pack) => pack.rules.map((rule) => ruleGuardrail(pack, rule, state.get(pack.id) ?? {})));
}

function observeGuardrails(packs: readonly ResolvedPack[], state: Map<string, Record<string, unknown>>) {
  return packs.flatMap((pack) => (pack.observe ? [observeGuardrail(pack, pack.observe, state.get(pack.id) ?? {})] : []));
}

function install(prism: PackageAPI<GuardrailPacksConfig>, resolved: readonly ResolvedPack[], rows: readonly GuardrailPackRow[]): void {
  prism.services.provide<() => readonly GuardrailPackRow[]>(GUARDRAIL_PACKS_DESCRIBE_SERVICE, () => rows);
  prism.commands.register({
    name: "guardrail-packs:describe",
    description: "List the guardrail-pack rules this agent enforces",
    args: { type: "object", properties: {}, additionalProperties: false },
    run: () => ({ rows }) satisfies GuardrailPacksDescribeResult,
  });
  if (resolved.length === 0) return;

  const contentRules = resolved.flatMap((pack) => pack.contentRules);
  const judgeModels = contentRules.flatMap((rule) => (rule.judge ? [rule.judge.model] : []));
  installContentStages(prism as PackageAPI<unknown>, {
    rules: contentRules,
    // Clients are made now, so an instance without `models` fails `setup` closed.
    ...(judgeModels.length > 0 ? { judge: createJudgeRunner((prism as PackageAPI<unknown>).models, judgeModels) } : {}),
    versions: new Map(resolved.map((pack) => [pack.id, pack.version])),
    maxScanChars: prism.config.maxScanChars ?? DEFAULT_MAX_SCAN_CHARS,
  });

  const hasToolCallRules = resolved.some((pack) => pack.rules.length > 0);
  const hasObservers = resolved.some((pack) => pack.observe !== undefined);
  if (!hasToolCallRules && !hasObservers) return;

  // One `set` per observer change, never per call. The session's branch is the source of truth.
  const packsState = prism.state.session<JsonValue>("packs", {});

  if (hasToolCallRules)
    prism.hooks.on("tool.call", async (payload: ToolCallHookPayload, context: HookContext): Promise<ToolCallDecision | undefined> => {
      const session = context.session;
      if (!session) return undefined;
      const state = readPackState(resolved, packsState.get(session));
      const guards = packGuardrails(resolved, state);
      if (guards.length === 0) return undefined;
      const result = await runGuardrailList({
        stage: "tool_input",
        guards,
        value: { type: "tool_call", id: payload.callId, name: payload.name, arguments: payload.args },
        context: {
          sessionId: payload.sessionId,
          runId: payload.runId,
          toolCallId: payload.callId,
          toolName: payload.name,
          metadata: {},
          signal: context.signal,
        },
        emit: (event) => {
          if (event.type === "package.event") context.emit(event.name, event.data ?? null);
        },
        package: GUARDRAIL_PACKS_PACKAGE,
      });
      const terminal = result.terminal;
      if (!terminal) return undefined;
      if (terminal.action === "interrupt") {
        return { ask: guardrailRefusalText(terminal, "Approval required") ?? "Approval required by guardrail rule" };
      }
      return { deny: guardrailRefusalText(terminal) ?? "Tool call blocked by guardrail" };
    });

  if (!hasObservers) return;
  prism.hooks.on(
    "tool.result",
    async (result: ToolResult & { readonly sessionId?: string; readonly runId?: string }, context: HookContext) => {
      const session = context.session;
      if (!session) return undefined;
      const persisted = packsState.get(session);
      const state = readPackState(resolved, persisted);
      const guards = observeGuardrails(resolved, state);
      if (guards.length === 0) return undefined;
      await runGuardrailList({
        stage: "tool_output",
        guards,
        value: result,
        context: {
          sessionId: result.sessionId ?? context.sessionId,
          runId: result.runId ?? context.runId,
          toolCallId: result.toolCallId,
          toolName: result.name,
          metadata: {},
          signal: context.signal,
        },
        emit: (event) => {
          if (event.type === "package.event") context.emit(event.name, event.data ?? null);
        },
        package: GUARDRAIL_PACKS_PACKAGE,
      });
      const snapshot = snapshotPackState(resolved, state);
      if (JSON.stringify(snapshot ?? {}) !== JSON.stringify(persisted ?? {})) await packsState.set(session, (snapshot ?? {}) as JsonValue);
      return undefined;
    },
  );
}

/** Whether any inline rule asks a model. Built-in packs never do. */
export function hasJudgeRule(config: GuardrailPacksConfig): boolean {
  return (config.packs ?? []).some(
    (pack) => typeof pack === "object" && pack !== null && (pack.rules ?? []).some((rule) => rule?.judge !== undefined),
  );
}

function createDefinition() {
  return definePackage<GuardrailPacksConfig>({
    name: PACKAGE,
    version: manifest.version,
    description: "Built-in guardrail packs: restrictive-only rules over tool calls, run input, model output, and tool results.",
    requires: { api: 2 },
    // `models` only for an instance with a judge rule (plan 237 Task 3).
    capabilities: ["session-state", "models"],
    capabilitiesFor: (config) => (hasJudgeRule(config) ? ["session-state", "models"] : ["session-state"]),
    config: guardrailPacksConfigSchema,
    setup(prism) {
      // Validate and compile once, so an unknown id, a duplicate rule id, or an invalid pattern
      // fails `createAgent` closed with a `GuardrailPackError`.
      const resolved = resolveGuardrailPacks(prism.config.packs);
      install(prism, resolved, describeGuardrailPacks(prism.config.packs));
    },
  });
}

const definition = createDefinition();

/** Bare definition: schema defaults, no packs. `guardrailPacks({ packs })` is an instance of it. */
export default definition;
