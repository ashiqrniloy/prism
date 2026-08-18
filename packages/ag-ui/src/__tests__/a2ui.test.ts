import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventSchemas, EventType } from "@ag-ui/core";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import {
  A2UI_ACTIVITY_TYPE,
  A2UI_ERROR_EVENT,
  createAgUiEventMapper,
  createAgUiHandler,
  extractAgUiA2UiActions,
  resolveAgUiLimits,
} from "../index.js";
import { parseAgUiInput } from "../input.js";

const catalogId = "https://a2ui.org/specification/v0_9/basic_catalog.json";

function createSurface(surfaceId: string, catalog?: string) {
  return {
    version: "v0.9",
    createSurface: { surfaceId, ...(catalog ? { catalogId: catalog } : {}) },
  };
}

function updateComponents(surfaceId: string, components: unknown[]) {
  return { version: "v0.9", updateComponents: { surfaceId, components } };
}

describe("A2UI painting middleware", () => {
  it("is inert without a2ui option (0.0.24 parity)", async () => {
    const mapper = createAgUiEventMapper();
    const events = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t1",
        name: "paint",
        value: {
          a2ui_operations: [createSurface("s1", catalogId), updateComponents("s1", [{ id: "root", component: "Text", text: "hi" }])],
        },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    assert.equal(
      events.some((event) => event.type === EventType.ACTIVITY_SNAPSHOT),
      false,
    );
  });

  it("fixed-schema paints ACTIVITY_SNAPSHOT then ACTIVITY_DELTA and stamps catalogId", async () => {
    const mapper = createAgUiEventMapper({
      a2ui: { catalogId, mode: "fixed-schema" },
    });
    const first = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t1",
        name: "paint",
        value: {
          a2ui_operations: [createSurface("card-1"), updateComponents("card-1", [{ id: "root", component: "Text", text: "hello" }])],
        },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    const snapshot = first.find((event) => event.type === EventType.ACTIVITY_SNAPSHOT);
    assert.ok(snapshot);
    assert.equal(snapshot?.type, EventType.ACTIVITY_SNAPSHOT);
    if (snapshot?.type === EventType.ACTIVITY_SNAPSHOT) {
      assert.equal(snapshot.activityType, A2UI_ACTIVITY_TYPE);
      assert.equal(snapshot.messageId, "a2ui-surface-card-1-t1");
      const ops = (snapshot.content as { a2ui_operations: { createSurface?: { catalogId: string } }[] }).a2ui_operations;
      assert.equal(ops[0]?.createSurface?.catalogId, catalogId);
    }
    assert.equal(EventSchemas.safeParse(snapshot).success, true);

    const second = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t2",
        name: "paint",
        value: {
          a2ui_operations: [updateComponents("card-1", [{ id: "root", component: "Text", text: "updated" }])],
        },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    const delta = second.find((event) => event.type === EventType.ACTIVITY_DELTA);
    assert.ok(delta);
    assert.equal(EventSchemas.safeParse(delta).success, true);
    if (delta?.type === EventType.ACTIVITY_DELTA) {
      assert.equal(delta.messageId, "a2ui-surface-card-1-t1");
      assert.equal(delta.activityType, A2UI_ACTIVITY_TYPE);
      assert.equal((delta.patch[0] as { op: string; path: string }).op, "add");
    }
  });

  it("fails closed on delta-before-create, unknown version, and oversized ops", async () => {
    const mapper = createAgUiEventMapper({
      a2ui: { catalogId, mode: "fixed-schema", limits: { maxOperationsPerMessage: 2 } },
    });
    const beforeCreate = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t1",
        name: "paint",
        value: { a2ui_operations: [updateComponents("ghost", [{ id: "root", component: "Text", text: "x" }])] },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    assert.equal(
      beforeCreate.some((event) => event.type === EventType.ACTIVITY_SNAPSHOT),
      false,
    );
    assert.ok(beforeCreate.some((event) => event.type === EventType.CUSTOM && event.name === A2UI_ERROR_EVENT));

    const badVersion = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t2",
        name: "paint",
        value: { a2ui_operations: [{ version: "v0.8", createSurface: { surfaceId: "s2", catalogId } }] },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    assert.equal(
      badVersion.some((event) => event.type === EventType.ACTIVITY_SNAPSHOT),
      false,
    );
    assert.ok(badVersion.some((event) => event.type === EventType.CUSTOM && event.name === A2UI_ERROR_EVENT));

    const oversized = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t3",
        name: "paint",
        value: {
          a2ui_operations: [
            createSurface("s3", catalogId),
            updateComponents("s3", [{ id: "root", component: "Text", text: "a" }]),
            updateComponents("s3", [{ id: "root", component: "Text", text: "b" }]),
          ],
        },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    assert.equal(
      oversized.some((event) => event.type === EventType.ACTIVITY_SNAPSHOT),
      false,
    );
    assert.ok(oversized.some((event) => event.type === EventType.CUSTOM && event.name === A2UI_ERROR_EVENT));
  });

  it("overwrites model-invented catalog ids outside the allow-list", async () => {
    const mapper = createAgUiEventMapper({
      a2ui: { catalogId, mode: "fixed-schema", allowedCatalogIds: [catalogId] },
    });
    const events = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t1",
        name: "paint",
        value: { a2ui_operations: [createSurface("s1", "evil-catalog")] },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    const snapshot = events.find((event) => event.type === EventType.ACTIVITY_SNAPSHOT);
    assert.ok(snapshot && snapshot.type === EventType.ACTIVITY_SNAPSHOT);
    const ops = (snapshot!.content as { a2ui_operations: { createSurface: { catalogId: string } }[] }).a2ui_operations;
    assert.equal(ops[0]!.createSurface.catalogId, catalogId);
  });

  it("streaming paints progressive replace snapshots only when complete ops extractable", async () => {
    const mapper = createAgUiEventMapper({
      a2ui: { catalogId, mode: "streaming", renderToolName: "render_a2ui" },
    });
    const partial = await mapper.map({
      type: "message_delta",
      sessionId: "s",
      runId: "r",
      content: {
        type: "tool_call_delta",
        index: 0,
        id: "render-1",
        name: "render_a2ui",
        argumentsText: '{"surfaceId":"live","components":[{"id":"root","component":"Text","text":"par',
      },
    });
    assert.equal(
      partial.some((event) => event.type === EventType.ACTIVITY_SNAPSHOT),
      false,
    );

    const complete = await mapper.map({
      type: "message_delta",
      sessionId: "s",
      runId: "r",
      content: {
        type: "tool_call_delta",
        index: 0,
        id: "render-1",
        argumentsText: 'tial"}]}',
      },
    });
    const snapshot = complete.find((event) => event.type === EventType.ACTIVITY_SNAPSHOT);
    assert.ok(snapshot && snapshot.type === EventType.ACTIVITY_SNAPSHOT);
    assert.equal(snapshot.replace, true);
    assert.equal(snapshot.activityType, A2UI_ACTIVITY_TYPE);
    assert.equal(EventSchemas.safeParse(snapshot).success, true);
  });

  it("extracts untrusted a2ui actions for input.project and rejects malformed ones", async () => {
    const limits = resolveAgUiLimits();
    const input = parseAgUiInput(
      {
        threadId: "thread-1",
        runId: "run-1",
        state: {},
        messages: [{ id: "m1", role: "user", content: "go" }],
        tools: [],
        context: [],
        forwardedProps: {
          a2uiAction: { userAction: { surfaceId: "card-1", name: "submit", context: { ok: true } } },
        },
      },
      limits,
    );
    const actions = extractAgUiA2UiActions(input, limits);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0], {
      type: "a2ui-action",
      surfaceId: "card-1",
      actionName: "submit",
      payload: { ok: true },
    });

    const bad = parseAgUiInput(
      {
        threadId: "thread-1",
        runId: "run-2",
        state: {},
        messages: [{ id: "m1", role: "user", content: "go" }],
        tools: [],
        context: [],
        forwardedProps: { a2uiAction: { userAction: { surfaceId: "../etc", name: "x" } } },
      },
      limits,
    );
    assert.equal(extractAgUiA2UiActions(bad, limits).length, 0);
  });

  it("handler surfaces a2uiActions to input.project when a2ui is opted in", async () => {
    let seen: readonly { type: string; surfaceId: string; actionName: string }[] | undefined;
    const agent = createAgent({
      id: "a2ui-agent",
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
    });
    const handler = createAgUiHandler({
      authorize: () => ({ ownership: { userId: "u1" } }),
      a2ui: { catalogId, mode: "fixed-schema" },
      sessionFactory: () => agent.createSession({ id: "s1" }),
      limits: { requestTimeoutMs: 5_000 },
      input: {
        project: ({ a2uiActions }) => {
          seen = a2uiActions;
          return { messages: "clicked" };
        },
      },
    });
    const response = await handler(
      new Request("https://example.test/ag-ui", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: "thread-1",
          runId: "run-1",
          state: {},
          messages: [{ id: "m1", role: "user", content: "hi" }],
          tools: [],
          context: [],
          forwardedProps: { a2uiAction: { userAction: { surfaceId: "card-1", name: "click" } } },
        }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(seen?.length, 1);
    assert.equal(seen?.[0]?.actionName, "click");
  });

  it("handler fixed-schema paints tool results end-to-end", async () => {
    let turn = 0;
    const agent = createAgent({
      id: "paint-agent",
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) {
            yield {
              type: "tool_call" as const,
              call: toolCallContent("paint-1", "paint", { kind: "a2ui" }),
            };
          } else {
            yield providerTextDelta("done");
          }
          yield providerDone();
        },
      },
      tools: [
        {
          name: "paint",
          parameters: { type: "object" },
          execute: () => ({
            toolCallId: "paint-1",
            name: "paint",
            value: {
              a2ui_operations: [createSurface("demo"), updateComponents("demo", [{ id: "root", component: "Text", text: "painted" }])],
            },
          }),
        },
      ],
    });
    const handler = createAgUiHandler({
      authorize: () => ({ ownership: { userId: "u1" } }),
      a2ui: { catalogId, mode: "fixed-schema" },
      sessionFactory: () => agent.createSession({ id: "s1" }),
      limits: { requestTimeoutMs: 5_000 },
    });
    const response = await handler(
      new Request("https://example.test/ag-ui", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: "thread-1",
          runId: "run-1",
          state: {},
          messages: [{ id: "m1", role: "user", content: "paint" }],
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /ACTIVITY_SNAPSHOT/);
    assert.match(body, /a2ui-surface/);
    assert.match(body, /demo/);
  });

  it("drops duplicate createSurface for an existing surface", async () => {
    const mapper = createAgUiEventMapper({ a2ui: { catalogId, mode: "fixed-schema" } });
    await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: { toolCallId: "t1", name: "paint", value: { a2ui_operations: [createSurface("s1", catalogId)] } },
      metadata: { durationMs: 1, status: "finished" },
    });
    const dup = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "t2",
        name: "paint",
        value: {
          a2ui_operations: [createSurface("s1", catalogId), updateComponents("s1", [{ id: "root", component: "Text", text: "x" }])],
        },
      },
      metadata: { durationMs: 1, status: "finished" },
    });
    assert.equal(dup.filter((event) => event.type === EventType.ACTIVITY_SNAPSHOT).length, 0);
    assert.equal(dup.filter((event) => event.type === EventType.ACTIVITY_DELTA).length, 1);
  });
});
