import { it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createAgent,
  createSecretRedactor,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type RunResult,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import {
  assertEvaluationThreshold,
  bootstrapInterval,
  bradleyTerry,
  createJudgePanel,
  createPairwiseJudge,
  createRubricJudge,
  defineDataset,
  defineScorer,
  RUBRIC_JUDGE_TEMPLATE_VERSION,
  runComparison,
  runExperiment,
  type Scorer,
  scoreRun,
} from "../index.js";
import { PAIRWISE_JUDGE_TEMPLATE, PAIRWISE_JUDGE_TEMPLATE_VERSION, RUBRIC_JUDGE_TEMPLATE } from "../rubric-judge.js";
import { canonicalJson } from "../util.js";

const rubric = {
  id: "helpful",
  version: "1",
  criteria: "Resolve the request",
  scale: [
    { label: "no", score: 0, description: "Unhelpful" },
    { label: "yes", score: 1, description: "Helpful" },
  ],
} as const;
const judgedModel = { provider: "mock", model: "candidate" };
const result: RunResult = {
  sessionId: "s",
  runId: "r",
  status: "completed",
  text: "answer",
  content: [],
  messages: [],
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
};
const valid = JSON.stringify({ reasoning: "Resolves it", label: "yes" });
async function judgeAgent(replies = [valid], onRequest?: (request: ProviderRequest) => void) {
  return createAgent({
    model: { provider: "mock", model: "judge" },
    packages: [
      mockProvider(
        replies.map((text) => [providerTextDelta(text), providerDone()]),
        { onRequest },
      ),
    ],
  });
}

it("rubric_judge_maps_label_to_score", async () => {
  const prompts: string[] = [];
  const agent = await judgeAgent([valid], (request) => prompts.push(JSON.stringify(request)));
  try {
    const judge = createRubricJudge({ agent, rubric, judgedModel, reference: (item) => item.expected as string });
    const [record] = await scoreRun({ result, scorers: [judge], item: { id: "i", input: "question", expected: "reference" } });
    assert.equal(record?.score, 1);
    assert.equal(record?.metadata?.attempts, 1);
    assert.equal(record?.metadata?.label, "yes");
    assert.equal(record?.metadata?.evaluatorKind, "model");
    assert.deepEqual(record?.metadata?.judgeModel, { provider: "mock", model: "judge" });
    assert.equal(record?.metadata?.rubricId, rubric.id);
    assert.equal(record?.metadata?.rubricVersion, rubric.version);
    assert.equal(record?.metadata?.templateVersion, RUBRIC_JUDGE_TEMPLATE_VERSION);
    assert.equal(record?.metadata?.rubricHash, createHash("sha256").update(canonicalJson(rubric)).digest("hex"));
    assert.match(prompts[0]!, /reference/);
    assert.match(prompts[0]!, /question/);
    assert.equal(prompts.length, 1);
  } finally {
    await agent.dispose();
  }
});

for (const [name, reply] of [
  ["invalid_json_fails_record_after_retries", "not json"],
  ["label_outside_scale_fails", JSON.stringify({ reasoning: "ok", label: "maybe" })],
  ["extra_fields_fail", JSON.stringify({ reasoning: "ok", label: "yes", score: 1 })],
  ["oversized_reasoning_fails", JSON.stringify({ reasoning: "界".repeat(1400), label: "yes" })],
] as const)
  it(`rubric_judge_${name}`, async () => {
    let calls = 0;
    const agent = await judgeAgent([reply], () => calls++);
    try {
      const judge = createRubricJudge({ agent, rubric, judgedModel });
      const [record] = await scoreRun({ result, scorers: [judge] });
      assert.equal(record?.status, "failed");
      assert.equal(record?.score, undefined);
      assert.equal(record?.error?.code, "ERR_PRISM_EVAL_JUDGE_OUTPUT");
      assert.equal(calls, 2);
    } finally {
      await agent.dispose();
    }
  });

it("rubric_judge_retries_in_fresh_sessions_and_closes_them", async () => {
  const sessions = new Set<string>();
  const agent = await judgeAgent(["invalid", valid], (request) => sessions.add(request.options?.sessionId ?? "missing"));
  let opened = 0,
    closed = 0;
  const tracked = {
    ...agent,
    async session() {
      opened++;
      const session = await agent.session();
      return {
        ...session,
        run: session.run.bind(session),
        async close() {
          closed++;
          await session.close();
        },
      };
    },
  };
  try {
    const scored = await createRubricJudge({ agent: tracked, rubric, judgedModel }).score({ result });
    assert.equal(scored.metadata?.attempts, 2);
    assert.equal(sessions.size, 2);
    assert.equal(opened, 2);
    assert.equal(closed, 2);
  } finally {
    await agent.dispose();
  }
});

it("rubric_judge_refuses_self_judging_and_missing_identity", async () => {
  const agent = await judgeAgent();
  try {
    assert.throws(() => createRubricJudge({ agent, rubric, judgedModel: agent.config.model }), { code: "ERR_PRISM_EVAL_JUDGE_SELF" });
    await assert.rejects(
      async () => createRubricJudge({ agent: () => agent, rubric, judgedModel: () => agent.config.model }).score({ result }),
      { code: "ERR_PRISM_EVAL_JUDGE_SELF" },
    );
    await assert.rejects(async () => createRubricJudge({ agent, rubric }).score({ result }), { code: "ERR_PRISM_EVAL_JUDGE_SELF" });
    assert.equal((await createRubricJudge({ agent, rubric, allowSelfJudging: true }).score({ result })).score, 1);
  } finally {
    await agent.dispose();
  }
});

it("rubric_judge_runs_without_tools", async () => {
  let executed = 0;
  const requests: ProviderRequest[] = [];
  const agent = await createAgent({
    model: { provider: "mock", model: "judge" },
    packages: [
      mockProvider([[providerToolCall({ type: "tool_call", id: "c", name: "danger", arguments: {} }), providerDone()]], {
        onRequest: (request) => requests.push(request),
      }),
    ],
    tools: {
      add: [
        {
          name: "danger",
          description: "must never run",
          parameters: { type: "object", properties: {} },
          async execute(_args, ctx) {
            executed++;
            return { toolCallId: ctx.toolCallId, name: "danger", value: "bad" };
          },
        },
      ],
    },
  });
  try {
    await scoreRun({ result, scorers: [createRubricJudge({ agent: () => agent, rubric, judgedModel })] });
    assert.equal(executed, 0);
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => (request.tools?.length ?? 0) === 0));
  } finally {
    await agent.dispose();
  }
});

