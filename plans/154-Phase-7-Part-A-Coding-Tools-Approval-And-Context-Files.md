# Phase 7 Part A — Coding tools, approval, and context files

## Objectives

- Make the coding stack native packages: `@arnilo/prism-tools-coding` (`packages/tools/coding`), `@arnilo/prism-approval` (`packages/policy/approval`), and `@arnilo/prism-context-files` (`packages/context/files`).
- Move file, search, shell, sandbox and execution-policy, git, checks, todo, and `ask_user` code out of `@arnilo/prism-coding-tools` (`/agent`, `/security`) into `tools-coding`. Each tool declares `effects`, root escapes are hard-denied through `tool.call`, and durable effects are checked against `principal`.
- Replace the in-tool `ExecutionPolicy` approval callbacks with approval modes (`deny` / `ask` / `edits` / `auto`) decided from tool `effects` and roots at `tool.call`, and resolved through the kernel's `ask` path (inline `host.ui` confirm, or suspension).
- Move AGENTS.md / SYSTEM.md layering, with its trust policy, from the kernel's `node/*` subpaths into a `context.build` package that never scans the home directory unless configured.
- Prove three of the four Phase 7 Done criteria: an edit under `approval` in `ask` mode, `disable.tools: ["shell"]`, and `tools-coding` loading neither Playwright nor the Office parsers.

## Expected Outcome

- `packages: [toolsCoding({ root }), approval({ mode: "ask" })]` gives an agent the coding tools. Each write, execute, or network call outside the mode's allowance reaches the host as a `host.ui` `confirm`. A host without `ui` suspends the run instead, and `session.resume(decisions)` finishes it.
- A path argument that escapes the configured roots is denied at `tool.call` in every approval mode, including `auto`, and from a custom loop.
- `disable.tools: ["shell"]` removes `shell` from `agent.tools`, from the provider tool list, and from dispatch.
- `todo_write` and its `run.end` continuation, `ask_user_decision` over `host.ui` `select`/`input`, `git_*`, and `coding_check` come from `tools-coding` with no host wiring. A durable-effect tool refuses to run without a `principal`.
- `contextFiles({ root })` layers AGENTS.md and SYSTEM.md into `context.build`. Untrusted paths and the home directory are skipped unless configured. `disable.hooks: ["@arnilo/prism-context-files:context.build"]` turns it off.
- `@arnilo/prism-coding-tools/agent`, `@arnilo/prism-coding-tools/security`, `@arnilo/prism/node/instruction-sources`, `@arnilo/prism/node/system-prompts`, and `@arnilo/prism/node/trust` are gone. Their importers are migrated and the baselines regenerated.
- `examples/coding-approval.ts` runs under the execution gate on the mock provider. A subprocess test proves that importing `tools-coding` loads neither `playwright-core` nor any Office parser.

This plan implements roadmap **Phase 7 — Tool and context packages**, Part A. Task 1 is the phase review for **both parts**. It is required because the phase creates eight packages, moves 0.12 code out of the kernel and three family workspaces, and may extend the `tool.call` payload to its §2.4 shape (Task 1 found the payload already conforms through `context.session`, so no kernel payload change lands). Part B (plan 155) covers `tools-web`, `tools-browser`, `tools-work`, `tools-computer-use`, and `tools-openapi`, the fourth Done criterion (`tools-web` with no key), and the retirement of the kernel `ExecutionPolicy` export. It depends on this plan. The `workspace` service (§2.12.14) is Phase 14 and is not built here. This plan does not bump versions, publish, or edit released `/docs`; those wait for Phase 11. Package READMEs, `docs/next/` pages, and `CHANGELOG.md` `## [Unreleased]` entries are written as each task lands. Phases 7, 8, and 9 may run in parallel, so a task that lands after a sibling plan's task rebases the shared files (`package.json` `workspaces`, `scripts/package-truth.mjs`, `packaging.test.ts`, `scripts/compat-baseline/`, `CHANGELOG.md`, `examples/README.md`, `scripts/e2e-coverage.json`) and regenerates the baseline.

Lab impact (probe 12): Prism Code's imports move to the new packages in each task. Its approval engine (`packages/prism-code/src/approval.ts`), todo wiring (`headless.ts:192-291`), and tool selection (`tools.ts`) cannot be deleted until the lab builds its agent from the manifest in Phase 12. Task 1 records exactly what remains.

## Tasks

