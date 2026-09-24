# Memory fabric

## What it does

Typed notes over the memory stores a host already configured. `createMemoryFabric()` does not add a
store, a database, or a second memory engine: it writes notes through `createMemory()` and reads them
back with the same consent, redaction, and lineage rules.

| Kind | Backing store | Notes |
| --- | --- | --- |
| `fact` | vector store | `metadata.fabric` carries the note fields. |
| `procedure` | vector store | Never returned by an untyped recall; request `kinds: ["procedure"]`. |
| `file` | vector store | `path` is required; `content` defaults to the path. The fabric does not read the file. |
| `working` | working store | Labeled block under the `_fabric.blocks` key of the scope's working value. |
| `episode` | observational memory | A **view** over an existing observation id. Nothing is written. |

`recall` returns ranked notes plus a parallel `explain` row for each hit, and `searchConversation`
lexically searches the current branch and returns the observational-memory page around each match.
`tools()` builds the five governed tools a host may hand to an agent, and `forget` tombstones one note
or working block.

### Relationship to observational memory

Observational memory stays **episodic**: its ledger is still the source-backed record of what happened
in a session, its observer/reflector/dropper workers are still the only writers of observations and
reflections, and nothing here re-observes, re-folds, or re-scores a transcript. The `episode` kind is a
**view**: it reads an existing 12-hex observation id through the attached session's ledger and stores
nothing, so an episode note cannot disagree with the observation it names, and a valid id that survives
folding keeps working without a copy. Semantic (`fact`, `procedure`, `file`) and working notes are the
fabric's own rows in the stores `createMemory()` already owns; they never become observations. Hosts
that want a concluded case promoted out of the ledger write the generalizable part as a `procedure` and
keep the specifics as a `fact` or an `episode` view — promotion is an explicit host decision, and one
that a case conclusion filed as a `procedure` fails an invariant on (see the eval fixture below). The
fabric can make that decision cheap without turning it into an implicit one: for `fact`/`procedure`,
`remember({ reflectionId })` derives the note content from a reflection that carries an explicit
`om.scope.bound` entry on a **closed** work scope ([work-scope index](compaction-observational-memory.md)).
An unknown, unbound, or open-scope-only reflection is rejected, the note records the bind it came from
as `promotedFrom: { reflectionId, scopeId }`, and no other field changes — the fold, consent, and
worker rules of a normal `fact`/`procedure` write all still apply.

An imported fabric starts nothing: no workers, no timers, no tools, no context provider until a host
calls one of its methods. Calling `tools()` registers nothing anywhere — it returns definitions.

### Write path (consolidation, default on)

A `fact`, `procedure`, or `file` write first recalls the nearest same-kind note (one bounded
`memory.recall` batch using the same oversample factor recall uses) and then folds:

| Nearest note | Write |
| --- | --- |
| below `consolidate.threshold` (default 0.85) | insert a new row. |
| the same note — same tokens, or the same `path` for `file` | rewrite that row in place: same id, annotations union, the new note's claims win. |
| the same subject with changed content | set `validTo` on the old row, then insert a new row carrying `supersedes`. |

A `file` note never folds across paths (two paths are two documents), `working` notes are already
keyed by block label, and `episode` views write nothing. A rewrite keeps the row's `createdAt`,
consent, importance, and every non-fabric metadata key; an explicit `id` or `supersedes` from the
caller disables auto-folding for that write.

### Following the file (path moves and deletes)

A `file` note names its document by `metadata.path`, and that path — not a lineage edge — is the only
link between note and file. Notes are store-backed metadata rather than derived chunk rows, so the
`_lineage` walk that revokes derived records can never find them: this handler is the only path.

```ts
import { createFabricRepointHandler } from "@arnilo/prism-memory/fabric";

// One handler, both seams: a move rewrites `metadata.path`, a delete tombstones.
const notes = createFabricRepointHandler({ scope, vectorStore: store });
await repointSource({ scope, vectorStore: store, from: "docs/a.md", to: "docs/b.md", authorization: principal, handlers: [notes] });
await createDeletionPropagator({ scope, vectorStore: store, authorization: principal, handlers: [notes] }).propagate("docs/a.md");
```

