import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type RunResult,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import delegate, { type DelegateService } from "@arnilo/prism-delegate";
import advisor from "../index.js";
import type { ValidatorDelegateService } from "../validate.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

interface Seen {
  readonly model: string[];
  readonly child: string[];
  readonly parent: string[];
}

interface Script {
  /** Verdict JSON answers for the model engine, one per validator call. `"error"` throws instead. */
  readonly verdicts: readonly (string | "error")[];
  /** Answer for the child engine; it calls its `read_file` tool first. */
  readonly childAnswer?: string;
}

const VALIDATOR_TEXT = "completion validator";
const CHILD_TEXT = "Validate whether the work below completes the task";

function scripted(seen: Seen, script: Script): ModelProvider {
  let modelCalls = 0;
  let parentCalls = 0;
  const childCalls = new Map<string, number>();
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const text = JSON.stringify(request.messages);
      const lastText = JSON.stringify(request.messages.at(-1)?.content ?? "");
      if (text.includes(CHILD_TEXT)) {
        const key = JSON.stringify(request.messages.map((message) => message.role));
        const count = (childCalls.get(key) ?? 0) + 1;
        childCalls.set(key, count);
        seen.child.push(lastText);
        if (!lastText.includes("tool_result")) {
          yield providerToolCall(toolCallContent("call_child", "read_file", { path: "notes.txt" } as never));
        } else {
          yield providerTextDelta(script.childAnswer ?? '{"verdict":"complete","missing":[],"evidence":"read notes.txt"}');
        }
        yield providerDone({ totalTokens: 11 });
        return;
      }
      if (text.includes(VALIDATOR_TEXT)) {
        seen.model.push(lastText);
        const next = script.verdicts[Math.min(modelCalls, script.verdicts.length - 1)] ?? '{"verdict":"complete"}';
        modelCalls += 1;
        if (next === "error") throw new Error("validator exploded");
        yield providerTextDelta(next);
        yield providerDone({ totalTokens: 9 });
        return;
      }
      seen.parent.push(lastText);
      parentCalls += 1;
      yield providerTextDelta(`ANSWER-${parentCalls}`);
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
}

const readFiles: string[] = [];

const readTool = definePackage({
  name: "read-tool",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({
      name: "read_file",
      description: "read a file",
      execute: (args, context) => {
        readFiles.push(String((args as { path?: string }).path));
        return { toolCallId: context.toolCallId, name: "read_file", content: [{ type: "text", text: "file contents" }] };
      },
    });
  },
});

interface BuildOptions {
  readonly script: Script;
  readonly validate: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
  readonly limits?: Record<string, number>;
  readonly delegates?: Record<string, unknown>;
  readonly childEngine?: boolean;
}

async function build(options: BuildOptions): Promise<{ agent: Agent; seen: Seen; events: AgentEvent[]; service?: ValidatorDelegateService }> {
  readFiles.length = 0;
  const seen: Seen = { model: [], child: [], parent: [] };
  const events: AgentEvent[] = [];
  let service: ValidatorDelegateService | undefined;
  const agent = await createAgent({
    id: "advisor-validate",
    model: { provider: "mock", model: "m" },
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) =>
      hooks.on("package.event", (event) => {
        if (event.name === "validator.verdict" || event.name === "advisor.consult") events.push(event);
      }),
    packages: [
      providerPackage("mock-provider", [scripted(seen, options.script)]),
      readTool,
      ...(options.delegates === undefined ? [] : [delegate({ children: options.delegates } as never)]),
      advisor({
        model: { provider: "mock", model: "m" },
        tool: false,
        ...(options.context === undefined ? {} : { context: options.context }),
        validate: options.validate,
      } as never),
    ],
  });
  agents.push(agent);
  // Structural-type proof: the real service satisfies the shape validate.ts calls (typecheck + runtime).
  const consumer = definePackage({
    name: "delegate-shape-probe",
    version: "0.12.1",
    requires: { api: 1 },
    setup(prism) {
      service = prism.services.consume<DelegateService>("delegate") as unknown as ValidatorDelegateService | undefined;
    },
  });
  if (options.delegates !== undefined) {
    const probe = await createAgent({
      id: "shape-probe",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("mock-provider", [scripted(seen, options.script)]), delegate({ children: options.delegates } as never), consumer],
    });
    agents.push(probe);
  }
  return { agent, seen, events, ...(service === undefined ? {} : { service }) };
}

