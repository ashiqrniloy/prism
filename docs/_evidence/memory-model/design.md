# Prism memory model: one memory system based on human memory

**Status:** owner decision, 2026-11-08. The owner accepted every recommendation in the review below and asked that
the memory layer be rebuilt along these lines. Plans 216–223, with 219.1 inserted for retrieval, implement it (§11). This document is the design record
those plans cite. It is not a package page: each package README documents the contract as it lands.

**Supersedes:**

- the "episodic memory" redesign of plan 210 Tasks 7.1–7.6 (2026-11-08). The name *episodic* now belongs to a
  long-term memory kind (§5.6), so the session tier does not take it;
- the "three-tier memory" framing (OM → fabric → wiki as ontology; roadmap decision of 2026-10-31). The ontology is
  no longer a memory tier (§5.10).

---

## 1. Summary

Prism's memory becomes **one memory system** modelled on human memory. A host can install it whole or use any
consistent subset of it (§6).

```
                 transcript (kernel branch, append-only, never deleted by memory)
                        │  the context window = the agent's focus of attention
                        ▼
   ┌──────────── STM ────────────┐   scope-blind encoding: what happened, with verbatim chunks
   │ events · ids · descriptions │   trigger: unobserved transcript tokens, or an event boundary
   └──────────────┬──────────────┘
                  ▼  STM surface ≥ wm.triggerTokens (10k), or a boundary
   ┌──────────── WM ─────────────┐   goal-directed maintenance under the host's episode scope
   │ kept events · itemised      │   keeps what the scope's remaining work needs; compresses toward
   │ summaries · episode facts   │   wm.targetRatio (0.2) as pressure, never by dropping protected items
   └──────────────┬──────────────┘
                  ▼  episode end (main path) · WM ≥ rehearsal.triggerTokens (80k) · API · command · dispose
   ┌───────── REHEARSAL ─────────┐   the only door into LTM: judges WM against the episode AND the project,
   │ (session)                   │   writes typed LTM candidates, shrinks WM toward rehearsal.targetRatio
   └──────────────┬──────────────┘
                  ▼
   ┌──────────────────────────── LTM (store of record) ────────────────────────────┐
   │ declarative:      EPISODIC (immutable events: when, where, what, outcome)     │
   │                   SEMANTIC (facts, preferences, decisions)                    │
   │ non-declarative:  PROCEDURAL (how-to → skills) · CONDITIONED (cue → response) │
   │ read side:        PRIMING (activation: pre-activation, cues, rules, directory)│
   └──────────────────────────────────────▲────────────────────────────────────────┘
                                          │
                              SLEEP (offline, overnight or on demand): semanticization, procedure
                              extraction, trigger acquisition/extinction, conflict resolution, forgetting

   outside memory:  WIKI (the ontology: concepts with cited claims, ingested sources, its own curator pass;
                    reads LTM notes through a read-only port and follows LTM deletions)
```

Five ideas carry the design:

1. **Encoding is neutral, keeping is goal-directed.** STM never sees the episode scope. WM and Rehearsal see it and
   decide what to keep.
2. **Deletion is a surface decision, not erasure.** Every tier separates *surface* (what is in context), *index* (a
   recallable id and one-line description) and *backing* (verbatim chunks). A tier removes surface; it keeps the
   index as a tombstone; backing goes only when nothing references it (§4, I2–I3).
3. **Compression is relevance-driven.** A target ratio is pressure, not a guarantee. Protected items are never
   dropped to meet it, and summaries are itemised deltas that cite their sources, never whole rewrites (I5–I6).
4. **Non-declarative memory changes behaviour without the agent asking.** Declarative memory is what the agent
   recalls on purpose (`memory.recall`). Non-declarative memory reaches it through injection, ranking priors,
   hooks and skills (§5.6.2).
5. **The ontology is not memory.** Concepts, schemas and ingested sources belong to the wiki, a separate knowledge
   package (§5.10). Memory is what the agent experienced and learned; the wiki is curated knowledge that may cite it.

## 2. Why the change

Findings that motivate the change, from plan 210's review and evidence:

- **The observer records facts, not events.** `DEFAULT_OBSERVER_INSTRUCTION`
  (`packages/memory/observational/src/workers/observer.ts:17`) says "Find durable source-backed facts". What
  happened, and what was changed and verified, is not recorded as such, so a later task re-derives it with
  `grep`, `read` or `bash`.
- **The reflector rewrites the whole log, and a partial answer loses data.** Its prompt is "Rewrite the entire memory
  log" (`workers/reflector.ts:8`). Any non-empty result consumes *every* observation it was sent and supersedes
  every earlier reflection (`flush.ts:150-160`).
- **The dropper has no criteria.** Its prompt is one sentence about the budget (`workers/dropper.ts:6`). It rarely
  fires: the reflector consumes observations first, and config forces `targetTokens >= observationTokens`.
- **The bridge into long-term memory produced nothing that was later used.** On plan 202 Task 16's offline
  lifecycle suite, promotion wrote 0.25 notes per session on OM+fabric. None was recalled and cited in a later
  session (use-verified share **0**).
- **The long-term kinds a human-memory model needs exist, but nothing writes them.** `kind.episode` is a view over
  OM ids that nothing writes. `kind.procedure` and `lifecycle.episode-merge` have no producer. Plan 210's gap
  analysis classed them "no-credible-path" (`docs/_evidence/memory-bench/210/gap-analysis.md:17`). They were inert
  because nothing fed them; Rehearsal and Sleep are the producers.
- **"Working memory" already names something else in Prism.** Fabric's `working` kind is MemGPT-style core blocks
  (`packages/memory/fabric/src/working-memory.ts:10`; `WorkingMemoryStore` in
  `packages/memory/core/src/types.ts:348`). It is unmeasured, rare and also no-credible-path, so it is retired, and
  the name goes to WM (§5.4).
- **Fabric's losses are evidence coverage, not synthesis.** Plan 188.8's post-investigation found fabric loses
  because the evidence is not covered, not because synthesis fails. More layers of lossy summarisation would make
  that worse. That is why every derived item keeps a provenance chain back to verbatim chunks (I4).

## 3. The human-memory mapping, stated honestly

