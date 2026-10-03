# Phase 0 — Reset the offer

## Objectives

- Make the repository's stated direction match the SDK-kernel-and-packages architecture in `roadmap.md` (Phase 0) before any kernel code changes, so every later plan is cut against one contract.
- Restore a green tree: close plan 142 at Task 6 (in-repo callers compile, examples run) and drop its Tasks 7–8, which document a `defineAgent` surface the roadmap withdraws.
- Replace plan 141's freeze pins, which enforce the withdrawn SDK 0.2.0 facade offer, with pins for the new offer.
- Keep `/docs` on the released 0.12.1 contract. No `/docs` API page changes.

## Expected Outcome

- `roadmap.md` and `PRODUCT.md` describe the kernel-and-packages target. They were rewritten before this plan and are not edited here, except for wording fixes a pin forces (none expected).
- `README.md`'s pointer paragraph names the `@arnilo/prism` 1.0 target, links `PRODUCT.md` and `roadmap.md`, and says it is not shipped. It no longer calls `@arnilo/prism-agent-sdk` the supported host path or mentions SDK 0.2.0. The 0.12.1 install lines, quick start, and generated blocks are unchanged.
- Plan 142:
  - Task 6 is done.
  - Tasks 7–8 are recorded as dropped.
  - Its closing sections are filled and its backlog handoff has run.
  - The `@arnilo/prism-code` compat baseline is regenerated for the `assembleAppAgent` return type.
- `src/__tests__/docs.test.ts` no longer contains the three `phase 0 …` tests. Three `offer reset …` tests pin `PRODUCT.md`, the README pointer, and that released `/docs` pages do not absorb the target.
- `plans/README.md`:
  - indexes this plan
  - marks plan 141 superseded
  - marks plan 142 closed at Task 6
- The four `plans/backlog.md` entries sourced from plan 141 are removed. They track follow-ups for the withdrawn 0.2.0 offer.
- Green: `bun run typecheck`, `bun test --timeout=0 src/__tests__/docs.test.ts`, and `node scripts/release.mjs gate`.

This phase changes no JS package API, extension point, or reusable capability. It closes a caller migration already planned in plan 142 and resets docs pins, so there is no primitive-review task. `.agents/skills/project-wiki/` does not exist, so there is no code-wiki task.

There is no version bump, changelog entry, or new example: nothing ships.

Note: the `.agents/skills/` directory is missing from this working tree although its files are tracked. This plan was written against `git show HEAD:.agents/skills/create-plan/SKILL.md` and `…/references/prism-wiki.md`.

## Tasks

