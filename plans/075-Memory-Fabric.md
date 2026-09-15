# 075 — Memory Fabric

Roadmap phase: **0.7.0** (agent memory). **Reassigned from 0.8.0 to the extended 0.7.0 line on 2026-09-14 by user request**: 0.7.0 now ships **072, 073, 074, 075, 077, 078, 079** and there is no interim cut, so this plan runs **before** [073 Tasks 28–29](073-Release-0-7-0-Host-Completeness.md) instead of after a 0.7.0 release. May run in parallel with [074](074-Attention-Compiler.md)/[077](077-Work-Scope-Memory-Index.md); [076](076-Observational-Memory-Mastra-Parity.md) is superseded. 074 (the cache-stable turn gate) is part of the same extended line and may land before or alongside this plan — this plan does not wait on another compiler rewrite. Consumes 073 **R08** (lineage / correction / revocation) when present; until R08 lands, fail closed on `forget`/`correct` the same way `createMemory` already does (consent + visibility), and do not invent a second revocation plane. Hosts may later promote closed-scope reflections into fabric notes; this plan does not invent a second scope tree.

Baseline: `@arnilo/prism-memory` released **0.6.0** plus the 0.7.0-line memory work ([073 Task 16](073-Release-0-7-0-Host-Completeness.md) R08 lineage/correction/revocation is complete; [077](077-Work-Scope-Memory-Index.md) work scopes may land before or alongside this plan). The fabric subpath ships at **0.7.0** with the rest of the line.

Constraint: Prism stays a **harness**. Fabric is **opt-in**. Ordinary sessions need no vector DB and must not import this subpath. No Memory Bank SaaS, no required Neo4j, no LLM-on-every-write default.

## Product Boundary

- **In:** one note type, kinds (`working` / `episode` / `fact` / `procedure` / `file`), optional links + validity windows, write-side consolidation, conversation search, governed tools, file-memory jail, explainable recall, attach-on-session like OM.
- **Out:** replacing observational memory, replacing `createMemory`, hosted graph DB, default A-MEM evolution, auto-enable from the Attention Compiler, putting investigation *conclusions* into `procedure` notes.

## Picture (OM vs fabric vs compiler)

Three machines, one id space:

| Machine | Job | Source of truth | Injected how |
| --- | --- | --- | --- |
| **Session store** | Durable transcript | `SessionEntry` rows | Never deleted by compiler/fabric |
| **Observational memory** | **This-session episodic compression** | Observations/reflections with `sourceEntryIds` | OM context blocks + OM compaction render |
| **Working / semantic (`createMemory`)** | Profile JSON + vector facts | Working store + vector store | `createContextProvider` |
| **Memory Fabric (this plan)** | Cross-turn/cross-session notes, links, time, files, procedures | Notes over **existing** stores | Fabric context provider + JIT tools |
| **Attention Compiler (074)** | This-turn ratio gate (sticky thinking/tool stubs) | Nothing durable | History clone only; does not rewrite OM mid-run |

**Observational memory does not go away.** After 074+075 it is still the only component that:

1. Scans new branch messages after a run (`runObserver`).
2. Writes source-backed 12-hex observations (`om.observations.recorded`).
3. Reflects over observation ids (`runReflector`).
4. Drops low-relevance observations from the **projection** (`runDropper`) without deleting sources when **unscoped**; with host work scopes (077) the working set is `projectWorkMemory`, not the dropper.
5. Compacts with **no model** via `createObservationalMemoryCompactionStrategy`.
6. Recalls **exact evidence** (`recallObservationalMemory` / branch page / `createRecallMemoryTool`).

Fabric **must not** run a second observer on the same transcript. Fabric **may**:

- Treat OM observations as `kind: "episode"` **views** (same ids, same `sourceEntryIds`) when the host opts into promotion.
- Link `fact` notes to those ids.
- Rank fabric hits that cite OM ids.
- Leave exact-id recall on the OM tool.

Compiler **must not** observe either. It only budget-packs OM's `episodic` + `recent_messages` layers and fabric's `semantic` / `working` / `handles`.

