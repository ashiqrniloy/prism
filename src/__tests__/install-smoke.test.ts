import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Root manifest version drives the core tarball name (arnilo-prism-<v>.tgz).
const ROOT_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
// Plan 066 lockstep bump: all manifests carry the 0.5.1 cut.
const PROVIDER_TARBALL_SAMPLE = "arnilo-prism-provider-hyper";

import { afterAll as after, beforeAll as before, describe, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: one config entry per published package; adding a package is one line
const packages: Array<{ dir: string; name: string; isCore?: boolean; isSubpaths?: boolean; isMeta?: boolean }> = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/integrations/mcp", name: "@arnilo/prism-mcp" },
  { dir: "packages/integrations/workflows", name: "@arnilo/prism-workflows" },
  { dir: "packages/hosts/mcp-server", name: "@arnilo/prism-mcp-server" },
  { dir: "packages/hosts/acp", name: "@arnilo/prism-acp" },
  { dir: "packages/memory/core", name: "@arnilo/prism-memory-core" },
  { dir: "packages/memory/compaction", name: "@arnilo/prism-memory-compaction" },
  { dir: "packages/memory/observational", name: "@arnilo/prism-memory-observational" },
  { dir: "packages/memory/rag", name: "@arnilo/prism-memory-rag" },
  { dir: "packages/memory/fabric", name: "@arnilo/prism-memory-fabric" },
  { dir: "packages/memory/wiki", name: "@arnilo/prism-memory-wiki" },
  { dir: "packages/tools/browser", name: "@arnilo/prism-tools-browser" },
  { dir: "packages/hosts/ag-ui", name: "@arnilo/prism-ag-ui" },
  { dir: "packages/tools/coding", name: "@arnilo/prism-tools-coding" },
  { dir: "packages/tools/web", name: "@arnilo/prism-tools-web" },
  { dir: "packages/tools/openapi", name: "@arnilo/prism-tools-openapi" },
  { dir: "packages/tools/computer-use", name: "@arnilo/prism-tools-computer-use" },
  { dir: "packages/policy/approval", name: "@arnilo/prism-approval" },
  // Plan 174 Task 8: security22.mjs exercises the packed router state store, so its tarball
  // must be in the offline install set.
  { dir: "packages/policy/model-router", name: "@arnilo/prism-model-router" },
  // Plan 159 Task 7: the readiness report and field policy moved to @arnilo/prism-governance.
  { dir: "packages/policy/governance", name: "@arnilo/prism-governance" },
  { dir: "packages/context/files", name: "@arnilo/prism-context-files" },
  { dir: "packages/context/engineering", name: "@arnilo/prism-context-engineering" },
  { dir: "packages/hosts/channels", name: "@arnilo/prism-channels" },
  { dir: "packages/hosts/evals", name: "@arnilo/prism-evals" },
  { dir: "packages/hosts/devtools", name: "@arnilo/prism-devtools" },
  { dir: "packages/integrations/hooks-json", name: "@arnilo/prism-hooks-json" },
  // Plan 175 Task 7: the 0.13 host libraries and integration packages that the truth graph ships.
  { dir: "packages/drivers/process", name: "@arnilo/prism-driver-process" },
  { dir: "packages/hosts/headless", name: "@arnilo/prism-headless" },
  { dir: "packages/hosts/remote", name: "@arnilo/prism-remote" },
  { dir: "packages/integrations/delegate", name: "@arnilo/prism-delegate" },
  { dir: "packages/integrations/observability", name: "@arnilo/prism-observability" },
  { dir: "packages/policy/guardrail-packs", name: "@arnilo/prism-guardrail-packs" },
  { dir: "packages/tools/research", name: "@arnilo/prism-tools-research" },
  { dir: "packages/credentials/keyring", name: "@arnilo/prism-credentials-keyring" },
  { dir: "packages/stores/jsonl", name: "@arnilo/prism-store-jsonl" },
  { dir: "packages/stores/codecs", name: "@arnilo/prism-store-codecs" },
  { dir: "packages/stores/sqlite", name: "@arnilo/prism-store-sqlite" },
  { dir: "packages/stores/postgres", name: "@arnilo/prism-store-postgres" },
  { dir: "packages/providers/hyper", name: "@arnilo/prism-provider-hyper" },
  { dir: "packages/providers/laya", name: "@arnilo/prism-provider-laya" },
  { dir: "packages/providers/liquid", name: "@arnilo/prism-provider-liquid" },
  { dir: "packages/providers/opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/providers/typesafe", name: "@arnilo/prism-provider-typesafe" },
  // Pure-manifest family/profile packages (no dist/exports): pack + install, but skip dynamic-import.
  { dir: "packages/tools/work", name: "@arnilo/prism-tools-work", isSubpaths: true },
];

