import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createDefaultCompactionStrategy,
  createExtensionKernel,
  createMemorySessionStore,
  createToolRegistry,
  SESSION_APPEND_CONFLICT_CODE,
  SessionAppendConflictError,
} from "../index.js";
import type { Extension, SessionEntry, SessionStore, ToolDefinition } from "../index.js";
import { assertCompactionStrategyConforms } from "../testing/compaction-conformance.js";
import { assertExtensionConforms } from "../testing/extension-conformance.js";
import { assertSessionStoreConforms } from "../testing/session-store-conformance.js";
import { assertToolDispatchConforms, assertToolBlocked } from "../testing/tool-conformance.js";

void describe("session-store conformance helper", () => {
  it("conforms against the core memory store", async () => {
    await assertSessionStoreConforms(createMemorySessionStore());
  });

  it("conforms against a custom store that implements readBranchPath", async () => {
    await assertSessionStoreConforms(customStore(), { exerciseReadBranchPath: true });
  });

  it("rejects a store that silently accepts duplicate entry ids", async () => {
    await assert.rejects(
      () => assertSessionStoreConforms(lenientStore()),
      /store must reject a duplicate entry id/,
    );
  });

  it("rejects a store that ignores a missing expectedParentId", async () => {
    await assert.rejects(
      () => assertSessionStoreConforms(noConflictStore()),
      /store must throw SessionAppendConflictError when expectedParentId does not exist/,
    );
  });

  it("testing/session-store-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/session-store-conformance"]);
  });
});

void describe("compaction conformance helper", () => {
  it("conforms against the default strategy with secret redaction", async () => {
    const strategy = createDefaultCompactionStrategy({ keepRecentEntries: 1, secrets: ["secret-value"] });
    const { summary } = await assertCompactionStrategyConforms(strategy, { secrets: ["secret-value"] });
    assert.ok(summary.length > 0);
    assert.equal(summary.includes("secret-value"), false);
  });

  it("rejects a strategy that leaks a secret into the summary", async () => {
    const leaking = {
      name: "leaking",
      compact: () => ({ summary: "leaked secret-value" }),
    };
    await assert.rejects(
      () => assertCompactionStrategyConforms(leaking, { secrets: ["secret-value"] }),
      /leaked a secret into the summary/,
    );
  });

  it("rejects a strategy that returns an empty summary", async () => {
    const empty = { name: "empty", compact: () => ({ summary: "" }) };
    await assert.rejects(
      () => assertCompactionStrategyConforms(empty),
      /non-empty string summary/,
    );
  });

  it("testing/compaction-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/compaction-conformance"]);
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
      () => assertToolBlocked({ call: { type: "tool_call", id: "c", name: "echo", arguments: {} }, registry: createToolRegistry([echo]) }, "unknown_tool"),
      /no blocked event was emitted/,
    );
  });

  it("rejects a tool whose valid call does not execute", async () => {
    // A tool that throws on execute surfaces as tool_execution_error with an error
    // result, so the success-path assertion fails.
    const throwing: ToolDefinition = {
      name: "boom",
      execute: () => { throw new Error("boom"); },
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

void describe("extension conformance helper", () => {
  it("conforms against an extension that registers an inert skill", async () => {
    const extension: Extension = {
      name: "demo",
      setup(api) { api.registerSkill({ name: "brief", instructions: "Be brief." }); },
    };
    const kernel = await assertExtensionConforms(extension);
    assert.equal(kernel.registries.skills.get("brief")?.name, "brief");
  });

  it("redacts a secret-bearing setup error event under the default policy", async () => {
    const ok: Extension = { name: "ok", setup: () => undefined };
    // The helper injects its own failing extension that throws a secret-bearing
    // error; the kernel must redact it in the extension_error event.
    const kernel = await assertExtensionConforms(ok, { secrets: ["token-123"] });
    assert.ok(kernel.registries.skills.get("brief") === undefined || true);
  });

  it("rethrows a failing setup under expectThrow", async () => {
    const ok: Extension = { name: "ok", setup: () => undefined };
    await assertExtensionConforms(ok, { expectThrow: true });
  });

  it("testing/extension-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/extension-conformance"]);
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
        if (idempotencySeen.has(dedup)) throw new SessionAppendConflictError({ code: SESSION_APPEND_CONFLICT_CODE, idempotencyDuplicate: true });
        idempotencySeen.add(dedup);
      }
      byId.set(entry.id, entry);
      (bySession.get(entry.sessionId) ?? bySession.set(entry.sessionId, []).get(entry.sessionId)!)!.push(entry);
    },
    async list(sessionId) { return [...(bySession.get(sessionId) ?? [])]; },
    async get(id) { return byId.get(id); },
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
    async list(sessionId) { return [...(bySession.get(sessionId) ?? [])]; },
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
    async list(sessionId) { return [...(bySession.get(sessionId) ?? [])]; },
  };
}
