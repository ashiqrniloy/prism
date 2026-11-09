---
name: create-plan
description: Create and maintain numbered phase and implementation plans in `plans/` for the Prism repo. Every task carries acceptance criteria, an evidence-based approach, tests written first, a docs assessment, and the repo's chores built in (kernel/package placement, compat baselines, retirement sweeps, conformance suites, examples, staged docs, backlog handoff), so executing the plan leaves no debt. Use whenever asked to create, write, update, or maintain a plan, including a roadmap phase plan, implementation plan, task breakdown, or plan document. Executing plan tasks is the prism-execution skill.
---

# Create Plan

A plan turns one roadmap phase, or one self-contained change, into checkable tasks. A plan is good when an executor who follows it literally leaves no debt:

- every moved export has its baseline regeneration
- every retired name has its repo-wide sweep
- every new surface has a test, an example, and docs
- the tree is green after every task

## Workflow

1. **Read the source.**
   - Read the `roadmap.md` phase you are planning (Goal, Why, Scope, Done) and every Part 1–2 section it touches, plus `PRODUCT.md`.
   - The plan implements the roadmap; it does not redesign it.
   - If code reality conflicts with the roadmap, record the conflict as a finding in the review task and stop. Do not improvise around it.
2. **Load the references.** Always read both:
   - [references/prism.md](references/prism.md): placement rules, the phase review task, the task probes, chore checklists by change type, and tooling assumptions.
   - [references/prism-wiki.md](references/prism-wiki.md): where docs go (kernel `/docs` pages, package READMEs, `CHANGELOG.md`), and page structures.
3. **Survey the code with graft before writing approaches.**
   - `graft ask "<scope bullet>" --source` to find the relevant code.
   - `graft callers <symbol> --depth all` for every symbol a task renames, moves, or deletes.
   - Cite `file:line` in each approach.
   - Use the find-docs skill for third-party library or CLI APIs.
4. **Name the file.** Use the next three-digit prefix in `plans/`, as `NNN-Phase-N-<Title>.md` for roadmap phases. Split an oversized phase into `NNN-Phase-N-Part-A-<Title>.md` / `Part-B` with an explicit dependency line.
5. **Draft the tasks.**
   - Start with the phase review task whenever `references/prism.md` §2 requires one.
   - Run every task through the probes in `references/prism.md` §3. Each probe answer becomes an acceptance criterion, a listed file, or a test, or an explicit `n/a — <reason>`.
   - Order the tasks so each one leaves the tree green.
6. **Index the plan.** Add a row to `plans/README.md` with status `planned`. The docs test fails for an unindexed numbered plan.
7. **Run the self-check** below before presenting the plan.

## Required plan structure

```markdown
# <Plan Title>

## Objectives
- <Objective>

## Expected Outcome
- <Observable deliverable or system state after completion>

<One paragraph: which roadmap phase this implements, whether a review task is included (or why not), what does not ship (version bump, publish, /docs), and anything unusual about this plan.>

## Tasks

- [ ] Task N: <title>
  - Acceptance Criteria:
    - Functional: <behavior, including fail-closed cases and the retirement sweep>
    - Performance: <latency/resource/load-cost expectation or explicit non-regression>
    - Code Quality: <placement, typing, no aliases, no speculative abstraction>
    - Security: <trust boundary, secrets, capabilities, what fails closed>
  - Approach:
    - Documentation Reviewed:
      - <roadmap sections, docs pages, code at file:line, third-party docs with versions>
    - Options Considered:
      - <option — why rejected>
    - Chosen Approach:
      - <why this fits>
    - API Notes and Examples:
      ```ts
      <minimal API shape or command>
      ```
    - Files to Create/Edit:
      - `<path>`: <change>   (complete list; mark tentative entries and say why)
    - References:
      - <code paths, decisions, prior plans>
  - Test Cases to Write:
    - <test name>: <what it proves; which break makes it fail>
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: <yes/no and why>
    - Docs pages to create/edit:
      - `<path>`: <change, or `none` with reason>
    - `docs/index.md` update: <yes/no>
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed <date>):   ← written by the executor, not while drafting

## Verification (whole plan)
- <runnable commands, in order>

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
```

