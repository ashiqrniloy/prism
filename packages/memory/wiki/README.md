# @arnilo/prism-memory-wiki

**Tier 2 of Prism's three-tier memory.** [`@arnilo/prism-memory-observational`](../observational/README.md) (T0) observes the session, [`@arnilo/prism-memory-fabric`](../fabric/README.md) (T1) keeps the notes as the single store of record, and this package consolidates those notes into concepts without storing anything of its own. An agent reads a concept first through `memory.recall` and drills down to the notes it cites. The [example](../../../examples/three-tier-memory.ts) runs all three.

The ontology tier for Prism memory: installing it adds one `concept` note per subject over the fabric's notes, each claim citing the evidence it rests on.

**Status: opt-in and unmeasured.** Nothing in this package changes a default, and no quality claim ships from it until the plan 210 acceptance run decides. This page describes what the package does today.

## Install

```bash
prism add @arnilo/prism-memory-wiki
```

```jsonc
// manifest entry; every field is optional
{ "package": "@arnilo/prism-memory-wiki", "config": { "consolidate": { "model": "openai/gpt-5-mini" } } }
```

It requires [`@arnilo/prism-memory-fabric`](../fabric/README.md) with `semantic` memory on (the default). Without it, `createAgent` fails closed with `missing_service`, naming `memory.fabric` and this package. Package order does not matter.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `consolidate.model` | string | the agent's model | Model ref for the concept pass. Never a secret. |
| `consolidate.minNotes` | integer 1–100 | `5` | Tuning. A bound subject with this many uncited notes, or this many unbound notes sharing a keyword, is due. |
| `consolidate.minCoReads` | integer 1–20 | `2` | Tuning. Notes read and used together in this many answering turns are due. |
| `consolidate.triggers` | `("co-read" \| "accumulation" \| "repair")[]` | all three | Contract. Which policies start a pass. `repair` cannot be removed. |
| `consolidate.minIntervalTurns` | integer 1–1000 | `5` | Tuning. Check for due work at most once per this many completed turns. |
| `consolidate.maxSubjectsPerPass` | integer 1–32 | `8` | Tuning. Subjects and clusters consolidated per pass: at most one model call each, plus one repair. |
| `consolidate.maxClaimsPerConcept` | integer 1–200 | `40` | Tuning. Claims a concept may hold. At the cap only merging and retiring are accepted. |
| `consolidate.maxOutputTokens` | integer 256–16384 | provider default | Output cap for one concept call, capped by the model's own limit. |
| `consolidate.workerLimits` | object | the fabric's limits | The worker-loop limits (`maxTurns`, `maxMessageBytes`, …), same names and hard caps as the fabric's `workerLimits`. |
| `ingest.maxInputBytes` | integer | 33554432 (32 MiB) | Input cap for `wiki_ingest`. Can only be lowered. |
| `ingest.maxExtractBytes` | integer | 2097152 (2 MiB) | Extract cap; a larger extract is truncated. Can only be lowered. |
| `workspaceRoot` | string | `process.cwd()` | Root that `path` ingest sources must resolve inside. |

Unknown fields are rejected, so a 0.12 config fails at load. The 0.12 fields are gone (`docs/migrate-to-0.13.md`). Tuning fields may change between minor versions; `consolidate.model`, `consolidate.triggers` and the edit vocabulary below are contract.

## What it changes

- **The concept pass.** A background pass reads the fabric's evidence notes and edits concept notes through the `memory.fabric` port. It never writes any other way.
  - *When it runs.* It is checked when a session opens and every `consolidate.minIntervalTurns` completed turns, inside `session.background("wiki.consolidate")`, under one lease per memory scope. A check with nothing due makes no model call.
  - *What makes work due.* Three policies, per `user` and `project` scope:
    - **co-read** (primary): notes the agent read and used together in at least `minCoReads` answering turns. When they share a subject, that subject is due; when none is bound, they are a new-subject candidate. The memory that was just used is the one updated.
    - **accumulation**: a bound subject with `minNotes` notes its concept does not cite yet, or `minNotes` unbound notes sharing an enrichment keyword.
    - **repair** (always): a concept whose claims lost or changed a citation.
  - *What one call does.* One model call per due subject or cluster, through the fabric's worker loop, with one tool, `edit_concept`. The input is the concept's claims with ids, its relations and open questions, up to 24 new notes (newest first), and the scope's subject list.
  - *The edits.* `create_subject`, `bind`, `add_claim`, `update_claim`, `retire_claim`, `merge_claims`, `add_relation`, `add_open_question` and `note_contradiction`. There is no operation that rewrites a concept. Every claim and question cites at least one shown note, a claim is at most 280 characters, and `merge_claims` cites exactly the union of the claims it merges.
  - *What is checked.* The answer is validated whole before anything is written: every id must have been shown in that call, a subject slug (`[a-z0-9.-]`, at most 64) must be unused, and above the claim cap only `merge_claims` and `retire_claim` are accepted. A claim a person wrote is shown as read-only: it carries a `human` marker in the concept file, and so does any claim with no citation. The model may cite it in a contradiction and may not update, retire or merge it, and the fabric refuses such an edit too (`claim_human`). The other claims of that concept stay the curator's to maintain.
  - *Provenance.* Each concept it writes carries `generated.by: consolidation` and the time, and the fabric's markdown store logs the write in `log.md` with that writer.
