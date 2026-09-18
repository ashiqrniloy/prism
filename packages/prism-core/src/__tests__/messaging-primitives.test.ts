// Plan 079 Task 1: executable primitive/compatibility evidence for the messaging-channel
// review (docs/history/079-messaging-primitive-review.md). Proves the execution seams the
// channel runtime depends on. Keep this file export-free: it is evidence, not a public surface.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type Agent,
  AgentRunError,
  AgentRunStateError,
  type AIProvider,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createSecretRedactor,
  createSecureAgent,
  createStaticPermissionPolicy,
  createStaticTrustPolicy,
  type OwnershipScope,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { createConversationService } from "../runtime/server/conversations.js";
import { createSqlitePersistence } from "../sessions/sqlite/index.js";

const ownership: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const otherOwnership: OwnershipScope = { tenantId: "tenant-1", userId: "user-2" };
const tempDirs: string[] = [];

after(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDb(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "prism-079-"));
  tempDirs.push(dir);
  return join(dir, `${name}.db`);
}

function textProvider(calls: { count: number }, text: (count: number) => string): AIProvider {
  return {
    id: "mock",
    async *generate() {
      calls.count += 1;
      yield providerTextDelta(text(calls.count));
      yield providerDone();
    },
  };
}

/** The plan's proposed `runBoundTurn` seam, compiled and executed. */
async function runBoundTurn(agent: Agent, binding: { sessionId: string; leafId?: string }, text: string, operationId: string) {
  const session = agent.createSession({ id: binding.sessionId, ...(binding.leafId === undefined ? {} : { leafId: binding.leafId }) });
  return session.run(text, { idempotencyKey: operationId });
}

