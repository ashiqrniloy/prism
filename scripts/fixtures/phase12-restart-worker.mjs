#!/usr/bin/env node
/**
 * Phase 12 protected restart-recovery worker (plan 012 Task 4).
 *
 * Modes (PRISM_PHASE12_WORKER_INPUT = JSON {url, schema, ownership, identity, mode}):
 *   run     — replica A: durable agent run against PostgreSQL that suspends on
 *             a batched tool approval, appends durable events, prints STATE
 *             {sessionId, runId, version, cursor}, then stays alive so the
 *             driver can SIGKILL it (hard crash, no cleanup).
 *   resume  — replica B: reconnects to the same schema, verifies event
 *             continuity (no gap / no duplicate), tenant isolation on events
 *             and run state, partial-approval re-suspend, CAS versions, the
 *             durable tool-effect exactly-once path, and the unknown-outcome
 *             window (fail closed, never silent double-apply). Prints
 *             RESTART RECOVERY OK + reconnectMs.
 *   append  — contention probe: append one durable event, print appendMs.
 *   warm    — apply all migrations + create the probe session/stream rows once
 *             (driver-side warm-up so append workers measure the steady-state
 *             point op, not DDL lock waits from concurrent migration bursts;
 *             0.2.2 amendment, plan 022 Task 6).
 *
 * Uses the same workspace-dist imports as scripts/fixtures/phase7-worker.mjs.
 */
import assert from "node:assert/strict";
import { writeSync } from "node:fs";
import { createPostgresEnterpriseState } from "../../packages/enterprise-postgres/dist/index.js";
import { createPostgresPersistence } from "../../packages/session-store-postgres/dist/index.js";
import {
  createAgent,
  createAgentRunLifecycle,
  createToolRegistry,
  dispatchToolCall,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "../../dist/index.js";
import { Pool } from "pg";

const input = JSON.parse(process.env.PRISM_PHASE12_WORKER_INPUT ?? "null");
if (!input || typeof input !== "object" || !["run", "resume", "append", "warm"].includes(input.mode ?? "")) {
  throw new Error("PRISM_PHASE12_WORKER_INPUT with mode run|resume|append|warm is required");
}
if (typeof input.url !== "string" || typeof input.schema !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.schema)) {
  throw new Error("invalid phase 12 worker database input");
}

const pool = new Pool({ connectionString: input.url, max: 4 });
const ownership = input.ownership;
const identity = input.identity;
const definitionRevision = "1";
const toolDef = {
  name: "write",
  description: "writes a file; durable effect counted exactly once",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  effect: { kind: "external_mutation", idempotency: "required" },
  execute: async (args, context) => {
    const result = await pool.query(
      `INSERT INTO "${input.schema}"."phase12_counter" (id, executions) VALUES ($1, 1)
       ON CONFLICT (id) DO UPDATE SET executions = "${input.schema}"."phase12_counter".executions + 1
       RETURNING executions`,
      [String(args.path)],
    );
    return {
      toolCallId: context.toolCallId,
      name: "write",
      value: { path: args.path, executions: Number(result.rows[0].executions) },
    };
  },
};

function makeAgent({ store, effectStore }) {
  let turn = 0;
  const agent = createAgent({
    id: "restart-agent",
    model: { provider: "mock", model: "demo" },
    store,
    ownership,
    identity,
    effectStore,
    provider: {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            call: toolCallContent("c1", "write", { path: "a.txt" }),
          };
          yield {
            type: "tool_call",
            call: toolCallContent("c2", "write", { path: "b.txt" }),
          };
          yield providerDone();
          return;
        }
        yield providerTextDelta("completed after restart");
        yield providerDone();
      },
    },
    loop: {
      name: "restart",
      revision: definitionRevision,
      snapshot: () => ({ turn }),
      restore: (snapshot) => {
        turn = snapshot.turn;
      },
      async run(ctx) {
        const { calls } = await ctx.generate(await ctx.assemble([]));
        await ctx.chargeToolRound?.(calls);
        for (const call of calls) await ctx.dispatchToolCall(call);
      },
    },
    tools: [toolDef],
  });
  return agent;
}

