/**
 * Plan 218 Task 3: relevance-driven compression. Protections are code (`discard` refuses them), the target is pressure,
 * a batch whose protected share exceeds the target records `budget_unmet`, and `wm.policy: "deterministic"` makes no call.
 */
import { it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonValue, ModelClient, SessionContext, SessionEntry, SessionLog } from "@arnilo/prism";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { createObservationalMemoryCommands } from "../commands.js";
import { resolveMemorySystemConfig } from "../config.js";
import { createObservationalFlush } from "../flush.js";
import { activeObservations, activeWmItems, foldObservationalMemoryLedger } from "../ledger.js";
import { isProtectedWmItem, protectedRecords } from "../protections.js";
import { salienceSignals } from "../salience.js";
import { prepareScope } from "../scope.js";
import {
  type MemoryObservation,
  type MemoryTaskState,
  type MemoryWmItem,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  TASK_STATE_RECORDED,
  WM_RECORDED,
  type WmRecordedData,
} from "../types.js";
import { DEFAULT_WM_INSTRUCTION, deterministicWm, salienceOrder } from "../workers/wm.js";
import { judgeClient, promptText } from "./judge-helpers.js";

type ProviderRequest = Parameters<ModelClient["generate"]>[0];

let clock = 0;
const record = (id: string, description: string, extra: Partial<MemoryObservation> = {}): MemoryObservation => {
  clock += 1;
  return {
    id,
    kind: "result",
    description,
    timestamp: `2026-11-12T10:${String(clock).padStart(2, "0")}:00.000Z`,
    relevance: "medium",
    sourceEntryIds: [`e-${id.slice(0, 2)}`],
    tokenCount: 10,
    ...extra,
  };
};
const recorded = (...observations: MemoryObservation[]) => ({ type: OBSERVATIONS_RECORDED, observations, coversUpToId: "end" });
const taskState = (sourceEntryIds: readonly string[], openQuestions?: readonly string[]): { type: string; taskState: MemoryTaskState } => ({
  type: TASK_STATE_RECORDED,
  taskState: { id: "777777777777", goal: "Ship the retry fix", ...(openQuestions ? { openQuestions } : {}), sourceEntryIds },
});
const fact = (id: string, citedIds: readonly string[]): MemoryWmItem => ({
  id,
  kind: "fact",
  text: "The retry fix lives in worker.ts",
  relevance: "high",
  citedIds,
  tokenCount: 8,
});

// One record per protection class, and one plain record.
const REQUEST = record("a1a1a1a1a1a1", "User asked to ship the retry fix", { kind: "request", sourceEntryIds: ["e-task"] });
const QUESTION = record("b2b2b2b2b2b2", "Should the retry cap be 3 or 5?", { kind: "statement", sourceEntryIds: ["e-task"] });
const ERROR = record("c3c3c3c3c3c3", "bun test failed: 2 retry cases", { kind: "error" });
const CITED = record("d4d4d4d4d4d4", "Read worker.ts retry loop");
const LATER = record("e5e5e5e5e5e5", "Measured retry latency 40ms");
const PLAIN = record("f6f6f6f6f6f6", "Listed the package directory");
const ALL = [REQUEST, QUESTION, ERROR, CITED, LATER, PLAIN];

const done: ModelClient = {
  model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
  async *generate() {
    yield providerDone();
  },
};

function scripted(calls: readonly [string, Record<string, unknown>][], requests: ProviderRequest[] = []): ModelClient {
  return {
    ...done,
    async *generate(request) {
      requests.push(request);
      if (!request.messages.some((message) => message.role === "tool"))
        for (const [index, [name, args]] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, name, args as never));
      yield providerDone();
    },
  };
}

const DEFAULT_SCOPE = (() => {
  const prepared = prepareScope("1. Ship the retry fix", { maxBytes: 4_096 });
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.scope;
})();