// Derive every documented core import specifier from the root `exports` map and
// prism-core subpaths map so the smoke test cannot drift from the public contract.
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
  hostCompositionsStatus: -1,
  smokeOut: "",
  integrationOut: "",
  securityOut: "",
  security21Out: "",
  security22Out: "",
  security23Out: "",
  compositionOut: "",
  hostCompositionsOut: "",
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
  //    `prism` peer is satisfied locally with no registry traffic. `overrides`
  //    pin the packed names to their tarballs: internal ranges (e.g.
  //    unpublished internal ranges at gate time, so bun must
  //    not resolve them from the registry.
  const overrides = Object.fromEntries(
    packages.map((pkg) => {
      const manifest = JSON.parse(readFileSync(join(repoRoot, pkg.dir, "package.json"), "utf8")) as { name: string; version: string };
      const tgz = `${manifest.name.replace(/^@/, "").replace(/\//g, "-")}-${manifest.version}.tgz`;
      return [pkg.name, `file:${join(staging, tgz)}`];
    }),
  );
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "@arnilo-prism-install-smoke", type: "module", overrides }, null, 2),
  );
  // @ai-sdk/provider is the optional peer of the provider family's /ai-sdk
  // adapter; the composition leg exercises that adapter, so the host supplies it
  // (exactly like playwright-core for /browser). It is in the root devDeps, so
  // the offline install resolves it from the local cache with no registry hit.
  //
  // Plan 125 Task 2: the consumer simulation is Bun (tarballs still come from `npm pack`, the
  // release-host registry toolchain). `bun install --offline` needs cached manifests for
  // third-party ranges — a fresh CI cache has none — so the retry is `--prefer-offline`:
  // registry metadata for externals only, first-party content always from the tarballs.
  const installArgs = ["install", ...tarballs, "--no-audit", "--no-fund", "--no-update-notifier"];
  let install = run("bun", ["install", "--offline", ...installArgs], consumer);
  if (install.status !== 0) {
    install = run("bun", ["install", "--prefer-offline", ...installArgs], consumer);
  }
  result.installStatus = install.status;
  if (install.status !== 0) {
    result.smokeOut = `install failed:\n${install.stdout}\n${install.stderr}`;
    return;
  }

  // 3. Dynamic-import every documented specifier from the fresh install.
  const specs = [
    ...coreSpecifiers(),
    ...packages.filter((p) => !p.isCore && !p.isMeta && !p.isSubpaths).map((p) => p.name),
    "@arnilo/prism-acp",
    "@arnilo/prism-ag-ui/renderer",
    "@arnilo/prism-memory-rag",
    "@arnilo/prism-memory-fabric",
    "@arnilo/prism-memory-compaction",
    "@arnilo/prism-memory-observational",
    "@arnilo/prism-memory-wiki",
    "@arnilo/prism-tools-browser",
    "@arnilo/prism-tools-web",
    "@arnilo/prism-tools-openapi",
    "@arnilo/prism-tools-computer-use",
    "@arnilo/prism-provider-hyper",
    "@arnilo/prism-provider-laya",
    "@arnilo/prism-provider-liquid",
    "@arnilo/prism-provider-opencode-go",
    "@arnilo/prism-provider-typesafe",
    "@arnilo/prism-tools-work",
    "@arnilo/prism-tools-work/connectors",
    "@arnilo/prism-tools-work/connectors/microsoft365",
    "@arnilo/prism-tools-work/connectors/google-workspace",
    "@arnilo/prism-tools-work/connectors/drafts",
    "@arnilo/prism-tools-work/documents",
    "@arnilo/prism-tools-work/sheets",
    "@arnilo/prism-tools-work/diagrams",
    "@arnilo/prism-tools-work/document-extraction",
    "@arnilo/prism-tools-work/document-reader",
    "@arnilo/prism-channels/telegram",
    "@arnilo/prism-channels/signal",
  ];
  writeFileSync(
    join(consumer, "smoke.mjs"),
    `const specs = ${JSON.stringify(specs)};\n` +
      "for (const s of specs) {\n" +
      "  try { await import(s); }\n" +
      "  catch (e) { console.error('IMPORT FAILED:', s, e.message); process.exit(1); }\n" +
      "}\n" +
      "const prism = await import('@arnilo/prism');\n" +
      "const compaction = await import('@arnilo/prism-memory-compaction');\n" +
      "if (typeof prism.agentFingerprint !== 'function' || typeof compaction.default !== 'function') process.exit(1);\n" +
      "console.log('ALL IMPORTS OK');\n",
  );
  const smoke = run("bun", ["smoke.mjs"], consumer);
  result.smokeStatus = smoke.status;
  result.smokeOut = smoke.stdout + smoke.stderr;

  // 4. Exercise validator + parallel local/MCP/coding tools from packed public imports.
  writeFileSync(
    join(consumer, "integration.mjs"),
    `
import assert from "node:assert/strict";
import {
  createAgent, createSecretRedactor, createToolParameterValidator, createToolRegistry, dispatchToolCall,
  providerDone, providerTextDelta,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createShellTool, createWriteTool, assertPathInsideRoots } from "@arnilo/prism-tools-coding";
import { mapMcpToolsToDefinitions } from "@arnilo/prism-mcp";
import { validateJsonSchema } from "@arnilo/prism";
const createJsonSchemaToolArgumentValidator = () => ({
  validate(schema, value) {
    const result = validateJsonSchema(schema, value);
    return result.ok ? { ok: true, value: result.value } : { ok: false, errors: result.errors };
  },
});

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
const containmentPolicy = ({ roots, readOnly = false }) => ({
  check: async (action) => {
    if (readOnly && action.kind !== "read") return { allowed: false, reason: "read-only" };
    for (const path of action.paths ?? []) {
      if (!(await assertPathInsideRoots(roots, path))) return { allowed: false, reason: "path outside trusted roots: " + path };
    }
    if (action.kind === "shell") approvals.push(action.kind);
    return { allowed: true, exclusive: action.kind === "shell" };
  },
});
const policy = containmentPolicy({ roots: [process.cwd()] });
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
const agent = await createAgent({
  model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: tools },
  validator: createToolParameterValidator(createJsonSchemaToolArgumentValidator()), redactor: createSecretRedactor([canary]),
});
const session = await agent.session();
const events = [];
const reader = (async () => { for await (const event of session.subscribe()) events.push(event); })();
await session.run(canary, { limits: { maxToolRounds: 1 } });
await reader;
const finished = events.filter((event) => event.type === "tool.completed");
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
  context: { sessionId: "s", runId: "r", toolCallId: "bad" }, validate: createToolParameterValidator(createJsonSchemaToolArgumentValidator()),
});
assert.match(invalid.error?.message ?? "", /string/i);
assert.equal(starts.length, startsBeforeInvalid, "invalid args reached handler");
const deniedWrite = createWriteTool(process.cwd(), {
  executionPolicy: containmentPolicy({ roots: [process.cwd()], readOnly: true }),
  operations: { mkdir: async () => assert.fail("denied write reached mkdir"), writeFile: async () => assert.fail("denied write reached writeFile") },
});
const denied = await dispatchToolCall({
  registry: createToolRegistry([deniedWrite]), call: { type: "tool_call", id: "deny", name: "write", arguments: { path: "blocked.txt", content: "x" } },
  context: { sessionId: "s", runId: "r", toolCallId: "deny" }, validate: createToolParameterValidator(createJsonSchemaToolArgumentValidator()),
});
assert.ok(denied.error, "read-only policy allowed write");
console.log("PACKED INTEGRATION OK");
`,
  );
  const integration = run("bun", ["integration.mjs"], consumer);
  result.integrationStatus = integration.status;
  result.integrationOut = integration.stdout + integration.stderr;

  // 5. Compose every 0.2.0 optional capability family from packed public imports.
  writeFileSync(
    join(consumer, "composition.mjs"),
    `
import assert from "node:assert/strict";
import {
  createAgent,
  providerDone, providerTextDelta,
} from "@arnilo/prism";
import { createMemoryRunFeedbackStore } from "@arnilo/prism-store-codecs";
import { createMockProvider } from "@arnilo/prism/testing";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createHyperProvider } from "@arnilo/prism-provider-hyper";
import { appendEvaluationFeedback, createMemoryEvaluationStore, defineScorer, scoreRun } from "@arnilo/prism-evals";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory } from "@arnilo/prism-memory-fabric";
import { chunkMarkdown, indexChunks, retrieveContext } from "@arnilo/prism-memory-rag";
import {
  createMemoryWorkflowCheckpoints, createWorkflowCheckpoints,
  defineWorkflow, functionNode, replayWorkflow, resumeWorkflow, runWorkflow, suspend,
} from "@arnilo/prism-workflows";
import { mcpHost, serveMcp } from "@arnilo/prism-mcp-server";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";

const ownership = { tenantId: "packed", userId: "operator" };
const sse = [
  'data: {"choices":[{"delta":{"content":"packed-result"},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
  'data: [DONE]',
].join("\\n\\n") + "\\n\\n";
const hyperProvider = createHyperProvider({
  apiKey: "packed",
  fetch: async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
});
const hyperAgent = await createAgent({ packages: [providerPackage("test-provider", [hyperProvider])], model: { provider: hyperProvider.id, model: "packed" } });
const streamed = [];
for await (const event of (await hyperAgent.session()).stream("stream")) streamed.push(event.type);
const runResult = await (await hyperAgent.session()).run("run");
assert.equal(runResult.text, "packed-result");
assert.ok(streamed.includes("message.delta"));

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

// Plan 168 Task 7: the 0.12 schedules/coordinator are gone (Phase 16 Part B rebuilds them), so the
// durable-replay leg runs its source run directly.
const store = (await import("@arnilo/prism-workflows")).createMemoryCheckpointStore();
const checkpoints = createWorkflowCheckpoints({ store });
const replayableFlow = defineWorkflow({ revision: "1", id: "replayable", nodes: { done: functionNode({ execute: () => ({ done: true }) }) } });
const source = await runWorkflow(replayableFlow, {}, { checkpoints, ownership, runId: "replay-source" });
const replay = await replayWorkflow(replayableFlow, { sourceRunId: source.runId, fromNodeId: "done" }, { checkpoints, ownership });
assert.equal(replay.lineage.sourceRunId, source.runId);

const servedAgent = async () => await createAgent({ model: { provider: "mock", model: "served" }, packages: [providerPackage("test-provider", [createMockProvider([providerTextDelta("served"), providerDone()])])] });
const mcpAgent = await createAgent({ model: { provider: "mock", model: "packed-mcp" }, host: mcpHost(), packages: [providerPackage("test-provider", [createMockProvider([providerTextDelta("mcp packed"), providerDone()])])] });
const mcpClient = new Client({ name: "packed", version: "1" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcpHandle = serveMcp(mcpAgent, { transport: serverTransport, authorize: () => ({ allowed: true, ownership }) });
await mcpClient.connect(clientTransport);
assert.equal((await mcpClient.callTool({ name: "prompt", arguments: { prompt: "hello" } })).isError ?? false, false);
await mcpClient.close(); await mcpHandle.close();

// FR-6: durable AgentEventSource resolves from the packed package root (no dist/... subpath).
const { createPostgresAgentEventSource } = await import("@arnilo/prism-store-postgres");
assert.equal(typeof createPostgresAgentEventSource, "function");
const postgresSource = createPostgresAgentEventSource({ pool: {}, schema: "prism" });
assert.equal(typeof postgresSource.append, "function");
assert.equal(typeof postgresSource.close, "function");
await postgresSource.close();
console.log("PACKED 0.2.0 COMPOSITION OK");
`,
  );
  const composition = run("bun", ["composition.mjs"], consumer);
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
  AgentDecisionError, askEveryTool, createAgent, createMemorySessionStore,
  providerDone, providerTextDelta, toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createSandboxCodingComposition, resolveSandboxCapabilities } from "@arnilo/prism-tools-coding";
