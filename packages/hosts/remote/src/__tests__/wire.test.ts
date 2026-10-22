import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type createAgent,
  createMemorySessionStore,
  HARD_MAX_SESSION_LIST_LIMIT,
  MAX_DECISION_REASON_BYTES,
  MAX_SESSION_LINK_ID_LENGTH,
  type OwnershipScope,
  type Principal,
} from "@arnilo/prism";
import { createDispatcher, createMemoryTransportPair, RemoteError, remoteHostUi } from "../index.js";
import { createServerState, type ServeAgentOptions, serveConnection } from "../serve.js";
import {
  MAX_APPROVAL_ID_LENGTH,
  MAX_SESSION_LIST_CURSOR_LENGTH,
  parseDecisions,
  parseSessionListQuery,
  parseSessionParentLink,
  parseSteerOptions,
} from "../wire.js";
import { connectTestClient, gatedAgent, until } from "./helpers.js";

async function expectInvalidParams(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error("expected invalid_params RemoteError");
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).code).toBe("invalid_params");
  }
}

function expectSyncInvalidParams(fn: () => unknown): void {
  try {
    fn();
    throw new Error("expected invalid_params RemoteError");
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).code).toBe("invalid_params");
  }
}

async function connectClientWithOptions(
  agent: Awaited<ReturnType<typeof createAgent>>,
  options: Omit<ServeAgentOptions, "transport"> & { principal?: Principal } = {},
) {
  const { principal, ...serveOptions } = options;
  const state = createServerState(agent, serveOptions);
  const [serverSide, clientSide] = createMemoryTransportPair();
  serveConnection(state, serverSide, { ...(principal ? { principal } : {}) });
  const settled: Array<{ sessionId: string; runId: string; result: { status: string; pending?: Array<{ approvalId: string }> } }> = [];
  const client = createDispatcher({
    transport: clientSide,
    role: "client",
    capabilities: { hostUi: true, "hostUi.secret": true, agentEvents: true },
    requests: {
      "hostUi.request": async () => ({ status: "unavailable" }),
    },
    notifications: {
      "run.event": () => {},
      "run.settled": (params) => settled.push(params as unknown as (typeof settled)[number]),
      "agent.event": () => {},
    },
  });
  await client.initialize();
  return {
    state,
    settled,
    call: (method: string, params?: Record<string, unknown>) => client.request(method, params as unknown as Record<string, never>),
    close: async () => {
      await client.close();
      await serverSide.close();
    },
  };
}

