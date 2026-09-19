# Scoped Agent Memory and 0.10.0 Release Cut

Implements the concept in `docs/scoped-agent-memory.md` in full as a new opt-in policy
subpath of `@arnilo/prism-memory` (`@arnilo/prism-memory/scoped`), then cuts release
**0.10.0**.

Precondition: the 0.9.0 cut (plans 099/100) has landed; this plan is the 0.10.0 phase and
bumps versions from 0.9.x. Nothing here changes default behavior of any existing session —
the scoped layer activates only when a host creates it.

## Objectives

- Ship the scoped memory policy layer: workspace-root scope identity, conservative post-run
  writer, promotion ladder (candidate → verified after N reuses), usage-decay GC, read policy
  (abstain floor + activation budget + decay/usage-weighted scoring), bounded facts block,
  injection scanning, staged approval, git audit mirror.
- Reuse the shipped mechanisms (fabric folding/linker/evolution, observational ledger and
  reflections, working/semantic stores) — the scoped layer adds policy, not a new store.
- Add the evaluation harness the concept doc declares non-negotiable: win-rate A/B,
  retrieval precision@3, health metrics.
- Cut and publish release 0.10.0 with regenerated compatibility baseline.

## Expected Outcome

- `@arnilo/prism-memory/scoped` exports `createScopedMemoryPolicy()` with the API surface
  below; example `examples/scoped-memory.ts` runs network-free end to end
  (scope guard → recall floor/budget → post-run candidate write → promotion → GC → mirror).
- `docs/scoped-memory.md` documents the composed memory-management pattern for hosts;
  `docs/index.md` and `docs/scoped-agent-memory.md` cross-link it.
- All packages at 0.10.0, `release:gate` green on a regenerated baseline, CHANGELOG entry,
  published artifacts verified.

## Tasks