import { createCliRunner } from "@arnilo/prism-tools-work/connectors";

// --- phase20 blocker 1: unknown durable-resume decision fails closed, no tool call ---
const executed = [];
let turn = 0;
const provider = { id: "mock", async *generate() {
  turn += 1;
  if (turn === 1) { yield { type: "tool_call", call: toolCallContent("call-1", "write", { value: "a" }) }; yield providerDone(); return; }
  yield providerTextDelta("finished"); yield providerDone();
} };
const agent = await createAgent({
  id: "packed-phase20", model: { provider: "mock", model: "demo" },
  slots: { store: createMemorySessionStore() }, packages: [providerPackage("test-provider", [provider])], hooks: askEveryTool(),
  tools: { add: [{ name: "write", parameters: {}, execute: (args, ctx) => { executed.push(ctx.toolCallId); return { toolCallId: ctx.toolCallId, name: "write", value: "done" }; } }] },
});
const session = await agent.session();
const first = await session.run("go");
assert.equal(first.status, "suspended");
const pending = first.pending;
assert.equal(pending.length, 1);
let sidewaysError = null;
try {
  for await (const _event of session.resume([{ approvalId: pending[0].approvalId, outcome: "sideways" }])) { /* drain */ }
} catch (error) { sidewaysError = error; }
assert.ok(sidewaysError instanceof AgentDecisionError, "sideways must throw AgentDecisionError");
assert.equal(sidewaysError.code, "ERR_PRISM_DECISION_INVALID");
assert.deepEqual(executed, [], "invalid resume executed a tool");
for await (const _event of session.resume([{ approvalId: pending[0].approvalId, outcome: "allow_once" }])) { /* drain */ }
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
const { composition } = createSandboxCodingComposition(cwd, { workspaceMode: "sandbox", sandbox: unattested });
assert.equal(composition.capabilities.filesystemIsolated, false, "un-attested sandbox claimed filesystem isolation");
assert.equal(composition.capabilities.workspaceCoherent, true);
assert.equal(composition.containmentClaim, false);
const malformed = resolveSandboxCapabilities({ ...unattested, capabilities: { filesystemIsolated: true, networkIsolated: "yes" } });
assert.equal(malformed.filesystemIsolated, false, "malformed metadata must fail closed");
console.log("PACKED PHASE20 SECURITY OK");
`,
  );
  const security = run("bun", ["security.mjs"], consumer);
  result.securityStatus = security.status;
  result.securityOut = security.stdout + security.stderr;

  // 5c. Packed plain-JavaScript phase21 security regressions (plan 021 Task 7):
  //     the 0.2.1 trust-boundary changes proven through the installed tarballs
  //     with no TypeScript compiler — truncated streams reject, oversized
  //     bodies abort, and pinned fetch fails closed on private answers.
  writeFileSync(
    join(consumer, "security21.mjs"),
    `
