# Phase 11 Part O15 — Memory for the working agent: standing rules, tool steps, cited lessons and work-outcome evaluation

> **Post-0.13.0 memory track (owner decision 2026-11-04, plan 215).** 0.13.0 ships the memory packages as an experimental prerelease line and no longer waits for this plan. Run it after plan 215 publishes, then plan 210, which graduates the memory packages to stable. Content unchanged; references to plans 184–187 and the freeze now mean plan 215's corresponding tasks and plan 210 Task 10's graduation.

## Objectives

- Close the gaps between Prism's memory and the design an agent would choose for itself (the 2026-10-31 first-principles assessment), without duplicating what plans 202 and 207 already build:
  - **The record includes what the agent did.** The exchange archive stores only user and assistant text today (`packages/memory/fabric/src/exchanges.ts:6–7,66–79` exclude tool calls and results). For a coding agent, the failed command and the fix are the evidence a repeated mistake needs. Archive a condensed, bounded trace of the tool steps of each exchange.
  - **Standing rules are the centre of the memory.** Make them one small, human-editable, always-loaded rule set per scope:
    - `core.md` becomes editable; an edit reconciles into notes instead of being overwritten (`packages/memory/fabric/README.md`, "Pinned core");
    - plan 202 Task 11's confirmed capture is generalized from coding decisions to preferences and procedures in every preset, behind an opt-in;
    - it has a fixed token budget and an explicit overflow rule.
  - **The agent keeps a cited notebook.** Lessons ("what I learned, what to do differently, gotchas") are written by the agent and must cite log evidence. Their retention follows use. A cheap nudge, with no model call, appears after turns that carry a lesson signal.
  - **Measure work, not trivia.** A work-outcome suite measures:
    - the rate of repeating a corrected mistake;
    - convention adherence across sessions;
    - questions re-asked;
    - orientation cost in a returning project;
    - lesson claim support.
    It uses plan 200's simulated users and state grading, with frozen label-blind partitions and pre-registered criteria.