- [x] Task 1: Finish plan 142 at Task 6 and close plan 142
  - Acceptance Criteria:
    - Functional: Plan 142 Task 6 is executed exactly as written there, with every one of its acceptance criteria met, plus the amendments below. Its checkbox is `[x]` and it has a Notes block dated on execution.
      - Callers compile against `Agent` / `session()`: `packages/prism-code/src/{acp.ts,tui/index.ts,tui/commands.ts,headless.ts}`, `packages/acp-agent/src/index.ts`, `examples/agent-sdk-coding.ts`, and the prism-code test files.
      - Headless passes `stopHooks: [todoStopHook]` through config.
      - Headless drops its own `createLoadSkillTool` registration.
      - Headless and acp-agent pass `identity: "local-operator"`.
    - Functional: Amendment A (baseline). `assembleAppAgent` is a public `@arnilo/prism-code` export whose return type is `Promise<AgentSdkDefinition>` in `scripts/compat-baseline/arnilo__prism-code.txt:65`. Plan 142 Task 6 did not plan a regeneration for this; this task does.
      - Run `node scripts/release.mjs gate --update-baseline`, then `node scripts/release.mjs gate` exits 0.
      - The task note pastes the baseline diff and states the removals.
        - This plan's removal is the return type `Promise<AgentSdkDefinition>` → `Promise<Agent>` in `arnilo__prism-code.txt`.
        - Also list any change in `arnilo__prism-acp-agent.txt`.
        - Inherited removals: none expected. If any appear, list them with the plan that caused them.
    - Functional: Amendment B (a wrong premise in 142's Task 6 Options). Plan 142 Task 6 says the default duplicate policy "fails closed". Plan 142 Task 1 found the default is `"replace"`, and Task 4 added an explicit collision check that throws `AgentSdkConfigError`.
      - Deleting the headless `load_skill` registration is still required: the SDK check throws when headless also adds the tool.
      - Correct that Options line in plan 142 in the same change.
    - Functional: Plan 142 Tasks 7 and 8 stay `[ ]` and each gains a `Notes` line. The note says: "Dropped by plan 143 (2026-09-30): the roadmap withdrew the `defineAgent` host surface; the session example and `docs/agent-sdk.md` host contract are superseded by roadmap Phase 3." No file those tasks list is created or edited.
    - Functional: Plan 142 `## Compromises Made` and `## Further Actions` are filled per the create-plan rules, then its backlog handoff runs.
      - Entries are appended to `plans/backlog.md`, each ending `Recorded in plans/backlog.md.`
      - An item made moot by the roadmap reset (anything about `defineAgent`, `local-operator`, or the SDK 0.2.0 docs) is not handed off. Instead it is named in the Compromises text as "superseded by roadmap Phase 3".
    - Functional: Plan 142's "Verification (whole plan)" commands pass, except the two tied to dropped tasks (`node examples/agent-sdk-session.ts`, and the docs-test amendment that belongs to Task 8).
      - `bun run typecheck` passes.
      - `examples_demos_run_to_completion_and_emit_no_secret` in `src/__tests__/docs.test.ts` passes. It currently fails on `examples/agent-sdk-coding.ts(26,23): error TS2339: Property 'createSession' does not exist on type 'Agent'`.
    - Functional: Repo-wide retirement sweep for the SDK rename (plan 142 Task 5 criterion, completed here). Grep `scripts/`, `examples/`, `src/`, `docs/`, and every workspace, excluding `dist`.
      - `AgentSdkDefinition`: zero hits outside `plans/`.
      - `.createSession(` on an SDK `Agent`: zero hits. The runtime's own `Agent.createSession` API and its tests are unchanged and not counted.
    - Performance: No per-run change. The todo stop hook moves from a per-run `RunOptions` append to `AgentConfig.stopHooks`, which is the same runtime list. The `session.run` wrapper keeps only the maxCost/`turnPolicy` enrichment. No new I/O.
    - Code Quality: Caller edits are mechanical renames plus the two wrapper deletions plan 142 names. No new prism-code abstraction and no alias for `createSession`. The `(definition as any).*` host bag in `headless.ts` stays as-is: roadmap Phase 12 deletes the whole assembler, so reshaping it now is wasted work.
    - Security: No trust, credential, or approval path changes. `identity: "local-operator"` is set only in the two local-operator hosts (headless and acp-agent), exactly where the 0.12.1 code already synthesized an equivalent local identity (`headless.ts:231-238`).
  - Approach:
    - Documentation Reviewed:
      - `plans/142-Phase-1-One-Import-Runs-An-Agent.md` Task 6 (the task being executed), Task 1 Notes (the duplicate-policy finding), Task 4 Notes (the explicit collision check), and Task 5 Notes (the sweep list).
      - `roadmap.md` Part 3 "In-flight work": finish Task 6 only; drop Tasks 7–8.
      - `scripts/compat-baseline/arnilo__prism-code.txt:65,226` (`assembleAppAgent` signature and re-export).
      - create-plan rule: "Any task that moves, renames, or removes a public symbol/export … must plan the compat-baseline regeneration explicitly" (the plan 083/084 lesson).
    - Options Considered:
      - Revert plan 142 Tasks 2–5 instead of finishing Task 6. Rejected: those renames are carried forward by the roadmap (`session()`, `run` / `stream` / `dispose`, type re-exports, SDK-internal `load_skill`), the tree already depends on them, and reverting touches more files than finishing.
      - Execute Tasks 7–8 too. Rejected: they document and exemplify a surface the roadmap withdraws, and the docs rule forbids documenting an unshipped target in `/docs`.
      - Leave plan 142 open. Rejected: an open plan with dropped tasks keeps stale work visible as "planned".
    - Chosen Approach:
      - Execute 142 Task 6 with the two amendments in the same change, then close 142's paperwork. This is the only code-touching task in this plan, and it runs first so later tasks start green.
    - API Notes and Examples:
      ```ts
      // headless.ts, after Task 6: config field instead of a run wrapper; SDK registers load_skill.
      const definition = await defineAgent({
        ...(agentSdkConfig as AgentSdkConfig),
        identity: "local-operator",
        ...(todoStopHook ? { stopHooks: [todoStopHook] } : {}),
      });
      const session = definition.session(sessionConfig);
      ```
      ```bash
      node scripts/release.mjs gate --update-baseline
      node scripts/release.mjs gate
      ```
    - Files to Create/Edit:
      - Every file in plan 142 Task 6 "Files to Create/Edit": `packages/prism-code/src/headless.ts`, `acp.ts`, `tui/index.ts`, `tui/commands.ts`, `packages/acp-agent/src/index.ts`, `examples/agent-sdk-coding.ts`, and `packages/prism-code/src/__tests__/{headless,commands-utility,flags,skills,todo-continuation}.test.ts`, plus any further prism-code test the typecheck names (the current typecheck also flags `integration.test.ts`, `long-run.test.ts`, and `mcp-integration.test.ts`).
      - `scripts/compat-baseline/arnilo__prism-code.txt` (and `arnilo__prism-acp-agent.txt` if it changes): regenerated by `node scripts/release.mjs gate --update-baseline`.
      - `plans/142-Phase-1-One-Import-Runs-An-Agent.md`: Task 6 checkbox and Notes, the Options correction, dropped notes on Tasks 7–8, Compromises Made, Further Actions.
      - `plans/backlog.md`: plan 142 handoff entries only.
    - References:
      - `packages/prism-code/src/headless.ts:196-211,297-340` (wrappers being removed)
      - `packages/agent-sdk/src/define-agent.ts` (`Agent`, `session()`, `stopHooks`, `load_skill` collision check)
  - Test Cases to Write:
    - No new test files. Update the prism-code tests plan 142 Task 6 names. If `todo-continuation.test.ts` asserted the run wrapper, it now asserts that `agent.config.stopHooks` contains the todo hook.
    - Command checks: `bun run typecheck`; `cd packages/agent-sdk && bun run build && bun run test`; `cd packages/prism-code && bun run build && bun run test` (the todo-continuation and skills suites must be green); `cd packages/acp-agent && bun run build && bun run test`; `bun test --timeout=0 src/__tests__/docs.test.ts -t examples_demos`; `node scripts/release.mjs gate`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new host-facing behavior. `assembleAppAgent`'s return type changes name in the lab package, which the compat baseline records. Prism Code's user-visible behavior is unchanged.
    - Docs pages to create/edit:
      - `none`: `docs/prism-code.md` describes the app, not its assembly. The SDK surface was renamed by plan 142 Task 5, and its docs pass (Task 8) is dropped by this plan because the roadmap replaces that surface.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (2026-09-30):
    - Executed. Plan 142 Task 6 is `[x]`; its callers compile against `Agent`/`session()`, headless drops both wrappers and passes `stopHooks` through config, and the prism-code compat baseline records `assembleAppAgent: Promise<Agent>`.
    - Evidence: `bun run typecheck` green; `packages/agent-sdk` 88 pass/0 fail; `packages/prism-code` 343 pass/0 fail (todo-continuation + skills green); `packages/acp-agent` 20 pass/0 fail; `bun test --timeout=0 src/__tests__/docs.test.ts -t examples_demos` passes; `node scripts/release.mjs gate` exits 0 (14 packages).
    - Baseline: `arnilo__prism-code.txt` `Promise<AgentSdkDefinition>` → `Promise<Agent>`; `arnilo__prism-acp-agent.txt` unchanged; `arnilo__prism-agent-sdk.txt` carries the plan 142 Task 5 rename. Inherited removals: none.
    - Amendment A (baseline regeneration) and Amendment B (Task 6 Options duplicate-policy correction) are done.
    - Deviation: the acceptance line "headless and acp-agent pass `identity: "local-operator"`" is not met as written. Both hosts derive `ownership` from `config.userId`, and the runtime's `assertIdentityMatchesOwnership` requires `identity.userId === ownership.userId`; the SDK literal's fixed `userId: "local-operator"` conflicts with the default `"local"` and throws `IdentityError` on every run. Headless keeps its synthesized verified local identity (which honors `config.userId`); acp-agent is a runtime `createAgent` host with no SDK `defineAgent` call at all. `examples/agent-sdk-coding.ts` uses the literal. Recorded in plan 142 Task 6 Notes and Compromises.
    - Deviation: the sweep's "`AgentSdkDefinition`: zero hits outside `plans/`" holds for code. `/docs/agent-sdk.md` and the two changelogs keep the released 0.1.0 name because Phase 0 forbids `/docs` API edits and history is immutable.
    - Plan 142 Tasks 7–8 carry the dropped Notes; its Compromises Made and Further Actions are filled and handed off to `plans/backlog.md` (four entries).
    - Known red, owned by this plan's Task 3: the full `bun test --timeout=0 src/__tests__/docs.test.ts` run has one failure, `phase 0 offer freeze` ("PRODUCT.md banner missing SDK 0.2.0"), because the rewritten `PRODUCT.md` no longer names the withdrawn offer. The Task 1 command `-t examples_demos` passes; Task 3 replaces the phase-0 pins.

- [x] Task 2: Rewrite the README pointer paragraph for the kernel target
  - Acceptance Criteria:
    - Functional: `README.md` line 10 (the paragraph beginning "The supported host path is `@arnilo/prism-agent-sdk`") is replaced by exactly one paragraph in the same position, between the opening paragraph and `## Current scope`. The paragraph:
      - names the target as `@arnilo/prism` 1.0, an SDK kernel extended by packages
      - links `[PRODUCT.md](PRODUCT.md)` and `[roadmap.md](roadmap.md)`
      - says the design is not shipped
      - points at the 0.12.1 install lines and `[docs/index.md](docs/index.md)` for what works today
    - Functional: After the edit, `README.md`:
      - no longer contains `SDK 0.2.0`, or the phrase "supported host path is `@arnilo/prism-agent-sdk`"
      - contains none of the unshipped target names: `definePackage`, `loadManifest(`, `prism add`, `host.ui`, `agent.inspect()`, `agent.serve`, `local-operator`, `tools.use`, `agent.session()`
      - still contains `from "@arnilo/prism"`, `Install the package that owns each capability`, and `prism init` (the 0.12.1 quick start and install story stay)
    - Functional: Every other README section is byte-identical, including the `<!-- generated:package-truth:inventory begin -->` block and the `@arnilo/prism-agent-sdk` install and table rows (these describe the released 0.12.1 inventory).
    - Performance: One paragraph. No new section, command, or generated content.
    - Code Quality: Relative links resolve from the repo root. No bare `prism` import specifier, no hand-written package count outside generated blocks (existing README guards in `src/__tests__/docs.test.ts`).
    - Security: The paragraph names no secret, token, env value, or install-a-key instruction.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 0 scope ("README.md still links PRODUCT.md and roadmap.md and presents no unshipped API as available") and Rules ("Docs follow releases").
      - `README.md:1-12` (insertion point, current paragraph).
      - `src/__tests__/docs.test.ts` README guards (`prism init`, local links, bare specifier, package-count phrase).
    - Options Considered:
      - Leave the paragraph. Rejected: it tells new readers `@arnilo/prism-agent-sdk` is the supported host path and SDK 0.2.0 is the target. The roadmap retires both.
      - Rewrite the README around the kernel now. Rejected: roadmap Phase 11 owns the README cutover, once 1.0 ships.
    - Chosen Approach:
      - Swap the one paragraph and leave everything else untouched.
    - API Notes and Examples:
      ```markdown
      The target is `@arnilo/prism` 1.0: an SDK kernel for the agent loop, tools, skills, and hooks, extended by installable packages. [PRODUCT.md](PRODUCT.md) explains it and [roadmap.md](roadmap.md) is the build order. That design is not shipped. Until it is, use the 0.12.1 install lines and [docs/index.md](docs/index.md) below.
      ```
    - Files to Create/Edit:
      - `README.md`: that paragraph only.
    - References:
      - `PRODUCT.md` banner (the phrasing the paragraph mirrors)
  - Test Cases to Write:
    - Covered by Task 3 (`offer reset: README pointer`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no. It is a pointer to an unshipped target; the released quick start is unchanged.
    - Docs pages to create/edit:
      - `none`: no `/docs` change. The roadmap forbids `/docs` API edits in Phase 0.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (2026-09-30):
    - Executed. `README.md` line 10 is now exactly the plan's API note: `The target is `@arnilo/prism` 1.0: an SDK kernel for the agent loop, tools, skills, and hooks, extended by installable packages. [PRODUCT.md](PRODUCT.md) explains it and [roadmap.md](roadmap.md) is the build order. That design is not shipped. Until it is, use the 0.12.1 install lines and [docs/index.md](docs/index.md) below.`
    - Only that paragraph changed. The generated `<!-- generated:package-truth:inventory begin -->` block, the `@arnilo/prism-agent-sdk` install and table rows, and every other section are untouched; no `/docs` page or `docs/index.md` change.
    - Evidence: forbidden tokens `SDK 0.2.0`, `supported host path is`, `definePackage`, `loadManifest(`, `prism add`, `host.ui`, `agent.inspect()`, `agent.serve`, `local-operator`, `tools.use`, `agent.session()` are 0 hits; `\bloadManifest\b` is 0 hits; required phrases `(PRODUCT.md)`, `(roadmap.md)`, `not shipped`, `` `@arnilo/prism` 1.0 ``, `from "@arnilo/prism"`, `Install the package that owns each capability`, `prism init` are present. `bun test --timeout=0 src/__tests__/docs.test.ts` = 161 pass / 1 fail, the only failure being `phase 0 offer freeze`, owned by Task 3; `phase 0 README pointer` passes.

- [x] Task 3: Replace the `phase 0 …` docs pins with `offer reset …` pins
  - Acceptance Criteria:
    - Functional: The three tests `phase 0 offer freeze`, `phase 0 README pointer`, and `phase 0 leaves released API pages` (currently `src/__tests__/docs.test.ts:4855-4947`) are deleted, and no assertion from them survives elsewhere.
    - Functional: New `it("offer reset: PRODUCT.md")` fails unless `PRODUCT.md` meets all of the following.
      - Before its first `\n## `, it contains `` `@arnilo/prism` 1.0 ``, `Nothing here is shipped yet`, `(docs/index.md)`, and `(roadmap.md)`.
      - It has these headings in this order: `## What Prism is`, `## How it works`, `## Example`, `## Writing a package`, `## Native packages`, `## Principles`.
      - It contains `createAgent`, `definePackage`, `loadManifest`, `.prism/packages.json`, `prism add`, `agent.inspect()`, and `host: { ui`.
      - It contains each principle lead: `The kernel knows no package names`, `Installed means active`, `Replacing the loop does not bypass the safety gates`, `Fail closed`, `Secrets stay at the edge`, and `Packages are trusted code`.
      - Every `bun add @arnilo/…` line equals `bun add @arnilo/prism`.
      - Every local markdown link resolves.
    - Functional: The same test fails if `PRODUCT.md`:
      - matches `/Phase \d/`
      - contains `plans/` or `sk-`
      - contains any withdrawn-offer token: `@arnilo/prism-agent-sdk`, `defineAgent`, `tools.use`, `local-operator`, `agent.serve`, or `SDK 0.2.0`
    - Functional: New `it("offer reset: README pointer")` fails unless `README.md`:
      - contains `(PRODUCT.md)`, `(roadmap.md)`, `not shipped`, `` `@arnilo/prism` 1.0 ``, `from "@arnilo/prism"`, `Install the package that owns each capability`, and `prism init`
      - contains none of `SDK 0.2.0`, `definePackage`, `host.ui`, `prism add`, `agent.inspect()`, `agent.serve`, `local-operator`, `tools.use`, `agent.session()`
      - does not match `/\bloadManifest\b/`
    - Functional: New `it("offer reset: released pages stay released")` fails if any `docs/**/*.md` file matches `/\bdefinePackage\b/` or `/\bloadManifest\b/`.
      - It excludes `docs/history/` and `docs/_evidence/`, which are historical records, and `docs/next/`, which is the staged target docs (roadmap Part 1 rule "Docs follow releases"). `docs/next/` does not exist yet; the exclusion is for the later plans that create it.
      - The word boundary is required: `docs/resource-loading.md` documents the released `loadManifestResource()`, which a substring check would wrongly flag.
      - The test also fails if `docs/agent-sdk.md` contains `local-operator`, `agent.serve`, or `tools.use`, or if `docs/index.md` mentions `PRODUCT.md` or loses `every plane optional or replaceable` (these carry over from the deleted pin, because `/docs` stays on 0.12.1).
    - Functional: Mutation checks, recorded in the task note. The test must fail on each mutation and pass again once it is reverted:
      - (a) rename `## Principles` in `PRODUCT.md`
      - (b) add `defineAgent` to `PRODUCT.md`
      - (c) add `definePackage` to `docs/agent-sdk.md`
      - (d) remove `(roadmap.md)` from `README.md`
    - Functional: `bun test --timeout=0 src/__tests__/docs.test.ts` passes with 0 failures.
    - Performance: Synchronous file reads inside the existing docs test file. The docs-tree walk reuses the file's existing markdown-listing helper if there is one; otherwise it is one bounded `readdirSync` recursion over `docs/`. No spawn or network.
    - Code Quality:
      - Follow the file's existing `readFileSync` + `assert.ok` style, and name the missing or forbidden phrase in each assertion message.
      - No roadmap pin. `roadmap.md` is the working cut line and changes as phases land, and plan 141 recorded that prose pins cost a test edit per wording change.
      - No second test file or runner.
    - Security: The `sk-` guard stays. The test source contains no secret literal.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/docs.test.ts:4855-4947` (the three pins being replaced) and `:393-401` (plans-index test).
      - `PRODUCT.md` (current headings, banner, and principle leads; the source of every pinned phrase).
      - `roadmap.md` Phase 0 scope: pin `PRODUCT.md` banner, host example, package example, and principles; pin that the README links both docs and presents no unshipped API; pin that `/docs` does not describe the target.
      - `docs/resource-loading.md:12,27,44,62,78` (`loadManifestResource`, the false-positive case).
      - Plan 141 Compromises (prose pins are brittle; hand-kept id lists drift). The new pin keeps no provider or profile id list.
    - Options Considered:
      - Amend the old pins in place. Rejected: nearly every asserted phrase belongs to the withdrawn offer, so an amendment would be a rewrite with a misleading name.
      - Snapshot `PRODUCT.md` whole. Rejected: any wording edit would fail it.
      - Pin `roadmap.md` headings too. Rejected, as explained under Code Quality.
    - Chosen Approach:
      - Three focused `it` blocks with headings, banner, principles, and forbidden tokens, plus one docs-tree guard with word-boundary regexes.
    - API Notes and Examples:
      ```ts
      it("offer reset: released pages stay released", () => {
        for (const file of markdownFilesUnder("docs").filter((f) => !/^docs\/(history|_evidence|next)\//.test(f))) {
          const text = readFileSync(file, "utf8");
          assert.ok(!/\bdefinePackage\b/.test(text), `${file} documents unshipped definePackage`);
          assert.ok(!/\bloadManifest\b/.test(text), `${file} documents unshipped loadManifest`);
        }
      });
      ```
      ```bash
      bun test --timeout=0 src/__tests__/docs.test.ts
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: delete three tests, add three. No production file.
    - References:
      - `PRODUCT.md`, `README.md` after Task 2, `docs/agent-sdk.md`, `docs/index.md`
  - Test Cases to Write:
    - `offer reset: PRODUCT.md`: banner, heading order, API and principle phrases, single install line, local links; no phase numbers, plan links, secret literal, or withdrawn-offer token.
    - `offer reset: README pointer`: kernel-target pointer present; 0.12.1 quick start kept; no withdrawn or unshipped token.
    - `offer reset: released pages stay released`: no `definePackage` / `loadManifest` word in current `/docs`; the carried-over `docs/agent-sdk.md` and `docs/index.md` guards.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no. Test pins only.
    - Docs pages to create/edit:
      - `none`
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (2026-09-30):
    - Executed. Deleted the three `phase 0 …` tests (`src/__tests__/docs.test.ts:4852-4945`) and added `offer reset: PRODUCT.md`, `offer reset: README pointer`, and `offer reset: released pages stay released` in their place. No assertion from the deleted pins survives.
    - `bun test --timeout=0 src/__tests__/docs.test.ts` = 162 pass / 0 fail. `bun run typecheck` green. `git diff --stat -- docs/` is empty; no production file changed.
    - Mutation checks (each failed, then passed again after revert):
      - (a) rename `## Principles` in `PRODUCT.md` → failed. The first cut used `offer.indexOf(heading)`, which still matched the renamed `## PrinciplesX` as a substring and wrongly passed; the heading assertion now compares whole `^## ` lines, so the mutation fails.
      - (b) add `defineAgent` to `PRODUCT.md` → failed.
      - (c) add `definePackage` to `docs/agent-sdk.md` → failed.
      - (d) remove `(roadmap.md)` from `README.md` → failed.
    - Reused the file's existing `markdownFiles("docs")` helper. The docs-tree guard excludes `docs/history/`, `docs/_evidence/`, and `docs/next/`, and uses word boundaries so `loadManifestResource()` in `docs/resource-loading.md` does not false-positive. The `sk-` guard and the `docs/agent-sdk.md` / `docs/index.md` carry-over guards are kept.

- [x] Task 4: Plans index and backlog reflect the reset
  - Acceptance Criteria:
    - Functional: `plans/README.md` changes three rows. No other row is touched.
      - The `143-Phase-0-Reset-The-Offer.md` row (added as `planned` when this plan was created) changes status to `complete (<date>)` once Tasks 1–3 pass.
      - The plan 141 row's status becomes `superseded by 143 (offer reset)`.
      - The plan 142 row's status becomes `closed at Task 6 — Tasks 7–8 dropped (plan 143)`.
    - Functional: `plans/backlog.md` loses the four entries whose `Source` is `plans/141-Phase-0-Freeze-The-Offer.md`: "Freeze is prose-pinned, not type-checked", "Provider, profile, and type id lists are hand-maintained in two places", "Fold PRODUCT.md into the shipped-doc guards when 0.2.0 ships", and "Compile-check the target example once the seam exists".
      - All four follow up on the withdrawn 0.2.0 offer, and the backlog has no status field for retiring entries.
      - The task note lists the removed titles and this reason.
      - Plan 141's own Compromises and Further Actions text stays unchanged as the historical record.
    - Functional: No other backlog entry is removed or edited. Entries sourced from plan 134 (the Agent SDK) stay: `@arnilo/prism-agent-sdk` is not retired until roadmap Phase 11.
    - Functional: `plans index links every active numbered plan` in `src/__tests__/docs.test.ts` passes.
    - Performance: Two markdown files.
    - Code Quality: The row wording follows the index's existing style (a one-line phase summary; status text like the `superseded` rows 076 and 129). No plan numbers or statuses are invented for other plans.
    - Security: None beyond not copying secrets. The entries contain none.
  - Approach:
    - Documentation Reviewed:
      - `plans/README.md` rows 076, 129 (existing `superseded` wording) and 141, 142.
      - `plans/backlog.md:201-227` (the four plan-141 entries).
      - `roadmap.md` Phase 0 scope ("Mark plan 141 superseded", "Move the obsolete backlog entries").
    - Options Considered:
      - Keep the plan-141 backlog entries. Rejected: they would stay live work items against a contract that no longer exists.
      - Add a "retired" field to backlog entries. Rejected: the backlog has no status schema, and one removal does not justify inventing one.
    - Chosen Approach:
      - Update the three index rows, remove the four entries, and record the reason in this task's note.
    - API Notes and Examples:
      ```markdown
      | [143-Phase-0-Reset-The-Offer.md](143-Phase-0-Reset-The-Offer.md) | Roadmap Phase 0 — reset the offer to the SDK kernel and native packages: close plan 142 at Task 6 (green typecheck, prism-code baseline), README pointer to the `@arnilo/prism` 1.0 target, `offer reset` docs pins replace the phase-0 freeze pins, plan 141 superseded. No `/docs` API edits. Not a release cut. | complete (2026-09-30) |
      ```
    - Files to Create/Edit:
      - `plans/README.md`: three rows.
      - `plans/backlog.md`: remove the four plan-141 entries.
    - References:
      - `plans/141-Phase-0-Freeze-The-Offer.md` (Compromises and Further Actions stay as history)
  - Test Cases to Write:
    - Command check: `bun test --timeout=0 src/__tests__/docs.test.ts -t "plans index"` passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `none`
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (2026-09-30):
    - Updated three `plans/README.md` rows: 141 → `superseded by 143 (offer reset)`; 142 → `closed at Task 6 — Tasks 7–8 dropped (plan 143)`; 143 → `complete (2026-09-30)`. No other row touched.
    - Removed the four plan-141 backlog entries: "Freeze is prose-pinned, not type-checked", "Provider, profile, and type id lists are hand-maintained in two places", "Fold PRODUCT.md into the shipped-doc guards when 0.2.0 ships", and "Compile-check the target example once the seam exists". All four follow up on the withdrawn 0.2.0 host offer, and the backlog has no status field for retiring entries. Plan 141's own Compromises and Further Actions text is unchanged as the historical record.
    - No other backlog entry was removed or edited; the plan-134-sourced `@arnilo/prism-agent-sdk` entries stay, because the package is not retired until roadmap Phase 11.
    - `bun test --timeout=0 src/__tests__/docs.test.ts -t "plans index"` passes.
    - Whole-plan verification: `bun run build:core` ok; `bun run typecheck` green; agent-sdk 88 pass/0 fail; prism-code 343 pass/0 fail; acp-agent 20 pass/0 fail; docs test 162 pass/0 fail; `node scripts/release.mjs gate` exits 0 (14 packages, `updated: false`); `git diff --stat -- docs/` empty.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck` (includes `tsc -p examples --noEmit`)
- `cd packages/agent-sdk && bun run build && bun run test`
- `cd packages/prism-code && bun run build && bun run test`
- `cd packages/acp-agent && bun run build && bun run test`
- `bun test --timeout=0 src/__tests__/docs.test.ts` (0 failures)
- `node scripts/release.mjs gate`
- `git diff --stat -- docs/` is empty (no `/docs` change in this phase)

## Compromises Made

- Plan 142 Tasks 7–8 (session example, `docs/agent-sdk.md` host contract) were dropped, not executed. Superseded by roadmap Phase 3: the roadmap withdrew the `defineAgent` host surface those tasks documented.
- The Task 1 acceptance line "headless and acp-agent pass `identity: "local-operator"`" is not met as written. Both hosts keep their `config.userId`-based verified identity because `assertIdentityMatchesOwnership` requires `identity.userId === ownership.userId`. Tracked by the plan-142 backlog entry "Headless and acp-agent keep a synthesized local identity".
- `/docs/agent-sdk.md`, `CHANGELOG.md`, and `packages/agent-sdk/CHANGELOG.md` still name the withdrawn `AgentSdkDefinition`; Phase 0 forbids `/docs` API edits and changelogs are history. Tracked by the plan-142 backlog entry "Retire AgentSdkDefinition from /docs and changelogs when SDK 0.2.0 ships".
- The `offer reset: PRODUCT.md` and `offer reset: README pointer` pins assert prose (`includes` plus whole `^## ` heading lines), not a typed seam. A wording-only edit that keeps the contract fails the pin.

Recorded in plans/backlog.md.

## Further Actions

- When the `@arnilo/prism` 1.0 kernel surface lands, replace the prose `offer reset` pins with a typed or generated check. Priority: P4.

Recorded in plans/backlog.md.
