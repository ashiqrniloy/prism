# Prism plan requirements — SDK kernel and native packages

`roadmap.md` is the source of truth: Part 1 has the rules, Part 2 the architecture, Part 4 the phases. This file turns them into planning probes. If this file and the roadmap disagree, the roadmap wins; fix this file in the same plan.

## Contents

1. Place the work
2. Phase review task
3. Task probes
4. Chore checklists by change type
5. Tooling assumptions the train must change
6. Plan-level rules

## 1. Place the work

Answer this for every task before writing its approach.

| The change… | Belongs in | Never in |
| --- | --- | --- |
| is required by the default loop, hooks, slots, the package system, the manifest, the model core, the tools/skills/commands registries, the host port, events, or the safety floor | kernel `src/` (`@arnilo/prism`) | a package |
| is a capability an agent may or may not have (tools, memory, store, policy, a vendor, an integration) | a native package `packages/<group>/<name>` | the kernel |
| is vendor wire code | `packages/providers/<vendor>` | the kernel |
| is wire code shared by providers | `@arnilo/prism/provider-kit` | a provider package |
| drives an `Agent` from an external protocol or transport (ACP, AG-UI, MCP server, channels, evals, devtools) | host library `packages/hosts/<name>` | a package or the kernel |
| renders UI or answers `host.ui` | `apps/prism-code` (the lab) | the kernel or a package |

Two rules apply everywhere:

- **The kernel never imports or names a package.** A kernel addition needs written proof that no existing hook, slot, `PackageAPI` member, or `RunController` primitive can express it. The addition must also be generic: named in the roadmap's catalog, or needed by at least two packages.
- **A capability that can be a package is a package.**

## 2. Phase review task

This is Task 1 of every phase plan that adds or changes a kernel contract (hook, slot, primitive, `PackageAPI`, host API, manifest format) or creates or moves a package. It is read-only: no code changes, no new files outside the plan.

The review:

1. **Inventories** the contracts the phase touches: the hooks, slots, `PackageAPI` members, `RunController` primitives, events, and manifest fields. Cite the roadmap section (§2.x) and the current code at `file:line` (0.12 code or already-landed kernel code).
2. **Classifies each roadmap Scope bullet** as *expressible with what exists* or *needs a kernel addition*. For each addition it states the kind, payload, result, combination rule, error policy, and the primitive that fires it.
3. **Verifies each assumption the later tasks make** against source, and records findings that change them. For example, plan 142 Task 1 found the tool registry's duplicate default is `"replace"`, not fail-closed, and that finding rewrote Task 4.
4. **Records a verdict in its Notes.** If a finding invalidates the plan, stop and re-cut it. Never improvise a seam inside a later task.

A plan that changes no contract (docs, lab-only, chores, release) skips the review and says so in the header paragraph.

## 3. Task probes

Ask each probe for every task. Record the answer as an acceptance criterion, a listed file, or a test, or as `n/a — <reason>`.

1. **Placement.** Kernel, package, host library, or lab (§1)? If kernel, where is the written proof?
2. **Mechanism.** Which hook, slot, `PackageAPI` member, primitive, or event does this use?
   - A new hook needs a catalog entry: kind, typed payload and result, combination rule, and error policy.
   - It must fire from a `RunController` primitive, never from the loop.
   - It must be tested from the default loop **and** from a custom loop.
3. **Fail closed.** What does this reject? Name the error class or code for each case: unknown config, slot conflict, missing service, literal secret, throwing gate, `host.ui` answering `unavailable`. Every rejection gets a test.
4. **Secrets.** Every secret-bearing config field accepts refs only (`env:NAME`, `keyring:name`). A test asserts the secret never appears in events, `inspect()`, errors, or persisted entries.
5. **Load cost.** What is imported and when? Heavy dependencies (`pg`, Playwright, Office parsers, NATS, vendor SDKs) are imported only inside their owning package. Where the roadmap names one, add a "not loaded unless listed" test.
6. **Retirement.** Which 0.12 code, config field, export, or error does this replace?
   - Delete it in this task. Add no compatibility alias (roadmap rule).
   - Require a repo-wide grep for the retired names and strings.
7. **Public surface.** Which exports are added, moved, or removed?
   - Regenerate the baseline in this task: `node scripts/release.mjs gate --update-baseline`, with the diff and its attribution in the task note.
   - Update the root-export freeze in `src/__tests__/public-export-contract.test.ts` deliberately.
8. **Callers.** List every caller from `graft callers <symbol> --depth all`, including `packages/prism-code` (later `apps/prism-code`), `packages/acp-agent`, `examples/`, and tests. Update them all in the same task; the tree is green when the task ends.
9. **Proof.**
   - Which named test fails if the logic breaks?
   - Which conformance suite must pass (package, provider, store, loop, tool)?
   - Which example demonstrates it under the execution gate (`examples_demos_run_to_completion_and_emit_no_secret`)?
