# Phase 12 Part A — Prism Agent scaffold, the research pack, the in-process workers, and the headless entry points

## Objectives

- Review every contract the reference host composes, for both parts of Phase 12, and fix the open decisions before any code lands.
- Ship `@arnilo/prism-tools-research` (`packages/tools/research/`), the 0.13.0 research domain pack: research skills, a source ledger with citation ids, a `cite` tool, and a `run.end` citation check.
- Create Prism Agent (`apps/prism-agent/`, `"private": true`, never published) and a repo gate that proves its `src` imports only `@arnilo/prism`, its public subpaths, and published native packages and host libraries, and that it has no terminal UI dependency.
- Compose the in-process agents: an orchestrator (`delegate`, `workflows`, a SQLite store), a coding worker (`tools-coding`, `approval`, `context-files`, `hooks-json`), and a research worker (`tools-web`, `tools-browser`, `memory-rag`, `tools-research`), with `memory-observational` and `memory-compaction` on both workers.
- Ship the headless entry points: a one-shot run that writes JSONL events with documented exit codes, `resume`, and `serveAcp` for manual interactive testing.
- Open the Phase 12 gap log, which both parts fill.

## Expected Outcome

- `bun test apps/prism-agent` runs offline on the mock provider and proves:
  - the host's `approval` gates the coding worker's tools (a denied `write` never executes; an approved one does)
  - a research report's citations all resolve to ledger entries, and an unresolved citation fails the `run.end` check
  - the one-shot JSONL stream matches a golden file, and each documented exit code is produced by its case
- `src/__tests__/reference-host-boundary.test.ts` fails if `apps/prism-agent/src` imports a 0.12 family package, a deep path into a package, a non-public `@arnilo/prism` subpath, or a terminal UI library, or if `@arnilo/prism/testing` appears outside `src/scenarios/` and tests.
- `packages/tools/research/` passes the package conformance suite and its behavior tests, and `examples/research-ledger.ts` runs under the example execution gate.
- `apps/prism-agent/bin/prism-agent.ts acp` serves the orchestrator over ACP stdio to an ACP-capable editor.
- The gap log below lists every seam Part A needed, with a disposition.

