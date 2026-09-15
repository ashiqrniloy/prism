# Phase 75 — Primitive Review: Memory Fabric Inventory

Plan: [075-Memory-Fabric.md](../../plans/075-Memory-Fabric.md) Task 1 ("Primitive review — compose, do not clone OM or createMemory").
Date: 2026-09-15. Baseline: released `@arnilo/prism-memory@0.6.0` plus the 073-line R08 work and the completed [074](../../plans/074-Attention-Compiler.md) compiler in tree.
Scope: **read-only**. This document is the gate for Tasks 2–7: no `fabric/` code lands before it. §4 is the do-not-duplicate list Task 2+ is checked against.

Cite convention: `covers:` spans are `file:Lstart–Lend` in this tree. Every span below was read at that exact range, not inferred from prose.

---

## 1. Baseline facts (what is actually in tree)

| Fact | Evidence |
| --- | --- |
| R08 (lineage / correction / revocation) **is** in tree — not a plan-only dependency | `packages/memory/src/lineage.ts` (`assertLineage` `L56–L70`, `recordBlocked` `L140–L153`, `collectInvalidationIds` `L159–L183`, `explainRecord` `L215–L231`, `revokedIdsAbsent` `L234–L243`, `invalidateAcrossLayers` `L245–L263`); invalidation types `packages/memory/src/types.ts:L100–L116`; docs `docs/working-and-semantic-memory.md:L236`, `L259` |
| 074 compiler **is** in tree **without** layer ids or handles | `src/attention-compiler.ts` (`createAttentionCompiler` `L131`, `compileAttention` `L305`, `measureInputCost({ groups, context, skills, tools })` `L310`); plan 074 rejects 12-layer manifests/handles (`plans/074-Attention-Compiler.md:L14`, `L541`) |
| 077 work scopes are **not** in tree | no `projectWorkMemory` symbol anywhere in `packages/memory/src` or `src`; `plans/077-Work-Scope-Memory-Index.md` unimplemented |
| Package is `@arnilo/prism-memory@0.6.0`, imports are inert | `packages/memory/package.json:L3` (`"version": "0.6.0"`), `"sideEffects": false` `L106`; existing subpaths `.`, `./rag`, `./rag/loaders`, `./rag/parsers`, `./compaction/llm`, `./compaction/observational-memory`, `./graft`, `./wiki` |
| No fabric package, no graph vendor dep | `packages/` has no `fabric` dir; memory deps are `{ "pg": "^8.23.0" }` with peers `@arnilo/prism` + optional `@nanonets/graft` — no `graphiti`, `neo4j`, `mem0`, `zep` |
| `Memory` is the **only** public read/write seam; it does not expose its stores | `packages/memory/src/types.ts:L382–L416` — `recall`/`remember`/`setConsent`/`correct`/`forget`/`applyRetention`/`exportMemory`/`rebuildIndex`/`createContextProvider`; no `vectorStore`/`workingStore` getter |

**Consequence:** fabric composes against `Memory` + OM helpers. Anything `Memory` does not expose (lexical leg, raw store, metadata filters) is a gap (§3), not a reason to clone the store.

---

## 2. Inventory

### 2.1 Working store — `packages/memory/src/working-memory.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `L6–L8` | `MemoryWorkingStoreOptions` | `maxWorkingMemoryBytes` (default 256 KiB). |
| `L10–L71` | `createMemoryWorkingStore` | In-memory reference store: `get`/`set`/`update`/`delete` keyed by full scope (`scopeKey`). |
| `L21–L37` | `set` | Rejects non-integer `version < 1`; enforces byte cap; freezes + deep-clones the JSON value. |
| `L39–L63` | `update` | **OCC**: `expectedVersion` mismatch throws `MemoryConflictError`; `mode: "merge"` (default) or `"replace"`; bumps `version`; `updatedAt` ISO. |
| `L73–L87` | `validateWorkingValue` | Schema hook: `schema` (JSON Schema) and/or `validateWorkingMemory` custom fn; failure is a write error. |

Scope is `{ tenantId, resourceId, threadId? }` (`types.ts:L5–L10`) with `WorkingMemoryKey extends MemoryScope` — thread-less records are resource-level working memory. `createMemory` wires the same store through `getWorking`/`updateWorking`/`deleteWorking`/`renderWorking` (`packages/memory/src/memory.ts:L111–L140`).

