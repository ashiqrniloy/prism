# Phase 11 Part AK — release 0.14.0: session memory (STM) ships as the default compaction, WM off, LLM compaction the opt-in replacement

> **Owner, 2026-11-22:**
>
> "Before going to 218.5 I want to actually release the memory package with STM only with WM turned off and code not removed. Also it is important as Prism itself has changed quite a lot since 0.13.x releases and I want to release 0.14.0 with STM fully shipped as the main compaction system with llm based compaction opt in as a replacement for STM. I want you to now explore the package, consolidate everything, commit and merge to main and do a release plan … Whatever we should be doing before the release should be part of that plan."

## Objectives

- Land everything finished since 0.13.1 on `main` as one consolidated, green tree:
  - Phase 19 Parts B–M and O (plans 226–237, 239);
  - the memory track (plan 218.3 Tasks 1–12, plan 218.5 Task 1);
  - the new plans 218.4 and 218.5.
- Make **session memory's STM the shipped compaction system**:
  - installing `@arnilo/prism-memory-system` compacts every session with STM;
  - working memory (WM) is **off by default**, with its code kept as an experimental opt-in;
  - Prism's **LLM compaction** (`@arnilo/prism-extensions/compaction`) is the documented opt-in replacement;
  - one compaction system per agent, as today.
- Ship the reference host, the host-builder kit, the examples and the docs on that default.
- Release **0.14.0**: the kernel, `@arnilo/prism-hosts`, the changed stable bundles and the memory bundle. Every decision about versions, the API promise and graduation is recorded before any bump.
- Plan 218.5 (long-session benchmark; WM keep/drop) and plan 218.4 (WM removal) run **after** this release and do not block it.

## Expected Outcome

- `main` holds the consolidated tree in commits whose messages name the plans they carry. `bun run sdk:ready` is green on it.
- `memorySystem({ enabled: true })` compacts with STM in every session. The package installs off, and the host turns it on (owner D2). `wm`, `rehearsal`, `ltm` and `sleep` are off unless configured, and `wm.policy` defaults to `deterministic` (the plan 218.3 Task 12 verdict). The README, the config stability table and the CHANGELOG say so.
- LLM compaction recovers after an over-window turn (the plan 218.3 Further Action). Its README and `docs/slots.md` present it as the replacement for STM, with the one-system rule.
- `apps/prism-agent` defaults to session memory, with `compaction: "llm"` as the opt-in. The host-builder kit's choosing guide, recipes and pitfalls, and the mirrored examples, say the same.
- `@arnilo/prism` and `@arnilo/prism-hosts` are at 0.14.0. The stable bundles and the memory bundle are on the versions the owner chose in Task 2, published through `release.yml`. `post-publish:smoke` has passed, and the roadmap's version table records the release.

