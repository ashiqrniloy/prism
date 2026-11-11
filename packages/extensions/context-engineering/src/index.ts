/**
 * `@arnilo/prism-extensions/context-engineering` — the four context-engineering stages as one package
 * (roadmap §2.9, plan 158 Task 7).
 *
 * The kernel used to own these as five opt-in `AgentConfig` fields (`contextBudget`,
 * `toolResultFold`, `toolsDisclosure`, `toolsSearch`, `attentionCompiler`). They are one package
 * now: one `context.build` handler composes the configured stages in a fixed order — fold → tool
 * search → attention or budget — at the lowest first-party priority, so a budget sees every block
 * another handler added this turn.
 *
 * Every stage is off unless configured, and a package with no config registers no hook and no tool
 * at all, so the request bytes are exactly what they were without the package.
 *
 * Cost: no model call by default. `fold.summarize: { model }` adds one call per newly folded
 * result (cached per session by tool-call id, so a result is summarized once); `attention` may
 * request compaction through `compaction.when`, and each compaction costs whatever the `compaction`
 * slot owner costs. Tool search adds no model call.
 *
 * ```ts
 * import contextEngineering from "@arnilo/prism-extensions/context-engineering";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "anthropic/claude-sonnet-4-5",
 *   packages: [
 *     contextEngineering({
 *       fold: { minAgeTurns: 2, summarize: "truncate" },
 *       toolSearch: { disclosure: "search", topK: 8 },
 *     }),
 *   ],
 * });
 * ```
 */
import manifest from "../../package.json" with { type: "json" };
import type { JsonObject, JsonValue, ModelClient, ModelRef, PackageAPI, PackageInstance, SessionContext } from "@arnilo/prism";
import { definePackage, resolveInputCap } from "@arnilo/prism";

import { accountRequest } from "./accounting.js";

import { attentionTriggerState, createAttentionCompiler, evaluateAttentionTrigger } from "./attention.js";
import type { AttentionCompiler } from "./attention-types.js";
import {
  type ContextEngineeringConfig,
  contextEngineeringConfigSchema,
  isEmptyContextEngineeringConfig,
  resolveContextEngineeringConfig,
} from "./config.js";
import { createModelSummarize, truncateSummarize, type ToolResultFoldInput } from "./fold.js";
import { CONTEXT_ENGINEERING_PRIORITY, createContextEngineeringHandler } from "./handler.js";
import { createSearchToolsWiring, type MutableToolSearchState, type SearchToolsWiring } from "./search-tools.js";
import {
  ACTIVATED_TOOLS_KEY,
  ATTENTION_STATE_KEY,
  FOLD_FRONTIER_KEY,
  FOLD_LOG_KEY,
  initialAttentionState,
  writeActivatedNames,
  writeFoldFrontier,
} from "./state.js";

const PACKAGE = "@arnilo/prism-extensions/context-engineering";
const COMPILER_MEMO_KEY = "contextEngineering.compilers";
const SEARCH_STATE_MEMO_KEY = "contextEngineering.searchStates";
const CLIENT_MEMO_KEY = "contextEngineering.foldClients";

const definition = definePackage<ContextEngineeringConfig>({
  name: PACKAGE,
  version: manifest.version,
  description: "Input budget, tool-result folding, tool search, and the attention compiler as one fixed-order context.build handler.",
  requires: { api: 1 },
  capabilities: ["models", "session-state"],
  config: contextEngineeringConfigSchema,
  setup(prism) {
    install(prism);
  },
});

/**
 * `contextEngineering(config)` — one agent's stages.
 *
 * With no config the package registers nothing: no `context.build` handler, no tool, no
 * `compaction.when`, and therefore no change to the request bytes or the store.
 */
/** Memo key for a session's model; a model-less agent shares one `none` slot. */
function modelKey(model: SessionContext["model"]): string {
  return model ? `${model.provider}/${model.model}` : "none";
}

export function contextEngineering(config: ContextEngineeringConfig = {}): PackageInstance {
  return definition(config);
}

export default definition;

// The library surface (the four ported stages, the codecs, and the config resolver).
export * from "./exports.js";

