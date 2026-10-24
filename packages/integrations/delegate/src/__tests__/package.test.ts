import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type LoopStrategy,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createScriptedHostUi, packageConformance } from "@arnilo/prism/testing";
import delegate, { DEFAULT_CHILD_LIMITS, delegateStepData, HARD_CHILD_LIMITS, resolveChildLimits } from "../index.js";

interface Seen {
  readonly tools: string[];
  readonly text: string;
}

/** Parent turns (the request lists `delegate`) call the delegate tool, then answer from its result. Child turns answer or call `child_tool`. */
interface ScriptOptions {
  readonly childAnswer?: string;
  readonly waitOffset?: boolean;
  readonly waitTwice?: boolean;
  readonly unknownWait?: boolean;
}

function scripted(delegateArgs: Record<string, unknown>, seen: Seen[], childCallsTool = false, waitAfter = false, options: ScriptOptions = {}): ModelProvider {
  let parentCalls = 0;
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const last = request.messages.at(-1);
      const lastText = JSON.stringify(last?.content ?? "");
      seen.push({ tools, text: lastText });
      if (tools.includes("delegate")) {
        parentCalls += 1;
        if (parentCalls === 1) yield providerToolCall(toolCallContent("call_d", "delegate", delegateArgs as never));
        else if (options.unknownWait && parentCalls === 2) yield providerToolCall(toolCallContent("call_w", "delegate_wait", { delegationId: "dlg_missing" }));
        else if (options.waitOffset && parentCalls <= 3) {
          const id = /dlg_[\w]+/.exec(lastText)?.[0] ?? "missing";
          const offset = Number(/offset:\s*(\d+)/.exec(lastText)?.[1] ?? "0");
          yield providerToolCall(toolCallContent("call_w", "delegate_wait", { delegationId: id, offset }));
        } else if (options.waitTwice && parentCalls <= 3) {
          const id = /dlg_[\w]+/.exec(lastText)?.[0] ?? "missing";
          yield providerToolCall(toolCallContent(`call_w${parentCalls}`, "delegate_wait", { delegationId: id }));
        } else if (waitAfter && parentCalls === 2) {
          const id = /dlg_[\w]+/.exec(lastText)?.[0] ?? "missing";
          yield providerToolCall(toolCallContent("call_w", "delegate_wait", { delegationId: id }));
        } else yield providerTextDelta(`parent saw: ${lastText}`);
      } else if (childCallsTool && last?.role === "user") {
        yield providerToolCall(toolCallContent("call_c", "child_tool", {}));
      } else {
        yield providerTextDelta(options.childAnswer ?? "child answer");
      }
      yield providerDone({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    },
  };
}

const childTools = definePackage({
  name: "child-tools",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({ name: "child_tool", description: "child only", execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "child_tool", content: [{ type: "text", text: "ok" }] }) });
  },
});

const otherTools = definePackage({
  name: "other-tools",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({ name: "other_tool", description: "parent only", execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "other_tool", content: [] }) });
  },
});

const askingPackage = definePackage({
  name: "asking-hooks",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.hooks.on("tool.call", (payload) => (payload.name === "child_tool" ? { ask: "needs approval" } : "allow"));
  },
});

const stepLog: Record<string, unknown>[] = [];

async function build(options: {
  delegateArgs: Record<string, unknown>;
  seen?: Seen[];
  children?: Record<string, unknown>;
  extra?: unknown[];
  childCallsTool?: boolean;
  waitAfter?: boolean;
  loop?: LoopStrategy;
  childAnswer?: string;
  waitOffset?: boolean;
  unknownWait?: boolean;
  waitTwice?: boolean;
  host?: unknown;
  skills?: unknown;
}) {
  stepLog.length = 0;
  const seen = options.seen ?? [];
  return createAgent({
    id: "delegate-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore(), ...(options.loop === undefined ? {} : { loop: options.loop }) },
    ...((options.host ?? options.skills) === undefined
      ? {}
      : { ...(options.host === undefined ? {} : { host: options.host }), ...(options.skills === undefined ? {} : { skills: options.skills }) } as never),
    hooks: (hooks) =>
      hooks.on("package.event", (event) => {
        if (event.name === "delegate.step") stepLog.push(event.data as Record<string, unknown>);
      }),
    packages: [
      providerPackage("mock-provider", [
        scripted(options.delegateArgs, seen, options.childCallsTool, options.waitAfter, {
          ...(options.childAnswer === undefined ? {} : { childAnswer: options.childAnswer }),
          ...(options.waitOffset === true ? { waitOffset: true } : {}),
          ...(options.unknownWait === true ? { unknownWait: true } : {}),
          ...(options.waitTwice === true ? { waitTwice: true } : {}),
        }),
      ]),
      childTools,
      otherTools,
      ...((options.extra ?? []) as never[]),
      delegate({ children: (options.children ?? { reviewer: { inherit: ["child-tools"], instructions: "Review." } }) as never }),
    ],
  });
}

