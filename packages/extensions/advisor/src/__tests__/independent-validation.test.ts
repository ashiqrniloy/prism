import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelClient,
  type ModelProvider,
  type PackageInstance,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import delegate from "@arnilo/prism-extensions/delegate";
import advisor, {
  ADVISOR_SERVICE,
  type AdvisorService,
  advisorPackage,
  DEFAULT_EVIDENCE_MAX_CHARS,
  MAX_EVIDENCE_BLOCKS,
  validateCompletion,
} from "../index.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

/** A ModelClient that records each prompt and answers from a script. */
function recordingClient(answers: readonly (string | "throw")[]): { client: ModelClient; prompts: string[] } {
  const prompts: string[] = [];
  let calls = 0;
  const client: ModelClient = {
    model: { provider: "rec", model: "validator" } as ModelClient["model"],
    async *generate(request): AsyncIterable<ProviderEvent> {
      prompts.push(JSON.stringify(request.messages));
      const answer = answers[Math.min(calls, answers.length - 1)] ?? '{"verdict":"complete"}';
      calls += 1;
      if (answer === "throw") throw new Error("provider down");
      yield providerTextDelta(answer);
      yield providerDone({ totalTokens: 3 });
    },
  };
  return { client, prompts };
}

const VALIDATOR_TEXT = "completion validator";
const CHILD_TEXT = "Validate whether the work below completes the task";

interface Seen {
  readonly validator: string[];
  readonly child: string[];
}

function provider(seen: Seen, verdict = '{"verdict":"complete"}'): ModelProvider {
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const text = JSON.stringify(request.messages);
      const last = JSON.stringify(request.messages.at(-1)?.content ?? "");
      if (text.includes(CHILD_TEXT)) {
        seen.child.push(text);
        if (!last.includes("tool_result")) yield providerToolCall(toolCallContent("c1", "read_file", { path: "x" } as never));
        else yield providerTextDelta(verdict);
        yield providerDone({ totalTokens: 1 });
        return;
      }
      if (text.includes(VALIDATOR_TEXT)) {
        seen.validator.push(text);
        yield providerTextDelta(verdict);
        yield providerDone({ totalTokens: 1 });
        return;
      }
      yield providerTextDelta("WORKER-ANSWER I fixed the bug and all tests pass");
      yield providerDone({ totalTokens: 1 });
    },
  };
}

const readTool = definePackage({
  name: "read-tool",
  version: "0.13.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({
      name: "read_file",
      description: "read a file",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "read_file", content: [{ type: "text", text: "ok" }] }),
    });
  },
});

async function agentWith(seen: Seen, advisorInstance: PackageInstance, extra: readonly PackageInstance[] = []) {
  let service: AdvisorService | undefined;
  const events: AgentEvent[] = [];
  const probe = definePackage({
    name: "advisor-service-probe",
    version: "0.13.1",
    requires: { api: 1 },
    setup(prism) {
      service = prism.services.consume<AdvisorService>(ADVISOR_SERVICE);
    },
  });
  const agent = await createAgent({
    id: "independent-validation",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) =>
      hooks.on("package.event", (event) => {
        if (event.name === "validator.verdict") events.push(event);
      }),
    packages: [providerPackage("mock-provider", [provider(seen)]), readTool, ...extra, advisorInstance, probe()],
  });
  agents.push(agent);
  return { agent, events, service: () => service };
}

const verdictsOf = (events: readonly AgentEvent[]) =>
  events.flatMap((event) => (event.type === "package.event" ? [(event.data ?? {}) as Record<string, unknown>] : []));

