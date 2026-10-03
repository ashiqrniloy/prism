import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  askEveryTool,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  toolCallContent,
  type AgentConfig,
  type AgentEvent,
  type Session,
  type HostUi,
  type HostUiRequest,
  type HostUiResponse,
  type JsonObject,
  loadSuspendedRunEntry,
  resumeAgentRun,
  type Decision,
} from "../index.js";
import { agentHookIds } from "../agent-session/runtime-registry.js";
import { agentRuntime } from "../agent-session/create-agent.js";

const MODEL = { provider: "mock", model: "demo" } as const;

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function agentFor(
  config: Partial<AgentConfig> & {
    readonly host?: AgentConfig["host"];
    readonly ask?: string;
    readonly args?: JsonObject;
  },
) {
  const { ask, args, ...rest } = config;
  let calls = 0;
  const agent = await createAgent({
    id: "ask-agent",
    model: MODEL,
    ...rest,
    ...(ask ? { hooks: (hooks: Parameters<NonNullable<AgentConfig["hooks"]>>[0]) => hooks.on("tool.call", () => ({ ask })) } : {}),
    provider: (() => {
      let turn = 0;
      return {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", args ?? { value: "ok" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      };
    })(),
    tools: {
      add: [
        {
          name: "write",
          parameters: {},
          execute: () => {
            calls += 1;
            return { toolCallId: "call-1", name: "write", value: "done" };
          },
        },
      ],
    },
  });
  return { agent, calls: () => calls };
}

function ui(answer: HostUiResponse<"confirm">, seen: HostUiRequest[] = []): HostUi {
  return {
    async request(request: HostUiRequest) {
      seen.push(request);
      return answer;
    },
  } as HostUi;
}
describe("ask resolution", () => {
  it("ask_with_ui_confirm_true_executes", async () => {
    const seen: HostUiRequest[] = [];
    const { agent, calls } = await agentFor({ ask: "Approve?", host: { ui: ui({ status: "answered", value: true }, seen) } });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(calls(), 1);
    const request = seen[0] as Extract<HostUiRequest, { kind: "confirm" }>;
    assert.equal(request.kind, "confirm");
    assert.match(request.title, /write/);
    assert.match(request.detail ?? "", /Approve\?/);
  });

  it("ask_with_ui_confirm_false_denies", async () => {
    const store = createMemorySessionStore();
    const { agent, calls } = await agentFor({ ask: "Approve?", slots: { store }, host: { ui: ui({ status: "answered", value: false }) } });
    const session = await agent.session();
    const result = await session.run("go");
    assert.equal(result.status, "completed");
    assert.equal(calls(), 0);
    assert.match(JSON.stringify(await session.entries()), /hook_denied/);
  });

  it("ask_with_ui_dismissed_denies", async () => {
    const { agent, calls } = await agentFor({ ask: "Approve?", host: { ui: ui({ status: "dismissed" }) } });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(calls(), 0);
  });

  it("ask_without_ui_suspends", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const { agent, calls } = await agentFor({ ask: "Approve?" });
    const session = await agent.session();
    const result = await session.run("go", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(result.status, "suspended");
    assert.equal(calls(), 0);
    assert.equal(result.runState?.interruption?.toolCallId, "call-1");
    assert.equal(result.pending?.length, 1);
    assert.equal(result.pending?.[0]?.reason, "Approve?");
  });

  it("ask_ui_unavailable_suspends", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const { agent, calls } = await agentFor({ ask: "Approve?", host: { ui: ui({ status: "unavailable" }) } });
    const result = await (await agent.session()).run("go", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(result.status, "suspended");
    assert.equal(calls(), 0);
  });

  it("ask_confirm_detail_is_redacted", async () => {
    const seen: HostUiRequest[] = [];
    const secret = "super-secret-token-value";
    const redactor = createSecretRedactor([secret]);
    const { agent } = await agentFor({
      ask: "Approve?",
      args: { token: secret },
      host: { ui: ui({ status: "answered", value: false }, seen) },
      redactor,
    });
    await (await agent.session()).run("go");
    const request = seen[0] as Extract<HostUiRequest, { kind: "confirm" }>;
    assert.doesNotMatch(request.detail ?? "", new RegExp(secret));
  });

  it("suspended run writes a suspended_run entry and resumes from it", async () => {
    const store = createMemorySessionStore();
    const { agent, calls } = await agentFor({ ask: "Approve?", slots: { store } });
    const session = await agent.session({ id: "s", create: true });
    // No `runState`: a suspension needs no host checkpoint store, the store-slot entry is the anchor.
    const first = await session.run("go");
    assert.equal(first.status, "suspended");
    assert.equal(first.pending?.length, 1);
    const entry = await loadSuspendedRunEntry(store, "s");
    assert.ok(entry);
    assert.equal(entry.loop.name, "default");
    assert.deepEqual([...entry.hookIds].sort(), ["host:tool.call", "kernel:context.build"]);
    assert.equal(entry.interruption.toolCallId, "call-1");
    // The same live session resumes from the entry on its own branch.
    const events: string[] = [];
    for await (const event of session.resume(
      first.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
    )) {
      events.push(event.type);
    }
    assert.ok(events.includes("decision.resolved"));
    assert.equal(events.at(-1), "run.completed");
    assert.equal(calls(), 1);
  });

  it("resumes a suspended run in a fresh agent over the same store", async () => {
    const store = createMemorySessionStore();
    const { agent } = await agentFor({ ask: "Approve?", slots: { store } });
    const first = await (await agent.session({ id: "s", create: true })).run("go");
    assert.equal(first.status, "suspended");
    const entry = await loadSuspendedRunEntry(store, "s");
    assert.ok(entry);
    // A brand-new agent over the same store resumes from the entry alone: the pending call is
    // replayed from the entry, so the fresh provider only supplies the final text turn.
    let executed = 0;
    const fresh = await createAgent({
      id: "ask-agent",
      model: MODEL,
      slots: { store },
      hooks: askEveryTool(),
      provider: createMockProvider([providerTextDelta("done"), providerDone()]),
      tools: {
        add: [
          {
            name: "write",
            parameters: {},
            execute: () => {
              executed += 1;
              return { toolCallId: "call-1", name: "write", value: "done" };
            },
          },
        ],
      },
    });
    const resumed = await fresh.session({ id: "s" });
    const events: AgentEvent[] = [];
    for await (const event of resumed.resume(
      first.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
    )) {
      events.push(event);
    }
    assert.equal(events.at(-1)?.type, "run.completed");
    assert.equal(executed, 1);
  });

  it("hook_id_drift_fails_closed", async () => {
    const store = createMemorySessionStore();
    const { agent } = await agentFor({ ask: "Approve?", slots: { store } });
    const first = await (await agent.session({ id: "s", create: true })).run("go");
    assert.equal(first.status, "suspended");
    // Same store, but the resumed agent has no `tool.call` gate: the hook-id set drifted.
    const { agent: drifted } = await agentFor({ slots: { store } });
    const session = await drifted.session({ id: "s" });
    await assert.rejects(
      collect(session.resume(first.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })))),
      /fingerprint mismatch/,
    );
  });

  it("agent_hook_ids_are_owner_scoped_and_skip_session_hooks", async () => {
    const store = createMemorySessionStore();
    const { agent } = await agentFor({ ask: "Approve?", slots: { store } });
    assert.deepEqual(agentHookIds(agent), ["host:tool.call", "kernel:context.build"]);
    // A session registers `kernel:*#session-<n>` pack hooks; the fingerprint ids ignore them.
    const session = await agent.session({ id: "s", create: true });
    assert.ok(
      agentRuntime(agent)
        .hooks.registrations()
        .some((registration) => registration.owner === "kernel" && registration.id.includes("#session-")),
    );
    assert.deepEqual(agentHookIds(agent), ["host:tool.call", "kernel:context.build"]);
    const first = await session.run("go");
    assert.equal(first.status, "suspended");
    // Same hook name, same count, different owner: the id set drifted, so resume fails closed.
    const { agent: other } = await agentFor({ slots: { store } });
    agentRuntime(other)
      .hooks.registrar("pkg-b")
      .on("tool.call", () => ({ ask: "Approve?" }));
    assert.deepEqual(agentHookIds(other), ["kernel:context.build", "pkg-b:tool.call"]);
    await assert.rejects(
      collect(
        (await other.session({ id: "s" })).resume(
          first.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
        ),
      ),
      /fingerprint mismatch/,
    );
  });

  it("suspended ask resumes and executes once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    const { agent, calls } = await agentFor({ ask: "Approve?", slots: { store } });
    const first = await (await agent.session()).run("go", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(first.status, "suspended");
    const resumed = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      { decision: "approve", expectedVersion: first.runState!.version! },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "completed");
    assert.equal(calls(), 1);
  });
});