This plan implements roadmap **Phase 12 — Prism Agent, the reference host**, Part A. Part B (plan 173) adds the external, remote, workflow, routed-`HostUi`, and scheduler scenarios, wires the scenarios into `release:gate`, deletes `packages/prism-code`, writes the walkthrough README, and records the Phase 12 Done criteria. **Task 1 is the phase review for both parts**: Phase 12 creates a package (`tools-research`) and may surface kernel seams through the gap log. All of Phases 7–10 and 13–17 are complete in `plans/README.md` (plans 154–171). This plan does not bump versions, publish, deprecate on npm, or edit released `/docs` (`docs/prism-code.md` stays as it is until Phase 11). It writes no TUI (§2.13.3). Unusual: the roadmap requires a gap log "recorded in the plan", so this plan carries a `## Gap log` section after `## Tasks`. The host never carries a workaround for a missing seam: a gap is fixed in the SDK inside the task that finds it (only if Task 1's placement rules allow it), or recorded here and moved to `plans/backlog.md` with a reason.

## Tasks

- [x] Task 1: Phase review — the contracts the reference host composes, the open decisions, and the plan 156 closure (read-only)
  - Acceptance Criteria:
    - Functional: **Inventory** (cite roadmap § and `file:line`) every API the host composes:
      - kernel: `createAgent` (`src/agent-session/create-agent.ts:61`), `loadManifest` (`src/manifest/load.ts:78`), `definePackage` (`src/packages/define.ts:104`), the hook catalog (`src/hooks/types.ts:173-186`), `RunEndDecision` (`src/hooks/types.ts:148-155`), `PackageAPI` (`src/packages/api.ts:76-175`), `createSessionIndex` (`src/agent/sessions.ts:29`), `parseSuspendedRunEntry` (`src/suspended-run.ts:61`), `/testing` `mockProvider` (`src/testing/mock-provider-package.ts:18`), `createScriptedHostUi` (`src/testing/host-ui.ts:24`), `createScriptedCli` (`src/testing/scripted-cli.ts:185`)
      - packages: `delegate` config (`packages/integrations/delegate/src/config.ts`), `workflows` nodes (`packages/integrations/workflows/src/nodes.ts:17,37,59,65`), `startWorkflow` (`packages/integrations/workflows/src/parent-session.ts:66`), `workflowCommand` (`packages/integrations/workflows/src/command.ts:32`), `toolsCoding` (`packages/tools/coding/src/index.ts:240`), `approvalPackage` (`packages/policy/approval/src/index.ts:230`), `contextFiles`, `hooksJson`, `toolsWeb` setup (`packages/tools/web/src/index.ts:90-139`), `toolsBrowser` (`packages/tools/browser/src/index.ts:80-96`), `memoryRag` (`packages/memory/rag/src/index.ts:174`), `memory-observational`, `memory-compaction`, `store-sqlite` (`packages/stores/sqlite/src/persistence.ts:151`)
      - host libraries: `serveAcp` (`packages/hosts/acp/src/serve.ts:22-49`), `serveAgent`/`connectAgent` (`packages/hosts/remote/src/serve.ts:40-96`, `connect.ts:26-52`), `routeHostUi`/`policyDefault`/`createResumeAuthority`/`createScheduler` (`packages/hosts/headless/src/{route.ts:33,authority.ts:11,scheduler/index.ts:45}`), `channelHostUi` (`packages/hosts/channels/src/host-ui.ts:32`), `adapterDriver` (`packages/drivers/process/src/driver.ts:33`)
    - Functional: **Classify each roadmap Scope bullet** as *expressible with what exists* or *needs an addition*. For an addition, state its placement (§1 of `.agents/skills/create-plan/references/prism.md`). A kernel addition needs the written proof that no hook, slot, `PackageAPI` member, or primitive expresses it, and must be generic (catalog-named, or needed by two packages). Each addition becomes a gap-log row.
    - Functional: **Decide** the open points (recommended answers below; record the decision, and amend Tasks 2–6 here and plan 173 in place):
      - (a) **What "published packages" means for the boundary gate.** Recommended: allowed specifiers are `@arnilo/prism`; the root `exports` subpaths `/manifest`, `/driver-kit`, and `/testing` (and its `/testing/*` conformance subpaths); and every non-private manifest under `packages/<group>/<name>`. Rejected: `/provider-kit` (for provider packages), the 0.12 `/node/*` subpaths, and the flat 0.12 manifests slated for npm deprecation in Phase 11 (`@arnilo/prism-core`, `@arnilo/prism-coding-tools`, `@arnilo/prism-agent-sdk`, `@arnilo/prism-code`). Do not derive the reject list from `PRISM_FAMILY` (`scripts/package-truth.mjs:20`): it also names `@arnilo/prism-channels`, a Phase 10 host library the host uses. Only package roots or their declared `exports` subpaths are allowed; deep paths (`@arnilo/prism-x/src/...`) are rejected. `@arnilo/prism/testing` is allowed only under `src/scenarios/` and `__tests__/`. Node and Bun builtins are allowed. Confirm whether `@arnilo/prism-memory-core` (`packages/memory/core`) is a native package or 0.12 residue.
      - (b) **Workspace and package-truth handling for `apps/*`.** `computePackageTruth` expands the root `workspaces` (`scripts/package-truth.mjs:131-140`), so adding `apps/*` would count the host as a package; `loadRelease` scans only `packages/` (`scripts/release.mjs:19-49`). Recommended: add `apps/*` to root `workspaces` (Bun needs it to link workspace packages), and make `computePackageTruth` and `workspaceShape` skip manifests with `"private": true`, with a test.
      - (c) **Offline web for the research worker.** `toolsWeb` calls fixed vendor origins with no origin seam (`packages/tools/web/src/index.ts:101-133`). Recommended: run the scenarios on the `obscura` backend with a scripted executable fixture under `apps/prism-agent/src/scenarios/fixtures/` that implements the obscura CLI fetch contract (`packages/tools/web/src/obscura/cli.ts:60-120`), so `web_fetch` runs through the real package. Rejected: stubbing `globalThis.fetch` (a host workaround) and a host-registered fake `web_fetch` (bypasses the package). If the obscura CLI contract cannot be scripted, record a gap.
      - (d) **`tools-browser` offline.** Without `playwright-core` the package registers nothing and writes a `warn` status note (`packages/tools/browser/src/index.ts:80-96`). Recommended: list it on the research worker, assert the status note in the scenario, and do not install a browser in CI.
      - (e) **`memory-rag` offline embeddings.** Recommended: `mockProvider({ embeddings })` (`src/testing/mock-provider-package.ts:10-26`) with a deterministic embeddings fixture, in scenarios only.
      - (f) **How the orchestrator agent reaches the workers.** `delegate` children inherit the parent's packages and are not existing `Agent`s (`packages/integrations/delegate/src/config.ts`); `workflows` exposes host commands (`workflowCommand`), not a tool. Decide whether the orchestrator starts the Part B workflow through a host-registered command, a host tool package that calls `startWorkflow` (host code, allowed when it carries no SDK logic), or whether a "workflow as a tool" seam is missing from `prism-workflows` (a gap). Recommended: `delegate` for ad-hoc sub-tasks on the orchestrator's own packages, and `workflowCommand` registered by a small host package for the graph; a gap only if the model cannot invoke the graph without the host reimplementing workflow logic.
      - (g) **How the citation check "fails".** `RunEndDecision` only offers `continue` (`src/hooks/types.ts:148-155`); a throwing decide hook is the fail-closed deny path, not a verdict. Recommended, package-only: on an unresolved citation, `run.end` continues once with a repair reason listing the unresolved ids (bounded by `maxRepairs`, default 1). If citations are still unresolved, the package records the verdict `failed` in session state, emits `research.citations.unresolved`, and exposes it through the `research.verify` command; the host's one-shot maps a failed verdict to a documented exit code. Rejected: a kernel `RunEndDecision.fail` (only one package needs it, so it fails the two-package rule; log it as a gap if a second consumer appears), and throwing from `run.end`.
      - (h) **Where the scenarios run in `release:gate`.** `runGates` runs no tests (`scripts/release-gates.mjs:257`); `release:gate` is `release-skip-manifest && check-client-neutrality && release.mjs gate` (root `package.json`). Recommended for plan 173: append `bun run --filter @arnilo/prism-agent test` to the `release:gate` script and pin it in `scripts/release-gate.test.mjs`.
      - (i) **Prism Code deletion scope** (for plan 173): the 50 non-plan references found by `rg -l "prism-code"` (the root `build` script, `workspaces`, `scripts/build-prism-code-binaries*.mjs`, `scripts/e2e-prism-code-*.test.mjs`, `scripts/lib/{prism-code-checks,pty-harness}.mjs`, `scripts/prism-code-install-smoke.mjs`, `.github/workflows/{prism-code-binaries,coding-journey,live-matrix,release,npm-deprecate}.yml`, `install.sh`, `examples/prism-code-headless.ts`, the compat baseline, budgets, coverage, e2e coverage, live matrix, package truth, freeze manifest, and four `src/__tests__` files). Recommended: delete everything whose input is the deleted source; keep `docs/prism-code.md` (released 0.4.1 page) and the `npm-deprecate.yml` entry Phase 11 needs; decide whether `install.sh` (downloads released binaries) stays until Phase 11.
      - (j) **The docs index link.** The roadmap says `apps/prism-agent/README.md` is "linked from the docs index as a guide", but `prism-wiki.md` says `docs/index.md` is always `no` during the train. The roadmap wins: plan 173 links it and adds the carve-out to `.agents/skills/create-plan/references/prism-wiki.md` in the same task. Confirm the link target is outside `docs/`, so the target-token scans do not apply.
      - (k) **JSONL format.** Decide the line shape (`AgentEvent` unchanged, one per line, plus a final `{"type":"prism-agent.exit","code":N}` line), how the stream is redacted (events already pass kernel redaction; confirm no extra host redaction is needed, or record a gap), and the exit codes: `0` completed, `1` run failed, `2` usage or config error, `3` suspended awaiting a decision, `4` research citation check failed.
      - (l) **Inherited instability.** Plan 171's backlog rows "Establish reliable headless scheduler test timing" and "Diagnose headless scheduler timeout failures" and plan 170's "De-flake" rows affect plan 173's two-process scenarios. Record whether they block Part B.
    - Functional: **Close plan 156.** Its `plans/README.md` row links a file that was never committed. Set its status to `superseded by 172 (never drafted; Phase 12 re-scoped 2026-10-10)`, and rewrite the `plans/backlog.md` `Why:` line that names plan 156 (around line 605) to point at plans 172–173. Name the edit in this task's note.
    - Functional: Record the failing-test baseline: `bun run typecheck`, `src/__tests__/docs.test.ts`, `src/__tests__/host-surface-gate.test.ts`, the workspaces the host composes, and `bun scripts/release.mjs gate` (currently blocked by `PRISM_TEST_POSTGRES_URL`, per plan 171). Compare with plan 171's close.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut. Never improvise a seam inside a later task.
    - Performance: n/a — read-only.
    - Code Quality: Every finding cites its span.
    - Security: Confirm that each worker's secret-bearing config (web `apiKey`, RAG embeddings, MCP) accepts refs only, that the scenarios need no real secret, and that `approval` is listed on every agent whose tools have durable effects.
  - Approach:
    - Documentation Reviewed:
      - roadmap §1.4, §2.13 (all), Phase 12, Phase 11, Order; `PRODUCT.md`
      - plans 154–171 (Notes, Compromises, Further Actions); `plans/backlog.md`
      - the code listed in the inventory criterion
    - Options Considered:
      - Separate reviews per part. Rejected: Part B composes the same contracts, and plans 170–171 show a single review plus an entry check works.
      - Skip the review because Phase 12 adds no kernel contract by design. Rejected: it creates a package, and the gap log may add seams.
    - Chosen Approach:
      - One read-only review that inventories, classifies, decides (a)–(l), closes plan 156, and records a baseline.
    - API Notes and Examples:
      ```bash
      graft callers createAgent --depth 2
      graft skeleton packages/tools/web/src/obscura/cli.ts
      rg -l "prism-code" --glob '!plans/**' --glob '!docs/history/**' --glob '!docs/_evidence/**' --glob '!**/dist/**' --glob '!graft/**' .
      ```
    - Files to Create/Edit:
      - `plans/172-Phase-12-Part-A-Reference-Host-Scaffold-Research-Pack-And-Workers.md`: Notes, amendments, gap-log rows.
      - `plans/173-Phase-12-Part-B-Orchestration-Scenarios-Release-Gate-And-Prism-Code-Retirement.md`: amendments only.
      - `plans/README.md`: plan 156 status.
      - `plans/backlog.md`: the plan 156 `Why:` line.
    - References:
      - plan 170 Task 1 (review covering two parts); plan 142 Task 1 (findings that rewrite later tasks)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Verdict: plan stands. No re-cut. No kernel addition. Gap log stays empty.** Every Phase 12 Scope bullet is expressible with what exists. Later tasks are amended below and in plan 173 so they do not copy stale samples (`store:`, `loop:`, a model-invoked workflow, a research worker without `approval`).
    - **Inventory** (roadmap §2.13, Phase 12). Cited spans that drifted are corrected here; the acceptance list stays as the search key.
      - Kernel: `createAgent` `src/agent-session/create-agent.ts:61`. `AgentConfig.store` is gone and throws `TypeError` (`:67-68`); the store is `slots.store` or a store package (`src/contracts-core/agent.ts:110`, `docs/next/agent.md:126-130`). `model` is required unless the loop declares `usesModel: false` (`src/contracts-core/agent.ts:59-66`). `loadManifest` `src/manifest/load.ts:78` (not used; see (f)). `definePackage` `src/packages/define.ts:104` (callable). Hook catalog `src/hooks/types.ts:173-186`. `RunEndDecision` `src/hooks/types.ts:148-155` (`continue` only; first continue wins). `PackageAPI` `src/packages/api.ts:75-171` (`tools`, `skills.addDir`, `hooks`, `state.session`/`log`, `events`, `status`, `commands`, `credentials.resolve`, `models.embeddings`). `createSessionIndex` `src/agent/sessions.ts:29`; `Agent.sessions` already wraps the resolved store (`create-agent.ts:151`); `list({ workflowRunId })` is a store filter (`src/contracts-core/session.ts:105`, `src/session-stores.ts:606`). `parseSuspendedRunEntry` `src/suspended-run.ts:61`. `session.resume` `src/agent-session/session.ts:542`. `mockProvider` `src/testing/mock-provider-package.ts:18` (`embeddings` at `:10`). `createScriptedHostUi` `src/testing/host-ui.ts:24`. `createScriptedCli` `src/testing/scripted-cli.ts:185`.
      - Packages: `delegate` config `packages/integrations/delegate/src/config.ts:7-34` (default export, `packages/integrations/delegate/src/index.ts:50`). Children inherit named parent packages, not sibling agents (`runtime.ts:84-106`), and get a memory store (`runtime.ts:106`). `agentNode`/`fanOut`/`gateNode`/`humanGate` `packages/integrations/workflows/src/nodes.ts:17,37,59,65`. `startWorkflow` `parent-session.ts:66`. `workflowCommand` `command.ts:32` (host command, not a tool). `toolsCoding` `packages/tools/coding/src/index.ts:240`. `approvalPackage` `packages/policy/approval/src/index.ts:230` (`decideApproval` asks on `execute`/`network`/`external`, and on `write` unless mode `edits` and inside roots; empty or read-only effects allow — `packages/policy/approval/src/decide.ts:6-26`). `contextFiles` `packages/context/files/src/index.ts:44`. `hooksJson` `packages/integrations/hooks-json/src/index.ts:150`. `toolsWeb` setup `packages/tools/web/src/index.ts:90-139`; `apiKey` ref-only `packages/tools/web/src/config.ts:59-63`. `toolsBrowser` missing `playwright-core` notes and returns `packages/tools/browser/src/index.ts:80-88`. `memoryRag` `packages/memory/rag/src/index.ts:174`; embeddings are a `ModelRef` or a service, postgres `connection` and reranker `apiKey` are refs (`packages/memory/rag/src/config.ts:21-34,113-114`). `memory-observational` and `memory-compaction` are default exports only (`packages/memory/observational/src/index.ts:156`, `packages/memory/compaction/src/index.ts:76`), callable as `definition(config)`. `sqliteStore` `packages/stores/sqlite/src/index.ts:91` (not `persistence.ts:151`; that constructor is a public root export for a second handle). Host must not pass `store:`.
      - Host libraries: `serveAcp` `packages/hosts/acp/src/serve.ts:49` (options `:22-29`, `stream` for tests). `serveAgent` `packages/hosts/remote/src/serve.ts:90` (options `:40-49`). `connectAgent` `packages/hosts/remote/src/connect.ts:48` (options `:28-38`). `routeHostUi` `packages/hosts/headless/src/route.ts:33`. `policyDefault` `packages/hosts/headless/src/policy.ts:11` (cannot approve). `createResumeAuthority` `packages/hosts/headless/src/authority.ts:11`. `createScheduler` `packages/hosts/headless/src/scheduler/index.ts:45`. `channelHostUi` `packages/hosts/channels/src/host-ui.ts:32`. `adapterDriver` `packages/drivers/process/src/driver.ts:33`; the host lists `processDriver(adapter)` (`driver.ts:66`, reexported `src/index.ts:2`), not `loop:`. Working composition is `examples/build-workflow.ts:104-113` (`sqliteStore` + `processDriver` + `packageConfig`, `createProfiles` first because a missing lease throws `profile_invalid` at `driver.ts:109`). Driver loops declare `usesModel: false` (`src/driver-kit/define.ts:187`).
    - **Scope classification** (roadmap Phase 12 Scope). All *expressible with what exists*. `tools-research` is a new package on `PackageAPI` (`tool.result`, `run.end`, `state`, `events`, `commands`, `status`, `skills.addDir`), not a kernel addition. Placement proof for a kernel `RunEndDecision.fail`: only this package needs a failed verdict, so it fails the two-package rule (`.agents/skills/create-plan/references/prism.md` §1). No gap row until a second consumer appears.
    - **Decisions (a)–(l):**
      - (a) Allow `@arnilo/prism`; root subpaths `/manifest`, `/driver-kit`, `/testing` and `/testing/*`; every non-private `packages/<group>/<name>` root and its declared `exports` subpaths. Reject `/provider-kit`, `/node/*`, and the flat 0.12 manifests (`@arnilo/prism-core`, `@arnilo/prism-coding-tools`, `@arnilo/prism-agent-sdk`, `@arnilo/prism-code`). Do not derive the reject list from `PRISM_FAMILY` (`scripts/package-truth.mjs:20`): it includes `@arnilo/prism-channels`. Deep paths rejected. `@arnilo/prism/testing` only under `src/scenarios/` and `__tests__/`. Node and Bun builtins allowed. `@arnilo/prism-memory-core` is a native shared library (roadmap §2.9, no `definePackage`, `publishConfig.access: public`), not 0.12 residue. It stays on the allow-list. The host has no reason to import it.
      - (b) Add `apps/*` to root `workspaces`. `computePackageTruth` and `workspaceShape` skip `"private": true`. Also skip private in `measureExportCounts` (`scripts/budget-gates.mjs:197`) or the budget gate fails with no ceiling. Do not skip inside `expandWorkspaceDirs`: typecheck and `run-all-tests` must see the app. App `package.json` omits `exports` so `scripts/e2e-coverage-gate.mjs:44-46` skips it. `loadRelease` already scans only `packages/` (`scripts/release.mjs:19-49`).
      - (c) Obscura fixture is scriptable. No gap. `obscura.binary` must be an absolute executable (`packages/tools/web/src/obscura/process.ts:18-28`). `web_fetch` spawns `fetch <url> --dump markdown` and treats stdout as markdown (`packages/tools/web/src/obscura/web.ts:117-124`). Exit non-zero fails the tool. The plan's `cli.ts:60-120` cite is the spawn helper, not a fetch contract.
      - (d) List `tools-browser`. Assert the warn status note. Do not install a browser in CI.
      - (e) `mockProvider({ embeddings })` in scenarios only.
      - (f) `delegate` for ad-hoc sub-tasks on the orchestrator's own packages. The graph is host code (§2.13.2), started by `agent.commands.run` on a host-registered `workflowCommand`. Commands are not model-visible (`docs/next/packages.md:210-211`). No workflow-as-tool gap. Do not use `loadManifest` for scenarios or the bin; pass factories in code. A `research-brief` child is not the research worker: `inherit` names parent packages (`required`, may be `[]`), and the child store is memory, not the shared SQLite file.
      - (g) Package-only, as written in Task 2. Unresolved citation: one `continue` (default `maxRepairs` 1, hard max 3), then verdict `failed` in session state, event `research.citations.unresolved`, command `research.verify`. Host maps that verdict to exit `4`. No throw from `run.end`. No kernel `fail`.
      - (h) Append `bun run --filter @arnilo/prism-agent test` to `release:gate` and pin it in `scripts/release-gate.test.mjs`. No new CI job: `.github/workflows/release.yml` already runs `bun run test` and `release:gate`. After (b), `run-all-tests` includes the app via `expandWorkspaceDirs`. Do not edit `docs/release-and-install.md` during the train (released page; `definePackage`/`loadManifest` scan at `src/__tests__/docs.test.ts:5233-5237`). Checklist line is a Phase 11 further action.
      - (i) Delete `packages/prism-code/` and every file whose input is that source: root `workspaces` entry and the `build` filter; `scripts/build-prism-code-binaries.mjs` + test; `scripts/e2e-prism-code-{live,long-run,tui}.test.mjs`; `scripts/lib/{prism-code-checks,pty-harness}.mjs` (pty-harness callers are only those e2e scripts and `prism-code-checks.mjs`); `scripts/prism-code-install-smoke.mjs`; `.github/workflows/prism-code-binaries.yml`; prism-code steps in `release.yml`, `coding-journey.yml`, `live-matrix.yml`; `examples/prism-code-headless.ts` and its README/tsconfig/e2e-coverage rows; compat baseline; rows in `package-truth.mjs`/`json`, `independent-packages.json`, `budgets.json`, `coverage-thresholds.json`, `live-matrix.json`, `live.env.example`, `phase24-freeze-manifest.json`, `phase54-package-map.mjs`, `post-publish-smoke.mjs` (`--prism-code` flag), `run-all-tests.mjs`, `phase24-truth.test.mjs`, `version-literal-gate.test.mjs`; `src/__tests__/{docs,packaging,release,install-smoke}.test.ts` assertions that read the deleted source (keep `docs/prism-code.md` pins); comment/fixture mentions in `packages/credentials/keyring`, `packages/providers/openai`, `packages/tools/coding`; `bun.lock` and `package-lock.json`. Keep `docs/prism-code.md`, its `docs/index.md` link, `npm-deprecate.yml`, `CHANGELOG.md` history, `roadmap.md`, and released pages that only mention the name (`docs/coding-security.md`, `docs/agent-loops.md`, `docs/release-and-install.md`, `docs/live-testing.md`). Keep `install.sh` and `scripts/install-sh.test.mjs` until Phase 11 (they download the published binary; they do not import the deleted source). `.github/codeql/codeql-config.yml` matches `prism-code` only in the name `prism-codeql`; do not touch it. Root `README.md`: fix a broken link only.
      - (j) Roadmap wins. Plan 173 links `../apps/prism-agent/README.md` from `docs/index.md`. The target is outside `docs/`, so the released-page token scan does not read the README. The index sentence itself is scanned: it must not contain `definePackage` or `loadManifest` (`docs.test.ts:5233-5237`). `index links point to existing local markdown files` joins against `docs/`, so the `../apps/...` href resolves (`docs.test.ts:292-300`). Add the carve-out to `prism-wiki.md` in the same task.
      - (k) One `AgentEvent` per line, unchanged (`JSON.stringify` + `\n`). Trailer `{"type":"prism-agent.exit","code":N}` is host-only, not an `AgentEvent`. No extra host redaction: subscribers already see `redactAgentEvent` (`src/agent-session/session.ts:847`, `src/redaction.ts:37`). Precedence: `2` usage/config (including `createAgent` rejection) > `3` suspended > `1` run failed > `4` citation verdict `failed` on a completed research run (`research.verify`) > `0`. A planted secret must be absent from the stream and stderr; that test proves kernel redaction, it does not add a host redactor.
      - (l) Does not block Part B. Plan 171 rows "Establish reliable headless scheduler test timing" and "Diagnose headless scheduler timeout failures" are parallel-suite flakes in `@arnilo/prism-headless`; the isolated rerun passed. Plan 173 Task 6 uses the fake clock and its own test. Land the timing fix only if that scenario flakes. Plan 170's "De-flake the unknown_request_fails conformance leg" is the adapter conformance harness, not the two-process remote path. It does not block Task 3 unless that task runs the flaky leg.
    - **Security.** Web `apiKey` and RAG secret fields are refs only. Scenarios use the obscura fixture (no key) and `mockProvider({ embeddings })` (no key). MCP is not composed. Its `env` string branch accepts literals (`packages/integrations/mcp/src/config.ts:68-79`); headers and `{ ref }` are ref-only. Do not add MCP on a string env. `approval` on the coding worker (write/execute). Also on the research worker: `browser_act` is `network`+`write`, `browser_evaluate` is `execute`+`network` (`packages/tools/browser/src/tools.ts:142-143,237,367`). CI registers neither (no playwright), but a local install must not run them ungated. Default mode `ask`. Rules allow `web_fetch`, `web_search`, `web_extract`, `rag_search`, `cite`. Do not put `tools-research` and `hooks-json` on the same agent (`run.end` first-continue-wins; coding's `todo` already uses `run.end`).
    - **Baseline** (compare plan 171 Task 8): `bun run typecheck` exit 0. `src/__tests__/docs.test.ts` 145 pass / 25 fail. `src/__tests__/host-surface-gate.test.ts` 3 pass / 1 fail (six inherited MCP-server violations, none new). `bun scripts/release.mjs gate` exit 1 before gates: `PRISM_TEST_POSTGRES_URL` unset. Same as plan 171's close. Host-composed workspaces all exist and are public: delegate, workflows, store-sqlite, tools-coding, approval, context-files, hooks-json, tools-web, tools-browser, memory-rag, memory-observational, memory-compaction, acp, remote, headless, channels, driver-process.
    - **Plan 156 closure:** `plans/156-Phase-12-Prism-Code-On-The-SDK.md` is not on disk. `plans/README.md` row set to `superseded by 172 (never drafted; Phase 12 re-scoped 2026-10-10)`. `plans/backlog.md` "Phase 12 lab residue" `Why:` now points at plans 172–173.

- [x] Task 2: `@arnilo/prism-tools-research` — research skills, the source ledger, `cite`, and the `run.end` citation check
  - Acceptance Criteria:
    - Functional: `packages/tools/research/` exists with `package.json` (`"exports": { ".": "./src/index.ts" }`, `peerDependencies` on `@arnilo/prism`, `requires.prism` matching sibling packages), `src/index.ts` (default export `definePackage`, plus `toolsResearch(config)`), `src/__tests__/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `tsconfig.json`.
    - Functional: **Skills.** Four bundled `SKILL.md` skills (`research-scoping`, `source-triage`, `research-synthesis`, `research-report`), registered through `prism.skills`, progressive by default. The report skill instructs the model to cite with `[[cite:<id>]]` markers produced by `cite`.
    - Functional: **Source ledger.** A `tool.result` transform observes results of the tools listed in `config.sourceTools` (default `["web_fetch", "web_search", "web_extract", "browser_observe", "rag_search"]`; listing a tool that is never registered is allowed and noted once with `status.note("info", ...)`). For each source URL or document id in a result, it appends a ledger entry `{ id, url | docId, title?, tool, toolCallId, fetchedAt }` to per-session package state. Ids are stable per session (`S1`, `S2`, …; the same URL reuses its id). The transform returns the result unchanged except for an appended line `ledger: S<n>` per new source, so the model can cite it.
    - Functional: **`cite` tool.** `cite({ id, quote? })` returns a `[[cite:<id>]]` marker when `id` is in the ledger and an error result `unknown_source` when not. It declares `effects: []` (read-only).
    - Functional: **`run.end` check.** At the natural end, it parses `[[cite:<id>]]` markers from the last assistant message:
      - every marker resolves → verdict `passed`, no continuation
      - a marker does not resolve and repairs remain → `continue` with a reason that lists the unresolved ids (bounded by `maxRepairs`, default 1, hard max 3)
      - still unresolved after the bound → verdict `failed`, recorded in session state, and the package event `research.citations.unresolved` with `{ unresolved: string[] }`
      - a report with no markers and `requireCitations: true` (default `false`) counts as unresolved
      - The `research.verify` command returns `{ verdict, unresolved, ledgerSize }` for a session (Task 1 decision (g)).
    - Functional: **Fail closed.** Unknown config keys and out-of-range `maxRepairs` are rejected by the kernel's config validation; a ledger at `limits.maxSources` (default 500, hard max 5,000) stops recording and writes one `warn` status note, never throws.
    - Functional: Enforcement rows (probe 11): root `workspaces` already globs `packages/tools/*` (confirm, no edit); `scripts/package-truth.mjs` role row and counts; `src/__tests__/packaging.test.ts` row; the `scripts/independent-packages.json` lockstep decision; `scripts/compat-baseline/arnilo__prism-tools-research.txt` via `bun scripts/release.mjs gate --update-baseline` (or the `runGates` compatibility leg if the Postgres preflight still blocks, as plan 171 Task 2 did), with the diff in the task note; `examples/README.md` line and `scripts/e2e-coverage.json` row for the example.
    - Performance: No extra model calls by default. Each repair adds one model turn per run, bounded by `maxRepairs` (default 1); the README states this and that `maxRepairs: 0` avoids it (probe 13). The ledger adds one package-state write per new source.
    - Code Quality: Imports only `@arnilo/prism`. Does not import `tools-web`, `tools-browser`, or `memory-rag`: it reads tool results by tool name. No speculative abstraction (no pluggable citation syntaxes).
    - Security: Ledger entries store URL, title, tool name, and ids only, never result bodies or tool arguments. URLs are stored after stripping userinfo and query parameters named in `config.redactQuery` (default `["key", "token", "api_key", "access_token", "sig", "signature"]`). A test asserts a credential-bearing URL never appears in state, events, or `inspect()`.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.13.5, §2.9; `src/hooks/types.ts:148-186`; `src/packages/api.ts:118-175` (`state`, `events`, `status`, `commands`)
      - `packages/tools/web/src/tools.ts:9-32` (tool names and result shapes); `packages/memory/rag/src/tool.ts` (`rag_search` result shape)
      - `packages/tools/coding/src/index.ts:169` and `packages/integrations/hooks-json/src/compile.ts:398` (existing `run.end` users)
    - Options Considered:
      - Wrap `web_fetch` with an `around` `tool.execute` hook. Rejected: `tool.result` is the transform built for reading results, and an around hook would hide the original execution from other packages.
      - Ask the model to call `cite` for every fetch (no ledger hook). Rejected: the roadmap requires that every fetched source is recorded, whether the model cites it or not.
      - A kernel `RunEndDecision.fail`. Rejected per Task 1 (g).
    - Chosen Approach:
      - A `tool.result` ledger, a read-only `cite` tool, and a bounded `run.end` repair-then-verdict check, all in one package on public `PackageAPI` members.
    - API Notes and Examples:
      ```ts
      import toolsResearch from "@arnilo/prism-tools-research";
      const agent = await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsWeb({ backend: "obscura" }), toolsResearch({ maxRepairs: 1, requireCitations: true })],
      });
      await agent.commands.run("research.verify", {}, { session });
      // → { verdict: "passed", unresolved: [], ledgerSize: 3 }
      ```
    - Files to Create/Edit:
      - `packages/tools/research/{package.json,tsconfig.json,bunfig.toml,README.md,CHANGELOG.md,LICENSE}`: new.
      - `packages/tools/research/src/{index.ts,config.ts,ledger.ts,check.ts,urls.ts}`: new. `cite`, `verify`, and the caps live in `index.ts`, `check.ts`, and `config.ts` (no extra files).
      - `packages/tools/research/skills/{research-scoping,source-triage,research-synthesis,research-report}/SKILL.md`: new.
      - `packages/tools/research/src/__tests__/{package.test.ts,ledger.test.ts,check.test.ts}`: new.
      - `examples/research-ledger.ts`: new — mock provider fetches two sources, cites one, and verifies; a second run cites an unknown id and fails the check.
      - `examples/README.md`, `scripts/e2e-coverage.json`: rows.
      - `scripts/package-truth.mjs`, `src/__tests__/packaging.test.ts`, `scripts/independent-packages.json`: rows.
      - `scripts/compat-baseline/arnilo__prism-tools-research.txt`: new.
      - `bun.lock`: workspace entry.
      - `CHANGELOG.md`: `## [Unreleased]` line.
    - References:
      - plan 171 Task 2 (scaffold rows); plan 155 (tools-web/browser package patterns)
  - Test Cases to Write:
    - `research_package_conformance`: the `/testing` package conformance suite passes. Fails on an undeclared capability or a setup throw.
    - `ledger_records_every_fetched_source`: two `web_fetch` results and one repeated URL produce `S1`, `S2`, and reuse `S1`. Fails if a fetch is not recorded or ids are unstable.
    - `ledger_ignores_unlisted_tools`: a `write` result adds nothing. Fails if the transform matches every tool.
    - `cite_unknown_source_is_an_error_result`: fails if `cite` returns a marker for an id not in the ledger.
    - `run_end_passes_when_all_citations_resolve`: no continuation, verdict `passed`.
    - `run_end_repairs_once_then_fails`: an unresolved id causes one continuation with the id in the reason, then verdict `failed` and one `research.citations.unresolved` event. Fails if the bound is ignored or the verdict is not recorded.
    - `run_end_check_on_custom_loop`: the same check fires from a custom `LoopStrategy` that calls `RunController.end` (probe 2). Fails if the check depends on the default loop.
    - `ledger_strips_credentials_from_urls`: `https://u:p@x.test/a?token=SECRET` is stored as `https://x.test/a`; `SECRET` is absent from state, events, and `inspect()`.
    - `ledger_cap_notes_once`: at `maxSources`, recording stops with one `warn` note.
    - `unknown_config_key_rejected`: fails if config validation accepts an unknown key.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new native package.
    - Docs pages to create/edit:
      - `packages/tools/research/README.md`: package page structure, including the manifest entry, the configuration table, the hooks it registers (`tool.result`, `run.end`), the `research.citations.unresolved` event, the `research.verify` command, and the repair cost.
      - `CHANGELOG.md`: `## [Unreleased]` entry.
    - `docs/index.md` update: no — package READMEs are linked in Phase 11.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped** `@arnilo/prism-tools-research` (lockstep `0.12.1`). Default export plus `toolsResearch(config)`. Capabilities: `session-state` only. Imports only `@arnilo/prism`.
    - **Ledger.** `tool.result` reads named fields of the listed tools (`url`, `results[].url`, `urls[]`, `hits`/`citations` `sourceId`). It does not read bodies or arguments. Same redacted URL reuses `S1`, `S2`, …. Userinfo and `redactQuery` params are stripped; non-http(s) URLs are dropped. At `maxSources`, recording stops and one `warn` note is written. A configured tool that is never registered gets one `info` note on the first hook, not at setup (`tools.list` throws during setup).
    - **Model-visible line.** The kernel's `toToolResultMessage` keeps `value` and drops text content when `value` is set (`src/input.ts:322-334`). The line is appended to content and also set as `value.ledger`, or the model never sees the id. Task 4 scenarios should assert `ledger: S<n>` on the tool result value, not only on text content.
    - **Check.** `run.end` reads the last assistant text. Unresolved markers continue while `repairs < maxRepairs`, then verdict `failed` plus `research.citations.unresolved` via `context.emit` (session stream, not `agent.subscribe`). No markers and `requireCitations: false` is `passed`. No markers and `requireCitations: true` is unresolved id `<no-citations>`. `research.verify` with no session returns `pending` and does not throw (package conformance treats an uncoded throw as not fail-closed).
    - **Kernel cap.** `limits.maxContinuations` (default 1) can drop a continue. Then the verdict stays `pending`, not `failed`. Host must set that ceiling at least as high as `maxRepairs`. No gap row: the package bound and the kernel bound are both host config.
    - **Files.** `cite.ts`, `verify.ts`, and `limits.ts` were not created. The tool, command, and caps live in `index.ts`, `check.ts`, and `config.ts`.
    - **Enforcement.** Workspaces glob already covered `packages/tools/*`. `PACKAGE_NOTES` row added. `expandWorkspaceDirs` now skips a glob hit with no `package.json` (`packages/memory/src` is residue; Bun already ignores it). That skip is not the private-manifest skip Task 3 still owes. `bun scripts/package-truth.mjs --emit-docs` regenerated the inventory blocks (they were stale at 39 packages) and `scripts/package-truth.json` (publishable 64 → 65). Packaging list count 64 → 65. Lockstep comment in `scripts/independent-packages.json`. `scripts/e2e-coverage.json` row. Example `examples/research-ledger.ts` exits 0.
    - **Baseline.** `bun scripts/release.mjs gate --update-baseline` still blocked by unset `PRISM_TEST_POSTGRES_URL`. Ran `runGates({ release: loadRelease(), version: "0.12.1", updateBaseline: true, packageName: "@arnilo/prism-tools-research" })`, then reran without update: both returned `{ packages: 65 }` and did not throw. This does not satisfy Postgres release evidence. New file `scripts/compat-baseline/arnilo__prism-tools-research.txt`, 21 lines, all additions, no removals. Public entry is `default` and `toolsResearch`. The other 19 names are scanner-only module exports (`redactUrl`, `sourcesIn`, `recordSources`, `ledgerLine`, `citationDecision`, `citationIds`, `citeMarker`, `lastAssistantText`, `unresolvedIds`, `withLedgerLine`, the config constants/schema, `EMPTY_STATE`, `NO_CITATIONS`). No retirement sweep: nothing was renamed or removed.
    - **Checks.** Package tests 12 pass. Package `tsc` exit 0. `tsc -p examples` exit 0. Packaging rows for this package pass, including the four `SKILL.md` files in the tarball. Host-surface gate still 3 pass / 1 fail, the inherited MCP violations, none in this package. `e2e-coverage` real-repo failures are pre-existing missing suites, not this row.
    - **Gap log.** No row. No kernel change.

- [x] Task 3: `apps/prism-agent` scaffold, the workspace and package-truth handling, and the reference-host boundary gate
  - Acceptance Criteria:
    - Functional: `apps/prism-agent/` exists with `package.json` (`"name": "@arnilo/prism-agent"`, `"private": true`, `"type": "module"`, dependencies only on `@arnilo/prism` and the native packages and host libraries it composes, `scripts.test` and `scripts.typecheck` following sibling packages), `tsconfig.json`, `bunfig.toml`, `bin/prism-agent.ts` (a stub that prints usage and exits `2`), `src/index.ts`, and `src/__tests__/`.
    - Functional: Root `workspaces` gains `apps/*`. `computePackageTruth` and `workspaceShape` in `scripts/package-truth.mjs` skip `"private": true` manifests (Task 1 decision (b)); `measureExportCounts` in `scripts/budget-gates.mjs` skips them too (no budget ceiling for the app). `expandWorkspaceDirs` already skips a directory with no `package.json` (Task 2); it still must not skip private manifests, so typecheck and `run-all-tests` see the app. `release.mjs` already scans only `packages/`. The root `typecheck` script covers the app through `--workspaces`. The app `package.json` omits `exports` so `e2e-coverage-gate` skips it.
    - Functional: `src/__tests__/reference-host-boundary.test.ts` scans every `.ts` file under `apps/prism-agent/src` and `apps/prism-agent/bin` (static `import`/`export ... from`, dynamic `import("…")` with a literal, and `require`) and fails on:
      - a specifier outside the Task 1 decision (a) allow-list (a flat 0.12 manifest such as `@arnilo/prism-core`, `@arnilo/prism-code`, `@arnilo/prism/provider-kit`, `@arnilo/prism/node/*`, an unknown package)
      - a deep path into any package
      - `@arnilo/prism/testing` outside `src/scenarios/` and `__tests__/`
      - a non-literal dynamic import (cannot be proven)
      - a relative import that leaves `apps/prism-agent/`
      - any terminal UI library in `apps/prism-agent/package.json` (`@opentui/*`, `@mariozechner/pi-tui`, `ink`, `blessed`, `neo-blessed`, `terminal-kit`)
      - The allow-list of package names is computed from the non-private `packages/<group>/<name>` manifests minus the explicit Task 1 (a) reject list, not hand-listed, so a new native package is allowed without editing the test.
    - Functional: `scripts/package-truth.mjs` and `src/__tests__/packaging.test.ts` exclude the private app; no compat baseline, no `independent-packages.json` entry (it is never published).
    - Performance: The boundary test reads only `apps/prism-agent/{src,bin}`; it runs in the root docs/test tier in well under a second.
    - Code Quality: The gate reuses the specifier-scanning approach of `src/__tests__/host-surface-gate.test.ts:53-151` (copy the small scanner into the new test; do not export test internals). No speculative config.
    - Security: The gate fails closed on anything it cannot classify (non-literal dynamic import). The app has `"private": true`, so `npm publish` refuses it; a test asserts the flag.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.13.3 (rules), Phase 12 Done; `scripts/package-truth.mjs:100-140`; `scripts/release.mjs:19-49`; `src/__tests__/host-surface-gate.test.ts`; `scripts/host-surface-allowlist.json`
    - Options Considered:
      - Extend the host-surface gate to `apps/`. Rejected: that gate allows only `@arnilo/prism` named imports for host libraries; the reference host is allowed to import native packages, so its rule is different.
      - Keep `apps/*` out of `workspaces` and use relative paths. Rejected: relative imports into `packages/` are exactly what the gate forbids, and Bun needs the workspace to resolve `@arnilo/prism-*`.
    - Chosen Approach:
      - A private workspace app, package-truth skipping private manifests, and a dedicated boundary test whose allow-list is derived from package truth.
    - API Notes and Examples:
      ```jsonc
      // apps/prism-agent/package.json
      { "name": "@arnilo/prism-agent", "private": true, "type": "module",
        "bin": { "prism-agent": "./bin/prism-agent.ts" },
        "dependencies": { "@arnilo/prism": "file:../..", "@arnilo/prism-tools-research": "workspace:*" } }
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/{package.json,tsconfig.json,bunfig.toml}`: new.
      - `apps/prism-agent/bin/prism-agent.ts`, `apps/prism-agent/src/index.ts`: new (stub).
      - `apps/prism-agent/src/__tests__/smoke.test.ts`: new (usage exit code `2`).
      - `src/__tests__/reference-host-boundary.test.ts`: new.
      - `package.json`: `workspaces` gains `apps/*`.
      - `scripts/package-truth.mjs`: skip private manifests; `scripts/package-truth.json` if regenerated.
      - `src/__tests__/packaging.test.ts`: assert the app is excluded.
      - `bun.lock`: workspace entry.
    - References:
      - plan 170 Task 1 A1 (host-surface gate allow-list pattern)
  - Test Cases to Write:
    - `reference_host_imports_only_public_surface`: passes on the scaffold. Seeded-violation cases (temporary fixture files under a scratch copy, not in the app) prove each rejection: family package, `@arnilo/prism-code`, `/provider-kit`, deep path, `/testing` outside scenarios, non-literal dynamic import, relative escape.
    - `reference_host_has_no_terminal_ui_dependency`: fails if any listed TUI package appears in the app manifest.
    - `reference_host_is_private`: fails if `"private": true` is removed.
    - `package_truth_skips_private_workspaces`: fails if `@arnilo/prism-agent` appears in package-truth counts.
    - `prism_agent_usage_exits_2`: the stub prints usage and exits `2`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — a private app and a repo gate.
    - Docs pages to create/edit:
      - `apps/prism-agent/README.md`: a stub heading and one paragraph naming its purpose (testing and proof, never an API); plan 173 Task 9 writes the walkthrough.
      - `CHANGELOG.md`: `## [Unreleased]` line for the reference host and gate.
    - `docs/index.md` update: no — plan 173 Task 9.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped** private `@arnilo/prism-agent` at `apps/prism-agent`. Stub bin prints usage and exits 2. `src/index.ts` exports `referenceHost` only. No `exports` field. Root workspaces gained `apps/*`.
    - **Root dep.** `workspace:*` cannot name `@arnilo/prism`: the root is not a workspace member (`bun install` error `Workspace dependency "@arnilo/prism" not found`). The app depends on `@arnilo/prism` with `file:../..`. Native packages use `workspace:*`. Task 4 must keep that split.
    - **Private skip.** `publishableWorkspaceDirs` filters `private: true` after `expandWorkspaceDirs`. Used by `computePackageTruth`, `measureExportCounts`, `buildPackageMap`, `release-skip-manifest` workspace list, and the truth/packaging tests that equate a dir list to publishable counts. `workspaceShape` skips private too. `expandWorkspaceDirs` still returns the app, so `run-all-tests` and `bun run --workspaces typecheck` see it. Counts stayed 65 publishable / 64 workspace. No `package-truth.json` regen. No compat baseline. No `independent-packages.json` row.
    - **Gate.** `src/__tests__/reference-host-boundary.test.ts` derives the package allow-list from non-private `packages/<group>/<name>` minus `@arnilo/prism-core`, `@arnilo/prism-coding-tools`, `@arnilo/prism-agent-sdk`, `@arnilo/prism-code`. Kernel subpaths allowed: exact `/manifest`, `/driver-kit`, and `/testing` plus `/testing/*` only under `scenarios` or `__tests__`. Node and `bun:` builtins allowed. Non-literal `import(` / `require(` fails. Seeded scratch files prove each rejection. Real scaffold scan is empty.
    - **Lock.** `bun install` wrote `apps/prism-agent` and again duplicated `@arnilo/prism-tools-coding/@arnilo/prism-core` keys (same Bun bug as Task 2). Duplicates removed. `lockfile agrees` passes. `@arnilo/prism-evals` cache ENOENT is pre-existing and did not block the lock write.
    - **Checks.** Boundary 4 pass. App test 1 pass. `bun run typecheck` exit 0, including the app through `--workspaces`. Truth counts and phase54 manifest count unchanged. Budget export-ceiling failures (`governance`, `mcp`, `tools-work`, `tools-coding`, `channels`) are pre-existing growth, not this app. The kernel test imports `package-truth.mjs` with the same `@ts-expect-error` as `release.test.ts`.
    - **Gap log.** No row.

- [x] Task 4: The in-process agents — orchestrator, coding worker, and research worker — with approval and citation scenarios
  - Acceptance Criteria:
    - Functional: `apps/prism-agent/src/host/` composes, with `createAgent` and public package factories only:
      - `orchestrator`: `delegate` (one `research-brief` child with `inherit: []`; it is not the research worker and uses delegate's memory store, Task 1 (f)), `workflows` (default export), `sqliteStore({ path })` — never `AgentConfig.store`
      - `coding`: `tools-coding` (workspace root from host config), `approval` (mode from host config; default asks for every durable effect), `context-files`, `hooks-json` (reads `<workspace>/.prism/hooks.json` when present)
      - `research`: `tools-web` (backend from host config), `tools-browser`, `memory-rag` (embeddings from host config), `toolsResearch()` (default export), and `approval` (mode `ask`; rules allow `web_fetch`/`web_search`/`web_extract`/`rag_search`/`cite`; `browser_act` and `browser_evaluate` stay ask — Task 1 security). Without playwright, `browser_observe` is not registered and tools-research writes one `info` note; that note is expected. Set `limits.maxContinuations` at least to `maxRepairs` (both default 1) or a repair is dropped and the verdict stays `pending`.
      - both workers: `memory-observational` and `memory-compaction`
      - all agents share one SQLite file from host config (`sqliteStore({ path })` on each). `createSessionIndex(createSqlitePersistence({ filename }))` from `@arnilo/prism-store-sqlite` finds every session in that file. Delegate children are not in that file (Task 1 (f)).
      - `HostConfig` is a typed object loaded from `prism-agent.json` (or passed in code by scenarios) that holds model refs, credential refs, paths, and modes. It holds no package option the package does not own: package config is passed through each package's factory.
    - Functional: The composition fails closed through the SDK, never through host checks: a literal secret in host config is passed as-is and rejected by the package's ref-only validation; a missing optional key or binary (`playwright-core`, the obscura binary) leaves a status note and no registrations. The host maps a `createAgent` rejection to exit code `2` with the SDK's error message.
    - Functional: `src/scenarios/` holds the offline scenarios and their fixtures (mock provider scripts, the obscura fixture from Task 1 (c), the embeddings fixture from (e), a temporary git workspace). Scenarios built in this task:
      - `approval-gates-coding`: the mock model asks to `write` a file; the scripted `HostUi` denies, and the file does not exist and `tool.call` recorded a deny; a second run approves and the file is written.
      - `research-citations`: the research worker fetches two sources through `web_fetch` on the obscura fixture, writes a report citing both, and `research.verify` returns `passed`; a second session cites an unknown id, repairs once, and ends `failed`.
      - `browser-unavailable`: the research worker's `status` notes include the `tools-browser` warning and no `browser_*` tool is registered.
    - Functional: Gap discipline: any seam the composition needs and the SDK lacks is recorded as a gap-log row and handled per its disposition before the task closes. The host contains no workaround (no `as any`, no reaching into package internals, no reimplemented package logic).
    - Performance: Agents are created lazily per entry point; the one-shot path creates only the agent it runs. No heavy dependency is imported at host load: `tools-browser` loads `playwright-core` only inside its own setup, and the scenario asserts it was not resolved.
    - Code Quality: One module per agent (`orchestrator.ts`, `coding.ts`, `research.ts`), a `config.ts` for `HostConfig`, and a `store.ts`. No shared base class or factory abstraction beyond what three agents need.
    - Security: Credentials are refs (`env:`, `keyring:`) in `HostConfig`; scenarios use no real secret. A test asserts that a planted `env:` value never appears in events, `inspect()`, errors, or the SQLite file. `approval` is on the coding worker and the research worker (Task 1: browser tools declare `write` and `execute`).
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.13.2–2.13.3, Phase 12 "The host"; `examples/headless-host.ts`, `examples/remote-agent.ts`, `examples/build-workflow.ts` (composition patterns on public APIs)
      - each package README listed in Task 1's inventory
    - Options Considered:
      - Load the package set from a manifest with `loadManifest`. Rejected for scenarios and the bin (Task 1 (f)): pass factories in code.
      - One shared `createAgent` with all packages. Rejected: the roadmap names separate workers, and `origin` attribution per worker needs separate agents.
    - Chosen Approach:
      - Three small composition modules over public factories, one store, and scenarios that drive them with the mock provider.
    - API Notes and Examples:
      ```ts
      export async function createCodingWorker(config: HostConfig, deps: HostDeps): Promise<Agent> {
        import observational from "@arnilo/prism-memory-observational";
      import compaction from "@arnilo/prism-memory-compaction";
      return createAgent({
          name: "coding",
          model: config.models.coding,
          principal: { kind: "user", id: "prism-agent" },
          ownership: { tenantId: "prism-agent", userId: "prism-agent" },
          slots: { compaction: "@arnilo/prism-memory-compaction" },
          host: deps.host,
          packages: [
            sqliteStore({ path: config.storePath }),
            toolsCoding({ root: config.workspace, principal: { id: "prism-agent" } }),
            approvalPackage({ mode: config.approval }),
            contextFiles({ root: config.workspace }),
            hooksJson({ cwd: config.workspace }),
            observational, compaction,
          ],
        });
      }
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/src/host/{config.ts,store.ts,orchestrator.ts,coding.ts,research.ts,index.ts}`: new.
      - `apps/prism-agent/src/scenarios/{approval-gates-coding.ts,research-citations.ts,browser-unavailable.ts}`: new.
      - `apps/prism-agent/src/scenarios/fixtures/{obscura-fixture.ts,embeddings.ts,scripts.ts}`: new.
      - `apps/prism-agent/src/__tests__/{approval.test.ts,research.test.ts,secrets.test.ts}`: new.
      - `apps/prism-agent/package.json`: dependencies. Keep `@arnilo/prism` at `file:../..`. Native packages use `workspace:*` (Task 3: the root is not a workspace member).
      - `bun.lock`.
      - Tentative: an SDK file named by a gap-log row whose disposition is "fix in the SDK"; listed when Task 1 or this task records it.
    - References:
      - plans 154 (coding, approval, context files), 155 (web, browser), 157–158 (memory), 160 (delegate), 168–169 (workflows)
  - Test Cases to Write:
    - `approval_denies_coding_write`: the file is absent and a deny decision is recorded. Fails if the coding worker runs without `approval` or the deny is ignored.
    - `approval_allows_coding_write`: the file exists after approval.
    - `research_report_citations_resolve`: verdict `passed`, ledger size 2. Fails if `web_fetch` does not run through `tools-web` on the fixture.
    - `research_unresolved_citation_fails_check`: one repair continuation, then `failed`.
    - `browser_unavailable_notes_and_registers_nothing`.
    - `host_load_does_not_import_playwright`: fails if `playwright-core` is resolved at host import.
    - `host_secret_never_leaks`: a planted `env:` secret is absent from events, `inspect()`, errors, and the SQLite file.
    - `literal_secret_in_host_config_rejected_by_package`: `createAgent` rejects with the package's ref-only error; the host maps it to exit `2`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — private host code; behavior is documented in the walkthrough.
    - Docs pages to create/edit: none in this task; plan 173 Task 9 writes the walkthrough from these modules. `CHANGELOG.md` gets no line (the app is unpublished; Task 3's line covers it).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped** `src/host/{config,store,start,orchestrator,coding,research,index}.ts` and the three scenarios. Agents are created only when a scenario calls the factory. `src/index.ts` does not import them.
    - **Compaction slot.** `memory-observational` and `memory-compaction` both claim `slot:compaction`. Both stay listed. `slots.compaction` is `@arnilo/prism-memory-compaction` — the SDK's named-owner resolution, not a workaround. No gap row.
    - **Coding durable write.** `write` fails closed without `AgentConfig.principal` and `ownership.tenantId` (`tool effect ownership is required`). The host pins both to `prism-agent` and passes the same id to `toolsCoding({ principal })`. `toolsCoding` config key is `root`, not `workspace`.
    - **hooks.json.** The package does not read a path. The host reads `<workspace>/.prism/hooks.json` when present and passes it as `hooksJson({ cwd, config })`. Absent file lists the package with no config.
    - **Approval deny.** A dismissed confirm is a session tool result `{ code: "hook_denied" }`. `session.subscribe()` did not emit `tool.completed` for that deny. Task 5 JSONL, if it only forwards the subscriber, will not show the deny. The allow path does emit `tool.completed`.
    - **Research.** Obscura fixture is a `chmod +x` shell script (`fetch` exits 0). `nativeTools: false`. `limits.maxContinuations` equals `maxRepairs` (1). Citations: passed ledger 2, then failed on `S9`. `research.verify` is a command.
    - **Browser.** This machine has playwright, so the test mocks `chromium.launch` to throw. The package notes `launch failed` and registers no `browser_*` tool. CI without the module hits the import catch instead. Host import does not resolve `playwright-core`.
    - **Secrets.** Planted `env:` value absent from `inspect()` and the SQLite file. A literal `apiKey` is passed through `loadHostConfig` and rejected by tools-web; `startAgent` maps that to exit 2 with the package message.
    - **Store.** `sessionIndex(createSqlitePersistence({ filename }))` listed the coding session. Delegate child `research-brief` uses `inherit: []` and is not that worker.
    - **Lock.** `bun install` again duplicated tools-coding lock keys. Duplicates removed. `lockfile agrees` passes. No baseline. No changelog line. Gap log unchanged.
    - **Checks.** App tests 10 pass. `bun run typecheck` exit 0. Boundary scan empty.

- [x] Task 5: Headless entry points — one-shot JSONL with exit codes and a golden file, `resume`, and `serveAcp`
  - Acceptance Criteria:
    - Functional: `bin/prism-agent.ts` dispatches:
      - `run [--agent orchestrator|coding|research] [--config <path>] [--session <id>] <prompt>`: runs one prompt, writes each `AgentEvent` as one JSON line to stdout (Task 1 decision (k)), and ends with `{"type":"prism-agent.exit","code":N}`
      - `resume --session <id> [--decision <approvalId>=allow|deny]...`: resumes a suspended session from the store with the given decisions, streaming the same JSONL
      - `acp [--agent ...]`: `serveAcp(agent, { stdio: true })`, for an ACP-capable editor
      - anything else: usage on stderr, exit `2`
    - Functional: Exit codes (documented in the README and pinned by tests), precedence `2` > `3` > `1` > `4` > `0` (Task 1 (k)): `0` completed; `1` the run failed; `2` usage or config error, including a `createAgent` rejection; `3` suspended awaiting a decision (the last JSONL lines carry the pending approval ids); `4` a completed research run whose `research.verify` verdict is `failed` (not `pending` — Task 2: a dropped continuation leaves `pending`). JSONL is kernel events unchanged; no host redactor. `research.citations.unresolved` is a session event (`session.subscribe`), not an `agent.subscribe` event.
    - Functional: `src/scenarios/one-shot-golden.ts` runs `run` in-process on a scripted mock provider with fixed ids and a fake clock, and `src/__tests__/fixtures/one-shot.golden.jsonl` pins the stream. Volatile fields (if any remain after injecting ids and clock) are normalized by a documented list in the test, not by regex over the whole line.
    - Functional: `resume` after a code-`3` run, in a **fresh process** over the same SQLite file, completes and exits `0`.
    - Functional: `acp` is exercised in a test through `serveAcp(agent, { stream })` with an in-memory ACP stream (`packages/hosts/acp/src/serve.ts:22-29`): `initialize`, `session/new`, `session/prompt`, and a permission request answered by the test client.
    - Performance: The one-shot path imports only the selected agent's packages (dynamic import per agent module) and writes JSONL unbuffered line by line; no event is held beyond the line being written.
    - Code Quality: Argument parsing is a small hand-written parser over `process.argv` (the same list as `Bun.argv`; the app tsconfig `types` field does not include the Bun global). No CLI dependency. The JSONL writer is `JSON.stringify(event) + "\n"` with no host-side event reshaping.
    - Security: JSONL is the kernel's redacted events unchanged (no host redactor, Task 1 (k)); a test asserts a planted secret ref value never appears in the stream or on stderr. `acp` reads only stdio. `--config` must name a file; credential values never appear on the command line (refs only), and a literal secret in `--config` exits `2`.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 12 "headless entry points"; `packages/hosts/acp/src/serve.ts:22-60`; `packages/hosts/acp/README.md`; `docs/next/events.md` (event catalog); `src/suspended-run.ts:61`
    - Options Considered:
      - Use `@arnilo/prism-devtools` arg parsing. Rejected: devtools owns its own CLI; borrowing it couples the host to an unrelated library.
      - Write the golden file from `inspect()` snapshots. Rejected: the roadmap pins the JSONL stream itself.
    - Chosen Approach:
      - A thin bin over the Task 4 composition, JSONL as raw events, exit codes as a small table, and ACP through the published host library.
    - API Notes and Examples:
      ```bash
      bun apps/prism-agent/bin/prism-agent.ts run --agent coding "add a README" > run.jsonl; echo $?   # 3 when awaiting approval
      bun apps/prism-agent/bin/prism-agent.ts resume --session s_1 --decision ap_1=allow; echo $?    # 0
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/bin/prism-agent.ts`: dispatch.
      - `apps/prism-agent/src/cli/{args.ts,run.ts,resume.ts,acp.ts,exit-codes.ts,jsonl.ts}`: new.
      - `apps/prism-agent/src/scenarios/one-shot-golden.ts`: new.
      - `apps/prism-agent/src/__tests__/{cli.test.ts,acp.test.ts,golden.test.ts}`, `apps/prism-agent/src/__tests__/fixtures/one-shot.golden.jsonl`: new.
    - References:
      - plan 161 (ACP host library); `examples/acp.ts`
  - Test Cases to Write:
    - `one_shot_jsonl_matches_golden`: fails on any event shape or order change.
    - `exit_code_table`: one case per code (`0`, `1`, `2`, `3`, `4`). Fails if a case maps to the wrong code.
    - `resume_in_fresh_process_completes`: spawns `bun bin/prism-agent.ts resume` against the SQLite file from a code-`3` run; exit `0`.
    - `acp_prompt_and_permission_round_trip`: in-memory ACP stream; the permission answer reaches `approval`.
    - `jsonl_and_stderr_carry_no_secret`.
    - `usage_and_literal_secret_exit_2`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — private host CLI.
    - Docs pages to create/edit: none in this task; the entry points and exit-code table go into the walkthrough in plan 173 Task 9.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Shipped** `bin/prism-agent.ts` and `src/cli/{args,jsonl,exit-codes,agents,run,resume,acp}.ts`. Each command is a literal dynamic import, so `run --agent coding` does not load the research worker or ACP. JSONL is `session.stream` / `session.resume` events unchanged, then `{"type":"prism-agent.exit","code":N}`.
    - **Exit codes.** `2` is usage or `HostStartError` before the table. Then `3` suspended, `1` failed or no terminal event, `4` only when a completed research run's `research.verify` verdict is `failed`. `pending` is not 4. `allow` maps to `allow_once`, `deny` to `reject_once`.
    - **Config.** `--config` defaults to `./prism-agent.json` and must be a file. Resume without `--agent` reads the session actor written at `run`. The spec omitted `--agent` on resume; the actor is the SDK field, not a sidecar.
    - **Golden.** Kernel has no id or clock slot. The scenario injects `session_golden` and patches `Date` for the call. `latencyMs` is not a `Date` read, so the test replaces `runId` and `latencyMs` by key. Fixture: `src/__tests__/fixtures/one-shot.golden.jsonl`.
    - **Fresh-process resume.** An in-memory mock cannot cross processes. `PRISM_AGENT_MOCK` loads `src/scenarios/mock-seam.ts` through a literal dynamic import. Unset, the bin loads no test provider. First process suspends on `write`; second resumes with a text step. Exit 0, file exists. Not a gap row.
    - **ACP.** The test speaks JSON-RPC on an in-memory `serveAcp` stream. It does not import `@agentclientprotocol/sdk` — that package is not on the reference-host allow-list. One `session/request_permission` answered `allow_once` reaches approval and the write lands.
    - **Secrets.** Planted `env:` value absent from JSONL and stderr. A literal `apiKey` exits 2 with the package message and is not on stdout.
    - **Lock.** `bun install` duplicated tools-coding lock keys again. Duplicates removed. Evals cache ENOENT is pre-existing. No baseline. No kernel change. Gap log unchanged. Task 6 grep over the app is empty.
    - **Checks.** App tests 20 pass, including the boundary gate. `bun run typecheck` exit 0.

- [x] Task 6: Part A verification and gap-log checkpoint
  - Acceptance Criteria:
    - Functional: Run the whole-plan verification below and record results against Task 1's baseline. Every new failure is fixed or attributed.
    - Functional: Every gap-log row from Tasks 1–5 has a disposition: `fixed in <file>` (with the test that proves it) or `backlog: <title>` with a reason. A row marked `open` blocks plan 173's Done record, not this task, and is named in the note.
    - Functional: The repo-wide grep for host workarounds over `apps/prism-agent/` (`as any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error`, `/src/` in a package specifier) returns nothing, or each hit is a gap row.
    - Performance: n/a — verification.
    - Code Quality: n/a — verification.
    - Security: The secret sweeps from Tasks 2, 4, and 5 pass.
  - Approach:
    - Documentation Reviewed:
      - this plan's Task 1 baseline
    - Options Considered:
      - Fold verification into plan 173. Rejected: Part A must leave the tree green and its gaps visible before Part B builds on it.
    - Chosen Approach:
      - Run, compare, and record.
    - API Notes and Examples:
      ```bash
      rg -n "as any|as unknown as|@ts-ignore|@ts-expect-error|prism-[a-z-]+/src/" apps/prism-agent
      ```
    - Files to Create/Edit:
      - this plan: Notes, gap-log dispositions.
    - References:
      - plan 171 Task 8 (verification note pattern)
  - Test Cases to Write:
    - n/a — runs the suites above.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit: none — verification only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-14):
    - **Verdict.** Part A stands. No new failure to fix. No gap row. No kernel change. No baseline diff.
    - **Against Task 1.** `bun run build:core` exit 0. `bun run typecheck` exit 0. `@arnilo/prism-tools-research` 12 pass / 0 fail, including `ledger_strips_credentials_from_urls`. `@arnilo/prism-agent` 16 pass / 0 fail, including `host_secret_never_leaks`, `literal_secret_in_host_config_rejected_by_package`, `jsonl_and_stderr_carry_no_secret`, and `usage_and_literal_secret_exit_2`. Boundary gate 4 pass (in the packaging run). Host-surface gate 3 pass / 1 fail: the same six MCP-server imports (`ToolCapabilityKind`, `ToolDefinition`, `ExternalToolDecision`, `RunController`, `@arnilo/prism/driver-kit`). Docs 148 pass / 22 fail (Task 1 was 145/25). No docs failure names `tools-research` or `prism-agent`. The three cleared failures are inventory catch-up, not a docs edit.
    - **Packaging.** A run parallel with `typecheck` reported `src/*.js` in the tools-research, mcp, mcp-server, and acp tarballs (341/8). Isolated rerun: 345 pass / 4 fail. tools-research packs `.ts` and passes. The four that remain are inherited: MCP host-surface, phase48 neuralwatt umbrella, retired provider family, `npm ls` exit non-zero. `npm ls` was already red (plan 171); the app's `workspace:*` lines are extra noise in that output, not a new failing test.
    - **Release.** `bun scripts/release.mjs gate` exit 1 before gates: `PRISM_TEST_POSTGRES_URL` unset. Same as Task 1. `runGates({ release: loadRelease(), version: "0.12.1", updateBaseline: false, packageName: "@arnilo/prism-tools-research" })` returned `{ updated: false, packages: 65 }`. Not Postgres evidence.
    - **Workaround grep.** `rg -n "as any|as unknown as|@ts-ignore|@ts-expect-error|prism-[a-z-]+/src/" apps/prism-agent` empty.
    - **Gap log.** No rows from Tasks 1–5. Still one failed-verdict consumer (`tools-research`). `tools-coding` and `hooks-json` continue; they do not need `RunEndDecision.fail`. No second consumer, so no row. Nothing `open`. Plan 173 is not blocked by this log.

## Gap log

Every seam the reference host needed and the SDK lacked (roadmap Phase 12, "Gap log"). Both parts append here. Disposition is `fixed in <file> (<test>)` or `backlog: <title> — <reason>`. Phase 12 is not done while a row is `open`.

| # | Found in | Seam needed | Placement (§1) | Disposition |
| --- | --- | --- | --- | --- |

Task 1 (2026-10-14) added no rows. A kernel `RunEndDecision.fail` was rejected (one consumer). Log it only if a second consumer appears. Task 6 (2026-10-14) rechecked: still one consumer. No row. Plan 173 Task 10 (2026-10-14) rechecked at phase close: still one consumer, no row. The log is closed empty; Part B added no rows.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-tools-research test`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/reference-host-boundary.test.ts src/__tests__/packaging.test.ts src/__tests__/host-surface-gate.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate` (record the Postgres preflight state if it still blocks; then run the `runGates` compatibility leg as plan 171 did)

## Compromises Made

- Inherited whole-plan red gates left red. Docs 148/22, packaging/host-surface 345/4, and `bun scripts/release.mjs gate` blocked on unset `PRISM_TEST_POSTGRES_URL`. No failure is new to this plan. Priority P3. The repair is already plan 171's backlog row "Re-run headless release verification after gate repairs"; this plan does not open a second repair.
- Implications: Part A is not an all-green release claim. The research package, the app, typecheck, the boundary gate, and the tools-research compat leg pass.

Recorded in plans/backlog.md.

## Further Actions

- Stop `bun install` from writing duplicate `bun.lock` keys under `@arnilo/prism-tools-coding` / `@arnilo/prism-core`. Priority P3. Done 2026-10-14. The same name in `dependencies` and `devDependencies` made Bun 1.4.2 write the nested path twice. Dropped the extra `file:` devDependency on `@arnilo/prism-tools-coding`, `@arnilo/prism-mcp`, and `@arnilo/prism-acp-agent`. Three installs left `duplicateLockKeys` at 0. The caret dependency stays, so the published package is unchanged.
- Why: the duplicate detector already rejects them, but install kept emitting them.

Recorded in plans/backlog.md.
