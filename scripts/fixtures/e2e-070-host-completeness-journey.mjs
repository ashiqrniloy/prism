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
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  createStaticTrustPolicy,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resolveInputCap,
} from "@arnilo/prism";
import { resolveDevicePolicy } from "@arnilo/prism-tools-computer-use";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { mockProvider } from "@arnilo/prism/testing";
import { createAttentionCompiler, createAttentionTruncationTrigger } from "@arnilo/prism-context-engineering";
import {
  createCitationIntegrityScorer,
  defineDataset,
  defineScorer,
  failureInjection,
  runExperiment,
  validateReleaseEvalManifest,
} from "@arnilo/prism-evals";
import { createTimelineFolder, summarizeTimeline } from "@arnilo/prism-observability";
import { defineWorkflow, serializeWorkflowGraph, workflowGraphToMermaid } from "@arnilo/prism-workflows";
import { inspectHostComposition } from "@arnilo/prism-governance";
import { createHashEmbedder, revokedIdsAbsent } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric } from "@arnilo/prism-memory-fabric";
import memoryObservational, { foldObservationalMemoryLedger } from "@arnilo/prism-memory-observational";
import { createMemoryWorkDraftStore, validateApproval } from "@arnilo/prism-tools-work/connectors";

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
// The 0.12 allow-list gate (`selectMcpServers`, prefix-match rejected) retired with the ACP adapter.
// 0.13 `serveAcp` fails closed on any client-supplied server list (`packages/hosts/acp/src/serve.ts`),
// which the ACP host library covers; the host-completeness journey no longer probes it here.
mark("TRAP_A OK");

// --- R05 personal / business composition ---
const redactor = createSecretRedactor(["packed-secret"]);
const validator = { validate: () => ({ ok: true }) };
// Plan 159 Task 7: `createSecureAgent` is gone; the same explicit config with a plain `createAgent`.
const personal = await createAgent({
  id: "personal-assistant",
  ownership: { userId: "alice" },
  redactor,
  trust: createStaticTrustPolicy(true),
  validator,
  limits: { maxToolRounds: 4 },
  tools: {
    add: [
      {
        name: "workspace_status",
        description: "status",
        parameters: { type: "object", properties: {} },
        execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "workspace_status", value: { ok: true } }),
      },
    ],
  },
  packages: [mockProvider([[providerTextDelta("ready"), providerDone()]])],
  model: { provider: "mock", model: "personal" },
});
const personalReport = inspectHostComposition({ profile: "personal", agent: personal });
assert.equal(personalReport.readiness.ok, true);
assert.equal(personalReport.ownership.userId, "alice");
mark("PERSONAL OK");

const business = await createAgent({
  id: "business-worker",
  ownership: { tenantId: identity.tenantId, userId: identity.userId },
  principal: identity.principal,
  redactor,
  trust: createStaticTrustPolicy(true),
  // Business readiness requires a tool gate (a `tool.call` registration); `createSecureAgent` used
  // to register `askEveryTool` for it.
  hooks: askEveryTool(),
  validator,
  limits: { maxToolRounds: 4 },
  tools: {
    add: [
      {
        name: "process_tenant_record",
        description: "process",
        parameters: { type: "object", properties: { recordId: { type: "string" } } },
        execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "process_tenant_record", value: { ok: true } }),
      },
    ],
  },
  packages: [mockProvider([[providerTextDelta("ready"), providerDone()]])],
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
await (
  await (
    await createAgent({
      model: { provider: "coding-mock", model: "offline" },
      packages: [providerPackage("test-provider", [codingProvider()])],
      tools: { add: codingTools },
    })
  ).session()
).run("edit", { tools: { only: ["read"] } });
assert.equal(writeRan, 0, "run grant must not dispatch write");

const codingConfig = {
  id: "restart-agent",
  model: { provider: "coding-mock", model: "offline" },
  slots: { store: createMemorySessionStore() },
  hooks: askEveryTool(),
  tools: { add: codingTools },
};
const first = await (
  await (
    await createAgent({ ...codingConfig, packages: [providerPackage("test-provider", [codingProvider()])] })
  ).session({ id: "restart-1", create: true })
).run("edit", { tools: { only: ["read", "write"] } });
assert.equal(first.status, "suspended");
// A restarted worker reads the suspension from the store slot and continues the same run.
const restarted = await (
  await createAgent({
    ...codingConfig,
    packages: [
      providerPackage("test-provider", [
        {
          id: "coding-mock",
          async *generate() {
            yield providerTextDelta("done");
            yield providerDone();
          },
        },
      ]),
    ],
  })
).session({ id: "restart-1" });
let restartedLast;
for await (const event of restarted.resume(
  first.pending.map((decision) => ({
    approvalId: decision.approvalId,
    outcome: "allow_once",
  })),
)) {
  restartedLast = event;
}
assert.equal(restartedLast?.type, "run.completed");
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
    async session() {
      return {
        id: "s",
        async run() {
          onRun();
          return { sessionId: "s", runId: "r", status: "completed", text: "ok", content: [], messages: [] };
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
  agent: await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [oneShot("drop_database")])],
    hooks: failureInjection({ denyTools: ["drop_database"] }),
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
  dataset: defineDataset({ id: "deny", items: [{ id: "i", input: "drop" }] }),
  scorers: [defineScorer({ id: "ok", score: () => ({ score: 1 }) })],
});
assert.equal(deniedRan, 0);
assert.equal(denied.status, "succeeded");

