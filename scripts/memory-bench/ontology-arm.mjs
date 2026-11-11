/**
 * Plan 208 Task 3: the ontology arm (`--ontology`). `@arnilo/prism-knowledge/wiki` is installed next to the arm's
 * fabric and runs as it would for a user: since plan 216 Task 3 the wiki keeps concepts in its own store (a temp root
 * per arm), reads the fabric through the read-only `memory.ltm` port and binds notes on its own pass; the concept pass
 * is a background job that a session opening schedules. This module owns what the bench adds around that:
 *
 * - the settle wait: after a history is ingested the bench reopens the session until a pass finds nothing to do,
 *   bounded by {@link ONTOLOGY_SETTLE_MS} per history. A pass still running at the bound is aborted by the session
 *   and recorded as a deviation (`ontologySettleTimeout`), never skipped silently;
 * - the report: counts, ids and times only (the no-text rule), including the `concept` evidence stage;
 * - the private claim bundle the claim-support audit reads (`ontology-claims-v1`, text-bearing, gitignored).
 */
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definePackage } from "@arnilo/prism";
import { MEMORY_LTM_SERVICE } from "@arnilo/prism-memory-system";
import { createMarkdownWikiStore, createWikiOntology, parseConceptBody, wiki } from "@arnilo/prism-knowledge/wiki";
import { bundleFromConcepts } from "./ontology-audit.mjs";

/** Bounded wait per history for background concept passes (plan 208 Task 3). */
export const ONTOLOGY_SETTLE_MS = 120_000;
/** A history that needs more passes than this is leaving work due on purpose (declined subjects); stop asking. */
export const ONTOLOGY_MAX_ROUNDS = 16;
export const ONTOLOGY_TASK_NAME = "wiki.consolidate";
/**
 * Plan 208 Task 5 (series mode): split `questions` per cluster (one conversation or history) in dataset order. The first
 * `warmup` questions of a cluster are asked, unscored, before each scored question of the same cluster, so the
 * co-read events read-time consolidation feeds on exist when the scored question is answered. A cluster with no more
 * than `warmup` questions has nothing left to score and is reported as dropped. The split depends on the question list
 * only, so both trigger policies see the identical warm-up and scored sets.
 */
export function seriesPartition(questions, warmup) {
  if (!Number.isSafeInteger(warmup) || warmup < 1) throw new Error("MemoryBenchArguments: warmup is a positive integer");
  const clusters = new Map();
  for (const question of questions) {
    const key = question.cluster ?? question.conversationId ?? question.id;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(question);
  }
  const scored = [];
  const dropped = [];
  const warmupIds = [];
  for (const [cluster, rows] of clusters) {
    if (rows.length <= warmup) {
      dropped.push({ cluster, questions: rows.length });
      continue;
    }
    const warm = rows.slice(0, warmup).map(({ id, question, date }) => ({ id, question, date }));
    warmupIds.push(...warm.map((row) => row.id));
    for (const row of rows.slice(warmup)) scored.push({ ...row, warmup: warm });
  }
  return { scored, dropped, warmupIds };
}

export const CONCEPT_STAGES = Object.freeze(["concept", "note", "none"]);
const READ_SCOPES = ["user", "project"];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The curator's request, recognised by its one tool (`edit_concept`). */
export function isCuratorRequest(request) {
  return (request.tools?.map((tool) => tool.name) ?? []).includes("edit_concept");
}

