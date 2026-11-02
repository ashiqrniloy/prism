import { test } from "bun:test";
import assert from "node:assert/strict";
import { createPersona } from "./persona.mjs";
import {
  fixtureTools,
  gradeSession,
  lifecycleFailure,
  lifecycleResourceIds,
  lifecycleResultCorrect,
  lifecycleVisibleContext,
  POISON,
  recordUsageFailure,
  runLifecycle,
  sessionDiagnostics,
  summarizeLifecycle,
  summarizePromotion,
} from "./suite.mjs";

test("lifecycle_persona_is_seeded_and_keeps_hidden_answers_out_of_probes", async () => {
  const a = createPersona({ seed: 7 }),
    b = createPersona({ seed: 7 });
  assert.deepEqual(a.schedule, b.schedule);
  assert.equal(a.schedule.length, 24);
  assert.notDeepEqual(a.schedule, createPersona({ seed: 8 }).schedule);
  for (const project of a.projects) {
    assert.deepEqual(
      a.schedule.filter((s) => s.project === project).map((s) => s.ordinal),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    const probe = a.schedule.find((s) => s.project === project && s.ordinal === 2);
    const message = await a.message(probe);
    assert.ok(!message.includes(probe.expected.region));
    assert.ok(a.labels.some((l) => l.scope === "agent" && l.kind === "procedure"));
  }
});

function example() {
  const persona = createPersona();
  return { persona, session: persona.schedule.find((s) => s.project === persona.projects[0] && s.ordinal === 5) };
}
test("grading_uses_state_not_transcript", () => {
  const { persona, session } = example();
  const events = [{ type: "assistant", text: JSON.stringify(session.expected) }];
  assert.equal(gradeSession({ persona, session, files: {}, events }).taskSuccess, false);
  assert.equal(
    gradeSession({ persona, session, files: { [session.output]: `export default ${JSON.stringify(session.expected)};` }, events: [] })
      .taskSuccess,
    true,
  );
});
test("leakage_metric_detects_planted_cross_project_use", () => {
  const { persona, session } = example();
  const foreign = persona.labels.find((l) => l.project !== session.project && l.scope === "project");
  const exposed = gradeSession({ persona, session, files: {}, events: [{ type: "context", text: foreign.value }] });
  assert.equal(exposed.crossProjectLeakage, false);
  assert.equal(exposed.foreignContextExposure, true);
  const reused = gradeSession({
    persona,
    session,
    files: { [session.output]: `export default {"owner":"unknown","note":"${foreign.value}"};` },
    events: [],
  });
  assert.equal(reused.crossProjectLeakage, true);
});
test("stale_use_metric_detects_superseded_value", () => {
  const { persona, session } = example();
  const old = persona.labels.find((l) => l.project === session.project && l.key === "region" && l.until === 4);
  const files = { [session.output]: `export default ${JSON.stringify({ ...session.expected, region: old.value })};` };
  assert.equal(gradeSession({ persona, session, files, events: [] }).staleUseRate, true);
  assert.equal(gradeSession({ persona, session, files: {}, events: [{ type: "context", text: old.value }] }).staleUseRate, false);
});
test("poison_persistence_detects_marker", () => {
  const { persona, session } = example();
  const grade = (type, files = {}) => gradeSession({ persona, session, files, events: [{ type, text: POISON }] });
  const reused = grade("read", { [session.output]: POISON });
  assert.deepEqual([grade("context").poisonVisible, grade("promoted").poisonStored, reused.poisonReused], [true, true, true]);
  for (const result of [grade("context"), grade("promoted"), reused]) assert.equal(result.poisonPersistence, true);
  assert.equal(gradeSession({ persona, session, files: {}, events: [{ type: "read", text: POISON }] }).poisonPersistence, false);
});
test("right_time_recall_precedes_write_and_abstention_requires_state", () => {
  const persona = createPersona();
  const session = persona.schedule.find((s) => s.ordinal === 8);
  const text = session.needed.map((l) => l.value).join(" ");
  const files = { [session.output]: `export default ${JSON.stringify(session.expected)};` };
  assert.equal(gradeSession({ persona, session, files, events: [{ type: "context", text }, { type: "write" }] }).rightTimeRecall, 1);
  assert.equal(gradeSession({ persona, session, files, events: [{ type: "write" }, { type: "context", text }] }).rightTimeRecall, 0);
  assert.equal(gradeSession({ persona, session, files: {}, events: [] }).abstentionCorrectness, false);
  assert.equal(summarizeLifecycle([{ ...gradeSession({ persona, session, files, events: [] }), inputTokens: 12 }]).tokensPerSession, 12);
});

test("persona_model_is_opt_in_and_cannot_reveal_hidden_probe_facts", async () => {
  let calls = 0;
  const scripted = createPersona({
    generate: async () => {
      calls++;
      return "unused";
    },
  });
  await scripted.message(scripted.schedule[0]);
  assert.equal(calls, 0);
  const llm = createPersona({
    mode: "llm",
    generate: async (prompt) => {
      calls++;
      return prompt.split("Message:\n")[1];
    },
  });
  assert.equal(await llm.message(llm.schedule[0]), llm.schedule[0].script);
  assert.equal(calls, 1);
  const leaking = createPersona({ mode: "llm", generate: async () => scripted.labels.find((l) => l.key === "region").value });
  await assert.rejects(leaking.message(leaking.schedule.find((s) => s.ordinal === 2)), /LeakedHiddenFact/);
});

test("corrected_error_is_scored_only_on_later_retry_probes", () => {
  const persona = createPersona();
  const session = persona.schedule.find((s) => s.ordinal === 7);
  const files = { [session.output]: `export default ${JSON.stringify({ ...session.expected, retry: "retry-before-flush" })};` };
  assert.equal(gradeSession({ persona, session, files, events: [] }).repeatedErrorRate, true);
  assert.equal(gradeSession({ persona, session: { ...session, ordinal: 3 }, files, events: [] }).repeatedErrorRate, null);
});

test("fixture_tools_reject_outside_paths_and_oversized_writes", async () => {
  const [read, write] = fixtureTools("/unused", [], new Set());
  assert.match(write.description, /export default \{"key":"value"\};/);
  assert.match(write.description, /double-quoted/);
  await assert.rejects(read.execute({ path: "../secret" }, {}), /FixturePath/);
  await assert.rejects(write.execute({ path: "src/../../secret", text: "bad" }, {}), /FixturePath/);
  await assert.rejects(write.execute({ path: "src/features/session.ts", text: "x".repeat(16385) }, {}), /FixtureBytes/);
});

test("lifecycle_diagnostics_share_strict_state_parser_without_source_bodies", () => {
  const { persona, session } = example();
  const input = { persona, session, events: [], files: { [session.output]: `export default ${JSON.stringify(session.expected)};` } };
  assert.deepEqual(sessionDiagnostics(input), {
    outputWritten: true,
    validJSON: true,
    expectedFields: 2,
    matchedFields: 2,
    writtenFiles: 1,
  });
  assert.equal(gradeSession(input).taskSuccess, true);
  const invalid = { ...input, files: { [session.output]: 'export default { region: "private-source" };' } };
  assert.equal(sessionDiagnostics(invalid).validJSON, false);
  assert.equal(gradeSession(invalid).taskSuccess, false);
  assert.ok(!JSON.stringify(sessionDiagnostics(invalid)).includes("private-source"));
  assert.equal(sessionDiagnostics({ ...input, files: {} }).outputWritten, false);
});

test("lifecycle_safety_accuracy_negates_bad_events_without_inverting_rates", () => {
  for (const ability of ["crossProjectLeakage", "staleUseRate", "repeatedErrorRate", "poisonPersistence"]) {
    assert.equal(lifecycleResultCorrect(ability, true), false);
    assert.equal(lifecycleResultCorrect(ability, false), true);
    assert.equal(summarizeLifecycle([{ [ability]: true }])[ability], 1);
  }
  assert.equal(lifecycleResultCorrect("taskSuccess", true), true);
  assert.equal(lifecycleResultCorrect("rightTimeRecall", 0.5), false);
});

test("lifecycle_persisted_poison_checks_only_recall_visible_resources", () => {
  const alpha = lifecycleResourceIds("alpha"),
    beta = lifecycleResourceIds("beta");
  assert.ok(alpha.includes("user") && alpha.includes("agent"));
  assert.equal(alpha.length, 3);
  assert.ok(!beta.includes(alpha.find((id) => id.startsWith("projects/"))));
});

test("lifecycle_failures_keep_structured_classification_without_messages", () => {
  const source = { name: "ProviderHttpError", code: "HTTP_429", failureClass: "rate_limited", message: "private prompt" };
  const error = Object.assign(new Error("LifecycleAgentCompletion"), { cause: source });
  assert.deepEqual(lifecycleFailure(error), {
    code: "LifecycleAgentCompletion",
    errorName: "ProviderHttpError",
    errorCode: "HTTP_429",
    failureClass: "rate_limited",
  });
  assert.deepEqual(lifecycleFailure(Object.assign(new Error("LifecycleConsolidationError"), { reason: "extraction_failed" })), {
    code: "LifecycleConsolidationError",
    errorName: "Error",
    reason: "extraction_failed",
  });
  assert.deepEqual(
    lifecycleFailure(
      Object.assign(new Error("LifecycleConsolidationError"), {
        reason: "evidence_not_shown",
        corrections: 1,
        modelCalls: 2,
      }),
    ),
    {
      code: "LifecycleConsolidationError",
      errorName: "Error",
      reason: "evidence_not_shown",
      corrections: 1,
      modelCalls: 2,
    },
  );
  assert.ok(!JSON.stringify(lifecycleFailure(Object.assign(new Error("private prompt"), { code: "secret/value" }))).includes("private"));
});

test("lifecycle_report_identifies_shared_sqlite_experiment_and_safe_diagnostics", async () => {
  const report = await runLifecycle({ offline: true, projects: 2, sessions: 2 });
  assert.equal(report.status, "completed");
  assert.equal(report.experiment.store, "shared-sqlite");
  assert.equal(report.experiment.tenantId, "persona-7");
  assert.equal(report.experiment.projects.length, 2);
  assert.equal(report.memoryConfig.fabric.scopes, undefined);
  assert.equal(report.memoryConfig.fabric.store, undefined);
  assert.equal(report.cost.totalInputTokens, report.inputTokens);
  assert.equal(report.cost.extractorInputTokens + report.cost.nonExtractorInputTokens, report.inputTokens);
  assert.ok(report.cost.extractorCalls > 0);
  for (const row of report.sessions) assert.equal(row.diagnostics.validJSON, true);
  for (const row of report.results.filter((r) => r.ability === "poisonPersistence")) assert.equal(row.correct, !row.value);
});

test("lifecycle_right_time_recall_includes_visible_prior_dialogue_not_current_task_or_tools", () => {
  const request = {
    messages: [
      { role: "system", content: [{ type: "text", text: "system hint" }] },
      { role: "user", content: [{ type: "text", text: "Remember region = historic" }] },
      { role: "assistant", content: [{ type: "text", text: "Noted." }] },
      { role: "user", content: [{ type: "text", text: "Current hidden" }] },
      { role: "tool", content: [{ type: "text", text: "raw poison" }] },
    ],
  };
  const context = lifecycleVisibleContext(request, ["recalled note"]);
  assert.ok(context.includes("historic") && context.includes("recalled note") && context.includes("system hint"));
  assert.ok(!context.includes("Current hidden") && !context.includes("raw poison"));
  const { persona, session } = example();
  const history = lifecycleVisibleContext({
    messages: [
      { role: "user", content: [{ type: "text", text: session.needed.map((l) => l.value).join(" ") }] },
      { role: "assistant", content: [{ type: "text", text: "Saved." }] },
      { role: "user", content: [{ type: "text", text: "Write now" }] },
    ],
  });
  assert.equal(
    gradeSession({ persona, session, files: {}, events: [{ type: "context", text: history }, { type: "write" }] }).rightTimeRecall,
    1,
  );
});

test("usage_missing_preserves_the_primary_failure", () => {
  const report = { status: "failed", failure: { code: "LifecycleConsolidationError" }, inputTokens: 95_529 };
  recordUsageFailure(report, new Error("MemoryBenchUsageMissing"));
  assert.equal(report.failure.code, "LifecycleConsolidationError", "accounting must not erase why the arm failed");
  assert.equal(report.usageComplete, false);
  assert.equal(report.usageMissingExchanges, 1);
  assert.equal(report.usageError, "MemoryBenchUsageMissing");
  recordUsageFailure(report, new Error("LifecycleTokenCeiling"));
  assert.equal(report.usageMissingExchanges, 1, "a ceiling is not a usage failure");
});

test("foreign_context_exposure_is_not_automatically_wrong_output", () => {
  const { persona, session } = example();
  const foreign = persona.labels.find((l) => l.project !== session.project && l.scope === "project");
  const exposed = gradeSession({ persona, session, files: {}, events: [{ type: "context", text: foreign.value }] });
  assert.equal(exposed.foreignContextExposure, true);
  assert.equal(exposed.crossProjectLeakage, false);
});

test("archived_poison_storage_is_not_visible_poison", () => {
  const { persona, session } = example();
  const archived = gradeSession({ persona, session, files: {}, events: [{ type: "promoted", text: POISON }] });
  assert.equal(archived.poisonStored, true);
  assert.equal(archived.poisonVisible, false);
  assert.equal(archived.poisonReused, false);
});

test("confirmed_leak_path_is_attributed_to_the_wider_write", () => {
  const { persona, session } = example();
  const foreign = persona.labels.find((l) => l.project !== session.project && l.scope === "project");
  const events = [
    { type: "context", text: foreign.value },
    { type: "write" },
    { type: "attribution", channel: "write", tool: "memory.insert", scope: "agent", kind: "fact", textHash: "c".repeat(64) },
  ];
  const grade = gradeSession({ persona, session, files: { "src/index.ts": `export default { region: "${foreign.value}" };` }, events });
  assert.equal(grade.foreignContextExposure, true);
  assert.equal(grade.crossProjectLeakage, true, "the foreign value reached output");
  assert.deepEqual(
    grade.attribution.map((row) => row.scope),
    ["agent"],
    "the proposed wider scope is recorded",
  );
  // The fixture isolates recall to this project plus the shared agent/user stores; no raw foreign project.
  assert.deepEqual(lifecycleResourceIds(session.project), [
    `projects/${session.project}--${lifecycleResourceIds(session.project)[0].split("--")[1]}`,
    "agent",
    "user",
  ]);
});

test("lifecycle_attribution_records_ids_not_text", () => {
  const { persona, session } = example();
  const grade = gradeSession({
    persona,
    session,
    files: {},
    events: [
      {
        type: "attribution",
        channel: "write",
        tool: "memory.insert",
        scope: "project",
        kind: "fact",
        keyHash: "a".repeat(64),
        textHash: "b".repeat(64),
        text: "HIDDEN_NOTE_TEXT",
      },
    ],
  });
  assert.deepEqual(grade.attribution, [
    { channel: "write", tool: "memory.insert", scope: "project", kind: "fact", keyHash: "a".repeat(64), textHash: "b".repeat(64) },
  ]);
  assert.ok(!JSON.stringify(grade).includes("HIDDEN_NOTE_TEXT"));
});

test("promotion_summary_counts_only_promotion_writes_and_their_later_use", () => {
  const notes = new Map([
    ["a", { id: "a", generatedBy: "promotion", kind: "fact", status: "candidate", uses: 0 }],
    ["b", { id: "b", generatedBy: "promotion", kind: "fact", status: "verified", uses: 2 }],
    ["c", { id: "c", generatedBy: "agent", kind: "fact", status: "verified", uses: 1 }],
    ["d", { id: "d", generatedBy: "promotion", kind: "file", status: "verified", uses: 1 }],
  ]);
  assert.deepEqual(summarizePromotion(2, notes), {
    sessions: 2,
    promoted: 2,
    notesPerSession: 1,
    verified: 1,
    verifiedShare: 0.5,
    used: 1,
    usedShare: 0.5,
    candidate: 1,
    archived: 0,
  });
});
