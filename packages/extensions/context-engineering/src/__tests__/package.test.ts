/**
 * `@arnilo/prism-extensions/context-engineering` package tests (plan 158 Task 7).
 *
 * The four stages used to be five opt-in kernel fields. These cases prove the package shape: nothing
 * registered without config, a budget that sees blocks another handler added, a fail-closed mandatory
 * prefix, a view-only fold, one summary call per result, a tool search that cannot see a hidden tool,
 * an attention gate that asks for compaction, the mutually-exclusive pair rejected at load, and the
 * handler applying under the conformance custom loop.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  type AgentEvent,
  type ContextDraft,
  type JsonObject,
  type JsonValue,
  type ModelProvider,
  type PackageAPI,
  type PackageInstance,
  type ProviderEvent,
  type ProviderRequest,
  type SessionContext,
  type ToolDefinition,
  createAgent,
  definePackage,
} from "@arnilo/prism";
import {
  createMockProvider,
  mockProvider,
  packageConformance,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import { providerPackage } from "@arnilo/prism/provider-kit";

import contextEngineering, {
  type ContextEngineeringConfig,
  type ContextEngineeringHandlerDeps,
  createContextEngineeringHandler,
  resolveContextEngineeringConfig,
  truncateSummarize,
} from "../index.js";

const PACKAGE = "@arnilo/prism-extensions/context-engineering";
const reply = (text = "ok"): readonly ProviderEvent[] => [providerTextDelta(text), providerDone()];

/** A tool whose result is large enough to fold. */
function bigTool(): ToolDefinition {
  return {
    name: "big_read",
    description: "Read a large document. BIG-SENTINEL",
    effects: ["read"],
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: (_args, context) => ({
      toolCallId: context.toolCallId,
      name: "big_read",
      value: { text: `${"x".repeat(20_000)} PAYLOAD-SENTINEL` },
    }),
  };
}

/** A package that adds one large context block, the way a retrieval package would. */
function blockPackage(sentinel: string, chars: number): PackageInstance {
  return definePackage({
    name: "@acme/blocks",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("context.build", (draft: ContextDraft) => ({
        ...draft,
        context: [...(draft.context ?? []), { id: "acme", title: "Retrieved", content: `${sentinel} ${"x".repeat(chars)}` }],
      }));
    },
  })();
}

/** A package that registers a tool the kernel hides for every session. */
function hiddenToolPackage(): PackageInstance {
  return definePackage({
    name: "@acme/hidden",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.tools.register(
        {
          name: "hidden_tool",
          description: "HIDDEN-SENTINEL tool that must never be offered or found",
          effects: ["read"],
          parameters: { type: "object", properties: {}, additionalProperties: false },
          execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "hidden_tool", value: { ok: true } }),
        },
        { when: () => false },
      );
    },
  })();
}

interface HarnessOptions {
  readonly config?: ContextEngineeringConfig;
  readonly script?: readonly (readonly ProviderEvent[])[];
  readonly extraPackages?: readonly PackageInstance[];
  readonly tools?: readonly ToolDefinition[];
  readonly systemPrompt?: { readonly id: string; readonly mode: "replace"; readonly text: string };
  /** Package events reach observe hooks, the way a host sees them. */
  readonly events?: AgentEvent[];
  /** Host compaction options, so a test can prove which vote wins against the kernel fallback. */
  readonly compaction?: { readonly thresholdEntries?: number };
  /** The session model's declared window, so the kernel's default compaction trigger can resolve a cap. */
  readonly limits?: { readonly contextWindow: number; readonly maxOutputTokens: number };
}

async function harness(options: HarnessOptions = {}) {
  const requests: ProviderRequest[] = [];
  const provider = mockProvider(options.script ?? [reply()], { onRequest: (request) => requests.push(request) });
  const agent = await createAgent({
    model: { provider: "mock", model: "main", ...(options.limits ? { limits: options.limits } : {}) },
    packages: [provider, contextEngineering(options.config ?? {}), ...(options.extraPackages ?? [])],
    ...(options.tools?.length ? { tools: { add: [...options.tools] } } : {}),
    ...(options.compaction ? { compaction: options.compaction } : {}),
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(options.events
      ? {
          hooks: (hooks: { on: (name: "package.event", handler: (payload: unknown) => void) => void }) =>
            hooks.on("package.event", (payload) => options.events!.push(payload as AgentEvent)),
        }
      : {}),
  });
  return { agent, requests };
}