const verdicts = (events: readonly AgentEvent[]) =>
  events.flatMap((event) => (event.type === "package.event" && event.name === "validator.verdict" ? [(event.data ?? {}) as Record<string, unknown>] : []));

describe("completion validation", () => {
  it("validate_model_complete_ends_run_verified", async () => {
    const { agent, seen, events } = await build({ script: { verdicts: ['{"verdict":"complete","missing":[],"evidence":"it is done"}'] }, validate: {} });
    const session = await agent.session();
    const result = await session.run("TASK-MARKER do the thing");
    assert.equal(result.status, "completed");
    assert.equal(seen.parent.length, 1);
    assert.equal(seen.model.length, 1);
    assert.equal(seen.model[0]!.includes("TASK-MARKER"), true);
    const data = verdicts(events);
    assert.equal(data.length, 1);
    assert.equal(data[0]!.verdict, "verified");
    assert.equal(data[0]!.engine, "model");
    assert.equal(data[0]!.task, "captured");
    assert.equal(data[0]!.round, 1);
  });

  it("validate_incomplete_continues_with_missing_steer", async () => {
    const { agent, seen, events } = await build({
      script: { verdicts: ['{"verdict":"incomplete","missing":["add tests"]}', '{"verdict":"complete"}'] },
      validate: {},
    });
    const session = await agent.session();
    const result = await session.run("TASK-MARKER do the thing");
    assert.equal(result.status, "completed");
    assert.equal(seen.parent.length, 2);
    assert.match(seen.parent[1] ?? "", /Missing:/);
    assert.match(seen.parent[1] ?? "", /add tests/);
    assert.deepEqual(
      verdicts(events).map((data) => data.verdict),
      ["incomplete", "verified"],
    );
  });

  it("validate_exhausted_rounds_emits_unverified", async () => {
    const { agent, seen, events } = await build({
      script: { verdicts: ['{"verdict":"incomplete","missing":["still missing"]}'] },
      validate: { maxRounds: 2 },
    });
    const session = await agent.session();
    const result = await session.run("TASK-MARKER do the thing");
    assert.equal(result.status, "completed");
    assert.equal(seen.parent.length, 2);
    assert.deepEqual(
      verdicts(events).map((data) => data.verdict),
      ["incomplete", "unverified"],
    );
    assert.deepEqual(verdicts(events)[1]!.missing, ["still missing"]);
  });

  it("validate_judges_against_captured_task", async () => {
    const { agent, seen } = await build({
      script: { verdicts: ['{"verdict":"incomplete","missing":["x"]}', '{"verdict":"complete"}'] },
      validate: { context: { lastTurns: 1 } },
      context: { lastTurns: 1 },
    });
    const session = await agent.session();
    await session.run("TASK-MARKER original task");
    // Round 2's slice is the newest turn only; the task survives because it is pinned.
    assert.equal(seen.model.length, 2);
    assert.match(seen.model[1]!, /TASK-MARKER original task/);
  });

  it("validate_task_inferred_after_resume", async () => {
    const { agent, events } = await build({ script: { verdicts: ['{"verdict":"complete"}'] }, validate: {} });
    const session = await agent.session();
    await session.run("TASK-MARKER original task");
    const second = await session.run("");
    assert.equal(second.status, "completed");
    const data = verdicts(events);
    assert.equal(data.length, 2);
    assert.equal(data[0]!.task, "captured");
    // A run whose input was empty (a resume/restart) infers the task from the first user message.
    assert.equal(data[1]!.task, "inferred");
    assert.equal(data[1]!.verdict, "verified");
  });

  it("validate_child_engine_checks_evidence", async () => {
    const { agent, seen, events } = await build({
      script: { verdicts: [], childAnswer: '{"verdict":"complete","missing":[],"evidence":"notes.txt says done"}' },
      validate: { engine: { child: "verifier" } },
      delegates: { verifier: { inherit: ["read-tool"], tools: { only: ["read_file"] }, hidden: true } },
    });
    const session = await agent.session();
    const result = await session.run("TASK-MARKER do the thing");
    assert.equal(result.status, "completed");
    assert.deepEqual(readFiles, ["notes.txt"]);
    assert.equal(seen.model.length, 0);
    const data = verdicts(events);
    assert.equal(data[0]!.engine, "child");
    assert.equal(data[0]!.verdict, "verified");
  });

  it("validate_child_missing_service_is_error", async () => {
    const { agent, events } = await build({ script: { verdicts: [] }, validate: { engine: { child: "verifier" } } });
    const session = await agent.session();
    await session.run("TASK-MARKER do the thing");
    const data = verdicts(events);
    assert.ok(data.length > 0);
    assert.ok(data.every((entry) => entry.verdict === "error" && entry.reasonCode === "validator_engine_unavailable"));
    assert.ok(!data.some((entry) => entry.verdict === "verified"));
  });

  it("validate_child_unknown_child_is_error", async () => {
    const { agent, events } = await build({
      script: { verdicts: [] },
      validate: { engine: { child: "not-configured" } },
      delegates: { verifier: { inherit: [] } },
    });
    const session = await agent.session();
    await session.run("TASK-MARKER do the thing");
    const data = verdicts(events);
    assert.ok(data.length > 0);
    assert.ok(data.every((entry) => entry.verdict !== "verified" && entry.reasonCode === "validator_engine_unavailable"));
  });

  it("validate_fails_closed_on_error_and_continues_when_asked", async () => {
    const { agent, seen, events } = await build({
      script: { verdicts: ["error", '{"verdict":"complete"}'] },
      validate: { onError: "continue" },
    });
    const session = await agent.session();
    const result = await session.run("TASK-MARKER do the thing");
    assert.equal(result.status, "completed");
    assert.equal(seen.parent.length, 2);
    assert.match(seen.parent[1] ?? "", /Validation could not run \(model_error\)/);
    assert.deepEqual(
      verdicts(events).map((data) => data.verdict),
      ["error", "verified"],
    );
  });

  it("validate_fails_closed_on_garbage_verdict", async () => {
    const { agent, events } = await build({ script: { verdicts: ["looks fine to me"] }, validate: { onError: "end" } });
    const session = await agent.session();
    const result = await session.run("TASK-MARKER do the thing");
    assert.equal(result.status, "completed");
    const data = verdicts(events);
    assert.equal(data.length, 1);
    assert.equal(data[0]!.verdict, "error");
    assert.equal(data[0]!.reasonCode, "unparseable_verdict");
  });

  it("validate_rounds_independent_of_consult_cap", async () => {
    const { agent, seen, events } = await build({
      script: { verdicts: ['{"verdict":"incomplete","missing":["x"]}', '{"verdict":"complete"}'] },
      validate: { maxRounds: 2 },
    });
    const session = await agent.session();
    await session.run("TASK-MARKER do the thing");
    assert.equal(seen.model.length, 2);
    assert.equal(verdicts(events).at(-1)!.verdict, "verified");
  });

  it("validate_respects_max_continuations", async () => {
    const { agent, seen, events } = await build({
      script: { verdicts: ['{"verdict":"incomplete","missing":["x"]}'] },
      validate: { maxRounds: 5 },
      limits: { maxContinuations: 0 },
    });
    const session = await agent.session();
    const result = await session.run("TASK-MARKER do the thing");
    assert.equal(seen.parent.length, 1);
    assert.equal(result.stopReason, "hook_limit");
    assert.ok(!verdicts(events).some((data) => data.verdict === "verified"));
  });

  it("validator_event_carries_no_transcript_or_answer", async () => {
    const items = Array.from({ length: 7 }, (_, index) => `${index}-${"y".repeat(300)}`);
    const { agent, events } = await build({
      script: { verdicts: [`{"verdict":"incomplete","missing":${JSON.stringify(items)}}`] },
      validate: { maxRounds: 1 },
    });
    const session = await agent.session();
    await session.run("SECRET-TASK-TEXT do the thing");
    const data = verdicts(events);
    assert.equal(data.length, 1);
    const missing = data[0]!.missing as string[];
    assert.equal(missing.length, 5);
    assert.ok(missing.every((item) => item.length <= 200));
    const json = JSON.stringify(data);
    assert.ok(!json.includes("SECRET-TASK-TEXT"));
    assert.ok(!json.includes("ANSWER-1"));
    assert.ok(!json.includes("y".repeat(250)));
  });
});
