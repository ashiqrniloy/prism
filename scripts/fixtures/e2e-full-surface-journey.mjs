/**
 * Plans/064 Task 10: full-surface packed journey.
 * Runs INSIDE a fresh consumer that installed all ten @arnilo tarballs
 * (bun pm pack), so every import below resolves from the consumer's
 * node_modules — this file must never import workspace paths.
 *
 * One section per package, exercising every public subpath that is
 * reachable without external credentials through a representative hermetic
 * call (pure helpers, construct-only factories, in-memory round-trips, or
 * local file generation). Server-backed factories (postgres, nats, OPA,
 * S3, OIDC, JWKS, browser/obscura, provider wire calls) are exercised at
 * construct/validation level only — their live legs live in the
 * scripts/live-matrix.json suites (Tasks 4-9).
 *
 * Run: node fixtures/e2e-full-surface-journey.mjs (inside the packed consumer)
 * Prints: FULL SURFACE JOURNEY OK
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sections = [];
async function section(name, run) {
  await run();
  sections.push(name);
}

// ---------------------------------------------------------------------------
// @arnilo/prism (root umbrella, 25 subpaths)
// ---------------------------------------------------------------------------
await section("@arnilo/prism: .", async () => {
  const prism = await import("@arnilo/prism");
  // Mock-provider agent session round-trip through the public agent surface.
  // Plan-066: the kernel must stamp session correlation + thinking intent on
  // every generate request, even with no host policies configured.
  const seen = [];
  const { createMockProvider } = await import("@arnilo/prism/testing");
  const { canonicalizeJsonSchema, providerPackage, ...kit } = await import("@arnilo/prism/provider-kit");
  const provider = createMockProvider([prism.providerTextDelta("pong"), prism.providerDone()], {
    onRequest: (request) => seen.push(request),
  });
  const agent = await prism.createAgent({
    model: {
      provider: "mock",
      model: "reasoner-1",
      capabilities: { thinkingLevels: ["low", "high"] },
      compat: { thinkingFamily: "reasoning_effort" },
    },
    packages: [providerPackage("test-provider", [provider])],
    instructions: "reply exactly: pong",
    thinkingLevel: "low",
  });
  const session = await agent.session();
  const result = await session.run("say pong");
  assert.ok(result, "mock-provider session must complete a run");
  assert.equal(seen.length, 1, "mock run must produce exactly one generate request");
  const generated = seen[0];
  assert.ok(generated.options?.sessionId && generated.options.sessionId.length > 0, "kernel must stamp a session id");
  assert.equal(generated.options.cacheKey, generated.options.sessionId, "kernel must default cacheKey to the session id");
  assert.deepEqual(
    generated.options.compat,
    { reasoning_effort: "low" },
    "agent thinkingLevel must land on the wire request as the mapped compat",
  );
  // Plan 174 Task 3: request-construction helpers resolve from provider-kit, not the root.
  assert.equal(typeof kit.applyDefaultProviderRequestOptions, "function");
  assert.equal(typeof kit.ProviderRequirementError, "function");
  assert.equal(prism.applyDefaultProviderRequestOptions, undefined);
  const stamped = kit.applyDefaultProviderRequestOptions(
    { model: { provider: "mock", model: "plain" }, options: {} },
    { sessionId: "h-1" },
  );
  assert.equal(stamped.options.sessionId, "h-1");
  assert.equal(stamped.options.cacheKey, "h-1", "helper must default cacheKey to sessionId");
  const untouched = kit.applyDefaultProviderRequestOptions(
    { model: { provider: "mock", model: "plain" }, options: { sessionId: "host" } },
    { sessionId: "h-2" },
  );
  assert.equal(untouched.options.sessionId, "host", "host-set sessionId must win over the kernel default");
  assert.equal(untouched.options.cacheKey, "host", "cacheKey must follow the host sessionId");
  // Tool registry dispatch round-trip.
  const echo = {
    name: "echo",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args.text }),
  };
  const registry = prism.createToolRegistry([echo]);
  const dispatched = await prism.dispatchToolCall({
    call: { id: "t1", name: "echo", arguments: { text: "hi" } },
    registry,
    context: { sessionId: "s-1", runId: "r-1", toolCallId: "t1", signal: new AbortController().signal, metadata: {} },
    principal: { kind: "agent", id: "a" },
  });
  assert.match(JSON.stringify(dispatched), /"hi"/, "tool dispatch must round-trip");
  assert.equal(prism.createSecretRedactor(["s3cret"]).redact("a s3cret b"), "a [REDACTED] b");
  // Plan 152 Task 2: `canonicalizeJsonSchema` moved from the root barrel to `@arnilo/prism/provider-kit`.
  assert.equal(typeof canonicalizeJsonSchema({ type: "object" }).type, "string");
  // Plan-065 thinking-effort surface: the five public helpers must resolve from the pack.
  assert.equal(kit.parseThinkingLevel("High"), "high");
  assert.deepEqual(kit.parseThinkingLevel("turbo"), { opaque: "turbo" });
  assert.equal(kit.parseThinkingLevel(""), undefined);
  const reasoner = {
    provider: "mock",
    model: "reasoner-1",
    capabilities: { thinkingLevels: ["low", "high"] },
    compat: { thinkingFamily: "reasoning_effort" },
  };
  const gemini = {
    provider: "mock",
    model: "gemini-x",
    capabilities: { thinkingLevels: ["low", "medium", "high"] },
    compat: { thinkingFamily: "google" },
  };
  assert.deepEqual(kit.thinkingLevelsForModel(reasoner), ["low", "high"]);
  assert.equal(kit.isSupportedThinkingLevel(reasoner, "high"), true);
  assert.equal(kit.isSupportedThinkingLevel(reasoner, "max"), false);
  assert.equal(kit.isSupportedThinkingLevel({ provider: "mock", model: "plain" }, "high"), true);
  assert.equal(kit.snapThinkingLevel(reasoner, "medium"), "high");
  assert.equal(kit.snapThinkingLevel(reasoner, "none"), "low");
  assert.deepEqual(kit.applyThinkingLevelForModel(undefined, "medium", reasoner)?.compat, { reasoning_effort: "high" });
  assert.deepEqual(kit.applyThinkingLevelForModel(undefined, "low", gemini)?.compat, { thinkingLevel: "low" });
  assert.equal(
    Object.keys(kit.applyThinkingLevelForModel(undefined, "high", { provider: "mock", model: "plain" })?.compat ?? {}).length,
    0,
  );
});

await section("@arnilo/prism: provider-kit", async () => {
  const m = await import("@arnilo/prism/provider-kit");
  assert.equal(m.canonicalizeJsonSchema({ type: "string" }).type, "string");
  const serialized = m.serializeOpenAIChatMessage({ role: "user", content: [{ type: "text", text: "hi" }] });
  assert.equal(serialized.role, "user");
  assert.equal(m.bytesToBase64(new Uint8Array([104, 105])), "aGk=");
  assert.deepEqual(m.tryParseJsonObjectArguments('{"a":1}'), { ok: true, value: { a: 1 } });
  const message = { role: "user", content: [{ type: "text", text: "hi" }] };
  const body = m.buildOpenAIChatBody({ model: "m", messages: [message] });
  assert.equal(body.messages[0].content, "hi");
  assert.equal(typeof m.providerConformance, "function");
  assert.equal(typeof m.providerPackage, "function");
});

await section("@arnilo/prism: testing/* conformance helpers", async () => {
  const helpers = [
    "testing",
    "testing/state-concurrency-conformance",
    "testing/compaction-conformance",
    "testing/tool-conformance",
    "testing/tool-effect-store-conformance",
    "testing/run-ledger-conformance",
  ];
  for (const sub of helpers) {
    const m = await import(`@arnilo/prism/${sub}`);
    assert.ok(Object.keys(m).length > 0, `${sub} must export helpers`);
  }
  const toolHelpers = await import("@arnilo/prism/testing/tool-conformance");
  assert.equal(typeof toolHelpers.assertToolDispatchConforms, "function");
});

await section("@arnilo/prism: node/* node adapters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-full-surface-node-"));
  const contributions = await import("@arnilo/prism/node/contribution-discovery");
  const prism = await import("@arnilo/prism");
  const _policy = prism.createPathTrustPolicy({ trustedRoots: [dir] });
  assert.equal(prism.isPathInside(dir, join(dir, "file.txt")), true);
  assert.equal(typeof contributions.discoverContributions, "function");
  // Plan 154 Task 7: the three prompt/trust subpaths are gone; the package replaced them.
  for (const removed of ["node/trust", "node/instruction-sources", "node/system-prompts"]) {
    let failed = false;
    try {
      await import(`@arnilo/prism/${removed}`);
    } catch {
      failed = true;
    }
    assert.equal(failed, true, `@arnilo/prism/${removed} must not resolve`);
  }
  const contextFiles = await import("@arnilo/prism-extensions/context-files");
  assert.equal(typeof contextFiles.default, "function");
  assert.equal(typeof contextFiles.readContextFileLayers, "function");
  assert.equal(typeof contextFiles.resolveInstructionSources, "function");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-extensions/context-engineering (the four stages as one package)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-extensions/context-engineering: budget, fold, search, attention", async () => {
  const engineering = await import("@arnilo/prism-extensions/context-engineering");
  assert.equal(typeof engineering.default, "function");
  const messages = [
    { role: "system", content: [{ type: "text", text: "Policy" }] },
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: "x".repeat(4_000) }] },
  ];
  const budgeted = engineering.applyDraftBudget({ messages, budget: { maxInputTokens: 500 } });
  assert.equal(
    budgeted.messages.some((message) => message.role === "tool"),
    false,
    "the budget evicted the tool result",
  );
  const fold = engineering.resolveToolResultFold({ minBytes: 1, summarize: engineering.truncateSummarize }, undefined);
  assert.ok(fold, "the deterministic summarizer resolves");
  const folded = await engineering.foldToolResultHistory(messages, fold, { sessionId: "s", runId: "r", turn: 9 });
  assert.match(String(folded.at(-1).content[0].result), /^\[folded: lookup \[call_1\], 4,002 bytes — re-run the tool to see it again\] /);
});

// ---------------------------------------------------------------------------
// @arnilo/prism-memory-system/core (the shared core the family used to re-export)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-memory-system/core: shared core", async () => {
  const core = await import("@arnilo/prism-memory-system/core");
  const vectors = core.createMemoryVectorStore();
  assert.ok(vectors, "in-memory vector store must construct");
  const embeddings = await core.embedBatched(core.createHashEmbedder({ dimensions: 8 }), ["a", "b"], 2, { maxDimensions: 8 });
  assert.equal(embeddings.length, 2, "embedBatched must embed every text");
  assert.equal(typeof core.resolveMemoryLimits().topK, "number", "the core owns the memory limits");
});

await section("@arnilo/prism-memory-system: semantic memory (ltm)", async () => {
  const fabric = await import("@arnilo/prism-memory-system");
  const core = await import("@arnilo/prism-memory-system/core");
  const m = fabric.createMemory({
    tenantId: "t",
    resourceId: "full-surface-probe",
    threadId: "full-surface-thread",
    embedder: core.createHashEmbedder({ dimensions: 8 }),
  });
  await m.remember({ entries: [{ text: "prism full surface probe", consent: { state: "granted" } }] });
  const recalled = await m.recall("surface probe");
  assert.ok(recalled, "hash-embedded memory must recall");
  assert.equal("updateWorking" in m, false, "working memory left long-term memory (plan 216 Task 7)");
});

await section("@arnilo/prism-knowledge/rag: rag + loaders + parsers", async () => {
  const rag = await import("@arnilo/prism-knowledge/rag");
  assert.ok(Object.keys(rag).length > 0);
  const loaders = await import("@arnilo/prism-knowledge/rag");
  assert.equal(typeof loaders.createResourceDocumentLoader, "function");
  const parsers = await import("@arnilo/prism-knowledge/rag");
  assert.ok(parsers.textParser && parsers.markdownParser, "rag parsers must be exported");
});

await section("@arnilo/prism-extensions/compaction: summarization compaction", async () => {
  const compaction = await import("@arnilo/prism-extensions/compaction");
  assert.equal(typeof compaction.default, "function", "the package definition must be callable");
});

await section("@arnilo/prism-extensions/compaction: compaction strategies", async () => {
  const om = await import("@arnilo/prism-memory-system");
  assert.equal(typeof om.foldObservationalMemoryLedger, "function", "observational memory must export the ledger fold");
});

await section("@arnilo/prism-knowledge/wiki: knowledge outside memory", async () => {
  const wiki = await import("@arnilo/prism-knowledge/wiki");
  assert.equal(typeof wiki.wiki, "function");
  assert.equal(wiki.default.requires?.services, undefined, "the wiki requires no service: it runs without memory");
  assert.equal(wiki.MEMORY_LTM_SERVICE, "memory.ltm", "it reads memory, when installed, through the read-only port");
});

await section("@arnilo/prism-extensions/workflows: .", async () => {
  const workflows = await import("@arnilo/prism-extensions/workflows");
  const graph = workflows.buildGraph(
    workflows.defineWorkflow({
      id: "full-surface-probe",
      revision: "1",
      nodes: { a: workflows.functionNode({ run: async () => ({ ok: true }) }) },
    }),
  );
  assert.ok(graph, "workflow graph must build");
  assert.equal(
    workflows.resolveMaxFanOut(
      graph !== undefined ? { id: "w", revision: "1", nodes: { a: { kind: "function", run: async () => ({}) } } } : undefined,
      { kind: "function", run: async () => ({}) },
    ) > 0,
    true,
  );
});

await section("@arnilo/prism-extensions/store-codecs: .", async () => {
  const codecs = await import("@arnilo/prism-extensions/store-codecs");
  assert.ok(codecs.createSessionRowMappers, "session codecs must export row mappers");
  assert.equal(typeof codecs.clipSearchSnippet, "function");
  assert.equal(typeof codecs.ownershipScopeMatches, "function");
});

await section("@arnilo/prism-extensions/store-sqlite: .", async () => {
  const sqlite = await import("@arnilo/prism-extensions/store-sqlite");
  assert.ok(sqlite.default.capabilities.includes("slot:store"), "the sqlite store must claim the store slot");
  try {
    const store = sqlite.createSqlitePersistence({ filename: ":memory:" });
    await store.append({
      id: "e1",
      sessionId: "s-1",
      timestamp: new Date().toISOString(),
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
      metadata: {},
    });
    const entries = await store.list("s-1");
    assert.equal(entries[0]?.id, "e1", "sqlite persistence must round-trip a session entry");
    const listed = await store.listSessions({ limit: 5 });
    assert.deepEqual(
      listed.items.map((item) => item.sessionId),
      ["s-1"],
      "sqlite listSessions must list the session",
    );
    assert.equal(listed.items[0]?.messageCount, 1, "sqlite listSessions must count message entries");
    assert.equal(await store.deleteSession("s-1"), true, "sqlite deleteSession must remove an in-scope session");
    assert.equal((await store.list("s-1")).length, 0, "sqlite deleteSession must remove the entries");
    await store.close();
    const reopened = sqlite.reopenSqlitePersistence({ filename: ":memory:" });
    assert.ok(reopened, "sqlite persistence must reopen");
    await reopened.close();
  } catch (error) {
    // ponytail: sqlite leg is optional off Bun — the package fails closed with the runtime message.
    assert.match(
      String(error?.message),
      /requires the Bun runtime \(bun:sqlite\)/,
      "sqlite absence must be the documented Bun-runtime failure",
    );
  }
});

await section("@arnilo/prism-extensions/store-postgres: .", async () => {
  const postgres = await import("@arnilo/prism-extensions/store-postgres");
  assert.equal(postgres.default.capabilities.includes("slot:store"), true);
  assert.equal(postgres.quoteIdentifier("safe"), '"safe"');
  assert.equal(typeof postgres.createPostgresPersistence, "function");
  assert.equal(typeof postgres.createPostgresAgentEventSource, "function");
});

await section("@arnilo/prism-hosts/evals + @arnilo/prism-extensions/governance + @arnilo/prism-extensions/model-router", async () => {
  const _evals = await import("@arnilo/prism-hosts/evals");
  const { createMemoryEvaluationStore } = await import("@arnilo/prism-extensions/store-codecs");
  const evalStore = createMemoryEvaluationStore();
  assert.ok(evalStore, "memory evaluation store must construct");

  const router = await import("@arnilo/prism-extensions/model-router");
  const modelRouter = router.createModelRouter({
    resolver: () => ({ id: "mock", async *generate() {} }),
  });
  const routed = await modelRouter.resolve({
    model: { provider: "mock", model: "mock-1" },
    identity: {
      tenantId: "t",
      principal: { kind: "agent", id: "a" },
      scopes: ["probe"],
      issuedAt: new Date().toISOString(),
      verified: true,
    },
  });
  assert.equal(routed.model.model, "mock-1", "model router must resolve the requested model");

  const observability = await import("@arnilo/prism-extensions/observability");
  const telemetry = observability.createInMemoryTelemetry();
  telemetry.counter?.("prism.probe", 1);
  assert.ok(telemetry, "in-memory telemetry must construct");
});

await section("@arnilo/prism-extensions/keyring", async () => {
  const keyring = await import("@arnilo/prism-extensions/keyring");
  const store = keyring.createEncryptedCredentialStore({
    path: "./full-surface.vault",
    getPassphrase: () => "full-surface-test-passphrase-0123456789",
  });
  assert.ok(store, "encrypted credential store must construct with a passphrase");
  assert.equal(typeof keyring.createKeyringCredentialResolver, "function");
});

await section("@arnilo/prism-tools/work: connectors", async () => {
  const work = await import("@arnilo/prism-tools/work/connectors");
  assert.equal(typeof work.buildMicrosoft365Argv, "function");
  const m365 = await import("@arnilo/prism-tools/work/connectors/microsoft365");
  assert.equal(typeof m365.createMicrosoft365CliAdapter, "function");
  const gws = await import("@arnilo/prism-tools/work/connectors/google-workspace");
  assert.equal(typeof gws.createGoogleWorkspaceCliAdapter, "function");
});

await section("@arnilo/prism-hosts/channels", async () => {
  const channels = await import("@arnilo/prism-hosts/channels");
  assert.equal(typeof channels.connectTelegram, "function");
  assert.equal(typeof channels.connectSignal, "function");
  const prism = await import("@arnilo/prism");
  const agent = await prism.createAgent({
    id: "probe-agent",
    model: { provider: "mock", model: "probe" },
  });
  const runtime = channels.createChannelRuntime(agent, {
    authorize: () => false,
    deliver: () => ({ delivered: false }),
  });
  const admission = await runtime.admit({
    connectionId: "probe",
    externalConversationId: "probe",
    externalActorId: "probe",
    eventId: "1",
    text: "hello",
  });
  assert.equal(admission.status, "denied", "channel runtime must deny an unauthorized sender without provider work");
  await runtime.stop();

  // Durable journal surface: bindings and dedup records land in a host-owned checkpoint store
  // (the channels package ships its own memory implementations — plan 168 Task 4-5 retired the
  // kernel's copy).
  const checkpoints = channels.createMemoryCheckpointStore();
  const state = channels.createChannelStateStore({ checkpoints, maxJournalRecordBytes: 4096 });
  const ownership = { tenantId: "probe", userId: "probe" };
  const binding = await state.createBinding(
    { ownership, connectionId: "probe", externalConversationId: "probe", externalActorId: "probe", agentAlias: "primary" },
    {
      sessionId: "chan-packed-probe",
      agentAlias: "primary",
      generation: 0,
      suspended: false,
      updatedAt: new Date().toISOString(),
    },
  );
  assert.equal(binding?.version, 1, "channel journal must create a durable binding");
  assert.equal(typeof channels.createChannelPairingStore, "function");
  assert.equal(typeof channels.createChannelDeliveryJournal, "function");

  const telegram = await import("@arnilo/prism-hosts/channels/telegram");
  assert.equal(typeof telegram.createTelegramAdapter, "function");
  const adapter = telegram.createTelegramAdapter({
    connectionId: "probe-telegram",
    botToken: async () => "not-a-live-token",
    checkpoints,
    leases: channels.createMemoryLeaseStore(),
    cursorOwnership: ownership,
  });
  assert.equal(adapter.capabilities.acknowledgement, "telegram_offset", "Telegram construction remains network-free");
  await adapter.stop();

  const signal = await import("@arnilo/prism-hosts/channels/signal");
  assert.equal(typeof signal.createSignalAdapter, "function");
  assert.equal(signal.SIGNAL_CLI_VERSION, "0.14.8", "Signal adapter must pin its signal-cli compatibility target");
  const signalAdapter = signal.createSignalAdapter({
    connectionId: "probe-signal",
    socketPath: "/run/prism/probe-signal.sock",
    account: "+15550001111",
    signalCliVersion: "0.14.8",
    policy: { acceptableUse: "operator_approved", gplDistribution: "operator_approved", termsVersion: "probe" },
    checkpoints,
    leases: channels.createMemoryLeaseStore(),
    cursorOwnership: ownership,
  });
  assert.equal(signalAdapter.capabilities.acknowledgement, "none", "Signal construction remains socket-free");
  await signalAdapter.stop();
});

// ---------------------------------------------------------------------------
await section("provider packages: adapter surfaces", async () => {
  const hyper = await import("@arnilo/prism-ai/hyper");
  assert.equal(typeof hyper.createHyperProvider, "function");
  assert.ok(hyper.hyperModels.length >= 1);

  const opencodeGo = await import("@arnilo/prism-ai/opencode-go");
  assert.equal(typeof opencodeGo.createOpenCodeGoProvider, "function");
  // Plan-066: opencode-go fail-fast must fire from the packed install before
  // any wire call when session correlation is missing.
  const prismRoot = await import("@arnilo/prism/provider-kit");
  let opencodeFetches = 0;
  const opencodeProvider = opencodeGo.createOpenCodeGoProvider({
    apiKey: async () => "fake-opencode-key",
    fetch: async () => {
      opencodeFetches += 1;
      throw new Error("fail-fast must fire before any fetch");
    },
  });
  await assert.rejects(
    (async () => {
      for await (const _ of opencodeProvider.generate({
        model: { provider: "opencode-go", model: "opencode-test" },
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })) {
        /* drain */
      }
    })(),
    (error) =>
      error instanceof prismRoot.ProviderRequirementError &&
      error.code === "ERR_PRISM_PROVIDER_REQUIREMENT" &&
      error.requirement === "sessionId",
  );
  assert.equal(opencodeFetches, 0, "fail-fast must fire before any fetch");

  const typesafe = await import("@arnilo/prism-ai/typesafe");
  assert.equal(typeof typesafe.createTypeSafeProvider, "function");
  assert.ok(typesafe.typeSafeModels.length >= 1);

  const laya = await import("@arnilo/prism-ai/laya");
  assert.equal(typeof laya.createLayaProvider, "function");
  assert.ok(laya.layaModels.length >= 1);
});