| Prism component | Human-memory analogue | Where the analogy holds | Where it does not |
|---|---|---|---|
| Transcript and context window | Sensory register; focus of attention (Cowan's embedded-processes model) | Verbatim; capacity-bounded; "attended" content is what the model reads now | The transcript is never lost; it is the kernel's record |
| **STM** | Fast, neutral encoding of events: hippocampal encoding, Baddeley's episodic buffer | Records what happened, in order, without goals biasing it | Psychology treats STM and WM as one store. Here they are two buffers with different time constants and different jobs |
| **WM** | Goal-directed maintenance by the central executive; *long-term working memory* (Ericsson & Kintsch, 1995): task-relevant information kept in fast-access structures for the length of a task | Keeps what the current goal (the episode scope) still needs | Not capacity-limited to a few chunks; its budget is in tokens |
| **Rehearsal** | Elaborative rehearsal: Atkinson–Shiffrin's transfer from STM into LTM | The single gate into LTM, judged against the episode and the project | It also compresses WM, which psychology's rehearsal does not |
| **Sleep** | Systems consolidation and sleep replay; complementary learning systems (McClelland, McNaughton & O'Reilly, 1995) | Offline; abstracts recurring episodes into semantic knowledge | It runs on a schedule or on request, not on a circadian clock |
| **Episodic LTM** | Tulving's episodic memory: what, when, where | Immutable time-stamped events with context | — |
| **Semantic LTM** | Facts | Revisable; superseded on correction | Schemas and concepts are deliberately *not* here: they are curated knowledge and belong to the wiki (§5.10) |
| **Procedural LTM** | Skills and habits | How-to knowledge; mature procedures become skills | Not literally automatic: a skill is still text the model reads |
| **Conditioned responses** | Classical conditioning: a cue that elicits a response | A learned cue (tool pattern, error signature, path, phrase) fires a response with no deliberation; acquisition and extinction | Responses are limited to adding friction (I10) |
| **Priming** | Repetition and semantic priming | Earlier exposure makes related memory easier to reach: pre-activation, cue-driven injection, recency/frequency priors | It is an activation state over LTM, not a store |
| Habituation and sensitization | Non-associative learning | STM collapses repeated harmless events; caution is raised for a while after a severe failure | — |
| Outcome evidence | Operant conditioning | Helpful and harmful evidence changes the strength of procedures and triggers | Not a store |
| Reconsolidation | Recall makes a memory editable again | A recalled-and-used LTM item re-enters STM as an event; Rehearsal may strengthen or correct it | — |

## 4. Invariants

These are checked by tests in the plans that build each part.

- **I1 — STM is scope-blind.** No STM request contains the episode scope, an LTM fact or a WM item. STM sees the
  transcript batch, the current task state and an index of recent STM records.
- **I2 — Three axes per item.** Every STM and WM item has:

  | Axis | What it is |
  |---|---|
  | Surface | Rendered into context |
  | Index | Id, kind, time, one-line description, state; kept as a tombstone after removal |
  | Backing | Verbatim chunks in the chunk store |

  `memory.recall` reads the index and the backing. Only the surface counts toward a tier's token budget.
- **I3 — Who deletes what.**
  - WM tombstones the STM surface it has processed.
  - Rehearsal tombstones the WM surface it has processed.
  - Chunk backing is deleted when its reference count reaches zero. References come from live STM, WM and LTM
    items, and from forked sessions.
  - Nothing in memory deletes transcript entries.
  - A tombstone keeps its id and description, so a scope change can bring it back while its chunks live.
  - Hard delete means hard: the chunk store vacuums.
- **I4 — Provenance chain.** Every derived item cites its parents (WM → STM ids → chunks; LTM → WM/STM ids and
  session entries). A citation outside the active set is refused.
- **I5 — Compression is relevance-driven.**
  - `wm.targetRatio` and `rehearsal.targetRatio` (default 0.2, an 80% reduction) are pressure.
  - Protected items are never dropped to meet them: items cited by the task state or an active fact, unresolved
    failures, open questions, and inputs to planned later steps.
  - When the target cannot be met, the pass records `budget_unmet` with the protected share and leaves the next
    step to the next tier.
- **I6 — Incremental only.** A pass adds, supersedes or tombstones *named* items. No pass rewrites a tier
  wholesale. This avoids "context collapse" from iterative rewriting (ACE, §13).
- **I7 — Cache stability.**
  - Session-tier surfaces enter the prompt only at compaction, and anything newer goes in the tail, as today.
  - The LTM prefix blocks (directory, standing rules, priming) are pinned per session epoch.
  - The plan 202 cache-stability pin must keep passing.
- **I8 — Episodic is immutable, semantic is revisable.** An episode can be archived or forgotten, never edited or
  superseded. A semantic note is superseded on correction, with lineage.
- **I9 — LTM writes earn trust.** Rehearsal and Sleep write `candidate` notes. They pass the existing write gates
  (trust scan, redaction, scope and consent rules, provenance stamp). Candidates are verified by use and never
  injected passively before then.
- **I10 — Learned non-declarative memory is escalate-only.** A learned trigger or sensitization can remind, suggest
  or require approval. It can never grant a permission, skip an approval or deny a tool on its own authority. Host
  policy bounds every response.
- **I11 — The scope is data.** The episode scope is untrusted host or user text. It is bounded, redacted and given
  to WM and Rehearsal inside a delimited data block, under an instruction that it describes goals and is not an
  instruction.
- **I12 — Any consistent subset works.** A component whose dependency is missing fails closed at `createAgent` with
  a named error. A component that is off loads nothing and costs nothing (§6).
- **I13 — Relevance first.** Every non-relevance ranking term (scope, storage and retrieval strength, decay, time,
  association, priming) is bounded on the [0,1] relevance scale. Together they can only reorder hits whose relevance
  is within `ltm.retrieval.priorBand` (default 0.1) of each other. The rule holds the same with one scope or many.
- **I14 — One analyzer, one scorer.**
  - Indexing, querying, ranking and confidence use the same analyzed terms and one BM25F scorer in memory-core.
  - Store adapters only match and count. Every adapter (SQLite, Postgres, markdown index, in-memory) returns the same
    ranked result for the same data.
- **I15 — The association index is derived and disposable.** It holds note ids, analyzed entity terms, and edges from
  links, provenance and episode membership. It holds no concept, claim or schema, so the ontology stays in the wiki.
  Dropping it changes ranking only.

## 5. Components

### 5.1 The context window and compaction

The context window is the focus of attention. History stays verbatim until compaction. **WM owns the `compaction`
slot**, which OM owns today.

A compaction replaces covered transcript with three things:

- the WM surface;
- the STM surface not yet processed by WM;
- the current task state.

It keeps `context.recentMessages` verbatim. Compaction makes no model call; the tiers' own passes already ran in the
background. With a foreign compaction owner, the session tiers pin their surface at that compaction, as OM's
`pinned` mode does today.

### 5.2 STM — short-term memory

- **Role.** Passively record what happens that is relevant in the short term, with an id and a description detailed
  enough that a later model can decide from the description alone whether the item and its chunks are useful.
- **Encoder.** The current observer, redesigned (ex-plan 210 Task 7.3).
- **Trigger.** Unobserved eligible transcript tokens reach `stm.triggerTokens` (default 10,000), or an event
  boundary arrives:
  - a task or subtask outcome;
  - a task-state change;
  - a user turn after an idle gap.
- **Record.** `{ id, kind, description, sourceEntryIds, chunkRefs, observedAt, referencedAt?, relevance, supersedes?,
  count? }`.
  - `kind` is one of `request | action | result | change | decision | outcome | error | statement | recalled`.
  - An `outcome` record names what was asked, what changed (files, symbols, commands, config keys, ids), what was
    achieved or left open, and how it was verified.
- **Chunks.** Verbatim excerpts the model chooses (a tool result, a command's output, code that was read, a
  message).
  - The package checks that a chunk is a substring of the cited entry and refuses it otherwise
    (`chunk_not_verbatim`).
  - Each chunk is capped (`stm.maxChunkBytes`, 4 KB) and redacted before it is written.
  - Chunks are stored in a deletable local chunk store (SQLite, mode 0600, in the host data directory), never on the
    append-only branch.
- **Habituation.** A repeated identical event (polling, a benign warning) updates one record's `count` and last time
  instead of adding a record.
- **Task state.** STM keeps recording the task state (goal, open questions, decisions, next steps). WM renders it.
- **Rendering.** `- [id] HH:MM (kind, relevance) description [chunk]`. Chunk text never enters the surface; it is
  read through recall.

### 5.3 The episode scope

The episode scope is natural-language text that says what the current body of work is meant to achieve, including
the work still planned. A plan document with tasks is the typical case.

- **How it is set:**
  - `memory:scope` (text, or a path the host resolves);
  - the `scope.text` config at session start;
  - the service API.
- **Limits:** `scope.maxBytes` (32 KB), redacted.
- **Who sees it:** WM and Rehearsal only; never STM (I1).
- **History:** every replacement appends a `scope.set` record with hash, length and time. A scope change triggers
  WM re-judgment (§5.4).
- **Default:** with no scope, WM and Rehearsal treat the session's current work, as the task state shows it, as the
  episode.

### 5.4 WM — working memory

- **Role.** Actively process STM so that only what matters for the episode's *whole* remaining scope is kept.
  - With task 2 of a plan in progress, WM keeps what tasks 3…N will need, not only what task 2 needs.
  - Where it cannot discard, it summarises and shrinks the surface.
- **Trigger.**
  - the STM surface reaches `wm.triggerTokens` (default 10,000, set by the host);
  - or an event boundary arrives;
  - or the host calls the API.
- **Input:**
  - the scope;
  - the current WM items;
  - the new STM records with chunk sizes;
  - salience signals: corrections, approval denials, errors, failed verifications, surprises.
- **Tools.** Each item it touches gets exactly one verdict:
  - `keep` (an STM record becomes a WM `event` item, with its chunk references);
  - `summarize` (an itemised WM `summary` citing the STM ids it covers, inheriting their chunk references);
  - `derive` (an episode-scoped WM `fact` citing its support);
  - `discard` (with a reason: `finished | out-of-scope | superseded | duplicate`).
- **Compression.** Relevance first. `wm.targetRatio` (0.2) applies to the surface of what the pass processed, and
  I5's protections and `budget_unmet` apply.
- **After the pass:** WM tombstones the STM surface of every processed record. Chunks referenced by a live WM item
  stay (I3).
- **Scope change.** On a new scope, WM re-judges the tombstones whose chunks are still live, and may bring them back.
- **Incremental.** Only named items change (I6). This replaces the reflector's whole-log rewrite.

### 5.5 Rehearsal — the door into LTM

- **Role.** Judge WM against the episode **and** the overall project, keep in WM only what the session still needs,
  and turn what lasts into typed LTM.
- **Triggers:**
  1. episode end (`memory:episode:end`): the main path;
  2. the WM surface reaches `rehearsal.triggerTokens` (default 80,000), as a backstop;
  3. the programmatic API (`memory.system` service `rehearse()`);
  4. the user command `memory:rehearse`;
  5. a bounded best-effort pass on dispose without `episode:end`, recording `skipped` on failure.
- **Output:**
  - WM shrinks toward `rehearsal.targetRatio` (0.2) under I5;
  - LTM candidates: `episode` notes (one per completed task or episode), semantic notes (`fact`, `preference`,
    `decision`) in the right scope (user, project, path), and `procedure` notes for explicit how-to;
  - each write cites its provenance (I4) and passes LTM's write gates (I9).
- **Protections, enforced in code, not in the prompt:**
  - an item cited by the task state or an active fact is not dropped;
  - a `project` fact with relevance `high` or `critical` is not dropped at episode end, except as `superseded` or
    `duplicate`.
- **What it replaces.** Fabric's session-consolidation `promote` pass and the observational promotion path are
  retired (§10).

**Budget arithmetic** (with the defaults above):

1. STM batches arrive at 10k tokens.
2. With WM reducing them by about 80%, WM grows by about 2k tokens per cycle.
3. The 80k Rehearsal backstop is therefore reached only after about 40 cycles, roughly 400k tokens of STM surface.

Most sessions never reach it. So the main path is episode end, and session end is the fallback.

### 5.6 LTM — long-term memory

LTM is today's fabric store of record (markdown, SQLite or Postgres) with its scopes, trust, lifecycle (Bjork S/R
strengths, archive) and delivery tiers, all kept. The kinds and their producers change. Retrieval stays lexical but is
rebuilt (§5.11).

#### 5.6.1 Declarative memory (retrieved on purpose with `memory.recall`)

| Kind | Holds | Written by | Mutability |
|---|---|---|---|
| `episode` | One event or episode: `startedAt`/`endedAt`, session, project, scope hash, a narrative, outcome, files touched, cited STM/WM ids and chunks | Rehearsal | Immutable (I8); archive or forget only |
| `fact` | A durable fact | Rehearsal, the agent (`memory.insert`), Sleep (semanticization) | Revisable (supersession) |
| `preference` | A stated preference | Rehearsal, rule capture, the agent | Revisable |
| `decision` | A standing decision with rationale and status | Rehearsal, rule capture, the agent | Revisable |
| `exchange` | Verbatim turn archive | the exchange archive | Immutable |
| `file` | Workspace file note | the agent | Revisable |

The `concept` kind leaves LTM with the ontology (§5.10). So do concept-first recall, the concept recall prior, the
passive concept pointer and subject binding.

#### 5.6.2 Non-declarative memory (reaches the agent without it asking)

| Kind or mechanism | Holds | Produced by | Expressed through |
|---|---|---|---|
| `procedure` | How to do X: context, preconditions, steps, evidence, success count | Lessons (the agent), Rehearsal (explicit how-to), Sleep (from repeated successful episodes) | Cue delivery (path, task, scope match); a mature, verified procedure is proposed as a **skill** (`SKILL.md`) for a person to confirm |
| `trigger` (conditioned response) | `{ cue: { on: tool.call \| tool.result \| user-turn \| path, match }, response: remind \| suggest \| require-approval, strength, pairings, misses }` | Explicit capture ("whenever X, do Y"), lessons with a failure signature, Rehearsal of a repeated in-session failure; Sleep acquires triggers from repeated cue→outcome pairs and **extinguishes** them after N firings without the outcome | `tool.call` (`ask`, never deny), tail reminders; escalate-only (I10) |
| Priming (activation, not a kind) | — | — | Episode-start pre-activation from the scope (a cache-stable block); cue-driven tail injection; the directory and standing rules; the recency/frequency retrieval prior (R); exemplar priming (one past successful episode for a similar scope) |
| Habituation | — | STM | Repeated identical events collapse into one record (§5.2) |
| Sensitization | A short-lived, decaying raise in caution after a severe failure (a destructive error, a rollback, a denied approval) | Rehearsal | Raises the strength of related triggers or requires approval for related actions for N turns; escalate-only |
| Outcome evidence (operant) | Helpful and harmful counters | Use and outcome tags | Storage strength S of procedures and triggers |

### 5.7 Sleep — offline consolidation

- **When it runs.** `memory:sleep` or the service's `sleep()`; a host schedules it with `@arnilo/prism-headless`
  `createScheduler`, overnight or after N sessions. It never runs on a timer of its own.
- **What it reads.** Only work that changed since the last sleep (a per-scope cursor), so its cost tracks what is
  new, not store size.
- **Concurrency.** One lease per scope through the stores' `leases` service.
- **Bounds.** It stops at `sleep.maxModelCalls` and `sleep.maxMillis`, and reports.

| Job | What it does |
|---|---|
| Forgetting | Today's `memory:maintain`: strength-based archive, capacity, exchange tier; the command folds into Sleep |
| Duplicates and conflicts | Merge duplicates; resolve contradictions between semantic notes (supersede with lineage, or record the contradiction) |
| Semanticization | Abstract facts that recur across ≥ N episodes into semantic notes |
| Procedures | Extract procedures from repeated successful episodes (Memp / Agent Workflow Memory style) |
| Triggers | Acquire them from repeated cue→outcome pairs; extinguish them |
| Skill proposals | Propose skills for mature procedures |

### 5.8 One recall surface

`memory.recall` resolves session ids too: STM and WM items, tombstones (`chunk dropped: <reason>` when the backing is
gone) and chunk text verbatim, as well as LTM. The separate session `recall` tool is retired. Recall never re-runs a
tool: a recalled tool output comes from its chunk. Query recall over LTM, with its ranking, modes and confidence, is
§5.11.

### 5.9 Reconsolidation

Each time the agent recalls and *uses* an LTM item:

1. STM records a `recalled` event.
2. Rehearsal can then strengthen the item (a use for verification), correct it (a superseding note with lineage), or
   flag it (harmful evidence).

That is how candidates earn trust by use (I9).

### 5.10 The wiki: the ontology, outside memory

**Owner decision, 2026-11-08.** The ontology is not part of memory; it is part of the wiki.

**What leaves memory.** Today the ontology lives inside the fabric: concept notes in the store of record,
`packages/memory/fabric/src/ontology/**` (about 2,100 lines), concept-first ranking in `memory.recall`, the concept
recall prior, the passive concept pointer, subject binding at write time, and the in-store claim deletion cascade.
All of it leaves memory.

**The wiki package.** `@arnilo/prism-wiki`, renamed from `@arnilo/prism-memory-wiki`; plan 216 Task 1 confirms the
name. It is a knowledge package beside RAG, outside the memory system:

- **Own store.** It keeps its concepts and its ingested sources (`wiki_ingest` no longer writes LTM notes) in its own
  store, markdown by default.
- **Own surface.** It has its own agent tools for searching and reading concepts, its own passive pointer, and its
  own commands.
- **Own curator pass.** The co-read, accumulation and repair triggers stay, and a `wiki:consolidate` command lets a
  host schedule it, for example beside `memory:sleep`.

**Reading memory.** When memory is installed, the wiki reads LTM through the read-only `memory.ltm` port: notes,
their metadata, and use and co-read events. Its claims may cite LTM note ids as well as its own sources. It never
writes LTM. Without memory, it works from its own sources alone.

**Deletion still cascades deterministically.** Forgetting an LTM note must still remove every wiki claim that cited
it. LTM publishes its deletions (ids only) on the port. The wiki applies them when they arrive and, on open, by
reconciling against LTM's deletion lineage, so a wiki that was not running still catches up. Claims citing an
unreadable note are never rendered.

**Measurement.** The wiki is measured as its own tier (plan 208's `three-tier-criteria.json`), in its own
development screen (plan 222) and in the single held-out read (plan 223).

### 5.11 Retrieval

**Owner decision, 2026-11-08,** after a review of the retrieval path. Retrieval stays lexical: no embeddings (owner,
2026-10-24). Robustness comes from writing good retrieval cues and combining independent cues, not from better string
matching. Plan 219.1 builds it and measures it at gate M-T.

**What the review found** (code as of 2026-11-08; today's paths):

| # | Defect | Where | Effect |
|---|---|---|---|
| D1 | With several scopes active (the default, user + project), priors are added to RRF scores. RRF spans about 0.011 over the candidate window; the project-vs-user prior gap is 0.10, and each strength prior spans 0–0.05 | `fabric/src/scope/recall.ts:220-228` | Any project note outranks any user note, and a well-used weak match beats an unused exact one. Fusing by rank also drops score size |
| D2 | With one scope, the function returns before any prior is applied | `scope/recall.ts:176-186` | Storage and retrieval strength and per-kind decay do nothing |
| D3 | Postgres indexes `to_tsvector('english', text)`: body only, Snowball stemming, `ts_rank` | `core/src/postgres/postgres-ddl.ts:121` | Keys, the main defence against a question that uses different words from the note, are inert; SQLite and Postgres rank the same data differently |
| D4 | In lexical mode the score becomes coverage but the BM25 order is kept; the floor, the verified-first tie-break and the abstain check read coverage | `fabric/src/memory.ts:316`; `tools.ts:93` | Coverage ignores term rarity and falls as a question gets longer, so precise wordy questions abstain wrongly |
| D5 | Same-subject exchanges (Dice ≥ 0.5) are labelled "superseded" | `fabric/src/recall.ts:119` | Invented supersession. Wave 1 measured `recall.supersession-hint` negative, and plan 210 Task 7 removes it |
| D6 | Three analyzers: `lexicalTerms` (Unicode regex), `tokenizeLexical` (ASCII `[a-z0-9]+`), Postgres `english` | `core/src/lexical.ts:45`; `core/src/vector-memory.ts:588` | Text without spaces (Chinese, Japanese) is one token; non-ASCII text is invisible to conversation search |
| D7 | One-hop link expansion adds linked notes outside the ranking | `fabric/src/recall.ts` | Few links exist once plan 210 Task 7 removes `workers.linker` |

**What wave 1 shows** (plan 210 C-1; small strata, so directional): the right session is found but the evidence set is
not. Accuracy is close to all-required evidence coverage, as plan 188.8 found (about 80% correct when every piece of
evidence is visible).

| Ability | hit@k | All-required evidence | Accuracy |
|---|---|---|---|
| LME multi-session | 0.92–1.0 | 0.50–0.58 | 0.50–0.58 |
| BEAM event ordering | 0.75–1.0 | 0 (coverage 0.10–0.25) | 0 |
| BEAM contradiction resolution | 1.0 | 0–0.5 | 0 |
| LME temporal reasoning | 0.88 | 0.38 | 0.13 |

**The pipeline:**

| Stage | Human-memory basis | Agent-memory research | Mechanism | Plan |
|---|---|---|---|---|
| 1. Retrieval cues written at encoding | Encoding specificity (Tulving & Thomson 1973) | LongMemEval key expansion; doc2query | Rehearsal writes `cues` on each note: entities, participants, 1–3 questions the note answers, and `when`. They are indexed as their own field; no extra model call | 219 T2 (write), 219.1 T3 (index) |
| 2. Context reinstatement in the query | Context-dependent recall (Godden & Baddeley 1975) | LongMemEval time-aware query expansion | A deterministic time-expression parser feeds a time-proximity term (never a hard filter). The episode scope and touched paths become a low-weight query field | 219.1 T5 |
| 3. One analyzer and one scorer | — | BM25F (Robertson & Zaragoza 2009) | Unicode word segmentation; BM25F over body, keys and cues in TypeScript from store-provided counts; relevance and IDF-weighted confidence on one [0,1] scale (I14) | 219.1 T3 |
| 4. One activation score | ACT-R base level + spreading activation (Anderson & Schooler 1991); the fan effect | Generative Agents' normalised recency + importance + relevance | `relevance + min(priorBand, Σ terms)` (I13) | 219.1 T4 |
| 5. Pattern completion | Hippocampal indexing (Teyler & DiScenna 1986); spreading activation (Collins & Loftus 1975) | HippoRAG; A-MEM | A disposable association index (entities, links, provenance, episode membership) with bounded two-hop spreading, fan-normalised (I15). Episode pointers on member hits | 219.1 T6 |
| 6. Temporal contiguity | Temporal context model (Howard & Kahana 2002) | — | `memory.read around` (kept) | 219.1 T6 |
| 7. Output chosen by question type | — | MMR; lost in the middle | `lookup`, `gather`, `chronology`, `history`, inferred deterministically when not given. Supersession or conflict labels come only from lineage edges and Sleep's `conflict` records | 219.1 T7; 221 T3 (records) |
| 8. Metamemory | Feeling of knowing (Nelson & Narens 1990; Koriat 1993) | Self-RAG; CRAG | `answer`, `partial` or `none`, from calibrated confidence and agreement between routes. A partial result names the matched and missing terms and suggests cue terms | 219.1 T8 |
| 9. Source monitoring | Johnson, Hashtroudi & Lindsay (1993) | — | Id, date, scope, status and flags on every hit (kept) | — |
| 10. Use updates strength | Testing effect; reconsolidation | — | §5.9; the recall log also becomes an offline retrieval eval | 219 T5 |

**Relation to plan 210's wave 1 removals.** Plan 210 Task 7 removes three features wave 1 measured negative, each on
one 12-question stratum:

- `timeline`: resolved exchange dates, `from`/`to` windows and time order;
- `write.keyword-enrichment`;
- `recall.supersession-hint`.

Stages 1 and 2 are different mechanisms: model-written cues on Rehearsal notes, and a time prior inside the band. They
do not restore those features by name or config, and each must earn its default through its own leave-one-out arm at
gate M-T.

The plan 210 retrieval rows that are owner-held or unmeasured get their verdicts at gate M-T:

- `recall.multi-query`, `recall.unmatched-terms`, `recall.state-grouping` and `navigation.agentic-lexical`;
- `recall.gather` and `recall.expansion`;
- `retrieval.strength-priors` and `decisions.P5`.

**Measurement:** rows T1–T8 (§9). Every memory-model QA row reports all-required evidence coverage beside accuracy, so
a retrieval miss and an answering miss are told apart.

## 6. One package, partial use

**Package.** `@arnilo/prism-memory-system` (directory `packages/memory/system`) absorbs
`@arnilo/prism-memory-observational` (the session tiers) and `@arnilo/prism-memory-fabric` (LTM, minus the ontology).
The 0.12 name `@arnilo/prism-memory` is avoided because it is on the 0.13 deprecation list
(`scripts/deprecations-0.13.json`). Plan 216 Task 1 confirms the name with the owner before any code moves.

**What stays outside:**

- `@arnilo/prism-wiki`: the ontology and knowledge base (§5.10);
- `@arnilo/prism-memory-core`: the shared library (stores, lineage, scoring);
- `@arnilo/prism-rag` (renamed from `@arnilo/prism-memory-rag`, owner 2026-11-08, plan 216 Task 3): document retrieval, which the owner keeps outside memory;
- `@arnilo/prism-memory-compaction`: stable LLM-summary compaction, an alternative compaction owner.

**Config.** Each component is an object, or `false`:

```ts
memorySystem({
  stm: { model: "provider/small", triggerTokens: 10_000 },
  wm: { triggerTokens: 10_000, targetRatio: 0.2 },
  rehearsal: { triggerTokens: 80_000, targetRatio: 0.2 },
  ltm: { preset: "conversational", tools: { root: "./memory" } },
  sleep: { maxModelCalls: 40 },
  scope: { maxBytes: 32_768 },
});
```

**Profiles that must work** (tested, and in the example):

| Profile | Components | Use |
|---|---|---|
| `ltm` | `ltm` | Today's fabric use: notes, recall, standing rules |
| `session` | `stm` + `wm` | Long single sessions with no cross-session store |
| `stm` | `stm` | An event log with verbatim recall |
| `full` | all | The memory system |

**Fail-closed composition** (`memory_system_component_missing`, naming both components):

- `wm` without `stm`;
- `rehearsal` without `wm` or without `ltm`;
- `sleep` without `ltm`.

A component that is `false` registers nothing: no hook, tool, command or model call.

**Commands.** These replace `om*`, `memory:consolidate` and `memory:maintain`:

- `memory:session` (toggle the session tiers for this session), `memory:session:status`, `memory:session:view`,
  `memory:session:model`;
- `memory:scope`, `memory:rehearse`, `memory:episode:end`, `memory:sleep`.

The LTM commands (`memory`, `memory:status`, `memory:share`, `memory:import`/`export`, …) keep their names.

**Events.** `memory.session.status`, `memory.rehearsal.completed`, `memory.sleep.completed`.

**Services.**

- `memory.system`: `setScope`, `rehearse`, `endEpisode`, `sleep`, `status`.
- `memory.ltm`: LTM's read-only port for other packages (the wiki), replacing `memory.fabric`'s write-capable
  ontology port. It serves notes, metadata, use and co-read events, and deletions.

## 7. Safety and privacy

- Every existing LTM gate stays: trust scan, poisoning quarantine, redaction, consent, scope isolation, deletion
  cascade, legal holds and provenance.
- Chunks are redacted before they are written. They never enter the context block or shared stores, and they are
  read only by the session that references them (or its forks).
- The scope is data (I11). Learned triggers are escalate-only (I10).
- Skill proposals and rule capture need a person's confirmation through `host.ui`.
- Sleep writes candidates only, and runs under a lease.
- Every evidence file carries counts, ids and hashes, never chunk, scope, question, answer or claim text.

## 8. Cost model

| Work | Calls | Default that avoids it |
|---|---|---|
| STM pass | 1 model call per batch (10k eligible tokens or a boundary) | session tiers off per session (`memory:session`) |
| WM pass | 1 call per 10k STM surface tokens or boundary | `wm: false` |
| Rehearsal | 1 call per episode end, plus backstop crossings | `rehearsal: false` |
| Chunk store | 1 transaction per pass | `stm.maxChunksPerEvent: 0` |
| Sleep | ≤ `sleep.maxModelCalls` per run, only when triggered | never scheduled |
| Priming block | 0 model calls; one bounded query per epoch | `ltm.delivery.priming: false` |
| Triggers | 0 model calls at fire time (pattern match) | no triggers stored |

The plans report worker tokens per 10k eligible tokens against the pre-redesign OM baseline. A rise above 25% needs
a written justification.

## 9. Measuring whether it works

- **One criteria file, written before any run:** `scripts/memory-bench/memory-model-criteria.json`, frozen and
  hashed by plan 216 Task 2.
- **Statistics:** the existing rules (plan 198 statistics, clustered CIs, paired items):
  - non-inferiority is within 2 points at the CI lower bound;
  - a gain needs a CI lower bound > 0.
- **Partitions:** development screens read development partitions only; one held-out acceptance in plan 223 reads
  `heldout-a` for the first time, with one remediation round on `heldout-b`.
- **Providers:** the providers named at each gate (today paid Ollama Cloud, as in plan 210 gate C-1). Never
  `openrouter/free`.
- **Evidence coverage beside accuracy:** every QA row (S3, M5, R5, R6, T7, L4, Z1) reports all-required evidence
  coverage per ability next to accuracy.

| Rows | Component | Measures | Gate |
|---|---|---|---|
| S1–S4 | STM | S1: re-derivation calls per related task (continuity); S2: verbatim chunk recall (offline, exact); S3: QA non-inferiority on `beam-1m` and `longmemeval-m` against pre-redesign OM; S4: cost | M-1 (plan 217) |
| M1–M5 | WM | M1: continuity after a mid-episode re-plan; M2: protected-item loss = 0; M3: achieved ratio; M4: prefix stability; M5: QA non-inferiority | M-2 (plan 218) |
| R1–R6 | Rehearsal | R1: use-verified share of LTM writes over a multi-session lifecycle (baseline 0); R2: W1–W3 cross-session gains; R3: claim support of writes; R4: safety; R5: multi-session QA; R6: temporal ability | M-3 (plan 219) |
| T1–T8 | Retrieval | T1: all-required evidence coverage of the shown result (offline); T2: candidate recall@32; T3: ranking invariants (I13, exact); T4: store parity (I14, exact); T5: paraphrase and non-English robustness; T6: confidence separating answerable from unanswerable items; T7: live QA per ability with evidence coverage; T8: latency and cue-token cost | M-T (plan 219.1) |
| L1–L4 | Non-declarative | L1: procedural (W1 corrected-mistake repeats); L2: conditioned (failure recurrence, false-trigger rate, extinction); L3: priming (W4 orientation cost, prefix stability); L4: no QA regression | M-4 (plan 220) |
| Z1–Z4 | Sleep | Z1: sleep vs no-sleep across multi-session lifecycles; Z2: semanticization precision; Z3: growth; Z4: cost | M-5 (plan 221) |
| O1–O8 | The wiki (outside memory) | Plan 208's three-tier criteria, re-pointed at the extracted wiki over the new LTM; claim-support panel calibration first | K-1 (plan 222) |
| A | Acceptance | Robustness (202), wiki (208), work-outcome (209) and memory-model rows on the frozen products | gate A (plan 223) |

**The "before" baseline:**

- pre-redesign OM: the `OM` arm moved out of plan 210 wave 3, run from the last pre-216 revision;
- plan 210's slimmed fabric product (`P`).

## 10. Mapping: current to new

| Today | Becomes | Plan |
|---|---|---|
| `@arnilo/prism-memory-observational` | `@arnilo/prism-memory-system` session tiers; old name retired with a migration hint | 216 |
| `@arnilo/prism-memory-fabric` | `@arnilo/prism-memory-system` `ltm` | 216 |
| `@arnilo/prism-memory-wiki` | `@arnilo/prism-wiki`, outside memory; owns the ontology moved out of the fabric | 216 (extract), 222 (screen) |
| Fabric ontology (`concept` kind, `fabric/src/ontology/**`, concept-first recall, concept prior, passive pointer, binding, in-store cascade) | the wiki; LTM keeps a read-only port and a deletion feed | 216 |
| `wiki_ingest` writing fabric notes | wiki source notes in the wiki's own store | 216 |
| Observer | STM encoder: events with verbatim chunks, habituation, boundaries | 217 |
| `recall` (OM) | `memory.recall` session ids | 219 |
| Reflector | WM (scope-aware, incremental, ratio as pressure) | 218 |
| Dropper | Rehearsal (session) | 219 |
| OM compaction and pinned mode | WM owns compaction; pinned mode kept | 218 |
| `om`, `om:*` commands; `om.status` | `memory:session*`; `memory.session.status` | 216 |
| `promote`, `memory:consolidate`, extractor | retired; Rehearsal | 219 |
| `memory:maintain`, `fabric.maintain()` | Sleep job | 221 |
| Fabric `working` kind and `WorkingMemoryStore` usage | retired (frees the WM name) | 216 |
| `episode` view and `lifecycle.episode-merge` | retired; stored immutable `episode` kind | 216 (retire), 219 (stored kind) |
| `procedure` | procedural LTM with cue delivery and skill graduation | 220 |
| Standing rules, directory, path cues, passive tail | priming (kept; the scope pre-activation block added) | 220 |
| Rule capture ("whenever you…") | also produces `trigger` notes | 220 |
| Lessons | procedural writer; failure signature → trigger | 220 |
| Wiki triggers | stay in the wiki, plus `wiki:consolidate` for host scheduling | 216 |
| `lexicalTerms`, `tokenizeLexical`, Postgres `text_tsv`, store-native BM25/`ts_rank` | `analyzeLexical` and one BM25F scorer in memory-core; adapters match and count | 219.1 |
| RRF scope fusion plus additive priors; coverage-as-score | one bounded activation score (I13) | 219.1 |
| One-hop link expansion | association index with spreading activation | 219.1 |
| `gather`, state grouping (Dice), abstention at coverage 0.34 | recall modes; lineage-only labels; calibrated three-outcome confidence | 219.1 |

## 11. Transition

1. **Plan 210 is narrowed** (2026-11-08) so its paid runs measure only what plan 210 itself develops or audits and
   the redesign keeps: fabric retrieval, delivery, lifecycle, the Task 3.1 recall variants, and the plan 202 Task 5
   deferred rows.
   - Tasks 7.1–7.6 are dropped. Their requirements are carried into plans 217–219.
   - Task 5 wave 3 keeps only the oracle leg. The OM arms, the ontology arms, the panel calibration, the
     evasive-lure residual and the F4/Task 17 leg move to plans 217–222.
   - Rows the redesign replaces, or gives a producer to, get the Task 6 verdict `transferred`:
     - the `om.*` rows;
     - `write.om-promotion` and `write.session-consolidation`;
     - `lifecycle.verification`, `lifecycle.duplicate-merge` and `lifecycle.episode-merge`;
     - `delivery.working-memory`;
     - `kind.episode` and `kind.procedure`;
     - `retrieval.decay-per-kind`;
     - the `ontology.*` rows (to the wiki plan) except the safety-proven claim lint.
   - Task 5 closes on wave 1, which finished. Waves 2–3 are cancelled, and plan 210 runs no further paid work. Most wave 2 arms measured delivery, lifecycle and working-agent features that plans 219–221 rebuild; they transfer with their features. The Task 3.1 recall variants, aggregation/abstention and P3–P5 stay at their current defaults and are recorded `unmeasured`.
   - Task 8 is dropped. The slimmed product's hash and cache pin move into Task 7, and plan 223 Task 1's combined check bisects over plan 210's removals.
   - Tasks 9–11 (held-out acceptance, preset, defaults, claims, graduation, memory skills) move to plan 223.
2. **Plans 216 → 217 → 218 → 219 → 219.1 → 220 → 221 → 222 → 223** run strictly in order after plan 210.
   - Plans 217–221 each end with their own development screen (gates M-1 … M-5).
   - Plan 219.1, inserted on 2026-11-08 after the retrieval review, ends with gate M-T.
   - Plan 222 has the wiki's screen (K-1).
   - Plan 223 runs the combined check, the freeze, the one held-out acceptance, the defaults and claims, graduation
     and the skills.

| Plan | Delivers |
|---|---|
| 216 | Foundation: criteria pre-registered; the ontology extracted into the wiki; one memory package (moves); partial-use components; working kind and episode view retired |
| 217 | STM |
| 218 | Episode scope and WM |
| 219 | Rehearsal, stored episodic and semantic LTM writes (with retrieval cues), one recall surface, reconsolidation |
| 219.1 | Retrieval: one analyzer and scorer across stores, bounded activation, query cues, association index, recall modes, metamemory (§5.11) |
| 220 | Procedural memory, skill graduation, conditioned responses, priming, sensitization |
| 221 | Sleep |
| 222 | The wiki outside memory: its own surface over the final LTM, panel calibration and development screen (the ontology rows moved from plan 210) |
| 223 | Acceptance, defaults, claims, graduation, skills |

## 12. Decisions log

**Owner, 2026-11-08: the taxonomy.** STM, WM, Rehearsal and LTM (episodic and semantic declarative; procedural
non-declarative), with session and overnight rehearsal, in one memory system usable partially or fully.

**Owner, 2026-11-08: accepted recommendations.**

1. Name the component roles STM and WM, and record the honest analogy (§3).
2. Retire fabric's `working` kind so WM takes the name.
3. Make the ratios pressure, not guarantees, with protected items and `budget_unmet`.
4. Tombstone surface and delete only chunks, never the index.
5. Re-judge tombstones on a scope change.
6. Trigger on event boundaries as well as budgets; make episode end Rehearsal's main path.
7. Name the overnight pass "Sleep" and keep "Rehearsal" for the session pass (fabric's "consolidation" name is
   retired).
8. Keep provenance chains and trust-by-use for LTM writes.
9. Use salience signals.
10. Keep session surfaces cache-stable (compaction only).
11. Keep episodic immutable and semantic revisable.
12. Add the reconsolidation loop.
13. Make priming an activation state, not a store.
14. Model conditioned responses as escalate-only triggers with acquisition and extinction.
15. Add habituation and sensitization.
16. Have mature procedures graduate into skills.
17. Use one package with partial-use profiles.
18. Measure each tier separately, with pre-registered rows.

**Owner, 2026-11-08: the ontology leaves memory.** "Remove the ontology from inside memory. It should be part of the
wiki and not memory." Concepts, subject binding, concept-first recall and source ingest move to the wiki (§5.10).

**Owner, 2026-11-08: plan structure.**

- Plan 210's tasks that touch this design are dropped.
- Its paid runs are narrowed to what plan 210 develops.
- The moved gates are re-homed in plans 216–222, each with live efficacy runs.

**Owner, 2026-11-08: retrieval.** After a review of the retrieval path, the owner accepted its recommendations:

- write retrieval cues at Rehearsal;
- one analyzer and scorer across stores;
- one bounded activation score;
- query cues;
- an association index that is not an ontology;
- recall modes;
- calibrated confidence;
- evidence coverage reported beside accuracy at every QA row.

These are built in a new plan inserted between 219 and 220 (219.1, gate M-T, rows T1–T8), with retrieval kept
lexical (§5.11).

**Decided in plan 216 Task 1 (owner, 2026-11-08):** `@arnilo/prism-memory-system` (`packages/memory/system`), `@arnilo/prism-wiki` (`packages/knowledge/wiki`), and RAG renamed `@arnilo/prism-rag`.

## 13. References

**Cognitive science**

- Atkinson & Shiffrin (1968), the modal model.
- Baddeley & Hitch (1974) and Baddeley (2000), working memory and the episodic buffer.
- Cowan (1999), the embedded-processes model.
- Ericsson & Kintsch (1995), long-term working memory.
- Tulving (1972), episodic and semantic memory.
- Squire (2004), the declarative and non-declarative taxonomy (procedural, priming, classical conditioning,
  non-associative learning).
- Craik & Lockhart (1972), levels of processing (maintenance vs elaborative rehearsal).
- McClelland, McNaughton & O'Reilly (1995), complementary learning systems.
- Bjork & Bjork (1992), storage and retrieval strength, already in `fabric/src/lifecycle/strength.ts`.
- Nader et al. (2000), reconsolidation.
- Zacks et al. (2007), event segmentation.
- Tulving & Thomson (1973), encoding specificity; Godden & Baddeley (1975), context-dependent memory.
- Collins & Loftus (1975), spreading activation; Anderson (1974), the fan effect; Anderson & Schooler (1991), ACT-R
  base-level activation.
- Teyler & DiScenna (1986), hippocampal indexing theory; Howard & Kahana (2002), the temporal context model.
- Nelson & Narens (1990), metamemory; Koriat (1993), feeling of knowing; Johnson, Hashtroudi & Lindsay (1993), source
  monitoring.

**Retrieval**

- Robertson & Zaragoza (2009), BM25 and BM25F.
- Wu et al., LongMemEval (ICLR 2025): round-level values, fact-augmented keys, time-aware query expansion.
- Gutiérrez et al., HippoRAG (2024): personalised PageRank over an entity graph.
- Xu et al., A-MEM (2025): linked notes.
- Park et al., Generative Agents (2023): recency, importance and relevance.
- Asai et al., Self-RAG (2023); Yan et al., CRAG (2024): deciding whether retrieval sufficed.
- Carbonell & Goldstein (1998), MMR; Liu et al. (2023), lost in the middle.
- Nogueira et al. (2019), doc2query.

**Agent memory**

- LightMem, an Atkinson–Shiffrin pipeline with sleep-time update (arXiv 2510.18866, ICLR 2026).
- MemoryOS, short-, mid- and long-term tiers with heat-based promotion (arXiv 2506.06326).
- MIRIX, with core, episodic, semantic, procedural, resource and vault memories (arXiv 2507.07957).
- Letta, sleep-time compute (letta.com/blog/sleep-time-compute; arXiv 2504.13171).
- Hu et al., *Memory in the Age of AI Agents*, the forms, functions and dynamics taxonomy (arXiv 2512.13564).
- Nemori, event segmentation and predict-calibrate (arXiv 2508.03341).
- Memp, procedural memory (arXiv 2508.06433).
- Mem-α, RL-trained memory construction over core, episodic and semantic memory (arXiv 2509.25911).
- ACE, Agentic Context Engineering, on context collapse and brevity bias in iterative rewriting.
- CoALA, cognitive architectures for language agents.