async function collect(agent: Awaited<ReturnType<typeof build>>, input = "go") {
  const session = await agent.session();
  const events: AgentEvent[] = [];
  const sub = session.subscribe();
  const pump = (async () => {
    for await (const event of sub) events.push(event);
  })();
  const result = await session.run(input);
  await pump;
  return { result, events };
}

const steps = (_events?: AgentEvent[]) => stepLog.splice(0, stepLog.length);

/** The child turn's system prompt, to assert which skills it was given (progressive disclosure lists them). */
async function childSystemPrompt(children: Record<string, unknown>, extraSkills: { brief?: boolean; verbose?: boolean } = {}): Promise<string> {
  const systems: string[] = [];
  let parentCalls = 0;
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      if (tools.includes("delegate")) {
        parentCalls += 1;
        if (parentCalls === 1) yield providerToolCall(toolCallContent("call_d", "delegate", { child: "reviewer", input: "x" } as never));
        else yield providerTextDelta("done");
      } else {
        systems.push(JSON.stringify(request.messages));
        yield providerTextDelta("child answer");
      }
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
  const skills = [
    { name: "brief", description: "Answer briefly.", instructions: "Answer briefly." },
    ...(extraSkills.verbose === true ? [{ name: "verbose", description: "Explain fully.", instructions: "Explain fully." }] : []),
  ];
  const agent = await createAgent({
    id: "skills-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    ...(extraSkills.brief === false ? {} : { skills: { add: skills } }),
    packages: [providerPackage("mock-provider", [provider]), delegate({ children: children as never })],
  });
  const session = await agent.session();
  await session.run("go");
  await agent.dispose();
  return systems[0] ?? "";
}