async function open() {
  const persistence = await createPostgresPersistence({
    pool,
    schema: input.schema,
    eventCursorSecret: "phase12-restart-cursor-secret",
    eventSource: {
      pollIntervalMs: 25,
      reconnectInitialMs: 100,
      reconnectMaxMs: 2000,
    },
  });
  const enterprise = await createPostgresEnterpriseState({
    pool,
    schema: input.schema,
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS "${input.schema}"."phase12_counter" (id TEXT PRIMARY KEY, executions INTEGER NOT NULL)`);
  return { persistence, enterprise };
}

async function runReplicaA() {
  const { persistence, enterprise } = await open();
  const agent = makeAgent({
    store: persistence,
    effectStore: enterprise.toolEffects,
  });
  const first = await agent.createSession({ id: "restart-s" }).run("go", {
    runState: {
      checkpoints: persistence.checkpoints,
      definitionRevision,
      interruptBeforeTool: true,
    },
  });
  assert.equal(first.status, "suspended");
  assert.equal(first.interruption.pendingDecisions.length, 2);
  // Durable events appended by the host around the run (same wiring as the
  // packed-install journey; deterministic timestamps keep records dedupe-safe).
  for (const call of [
    { id: "c1", path: "a.txt" },
    { id: "c2", path: "b.txt" },
  ]) {
    await persistence.events.append({
      id: `evt-${call.id}`,
      sessionId: first.sessionId,
      runId: first.runId,
      type: "tool_execution_started",
      timestamp: "2026-08-09T00:00:00.000Z",
      event: {
        type: "tool_execution_started",
        sessionId: first.sessionId,
        runId: first.runId,
        call: toolCallContent(call.id, "write", { path: call.path }),
      },
      redacted: true,
      ...ownership,
    });
  }
  writeSync(
    1,
    `STATE ${JSON.stringify({
      sessionId: first.sessionId,
      runId: first.runId,
      version: first.runState.version,
      approvalIds: first.interruption.pendingDecisions.map((d) => d.approvalId),
    })}\n`,
  );
  // Stay alive: the driver SIGKILLs this process to simulate replica A's crash.
  setInterval(() => {}, 1000);
}

async function resumeReplicaB() {
  const state = JSON.parse(process.env.PRISM_PHASE12_RESUME_STATE ?? "null");
  if (!state || typeof state !== "object" || !Array.isArray(state.approvalIds) || state.approvalIds.length !== 2)
    throw new Error("PRISM_PHASE12_RESUME_STATE with approvalIds is required for resume mode");
  const [approvalOne, approvalTwo] = state.approvalIds;
  const t0 = Date.now();
  const { persistence, enterprise } = await open();
  const agent = makeAgent({
    store: persistence,
    effectStore: enterprise.toolEffects,
  });
  const ref = { sessionId: state.sessionId, runId: state.runId };

  // --- no gap / no duplicate for consumers after the crash -----------------
  const page = await persistence.events.page({
    ownership,
    sessionId: ref.sessionId,
    runId: ref.runId,
    limit: 10,
  });
  assert.deepEqual(
    page.items.map((item) => item.record.id),
    ["evt-c1", "evt-c2"],
    "events written before the crash are intact",
  );
  assert.deepEqual(
    page.items.map((item) => item.record.sequence),
    [1, 2],
    "sequences are contiguous (no gap)",
  );

  // --- tenant isolation on resume ------------------------------------------
  const foreign = {
    tenantId: "tenant-other",
    accountId: "account-1",
    userId: "user-1",
  };
  const foreignPage = await persistence.events.page({
    ownership: foreign,
    sessionId: ref.sessionId,
    runId: ref.runId,
    limit: 10,
  });
  assert.equal(foreignPage.items.length, 0, "foreign tenant sees no events");
  await assert.rejects(
    persistence.events.page({
      ownership: foreign,
      sessionId: ref.sessionId,
      runId: ref.runId,
      after: page.items.at(-1).cursor,
      limit: 10,
    }),
    (error) => error?.code === "ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR",
    "foreign tenant cannot reuse our cursor",
  );
  const lifecycle = createAgentRunLifecycle({
    checkpoints: persistence.checkpoints,
    resolveAgent: async () => ({ agent, definitionRevision }),
  });
  await assert.rejects(
    lifecycle.status(ref, { ownership: foreign }),
    (error) => error?.name === "CheckpointConflictError",
    "foreign ownership cannot read the run state",
  );
  const ownStatus = await lifecycle.status(ref, { ownership });
  assert.equal(ownStatus.version, state.version, "run state survives the crash with its CAS version");

  // --- partial approval re-suspends; CAS versions hold ---------------------
  const partial = await resumeAgentRun(
    agent,
    ref,
    {
      expectedVersion: state.version,
      decisions: [{ approvalId: approvalOne, outcome: "allow_once" }],
    },
    { checkpoints: persistence.checkpoints, definitionRevision, ownership },
  );
  assert.equal(partial.status, "suspended", "partial batch re-suspends");
  assert.deepEqual(
    partial.interruption.pendingDecisions.map((d) => d.approvalId),
    [approvalTwo],
    "remaining decision survives the partial batch",
  );
  await assert.rejects(
    resumeAgentRun(
      agent,
      ref,
      {
        expectedVersion: state.version,
        decisions: [{ approvalId: "appr-2", outcome: "allow_once" }],
      },
      { checkpoints: persistence.checkpoints, definitionRevision, ownership },
    ),
    (error) => error instanceof Error && /stale|version|suspend/i.test(error.message),
    "stale CAS version is rejected on resume",
  );

  // --- full resume: pending approvals dispatch with durable effects --------
  const done = await resumeAgentRun(
    agent,
    ref,
    {
      expectedVersion: partial.runState.version,
      decisions: [{ approvalId: approvalTwo, outcome: "allow_once" }],
    },
    { checkpoints: persistence.checkpoints, definitionRevision, ownership },
  );
  assert.equal(done.status, "succeeded", "run completes on replica B");
  const counters = await pool.query(`SELECT executions FROM "${input.schema}"."phase12_counter" ORDER BY id`);
  assert.deepEqual(
    counters.rows.map((row) => row.executions),
    [1, 1],
    "each durable effect executed exactly once across the restart",
  );

  // --- continuation appends stay contiguous (no duplicate) -----------------
  await persistence.events.append({
    id: "evt-done",
    sessionId: ref.sessionId,
    runId: ref.runId,
    type: "turn_finished",
    timestamp: "2026-08-09T00:00:01.000Z",
    event: {
      type: "turn_finished",
      sessionId: ref.sessionId,
      runId: ref.runId,
      turn: 2,
    },
    redacted: true,
    ...ownership,
  });
  const continued = await persistence.events.page({
    ownership,
    sessionId: ref.sessionId,
    runId: ref.runId,
    limit: 10,
  });
  assert.deepEqual(
    continued.items.map((item) => item.record.id),
    ["evt-c1", "evt-c2", "evt-done"],
    "resumed stream has no gap and no duplicate",
  );
  assert.deepEqual(
    continued.items.map((item) => item.record.sequence),
    [1, 2, 3],
    "sequences stay contiguous across the restart",
  );

  // --- tool-effect unknown-outcome window: fail closed, never re-run -------
  // Simulate a crash between dispatch and completion through the store's own
  // transitions (same as phase 7): a claim is dispatched and then expires,
  // so the outcome is unknown — replay must demand reconciliation instead of
  // silently re-applying the side effect.
  const { deriveToolEffectKey, toolEffectArgumentsHash } = await import("../../dist/tool-effects.js");
  const effectBase = {
    identity,
    ownership,
    sessionId: ref.sessionId,
    runId: ref.runId,
    toolCallId: "c3",
    toolName: "write",
    argumentsHash: toolEffectArgumentsHash({ path: "c.txt" }),
  };
  const claim = await enterprise.toolEffects.begin({
    ...effectBase,
    key: deriveToolEffectKey(effectBase),
  });
  assert.equal(claim.outcome, "acquired", "fresh effect claim acquired");
  await enterprise.toolEffects.markDispatched({
    ...effectBase,
    key: deriveToolEffectKey(effectBase),
    claimToken: claim.record.claimToken,
    expectedVersion: claim.record.version,
  });
  await pool.query(
    `UPDATE "${input.schema}"."prism_tool_effects" SET expires_at = clock_timestamp() - INTERVAL '1 millisecond'
     WHERE tool_call_id = 'c3'`,
  );
  const registry = createToolRegistry([toolDef]);
  const refused = await dispatchToolCall({
    call: { id: "c3", name: "write", arguments: { path: "c.txt" } },
    registry,
    context: {
      sessionId: ref.sessionId,
      runId: ref.runId,
      toolCallId: "c3",
      signal: new AbortController().signal,
      metadata: {},
    },
    effectStore: enterprise.toolEffects,
    identity,
  });
  assert.match(
    JSON.stringify(refused),
    /ERR_PRISM_TOOL_EFFECT_UNKNOWN|requires reconciliation/i,
    "unknown-outcome effect demands reconciliation instead of silent replay",
  );
  const after = await pool.query(`SELECT executions FROM "${input.schema}"."phase12_counter" WHERE id = 'c.txt'`);
  assert.equal(after.rows.length, 0, "unknown-outcome window never applies the side effect");

  const reconnectMs = Date.now() - t0;
  await persistence.close();
  await enterprise.close();
  writeSync(1, `RESTART RECOVERY OK reconnectMs=${reconnectMs}\n`);
}

async function appendProbe() {
  const { persistence } = await open();
  const sessionId = process.env.PRISM_PHASE12_PROBE_SESSION ?? "probe-s";
  const runId = process.env.PRISM_PHASE12_PROBE_RUN ?? "probe-r";
  const t0 = performance.now();
  await persistence.events.append({
    id: `probe-${process.pid}`,
    sessionId,
    runId,
    type: "turn_started",
    timestamp: "2026-08-09T00:00:00.000Z",
    event: { type: "turn_started", sessionId, runId, turn: 1 },
    redacted: true,
    ...ownership,
  });
  const appendMs = performance.now() - t0;
  await persistence.close();
  writeSync(1, `APPEND ${JSON.stringify({ appendMs: Math.round(appendMs * 100) / 100 })}\n`);
}

async function warmProbe() {
  const { persistence, enterprise } = await open();
  await persistence.events.append({
    id: "warm-seed",
    sessionId: "probe-s",
    runId: "probe-r",
    type: "turn_started",
    timestamp: "2026-08-09T00:00:00.000Z",
    event: { type: "turn_started", sessionId: "probe-s", runId: "probe-r", turn: 1 },
    redacted: true,
    ...ownership,
  });
  await persistence.close();
  await enterprise.close();
  writeSync(1, "WARM OK\n");
}

try {
  if (input.mode === "run") await runReplicaA();
  else if (input.mode === "resume") await resumeReplicaB();
  else if (input.mode === "warm") await warmProbe();
  else await appendProbe();
} finally {
  if (input.mode !== "run") await pool.end();
}