it("rubric_judge_target_is_redacted_and_timeline_is_metadata_only", async () => {
  const prompts: string[] = [];
  const agent = await judgeAgent([JSON.stringify({ reasoning: `SECRET${"界".repeat(300)}`, label: "yes" })], (request) =>
    prompts.push(JSON.stringify(request)),
  );
  try {
    const judge = createRubricJudge({
      agent,
      rubric,
      judgedModel,
      include: "answer+timeline",
      reference: (item) => item.expected as string,
    });
    const [record] = await scoreRun({
      result: { ...result, text: "SECRET" },
      scorers: [judge],
      secrets: ["SECRET"],
      item: { id: "i", input: "SECRET", expected: "SECRET" },
      injectedTimeline: {
        schemaVersion: 1,
        status: "completed",
        startedAt: "now",
        input: "PRIVATE_IO",
        result: "PRIVATE_IO",
        steps: [
          {
            id: "step",
            kind: "tool",
            name: "read",
            order: 0,
            status: "completed",
            startedAt: "now",
            input: "PRIVATE_IO",
            output: "PRIVATE_IO",
            error: { message: "PRIVATE_IO" },
            metadata: { raw: "PRIVATE_IO" },
          },
        ],
      },
    });
    assert.equal(record?.status, "scored");
    assert.doesNotMatch(prompts[0]!, /SECRET|PRIVATE_IO/);
    assert.match(prompts[0]!, /read/);
    assert.ok(Buffer.byteLength(record?.metadata?.reasoning as string) <= 512);
    assert.doesNotMatch(JSON.stringify(record), /SECRET/);
  } finally {
    await agent.dispose();
  }
});

it("rubric_judge_bounds_input_before_calling_agent", async () => {
  let calls = 0;
  const agent = await judgeAgent([valid], () => calls++);
  try {
    await assert.rejects(async () => createRubricJudge({ agent, rubric, judgedModel, maxInputBytes: 1 }).score({ result }), {
      code: "ERR_PRISM_EVAL_JUDGE_BOUNDS",
    });
    assert.equal(calls, 0);
  } finally {
    await agent.dispose();
  }
});

it("rubric_judge_validates_rubric", async () => {
  const agent = await judgeAgent();
  try {
    for (const scale of [
      [],
      [...rubric.scale, rubric.scale[0]],
      [{ label: "bad", score: NaN, description: "bad" }],
      [{ label: "bad", score: 2, description: "bad" }],
    ]) {
      assert.throws(() => createRubricJudge({ agent, rubric: { ...rubric, scale }, judgedModel }), { code: "ERR_PRISM_EVAL_JUDGE" });
    }
  } finally {
    await agent.dispose();
  }
});