describe("prism-remote wire allow-lists", () => {
  test("decision_extra_keys_rejected", async () => {
    // 1. Direct validator checks on extra keys, outcome values, approvalId length, reason byte length, and elicitation scope.
    expectSyncInvalidParams(() => parseDecisions([]));
    expectSyncInvalidParams(() => parseDecisions("not-an-array"));
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "a1", outcome: "allow_once", extra: true }]),
    );
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "a1", outcome: "allow_once", scope: { toolName: "write" } }]),
    );
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "", outcome: "allow_once" }]),
    );
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "a".repeat(MAX_APPROVAL_ID_LENGTH + 1), outcome: "allow_once" }]),
    );
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "a1", outcome: "allow_always" }]),
    );
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "a1", outcome: "allow_once", reason: "x".repeat(MAX_DECISION_REASON_BYTES + 1) }]),
    );
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "a1", outcome: "allow_once", reason: "é".repeat(MAX_DECISION_REASON_BYTES / 2 + 1) }]),
    );
    expect(
      parseDecisions([
        {
          approvalId: "a".repeat(MAX_APPROVAL_ID_LENGTH),
          outcome: "allow_for_run",
          reason: "x".repeat(MAX_DECISION_REASON_BYTES),
        },
      ]),
    ).toEqual([
      {
        approvalId: "a".repeat(MAX_APPROVAL_ID_LENGTH),
        outcome: "allow_for_run",
        reason: "x".repeat(MAX_DECISION_REASON_BYTES),
      },
    ]);

    // Elicitation is rejected when pending decision is absent or is a tool_approval.
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "a1", outcome: "allow_once", elicitation: { choice: "a" } }], {
        pending: [{ approvalId: "a1", kind: "tool_approval", scope: { toolName: "write" }, reason: "gate" }],
      }),
    );
    expectSyncInvalidParams(() =>
      parseDecisions([{ approvalId: "e1", outcome: "allow_once", elicitation: "not-an-object" }], {
        pending: [{ approvalId: "e1", kind: "elicitation", scope: { toolName: "ask" }, reason: "pick" }],
      }),
    );
    expect(
      parseDecisions([{ approvalId: "e1", outcome: "allow_once", elicitation: { choice: "a" } }], {
        pending: [{ approvalId: "e1", kind: "elicitation", scope: { toolName: "ask" }, reason: "pick" }],
      }),
    ).toEqual([{ approvalId: "e1", outcome: "allow_once", elicitation: { choice: "a" } }]);

    // 2. Wire check over `sessions.resume`: extra keys and elicitation on a tool_approval decision fail with `invalid_params`.
    const ui = remoteHostUi();
    const { build, executed } = gatedAgent({ ui, gate: true });
    const agent = await build();
    const client = await connectClientWithOptions(agent, { hostUi: ui });
    const { sessionId } = (await client.call("sessions.open", {})) as { sessionId: string };
    await client.call("run", { sessionId, input: "go" });
    await until(() => client.settled.length === 1);
    const approvalId = client.settled[0]?.result.pending?.[0]?.approvalId ?? "";
    expect(approvalId).toBeTruthy();

    await expectInvalidParams(
      client.call("sessions.resume", {
        sessionId,
        decisions: [{ approvalId, outcome: "allow_once", unexpectedField: 123 }],
      }),
    );
    await expectInvalidParams(
      client.call("sessions.resume", {
        sessionId,
        decisions: [{ approvalId, outcome: "allow_once", elicitation: { choice: "a" } }],
      }),
    );
    expect(executed).toHaveLength(0);

    await client.close();
    await agent.dispose();
  });

  test("modified_arguments_require_opt_in", async () => {
    // 1. Default (`allowModifiedArguments` omitted): `modifiedArguments` is rejected with `invalid_params`.
    const uiDefault = remoteHostUi();
    const defaultSetup = gatedAgent({ ui: uiDefault, gate: true });
    const defaultAgent = await defaultSetup.build();
    const defaultClient = await connectClientWithOptions(defaultAgent, { hostUi: uiDefault });
    const { sessionId: s1 } = (await defaultClient.call("sessions.open", {})) as { sessionId: string };
    await defaultClient.call("run", { sessionId: s1, input: "go" });
    await until(() => defaultClient.settled.length === 1);
    const approvalId1 = defaultClient.settled[0]?.result.pending?.[0]?.approvalId ?? "";

    await expectInvalidParams(
      defaultClient.call("sessions.resume", {
        sessionId: s1,
        decisions: [{ approvalId: approvalId1, outcome: "allow_once", modifiedArguments: { text: "tampered" } }],
      }),
    );
    expect(defaultSetup.executed).toHaveLength(0);
    await defaultClient.close();
    await defaultAgent.dispose();

    // 2. Opt-in (`allowModifiedArguments: true`): valid object `modifiedArguments` is accepted and re-gated by the kernel.
    const optInSetup = gatedAgent({ gate: true });
    const optInAgent = await optInSetup.build();
    const optInClient = await connectClientWithOptions(optInAgent, { allowModifiedArguments: true });
    const { sessionId: s2 } = (await optInClient.call("sessions.open", {})) as { sessionId: string };
    await optInClient.call("run", { sessionId: s2, input: "go" });
    await until(() => optInClient.settled.length === 1);
    const approvalId2 = optInClient.settled[0]?.result.pending?.[0]?.approvalId ?? "";

    // Non-object modifiedArguments still fails wire validation.
    await expectInvalidParams(
      optInClient.call("sessions.resume", {
        sessionId: s2,
        decisions: [{ approvalId: approvalId2, outcome: "allow_once", modifiedArguments: ["bad"] }],
      }),
    );

    // Allowed modifiedArguments passes wire validation and executes with the edited argument.
    await optInClient.call("sessions.resume", {
      sessionId: s2,
      decisions: [{ approvalId: approvalId2, outcome: "allow_once", modifiedArguments: { value: "edited-safe" } }],
    });
    await until(() => optInClient.settled.length === 2);
    expect(optInClient.settled[1]?.result.status).toBe("completed");
    expect(optInSetup.executed).toEqual([{ value: "edited-safe" }]);

    await optInClient.close();
    await optInAgent.dispose();
  });

  test("steer_options_allow_list", async () => {
    expect(parseSteerOptions(undefined)).toBeUndefined();
    expect(parseSteerOptions({})).toEqual({});
    expect(parseSteerOptions({ softInterrupt: true })).toEqual({ softInterrupt: true });
    expect(parseSteerOptions({ softInterrupt: false })).toEqual({ softInterrupt: false });

    expectSyncInvalidParams(() => parseSteerOptions("bad"));
    expectSyncInvalidParams(() => parseSteerOptions([]));
    expectSyncInvalidParams(() => parseSteerOptions({ softInterrupt: "yes" }));
    expectSyncInvalidParams(() => parseSteerOptions({ softInterrupt: true, extra: 1 }));
    expectSyncInvalidParams(() => parseSteerOptions({ mode: "force" }));

    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const agent = await build();
    const { client, served } = await connectTestClient(agent, ui);
    const { sessionId } = (await client.call("sessions.open", {})) as { sessionId: string };

    await expectInvalidParams(
      client.call("steer", { sessionId, input: "more", options: { softInterrupt: true, unexpected: 1 } }),
    );
    await expectInvalidParams(
      client.call("steer", { sessionId, input: "more", options: { softInterrupt: "true" } }),
    );
    await expectInvalidParams(
      client.call("steer", { sessionId, input: "more", options: "not-an-object" }),
    );

    await served.close();
    await agent.dispose();
  });

  test("list_query_drops_ownership_keys", async () => {
    const serverScope: OwnershipScope = { tenantId: "tenant-server", accountId: "acct-server", userId: "user-server" };

    // Client ownership keys are stripped and replaced by the server's scope (or omitted when server has no scope).
    expect(
      parseSessionListQuery({
        tenantId: "tenant-evil",
        accountId: "acct-evil",
        userId: "user-evil",
        limit: 10,
        order: "asc",
        agentId: "agent-1",
        parentSessionId: "parent-1",
        workflowRunId: "wf-1",
        delegationId: "del-1",
        actorKind: "prism",
        actorAgent: "worker",
      }),
    ).toEqual({
      limit: 10,
      order: "asc",
      agentId: "agent-1",
      parentSessionId: "parent-1",
      workflowRunId: "wf-1",
      delegationId: "del-1",
      actorKind: "prism",
      actorAgent: "worker",
    });

    expect(
      parseSessionListQuery(
        {
          tenantId: "tenant-evil",
          accountId: "acct-evil",
          userId: "user-evil",
          limit: 5,
        },
        serverScope,
      ),
    ).toEqual({
      limit: 5,
      tenantId: "tenant-server",
      accountId: "acct-server",
      userId: "user-server",
    });

    expect(parseSessionListQuery({ tenantId: "tenant-evil" })).toBeUndefined();

    // Unknown keys and out-of-range pagination/link fields fail closed with `invalid_params`.
    expectSyncInvalidParams(() => parseSessionListQuery("bad"));
    expectSyncInvalidParams(() => parseSessionListQuery({ unknownKey: "x" }));
    expectSyncInvalidParams(() => parseSessionListQuery({ signal: {} }));
    expectSyncInvalidParams(() => parseSessionListQuery({ limit: 0 }));
    expectSyncInvalidParams(() => parseSessionListQuery({ limit: HARD_MAX_SESSION_LIST_LIMIT + 1 }));
    expectSyncInvalidParams(() => parseSessionListQuery({ limit: 1.5 }));
    expectSyncInvalidParams(() => parseSessionListQuery({ cursor: "" }));
    expectSyncInvalidParams(() => parseSessionListQuery({ cursor: "c".repeat(MAX_SESSION_LIST_CURSOR_LENGTH + 1) }));
    expectSyncInvalidParams(() => parseSessionListQuery({ order: "random" }));
    expectSyncInvalidParams(() => parseSessionListQuery({ actorKind: "robot" }));
    expectSyncInvalidParams(() =>
      parseSessionListQuery({ workflowRunId: "w".repeat(MAX_SESSION_LINK_ID_LENGTH + 1) }),
    );

    // Wire-level verification on `sessions.list`.
    const store = createMemorySessionStore();
    const ui = remoteHostUi();
    const { build } = gatedAgent({ store, ui, gate: false });
    const agent = await build();
    const alice = await connectClientWithOptions(agent, {
      principal: { kind: "user", id: "alice" },
      ownershipFor: (p) => ({ tenantId: "t-1", accountId: "a-1", userId: p.id }),
    });
    const bob = await connectClientWithOptions(agent, {
      principal: { kind: "user", id: "bob" },
      ownershipFor: (p) => ({ tenantId: "t-1", accountId: "a-1", userId: p.id }),
    });
    const { sessionId: aliceSession } = (await alice.call("sessions.open", {})) as { sessionId: string };
    await alice.call("run", { sessionId: aliceSession, input: "hi" });
    await until(() => alice.settled.length === 1);

    const bobListed = (await bob.call("sessions.list", {
      query: { tenantId: "t-1", accountId: "a-1", userId: "alice", limit: 10 },
    })) as { items: Array<{ sessionId: string }> };
    expect(bobListed.items).toEqual([]);

    await expectInvalidParams(bob.call("sessions.list", { query: { extraFilter: "nope" } }));
    await expectInvalidParams(bob.call("sessions.list", { query: { limit: 999 } }));

    await alice.close();
    await bob.close();
    await agent.dispose();
  });

  test("parent_link_bounded", async () => {
    expect(parseSessionParentLink(undefined)).toBeUndefined();
    expect(
      parseSessionParentLink({
        sessionId: "s".repeat(MAX_SESSION_LINK_ID_LENGTH),
        agentId: "a-1",
        workflowRunId: "wf-1",
        delegationId: "del-1",
      }),
    ).toEqual({
      sessionId: "s".repeat(MAX_SESSION_LINK_ID_LENGTH),
      agentId: "a-1",
      workflowRunId: "wf-1",
      delegationId: "del-1",
    });

    expectSyncInvalidParams(() => parseSessionParentLink("bad"));
    expectSyncInvalidParams(() => parseSessionParentLink([]));
    expectSyncInvalidParams(() => parseSessionParentLink({ parentSessionId: "wrong-key" }));
    expectSyncInvalidParams(() => parseSessionParentLink({ actor: { kind: "prism", agent: "a" } }));
    expectSyncInvalidParams(() => parseSessionParentLink({ sessionId: "" }));
    expectSyncInvalidParams(() =>
      parseSessionParentLink({ sessionId: "s".repeat(MAX_SESSION_LINK_ID_LENGTH + 1) }),
    );
    expectSyncInvalidParams(() =>
      parseSessionParentLink({ workflowRunId: "w".repeat(MAX_SESSION_LINK_ID_LENGTH + 1) }),
    );

    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const agent = await build();
    const { client, served } = await connectTestClient(agent, ui);

    await expectInvalidParams(
      client.call("sessions.open", { parent: { extra: "nope" } }),
    );
    await expectInvalidParams(
      client.call("sessions.open", { parent: { sessionId: "s".repeat(MAX_SESSION_LINK_ID_LENGTH + 1) } }),
    );
    const opened = (await client.call("sessions.open", {
      parent: { sessionId: "parent-ok", workflowRunId: "wf-ok" },
    })) as { sessionId: string };
    expect(opened.sessionId).toBeTruthy();

    await served.close();
    await agent.dispose();
  });

  test("no_unvalidated_casts_on_wire_input", () => {
    const serveSource = readFileSync(new URL("../serve.ts", import.meta.url), "utf8");
    const wireSource = readFileSync(new URL("../wire.ts", import.meta.url), "utf8");

    expect(serveSource).toContain('from "./wire.js"');
    expect(serveSource).not.toContain("as never");
    expect(wireSource).not.toContain("as never");
    expect(serveSource).not.toContain("as unknown as readonly Decision[]");
    expect(wireSource).not.toContain("as unknown as readonly Decision[]");
  });
});