describe("delegate package", () => {
  it("delegate_package_conformance", async () => {
    const result = await packageConformance(delegate, { config: { children: { reviewer: { inherit: [] } } } });
    assert.deepEqual(result.checks.filter((check) => !check.ok), []);
    assert.equal(result.ok, true);
  });

  it("delegate_child_inherits_only_named_packages", async () => {
    const seen: Seen[] = [];
    const agent = await build({ delegateArgs: { child: "reviewer", input: "review it" }, seen });
    const { result, events } = await collect(agent);
    assert.equal(result.status, "completed");
    assert.match(result.text, /child answer/);
    const childTurn = seen.find((entry) => !entry.tools.includes("delegate"));
    assert.ok(childTurn);
    assert.ok(childTurn.tools.includes("child_tool"));
    assert.ok(!childTurn.tools.includes("other_tool"));
    assert.ok(!childTurn.tools.includes("delegate"));
    const parentTurn = seen.find((entry) => entry.tools.includes("delegate"));
    assert.ok(parentTurn?.tools.includes("other_tool"));
    assert.deepEqual(steps(events).map((step) => step.phase), ["started", "finished"]);
    await agent.dispose();
  });

  it("delegate_description_lists_child_descriptions", async () => {
    const seen: Seen[] = [];
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      seen,
      children: {
        reviewer: { inherit: [], description: "Reviews a diff for correctness bugs." },
        tester: { inherit: [], instructions: "Runs the test suite. Reports failures only." },
      },
    });
    const { result } = await collect(agent);
    assert.equal(result.status, "completed");
    const parent = seen.find((entry) => entry.tools.includes("delegate"));
    assert.ok(parent);
    const tool = (agent.tools.find((entry) => entry.name === "delegate") as { description: string } | undefined)!;
    assert.match(tool.description, /^Run a child agent on a task\. The child sees only your input unless its line says it sees this conversation\. Children:/);
    assert.match(tool.description, /- reviewer: Reviews a diff for correctness bugs\./);
    // No `description`: the first sentence of `instructions`, not the whole text.
    assert.match(tool.description, /- tester: Runs the test suite\./);
    assert.equal(tool.description.includes("Reports failures only."), false);
    await agent.dispose();
  });

  it("child_without_description_uses_placeholder_and_notes", async () => {
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" }, children: { reviewer: { inherit: [] } } });
    const tool = agent.tools.find((entry) => entry.name === "delegate");
    assert.match(tool?.description ?? "", /- reviewer: \(no description\)/);
    const notes = agent.inspect().statusNotes.filter((note) => note.message.includes("has no description"));
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.level, "info");
    await agent.dispose();
  });

  it("delegate_input_is_described_as_self_contained", async () => {
    const captured: { parameters: { properties: Record<string, { description?: string }> } }[] = [];
    const inner = scripted({ child: "reviewer", input: "x" }, []);
    const capturing: ModelProvider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const delegate = (request.tools ?? []).find((tool) => tool.name === "delegate");
        if (delegate) captured.push(delegate as unknown as { parameters: { properties: Record<string, { description?: string }> } });
        yield* inner.generate(request);
      },
    };
    const agent = await createAgent({
      id: "schema-parent",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("mock-provider", [capturing]), delegate({ children: { reviewer: { inherit: [] } } })],
    });
    const session = await agent.session();
    await session.run("go");
    const parameters = captured[0]?.parameters.properties;
    assert.match(parameters?.input?.description ?? "", /self-contained brief/);
    assert.match(parameters?.input?.description ?? "", /cannot ask you follow-up questions/);
    assert.match(parameters?.mode?.description ?? "", /^sync waits for the result; async returns a delegationId/);
    await agent.dispose();
  });

  it("delegate_result_text_has_status_line", async () => {
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" } });
    const { result } = await collect(agent);
    assert.match(result.text, /child answer/);
    assert.match(result.text, /\[child reviewer: completed, 1 turn, 5 tokens\]/);
    await agent.dispose();
  });

  it("default_child_instruction_asks_for_concise_report", async () => {
    const requests: { tools: string[]; text: string }[] = [];
    let parentCalls = 0;
    const recording: ModelProvider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const tools = (request.tools ?? []).map((tool) => tool.name);
        requests.push({ tools, text: JSON.stringify(request.messages) });
        if (tools.includes("delegate")) {
          parentCalls += 1;
          if (parentCalls === 1) yield providerToolCall(toolCallContent("call_d", "delegate", { child: "reviewer", input: "x" } as never));
          else yield providerTextDelta("done");
        } else yield providerTextDelta("child answer");
        yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
      },
    };
    const agent = await createAgent({
      id: "instruction-parent",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("mock-provider", [recording]), delegate({ children: { reviewer: { inherit: [], instructions: "Review." } } })],
    });
    const session = await agent.session();
    await session.run("go");
    // The child is the turn that does not advertise `delegate`.
    const childRequest = requests.find((entry) => !entry.tools.includes("delegate"));
    assert.ok(childRequest, "the child turn ran");
    assert.match(childRequest.text, /Finish with a concise report for the parent/);
    assert.ok(
      childRequest.text.indexOf("Finish with a concise report") < childRequest.text.indexOf("Review."),
      "the report contract comes before the host's own instructions",
    );
    await agent.dispose();
  });

  it("delegate_unknown_child_is_tool_error", async () => {
    const agent = await build({ delegateArgs: { child: "nope", input: "x" } });
    const { result, events } = await collect(agent);
    assert.equal(result.status, "completed");
    const completed = events.find((event) => event.type === "tool.completed");
    assert.ok(completed && JSON.stringify(completed).includes("Unknown child"));
    assert.deepEqual(steps(events), []);
    await agent.dispose();
  });

  it("delegate_unknown_inherit_fails_closed", async () => {
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      children: { reviewer: { inherit: ["not-loaded"] } },
    });
    const { events } = await collect(agent);
    const failed = steps(events).find((step) => step.phase === "error");
    assert.ok(failed);
    await agent.dispose();
  });

  it("delegate_child_cannot_inherit_itself", async () => {
    await assert.rejects(
      createAgent({
        id: "self",
        model: { provider: "mock", model: "m" },
        slots: { store: createMemorySessionStore() },
        packages: [providerPackage("mock-provider", [scripted({}, [])]), delegate({ children: { c: { inherit: ["@arnilo/prism-delegate"] } } })],
      }),
      /never sees the delegate tool/,
    );
  });

  it("child_default_limits_are_workable", () => {
    assert.deepEqual(resolveChildLimits(), DEFAULT_CHILD_LIMITS);
    // Enough turns and tokens for a coding task, not a chat turn (plan 189's tool schemas alone cost thousands).
    assert.ok(DEFAULT_CHILD_LIMITS.maxTurns >= 50);
    assert.ok(DEFAULT_CHILD_LIMITS.maxTotalTokens >= 500_000);
  });

  it("child_limit_above_ceiling_is_clamped", () => {
    const clamped = resolveChildLimits({ maxTurns: 10_000, maxTotalTokens: 5 });
    assert.equal(clamped.maxTurns, HARD_CHILD_LIMITS.maxTurns);
    assert.equal(clamped.maxTotalTokens, 5);
  });

  it("budget_share_and_lifetime_fail_config_validation", async () => {
    for (const extra of [{ budgetShare: 0.5 }, { lifetime: "session" }]) {
      await assert.rejects(
        createAgent({
          id: "removed-field",
          model: { provider: "mock", model: "m" },
          slots: { store: createMemorySessionStore() },
          packages: [delegate({ children: { reviewer: { inherit: [], ...extra } } as never })],
        }),
        /config/i,
      );
    }
  });

  it("delegate_step_events_reported", async () => {
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      children: { reviewer: { inherit: ["child-tools"], report: "milestones" } },
    });
    const { events } = await collect(agent);
    const phases = steps(events).map((step) => step.phase);
    assert.equal(phases[0], "started");
    assert.ok(phases.includes("milestone"));
    assert.equal(phases.at(-1), "finished");
    await agent.dispose();
  });

  it("delegate_child_ask_suspends_not_approved", async () => {    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x", mode: "async" },
      childCallsTool: true,
      waitAfter: true,
      extra: [askingPackage],
      children: { reviewer: { inherit: ["child-tools", "asking-hooks"] } },
    });
    const { result } = await collect(agent);
    assert.equal(result.status, "completed");
    assert.match(result.text, /\[child reviewer: suspended, 1 turn, 1 pending\]/);
    assert.equal(result.text.includes("child answer"), false);
    await agent.dispose();
  });

  it("child_approval_request_reaches_parent_host", async () => {
    const host = createScriptedHostUi({ confirm: true });
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      extra: [askingPackage],
      host: { ui: host.ui },
      children: { reviewer: { inherit: ["child-tools", "asking-hooks"] } },
    });
    const { result } = await collect(agent);
    assert.equal(result.status, "completed");
    // The child ran past the ask instead of suspending, and the person saw the child's name.
    assert.match(result.text, /child answer/);
    assert.equal(result.text.includes("suspended"), false);
    const confirm = host.requestsOf("confirm");
    assert.equal(confirm.length, 1);
    assert.match(confirm[0]!.title, /^\[reviewer\] /);
    await agent.dispose();
  });

  it("forwarded_request_names_child", async () => {
    const host = createScriptedHostUi({ confirm: false });
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      extra: [askingPackage],
      host: { ui: host.ui },
      children: { reviewer: { inherit: ["child-tools", "asking-hooks"] } },
    });
    await collect(agent);
    const [confirm] = host.requestsOf("confirm");
    assert.ok(confirm);
    assert.match(confirm.title, /^\[reviewer\] Approve tool "child_tool"/);
    assert.match(confirm.detail ?? "", /^\[reviewer\] /);
    await agent.dispose();
  });

  it("child_inherits_parent_skills_by_default", async () => {
    const childSystem = await childSystemPrompt({});
    assert.match(childSystem, /- brief: Answer briefly\./);
  });

  it("child_skills_none", async () => {
    const childSystem = await childSystemPrompt({ reviewer: { inherit: [], skills: "none" } });
    assert.equal(childSystem.includes("- brief: Answer briefly."), false);
  });

  it("child_skills_named_subset", async () => {
    const child = { inherit: [], skills: ["brief"] };
    const childSystem = await childSystemPrompt({ reviewer: child }, { brief: true, verbose: true });
    assert.match(childSystem, /- brief: Answer briefly\./);
    assert.equal(childSystem.includes("verbose"), false);
  });

  it("child_skills_unknown_name_fails_delegation", async () => {
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" }, children: { reviewer: { inherit: [], skills: ["missing"] } } });
    const { result } = await collect(agent);
    assert.match(result.text, /Unknown skill for the child: missing/);
    await agent.dispose();
  });

  it("delegate_cancel_disposes_child", async () => {
    let childAborted = false;
    const blocking: ModelProvider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const tools = (request.tools ?? []).map((tool) => tool.name);
        const last = JSON.stringify(request.messages.at(-1)?.content ?? "");
        if (tools.includes("delegate")) {
          if (last.includes("\"go\"")) yield providerToolCall(toolCallContent("c1", "delegate", { child: "reviewer", input: "x", mode: "async" }));
          else if (!last.includes("delegate_cancel")) {
            const id = /dlg_\w+/.exec(last)?.[0] ?? "missing";
            yield providerToolCall(toolCallContent("c2", "delegate_cancel", { delegationId: id }));
          } else yield providerTextDelta(`done ${last}`);
        } else {
          await new Promise<void>((resolve) => {
            if (request.signal?.aborted) return resolve();
            request.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          childAborted = request.signal?.aborted === true;
          throw new Error("aborted");
        }
        yield providerDone({ inputTokens: 1, outputTokens: 1 });
      },
    };
    const agent = await createAgent({
      id: "cancel-parent",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("mock-provider", [blocking]), delegate({ children: { reviewer: { inherit: [] } } })],
    });
    const session = await agent.session();
    const result = await session.run("go");
    assert.equal(result.status, "completed");
    assert.match(result.text, /cancelling/);
    await agent.dispose();
    assert.equal(childAborted, true);
  });

  it("async_delegation_ends_with_parent_session", async () => {
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x", mode: "async" },
      children: { reviewer: { inherit: ["child-tools"] } },
    });
    const { result, events } = await collect(agent);
    assert.equal(result.status, "completed");
    assert.match(result.text, /\[child reviewer: running, delegationId dlg_/);
    await agent.dispose();
    assert.ok(steps(events).length >= 0);
  });

  it("delegate_from_custom_loop", async () => {
    const customLoop: LoopStrategy = {
      name: "custom-loop",
      async run(run) {
        for (;;) {
          const turn = await run.turn();
          if (turn.stopped) return;
          if (turn.toolCalls.length > 0) {
            await run.executeTools(turn.toolCalls);
            continue;
          }
          return;
        }
      },
    };
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" }, loop: customLoop });
    const { result, events } = await collect(agent);
    assert.equal(result.status, "completed");
    assert.match(result.text, /child answer/);
    assert.deepEqual(steps(events).map((step) => step.phase), ["started", "finished"]);
    await agent.dispose();
  });

  it("delegate_result_capped_with_paging_hint", async () => {
    const long = `${Array.from({ length: 400 }, (_, index) => `paragraph ${index} ${"x".repeat(60)}`).join("\n\n")}`;
    assert.ok(long.length > 30_000);
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" }, childAnswer: long });
    const { result } = await collect(agent);
    const completed = result.messages.find((message) => message.role === "tool");
    const payload = completed?.content.find((part) => part.type === "tool_result") as { result?: unknown } | undefined;
    const text = typeof payload?.result === "string" ? payload.result : "";
    assert.ok(text.length < 13_000, `tool result stays near the 12,000 cap (was ${text.length})`);
    assert.match(text, /\[truncated: \d+\/\d+ chars; delegate_wait \{ delegationId: "dlg_[^"]+", offset: \d+ \} returns the rest\]/);
    assert.match(text, /\[child reviewer: completed/);
    await agent.dispose();
  });

  it("delegate_wait_offset_returns_next_slice", async () => {
    const long = Array.from({ length: 400 }, (_, index) => `paragraph ${index} ${"y".repeat(60)}`).join("\n\n");
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x", mode: "async" },
      childAnswer: long,
      waitOffset: true,
    });
    const { result } = await collect(agent);
    // The parent's answer quotes the second page it read: the offset advanced past the first 12,000 chars.
    const shown = Number(/\[truncated: (\d+)\//.exec(result.text)?.[1] ?? "0");
    assert.ok(shown > 12_000, `the second page starts past the first cap (was ${shown})`);
    assert.match(result.text, /paragraph 3\d\d/, "the second page carries later paragraphs");
    await agent.dispose();
  });

  it("delegate_wait_releases_a_fully_served_answer", async () => {
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x", mode: "async" }, waitTwice: true });
    const { result } = await collect(agent);
    // The first wait served the whole answer and dropped the entry; the second reports the unknown id.
    const waits = result.messages.flatMap((message) =>
      message.content.flatMap((part) =>
        part.type === "tool_result" && part.name === "delegate_wait" ? [{ result: part.result, error: part.error }] : [],
      ),
    );
    assert.equal(waits.length, 2);
    assert.match(String(waits[0]?.result), /child answer/);
    assert.match(String(waits[1]?.error?.message), /Unknown delegation/);
    await agent.dispose();
  });

  it("truncated_sync_result_keeps_entry_for_paging", async () => {
    const long = Array.from({ length: 400 }, (_, index) => `paragraph ${index} ${"z".repeat(60)}`).join("\n\n");
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" }, childAnswer: long, waitOffset: true });
    const { result } = await collect(agent);
    // A truncated sync answer keeps its entry, so the follow-up wait pages instead of failing.
    assert.match(result.text, /paragraph 3\d\d/);
    assert.equal(result.text.includes("Unknown delegation"), false);
    await agent.dispose();
  });

  it("delegate_wait_unknown_delegation_is_tool_error", async () => {
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x", mode: "async" }, unknownWait: true });
    const { result } = await collect(agent);
    assert.match(result.text, /Unknown delegation/);
    await agent.dispose();
  });

  it("delegate_step_data_is_bounded", () => {
    const origin = { kind: "prism", agent: "a", agentId: "delegate-a", delegationId: "d", depth: 1 } as const;
    assert.throws(() => delegateStepData({ origin: { ...origin, agent: "a\nb" }, phase: "started" }));
    assert.throws(() => delegateStepData({ origin, phase: "started", turn: -1 }));
    const data = delegateStepData({ origin, phase: "finished", status: "completed", totalTokens: 5 }) as Record<string, unknown>;
    assert.equal(data.phase, "finished");
    assert.equal(JSON.stringify(data).includes("input"), false);
  });

  it("delegate_step_events_carry_origin", async () => {
    // Plan 174 Task 9: a step attributes its child through `origin` (K3), not a bare `child` field.
    const agent = await build({ delegateArgs: { child: "reviewer", input: "go" } });
    const { events } = await collect(agent);
    const steps_ = steps(events);
    assert.ok(steps_.length > 0, "the delegation reported steps");
    for (const step of steps_) {
      const origin = step.origin as Record<string, unknown>;
      assert.equal(origin.kind, "prism");
      assert.equal(origin.agent, "reviewer");
      assert.equal(origin.agentId, "delegate-reviewer");
      assert.equal(origin.depth, 1);
      assert.equal(typeof origin.delegationId, "string");
      assert.equal("child" in step, false, "the retired `child` field is gone");
    }
    await agent.dispose();
  });

  it("delegate_no_parent_secret_in_child_events", async () => {
    const agent = await build({ delegateArgs: { child: "reviewer", input: "SECRET-PARENT-TOKEN" } });
    const { events } = await collect(agent);
    assert.equal(JSON.stringify(steps(events)).includes("SECRET-PARENT-TOKEN"), false);
    await agent.dispose();
  });
});
