# Scoped persistent agent memory — design concept

Status: **concept**. The implemented contract is [Scoped memory](scoped-memory.md) (`@arnilo/prism-memory/scoped`). This page is the design rationale for workspace-scoped persistent agent memory — durable facts and procedures that are recorded, updated, and used automatically during agentic work. Terminology deliberately aligns with the existing Prism memory surfaces ([memory fabric](memory-fabric.md), [observational memory](compaction-observational-memory.md), [working and semantic memory](working-and-semantic-memory.md)) — see [Relationship to existing Prism memory surfaces](#relationship-to-existing-prism-memory-surfaces).

## Problem and goals

A host running agents over a workspace — a codebase, a professional practice, a research corpus — wants the agent to accumulate durable knowledge across sessions without manual curation: conventions, environment quirks, proven procedures, corrections, user preferences. The system must:

- **Persist** durable facts and procedures per *scope of work* (workspace, codebase, content collection).
- **Record automatically** — post-task reflection, not user-issued "remember this" commands only.
- **Stay accurate at scale** — hundreds of accumulated records must not degrade routing, cost, or behavior.
- **Be auditable** — professional work requires provenance, review, and human override.

The canonical live experiment is the Hermes agent; its documented failure modes at scale define the requirements here.

## Case study: Hermes agent

Hermes (NousResearch/hermes-agent) is a self-improving personal agent. Its memory architecture:

| Layer | Mechanism | Design constraint |
| --- | --- | --- |
| Declarative memory | `MEMORY.md` (2,200 chars) + `USER.md` (1,375 chars), injected as a frozen snapshot at session start | Hard capacity: an overflowing write returns an **error that forces consolidation** — never silent growth |
| Episodic | SQLite FTS5 session search (`session_search`), ~20 ms, no LLM calls | Unlimited, never injected into prompts |
| Procedural | Skills: markdown `SKILL.md` under `~/.hermes/skills/` (agentskills.io format) | Name + one-line description in the system prompt; full body loaded on demand (`skill_view`) — progressive disclosure |
| Write loop | Background review agent after each turn, prompt biased toward action: *"most sessions produce at least one skill update"*; bar ≈ 5 tool calls / error recovery / user correction | Patch > edit > create; optional `write_approval` staging gate |

What Hermes got right: bounded always-on memory with capacity-forced consolidation, episodic search off the prompt, progressive disclosure for skill bodies, and a background reflection loop instead of user-driven memory commands.

### Documented failure modes at scale

- **Catalog inflation (issue [#22620](https://github.com/NousResearch/hermes-agent/issues/22620)):** every skill's name + category + description is injected into the system prompt on *every turn*. 243 skills ≈ 10–15K tokens per API call; a 130-skill setup ≈ 4K tokens/turn. Routing is done by making the model attend over the whole catalog, so prompt cost and selection confusion scale O(N) with library size.
- **Lazy-loading demand (issue [#2045](https://github.com/NousResearch/hermes-agent/issues/2045)):** 87 bundled skills ≈ 1.5–2K tokens before any user content; users manually prune (73 → 26 in one report).
- **No metabolism (issue [#12877](https://github.com/NousResearch/hermes-agent/issues/12877)):** skills are add-only. No decay, no invalidation, no usage-based cleanup. The library grows monotonically and useful skills are buried under throwaways.
- **No write-quality gate (#12877 §1):** ~5 tool calls is enough to mint a permanent "skill." A one-off debugging session becomes procedural knowledge with no consolidation or validation — working memory promoted directly to long-term memory.
- **Skill islands (#12877 §3):** no composition between skills; the same logic (e.g. a TDD workflow) is duplicated across many skills; association fields are decorative.
- **No conflict detection (#12877 §4):** only identical *names* are blocked; near-duplicate *functionality* competes for execution and produces chaotic output.
- **Community-validated fix inside #22620:** usage-decay scoring (`score = uses × exp(−Δdays/30)`) plus a hard character budget for the skill list cut catalog tokens ~70% at zero LLM cost — evidence that decay-weighted routing is the right primitive.

**Root cause synthesis:** Hermes solved read-path token economics (progressive disclosure) but left the *routing surface* O(N) in the prompt and gave the *write path* no quality gate, no garbage collection, no deduplication, and no conflict resolution. "Misfiring" is the routing problem: as semantic overlap across hundreds of descriptions grows, selection degrades, and stale or duplicate entries win over correct ones.

## Research basis

| System | Contribution taken |
| --- | --- |
| **Mem0** ([arXiv 2504.19413](https://doi.org/10.48550/arxiv.2504.19413)) | Write path as extraction + adjudication: an LLM decides ADD / UPDATE / DELETE / NOOP against existing memories. Solves add-only bloat; strong LoCoMo results against MemGPT/A-MEM baselines. |
| **Zep / Graphiti** ([arXiv 2501.13956](https://arxiv.org/html/2501.13956)) | Temporal validity as a first-class citizen: every fact carries `valid_at`/`invalid_at`; a new fact *closes* the old one rather than duplicating it. Solves fact staleness and contradiction. |
| **A-MEM** ([arXiv 2502.12110](https://arxiv.org/abs/2502.12110), NeurIPS'25) | Zettelkasten-style memory: notes carry structured attributes (keywords, tags, contextual descriptions), **link generation** to related notes, and **memory evolution** — new notes update the representations of old ones. Solves island isolation. |
| **Agent Workflow Memory** ([arXiv 2409.07429](https://arxiv.org/abs/2409.07429), ICML'25) | Procedural induction by mining *repeated* sub-routines across trajectories and abstracting out instance-specific context before storage. Fixes "one successful session becomes a skill." |
| **Generative Agents** ([arXiv 2304.03442](https://arxiv.org/abs/2304.03442)) | Memory-stream retrieval scored by **relevance × recency × importance**, plus periodic **reflection** that synthesizes higher-level insights once accumulated importance crosses a threshold. |
| **Voyager** ([arXiv 2305.16291](https://arxiv.org/html/2305.16291v2)) | Skill-library precedent: skills retrieved by embedding top-k, and a skill enters the library only after **execution verification** — promotion gates are not new. |
| **HippoRAG** ([NeurIPS'24](https://proceedings.neurips.cc/paper_files/paper/2024/file/6ddc001d07ca4f319af96a3024f6dbd1-Paper-Conference.pdf)) | Associative multi-hop recall via knowledge graph + personalized PageRank, for "everything connected to this" queries beyond nearest-neighbor retrieval. |
| **Letta sleep-time compute** ([arXiv 2504.13171](https://arxiv.org/abs/2504.13171)) | Memory consolidation moved off the interaction path: a background pass reorganizes memory between sessions, improving accuracy while cutting per-turn cost. |
| **Anthropic Agent Skills** ([engineering post](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)) | Progressive disclosure as a three-level spec; the always-loaded layer (name + description) is the routing surface and must stay tiny. |

## Design principles

1. **Memory is a first-class artifact of the workspace.** Versioned with the workspace, reviewable like code, and *scoped*: a record created in scope X is invisible outside X. One silo per workspace; a separate tiny global layer for user preferences (profile ≠ project).
2. **Typed memory, one store per type, different physics per type.** Facts are bounded and always-on; episodes are append-only and searchable; notes/insights are linked and evolving; procedures earn permanence through reuse.
3. **Write-heavy is the failure mode.** Writes are gated by repetition, adjudication, and conflict detection. The default write action is *no-op*.
4. **Reads are query-driven, never catalog-driven.** Routing happens through a retrieval tool, not attention over an injected list. Prompt cost is O(1) in library size.
5. **Metabolism, not accumulation.** Usage-decay garbage collection, validity windows, capacity-forced consolidation. Every record can die.
6. **Abstention beats misfiring.** Below a relevance floor, the memory returns "nothing relevant." An agent confidently following a *wrong* retrieved record is worse than one starting fresh.

## System description

### Scope model

The unit of memory is the **scope**: a workspace root, codebase, project directory, or content collection. Records carry a `scope` binding and are retrieved only within it — scope itself is the largest single precision filter (a query inside `~/work/api-server` never competes with records from other projects). A distinct, optional global scope holds user-profile facts; nothing crosses scope boundaries by default.

### Storage — typed records, not one bucket

```
<workspace>/.memory/
  facts.md              # always-on, hard character budget
  records/*.md          # searchable semantic memory: notes, procedures, insights
  episodes.db           # SQLite FTS5, append-only session logs
  index.db              # FTS5 (+ optional embeddings) over records — derived, rebuildable
```

Record format — markdown with frontmatter, human-editable, git-diffable, PR-reviewable:

```markdown
---
id: rec_7f3a91c2d0b4
type: procedure        # fact | note | procedure | insight
scope: ~/work/api-server
status: candidate      # candidate → verified → archived (promotion ladder)
created: 2026-06-14
valid: [2026-06-14, ]  # validity window; a superseding write closes it
provenance: session 8a2f, turn 41   # every claim traceable to its source
uses: 0                # retrieval activations
last_used: null
links: [rec_deploy_rollback, rec_pg_pool]
---
## Deploy without downtime
1. ... (steps abstracted from instance specifics)
```

Rationale: human override and review are non-negotiable for professional work — diffs, blame, and PR review come free. This mirrors the Hermes `journey edit/delete` lesson (users *must* be able to prune) and generalizes it to full version control.

**Prism realization.** In the composed Prism stack (next section) the [memory fabric](memory-fabric.md) is the source of truth for records and the session store/observational ledger owns episodes; usage/status/staging live in a gitignored JSON ledger (`<workspace>/.memory/state.json`); `<workspace>/.memory/` markdown is a **git audit mirror** — a rendered export of fabric notes + ledger counters for diff/review — not a second storage engine. One write path, two views.

### Write path — reflect, adjudicate, gate

A background reflection pass runs post-task on the session digest (Hermes's background review; Letta's sleep-time compute), on a cheaper model. Four hard differences from Hermes:

1. **Conservative bias.** The review prompt's prior is *"most sessions update nothing"* — the explicit inversion of Hermes's action-biased prompt. Write triggers: user correction, error→recovery, a technique reused *within* the session, or an explicit "remember this."
2. **Adjudication before write** (Mem0). Retrieve the top-k nearest existing records; the writer decides ADD / UPDATE / MERGE / NOOP against them. Duplication is killed at write time, not by later cleanup.
3. **Temporal supersession** (Zep/Graphiti). A contradicting fact closes the old record's validity window — never two live records claiming opposite things. Conflict is detected *at write*, not at misfire time.
4. **Promotion ladder** (Voyager; #12877 recommendation). Post-task output is a `candidate` note, never a procedure. A candidate becomes `verified` after **N successful reuses** (N ≈ 2–3) logged from actual retrieval→outcome feedback; insights promoted from reflections follow the same gate. Real-but-unproven knowledge lives as a note; only proven repetition earns procedure status. This single gate eliminates most of Hermes's throwaway-skill flood, because throwaways are never reused.

After the gate: **link generation** against retrieved neighbors (A-MEM) so records compose instead of islanding, and every record carries provenance back to the session/turn that produced it.

### Read path — where misfiring is prevented

- **In the system prompt:** `facts.md` only (bounded, ~1–2K tokens) plus one line — "memory available, N records in this scope." Never the record list. Routing is a tool call, not attention over a catalog: prompt cost stays flat regardless of library size.
- **`memory_search(query)`** — hybrid retrieval: lexical (FTS5/BM25, milliseconds, $0) plus embeddings when available, reranked by a Generative-Agents-style score extended with usage feedback:
  `score = relevance × exp(−Δdays/τ) × importance × (1 + log uses)`
  The decay term is exactly the mechanism community-measured at ~70% catalog reduction inside Hermes issue #22620.
- **Activation budget:** top-3 results per query, and an **abstain floor** — below a similarity threshold the tool returns "no relevant memory."
- **Link traversal:** follow `links:` one hop for associative recall (HippoRAG-lite). No graph database — frontmatter adjacency only.

### Lifecycle — metabolism

An idle/nightly consolidation pass (cheap model, off the interaction path):

- **Garbage collection by usage decay.** Archive `candidate` records unused for ~30 days; archive `verified` records below a usage-decay threshold. Recommend-then-delete, never silent deletion (git keeps history regardless).
- **Near-duplicate merge.** Records flagged by embedding similarity above threshold are merged or invalidated.
- **Promotion/demotion** per the ladder, from logged retrieval→outcome feedback.
- **Capacity-forced consolidation of `facts.md`.** When a facts write would exceed the budget, the write *fails* with "consolidate first" (the Hermes overflow-error pattern) — the writer must merge or remove entries in the same action. The always-on layer can therefore never rot.
- **Digest.** A weekly human-readable diff of memory changes (git already provides the bookkeeping).

### Trust boundary

- **Secret redaction** of record content via the shipped needle redactor (`createSecretRedactor` / observational `secrets` / working-memory `redactJson`).
- **Injection/exfiltration scanning** of record content before any prompt injection (patterns, invisible Unicode) — Hermes does this for `MEMORY.md`; extend to all records. This is a new scoped primitive (`scanScopedMemoryContent`); it is not the secret redactor.
- **Staged approval.** Writes may be staged for human review (`write_approval`-style). Default: off for personal scopes, on for team/professional scopes.
- **Scope isolation.** Records never leak across workspace roots; the global user layer is opt-in per record.
- **Provenance on every record.** Any memory-driven decision can be traced to the session and turn that produced the record (same philosophy as observational memory's source-backed ids and the recall path).

## Failure-mode → mechanism map

| Hermes failure mode | Mechanism here | Backing |
| --- | --- | --- |
| Catalog tokens O(N)/turn | Routing via retrieval tool; never list injection | #22620, #2045; Anthropic three-level disclosure |
| Wrong entry wins selection | Abstain floor + top-3 budget + decay-weighted scoring | Generative Agents; measured decay fix in #22620 |
| Throwaway-skill flood | candidate→verified promotion after N reuses | Voyager verification; #12877 §1; AWM repetition mining |
| Duplicates | Write-time ADD/UPDATE/MERGE/NOOP adjudication | Mem0 |
| Contradictory live facts | Validity windows; supersede, don't duplicate | Zep/Graphiti |
| Record islands | Link generation + memory evolution on write | A-MEM; HippoRAG traversal |
| Unreviewable autonomous writes | Markdown + git + provenance + staged approval | Hermes `journey`/`write_approval` generalized |
| No cleanup | Usage-decay GC + consolidation pass | Letta sleep-time; #12877 §2 |

## Evaluation

Non-negotiable for professional use; memory must earn its complexity:

1. **Task win-rate A/B** — a fixed task suite per scope, run with memory on / off / never-consolidated. If memory does not lift win rate or reduce turns, it ships off by default.
2. **Retrieval precision@3** against a hand-labeled query set per workspace; alert on drops — the leading indicator of misfiring.
3. **Health metrics** — duplication rate, candidate→verified conversion rate, activation rate (retrieved-and-used / retrieved), and prompt token cost per turn vs. library size (target: flat).
4. **LoCoMo-style recall probes** for the episodic layer, the standard benchmark in the Mem0/Zep line.

## Relationship to existing Prism memory surfaces

The placement principle: **the scoped layer is a policy and lifecycle layer, not a fifth store.** Mechanism lives in the engines and the fabric; policy lives in the scoped layer. This section concretizes how the layers compose into one memory-management system.

### Layered architecture and ownership

| Layer | Surface | Owns | Never does |
| --- | --- | --- | --- |
| Raw transcript | [Session stores](session-stores.md) | append-only entries, branches, bounded lexical search | — |
| Episodic ledger | [Observational memory](compaction-observational-memory.md) | source-backed observations/reflections (12-hex ids, `sourceEntryIds`), exact-id recall and branch pages, optional work-scope index; observer/reflector/dropper workers are the only writers | no semantic retrieval, no wholesale prompt injection, no downstream re-observation |
| Memory engines | [Working and semantic memory](working-and-semantic-memory.md) | `Embedder`/vector/working-store contracts, consent lifecycle, lineage invalidation, importance, recall scoring | no policy |
| Durable records | [Memory fabric](memory-fabric.md) | typed notes (`fact`/`procedure`/`file`/`working`/`episode`), validity windows, consolidation folding, linker/evolution workers, five governed tools, file jail, context provider, `forget`/legal hold | no autonomy — every write is an explicit caller decision |
| Policy + lifecycle | [Scoped memory](scoped-memory.md) (`@arnilo/prism-memory/scoped`) | conservative post-run writer, promotion ladder, usage-decay GC, abstain floor + activation budget, workspace-root scope identity, git audit mirror, usage/status/staging JSON ledger | no store, no engine, no context-block type, no second write path |
| Knowledge compiler | [LLM wiki](wiki.md) (`@arnilo/prism-memory/wiki`) | regenerable `.wiki/` pages with line-anchored citations over raw sources; `wiki_ingest` / `wiki_record_insight` | session-derived experience (that is scoped memory); it is not a memory store |

**Wiki boundary / routing.** Wiki compiles *source-cited knowledge* (files, docs, papers — regenerable, `file://…#Lxx-Lyy`). Scoped memory holds *session-derived experience* (primary fabric records, provenance `sourceEntryIds`). No storage overlap: wiki writes `.wiki/` + `raw/ingest/`; scoped writes fabric notes + `<scopeRoot>/.memory/state.json` + the git mirror. Route source-cited material to wiki; route session-derived experience to scoped policy. The post-run reviewer must not file a wiki-pageable insight as a scoped fact.

Two invariants carry over unchanged: observational memory stays **episodic** (promotion out of the ledger is an explicit host write — fabric's `promotedFrom` over a closed work scope), and the fabric never widens consent or visibility.

### Ideal composition for a persistent-memory agent

```ts
// 1. Engines — workspace root is resourceId; threadId is a stable silo id (not the session id)
const memory = createMemory({ tenantId: host, resourceId: workspaceRoot, threadId: "scoped", embedder, stores });
// 2. Durable records — folding, links, evolution on by policy
const fabric = createMemoryFabric({ memory, observational, consolidate: { threshold: 0.85 },
                                    linker: { enabled: true }, evolution: { enabled: true } });
// 3. Episodic ledger per session; work-scope index bound to the workspace
om.attach(session);
// 4. Gate fabric tools + workers to this session
fabric.attach(session);
// 5. Injection: ONLY the bounded working facts block reaches the prompt
registries.contextProviders.register("memory-fabric",
  fabric.createContextProvider({ includeWorking: true, includeSemantic: false }));
const agent = await resolveAgentDefinition(
  { name: "assistant", model, context: ["memory-fabric"], tools: ["memory.recall"] },
  { registries, providerSource });
// 6. Scoped policy module (host-side, the new part): post-run review,
//    usage logging on recall hits, idle promotion/GC jobs, .memory/ git mirror
```

End-to-end flow:

1. **During the session** — observational workers record source-backed observations/reflections; compaction renders prepared memory; the agent may call `memory.recall`/`memory.insert` directly; the prompt carries only the bounded facts block.
2. **After the run** — the scoped policy reviews the session digest on a cheap model, biased to no-op, and promotes the *generalizable* part through `fabric.remember` as `candidate` notes carrying `sourceEntryIds` provenance (or `reflectionId` for notes derived from a closed-scope reflection). Folding adjudicates duplicates; linker/evolution connect and refine.
3. **Next session** — facts block (working notes) always on; everything else via `memory.recall` (`kinds: ["procedure"]` stays opt-in, `asOf` honors validity, `budget` caps tokens). Recall hits log `uses`.
4. **Idle/nightly** — promotion job converts candidates with N logged successful reuses to `verified`; usage-decay GC archives the rest; the facts block is consolidated under its budget; the git mirror renders the diff for human review.

### Read/write paths across layers

| Write-path step | Owner |
| --- | --- |
| Trigger (post-run, noop-biased) | scoped policy |
| Extraction with provenance | observational reflection → `reflectionId`/`sourceEntryIds` |
| Adjudicate ADD/UPDATE/supersede | fabric consolidation folding (cosine threshold 0.85) |
| Close contradicted facts | fabric `validTo` + `supersedes` |
| Link + evolve neighbors | fabric linker/evolution workers |
| Status `candidate`, usage counters, staging/approval | scoped JSON ledger (`<scopeRoot>/.memory/state.json`) — not fabric note metadata |

| Read-path step | Owner |
| --- | --- |
| Always-on bounded facts | working block via the fabric context provider — the only injected surface |
| Query-driven records | `memory.recall` (kinds/asOf/budget) + scoped abstain floor, top-3 budget, decay-weighted scoring |
| Associative recall | `links` traversal (recall hits with `explain.link: true`) |
| Episodic specifics | observational exact-id recall / `searchConversation` lexical pages |

### Research leverage map

How the research findings land on shipped surfaces versus policy added by this concept:

| Finding | Source | Shipped in Prism | Added by this concept |
| --- | --- | --- | --- |
| Write adjudication (ADD/UPDATE/DELETE/NOOP) | Mem0 | fabric consolidation folding (insert / rewrite / supersede) | MERGE of near-duplicates in the GC pass |
| Importance weighting | Mem0 | `importance` / `importanceFrom` hook | — |
| Temporal validity windows | Zep/Graphiti | fabric `validFrom`/`validTo`, recall `asOf` | — |
| Invalidate, don't duplicate | Zep/Graphiti | supersede fold at write | — |
| Bi-temporal time (event vs ingestion) | Zep/Graphiti | `tRef` vs `ingestedAt` | — |
| Link generation | A-MEM | fabric linker worker | — |
| Memory evolution | A-MEM | fabric evolution worker | — |
| Relevance × recency × importance scoring | Generative Agents | fabric recall scoring (similarity/recency/importance) | usage feedback `(1 + log uses)` + exp decay |
| Verify before permanence | Voyager | — | promotion ladder (N reuses) |
| Mine repeated routines, abstract instance specifics | AWM | — | conservative review writes abstracted candidates |
| Off-path consolidation | Letta sleep-time | — (idle-job placement) | GC/promotion/facts consolidation on a cheap model |
| Tiny always-loaded layer, disclosure on demand | Anthropic skills | recall tools + working block only | abstain floor + top-3 activation budget |
| Hybrid BM25 + cosine + graph walk | Zep/Graphiti | partial: embedding score + link traversal; lexical on branch search | fusing lexical into one recall — open question |
| Known-secret redaction | runtime / OM | `createSecretRedactor`, observational `secrets`, working `redactJson` | — |
| Injection / exfil / invisible Unicode scan | Hermes MEMORY.md | — (redactor is needle-only) | `scanScopedMemoryContent` (pure patterns) |

### Deliberate deviations

- **Against Mem0's accumulate-and-rank-at-query.** Mem0's current algorithm appends dated variants and ranks at query time. This design sides with Zep: close the validity window at write. Rationale: the scoped layer injects few records, so each must be *the* trusted record; ranking dated variants at retrieval reintroduces the Hermes catalog/misfire problem one layer down.
- **Beyond both Mem0 and Zep.** Neither gates *procedures* by reuse — that is exactly the Hermes failure (#12877: ~5 tool calls = permanent skill). The promotion ladder is the addition, from Voyager/AWM.
- **Not adopted (deferred):** graph engines and community detection (frontmatter `links` + one-hop traversal suffice inside a scoped silo); Zep-style episodic subgraph summarization (the observational reflector already does hierarchical episodic summarization with provenance — adopting it would duplicate a shipped layer).

## Non-goals / deferred

- No vector database, graph database, or external memory provider in the core design — embeddings only where lexical retrieval measurably fails (inside a scoped silo it mostly will not).
- No second write path — the scoped policy writes only through the fabric, so folding, consent, and lineage rules apply to every write.
- No cross-scope federation or sharing; add only when a multi-workspace pattern measurably needs it.
- No autonomous deletion of human-authored records; GC proposes, humans dispose.

## Open questions

- Exact promotion thresholds (N reuses, decay τ, similarity floors) — must be empirically tuned per workload class (coding vs. research vs. professional ops).
- Whether the global user-profile layer reuses the working-memory store or a separate facts silo.
- Team-scope semantics: per-user silos sharing one workspace root, or one shared silo with author-attributed records.

Closed at primitive review: evaluation harness reuses `@arnilo/prism-core/governance/evals` scorer/dataset contracts and adds only scoped fixtures + `runScopedMemoryEval`.
