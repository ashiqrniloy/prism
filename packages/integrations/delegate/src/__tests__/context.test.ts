import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
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
import delegate, { DELEGATE_SERVICE, type DelegateService, HARD_CONTEXT_MAX_CHARS, resolveChildContext } from "../index.js";

interface Rec {
  readonly kind: "parent" | "child" | "summary";
  readonly tools: readonly string[];
  readonly models: string;
  readonly messages: string;
}

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

function mock(record: Rec[], options: { summary?: string; summaryFails?: boolean; childAnswer?: string } = {}): ModelProvider {
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const messages = JSON.stringify(request.messages);
      const tools = (request.tools ?? []).map((tool) => tool.name);
      if (messages.includes("Summarize this conversation")) {
        record.push({ kind: "summary", tools, models: request.model.model, messages });
        if (options.summaryFails === true) throw new Error("summary provider exploded");
        yield providerTextDelta(options.summary ?? "the gist of the conversation");
      } else if (tools.includes("delegate")) {
        record.push({ kind: "parent", tools, models: request.model.model, messages });
        if (messages.includes("please mark")) yield providerToolCall(toolCallContent("call_mark", "mark_state", {} as never));
        else yield providerTextDelta("parent answer");
      } else {
        record.push({ kind: "child", tools, models: request.model.model, messages });
        yield providerTextDelta(options.childAnswer ?? "child answer");
      }
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
}

const statePackage = definePackage({
  name: "state-package",
  version: "0.12.1",
  requires: { api: 1 },
  capabilities: ["session-state"],
  setup(prism) {
    const handle = prism.state.session("state-package", { marker: "initial" as string });
    prism.tools.register({
      name: "mark_state",
      description: "stamps package state",
      execute: (_args, ctx) => {
        void handle.set(ctx.session as never, { marker: "parent-state-marker" });
        return { toolCallId: ctx.toolCallId, name: "mark_state", content: [{ type: "text", text: "marked" }] };
      },
    });
  },
});

let captured: DelegateService | undefined;
const serviceConsumer = definePackage({
  name: "service-consumer",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    captured = prism.services.consume<DelegateService>(DELEGATE_SERVICE);
  },
});

async function build(options: {
  record?: Rec[];
  children: Record<string, unknown>;
  providerOptions?: { summary?: string; summaryFails?: boolean; childAnswer?: string };
  extra?: readonly unknown[];
  store?: ReturnType<typeof createMemorySessionStore>;
  consumeService?: boolean;
  redactor?: ReturnType<typeof createSecretRedactor>;
}): Promise<Agent> {
  const agent = await createAgent({
    id: "context-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: options.store ?? createMemorySessionStore() },
    ...(options.redactor === undefined ? {} : { redactor: options.redactor }),
    packages: [
      providerPackage("mock-provider", [mock(options.record ?? [], options.providerOptions)]),
      ...((options.extra ?? []) as never[]),
      delegate({ children: options.children } as never),
      ...(options.consumeService === false ? [] : [serviceConsumer]),
    ],
  });
  agents.push(agent);
  return agent;
}

/** The session as a package sees it; a test has a `Session`, a package gets a `SessionContext`. */
function contextOf(session: Session): SessionContext {
  return {
    id: session.id,
    model: { provider: "mock", model: "m" },
    entries: () => session.entries(),
    background: () => undefined,
  };
}

const childTurns = (record: readonly Rec[]) => record.filter((entry) => entry.kind === "child");

