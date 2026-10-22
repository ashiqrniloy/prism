import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "bun:test";
import type { AgentEventRecord, RunRecord, SessionEntry, SessionStore, ToolCallRecord, ToolDefinition, UsageRecord } from "../index.js";
import {
  createDefaultCompactor,
  createMemorySessionStore,
  createMemoryToolEffectStore,
  createToolRegistry,
  SESSION_APPEND_CONFLICT_CODE,
  SessionAppendConflictError,
} from "../index.js";
import { assertCompactorConforms } from "../testing/compaction-conformance.js";
import { assertRunLedgerConforms, runRunLedgerConformance } from "../testing/run-ledger-conformance.js";
import { storeConformance } from "../testing/store-conformance.js";
import { assertToolBlocked, assertToolDispatchConforms } from "../testing/tool-conformance.js";
import { assertToolEffectStoreConforms } from "../testing/tool-effect-store-conformance.js";

void describe("store conformance helper", () => {
  it("memory_store_passes_store_conformance", async () => {
    await storeConformance(createMemorySessionStore);
  });

  it("conforms against a custom store that implements readBranchPath", async () => {
    await storeConformance(customStore);
  });

  it("rejects a store that silently accepts duplicate entry ids", async () => {
    await assert.rejects(() => storeConformance(lenientStore), /\[append-and-read\].*store must reject a duplicate entry id/);
  });

  it("rejects a store that ignores a missing expectedParentId", async () => {
    await assert.rejects(
      () => storeConformance(noConflictStore),
      /\[append-and-read\].*store must throw SessionAppendConflictError when expectedParentId does not exist/,
    );
  });

  it("store_conformance_fails_a_store_that_leaks_a_foreign_session", async () => {
    await assert.rejects(() => storeConformance(leakingStore), /\[list-and-delete\].*outside the scope/);
  });

  it("store_conformance_fails_a_store_that_drops_package_state_on_reopen", async () => {
    await assert.rejects(
      () => storeConformance(createMemorySessionStore, { reopen: createMemorySessionStore }),
      /\[restart\].*did not survive reopen/,
    );
  });

  it("store_conformance_fails_a_store_that_drops_appended_records", async () => {
    await assert.rejects(() => storeConformance(dropsLogStore), /\[package-state-log\]/);
  });

  it("missing_capability_leg_expects_unsupported_error", async () => {
    // A store without the optional methods passes: each missing-capability leg asserts the error.
    await storeConformance(customStore);
    // A store that implements a capability it does not claim fails the leg instead of skipping it.
    await assert.rejects(() => storeConformance(createMemorySessionStore, { capabilities: [] }), /\[search\]/);
  });

  it("the testing root exports storeConformance and the old subpath is gone", async () => {
    const testing = await import("../testing/index.js");
    assert.equal(typeof testing.storeConformance, "function");
    assert.ok(testing.STORE_CONFORMANCE_STEPS.includes("restart"));
    assert.ok(testing.STORE_CONFORMANCE_STEPS.includes("package-state-log"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(pkg.exports["./testing/session-store-conformance"], undefined);
  });

  it("supports concurrent parent append when enabled", async () => {
    await storeConformance(createMemorySessionStore, { exerciseConcurrentParentAppend: true });
  });

  it("storeConformance reopens a durable shared backing store", async () => {
    const backing = createMemorySessionStore();
    await storeConformance(() => backing, {
      sessionId: "reopen-shared",
      otherSessionId: "reopen-shared-other",
      reopen: () => backing,
    });
  });
});

void describe("run-ledger conformance helper", () => {
  it("conforms against an in-memory ledger with read callbacks", async () => {
    const state = createMemoryLedger();
    await assertRunLedgerConforms({
      ledger: state.ledger,
      readRuns: () => state.runs,
      readEvents: () => state.events,
      readToolCalls: () => state.toolCalls,
      readUsage: () => state.usage,
    });
  });

  it("runRunLedgerConformance survives factory reopen against shared state", async () => {
    const state = createMemoryLedger();
    await runRunLedgerConformance(
      () => ({
        ledger: state.ledger,
        readRuns: () => state.runs,
        readEvents: () => state.events,
      }),
      { exerciseReopen: true, sessionId: "ledger-reopen" },
    );
  });

  it("testing/run-ledger-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/run-ledger-conformance"]);
  });

  it("testing/persistence-schema subpath is not a kernel export", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(pkg.exports["./testing/persistence-schema"], undefined);
    assert.equal(pkg.exports["./testing/feedback"], undefined);
  });
});

function createMemoryLedger() {
  const runs: RunRecord[] = [];
  const events: AgentEventRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const usage: UsageRecord[] = [];
  return {
    runs,
    events,
    toolCalls,
    usage,
    ledger: {
      appendRun: async (record: RunRecord) => {
        runs.push(record);
      },
      appendEvent: async (record: AgentEventRecord) => {
        events.push(record);
      },
      appendToolCall: async (record: ToolCallRecord) => {
        toolCalls.push(record);
      },
      appendUsage: async (record: UsageRecord) => {
        usage.push(record);
      },
    },
  };
}