10. **Docs.** Follow `prism-wiki.md`:
    - kernel pages → `docs/next/`
    - package → its `README.md`
    - released `/docs` stays on 0.12.1 until the publish phase
    - changes go under `## [Unreleased]` in `CHANGELOG.md`
11. **Enforcement rows.** Each new artifact must extend the check that keeps the release checklist self-maintaining (`docs/release-and-install.md`, "Release checklist"):
    - new package → root `workspaces`, `scripts/package-truth.mjs` counts, the `packaging.test.ts` package list, the `scripts/independent-packages.json` decision, and a compat baseline file
    - new example → an `examples/README.md` line and `scripts/e2e-coverage.json`
    - new API page → the `apiPages` list in `src/__tests__/docs.test.ts` (once `/docs` pages exist for it)
12. **Lab impact.** Which `packages/prism-code` module does this make deletable? Delete it in the task when the replacement covers it completely. Otherwise add it to Further Actions, naming the roadmap phase that removes it.
13. **Cost knobs.** An opt-in feature that adds model calls, writes, or latency states its per-unit cost and the default that avoids it, in its README or docs page.

## 4. Chore checklists by change type

Include every applicable line as a criterion, file, or test.

**Kernel contract (hook, slot, primitive, host API, event)**
- Types in `src/` plus the catalog row in the `docs/next/` page.
- Invariant tests: gates fire inside primitives; deny wins; observer throws never fail a run; transform/decide throws fail closed, naming the package and hook; `context.build` never mutates the store.
- The "kernel imports no package" gate stays green, and the kernel gains no runtime dependency.
- The 0.12 mechanism it replaces is deleted (probe 6).

**New native package**
- Layout: `packages/<group>/<name>/{package.json, src/index.ts, src/__tests__/, README.md}`. The default export is `definePackage`, and `"exports": { ".": "./src/index.ts" }`.
- `requires.prism` range; minimal `capabilities`; config as JSON Schema with defaults and ref-only secret fields.
- Package conformance suite from `@arnilo/prism/testing`, plus behavior tests on the mock provider.
- A missing optional key or binary produces `status.note(...)` and no registrations, not a throw.
- README follows the package page structure in `prism-wiki.md`, including a manifest entry example.
- Enforcement rows (probe 11).

**Moving 0.12 code into a package**
- Move the code and its tests; delete the old export and subpath; regenerate the baseline; sweep.
- The released `/docs` page stays untouched; the package README documents the target.
- Name the old family package's remaining surface in Further Actions until roadmap Phase 11 deprecates it.

**Provider package** — provider conformance from `@arnilo/prism/provider-kit`. Must not import a sibling provider. Auth uses `host.ui` (`open-url`, `input`) and the credentials slot, and never opens a browser.

**Store package** — store conformance: branching and fork, package-state entries, suspended-run records, search, title, delete. Its driver loads only in this package.

**Tool package** — each tool declares `effects`. Hard denies go through `tool.call`. Approval is left to `@arnilo/prism-approval`; the tool package does not reimplement it.

**Host library** — uses only the public `@arnilo/prism` API, implements `HostUi` for its protocol, and constructs no agent outside `createAgent`.

**Lab (Prism Code)** — deletes the module its replacement covers, keeps the TUI behavior tests green, and leaves binary and distribution scripts unaffected unless the task says otherwise.

**Release** — only in the publish phase (roadmap Phase 11). Follow `prism-execution/references/release.md`.

## 5. Tooling assumptions the train must change

These gates assume the 0.12 layout. The first plan that breaks an assumption owns updating its gate, in the same task:

| Assumption today | Owner |
| --- | --- |
| Packages are flat `packages/*`: `workspacePackageCounts()` in `scripts/package-truth.mjs` and the explicit root `workspaces` list | the first plan creating `packages/<group>/<name>` (roadmap Phase 2, `hooks-json`) |
| Export targets resolve to built `dist/` with sibling `.d.ts` (`public-export-contract.test.ts`, `packaging.test.ts`) | the same plan, which publishes TypeScript source |
| `docs/index.md` links every `docs/**/*.md` page, and root `files` ships `docs/` | the first plan creating `docs/next/`, which excludes it from both |
| `scripts/independent-packages.json` lists independently versioned packages | each plan creating a publishable package |

## 6. Plan-level rules

- One roadmap phase is one plan, or explicit Part-A/Part-B plans.
- No version bump, publish, or npm deprecation before the publish phase (roadmap Phase 11).
- `## Verification (whole plan)` includes at least: `bun run build:core`, `bun run typecheck`, the affected workspace `build && test`, `bun test --timeout=0 src/__tests__/docs.test.ts`, and `node scripts/release.mjs gate`.
- A plan that withdraws or reshapes earlier planned work also closes that work: dropped-task notes, index status, and a backlog cleanup recorded in a task note (SKILL.md, "Plan end").
