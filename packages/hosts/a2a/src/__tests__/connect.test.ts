import { afterAll, describe, expect, test } from "bun:test";
import {
  type Agent,
  type AgentEvent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type HostUi,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import workflows, {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  startWorkflow,
  type WorkflowRun,
} from "@arnilo/prism-extensions/workflows";
import { type A2AAgentCard, type A2AAuthorization, A2AClientError, A2ALiteralSecretError, connectA2A, serveA2A } from "../index.js";

const TOKEN = "a2a-test-secret-7f3c9e";
process.env.PRISM_A2A_TEST_TOKEN = TOKEN;
const TOKEN_REF = "env:PRISM_A2A_TEST_TOKEN";

const caller: A2AAuthorization = { principal: { kind: "agent", id: "client" }, ownership: { tenantId: "t1" } };

function cardFor(url: string): A2AAgentCard {
  return {
    name: "Reviewer",
    description: "Reviews diffs.",
    version: "1.0.0",
    supportedInterfaces: [{ url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [{ id: "review", name: "Review", description: "Reviews a diff.", tags: ["code"] }],
  };
}

interface Peer {
  readonly base: string;
  readonly port: number;
  close(): Promise<void>;
}

const open: Peer[] = [];
afterAll(async () => {
  for (const peer of open) await peer.close();
});

/** A real `serveA2A` peer on a loopback port. `interfaceHost` lets a test put the card's endpoint on another origin. */
function servePeer(agent: Agent, interfaceHost = "127.0.0.1"): Peer {
  let handle: ReturnType<typeof serveA2A> | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => (handle as ReturnType<typeof serveA2A>)(request) });
  const base = `http://127.0.0.1:${server.port}`;
  handle = serveA2A(agent, {
    card: cardFor(`http://${interfaceHost}:${server.port}/a2a`),
    authorize: ({ request }) => (request.headers.get("authorization") === `Bearer ${TOKEN}` ? caller : false),
  });
  const peer = {
    base,
    port: server.port as number,
    async close() {
      await handle?.close();
      server.stop(true);
    },
  };
  open.push(peer);
  return peer;
}

function textAgent(options: { delayMs?: number; fail?: string } = {}): Promise<Agent> {
  return createAgent({
    id: "peer-text",
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("peer-provider", [
        {
          id: "mock",
          async *generate(request) {
            if (options.fail) throw new Error(options.fail);
            yield providerTextDelta("hello ");
            if (options.delayMs) {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, options.delayMs);
                request.signal?.addEventListener("abort", () => {
                  clearTimeout(timer);
                  reject(new Error("aborted"));
                });
              });
            }
            yield providerTextDelta("from the peer");
            yield providerDone();
          },
        },
      ]),
    ],
  });
}