**Plan shape.**
- This is a release plan. Task 2 is its review: read-only, because the plan changes package defaults (a contract for hosts) and maybe the stability promise. Task 2 also gathers the owner's decisions, D1–D9.
- Task 1, the consolidation, was done when the plan was written; its notes record it.
- No kernel contract changes. The kernel's default compactor stays deterministic, because the kernel never names a package. "STM is the main compaction system" is delivered through the memory package's defaults, the reference host, the kit and the docs.
- **Owner gates (outward-facing):**
  - Task 10 (paid live check, on the owner's word with a token ceiling);
  - Task 12 (version bumps, tag pushes, publish, any trusted-publisher renewal).
- No push to `origin` happens outside Task 12.
- Plan 238 (Node support) stays owner-gated and outside this release.

## Tasks

- [x] Task 1: Consolidate the finished work onto `main`
  - Acceptance Criteria:
    - Functional:
      - Every uncommitted change in the tree is committed on a branch and merged into `main` (local; no push), with nothing left unstaged. The executed plans are 226–237 and 239 (all tasks ticked), 218.3 Tasks 1–12, 218.5 Task 1, and the new plans 218.4, 218.5 and 240.
      - No secrets are committed: no `scripts/live.env`, `scripts/release-evidence.json` or `.env`. The literal-secret scan over the diff hits test fixtures only.
      - `bun run typecheck`, `bun run lint`, `bun run format:check` and `bun run test` are green, or every remaining failure is named in the notes with its cause and the later task that owns it.
    - Performance: n/a (no behavior change beyond the executed plans).
    - Code Quality: commits are grouped by track with plan numbers in the messages, and the merge does not rewrite history.
    - Security: the diff is scanned for credential shapes; the hits are test fixtures (`sk-TESTONLY…`, `AKIAABCDEFGHIJKLMNOP`, the A2A `-----BEGIN PRIVATE KEY-----` refusal test, a Slack test token).
  - Approach:
    - Documentation Reviewed: `git status` (912 entries), the plan index statuses and the ticked tasks per plan, `.agents/skills/prism-execution/references/release.md` "Rules".
    - Options Considered: one commit per plan, rejected because the plans touch the same files (`config.ts`, the README, the baselines) and cannot be split without hand surgery; one squashed commit, rejected because it hides which track a change belongs to.
    - Chosen Approach: a consolidation branch with track-grouped commits, then a merge into `main`.
    - API Notes and Examples: `git switch -c consolidate/phase-19-and-memory`, the commits, then `git switch main && git merge --no-ff consolidate/phase-19-and-memory`.
    - Files to Create/Edit: the whole working tree; `src/__tests__/provider-live-scenarios.test.ts:253` (stop reason `tool_use` → `tool_calls`, the known typecheck error); `biome format --write` (187 files); and the fixes listed in the notes.
    - References: plan 225 Task 6 notes (clean-tree release practice).
  - Test Cases to Write: none new; the standing suites.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no beyond the executed plans.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-22):
    - **Tree before:** 912 changes on top of `623aeb19`. The complete plans in it were 226–237 and 239, with every task ticked; their index rows still said `planned`, and Task 3 fixes that. The partial plans were 218.3 (12/14) and 218.5 (1/8). The new plans were 218.4, 218.5 and 240. Plan 238 is untouched.
    - **First gate:**
      - typecheck failed on the known `provider-live-scenarios.test.ts:253` (fixed: `tool_calls`);
      - `bun run test` failed 4 of 9 stages;
      - lint and format failed (187 files unformatted, 16 lint findings).
    - **Fixes to reach green** (a background agent, reviewed here):
      - formatting (190 files) and the 16 lint findings: unused imports and variables, `const`, comma operator, unsafe optional chains in tests, a `for…of` in `src/agent-session/create-agent.ts:448`, and `biome-ignore` with a reason for literal `${HOME}` shell text in `packages/tools/coding/src/security/command-rules.ts:31`;
      - `src/testing/prefix-stability-conformance.ts` copies the tail segments as each request is sent, because plan 239 Task 7 clears `session.tailSegments` at run end;
      - `agent-config-validation.test.ts`: the new `tools.concurrency` message, after plan 239 removed the 1–16 cap;
      - `scripts/host-surface-allowlist.json` gains a `phase19` group (`ResolvedRunLimits`, `resolveRunLimits`, `resolveCeilings`, `RunStateBounds`, `runStateBounds`) and drops the stale `HARD_MAX_SESSION_LIST_LIMIT`;
      - the multi-agent saturation benchmark passes `queueTimeoutMs: 0`, because plan 232 queues by default;
      - `scripts/memory-bench/run.test.mjs`: one counter ignores the STM index's `User said:` lines (plan 218.5 fix 1), and one expected request count is now 6, because plan 239's stall axis stops the repeating loop;
      - the host-builder eval solutions and the builder tools pass `guard: "off"`, because plan 233 made the coding quick start ask, and a host with no UI suspends;
      - a narrow `BENCH_NPM_CI` exemption in `scripts/tooling-gate.test.mjs` for the two benchmark installers (plans 218.1 Task 4 and 218.3 Task 10);
      - `scripts/fixtures/e2e-070-host-completeness-journey.mjs` sets a scope, because WM runs only under one (plan 218.3 Task 7);
      - regenerated: the host-builder index, package truth (`docs/release.md`, the phase54 map), the limits inventory, and the host-builder evals' `criteria.lock.json`.
    - **Budgets rebaselined** in `scripts/budgets.json`, each with a dated reason:

      | Budget | Old → new |
      | --- | --- |
      | kernel packed bytes | 1,358,833 → 1,452,303 |
      | kernel unpacked bytes | 4,400,376 → 4,799,583 |
      | kernel files | 373 → 376 |
      | kernel root exports | 1,604 → 1,653 |
      | kernel source lines | 45,076 → 47,303 |
      | export ceilings | prism 1,653; extensions 1,538; hosts 1,058; memory-system 1,152 |
      | non-null assertions | total 2,261 → 2,537; memory session 114 → 232 |

      The kernel ceilings equal the current tree, so later kernel or docs edits need another rebaseline in Task 8.
    - **Final gate:** `bun run typecheck`, `lint` and `format:check` exit 0, and `bun run test` passes all 9 stages.
    - **Left for Task 2 (D6, D10):** the API-level-1 removals against 0.13.1 (including `DEFAULT_MAX_HOLD_REASON_BYTES`), the tooling-gate exemption, the eval solutions' `guard: "off"`, and the non-null growth.
    - **Commits:** on branch `consolidate/phase-19-and-memory`, merged into `main` with `--no-ff`. Nothing is pushed.

