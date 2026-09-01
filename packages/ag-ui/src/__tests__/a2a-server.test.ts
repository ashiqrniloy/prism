import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, AgentSession } from "@arnilo/prism";
import { createAgent, createMemoryAgentEventSource, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { type A2AAgentCard, type A2ATaskEvent, type A2ATaskLifecycle, createA2AClient } from "@arnilo/prism-core/runtime/supervisor";
import { type AgUiA2AServer, createAgUiA2AServer } from "../index.js";

const endpoint = "https://agent.example/a2a/v1";
const ownership = { tenantId: "tenant", userId: "user" };

const baseCard = (): A2AAgentCard => ({
  name: "Local Agent",
  description: "Local AG-UI-fronted agent",
  supportedInterfaces: [{ url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
  version: "1.0.0",
  capabilities: { streaming: true },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [],
});

const localAgent = () =>
  createAgent({
    model: { provider: "mock", model: "test" },
    provider: createMockProvider([providerTextDelta("hello from local agent"), providerDone()]),
  }).createSession();

const message = (text = "question", extra: Record<string, unknown> = {}) => ({
  role: "user" as const,
  messageId: "m1",
  parts: [{ text }],
  ...extra,
});

function clientFor(server: AgUiA2AServer) {
  return createA2AClient({
    endpoint,
    allowedOrigins: ["https://agent.example"],
    fetch: (input, init) => server(new Request(input, init)),
  });
}

async function collect(events: AsyncIterable<A2ATaskEvent>): Promise<A2ATaskEvent[]> {
  const out: A2ATaskEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function taskText(task: { readonly artifacts?: readonly { readonly parts: readonly { readonly text?: string }[] }[] } | undefined): string {
  return (task?.artifacts ?? [])
    .flatMap((artifact) => artifact.parts)
    .map((part) => part.text ?? "")
    .join("");
}

describe("createAgUiA2AServer", () => {
  it("SendMessage runs the local agent and returns a completed task with text artifacts", async () => {
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: () => localAgent(),
    });
    const task = await clientFor(server).sendMessage(message("question"));
    assert.equal(task.status.state, "TASK_STATE_COMPLETED");
    assert.ok(taskText(task).includes("hello from local agent"));
  });

  it("SendStreamingMessage streams artifact updates then a terminal task", async () => {
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: () => localAgent(),
    });
    const client = clientFor(server);
    const started = await client.sendMessage(message("question"), { returnImmediately: true });
    assert.equal(started.status.state, "TASK_STATE_WORKING");
    const events = await collect(client.subscribeToTask(started.id));
    assert.ok("task" in events[0]! && events[0].task.status.state === "TASK_STATE_WORKING");
    const last = events[events.length - 1];
    assert.ok("task" in last && last.task.status.state === "TASK_STATE_COMPLETED");
    const streamed = events
      .filter((event): event is Extract<A2ATaskEvent, { artifactUpdate: unknown }> => "artifactUpdate" in event)
      .flatMap((event) => event.artifactUpdate.artifact.parts)
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
    assert.ok(streamed.includes("hello from local agent"));
    assert.ok(taskText(last.task).includes("hello from local agent"));
  });

  it("passes ownership, threadId/contextId, and taskId/runId to the AG-UI surfaces", async () => {
    let seenFactory: { authorization: unknown; threadId: string; input: unknown } | undefined;
    let seenProject: { request: unknown; authorization: unknown } | undefined;
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: (input) => {
        seenFactory = input;
        return localAgent();
      },
      input: {
        project: (input) => {
          seenProject = { request: input.request, authorization: input.authorization };
          return { messages: "projected question" };
        },
      },
    });
    await clientFor(server).sendMessage(message("question", { contextId: "ctx-9" }));
    assert.deepEqual((seenProject!.authorization as { ownership: unknown }).ownership, ownership);
    assert.equal((seenProject!.request as { threadId: string }).threadId, "ctx-9");
    assert.deepEqual((seenFactory!.authorization as { ownership: unknown }).ownership, ownership);
    assert.equal(seenFactory!.threadId, "ctx-9");
    assert.equal((seenFactory!.input as { messages: unknown }).messages, "projected question");
  });

  it("routes non-text parts to input.project via forwardedProps and keeps them out of the message", async () => {
    let forwarded: unknown;
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: () => localAgent(),
      parts: { allowData: true },
      input: {
        project: (input) => {
          forwarded = (input.request as { forwardedProps: unknown }).forwardedProps;
          return { messages: "projected" };
        },
      },
    });
    await clientFor(server).sendMessage(message("question", { parts: [{ text: "question" }, { data: { kind: "chart" } }] }));
    const payload = (forwarded as { a2a: { parts: readonly unknown[] } }).a2a;
    assert.equal(payload.parts.length, 1);
    assert.deepEqual(payload.parts[0], { data: { kind: "chart" } });
  });

  it("rejects parts not allowed by the host parts policy", async () => {
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: () => localAgent(),
    });
    await assert.rejects(clientFor(server).sendMessage(message("question", { parts: [{ text: "x" }, { data: { a: 1 } }] })));
  });

  it("fails closed when authorization is refused", async () => {
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => false,
      sessionFactory: () => localAgent(),
    });
    await assert.rejects(clientFor(server).sendMessage(message()));
  });

  it("GetTask and ListTasks cover live tasks; cancel aborts the run", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stub = (): AgentSession =>
      ({
        id: "session-1",
        leafId: "leaf-1",
        stream: async function* (_input: unknown, options: { signal: AbortSignal }) {
          yield { type: "agent_started", sessionId: "session-1", runId: "run-1" } as AgentEvent;
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => reject(options.signal.reason);
            options.signal.addEventListener("abort", onAbort, { once: true });
            void gate.then(() => {
              options.signal.removeEventListener("abort", onAbort);
              resolve();
            });
          });
          if (options.signal.aborted) throw options.signal.reason;
          yield { type: "agent_finished", sessionId: "session-1", runId: "run-1" } as AgentEvent;
        },
      }) as unknown as AgentSession;
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: () => stub(),
      selectTaskId: () => "task-fixed",
    });
    const client = clientFor(server);
    const started = await client.sendMessage(message(), { returnImmediately: true });
    assert.equal(started.id, "task-fixed");
    const stream = collect(client.subscribeToTask("task-fixed"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const canceled = await client.cancelTask("task-fixed");
    assert.equal(canceled.status.state, "TASK_STATE_CANCELED");
    const events = await stream;
    const last = events[events.length - 1];
    assert.ok("task" in last && last.task.status.state === "TASK_STATE_CANCELED");
    assert.equal((await client.getTask("task-fixed")).status.state, "TASK_STATE_CANCELED");
    const page = await client.listTasks({ contextId: (await client.getTask("task-fixed")).contextId });
    assert.ok(page.tasks.some((task) => task.id === "task-fixed"));
    release!();
  });

  it("replays finished runs from the durable source with cursor event ids", async () => {
    const source = createMemoryAgentEventSource();
    const record = (id: string, event: AgentEvent): Parameters<typeof source.append>[0] => ({
      id,
      sessionId: "session-d",
      runId: "run-d",
      type: event.type,
      timestamp: new Date().toISOString(),
      event,
      redacted: true,
      tenantId: "tenant",
      userId: "user",
    });
    await source.append(record("e1", { type: "agent_started", sessionId: "session-d", runId: "run-d" }));
    await source.append(
      record("e2", {
        type: "message_delta",
        sessionId: "session-d",
        runId: "run-d",
        content: { type: "text", text: "durable hello" },
      }),
    );
    await source.append(record("e3", { type: "agent_finished", sessionId: "session-d", runId: "run-d" }));
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: () => localAgent(),
      durable: {
        source,
        resolveTask: async ({ id }) =>
          id === "task-d"
            ? {
                task: {
                  id,
                  contextId: "ctx-d",
                  status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() },
                },
                run: { sessionId: "session-d", runId: "run-d" },
              }
            : undefined,
      },
    });
    const client = clientFor(server);
    const events = await collect(client.subscribeToTask("task-d"));
    assert.ok("task" in events[0]! && events[0].task.id === "task-d");
    const text = events
      .filter((event): event is Extract<A2ATaskEvent, { artifactUpdate: unknown }> => "artifactUpdate" in event)
      .flatMap((event) => event.artifactUpdate.artifact.parts)
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
    assert.ok(text.includes("durable hello"));
    assert.ok(events.slice(1).every((event) => "eventId" in event && typeof event.eventId === "string"));
  });

  it("resumes a durable stream after a cursor without re-emitting earlier events", async () => {
    const source = createMemoryAgentEventSource();
    const record = (id: string, event: AgentEvent): Parameters<typeof source.append>[0] => ({
      id,
      sessionId: "session-d",
      runId: "run-d",
      type: event.type,
      timestamp: new Date().toISOString(),
      event,
      redacted: true,
      tenantId: "tenant",
      userId: "user",
    });
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: () => localAgent(),
      durable: {
        source,
        resolveTask: async ({ id }) =>
          id === "task-d2"
            ? {
                task: {
                  id,
                  contextId: "ctx-d",
                  status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() },
                },
                run: { sessionId: "session-d", runId: "run-d" },
              }
            : undefined,
      },
    });
    const client = clientFor(server);
    await source.append(record("e1", { type: "agent_started", sessionId: "session-d", runId: "run-d" }));
    await source.append(
      record("e2", {
        type: "message_delta",
        sessionId: "session-d",
        runId: "run-d",
        content: { type: "text", text: "first" },
      }),
    );
    // Run is still in progress: consume the first two events, then close the subscriber.
    const iterator = client.subscribeToTask("task-d2")[Symbol.asyncIterator]();
    const first: A2ATaskEvent[] = [];
    first.push((await iterator.next()).value);
    first.push((await iterator.next()).value);
    await iterator.return?.();
    const cursor = first[first.length - 1]!.eventId;
    await source.append(
      record("e3", {
        type: "message_delta",
        sessionId: "session-d",
        runId: "run-d",
        content: { type: "text", text: "second" },
      }),
    );
    await source.append(record("e5", { type: "agent_finished", sessionId: "session-d", runId: "run-d" }));
    const resumed = await collect(client.subscribeToTask("task-d2", { afterEventId: cursor }));
    const text = resumed
      .filter((event): event is Extract<A2ATaskEvent, { artifactUpdate: unknown }> => "artifactUpdate" in event)
      .flatMap((event) => event.artifactUpdate.artifact.parts)
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
    assert.ok(text.includes("second"));
    assert.ok(!text.includes("first"));
  });

  it("host-provided tasks lifecycle overrides the built-in one", async () => {
    const calls: string[] = [];
    const tasks: A2ATaskLifecycle = {
      start: async ({ message }) => {
        calls.push(`start:${message.messageId}`);
        return {
          id: "task-host",
          contextId: "ctx-host",
          status: { state: "TASK_STATE_COMPLETED", timestamp: new Date().toISOString() },
          artifacts: [{ artifactId: "a1", parts: [{ text: "host result" }] }],
        };
      },
      get: async () => undefined,
      list: async () => ({ tasks: [] }),
      cancel: async () => undefined,
      subscribe: async function* () {},
    };
    const server = await createAgUiA2AServer({
      card: baseCard(),
      authorize: () => ({ ownership }),
      sessionFactory: () => localAgent(),
      tasks,
    });
    const task = await clientFor(server).sendMessage(message("hi"));
    assert.equal(task.status.state, "TASK_STATE_COMPLETED");
    assert.ok(taskText(task).includes("host result"));
    assert.deepEqual(calls, ["start:m1"]);
  });
});
