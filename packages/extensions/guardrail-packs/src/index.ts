/**
 * `@arnilo/prism-extensions/guardrail-packs` — the built-in guardrail packs as one package.
 *
 * Four restrictive-only packs (`coding-standard`, `destructive-commands`, `validation-respect`,
 * `secrets-hygiene`) compile once in `setup` onto the kernel's `tool.call` decide seam and
 * `tool.result` transform seam. A pack can only `deny`, `tripwire`, or `ask`; it never grants a
 * capability or widens a tool allow-list. Pack-owned state lives in package session state, so it
 * survives a resume and forks with the session.
 *
 * ```ts
 * import guardrailPacks from "@arnilo/prism-extensions/guardrail-packs";
 *
 * packages: [guardrailPacks({ packs: ["destructive-commands", "secrets-hygiene"] })];
 * ```
 */
import manifest from "../../package.json" with { type: "json" };
import {
  definePackage,
  type HookContext,
  type JsonValue,
  type PackageAPI,
  type ToolCallDecision,
  type ToolCallHookPayload,
  type ToolResult,
} from "@arnilo/prism";
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
export { codingStandardPack } from "./packs/coding-standard.js";
export { destructiveCommandsPack } from "./packs/destructive-commands.js";
export { BUILT_IN_GUARDRAIL_PACK_IDS, BUILT_IN_GUARDRAIL_PACKS } from "./packs/index.js";
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

  // One `set` per observer change, never per call. The session's branch is the source of truth.
  const packsState = prism.state.session<JsonValue>("packs", {});

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

function createDefinition() {
  return definePackage<GuardrailPacksConfig>({
    name: PACKAGE,
    version: manifest.version,
    description: "Built-in guardrail packs: restrictive-only rules over tool.call and tool.result.",
    requires: { api: 1 },
    capabilities: ["session-state"],
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
