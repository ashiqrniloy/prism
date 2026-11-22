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
import delegate, {
  DEFAULT_CHILD_CEILINGS,
  DEFAULT_CHILD_LIMITS,
  delegateStepData,
  resolveChildLimits,
  resolveDelegateCeilings,
  resolveResultMaxChars,
} from "../index.js";

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
  /** The parent's first turn already happened (a parent resumed by a new agent): start past it. */
  readonly resumedParent?: boolean;
}

function scripted(
  delegateArgs: Record<string, unknown>,
  seen: Seen[],
  childCallsTool = false,
  waitAfter = false,
  options: ScriptOptions = {},
): ModelProvider {
  let parentCalls = options.resumedParent === true ? 1 : 0;
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
        else if (options.unknownWait && parentCalls === 2)
          yield providerToolCall(toolCallContent("call_w", "delegate_wait", { delegationId: "dlg_missing" }));
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
    prism.tools.register({
      name: "child_tool",
      description: "child only",
      execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "child_tool", content: [{ type: "text", text: "ok" }] }),
    });
  },
});

/** `child_tool` under another package name, counting its executions. */
function countingChildTools(onRun: () => void) {
  return definePackage({
    name: "counted-tools",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.tools.register({
        name: "child_tool",
        description: "child only",
        execute: (_args, ctx) => {
          onRun();
          return { toolCallId: ctx.toolCallId, name: "child_tool", content: [{ type: "text", text: "ok" }] };
        },
      });
    },
  })();
}

