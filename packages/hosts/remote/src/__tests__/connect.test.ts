import { describe, expect, test } from "bun:test";
import { type AgentEvent, createAgent, definePackage, type HostUi, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import workflows, {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  startWorkflow,
  type WorkflowRun,
} from "@arnilo/prism-workflows";
import { attribute, createMemoryTransportPair, RemoteError, remoteHostUi } from "../index.js";
import { connectProxy, gatedAgent, until } from "./helpers.js";

const collect = async (iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> => {
  const out: AgentEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
};

const approveUi = (): HostUi & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    async request(request) {
      asked.push(request.kind);
      return { status: "answered", value: true } as never;
    },
  };
};

describe("connectAgent", () => {
  test("connected_events_keep_catalog_type_and_gain_remote", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui, text: "hello" });
    const agent = await build();
    const local = await agent.session();
    const expected = (await collect(local.stream("hi"))).map((event) => event.type);
    const { proxy } = await connectProxy(agent, ui);
    expect(proxy.id).toBe("served");
    const session = await proxy.session();
    const events = await collect(session.stream("hi"));
    expect(events.map((event) => event.type)).toEqual(expected);
    for (const event of events) {
      expect(event.origin?.remote).toBe("ep-proxy");
      expect(event.origin?.agent).toBe("served-agent");
    }
    expect(session.leafId).toBeTruthy();
    await proxy.dispose();
  });

  test("connected_tool_events_are_external_and_skip_local_gate", async () => {
    const ui = remoteHostUi();
    const remote = gatedAgent({ ui });
    const agent = await remote.build();
    const localCalls: string[] = [];
    const { proxy } = await connectProxy(agent, ui, { host: { ui: approveUi() } });
    const events = await collect((await proxy.session()).stream("go"));
    const tools = events.filter((event) => event.type.startsWith("tool."));
    expect(tools.length).toBeGreaterThan(0);
    for (const event of tools) expect(event.origin?.executedBy).toBe("external");
    expect(remote.executed).toHaveLength(1);

    // A local agent with its own `tool.call` hook, next to the proxy in one workflow: the hook sees local calls only.
    let turn = 0;
    const local = await createAgent({
      id: "local",
      model: { provider: "local-mock", model: "m" },
      packages: [
        providerPackage("local-provider", [
          {
            id: "local-mock",
            async *generate() {
              turn += 1;
              if (turn === 1) {
                yield { type: "tool_call" as const, call: toolCallContent("lc", "ping", {}) };
                yield providerDone();
                return;
              }
              yield providerTextDelta("local done");
              yield providerDone();
            },
          },
        ]),
        definePackage({
          name: "counter",
          version: "1.0.0",
          requires: { api: 1 },
          setup(prism) {
            prism.hooks.on("tool.call", (payload) => {
              localCalls.push(payload.name);
            });
          },
        }),
      ],
      tools: { add: [{ name: "ping", parameters: {}, execute: (_a, c) => ({ toolCallId: c.toolCallId, name: "ping", value: "pong" }) }] },
    });
    const { proxy: second } = await connectProxy(
      await gatedAgent({ ui: remoteHostUi(), gate: false, text: "remote text" }).build(),
      undefined,
    );
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
                    nodes: {
                      near: agentNode({ agent: local, input: () => "go" }),
                      far: agentNode({ agent: second, input: () => "go" }),
                    },
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
    for await (const event of run.stream()) if ("origin" in event || event.type.startsWith("tool.")) streamed.push(event as AgentEvent);
    expect((await run.result()).status).toBe("succeeded");
    expect(localCalls).toEqual(["ping"]);
    const remoteEvents = streamed.filter((event) => event.origin?.remote === "ep-proxy");
    expect(remoteEvents.length).toBeGreaterThan(0);
    expect(streamed.some((event) => event.origin === undefined)).toBe(true);
    await proxy.dispose();
    await second.dispose();
  });

  test("attribution_merge_keeps_nested_origin", () => {
    const source = { agent: "a", agentId: "id", endpointId: "outer" };
    const nested = {
      type: "tool.started",
      sessionId: "s",
      runId: "r",
      call: { type: "tool_call", id: "c", name: "w", arguments: {} },
      origin: { kind: "prism", agent: "inner", agentId: "i", remote: "inner-ep", depth: 2 },
    } as unknown as AgentEvent;
    const out = attribute(nested, source);
    expect(out.origin).toMatchObject({ remote: "inner-ep", depth: 2, agent: "inner", executedBy: "external" });
    const without = attribute({ ...nested, origin: { kind: "prism", agent: "inner", agentId: "i", depth: 1 } } as AgentEvent, source);
    expect(without.origin?.remote).toBe("outer");
    expect(without.origin?.depth).toBe(1);
  });

  test("remote_host_ui_reaches_local_ui", async () => {
    const ui = remoteHostUi();
    const { build, executed } = gatedAgent({ ui });
    const agent = await build();
    const local = approveUi();
    const { proxy } = await connectProxy(agent, ui, { host: { ui: local } });
    const result = await (await proxy.session()).run("go");
    expect(local.asked).toEqual(["confirm"]);
    expect(result.status).toBe("completed");
    expect(executed).toHaveLength(1);
    await proxy.dispose();
  });

  test("no_local_ui_suspends_and_resume_continues", async () => {
    const ui = remoteHostUi();
    const { build, executed } = gatedAgent({ ui });
    const agent = await build();
    const { proxy } = await connectProxy(agent, ui);
    const session = await proxy.session();
    const result = await session.run("go");
    expect(result.status).toBe("suspended");
    expect(result.pending?.length).toBe(1);
    expect(executed).toHaveLength(0);
    const decisions = (result.pending ?? []).map((item) => ({ approvalId: item.approvalId, outcome: "allow_once" as const }));
    const events = await collect(session.resume(decisions));
    expect(events.at(-1)?.type).toBe("run.completed");
    expect(executed).toHaveLength(1);
    await proxy.dispose();
  });

  test("unsupported_members_fail_closed", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const { proxy } = await connectProxy(await build(), ui);
    const session = await proxy.session();
    await expect(session.fork()).rejects.toMatchObject({ code: "remote_unsupported" });
    await expect(session.checkout()).rejects.toMatchObject({ code: "remote_unsupported" });
    await expect(session.compact()).rejects.toMatchObject({ code: "remote_unsupported" });
    expect(() => session.contextMeter()).toThrow(RemoteError);
    expect(() => proxy.models.resolve({ provider: "mock", model: "demo" } as never)).toThrow(RemoteError);
    await expect(session.entries()).rejects.toMatchObject({ code: "remote_unsupported" });
    await proxy.dispose();
  });

  test("proxy_session_subscribe_and_messages", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui, text: "hello" });
    const { proxy } = await connectProxy(await build(), ui);
    const session = await proxy.session();
    const seen = collect(session.subscribe());
    await session.run("hi");
    const events = await seen;
    expect(events.some((event) => event.type === "message.completed")).toBe(true);
    const messages = await session.messages();
    expect(JSON.stringify(messages)).toContain("hello");
    expect(session.leafId).toBeTruthy();
    await proxy.dispose();
  });

  test("steer_without_run_throws_synchronously", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const { proxy } = await connectProxy(await build(), ui);
    const session = await proxy.session();
    expect(() => session.steer("x")).toThrow(RemoteError);
    await proxy.dispose();
  });

  test("proxy_strips_local_only_run_options", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const { proxy, server } = await connectProxy(await build(), ui);
    const sent: string[] = [];
    const send = server.send.bind(server);
    server.send = async (frame) => {
      sent.push(JSON.stringify(frame));
      await send(frame);
    };
    const session = await proxy.session();
    const controller = new AbortController();
    const result = await session.run("hi", {
      signal: controller.signal,
      principal: { id: "p" } as never,
      ownership: { tenantId: "t" },
      redactor: (() => undefined) as never,
      runLedger: {} as never,
      metadata: { k: "v" },
    });
    expect(result.status).toBe("completed");
    const run = sent.find((frame) => frame.includes('"method":"run"')) ?? "";
    for (const key of ["principal", "ownership", "redactor", "runLedger", "signal", "tenantId"]) expect(run).not.toContain(key);
    expect(run).toContain('"metadata":{"k":"v"}');
    await proxy.dispose();
  });

  test("signal_abort_sends_abort", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const { proxy, server } = await connectProxy(await build(), ui);
    const sent: string[] = [];
    const send = server.send.bind(server);
    server.send = async (frame) => {
      sent.push(JSON.stringify(frame));
      await send(frame);
    };
    const session = await proxy.session();
    const controller = new AbortController();
    controller.abort();
    await session.run("hi", { signal: controller.signal });
    expect(sent.some((frame) => frame.includes('"method":"abort"'))).toBe(true);
    await proxy.dispose();
  });

  test("disconnect_during_run_rejects_with_disconnected", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ ui });
    const { proxy, server } = await connectProxy(await build(), ui);
    const session = await proxy.session();
    const pending = session.run("go");
    await server.close();
    await expect(pending).rejects.toMatchObject({ code: "disconnected" });
    await proxy.dispose();
  });

  test("protocol_unsupported_rejects_connect", async () => {
    const [a, b] = createMemoryTransportPair();
    void (async () => {
      for await (const item of a.frames()) {
        const frame = JSON.parse(item as string) as { id: number };
        await a.send({
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32003, message: "no", data: { code: "protocol_unsupported" } },
        });
      }
    })();
    const { connectAgent } = await import("../index.js");
    await expect(connectAgent({ kind: "memory", transport: b })).rejects.toMatchObject({ code: "protocol_unsupported" });
  });

  test("stdio_endpoint_rejects_empty_command_and_hides_env", async () => {
    const { connectAgent } = await import("../index.js");
    await expect(connectAgent({ kind: "stdio", command: [] })).rejects.toMatchObject({ code: "invalid_params" });
    const failure = await connectAgent({ kind: "stdio", command: ["definitely-not-a-binary-xyz"], env: { SECRET: "s3cr3t-value" } }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RemoteError);
    expect(JSON.stringify(failure) + String((failure as Error).message)).not.toContain("s3cr3t-value");
  });

  test("agent_events_and_commands_and_inspect", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const agent = await build();
    const { proxy } = await connectProxy(agent, ui);
    expect(proxy.commands.list()).toEqual(agent.commands.list());
    const inspected = proxy.inspect() as unknown as { remote: Record<string, unknown> };
    expect(inspected.remote.endpointId).toBe("ep-proxy");
    expect(inspected.remote.protocol).toBe("prism.remote/1");
    expect(Object.keys(inspected.remote).sort()).toEqual(["capabilities", "endpointId", "protocol"]);
    expect(proxy.tools.map((tool) => tool.name)).toContain("write");
    const listed = await proxy.sessions.list();
    expect(listed).toBeDefined();
    await proxy.dispose();
    expect(proxy.tools).toEqual([]);
    await until(() => true);
  });
});
