import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import {
  type AgentEventRecord,
  type AgentRunRef,
  type AgentSession,
  createAgent,
  createAgentRunLifecycle,
  createMemoryAgentEventSource,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { type AgUiPreparedInput, createAgentEventSourceAgUiReplay, createAgUiHandler, createPersistenceAgUiReplay } from "../index.js";

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

async function events(response: Response) {
  return (await response.text())
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
}

/** Run-scoped message ids are the only volatile part of an identical stream. */
async function stableBody(response: Response) {
  return (await response.text()).replace(/run_[0-9a-f-]+:/g, "run_:");
}

function request(value: string, suffix = "") {
  return new Request(`https://example.test/ag-ui${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: value,
  });
}

describe("createAgUiHandler", () => {
  it("runs only the final text user input through an authorized host session", async () => {
    const inputs: string[] = [];
    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate(requestValue) {
          const content = requestValue.messages.at(-1)?.content[0];
          inputs.push(content?.type === "text" ? content.text : "");
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "session-1" }),
    });

    const response = await handler(
      request(
        body({
          messages: [
            { id: "old", role: "user", content: "old" },
            { id: "assistant", role: "assistant", content: "ignored" },
            { id: "latest", role: "user", content: [{ type: "text", text: "latest" }] },
          ],
        }),
      ),
    );
    assert.equal(response.status, 200);
    const output = await events(response);
    assert.deepEqual(
      output.map((item) => item.type),
      [
        EventType.RUN_STARTED,
        EventType.STEP_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.STEP_FINISHED,
        EventType.RUN_FINISHED,
      ],
    );
    assert.equal(output[0].runId, "run-1");
    assert.equal(inputs.at(-1), "latest");
  });

  it("rejects client state before authorization or session lookup", async () => {
    let calls = 0;
    const handler = createAgUiHandler({
      authorize: () => {
        calls += 1;
        return authorization;
      },
      sessionFactory: () => {
        calls += 1;
        throw new Error("must not run");
      },
    });
    const response = await handler(request(body({ state: { client: "cannot mutate host" } })));
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });

  it("ignores client state and tools from the official client under inputPolicy.ignore", async () => {
    let executed = 0;
    let seen: { readonly state: unknown; readonly tools: readonly unknown[]; readonly frontendTools: readonly unknown[] } | undefined;
    let prepared: AgUiPreparedInput | undefined;
    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("server-authoritative");
          yield providerDone();
        },
      },
      tools: [{ name: "server-only", execute: () => ({ toolCallId: "never", name: "server-only", value: ++executed }) }],
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      inputPolicy: { clientState: "ignore" },
      input: {
        frontendTools: ({ request: value }) => value.tools.map((tool) => ({ name: tool.name, execution: "client" as const })),
        project: ({ request: value, frontendTools }) => {
          seen = { state: value.state, tools: value.tools, frontendTools };
          return { messages: [{ id: "user-2", role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }] };
        },
      },
      sessionFactory: ({ input }) => {
        prepared = input;
        return agent.createSession({ id: "ignore-session" });
      },
    });
    const client = new HttpAgent({
      url: "https://example.test/ag-ui",
      threadId: "thread-1",
      initialState: { client: "cannot decide" },
      initialMessages: [{ id: "client-user", role: "user", content: "hello" }],
      fetch: (_url, init) =>
        handler(
          new Request("https://example.test/ag-ui", {
            method: "POST",
            headers: init.headers,
            body: init.body,
            signal: init.signal,
          }),
        ),
    });
    await client.runAgent({
      runId: "http-run",
      tools: [{ name: "pick_file", description: "client action", parameters: { type: "object" } }],
      forwardedProps: { untrusted: true },
    });

    assert.ok(client.messages.some((message) => message.role === "assistant" && message.content === "server-authoritative"));
    assert.deepEqual(seen, { state: undefined, tools: [], frontendTools: [] });
    assert.equal(prepared?.clientState, "ignore");
    assert.deepEqual(prepared?.frontendTools, []);
    assert.equal(executed, 0, "a client Tool schema never becomes an executor");
  });

  it("answers a state-or-tools post exactly like a bare-text post under inputPolicy.ignore", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      inputPolicy: { clientState: "ignore" },
      sessionFactory: () => agent.createSession({ id: "ignore-session" }),
    });

    const posted = await handler(
      request(
        body({
          state: { client: "cannot decide" },
          tools: [{ name: "pick_file", description: "client action", parameters: { type: "object" } }],
        }),
      ),
    );
    const bare = await handler(request(body()));
    assert.equal(posted.status, 200);
    assert.equal(bare.status, 200);
    assert.equal(await stableBody(posted), await stableBody(bare));
  });

  it("keeps honoring validated client input by default and with an explicit honor policy", async () => {
    const observed: unknown[] = [];
    const makeHandler = (inputPolicy?: { readonly clientState: "honor" | "ignore" }) => {
      const agent = createAgent({
        model: { provider: "mock", model: "mock" },
        provider: {
          id: "mock",
          async *generate() {
            yield providerTextDelta("honored");
            yield providerDone();
          },
        },
      });
      return createAgUiHandler({
        authorize: () => authorization,
        ...(inputPolicy ? { inputPolicy } : {}),
        input: {
          project: ({ request: value }) => {
            observed.push(value.state);
            return { messages: [{ id: "user-2", role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }] };
          },
        },
        sessionFactory: () => agent.createSession({ id: "honor-session" }),
      });
    };
    const posted = body({ state: { client: "projected by the host" } });
    const implicit = await makeHandler()(request(posted));
    const explicit = await makeHandler({ clientState: "honor" })(request(posted));
    assert.equal(implicit.status, 200);
    assert.equal(await stableBody(implicit), await stableBody(explicit));
    assert.deepEqual(observed, [{ client: "projected by the host" }, { client: "projected by the host" }]);
  });

  it("fails closed on an unknown input policy and still bounds ignored fields", async () => {
    const refuse = () => {
      throw new Error("must not run");
    };
    assert.throws(
      () =>
        createAgUiHandler({
          authorize: () => authorization,
          sessionFactory: refuse,
          inputPolicy: { clientState: "Ignore" } as never,
        }),
      /inputPolicy/,
    );
    assert.throws(
      () =>
        createAgUiHandler({
          authorize: () => authorization,
          sessionFactory: refuse,
          inputPolicy: { clientState: "ignore" },
          input: { frontendTools: () => [] },
          capabilities: { tools: { clientProvided: true } },
        }),
      /clientProvided tools conflict/,
    );

    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: refuse,
      inputPolicy: { clientState: "ignore" },
      limits: { maxStateBytes: 2_048 },
    });
    const oversized = await handler(request(body({ state: { blob: "x".repeat(4_096) } })));
    const malformed = await handler(request("{ not json"));
    assert.equal(oversized.status, 413, "over-limit input keeps the existing ERR_PRISM_AG_UI_LIMIT mapping");
    assert.equal(malformed.status, 400);
  });

  it("accepts host-projected full input and client tool continuation without executing it", async () => {
    let calls = 0;
    let selected: readonly { readonly name: string; readonly execution: "client" }[] | undefined;
    let session: AgentSession | undefined;
    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("continued");
          yield providerDone();
        },
      },
      tools: [{ name: "server-only", execute: () => ({ toolCallId: "never", name: "server-only", value: ++calls }) }],
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      input: {
        frontendTools: ({ request: value }) => value.tools.map((tool) => ({ name: tool.name, execution: "client" as const })),
        project: ({ frontendTools }) => ({
          frontendTools,
          messages: [
            { id: "developer-1", role: "system" as const, content: [{ type: "text" as const, text: "approved developer context" }] },
            {
              id: "tool-result-1",
              role: "tool" as const,
              content: [{ type: "tool_result" as const, toolCallId: "client-call-1", name: "pick_file", result: { picked: "safe" } }],
            },
            { id: "user-2", role: "user" as const, content: [{ type: "text" as const, text: "continue" }] },
          ],
        }),
      },
      sessionFactory: ({ input }) => {
        selected = input.frontendTools;
        session = agent.createSession({ id: "full-input-session" });
        return session;
      },
    });
    const response = await handler(
      request(
        body({
          parentRunId: "parent-1",
          state: { safe: { selected: true } },
          context: [{ description: "host-visible", value: "untrusted until projector" }],
          forwardedProps: { untrusted: true },
          tools: [{ name: "pick_file", description: "client action", parameters: { type: "object" } }],
          messages: [
            { id: "developer-raw", role: "developer", content: "client supplied" },
            { id: "system-raw", role: "system", content: "client supplied" },
            {
              id: "user-raw",
              role: "user",
              content: [
                { type: "text", text: "choose a file" },
                { type: "image", source: { type: "data", value: "aGVsbG8=", mimeType: "image/png" } },
              ],
            },
            {
              id: "assistant-raw",
              role: "assistant",
              content: "calling client",
              toolCalls: [
                { id: "client-call-1", type: "function", function: { name: "pick_file", arguments: "{}" }, encryptedValue: "opaque" },
              ],
            },
            { id: "tool-raw", role: "tool", toolCallId: "client-call-1", content: "picked" },
            { id: "activity-raw", role: "activity", activityType: "preview", content: { visible: true } },
            { id: "reasoning-raw", role: "reasoning", content: "opaque", encryptedValue: "opaque" },
          ],
        }),
      ),
    );
    assert.equal(response.status, 200);
    assert.ok((await events(response)).some((item) => item.type === EventType.TEXT_MESSAGE_CONTENT && item.delta === "continued"));
    assert.deepEqual(selected, [{ name: "pick_file", execution: "client" }]);
    assert.equal(calls, 0, "a client Tool schema never becomes a Prism ToolDefinition");
    assert.deepEqual(
      (await session!.entries()).flatMap((entry) => (entry.message?.id ? [entry.message.id] : [])),
      ["developer-1", "tool-result-1", "user-2"],
    );
  });

  it("works with official HttpAgent over SSE and publishes truthful capabilities", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("http-ready");
          yield providerDone();
        },
      },
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "http-session" }),
    });
    const client = new HttpAgent({
      url: "https://example.test/ag-ui",
      threadId: "thread-1",
      initialMessages: [{ id: "client-user", role: "user", content: "hello" }],
      initialState: {},
      fetch: (_url, init) =>
        handler(
          new Request("https://example.test/ag-ui", {
            method: "POST",
            headers: init.headers,
            body: init.body,
            signal: init.signal,
          }),
        ),
    });
    await client.runAgent({ runId: "http-run" });
    assert.ok(client.messages.some((message) => message.role === "assistant" && message.content === "http-ready"));
    assert.deepEqual(handler.capabilities.transport, { streaming: true, resumable: false });
    assert.throws(
      () =>
        createAgUiHandler({
          authorize: () => authorization,
          sessionFactory: () => agent.createSession(),
          capabilities: { transport: { websocket: true } },
        }),
      /Unsupported AG-UI transport/,
    );
  });

  it("maps a durable interrupt, verifies exact resume correlation, then resumes once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let writes = 0;
    let turn = 0;
    let suspended: AgentRunRef | undefined;
    const agent = createAgent({
      id: "approval-agent",
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) yield { type: "tool_call" as const, call: toolCallContent("write-1", "write", { value: "approved" }) };
          else yield providerTextDelta("resumed");
          yield providerDone();
        },
      },
      tools: [
        { name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "write-1", name: "write", value: ++writes }) },
      ],
    });
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: () => ({ agent, definitionRevision: "1" }),
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "approval-session" }),
      lifecycle,
      resolveRun: () => (suspended ? { ref: suspended, agentId: "approval-agent" } : undefined),
      onSuspended: ({ run }) => {
        suspended = run.ref;
      },
    });

    const interrupted = await events(await handler(request(body())));
    const finish = interrupted.at(-1);
    assert.equal(finish.type, EventType.RUN_FINISHED);
    assert.equal(finish.outcome.type, "interrupt");
    assert.equal(writes, 0);

    const resumed = await events(
      await handler(
        request(
          body({
            runId: "run-2",
            parentRunId: "run-1",
            messages: [],
            resume: [{ interruptId: finish.outcome.interrupts[0].id, status: "resolved", payload: { decision: "approve" } }],
          }),
        ),
      ),
    );
    assert.equal(writes, 1);
    assert.ok(resumed.some((item) => item.type === EventType.TEXT_MESSAGE_CONTENT && item.delta === "resumed"));
    assert.equal(resumed.at(-1).type, EventType.RUN_FINISHED);

    const stale = await handler(
      request(
        body({
          runId: "run-3",
          parentRunId: "run-1",
          messages: [],
          resume: [{ interruptId: "run-1:999", status: "resolved", payload: { decision: "approve" } }],
        }),
      ),
    );
    assert.equal(stale.status, 400);
    assert.equal(writes, 1);
  });

  it("carries the shared decision batch through interrupt metadata and resume input", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let writes = 0;
    let turn = 0;
    let suspended: AgentRunRef | undefined;
    const agent = createAgent({
      id: "batch-agent",
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("write-b1", "write", { value: 1 }) };
            yield { type: "tool_call" as const, call: toolCallContent("write-b2", "write", { value: 2 }) };
          } else {
            yield providerTextDelta("batch done");
          }
          yield providerDone();
        },
      },
      tools: [
        { name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "write-b1", name: "write", value: ++writes }) },
      ],
    });
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: () => ({ agent, definitionRevision: "1" }),
    });
    let receivedDecisions: readonly { readonly approvalId: string; readonly outcome: string }[] | undefined;
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "batch-session" }),
      lifecycle: {
        ...lifecycle,
        resumeStream: ((
          ref: AgentRunRef,
          resume: { decisions?: readonly { readonly approvalId: string; readonly outcome: string }[] },
          options: unknown,
        ) => {
          receivedDecisions = resume.decisions;
          return lifecycle.resumeStream(ref, resume as never, options as never);
        }) as never,
      },
      resolveRun: () => (suspended ? { ref: suspended, agentId: "batch-agent" } : undefined),
      onSuspended: ({ run }) => {
        suspended = run.ref;
      },
    });

    const interrupted = await events(await handler(request(body())));
    const finish = interrupted.at(-1);
    assert.equal(finish.type, EventType.RUN_FINISHED);
    assert.equal(finish.outcome.type, "interrupt");
    // The fallback interrupt carries the batch in metadata for the client.
    const batch = (finish.outcome.interrupts[0].metadata as { pendingDecisions?: readonly { approvalId: string }[] }).pendingDecisions;
    assert.equal(batch?.length, 2);
    assert.equal(writes, 0);

    const resumed = await events(
      await handler(
        request(
          body({
            runId: "run-2",
            parentRunId: "run-1",
            messages: [],
            resume: [
              {
                interruptId: finish.outcome.interrupts[0].id,
                status: "resolved",
                payload: { decisions: batch!.map((decision) => ({ approvalId: decision.approvalId, outcome: "allow_once" })) },
              },
            ],
          }),
        ),
      ),
    );
    assert.equal(receivedDecisions?.length, 2);
    assert.equal(receivedDecisions?.[0]?.outcome, "allow_once");
    assert.equal(writes, 2);
    assert.ok(resumed.some((item) => item.type === EventType.TEXT_MESSAGE_CONTENT && item.delta === "batch done"));

    // Malformed batch input fails closed at the boundary.
    const bad = await handler(
      request(
        body({
          runId: "run-3",
          parentRunId: "run-1",
          messages: [],
          resume: [
            { interruptId: finish.outcome.interrupts[0].id, status: "resolved", payload: { decisions: [{ outcome: "allow_once" }] } },
          ],
        }),
      ),
    );
    assert.equal(bad.status, 400);
  });

  it("projects multiple bounded interrupts through one durable CAS decision", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let writes = 0;
    let turn = 0;
    let suspended: AgentRunRef | undefined;
    const agent = createAgent({
      id: "aggregate-approval-agent",
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) yield { type: "tool_call" as const, call: toolCallContent("write-aggregate", "write", {}) };
          else yield providerTextDelta("approved");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "write",
          parameters: { type: "object" },
          execute: () => ({ toolCallId: "write-aggregate", name: "write", value: ++writes }),
        },
      ],
    });
    const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent, definitionRevision: "1" }) });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "aggregate-session" }),
      lifecycle,
      resolveRun: () => (suspended ? { ref: suspended, agentId: "aggregate-approval-agent" } : undefined),
      onSuspended: ({ run }) => {
        suspended = run.ref;
      },
      projection: {
        interrupt: ({ version }) => [
          { id: `run-1:${version}`, reason: "write approval", expiresAt: "2030-01-01T00:00:00.000Z", metadata: { policy: "write" } },
          { id: "policy-1", reason: "business approval", metadata: { policy: "business" } },
        ],
      },
      interrupts: {
        resume: ({ request: value, expectedInterruptId }) => {
          assert.deepEqual(
            value.resume.map((entry) => entry.interruptId),
            [expectedInterruptId, "policy-1"],
          );
          return { decision: "approve" };
        },
      },
    });
    const interrupted = await events(await handler(request(body())));
    const finish = interrupted.at(-1);
    assert.equal(finish.outcome.interrupts.length, 2);
    assert.equal(finish.outcome.interrupts[0].expiresAt, "2030-01-01T00:00:00.000Z");
    await events(
      await handler(
        request(
          body({
            runId: "run-2",
            parentRunId: "run-1",
            messages: [],
            resume: [
              { interruptId: finish.outcome.interrupts[0].id, status: "resolved", payload: { decision: "approve" } },
              { interruptId: "policy-1", status: "resolved", payload: { approved: true } },
            ],
          }),
        ),
      ),
    );
    assert.equal(writes, 1);
  });

  it("denies edited interrupt arguments instead of mutating a persisted call", async () => {
    let decision: string | undefined;
    const lifecycle = {
      status: async () => ({
        state: {
          schemaVersion: 1 as const,
          agentId: "agent-1",
          definitionRevision: "1",
          fingerprint: "fingerprint",
          runId: "stored-run",
          sessionId: "session-1",
          model: { provider: "mock", model: "mock" },
          status: "suspended" as const,
        },
        version: 1,
      }),
      async resume(_ref: AgentRunRef, value: { decision?: string }) {
        decision = value.decision;
        return { sessionId: "session-1", runId: "stored-run", status: "denied" as const, text: "", content: [] };
      },
      async *resumeStream(_ref: AgentRunRef, value: { decision?: string }) {
        decision = value.decision;
        yield {
          type: "agent_denied" as const,
          sessionId: "session-1",
          runId: "stored-run",
          interruption: { kind: "tool_approval" as const, reason: "approval" },
          version: 2,
        };
      },
    };
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => {
        throw new Error("resume does not open a session");
      },
      lifecycle,
      resolveRun: () => ({ ref: { sessionId: "session-1", runId: "stored-run" } }),
    });
    const response = await handler(
      request(
        body({
          parentRunId: "run-1",
          messages: [],
          resume: [{ interruptId: "run-1:1", status: "resolved", payload: { decision: "approve", editedArgs: { path: "x" } } }],
        }),
      ),
    );
    assert.equal(response.status, 200);
    assert.equal(decision, "deny");
    assert.ok((await events(response)).some((item) => item.type === EventType.RUN_ERROR));
  });

  it("advertises and executes approveWithEdits mapping edited arguments to RunDecision", async () => {
    let receivedResume: any;
    const lifecycle = {
      status: async () => ({
        state: {
          schemaVersion: 1 as const,
          agentId: "agent-1",
          definitionRevision: "1",
          fingerprint: "fingerprint",
          runId: "stored-run",
          sessionId: "session-1",
          model: { provider: "mock", model: "mock" },
          status: "suspended" as const,
          interruption: {
            kind: "tool_approval" as const,
            reason: "tool needs review",
            toolCallId: "call-1",
            pendingDecisions: [
              {
                approvalId: "approval-1",
                kind: "tool_approval" as const,
                toolCallId: "call-1",
                scope: { toolName: "write_file" },
                reason: "tool needs review",
              },
            ],
          },
        },
        version: 2,
      }),
      async resume(_ref: AgentRunRef, value: any) {
        receivedResume = value;
        return { sessionId: "session-1", runId: "stored-run", status: "succeeded" as const, text: "", content: [] };
      },
      async *resumeStream(_ref: AgentRunRef, value: any) {
        receivedResume = value;
        yield {
          type: "agent_finished" as const,
          sessionId: "session-1",
          runId: "stored-run",
        };
      },
    };

    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => {
        throw new Error("resume does not open a session");
      },
      capabilities: { humanInTheLoop: { approveWithEdits: true } },
      lifecycle,
      resolveRun: () => ({ ref: { sessionId: "session-1", runId: "stored-run" } }),
    });

    assert.equal(handler.capabilities.humanInTheLoop?.approveWithEdits, true);
    assert.equal(handler.capabilities.humanInTheLoop?.approvals, true);

    const response = await handler(
      request(
        body({
          parentRunId: "run-1",
          messages: [],
          resume: [
            {
              interruptId: "run-1:2",
              status: "resolved",
              payload: { decision: "approve", editedArgs: { path: "modified.txt", content: "hello" } },
            },
          ],
        }),
      ),
    );
    assert.equal(response.status, 200);
    await events(response);
    assert.ok(receivedResume);
    assert.equal(receivedResume.expectedVersion, 2);
    assert.equal(receivedResume.decisions?.length, 1);
    assert.equal(receivedResume.decisions[0].approvalId, "approval-1");
    assert.equal(receivedResume.decisions[0].outcome, "allow_once");
    assert.deepEqual(receivedResume.decisions[0].modifiedArguments, { path: "modified.txt", content: "hello" });

    // Also supports explicit approvalId and modifiedArguments key directly
    const response2 = await handler(
      request(
        body({
          parentRunId: "run-1",
          messages: [],
          resume: [
            {
              interruptId: "run-1:2",
              status: "resolved",
              payload: {
                decision: "approve",
                approvalId: "approval-1",
                modifiedArguments: { path: "direct.txt" },
                reason: "reviewer edit",
              },
            },
          ],
        }),
      ),
    );
    assert.equal(response2.status, 200);
    await events(response2);
    assert.deepEqual(receivedResume.decisions[0].modifiedArguments, { path: "direct.txt" });
    assert.equal(receivedResume.decisions[0].reason, "reviewer edit");
  });

  it("enforces fail-closed validation on malformed or illegal edited resumes", async () => {
    const lifecycle = {
      status: async () => ({
        state: {
          schemaVersion: 1 as const,
          agentId: "agent-1",
          definitionRevision: "1",
          fingerprint: "fingerprint",
          runId: "stored-run",
          sessionId: "session-1",
          model: { provider: "mock", model: "mock" },
          status: "suspended" as const,
          interruption: {
            kind: "tool_approval" as const,
            reason: "tool needs review",
            toolCallId: "call-1",
            pendingDecisions: [
              {
                approvalId: "approval-1",
                kind: "tool_approval" as const,
                toolCallId: "call-1",
                scope: { toolName: "write_file" },
                reason: "tool needs review",
              },
            ],
          },
        },
        version: 2,
      }),
      async resume() {
        throw new Error("should not be called");
      },
      async *resumeStream() {
        throw new Error("should not be called");
      },
    };

    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => {
        throw new Error("resume does not open a session");
      },
      capabilities: { humanInTheLoop: { approveWithEdits: true } },
      lifecycle,
      resolveRun: () => ({ ref: { sessionId: "session-1", runId: "stored-run" } }),
    });

    // 1. Non-object editedArgs
    for (const badEdited of ["not-object", 123, true, [1, 2, 3]]) {
      const resp = await handler(
        request(
          body({
            parentRunId: "run-1",
            messages: [],
            resume: [{ interruptId: "run-1:2", status: "resolved", payload: { decision: "approve", editedArgs: badEdited } }],
          }),
        ),
      );
      assert.equal(resp.status, 400);
    }

    // 2. Oversize edited arguments (> 64 KiB fails closed with 400 or 413 payload too large)
    const big = { big: "x".repeat(70_000) };
    const oversizeResp = await handler(
      request(
        body({
          parentRunId: "run-1",
          messages: [],
          resume: [{ interruptId: "run-1:2", status: "resolved", payload: { decision: "approve", editedArgs: big } }],
        }),
      ),
    );
    assert.ok(oversizeResp.status === 400 || oversizeResp.status === 413);

    // 3. Mismatched / foreign approvalId
    const foreignResp = await handler(
      request(
        body({
          parentRunId: "run-1",
          messages: [],
          resume: [
            {
              interruptId: "run-1:2",
              status: "resolved",
              payload: { decision: "approve", approvalId: "foreign-approval", editedArgs: { a: 1 } },
            },
          ],
        }),
      ),
    );
    assert.equal(foreignResp.status, 400);

    // 4. Stale expectedVersion in payload
    const staleResp = await handler(
      request(
        body({
          parentRunId: "run-1",
          messages: [],
          resume: [
            {
              interruptId: "run-1:2",
              status: "resolved",
              payload: { decision: "approve", expectedVersion: 999, editedArgs: { a: 1 } },
            },
          ],
        }),
      ),
    );
    assert.equal(staleResp.status, 400);

    // 5. Unknown keys in payload
    const unknownKeyResp = await handler(
      request(
        body({
          parentRunId: "run-1",
          messages: [],
          resume: [
            {
              interruptId: "run-1:2",
              status: "resolved",
              payload: { decision: "approve", editedArgs: { a: 1 }, hackedProperty: true },
            },
          ],
        }),
      ),
    );
    assert.equal(unknownKeyResp.status, 400);
  });

  it("rejects approveWithEdits capability when lifecycle or resolveRun is omitted", async () => {
    assert.throws(
      () =>
        createAgUiHandler({
          authorize: () => authorization,
          sessionFactory: () => ({ id: "s" }) as any,
          capabilities: { humanInTheLoop: { approveWithEdits: true } },
        }),
      /human-in-the-loop capability requires lifecycle and resolveRun/,
    );
  });

  it("supports approveWithEdits through custom interrupts.resume hook", async () => {
    let receivedResume: any;
    const lifecycle = {
      status: async () => ({
        state: {
          schemaVersion: 1 as const,
          agentId: "agent-1",
          definitionRevision: "1",
          fingerprint: "fingerprint",
          runId: "stored-run",
          sessionId: "session-1",
          model: { provider: "mock", model: "mock" },
          status: "suspended" as const,
          interruption: {
            kind: "tool_approval" as const,
            reason: "tool needs review",
            toolCallId: "call-1",
            pendingDecisions: [
              {
                approvalId: "approval-hook-1",
                kind: "tool_approval" as const,
                toolCallId: "call-1",
                scope: { toolName: "write_file" },
                reason: "tool needs review",
              },
            ],
          },
        },
        version: 3,
      }),
      async resume() {
        return { sessionId: "session-1", runId: "stored-run", status: "succeeded" as const, text: "", content: [] };
      },
      async *resumeStream(_ref: AgentRunRef, value: any) {
        receivedResume = value;
        yield { type: "agent_finished" as const, sessionId: "session-1", runId: "stored-run" };
      },
    };

    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => {
        throw new Error("resume does not open a session");
      },
      capabilities: { humanInTheLoop: { approveWithEdits: true } },
      lifecycle,
      resolveRun: () => ({ ref: { sessionId: "session-1", runId: "stored-run" } }),
      interrupts: {
        resume: () => {
          return {
            decision: "approve",
            approvalId: "approval-hook-1",
            modifiedArguments: { transformed: true },
            expectedVersion: 3,
          };
        },
      },
    });

    const response = await handler(
      request(
        body({
          parentRunId: "run-1",
          messages: [],
          resume: [{ interruptId: "run-1:3", status: "resolved", payload: { custom: "data" } }],
        }),
      ),
    );
    assert.equal(response.status, 200);
    await events(response);
    assert.ok(receivedResume);
    assert.equal(receivedResume.decisions[0].approvalId, "approval-hook-1");
    assert.deepEqual(receivedResume.decisions[0].modifiedArguments, { transformed: true });
  });

  it("follows a durable source from a cursor without opening a replica-local session", async () => {
    const source = createMemoryAgentEventSource();
    const owned = { tenantId: "tenant-1", userId: "user-1" };
    const record = (id: string, event: AgentEventRecord["event"], timestamp: string): AgentEventRecord => ({
      id,
      sessionId: "session-1",
      runId: "stored-run",
      type: event.type,
      timestamp,
      event,
      redacted: true,
      ...owned,
    });
    await source.append(
      record("event-1", { type: "agent_started", sessionId: "session-1", runId: "stored-run" }, "2026-07-22T00:00:00.000Z"),
    );
    const cursor = (await source.page({ ownership: owned, sessionId: "session-1", runId: "stored-run" })).items[0]!.cursor;
    let sessions = 0;
    const replay = createAgentEventSourceAgUiReplay(source, {
      resolveRun: () => ({ ref: { sessionId: "session-1", runId: "stored-run" } }),
      ownership: () => owned,
    });
    const handler = createAgUiHandler({
      authorize: () => ({ ownership: owned }),
      sessionFactory: () => {
        sessions += 1;
        throw new Error("durable replay must not open a session");
      },
      replay,
    });
    const response = await handler(request(body(), `?cursor=${encodeURIComponent(cursor)}`));
    const outputPromise = events(response);
    await source.append(
      record(
        "event-2",
        { type: "message_delta", sessionId: "session-1", runId: "stored-run", content: { type: "text", text: "live" } },
        "2026-07-22T00:00:01.000Z",
      ),
    );
    await source.append(
      record("event-3", { type: "agent_finished", sessionId: "session-1", runId: "stored-run" }, "2026-07-22T00:00:02.000Z"),
    );
    const output = await outputPromise;
    assert.deepEqual(
      output.map((item) => item.type),
      [EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END, EventType.RUN_FINISHED],
    );
    assert.equal(output[0].prismEventId, "event-2");
    assert.equal(typeof output[0].prismCursor, "string");
    assert.equal(output.at(-1).prismEventId, "event-3");
    assert.equal(sessions, 0);
  });

  it("replays one redacted terminal page without starting a new session", async () => {
    let queried: Record<string, unknown> | undefined;
    let sessions = 0;
    const replay = createPersistenceAgUiReplay(
      {
        queryEvents: async (query) => {
          queried = query as Record<string, unknown>;
          const records: AgentEventRecord[] = [
            {
              id: "event-1",
              sessionId: "session-1",
              runId: "stored-run",
              type: "agent_started",
              timestamp: "2026-07-22T00:00:00.000Z",
              event: { type: "agent_started", sessionId: "session-1", runId: "stored-run" },
              redacted: true,
            },
            {
              id: "event-2",
              sessionId: "session-1",
              runId: "stored-run",
              type: "agent_finished",
              timestamp: "2026-07-22T00:00:01.000Z",
              event: { type: "agent_finished", sessionId: "session-1", runId: "stored-run" },
              redacted: true,
            },
          ];
          return { items: records };
        },
      },
      {
        resolveRun: () => ({ ref: { sessionId: "session-1", runId: "stored-run" } }),
        ownership: (value: typeof authorization) => value.ownership,
      },
    );
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => {
        sessions += 1;
        throw new Error("terminal replay must not run");
      },
      replay,
    });
    const output = await events(await handler(request(body(), "?cursor=cursor-1")));
    assert.deepEqual(
      output.map((item) => item.type),
      [EventType.RUN_STARTED, EventType.RUN_FINISHED],
    );
    assert.deepEqual(
      output.map((item) => item.prismEventId),
      ["event-1", "event-2"],
    );
    assert.equal(sessions, 0);
    assert.deepEqual(queried, {
      sessionId: "session-1",
      runId: "stored-run",
      cursor: "cursor-1",
      limit: 100,
      order: "asc",
      userId: "user-1",
    });
  });
});