- [ ] Task 1: Primitive review — map every concept mechanism to a shipped primitive or a named new one
  - Acceptance Criteria:
    - Functional: An inventory table (concept mechanism → shipped primitive → new code required) is recorded in this task's completion notes and confirms or corrects the maps in `docs/scoped-agent-memory.md` (layered architecture, read/write paths, research leverage). Every planned API below is either justified by a gap or dropped. The inventory includes the **wiki boundary**: `@arnilo/prism-memory/wiki` (docs/wiki.md) is a knowledge *compiler* over raw sources (regenerable, line-anchored citations) while scoped memory holds session-derived *experience* (primary records, provenance `sourceEntryIds`) — the inventory confirms no storage overlap and states the routing rule: source-cited knowledge → wiki (`wiki_record_insight`/ingest), session-derived experience → scoped memory.
    - Performance: No new runtime dependency packages; scoped layer must compose existing `createMemory`/`createMemoryFabric`/observational instances.
    - Code Quality: The review names where usage state, status metadata, and approval staging live (see Options below) before any implementation task starts.
    - Security: Review confirms the injection/exfiltration scanning primitive to reuse (observational `secrets` redaction paths, working-memory redactor) rather than writing a new scanner.
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
      - Usage counter in a separate small ledger keyed by note id — chosen: reads never mutate notes; the mirror renders ledger values into exported frontmatter.
      - Status (`candidate`/`verified`/`archived`) in fabric note metadata (`metadata.scoped`) — chosen: survives folding (annotations union), needs no fabric change.
    - Chosen Approach: Separate usage/staging ledger (JSON file in a scoped data dir, gitignored) + `metadata.scoped` status on notes; all writes go through existing fabric APIs.
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
    - Docs pages to create/edit: `docs/scoped-agent-memory.md` — only if the review corrects a mapping.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2: Scope identity and scope guard — `createScopedMemoryPolicy()` core
  - Acceptance Criteria:
    - Functional: `createScopedMemoryPolicy(options)` binds a workspace root to a `createMemory()`/`createMemoryFabric()` pair (`memory`, `fabric`, `scopeRoot` required). Wrapped recall/write tools fail closed when a target note's scope does not match the bound scope root. Unattached policy is inert (no timers, no workers) — mirroring fabric's attach gate.
    - Performance: Scope check is O(1) per call (compare stored scope string), no extra store round-trip.
    - Code Quality: Options validated like fabric inputs (throw on missing `memory`/`fabric`/`scopeRoot`, on a fabric whose `observational` session mismatch — fail closed, no partial state).
    - Security: No path from the policy to files outside `scopeRoot` except the explicit mirror render (Task 7, which uses the fabric file-jail rules).
  - Approach:
    - Documentation Reviewed: Task 1 inventory; `docs/memory-fabric.md` (attach gate, file jail, validation patterns); `docs/working-and-semantic-memory.md` (`tenantId`/`resourceId` isolation).
    - Options Considered:
      - Enforce scope by convention only (host passes the right `resourceId`) — rejected: the concept's headline guarantee is the silo boundary; convention is not a guard.
      - Wrap fabric operations with an explicit scope assertion — chosen: smallest guard, one place, all later tasks route through it.
    - Chosen Approach: Policy holds `{ scopeRoot }`, stamps/validates `metadata.scoped.scope` on every write and rejects out-of-scope ids on every read.
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
    - References: concept "Scope model"; fabric attach/file-jail fail-closed patterns.
  - Test Cases to Write:
    - Missing required options throw; defaults applied for omitted policy knobs.
    - Out-of-scope note id rejected on wrapped recall/write (fail closed).
    - Inert when created (no side effects until a method is called).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package subpath `@arnilo/prism-memory/scoped`.
    - Docs pages to create/edit: `docs/scoped-memory.md` (created in Task 9; this task only ships code).
    - `docs/index.md` update: yes, in Task 9 together with the API page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3: Read policy — abstain floor, activation budget, decay/usage-weighted scoring, usage ledger
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
    - Chosen Approach: Wrapper + exported pure scorer + JSON usage ledger (`<scopeRoot>/.memory/state/usage.json`, gitignored by mirror renderer).
    - API Notes and Examples:
      ```ts
      const { hits, abstained } = await policy.recall("deploy without downtime",
        { kinds: ["procedure"] }); // floor/budget/decay applied
      ```
    - Files to Create/Edit:
      - `packages/memory/src/scoped/read-policy.ts`.
      - `packages/memory/src/scoped/usage-ledger.ts`.
      - `packages/memory/src/scoped/__tests__/read-policy.test.ts`.
    - References: Generative Agents scoring; Hermes issue #22620 measured decay fix; concept "Read path".
  - Test Cases to Write:
    - All hits below floor → `abstained: true`, empty hits, no usage increments.
    - topK clamp: 10 fabric hits → ≤ 3 returned, ranked by combined score not raw similarity.
    - Ledger increments once per returned hit; corrupt ledger fails closed (treat as zero uses, log).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `policy.recall` behavior.
    - Docs pages to create/edit: `docs/scoped-memory.md` (Task 9).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4: Post-run conservative reviewer — candidate writes through the fabric
  - Acceptance Criteria:
    - Functional: `policy.reviewSession(digest | sessionEntries, { reviewer })` runs a host-supplied reviewer hook (model-neutral, same shape as compaction-llm provider calls; bind the model via use-case model selection) with a noop-biased prompt: default output is zero writes; write triggers limited to user correction, error→recovery, a technique reused within the session, or explicit "remember this". Accepted outputs become `fabric.remember` calls — kind `fact`/`procedure`, `metadata.scoped.status = "candidate"`, `sourceEntryIds` provenance from the digest — so fabric folding, linker, and evolution all fire on the same write path.
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

