import { describe, expect, spyOn, test } from "bun:test";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  type HostUi,
  type JsonObject,
  type JsonValue,
  type OwnershipScope,
  type Principal,
  providerDone,
  providerTextDelta,
  type RunOptions,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createDispatcher, type Dispatcher } from "../dispatcher.js";
import { connectAgent, createMemoryTransportPair, RemoteError, remoteHostUi, serveAgent } from "../index.js";
import type { HostUiRequestParams } from "../protocol.js";
import { createServerState, type ServeAgentOptions, serveConnection } from "../serve.js";
import { gatedAgent, MODEL, sleep, until } from "./helpers.js";

const ALICE: Principal = { kind: "user", id: "alice" };
const BOB: Principal = { kind: "user", id: "bob" };
const OPS: Principal = { kind: "service", id: "ops-daemon" };
const TENANTS: Record<string, string> = { alice: "acme", bob: "globex", "ops-daemon": "acme" };

interface PrincipalClient {
  readonly dispatcher: Dispatcher;
  readonly asked: HostUiRequestParams[];
  readonly agentEvents: Array<{ type: string; sessionId?: string } & JsonObject>;
  readonly runEvents: Array<{ sessionId: string; runId: string; event: { type: string } & JsonObject }>;
  readonly settled: Array<{ sessionId: string; runId: string; result: JsonObject }>;
  call(method: string, params?: JsonObject): Promise<JsonValue>;
  close(): Promise<void>;
}

async function connectPrincipal(
  state: ReturnType<typeof createServerState>,
  principal: Principal | undefined,
  options: {
    capabilities?: { hostUi?: boolean; "hostUi.secret"?: boolean; agentEvents?: boolean };
    answer?: (params: HostUiRequestParams) => Promise<JsonValue> | JsonValue;
  } = {},
): Promise<PrincipalClient> {
  const [serverSide, clientSide] = createMemoryTransportPair();
  serveConnection(state, serverSide, { ...(principal ? { principal } : {}) });
  const asked: HostUiRequestParams[] = [];
  const agentEvents: PrincipalClient["agentEvents"] = [];
  const runEvents: PrincipalClient["runEvents"] = [];
  const settled: PrincipalClient["settled"] = [];
  const dispatcher = createDispatcher({
    transport: clientSide,
    role: "client",
    capabilities: options.capabilities ?? { hostUi: true, "hostUi.secret": true },
    requests: {
      "hostUi.request": async (params) => {
        const typed = params as unknown as HostUiRequestParams;
        asked.push(typed);
        return (await (options.answer?.(typed) ?? { status: "answered", value: true })) as JsonValue;
      },
    },
    notifications: {
      "agent.event": (params) => {
        const payload = params as { event: { type: string; sessionId?: string } & JsonObject };
        agentEvents.push(payload.event);
      },
      "run.event": (params) => runEvents.push(params as never),
      "run.settled": (params) => settled.push(params as never),
    },
  });
  await dispatcher.initialize();
  return {
    dispatcher,
    asked,
    agentEvents,
    runEvents,
    settled,
    call: (method, params) => dispatcher.request(method, params),
    close: () => dispatcher.close(),
  };
}