it("template_change_requires_version_bump", () => {
  assert.equal(RUBRIC_JUDGE_TEMPLATE_VERSION, "1");
  assert.equal(
    createHash("sha256").update(RUBRIC_JUDGE_TEMPLATE).digest("hex"),
    "54c29447f6ba5c7e4da60a81ea9e674f9eb4633afbd1cf9012e06fd69972f122",
  );
});

it("rubric_judge_timeout_bounds_factory_and_cancellation_stops_retries", async () => {
  let factories = 0;
  const judge = createRubricJudge({
    agent: () => {
      factories++;
      return new Promise(() => {});
    },
    rubric,
    judgedModel,
    timeoutMs: 5,
  });
  await assert.rejects(async () => judge.score({ result }), { code: "ERR_PRISM_EVAL_JUDGE_TIMEOUT" });
  assert.equal(factories, 2);
  const controller = new AbortController();
  const pending = judge.score({ result, signal: controller.signal });
  controller.abort(new Error("host cancelled"));
  await assert.rejects(async () => pending, /host cancelled/);
  assert.equal(factories, 3);
  await assert.rejects(async () => judge.score({ result, signal: controller.signal }), /host cancelled/);
  assert.equal(factories, 3);
});

it("rubric_judge_canonical_hash_and_score_ignore_later_rubric_mutation", async () => {
  const agent = await judgeAgent();
  const mutable = {
    scale: rubric.scale.map((anchor) => ({ ...anchor })),
    criteria: rubric.criteria,
    version: rubric.version,
    id: rubric.id,
  };
  try {
    const judge = createRubricJudge({ agent, rubric: mutable, judgedModel });
    mutable.scale[1]!.score = 0;
    const scored = await judge.score({ result });
    assert.equal(scored.score, 1);
    assert.equal(scored.metadata?.rubricHash, createHash("sha256").update(canonicalJson(rubric)).digest("hex"));
  } finally {
    await agent.dispose();
  }
});

it("rubric_judge_answer_default_omits_trace_and_timeline", async () => {
  let prompt = "";
  const agent = await judgeAgent([JSON.stringify({ reasoning: "no", label: "no" })], (request) => {
    prompt = JSON.stringify(request);
  });
  try {
    const judge = createRubricJudge({ agent, rubric, judgedModel });
    const scored = await judge.score({ result, timeline: { schemaVersion: 1, status: "PRIVATE_TIMELINE", startedAt: "now", steps: [] } });
    assert.equal(scored.score, 0);
    assert.doesNotMatch(prompt, /PRIVATE_TIMELINE/);
  } finally {
    await agent.dispose();
  }
});

it("rubric_judge_requires_requested_timeline", async () => {
  const agent = await judgeAgent();
  try {
    await assert.rejects(async () => createRubricJudge({ agent, rubric, judgedModel, include: "answer+timeline" }).score({ result }), {
      code: "ERR_PRISM_EVAL_TIMELINE_REQUIRED",
    });
  } finally {
    await agent.dispose();
  }
});

it("rubric_judge_error_passthrough_preserves_other_scorer_error_codes", async () => {
  const [record] = await scoreRun({ result, scorers: [{ id: "invalid-score", score: () => ({ score: 2 }) }] });
  assert.equal(record?.status, "failed");
  assert.equal(record?.error?.code, "ERR_PRISM_EVAL_SCORE");
});

const pairInput = {
  left: { name: "left-model", result: { ...result, text: "left answer" } },
  right: { name: "right-model", result: { ...result, text: "right answer" } },
  item: { id: "pair", input: "question" },
};
const judgedModels = { left: judgedModel, right: { ...judgedModel, model: "other" } };
const verdict = (winner: string, reasoning = "Compare answers") => JSON.stringify({ reasoning, winner });