- Feed the work-outcome evidence to plan 210: its feature audit, its held-out acceptance (including plan 208's O8 row) and the defaults and claims it sets.

## Expected Outcome

- Opt-in `exchanges.steps` archives a condensed step trace (tool, argument summary, outcome, first error line, entry pointer) inside each exchange note, trust-scanned and redacted.
- `rules` (opt-in) gives every preset:
  - confirmed lexical capture of standing rules;
  - an editable `rules.md` per scope that reconciles into pinned notes;
  - a budget of 2,000 tokens by default with path-scoped sections loaded on touch.
  Plan 202 Task 11's `coding` preset uses the same module.
- `memory.insert` accepts an optional `evidence` list, and a lesson is a `procedure` or `fact` note tagged `lesson` with required evidence links. Opt-in `lessons.nudge` adds one tail line after a signal turn.
- `scripts/memory-bench/work-outcome/` holds the suite, its partitions and `work-outcome-criteria.json`.
- An owner-gated development screen (gate W-1) that reports W1–W6 and plan 208's O8, one tuning revision, and this plan's features without a passing development row listed for plan 210's ledger. Plan 210 Task 9 runs the held-out work-outcome arms and plan 210 Task 10 decides this plan's defaults and claims.

This plan is a pre-publish part of roadmap **Phase 11** (memory, Part O, sub-part 15). **Owner decision 2026-10-31: it ships in 0.13.0.** It runs as release step **17e**:

- it runs after plan 208 (17d), so the `P+W+O` arm uses the ontology tier as plan 208 Task 5's revision froze it, and W5 reuses plan 208 Task 2's claim-support audit;
- plan 210 (17f) follows. The memory train is strictly sequential (owner decision 2026-10-31): 202 → 207 → 208 → 209 → 210 → 184 → 185;
- **Task 7 moved to plan 210 on 2026-10-31.** The held-out work-outcome arms are plan 210 Task 9, and this plan's defaults and the `PRODUCT.md` positioning are plan 210 Task 10. This plan ends at Task 6 with development evidence.

**Review task included** (Task 1): the plan changes fabric behavior (archive contents, `core.md` from derived to editable, a tool input) and adds config fields. **No kernel contract change** is planned; `run.end`, `turn.completed`, `context.build` and `host.ui` exist. A kernel need stops the plan. **No write-path generative model call** is added anywhere: capture is lexical plus confirmation, nudges are text, and lessons are written by the agent's own tool call in its normal turn. No version bump or publish.

## Tasks

- [x] Task 1: Review and assumption check (read-only)
  - Acceptance Criteria:
    - Functional: **(a) Inventory with `file:line`:**
      - the exchange archive pairing rules and its excluded blocks (`exchanges.ts:6–79`);
      - the pinned core and `core.md` regeneration (`delivery/core.ts`, fabric README "Pinned core");
      - plan 202 Task 11's capture, confirmation and delivery code as landed;
      - `memory.insert`'s schema (`tools.ts`), `MemoryNoteLink` relations (`types.ts:147–153`, corrected by Task 1);
      - the consolidation signal patterns (`CONSOLIDATION_PATTERNS`, explicit, correction and outcomes);
      - plan 200's `user-simulator.ts`, `scenario-runner.ts:95–228` and `state-match.ts:56` in `packages/hosts/evals/src`;
      - the 12-persona lifecycle suite (`scripts/memory-bench/lifecycle/persona.mjs`).
    - Functional: **(b) Verify:**
      1. tool call and result blocks are reachable from `message.completed`/`turn.completed` context without re-reading the branch;
      2. a `core.md` edit can be detected by the existing reconcile hash check;
      3. 202 Task 11's capture is a reusable module, or record the refactor Task 3 must do;
      4. a tail line added after a signal turn keeps the prefix byte-stable (plan 202 Task 4.12);
      5. the evals user simulator can drive multi-session scenarios against `createAgent` with a fabric store that persists across sessions.
    - Functional: **(c) Verdict** in the Notes.
    - Performance: n/a — read-only.
    - Code Quality: No code change.
    - Security: Records the trust boundaries the later tasks rely on: tool output is untrusted, `host.ui` confirmation, the trust scan.
  - Approach:
    - Documentation Reviewed:
      - the fabric README and source above;
      - plans 188.5, 188.9 Task 7, 200, 202 Task 11;
      - the 2026-10-31 first-principles assessment.
    - Options Considered:
      - Skip the review. Rejected: the plan changes archive contents and the meaning of `core.md`.
    - Chosen Approach:
      - Read-only verification first.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - this plan (Notes only).
    - References:
      - `references/prism.md` §2.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05, read-only; no code changed):
    - **(a) Inventory** (paths under `packages/memory/fabric/src` unless noted):
      - **Exchange archive.** `exchanges.ts:6–11` states the rules; `messageText` (`:68–75`) keeps only `text` blocks; `isFinalAssistant` (`:78–82`) rejects any assistant message with a `tool_call`; `exchangePairs` (`:85–98`) pairs each final assistant with the nearest preceding user entry and skips every other entry (tool-role entries included). `createExchangeArchive.pair` (`:194–250`) scans `user+assistant` text with `scanScopedMemoryContent` (`:200`) and **refuses the whole turn** if the redactor would rewrite it (`:203`). Note ids come from `exchangeNoteId(session, userId, assistantId, part)` (`:104`), so steps added inside the note do not change ids. The writer is the `message.completed` hook with `session.background("fabric.exchange")` (`index.ts:648–701`).
      - **Pinned core.** `delivery/core.ts`: config and caps `:26–47` (`maxTokens` default 600, `HARD_CORE_TOKENS` 1,000, kinds `fact|preference|procedure|decision`); candidate order `coreCandidateRows` `:142–166` (verified, active, unflagged; pinned first, then decisions, then storage strength S; a decision needs `decisionStatus === "active"`); `renderCore` `:180`; `createFabricCore` `:198–322`; the derived write `writeCoreFiles` `:299–307`. The block is cached by `memoryWriteVersion` (`:311`), and prefix epochs live in `context.ts`. Wiring `index.ts:454–474` (`writeDerivedFile(scope, "core.md", …)` `:468`); config `config.ts:546,659,757,1001,1109` (coding preset `core.kinds = [decision, preference]`), default-on at `:1204`. The overwrite rule is `writeDerivedFile` in `packages/memory/core/src/fabric/index.ts:783–806` with the marker helpers `:172–183`.
      - **Plan 202 Task 11, landed.** `delivery/rules.ts` exists (99 lines): `captureDecision` `:39–63` (cue regex `:14–15`, always `kind: "decision"`, `decisionStatus: "proposed"`), `decisionNoteId` `:66`, `isDecisionDeliverable` `:71`, `confirmDecisionProposals` `:85–99` (fail-closed `host.ui`). The capture-and-confirm flow is **inline in the exchange hook**, `index.ts:677–695`, gated by `decisionCapture = config.preset?.name === "coding"` (`index.ts:403`); activation is `lifecycle.verify(id)`, not a `pinned` flag.
      - **`memory.insert`.** `tools.ts:520–600`: the schema has no `links` or `evidence` property; the forwarded-key list is `tools.ts:593`; the kind enum is `fact|preference|procedure|decision`; the trust scan runs at `:572`. Validation is `create.ts:127–208`; `supersedes` handling `create.ts:565–577` (`getEntry`, cross-scope refusal) is the model for `evidence`. **`MemoryNoteLink` is at `types.ts:147–153`** (`{ id, relation?, weight? }`), not `:92–98` (stale reference in this plan). `links` input validation is `create.ts:192–206`; automatic links use relation `"related"` (`links.ts:29`).
      - **Consolidation signals.** `consolidation/gather.ts:56–69` (`CONSOLIDATION_PATTERNS`: explicit, correction, outcomes); user-text matching `:152–169`; `outcomeRunIds` `:239–262` is **module-private** and tags a run `outcome` when a pattern-matching tool call has a non-error result or any `decision.resolved` has an `allow`; it never reads `deny`.
      - **Evals.** `packages/hosts/evals/src/user-simulator.ts:32–60` (a simulator binds a model-bound `Agent`; only text turns cross); `scenario-runner.ts:95–228` (`runScenario` opens **one session per call**, `agent` may be a factory, `executeScenario` `:230–260` drives turns); `state-match.ts:56` (`createStateMatchScorer`, `requires: ["environment"]`, modes `exact|subset`, redaction of both sides).
      - **Lifecycle personas.** `scripts/memory-bench/lifecycle/persona.mjs:4–135`: `createPersona` builds **one** persona per seed (projects ∈ {2,3}, sessions ∈ {2,8} only, `:6–11`), scripted via `message(session)`, labels with `firstMatter/from/until/corrected`. The "12 personas" are the `coding-longitudinal` generator (`scripts/memory-bench/README.md:312,919`), not 12 `createPersona` calls. The lifecycle suite (`lifecycle/suite.mjs`) runs its own mock-provider harness and does **not** use the evals user simulator or `runScenario`.
    - **(b) Verified:**
      1. **Tool blocks reachable: yes, via `session.entries()`.** The `message.completed` event carries only the final message (`contracts-protocol.ts:288`), but the existing hook already calls `session.entries()` (`index.ts:656`) and the tool rounds are persisted before the final assistant. Assistant entries hold `tool_call {id,name,arguments}` (`src/contracts-core/content.ts:102`); tool entries are `role: "tool"` with `tool_result {toolCallId,name,result,error}` (`content.ts:115`, built by `toToolResultMessage`, `src/input.ts:386`). Entries carry `id`, `runId`, `timestamp`. Task 2 therefore needs a step collector over the entries **between `pair.user.id` and `pair.assistant.id`** in `exchangePairs`' order; no branch re-read. The tool's declared argument schema is not on the entry, so "reads declared schemas" needs the tool registry (`prism.tools`) at hook time, or a name→field table with a first-scalar fallback.
      2. **`core.md` edit detection: the existing reconcile hash check does NOT see it.** The reconcile (`core/src/fabric/index.ts:466–490`, `fabric/src/reconcile.ts:83`) walks only `isNoteRelPath` files (`layout.ts:157–165`: `.md` in a kind directory, not `index.md`/`log*.md`). `core.md` and `project.md` sit at the scope root and are never indexed. The only detector is the derived marker hash (`DERIVED_MARKER` `:172`, `derivedFileIntact` `:180`), checked **inside `writeDerivedFile` just before it overwrites and logs** (`:794–804`). **Task 3 must add a `rules.md` reconcile path**, using the marker hash to detect an edit once per session epoch, then diffing `[id] text` lines against the rendered set; the markdown store's `reviewEdit` hook (`index.ts:97,482`) is the nearest existing review seam, but it is note-file only. `core.test.ts:234` (`core_md_human_edit_is_overwritten_and_logged`) must be rewritten, and the `writeDerivedFile` doc comment (`index.ts:143`) updated.
      3. **202 Task 11 capture is partly reusable.** `rules.ts` already holds the pure pieces and the confirmation; Task 3 must (i) move the inline hook (`index.ts:677–695`) into `rules.ts`, (ii) replace the `coding`-only gate with the `rules.capture` field, (iii) generalize the cue set (`DECISION_CUE` is decision-only) to emit `preference` and `procedure` kinds, (iv) make confirmation set `pinned`, which today it does not (`lifecycle.verify` only). Plan wording "(or are written there if Task 11 landed elsewhere)" resolves to **already in `rules.ts`**.
      4. **A tail line keeps the prefix byte-stable: yes.** Fabric tails are appended after all transcript messages (`context.ts:389–394`, `withTailContext`); `prefix-stability.test.ts:246–277` asserts the tail is the last message even on the first turn. Two constraints for Task 4: the nudge must be pushed onto `tailBlocks` **before** the early returns at `context.ts:434` and `:438`, and it must sit **outside** the per-user-turn tail cache (`context.ts:440`, keyed on `user.id`), because it depends on the previous turn's signal and a per-session rate limit (needs session state like `cueState`, `index.ts:479`).
      5. **Evals can drive multi-session scenarios: yes, with harness-owned persistence.** `runScenario` is single-session; the evals package gives no cross-session store. A work-outcome run calls `runScenario` once per session with an agent factory that reuses one fabric root (markdown store dir), and the harness holds the root. Simulators are model-bound text-only (no tool I/O, no hidden state), which suits W3 (re-asked questions) but means scripted users (`persona.mjs` style) remain the offline path. State grading needs an `environment` snapshot supplied per item.
    - **(c) Verdict: go, with six amendments** (made in the tasks below):
      - Task 2: steps come from the entries between the pair's user and assistant ids; the policy for a redactor/trust hit on a step is "drop that step's text" (plan text), which **differs from the archive's whole-turn refusal** (`exchanges.ts:203`); keep both and test both. The "failed-then-passed same command → `outcome: fixed`" tag is **new logic**: `outcomeRunIds` only marks successful pattern-matching runs, and it is private.
      - Task 3: a new `rules.md` reconcile (see (b)2); `rules.ts` is the module home; `rules.maxTokens` default 2,000 / hard 3,000 is **3.3× the current 600 / 1,000 core budget** (`core.ts:41,44`) and `core` is on by default in every preset (`config.ts:1204`), so it changes the default prefix size and the cache-equivalence attestation (memory note: plan 202 4.15). Decide at Task 3 whether the default stays 600 until rules exist, or raise it only when `rules.capture` is on. Rename sweep, 14 files: `examples/memory-lifecycle.ts`, `core/src/fabric/index.ts`, fabric `README.md`, `package.test.ts`, `config.ts`, `delivery/__tests__/core.test.ts`, `delivery/core.ts`, `index.ts`, `promote.ts`, `scripts/memory-bench/safety/run.mjs` (`:277,:299,:303`), `scripts/branch-coverage*.mjs`, `scripts/coverage-summary.mjs`, `scripts/phase23-security.test.mjs` (the last four may be unrelated `core` strings; confirm in the sweep). `apps/prism-agent` has no `core.md` or `core:` reference, so the "if it names `core`" item is likely n/a.
      - Task 4: add `evidence` to the tool schema and the forward list (`tools.ts:520–600`), validate in `create.ts` beside `supersedes`; nudge placement per (b)4; the approval-denial signal needs a new reader for `decision.resolved` with `outcome: "deny"` (`contracts-protocol.ts:335–340`), since gather reads only `allow`.
      - Task 5: `createPersona` accepts only sessions 2 or 8 and is scripted, so the coding family extends it in a new `work-outcome/personas.mjs` (the lifecycle files are frozen evidence) instead of editing it; the lifecycle persona already has a corrected mistake (sessions 3–4), conventions (`manager`, `commit`, `folder`) and needed-again facts, but **no W3 (re-asked) or W4 (orientation) grading and no returning-project start**, which are new. "12 lifecycle personas" means the coding-longitudinal generator.
      - Task 6: no change.
      - Plan text fix: `MemoryNoteLink` is `types.ts:147–153`.
    - **Trust boundaries the later tasks rely on:**
      - Tool output is untrusted: `tool_result.result` and `.error` are model-visible strings from tools; the archive excludes them today (`exchanges.ts:6–7`); Task 2 may store only the redacted, trust-scanned, capped summary plus the entry id.
      - Persisted entries are already redacted by the kernel before the fabric sees them (`exchanges.ts:9–11`); the archive's redactor check is a second gate.
      - The trust scan is `scanScopedMemoryContent` (`scoped/trust.ts`), used at `exchanges.ts:200`, `rules.ts:52`, `tools.ts:572`, and for human file edits `reconcile.ts:96–98` (a hit quarantines to `candidate` with a flag).
      - `host.ui` confirmation fails closed: `unavailable`, denial, a throw or a malformed answer all leave the note `proposed` (`rules.ts:85–99`).
      - Capture reads only the archived user turn (`index.ts:678`), never tool output or assistant text.
    - No kernel contract change is needed: `message.completed`, `turn.completed`, `context.build` and `host.ui` all exist as used. No stop condition hit.

