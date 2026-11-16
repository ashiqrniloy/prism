/**
 * Plan 218.2 Task 1: the worker replay scorer. Every property is a mechanical match against an annotation; no judge.
 *
 * A request row carries ids, counts and token totals only (the bench `noTextRule`). Aggregates are rates over the rows
 * of a group (`all`, `english`, `non-english` for STM; `all`, `base`, `long-scope` for WM). The decision rules of Tasks 2,
 * 4, 5 and 6 read these aggregates and are fixed in the gate record before the baseline runs (`REPLAY_RULES`).
 */
import { normalizeEventText } from "../../../packages/memory/system/src/session/normalize.ts";
import { salienceSignals } from "../../../packages/memory/system/src/session/salience.ts";
import { NON_ENGLISH_SETS } from "./build.mjs";

/** The structured fields plan 218.2 Task 2 adds to `record_event`; a field reads `null` while the schema lacks it. */
export const STM_FIELDS = Object.freeze(["status", "corrects", "durable", "resolves"]);

const cites = (event, entries) => event.sourceEntryIds.some((id) => entries.includes(id));
const sumBy = (rows, pick) => rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
const rate = (num, den) => (den > 0 ? num / den : null);
const addCounts = (into, from) => {
  for (const [key, value] of Object.entries(from ?? {})) into[key] = (into[key] ?? 0) + value;
  return into;
};

/**
 * One signal read two ways over the same events. `flag(event)` says the reading marks it; an annotated item is found when
 * a flagged event cites one of its entries; a flagged event that cites no annotated item's entry is a false positive.
 */
function signalCounts(events, items, flag) {
  const flagged = events.filter(flag);
  const itemEntries = items.flatMap((item) => item.entries);
  return {
    found: items.filter((item) => flagged.some((event) => cites(event, item.entries))).length,
    tp: flagged.filter((event) => cites(event, itemEntries)).length,
    fp: flagged.filter((event) => !cites(event, itemEntries)).length,
  };
}

/**
 * Score one STM request. `events` are what `runStm` returned; `chunks` the accepted chunks by event id (`onChunks`);
 * `schema` the `record_event` argument names the worker was offered; `run` the call's own counters.
 */
export function scoreStmRequest({ request, annotation, events, chunks = new Map(), schema = new Set(), run }) {
  // The pattern reading: the product's salience over the events with the Task 2 fields stripped, so it stays the
  // English patterns alone while the product reads the fields first.
  const signals = salienceSignals(
    events.map(({ status: _s, corrects: _c, durable: _d, resolves: _r, ...rest }) => rest),
    request.entries,
  );
  const has = (field) => schema.has(field);
  const failedItems = [...annotation.checks, ...annotation.outcomes].filter((item) => item.status === "failed");
  const correctionItems = annotation.corrections.map((item) => ({ entries: [item.entry] }));
  const durableItems = annotation.durable.map((item) => ({ entries: [item.entry], kind: item.kind }));
  const pattern = (signal) => (event) => (signals.get(event.id) ?? []).includes(signal);
  const links = annotation.outcomes.flatMap((outcome) => outcome.resolves.map((id) => ({ entries: outcome.entries, id })));
  const chunkTexts = [...chunks.values()].flat().map((chunk) => normalizeEventText(chunk.text));
  const resolvesField = has("resolves")
    ? (() => {
        let tp = 0;
        let fp = 0;
        for (const event of events)
          for (const id of Array.isArray(event.resolves) ? event.resolves : [])
            if (links.some((link) => link.id === id && cites(event, link.entries))) tp += 1;
            else fp += 1;
        const found = links.filter((link) =>
          events.some((event) => event.resolves?.includes(link.id) && cites(event, link.entries)),
        ).length;
        return { found, tp, fp };
      })()
    : null;
  return {
    id: request.id,
    set: request.set,
    sourceTokens: run.sourceTokens,
    events: events.length,
    turns: run.turns,
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    cacheReadTokens: run.usage.cacheReadTokens,
    refused: { ...run.refused },
    failed: run.failed ?? null,
    chunks: chunkTexts.length,
    chunkBytes: [...chunks.values()].flat().reduce((sum, chunk) => sum + chunk.bytes, 0),
    outcomes: {
      annotated: annotation.outcomes.length,
      found: annotation.outcomes.filter((item) =>
        events.some((event) => (event.kind === "outcome" || event.kind === "result") && cites(event, item.entries)),
      ).length,
    },
    correction: {
      annotated: correctionItems.length,
      pattern: signalCounts(events, correctionItems, pattern("correction")),
      field: has("corrects") ? signalCounts(events, correctionItems, (event) => event.corrects === true) : null,
    },
    failure: {
      annotated: failedItems.length,
      // Both readings count an `error` event; they differ on how an outcome or result says its check failed.
      pattern: signalCounts(events, failedItems, (event) => event.kind === "error" || pattern("failed_verification")(event)),
      field: has("status") ? signalCounts(events, failedItems, (event) => event.kind === "error" || event.status === "failed") : null,
    },
    durable: {
      annotated: durableItems.length,
      recorded: durableItems.filter((item) => events.some((event) => cites(event, item.entries))).length,
      field: has("durable")
        ? signalCounts(events, durableItems, (event) => event.durable === "constraint" || event.durable === "preference")
        : null,
    },
    resolves: { annotated: links.length, field: resolvesField },
    evidence: {
      annotated: annotation.evidence.length,
      covered: annotation.evidence.filter((span) => chunkTexts.some((text) => text.includes(normalizeEventText(span.text)))).length,
    },
  };
}

