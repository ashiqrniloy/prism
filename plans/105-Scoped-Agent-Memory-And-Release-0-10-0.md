# Scoped Agent Memory

Implements the concept in `docs/scoped-agent-memory.md` in full as a new opt-in policy
subpath of `@arnilo/prism-memory` (`@arnilo/prism-memory/scoped`). Lands in the **0.10.0**
line; the version bump, compat baseline, and publish are [106](106-Hook-Lifecycle-Completion.md)
Tasks 8–10 (moved there after Tasks 1–9 shipped).

Precondition: the 0.9.0 cut (plans 099/100) has landed. Nothing here changes default
behavior of any existing session — the scoped layer activates only when a host creates it.

## Objectives

- Ship the scoped memory policy layer: workspace-root scope identity, conservative post-run
  writer, promotion ladder (candidate → verified after N reuses), usage-decay GC, read policy
  (abstain floor + activation budget + decay/usage-weighted scoring), bounded facts block,
  injection scanning, staged approval, git audit mirror.
- Reuse the shipped mechanisms (fabric folding/linker/evolution, observational ledger and
  reflections, working/semantic stores) — the scoped layer adds policy, not a new store.
- Add the evaluation harness the concept doc declares non-negotiable: win-rate A/B,
  retrieval precision@3, health metrics.
- 0.10.0 cut (bump, baseline, publish) lives on plan 106, not here.

## Expected Outcome

- `@arnilo/prism-memory/scoped` exports `createScopedMemoryPolicy()` with the API surface
  below; example `examples/scoped-memory.ts` runs network-free end to end
  (scope guard → recall floor/budget → post-run candidate write → promotion → GC → mirror).
- `docs/scoped-memory.md` documents the composed memory-management pattern for hosts;
  `docs/index.md` and `docs/scoped-agent-memory.md` cross-link it.
- 0.10.0 bump / `release:gate` / publish: plan 106 Tasks 8–10.

## Tasks

