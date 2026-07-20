import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: one config entry per published package; adding a package is one line
const packages = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/provider-openai", name: "@arnilo/prism-provider-openai" },
  { dir: "packages/provider-opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/provider-openrouter", name: "@arnilo/prism-provider-openrouter" },
  { dir: "packages/provider-zai", name: "@arnilo/prism-provider-zai" },
  { dir: "packages/provider-kimi", name: "@arnilo/prism-provider-kimi" },
  { dir: "packages/provider-neuralwatt", name: "@arnilo/prism-provider-neuralwatt" },
  { dir: "packages/provider-ai-sdk", name: "@arnilo/prism-provider-ai-sdk" },
  { dir: "packages/coding-agent", name: "@arnilo/prism-coding-agent" },
  { dir: "packages/compaction-llm", name: "@arnilo/prism-compaction-llm" },
  { dir: "packages/compaction-observational-memory", name: "@arnilo/prism-compaction-observational-memory" },
  { dir: "packages/observability-opentelemetry", name: "@arnilo/prism-observability-opentelemetry" },
  { dir: "packages/tool-validator-json-schema", name: "@arnilo/prism-tool-validator-json-schema" },
  { dir: "packages/mcp", name: "@arnilo/prism-mcp" },
  { dir: "packages/session-store-sqlite", name: "@arnilo/prism-session-store-sqlite" },
  { dir: "packages/session-store-postgres", name: "@arnilo/prism-session-store-postgres" },
  { dir: "packages/credentials-node", name: "@arnilo/prism-credentials-node" },
  { dir: "packages/coding-security", name: "@arnilo/prism-coding-security" },
  { dir: "packages/workflows", name: "@arnilo/prism-workflows" },
  { dir: "packages/evals", name: "@arnilo/prism-evals" },
  { dir: "packages/memory", name: "@arnilo/prism-memory" },
  { dir: "packages/rag", name: "@arnilo/prism-rag" },
  { dir: "packages/server", name: "@arnilo/prism-server" },
  { dir: "packages/supervisor", name: "@arnilo/prism-supervisor" },
  { dir: "packages/web-tools", name: "@arnilo/prism-web-tools" },
  // Pure-manifest family/profile packages (no dist/exports): pack + install, but skip dynamic-import.
  { dir: "packages/prism-providers", name: "@arnilo/prism-providers", isMeta: true },
  { dir: "packages/prism-compaction", name: "@arnilo/prism-compaction", isMeta: true },
  { dir: "packages/prism-base", name: "@arnilo/prism-base", isMeta: true },
  { dir: "packages/prism-code", name: "@arnilo/prism-code", isMeta: true },
  { dir: "packages/prism-sdk", name: "@arnilo/prism-sdk", isMeta: true },
  { dir: "packages/prism-all", name: "@arnilo/prism-all", isMeta: true },
];