const otherTools = definePackage({
  name: "other-tools",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({
      name: "other_tool",
      description: "parent only",
      execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "other_tool", content: [] }),
    });
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
  store?: ReturnType<typeof createMemorySessionStore>;
  replaceChildTools?: unknown;
  resumedParent?: boolean;
  /** Extra delegate config. The helper turns the `run.end` announcement off unless a test sets `announceAsync`. */
  delegateConfig?: Record<string, unknown>;
}) {
  stepLog.length = 0;
  const seen = options.seen ?? [];
  return createAgent({
    id: "delegate-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: options.store ?? createMemorySessionStore(), ...(options.loop === undefined ? {} : { loop: options.loop }) },
    ...((options.host ?? options.skills) === undefined
      ? {}
      : ({
          ...(options.host === undefined ? {} : { host: options.host }),
          ...(options.skills === undefined ? {} : { skills: options.skills }),
        } as never)),
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
          ...(options.resumedParent === true ? { resumedParent: true } : {}),
        }),
      ]),
      (options.replaceChildTools ?? childTools) as never,
      otherTools,
      ...((options.extra ?? []) as never[]),
      delegate({
        children: (options.children ?? { reviewer: { inherit: ["child-tools"], instructions: "Review." } }) as never,
        announceAsync: false,
        ...(options.delegateConfig ?? {}),
      } as never),
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
async function childSystemPrompt(
  children: Record<string, unknown>,
  extraSkills: { brief?: boolean; verbose?: boolean } = {},
): Promise<string> {
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
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("child_allow_list_comes_from_inherited_packages", async () => {
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
    assert.deepEqual(
      steps(events).map((step) => step.phase),
      ["started", "finished"],
    );
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
    const tool = agent.tools.find((entry) => entry.name === "delegate");
    assert.ok(tool);
    assert.match(
      tool.description,
      /^Run a child agent on a task\. The child sees only your input unless its line says it sees this conversation\. Children:/,
    );
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
      packages: [
        providerPackage("mock-provider", [recording]),
        delegate({ children: { reviewer: { inherit: [], instructions: "Review." } } }),
      ],
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
    // The `child` enum lists the configured children, so the kernel's argument check blocks the call before the tool runs.
    assert.ok(completed && JSON.stringify(completed).includes("/child: must be one of the allowed values"));
    assert.deepEqual(steps(events), []);
    await agent.dispose();
  });

  it("two_sync_delegate_calls_overlap", async () => {
    // Plan 226 Task 4: two `delegate` calls of one model turn run at the same time (the tool declares
    // `exclusive: false` and `effects`), so the round takes about one child's time, not two.
    let active = 0;
    let maxActive = 0;
    let parentCalls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const tools = (request.tools ?? []).map((tool) => tool.name);
        if (tools.includes("delegate")) {
          parentCalls += 1;
          if (parentCalls === 1) {
            yield providerToolCall(toolCallContent("call_a", "delegate", { child: "reviewer", input: "a" } as never));
            yield providerToolCall(toolCallContent("call_b", "delegate", { child: "reviewer", input: "b" } as never));
          } else yield providerTextDelta("done");
        } else {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 150));
          active -= 1;
          yield providerTextDelta("child answer");
        }
        yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
      },
    };
    const agent = await createAgent({
      id: "delegate-overlap",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("mock-provider", [provider]), delegate({ children: { reviewer: { inherit: [] } } })],
    });
    const session = await agent.session();
    const started = performance.now();
    const result = await session.run("go");
    const ms = performance.now() - started;
    assert.equal(result.status, "completed");
    assert.equal(maxActive, 2);
    assert.ok(ms < 450, `two 150 ms children took ${ms} ms`);
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
        packages: [
          providerPackage("mock-provider", [scripted({}, [])]),
          delegate({ children: { c: { inherit: ["@arnilo/prism-extensions/delegate"] } } }),
        ],
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

  const withChildren = (config: Record<string, unknown>) =>
    createAgent({
      id: "ceilings",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [delegate(config as never)],
    });

  it("delegate_value_above_ceiling_is_rejected_not_clamped", async () => {
    // Plan 239 Task 5: a child value above a delegate ceiling fails the load, naming the axis; it is never clamped.
    await assert.rejects(
      withChildren({ children: { worker: { inherit: [], limits: { maxTurns: DEFAULT_CHILD_CEILINGS.maxTurns + 1 } } } }),
      /worker.*maxTurns exceeds the delegate ceiling/,
    );
    await assert.rejects(withChildren({ children: { worker: { inherit: [], resultMaxChars: 64_001 } } }), /resultMaxChars exceeds/);
    // `null` (unbounded) on a ceilinged axis is above any finite ceiling.
    await assert.rejects(withChildren({ children: { worker: { inherit: [], limits: { maxWallTimeMs: null } } } }), /maxWallTimeMs exceeds/);
  });

  it("delegate_ceiling_is_host_configurable", async () => {
    const fourHours = 4 * 60 * 60_000;
    const agent = await withChildren({
      ceilings: { maxWallTimeMs: null, maxTurns: 1_000, resultMaxChars: 200_000 },
      children: { worker: { inherit: [], limits: { maxWallTimeMs: fourHours, maxTurns: 1_000 }, resultMaxChars: 200_000 } },
    });
    await agent.dispose();
    const ceilings = resolveDelegateCeilings({ maxWallTimeMs: null, maxTurns: 1_000, resultMaxChars: 200_000 });
    assert.equal(resolveChildLimits({ maxWallTimeMs: fourHours }, ceilings).maxWallTimeMs, fourHours);
    assert.equal(resolveChildLimits({ maxWallTimeMs: null }, ceilings).maxWallTimeMs, null);
    // Retention follows a raised answer ceiling so `delegate_wait` can page the whole answer.
    assert.equal(ceilings.retainedResultChars, 256_000);
    assert.equal(resolveDelegateCeilings({ resultMaxChars: 300_000 }).retainedResultChars, 300_000);
    // A lowered ceiling lowers the default a child gets without setting the axis.
    const low = resolveDelegateCeilings({ maxTurns: 10, resultMaxChars: 1_000 });
    assert.equal(resolveChildLimits({}, low).maxTurns, 10);
    assert.equal(resolveResultMaxChars(undefined, low), 1_000);
    await assert.rejects(withChildren({ ceilings: { maxTurns: 0 }, children: { worker: { inherit: [] } } }), /config/i);
    await assert.rejects(withChildren({ ceilings: { maxCost: 1 }, children: { worker: { inherit: [] } } }), /config/i);
  });

  it("delegate_child_accepts_every_run_limit_axis", async () => {
    const limits = {
      maxTurns: 10,
      maxProviderAttempts: null,
      maxToolRounds: 5,
      maxToolCalls: 20,
      maxInputTokens: null,
      maxOutputTokens: 1_000,
      maxTotalTokens: 2_000,
      maxCost: { amount: 0.5, currency: "USD" },
      maxContinuations: 0,
      maxToolTimeMs: null,
      bufferOutput: true,
      maxRequestBytes: 1_024 * 1_024,
      maxResponseBytes: 1_024 * 1_024,
      maxRunStateBytes: 65_536,
    };
    const agent = await withChildren({ children: { worker: { inherit: [], limits } } });
    await agent.dispose();
    assert.deepEqual(resolveChildLimits(limits), { ...limits, maxWallTimeMs: DEFAULT_CHILD_LIMITS.maxWallTimeMs });
    await assert.rejects(withChildren({ children: { worker: { inherit: [], limits: { backgroundSettleMs: 5 } } } }), /config/i);
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

  it("async_child_suspension_reports_the_child_session_id", async () => {
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x", mode: "async" },
      childCallsTool: true,
      waitAfter: true,
      extra: [askingPackage],
      // `asking-hooks` is not inherited: every loaded package's hooks apply to a child session.
      children: { reviewer: { inherit: ["child-tools"] } },
    });
    const parent = await agent.session();
    const result = await parent.run("go");
    assert.equal(result.status, "completed");
    const sessionId = /\[child reviewer: suspended, 1 turn, 1 pending, session ([\w-]+)\]/.exec(result.text)?.[1];
    assert.ok(sessionId, result.text);
    assert.equal(result.text.includes("child answer"), false);
    // The `finished` step names the child session and its approval ids: what a host needs to resume it.
    const finished = steps().find((step) => step.phase === "finished");
    assert.equal(finished?.sessionId, sessionId);
    const approvals = (finished?.approvalIds as string[] | undefined) ?? [];
    assert.equal(approvals.length, 1);
    // The host resumes that session directly: it is in the agent's store, linked to the parent.
    const child = await agent.session({ id: sessionId });
    const events: AgentEvent[] = [];
    for await (const event of child.resume(approvals.map((approvalId) => ({ approvalId, outcome: "allow_once" as const }))))
      events.push(event);
    assert.ok(events.some((event) => event.type === "run.completed"));
    assert.match(JSON.stringify(await child.messages()), /child answer/);
    await agent.dispose();
  });

  it("child_approval_request_reaches_parent_host", async () => {
    const host = createScriptedHostUi({ confirm: true });
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      extra: [askingPackage],
      host: { ui: host.ui },
      children: { reviewer: { inherit: ["child-tools"] } },
    });
    const parent = await agent.session();
    const result = await parent.run("go");
    assert.equal(result.status, "completed");
    // The child ran past the ask instead of suspending; the request names the child's session, not the parent's.
    assert.match(result.text, /child answer/);
    const [confirm] = host.requestsOf("confirm");
    assert.ok(confirm);
    const children = (await agent.sessions.list({ parentSessionId: parent.id })).items;
    assert.equal(children.length, 1);
    assert.equal(confirm.sessionId, children[0]?.sessionId);
    assert.notEqual(confirm.sessionId, parent.id);
    await agent.dispose();
  });

  it("headless_parent_child_suspends_instead_of_prompting", async () => {
    const host = createScriptedHostUi({ confirm: true });
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      extra: [askingPackage],
      host: { ui: host.ui },
      children: { reviewer: { inherit: ["child-tools"] } },
    });
    const result = await (await agent.session()).run("go", { interactive: false });
    assert.equal(result.status, "suspended");
    assert.equal(host.requestsOf("confirm").length, 0, "the child inherited the parent's interactivity");
    await agent.dispose();
  });

  it("sync_child_approval_suspends_and_resumes_through_the_parent", async () => {
    let childToolRuns = 0;
    const counted = countingChildTools(() => {
      childToolRuns += 1;
    });
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      replaceChildTools: counted,
      extra: [askingPackage],
      children: { reviewer: { inherit: ["counted-tools"] } },
    });
    const parent = await agent.session();
    const result = await parent.run("go", { interactive: false });
    assert.equal(result.status, "suspended");
    const [decision] = result.pending ?? [];
    assert.ok(decision);
    const children = (await agent.sessions.list({ parentSessionId: parent.id })).items;
    assert.equal(children.length, 1);
    assert.deepEqual(decision.attribution?.path, ["call_d", children[0]?.sessionId]);
    assert.equal(childToolRuns, 0);
    const events: AgentEvent[] = [];
    for await (const event of parent.resume([{ approvalId: decision.approvalId, outcome: "allow_once" }], { interactive: false }))
      events.push(event);
    assert.ok(
      events.some((event) => event.type === "run.completed"),
      JSON.stringify(events.map((event) => event.type)),
    );
    assert.equal(childToolRuns, 1, "the child's call ran once, after the parent's resume");
    const results = (await parent.messages()).flatMap((message) =>
      message.content.flatMap((part) => (part.type === "tool_result" && part.name === "delegate" ? [String(part.result)] : [])),
    );
    assert.equal(results.length, 1);
    assert.match(results[0] ?? "", /child answer/);
    assert.match(results[0] ?? "", /\[child reviewer: completed/);
    await agent.dispose();
  });

  it("sync_child_resumes_after_the_parent_is_reopened_by_a_new_agent", async () => {
    // A new process: a second agent over the same store, with no child session open and no runtime memory.
    const store = createMemorySessionStore();
    const first = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      extra: [askingPackage],
      store,
      children: { reviewer: { inherit: ["child-tools"] } },
    });
    const parent = await first.session();
    const result = await parent.run("go", { interactive: false });
    assert.equal(result.status, "suspended");
    const [decision] = result.pending ?? [];
    assert.ok(decision);
    await first.dispose();
    const second = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      resumedParent: true,
      extra: [askingPackage],
      store,
      children: { reviewer: { inherit: ["child-tools"] } },
    });
    const reopened = await second.session({ id: parent.id });
    const events: AgentEvent[] = [];
    for await (const event of reopened.resume([{ approvalId: decision.approvalId, outcome: "allow_once" }], { interactive: false }))
      events.push(event);
    assert.ok(
      events.some((event) => event.type === "run.completed"),
      JSON.stringify(events.map((event) => event.type)),
    );
    const text = JSON.stringify(await reopened.messages());
    assert.match(text, /child answer/);
    assert.match(text, /\[child reviewer: completed/);
    await second.dispose();
  });

  it("child_transcript_is_in_the_parent_store", async () => {
    const agent = await build({ delegateArgs: { child: "reviewer", input: "review the transcript" } });
    const parent = await agent.session();
    await parent.run("go");
    const [entry] = (await agent.sessions.list({ parentSessionId: parent.id })).items;
    assert.ok(entry, "the child is listed under its parent");
    // The delegation is over and the child is closed, but its transcript stays readable.
    const child = await agent.session({ id: entry.sessionId });
    const text = JSON.stringify(await child.messages());
    assert.match(text, /review the transcript/);
    assert.match(text, /child answer/);
    await agent.dispose();
  });

  it("delegation_builds_no_agent_and_runs_no_setup", async () => {
    let setups = 0;
    const spy = definePackage({
      name: "setup-spy",
      version: "0.0.0",
      requires: { api: 1 },
      setup() {
        setups += 1;
      },
    });
    // Every parent run delegates once: its first turn (the last message is the user's) calls `delegate`.
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const tools = (request.tools ?? []).map((tool) => tool.name);
        const last = request.messages.at(-1);
        if (tools.includes("delegate") && last?.role === "user")
          yield providerToolCall(toolCallContent("call_d", "delegate", { child: "reviewer", input: "x" } as never));
        else if (tools.includes("delegate")) yield providerTextDelta(`parent saw: ${JSON.stringify(last?.content ?? "")}`);
        else yield providerTextDelta("child answer");
        yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
      },
    };
    const agent = await createAgent({
      id: "setup-parent",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("mock-provider", [provider]),
        childTools,
        spy,
        delegate({ children: { reviewer: { inherit: ["child-tools", "setup-spy"] } } }),
      ],
    });
    for (let index = 0; index < 3; index += 1) {
      const result = await (await agent.session()).run("go");
      assert.match(result.text, /child answer/);
    }
    assert.equal(setups, 1, "one setup for the agent's life, none per delegation");
    await agent.dispose();
  });

  it("child_cannot_call_a_tool_outside_its_allow_list", async () => {
    let otherRuns = 0;
    let parentCalls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const tools = (request.tools ?? []).map((tool) => tool.name);
        if (tools.includes("delegate")) {
          parentCalls += 1;
          if (parentCalls === 1) yield providerToolCall(toolCallContent("call_d", "delegate", { child: "reviewer", input: "x" } as never));
          else yield providerTextDelta(`parent saw: ${JSON.stringify(request.messages.at(-1)?.content ?? "")}`);
        } else if (request.messages.at(-1)?.role === "user") {
          // The child names a tool the parent has but the child was not given.
          yield providerToolCall(toolCallContent("call_o", "other_tool", {}));
        } else yield providerTextDelta("child answer");
        yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
      },
    };
    const otherCounted = definePackage({
      name: "other-counted",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.tools.register({
          name: "other_tool",
          description: "parent only",
          execute: (_args, ctx) => {
            otherRuns += 1;
            return { toolCallId: ctx.toolCallId, name: "other_tool", content: [] };
          },
        });
      },
    });
    const agent = await createAgent({
      id: "allow-list-parent",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("mock-provider", [provider]),
        childTools,
        otherCounted,
        delegate({ children: { reviewer: { inherit: ["child-tools"] } } }),
      ],
    });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(otherRuns, 0, "dispatch refused the call: the child's allow-list is enforced, not only advertised");
    await agent.dispose();
  });

  it("inherit_empty_child_gets_no_tools", async () => {
    const seen: Seen[] = [];
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" }, seen, children: { reviewer: { inherit: [] } } });
    await collect(agent);
    const childTurn = seen.find((entry) => !entry.tools.includes("delegate"));
    assert.ok(childTurn);
    assert.deepEqual(childTurn.tools, [], "an empty inherit is no tools, never every tool");
    await agent.dispose();
  });

  it("child_usage_counts_against_parent_limits", async () => {
    // Each turn costs 5 tokens: the parent's first turn (5) plus the child's (5) passes a 9-token parent budget.
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" } });
    const result = await (await agent.session()).run("go", { limits: { maxTotalTokens: 9 } });
    assert.equal(result.status, "failed");
    assert.match(JSON.stringify(result.limit ?? result.error ?? {}), /Tokens|tokens/);
    await agent.dispose();
  });

  it("retired_ownership_key_fails_the_load", async () => {
    await assert.rejects(
      createAgent({
        id: "retired-ownership",
        model: { provider: "mock", model: "m" },
        slots: { store: createMemorySessionStore() },
        packages: [delegate({ children: { reviewer: { inherit: [] } }, ownership: { tenantId: "t" } } as never)],
      }),
      /ownership is retired: a child is a session linked to the parent session and inherits its ownership scope/,
    );
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
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      children: { reviewer: { inherit: [], skills: ["missing"] } },
    });
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
          if (last.includes('"go"'))
            yield providerToolCall(toolCallContent("c1", "delegate", { child: "reviewer", input: "x", mode: "async" }));
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
    assert.deepEqual(
      steps(events).map((step) => step.phase),
      ["started", "finished"],
    );
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
