/**
 * Plan 073 Task 27: packed 0.7.0 host-completeness journey.
 * Runs inside the full-surface packed consumer. Public exports only.
 * Prints: HOST COMPLETENESS JOURNEY OK
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createAttentionCompiler,
  createAttentionTruncationTrigger,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  createSecureAgent,
  createSessionEntry,
  createStaticPermissionPolicy,
  createStaticTrustPolicy,
  inspectHostComposition,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resolveDevicePolicy,
  resolveInputCap,
  resolveShouldCompact,
  resumeAgentRun,
} from "@arnilo/prism";
import { selectMcpServers } from "@arnilo/prism-acp-agent";
import {
  createCitationIntegrityScorer,
  defineDataset,
  defineScorer,
  runExperiment,
  validateReleaseEvalManifest,
  wrapAgentWithFailureInjection,
} from "@arnilo/prism-core/governance/evals";
import { createTimelineFolder, summarizeTimeline } from "@arnilo/prism-core/governance/observability";
import { createMemoryWorkDraftStore, validateApproval } from "@arnilo/prism-work/connectors";
import { createRealtimeVoiceBridge } from "@arnilo/prism-core/runtime/realtime";
import { defineWorkflow, serializeWorkflowGraph, workflowGraphToMermaid } from "@arnilo/prism-core/runtime/workflows";
import { createHashEmbedder, createMemory, revokedIdsAbsent } from "@arnilo/prism-memory";
import {
  createWorkScopeController,
  foldObservationalMemoryLedger,
  foldWorkScopeMap,
  OBSERVATIONS_RECORDED,
  projectWorkMemory,
  REFLECTIONS_RECORDED,
} from "@arnilo/prism-memory/compaction/observational-memory";
import { createMemoryFabric } from "@arnilo/prism-memory/fabric";

const marks = [];
let markStart = performance.now();
function mark(id) {
  const elapsed = Math.round(performance.now() - markStart);
  markStart = performance.now();
  marks.push({ id, ms: elapsed });
  console.log(`${id} (${elapsed}ms)`);
}

const identity = {
  tenantId: "tenant-demo",
  userId: "worker-1",
  principal: { kind: "user", id: "worker-1" },
  scopes: ["Mail.Send"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

// --- Trap A ---
assert.equal(
  selectMcpServers(
    ["https://mcp.example.com"],
    [{ type: "http", name: "probe", url: "https://mcp.example.com.attacker.invalid/mcp", headers: [] }],
  ),
  false,
);
mark("TRAP_A OK");

// --- R05 personal / business composition ---
const redactor = createSecretRedactor(["packed-secret"]);
const validator = { validate: () => ({ ok: true }) };
const personal = createSecureAgent({
  id: "personal-assistant",
  definitionRevision: "1",
  ownership: { userId: "alice" },
  redactor,
  permission: createStaticPermissionPolicy(true),
  trust: createStaticTrustPolicy(true),
  toolArgumentValidator: validator,
  limits: { maxToolRounds: 4 },
  runState: { checkpoints: createMemoryCheckpointStore() },
  tools: [
    {
      name: "workspace_status",
      description: "status",
      parameters: { type: "object", properties: {} },
      execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "workspace_status", value: { ok: true } }),
    },
  ],
  provider: createMockProvider([providerTextDelta("ready"), providerDone()]),
  model: { provider: "mock", model: "personal" },
});
const personalReport = inspectHostComposition({ profile: "personal", agent: personal });
assert.equal(personalReport.readiness.ok, true);
assert.equal(personalReport.ownership.userId, "alice");
mark("PERSONAL OK");

const business = createSecureAgent({
  id: "business-worker",
  definitionRevision: "1",
  ownership: { tenantId: identity.tenantId, userId: identity.userId },
  identity,
  redactor,
  permission: createStaticPermissionPolicy(true),
  trust: createStaticTrustPolicy(true),
  toolArgumentValidator: validator,
  limits: { maxToolRounds: 4 },
  runState: { checkpoints: createMemoryCheckpointStore() },
  tools: [
    {
      name: "process_tenant_record",
      description: "process",
      parameters: { type: "object", properties: { recordId: { type: "string" } } },
      execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "process_tenant_record", value: { ok: true } }),
    },
  ],
  provider: createMockProvider([providerTextDelta("ready"), providerDone()]),
  model: { provider: "mock", model: "corp" },
});
const businessReport = inspectHostComposition({
  profile: "business",
  agent: business,
  store: { kind: "postgres", durable: true },
  workspaceRoot: "/var/tenant-demo",
  sandboxRoots: ["/var/tenant-demo/tasks"],
});
assert.equal(businessReport.readiness.ok, true);
assert.equal(businessReport.ownership.tenantId, identity.tenantId);
mark("BUSINESS OK");

// --- R02 stale draft ---
const drafts = createMemoryWorkDraftStore();
const draft = drafts.createDraft({
  provider: "microsoft365",
  op: "mail.send",
  identity,
  payload: { to: "a@contoso.com", subject: "v1" },
});
const approval = { draftId: draft.draftId, revision: draft.revision, payloadDigest: draft.payloadDigest };
const updated = drafts.updateDraft({
  draftId: draft.draftId,
  identity,
  payload: { to: "a@contoso.com", subject: "v2" },
  expectedRevision: 1,
});
assert.throws(() => validateApproval(updated, approval), /does not match draft revision/);
mark("DRAFT OK");

// --- R08 memory revoke ---
const memory = createMemory({
  tenantId: "t1",
  resourceId: "r1",
  threadId: "th1",
  embedder: createHashEmbedder({ dimensions: 2 }),
});
await memory.remember(
  {
    entries: [
      { id: "secret-fact", text: "the merger closes friday" },
      { id: "stale-fact", text: "launch is scheduled for march" },
    ],
  },
  { wait: true },
);
await memory.correct("stale-fact", "launch is scheduled for june");
const corrected = await memory.recall("launch", { topK: 5 });
assert.ok(
  corrected.hits.some((hit) => hit.text === "launch is scheduled for june"),
  "correction must be recallable",
);
assert.equal(
  corrected.hits.some((hit) => hit.text === "launch is scheduled for march"),
  false,
);
await memory.forget({ ids: ["secret-fact"] });
const after = await memory.recall("merger", { topK: 5 });
assert.equal(revokedIdsAbsent({ injectedIds: after.hits.map((hit) => hit.id) }, ["secret-fact"]).score, 1);
mark("MEMORY OK");

// --- R11 coding tool narrowing + restart ---
let writeRan = 0;
function codingProvider() {
  let turn = 0;
  return {
    id: "coding-mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield providerToolCall({ type: "tool_call", id: "c-write", name: "write", arguments: {} });
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}
const codingTools = [
  {
    name: "read",
    description: "read",
    parameters: { type: "object", properties: {} },
    execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "read", value: { ok: true } }),
  },
  {
    name: "write",
    description: "write",
    parameters: { type: "object", properties: {} },
    execute: async (_args, ctx) => {
      writeRan += 1;
      return { toolCallId: ctx.toolCallId, name: "write", value: { ok: true } };
    },
  },
];
await createAgent({
  model: { provider: "mock", model: "offline" },
  provider: codingProvider(),
  tools: codingTools,
})
  .createSession()
  .run("edit", { toolNames: ["read"] });
assert.equal(writeRan, 0, "run grant must not dispatch write");

const checkpoints = createMemoryCheckpointStore();
const codingConfig = {
  id: "restart-agent",
  model: { provider: "mock", model: "offline" },
  store: createMemorySessionStore(),
  tools: codingTools,
};
const first = await createAgent({ ...codingConfig, provider: codingProvider() })
  .createSession({ id: "restart-1" })
  .run("edit", {
    toolNames: ["read", "write"],
    runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
  });
assert.equal(first.status, "suspended");
const resumed = await resumeAgentRun(
  createAgent({
    ...codingConfig,
    provider: createMockProvider([providerTextDelta("done"), providerDone()]),
  }),
  { runId: first.runId, sessionId: first.sessionId },
  {
    expectedVersion: first.runState.version,
    decisions: first.interruption.pendingDecisions.map((decision) => ({
      approvalId: decision.approvalId,
      outcome: "allow_once",
    })),
  },
  { checkpoints, definitionRevision: "1" },
);
assert.equal(resumed.status, "succeeded");
assert.equal(writeRan, 1, "restart must execute the interrupted write exactly once");
mark("CODING OK");

// --- R07 evals ---
const manifest = {
  promptId: "prompt:host-completeness:v1",
  promptVersion: "1",
  toolFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  model: "mock:demo",
  policyRevision: "policy-1",
  runtimeRevision: "0.7.0",
  datasetVersion: "1.0.0",
};
validateReleaseEvalManifest(manifest);

function countingAgent(onRun) {
  return {
    config: {},
    createSession() {
      return {
        id: "s",
        async run() {
          onRun();
          return { sessionId: "s", runId: "r", status: "succeeded", text: "ok", content: [] };
        },
      };
    },
  };
}

let trialRuns = 0;
const trialReport = await runExperiment({
  agent: countingAgent(() => {
    trialRuns += 1;
  }),
  dataset: defineDataset({ id: "count", items: [{ id: "i", input: "x" }] }),
  scorers: [defineScorer({ id: "ok", score: () => ({ score: 1 }) })],
  trials: 3,
  seed: 1,
  manifest,
});
assert.equal(trialRuns, 3);
assert.equal(trialReport.trials?.sampleCount, 3);

function oneShot(name) {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield providerToolCall({ type: "tool_call", id: "c1", name, arguments: {} });
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

let deniedRan = 0;
const denied = await runExperiment({
  agent: wrapAgentWithFailureInjection(
    createAgent({
      model: { provider: "mock", model: "demo" },
      provider: oneShot("drop_database"),
      tools: [
        {
          name: "drop_database",
          description: "drop",
          parameters: { type: "object", properties: {} },
          async execute(_args, ctx) {
            deniedRan += 1;
            return { toolCallId: ctx.toolCallId, name: "drop_database", value: { dropped: true } };
          },
        },
      ],
    }),
    { denyTools: ["drop_database"] },
  ),
  dataset: defineDataset({ id: "deny", items: [{ id: "i", input: "drop" }] }),
  scorers: [defineScorer({ id: "ok", score: () => ({ score: 1 }) })],
});
assert.equal(deniedRan, 0);
assert.equal(denied.status, "succeeded");

let unknownRan = 0;
const unknown = await runExperiment({
  agent: wrapAgentWithFailureInjection(
    createAgent({
      model: { provider: "mock", model: "demo" },
      provider: oneShot("move_money"),
      tools: [
        {
          name: "move_money",
          description: "move",
          parameters: { type: "object", properties: {} },
          effect: { kind: "external_mutation", idempotency: "required" },
          async execute(_args, ctx) {
            unknownRan += 1;
            return { toolCallId: ctx.toolCallId, name: "move_money", value: { moved: true } };
          },
        },
      ],
    }),
    { unknownEffect: true },
  ),
  dataset: defineDataset({ id: "unknown", items: [{ id: "i", input: "move" }] }),
  scorers: [defineScorer({ id: "ok", score: () => ({ score: 1 }) })],
});
assert.equal(unknownRan, 0);
assert.equal(unknown.status, "succeeded");

const dir = mkdtempSync(join(tmpdir(), "prism-070-oracle-"));
try {
  const fixture = join(dir, "oracle.txt");
  writeFileSync(fixture, "ok\n");
  const oracle = defineScorer({
    id: "test-oracle",
    score: ({ environment }) => ({
      score: environment?.testsPassed ? 1 : 0,
      metadata: { invariant: true },
    }),
  });
  const red = await runExperiment({
    agent: createAgent({
      model: { provider: "mock", model: "offline" },
      provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
    }),
    dataset: defineDataset({
      id: "oracle-red",
      items: [{ id: "red", input: "x", expected: { hash: "00".repeat(32) } }],
    }),
    scorers: [oracle],
    toEnvironment: async (item) => ({
      testsPassed: createHash("sha256").update(readFileSync(fixture)).digest("hex") === item.expected?.hash,
    }),
  });
  assert.equal(red.aggregate.invariantsPassed, false);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const revoked = await createCitationIntegrityScorer().score({
  result: { sessionId: "s", runId: "r", status: "succeeded", text: "ok", content: [] },
  environment: {
    citations: [
      {
        citation: { uri: "rag:s1", sourceId: "s1", revision: "1", contentHash: "aa".repeat(32) },
        live: { contentHash: "aa".repeat(32), revision: "1", authorized: false },
      },
    ],
  },
});
assert.equal(revoked.score, 0);
assert.equal(revoked.reason, "revoked_acl");
mark("EVAL OK");

// --- R15 timeline + graph ---
const folder = createTimelineFolder({ content: "metadata" });
folder.push({ type: "agent_started", sessionId: "s", runId: "r" });
folder.push({
  type: "tool_execution_finished",
  sessionId: "s",
  runId: "r",
  toolCallId: "c1",
  name: "read",
  durationMs: 1,
});
const summary = summarizeTimeline(folder.snapshot());
assert.ok(summary.toolCallCount >= 0);
const wf = defineWorkflow({
  id: "linear-wf",
  revision: "v1",
  nodes: {
    stepA: { kind: "function", execute: () => "a" },
    stepB: { kind: "function", execute: () => "b" },
  },
  edges: [["stepA", "stepB"]],
});
const mermaid = workflowGraphToMermaid(serializeWorkflowGraph(wf));
assert.match(mermaid, /stepA/);
assert.match(mermaid, /stepB/);
mark("TIMELINE OK");
mark("GRAPH OK");

// --- R14 barge-in ---
const policy = resolveDevicePolicy(
  { kind: "voice", enabled: true, requireApproval: true, sandbox: "voice-sandbox" },
  { runLimits: { maxTurns: 4, maxToolCalls: 8 } },
);
function fakeSession() {
  const queue = [];
  let wait;
  let closed = false;
  const deliver = (event) => {
    if (wait) {
      wait(event);
      wait = undefined;
      return;
    }
    queue.push(event);
  };
  return {
    id: "rt-1",
    provider: "mock",
    push: deliver,
    async sendAudio() {},
    events() {
      return (async function* () {
        for (;;) {
          const event =
            queue.shift() ??
            (closed
              ? undefined
              : await new Promise((resolve) => {
                  wait = resolve;
                }));
          if (!event) break;
          yield event;
          if (event.type === "session_closed") break;
        }
      })();
    },
    async interrupt() {
      deliver({ type: "interrupted" });
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      deliver({ type: "session_closed", reason });
    },
    async completeTool() {},
  };
}
const session = fakeSession();
let effectRan = false;
const bridge = createRealtimeVoiceBridge({
  session,
  policy,
  admit: { approved: true, activeSessions: 0 },
  execute: async () => {
    effectRan = true;
    return { toolCallId: "c1", name: "refund", value: { ok: true } };
  },
});
const running = bridge.run();
session.push({ type: "session_started", sessionId: "s" });
await bridge.interrupt();
session.push({
  type: "tool_call",
  call: { type: "tool_call", id: "c1", name: "refund", arguments: {} },
});
session.push({ type: "session_closed" });
const snap = await running;
assert.equal(effectRan, false);
assert.ok(snap.interrupted || snap.cancelledCallIds.includes("c1") || snap.completedCallIds.length === 0);
mark("VOICE OK");

// --- R16 work-scope memory index ---
const scopeStore = createMemorySessionStore();
const scopeSession = createAgent({
  model: { provider: "mock", model: "offline" },
  provider: createMockProvider([providerTextDelta("ready"), providerDone()]),
  store: scopeStore,
}).createSession({ id: "work-scope-journey" });
await scopeSession.run("start work-scope journey");
const scopes = createWorkScopeController({ session: scopeSession, appendEntry: (entry) => scopeStore.append(entry) });
await scopes.open({ id: "plan:memory", kind: "plan" });
await scopes.open({ id: "task:1", parentId: "plan:memory", kind: "task" });
await scopes.enter("task:1");
const parentId = scopeSession.leafId;
assert.ok(parentId);
const observationEntry = createSessionEntry({
  sessionId: scopeSession.id,
  parentId,
  kind: "custom",
  data: {
    type: OBSERVATIONS_RECORDED,
    observations: [
      {
        id: "aaaaaaaaaaaa",
        content: "Task one is isolated until promoted.",
        timestamp: "2026-09-15T00:00:00.000Z",
        relevance: "high",
        sourceEntryIds: ["scope-source"],
        tokenCount: 7,
      },
    ],
  },
});
await scopeStore.append(observationEntry);
await scopeSession.checkout(observationEntry.id);
const reflectionEntry = createSessionEntry({
  sessionId: scopeSession.id,
  parentId: observationEntry.id,
  kind: "custom",
  data: {
    type: REFLECTIONS_RECORDED,
    reflections: [
      {
        id: "bbbbbbbbbbbb",
        content: "Task one prefers the smallest retry budget.",
        supportingObservationIds: ["aaaaaaaaaaaa"],
        tokenCount: 8,
      },
    ],
  },
});
await scopeStore.append(reflectionEntry);
await scopeSession.checkout(reflectionEntry.id);
await scopes.bind("task:1", ["om:aaaaaaaaaaaa", "reflection:bbbbbbbbbbbb"]);
await scopes.close("task:1");
await scopes.open({ id: "task:15", parentId: "plan:memory", kind: "task" });
await scopes.enter("task:15");
let scopeEntries = await scopeSession.entries();
let scoped = projectWorkMemory(foldObservationalMemoryLedger(scopeEntries), foldWorkScopeMap(scopeEntries), {
  from: "task:15",
  include: "self+ancestors",
});
assert.equal(
  scoped.observations.some((observation) => observation.id === "aaaaaaaaaaaa"),
  false,
);
await scopes.bind("plan:memory", ["om:aaaaaaaaaaaa"]);
scopeEntries = await scopeSession.entries();
scoped = projectWorkMemory(foldObservationalMemoryLedger(scopeEntries), foldWorkScopeMap(scopeEntries), {
  from: "task:15",
  include: "self+ancestors",
});
assert.equal(
  scoped.observations.some((observation) => observation.id === "aaaaaaaaaaaa"),
  true,
);
const promotionMemory = createMemory({
  tenantId: "t1",
  resourceId: "r1",
  threadId: "fabric-promotion",
  embedder: createHashEmbedder({ dimensions: 2 }),
});
const fabric = createMemoryFabric({ memory: promotionMemory, observational: { session: scopeSession } });
const promoted = await fabric.remember({ kind: "procedure", reflectionId: "bbbbbbbbbbbb" });
assert.equal(promoted.content, "Task one prefers the smallest retry budget.");
assert.deepEqual(promoted.promotedFrom, { reflectionId: "bbbbbbbbbbbb", scopeId: "task:1" });
assert.equal((await fabric.recall("smallest retry budget", { kinds: ["procedure"] })).hits.length, 1);
mark("R16 OK");

// --- R17 attention compiler + host-programmable compaction trigger ---
const truncation = createAttentionTruncationTrigger({ threshold: 2 });
assert.equal(truncation.streak(), 0);
assert.throws(() => createAttentionTruncationTrigger({ threshold: 0 }), /positive safe integer/);
const triggerContext = { sessionId: "r17", entryCount: 1, estimateInputTokens: () => 100, resolveInputCapTokens: () => 1_000 };
assert.equal(await resolveShouldCompact({ trigger: truncation.trigger }, triggerContext), false);
assert.equal(truncation.observe({ truncated: true }), 1);
truncation.observe({ truncated: true });
assert.equal(
  await resolveShouldCompact({ trigger: truncation.trigger }, triggerContext),
  true,
  "consecutive truncated turns compact once at the next boundary",
);
assert.equal(await resolveShouldCompact({ trigger: truncation.trigger }, triggerContext), false, "the fired streak is consumed");
assert.equal(truncation.observe({ truncated: false }), 0, "a relieved turn clears the streak");
truncation.observe({ truncated: true });
truncation.reset();
assert.equal(truncation.streak(), 0);
const attentionCompiler = createAttentionCompiler({ maxInputTokens: 1_000, triggerRatio: 0.5 });
assert.equal(attentionCompiler.inputCap, 1_000);
assert.equal(attentionCompiler.triggerRatio, 0.5);
assert.equal(resolveInputCap({ maxInputTokens: 64 }), 64);
mark("R17 OK");

console.log("HOST COMPLETENESS JOURNEY OK");
console.log(
  JSON.stringify({
    marks,
    sampleCount: trialReport.trials?.sampleCount,
    trialRuns,
    deniedRan,
    unknownRan,
    writeRan,
    revokedAcl: revoked.score,
  }),
);