for (const [name, replies, preference, inconsistent] of [
  ["position_biased_judge_yields_tie", [verdict("A"), verdict("A")], "tie", true],
  ["consistent_judge_yields_preference", [verdict("A"), verdict("B")], "left", false],
  ["consistent_right_preference", [verdict("B"), verdict("A")], "right", false],
  ["consistent_tie", [verdict("tie"), verdict("tie")], "tie", false],
  ["tie_and_preference_are_inconsistent", [verdict("tie"), verdict("A")], "tie", true],
] as const)
  it(name, async () => {
    let calls = 0;
    const agent = await judgeAgent([...replies], (request) => {
      calls++;
      assert.equal(request.tools?.length ?? 0, 0);
    });
    let opened = 0,
      closed = 0;
    const tracked = {
      ...agent,
      async session() {
        opened++;
        const session = await agent.session();
        return {
          ...session,
          run: session.run.bind(session),
          async close() {
            closed++;
            await session.close();
          },
        };
      },
    };
    try {
      const output = await createPairwiseJudge({ agent: tracked, rubric, judgedModels }).score(pairInput);
      assert.equal(output.preference, preference);
      assert.equal(output.metadata?.positionInconsistent, inconsistent);
      assert.equal(output.metadata?.lengthRatio, 11 / 12);
      assert.ok(output.metadata);
      const verdicts = output.metadata.verdicts;
      assert.ok(Array.isArray(verdicts));
      assert.equal(verdicts.length, 2);
      assert.equal(calls, 2);
      assert.equal(opened, 2);
      assert.equal(closed, 2);
    } finally {
      await agent.dispose();
    }
  });

it("position_consistency_rate_reported", async () => {
  const agent = await judgeAgent([verdict("A"), verdict("A"), verdict("A"), verdict("B"), "invalid", "invalid"]);
  try {
    const report = await runComparison({
      dataset: defineDataset({ id: "pairs", items: [0, 1, 2].map((id) => ({ id: String(id), input: "question" })) }),
      candidates: { a: async () => result, b: async () => result },
      concurrency: 1,
      scorers: [createPairwiseJudge({ agent, rubric, judgedModels }), { id: "plain", score: () => ({ preference: "tie" }) }],
    });
    assert.deepEqual(report.positionConsistency, { helpful: 0.5 });
    assert.equal(report.failures, 1);
    assert.equal(report.records[0]?.metadata?.positionInconsistent, true);
    assert.equal(report.records[2]?.metadata?.positionInconsistent, false);
  } finally {
    await agent.dispose();
  }
});

it("pairwise_redacts_before_swap_and_stores_safe_verdicts", async () => {
  const prompts: string[] = [];
  const agent = await judgeAgent([verdict("A", "SECRET"), verdict("B", "SECRET")], (request) => prompts.push(JSON.stringify(request)));
  try {
    const report = await runComparison({
      dataset: defineDataset({ id: "secret", items: [{ id: "i", input: "SECRET" }] }),
      candidates: { a: async () => ({ ...result, text: "SECRET left" }), b: async () => ({ ...result, text: "SECRET right" }) },
      secrets: ["SECRET"],
      scorers: [createPairwiseJudge({ agent, rubric, judgedModels })],
    });
    assert.equal(report.failures, 0);
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts.join(""), /SECRET/);
    assert.doesNotMatch(JSON.stringify(report), /SECRET/);
    assert.match(prompts[0]!, /left.*right/s);
    assert.match(prompts[1]!, /right.*left/s);
  } finally {
    await agent.dispose();
  }
});

it("pairwise_retries_invalid_outputs_and_allowTie_false_is_strict", async () => {
  for (const bad of [
    "invalid",
    verdict("unknown"),
    verdict("tie"),
    JSON.stringify({ reasoning: "ok", winner: "A", extra: true }),
    verdict("A", "界".repeat(1400)),
  ]) {
    const agent = await judgeAgent([bad, verdict("B"), verdict("A")]);
    try {
      const output = await createPairwiseJudge({ agent, rubric, judgedModels, allowTie: false }).score(pairInput);
      assert.equal(output.preference, "right");
      assert.ok(output.metadata);
      const verdicts = output.metadata.verdicts;
      assert.ok(Array.isArray(verdicts));
      assert.equal(verdicts[0]?.attempts, 2);
    } finally {
      await agent.dispose();
    }
  }
  const agent = await judgeAgent([verdict("A"), verdict("A")]);
  try {
    const output = await createPairwiseJudge({ agent, rubric, judgedModels, allowTie: false }).score(pairInput);
    assert.equal(output.preference, "tie"); // Inconsistency still yields a conservative tie.
  } finally {
    await agent.dispose();
  }
});