function approvalAgent(executed: string[]): Promise<Agent> {
  let turn = 0;
  return createAgent({
    id: "peer-approvals",
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("peer-provider", [
        {
          id: "mock",
          async *generate() {
            if (++turn % 2 === 1) {
              yield { type: "tool_call" as const, call: toolCallContent(`call-${turn}`, "publish_draft", { path: "a.txt" }) };
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

const collect = async (iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> => {
  const out: AgentEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
};

async function rejects(promise: Promise<unknown> | (() => unknown), code: string): Promise<void> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    expect(error).toBeInstanceOf(A2AClientError);
    expect((error as A2AClientError).code).toBe(code as never);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("connectA2A", () => {
  test("proxy_runs_against_an_in_process_a2a_server", async () => {
    const peer = servePeer(await textAgent());
    const remote = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true });
    expect(remote.id).toBe("Reviewer");
    const session = await remote.session();
    const result = await session.run("review this");
    expect(result.status).toBe("completed");
    expect(result.text).toBe("hello from the peer");
    expect(result.sessionId).toBe(session.id);
    expect((await session.messages()).map((message) => message.role)).toEqual(["user", "assistant"]);
    // A second task on the same context.
    expect((await session.run("again")).status).toBe("completed");
    expect(remote.inspect()).toMatchObject({ a2a: { protocolVersion: "1.0", streaming: true } });
    await remote.dispose();
  });

  test("streamed_updates_become_external_origin_events", async () => {
    const peer = servePeer(await textAgent());
    const remote = await connectA2A({ url: `${peer.base}/.well-known/agent-card.json`, token: TOKEN_REF }, { allowLoopback: true });
    const session = await remote.session();
    const watched = collect(session.subscribe());
    const events = await collect(session.stream("go"));
    const types = events.map((event) => event.type);
    expect(types[0]).toBe("run.started");
    expect(types).toContain("message.delta");
    expect(types.slice(-2)).toEqual(["message.completed", "run.completed"]);
    for (const event of events) {
      expect(event.origin).toMatchObject({ kind: "external", executedBy: "external", agent: "Reviewer", remote: peer.base });
    }
    expect((await watched).map((event) => event.type)).toEqual(types);
    await remote.dispose();
  });

  test("input_required_becomes_a_suspended_result_and_resumes", async () => {
    const executed: string[] = [];
    const peer = servePeer(await approvalAgent(executed));
    const remote = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true });
    const session = await remote.session();
    const suspended = await session.run("publish it");
    expect(suspended.status).toBe("suspended");
    expect(suspended.pending).toHaveLength(1);
    expect(suspended.pending?.[0]).toMatchObject({ kind: "tool_approval", scope: { toolName: "publish_draft" } });
    expect(executed).toHaveLength(0);
    const approvalId = suspended.pending?.[0]?.approvalId as string;
    const resumed = await collect(session.resume([{ approvalId, outcome: "allow_once" }]));
    expect(resumed[0]).toMatchObject({ type: "run.started", resumed: true, runId: suspended.runId });
    expect(resumed.at(-1)).toMatchObject({ type: "run.completed", status: "completed" });
    expect(executed).toHaveLength(1);
    await rejects(async () => session.resume([{ approvalId, outcome: "allow_once" }]), "a2a_no_pending_task");

    // With `host.ui`, the decision is asked locally and the task continues in the same run.
    const asked: string[] = [];
    const ui: HostUi = {
      async request(request) {
        asked.push(`${request.kind}:${"title" in request ? request.title : ""}`);
        return { status: "answered", value: true } as never;
      },
    };
    const answered = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true, host: { ui } });
    const result = await (await answered.session()).run("publish again");
    expect(result.status).toBe("completed");
    expect(result.text).toBe("published");
    expect(asked).toEqual(["confirm:Approve publish_draft"]);
    expect(executed).toHaveLength(2);
    await remote.dispose();
    await answered.dispose();
  });

  test("abort_cancels_the_remote_task", async () => {
    const peer = servePeer(await textAgent({ delayMs: 5_000 }));
    const remote = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true });
    const session = await remote.session();
    const controller = new AbortController();
    const pending = session.run("slow", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    const result = await pending;
    expect(result.status).toBe("aborted");
    expect(result.error?.code).toBe("aborted");
    // The context is free again: the peer canceled the task.
    const again = session.run("slow");
    setTimeout(() => session.abort(), 100);
    expect((await again).status).toBe("aborted");
    await remote.dispose();
  });

  test("stream_cut_at_max_stream_ms_recovers_and_blocking_peer_works", async () => {
    const peer = servePeer(await textAgent({ delayMs: 300 }));
    // The local stream bound ends the response early; the proxy reads the task back and follows it to the end.
    const bounded = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true, limits: { maxStreamMs: 50 } });
    const result = await (await bounded.session()).run("go");
    expect(result.status).toBe("completed");
    expect(result.text).toContain("hello ");
    await bounded.dispose();
    // A card without `streaming` uses blocking `SendMessage`.
    const card = { ...cardFor(`${peer.base}/a2a`), capabilities: { streaming: false } };
    const blocking = await connectA2A({ url: peer.base, token: TOKEN_REF, card }, { allowLoopback: true });
    const events = await collect((await blocking.session()).stream("go"));
    expect(events.map((event) => event.type)).toEqual(["run.started", "message.completed", "run.completed"]);
    expect(blocking.inspect()).toMatchObject({ a2a: { streaming: false } });
    await blocking.dispose();
  });

  test("unsupported_members_fail_typed", async () => {
    const peer = servePeer(await textAgent());
    const remote = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true });
    await rejects(async () => remote.commands.list(), "a2a_unsupported");
    await rejects(remote.commands.run("x"), "a2a_unsupported");
    await rejects(remote.reload(), "a2a_unsupported");
    await rejects(remote.models.list(), "a2a_unsupported");
    await rejects(remote.sessions.list(), "a2a_unsupported");
    const session = await remote.session();
    await rejects(session.fork(), "a2a_unsupported");
    await rejects(session.continue(), "a2a_unsupported");
    await rejects(session.entries(), "a2a_unsupported");
    await rejects(async () => session.steer("x"), "a2a_unsupported");
    await rejects(async () => session.resume([]), "a2a_no_pending_task");
    await rejects(remote.session({ id: "not a context id" }), "a2a_unsupported");
    await remote.dispose();
  });

  test("card_endpoint_on_another_origin_is_refused", async () => {
    // The fetched card names its endpoint on `localhost`, a different origin than the card URL's `127.0.0.1`.
    const peer = servePeer(await textAgent(), "localhost");
    await rejects(connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true }), "a2a_invalid_card");
    // A supplied card is held to the same rule.
    await rejects(
      connectA2A({ url: "https://agents.example.test/", card: cardFor("https://elsewhere.example.test/a2a") }),
      "a2a_invalid_card",
    );
    // The host can list the other origin; the card is then accepted (`localhost` may resolve to ::1 here, so no call is made).
    const remote = await connectA2A(
      { url: peer.base, token: TOKEN_REF },
      { allowLoopback: true, allowedOrigins: [`http://localhost:${peer.port}`] },
    );
    expect((remote.inspect() as unknown as { a2a: { endpoint: string } }).a2a.endpoint).toBe(`http://localhost:${peer.port}/a2a`);
    await remote.dispose();
  });

  test("private_address_is_refused_unless_allowed", async () => {
    await rejects(connectA2A({ url: "https://10.0.0.5/" }), "a2a_transport");
    await rejects(connectA2A({ url: "https://169.254.169.254/", card: cardFor("https://169.254.169.254/a2a") }), "a2a_transport");
    const peer = servePeer(await textAgent());
    await rejects(connectA2A({ url: peer.base, token: TOKEN_REF }), "a2a_transport");
    const allowed = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true });
    await allowed.dispose();
  });

  test("literal_token_fails_at_connect", async () => {
    await expect(connectA2A({ url: "https://agents.example.test/", token: TOKEN })).rejects.toBeInstanceOf(A2ALiteralSecretError);
  });

  test("proxy_works_as_a_workflow_agent_node", async () => {
    const peer = servePeer(await textAgent());
    const reviewer = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true });
    const host = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        definePackage({
          ...workflows,
          setup(prism) {
            workflows.setup(prism);
            prism.commands.register({
              name: "go",
              description: "run",
              run: (_args, ctx) =>
                startWorkflow(
                  defineWorkflow({
                    id: "wf",
                    revision: "1",
                    nodes: { review: agentNode({ agent: reviewer, input: () => "review the diff" }) },
                  }),
                  "task",
                  { prism, session: ctx.session as never, runId: "run-1", checkpoints: createMemoryWorkflowCheckpoints() },
                ),
            });
          },
        }),
      ],
    });
    const run = (await host.commands.run("go", undefined, { session: await host.session() })) as WorkflowRun;
    const streamed: AgentEvent[] = [];
    for await (const event of run.stream()) if ("origin" in event) streamed.push(event as AgentEvent);
    const result = await run.result();
    expect(result.status).toBe("succeeded");
    expect(JSON.stringify(result)).toContain("hello from the peer");
    expect(streamed.some((event) => event.origin?.kind === "external" && event.origin.executedBy === "external")).toBe(true);
    await reviewer.dispose();
    await host.dispose();
  });

  test("token_never_appears_in_events_or_errors", async () => {
    // The peer's failure text echoes the token; the proxy scrubs it from the event and the result.
    const peer = servePeer(await textAgent({ fail: `upstream rejected ${TOKEN}` }));
    const remote = await connectA2A({ url: peer.base, token: TOKEN_REF }, { allowLoopback: true });
    const session = await remote.session();
    const events = await collect(session.stream("go"));
    const result = await session.run("go");
    expect(result.status).toBe("failed");
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(remote.inspect())).not.toContain(TOKEN);
    // A refused call (wrong token) fails without echoing any token.
    process.env.PRISM_A2A_TEST_WRONG = `${TOKEN}-wrong`;
    const refused = await connectA2A({ url: peer.base, token: "env:PRISM_A2A_TEST_WRONG" }, { allowLoopback: true });
    const denied = await (await refused.session()).run("go");
    expect(denied.status).toBe("failed");
    expect(denied.error?.code).toBe(-32600);
    expect(JSON.stringify(denied)).not.toContain(TOKEN);
    await remote.dispose();
    await refused.dispose();
  });
});