/** Curator call accounting on the question state, created on first use so no other report changes shape. */
export function curatorStats(state) {
  state.curator ??= { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  return state.curator;
}

const rate = (count, total) => (total ? count / total : null);

/** The arm for one history. `config` is the resolved `wiki` memory config (explicit settings only). */
export function createOntologyArm({ config = {}, settleMs = ONTOLOGY_SETTLE_MS } = {}) {
  // The wiki's own store: the root the bench hands it (inside the history's memory root, so the per-history cache
  // keeps the concepts with the notes they cite), else a temp root; a run never writes into a workspace.
  let root = config.root;
  const resolveRoot = () => (root ??= mkdtempSync(join(tmpdir(), "memory-bench-wiki-")));
  let ltm;
  /** A read-only view of what the agent's wiki wrote: its store on disk, over the same `memory.ltm` port. */
  const port = () => {
    const service = ltm?.();
    return createWikiOntology({ store: createMarkdownWikiStore({ root: resolveRoot() }), ltm: () => service });
  };
  const passes = [];
  /** Passes that did something: a model call, an edit or a bind. A pass that only leaves items due is not progress. */
  const progress = () =>
    passes.filter((report) => Number(report.modelCalls) > 0 || Number(report.edits) > 0 || Number(report.binds) > 0).length;
  const capture = definePackage({
    name: "memory-bench-ontology-port",
    version: "0.13.0",
    requires: { api: 1 },
    setup(prism) {
      ltm = () => prism.services.consume(MEMORY_LTM_SERVICE);
      // A package event is observable by hooks, not by `agent.subscribe()`: the wiki emits one per pass that did work.
      prism.hooks.on("package.event", (event) => {
        if (event.name === "wiki.consolidated" && event.data) passes.push(event.data);
      });
    },
  });
  const active = new Set();
  let aborted = 0;
  let stream;
  let watching;

  let packages;
  const arm = {
    /** Where the wiki keeps its store; call before `packages` is read. */
    useRoot(dir) {
      if (packages !== undefined) throw new Error("the ontology arm's packages were already built");
      root = dir;
    },
    get packages() {
      packages ??= [wiki({ ...structuredClone(config), root: resolveRoot(), store: "markdown" }), capture];
      return packages;
    },
    /** Start reading the agent's event stream. Call once, right after the agent is created. */
    watch(agent) {
      stream = agent.subscribe();
      watching = (async () => {
        for await (const event of stream) {
          if (event.type === "background.started" && event.name === ONTOLOGY_TASK_NAME) active.add(event.taskId);
          else if ((event.type === "background.completed" || event.type === "background.failed") && event.name === ONTOLOGY_TASK_NAME) {
            active.delete(event.taskId);
            if (event.type === "background.failed" && event.reason === "aborted") aborted += 1;
          }
        }
      })().catch(() => {});
    },
    /** Stop reading; safe to call twice. */
    async unwatch() {
      await stream?.return?.();
      await watching;
    },
    passes: () => passes.length,
    passesList: () => [...passes],
    /**
     * Reopen the session until a pass finds nothing to do, within `settleMs`. Each reopening schedules the
     * background pass the way a user's next session would. Returns the wait and what it found.
     */
    async settle(agent, sessionId) {
      const startedAt = performance.now();
      const passesBefore = passes.length;
      let rounds = 0;
      let timedOut = false;
      while (rounds < ONTOLOGY_MAX_ROUNDS) {
        const left = settleMs - (performance.now() - startedAt);
        if (left <= 0) {
          timedOut = true;
          break;
        }
        const before = progress();
        const abortedBefore = aborted;
        const session = await agent.session({ id: sessionId, create: true });
        // `close()` settles background tasks within `limits.backgroundSettleMs` and aborts the rest.
        await tick();
        await session.close();
        await tick();
        if (aborted > abortedBefore) {
          timedOut = true;
          break;
        }
        rounds += 1;
        // A pass that only leaves items due (a lone note, a declined subject) made no model call and wrote nothing:
        // asking again changes nothing, so the history is settled.
        if (progress() === before) break;
      }
      // An abort anywhere in the history counts, including a pass cut off when an ingest session closed.
      return {
        ontologySettleMs: Math.round(performance.now() - startedAt),
        ontologySettleRounds: rounds,
        ontologySettleTimeout: timedOut || aborted > 0,
        ontologyAborted: aborted,
        ontologyPassesInSettle: passes.length - passesBefore,
      };
    },
    /** Concept notes of every readable scope with the text of the notes their claims cite. Private: it holds text. */
    async snapshot() {
      const service = port?.();
      if (service === undefined) return { concepts: [], noteText: () => undefined, notes: new Map(), scopes: [], noteCount: 0, bound: 0 };
      const concepts = [];
      const notes = new Map();
      for (const scope of service.scopes().filter((level) => READ_SCOPES.includes(level))) {
        const subjects = await service.subjects(scope);
        for (let i = 0; i < subjects.length; i += 32) {
          const batch = subjects.slice(i, i + 32);
          const views = await service.read(
            scope,
            batch.map((entry) => entry.conceptId),
          );
          for (const view of views) {
            const entry = batch.find((candidate) => candidate.conceptId === view.id);
            if (entry) concepts.push({ id: view.id, subject: entry.subject, scope, text: view.text });
          }
        }
      }
      const cited = new Set();
      for (const concept of concepts)
        for (const claim of parseConceptBody(concept.text, { allowUncited: true }).claims) for (const cite of claim.cites) cited.add(cite);
      for (const scope of service.scopes().filter((level) => READ_SCOPES.includes(level))) {
        const ids = [...cited].filter((id) => !notes.has(id));
        for (let i = 0; i < ids.length; i += 32) {
          for (const view of await service.read(scope, ids.slice(i, i + 32))) notes.set(view.id, view);
        }
      }
      // Bound-note share: page the evidence notes (concepts excluded) and count the ones that carry a subject.
      let noteCount = 0;
      let bound = 0;
      for (const scope of service.scopes().filter((level) => READ_SCOPES.includes(level))) {
        let cursor;
        for (let pages = 0; pages < 400; pages++) {
          const page = await service.pending(scope, { limit: 64, ...(cursor === undefined ? {} : { cursor }) });
          for (const view of page.notes) {
            noteCount += 1;
            if (view.subject !== undefined) bound += 1;
          }
          cursor = page.cursor;
          if (cursor === undefined) break;
        }
      }
      return { concepts, notes, noteText: (id) => notes.get(id)?.text, scopes: [...service.scopes()], noteCount, bound };
    },
  };
  return arm;
}

/**
 * Counts, ids and rates only. `claimsPerConcept` is a mean; `boundNoteShare` is the share of the history's
 * notes bound to a subject. No claim, note or corpus text.
 */
export function ontologyCounts({ snapshot, passes, curator }) {
  const { noteCount, bound } = snapshot;
  const claims = snapshot.concepts.reduce((sum, concept) => sum + parseConceptBody(concept.text, { allowUncited: true }).claims.length, 0);
  const rejected = { trust: 0, secret: 0, invalid: 0 };
  let repairs = 0;
  let modelCalls = 0;
  let failedItems = 0;
  for (const report of passes) {
    for (const key of Object.keys(rejected)) rejected[key] += Number(report.rejected?.[key] ?? 0);
    repairs += Number(report.correctionCalls ?? 0);
    modelCalls += Number(report.modelCalls ?? 0);
    failedItems += Number(report.left ?? 0);
  }
  return {
    concepts: snapshot.concepts.length,
    claims,
    claimsPerConcept: rate(claims, snapshot.concepts.length),
    boundNoteShare: rate(bound, noteCount),
    passes: passes.length,
    modelCalls,
    repairs,
    rejected,
    itemsLeftDue: failedItems,
    curator: { ...curator },
  };
}

/** The concept ids of a snapshot with the note ids their claims cite. */
export function conceptCites(snapshot) {
  return snapshot.concepts.map((concept) => ({
    id: concept.id,
    cites: new Set(parseConceptBody(concept.text, { allowUncited: true }).claims.flatMap((claim) => claim.cites)),
  }));
}

/**
 * Which door answer-bearing evidence came through: a recalled concept that cites an answer-bearing note
 * (`concept`), a recalled answer-bearing round with no such concept (`note`), or neither (`none`). Ids only.
 */
export function conceptStage({ concepts, recalledIds, answerBearingNotes, answerBearingRounds }) {
  const recalled = new Set(recalledIds);
  const bearing = new Set(answerBearingNotes);
  for (const concept of concepts) {
    if (!recalled.has(concept.id)) continue;
    for (const cite of concept.cites) if (bearing.has(cite)) return "concept";
  }
  for (const id of recalledIds) if (answerBearingRounds.has(id)) return "note";
  return "none";
}

/** One private `ontology-claims-v1` bundle for a history; `question` is filled once the answer is scored. */
export function claimBundle({ arm, model, suite, partition, history, snapshot, question }) {
  return bundleFromConcepts({
    arm,
    model,
    suite,
    partition,
    history,
    concepts: snapshot.concepts,
    noteText: snapshot.noteText,
    ...(question ? { questions: [question] } : {}),
  });
}

const safeName = (value) =>
  String(value)
    .replace(/[^A-Za-z0-9._+-]/g, "_")
    .slice(0, 120);

/** `<dir>/<arm>/<history>.json`. The directory is gitignored with the answer cache; the file holds text. */
export function claimBundlePath(dir, arm, history) {
  return join(dir, safeName(arm), `${safeName(history)}.json`);
}

/** Write one history's bundle. `correct` is unknown until the answer is scored; {@link markClaimBundleCorrect} sets it. */
export async function writeClaimBundle(dir, bundle) {
  const path = claimBundlePath(dir, bundle.arm, bundle.history);
  await mkdir(join(dir, safeName(bundle.arm)), { recursive: true });
  await writeFile(path, `${JSON.stringify(bundle)}\n`);
  return path;
}

/** Record whether the question this history answered was scored correct (evidence reach counts correct answers only). */
export async function markClaimBundleCorrect(dir, arm, history, correct) {
  const path = claimBundlePath(dir, arm, history);
  let bundle;
  try {
    bundle = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return false;
  }
  bundle.questions = (bundle.questions ?? []).map((question) => ({ ...question, correct: correct === true }));
  await writeFile(path, `${JSON.stringify(bundle)}\n`);
  return true;
}

const sum = (rows, pick) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * The report-level ontology table: concept counts, claims per concept, bound-note share, passes, rejected edits and
 * repairs, curator tokens, the settle wait (reported apart from answer latency), recorded deviations, and the
 * `concept` stage per ability. Rows carry counts and ids only, so the table does too.
 */
export function summarizeOntology(results) {
  const rows = results.filter((row) => row.ontology);
  if (!rows.length) return undefined;
  const settle = rows.map((row) => row.ontology.ontologySettleMs).filter(Number.isFinite);
  const stage = (selected) =>
    Object.fromEntries(CONCEPT_STAGES.map((name) => [name, selected.filter((row) => row.ontology.conceptStage === name).length]));
  const abilities = [...new Set(rows.map((row) => row.ability))].sort();
  const concepts = sum(rows, (row) => row.ontology.concepts);
  const claims = sum(rows, (row) => row.ontology.claims);
  const percentile = (q) =>
    settle.length ? [...settle].sort((a, b) => a - b)[Math.min(settle.length - 1, Math.ceil(q * settle.length) - 1)] : null;
  return {
    histories: rows.length,
    concepts,
    claims,
    claimsPerConcept: concepts ? claims / concepts : null,
    boundNoteShare: mean(rows.map((row) => row.ontology.boundNoteShare).filter((value) => typeof value === "number")),
    passes: sum(rows, (row) => row.ontology.passes),
    modelCalls: sum(rows, (row) => row.ontology.modelCalls),
    repairs: sum(rows, (row) => row.ontology.repairs),
    rejected: {
      trust: sum(rows, (row) => row.ontology.rejected?.trust),
      secret: sum(rows, (row) => row.ontology.rejected?.secret),
      invalid: sum(rows, (row) => row.ontology.rejected?.invalid),
    },
    itemsLeftDue: sum(rows, (row) => row.ontology.itemsLeftDue),
    curator: {
      calls: sum(rows, (row) => row.ontology.curator?.calls),
      inputTokens: sum(rows, (row) => row.ontology.curator?.inputTokens),
      outputTokens: sum(rows, (row) => row.ontology.curator?.outputTokens),
      cacheReadTokens: sum(rows, (row) => row.ontology.curator?.cacheReadTokens),
      callsPerHistory: rows.length ? sum(rows, (row) => row.ontology.curator?.calls) / rows.length : null,
      inputTokensPerHistory: rows.length ? sum(rows, (row) => row.ontology.curator?.inputTokens) / rows.length : null,
      outputTokensPerHistory: rows.length ? sum(rows, (row) => row.ontology.curator?.outputTokens) / rows.length : null,
    },
    settle: {
      n: settle.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: settle.length ? Math.max(...settle) : null,
      timeouts: rows.filter((row) => row.ontology.ontologySettleTimeout).length,
      excludedFromAnswerLatency: true,
    },
    conceptStages: {
      all: stage(rows),
      byAbility: Object.fromEntries(abilities.map((ability) => [ability, stage(rows.filter((row) => row.ability === ability))])),
    },
    deviations: rows.filter((row) => row.ontology.ontologySettleTimeout).map((row) => ({ id: row.id, kind: "settle-timeout" })),
  };
}