import assert from "node:assert/strict";
import { MediaContentError, pinnedFetch } from "@arnilo/prism";
import { createOpenAICompatibleProvider, ProviderTransportError, readBoundedResponseJson } from "@arnilo/prism/provider-kit";

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

console.log("PACKED PHASE21 SECURITY OK");
`,
  );
  const security21 = run("bun", ["security21.mjs"], consumer);
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
import { SessionMetadataConflictError } from "@arnilo/prism";
import { EventMultiplexerError, createEventMultiplexer } from "@arnilo/prism-workflows";
import { createMemoryModelRouterStateStore } from "@arnilo/prism-model-router";
import { createSqlitePersistence } from "@arnilo/prism-store-sqlite";

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
const ownership = { tenantId: "packed22", userId: "u1" };
let sqliteAvailable = false;
let persistence;
try {
  persistence = createSqlitePersistence({ filename: ":memory:" });
  sqliteAvailable = true;
} catch (error) {
  assert.ok(error.message.includes("requires the Bun runtime (bun:sqlite)"), "must fail closed off the Bun runtime");
}
if (sqliteAvailable && persistence) {
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
}

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

console.log("PACKED PHASE22 SECURITY OK");
`,
  );
  const security22 = run("bun", ["security22.mjs"], consumer);
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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
    for (const name of ["createAgent", "AgentRunStateError", "agentFingerprint", "createMemorySessionStore"]) {
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
    else if (entry.name === "__tests__" && path.includes("src")) testDirs.push(path);
    else stack.push(path);
  }
}
assert.deepEqual(nestedCores, [], "no nested @arnilo/prism duplicate may exist in the packed layout");
assert.deepEqual(testDirs, [], "packed packages must not ship test artifacts");
assert.ok(statSync(join(coreDir, "src", "index.ts")).isFile(), "installed core src/index.ts must exist");
assert.equal(existsSync(join(coreDir, "dist")), false, "installed core must not ship a dist/ build output");
console.log("PACKED PHASE23 SECURITY OK");
`,
  );
  const security23 = run("bun", ["security23.mjs"], consumer);
  result.security23Status = security23.status;
  result.security23Out = security23.stdout + security23.stderr;

  // 5f. Packed plain-JavaScript host compositions and readiness enforcement (plan 073 Task 5;
  //     `createSecureAgent` is gone and the readiness report moved to @arnilo/prism-governance in
  //     plan 159 Task 7)
  writeFileSync(
    join(consumer, "host-compositions.mjs"),
    `
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  createStaticTrustPolicy,
  createToolParameterValidator,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { assertHostCompositionReadiness, HostCompositionError, inspectHostComposition } from "@arnilo/prism-governance";