void describe("compaction conformance helper", () => {
  it("conforms against the default strategy with secret redaction", async () => {
    const strategy = createDefaultCompactor({ keepRecentEntries: 1, secrets: ["secret-value"] });
    const { summary } = await assertCompactorConforms(strategy, { secrets: ["secret-value"] });
    assert.ok(summary.length > 0);
    assert.equal(summary.includes("secret-value"), false);
  });

  it("rejects a strategy that leaks a secret into the summary", async () => {
    const leaking = {
      name: "leaking",
      compact: () => ({ summary: "leaked secret-value" }),
    };
    await assert.rejects(() => assertCompactorConforms(leaking, { secrets: ["secret-value"] }), /leaked a secret into the summary/);
  });

  it("rejects a strategy that returns an empty summary", async () => {
    const empty = { name: "empty", compact: () => ({ summary: "" }) };
    await assert.rejects(() => assertCompactorConforms(empty), /non-empty string summary/);
  });

  it("testing/compaction-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/compaction-conformance"]);
  });
});

void describe("tool-effect-store conformance helper", () => {
  it("conforms against the core memory store", async () => {
    await assertToolEffectStoreConforms(() => createMemoryToolEffectStore());
  });

  it("testing/tool-effect-store-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/tool-effect-store-conformance"]);
  });
});

void describe("tool conformance helper", () => {
  const echo: ToolDefinition = {
    name: "echo",
    execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }),
  };

  it("conforms against the full blocked-reason matrix and success path", async () => {
    await assertToolDispatchConforms(createToolRegistry(), { tool: echo, validArgs: { msg: "hi" } });
  });

  it("assertToolBlocked rejects when a call is not blocked", async () => {
    await assert.rejects(
      () =>
        assertToolBlocked(
          { call: { type: "tool_call", id: "c", name: "echo", arguments: {} }, registry: createToolRegistry([echo]) },
          "unknown_tool",
        ),
      /none was emitted/,
    );
  });

  it("rejects a tool whose valid call does not execute", async () => {
    // A tool that throws on execute surfaces as tool_execution_error with an error
    // result, so the success-path assertion fails.
    const throwing: ToolDefinition = {
      name: "boom",
      execute: () => {
        throw new Error("boom");
      },
    };
    await assert.rejects(
      () => assertToolDispatchConforms(createToolRegistry(), { tool: throwing, validArgs: {} }),
      /Valid tool call was not executed/,
    );
  });

  it("testing/tool-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/tool-conformance"]);
  });
});

// A minimal custom SessionStore implementing readBranchPath for the branch-read
// conformance probe. Mirrors the external-app reference pattern and satisfies
// the full adapter contract (duplicate-id, expectedParentId, idempotency).
function customStore(): SessionStore {
  const byId = new Map<string, SessionEntry>();
  const bySession = new Map<string, SessionEntry[]>();
  const idempotencySeen = new Set<string>();
  return {
    async append(entry, options) {
      if (byId.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
      if (options?.expectedParentId && !byId.has(options.expectedParentId)) {
        throw new SessionAppendConflictError({ code: SESSION_APPEND_CONFLICT_CODE, expectedParentId: options.expectedParentId });
      }
      if (options?.idempotencyKey) {
        const dedup = `${entry.sessionId}\u0000${options.idempotencyKey}\u0000${options.expectedParentId ?? ""}`;
        if (idempotencySeen.has(dedup))
          throw new SessionAppendConflictError({ code: SESSION_APPEND_CONFLICT_CODE, idempotencyDuplicate: true });
        idempotencySeen.add(dedup);
      }
      byId.set(entry.id, entry);
      (bySession.get(entry.sessionId) ?? bySession.set(entry.sessionId, []).get(entry.sessionId)!)!.push(entry);
    },
    async list(sessionId) {
      return [...(bySession.get(sessionId) ?? [])];
    },
    async get(id) {
      return byId.get(id);
    },
    async readBranchPath(query) {
      const chain: SessionEntry[] = [];
      let cursor: string | undefined = query.leafId;
      while (cursor) {
        const entry = byId.get(cursor);
        if (!entry) break;
        chain.unshift(entry);
        cursor = entry.parentId;
      }
      return { items: chain };
    },
  };
}

// A broken store that accepts duplicate ids — conformance must reject it.
function lenientStore(): SessionStore {
  const bySession = new Map<string, SessionEntry[]>();
  return {
    async append(entry) {
      (bySession.get(entry.sessionId) ?? bySession.set(entry.sessionId, []).get(entry.sessionId)!)!.push(entry);
    },
    async list(sessionId) {
      return [...(bySession.get(sessionId) ?? [])];
    },
  };
}

// A broken store that drops appended package_state records — conformance must reject it.
function dropsLogStore(): SessionStore {
  const inner = createMemorySessionStore();
  return {
    ...inner,
    async list(sessionId) {
      return (await inner.list(sessionId)).filter(
        (entry) => (entry as { readonly data?: { readonly op?: unknown } }).data?.op !== "append",
      );
    },
  };
}

// A broken store whose `listSessions` ignores the ownership scope — conformance must reject it.
function leakingStore(): SessionStore {
  const inner = createMemorySessionStore();
  return {
    ...inner,
    async listSessions(query) {
      return inner.listSessions!({ limit: query.limit ?? 20 });
    },
  };
}

// A broken store that ignores expectedParentId conflicts — conformance must reject it.
function noConflictStore(): SessionStore {
  const byId = new Map<string, SessionEntry>();
  const bySession = new Map<string, SessionEntry[]>();
  return {
    async append(entry) {
      if (byId.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
      byId.set(entry.id, entry);
      (bySession.get(entry.sessionId) ?? bySession.set(entry.sessionId, []).get(entry.sessionId)!)!.push(entry);
    },
    async list(sessionId) {
      return [...(bySession.get(sessionId) ?? [])];
    },
  };
}
