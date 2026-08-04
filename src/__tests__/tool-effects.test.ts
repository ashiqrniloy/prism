import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity, ToolCallContent, ToolDefinition, ToolEffectKey, ToolEffectStore } from "../index.js";
import {
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMemoryToolEffectStore,
  createSecretRedactor,
  createToolRegistry,
  dispatchToolCall,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "../index.js";
import { assertToolEffectStoreConforms } from "../testing/tool-effect-store-conformance.js";
import { deriveToolEffectKey, toolEffectArgumentsHash } from "../tool-effects.js";

const identity: AgentIdentity = {
  tenantId: "tenant",
  accountId: "account",
  userId: "user",
  principal: { kind: "service", id: "principal" },
  scopes: ["tools:execute"],
  issuedAt: "2026-01-01T00:00:00.000Z",
  verified: true,
};
const ownership = { tenantId: "tenant", accountId: "account", userId: "user" };
const context = { sessionId: "session", runId: "run", toolCallId: "call", identity };
const call = (argumentsValue = { value: "ok" }): ToolCallContent => ({
  type: "tool_call",
  id: "call",
  name: "mutate",
  arguments: argumentsValue,
});

function effectKey(key?: string, toolCallId = "call"): ToolEffectKey {
  const base = {
    identity,
    ownership,
    sessionId: "session",
    runId: "run",
    toolCallId,
    toolName: "mutate",
    argumentsHash: toolEffectArgumentsHash({ value: "ok" }),
  };
  return { ...base, key: key ?? deriveToolEffectKey(base) };
}

function mutation(execute: ToolDefinition["execute"]): ToolDefinition {
  return { name: "mutate", effect: { kind: "external_mutation", idempotency: "required" }, execute };
}

function invoke(
  store: ToolEffectStore | undefined,
  tool: ToolDefinition,
  input = call(),
  extra: Partial<Parameters<typeof dispatchToolCall>[0]> = {},
) {
  return dispatchToolCall({
    call: input,
    registry: createToolRegistry([tool]),
    context,
    identity,
    ownership,
    effectStore: store,
    ...extra,
  });
}

describe("ToolEffectStore", () => {
  it("conforms against the dependency-free memory store", async () => {
    await assertToolEffectStoreConforms(() => createMemoryToolEffectStore());
  });

  it("expires pending safely, dispatched as unknown, and never cleans unknown", async () => {
    let now = Date.parse("2026-08-04T00:00:00.000Z");
    const store = createMemoryToolEffectStore({ now: () => now });
    const pendingKey = effectKey("prism:tool-effect:v1:pending");
    const pending = await store.begin({ ...pendingKey, claimTtlMs: 1 });
    now += 2;
    assert.equal((await store.get(pendingKey))?.status, "failed_retryable");
    assert.equal((await store.begin(pendingKey)).outcome, "acquired");

    const dispatchedKey = effectKey("prism:tool-effect:v1:dispatched", "call-dispatched");
    const begun = await store.begin({ ...dispatchedKey, claimTtlMs: 1 });
    const dispatched = await store.markDispatched({
      ...dispatchedKey,
      claimToken: begun.record.claimToken!,
      expectedVersion: begun.record.version,
    });
    now += 2;
    assert.equal((await store.get(dispatchedKey))?.status, "unknown");
    const cleanup = await store.cleanup({ ownership, before: new Date(now + 1).toISOString(), limit: 100 });
    assert.equal(cleanup.deleted, 0);
    await assert.rejects(
      () => store.markUnknown({ ...dispatchedKey, claimToken: dispatched.claimToken!, expectedVersion: dispatched.version }),
      /conflict/,
    );
  });

  it("allows only one concurrent claim and resolver CAS", async () => {
    const store = createMemoryToolEffectStore();
    const key = effectKey("prism:tool-effect:v1:concurrent");
    const claims = await Promise.all([store.begin(key), store.begin(key)]);
    assert.equal(claims.filter((claim) => claim.outcome === "acquired").length, 1);
    const acquired = claims.find((claim) => claim.outcome === "acquired")!;
    const dispatched = await store.markDispatched({
      ...key,
      claimToken: acquired.record.claimToken!,
      expectedVersion: acquired.record.version,
    });
    const unknown = await store.markUnknown({ ...key, claimToken: dispatched.claimToken!, expectedVersion: dispatched.version });
    const resolutions = await Promise.allSettled([
      store.resolveUnknown({ ...key, expectedVersion: unknown.version, status: "failed_terminal", failure: { code: "operator" } }),
      store.resolveUnknown({ ...key, expectedVersion: unknown.version, status: "failed_terminal", failure: { code: "operator" } }),
    ]);
    assert.equal(resolutions.filter((result) => result.status === "fulfilled").length, 1);
  });

  it("enforces exact claim/version/key state and bounded completed values", async () => {
    const store = createMemoryToolEffectStore();
    const key = effectKey();
    const begun = await store.begin(key);
    await assert.rejects(
      () =>
        store.markDispatched({
          ...key,
          argumentsHash: "b".repeat(64),
          claimToken: begun.record.claimToken!,
          expectedVersion: begun.record.version,
        }),
      /conflict/,
    );
    const dispatched = await store.markDispatched({ ...key, claimToken: begun.record.claimToken!, expectedVersion: begun.record.version });
    await assert.rejects(
      () =>
        store.complete({
          ...key,
          claimToken: dispatched.claimToken!,
          expectedVersion: dispatched.version,
          result: { toolCallId: "wrong", name: "mutate" },
        }),
      /conflict/,
    );
    await assert.rejects(
      () =>
        store.complete({
          ...key,
          claimToken: dispatched.claimToken!,
          expectedVersion: dispatched.version,
          result: { toolCallId: "call", name: "mutate", value: "x".repeat(70 * 1024) },
        }),
      /exceeds limits/,
    );
  });
});

describe("tool effect dispatch", () => {
  it("blocks a required effect before execute without a store", async () => {
    let calls = 0;
    const result = await invoke(
      undefined,
      mutation(() => ({ toolCallId: "call", name: "mutate", value: ++calls })),
    );
    assert.equal(result.error?.code, "ERR_PRISM_TOOL_EFFECT_REQUIRED");
    assert.equal(calls, 0);
  });

  it("derives one stable key, redacts completed replay, and ignores caller keys", async () => {
    const store = createMemoryToolEffectStore();
    let calls = 0;
    let seenKey: string | undefined;
    const tool = mutation((_args, execution) => {
      calls += 1;
      seenKey = execution.idempotencyKey;
      return { toolCallId: "call", name: "mutate", value: { secret: "token-123", calls } };
    });
    const first = await invoke(store, tool, call(), {
      redactor: createSecretRedactor(["token-123"]),
      context: { ...context, idempotencyKey: "host-or-model-key" },
    });
    const replay = await invoke(store, tool, call(), { redactor: createSecretRedactor(["token-123"]) });

    assert.match(seenKey ?? "", /^prism:tool-effect:v1:[a-f0-9]{64}$/);
    assert.equal(calls, 1);
    assert.deepEqual(first.value, { secret: "[REDACTED]", calls: 1 });
    assert.deepEqual(replay, first);
    assert.equal(JSON.stringify(replay).includes("token-123"), false);
    await invoke(store, tool, call({ value: "changed" }));
    assert.equal(calls, 2);
  });

  it("never reruns pending, dispatched, unknown, or completed-without-result calls", async () => {
    const store = createMemoryToolEffectStore();
    let calls = 0;
    const tool = mutation(() => ({ toolCallId: "call", name: "mutate", value: ++calls }));
    const first = await store.begin(effectKey());
    const pending = await invoke(store, tool);
    assert.equal(pending.error?.code, "ERR_PRISM_TOOL_EFFECT_CONFLICT");
    const dispatched = await store.markDispatched({
      ...effectKey(),
      claimToken: first.record.claimToken!,
      expectedVersion: first.record.version,
    });
    const unknown = await invoke(store, tool);
    assert.equal(unknown.error?.code, "ERR_PRISM_TOOL_EFFECT_UNKNOWN");
    await store.markUnknown({ ...effectKey(), claimToken: dispatched.claimToken!, expectedVersion: dispatched.version });
    const unresolved = await invoke(store, tool);
    assert.equal(unresolved.error?.code, "ERR_PRISM_TOOL_EFFECT_UNKNOWN");
    assert.equal(calls, 0);

    const completedKey = effectKey(undefined, "call-completed");
    const begun = await store.begin(completedKey);
    const marked = await store.markDispatched({
      ...completedKey,
      claimToken: begun.record.claimToken!,
      expectedVersion: begun.record.version,
    });
    await store.complete({ ...completedKey, claimToken: marked.claimToken!, expectedVersion: marked.version });
    const completed = await invoke(
      store,
      { ...tool, execute: () => ({ toolCallId: "call-completed", name: "mutate" }) },
      { ...call(), id: "call-completed" },
    );
    assert.equal(completed.error?.code, "ERR_PRISM_TOOL_EFFECT_COMPLETED");
    assert.equal(calls, 0);
  });

  it("turns post-dispatch throws and result overflow into unknown without replay", async () => {
    for (const tool of [
      mutation(() => {
        throw new Error("remote commit may have succeeded");
      }),
      mutation(() => ({ toolCallId: "call", name: "mutate", error: { message: "remote outcome failed" } })),
      mutation(() => ({ toolCallId: "call", name: "mutate", value: "x".repeat(70 * 1024) })),
    ]) {
      const store = createMemoryToolEffectStore();
      const first = await invoke(store, tool);
      const duplicate = await invoke(store, tool);
      assert.equal(first.error?.code, "ERR_PRISM_TOOL_EFFECT_UNKNOWN");
      assert.equal(duplicate.error?.code, "ERR_PRISM_TOOL_EFFECT_UNKNOWN");
    }
  });

  it("treats an uncertain dispatched transition as unknown", async () => {
    const base = createMemoryToolEffectStore();
    const store: ToolEffectStore = {
      ...base,
      markDispatched: async (input) => {
        await base.markDispatched(input);
        throw new Error("connection dropped");
      },
    };
    let calls = 0;
    const tool = mutation(() => ({ toolCallId: "call", name: "mutate", value: ++calls }));
    const first = await invoke(store, tool);
    const duplicate = await invoke(store, tool);
    assert.equal(first.error?.code, "ERR_PRISM_TOOL_EFFECT_UNKNOWN");
    assert.equal(duplicate.error?.code, "ERR_PRISM_TOOL_EFFECT_UNKNOWN");
    assert.equal(calls, 0);
  });

  it("releases a pre-execute durable suspension as retryable before resumption", async () => {
    const store = createMemoryToolEffectStore();
    let calls = 0;
    const tool = mutation(() => ({ toolCallId: "call", name: "mutate", value: ++calls }));
    await assert.rejects(
      () =>
        invoke(store, tool, call(), {
          beforeExecute: () => {
            throw Object.assign(new Error("pause"), { code: "ERR_PRISM_AGENT_RUN_SUSPENDED" });
          },
        }),
      /pause/,
    );
    const resumed = await invoke(store, tool);
    assert.equal(resumed.error, undefined);
    assert.equal(calls, 1);
  });

  it("keeps optional effects unmanaged without a store and observations keyless", async () => {
    let optionalCalls = 0;
    let optionalKey: string | undefined;
    const optional: ToolDefinition = {
      name: "mutate",
      effect: { kind: "local_mutation", idempotency: "optional" },
      execute: (_args, execution) => {
        optionalCalls += 1;
        optionalKey = execution.idempotencyKey;
        return { toolCallId: "call", name: "mutate" };
      },
    };
    await invoke(undefined, optional);
    await invoke(undefined, optional);
    assert.equal(optionalCalls, 2);
    assert.match(optionalKey ?? "", /^prism:tool-effect:v1:/);

    let observationKey: string | undefined = "not-cleared";
    const observation: ToolDefinition = {
      name: "mutate",
      effect: { kind: "none", idempotency: "none" },
      execute: (_args, execution) => {
        observationKey = execution.idempotencyKey;
        return { toolCallId: "call", name: "mutate" };
      },
    };
    await invoke(undefined, observation);
    assert.equal(observationKey, undefined);
  });

  it("keeps no-effect and tool-managed tools on their legacy/specialized paths", async () => {
    let legacyCalls = 0;
    const legacy: ToolDefinition = {
      name: "mutate",
      execute: () => {
        legacyCalls += 1;
        throw new Error("legacy failure");
      },
    };
    const legacyResult = await invoke(undefined, legacy);
    assert.equal(legacyResult.error?.message, "legacy failure");
    assert.equal(legacyCalls, 1);

    let managedKey: string | undefined;
    const managed: ToolDefinition = {
      name: "mutate",
      effect: { kind: "external_mutation", idempotency: "tool_managed" },
      execute: (_args, execution) => {
        managedKey = execution.idempotencyKey;
        return { toolCallId: "call", name: "mutate" };
      },
    };
    const managedResult = await invoke(undefined, managed);
    assert.equal(managedResult.error, undefined);
    assert.match(managedKey ?? "", /^prism:tool-effect:v1:/);
  });

  it("keeps explicit unsupported effects executable without durable identity", async () => {
    let calls = 0;
    const unsupported: ToolDefinition = {
      name: "mutate",
      effect: { kind: "external_mutation", idempotency: "unsupported" },
      execute: (_args, execution) => {
        calls += 1;
        assert.equal(execution.idempotencyKey, undefined);
        return { toolCallId: execution.toolCallId, name: "mutate" };
      },
    };
    const result = await dispatchToolCall({
      call: call(),
      registry: createToolRegistry([unsupported]),
      context: { sessionId: "session", runId: "run", toolCallId: "call" },
    });
    assert.equal(result.error, undefined);
    assert.equal(calls, 1);
  });

  it("uses an agent-configured store after durable approval without opening a safe replay window", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemoryToolEffectStore();
    let calls = 0;
    let turns = 0;
    const agent = createAgent({
      id: "effect-durable",
      model: { provider: "mock", model: "test" },
      ownership,
      identity,
      store: createMemorySessionStore(),
      effectStore: store,
      provider: {
        id: "mock",
        async *generate() {
          turns += 1;
          if (turns === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call", "mutate", { value: "ok" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
      tools: [mutation(() => ({ toolCallId: "call", name: "mutate", value: ++calls }))],
    });
    const suspended = await agent.createSession({ id: "effect-durable-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    assert.equal(suspended.status, "suspended");
    assert.equal(calls, 0);
    const resumed = await resumeAgentRun(
      agent,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decision: "approve", expectedVersion: suspended.runState!.version! },
      { checkpoints, definitionRevision: "1", ownership },
    );
    assert.equal(resumed.status, "succeeded");
    assert.equal(calls, 1);
  });

  it("runs dynamic classifiers only after normal validation", async () => {
    let classified = 0;
    let executed = 0;
    const tool: ToolDefinition = {
      name: "mutate",
      effect: (_args, effectContext) => {
        classified += 1;
        assert.equal(effectContext.identity, undefined);
        assert.equal(effectContext.idempotencyKey, undefined);
        return { kind: "none", idempotency: "none" };
      },
      execute: () => ({ toolCallId: "call", name: "mutate", value: ++executed }),
    };
    const invalid = await invoke(undefined, tool, call(), { validate: () => "invalid" });
    assert.equal(invalid.error?.message, "invalid");
    assert.equal(classified, 0);
    assert.equal(executed, 0);
  });
});