R08 (073 Task 16): `forget` / revoke on a source blocks derived fabric notes **and** OM reflections from injection. Fabric does not ship a parallel lineage table if R08 already has one — it **stores** `sourceEntryIds` / `supersedes` and **asks** R08 (or today's consent flags if R08 is not in tree yet).

## Objectives

- Give hosts an optional **Memory Fabric** over existing working/semantic/session/workspace primitives: typed notes, consolidation, optional links, optional validity windows, explainable recall.
- Keep activation explicit: `createMemoryFabric(...).attach(session)` plus optional tools/context provider. No attach → zero workers, zero tools, zero extra context.
- Preserve OM as the episodic engine; fabric is durable/associative/temporal **on top**.
- Stay a harness: hosts own embedders, stores, file roots, and whether a model ever runs on write.

## Expected Outcome

- Subpath `@arnilo/prism-memory/fabric` (inert import).
- `createMemoryFabric(options)` returns `{ attach, createContextProvider, tools, remember, recall, forget, explain }`.
- Default write path: redact → consent → byte caps → optional near-duplicate consolidate. **No LLM** unless host passed workers.
- Optional linker / consolidator workers reuse OM worker-limit resolvers.
- File notes jail to host `root` (`/memories` prefix). Path escape fails closed.
- Docs: `docs/memory-fabric.md`; orientation page from 074 gains a fabric section that is current-line (not "planned").
- Example: `examples/memory-fabric.ts` (mock embedder, no live keys).

## Requirements

| ID | Requirement |
| --- | --- |
| F1 | Opt-in. Import and `createMemoryFabric` start nothing. `attach` required for session workers/tools. Compiler (074) does not attach fabric. |
| F2 | Single note record: `id` (12-hex), `kind`, `content`, `ingestedAt`, optional `tRef` / `validFrom` / `validTo`, `keywords`/`tags`/`context`, optional `embedding`, `links[]`, `sourceEntryIds`, `supersedes?`, `importance`, `consent`, `scope`, `tokenCount`. |
| F3 | Kinds: `working` (char-capped core blocks via existing working store), `episode` (OM ids — no duplicate rows), `fact` (vector store), `procedure` (separate collection or tagged facts; never mixed into default recall without `kinds`), `file` (workspace path). |
| F4 | Write consolidation (no model): near-duplicate by embedding+lexical → `keep` / `update` / `supersede` / `insert`. Contradiction with validity: set `validTo` on old, insert new. Do not silent-overwrite content. |
| F5 | Linker/evolution **off by default**. When enabled, new note may add adjacency to top-k neighbors and patch neighbor `keywords`/`context` only. Never rewrite `content` or `sourceEntryIds`. Same worker caps as OM. |
| F6 | Recall: vector + lexical + 1-hop links; rank similarity × recency × importance × validity(`asOf`) × consent. Reuse `resolveRecallScoring`. Oversample factor stays 4. |
| F7 | Explain: each hit returns why (`similarity`, `recency`, `importance`, `link`, `valid`, `consent`). No payload beyond the hit text already returned. |
| F8 | Conversation search: hybrid over **current-branch session entries** (existing session search if present; else bounded scan). Not a second transcript store. |
| F9 | Tools (governed, host-activated): `memory.view`, `memory.read`, `memory.insert` (append-safe), `memory.recall`, `memory.forget`. No `memory_rethink`. OM `createRecallMemoryTool` stays for exact-id evidence. |
| F10 | File jail: all file ops resolve under host `root`; `..` / symlink escape throws. Scope user\|thread\|agent. |
| F11 | Core working blocks: labeled, char-capped, versioned OCC (existing `WorkingMemoryStore`). Agent `memory.insert` into a block appends; host schema still validates. |
| F12 | Injection: `createContextProvider` emits small working + top-k facts as handles when over threshold. Compiler (074) packs them as layers `working` / `semantic` / `handles` when enabled; without compiler, today's block inject still works. |
| F13 | R08: revoked/superseded notes excluded from recall **and** context **before** background cleanup. Legal hold: retained, never injected. |
| F14 | Eval: one fixture using 072 scorers if present (forbidden kind mix: procedure vs fact). Do not reimplement timeline. |
| F15 | No new npm package. Subpath on `@arnilo/prism-memory`. Core does not import fabric. |

---

## Tasks

All tasks: read `docs/_evidence/phase75-primitive-review.md` §4 (do-not-duplicate, frozen) and §6 (amendments from Task 1) before starting.

- [x] **Task 1 — Primitive review (compose, do not clone OM or createMemory)**
  - Acceptance Criteria:
    - Functional: Inventory lists working store, semantic remember/recall/consent/correct/forget/retention/export, OM ledger/projection/recall/tools/workers, session search, workspace FS, 074 handles (if present), 073 R08 (if present). Written **do-not-duplicate** list: no second observer, no second vector contract, no second consent type.
    - Performance: docs-only.
    - Code Quality: Evidence names exact modules; rejects `@arnilo/prism-fabric` package and Graphiti as a required dependency.
    - Security: Confirms fabric must honor existing redactor/consent/`requireConsent` and cannot inject `visible: false`.
  - Approach:
    - Documentation Reviewed:
      - `docs/working-and-semantic-memory.md`
      - `docs/compaction-observational-memory.md`
      - `docs/embeddings.md`
      - `docs/session-stores.md` (search)
      - `docs/coding-workspaces.md` / host FS patterns
      - Plan 074 picture + 073 R08
      - `.agents/skills/create-plan/references/prism-wiki.md`
    - Options Considered:
      - Wrap Mem0/Zep SDK: extra vendor, host lock-in. Reject.
      - Merge fabric into OM subpath: OM is session-compaction; fabric is durable notes. Reject merge.
      - New package: publish cost. Reject (F15).
    - Chosen Approach:
      - New **subpath** that **calls** `createMemory`, OM fold helpers, and working store. Episode kind **is** OM ids.
    - API Notes and Examples:
      ```ts
      import { createMemory } from "@arnilo/prism-memory";
      import { createObservationalMemory } from "@arnilo/prism-memory/compaction/observational-memory";
      // Both remain valid without fabric.
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase75-primitive-review.md`
    - References:
      - `packages/memory/src/memory.ts` `createMemory` / `createContextProvider`
      - `packages/memory/src/working-memory.ts`
      - `packages/memory/src/scoring.ts`
      - `packages/memory/src/compaction/observational-memory/compose.ts`
      - `packages/memory/src/compaction/observational-memory/recall.ts`
      - `packages/memory/package.json` exports
  - Test Cases to Write:
    - none (review). Gate: evidence file has the do-not-duplicate list.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - `docs/_evidence/phase75-primitive-review.md`: history, not API.
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable

  - Completion Notes:
    - Evidence: `docs/_evidence/phase75-primitive-review.md` (~230 lines). Every span in it was read at that exact range; no prose-derived claims. Gate satisfied: §4 is the frozen do-not-duplicate list (13 items, including no second observer / no second vector contract / no second consent type).
    - Verified tree state rather than plan prose: **R08 is present** (`packages/memory/src/lineage.ts` + invalidation types + `forget`/`correct` wiring), **074 is present but has no layer ids or handles** (plan 074 rejected them; `compileAttention` reads `context` only through `measureInputCost`), **077 is not present** (no `projectWorkMemory`).
    - Amendments the review forced on later tasks (§6 of the evidence, also inlined where the plan was wrong): (1) Task 6's `metadata.layer` AC and its test case replaced with `metadata.source` — nothing in tree consumes layers; (2) `docs/context-engineering.md` does not exist (074 Task 6 rejected it), so Tasks 6–7 now target `docs/attention-compiler.md` + `docs/context-and-skills.md`; (3) Task 4 must oversample explicitly for `kinds`/validity post-filtering (`VectorQuery` has no metadata filter and `RECALL_OVERSAMPLE` applies only when scoring resolves); (4) `Memory` exposes no lexical leg — Task 4 either takes an optional host `VectorStore` or ships vector-only v1 (no forked fusion); (5) conversation search is `session.entries()` + `recallObservationalMemoryBranchPage`, not `searchSessions`; (6) Task 5's file jail cannot import `assertPathInsideRoots` (coding-tools is not a memory dependency) → local fail-closed helper; (7) consolidation must await `remember` (`wait: true`) before neighbor recall; (8) Task 7's eval fixture cannot import 072 scorers without a new devDependency → use the plan's tiny-assert fallback.
    - Checks: `node --test dist/__tests__/docs.test.js` → 153 pass / 0 fail (covers index nav-links, one-link-per-page, every-example-listed, and local link resolution for the new evidence file). No code changed; no build needed.

- [x] **Task 2 — Note contract, stores, kinds, validity**
  - Acceptance Criteria:
    - Functional: `MemoryNote` type + parsers; `createMemoryFabric` persists `fact` via existing vector store, `working` via working store, `episode` as **id references** to OM (no extra row), `file` as metadata + path, `procedure` tagged so default `recall` without `kinds` **excludes** it. `validTo` in the past excludes from default `asOf=now`. Invalid `id` / kind fails closed.
    - Performance: remember one fact = one existing `remember()` path; no extra round trip beyond today's embed.
    - Code Quality: Reuse `createMemoryId` / `isMemoryId` from OM; do not mint a second id format.
    - Security: Redact before embed; consent required in `requireConsent` mode; tenant/resource/thread scope from `createMemory` options — fabric cannot widen scope.
  - Approach:
    - Documentation Reviewed:
      - `docs/working-and-semantic-memory.md` — consent, remember/recall.
      - `docs/compaction-observational-memory.md` — 12-hex ids.
      - Task 1 evidence.
    - Options Considered:
      - Separate SQL notes table: another adapter. Reject; metadata on vector records + working JSON is enough.
      - Require Graphiti: optional later. Reject for v1.
    - Chosen Approach:
      - Vector record metadata carries fabric fields; working blocks stay JSON; episode = OM id alias.
    - API Notes and Examples:
      ```ts
      import { createMemoryFabric } from "@arnilo/prism-memory/fabric";

      const fabric = createMemoryFabric({
        memory, // existing createMemory()
        observational: om, // optional; needed for kind:"episode"
      });
      await fabric.remember({ kind: "fact", content: "User prefers metric units", sourceEntryIds: ["aaaaaaaaaaaa"] });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/fabric/types.ts`
      - `packages/memory/src/fabric/create.ts`
      - `packages/memory/src/fabric/index.ts`
      - `packages/memory/package.json` `exports["./fabric"]` + `test` glob for `dist/fabric/__tests__/*.test.js`
      - `packages/memory/src/fabric/__tests__/notes.test.ts`
      - `src/__tests__/packaging.test.ts` (exports-map pin) and `src/__tests__/install-smoke.test.ts` (documented specifier)
      - `docs/memory-fabric.md`, `docs/index.md`
    - References:
      - `packages/memory/src/types.ts` `Memory` / consent
      - `packages/memory/src/compaction/observational-memory` ids
  - Test Cases to Write:
    - fact remember/recall via existing vector store
    - episode remember without OM: throws
    - episode remember with OM id: no extra vector row
    - procedure excluded from default recall, included when `kinds: ["procedure"]`
    - `asOf` before `validFrom`: miss; after `validTo`: miss
    - import of `./fabric` does not attach workers (inert)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new subpath.
    - Docs pages to create/edit:
      - `docs/memory-fabric.md`: create API page (fill as tasks land).
    - `docs/index.md` update: yes — **Compaction/session memory**: Memory fabric — opt-in notes, links, and recall over working/semantic/OM stores.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Completion Notes:
    - Landed as planned: `packages/memory/src/fabric/{types,create,index}.ts`, `packages/memory/package.json` (`exports["./fabric"]`), `docs/memory-fabric.md`, `docs/index.md` entry, `packages/memory/src/fabric/__tests__/notes.test.ts` (9 cases). Root barrel stays clean: `createMemoryFabric` is not exported from `@arnilo/prism-memory` (asserted in the test).
    - Files added beyond the task list (each a pinned gate, not a feature): `packages/memory/package.json` `test` glob gained `dist/fabric/__tests__/*.test.js` (otherwise the suite never runs it); `src/__tests__/packaging.test.ts` exports-map assertion gained `./fabric`; `src/__tests__/install-smoke.test.ts` documented-specifier list gained `@arnilo/prism-memory/fabric`.
    - Kinds/stores as specified: `fact`/`procedure`/`file` are tagged vector rows (`metadata.fabric`, `v: 1`), `working` is a labeled block under `_fabric.blocks` in the working value (deep-merged by the existing store, so one `updateWorking` call), `episode` derives content/`sourceEntryIds`/timestamp from a folded OM ledger and writes nothing. `working` ids derive from the block label; other ids derive from kind+content+time+nonce, and a caller-supplied id is honored (idempotent overwrite).
    - Decisions Task 3+ inherits: default recall kinds are `fact` + `file` (not `episode`/`working` — episodes are OM views and working notes are injected as blocks, so neither is a recall hit); `procedure` only appears when named; recall fetches an explicit `min(HARD_TOP_K_CAP, topK * RECALL_OVERSAMPLE)` candidate batch before kind/validity filtering so an unfiltered `recall` cannot starve; notes with missing or malformed `metadata.fabric` are skipped, never thrown (foreign host rows stay visible only to `memory.recall`).
    - Bug found and fixed during execution: two identical notes written in the same millisecond previously derived the same id and the second silently overwrote the first (surfaced by the validity-window test). The derived id now includes a random nonce, so near-duplicate folding stays Task 3's explicit consolidation (`keep`/`update`/`supersede`/`insert`) instead of an accidental upsert.
    - Scope of `recall` here is notes only (`{ hits }`); 1-hop links, `explain`, scoring-composition details, and conversation search remain Task 4, as planned. `working` block char caps and append semantics remain Task 5 (this task only reuses `maxEntryTextChars` and the store's byte cap).
    - Checks: `packages/memory` `npm run typecheck` clean; `npm test` 385 pass / 4 skipped (postgres without DB) / 0 fail; root `dist/__tests__/{packaging,docs}.test.js` 214 pass / 0 fail; root `install-smoke` + `public-export-contract` 249 pass / 0 fail; `npm pack --dry-run` contains `dist/fabric/{index,create,types}.{js,d.ts}` and no test artifacts.

- [x] **Task 3 — Consolidation (default) and linker/evolution (opt-in workers)**
  - Acceptance Criteria:
    - Functional: Near-duplicate insert supersedes or updates rather than duplicating; contradictory fact with overlap embedding sets `validTo` on old and inserts new with `supersedes`. Linker off: no `links`. Linker on: top-k edges stored; evolution patches neighbor keywords/context only.
    - Performance: Duplicate check uses recall oversample already in scoring (no extra full-scan). Worker caps = OM `resolveMemoryWorkerLimits`.
    - Code Quality: Reuse OM worker limit helper; do not copy observer/reflector.
    - Security: Workers see redacted text; cannot run tools except fabric-internal; `passive: true` skips workers (same as OM).
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md` — worker caps, passive.
      - `docs/working-and-semantic-memory.md` — `correct` vs new id.
    - Options Considered:
      - LLM extract every write (Mem0 default): cost + poison. Reject as default; host may pass `extract?: (text) => notes`.
      - Always evolve neighbors (A-MEM): write amplification + clash. Opt-in only (F5).
    - Chosen Approach:
      - Deterministic consolidate default. Optional host extract. Optional linker worker with OM caps.
    - API Notes and Examples:
      ```ts
      const fabric = createMemoryFabric({
        memory,
        consolidate: true, // default
        linker: { enabled: true, topK: 3 }, // opt-in
      });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/fabric/consolidate.ts` (threshold, plan, metadata merge)
      - `packages/memory/src/fabric/links.ts` (link resolution/merge, top-K caps)
      - `packages/memory/src/fabric/workers.ts` (settings resolver + evolution worker)
      - `packages/memory/src/fabric/__tests__/consolidate.test.ts`
      - `packages/memory/src/fabric/create.ts` (shared candidate batch + write path), `types.ts` (create options), `index.ts` (typed exports)
      - `docs/memory-fabric.md` (write path + worker table)
    - References:
      - `packages/memory/src/compaction/observational-memory` worker limits
      - CrewAI consolidation keep/update/delete (behavior, not code)
  - Test Cases to Write:
    - duplicate text: one surviving fact + `supersedes`
    - contradiction: old `validTo` set, new id, both rows exist
    - linker off: `links` empty
    - evolution cannot change `sourceEntryIds` (assert frozen)
    - worker without model when linker needs none: still works (embed-only links)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — create options.
    - Docs pages to create/edit:
      - `docs/memory-fabric.md`: write path + worker table.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Completion Notes:
    - Landed: `consolidate.ts` (pure `planMemoryConsolidation` + `mergeNoteMetadata` + threshold), `links.ts` (`resolveNoteLinks`/`mergeNoteLinks`, weights clamped/rounded, non-positive similarity dropped), `workers.ts` (`resolveMemoryFabricSettings` + `runFabricEvolutionWorker`). `create.ts` now routes both `recall` and the write path through one `recallCandidates(content, kinds, asOf, topK)` batch (`RECALL_OVERSAMPLE`, bounded by `HARD_TOP_K_CAP`), so folding costs no extra scan; `types.ts`/`index.ts` carry the new create options and their types. Docs updated (write path table, worker table, option rows, caps).
    - Deviation from this task's sketched test list: an identical note folds **in place** (same id, annotations union, new claims win) rather than inserting a superseding row; supersede is reserved for the same subject with changed content. Both satisfy the AC's "supersedes or updates", and keeping the row id stable preserves existing `links` and bounds row chains. An explicit `id` or `supersedes` from the caller disables auto-folding. Contradiction detection is therefore threshold-based (unscored `memory.recall` cosine, default 0.85, host-tunable via `consolidate.threshold`) — no LLM, no NLI; labeled in code as the ceiling to tune per embedder.
    - `file` notes only fold within the same `path`; a changed same-path note folds instead of superseding (a document cannot supersede a different document). Guarded and tested — the threshold model never merges paths.
    - Supersede rewrites the old row's `validTo` **before** inserting the new row (a crash leaves the old note invalid, not two current notes) and preserves that row's `createdAt`, consent, importance, and non-fabric metadata keys (tested with a host-owned `owner` key).
    - Evolution is annotation-only by construction (keywords union, `context` fill when the neighbor has none) and skips a neighbor that already carries them, so repeated writes do not amplify writes; content, validity, consent, and `sourceEntryIds` are carried through untouched (frozen row asserted in the test).
    - Worker caps reuse the OM helper, not the OM workers: `resolveMemoryWorkerLimits` supplies `maxPatches` (default = `maxToolCallsPerTurn`) and `maxResultBytes`, which `measureWorkerJson` enforces on one patched note payload; `truncateWorkerText` bounds a patched `context`; `linker.topK`/`maxPatches` are validated 1..32 to match the recall hard cap. `passive: true` skips linker and evolution only — consolidation is part of the write path, not a worker.
    - Not implemented, recorded as deferred: the optional host `extract?: (text) => notes` hook from Options Considered (optional in the plan; a host that wants extraction can call `remember` itself). No model, tool call, credential, or network access exists anywhere in this write path.
    - Checks: `packages/memory` `npm run typecheck` clean; `npm test` 395 pass / 4 skipped (postgres without DB) / 0 fail — fabric suite is 19 tests (9 notes + 10 consolidation); root `docs` 153 pass / 0 fail; root `packaging` 61 pass / 0 fail; root `install-smoke` 15 pass / 0 fail; `npm pack --dry-run` ships `dist/fabric/{index,create,types,consolidate,links,workers}.{js,d.ts}` plus `dist/compaction/observational-memory/limits.js` and no test artifacts.

- [x] **Task 4 — Recall, conversation search, explain**
  - Acceptance Criteria:
    - Functional: `recall(query, { kinds, asOf, budget, scoring })` returns hits + `explain[]`. 1-hop links included. Conversation search pages branch messages (lexical; optional embed). Consent/visibility/R08 tombstones excluded.
    - Performance: Same oversample-4 as `resolveRecallScoring`; conversation search hard-capped (reuse session search limits / OM pageLimit).
    - Code Quality: Call `memory.recall` + OM page helpers; do not fork ranking math.
    - Security: Explain has scores not raw neighbor payloads beyond returned hits; query redacted in events.
  - Approach:
    - Documentation Reviewed:
      - `docs/working-and-semantic-memory.md` — composite scoring.
      - `docs/compaction-observational-memory.md` — branch page.
      - `docs/session-stores.md` — search.
    - Options Considered:
      - Personalized PageRank (HippoRAG): extra graph engine. Defer; 1-hop is enough (ponytail: add PPR if multi-hop evals fail).
      - LLM recognition rerank default: extra call. Opt-in hook only.
    - Chosen Approach:
      - Compose existing recall + 1-hop + validity filter + explain struct.
    - API Notes and Examples:
      ```ts
      const { hits, explain } = await fabric.recall("preferred units", {
        topK: 8,
        scoring: { recencyWeight: 0.3, importanceWeight: 0.2, halfLifeMs: 7 * 86400000 },
      });
      // explain[0]: { id, similarity, recency, importance, link: true, valid: true }
      ```
    - Files to Create/Edit:
      - `packages/memory/src/fabric/recall.ts` (candidate window, explain rows, 1-hop promotion, `budget`)
      - `packages/memory/src/fabric/search.ts` (lexical branch scan + OM page per hit)
      - `packages/memory/src/fabric/__tests__/recall.test.ts`
      - `packages/memory/src/fabric/types.ts` (explain + conversation types, `budget`; `noteFields`/`estimateNoteTokens` moved here), `create.ts` (delegates recall, wires `searchConversation`), `index.ts` (exports)
      - `docs/memory-fabric.md` (recall/explain/search tables), `docs/working-and-semantic-memory.md` (Related APIs)
    - References:
      - `packages/memory/src/scoring.ts`
      - `recallObservationalMemoryBranchPage`
  - Test Cases to Write:
    - linked neighbor appears when seed hits
    - revoked consent: absent from hits
    - `asOf` filters validity
    - conversation search cursor respects OM pageLimit
    - ranking without `scoring` matches `memory.recall` order for facts-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes
    - Docs pages to create/edit:
      - `docs/memory-fabric.md`: recall/explain tables.
      - `docs/working-and-semantic-memory.md`: Related APIs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Completion Notes:
    - Landed: `recall.ts` (`resolveCandidateLimit`, `createFabricRecall`, `FabricCandidate`/`FabricCandidateLoader`), `search.ts` (`createFabricConversationSearch`, `lexicalCoverage`, `DEFAULT_CONVERSATION_SEARCH_TOP_K`), `recall.test.ts` (9 tests). `create.ts` now exposes `{ remember, recall, searchConversation }`: `recall` delegates to `createFabricRecall({ recallCandidates, limits })` and the write path keeps the same shared candidate loader. `types.ts` gained `MemoryFabricExplainEntry`, the conversation search types, `recall.budget`, and the `noteFields`/`estimateNoteTokens` helpers (moved out of `create.ts`).
    - 1-hop expansion is **batch-only**: a linked target is promoted into `hits` (with `explain.link === true`) only when it already sits in the oversampled candidate window the query returned, capped at `topK` extra hits. Rationale: `Memory` exposes no id/get primitive, and reading the host store directly would bypass `memory.recall`'s consent, `requireConsent`, and invalidation filtering — which the Security AC forbids. The seed hit's own `links` metadata still exposes the edge either way. Recorded as a `ponytail:` ceiling in `recall.ts` and in the docs; upgrade path is an id-lookup on `Memory` (or a host fetch hook) if distant links ever matter.
    - The window is `min(HARD_TOP_K_CAP, topK × RECALL_OVERSAMPLE)` collected from the **same single store query** as before (`memory.recall` does the ranking; `explain` reuses its `similarity`/`recency`/`importance`). Previously the loader stopped at `topK` valid candidates; it now keeps the oversample so primary hits stay identical while expansions have something to promote from. No second query, no forked ranking math.
    - `budget` is a prefix ceiling over the ranked order (primary hits, then promotions): the best hit is always returned, then the first note that does not fit ends the result. Validated as a positive safe integer (`MemoryValidationError`).
    - `explain` is returned on every recall (parallel to `hits`), carrying ids, scores, and `link`/`valid` flags — never a payload beyond the returned hits. `valid` is `true` for every returned hit by construction; kept because the plan's example names it, and it lets a caller log why a hit was admitted without re-deriving the `asOf` window.
    - Conversation search is lexical only: query-term coverage over `tokenizeLexical` of `serializeSessionEntry`, ranked by coverage then recency, then one `recallObservationalMemoryBranchPage` call per returned hit (so cursor semantics and `resolveRecallPageLimit` 1..100 validation are the OM helper's, untouched). No embed leg: it would need a host embedder the fabric is not given, so "optional embed" stays optional/deferred. `entries()` already returns the whole branch, so the scan adds no I/O; `scanned` reports how many eligible messages were examined, and matches are capped at the same 100 (default 5). Fails closed with `MemoryValidationError` when no `observational` source was supplied.
    - Search options are page parameters (`limit`/`direction`/`detail`) plus `topK` — no separate scan anchor, since the branch page is the unit a caller needs and the OM page helper already owns direction/cursor semantics.
    - Test-fixture note: the Task 2 test asserting `Object.keys(fabric)` was updated to include `searchConversation` (the fabric still starts nothing).
    - Checks: `packages/memory` `npm run typecheck` clean; `npm test` 408 pass / 4 skipped (postgres without DB) / 0 fail — fabric suite is 28 tests (9 notes + 10 consolidation + 9 recall/search); root `docs` 153 pass / `packaging` 61 pass / combined root run 448 pass / 0 fail; root `install-smoke` 15 pass / 0 fail (tarball import of `@arnilo/prism-memory/fabric`); `npm pack --dry-run` ships `dist/fabric/{index,create,types,recall,search,consolidate,links,workers}.{js,d.ts}`.

- [x] **Task 5 — Tools, file jail, core blocks**
  - Acceptance Criteria:
    - Functional: `fabric.tools()` returns inert `ToolDefinition[]` until the host puts them on `AgentConfig.tools`. `memory.insert` appends to working blocks under char cap + schema. File view/read/insert confined to `root`. `memory.forget` tombstones (R08 if present). OM recall tool remains separate.
    - Performance: Tool schemas small; file reads byte-capped (reuse coding-tools read caps or fabric `maxFileBytes`).
    - Code Quality: Tools are factories; no global registry mutation on import.
    - Security: Path traversal throws; forget requires ownership scope; insert does not activate new tools/skills.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md` — host-owned registration.
      - `docs/coding-security.md` — path jail.
      - Claude memory tool command set (view/read/create — map to view/read/insert only).
    - Options Considered:
      - Anthropic `memory_20250818` vendor tool type: provider-specific. Reject as required; host can alias names.
      - Letta `memory_rethink`: last-writer-wins footgun. Reject (F9).
    - Chosen Approach:
      - Five tools, jail, append-safe insert. Host activates by name like any tool.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({
        model,
        tools: [...fabric.tools({ root: memoriesDir })],
        context: [fabric.createContextProvider()],
      });
      const session = agent.createSession();
      await fabric.attach(session);
      ```
    - Files to Create/Edit:
      - `packages/memory/src/fabric/tools.ts`
      - `packages/memory/src/fabric/files.ts`
      - `packages/memory/src/fabric/blocks.ts` (labeled-block reads/appends/tombstones shared by `remember`/`insert`/`forget`)
      - `packages/memory/src/fabric/__tests__/tools.test.ts`
      - `packages/memory/src/fabric/{types,create,index}.ts` (`forget`, `tools`, session gate, exports)
    - References:
      - `createRecallMemoryTool` (do not merge)
      - working store OCC
  - Test Cases to Write:
    - `../etc/passwd` → throw
    - insert over char cap → throw, version unchanged
    - tools() without attach: definitions exist, execute fails closed until attach
    - forget then recall: miss
    - import `./fabric` does not register tools on a global

  - Completion Notes:
    - Landed: `files.ts` (`createFabricFileJail`, `DEFAULT_FABRIC_MAX_FILE_BYTES` 50 KiB / `HARD_FABRIC_MAX_FILE_BYTES` 1 MiB, `HARD_FABRIC_VIEW_ENTRIES` 200), `blocks.ts` (`FABRIC_BLOCK_LABEL`, `fabricBlockId`, `readFabricBlock`, `setFabricBlock`, `appendFabricBlock`, `tombstoneFabricBlock`), `tools.ts` (`createMemoryFabricTools`), `tools.test.ts` (7 tests). `create.ts` gained `forget` and `tools` plus the session gate; `types.ts` gained `MemoryFabricForgetInput`/`Result` and `MemoryFabricToolsOptions`; `index.ts` exports the two byte caps and the new types. `rememberWorking` now writes through `setFabricBlock`, so the block patch shape and the label rule live in one module.
    - Five tools exactly as F9 names them: `memory.view`, `memory.read`, `memory.insert`, `memory.recall`, `memory.forget`. `tools()` builds fresh definitions per call and registers nothing; `view` lists a jailed directory (default root, ≤200 entries), `read` reads one jailed file, `insert` appends to a block or a jailed file, `recall`/`forget` delegate to the fabric methods. OM's `createRecallMemoryTool` is untouched and stays the exact-id evidence tool (no merge).
    - The session gate is real code, not scaffolding: every tool call checks `isAttached(context.sessionId)` and returns `{ found: false, reason: "not_attached" }` until a host attaches a session (Task 6's `attach` is the only intended writer; nothing else can authorize a session). That is what "attach required for session workers/tools" (F1) means operationally, and `tools.test.ts` asserts it. Tool logic itself is covered by unit tests that call `createMemoryFabricTools(deps)` with the gate open, so no working path is left untested while `attach` waits for Task 6.
    - Jail: local `node:fs`/`node:path` helper, no dependency on `packages/prism-coding-tools` (constraint F15). Every path resolves against `root`; `..` and absolute escapes throw `MemoryValidationError`; the real path of the longest existing ancestor is re-checked, so a symlink inside the root cannot reach out. Reads are bounded before they are retained (`open` + one capped buffer, `truncated` reported); `append` stats first and refuses before writing, so an over-cap insert is a no-op. Appends are line-oriented: a non-empty file gains a newline unless the caller's text starts with one. Parent directories are created on append only — `view` creates nothing.
    - `insert` on a block appends under `limits.maxEntryTextChars` (existing cap reused, no new option) and writes with `expectedVersion` plus up to 3 bounded OCC attempts, so concurrent appends cannot silently lose one. The cap is checked before the write, which is what leaves the stored version unchanged on refusal (the plan's test case). The total working-store byte cap stays the store's job and surfaces unchanged.
    - `insert` on a file appends, then refreshes the `kind: "file"` note for that path by calling `remember` with the file text (head truncated at `limits.maxEntryTextChars`, reported as `noteTruncated`). With consolidation on (default) a same-path file note always folds into the same row — `planMemoryConsolidation` returns `update` for any same-path file note — so appending never grows a row per append; with `consolidate: false` each insert writes an independent note, which is the host's explicit choice. Nothing is deleted by a refresh.
    - `forget` tombstones through primitives that already exist: `memory.forget({ ids, hold })` for indexed notes (mark-invalidated then delete, or `legal_hold` — no second revocation plane, R08 honored) and `updateWorking` with cleared content plus `forgottenAt` for a block (label reusable; a forgotten or malformed block reads as absent, so a tombstone is never reported as content). Both paths act in the memory instance's own thread scope, so a tool can only reach what its fabric owns. `hold` is rejected for blocks and validated as a boolean at the fabric level; the tool forwards only `hold === true`.
    - Deviation: the jail and the file-note refresh live in the tool layer, not in `remember`. `remember` still stores whatever `path` the host hands it (fabric is a harness, not a filesystem police); only `memory.view`/`read`/`insert` are confined to `root`. Documented in `docs/memory-fabric.md`.
    - Bug found by this task's tests and fixed: the validity window was inclusive at `validTo`, so for one boundary millisecond a superseded note and its replacement were both current (a flaky `consolidate.test.ts` assertion exposed it). `isMemoryNoteValidAt` is now half-open (`validFrom` inclusive, `validTo` exclusive); the doc comment and `docs/memory-fabric.md` say so. Fabric tests were run three times in a row to confirm the flake is gone.
    - Checks: `packages/memory` typecheck clean; `npm test` 415 tests, 411 pass / 4 skipped (postgres without DB) / 0 fail — fabric suite is 35 tests (9 notes + 10 consolidation + 9 recall + 7 tools); `biome lint packages/memory/src/fabric` clean; `biome format` clean for the fabric directory; root `docs` 153 pass; `public-export-contract` + `packaging` + `docs` 448 pass / 0 fail; root `install-smoke` 15 pass / 0 fail; `npm pack --dry-run` ships `dist/fabric/{blocks,files,tools}.{js,d.ts}`.  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — tools
    - Docs pages to create/edit:
      - `docs/memory-fabric.md`: tools table + jail.
      - `docs/tools.md`: Related APIs (optional one-liner).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 6 — Attach, AgentDefinition recipe, compiler context seam**
  - Acceptance Criteria:
    - Functional: `attach(session)` is the only way workers run. Unattached fabric never writes. Recipe in docs: definition with `context: ["memory-fabric"]` **only** if the host registered that provider — core `AgentDefinition` gains **no required fabric field**. **Amended by Task 1 (evidence §6.1): 074 shipped without layer ids/handles — the provider tags blocks with `metadata.source` like `createMemory`'s provider and the compiler measures them as context cost.** Compiler off: blocks still inject via `resolveContextProviders`.
    - Performance: Unattached: no timers. Attached + `passive: true`: no workers (matches OM).
    - Code Quality: Copy OM `attach` shape (`appendEntry`, signal, secrets). Do not monkey-patch `createAgent`.
    - Security: Attach fails closed on session/store mismatch (same as OM).
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-definitions.md` — context provider names.
      - `docs/compaction-observational-memory.md` — attach.
      - `docs/attention-compiler.md` (074) — cost measurement only, **no layer ids** (evidence §6.1).
    - Options Considered:
      - `AgentDefinition.memoryFabric: true` in core: core would depend on memory package. Reject (F15).
      - Auto-attach when context provider resolves: hidden workers. Reject (F1).
    - Chosen Approach:
      - Session `attach` + host registry name. Docs recipe only.
    - API Notes and Examples:
      ```ts
      // Declarative agent: host registers the provider, still must attach on session.
      registries.contextProviders.register("memory-fabric", fabric.createContextProvider());
      resolveAgentDefinition({ name: "assistant", model, context: ["memory-fabric"] }, { registries, providerSource });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/fabric/attach.ts`
      - `packages/memory/src/fabric/provider.ts`
      - `packages/memory/src/fabric/__tests__/attach.test.ts`
      - `examples/memory-fabric.ts` (+ `examples/README.md` entry, `examples/tsconfig.json` path for `@arnilo/prism-memory/fabric`)
      - `packages/memory/src/fabric/{types,create,index}.ts` (`attach`, `createContextProvider`, worker gate, exports)
      - `packages/memory/src/fabric/__tests__/{consolidate,recall,notes}.test.ts` (attach-aware worker tests)
      - `scripts/budgets.json` (export-surface rebaseline for `@arnilo/prism-memory`, +84)
    - References:
      - OM `createObservationalMemory().attach`
      - `src/contributions.ts` `contextProviders`
  - Test Cases to Write:
    - no attach → remember via API works, workers skipped, no session custom entries from linker
    - attach + passive → no worker calls
    - provider `metadata.source` is `semantic-memory` for facts
    - compiler absent: provider still returns `ContextBlock[]`

  - Completion Notes:
    - Landed: `attach.ts` (`createFabricAttach`, `MemoryFabricAttachableSession`, `MemoryFabricAttachOptions`, `AttachedMemoryFabricSession`), `provider.ts` (`createMemoryFabricContextProvider`, `DEFAULT_MEMORY_FABRIC_PROVIDER_NAME`), `attach.test.ts` (6 tests), `examples/memory-fabric.ts`. `create.ts` gained `attach` + `createContextProvider` and the worker gate; `types.ts` gained the attach signatures on `MemoryFabric` and an optional `id` on the observation source; `index.ts` exports the provider factory, the default name, the attach types and `MemoryFabricSettings`. `consolidate`/`recall` tests now attach a stand-in session (the worker tests were previously riding on the ungated path), and `tools.test.ts` builds its fixtures through the real `fabric.attach` instead of the internal deps seam.
    - `attach` is the only gate, and it is a *read* on each call, never a background loop: no timers, no session proxy, no monkey-patching of `createAgent`. `attach(session, { signal })` → `{ session, contextProvider, settings, detach() }`; aborting the signal detaches. Workers (linker/evolution) now require `attachedSessions.size > 0` **and** `!passive`; consolidation stays on the write path. This is a behavior change for hosts that enabled workers without attaching — implicit enrichment exactly what F1 rejects — and it is asserted from both sides (unattached → no links/keywords; attached → links appear; `detach()` → no links again).
    - Fail-closed attach: rejects a non-object, a session without a non-empty `id`, a non-function `entries`, a non-`AbortSignal` signal, and an already-aborted signal (`MemoryAbortError`). It also rejects a session that is not the fabric's `observational` session (compared by id when the source exposes one) because `searchConversation`/`episode` read that branch — an attached session may not read another one.
    - Provider = the memory provider under the fabric's default name: blocks keep `metadata.source` `working-memory` / `semantic-memory` exactly as `createMemory` tags them, so the compiler measures context cost and repacks nothing, and blocks still inject when the compiler is off (asserted via `resolveContextProviders` with no compiler in scope). No layer id, no handle, no per-source quota (074 Task 6 evidence). `ponytail:` delegation, not duplication — the upgrade path (kind/validity-filtered injection over the fabric's own `recall`) is marked in the source.
    - Recipe is docs-only and core stays clean: the host registers `fabric.createContextProvider()` in `registries.contextProviders` under its own name and lists that name in `context`; `AgentDefinition` gains no fabric field (asserted in the test through `createContributionRegistries().contextProviders.resolve("memory-fabric")`, and exercised end-to-end in the example with `resolveAgentDefinition({ context: ["memory-fabric"] }, { registries, providerSource })`).
    - Deviation from the "copy OM attach shape (`appendEntry`, signal, secrets)" note: the fabric takes `signal` only, and uses it as the lifecycle signal (abort ⇒ detach). `appendEntry` has nothing to append — workers write memory rows, not transcript entries, and `attach.test.ts` asserts the session's `entries()` is never called on the write path; `credential`/`secrets` have nothing to spend because no worker calls a model. Adding either would be a dead knob, so they are documented as absent rather than accepted and ignored.
    - Budget gate: `scripts/budgets.json` exportCounts for `@arnilo/prism-memory` rebaselined 696 → 780 with a dated reason entry (measured 696 without the fabric directory, 780 with it; the gate now reports "within ceiling").
    - Checks: `packages/memory` typecheck clean; `npm test` 421 tests, 417 pass / 4 skipped (postgres without DB) / 0 fail (fabric suite 41); `biome lint` + `biome format` clean for the fabric directory and the new example; `tsc -p examples --noEmit` clean; `node examples/memory-fabric.ts` runs end-to-end (network-free); root `docs` 153 pass (nav, README listing, demo runner); `packaging` + `public-export-contract` 295 pass / 0 fail; `install-smoke` 15 pass / 0 fail; `npm pack --dry-run` ships `dist/fabric/{attach,provider}.{js,d.ts}`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — attach/provider
    - Docs pages to create/edit:
      - `docs/memory-fabric.md`: attach + definition recipe.
      - `docs/agent-definitions.md`: recipe note (not a new required field).
      - `docs/attention-compiler.md` (the 074 orientation page) + `docs/context-and-skills.md`: cross-link fabric; **`docs/context-engineering.md` does not exist** (074 Task 6 rejected it — evidence §6.2).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 7 — Docs finish, OM relationship, eval fixture**
  - Acceptance Criteria:
    - Functional: `docs/memory-fabric.md` complete per API template. OM, working/semantic, compiler, context-engineering pages cross-link and state **OM remains episodic**. One eval fixture: promoting a case conclusion into `procedure` fails a scorer (or a tiny assert test if 072 scorers are absent). Example in docs.
    - Performance: n/a
    - Code Quality: Index blurbs one sentence, no plan numbers, no version narrative.
    - Security: Docs say default-off, no LLM-on-write, jail, R08 injection block, procedure/fact split.
  - Approach:
    - Documentation Reviewed:
      - prism-wiki.md / `docs/api-page-template.md`
      - `docs/compaction-observational-memory.md`
      - `docs/working-and-semantic-memory.md`
      - `docs/attention-compiler.md` / `docs/context-and-skills.md`
    - Options Considered:
      - Merge fabric into working-and-semantic-memory.md: that page is the `createMemory` contract. Reject as home; link it.
    - Chosen Approach:
      - Own API page under Compaction/session memory; orientation page updated.
    - API Notes and Examples:
      ```md
      # Memory fabric
      ## What it does
      ...
      ```
    - Files to Create/Edit:
      - `docs/memory-fabric.md`
      - `docs/attention-compiler.md` (fabric section; `docs/context-engineering.md` does not exist — evidence §6.2)
      - `docs/compaction-observational-memory.md`
      - `docs/working-and-semantic-memory.md`
      - `docs/context-and-skills.md` (OM-stays-episodic clause next to the fabric link)
      - `docs/index.md` (blurb already added Task 2)
      - `packages/memory/src/fabric/invariants.ts` + `packages/memory/src/fabric/__tests__/eval-procedure.test.ts`
      - `packages/memory/src/fabric/index.ts` + `scripts/budgets.json` (+1 invariant export)
      - `examples/memory-fabric.ts` (referenced from the page; written in Task 6)
    - References:
      - Plan 072 scorers if present
      - `packages/memory/src/__tests__/eval-revocation.test.ts` — the in-package precedent: a tiny local invariant body, no `@arnilo/prism-core` import
      - OpenAI: process memory ≠ case facts
  - Test Cases to Write:
    - docs nav test if present
    - procedure/fact split assertion

  - Completion Notes:
    - Docs are complete against the API template (headings already satisfied the root docs test) and the new behavior is stated where a reader looks for it: default-off/inert until a host registers a provider and attaches; **no model call on any fabric path** (write, fold, linker, evolution, `searchConversation`); the file jail; the `procedure` vs `fact` split; and the one revocation plane (revoked/corrected/forgotten/legal-hold notes are excluded from recall **and** injected context before background cleanup, legal hold retained but never injected, no second tombstone or parallel derivation table — R08 consumed, not reinvented). `examples/memory-fabric.ts` is referenced from the Implementation example section.
    - OM stays episodic, stated once per page that touches the boundary: on [compaction-observational-memory.md](compaction-observational-memory.md) (this page's ledger/workers are the only writers, nothing downstream re-observes, promotion is an explicit host write) and mirrored into the fabric page's new "Relationship to observational memory" subsection (episode notes are views by id, never copies, never observations), working-and-semantic-memory.md, attention-compiler.md (the compiler protects the ledger and mutates only its history clone), and context-and-skills.md.
    - Eval fixture uses the plan's tiny-assert fallback, matching the in-package precedent `src/__tests__/eval-revocation.test.ts` rather than importing `@arnilo/prism-core/governance/evals` (which would be a phantom dependency from this package): `caseConclusionsNotProcedures` in `packages/memory/src/fabric/invariants.ts` keeps `revokedIdsAbsent`'s exact body shape (`{ score, metadata: { invariant: true } }`, token-exact matching via `tokenizeLexical`) so a host wraps it with `defineScorer({ invariant: true, ... })`; the fixture `__tests__/eval-procedure.test.ts` grades the host path at 1 and the anti-pattern (case conclusion re-filed as a `procedure`) at 0, and asserts untyped recall never surfaces a procedure. Negative check run by hand: promoted → 0, recipe-only → 1, `14711` does not false-positive.
    - Export surface: +1 for the invariant (`scripts/budgets.json` 780 → 781, dated reason); measured 781, gate green. Index blurbs unchanged: one sentence, no plan numbers, no version narrative.
    - Checks: `packages/memory` typecheck clean; `npm test` 422 tests, 418 pass / 4 skipped / 0 fail (fabric 42); biome lint + format clean; root `docs` 153 pass (nav, README listing, demo runner); `packaging` + `public-export-contract` 295 pass; `install-smoke` 15 pass; `npm pack --dry-run` ships `dist/fabric/invariants.{js,d.ts}` and no test artifacts.  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — current-line docs.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: no unless Task 2 entry missing.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Compromises Made

- Opt-in / default-off. Compiler does not attach fabric.
- No new package; subpath on `@arnilo/prism-memory`.
- No Graphiti/Neo4j. Validity fields + 1-hop links only. PPR later if multi-hop evals fail.
- No LLM extract/evolve by default (poison + cost). Host hooks only.
- Episode kind aliases OM ids — fabric will not re-observe the transcript.
- No `AgentDefinition.memoryFabric` in core (would import memory). Host registry + `attach`.
- No `memory_rethink`. Append-safe insert + OCC on working blocks.
- Recognition-memory LLM rerank deferred to a host hook.
- Eval vocabulary is shared by shape, not by import: the fabric invariant mirrors plan 072's `defineScorer` body (`{ score, metadata: { invariant: true } }`) but `@arnilo/prism-memory` does not import `@arnilo/prism-core/governance/evals` — adding that devDependency would be the upgrade path if these fixtures ever join a shared harness.

## Further Actions

All seven tasks landed. Follow-ups, in the order they are worth doing:

1. **Work-scope projection** (blocked on [077](077-Work-Scope-Memory-Index.md)): `projectWorkMemory` is not in tree, so fabric notes carry `metadata.fabric.context` but no work-scope index. When 077 lands, add the projection instead of a second scope tree. **Updated (2026-09-15):** 077 landed; the fabric now reads the existing index (`foldWorkScopeMap`) for closed-scope reflection promotion (`remember({ kind: "fact" | "procedure", reflectionId })`) rather than growing a second scope tree — notes still carry the host's `context` line, and no fabric-owned scope state exists.
2. **Multi-hop recall**: ship PPR only if a multi-hop eval fixture fails on 1-hop expansion; the batch-only expansion rule (neighbors must already be in the recalled batch) is what keeps recall at one store query — changing it needs `VectorStore` id lookup plus a consent re-check.
3. **Eval harness join**: the fabric invariant is a local body (no `@arnilo/prism-core` dependency in this package). If more fixtures accumulate, add `@arnilo/prism-core` as a devDependency and wrap them with `defineScorer`/`assertEvaluationThreshold` in one shared dataset.
4. **Shared eval fixture location**: `src/__tests__/eval-revocation.test.ts` (073 R08) and `src/fabric/__tests__/eval-procedure.test.ts` (075) are the two invariant fixtures; if a third appears, give them a home under one directory rather than per-module `__tests__`.
5. **Host extract hook**: deferred by design — a host that wants LLM extraction calls `remember` itself, keeping the fabric's no-model-on-write property. Do not add an extract option without a poison/cost story.
6. **Vendor wire shapes** (Graphiti/Mem0-style `add`/`search` adapters) and a recognition-memory LLM rerank stay host hooks; add adapters only when a host integration needs the exact wire shape.
7. **Stamp `metadata.fabric.tRef` in examples/tests when 076-style temporal queries appear**: `tRef` is validated and stored but nothing reads it yet — the first consumer should decide its semantics rather than guessing now.
