import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { EventType } from "@ag-ui/core";
import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type OwnershipScope,
  providerDone,
  providerTextDelta,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createAgUiHandler } from "../index.js";

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [{ id: "msg-1", role: "user", content: "hello" }],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  });
}

function requestForUser(userId: string, payload: string, tenantId = "tenant-1") {
  return new Request("https://example.test/ag-ui", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "x-tenant-id": tenantId,
    },
    body: payload,
  });
}

async function parseSseEvents(response: Response) {
  return (await response.text())
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

async function createIsolatedAgent(options: {
  readonly id?: string;
  readonly store?: SessionStore;
  readonly ownership?: OwnershipScope;
  readonly executed?: string[];
  readonly requireApproval?: boolean;
} = {}): Promise<{ readonly agent: Agent; readonly store: SessionStore }> {
  const store = options.store ?? createMemorySessionStore();
  let turn = 0;
  const agent = await createAgent({
    id: options.id ?? "ag-ui-isolation-agent",
    model: { provider: "mock", model: "mock" },
    ownership: options.ownership,
    slots: { store },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            turn += 1;
            if (options.requireApproval && turn % 2 === 1) {
              yield {
                type: "tool_call" as const,
                call: toolCallContent(`call-${turn}`, "publish_draft", { path: "a.txt" }),
              };
              yield providerDone();
              return;
            }
            yield providerTextDelta("published");
            yield providerDone();
          },
        },
      ]),
    ],
    ...(options.requireApproval
      ? {
          hooks: askEveryTool(),
          tools: {
            add: [
              {
                name: "publish_draft",
                parameters: { type: "object" },
                execute: (_args, context) => {
                  options.executed?.push(context.toolCallId);
                  return { toolCallId: context.toolCallId, name: "publish_draft", value: "published" };
                },
              },
            ],
          },
        }
      : {}),
  });
  return { agent, store };
}

function authorizeFromHeaders({ request }: { readonly request: Request }) {
  const userId = request.headers.get("x-user-id");
  const tenantId = request.headers.get("x-tenant-id") ?? undefined;
  if (!userId) return false as const;
  return { ownership: { ...(tenantId ? { tenantId } : {}), userId } };
}