it("pairwise_checks_both_model_identities", async () => {
  const agent = await judgeAgent([verdict("A"), verdict("B")]);
  try {
    for (const models of [
      { left: agent.config.model!, right: judgedModel },
      { left: judgedModel, right: agent.config.model! },
    ]) {
      assert.throws(() => createPairwiseJudge({ agent, rubric, judgedModels: models }), { code: "ERR_PRISM_EVAL_JUDGE_SELF" });
      await assert.rejects(async () => createPairwiseJudge({ agent: () => agent, rubric, judgedModels: () => models }).score(pairInput), {
        code: "ERR_PRISM_EVAL_JUDGE_SELF",
      });
    }
    await assert.rejects(async () => createPairwiseJudge({ agent, rubric }).score(pairInput), { code: "ERR_PRISM_EVAL_JUDGE_SELF" });
    assert.equal((await createPairwiseJudge({ agent, rubric, allowSelfJudging: true }).score(pairInput)).preference, "left");
  } finally {
    await agent.dispose();
  }
});

it("pairwise_bounds_and_cancellation_prevent_calls", async () => {
  let calls = 0;
  const agent = await judgeAgent([verdict("A")], () => calls++);
  try {
    await assert.rejects(async () => createPairwiseJudge({ agent, rubric, judgedModels, maxInputBytes: 1 }).score(pairInput), {
      code: "ERR_PRISM_EVAL_JUDGE_BOUNDS",
    });
    const signal = AbortSignal.abort(new Error("cancel pair"));
    await assert.rejects(async () => createPairwiseJudge({ agent, rubric, judgedModels }).score({ ...pairInput, signal }), /cancel pair/);
    assert.equal(calls, 0);
  } finally {
    await agent.dispose();
  }
});

it("pairwise_empty_answers_have_finite_length_ratio", async () => {
  const agent = await judgeAgent([verdict("tie")]);
  try {
    const output = await createPairwiseJudge({ agent, rubric, judgedModels }).score({
      ...pairInput,
      left: { name: "l", result: { ...result, text: "" } },
      right: { name: "r", result: { ...result, text: "" } },
    });
    assert.equal(output.metadata?.lengthRatio, 1);
  } finally {
    await agent.dispose();
  }
});

it("pairwise_template_change_requires_version_bump", () => {
  assert.equal(PAIRWISE_JUDGE_TEMPLATE_VERSION, "1");
  assert.equal(
    createHash("sha256").update(PAIRWISE_JUDGE_TEMPLATE).digest("hex"),
    "d6c0e04c19625c3b9e1a3b582a59a1051dc7180125097c34542dc4ab8f343a3c",
  );
});

it("pairwise_failed_second_order_does_not_become_a_tie", async () => {
  const agent = await judgeAgent([verdict("A"), "invalid"]);
  try {
    const report = await runComparison({
      dataset: defineDataset({ id: "failed-swap", items: [{ id: "i", input: "q" }] }),
      candidates: { a: async () => result, b: async () => result },
      scorers: [createPairwiseJudge({ agent, rubric, judgedModels })],
    });
    assert.equal(report.records[0]?.status, "failed");
    assert.equal(report.records[0]?.error?.code, "ERR_PRISM_EVAL_JUDGE_OUTPUT");
    assert.equal(report.records[0]?.preference, undefined);
    assert.equal(report.ties, 0);
    assert.deepEqual(report.positionConsistency, {});
  } finally {
    await agent.dispose();
  }
});

function panelJudge(id: string, score: number, label?: string): Scorer {
  return {
    id,
    judgeModel: { provider: "mock", model: id },
    score: () => ({ score, metadata: { ...(label === undefined ? {} : { label }), judgeModel: { provider: "mock", model: id } } }),
  };
}
const panelError = { code: "ERR_PRISM_EVAL_JUDGE_PANEL" };

it("panel_majority_label_and_conservative_ties", async () => {
  const judges = [panelJudge("a", 1, "yes"), panelJudge("b", 0, "no"), panelJudge("c", 1, "yes")];
  const verdict = await createJudgePanel({ id: "panel", judges, combine: "majority" }).score({ result });
  assert.equal(verdict.score, 1);
  assert.equal(verdict.metadata?.label, "yes");
  assert.deepEqual(verdict.metadata?.labels, ["yes", "no", "yes"]);
  assert.equal(verdict.metadata?.failedJudges, 0);
  assert.ok(verdict.metadata);
  const scoredJudges = verdict.metadata.judges;
  assert.ok(Array.isArray(scoredJudges));
  assert.deepEqual(scoredJudges[0], {
    id: "a",
    model: { provider: "mock", model: "a" },
    label: "yes",
    score: 1,
    status: "scored",
  });
  for (const tied of [judges.slice(0, 2), judges.slice(0, 2).reverse()]) {
    const verdict = await createJudgePanel({ id: "tie", judges: tied, combine: "majority" }).score({ result });
    assert.equal(verdict.score, 0);
    assert.equal(verdict.metadata?.label, "no");
  }
});