- [x] Task 2: Release review and owner decisions (read-only)
  - Acceptance Criteria:
    - Functional:
      - Measure, from the consolidated `main`:
        - **API surface against the published 0.13.1** (`git diff v0.13.1 -- scripts/compat-baseline/`). Classify every removed or changed export as a removal, a rename (name its successor) or a signature change. The removals found while this plan was written include the kernel's `HARD_MAX_SESSION_SEARCH_*`, `DEFAULT_MAX_PENDING_DECISIONS`, `HARD_MAX_PENDING_STEERS`, and `./provider-kit` `readRetryAfterMs`, `withoutStructuredOutput` and `artifactStructuredOutputRequest`.
        - **The full `bun scripts/release.mjs gate`** (it writes and deletes `.types/`). Classify each failure: the range bump (`@arnilo/prism-ai` changed since v0.13.0), compat drift, the kernel budget (`sourceLines` 47,207 against the ceiling 45,076), bundle budgets and the tarball deny list.
        - **Registry state** (`npm view` for the seven names) and the trusted-publisher state of every name to be published. The hosts publisher had expired at 0.13.1.
      - Record the owner's answer to each decision below. Each lists the recommendation first:
        - **D1, the memory bundle's line.**
          - Recommended: graduate `@arnilo/prism-memory-system` to the stable line at **0.14.0** on `latest`. The session tier (STM, session compaction, `recall`, the `memory:*` commands, the ledger records and folds) comes under the API-level-1 promise. `wm.*`, `rehearsal.*`, `ltm.*`, `sleep.*` and `scope.*` stay **experimental config paths** outside the promise, extending today's `EXPERIMENTAL_PATHS` mechanism.
          - Alternative: stay on the prerelease line (`0.14.0-experimental.0`, dist-tag `experimental`) and change only the defaults.
        - **D2, `enabled` default.** Recommended: `true`, so installing the package compacts every session with STM, and `memory:session` still turns it off for one session. Alternative: keep `false`, so a host must opt in per agent or session.
        - **D3, WM.**
          - Recommended: the `wm` component defaults **off**. It runs only with `wm: {}` (and still only under a host scope), with `wm.policy` defaulting to `deterministic` (plan 218.3 Task 12 verdict) and the code kept.
          - `rehearsal` stays off (it already needs `ltm`).
          - Plan 218.5 later decides keep or drop.
        - **D4, the kernel's default compactor** stays deterministic. It makes no model call and has no package name (roadmap §1 "the kernel never names a package"). No alternative is proposed.
        - **D5, versions.**
          - Recommended: `@arnilo/prism` and `@arnilo/prism-hosts` **0.14.0**, and `@arnilo/prism-ai`, `-extensions` and `-tools` **0.14.0**. Phase 19 added features to all three, and one number for one release keeps the story simple. The independent lines stay independent after this release.
          - `@arnilo/prism-memory-system` 0.14.0 (D1).
          - `@arnilo/prism-knowledge` `0.14.0-experimental.0`, with its exact pin on the memory bundle replaced by `^0.14.0`.
          - Alternative: minimal bumps on each independent line (e.g. extensions/tools 0.13.3).
        - **D6, removed kernel and bundle exports against 0.13.1.** API level 1 promises additive minors (`docs/compatibility.md:9-14`). The options:
          - (a) restore each removed name as a `@deprecated` export for 0.14.x, with removal in the next API level (satisfies the plan 058 deprecate gate). Recommended for names hosts may import, such as `./provider-kit` helpers.
          - (b) accept a documented break under level 1, with a migration note and `--allow-break`. Only for `HARD_*` ceilings the owner already chose to delete (plan 239 "host value is the cap"), if the owner confirms they were never meant as host API.
          - (c) move to API level 2. Not recommended: every package's `requires.api` and peer range change.
        - **D7, the paid live check (Task 10):** its scope and token ceiling. Recommended: 6 Session-Bench sessions on the release defaults plus one reference-host live smoke, at most 30M tokens.
        - **D8, LLM compaction's over-window recovery fix** ships in 0.14.0 (Task 5). Recommended: yes, since it becomes the advertised replacement.
        - **D9, scope.** Plan 238 (Node) and plans 218.4 and 218.5 stay out of 0.14.0. Recommended: yes.
        - **D10, consolidation choices to confirm (Task 1 notes):**
          - the `BENCH_NPM_CI` exemption in `scripts/tooling-gate.test.mjs`;
          - the host-builder eval solutions running `toolsCoding({ guard: "off" })`;
          - the removal of `DEFAULT_MAX_HOLD_REASON_BYTES` (deprecated, from `@arnilo/prism-extensions/store-codecs`), which belongs with D6;
          - the non-null budget growth (+276), reduced before the cut or carried as a Further Action.
      - If a measurement invalidates a later task, re-cut the plan. Do not improvise a fix inside it.
    - Performance: n/a.
    - Code Quality: findings cite `file:line`.
    - Security: the registry and trusted-publisher check is read-only; no token is printed.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs:19-61` (release set), `:293-326` (range baseline: newest `v*` tag below the root version), `:476-487` (dist-tag rules), `:389-398` (prerelease bumps);
      - `scripts/release-gates.mjs:472-600`; `scripts/independent-packages.json`; `.github/workflows/release.yml:10,156,217-227`;
      - `docs/release.md:30-59,94-95,151-179`; `docs/compatibility.md:9-14,32-34,163-164`;
      - `roadmap.md:1598-1616` (version table), `:2461-2499,2515`; plan 223 Task 4 (graduation, pre-bundle names); plan 225 Task 6 notes (last release, tag race lessons);
      - `packages/memory/system/src/components.ts:44-56`, `src/session/config.ts:744,769,780`.
    - Options Considered: skipping the review and bumping straight away, rejected because the compat removals against 0.13.1 break the stated promise unless decided.
    - Chosen Approach: measure, then decide, then cut.
    - API Notes and Examples: `git diff v0.13.1 --stat -- scripts/compat-baseline/`; `timeout 900 bun scripts/release.mjs gate`; `npm view @arnilo/prism-memory-system dist-tags`.
    - Files to Create/Edit: this plan's Task 2 notes only.
    - References: the two explorer reports of 2026-11-22, summarized in the notes.
  - Test Cases to Write: none (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (review).
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-22):
    - **Owner decisions:**
      - **D1:** the memory bundle goes to **0.14.0** on the stable line.
      - **D2:** "STM should be turned off at install. Host has to configure". `enabled` stays `false`, and the host sets `enabled: true`. Tasks 4, 6 and 10 are amended to match.
      - **D3:** agreed. WM is off by default, opt-in with `wm: {}`, with `wm.policy` deterministic.
      - **D5:** agreed. Kernel, hosts, ai, extensions, tools and memory at 0.14.0; knowledge at `0.14.0-experimental.0`.
      - **D6:** "Do not restore. As far as I am concerned 0.14.0 is a major release while 0.14.1 is a minor release for now as 1.0.0 is not out yet". Asked how to express that, the owner chose **semver 0.x ranges**:
        - every first-party peer range becomes `^0.14.0` (`>=0.14.0 <0.15.0`);
        - `docs/compatibility.md` says a `0.Y.0` release may break and a `0.Y.Z` release only adds;
        - `KERNEL_API_LEVEL` goes to 2, so a 0.13-era package declaring `requires.api: 1` fails fast with a clear error.

        Task 8 carries this.
      - **D7:** "Do the live check" (Task 10, with the scope and ceiling proposed: 6 sessions plus host smokes, at most 30M tokens).
      - **D10:** reduce the non-null assertions before the release (new Task 8a). The owner left the other two to me. I keep the `BENCH_NPM_CI` exemption: it is narrow, `npm ci` from committed locks, for benchmark installers only. I also keep the eval solutions' `guard: "off"`: the tasks describe hosts with no UI that must run shell, and plan 233's ask guard is right for interactive hosts.
      - **D4, D8 and D9** were not answered separately, so the recommendations in the plan apply: the kernel compactor is unchanged, the LLM compaction recovery fix ships, and 218.4, 218.5 and 238 are out of scope.
    - **Surface against v0.13.1** (names, from `scripts/compat-baseline/` against the `v0.13.1` tag):

      | Bundle | Removed | Added | Removals that are not limit constants |
      | --- | --- | --- | --- |
      | `@arnilo/prism` | 14 | 67 | 3: `./provider-kit` `readRetryAfterMs` (plan 227: replaced by `parseRetryAfterMs`), `withoutStructuredOutput` and `artifactStructuredOutputRequest` (plan 235) |
      | `@arnilo/prism-ai` | 1 | 0 | none (`./litellm LITELLM_SPEND_WAIT_CAP_MS` is a plan 239 limit) |
      | `@arnilo/prism-extensions` | 65 | 89 | `./governance AUDIT_EXPORT_HARD_LIMITS` (plan 239) |
      | `@arnilo/prism-hosts` | 56 | 76 | none |
      | `@arnilo/prism-knowledge` | 22 | 3 | none |
      | `@arnilo/prism-memory-system` | 21 | 15 | 11: the chunk store API (`ChunkStore`, `SqliteChunkStore`, `createSqliteChunkStore`, `MEMORY_CHUNK_STORE_SERVICE`, `MemoryChunkRef` and 6 types; plan 218.3 Task 4) |
      | `@arnilo/prism-tools` | 187 | 15 | none (all `HARD_*`/`DEFAULT_*` limits, mostly `./browser`) |

      Every limit-constant removal is plan 239's "host value is the cap". Each removal is attributed in its plan's notes. Nothing is restored (D6). The migration note lists them by family (Task 9).
    - **`bun scripts/release.mjs gate`:** two failures, both expected.
      - `ranges: @arnilo/prism-ai changed since v0.13.0 … (bump required)`: Task 12's bump.
      - `tarball: @arnilo/prism-memory-system: packedBytes 468015 exceeds bundle budget`: Task 8's rebaseline. The kernel budget passes after Task 1's rebaseline.
    - **Registry** (`npm view … dist-tags`):
      - `@arnilo/prism` and `-hosts` are at 0.13.1, `-ai` at 0.13.0, and `-extensions` and `-tools` at 0.13.2.
      - `-memory-system` and `-knowledge` have both `latest` and `experimental` on `0.13.0-experimental.0`. npm set `latest` on their first publish, so the memory bundle's 0.14.0 on `latest` replaces a prerelease there. The `.1` prereleases in the tree were never published.
      - Trusted-publisher state cannot be read without npm credentials. The owner checks all seven names before Task 12 (hosts had expired at 0.13.1).
    - **No finding invalidates a later task.** Tasks 4, 6, 7, 8 and 10 are amended for D2 and D6, and Task 8a is added for D10.

- [x] Task 3: Close the memory track's open bookkeeping before the cut
  - Acceptance Criteria:
    - Functional:
      - Plan 218.3 Task 13 is executed:
        - plan 218.1 closes (Task 4 closed, Tasks 5–6 dropped into Session-Bench);
        - the LOCA-Bench and Compact-Bench harnesses are kept or removed, with a reason;
        - plan 218 Task 6 is marked `Dropped by plan 218.3/240 (2026-11-22): WM's default is decided by plan 218.5`. Not "by 218.4", because removal is on hold.
      - Plan 218.3 Task 14 is executed against this release's facts: the roadmap and the design record say session memory (STM) is the compaction system a host installs, LLM compaction is the other option, one system per agent, and WM is an experimental opt-in pending plan 218.5. Neither says "WM dropped".
      - `plans/README.md` statuses match the plans. Plans 225–237 and 239 are complete (their rows still say `planned`), 218.3 is complete, and 218.4 and 218.5 are held behind this plan.
      - The memory-track entries in `plans/backlog.md` are reconciled with 218.3's and 218.5's Further Actions.
    - Performance: n/a.
    - Code Quality: the roadmap edits stay inside the memory-track and version sections.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: `plans/218.3-*.md` Tasks 13–14 (`:663`, `:680`) and their amendments; `plans/218.4-*.md:3` (hold); `roadmap.md:613,740,2461-2468`; `docs/_evidence/memory-model/design.md:7,31-38`.
    - Options Considered: leave 218.3 open until 218.5, rejected because the release docs would then contradict the plan index.
    - Chosen Approach: execute 218.3 Tasks 13–14 with the WM wording this release needs.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `plans/218.3-*.md`, `plans/218.1-*.md`, `plans/218-*.md`, `plans/README.md`, `plans/backlog.md`, `roadmap.md`, `docs/_evidence/memory-model/design.md`.
    - References: plan 218.3 Task 12 notes; plan 218.5 header.
  - Test Cases to Write: `bun test --timeout=0 src/__tests__/docs.test.ts` (plan index and roadmap rules) stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `roadmap.md` (memory track).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-22):
    - **Plan 218.3 Tasks 13–14** are executed and ticked; its notes hold the detail.
      - Plan 218.1 is closed at Task 4.
      - The LOCA-Bench and Compact-Bench harnesses are **kept**: no owner removal decision, so the non-destructive option applies.
      - Plan 218 Task 6 is `Dropped by plan 240`, not by 218.4, which is on hold.
      - The roadmap gets one dated amendment bullet in the memory track, plus fixes to the catalog row and the slot-conflict sentence (`:613`, `:740`) and the `Updated:` header. The design record gets an "Amended 2026-11-22" paragraph.
    - **`plans/README.md`:**
      - 225–236 and 239 now read `complete`;
      - 218.3 complete; 218.1 closed at Task 4; 218 closed at Task 5;
      - 218.4 on hold; 218.5 in progress after this plan.
    - **Plan 218.3's plan end:** Compromises filled, Further Actions prioritised, and 7 entries handed to `plans/backlog.md` (P1: LLM compaction recovery, carried by Task 5).
    - `docs.test.ts`: 69 pass.