- [ ] Task 5: Promotion ladder and usage-decay GC passes
  - Acceptance Criteria:
    - Functional: `policy.promotionPass()` flips `candidate` → `verified` (fabric rewrite in place, same id, `metadata.scoped.status` + `promotedAt`) for notes whose ledger shows ≥ `promotion.reuseThreshold` uses since creation (default 2). `policy.gcPass()` archives: candidates unused for `candidateArchiveDays` (default 30) and notes whose decay score `uses × exp(-ageDays/tauDays)` falls below a floor — archive = proposal entry in the staging ledger (recommend-then-delete); nothing is deleted silently, `fabric.forget` runs only on host approval. `policy.health()` returns the concept's health metrics: duplication rate (fold-rewrite share of writes), candidate→verified conversion, activation rate (used hits / returned hits), note counts by status.
    - Performance: Both passes are O(n) over notes with no model calls; safe to run as an idle job (Letta sleep-time placement).
    - Code Quality: Status rewrites go through fabric's same-note fold path so createdAt/consent/links survive; an archived note keeps `validTo` untouched (archive is status, not temporal invalidation).
    - Security: GC proposals never bypass approval; `legal_hold` notes are never proposed for archive.
  - Approach:
    - Documentation Reviewed: `docs/memory-fabric.md` (rewrite-in-place fold, `forget`/`legal_hold`), concept "Lifecycle — metabolism", Task 3 ledger.
    - Options Considered:
      - Delete outright below threshold — rejected: concept trust boundary ("GC proposes, humans dispose").
      - Staged archive proposals — chosen; also gives the promotion/GC audit trail the mirror renders.
    - Chosen Approach: Two idempotent passes + `health()`; thresholds are the documented tuning knobs.
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
    - Candidate with 2 uses promotes once and not again (idempotent).
    - Stale candidate → GC proposal; approval runs `forget`; disapproval leaves the note live.
    - `legal_hold` note never proposed; fold on rewrite preserves `createdAt`/links.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `promotionPass`/`gcPass`/`health`.
    - Docs pages to create/edit: `docs/scoped-memory.md` (Task 9).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 6: Facts block budget, injection scan, staged approval gate
  - Acceptance Criteria:
    - Functional: `policy.rememberFact(text)` writes to the working block named by `facts.block` (default `"facts"`); when the block would exceed `facts.maxChars` (default 2200) the call fails with a consolidate-first error listing current entries (Hermes overflow pattern), and the agent/host must merge or remove before retry. Every record surface the policy can inject or write (facts block writes, reviewer proposals, mirror renders) passes the injection/exfiltration scan reused from Task 1's chosen primitive; matches fail closed with the offending pattern class named. `policy.approve(id)`/`policy.reject(id)`/`policy.pending()` operate the staging ledger for every staged write kind (reviewer proposals, GC archives).
    - Performance: Scan is pure-pattern (no model); budget check is a length comparison.
    - Code Quality: One gate implementation reused by all three surfaces; scan failures are logged with pattern class, never with the payload.
    - Security: This is the trust-boundary task — scanning before any prompt-injectable surface, staged approval default `off` for personal scopes and recommended `staged` for team scopes (documented, not forced).
  - Approach:
    - Documentation Reviewed: Hermes memory docs (overflow-error UX, security scanning of `MEMORY.md`), Task 1 scan primitive choice, fabric working-block insert behavior (`maxEntryTextChars` throw).
    - Options Considered:
      - Auto-truncate the facts block on overflow — rejected: silent data loss at a trust boundary.
      - Fail with consolidate-first — chosen (Hermes-validated pattern; forces deliberate curation).
    - Chosen Approach: Reuse the existing redaction/scan primitive; wrap the fabric working-block insert; staging ledger from Task 4/5.
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