describe("createAgUiHandler session ownership isolation (plan 178 Task 4)", () => {
  it("foreign_thread_is_404", async () => {
    const { agent, store } = await createIsolatedAgent({ ownership: { tenantId: "tenant-1" } });
    const handler = createAgUiHandler(agent, { authorize: authorizeFromHeaders });

    const aliceRes = await handler(requestForUser("user-a", body({ threadId: "shared-thread", runId: "run-a" })));
    assert.equal(aliceRes.status, 200);
    const aliceEvents = await parseSseEvents(aliceRes);
    assert.equal(aliceEvents.at(-1)?.type, EventType.RUN_FINISHED);
    const entriesAfterAlice = (await store.list("shared-thread")).length;
    assert.ok(entriesAfterAlice > 0);

    // User B requesting User A's threadId gets 404 before any SSE stream opens.
    const bobRes = await handler(requestForUser("user-b", body({ threadId: "shared-thread", runId: "run-b" })));
    assert.equal(bobRes.status, 404);
    assert.equal(bobRes.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await bobRes.json(), {
      error: { code: "ERR_PRISM_AG_UI_NOT_FOUND", message: "Session not found" },
    });
    assert.equal((await store.list("shared-thread")).length, entriesAfterAlice, "foreign request must not write to the thread");

    // Widening the agent's declared tenant scope also maps to 404 before opening the SSE stream.
    const widenRes = await handler(requestForUser("user-a", body({ threadId: "new-thread", runId: "run-widen" }), "tenant-2"));
    assert.equal(widenRes.status, 404);
    assert.equal(widenRes.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await widenRes.json(), {
      error: { code: "ERR_PRISM_AG_UI_NOT_FOUND", message: "Session not found" },
    });
  });

  it("foreign_interrupt_resume_rejected", async () => {
    const executed: string[] = [];
    const { agent } = await createIsolatedAgent({
      ownership: { tenantId: "tenant-1" },
      requireApproval: true,
      executed,
    });
    const handler = createAgUiHandler(agent, { authorize: authorizeFromHeaders });

    const startEvents = await parseSseEvents(
      await handler(requestForUser("user-a", body({ threadId: "thread-a", runId: "run-1" }))),
    );
    const finish = startEvents.at(-1) as { outcome?: { type?: string; interrupts?: Array<{ id: string }> } } | undefined;
    assert.equal(finish?.outcome?.type, "interrupt");
    const interrupt = finish?.outcome?.interrupts?.[0];
    assert.ok(interrupt);

    // User B tries to resume User A's interrupt on User A's threadId -> rejected as foreign interrupt (400).
    const bobResume = await handler(
      requestForUser(
        "user-b",
        body({
          threadId: "thread-a",
          runId: "run-2",
          resume: [{ interruptId: interrupt.id, status: "resolved", payload: { outcome: "allow_once" } }],
        }),
      ),
    );
    assert.equal(bobResume.status, 400);
    assert.equal(bobResume.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await bobResume.json(), {
      error: { code: "ERR_PRISM_AG_UI_INPUT", message: "Resume does not match the pending interrupt" },
    });
    assert.deepEqual(executed, []);
  });

  it("same_user_resumes", async () => {
    const executed: string[] = [];
    const { agent } = await createIsolatedAgent({
      ownership: { tenantId: "tenant-1" },
      requireApproval: true,
      executed,
    });
    const handler = createAgUiHandler(agent, { authorize: authorizeFromHeaders });

    const startEvents = await parseSseEvents(
      await handler(requestForUser("user-a", body({ threadId: "thread-a", runId: "run-1" }))),
    );
    const finish = startEvents.at(-1) as { outcome?: { type?: string; interrupts?: Array<{ id: string }> } } | undefined;
    const interrupt = finish?.outcome?.interrupts?.[0];
    assert.ok(interrupt);

    // Foreign user's failed attempt leaves User A's interrupt intact.
    const bobResume = await handler(
      requestForUser(
        "user-b",
        body({
          threadId: "thread-a",
          runId: "run-bob",
          resume: [{ interruptId: interrupt.id, status: "resolved", payload: { outcome: "allow_once" } }],
        }),
      ),
    );
    assert.equal(bobResume.status, 400);
    assert.deepEqual(executed, []);

    // User A resumes their own interrupt and completes the run.
    const aliceResume = await handler(
      requestForUser(
        "user-a",
        body({
          threadId: "thread-a",
          runId: "run-2",
          resume: [{ interruptId: interrupt.id, status: "resolved", payload: { outcome: "allow_once" } }],
        }),
      ),
    );
    assert.equal(aliceResume.status, 200);
    const resumedEvents = await parseSseEvents(aliceResume);
    assert.equal(resumedEvents.at(-1)?.type, EventType.RUN_FINISHED);
    assert.ok(resumedEvents.some((event) => event.type === EventType.TEXT_MESSAGE_CONTENT && event.delta === "published"));
    assert.equal(executed.length, 1);
  });

  it("absent_and_foreign_are_indistinguishable", async () => {
    const executed: string[] = [];
    const { agent, store } = await createIsolatedAgent({
      ownership: { tenantId: "tenant-1" },
      requireApproval: true,
      executed,
    });
    const handler = createAgUiHandler(agent, { authorize: authorizeFromHeaders });

    // Create a suspended thread for User A, then delete the session from the store so resuming it hits an absent session.
    const startEvents = await parseSseEvents(
      await handler(requestForUser("user-a", body({ threadId: "thread-absent", runId: "run-1" }))),
    );
    const finish = startEvents.at(-1) as { outcome?: { interrupts?: Array<{ id: string }> } } | undefined;
    const interrupt = finish?.outcome?.interrupts?.[0];
    assert.ok(interrupt);
    assert.equal(await store.deleteSession?.("thread-absent"), true);

    const absentRes = await handler(
      requestForUser(
        "user-a",
        body({
          threadId: "thread-absent",
          runId: "run-2",
          resume: [{ interruptId: interrupt.id, status: "resolved", payload: { outcome: "allow_once" } }],
        }),
      ),
    );

    // Create another thread for User A and have User B attempt to open it (foreign session).
    await parseSseEvents(await handler(requestForUser("user-a", body({ threadId: "thread-owned", runId: "run-3" }))));
    const foreignRes = await handler(requestForUser("user-b", body({ threadId: "thread-owned", runId: "run-4" })));

    // And a request that widens ownership scope (OwnershipScopeError).
    const widenRes = await handler(requestForUser("user-b", body({ threadId: "thread-unseen", runId: "run-5" }), "tenant-other"));

    const absentBody = await absentRes.text();
    const foreignBody = await foreignRes.text();
    const widenBody = await widenRes.text();

    assert.equal(absentRes.status, 404);
    assert.equal(foreignRes.status, 404);
    assert.equal(widenRes.status, 404);
    assert.equal(absentRes.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(foreignRes.headers.get("content-type"), absentRes.headers.get("content-type"));
    assert.equal(widenRes.headers.get("content-type"), absentRes.headers.get("content-type"));
    assert.equal(foreignBody, absentBody);
    assert.equal(widenBody, absentBody);
    assert.deepEqual(JSON.parse(absentBody), {
      error: { code: "ERR_PRISM_AG_UI_NOT_FOUND", message: "Session not found" },
    });
  });
});