// Derive every documented core import specifier from the root `exports` map so
// the smoke test cannot drift from the public contract.
function coreSpecifiers(): string[] {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const specs = ["@arnilo/prism"];
  for (const key of Object.keys(pkg.exports)) {
    if (key === ".") continue;
    specs.push("@arnilo/prism" + key.slice(1)); // "./node/config" -> "@arnilo/prism/node/config"
  }
  return specs;
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

const staging = mkdtempSync(join(tmpdir(), "prism-smoke-stage-"));
const consumer = mkdtempSync(join(tmpdir(), "prism-smoke-consumer-"));

const result = { installStatus: -1, smokeStatus: -1, integrationStatus: -1, compositionStatus: -1, smokeOut: "", integrationOut: "", compositionOut: "", junk: [] as string[], secretFindings: [] as string[], tarballNames: [] as string[] };

before(() => {
  // 1. Pack core + every first-party package into the staging dir.
  for (const pkg of packages) {
    const r = run("npm", ["pack", "--pack-destination", staging], join(repoRoot, pkg.dir));
    if (r.status !== 0) throw new Error(`npm pack failed for ${pkg.name}:\n${r.stdout}\n${r.stderr}`);
  }
  const tarballs = readdirSync(staging)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => join(staging, f));
  result.tarballNames = tarballs.map((f) => f.split("/").pop()!);

  // 2. Fresh consumer project; install all tarballs together so the required
  //    `prism` peer is satisfied locally with no registry traffic.
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "@arnilo-prism-install-smoke", type: "module" }, null, 2),
  );
  const installArgs = [
    "install",
    ...tarballs,
    "--offline",
    "--no-audit",
    "--no-fund",
    "--no-update-notifier",
  ];
  let install = run("npm", installArgs, consumer);
  if (install.status !== 0) {
    // Fallback: cold cache or offline-unfriendly environment; no runtime deps
    // means this still makes zero registry fetches.
    install = run(
      "npm",
      ["install", ...tarballs, "--no-audit", "--no-fund", "--no-update-notifier"],
      consumer,
    );
  }
  result.installStatus = install.status;
  if (install.status !== 0) {
    result.smokeOut = `install failed:\n${install.stdout}\n${install.stderr}`;
    return;
  }

  // 3. Dynamic-import every documented specifier from the fresh install.
  const specs = [...coreSpecifiers(), ...packages.filter((p) => !p.isCore && !p.isMeta).map((p) => p.name)];
  writeFileSync(
    join(consumer, "smoke.mjs"),
    `const specs = ${JSON.stringify(specs)};\n` +
      "for (const s of specs) {\n" +
      "  try { await import(s); }\n" +
      "  catch (e) { console.error('IMPORT FAILED:', s, e.message); process.exit(1); }\n" +
      "}\nconsole.log('ALL IMPORTS OK');\n",
  );
  const smoke = run("node", ["smoke.mjs"], consumer);
  result.smokeStatus = smoke.status;
  result.smokeOut = smoke.stdout + smoke.stderr;

  // 4. Exercise validator + parallel local/MCP/coding tools from packed public imports.
  writeFileSync(join(consumer, "integration.mjs"), `
import assert from "node:assert/strict";
import {
  createAgent, createSecretRedactor, createToolRegistry, dispatchToolCall,
  providerDone, providerTextDelta,
} from "@arnilo/prism";
import { createShellTool, createWriteTool } from "@arnilo/prism-coding-agent";
import { createCodingApprovalPolicy } from "@arnilo/prism-coding-security";
import { mapMcpToolsToDefinitions } from "@arnilo/prism-mcp";
import { createJsonSchemaToolArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let active = 0;
let maxActive = 0;
const starts = [];
const run = async (name, ms, value) => {
  starts.push(name); active++; maxActive = Math.max(maxActive, active);
  await sleep(ms); active--; return value;
};
const local = {
  name: "local",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  execute: async (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "local", value: await run("local", 40, args.text) }),
};
const [mcp] = mapMcpToolsToDefinitions(
  [{ name: "echo", description: "echo", inputSchema: local.parameters }],
  {
    namePrefix: "mcp:demo:", serverId: "demo", callTimeoutMs: 1000, maxResultBytes: 1000,
    isClosed: () => false,
    callRemoteTool: async (_name, args, ctx) => ({ toolCallId: ctx.toolCallId, name: "mcp:demo:echo", value: await run("mcp", 5, args.text) }),
  },
);
const approvals = [];
const policy = createCodingApprovalPolicy({ roots: [process.cwd()], approve: (request) => { approvals.push(request.action.kind); return true; } });
const shell = createShellTool(process.cwd(), {
  executionPolicy: policy,
  operations: { exec: async () => ({ exitCode: await run("shell", 15, 0) }) },
});
const tools = [local, mcp, shell];
let turn = 0;
const provider = { id: "mock", async *generate() {
  if (turn++ === 0) {
    yield { type: "tool_call", call: { type: "tool_call", id: "c1", name: "local", arguments: { text: "slow" } } };
    yield { type: "tool_call", call: { type: "tool_call", id: "c2", name: "mcp:demo:echo", arguments: { text: "fast" } } };
    yield { type: "tool_call", call: { type: "tool_call", id: "c3", name: "shell", arguments: { command: "echo safe" } } };
  } else yield providerTextDelta("done");
  yield providerDone();
} };
const canary = "packed-integration-secret";
const agent = createAgent({
  model: { provider: "mock", model: "demo" }, provider, tools,
  validator: createJsonSchemaToolArgumentValidator(), redactor: createSecretRedactor([canary]),
  loop: { strategy: "single-shot", toolConcurrency: 3 },
});
const session = agent.createSession({ id: "packed-integration" });
const events = [];
const reader = (async () => { for await (const event of session.subscribe()) events.push(event); })();
await session.run(canary, { maxToolRounds: 1 });
await reader;
const finished = events.filter((event) => event.type === "tool_execution_finished");
assert.equal(finished.length, 3);
const entries = await session.entries();
const orderedResults = entries.flatMap((entry) => entry.message?.content ?? []).filter((block) => block.type === "tool_result");
assert.deepEqual(orderedResults.map((block) => block.toolCallId), ["c1", "c2", "c3"]);
assert.equal(maxActive, 1, "exclusive shell overlapped a sibling call");
assert.ok(approvals.includes("shell"), "shell approval was not requested");
assert.equal(JSON.stringify(entries).includes(canary), false, "canary leaked into store");

const registry = createToolRegistry(tools);
const startsBeforeInvalid = starts.length;
const invalid = await dispatchToolCall({
  registry, call: { type: "tool_call", id: "bad", name: "local", arguments: { text: 1 } },
  context: { sessionId: "s", runId: "r", toolCallId: "bad" }, validate: createJsonSchemaToolArgumentValidator(),
});
assert.match(invalid.error?.message ?? "", /string/i);
assert.equal(starts.length, startsBeforeInvalid, "invalid args reached handler");
const deniedWrite = createWriteTool(process.cwd(), {
  executionPolicy: createCodingApprovalPolicy({ roots: [process.cwd()], readOnly: true }),
  operations: { mkdir: async () => assert.fail("denied write reached mkdir"), writeFile: async () => assert.fail("denied write reached writeFile") },
});
const denied = await dispatchToolCall({
  registry: createToolRegistry([deniedWrite]), call: { type: "tool_call", id: "deny", name: "write", arguments: { path: "blocked.txt", content: "x" } },
  context: { sessionId: "s", runId: "r", toolCallId: "deny" }, validate: createJsonSchemaToolArgumentValidator(),
});
assert.ok(denied.error, "read-only policy allowed write");
console.log("PACKED INTEGRATION OK");
`);
  const integration = run("node", ["integration.mjs"], consumer);
  result.integrationStatus = integration.status;
  result.integrationOut = integration.stdout + integration.stderr;

  // 5. Compose every 0.0.8 optional capability family from packed public imports.
  writeFileSync(join(consumer, "composition.mjs"), `
import assert from "node:assert/strict";
import {
  createAgent, createMemoryCheckpointStore, createMemoryLeaseStore, createMemoryRunFeedbackStore,
  createMockProvider, providerDone, providerTextDelta,
} from "@arnilo/prism";
import { createAiSdkProvider } from "@arnilo/prism-provider-ai-sdk";
import { appendEvaluationFeedback, createMemoryEvaluationStore, defineScorer, scoreRun } from "@arnilo/prism-evals";
import { createHashEmbedder, createMemory, createMemoryVectorStore } from "@arnilo/prism-memory";
import { chunkMarkdown, indexChunks, retrieveContext } from "@arnilo/prism-rag";
import {
  createMemoryWorkflowCheckpoints, createWorkflowCheckpoints, createWorkflowCoordinator, createWorkflowSchedules,
  defineWorkflow, functionNode, replayWorkflow, resumeWorkflow, runWorkflow, suspend,
} from "@arnilo/prism-workflows";
import { createPrismHandler } from "@arnilo/prism-server";
import { createPrismMcpServer } from "@arnilo/prism-mcp";
import { createA2AClient, createA2AHandler, createSupervisor } from "@arnilo/prism-supervisor";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const ownership = { tenantId: "packed", userId: "operator" };
const fakeModel = {
  specificationVersion: "v4", provider: "fake", modelId: "packed", supportedUrls: {},
  async doGenerate() { throw new Error("stream only"); },
  async doStream() { return { stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "text-delta", id: "t1", delta: "packed-result" });
    controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: {
      inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 },
    } });
    controller.close();
  } }) }; },
};
const aiProvider = createAiSdkProvider({ model: fakeModel });
const aiAgent = createAgent({ provider: aiProvider, model: { provider: aiProvider.id, model: "packed" } });
const streamed = [];
for await (const event of aiAgent.createSession().stream("stream")) streamed.push(event.type);
const runResult = await aiAgent.createSession().run("run");
assert.equal(runResult.text, "packed-result");
assert.ok(streamed.includes("message_delta"));

const embedder = createHashEmbedder({ dimensions: 16 });
const memory = createMemory({ tenantId: "packed", resourceId: "user", threadId: "thread", embedder });
await memory.updateWorking({ preference: "short" });
await memory.remember({ entries: [{ id: "memory-1", text: "prefers short answers", sequence: 1 }] }, { wait: true });
assert.equal((await memory.getWorking()).value.preference, "short");
assert.equal((await memory.recall("short", { topK: 1 })).hits.length, 1);
const vectors = createMemoryVectorStore();
const ragScope = { tenantId: "packed", resourceId: "docs", corpusId: "guide" };
await indexChunks({ chunks: chunkMarkdown("# Approval\\n\\nResume rechecks policy.", { sourceId: "guide" }), embedder, store: vectors, scope: ragScope });
const rag = await retrieveContext("approval policy", { embedder, store: vectors, scope: ragScope });
assert.equal(rag.citations.length, 1);

const evaluations = createMemoryEvaluationStore();
const [evaluation] = await scoreRun({
  result: runResult, ownership, store: evaluations,
  scorers: [defineScorer({ id: "exact", score: ({ result }) => ({ score: result.text === "packed-result" ? 1 : 0 }) })],
});
assert.equal(evaluation.score, 1);
const feedback = createMemoryRunFeedbackStore({ resolveRun: ({ runId }) => runId === runResult.runId ? { runId, sessionId: runResult.sessionId, ...ownership } : false });
const linked = await appendEvaluationFeedback({ feedbackStore: feedback, evaluationStore: evaluations, evaluationIds: [evaluation.id], feedback: { id: "feedback-1", runId: runResult.runId, rating: 1, ...ownership } });
assert.deepEqual(linked.evaluationIds, [evaluation.id]);

const approvalFlow = defineWorkflow({ revision: "1", id: "approval", nodes: {
  review: functionNode({ execute: (ctx) => ctx.resume === undefined ? suspend({ reason: "approve", data: { operation: "read" } }) : { approved: true } }),
} });
const approvalCheckpoints = createMemoryWorkflowCheckpoints();
const waiting = await runWorkflow(approvalFlow, {}, { checkpoints: approvalCheckpoints, ownership });
assert.equal(waiting.status, "suspended");
const approved = await resumeWorkflow(approvalFlow, { runId: waiting.runId }, { checkpoints: approvalCheckpoints, ownership, resume: { decision: "approve", expectedVersion: waiting.version, input: { reviewer: "operator" } } });
assert.equal(approved.status, "succeeded");

const store = createMemoryCheckpointStore();
const leases = createMemoryLeaseStore();
const checkpoints = createWorkflowCheckpoints({ store });
const scheduledFlow = defineWorkflow({ revision: "1", id: "scheduled", nodes: { done: functionNode({ execute: () => ({ done: true }) }) } });
const schedules = createWorkflowSchedules({ store, leases, checkpoints, workflows: { scheduled: scheduledFlow }, ownership, ownerId: "packed-scheduler" });
await schedules.create({ id: "once", workflowId: "scheduled", nextRunAt: "2026-01-01T00:00:00.000Z", input: {} });
await schedules.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") });
const coordinator = createWorkflowCoordinator({ coordinatorId: "packed-worker", workflows: { scheduled: scheduledFlow }, checkpoints, leases, ownership });
await coordinator.pollOnce();
while (coordinator.activeRuns) await new Promise((resolve) => setTimeout(resolve, 1));
const schedule = await schedules.get("once");
assert.ok(schedule.lastRunId);
const replay = await replayWorkflow(scheduledFlow, { sourceRunId: schedule.lastRunId, fromNodeId: "done" }, { checkpoints, ownership });
assert.equal(replay.lineage.sourceRunId, schedule.lastRunId);

const servedAgent = () => createAgent({ model: { provider: "mock", model: "served" }, provider: createMockProvider([providerTextDelta("served"), providerDone()]) });
const handler = createPrismHandler({ agents: { demo: servedAgent() }, authorize: () => ({ ownership }) });
const served = await handler(new Request("https://packed.test/prism/agents/demo/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "hello" }) }));
assert.equal(served.status, 200);
assert.equal((await served.json()).text, "served");

const mcpServer = createPrismMcpServer({ tools: [{ name: "echo", parameters: { type: "object" }, execute: (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: args }) }], authorize: () => ({ allowed: true, ownership }) });
const mcpClient = new Client({ name: "packed", version: "1" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await mcpServer.connect(serverTransport); await mcpClient.connect(clientTransport);
assert.equal((await mcpClient.callTool({ name: "echo", arguments: { ok: true } })).isError, false);
await mcpClient.close(); await mcpServer.close();

const supervisor = createSupervisor({ ownership, children: { child: { createAgent: servedAgent } } });
assert.equal((await supervisor.delegate({ childId: "child", input: "hello" })).text, "served");
const endpoint = "https://packed-agent.test/a2a/v1";
const card = { name: "Packed", description: "Packed test agent", supportedInterfaces: [{ url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" }], version: "1", capabilities: { streaming: false }, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [] };
const a2aHandler = createA2AHandler({ card, exposure: { sessionFactory: () => servedAgent().createSession() }, authorize: () => ({ ownership }) });
const a2a = createA2AClient({ endpoint, allowedOrigins: ["https://packed-agent.test"], fetch: (input, init) => a2aHandler(new Request(input, init)) });
assert.equal((await a2a.send("hello")).text, "served");
console.log("PACKED 0.0.8 COMPOSITION OK");
`);
  const composition = run("node", ["composition.mjs"], consumer);
  result.compositionStatus = composition.status;
  result.compositionOut = composition.stdout + composition.stderr;

  // 6. Walk the installed @arnilo/prism* packages for leaked test artifacts / source maps.
  // Third-party transitive deps (e.g. `diff`) may ship their own maps; we only gate Prism packages.
  const nodeModules = join(consumer, "node_modules");
  for (const file of walkFiles(nodeModules)) {
    const rel = file.slice(nodeModules.length + 1);
    if (!rel.startsWith("@arnilo/prism")) continue;
    if (rel.includes("__tests__") || rel.endsWith(".map")) result.junk.push(rel);
    const text = readFileSync(file).toString("utf8");
    const secretPatterns = [
      new RegExp(["-----BEGIN", "PRIVATE KEY-----"].join(" ")),
      /sk-[A-Za-z0-9]{32,}/,
      /npm_[A-Za-z0-9]{32,}/,
      /ghp_[A-Za-z0-9]{32,}/,
    ];
    if (secretPatterns.some((pattern) => pattern.test(text))) result.secretFindings.push(rel);
  }
});