function install(prism: PackageAPI<ContextEngineeringConfig>): void {
  const config = resolveContextEngineeringConfig(prism.config);
  if (isEmptyContextEngineeringConfig(config)) return;

  const frontierState = prism.state.session<JsonObject>(ATTENTION_STATE_KEY, initialAttentionState());
  const foldFrontierState = prism.state.session<JsonObject>(FOLD_FRONTIER_KEY, writeFoldFrontier([]));
  const foldLog = prism.state.log<JsonValue>(FOLD_LOG_KEY);
  const activatedState = prism.state.session<JsonObject>(ACTIVATED_TOOLS_KEY, writeActivatedNames([]));
  const compilers = prism.state.agent<Map<string, AttentionCompiler>>(COMPILER_MEMO_KEY, new Map());
  const clients = prism.state.agent<Map<string, ModelClient>>(CLIENT_MEMO_KEY, new Map());
  const searchStates = prism.state.agent<Map<string, MutableToolSearchState>>(SEARCH_STATE_MEMO_KEY, new Map());
  const searchTools: SearchToolsWiring | undefined =
    config.toolSearch?.disclosure === "search" ? createSearchToolsWiring({ activatedState, states: searchStates.get() }) : undefined;

  const summarizeFor = (session: SessionContext): ((input: ToolResultFoldInput) => Promise<string> | string) => {
    if (!config.fold || config.fold.summarize === "truncate") return truncateSummarize;
    const ref = config.fold.summarize.model;
    const key = refKey(ref) ?? modelKey(session.model);
    const memo = clients.get();
    let client = memo.get(key);
    if (!client) {
      client = prism.models.client(ref);
      memo.set(key, client);
    }
    return createModelSummarize({ client, maxSummaryBytes: config.fold.maxSummaryBytes });
  };

  // The cap depends only on the model's limits, so the memo is keyed by the model, not the session.
  const attentionCompilerFor = (session: SessionContext): AttentionCompiler => {
    const key = modelKey(session.model);
    const memo = compilers.get();
    const cached = memo.get(key);
    if (cached) return cached;
    const compiler = createAttentionCompiler(config.attention ?? {}, session.model ? { model: session.model } : {});
    memo.set(key, compiler);
    return compiler;
  };

  prism.hooks.on(
    "context.build",
    createContextEngineeringHandler({
      prism,
      config,
      frontierState,
      foldFrontierState,
      foldLog,
      activatedState,
      summarizeFor,
      attentionCompilerFor,
      ...(searchTools ? { searchTools } : {}),
    }),
    { priority: CONTEXT_ENGINEERING_PRIORITY, id: "context-engineering" },
  );

  if (searchTools) prism.tools.register(searchTools.tool);

  prism.hooks.on(
    "model.request",
    (request, context) => {
      const accounted = accountRequest(request, {
        inputCapTokens: inputCapOf(context.session),
        ...(config.blocks ? { maxShare: config.blocks.maxShare } : {}),
      });
      prism.events.emit("context.accounted", accounted.event as unknown as JsonValue);
      return accounted.request === request ? undefined : accounted.request;
    },
    // Last among default-priority transforms, so the measurement sees the final request bytes.
    { id: "context-engineering-accounting", priority: 1_000 },
  );

  if (config.attention) {
    // Compaction fires past `compactRatio`, the ratio the attention gate folds *below*, so a
    // request the stages cannot settle asks for a new prefix instead of evicting further.
    prism.hooks.on("compaction.when", (payload, context) => {
      const session = context.session;
      if (!session) return undefined;
      const compiler = attentionCompilerFor(session);
      const decision = evaluateAttentionTrigger(
        [{ kind: "input_ratio", ratio: compiler.compactRatio }],
        attentionTriggerState(compiler, {
          estimatedInputTokens: payload.estimatedTokens ?? 0,
          ...(payload.turn === undefined ? {} : { turn: payload.turn }),
        }),
      );
      return decision.shouldFold ? { compact: true } : undefined;
    });
  }
}

/** The model's input cap; `0` when it declares no window (the share cap then does nothing). */
function inputCapOf(session: SessionContext | undefined): number {
  try {
    return resolveInputCap({}, session?.model);
  } catch {
    return 0;
  }
}

/** A `ModelRef`'s identity for the client memo. */
function refKey(ref: ModelRef | undefined): string | undefined {
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : `${ref.provider}/${ref.model}`;
}