- Move: only `kind: "file"` notes whose `path` is the moved id are touched. Id, text, embedding,
  `sourceEntryIds`, and every other metadata field are reused verbatim — no re-embed, no re-score, and
  no `_lineage` field invented, so the walk stays for records that really are derived. Non-file notes
  and notes for other paths are untouched, and the write joins one store transaction when the store
  has one (a plain `upsert` otherwise).
- Delete: the notes recorded against the deleted path are tombstoned through the store's own
  invalidation path (`invalidate`, batched at `HARD_INVALIDATION_BATCH`; the propagation's resolved
  reason wins, `forgotten` by default, `legal_hold` stamps `hold: true` — the handler's own `reason`
  option is only the fallback for a hand-built context), so recall stops serving them
  with no second revocation plane and no background cleanup to wait for.
- One scope read per leg, selecting on `metadata.fabric.path` — never on content. A note in another
  scope is never visible, and a composition whose scope differs from the handler's is refused
  (`MemoryScopeError`) instead of writing across threads.

### Workers (opt-in)

Both workers run inline (awaited) after the write, see redacted text only, call no model and no
tools, and are skipped entirely by `passive: true`:

| Worker | Option | Does |
| --- | --- | --- |
| Linker | `linker: { enabled, topK }` (off by default, `topK` 3) | stores `related` edges to the closest neighbors, weight = embedding similarity. |
| Evolution | `evolution: { enabled, maxPatches }` (off by default) | unions the new note's keywords into neighbor notes and fills a missing neighbor `context` — never content, validity, consent, or `sourceEntryIds`. |

Workers run only while a session is attached (`attach`), so an unattached fabric enriches nothing even
when the options ask for it — the plain `remember` path writes notes and stops there.

## When to use it
Use it when a host wants durable, time-bounded notes (facts, procedures, file references, promoted
episodes) alongside the plain working/semantic memory it already has, or wants one call that returns
both the matching notes and why they matched. Skip it when plain `createMemory()` recall is enough —
the fabric is an opt-in layer, not a replacement.

## Inputs / request

**Option surfaces** — `createMemoryFabric` takes `CreateMemoryFabricOptions`; `attach` takes `MemoryFabricAttachOptions`; `tools()` returns definitions configured by `MemoryFabricToolsOptions`; the reflection paths use `MemoryFabricWriteOptions` and `MemoryFabricRecallOptions`; and the opt-in workers are configured by `MemoryFabricConsolidationOptions`, `MemoryFabricLinkerOptions`, `MemoryFabricEvolutionOptions`, `MemoryFabricConversationSearchOptions`, and `CreateFabricFileJailOptions`.

`createMemoryFabric(options)`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `memory` | `Memory` | yes | An existing `createMemory()` instance; supplies scope, embedder, stores, consent, and limits. |
| `observational` | `{ session: { entries() } }` | only for `episode` | An attached observational-memory session (`om.attach(session)` result satisfies it). |
| `consolidate` | `boolean \| { threshold? }` | no | Default `true`; `false` writes unconditionally, `threshold` (default 0.85) is the cosine floor for folding. |
| `linker` | `boolean \| { enabled?, topK? }` | no | Default off; `topK` defaults to 3 and is capped at 32. |
| `evolution` | `boolean \| { enabled?, maxPatches? }` | no | Default off; `maxPatches` defaults to the worker per-turn budget and is capped at 32. |
| `passive` | `boolean` | no | `true` skips both opt-in workers; consolidation is part of the write path and still runs. |
| `workerLimits` | `MemoryWorkerLimitOptions` | no | Observational-memory worker caps resolved by `resolveMemoryWorkerLimits` (patches per write, patch payload bytes). |