after(() => {
  rmSync(staging, { recursive: true, force: true });
  rmSync(consumer, { recursive: true, force: true });
});

describe("install smoke (fresh offline tarball install)", () => {
  it("installs core plus all first-party packages with a satisfied @arnilo/prism peer", () => {
    assert.equal(result.installStatus, 0, result.smokeOut);
  });

  it("every documented core subpath and every first-party package imports", () => {
    assert.equal(result.smokeStatus, 0, result.smokeOut);
  });

  it("packed validator, parallel local/MCP tools, and coding approval compose", () => {
    assert.equal(result.integrationStatus, 0, result.integrationOut);
  });

  it("packed 0.0.8 optional capabilities compose through public imports", () => {
    assert.equal(result.compositionStatus, 0, result.compositionOut);
  });

  it("installed packages contain no test artifacts, source maps, or real-looking secrets", () => {
    assert.deepEqual(result.junk, [], `leaked into installed node_modules: ${result.junk.join(", ")}`);
    assert.deepEqual(result.secretFindings, [], `secret-like value leaked into installed packages: ${result.secretFindings.join(", ")}`);
    assert.equal((result.integrationOut + result.compositionOut).includes("packed-integration-secret"), false, "canary leaked into packed journey output");
  });

  // ponytail: npm strips @scope/ from tarball names; core (@arnilo/prism) -> arnilo-prism-0.0.8.tgz.
  // Regression guard so a future rename can't silently re-mangle the published filename.
  it("core tarball filename is arnilo-prism-0.0.8.tgz (npm strips the @scope/)", () => {
    assert.ok(
      result.tarballNames.includes("arnilo-prism-0.0.8.tgz"),
      `expected 'arnilo-prism-0.0.8.tgz' in ${JSON.stringify(result.tarballNames)}`,
    );
    assert.equal(result.tarballNames.length, packages.length, "tarball count must match package count");
    // The 3 umbrella metas must be present too.
    for (const meta of ["arnilo-prism-providers-0.0.8.tgz", "arnilo-prism-compaction-0.0.8.tgz", "arnilo-prism-all-0.0.8.tgz"]) {
      assert.ok(result.tarballNames.includes(meta), `missing umbrella tarball ${meta}`);
    }
  });
});
