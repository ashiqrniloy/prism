import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type {
  AgentConfig,
  AgentDefinition,
  AgentDefinitionResolutionContext,
  AgentEvent,
  AssembleProviderInputOptions,
  CompactionOptions,
  Compactor,
  CredentialResolver,
  DefaultInputBuildContext,
  DispatchToolCallOptions,
  InputAssemblyLayout,
  ModelCacheCapabilities,
  ModelProvider,
  OAuthLoginCallbacks,
  OAuthProvider,
  PackageCommand,
  PromptCacheHints,
  PromptCacheKind,
  PromptTemplateOptions,
  ProviderRequestOptions,
  ResourceLoader,
  RetryOptions,
  RetryPolicy,
  RunOptions,
  SessionContextSnapshot,
  SessionEntry,
  SessionForkOptions,
  SessionStore,
  SettingsProvider,
  Skill,
  SkillRegistry,
  StoreFactory,
  SystemPromptConfig,
  SystemPromptMode,
  ToolDefinition,
  ToolFilter,
  ToolValidator,
} from "../index.js";
import {
  assembleProviderInput,
  composeSystemPrompt,
  createAgent,
  createDefaultCompactor,
  createDefaultInputBuilder,
  createDefaultRetryPolicy,
  createMemorySessionStore,
  createSessionEntry,
  createSkillRegistry,
  createToolRegistry,
  dispatchToolCall,
  filterTools,
  rebuildSessionContext,
  renderPromptTemplate,
  resolveActiveSkills,
  withContextBlocks,
} from "../index.js";
import type { CacheUsageReport } from "../provider-kit/index.js";
import {
  applyDefaultProviderRequestOptions,
  cacheUsageReport,
  mergeProviderRequestOptions,
  ProviderRequirementError,
  providerPackage,
} from "../provider-kit/index.js";

const provider: ModelProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

const tool: ToolDefinition = {
  name: "echo",
  parameters: { type: "object" },
  execute(_args, ctx) {
    return { toolCallId: ctx.toolCallId, name: "echo", value: "ok" };
  },
};

const skill: Skill = {
  name: "brief",
  instructions: "Answer briefly.",
  toolNames: ["echo"],
};