### 2.2 Semantic core — `packages/memory/src/memory.ts`, `types.ts`, `limits.ts`, `scoring.ts`, `lineage.ts`, `acl.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `memory.ts:L60–L612` | `createMemory(options)` | One closure over `embedder` + optional `vectorStore`/`workingStore`; scope is mandatory tenant+resource, thread optional. |
| `memory.ts:L142–L186` | `indexEntries` | Write path: validate id/text/chars → **`redactJson` text at `L153`** → `embedBatched` → **`stampLineage(redactJson(metadata))` at `L162`** → `normalizeConsent` → payload byte cap `L178–L180` → `vectorStore.upsert`. |
| `memory.ts:L188–L198` | `remember` | `RememberResult { accepted, pending, done }` (`types.ts:L283–L288`) — fire-and-forget unless `wait: true`. |
| `memory.ts:L200–L279` | `recall` | Single gate (see 2.3). |
| `memory.ts:L281–L287` | `findEntry` | Id lookup inside one thread scope. |
| `memory.ts:L289–L312` | `setConsent` | Re-upserts in place; no re-embed. |
| `memory.ts:L314–L335` | `correct` | Re-embeds, preserves id/sequence/metadata/consent, writes invalidation rows with reason `corrected`. |
| `memory.ts:L337–L368` | `forget({ ids?, hold? })` | R08 order: `markInvalidated` first (`L83–L109`), then real delete unless `hold`; returns deleted count. |
| `memory.ts:L395–L449` | `applyRetention` | Bounded age/count sweep; real deletes after invalidation rows; needs `countByThread`. |
| `memory.ts:L451–L482` | `exportMemory` | Identity-bound (`Required<MemoryScope>`), redacted, consent-explicit page; excludes legacy consent-less rows. |
| `memory.ts:L484–L525` | `rebuildIndex` | Re-embed one bounded page under a cursor. |
| `types.ts:L255–L272` | `MemoryEntryInput` | `id`, `text`, `metadata?`, `consent?`, `sequence?`, `createdAt?`, `importance?`, `reflection?`, **`lineage?: { sourceIds, reason? }`** — the R08 hook fabric needs. |
| `types.ts:L290–L312` | `RecallScoringOptions` / `RecallOptions` | `scoring`, `topK`, `messageRange`, `requireConsent`, `explain`, `shareFromParentThreadId`, `signal`. **No `kinds`, no `asOf`, no metadata filter.** |
| `types.ts:L56–L82` | `MemoryVectorRecord` / `MemoryVectorHit` | Record carries `metadata?: JsonObject`, `consent?`, `importance?`, `embedderId?`, `generation?`; hit adds `score` + optional `similarity`/`recency`. |
| `types.ts:L37–L41` | `MemoryRetentionPolicy` | `maxAgeDays` / `maxEntries` / `batchSize`. |
| `limits.ts:L45–L139` | `MemoryLimits` + `resolveMemoryLimits` | Hard-capped: `topK`, `messageRange`, `embedBatchSize`, `maxPayloadBytes`, `maxInjectedTokens`, `maxVectorDimensions`, `maxEntryTextChars`, `maxWorkingMemoryBytes`, export/rebuild caps. |
| `scoring.ts:L7` | `RECALL_OVERSAMPLE = 4` | Fetch multiplier, applied **only when scoring resolves** (`memory.ts:L218–L219`). |
| `scoring.ts:L62–L85`, `L99–L113` | `resolveRecallScoring`, `rerankRecallHits` | Weight validation + sum-normalized blend; pure, store-agnostic. |
| `lineage.ts:L140–L153` | `recordBlocked` | An entry is blocked when its own id or a `metadata._lineage.sourceIds` ancestor is invalidated (walk depth 8, 256 edges, 32 source ids — docs `L236`). |
| `lineage.ts:L234–L243` | `revokedIdsAbsent` | Eval-style invariant: denied ids never injected. |
| `acl.ts:L40–L93` | `assertAccessConstraint`/`grantAllows` | Query-time document ACL; tenant-bound, unresolved version denies. |

### 2.3 Recall gate (verified order, `memory.ts:L200–L279`)