async function expectSessionNotFound(work: Promise<unknown>): Promise<void> {
  try {
    await work;
    throw new Error("expected session_not_found rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).code).toBe("session_not_found");
  }
}

describe("prism-remote principal isolation", () => {
  test("two_principals_are_isolated", async () => {
    // 1. Floor isolation without `ownershipFor`: ServerState.sessions + sessionOwners isolate every wire method.
    const seenSessions: Array<string | undefined> = [];
    const baseAgent = await createAgent({
      id: "iso-floor",
      model: MODEL,
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("mock-p", [
          {
            id: "mock",
            async *generate() {
              yield providerTextDelta("hello");
              yield providerDone();
            },
          },
        ]),
        definePackage({
          name: "cmd-pkg",
          version: "0.0.1",
          requires: { api: 1 },
          setup(prism) {
            prism.commands.register({
              name: "ping",
              description: "ping command",
              run: (_args, ctx) => {
                seenSessions.push(ctx.session?.id);
                return { ok: true };
              },
            });
          },
        }),
      ],
    });
    const floorState = createServerState(baseAgent, { endpointId: "ep-floor" });
    const alice = await connectPrincipal(floorState, ALICE);
    const bob = await connectPrincipal(floorState, BOB);

    const openedA = (await alice.call("sessions.open", {})) as { sessionId: string };
    const sessionA = openedA.sessionId;

    await expectSessionNotFound(bob.call("sessions.open", { id: sessionA }));
    await expectSessionNotFound(bob.call("sessions.messages", { sessionId: sessionA }));
    await expectSessionNotFound(bob.call("run", { sessionId: sessionA, input: "steal" }));
    await expectSessionNotFound(bob.call("steer", { sessionId: sessionA, input: "hijack" }));
    await expectSessionNotFound(bob.call("abort", { sessionId: sessionA }));
    await expectSessionNotFound(
      bob.call("sessions.resume", {
        sessionId: sessionA,
        decisions: [{ approvalId: "a-1", outcome: "allow_once" }],
      }),
    );
    await expectSessionNotFound(bob.call("commands.run", { name: "ping", sessionId: sessionA }));
    expect(seenSessions).toHaveLength(0);

    // Alice can still use her own session normally.
    await alice.call("run", { sessionId: sessionA, input: "hi" });
    await until(() => alice.settled.length === 1);
    const msgs = (await alice.call("sessions.messages", { sessionId: sessionA })) as { messages: unknown[] };
    expect(msgs.messages.length).toBeGreaterThanOrEqual(2);
    await alice.call("commands.run", { name: "ping", sessionId: sessionA });
    expect(seenSessions).toEqual([sessionA]);

    await alice.close();
    await bob.close();
    await baseAgent.dispose();

    // 2. Kernel ownership layer with `ownershipFor`: scopes sessions.open, sessions.list, run, sessions.resume, deliverPending.
    const ui = remoteHostUi();
    const { build, store } = gatedAgent({ ui, gate: true });
    const scopedAgent = await build();
    const ownershipFor = (p: Principal): OwnershipScope => ({
      ...(TENANTS[p.id] ? { tenantId: TENANTS[p.id] } : {}),
      userId: p.id,
    });
    const scopedOptions: Omit<ServeAgentOptions, "transport"> = {
      hostUi: ui,
      endpointId: "ep-scoped",
      ownershipFor,
    };
    const scopedState = createServerState(scopedAgent, scopedOptions);
    const aliceScoped = await connectPrincipal(scopedState, ALICE, {
      answer: () => ({ status: "unavailable" }),
    });
    const bobScoped = await connectPrincipal(scopedState, BOB);

    const { sessionId: aliceSessionId } = (await aliceScoped.call("sessions.open", {})) as { sessionId: string };
    const { sessionId: bobSessionId } = (await bobScoped.call("sessions.open", {
      parent: { sessionId: "root-bob" },
    })) as { sessionId: string };

    // Suspend Alice's run so we can verify `sessions.resume` and `sessions.list` ownership scoping.
    await aliceScoped.call("run", { sessionId: aliceSessionId, input: "go" });
    await until(() => aliceScoped.settled.length === 1);
    expect(aliceScoped.settled[0]?.result.status).toBe("suspended");

    // Bob's `sessions.list` only sees Bob's session, even if Bob tries to smuggle Alice's userId/tenantId in query.
    const bobList = (await bobScoped.call("sessions.list", {
      query: { userId: "alice", tenantId: "acme" },
    })) as { items: Array<{ sessionId: string }> };
    expect(bobList.items.map((item) => item.sessionId)).toEqual([bobSessionId]);

    const aliceList = (await aliceScoped.call("sessions.list", {})) as { items: Array<{ sessionId: string }> };
    expect(aliceList.items.map((item) => item.sessionId)).toEqual([aliceSessionId]);

    // Even on a fresh ServerState against the same persistent store, Bob cannot open Alice's stored session.
    const restartState = createServerState(scopedAgent, scopedOptions);
    const bobAfterRestart = await connectPrincipal(restartState, BOB);
    await expectSessionNotFound(bobAfterRestart.call("sessions.open", { id: aliceSessionId }));

    // Alice can reopen and resume her own session with her ownership scope.
    const pending = (aliceScoped.settled[0]?.result.pending as Array<{ approvalId: string }>) ?? [];
    expect(pending).toHaveLength(1);
    await aliceScoped.call("sessions.resume", {
      sessionId: aliceSessionId,
      decisions: [{ approvalId: pending[0]!.approvalId, outcome: "allow_once" }],
    });
    await until(() => aliceScoped.settled.length === 2);
    expect(aliceScoped.settled[1]?.result.status).toBe("completed");
    expect(store).toBeDefined();

    await aliceScoped.close();
    await bobScoped.close();
    await bobAfterRestart.close();
    await scopedAgent.dispose();
  });

  test("approval_routes_to_owner", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ ui, gate: true });
    const agent = await build();
    const state = createServerState(agent, { hostUi: ui, endpointId: "ep-approval" });

    // Alice connects first; Bob connects second. With the old stack, Bob would have received Alice's approval.
    const alice = await connectPrincipal(state, ALICE, {
      answer: () => ({ status: "answered", value: true }),
    });
    const bob = await connectPrincipal(state, BOB, {
      answer: () => ({ status: "answered", value: true }),
    });

    const { sessionId } = (await alice.call("sessions.open", {})) as { sessionId: string };
    await alice.call("run", { sessionId, input: "run tool" });
    await until(() => alice.settled.length === 1);

    expect(alice.settled[0]?.result.status).toBe("completed");
    expect(alice.asked).toHaveLength(1);
    expect(alice.asked[0]?.sessionId).toBe(sessionId);
    expect(bob.asked).toHaveLength(0);

    // If Alice disconnects while Bob stays connected, a session-scoped request for Alice's session answers unavailable.
    await alice.close();
    const res = await ui.request({ kind: "confirm", sessionId, title: "Approve while Alice offline?" });
    expect(res).toEqual({ status: "unavailable" });
    expect(bob.asked).toHaveLength(0);

    await bob.close();
    await agent.dispose();
  });

  test("secret_request_never_reaches_other_principal", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ ui, gate: false });
    const agent = await build();
    const opts: Omit<ServeAgentOptions, "transport"> = {
      hostUi: ui,
      endpointId: "ep-secret",
      operator: (p) => p.kind === "service",
    };
    const state = createServerState(agent, opts);

    const alice = await connectPrincipal(state, ALICE, {
      capabilities: { hostUi: true, "hostUi.secret": true },
      answer: () => ({ status: "answered", value: "alice-secret" }),
    });
    const bob = await connectPrincipal(state, BOB, {
      capabilities: { hostUi: true, "hostUi.secret": true },
      answer: () => ({ status: "answered", value: "bob-secret" }),
    });

    const { sessionId: aliceSession } = (await alice.call("sessions.open", {})) as { sessionId: string };

    // Session-scoped secret request for Alice's session goes to Alice even though Bob connected later.
    const sessionSecret = await ui.request({
      kind: "secret",
      sessionId: aliceSession,
      title: "Alice API key",
      ref: "keyring:alice",
    });
    expect(sessionSecret).toEqual({ status: "answered", value: "alice-secret" });
    expect(alice.asked).toHaveLength(1);
    expect(bob.asked).toHaveLength(0);

    // When Alice disconnects, a session-scoped secret request for Alice's session must NOT fall back to Bob.
    await alice.close();
    const offlineSecret = await ui.request({
      kind: "secret",
      sessionId: aliceSession,
      title: "Alice API key offline",
      ref: "keyring:alice",
    });
    expect(offlineSecret).toEqual({ status: "unavailable" });
    expect(bob.asked).toHaveLength(0);

    // Agent-scoped secret request (no sessionId) must NOT reach non-operator Bob.
    const agentSecretNoOp = await ui.request({
      kind: "secret",
      title: "Operator secret",
      ref: "keyring:ops",
    });
    expect(agentSecretNoOp).toEqual({ status: "unavailable" });
    expect(bob.asked).toHaveLength(0);

    // When an operator principal connects, agent-scoped secret requests route to the operator only.
    const ops = await connectPrincipal(state, OPS, {
      capabilities: { hostUi: true, "hostUi.secret": true },
      answer: () => ({ status: "answered", value: "ops-secret" }),
    });
    const agentSecretWithOp = await ui.request({
      kind: "secret",
      title: "Operator secret",
      ref: "keyring:ops",
    });
    expect(agentSecretWithOp).toEqual({ status: "answered", value: "ops-secret" });
    expect(ops.asked).toHaveLength(1);
    expect(bob.asked).toHaveLength(0);

    await bob.close();
    await ops.close();
    await agent.dispose();
  });

  test("pending_delivery_is_owner_only", async () => {
    const ui = remoteHostUi();
    const seenResumes: Array<{ principal?: Principal; ownership?: OwnershipScope }> = [];
    const { build } = gatedAgent({ ui, gate: true });
    const agent = await build();
    const opts: Omit<ServeAgentOptions, "transport"> = {
      hostUi: ui,
      endpointId: "ep-pending",
      ownershipFor: (p) => ({ ...(TENANTS[p.id] ? { tenantId: TENANTS[p.id] } : {}), userId: p.id }),
      resumeAuthority: {
        resume(id: string, decisions, options?: RunOptions) {
          seenResumes.push({ principal: options?.principal, ownership: options?.ownership });
          return {
            async *[Symbol.asyncIterator]() {
              const s = await agent.session({ id, ...(options?.ownership ? { ownership: options.ownership } : {}) });
              yield* s.resume(decisions, options);
            },
          };
        },
      },
    };
    const state = createServerState(agent, opts);

    // Alice connects without hostUi so her gated run suspends immediately.
    const aliceInitial = await connectPrincipal(state, ALICE, {
      capabilities: { hostUi: false },
    });
    const { sessionId } = (await aliceInitial.call("sessions.open", {})) as { sessionId: string };
    await aliceInitial.call("run", { sessionId, input: "suspend me" });
    await until(() => aliceInitial.settled.length === 1);
    expect(aliceInitial.settled[0]?.result.status).toBe("suspended");
    await aliceInitial.close();

    // Bob connects with hostUi: true. Bob must NOT receive Alice's pending decision.
    const bob = await connectPrincipal(state, BOB, {
      capabilities: { hostUi: true },
      answer: () => ({ status: "answered", value: true }),
    });
    await sleep(30);
    expect(bob.asked).toHaveLength(0);
    expect(seenResumes).toHaveLength(0);

    // Alice reconnects with hostUi: true. Alice receives her pending decision and resumes with her ownership scope.
    const aliceReconnect = await connectPrincipal(state, ALICE, {
      capabilities: { hostUi: true },
      answer: () => ({ status: "answered", value: true }),
    });
    await until(() => aliceReconnect.asked.length === 1);
    await until(() => seenResumes.length === 1);
    expect(aliceReconnect.asked[0]?.sessionId).toBe(sessionId);
    expect(bob.asked).toHaveLength(0);
    expect(seenResumes[0]).toEqual({
      principal: ALICE,
      ownership: { tenantId: "acme", userId: "alice" },
    });

    await bob.close();
    await aliceReconnect.close();
    await agent.dispose();
  });

  test("events_are_owner_only", async () => {
    const ui = remoteHostUi();
    const agent = await createAgent({
      id: "iso-events",
      model: MODEL,
      slots: { store: createMemorySessionStore() },
      host: { ui },
      packages: [
        providerPackage("mock-events", [
          {
            id: "mock",
            async *generate() {
              yield providerTextDelta("hello");
              yield providerDone();
            },
          },
        ]),
        definePackage({
          name: "bg-pkg",
          version: "0.0.1",
          requires: { api: 1 },
          capabilities: ["background"],
          setup(prism) {
            prism.hooks.on("run.started", (_event, ctx) => {
              ctx.session?.background("bg-work", async () => {
                await sleep(5);
              });
            });
          },
        }),
      ],
    });
    const opts: Omit<ServeAgentOptions, "transport"> = {
      hostUi: ui,
      endpointId: "ep-events",
      operator: (p) => p.kind === "service",
    };
    const state = createServerState(agent, opts);

    const alice = await connectPrincipal(state, ALICE, {
      capabilities: { agentEvents: true },
    });
    const bob = await connectPrincipal(state, BOB, {
      capabilities: { agentEvents: true },
    });
    const ops = await connectPrincipal(state, OPS, {
      capabilities: { agentEvents: true },
    });

    const { sessionId: aliceSession } = (await alice.call("sessions.open", {})) as { sessionId: string };
    await alice.call("run", { sessionId: aliceSession, input: "hello" });
    await until(() => alice.settled.length === 1);
    await until(() => alice.agentEvents.some((e) => e.type === "background.completed" && e.sessionId === aliceSession));

    // Alice received session.opened and background.* events for her session.
    expect(alice.agentEvents.some((e) => e.type === "session.opened" && e.sessionId === aliceSession)).toBe(true);
    expect(alice.agentEvents.some((e) => e.type === "background.started" && e.sessionId === aliceSession)).toBe(true);
    expect(alice.agentEvents.some((e) => e.type === "background.completed" && e.sessionId === aliceSession)).toBe(true);
    expect(alice.agentEvents.every((e) => e.sessionId === aliceSession)).toBe(true);

    // Bob received NONE of Alice's session.opened or background.* events.
    expect(bob.agentEvents).toHaveLength(0);
    // Operator also does not receive Alice's session-scoped events unless Operator owns the session.
    expect(ops.agentEvents.filter((e) => e.sessionId === aliceSession)).toHaveLength(0);

    // An in-process session opened directly on the host agent (unowned by any remote principal) routes only to operator.
    const hostSession = await agent.session();
    await hostSession.run("host-local");
    await until(() => ops.agentEvents.some((e) => e.sessionId === hostSession.id && e.type === "background.completed"));
    expect(ops.agentEvents.some((e) => e.sessionId === hostSession.id && e.type === "session.opened")).toBe(true);
    expect(alice.agentEvents.filter((e) => e.sessionId === hostSession.id)).toHaveLength(0);
    expect(bob.agentEvents).toHaveLength(0);

    await alice.close();
    await bob.close();
    await ops.close();
    await agent.dispose();
  });

  test("single_principal_unchanged", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ ui, gate: true });
    const agent = await build();
    const served = serveAgent(agent, {
      transport: { kind: "websocket", port: 0 },
      hostUi: ui,
    });
    await served.ready;
    let askedCount = 0;
    const clientUi: HostUi = {
      async request() {
        askedCount += 1;
        return { status: "answered", value: true } as never;
      },
    };
    const proxy = await connectAgent({ kind: "websocket", url: served.url!, token: served.token! }, { host: { ui: clientUi } });

    const s = await proxy.session();
    const result = await s.run("approve me");
    expect(result.status).toBe("completed");
    expect(askedCount).toBe(1);

    // Agent-scoped host-UI request also works on single-principal loopback because the default principal is operator.
    const confirmResp = await ui.request({ kind: "confirm", title: "Operator confirm?" });
    expect(confirmResp).toEqual({ status: "answered", value: true });
    expect(askedCount).toBe(2);

    await proxy.dispose();
    await served.close();
    await agent.dispose();
  });

  test("routing_is_constant_time", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ ui, gate: false });
    const agent = await build();
    const state = createServerState(agent, { hostUi: ui, endpointId: "ep-50" });

    const clients: PrincipalClient[] = [];
    const sessionIds: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const principal: Principal = { kind: "user", id: `user-${i}` };
      const client = await connectPrincipal(state, principal, {
        capabilities: { hostUi: true, agentEvents: true },
        answer: () => ({ status: "answered", value: true }),
      });
      const { sessionId } = (await client.call("sessions.open", {})) as { sessionId: string };
      clients.push(client);
      sessionIds.push(sessionId);
    }

    const ownerGetSpy = spyOn(state.sessionOwners, "get");
    const sessionsIterSpy = spyOn(state.sessions, Symbol.iterator);
    const sessionsValuesSpy = spyOn(state.sessions, "values");
    const ownersIterSpy = spyOn(state.sessionOwners, Symbol.iterator);
    const ownersValuesSpy = spyOn(state.sessionOwners, "values");

    const targetIndex = 25;
    const targetSessionId = sessionIds[targetIndex]!;

    ownerGetSpy.mockClear();
    const answer = await ui.request({ kind: "confirm", sessionId: targetSessionId, title: "Constant time?" });
    expect(answer).toEqual({ status: "answered", value: true });
    expect(ownerGetSpy).toHaveBeenCalledTimes(1);
    expect(sessionsIterSpy).toHaveBeenCalledTimes(0);
    expect(sessionsValuesSpy).toHaveBeenCalledTimes(0);
    expect(ownersIterSpy).toHaveBeenCalledTimes(0);
    expect(ownersValuesSpy).toHaveBeenCalledTimes(0);

    for (let i = 0; i < 50; i += 1) {
      expect(clients[i]!.asked).toHaveLength(i === targetIndex ? 1 : 0);
    }

    ownerGetSpy.mockClear();
    await clients[targetIndex]!.call("sessions.messages", { sessionId: targetSessionId });
    expect(ownerGetSpy).toHaveBeenCalledTimes(1);
    expect(sessionsIterSpy).toHaveBeenCalledTimes(0);
    expect(sessionsValuesSpy).toHaveBeenCalledTimes(0);

    for (const client of clients) await client.close();
    await agent.dispose();
  });
});
