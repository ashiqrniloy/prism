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
import { activeWmItems, foldObservationalMemoryLedger } from "../ledger.js";
import { isProtectedWmItem, protectedRecords } from "../protections.js";
import {
  type MemoryObservation,
  type MemoryTaskState,
  type MemoryWmItem,
  OBSERVATIONS_RECORDED,
  TASK_STATE_RECORDED,
  WM_RECORDED,
  type WmRecordedData,
} from "../types.js";
import { DEFAULT_WM_INSTRUCTION, deterministicWm, salienceOrder } from "../workers/wm.js";

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
    wm: { triggerTokens: 1, ...wm },
    rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" },
  });
  const flush = createObservationalFlush({
    log,
    config,
    readState: () => ({ enabled: true }),
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
    scripted(
      ALL.map((item) => ["discard", { stmId: item.id, reason: "finished" }] as [string, Record<string, unknown>]),
      requests,
    ),
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
  // Only the unprotected record was discarded; each protected one got `protected` naming its class.
  assert.equal(result.processed, 1);
  assert.deepEqual(Object.keys(h.ledger().tombstones ?? {}), [PLAIN.id]);
  const replies = toolReplies(requests[1]!);
  assert.equal((replies.match(/"reason":"protected"/g) ?? []).length, 5);
  for (const reason of ["task_state", "open_question", "unresolved_error", "fact", "needed_later"])
    assert.match(replies, new RegExp(reason));
  // The prompt marks them, so the model need not guess; the refusal does not depend on the mark.
  const prompt = JSON.stringify(requests[0]!.messages);
  assert.match(prompt, new RegExp(`\\[${ERROR.id}\\][^\\n]*protected: unresolved_error`));
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
    scripted(
      [
        ...errors.map((item) => ["keep", { stmId: item.id, reason: "unresolved" }] as [string, Record<string, unknown>]),
        ["discard", { stmId: PLAIN.id, reason: "finished" }],
      ],
      requests,
    ),
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
  const h2 = harness([recorded(PLAIN)], scripted([["discard", { stmId: PLAIN.id, reason: "finished" }]]));
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
  assert.match(
    JSON.stringify(requests[0]!.messages),
    new RegExp(`## Keep first \\(salience order: correction, denial, error, failed_verification\\)\\\\n${correction.id}, ${error.id}`),
  );
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
  // 60 tokens, target 30. Outcome and error are fixed; low before medium before high, oldest first: lowOld, lowNew, medium.
  const ledger = h.ledger();
  assert.deepEqual(
    Object.entries(ledger.tombstones ?? {})
      .filter(([, tomb]) => tomb.reason === "wm discard budget")
      .map(([id]) => id),
    [lowOld.id, lowNew.id, medium.id],
  );
  assert.deepEqual(
    activeWmItems(ledger).map((item) => [item.citedIds[0], item.kind]),
    [
      [outcome.id, "event"],
      [high.id, "event"],
      [error.id, "event"],
    ],
  );
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
  assert.equal(resolveMemorySystemConfig({}).wm.policy, "model");
});