1. `topK`/`messageRange` clamped by `resolveMemoryLimits` (`L204–L209`);
2. query **redacted** then embedded (`L211–L214`);
3. `resolveRecallScoring` + `fetchK = topK * 4` **only if scoring** (`L218–L219`);
4. `vectorStore.query` (`L221–L226`), optional parent-thread share leg (`L229–L252`);
5. `rerankRecallHits(...).slice(topK)` (`L253`) — ranking math lives here, never duplicated;
6. adjacent `messageRange` window via `selectAdjacentRecords` (`L255–L259`);
7. **one** consent/visibility/invalidation gate `L261–L266` (`isInjectable` + `recordBlocked`);
8. hits/adjacent **redacted** at `L268–L269`; `explain` adds `explainRecord` rows only when requested (`L270–L278`).

There is **no lexical leg in `recall`** and **no metadata filter on `VectorQuery`** (`types.ts:L144–L152`: embedding, topK, threadId, authorization, ids only).

### 2.4 Observational memory — `packages/memory/src/compaction/observational-memory/`

| File | Span | Primitive | Behavior |
| --- | --- | --- | --- |
| `ids.ts` | `L6–L8` | `createMemoryId(...parts)` | Deterministic 12-hex id derivation — the only id mint for observations/reflections. |
| `types.ts` | `L12–L19` | `MemoryObservation` | `{ id, content, timestamp, relevance, sourceEntryIds, tokenCount }` — source-backed, no store row outside the session ledger. |
| `types.ts` | `L21–L26` | `MemoryReflection` | `{ id, content, supportingObservationIds, tokenCount }`. |
| `types.ts` | `L58–L127` | `isMemoryId`, `isMemoryObservation`, `isFoldedMemoryDetails`, … | Fail-closed parsers for every ledger payload. |
| `ledger.ts` | `L22–L83` | `foldObservationalMemoryLedger`, `activeObservations`, `observationBlockedByInvalidation`, `reflectionBlockedByInvalidation` | Ledger is **folded from session entries**; invalidation blocks derived injection before cleanup. |
| `projection.ts` | `L27–L81` | `buildObservationalMemoryProjection`, `createFoldedMemoryDetails`, `foldFromDetails` | Projection/dropper view; `invalidatedIds` withholds without deleting sources. |
| `recall.ts` | `L48–L131` | `recallObservationalMemory` | Exact-id evidence recall (observation or reflection) + invalidation awareness. |
| `recall.ts` | `L133–L208` | `recallObservationalMemoryBranchPage` | **Bounded branch page**: cursor + `direction` + `detail: summary\|full` + `limit`; returns `invalid_cursor`/disabled text rather than throwing. |
| `tool.ts` | `L15–L107` | `createRecallMemoryTool` | Inert `ToolDefinition` factory for exact-id recall; no global registration. |
| `limits.ts` | `L17–L57` | `resolveMemoryWorkerLimits` | Worker caps (turns/tool calls/arg/result/message/error bytes) with hard ceilings — **the** worker-limit resolver fabric must reuse. |
| `limits.ts` | `L133–L139` | `resolveRecallPageLimit` | Bounded branch-page limit. |
| `worker-loop.ts` | `L28–L118` | `runMemoryWorkerLoop` | Shared bounded worker loop (turns, tool calls, byte caps). |
| `workers/observer.ts` `L25`, `workers/reflector.ts` `L24`, `workers/dropper.ts` `L45` | — | `runObserver`, `runReflector`, `runDropper` | The **only** transcript-scanning workers. |
| `compose.ts` | `L113–L301` | `createObservationalMemory` | Attach shape: `L137–L281` wraps `run`/`prompt`/`stream` behind a `runDepth` guard; session `attach` requires host `appendEntry` (`L90–L97`); context provider `L175–L184` resolves `buildObservationalMemoryContextBlocks` (`recent-messages.ts:L52`); `sync` `L187–L210` is post-run only, skips on `passive`, then negotiates `resolveShouldCompact` (074 seam) and calls `session.compact()` at the task boundary. |
| `strategy.ts` | `L18` | `createObservationalMemoryCompactionStrategy` | Deterministic, no-model compaction render. |