- **Curation.** A concept is a markdown file you can edit. When you save one, the fabric reviews it before it is indexed (no model call; see the fabric README, "A person's edit"):
  - what you changed or added is marked `[c1 human]` and is yours: the pass never rewrites it, and a later pass keeps the marker;
  - a body that breaks the grammar is rejected, the last valid version stays in use, your file is left as you wrote it, and `log.md` gets an `invalid-concept` line;
  - the trust scan still runs, so an edit that trips it quarantines the concept as a candidate until a clean edit lifts it;
  - a person's correction outranks the curator: the pass does not repair a human edit, it works around it.
- **Team ontology.** Concepts shared with `memory:share` live in `.prism/memory/` and are reviewed like code. `wiki:lint` runs on them. The pass never edits a team concept: it plans only the `user` and `project` scopes, and the port refuses to write `team`. It does not read team concepts either, so it does not note a contradiction between a private and a team concept; `wiki:lint` is where a shadowed or stale team concept shows up.
- **Tool.** `wiki_ingest { text | path | url, title? }` brings a source into the ontology as evidence:
  - it stages the immutable original and a UTF-8 extract under `<tools.root>/sources/<utc>-<slug>/` (the fabric's `tools.root`, inside its file jail) and indexes the extract as a `file` note in the `project` scope. One staged write and one index, no model call;
  - the fabric binds the note to a subject when exactly one fits, and marks that concept for the next pass; an unbound source is offered to the pass as a cluster candidate. A source is due on its own: it counts as `consolidate.minNotes` notes toward the accumulation trigger, so it does not wait for four more;
  - the result carries `noteId`, `scope`, `subject` (when bound) and `indexed`, and the brief says the source is queued, or that `/wiki:consolidate` files it now. A claim that rests on the source cites `noteId`. The agent no longer files pages by hand;
  - forgetting the `file` note, or deleting `extract.md`, removes the claims that cited it (the fabric's cascade); a source stays revoked;
  - a source the trust scan refuses is staged but not indexed (`indexed: false`, `refused`), so it never reaches the pass. The startup reconcile keeps `source.*` originals out of the index: only `extract.md` is a note.
  It needs the fabric's `tools.root`; without it the tool fails closed before anything is fetched or written.
- **Commands.**
  - `wiki:status`: concept notes and dirty subjects per readable scope, and the last concept pass with its calls and tokens. No model call, no note text.
  - `wiki:consolidate`: run one pass now, inline. It treats any subject with new evidence as due, whatever its count.
  - `wiki:ingest`: the same ingest as the tool.
  - `wiki:lint [scope]`: a read-only health report per scope (`user`, `project`, `team`, or all readable). It makes no model call and reads the `memory.fabric` port only; it costs one read per 32 concepts plus one per 32 distinct cited notes (about 0.1 s for 2,000 concepts on the in-memory store). It reports, per concept:
    - **unresolved citation** and **alias collision**: the only two findings that make the report `ok: false`;
    - a claim whose citation is **stale** (superseded or archived);
    - an **uncited human claim**;
    - a claim that rests **only on candidate notes**;
    - a **relation to a subject** that is no longer a live concept;
    - a concept **over the claim cap** (`consolidate.maxClaimsPerConcept`);
    - a team concept with **citations shared without evidence** (the cited notes are private and are not in the team store, so the citations are provenance only and are not checked);
    - a concept a person **edited** since the curator last wrote it;
    - a body that no longer parses;
    - an **unbound note** older than three concept passes (an ontology gap). The pass count is this process's, so the rule reports why it did not run until three passes have happened.
    Everything but the first two is maintainer work.
- **Service.** Requires `memory.fabric`; provides nothing. `web.fetch` is consumed per call for `url` ingest.
- **Reading the ontology needs no tool from this package.** Concepts are fabric notes: `memory.recall` returns them ahead of notes whenever the store holds any, and `memory.read` follows a citation to the evidence. Forgetting a note removes every claim that cited it, in the fabric, with no model call and whether or not this package is installed.
- **Retired with the 0.12 compiler.** The search, read-page and record-insight tools, the init, refresh and lint commands, the two bundled skills, the guidance hook, the CLI bin, the page store on disk, the `qmd` client and the old config fields are gone, with no alias. `docs/migrate-to-0.13.md` maps each to its replacement.

## Capabilities

- `models`: the concept pass calls the model named in `consolidate.model`.
- `background`: the pass runs in `session.background("wiki.consolidate")`.
- `session-state`: the last pass is recorded on the session branch for `wiki:status`.

## Cost, security, and failure behavior

- **Model calls.** Setup does no I/O beyond service lookup, and `wiki:status` reads counts. The concept pass is the only model spend: at most `maxSubjectsPerPass` calls per pass plus one repair each, at most about 6k input tokens per call at the caps, and none on a check with nothing due. The system prompt and the tool schema are byte-identical across calls, so a provider that caches prompts reads them from cache. The cost per 1,000 archived exchanges at the defaults is not stated here: plan 208 measures it. The default is not to install the package, which avoids the spend entirely.
- **Writes.** The pass writes only through the fabric port, which scans every text for injected instructions, refuses a claim with no citation, and refuses the `agent` and `team` write scopes. A claim, title or alias that fails the scan, or that a host redactor changes, drops that one edit and is counted (`rejected.trust`, `rejected.secret`); if it is the `create_subject`, the whole cluster is dropped. The pass reads only the scope it writes: it never reads `agent` or `team` notes to write a `user` or `project` concept. Ingest writes under `sources/` inside the fabric's `tools.root`, never outside it (a symlinked `sources/` is refused).
- **Fails closed.** An invalid answer (bad shape, an id that was not shown, an uncited claim, a cap breach) is rejected whole and writes nothing for that subject. A shape-only failure, or an answer cut off by the output limit, gets one repair call with a safe reason code; a second failure, an abort or a worker limit leaves the subject due for the next trigger. A failed subject never fails the pass or a turn. A missing `memory.fabric` service fails the load. `url` ingest SSRF-checks the URL first, then needs `web.fetch`; a missing service is a named error and file ingest keeps working, with a setup note. An unsupported format, an oversize input or a `path` outside the workspace is a named error, and so is a fabric with no `tools.root`.
- **Untrusted content.** An ingested source is marked `untrusted_external`; the kernel wraps it in its envelope. Note text, claim text and titles inside a concept call are untrusted data, and the prompt says to ignore instructions found in them. It is evidence, never instructions.
- **Known limits.** A person's claims are protected by the `human` marker the fabric sets when it reviews a saved edit. A concept file written from scratch over an index that never held it has only the markers (and the missing citations) it was written with, so a cited claim in it is the curator's until you mark it `[cN human]`. The unbound-note lint rule counts this process's passes only. A note the curator saw and left uncited is offered again ahead of older ones. The pass has no secret list of its own, so the secret counter moves only when a host redactor is supplied; the kernel still redacts events.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import memoryFabric from "@arnilo/prism-memory-fabric";
import memoryObservational from "@arnilo/prism-memory-observational";
import memoryWiki from "@arnilo/prism-memory-wiki";

const agent = await createAgent({
  model: "openai/gpt-5",
  packages: [
    memoryObservational({ observer: { model: "openai/gpt-5-mini" } }),
    memoryFabric({ preset: "coding", tools: { root: "./.prism/memory-local" } }),
    memoryWiki({ consolidate: { model: "openai/gpt-5-mini" } }),
  ],
});
const status = await agent.commands.run("wiki:status", {});
```

## Related APIs

- `@arnilo/prism-memory-fabric`: stores the notes and concepts, owns the deletion cascade and provides `memory.fabric`.
- `@arnilo/prism-memory-rag`: the PDF parser and document byte cap the ingest uses.
- `@arnilo/prism-tools-web`: provides the `web.fetch` service for `url` ingest.