- [x] Task 1: Primitive review — map every concept mechanism to a shipped primitive or a named new one
  - Acceptance Criteria:
    - Functional: An inventory table (concept mechanism → shipped primitive → new code required) is recorded in this task's completion notes and confirms or corrects the maps in `docs/scoped-agent-memory.md` (layered architecture, read/write paths, research leverage). Every planned API below is either justified by a gap or dropped. The inventory includes the **wiki boundary**: `@arnilo/prism-memory/wiki` (docs/wiki.md) is a knowledge *compiler* over raw sources (regenerable, line-anchored citations) while scoped memory holds session-derived *experience* (primary records, provenance `sourceEntryIds`) — the inventory confirms no storage overlap and states the routing rule: source-cited knowledge → wiki (`wiki_record_insight`/ingest), session-derived experience → scoped memory.
    - Performance: No new runtime dependency packages; scoped layer must compose existing `createMemory`/`createMemoryFabric`/observational instances.
    - Code Quality: The review names where usage state, status metadata, and approval staging live (see Options below) before any implementation task starts.
    - Security: Review splits two primitives: reuse observational `secrets` / working-memory `redactJson` / `createSecretRedactor` for known-secret redaction; name a new pure scanner `scanScopedMemoryContent` for injection/exfil/invisible-Unicode (no shipped scanner exists).
  - Approach:
    - Documentation Reviewed:
      - `docs/scoped-agent-memory.md` (concept; storage, write/read paths, lifecycle, trust boundary)
      - `docs/memory-fabric.md` (folding `consolidate.threshold` 0.85, `validFrom`/`validTo`/`supersedes`, linker/evolution workers, `recall` kinds/asOf/budget/explain, five tools, file jail, `forget`)
      - `docs/compaction-observational-memory.md` (observations/reflections, 12-hex ids, `sourceEntryIds`, work-scope `open/bind/project/enter`, exact-id recall)
      - `docs/working-and-semantic-memory.md` (`createMemory` options, consent, lineage, `importanceFrom`)
      - `docs/compaction-llm.md` and `docs/use-case-model-selection.md` (provider-backed model call pattern for the cheap review model)
      - `docs/wiki.md` (LLM wiki compiler — boundary + routing rule; `wiki_record_insight` is the overlapping tool surface)
    - Options Considered:
      - Usage counter stored as note metadata rewritten on every recall — rejected: rewrites vector-store rows on every read, churns embeddings and folding identity.
      - Status in fabric note metadata (`metadata.fabric` / `metadata.scoped`) — rejected: `parseMemoryNoteMetadata` is fail-closed and drops unknown fields; `mergeNoteMetadata` rebuilds only known fabric keys; `MemoryFabricRememberInput` has no metadata bag, so a policy cannot stamp sibling keys without a fabric API change.
      - One JSON ledger keyed by note id for usage + status + staging — chosen: reads never mutate notes; promotion is a ledger flip (id unchanged, folding identity untouched); mirror joins ledger into frontmatter.
    - Chosen Approach: One gitignored ledger `<scopeRoot>/.memory/state.json` (usage, status, staging). All note writes go through existing fabric APIs. Scope identity is `memory.scope.resourceId === scopeRoot` plus a stable `threadId` (not the session id). Secrets reuse `createSecretRedactor` / observational `secrets` / working `redactJson`. Injection/exfil/invisible-Unicode is a **named new** pure scanner (`scanScopedMemoryContent`) — nothing shipped scans those classes.
    - API Notes and Examples:
      ```ts
      // surface confirmed by this task
      import { createScopedMemoryPolicy } from "@arnilo/prism-memory/scoped";
      ```
    - Files to Create/Edit: none (review task; corrections land in Tasks 2–7).
    - References: `docs/scoped-agent-memory.md` "Relationship to existing Prism memory surfaces"; skill rule 6 (primitive-first for reusable capabilities).
  - Test Cases to Write:
    - n/a (review task; its correctness check is Task 2–8 acceptance).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (review only).
    - Docs pages to create/edit: `docs/scoped-agent-memory.md` — mapping corrections (wiki boundary, ledger location, scan vs redaction, composition `threadId` + `includeSemantic: false`).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - State lives in one ledger `<scopeRoot>/.memory/state.json` (gitignored): `notes[id].{uses,lastUsedAt,status,promotedAt,createdAt}` + `pending[]`. Not on fabric notes.
    - Wiki boundary: `@arnilo/prism-memory/wiki` compiles source-cited knowledge into `.wiki/` (regenerable, line anchors). Scoped memory holds session-derived experience in fabric notes (`sourceEntryIds`). Routing: source-cited → wiki (`wiki_ingest` / `wiki_record_insight`); session-derived → scoped. No storage overlap.
    - Inventory (concept → shipped → new):
      | Mechanism | Shipped | New |
      | --- | --- | --- |
      | Workspace silo | `createMemory` tenant/resource/thread isolation | Policy binds `scopeRoot` to `memory.scope.resourceId`; require stable `threadId` (fail closed if missing or if `resourceId` ≠ `scopeRoot`). |
      | Scope guard | fabric file jail; `fabric.attach` observational-session match | Create-time identity assert; wrap file/mirror paths. No per-note scope stamp. |
      | Typed records | fabric kinds `fact`/`procedure`/`working`/`episode`/`file` | Concept `note`/`insight` → `fact`. Status is ledger, not a kind. |
      | Validity / supersede / fold | `validFrom`/`validTo`/`asOf`; `planMemoryConsolidation` insert/update/supersede | none |
      | MERGE near-duplicates | — | GC pass |
      | Links / evolution | fabric linker + evolution workers | none |
      | Episodes / provenance | OM ledger, `searchConversation`, `sourceEntryIds`/`reflectionId` | none |
      | Always-on facts | working block + context provider | `rememberFact` 2200-char budget (engine cap is `maxEntryTextChars`); host sets `includeSemantic: false` |
      | Query routing | `fabric.recall` kinds/asOf/budget/explain + similarity/recency/importance | wrapper: abstain floor, top-3, `scoreScopedHit` |
      | Usage × decay | — | ledger + `scoreScopedHit` |
      | Promotion ladder | — | `promotionPass` ledger status flip (no fabric rewrite) |
      | Post-run writer | compaction-llm provider call; use-case model bind; OM digest/reflections | `reviewSession` + noop-biased prompt + JSON schema |
      | Staging / approval | — | ledger `pending[]` |
      | Facts overflow | `appendFabricBlock` throws over `maxEntryTextChars` | tighter 2200 + consolidate-first listing |
      | Secret redaction | `createSecretRedactor`/`redactSecrets`; `createMemory({redactor,secrets})`; OM `secrets`; working `redactJson` | reuse on writes + mirror |
      | Injection / exfil / invisible Unicode | **none** (redactor is needle-only) | **`scanScopedMemoryContent`** |
      | List notes (mirror/GC) | `memory.exportMemory` paging (`consent.visible`, skips `recordBlocked`) | policy stamps visible consent on writes; no `Memory.list` |
      | legal_hold | `fabric.forget({hold:true})`; invalidate preserves hold | GC skips ids absent from export |
      | Git mirror | file jail | deterministic renderer over export + ledger |
      | Health / A/B / precision@3 | `@arnilo/prism-core/governance/evals` `defineScorer` / step-budget / datasets | scoped fixtures + `runScopedMemoryEval` |
      | LoCoMo episodic | OM exact-id recall | probe fixtures |
      | Wiki compiler | `@arnilo/prism-memory/wiki` | routing rule only |
    - Planned APIs kept (gap): `createScopedMemoryPolicy`, `policy.recall`, `scoreScopedHit`, `reviewSession`, `promotionPass`/`gcPass`/`health`, `rememberFact`, `approve`/`reject`/`pending`, `renderMirror`, `scanScopedMemoryContent`, `runScopedMemoryEval`.
    - Dropped: `metadata.scoped` on notes; fabric rewrite on promotion; treating redactor as an injection scanner; `Memory.list` / fabric metadata bag; hybrid lexical+vector fusion (still deferred).
    - No new runtime dependency packages. Compose existing `createMemory` / `createMemoryFabric` / observational instances.
    - Duplication-rate health: fabric.remember does not return the fold plan; count “returned id already in ledger” as a fold.

