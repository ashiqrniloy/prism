import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AttentionFoldLedger,
  compileAttention,
  createAttentionCompiler,
  createAttentionFoldLedger,
  createAttentionStickyFrontier,
  restoreAttentionFoldLedger,
  serializeAttentionFoldLedger,
} from "../attention-compiler.js";
import type { ContextBudgetMessageGroups } from "../context-budget.js";
import {
  AgentRunStateError,
  type AgentRunStateOptions,
  type AgentSession,
  type CheckpointStore,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  type Message,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  resolveToolResultFold,
  resumeAgentRun,
  toolCallContent,
} from "../index.js";

/**
 * Durable mid-run compaction (plan 086 T3): the fold ledger is summarized once, re-applied from
 * the session, and written to the run checkpoint at the fold boundary — never per turn.
 */

const model: ModelConfig = { provider: "test", model: "test-model" };
const PAYLOAD = "y".repeat(4_000);

function toolMessage(toolCallId: string, name: string, result: unknown): Message {
  return { role: "tool", content: [{ type: "tool_result", toolCallId, name, result }] };
}

function groups(history: Message[]): ContextBudgetMessageGroups {
  return {
    instructions: [{ role: "system", content: [{ type: "text", text: "Policy" }] }],
    summaries: [],
    history,
    input: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    attachments: [],
    toolResults: [],
  };
}

/** The stubbed body the provider would see, so the specs can compare bytes across turns. */
function toolResultText(
  messages: readonly { readonly content: readonly { readonly type: string; readonly toolCallId?: unknown; readonly result?: unknown }[] }[],
  toolCallId: string,
): string | undefined {
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_result" && block.toolCallId === toolCallId) return JSON.stringify(block.result ?? null);
    }
  }
  return undefined;
}

/** Simulates a host process dying: writes after the crash are rejected, as a dead worker makes none. */
function crashableCheckpoints(inner: CheckpointStore) {
  const gate = { open: true };
  const store: CheckpointStore = {
    ...inner,
    async saveCheckpoint(input) {
      if (!gate.open) throw new Error("checkpoint store unavailable (simulated process death)");
      return inner.saveCheckpoint(input);
    },
  };
  return { store, gate };
}

/** Runs a session while collecting its events, returning the run id from `agent_started`. */
async function runCapturingId(session: AgentSession, input: string, runState: AgentRunStateOptions) {
  const subscription = session.subscribe();
  let runId: string | undefined;
  const pump = (async () => {
    for await (const event of subscription) {
      if (event.type === "agent_started") runId = event.runId;
    }
  })();
  const settle = session.run(input, { runState });
  const outcome = await settle.then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  await pump;
  assert.ok(runId, "run id captured from agent_started");
  return { runId, ...outcome };
}

/** Agent whose first turn produces one large tool result, whose second turn folds it and then
 *  crashes, and whose third (resumed) turn answers. The compiler always folds what it can
 *  (`token_floor` just above the base request), so the specs are about the ledger, not the gate.
 *  No agent-level `toolResultFold`: the projection the ledger caches is the compiler's own. */
function foldingAgent(input: { readonly requests: ProviderRequest[]; readonly gate: { open: boolean }; readonly durable: boolean }) {
  let turn = 0;
  const agent = createAgent({
    id: "durable-fold",
    store: createMemorySessionStore(),
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate(request) {
        input.requests.push(request);
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("call-1", "lookup", { query: "dossier" }) };
          yield providerDone();
          return;
        }
        if (turn === 2 && input.gate.open) {
          input.gate.open = false;
          throw new Error("simulated worker crash");
        }
        yield providerTextDelta("investigation complete");
        yield providerDone();
      },
    },
    tools: [
      {
        name: "lookup",
        parameters: {},
        execute: () => ({ toolCallId: "call-1", name: "lookup", value: PAYLOAD }),
      },
    ],
    attentionCompiler: {
      maxInputTokens: 300,
      keepLast: 0,
      trigger: { kind: "token_floor", tokens: 200 },
      durable: input.durable,
    },
  });
  return { agent };
}