`remember(input)` fields:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `kind` | `"working" \| "episode" \| "fact" \| "procedure" \| "file"` | yes | Note kind; unknown kinds throw. |
| `id` | 12-hex string | `episode` yes | Note id (the observation id for `episode`). Derived when omitted for `fact`/`procedure`/`file`; rejected for `working`. |
| `content` | non-empty string | except `episode`, or `fact`/`procedure` with `reflectionId` | Note text, capped by `limits.maxEntryTextChars`. |
| `reflectionId` | 12-hex string | no | Derives content from an observational-memory reflection; `fact`/`procedure` only, rejected with `content`, and the reflection must be bound to a closed work scope. |
| `block` | `[a-z0-9][a-z0-9._-]{0,63}` | `working` yes | Block label; the working note id is derived from it. |
| `path` | non-empty string | `file` yes | Workspace path; stored as metadata. |
| `tRef` / `validFrom` / `validTo` | ISO timestamp | no | Reference time and validity window: `validFrom` inclusive, `validTo` exclusive. |
| `keywords` / `tags` / `sourceEntryIds` | non-empty strings | no | Annotations; `sourceEntryIds` are session entry ids. |
| `context` | non-empty string | no | Short context line. |
| `links` | `{ id, relation?, weight? }[]` | no | Edges to other note ids (12-hex). |
| `supersedes` | 12-hex string | no | Id of the note this one replaces. |
| `importance` | number in [0,1] | no | Stored recall weight. |
| `consent` | `MemoryConsentInput` | no | Forwarded to `createMemory()`; the fabric never widens visibility. |

`recall(query, options)`

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `kinds` | `MemoryNoteKind[]` | `["fact", "file"]` | Kinds to return; `procedure` and `working` are opt-in. Empty or unknown kinds throw. |
| `asOf` | ISO string or `Date` | now | Evaluation point for `validFrom` / `validTo`. |
| `topK` | number | `memory.limits.topK` | Maximum hits, clamped by the memory hard cap. |
| `budget` | positive integer | none | Ceiling on the summed `tokenCount` of the returned hits. The best hit is always returned; the ranking stops at the first note that would not fit. |
| `scoring` | `RecallScoringOptions` | none | Passed through to `memory.recall()`. |

`searchConversation(query, options)` — lexical search over the current branch, each hit carrying the
observational-memory page around it. Requires the `observational` source; without it the call fails
closed.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `limit` | page limit | 20 | Messages per page around a hit; the observational-memory limit (hard cap 100, out of range throws). |
| `direction` | `"backward" \| "forward"` | `"backward"` | Page direction, same semantics as the branch page. |
| `detail` | `"summary" \| "full"` | `"summary"` | Page rendering detail. |
| `topK` | number | 5 | Matching messages returned; hard cap 100. |
| `signal` | `AbortSignal` | none | Aborts the scan or the page loop. |

`tools(options)` — five inert tool definitions for the host to register. `root` is the directory
the file tools are jailed to; without it those tools fail closed and only block operations work.

| Tool | Kind | Arguments | Does |
| --- | --- | --- | --- |
| `memory.view` | read | `{ path? }` | lists a directory inside `root` (default: the root), names and byte sizes, at most 200 entries. |
| `memory.read` | read | `{ path }` | reads one file inside `root`, cut at the byte cap and flagged when truncated. |
| `memory.insert` | edit | `{ text, block? \| path? }` | appends to a labeled working block, or to a file inside `root` and refreshes that file's note. |
| `memory.recall` | search | `{ query, kinds?, topK?, asOf?, budget? }` | `recall()` with the same kinds, validity, and budget rules. |
| `memory.forget` | delete | `{ id? \| block?, hold? }` | `forget()` with the same tombstone rules. |

`forget(input)` — `{ id?, block?, hold? }`, exactly one of `id`/`block`:

| Target | Effect |
| --- | --- |
| `id` | `memory.forget()` in this memory's own thread scope: rows are marked and deleted, or kept as a `legal_hold` when `hold: true`. |
| `block` | the block's content is cleared and stamped with `forgottenAt`, freeing the label for a later insert. |

The result is `{ id?, block?, deleted, held }` — `deleted` counts removed rows (1 for a tombstoned
block, 0 when the note was held or was not in this scope).

`attach(session, options?)` — the one way to authorize a session, and the only way the workers run.
It returns `{ session, contextProvider, settings, detach() }`; `detach()` (or aborting
`options.signal`) takes the session back. Attaching fails closed on anything that is not a session
(no id, or a non-function `entries`) and on a session that is not the fabric's `observational`
session — an attached session may not read another branch. Nothing happens per turn: no timers, no
loop, no session proxy; `attach` only flips the gate that `tools()` and the workers read.

`createContextProvider(options?)` — the context seam, with the same options as
`memory.createContextProvider` (`includeWorking`, `includeSemantic`, `query`, `topK`,
`messageRange`, `name`). Blocks are tagged exactly like `createMemory`'s: working memory as
`working-memory`, recall as `semantic-memory` — the fabric is semantic memory, so it adds no block
type and no layer id. With the attention compiler off, these blocks still reach the provider input
through the normal context assembly.