/** In-memory handler deps, for the legs that drive the handler without a package load. */
function handlerDeps(
  config: ContextEngineeringConfig,
  overrides: Partial<ContextEngineeringHandlerDeps> = {},
): ContextEngineeringHandlerDeps {
  const values = new Map<string, JsonValue>();
  const logs = new Map<string, JsonValue[]>();
  const events: AgentEvent[] = [];
  const prism = {
    events: {
      emit: (name: string, data: JsonValue) =>
        void events.push({ type: "package.event", sessionId: "", runId: "", name, data } as unknown as AgentEvent),
    },
  } as unknown as PackageAPI<ContextEngineeringConfig>;
  return {
    prism,
    config: resolveContextEngineeringConfig(config),
    frontierState: {
      get: (session: SessionContext) => (values.get(session.id) ?? {}) as JsonObject,
      set: async (session: SessionContext, value: JsonObject) => void values.set(session.id, value),
    },
    foldFrontierState: {
      get: (session: SessionContext) => (values.get(`foldFrontier:${session.id}`) ?? {}) as JsonObject,
      set: async (session: SessionContext, value: JsonObject) => void values.set(`foldFrontier:${session.id}`, value),
    },
    foldLog: {
      entries: (session: SessionContext) => logs.get(session.id) ?? [],
      append: async (session: SessionContext, value: JsonValue) =>
        void (logs.get(session.id) ?? logs.set(session.id, []).get(session.id))!.push(value),
    },
    activatedState: {
      get: (session: SessionContext) => (values.get(`tools:${session.id}`) ?? {}) as JsonObject,
      set: async (session: SessionContext, value: JsonObject) => void values.set(`tools:${session.id}`, value),
    },
    summarizeFor: () => truncateSummarize,
    attentionCompilerFor: () => {
      throw new Error("attention is not configured in this leg");
    },
    ...overrides,
  };
}