describe("attention fold ledger", () => {
  it("summarizes a folded row once and re-applies the stored body on later turns", async () => {
    let calls = 0;
    const fold = resolveToolResultFold(
      {
        minAgeTurns: 1,
        minBytes: 1,
        summarize: ({ toolCallId }) => {
          calls += 1;
          return `summary ${calls} of ${toolCallId}`;
        },
      },
      undefined,
    );
    assert.ok(fold);
    const compiler = createAttentionCompiler({ maxInputTokens: 100, triggerRatio: 0.2, keepLast: 0 }, { model });
    const attentionFold = createAttentionFoldLedger();
    const history = [toolMessage("call_1", "lookup", "x".repeat(400))];

    const first = await compileAttention({ compiler, groups: groups(history), fold, attentionFold, turn: 9 });
    const second = await compileAttention({ compiler, groups: groups(history), fold, attentionFold, turn: 10 });

    assert.equal(calls, 1, "the host summarize runs once for the row, not once per turn");
    assert.equal(first.report.newFoldedBodies, 1);
    assert.equal(second.report.newFoldedBodies, 0, "a re-applied body is not a new fold");
    assert.equal(
      toolResultText(first.groups.history, "call_1"),
      toolResultText(second.groups.history, "call_1"),
      "the stub body is byte-identical across turns",
    );
    assert.match(String(toolResultText(second.groups.history, "call_1")), /summary 1 of call_1/);
  });

  it("round-trips a persisted ledger and drops entries it cannot trust", () => {
    const ledger: AttentionFoldLedger = createAttentionFoldLedger();
    ledger.bodies.set("call_1", "body one");
    ledger.bodies.set("call_2", "body two");
    const persisted = serializeAttentionFoldLedger(ledger);
    assert.equal(persisted.v, 1, "the snapshot is versioned");
    const restored = restoreAttentionFoldLedger(persisted);
    assert.ok(restored);
    assert.deepEqual(
      [...restored.bodies],
      [
        ["call_1", "body one"],
        ["call_2", "body two"],
      ],
    );

    assert.equal(restoreAttentionFoldLedger(undefined), undefined);
    assert.equal(restoreAttentionFoldLedger(null), undefined);
    assert.equal(restoreAttentionFoldLedger({ bodies: "nope" }), undefined, "a malformed shape starts empty, not fatal");
    const messy = restoreAttentionFoldLedger({
      v: 1,
      bodies: [
        { id: "call_3", body: "kept" },
        { id: 7, body: "not an id" },
        { id: "call_4", body: "" },
        "junk",
        { id: "x".repeat(300), body: "id too long" },
        { id: "call_5", body: "z".repeat(5_000) },
      ],
    });
    assert.ok(messy);
    assert.deepEqual([...messy.bodies], [["call_3", "kept"]], "malformed entries are dropped one by one");
    assert.equal(createAttentionStickyFrontier().toolCallIds.size, 0, "the frontier factory stays independent");
  });

  it("re-applies a restored body under a closed gate, so a resumed run never re-summarizes", async () => {
    let calls = 0;
    const fold = resolveToolResultFold(
      {
        minAgeTurns: 1,
        minBytes: 1,
        summarize: () => {
          calls += 1;
          return `drifted summary ${calls}`;
        },
      },
      undefined,
    );
    assert.ok(fold);
    // A wide cap: the gate is closed, only the restored frontier keeps the row stubbed.
    const compiler = createAttentionCompiler({ maxInputTokens: 400_000, triggerRatio: 0.2, keepLast: 0 }, { model });
    const attentionFold = restoreAttentionFoldLedger({ v: 1, bodies: [{ id: "call_1", body: "persisted body" }] });
    assert.ok(attentionFold);
    const frontier = createAttentionStickyFrontier();
    frontier.toolCallIds.add("call_1");

    const out = await compileAttention({
      compiler,
      groups: groups([toolMessage("call_1", "lookup", "x".repeat(400))]),
      fold,
      attentionFold,
      frontier,
      turn: 30,
    });

    assert.equal(calls, 0, "a row with a persisted body is never re-summarized");
    assert.equal(toolResultText(out.groups.history, "call_1"), JSON.stringify("Tool result lookup [call_1]: persisted body"));
    assert.equal(out.report.newFoldedBodies, 0);
  });
});