function harness(
  records: unknown[],
  client: ModelClient,
  wm: NonNullable<Parameters<typeof resolveMemorySystemConfig>[0]>["wm"] = {},
  entries: SessionEntry[] = [],
) {
  const data = structuredClone(records) as JsonValue[];
  const calls: string[] = [];
  const session = { id: "s", entries: async () => entries } as unknown as SessionContext;
  const log = {
    entries: () => data,
    append: async (_session: SessionContext, value: JsonValue) => {
      data.push(value);
    },
  } as unknown as SessionLog<JsonValue>;
  const config = resolveMemorySystemConfig({
    wm: { policy: "model", triggerTokens: 1, ...wm },
    rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" },
  });
  const flush = createObservationalFlush({
    log,
    config,
    readState: () => ({ enabled: true }),
    scopeFor: () => DEFAULT_SCOPE,
    clientFor: (_session, kind) => {
      calls.push(kind);
      return client;
    },
    onStatus: () => {},
  });
  return { data, session, log, config, flush, calls, ledger: () => foldObservationalMemoryLedger(data) };
}

const wmRecord = (data: readonly JsonValue[]) =>
  data.filter((value) => (value as { type?: string }).type === WM_RECORDED).at(-1) as unknown as WmRecordedData;
const toolReplies = (request: ProviderRequest) =>
  request.messages
    .filter((message) => message.role === "tool")
    .flatMap((message) => message.content)
    .map((part) => JSON.stringify(part))
    .join("\n");
const entry = (id: string, role: "user" | "assistant", text: string): SessionEntry =>
  ({
    id,
    type: "message",
    timestamp: "2026-11-12T10:00:00.000Z",
    message: { role, content: [{ type: "text", text }] },
  }) as unknown as SessionEntry;

it("protected_items_refused_for_discard", async () => {
  const requests: ProviderRequest[] = [];
  const later = { ...fact("999999999999", [LATER.id]), kind: "summary" as const, neededLater: "step 4: latency report" };
  const h = harness(
    [
      taskState(["e-task"], ["Retry cap 3 or 5?"]),
      recorded(...ALL),
      { type: WM_RECORDED, items: [fact("888888888888", [CITED.id]), later] },
    ],
    judgeClient(ALL, { discard: { finished: ALL.map((item) => item.id) } }, requests),
    {},
  );
  const ledger = h.ledger();
  assert.deepEqual(Object.fromEntries(protectedRecords(ledger, ALL)), {
    [REQUEST.id]: "task_state",
    [QUESTION.id]: "open_question",
    [ERROR.id]: "unresolved_error",
    [CITED.id]: "fact",
    [LATER.id]: "needed_later",
  });
  const result = await h.flush.flush(h.session);
  // Plan 218.2 Task 5: task-state, open-question and unresolved-error records are kept by code before the model is
  // asked; the fact and needed-later records still go to the model, whose discard is refused with `protected`.
  assert.equal(result.processed, 4);
  assert.deepEqual(Object.keys(h.ledger().tombstones ?? {}).sort(), [REQUEST.id, QUESTION.id, ERROR.id, PLAIN.id].sort());
  for (const settled of [REQUEST, QUESTION, ERROR]) assert.match(h.ledger().tombstones![settled.id]!.reason, /^wm keep [a-f0-9]{12}$/);
  const replies = toolReplies(requests[1]!);
  assert.equal((replies.match(/"reason":"protected"/g) ?? []).length, 2);
  for (const reason of ["fact", "needed_later"]) assert.match(replies, new RegExp(`"protection":"${reason}"`));
  // The prompt marks them, so the model need not guess; the refusal does not depend on the mark.
  const prompt = promptText(requests[0]!);
  const kept = prompt.split("## Already kept")[1]!.split("## New STM records")[0]!;
  assert.match(kept, new RegExp(`protected: unresolved_error: ${ERROR.description}`));
  assert.match(prompt.split("## New STM records")[1]!, new RegExp(`protected: fact: ${CITED.description}`));
  // A later outcome that passed resolves the error; one that failed does not.
  const failed = record("abababababab", "Re-ran the suite: still failed", { kind: "outcome" });
  const passed = record("cdcdcdcdcdcd", "Re-ran the suite: 35 pass", { kind: "outcome" });
  assert.equal(protectedRecords(foldObservationalMemoryLedger([recorded(ERROR, failed)]), [ERROR]).get(ERROR.id), "unresolved_error");
  assert.equal(protectedRecords(foldObservationalMemoryLedger([recorded(ERROR, failed, passed)]), [ERROR]).size, 0);
  // Rehearsal's view: facts and needed-later items are protected, a plain summary is not.
  assert.equal(isProtectedWmItem(fact("888888888888", [CITED.id])), true);
  assert.equal(isProtectedWmItem(later), true);
  assert.equal(isProtectedWmItem({ ...later, neededLater: undefined }), false);
});