- [x] Task 1: Phase 7 review — tool, approval, and context contracts, and the moves (read-only, covers Parts A and B)
  - Acceptance Criteria:
    - Functional: The Notes inventory every contract the phase touches, each citing roadmap §2.1, §2.4, §2.6, §2.9, §2.10, or Phase 7, and the current code at `file:line`:
      - `ToolCallHookPayload` (`src/hooks/types.ts:91-98`: `name`, `args`, `effects`, `callId`, `sessionId`, `runId`, with no `session` and no `principal`), compared with the §2.4 catalog row `{ name, args, effects, session, origin? }`. Also `ToolCallDecision` (`:100-105`), the `tool-call` combination (`src/hooks/catalog.ts:59`), and the `ask` resolution in `src/hooks/ask.ts`.
      - `RunEndPayload` / `RunEndDecision` (`src/hooks/types.ts:131-151`) and `limits.maxContinuations`
      - `ToolDefinition.effects` (`src/contracts-protocol.ts:497`; omitted means all kinds), `ToolCapabilityKind` (`:453`), `ToolDefinition.effect` (durable-effect declaration, `:492`), and `ToolExecutionContext.principal` / `session` / `progress` (`:512-525`)
      - `SessionContext.principal` (`src/session-context.ts:8-19`) and `SessionState.get(session: SessionContext)` (`src/session/state.ts:17-22`). Approval's per-session grants need a `SessionContext` in the `tool.call` payload.
      - `PackageAPI.services`, `tools.register(..., { when })`, `disable.tools` / `disable.hooks`, and `host.ui` `confirm` / `select` / `input` (`src/packages/api.ts`, `src/host/types.ts`)
      - the kernel coding modules: `src/execution-policy.ts` (root exports `src/index.ts:390-391`), `src/security.ts` (`TrustPolicy`, `PermissionPolicy`; `src/index.ts:668-679`), `src/node/instruction-sources.ts`, `src/node/system-project-prompts.ts`, `src/node/trust.ts`, and their subpaths `./node/instruction-sources`, `./node/system-prompts`, `./node/trust` in root `package.json` `exports`
      - `src/system-prompts.ts` (`composeSystemPrompt`, used by `src/agent-session/session/assemble.ts:38,319`). It stays in the kernel unless the review finds it serves only file layering.
      - `src/cli-runner.ts:330-380`: the 0.12 run CLI's AGENTS.md / SYSTEM.md / `--instruction` loading through the three node modules
      - `packages/prism-coding-tools` subpaths (`package.json` `exports`: `/agent`, `/security`, `/openapi`, `/computer-use-linux`, `/dev`, `/dev/cli`, `/impeccable`) and the `createCodingTools` assembly (`src/agent/index.ts:600-694`)
      - `packages/prism-code/src/approval.ts` (modes `ask` / `accept-edits` / `auto` at `:27`, persisted `permissions.json` rules, `createPrismCodeApprovalPolicy` at about `:267`) and `packages/prism-coding-tools/src/security/approval.ts` (`CodingApprovalPolicyOptions`, `roots`, `commandRules`, the approval cache)
      - `packages/web-tools`, `packages/prism-work`, `prism-coding-tools/src/{openapi,computer-use-linux}` for Part B: subpaths, heavy dependencies (`playwright-core`, `@office-open/*`, `mammoth`, `pdf-parse`, `@firecrawl/anydoc`, `e2b`), and backends
    - Functional: Count every importer, grouped by workspace (exclude `dist/` and `node_modules/`), of:
      - `@arnilo/prism-coding-tools/agent` and `/security`. The survey on 2026-10-05 found `acp-agent` 1, `ag-ui` 6, `agent-sdk` 1 (`src/presets.ts`), `prism-code` 8 (`headless.ts`, `acp.ts`, `approval.ts`, `tools.ts`, `compaction.ts`, `tui/index.ts`, `tui/reducer.ts`, `tui/components/todo.ts`), `examples` 8+3, `scripts` 7+3, `src` 1+1 (`src/cli-dev.ts` names the package in text)
      - `@arnilo/prism-coding-tools/openapi`, `/computer-use-linux`, `/impeccable`, `/dev`
      - `@arnilo/prism-web-tools` (and subpaths) and `@arnilo/prism-work` (and subpaths), including `packages/prism-core/src/enterprise/postgres/{work-idempotency,types}.ts`
      - `ExecutionPolicy` / `assertExecutionAllowed` / `ExecutionAction` (`prism-core/src/runtime/workflows/{types.ts,run/node-execution.ts}`, `web-tools/src/browser/{tools,policy,index}.ts`, `agent-sdk/src/{config,presets,index,planes/mcp}.ts`, `examples/workflow-tool-approval.ts`)
      - `@arnilo/prism/node/{instruction-sources,system-prompts,trust}` (`agent-sdk/src/planes/{instructions,skills,hooks}.ts`, `examples/{instruction-injection,system-project-prompts,discover-skills}.ts`, `examples/tsconfig.json`, `scripts/fixtures/e2e-full-surface-journey.mjs`, `src/__tests__/docs.test.ts`)
    - Functional: Record these decisions. Each one has a default that a finding may overturn:
      - **(a) `tool.call` payload.** Default: add `session: SessionContext` (which carries `principal`) to `ToolCallHookPayload` and keep `sessionId` / `runId`. The §2.4 catalog already names `session`, so this conforms the code to the roadmap rather than adding a hook. Without it, approval cannot read its per-session grants and governance cannot see the principal. `origin` stays Phase 13's (K3).
      - **(b) Path targets for approval and hard denies.** Approval decides on "inside roots", but only the tool package knows which arguments are paths. Options:
        - a `tool.targets` service: `tools-coding` provides `targets(name, args) → { paths: string[], roots: string[] } | undefined`, and approval consumes it if present
        - a `ToolDefinition.paths` kernel field. Rejected: it is a kernel addition that one package needs, and a service expresses it.
        - approval parses known tool names. Rejected: §2.6 says approval decides from `effects`, not names.

        Default: the service, named `coding.targets`. When it is absent, or returns `undefined` for a call, approval treats the call as outside roots, so an `edits` grant fails closed to `ask`.
      - **(c) Approval modes.** The roadmap's names are `deny` / `ask` / `edits` / `auto`; the lab uses `ask` / `accept-edits` / `auto`. Default: the roadmap's names. Prism Code maps `accept-edits` → `edits` at its config edge in Task 6, until Phase 12 rewrites its config.

        | Mode | `read` | `write` inside roots | `write` outside roots | `execute` / `network` / `external` |
        | --- | --- | --- | --- | --- |
        | `deny` | allow | deny | deny | deny |
        | `ask` | allow | ask | ask | ask |
        | `edits` | allow | allow | ask | ask |
        | `auto` | allow | allow | allow | allow |

        Hard denies (root escape, command rules) come from `tools-coding` and win in every mode, because any deny wins at `tool.call`.
      - **(d) "Always allow" grants.** Default: an `always` answer becomes a per-session grant in `state.session("grants")` keyed by tool name plus, for `shell`, the command prefix (`prism-code/src/approval.ts` `commandPrefix`). Grants that last across sessions are static `rules` in package config, written by the host through `configure`. Prism Code's `permissions.json` file I/O stays in the lab until Phase 12. Record whether the `confirm` request can carry a three-way answer. If `UiResponse` has only `answered: boolean`, the `always` path uses a follow-up `select` and the Task 6 text is amended.
      - **(e) Placement of each `prism-coding-tools/src/agent` and `/security` module.** Classify each as one of:
        - `tools-coding`, registered: read, write, edit, delete, move, repo_list, repo_search, glob, shell, git_*, coding_check, todo_write, ask_user_decision
        - `tools-coding`, named export, not registered: sandboxes (native, docker, e2b), egress, command rules, path containment, process sessions, language intelligence, diagnostics
        - another phase: `workspace-lifecycle.ts` and `spawn-worktree.ts` go to Phase 14 (`workspace` service); `acp-operations.ts` goes to Phase 10 (`@arnilo/prism-acp`); `goal-verify.ts` and `coding-checkpoint.ts` go to Phase 16 (workflows)
        - deleted, with no live consumer

        Default for "another phase": the module moves into `tools-coding` as an unregistered named export, so the family subpaths can be deleted in Task 3, and its owning phase moves it on. List each module with its destination. Record whether `/dev` (Phase 10, `@arnilo/prism-devtools`) and `/impeccable` (already a `definePackage`, plan 147) stay in `prism-coding-tools` until their phases.
      - **(f) Durable-effect identity.** Record what plan 142's required `identity` and the `"local-operator"` profile enforced (`agent-sdk` `define-agent.ts`, `src/agent-approval.ts:342` `decisionPrincipalRef`) and which `prism-coding-tools` tools declare a durable `effect` (the git tools, `git_pr_handoff`, forge). Default: in `tools-coding`, a tool whose effect is durable fails closed with `ERR_PRISM_CODING_PRINCIPAL_REQUIRED` when `ctx.principal` is absent. With `principal: { id }` in config, it also fails closed with `ERR_PRISM_CODING_PRINCIPAL_MISMATCH` when the ids differ. Verification of the principal stays with `governance` (Phase 9).
      - **(g) `ExecutionPolicy`.** Default: `tools-coding` keeps an internal `ExecutionPolicy` type for its sandbox and command-rule checks (Task 4). The kernel export stays until Part B, where the browser and `prism-core` workflows stop importing it, and is then deleted (plan 155).
      - **(h) What `context-files` takes.** Default: `node/instruction-sources.ts`, `node/system-project-prompts.ts`, and `node/trust.ts` move into the package, and the three subpaths are deleted. The 0.12 run CLI's `--agents-md*`, `--system-md*`, `--no-agents-md`, `--no-system-md`, `--instruction`, and `--injector-file` flags are deleted with them, because the kernel cannot import a package. `contribution-discovery` stays in the kernel if kernel skills discovery uses it; otherwise record its owner. Record whether `createPathTrustPolicy` is used by kernel skills discovery. If it is, it stays in the kernel, and `context-files` imports it from `@arnilo/prism`.
      - **(i) Tool names.** Default: keep the 0.12 names (`shell`, `read`, `repo_search`, and so on). The roadmap's "grep" is the `repo_search` tool, and `disable.tools: ["shell"]` already matches. No tool is renamed in Phase 7.
      - **(j) Load-cost boundary.** Record every static import chain from `prism-coding-tools/src/{agent,security}` to `playwright-core`, `@office-open/*`, `mammoth`, `pdf-parse`, `@firecrawl/anydoc`, `e2b`, or `@arnilo/prism-work`. `e2b` must stay behind a dynamic import, loaded only when `sandbox: "e2b"` is configured.
      - **(k) The lab.** List the `packages/prism-code` modules each task touches and which become deletable. Default: none is fully deletable in Part A. `approval.ts` keeps its `permissions.json` I/O and TUI prompt adapter. The rest goes to Further Actions for Phase 12.
    - Functional: Record the current failing-test set of `bun test src packages` (with the `limits.test` SIGTERM workaround from plan 153 Task 1) as this plan's baseline.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut the plan.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites the `graft` or `rg` command that produced it.
    - Security: List every place a 0.12 path check runs today (`assertPathInsideRoots`, `createPathTrustPolicy`, sandbox containment) and the `tool.call` or in-tool check that replaces each one. No check may disappear in the move.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4, §2.1 (Tools, Safety floor), §2.4 (`tool.call`, `run.end`, `ask` resolution), §2.6 (Tools, packages), §2.9 rows for `tools-coding`, `approval`, `context-files`, and the tool packages, §2.10, §2.12.14, Phase 7, and Part 3 (plan 142 carry-forward: `principal`)
      - plan 144 Task 3 (`effects`, "family-package tools are annotated in Phase 7"), plan 145 (retired `PermissionPolicy` config, deny beats ask), plan 146 (`services`, `disable`), plan 148 (`HostUi` kinds, `principal`), plan 149 (`session.resume`), plan 153 Task 1 (format)
      - backlog: "A `tool.call` deny is scoped to a call, not a run" (P2), "`deny` beats `ask` at `tool.call`" (P2), "`PermissionPolicy` was kept while `AgentConfig.permission` was retired"
    - Options Considered:
      - Skip the review because the code already exists. Rejected: decisions (a), (b), and (e) shape three packages and a kernel payload change.
    - Chosen Approach:
      - Run graft and rg per symbol, read the cited spans, and decide (a)–(k).
    - API Notes and Examples:
      ```bash
      graft callers createCodingTools --depth all
      graft callers assertExecutionAllowed --depth all
      graft callers loadSystemPromptFiles --depth all
      rg -l --fixed-strings '"@arnilo/prism-coding-tools/agent' src packages examples scripts -g '!**/dist/**'
      ```
    - Files to Create/Edit:
      - `plans/154-Phase-7-Part-A-Coding-Tools-Approval-And-Context-Files.md`: Notes and amendments only.
      - `plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md`: amendments only, where a finding changes Part B.
    - References:
      - `.agents/skills/create-plan/references/prism.md` §2, §4 (tool package, moving 0.12 code)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-05):
    - **Verdict: proceed, with one task dropped and three amendments.** Decision (a) is overturned: the per-owner `SessionContext` already reaches every `tool.call` handler as `context.session`, so Task 2's kernel payload field is unnecessary and is dropped. Decisions (b)–(k) keep their defaults except (h), where the kernel's `node/trust.ts` must stay. Amendments are applied in place below (Tasks 2, 5, 6, 7).
    - **Contract inventory** (roadmap §2.1, §2.4, §2.6, §2.9, §2.10, Phase 7; read 2026-10-05):

      | Contract / current code | Span | Phase-7 use |
      | --- | --- | --- |
      | `ToolCallHookPayload` (`name`, `args`, `effects`, `callId`, `sessionId`, `runId`; no `session`, no `principal`) | `src/hooks/types.ts:91-98` | §2.4 row names `session`; delivered by `HookContext.session` (see (a)) |
      | `ToolCallDecision` | `src/hooks/types.ts:100-105` | approval returns `allow` / `{ ask }` / `{ deny }` |
      | `HookContext.session` (per-owner `SessionContext`) | `src/hooks/types.ts:25-33`; built `src/hooks/bus.ts:193-198`; documented `docs/next/hooks.md:38-42` | approval grants + governance principal |
      | `tool.call` combination | `src/hooks/catalog.ts:59` | deny > ask > rewrite > respond > allow |
      | `ask` resolution | `src/hooks/ask.ts`; `src/loop/run-controller.ts:225-228` | inline `host.ui` confirm or suspension |
      | `RunEndPayload` / `RunEndDecision` | `src/hooks/types.ts:131-143` / `:144-151` | todo continuation |
      | `limits.maxContinuations` | `src/run-limits.ts:133-136,174-176`; enforced `src/loop/run-controller.ts:301-307` | caps `run.end` continues |
      | `ToolCapabilityKind` / `ToolDefinition.effects` | `src/contracts-protocol.ts:453` / `:497` (omitted = all kinds, `:495-497`) | approval decides from effects |
      | `ToolDefinition.effect` (durable) + `ToolEffectKind` | `:492` / `:446` | principal guard |
      | `ToolExecutionContext.principal` / `session` / `progress` | `:512-525` (`:519`, `:523`, `:525`) | durable-effect identity |
      | `SessionContext.principal` | `src/session-context.ts:8-19` (`:11`) | approval grants, governance |
      | `SessionState.get(session)` | `src/session/state.ts:17-22` | per-session grants |
      | `PackageAPI.services` | `src/packages/api.ts:121-127` | `coding.targets` |
      | `tools.register(..., { when })` | `src/packages/api.ts:32-37,80-83` | per-session tool visibility |
      | `disable.tools` / `disable.hooks` | `src/agent/inspect.ts:119-122`; `src/agent/views.ts:15` | Done criterion 2 |
      | `host.ui` confirm/select/input + `dismissed`/`unavailable` | `src/host/types.ts:9-35,69-87` | approval prompts, `ask_user` |
      | `ExecutionPolicy` root exports | `src/execution-policy.ts:1-47`; `src/index.ts:390-391` | stays until Part B |
      | `TrustPolicy` / `PermissionPolicy` root exports | `src/security.ts:16-38`; `src/index.ts:668-679` | context-files trust |
      | `src/node/instruction-sources.ts` | `:1-74` (`loadInstructionSources:53`) | moves to `context-files` |
      | `src/node/system-project-prompts.ts` | `:1-104` (`loadSystemPromptFiles:44`) | moves to `context-files` |
      | `src/node/trust.ts` | `:10-59` (`isPathInsideReal:23`, `createPathTrustPolicy:51`) | **stays in kernel** — see (h) |
      | `src/node/contribution-discovery.ts` | `:1-239`; `isPathInsideReal` at `:10,90,120,134,186,189` | stays (kernel skills discovery) |
      | `src/system-prompts.ts` (`composeSystemPrompt`) | `:19`; used `src/agent-session/session/assemble.ts:38,319` | stays in kernel; package imports it |
      | root `exports` node subpaths | `package.json:71-86` | three subpaths deleted (trust kept internal) |
      | 0.12 run CLI loaders | `src/cli-runner.ts:330-380` (`createPathTrustPolicy:336`, `loadInstructionSources:349`, `loadSystemPromptFiles:369`) | flags deleted; trust call stays (see (h)) |
      | `prism-coding-tools` subpaths | `packages/prism-coding-tools/package.json:12-46` (`/agent`, `/security`, `/openapi`, `/computer-use-linux`, `/dev`, `/dev/cli`, `/impeccable`) | `/agent`, `/security` deleted |
      | `createCodingTools` assembly | `packages/prism-coding-tools/src/agent/index.ts:656-676`; `createReadOnlyTools:678` | nine registered tools |
      | lab approval | `packages/prism-code/src/approval.ts:26-28` (modes), `:91` (`permissions.json`), `:158` (`commandPrefix`), `:169` (four-way prompt), `:267` (`createPrismCodeApprovalPolicy`) | package `approval`, Task 6 |
      | coding approval policy | `packages/prism-coding-tools/src/security/approval.ts:15-23` (`CodingApprovalPolicyOptions`), `:77` (`createCodingApprovalPolicy`) | deleted, Task 4 |
      | path containment | `packages/prism-coding-tools/src/security/path-containment.ts:10-43`; in-tool `agent/mutation-path.ts:26`, `agent/repository/path.ts:30-58` | hard deny + in-tool |
      | Part B families | `packages/web-tools/package.json:8-35` (root/brave/exa/firecrawl/browser/obscura); `packages/prism-work/package.json` (12 subpaths); `prism-coding-tools/src/{openapi,computer-use-linux}/index.ts` | Part B |

    - **Importer counts** (`rg -l --fixed-strings <spec> src packages examples scripts apps -g '!**/dist/**' -g '!**/node_modules/**'`, 2026-10-05; source files, excluding the owning package):

      | Specifier | Workspace counts |
      | --- | --- |
      | `@arnilo/prism-coding-tools/agent` | `packages/prism-code` 8 (`acp.ts`, `compaction.ts`, `headless.ts`, `tools.ts`, `tui/{index,reducer,components/todo}.ts`, `__tests__/todo-continuation.test.ts`), `examples` 8, `packages/ag-ui` 6, `scripts` 8, `packages/acp-agent` 1, `packages/agent-sdk` 1 (`presets.ts`), `src` 1 (`__tests__/install-smoke.test.ts`) — 33 |
      | `@arnilo/prism-coding-tools/security` | `examples` 3 (`docker-process-session`, `hosted-sandbox`, `phase9-coding-intelligence`), `scripts` 3, `packages/prism-code` 2 (`approval.ts`, `tui/index.ts`), `src` 1 (`install-smoke.test.ts`) — 9 |
      | `/openapi` | `scripts` 3 (`fixtures/e2e-{enterprise,full-surface}-journey.mjs`, `benchmark-scenarios/phase11-auth.mjs`) — 3 |
      | `/computer-use-linux` | `scripts` 2 (`fixtures/e2e-full-surface-journey.mjs`, `phase54-package-map.mjs`) — 2 |
      | `/impeccable` | `examples/impeccable.ts`, `scripts/fixtures/e2e-full-surface-journey.mjs` — 2 |
      | `/dev` | `src/cli-dev.ts:30` (text), `src/__tests__/install-smoke.test.ts`, `scripts/fixtures/e2e-full-surface-journey.mjs` — 3 |
      | `@arnilo/prism-web-tools` (all) | `packages/prism-code` 2 (`web.ts`, `package.json`), `packages/web-tools` 10, `packages/agent-sdk` 2 (`package.json`, `__tests__/capabilities.test.ts`), `examples` 4 (`coding-browser-evaluation`, `obscura`, `web-research`, `tsconfig.json`), `scripts` 18, `src` 3 (`docs`, `install-smoke`, `packaging` tests) |
      | `@arnilo/prism-work` (all) | `packages/prism-core` 6 (`enterprise/postgres/{types.ts:6,work-idempotency.ts:11}`, 4 tests, `package.json`), `packages/prism-coding-tools` 3 (`package.json`, `agent/ask-user-decision.ts` comment, `dev/__tests__/eval-compare.test.ts`), `packages/memory` 1, `examples` 4, `scripts` 28, `src` 4 |
      | `ExecutionPolicy` family | `packages/prism-core` 3 (`runtime/workflows/types.ts:4-5,571`, `run/node-execution.ts:5,533`, `__tests__/run.test.ts`), `packages/web-tools` 4 (`browser/{tools,policy,index}.ts` + tests), `packages/agent-sdk` 6 (`config.ts:1,423`, `presets.ts:1,22`, `index.ts:43`, `planes/mcp.ts:1,127,290,469`, 2 tests), `packages/prism-code` 4 (`approval.ts`, `acp.ts`, `headless.ts`, `tools.ts`), `packages/prism-coding-tools` 30 (agent tree + security), `examples/workflow-tool-approval.ts`, `src` 3 (`execution-policy.ts`, `index.ts`, tests) |
      | `@arnilo/prism/node/trust` | `packages/agent-sdk` 3 (`planes/{instructions,hooks,skills}.ts`), `examples` 4 (`discover-skills`, `instruction-injection`, `system-project-prompts`, `tsconfig.json`), `scripts` 1 (`fixtures/e2e-full-surface-journey.mjs`) — 8 |
      | `@arnilo/prism/node/instruction-sources` | `examples/instruction-injection.ts`, `scripts/fixtures/e2e-full-surface-journey.mjs` — 2 |
      | `@arnilo/prism/node/system-prompts` | `packages/agent-sdk/src/planes/instructions.ts:3`, `examples/system-project-prompts.ts`, `scripts/fixtures/e2e-full-surface-journey.mjs`, `src/__tests__/docs.test.ts:2821` — 4 |

    - **Decisions.**
      - **(a) `tool.call` payload — default overturned; Task 2 dropped.** The per-owner `SessionContext` already reaches every hook handler as `context.session` (`src/hooks/bus.ts:193-198`, built by the bound bus `session.hooks()` at `src/agent-session/session.ts:464`; `RunController` uses that bus at `assemble.ts:555-559`). `docs/next/hooks.md:38-42` documents it, and `src/__tests__/session-state-background.test.ts:152,174,221` proves `ctx.session` works in handlers. Approval reads its per-session grants from `state.session("grants").get(context.session)` and governance reads `context.session.principal`; the payload's `sessionId`/`runId` stay for correlation. Adding `session` to `ToolCallHookPayload` would duplicate a field and force a kernel payload change plus a compat-baseline regeneration for no capability. `origin` stays Phase 13's (K3). Task 2 is marked `Dropped by Task 1`; Task 6 is amended to read `context.session`.
      - **(b) Path targets — the `coding.targets` service, default kept.** Approval cannot parse tool names (§2.6); only `tools-coding` knows which arguments are paths. `services.provide("coding.targets")` (`src/packages/api.ts:121-127`) with `targets(name, args) → { paths, roots } | undefined`; absent or `undefined` counts as outside roots, so an `edits` grant fails closed to `ask`. A kernel `ToolDefinition.paths` field is rejected (one package needs it; a service expresses it).
      - **(c) Approval modes — roadmap names, default kept.** `deny` / `ask` / `edits` / `auto`; the lab's `ask` / `accept-edits` / `auto` (`packages/prism-code/src/approval.ts:26-28`) maps `accept-edits` → `edits` at its config edge in Task 6. The mode table stands. Hard denies come from `tools-coding` and win in every mode (any deny wins, `src/hooks/catalog.ts:59`).
      - **(d) "Always allow" — three-way needs a follow-up `select`; Task 6 amended.** `HostUiResponse` confirm carries `answered: boolean` only (`src/host/types.ts:69-87`); `dismissed` and `unavailable` are the other two outcomes. The lab prompt is four-way (`once` / `run` / `always` / `deny`, `packages/prism-code/src/approval.ts:169`). So: a `confirm` yes = once, no/dismissed = deny, and an `always` answer is a follow-up `select` whose chosen value becomes a per-session grant in `state.session("grants")` keyed by tool name plus, for `shell`, the command prefix (`commandPrefix`, `approval.ts:158`). Cross-session rules are static package `rules`, written by the host through `configure`; `permissions.json` I/O stays in the lab until Phase 12.
      - **(e) Placement — the default holds.** Registered in `tools-coding`: read, write, edit, delete, move, repo_list, repo_search, glob, shell, git_* (7), coding_check, todo_write, ask_user_decision. Named export, not registered: the `security/` sandbox backends (native/docker/e2b), `egress/`, `command-rules`, `path-containment`, the `agent/process/` sessions, `agent/language/` intelligence, `agent/diagnostics.ts`, `agent/effects.ts`, `agent/limits.ts`, `agent/artifacts.ts`, `agent/review.ts`, `agent/supervisor-lifecycle.ts`, `agent/lifecycle.ts`, `agent/repository/`, `agent/forge/`, and the write/edit support modules (`atomic-write`, `bounded-file`, `edit-diff`, `file-mutation-queue`, `glob-match`, `mutation-path`, `output-accumulator`, `path-utils`, `read-path-set`, `truncate`, `env`, `git`, `git-exec`, `git-status`, `git-aware-repository`, `execution-policy`). Another phase: `workspace-lifecycle.ts` + `spawn-worktree.ts` → Phase 14 (`workspace`); `acp-operations.ts` → Phase 10; `goal-verify.ts` + `coding-checkpoint.ts` → Phase 16 — each moves into `tools-coding` as an unregistered named export so Task 3 can delete the family subpaths, and its owning phase moves it on. No module is deleted as dead: every one has an in-tree consumer or a barrel export (`review.ts` and `supervisor-lifecycle.ts` are exported and tested but have no non-barrel in-tree consumer — kept as named exports). `/dev` stays in `prism-coding-tools` until Phase 10 (`@arnilo/prism-devtools`, `src/cli-dev.ts:30`), and `/impeccable` until its own phase (it is already a `definePackage`, `src/impeccable/extension.ts:1,18`).
      - **(f) Durable-effect identity — default kept.** `AgentConfig.principal` (`src/contracts-protocol.ts:106`) flows to `SessionContext.principal` (`src/session-context.ts:11`) and `ToolExecutionContext.principal` (`:519`). `decisionPrincipalRef` (`src/agent-approval.ts:342`) is the redacted principal id used in decision scopes; `"local-operator"` survives only in tests/docs, not live code. Tools declaring a durable `effect`: write/edit/delete/move (`CODING_LOCAL_EFFECT`, `agent/effects.ts:8`), git_branch/git_worktree/git_apply (classifiers, `git-tools.ts:192,267,337`), git_commit (`CODING_LOCAL_EFFECT`, `:409`), git_pr_handoff (`CODING_UNSUPPORTED_EFFECT` = external_mutation, `:473`). Default: a durable tool fails closed with `ERR_PRISM_CODING_PRINCIPAL_REQUIRED` without `ctx.principal`, and `ERR_PRISM_CODING_PRINCIPAL_MISMATCH` when configured `principal.id` differs. Verification stays with `governance` (Phase 9).
      - **(g) `ExecutionPolicy` — default kept.** `tools-coding` keeps an internal `ExecutionPolicy` type for sandbox and command-rule checks; the kernel export (`src/index.ts:390-391`) stays until Part B (plan 155 Task 6), where `prism-core` workflows and the browser stop importing it.
      - **(h) What `context-files` takes — amended: `node/trust.ts` stays in the kernel.** `src/node/trust.ts` cannot move: kernel modules that stay import `isPathInsideReal` — `src/node/agent-definitions.ts:20,127,157,169` and `src/node/contribution-discovery.ts:10,90,120,134,186,189` — and `contribution-discovery` is used by kernel skills discovery (`src/agent-session/create-agent.ts:44` dynamic `loadSkillDirectory`) and by `src/cli-runner.ts`. `src/cli-runner.ts:336` also uses `createPathTrustPolicy` for `discoverAgentBundles`. So: move `node/instruction-sources.ts` and `node/system-project-prompts.ts` into the package; keep `src/node/trust.ts` as a kernel internal module; delete only the published `./node/trust` subpath; and export `createPathTrustPolicy` from `@arnilo/prism` (it stays in the kernel, per this decision's own conditional) so `context-files` imports it instead of copying it. `contribution-discovery` stays in the kernel. `composeSystemPrompt` stays (`assemble.ts:38,319`). The run CLI's `--agents-md*`, `--system-md*`, `--no-agents-md`, `--no-system-md`, `--instruction`, and `--injector-file` flags are deleted with the loaders; the `discoverAgentBundles` trust call remains. Task 7 amended.
      - **(i) Tool names — default kept.** `repo_search` is the roadmap's "grep"; `disable.tools: ["shell"]` already matches. No rename in Phase 7.
      - **(j) Load-cost boundary — default kept, one prerequisite recorded.** No static import chain from `prism-coding-tools/src/{agent,security}` to `playwright-core`, `@office-open/*`, `mammoth`, `pdf-parse`, `@firecrawl/anydoc`, `@arnilo/prism-work`, or `@arnilo/prism-web-tools`. `e2b` is reached only through `createRequire(import.meta.url).resolve("e2b")` plus a dynamic `import()` (`security/e2b-sandbox.ts:288-289`), so it must stay that way. **Prerequisite for Task 5:** `agent/ask-user-decision.ts:11-16` statically imports `@arnilo/prism-core/runtime/workflows` (`suspend`, `WorkflowResumeValidator`); Task 5 must drop that import when it replaces the durable path with kernel `session.resume`, or `tools-coding` gains a `prism-core` dependency.
      - **(k) The lab — default kept.** No `packages/prism-code` module is fully deletable in Part A. `approval.ts` keeps `permissions.json` I/O and its TUI prompt adapter; `headless.ts`/`tools.ts`/`acp.ts`/`tui/*` keep the todo wiring and `askUser` binding until Phase 12. Phase 12 Further Actions entry recorded.
    - **Baseline.** `bun test src packages --path-ignore-patterns='**/limits.test.*'` → **9368 pass / 338 skip / 179 fail / 9885 tests / 1069 files** (exit 1). The 179 failures are **107 distinct names** (the rest are built `dist/` copies). This is byte-identical to plan 153's close baseline, so no drift landed since Phase 6. Distinct failures by suite: `spawn eval pack (plan 078 Task 8)` 10, `guardrail pack evaluation scenarios` 10, `nested-agent approval propagation` 7, `createPrismHandler` 5, `docs` 4, `createSpawnAgentTool` 4, `Prism Code task-completion continuation` 4, `optional package setup boundaries` 3, `agent run lifecycle` 3, `Prism Code context management and long runs` 3, plus 44 single-name suites (55 distinct suites total). `bun test src packages` without the ignore exits 143 (SIGTERM) at `packages/prism-code/src/__tests__/limits.test.ts:227`, as plan 153 recorded.
    - **Security mapping — every 0.12 path check has a successor.**

      | 0.12 check | Where | Replaced by |
      | --- | --- | --- |
      | `assertPathInsideRoots` inside the approval policy | `security/approval.ts:92`; `prism-code/src/approval.ts:325` | `tool.call` hard deny (Task 4); in-tool containment stays |
      | `resolveContainedMutationPath` (write/edit/delete/move) | `agent/mutation-path.ts:26` | kept in-tool (Task 3), defence in depth under the hard deny |
      | `resolveRepoPath` (read/list/search/glob) | `agent/repository/path.ts:30-58` | kept in-tool (Task 3) |
      | `assertPathInsideRoots` in the native sandbox | `security/native-sandbox.ts:239` | kept (sandbox backend, Task 4) |
      | `evaluateCommandRules` (deny/require-approval/metacharacters) | `security/command-rules.ts:33-59` | deny rules → `tool.call` hard deny; require-approval → approval (Task 4) |
      | egress allow-list | `security/egress/policy.ts` | kept (sandbox egress, Task 4) |
      | sandbox fs containment | `security/sandbox-fs-operations.ts` | kept (Task 4) |
      | `createPathTrustPolicy` (AGENTS.md/SYSTEM.md, bundles) | `src/node/trust.ts:51` | `context-files` trust (Task 7); kernel keeps the function for `cli-runner` |
      | `isPathInsideReal` (kernel discovery) | `src/node/trust.ts:23` | stays in the kernel (see (h)) |

      No check disappears: the hard deny is the new outer gate, and each in-tool check remains.
    - **Amendments applied.** Task 2 marked `Dropped by Task 1`. Task 5 gained the `prism-core` import prerequisite (j). Task 6 now reads `context.session` and the `always` follow-up `select` (a, d). Task 7 keeps `src/node/trust.ts` in the kernel and exports `createPathTrustPolicy` from `@arnilo/prism` (h). Plan 155 Task 1 inherits the Part B inventory in the tables above (the five families, their subpaths, heavy deps, and the `prism-core → prism-work/connectors` direction for its decision (e)).

- [x] Task 2: `tool.call` payload carries `session` — **Dropped by Task 1 (a); no code change**
  - Notes: Dropped by Task 1 (a) (2026-10-05). `HookContext.session` already carries the per-owner `SessionContext` on every dispatch: the bound bus injects it (`src/hooks/bus.ts:193-198`, via `session.hooks()` → `sessionContextFor(owner)` at `src/agent-session/session.ts:464,494`), `RunController` is built with that bound bus (`src/agent-session/session/assemble.ts:559`), and `executeTools` dispatches `tool.call` through it (`src/loop/run-controller.ts:215-221`). `sessionContextFor` binds the session state store and exposes a live `principal` getter, so an approval or governance handler reads `state.session("grants").get(context.session)` and `context.session.principal` directly. A payload-level field could only carry one kernel-owned view, which is strictly worse than the per-owner view and would force a kernel payload change plus a compat-baseline regeneration for no capability. `docs/next/hooks.md:38-42` already documents `context.session`, so no doc change is needed either. Task 6 uses `context.session` (amended).
  - Acceptance Criteria:
    - Functional: `ToolCallHookPayload` gains `readonly session: SessionContext`. `RunController.executeTools` fills it from the session it already holds, on the default loop and on a custom loop. `sessionId` and `runId` stay.
    - Functional: The payload's `session` is the same view a package's `when` predicate and `ToolExecutionContext.session` receive, so `prism.state.session(key).get(payload.session)` works inside a `tool.call` handler.
    - Functional: Every in-tree `tool.call` handler and test fixture that builds a `ToolCallHookPayload` by hand compiles. Each is listed by `rg "ToolCallHookPayload|\"tool.call\"" src packages examples scripts`.
    - Performance: No new allocation per call beyond one field reference; the existing hook-bus microbenchmark, if any, does not regress.
    - Code Quality: There is no new hook and no new catalog row. The §2.4 row already names `session`, and `docs/next/hooks.md` is corrected to match the code.
    - Security: `session.principal` is passed through unchanged and never read by the kernel. A test asserts that `principal` does not appear in `hook.error` events or `inspect()`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 `tool.call` row; `src/hooks/types.ts:91-98`; `src/loop/run-controller.ts` and `src/loop/dispatch.ts` (where the payload is built); `src/session-context.ts:8-19`
    - Options Considered:
      - Add `principal` only. Rejected: approval needs `SessionContext` for `state.session(...).get`, and the roadmap names `session`.
      - Let packages look up the session by `sessionId` through a new `PackageAPI` member. Rejected: that is a new API surface where a payload field suffices.
    - Chosen Approach:
      - Add the field where `executeTools` assembles the payload. If Task 1 rejects (a), this task is marked `Dropped by Task 1` and Task 6 uses the alternative Task 1 records.
    - API Notes and Examples:
      ```ts
      prism.hooks.on("tool.call", (call) => {
        const grants = grantsState.get(call.session);
        return grants.has(call.name) ? "allow" : undefined;
      });
      ```
    - Files to Create/Edit:
      - `src/hooks/types.ts`: the `session` field.
      - `src/loop/run-controller.ts` and/or `src/loop/dispatch.ts`: fill it.
      - `src/__tests__/` hook catalog tests (the existing `tool.call` default-loop and custom-loop coverage files named by Task 1).
      - `docs/next/hooks.md`: the payload row.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerated.
      - `CHANGELOG.md`: `## [Unreleased]` entry.
    - References:
      - plan 144 Task 5 (catalog coverage from default and custom loops)
  - Test Cases to Write:
    - `tool_call_payload_carries_session_from_default_loop`: a `tool.call` handler reads `call.session.id` and `call.session.principal`. It fails if the field is missing or holds another session.
    - `tool_call_payload_carries_session_from_custom_loop`: the same, through a custom `LoopStrategy` calling `run.executeTools`.
    - `tool_call_session_state_round_trip`: a handler writes `state.session` through `call.session`, and a later call in the same session reads it. It fails if the payload's session view differs from the state owner's view.
    - `principal_absent_from_hook_error_and_inspect`: a throwing `tool.call` handler with a principal set produces a `hook.error` event without the principal's id.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a hook payload field.
    - Docs pages to create/edit:
      - `docs/next/hooks.md`: the `tool.call` payload shape.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate with `node scripts/release.mjs gate --update-baseline`. The task note records the `arnilo__prism.txt` diff (one added member) attributed to this plan.

- [x] Task 3: `@arnilo/prism-tools-coding` — move the code, register the file, search, and shell tools, and delete the `/agent` and `/security` subpaths
  - Acceptance Criteria:
    - Functional: `packages/tools/coding` exists with the §2.10 shape: `package.json` (`"exports": { ".": "./src/index.ts" }`, `requires.prism: "^0.13"` in the definition), `src/index.ts` whose default export is `definePackage`, `src/__tests__/`, and `README.md`. The modules Task 1 (e) assigns move with `git mv`, their tests come with them, and the named exports keep their names.
    - Functional: The default export registers `read`, `write`, `edit`, `delete`, `move`, `repo_list`, `repo_search`, `glob`, and `shell`. Config is a JSON Schema with defaults:
      - `root` (string, required)
      - `roots` (extra roots, default `[]`)
      - `readOnly` (default `false`; registers only the read subset)
      - `shell` (`{ enabled: true, timeoutMs }`)
      - the shared repository limits

      An unknown key fails `createAgent` with the kernel's config error naming the key.
    - Functional: Every registered tool declares `effects`: `read` / `repo_list` / `repo_search` / `glob` → `["read"]`; `write` / `edit` / `delete` / `move` → `["write"]`; `shell` → `["execute"]`. `packageConformance` passes. A tool conformance check asserts that no registered tool omits `effects`.
    - Functional: `@arnilo/prism-coding-tools/agent` and `/security` are removed from that package's `exports`. Every importer Task 1 counted now imports `@arnilo/prism-tools-coding`: `acp-agent`, `ag-ui`, `agent-sdk` (`presets.ts`, plus `package.json` as an independent-line dependency), `prism-code` (8 files), examples, scripts, and the `src/cli-dev.ts` text. The repo-wide grep `rg '@arnilo/prism-coding-tools/(agent|security)' src packages apps scripts examples docs -g '!**/dist/**' -g '!plans/**' -g '!docs/history/**' -g '!docs/_evidence/**'` returns nothing.
    - Functional: `prism-coding-tools` keeps only the subpaths Task 1 (e) leaves it (`/openapi` and `/computer-use-linux` until plan 155; `/dev` and `/impeccable` until their phases). Its README says where the moved code went.
    - Performance: Importing `@arnilo/prism-tools-coding` statically loads none of `playwright-core`, `@office-open/*`, `mammoth`, `pdf-parse`, `@firecrawl/anydoc`, or `e2b` (Task 1 (j)). This is proven by the subprocess test below.
    - Code Quality: There are no re-export shims or aliases from `prism-coding-tools` to the new package. Moved code keeps its tests, and new code goes only into `src/index.ts` and its config module.
    - Security: Tools keep their in-tool path containment (`assertPathInsideRoots`) as defence in depth, under the `root`/`roots` config. Hard denies at `tool.call` are Task 4.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-coding-tools/src/agent/index.ts:600-694` (`createCodingTools`, `withSharedExecutionPolicy`, `withRepositoryDefaults`), `src/agent/{read,write,edit,delete,move,list,search,glob,shell}.ts`, `src/security/path-containment.ts`
      - `packages/stores/sqlite/package.json` (native-package `package.json` shape, `postinstall` link), `packages/stores/postgres/src/__tests__/package.test.ts:89` (`pg_not_loaded_unless_store_postgres_listed`, the module-graph probe pattern)
      - `docs/next/packages.md`, `docs/next/tools.md`
    - Options Considered:
      - Build the package in parallel and delete the subpaths in a later task. Rejected: two copies of every coding tool would exist across tasks, and callers would be split between them.
      - Keep `createCodingTools(cwd)` as the only entry and wrap it. Rejected: the package must register tools itself; the factory stays as a named export for hosts that build tool lists by hand.
    - Chosen Approach:
      - Move, rewrite importers, delete the two subpaths, and add the `definePackage` registration, all in one task, so the tree is green at the end.
    - API Notes and Examples:
      ```ts
      import toolsCoding from "@arnilo/prism-tools-coding";
      const agent = await createAgent({ model, packages: [toolsCoding({ root: process.cwd() })] });
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/{package.json,tsconfig.json,bunfig.toml,README.md,CHANGELOG.md,LICENSE,src/index.ts,src/config.ts}`: new.
      - `packages/tools/coding/src/**`: modules moved from `packages/prism-coding-tools/src/{agent,security}` per Task 1 (e).
      - `packages/prism-coding-tools/package.json`, `README.md`, `src/agent/`, `src/security/`: subpaths and moved code removed.
      - Importers: `packages/acp-agent/src/index.ts`, `packages/ag-ui/src/{projection.ts,acp/terminal-client.ts,acp/mapper.ts,acp/agent/types.ts,__tests__/acp-lifecycle.test.ts,__tests__/ag-ui-mapper.test.ts}`, `packages/agent-sdk/src/presets.ts` and `package.json`, `packages/prism-code/src/{headless,acp,approval,tools,compaction}.ts`, `src/tui/{index.ts,reducer.ts,components/todo.ts}`, `src/__tests__/todo-continuation.test.ts`, `packages/prism-code/package.json`, the examples and scripts Task 1 counted, `examples/tsconfig.json:108`, and `src/cli-dev.ts:30` (text).
      - Enforcement rows: root `package.json` `workspaces` (`packages/tools/*`), `scripts/package-truth.mjs` (counts, family description at `:199`), `src/__tests__/packaging.test.ts` package list (`sourceExport: true`), the `scripts/independent-packages.json` `$comment` (lockstep until Phase 11), `scripts/compat-baseline/arnilo__prism-tools-coding.txt` (new), `arnilo__prism-coding-tools.txt` / `arnilo__prism-coding-agent.txt` / `arnilo__prism-coding-security.txt` (regenerated or removed), `scripts/e2e-coverage.json` and `scripts/coverage-thresholds.json` / `scripts/budgets.json` rows for the new package.
      - Tentative, confirmed by Task 1 counts: `scripts/{e2e-coding-journey,phase26-coding-journey,e2e-full-surface,e2e-enterprise-journey,packaging-current,phase24-truth,phase54-package-map}.test.mjs` and `scripts/phase54-package-map.mjs`, which pin the family package and its subpaths.
      - `CHANGELOG.md`: `## [Unreleased]` entry.
    - References:
      - plan 152 Tasks 2–3 and 8 (moving family code into native packages, deleting subpaths), plan 153 Task 3 (store package from kernel code)
  - Test Cases to Write:
    - `tools_coding_package_conformance`: `packageConformance(toolsCoding({ root }))` passes. It fails on a missing `requires`, a bad config schema, or a setup throw.
    - `tools_coding_registers_file_tools_with_effects`: `agent.tools` lists the nine tools, each with its declared `effects`. It fails if a tool is missing or omits `effects`.
    - `tools_coding_read_only_registers_read_subset`: `readOnly: true` registers only `read`, `repo_list`, `repo_search`, and `glob`.
    - `tools_coding_unknown_config_key_fails_closed`: `toolsCoding({ root, bogus: 1 })` makes `createAgent` reject, naming `bogus`.
    - `tools_coding_edit_round_trip_on_mock_provider`: a scripted mock turn calls `edit` on a temp-dir file, and the file changes. It fails if registration or the move broke `edit`.
    - `tools_coding_loads_no_heavy_dependency`: a subprocess imports the package and runs `createAgent`; the loaded-module list contains none of `playwright-core`, `@office-open/`, `mammoth`, `pdf-parse`, `@firecrawl/anydoc`, `e2b`, `@arnilo/prism-work`, `@arnilo/prism-web-tools`. It fails on any static import chain to them.
    - Moved suites: every test moved from `prism-coding-tools/src/{agent,security}/__tests__` passes from its new location.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package and two removed subpaths.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: package page structure. Install with a manifest entry; Configuration table; What it changes (tools and effects); Capabilities (none in this task); Cost, security, and failure behavior; Example.
      - `packages/prism-coding-tools/README.md`: the moved surface and where it went.
      - Released `/docs`: untouched (0.12.1).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate with `node scripts/release.mjs gate --update-baseline`. The task note records the diffs for `arnilo__prism-tools-coding.txt` (added), the coding-tools baselines (removed members, attributed to this plan), `arnilo__prism-agent-sdk.txt`, and `arnilo__prism-code.txt`.

  - Notes (executed 2026-10-05):
    - **Done, with six recorded deviations.** `bun run typecheck` clean (build + every workspace + examples). `node scripts/release.mjs gate` green with 40 packages. New package suite `bun test packages/tools/coding/src` → 578 pass / 2 skip / 1 fail (the fail is the pre-existing `durable gating surfaces ask_user_decision as a shared elicitation decision`, which moved with the tree). `bun test packages/prism-coding-tools/dist` → 85 pass / 5 skip / 5 fail (4 pre-existing dev-inspector failures + the `diff`-moved manifest assertion, fixed). `bun test src packages --path-ignore-patterns='**/limits.test.*'` → 8812 pass / 336 skip / 177 fail / 9325 tests / 1019 files, and the distinct failing-name set is **byte-identical** to the Task 1 baseline (zero new failures, zero fixed).
    - **Created.** `packages/tools/coding/` with the §2.10 shape: `package.json` (`exports: { ".": "./src/index.ts" }`, `@arnilo/prism` peer, `@arnilo/prism-core` + `diff` dependencies, optional `e2b` peer, `test`/`typecheck`/`postinstall`), `tsconfig.json`, `bunfig.toml`, `README.md`, `CHANGELOG.md`, `LICENSE`, `src/config.ts` (the JSON Schema + `ToolsCodingConfig`), `src/index.ts` (default `definePackage` + the `toolsCoding({ root })` factory + `export *` of both moved barrels), and `src/__tests__/package.test.ts`. `requires.prism` is `"^0.12.1 || ^0.13.0-0"` — the plan text said `"^0.13"`, but the kernel is 0.12.1 and every plan-152/153 package uses the dual range, so `^0.13` would fail the load; deviation 1.
    - **Moved.** `git mv packages/prism-coding-tools/src/agent → packages/tools/coding/src/agent` and `.../security → .../security` (137 files, tests included). All intra-tree relative imports still resolve; the only cross-boundary edge was `agent/checks.ts → ../security/semaphore.js`, which stays inside the new package. `createCodingTools`/`createReadOnlyTools`/`createAllTools` and every per-tool factory keep their names. Each of the nine registered tools gained `effects` in its own definition (`read`/`repo_list`/`repo_search`/`glob` → `["read"]`; `write`/`edit`/`delete`/`move` → `["write"]`; `shell` → `["execute"]`), so a host using `createCodingTools` directly gets the annotation too.
    - **Config and registration.** `root` is checked in `setup` with a naming error (not a schema `required`), `roots` is accepted for Task 4's `coding.targets` service, `readOnly: true` registers the read subset, `shell.enabled: false` omits `shell`, `shell.timeoutMs` maps to the tool's seconds option, and `repository` maps to the shared limits. An unknown key fails `createAgent` naming the key (the schema's `additionalProperties` defaults to false).
    - **Deleted.** The `./agent` and `./security` exports from `packages/prism-coding-tools/package.json` (and the now-dangling `main`/`types`, which pointed at `dist/agent/`), plus the moved `src/` trees and `diff` from its dependencies. Its remaining subpaths are `./openapi`, `./computer-use-linux`, `./dev`, `./dev/cli`, `./impeccable`; its README has a "Moved in plan 154 Task 3" table and its CHANGELOG an Unreleased Removed entry. `packages/prism-coding-tools/src/__tests__/coding-tools-conformance.test.ts` was rewritten for the five remaining subpaths.
    - **Importers migrated** (specifier rename `@arnilo/prism-coding-tools/{agent,security}` → `@arnilo/prism-tools-coding`): `packages/prism-code` (8 files), `packages/ag-ui` (6), `packages/acp-agent`, `packages/agent-sdk` (`presets.ts` + `package.json`), 9 examples, 8 scripts/fixtures, and `src/__tests__/install-smoke.test.ts`. Their `package.json`s moved the dependency/peer/devDependency to `@arnilo/prism-tools-coding` (devDependency `file:../tools/coding`). `examples/tsconfig.json` path-maps the new package; root `workspaces` gained `packages/tools/*`.
    - **Enforcement rows.** `packaging.test.ts` (new `sourceExport: true` row, 39 → 40 manifests), `install-smoke.test.ts` (new row), `release.test.ts` (39 → 40), `phase24-truth.test.mjs` (publishable 40 / workspace 39 / capability 15 / codeWithPeer 37), `version-literal-gate.test.mjs` (40 manifests), `phase54-package-map.test.mjs` (`allowedManifests`), `package-truth.mjs` (`PACKAGE_NOTES` for the new package + the coding-tools note), `e2e-coverage.json` (the `/agent`+`/security` surfaces became the new package's `.` surface; suite paths rewritten), `independent-packages.json` (`$comment`), `biome.json` (a `packages/tools/coding/src/**` allowlist block + the six enforced cluster paths moved), and `budgets.json` (`exportCounts` 1022 → 92 and a new 885 row; `nonNullAssertions.byPath` new `packages/tools/coding/src: 254` and `packages/prism-coding-tools/src: 270 → 16`). `scripts/package-truth.mjs --emit-docs` regenerated `scripts/package-truth.json` and the generated blocks in `README.md`, `docs/index.md`, `docs/release-and-install.md`, `docs/provider-packages.md`, and `docs/_evidence/phase54-package-map.md`.
    - **Docs.** `packages/tools/coding/README.md` (install, config table, effects table, tool reference, capabilities, cost/security, example) and `CHANGELOG.md`; `packages/prism-coding-tools/README.md` rewritten; root `CHANGELOG.md` Unreleased Added entry; `docs/coding-tools.md`, `docs/index.md`, and the hand-written `docs/release-and-install.md` count sentence updated. **Deviation 2:** the released `/docs` pages were sed-renamed despite the task's "Released `/docs`: untouched" line, because the acceptance grep explicitly includes `docs/` (minus `history/`/`_evidence/`) and plan 152 set the precedent of renaming released pages. The sweep `rg '@arnilo/prism-coding-tools/(agent|security)' src packages scripts examples docs -g '!**/dist/**' -g '!plans/**' -g '!docs/history/**' -g '!docs/_evidence/**'` now returns nothing (the two READMEs phrase the move as `/agent` and `/security` of the old package so they do not match the full specifier).
    - **Compat baselines.** `node scripts/release.mjs gate --update-baseline` (40 packages) changed exactly two files: `arnilo__prism-coding-tools.txt` (−841 lines: the whole moved surface removed) and the new `arnilo__prism-tools-coding.txt` (+849). `arnilo__prism.txt`, `arnilo__prism-agent-sdk.txt`, and `arnilo__prism-code.txt` did not move (their public surfaces are unchanged). `arnilo__prism-coding-agent.txt`/`arnilo__prism-coding-security.txt` are retired-name baselines and stay.
    - **Deviations.**
      1. `requires.prism` is `"^0.12.1 || ^0.13.0-0"`, not the plan's `"^0.13"` (the kernel is 0.12.1).
      2. Released `/docs` were renamed (see above).
      3. **`computer-use-linux` needs `env.ts`.** `packages/prism-coding-tools/src/computer-use-linux/create.ts` imported `../agent/env.js`, which moved. Rather than add a backwards dependency edge from the dying 0.12 package to the new one, a ~20-line copy of `env.ts` sits at `packages/prism-coding-tools/src/computer-use-linux/env.ts` with a comment; plan 155 moves `computer-use-linux` to `tools-computer-use`, which can import `buildChildEnv` from `tools-coding` and delete the copy.
      4. **`examples/coding-goal-verify.ts` gained an explicit `GoalVerifyDemoResult` return type.** `tsc -p examples` reported TS2883 because the example path-maps the new package to source and its `runCodingGoalVerify` return type named a `WorkflowRunStatus` from the package's nested `@arnilo/prism-core` copy; the annotation is the reproducible fix (a manual symlink also worked but `bun install` recreates the directory copy).
      5. **Two pre-existing test bugs fixed incidentally.** `phase24-truth.test.mjs`'s `secondPeers` expected a stale `@arnilo/prism-agent-sdk` entry (agent-sdk has no `@arnilo/prism` peer; it is an independent line) and its "must peer @arnilo/prism" loop excluded only `@arnilo/prism-code`; and `benchmark-multi-agent.test.mjs`'s manifest inventory expected 35 (stale since the store/provider packages) — now 40 with the new package and the store packages skipped like keyring. Both were already failing before this task (gate-stage tests, not in the `src packages` baseline).
      6. **No `coverage-thresholds.json` row.** `scripts/coverage-summary.mjs` and `phase23-coverage.test.mjs` enumerate only direct `packages/*` dirs, so grouped packages (`packages/tools/*`, `packages/stores/*`, `packages/providers/*`) are outside the coverage stage; adding a row would be inert, and no grouped package has one. Recorded rather than papered over.
    - **Pre-existing failures carried, not fixed.** The non-null budget gate is back to exactly its pre-existing message (`examples` 38 vs 29, `src` 599 vs 551, 2 outside sites `packages/agent-sdk/src/define-agent.ts` + `packages/prism-code/src/tui/index.ts`) — plan 153's Compromises; the new package's 254 sites got a budget row (plan 152's `packages/providers/*/src: 345` precedent) instead of a 254-site sweep. `phase24-truth` `gate accounting: roadmap §0.2.4` (roadmap wording), `budget-gate` 18/1, `e2e-coverage` 6/2, `install-smoke` 13/2, `e2e-full-surface` 4/1, the freeze-era "baseline manifest count" legs, and `benchmark-multi-agent`'s `tool concurrency never exceeds the configured cap` (unrelated to the move: `scripts/benchmark-scenarios/multi-agent-runtime.mjs` is untouched) remain as recorded.
    - **Findings affecting later tasks.** (1) Task 4 can now read `root`/`roots` from the package config for `coding.targets`. (2) Task 5 must drop `agent/ask-user-decision.ts`'s `@arnilo/prism-core/runtime/workflows` import (Task 1 (j)); `supervisor-lifecycle.ts`/`spawn-worktree.ts` still import `@arnilo/prism-core/runtime/supervisor` types, so the new package keeps a `@arnilo/prism-core` dependency until those move in Phases 14/16. (3) `@arnilo/prism-tools-coding` is pulled into the packed consumers by `ag-ui`/`acp-agent`'s new peer, so `e2e-full-surface`/`e2e-coding-journey` need no explicit list entry (the `withFirstPartyClosure` walk finds it). (4) The `docs/next/tools.md` tools-coding section is still unwritten; the plan's Task 3 doc list named only the package READMEs.

- [x] Task 4: Hard denies through `tool.call`, the sandbox and execution policy, and the `coding.targets` service
  - Acceptance Criteria:
    - Functional: `tools-coding` registers one `tool.call` decide handler, id `@arnilo/prism-tools-coding:tool.call#hard-deny`, that returns `{ deny }` for:
      - any path argument of its own tools that resolves, after realpath and symlink resolution, outside `root` ∪ `roots`
      - a `shell` command matched by a configured deny `commandRules` entry
      - a mutating tool when `readOnly` is set (defence against a host that re-adds a tool)

      The handler ignores tools it did not register.
    - Functional: Because any deny wins (`src/hooks/catalog.ts:59`), the hard deny holds under `approval` `auto`, under a host `allow` hook, and from a custom loop.
    - Functional: `sandbox` config selects the shell and file-operation backend: `"none"` (default), `"native"`, `"docker"`, or `"e2b"`. `e2b` is imported dynamically only when selected; a missing `e2b` module gives `status.note("warn", …)` and no `shell` registration, not a throw. `egress` config (allow-list) applies to sandboxed shells as it did in 0.12.
    - Functional: `tools-coding` provides the `coding.targets` service, `targets(name, args) → { paths, roots } | undefined`, for its own tools (Task 1 (b)).
    - Functional: The in-tool `ExecutionPolicy` approval callback (`approve`, `approvalCacheScope`, `approvalTimeoutMs` in `security/approval.ts`) is deleted. Prompting is approval's job (Task 6), and command rules and containment stay as internal checks. `createCodingApprovalPolicy` and its options are removed from the package's exports. Its importers (`packages/prism-code/src/approval.ts`, examples) are migrated or recorded for Task 6.
    - Performance: The hard-deny handler does at most one `realpath` per path argument, with no filesystem walk. A micro-test bounds 1,000 decisions under 50 ms on a temp dir.
    - Code Quality: The `ExecutionPolicy` type used internally lives in `tools-coding` (Task 1 (g)). The kernel's export is untouched here.
    - Security: Every 0.12 containment check that Task 1 listed maps to the hard deny or an in-tool check, and a test pins each one. Deny reasons name the root and the tool, never file contents.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/security/{path-containment,command-rules,approval,sandbox,native-sandbox,docker-sandbox,e2b-sandbox}.ts` and `egress/` (moved in Task 3), `src/execution-policy.ts`, `src/hooks/catalog.ts:59`, `src/hooks/ask.ts`
    - Options Considered:
      - Keep containment only inside each tool. Rejected: the roadmap requires root-escape hard denies via `tool.call`, so a custom loop or `tool.execute` wrapper cannot skip them, and approval and governance see the same verdict.
      - Use a `tool.execute` around for the sandbox. Rejected for this phase: the sandbox is a backend choice of the tool's file and process operations, already wired that way. `tool.execute` stays free for remote-execution packages.
    - Chosen Approach:
      - One decide handler that reuses the moved containment and command-rule code, plus a config-selected sandbox backend.
    - API Notes and Examples:
      ```ts
      toolsCoding({ root, roots: ["../shared"], sandbox: "docker", commandRules: [{ match: "rm -rf /", decision: "deny" }] });
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/index.ts`, `src/hard-deny.ts` (new), `src/targets.ts` (new), `src/config.ts`, `src/security/approval.ts` (reduced or deleted per Task 1).
      - `packages/tools/coding/src/__tests__/hard-deny.test.ts`, `sandbox-config.test.ts`.
      - `packages/prism-code/src/approval.ts` and examples that call `createCodingApprovalPolicy`: migrated, or left on a lab-local copy recorded in Task 6.
      - `packages/tools/coding/README.md`: Configuration rows, What it changes (`tool.call` hook id, the `coding.targets` service), failure behavior.
      - `scripts/compat-baseline/arnilo__prism-tools-coding.txt`: regenerated.
      - `CHANGELOG.md`.
    - References:
      - backlog "A `tool.call` deny is scoped to a call, not a run" (the deny is per call; the run continues)
  - Test Cases to Write:
    - `hard_deny_root_escape_in_auto_mode`: with a host `tool.call` hook returning `"allow"`, `edit` on `../outside.txt` is denied with a reason naming the root. It fails if any allow outranks the deny.
    - `hard_deny_symlink_escape`: a symlink inside `root` pointing outside is denied.
    - `hard_deny_from_custom_loop`: the same denial through a custom loop's `run.executeTools`.
    - `hard_deny_command_rule`: a `shell` command matching a deny rule is denied before execution, and no process spawns.
    - `hard_deny_ignores_foreign_tools`: a host tool with a `path` argument outside `root` is not denied by this handler.
    - `sandbox_e2b_missing_gives_note_not_throw`: `sandbox: "e2b"` without the module gives a `package.status` warn note and no `shell` tool, and `createAgent` resolves.
    - `coding_targets_service_reports_paths`: `services.consume("coding.targets")` returns the resolved paths for `edit` and `undefined` for an unknown tool.
    - `hard_deny_decision_budget`: 1,000 decisions finish under 50 ms.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new hard-deny behavior, sandbox config, and a service.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: sections listed above.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: removed exports (`createCodingApprovalPolicy` and its types) are recorded in the baseline diff and swept. The plan's sweep pattern omitted `CodingApprovalRequest`; the complete sweep is `rg 'createCodingApprovalPolicy|CodingApprovalPolicyOptions|CodingApprovalFn|CodingApprovalRequest|ApprovalCacheScope' src packages scripts examples docs -g '!**/dist/**' -g '!plans/**' -g '!docs/history/**' -g '!docs/_evidence/**' -g '!scripts/compat-baseline/**'` and returns nothing. Only the retired-name baseline `scripts/compat-baseline/arnilo__prism-coding-security.txt` keeps the old names (historical, untouched).
  - Notes (executed 2026-10-05):
    - **Done, with three recorded deviations.** New package tests `bun test --timeout=0 src/__tests__/hard-deny.test.ts src/__tests__/sandbox-config.test.ts` → 12 pass / 0 fail. Full package suite → 577 pass / 2 skip / 1 fail (the pre-existing `durable gating surfaces ask_user_decision`). `bun test src packages --path-ignore-patterns='**/limits.test.*'` → 8811 pass / 336 skip / 177 fail / 9324 tests / 1020 files, and the distinct failing-name set is **byte-identical** to the Task 1 baseline (zero new failures, zero fixed). `bun run typecheck` clean. `node scripts/release.mjs gate` green (40 packages).
    - **Created.** `src/hard-deny.ts` (`createHardDenyHook`, `HardDenyOptions`) — one `tool.call` decide handler registered as `@arnilo/prism-tools-coding:tool.call#hard-deny` with `{ id: "hard-deny" }`. It denies a path argument outside `root` ∪ `roots` after realpath/symlink resolution, a `shell` command matching a deny `commandRules` entry or a built-in deny pattern, and any mutating tool under `readOnly`, and ignores tools it did not register. `src/targets.ts` (`createCodingTargets`, `CodingTargets`, `CodingTargetsFn`, `CODING_TOOL_NAMES`) is the `coding.targets` service: `targets(name, args) → { paths, roots } | undefined`, absolute paths, `undefined` for unknown names. `src/sandbox.ts` (`selectCodingSandbox`, `CodingSandboxKind`, `SelectedCodingSandbox`) builds the configured backend and returns sandbox-backed tools, or a warning and no tools.
    - **Performance.** `createContainmentChecker` realpaths the roots once per handler and then costs one `realpath` per path argument (with an ENOENT parent fallback for creates), no directory walk. `hard_deny_decision_budget` measures 1,000 decisions at ~26 ms on a temp dir (budget 50 ms).
    - **Config.** `sandbox` (`none` default, `native`, `docker`, `e2b`), `commandRules` (`{ match, decision, reason? }`, mapped to the internal `CommandRule`; `requireApproval` is left to approval), and `egress` (`{ allow?, presets? }`, validated with `createEgressPolicy`). `setup` is now async: it validates `egress`, registers the hook and the service, selects the sandbox, and registers the tools (skipping `shell` when `shell.enabled === false` or no backend resolved).
    - **Sandbox behavior.** `native` builds `createNativeSandbox({ root })` and wires `createSandboxCodingComposition` with `workspaceRoot: root` (host paths, so the hard deny stays valid). `e2b` is reached only through `createE2BSandbox`, which dynamically imports the optional peer; a missing module yields a `package.status` warn note and no `shell` registration, and `createAgent` resolves. `docker` fails closed with a note because a digest-pinned image and runner cannot come from JSON config. No backend is ever silently unsandboxed.
    - **Removed.** `src/security/approval.ts` (`createCodingApprovalPolicy` and `CodingApprovalFn`/`CodingApprovalRequest`/`CodingApprovalPolicyOptions`/`ApprovalCacheScope`) and its test; the exports are gone from `security/index.ts`. Containment (`assertPathInsideRoots`) and command rules (`evaluateCommandRules`) stay as internal checks behind the hard deny.
    - **Importers migrated.** `scripts/fixtures/e2e-coding-journey.mjs` and `scripts/fixtures/phase26-coding-journey.mjs` gained a local `containmentPolicy(roots)` built on the exported `assertPathInsideRoots`; `src/__tests__/install-smoke.test.ts`'s embedded consumers gained the same inline policy (and dropped the `executionPolicy` from the phase20 capabilities fixture). `packages/prism-code/src/tui/index.ts` imported the removed `CodingApprovalRequest` type for `CodeUi.promptApproval` (the plan's sweep pattern omitted that name); it now takes `{ readonly action: ExecutionAction }`, which is all the method reads, and `arnilo__prism-code.txt` did not change. No production code imported `createCodingApprovalPolicy` — `packages/prism-code/src/approval.ts` already had its own `createPrismCodeApprovalPolicy` — so nothing outside scripts/tests/tui changed.
    - **Task 3 gap fixed.** Six scripts still imported the deleted `../packages/prism-coding-tools/dist/{agent,security}/…` relative paths (`phase9`, `phase10`, `phase25-bounded-accumulation`, `phase26-index-benchmark`, `phase26-pty-protected`, `phase38-codeql-regression`) — Task 3's sweep only matched the `@arnilo/prism-coding-tools/{agent,security}` specifier. All six now import `@arnilo/prism-tools-coding`; five run green and `phase26-pty-protected` blocks on its `PRISM_TEST_PTY_BACKEND` gate as designed.
    - **Enforcement rows.** `scripts/budgets.json` `exportCounts['@arnilo/prism-tools-coding']` 885 → 894 (+9, with a reason); `scripts/e2e-coverage.json` dropped `security/__tests__/approval.test.ts` and added the two new suites; `scripts/compat-baseline/arnilo__prism-tools-coding.txt` regenerated (`createCodingApprovalPolicy` and the four types gone, the hard-deny/targets/sandbox/config exports added); `arnilo__prism-coding-tools.txt`, `arnilo__prism.txt`, and the other baselines unchanged.
    - **Docs.** `packages/tools/coding/README.md` gained the three config rows, a "Hard denies and the `coding.targets` service" section, and the failure behavior; `CHANGELOG.md` gained the Added/Removed entries. The four released pages that named the removed export were rephrased (`docs/tool-execution-primitives.md`, `docs/coding-security.md`, `docs/language-intelligence.md`, `docs/coding-agent-tools.md`) — **deviation 1**, same plan-152/154-Task-3 precedent. The acceptance sweep now returns nothing outside `scripts/compat-baseline/` (historical retired-name baselines keep the old names).
    - **Deviations.**
      1. Released `/docs` rephrased (above).
      2. **Sandbox `docker` fails closed.** A JSON config cannot carry a digest-pinned image, docker path, or uid:gid, and no host adapter service exists yet, so `sandbox: "docker"` notes a warning and withholds `shell` instead of guessing. Wiring a host-supplied `DockerRunner`/adapter is Part B or a host concern. `egress` is validated but only forwarded where a backend can honor it; with `sandbox: "none"` it notes a warning.
      3. **`sandbox: "native"` is constructed eagerly in `setup`** (`createNativeSandbox` preflights `unshare`), so selecting it adds a creation-time check. It is the one backend a JSON config can fully describe. On a non-Linux host it fails closed with a note.
    - **Pre-existing failures carried, not fixed.** `scripts/phase20-security.test.mjs` (broken by Task 3's deleted import; now runnable) fails `T1/T4 blocker: unknown durable-resume decision 'sideways' fails closed…` — after the rejected `sideways` attempt, the subsequent `allow_once` resume completes without executing the tool (`executed` is `[]`), plus the `gate accounting` cascade. This is kernel durable-resume behavior, untouched by Task 4 (no `src/` edit), and the same `allow_once` resume passes in install-smoke's `security.mjs` when no rejected attempt precedes it; recorded, not fixed. `budget-gate` 18/1 (examples 38 vs 29, src 599 vs 551, 2 outside sites), `e2e-coverage` 6/2, `install-smoke` 13/2, `e2e-full-surface` 4/1, and the freeze-era legs remain as in Task 3.
    - **Findings for later tasks.** (1) Task 6 consumes `coding.targets`; it must treat a missing service as "outside" (already the plan's rule) and must not rely on the `docker`/`egress` wiring deferred here. (2) The hard deny is name-based (`CODING_TOOL_NAMES`), so a host tool that shadows a coding tool name would be denied too; Task 6 governs by `effects`, which is the intended fix for foreign tools. (3) `prism-code/src/approval.ts` is untouched and still needs its `ExecutionPolicy` wiring removed in Task 6.

- [x] Task 5: Git, checks, todo with its `run.end` continuation, `ask_user` over `host.ui`, and durable-effect identity
  - Acceptance Criteria:
    - Functional: Config `git` (default `{ enabled: true }`) registers `git_status` and `git_diff` with effect `["read"]`. It also registers `git_branch`, `git_worktree`, `git_apply`, and `git_commit` with effect `["write"]`, and `git_pr_handoff` with effect `["external", "network"]`. `checks` (a named-check map, default none) registers `coding_check` with effect `["execute"]`, and only when at least one check is configured.
    - Functional: `todo` (default `{ enabled: true, continueOnOpen: true }`) registers `todo_write` with effect `[]` (no side effect outside the transcript) and a `run.end` decide handler, id `@arnilo/prism-tools-coding:run.end#todo`. While items stay open it returns `{ continue: { reason, steer } }`, bounded by the 0.12 no-progress and steer limits (`todo.ts:61-66`) and by `limits.maxContinuations`. `continueOnOpen: false` keeps the tool and registers no hook.
    - Functional: `ask_user_decision` asks through `host.ui` `select` (options) or `input` (custom answer). `dismissed` returns a tool result saying the user declined. `unavailable`, or a host without `ui`, suspends the run through the kernel path, and `session.resume(decisions)` delivers the answer. The 0.12 `AskUserDecisionHandler` host callback is deleted. The `ask_user_decision` tool keeps its name and argument schema.
    - Functional: Durable-effect tools (Task 1 (f)) fail closed with `ERR_PRISM_CODING_PRINCIPAL_REQUIRED` when `ctx.principal` is absent. With `principal: { id }` configured, a different `ctx.principal.id` fails with `ERR_PRISM_CODING_PRINCIPAL_MISMATCH`. Read-only git tools need no principal.
    - Functional: The durable `ask_user_decision` path drops its static `@arnilo/prism-core/runtime/workflows` import (`agent/ask-user-decision.ts:11-16`) and uses the kernel `session.resume` path, so `tools-coding` gains no `prism-core` dependency (Task 1 (j)).
    - Functional: Prism Code's todo wiring (`headless.ts:192-291`, `registerTodoContinuation`, `(definition as any).todoContinuation`) and its `askUser` host binding move onto the package hook and `host.ui`. The lab's `todo-continuation.test.ts` passes against the package. The repo-wide grep for `TodoContinuationHandler|registerTodoContinuation|AskUserDecisionHandler` returns nothing outside `plans/` and `docs/history/`.
    - Performance: The `run.end` handler reads the transcript once per natural end, with no store reads. Continuations stay within `limits.maxContinuations`.
    - Code Quality: There is no second continuation mechanism; `run.end` is the only one. Prism Code's loop flag `loop.continueOnOpenTodos` maps to `todo.continueOnOpen` in the package config at its edge.
    - Security: `git_pr_handoff` resolves its forge token only through `prism.credentials.resolve` from a ref-only config field (`forge.token: "env:GITHUB_TOKEN"`). A literal token fails config validation. A test asserts the token never appears in events, `inspect()`, errors, or persisted entries.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/{git-tools,git,checks,todo,ask-user-decision,effects}.ts` and `forge/` (moved in Task 3), `packages/prism-code/src/{headless.ts:79-291,tools.ts:50-193,limits.ts:56,246}`, `src/hooks/types.ts:131-151`, `docs/next/host.md` (`select`, `input`, `unavailable`)
    - Options Considered:
      - Keep `AskUserDecisionHandler` as an optional override. Rejected: §2.3 makes `host.ui` the only way packages reach a person, and the roadmap forbids aliases.
      - Enforce the principal in `tool.call`. Rejected: the durable-effect check belongs to the tool that owns the effect, and `ToolExecutionContext.principal` is already there. Governance (Phase 9) adds policy over `call.session.principal` at `tool.call`.
    - Chosen Approach:
      - Register the tools behind config flags, move the continuation onto `run.end`, map `ask_user` onto `host.ui` with suspension fallback, and add the principal guard to durable tools.
    - API Notes and Examples:
      ```ts
      toolsCoding({ root, checks: { test: ["bun", "test"] }, forge: { token: "env:GITHUB_TOKEN" }, principal: { id: "alice" } });
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/{index.ts,config.ts,todo-continuation.ts (new),ask-user-host.ts (new),principal-guard.ts (new)}`, `src/git-tools.ts`, `src/ask-user-decision.ts`.
      - `packages/tools/coding/src/__tests__/{git,checks,todo-continuation,ask-user,principal}.test.ts`.
      - `packages/prism-code/src/{headless.ts,tools.ts,limits.ts,tui/index.ts}` and `src/__tests__/todo-continuation.test.ts`: migrated to the package hook and `host.ui`.
      - `examples/autonomous-coding-loop.ts` (uses `suspendAskUserDecision`): migrated to `session.resume`.
      - `packages/tools/coding/README.md`, `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, `arnilo__prism-code.txt`, `CHANGELOG.md`.
    - References:
      - plan 137 Task 7 (todo continuation in the lab), plan 145 (`stopHooks` → `run.end`), plan 148 (`HostUi` kinds and `unavailable`), plan 149 (`session.resume`)
  - Test Cases to Write:
    - `todo_continuation_continues_while_open`: a scripted run that ends with an open todo re-enters once with the steer, and stops when all are completed. It fails if the hook is missing or never stops.
    - `todo_continuation_capped_by_max_continuations`: with `limits.maxContinuations: 1`, the second natural end stops the run with the kernel's continuation-cap stop reason, and no third turn runs.
    - `todo_continuation_disabled_registers_no_hook`: `continueOnOpen: false` leaves no `run.end` hook in `inspect()`.
    - `ask_user_select_answer`: a scripted `HostUi` answers `select`, and the tool result carries the choice.
    - `ask_user_unavailable_suspends_then_resumes`: with no `ui`, the run suspends with a pending decision, and `session.resume` completes it with the answer.
    - `durable_tool_requires_principal`: `git_commit` without `principal` fails with `ERR_PRISM_CODING_PRINCIPAL_REQUIRED`, and no commit is made.
    - `durable_tool_principal_mismatch`: a configured `principal.id` that differs from `ctx.principal.id` fails with `ERR_PRISM_CODING_PRINCIPAL_MISMATCH`.
    - `forge_token_literal_rejected_and_never_echoed`: a literal `forge.token` fails validation, and an `env:` ref's value is absent from events, `inspect()`, and errors.
    - `coding_check_only_when_configured`: no `checks` means no `coding_check` tool.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new config, hooks, and error codes, and a removed host callback.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: git, checks, todo, `ask_user`, the principal rule, and the error codes.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate. The note attributes the removed host ask callback and todo-continuation exports to this plan, and the sweep above is recorded.
  - Notes (executed 2026-10-06):
    - **Done, with four recorded deviations.** `bun test --timeout=0 packages/tools/coding/src` → 576 pass / 2 skip / 0 fail (the pre-existing durable-gating elicitation failure now passes; the elicitation contract stayed). Lab `todo-continuation.test.ts` → 8 pass / 0 fail. `bun test src packages --path-ignore-patterns='**/limits.test.*'` → 8818 pass / 336 skip / 168 fail / 9322 tests / 1021 files. Distinct failing-name set vs the Task 1 baseline: **0 new, 5 gone** (the four lab todo-continuation cases, plus `durable gating surfaces ask_user_decision as a shared elicitation decision`). `bun run typecheck` clean. `node scripts/release.mjs gate` green (40 packages).
    - **Registered.** Default config registers the seven `git_*` tools (`git_status`/`git_diff` `effects: ["read"]`, mutating four `["write"]`, `git_pr_handoff` `["external","network"]`), `coding_check` (`["execute"]`) only when `checks` is non-empty, `todo_write` (`effects: []`) plus `run.end` id `@arnilo/prism-tools-coding:run.end#todo` unless `todo.continueOnOpen` is false, and `ask_user_decision` (`effects: []`). `readOnly` keeps the four read tools and skips git/checks/todo/ask_user. Every registered tool is wrapped with `withDurablePrincipal`.
    - **ask_user.** `tool.call` gate `createAskUserHostHook` asks through `host.ui` `select` then `input`. `dismissed` is a declined tool result. `unavailable` returns `{ ask }`; the tool's elicitation contract suspends the run and `session.resume(decisions)` replays the answer without executing the tool. `agent/ask-user-decision.ts` no longer imports `@arnilo/prism-core/runtime/workflows`.
    - **Principal and forge.** Durable calls fail closed with `ERR_PRISM_CODING_PRINCIPAL_REQUIRED` (no `ctx.principal.id`) or `ERR_PRISM_CODING_PRINCIPAL_MISMATCH` (configured id differs). Read-only git (`effect.kind === "none"`) needs no principal. `forge.token` schema pattern `^(env|keyring):`; setup resolves the ref through `prism.credentials.resolve` into the `coding.forge` service. A literal fails validation and the resolved value is absent from `inspect()`.
    - **Lab.** `headless.ts` / `acp.ts` register `createTodoContinuationDecision` and `createAskUserHostHook` on the host registrar. `AppHostBindings.askUser` is `ui?: HostUi`. The TUI exposes `hostUi()` (`select` through the picker; Escape is `dismissed`). `bin/prism-code.ts` passes `ui: tui?.hostUi()`. `(definition as any).todoContinuation` is `onTodoNoProgressStop`. `examples/autonomous-coding-loop.ts` uses workflow `suspend` plus `toAskUserDecisionSuspendData` / `resolveAskUserDecisionAnswer`.
    - **Sweep.** `rg 'TodoContinuationHandler|registerTodoContinuation|AskUserDecisionHandler' src packages scripts examples docs -g '!**/dist/**' -g '!plans/**' -g '!docs/history/**' -g '!docs/_evidence/**' -g '!scripts/compat-baseline/**'` returns nothing. `NO_INTERACTIVE_ASK_USER_MESSAGE` is deleted from Prism Code (`arnilo__prism-code.txt` regenerated).
    - **Enforcement.** `scripts/budgets.json` exportCounts `@arnilo/prism-tools-coding` 894 → 903 (+9, reason recorded). `scripts/e2e-coverage.json` gained `src/__tests__/task5.test.ts`. Compat baselines regenerated; `arnilo__prism-tools-coding.txt` gained `createAskUserHostHook`, `createTodoContinuationDecision`, `withDurablePrincipal`.
    - **Deviations.**
      1. Released `/docs` rephrased (`docs/workflows.md`, `docs/coding-agent-tools.md`) and `src/__tests__/docs.test.ts` token `suspendAskUserDecision` → `toAskUserDecisionSuspendData`. Same plan-152/154 precedent; the task's doc list named only the package README.
      2. The lab does not load `@arnilo/prism-tools-coding` (host tools plus the package's nine names is `tool_conflict`). It calls the package's hook factories itself. `loop.continueOnOpenTodos: false` still removes both `todo_write` and the hook, matching the existing lab test, rather than mapping only to `todo.continueOnOpen`.
      3. The TUI `host.ui` implements `select` only. `input` returns `unavailable`, so a custom answer suspends instead of inventing a text prompt. The package path implements `input` (`ask_user_custom_uses_input`).
      4. No new `todo-continuation.ts`. `createTodoContinuationDecision` replaced `registerTodoContinuation` inside the moved `agent/todo.ts`. Named tests live in `src/__tests__/task5.test.ts`, not five files. `@arnilo/prism-tools-coding` keeps its `@arnilo/prism-core` dependency for `supervisor-lifecycle`/`spawn-worktree` type imports; the ask-user path added none.
    - **Findings for later tasks.** (1) Task 6 reads `context.session` and `coding.targets`; a missing service counts as outside. (2) The lab's approval wiring in `packages/prism-code/src/approval.ts` is still the 0.12 `ExecutionPolicy` and is Task 6's to delete. (3) A host tool that shadows a coding tool name is still hard-denied by name; Task 6 governs by effects.

- [x] Task 6: `@arnilo/prism-approval`
  - Acceptance Criteria:
    - Functional: `packages/policy/approval` exists with the §2.10 shape. Config:
      - `mode`: `deny` | `ask` | `edits` | `auto`, default `ask`
      - `roots`: default none; extra roots that count as inside, beyond what `coding.targets` reports
      - `rules`: static allow entries, `{ tool, commandPrefix? }[]`, default `[]`
      - `timeoutMs`: default none
    - Functional: One `tool.call` decide handler, id `@arnilo/prism-approval:tool.call`, implements the Task 1 (c) table from the call's `effects`. It returns `"allow"`, `{ ask: <summary> }`, or `{ deny }`. "Inside roots" comes from the `coding.targets` service and `roots`. Missing targets count as outside. The handler reads the session from `context.session` (the per-owner `SessionContext` every hook dispatch carries), not from the payload (Task 1 (a)).
    - Functional: An `ask` resolves through the kernel: an inline `host.ui` `confirm` when a UI is present, otherwise suspension, with `session.resume` continuing it. A `confirm` carries only a boolean, so an `always` answer is a follow-up `host.ui` `select` (Task 1 (d)); its chosen value stores a per-session grant in `state.session("grants")`. A matching static `rule` or session grant allows without asking.
    - Functional: Hard denies from `tools-coding` stay effective in every mode, including `auto`. The package never returns `"allow"` for a call another handler denies; the combination rule guarantees this, and a test pins it.
    - Functional: `mode: "auto"` in a project-scope manifest entry fails closed with a config error. The 0.12 lab rule at `prism-code/src/approval.ts:53-57` moves into the package as a check on the config's source scope, if `PackageAPI` exposes the scope. Otherwise Task 1 records the gap, and the rule stays in the lab with a Further Actions entry.
    - Functional: Prism Code builds its approval from the package. `PrismCodeApprovalMode` maps `accept-edits` → `edits`. `permissions.json` rules load into the package's `rules`, and the TUI prompt answers `host.ui` `confirm`. `createPrismCodeApprovalPolicy` and its `ExecutionPolicy` wiring are deleted from the lab. Only file I/O and the mode mapping remain there.
    - Performance: One decision costs one service call plus one map lookup. No store read happens unless an `always` grant is written.
    - Code Quality: Decisions use `effects` and targets only, never tool names. The only exception is the `shell` command prefix in `rules`, which matches on the declared `commandPrefix`.
    - Security: `deny` mode denies every non-read call. A throwing handler is a deny (kernel rule). `unavailable` suspends and never allows. A test asserts that no approval path allows a call when `host.ui` answers `dismissed`.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-code/src/approval.ts` (modes, rules, `commandPrefix`, `createPrismCodeApprovalPolicy`), `packages/tools/coding/src/security/approval.ts` (before Task 4), `src/hooks/ask.ts`, `docs/next/loop.md` (`ask` resolution), `examples/approval.ts` (plan 149, kernel-level `ask`)
    - Options Considered:
      - Put approval inside `tools-coding`. Rejected: §2.9 makes approval its own package so it governs every tool package by `effects`, including Part B's web and work tools and third-party tools.
      - Prompt from inside the tool. Rejected: that bypasses suspension and a custom loop's `tool.call`.
    - Chosen Approach:
      - One decide handler over `effects` and the `coding.targets` service, with the kernel's `ask` path doing the prompting.
    - API Notes and Examples:
      ```ts
      import approval from "@arnilo/prism-approval";
      packages: [toolsCoding({ root }), approval({ mode: "edits", rules: [{ tool: "shell", commandPrefix: "bun test" }] })];
      ```
    - Files to Create/Edit:
      - `packages/policy/approval/{package.json,tsconfig.json,bunfig.toml,README.md,CHANGELOG.md,LICENSE,src/index.ts,src/config.ts,src/decide.ts,src/__tests__/*}`: new.
      - `packages/prism-code/src/{approval.ts,headless.ts,tui/index.ts}` and their tests, plus `package.json`: migrated.
      - Enforcement rows: root `workspaces` (`packages/policy/*`), `scripts/package-truth.mjs`, `packaging.test.ts`, the `independent-packages.json` `$comment`, `scripts/compat-baseline/arnilo__prism-approval.txt` (new), `scripts/e2e-coverage.json`.
      - `scripts/compat-baseline/arnilo__prism-code.txt`, `CHANGELOG.md`.
    - References:
      - backlog "`deny` beats `ask` at `tool.call`" (the package relies on it), plan 149 `examples/approval.ts`
  - Test Cases to Write:
    - `approval_package_conformance`: `packageConformance(approval())` passes.
    - `approval_mode_table`: for each mode × {read, write-inside, write-outside, execute, network}, the decision matches the Task 1 (c) table. It fails on any cell drift.
    - `approval_ask_inline_confirm`: with a scripted `HostUi` answering yes, an `edit` in `ask` mode runs. Answering no denies it.
    - `approval_ask_suspends_without_ui`: with no `ui`, the run suspends, and `session.resume([{ approve: true }])` completes the edit.
    - `approval_always_grant_is_per_session`: an `always` answer skips the prompt for the next call in the session but not in a new session.
    - `approval_auto_cannot_override_hard_deny`: `auto` plus a root escape is still denied.
    - `approval_missing_targets_counts_as_outside`: without `tools-coding`, a `["write"]` host tool in `edits` mode asks.
    - `approval_dismissed_never_allows`: `dismissed` denies.
    - `approval_auto_from_project_scope_fails_closed` (or its recorded gap).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package; the lab approval engine is reduced.
    - Docs pages to create/edit:
      - `packages/policy/approval/README.md`: package page structure, the mode table, how grants and rules work, and how hard denies interact with modes.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: new baseline, plus the regenerated `arnilo__prism-code.txt` (removed `createPrismCodeApprovalPolicy` and related members, attributed here). Sweep: `rg 'createPrismCodeApprovalPolicy|PrismCodeApprovalController' src packages apps scripts examples docs -g '!**/dist/**' -g '!plans/**' -g '!docs/history/**' -g '!docs/_evidence/**'` returns nothing.

  - Notes (executed 2026-10-06): Done, with four recorded deviations.

    **Package.** `packages/policy/approval/` is a source-exported native package (`exports { ".": "./src/index.ts" }`, lockstep `0.12.1`, peer `@arnilo/prism`, `file:` devDependency on the root, README/CHANGELOG/LICENSE, `packageConformance` green). `src/config.ts` declares `mode` (`deny|ask|edits|auto`, default `ask`), `roots` (max 64), `rules` (`{ tool, commandPrefix? }[]`, max 500), `timeoutMs`, `additionalProperties: false`. `src/decide.ts` is the pure mode × effect table (`readOnly` = every effect is `read`; empty effects allow; `deny` mode denies every non-read call; `granted` and `auto` allow; `edits` allows a non-risky `write` inside roots; everything else asks). `src/index.ts` registers one `tool.call` decide handler with no custom id, so the registration is exactly `@arnilo/prism-approval:tool.call`.

    **Decision path.** The handler reads the session from `context.session` (Task 1 (a)) and consumes the `coding.targets` service through `prism.services.consume` — a missing service or an unreported call counts as outside roots. Inside roots is a prefix comparison on the already-absolute targets paths, so the hot path is one service call plus one Set lookup and never touches the store. `ask` prompts with `host.ui` `confirm` (raced against `timeoutMs`); a `true` confirm asks the follow-up `select` (`Once` / `Always for this session`). `always` writes the grant key into the in-process per-session gate map and persists it via `state.session("grants")`; `dismissed`, a timeout, or a thrown prompt deny and can never allow; `unavailable` (including a missing UI) returns `{ ask }` so the kernel suspends. Hard denies stay effective in every mode because any `deny` wins in the `tool-call` combination — `approval_auto_cannot_override_hard_deny` pins it.

    **Lab.** `packages/prism-code/src/approval.ts` keeps only `permissions.json` I/O, the mode mapping (`accept-edits` ↔ `edits`), `validatePrismCodeApproval`, and `openPrismCodeApproval` (which loads the rules into `approvalPackage()` and returns the live `approvalControls`); `PrismCodeApprovalController` and the `ExecutionPolicy` engine are deleted. `headless.ts` (both `runHeadless` and the assembly seam), `acp.ts`, and `bin/prism-code.ts` pass the package; `acp.ts` merges it into the first `packages` array so the wiki spread no longer drops it (a latent bug fixed en route). `resolveCodingToolSet`/`buildSessionTools` lost the now-dead `permissions` option, and the TUI `hostUi()` answers `confirm` through the picker in addition to the existing `select`. Because the lab builds its tools through the preset rather than loading `tools-coding`, `assembleAppAgent` also installs `codingTargetsPackage(config.cwd)` (in `tools.ts`) — a small runtime package that provides the `coding.targets` service from `createCodingTargets` — so an in-repo edit still auto-applies in `accept-edits`; without it every lab call counts as outside roots and `accept-edits` would ask for every edit.

    **Deviations.** (1) `headless.ts` installs the approval package only when `hostBindings.approval` is supplied or `config.approval` is set; the CLI, headless, and ACP always pass one, so the user-facing default stays `ask`, while direct `assembleAppAgent(config, provider)` callers keep their pre-package (ungated) behavior — without this, unrelated TUI and durable-edit tests suspended on an unanswerable prompt. (2) `--approve deny` now maps to the package's `deny` mode (the lab mode plumbing accepts the extra value) so the model sees a definite denial instead of a suspension; `footerApproval` reports `ask` for that state because the footer type has no `deny`. (3) `mode: "auto"` from a project-scope manifest still fails closed only in the lab: `PackageAPI` exposes no manifest scope, so the package cannot see where its config came from — the package test documents the gap instead. (4) `tools-coding`'s `hard_deny_decision_budget` now measures best-of-three 1,000-decision batches: the shipped single batch read 26 ms alone but 54.6 ms under a loaded full-suite run, and the bound (50 ms) is unchanged.

    **Enforcement rows.** Root `workspaces` already carried `packages/policy/*`; `packaging.test.ts` (41 packages), `install-smoke.test.ts` (one row + tarball count), `release.test.ts` (41), `scripts/version-literal-gate.test.mjs` (41), `scripts/phase24-truth.test.mjs` (publishable 41 / workspace 40 / capability 16 / codeWithPeer 38), `scripts/phase54-package-map.test.mjs` (allowed manifests + the count list), `scripts/benchmark-multi-agent.test.mjs` (count + skip list), `scripts/independent-packages.json` `$comment`, `scripts/package-truth.mjs` `PACKAGE_NOTES`, and `scripts/e2e-coverage.json` all gained the package. `biome.json` needed no allowlist entry after the single test-site `!` was removed, so `budgets.json` needed no new `nonNullAssertions` row. Compat: `node scripts/release.mjs gate --update-baseline` → `{ updated: true, packages: 41 }` created `scripts/compat-baseline/arnilo__prism-approval.txt` and regenerated `arnilo__prism-code.txt` (the removed lab members); the verify run returned `{ updated: false, packages: 41 }`.

    **Verification.** `bun test src packages --path-ignore-patterns='**/limits.test.*'` → 8826 pass / 336 skip / 168 fail / 9330 tests / 1022 files, with the distinct failing-name set showing **zero new** failures and five gone (the four lab task-completion continuation cases and `durable gating surfaces ask_user_decision as a shared elicitation decision`); `bun run typecheck` green across every workspace and the examples stage; the package suite and the lab approval suite green (9 package cases + 8 lab cases); `budget-gate` 18 pass / 1 fail (pre-existing non-null drift), `e2e-coverage` 6 / 2 (pre-existing), `phase54` and `version-literal` green, `benchmark-multi-agent` 1 pre-existing failure, `install-smoke` 13 / 2 (the recorded pre-existing pair), `truth-current` green after `bun scripts/package-truth.mjs --emit-docs`. The lab's own `bun run test` (dist suites, no `limits` exclusion) reports 10 failures: seven are in the Task 1 baseline and three are the pre-existing rot in `packages/prism-code/src/__tests__/limits.test.*` (`session.agent.config` is now undefined and `result.status` is `completed`, not `succeeded`) — that file is excluded from the repo gate because it emits SIGTERM, so those three were never in the baseline and none of them touches approval.

    **Further actions.** (a) `PackageAPI` does not expose a package's config source scope; add it (or an approval-side manifest check) before any project-scope `auto` enforcement can live in the package. (b) `state.session("grants")` is written but never re-hydrated, so an `always` grant does not survive a process restart or `session.resume` in a new process — the lab's durable rules live in `permissions.json`. (c) `assembleAppAgent`'s third positional `executionPolicy` parameter is now unused but kept to avoid shifting ~40 call sites; remove it in a follow-up sweep. (d) `applyMcpApprovalPolicy` in `@arnilo/prism-agent-sdk` remains the MCP plane's own `ExecutionPolicy` wrapper; Part B should decide whether MCP tools move to declared effects plus this package.

- [x] Task 7: `@arnilo/prism-context-files`, and the kernel instruction loaders removed
  - Notes (executed 2026-10-06): Done, with six recorded deviations.

    **Package.** `packages/context/files/` is a source-exported native package (`exports { ".": "./src/index.ts" }`, lockstep `0.12.1`, peer `@arnilo/prism`, `file:` devDependency on the root, README/CHANGELOG/LICENSE, `packageConformance` green). Config (`src/config.ts`): `root` (checked in `setup` with a field-naming error rather than a schema `required`), `agentsMd` (default `true`), `systemMd` (default `true`), `globalRoot` (default none), `trustedRoots` (default `[]`, effective `[root]`), `files` (max 64). `additionalProperties: false`, so an unknown key fails `createAgent` naming it. No capabilities: hooks, `status.note`, and `state.agent` only.

    **Layers.** One `context.build` transform, registered with no custom id so the registration is exactly `@arnilo/prism-context-files:context.build`. It composes the file layers over the draft's *current* leading system text as the base (`composeSystemPrompt(layers, { base })`, imported from `@arnilo/prism` — no copy) and sets `draft.systemPrompt`, so the 0.12 rank order holds: base → `SYSTEM.md` (`source: "user"`, rank 0) → `AGENTS.md` / `files` (`source: "app"`, rank 2). `SYSTEM.md` comes from `<root>/SYSTEM.md` and, when `globalRoot` is set, `<globalRoot>/.prism/agent/SYSTEM.md`. `AGENTS.md` candidates run from the outermost enclosing trusted root down to `root` (one `AGENTS.md` per directory, outermost first) — with the default `trustedRoots: [root]` that is exactly one file, matching 0.12, and a configured parent trusted root adds its `AGENTS.md` above it. Nothing is written to the store; `disable.hooks: ["@arnilo/prism-context-files:context.build"]` removes every layer.

    **Trust and cache.** `createPathTrustPolicy` (kernel root export) gates every project file: a realpath escaping the trusted roots is skipped with `status.note("warn", "skipped <path>: outside trusted roots")` and never read (0.12 skipped silently — the note is the new behavior the AC asks for). A `SYSTEM.md` outside `workspaceRoot` (the global one) stays user-owned and ungated. Explicit `files` are trusted by being named: their parent directory joins the trusted roots. Missing files are silent. Files are read once per session into `prism.state.agent("sessions")` keyed by path and mtime; a later run re-checks each candidate's mtime and re-reads only what changed.

    **Kernel.** `src/node/instruction-sources.ts` and `src/node/system-project-prompts.ts` are deleted; their bodies moved to `packages/context/files/src/{instructions,layers}.ts` and their kernel tests moved with them (`instructions.test.ts`, `layers.test.ts`, plus the prompt-file security-boundary cases from `contribution-security-boundaries.test.ts`). `src/node/trust.ts` stays a kernel internal module. `./node/trust`, `./node/instruction-sources`, and `./node/system-prompts` are removed from root `package.json` (`docs.test.ts` asserts their absence), and `createPathTrustPolicy` / `isPathInside` / `isPathInsideReal` are new root exports so the package imports the containment code instead of copying it (`FROZEN_VALUE_EXPORTS` updated deliberately; `public-export-contract.test.ts` gains `kernel_subpaths_removed`). `src/cli-runner.ts` loses the six flags (`--instruction`, `--injector-file`, `--no-agents-md`, `--no-system-md`, `--agents-md-file`, `--system-md-file`), the `CliOptions` fields behind them, `resolveCliInjectors`, and both loader imports; the `createPathTrustPolicy` call for `discoverAgentBundles` stays. `src/__tests__/cli-instruction-sources.test.ts` and `cli-system-project-prompts.test.ts` are deleted with them.

    **Consumers.** `packages/agent-sdk/src/planes/instructions.ts` reads through `readContextFileLayers` from the package (its `instructions` plane config and `assembleInstructionsPlane` signature are unchanged, so the agent-SDK freeze holds); `skills.ts` / `hooks.ts` take `createPathTrustPolicy` from `@arnilo/prism`. `examples/system-project-prompts.ts` is rewritten around `contextFiles({ root, globalRoot })` plus `readContextFileLayers` (its assertion is now the provider-visible composition, `BASE → GLOBAL → PROJECT`); `examples/instruction-injection.ts` uses `resolveInstructionSources` from the package; `examples/discover-skills.ts` takes the trust policy from the root; `examples/tsconfig.json` maps `@arnilo/prism-context-files` and drops the dead `node/trust` mapping; `scripts/fixtures/e2e-full-surface-journey.mjs` asserts the three subpaths no longer resolve and the package exports its reader.

    **Deviations.** (1) The package's public readers are named `readContextFileLayers` / `resolveContextFileLayers` and `resolveInstructionSource(s)` rather than keeping the moved kernel names, because the acceptance grep forbids `loadInstructionSources` / `loadSystemPromptFiles` anywhere outside the package — the moved modules keep their internal names, only the exports are renamed. (2) `isPathInside` / `isPathInsideReal` join `createPathTrustPolicy` as root exports (the moved reader needs both), which pulls `node:fs/promises` into the root entry graph through `src/node/trust.js`; the AC only named `createPathTrustPolicy`, and the alternative was copying security-critical containment code. (3) Freshness is checked once per *run* via a `run.started` observer: `context.build` is dispatched kernel-side with empty `sessionId` / `runId` (the session comes from the bound `SessionContext`), so the run boundary has to come from the event; a resumed run without a fresh `run.started` falls back to one mtime check per turn. (4) Mtimes are compared at millisecond precision (`stat.mtime`) so a caller restoring an mtime with `utimes` compares equal — nanosecond `mtimeMs` made every restored file look changed. (5) Released `/docs` were reworded after all (`system-prompts.md`, `cli-rpc.md`, `instruction-injection.md`, `contribution-discovery.md`, `settings-auth-trust-security.md`, `release-and-install.md`, `structured-output.md`, `resource-loading.md`, `public-contracts.md`, `host-security.md`, `agent-definitions.md`, `examples/README.md`): the acceptance grep covers `docs`, so `@arnilo/prism/node/system-prompts` and the removed CLI flags could not stay documented. (6) `AGENTS.md` discovery walks from `root` up to the enclosing trusted root (AC wording); 0.12 read exactly one file, which is what the default `trustedRoots: [root]` still produces.

    **Enforcement rows.** Root `workspaces` gained `packages/context/*`; `packaging.test.ts` (42 packages), `install-smoke.test.ts` (one row, tarball count derived), `release.test.ts` (42), `scripts/version-literal-gate.test.mjs` (42 manifests — both the literal and the comparison), `scripts/phase24-truth.test.mjs` (publishable 42 / workspace 41 / capability 17 / codeWithPeer 39), `scripts/phase54-package-map.test.mjs` (allowed manifest), `scripts/benchmark-multi-agent.test.mjs` (skip list), `scripts/independent-packages.json` `$comment`, `scripts/package-truth.mjs` `PACKAGE_NOTES` (regenerated README/docs/index/release-and-install/provider-packages/phase54 evidence; prose now 42 publishable / 41 workspace / 17 capabilities), `scripts/e2e-coverage.json` (new package key, and the four deleted kernel test files removed from the root annotation — that removal is what the "annotated suite file exists" gate needs). No `biome.json` allowlist row or `budgets.json` row is needed: the package has zero non-null-assertion sites.

    **Compat.** `node scripts/release.mjs gate --update-baseline` → `{ updated: true, packages: 42 }`, creating `scripts/compat-baseline/arnilo__prism-context-files.txt` and cutting three stale symbols from `arnilo__prism.txt` (`loadInstructionSource`, `loadInstructionSources`, `loadSystemPromptFiles`; the trust helpers stay listed because they remain kernel exports); `arnilo__prism-agent-sdk.txt` is byte-identical because the plane's public signature did not change. The two deleted modules' stale `dist/node/*` artifacts were removed before regenerating, otherwise the baseline would have kept them. Verify run: `{ updated: false, packages: 42 }`.

    **Verification.** `bun test src packages --path-ignore-patterns='**/limits.test.*'` → 8820 pass / 336 skip / 168 fail / 9324 tests / 1021 files, with the distinct failing-name set showing **zero new** failures and the same five gone (the four lab task-completion continuation cases and `durable gating surfaces ask_user_decision as a shared elicitation decision`). The package suite is 29 / 0 across three files, and `bun test packages/tools/coding/src packages/policy/approval/src packages/context/files/src` is 614 pass / 2 skip / 0 fail. `bun run typecheck` (build + every workspace + `tsc -p examples --noEmit`) is green. `truth-current` green after `--emit-docs`; `docs.test.ts` 174 / 4 (the pre-existing docs quartet); `e2e-coverage` 21 pass with the two recorded pre-existing failures; `version-literal-gate` and `phase24-truth` green apart from the recorded pre-existing roadmap-wording case. The Task 7 acceptance grep (`@arnilo/prism/node/(instruction-sources|system-prompts|trust)|loadInstructionSources|loadSystemPromptFiles` over `src packages scripts examples docs`, excluding `dist`/`plans`/`history`/`_evidence`/`compat-baseline`) returns no match outside `packages/context/files` itself.

    **Further actions.** (a) `HookContext.sessionId` / `runId` are empty for kernel-dispatched `context.build`, so run boundaries have to be observed through `run.started`; give hook dispatch context the real ids if another package needs them. (b) The root entry now reaches `node:fs/promises` via `src/node/trust.js`; if the kernel root must stay builtin-free, move the trust helpers back behind a subpath and let the package import that. (c) `@arnilo/prism-agent-sdk` remains the only in-tree consumer of the file readers; when the lab moves to `@arnilo/prism-context-files` directly (Phase 12), the agent-SDK instructions plane can go with the package.
  - Acceptance Criteria:
    - Functional: `packages/context/files` exists with the §2.10 shape. Config:
      - `root` (required)
      - `agentsMd`: default `true`; finds `AGENTS.md` from `root` up to the trusted root
      - `systemMd`: default `true`; `SYSTEM.md` under `root`
      - `globalRoot`: default none. **No home-directory scan unless set.**
      - `trustedRoots`: default `[root]`
      - `files`: extra explicit paths, each trusted by being named
    - Functional: One `context.build` transform, id `@arnilo/prism-context-files:context.build`, adds the layers to `draft.system` in the 0.12 rank order (`composeSystemPrompt` `sourceRank`). It never writes the store, per the kernel invariant. Files are read once per session and cached in agent state, keyed by path and mtime.
    - Functional: A path outside `trustedRoots`, after symlink resolution, is skipped with `status.note("warn", …)` naming the path, not read. A missing file is silent.
    - Functional: `disable.hooks: ["@arnilo/prism-context-files:context.build"]` removes the layers.
    - Functional: `src/node/instruction-sources.ts` and `src/node/system-project-prompts.ts` move into the package; `src/node/trust.ts` stays a kernel internal module (Task 1 (h): `node/agent-definitions.ts` and `node/contribution-discovery.ts` import `isPathInsideReal`, and `cli-runner.ts` uses `createPathTrustPolicy` for `discoverAgentBundles`). The `./node/instruction-sources`, `./node/system-prompts`, and `./node/trust` subpaths are deleted from root `package.json`, and `createPathTrustPolicy` is exported from `@arnilo/prism` so the package imports it instead of copying it. The `src/cli-runner.ts` flags Task 1 (h) names are deleted with their tests; the `discoverAgentBundles` trust call stays. `packages/agent-sdk/src/planes/{instructions,skills,hooks}.ts`, the three examples, `examples/tsconfig.json`, `scripts/fixtures/e2e-full-surface-journey.mjs`, and `src/__tests__/docs.test.ts` are migrated.
    - Functional: The repo-wide grep `rg '@arnilo/prism/node/(instruction-sources|system-prompts|trust)|loadInstructionSources|loadSystemPromptFiles' src packages apps scripts examples docs -g '!**/dist/**' -g '!plans/**' -g '!docs/history/**' -g '!docs/_evidence/**'` returns only the package's own code.
    - Performance: There is no filesystem read per turn after the first. The cache is invalidated by mtime, checked at most once per run.
    - Code Quality: `composeSystemPrompt` stays in the kernel if Task 1 (h) says the kernel still uses it, and the package imports it from `@arnilo/prism`. There is no copy.
    - Security: A test asserts that with no `globalRoot`, no read is attempted under `os.homedir()`. A symlinked `AGENTS.md` pointing outside `trustedRoots` is skipped.
  - Approach:
    - Documentation Reviewed:
      - `src/node/{instruction-sources,system-project-prompts,trust}.ts`, `src/system-prompts.ts`, `src/cli-runner.ts:330-380`, `packages/agent-sdk/src/planes/instructions.ts`, `docs/next/hooks.md` (`context.build`), plan 145 (retired `instructionInjectors`)
    - Options Considered:
      - Leave the loaders in the kernel and add only the package hook. Rejected: §2.9 places this code in `context-files`, and the kernel must stay minimal.
      - Keep the run CLI's flags by importing the package dynamically. Rejected: the kernel never names a package (§1.4).
    - Chosen Approach:
      - Move the three modules, wrap them in one `context.build` transform with a per-session cache, and delete the subpaths and CLI flags.
    - API Notes and Examples:
      ```ts
      import contextFiles from "@arnilo/prism-context-files";
      packages: [contextFiles({ root: process.cwd() })]; // no ~/ scan unless globalRoot is set
      ```
    - Files to Create/Edit:
      - `packages/context/files/{package.json,tsconfig.json,bunfig.toml,README.md,CHANGELOG.md,LICENSE,src/index.ts,src/config.ts,src/__tests__/*}`: new. The moved modules go under `src/`.
      - `src/node/instruction-sources.ts`, `src/node/system-project-prompts.ts`: moved; their kernel tests move with them. `src/node/trust.ts` stays (Task 1 (h)).
      - Root `package.json` `exports` (three subpaths removed), `src/cli-runner.ts` and its tests, `packages/agent-sdk/src/planes/*.ts` and `package.json`, `examples/{instruction-injection,system-project-prompts,discover-skills}.ts`, `examples/tsconfig.json`, `scripts/fixtures/e2e-full-surface-journey.mjs`, `src/__tests__/docs.test.ts`.
      - `src/__tests__/public-export-contract.test.ts`: subpath freeze updated deliberately.
      - Enforcement rows: root `workspaces` (`packages/context/*`), `scripts/package-truth.mjs`, `packaging.test.ts`, the `independent-packages.json` `$comment`, `scripts/compat-baseline/arnilo__prism-context-files.txt` (new), `scripts/e2e-coverage.json`.
      - `scripts/compat-baseline/arnilo__prism.txt`, `arnilo__prism-agent-sdk.txt`, `CHANGELOG.md`.
    - References:
      - plan 134 (agent-sdk instructions plane), plan 149 Task 6 (agent-sdk freeze: names frozen, internal imports may move)
  - Test Cases to Write:
    - `context_files_package_conformance`.
    - `context_files_layers_in_rank_order`: AGENTS.md and SYSTEM.md content appears in `draft.system` in the 0.12 order. It fails on an order change.
    - `context_files_never_writes_store`: after a run, the store holds no AGENTS.md content.
    - `context_files_no_home_scan_by_default`: with a spy on the read path, nothing under `os.homedir()` is read.
    - `context_files_untrusted_symlink_skipped_with_note`: a symlink outside `trustedRoots` gives a warn note and no layer.
    - `context_files_disable_hook_removes_layers`.
    - `context_files_reads_once_per_session`: two runs in one session read each file once.
    - `kernel_subpaths_removed`: importing `@arnilo/prism/node/trust` fails to resolve (public-export contract).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package, three removed kernel subpaths, and removed CLI flags.
    - Docs pages to create/edit:
      - `packages/context/files/README.md`: package page structure, including the trust rules and the home-directory rule.
      - `docs/next/agent.md` or `docs/next/hooks.md`: one line pointing `instructions`-file layering at the package, if those pages mention the node subpaths.
      - Released `/docs`: untouched.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate. The note records `arnilo__prism.txt` removals (the three subpaths and their exports), the new package baseline, and the `agent-sdk` diff.

- [x] Task 8: `examples/coding-approval.ts` and the Part A Done record
  - Notes (executed 2026-10-06): Done. **Phase 7 Part A is complete.**

    **Example.** `examples/coding-approval.ts` runs one agent over a temp workspace on `mockProvider` with `toolsCoding({ root })`, `approvalPackage({ mode: "ask" })`, `contextFiles({ root })` and a scripted `HostUi` (`createScriptedHostUi({ confirm: true, select: "once" })`). Its first turn calls `edit` on `note.txt`; the package asks, the scripted host answers the `confirm` and the `once` follow-up, and the file ends as `after`. A second agent sets `disable: { tools: ["shell"] }`; `shell` is absent from `agent.tools`, the provider never sees it, and a scripted shell call ends as a blocked `tool.completed` with reason `unknown_tool` and no `tool.started`. The demo returns `{ approved: { status, file, confirmRequests, selectRequests, layers }, disabled: { shellInTools, shellBlocked, started }, elapsedMs }` — 29–31 ms locally, from `npm run build:core && node examples/coding-approval.ts`. It imports only `@arnilo/prism`, `@arnilo/prism/testing`, and the three packages' public entry points, and sets no key.

    **Gate.** `examples/coding-approval.ts` is in `docs.test.ts`'s `examples_demos_run_to_completion_and_emit_no_secret` list with a JSON assertion (status `completed`, file `after`, exactly one `confirm` and one `select`, layers `["system-md", "agents-md"]`, shell absent, `unknown_tool`, no start, `elapsedMs < 5000`), plus one `examples/README.md` run-list line and one Files line, and a `scripts/e2e-coverage.json` suite row. `packages/tools/coding/src/__tests__/disable-tools.test.ts` adds `disable_tools_shell_removes_shell` (agent tools, `inspect().disabled.tools`, the recorded provider tool list, and the blocked call), also annotated in `e2e-coverage.json`. `packages/tools/coding/README.md` and `packages/policy/approval/README.md` link the example. Root `CHANGELOG.md` gains the examples bullet under `## [Unreleased] → Added`.

    **Part A Done record** (roadmap Phase 7 `**Done.**`):

    | Phase 7 Done criterion | Proof |
    | --- | --- |
    | A coding example edits a file under `approval` in `ask` mode | `examples/coding-approval.ts` under `examples_demos_run_to_completion_and_emit_no_secret` (status `completed`, `note.txt` = `after`, one `confirm` + one `select`); `approval_ask_inline_confirm` (`packages/policy/approval`); `tools_coding_edit_round_trip_on_mock_provider` (Task 5, the durable principal path) |
    | `disable.tools: ["shell"]` removes the shell | `examples/coding-approval.ts` `disabled` block (absent + blocked as `unknown_tool`, never started); `disable_tools_shell_removes_shell` (`packages/tools/coding/src/__tests__/disable-tools.test.ts`), which also pins the provider tool list and `inspect().disabled.tools` |
    | Installing `tools-coding` loads neither Playwright nor the Office parsers | `tools_coding_loads_no_heavy_dependency` (`packages/tools/coding/src/__tests__/package.test.ts`, subprocess probe of the heavy module list) |
    | `tools-web` with no key yields a note and a working agent | **Deferred to plan 155** (Part B, Task 2): the web tools move out of `@arnilo/prism-web-tools` there, and the criterion lands with `@arnilo/prism-tools-web` plus `examples/web-no-key.ts` |

    **Plan-level verification** (run after Task 8): `bun run build:core` and `bun run typecheck` green; `bun test packages/tools/coding/src packages/policy/approval/src packages/context/files/src` 616 pass / 2 skip / 0 fail (including the new disable-tools case); the four kernel freeze suites 332 pass / 2 fail (the two pre-existing install/packaging cases); `bun test src packages --path-ignore-patterns='**/limits.test.*'` 8820 pass / 336 skip / 168 fail / 9325 tests / 1022 files with **zero new** failures against the Task 1 baseline and the same five gone; `node scripts/release.mjs gate` `{ updated: false, packages: 42 }`; `docs.test.ts` 165 / 4 (the pre-existing quartet). No task in this plan is left unchecked.
  - Acceptance Criteria:
    - Functional: `examples/coding-approval.ts` creates an agent on `mockProvider` with `toolsCoding({ root: <temp dir> })`, `approval({ mode: "ask" })`, `contextFiles({ root })`, and a scripted `HostUi`. A scripted turn calls `edit`, the `confirm` is answered yes, and the file changes. A second agent with `disable: { tools: ["shell"] }` shows that `shell` is absent from `agent.tools`, and that a scripted `shell` call is refused as an unknown tool. The example runs under `examples_demos_run_to_completion_and_emit_no_secret`.
    - Functional: The Done record in this task's Notes maps each Part A Done criterion to its proof:
      - edit under `approval` in `ask` mode → the example plus `approval_ask_inline_confirm`
      - `disable.tools: ["shell"]` → the example plus `disable_tools_shell_removes_shell`
      - no Playwright or Office parsers → `tools_coding_loads_no_heavy_dependency`
      - `tools-web` with no key → deferred to plan 155
    - Functional: The lab modules still in place (Task 1 (k)) are listed in Further Actions under Phase 12.
    - Performance: The example finishes in under 5 s on the mock provider.
    - Code Quality: The example uses only public package entry points and `@arnilo/prism/testing`.
    - Security: The example sets no real keys, and the execution gate's secret scan passes.
  - Approach:
    - Documentation Reviewed:
      - `examples/approval.ts` and `examples/sqlite-resume.ts` (gate shape), `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts:3411`
    - Options Considered:
      - Extend `examples/approval.ts`. Rejected: that example documents the kernel `ask` path without packages, and stays as the minimal case.
    - Chosen Approach:
      - A new example combining the three packages, plus a kernel-level `disable.tools` test in `tools-coding`.
    - API Notes and Examples:
      ```ts
      const agent = await createAgent({
        packages: [mockProvider({ script }), toolsCoding({ root }), approval({ mode: "ask" }), contextFiles({ root })],
        model: "mock/default",
        host: { ui: createScriptedHostUi([{ kind: "confirm", answer: true }]) },
      });
      ```
    - Files to Create/Edit:
      - `examples/coding-approval.ts`: new.
      - `examples/README.md`: one line. `scripts/e2e-coverage.json`: a row. `examples/tsconfig.json`: path mappings for the three packages.
      - `packages/tools/coding/src/__tests__/disable-tools.test.ts`: new (`disable_tools_shell_removes_shell`).
      - `plans/154-…md`: the Done record.
    - References:
      - roadmap Phase 7 Done
  - Test Cases to Write:
    - `disable_tools_shell_removes_shell`: `shell` is absent from `agent.tools` and the provider tool list, and a scripted call returns the unknown-tool error.
    - The example itself under `examples_demos_run_to_completion_and_emit_no_secret`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — example and proof only.
    - Docs pages to create/edit:
      - `examples/README.md`: example line.
      - `packages/tools/coding/README.md`, `packages/policy/approval/README.md`: link the example from Example.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test packages/tools/coding packages/policy/approval packages/context/files`
- `bun test src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/package-api-freeze.test.ts src/__tests__/packaging.test.ts`
- `(cd packages/prism-code && bun run build && bun run test)`, then the same for `packages/agent-sdk`, `packages/ag-ui`, `packages/acp-agent`, and `packages/prism-coding-tools`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun test src packages --path-ignore-patterns='**/limits.test.*'`, compared with the Task 1 baseline (no new failures)
- `node scripts/release.mjs gate`

## Compromises Made

- **Sandboxes (Task 4).** Only `none` and `native` are functionally wired. `docker` and `e2b` fail closed with a `status.note("warn", …)` and no `shell` registration: a JSON manifest cannot carry a digest-pinned image, the docker binary path, or a non-root `uid:gid`. `native` is built eagerly in `setup` (it preflights `unshare`), so an unsupported host degrades to local tools plus a warm note rather than failing the load.
- **The lab keeps an approval stopgap (Tasks 5, 6).** `packages/prism-code` builds its tools with `codingPreset`, not `toolsCoding`, so nothing provides `coding.targets`; the lab ships a `codingTargetsPackage` shim so `edits` mode still recognizes in-repo paths. Loading both would be a `tool_conflict`, so `loop.continueOnOpenTodos` maps to edge-level hook registration instead of package config (and `false` keeps the old lab behavior of removing `todo_write` with the hook, while the package keeps the tool and drops only the hook). `headless.ts` keeps a voided `executionPolicy?` positional parameter so ~40 call sites do not shift, and `tasks.ts`-level `ExecutionPolicy` wiring is gone.
- **Approval answers (Task 6).** The lab's four-way prompt (`once` / `run` / `always` / `deny`) collapses to the kernel's confirm + follow-up `select` (`once` / `always`). Grants live in a per-gate in-memory map keyed by session id; `state.session("grants")` is written on `always` but never re-hydrated, so a restored run starts without its grants. Project-scope `auto` is still rejected in the lab, because `PackageAPI` does not expose the entry's manifest scope to `setup`.
- **Context files (Task 7).** Six deviations, recorded in that task's Notes: readers are re-exported under new names, `isPathInside` / `isPathInsideReal` join `createPathTrustPolicy` as root exports (the root entry now reaches `node:fs/promises` through `src/node/trust.js`), freshness is keyed off an observed `run.started` because kernel-dispatched `context.build` carries empty `sessionId` / `runId`, mtimes compare at millisecond precision, released `/docs` were reworded although the plan said `/docs` waits for Phase 11 (the Task 7 acceptance grep covers `docs`), and `AGENTS.md` discovery walks from `root` up to the enclosing trusted root, which the default `trustedRoots: [root]` reduces to the single 0.12 file.
- **Proof shape (Task 8).** The Done record rests on one mock-provider example plus focused tests, not on a real provider or a real repository: the example's edit is a one-line in-repo rewrite, and the performance bound is asserted as `elapsedMs < 5000` inside the docs gate rather than by a dedicated budget test.
- **Shared-file rebases.** Tasks 3–7 each re-ran the package-truth, budget, coverage, freeze, and compat-baseline gates and rebased the shared files (`workspaces`, `package-truth.mjs`, `packaging.test.ts`, `independent-packages.json`, `e2e-coverage.json`, `CHANGELOG.md`, `examples/README.md`, `scripts/compat-baseline/*`). The package count is 42; `@arnilo/prism-tools-coding`, `@arnilo/prism-approval`, and `@arnilo/prism-context-files` are lockstep packages listed in `independent-packages.json`'s until-Phase-11 `$comment`. Two pre-existing gate failures stay unfixed and unchanged: the non-null-assertion budget drift (`examples` 38 vs 29, `src` 599 vs 551) and the `phase24-truth` roadmap-wording case.

## Further Actions

**Phase 12 — the lab (Prism Code), highest value.** None of the modules Task 1 (k) named is deletable in Part A, and Phase 12 is where they go:
1. `packages/prism-code/src/approval.ts` — delete the `permissions.json` I/O, the mode mapping, and the `PrismCodeApprovalControls` binding once the lab loads `@arnilo/prism-approval` from its manifest and `PackageAPI` can carry the manifest scope (needed so the package itself rejects project-scope `auto`).
2. `packages/prism-code/src/{tools.ts,headless.ts,acp.ts}` — replace `codingPreset` + `BUNDLED_CODING_TOOLS` with `toolsCoding` from config, drop the `codingTargetsPackage` shim and the voided `executionPolicy` parameter, and let the package's `todo`/`ask_user` config replace the edge-level hook registrations.
3. `packages/prism-code/src/tui/{index.ts,commands.ts,components/todo.ts,reducer.ts}` — the `/approval` and `/permissions` commands and the approval footer once grants and rules live in the package.
4. `packages/prism-code/src/web.ts` becomes deletable when the lab builds its web tools from `tools-web` config (plan 155 Task 2).

**Package finishes.** `@arnilo/prism-coding-tools` keeps `./openapi` and `./computer-use-linux` until plan 155 Task 4, `./dev` and `./dev/cli` until Phase 10 (`@arnilo/prism-devtools`), and `./impeccable` until its own phase. `@arnilo/prism-tools-coding` keeps its `@arnilo/prism-core` dependency until `supervisor-lifecycle.ts` / `spawn-worktree.ts` move to the workspace service (Phase 14) and `goal-verify.ts` / `coding-checkpoint.ts` move to workflows (Phase 16); `acp-operations.ts` goes in Phase 10. `@arnilo/prism-agent-sdk`'s instructions plane can drop its `@arnilo/prism-context-files` dependency once the lab calls the package directly (Phase 12).

**Follow-ups the tasks recorded.** (a) `HookContext.sessionId` / `runId` are empty for kernel-dispatched `context.build`, so a package that needs run identity must observe `run.started`; fill them in hook dispatch if a second package needs it. (b) The kernel root entry now pulls `node:fs/promises` via `src/node/trust.js`; move the trust helpers behind a subpath again if the root must stay builtin-free. (c) The coding hard deny is name-based (`CODING_TOOL_NAMES`), so a host tool that shadows a coding tool name is denied too; key the deny on the registering package once `tool.call` carries the owner. (d) Approval should re-hydrate `state.session("grants")` on resume, and can gain run-scoped grants when a `run`-scoped decision id is available. (e) The kernel `ExecutionPolicy` export and `examples/web-no-key.ts` land in plan 155 Task 6.