describe("plan 079 primitive review", () => {
  it("continues an owned session across a persistence reopen through runBoundTurn", async () => {
    const filename = tempDb("reopen");
    const calls = { count: 0 };
    const provider = textProvider(calls, (count) => `answer ${count}`);
    const store = { file: filename };
    let persistence = createSqlitePersistence({ filename: store.file });
    const agent = createAgent({ id: "review-reopen", model: { provider: "mock", model: "demo" }, provider, store: persistence });
    const first = await runBoundTurn(agent, { sessionId: "bound-session" }, "turn one", "op-1");
    assert.equal(first.status, "succeeded");
    assert.equal(first.text, "answer 1");
    persistence.close();

    persistence = createSqlitePersistence({ filename: store.file });
    const reopened = createAgent({ id: "review-reopen", model: { provider: "mock", model: "demo" }, provider, store: persistence });
    const second = await runBoundTurn(reopened, { sessionId: "bound-session", leafId: first.leafId }, "turn two", "op-2");
    assert.equal(second.status, "succeeded");
    assert.equal(second.text, "answer 2");
    assert.equal((await persistence.list("bound-session")).length, 4);
    persistence.close();
  });

  it("does not serialize two runtime objects that share one logical session id", async () => {
    const store = createMemorySessionStore();
    const calls = { count: 0 };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const agent = createAgent({
      id: "review-two-objects",
      model: { provider: "mock", model: "demo" },
      store,
      provider: {
        id: "mock",
        async *generate() {
          calls.count += 1;
          await gate;
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
    });
    const first = agent.createSession({ id: "shared-id" }).run("from a");
    const second = agent.createSession({ id: "shared-id" }).run("from b");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls.count, 2, "each runtime object admits its own provider turn");
    release?.();
    const results = await Promise.all([first, second]);
    assert.equal(
      results.every((result) => result.status === "succeeded"),
      true,
    );
  });

  it("rejects per-run ownership and redactor overrides for a secure agent, including through the conversation service", async () => {
    const persistence = createSqlitePersistence({ filename: tempDb("secure") });
    const calls = { count: 0 };
    const secure = createSecureAgent({
      id: "review-secure",
      model: { provider: "mock", model: "demo" },
      provider: textProvider(calls, () => "secure answer"),
      store: persistence,
      tools: [],
      toolArgumentValidator: { validate: () => ({ ok: true }) },
      redactor: createSecretRedactor(["secret"]),
      permission: createStaticPermissionPolicy({ allow: [] }),
      trust: createStaticTrustPolicy(true),
      ownership,
      limits: { maxTurns: 2 },
      definitionRevision: "1",
      runState: { checkpoints: createMemoryCheckpointStore() },
    });
    await assert.rejects(() => secure.createSession({ id: "override" }).run("go", { ownership }), AgentRunStateError);
    assert.equal(calls.count, 0, "a rejected override never reaches the provider");

    const direct = await secure.createSession({ id: "direct" }).run("go");
    assert.equal(direct.status, "succeeded");
    assert.equal(calls.count, 1);

    const service = createConversationService(persistence, {
      redactor: createSecretRedactor(["secret"]),
      sessionFactory: ({ thread }) => secure.createSession({ id: thread.id }),
    });
    const thread = await service.create({ ownership });
    await assert.rejects(
      () => service.continue({ ownership, threadId: thread.id, message: "go" }),
      /Secure agent defaults cannot be replaced per run/,
    );
    assert.equal(calls.count, 1, "conversation continue cannot compose with a secure agent");
    persistence.close();
  });

  it("re-resolves ownership and the current agent definition on durable resume, refusing drift", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    const toolCalls = { count: 0 };
    const provider: AIProvider = (() => {
      let turn = 0;
      return {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("resumed answer");
          yield providerDone();
        },
      };
    })();
    const tools = [
      { name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "call-1", name: "write", value: ++toolCalls.count }) },
    ];
    const agent = createAgent({ id: "review-resume", model: { provider: "mock", model: "demo" }, provider, store, tools });
    const suspended = await agent.createSession({ id: "resume-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      ownership,
    });
    assert.equal(suspended.status, "suspended");
    const ref = { runId: suspended.runId, sessionId: suspended.sessionId };
    const version = suspended.runState?.version;
    assert.ok(version !== undefined);
    const resolvedOwnership: (OwnershipScope | undefined)[] = [];
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: ({ agentId, ownership: requested }) => {
        assert.equal(agentId, "review-resume");
        resolvedOwnership.push(requested);
        return { agent, definitionRevision: "1" };
      },
    });

    await assert.rejects(
      () =>
        lifecycle.resume(ref, { decision: "approve", expectedVersion: version }, { agentId: "review-resume", ownership: otherOwnership }),
      /ownership mismatch|No durable agent run/,
    );
    await assert.rejects(
      () => lifecycle.resume(ref, { decision: "approve", expectedVersion: version + 1 }, { agentId: "review-resume", ownership }),
      AgentRunStateError,
    );
    await assert.rejects(
      () => lifecycle.resume(ref, { decision: "approve", expectedVersion: version }, { agentId: "other-agent", ownership }),
      /capability mismatch/,
    );

    // Same revision, widened tool registry: the fingerprint recheck refuses before any side effect.
    const widened = createAgent({
      id: "review-resume",
      model: { provider: "mock", model: "demo" },
      provider,
      store,
      tools: [
        ...tools,
        { name: "read", parameters: { type: "object" }, execute: () => ({ toolCallId: "call-2", name: "read", value: "ok" }) },
      ],
    });
    const drifted = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent: widened, definitionRevision: "1" }) });
    await assert.rejects(
      () => drifted.resume(ref, { decision: "approve", expectedVersion: version }, { agentId: "review-resume", ownership }),
      /fingerprint mismatch/,
    );

    const resumed = await lifecycle.resume(ref, { decision: "approve", expectedVersion: version }, { agentId: "review-resume", ownership });
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.text, "resumed answer");
    assert.equal(toolCalls.count, 1);
    assert.deepEqual(resolvedOwnership, [ownership, ownership]);
  });

  it("cancels resumed work through the resume stream and the non-stream resume signal", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    const toolCalls = { count: 0 };
    const resumedAbort = { seen: false };
    let requestCancel: (() => void) | undefined;
    const makeAgent = () =>
      createAgent({
        id: "review-cancel",
        model: { provider: "mock", model: "demo" },
        store,
        tools: [
          {
            name: "write",
            parameters: { type: "object" },
            execute: () => ({ toolCallId: "call-cancel", name: "write", value: ++toolCalls.count }),
          },
        ],
        provider: (() => {
          let turn = 0;
          return {
            id: "mock",
            async *generate(request) {
              turn += 1;
              if (turn === 1) {
                yield { type: "tool_call" as const, call: toolCallContent("call-cancel", "write", {}) };
                yield providerDone();
                return;
              }
              yield providerTextDelta("partial");
              requestCancel?.();
              await new Promise<void>((resolve) => {
                if (request.signal?.aborted) {
                  resumedAbort.seen = true;
                  resolve();
                } else {
                  request.signal?.addEventListener(
                    "abort",
                    () => {
                      resumedAbort.seen = true;
                      resolve();
                    },
                    { once: true },
                  );
                }
              });
              throw request.signal?.reason instanceof Error ? request.signal.reason : new Error("aborted");
            },
          };
        })(),
      });
    const suspend = (agent: Agent) =>
      agent.createSession({ id: "cancel-session" }).run("go", {
        runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
        ownership,
      });

    const preAbortedAgent = makeAgent();
    const preAborted = await suspend(preAbortedAgent);
    const preAbortedRef = { runId: preAborted.runId, sessionId: preAborted.sessionId };
    const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent: preAbortedAgent, definitionRevision: "1" }) });
    const preAbortedVersion = preAborted.runState?.version;
    assert.ok(preAbortedVersion !== undefined);
    const controller = new AbortController();
    controller.abort(new Error("host cancel"));
    await assert.rejects(
      () =>
        lifecycle.resume(
          preAbortedRef,
          { decision: "approve", expectedVersion: preAbortedVersion },
          { agentId: "review-cancel", ownership, signal: controller.signal },
        ),
      /host cancel/,
    );
    assert.equal(toolCalls.count, 0);
    assert.equal((await lifecycle.status(preAbortedRef, { agentId: "review-cancel", ownership })).state.status, "suspended");

    const liveAgent = makeAgent();
    const live = await suspend(liveAgent);
    const liveRef = { runId: live.runId, sessionId: live.sessionId };
    const liveVersion = live.runState?.version;
    assert.ok(liveVersion !== undefined);
    const liveLifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent: liveAgent, definitionRevision: "1" }) });
    const liveController = new AbortController();
    requestCancel = () => liveController.abort(new Error("cancel request"));
    const liveEvents: string[] = [];
    const observed = await (async () => {
      try {
        for await (const event of liveLifecycle.resumeStream(
          liveRef,
          { decision: "approve", expectedVersion: liveVersion },
          { agentId: "review-cancel", ownership, signal: liveController.signal, maxQueuedEvents: 16, overflow: "close" },
        )) {
          liveEvents.push(event.type);
        }
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    assert.ok(observed instanceof AgentRunError, `expected AgentRunError, got ${String(observed)}`);
    assert.equal(observed.result.status, "aborted");
    assert.equal(liveEvents.includes("agent_resumed"), true);
    assert.equal(resumedAbort.seen, true, "the abort reached the in-flight provider turn");
    assert.equal(observed.result.text, "", "partial deltas are not promoted to final text when the run aborts");
    assert.equal(toolCalls.count, 1, "cancellation is a request: the already-approved dispatch is not rolled back");
    assert.equal((await liveLifecycle.status(liveRef, { agentId: "review-cancel", ownership })).state.status, "aborted");

    // Plan 080 Task 3: the non-stream resume threads the same signal, so a mid-turn
    // abort reaches the provider and persists an aborted run instead of running on.
    const directAgent = makeAgent();
    const direct = await suspend(directAgent);
    const directRef = { runId: direct.runId, sessionId: direct.sessionId };
    const directVersion = direct.runState?.version;
    assert.ok(directVersion !== undefined);
    const directLifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent: directAgent, definitionRevision: "1" }) });
    const directController = new AbortController();
    requestCancel = () => directController.abort(new Error("non-stream cancel"));
    const directOutcome = await directLifecycle
      .resume(
        directRef,
        { decision: "approve", expectedVersion: directVersion },
        { agentId: "review-cancel", ownership, signal: directController.signal },
      )
      .catch((error: unknown) => error);
    assert.ok(directOutcome instanceof AgentRunError, `expected AgentRunError, got ${String(directOutcome)}`);
    assert.equal(directOutcome.result.status, "aborted");
    assert.equal(directOutcome.result.text, "", "partial deltas are not promoted to final text when the run aborts");
    assert.equal(resumedAbort.seen, true, "the abort reached the in-flight provider turn of the non-stream resume");
    assert.equal(toolCalls.count, 2, "the approved dispatch still stands: abort never rolls back dispatched work");
    assert.equal((await directLifecycle.status(directRef, { agentId: "review-cancel", ownership })).state.status, "aborted");
  });

  it("does not treat idempotencyKey as execution deduplication at a new branch tip", async () => {
    const store = createMemorySessionStore();
    const calls = { count: 0 };
    const agent = createAgent({
      id: "review-idempotency",
      model: { provider: "mock", model: "demo" },
      store,
      provider: textProvider(calls, () => "ok"),
    });
    const first = await agent.createSession({ id: "idem" }).run("one", { idempotencyKey: "op-1" });
    assert.equal(calls.count, 1);

    // Exact retry at the same parent: the append deduplicates before the provider turn.
    await assert.rejects(
      () => agent.createSession({ id: "idem" }).run("one", { idempotencyKey: "op-1" }),
      (error: unknown) => {
        assert.ok(error instanceof AgentRunError);
        assert.equal(error.result.error?.code, "session_append_conflict");
        return true;
      },
    );
    assert.equal(calls.count, 1, "duplicate append retry never reaches the provider");

    // Same key at the advanced tip: append dedup no longer applies and the run executes again.
    const retry = await agent.createSession({ id: "idem", leafId: first.leafId }).run("one", { idempotencyKey: "op-1" });
    assert.equal(retry.status, "succeeded");
    assert.equal(calls.count, 2);
    assert.notEqual(retry.runId, first.runId, "run ids are generated per call, not per operation");
  });

  it("can expose stale or empty result text on failed and suspended runs (no current-run projection)", async () => {
    const store = createMemorySessionStore();
    const checkpoints = createMemoryCheckpointStore();
    let turn = 0;
    const agent = createAgent({
      id: "review-provenance",
      model: { provider: "mock", model: "demo" },
      store,
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 2) throw new Error("provider exploded");
          if (turn === 3) {
            yield { type: "tool_call" as const, call: toolCallContent("call-approval", "write", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta(`answer ${turn}`);
          yield providerDone();
        },
      },
      tools: [
        { name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "call-approval", name: "write", value: "effect" }) },
      ],
    });
    const first = await agent.createSession({ id: "provenance" }).run("one");
    assert.equal(first.text, "answer 1");

    const failed = await agent
      .createSession({ id: "provenance", leafId: first.leafId })
      .run("two")
      .catch((error: unknown) => error);
    assert.ok(failed instanceof AgentRunError);
    assert.equal(failed.result.status, "failed");
    assert.equal(failed.result.text, "answer 1", "failed result text is the previous turn's answer");

    const suspended = await agent.createSession({ id: "provenance", leafId: first.leafId }).run("three", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    assert.equal(suspended.status, "suspended");
    assert.equal(
      suspended.text,
      "",
      "the tool-call assistant message has no text blocks, so a suspended result exposes no sendable output",
    );
  });

  it("lands a foreign-owned checkpoint as a miss and a foreign save as a generic conflict (080 Task 3)", async () => {
    const key = { namespace: "prism.080.probe", key: "foreign-scope" };
    const memory = createMemoryCheckpointStore();
    await memory.saveCheckpoint({ ...key, ...ownership, version: 1, expectedVersion: 0, value: { ok: true } });
    assert.equal((await memory.loadCheckpoint({ ...key, ...ownership }))?.version, 1);
    assert.equal(await memory.loadCheckpoint({ ...key, ...otherOwnership }), null, "a foreign scope is a miss, not an existence oracle");
    await assert.rejects(
      () => memory.saveCheckpoint({ ...key, ...otherOwnership, version: 2, value: { ok: false } }),
      /compare-and-swap failed/,
      "a foreign save fails closed with the generic CAS conflict",
    );
    assert.equal((await memory.loadCheckpoint({ ...key, ...ownership }))?.version, 1, "a foreign writer never disturbs the owner");

    const filename = tempDb("foreign-load");
    const sqlite = createSqlitePersistence({ filename });
    await sqlite.checkpoints.saveCheckpoint({
      ...key,
      ...ownership,
      version: 1,
      expectedVersion: 0,
      value: { ok: true },
    });
    assert.equal(await sqlite.checkpoints.loadCheckpoint({ ...key, ...otherOwnership }), null);
    await assert.rejects(
      () => sqlite.checkpoints.saveCheckpoint({ ...key, ...otherOwnership, version: 2, value: { ok: false } }),
      /compare-and-swap failed/,
    );
    assert.equal(await sqlite.checkpoints.deleteCheckpoint({ ...key, ...otherOwnership }), false);
    assert.equal((await sqlite.checkpoints.loadCheckpoint({ ...key, ...ownership }))?.version, 1);
    sqlite.close();
  });
});