import { createMockProvider } from "@arnilo/prism/testing";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { validateJsonSchema } from "@arnilo/prism";
const createJsonSchemaArgumentValidator = () => ({
  validate(schema, value) {
    const result = validateJsonSchema(schema, value);
    return result.ok ? { ok: true, value: result.value } : { ok: false, errors: result.errors };
  },
});
import { serveDevtools } from "@arnilo/prism-devtools";

const canary = "packed-host-composition-secret";
const redactor = createSecretRedactor([canary]);
const validator = createToolParameterValidator(createJsonSchemaArgumentValidator(), { missingSchema: "reject" });

// 1. Valid Personal Composition
const personalAgent = await createAgent({
  id: "packed-personal-assistant",
  ownership: { userId: "operator" },
  redactor,
  trust: createStaticTrustPolicy(true),
  validator,
  limits: { maxToolRounds: 5 },
  tools: {
    add: [
      {
        name: "status",
        description: "Reports personal status",
        parameters: { type: "object", properties: { q: { type: "string" } }, additionalProperties: false },
        execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "status", value: { ok: true } }),
      },
    ],
  },
  packages: [providerPackage("test-provider", [createMockProvider([providerTextDelta("personal ready"), providerDone()])])],
  model: { provider: "mock", model: "p1" },
});

