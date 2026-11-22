import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type Session,
  type SessionContext,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import delegate, { DELEGATE_SERVICE, type DelegateService } from "../index.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

const schemas: unknown[] = [];

const mock: ModelProvider = {
  id: "mock",
  async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    const tools = (request.tools ?? []).map((tool) => tool.name);
    if (tools.includes("delegate")) schemas.push(request.tools?.find((tool) => tool.name === "delegate"));
    const last = JSON.stringify(request.messages.at(-1)?.content ?? "");
    if (tools.includes("delegate")) {
      // One parent turn names `child` through the tool, the next answers from the result.
      const call = /delegate the (\w+)/.exec(last);
      if (call) yield providerToolCall(toolCallContent("call_d", "delegate", { child: call[1], input: "do it" } as never));
      else yield providerTextDelta("parent answer");
    } else yield providerTextDelta("child answer");
    yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
  },
};

let captured: DelegateService | undefined;
let view: SessionContext | undefined;
const consumer = definePackage({
  name: "service-consumer",
  version: "0.12.1",
  requires: { api: 1 },
  capabilities: ["background", "session-state"],
  setup(prism) {
    captured = prism.services.consume<DelegateService>(DELEGATE_SERVICE);
    // The kernel's own view of a session, as a package gets it: `chargeTo` accepts nothing else.
    prism.commands.register({
      name: "capture-session",
      description: "test only",
      run: (_args, context) => {
        view = context.session;
      },
    });
  },
});

async function build(children: Record<string, unknown>, maxConcurrent?: number): Promise<Agent> {
  const agent = await createAgent({
    id: "service-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("mock-provider", [mock]),
      // `queueTimeoutMs: 0` keeps the immediate refusal these tests assert.
      delegate({ children, queueTimeoutMs: 0, ...(maxConcurrent === undefined ? {} : { maxConcurrent }) } as never),
      consumer,
    ],
  });
  agents.push(agent);
  return agent;
}

/** The session as a package sees it: the kernel's view, captured through a command of the consumer package. */
async function contextOf(agent: Agent, session: Session): Promise<SessionContext> {
  view = undefined;
  await agent.commands.run("capture-session", {}, { session });
  assert.ok(view, "the command saw the session");
  return view;
}

describe("delegate service", () => {
  it("delegate_sync_child_turns_are_charged_to_the_parent_run", async () => {
    // Plan 225 Task 5: the child's provider bridge carries the delegating session, so a synchronous child's turn is
    // part of the parent's run usage (two parent turns of 2 tokens plus one child turn of 2).
    const agent = await build({ reviewer: { inherit: [] } });
    const session = await agent.session();
    const result = await session.run("delegate the reviewer");
    assert.equal(result.status, "completed");
    assert.equal(result.usage?.totalTokens, 6, "both parent turns and the child's turn");
  });

  it("delegate_service_runs_configured_child", async () => {
    const agent = await build({ reviewer: { inherit: [] } });
    const session = await agent.session();
    const outcome = await (captured as DelegateService).start({
      child: "reviewer",
      input: "review it",
      mode: "sync",
      session: await contextOf(agent, session),
    });
    assert.ok("status" in outcome);
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.child, "reviewer");
    assert.match(outcome.text, /child answer/);
    assert.equal(outcome.turns, 1);
  });

  it("delegate_service_async_needs_a_wait", async () => {
    const agent = await build({ reviewer: { inherit: [] } });
    const session = await agent.session();
    const service = captured as DelegateService;
    const started = await service.start({ child: "reviewer", input: "review it", mode: "async", session: await contextOf(agent, session) });
    assert.ok("delegationId" in started);
    const outcome = await service.wait(started.delegationId, await contextOf(agent, session));
    assert.equal(outcome.status, "completed");
    assert.match(outcome.text, /child answer/);
  });

  it("delegate_service_shares_concurrency_with_the_tool", async () => {
    const agent = await build({ reviewer: { inherit: [] } }, 1);
    const session = await agent.session();
    const service = captured as DelegateService;
    const running = service.start({ child: "reviewer", input: "x", mode: "sync", session: await contextOf(agent, session) });
    await assert.rejects(
      async () => service.start({ child: "reviewer", input: "y", mode: "sync", session: await contextOf(agent, session) }),
      /At most 1/,
    );
    const outcome = await running;
    assert.ok("status" in outcome && outcome.status === "completed");
  });

  it("delegate_service_requires_session", async () => {
    await build({ reviewer: { inherit: [] } });
    await assert.rejects(
      () => (captured as DelegateService).start({ child: "reviewer", input: "x", mode: "sync", session: undefined as never }),
      /session_required/,
    );
  });

  it("delegate_service_rejects_unknown_child", async () => {
    const agent = await build({ reviewer: { inherit: [] } });
    const session = await agent.session();
    await assert.rejects(
      async () =>
        (captured as DelegateService).start({ child: "made-up", input: "x", mode: "sync", session: await contextOf(agent, session) }),
      /Unknown child/,
    );
  });

  it("delegate_service_does_not_widen_capabilities", async () => {
    const agent = await build({ reviewer: { inherit: [] } });
    const session = await agent.session();
    // The start input has no field for packages, model, or limits: extra keys are ignored, not honoured.
    const outcome = await (captured as DelegateService).start({
      child: "reviewer",
      input: "x",
      mode: "sync",
      session: await contextOf(agent, session),
      inherit: ["@arnilo/prism-tools/coding"],
    } as never);
    assert.ok("status" in outcome && outcome.status === "completed");
  });

  it("hidden_child_absent_from_tool_and_unreachable_by_model", async () => {
    const agent = await build({
      reviewer: { inherit: [], description: "Reviews." },
      verifier: { inherit: [], description: "Verifies.", hidden: true },
    });
    const session = await agent.session();
    const result = await session.run("delegate the verifier");
    const tool = schemas.at(-1) as { description: string; parameters: { properties: { child: { enum: string[] } } } };
    assert.equal(tool.description.includes("verifier"), false);
    assert.deepEqual(tool.parameters.properties.child.enum, ["reviewer"]);
    assert.match(JSON.stringify(result), /\/child: must be one of the allowed values/);

    const outcome = await (captured as DelegateService).start({
      child: "verifier",
      input: "check it",
      mode: "sync",
      session: await contextOf(agent, session),
    });
    assert.ok("status" in outcome && outcome.status === "completed", "the service still starts it");
  });

  it("all_hidden_children_registers_no_tools_but_provides_service", async () => {
    const agent = await build({ verifier: { inherit: [], hidden: true } });
    assert.equal(
      agent.tools.some((entry) => entry.name === "delegate"),
      false,
    );
    assert.equal(
      agent.tools.some((entry) => entry.name === "delegate_wait"),
      false,
    );
    assert.ok(agent.inspect().statusNotes.some((note) => note.level === "info" && /Every delegate child is hidden/.test(note.message)));
    const session = await agent.session();
    const outcome = await (captured as DelegateService).start({
      child: "verifier",
      input: "check",
      mode: "sync",
      session: await contextOf(agent, session),
    });
    assert.ok("status" in outcome && outcome.status === "completed");
  });
});
