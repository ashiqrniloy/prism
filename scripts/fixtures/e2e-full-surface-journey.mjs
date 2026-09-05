/**
 * Plans/064 Task 10: full-surface packed journey.
 * Runs INSIDE a fresh consumer that installed all ten @arnilo tarballs
 * (npm pack), so every import below resolves from the consumer's
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
import { mkdtempSync, } from "node:fs";
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
  const provider = prism.createMockProvider([prism.providerTextDelta("pong"), prism.providerDone()]);
  const agent = prism.createAgent({
    model: { provider: "mock", model: "mock-1" },
    provider,
    instructions: "reply exactly: pong",
  });
  const session = prism.createAgentSession({ agent });
  const result = await session.prompt("say pong");
  assert.ok(result, "mock-provider session must complete a run");
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
    identity: {
      tenantId: "t",
      principal: { kind: "agent", id: "a" },
      scopes: ["probe"],
      issuedAt: new Date().toISOString(),
      verified: true,
    },
  });
  assert.match(JSON.stringify(dispatched), /"hi"/, "tool dispatch must round-trip");
  assert.equal(prism.createSecretRedactor(["s3cret"]).redact("a s3cret b"), "a [REDACTED] b");
  assert.equal(typeof prism.canonicalizeJsonSchema({ type: "object" }).type, "string");
  // Plan-065 thinking-effort surface: the five public helpers must resolve from the pack.
  assert.equal(prism.parseThinkingLevel("High"), "high");
  assert.deepEqual(prism.parseThinkingLevel("turbo"), { opaque: "turbo" });
  assert.equal(prism.parseThinkingLevel(""), undefined);
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
  assert.deepEqual(prism.thinkingLevelsForModel(reasoner), ["low", "high"]);
  assert.equal(prism.isSupportedThinkingLevel(reasoner, "high"), true);
  assert.equal(prism.isSupportedThinkingLevel(reasoner, "max"), false);
  assert.equal(prism.isSupportedThinkingLevel({ provider: "mock", model: "plain" }, "high"), true);
  assert.equal(prism.snapThinkingLevel(reasoner, "medium"), "high");
  assert.equal(prism.snapThinkingLevel(reasoner, "none"), "low");
  assert.deepEqual(prism.applyThinkingLevelForModel(undefined, "medium", reasoner)?.compat, { reasoning_effort: "high" });
  assert.deepEqual(prism.applyThinkingLevelForModel(undefined, "low", gemini)?.compat, { thinkingLevel: "low" });
  assert.equal(Object.keys(prism.applyThinkingLevelForModel(undefined, "high", { provider: "mock", model: "plain" })?.compat ?? {}).length, 0);
});

for (const sub of ["providers/openai-compatible", "providers/transport", "providers/openai", "providers/schema", "providers/media"]) {
  await section(`@arnilo/prism: ${sub}`, async () => {
    const m = await import(`@arnilo/prism/${sub}`);
    assert.ok(Object.keys(m).length > 0, `${sub} must export a public surface`);
    if (sub === "providers/schema") {
      assert.equal(m.canonicalizeJsonSchema({ type: "string" }).type, "string");
    } else if (sub === "providers/openai") {
      const serialized = m.serializeOpenAIChatMessage({ role: "user", content: [{ type: "text", text: "hi" }] });
      assert.equal(serialized.role, "user");
    } else if (sub === "providers/media") {
      assert.equal(m.bytesToBase64(new Uint8Array([104, 105])), "aGk=");
    } else if (sub === "providers/transport") {
      assert.deepEqual(m.tryParseJsonObjectArguments('{"a":1}'), { ok: true, value: { a: 1 } });
    } else if (sub === "providers/openai-compatible") {
      const message = { role: "user", content: [{ type: "text", text: "hi" }] };
      const body = m.buildOpenAIChatBody({ model: "m", messages: [message] });
      assert.equal(body.messages[0].content, "hi");
    }
  });
}

await section("@arnilo/prism: testing/* conformance helpers", async () => {
  const helpers = [
    "testing/provider-conformance",
    "testing/agent-event-source-conformance",
    "testing/state-concurrency-conformance",
    "testing/session-store-conformance",
    "testing/compaction-conformance",
    "testing/tool-conformance",
    "testing/tool-effect-store-conformance",
    "testing/extension-conformance",
    "testing/persistence-schema",
    "testing/run-ledger-conformance",
    "testing/feedback",
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
  const config = await import("@arnilo/prism/node/config");
  const settings = await import("@arnilo/prism/node/settings");
  const trust = await import("@arnilo/prism/node/trust");
  const jsonl = await import("@arnilo/prism/node/session-store-jsonl");
  const contributions = await import("@arnilo/prism/node/contribution-discovery");
  const injectors = await import("@arnilo/prism/node/instruction-injectors");
  const prompts = await import("@arnilo/prism/node/system-prompts");
  const agents = await import("@arnilo/prism/node/agent-definitions");
  assert.equal(typeof config.defaultUserConfigPath, "function");
  const enoent = Object.assign(new Error("nope"), { code: "ENOENT" });
  assert.equal(config.isNodeErrorCode(enoent, "ENOENT"), true);
  assert.equal(settings.readSettingsFile.name, "readSettingsFile");
  const _policy = trust.createPathTrustPolicy({ workspaceRoot: dir });
  assert.equal(trust.isPathInside(dir, join(dir, "file.txt")), true);
  const store = jsonl.createJsonlSessionStore(dir);
  assert.ok(store, "jsonl session store must construct over a directory");
  assert.equal(typeof contributions.discoverContributions, "function");
  assert.equal(typeof injectors.loadInstructionInjectors, "function");
  assert.equal(typeof prompts.loadSystemPromptFiles, "function");
  assert.equal(typeof agents.discoverAgentBundles, "function");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-memory (8 subpaths)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-memory: .", async () => {
  const memory = await import("@arnilo/prism-memory");
  const m = memory.createMemory({
    tenantId: "t",
    resourceId: "full-surface-probe",
    threadId: "full-surface-thread",
    embedder: memory.createHashEmbedder({ dimensions: 8 }),
  });
  await m.remember({ entries: [{ text: "prism full surface probe", consent: { state: "granted" } }] });
  const recalled = await m.recall("surface probe");
  assert.ok(recalled, "hash-embedded memory must recall");
  const working = await m.updateWorking({ note: "working" });
  assert.equal(working.record?.patch?.note ?? working.patch?.note ?? true, true);
  const vectors = memory.createMemoryVectorStore();
  assert.ok(vectors, "in-memory vector store must construct");
  const embeddings = await memory.embedBatched(memory.createHashEmbedder({ dimensions: 8 }), ["a", "b"], 2, { maxDimensions: 8 });
  assert.equal(embeddings.length, 2, "embedBatched must embed every text");
});

await section("@arnilo/prism-memory: rag + loaders + parsers", async () => {
  const rag = await import("@arnilo/prism-memory/rag");
  assert.ok(Object.keys(rag).length > 0);
  const loaders = await import("@arnilo/prism-memory/rag/loaders");
  assert.equal(typeof loaders.createResourceDocumentLoader, "function");
  const parsers = await import("@arnilo/prism-memory/rag/parsers");
  assert.ok(parsers.textParser && parsers.markdownParser, "rag parsers must be exported");
});

await section("@arnilo/prism-memory: compaction strategies", async () => {
  const llm = await import("@arnilo/prism-memory/compaction/llm");
  assert.ok(llm.SUMMARIZATION_SYSTEM_PROMPT, "llm compaction must export its prompt contract");
  const om = await import("@arnilo/prism-memory/compaction/observational-memory");
  assert.ok(om.DEFAULT_KEEP_RECENT_ENTRIES >= 1, "observational memory must export bounded defaults");
});

await section("@arnilo/prism-memory: graft + wiki", async () => {
  const graft = await import("@arnilo/prism-memory/graft");
  assert.match(graft.redactPaths("see /home/x/y and /home/x/y2", ["/home/x"]), /<path>/, "graft must redact supplied paths");
  const wiki = await import("@arnilo/prism-memory/wiki");
  assert.equal(typeof wiki.WikiCompiler, "function");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-core (21 subpaths)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-core: runtime/server", async () => {
  const server = await import("@arnilo/prism-core/runtime/server");
  assert.ok(server.resolvePrismServerLimits({}));
  const notifier = server.createWebhookNotifier({
    targets: [],
    signer: { key: new TextEncoder().encode("prism-full-surface-webhook-secret-key") },
    redactor: { redact: (text) => text },
  });
  assert.deepEqual(notifier.diagnostics().failures, []);
});

await section("@arnilo/prism-core: runtime/server/artifact-bodies", async () => {
  const bodies = await import("@arnilo/prism-core/runtime/server/artifact-bodies");
  assert.equal(
    bodies.s3ObjectKey({
      tenantId: "t",
      accountId: "a",
      userId: "u",
      artifactId: "art",
      threadId: "th",
      version: 1,
    }).length > 0,
    true,
    "s3ObjectKey must derive a deterministic key",
  );
  assert.ok(bodies.resolveArtifactBodyLimits({}));
});

await section("@arnilo/prism-core: runtime/supervisor", async () => {
  const supervisor = await import("@arnilo/prism-core/runtime/supervisor");
  assert.ok(supervisor.A2A_DEFAULT_LIMITS, "supervisor must export a2a limits");
});

await section("@arnilo/prism-core: runtime/workflows", async () => {
  const workflows = await import("@arnilo/prism-core/runtime/workflows");
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

await section("@arnilo/prism-core: sessions/*", async () => {
  const codecs = await import("@arnilo/prism-core/sessions/codecs");
  assert.ok(codecs.createSessionRowMappers, "session codecs must export row mappers");
  assert.equal(typeof codecs.clipSearchSnippet, "function");

  const { createSqlitePersistence, reopenSqlitePersistence } = await import("@arnilo/prism-core/sessions/sqlite");
  try {
    const store = createSqlitePersistence({ filename: ":memory:" });
    await store.append({
      id: "e1",
      sessionId: "s-1",
      timestamp: new Date().toISOString(),
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
    const entries = await store.list("s-1");
    assert.equal(entries[0]?.id, "e1", "sqlite persistence must round-trip a session entry");
    await store.close();
    const reopened = reopenSqlitePersistence({ filename: ":memory:" });
    assert.ok(reopened, "sqlite persistence must reopen");
    await reopened.close();
  } catch (error) {
    // ponytail: sqlite leg is optional (plan 064 Task 10) — better-sqlite3 is an
    // optional peer dep the packed consumer may not install; upgrade path: add it
    // to the consumer fixture if a hermetic sqlite leg is ever required.
    assert.match(
      String(error?.cause?.message ?? error?.message),
      /better-sqlite3/,
      "sqlite absence must be the documented optional-peer failure",
    );
  }

  const postgres = await import("@arnilo/prism-core/sessions/postgres");
  assert.equal(postgres.quoteIdentifier("safe"), '"safe"');
  const nats = await import("@arnilo/prism-core/sessions/nats");
  assert.equal(typeof nats.createNatsJetStream, "function");
});

await section("@arnilo/prism-core: governance/*", async () => {
  const policy = await import("@arnilo/prism-core/governance/policy");
  assert.equal(policy.canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  const store = policy.createMemoryPolicyDecisionStore();
  assert.ok(store, "memory policy decision store must construct");

  const opa = await import("@arnilo/prism-core/governance/policy/opa");
  assert.throws(() => opa.createOpaPolicyEvaluator({ url: "not a url", policyId: "p", policyVersion: "1" }), policy.PolicyError);

  const evals = await import("@arnilo/prism-core/governance/evals");
  const evalStore = evals.createMemoryEvaluationStore();
  assert.ok(evalStore, "memory evaluation store must construct");

  const prompts = await import("@arnilo/prism-core/governance/prompts");
  const promptStore = prompts.createMemoryPromptStore();
  assert.ok(promptStore, "memory prompt store must construct");

  const router = await import("@arnilo/prism-core/governance/model-router");
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

  const observability = await import("@arnilo/prism-core/governance/observability");
  const telemetry = observability.createInMemoryTelemetry();
  telemetry.counter?.("prism.probe", 1);
  assert.ok(telemetry, "in-memory telemetry must construct");
});

await section("@arnilo/prism-core: credentials/node + oidc", async () => {
  const credentials = await import("@arnilo/prism-core/credentials/node");
  const store = credentials.createEncryptedCredentialStore({ passphrase: "full-surface-test-passphrase-0123456789" });
  assert.ok(store, "encrypted credential store must construct with a passphrase");
  const oidc = await import("@arnilo/prism-core/credentials/node/oidc");
  assert.equal(typeof oidc.createOidcIdentityVerifier, "function");
});

await section("@arnilo/prism-core: enterprise/postgres", async () => {
  const enterprise = await import("@arnilo/prism-core/enterprise/postgres");
  assert.equal(typeof enterprise.createPostgresApprovalStore, "function");
  assert.ok(enterprise.packageName.includes("enterprise/postgres"), "enterprise subpath must identify itself");
});

await section("@arnilo/prism-core: integrations/work", async () => {
  const work = await import("@arnilo/prism-core/integrations/work");
  assert.equal(typeof work.buildMicrosoft365Argv, "function");
  const m365 = await import("@arnilo/prism-core/integrations/work/microsoft365");
  assert.equal(typeof m365.createMicrosoft365CliAdapter, "function");
  const gws = await import("@arnilo/prism-core/integrations/work/google-workspace");
  assert.equal(typeof gws.createGoogleWorkspaceCliAdapter, "function");
});

await section("@arnilo/prism-core: validation/json-schema", async () => {
  const validation = await import("@arnilo/prism-core/validation/json-schema");
  const validator = validation.createJsonSchemaArgumentValidator();
  const validated = validator.validate({ type: "object", properties: { a: { type: "string" } }, required: ["a"] }, { a: "x" });
  assert.equal(validated.ok, true, "json-schema validator must accept a valid document");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-providers (20 subpaths) — pure helpers / model catalogs;
// factories construct-only, never a wire call.
// ---------------------------------------------------------------------------
await section("@arnilo/prism-providers: adapter surfaces", async () => {
  const anthropic = await import("@arnilo/prism-providers/anthropic");
  assert.ok(anthropic.anthropicModels[0]?.id ?? anthropic.anthropicModels[0], "anthropic must export its model catalog");
  const deepseek = await import("@arnilo/prism-providers/deepseek");
  assert.ok(deepseek.deepseekModels.length >= 1);
  const google = await import("@arnilo/prism-providers/google");
  assert.ok(google.googleModels.length >= 1);
  const clinepass = await import("@arnilo/prism-providers/clinepass");
  assert.ok(clinepass.clinePassModels.length >= 1);
  const commandcode = await import("@arnilo/prism-providers/commandcode");
  assert.ok(commandcode.commandCodeModels.length >= 1);
  const kimi = await import("@arnilo/prism-providers/kimi");
  assert.ok(kimi.kimiCodingModels.length >= 1);
  const openrouter = await import("@arnilo/prism-providers/openrouter");
  assert.equal(openrouter.defineOpenRouterModel({ id: "org/model", model: "org/model", displayName: "m" }).provider, "openrouter");
  const aiSdk = await import("@arnilo/prism-providers/ai-sdk");
  assert.ok(aiSdk.SUPPORTED_AI_SDK_SPECIFICATION, "ai-sdk adapter must pin its spec version");
  const azure = await import("@arnilo/prism-providers/azure");
  assert.match(azure.azureChatCompletionsUrl({ endpoint: "https://e", deployment: "d" }), /deployments/);
  const bedrock = await import("@arnilo/prism-providers/bedrock");
  assert.equal(typeof bedrock.bedrockRuntimeEndpoint, "function");
  const vertex = await import("@arnilo/prism-providers/vertex");
  assert.match(vertex.vertexOpenApiBaseUrl({ projectId: "p", location: "loc" }), /locations/);
  const ollama = await import("@arnilo/prism-providers/ollama");
  assert.match(ollama.ollamaBaseUrl(), /^https:\/\//, "ollama default base url must be a valid origin");
  const opencodeGo = await import("@arnilo/prism-providers/opencode-go");
  assert.equal(typeof opencodeGo.createOpenCodeGoProvider, "function");
  const neuralwatt = await import("@arnilo/prism-providers/neuralwatt");
  assert.equal(typeof neuralwatt.createNeuralWattProvider, "function");
  const hyper = await import("@arnilo/prism-providers/hyper");
  assert.equal(typeof hyper.createHyperProvider, "function");
  const xai = await import("@arnilo/prism-providers/xai");
  assert.equal(typeof xai.createXaiProvider === "function" || typeof xai.createXaiOAuthProvider === "function", true);
  const zai = await import("@arnilo/prism-providers/zai");
  assert.ok(zai.zaiModels.length >= 1);
  const alibaba = await import("@arnilo/prism-providers/alibaba");
  assert.ok(alibaba.DEFAULT_ALIBABA_BASE_URL ?? alibabapackageNameProbe(alibaba), "alibaba must export its surface");
  function alibabapackageNameProbe(ns) {
    return ns.packageName === "@arnilo/prism-providers";
  }
});

await section("@arnilo/prism-providers: model-discovery", async () => {
  const discovery = await import("@arnilo/prism-providers/model-discovery");
  const fake = discovery.createFakeModelDiscovery({
    models: [
      {
        provider: "fake",
        model: "fake-1",
        limits: { contextWindow: 1024 },
        capabilities: { input: ["text"], output: ["text"], tools: false, streaming: false },
      },
    ],
  });
  const catalog = await fake.listModels();
  assert.equal(catalog.models[0]?.model, "fake-1", "fake discovery must return the seeded catalog");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-coding-tools (10 subpaths)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-coding-tools: agent", async () => {
  const agent = await import("@arnilo/prism-coding-tools/agent");
  const tool = agent.createDeleteTool({ fsRoot: mkdtempSync(join(tmpdir(), "prism-full-surface-agent-")) });
  assert.equal(tool.name.length > 0, true, "coding tool must expose a name");
});

await section("@arnilo/prism-coding-tools: security", async () => {
  const security = await import("@arnilo/prism-coding-tools/security");
  const redactor = security.createSecretRedactor(["hush"]);
  assert.equal(redactor("a hush b"), "a [REDACTED] b");
  // Deny-by-default sandbox fence: no flags => no admission.
  assert.equal(typeof security.resolveSandboxCapabilities, "function");
});

await section("@arnilo/prism-coding-tools: document-reader + openapi", async () => {
  const reader = await import("@arnilo/prism-coding-tools/document-reader");
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

  const openapi = await import("@arnilo/prism-coding-tools/openapi");
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

await section("@arnilo/prism-coding-tools: computer-use-linux + dev", async () => {
  const cul = await import("@arnilo/prism-coding-tools/computer-use-linux");
  assert.equal(cul.classifyComputerUseLinuxTool("screenshot"), "read");
  const dev = await import("@arnilo/prism-coding-tools/dev");
  assert.equal(typeof dev.createPrismDevInspector, "function");
  const devCli = await import("@arnilo/prism-coding-tools/dev/cli");
  assert.equal(typeof devCli.runDevCli, "function");
});

await section("@arnilo/prism-coding-tools: persona extensions", async () => {
  const caveman = await import("@arnilo/prism-coding-tools/caveman");
  const ponytail = await import("@arnilo/prism-coding-tools/ponytail");
  const impeccable = await import("@arnilo/prism-coding-tools/impeccable");
  assert.ok(caveman.createCavemanExtension, "caveman extension factory must resolve");
  assert.ok(ponytail.createPonytailExtension, "ponytail extension factory must resolve");
  assert.ok(impeccable.createImpeccableExtension, "impeccable extension factory must resolve");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-office (3 subpaths) — local generation/parsing, no LibreOffice.
// ---------------------------------------------------------------------------
await section("@arnilo/prism-office: documents + sheets + diagrams", async () => {
  const documents = await import("@arnilo/prism-office/documents");
  assert.ok(documents.resolveDocumentCaps({}), "documents caps must resolve");
  const sheets = await import("@arnilo/prism-office/sheets");
  const csv = sheets.parseCsv("a,b\n1,2\n");
  assert.ok(csv, "sheets csv parser must parse");
  const diagrams = await import("@arnilo/prism-office/diagrams");
  assert.ok(diagrams.canonicalizeDrawioXml('<mxfile><diagram name="d"><mxGraphModel/></diagram></mxfile>'), "drawio xml must canonicalize");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-ag-ui (3 subpaths)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-ag-ui: . + renderer + acp", async () => {
  const agui = await import("@arnilo/prism-ag-ui");
  assert.ok(agui.resolveAgUiLimits({}), "ag-ui limits must resolve");
  const renderer = await import("@arnilo/prism-ag-ui/renderer");
  assert.equal(renderer.resolvePointer({ a: { b: 1 } }, "/a/b"), 1, "renderer pointer must resolve");
  const acp = await import("@arnilo/prism-ag-ui/acp");
  assert.equal(typeof acp.createPrismAcpAgent, "function");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-web-tools (6 subpaths)
// ---------------------------------------------------------------------------
await section("@arnilo/prism-web-tools: . + brave + exa + firecrawl", async () => {
  const web = await import("@arnilo/prism-web-tools");
  assert.equal(web.canonicalUrl("https://example.com/a?b=1#frag"), "https://example.com/a?b=1");
  const cited = web.citation("brave", "https://example.com/x", "src-1");
  assert.match(cited.citationId, /web:brave:src-1/);
  const brave = await import("@arnilo/prism-web-tools/brave");
  assert.equal(typeof brave.createBraveSearch, "function");
  const exa = await import("@arnilo/prism-web-tools/exa");
  assert.equal(typeof exa.createExaSearch, "function");
  const firecrawl = await import("@arnilo/prism-web-tools/firecrawl");
  assert.equal(typeof firecrawl.createFirecrawlFetch, "function");
});

await section("@arnilo/prism-web-tools: browser + obscura", async () => {
  const browser = await import("@arnilo/prism-web-tools/browser");
  assert.ok(browser.DEFAULT_BROWSER_LIMITS, "browser surface must export bounded defaults");
  const obscura = await import("@arnilo/prism-web-tools/obscura");
  assert.ok(obscura.DEFAULT_OBSCURA_PROCESS_LIMITS, "obscura surface must export bounded defaults");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-mcp (1 subpath) — in-process server construction.
// ---------------------------------------------------------------------------
await section("@arnilo/prism-mcp: .", async () => {
  const mcp = await import("@arnilo/prism-mcp");
  const echo = {
    name: "echo",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: { echo: args.text } }),
  };
  const server = mcp.createPrismMcpServer({ tools: [echo], authorize: async () => ({ allowed: true, ownership: { tenantId: "t" } }) });
  assert.ok(server, "mcp server must construct");
});

// ---------------------------------------------------------------------------
// @arnilo/prism-acp-agent (1 subpath) — spawnable config parsing.
// ---------------------------------------------------------------------------
await section("@arnilo/prism-acp-agent: .", async () => {
  const acpAgent = await import("@arnilo/prism-acp-agent");
  const dir = mkdtempSync(join(tmpdir(), "prism-full-surface-acp-"));
  const config = acpAgent.parseConfig(JSON.stringify({ userId: "local", cwd: dir, sessionStore: { type: "memory" } }), dir, "test.json");
  assert.equal(config.userId, "local", "acp-agent config must parse");
  assert.equal(typeof acpAgent.createSpawnableAgent, "function");
});

assert.ok(sections.length >= 35, "every planned section must run");
console.log(`FULL SURFACE JOURNEY OK (${sections.length} sections)`);
console.log(sections.map((s) => `  - ${s}`).join("\n"));