it("panel_mean_and_median", async () => {
  const judges = [panelJudge("a", 0), panelJudge("b", 0.6), panelJudge("c", 0.9)];
  assert.equal((await createJudgePanel({ id: "mean", judges, combine: "mean" }).score({ result })).score, 0.5);
  assert.equal((await createJudgePanel({ id: "median", judges, combine: "median" }).score({ result })).score, 0.6);
  assert.equal((await createJudgePanel({ id: "even", judges: judges.slice(0, 2), combine: "median" }).score({ result })).score, 0.3);
});

it("panel_fails_when_most_judges_fail_and_runs_every_judge", async () => {
  let calls = 0;
  const bad: Scorer = {
    ...panelJudge("bad", 0),
    score() {
      calls++;
      throw new Error("private failure");
    },
  };
  const ok = panelJudge("ok", 1, "yes");
  const invalid = panelJudge("invalid", NaN, "yes");
  const panel = createJudgePanel({ id: "panel", judges: [bad, invalid, ok], combine: "majority" });
  const [record] = await scoreRun({ result, scorers: [panel] });
  assert.equal(record?.status, "failed");
  assert.equal(record?.error?.code, panelError.code);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(record), /private failure/);
  const verdict = await createJudgePanel({ id: "half", judges: [bad, ok], combine: "majority" }).score({ result });
  assert.equal(verdict.score, 1);
  assert.equal(verdict.metadata?.failedJudges, 1);
  assert.deepEqual(verdict.metadata?.labels, [null, "yes"]);
  assert.ok(verdict.metadata);
  const scoredJudges = verdict.metadata.judges;
  assert.ok(Array.isArray(scoredJudges));
  assert.equal(scoredJudges[0]?.status, "failed");
  const missingLabel = createJudgePanel({ id: "missing", judges: [panelJudge("x", 1)], combine: "majority" });
  await assert.rejects(async () => missingLabel.score({ result }), panelError);
});

it("panel_rejects_duplicate_models_unknown_models_and_invalid_options", () => {
  const a = panelJudge("a", 1, "yes");
  const b = { ...a, id: "b" };
  assert.throws(() => createJudgePanel({ id: "panel", judges: [a, b], combine: "majority" }), panelError);
  assert.throws(() => createJudgePanel({ id: "panel", judges: [{ ...a, judgeModel: undefined }], combine: "mean" }), panelError);
  assert.doesNotThrow(() => createJudgePanel({ id: "panel", judges: [a, b], combine: "mean", requireDistinctModels: false }));
  assert.doesNotThrow(() =>
    createJudgePanel({ id: "panel", judges: [a, defineScorer({ ...a, judgeModel: { provider: "other", model: "a" } })], combine: "mean" }),
  );
  for (const options of [
    { id: "", judges: [a], combine: "mean" as const },
    { id: "p", judges: [], combine: "mean" as const },
    { id: "p", judges: [{ ...a, id: "" }], combine: "mean" as const },
  ]) {
    assert.throws(() => createJudgePanel(options), panelError);
  }
});

it("panel_forwards_inputs_requirements_and_cancellation", async () => {
  const redactor = createSecretRedactor(["SECRET"]);
  const input = { result, redactor };
  const judge: Scorer = {
    ...panelJudge("a", 1),
    requires: ["timeline", "environment"],
    score(actual) {
      assert.equal(actual, input);
      assert.equal(actual.redactor, redactor);
      return { score: 1 };
    },
  };
  const panel = createJudgePanel({ id: "panel", judges: [judge], combine: "mean" });
  assert.deepEqual(panel.requires, ["timeline", "environment"]);
  await panel.score(input);
  const controller = new AbortController();
  const cancelled = createJudgePanel({
    id: "cancel",
    judges: [
      {
        ...panelJudge("a", 1),
        score() {
          controller.abort(new Error("cancelled"));
          return { score: 1 };
        },
      },
    ],
    combine: "mean",
  });
  await assert.rejects(async () => cancelled.score({ result, signal: controller.signal }), /cancelled/);
});