- [ ] Task 4: The memory bundle's shipped defaults: STM compacts, WM off
  - Acceptance Criteria:
    - Functional:
      - Per D2 and D3: `memorySystem({})` resolves `stm` on, `context.compaction` on, `enabled: false` (unchanged; the host turns it on), and `wm` **off**.
        - `wm: {}` turns WM on, and it still runs only under a host scope.
        - `wm.policy` defaults to `deterministic`.
        - `rehearsal`, `ltm` and `sleep` stay off unless configured.
      - The profiles in the README and `examples/memory-system.ts` are re-cut: "stm" is the default, and the "session" profile that meant STM + WM becomes "stm-wm (experimental)".
      - Per D1, the config stability table marks `wm.*`, `rehearsal.*`, `ltm.*`, `sleep.*` and `scope.*` experimental, and `stability.test.ts` enforces it.
      - Tests:
        - unit tests pin the new defaults;
        - every test or example that relied on WM being on by default sets `wm: {}`;
        - `examples/session-memory.ts`, `memory-system.ts` and `memory-and-wiki.ts` (and their `packages/hosts/host-builder/data/examples` copies) run on the new defaults under the execution gate.
    - Performance: STM's default costs, from the 2026-11-22 replay (`docs/_evidence/memory-bench/218.5/stm-fixes-replay.json`), are stated in the README: about 34 worker calls and 1.9M main-input tokens per 10-task session at W = 32K on the screen models. WM's extra cost (1.27× on the screen) is named as the opt-in's price.
    - Code Quality: the defaults change in `components.ts` and `config.ts` only, with no alias and no second default table. The README's Install section shows `enabled: true` as the way to make STM the compaction.
    - Security: no change; the verbatim record's credential masking stays.
  - Approach:
    - Documentation Reviewed: `packages/memory/system/src/components.ts:44-56` (`wm` follows `stm` today); `src/session/config.ts:744,761,769,780`; README `:49-55,78-90,190-258,318`; `src/ltm/__tests__/stability.test.ts:45,79-104`; `src/session/flush.ts:316-327` (WM gated on scope).
    - Options Considered:
      - WM off only by documentation, rejected: the owner said "WM turned off".
      - Delete WM, rejected: "code not removed", and plan 218.4 waits for 218.5.
    - Chosen Approach: change the component default and the policy default, and keep the code.
    - API Notes and Examples:
      ```ts
      memorySystem({ enabled: true })          // STM compacts every session; no WM, no Rehearsal, no LTM
      memorySystem({ enabled: true, wm: {} })  // experimental: WM under a host scope, deterministic policy
      memorySystem({})                         // installed, off: the kernel default compacts until memory:session turns it on
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/{components.ts,session/config.ts}` and their tests (`__tests__/memory-system.test.ts`, the WM suites that need `wm: {}`, `ltm/__tests__/stability.test.ts`);
      - `packages/memory/system/README.md`, `packages/memory/CHANGELOG.md`;
      - `examples/{session-memory,memory-system,memory-and-wiki}.ts` and their host-builder copies (regenerate with `bun scripts/host-builder-index.mjs`);
      - `scripts/compat-baseline/arnilo__prism-memory-system.txt` (only if a type changes; regenerate and attribute).
    - References: plan 218.3 Task 12 verdict; plan 218.5 Task 1 notes.
  - Test Cases to Write:
    - `memory_system_installs_off_and_enabled_compacts_with_stm_without_wm`
    - `wm_runs_only_when_configured_and_scoped`
    - `wm_policy_defaults_to_deterministic`
    - `experimental_config_paths_cover_wm_rehearsal_ltm_sleep_scope`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (defaults).
    - Docs pages to create/edit: the memory README (defaults, profiles, cost), `packages/memory/CHANGELOG.md`, root `CHANGELOG.md` `## [Unreleased]`.
    - `docs/index.md` update: yes, if the memory entry's scope sentence changes ("STM, WM, rehearsal" → "STM session memory; WM, Rehearsal and LTM opt-in").
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: LLM compaction is a credible opt-in replacement
  - Acceptance Criteria:
    - Functional:
      - **Over-window recovery** (plan 218.3 Further Action, high): after one turn whose input exceeds the window, LLM compaction compacts on the next run instead of returning `context_overflow` on every later run. A test reproduces the old failure.
      - The one-system rule is unchanged: listing both systems fails at `createAgent` (`one-system.test.ts`), and memory's `context.compaction: false` hands the slot to LLM compaction. The error messages name the switch.
      - `docs/slots.md` and `docs/agent.md` describe the two compaction systems, how to choose, and the switch.
        - Today these pages say the `slots` assignment resolves a conflict (`docs/slots.md:207-223`, `roadmap.md:740`, the kit's `pitfalls.md:41-42`), which is stale.
        - The kernel pages carry no plan narrative.
    - Performance: LLM compaction's cost (one model call per compaction) stays stated in its README.
    - Code Quality: the fix lives in `packages/extensions/compaction`. The kernel changes only if the review shows the overflow state is kernel-held, in which case it gets the written proof the reference demands.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: plan 218.3 Further Actions (the overflow finding); `packages/extensions/compaction/src/index.ts:96-106`; `src/compaction.ts:74`; `src/slots/defaults.ts:11`; `docs/slots.md:191-223`.
    - Options Considered: document the limitation, rejected because it is the advertised fallback.
    - Chosen Approach: fix and test it, then correct the docs.
    - API Notes and Examples:
      ```ts
      packages: [memorySystem({ context: { compaction: false } }), compaction({ model: "provider/model" })] // LLM compaction instead of STM
      ```
    - Files to Create/Edit: `packages/extensions/compaction/src/*` and tests, its README, `docs/slots.md`, `docs/agent.md`, `CHANGELOG.md`.
    - References: plan 218.3 Task 2 (one system per agent); memory note "session memory compaction switch".
  - Test Cases to Write:
    - `llm_compaction_recovers_after_an_over_window_turn`
    - `one_compaction_system_error_names_the_switch`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (a recovery behavior).
    - Docs pages to create/edit: `docs/slots.md`, `docs/agent.md`, `packages/extensions/compaction/README.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The reference host and the host-builder kit default to session memory
  - Acceptance Criteria:
    - Functional:
      - **`apps/prism-agent`:**
        - `HostConfig.compaction` defaults to `"session-memory"`, with `"llm"` the opt-in (`src/host/config.ts:39-45`).
        - `memoryProfileFor` passes `enabled: true` and no `wm: {}` (`src/host/memory.ts:19-31`).
        - The coding and research agents list LLM compaction only under `"llm"` (`coding.ts:28-50`, `research.ts:27-58`).
        - orchestrator and external agents get session memory or keep the kernel default, as decided and recorded.
        - `reference_host_default_loads_no_experimental_package` (`conversational-memory.test.ts:52-67`) and `context.test.ts:53` are rewritten for D1: the default loads the now-stable memory bundle and no experimental package. Every scenario stays deterministic on the mock provider.
      - **The kit** (`packages/hosts/host-builder`): `skills/prism-host-builder/SKILL.md:52`, `references/choosing.md:47-66`, `recipes.md:110-113` and `pitfalls.md:41-42` recommend session memory and describe LLM compaction as the replacement. `data/*` is regenerated (`bun scripts/host-builder-index.mjs`), and the host-builder evals' criteria are re-checked.
      - `apps/prism-agent/README.md:24-25,42,51,122,148-153` describes the new default.
    - Performance: the host's default session gains STM worker calls; the README states it and names `compaction: "llm"` as the alternative.
    - Code Quality: the host imports only the public surface (`reference_host_imports_only_public_surface`).
    - Security: no new secrets; the worker model ref follows the host's existing model config.
  - Approach:
    - Documentation Reviewed: `apps/prism-agent/src/host/{config,memory,context-budgets,coding,research,orchestrator,external}.ts`; the kit files above.
    - Options Considered: keep `"llm"` as the host default, rejected because it contradicts "STM fully shipped as the main compaction system".
    - Chosen Approach: flip the default and keep `"llm"` one config value away.
    - API Notes and Examples: `prism-agent --compaction llm` (or `HostConfig.compaction: "llm"`), if the CLI exposes it (`src/cli/args.ts`).
    - Files to Create/Edit: the host files and tests above, `apps/prism-agent/README.md`, the kit files, `data/` regenerated.
    - References: plan 218.3 Task 2 notes (host switch).
  - Test Cases to Write:
    - `reference_host_defaults_to_session_memory_compaction`
    - `reference_host_llm_compaction_is_opt_in`
    - the rewritten default-package test
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (the reference host default).
    - Docs pages to create/edit: `apps/prism-agent/README.md`, the kit references.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: The memory bundle leaves the experimental line (per D1)
  - Acceptance Criteria:
    - Functional:
      - `scripts/independent-packages.json` moves `@arnilo/prism-memory-system` from `experimental` to `packages`.
      - `scripts/experimental-bundles.test.mjs` lists only `@arnilo/prism-knowledge`, at its true version (the test pins `0.13.0-experimental.0` while the tree is at `.1`).
      - `release.mjs`'s dist-tag rules accept the move (no `experimental_version_mismatch` or `stable_version_prerelease`).
      - `@arnilo/prism-knowledge`'s dependency on the memory bundle becomes a range (`packages/knowledge/package.json:48`).
      - The experimental markers are rewritten, so that the memory bundle reads as stable, and LTM, WM, Rehearsal, Sleep and scope as experimental config paths:
        - the memory README banner (`:3-6`) and its "May change in a minor version" section (`:2461-2486`, with the five plan 210 Task 7 holds, which are LTM features);
        - `PRODUCT.md:105,111,117`, `README.md:82-87`, `docs/index.md:63-68,170-171`;
        - `docs/compatibility.md:32-34,163-164`, `docs/release.md` "Experimental packages";
        - the roadmap version table row (`roadmap.md:1607-1609`).
      - Plan 223 Task 4 (graduation) is amended: the memory bundle's session tier graduates here, and its remaining scope is LTM and the knowledge bundle.
    - Performance: n/a.
    - Code Quality: no new version-line mechanism; the existing `packages` list is used.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: `scripts/release.mjs:47-60,389-398,476-524`; `docs/compatibility.md`; `docs/release.md:94-95`; plan 223 Task 4; plan 210 Task 7 holds.
    - Options Considered: graduate LTM too, rejected because its five holds have no measured benefit (plan 210 Task 7).
    - Chosen Approach: the bundle graduates, and its unproven parts are experimental config paths.
    - API Notes and Examples: `"packages": ["@arnilo/prism-ai", "@arnilo/prism-extensions", "@arnilo/prism-tools", "@arnilo/prism-memory-system"]`.
    - Files to Create/Edit: the files above; `scripts/release.test.mjs` / `release-gate.test.mjs` cases for the move.
    - References: plan 224 Task 10 (independent lines); plan 215 decisions (memory experimental at 0.13.0).
  - Test Cases to Write:
    - `memory_system_is_on_the_stable_line`
    - `knowledge_depends_on_a_memory_range`
    - `experimental_bundles_are_only_knowledge`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (the stability promise).
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes (the experimental section).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Public surface against 0.13.1, baselines, budgets and generated truth
  - Acceptance Criteria:
    - Functional:
      - **D6: 0.14.0 is the breaking release** (semver 0.x; owner 2026-11-22). Nothing removed is restored. Instead:
        - `KERNEL_API_LEVEL` becomes 2 (`src/version.ts:12`). Every first-party package subpath declares `requires: { api: 2 }`, and a package declaring `api: 1` is refused at load with the existing API-level error, which names the kernel's level.
        - Every first-party peer range on the kernel becomes `^0.14.0`, and the gate's peer-window check (`scripts/release.mjs:101-107`) enforces `>=0.14.0 <0.15.0`.
        - `docs/compatibility.md` states the pre-1.0 rule: a `0.Y.0` release may break, with a migration note, and a `0.Y.Z` release only adds. The roadmap's version-target row for native packages, which says "a kernel 0.14 or 0.15 needs no package change", is amended to match.
        - The removals are listed by family in `docs/migration.md` (Task 9). `--allow-break` is used with the reason `0.14.0 breaking release (owner D6)`.
        - The `scripts/independent-packages.json` rules and `release.mjs`'s range checks accept independent bundles released at `0.14.0` with the new peer range.
      - Compat baselines are regenerated (`bun scripts/release.mjs gate --update-baseline`). The diff against `v0.13.1` goes in the task note, and each line is attributed to a plan (226–239, 218.3, 218.5, this one).
      - `bun scripts/retired-names.mjs --generate` is run and `retired-names.test.mjs` is green.
      - The root-export freeze (`public-export-contract.test.ts`) is updated deliberately.
      - `scripts/budgets.json` is rebaselined with a reason per changed ceiling: the kernel's `sourceLines`, packed and unpacked bytes, and the bundle budgets, including the memory bundle.
      - `node scripts/package-truth.mjs --emit-docs` and `bun scripts/limits-inventory.mjs --emit-docs` are regenerated.
      - `bun scripts/release.mjs gate` exits 0.
    - Performance: each rebaselined budget states the growth's cause (Phase 19 features, the memory track).
    - Code Quality: freeze literals are set to the new true values with the edit tool, never widened.
    - Security: the tarball deny list stays as is.
  - Approach:
    - Documentation Reviewed: `scripts/release-gates.mjs:319-353,472-600`; `scripts/budgets.json`; plan 225 Task 6 (budget rebaseline precedent).
    - Options Considered: `--allow-break` for everything, rejected because it breaks the level-1 promise without a reason per name.
    - Chosen Approach: per-name handling, as decided.
    - API Notes and Examples: `git diff v0.13.1 -- scripts/compat-baseline/arnilo__prism.txt`.
    - Files to Create/Edit:
      - `src/**` / `packages/**` (restored exports, if D6 (a));
      - `scripts/compat-baseline/*.txt`, `scripts/budgets.json`, `scripts/retired-names.json`;
      - `src/__tests__/public-export-contract.test.ts`;
      - `docs/_evidence/phase54-package-map.md`, `docs/limits.md`.
    - References: `.agents/skills/prism-execution/references/release.md`.
  - Test Cases to Write: the standing gates (`release-gate.test.mjs`, `public-export-contract.test.ts`, `packaging.test.ts`, the plan 058 deprecate gate).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (export surface).
    - Docs pages to create/edit: `docs/migration.md` (accepted breaks); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8a: Reduce the non-null assertions before the release (owner D10)
  - Acceptance Criteria:
    - Functional:
      - The non-null assertion total in `scripts/budgets.json` is back at or under its pre-consolidation value of 2,261, against 2,537 now.
      - The directories that grew most come back first: `packages/memory/system/src/session` (114 → 232), `src` (551 → 598), `packages/extensions/mcp/src` (17 → 34), `packages/extensions/workflows/src` (48 → 54), `packages/hosts/evals/src` (230 → 237).
      - Each `!` is replaced by a narrowing check, a typed helper, or a construction that makes the value non-optional. A test file may use `assert.ok(x)` before use.
      - Behavior is unchanged: the suites of every touched workspace pass.
    - Performance: n/a.
    - Code Quality: no `as` casts that erase types in place of `!`. Where a value is truly guaranteed, a small `required(value, what)` helper that throws a named error is used, once per package rather than per file.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: the non-null budget gate (`performance budget` stage, `scripts/budgets.json` `nonNull`); the per-directory counts from Task 1's notes.
    - Options Considered: raise the budget, rejected by the owner ("reduce before release").
    - Chosen Approach: reduce the largest growth first, directory by directory, keeping each workspace green.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: the source and test files in the directories above, and `scripts/budgets.json` (lowered counts).
    - References: Task 1 notes.
  - Test Cases to Write: none new. The budget gate lowered to the new counts is the proof.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Release docs: roadmap, migration note, CHANGELOG, PRODUCT
  - Acceptance Criteria:
    - Functional:
      - **`roadmap.md`:**
        - the version table gains a 0.14.0 row (kernel and hosts; the stable bundles per D5; the memory bundle stable per D1; knowledge experimental);
        - the Phase 19 row that says Parts B–O ship "in the next release the owner cuts" names 0.14.0;
        - the stale "publish … as 0.14.0" at `:2515` is reconciled.
      - **`docs/migration.md`:** the two `## 0.13.1 → next (unreleased)` sections (`:3,25`) become `## 0.13.x → 0.14.0`. It covers:
        - the compaction default (install the memory bundle for STM; `compaction()` for LLM compaction; one system);
        - WM off by default (`wm: {}`), with `wm.policy` deterministic;
        - the STM verbatim records (`stm.verbatimUserChars`);
        - the accepted breaks from D6;
        - the Phase 19 behavior changes the CHANGELOG lists.
      - **`CHANGELOG.md`:** `## [0.14.0] - <date>` is assembled from `## [Unreleased]`, and each bundle CHANGELOG (`packages/*/CHANGELOG.md`) gets its version section. The memory entries move out of Unreleased.
      - **`PRODUCT.md`, `README.md`, `docs/index.md`:** describe the shipped memory default, with no plan narrative in kernel pages (`docs.test.ts`).
    - Performance: n/a.
    - Code Quality: migration examples are runnable snippets.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: `roadmap.md:1598-1616,2515`; `docs/migration.md:3,25`; `CHANGELOG.md:1,645`; plan 225 Task 6 step 4 (CHANGELOG assembly).
    - Options Considered: a separate `docs/migrate-to-0.14.md`, rejected because `docs/migration.md` already holds the running sections.
    - Chosen Approach: assemble from what landed.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `roadmap.md`, `docs/migration.md`, `CHANGELOG.md`, `packages/*/CHANGELOG.md`, `PRODUCT.md`, `README.md`, `docs/index.md`.
    - References: plan 224 Task 10, plan 225 Task 6.
  - Test Cases to Write: `docs.test.ts` (no plan narrative, index links, the version-literal gate).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: docs only.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes (the memory and compaction sentences).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 10: Paid live check of the release defaults (owner's word, ceiling per D7)
  - Acceptance Criteria:
    - Functional:
      - **Session-Bench sessions on the release defaults.** `memorySystem({ enabled: true })` runs: STM, no WM, verbatim records. The arm is STM-only under rule a1c6df8d's models, with a new rule hash recorded in the gate.
        - No worker fault; no fallback beyond the counted ones.
        - Dependency and task results are no worse than the 2026-11-22 replay on the same sessions, beyond its noise.
        - Tasks with zero tool calls are counted (the replay saw 6, against the screen's 2), and any rise is explained from captured requests.
      - **One live reference-host smoke** with the default (`session-memory`) and one with `compaction: "llm"`: each compacts at least once and finishes. The LLM run includes an over-window turn (the Task 5 fix).
      - Health is watched during the runs, and the run stops on the first anomaly (`feedback-watch-long-runs`).
    - Performance: within the D7 token ceiling, with the spend recorded.
    - Code Quality: scratchpad harnesses only; the evidence holds ids, counts and hashes.
    - Security: keys come from `~/.config/prism/live.env` as refs, and no secret is in the evidence.
  - Approach:
    - Documentation Reviewed: `scripts/memory-bench/session-bench/live.mjs` (`runLiveJob`, the worker-fault rule, usage-limit stop); `docs/_evidence/memory-bench/218.5/stm-fixes-replay.json`.
    - Options Considered: no live check, rejected because the default changes what every host's session does.
    - Chosen Approach: a small, fast, defaults-only check.
    - API Notes and Examples: `systemd-run --user --unit prism-240-live-check bun <scratch>/run.mjs`.
    - Files to Create/Edit: `docs/_evidence/memory-bench/240/release-defaults-check.json`; the gate record.
    - References: plan 218.5 Task 1 notes.
  - Test Cases to Write: none (live).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/_evidence/memory-bench/README.md` row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 11: Release preflight on a clean tree
  - Acceptance Criteria:
    - Functional:
      - From a clean `main` (no untracked or modified files), these pass:
        - `bun run sdk:ready`: typecheck, lint, format check, all tests, coverage, `pack:dry-run`, `release:gate`;
        - `bun scripts/release.mjs pack` (eight tarballs including the kernel, or seven, if knowledge does not move);
        - `bun run security:threat-suites`;
        - `bun scripts/sbom.mjs`.
      - Postgres evidence comes from CI's `integration-postgres` job, as in 0.13.1. The recorder rejects non-TTY local output (plan 225 Task 6 notes).
      - The host-builder `answers in under 50 ms` flake is re-checked.
      - Every name to be published has a live trusted publisher (the hosts one expired at 0.13.1).
    - Performance: budgets pass as rebaselined in Task 8.
    - Code Quality: generated files are current: `host-builder-index`, `package-truth`, `limits-inventory`, `retired-names`.
    - Security: the secret scan over the tarballs passes; `scripts/release-evidence.json` and `scripts/live.env` are never committed.
  - Approach:
    - Documentation Reviewed: `docs/release.md:30-59,151-179`; `.github/workflows/release.yml:27-152`.
    - Options Considered: n/a.
    - Chosen Approach: run CI's order locally, then let CI repeat it.
    - API Notes and Examples: `timeout 5400 bun run sdk:ready`.
    - Files to Create/Edit: none, except fixes the preflight finds, each noted.
    - References: plan 225 Task 6.
  - Test Cases to Write: none (gates).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 12: Bump, tag and publish 0.14.0 (owner-gated), then verify
  - Acceptance Criteria:
    - Functional:
      - Owner confirmation before each outward step: the push to `origin`, each tag, any trusted-publisher renewal.
      - **Versions per D5.** `bun scripts/release.mjs bump` per line, with the kernel bump syncing `src/version.ts`. `KERNEL_API_LEVEL` stays 1 unless D6 chose level 2.
      - **Tags pushed one at a time** (plan 225's lesson: concurrent runs raced, E409): first `v0.14.0` (kernel and hosts), then each `@arnilo/<bundle>@<version>` once the previous run has finished.
      - `release.yml` publishes from the same tarballs under OIDC with provenance; `--resume` is used if a run fails partway.
      - After the publish:
        - `bun run post-publish:smoke` passes;
        - `npm view` shows the expected dist-tags (memory bundle on `latest` if D1 holds; knowledge on `experimental`);
        - the roadmap's version table and `plans/README.md` record the release.
    - Performance: n/a.
    - Code Quality: the bump commit carries only versions, CHANGELOG headers and regenerated indexes.
    - Security: no token in logs; 2FA and publisher actions are done by the owner.
  - Approach:
    - Documentation Reviewed: `scripts/release.mjs` `bump`, `publish` and `--resume`; `release.yml:156-227`; plan 225 Task 6 notes (`:477-487,516`).
    - Options Considered: pushing all tags together, rejected (the 0.13.1 race).
    - Chosen Approach: one tag at a time.
    - API Notes and Examples: `bun scripts/release.mjs bump --lockstep --version 0.14.0`; `git tag v0.14.0 && git push origin v0.14.0` (owner).
    - Files to Create/Edit: `package.json` files, `src/version.ts`, the CHANGELOG headers, `roadmap.md`, `plans/README.md`.
    - References: plan 224 Task 10, plan 225 Task 6.
  - Test Cases to Write: none (publish); `post-publish:smoke` is the proof.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (the release).
    - Docs pages to create/edit: `roadmap.md` (version table), `CHANGELOG.md` dates.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 900 bun run build:core && timeout 900 bun run typecheck`
- `timeout 600 bun run lint && timeout 600 bun run format:check`
- `(cd packages/memory && timeout 900 bun test)`; `(cd packages/extensions && timeout 900 bun test)`; `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 900 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 3000 bun run test`
- `timeout 900 bun scripts/release.mjs gate`
- `timeout 5400 bun run sdk:ready` (Task 11), then CI `release.yml` on the tags (Task 12), then `bun run post-publish:smoke`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