/** Score one WM request from `runWm`'s output. A record kept in an item (`keep` or `summarize`) is kept. */
export function scoreWmRequest({ request, annotation, output, run }) {
  const tokens = new Map(request.records.map((record) => [record.id, record.tokenCount]));
  const verdicts = output ? [...output.verdicts].filter(([id]) => tokens.has(id)) : [];
  const verdictOf = new Map(verdicts.map(([id, verdict]) => [id, verdict.verdict]));
  const items = output?.items ?? [];
  const kept = (id) => ["keep", "summarize"].includes(verdictOf.get(id));
  const count = (verdict) => verdicts.filter(([, value]) => value.verdict === verdict).length;
  return {
    id: request.id,
    set: request.set,
    records: request.records.length,
    recordTokens: request.records.reduce((sum, record) => sum + record.tokenCount, 0),
    verdicts: verdicts.length,
    keep: count("keep"),
    summarize: count("summarize"),
    discard: count("discard"),
    facts: items.filter((item) => item.kind === "fact").length,
    turns: run.turns,
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    cacheReadTokens: run.usage.cacheReadTokens,
    refused: { ...run.refused },
    failed: run.failed ?? null,
    capStop: output?.endedAtOutputCap === true ? 1 : 0,
    laterStep: {
      annotated: annotation.laterStep.length,
      kept: annotation.laterStep.filter(kept).length,
      discarded: annotation.laterStep.filter((id) => verdictOf.get(id) === "discard").length,
    },
    changedValues: {
      annotated: annotation.changedValues.length,
      kept: annotation.changedValues.filter(({ record, mustInclude }) =>
        items.some((item) => item.citedIds.includes(record) && mustInclude.every((value) => item.text.includes(value))),
      ).length,
    },
    durable: { annotated: annotation.durable.length, discarded: annotation.durable.filter((id) => verdictOf.get(id) === "discard").length },
    finished: {
      annotated: annotation.finished.length,
      discarded: annotation.finished.filter((id) => verdictOf.get(id) === "discard").length,
    },
    processedTokens: verdicts.reduce((sum, [id]) => sum + tokens.get(id), 0),
    itemTokens: items.reduce((sum, item) => sum + item.tokenCount, 0),
  };
}

const groupSignal = (rows, key) => {
  const annotated = sumBy(rows, (row) => row[key].annotated);
  const reading = (name) => {
    if (rows.some((row) => row[key][name] === null)) return null;
    const found = sumBy(rows, (row) => row[key][name].found);
    const tp = sumBy(rows, (row) => row[key][name].tp);
    const fp = sumBy(rows, (row) => row[key][name].fp);
    return { found, tp, fp, recall: rate(found, annotated), precision: rate(tp, tp + fp) };
  };
  return { annotated, pattern: reading("pattern"), field: reading("field") };
};

