import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity, ToolEffectRecord, ToolEffectStore } from "@arnilo/prism";
import { createMemoryToolEffectStore } from "@arnilo/prism";
import type { McpAppsBridge } from "@arnilo/prism-mcp";
import { deriveAppEffectKey, hashJson, reconcileAppEffect } from "../effect-recovery.js";
import { createAgUiMcpAppHandler } from "../mcp-apps.js";

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
const otherIdentity: AgentIdentity = {
  tenantId: "other",
  accountId: "account",
  userId: "user",
  principal: { kind: "service", id: "other-principal" },
  scopes: ["tools:execute"],
  issuedAt: "2026-01-01T00:00:00.000Z",
  verified: true,
};
const otherOwnership = { tenantId: "other", accountId: "account", userId: "user" };

function appsBridge(callTool: McpAppsBridge["callTool"]): McpAppsBridge {
  return {
    serverId: "app",
    negotiated: true,
    tools: [{ name: "mutate", prismName: "mcp:app:mutate", inputSchema: { type: "object" }, visibility: ["app"] }],
    listResources: async () => [],
    readResource: async () => ({
      uri: "ui://app/card",
      name: "mutate",
      mimeType: "text/html;profile=mcp-app",
      html: "<!doctype html><html></html>",
    }),
    callTool,
  };
}

function handlerOptions(store: ToolEffectStore | undefined, callTool: McpAppsBridge["callTool"], overrides: Record<string, unknown> = {}) {
  return {
    apps: appsBridge(callTool),
    authorize: () => ({ ownership }),
    context: () => ({ sessionId: "session", runId: "run", toolCallId: "call-1", identity }),
    approveToolCall: () => true,
    allowedOrigins: ["https://ui.test"],
    ...(store === undefined ? {} : { effectStore: store }),
    ...overrides,
  };
}

function call(handler: (request: Request) => Promise<Response>, method = "tools/call", params: Record<string, unknown> = { name: "mutate", arguments: { id: 1 } }) {
  return handler(
    new Request("https://proxy.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://ui.test" },
      body: JSON.stringify({ serverId: "app", message: { jsonrpc: "2.0", id: 1, method, params } }),
    }),
  );
}