// ---------------------------------------------------------------------------
// @arnilo/prism-tools/coding (the moved agent + security surfaces)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-tools/coding: agent", async () => {
  const agent = await import("@arnilo/prism-tools/coding");
  const tool = agent.createDeleteTool({ fsRoot: mkdtempSync(join(tmpdir(), "prism-full-surface-agent-")) });
  assert.equal(tool.name.length > 0, true, "coding tool must expose a name");
});

await section("@arnilo/prism-tools/coding: security", async () => {
  const security = await import("@arnilo/prism-tools/coding");
  const redactor = security.createSecretRedactor(["hush"]);
  assert.equal(redactor("a hush b"), "a [REDACTED] b");
  // Deny-by-default sandbox fence: no flags => no admission.
  assert.equal(typeof security.resolveSandboxCapabilities, "function");
});

await section("@arnilo/prism-tools/work: document-reader", async () => {
  const reader = await import("@arnilo/prism-tools/work/document-reader");
  const documentReader = await reader.createDocumentReader({
    // ponytail: hermetic leg — host-selected text-only parser instead of the
    // optional pdf-parse/mammoth peers the packed consumer does not install.
    parsers: [
      {
        format: "txt",
        detect: () => true,
        extract: async (buffer) => ({ text: buffer.toString("utf8"), pages: undefined, truncatedBy: undefined }),
      },
    ],
  });
  const extracted = await documentReader.extract({ buffer: Buffer.from("full surface document probe") });
  assert.match(extracted?.text ?? "", /full surface document probe/, "document reader must extract via the host-selected parser");

  const openapi = await import("@arnilo/prism-tools/openapi");
  const compiled = openapi.createOpenApiTools({
    document: {
      openapi: "3.1.0",
      info: { title: "probe", version: "1" },
      servers: [{ url: "https://api.example.test" }],
      paths: {
        "/things": {
          get: {
            operationId: "listThings",
            responses: { 200: { description: "ok" } },
          },
        },
      },
    },
    server: "https://api.example.test",
    operations: ["listThings"],
  });
  assert.equal(compiled.length, 1, "openapi compiler must produce the allow-listed tool");
  assert.equal(compiled[0]?.name, "listThings");
});