- [x] Task 2: Scope identity and scope guard — `createScopedMemoryPolicy()` core
  - Acceptance Criteria:
    - Functional: `createScopedMemoryPolicy(options)` binds a workspace root to a `createMemory()`/`createMemoryFabric()` pair (`memory`, `fabric`, `scopeRoot` required). Throws when `memory.scope.resourceId` ≠ resolved `scopeRoot` or `threadId` is missing. Unattached policy is inert (no timers, no workers) — mirroring fabric's attach gate.
    - Performance: Scope check is O(1) per call (compare stored scope string), no extra store round-trip.
    - Code Quality: Options validated like fabric inputs (throw on missing `memory`/`fabric`/`scopeRoot`, on a fabric whose `observational` session mismatch — fail closed, no partial state).
    - Security: No path from the policy to files outside `scopeRoot` except the explicit mirror render (Task 7, which uses the fabric file-jail rules).
  - Approach:
    - Documentation Reviewed: Task 1 inventory; `docs/memory-fabric.md` (attach gate, file jail, validation patterns); `docs/working-and-semantic-memory.md` (`tenantId`/`resourceId` isolation).
    - Options Considered:
      - Enforce scope by convention only (host passes the right `resourceId`) — rejected: the concept's headline guarantee is the silo boundary; convention is not a guard.
      - Stamp `metadata.scoped.scope` on every note — rejected: fabric remember has no metadata bag and the fabric schema strips unknown fields (Task 1).
      - Create-time identity assert on the bound `memory` instance — chosen: vector isolation already silos by resource/thread; one throw at create is the guard.
    - Chosen Approach: Policy holds `{ scopeRoot }`. Create throws unless `memory.scope.resourceId` equals the resolved `scopeRoot` and `memory.scope.threadId` is a non-empty stable silo id (not the agent session id — `fabric.attach` gates the session separately). Create does not attach and does not write files. Observational session mismatch stays on `fabric.attach` (fabric does not expose the bound observational id). File/mirror paths (Tasks 6–7) use the fabric file jail. No per-note scope stamp.
    - API Notes and Examples:
      ```ts
      const policy = createScopedMemoryPolicy({
        memory, fabric, scopeRoot: "/home/me/work/api-server",
        policy: { promotion: { reuseThreshold: 2 }, decay: { tauDays: 30, candidateArchiveDays: 30 },
                  activation: { topK: 3, minSimilarity: 0.35 },
                  facts: { block: "facts", maxChars: 2200 },
                  approval: { default: "off" } },
      });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/scoped/index.ts`: public exports.
      - `packages/memory/src/scoped/policy.ts`: `createScopedMemoryPolicy`, option types, defaults.
      - `packages/memory/src/scoped/__tests__/policy.test.ts`.
      - `packages/memory/package.json`: `./scoped` subpath export.
      - Freeze companions: `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`, `scripts/e2e-coverage.json`, `scripts/budgets.json` (+6 export names).
    - References: concept "Scope model"; fabric attach/file-jail fail-closed patterns.
  - Test Cases to Write:
    - Missing required options throw; defaults applied for omitted policy knobs.
    - `resourceId` mismatch or missing `threadId` throws at create (fail closed).
    - Inert when created (no side effects until a method is called).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package subpath `@arnilo/prism-memory/scoped`.
    - Docs pages to create/edit: `docs/scoped-memory.md` (created in Task 9; this task only ships code).
    - `docs/index.md` update: yes, in Task 9 together with the API page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Read policy — abstain floor, activation budget, decay/usage-weighted scoring, usage ledger
  - Acceptance Criteria:
    - Functional: `policy.recall(query, opts)` wraps `fabric.recall`: applies `activation.topK` (default 3) and drops every hit below `activation.minSimilarity`; if the best hit is below the floor it returns an explicit empty result (`{ hits: [], abstained: true }`), never a weak hit. Ranking multiplies fabric score by `exp(-ageDays/tauDays) × (1 + ln(1 + uses))` using the usage ledger. Every returned hit increments `uses`/`lastUsedAt` in the ledger.
    - Performance: Recall overhead ≤ 1 ledger read + 1 ledger write (single JSON file, bounded by note count); no model calls.
    - Code Quality: Pure scoring function exported for tests (`scoreScopedHit`); ledger updates atomic (write-to-temp + rename) to survive concurrent readers.
    - Security: Ledger file lives under the scoped data dir (gitignored); it never stores note content, only ids/counters/timestamps.
  - Approach:
    - Documentation Reviewed: `docs/memory-fabric.md` (`recall` options, `explain` rows, `budget`); `docs/scoped-agent-memory.md` read path (floor, top-3, scoring formula, Hermes #22620 decay evidence).
    - Options Considered:
      - Extend fabric `recall` with new options — rejected: fabric stays mechanism-only; the floor is policy.
      - Wrapper that post-filters and re-ranks fabric hits — chosen: no fabric change, deterministic, testable in isolation.
    - Chosen Approach: Wrapper + exported pure scorer + one JSON ledger (`<scopeRoot>/.memory/state.json`, gitignored): usage counters live here (and status/staging from Tasks 4–6). Fetch oversamples with `RECALL_OVERSAMPLE` then clamps to `activation.topK`. Similarity floor uses `hit.similarity ?? hit.score`. Corrupt JSON → empty ledger (zero uses), no logger. Ledger rows preserve `status`/`pending` for later tasks; writes never include note content. Last-write-wins rename (no lock).
    - API Notes and Examples:
      ```ts
      const { hits, abstained } = await policy.recall("deploy without downtime",
        { kinds: ["procedure"] }); // floor/budget/decay applied
      ```
    - Files to Create/Edit:
      - `packages/memory/src/scoped/read-policy.ts`.
      - `packages/memory/src/scoped/ledger.ts`.
      - `packages/memory/src/scoped/__tests__/read-policy.test.ts`.
      - `packages/memory/src/scoped/policy.ts` / `index.ts`: `policy.recall`, `scoreScopedHit`.
      - `scripts/budgets.json`: export ceiling 909 → 917.
    - References: Generative Agents scoring; Hermes issue #22620 measured decay fix; concept "Read path".
  - Test Cases to Write:
    - All hits below floor → `abstained: true`, empty hits, no usage increments.
    - topK clamp: 10 fabric hits → ≤ 3 returned, ranked by combined score not raw similarity.
    - Ledger increments once per returned hit; corrupt ledger fails closed (treat as zero uses).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `policy.recall` behavior.
    - Docs pages to create/edit: `docs/scoped-memory.md` (Task 9).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Post-run conservative reviewer — candidate writes through the fabric
  - Acceptance Criteria:
    - Functional: `policy.reviewSession(digest | sessionEntries, { reviewer })` runs a host-supplied reviewer hook (model-neutral, same shape as compaction-llm provider calls; bind the model via use-case model selection) with a noop-biased prompt: default output is zero writes; write triggers limited to user correction, error→recovery, a technique reused within the session, or explicit "remember this". Accepted outputs become `fabric.remember` calls — kind `fact`/`procedure`, `consent.visible`, `sourceEntryIds` provenance from the digest — so fabric folding, linker, and evolution all fire on the same write path. Ledger row `status: "candidate"` is upserted on the returned note id (fold reuse keeps the id).
    - Performance: One reviewer call per session run (not per turn); input is a bounded digest (recent turns verbatim + summarized tail), reviewer model chosen by the host.
    - Code Quality: Reviewer output is a validated JSON array of proposed writes; anything unparseable or off-schema is dropped whole (fail closed to noop), never partially applied.
    - Security: Proposals carry no content beyond what the digest supplied; if `approval.default = "staged"`, proposals queue in the staging ledger instead of writing (Task 6 gates the flush).
  - Approach:
    - Documentation Reviewed: `docs/compaction-llm.md` (provider-backed call pattern), `docs/use-case-model-selection.md` (cheap-model binding), `docs/memory-fabric.md` (`remember` fields, folding, `reflectionId` path), `docs/compaction-observational-memory.md` (digest/reflection shapes, `sourceEntryIds`).
    - Options Considered:
      - Review on every turn (Hermes `background_review`) — rejected: cost + the action bias that caused the throwaway flood.
      - Post-run review with conservative prior — chosen; matches concept write path and AWM's repetition stance.
      - Derive candidates only from observational reflections via `reflectionId` — kept as an alternate input; the reviewer may also propose from raw digest entries when no closed-scope reflection exists.
    - Chosen Approach: Single post-run reviewer hook → validated proposals → fabric writes (or staging). Prompt ships as a tunable template (calibration knob, per ponytail rule: physical/workload variance needs knobs).
    - API Notes and Examples:
      ```ts
      await policy.reviewSession(digest, { reviewer: llmReviewer(compactionModel) });
      // → { proposed: 2, written: 2, staged: 0, status: { candidate: 2 } }
      ```
    - Files to Create/Edit:
      - `packages/memory/src/scoped/reviewer.ts` (prompt template, proposal schema, validation).
      - `packages/memory/src/scoped/__tests__/reviewer.test.ts`.
    - References: concept write path; Hermes `background_review` (inverted bias); Mem0 adjudication already provided by fabric folding.
  - Test Cases to Write:
    - Reviewer returns garbage/unknown fields → zero writes, no throw past the call.
    - A correction-trigger proposal lands as `candidate` fact with `sourceEntryIds`, and a duplicate proposal folds into the existing note (fabric threshold) instead of a new row.
    - `approval: "staged"` routes proposals to staging, fabric untouched until approve.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `policy.reviewSession`.
    - Docs pages to create/edit: `docs/scoped-memory.md` (Task 9) including the one-line cost trade-off: one extra reviewer call per session run (opt-in, off unless the host calls it).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - `policy.reviewSession(digest, { reviewer, prompt? })` — one host hook call. Digest is a string or entry list (last 8 verbatim, earlier `[id] kind`, cap 24k chars). Default prompt is noop-biased; `prompt` overrides.
    - Reviewer output coerced from JSON / fenced JSON / already-parsed value. Must be an array of `{kind,content,sourceEntryIds}` with no extra keys. Unparseable, off-schema, mixed-valid, or thrown hook → `{proposed:0,written:0,staged:0}` and no ledger/fabric writes (no throw past the call). Missing `reviewer` throws.
    - `approval.default: "off"` → `fabric.remember({kind, content, sourceEntryIds, consent:{visible:true,source:"agent"}})` then ledger upsert `status:"candidate"` on the returned id (fold reuse keeps id/createdAt/uses). `"staged"` appends `{kind:"review", proposal, createdAt}` to `pending[]`; fabric untouched (Task 6 flushes).
    - No `reflectionId` path this task (content + `sourceEntryIds` only). Scan/redact is Task 6.
    - Exports +3 (`reviewScopedSession`, `ScopedMemoryReviewer`, `ScopedMemoryReviewResult`); budget 917 → 920.

- [x] Task 5: Promotion ladder and usage-decay GC passes
  - Acceptance Criteria:
    - Functional: `policy.promotionPass()` flips ledger `candidate` → `verified` (same note id, `promotedAt`; no fabric rewrite — status is not a fabric field) for notes whose ledger shows ≥ `promotion.reuseThreshold` uses since creation (default 2). `policy.gcPass()` archives: candidates unused for `candidateArchiveDays` (default 30) and notes whose decay score `uses × exp(-ageDays/tauDays)` falls below a floor — archive = `pending[]` proposal (recommend-then-delete); nothing is deleted silently, `fabric.forget` runs only on host approval. Skip ids absent from `memory.exportMemory` (held/forgotten). `policy.health()` returns the concept's health metrics: duplication rate (remember returned an id already in the ledger), candidate→verified conversion, activation rate (used hits / returned hits), note counts by status.
    - Performance: Both passes are O(n) over notes with no model calls; safe to run as an idle job (Letta sleep-time placement).
    - Code Quality: Promotion does not rewrite fabric rows, so createdAt/consent/links are untouched; an archived note keeps `validTo` untouched (archive is ledger status, not temporal invalidation).
    - Security: GC proposals never bypass approval; `legal_hold` notes are never proposed for archive.
  - Approach:
    - Documentation Reviewed: `docs/memory-fabric.md` (rewrite-in-place fold, `forget`/`legal_hold`), concept "Lifecycle — metabolism", Task 3 ledger.
    - Options Considered:
      - Delete outright below threshold — rejected: concept trust boundary ("GC proposes, humans dispose").
      - Staged archive proposals — chosen; also gives the promotion/GC audit trail the mirror renders.
    - Chosen Approach: Two idempotent ledger passes + `health()`; thresholds are the documented tuning knobs. Catalog of policy notes is the ledger; live/held filter is `exportMemory`.
    - API Notes and Examples:
      ```ts
      await policy.promotionPass(); // { promoted: 1 }
      await policy.gcPass();        // { proposed: 3, archived: 0 }
      policy.health();              // { notes: {...}, activationRate: 0.62, ... }
      ```
    - Files to Create/Edit:
      - `packages/memory/src/scoped/lifecycle.ts`.
      - `packages/memory/src/scoped/__tests__/lifecycle.test.ts`.
    - References: Voyager verification-before-permanence; Hermes #12877 §1/§2; Letta sleep-time consolidation.
  - Test Cases to Write:
    - Candidate with 2 uses promotes once and not again (idempotent); fabric row unchanged.
    - Stale candidate → GC proposal; approval runs `forget`; disapproval leaves the note live.
    - `legal_hold` note never proposed (absent from export); a reviewer fold keeps `createdAt`/links (Task 4).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `promotionPass`/`gcPass`/`health`.
    - Docs pages to create/edit: `docs/scoped-memory.md` (Task 9).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - `policy.promotionPass()` flips live ledger `candidate` → `verified` + `promotedAt` when `uses >= reuseThreshold` (default 2). Same note id; no fabric rewrite. Idempotent. Ids absent from `memory.exportMemory` (held/forgotten) are skipped.
    - `policy.gcPass()` is recommend-then-delete: candidates unused ≥ `candidateArchiveDays` (lastUsedAt ?? createdAt) and verified notes with `uses × exp(-ageDays/tauDays) < 1` get ledger `status:"archived"` plus `{kind:"archive", id, reason, createdAt}` on `pending[]`. `archived` in the return is always 0 — `fabric.forget` is host/Task 6. Missing timestamps skip (fail closed on delete). Already archived/pending skipped.
    - `policy.health()` is a ledger snapshot: counts by status, `conversionRate` = verified/(candidate+verified), `activationRate` = notes with uses>0 / total, `duplicationRate` = stats.duplicates/stats.writes (reviewer increments on remember fold).
    - Exports +3 (`runScopedPromotionPass`, `runScopedGcPass`, `scopedMemoryHealth`); budget 920 → 923.

- [x] Task 6: Facts block budget, injection scan, staged approval gate
  - Acceptance Criteria:
    - Functional: `policy.rememberFact(text)` writes to the working block named by `facts.block` (default `"facts"`); when the block would exceed `facts.maxChars` (default 2200) the call fails with a consolidate-first error listing current entries (Hermes overflow pattern), and the agent/host must merge or remove before retry. Every record surface the policy can inject or write (facts block writes, reviewer proposals, mirror renders) passes `scanScopedMemoryContent` then the memory redactor; matches fail closed with the offending pattern class named. `policy.approve(id)`/`policy.reject(id)`/`policy.pending()` operate the staging ledger for every staged write kind (reviewer proposals, GC archives).
    - Performance: Scan is pure-pattern (no model); budget check is a length comparison.
    - Code Quality: One gate implementation reused by all three surfaces; scan failures are logged with pattern class, never with the payload.
    - Security: This is the trust-boundary task — scanning before any prompt-injectable surface, staged approval default `off` for personal scopes and recommended `staged` for team scopes (documented, not forced).
  - Approach:
    - Documentation Reviewed: Hermes memory docs (overflow-error UX, security scanning of `MEMORY.md`), Task 1 scan primitive choice, fabric working-block insert behavior (`maxEntryTextChars` throw).
    - Options Considered:
      - Auto-truncate the facts block on overflow — rejected: silent data loss at a trust boundary.
      - Fail with consolidate-first — chosen (Hermes-validated pattern; forces deliberate curation).
    - Chosen Approach: Reuse `redactSecrets`/`createMemory` redactor for secrets. New pure `scanScopedMemoryContent` for prompt-injection / exfil / invisible-Unicode (no shipped scanner). Wrap fabric working-block insert; staging in the Task 3 ledger.
    - API Notes and Examples:
      ```ts
      try { await policy.rememberFact("Staging SSH uses port 2222, not 22"); }
      catch (e) { /* MemoryBudgetError: 2,100/2,200 chars — consolidate first */ }
      const pending = await policy.pending(); // staged writes with gists
      await policy.approve(pending[0].id);
      ```
    - Files to Create/Edit:
      - `packages/memory/src/scoped/facts.ts`.
      - `packages/memory/src/scoped/trust.ts` (scan + staging gate).
      - `packages/memory/src/scoped/__tests__/trust.test.ts`.
    - References: concept "Trust boundary"; Hermes `write_approval` and memory security scan.
  - Test Cases to Write:
    - Overflow throws with current-entries payload; a consolidation (remove) then succeeds.
    - Injection-pattern fact (prompt-injection/exfil/invisible-Unicode fixtures) refused, pattern class named, nothing written.
    - Staged reviewer proposal + GC archive approve/reject lifecycle end to end.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — facts gate, approval surface.
    - Docs pages to create/edit: `docs/scoped-memory.md` security section (Task 9).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - `policy.rememberFact(text)` appends to working block `facts.block` (default `"facts"`). Over `facts.maxChars` (2200) throws `MemoryLimitError` with `used/max — consolidate first` plus current newline entries. Host consolidates via `fabric.forget({ block })` then retries. Reused `MemoryLimitError`; no `MemoryBudgetError`.
    - One gate: `scanScopedMemoryContent` then `gateScopedMemoryContent` (throw `scoped memory refused: <class>`, never payload). Classes: `prompt-injection`, `exfil`, `invisible-unicode`. Applied on facts writes, reviewer proposals (stage and write), and approve-of-review. Secret redaction stays `createMemory` redactor on write (Task 7 mirror reapplies for files).
    - `policy.pending()` / `approve(id)` / `reject(id)` cover staged reviewer proposals (`kind:"review"`, random id) and GC archives (`kind:"archive"`, note id, `prevStatus` for reject restore). Approve-archive runs `fabric.forget`; held notes stay pending.
    - Exports +6; budget 923 → 929.

- [x] Task 7: Git audit mirror — deterministic markdown export
  - Acceptance Criteria:
    - Functional: `policy.renderMirror()` writes one markdown file per note (frontmatter: id, kind, status, scope, validity window, provenance `sourceEntryIds`, uses, lastUsedAt, links) plus `facts.md` into `<scopeRoot>/.memory/`, excluding `state.json`. Output is deterministic (stable ordering by id, stable frontmatter key order) so diffs are meaningful; deleted/archived notes disappear from the mirror but git history retains them.
    - Performance: O(n) writes; a weekly digest is `git log --oneline .memory/` — no code needed.
    - Code Quality: Renderer reads only fabric notes + ledger; it never writes back; mirror is never read by the runtime (audit surface only, per the concept's "one write path, two views").
    - Security: Content passes the Task 6 scan before render; secrets redaction (`memory` redactor) applies so the mirror is committable.
  - Approach:
    - Documentation Reviewed: concept storage section (fabric = source of truth, mirror = audit view); fabric note fields; `docs/memory-fabric.md` export/redaction notes.
    - Options Considered:
      - Markdown as source of truth with a fabric importer — rejected: two write paths, folding/consent would bypass.
      - Deterministic export — chosen.
    - Chosen Approach: Pure renderer with stable serialization over `exportMemory` pages + ledger; `.gitignore` guidance emitted for `state.json`.
    - API Notes and Examples:
      ```ts
      await policy.renderMirror(); // <scopeRoot>/.memory/{facts.md, notes/*.md}
      ```
    - Files to Create/Edit:
      - `packages/memory/src/scoped/mirror.ts`.
      - `packages/memory/src/scoped/__tests__/mirror.test.ts`.
    - References: concept "Storage — Prism realization".
  - Test Cases to Write:
    - Two consecutive renders are byte-identical (no changes in between).
    - Superseded note renders with closed `validTo`; archived note absent from mirror; ledger `uses` reflected in frontmatter.
    - Redacted secret never appears in mirror output.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `renderMirror`.
    - Docs pages to create/edit: `docs/scoped-memory.md` (Task 9).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - `policy.renderMirror()` writes `<scopeRoot>/.memory/{.gitignore,facts.md,notes/<id>.md}`. Never writes/reads `state.json`. Stale `notes/*.md` unlinked. `.gitignore` is `state.json`.
    - Notes from `exportMemory` + ledger: skip archived and scan-fail content. Frontmatter key order: id, kind, status, tenantId, resourceId, threadId, validFrom, validTo, sourceEntryIds, uses, lastUsedAt, links. Files sorted by id. Read-only vs fabric.
    - Secrets: `createMemory` redactor already on export/working. Scan before body write.
    - Exports +1 (`renderScopedMirror`); budget 929 → 930.

- [x] Task 8: Evaluation harness — win-rate A/B, precision@3, health, LoCoMo-style probe
  - Acceptance Criteria:
    - Functional: `packages/memory/src/scoped/eval/` ships: (a) an A/B runner that replays a task fixture list twice — memory off vs. scoped memory on — through a scripted agent harness (deterministic fake provider, no network) and reports per-task outcome and turn counts; (b) a precision@3 probe over a labeled query→note-id fixture set per scope with a drop alert threshold; (c) `policy.health()` wired into a report command factory (same pattern as observational status/view commands); (d) a LoCoMo-style conversational recall probe fixture (questions answerable only from episodic ledger entries).
    - Performance: Fixtures run network-free; full scoped eval suite completes in the existing CI test budget.
    - Code Quality: Fixtures are data files; runner is deterministic given the fake provider; metrics emitted as plain JSON.
    - Security: Fixtures contain no secrets; eval harness cannot run against production stores (fixture-only constructors).
  - Approach:
    - Documentation Reviewed: concept "Evaluation"; `docs/evaluations.md` (trajectory/outcome scorers, deterministic bounded judging) — reuse its scorer contracts where they fit; observational status/view command factories.
    - Options Considered:
      - Purpose-built harness vs. evaluations package reuse — chosen: reuse evaluator/scorer contracts, build only the memory-specific fixtures and runners (smallest new surface).
    - Chosen Approach: Eval subpath exported for hosts (`runScopedMemoryEval`), plus fixtures under `__tests__` for CI.
    - API Notes and Examples:
      ```ts
      const report = await runScopedMemoryEval({ fixtures, policy, fakeProvider });
      // { winRate: { off: 0.4, on: 0.75 }, precisionAt3: 0.83, health: {...} }
      ```
    - Files to Create/Edit:
      - `packages/memory/src/scoped/eval/runner.ts`, `precision-probe.ts`, `recall-probe.ts`.
      - `packages/memory/src/scoped/eval/fixtures/*.json`.
      - `packages/memory/src/scoped/__tests__/eval.test.ts`.
    - References: concept Evaluation section; Mem0/Zep LoCoMo methodology.
  - Test Cases to Write:
    - A/B runner distinguishes a fixture set where memory helps (win-rate delta > 0) and one where it cannot (delta ≈ 0).
    - Precision@3 computes correctly on a hand-labeled fixture; drop below threshold alerts.
    - Episodic probe answers only via ledger recall, fails closed when ids are missing.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — eval exports.
    - Docs pages to create/edit: `docs/scoped-memory.md` evaluation section (Task 9).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - `runScopedMemoryEval({ fixtures, fakeProvider? })` always constructs tmp `createMemory` + fabric + policy. Rejects `memory`/`policy`/`fabric`/`vectorStore` on the input. Default fake provider answers from recall context or `"unknown"`.
    - A/B: per-task off vs on, `{ winRate, tasks[] }`. Precision@3 = mean(|relevant ∩ top3| / 3), `precisionAlert` when below floor (default 0.5). LoCoMo: recall must hit `expectedId`; missing seeded id increments `failedClosed` (no false pass).
    - `createScopedMemoryHealthCommand({ policy })` → `scoped-memory:health` (om:status pattern). Fixtures in `scoped/eval/fixtures/*.json`. No `./scoped/eval` package export — import from `@arnilo/prism-memory/scoped`. No prism-core evals import.
    - Exports +4 (`runScopedMemoryEval`, `createScopedMemoryHealthCommand`, `probePrecisionAt3`, `probeLocomoRecall`); budget 930 → 934.

- [x] Task 9: Example, API docs page, index and cross-links
  - Acceptance Criteria:
    - Functional: `examples/scoped-memory.ts` (+ built `.js`) runs network-free: scope guard → facts write + overflow → post-run review to candidate → recall with floor/budget → second-use promotion → GC proposal → approve → mirror render. `docs/scoped-memory.md` follows the prism-wiki API page structure exactly (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs), states the sizing trade-off line (one reviewer call per run; ledger I/O per recall; off by default), and documents every tuning knob with its default. The page states the wiki routing rule: source-cited knowledge belongs in `@arnilo/prism-memory/wiki` (regenerable, line-anchored); session-derived experience belongs in scoped memory (primary records with `sourceEntryIds` provenance) — and the post-run reviewer must not duplicate a wiki-pageable insight as a scoped fact. `docs/index.md` gains the one-sentence entry under "Compaction/session memory"; `docs/scoped-agent-memory.md` links to it as the implemented API page (wiki-relationship paragraph already landed in Task 1).
    - Performance: Example runs in seconds, no credentials.
    - Code Quality: Example mirrors the fabric example conventions (`examples/memory-fabric.ts`).
    - Security: Example uses fake provider + in-memory stores; no real scope roots.
  - Approach:
    - Documentation Reviewed: `.agents/skills/create-plan/references/prism-wiki.md`; `examples/memory-fabric.ts`; `docs/index.md` "Compaction/session memory" section.
    - Options Considered: Fold docs into `docs/scoped-agent-memory.md` — rejected: concept page is design rationale; hosts need a contract page per the current-line/history rule.
    - Chosen Approach: Concept page stays the rationale; new API page carries the current contract; both cross-link.
    - API Notes and Examples:
      ```bash
      node examples/scoped-memory.ts
      ```
    - Files to Create/Edit:
      - `examples/scoped-memory.ts`, `examples/scoped-memory.js`.
      - `docs/scoped-memory.md`.
      - `docs/index.md` (one entry).
      - `docs/scoped-agent-memory.md` (cross-link paragraph).
    - References: prism-wiki API page structure; plan 068 current-line rule.
  - Test Cases to Write:
    - Example executes with exit 0 in CI (add to the examples test list if one exists).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this is the documentation task.
    - Docs pages to create/edit: as listed.
    - `docs/index.md` update: yes — "Scoped memory policy (`@arnilo/prism-memory/scoped`): workspace-scope guard, gated writes, promotion ladder, decay reads, audit mirror."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - `examples/scoped-memory.ts` walks scope guard → facts overflow → fake reviewer → abstain/hit recall → promotion → GC approve → mirror. `.js` is gitignored (`examples/*.js`); CI emits via `examples_demos_run_to_completion_and_emit_no_secret`.
    - `docs/scoped-memory.md` is the API page (in `apiPages`). Concept page `docs/scoped-agent-memory.md` now points at it. Index: one Compaction/session memory entry. No `./scoped/eval` subpath; no extra wiki.md edit.

- Moved: Tasks 10–12 (0.10.0 bump, compat baseline, CHANGELOG/publish) → [106](106-Hook-Lifecycle-Completion.md) Tasks 8–10.


## Compromises Made

- Hybrid lexical+vector fusion inside one recall is not implemented; the read policy post-ranks fabric hits only. Lexical branch search stays on `searchConversation`.
- Team-scope semantics (shared silo vs per-user) stay one scope per policy instance.
- 0.10.0 bump, compat baseline, and publish moved to [106](106-Hook-Lifecycle-Completion.md) Tasks 8–10 after Tasks 1–9 shipped.

## Further Actions

- Fuse lexical FTS into `policy.recall` if precision@3 probes show vocabulary-miss failures. Priority: P3, demand-gated.
- A-MEM-style automatic neighbor evolution beyond the fabric keyword-union worker if duplication rate stays high. Priority: P3, demand-gated.
- Reviewer-to-wiki handoff when a post-run proposal is source-cited knowledge (`/wiki-ingest` instead of a scoped fact). Document-only routing covers it until duplication is observed. Priority: P2.
- Zep-style community summarization if silos grow past a size where health metrics degrade. Priority: P3, demand-gated.