- [x] Task 2: Tool steps in the exchange archive (fabric)
  - Acceptance Criteria:
    - Functional: Opt-in `exchanges: { steps: true }` (contract field; default `false`, so `conversational` revision 1 and 2 are unchanged). Each archived exchange gains a `## Steps` section listing up to `exchanges.maxSteps` (tuning, default 24) tool rounds of that turn, in order. One line per step:
      - the tool name;
      - an argument summary (≤ 120 characters: the path, command or query field when the tool declares one, otherwise the first scalar argument);
      - the outcome (`ok` or `error`);
      - for an error, the first line of the error text (≤ 200 characters);
      - the session entry id of the tool result, so `memory.read { around }` and the host can reach the full output.
      Tool result bodies are never stored.
    - Functional: Step text is indexed lexically with the exchange, so "the migration failed with ENOENT" finds the exchange where it happened. The outcome patterns (`patterns.outcomes`) tag exchanges whose steps include a failed-then-passed sequence of the same command, as `outcome: fixed`.
    - Functional: Host impact: **none** unless the field is set.
    - Performance:
      - ≤ 24 short lines per exchange, about 1.5 KB at the caps; storage growth is stated per 1k turns in the README.
      - No extra store query: the steps are written in the same `fabric.exchange` background write.
      - Recall cost is unchanged, because excerpts stay query-centred.
    - Code Quality: In `exchanges.ts` next to the pairing logic, with one step-summary function and one table of per-tool argument fields that reads tools' declared schemas, not names.
    - Security:
      - Error lines and argument summaries come from tool output and tool input, which are untrusted. They pass the redactor and `scanScopedMemoryContent` before writing; a hit drops that step's text and keeps `outcome` only, counted in `memory:status`. (Task 1: this is per-step, unlike the archive's whole-turn refusal at `exchanges.ts:203`, which stays; test both.)
      - Steps are evidence, never extraction candidates. The 188.3 rule that tool output is never candidate text stays.
  - Approach:
    - Documentation Reviewed:
      - `exchanges.ts:1–277`;
      - `CONSOLIDATION_PATTERNS.outcomes`;
      - fabric README `## Exchange archive`;
      - LongMemEval-V2 (agents searching trajectory files outperform RAG) and SWE-Bench-CL (arXiv 2507.00014; experience reuse in coding).
    - Options Considered:
      - Archive full tool output. Rejected: unbounded size, secrets, and injection surface.
      - Separate step notes. Rejected: they would break the exchange as the unit of evidence and multiply notes.
    - Chosen Approach:
      - A bounded, redacted summary inside the exchange, with a pointer to the full output.
    - API Notes and Examples:
      ```markdown
      ## Steps
      - bash `bun test packages/memory` → error: ENOENT: no such file '.prism-memory.sqlite' (entry 01JD…)
      - edit `packages/memory/fabric/src/config.ts` → ok
      - bash `bun test packages/memory` → ok
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{exchanges,config,types}.ts`;
      - tests;
      - fabric README (`## Exchange archive`, `## Config`, stability table, cost);
      - `scripts/compat-baseline/arnilo__prism-memory-fabric.txt` if the config type changes its declaration (regenerated with `bun scripts/release.mjs gate --update-baseline`, diff attributed in the note);
      - `CHANGELOG.md`.
    - References:
      - Task 1 (b) 1.
  - Test Cases to Write:
    - `steps_off_by_default_and_presets_unchanged`.
    - `steps_summarize_tool_rounds_without_bodies`.
    - `step_error_line_redacted_and_trust_scanned`.
    - `failed_then_passed_command_tagged_fixed`.
    - `step_text_is_lexically_recallable`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an opt-in stored content.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed** (all in `packages/memory/fabric`):
      - `src/exchanges.ts`: `exchangePairs` now records the entries between a pair's user and assistant as `ExchangePair.between`; new `summarizeSteps` (one step per tool result, argument chosen from the tool's declared `parameters.properties` through an `argumentFields` callback, in this order `command, cmd, path, file_path, filePath, file, query, pattern, url`, else the first scalar), `renderSteps`, `hasFailedThenPassed` and `exchangeDialogue`; `createExchangeArchive` takes `steps: { maxSteps, argumentFields?, outcomePatterns? }`; `ExchangeArchiveReport` gains `stepsDropped`.
      - `src/config.ts`: `exchanges.steps` (contract) and `exchanges.maxSteps` (tuning, default 24, schema max 64); `ResolvedFabricExchangesOptions.steps: false | { maxSteps }`. Both presets resolve `steps: false`, so conversational and coding revisions stay 1.
      - `src/index.ts`: wiring; `argumentFields` reads the effective registry lazily (`prism.tools.list()` throws during setup) and caches per tool; `outcomePatterns` is `CONSOLIDATION_PATTERNS.outcomes`; `memory:status` reports `stepsDropped` when non-zero.
      - `src/create.ts:800`: the consolidation exchange gatherer passes `exchangeDialogue(hit.text)`, so steps are evidence for recall and never extraction input. `exchangeDialogue` strips the block only when every line after the last `## Steps` heading starts with `- `, so a heading typed in the dialogue is kept.
      - Tests: 8 new in `src/__tests__/exchanges.test.ts` (the 5 planned, plus bounded/collapse, entry-limit/verbatim dialogue, `exchangeDialogue`, and one real turn through the package with a registered tool). README (`## Exchange archive`, config block, cost line, stability table) and `CHANGELOG.md` updated.
    - **Design decisions and deviations from the plan text:**
      - The step block is capped at a quarter of `limits.maxEntryTextChars` and appended to the **last** part; the dialogue is split into the remaining three quarters first, so it stays verbatim and every part fits the core limit. The plan's "about 1.5 KB at the caps" holds for typical steps (a step is about 60–400 characters, so 24 clipped steps can reach the quarter cap; the README states the cap and the per-1k-turns figure).
      - Every step line carries its result entry id (the plan's example showed it only on the error line).
      - `outcome: fixed` is the tag `outcome:fixed` on the exchange note. The detector is new (Task 1 found `outcomeRunIds` private and success-only): an `error` step followed by an `ok` step with the same tool and argument summary, and only for commands matching `CONSOLIDATION_PATTERNS.outcomes`, so a retried `ls` is not "fixed". Plan 209 Task 4's nudge reads this tag.
      - A step that trips the trust scan or the redactor keeps tool name and outcome (`- bash → error (entry …)`); the dialogue is still archived. This differs on purpose from the dialogue's whole-turn refusal (unchanged, still tested). A tool name that is not `[\w.:-]{1,64}` is shown as `tool`.
      - Provider-hosted tool calls have no result entry, so they produce no step.
    - **Findings for later tasks:**
      - Lexical recall on a tiny corpus (one or two notes) returns nothing for a query unless `minSimilarity: 0` is passed; tests that recall from a fresh harness must pass it. Not a bug in this task.
      - The `description` field of the note file (frontmatter) is built from the note text, so it now includes the first part of the step lines; harmless, noted for the OKF export tests in Task 3.
      - Plan 210's feature audit: this feature's measurement is W-row evidence from Task 5 (re-asked questions and corrected-mistake repeats), not a recall benchmark.
    - **Checks:** `exchanges.test.ts` 21 pass; fabric suite 669 pass, 29 skip (Postgres), 0 fail; `prefix-stability.test.ts` 24 pass; `bun run typecheck` clean for all packages. `bun scripts/release.mjs gate`: the fabric compat baseline did **not** fail, so `arnilo__prism-memory-fabric.txt` needs no regeneration (the new exports are not in the public barrel, and the config types are listed by name only). The gate failed on `kernel packedBytes grew +172` and `kernel unpackedBytes grew +444` against `budgets.json`; this task changes no file under `src/` (the working tree's `src/__tests__/package-skills.test.ts` and `packaging.test.ts` edits predate it), so it is the pre-existing working-tree growth plan 215 owns, not a Task 2 regression. Not rebaselined here.
    - **Sweep:** no name was retired.

- [x] Task 3: Standing rules — editable `rules.md`, confirmed capture in every preset, a fixed budget (fabric)
  - Acceptance Criteria:
    - Functional: **One rules module (amended by Task 1).** `delivery/rules.ts` already holds 202 Task 11's pure capture and confirmation; this task moves the inline exchange-hook flow (`index.ts:677–695`) into it, replaces the `preset.name === "coding"` gate (`index.ts:403`) with `rules.capture`, generalizes the cue set to emit `preference` and `procedure` as well as `decision`, and makes confirmation set `pinned` (today it only calls `lifecycle.verify`). The `coding` preset is one consumer. A standing rule is an active `decision`, `preference` or `procedure` note that is pinned or path-scoped.
    - Functional: **Opt-in for every preset:** `rules: { capture: "confirm" | "off" }` (contract field; default `"off"`, and `"confirm"` under `coding`). With `confirm`:
      - user turns matching the explicit and correction cues produce `proposed` rules: a preference, a procedure, or a decision with its rationale;
      - one batched `host.ui` confirmation per turn makes them active and pinned;
      - a correction supersedes the old rule and keeps its history (plan 202 Task 11's rule);
      - `host.ui` answering `unavailable` leaves them `proposed`.
      No model call.
    - Functional: **Editable `rules.md`.** With the markdown store, the pinned core's per-scope `core.md` is renamed `rules.md` and becomes editable:
      - **(amended by Task 1)** the existing reconcile hash check covers only note files, not scope-root files, so this task adds a `rules.md` reconcile: detect an edit with the derived-file marker hash (`core/src/fabric/index.ts:172–183`) once per session, then diff the `[id] text` lines against the ids the file listed when it was written (a `<!-- prism:rules shown=… -->` comment in the body);
      - a person's edit is reconciled into notes: an added line becomes an active pinned rule with `generated.by: human`, a deleted line retires its note, and a changed line updates its note with correction lineage;
      - every edit passes the trust scan; a hit quarantines that line (the existing reconcile rule);
      - the 188.5 behavior that overwrote edits is removed;
      - the swept names include `core.md` in docs, tests and examples.
    - Functional: **Budget and overflow.** Standing rules have a fixed budget, `rules.maxTokens` (tuning, default 2,000, hard 3,000; **Task 1 flag:** the current core is 600 / 1,000 and on by default in every preset, so a 2,000 default changes every default prefix and the plan 202 cache-equivalence attestation. Decide here whether the default stays 600 unless `rules.capture` is on), and project-wide rules are always loaded within it:
      - path-scoped rules load as cues when their `appliesTo` matches a touched path (the existing cue budget);
      - over budget, the least-used non-human rules drop from the always-loaded block but stay recallable, and the directory says `rules: N shown, k more — memory.recall kind=rule`;
      - human-written rules are never dropped silently; overflow of human rules is a `memory:status` warning.
      The pinned core's budget fields (`core.maxTokens`) become the rules budget: a retirement with a sweep, not an alias.
    - Functional: Host impact: hosts that read `core.md` must read `rules.md` (migration entry). `core: { maxTokens }` is renamed `rules: { maxTokens }` under the same contract tier, recorded in `docs/migrate-to-0.13.md`, because 0.13.0 is unpublished.
    - Performance: Reconcile of `rules.md` is one hash compare per scope per session epoch. The rules block stays epoch-snapshotted (plan 202 Task 4.12); a human edit takes effect at the next epoch, and a retraction takes effect immediately (the existing retraction rule).
    - Code Quality: One module owns capture, confirmation, rendering, overflow and the reconcile of `rules.md`. The rename touches every caller of `createFabricCore` (`graft callers createFabricCore --depth all`) in this task.
    - Security:
      - Rules are captured only from user turns and human edits, never from tool output or assistant text.
      - Confirmation is through `host.ui`.
      - The poison canary must never become an active rule (plan 202 Task 14 probe).
  - Approach:
    - Documentation Reviewed:
      - fabric README "Pinned core", "Path cues", "The team store";
      - plan 202 Task 11 (decisions, confirmation, delivery);
      - MemoryCode (arXiv 2502.13791: instructions spread over sessions are lost);
      - the AGENTS.md study (arXiv 2602.11988: static context files at +20% cost with no significant gain, hence small, confirmed and current rules rather than a dump);
      - encoding specificity (Tulving & Thomson 1973) for path-cued rules.
    - Options Considered:
      - Keep `core.md` derived. Rejected: people cannot correct what the agent always reads, which is the highest-leverage edit in the system.
      - Auto-capture rules without confirmation. Rejected: one wrong rule contaminates every later session (ConsistencyGate's argument, plan 202 R18).
    - Chosen Approach:
      - Rules as the small, confirmed, human-editable centre of memory, with one module shared by every preset.
    - API Notes and Examples:
      ```ts
      memoryFabric({ preset: "conversational", rules: { capture: "confirm" }, tools: { root } });
      ```
      ```markdown
      <!-- notes/<tenant>/projects/<slug>--<id8>/rules.md (editable) -->
      - [d12] Validate inputs with zod, not yup. (why: memory.read d12)
      - [p03] Run memory suites with --timeout=0. (applies to packages/memory/**)
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/delivery/{rules,core,cues}.ts`, `src/{config,reconcile,directory,context,index,types}.ts`;
      - tests;
      - `apps/prism-agent/src/host/*` if it names `core`;
      - fabric README (`## Standing rules`, replacing "Pinned core"; stability table);
      - `docs/migrate-to-0.13.md`;
      - `scripts/compat-baseline/arnilo__prism-memory-fabric.txt` (regenerated, diff attributed);
      - `CHANGELOG.md`.
    - References:
      - Plan 202 Task 11; plan 188.5 Tasks 1–3.
  - Test Cases to Write:
    - `rules_capture_off_by_default_outside_coding`.
    - `confirmed_capture_pins_rule_and_unavailable_leaves_proposed`.
    - `rules_md_edit_adds_retires_and_updates_notes`.
    - `rules_md_edit_with_instruction_is_quarantined`.
    - `over_budget_drops_least_used_agent_rules_never_human_rules`.
    - `rules_block_epoch_stable_and_retraction_immediate`.
    - `retired_core_names_absent_repo_wide`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a renamed file and config field, an opt-in capture.
    - Docs pages to create/edit:
      - fabric README;
      - `docs/migrate-to-0.13.md`;
      - `apps/prism-agent/README.md` if affected;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.**
      - `packages/memory/fabric/src/delivery/rules.ts` is now the one module (core.ts is deleted, no alias). It holds the config and budget, the block render, `rules.md` render/parse/reconcile (`reconcileRulesFile`), the generalized capture (`captureRule`: preference, procedure, decision) and confirmation (`confirmRuleProposals`, `captureAndConfirmRule`, `findCorrectedRule`).
      - **Rename sweep, no alias:** config `core` is `rules`; `core.md` is `rules.md`; block source `fabric-core` is `fabric-rules`; heading `Core memory (…)` is `Standing rules (…)`; `createFabricCore`, `resolveFabricCoreOptions`, `FabricCore*`, `HARD_CORE_TOKENS` (1,000) are `createFabricRules`, `resolveFabricRulesOptions`, `FabricRules*`, `HARD_RULES_TOKENS` (3,000); `captureDecision`, `confirmDecisionProposals`, `decisionNoteId` are `captureRule`, `confirmRuleProposals`, `ruleNoteId`; the ablation key `fabric.core` is `fabric.rules` (`ablations.mjs`, `campaign.mjs`). Callers updated: `index.ts`, `context.ts`, `config.ts`, `exports.ts`, the bench scripts (`prefix-probe`, `injection-log`, `safety/run`), `examples/memory-lifecycle.ts`, README, `docs/migrate-to-0.13.md`, `scripts/memory-bench/defaults.json` (regenerated; it also picks up Task 2's `exchanges.steps: false` that had not been snapshotted). `apps/prism-agent` has no `core` reference (Task 1's guess was right).
      - **`@arnilo/prism-memory-core` markdown store** (`src/fabric/index.ts`): `writeDerivedFile` now keeps a person-edited file and resolves `false` unless `{ replaceEdited: true }`; new `readDerivedFile(scope, name)` returns `{ body, edited }`. The `**overwritten**` log line is gone. Test `markdown_derived_file_keeps_a_human_edit_until_the_caller_replaces_it`.
      - `MemoryFabricWriteOptions.generatedBy` accepts `"human"` (the actor already existed).
      - `index.ts`: the inline decision hook is replaced by one `captureAndConfirmRule` call gated by `config.rules.capture === "confirm"`; `reconcileRulesOnce` runs in the `context.build` hook once per session (before the first block is built), per active scope; `memory:status` appends `Standing rules: N shown, k more` and a WARNING when human rules overflow.
      - `config.ts`: `rules` schema with `capture` (contract), `rules.maxTokens` (tuning); coding preset is `rules: { kinds: [decision, preference, procedure], capture: "confirm" }` and **`CODING_PRESET_REVISION` is 2** (procedures are now captured and the budget is larger; `conversational` stays 1).
    - **Decisions taken (Task 1 flags).**
      - **Default budget:** 600 unless `rules.capture` is `"confirm"`, then 2,000 (hard 3,000). So the default prefix and the plan 202 cache-equivalence attestation are unchanged for every preset except `coding`, whose rules block may now be larger once rules exist; it costs nothing when no rule exists. Plan 210's preset revision and cache re-attestation (memory note "plan 202 cache equivalence outcome") must cover coding revision 2.
      - **Block contents.** Order is human-written first, then pinned, standing decisions, S, id. **Path-scoped rules are no longer in the block** (they load as cues; the old cue-vs-core dedup test is rewritten as `cue_dedups_against_topic_inject_and_visible_read_and_path_rules_stay_out_of_the_block`). They are listed in `rules.md` (up to 50 per scope) so a person can edit them.
      - **Overflow line is in the block, not the directory:** `rules: N shown, k more — memory.recall`, appended inside the same budget (16 tokens reserved when something overflows). The plan said "the directory says", and wrote `kind=rule`, which is not a recall kind; the directory is cached on a different key and the block already knows the count. Dropped rules stay recallable through `memory.recall`.
      - **Edit detection** uses the marker hash plus an id list (`<!-- prism:rules shown=… -->`) inside the derived body, so a deleted line retires only a note the file really listed; if a person deletes the comment, nothing is retired. Note ids for added and changed lines are `sha256(resource + text)`, so a failed pass retried at the next session is idempotent. The file is replaced (`replaceEdited`) only after every line was applied.
      - **Trust-hit lines are refused, not quarantined as flagged candidates:** no note is written, the count is reported (`refused`) and the line is dropped from the regenerated file. Deviation from "the existing reconcile rule" (which flags a file note); a typed rule has no file to keep the flag on. Test `rules_md_edit_with_instruction_is_quarantined`.
      - **Correction lineage.** A changed `rules.md` line writes a new note with `supersedes: <old id>`. Captured corrections (`use zod instead of yup`) retire the first active rule that mentions `yup` through `lifecycle.supersede` after approval, not at proposal time (a denied proposal must not retire anything). The new note carries no `supersedes` edge in the capture path; the old note keeps `validTo` and stays readable. This is lexical and only fires when the turn names the old thing.
      - Confirmation now verifies **and pins** (`fabric.verify`, `fabric.pin`, routed over scopes, so a user-scope preference works).
    - **Tests (all pass).** New or rewritten: `rules_capture_off_by_default_outside_coding`, `capture_emits_preference_procedure_and_decision_kinds`, `confirmed_capture_pins_rule_and_unavailable_leaves_proposed`, `confirmed_correction_retires_the_rule_it_names_and_keeps_history`, `rules_md_is_written_editable_and_a_human_edit_is_never_overwritten`, `rules_md_edit_adds_retires_and_updates_notes`, `rules_md_edit_with_instruction_is_quarantined`, `rules_md_path_rule_keeps_its_glob_when_edited`, `over_budget_drops_least_used_agent_rules_never_human_rules`, `rules_block_epoch_stable_and_retraction_immediate`, `retired_core_names_absent_repo_wide` (`src/__tests__/retired-names.test.ts`, scans `src packages apps scripts examples docs`, skipping changelogs and `migrate-to-*`), and one real-agent test `rules_capture_is_opt_in_in_any_preset_and_writes_a_pinned_procedure_when_confirmed`. `prefix-stability.test.ts` re-pinned once (heading and token count 13 to 14, comment says why).
    - **Checks.** Fabric suite 681 pass, 29 skip (Postgres), 0 fail (one unreproduced failure in one of eleven parallel runs; eight further reruns clean). Core fabric tests 24 pass. `bun run typecheck` clean. `scripts/memory-bench`: 474 pass, 1 fail, `Task5Manifest: the candidate product has uncommitted changes`, which is the dirty-tree guard and fails on any uncommitted work. `docs.test.ts` 67 pass. `examples/memory-lifecycle.ts` runs and prints the same tally (`delivery: { prefixes: 10, cues: 1, shares: 1 }`).
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`; fabric and core are experimental, so the gate reports them as "not gated"): `arnilo__prism-memory-fabric.txt` only. Removed and renamed, attributed to this task: `createFabricCore`, `resolveFabricCoreOptions`, `renderCore`, `coreHeading`, `coreCandidateRows`, `DEFAULT_CORE_KINDS`, `DEFAULT_CORE_OPTIONS`, `HARD_CORE_TOKENS`, `FabricCoreScope`, `MemoryFabricCoreConfig`, `ResolvedFabricCoreOptions`, `captureDecision`, `confirmDecisionProposals`, `decisionNoteId`; added `createFabricRules`, `resolveFabricRulesOptions`, `renderRules`, `ruleCandidateRows`, `parseRulesFile`, `renderRulesFile`, `reconcileRulesFile`, `ruleLineNoteId`, `NO_RULES_EDIT`, `captureRule`, `confirmRuleProposals`, `ruleNoteId`, `DEFAULT_RULES_*`, `HARD_RULES_TOKENS`, `FabricRulesScope`, `MemoryFabricRulesConfig`, `ResolvedFabricRulesOptions`; changed `CODING_PRESET_REVISION` (1 to 2), `createFabricContext` (parameter type) and every config interface that names `rules`. The same file also carries earlier plans' additions (Task 2's `exchanges.steps`, plan 207/210 work) that were never regenerated. `arnilo__prism-mcp-server.txt` is unchanged by this task (plan 215's work). The memory-core baseline did not change (the markdown store is a subpath, not in the baselined root). The gate still fails only on `kernel packedBytes`/`unpackedBytes` growth, pre-existing working-tree growth that plan 215 owns (same as Task 2).
    - **Sweep.** `retired_core_names_absent_repo_wide` passes. Historical `CHANGELOG.md` entries and the migration doc keep the old names on purpose.
    - **Housekeeping.** `bunx biome format --write` over the fabric tree reformatted 49 files I had not authored; I reverted every file I did not edit (and re-applied the one-line `campaign.mjs` change), so the diff holds only this task's changes. `scripts/live-matrix.json`, `scripts/skill-evals/` and the mcp-server files are plan 215's uncommitted work, untouched.
    - **Findings for later tasks.**
      - Task 4: `rules.activeRules(level)` and `reconcileRulesFile`'s deps (`remember`, `pin`, `retire`) show the routed-write pattern for evidence-linked notes; lessons that become rules go through the same `fabric.pin`. The nudge should not be added to `rules.ts`; keep it in `context.ts` tail assembly (Task 1 (b)4).
      - Task 5/6: work-outcome arms `P+W` should set `rules: { capture: "confirm" }` explicitly (the `conversational` preset leaves it off), and a scripted `host.ui` confirm (`createScriptedHostUi({ confirm: true })`) drives capture offline. The tuning values for the dev screen are `rules.maxTokens` (600 / 2,000), `maxSteps`, nudge rate, `archiveAfterSessions`.
      - Plan 210: add coding preset revision 2 and the `rules.md` reconcile to the ledger; the `rules.capture` default stays `off` until its W-row evidence exists.

- [x] Task 4: The cited lesson notebook and the lesson nudge (fabric)
  - Acceptance Criteria:
    - Functional: **`memory.insert` gains optional `evidence`:** 1–8 note ids (exchanges, including their steps, or other notes) readable in the write scope. They are stored as `links` with relation `evidence`; an unreadable or foreign id rejects the write (`not_found`). The tool name and effects are unchanged (stable at API level 1); the parameter is additive.
    - Functional: **A lesson** is a `procedure` or `fact` written with `tags: ["lesson"]` and ≥ 1 `evidence` id. No new kind. Without evidence, a `lesson` tag is rejected (`lesson_requires_evidence`).
      - Lessons start as `candidate` and become verified by the existing use rule (cited or applied in a later session without correction).
      - A lesson unused for `lessons.archiveAfterSessions` (tuning, default 20) scope sessions is archived from default recall by the existing archive-with-revival rule, and never deleted.
    - Functional: **Nudge**, opt-in `lessons: { nudge: true }` (contract field; default off). After a turn carrying a signal, the next request's tail carries one line:
      ```text
      memory: this turn had <signal>; if there is a reusable lesson, record it: memory.insert { kind: "procedure", tags: ["lesson"], evidence: ["<exchange id>"] }
      ```
      - Signals: a correction cue, an explicit "remember" cue, a step trace tagged `outcome: fixed` (Task 2), or an approval denial.
      - At most once per `lessons.minTurnsBetweenNudges` (tuning, default 5).
      - Never in the prefix.
      - No model call.
    - Functional: Host impact: **none** unless a host uses the new parameter or opts in.
    - Performance: Nudge detection is pattern matching already done by consolidation gathering. One tail line, ≤ 60 tokens, on a signal turn only.
    - Code Quality: Evidence validation in `create.ts` next to `supersedes` validation; the nudge in `context.ts` tail assembly, reusing `gatherConsolidationCandidates`' signal detection.
    - Security:
      - A lesson's text passes the trust scan like every typed write.
      - Evidence must be in scope.
      - The nudge contains ids and fixed text only, never note content.
  - Approach:
    - Documentation Reviewed:
      - fabric `create.ts:127–208,505`, `tools.ts:587–735`, `consolidation/gather` signals;
      - the lifecycle verification and archive rules (188.4);
      - Reflexion and experience-reuse literature (verbal lessons help when grounded in trajectories);
      - ACE's playbook bullets.
    - Options Considered:
      - A background model call that writes lessons after each task. Rejected: it adds a write-path generative call; the working agent already has the context in its turn.
      - A new `lesson` kind. Rejected: `procedure` and `fact` with a tag and required evidence are enough, and a new kind needs a new opt-in name.
    - Chosen Approach:
      - The agent writes its own lessons, they are cited to evidence, nudged cheaply, and kept by use.
    - API Notes and Examples:
      ```json
      { "tool": "memory.insert", "input": { "kind": "procedure", "text": "Create the SQLite file's parent dir before running memory suites.", "tags": ["lesson"], "evidence": ["4f2a9c1e0b77"] } }
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{create,tools,context,config,types}.ts`;
      - tests;
      - fabric README (`## Lessons`, `## Tools`, cost, stability table);
      - compat baseline if declarations change;
      - `CHANGELOG.md`.
    - References:
      - Tasks 2, 3.
  - Test Cases to Write:
    - `insert_evidence_links_and_rejects_foreign_ids`.
    - `lesson_tag_requires_evidence`.
    - `lesson_verified_by_use_and_archived_when_unused`.
    - `nudge_only_after_signal_and_rate_limited`.
    - `nudge_never_in_prefix_and_carries_no_note_text`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a tool parameter and an opt-in nudge.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed** (all in `packages/memory/fabric`):
      - New `src/lessons.ts`: `LESSON_TAG`, `EVIDENCE_RELATION`, `MAX_EVIDENCE_IDS` (8); `EvidenceNotFoundError` (code `not_found`) and `LessonRequiresEvidenceError` (code `lesson_requires_evidence`), both `MemoryValidationError`s like `ConceptRequiresOntologyError`; `assertEvidenceInput`, `assertLessonInput`, `evidenceLevelsFor`; the nudge pieces `lessonSignal`, `lessonNudgeLine`, `createLessonNudges` (per-session turn counter, last nudged turn, one queued line).
      - `types.ts`: `MemoryFabricRememberInput.evidence`.
      - `create.ts`: `assertRememberInput` checks the evidence shape (1–8 12-hex ids) and the lesson rule for **every writer**, next to `supersedes`; `rememberIndexed` resolves evidence through the new `resolveEvidence` before any write and merges the ids into `links` with relation `evidence` (with or without the linker); a lesson write defaults to status `candidate`.
      - `tools.ts`: `memory.insert` gains the `evidence` parameter (forwarded), the description says what a lesson is, and the two lesson errors become tool answers (`fail(…, error.code)`) instead of throws.
      - `lifecycle/archive.ts`: `ArchiveConfig.lessonSessions` and `lessonUnused`; `shouldArchive` archives a `lesson`-tagged, unpinned note once `clock − lastUse ≥ lessonSessions` (last use from the `uses` log, else `created`), before the strength rule. `inspect.ts` reports it eligible with no reasons, so the view agrees with the predicate.
      - `config.ts`: `lessons: { nudge (contract), minTurnsBetweenNudges (tuning, 5, max 1,000), archiveAfterSessions (tuning, 20, max 10,000) }`; resolved `lessons`, and `lifecycle.archive.lessonSessions` set from it. `lessons.nudge` without the exchange archive is a config error.
      - `index.ts`: the `message.completed` hook (now async) reads the branch once, before it returns, only when the nudge is on; the pair lookup is factored into `completedPair`, shared with the archive's background task. `fixed` is `hasFailedThenPassed(summarizeSteps(pair.between))` over `CONSOLIDATION_PATTERNS.outcomes` and is read only when `exchanges.steps` is on.
      - `context.ts`: `createFabricContext` takes a trailing `lessonNudges`; the line is taken once per request and pushed onto `tailBlocks` before every early return and outside the per-user-turn tail cache (Task 1 (b)4), as a `Memory nudge` block with source `fabric-lesson-nudge`; `forget` clears the session's nudge state.
      - README (`## Lessons`, `## Tools` insert paragraph, config block, cost bullet, stability table), `CHANGELOG.md`, `scripts/memory-bench/defaults.json` (regenerated: `lessons`, `lifecycle.archive.lessonSessions`).
    - **Design decisions and deviations from the plan text:**
      - **"Readable in the write scope"** is read as "readable wherever the new note is read": a project or path note may cite path, project, user or agent notes; a user or agent note may cite only user or agent notes (it is read in every project). A missing id, another project's note, or a narrower-scope note all answer `not_found`. Archived or candidate evidence counts (it is still readable through `memory.read`).
      - **Signals.** Correction and "remember" come from `gatherConsolidationCandidates` over the window ending at the reply, filtered to the pair's user entry; "remember" is the explicit candidate whose text matches `\bremember\b`, not every explicit cue (`don't`, `always` would nudge nearly every turn). Denial is a `decision.resolved` event with a `deny` between the user entry and the reply (new reader; gather reads only `allow`). Precedence: correction, remember, fixed, denial.
      - **Rate limit** counts completed exchanges per session in process memory; a signal turn inside the window does not queue a line and is not remembered. A restart resets the counter (a nudge may come sooner after a restart; never more than one per request).
      - **Exchange id** in the line is part 0 of the pair (`exchangeNoteId(…, 0)`), which always exists when the archive wrote the turn. If the trust scan refused the turn, the id is not a note and an insert citing it answers `not_found`; the nudge does not wait for the background write.
      - **Lesson verification** uses the existing `recordUses`/`verifyAfterSessions` rule unchanged. A lesson that consolidation folds into an existing verified procedure keeps that note's `verified` status (existing update rule); not special-cased.
      - The nudge line is fixed text plus the id, so it carries no untrusted envelope; it never names note or turn text.
    - **Tests** (`src/__tests__/lessons.test.ts`, 6 pass): the five planned (`insert_evidence_links_and_rejects_foreign_ids`, `lesson_tag_requires_evidence`, `lesson_verified_by_use_and_archived_when_unused` (predicate, config and a real `maintain()` pass, then revival by use), `nudge_only_after_signal_and_rate_limited` (real agent, six turns, rate limit 3), `nudge_never_in_prefix_and_carries_no_note_text`), plus `lesson_signal_reads_corrections_remember_fixed_and_denials`.
    - **Checks:** fabric suite 687 pass, 29 skip (Postgres), 0 fail; `prefix-stability.test.ts` 24 pass; `bun run typecheck` clean; `docs.test.ts` 67 pass; `scripts/memory-bench` 474 pass, 1 fail, the same dirty-tree guard as Task 3 (`Task5Manifest: the candidate product has uncommitted changes`).
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`; fabric is experimental, "not gated"): `arnilo__prism-memory-fabric.txt`. Added by this task: every `lessons.ts` export (`LESSON_TAG`, `EVIDENCE_RELATION`, `MAX_EVIDENCE_IDS`, `DEFAULT_LESSON_*`, `MAX_LESSON_*`, `EvidenceNotFoundError`, `LessonRequiresEvidenceError`, `assertEvidenceInput`, `assertLessonInput`, `evidenceLevelsFor`, `isLessonTagged`, `lessonSignal`, `lessonNudgeLine`, `createLessonNudges`, `LessonNudges`, `LessonSignal`), `lessonUnused`, `MemoryFabricLessonsConfig`, `ResolvedFabricLessonsOptions`; changed: `createFabricContext` (trailing `lessonNudges`), `shouldArchive` (`tags` in the metadata pick), `ArchiveConfig` (`lessonSessions?`), `MemoryFabricRememberInput` (`evidence?`) and the config interfaces that gain `lessons`. No removal. The rest of that file's diff against `HEAD` is Task 2/3's uncommitted work; `arnilo__prism-mcp-server.txt` is plan 215's. The gate still fails only on `kernel packedBytes`/`unpackedBytes` growth, the pre-existing working-tree growth plan 215 owns; this task changes no file under `src/`.
    - **Sweep:** no name retired.
    - **Findings for later tasks:**
      - Task 5/6: the `P+W` arm is `exchanges: { steps: true }`, `rules: { capture: "confirm" }` and `lessons: { nudge: true }` (the nudge requires the archive; the `conversational` and `coding` presets both enable it). W5 samples lessons as notes tagged `lesson` and reads their `links` with relation `evidence`.
      - Tuning values for the dev screen: `lessons.minTurnsBetweenNudges` (5) and `lessons.archiveAfterSessions` (20) join `maxSteps` and `rules.maxTokens`.
      - Plan 210 ledger: lessons (evidence links, the lesson rule, the lesson archive rule) and the nudge enter as candidates; `lessons.nudge` stays off by default until W-row evidence exists. The lesson archive rule is **on by default** (default 20) but touches only notes tagged `lesson`, which nothing but this task's path writes.

- [x] Task 5: The work-outcome suite and its pre-registered criteria
  - Acceptance Criteria:
    - Functional: `scripts/memory-bench/work-outcome/` builds multi-session scenarios run through `createAgent` with a persistent fabric store, driven by plan 200's user simulator and graded by state match and scripted checks. There are two families:
      - **coding** (amended by Task 1): 12 personas built in a new `work-outcome/personas.mjs` from the lifecycle persona's shape (`lifecycle/persona.mjs` is frozen evidence and accepts only 2 or 8 sessions), each ≥ 6 sessions with:
        - a corrected mistake that recurs as an opportunity;
        - conventions set early and tested later;
        - questions answered once and needed again;
        - a returning-project start;
      - **assistant**: ≥ 8 personas with preferences, a correction, recurring tasks and facts that change.
    - Functional: **Metrics**, per arm:
      - **W1 corrected-mistake repeat rate:** opportunities where the corrected behavior recurs;
      - **W2 convention adherence:** later sessions applying an earlier convention;
      - **W3 re-asked questions:** the agent asks for information the user already gave;
      - **W4 orientation cost:** tokens and turns before the first productive action in a returning session;
      - **W5 lesson and rule support:** sampled lessons and agent-proposed rules judged against their evidence with plan 208 Task 2's audit;
      - **W6 task success**, plus the safety canary and cross-project leakage (from 202's safety probes).
    - Functional: **Partitions and criteria.** Personas are drawn label-blind into `dev`, `heldout-a` and `heldout-b` (the `drawHeldoutV3` pattern) and committed before any measurement. `work-outcome-criteria.json` is hashed into manifests and defines, for the arms memory-off, `P`, `P+W` (Tasks 2–4 on) and `P+W+O` (with plan 207):
      - `P+W` vs `P`: W1 lower and W2 higher with CI lower bound > 0 pooled over both families; W3 and W4 non-inferior; W5 ≥ 95% supported; W6 non-inferior with 2 points and safety at 0;
      - `P` vs memory-off: the same rows reported. This is the claim "memory improves work", stated only if it passes;
      - `ontology-work` (`P+W+O` vs `P+W`): plan 208 Task 1's O8 thresholds, copied unchanged (W3 and W4 improve with CI lower bound > 0 pooled over both families; W1, W2 and W6 non-inferior with a 2-point margin; W5 covers concept claims). A test asserts the row matches `three-tier-criteria.json`'s O8.
    - Functional: An offline mode with scripted users and the mock provider proves every metric computes.
    - Performance: Wall time and cost per persona stated at the gate. The offline run takes ≤ 10 minutes.
    - Code Quality: Reuses `packages/hosts/evals` (user simulator, scenario runner, state match, judge panel) and the memory-bench journal and manifest machinery. No second runner.
    - Security: Fixture personas only; the poison canary is included. Reports carry no text.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/evals/src/{user-simulator,scenario-runner,state-match,judge-panel}.ts`;
      - `scripts/memory-bench/lifecycle/*`, `robustness-draw.mjs`;
      - plan 200 (simulated users, scenario items, state grading);
      - MemoryCode and VibeMemBench designs.
    - Options Considered:
      - Rely on LongMemEval-style QA. Rejected: it measures recall of stated facts, not whether an agent works better.
      - Add the rows to `robustness-criteria.json`. Rejected: that file is frozen and hashed (plan 202 Task 2).
    - Chosen Approach:
      - A separate, pre-registered work-outcome suite.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/work-outcome/{personas,run,metrics,draw}.mjs` and `work-outcome/work-outcome.test.mjs` (new);
      - `scripts/memory-bench/work-outcome-criteria.json` and `work-outcome-{coding,assistant}.json` partitions (new);
      - `scripts/memory-bench/README.md`;
      - `docs/_evidence/memory-bench/209/README.md` and `docs/_evidence/memory-bench/209/offline/work-outcome-offline-dev.json` (new).
    - References:
      - Plans 200, 202 Task 2, 208 Task 2.
  - Test Cases to Write:
    - `work_outcome_offline_computes_every_metric`.
    - `persona_draw_label_blind_and_frozen`.
    - `manifest_refuses_work_outcome_criteria_drift`.
    - `ontology_work_row_matches_three_tier_o8`.
    - `reports_carry_no_text`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evaluation.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`;
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05; offline only, no model call, no spend):
    - **What changed** (all new, under `scripts/memory-bench/`):
      - `work-outcome/personas.mjs`: one six-session template, two families. `coding` has 12 personas (projects `alpha`, `beta`); `assistant` has 9 (contexts `work`, `home`; the plan asked for ≥ 8, and 9 gives an even 3/3/3 draw).
        - Each persona has a user preference and a per-project convention set early and tested later (W2), and an action corrected in session 1 that recurs in sessions 2 and 5 (W1): the test command for coding, the update recipient for assistant.
        - Each also has a per-project fact the user gives only when asked, needed again in later sessions (W3), and returning-project starts in sessions 5 and 6 (W4).
        - The assistant family's meeting day changes in session 2 (stale use is reported).
        - A fixture `README.md` plants the canary as tool output.
        - Values are seeded per persona. `lifecycle/persona.mjs` is not edited.
      - `work-outcome/draw.mjs` writes `work-outcome-{coding,assistant}.json`: label-blind draws over persona ids, ordered by `SHA-256(seed:id)`, using the `robustnessIdsHash` shape; coding 4/4/4, assistant 3/3/3. Committed before any measurement.
      - `work-outcome-criteria.json` (frozen 2026-11-05, hash `d30681ec…7bd2`). It pins plan 208's three-tier hash, plan 202's robustness hash and both partition id hashes.
        - Arms: `memory-off`, `P`, `P+W`, `P+W+O`, `coding`, `coding+W`, configs stated in full.
        - Metrics: W1–W6, W5 and safety, each with its row unit and direction.
        - Statistics: `pairedClusterPermutation`, clustered by persona, pooled over both families.
        - Rows: `work`, `memory`, `ontology-work` (O8 copied), `coding-work` (reported only).
      - `work-outcome/metrics.mjs`: the criteria hash, `verifyWorkOutcomeCriteria`, `workOutcomeManifestPin` and `assertWorkOutcomeCriteriaPin` (mirroring plan 208's pin); `gradeSession`, `summarizeRows`, `comparePaired`, `evaluateRow`, `assertWorkReportHasNoText`; and `--verify-criteria`.
      - `work-outcome/run.mjs`: `runWorkOutcome` and `runPersonaArm`.
        - Each session is one `runScenario` over a fresh `createAgent`. The evals user simulator drives it (`createUserSimulator`), and `createStateMatchScorer` (subset) grades it, reading a harness environment the fixture tools mutate.
        - A persona's sessions share one SQLite fabric store per arm. `host.ui` is `createScriptedHostUi({ confirm: true })`. `P+W+O` adds `memoryWiki` (offline `minNotes: 2`); the curator is answered by `mockCuratorEdits`.
        - W5 builds claims from the store snapshot: every `lesson`-tagged note cites its `evidence` links, and every pinned non-human rule cites the exchanges that share its source entries. Plan 208's `createClaimPanel` / `judgeClaims` / `summarizeGroup` judge them; an uncited claim counts as unsupported.
        - The offline mocks are request-driven (`workOutcomeAgentMock`, `scriptedUserMock`): no label reaches the answer mock, and the user mock follows only the JSON data in its own goal.
        - A live CLI call is refused (it belongs to Task 6). `runWorkOutcome` refuses a live run on a held-out partition.
      - `work-outcome/work-outcome.test.mjs`: the five planned tests. README section "Work-outcome suite (plan 209 Task 5)"; `docs/_evidence/memory-bench/209/README.md`; offline report `docs/_evidence/memory-bench/209/offline/work-outcome-offline-dev.json`.
    - **Pre-registration choices the plan left open:**
      - W3 is the share of previously given facts the agent asked for again.
      - W4 is model requests up to and including the one that issued the first write or action, with the request-size token estimate reported beside it.
      - The `work` row's W4 non-inferiority margin is 10% of `P`'s mean, and W3's is 2 points.
      - An arm that wrote no lesson and no rule has no W5 row, so W5 does not block it.
      - Safety counts canary sessions plus personas whose store holds the canary.
      - Points are shares × 100.
    - **Offline result (dev partition, 7 personas × 6 arms):** 4.6 s wall, 42 persona-arms, mean 0.39 s each, 1,142 main requests, about 3.4 M mock-estimated input tokens; well inside the 10-minute budget.
      - Every metric and row computes, and no session failed or leaked.
      - The mock is sensitive to memory: `memory-off` has W1 = 1, W3 = 1 and W4 = 4; `P+W` has W1 = 0, W2 = 1, W3 = 0, W4 = 1 and W6 = 1.
      - These are mock numbers, not evidence. `work` fails on W1 because `P` already scores 0, so there is no headroom; W5 offline is 0.66 because the scripted judges label at random.
    - **Findings for later tasks:**
      - **Rule capture takes one cue per user turn** (`captureRule` returns the first match, preference before procedure). The session-1 opening states a preference and a procedure, and only the preference becomes a rule. This is product behaviour, not a bench bug; it goes to plan 210's ledger next to `rules.capture`.
      - **Rules cite their evidence.** A captured rule carries `sourceEntryIds` shared with its exchange note, so W5 resolves every rule (offline: 0 uncited).
      - **Task 6 wiring is still to do.**
        - `runWorkOutcome` takes `providers`, `model`, `simulatorModel`, `simulatorProviders` and `judges`. Task 6 adds `campaign.mjs --plan 209` around it with journal reservation and usage accounting (the lifecycle suite's `liveProviders` / `requireAttemptReservation` pattern), and pins `workOutcomeManifestPin()` into its manifest.
        - The live answer model must follow the `QUESTION:` line rule; it is in the `write_file` tool description, and W3 parses it.
        - Rows carry a `simulatorLeak` flag (the simulator gave a hidden answer before the agent asked). It is 0 offline; Task 6 must report it, and a non-zero count invalidates W3 for that model.
      - Each arm's notes can be compared (`P+W+O` stores about 4 concept notes more than `P+W` per persona offline), but curator calls are not yet counted in this report; Task 6 should add plan 208's `curatorStats`.
    - **Checks:**
      - `work-outcome.test.mjs`: 5 pass.
      - `bun test --timeout=0 scripts/memory-bench`: 479 pass, 1 fail, which is the same dirty-tree guard as Tasks 3–4 (`Task5Manifest: the candidate product has uncommitted changes`).
      - `bun run typecheck` clean; `docs.test.ts` 67 pass; `biome check` clean on the new files.
      - No package or export changed, so there is no baseline diff, and no name was retired, so there is no sweep.

- [ ] Task 6: Development screen (owner gate W-1, paid)
  - Acceptance Criteria:
    - Functional: Gate W-1 is approved before any paid call. The gate states:
      - the budget;
      - two answer models from two providers, one small;
      - the arms (memory-off, `P`, `P+W`, `P+W+O`, `coding`, `coding+W`) on work-outcome `dev`, and `P+W` on plan 202's development partitions for no-harm.
    - Functional: The screen is advisory and reports W1–W6, plus plan 208's O8 from the `ontology-work` row. **One revision** of tuning-tier values is allowed (`maxSteps`, `rules.maxTokens`, nudge rate, `archiveAfterSessions`), each tied to evidence. The product is then frozen by product hash for plan 210's audit and held-out acceptance.
    - Functional: **Hand-off to plan 210 (moved from Task 7, 2026-10-31).** Every feature of this plan without a passing development row (tool steps, rule capture, the `rules.md` reconciliation, lessons, the nudge) enters plan 210's ledger as a candidate, with the dev rows as its evidence.
    - Functional: Plan end: Compromises, Further Actions and the backlog hand-off (SKILL.md "Plan end").
    - Performance: Caps per arm stated and reported.
    - Functional (amended by Task 5): `campaign.mjs --plan 209` wraps `runWorkOutcome` from `work-outcome/run.mjs`, passing live `providers`, `model`, `simulatorModel`, `simulatorProviders` and the plan 208 claim panel `judges`. It adds journal reservation and wire-proxy usage (the lifecycle suite's `liveProviders` / `requireAttemptReservation` pattern), pins `workOutcomeManifestPin()` in the manifest, and adds `curatorStats` for `P+W+O`. The screen reports `simulatorLeak` per arm and model; a non-zero count invalidates that model's W3 row.
    - Code Quality: Existing campaign machinery with `--plan 209`.
    - Security: Keys as refs. No text in reports.
  - Approach:
    - Documentation Reviewed:
      - plan 208 Task 5;
      - plan 202 Task 4 discipline.
    - Options Considered:
      - No screen. Rejected: the tuning values are untested on real use.
    - Chosen Approach:
      - One advisory screen, one revision, freeze.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 209 --manifest --partition dev
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance-report}.mjs` (`--plan 209`) and tests;
      - `docs/_evidence/memory-bench/209/{gates,screen}/*`;
      - this plan, `plans/backlog.md` (plan end).
    - References:
      - Task 5.
  - Test Cases to Write:
    - `plan_209_profile_refuses_heldout_partitions` (held-out reads belong to plan 210 Task 9's manifest).
    - `revision_changes_only_tuning_tier_values`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: possibly — tuning defaults.
    - Docs pages to create/edit:
      - fabric README (tuning values, if revised);
      - evidence README;
      - `CHANGELOG.md` if tuning changes.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Progress (2026-11-05; **not complete**: the screen has not run, so W1–W6, O8, the revision and the plan end are open):
    - **Gate W-1 (owner, 2026-11-05):** budget "Free + named cheap paid", answers "Nemotron free + Qwen Flash", no-harm "Quick slice only". Record `docs/_evidence/memory-bench/209/gates/owner-gate-w1.json`, now bound to manifest hash `84824958…3abe` after two assistant amendments (instrument fixes, below; the owner's scope is unchanged). Answers are `kilo/nvidia/nemotron-3-ultra-550b-a55b:free` (large) and `commandcode/Qwen/Qwen3.7-Flash` (small, paid; USD 20 cap, the figure in the gate question). The simulator is `kilo/cohere/north-mini-code:free`; the judges are plan 208's Command Code stealth pair.
    - **Wiring done** (offline-tested, green):
      - `work-outcome/screen.mjs`: models, 18 jobs (12 work-outcome jobs, one per model and arm; 6 no-harm `P`/`P+W` jobs on plan 208's quick slices), the manifest (pins the criteria, the product hash and the tuning table), `assertScreen209Gate`, `assertScreen209Partition`, `assertTuningRevision`, and the merged development report (`noHarmRow`, `mergeModelReports`, USD at the gate's rates).
      - `work-outcome/live.mjs` (the journal-reserved live child, wire-proxy usage split per route, persona-arm checkpoints keyed by protocol) and `work-outcome/argv.mjs`.
      - `campaign.mjs --plan 209` (mode `screen209`, sharing plan 208's retry and checkpoint re-run paths), `acceptance-report.mjs --plan 209`, and `ablations.mjs` paths `fabric.exchanges.steps`, `fabric.rules.capture` and `fabric.lessons.nudge`.
      - `run.mjs`: curator accounting (`measureCurator`, `curatorTotals`), `workOutcomeCriteria`, persona checkpoints, `failureCode` per session row, `simulatorLeak` per arm, and `retryEmptyCompletions` on the simulator's provider.
      - `ontology-audit.mjs` exports `openClaimJudges`, which `liveJudges` now wraps.
      - Tests: `work-outcome/screen.test.mjs` (8, including the planned `plan_209_profile_refuses_heldout_partitions` and `revision_changes_only_tuning_tier_values`); work-outcome 13 pass; memory-bench 486 pass, 1 fail (the known dirty-tree guard); `bun run typecheck` clean.
    - **Live smokes found instrument defects that Task 5's offline mocks could not show** (all fixed, recorded as gate amendments, criteria and partitions untouched; the offline report was regenerated, with the same rows):
      - The first simulator (`nemotron-3.5-lightning:free`) returned empty replies, and the evals simulator runs with `maxProviderAttempts: 1`, so every probed free model failed some turns. Fixed with a bounded retry of empty completions and transport faults on the simulator only.
      - The openings did not say where the record goes or in what form: Qwen wrote a TypeScript interface, or explored with `run_command ls -la` until `ERR_PRISM_RUN_LIMIT`. The opening now names `export default {...}` at `src/<folder>/record.ts`, and the action tool says it runs test commands only. After the fix, Qwen wrote the exact expected record in session 1 and ran `npm test` before the correction.
      - A job whose sessions all failed was reported `completed`. Now any failure code except `ERR_PRISM_RUN_LIMIT` (a scored outcome) fails the job, and only clean persona-arms are checkpointed.
    - **Root causes, found with a per-call provider log.** The owner said "I do not think it is a paid vs free model issue. But sure. Try with Muse spark" (gate amendment 3), and it was not:
      - *Simulator failures:* the harness capped the simulator route at 1024 output tokens. The reasoning simulators spent it thinking and stopped on `max_output_tokens` with empty text, which also truncated some openings. The cap is now 4096, the evals simulator's own bound.
      - *Muse versus cohere:* Muse then still ended replies on `max_output_tokens` or the timeout. It reasons first and declares no effort levels to lower. Free cohere completed every simulator turn, so the simulator returned to `kilo/cohere/north-mini-code:free` (amendment 5).
      - *`ERR_PRISM_RUN_LIMIT` in 5 of 12 sessions:* the live agent ran under the kernel's unconfigured fences (40k input, 50k total, 120 s). They are now explicit per session: 400k input, 450k total, 40k output, 900 s, 16 turns.
      - *Exploring commands:* `ls -la` counted as an action and broke W6's last-action check. Non-test commands are now refused and not recorded (`isTestCommand`).
      - *False leak flag:* `simulatorLeak` flagged an agent that asked without the `QUESTION:` prefix. An earlier assistant turn that names the field now counts as asking; W3 itself still reads the `QUESTION:` line, as pre-registered.
      - *Transport faults:* Command Code's Qwen route sometimes drops a stream (`gateway_stream_terminated`, `sse_event_overflow`). The session is re-run on a snapshot of the store taken before it began, at most 3 tries; only transport faults are retried, and the counts are in `personas[].sessionRetries`. Empty or failed simulator completions are counted by stop reason in `simulatorRetryCauses`.
      - *No-harm scorer:* the LoCoMo F1 scorer needs the bench's pinned Python tooling. It was installed at `.cache/memory-bench/python` (`scripts/memory-bench/requirements.txt`).
    - **Final smokes (one persona per family):**
      - Nemotron `P+W` and `P+W+O`: 12 of 12 sessions completed in each; W2 0.6, W6 0.42; `P+W+O` made 5 curator calls.
      - Qwen `coding+W`: 12 of 12 completed; W2 0.9, W6 0.58; 1.25M input and 0.72M output tokens on the answer route.
      - No-harm LoCoMo `P+W`: scored.
      - `simulatorLeak` was 0 everywhere. Smoke reports are superseded and deleted.
    - **Full screen launched 2026-11-05** under gate W-1, manifest `84824958…3abe`: `campaign.mjs --plan 209 --partition dev --parallel-arms 4`, log `.cache/memory-bench/209/screen-run.log`.
    - Spend so far: smokes and probes only. Qwen used about 0.5M input tokens (under USD 0.05); the free routes cost $0.

- Task 7: **moved to plan 210 on 2026-10-31** (sequential memory train). The held-out work-outcome arms are plan 210 Task 9; this plan's defaults (`rules.capture`, `exchanges.steps`, `lessons.nudge`) and the `PRODUCT.md` Memory positioning are plan 210 Task 10. Their criteria and tests moved with them unchanged in substance.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 300 bun test packages/memory/fabric/src/__tests__/prefix-stability.test.ts`
- `timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate` (fabric baseline diffs attributed)
- Paid, in order, after their gates:
  1. Task 6 (gate W-1);
  2. confirm no owned paid process remains.
- The held-out work-outcome arms run in plan 210 Task 9 (gate 3).

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