await section("@arnilo/prism-tools/computer-use: classify", async () => {
  const cul = await import("@arnilo/prism-tools/computer-use");
  assert.equal(cul.classifyComputerUseLinuxTool("screenshot"), "read");
});

await section("@arnilo/prism-hosts/devtools: developer inspector host library", async () => {
  const devtools = await import("@arnilo/prism-hosts/devtools");
  assert.equal(typeof devtools.serveDevtools, "function");
  assert.equal(typeof devtools.compareInspectorRuns, "function");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-tools/work Office subpaths — local generation/parsing, no LibreOffice.
// ---------------------------------------------------------------------------
await section("@arnilo/prism-tools/work: documents + sheets + diagrams", async () => {
  const documents = await import("@arnilo/prism-tools/work/documents");
  assert.ok(documents.resolveDocumentCaps({}), "documents caps must resolve");
  const sheets = await import("@arnilo/prism-tools/work/sheets");
  const csv = sheets.parseCsv("a,b\n1,2\n");
  assert.ok(csv, "sheets csv parser must parse");
  const diagrams = await import("@arnilo/prism-tools/work/diagrams");
  assert.ok(diagrams.canonicalizeDrawioXml('<mxfile><diagram name="d"><mxGraphModel/></diagram></mxfile>'), "drawio xml must canonicalize");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-hosts/ag-ui (2 subpaths)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-hosts/ag-ui: . + renderer", async () => {
  const agui = await import("@arnilo/prism-hosts/ag-ui");
  assert.ok(agui.resolveAgUiLimits({}), "ag-ui limits must resolve");
  const renderer = await import("@arnilo/prism-hosts/ag-ui/renderer");
  assert.equal(renderer.resolvePointer({ a: { b: 1 } }, "/a/b"), 1, "renderer pointer must resolve");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-tools/web (1 root surface)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-tools/web: . (search + fetch + obscura)", async () => {
  const web = await import("@arnilo/prism-tools/web");
  assert.equal(web.canonicalUrl("https://example.com/a?b=1#frag"), "https://example.com/a?b=1");
  const cited = web.citation("brave", "https://example.com/x", "src-1");
  assert.match(cited.citationId, /web:brave:src-1/);
  assert.equal(typeof web.createBraveSearch, "function");
  assert.equal(typeof web.createExaSearch, "function");
  assert.equal(typeof web.createFirecrawlFetch, "function");
  assert.ok(web.DEFAULT_OBSCURA_PROCESS_LIMITS, "obscura surface must export bounded defaults");
});

await section("@arnilo/prism-tools/browser: browser", async () => {
  const browser = await import("@arnilo/prism-tools/browser");
  assert.ok(browser.DEFAULT_BROWSER_LIMITS, "browser surface must export bounded defaults");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-extensions/mcp (1 subpath) — client bridge and helpers.
// ---------------------------------------------------------------------------
await section("@arnilo/prism-extensions/mcp: .", async () => {
  const mcp = await import("@arnilo/prism-extensions/mcp");
  assert.equal(typeof mcp.connectMcpTools, "function", "mcp must export connectMcpTools");
  assert.equal(typeof mcp.DEFAULT_MAX_TOOLS, "number", "mcp must export bounds");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-hosts/mcp-server (1 subpath) — agent serving over MCP.
// ---------------------------------------------------------------------------
await section("@arnilo/prism-hosts/mcp-server: .", async () => {
  const mcpServer = await import("@arnilo/prism-hosts/mcp-server");
  assert.equal(typeof mcpServer.serveMcp, "function", "serveMcp must be exported");
  assert.equal(typeof mcpServer.mcpHost, "function", "mcpHost must be exported");
  assert.equal(typeof mcpServer.createPrismMcpWebHandler, "function", "the web transport helper must be exported");
  assert.equal(typeof mcpServer.servePrismMcpStdio, "function", "the stdio transport helper must be exported");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-extensions/store-jsonl (1 subpath) — the session store package.
// ---------------------------------------------------------------------------
await section("@arnilo/prism-extensions/store-jsonl: .", async () => {
  const jsonlStore = await import("@arnilo/prism-extensions/store-jsonl");
  const dir = mkdtempSync(join(tmpdir(), "prism-full-surface-jsonl-"));
  const store = jsonlStore.createJsonlSessionStore({ dir });
  const entry = {
    id: "e1",
    sessionId: "s1",
    timestamp: new Date().toISOString(),
    kind: "message",
    message: { role: "user", content: [{ type: "text", text: "packed journey" }] },
  };
  await store.append(entry);
  assert.equal((await store.list("s1")).length, 1, "jsonl store must round-trip an entry");
  assert.equal((await store.listSessions({ limit: 10 })).items[0].sessionId, "s1");
  assert.equal(await store.deleteSession("s1"), true, "jsonl store must delete a session");
  assert.equal(typeof jsonlStore.jsonlStore, "function", "the package must expose its instance shorthand");
  assert.deepEqual(jsonlStore.default.capabilities, ["slot:store"], "the package claims the store slot");
});

// Every `await section(...)` in this file must run: the count tracks the file, so a
// section that silently stops running (or is deleted) fails here. Plan 152 Task 3 moved the
// anthropic/openai sections onto the standalone provider packages without changing the count.
// Plan 174 Task 7 removed the persona-extension and ACP-adapter sections with their workspaces.
assert.ok(sections.length >= 32, `every planned section must run (ran ${sections.length})`);
console.log(`FULL SURFACE JOURNEY OK (${sections.length} sections)`);
console.log(sections.map((s) => `  - ${s}`).join("\n"));