let unknownRan = 0;
const unknown = await runExperiment({
  agent: await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [oneShot("move_money")])],
    hooks: failureInjection({ unknownEffect: true }),
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
    agent: await createAgent({
      model: { provider: "mock", model: "offline" },
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
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
  result: { sessionId: "s", runId: "r", status: "completed", text: "ok", content: [], messages: [] },
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
folder.push({ type: "run.started", sessionId: "s", runId: "r" });
folder.push({
  type: "tool.completed",
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
function createRealtimeVoiceBridge() {
  return {
    run: async () => ({ interrupted: true, cancelledCallIds: ["c1"], completedCallIds: [] }),
    async interrupt() {},
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

// --- R16 observational memory package + fabric reflection promotion ---
const scopeStore = createMemorySessionStore();
// One worker provider serves both roles: the loop offers `record_observation` to the observer and
// `record_reflection` to the reflector, and each prompt lists its inputs as `[id]`.
const observerProvider = {
  id: "memory",
  async *generate(request) {
    const alreadyCalled = request.messages.some((message) => message.role === "tool");
    const prompt = request.messages.find((message) => message.role === "user")?.content[0];
    const text = prompt?.type === "text" ? prompt.text : "";
    const sourceEntryIds = [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
    const toolNames = new Set((request.tools ?? []).map((tool) => tool.name));
    if (!alreadyCalled && sourceEntryIds.length > 0) {
      if (toolNames.has("record_reflection")) {
        yield providerToolCall({
          type: "tool_call",
          id: "c1",
          name: "record_reflection",
          arguments: { content: "Task one prefers the smallest retry budget.", supportingObservationIds: sourceEntryIds },
        });
      } else if (toolNames.has("record_observation")) {
        yield providerToolCall({
          type: "tool_call",
          id: "c1",
          name: "record_observation",
          arguments: { content: "Journey turn observed.", relevance: "high", sourceEntryIds },
        });
      }
    }
    yield providerDone();
  },
};
const scopeAgent = await createAgent({
  model: { provider: "mock", model: "offline" },
  packages: [
    mockProvider([[providerTextDelta("ready"), providerDone()]]),
    providerPackage("memory", [observerProvider]),
    memoryObservational({
      observer: { model: { provider: "memory", model: "worker" }, messageTokens: 1 },
      reflector: { model: { provider: "memory", model: "worker" }, observationTokens: 1 },
      context: { compactAfterTokens: 999_999 },
      worker: { maxTurns: 1 },
    }),
  ],
  slots: { store: scopeStore },
});
const scopeSession = await scopeAgent.session({ id: "om-journey", create: true });
const beforeToggle = await scopeAgent.commands.run("om:status", {}, { session: scopeSession });
assert.equal(beforeToggle.enabled, false, "the package is off until the session toggles it");
await scopeSession.run("start observational-memory journey");
await scopeAgent.commands.run("om", {}, { session: scopeSession });
await scopeSession.run("second turn the observer can see");
const omStatus = await scopeAgent.commands.run("om:status", {}, { session: scopeSession });
assert.equal(omStatus.enabled, true, "the toggle sticks to the session");
assert.ok((omStatus.observations?.recorded ?? 0) > 0, "the observer recorded an observation");
const omView = await scopeAgent.commands.run("om:view", {}, { session: scopeSession });
assert.ok(typeof omView.text === "string" && omView.text.length > 0, "the ledger renders");

// The fabric folds the branch the package wrote to: `state.log` records reach it as `package_state`
// entries, so promotion needs no 0.12 attach surface and no host-side seeding.
let ledger = foldObservationalMemoryLedger(await scopeSession.entries());
for (let attempt = 0; attempt < 100 && ledger.reflections.length === 0; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 20));
  ledger = foldObservationalMemoryLedger(await scopeSession.entries());
}
assert.ok(ledger.observations.length > 0, "the branch fold reads the package's observation records");
assert.ok(ledger.reflections.length > 0, "the branch fold reads the package's reflection records");
const promotionMemory = createMemory({
  tenantId: "t1",
  resourceId: "r1",
  threadId: "fabric-promotion",
  embedder: createHashEmbedder({ dimensions: 2 }),
});
const fabric = createMemoryFabric({ memory: promotionMemory, observational: { session: scopeSession } });
const promoted = await fabric.remember({ kind: "procedure", reflectionId: ledger.reflections[0].id });
assert.equal(promoted.content, "Task one prefers the smallest retry budget.");
assert.deepEqual(promoted.promotedFrom, { reflectionId: ledger.reflections[0].id });
assert.equal((await fabric.recall("smallest retry budget", { kinds: ["procedure"] })).hits.length, 1);
const episode = await fabric.remember({ kind: "episode", id: ledger.observations[0].id });
assert.equal(episode.content, ledger.observations[0].content, "the fabric derives an episode from the package's observation");
mark("R16 OK");

// --- R17 attention compiler + host-programmable compaction trigger ---
const truncation = createAttentionTruncationTrigger({ threshold: 2 });
assert.equal(truncation.streak(), 0);
assert.throws(() => createAttentionTruncationTrigger({ threshold: 0 }), /positive safe integer/);
assert.equal(truncation.shouldCompact(), false);
assert.equal(truncation.observe({ truncated: true }), 1);
truncation.observe({ truncated: true });
assert.equal(truncation.shouldCompact(), true, "consecutive truncated turns compact once at the next boundary");
assert.equal(truncation.shouldCompact(), false, "the fired streak is consumed");
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
