# @arnilo/prism-wiki

> **Experimental in 0.13.0.** Install with `bun add @arnilo/prism-wiki@experimental`. Outside the
> [stability promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md) of the stable packages: its API,
> config, preset contents and defaults may change or be removed in any release until it graduates.
> Graduation is the memory track's final step, which sets the first stable version.

**The wiki: knowledge outside memory.** It keeps concepts in its own store: one concept per subject, each claim citing the
evidence it rests on, with relations and open questions. A background curator consolidates evidence into concepts, the
agent reads them with `wiki.search` and `wiki.read`, and at most one passive pointer per turn names a concept that is in
play. Evidence is the wiki's own ingested sources and, when long-term memory is installed, memory notes read through the
read-only `memory.ltm` service. The wiki never writes memory. The [example](../../../examples/memory-and-wiki.ts) runs it
beside the memory packages.

**Status: opt-in and unmeasured.** Nothing in this package changes a default, and no quality claim ships from it until the
memory track's acceptance run decides. The ontology moved here from `@arnilo/prism-memory-fabric` in plan 216 Task 3
(owner decision 2026-11-08); `docs/migrate-to-0.13.md` ("Wiki → knowledge outside memory") maps every moved name.

## Install

```bash
prism add @arnilo/prism-wiki --version 0.13.0-experimental.0
```

```jsonc
// manifest entry; every field is optional
{ "package": "@arnilo/prism-wiki", "config": { "root": "./.prism/wiki", "consolidate": { "model": "openai/gpt-5-mini" } } }
```

It needs no other package. With [`@arnilo/prism-memory-fabric`](../../memory/fabric/README.md) installed (`semantic` on, the
default) it also reads memory notes through `memory.ltm`; package order does not matter, because the service is resolved
per call. Without memory it runs on its own sources, and `wiki:status` says so.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `root` | string | `<workspaceRoot>/.prism/wiki` | Contract. Where the store lives and sources are staged. One root serves one project's memory; keep it outside memory's `tools.root`, which mirrors the files under it as notes. |
| `store` | `"markdown" \| "memory"` | `"markdown"` | Contract. `memory` keeps the wiki for one process (tests, demos). |
| `search.maxClaimsRendered` | integer 1–32 | `8` | Tuning. Claims one concept hit shows in `wiki.search`, chosen by term overlap with the query. |
| `bindThreshold` | integer 1–8 | `2` | Tuning. Matched tokens of one subject name (slug, title or alias) that bind evidence to that subject when exactly one subject qualifies; a whole multi-token name always qualifies. |
| `pointer` | boolean | `true` | Contract. Add the passive concept pointer to `context.build`. |
| `consolidate.model` | string | the agent's model | Model ref for the concept pass. Never a secret. |
| `consolidate.minNotes` | integer 1–100 | `5` | Tuning. A bound subject with this many uncited notes, or this many unbound notes sharing a keyword, is due. |
| `consolidate.minCoReads` | integer 1–20 | `2` | Tuning. Notes read and used together in this many answering turns are due. |
| `consolidate.triggers` | `("co-read" \| "accumulation" \| "repair")[]` | all three | Contract. Which policies start a pass. `repair` cannot be removed. |
| `consolidate.minIntervalTurns` | integer 1–1000 | `5` | Tuning. Check for due work at most once per this many completed turns. |
| `consolidate.maxSubjectsPerPass` | integer 1–32 | `8` | Tuning. Subjects and clusters consolidated per pass: at most one model call each, plus one repair. |
| `consolidate.maxClaimsPerConcept` | integer 1–200 | `40` | Tuning. Claims a concept may hold. At the cap only merging and retiring are accepted. |
| `consolidate.maxOutputTokens` | integer 256–16384 | provider default | Output cap for one concept call, capped by the model's own limit. |
| `consolidate.workerLimits` | object | memory-core's limits | The worker-loop limits (`maxTurns`, `maxMessageBytes`, …), the same names and hard caps as `resolveMemoryWorkerLimits` in `@arnilo/prism-memory-core`. |
| `ingest.maxInputBytes` | integer | 33554432 (32 MiB) | Input cap for `wiki_ingest`. Can only be lowered. |
| `ingest.maxExtractBytes` | integer | 2097152 (2 MiB) | Extract cap; a larger extract is truncated. Can only be lowered. |
| `workspaceRoot` | string | `process.cwd()` | Root that `path` ingest sources must resolve inside. |