const personalReport = inspectHostComposition({
  profile: "personal",
  agent: personalAgent,
  store: createMemorySessionStore(),
  credentialRefs: ["PERSONAL_KEY", canary],
});

assert.equal(personalReport.profile, "personal");
assert.equal(personalReport.ownership.userId, "operator");
assert.equal(personalReport.storage.durable, false, "memory store is not durable");
assert.equal(personalReport.storage.kind, "memory");
assert.equal(personalReport.readiness.ok, true);
assert.equal(JSON.stringify(personalReport).includes(canary), false, "secret canary leaked in personal report");
assert.doesNotThrow(() => assertHostCompositionReadiness({ profile: "personal", agent: personalAgent }));
const personalSession = await personalAgent.session();
const personalRun = await personalSession.run("hello");
assert.equal(personalRun.text, "personal ready");

// Developer inspector over the same agent: the inspection route answers from the public Agent API.
const devtools = serveDevtools(personalAgent, { port: 0 });
try {
  const response = await fetch(devtools.url + "/api/inspect");
  const inspection = await response.json();
  assert.ok(Array.isArray(inspection.packages), "the devtools inspection route answers with the agent's packages");
} finally {
  await devtools.close();
}

// 2. Valid Business Worker Composition
const tenantId = "packed-tenant-corp";
const businessAgent = await createAgent({
  id: "packed-business-worker",
  ownership: { tenantId, userId: "worker-1" },
  principal: { kind: "user", id: "worker-1" },
  redactor,
  trust: createStaticTrustPolicy(true),
  validator,
  limits: { maxToolRounds: 5 },
  hooks: (hooks) => hooks.on("tool.call", () => ({ ask: "business tool gate" })),
  tools: {
    add: [
      {
        name: "work_task",
        description: "Business task",
        parameters: { type: "object", properties: { id: { type: "string" } }, additionalProperties: false },
        execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "work_task", value: { ok: true } }),
      },
    ],
  },
  packages: [providerPackage("test-provider", [createMockProvider([providerTextDelta("business ready"), providerDone()])])],
  model: { provider: "mock", model: "b1" },
});

const businessDurableStore = { kind: "postgres", durable: true };
const businessReport = inspectHostComposition({
  profile: "business",
  agent: businessAgent,
  store: businessDurableStore,
  workspaceRoot: "/var/tenant-corp",
  sandboxRoots: ["/var/tenant-corp/run"],
  credentialRefs: ["BUSINESS_KEY"],
  identity: {
    tenantId,
    userId: "worker-1",
    principal: { kind: "user", id: "worker-1" },
    scopes: ["work"],
    verified: true,
    issuedAt: "2026-09-01T00:00:00.000Z",
  },
});

assert.equal(businessReport.profile, "business");
assert.equal(businessReport.ownership.tenantId, tenantId);
assert.equal(businessReport.storage.durable, true);
assert.equal(businessReport.storage.kind, "postgres");
assert.equal(businessReport.sandbox.isolated, true);
assert.equal(businessReport.readiness.ok, true);
assert.doesNotThrow(() =>
  assertHostCompositionReadiness({
    profile: "business",
    agent: businessAgent,
    store: businessDurableStore,
    workspaceRoot: "/var/tenant-corp",
    sandboxRoots: ["/var/tenant-corp/run"],
    identity: {
      tenantId,
      userId: "worker-1",
      principal: { kind: "user", id: "worker-1" },
      scopes: ["work"],
      verified: true,
      issuedAt: "2026-09-01T00:00:00.000Z",
    },
  })
);
const businessSession = await businessAgent.session();
const businessRun = await businessSession.run("hello");
assert.equal(businessRun.text, "business ready");