/** STM aggregates over `rows`. */
export function aggregateStm(rows) {
  const ok = rows.filter((row) => !row.failed);
  const events = sumBy(ok, (row) => row.events);
  const sourceTokens = sumBy(ok, (row) => row.sourceTokens);
  const outputTokens = sumBy(ok, (row) => row.outputTokens);
  const chunkBytes = sumBy(ok, (row) => row.chunkBytes);
  const durableAnnotated = sumBy(ok, (row) => row.durable.annotated);
  const resolvesAnnotated = sumBy(ok, (row) => row.resolves.annotated);
  const resolvesField = ok.some((row) => row.resolves.field === null)
    ? null
    : (() => {
        const found = sumBy(ok, (row) => row.resolves.field.found);
        const tp = sumBy(ok, (row) => row.resolves.field.tp);
        const fp = sumBy(ok, (row) => row.resolves.field.fp);
        return { found, tp, fp, recall: rate(found, resolvesAnnotated), precision: rate(tp, tp + fp) };
      })();
  const durableField = ok.some((row) => row.durable.field === null)
    ? null
    : (() => {
        const found = sumBy(ok, (row) => row.durable.field.found);
        const tp = sumBy(ok, (row) => row.durable.field.tp);
        const fp = sumBy(ok, (row) => row.durable.field.fp);
        return { found, tp, fp, recall: rate(found, durableAnnotated), precision: rate(tp, tp + fp) };
      })();
  return {
    requests: rows.length,
    failedRequests: rows.length - ok.length,
    events,
    sourceTokens,
    eventsPer10kSourceTokens: rate(events * 10_000, sourceTokens),
    outputTokens,
    outputTokensPerEvent: rate(outputTokens, events),
    inputTokens: sumBy(ok, (row) => row.inputTokens),
    turns: sumBy(ok, (row) => row.turns),
    refused: rows.reduce((into, row) => addCounts(into, row.refused), {}),
    outcomes: { annotated: sumBy(ok, (row) => row.outcomes.annotated), found: sumBy(ok, (row) => row.outcomes.found) },
    correction: groupSignal(ok, "correction"),
    failure: groupSignal(ok, "failure"),
    durable: { annotated: durableAnnotated, recorded: sumBy(ok, (row) => row.durable.recorded), field: durableField },
    resolves: { annotated: resolvesAnnotated, field: resolvesField },
    evidence: {
      annotated: sumBy(ok, (row) => row.evidence.annotated),
      covered: sumBy(ok, (row) => row.evidence.covered),
      coverage: rate(
        sumBy(ok, (row) => row.evidence.covered),
        sumBy(ok, (row) => row.evidence.annotated),
      ),
    },
    chunks: sumBy(ok, (row) => row.chunks),
    chunkBytes,
    chunkBytesPer10kSourceTokens: rate(chunkBytes * 10_000, sourceTokens),
  };
}

/** WM aggregates over `rows`. */
export function aggregateWm(rows) {
  const ok = rows.filter((row) => !row.failed);
  const records = sumBy(ok, (row) => row.records);
  const share = (key, part) =>
    rate(
      sumBy(ok, (row) => row[key][part]),
      sumBy(ok, (row) => row[key].annotated),
    );
  return {
    requests: rows.length,
    failedRequests: rows.length - ok.length,
    records,
    verdicts: sumBy(ok, (row) => row.verdicts),
    verdictShare: rate(
      sumBy(ok, (row) => row.verdicts),
      records,
    ),
    keep: sumBy(ok, (row) => row.keep),
    summarize: sumBy(ok, (row) => row.summarize),
    discard: sumBy(ok, (row) => row.discard),
    facts: sumBy(ok, (row) => row.facts),
    refused: rows.reduce((into, row) => addCounts(into, row.refused), {}),
    turns: sumBy(ok, (row) => row.turns),
    turnsPerRecord: rate(
      sumBy(ok, (row) => row.turns),
      records,
    ),
    inputTokens: sumBy(ok, (row) => row.inputTokens),
    outputTokens: sumBy(ok, (row) => row.outputTokens),
    outputTokensPerRecord: rate(
      sumBy(ok, (row) => row.outputTokens),
      records,
    ),
    capStops: sumBy(ok, (row) => row.capStop),
    laterStep: {
      annotated: sumBy(ok, (row) => row.laterStep.annotated),
      kept: sumBy(ok, (row) => row.laterStep.kept),
      discarded: sumBy(ok, (row) => row.laterStep.discarded),
      keptShare: share("laterStep", "kept"),
    },
    changedValues: {
      annotated: sumBy(ok, (row) => row.changedValues.annotated),
      kept: sumBy(ok, (row) => row.changedValues.kept),
      keptShare: share("changedValues", "kept"),
    },
    durableDiscarded: sumBy(ok, (row) => row.durable.discarded),
    durableAnnotated: sumBy(ok, (row) => row.durable.annotated),
    finished: {
      annotated: sumBy(ok, (row) => row.finished.annotated),
      discarded: sumBy(ok, (row) => row.finished.discarded),
      discardedShare: share("finished", "discarded"),
    },
    achievedRatio: rate(
      sumBy(ok, (row) => row.itemTokens),
      sumBy(ok, (row) => row.processedTokens),
    ),
  };
}