### 2.5 Session branch + search — `src/contracts-core/session.ts`, `src/contracts-run-state.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `session.ts:L46` | `SessionStore` | `append`/`list`/… plus optional `searchSessions?(query)`. |
| `session.ts:L84–L96` | `SessionSearchQuery` | `workspaceRoot`, `query` text, provider/model/label/summary, time range, ownership — **session-level index, not branch entries**. |
| `session.ts:L101–L115` | `SessionSearchHit` / `SessionIndex` | Hits carry `sessionId`/`leafId`/label/summary/snippet — never transcripts. |
| `session.ts:L67–L81` | hard caps | `LIMIT 100`, query 16 KiB, snippet 4 KiB, linear 5 000 sessions / 50 000 entries / 64 MiB. |
| `contracts-run-state.ts:L333–L355` | `AgentSession` | `entries()`, `checkout`, `compact`, `run`/`prompt`/`stream`/`subscribe`, `fork`/`clone` — the attach surface fabric wraps; there is no `appendEntry` (OM gets it from attach options). |

### 2.6 Workspace FS containment — `packages/prism-coding-tools/src/security/path-containment.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `path-containment.ts:L38` | `assertPathInsideRoots(roots, target)` | Symlink-aware (`realpath` + containment) root check; exported at `security/index.ts:L114`. |
| docs `docs/coding-security.md:L206` | stated contract | "Containment resolves symlinks and rejects paths outside roots." |

**Gap:** `@arnilo/prism-coding-tools` is **not** a dependency or devDependency of `@arnilo/prism-memory` (`packages/memory/package.json` deps = `pg`; devDeps = `@arnilo/prism`, `@arnilo/prism-providers`, `@nanonets/graft`, `@types/pg`). Importing it would be a new dependency, which F15 forbids. Fabric's file jail is therefore ~15 lines of `node:fs` `realpath` + `path.relative` (fail closed on `..`, symlink escape, absolute mismatch), with the same test shape as Task 5's `../etc/passwd` case.

