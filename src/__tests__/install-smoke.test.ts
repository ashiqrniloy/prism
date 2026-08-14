import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: one config entry per published package; adding a package is one line
const packages = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/provider-openai", name: "@arnilo/prism-provider-openai" },
  { dir: "packages/provider-anthropic", name: "@arnilo/prism-provider-anthropic" },
  { dir: "packages/provider-google", name: "@arnilo/prism-provider-google" },
  { dir: "packages/provider-opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/provider-openrouter", name: "@arnilo/prism-provider-openrouter" },
  { dir: "packages/provider-zai", name: "@arnilo/prism-provider-zai" },
  { dir: "packages/provider-kimi", name: "@arnilo/prism-provider-kimi" },
  { dir: "packages/provider-neuralwatt", name: "@arnilo/prism-provider-neuralwatt" },
  { dir: "packages/provider-ai-sdk", name: "@arnilo/prism-provider-ai-sdk" },
  { dir: "packages/provider-alibaba", name: "@arnilo/prism-provider-alibaba" },
  { dir: "packages/provider-ollama", name: "@arnilo/prism-provider-ollama" },
  { dir: "packages/provider-azure", name: "@arnilo/prism-provider-azure" },
  { dir: "packages/provider-bedrock", name: "@arnilo/prism-provider-bedrock" },
  { dir: "packages/provider-vertex", name: "@arnilo/prism-provider-vertex" },
  { dir: "packages/policy", name: "@arnilo/prism-policy" },
  { dir: "packages/model-router", name: "@arnilo/prism-model-router" },
  { dir: "packages/work-tools", name: "@arnilo/prism-work-tools" },
  { dir: "packages/coding-agent", name: "@arnilo/prism-coding-agent" },
  { dir: "packages/compaction-llm", name: "@arnilo/prism-compaction-llm" },
  { dir: "packages/compaction-observational-memory", name: "@arnilo/prism-compaction-observational-memory" },
  { dir: "packages/prism-caveman", name: "@arnilo/prism-caveman" },
  { dir: "packages/prism-ponytail", name: "@arnilo/prism-ponytail" },
  { dir: "packages/observability-opentelemetry", name: "@arnilo/prism-observability-opentelemetry" },
  { dir: "packages/tool-validator-json-schema", name: "@arnilo/prism-tool-validator-json-schema" },
  { dir: "packages/mcp", name: "@arnilo/prism-mcp" },
  { dir: "packages/session-store-codecs", name: "@arnilo/prism-session-store-codecs" },
  { dir: "packages/session-store-sqlite", name: "@arnilo/prism-session-store-sqlite" },
  { dir: "packages/session-store-nats", name: "@arnilo/prism-session-store-nats" },
  { dir: "packages/session-store-postgres", name: "@arnilo/prism-session-store-postgres" },
  { dir: "packages/enterprise-postgres", name: "@arnilo/prism-enterprise-postgres" },
  { dir: "packages/credentials-node", name: "@arnilo/prism-credentials-node" },
  { dir: "packages/coding-security", name: "@arnilo/prism-coding-security" },
  { dir: "packages/workflows", name: "@arnilo/prism-workflows" },
  { dir: "packages/evals", name: "@arnilo/prism-evals" },
  { dir: "packages/memory", name: "@arnilo/prism-memory" },
  { dir: "packages/rag", name: "@arnilo/prism-rag" },
  { dir: "packages/server", name: "@arnilo/prism-server" },
  { dir: "packages/supervisor", name: "@arnilo/prism-supervisor" },
  { dir: "packages/web-tools", name: "@arnilo/prism-web-tools" },
  { dir: "packages/browser", name: "@arnilo/prism-browser" },
  { dir: "packages/ag-ui", name: "@arnilo/prism-ag-ui" },
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
    specs.push(`@arnilo/prism${key.slice(1)}`); // "./node/config" -> "@arnilo/prism/node/config"
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

