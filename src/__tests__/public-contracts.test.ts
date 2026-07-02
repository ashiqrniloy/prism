import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  AgentConfig,
  AgentDefinition,
  AgentDefinitionResolutionContext,
  AgentEvent,
  AgentSessionCloneOptions,
  AgentSessionForkOptions,
  AIProvider,
  AuthMethod,
  CacheUsageReport,
  CommandDefinition,
  CompactionOptions,
  CompactionStrategy,
  ConfigLayer,
  ConfigProvider,
  ContextProvider,
  CredentialResolver,
  OAuthLoginCallbacks,
  OAuthProvider,
  AssembleProviderInputOptions,
  DefaultInputBuildContext,
  Extension,
  InputAssemblyLayout,
  InputBuilder,
  ManifestContributionDeclaration,
  ManifestResourceDeclaration,
  PrismManifest,
  PromptBuilder,
  PromptCacheHints,
  ModelCacheCapabilities,
  PromptCacheKind,
  PromptTemplateOptions,
  ProviderPackage,
  ProviderRequestOptions,
  ProviderRequestPolicy,
  ResourceLoader,
  RetryOptions,
  RunOptions,
  RetryPolicy,
  SettingsProvider,
  Skill,
  SessionEntry,
  SessionStore,
  SkillRegistry,
  StoreFactory,
  SystemPromptConfig,
  SystemPromptContribution,
  SystemPromptMode,
  ToolDefinition,
} from "../index.js";
import { assembleProviderInput, cacheUsageReport, composeSystemPrompt, createAgent, createAgentSession, createContributionRegistries, createDefaultCompactionStrategy, createDefaultInputBuilder, createDefaultPromptBuilder, createDefaultRetryPolicy, createEnvCredentialResolver, createExplicitCredentialResolver, createExtensionKernel, createMemorySessionStore, createProviderRequestPolicyChain, createSessionCachePolicy, createSessionEntry, createSkillRegistry, createToolRegistry, defineProviderPackage, dispatchToolCall, filterTools, mergeProviderRequestOptions, rebuildSessionContext, renderPromptTemplate, resolveActiveSkills, resolveAgentDefinition, resolveContextProviders } from "../index.js";
import type { DispatchToolCallOptions, SessionContextSnapshot, ToolFilter, ToolValidator } from "../index.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

