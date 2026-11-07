# @arnilo/prism-memory-fabric

> **Experimental in 0.13.0.** Install with `bun add @arnilo/prism-memory-fabric@experimental`. Outside the stability promise of the stable
> packages: its API, config, preset contents and defaults may change or be removed in any release until it graduates.
> Graduation is the memory track's final step, which sets the first stable version.

**Tier 1 of Prism's three-tier memory, and the only store of record.** Typed notes and verbatim exchanges live here;
[`@arnilo/prism-memory-observational`](../observational/README.md) (T0) observes the session and feeds this store's
candidate notes, and [`@arnilo/prism-memory-wiki`](../wiki/README.md) (T2, opt-in) consolidates them into cited
concepts. The other two tiers read and write through this package and keep nothing of their own; the
[example](../../../examples/three-tier-memory.ts) runs all three.

Working, semantic, and scoped memory for Prism agents: the `memory.view`, `memory.read`,
`memory.insert`, `memory.replace`, `memory.recall`, and `memory.forget` tools, a `context.build` block, and
per-session enablement. It is the native-package successor to the 0.12
`@arnilo/prism-memory/{fabric,scoped}` subpaths.

Install explicitly. This package is not included in profile bundles until a size/use review.

```bash
bun add @arnilo/prism-memory-fabric@experimental
```

## Usage

```ts
import memoryFabric from "@arnilo/prism-memory-fabric";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "openai/gpt-5",
  // Lexical (BM25) retrieval is the default and needs no embeddings package.
  packages: [memoryFabric({ tools: { root: "./memory" } })],
});
```