/** STM groups: all, english (base and the English hard cases), non-english (bn, ja, es), and each set. */
export function stmGroups(rows) {
  const sets = [...new Set(rows.map((row) => row.set))];
  return {
    all: aggregateStm(rows),
    english: aggregateStm(rows.filter((row) => !NON_ENGLISH_SETS.includes(row.set))),
    "non-english": aggregateStm(rows.filter((row) => NON_ENGLISH_SETS.includes(row.set))),
    sets: Object.fromEntries(sets.map((set) => [set, aggregateStm(rows.filter((row) => row.set === set))])),
  };
}

export function wmGroups(rows) {
  return {
    all: aggregateWm(rows),
    base: aggregateWm(rows.filter((row) => row.set === "base")),
    "long-scope": aggregateWm(rows.filter((row) => row.set === "long-scope")),
  };
}

/**
 * The decision rules of Tasks 2, 4, 5 and 6, fixed before the baseline (the gate record carries this object and its
 * hash). `text` is the plan's wording; the evaluator below reads the thresholds.
 */
export const REPLAY_RULES = Object.freeze({
  task2: {
    text: "The English patterns (CORRECTION, FAILED_VERIFICATION, FAILED_OUTCOME) are removed, with no alias, if on every worker model, for both the correction and the failure signal, the fields' recall is at least the patterns' on the English cases and higher on the non-English cases, with precision (all cases) no lower; otherwise they are kept as a union with the fields for records that carry no field. Output tokens per event may rise by at most 15% against the baseline; a larger rise goes to the owner with the counts.",
    signals: ["correction", "failure"],
    maxOutputTokensPerEventRise: 0.15,
  },
  task4: {
    text: "The automatic evidence chunk ships on by default if, on every worker model, annotated-evidence coverage rises against the baseline and chunk store bytes per 10k source tokens stay under 2x the baseline; otherwise it ships off and the counts go to the owner.",
    maxChunkBytesFactor: 2,
  },
  task5: {
    text: "judge replaces keep, summarize, derive and discard if, on every worker model, the share of records given a verdict is no lower, annotated later-step records kept and changed values kept are no lower, and output tokens per record fall by at least 30% or refused calls fall. Otherwise judge is deleted and the settled-first step ships alone when it passes the first two conditions.",
    minOutputTokensPerRecordFall: 0.3,
  },
  task6: {
    text: "wm.scopeDigest defaults on only if, on the long-scope set, annotated later-step records kept rise on at least one worker model and fall on none; otherwise its code is deleted and the counts recorded.",
  },
});

const refusedTotal = (refused) => Object.values(refused ?? {}).reduce((sum, n) => sum + n, 0);
const atLeast = (a, b) => a !== null && b !== null && a >= b;