describe("MCP Apps effect recording (FR-4)", () => {
  it("records begin → dispatched → complete for an approved call and replays the result idempotently", async () => {
    let calls = 0;
    const store = createMemoryToolEffectStore();
    const handler = createAgUiMcpAppHandler(
      handlerOptions(store, async () => {
        calls += 1;
        return { toolCallId: "call-1", name: "mutate", value: { ok: true } };
      }),
    );
    const first = await call(handler);
    assert.equal(first.status, 200);
    assert.equal(calls, 1);
    const record = await store.get({
      identity,
      ownership,
      key: deriveAppEffectKey({ ownership, sessionId: "session", runId: "run", toolName: "mutate", argumentsHash: hashJson({ id: 1 }) }),
      sessionId: "session",
      runId: "run",
      toolCallId: "call-1",
      toolName: "mutate",
      argumentsHash: hashJson({ id: 1 }),
    });
    assert.ok(record);
    assert.equal(record.status, "completed");
    assert.equal(record.attempt, 1);
    // Idempotent retry: same UI call replays the recorded result without re-dispatching.
    const retry = await call(handler);
    assert.equal(retry.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(await retry.text()).result.structuredContent, { ok: true });
  });

  it("records failed_retryable when the app call throws", async () => {
    const store = createMemoryToolEffectStore();
    const handler = createAgUiMcpAppHandler(
      handlerOptions(store, async () => {
        throw new Error("boom");
      }),
    );
    const response = await call(handler);
    assert.equal(response.status, 400);
    const record = await store.get({
      identity,
      ownership,
      key: deriveAppEffectKey({ ownership, sessionId: "session", runId: "run", toolName: "mutate", argumentsHash: hashJson({ id: 1 }) }),
      sessionId: "session",
      runId: "run",
      toolCallId: "call-1",
      toolName: "mutate",
      argumentsHash: hashJson({ id: 1 }),
    });
    assert.ok(record);
    assert.equal(record.status, "failed_retryable");
    assert.equal(record.failure?.code, "ERR_PRISM_AG_UI_CALL_FAILED");
  });

  it("marks unknown on transport abort and reconciles via reconcileAppEffect", async () => {
    const store = createMemoryToolEffectStore();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = createAgUiMcpAppHandler(
      handlerOptions(store, async () => {
        await gate;
        return { toolCallId: "call-1", name: "mutate", value: { ok: true } };
      }),
    );
    const controller = new AbortController();
    const pending = handler(
      new Request("https://proxy.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://ui.test" },
        body: JSON.stringify({ serverId: "app", message: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mutate", arguments: { id: 1 } } } }),
        signal: controller.signal,
      }),
    ).then((response) => response.status);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    release?.();
    assert.equal(await pending, 400);
    const key = deriveAppEffectKey({ ownership, sessionId: "session", runId: "run", toolName: "mutate", argumentsHash: hashJson({ id: 1 }) });
    const base = {
      identity,
      ownership,
      key,
      sessionId: "session",
      runId: "run",
      toolCallId: "call-1",
      toolName: "mutate",
      argumentsHash: hashJson({ id: 1 }),
    };
    const record = await store.get(base);
    assert.ok(record);
    assert.equal(record.status, "unknown");
    // Host reconciles against the actual outcome (the mutation did land).
    const reconciled = await reconcileAppEffect({
      effectStore: store,
      identity,
      ownership,
      sessionId: "session",
      runId: "run",
      toolName: "mutate",
      arguments: { id: 1 },
      toolCallId: "call-1",
      outcome: "completed",
      result: { toolCallId: "call-1", name: "mutate", value: { ok: true } },
    });
    assert.ok(reconciled);
    assert.equal(reconciled.status, "completed");
    // Retry after reconcile is idempotent: replays the reconciled result.
    const retry = await call(handler);
    assert.equal(retry.status, 200);
    assert.deepEqual(JSON.parse(await retry.text()).result.structuredContent, { ok: true });
  });

  it("fails closed on wrong-owner effect records", async () => {
    const store = createMemoryToolEffectStore();
    const handler = createAgUiMcpAppHandler(
      handlerOptions(store, async () => ({ toolCallId: "call-1", name: "mutate", value: { ok: true } })),
    );
    // First call records under tenant ownership.
    assert.equal((await call(handler)).status, 200);
    // A second handler with different tenant derives a different key → records separately, cannot see the first tenant's record.
    const otherHandler = createAgUiMcpAppHandler(
      handlerOptions(store, async () => ({ toolCallId: "call-1", name: "mutate", value: { ok: true } }), {
        authorize: () => ({ ownership: otherOwnership }),
        context: () => ({ sessionId: "session", runId: "run", toolCallId: "call-1", identity: otherIdentity }),
      }),
    );
    assert.equal((await call(otherHandler)).status, 200);
    const records = await store.get({
      identity: otherIdentity,
      ownership: otherOwnership,
      key: deriveAppEffectKey({ ownership: otherOwnership, sessionId: "session", runId: "run", toolName: "mutate", argumentsHash: hashJson({ id: 1 }) }),
      sessionId: "session",
      runId: "run",
      toolCallId: "call-1",
      toolName: "mutate",
      argumentsHash: hashJson({ id: 1 }),
    });
    assert.ok(records);
    assert.equal(records.status, "completed");
  });

  it("fails closed when effectStore is present but ownership/identity cannot be resolved", async () => {
    const store = createMemoryToolEffectStore();
    const handler = createAgUiMcpAppHandler(
      handlerOptions(store, async () => ({ toolCallId: "call-1", name: "mutate", value: { ok: true } }), {
        authorize: () => ({}),
      }),
    );
    const response = await call(handler);
    assert.equal(response.status, 403);
  });

  it("keeps 0.0.25 behavior when effectStore is absent", async () => {
    let calls = 0;
    const handler = createAgUiMcpAppHandler(
      handlerOptions(undefined, async () => {
        calls += 1;
        return { toolCallId: "call-1", name: "mutate", value: { ok: true } };
      }),
    );
    assert.equal((await call(handler)).status, 200);
    assert.equal((await call(handler)).status, 200);
    assert.equal(calls, 2);
  });

  it("reconcileAppEffect returns undefined for unrecorded calls and leaves dispatched records untouched", async () => {
    const store = createMemoryToolEffectStore();
    const missing = await reconcileAppEffect({
      effectStore: store,
      identity,
      ownership,
      sessionId: "session",
      runId: "run",
      toolName: "mutate",
      arguments: { id: 99 },
      outcome: "completed",
    });
    assert.equal(missing, undefined);
    // A dispatched (in-flight) record is not reconciled.
    const key = deriveAppEffectKey({ ownership, sessionId: "session", runId: "run", toolName: "mutate", argumentsHash: hashJson({ id: 1 }) });
    const base = {
      identity,
      ownership,
      key,
      sessionId: "session",
      runId: "run",
      toolCallId: "call-1",
      toolName: "mutate",
      argumentsHash: hashJson({ id: 1 }),
    };
    const { record } = await store.begin(base);
    assert.ok(record.claimToken);
    await store.markDispatched({ ...base, claimToken: record.claimToken, expectedVersion: record.version });
    const untouched = await reconcileAppEffect({
      effectStore: store,
      identity,
      ownership,
      sessionId: "session",
      runId: "run",
      toolName: "mutate",
      arguments: { id: 1 },
      toolCallId: "call-1",
      outcome: "completed",
    });
    assert.ok(untouched);
    assert.equal(untouched.status, "dispatched");
  });
});