describe("delegate context", () => {
  it("child_with_last_turns_sees_parent_history", async () => {
    const record: Rec[] = [];
    const agent = await build({ record, children: { reviewer: { inherit: [], context: { lastTurns: 4, maxChars: 20_000 } } } });
    const session = await agent.session();
    await session.run("parent earlier question about widgets");
    const outcome = await (captured as DelegateService).start({ child: "reviewer", input: "the brief", mode: "sync", session: contextOf(session) });
    assert.ok("status" in outcome && outcome.status === "completed", JSON.stringify(outcome));
    const child = childTurns(record).at(-1);
    assert.ok(child);
    assert.match(child.messages, /parent earlier question about widgets/);
    assert.match(child.messages, /the brief/, "the brief follows the seeded history");
    if ("context" in outcome) assert.deepEqual({ mode: outcome.context?.mode, turns: outcome.context?.turns }, { mode: "lastTurns", turns: 1 });
  });

  it("child_without_context_starts_blind", async () => {
    const record: Rec[] = [];
    const agent = await build({ record, children: { reviewer: { inherit: [] } } });
    const session = await agent.session();
    await session.run("parent earlier question about widgets");
    const outcome = await (captured as DelegateService).start({ child: "reviewer", input: "the brief", mode: "sync", session: contextOf(session) });
    assert.equal((outcome as { context?: unknown }).context, undefined, "no context reported");
    const child = childTurns(record).at(-1);
    assert.ok(child);
    assert.equal(child.messages.includes("widgets"), false);
    assert.match(child.messages, /the brief/);
  });

  it("child_summary_context_makes_one_call_and_seeds_summary", async () => {
    const record: Rec[] = [];
    const agent = await build({ record, children: { researcher: { inherit: [], context: "summary" } }, providerOptions: { summary: "A summary marker sentence." } });
    const session = await agent.session();
    await session.run("parent earlier question about widgets");
    const outcome = await (captured as DelegateService).start({ child: "researcher", input: "the brief", mode: "sync", session: contextOf(session) });
    assert.ok("status" in outcome && outcome.status === "completed");
    assert.equal(record.filter((entry) => entry.kind === "summary").length, 1);
    const child = childTurns(record).at(-1);
    assert.ok(child);
    assert.match(child.messages, /A summary marker sentence\./);
    assert.equal(child.messages.includes("widgets"), false, "the child reads the summary, not the transcript");
  });

  it("summary_failure_fails_delegation_before_child_runs", async () => {
    const record: Rec[] = [];
    const agent = await build({ record, children: { researcher: { inherit: [], context: "summary" } }, providerOptions: { summaryFails: true } });
    const session = await agent.session();
    await session.run("parent earlier question");
    const outcome = await (captured as DelegateService).start({ child: "researcher", input: "the brief", mode: "sync", session: contextOf(session) });
    assert.ok("status" in outcome);
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error ?? "", /context_unavailable/);
    assert.equal(childTurns(record).length, 0, "the child model was never called");
  });

  it("child_context_never_hydrates_parent_package_state", async () => {
    const record: Rec[] = [];
    const agent = await build({
      record,
      extra: [statePackage],
      children: { reviewer: { inherit: ["state-package"], context: { lastTurns: 6 } } },
    });
    const session = await agent.session();
    await session.run("please mark the state");
    const outcome = await (captured as DelegateService).start({ child: "reviewer", input: "the brief", mode: "sync", session: contextOf(session) });
    assert.ok("status" in outcome && outcome.status === "completed");
    const child = childTurns(record).at(-1);
    assert.ok(child);
    assert.equal(child.messages.includes("parent-state-marker"), false, "a package_state entry never reaches the child");
  });

  it("secret_in_parent_history_reaches_the_child_redacted", async () => {
    const record: Rec[] = [];
    const agent = await build({
      record,
      children: { reviewer: { inherit: [], context: { lastTurns: 6 } } },
      redactor: createSecretRedactor(["super-secret-value"]),
    });
    const session = await agent.session();
    await session.run("the token is super-secret-value");
    const outcome = await (captured as DelegateService).start({ child: "reviewer", input: "the brief", mode: "sync", session: contextOf(session) });
    assert.ok("status" in outcome && outcome.status === "completed");
    const child = childTurns(record).at(-1);
    assert.ok(child);
    assert.equal(child.messages.includes("super-secret-value"), false);
    assert.match(child.messages, /REDACTED/);
  });

  it("delegate_description_marks_children_that_see_conversation", async () => {
    const agent = await build({
      children: {
        reviewer: { inherit: [], description: "Reviews a diff.", context: { lastTurns: 6 } },
        researcher: { inherit: [], description: "Researches.", context: "summary" },
        coder: { inherit: [], description: "Writes code." },
      },
    });
    const tool = agent.tools.find((entry) => entry.name === "delegate") as { description: string } | undefined;
    assert.ok(tool);
    assert.match(tool.description, /- reviewer: Reviews a diff\. \(sees the last 6 turns of this conversation\)/);
    assert.match(tool.description, /- researcher: Researches\. \(sees a summary of this conversation\)/);
    assert.match(tool.description, /- coder: Writes code\.$/m);
    assert.match(tool.description, /The child sees only your input unless its line says it sees this conversation\./);
  });

  it("context_max_chars_above_cap_clamped_with_note", async () => {
    assert.deepEqual(resolveChildContext({ lastTurns: 2, maxChars: HARD_CONTEXT_MAX_CHARS + 1 }), {
      mode: "lastTurns",
      lastTurns: 2,
      maxChars: HARD_CONTEXT_MAX_CHARS,
      clamped: true,
    });
    const agent = await build({ children: { reviewer: { inherit: [], context: { lastTurns: 2, maxChars: HARD_CONTEXT_MAX_CHARS + 50_000 } } } });
    assert.ok(agent.inspect().statusNotes.some((note) => note.level === "info" && new RegExp(`using ${HARD_CONTEXT_MAX_CHARS} chars`).test(note.message)));
  });

  it("context_invalid_shape_fails_config_validation", async () => {
    await assert.rejects(() => build({ children: { reviewer: { inherit: [], context: { maxChars: 1000 } } } }), /children\/reviewer\/context/);
    await assert.rejects(() => build({ children: { reviewer: { inherit: [], context: { lastTurns: 51 } } } }), /children\/reviewer\/context/);
    await assert.rejects(() => build({ children: { reviewer: { inherit: [], context: "everything" } } }), /children\/reviewer\/context/);
  });
});