describe("public contracts", () => {
  it("host can configure agent with provider context skill and tool", () => {
    const config: AgentConfig = {
      id: "demo-agent",
      model: { provider: "mock", model: "demo-model" },
      packages: [providerPackage("test-provider", [provider])],
      skills: { add: [skill] },
      tools: { add: [tool] },
      metadata: { example: true },
    };

    assert.equal(config.packages?.length, 1);
    assert.equal(config.tools?.add?.length, 1);
  });

  it("host can type resource settings and credentials", async () => {
    const resources: ResourceLoader = {
      async load(uri) {
        return { uri, mediaType: "text/plain", text: "example" };
      },
    };

    const settings: SettingsProvider = {
      get<T>(key: string) {
        return key === "demo.enabled" ? (true as T) : undefined;
      },
    };

    const credentials: CredentialResolver = {
      resolve() {
        return undefined;
      },
    };

    assert.equal((await resources.load("memory:demo")).text, "example");
    assert.equal(await settings.get("demo.enabled"), true);
    assert.equal(await credentials.resolve("env:demo", {}), undefined);
  });

  it("host can type OAuth and credentials slot contracts", async () => {
    const callbacks: OAuthLoginCallbacks = { onPrompt: () => "device" };
    const oauth: OAuthProvider = {
      id: "mock-oauth",
      login: () => ({ access: "access-token", refresh: "refresh-token" }),
      refresh: (credentials) => ({ ...credentials, access: "refreshed-token" }),
      getCredential: (credentials) => (credentials.access ? { type: "bearer", value: credentials.access } : undefined),
    };
    const resolver: CredentialResolver = {
      resolve: (ref) => (ref === "env:DEMO_API_KEY" ? { type: "api_key", value: "demo-key" } : undefined),
    };

    assert.equal(await callbacks.onPrompt?.("mode?"), "device");
    assert.equal((await oauth.login()).access, "access-token");
    assert.equal((await resolver.resolve("env:DEMO_API_KEY", {}))?.value, "demo-key");
  });

  it("host can type layered system prompt contracts", () => {
    const mode: SystemPromptMode = "append";
    const config: SystemPromptConfig = [{ id: "app", source: "app", mode, text: "App rules." }];
    const runOptions: RunOptions = { inputLayout: "legacy" };
    const agentConfig: AgentConfig = {
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      instructions: "Base",
      systemPrompt: config,
      inputLayout: runOptions.inputLayout,
    };
    const prompt = composeSystemPrompt(agentConfig.systemPrompt, { base: agentConfig.instructions });

    assert.equal(prompt, "Base\n\nApp rules.");
  });

  it("host can type model cache capability metadata", async () => {
    const kind: PromptCacheKind = "openai_key";
    const cache: ModelCacheCapabilities = { kind, maxKeyLength: 64, maxBreakpoints: 0, minCacheableTokens: 1024, longRetention: true };
    const model = { provider: "mock", model: "cached", cache };
    const seen: (typeof model)[] = [];
    const passiveProvider: ModelProvider = {
      id: "passive",
      async *generate(request) {
        seen.push(request.model as typeof model);
        yield { type: "done" };
      },
    };

    for await (const _ of passiveProvider.generate({ model, messages: [] }));
    for await (const _ of passiveProvider.generate({ model: { provider: "mock", model: "plain" }, messages: [] }));

    assert.equal(seen[0]?.cache?.kind, "openai_key");
    assert.equal(seen[0]?.cache?.maxKeyLength, 64);
    assert.equal(seen[1]?.cache, undefined);
  });

  it("host can type cache usage diagnostics helper", () => {
    const report: CacheUsageReport | undefined = cacheUsageReport(
      { inputTokens: 1000, cacheReadTokens: 500 },
      { provider: "mock", model: "priced", cost: { input: 10, cacheRead: 2, unit: "1M tokens", currency: "USD" } },
    );

    assert.equal(report?.cacheWriteTokens, undefined);
    assert.equal(report?.hitRate, 0.5);
    assert.equal(report?.currency, "USD");
  });

  it("host can type provider request options and cache policy contracts", async () => {
    const hints: PromptCacheHints = {
      mode: "on",
      key: "stable-s1",
      retention: "long",
      breakpoints: [{ location: "system_prompt" }, { location: "message_id", messageId: "m1", ttl: "short" }],
    };
    const options: ProviderRequestOptions = { sessionId: "s1", cacheRetention: "short", cache: hints, headers: { "x-demo": "1" } };
    const defaulted = applyDefaultProviderRequestOptions(
      { model: { provider: "mock", model: "demo" }, messages: [], options },
      { sessionId: "s1" },
    );

    assert.equal(defaulted.options?.sessionId, "s1");
    assert.equal(defaulted.options?.cacheKey, "s1");

    const legacy = mergeProviderRequestOptions({ cacheKey: "base", cacheRetention: "short" }, { cacheRetention: "long" });
    assert.equal(legacy?.cacheKey, "base");
    assert.equal(legacy?.cacheRetention, "long");
    assert.equal("cache" in (legacy ?? {}), false);

    const merged = mergeProviderRequestOptions(
      { cacheKey: "legacy", cache: { key: "base", retention: "short", breakpoints: [{ location: "system_prompt" }] } },
      { cacheRetention: "long", cache: { key: "patch", retention: "long", breakpoints: [{ location: "last_user_message" }] } },
    );
    assert.equal(merged?.cacheKey, "legacy");
    assert.equal(merged?.cacheRetention, "long");
    assert.equal(merged?.cache?.key, "patch");
    assert.equal(merged?.cache?.retention, "long");
    assert.deepEqual(
      merged?.cache?.breakpoints?.map((item) => item.location),
      ["system_prompt", "last_user_message"],
    );

    const stamped = applyDefaultProviderRequestOptions(
      { model: { provider: "mock", model: "demo" }, messages: [], options },
      { sessionId: "fallback" },
    );
    assert.equal(stamped.options?.sessionId, "s1");
    assert.equal(stamped.options?.cacheKey, "s1");
    assert.equal(new ProviderRequirementError("missing sessionId", { requirement: "sessionId" }).code, "ERR_PRISM_PROVIDER_REQUIREMENT");
  });

  it("host can type phase 2 contribution contracts", async () => {
    const command: PackageCommand = {
      name: "say",
      description: "Say a word.",
      run() {
        return { name: "say", value: "ok" };
      },
    };
    const agentDefinition: AgentDefinition = {
      name: "agent",
      create() {
        return {
          id: "agent",
          config: { model: { provider: "mock", model: "demo" }, provider },
          tools: [],
          skills: [],
          sessions: {} as never,
          models: {} as never,
          session() {
            throw new Error("not implemented in public contract test");
          },
          subscribe: () => ({}) as never,
          commands: { list: () => [], run: async () => undefined },
          dispose: async () => {},
          inspect: () => ({}) as never,
        };
      },
    };
    const compactor: Compactor = { name: "compact", compact: () => ({ summary: "ok" }) };
    const storeFactory: StoreFactory = { name: "memory", create: () => ({ append: async () => undefined, list: async () => [] }) };

    assert.equal(command.name, "say");
    assert.equal(agentDefinition.name, "agent");
    assert.equal((await compactor.compact({ sessionId: "s1", entries: [] })).summary, "ok");
    assert.equal((await storeFactory.create()).list("s1") instanceof Promise, true);
  });

  it("host can type phase 4 tool registry filters dispatch and contributions", async () => {
    const registry = createToolRegistry([tool]);
    const filter: ToolFilter = { allow: ["echo"] };
    const validate: ToolValidator = (_tool, args) => (typeof args.text === "string" ? undefined : "text is required");
    const options: DispatchToolCallOptions = {
      call: { type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } },
      registry,
      context: { sessionId: "s1", runId: "r1", toolCallId: "call_1" },
      filter,
      validate,
    };

    assert.equal(registry.resolve("echo"), tool);
    assert.deepEqual(filterTools(registry.list(), filter), [tool]);
    assert.equal((await dispatchToolCall(options)).name, "echo");
  });

  it("host can type phase 5 default input assembly", async () => {
    const layout: InputAssemblyLayout = "cache_aware";
    const context: DefaultInputBuildContext = {
      inputLayout: layout,
      systemInstructions: "Follow host policy.",
      attachments: [{ name: "notes.md", text: "notes" }],
      toolResults: [{ toolCallId: "call_1", name: "echo", value: "ok" }],
      metadata: { requestId: "r1" },
    };

    const messages = await createDefaultInputBuilder().build("Hello", context);

    assert.equal(messages[0]?.role, "system");
    assert.equal(messages.at(-2)?.role, "tool");
    assert.equal(messages.at(-1)?.role, "user");
  });

  it("host can type phase 5 skill registry", () => {
    const registry: SkillRegistry = createSkillRegistry([skill]);
    const active = resolveActiveSkills({ registry, names: ["brief"], tools: [tool] });

    assert.equal(registry.resolve("brief"), skill);
    assert.deepEqual(active, [skill]);
  });

  it("host can type phase 5 prompt template rendering", async () => {
    const options: PromptTemplateOptions = { missing: "throw" };
    const prompt = renderPromptTemplate("Hello {{name}}", { name: "world" }, options);
    const messages = await createDefaultInputBuilder().build(prompt);

    assert.equal(messages[0]?.role, "user");
    assert.equal(messages[0]?.content[0]?.type === "text" ? messages[0].content[0].text : undefined, "Hello world");
  });

  it("host can type phase 5 context prompt assembly", async () => {
    const options: AssembleProviderInputOptions = {
      model: { provider: "mock", model: "demo" },
      inputLayout: "cache_aware",
      input: "Hello",
      tools: [tool],
      skills: [skill],
    };

    const request = await assembleProviderInput(options);
    assert.equal(request.model.model, "demo");
    assert.equal(withContextBlocks({ messages: request.messages }, [{ title: "Demo", content: "demo-context" }])?.context?.length, 1);
  });

  it("host can create minimal phase 6 agent sessions", async () => {
    const definition: AgentDefinition = {
      name: "runtime-agent",
      create: async () =>
        await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] }),
    };
    const agent = await definition.create!();
    const session = await agent.session({ id: "s1", leafId: undefined, create: true });
    const forkOptions: SessionForkOptions = { at: undefined };

    assert.equal(session.id, "s1");
    assert.notEqual((await session.fork(forkOptions)).id, "s1");
  });

  it("AgentDefinition supports declarative requirements and create is optional", () => {
    // Declarative-only definition: no create() escape hatch.
    const declarative: AgentDefinition = {
      name: "declarative-agent",
      description: "agent by declaration",
      model: "mock/demo",
      tools: ["echo"],
      skills: ["brief"],
      instructions: "Be helpful.",
    };
    assert.equal(declarative.name, "declarative-agent");
    assert.equal(declarative.create, undefined);

    // Resolution context type is exported.
    const ctx: AgentDefinitionResolutionContext = {
      overrides: { model: { provider: "mock", model: "override" } },
    };
    assert.equal(ctx.overrides?.model !== undefined, true);
  });

  it("public contracts accept branch aware session entries", () => {
    const root: SessionEntry = createSessionEntry({
      id: "entry_1",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "Hi" }] },
    });
    const label: SessionEntry = createSessionEntry({
      id: "entry_2",
      parentId: root.id,
      sessionId: "s1",
      timestamp: root.timestamp,
      kind: "label",
      label: "demo",
    });
    const snapshot: SessionContextSnapshot = rebuildSessionContext([root, label], { leafId: label.id });

    assert.equal(snapshot.leafId, "entry_2");
    assert.equal(snapshot.messages[0]?.role, "user");
  });

  it("public contracts cover the default compactor and the compaction slot", async () => {
    const compactor: Compactor = createDefaultCompactor({ keepRecentEntries: 1 });
    const options: CompactionOptions = { thresholdEntries: 10, keepRecentEntries: 1 };
    const root = createSessionEntry({
      id: "entry_1",
      sessionId: "s1",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "Hi" }] },
    });
    const result = await compactor.compact({ sessionId: "s1", entries: [root], trigger: "manual" });
    // The implementation is the slot (roadmap §2.5); `compaction` only sizes it.
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      compaction: options,
      slots: { compaction: compactor },
    });
    const session = await agent.session({ id: "compact-contract", create: true });

    assert.equal(compactor.name, "default-compaction");
    assert.equal(result.entries?.[0]?.kind, "compaction");
    assert.equal((await session.compact({ keepRecentEntries: 1 })).entries?.[0]?.kind, "compaction");
  });

  it("public contracts cover retry policy", async () => {
    const policy: RetryPolicy = createDefaultRetryPolicy({ maxAttempts: 2, baseDelayMs: 0 });
    const options: RetryOptions = { policy, maxAttempts: 2 };
    const decision = await policy.decide({ sessionId: "s1", runId: "r1", attempt: 1, error: { message: "busy", code: 503 } });

    assert.equal(options.policy?.name, "default-retry");
    assert.equal(decision.retry, true);
  });

  it("public contracts can use memory store as session store", async () => {
    const store: SessionStore = createMemorySessionStore();
    const factory: StoreFactory = { name: "memory", create: () => createMemorySessionStore() };
    const item = createSessionEntry({ id: "memory_1", sessionId: "s1", kind: "custom", data: { ok: true } });

    await store.append(item);

    assert.equal((await store.get?.("memory_1"))?.id, item.id);
    assert.equal((await factory.create()).list("s1") instanceof Promise, true);
  });

  it("agent event narrows by type", () => {
    const event: AgentEvent = {
      type: "tool.progress",
      sessionId: "s1",
      runId: "r1",
      toolCallId: "call_1",
      name: "echo",
      progress: { step: 1 },
    };

    if (event.type === "tool.progress") {
      assert.equal(event.toolCallId, "call_1");
      return;
    }

    assert.fail("event did not narrow");
  });

  it("public contracts do not mention app-specific tool categories", () => {
    // Plan 174 Task 8: the kernel publishes TypeScript source, so the checked surfaces are the
    // source modules themselves.
    const files = ["src/index.ts", "src/contracts.ts"];
    const banned = [/safe.?tool/i, /dangerous/i, /shell/i, /filesystem/i, /browser/i];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of banned) {
        assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
      }
    }
  });
});