// 3. Negative rejection test cases
// wrong owner: personal missing userId
assert.throws(
  () => assertHostCompositionReadiness({ profile: "personal", agent: { ownership: { tenantId } } }),
  HostCompositionError,
);
// wrong owner: business missing tenantId
assert.throws(
  () => assertHostCompositionReadiness({ profile: "business", agent: { ownership: { userId: "u1" } }, store: businessDurableStore }),
  HostCompositionError,
);
// wrong owner: business identity tenant mismatch
assert.throws(
  () =>
    assertHostCompositionReadiness({
      profile: "business",
      agent: {
        ownership: { tenantId: "tenant-A" },
        identity: { tenantId: "tenant-B", principal: { kind: "user", id: "u" }, scopes: [], verified: true, issuedAt: "2026-09-01T00:00:00.000Z" },
        trust: createStaticTrustPolicy(true),
        redactor,
        hooks: () => {},
      },
      store: businessDurableStore,
    }),
  HostCompositionError,
);
// memory-only business store
assert.throws(
  () => assertHostCompositionReadiness({ profile: "business", agent: businessAgent, store: createMemorySessionStore() }),
  HostCompositionError,
);
// missing redactor/provider
assert.throws(
  () => assertHostCompositionReadiness({ profile: "personal", agent: { ownership: { userId: "u1" } } }),
  HostCompositionError,
);
// mixed sandbox workspace
assert.throws(
  () =>
    assertHostCompositionReadiness({
      profile: "personal",
      agent: personalAgent,
      workspaceRoot: "/app/safe",
      sandboxRoots: ["/app/safe/work", "/etc/outside"],
    }),
  HostCompositionError,
);
// unsupported governance
assert.throws(
  () =>
    assertHostCompositionReadiness({
      profile: "business",
      agent: businessAgent,
      store: businessDurableStore,
      governance: { supported: false },
    }),
  HostCompositionError,
);