describe("validateCompletion (standalone)", () => {
  it("prompt_carries_task_criteria_and_evidence_only", async () => {
    const { client, prompts } = recordingClient(['{"verdict":"complete"}']);
    const result = await validateCompletion({
      model: client,
      task: "TASK-T1 fix the parser",
      criteria: "CRIT-C1 tests pass",
      evidence: [
        { label: "DIFF", text: "DIFF-BODY +fixed" },
        { label: "CHECKS", text: "CHECKS-BODY 12 pass" },
      ],
    });
    assert.deepEqual(result, { verdict: "complete" });
    assert.equal(prompts.length, 1);
    const prompt = prompts[0] ?? "";
    for (const marker of ["TASK-T1", "CRIT-C1", "DIFF-BODY", "CHECKS-BODY", "EVIDENCE: DIFF", "EVIDENCE: CHECKS"]) {
      assert.ok(prompt.includes(marker), marker);
    }
    assert.ok(!prompt.includes("FINAL ANSWER"));
    assert.ok(!prompt.includes("CONVERSATION"));
  });

  it("service_call_reads_no_session_text", async () => {
    const seen: Seen = { validator: [], child: [] };
    const { agent, service } = await agentWith(seen, advisor({ model: { provider: "mock", model: "m" }, tool: false }));
    const session = await agent.session();
    await session.run("SESSION-SECRET do the work");
    const advisorService = service();
    assert.ok(advisorService);
    const result = await advisorService.validateCompletion({
      task: "TASK-T2",
      criteria: "CRIT-C2",
      evidence: [{ label: "DIFF", text: "DIFF-T2" }],
    });
    assert.deepEqual(result, { verdict: "complete" });
    assert.equal(seen.validator.length, 1);
    const prompt = seen.validator[0] ?? "";
    assert.ok(prompt.includes("TASK-T2") && prompt.includes("CRIT-C2") && prompt.includes("DIFF-T2"));
    assert.ok(!prompt.includes("SESSION-SECRET"));
    assert.ok(!prompt.includes("WORKER-ANSWER"));
  });

  it("garbage_output_is_unparseable_never_complete", async () => {
    const { client } = recordingClient(["looks complete to me!"]);
    assert.deepEqual(await validateCompletion({ model: client, task: "t" }), { verdict: "error", reasonCode: "unparseable_verdict" });
  });

  it("model_failure_is_model_error", async () => {
    const { client } = recordingClient(["throw"]);
    assert.deepEqual(await validateCompletion({ model: client, task: "t" }), { verdict: "error", reasonCode: "model_error" });
  });

  it("empty_task_and_bad_input_fail_closed_without_a_call", async () => {
    const { client, prompts } = recordingClient(['{"verdict":"complete"}']);
    assert.deepEqual(await validateCompletion({ model: client, task: "  " }), { verdict: "error", reasonCode: "task_unavailable" });
    const tooMany = Array.from({ length: MAX_EVIDENCE_BLOCKS + 1 }, () => ({ label: "x", text: "y" }));
    assert.deepEqual(await validateCompletion({ model: client, task: "t", evidence: tooMany }), {
      verdict: "error",
      reasonCode: "invalid_input",
    });
    assert.deepEqual(await validateCompletion({ model: client, task: "t", evidence: [{ label: "x", text: 1 }] as never }), {
      verdict: "error",
      reasonCode: "invalid_input",
    });
    assert.equal(prompts.length, 0);
  });

  it("incomplete_missing_is_bounded", async () => {
    const items = Array.from({ length: 9 }, (_, index) => `${index}${"z".repeat(400)}`);
    const { client } = recordingClient([JSON.stringify({ verdict: "incomplete", missing: items })]);
    const result = await validateCompletion({ model: client, task: "t" });
    assert.equal(result.verdict, "incomplete");
    if (result.verdict !== "incomplete") return;
    assert.equal(result.missing.length, 5);
    assert.ok(result.missing.every((item) => item.length <= 200));
  });

  it("evidence_over_cap_is_truncated_with_marker", async () => {
    const { client, prompts } = recordingClient(['{"verdict":"complete"}']);
    const big = "a".repeat(DEFAULT_EVIDENCE_MAX_CHARS * 2);
    await validateCompletion({
      model: client,
      task: "t",
      evidence: [
        { label: "DIFF", text: big, truncated: true },
        { label: "CHECKS", text: "short-check" },
      ],
    });
    const prompt = JSON.parse(prompts[0] ?? "[]")[0].content[0].text as string;
    assert.ok(prompt.includes("short-check"), "a short block keeps all of its text");
    assert.match(prompt, /\[truncated: shown the first \d+ of 96000 chars\]/);
    assert.match(prompt, /\[truncated: the host cut this evidence before validation\]/);
    assert.ok(prompt.length < DEFAULT_EVIDENCE_MAX_CHARS + 5_000);
  });
});