describe("durable fold checkpoints", () => {
  it("restores the persisted ledger and frontier after a crash, without re-summarizing", async () => {
    const memory = createMemoryCheckpointStore();
    const { store: checkpoints, gate } = crashableCheckpoints(memory);
    const requests: ProviderRequest[] = [];
    const { agent } = foldingAgent({ requests, gate, durable: true });
    const session = agent.createSession({ id: "durable-fold-session" });

    const crashed = await runCapturingId(session, "investigate", { checkpoints, definitionRevision: "1" });
    // The crash closes the store, so the rejected post-crash write can be the run error; either
    // way no write landed after the fold checkpoint.
    assert.match(String((crashed.error as Error).message), /simulated worker crash|checkpoint store unavailable/);
    const liveStub = toolResultText(requests[1]?.messages ?? [], "call-1");
    assert.ok(/omitted \d+ bytes \(sha256 [0-9a-f]{32}\)/.test(String(liveStub)), `the live run stubbed the row: ${String(liveStub)}`);

    // The fold-boundary checkpoint is on disk; no session-state opt-in was needed for it.
    const before = await loadAgentRunState(checkpoints, { runId: crashed.runId, sessionId: session.id });
    assert.equal(before.state.status, "running");
    assert.equal(before.state.sessionState?.loadedSkillNames, undefined, "durable folding does not switch on the session-state bag");
    const persisted = before.state.sessionState?.attentionFold;
    assert.ok(persisted, "the ledger is checkpointed at the fold boundary");
    assert.equal(persisted.bodies.length, 1);
    assert.equal(persisted.bodies[0]?.id, "call-1");
    assert.match(String(persisted.bodies[0]?.body), /^omitted \d+ bytes \(sha256 [0-9a-f]{32}\)$/, "the persisted body is the stub body");
    assert.ok(before.state.sessionState?.attentionSticky, "the frontier rides the same checkpoint");

    gate.open = true;
    const resumed = await resumeAgentRun(
      agent,
      { runId: crashed.runId, sessionId: session.id },
      { decision: "continue", expectedVersion: before.record.version },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "succeeded");
    const resumedRequest = requests.at(-1);
    assert.ok(resumedRequest, "resumed provider request captured");
    assert.equal(
      toolResultText(resumedRequest.messages, "call-1"),
      liveStub,
      "the resumed request carries the same stub bytes the live run sent",
    );
    assert.ok(!JSON.stringify(resumedRequest.messages).includes(PAYLOAD), "the raw payload is not replayed");
  });

  it("writes no checkpoint at all when durable is off (the default)", async () => {
    const memory = createMemoryCheckpointStore();
    let writes = 0;
    const counting: CheckpointStore = {
      ...memory,
      async saveCheckpoint(input) {
        writes += 1;
        return memory.saveCheckpoint(input);
      },
    };
    const requests: ProviderRequest[] = [];
    const { agent } = foldingAgent({ requests, gate: { open: false }, durable: false });
    const session = agent.createSession({ id: "ephemeral-fold-session" });
    const result = await session.run("investigate", { runState: { checkpoints: counting, definitionRevision: "1" } });

    assert.equal(result.status, "succeeded");
    assert.ok(
      /omitted \d+ bytes \(sha256 [0-9a-f]{32}\)/.test(String(toolResultText(requests[1]?.messages ?? [], "call-1"))),
      "the fold still happened in memory",
    );
    assert.equal(writes, 0, "folding without `durable` writes nothing to the checkpoint store");
  });

  it("refuses durable folding without a durable run, before any provider turn", async () => {
    const requests: ProviderRequest[] = [];
    const { agent } = foldingAgent({ requests, gate: { open: false }, durable: true });
    await assert.rejects(
      () => agent.createSession({ id: "no-store-session" }).run("investigate"),
      (error: unknown) =>
        (error instanceof AgentRunStateError && /requires a durable run/.test(error.message)) ||
        (error instanceof Error && /requires a durable run/.test(String((error as { cause?: unknown }).cause ?? ""))),
    );
    assert.equal(requests.length, 0, "the run fails at start, not on the turn that folds");
  });
});