it("panel_uses_static_rubric_judge_model_and_redacts_prompts", async () => {
  const prompts: string[] = [];
  const a = await judgeAgent([valid], (request) => prompts.push(JSON.stringify(request)));
  const b = await createAgent({
    model: { provider: "mock", model: "other-judge" },
    packages: [
      mockProvider([[providerTextDelta(valid), providerDone()]], { onRequest: (request) => prompts.push(JSON.stringify(request)) }),
    ],
  });
  try {
    const first = createRubricJudge({ id: "a", agent: a, rubric, judgedModel });
    assert.deepEqual(first.judgeModel, a.config.model);
    const panel = createJudgePanel({
      id: "p",
      judges: [first, createRubricJudge({ id: "b", agent: b, rubric, judgedModel })],
      combine: "majority",
    });
    const [record] = await scoreRun({ result: { ...result, text: "SECRET" }, secrets: ["SECRET"], scorers: [panel] });
    assert.equal(record?.score, 1);
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts.join(""), /SECRET/);
  } finally {
    await a.dispose();
    await b.dispose();
  }
});

it("panel_experiment_reports_fleiss_agreement_and_omits_incomplete_evidence", async () => {
  const agent = await judgeAgent();
  const dataset = defineDataset({
    id: "labels",
    items: [
      { id: "yes", input: "yes" },
      { id: "no", input: "no" },
    ],
  });
  const judges: Scorer<string>[] = ["a", "b"].map((id) => ({
    id,
    judgeModel: { provider: "mock", model: id },
    score: (input) => ({ score: input.item?.id === "yes" ? 1 : 0, metadata: { label: input.item?.id } }),
  }));
  try {
    const panel = createJudgePanel({ id: "p", judges, combine: "majority" });
    const report = await runExperiment({ agent, dataset, scorers: [panel] });
    assert.equal(report.aggregate.scorers.p?.judgeAgreement, 1);
    const incomplete = createJudgePanel({
      id: "p",
      judges: [
        judges[0]!,
        {
          ...judges[1]!,
          score() {
            throw new Error("failed");
          },
        },
      ],
      combine: "majority",
    });
    const partial = await runExperiment({ agent, dataset, scorers: [incomplete] });
    assert.equal(partial.aggregate.scorers.p?.judgeAgreement, undefined);
    const unlabeled = await runExperiment({
      agent,
      dataset,
      scorers: [createJudgePanel({ id: "p", judges: [panelJudge("a", 1), panelJudge("b", 0)], combine: "mean" })],
    });
    assert.equal(unlabeled.aggregate.scorers.p?.judgeAgreement, undefined);
  } finally {
    await agent.dispose();
  }
});

it("candidate_error_is_forfeit_loss_including_falsy_throws_and_failed_results", async () => {
  let calls = 0;
  const report = await runComparison({
    dataset: defineDataset({ id: "forfeit", items: [{ id: "i", input: "" }] }),
    candidates: {
      a: async () => {
        throw undefined;
      },
      b: async () => result,
      c: async () => ({ ...result, status: "failed" }),
    },
    scorers: [
      {
        id: "s",
        score: () => {
          calls++;
          return { preference: "tie" };
        },
      },
    ],
  });
  assert.equal(calls, 0);
  assert.equal(report.failures, 1);
  assert.equal(report.wins.b, 2);
  assert.equal(report.records.find((r) => r.left === "a" && r.right === "b")?.metadata?.forfeit, "a");
  assert.equal(report.records.find((r) => r.left === "b" && r.right === "c")?.metadata?.forfeit, "c");
});

it("trials_multiply_judgments_and_rank_per_scorer_deterministically", async () => {
  let calls = 0,
    judgments = 0;
  const dataset = defineDataset({ id: "trials", items: Array.from({ length: 60 }, (_, id) => ({ id: String(id), input: id })) });
  const options = {
    dataset,
    trials: 3,
    seed: 7,
    candidates: {
      a: async () => {
        calls++;
        return result;
      },
      b: async () => {
        calls++;
        return result;
      },
    },
    scorers: [
      {
        id: "s",
        score: ({ item }: { item: { input: number } }) => {
          judgments++;
          return { preference: item.input < 40 ? ("left" as const) : ("right" as const) };
        },
      },
      { id: "t", score: () => ({ preference: "tie" as const }) },
    ],
  };
  const report = await runComparison({ ...options, concurrency: 1 });
  assert.equal(calls, 360);
  assert.equal(judgments, 180);
  assert.equal(report.records.length, 360);
  assert.deepEqual([...new Set(report.records.map((r) => r.trialIndex))], [0, 1, 2]);
  assert.deepEqual(report.ranking, (await runComparison({ ...options, concurrency: 8 })).ranking);
  const ranked = report.ranking.filter((r) => r.scorerId === "s");
  assert.ok(Math.abs(ranked[0]!.strength! - Math.sqrt(2)) < 1e-8);
  const scored = report.records.filter((r) => r.scorerId === "s");
  let undefinedDraw = false;
  const expected = bootstrapInterval(
    scored.map((_, i) => i),
    {
      seed: 7,
      resamples: 1000,
      clusterIds: scored.map((r) => r.itemId),
      statistic: (indices) => {
        const fit = bradleyTerry(indices.map((i) => ({ ...scored[i]!, preference: scored[i]!.preference! })));
        if (!fit) undefinedDraw = true;
        return fit?.a ?? 0;
      },
    },
  );
  assert.equal(undefinedDraw, false);
  assert.deepEqual(ranked[0]!.ci95, [expected.low, expected.high]);
  assert.ok(report.ranking.filter((r) => r.scorerId === "t").every((r) => r.rank === 1 && r.strength === 1));
});