Unknown fields are rejected, so a 0.12 config fails at load. The 0.12 fields are gone (`docs/migrate-to-0.13.md`). Tuning fields may change between minor versions; `consolidate.model`, `consolidate.triggers` and the edit vocabulary below are contract.

## What it changes

- **The store.** Markdown under `root` by default (directories 0700, files 0600 through a temp file and a rename, the fabric markdown store's modes):

  ```text
  <root>/<scope>/concepts/<subject>.md   one concept: JSON-valued frontmatter, then the concept grammar below
  <root>/<scope>/bindings.json           evidence id → subject
  <root>/<scope>/.wiki-state.json         the memory scope this level belongs to, the deletion-feed cursor, the last body written
  <root>/sources/<utc>-<slug>/            the staged original, extract.md and source.json
  <root>/log.md                           rejected and quarantined edits
  ```

  A concept body is one line per item with stable ids and footnote citations (`- [c1] Retries back off.[^3f1c9e2a4b70]`), with
  `## Open questions` and `## Contradictions` sections. A citation is a 12-character id: a memory note in the concept's own
  scope, or a wiki source (project scope). Each level of a root is pinned to the `memory.ltm` scope identity it first read: a
  second project pointed at the same root fails closed with `MemoryScopeError`, so give each project its own root (the default).
- **Reading memory.** Through `memory.ltm` only: `scopes`, `scopeId`, `epoch`, `read` (32 ids, the same scope, consent and
  invalidation filters as `memory.read`), `scanMetadata`, `activity` and `deletions`. There is no write member, so the wiki
  cannot write memory. `working` blocks and `episode` views are never shown to it.
- **Deletion cascades from memory, with no model call.** When a cited memory note is forgotten, revoked or held, every
  claim, question and contradiction citing it is removed and the concept is marked for repair (`removed`); a concept left
  with no claim is archived. A corrected, superseded, archived, demoted or flagged note marks its citing items stale. The
  wiki learns of deletions two ways:
  - the deletion feed, `memory.ltm.deletions(since)`, read on open and again after every memory retraction epoch (any
    context build, search, read, status or pass catches up first);
  - an open-time liveness check: every memory id a concept cites is read back in batches of 32, and a missing id is removed.
    That catches hard deletes that leave no invalidation record (retention, capacity eviction, import replace).

  A wiki that was not loaded when the note was forgotten still catches up before it renders. The read side checks again: a
  claim whose citations are not all readable is never rendered or returned. Read-only scopes (`team`) do not cascade: their
  citations are provenance, and the private notes they name never travelled with them.
- **The concept pass.** A background pass edits concepts in the wiki's store. It never writes any other way.
  - *When it runs.* It is checked when a session opens and every `consolidate.minIntervalTurns` completed turns, inside `session.background("wiki.consolidate")`, under one lease per scope. A check with nothing due makes no model call.
  - *Binding.* Before planning, the pass binds new evidence deterministically (no model call): a topic key a memory writer gave is adopted, and otherwise exactly one subject whose name has `bindThreshold` tokens in the note binds it. A binding flags the concept for another pass. Ingest binds a source the same way.
  - *What makes work due.* Three policies, per `user` and `project` scope:
    - **co-read** (primary): memory notes the agent read and used together in at least `minCoReads` answering turns. When they share a subject, that subject is due; when none is bound, they are a new-subject candidate.
    - **accumulation**: a bound subject with `minNotes` notes its concept does not cite yet, or `minNotes` unbound notes sharing an enrichment keyword. An ingested source counts as `minNotes` notes by itself.
    - **repair** (always): a concept whose claims lost or changed a citation.
  - *What one call does.* One model call per due subject or cluster, through the memory worker loop (`@arnilo/prism-memory-core`), with one tool, `edit_concept`. The input is the concept's claims with ids, its relations and open questions, up to 24 new notes (newest first), and the scope's subject list.
  - *The edits.* `create_subject`, `bind`, `add_claim`, `update_claim`, `retire_claim`, `merge_claims`, `add_relation`, `add_open_question` and `note_contradiction`. There is no operation that rewrites a concept. Every claim and question cites at least one shown note, a claim is at most 280 characters, and `merge_claims` cites exactly the union of the claims it merges.
  - *What is checked.* The answer is validated whole before anything is written: every id must have been shown, every citation must be a readable active note of the concept's own scope (a foreign-scope, forgotten, flagged or inactive id rejects the batch), a subject slug (`[a-z0-9.-]`, at most 64) must be unused, and above the claim cap only `merge_claims` and `retire_claim` are accepted. A claim a person wrote (marked `human`, or with no citation) is read-only to the pass (`claim_human`).
  - *Provenance.* Each concept carries `generated: { by, at }`.
- **Curation.** A concept is a markdown file you can edit. The store reviews a file whose bytes differ from what the wiki last wrote before using it (no model call):
  - what you changed or added is marked `[c1 human]` and is yours: the pass never rewrites it;
  - a body that breaks the grammar is rejected, the last valid version stays in use, your file is left as you wrote it, and `log.md` gets an `invalid-concept` line;
  - the trust scan still runs on the title, aliases and body, so an edit that trips it quarantines the concept as a `candidate` (and `log.md` gets a `flagged-concept` line) until a clean edit lifts it; a quarantined concept is never searched, read or pointed at.
- **Team concepts.** A concept a person checks into `<root>/team/concepts/` is read only: the pass never plans or writes `team`, `wiki:lint` reports on it, and its citations are provenance. It is listed only when memory's team scope is attached.
- **Tools.**
  - `wiki.search { query, scope?, limit? }`: concepts first, each as a header, its current claims with the ids they cite, and one drill-down line (`wiki.read { ids: [...] }`). Ranking is term overlap with the names (weighted) and the current claims, then recorded reads. A stale claim never appears.
  - `wiki.read { id | ids | subject, scope? }`: a concept's whole body with claim ids, `(stale)` and `(uncited, human)` labels; or up to 8 cited notes (memory notes through `memory.ltm`, or wiki sources) in full.
  - `wiki_ingest { text | path | url, title? }`: stages the immutable original and a UTF-8 extract under `<root>/sources/<utc>-<slug>/`, records the source in the store (one staged write, no model call, no memory note), binds it when exactly one subject fits, and marks that concept for the next pass. The result carries `noteId` (the id to cite), `scope`, `subject` and `indexed`. A source the trust scan refuses is staged but not recorded as citable (`indexed: false`, `refused`). A `store: "memory"` wiki has no stage root, so ingest fails closed before anything is fetched or written.
- **Passive pointer.** With `pointer` on, the wiki adds one `context.build` block per user turn naming at most one concept whose subject is in play: every token of one of its names is in the turn's words, or a path the session's `read`/`edit`/`write` tools touched falls inside its `appliesTo` globs (the path-scoped cue). The block is one line (`- [id] concept payments — wiki.read id`), carries no claim, and is computed once per user turn, so a rebuild of the same turn is byte-identical.
- **Commands.**
  - `wiki:status`: concepts and dirty subjects per readable scope, the number of sources, whether memory is attached, and the last pass with its calls and tokens. No model call, no note text.
  - `wiki:consolidate`: run one pass now, inline. It treats any subject with new evidence as due, whatever its count.
  - `wiki:ingest`: the same ingest as the tool.
  - `wiki:lint [scope]`: a read-only health report per scope (`user`, `project`, `team`, or all readable), with no model call. It reports unresolved citations and alias collisions (the only two findings that make the report `ok: false`), stale citations, uncited human claims, candidate-only claims, missing relation targets, concepts over the claim cap, team concepts whose citations are provenance only, human-edited concepts, unparseable bodies and unbound notes older than three passes. It costs one read per 32 concepts plus one per 32 distinct cited notes (under 2 s for 2,000 concepts on the in-memory store).
- **Services.** Requires none. Consumes `memory.ltm` (read only) and, for `url` ingest, `web.fetch`, both per call. Provides none.

## Capabilities

- `models`: the concept pass calls the model named in `consolidate.model`.
- `background`: the pass runs in `session.background("wiki.consolidate")`.
- `session-state`: the last pass is recorded on the session branch for `wiki:status`.

## Cost, security, and failure behavior

- **Model calls.** Setup does no I/O, and every read surface is model-free. The concept pass is the only model spend: at most `maxSubjectsPerPass` calls per pass plus one repair each, at most about 6k input tokens per call at the caps, and none on a check with nothing due. The system prompt and the tool schema are byte-identical across calls, so a provider that caches prompts reads them from cache. The default is not to install the package.
- **Reading memory (measured, plan 216 Task 3).** In-memory LTM, markdown wiki store, 5 runs each: the open-time reconcile (deletion feed plus reading back every cited id) took 16–22 ms with 200 concepts citing 400 notes, and 147–176 ms with 2,000 concepts citing 4,000; one deletion-feed read after a retraction epoch took 1–2 ms and 8–9 ms; a refresh with nothing new took about 0.1 ms. Each search or read also reads back the ids its shown claims cite (at most 256 per search, in batches of 32).
- **Writes.** The wiki writes only its own store. Every text passes the trust scan and the host redactor (`refused: <class>`), a claim needs a citation, and only `user` and `project` are write scopes. The pass reads only the scope it writes. Ingest writes under `<root>/sources/` and never outside it (a symlinked `sources/` is refused).
- **Fails closed.** An invalid answer is rejected whole and writes nothing for that subject; one shape or truncation failure gets one repair call with a safe reason code; a second failure, an abort or a worker limit leaves the subject due. A failed subject never fails the pass or a turn. A root that belongs to another project's memory fails with `MemoryScopeError`. `url` ingest SSRF-checks the URL first, then needs `web.fetch`. An unsupported format, an oversize input or a `path` outside the workspace is a named error.
- **Untrusted content.** An ingested source is marked `untrusted_external`; the kernel wraps it in its envelope. Note text, claim text and titles inside a concept call are untrusted data, and the prompt says to ignore instructions found in them.
- **Known limits.** User-scope concepts live under the root that wrote them, so two projects with separate roots keep separate user concepts. A concept file written from scratch has only the `human` markers it was written with. The unbound-note lint rule counts this process's passes only. The pass has no secret list of its own, so the secret counter moves only when a host redactor is supplied. There is no command that shares a concept into the team scope yet.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import memoryFabric from "@arnilo/prism-memory-fabric";
import { wiki } from "@arnilo/prism-wiki";

const agent = await createAgent({
  model: "openai/gpt-5",
  packages: [
    memoryFabric({ preset: "coding", tools: { root: "./.prism/memory-local" } }),
    wiki({ root: "./.prism/wiki", consolidate: { model: "openai/gpt-5-mini" } }),
  ],
});
await agent.commands.run("wiki:consolidate", {});
const status = await agent.commands.run("wiki:status", {});
```

## Related APIs

- `@arnilo/prism-memory-fabric`: long-term memory; provides the read-only `memory.ltm` service the wiki reads.
- `@arnilo/prism-memory-core`: the worker loop and limits, and the trust scan the wiki runs.
- `@arnilo/prism-rag`: the PDF parser and document byte cap the ingest uses.
- `@arnilo/prism-tools-web`: provides the `web.fetch` service for `url` ingest.