const context: ContextProvider = {
  name: "demo-context",
  resolve() {
    return [{ title: "Demo", content: "Public contract example." }];
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
      provider,
      context: [context],
      skills: [skill],
      tools: [tool],
      metadata: { example: true },
    };

    assert.equal(config.provider?.id, "mock");
    assert.equal(config.context?.[0]?.name, "demo-context");
    assert.equal(Array.isArray(config.tools), true);
  });

  it("host can type extension resource settings and credentials", async () => {
    const extension: Extension = {
      name: "demo-extension",
      setup(api) {
        api.registerProvider(provider);
        api.registerContextProvider(context);
        api.registerSkill(skill);
        api.registerTool(tool);
      },
    };

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

    assert.equal(extension.name, "demo-extension");
    assert.equal((await resources.load("memory:demo")).text, "example");
    assert.equal(await settings.get("demo.enabled"), true);
    assert.equal(await credentials.resolve({ name: "demo" }), undefined);
  });

  it("host can type phase 11 provider package and model metadata contracts", async () => {
    const auth: AuthMethod = { provider: "mock", kind: "api_key", credentialName: "apiKey" };
    const requestPolicy: ProviderRequestPolicy = { name: "cache", apply: ({ request }) => request };
    const promptContribution: SystemPromptContribution = { id: "package-prompt", source: "package", mode: "append", text: "Use package rules." };
    const providerPackage: ProviderPackage = defineProviderPackage({
      name: "demo-provider",
      docs: { description: "Demo provider package." },
      setup(api) {
        api.registerProvider(provider);
        api.registerModel({
          provider: "mock",
          model: "demo-metadata",
          displayName: "Demo Metadata",
          capabilities: { input: ["text"], reasoning: true, tools: true, streaming: true },
          limits: { contextWindow: 128_000, maxOutputTokens: 8_192 },
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, currency: "USD" },
          cache: { kind: "cache_control", maxKeyLength: 128, maxBreakpoints: 4, minCacheableTokens: 1024, longRetention: true },
          compat: { vendorSpecific: true },
          metadata: { safe: true },
        });
        api.registerAuthMethod(auth);
        api.registerProviderRequestPolicy(requestPolicy);
        api.registerSystemPromptContribution(promptContribution);
      },
    });
    const kernel = createExtensionKernel();
    await kernel.load([{ name: "package-loader", setup: (api) => {
      api.registerProviderPackage(providerPackage);
      return providerPackage.setup(api);
    } }]);

    const registeredModel = kernel.registries.models.resolve("mock", "demo-metadata");
    assert.equal(kernel.registries.providerPackages.resolve("demo-provider"), providerPackage);
    assert.equal(registeredModel.capabilities?.reasoning, true);
    assert.equal(registeredModel.cache?.kind, "cache_control");
    assert.equal(registeredModel.cache?.maxBreakpoints, 4);
    assert.equal(kernel.registries.authMethods.resolve("mock\0api_key"), auth);
    assert.equal(kernel.registries.providerRequestPolicies.resolve("cache"), requestPolicy);
    assert.equal(kernel.registries.systemPromptContributions.resolve("package-prompt"), promptContribution);
  });

  it("host can type OAuth and explicit credential resolver contracts", async () => {
    const callbacks: OAuthLoginCallbacks = { onPrompt: () => "device" };
    const oauth: OAuthProvider = {
      id: "mock-oauth",
      login: () => ({ access: "access-token", refresh: "refresh-token" }),
      refresh: (credentials) => ({ ...credentials, access: "refreshed-token" }),
      getCredential: (credentials) => credentials.access ? { type: "bearer", value: credentials.access } : undefined,
    };
    const auth: AuthMethod = { provider: "mock", kind: "oauth", oauth };
    const resolver = createExplicitCredentialResolver([
      { name: "runtime", resolver: { resolve: () => undefined } },
      { name: "env", resolver: createEnvCredentialResolver({ DEMO_API_KEY: "demo-key" }, { mock: "DEMO_API_KEY" }) },
    ]);

    assert.equal(await callbacks.onPrompt?.("mode?"), "device");
    assert.equal(auth.kind, "oauth");
    assert.equal((await resolver.resolve({ name: "apiKey", provider: "mock" }))?.value, "demo-key");
  });

  it("host can type layered system prompt contracts", () => {
    const mode: SystemPromptMode = "append";
    const config: SystemPromptConfig = [{ id: "app", source: "app", mode, text: "App rules." }];
    const runOptions: RunOptions = { inputLayout: "legacy" };
    const agentConfig: AgentConfig = { model: { provider: "mock", model: "demo" }, provider, instructions: "Base", systemPrompt: config, inputLayout: runOptions.inputLayout };
    const prompt = composeSystemPrompt(agentConfig.systemPrompt, { base: agentConfig.instructions });

    assert.equal(prompt, "Base\n\nApp rules.");
  });

  it("host can type model cache capability metadata", async () => {
    const kind: PromptCacheKind = "openai_key";
    const cache: ModelCacheCapabilities = { kind, maxKeyLength: 64, maxBreakpoints: 0, minCacheableTokens: 1024, longRetention: true };
    const model = { provider: "mock", model: "cached", cache };
    const seen: typeof model[] = [];
    const passiveProvider: AIProvider = {
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

    assert.equal(report?.cacheWriteTokens, 0);
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
    const cache = createSessionCachePolicy({ retention: "long" });
    const chain = createProviderRequestPolicyChain([cache]);
    const result = await chain.apply({
      sessionId: "s1",
      request: { model: { provider: "mock", model: "demo" }, messages: [], options },
    });

    assert.equal("request" in result ? result.request.options?.cacheRetention : result.options?.cacheRetention, "long");

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
    assert.deepEqual(merged?.cache?.breakpoints?.map((item) => item.location), ["system_prompt", "last_user_message"]);
  });

  it("host can type phase 2 contribution contracts", async () => {
    const command: CommandDefinition = {
      name: "say",
      execute() {
        return { name: "say", value: "ok" };
      },
    };
    const agentDefinition: AgentDefinition = {
      name: "agent",
      create() {
        return {
          config: { model: { provider: "mock", model: "demo" }, provider },
          createSession() {
            throw new Error("not implemented in public contract test");
          },
        };
      },
    };
    const inputBuilder: InputBuilder = {
      name: "input",
      build(input) {
        return typeof input === "string" ? [{ role: "user", content: [{ type: "text", text: input }] }] : [];
      },
    };
    const promptBuilder: PromptBuilder = { name: "prompt", build: (request) => request.messages };
    const compaction: CompactionStrategy = { name: "compact", compact: () => ({ summary: "ok" }) };
    const storeFactory: StoreFactory = { name: "memory", create: () => ({ append: async () => undefined, list: async () => [] }) };

    assert.equal(command.name, "say");
    assert.equal(agentDefinition.name, "agent");
    assert.equal((await inputBuilder.build("hi"))[0]?.role, "user");
    assert.equal(promptBuilder.name, "prompt");
    assert.equal((await compaction.compact({ sessionId: "s1", entries: [] })).summary, "ok");
    assert.equal((await storeFactory.create()).list("s1") instanceof Promise, true);
  });

  it("host can type phase 3 config and manifest contracts", async () => {
    const provider: ConfigProvider = {
      name: "host",
      load() {
        return { demo: { enabled: true } };
      },
    };
    const layer: ConfigLayer = { name: provider.name, config: (await provider.load()) ?? {} };
    const contribution: ManifestContributionDeclaration = { kind: "tool", name: "demo.echo", module: "./tool.js" };
    const resource: ManifestResourceDeclaration = { uri: "package://demo/prompt.md", purpose: "prompt" };
    const manifest: PrismManifest = {
      name: "demo-package",
      configDefaults: layer.config,
      contributions: [contribution],
      resources: [resource],
    };

    assert.equal(manifest.name, "demo-package");
    assert.equal(manifest.contributions?.[0]?.kind, "tool");
    assert.equal(manifest.resources?.[0]?.uri, "package://demo/prompt.md");
  });

  it("host can type phase 4 tool registry filters dispatch and contributions", async () => {
    const contributions = createContributionRegistries();
    const kernel = createExtensionKernel({ registries: contributions });
    await kernel.load([{ name: "tools", setup: (api) => { api.registerTool(tool); } }]);
    const registry = createToolRegistry([contributions.tools.resolve("echo")]);
    const filter: ToolFilter = { allow: ["echo"] };
    const validate: ToolValidator = (_tool, args) => typeof args.text === "string" ? undefined : "text is required";
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
      contextProviders: [context],
      promptBuilder: createDefaultPromptBuilder(),
      tools: [tool],
      skills: [skill],
    };

    assert.equal((await resolveContextProviders({ providers: [context], messages: [] })).length, 1);
    assert.equal((await assembleProviderInput(options)).model.model, "demo");
  });

  it("host can type phase 5 extension contribution wiring", async () => {
    const extension: Extension = { name: "phase5", setup(api) {
      api.registerInputBuilder({ name: "input", build: () => [{ role: "user", content: [{ type: "text", text: "from extension" }] }] });
      api.registerPromptBuilder({ name: "prompt", build: (request) => request.messages });
      api.registerContextProvider(context);
      api.registerSkill(skill);
    } };
    const kernel = createExtensionKernel();
    await kernel.load([extension]);
    const skillRegistry = createSkillRegistry([kernel.registries.skills.resolve("brief")]);
    const selectedSkills = resolveActiveSkills({ registry: skillRegistry, names: ["brief"], tools: [tool] });
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hello",
      inputBuilder: kernel.registries.inputBuilders.resolve("input"),
      promptBuilder: kernel.registries.promptBuilders.resolve("prompt"),
      contextProviders: [kernel.registries.contextProviders.resolve("demo-context")],
      skills: selectedSkills,
      tools: [tool],
      middleware: kernel.middleware,
    });

    assert.equal(request.context?.[0]?.title, "Demo");
  });

  it("host can create minimal phase 6 agent sessions", async () => {
    const definition: AgentDefinition = {
      name: "runtime-agent",
      create: () => createAgent({ model: { provider: "mock", model: "demo" }, provider }),
    };
    const agent = await definition.create!();
    const session = createAgentSession({ agent, id: "s1", leafId: undefined });
    const forkOptions: AgentSessionForkOptions = { leafId: undefined };
    const cloneOptions: AgentSessionCloneOptions = { id: "s2" };

    assert.equal(agent.config.provider?.id, "mock");
    assert.equal(session.id, "s1");
    assert.equal(session.fork(forkOptions).id, "s1");
    assert.equal((await session.clone(cloneOptions)).id, "s2");
  });

  it("AgentDefinition supports declarative requirements and create is optional", () => {
    // Declarative-only definition: no create() escape hatch.
    const declarative: AgentDefinition = {
      name: "declarative-agent",
      description: "agent by declaration",
      model: "mock/demo",
      tools: ["echo"],
      skills: ["brief"],
      context: ["demo-context"],
      instructions: "Be helpful.",
    };
    assert.equal(declarative.name, "declarative-agent");
    assert.equal(declarative.create, undefined);

    // Resolution context type is exported.
    const ctx: AgentDefinitionResolutionContext = {
      registries: createContributionRegistries(),
      providerSource: () => provider,
      overrides: { model: { provider: "mock", model: "override" } },
    };
    assert.equal(ctx.providerSource?.({ provider: "mock", model: "demo" })?.id, "mock");

    // Resolver is exported.
    assert.equal(typeof resolveAgentDefinition, "function");
  });

  it("public contracts accept branch aware session entries", () => {
    const root: SessionEntry = createSessionEntry({
      id: "entry_1",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "Hi" }] },
    });
    const label: SessionEntry = createSessionEntry({ id: "entry_2", parentId: root.id, sessionId: "s1", timestamp: root.timestamp, kind: "label", label: "demo" });
    const snapshot: SessionContextSnapshot = rebuildSessionContext([root, label], { leafId: label.id });

    assert.equal(snapshot.leafId, "entry_2");
    assert.equal(snapshot.messages[0]?.role, "user");
  });

  it("public contracts cover default compaction strategy", async () => {
    const strategy: CompactionStrategy = createDefaultCompactionStrategy({ keepRecentEntries: 1 });
    const options: CompactionOptions = { strategy, thresholdEntries: 10, keepRecentEntries: 1 };
    const root = createSessionEntry({ id: "entry_1", sessionId: "s1", kind: "message", message: { role: "user", content: [{ type: "text", text: "Hi" }] } });
    const result = await strategy.compact({ sessionId: "s1", entries: [root], trigger: "manual" });
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, compaction: options });
    const session = createAgentSession({ agent, id: "compact-contract" });

    assert.equal(strategy.name, "default-compaction");
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
      type: "tool_execution_progress",
      sessionId: "s1",
      runId: "r1",
      toolCallId: "call_1",
      name: "echo",
      progress: { step: 1 },
    };

    if (event.type === "tool_execution_progress") {
      assert.equal(event.toolCallId, "call_1");
      return;
    }

    assert.fail("event did not narrow");
  });

  it("public contracts do not mention app-specific tool categories", () => {
    const files = [
      "src/index.ts",
      "src/contracts.ts",
      "dist/index.d.ts",
      "dist/contracts.d.ts",
    ];
    const banned = [
      /safe.?tool/i,
      /dangerous/i,
      /synapta/i,
      /shell/i,
      /filesystem/i,
      /browser/i,
    ];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of banned) {
        assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
      }
    }
  });
});