console.log("PACKED HOST COMPOSITIONS OK");
`,
  );

  const hostComp = run("bun", ["host-compositions.mjs"], consumer);
  result.hostCompositionsStatus = hostComp.status;
  result.hostCompositionsOut = hostComp.stdout + hostComp.stderr;

  const scaffold = run(
    "bun",
    ["./node_modules/@arnilo/prism/src/cli.ts", "new", "package", "@acme/prism-smoke", "--dir", "scaffold-pkg"],
    consumer,
  );
  assert.equal(scaffold.status, 0, scaffold.stdout + scaffold.stderr);
  assert.ok(existsSync(join(consumer, "scaffold-pkg", "src", "index.ts")));
  const listed = run("bun", ["./node_modules/@arnilo/prism/src/cli.ts", "list"], consumer);
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);

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

  it("packed personal and business host compositions validate and enforce readiness", () => {
    assert.equal(result.hostCompositionsStatus, 0, result.hostCompositionsOut);
  });

  it("installed packages contain no test artifacts, source maps, or real-looking secrets", () => {
    assert.deepEqual(result.junk, [], `leaked into installed node_modules: ${result.junk.join(", ")}`);
    assert.deepEqual(result.secretFindings, [], `secret-like value leaked into installed packages: ${result.secretFindings.join(", ")}`);
    assert.equal(
      (
        result.integrationOut +
        result.compositionOut +
        result.hostCompositionsOut +
        result.securityOut +
        result.security21Out +
        result.security22Out +
        result.security23Out
      ).includes("packed-integration-secret"),
      false,
      "canary leaked into packed journey output",
    );
    assert.equal(
      result.hostCompositionsOut.includes("packed-host-composition-secret"),
      false,
      "host composition canary leaked into output",
    );
  });

  // ponytail: npm strips @scope/ from tarball names; core (@arnilo/prism) ->
  // arnilo-prism-<root version>.tgz. Regression guard so a future rename can't
  // silently re-mangle the published filename; umbrella metas pin their own cuts.
  it(`core tarball filename is arnilo-prism-${ROOT_VERSION}.tgz (npm strips the @scope/)`, () => {
    assert.ok(
      result.tarballNames.includes(`arnilo-prism-${ROOT_VERSION}.tgz`),
      `expected 'arnilo-prism-${ROOT_VERSION}.tgz' in ${JSON.stringify(result.tarballNames)}`,
    );
    assert.equal(result.tarballNames.length, packages.length, "tarball count must match package count");
    // Plan 152 Task 8: the provider family workspace is deleted, so no family tarball is packed;
    // the work umbrella still is.
    assert.ok(result.tarballNames.includes(`arnilo-prism-tools-work-${ROOT_VERSION}.tgz`), "missing tools-work tarball");
    assert.ok(
      !result.tarballNames.some((name) => name.startsWith("arnilo-prism-providers-")),
      "the retired @arnilo/prism-providers workspace must not pack a tarball",
    );
    assert.ok(
      result.tarballNames.includes(`${PROVIDER_TARBALL_SAMPLE}-${ROOT_VERSION}.tgz`),
      `missing standalone provider tarball ${PROVIDER_TARBALL_SAMPLE}`,
    );
  });
});

// Plan 030 Task 9: peer-version policy (Decision B — caret ranges). Replaced
// runtime npm resolver invocation (ERESOLVE) with manifest-metadata assertion
// for the declared peer-dependency caret window across workspace packages (Plan 128 Task 2).
describe("peer-version policy (plan 030 Task 9, Decision B: the 0.x kernel window)", () => {
  it("declares the kernel API window `>=0.13.0 <1.0.0` on every packed package", () => {
    const [major, minor] = ROOT_VERSION.split(".").map((part: string) => Number(part));
    const expected = `>=${major}.${minor}.0 <1.0.0`;
    // Packed packages live at packages/<group>/<name>/ since plan 152-172; the old flat scan missed
    // every grouped workspace, so after plan 174 Task 7 removed the last flat ones it found none.
    const manifests: Array<{ name: string; peerDependencies?: Record<string, string> }> = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
          walk(join(dir, entry.name));
        } else if (entry.name === "package.json") {
          manifests.push(JSON.parse(readFileSync(join(dir, entry.name), "utf8")));
        }
      }
    };
    walk(join(repoRoot, "packages"));
    let checkedCount = 0;
    for (const manifest of manifests) {
      const peerRange = manifest.peerDependencies?.["@arnilo/prism"];
      if (peerRange) {
        assert.equal(peerRange, expected, `${manifest.name} peer @arnilo/prism range must be ${expected}, got ${peerRange}`);
        checkedCount++;
      }
    }
    assert.ok(checkedCount > 0, "at least one package must declare @arnilo/prism peer dependency");
  });
});

// Plan 024 Task 5: packed plain-JavaScript truth conformance. The before()
// hook above installed every tarball into `consumer`; these tests read the
// INSTALLED manifests (the tarballs as npm laid them down — no TS compiler
// anywhere) and check them against the generated truth artifact: umbrella
// closures and the packed current-line version.
describe("packed truth conformance (plan 024 Task 5)", () => {
  const truth = JSON.parse(readFileSync(join(repoRoot, "scripts", "package-truth.json"), "utf8")) as {
    umbrella: Record<string, { deps: string[] }>;
    profiles: Record<string, string[]>;
  };
  const installedManifest = (name: string) =>
    JSON.parse(readFileSync(join(consumer, "node_modules", "@arnilo", name, "package.json"), "utf8")) as {
      version: string;
      dependencies: Record<string, string>;
    };
  const skipIfInstallFailed = () => {
    if (result.installStatus !== 0) {
      console.log("install failed; packed truth unverifiable");
      return true;
    }
    return false;
  };

  it("the retired provider family ships no tarball while every adapter ships its own", () => {
    if (skipIfInstallFailed()) return;
    // Plan 152 Task 8: the family workspace is gone, so nothing installs @arnilo/prism-providers
    // and every adapter resolves through its standalone package.
    assert.equal(
      existsSync(join(consumer, "node_modules", "@arnilo", "prism-providers")),
      false,
      "the retired @arnilo/prism-providers tarball must not be installed",
    );
    assert.ok(truth.umbrella["prism-providers"] === undefined, "the retired family must not appear as an umbrella closure");
    assert.ok(existsSync(join(consumer, "node_modules", "@arnilo", "prism-provider-hyper")), "a standalone adapter must install");
  });

  it("the installed work tarball exports work and document subpaths", () => {
    if (skipIfInstallFailed()) return;
    const workRoot = join(consumer, "node_modules", "@arnilo", "prism-tools-work");
    for (const sub of ["connectors", "documents", "sheets", "diagrams", "document-extraction", "document-reader"]) {
      assert.ok(existsSync(join(workRoot, "src", sub, "index.ts")), `work tarball missing ${sub} subpath`);
    }
    // Plan 182 Task 2: OpenCode Go adapter ships its own src/index.ts.
    assert.ok(
      existsSync(join(consumer, "node_modules", "@arnilo", "prism-provider-opencode-go", "src", "index.ts")),
      "OpenCode Go adapter must ship as its own provider package",
    );
  });

  it("packed current-line: the installed root version equals the docs current-line version", () => {
    if (skipIfInstallFailed()) return;
    const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    const installed = installedManifest("prism");
    assert.equal(installed.version, root.version, "installed core tarball must carry the root manifest version");
    assert.ok(
      readFileSync(join(repoRoot, "docs", "index.md"), "utf8").includes(`current **${root.version}**`),
      "docs/index.md current-line must match the installed version",
    );
  });
});
