# @arnilo/prism-memory-fabric

Working, semantic, and scoped memory for Prism agents: the `memory.view`, `memory.read`,
`memory.insert`, `memory.replace`, `memory.recall`, and `memory.forget` tools, a `context.build` block, and
per-session enablement. It is the native-package successor to the 0.12
`@arnilo/prism-memory/{fabric,scoped}` subpaths.

Install explicitly. This package is not included in profile bundles until a size/use review.

```bash
bun add @arnilo/prism-memory-fabric
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

## Cost, security, and failure behavior

- Working memory makes no model call and no embedding call. It stores labeled blocks in the
  working-memory value and injects them as one `fabric-working` prefix block.
- Retrieval is **lexical by default** (`retrieval: "lexical"`): notes are searched with the store's
  lexical leg (in-memory term coverage, SQLite FTS5/BM25, Postgres full-text). No embeddings
  package is needed, and the default makes **no embedding call**.
- `retrieval: "hybrid"` adds the vector leg through the `embeddings` service: **one embedding call
  per write and per recall**. Without a service the fabric notes the fallback and stays lexical.
- The memory directory (below) makes no model or embedding call: one aggregate query per write
  batch, at most 500 tokens in the prefix (200 by default).
- The pinned core (below) makes no model or embedding call either: one metadata `scanMetadata` page
  per scope when a write, pin, or maintenance pass changes what it shows, at most `core.maxTokens`
  in the prefix (600 by default, hard 1000). Turns between rebuilds reuse the cached block, so a
  stable session sends byte-identical bytes.
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

## Consolidation

The default makes no model calls. Same normalized text updates a same-kind note in place;
different text keeps both notes and adds a `similar` link when the active mode's similarity meets
`consolidate.threshold` (default `0.85`): term-set Dice between the two notes in lexical mode,
pre-fusion cosine in hybrid mode. The Dice reading of `0.85` is provisional until plan 188.6
calibrates it on labelled duplicate pairs. File notes continue to refresh the same path in place;
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
definition and for parsing, so an answer can only cite the candidates (`c1`, `c2`, ...) and
existing-note ids it was shown. When no task segment is shown, `episode` is absent from the offered
kind enum; a `path` note is offered only with `applies_to`. The runtime parser enforces both rules
regardless of how much conditional JSON Schema the provider honours.

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
`minScore` are **provisional until plan 188.6 calibrates them** against paired evidence; the default
weights are exported as `DEFAULT_PROMOTION_WEIGHTS`.

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
  enabled: true, // default
  retrieval: "lexical", // default; "hybrid" adds the embeddings leg
  semantic: true, // default; whether indexed notes are available
  inject: false, // default; opt in with { query: "task" } → minSimilarity 0.2, topK 12, budgetTokens 4000
  directory: true, // default when semantic or tools.root is set; or { maxTopics: 8, maxFiles: 10, maxTokens: 200 }
  core: true, // default; or { maxTokens: 600, scopes: ["user", "project"] }
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
  exchanges: false | { enabled: true },
  // Verification by use across separate sessions (a citation is a use, a retrieval is not).
  lifecycle: {
    verifyAfterSessions: 2,
    // Retrieval-strength decay per kind; higher forgets faster. Provisional until plan 188.6.
    decay: { episode: 0.8, fact: 0.4, procedure: 0.4, preference: 0.2, exchange: 0.5 },
    // Storage-strength coefficients of `explicit + sessions·log(1+useSessions) + helpful − harmful + outcome`.
    storageWeights: { explicit: 1, sessions: 0.5, helpful: 0.5, harmful: 1, outcome: 0.5 },
    // Recall priors `w_R·σ(R) + w_S·σ(S)`; each in [0, 0.5], default 0.05.
    recall: { retrieval: 0.05, storage: 0.05 },
    // Archive needs both strengths below the threshold, past the grace window.
    archive: { retrievalBelow: -2, storageBelow: 1, graceSessions: 10 },
    // Per-scope budgets; a path note spends the project budget. Provisional until plan 188.6.
    capacity: { user: { notes: 200, tokens: 20_000 }, agent: { notes: 200, tokens: 20_000 }, project: { notes: 500, tokens: 60_000 } },
    // Duplicates always fold; episode clusters only when `episodes` is set (one model call each).
    merge: { duplicateDice: 0.8, episodes: { minCluster: 5, model: "hyper/<id>" } },
    // A lesson verified in two projects may live at `agent`; two projects contradicting a wider
    // note supersede it. `minProjects` cannot go below 2.
    widen: { minProjects: 2, minSiblings: 2, contradictionsToSupersede: 2 },
  },
  // Off by default. An object enables session consolidation and its extractor pass.
  promote: {
    model: "hyper/<id>", // default: the agent's model
    minScore: 0.5, // provisional until plan 188.6
    minTurnsBetween: 8,
    maxCandidates: 48,
    derivableFrom: ["AGENTS.md", "README.md", "package.json", "CLAUDE.md"],
    maxOutputTokens: 8192, // default absent: the model's own parameters; capped by its limit
    thinkingLevel: "low", // default absent: the model's default
  },
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

The measured markdown operating envelope is **up to 10k small notes for local,
low-write workloads**. At 10k, warm open was 304 ms and p95 lexical recall 20.2 ms;
at 50k, p95 recall reached 113.5 ms and p95 writes 210 ms. Switch to Postgres above
10k when recall must stay below 50 ms, or for concurrent/server writers. These
single-run measurements used tmpfs, so validate your durable storage before
adopting this envelope. Cold rebuilds can require additional incremental
reconciliation passes before all notes are searchable. See the
[scale evidence](../../../docs/_evidence/memory-markdown-scale-0.13.0.md)
for workload, sizes, rebuild timings, and the opt-in command.

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
| Pinned core | `fabric-core` | prompt prefix | a write, pin, forget, or maintenance pass changes a note it shows | zero after the first cached turn |
| Path cues | `fabric-semantic` tail | tail | a file tool touches a path for the first time in the session | tokens only on the turn a new path matches; none otherwise |
| Directory | `fabric-directory` | prompt prefix | the same as the core | one aggregate query per rebuild |
| On demand | — | `memory.recall` | — | normal recall plus one local lexical discovery query per active scope only when default kinds return zero hits |

Two properties hold the cost down, and `packages/memory/fabric/src/__tests__/prefix-stability.test.ts`
pins the first one: a quiet turn sends byte-identical prefix blocks (the directory and the core), so a
provider's prompt cache hits instead of re-ingesting them; and a turn that touches no new path adds no
tail block at all.

The team store (below) is a scope, not a tier: it joins recall and injection like `project` and
`agent`, and adds no block of its own.

### Pinned core

The core is a small, curated slice of long-term memory — the top notes by storage strength `S`
(plan 188.4), pinned notes first — one line per note as `[id] text`, user-scope notes first:

```text
Core memory (user): [41aa…] Prefers bun over npm. [77b0…] Uses fish shell.
Core memory (project prism): [9c1e…] Run memory suites with --timeout=0. …
```

Only `preference`, `fact`, and `procedure` notes enter, and only when they are **verified**, not
archived, not flagged, and still readable — a revoked or forgotten note never appears. The block
sits after the working-memory and directory blocks, stays inside the untrusted envelope, and its
text passes the redactor.

`core: false` turns it off; `{ maxTokens, scopes }` configures it (default 600, hard 1000; scopes
`["user", "project"]` by default, and `user` always renders first). The budget splits evenly and
unused budget flows to the other scope. Ties break by note id, so the selection and its order are
deterministic.

**Cache stability.** The block is cached per memory instance and keyed by the same write counter as
the directory. It is rebuilt only when a write, pin, unpin, forget, or a maintenance/consolidation
pass changes a note it could show; a turn with no such change sends byte-identical bytes (plan
184's cache parity). It carries no timestamp and makes no model call: one metadata `scanMetadata`
page per scope, plus one bounded read for the text of the notes that fit. Without `scanMetadata`
on the store, setup says so once and the core stays off.

**`core.md`.** With the markdown store, each scope's slice is also written to `<scope>/core.md` under
the notes tree — the same text the model sees, so a person can read exactly what the agent always
reads. It is derived: the store regenerates it on every rebuild, and an edit made to it is
overwritten with a `log.md` line that says so and points at `pinned: true`. Pin a note
(`pinned: true`, `memory.replace { id, pin }`, `fabric.pin`) to keep it in the core: a pin moves it
to the front and exempts it from archive and eviction. Stores with no file layout (in-memory,
SQLite, Postgres) show the block only.

### Path cues

A path-scoped note (`scope: "path"` with `applies_to` globs) is shown once per session, in the tail,
when a file tool reads or writes a matching file — the file is the retrieval cue:

```text
- [9c1e…] path procedure (for packages/memory/**) Run memory suites with --timeout=0.
```

Matching is a glob check over notes bucketed by each glob's first literal segment, so one touched
path checks one bucket, not every path note. A verified note wins; a candidate shows only where no
verified note covers the path, marked `(candidate)`. At most `cues.maxPerTurn` notes per turn (2 by
default) within `cues.budgetTokens` (300 by default, hard 1000), ordered by storage strength `S`,
then retrieval strength `R`. Paths come from the session's touched-path tracker and must be
workspace-relative, so a path outside the project never matches. The lines join the semantic tail
block and stay in the untrusted envelope; the text passes the redactor.

Cross-source dedup drops a note already in the core, already injected by topic, already cued, or
whose text is verbatim in a visible file read. Injected cues join the citation tracker, so citing
one counts as a use. The injected set lives in session state, so a restore never shows a cue again,
and a turn with no new path runs no query. `cues: false` makes no index query and adds no lines.

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
when anything was quarantined. Team notes never enter the pinned core, never count toward capacity,
and never count toward widening: only private project notes prove a cross-project lesson.

**Writing needs a person.** The agent has no write path: `memory.insert` refuses `scope: "team"`,
and no other tool reaches the store. `memory:share { id }` moves one verified private project note
(`fact`, `preference`, or `procedure`) into the team tree:

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
- **Dated and source-backed.** `tRef` is the user entry's timestamp; `sourceEntryIds` are the two
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
- **Lifecycle.** Exchanges decay with their own `lifecycle.decay.exchange` (default 0.5) and are
  subject to the same capacity and archive rules as other notes. They are never promoted, never
  pinned to core, never shared with the team store, and never written by a tool.
- **Security.** The kernel writes session entries after redaction, so an agent redactor has already
  replaced its secrets before the archive reads the turn; an explicit `redactor` passed to the
  module additionally *refuses* a turn it would rewrite rather than storing altered history. The
  text is passed through `scanScopedMemoryContent` first, and a refusal (prompt injection,
  exfiltration, invisible Unicode) is counted and reported through `prism.status.note`, never
  stored.

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

### Recommended conversational profile

The exchange archive plus passive injection plus the read tools is the configuration that passed a
live held-out acceptance for conversational recall, and it is **opt-in**: the measured arm archives
exchange text, which is a storage decision no quality result should make for a host on its own.

```ts
fabric({
  exchanges: {},                                   // archive every completed turn
  inject: { query: "task", kinds: ["exchange"] },  // passive block: the best exchanges, by rank
  semantic: true,                                  // leaves memory.recall / memory.read visible
  promote: false,                                  // no extractor call, so no per-session model cost
})
```

Measured on 100 unused LongMemEval-S ids (2026-10-23, `mimo-v2.5`, temperature 0), against the same
store with the tools hidden and against a whole-history prompt:

| | Passive only | Passive + tools | Whole history |
| --- | ---: | ---: | ---: |
| Judge accuracy | 49/100 | **76/100** | 69/100 |
| Multi-session | 10/40 | **28/40** | 23/40 |
| Input tokens per question | 6,378 | 29,669 | 112,955 |
| Tool calls per question | 0 | 1.5 | 0 |

Passive-plus-tools is a full-context substitute at 26% of the tokens, and the gain comes from the
agent pulling rounds the block cut (evidence coverage 0.63 → 0.83), not from a larger injection. The
price is the extra steps: about 3.5k injected tokens per turn and 1.5 tool calls per question, with
2% of questions hitting the eight-turn limit. Facts (`promote`) were not needed for this result; the
`fabric-xc` arm that extracts them was not selected. Full evidence:
`docs/_evidence/memory-bench/188.10/README.md`.

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

Three disclosure levels keep the prefix small:

1. the directory block (always in the prefix, capped);
2. `memory.view` with no `path`: the same summary plus the full topic and file lists, 50 per page,
   paged by `offset` (topics cap at 200);
3. `memory.recall` and `memory.read` for content.

`memory.view { path }` still lists a directory under the root. Without a directory (`directory:
false`, or a fabric built without one) a path-less `memory.view` lists the root as before.

**Cache stability.** The block is recomputed only after a write that changes it (`remember`,
`correct`, `forget`, consent changes, retention, working-block edits, the startup file reconcile).
The result is cached per memory instance and keyed by a write counter, so a turn with no write
sends byte-identical text: the sort is stable and nothing carries a timestamp. Consequences: a note
whose `validTo` passes between writes stays counted until the next write; writes from another
process reach this one on its next restart; and a host-supplied `Memory` that is not the one the
package creates must call `directory.invalidate()` itself. The block is dropped silently when the
fabric holds nothing, or when the store cannot aggregate (`countByKind` / `topTags`).

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

## Tools

| Tool | Effects | Needs |
| --- | --- | --- |
| `memory.view` | `read` | `tools.root` for paths; the directory needs none |
| `memory.read` | `read` | `tools.root` for paths; a note id needs none |
| `memory.insert` | `edit` | block, file path, or fact/preference/procedure kind |
| `memory.replace` | `edit` | block, file path, or note id |
| `memory.recall` | `read` | — |
| `memory.forget` | `write` | — |

`memory.read` accepts exactly one of `path`, `id`, or `ids` (1–8). A note read returns each note in
full with its header — id, scope, kind, date, and the note's path — through the same scope, consent,
invalidation and redaction filters as recall; an unknown, foreign-scope, or revoked id is
`not_found` for that id alone, and the call reads at most 8 notes. A file read stays jailed and
byte-capped.

`memory.insert` accepts exactly one of `block`, `path`, or `kind: "fact" | "preference" | "procedure"`.
Typed notes accept `supersedes`, `tRef`, `validFrom`, `validTo`, `tags`, `keywords`, `scope`,
`appliesTo`, and `key`. The scope rule in the description is precision-first: user-wide preferences
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
before changing it. Working memory stays in the prefix and changes on writes.

Opt in with `inject: { query: "task" }`; the defaults are `minSimilarity: 0.2`, `topK: 12` and
`budgetTokens: 4000`, so an opted-in turn adds **about 4,000 tokens** of memory at most (measured
mean 3,739 in the ceiling grid and 2,865 in the shipped-query delivery diagnostic over the 140
development questions). Delivery fills by rank with **whole** notes: each
note renders in full while it fits the remaining budget, up to `topK`, and a later note that does
not fit whole is **skipped, not truncated** — a shorter note after it may still fit. The best
matching note is always shown: when it alone exceeds the budget it renders as an excerpt centred on
the densest run of matched query terms, of the whole budget, ending
`(excerpt; memory.read <id> for the full note)`. Shown notes are delivered in **time order**
(`tRef` else `ingestedAt`, ties by rank) with their date header, so a knowledge update is read after
the value it replaces; ranking still decides *which* notes are selected. Rendering changes how much
of a note is shown, not which notes are ranked or filtered, and adds no query, write, or model call;
injected tokens stay within `budgetTokens` with no exception. The defaults come from the frozen
ceiling grid (plan 188.9 Task 5): at the ~4,000-token cost anchor they deliver the most needed
evidence of any cell whose per-ability answer visibility does not fall below the 600/3/0.35 control.

**When the block is a selection, it says so.** If fewer notes are shown than were eligible after the
similarity floor (before `topK` or the budget cut them), the block ends with one line:
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
working prefix, the directory, and the semantic tail — is marked
`untrusted`, `inert`, and `injectionCapable`, so remembered text is never treated as host
instructions.
The `minSimilarity` floor (default `0.2`) is applied to the active mode's similarity: query-term
coverage in lexical mode (calibrated in plan 188.1 Task 2) or pre-fusion vector cosine in hybrid
mode (provisional until plan 188.6). A hybrid opt-in host gets one status note naming the embedder and floor. Empty results
inject nothing; the recall tool says `no match in any kind`.

`memory.recall` is the agent's detail channel: one call returns at most **1,200 rendered tokens**
(the `budget`, counted on the snippet lines it prints, header, path and matched terms included) and
each snippet is the densest window of matched query terms in its note, capped at 600 characters.
Every line carries the note's relative path; `memory.read <id>` returns the note whole. Without
`kinds` the tool searches **every stored kind except `working`** (that tier is already in the
prefix), so an episode or a procedure from stored history answers without a second call. It makes
exactly one recall query — there is no kind-discovery follow-up — and an empty result is the single
stop line `no match in any kind`.

Fabric recall uses the store's lexical leg and, in hybrid mode, the vector leg too, fused with
`fuseRankings` before optional recency/importance scoring. Lexical-only stores use the lexical
ranking alone. Each scope is queried separately and the union is ranked as described under
[Recall across scopes](#recall-across-scopes); injected lines name the level (`[id] user preference
2026-09-30 …`). Passive kinds default to `fact`, `preference`, and `file`; `inject.kinds` or
recall's `kinds` can name others, and `kinds: ["all"]` means every kind (`working`, `episode`,
`fact`, `preference`, `procedure`, `file`). The tool's own default is wider — every kind but
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

The semantic block is placed immediately before the latest user message through
`withTailContext`, with `fabric-semantic` source and item-id accounting metadata. It leaves the
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