- [ ] Task 7: Git audit mirror — deterministic markdown export
  - Acceptance Criteria:
    - Functional: `policy.renderMirror()` writes one markdown file per note (frontmatter: id, kind, status, scope, validity window, provenance `sourceEntryIds`, uses, lastUsedAt, links) plus `facts.md` into `<scopeRoot>/.memory/`, excluding `state/`. Output is deterministic (stable ordering by id, stable frontmatter key order) so diffs are meaningful; deleted/archived notes disappear from the mirror but git history retains them.
    - Performance: O(n) writes; a weekly digest is `git log --oneline .memory/` — no code needed.
    - Code Quality: Renderer reads only fabric notes + ledger; it never writes back; mirror is never read by the runtime (audit surface only, per the concept's "one write path, two views").
    - Security: Content passes the Task 6 scan before render; secrets redaction (`memory` redactor) applies so the mirror is committable.
  - Approach:
    - Documentation Reviewed: concept storage section (fabric = source of truth, mirror = audit view); fabric note fields; `docs/memory-fabric.md` export/redaction notes.
    - Options Considered:
      - Markdown as source of truth with a fabric importer — rejected: two write paths, folding/consent would bypass.
      - Deterministic export — chosen.
    - Chosen Approach: Pure renderer with stable serialization; `.gitignore` guidance emitted for `state/`.
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

- [ ] Task 8: Evaluation harness — win-rate A/B, precision@3, health, LoCoMo-style probe
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

- [ ] Task 9: Example, API docs page, index and cross-links
  - Acceptance Criteria:
    - Functional: `examples/scoped-memory.ts` (+ built `.js`) runs network-free: scope guard → facts write + overflow → post-run review to candidate → recall with floor/budget → second-use promotion → GC proposal → approve → mirror render. `docs/scoped-memory.md` follows the prism-wiki API page structure exactly (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs), states the sizing trade-off line (one reviewer call per run; ledger I/O per recall; off by default), and documents every tuning knob with its default. The page states the wiki routing rule: source-cited knowledge belongs in `@arnilo/prism-memory/wiki` (regenerable, line-anchored); session-derived experience belongs in scoped memory (primary records with `sourceEntryIds` provenance) — and the post-run reviewer must not duplicate a wiki-pageable insight as a scoped fact. `docs/index.md` gains the one-sentence entry under "Compaction/session memory"; `docs/scoped-agent-memory.md` links to it as the implemented API page and gains a short wiki-relationship paragraph (currently absent).
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

- [ ] Task 10: Release 0.10.0 — version bump + workspace-wide green
  - Acceptance Criteria:
    - Functional: All workspace packages bumped to 0.10.0 per release script conventions; typecheck, lint, and full test suite pass, including the new scoped suites and example run.
    - Performance: CI budget unchanged from 0.9.x.
    - Code Quality: No `skip`/`todo` flags introduced by the cut.
    - Security: `npm audit` clean or explained in release notes.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`; plan 099 Task 1 pattern.
    - Options Considered: n/a — standard release plumbing.
    - Chosen Approach: Script bump + full verification.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump 0.10.0
      ```
    - Files to Create/Edit: package.json versions via script.
    - References: `docs/release-and-install.md`.
  - Test Cases to Write:
    - Existing suites (cut adds none beyond regression runs).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [ ] Task 11: Release 0.10.0 — compatibility baseline regeneration + gate
  - Acceptance Criteria:
    - Functional: `node scripts/release.mjs gate --update-baseline` regenerates `scripts/compat-baseline/` files; `release:gate` green; diff reviewed so **additions** (the `@arnilo/prism-memory/scoped` subpath exports: `createScopedMemoryPolicy`, read-policy scorer, lifecycle/health, facts/trust, mirror, eval runner) are intentional; **removals or signature breaks: none planned** — if any appear they are listed in this task before regeneration (plans 083/084 lesson).
    - Performance: Gate runtime within existing budget.
    - Code Quality: Baseline diff committed atomically with the version bump.
    - Security: Baseline contains no secrets (script guarantee, spot-checked).
  - Approach:
    - Documentation Reviewed: plans 083/084 baseline incident notes; `scripts/compat-baseline/` current files; plan 099 Task 2 pattern.
    - Options Considered: Hand-edit baseline — forbidden; script-only regeneration.
    - Chosen Approach: Regenerate + human-reviewed diff.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs gate --update-baseline && npm run release:gate
      ```
    - Files to Create/Edit: `scripts/compat-baseline/*` (script-written).
    - References: plans 083/084 baseline incident notes.
  - Test Cases to Write:
    - `release:gate` exit 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (gate mechanics).
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [ ] Task 12: Release 0.10.0 — CHANGELOG, publish, post-publish verification, plan/roadmap bookkeeping
  - Acceptance Criteria:
    - Functional: CHANGELOG entry under 0.10.0 summarizing the scoped memory subpath with the sizing trade-off line; all publishable manifests publish; post-publish verification (install-from-registry smoke) passes; `plans/README.md` row for this plan marked complete; `roadmap.md` updated so 0.10.0 is the recorded current release with this plan as cut owner.
    - Performance: Publish pipeline unchanged.
    - Code Quality: Release notes list the new subpath, the opt-in default (off), and the docs page.
    - Security: No secrets in artifacts; publish uses existing operator-authorized flow.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`; plan 099 Task 3/4 pattern; `CHANGELOG.md` current 0.9.0 entry shape.
    - Options Considered: n/a — standard cut.
    - Chosen Approach: Follow the established release checklist.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs publish 0.10.0
      ```
    - Files to Create/Edit: `CHANGELOG.md`, `plans/README.md`, `roadmap.md`, `docs/history/` release record if the convention requires one for a minor cut.
    - References: `docs/release-and-install.md`; plan 099 Tasks 3–4.
  - Test Cases to Write:
    - Post-publish smoke: fresh install of `@arnilo/prism-memory@0.10.0` imports both `./fabric` and `./scoped` subpaths.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (release of the new subpath).
    - Docs pages to create/edit: `CHANGELOG.md` (release deltas, per plan 068 rule — not in API page bodies).
    - `docs/index.md` update: no (already updated in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass. Known constraints at planning time:
  - Hybrid lexical+vector fusion inside one recall (research leverage map "open question") is not implemented; the read policy post-ranks fabric hits only. Lexical branch search stays available via `searchConversation`.
  - Team-scope semantics (shared silo vs per-user) remain single-scope per policy instance; the open question stays open.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority. Candidates at planning time:
  - Fuse lexical FTS into `policy.recall` if precision@3 probes show vocabulary-miss failures.
  - A-MEM-style automatic neighbor evolution beyond the fabric's keyword-union worker, if duplication rate stays high.
  - Reviewer-to-wiki handoff: when a post-run proposal is really source-cited knowledge (would cite files/lines rather than session entries), hand it to `/wiki-ingest` staging instead of writing a scoped fact — closes the `wiki_record_insight` overlap mechanically; document-only routing covers it until duplication is observed.
  - Zep-style community summarization if silos grow past a size where health metrics degrade.