### 2.7 Lexical / hybrid retrieval — `packages/memory/src/rag/`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `retrieve.ts:L25–L64` | `retrieveContext` | Hybrid retrieval (vector + lexical + RRF) over a **`VectorStore`**, with RAG-specific sources/citations/caps; lexical defaults to `fts` when the store declares it, `bm25` requires the capability. |
| `fusion.ts:L16`, `L52` | `fuseReciprocalRankLists` / `fuseReciprocalRank` | Deterministic RRF fusion — the only ranking-fusion primitive in the repo. |
| `types.ts:L175–L186` | `VectorLexicalQuery` / `LexicalMode` | Lexical request shape (`fts`/`bm25`). |
| `vector-memory.ts:L276–L…`, `postgres.ts:L738–L…` | `lexicalModes: ["fts"]` + `lexicalQuery` | Both shipped stores implement an FTS lexical leg. |
| `index.ts:L140` | `tokenizeLexical` export | Reusable lexical tokenizer without a store handle (for fabric's local near-duplicate check). |

**Gap:** `Memory` exposes no lexical recall and no store, so fabric cannot reach `lexicalQuery` through `createMemory` alone (see §3, finding 4).

### 2.8 Package / docs gates later tasks must satisfy

| Gate | Span | Consequence |
| --- | --- | --- |
| Memory exports map is pinned exactly | `src/__tests__/packaging.test.ts:L235–L247` | Task 2's `exports["./fabric"]` **must** update this assertion; `packaging.test.ts:L98–L108` also requires every exports target to be in the pack. |
| Exactly one `docs/index.md` nav link per page | `src/__tests__/docs.test.ts:L335–L345` | `docs/memory-fabric.md` gets exactly one entry; the Compaction/session memory section is `docs/index.md:L55–L60`. |
| Index links must resolve | `docs.test.ts:L234–L243` | No dead links from the new page or its cross-links. |
| Every example listed in `examples/README.md` | `docs.test.ts:L3029–L3032` | Task 6's `examples/memory-fabric.ts` needs its backticked row. |
| Eval scorers live in another package | `packages/prism-core/package.json:L51` (`./governance/evals`) | See finding 10. |

---

## 3. Reuse vs gap (decision table)

| Fabric need | Existing primitive | Verdict | Gap Tasks 2–7 must fill |
| --- | --- | --- | --- |
| Note id format (F2) | `createMemoryId` (`ids.ts:L6–L8`) + `isMemoryId` (`types.ts:L58–L60`) | **Reuse** | Nothing; a fabric note id is an OM-shaped 12-hex id. |
| Fact persistence (F3) | `memory.remember`/`recall` (`memory.ts:L188`, `L200`) over the host's vector store | **Reuse** | Nothing; fabric metadata rides in `MemoryEntryInput.metadata`. |
| Working blocks (F3/F11) | `WorkingMemoryStore` OCC (`working-memory.ts:L39–L63`) + `createMemory` working methods (`L111–L140`) + schema hook (`L73–L87`) | **Reuse** | Append-merge helper + char cap on top; no new store. |
| Episode notes (F3) | OM ledger/projection (`ledger.ts`, `projection.ts`) + `isMemoryId` | **Reuse as id views** | `kind: "episode"` stores **ids only**; no duplicate row, no second observer. |
| Consent, visibility, redaction (F1/F13) | `MemoryConsent` (`types.ts:L22–L29`), `normalizeConsent`/`isInjectable` (`memory.ts:L641–L661`), `redactJson` on write and recall | **Reuse (pass-through only)** | Fabric must not mint consent rules; it forwards `consent` and refuses `visible: false`. |
| Invalidation / derived blocking (F13) | R08 `lineage` + `recordBlocked` + `collectInvalidationIds` + `forget` | **Reuse** | Set `MemoryEntryInput.lineage.sourceIds` from `sourceEntryIds`; blocking then comes free. |
| Ranking (F6/F7) | `resolveRecallScoring` + `rerankRecallHits` + `RECALL_OVERSAMPLE`, `explain` (`MemoryRecallExplanation`, `lineage.ts:L215`) | **Reuse** | Validity/`asOf` and kind filters compose **around** ranked hits; never fork the blend. |
| Near-duplicate write consolidation (F4) | `tokenizeLexical` (`index.ts:L140`) + recall candidates | **Reuse parts** | New deterministic keep/update/supersede/insert fold — no LLM, no store. |
| Worker caps (F5) | `resolveMemoryWorkerLimits` + `runMemoryWorkerLoop` | **Reuse** | Linker/consolidator worker caps; no copied observer/reflector. |
| Bounded conversation search (F8) | `session.entries()` + `recallObservationalMemoryBranchPage` + `resolveRecallPageLimit` | **Reuse** | Branch paging; `searchSessions` is the wrong primitive (cross-session index). |
| Context injection (F12) | `createContextProvider` pattern (`memory.ts:L527–L576`), `ContextBlock.metadata` (`src/contracts-core/agent.ts:L226–L232`) | **Reuse pattern** | New provider emitting working + top-k semantic handles; compiler only measures cost. |
| Tools (F9) | `ToolDefinition` factories + host-owned registry (`docs/tools.md:L136–L153`, `createRecallMemoryTool`) | **Reuse pattern** | Five inert tool factories; no global registration, OM tool untouched. |
| File jail (F10) | `assertPathInsideRoots` (coding-tools, not importable) | **Gap** | Local realpath/relative containment in `fabric/files.ts` (§2.6). |
| Lexical recall leg (F6) | `VectorLexicalQuery` + `fuseReciprocalRankLists`, but only reachable with a `VectorStore` | **Gap** | Finding 4: optional host-supplied store, or v1 vector-only. |
| Kind filter / validity windows (F3/F6) | `metadata: JsonObject` only; `VectorQuery` has no metadata filter | **Gap (small)** | Post-filter in TS with explicit oversample (finding 3). |
| Second observer / second transcript store | — | **Reject** | Nothing; fabric never scans the transcript for observations. |
| Second vector contract / second consent type / second id format / second invalidation plane | `VectorStore`, `MemoryConsent`, `createMemoryId`, R08 | **Reject** | Nothing; reuse or the feature does not ship. |
| New package or required graph DB | — | **Reject** | Nothing; subpath on `@arnilo/prism-memory` (F15). |

---

## 4. Do-not-duplicate list (frozen gate)

1. **No second observer.** `runObserver`/`runReflector`/`runDropper` remain the only transcript-scanning workers; fabric never folds or re-summarizes the transcript.
2. **No second vector contract.** All persistence goes through `MemoryVectorRecord`/`MemoryEntryInput` and the host's `VectorStore`; no fabric table, no fabric embedding type.
3. **No second consent type.** `MemoryConsent`/`MemoryConsentInput` and the single `recall()` gate (`memory.ts:L261–L266`) are the only visibility authority.
4. **No second id format.** 12-hex `createMemoryId`/`isMemoryId`; a fabric note id must be interchangeable with an OM id.
5. **No second invalidation/lineage plane.** R08 rows (`MemoryInvalidationRecord`) + `metadata._lineage`; `forget`/`correct` stay the mutation entries.
6. **No second ranking math.** `resolveRecallScoring`/`rerankRecallHits`; explain reuses `MemoryRecallExplanation`.
7. **No second session store or transcript copy.** Branch reads go through `session.entries()` and the existing branch-page helper; `searchSessions` is the cross-session index and is not re-implemented.
8. **No second graph engine.** Links are metadata on records (`links[]`), expanded in TS one hop; no Neo4j/Graphiti requirement, no PPR engine.
9. **No second tool registry or tool.** Five inert factories; `createRecallMemoryTool` stays the exact-id evidence tool; no `memory_rethink`.
10. **No second attach/runner.** `attach(session)` copies the OM shape (wrap `run`/`prompt`/`stream`, `runDepth`, post-run sync, `passive`); `createAgent` is never monkey-patched.
11. **No second working store or memory factory.** Fabric calls `createMemory`/`createMemoryWorkingStore`; it is not a `createMemory` replacement.
12. **No new package and no new dependency.** Rejects `@arnilo/prism-fabric` (F15: publish/manifest cost for one subpath) and Graphiti/Neo4j/Mem0/Zep as required deps; the repo already has `@nanonets/graft` as an optional peer, which is the only allowed graph-shaped neighbor.
13. **No second eval/timeline machinery.** Reuse 072 scorers when importable, else a plain assert test.

---

## 5. Security confirmations

- **Redaction is already at both ends.** Write: `redactJson(text)` (`memory.ts:L153`) and `redactJson(metadata)` (`L162`) before embed/upsert. Read: hits and adjacent redacted at `L268–L269`; the session redacts provider requests independently. Fabric may only add consumers of `redactor`, never a path around it.
- **Consent cannot be widened by fabric.** `normalizeConsent` defaults `{ source: "user", scope: "thread", visible: true }` (`L641–L654`); `isInjectable` excludes only explicit `visible: false`/revoked, and `requireConsent: true` additionally excludes consent-less rows (`L657–L661`). Fabric writes notes **without inventing consent** and must **fail closed** if asked to store `visible: false` (a note the host then cannot see is not a feature — it is a hidden channel). `setConsent` stays host/tool-driven.
- **`requireConsent` is create-time and per-call**: `CreateMemoryOptions.requireConsent` (`types.ts:L360`) and `RecallOptions.requireConsent` (`types.ts:L299–L312`). Fabric must forward the host's setting on every recall it performs, including consolidation/linker candidate reads — a filter applied only to the public `recall` path is a bypass.
- **R08 blocking precedes cleanup.** `recordBlocked` + `collectInvalidationIds` walk lineage before any body delete, and legal hold rows are retained but never injected (`lineage.ts:L140–L183`, `memory.ts:L337–L368`; docs `L236`, `L259`). Fabric citing `sourceEntryIds` in `lineage` inherits both behaviors; no `visible: false` shortcut is needed or allowed.
- **Explain leaks nothing new.** `MemoryRecallExplanation` (`types.ts:L133–L142`) carries ids/scope/reason/invalidation only; fabric's `explain[]` must stay scores + flags, no neighbor payloads beyond the returned hits.
- **File jail fails closed.** Traversal, symlink escape, and non-absolute targets throw before any read; reads are byte-capped (`MemoryLimits` precedent + fabric `maxFileBytes`).
- **Caps stay.** `maxPayloadBytes`, `maxEntryTextChars`, `maxWorkingMemoryBytes`, worker byte caps, and branch-page limits are untouched; fabric adds no unbounded scan (no full-corpus `getByThread` walk on the hot recall path).

---

## 6. Findings that amend later tasks (from this review)

1. **074 has no layer/handle seam.** Plan 074 explicitly rejects 12-layer ids and handles (`plans/074-Attention-Compiler.md:L14`, `L541`), and `compileAttention` consumes `context` blocks only through `measureInputCost` (`src/attention-compiler.ts:L310`). Task 6's AC "fabric provider sets `metadata.layer`" has no consumer in tree: fabric should tag blocks like the existing provider (`metadata.source: "working-memory"` `L547` / `"semantic-memory"` `L567`) and Task 6's AC should be reworded to "provider returns `ContextBlock[]`; compiler packs it as cost-measured context, unchanged".
2. **`docs/context-engineering.md` does not exist.** 074 Task 6 rejected creating it (`plans/074-Attention-Compiler.md`, Task 6 "Options Considered"). Tasks 6–7 must cross-link the real orientation pages instead: `docs/attention-compiler.md`, `docs/context-and-skills.md`, `docs/compaction-observational-memory.md`, `docs/working-and-semantic-memory.md`, plus the `docs/index.md:L55–L60` section.
3. **Kind filtering needs explicit oversampling.** `VectorQuery` has no metadata filter (`types.ts:L144–L152`) and `fetchK = topK * 4` applies only when scoring resolves (`memory.ts:L218–L219`). Fabric's `kinds`/validity post-filter must fetch oversampled regardless of host `scoring` (resolve a default scoring or request its own bounded candidate batch) or a `procedure`-heavy store starves `fact` recall.
4. **No lexical leg on `Memory`.** `recall` is vector-only; `lexicalQuery`/`fuseReciprocalRankLists` need a `VectorStore` handle (`rag/retrieve.ts:L51–L64`, `types.ts`, `vector-memory.ts:L276`, `postgres.ts:L738`). Either accept an optional host `store` in `createMemoryFabric` for the lexical/hybrid leg, or ship v1 vector+link recall and state the deferral in docs. Do not fork fusion math.
5. **Conversation search is a branch page, not `searchSessions`.** `SessionSearchQuery` indexes sessions (`session.ts:L84–L115`); branch-entry paging already exists as `recallObservationalMemoryBranchPage` + `resolveRecallPageLimit` (`recall.ts:L133–L208`, `limits.ts:L133–L139`). Fabric's search composes `session.entries()` with those helpers.
6. **File jail cannot import the existing containment helper** (§2.6): new dependency. Local fail-closed helper in `fabric/files.ts`, with the traversal/symlink test Task 5 lists.
7. **`packaging.test.ts` pins the memory exports map** (`L235–L247`) — Task 2's new subpath updates that assertion in the same commit.
8. **Docs gates are structural**: exactly one index link per page (`docs.test.ts:L335–L345`) and every example listed in `examples/README.md` (`docs.test.ts:L3029–L3032`).
9. **Consolidation must await writes.** `remember` is fire-and-forget by default (`memory.ts:L188–L198`); the near-duplicate/linker path reads neighbors, so it must `wait: true` (or await `result.done`) before candidate recall, or consolidation races its own write.
10. **072 scorers are not importable from the memory package.** They live behind `@arnilo/prism-core/governance/evals` (`packages/prism-core/package.json:L51`), which is not a dependency of `@arnilo/prism-memory`. Use the plan's own fallback — a tiny assert test for the procedure/fact split (Task 7) — or add the devDependency deliberately; do not add a runtime dep.
11. **No 077 work scopes.** `projectWorkMemory` does not exist, so `kind: "episode"` notes reference OM ids (and `invalidatedIds` from R08) only; the host work-scope view is a later addition, per plan.

---

## 7. Bounds already in tree (no new caps needed before Task 2)

`maxWorkingMemoryBytes` 256 KiB default · working `version >= 1` + OCC `expectedVersion` · `MemoryLimits` hard caps (`topK`, `messageRange`, `maxPayloadBytes`, `maxInjectedTokens`, `maxVectorDimensions`, `maxEntryTextChars`) · `RECALL_OVERSAMPLE = 4` · invalidation walk depth 8 / 256 edges / 32 source ids / 64-row batches · retention batch cap · export page 100/200 entries, 4/32 MiB, 10/60 s · OM worker caps (`resolveMemoryWorkerLimits`, hard ceilings) · branch page limit (`resolveRecallPageLimit`) · session search hard caps (`session.ts:L67–L81`) · `HARD_MAX_SKILL_*`/tool-search caps are unrelated but unchanged.

## 8. Deferred (other owners)

- 077 work scopes / `projectWorkMemory` (episode notes gain a working-set view there, not here).
- Graphiti/Neo4j adapter behind `recall`; HippoRAG PPR; recognition-memory LLM rerank (host hook).
- Vendor memory-tool wire shapes (Anthropic `memory_20250818`, host aliasing) — not required by fabric.
- 074 packing of fabric blocks beyond cost measurement (no layer ids exist to pack into).