const result = {
  installStatus: -1,
  smokeStatus: -1,
  integrationStatus: -1,
  compositionStatus: -1,
  securityStatus: -1,
  security21Status: -1,
  security22Status: -1,
  security23Status: -1,
  smokeOut: "",
  integrationOut: "",
  securityOut: "",
  security21Out: "",
  security22Out: "",
  security23Out: "",
  compositionOut: "",
  junk: [] as string[],
  secretFindings: [] as string[],
  tarballNames: [] as string[],
};

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
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "@arnilo-prism-install-smoke", type: "module" }, null, 2));
  const installArgs = ["install", ...tarballs, "--offline", "--no-audit", "--no-fund", "--no-update-notifier"];
  let install = run("npm", installArgs, consumer);
  if (install.status !== 0) {
    // Fallback: cold cache or offline-unfriendly environment; no runtime deps
    // means this still makes zero registry fetches.
    install = run("npm", ["install", ...tarballs, "--no-audit", "--no-fund", "--no-update-notifier"], consumer);
  }
  result.installStatus = install.status;
  if (install.status !== 0) {
    result.smokeOut = `install failed:\n${install.stdout}\n${install.stderr}`;
    return;
  }

  // 3. Dynamic-import every documented specifier from the fresh install.
  const specs = [
    ...coreSpecifiers(),
    ...packages.filter((p) => !p.isCore && !p.isMeta).map((p) => p.name),
    "@arnilo/prism-ag-ui/acp",
    "@arnilo/prism-ag-ui/renderer",
  ];
  writeFileSync(
    join(consumer, "smoke.mjs"),
    `const specs = ${JSON.stringify(specs)};\n` +
      "for (const s of specs) {\n" +
      "  try { await import(s); }\n" +
      "  catch (e) { console.error('IMPORT FAILED:', s, e.message); process.exit(1); }\n" +
      "}\n" +
      "const prism = await import('@arnilo/prism');\n" +
      "const compaction = await import('@arnilo/prism-compaction-llm');\n" +
      "if (typeof prism.resumeAgentRunStream !== 'function' || typeof compaction.createCodingCompactionStrategy !== 'function') process.exit(1);\n" +
      "console.log('ALL IMPORTS OK');\n",
  );
  const smoke = run("node", ["smoke.mjs"], consumer);
  result.smokeStatus = smoke.status;
  result.smokeOut = smoke.stdout + smoke.stderr;

  // 4. Exercise validator + parallel local/MCP/coding tools from packed public imports.
  writeFileSync(
    join(consumer, "integration.mjs"),
    `
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
await session.run(canary, { limits: { maxToolRounds: 1 } });
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
`,
  );
  const integration = run("node", ["integration.mjs"], consumer);
  result.integrationStatus = integration.status;
  result.integrationOut = integration.stdout + integration.stderr;

  // 5. Compose every 0.2.0 optional capability family from packed public imports.
  writeFileSync(
    join(consumer, "composition.mjs"),
    `
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

// FR-6: durable AgentEventSource resolves from the packed package root (no dist/... subpath).
const { createPostgresAgentEventSource } = await import("@arnilo/prism-session-store-postgres");
assert.equal(typeof createPostgresAgentEventSource, "function");
const postgresSource = createPostgresAgentEventSource({ pool: {}, schema: "prism" });
assert.equal(typeof postgresSource.append, "function");
assert.equal(typeof postgresSource.close, "function");
await postgresSource.close();
console.log("PACKED 0.2.0 COMPOSITION OK");
`,
  );
  const composition = run("node", ["composition.mjs"], consumer);
  result.compositionStatus = composition.status;
  result.compositionOut = composition.stdout + composition.stderr;

  // 5b. Packed plain-JavaScript phase20 security regressions (plan 020 Task 5):
  //     the three 0.1.7 review blockers proven through the installed tarballs
  //     with no TypeScript compiler — the original resume defect existed only
  //     at runtime, so this consumer runs the shipped JavaScript surface.
  writeFileSync(
    join(consumer, "security.mjs"),
    `
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentDecisionError, createAgent, createMemoryCheckpointStore, createMemorySessionStore,
  providerDone, providerTextDelta, resumeAgentRun, toolCallContent,
} from "@arnilo/prism";
import { createCodingApprovalPolicy, createSandboxCodingComposition, resolveSandboxCapabilities } from "@arnilo/prism-coding-security";
import { createCliRunner } from "@arnilo/prism-work-tools";

// --- phase20 blocker 1: unknown durable-resume decision fails closed, no tool call ---
const executed = [];
let turn = 0;
const provider = { id: "mock", async *generate() {
  turn += 1;
  if (turn === 1) { yield { type: "tool_call", call: toolCallContent("call-1", "write", { value: "a" }) }; yield providerDone(); return; }
  yield providerTextDelta("finished"); yield providerDone();
} };
const agent = createAgent({
  id: "packed-phase20", model: { provider: "mock", model: "demo" },
  store: createMemorySessionStore(), provider,
  tools: [{ name: "write", parameters: {}, execute: (args, ctx) => { executed.push(ctx.toolCallId); return { toolCallId: ctx.toolCallId, name: "write", value: "done" }; } }],
});
const checkpoints = createMemoryCheckpointStore();
const first = await agent.createSession({ id: "phase20" }).run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
assert.equal(first.status, "suspended");
const pending = first.interruption.pendingDecisions;
assert.equal(pending.length, 1);
const version = first.runState.version;
const ref = { runId: first.runId, sessionId: first.sessionId };
let sidewaysError = null;
try {
  await resumeAgentRun(agent, ref, { expectedVersion: version, decision: "sideways" }, { checkpoints, definitionRevision: "1" });
} catch (error) { sidewaysError = error; }
assert.ok(sidewaysError instanceof AgentDecisionError, "sideways must throw AgentDecisionError");
assert.equal(sidewaysError.code, "ERR_PRISM_DECISION_INVALID");
assert.deepEqual(executed, [], "invalid resume executed a tool");
const approved = await resumeAgentRun(agent, ref, { expectedVersion: version, decisions: [{ approvalId: pending[0].approvalId, outcome: "allow_once" }] }, { checkpoints, definitionRevision: "1" });
assert.equal(approved.status, "succeeded");
assert.equal(executed.length, 1, "valid resume must run exactly once");

// --- phase20 blocker 2: work-tool child env isolation (no ambient host env, token isolated, fixed keys) ---
const configDir = mkdtempSync(join(tmpdir(), "packed-phase20-work-"));
const runner = createCliRunner({ binary: process.execPath, configDir });
const probe = "console.log(JSON.stringify({secret: process.env.PRISM_PROOF_SECRET, home: process.env.HOME, telemetry: process.env.CLIMICROSOFT365_DISABLETELEMETRY, token: process.env.M365_ACCESSTOKEN}))";
process.env.PRISM_PROOF_SECRET = "packed-phase20-ambient-canary";
const work = await runner.exec(["-e", probe], { env: { M365_ACCESSTOKEN: "packed-phase20-token" } });
assert.equal(work.exitCode, 0, work.stderr);
const child = JSON.parse(work.stdout);
assert.equal(child.secret, undefined, "ambient env leaked into packed work-tool child");
assert.equal(child.home, configDir);
assert.equal(child.telemetry, "1");
assert.equal(child.token, "packed-phase20-token");
delete process.env.PRISM_PROOF_SECRET;

// --- phase20 blocker 3: un-attested sandbox cannot claim filesystem isolation ---
const cwd = mkdtempSync(join(tmpdir(), "packed-phase20-sandbox-"));
const unattested = { execFile: async () => ({ exitCode: 0, stdout: "", stderr: "" }), close: async () => {} };
const policy = createCodingApprovalPolicy({ roots: [cwd], approve: async () => true });
const { composition } = createSandboxCodingComposition(cwd, { workspaceMode: "sandbox", sandbox: unattested, executionPolicy: policy });
assert.equal(composition.capabilities.filesystemIsolated, false, "un-attested sandbox claimed filesystem isolation");
assert.equal(composition.capabilities.workspaceCoherent, true);
assert.equal(composition.containmentClaim, false);
const malformed = resolveSandboxCapabilities({ ...unattested, capabilities: { filesystemIsolated: true, networkIsolated: "yes" } });
assert.equal(malformed.filesystemIsolated, false, "malformed metadata must fail closed");
console.log("PACKED PHASE20 SECURITY OK");
`,
  );
  const security = run("node", ["security.mjs"], consumer);
  result.securityStatus = security.status;
  result.securityOut = security.stdout + security.stderr;

  // 5c. Packed plain-JavaScript phase21 security regressions (plan 021 Task 7):
  //     the 0.2.1 trust-boundary changes proven through the installed tarballs
  //     with no TypeScript compiler — truncated streams reject, oversized
  //     bodies abort, pinned fetch fails closed on private answers, device-code
  //     polls redact secrets, and overflow cache telemetry never mixes costs.
  writeFileSync(
    join(consumer, "security21.mjs"),
    `
import assert from "node:assert/strict";
import { createCacheTelemetry, MediaContentError, pinnedFetch, pollDeviceCodeToken } from "@arnilo/prism";
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";
import { ProviderTransportError, readBoundedResponseJson } from "@arnilo/prism/providers/transport";

// Truncated OpenAI-compatible stream rejects (strictCompletion shared default).
const truncated = new Response("data: [DONE]\\n\\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const provider = createOpenAICompatibleProvider({ apiKey: "k", baseUrl: "https://api.example.com/v1", fetch: async () => truncated });
const events = [];
for await (const event of provider.generate({ model: { provider: "mock", model: "demo" }, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })) events.push(event);
const streamError = events.find((event) => event.type === "error");
assert.ok(streamError, "truncated stream must error");
assert.match(String(streamError.error?.message ?? ""), /without completion evidence/);
assert.equal(events.some((event) => event.type === "done"), false);

// Oversized discovery-shaped body aborts before full buffering.
const oversized = new Response(JSON.stringify({ data: Array.from({ length: 40000 }, (_, i) => ({ id: "m" + i })) }), { status: 200 });
let overflowCode = null;
try {
  await readBoundedResponseJson(oversized);
} catch (error) {
  overflowCode = error instanceof ProviderTransportError ? error.code : null;
}
assert.equal(overflowCode, "response_body_overflow");

// DNS-pinned fetch fails closed on a private-address answer (OIDC/OPA/content all route through this).
const privateAnswer = await pinnedFetch(new URL("https://jwks.example.com/jwks.json"), undefined, {
  resolver: async () => [{ address: "10.0.0.1", family: 4 }],
}).then(() => null, (error) => error);
assert.ok(privateAnswer instanceof MediaContentError);
assert.equal(privateAnswer.code, "ssrf_denied");

// Device-code poll redacts device_code/user_code from terminal errors.
const terminal = await pollDeviceCodeToken({
  errorPrefix: "Packed21",
  deviceCodeUrl: "https://id.example.com/device",
  tokenUrl: "https://id.example.com/token",
  clientId: "client",
  now: () => 1000000,
  sleep: async () => {},
  parseTokenCredentials: (json) => ({ accessToken: json.access_token }),
  fetchImpl: async (input) => {
    if (String(input).endsWith("/device")) {
      return new Response(JSON.stringify({ device_code: "dev-secret", user_code: "USER-CODE", verification_uri: "https://id.example.com/activate", expires_in: 600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "access_denied", error_description: "rejected device_code=dev-secret user_code=USER-CODE" }), { status: 400 });
  },
}).then(() => null, (error) => error);
assert.ok(terminal instanceof Error);
assert.ok(terminal.message.includes("[REDACTED]"));
assert.equal(terminal.message.includes("dev-secret"), false);
assert.equal(terminal.message.includes("USER-CODE"), false);

// Overflow cache telemetry never mixes model costs.
const telemetry = createCacheTelemetry({ maxKeys: 2 });
const usage = (cacheReadTokens) => ({ inputTokens: 100, cacheReadTokens });
const model = (name) => ({ provider: "mock", model: name, cost: { input: 2, cacheRead: 0.5 } });
telemetry.record(usage(100), model("a"));
telemetry.record(usage(100), model("b"));
telemetry.record(usage(50), model("c"));
const overflow = telemetry.report().samples.find((sample) => sample.model === "__overflow__");
assert.ok(overflow);
assert.equal(overflow.estimatedSavings, undefined);
assert.equal(overflow.currency, undefined);
console.log("PACKED PHASE21 SECURITY OK");
`,
  );
  const security21 = run("node", ["security21.mjs"], consumer);
  result.security21Status = security21.status;
  result.security21Out = security21.stdout + security21.stderr;

  // 5d. Packed plain-JavaScript phase22 security regressions (plan 022 Task 5):
  //     the four 0.2.2 state-concurrency/durability blockers proven through the
  //     installed tarballs with no TypeScript compiler — parallel router
  //     reservations cannot oversubscribe, conversation metadata CAS admits one
  //     writer per version and never revives deleted/archived state, a second
  //     EventMultiplexer subscriber is rejected, and the NATS durable consumer
  //     name is restart-stable so a crash-resumed subscribe continues from the
  //     last ack. The conflict error carries versions only — never metadata.
  writeFileSync(
    join(consumer, "security22.mjs"),
    `
import assert from "node:assert/strict";
import { EventMultiplexerError, SessionMetadataConflictError, createEventMultiplexer } from "@arnilo/prism";
import { createMemoryModelRouterStateStore } from "@arnilo/prism-model-router";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
import { createNatsAgentEventSource } from "@arnilo/prism-session-store-nats";

// --- phase22 blocker 1 (matrix item 9): parallel admissions cannot exceed the reserved budget ---
const store = createMemoryModelRouterStateStore();
const key = { tenantId: "packed22", principalId: "p1", provider: "mock", model: "m1" };
const base = { key, tokens: 26, maxTokens: 100, windowMs: 60000, reservationTtlMs: 60000, now: 1000000 };
const outcomes = await Promise.all(Array.from({ length: 4 }, () => store.reserveBudget({ ...base })));
assert.equal(outcomes.filter((o) => o.admitted).length, 3, "3 of 4 reservations of 26/100 admit");
const denied = outcomes.find((o) => !o.admitted);
assert.ok(denied && denied.retryAfterMs > 0, "4th reservation denied with retryAfterMs");
const winner = outcomes.find((o) => o.admitted);
await store.commitBudget({ key, reservationId: winner.reservationId, fencingToken: winner.fencingToken, tokens: 10, windowMs: 60000, now: 1000001 });
assert.equal((await store.readBudget({ key, windowMs: 60000, now: 1000002 })).tokens, 10, "live commit records actuals");
await assert.rejects(
  () => store.commitBudget({ key, reservationId: winner.reservationId, fencingToken: "forged", windowMs: 60000, now: 1000003 }),
  (error) => error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
  "stale fencing token fails closed",
);

// --- phase22 blocker 2 (matrix item 8): conversation metadata CAS admits one writer per version ---
const persistence = createSqlitePersistence({ filename: ":memory:" });
const ownership = { tenantId: "packed22", userId: "u1" };
const record = (id, metadata, updatedAt, expectedVersion) => ({ id, ...ownership, createdAt: "2026-08-13T00:00:00.000Z", updatedAt, metadata, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const sessionId = "packed22-conversation";
const created = await persistence.appendSession(record(sessionId, { state: "active", writer: "create-0" }, "2026-08-13T00:00:00.000Z", 0));
assert.equal(created.version, 1);
const duplicates = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => persistence.appendSession(record(sessionId, { state: "active", writer: "dup-" + i }, "2026-08-13T00:00:01.000Z", 0))));
assert.equal(duplicates.filter((o) => o.status === "fulfilled").length, 0, "duplicate create-only never overwrites");
assert.equal(duplicates.filter((o) => o.status === "rejected" && o.reason instanceof SessionMetadataConflictError).length, 4);
const updates = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => persistence.appendSession(record(sessionId, { state: "active", branch: "b" + i }, "2026-08-13T00:01:00.000Z", 1))));
assert.equal(updates.filter((o) => o.status === "fulfilled").length, 1, "exactly one CAS update wins");
assert.equal(updates.filter((o) => o.status === "rejected").length, 3, "the rest conflict");
const conflict = updates.find((o) => o.status === "rejected").reason;
assert.equal(conflict.code, "metadata_conflict");
assert.equal(JSON.stringify(conflict.conflict).includes("branch"), false, "conflict carries versions only, never metadata content");
await persistence.appendSession(record(sessionId, { state: "archived" }, "2026-08-13T00:02:00.000Z", 2));
await assert.rejects(
  () => persistence.appendSession(record(sessionId, { state: "active", zombie: true }, "2026-08-13T00:00:00.000Z", 1)),
  (error) => error instanceof SessionMetadataConflictError,
  "stale pre-archive writer cannot revive the archive",
);
const archived = await persistence.querySessions({ id: sessionId, limit: 1 });
assert.equal(archived.items[0].metadata.state, "archived", "archived state survives the stale write");
const foreign = await persistence.appendSession(record(sessionId, { state: "active", foreign: true }, "2026-08-13T00:03:00.000Z", 2)).then(() => null, (error) => error);
assert.equal(foreign.code, "metadata_conflict", "cross-ownership CAS write fails closed");

// --- phase22 blocker 3: a second EventMultiplexer subscriber is rejected ---
const multiplexer = createEventMultiplexer({ maxQueuedEvents: 1024 });
multiplexer.observe({ async *[Symbol.asyncIterator]() { for (let value = 0; ; value += 1) yield value; } }, (value) => value);
const first = multiplexer.subscribe();
assert.deepEqual(await first.next(), { value: 0, done: false });
const second = multiplexer.subscribe();
await assert.rejects(
  () => second.next(),
  (error) => error instanceof EventMultiplexerError && error.code === "ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER",
  "second subscriber is rejected, not silently parked",
);
await first.return(undefined);
await multiplexer.close();

// --- phase22 blocker 4: NATS durable consumer name is restart-stable and resumes from the last ack ---
const messages = new Map();
const consumers = new Map();
let nextSeq = 1;
const seam = {
  async publish(subject, data, opts) { const seq = nextSeq++; messages.set(seq, { subject, data, msgID: opts.msgID }); return { stream: "test", seq, duplicate: false }; },
  async addConsumer(_stream, cfg) { const existing = consumers.get(cfg.name); consumers.set(cfg.name, { cfg, acked: existing ? new Set(existing.acked) : new Set() }); },
  async getConsumer(_stream, name) {
    const state = consumers.get(name);
    if (!state) throw new Error("consumer not found: " + name);
    return { async fetch({ max_messages }) {
      const filter = state.cfg.filter_subject;
      const start = state.cfg.opt_start_seq ?? 1;
      const candidates = [];
      for (const [seq, message] of messages) {
        if (seq < start) continue;
        if (!filter.split(".").every((token, i) => token === "*" || token === message.subject.split(".")[i])) continue;
        if (state.acked.has(seq)) continue;
        candidates.push({ seq, data: message.data });
      }
      candidates.sort((l, r) => l.seq - r.seq);
      const batch = candidates.slice(0, max_messages);
      return { async *[Symbol.asyncIterator]() { for (const item of batch) yield { seq: item.seq, data: item.data, ack: () => state.acked.add(item.seq) }; } };
    } };
  },
  async deleteConsumer(_stream, name) { consumers.delete(name); },
  async getMessage(_stream, seq) { const m = messages.get(seq); return m ? { data: m.data } : null; },
  async deleteMessage() {},
};
const options = { connection: seam, stream: "packed22-stream", cursorSecret: "packed22-cursor-secret" };
const source = createNatsAgentEventSource(options);
const event = (id, type) => ({ id, ...ownership, sessionId: "s1", runId: "r1", type, timestamp: "2026-08-13T00:00:00.000Z", redacted: true, event: { type, sessionId: "s1", runId: "r1", turn: 1 } });
await source.append(event("n-1", "agent_started"));
await source.append(event("n-2", "turn_started"));
const read = { ownership, sessionId: "s1", runId: "r1", limit: 10 };
const iterator = source.subscribe(read)[Symbol.asyncIterator]();
assert.equal((await iterator.next()).value.record.id, "n-1");
assert.equal((await iterator.next()).value.record.id, "n-2");
const name = [...consumers.keys()][0];
assert.match(name, /^prism_[0-9a-f]{16}$/, "durable name is prism_<hmac16> with no random suffix");
const restarted = createNatsAgentEventSource(options); // crash: no close, consumer survives at its ack
const resumed = await restarted.subscribe(read)[Symbol.asyncIterator]().next();
assert.equal(resumed.value.record.id, "n-2", "restart resumes from the last ack, not the stream head");
await source.close();
await restarted.close();
console.log("PACKED PHASE22 SECURITY OK");
`,
  );
  const security22 = run("node", ["security22.mjs"], consumer);
  result.security22Status = security22.status;
  result.security22Out = security22.stdout + security22.stderr;

  // 5e. Packed plain-JavaScript phase23 security regressions (plan 023 Task 5):
  //     the two 0.2.3 build/coverage integrity blockers proven through the
  //     INSTALLED tarballs with no TypeScript compiler — matrix item 4: the
  //     built public entry surface (every exports-map specifier) resolves from
  //     the installed core and exposes the frozen exports; matrix item 12: the
  //     packed layout holds exactly one shared core copy (no nested duplicate
  //     that a coverage denominator could double-count) and ships no test
  //     artifacts, so a packed workspace run can only ever measure package
  //     code.
  writeFileSync(
    join(consumer, "security23.mjs"),
    `
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const consumerRoot = dirname(fileURLToPath(import.meta.url));
const scopedRoot = join(consumerRoot, "node_modules", "@arnilo");
const coreDir = join(scopedRoot, "prism");

// --- phase23 blocker 1 (matrix item 4): the installed public entry surface is complete ---
const corePkg = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8"));
const specs = ["@arnilo/prism", ...Object.keys(corePkg.exports ?? {}).filter((key) => key !== ".").map((key) => "@arnilo/prism" + key.slice(1))];
for (const spec of specs) {
  const mod = await import(spec);
  if (spec === "@arnilo/prism") {
    assert.equal(mod.version, corePkg.version, "installed core must expose the manifest version");
    for (const name of ["createAgent", "AgentRunError", "resumeAgentRunStream", "createMemoryCheckpointStore"]) {
      assert.equal(typeof mod[name], "function", "installed core must export " + name);
    }
  }
}
assert.ok(specs.length >= 10, "exports-map surface must be non-trivial");

// --- phase23 blocker 2 (matrix item 12): one shared core copy, no test artifacts ---
const nestedCores = [];
const testDirs = [];
const stack = [scopedRoot];
while (stack.length) {
  const dir = stack.pop();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (entry.name === "node_modules") stack.push(path); // hunt for nested duplicate cores
    else if (entry.name === "prism" && dir === scopedRoot) continue; // the shared core itself
    else if (entry.name === "prism") nestedCores.push(path);
    else if (entry.name === "__tests__" && path.includes("dist")) testDirs.push(path);
    else stack.push(path);
  }
}
assert.deepEqual(nestedCores, [], "no nested @arnilo/prism duplicate may exist in the packed layout");
assert.deepEqual(testDirs, [], "packed packages must not ship dist test artifacts");
assert.ok(statSync(join(coreDir, "dist", "index.js")).isFile(), "installed core dist/index.js must exist");
console.log("PACKED PHASE23 SECURITY OK");
`,
  );
  const security23 = run("node", ["security23.mjs"], consumer);
  result.security23Status = security23.status;
  result.security23Out = security23.stdout + security23.stderr;

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

  it("packed 0.2.0 optional capabilities compose through public imports", () => {
    assert.equal(result.compositionStatus, 0, result.compositionOut);
  });

  it("packed plain-JS phase20 security regressions run without TypeScript", () => {
    assert.equal(result.securityStatus, 0, result.securityOut);
  });

  it("packed plain-JS phase21 security regressions run without TypeScript", () => {
    assert.equal(result.security21Status, 0, result.security21Out);
  });

  it("packed plain-JS phase22 security regressions run without TypeScript", () => {
    assert.equal(result.security22Status, 0, result.security22Out);
  });

  it("packed plain-JS phase23 security regressions run without TypeScript", () => {
    assert.equal(result.security23Status, 0, result.security23Out);
  });

  it("installed packages contain no test artifacts, source maps, or real-looking secrets", () => {
    assert.deepEqual(result.junk, [], `leaked into installed node_modules: ${result.junk.join(", ")}`);
    assert.deepEqual(result.secretFindings, [], `secret-like value leaked into installed packages: ${result.secretFindings.join(", ")}`);
    assert.equal(
      (
        result.integrationOut +
        result.compositionOut +
        result.securityOut +
        result.security21Out +
        result.security22Out +
        result.security23Out
      ).includes("packed-integration-secret"),
      false,
      "canary leaked into packed journey output",
    );
  });

  // ponytail: npm strips @scope/ from tarball names; core (@arnilo/prism) -> arnilo-prism-0.2.3.tgz.
  // Regression guard so a future rename can't silently re-mangle the published filename.
  it("core tarball filename is arnilo-prism-0.2.3.tgz (npm strips the @scope/)", () => {
    assert.ok(
      result.tarballNames.includes("arnilo-prism-0.2.3.tgz"),
      `expected 'arnilo-prism-0.2.3.tgz' in ${JSON.stringify(result.tarballNames)}`,
    );
    assert.equal(result.tarballNames.length, packages.length, "tarball count must match package count");
    // The 3 umbrella metas must be present too.
    for (const meta of ["arnilo-prism-providers-0.2.3.tgz", "arnilo-prism-compaction-0.2.3.tgz", "arnilo-prism-all-0.2.3.tgz"]) {
      assert.ok(result.tarballNames.includes(meta), `missing umbrella tarball ${meta}`);
    }
  });
});