### Attach and the definition recipe

A host registers the provider under any name it likes and lists that name in the definition; core
`AgentDefinition` has no fabric field and takes on no memory dependency:

```ts
registries.contextProviders.register("memory-fabric", fabric.createContextProvider());

const agent = await resolveAgentDefinition(
  { name: "assistant", model, context: ["memory-fabric"], tools: ["memory.recall"] },
  { registries, providerSource },
);

const session = createAgentSession({ agent });
fabric.attach(session); // tools run and workers enrich only from here
```

`context: ["memory-fabric"]` resolves through `registries.contextProviders`, so it works only when
the host registered that name; omitting it is the default (an agent with no fabric injection).

A runnable end-to-end demo — notes, folding, supersession, the attach gate, the provider, and
`forget` — lives in `examples/memory-fabric.ts` (network-free, `node examples/memory-fabric.ts`).

### Tools and the file jail

Every tool call is refused unless the fabric was attached to the calling session. `view`, `read`, and
the `path` form of `insert` resolve against `root` and fail closed on anything that leaves it — `..`
segments, absolute paths, and symlinks are all rejected with a `MemoryValidationError`, and no file is
touched when the check fails. A refused insert leaves the file and the working-memory version exactly
as they were.

`insert` appends: a working block grows to `limits.maxEntryTextChars` (over that it throws and the
stored version is untouched, with the write versioned against concurrent writers), and a file grows to
`maxFileBytes` (default 50 KiB, hard cap 1 MiB) with a newline added when the file already has content
and the text does not start with one. A file insert also refreshes the `kind: "file"` note for that
path with the file's text, so recall can find what was written; the indexed text is truncated at
`limits.maxEntryTextChars` and the tool reports `noteTruncated` when it was. Parent directories are
created inside the jail as needed — `view` never creates anything.

## Outputs / response / events

`remember` resolves to one `MemoryNote`: `{ id, kind, content, ingestedAt, tokenCount, ... }` plus the
optional fields above, `scope`, and (for `working`) `block` or (for `file`) `path`. A reflection-derived
note also carries `promotedFrom: { reflectionId, scopeId }`. A folded write
returns the surviving id: the rewritten row for a same-note fold, and a new id carrying `supersedes`
for a superseded one.

`recall` resolves to `{ hits, explain }`: `hits` are notes plus `score` and, when scoring wasrequested, `similarity` and `recency`; `explain[i]` is the parallel provenance row for `hits[i]`
(`{ id, score, similarity?, recency?, importance?, link, valid }`). A hit whose `explain.link` is
true arrived through a `links` edge from a seed hit rather than the query ranking. `working` notes are
not recall hits — they belong to the working value — and a note recorded with `validFrom`/`validTo`
outside `asOf` is omitted.

`searchConversation` resolves to `{ hits, scanned }`: each hit is
`{ entryId, score, timestamp, page }`, where `score` is the share of query terms the message contains
and `page` is the `recallObservationalMemoryBranchPage` result for that message (entries, cursors, and
rendered text). Events are whatever `createMemory()` already emits; the fabric adds none.

## Request/response example

```json
{
  "kind": "fact",
  "id": "2f9c1a0b7d3e",
  "content": "User prefers metric units",
  "validFrom": "2026-01-01T00:00:00.000Z",
  "tags": ["prefs"],
  "metadata": { "fabric": { "v": 1, "kind": "fact", "validFrom": "2026-01-01T00:00:00.000Z", "tags": ["prefs"] } }
}
```

`recall` response shape: `hits[i]` and `explain[i]` describe the same note.

```json
{
  "hits": [
    { "id": "2f9c1a0b7d3e", "kind": "fact", "content": "User prefers metric units", "tokenCount": 7, "score": 0.91, "similarity": 0.91 },
    { "id": "7c4d2f10ab98", "kind": "fact", "content": "Rollout health lives on the deploy dashboard", "tokenCount": 11, "score": 0.42 }
  ],
  "explain": [
    { "id": "2f9c1a0b7d3e", "score": 0.91, "similarity": 0.91, "link": false, "valid": true },
    { "id": "7c4d2f10ab98", "score": 0.42, "link": true, "valid": true }
  ]
}
```

`searchConversation` response shape (one hit, abbreviated page):