it("comparison_validates_trials_and_preserves_scorer_failures", async () => {
  const options = {
    dataset: defineDataset({ id: "bounds", items: [{ id: "i", input: "" }] }),
    candidates: { a: async () => result, b: async () => result },
    scorers: [
      {
        id: "s",
        score: () => {
          throw new Error("SECRET");
        },
      },
    ],
    secrets: ["SECRET"],
  };
  for (const trials of [0, 17, 1.5, NaN]) await assert.rejects(() => runComparison({ ...options, trials }));
  await assert.rejects(() => runComparison({ ...options, seed: 0.1 }));
  const report = await runComparison(options);
  assert.equal(report.failures, 1);
  assert.equal(report.records[0]?.error?.message, "[REDACTED]");
  assert.ok(report.ranking.every((r) => r.strength === null && r.ci95 === null && r.rank === null));
});

it("comparison_ci_overlap_shares_rank_and_separated_intervals_rank_strictly", async () => {
  const dataset = defineDataset({ id: "ranks", items: Array.from({ length: 100 }, (_, id) => ({ id: String(id), input: id })) });
  const report = await runComparison({
    dataset,
    seed: 1,
    candidates: { a: async () => result, b: async () => result },
    scorers: [
      { id: "overlap", score: ({ item }) => ({ preference: item.input < 50 ? "left" : "right" }) },
      { id: "separate", score: ({ item }) => ({ preference: item.input < 80 ? "left" : "right" }) },
    ],
  });
  assert.deepEqual(
    report.ranking.filter((r) => r.scorerId === "overlap").map((r) => r.rank),
    [1, 1],
  );
  assert.deepEqual(
    report.ranking.filter((r) => r.scorerId === "separate").map((r) => r.rank),
    [1, 2],
  );
});

it("comparison_marks_separated_bootstrap_and_missing_candidates_unavailable", async () => {
  const report = await runComparison({
    dataset: defineDataset({
      id: "sparse",
      items: [
        { id: "i", input: 0 },
        { id: "j", input: 1 },
      ],
    }),
    candidates: { a: async () => result, b: async () => result },
    seed: 1,
    scorers: [{ id: "s", score: ({ item }) => ({ preference: item.input ? "left" : "right" }) }],
  });
  assert.ok(report.ranking.every((r) => r.strength === 1 && r.ci95 === null && r.rank === null));
  const oneSided = await runComparison({
    dataset: defineDataset({ id: "separated", items: [{ id: "i", input: "" }] }),
    candidates: {
      a: async () => result,
      b: async () => {
        throw null;
      },
    },
    scorers: [{ id: "s", score: () => ({ preference: "tie" }) }],
  });
  assert.equal(oneSided.failures, 0);
  assert.doesNotThrow(() => assertEvaluationThreshold(oneSided, { minimumCandidateWins: { a: 1 } }));
  assert.ok(oneSided.ranking.every((r) => r.strength === null && r.rank === null));
});

it("comparison_hard_trial_limit_and_unique_scorer_ids_are_checked_before_runs", async () => {
  let runs = 0;
  const options = {
    dataset: defineDataset({ id: "limits", items: [{ id: "i", input: "" }] }),
    candidates: {
      a: async () => {
        runs++;
        return result;
      },
      b: async () => {
        runs++;
        return result;
      },
    },
    scorers: [{ id: "s", score: () => ({ preference: "tie" as const }) }],
  };
  await assert.rejects(() => runComparison({ ...options, scorers: [...options.scorers, ...options.scorers] }));
  await assert.rejects(() => runComparison({ ...options, seed: Number.MAX_SAFE_INTEGER + 1 }));
  assert.equal(runs, 0);
  const report = await runComparison({ ...options, trials: 16 });
  assert.equal(runs, 32);
  assert.equal(report.records.length, 16);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => runComparison({ ...options, signal: controller.signal }));
  assert.equal(runs, 32);
});