describe("run.end validation inputs", () => {
  it("inputs_off_model_prompt_has_no_conversation_or_final_answer", async () => {
    const seen: Seen = { validator: [], child: [] };
    const { agent, events } = await agentWith(
      seen,
      advisorPackage({
        model: { provider: "mock", model: "m" },
        tool: false,
        validate: {
          criteria: "CRIT-RUN",
          inputs: { transcript: false, finalAnswer: false },
          evidence: async (_payload, session) => [{ label: "DIFF", text: `DIFF-FOR-${session === undefined ? "none" : "session"}` }],
        },
      }),
    );
    const session = await agent.session();
    const result = await session.run("TASK-RUN fix it");
    assert.equal(result.status, "completed");
    assert.equal(seen.validator.length, 1);
    const prompt = seen.validator[0] ?? "";
    assert.ok(!prompt.includes("FINAL ANSWER"));
    assert.ok(!prompt.includes("CONVERSATION"));
    assert.ok(!prompt.includes("WORKER-ANSWER"));
    assert.ok(prompt.includes("TASK-RUN") && prompt.includes("CRIT-RUN") && prompt.includes("DIFF-FOR-session"));
    assert.equal(verdictsOf(events)[0]?.verdict, "verified");
  });

  it("defaults_keep_conversation_and_final_answer", async () => {
    const seen: Seen = { validator: [], child: [] };
    const { agent } = await agentWith(seen, advisor({ model: { provider: "mock", model: "m" }, tool: false, validate: {} }));
    await (await agent.session()).run("TASK-RUN fix it");
    const prompt = seen.validator[0] ?? "";
    assert.ok(prompt.includes("FINAL ANSWER") && prompt.includes("CONVERSATION") && prompt.includes("WORKER-ANSWER"));
  });

  it("inputs_final_answer_off_child_brief_has_no_final_answer", async () => {
    const seen: Seen = { validator: [], child: [] };
    const { agent, events } = await agentWith(
      seen,
      advisorPackage({
        model: { provider: "mock", model: "m" },
        tool: false,
        validate: {
          engine: { child: "verifier" },
          inputs: { finalAnswer: false },
          evidence: () => [{ label: "CHECKS", text: "CHECKS-CHILD" }],
        },
      }),
      [delegate({ children: { verifier: { inherit: ["read-tool"], tools: { only: ["read_file"] }, hidden: true } } } as never)],
    );
    await (await agent.session()).run("TASK-CHILD fix it");
    assert.ok(seen.child.length > 0);
    const brief = seen.child[0] ?? "";
    assert.ok(brief.includes("TASK-CHILD") && brief.includes("CHECKS-CHILD"));
    assert.ok(!brief.includes("FINAL ANSWER"));
    assert.ok(!brief.includes("WORKER-ANSWER"));
    assert.equal(verdictsOf(events)[0]?.engine, "child");
  });

  it("throwing_evidence_source_is_evidence_failed", async () => {
    const seen: Seen = { validator: [], child: [] };
    const { agent, events } = await agentWith(
      seen,
      advisorPackage({
        model: { provider: "mock", model: "m" },
        tool: false,
        validate: {
          onError: "end",
          evidence: () => {
            throw new Error("git exploded");
          },
        },
      }),
    );
    await (await agent.session()).run("t");
    assert.equal(seen.validator.length, 0);
    const data = verdictsOf(events)[0];
    assert.equal(data?.verdict, "error");
    assert.equal(data?.reasonCode, "evidence_failed");
  });

  it("inputs_rejects_unknown_keys", async () => {
    await assert.rejects(() =>
      agentWith(
        { validator: [], child: [] },
        advisor({ model: { provider: "mock", model: "m" }, validate: { inputs: { diff: true } } } as never),
      ),
    );
  });
});