## Task writing rules

- Every task is independently checkable (`- [ ]` / `- [x]`) and has all four criteria categories.
- The approach is mandatory and evidence-based. An option without a rejection reason is not an option.
- Write test cases before implementation. Derive them from the criteria, name each test, and say which break makes it fail.
- **Every task leaves `bun run typecheck` and the task's suites green.** A rename updates all of its callers in the same task. Never write "red until Task N": plan 142 left the root typecheck red across four tasks because callers were deferred.
- **A task that moves, renames, or removes a public export must plan the baseline regeneration in that same task:**
  - Name `bun scripts/release.mjs gate --update-baseline` and the `scripts/compat-baseline/` files it rewrites.
  - Require the post-regeneration diff in the task note, with removals attributed to this plan or inherited.
  - This rule exists because plan 083 skipped the regeneration, leaving `release:gate` red for every later plan, and plan 142 missed `assembleAppAgent`'s return type in the prism-code baseline.
- **A task that changes an error contract (code, class, or refusal shape) or retires a name must put the name in the standing sweep.** `bun scripts/retired-names.mjs --generate` picks up removed exports, subpaths, packages, `ERR_*` codes, and `prism` flags from the compat baselines; a removed tool goes in `scripts/retired-tool-names.json`; a name that stays an ordinary word goes in `vocabulary` with a reason. `scripts/retired-names.test.mjs` (`no_retired_name_in_live_tree`, in `bun run test`) then fails on any live use under `src/ packages/ apps/ scripts/ examples/ docs/`. It skips `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, migration guides, tests, and sentences that state the removal. Plan 080 left retired errors asserted in a Postgres test and a script fixture.
- **A new opt-in cost or durability knob states its sizing trade-off** (extra writes, requests, or model calls per unit of work, plus the default that avoids them) in the owning docs page or README, not only in the plan.
- **Every task has a Documentation/Wiki Assessment** per `references/prism-wiki.md`.
- **Scope discipline.** Implement the roadmap phase. Anything beyond it goes to Further Actions, not into a task.
- **Do not fill Compromises Made or Further Actions while drafting** unless a constraint is already known. Do not write `plans/backlog.md` while drafting.

## Self-check before presenting

- [ ] The review task is present, or the header says why the plan changes no contract.
- [ ] Every task answers the `references/prism.md` §3 probes: placement, mechanism, fail-closed, secrets, load cost, retirement, public surface, callers, proof, docs, enforcement rows, reference host impact, cost knobs.
- [ ] No task leaves the tree red; every rename updates its callers in the same task.
- [ ] Every export move plans a baseline regeneration; every retired name or error plans a sweep.
- [ ] Every new package, example, or docs page plans its enforcement-row updates (`references/prism.md` §3 probe 11).
- [ ] `## Verification (whole plan)` lists runnable commands.
- [ ] The plan row exists in `plans/README.md`.

## Plan end (executor runs this; plans leave room for it)

After the whole-plan verification passes, fill `Compromises Made` and `Further Actions`, then hand both off to `plans/backlog.md`:

- Create the backlog file only if there are items. Copy items; do not remove them from the plan.
- If an entry with the same source plan, section, and title already exists, update it in place instead of adding a duplicate.
- After writing, add `Recorded in plans/backlog.md.` to each section.

Entry shape:

- `## <title>` (for a compromise: the follow-up that revisits or undoes it)
- `- Section: Compromises Made` | `Further Actions`
- `- Priority: P1` | `P2` | `P3` | `P4` (P1 highest; assign one if missing and record it in the plan too)
- `- Source: plans/<plan-file>.md`
- Compromises: `- Compromise:` what was done, and `- Implications:` what it costs or risks
- Further Actions: `- What:` the task, and `- Why:` why it is needed

A plan made obsolete by a roadmap change is closed, not deleted:

- Mark its unexecuted tasks `Dropped by plan NNN (<date>): <reason>`.
- Set its `plans/README.md` status to `superseded by NNN` or `closed at Task N`.
- Remove its backlog entries only when they track the withdrawn direction, and name the removed titles in the closing plan's task note.