```json
{
  "hits": [
    {
      "entryId": "m4",
      "score": 1,
      "timestamp": "2026-01-01T00:03:00.000Z",
      "page": { "found": true, "cursor": "m4", "direction": "backward", "limit": 2, "entries": [], "nextCursor": "m2", "text": "..." }
    }
  ],
  "scanned": 12
}
```

## Implementation example

```ts
import { createMemory, createMemoryVectorStore, createHashEmbedder } from "@arnilo/prism-memory";
import { createMemoryFabric } from "@arnilo/prism-memory/fabric";

const memory = createMemory({
  tenantId: "acme",
  resourceId: "user-1",
  threadId: "thread-1",
  embedder: createHashEmbedder(),
  vectorStore: createMemoryVectorStore(),
});

const fabric = createMemoryFabric({ memory, linker: { enabled: true, topK: 3 } });

await fabric.remember({ kind: "fact", content: "User prefers metric units", tags: ["prefs"] });
await fabric.remember({ kind: "procedure", content: "Deploy via canary first" });
await fabric.remember({ kind: "working", block: "core", content: "Prefers terse output" });

// Same note: rewritten in place, same id, annotations unioned.
const repeated = await fabric.remember({ kind: "fact", content: "User prefers metric units", keywords: ["units"] });
// Changed fact: the old row gets validTo, this note carries supersedes.
const changed = await fabric.remember({ kind: "fact", content: "User prefers metric units and Celsius" });
// changed.supersedes → the id of the note it replaced; changed.links → derived `related` edges.

const { hits, explain } = await fabric.recall("preferred units", {
  scoring: { recencyWeight: 0.3, importanceWeight: 0.2, halfLifeMs: 7 * 86_400_000 },
  budget: 400,
});
// hits[0].content → "User prefers metric units"; procedures stay out until kinds: ["procedure"].
// explain[1].link === true → that hit came in through a links edge from a seed hit.
```

Conversation search over an attached session (`om.attach(session)` result):

```ts
const fabric = createMemoryFabric({ memory, observational: om });
const { hits, scanned } = await fabric.searchConversation("canary rollout", { limit: 4, topK: 3 });
// hits[0].page.entries → the four branch messages ending at the match; hits[0].page.text → rendered window.
```

Giving the agent the tools, jailed to a notes directory:

```ts
const tools = fabric.tools({ root: "/srv/agent/memories", maxFileBytes: 50 * 1024 });
// tools.map((tool) => tool.name) →
// ["memory.view", "memory.read", "memory.insert", "memory.recall", "memory.forget"]
```

Attaching a session and handing its provider to a definition:

```ts
registries.contextProviders.register("memory-fabric", fabric.createContextProvider({ includeWorking: true }));
const agent = await resolveAgentDefinition(
  { name: "assistant", model, context: ["memory-fabric"], tools: ["memory.recall"] },
  { registries, providerSource },
);
const attached = fabric.attach(createAgentSession({ agent }));
// attached.settings.linker.enabled → whether enrichment is live for this fabric
// attached.contextProvider → the same provider the registry now holds
attached.detach();
```

## Extension and configuration notes

The host owns the embedder, vector store, working store, tenant/resource/thread scope, redactor,
`requireConsent` mode, and working-memory schema — the fabric only writes through them. `metadata.fabric`
is the reserved metadata key on vector records, and `_fabric.blocks` is the reserved key inside the
working value; a host schema must allow both if it validates the working value. A host that validates
working values still sees every block append, so its schema remains the last word on block content.
Episode views require an
observational-memory session passed as `observational`; without it, `kind: "episode"` fails closed as
does `searchConversation`. `budget` bounds injected note tokens; `topK` bounds both the primary hits
and the 1-hop expansions.
Enrichment is opt-in per fabric: `consolidate` (default on, `threshold` in [0,1]), `linker.topK` and
`evolution.maxPatches` (both capped at 32), `passive` to skip the workers, and `workerLimits` for the
observational-memory worker caps. Tool schemas are small and fixed, and a host may rename or wrap any
definition it registers.

## Security and performance notes

Everything here is opt-in and inert by default: importing the subpath starts no worker, no timer, and
no context provider, `tools()` registers nothing, and no note reaches a prompt until a host registers a
provider and attaches a session. No fabric path calls a model — not on write, not on fold, not in the
linker or evolution workers, and not in `searchConversation` (lexical coverage, no embedder call) — so
there is no LLM-on-write step an injected document could steer, and no inferred field to audit.