describe("@arnilo/prism-extensions/context-engineering package (plan 158 Task 7)", () => {
  it("context_engineering_package_conformance", async () => {
    const result = await packageConformance(
      contextEngineering({
        fold: { summarize: "truncate" },
        toolSearch: { disclosure: "search", topK: 4 },
        budget: { maxInputTokens: 1_000 },
      }),
      { mockProvider: createMockProvider(reply()) },
    );
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  });

  it("context_engineering_no_config_registers_nothing", async () => {
    const { agent, requests } = await harness({ config: {}, script: [reply("plain")] });
    const inspection = agent.inspect();

    assert.deepEqual(
      (inspection.hooks["context.build"] ?? []).filter((hook) => hook.owner === PACKAGE),
      [],
      "no context.build handler is registered",
    );
    assert.deepEqual(
      (inspection.hooks["compaction.when"] ?? []).filter((hook) => hook.owner === PACKAGE),
      [],
      "no compaction.when handler is registered",
    );
    assert.deepEqual(
      inspection.tools.filter((tool) => tool.name === "search_tools"),
      [],
      "search_tools is not registered",
    );

    const session = await agent.session({ id: "s1", create: true });
    await session.run("hi");
    assert.equal(requests.length, 1, "the run made exactly one provider call");
    await agent.dispose();
  });

  it("context_engineering_budget_sees_handler_blocks", async () => {
    const events: AgentEvent[] = [];
    const { agent, requests } = await harness({
      config: { budget: { maxInputTokens: 5_000, reportOmissions: true } },
      extraPackages: [blockPackage("BLOCK-SENTINEL", 200_000)],
      events,
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("go");

    const sent = JSON.stringify(requests.at(-1)?.messages ?? []);
    assert.equal(sent.includes("BLOCK-SENTINEL"), false, "the budget dropped the block another handler added");
    const omissions = events.filter((event) => event.type === "package.event" && (event as { name?: string }).name === "context.omissions");
    assert.equal(omissions.length, 1, "one context.omissions event");
    const data = (omissions[0] as unknown as { data: { omitted: readonly { kind: string }[] } }).data;
    assert.ok(
      data.omitted.some((omission) => omission.kind === "context"),
      "the report names the dropped context block",
    );
    await agent.dispose();
  });

  it("context_engineering_budget_mandatory_prefix_rejects", async () => {
    const { agent } = await harness({
      config: { budget: { maxInputTokens: 100 } },
      systemPrompt: { id: "policy", mode: "replace", text: "policy ".repeat(1_000) },
    });
    const session = await agent.session({ id: "s1", create: true });

    // The loop reports a rejected transform as a failed run; the error names the package and the
    // hook, so a host can tell who refused.
    const result = await session.run("this cannot fit");
    assert.equal(result.status, "failed", "the run fails closed");
    assert.equal(result.error?.name, "HookRejectedError");
    assert.equal(result.error?.owner, PACKAGE);
    assert.equal(result.error?.hook, "context.build");
    assert.ok(result.error?.message.includes("context budget exceeded: mandatory prefix cannot fit"), "the 0.12 message is preserved");
    await agent.dispose();
  });

  it("context_engineering_fold_view_only", async () => {
    const { agent, requests } = await harness({
      config: { fold: { minAgeTurns: 1, minBytes: 100, maxSummaryBytes: 128, summarize: "truncate" } },
      tools: [bigTool()],
      script: [[providerToolCall(toolCallContent("c1", "big_read", {})), providerDone()], reply("done")],
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("read it");
    await session.run("and again");

    const sent = JSON.stringify(requests.at(-1)?.messages ?? []);
    assert.ok(sent.includes("[folded: big_read [c1],"), "the provider view carries the folded stub");
    assert.equal(sent.includes("PAYLOAD-SENTINEL"), false, "the payload left the provider view");

    const stored = JSON.stringify(await session.messages());
    assert.ok(stored.includes("PAYLOAD-SENTINEL"), "the store kept the full tool result");
    await agent.dispose();
  });

  it("context_engineering_fold_model_called_once_per_result", async () => {
    const requests: ProviderRequest[] = [];
    const provider = mockProvider(
      [[providerToolCall(toolCallContent("c1", "big_read", {})), providerDone()], reply("SUMMARY"), reply("two"), reply("three")],
      { onRequest: (request) => requests.push(request) },
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [
        provider,
        contextEngineering({
          fold: { minAgeTurns: 1, minBytes: 1, maxSummaryBytes: 64, summarize: { model: "mock/summarizer" } },
        }),
      ],
      tools: { add: [bigTool()] },
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("read it");
    await session.run("again");
    await session.run("and again");

    const summaries = requests.filter((request) => request.model.model === "summarizer");
    assert.equal(summaries.length, 1, "one summary call for the folded result, cached by tool-call id");
    assert.equal(requests.filter((request) => request.model.model === "main").length, 4, "the runs stay on the session model");
    await agent.dispose();
  });

  it("context_engineering_tool_search_respects_when", async () => {
    const { agent, requests } = await harness({
      config: { toolSearch: { disclosure: "search", topK: 8 } },
      extraPackages: [hiddenToolPackage()],
      tools: [bigTool()],
      script: [[providerToolCall(toolCallContent("c1", "search_tools", { query: "hidden sentinel tool" })), providerDone()], reply("done")],
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("find a tool");

    const offered = (requests[0]?.tools ?? []).map((tool) => tool.name);
    assert.equal(offered.includes("hidden_tool"), false, "a when-hidden tool is never offered");
    assert.equal(offered.includes("search_tools"), true, "search_tools stays offered so activation can work");

    const sent = JSON.stringify(requests.at(-1)?.messages ?? []);
    assert.equal(sent.includes("hidden_tool"), false, "search_tools cannot return a tool the kernel hid");
    await agent.dispose();
  });

  it("context_engineering_attention_requests_compaction", async () => {
    const { agent } = await harness({
      config: { attention: { maxInputTokens: 10_000, triggerRatio: 0.8, compactRatio: 0.9 } },
      script: [reply("first"), reply("summary"), reply("second")],
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("y".repeat(40_000));

    const kinds = (await session.entries()).map((entry) => entry.kind);
    assert.equal(kinds.includes("compaction"), true, "the attention gate asked for compaction past compactRatio");
    await agent.dispose();
  });

  it("attention_below_its_gate_vetoes_the_kernel_default", async () => {
    // Plan 229 Task 4: below `compactRatio` attention votes `false`, so the kernel's default trigger
    // (80% of the cap) cannot compact before attention's own 0.9 gate. Both caps are 10,000 tokens:
    // the model's window is 10,000 + the kernel's 1,024 default reserve.
    const config = { attention: { maxInputTokens: 10_000, triggerRatio: 0.8, compactRatio: 0.9 } };
    const limits = { contextWindow: 11_024, maxOutputTokens: 0 };
    const between = "y".repeat(34_000); // ~8,500 estimated tokens: past 0.8, under 0.9

    const { agent } = await harness({ config, limits, script: [reply("first"), reply("summary"), reply("second")] });
    const session = await agent.session({ id: "s1", create: true });
    await session.run(between);
    assert.equal(
      (await session.entries()).some((entry) => entry.kind === "compaction"),
      false,
      "attention vetoes the kernel default below its gate",
    );
    await agent.dispose();

    // The same branch without attention: the kernel default fires.
    const plain = await createAgent({
      model: { provider: "mock", model: "main", limits },
      packages: [mockProvider([reply("first"), reply("summary"), reply("second")])],
    });
    const plainSession = await plain.session({ id: "s2", create: true });
    await plainSession.run(between);
    assert.equal(
      (await plainSession.entries()).some((entry) => entry.kind === "compaction"),
      true,
      "the kernel default fires at the same size",
    );
    await plain.dispose();
  });

  it("attention_resolves_cap_from_provider_catalog", async () => {
    // Plan 229 Further Actions P2: with a bare `"provider/model"` ref and no `maxInputTokens`, the
    // attention compiler reads the window from the provider catalog. Cap: 11,024 - 1,024 reserve = 10,000.
    let reads = 0;
    let turn = 0;
    const script = [reply("first"), reply("summary"), reply("second")];
    const provider: ModelProvider = {
      id: "mock",
      models: async () => {
        reads += 1;
        return [{ provider: "mock", model: "main", limits: { contextWindow: 11_024, maxOutputTokens: 0 } }];
      },
      generate: (request) => createMockProvider(script[Math.min(turn++, script.length - 1)] ?? []).generate(request),
    };
    const agent = await createAgent({
      model: "mock/main",
      packages: [providerPackage("mock-catalog", [provider]), contextEngineering({ attention: { triggerRatio: 0.8, compactRatio: 0.9 } })],
    });
    assert.equal(reads, 0, "createAgent never reads the catalog");
    const session = await agent.session({ id: "s1", create: true });
    await session.run("y".repeat(40_000));

    const kinds = (await session.entries()).map((entry) => entry.kind);
    assert.equal(kinds.includes("compaction"), true, "the catalog's window fed the attention gate");
    assert.equal(reads, 1, "the catalog is read once per agent");
    await agent.dispose();
  });

  it("context_engineering_below_ratio_vetoes_the_host_trigger", async () => {
    // Below `compactRatio` attention owns the decision, the same as the compaction and memory voters.
    const { agent } = await harness({
      config: { attention: { maxInputTokens: 10_000, triggerRatio: 0.8, compactRatio: 0.9 } },
      compaction: { thresholdEntries: 0 },
      script: [reply("first"), reply("summary"), reply("second")],
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("short");

    const kinds = (await session.entries()).map((entry) => entry.kind);
    assert.equal(kinds.includes("compaction"), false, "attention's false vote wins over the host's fallback trigger");
    await agent.dispose();
  });

  it("context_engineering_budget_and_attention_rejected", async () => {
    assert.throws(
      () => resolveContextEngineeringConfig({ budget: { maxInputTokens: 100 }, attention: { triggerRatio: 0.5 } }),
      /budget and attention are mutually exclusive/,
    );
    await assert.rejects(
      () =>
        createAgent({
          model: { provider: "mock", model: "main" },
          packages: [mockProvider([reply()]), contextEngineering({ budget: { maxInputTokens: 100 }, attention: {} })],
        }),
      /mutually exclusive/,
    );
  });

  it("context_engineering_from_custom_loop", async () => {
    const { loopConformance } = await import("@arnilo/prism/testing");
    const captured: ProviderRequest[] = [];
    const deps = handlerDeps({ budget: { maxInputTokens: 500 } });
    const outcome = await loopConformance({
      // The conformance custom loop drives `turn()`/`executeTools()` itself; the handler must apply.
      loop: {
        name: "conformance-custom",
        revision: "1",
        async run(run) {
          const turn = await run.turn();
          if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
        },
      },
      input: "z".repeat(40_000),
      hooks: (hooks) => {
        hooks.on("context.build", createContextEngineeringHandler(deps));
        hooks.on("model.request", (request) => {
          captured.push(request);
          return undefined;
        });
      },
    });

    assert.equal(outcome.result?.status, "completed", JSON.stringify(outcome.error ?? {}));
    const sent = JSON.stringify(captured.at(-1)?.messages ?? []);
    assert.equal(sent.includes("zzzzzzzzzz"), false, "the budget trimmed the request under the custom loop");
    await outcome.agent.dispose();
  });
});