For a conversational assistant, one line selects the measured configuration (see
[Conversational preset](#conversational-preset); it archives exchange text, which is a storage decision):

```ts
packages: [memoryFabric({ preset: "conversational", tools: { root: "./memory" } })],
```

Add `retrieval: "hybrid"` and an embeddings package (`@arnilo/prism-memory-rag`) for the optional
vector leg:

```ts
packages: [
  memoryRag({ embeddings: { model: "openai/text-embedding-3-small" } }),
  memoryFabric({ retrieval: "hybrid", tools: { root: "./memory" } }),
],
```

The fabric is on for every session by default (`enabled: true`); `installing` the package is the
opt-in. Run the `memory` command to toggle it per session. Its tools are hidden from and
uncallable by a session where it is off.

## Private recall diagnostics

Direct SDK callers may pass `onRecall(event)` to `createMemoryFabric`. The callback receives the query/options, ranked valid candidate ids/scores before top-k and budget selection, and returned ids. It does not receive note bodies or change ranking. Observer exceptions are ignored. It is absent by default and adds no model or embedding call; enabling it adds callback and trace-storage overhead.

For the package, a host package may provide the optional `memory-fabric.diagnostics` service with the same callback before loading memory fabric. Queries can contain private user text: retain observations privately, never in public status logs. This observer measures retrieval candidates; inspect the actual model request to distinguish tool/passive rendering and truncation from candidate availability.

## Cost, security, and failure behavior

- Working memory makes no model call and no embedding call. It stores labeled blocks in the
  working-memory value and re-reads them on every request as the first block of the tail, after the transcript.
- Retrieval is **lexical by default** (`retrieval: "lexical"`): notes are searched with the store's
  lexical leg (in-memory term coverage, SQLite FTS5/BM25, Postgres full-text). No embeddings
  package is needed, and the default makes **no embedding call**.
- `retrieval: "hybrid"` adds the vector leg through the `embeddings` service: **one embedding call
  per write and per recall**. Without a service the fabric notes the fallback and stays lexical.
- The memory directory (below) makes no model or embedding call: one aggregate query per session epoch, at most 500 tokens in the prefix (200 by default).
- The standing rules (below) make no model or embedding call either: one metadata `scanMetadata` page
  per scope at session start, compaction, retraction or explicit refresh, at most `rules.maxTokens`
  in the prefix (600 by default, 2,000 when `rules.capture` is on, hard 3,000). Turns between rebuilds
  reuse the cached block, so a stable session sends byte-identical bytes.
- Path cues (above) make no model or embedding call: after a new touched path, one metadata scan
  (cached until a write changes the index) plus one bounded `get` for the matched text, at most
  `cues.budgetTokens` in the tail (300 by default). A turn with no new path does no work.
- The team store (below) is one extra markdown store opened at setup, when `.prism/memory/` exists:
  one bounded reconcile plus one trust scan of its notes, and one extra query per recall. No model
  call and no embedding call; writes happen only through `memory:share`, after a person approves.
- The exchange archive (below) is off by default and costs **one local fabric write per completed
  turn** (several only when a turn is long enough to split), plus one branch read for the pair. No
  model call, no embedding call in lexical mode, and no added store query: the write runs in
  `session.background` after the reply is stored. Storage grows by about one turn's text per turn, so
  the default is off. `DEFAULT_RECALL_KINDS` includes `exchange`, so an opted-in archive makes passive
  delivery longer by the history it recalls (facts are delivered first, then exchanges).
  `exchanges: { steps: true }` adds a bounded step trace to each exchange: at most `exchanges.maxSteps`
  (24) lines, capped at a quarter of the entry limit (about 1.5 KB at 24 typical steps, so roughly
  1.5 MB per 1,000 turns that each ran 24 tools; a turn with no tool round adds nothing). Same write,
  no extra query, no model call.
- Lessons (below) add no write path of their own: the agent writes one with `memory.insert` in its
  turn, and each `evidence` id costs one `getEntry` per active scope. The opt-in nudge
  (`lessons: { nudge: true }`) adds one branch read per completed turn, pattern matching with no
  model call, and one tail line (about 50 tokens) on the request after a signal turn only.
- Session consolidation (below) is off by default and costs **one model call per pass**, only when a
  pass runs; new notes embed once each in hybrid mode (plus one decider call when
  `consolidate.decider` is `"model"`). Verifying a candidate and archiving a stale one are metadata
  updates with no embedding or model call. A turn with no new session material starts no pass.
- **Maintenance** (below) is metadata-only and makes **no model call** unless
  `lifecycle.merge.episodes` is on: then it is one call per episode cluster, and only for scopes that
  are over their capacity budget. `fabric.maintain()` reads one `scanMetadata` page set per scope
  plus one `get` batch for the text it may rewrite; duplicate merging and eviction make no calls.
- The opt-in `linker` and `evolution` workers add embedding calls on writes in hybrid mode. They
  use deterministic rules and make no model call. Both remain experimental: the lifecycle
  campaign has not established a task-success benefit. Consolidation is part of the write path and is on by default.
- Every state write is one store entry and counts toward compaction thresholds; the package writes
  on toggle, not per event. `store.postgres.connection` is a ref-only secret; a literal fails
  validation, and a resolved value is never echoed.
- **Widening is replication-gated and value-exact.** A note reaches the `agent` scope only after it
  is verified and an independently written, readable note in a second project carries the **same
  normalized text**; it arrives as a candidate that has to earn its own uses there. A shared `key` is
  not evidence of agreement: any readable note with a different value blocks the whole subject, and
  case/whitespace folding never ignores numbers, negation or resource names. Notes naming their
  project are project-bound, metadata-only notes never witness agreement, and copies citing the same
  source are one witness. Model tools cannot write `agent` directly: `memory.insert` with
  `scope: "agent"` from a project session fails with `agent_scope_requires_widening`; only the normal
  widening write (or a trusted host write) creates an agent note. Two independent projects that agree
  on the same *wrong* lesson can still widen it — the trust scan and `log.md` audit remain the
  backstop.
- **Provenance and poisoning.** Every durable write stamps `generated: { by, at }` — `agent` (with
  the session id), `promotion` (with the reflection and evidence ids), `human` (an external edit
  found by reconcile), `import`, or `host` — and `log.md` records the actor on each line. Reconcile
  runs `scanScopedMemoryContent` once per externally changed file: a hit sets `status: candidate`
  with `flags: [<class>]`, rewrites the note, and logs `flagged`. A flagged note is never injected
  passively and `memory.recall` renders it `[flagged: <class>]`; only `memory.replace` or a clean
  human edit lifts it. The scan is content-only and heuristic: it quarantines, it does not prove
  safety. Audit memory with `log.md` and `git diff` (MINJA, arXiv 2503.03704).
  `memory.forget` removes a purged id from every survivor's `links`; a later read or export never
  exposes a dangling edge, and derived lineage rows are removed by the existing lineage walk.

## Consolidation

The default makes no model calls. Same normalized text updates a same-kind note in place;
different text keeps both notes and adds a `similar` link when the active mode's similarity meets
`consolidate.threshold` (default `0.85`): term-set Dice between the two notes in lexical mode,
pre-fusion cosine in hybrid mode. The Dice reading of `0.85` is a tuning default
and may change in a minor version. File notes continue to refresh the same path in place;
different paths remain separate. Recall explain rows include the stored links.

Retirement requires an explicit `supersedes` id or an opt-in model decision. Explicit supersession
requires an accessible fabric note in the current scope and preserves its metadata while setting
`validTo`. `memory.replace`/`correct()` provide explicit corrections.

| Mode | Extra model calls per indexed write |
| --- | --- |
| Default consolidation or `consolidate: false` | 0 |
| `consolidate: { decider: "model", model?: "provider/model" }` | 1 when a candidate meets the threshold; otherwise 0 |

The decider sees the new text and up to five same-kind candidates above the threshold, through
one schema-declared tool: `ADD`, `UPDATE <id>`, `SUPERSEDE <id>`, or `NOOP`. Only shown ids may be
changed. `NOOP` returns the existing nearest note without writing. Invalid, oversized, or failed
decisions preserve both notes with a `similar` link and add one status warning per session.
An aborted write still aborts. An omitted model uses the agent's configured model. The package
statically declares `models` for this optional path; model clients are resolved only on eligible
writes, so the default does no model work.

For direct `createMemoryFabric` use, provide `resolveModelClient` when enabling the decider and
pass the same `redactor`/`secrets` used by `createMemory`. `workerLimits` bounds model messages,
arguments, and results; `MemoryFabricWriteOptions.sessionId` scopes fallback warnings.

### Consolidation: signals

`gatherConsolidationCandidates(entries, { cursor, maxCandidates, maxTextChars, patterns, redact })`
is the first step of a session consolidation pass, and the only one that makes no model call. It is a
pure function over `session.entries()` output: it reads what observational memory already keeps plus
the signals in the transcript itself, and returns ordered candidates
`{ source, text, evidenceIds, signals }` for the extractor to interpret.

| Source | Read from | Signal |
| --- | --- | --- |
| `explicit` | user messages matching `patterns.explicit`; the matched sentence only | `explicit: 1` |
| `correction` | user messages matching `patterns.correction` when the preceding turn is the assistant's; carries the corrected entry id and the note ids cited in that turn | `correction: 1` |
| `decision` | `MemoryTaskState.decisions` in `om.task_state.recorded` records after the cursor | — |
| `observation` | observations rated `high` or `critical` (`critical` first) | — |
| `reflection` | reflections no later record superseded | — |
| `exchange` | not-yet-consolidated archived exchanges, read through scoped recall with the session tail as the query | `explicit: 1` support when the extractor's note cites it |

An **exchange** candidate is added by the pass, not by `gatherConsolidationCandidates`: when
`exchanges` is enabled, `createMemoryFabric().consolidate()` recalls archived exchanges that no pass
has read yet (metadata `consolidatedAt` absent), scope-tagged, capped by the same `maxCandidates`
budget as the transcript candidates and at `maxTextChars` each, and marks them read once the pass
returns. Its evidence id is the exchange note id and its `tRef` is the exchange's. Measured facts then
carry `links: [{ id, relation: "evidence" }]` to the exchanges behind them, so the fact is the index
and the exchange is the verbatim detail; an exchange outside the note's readable scopes is never
linked.

`patterns` defaults to the exported `CONSOLIDATION_PATTERNS`:

- **explicit**: `remember`, `always`, `never`, `don't`, `do not`, `I prefer`, `from now on`, `make sure to`.
- **correction**: `no,`, `that's wrong`, `actually`, `instead`, `not what I`, `you should have`.
- **outcomes**: `bun test`, `npm test`, `pytest`, `cargo test`, `go test`, `git commit`.

An **outcome** (`outcome: 1`) is not a candidate of its own: a tool result without an error flag
whose call matched `patterns.outcomes`, or an approval grant (`decision.resolved` with `allow`), tags
the candidates whose evidence lies in the same run. Candidates come out in priority order (explicit,
correction, decision, observation, reflection), at most `maxCandidates` (default 48), each capped at
`maxTextChars` (default `memory.limits.maxEntryTextChars`).

The `cursor` is the last entry id a previous pass covered, so a pass reads only new material and
gathering is idempotent for the same cursor. Security: assistant text is never an `explicit`
candidate (the agent cannot promote its own claims as user instructions), tool output is never a
candidate text, and persisted entries are redacted already; `redact` is the second pass for a host
with its own secrets.

### Consolidation: the extractor

`extractConsolidationNotes({ client, candidates, segments, recallExisting, limits, redactor, secrets })`
is the second step of a pass and the only one that calls a model: **one call for a valid answer, or
two only after one bounded repair**, made through the shared worker loop with a single schema-declared
tool, `record_notes`. The schema in `consolidation/prompts.ts` is the one source for the tool
definition and for parsing. The schema's id fields and kind choices stay constant across sessions;
the runtime parser checks that evidence (`c1`, `c2`, ...), contradiction and episode segment ids
were shown in this pass. An episode without a shown segment is rejected; a `path` note requires
`applies_to`, regardless of how much conditional JSON Schema the provider honours.

The prompt carries the candidates, up to 12 active notes per scope from `recallExisting` (lexical,
over the candidate text), and the session's task segments. It asks for one atomic, self-contained,
typed note each — `fact`, `procedure`, `preference` or `episode` — with a proposed scope, keys and
aliases, evidence ids, generality and ephemerality, and the precision-first scope rule: the narrowest
scope that stays true, never wider than the evidence.

Two system prompts share those rules. `CONSOLIDATION_EXTRACT_SYSTEM` is domain-neutral ("an agent's
session"); `CONSOLIDATION_EXTRACT_SYSTEM_PROJECT` adds the repository and derivability rules and is
used only when a project scope with a declared root is active, so a coding session keeps its
repository rules while a host without a project is not asked for them. Both add the general
fact rules: a specific fact the user stated (a possession, event, date, count, name, plan or changed
value) is durable; `tRef` carries the instant when the evidence has one, and an event with no time of
its own takes the date of the candidate it came from; and `key` names one changeable attribute — a
value a later statement replaces — so a later value supersedes the earlier one instead of piling up
next to it. `tRef` is validated as an ISO 8601 timestamp and stored on the note; a keyed note whose
`tRef` is later than the shown note with the same kind, scope and key supersedes it through the write
path (`supersedes`), so one current value stays current.

Conversational history needs three rules on top of that (plan 188.10 Task 6), and they are prompt
text only: no new note kind, no new field. **One fact per instance** — each event, purchase, visit,
trip, item or person the user mentions is its own note, even when several share a category.
**Keys are for attributes, never instances** — two visits never share a key; an instance takes no key,
or one unique to it (`trip.2023-05-kyoto`), so both stay active and a count across them stays
answerable. A count the user states ("I have 3 bikes") is an attribute; the bikes are instances.
**Category keywords** — every fact carries 2–4 generic words someone would search for ("doctor",
"health", "appointment" for a visit to a dermatologist), while specific names and synonyms go in
`aliases`. Both reach the lexical index (aliases merge into `keywords` on write, weighted above the
body), so "which doctors did I see" finds a note that only says "dermatologist" — which is what makes
cross-session aggregation work without a read-time model call.

- **`agent` scope is downgraded to `project`.** Only the widening pass writes agent-scope notes from
  promotions. An explicit user statement may target `user`.
- **Episodes** are one per task segment (the span between OM task-state goal changes), at most 280
  characters. A second episode for a shown segment fails the answer.
- **Derivability** (project prompt only): anything a reader can derive from `AGENTS.md`,
  `README.md`, `package.json` or the code is not a note.
- **Fail closed**: a malformed answer — invalid shape, an unknown kind or scope, an evidence or
  `contradicts` id that was not shown, more notes than the pass allows, an oversize item — is
  rejected whole. A shape-only failure gets **one** repair call with a safe `reasonCode` and the same
  shown ids; a second invalid answer, an invented id, an unsafe scope, a trust/secret rejection, an
  abort or a worker limit never becomes accepted through repair. The pass then fails with a
  `reasonCode` and call counts (`modelCalls`, `correctionCalls`), writes nothing and keeps its cursor,
  so the material is retried on the next trigger. An aborted call aborts the pass itself.
- **Truncation is its own reason.** A turn that stops on the output limit (`max_output_tokens`) without
  a valid `record_notes` call fails as `output_truncated`, which is repaired once: the repair asks for
  fewer, shorter notes over the same evidence. A second truncation fails the pass. Raising
  `promote.maxOutputTokens` is the fix for losing a long session's facts this way.
- **Per-item rejection**: the trust scan (`scanScopedMemoryContent`) and the secret redactor run on
  every output text, keyword and alias. A flagged or secret-bearing note is dropped and counted as
  `rejected.trust` / `rejected.secret` instead of failing the whole answer.

Cost: one model call per valid pass; a malformed answer costs at most one additional call; exchanges
join that same call rather than adding one. Input is bounded by `maxCandidates × maxTextChars` plus
at most 48 existing-note snippets (240 characters each), all measured against `workerLimits` before it
is sent — the `maxCandidates` budget is shared by transcript and exchange candidates, so enabling
`exchanges` widens a pass's input only up to that ceiling. `promote` off or `exchanges` off avoids the
exchange share entirely. The pass report counts the actual
`modelCalls` and `correctionCalls`, so a repair is attributable, plus `failures` (a tally by
`reasonCode`) and `outputLimited` (calls that stopped on the output limit), which `memory:status`
reads back. The client is resolved by the caller only when a pass runs, so loading the package
resolves none.

Extractor calls share the provider cache key `prism-fabric-extract:default` (domain-neutral) or
`prism-fabric-extract:project` (repository rules), while retaining `sessionId` for attribution.
Only the constant system prompt and tool schema form the shared prefix; candidates, existing
notes and segments stay in the per-session user message. Savings are bounded by that prefix
(roughly 800 system tokens plus the schema, about 1,300 tokens combined with GPT-4.1's tokenizer),
at the route's cache-read discount. They are not a percentage of session cost. Cache eligibility
and hits depend on the route's minimum prefix, routing and retention; this adds no model call.
Different configured note caps can produce different schemas.

Two host knobs tune that one call:

- **`promote.maxOutputTokens`** (integer 256–32,768) re-resolves the extractor's client with
  `parameters.maxTokens = min(maxOutputTokens, model.limits.maxOutputTokens)`, the same rule
  compaction uses. Absent, the model's own parameters apply unchanged. 48 notes do not fit a solver's
  4,096-token answer budget; this is a write-side cost, never the answer's.
- **`promote.thinkingLevel`** (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) is passed to
  the worker loop. Absent, the model's default applies. Reasoning before one large structured answer
  is where truncation hides, so a level is cheaper than a repair.

**Measured overhead** (5 development multi-session haystacks, real prompt builder, offline): the
extractor prompt is ~44 kB with an empty store and ~58 kB with the worst case the constants allow (48
existing notes at the 240-character cap). By part: system 2,845 B, schema 1,621–2,156 B, existing
notes 0–13,383 B, the session's own candidates 39,179 B, segments 0–437 B. The candidates dominate
(~89%), so the harness is a bounded minority and no trim of the existing-note or schema share was
justified. A fixture in `__tests__/extractor-budget.test.ts` pins the parts, so a later overhead
regression fails a test instead of a paid run.

### Consolidation: scoring and the gate

`scorePromotion(note, context)` decides deterministically whether an extracted note is worth writing.
No model call: every term comes from the extractor's answer or from lexical analysis of the note,
its evidence, and the repository's own documents.

```
score = explicit + correction + outcome·0.5 + recurrence·0.5 + generality·0.5
      − ephemerality − derivability − duplicate·0.5
```

A note is accepted when `score ≥ minScore` (default 0.5). The weights (`promote.weights`) and
`minScore` are **tuning defaults** that may change in a minor version; the default weights live in
`promote.ts`.

| Signal | Meaning |
| --- | --- |
| `explicit` | The user said it directly. Requires an `explicit` (or archived `exchange`, which is verbatim user speech) candidate in the note's evidence; without one the flag is cleared. Never rejected for score. |
| `correction` | The user corrected the agent, and a `correction` candidate supports the note. |
| `outcome` | An outcome tag (a passing test run, a commit, an approval) covers the note's evidence. |
| `recurrence` | `log2(1 + distinct sessions)`, normalised to reach 1 at four distinct sessions and capped there. Repeats inside one session add nothing. |
| `generality` | From the extractor: how broadly the note holds. |
| `ephemerality` | From the extractor, raised to 1 when the text carries a line reference (`:42`), a temp path (`/tmp/` or the scratch directory), a commit hash (7+ hex), a branch name, or a date the note would outlive (a note that states its own `since`/`until`/`as of` bound is durable). |
| `derivability` | 1 when the extractor flags it, or when the note's terms are ≥ 0.9 lexically covered by a `derivableFrom` file. |
| `duplicate` | The highest Dice with an active note **of the same kind in the target scope**. |

Rejection carries one reason code, which `memory:status` reports:

- `ephemeral` — `ephemerality = 1` and the note is not explicit.
- `derivable` — the repository already records it; rejects even an explicit statement.
- `score` — under `minScore`.

Secrets and the trust scan are the extractor's rejections, not this gate's. `loadDerivableSources(root,
files)` reads `derivableFrom` once per pass through the fabric file jail: inside the project root, each
file capped at 64 KiB, with `../` and absolute escapes, symlink escapes, and unreadable files skipped
and reported as `{ path, reason }` instead of trusted.

## Config

```ts
memoryFabric({
  preset: "conversational", // default none; expands first, explicit fields below replace the preset's value
  enabled: true, // default
  retrieval: "lexical", // default; "hybrid" adds the embeddings leg
  semantic: true, // default; whether indexed notes are available
  inject: false, // default; opt in with { query: "task" } → minSimilarity 0.2, minScore 0.2, fullTextScore 0.35, cardExcerpt "head", topK 12, budgetTokens 4000
  directory: true, // default when semantic or tools.root is set; or { maxTopics: 8, maxFiles: 10, maxTokens: 200, stopWords: false }
  rules: true, // default; or { capture: "off", maxTokens: 600, scopes: ["user", "project"], kinds: ["fact", "preference", "procedure", "decision"] }
  cues: true, // default; or { budgetTokens: 300, maxPerTurn: 2 }
  team: false, // default; or { dir: ".prism/memory", write: "ask" } — the checked-in team store
  scopes: {
    tenantId: "prism",
    user: true,
    agent: true,
    project: { root: "." },
    // Additive priors after RRF; each in [0, 0.5]. Defaults shown.
    priors: { path: 0.15, project: 0.1, team: 0.075, agent: 0.05, user: 0 },
  },
  store: "markdown", // default when tools.root is set: the notes/ tree under the root
  // Alternatives: { markdown: { dir: "notes" } }, { sqlite: { path: ".prism-memory.sqlite" } },
  // { postgres: { connection: "env:PRISM_PG_URL" } }, or "memory"
  tools: { root: "./memory", maxFileBytes: 50_000 },
  scoped: { scopeRoot: "./scopes", policy: { activation: { minSimilarity: 0.35 } } },
  limits: { rebuildBatchSize: 100, rebuildMs: 30_000 },
  workingMemoryTemplate: "Name: {{name}}",
  consolidate: true | { threshold: 0.85, decider: "model", model: "hyper/<id>" },
  linker: false | { enabled: true, topK: 3 },
  evolution: false | { enabled: true, maxPatches: 4 },
  passive: false,
  // The exchange archive: off by default; {} archives each completed user turn verbatim.
  exchanges: false | { enabled: true, steps: false, maxSteps: 24 },
  // Cited lessons (plan 209 Task 4): the opt-in nudge needs the exchange archive.
  lessons: { nudge: false, minTurnsBetweenNudges: 5, archiveAfterSessions: 20 },
  // The ontology tier's write-path knob (plan 207). Nothing here turns the tier on: concepts do.
  ontology: {
    bindThreshold: 2, // matched tokens of one subject name that bind a new note; in [1, 8]
    conceptPrior: 0.1, // added to a concept hit's score after fusion; in [0, 0.5]
    maxClaimsRendered: 8, // claims one concept hit shows in memory.recall; in [1, 32]
  },
  // Verification by use across separate sessions (a citation is a use, a retrieval is not).
  lifecycle: {
    verifyAfterSessions: 2,
    // Retrieval-strength decay per kind; higher forgets faster. Tuning defaults.
    decay: { episode: 0.8, fact: 0.4, procedure: 0.4, preference: 0.2, decision: 0.2, exchange: 0.5 },
    // Storage-strength coefficients of `explicit + sessions·log(1+useSessions) + helpful − harmful + outcome`.
    storageWeights: { explicit: 1, sessions: 0.5, helpful: 0.5, harmful: 1, outcome: 0.5 },
    // Recall priors `w_R·σ(R) + w_S·σ(S)`; each in [0, 0.5], default 0.05.
    recall: { retrieval: 0.05, storage: 0.05 },
    // Archive needs both strengths below the threshold, past the grace window.
    archive: { retrievalBelow: -2, storageBelow: 1, graceSessions: 10 },
    // Per-scope budgets; a path note spends the project budget. Tuning defaults.
    capacity: { user: { notes: 200, tokens: 20_000 }, agent: { notes: 200, tokens: 20_000 }, project: { notes: 500, tokens: 60_000 } },
    // Raw history has its own size-only tier; excess exchanges are demoted, never deleted.
    exchangeCapacity: { hotTokens: 200_000 },
    // Duplicates always fold; episode clusters only when `episodes` is set (one model call each).
    merge: { duplicateDice: 0.8, episodes: { minCluster: 5, model: "hyper/<id>" } },
    // A lesson verified in two projects may live at `agent`; two projects contradicting a wider
    // note supersede it. `minProjects` cannot go below 2.
    widen: { minProjects: 2, minSiblings: 2, contradictionsToSupersede: 2 },
  },
  // Off by default. An object enables session consolidation and its extractor pass.
  promote: {
    model: "hyper/<id>", // default: the agent's model
    minScore: 0.5, // tuning default
    minTurnsBetween: 8,
    maxCandidates: 48,
    derivableFrom: ["AGENTS.md", "README.md", "package.json", "CLAUDE.md"],
    maxOutputTokens: 8192, // default absent: the model's own parameters; capped by its limit
    thinkingLevel: "low", // default absent: the model's default
  },
  // Off by default. An object enables one model call per explicit `memory.recall`.
  state: false | { model: "hyper/<id>" },
  // Off by default. Needs a decisions-capable model; absent leaves every incumbent path unchanged.
  decisions: false | { model: "liquid-local/d1-3B", points: ["P1", "P3", "P4", "P5", "P6"] },
});
```

`store.postgres.connection` is a ref (`env:` or `keyring:`) resolved through
`prism.credentials.resolve`; a literal fails config validation. `pg` is loaded only when a
Postgres store is configured.

With `tools.root`, both working blocks and semantic notes persist in the **markdown store** at
`<tools.root>/notes` by default: one OKF note file per note under `<tenant>/<resource-path>/`, a
derived SQLite index at `notes/.index.sqlite`, control state at `notes/<tenant>/<resource-path>/.state.json`,
and the browsable `notes/index.md` / `notes/log.md` audit files. The files are canonical and the index
is rebuildable, so the agent can browse the tree with `memory.view` / `memory.read` and a person can
read and edit it directly. `store.markdown.dir` (default `notes`) resolves against `tools.root`; a path
outside it (including a symlink escape) is rejected. The startup file reconcile and the directory walk
never treat `notes/**` as user files. The `memory:reindex` command rebuilds the derived index from the
files and reports `indexed`, `removed`, and `malformed` counts; pass `{ full: true }` to re-read every
file. Postgres persists both stores; its existing optional `table` setting still selects the vector
table. Agent disposal closes stores after any pending reconcile.

The measured markdown operating envelope is **up to 10k small notes for mixed local read/write
workloads**. The 2026-11-02 run measured warm open 309 ms, p95 lexical recall 0.93 ms and p95 write
36.6 ms at 10k. At 50k, warm open was 1,559 ms, p95 recall 4.39 ms and p95 write 217.4 ms, so 50k is a
measured read-heavy stress point, not the mixed-workload recommendation. Switch to SQLite or Postgres
above 50k, for concurrent/server writers, or when 200 ms writes matter. The separate exchange envelope
is p95 recall **1.06 ms on SQLite and 4.15 ms on Postgres at 100k exchanges** (200 queries, isolated
throwaway schema). These are single-run tmpfs/local-container measurements; validate durable storage
before adopting the envelope. Cold rebuilds can require additional incremental reconciliation passes
before all notes are searchable. See the
[markdown scale evidence](../../../docs/_evidence/memory-markdown-scale-0.13.0.md) and
[exchange scale evidence](../../../docs/_evidence/memory-bench/202/exchange-scale.md).

`{ sqlite: { path } }` and `{ postgres }` stay available but are **not inspectable without
`memory:export`** (plan 188.1 Task 7): they hold rows, not browsable files. Relative SQLite paths
resolve against `tools.root`; paths outside it are rejected. Without a root the default is `"memory"`,
with a warning that memory is lost on process exit. Explicit `store: "memory"` avoids database writes
(file tools still write the files you request).

Startup schedules one background reconcile through the file jail, bounded by
`limits.rebuildBatchSize` and `limits.rebuildMs`. It compares SHA-256 hashes stored on file notes,
re-embeds each changed or new file once in hybrid mode, and forgets notes whose file is missing.
Unchanged files cost no embeddings; no model calls are made. The first context build waits for this
bounded pass. The markdown store's own tree (`notes/**`), the SQLite store file and sidecars,
symlinks, empty files, and files over `maxFileBytes` are skipped. Large directories/indexes can
require an explicit rebuild: the pass
reads at most one index page and visits at most `rebuildBatchSize` entries (directory listings cap
at 200). An incomplete listing is never treated as evidence of deletion. In lexical mode reconcile
indexes no embeddings; in hybrid mode a not-yet-available embeddings service is skipped and picked
up on the next pass. Working memory remains available either way.

## Scopes

`scopes` names the levels the fabric reads and writes; a note's resource tells which level it came
from. Levels are resolved narrowest first:

```ts
memoryFabric({
  scopes: {
    tenantId: "prism", // default
    user: true, // default: user-wide preferences -> notes/<tenant>/user/
    agent: true, // default: lessons proven across projects -> notes/<tenant>/agent/
    project: { root: "." }, // default on: notes/<tenant>/projects/<slug>--<id8>/
  },
});
```

The project resource id is `<slug>--<id8>`: a lowercased repository or directory slug plus the first
8 hex characters of SHA-256 over the identity source. The source is the git remote URL (`origin`
preferred), normalised with the scheme, credentials, and trailing `.git` removed and the host
lowercased. Without a remote it is the real path of the git top level, else the real path of the
root. A worktree shares the remote and therefore the id; a moved checkout keeps it too. Reads only:
no `git` subprocess is spawned.

`projects/<slug>--<id8>/project.md` is an OKF `project` concept written on the first setup and
updated under the store lock. It records the identity source and every real root seen, so a move or
a worktree adds a line without splitting memory. Roots are paths, not secrets; credentials are never
written.

`project.id` overrides detection for servers whose projects are not git checkouts and must match
`^[a-z0-9-]{1,40}--[0-9a-f]{8}$`. An invalid id or an unresolvable root disables the project scope
with one `status.note("warn")` and leaves user and agent active; enabling no level at all fails
config validation. The old `scope` key (tenant/resource/thread) is retired with no alias; the thread
id is fixed per memory instance (`default`) and a session id is provenance, not a scope.

### Write scopes

| Kind | Default scope | Stored under |
| --- | --- | --- |
| `fact`, `procedure`, `episode`, `file` | `project` | `notes/<tenant>/projects/<slug>--<id8>/<dir>/` |
| `preference` | `user` | `notes/<tenant>/user/preferences/` |

`remember` and `memory.insert` accept `scope` (`user | agent | project | path`), `appliesTo`, and
`key`. `team` is never a write scope for a tool: those notes come from `memory:share` (below). `path` notes live in the project resource and carry 1–8 globs relative to the project root
(no absolute path, no `..` segment, no NUL); they apply only where a touched path matches. `key`
(`[a-z0-9.-]{1,64}`) is the stable subject id used for shadowing and widening. A write to a scope
that is not active fails with `scope <x> is not active`. A note's OKF file records the level under
`prism.scope.level` and the globs as `applies_to:`.

Ids are addresses across scopes: `memory.replace`, `memory.forget`, `fabric.verify`, and
`fabric.forget` find the note in `path`/`project` → `agent` → `user` order, one store read per
scope. Superseding a note that lives in another scope is refused (`MemoryScopeError`); narrow a
note instead of replacing one from a wider scope.

### Recall across scopes

Recall queries every active scope through that scope's own `Memory`, so consent, invalidation, and
share-grant rules still apply per scope. The per-scope rankings are fused with RRF (`fuseRankings`),
then two bounded priors are added: `score + priors[level] + w_R·σ(R) + w_S·σ(S)` (scope defaults path
0.15, project 0.10, team 0.075, agent 0.05, user 0, each in `[0, 0.5]`; strength weights 0.05 each, in
`[0, 0.5]`).
`R` is ACT-R base-level activation over the note's use log in scope sessions, `S` is accumulated
evidence (explicit, sessions used, helpful, harmful, outcome tag), and `σ` is the logistic function.
Both priors are bounded by their weights, so relevance keeps the final word. The floor
(`minSimilarity`) applies per hit before the priors. A `path` note earns the path prior only when one of its `applies_to` globs matches a path
the session touched via `read`, `edit`, or `write`; otherwise it ranks as a project note. Touched
paths are kept workspace-relative, newest first, capped at 256, and persisted once per turn only
when the set changes.

When two hits share a `key`, only the narrower scope's hit is returned (`path` > `project` >
`team` > `agent` > `user`); the wider hit appears in `explain` with `shadowedBy`. Recall results reserve at
least one slot per scope that has a hit, then fill by rank within the token budget, so a project
note cannot crowd out user and agent memory. `memory.recall`, passive injection, and the scoped
policy all use this path, and every rendered hit starts `[id] <level> [kind] <date>`.

The one active scope case skips fusion and priors: it keeps the mode's own similarity score.

Archived notes are not part of that ranking: `includeArchived`, or a weak best active hit, appends up
to three of them after the active hits, marked `[archived]` (see the lifecycle section).

Isolation is structural: every read and write is bound to a resource id, so a session rooted in
project A cannot see project B's notes even when both use the same store file or tree. The
parameterised isolation suite runs on the in-memory, SQLite, and markdown stores and in the
Postgres integration suite; it also proves that user preferences and agent notes stay shared and
that forgetting project A's note leaves project B untouched.

## Delivery tiers

Memory reaches the model in three tiers (plan 188.5). A cue matching the context a note was encoded
in brings it back, so each tier is triggered by the most specific cue available and the cheap,
always-present tier stays small:

| Tier | Block | Where | Changes when | Cost per turn |
| --- | --- | --- | --- | --- |
| Standing rules | `fabric-rules` | prompt prefix | session start, compaction, retraction, refresh | zero after the first cached turn |
| Path cues | `fabric-semantic` tail | tail | a file tool touches a path for the first time in the session | tokens only on the turn a new path matches; none otherwise |
| Directory | `fabric-directory` | prompt prefix | the same as the rules | one aggregate query per rebuild |
| On demand | — | `memory.recall` | — | normal recall plus one local lexical discovery query per active scope only when default kinds return zero hits |

Two properties hold the cost down, and `packages/memory/fabric/src/__tests__/prefix-stability.test.ts`
pins the first one: a quiet turn sends byte-identical prefix blocks (the directory and the rules), so a
provider's prompt cache hits instead of re-ingesting them; and path cues add no lines on a turn that touches no new path.

The team store (below) is a scope, not a tier: it joins recall and injection like `project` and
`agent`, and adds no block of its own.

### Standing rules

The standing rules are the small, human-editable centre of the memory: a slice of long-term memory
that is always loaded, one line per rule as `[id] text`, user-scope rules first:

```text
Standing rules (user): [41aa…] Prefers bun over npm. [77b0…] Uses fish shell.
Standing rules (project prism): [9c1e…] Run memory suites with --timeout=0. …
rules: 12 shown, 3 more — memory.recall
```

Only `preference`, `fact`, `procedure`, and `decision` notes enter, and only when they are **verified**,
not archived, not flagged, and still readable — a revoked or forgotten note never appears. A
decision must also be `active`: proposed and superseded decisions stay readable through explicit
recall but never reach the prefix. A decision line ends `— why: memory.read <id>`, so the rationale
is one read away. A path-scoped rule (`scope: "path"`) is not in the block: it loads as a cue when a
touched file matches (see Path cues). The block sits after the directory block, stays inside the
untrusted envelope, and its text passes the redactor.

**Budget and overflow.** `rules.maxTokens` is the fixed budget: 600 by default, **2,000 when
`rules.capture` is `"confirm"`** (a captured rule set earns the larger block), hard 3,000. The
budget splits evenly across scopes and unused budget flows to the other scope. Order is human-written
rules first (a person's line in `rules.md`), then pinned, standing decisions, and descending storage
strength `S`; ties break by note id, so the selection is deterministic. A rule that does not fit
drops from the always-loaded block, stays recallable, and the block ends `rules: N shown, k more —
memory.recall`. A human-written rule is never dropped for an agent's; when human rules alone exceed
the budget, `memory:status` warns and names the count.

`rules: false` turns it off; `{ capture, maxTokens, scopes, kinds }` configures it (scopes
`["user", "project"]` by default, and `user` always renders first; kinds default to fact, preference,
procedure and decision).

**Capture** (`rules: { capture: "confirm" }`, default `"off"`; the `coding` preset sets it). A user
turn with a lasting cue becomes a **proposed** rule: a preference (`I prefer…`, `I'd rather…`) in the
user scope, a procedure (`make sure to…`, `whenever you…`, `before you commit…`) in the project, or a
decision (`from now on`, `always`, `never`, `we decided`, `use X instead of Y`, `no, do X`) with a
lexical rationale. A path in the rule (`in src/payments`) makes it path-scoped. No model is called.
The only capture input is the archived user turn, so capture needs the exchange archive (`exchanges`; both
presets turn it on); without it nothing is captured and setup leaves a warning status note. Tool output and assistant text never become rules,
and every proposal passes the trust scan. One batched `host.ui` confirmation per turn makes the
proposal active and pinned; a host that answers `unavailable`, denies, dismisses or throws leaves it a
`candidate`. A correction that names what it replaces (`use zod instead of yup`) retires the matching
active rule: the old note keeps its history with `validTo` set and is never delivered again.

**Cache stability.** Directory and rules blocks are pinned per session epoch and reused byte for
byte across additive writes, including exchange archiving, inserts and lifecycle evidence updates.
An epoch starts at the first context build (including restore), compaction, a retraction, or an
explicit import/export/reindex refresh. Each start re-reads the stores and invalidates the directory,
rules and cue-index caches, so external additions — and a person's `rules.md` edit — appear at the
next epoch boundary. Retractions through this memory instance (forget, revoke, correct, invalidation,
retention, or metadata that retires/quarantines a note) rebuild on the next request. Retractions made
by another process over the same store do the same: each build re-reads only the rule notes the pinned
prefix shows with one bounded `memory.get` per scope, so another process's additions never break the
cache, while a forgotten, revoked or retired note leaves the next request. If that read fails, the
rules block is left out of that request rather than resent stale, and returns once the store answers.
Notes written mid-session remain reachable through recall, passive tail injection and path cues until
the next epoch. Working memory is read on every request and delivered at the head of the tail after the
transcript, so its updates are visible on the next tool follow-up without changing the prefix.

The rules carry no timestamp and make no model call: one metadata `scanMetadata` page per scope,
plus bounded reads for the text of the rules that fit. Without `scanMetadata` on the store, setup
says so once and the rules stay off. Session snapshots are removed on close.

**`rules.md`.** With the markdown store, each scope's rules are written to `<scope>/rules.md` under
the notes tree, one rule per line, so a person can read and correct exactly what the agent always
reads:

```markdown
- [d12] Validate inputs with zod, not yup. (why: memory.read d12)
- [p03] Run memory suites with --timeout=0. (applies to packages/memory/**)
```

The file is **editable**. At the start of each session the fabric compares the file's marker hash
with its body (one read and one hash per scope); if a person edited it, the edit is folded into notes
and the file is regenerated:

- an added line becomes an active, pinned rule with `generated.by: human` (`(applies to a/**)` makes
  it path-scoped);
- a deleted line retires its note;
- a changed line writes a correcting note (history kept: the old note is retired with `validTo`) and
  keeps the rule's scope and globs.

Every added or changed line passes the trust scan; a line that trips it (or whose write fails) is
refused, counted, and dropped from the regenerated file, so an instruction can never become a rule by
editing. Until the edit is folded in, the store keeps the file as the person wrote it and does not
overwrite it. Stores with no file layout (in-memory, SQLite, Postgres) show the block only.

### Path cues

A path-scoped note (`scope: "path"` with `applies_to` globs) is shown once per session, in the tail,
when a file tool reads or writes a matching file — the file is the retrieval cue:

```text
- [9c1e…] path procedure (for packages/memory/**) Run memory suites with --timeout=0.
- [d12a…] path decision (for src/payments/**) Validate inputs with zod, not yup — why: memory.read d12a…
```

Matching is a glob check over notes bucketed by each glob's first literal segment, so one touched
path checks one bucket, not every path note. A verified note wins; a candidate shows only where no
verified note covers the path, marked `(candidate)`. A decision cue additionally requires
`decisionStatus: "active"` and a verified row; proposed and superseded rules never show. At most
`cues.maxPerTurn` notes per turn (2 by default, 3 in the coding preset) within `cues.budgetTokens` (300 by default, hard 1000), ordered by storage strength `S`,
then retrieval strength `R`. Paths come from the session's touched-path tracker and must be
workspace-relative, so a path outside the project never matches. The lines join the semantic tail
block and stay in the untrusted envelope; the text passes the redactor.

Cross-source dedup drops a note already in the rules block, already injected by topic, already cued, or
whose text is verbatim in a visible file read. Injected cues join the citation tracker, so citing
one counts as a use. The injected set lives in session state, so a restore never shows a cue again,
and a turn with no new path runs no query. `cues: false` makes no index query and adds no lines. A path-scoped
**concept** is cued as a pointer, never its claims: `- [id] concept ledger (for packages/ledger/**) — memory.read id`,
at most one a turn and not when the tail already carries one.

### The team store

`.prism/memory/` is memory the whole team checks in: a markdown tree beside the code, reviewed like
code. It is off until config names it, and it is opened only when the directory exists in this
checkout:

```ts
memoryFabric({
  tools: { root: "~/.prism/memory" },
  team: { dir: ".prism/memory" }, // default dir; write: "ask" (default) or "off"
});
```

The directory is `<project root>/<team.dir>`, and it is a full markdown store: the tenant and
resource are fixed (`team` / `project`), so every checkout of the project reads the same notes. Only
the derived index is outside the repository, at
`<tools.root>/.team-index/<project id8>.sqlite`; the checked-in tree holds notes (plus the OKF
`index.md` and `log.md` the store maintains).

Recall and injection treat it as scope `team`, one more scope in the union: fused with the others,
prior 0.075 (between `project` 0.10 and `agent` 0.05), and shadowed by the narrower private scopes
when two notes share a `key`. So `path` and `project` notes win over a team note, which wins over
`agent` and `user` — a person's own exception beats the team default, and a team lesson beats a
cross-project guess. The storage level is the store the note lives in, so a team note needs no
`scope:` of its own.

**The directory is untrusted input.** It arrives with someone else's commit, so on load every note
is passed through the trust scan (`prompt-injection`, `exfil`, `invisible-unicode`). A note that
trips it is rewritten as a `candidate` carrying its `flags:` — quarantined like an imported bundle,
never injected, and counted by `memory:status` (`Team store: … (1 quarantined)`). Setup warns once
when anything was quarantined. Team notes never enter the standing rules, never count toward capacity,
and never count toward widening: only private project notes prove a cross-project lesson.

**Writing needs a person.** The agent has no write path: `memory.insert` refuses `scope: "team"`,
and no other tool reaches the store. `memory:share { id }` moves one verified private project note
(`fact`, `preference`, `procedure`, or a `concept`; see [Ontology tier](#ontology-tier)) into the team tree:

```text
/memory:share 9c1e2a4b7d10
  → host.ui confirm: the note text and the target path
  → notes/…/facts/facts-team-…md, generated.by: human, sources: [{ id: <private note id> }]
  → team/project/facts/<slug>--<id8>.md in .prism/memory, plus a `shared-to-team` log line
```

The file is written but never committed: reviewing and committing is the person's step in their own
VCS. A candidate, an archived or flagged note, `write: "off"`, a declined prompt, and a host with no
UI (`unavailable`) all refuse the share with a reason (`not_verified`, `write_off`, `denied`,
`host_unavailable`), and nothing is written.

## Exchange archive

Off by default (`exchanges: false`). Turn it on with `exchanges: {}` and every completed turn is
archived as one note of kind `exchange`: the user's text and the assistant reply that followed it,
verbatim, in the order they were said.

```text
user: Remember the launch moved to Monday.
assistant: Noted; I will treat Monday as the launch date.
```

- **Pairing, not messages.** The archive hooks `message.completed`, which fires after the reply is
  appended (not `turn.completed`, which fires inside the provider round before it). Only an
  assistant message with **no `tool_call` block** ends a turn, so a tool round never becomes an
  exchange and tool arguments/results are never stored.
- **Tool steps (opt-in).** `exchanges: { steps: true }` appends a `## Steps` section to the exchange:
  one line per tool result of that turn, in order, up to `exchanges.maxSteps` (default 24, at most
  64; further ones collapse into `- … N more step(s)`), and the whole section stays under a quarter
  of `limits.maxEntryTextChars`.

  ```markdown
  ## Steps
  - bash `bun test packages/memory` → error: ENOENT: no such file '.prism-memory.sqlite' (entry 01JD…)
  - edit `packages/memory/fabric/src/config.ts` → ok (entry 01JE…)
  - bash `bun test packages/memory` → ok (entry 01JF…)
  ```

  A line is the tool name, an argument summary (≤ 120 characters: `command`, `cmd`, `path`,
  `file_path`, `file`, `query`, `pattern` or `url`, whichever the tool's declared `parameters`
  include, otherwise the first scalar argument), `ok` or `error`, for an error the first line of its
  message (≤ 200 characters), and the **session entry id of the tool result**, so `memory.read
  { around }` or the host can reach the full output. Result bodies and the other arguments are never
  stored. Step text is indexed with the exchange, so "the migration failed with ENOENT" finds the turn
  where it happened. Steps are untrusted tool input and output: each passes the trust scan and the
  redactor, and a step either flags keeps only its tool name and outcome (counted in `memory:status`
  as `stepsDropped`); an unsafe step never refuses the dialogue. A step trace is evidence for recall,
  not extraction input: consolidation reads the dialogue only. An exchange whose steps contain a
  failed run followed by a passing run of the same command, where the command matches
  `CONSOLIDATION_PATTERNS.outcomes` (`bun test`, `git commit`, …), is tagged `outcome:fixed`. Off by
  default, so both presets and their revisions are unchanged.
- **Dated and source-backed.** `tRef` is the user entry's timestamp. Relative dates in the turn
  ("yesterday", "last Tuesday", "two weeks ago", "in March") are resolved against it by a
  deterministic English resolver and stored as an additive `dates: [{ text, resolved, precision }]`
  field; no model call is made. `sourceEntryIds` are the two
  **session entry** ids (not message ids). Passive delivery uses them to suppress an exchange whose
  turn is still in the prompt, so history is never injected twice.
- **Scope** (settled by plan 188.9 Task 1c): `project` only when the project scope is active **and**
  a root was declared (`scopes.project.root` or `tools.root`); otherwise `user`; otherwise `agent`.
  A conversational host with no declared root therefore does not file history under whatever
  directory the process started in. An exchange is never written to `path`.
- **Long turns split.** Above `limits.maxEntryTextChars` (16,384 by default) a turn splits on the
  message boundary first, then paragraph, then line, then character boundaries. The parts share
  `tRef` and the source ids and link to each other (`relation: "part"`), so recalling one part can
  expand to its siblings; each part carries `context: "part i of n"`. Other writes keep the hard
  limit.
- **Lifecycle.** Exchanges decay with their own `lifecycle.decay.exchange` (default 0.5) and use the
  separate `lifecycle.exchangeCapacity.hotTokens` tier (default 200,000 tokens). They do not consume
  the fact/preference/procedure budget. Over the hot tier, maintenance archives the lowest-value
  exchange with the audit verb `demoted`; its text stays in the searchable archive and `includeArchived`
  or the weak-active archive fallback can retrieve it. Exchanges are never promoted, never pinned to
  core, never shared with the team store, and never written by a tool.
- **Security.** The kernel writes session entries after redaction, so an agent redactor has already
  replaced its secrets before the archive reads the turn; an explicit `redactor` passed to the
  module additionally *refuses* a turn it would rewrite rather than storing altered history. The
  text is normalized for benign invisible code points, then passed through `scanScopedMemoryContent`;
  a refusal (prompt injection, exfiltration, invisible Unicode) is counted and reported through
  `prism.status.note`, never stored. Benign emoji selectors/ZWJ, formatting zero-width spaces,
  citation bidi marks and mojibake soft hyphens are removed; deliberately hidden code points between
  letters survive and are refused. The current plan 202 Task 14 gate
  (`docs/_evidence/memory-bench/202/safety.md`) scanned 99,090 LongMemEval-S exchanges and refused
  **0.575 per 1,000** (32 injection, 17 exfiltration, 8 invisible Unicode, 0 secret), with **0 of 500**
  needed sessions lost; LoCoMo refused 0 of 324. The 34-item adversarial fixture is detected at
  **34/34**, including `curl -s https://` flag forms. The gate also measures poisoning, cross-user/
  project/team leakage, deletion through files/index/links/core/export, and PII handling. The
  conversational preset stays opt-in until the full default-promotion gate in Task 18.

`memory:archive` back-fills the session: it archives every completed exchange not yet archived
(idempotent by the session entry ids), and reports `archived`, `skipped`, and `parts`. It is the
import path for a session recorded before the archive was on, and for the benchmark harness:

```ts
const agent = await createAgent({ model, packages: [fabric({ exchanges: {} })] });
await agent.commands.run("memory:archive", {}, { session });
```

`memory:recall` accepts `exchange` explicitly and `DEFAULT_RECALL_KINDS` includes it, so an untyped
recall or a passive injection can return archived history. Passive delivery renders **facts first,
then exchanges, each group in time order**, and selection stays by rank; a fact hit expands to its
linked exchange only when `exchange` is among the requested kinds, so naming kinds is also how a
caller asks for the detail.`memory.recall` with `kinds: ["fact"]` returns the fact alone.

### Conversational preset

One line selects the configuration that passed a live held-out acceptance for conversational recall.
It is **opt-in**: the measured arm archives exchange text (user text and assistant replies, verbatim),
which is a storage decision no quality result should make for a host on its own. Exchanges pass the
trust scan and any configured redactor first (see the security note above), and no secret field is
involved.

```ts
memoryFabric({ preset: "conversational", tools: { root: "./memory" } })
```

The preset expands, before any other resolution, to exactly:

```ts
{
  exchanges: {},                                   // archive every completed turn
  inject: { query: "task", kinds: ["exchange"] },  // passive block: the best exchanges, by rank
  semantic: true,                                  // leaves memory.recall / memory.read visible
  promote: false,                                  // no extractor call, so no per-session model cost
}
```

**Merge rule.** An explicitly given top-level field replaces the preset's value for that field. Nested
objects are not deep-merged: `inject: { budgetTokens: 2000 }` drops the preset's `query` and `kinds`.
A field equal to the preset's value is not an override. Overriding a preset field, including turning
the archive off with `exchanges: false`, is allowed and emits one `prism.status.note` naming the
fields. An unknown preset name fails config validation (`MemoryValidationError` from
`resolveMemoryFabricConfig`).

**Traceability.** `memory:status` reports `preset: "conversational"` and `presetRevision: 2`
(`CONVERSATIONAL_PRESET_REVISION`), and the same pair is written to a status note at setup, so
`agent.inspect()` shows the revision next to the package config's `preset`.

**The contract.** What `conversational` promises at API level 1:

- it stores verbatim exchanges, makes **no write-path generative model call**, calls a decision model
  only when the host names one (a `decisions` model, plan 202 Task 12), and needs no embeddings
  service;
- a later revision may change ranking, budgets, delivery format, tool descriptions and read-path
  behaviour, so the host line does not change to adopt an improvement;
- adding a write-path generative model call, a new stored kind, or a required service needs a **new
  preset name** or an explicit opt-in field. The `decision` kind therefore arrives with a new preset,
  `coding` (plan 202 Task 11), not as a change to `conversational`.

Measured on 100 unused LongMemEval-S held-out v3 ids (2026-10-23, `mimo-v2.5` at temperature 0; the
same model judged), against the same store with the tools hidden and against a whole-history prompt:

| | Passive only | Passive + tools | Whole history |
| --- | ---: | ---: | ---: |
| Judge accuracy | 49/100 | **76/100** | 69/100 |
| Multi-session | 10/40 | **28/40** | 23/40 |
| Input tokens per question | 6,378 | 29,669 | 112,955 |
| Tool calls per question | 0 | 1.5 | 0 |

Passive plus the read tools is non-inferior to whole-history context on LongMemEval-S held-out v3 at
about a quarter of the input tokens: 76/100 against 69/100, a paired +0.07 (95% CI -0.03..0.17)
inside the 3-point non-inferiority margin, at 29,669 tokens per question against 112,955 (26%),
1.5 tool calls per question, and 2% of questions hitting the eight-turn limit. Passive injection
alone scores below whole-history context (49/100 against 69/100); the read tools are required, and
the gain comes from the agent pulling rounds the block cut (evidence coverage 0.63 → 0.83), not from
a larger injection. Facts (`promote`) were not needed for this result; the `fabric-xc` arm that
extracts them was not selected. Full evidence: `docs/_evidence/memory-bench/188.10/README.md`.

### Coding preset

`coding` is `conversational` plus standing rules for repository work. It remains opt-in because it
stores decisions as well as exchanges. The preset expands to:

```ts
{
  exchanges: {},                                   // archive every completed turn
  inject: { query: "task", kinds: ["exchange"] },  // conversational history, by rank
  semantic: true,
  promote: false,
  rules: { kinds: ["decision", "preference", "procedure"], capture: "confirm" }, // decisions first; 2,000 tokens
  cues: { budgetTokens: 300, maxPerTurn: 3 },      // path rules, at most 3 per turn
}
```

A user turn with a lasting-rule cue (`from now on`, `always`, `never`, `we decided`, `use X instead
of Y`, `no, do X`) becomes a **proposed** decision with a lexical rationale; preference and procedure
cues become those kinds (see Standing rules). No model is called.
The user turn and assistant reply are already archived, and `sourceEntryIds` names both. An explicit
`memory.insert { kind: "decision" }` is also proposed. The only capture inputs are user turns and the
agent's own typed write: tool output is never captured. Every write runs the trust scan.

Activation is explicit: one batched `host.ui` confirmation per turn (a host that answers
`unavailable` leaves the note proposed), or use in two sessions with no correction. A correction
that writes a new decision with `supersedes` marks the old one `superseded`; it stays readable by
id but is never delivered. Active path decisions arrive through the existing path cue when a touched
file matches `appliesTo`; active project decisions take the rules block. A narrower scope shadows a
wider one through the existing `key` shadowing. The preset makes **no write-path generative model
call** and needs no embeddings service; a decision model is only used when the host names one
(plan 202 Task 12). `memory:status` reports `preset: "coding"` and `presetRevision: 1`.

The 12-persona coding-lifecycle suite, MemoryCode, and VibeMemBench / DreamBench-SWE remain the
measurement gate (plan 202 Task 2 robust criteria; F3/F7 in Task 14). This implementation lands the
functional contract; the measured target stays with Plan 210 Task 9.

### Known limitations

- **One benchmark family.** The verdict is LongMemEval-S only; no other suite or model family has a
  held-out v3 result. Evidence: `docs/_evidence/memory-bench/188.10/README.md`.
- **Preference and abstention had no held-out ids.** Both stay development-only, so the preset has
  no held-out quality claim for them. Evidence: `scripts/memory-bench/heldout-v3.json`.
- **The judge and the answerer were the same model.** `mimo-v2.5` answered and judged, so judge
  leniency is unquantified; cross-family judging is plan 202 Task 3. Evidence:
  `docs/_evidence/memory-bench/188.10/README.md`.
- **Retrieval is lexical only, and the candidate pool has a measured ceiling.** 11 of 30 multi-session
  questions have a needed round outside the top-32 candidates. Evidence:
  `docs/_evidence/memory-bench/188.10/ms-diagnostics-x.json`.
- **Temporal reasoning is 12/20.** It improved from 7/20 but remains the weakest scored ability.
  Evidence: `docs/_evidence/memory-bench/188.10/README.md`.
- **About 78% of injected blocks were judged irrelevant** (0.777). The tools compensate; the block
  itself is noisy. Evidence: `docs/_evidence/memory-bench/188.10/README.md`.
- **Growth is measured offline, not as model QA.** The 1,427-exchange, 12-month LongMemEval-M run
  passed the pre-registered month-12/month-1 retrieval criterion, and the separate 100k exchange
  store envelope passed on SQLite and Postgres. Accuracy is lexical retrieval of the expected
  month-1 exchange, not a live model answer. Evidence:
  `docs/_evidence/memory-bench/202/growth.md` and `exchange-scale.md`.
- **F3: foreign-context exposure in the lifecycle suite.** The completed paid arm exposed foreign
  context in 13/24 sessions while labelled cross-project leakage stayed 0. Evidence:
  `docs/_evidence/memory-bench/188.7/findings.json` (F3).
- **F4: fact extraction reliability has no completed paid arm.** The schema/repair fix is
  offline-proven only, and `om+fabric` extraction stopped early. Evidence:
  `docs/_evidence/memory-bench/188.7/findings.json` (F4).
- **F7: the lifecycle safety power target was not reached.** Only one persona completed both arms,
  so no safety or power claim is possible. Evidence:
  `docs/_evidence/memory-bench/188.7/findings.json` (F7).
- **F9: the `om+fabric` arm never completed.** It stopped after two questions, so the combined path
  has no completed paid evidence. Evidence: `docs/_evidence/memory-bench/188.7/findings.json` (F9).
- **The exchange archive gates refuse real history.** The offline audit measured 2.271 refusals per
  1,000 LongMemEval-S exchanges, touching 3 of 500 needed-session questions; adversarial detection
  was 33/34. Evidence: `docs/_evidence/memory-bench/188.11/trust-scan.md`.

## Lessons

A lesson is what the working agent learned: what to do differently, a gotcha, the fix that worked
(plan 209 Task 4). It is a `procedure` or `fact` the agent writes itself with `memory.insert`, tagged
`lesson` and citing at least one `evidence` id. There is no `lesson` kind and no background model call:
the agent already has the context in its turn.

```json
{ "tool": "memory.insert", "input": { "kind": "procedure", "text": "Create the SQLite file's parent dir before running memory suites.", "tags": ["lesson"], "evidence": ["4f2a9c1e0b77"] } }
```

- **Evidence.** 1–8 note ids, usually the exchange of the turn where it happened (with `exchanges: { steps:
  true }` its `## Steps` show the failed command and the fix). Each id must be a note in an active scope that
  stays readable wherever the lesson is read: a project or path lesson may cite project, user or agent notes;
  a user or agent lesson may cite only user or agent notes. Anything else, including another project's
  note, rejects the write with `not_found`. Every writer holds the lesson rule, not only the tool.
- **Lifecycle.** A lesson starts as a `candidate` and verifies by the existing use rule (cited in
  `lifecycle.verifyAfterSessions` sessions without correction). A lesson with no use for
  `lessons.archiveAfterSessions` (20) scope sessions since its last use is archived from default recall
  whatever its strengths, never deleted, and a later citation revives it. A pinned lesson never archives.
- **Nudge** (`lessons: { nudge: true }`, default off, needs the exchange archive). After a turn that carried a
  signal, the next request's tail carries one line:

  ```text
  memory: this turn had a correction; if there is a reusable lesson, record it: memory.insert { kind: "procedure", tags: ["lesson"], evidence: ["<exchange id>"] }
  ```

  Signals, by the consolidation gatherer's patterns over the user turn plus the step trace: a correction
  cue, an explicit "remember", an exchange tagged `outcome:fixed` (needs `exchanges.steps`), or an
  approval denial (`decision.resolved` with `deny`) inside the turn. At most once per
  `lessons.minTurnsBetweenNudges` (5) completed turns per session. The line holds the exchange id and fixed
  text only, never note or turn text; it is never in the prefix and is taken by one request. When the trust
  scan refused that exchange, the cited id is not a note and the insert answers `not_found`.

## Memory directory

With passive injection off by default, the agent still needs to know what long-term memory holds
before it can decide to recall. The fabric renders one `Long-term memory` prefix block
(`metadata.source: "fabric-directory"`) next to the working-memory block:

```text
project: 9 facts, 2 procedures; topics: deploy (5), billing (3). Recall with memory.recall; read files with memory.read.
user: 3 preferences; topics: tooling (2)
agent: 1 procedure
Files: notes/deploy.md, notes/billing.md, … (+2)
Blocks: profile, project
```

With one active scope the block keeps the older single line (`12 facts, 3 procedures, …`); with
more, it renders one line per scope with that scope's counts and topics.

It names counts, never content. Counts and topics cover **active** notes only: inside their
validity window at the time of recompute, with visible consent, not invalidated or superseded, and
not an unverified `status: "candidate"`, so they match what `memory.recall` can return. Topics are
the most-used tags and keywords. Files are the most recently modified files under `tools.root`
(hidden files and the store's SQLite index are skipped; at most 1,000 are scanned, six levels deep), as
paths relative to the root. With the markdown store the walk lists the store's own `notes/` tree, so
`notes/index.md` (the regenerated OKF root index) is named as the browsable entry point. Tags and paths
are redacted. The index sums every active scope and keeps each scope's counts on its own line; a
share grant widens recall, not the index.

`directory.stopWords: true` (default `false`, a tuning field) drops topics made only of stop words
(`i`, `it`, `we`), so the topic line names content words; a phrase with a content word stays. It does
no extra work beyond one term check per topic and changes nothing when unset. It is an opt-in variant
of plan 210 Task 3.1 and is measured once before it can ship.

When a scope has concepts (see [Ontology tier](#ontology-tier)) the block gains one line for it, after the counts and
topics: `project concepts: 12; subjects: payments, deploy-pipeline, auth (+9)`. It names the most used subjects first
(recorded uses, then the notes a concept cites, then name), at most eight, and counts the rest. It shares the
`maxTokens` budget: files shrink first, then topics, then the subjects named; the count stays. With no concepts the
block is byte-identical to the one above. It is pinned for the session epoch with the rest of the block, so writing a
concept mid-session does not rebuild the prefix.

Three disclosure levels keep the prefix small:

1. the directory block (always in the prefix, capped);
2. `memory.view` with no `path`: the same summary plus the full topic and file lists, 50 per page,
   paged by `offset` (topics cap at 200);
3. `memory.recall` and `memory.read` for content.

`memory.view { path }` still lists a directory under the root. Without a directory (`directory:
false`, or a fabric built without one) a path-less `memory.view` lists the root as before.

**Cache stability.** The prompt's directory is pinned with the core for the session epoch described
above; `memory.view` can still read a fresh, write-keyed directory. Counts and labels in the prefix
stay fixed until session start, compaction, retraction or explicit refresh. A note whose `validTo`
passes between boundaries stays counted until the next epoch. The block is dropped silently when
the fabric holds nothing, or when the store cannot aggregate (`countByKind` / `topTags`).

Cost: no model or embedding call; one `GROUP BY` per aggregate per recompute (a scan in the
in-memory store), plus one bounded directory walk when `tools.root` is set. The block is at most
`maxTokens` (default 200, hard cap 500); the topic and file lists shrink first, then the text is cut.

## Consolidation from sessions

Off by default: `promote` absent or `false` makes no extractor call. Opt in with
`promote: { minScore: 0.5, minTurnsBetween: 8 }` (see [triggers](#consolidation-triggers-cost-and-status)).
A pass gathers session material (explicit statements, corrections, decisions, high-value
observations, reflections), makes **one** extractor call (plus at most one shape-only repair), and
writes only what survives the gate.
There is no per-reflection promotion: a reflection is evidence, not a write.

One write path serves tools and consolidation. Each accepted note goes through `remember` in its
target scope, so write-time consolidation, the optional decider (`ADD`/`UPDATE`/`SUPERSEDE`/`NOOP`),
and the never-demote-a-verified-note rule are the same ones an agent write gets. Each write carries:

- `status: "candidate"` — stored, recallable by tool, never injected passively until used or confirmed;
- `generated: { by: "promotion", at, session }` and `sourceEntryIds` — the evidence entries it rests on;
- `promotion: { score, signals, pass }` — the gate's decision, so a write is explainable afterwards.

**Narrowing by contradiction.** When an accepted note contradicts a note in a wider scope, the
candidate is written as an exception in the narrower scope: the same `key`, plus `overrides` naming
the wider note. Plan 188.2's narrowest-scope-wins shadowing then hides the wider note **in that
project only**; `contradictedIn` on the wider note records the project id (deduplicated, ids only,
never text). An exception never targets `user` or `agent` scope from a project session. A same-scope
contradiction routes to `SUPERSEDE` through the decider when it is on; otherwise both notes are kept
and linked `contradicts`.

**Reconsolidation.** A note marked `reconsolidate: true` (a verified note edited after promotion, or a
correction) is shown to the next pass as an existing note, together with the new evidence. A returned
note with the same `key`, kind and scope updates it in place — same id, correction lineage
(`supersedes`, `sourceEntryIds`) kept. When the extractor returns nothing for that key the note is
retired (`validTo` set). A flagged or archived note is never rewritten.

**Candidates are not trusted yet.** A candidate is never injected passively and is not counted in the
memory directory. `memory.recall` returns it marked `(candidate)`, after verified hits of equal score.
It becomes `verified` when any of these happens:

- it is cited (`[<id>]`) in assistant output across `lifecycle.verifyAfterSessions` (default 2)
  distinct sessions, with no harmful evidence against it;
- the agent writes it again with `memory.insert` and a `kind`, or confirms it with `memory.replace`;
- the host calls `fabric.verify(id)`.

**Archive** (`lifecycle.archive`, plan 188.4 Task 4). A note — candidate or verified — is archived by
`fabric.maintain()` only when both strengths are low (`R < retrievalBelow`, `S < storageBelow`), it is
past `graceSessions` scope sessions since it was written, it is not pinned, and the store does not hold
it. Calendar days play no part. Archiving sets `status: "archived"` and `archivedAt`, remembers the
status to restore, and leaves `validTo` unset: supersession and expiry are the only paths that set it,
so historical time-scoped recall (`asOf` before `archivedAt`) still retrieves the note, while injection
and the directory exclude it via `isActiveNote`.

**Archive search and revival.** `memory.recall { includeArchived: true }` searches active and archived
notes, so an archived procedure or episode takes one call:
`{ kinds: ["all"], includeArchived: true }` (the default kinds would filter it out). Without the flag,
archived notes are searched only when the best active hit is weak (coverage below 0.34); at most three
are appended after the active hits and marked `[archived]`. Passive injection never searches archives
and never shows one. Citing an id that archive search showed revives the note — its previous status returns, the citation counts as a use (resetting `R`), the note's
`useSessions` grows `S`, and the markdown audit line reads `revived`.

**Pinning.** `pinned: true` on the note (frontmatter, `fabric.pin(id)`, or `memory.replace { id, pin }`)
exempts it from archiving and capacity eviction; `pin(id, false)` unpins.

**Capacity and merging** (`lifecycle.capacity`, `lifecycle.merge`, plan 188.4 Task 5).
`fabric.maintain()` measures each active scope against its budget — notes and estimated tokens, one
`get` batch for the text — and only when a scope is over budget does it act, in this order,
stopping as soon as the scope is back inside:

1. **Duplicate merge**, deterministic and without a model: notes of one kind in one scope with an
   equal `key`, or with term-set Dice at or above `merge.duplicateDice` (0.8) and the same globs.
   The survivor is the note with the higher `S`; it keeps its id, text, `key`, and status, and absorbs
   the others' keywords, tags, links, evidence, promotion stamp, and lifecycle counters. The others
   are archived with `mergedInto` naming the survivor and the audit verb `merged`. Episodes are never
   duplicate-merged — episodes of one subject are the episode pass's business.
2. **Episode merge**, only when `lifecycle.merge.episodes` is set: `minCluster` (5) or more active
   episodes of one project sharing a `key` or a tag become one `fact` or `procedure` note — one model
   call per cluster, same fail-closed rules and trust scan as the consolidator. The new note is a
   candidate with `generated.by: promotion` and the episodes as its evidence; the episodes archive
   with `mergedInto`. A cluster whose call fails, or whose answer trips the trust scan or the
   redactor, is left untouched: nothing is archived without the note that replaces it.
3. **Eviction**: the lowest `S·exp(R)` notes first — the ones the ranking already valued least —
   archived with the verb `evicted`. A pinned note and a note at or above
   `archive.storageBelow` are never evicted: budget pressure is not a reason to shed knowledge that
   was earned.

**The exchange tier is separate.** Exchange notes are excluded from the scope's notes/tokens budget
and measured only against `lifecycle.exchangeCapacity.hotTokens` (default 200,000). Over that size,
the lowest-value unpinned exchanges are demoted with the audit verb `demoted`; demotion only changes
status to `archived`, so the verbatim text remains in the searchable archive. This keeps a lifetime
transcript from evicting learned facts or growing an unbounded hot set. The 12-month growth run over
1,427 LongMemEval-M exchanges passed the month-12/month-1 criterion in both the shipped archive path
and a 20k-token tier stress arm (`docs/_evidence/memory-bench/202/growth.md`).

Merging is **O(n log n)** per scope through key grouping and lexical candidates, with no model call.
Episode merging costs one model call per cluster and is **off by default** until plan 188.6 fits the
rules. A merge never crosses a scope: the pass runs per resource, and a user note can never fold into
a project note.

What is left over is a scope whose protected notes alone exceed the budget. Then maintenance archives
nothing more, reports the scope in `maintain()['overBudget']`, and the package notes one warning with
the scope and its counts:

```ts
await fabric.maintain();
// { archived: 4, merged: 3, episodesMerged: 0, evicted: 6, widened: 0, superseded: 0, overBudget: [] }
```

**Widening** (`lifecycle.widen`, plan 188.4 Task 6; hardened by 188.7 Task 4). Knowledge earns a
wider scope the same way it earns its place at all: by being proven more than once. In a full pass, a
`fact` or `procedure` that is **verified** in at least `minProjects` (2) distinct project resources
becomes an `agent`-scope **candidate**. Every readable candidate for one `kind|key` subject must carry
one identical normalized value; one differing value (including an opposite instruction) blocks the
subject entirely, so a third agreeing project never bridges a conflict. Each contributing project must
have readable text and a distinct witness origin (a note copied from the same `sourceEntryIds` is not
independent), and text that names a participating project stays project-bound. Keys are no longer
matched by Dice; keyless notes match only on identical normalized text. The wider note carries the
project notes as evidence, their union of keywords and the survivor's temporal fields. Project copies
are archived with `widenedTo` **only after** the wider note is persisted at the wider level with the
same normalized content; a failed write leaves every local note active, and a retry reconciles without
rewriting. The new note has to be used in the agent scope like any other candidate, so one strong
project can never install agent-wide knowledge on its own. A note that hurt (`harmful > 0`), one a
project contradicted, and a pinned note never widen, and a subject the agent scope already holds is
left alone. `duplicateDice` remains accepted for source compatibility and is ignored.

**Path → project** works the same way inside one project: path notes with an equal `key` and one
identical normalized value, each covering exactly one sibling subtree, become one project note when
the notes cover at least `minSiblings` (2) distinct subtrees under one parent — `src/api/**` and
`src/web/**` share the `src` parent. One note listing two globs is one witness, never two regions;
missing text, conflicting values or mixed kinds block the subject. The path copies archive with
`widenedTo` only after the project note is persisted and verified equivalent.

**Narrowing.** A `user` or `agent` note whose `contradictedIn` names `contradictionsToSupersede` (2)
projects is superseded: `validTo` is set, the status becomes `retired`, and the audit line reads
`superseded-by-contradiction`. This is the only other writer of `validTo` besides reflection
supersession and expiry; archiving still never sets it. The project exceptions that produced those ids
are untouched — they are the evidence, and they stay valid for their own project.

Widening and narrowing need the cross-project scan, so they run only in an unscoped pass.
`fabric.maintain({ scope })` archives and enforces capacity for one resource and stops there;
`consolidate()` calls that scoped form once at the end of each pass, for the session's project scope.
Widening is one `scanMetadata` page set per project resource plus key grouping, and makes **no model
call**.

**Projects you do not bind** (plan 188.4 Further Action 2). The pass finds projects through
`store.listResources({ prefix: "projects/" })`, but a project the host never bound has no `Memory`: its
notes are replication evidence only, with no readable text and no way to archive them. Give the fabric
an `openScope` resolver and the host decides how to open such a resource:

```ts
const fabric = createMemoryFabric({
  memory,
  scopes, // agent and user are enough; projects can be resolved on demand
  vectorStore,
  openScope: ({ level, tenantId, resourceId }) => openProjectMemory({ level, tenantId, resourceId }),
  lifecycle,
});
```

A returned `Memory` is used for that pass only: its notes count with their real text and tokens, it can
supply the text of the wider note, and its copies archive with `widenedTo`. Return `undefined` to keep
the resource metadata-only, and note that a resolver that throws, or returns a memory whose scope is not
the requested `tenantId`/`resourceId`, is treated as "not opened" — the pass never reads or rewrites the
wrong notes. Archiving and capacity still run only for bound scopes; bind a project (or call
`maintain({ scope })`) when you want it maintained as well.

**Nightly recipe.** Run the full pass once a day with a headless command target — a package command,
not an agent turn:

```ts
import { createScheduler } from "@arnilo/prism-headless";

const scheduler = createScheduler({
  checkpoints,
  ownership: { tenantId: "ops" }, // must match the agent that runs the package
  targets: { maintain: { kind: "command", agent, command: "memory:maintain", input: {} } },
});
await scheduler.schedule({ id: "memory-maintain", target: "maintain", cron: "0 3 * * *", tz: "UTC" });
scheduler.start();
// Each firing: { firingId, status, sessionId } — the command returns the counts, nothing is persisted from it.
```

A host whose nightly job binds many projects can bind none of them and pass `openScope` instead: the
package opens each project it needs for that pass. The pass makes no model call unless
`merge.episodes` is on, so the firing costs one claim write, one completion write, and the scan work. `memory:maintain` runs the whole pass and opens every project it discovers over the package's own
stores (the `openScope` resolver above, wired by default), so a nightly job in a multi-tenant host does
not need every project bound. `memory:maintain { "scope": "projects/<slug>--<id8>" }` (as the target's
`input`) runs only archive and capacity for that resource. A host that schedules with `Bun.cron` or systemd instead can call the same command directly
with `agent.commands.run("memory:maintain", {}, { session })`.

Superseded reflections retire their notes with supersedes semantics (`validTo` set, correction lineage
kept, logged `superseded-by-om`). Verified notes edited after promotion (carrying correction lineage)
are not retired; they are marked `reconsolidate: true` and counted in `memory:status`, then
re-extracted by the next consolidation pass.

**One lifecycle for every layer** (`src/lifecycle/`). Status and every counter live on the note, never
in the scoped ledger:

| field | meaning |
| --- | --- |
| `uses` | the last 32 uses, each `{ s, at }`: the scope-session ordinal and the wall time |
| `useSessions` | distinct sessions that used the note; a candidate verifies at `verifyAfterSessions` |
| `retrievals` | returns from recall and injection, diagnostics only — never status or strength |
| `helpful` | outcome-tagged turns that cited the note |
| `harmful` | user corrections that cited the note; harmful evidence blocks verification |
| `lastSession` | the last session that counted a use, so one session never counts twice |
| `created` | the scope-session ordinal the note was written in; absent counts as 0 (before the clock) |
| `archivedAt`, `archivedFrom` | when it was archived, and the status a citation restores |
| `pinned` | never archived, never evicted |

An outcome tag in the same run as a citation counts helpful evidence. A user correction whose `[<id>]`
citation names the note counts harmful evidence, sets `reconsolidate: true`, and returns a verified
note to `candidate` so the next consolidation pass can re-extract it. A plain note with no status
(written before the lifecycle) is `verified`.

**Two strengths** (`src/lifecycle/strength.ts`). Storage strength S accumulates evidence of value —
`a·explicit + b·log(1+useSessions) + c·helpful − d·harmful + e·outcome`, clamped at 0 — and only
harmful evidence lowers it. Retrieval strength R is ACT-R base-level activation,
`ln Σ (clock − s + 1)^(−d)` over the use log, where `clock` is the scope-session ordinal. Time is
therefore sessions the scope was worked in, not calendar days: a project left alone keeps its R while
other projects run. Recall adds `w_R·σ(R) + w_S·σ(S)` after fusion and the scope prior, bounded by the
two weights so relevance keeps the final word. `noteImportance(S)` is written as the note's core
`importance`, so a host that configures core scoring gets evidence instead of a constant 0.5. The same
two strengths decide the archive: `shouldArchive` needs both below the thresholds, which is why a
rarely used but explicitly stated note is never archived.

The scoped ledger (`.memory/state.json`) keeps only pending approvals and write statistics; a ledger
written by an earlier build is read for those and its retired per-note lifecycle rows are ignored with
one warning.

The `memory:status` command reports candidate, verified, and archived counts, the trust-scan
rejections, and the last consolidation pass's counts and rejection reasons. With the team store
open it adds that store's counts and how many of its notes the load scan quarantined.

**Inspecting one note.** `memory:lifecycle` explains the rules per note instead of counting them:
one line each with S, R, the use log size, and the gate that refused — `archive=no(retrieval,grace)`,
`widen=no(harmful,contradicted)`. It reads the same predicates `maintain()` applies
(`shouldArchive`, `storageStrength`, `retrievalStrength`), so the view cannot drift from the pass.
Arguments: `{ id }` (12-hex note id), `{ key }` (subject), `includeArchived` (default `false`; archived
notes are hidden), and `limit` (default 20, max 100 — the printed rows, not the count). Notes under
legal hold never appear: the store's scan already excludes them. The widening verdict is note-level
only; replication across projects is what `memory:maintain` decides, so `widen=note-eligible` means
"nothing about this note blocks it". `memory:maintain` runs one
maintenance pass (archive, capacity, widening, narrowing) and reports its counts; the `memory:reindex` command re-reads the
markdown store's files into its derived index and reports `indexed`, `removed`, and `malformed`
counts (`{ full: true }` re-reads every file). Run `examples/long-term-memory.ts` for a session that
consolidates a note with `memory:consolidate` and a second process that recalls it from the markdown
store.

### OM as T0: measured promotion result

Observational memory is the T0 tier: its ledger feeds the ordinary `promote` pass above; there is no
separate `promote.observational` flag. Plan 202 Task 16 measured that path on a seven-seed offline
lifecycle suite (24 sessions per seed, zero model calls). With promotion off → on, task success was
**0.375 → 0.393** for fabric alone and **0.732 → 0.732** for OM+fabric. Promotion wrote **0.125** and
**0.25** notes per session respectively; **none** of the promoted candidates was recalled and cited
in a later session in that suite, so the use-verified share was **0**. The result does not justify
enabling promotion in the reference host, which keeps it off. A six-run one-question live smoke on two
free models completed every `om`, `om+fabric`, and `fabric-x-tools` arm with zero worker errors; that
is a completion check, not a quality comparison. Evidence:
`docs/_evidence/memory-bench/202/observational/role.{json,md}` and `arms.{json,md}`.

A failed OM worker pass is background-only by contract: it fails `om.observe`, leaves the ledger
unchanged, and does not fail the run. The benchmark now records non-budget worker failures and
continues instead of aborting the arm; a token-ceiling cause still ends the arm as a budget result.

### Consolidation: triggers, cost and status

Three triggers, no timers:

- **`turn.completed`** starts a `fabric.consolidate` background task only when at least
  `promote.minTurnsBetween` turns (default 8) have passed since the last pass **and** observational
  memory recorded a new reflection, a supersession, or a task-state decision after the cursor. A turn
  with no new OM material starts no task and makes no model call.
- **`memory:consolidate`** and **`fabric.consolidate(session, { signal })`** run a pass now, regardless
  of `minTurnsBetween`. Run the command before `session.close()`:

  ```ts
  await agent.commands.run("memory:consolidate", {}, { session });
  await session.close();
  ```

- **`session.opened` with `restored: true`** runs one catch-up pass when material after the cursor
  exists, covering a process that closed before its final pass.

One pass per session runs at a time (an in-process lease): a trigger during a running pass is dropped,
not queued. The cursor advances to the pass's last covered entry only after every write succeeded, so
a failed pass leaves the material for the next trigger and fails only its background task
(`background.failed`). `promote: false` (the default) makes no model call at all.

`memory:status` reports the last pass from session state alongside the note census: candidates,
accepted, written, updated, exceptions, retired, model calls, and rejections by reason (`score`,
`ephemeral`, `derivable`, `trust`, `secret`), and — on a failed pass — `failures` by reason code with
`outputLimited` for calls that hit the output limit. `memory:consolidate` returns the same counts.

### OKF export and import

Any store can be exported to the markdown layout and imported back, which makes SQLite and Postgres
deployments inspectable. `exportMemoryOkf(memory, { dir, stores })` writes the thread's notes, working
memory, `.state.json` (tombstones, legal holds, generation), `index.md`, and `log.md`; embeddings are never
written, and the derived index files are removed so the bundle is plain files. `importMemoryOkf(memory,
{ dir, stores, mode })` reads a bundle into any store. `merge` adds and overwrites by id; `replace` also
removes the target's other notes. Imported notes are stamped `generated.by: import` and scanned: a hit is
imported as a `candidate` with its flag, so it is never passively injected. Pass `embedder` to re-embed
(hybrid targets, one batch per page); a lexical target makes no embedding call. A legal hold on the target
is never overwritten, removed, or cleared, and holds in the bundle are added to the target. `stores` is the
pair you gave `createMemory`, because `Memory` does not expose its stores. Source-access grants and share
grants are not exported.

The `memory:export { dir }` and `memory:import { dir, mode }` commands resolve `dir` inside `tools.root`,
refuse without it, and refuse a path that escapes it or overlaps the live `notes` directory.

### Notes written by a newer version

The team store is shared across agents and versions, so the reader never destroys what it cannot understand.
A note whose `fabric.v` is above 1, or whose `fabric` object carries a field this version refuses, is
**unreadable**: it is excluded from recall, injection, the directory, the core block and `memory.read`
(`not_found`), so a crafted future-version note cannot reach the model or skip the trust scan by being
unparseable, and it is never rewritten, renamed, moved, archived or evicted. `memory:export` and `memory:import`
carry its file byte for byte, `memory:import --mode replace` does not delete it, and `memory.replace` refuses it
with reason `unreadable`. `memory.forget` by id still deletes it, because that is an explicit request.
`memory:reindex` and `memory:status` report `unreadable` and `unreadableReasons` (`version>1`, `invalid-fabric`);
`memory:status` counts every scope of the markdown store.

A readable (`v: 1`) note keeps unknown keys under `fabric` and unknown top-level frontmatter keys through a recall
touch, `memory.replace`, `memory:maintain` and `memory:import`. Only a store that writes OKF files
(`tools.root`) can hold a top-level frontmatter key; on SQLite or Postgres the unknown `fabric` keys are kept in
the row.

## Ontology tier

The store side of the three-tier memory (plan 207). T1 is the notes above: atomic, scoped, each with provenance. The
ontology tier is **one `concept` note per subject** (an entity or a topic in this user's, project's or team's world),
built on top of them. It is **opt-in and unmeasured**: nothing here changes a default, and no quality claim ships from
it until plan 210 decides. The fabric owns storage, validity and the deletion cascade; the `@arnilo/prism-memory-wiki`
package owns synthesis, through the `memory.fabric` service.

**The `concept` kind.** A concept is an OKF markdown file in `concepts/` (or a vector record on SQLite and Postgres):

```markdown
---
type: "Concept"
title: "Payments service"
subject: "payments"
concept_type: "entity"
aliases: ["billing"]
sources: [{"id":"3f1c9e2a4b70"},{"id":"9c1e2a4b7d10"}]
---
# Payments service

- [c1] Retries use exponential backoff capped at 3 attempts.[^3f1c9e2a4b70]
- [c2] Inputs are validated with zod, not yup.[^9c1e2a4b7d10]

## Open questions
- [q1] Whether refunds share the retry budget.[^3f1c9e2a4b70]
```

Every item is one line with a stable id (`c<n>` claim, `q<n>` open question, `x<n>` contradiction) and one or more
footnotes naming the T1 note ids it rests on. The `subject` is `[a-z0-9.-]{1,64}`, unique per scope. Relations to other
subjects (`part-of`, `instance-of`, `uses`, `related`) are note `links`. A claim of at most 280 characters with no
citation is accepted only from a person (`generated.by: human`) and is labelled `(uncited, human)` wherever it is
rendered. `subject` is also an additive field on every other kind, binding a note to a subject in its own scope; a
binding may precede its concept.

**Who writes one.** Not the model tools. `memory.insert { kind: "concept" }`, `memory.replace` and `memory.forget` on a
concept id answer `concept_requires_ontology` (`ConceptRequiresOntologyError` on the library API), and so does
`memory.recall` with `kinds: ["concept"]` when the fabric has no ontology (`semantic: false`). Only the ontology port, a
person editing the file, `memory:import` and `memory:share` write one. The directory and the core block do not name a
concept's text, and `memory:maintain` never archives, merges or evicts one.

**Concepts first, then drill down.** One `memory.recall` surface, no second search tool. `concept` is in the default
recall kinds and in `kinds: ["all"]`, and a concept hit gets the kind prior `ontology.conceptPrior` (default 0.1, in
[0, 0.5]) after fusion and the scope prior, so a matching concept ranks above the notes it cites but never above a note
that matches the query better. In `memory.recall` a concept renders as a header, its current claims with the ids they
cite, and one drill-down line; a pattern no concept covers comes back as a plain note in the same call:

```text
[7a21c0d4e9b1] project concept payments 2026-11-02
  [c1] Retries use exponential backoff capped at 3 attempts. ← 3f1c9e2a4b70
  [c2] Inputs are validated with zod, not yup. ← 9c1e2a4b7d10
  drill down: memory.read { ids: ["3f1c9e2a4b70", "9c1e2a4b7d10"] }
f4f6129570f2 project [fact] path=… date=2026-10-28 matched=[…] Staging deploys run nightly…
```

Up to `ontology.maxClaimsRendered` (default 8, in [1, 32]) claims are shown, chosen by term overlap with the query and
kept in document order. A **stale** claim is never rendered in recall; `memory.read { id }` returns the whole concept
with claim ids and labels a stale claim `(stale)` and a person's uncited one `(uncited, human)`. `memory.read { ids }`
on the cited notes returns them through the usual filters, and an exchange reached that way expands with `around`. As a
second line behind the cascade, one batched read confirms that every note a claim cites is still readable here; a claim
with an unreadable citation is not delivered. A flagged concept renders `[flagged: <class>]` and no claim. A shared team
concept cites private notes that never travelled with it, so its drill-down reads the concept itself.

**Passive delivery is a pointer.** A concept never enters the standing rules. The passive tail carries at most one concept
per turn, as one line (`- [id] concept payments — memory.read id`), and only when it is the top fused hit and its subject
is in play: one of its names (slug, title, alias) is in the turn's words, or a touched path falls inside the concept's
`appliesTo` globs. A path cue for a concept is the same pointer, and the tail and the cue share the one slot. Content is
pulled by the agent, never pushed.

**Co-read.** An answering turn that cites two or more notes the model received (a recall result, a passive card or a
`memory.read`) records a `coRead` event on each evidence note: `{ s, t, with }`, the scope-session ordinal, the turn
index and the other ids (at most eight, the last sixteen events per note). It holds ids and indexes, never text, makes
no model call, and rides in the turn's existing `fabric.lifecycle` background write. Concepts and working blocks take
no part. It is the signal the concept pass (plan 207 Task 6) uses to pick what to consolidate: the memory the agent just
retrieved and used. A recorded use of a concept also refreshes its index row, so the directory's subject order follows
use.

**Sharing.** `memory:share { id }` accepts a verified concept. The person sees its current claims and the number of
citation ids that travel without their notes; the cited private notes are **not** copied. The team concept keeps its
claims and cites as provenance, drops stale items, open questions, relations and use counters, is stamped
`generated.by: human`, and replaces the team store's earlier concept for the same subject (one per subject). The wiki
package's `wiki:lint` reports each citation as shared without evidence: it is derived from the team scope, not stored.
Tools cannot write the team store, the trust scan quarantines a team concept like any team note, and a private concept
with the same subject **shadows** the team one (the narrower scope wins).

**A person's edit.** A concept is a file people browse, diff in git and edit. The markdown store hands every concept
file that changed outside the store (a save, a pull, `memory:reindex`) to a reviewer before it is indexed, in the
private store and in the checked-in team store alike. The reviewer calls no model:

- *The body must still parse.* A body that breaks the item grammar (a line that is not a claim, a known section or the
  title; an item in the wrong section; a repeated id) is rejected. The last valid version stays indexed and readable,
  the file is left exactly as the person wrote it, and `log.md` gets one `invalid-concept` line, with the reason, naming
  the writer `human`. The same broken file is not judged again until it changes. Fix the file or restore it from git;
  the next curator write replaces it.
- *What a person changed is theirs.* Every item whose text or citations changed, and every new item, is marked
  `[c1 human]` in the file. The marker is part of the body grammar and not of the text, so a model cannot forge it by
  writing "human" in a claim. A marked item, and any item with no citation, is read-only to everyone but a person: the
  port refuses `update_claim`, `retire_claim` and `merge_claims` on it with `claim_human`, whoever the writer is, and
  the curator's own later writes keep the marker. The file is rewritten in place with the markers, because the file is
  the record: a rebuild reads them back. With no earlier indexed version to compare against (a fresh index over files
  that were already there), the file is taken as written and only its own markers count.
- *The index follows the body.* `sources` is re-derived from the footnotes, `title` from the heading, and a stale mark
  on an item the person changed is cleared; the concept gets the dirty reason `edited` until the curator next writes it.
  `generated` becomes `{ by: human }`.
- *The trust scan still runs.* The title, aliases and body are scanned. A hit quarantines the concept as a `candidate`
  with `flags`, so it is never delivered, in recall or passively; a clean edit lifts the flag. A person's edit never
  bypasses the scan.

The deletion cascade still wins over a person: forgetting a cited note removes the claim that cited it, human or not.
An uncited claim is never touched by the cascade.

**The team ontology.** With `team` on, the checked-in team concepts are a read-only scope of the same port (`scopes()`
lists `team`, `subjects`, `read` and `dirty` answer for it) so the wiki's lint can review them like code. The port
never writes `team`: `applyConceptEdits` and `bind` on it fail with `MemoryScopeError`, and only `memory:share` and a
person's commit change that tree.

**The deletion cascade.** It is deterministic, calls no model and no embedder, never deletes a T1 note, and runs
whether or not the wiki package is installed. In the same call that retracts a note:

- `memory.forget`, a store delete by id (retention, import-replace), a deletion-propagation pass, a revocation or a
  legal hold **remove every claim that cites the note**, with that claim's other citations. `sources` is recomputed,
  the concept is marked dirty (`removed`), and a concept left with no claim is archived.
- A correction, a supersession, an archive, a downgrade to candidate or a trust-scan flag mark each citing claim
  **stale** (the concept is dirty with `stale`). A stale claim keeps its text; readers label it `(stale)` and never
  deliver it passively.

A deletion propagator tombstones through the store rather than through `memory.forget`, so a host that builds one
registers `createConceptDeletionHandler(...)`, which the package provides as the `memory.fabric.concept-deletion`
service. The cascade finds citing concepts through an in-process index built from one metadata scan and kept current by
the port; a retraction costs a map lookup (about 0.001 ms with 2,000 concepts; the one-time build took 17 ms on the in-memory
store, and is not yet measured on SQLite or Postgres). An import, which can bring concept files in, rebuilds it.

**Binding a note to a subject.** The ontology shapes writing as well as reading (schema-assisted encoding): a T1 note
that names a subject is bound to it when it is written, so the concept pass works on ready-made clusters.

- *Deterministic, free, at write time.* With at least one concept in the note's scope, `remember` tests the note's
  text and its keywords against the scope's subjects, by the same normalizer the lexical index uses (lowercase,
  stopwords dropped, stemmed; whole tokens only). A subject's names are its slug, its title and its aliases. A subject
  qualifies when one name has at least `ontology.bindThreshold` tokens (default 2) in the note, or when every token of
  a multi-token name does. **Exactly one** qualifying subject binds the note; zero or several leave it unbound for the
  concept pass. An explicit `subject` always wins, a rewrite keeps the subject it had, and binding never crosses scope
  (a `user` note reads `user` subjects, a `project` or `path` note reads `project` subjects). It is a token map, not a
  scan, and calls no model. If the index cannot load (a store without `scanMetadata`), the note is simply stored
  unbound.
- *Binding marks the concept dirty.* A bound note tells the curator its subject has new evidence: the concept gains
  the `evidence` dirty reason (the pass reads `dirty()` as well as `pending()`).
- *Extractor-assisted.* When `promote` is on, the consolidation extractor's per-call prompt lists the scope's subjects
  (at most 64 per scope, about 1,500 tokens in all, one `slug | title | aliases` line each), and `record_notes` takes an
  optional `subject`: a shown slug for the note's own scope, or `new` for something no shown subject covers. A slug that
  was not shown is dropped, not rejected: the note stays unbound. `new` stores nothing today. The list is part of the
  per-call prompt, never of the cached system text or the tool schema, so the cached bytes are identical with and
  without an ontology; it is pinned per session epoch like the directory.

**The `memory.fabric` service.** Provided during `setup` whenever `semantic` is on. A consumer lists
`requires.services: ["memory.fabric"]` and reads it at call time (`prism.services.require`):

| member | purpose |
| --- | --- |
| `scopes()` | readable scope levels, narrowest first |
| `subjects(scope)` | the ontology index: subject, title, aliases, concept id, type, dirty reasons |
| `pending(scope, { cursor, limit, subject, unbound, coRead })` | T1 notes written after the cursor, oldest first, text capped; `subject`, `unbound` and `coRead` narrow it in the same metadata scan (one scan per call) |
| `read(scope, ids)` | up to 32 notes through the same scope, consent, invalidation and redaction filters as `memory.read`; a note view also carries its `keywords`, `links` (ids and relation), `coRead` events (ids and indexes only), `generatedBy` and, for a concept, its `stale` item ids |
| `applyConceptEdits(scope, edits, { generatedBy })` | validate the whole batch, then write it; one bad edit rejects all |
| `bind(scope, noteId, subject)` | bind a T1 note to a subject |
| `dirty(scope)` | concepts that need a pass, and why |
| `settle(scope, subject)` | the curator saw a subject's new evidence and had nothing to add: clear the `evidence` reason (`stale`, `removed` and `edited` stay) |
| `screen(text)` | the trust class the fabric would refuse `text` for, or `undefined`; lets a curator drop one offending edit instead of the batch |

The edit vocabulary has no rewrite: `create_subject`, `add_claim`, `update_claim`, `retire_claim`, `merge_claims`
(its `cites` are exactly the union of the merged claims' citations), `add_relation`, `add_open_question`,
`note_contradiction`. Every text passes the trust scan and the redactor (`refused: <class>` on a hit), every citation
must be an active evidence note readable in the same scope (`MemoryScopeError` otherwise), and only `user` and
`project` are write scopes: `agent` concepts would come from widening and `team` concepts from `memory:share`.

## Tools

| Tool | Effects | Needs |
| --- | --- | --- |
| `memory.view` | `read` | `tools.root` for paths; the directory needs none |
| `memory.read` | `read` | `tools.root` for paths; a note id needs none |
| `memory.insert` | `edit` | block, file path, or fact/preference/procedure/decision kind |
| `memory.replace` | `edit` | block, file path, or note id |
| `memory.recall` | `read` | — |
| `memory.forget` | `write` | — |

With `semantic` on, `memory.recall` also searches `concept` notes (the kind enum names it); the tool never writes or
edits one. These six names and their effects are **stable at API level 1**: a host may reference them in approval and policy
rules. Their descriptions may change in a minor version; the names and effects do not (see `## Compatibility`, the contract from graduation).

`memory.read` accepts exactly one of `path`, `id`, `ids` (1–8), `around`, or `session`. A note read returns each note in
full with its header — id, scope, kind, date, and the note's path — through the same scope, consent,
invalidation and redaction filters as recall; an unknown, foreign-scope, or revoked id is
`not_found` for that id alone, and the call reads at most 8 notes. A file read stays jailed and
byte-capped.

`memory.read({ around: "<exchange-id>" })` opens that exchange and up to two readable
neighbours on each side in the same archive session. `memory.read({ session: "<session-id>",
page: 0 })` reads eight exchanges at a time in reference-time order; pages start at zero.
Read and recall results expose the archive session id. Navigation uses the SQLite session/time
index (also used by the markdown store); custom stores without `listBySession` use a metadata
scan and emit a status warning. Stores without either capability return `not_found`.
Older notes without archive `session` metadata remain recallable and readable by id;
navigation covers newly archived notes. No existing archive is rewritten.

`memory.recall` accepts optional `from` and `to` (ISO dates or timestamps, inclusive; a date covers
that whole UTC day) and `order: "relevance" | "time"` (default `relevance`). With a window, a note
matches when any of its resolved event `dates` falls inside it, else when its `tRef` (or write time)
does. Time order sorts by the earliest resolved date, oldest first, and renders `tRef` plus
`dates=<date>/<precision>`; passive delivery renders the same resolved dates inline. A time window
also scans archived metadata (up to 5,000 rows) instead of stopping at the relevance top-K, so an
archived event far outside that preload is still found; larger archives need store-side date
filtering. Month- and year-precision dates resolve to the start of that period, and an expression the
resolver does not know is left unresolved rather than guessed. Locale gap: weekday and month names
are English.

Recall groups same-subject hits at read time and orders each group newest-first. Facts and other
keyed notes group by `key`; exchanges group when their Task 5 subject keywords overlap at or above
the provisional Dice floor (value-like numbers are ignored). An explicit `supersedes` edge also
joins a group. Every earlier member carries `superseded by <id> on <date>?`; the question mark is
the point: this is a hint, not a deletion or an invalidation, and the older note stays readable.
Passive delivery shows the same marker. Ordering is stable and costs no model call.

`recall: { supersessionHint: "keyed-only" }` (default `"all"`, a tuning field; plan 210 Task 3.1) limits the
marker to members joined by a key or an explicit `supersedes` edge. Exchanges that only share subject
terms keep the grouping and the order but lose the label, because a later conversation turn does not
replace an earlier one the way a keyed update does. Measured on 60 LoCoMo questions the label moved
the score by one question (38 to 39), inside noise, so the field stays opt-in until the audit measures
it; unset, recall is byte-identical. It costs nothing per call.

`recall: { expansion: true }` (default `false`, a tuning field; plan 210 Task 3.1) expands the lexical
query with the informal and formal forms of its words from a small fixed English table in
`lexical-expansion.ts` (`girlfriend`/`gf`, `mother`/`mom`, `photo`/`pic`, `university`/`uni`, and a few
dozen more), so a question that says "girlfriend" reaches a note that says "gf". It makes no model or
embedding call; the original query is kept whole and only missing alternates are appended. Because
alternates add query terms, the relevance floor is scaled by the share of terms that were the caller's
own, so the same threshold still means "how much of the question". Each hit's `coverage` is reported on
that scale too (matched caller terms, an alternate counting for its word), so a match found only through
an alternate clears `memory.recall`'s no-match floor instead of abstaining. A query with no table term is
unchanged, and so is recall when the field is unset.

`recall: { gather: true }` (default `false`, a tuning field; plan 210 Task 3.1) adds a boolean `gather` to
the `memory.recall` tool for list and multi-hop questions ("the names of his dogs", "every place he has
been"). A call with `gather: true` returns the whole matching history in one call, up to the 32-hit
recall window, oldest first, with a snippet budget of 3,000 tokens instead of 1,200; an explicit `topK`,
`order` or `budget` still wins. It is the same tool, scope, eligibility and trust path as a normal
recall (a forgotten, archived-away or other-scope note is still excluded), except that a quarantined
(flagged) note is left out instead of being shown with its flag as a normal page shows it. Cost: a gather
call can render up to 3,000 tokens of snippet lines instead of 1,200, and only when the agent asks for
it. With the field unset the tool schema has no `gather` property and results are byte-identical.

The opt-in `state: {}` config adds one model call over the grouped, budget-selected hits and returns
a short current-state table (`subject | current value | [id]`) in the `memory.recall` output and
result value. It is **not** in the conversational preset, and passive injection never calls it. The
call receives at most 2,000 estimated input tokens; if the model fails or cites no shown id, the
normal recall output is returned unchanged. Set `state.model` to choose the wrapper model; absent
uses the host default.

### Decision models

The opt-in `decisions` field binds one [decision model](../../../docs/decisions.md) through
`prism.models.decisions(model)`. Absent or `false`, no decision call is made and every heuristic and
generative path behaves as before. The model must declare the `decisions` capability. Each point
runs as one batched call (at most 64 questions), with a calibrated threshold and an abstain band;
inside the band, or on any `DecisionsError`/timeout, the incumbent path decides and the turn
continues. A decision never deletes, archives or rewrites a note.

| Point | What it gates | Incumbent inside the band |
| --- | --- | --- |
| P1 durable | Coding-preset capture and the generative extractor; only a clearly durable turn reaches either | lexical cue capture / extractor |
| P2 supersession | `consolidate.decider: "model"`: `replaces`/`contradicts`/`refines`/`unrelated` per candidate | the generative decider |
| P3 relevance | passive-injection candidates (top 32) | relevance ranking |
| P4 needed | skips passive injection when memory is clearly not needed | inject anyway |
| P5 sufficient | adds an abstention when shown recall evidence is clearly not enough | the confidence floor |
| P6 applies | path cues for standing decisions whose globs already matched | show the rule |
| P7 instruction-like | coding-preset capture: a clear instruction attempt adds a refusal | the trust scan |

P1, P3, P4 and P7 share one `evaluateTurn` request when they run for the same persisted user turn; the no-candidate P1 result is reused by the extractor gate and capture. P7 is additive only: it can refuse a capture, never
remove a refusal from the trust scan. Only already-scoped text is sent; a hosted model receives it
off-machine. The documented default suggestion is local `liquid-local/d1-3B`. At two requests per
turn and roughly 1,000 input tokens per request, hosted `liquid/d1` input costs about **$0.04 per
1,000 turns** at $0.02/Mtok; local inference costs $0 plus hardware (measured p50 330–744 ms per
request). The checked-in `scripts/fixtures/decision-bench-memory.jsonl` has 100 labelled items per
point with reversed-choice repeats; run `bun scripts/decision-bench.mjs --memory` on the authorized
development screen. Thresholds and bands live in `src/decisions.ts` (tuning tier).

Exchange archive keywords are enriched deterministically with normalized entities,
numeric dates and units, and category terms (for example, flights add `travel`).
This adds no model or embedding calls. `memory.recall` returns `unmatchedTerms`
for terms absent from the returned notes and their indexed keys; these are not
proof that a term is absent from the whole archive. For aggregation questions, list the instances
and their ids before counting or totalling, and use two or three differently worded queries.

`memory.insert` accepts exactly one of `block`, `path`, or `kind: "fact" | "preference" | "procedure" | "decision"`.
Typed notes accept `supersedes`, `evidence`, `rationale` (decision only), `tRef`, `validFrom`, `validTo`, `tags`,
`keywords`, `scope`, `appliesTo`, and `key`. `evidence` is 1–8 note ids stored as links with relation
`evidence`; an id that is not readable wherever the new note is read returns `not_found` and writes
nothing (see `## Lessons`). A note tagged `lesson` without evidence, or of a kind other than procedure
or fact, returns `lesson_requires_evidence`. A decision inserted by the agent is always `proposed`
and a lifecycle candidate; it needs the user's confirmation or two sessions of use to become active. The scope rule in the description is precision-first: user-wide preferences
→ `user`; anything learned in this repository → `project`; only a lesson proven across projects →
`agent`; `path` with `appliesTo` when the note holds for one subtree; when unsure, the narrower
scope.
`memory.replace { old, new, block | path | id }` requires exactly one target and one
occurrence (including overlapping matches); missing/duplicate text returns `not_found`/`ambiguous`.
Empty `new` deletes text. File edits stay jailed and refresh the file note; empty files
are indexed by path. Truncated files cannot be edited. Note edits preserve ids and record
correction lineage. Typed writes and note edits scan the resulting content for prompt injection,
exfiltration, and invisible Unicode; refusal returns `refused: <class>` without writing.
Each typed write or note edit embeds once; block edits make no model or embedding calls.

All tools are hidden when the session's fabric is off. With `semantic: false`, working-block
inserts/replacements/forgets remain available and indexed operations fail closed.

## Selective injection and recall

Passive semantic injection is **off by default** (`inject: false`). Idle/model turns make no
semantic embedding or vector/lexical query; `memory.recall` retrieves detail when the agent asks.
This default has no measured benchmark gain yet: Task 14 must supply paired benchmark evidence
before changing it. Working memory is re-read on every build and leads the tail after the transcript.

Passive injection never delivers a concept's claims: with the ontology tier in use, the top fused hit may add one
pointer line when its subject is in play (see [Ontology tier](#ontology-tier)); everything else in this section is about
notes.

Opt in with `inject: { query: "task" }`; the defaults are `minSimilarity: 0.2`, `minScore: 0.2`,
`fullTextScore: 0.35`, `topK: 12` and `budgetTokens: 4000`, so an opted-in turn adds **about 4,000
tokens** of memory at most (measured mean 3,739 in the ceiling grid and 2,865 in the shipped-query
delivery diagnostic over the 140 development questions). Delivery fills by rank with **whole** notes:
each note renders in full while it fits the remaining budget, up to `topK`, and a later note that
does not fit whole is **skipped, not truncated** — a shorter note after it may still fit. The best
matching note is always shown: when it alone exceeds the budget it renders as an excerpt centred on
the densest run of matched query terms, of the whole budget, ending
`(excerpt; memory.read <id> for the full note)`. Shown notes are delivered in **time order**
(`tRef` else `ingestedAt`, ties by rank) with their date header, so a knowledge update is read after
the value it replaces; ranking still decides *which* notes are selected. Rendering changes how much
of a note is shown, not which notes are ranked or filtered, and adds no query, write, or model call;
injected tokens stay within `budgetTokens` with no exception.

**Confidence gates delivery.** `minScore` drops a hit below the floor; if every hit is dropped the
block is only `Showing 0 of M matching notes.` plus the existing directory prefix, so the agent knows
memory was searched and chose not to paste low-confidence text. Between `minScore` and
`fullTextScore`, an exchange renders as a **pointer card** instead of its text: id, event date, the
user's first 120 characters, and the matched query terms, for example
`- [e81] 2026-04-02 "I picked up the new bike…" · bike, picked`. The agent reads the note by id for
the full exchange. A hit at or above `fullTextScore` renders as before, whole or excerpted. Pointer
cards never show the assistant reply and are always shorter than the note text; neither floor is a
model call, and both are tuning-tier fields under `inject`. The 0.2/0.35 starting values remain to be
calibrated on the Task 8 development screen (plan 202, then Plan 210).

`inject: { cardExcerpt: "query" }` (default `"head"`, a tuning field; plan 210 Task 3.1) keeps the card's
120-character width but centres it on the matched query terms across **both** halves of the exchange,
so a detail past the head of the message, or in the assistant's reply, can be seen without reading the
note. Unset, the card is byte-identical. It adds no model call and no tokens beyond the same width;
the matched-terms tail is unchanged.

**Weak tool-callers get text after two cued turns.** Adaptive delivery is on for the package and
needs no config. It counts user turns that ask for a selection, list, count, comparison, or time
ordering (`all`, `count`, `how many`, `latest`, `when`, …). After **two** such turns in a session with
no `memory.*` tool call, the next passive block switches from pointer cards to full notes (still
inside the same `budgetTokens`, still gates below `minScore`); on the second cued turn the switch is
immediate. Any `memory.*` call — recall, read, remember, forget — resets the counter and the next turn
returns to pointer cards. The state is per session (`fabric.delivery`), never shared across
principals, and makes no model, embedding, or store query. `memory:status` reports it as
`delivery: "pointers" | "excerpts"` plus a `reason`, for example
`Delivery: excerpts (no memory tool use after 2 cued turns).` The model catalog has no tool-reliability
field, so the start mode is always pointers (R10; plan 202 Task 10).

**When the block is a selection, it says so.** If fewer notes are shown than were eligible after the
similarity floor and confidence gate (before `topK` or the budget cut them), the block ends with one line:
`Showing N of M matching notes. To list, count or compare across past conversations, call
memory.recall with several phrasings (queries) and memory.read the ids you need.` It names the two
read tools instead of asking the host, because per-run tool availability is not visible to the
package; a host that hides them still reads a coherent line. It carries counts only, never note
text, and it is absent when everything eligible was shown or when `inject` is off. The line counts
inside `budgetTokens` (about 43 tokens by the block's own `chars / 4` estimate): it takes the
space of the last delivered note rather than overspending, and is dropped only if even one note
leaves no room. The cue is the reason the block can be trusted as complete-or-labelled: an agent
that sees it searches instead of concluding that memory holds no more.

Every injected block — the
working tail, the directory, and the semantic tail — is marked
`untrusted`, `inert`, and `injectionCapable`, so remembered text is never treated as host
instructions.
The `minSimilarity` floor (default `0.2`) is applied to the active mode's similarity: query-term
coverage in lexical mode (calibrated in plan 188.1 Task 2) or pre-fusion vector cosine in hybrid
mode (a tuning default). A hybrid opt-in host gets one status note naming the embedder and floor. Empty results
inject nothing; the recall tool says `no matching memory for: <terms>; scopes: <levels>`.

`memory.recall` is the agent's detail channel: one call returns a compact **grouped summary** and at
most **1,200 rendered tokens** in total — `budget` counts the summary, then each snippet's header,
path and matched terms. Each snippet is the densest window of matched query terms in its note,
capped at 600 characters. The summary is two lines: total matches, distinct sessions, date span,
how many are shown, how many more are not, and the next page — for example
`7 matches in 5 sessions (2026-01-04…2026-06-19); showing 4; 3 more not shown; page with
{ query: "...", page: 2 }.`, followed by each session's count and date span (`s1×2 (…)`). It is
counts only, never note text, and is capped under 200 rendered tokens.

`topK` is the page size (default 5); `page` is zero-based over the same 32-hit ranked window, so
`{ query, topK: 4, page: 1 }` returns hits 5–8. The summary counts that window, so a broad query
can say `32` rather than the true archive total; page or narrow the query when it does. Every line
carries the note's relative path; `memory.read <id>` returns the note whole. Without `kinds` the
tool searches **every stored kind except `working`** (that tier is already in the prefix), so an
episode or a procedure from stored history answers without a second call. It makes exactly one
recall query — there is no kind-discovery follow-up. An empty or weak-only result is an explicit
abstention with no hits: `no matching memory for: <terms>; scopes: <active levels>`, so the agent
can say what it searched instead of guessing.

Fabric recall uses the store's lexical leg and, in hybrid mode, the vector leg too, fused with
`fuseRankings` before optional recency/importance scoring. Lexical-only stores use the lexical
ranking alone. Each scope is queried separately and the union is ranked as described under
[Recall across scopes](#recall-across-scopes); injected lines name the level (`[id] user preference
2026-09-30 …`). Passive kinds default to `fact`, `preference`, and `file`; `inject.kinds` or
recall's `kinds` can name others (`procedure` and `decision` are opt-in), and `kinds: ["all"]` means
every kind (`working`, `episode`, `fact`, `preference`, `procedure`, `decision`, `file`, `exchange`). The tool's own default is wider — every kind but
`working` — so stored history answers there without changing what an opted-in turn injects.
Validity and consent apply to both query hits and one-hop links.

Link expansion fetches up to `topK` targets in at most one scoped `Memory.get` batch, including notes
outside the query candidates.
Notes embed content plus keywords, tags, and context; stored content stays unchanged, including
on corrections and rebuilds.

The task query joins the latest user message, OM current task, and the latest todo plan, each
bounded to 2,000 characters. Persisted todo metadata supplies the plan after context folding.
`query: "user"` uses only user text. Direct `createMemoryFabric` callers can also set `inject` and register its `registerContextBuild` contribution. ISO dates, `last week`, and named months resolve against the
persisted user message timestamp into UTC validity/reference-time filters, and are removed from
the query text. Notes without `tRef` use their ingestion date for the reference-time window.

Recall is cached by session and persisted user-entry id, including empty results. Tool rounds
reuse identical tail bytes; a new user entry or steer recomputes them. Without a persisted user
entry passive recall is skipped. Notes already represented by OM item ids, verbatim visible
source messages, or a visible file read are dropped before filling `topK`. The budget includes
rendered lines and citation guidance. Lines include `[id]`, kind, ingestion date, and optional
`tRef`; the header asks the model to cite used ids (`Cite [id] for notes you use.`). Recalled and injected
note ids join a shared citation tracker; only cited ids (`[id]` in assistant text) are touched and
recorded for candidate use counting on `turn.completed` (invented ids never verify notes). Verification
counts distinct sessions (`session.id`).

The package declares the `background` capability for citation touches; without injection, it schedules no citation work.

The semantic block follows working memory in the tail after the complete transcript, with `fabric-semantic` source and item-id accounting metadata. It leaves the
prefix stable. Opt-in injection adds one embedding, one vector query and one lexical query per
user turn, plus at most one link lookup, with no added model call.

## Recall scoring

`memory.recall` blends similarity with recency and importance when `RecallScoringOptions` sets a weight.
It fetches `topK × 4` candidates (capped at the hard top-K limit), then re-ranks them by
`similarity·similarityWeight + recency·recencyWeight + importance·importanceWeight` and exposes the
`similarity`, `recency`, and `importance` components on each hit. In hybrid mode the similarity
component is the pre-fusion vector cosine; in lexical mode it is query-term coverage.

- `recencyWeight` and `importanceWeight` are finite numbers in `[0,1]`; the weights are sum-normalized
  and similarity keeps the remainder, so a pair that sums above 1 normalizes down (similarity 0).
- `halfLifeMs` is mandatory (positive, finite) once `recencyWeight > 0`. Recency decays as
  `2^(-age/halfLifeMs)` and stays neutral for a missing or ill-dated timestamp.
  `recencyBasis` defaults to `"accessed"` (`lastAccessedAt`, falling back to `createdAt`);
  choose `"created"` for creation-based decay.
- Recall never writes access timestamps. `memory.touch(ids)` changes only `lastAccessedAt`
  with one batched upsert. Call it for explicit recall or cited ids only with access-based
  recency, at most once per recall and once per turn with citations. Passive injection must
  not reinforce irrelevant hits by repeatedly refreshing them.
- `importanceFrom` is a write-time hook: it receives the redacted reflection and its result is clamped
  to `[0,1]`. An explicit `entry.importance` wins over the hook. A fabric note with neither gets its
  storage strength S normalised to `[0,1)` (`noteImportance`), so importance means evidence rather
  than the neutral `0.5` a missing value falls back to in core (D14). Importance is never
  LLM-derived in the write path.
- Leaving both weights unset disables scoring, so recall stays unblended and ordered exactly as the
  store returned it.

## Scoped memory

`scoped: { scopeRoot }` builds the scoped policy layer over the same fabric. Its activation floor,
abstention, and trust scan then back `memory.recall`. `scopeRoot` locates the policy ledger
(pending approvals and write statistics only — note status and use counts come from the note
lifecycle) and is independent of the memory resource; the facts it writes land in the project scope
as candidates. A retrieval records no use: only a citation does. `gcPass()` proposes the notes the
lifecycle's archive rule selects (both strengths low, past the grace window) and leaves the note
untouched until you approve — approval forgets it. Calendar-time decay is gone: age never multiplies
into a score, and the policy has no day-based knobs; the policy takes the scope clock and the archive
thresholds from the fabric's `lifecycle` config.

## Migration from 0.12

- `@arnilo/prism-memory/fabric` and `@arnilo/prism-memory/scoped` → `@arnilo/prism-memory-fabric`.
- `createMemory`, `createMemoryWorkingStore`, and `runMemoryConformance` moved here from
  `@arnilo/prism-memory`.
- `fabric.attach(session)` is gone. Register the package and use the `memory` command; the tools
  are gated by `prism.state.session`.

### Recall smoke probe

The fixture-only `runScopedMemoryEval` accepts `fixtures.recallSmoke` and reports
`recallSmoke: { answered, total, failedClosed }`. Its `probeRecallSmoke` helper
checks seeded note ids; it is a synthetic recall smoke check, not a public dataset
benchmark. The pinned, opt-in memory benchmark lives in
[`scripts/memory-bench`](../../../scripts/memory-bench/README.md).

## Compatibility (the contract from graduation)

> This is the contract the package will keep once it graduates from the experimental line. Until then it is a statement of
> intent, not a promise.

At API level 1 a host can rely on the names, signatures, config fields, tool names, command names, note files and
preset contracts written here for the whole `0.13.x` line and every later minor version (the same promise plan 185
Task 5 makes for the kernel). Everything else is an implementation detail.

### Stable

- **Exports.** The names in [Stable exports](#stable-exports) and their signatures. `src/__tests__/root-exports.test.ts`
  freezes the barrel.
- **Tools.** The six names in [Tools](#tools) with their `effects`; a host may name them in approval and policy rules.
  `memory.view` and `memory.read` stay `read`, `memory.insert` and `memory.replace` stay `edit`, `memory.recall`
  stays `read`, and `memory.forget` stays `write`. Tool descriptions may change; the names and effects do not.
- **Commands.** `memory`, `memory:reindex`, `memory:export`, `memory:import`, `memory:archive`, `memory:consolidate`,
  `memory:maintain`, `memory:status`, `memory:share` and `memory:lifecycle`, with their argument shapes; a new command
  is additive.
- **Config.** Every field marked `contract` in [Config stability](#config-stability). A contract field is never removed
  or renamed, and a new field is optional.
- **Notes.** The rule in [Notes written by a newer version](#notes-written-by-a-newer-version): an unknown key is kept,
  an unreadable note is kept as written, and only an explicit `memory.forget` or a store delete by id removes one.
- **Presets.** The preset names and their contracts; `conversational` is described in
  [Conversational preset](#conversational-preset), `coding` in [Coding preset](#coding-preset), and
  `CONVERSATIONAL_PRESET_REVISION` / `CODING_PRESET_REVISION` name the revision a measurement ran on.
  A new preset name is additive.

### May change in a minor version

- The value of every config field marked `tuning` in [Config stability](#config-stability), including a default that
  is also documented in `## Config`.
- Ranking and scoring, injection budgets, the delivery format, prompt text, tool descriptions, and a preset's contents
  inside its contract (a change to those bumps `CONVERSATIONAL_PRESET_REVISION` or `CODING_PRESET_REVISION`).
- Anything classified "Not exported" under [Stable exports](#stable-exports).

### Experimental features after graduation

The memory feature audit (plan 210) decides every memory feature against pre-registered rules
(`scripts/memory-bench/cleanup-criteria.json`). A feature that has no measured benefit, safety, cost or compatibility
role is removed. The owner may hold such a feature instead, with a written reason, or keep one whose removal could not
be shown harmless. Either way the feature is marked **experimental** here. An experimental feature is outside the API
level 1 promise: it can change or be removed in a minor version. This is the only way a feature without evidence stays
in the package. The audit fills in the list when it finishes. Until then it is empty.

### Needs a new name or an explicit opt-in

- A new stored kind (a `memory.*` kind beyond `fact`, `file`, `procedure`, `decision`, `episode`, `working` and `exchange`). `concept` is such a kind: see [Ontology tier](#ontology-tier); only the ontology port, a person, `memory:import` and `memory:share` write one, and it is delivered only as a recall hit or a pointer.
- A new write-path model call, or any change to what a default stores.
- A new required service (an embedder, a database, a provider key).
- A new capability a store or embedder author must implement instead of an optional method or declared flag.

### Config stability

Every field is `contract` (shape and meaning frozen at API level 1) or `tuning` (its value may change in a minor
version). `packages/memory/fabric/src/__tests__/stability.test.ts` checks this table against
`memoryFabricConfigSchema`; a field without a tier, or a tier that disagrees with the table, fails the test.

| field | tier |
| --- | --- |
| `preset` | contract |
| `enabled` | contract |
| `retrieval` | contract |
| `inject` | contract |
| `inject.minSimilarity` | tuning |
| `inject.minScore` | tuning |
| `inject.fullTextScore` | tuning |
| `inject.cardExcerpt` | tuning |
| `inject.topK` | tuning |
| `inject.budgetTokens` | tuning |
| `inject.query` | contract |
| `inject.kinds` | contract |
| `semantic` | contract |
| `directory` | contract |
| `directory.maxTopics` | tuning |
| `directory.maxFiles` | tuning |
| `directory.maxTokens` | tuning |
| `directory.stopWords` | tuning |
| `recall` | contract |
| `recall.supersessionHint` | tuning |
| `recall.expansion` | tuning |
| `recall.gather` | tuning |
| `rules` | contract |
| `rules.capture` | contract |
| `rules.maxTokens` | tuning |
| `rules.scopes` | contract |
| `rules.kinds` | contract |
| `cues` | contract |
| `cues.budgetTokens` | tuning |
| `cues.maxPerTurn` | tuning |
| `team` | contract |
| `team.dir` | contract |
| `team.write` | contract |
| `scopes` | contract |
| `scopes.tenantId` | contract |
| `scopes.priors` | tuning |
| `scopes.priors.path` | tuning |
| `scopes.priors.project` | tuning |
| `scopes.priors.team` | tuning |
| `scopes.priors.agent` | tuning |
| `scopes.priors.user` | tuning |
| `scopes.user` | contract |
| `scopes.agent` | contract |
| `scopes.project` | contract |
| `scopes.project.root` | contract |
| `scopes.project.id` | contract |
| `store` | contract |
| `store.markdown` | contract |
| `store.markdown.dir` | contract |
| `store.sqlite` | contract |
| `store.sqlite.path` | contract |
| `store.postgres` | contract |
| `store.postgres.connection` | contract |
| `store.postgres.schema` | contract |
| `store.postgres.table` | contract |
| `tools` | contract |
| `tools.root` | contract |
| `tools.maxFileBytes` | tuning |
| `scoped` | contract |
| `scoped.scopeRoot` | contract |
| `scoped.policy` | contract |
| `scoped.policy.promotion` | contract |
| `scoped.policy.promotion.reuseThreshold` | tuning |
| `scoped.policy.decay` | contract |
| `scoped.policy.activation` | contract |
| `scoped.policy.activation.topK` | tuning |
| `scoped.policy.activation.minSimilarity` | tuning |
| `scoped.policy.facts` | contract |
| `scoped.policy.facts.block` | contract |
| `scoped.policy.facts.maxChars` | tuning |
| `scoped.policy.approval` | contract |
| `scoped.policy.approval.default` | contract |
| `workingMemoryTemplate` | contract |
| `limits` | contract |
| `limits.maxEntryTextChars` | tuning |
| `limits.maxWorkingMemoryBytes` | tuning |
| `limits.maxVectorDimensions` | tuning |
| `limits.rebuildBatchSize` | tuning |
| `limits.rebuildMs` | tuning |
| `consolidate` | contract |
| `consolidate.threshold` | tuning |
| `consolidate.decider` | contract |
| `consolidate.model` | contract |
| `linker` | contract |
| `linker.enabled` | contract |
| `linker.topK` | tuning |
| `evolution` | contract |
| `evolution.enabled` | contract |
| `evolution.maxPatches` | tuning |
| `passive` | contract |
| `exchanges` | contract |
| `exchanges.enabled` | contract |
| `exchanges.steps` | contract |
| `exchanges.maxSteps` | tuning |
| `lessons` | contract |
| `lessons.nudge` | contract |
| `lessons.minTurnsBetweenNudges` | tuning |
| `lessons.archiveAfterSessions` | tuning |
| `ontology` | contract |
| `ontology.bindThreshold` | tuning |
| `ontology.conceptPrior` | tuning |
| `ontology.maxClaimsRendered` | tuning |
| `lifecycle` | contract |
| `lifecycle.verifyAfterSessions` | tuning |
| `lifecycle.decay` | contract |
| `lifecycle.decay.episode` | tuning |
| `lifecycle.decay.fact` | tuning |
| `lifecycle.decay.preference` | tuning |
| `lifecycle.decay.procedure` | tuning |
| `lifecycle.decay.exchange` | tuning |
| `lifecycle.storageWeights` | contract |
| `lifecycle.storageWeights.explicit` | tuning |
| `lifecycle.storageWeights.sessions` | tuning |
| `lifecycle.storageWeights.helpful` | tuning |
| `lifecycle.storageWeights.harmful` | tuning |
| `lifecycle.storageWeights.outcome` | tuning |
| `lifecycle.recall` | contract |
| `lifecycle.recall.retrieval` | tuning |
| `lifecycle.recall.storage` | tuning |
| `lifecycle.archive` | contract |
| `lifecycle.archive.retrievalBelow` | tuning |
| `lifecycle.archive.storageBelow` | tuning |
| `lifecycle.archive.graceSessions` | tuning |
| `lifecycle.capacity` | contract |
| `lifecycle.capacity.user` | contract |
| `lifecycle.capacity.user.notes` | tuning |
| `lifecycle.capacity.user.tokens` | tuning |
| `lifecycle.capacity.agent` | contract |
| `lifecycle.capacity.agent.notes` | tuning |
| `lifecycle.capacity.agent.tokens` | tuning |
| `lifecycle.capacity.project` | contract |
| `lifecycle.capacity.project.notes` | tuning |
| `lifecycle.capacity.project.tokens` | tuning |
| `lifecycle.exchangeCapacity` | contract |
| `lifecycle.exchangeCapacity.hotTokens` | tuning |
| `lifecycle.merge` | contract |
| `lifecycle.merge.duplicateDice` | tuning |
| `lifecycle.merge.episodes` | contract |
| `lifecycle.merge.episodes.minCluster` | tuning |
| `lifecycle.merge.episodes.model` | contract |
| `lifecycle.widen` | contract |
| `lifecycle.widen.minProjects` | tuning |
| `lifecycle.widen.minSiblings` | tuning |
| `lifecycle.widen.contradictionsToSupersede` | tuning |
| `promote` | contract |
| `promote.model` | contract |
| `promote.minScore` | tuning |
| `promote.weights` | tuning |
| `promote.weights.explicit` | tuning |
| `promote.weights.correction` | tuning |
| `promote.weights.outcome` | tuning |
| `promote.weights.recurrence` | tuning |
| `promote.weights.generality` | tuning |
| `promote.weights.ephemerality` | tuning |
| `promote.weights.derivability` | tuning |
| `promote.weights.duplicate` | tuning |
| `promote.maxCandidates` | tuning |
| `promote.minTurnsBetween` | tuning |
| `promote.derivableFrom` | contract |
| `promote.maxOutputTokens` | tuning |
| `promote.thinkingLevel` | contract |
| `state` | contract |
| `state.model` | contract |
| `decisions` | contract |
| `decisions.model` | contract |
| `decisions.points` | contract |
| `workerLimits` | tuning |

### Stable exports

`src/__tests__/root-exports.test.ts` freezes the root barrel. Adding or removing a name is a deliberate API decision.

- **Stable (API level 1).** The default package definition and `memoryFabric`, `createMemory`, `createMemoryFabric`,
  `createMemoryWorkingStore`, `createScopedMemoryPolicy`, `memoryFabricConfigSchema`, `resolveMemoryFabricConfig`,
  `resolveLifecycleConfig`, `parseMemoryNoteMetadata`, `encodeMemoryNoteMetadata`, `exportMemoryOkf`,
  `importMemoryOkf`, `runMemoryConformance`, `runScopedMemoryEval`, `SCOPE_CLOCK_COUNTER` (a store's
  `scopeCounter` name), the ontology tier's `MEMORY_FABRIC_SERVICE`, `createFabricOntology`,
  `createConceptDeletionHandler`, `parseConceptBody`, `renderConceptBody` and their types, `CONVERSATIONAL_PRESET_REVISION`, `CODING_PRESET_REVISION`, `packageName`, and the config,
  status, report, note and store-adjacent types.
- **Not exported.** Prompts (`EPISODE_MERGE_SYSTEM` and the consolidation extractor prompts), tuning constants
  (`DEFAULT_*`, `MAX_*`, `MIN_*`, `HARD_*`), scoring and eviction helpers (`evictionOrder`, `shouldArchive`,
  `isActiveNote`, `capacityUsage`), and the lifecycle, directory and core-block builders. They change with ranking and
  budget work and carry no promise.
