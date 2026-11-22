/**
 * Plan 218.3 Task 8: WM looks ahead. Each model WM pass under a scope with remaining steps is offered earlier records
 * (tombstoned or dropped) that match a remaining step, selected by code with `recall { query }`'s scorer and bounded by
 * `wm.lookAheadRecords` / `wm.lookAheadTokens`; `keep` brings one back as an event for that step, recall returns its
 * original content, and the memory block lists items for the next step first.
 */
import { describe, expect, it } from "bun:test";
import {
  createSessionEntry,
  type JsonObject,
  type JsonValue,
  type ModelClient,
  providerDone,
  providerToolCall,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import {
  activeWmItems,
  foldObservationalMemoryLedger,
  OBSERVATIONS_RECORDED,
  OBSERVATIONS_TOMBSTONED,
  resolveMemorySystemConfig,
  SCOPE_STEP,
  WM_RECORDED,
} from "../../index.js";
import { observationalMemoryBlock } from "../context.js";
import { createObservationalFlush } from "../flush.js";
import { recallObservationalMemory, selectLookAheadRecords } from "../recall.js";
import { renderObservationalMemory } from "../render.js";
import { type EpisodeScope, prepareScope, remainingStepOrdinals, resolveScopeProgress, scopeHash, scopeSetRecord } from "../scope.js";
import type { MemoryObservation, MemoryWmItem } from "../types.js";
import { OBSERVATIONS_DROPPED } from "../types.js";

type ClientRequest = Parameters<ModelClient["generate"]>[0];

const userText = (request: ClientRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");

const toolResultOf = (request: ClientRequest): Record<string, unknown> | undefined => {
  const tool = [...request.messages].reverse().find((message) => message.role === "tool");
  const part = tool?.content.find((block: { type: string }) => block.type === "tool_result") as
    | { result?: Record<string, unknown> }
    | undefined;
  return part?.result;
};

const obs = (id: string, description: string, extra: Partial<MemoryObservation> = {}): MemoryObservation => ({
  id,
  kind: "result",
  description,
  timestamp: "2026-11-18T10:00:00.000Z",
  relevance: "medium",
  sourceEntryIds: [`e-${id.slice(0, 4)}`],
  tokenCount: 10,
  ...extra,
});

const scopeOf = (text: string): EpisodeScope => {
  const prepared = prepareScope(text, { maxBytes: 4_096, at: "2026-11-18T09:00:00.000Z" });
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.scope;
};

const SCOPE = scopeOf("1. Migrate the config loader\n2. Update the CLI flags\n3. Write release notes for the changelog");
const at = "2026-11-18T10:30:00.000Z";
const finished = (scope: EpisodeScope, step: number): JsonValue =>
  ({
    type: SCOPE_STEP,
    step,
    status: "finished",
    stepHash: scopeHash(resolveScopeProgress(scope).steps.find((s) => s.step === step)!.text),
    source: "command",
    at,
  }) as JsonValue;

// An earlier record about step 3's subject that WM discarded, one about nothing in the scope, and a new batch record.
const NOTES = obs("aaaaaaaaaaaa", "Drafted release notes listing the changelog entries for 0.13", { tokenCount: 40 });
const NOISE = obs("bbbbbbbbbbbb", "User asked about lunch options nearby");
const NEW = obs("cccccccccccc", "Config loader migration started in src/config.ts");

function harness(
  log: JsonValue[],
  client: ModelClient,
  options: { scope?: EpisodeScope; config?: Parameters<typeof resolveMemorySystemConfig>[0] } = {},
) {
  const reads = { entries: 0 };
  const session = {
    id: "s",
    entries: async () => {
      reads.entries += 1;
      return [] as never[];
    },
  } as never;
  const flush = createObservationalFlush({
    log: { entries: () => log, append: async (_s: unknown, value: JsonValue) => void log.push(value) } as never,
    // Re-judgment off: a `scope.set` in the log would otherwise send the discarded records as re-judged ones instead.
    config: resolveMemorySystemConfig({
      rehearsal: { targetTokens: 1_000_000 },
      ...options.config,
      wm: { policy: "model", triggerTokens: 1, rejudgeTokens: 0, ...options.config?.wm },
    }),
    readState: () => ({ enabled: true }),
    scopeFor: () => ("scope" in options ? options.scope : SCOPE),
    clientFor: () => client,
    onStatus: () => {},
  });
  return { flush, session, reads };
}

/** A WM client that records each request's prompt and answers with `answer(prompt)` once. */
function wmClient(answer: (prompt: string) => Record<string, unknown> | undefined) {
  const prompts: string[] = [];
  const results: Record<string, unknown>[] = [];
  const client: ModelClient = {
    model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
    async *generate(request) {
      if (request.messages.some((message) => message.role === "tool")) {
        const result = toolResultOf(request);
        if (result) results.push(result);
        yield providerDone();
        return;
      }
      const prompt = userText(request);
      prompts.push(prompt);
      const args = answer(prompt);
      if (args) yield providerToolCall(toolCallContent(`c${prompts.length}`, "judge", args as JsonObject));
      yield providerDone();
    },
  };
  return { client, prompts, results };
}

const discarded = (...records: MemoryObservation[]): JsonValue[] =>
  [
    { type: OBSERVATIONS_RECORDED, observations: records },
    { type: OBSERVATIONS_TOMBSTONED, observationIds: records.map((r) => r.id), reason: "wm discard out-of-scope", at },
  ] as unknown as JsonValue[];

const section = (prompt: string) => prompt.split("## Earlier records for coming steps")[1];

describe("WM look-ahead (plan 218.3 Task 8)", () => {
  it("lookahead_offers_earlier_records_matching_coming_steps", async () => {
    const log: JsonValue[] = [
      scopeSetRecord(SCOPE) as unknown as JsonValue,
      ...discarded(NOTES, NOISE),
      finished(SCOPE, 1),
      { type: OBSERVATIONS_RECORDED, observations: [NEW] } as unknown as JsonValue,
    ];
    const wm = wmClient(() => ({ keep: [{ r: 1, reason: "current step" }] }));
    const h = harness(log, wm.client);
    await h.flush.flush(h.session);
    expect(wm.prompts).toHaveLength(1);
    const offered = section(wm.prompts[0]!);
    expect(offered).toBeDefined();
    // Step 1 is finished, step 2 is next: the discarded record naming step 3's subject is offered with its step.
    expect(offered).toContain(`[a1] step 3:`);
    expect(offered).toContain(NOTES.description);
    expect(offered).not.toContain(NOISE.description);
    // The batch record is judged as usual, never offered twice.
    expect(offered).not.toContain(NEW.description);
    const record = log.find((entry) => (entry as { type?: string }).type === WM_RECORDED) as { lookAhead?: unknown };
    expect(record.lookAhead).toEqual({ offered: 1, tokens: NOTES.tokenCount, kept: [] });
    // The record is offered from the ledger alone: the flush reads the branch once, as before.
    expect(h.reads.entries).toBe(1);
  });

  it("lookahead_keep_restores_the_record_with_its_step", async () => {
    const dropped = obs("dddddddddddd", "Release notes must credit the changelog contributors", { kind: "statement" });
    const log: JsonValue[] = [
      ...discarded(NOTES),
      { type: OBSERVATIONS_RECORDED, observations: [dropped] } as unknown as JsonValue,
      { type: OBSERVATIONS_DROPPED, observationIds: [dropped.id] } as unknown as JsonValue,
      { type: OBSERVATIONS_RECORDED, observations: [NEW] } as unknown as JsonValue,
    ];
    const wm = wmClient((prompt) => {
      const notes = /^- \[(a[0-9]+)\] step 3: .*Drafted release notes/m.exec(prompt)![1]!;
      const credit = /^- \[(a[0-9]+)\] step 3: .*credit the changelog/m.exec(prompt)![1]!;
      return {
        // The model names another step; the kept event is for the step code matched.
        keep: [
          { a: Number(notes.slice(1)), reason: "step 3 reuses the draft", neededLater: "step 9" },
          { r: 1, reason: "current step" },
        ],
        // No other verdict applies to a look-ahead record.
        discard: { "out-of-scope": [credit] },
        summaries: [{ of: [credit], text: "credit", relevance: "low" }],
      };
    });
    const h = harness(log, wm.client);
    await h.flush.flush(h.session);
    expect(wm.results[0]?.refused).toEqual([
      { entry: "summaries[0]", reason: "unknown_id" },
      { entry: "discard.out-of-scope[0]", reason: "unknown_id", ordinal: expect.stringMatching(/^a[0-9]$/) },
    ]);
    const ledger = foldObservationalMemoryLedger(log);
    const item = activeWmItems(ledger).find((candidate) => candidate.citedIds[0] === NOTES.id)!;
    expect(item).toMatchObject({ kind: "event", neededLater: "step 3", text: NOTES.description });
    // The record stays tombstoned (it was already off the surface) and the dropped one stays dropped.
    expect(ledger.tombstones?.[NOTES.id]?.reason).toBe("wm discard out-of-scope");
    expect(ledger.droppedObservationIds).toContain(dropped.id);
    const record = log.find((entry) => (entry as { type?: string }).type === WM_RECORDED) as { lookAhead?: unknown };
    expect(record.lookAhead).toEqual({ offered: 2, tokens: NOTES.tokenCount + dropped.tokenCount, kept: [NOTES.id] });

    // The kept event cites the record, so recall returns its original source entry.
    const entries: SessionEntry[] = [
      createSessionEntry({
        id: NOTES.sourceEntryIds[0]!,
        sessionId: "s",
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "ORIGINAL: the release notes draft, verbatim" }] } as never,
      }),
    ];
    const recalled = recallObservationalMemory(entries, item.id, [], { ledger });
    expect(recalled.found).toBe(true);
    expect(recalled.text).toContain("ORIGINAL: the release notes draft, verbatim");

    // Once step 3 finishes, the item is released like any neededLater item: the next pass offers it under finished steps.
    const progress = resolveScopeProgress(SCOPE, foldObservationalMemoryLedger([...log, finished(SCOPE, 3)]).scopeSteps);
    expect(progress.finished.map((step) => step.step)).toEqual([3]);
  });

  it("lookahead_respects_the_budget", async () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      obs(index.toString(16).padStart(12, "e"), `Release notes item ${index} for the changelog`, { tokenCount: 400 }),
    );
    const ledger = foldObservationalMemoryLedger(discarded(...many));
    const remaining = resolveScopeProgress(SCOPE).remaining;
    // Default bound (decision 5): 12 records and 3,000 tokens; 400-token records stop at 7.
    const config = resolveMemorySystemConfig({});
    expect([config.wm.lookAheadRecords, config.wm.lookAheadTokens]).toEqual([12, 3_000]);
    const chosen = selectLookAheadRecords(ledger, remaining, {
      maxRecords: config.wm.lookAheadRecords,
      maxTokens: config.wm.lookAheadTokens,
    });
    expect(chosen).toHaveLength(7);
    expect(chosen.reduce((sum, candidate) => sum + candidate.record.tokenCount, 0)).toBeLessThanOrEqual(3_000);
    expect(chosen.every((candidate) => candidate.step === 3 && candidate.state === "tombstoned")).toBe(true);
    // Small records stop at the record cap; newer first at equal coverage.
    const small = many.map((record) => ({ ...record, tokenCount: 10 }));
    const capped = selectLookAheadRecords(foldObservationalMemoryLedger(discarded(...small)), remaining, {
      maxRecords: 12,
      maxTokens: 3_000,
    });
    expect(capped).toHaveLength(12);
    expect(capped[0]!.record.id).toBe(small.at(-1)!.id);
    // 0 turns it off.
    expect(selectLookAheadRecords(ledger, remaining, { maxRecords: 0, maxTokens: 3_000 })).toEqual([]);

    // Through a pass: the request carries at most the bound, recorded on the pass.
    const log: JsonValue[] = [...discarded(...many), { type: OBSERVATIONS_RECORDED, observations: [NEW] } as unknown as JsonValue];
    const wm = wmClient(() => ({ keep: [{ r: 1, reason: "current step" }] }));
    const h = harness(log, wm.client, { config: { wm: { policy: "model", triggerTokens: 1, lookAheadRecords: 3 } } });
    await h.flush.flush(h.session);
    expect([...section(wm.prompts[0]!)!.matchAll(/^- \[a[0-9]+\]/gm)]).toHaveLength(3);
    const record = log.find((entry) => (entry as { type?: string }).type === WM_RECORDED) as { lookAhead?: unknown };
    expect(record.lookAhead).toEqual({ offered: 3, tokens: 1_200, kept: [] });
  });

  it("memory_block_orders_items_by_the_next_step", () => {
    const item = (id: string, kind: MemoryWmItem["kind"], text: string, neededLater?: string): MemoryWmItem => ({
      id,
      kind,
      text,
      relevance: "medium",
      citedIds: ["ffffffffffff"],
      tokenCount: 5,
      ...(neededLater ? { neededLater } : {}),
    });
    const items = [
      item("111111111111", "fact", "general fact"),
      item("222222222222", "event", "for step three", "step 3"),
      item("333333333333", "event", "for step two", "step 2"),
      item("444444444444", "summary", "for finished step one", "step 1"),
      item("555555555555", "fact", "for steps two and three", "steps 2, 3"),
    ];
    const order = (text: string) => [...text.matchAll(/^- \[([0-9]{12})\]/gm)].map((match) => match[1]);
    // Step 1 finished, step 2 next: step 2's items (fact before event), then step 3's, then the rest by kind.
    const ledger = foldObservationalMemoryLedger([scopeSetRecord(SCOPE) as unknown as JsonValue, finished(SCOPE, 1)]);
    expect(remainingStepOrdinals(ledger)).toEqual([2, 3]);
    expect(order(renderObservationalMemory(items, [], { remainingSteps: remainingStepOrdinals(ledger) }))).toEqual([
      "555555555555",
      "333333333333",
      "222222222222",
      "111111111111",
      "444444444444",
    ]);
    // No scope: today's order, facts then summaries then events.
    expect(order(renderObservationalMemory(items, []))).toEqual([
      "111111111111",
      "555555555555",
      "444444444444",
      "222222222222",
      "333333333333",
    ]);
    // A checked scope line is finished; a clear removes the order; a config scope applies before any scope.set.
    const checked = scopeOf("- [x] Migrate the config loader\n- [ ] Update the CLI flags\n- [ ] Write release notes");
    expect(remainingStepOrdinals(foldObservationalMemoryLedger([scopeSetRecord(checked) as unknown as JsonValue]))).toEqual([2, 3]);
    expect(remainingStepOrdinals(foldObservationalMemoryLedger([scopeSetRecord(SCOPE), scopeSetRecord(undefined)] as never))).toEqual([]);
    expect(remainingStepOrdinals(foldObservationalMemoryLedger([]), checked)).toEqual([2, 3]);
    expect(remainingStepOrdinals(foldObservationalMemoryLedger([scopeSetRecord(undefined)] as never), checked)).toEqual([]);

    // The pinned block renders from its ledger snapshot: the order is the snapshot's, so it changes only at a compaction.
    const withItems = foldObservationalMemoryLedger([
      scopeSetRecord(SCOPE) as unknown as JsonValue,
      finished(SCOPE, 1),
      { type: WM_RECORDED, items } as unknown as JsonValue,
    ]);
    expect(order(String(observationalMemoryBlock(withItems)[0]!.content))).toEqual([
      "555555555555",
      "333333333333",
      "222222222222",
      "111111111111",
      "444444444444",
    ]);
  });

  it("no_remaining_steps_no_lookahead", async () => {
    const run = async (scope: EpisodeScope | undefined, extra: JsonValue[] = []) => {
      const log: JsonValue[] = [
        ...(scope ? [scopeSetRecord(scope) as unknown as JsonValue] : []),
        ...discarded(NOTES),
        ...extra,
        { type: OBSERVATIONS_RECORDED, observations: [NEW] } as unknown as JsonValue,
      ];
      const wm = wmClient(() => ({ keep: [{ r: 1, reason: "current step" }] }));
      const h = harness(log, wm.client, { scope });
      await h.flush.flush(h.session);
      const record = log.find((entry) => (entry as { type?: string }).type === WM_RECORDED) as { lookAhead?: unknown } | undefined;
      return { prompts: wm.prompts, record };
    };
    // Every step finished: the pass runs with no look-ahead section and no lookAhead record.
    const done = await run(SCOPE, [finished(SCOPE, 1), finished(SCOPE, 2), finished(SCOPE, 3)]);
    expect(done.prompts).toHaveLength(1);
    expect(section(done.prompts[0]!)).toBeUndefined();
    expect(done.record?.lookAhead).toBeUndefined();
    // The same request as a pass with look-ahead off: it costs what it did before.
    const off = await (async () => {
      const log: JsonValue[] = [
        scopeSetRecord(SCOPE) as unknown as JsonValue,
        ...discarded(NOTES),
        finished(SCOPE, 1),
        finished(SCOPE, 2),
        finished(SCOPE, 3),
        { type: OBSERVATIONS_RECORDED, observations: [NEW] } as unknown as JsonValue,
      ];
      const wm = wmClient(() => ({ keep: [{ r: 1, reason: "current step" }] }));
      const h = harness(log, wm.client, { config: { wm: { policy: "model", triggerTokens: 1, lookAheadRecords: 0 } } });
      await h.flush.flush(h.session);
      return wm.prompts;
    })();
    expect(done.prompts).toEqual(off);
    // No scope: no WM pass at all (Task 1 decision 4).
    const none = await run(undefined);
    expect(none.prompts).toHaveLength(0);
  });
});