it("budget_unmet_recorded_when_protected_share_exceeds_target", async () => {
  const requests: ProviderRequest[] = [];
  // Three of four records are protected errors: 30 of 40 tokens, over a 0.2 target of 8.
  const errors = ["111111111111", "222222222222", "333333333333"].map((id) => record(id, `Error ${id.slice(0, 1)}`, { kind: "error" }));
  const h = harness(
    [recorded(...errors, PLAIN)],
    // The three errors are kept by code (plan 218.2 Task 5); the model judges the plain record.
    judgeClient([...errors, PLAIN], { discard: { finished: [PLAIN.id] } }, requests),
  );
  await h.flush.flush(h.session);
  const wm = wmRecord(h.data);
  assert.deepEqual(wm.budgetUnmet, { protectedTokens: 30, targetTokens: 8 });
  assert.deepEqual(wm.compression, { processedTokens: 40, itemTokens: 30, targetTokens: 8 });
  assert.deepEqual(h.ledger().budgetUnmet, { protectedTokens: 30, targetTokens: 8 });
  // The prompt states the target as pressure after relevance, and says the protected share is over it.
  const prompt = JSON.stringify(requests[0]!.messages);
  assert.match(
    prompt,
    /## Target\\nThese records hold 40 tokens; aim for items totalling at most 8 tokens \(ratio 0.2\)\. Relevance first/,
  );
  assert.match(prompt, /Protected records alone hold 30 tokens, over the target: keep them and discard nothing more/);
  assert.match(DEFAULT_WM_INSTRUCTION, /Relevance comes first; then aim at the token target as pressure/);
  // `memory:session:status` shows it.
  const commands = createObservationalMemoryCommands({
    config: h.config,
    log: h.log,
    flush: h.flush,
    state: { get: () => ({ enabled: true }), set: () => {} },
    scope: { get: () => undefined },
    onStatus: () => {},
  } as never);
  const status = (await commands.find((command) => command.name === "memory:session:status")!.run({}, { session: h.session } as never)) as {
    budgetUnmet?: unknown;
    text: string;
    thresholds: { wmTargetRatio: number; wmPolicy: string };
  };
  assert.deepEqual(status.budgetUnmet, { protectedTokens: 30, targetTokens: 8 });
  assert.match(status.text, /WM budget unmet: protected records hold 30 tokens over a 8-token target/);
  assert.equal(status.thresholds.wmTargetRatio, 0.2);
  assert.equal(status.thresholds.wmPolicy, "model");
  // A later pass that meets its target clears it.
  const h2 = harness([recorded(PLAIN)], judgeClient([PLAIN], { discard: { finished: [PLAIN.id] } }));
  h2.data.unshift(...(h.data.filter((value) => (value as { type?: string }).type === WM_RECORDED) as JsonValue[]));
  await h2.flush.flush(h2.session);
  assert.equal(h2.ledger().budgetUnmet, undefined);
});

