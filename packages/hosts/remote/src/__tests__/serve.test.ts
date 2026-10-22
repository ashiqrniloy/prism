import { describe, expect, test } from "bun:test";
import { remoteHostUi } from "../index.js";
import { connectTestClient, gatedAgent, until } from "./helpers.js";

const approve = () => ({ status: "answered", value: true });

describe("serveAgent", () => {
  test("serve_run_streams_catalog_events_unchanged", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui, text: "hello" });
    const agent = await build();
    const { client, served, initialized } = await connectTestClient(agent, ui);
    expect(initialized.endpointId).toBe("ep-test");
    expect(initialized.agent.id).toBe("served");
    const opened = (await client.call("sessions.open", {})) as { sessionId: string };
    const local = await agent.session();
    const expected: string[] = [];
    for await (const event of local.stream("hi")) expected.push(event.type);
    await client.call("run", { sessionId: opened.sessionId, input: "hi" });
    await until(() => client.settled.length === 1);
    expect(client.events.map((item) => item.event.type)).toEqual(expected);
    expect(client.settled[0]?.result.status).toBe("completed");
    expect(client.settled[0]?.result.text).toBe("hello");
    await served.close();
  });

  test("serve_sessions_open_list_resume", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ ui });
    const agent = await build();
    const { client, served } = await connectTestClient(agent, ui);
    const opened = (await client.call("sessions.open", {})) as { sessionId: string };
    await client.call("run", { sessionId: opened.sessionId, input: "go" });
    await until(() => client.settled.length === 1);
    const listed = (await client.call("sessions.list", {})) as { items?: Array<{ id: string }> };
    expect(JSON.stringify(listed)).toContain(opened.sessionId);
    await expect(client.call("sessions.open", { id: "nope" })).rejects.toMatchObject({ code: "session_not_found" });
    const page = await agent.sessions.list();
    expect(JSON.stringify(page)).not.toContain("nope");
    await served.close();
  });

  test("remote_host_ui_inline_when_client_bound", async () => {
    const ui = remoteHostUi();
    const { build, executed } = gatedAgent({ ui });
    const agent = await build();
    const { client, served } = await connectTestClient(agent, ui, approve);
    const { sessionId } = (await client.call("sessions.open", {})) as { sessionId: string };
    await client.call("run", { sessionId, input: "go" });
    await until(() => client.settled.length === 1);
    expect(client.asked.map((item) => item.request.kind)).toEqual(["confirm"]);
    expect(client.settled[0]?.result.status).toBe("completed");
    expect(client.events.some((item) => item.event.type === "run.suspended")).toBe(false);
    expect(executed).toHaveLength(1);
    await served.close();
  });

  test("remote_host_ui_unavailable_suspends_durably", async () => {
    const ui = remoteHostUi();
    const { build, executed } = gatedAgent({ ui });
    const agent = await build();
    const session = await agent.session();
    const result = await session.run("go");
    expect(result.status).toBe("suspended");
    expect(executed).toHaveLength(0);
    const entries = await session.entries();
    expect(entries.some((entry) => entry.kind === "suspended_run")).toBe(true);
  });

  test("disconnect_during_pending_approval_suspends_then_resumes", async () => {
    const ui = remoteHostUi();
    const { build, executed } = gatedAgent({ ui });
    const agent = await build();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = await connectTestClient(agent, ui, async () => {
      await hold;
      return approve();
    });
    const { sessionId } = (await first.client.call("sessions.open", {})) as { sessionId: string };
    await first.client.call("run", { sessionId, input: "go" });
    await until(() => first.client.asked.length === 1);
    await first.client.dispatcher.close();
    release();
    // The kernel sees `unavailable`, suspends, and nothing executed.
    let suspended = false;
    for (let i = 0; i < 200 && !suspended; i++) {
      suspended = (await (await agent.session({ id: sessionId })).entries()).some((entry) => entry.kind === "suspended_run");
      if (!suspended) await new Promise((r) => setTimeout(r, 10));
    }
    expect(suspended).toBe(true);
    expect(executed).toHaveLength(0);

    // A new client connects, opens the session, receives the pending decision, answers, and the run completes.
    const second = await connectTestClient(agent, ui, approve);
    await second.client.call("sessions.open", { id: sessionId });
    await until(() => second.client.settled.length === 1);
    expect(second.client.asked).toHaveLength(1);
    expect(second.client.asked[0]?.approvalId).toBeTruthy();
    expect(second.client.settled[0]?.result.status).toBe("completed");
    expect(executed).toHaveLength(1);

    // A second answer for the resolved decision fails closed.
    const approvalId = second.client.asked[0]?.approvalId ?? "";
    await expect(
      second.client.call("sessions.resume", { sessionId, decisions: [{ approvalId, outcome: "allow_once" }] }),
    ).rejects.toBeDefined();
    expect(executed).toHaveLength(1);
    await second.served.close();
  });

  test("pending_delivered_after_server_restart", async () => {
    const first = gatedAgent({});
    const agentA = await first.build();
    const sessionA = await agentA.session();
    expect((await sessionA.run("go")).status).toBe("suspended");
    await agentA.dispose();

    const ui = remoteHostUi();
    const second = gatedAgent({ store: first.store, ui, resumed: true });
    const agentB = await second.build();
    const { client, served } = await connectTestClient(agentB, ui, approve);
    await client.call("sessions.open", { id: sessionA.id });
    await until(() => client.settled.length === 1);
    expect(client.asked).toHaveLength(1);
    expect(client.settled[0]?.result.status).toBe("completed");
    await served.close();
  });

  test("client_cannot_set_principal_or_ownership", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const agent = await build();
    const { client, served } = await connectTestClient(agent, ui);
    const { sessionId } = (await client.call("sessions.open", {})) as { sessionId: string };
    for (const key of ["principal", "ownership", "redactor", "signal", "runLedger"]) {
      await expect(client.call("run", { sessionId, input: "x", options: { [key]: {} } })).rejects.toMatchObject({ code: "invalid_params" });
    }
    await expect(client.call("run", { sessionId, input: 5 as never })).rejects.toMatchObject({ code: "invalid_params" });
    await served.close();
  });

  test("steer_with_no_run_returns_kernel_error_and_abort_reaches_session", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const agent = await build();
    const { client, served } = await connectTestClient(agent, ui);
    const { sessionId } = (await client.call("sessions.open", {})) as { sessionId: string };
    await expect(client.call("steer", { sessionId, input: "more" })).rejects.toBeDefined();
    await expect(client.call("abort", { sessionId: "ghost" })).rejects.toMatchObject({ code: "session_not_found" });
    await served.close();
  });

  test("serve_commands_inspect_and_messages", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui, text: "hello" });
    const agent = await build();
    const { client, served } = await connectTestClient(agent, ui);
    expect(await client.call("commands.list", {})).toEqual(JSON.parse(JSON.stringify(agent.commands.list())));
    expect(await client.call("inspect", {})).toEqual(JSON.parse(JSON.stringify(agent.inspect())));
    const { sessionId } = (await client.call("sessions.open", {})) as { sessionId: string };
    await client.call("run", { sessionId, input: "hi" });
    await until(() => client.settled.length === 1);
    const local = await agent.session({ id: sessionId });
    const wire = (await client.call("sessions.messages", { sessionId })) as { messages: unknown[] };
    expect(wire.messages).toEqual(JSON.parse(JSON.stringify(await local.messages())));
    await expect(client.call("sessions.messages", { sessionId: "ghost" })).rejects.toMatchObject({ code: "session_not_found" });
    await served.close();
  });

  test("concurrent_resumes_second_gets_busy", async () => {
    const first = gatedAgent({});
    const agent0 = await first.build();
    const s0 = await agent0.session();
    await s0.run("go");
    const ui = remoteHostUi();
    const second = gatedAgent({ store: first.store, ui, resumed: true });
    const agent = await second.build();
    const { client, served } = await connectTestClient(agent, ui);
    await client.call("sessions.open", { id: s0.id });
    const local = await agent.session({ id: s0.id });
    const pending = (await local.entries()).find((e) => e.kind === "suspended_run");
    const ids = (
      (pending?.data ?? {}) as { interruption: { pendingDecisions: Array<{ approvalId: string }> } }
    ).interruption.pendingDecisions.map((d) => d.approvalId);
    const decisions = ids.map((approvalId) => ({ approvalId, outcome: "allow_once" }));
    const results = await Promise.allSettled([
      client.call("sessions.resume", { sessionId: s0.id, decisions: decisions as never }),
      client.call("sessions.resume", { sessionId: s0.id, decisions: decisions as never }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await until(() => client.settled.length >= 1);
    expect(second.executed).toHaveLength(1);
    await served.close();
  });
});