/** Task 2: fields against patterns inside one report (the candidate product). */
export function decideTask2(candidate, baseline, rules = REPLAY_RULES.task2) {
  const perModel = {};
  for (const [model, report] of Object.entries(candidate.models)) {
    const stm = report.stm;
    const checks = rules.signals.map((signal) => {
      const en = stm.english[signal];
      const non = stm["non-english"][signal];
      const all = stm.all[signal];
      const fieldsRead = en.field && non.field && all.field;
      return {
        signal,
        englishRecall: fieldsRead ? atLeast(en.field.recall, en.pattern.recall) : false,
        nonEnglishRecall: fieldsRead
          ? non.field.recall !== null && non.pattern.recall !== null && non.field.recall > non.pattern.recall
          : false,
        precision: fieldsRead ? atLeast(all.field.precision ?? 1, all.pattern.precision ?? 1) : false,
      };
    });
    const before = baseline?.models?.[model]?.stm.all.outputTokensPerEvent ?? null;
    const after = stm.all.outputTokensPerEvent;
    const rise = before && after !== null ? (after - before) / before : null;
    perModel[model] = {
      checks,
      pass: checks.every((check) => check.englishRecall && check.nonEnglishRecall && check.precision),
      outputTokensPerEventRise: rise,
      toOwner: rise !== null && rise > rules.maxOutputTokensPerEventRise,
    };
  }
  const models = Object.values(perModel);
  return { removePatterns: models.length > 0 && models.every((row) => row.pass), toOwner: models.some((row) => row.toOwner), perModel };
}

/** Task 4: the automatic chunk rule against the baseline. */
export function decideTask4(candidate, baseline, rules = REPLAY_RULES.task4) {
  const perModel = {};
  for (const [model, report] of Object.entries(candidate.models)) {
    const before = baseline.models[model]?.stm.all;
    const after = report.stm.all;
    perModel[model] = {
      coverageRises: before ? after.evidence.coverage > before.evidence.coverage : false,
      chunkBytesUnderFactor: before
        ? after.chunkBytesPer10kSourceTokens < rules.maxChunkBytesFactor * before.chunkBytesPer10kSourceTokens
        : false,
    };
  }
  const models = Object.values(perModel);
  return { defaultOn: models.length > 0 && models.every((row) => row.coverageRises && row.chunkBytesUnderFactor), perModel };
}

/** Task 5: `judge` (candidate) against the incumbent four tools (baseline), over every WM request. */
export function decideTask5(candidate, incumbent, rules = REPLAY_RULES.task5) {
  const perModel = {};
  for (const [model, report] of Object.entries(candidate.models)) {
    const before = incumbent.models[model]?.wm.all;
    const after = report.wm.all;
    if (!before) {
      perModel[model] = { verdictShare: false, kept: false, cheaper: false };
      continue;
    }
    const fall = before.outputTokensPerRecord
      ? (before.outputTokensPerRecord - after.outputTokensPerRecord) / before.outputTokensPerRecord
      : null;
    perModel[model] = {
      verdictShare: atLeast(after.verdictShare, before.verdictShare),
      kept:
        atLeast(after.laterStep.keptShare, before.laterStep.keptShare) &&
        atLeast(after.changedValues.keptShare, before.changedValues.keptShare),
      cheaper: (fall !== null && fall >= rules.minOutputTokensPerRecordFall) || refusedTotal(after.refused) < refusedTotal(before.refused),
      outputTokensPerRecordFall: fall,
    };
  }
  const models = Object.values(perModel);
  const quality = models.length > 0 && models.every((row) => row.verdictShare && row.kept);
  return { judgeWins: quality && models.every((row) => row.cheaper), settledFirstPasses: quality, perModel };
}

/** Task 6: the scope digest on the long-scope set. */
export function decideTask6(candidate, baseline) {
  const perModel = {};
  for (const [model, report] of Object.entries(candidate.models)) {
    const before = baseline.models[model]?.wm["long-scope"].laterStep.keptShare ?? null;
    const after = report.wm["long-scope"].laterStep.keptShare;
    perModel[model] = { before, after, rises: before !== null && after > before, falls: before !== null && after < before };
  }
  const models = Object.values(perModel);
  return { defaultOn: models.some((row) => row.rises) && !models.some((row) => row.falls), perModel };
}