it("correction_survives_tight_target", async () => {
  const correction = record("c0c0c0c0c0c0", "User: no, that's the wrong file; use worker.ts", {
    kind: "statement",
    relevance: "low",
    sourceEntryIds: ["e-fix"],
  });
  const filler = ["101010101010", "202020202020", "303030303030", "404040404040"].map((id) =>
    record(id, `Read file ${id.slice(0, 2)}`, { relevance: "low" }),
  );
  const entries = [entry("e-fix", "user", "No, that's the wrong file; use worker.ts")];
  // Deterministic: a 0.05 target would discard every unprotected record, but the correction is salient and stays.
  const h = harness([recorded(correction, ...filler)], done, { policy: "deterministic", targetRatio: 0.05 }, entries);
  await h.flush.flush(h.session);
  const items = activeWmItems(h.ledger());
  assert.deepEqual(
    items.map((item) => item.citedIds[0]),
    [correction.id],
  );
  // Model policy: the prompt ranks the correction first among salient records.
  const error = record("e0e0e0e0e0e0", "Build error", { kind: "error" });
  const requests: ProviderRequest[] = [];
  const m = harness([recorded(error, correction, ...filler)], scripted([], requests), { targetRatio: 0.05 }, entries);
  await m.flush.flush(m.session);
  // The unresolved error is kept by code (plan 218.2 Task 5), so only the correction is left to rank.
  const prompt = promptText(requests[0]!);
  const first = prompt.match(/## Keep first \(salience order: correction, denial, error, failed_verification\)\n(r[0-9]+)\n/)?.[1];
  assert.ok(first, "a keep-first line with one ordinal");
  assert.match(prompt, new RegExp(`\\[${first}\\][^\\n]*: ${correction.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(prompt.split("## Already kept")[1]!, /Build error/);
  assert.deepEqual(
    salienceOrder(
      [error, correction],
      new Map([
        [error.id, ["error"]],
        [correction.id, ["correction"]],
      ]),
    ),
    [correction.id, error.id],
  );
});

it("deterministic_policy_order_and_no_model_call", async () => {
  const outcome = record("0a0a0a0a0a0a", "Ran the suite; 35 pass", { kind: "outcome", relevance: "low" });
  const lowOld = record("1b1b1b1b1b1b", "Listed files", { relevance: "low" });
  const lowNew = record("2c2c2c2c2c2c", "Listed files again", { relevance: "low" });
  const medium = record("3d3d3d3d3d3d", "Read the README", { relevance: "medium" });
  const high = record("4e4e4e4e4e4e", "Chose the backoff design", { relevance: "high" });
  const error = record("5f5f5f5f5f5f", "Type error in worker.ts", { kind: "error", relevance: "low" });
  const batch = [outcome, lowOld, lowNew, medium, high, error];
  const h = harness([recorded(...batch)], done, { policy: "deterministic", targetRatio: 0.5 });
  await h.flush.flush(h.session);
  // No model call: the flush never asked for the WM client.
  assert.ok(!h.calls.includes("wm"));
  // 60 tokens, target 30. The error is salient, so fixed; a routine (low) outcome is not (plan 218.5 Task 7): low before
  // medium before high, oldest first: outcome, lowOld, lowNew.
  const ledger = h.ledger();
  assert.deepEqual(
    Object.entries(ledger.tombstones ?? {})
      .filter(([, tomb]) => tomb.reason === "wm discard budget")
      .map(([id]) => id),
    [outcome.id, lowOld.id, lowNew.id],
  );
  assert.deepEqual(
    activeWmItems(ledger).map((item) => [item.citedIds[0], item.kind]),
    [
      [medium.id, "event"],
      [high.id, "event"],
      [error.id, "event"],
    ],
  );
  // An outcome of high relevance is still kept whatever the target.
  const shipped = record("6a6a6a6a6a6a", "Shipped the release", { kind: "outcome", relevance: "high" });
  const kept = deterministicWm({ records: [shipped, lowOld], protections: new Map(), targetRatio: 0.01 });
  assert.equal(kept.verdicts.get(shipped.id)?.verdict, "keep");
  assert.equal(kept.verdicts.get(lowOld.id)?.verdict, "discard");
  // Every record got a verdict; nothing was summarised.
  assert.equal(Object.keys(ledger.tombstones ?? {}).length, batch.length);
  assert.ok(activeWmItems(ledger).every((item) => item.kind === "event"));
  assert.deepEqual(wmRecord(h.data).compression, { processedTokens: 60, itemTokens: 30, targetTokens: 30 });
  // Protected records are kept even when the protected share alone is over the target.
  const out = deterministicWm({ records: [error, lowOld], protections: new Map([[error.id, "unresolved_error"]]), targetRatio: 0.1 });
  assert.equal(out.verdicts.get(error.id)?.verdict, "keep");
  assert.equal(out.verdicts.get(lowOld.id)?.verdict, "discard");
});

it("wm_target_ratio_is_bounded", () => {
  assert.throws(() => resolveMemorySystemConfig({ wm: { targetRatio: 0 } }), /wm.targetRatio must be a number from 0.01 to 1/);
  assert.throws(() => resolveMemorySystemConfig({ wm: { targetRatio: 1.5 } }), /wm.targetRatio/);
  assert.equal(resolveMemorySystemConfig({}).wm.targetRatio, 0.2);
  assert.equal(resolveMemorySystemConfig({}).wm.policy, "deterministic"); // plan 240 Task 4: the screen verdict (plan 218.3 Task 12)
});

it("salience_reads_fields_and_passed_outcome_with_failing_in_text_is_not_a_failure", () => {
  const userEntry = (id: string, text: string) =>
    ({
      id,
      sessionId: "s",
      kind: "message",
      timestamp: "2026-11-12T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text }] },
    }) as SessionEntry;
  const entries = [userEntry("e-fix", "Actually, can you also add a log line?"), userEntry("e-bn", "না, ভুল ফাইল")];
  // A passed outcome that says "fixed the failing test; 0 failed" is no failure once the recorder set its status.
  const passed = record("f1f1f1f1f1f1", "Fixed the failing test; 0 failed", { kind: "outcome", status: "passed" });
  // A failed check written in another language is a failure by its status alone.
  const failedJa = record("f2f2f2f2f2f2", "チェック失敗: 2件", { kind: "result", status: "failed" });
  // "actually" that corrects nothing, on a record without `corrects`: the union still reads the English pattern there.
  // `corrects: true` marks a non-English correction the pattern cannot read.
  const actually = record("f3f3f3f3f3f3", "User asked for a log line too", { kind: "request", sourceEntryIds: ["e-fix"] });
  const bengali = record("f4f4f4f4f4f4", "User: wrong file", { kind: "statement", sourceEntryIds: ["e-bn"], corrects: true });
  // An old outcome with no status keeps today's pattern reading.
  const legacy = record("f5f5f5f5f5f5", "Re-ran the suite: still failed", { kind: "outcome" });
  const signals = salienceSignals([passed, failedJa, actually, bengali, legacy], entries);
  assert.equal(signals.get(passed.id), undefined);
  assert.deepEqual(signals.get(failedJa.id), ["failed_verification"]);
  assert.deepEqual(signals.get(actually.id), ["correction"]);
  assert.deepEqual(signals.get(bengali.id), ["correction"]);
  assert.deepEqual(signals.get(legacy.id), ["failed_verification"]);
  // Protections read `status`: a passed outcome resolves an earlier error, a failed or unknown one does not, whatever
  // its text says.
  const error = record("f6f6f6f6f6f6", "bun test failed: 2 retry cases", { kind: "error" });
  const later = (status: MemoryObservation["status"], description: string) =>
    record(`${status === "passed" ? "a" : status === "failed" ? "b" : "c"}7a7a7a7a7a7`, description, { kind: "outcome", status });
  const resolvedBy = (outcome: MemoryObservation) =>
    protectedRecords(foldObservationalMemoryLedger([recorded(error, outcome)]), [error]).get(error.id);
  assert.equal(resolvedBy(later("passed", "Fixed the failing test; 0 failed")), undefined);
  assert.equal(resolvedBy(later("failed", "Suite green")), "unresolved_error");
  assert.equal(resolvedBy(later("unknown", "Changed the retry loop")), "unresolved_error");
});

// Plan 218.2 Task 3: protections follow content (the `durable` and `resolves` links the STM recorder writes).
const linkOutcome = (id: string, resolves: readonly string[], status: MemoryObservation["status"] = "passed") =>
  record(id, "Ran the suite; 35 pass", { kind: "outcome", status, resolves });
const wmPass = (processedIds: readonly string[]) => ({ type: WM_RECORDED, items: [], processedIds });

it("constraint_never_discarded_and_survives_a_new_task_state", async () => {
  const constraint = record("c1c1c1c1c1c1", "User: never touch the public API", {
    kind: "statement",
    sourceEntryIds: ["e-old"],
    attribution: "user",
    durable: "constraint",
  });
  const preference = record("c2c2c2c2c2c2", "User prefers short commit messages", {
    kind: "statement",
    sourceEntryIds: ["e-old"],
    attribution: "user",
    durable: "preference",
  });
  // A later task state written from other entries: the batch rule would no longer protect the constraint.
  const requests: ProviderRequest[] = [];
  const h = harness(
    [recorded(constraint, preference, PLAIN), taskState(["e-new"])],
    judgeClient(
      [constraint, preference, PLAIN],
      // The model tries to discard the preference and the constraint; neither has an ordinal to name.
      { keep: [{ id: PLAIN.id, reason: "listing" }], discard: { finished: [preference.id, constraint.id] } },
      requests,
    ),
  );
  assert.deepEqual(Object.fromEntries(protectedRecords(h.ledger())), { [constraint.id]: "constraint" });
  await h.flush.flush(h.session);
  // Plan 218.5 Task 3: a durable record is never in a WM batch, so the pass is not sent the constraint or the
  // preference, gives neither a verdict and tombstones neither. Both stay on the STM surface.
  assert.doesNotMatch(promptText(requests[0]!), /never touch the public API|short commit messages/);
  assert.equal((toolReplies(requests[1]!).match(/"reason":"unknown_id"/g) ?? []).length, 2);
  const ledger = h.ledger();
  assert.deepEqual(Object.keys(ledger.tombstones ?? {}), [PLAIN.id]);
  assert.deepEqual(
    activeObservations(ledger).map((kept) => kept.id),
    [constraint.id, preference.id],
  );
  assert.deepEqual(
    activeWmItems(ledger).map((made) => made.citedIds),
    [[PLAIN.id]],
  );
  // A WM event kept from a constraint (a ledger written before plan 218.5) is protected for Rehearsal; without the
  // ledger only facts and neededLater are.
  const event: MemoryWmItem = {
    id: "e1e1e1e1e1e1",
    kind: "event",
    text: constraint.description,
    relevance: "medium",
    citedIds: [constraint.id],
    tokenCount: 8,
  };
  assert.equal(isProtectedWmItem(event, ledger), true);
  assert.equal(isProtectedWmItem(event), false);
  assert.equal(isProtectedWmItem({ ...event, citedIds: [PLAIN.id] }, ledger), false);
  // A later record that supersedes it replaces it.
  const superseding = foldObservationalMemoryLedger([
    recorded(constraint),
    { type: OBSERVATIONS_DROPPED, observationIds: [constraint.id], reason: "superseded", supersededBy: "c3c3c3c3c3c3" },
  ]);
  assert.equal(protectedRecords(superseding, [constraint]).size, 0);
  assert.equal(isProtectedWmItem(event, superseding), false);
});

it("request_protected_until_resolved_by_outcome", () => {
  const request = record("a2a2a2a2a2a2", "User asked to add retry logging", {
    kind: "request",
    attribution: "user",
    sourceEntryIds: ["e-r"],
  });
  const other = record("a3a3a3a3a3a3", "User asked to rename the flag", { kind: "request", attribution: "user", sourceEntryIds: ["e-o"] });
  // No task state cites the request; an outcome naming another request turns link mode on.
  const open = foldObservationalMemoryLedger([recorded(request, other, linkOutcome("a4a4a4a4a4a4", [other.id]))]);
  assert.deepEqual(Object.fromEntries(protectedRecords(open, [request, other])), { [request.id]: "task_state" });
  // An outcome that names it resolves it, whatever its status.
  const closed = foldObservationalMemoryLedger([recorded(request, linkOutcome("a5a5a5a5a5a5", [request.id], "partial"))]);
  assert.equal(protectedRecords(closed, [request]).size, 0);
  // A resolved request is no longer protected even when the current task state was written from it.
  const withTask = foldObservationalMemoryLedger([recorded(request, linkOutcome("a5a5a5a5a5a5", [request.id])), taskState(["e-r"])]);
  assert.equal(protectedRecords(withTask, [request]).size, 0);
  // An assistant-attributed request keeps the batch rule.
  const proposal = { ...request, id: "a6a6a6a6a6a6", attribution: "assistant" as const };
  assert.equal(
    protectedRecords(foldObservationalMemoryLedger([recorded(proposal, linkOutcome("a4a4a4a4a4a4", [other.id]))]), [proposal]).size,
    0,
  );
});

it("unrelated_passed_outcome_does_not_resolve_an_error", () => {
  const error = record("b3b3b3b3b3b3", "bun test failed: 2 retry cases", { kind: "error" });
  const request = record("b4b4b4b4b4b4", "User asked to rename the flag", { kind: "request", attribution: "user" });
  const ledger = (...outcomes: MemoryObservation[]) => foldObservationalMemoryLedger([recorded(error, request, ...outcomes)]);
  // A passed outcome closing another record does not resolve the error (today's rule would: any later passed outcome).
  assert.equal(protectedRecords(ledger(linkOutcome("b5b5b5b5b5b5", [request.id])), [error]).get(error.id), "unresolved_error");
  // Named by a failed outcome it stays; named by a passed one it is resolved.
  assert.equal(protectedRecords(ledger(linkOutcome("b6b6b6b6b6b6", [error.id], "failed")), [error]).get(error.id), "unresolved_error");
  assert.equal(protectedRecords(ledger(linkOutcome("b7b7b7b7b7b7", [error.id])), [error]).size, 0);
});

it("ledger_without_resolves_keeps_the_batch_rule", () => {
  const request = record("d5d5d5d5d5d5", "User asked to ship the retry fix", {
    kind: "request",
    attribution: "user",
    sourceEntryIds: ["e-task"],
  });
  const loose = record("d6d6d6d6d6d6", "User asked about the docs", { kind: "request", attribution: "user", sourceEntryIds: ["e-docs"] });
  const error = record("d7d7d7d7d7d7", "bun test failed", { kind: "error" });
  const before = foldObservationalMemoryLedger([recorded(request, loose, error), taskState(["e-task"])]);
  assert.deepEqual(Object.fromEntries(protectedRecords(before, [request, loose, error])), {
    [request.id]: "task_state",
    [error.id]: "unresolved_error",
  });
  // Any later passed outcome resolves the error, with no link.
  const after = foldObservationalMemoryLedger([
    recorded(request, loose, error, record("d8d8d8d8d8d8", "Suite green", { kind: "outcome", status: "passed" })),
    taskState(["e-task"]),
  ]);
  assert.deepEqual(Object.fromEntries(protectedRecords(after, [request, loose, error])), { [request.id]: "task_state" });
});

it("request_protection_lapses_after_newer_user_requests_and_is_recorded", async () => {
  const request = record("e7e7e7e7e7e7", "User asked to add retry logging", { kind: "request", attribution: "user" });
  const error = record("e8e8e8e8e8e8", "Lint failed", { kind: "error" });
  const outcome = linkOutcome("e9e9e9e9e9e9", ["f0f0f0f0f0f0"]);
  const other = record("f0f0f0f0f0f0", "User asked to rename the flag", { kind: "request", attribution: "user" });
  const next = (id: string, text: string) => record(id, text, { kind: "request", attribution: "user" });
  // Plan 218.5 Task 7: the bound counts the user's newer requests (the task moved on), not WM passes, which a long
  // session runs too rarely for the protection to ever lapse.
  const history = [
    recorded(other, outcome),
    recorded(request, error),
    recorded(next("f1f1f1f1f1f1", "User asked to bump the version")),
    recorded(next("f2f2f2f2f2f2", "User asked to tag the release")),
  ];
  const ledger = foldObservationalMemoryLedger(history);
  // Under the bound both stay protected; at it, both lapse and are named.
  assert.equal(protectedRecords(ledger, [request, error], { protectRequestTasks: 3 }).size, 2);
  const lapsed: string[] = [];
  assert.equal(protectedRecords(ledger, [request, error], { protectRequestTasks: 2, onLapse: (id) => lapsed.push(id) }).size, 0);
  assert.deepEqual(lapsed, [request.id, error.id]);
  // WM passes alone never lapse it, and an assistant's request is no newer task.
  const passesOnly = foldObservationalMemoryLedger([recorded(other, outcome), recorded(request, error), wmPass([other.id]), wmPass([outcome.id])]);
  assert.equal(protectedRecords(passesOnly, [request], { protectRequestTasks: 1 }).size, 1);
  const assistantAsks = foldObservationalMemoryLedger([
    recorded(other, outcome),
    recorded(request),
    recorded(record("f3f3f3f3f3f3", "Assistant asked for the token", { kind: "request", attribution: "assistant" })),
  ]);
  assert.equal(protectedRecords(assistantAsks, [request], { protectRequestTasks: 1 }).size, 1);
  // Through the flush: the pass may discard it and records `protection_lapsed`.
  const h = harness(history, judgeClient([request], { discard: { finished: [request.id] } }), {
    protectRequestTasks: 2,
  });
  await h.flush.flush(h.session);
  assert.deepEqual(wmRecord(h.data).protectionLapsed, [request.id, error.id]);
  assert.equal(h.ledger().tombstones?.[request.id]?.reason, "wm discard finished");
  assert.equal(resolveMemorySystemConfig({}).wm.protectRequestTasks, 3);
});
