import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { EventType } from "@ag-ui/core";
import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createAgUiHandler } from "../index.js";

const authorization = { ownership: { userId: "user-1" } };

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [{ id: "user-1", role: "user", content: "hello" }],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  });
}

function request(value: string, suffix = "") {
  return new Request(`https://example.test/ag-ui${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: value,
  });
}

async function events(response: Response) {
  return (await response.text())
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

/** A text-only agent whose provider emits one message and finishes. */
async function textAgent(id = "ag-ui-agent"): Promise<Agent> {
  return await createAgent({
    id,
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            yield providerTextDelta("hello from the agent");
            yield providerDone();
          },
        },
      ]),
    ],
  });
}

/** An approval-gated agent: first turn asks to call `publish_draft`, second turn finishes. */
async function approvalAgent(id = "approvals-agent", executed: string[] = []): Promise<Agent> {
  let turn = 0;
  return await createAgent({
    id,
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            if (++turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-1", "publish_draft", { path: "a.txt" }) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("published");
            yield providerDone();
          },
        },
      ]),
    ],
    hooks: askEveryTool(),
    tools: {
      add: [
        {
          name: "publish_draft",
          parameters: { type: "object" },
          execute: (_args, context) => {
            executed.push(context.toolCallId);
            return { toolCallId: context.toolCallId, name: "publish_draft", value: "published" };
          },
        },
      ],
    },
  });
}

describe("createAgUiHandler", () => {
  it("ag_ui_handler_streams_session_run", async () => {
    const handler = createAgUiHandler(await textAgent(), { authorize: () => authorization });
    const output = await events(await handler(request(body())));
    assert.equal(output[0]?.type, EventType.RUN_STARTED);
    assert.equal(output.at(-1)?.type, EventType.RUN_FINISHED);
    assert.ok(output.some((event) => event.type === EventType.TEXT_MESSAGE_CONTENT && event.delta === "hello from the agent"));
    assert.equal(handler.capabilities.transport?.streaming, true);
    assert.equal(handler.capabilities.humanInTheLoop?.interrupts, true);
  });

  it("ag_ui_handler_interrupt_and_resume", async () => {
    for (const [outcome, expected] of [
      ["allow_once", 1],
      ["reject_once", 0],
    ] as const) {
      const executed: string[] = [];
      const handler = createAgUiHandler(await approvalAgent(`approvals-${outcome}`, executed), {
        authorize: () => authorization,
      });
      const start = await events(await handler(request(body())));
      const finish = start.at(-1) as { outcome?: { type?: string; interrupts?: Array<{ id: string }> } } | undefined;
      assert.equal(finish?.outcome?.type, "interrupt");
      const interrupt = finish?.outcome?.interrupts?.[0];
      assert.ok(interrupt, "suspension must carry one interrupt");
      assert.deepEqual(executed, []);
      const resumed = await events(
        await handler(
          request(
            body({
              runId: "run-2",
              resume: [{ interruptId: interrupt.id, status: "resolved", payload: { outcome } }],
            }),
          ),
        ),
      );
      assert.ok(resumed.length > 0);
      assert.equal(executed.length, expected);
    }
  });

  it("ag_ui_handler_rejects_foreign_interrupt", async () => {
    const executed: string[] = [];
    const handler = createAgUiHandler(await approvalAgent("foreign-agent", executed), { authorize: () => authorization });
    await handler(request(body()));
    const response = await handler(
      request(
        body({
          runId: "run-2",
          resume: [{ interruptId: "other-run:1:0", status: "resolved", payload: { outcome: "allow_once" } }],
        }),
      ),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(executed, []);
  });

  it("ag_ui_handler_authorize_defaults_deny", async () => {
    const handler = createAgUiHandler(await textAgent());
    assert.equal((await handler(request(body()))).status, 403);
  });

  it("ag_ui_handler_client_disconnect_aborts_run", async () => {
    const executed: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let turn = 0;
    const agent = await createAgent({
      id: "disconnect-agent",
      model: { provider: "mock", model: "mock" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              if (++turn === 1) {
                yield providerTextDelta("working");
                await gate;
                yield { type: "tool_call" as const, call: toolCallContent("call-1", "publish_draft", {}) };
              }
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "publish_draft",
            parameters: { type: "object" },
            execute: (_args, context) => {
              executed.push(context.toolCallId);
              return { toolCallId: context.toolCallId, name: "publish_draft", value: "ok" };
            },
          },
        ],
      },
    });
    const handler = createAgUiHandler(agent, { authorize: () => authorization });
    const response = await handler(request(body()));
    const reader = response.body?.getReader();
    assert.ok(reader);
    await reader.read();
    await reader.cancel();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(executed, []);
  });

  it("ag_ui_handler_never_emits_secret", async () => {
    const redactor = createSecretRedactor(["sekret"]);
    const agent = await createAgent({
      id: "secret-agent",
      model: { provider: "mock", model: "mock" },
      slots: { store: createMemorySessionStore() },
      redactor,
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              yield providerTextDelta("token sekret leaked");
              yield providerDone();
            },
          },
        ]),
      ],
    });
    const handler = createAgUiHandler(agent, { authorize: () => authorization, redactor });
    const text = await (await handler(request(body()))).text();
    assert.ok(!text.includes("sekret"), "secret must never reach an SSE frame");
  });

  it("rejects non-POST and non-JSON requests before authorization", async () => {
    const handler = createAgUiHandler(await textAgent());
    assert.equal((await handler(new Request("https://example.test/ag-ui"))).status, 405);
    assert.equal((await handler(new Request("https://example.test/ag-ui", { method: "POST", body: "x" }))).status, 415);
  });
});