/** The paired reading (plan 218.2 Task 9): each path is read from both reports, per model. */
const PAIRED_STM = [
  "eventsPer10kSourceTokens",
  "outputTokensPerEvent",
  "outputTokensPer10kSourceTokens",
  "outcomes.found",
  "durable.recorded",
  "evidence.covered",
  "evidence.coverage",
  "chunkBytesPer10kSourceTokens",
];
const PAIRED_STM_SIGNALS = ["recall", "precision"];
const PAIRED_WM = [
  "verdictShare",
  "laterStep.kept",
  "laterStep.discarded",
  "changedValues.kept",
  "durableDiscarded",
  "finished.discardedShare",
  "outputTokensPerRecord",
  "turns",
  "capStops",
  "refusedTotal",
  "achievedRatio",
];
const at = (value, path) => path.split(".").reduce((node, key) => (node == null ? null : node[key]), value) ?? null;
const pair = (before, after) => ({
  before,
  after,
  delta: typeof before === "number" && typeof after === "number" ? Math.round((after - before) * 1e6) / 1e6 : null,
});
const withDerived = (stm) => ({ ...stm, outputTokensPer10kSourceTokens: rate(stm.outputTokens * 10_000, stm.sourceTokens) });
const wmDerived = (wm) => ({ ...wm, refusedTotal: refusedTotal(wm.refused) });

/**
 * Task 9: the after-replay paired with the baseline. Both runs must read the same fixture, the same models and the same
 * rules; anything else is refused. Returns both product hashes and, per model, `{ before, after, delta }` for the STM
 * (all, English, non-English) and WM (all, base, long-scope) rows and the run's usage.
 */
export function pairReplays(after, baseline) {
  if (after.fixture?.indexSha256 !== baseline.fixture?.indexSha256)
    throw new Error("WorkerReplay: the after-replay and the baseline read different fixtures");
  const models = Object.keys(after.models);
  const baseModels = Object.keys(baseline.models);
  if (models.length !== baseModels.length || models.some((model) => !baseModels.includes(model)))
    throw new Error("WorkerReplay: the after-replay and the baseline ran different models");
  if (after.rulesHash !== baseline.rulesHash) throw new Error("WorkerReplay: the after-replay and the baseline ran under different rules");
  if (after.only || baseline.only || after.set || baseline.set) throw new Error("WorkerReplay: a paired run reads both tiers in full");
  const perModel = {};
  for (const model of models) {
    const a = after.models[model];
    const b = baseline.models[model];
    const stm = {};
    for (const group of ["all", "english", "non-english"]) {
      const sa = withDerived(a.stm[group]);
      const sb = withDerived(b.stm[group]);
      stm[group] = Object.fromEntries(PAIRED_STM.map((path) => [path, pair(at(sb, path), at(sa, path))]));
      // The baseline had no fields, so its reading is the English patterns; after, the field reading (the union
      // falls back to the pattern only on records with no field).
      for (const signal of ["correction", "failure"]) {
        for (const metric of PAIRED_STM_SIGNALS)
          stm[group][`${signal}.${metric}`] = pair(at(sb, `${signal}.pattern.${metric}`), at(sa, `${signal}.field.${metric}`));
      }
    }
    const wm = {};
    for (const group of ["all", "base", "long-scope"]) {
      const wa = wmDerived(a.wm[group]);
      const wb = wmDerived(b.wm[group]);
      wm[group] = Object.fromEntries(PAIRED_WM.map((path) => [path, pair(at(wb, path), at(wa, path))]));
      wm[group]["laterStep.keptShare"] = pair(at(wb, "laterStep.keptShare"), at(wa, "laterStep.keptShare"));
    }
    perModel[model] = {
      stm,
      wm,
      usage: {
        inputTokens: pair(b.usage.inputTokens, a.usage.inputTokens),
        outputTokens: pair(b.usage.outputTokens, a.usage.outputTokens),
        costEstimateUsd: pair(b.costEstimateUsd, a.costEstimateUsd),
        latencyP95Ms: pair(b.latencyMs.p95, a.latencyMs.p95),
        failedRequests: pair(b.usage.failedRequests, a.usage.failedRequests),
      },
    };
  }
  return {
    fixture: after.fixture.indexSha256,
    rulesHash: after.rulesHash,
    models,
    productHash: { baseline: baseline.productHash, after: after.productHash },
    signalReading: "correction and failure: the baseline's English patterns against the after-run's fields",
    perModel,
  };
}
