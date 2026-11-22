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
  if (config.fold || config.attention) claimContextFold(prism);

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
    return createModelSummarize({ client, maxSummaryBytes: config.fold.maxSummaryBytes, session });
  };

  // The session's model with the provider catalog's limits filled in when the host wrote none, so a bare
  // `"provider/model"` ref still has a window (plan 229 Further Actions P2). The kernel caches the catalog
  // per provider; a failed lookup answers the model as given.
  const describedModel = async (session: SessionContext | undefined): Promise<SessionContext["model"]> => {
    const model = session?.model;
    if (!model || model.limits?.contextWindow !== undefined) return model;
    try {
      const client = prism.models.client(model);
      return client.resolve ? await client.resolve() : model;
    } catch {
      return model;
    }
  };

  // The cap depends only on the model's limits, so the memo is keyed by the model, not the session.
  // `warmAttentionCompiler` builds it from the catalog-described model before the handler or the vote
  // reads it; the sync lookup builds from the model as given only when nothing warmed it.
  const buildCompiler = (key: string, model: SessionContext["model"]): AttentionCompiler => {
    const compiler = createAttentionCompiler(config.attention ?? {}, model ? { model } : {});
    compilers.get().set(key, compiler);
    return compiler;
  };
  const attentionCompilerFor = (session: SessionContext): AttentionCompiler => {
    const key = modelKey(session.model);
    return compilers.get().get(key) ?? buildCompiler(key, session.model);
  };
  const warmAttentionCompiler = async (session: SessionContext | undefined): Promise<void> => {
    if (!config.attention || !session) return;
    const key = modelKey(session.model);
    if (compilers.get().has(key)) return;
    const model = await describedModel(session);
    if (!compilers.get().has(key)) buildCompiler(key, model);
  };
  const handler = createContextEngineeringHandler({
    prism,
    config,
    frontierState,
    foldFrontierState,
    foldLog,
    activatedState,
    summarizeFor,
    attentionCompilerFor,
    ...(searchTools ? { searchTools } : {}),
  });

  prism.hooks.on(
    "context.build",
    async (draft, context) => {
      await warmAttentionCompiler(context.session);
      return handler(draft, context);
    },
    { priority: CONTEXT_ENGINEERING_PRIORITY, id: "context-engineering" },
  );

  if (searchTools) prism.tools.register(searchTools.tool);

  prism.hooks.on(
    "model.request",
    async (request, context) => {
      // A package's side call (a fold summary, a compactor's summary) is not the run's request: measuring it against the
      // run's input cap would report a summarizer's bytes as context pressure (plan 225 Task 5).
      if (request.origin?.kind === "package") return undefined;
      const accounted = accountRequest(request, {
        inputCapTokens: inputCapOf(await describedModel(context.session)),
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
    // A session-less call (no compiler to ask) still abstains.
    prism.hooks.on("compaction.when", async (payload, context) => {
      const session = context.session;
      if (!session) return undefined;
      await warmAttentionCompiler(session);
      const compiler = attentionCompilerFor(session);
      const decision = evaluateAttentionTrigger(
        [{ kind: "input_ratio", ratio: compiler.compactRatio }],
        attentionTriggerState(compiler, {
          estimatedInputTokens: payload.estimatedTokens ?? 0,
          ...(payload.turn === undefined ? {} : { turn: payload.turn }),
        }),
      );
      // Below its gate attention vetoes, so the kernel's default trigger (80% of the cap) cannot compact
      // before attention's own `compactRatio` (plan 229 Task 4).
      return { compact: decision.shouldFold };
    });
  }
}

/** The service every compaction system provides (`{ name }`); session memory's is `session-memory`. */
const COMPACTION_SYSTEM_SERVICE = "compaction.system";
/** Provided while `fold` or `attention` is on, so session memory, loaded after this package, can refuse it too. */
const CONTEXT_FOLD_SERVICE = "context.fold";

/**
 * `fold` clears old tool results from requests and `attention` votes on compaction: both shorten the context outside
 * session memory, which must stay the only compaction when a host turns it on (plan 218.3 Task 2). Whichever of the two
 * packages loads second fails agent creation.
 */
function claimContextFold(prism: PackageAPI<ContextEngineeringConfig>): void {
  const system = prism.services.consume<{ readonly name?: string }>(COMPACTION_SYSTEM_SERVICE);
  if (system?.name === "session-memory")
    throw new TypeError(
      "context-engineering fold and attention cannot run beside session memory's compaction; turn them off, or set the memory system's context.compaction: false",
    );
  prism.services.provide(CONTEXT_FOLD_SERVICE, Object.freeze({ name: PACKAGE }));
}

/** The model's input cap; `0` when it declares no window (the share cap then does nothing). */
function inputCapOf(model: SessionContext["model"]): number {
  try {
    return resolveInputCap({}, model);
  } catch {
    return 0;
  }
}

/** A `ModelRef`'s identity for the client memo. */
function refKey(ref: ModelRef | undefined): string | undefined {
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : `${ref.provider}/${ref.model}`;
}