Kinds keep the process/case split: `procedure` is the reusable recipe and never comes back from an
untyped recall, while case-bound specifics belong in `fact`/`file` or in an `episode` view. A case
conclusion filed as a `procedure` is caught by the package's invariant fixture
(`caseConclusionsNotProcedures`, wrapped as `defineScorer({ invariant: true })` by a host harness),
which scores 0 rather than averaging away.

Text and metadata are redacted by `createMemory()` before embedding, and recall hits are redacted
before they reach the caller; the fabric adds no path around either. Consent, visibility, revocation,
and `requireConsent` filtering are applied inside `memory.recall()`, so a fabric recall can never see
more than the underlying memory — including for linked neighbors, which are promoted from the same
recalled batch rather than read back by id. The lineage plane is the only revocation plane: a note
whose source was corrected, revoked, forgotten, or put on legal hold is excluded from recall **and**
from injected context before any background cleanup runs, exactly as `createMemory()` excludes it —
legal-hold rows are retained but never injected, and the fabric does not invent a second tombstone or a
parallel derivation table (it stores `sourceEntryIds`/`supersedes` and lets that plane decide).
A malformed or foreign `metadata.fabric` payload is
skipped rather than injected, and unknown kinds fail closed at write time. The fabric echoes no query
text into hits, explain rows, or events; explanations carry scores and provenance flags only.

One `remember` of a fact is one bounded `memory.recall` candidate batch plus one
`memory.remember(..., { wait: true })` call — no extra full scan, no extra round trip — and it waits so
the note (and any fold) is durable when the call resolves. Recall requests an explicit oversample (up
to `RECALL_OVERSAMPLE` × `topK`, bounded by the hard top-K cap) because kind and validity filtering
happen after ranking; working-store byte caps and `maxEntryTextChars` are unchanged.

Recall costs exactly one store query: 1-hop expansion is served from the oversampled batch the query
already returned (up to `topK` extra hits), so a linked neighbor outside that window is not fetched —
`Memory` has no id lookup. `searchConversation` scans the branch entries the session already returned
(`scanned` reports how many), scores them by query-term coverage, then calls the observational-memory
page helper per returned hit; the page limit is validated by that helper (1..100), so the scan and the
result are both bounded.

The workers have no model, no tools, and no network: the linker and evolution read the redacted
candidate batch the write already fetched. Evolution rewrites a neighbor only when it actually gains
an annotation, and each patched payload is measured against the resolved worker byte budget, so a
pathological keyword list cannot grow a row past it. Superseded rows stay in the store (auditable) and
are filtered out of recall by `validTo` until retention or `forget` removes them.

`forget` and the tools add no privilege: a note is deleted in this memory instance's own thread scope,
working blocks by label in the same scope, and every tool refuses to run for a session the fabric was
not attached to. An attach is a gate read on each call, not a background process: an unattached fabric
starts nothing and enriches nothing, and `detach` (or aborting the attach signal) closes the gate
again. The jail re-checks the real path of the longest existing ancestor before any read or
append, so a symlink placed inside `root` cannot be used to read or grow a file outside it; reads are
bounded before they are retained (a 1 GiB file costs one capped buffer), and `insert` refuses before
writing, so an over-cap append is a no-op. Inserted content is data: it never activates tools, skills,
or configuration, and it is validated by the host's working-memory schema like any other block value.

## Related APIs

- [Observational memory](compaction-observational-memory.md): observations and reflections whose ids `episode` notes reference — still the episodic ledger and its workers; the fabric views, never re-observes.
- [`createMemory`](working-and-semantic-memory.md): working store, semantic recall, consent, redaction, lineage — the store this subpath writes through.
- [Attention compiler](attention-compiler.md): measures injected context cost; it does not attach or configure a fabric.
- [Session stores](session-stores.md): branch entries and bounded session search used for conversation-level queries.
- [Agent definitions](agent-definitions.md): `resolveAgentDefinition` resolves `context` names against `registries.contextProviders`; no fabric field is added to the contract.
- [Tools](tools.md): how a host registers and governs tool definitions, and what the agent sees.
- [Coding security](coding-security.md): the path-containment rules the file jail follows locally.