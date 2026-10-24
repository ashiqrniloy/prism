# Phase 11 Part R — delegation for coding workflows

## Objectives

- Let the model choose a child and brief it well: every child has a description, and the tool says the child sees nothing but the brief.
- Give children budgets that can finish coding work, and remove the configuration knobs that duplicate each other.
- Make a coding child safe to run in parallel: an isolated worktree per delegation, merged back deterministically.
- Stop killing a child that needs approval, and give children the parent's skills.
- Accept subagent files written for other coding agents (`.agents/agents/*.md`, `.claude/agents/*.md`).
- Keep the parent's context small (context-rot review, 2026-10-17). A child is the strongest isolation available: Context-Folding (arXiv 2510.11967) reports a 10× smaller active context at equal or better task success. That only holds if the child's answer reaching the parent is bounded, so the result is capped and paged.
- Let a host choose, per child, whether the child sees the parent's conversation (owner decision 2026-10-23). A child that starts blind sees only the parent model's brief, so it inherits the parent's blind spots. This matters most for reviewers and advisors.
- Ship a host-agnostic advisor: one model call that takes a bounded transcript slice and returns advice. It can be called by the model as a tool or triggered by hooks before named tools and before the final answer. Without it, every host rebuilds the same tool, hooks, and slicing.
- Let a host validate that a task is complete before a run ends (owner decision 2026-10-23), using either a model or a tool-using delegate child that checks the evidence. The validation is judged against the run's original task, not the newest turns. A run that ends unverified is visible to the host. Today the model decides on its own that it is done, and a host hook cannot start a delegate child.

## Expected Outcome

- The `delegate` tool's description lists `name — description` per child, and `input` is described as a self-contained brief.
- A child with no `limits` gets 50 turns, 200 tool calls, 500,000 total tokens, and 15 minutes (was 8, 32, 20,000, and 60 seconds). `budgetShare` and `lifetime` are gone: `mode: "sync"` is tied to the calling tool call, and `mode: "async"` runs as session background work.
- `isolation: "worktree"` runs the child in its own worktree and, when it finishes, merges its changes into the parent's checked-out branch. A conflict, or a dirty target, returns `merge: { status: "conflict" | "refused", files, branch }` and keeps the branch for a person to resolve.
- A child's approval request reaches the parent's `host.ui`; a child suspends only when the parent host answers `unavailable`.
- A child inherits the parent's effective skills by default (`skills: "inherit"`).
- With `agentsRoot` configured, a `.agents/agents/reviewer.md` or `.claude/agents/reviewer.md` file (Claude Code's subagent shape: `name`, `description`, `tools`, `model`, body) becomes a child named `reviewer`.
- `DelegateChildConfig.context?: "none" | "summary" | { lastTurns: number; maxChars?: number }` (default `"none"`).
  - `{ lastTurns }` seeds the child's session with the parent branch's last N turns. The copy is portable: text only, tool activity rendered as text, and reasoning, images, and non-message entries dropped. It is bounded by `maxChars`.
  - `"summary"` seeds one `summary` entry produced by one model call.
  - The `delegate` description marks each child that sees the conversation.
- A new kernel export, `selectTranscript(entries, options)`, produces that bounded, portable slice. Its `pinned` messages, such as the run's task, always survive the cut. Both the delegate and the advisor use it.
- The delegate provides a `delegate` service (`start`/`wait`), so a hook or another package can run a child from code. A child with `hidden: true` is reachable only through the service and never appears in the `delegate` tool.
- A new package, `@arnilo/prism-advisor` (`packages/integrations/advisor`):
  - an `advise` tool;
  - an opt-in `tool.call` trigger before named tools (`revise` → `deny` carrying the advice);
  - an opt-in `run.end` trigger before the final answer (`revise` → `continue` with the advice as a steer).
  - Each consult is exactly one model call on the configured advisor model, with no tools and no agent loop. A per-run cap bounds the number of consults.
  - **Completion validation:** an opt-in `validate` role on `run.end`, judged against the run's captured task and optional `criteria`.
    - Its engine is either one model call or a hidden delegate child (`engine: { child }`) that checks the evidence with its own tools.
    - `incomplete` sends the model back with what is missing, for at most `maxRounds` rounds.
    - It fails closed: it never reports `verified` without a successful verdict.
    - Every round emits `validator.verdict` (`verified | incomplete | unverified | error`), so a host can tell when a run ended unverified.

**0.13.0 release path — plan 191, step 7 of 21.** Amended 2026-10-17 by the context-rot review: Task 2 gains a bounded, paged child result and a concise-report instruction. Amended 2026-10-23 by owner decision: Task 7 adds context forwarding to delegate children plus the `selectTranscript` kernel export. Its two-user proof is the delegate (Task 7) and the advisor (Task 8). Task 8 creates `@arnilo/prism-advisor`, a lockstep package, which brings the new-package enforcement rows with it. Task 1 gains review items (h) and (i) for these two tasks. Amended again 2026-10-23 by owner decision:
- Task 7 adds the `delegate` service, `hidden` children, and `selectTranscript`'s `pinned` option.
- Task 8 adds completion validation as the advisor package's `validate` role, rather than as a second package that would duplicate the slicing, verdict parsing, and caps.
- Task 1 gains review item (j).

Neither change touches the kernel beyond `selectTranscript`. A `run.end` hook cannot fail a run, so validation reports its outcome through `validator.verdict`, and the host gates on that. Owner decision 2026-10-17 (see plan 189's header). Start this plan when plan 190 is complete; when it is complete, continue with plan 192. It depends on plan 189 (tool names for the subagent tool map, the tool set a coding child sees) and plan 190 (`parseAgentFile` returns the body; skills registered by `context-files`). It changes the `@arnilo/prism-delegate` config and result contract and adds one kernel rule (identical skill re-registration is idempotent, Task 4), so **Task 1 is the phase review**. It implements roadmap §2.9's `delegate` row ("sub-agents as a tool, inheriting a chosen package set") and §2.13.2 ("an orchestrator agent … is an `Agent` created with `prism-delegate`"); worktree isolation reuses the Phase 14 `workspace` service (§2.12.14) the same way `prism-workflows` agent nodes do. Docs go to the package README and `docs/agent.md` (skills rule). No version bump, publish, or npm deprecation. Reference host impact: the orchestrator (`apps/prism-agent/src/host/orchestrator.ts`) configures `delegate` with a research child; Task 3 updates it if it sets a removed field, and the orchestrated-workflow scenario must stay green.

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Callers of the delegate surface** (`graft callers --depth all`): `DelegateChildConfig`, `DelegateLifetime`, `budgetShare`, `DEFAULT_CHILD_LIMITS`, `HARD_CHILD_LIMITS`, `resolveChildLimits`, `createDelegateRuntime` — including `apps/prism-agent/src/host/orchestrator.ts`, `examples/delegate.ts`, `scripts/e2e-coverage.json:390-393`, and the compat baseline.
      - (b) **Child construction** (`packages/integrations/delegate/src/runtime.ts:86-121`): the child gets the provider bridge plus re-instantiated inherited packages, a memory store, limits, and the principal — no `host` and no `skills`. Record what `createAgent` does with a missing `host.ui` for an `ask` (the suspension path in the README's "Safety").
      - (c) **Host port attribution.** The `HostUiRequestBase` fields (`src/host/types.ts:4`) and how a request is attributed to a package ("requests carry the owning package's name", `src/packages/api.ts:46`), so Task 4 can label a forwarded request with the child's name.
      - (d) **Worktree isolation mechanics.** A child agent re-instantiates `tools-coding`, so the parent's `workspace` service binding does not route the child's tools. Confirm that an inline package added to the child's `createAgent` can `services.consume("workspace")` from the child's own instance and bind the child session (the pattern `prism-workflows` uses, `packages/integrations/workflows/src/nodes/agent-node.ts:58-110`). Record `worktree.create`, `diff`, `merge`, and `dispose` behavior on the child's instance (`packages/tools/coding/src/workspace/service.ts`), whether disposing the child agent disposes its worktrees, and which branch `merge({ into })` should target (the parent root's current branch from `git_status`/`rev-parse`).
      - (e) **Skill duplicates.** What happens when the child receives the parent's skills through `skills.add` and an inherited package (for example `context-files` from plan 190 Task 5) registers the same skill again: today `skill_conflict` (`src/packages/api.ts:100`). The rule Task 4 adds, and its second user (two packages, or a host `skills.dirs` plus `context-files`, discovering the same `SKILL.md`), which is the kernel-addition proof required by `references/prism.md` §1.
      - (f) **Subagent file format.** Claude Code's `.claude/agents/*.md` frontmatter fields and tool names (find-docs; record the date), and whether Codex or the `skills` CLI define an equivalent. The tool-name map Task 6 needs (`Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Grep`→`grep`, `Glob`→`glob`, `Bash`→`shell`), checked against plan 189's final tool names.
      - (g) **The `delegations` map** (`runtime.ts`, `start`/`wait`): entries are never removed.
      - (h) **Seeding a child session (Task 7).** Record each of the following:
        - **What the parent branch looks like.** `SessionContext.entries()` (`src/session-context.ts:16-21`) returns the parent branch already redacted. It needs the `"session-state"` capability, which the delegate does not declare today (`packages/integrations/delegate/src/index.ts`, `capabilities: ["models", "background"]`). Record what the branch holds while the `delegate` tool call is in flight: is the assistant message carrying the `delegate` tool call already appended, and is its result absent?
        - **How the copy enters the child.** `createMemorySessionStore(initialEntries)` (`src/session-stores.ts:257`) seeds a store. `agent.session({ id })` (`src/contracts-core/agent.ts:260-275`) resumes it and runs `openResumedSession`, the same path `fork()` uses (`src/agent-session/session.ts:766-808`). Record which ownership metadata the seeded entries need so the child's principal scope accepts them.
        - **How summaries reach the model.** A `summary` entry is carried as `snapshot.summaries` (`src/session-stores.ts:160-170`) into assembly (`src/agent-session/session/assemble.ts:453`). Record how assembly renders it.
        - **Which content does not travel.** Which content blocks are provider-bound: `thinking` (`src/contracts-core/content.ts:73`), images, and provider metadata on messages. Then answer two questions. Does a provider accept historical `tool_call` blocks for tools absent from the request? Does a `tool`-role message survive when the provider differs? Task 7 renders tool activity as text either way. This finding only confirms that rendering is required.
        - **Existing helpers.** Whether a kernel helper already selects the last N turns under a size bound. `rebuildSessionContext` (root export) returns every message unbounded. The turn-cut helpers in `packages/memory/compaction/src/prepare.ts` live in a package that neither the delegate nor the advisor may depend on. Also whether a kernel text renderer for messages exists to reuse (`src/compaction.ts:66`, `src/input.ts:439`). Record whether it is exported.
        - **Kernel-addition proof for `selectTranscript`.** No hook, slot, `PackageAPI` member, or primitive expresses "a bounded, portable slice of a branch". It has two users: the delegate (Task 7) and the advisor (Task 8).
      - (i) **Advisor mechanics (Task 8).** Record each of the following:
        - **`tool.call` hooks.** `ToolCallDecision` (`src/hooks/types.ts:104-109`): which context a `tool.call` hook receives (`HookContext.session`, `signal`), and whether a `deny` reason reaches the model as the tool result text.
        - **`run.end` hooks.** `RunEndDecision.continue` (`src/hooks/types.ts:148-154`) and its `limits.maxContinuations` cap. `RunEndPayload.history` (`src/hooks/types.ts:135-141`) is the live transcript, so a `run.end` trigger needs no store read.
        - **Whether advisor calls re-enter the hooks.** Whether `prism.models.client(ref).generate` (`src/packages/api.ts:120`) runs `model.request`, `model.call`, or `model.response` hooks. If it does, the advisor's own call could re-trigger other packages' hooks, and Task 8 must say how that is bounded.
        - **Capabilities.** Which capabilities the package must declare to register hooks and a tool, to call models, and to read `session.entries()`.
        - **Enforcement rows.** Every row a new integration package must join, found with `grep -rln prism-delegate scripts src docs examples` and excluding `compat-baseline/`, `docs/history/`, and `docs/_evidence/`. Today that is `scripts/package-truth.{mjs,json}`, `scripts/independent-packages.json`, `scripts/coverage-thresholds.json`, `scripts/coverage-summary.json`, `scripts/release-evidence.json`, `scripts/phase24-truth.test.mjs`, `scripts/phase54-package-map.test.mjs`, `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`, `docs/release.md`, and `docs/index.md`. Record which of them a new package must join.
      - (j) **Completion validation (Tasks 7 and 8).** Record each of the following:
        - **Finding the run's task.** How a package identifies the current run's input message: the user message that started the run, not a later `run.end` continuation steer, which is also a user message. Record whether `run.input` (`src/hooks/types.ts:174`, transform) sees it with the `runId` in its hook context, so the advisor can capture it per run. Also record whether message entries or `RunEndPayload.history` (`src/hooks/types.ts:135-146`) mark the run boundary on their own.
        - **Combining `run.end` decisions.** How decisions from several packages combine ("the first continue wins", `src/hooks/types.ts:148-154`). Record the hook order between the advisor and `hooks-json`'s `Stop` handler (`packages/integrations/hooks-json/src/compile.ts:407-422`), and what `payload.continuations` counts.
        - **No verdict field on the run result.** Confirm that a `run.end` hook cannot set a `RunResult` status or field, and that a run ending after `maxContinuations` reports `completed`. That is why the validator reports through a package event and adds no kernel field.
        - **A runtime as a service.** The precedent is `prism-workflows` providing its runtime (`packages/integrations/workflows/src/index.ts:240`). Record whether a `run.end` hook's context carries the `SessionContext` and `signal` that `runtime.start` needs (`packages/integrations/delegate/src/runtime.ts:192-217`).
        - **Child output.** Whether a child's answer, capped by Task 2's `resultMaxChars`, can carry a JSON verdict reliably. Record the child result shape the validator will parse.
    - Functional: The note ends with a verdict; a finding that invalidates a task stops the plan for a re-cut.
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: The review confirms three things:
      - a child still never gains a package the parent did not load;
      - forwarding `host.ui` does not let a child answer its own approvals;
      - the entries `session.entries()` returns are already redacted (h). If they are not, Task 7 stops for a re-cut. It must not add its own redaction pass.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9, §2.12.14, §2.13.2; `packages/integrations/delegate/{README.md,src/*}`; `packages/integrations/workflows/src/nodes/agent-node.ts`; plan 165 (workspace service), plan 169 (agent nodes).
    - Options Considered:
      - Skip the review. Rejected: a package contract and a kernel rule change.
    - Chosen Approach:
      - Read-only inventory cited by Tasks 2–5.
    - API Notes and Examples:
      ```bash
      graft callers resolveChildLimits --depth all
      ```
    - Files to Create/Edit:
      - `plans/191-Phase-11-Part-R-Delegation-For-Coding-Workflows.md` (task note only).
    - References:
      - The 2026-10-17 evaluation §3.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit:
      - none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  Method: repo-wide `rg` over the delegate surface, graft for the call graph, and direct reads of the kernel seams cited below. No tree change.

  - **(a) Callers of the delegate surface.** Every symbol is package-internal plus the compat baseline; there is no external caller.
    - `budgetShare`: `config.ts:22,53,60`, `limits.ts:9,13`, `runtime.ts:118`, `index.ts:49` (setup validation), `limits.ts` export, the package test, baseline `:38`; prose in `plans/093`, `plans/160`.
    - `DelegateLifetime`: `config.ts:5,16`, `runtime.ts:206,208,211`; `index.ts:49` re-export.
    - `DEFAULT_CHILD_LIMITS` / `HARD_CHILD_LIMITS` / `resolveChildLimits`: `limits.ts:5,7,10`; `runtime.ts:116` is the only call; `index.ts:49` re-export; baseline `:156,182,330`.
    - `createDelegateRuntime`: `index.ts:24`, `tools.ts:51` (via `DelegateRuntime`); tests.
    - `DelegateChildConfig`: `config.ts:8`, `runtime.ts:19,83`, `index.ts:49`, tests, baseline `:63`, README.
    - Outside the package: `apps/prism-agent/src/host/orchestrator.ts` loads it by name; `examples/delegate.ts`; `examples/README.md`, `examples/tsconfig.json`, `examples/autonomous-coding-loop.ts`; `scripts/e2e-coverage.json:389-393` (`packages/integrations/delegate/src/__tests__/package.test.ts`); enforcement rows (Task 8 (i)); `scripts/compat-baseline/arnilo__prism-delegate.txt` (9 hits). No `AgentConfig` field, hook, slot, or kernel type mentions any of them, so Tasks 2 and 3 are free to change them.
  - **(b) Child construction** (`runtime.ts:83-121`). `buildAgent` re-instantiates each inherited package from `prism.packages.instances(child.inherit).map(i => i.definition(i.config, { optional: i.optional }))`, adds a provider bridge whose `generate` calls `prism.models.client(...).generate` on the parent, seeds `slots.store = createMemorySessionStore()`, passes `instructions`, `limits: resolveChildLimits(child.limits, child.budgetShare)`, `principal` — and **no `host`, no `skills`, no `ownership`, no `tools`** (tool scoping happens per run: `session.run(input, { tools: { only } })`).
    - Missing `host.ui` on an `ask`: the default loop makes the child resumable (`isDurableLoop(defaultLoop) === true`, `helpers.ts:102-106`), so `resolveAskDecisions` (`assemble.ts:110-180`) finds `ui` undefined, pushes the request to `toSuspend`, and the run returns `status: "suspended"` with `pending`; the delegate already copies `pending` into the outcome (`runtime.ts:165`, `tools.ts:17`). The sandbox/README claim holds: today every child approval suspends instead of reaching the person.
    - Consequence for Task 4: forwarding `host: { ui }` is enough to satisfy the ask inline, because the ask path reads `session.agent.config.host?.ui` and nothing else.
  - **(c) Host port attribution — no field for the child's name.** `HostUiRequestBase` is `{ package?, sessionId? }` (`src/host/types.ts:4-7`), and both are kernel-set: `hostFor(owner, sessionId)` overwrites them on every request (`loader.ts:458-488`, "a package cannot name another package or session"). The `HostPort` a package gets in `setup` is `hostFor(name)` with **no session** (`loader.ts:673`), so a delegate that forwards `prism.host.ui` produces requests stamped `package: "@arnilo/prism-delegate"` and `sessionId: undefined`, whatever the wrapper passes. The only session-bound port is built for commands (`loader.ts:1023`, `hostFor(entry.package, context.session?.id)`).
    - Verdict for Task 4: there is **no** field for the child's name today; the planned fallback applies — prefix the request's untrusted text with `"[<child>] "` (`title`, and `detail`/`message` when present). Adding a kernel `delegationId`/`child` field to `HostUiRequestBase` is not needed by a second user, so Task 4 must not add one. The child still never sees the host object (it goes into the child's `AgentConfig`, read by the kernel), so it cannot answer its own approvals.
  - **(d) Worktree isolation mechanics.**
    - A child re-instantiates `tools-coding`, so it holds **its own** `workspace` service bound to the same `root`; the parent's `worktree.bound(sessionId)` map is not visible to the child's tools. `targets.ts:96` resolves the worktree through the service in *its* loader, keyed by `context.sessionId`. Therefore the worktree a coding child runs in must be created on **the child's** service and bound to **the child's** session id; a worktree created on the parent's service is inert for the child.
    - The pattern works: an inline package appended **after** the inherited ones in the child's `createAgent` can `prism.services.consume("workspace")` in `setup` (services are provided by `tools-coding`'s `definition`, so load order is the only requirement) and hand the handle back to the runtime through a closure — the same shape `prism-workflows` uses (`nodes/agent-node.ts:60-110`), which consumes from the parent because that is where it runs.
    - `worktree.create({ sessionId })` refuses a sandboxed run (`workspace_sandbox_unsupported`, `service.ts:288-295`) and caps at `maxWorktrees` (default 4, hard 16); the branch defaults to `prism/ws-<id>` and `base` to `HEAD` (`service.ts:296-310`). `diff(path)` is bounded (`200` files / `1 MiB`, `service.ts:452-460`). `merge(path, { into, commit? })` merges the worktree's branch **into a branch name** — it is matched against `refs/heads/<into>` and passed as `into` to `mergeTree` (`merge.ts:41-46,80-96`), so `"HEAD"` is not a valid target — requires a commit identity when the worktree is dirty, and returns `{ status: "merged", commit }` or `{ status: "conflict", files }` (never resolves conflicts).
    - **Gap: no current-branch accessor.** `WorkspaceService` exposes `worktree.{create,bound,rebind}`, `diff`, `merge`, `excludeOverlay` (`service.ts:95-115,476`) and no way to read the main tree's checked-out branch, so "merge into the parent's branch" needs either a `git rev-parse --abbrev-ref HEAD` of its own (duplicating the service's git plumbing) or one small addition: the `worktree.create` handle records the main tree's branch (the service already runs git there). Task 5 should take the second: one field on `WorkspaceWorktree` plus a compat-baseline note, instead of a private git runner in the delegate.
    - **Cleanup is the caller's.** `tools-coding` registers no `onDispose` for active worktrees, so `agent.dispose()` (`runtime.ts:190`) leaves them behind. Task 5 must `worktree.dispose({ force: true })` after merge/skip, with the `finally` already there as the place.
  - **(e) Skill duplicates.** Three registration paths, two implementations:
    - `prism.skills.register` → `registerSkill` (`loader.ts:517-535`) throws `PackageLoadError("skill_conflict")`, which fails that package's setup.
    - `AgentConfig.skills.add`/`skills.dirs`, and `skills.addDir`'s post-setup read (`loader.ts:737-741,866-874` → `loadSkillDirectory`) funnel into `createSkillRegistry(skills, { duplicate: "error" })` (`skills.ts:12-21`), whose message is a plain `Error("Duplicate skill: <name>")`.
    - `addDir` itself only records a path; the read happens after setup, and an unreadable directory or malformed/oversized `SKILL.md` throws `skill_too_large`/`setup_failed`, so a discovery package cannot use it to skip a conflict.
    - Task 4's rule therefore needs **two** comparisons (the loader's `registerSkill` and `skills.ts`'s register), keyed on `path` + `instructions` equality as planned. Its two users without delegation: a host `skills.dirs` plus `context-files` discovery of the same `SKILL.md`, and (Task 4) a child inheriting the parent's skill list **and** an inherited `context-files`. That is the kernel-addition proof `references/prism.md` §1 asks for.
  - **(f) Subagent file format** (`code.claude.com/docs/en/sub-agents`, fetched 2026-10-24). Markdown with YAML frontmatter; only `name` and `description` are required. Fields: `tools` (comma-separated **string** such as `Read, Glob, Grep`, or a YAML list), `disallowedTools`, `model` (`sonnet`/`opus`/`haiku`/`fable`/id/`inherit`), `permissionMode`, `maxTurns`, `mcpServers`, `hooks` (block list of maps, plan 190 Task 1 (a)), `skills`, `initialPrompt`, `memory`, `effort`, `background`, `omitClaudeMd`, `isolation`; unknown fields are ignored silently. Body = system prompt. Truth-gate: `parseAgentFile` already returns `description` + body, so Task 6 reads these files without a parser change.
    - Equivalents elsewhere: Codex has no markdown subagent frontmatter — its agent definitions are TOML (`~/.codex/agents/*.toml`, `codex.danielvaughan.com`, 2026-03-26, updated 2026-10-23), which is out of scope for Task 6; the `skills` CLI defines skills only, no subagents. So `.claude/agents/*.md` and `.agents/agents/*.md` (this repo) are the whole input set.
    - Tool-name map against plan 189's final names (`PATH_ARG_KEYS`, `targets.ts:22-34`): `Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Grep`→`grep`, `Glob`→`glob`, `Bash`→`shell`; `Task` maps to nothing (delegation is host-specific), and an unmapped name must be dropped rather than fail the child.
  - **(g) The `delegations` map.** `start` writes `delegations.set(id, …)` and nothing ever removes an entry (`runtime.ts:214`); only `wait`/`cancel` read it, both scoped by `parentSessionId`. Unbounded growth is real but small (one record per delegation, no messages retained). Task 2 should keep the map and note the lifetime; the child agent, session, and events are already released in the `finally`.
  - **(h) Seeding a child session (Task 7).**
    - **Parent branch in flight.** The assistant message carrying the `delegate` tool call is appended **before** tools run (`run-controller.ts:222-238` appends on `result.started`, then `executeTools`), so `session.entries()` during the call ends with that assistant message and **has no matching `tool_result`**. A seeded child whose history ends that way is an unmatched `tool_use`, so Task 7 must trim a trailing call-only assistant message (or render it as text) before seeding.
    - **Capability.** `SessionContext.entries()` requires `"session-state"` (`session.ts:278-283`); the delegate declares `["models", "background"]` (`index.ts:39`). Task 7 adds `"session-state"`.
    - **Seeding works as planned.** `createMemorySessionStore(initialEntries)` + `agent.session({ id })` takes the resume path (`create-agent.ts:190-210` → `openResumedSession`), which is the same path `fork()` uses. `agent.session()` checks `entriesInScope(branch, sessionScope)` **before** opening, so if the parent carries an `ownership` scope, either the child's `createAgent` must pass the same `ownership` (derivable from the seeded `metadata.tenantId/accountId/userId`, since `appendNow` stamps it, `session.ts:1135-1143`) or the copied entries must be stripped of the stamp. Task 7 must pick one and say so; leaving both is a `SessionNotFoundError` trap.
    - **Summaries.** `snapshot.summaries` is a `readonly string[]` (`session-stores.ts:54-59`); assembly renders each as a `system` message `Summary:\n<text>` (`input.ts:287-292`), so a seeded summary survives as a separate system block, not as history.
    - **Redaction.** Entries are redacted at append (`redactSessionEntry`, `session.ts:1143`), so what `entries()` returns is already redacted. The review's security condition holds; Task 7 adds no redaction pass.
    - **Which content does not travel.** `thinking`/`redacted_thinking`, images, `document`/`file`/`audio`, and any provider metadata are provider-bound or provider-specific (`contracts-core/content.ts:73`; `anthropic-messages.ts:330-366`). Historical `tool_call`/`tool_result` blocks are **not** validated against `request.tools` by either codec (`serializeAnthropicMessage` emits `tool_use`/`tool_result` unconditionally; `openai-chat.ts:313-318` emits `role: "tool"`), so a provider may accept them — but whether a vendor accepts a `tool_use` for an unadvertised tool is **unverified** (it needs a live call). Task 7 renders tool activity as text, so the question never arises; record it as the reason, not as a proven defect.
    - **Existing helpers.** `rebuildSessionContext` is a root export (`index.ts:389`) and returns every message of the branch unbounded. The turn-cut helpers (`packages/memory/compaction/src/prepare.ts:36-63`) live in a package the delegate/advisor must not depend on. Kernel text renderers exist but are module-private: `messageText`/`blockText` in `src/compaction.ts:72-90` (not exported) and `serializeToolResultText` in the provider kit (`openai-primitives.ts:52`, single-result only). **No exported kernel renderer for a message exists**, so `selectTranscript` must own both the slice and the rendering.
    - **Kernel-addition proof for `selectTranscript`.** No hook, slot, `PackageAPI` member, or primitive expresses "a bounded, portable slice of a branch": `rebuildSessionContext` is the closest and is unbounded and unreactive to input size. Two users: the delegate (Task 7) and the advisor (Task 8).
  - **(i) Advisor mechanics (Task 8).**
    - **`tool.call`.** `ToolCallHookPayload` has `name`, `args`, `effects`, `callId`, `sessionId`, `runId`, optional `origin`; `HookContext` adds `signal`, `emit`, and `session` (`SessionContext` bound to the owner). `{ deny: reason }` becomes `ToolResult { error: { code: "hook_denied", message: reason } }` (`run-controller.ts:359-361`), and the codecs render `error.message` as the tool-result text (`openai-primitives.ts:52-66`), so the reason **does** reach the model.
    - **`run.end`.** `RunEndPayload` carries `sessionId`, `runId`, `finishReason?`, `usage?`, the live `history`, `turn`, `continuations` (`hooks/types.ts:135-141`); `{ continue: { reason, steer? } }` is queued as a user steer through the normal path and capped by `limits.maxContinuations` (default `DEFAULT_MAX_CONTINUATIONS`, `run-limits.ts:136`). Combination is `first-continue` (`hooks/catalog.ts:60`, `bus.ts:58-64`): every handler runs, a malformed/empty `continue` is ignored, and the first valid one in hook order wins (priority desc, then load order). The advisor's and `hooks-json`'s `Stop` handler (`compile.ts:407-425`, registered with `{ id: "Stop" }`, no priority) therefore tie at priority 0 and resolve by package load order; Task 8 must state that a `Stop` handler returning `stopped` **wins over** a continuation (the hooks-json handler returns `undefined` when `result.stopped`).
    - **Hook re-entry.** `prism.models.client(ref).generate` runs `generateWithRetry` straight to the provider (`loader.ts`), so it fires **no** `model.request`/`model.call`/`model.response` hooks. The advisor's own call cannot re-trigger other packages' hooks, and no bound is needed beyond the child's own limits.
    - **Capabilities.** Registering a tool, a hook and reading `session.entries()`: `tools`? — tools need no capability; hooks need none; `session.entries()` needs `"session-state"`; `models.client` needs `"models"`. The advisor declares `["models", "session-state"]` (plus `"background"` only if it starts tasks).
    - **Enforcement rows a new integration package must join** (`rg prism-delegate` excluding `compat-baseline/`, `docs/history/`, `docs/_evidence/`):
      - `scripts/package-truth.json` (`versions`, `packages`) and `scripts/package-truth.mjs` (description row)
      - `scripts/independent-packages.json` ($comment only — lockstep list)
      - `scripts/coverage-thresholds.json` (per-package thresholds) and `scripts/coverage-summary.json`
      - `scripts/release-evidence.json` (`<name> suite` row)
      - `scripts/phase24-truth.test.mjs` (capability count) and `scripts/phase54-package-map.test.mjs` (package map)
      - `src/__tests__/packaging.test.ts` and `src/__tests__/install-smoke.test.ts` (package rows)
      - `docs/release.md` and `docs/index.md` (version tables + package list)
      - `scripts/e2e-coverage.json` (test-suite coverage row)
      - `packages/integrations/<pkg>/README.md`, `package.json`, `CHANGELOG.md`
  - **(j) Completion validation (Tasks 7 and 8).**
    - **Finding the run's task.** `run.input` is a transform hook that runs once per run, before the input messages are appended, with `runId` on its `HookContext` (`assemble.ts:352-357`). A later `run.end` continuation steer is queued through `queueContinuation` and delivered as a user message mid-run, so it does **not** pass `run.input`; capturing at `run.input` keyed by `runId` is the only correct source. On resume, `executeRun` is called with `state.input ?? []`, so `run.input` may fire with an empty array — the capture must not overwrite a non-empty one for the same `runId`.
    - **Run boundaries on their own.** Neither `SessionEntry` `runId` nor `RunEndPayload.history` help the advisor: provider `Message` has no `runId` (`contracts-core/content.ts:114-119`) and history is bare `Message[]`. Only the hook context's `runId` scopes a run.
    - **No verdict field.** `RunResult` has no field a `run.end` hook can set (`contracts-run-state.ts:250-281`); a run that stops at `maxContinuations` reports its normal status with `stopReason: "hook_limit"` (`run-controller.ts:419-424`). So the validator reports through a package event — confirmed as the only option.
    - **A runtime as a service.** The precedent is `prism-workflows` providing `WORKFLOWS_SERVICE` (`packages/integrations/workflows/src/index.ts:240`). A `run.end` hook's `HookContext` carries both `session` (`SessionContext`) and `signal`, which is exactly what `runtime.start` takes (`runtime.ts:52-64`), so the advisor can validate by delegating without a new primitive.
    - **Child output.** A child's answer is `result.text` (concatenated assistant text), capped by Task 2's `resultMaxChars` and returned as `{ delegationId, child, status, text, usage?, pending?, error? }` (`tools.ts:12-28`). A JSON verdict in `text` is reliable only if the cap plus the child's instructions say "answer with JSON only"; Task 8 must parse defensively (strip fences, fail closed to "no verdict") and treat a truncated or non-JSON answer as no verdict rather than a pass.
  - **Security.** The three conditions hold:
    - a child still gains no package the parent did not load (`buildAgent` inherits only `child.inherit` from the parent's loaded instances, and `delegate` itself is refused in that list at setup);
    - forwarding `host.ui` does not let a child answer its own approvals — the child receives the `HostUi` object inside `AgentConfig`, which only the kernel's ask path reads, and the delegate keeps its own port;
    - `session.entries()` returns entries already redacted at append (`redactSessionEntry`), so Task 7 adds no redaction pass.
  - **Verdict.** Three findings change task detail; none invalidates a task:
    1. Task 4 has **no** attribution field to set (c). It must use the planned `[<child name>] ` prefix in the request text and must not add a kernel field.
    2. Task 5 has **no** current-branch accessor and **no** automatic worktree disposal (d). It must add one `WorkspaceWorktree` field for the merge target (with a compat-baseline note) and dispose in its own `finally`; the worktree must be created on the **child's** `workspace` service, not the parent's.
    3. Task 2 and Task 3 contradict each other on the delegation entry: Task 2 pages a finished answer through `delegate_wait { offset }`, while Task 3 removes the entry as soon as a terminal `delegate_wait` (or a sync return) happens, which makes the truncation hint point at an id that no longer resolves. The entry must outlive the first terminal answer: Task 2 caps what is retained (the full answer can be 500,000 tokens by Task 3's default ceiling) and Task 3 removes the entry only when the last slice was served or the parent session closes.
    Amendments applied below: Task 4 (c) text, Task 5 (factory closure, `parentBranch`, dispose), Task 7 (trailing call-only assistant message, `ownership` on the child, `session-state` capability), Tasks 2 and 3 (retention and removal). Proceed to Task 2.

- [x] Task 2: A tool surface the model can choose from
  - Acceptance Criteria:
    - Functional: `DelegateChildConfig` gains `description?: string`. The `delegate` description becomes `Run a child agent on a task. The child sees only your input, not this conversation. Children:` followed by one `- <name>: <description>` line per child. A child without `description` uses the first sentence of its `instructions`, else `(no description)`, and setup notes `info` once per such child.
    - Functional: The schema describes `child` and `input` (`"A self-contained brief: the goal, the relevant files or facts, constraints, and what to return. The child cannot ask you follow-up questions."`) and `mode` (`"sync waits for the result; async returns a delegationId for delegate_wait"`).
    - Functional: The `delegate` result's text is the child's final answer followed by one status line (`[child reviewer: completed, 12 turns, 41,203 tokens]`); the structured `value` keeps its fields.
    - Functional: **Bounded result.**
      - Child config `resultMaxChars` (default 12,000, hard cap 64,000) caps the answer text the parent sees.
      - A longer answer is cut at the last paragraph break before the cap and ends with `[truncated: <shown>/<total> chars; delegate_wait { delegationId: "<id>", offset: <shown> } returns the rest]`.
      - `delegate_wait` gains optional `offset` and returns the next slice of a finished delegation's answer, with `totalChars`, `nextOffset`, and `truncated`, the same shape as plan 192's `web_fetch` paging.
      - The full answer stays in the delegation entry, capped by `HARD_RETAINED_RESULT_CHARS` (256,000 chars, ≈64k tokens): the child's own limits can produce far more than the parent should ever hold, so a longer answer is cut at the cap and the hint's `<total>` is the retained total. The entry is removed by Task 3's rule, which must therefore keep it until the last slice was served or the parent session closes.
    - Functional: The default child instruction (prepended to the child's own instructions) ends with: `Finish with a concise report for the parent: what you did, what you found, files changed, and open issues. The parent sees only this report.`
    - Performance:
      - The description grows by one line per child; nothing per call.
      - The parent's context grows by at most `resultMaxChars` per delegation; the README states it and how to raise it.
    - Code Quality: Descriptions are built once at setup from config.
    - Security: Descriptions come from host config or Task 6's trusted files, never from model output.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/src/tools.ts:29-45`, `src/config.ts:7-20`.
    - Options Considered:
      - Leave the choice to child names. Rejected: names alone (`reviewer`, `research`) do not say when to use a child or what to give it.
      - Return the child's whole answer. Rejected: one verbose child can add tens of thousands of tokens to every later parent request, which undoes the isolation (Context-Folding; Chroma "Context Rot", 2025).
      - Have a model summarize the child's answer. Rejected: an extra model call per delegation, and the child, which knows what matters, is already asked to report concisely.
    - Chosen Approach:
      - Per-child descriptions and documented arguments.
    - API Notes and Examples:
      ```ts
      delegate({ children: { reviewer: { description: "Reviews a diff for correctness bugs.", inherit: ["@arnilo/prism-tools-coding"] } } })
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/{tools,config,index,runtime,limits}.ts`, `src/__tests__/package.test.ts`, `packages/integrations/delegate/README.md` (Tools: `delegate_wait` `offset`; Cost: result cap), `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Task 6 (file-defined children supply `description`); Task 7 (children with `context` change the "sees only your input" sentence).
  - Test Cases to Write:
    - `delegate_description_lists_child_descriptions`; `child_without_description_uses_first_sentence`; `delegate_input_is_described_as_self_contained`; `delegate_result_text_has_status_line`.
    - `delegate_result_capped_with_paging_hint`: a 30,000-char answer shows ≤ 12,000 chars and the hint (breaks if the parent gets the whole answer).
    - `delegate_wait_offset_returns_next_slice`; `delegate_wait_offset_after_entry_removed_is_unknown_delegation`.
    - `default_child_instruction_asks_for_concise_report`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the `DelegateChildConfig` diff.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config field and tool text.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md` (Tools, Configuration); `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Implementation.** `DelegateChildConfig.description` and `.resultMaxChars` (`config.ts`, both in the schema: `description` `minLength: 1`, `resultMaxChars` integer ≥ 1). `createDelegateRuntime` builds the description once from config (`Run a child agent on a task. The child sees only your input, not this conversation. Children:` + one `- <name>: <line>` per child), falling back to the first sentence of `instructions` and then to `(no description)` with one `info` note per such child. `DEFAULT_CHILD_INSTRUCTIONS` is prepended to every child's own instructions, so the report contract is always first. `child`, `input`, and `mode` carry their planned descriptions.
  - **Result rendering — deviation from the plan text.** The plan asked for the answer followed by a status line *and* the structured `value`; the kernel cannot do both: `toToolResultMessage` sets `result: toolResultPayload(result)` and that function returns `value` whenever it is set, while text parts are filtered out of the message (`src/input.ts:322-360`). A `value` therefore hides every word the plan wanted the model to read, and JSON-escaping the answer is exactly what plan 189 removed from coding results. Decision: the three delegate tools return **text only**, following `read`/`shell` — `delegate` and `delegate_wait` return `answer\n\n[hint]\n\n[child <name>: <status>, <n> turns, <tokens> tokens, <n> pending]` (tokens and pending omitted when absent), the async start returns `[child <name>: running, delegationId <id>]`, and `delegate_cancel` returns `delegation <id>: <status>`. The paging cursor rides the hint line, read as `offset: <n>`, so the model needs no JSON. `DelegateService` (Task 7) keeps the structured `DelegationOutcome`, so code consumers lose nothing.
  - **Bounds.** `resultMaxChars` resolves through `resolveResultMaxChars` (default 12,000, clamped to `HARD_MAX_RESULT_MAX_CHARS` = 64,000). The page is cut at the last `\n\n` inside the cap and ends with `[truncated: <nextOffset>/<totalChars> chars; delegate_wait { delegationId: "<id>", offset: <nextOffset> } returns the rest]`; `delegate_wait` takes `offset` (non-negative integer) and serves the next slice. The runtime retains the answer up to `HARD_RETAINED_RESULT_CHARS` (256,000) per delegation, and `DelegationOutcome` gains `turns` so the status line can report it.
  - **Coverage.** 22 tests pass (`packages/integrations/delegate`), including the new `delegate_description_lists_child_descriptions`, `child_without_description_uses_placeholder_and_notes`, `delegate_input_is_described_as_self_contained`, `delegate_result_text_has_status_line`, `default_child_instruction_asks_for_concise_report`, `delegate_result_capped_with_paging_hint` (30,048-char answer → ≤ 12,000 shown + hint), `delegate_wait_offset_returns_next_slice` (a second page starts past 12,000), and `delegate_wait_unknown_delegation_is_tool_error`. Three older assertions moved from JSON values to the text result.
  - **Docs and example.** README: the Tools table (text results, `offset`, the `delegate_wait` hint), the Configuration rows for `description` and `resultMaxChars`, and a Cost paragraph for the per-delegation cap. `examples/delegate.ts` reads the text result instead of `value.text` and still runs to completion. `CHANGELOG.md` (Added).
  - **Release gate.** `bun scripts/release.mjs gate --update-baseline` passes. The delegate baseline gains `DEFAULT_CHILD_INSTRUCTIONS`, `DEFAULT_RESULT_MAX_CHARS`, `HARD_MAX_RESULT_MAX_CHARS`, `HARD_RETAINED_RESULT_CHARS`, `resolveResultMaxChars`; no other package's baseline changed by this task.

- [x] Task 3: Budgets that finish the work, and fewer knobs
  - Acceptance Criteria:
    - Functional: `DEFAULT_CHILD_LIMITS` becomes `{ maxTurns: 50, maxToolCalls: 200, maxTotalTokens: 500_000, maxWallTimeMs: 15 * 60_000 }` and `HARD_CHILD_LIMITS` becomes `{ maxTurns: 200, maxToolCalls: 1000, maxTotalTokens: 2_000_000, maxWallTimeMs: 60 * 60_000 }` (`src/limits.ts:5-7`). A configured value is still clamped to the hard ceiling, and the parent's `limits` still bound the child through the kernel's narrow-only rule.
    - Functional: `budgetShare` is removed (config, schema, setup check at `src/index.ts:39-41`, `resolveChildLimits` parameter). `lifetime` is removed: `mode: "sync"` aborts with the calling tool call; `mode: "async"` always runs as `session.background` work that ends with the parent session (today's `lifetime: "session"` path, `runtime.ts:206-216`). Unknown keys fail `createAgent` with the kernel's config error, so a manifest that still sets them fails loudly.
    - Functional: A delegation's entry leaves the `delegations` map when its retained answer has been fully served — a `delegate_wait` returned `nextOffset: undefined`, or a sync return whose result was not truncated — and on `session.closed` for that parent session. A truncated sync result keeps its entry so the hint can be followed. `delegate_wait` on a removed id is the existing "Unknown delegation" error.
    - Functional: Sweep: a repo-wide grep for `budgetShare`, `DelegateLifetime`, and `lifetime:` in delegate config (exclusions: `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) finds nothing outside `CHANGELOG.md`.
    - Performance: The README's cost section states the new worst case per delegation (500,000 tokens by default) and how to lower it (`limits`).
    - Code Quality: One limits path; no alias for the removed fields.
    - Security: Ceilings still bound every child; the test proves a configured value above the ceiling is clamped.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/src/{limits,config,runtime,index}.ts`; plan 189 Task 8 (default coding tool schemas are the per-call floor); Task 1 (a), (g).
    - Options Considered:
      - Keep small defaults and document raising them. Rejected: with about 3.7k tokens of coding-tool schemas per call before plan 189 (and still several thousand after), 20,000 tokens is three or four calls, so the default child cannot finish a coding task.
      - Keep `budgetShare`. Rejected: `limits` already sets the same numbers directly.
    - Chosen Approach:
      - Workable defaults, hard ceilings, and one way to set each limit.
    - API Notes and Examples:
      ```ts
      children: { tester: { inherit: [...], limits: { maxTotalTokens: 100_000 } } }
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/{limits,config,runtime,index}.ts`, `src/__tests__/package.test.ts`, `apps/prism-agent/src/host/orchestrator.ts` (if it sets a removed field), `examples/delegate.ts` (same), `packages/integrations/delegate/README.md`, `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Task 1 (a).
  - Test Cases to Write:
    - `child_default_limits_are_workable`; `child_limit_above_ceiling_is_clamped`.
    - `budget_share_and_lifetime_fail_config_validation`.
    - `async_delegation_ends_with_parent_session`; `sync_delegation_aborts_with_tool_call`.
    - `delegation_entry_removed_after_last_slice_and_on_session_close`; `truncated_sync_result_keeps_entry_for_paging`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the removed exports and type fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — defaults and removed config fields.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md` (Configuration, Cost, Safety); `CHANGELOG.md` (Changed, Removed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Defaults.** `DEFAULT_CHILD_LIMITS` is 50 / 200 / 500,000 / 15 min and `HARD_CHILD_LIMITS` 200 / 1,000 / 2,000,000 / 60 min (`limits.ts`). `resolveChildLimits(requested)` clamps each requested value to the ceiling and otherwise uses the default; the constant defaults still satisfy `RunLimits`, and the parent's limits keep narrowing through the kernel's existing rule.
  - **Removed knobs.** `DelegateChildConfig.budgetShare` and `.lifetime`, the schema entries, the setup check, the `budgetShare` parameter of `resolveChildLimits`, and the `DelegateLifetime` type (config, `index.ts` re-export). A config that still sets either fails `createAgent` on the schema's `additionalProperties: false` — `budget_share_and_lifetime_fail_config_validation` proves both.
  - **`mode` replaces `lifetime`.** `detached = input.mode === "async"`: only a sync delegation listens to the calling tool call's abort, and only an async one registers `session.background("delegate:<id>")`, so it ends with the parent session. `start` returns the running marker for async and the outcome for sync.
  - **Entry lifetime (the Task 2/Task 3 conflict resolved in Task 1).** `release(id, parentSessionId)` deletes an entry; the tools call it through `complete()` only when the returned page has no `nextOffset`, so a truncated answer stays pageable. `session.closed` for the parent session drops its entries through an observe hook registered by `createDelegateRuntime`. A delegated id whose entry is gone is the existing "Unknown delegation" error.
  - **Coverage.** 26 tests pass. New/changed: `child_default_limits_are_workable`, `child_limit_above_ceiling_is_clamped` (the old combined limits test split), `budget_share_and_lifetime_fail_config_validation`, `async_delegation_ends_with_parent_session` (was the `lifetime` test), `delegate_wait_releases_a_fully_served_answer` (a second wait on the same id is unknown), and `truncated_sync_result_keeps_entry_for_paging` (a truncated sync result pages instead of releasing).
  - **Sweep.** `grep -rn "budgetShare|DelegateLifetime|lifetime:"` over `packages/`, `apps/`, `examples/`, `docs/tools.md`, `docs/agent.md` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) finds only the negative test that asserts the removal and `CHANGELOG.md`.
  - **Docs.** README drops both rows, states the new defaults in Safety, and says when a sync answer ends and that an async one runs as background work; the Tools table records when an entry is dropped. `CHANGELOG.md` has Changed and Removed entries.
  - **Release gate.** `bun scripts/release.mjs gate --update-baseline` passes; the delegate baseline drops `DelegateLifetime` and the `budgetShare` parameter and keeps the Task 2 additions.

- [x] Task 4: Children ask the parent's host and inherit skills
  - Acceptance Criteria:
    - Functional: `buildAgent` passes `host: { ui: <wrapped prism.host.ui> }` to the child's `createAgent`. Task 1 (c): `HostUiRequestBase.package` and `.sessionId` are kernel-set and the setup-time port carries neither the child's package nor its session, so **no field exists** for the attribution. The wrapper therefore prefixes the request's untrusted text with `[<child name>] ` — `title`, and `detail`/`message` when present — and adds no kernel field. A child's `ask` now reaches the person; the child suspends (`status: "suspended"`, today's path) only when the parent host answers `unavailable`.
    - Functional: `DelegateChildConfig.skills?: "inherit" | "none" | string[]` (default `"inherit"`). The child's `createAgent` gets `skills: { add: <parent skills selected> }` from `prism.skills.list()` at delegation time.
    - Functional: Kernel rule: registering a skill whose name is taken by a skill with the same `path` and the same `instructions` is a no-op, not `skill_conflict`, for `prism.skills.register`, `AgentConfig.skills.add`, and `skills.dirs`. A same-name skill with a different path or body is still `skill_conflict`. This lets a child inherit both the parent's skills and an inherited `context-files` instance that discovers the same files.
    - Performance: `prism.skills.list()` once per delegation; skills are frozen copies, not re-read from disk.
    - Code Quality: The kernel change is one comparison in the skill registry's duplicate check (`src/skills.ts:12-38` and the loader's registration path), with the two-user proof from Task 1 (e) in the note. No new `PackageAPI` member.
    - Security: The child cannot approve its own requests: they go to the parent's host, which the child never sees. A child of a parent with no `host.ui` behaves as today (suspends). The idempotence check compares path and body, so a malicious package cannot shadow a skill by reusing its name.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/src/runtime.ts:86-121`; `src/skills.ts`; `src/packages/loader.ts:720-745`; Task 1 (b), (c), (e).
    - Options Considered:
      - Resume a suspended child after the parent approves. Rejected: needs a cross-agent resume protocol; forwarding the host port avoids the suspension in the first place.
      - Skip skills owned by inherited packages instead of a kernel rule. Rejected: `PackageAPI` exposes no skill owner, and the same duplicate arises without delegation (a host `skills.dirs` plus `context-files` discovery).
    - Chosen Approach:
      - Forward the host port, inherit skills, and make identical re-registration idempotent.
    - API Notes and Examples:
      ```ts
      children: { coder: { inherit: ["@arnilo/prism-tools-coding", "@arnilo/prism-approval"], skills: "inherit" } }
      // child's edit → approval ask → parent host.ui confirm "[coder] Allow edit src/a.ts?"
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/{runtime,config}.ts`, `src/__tests__/package.test.ts`, `src/skills.ts`, `src/packages/loader.ts`, `src/__tests__/skills.test.ts`, `src/__tests__/package-loader.test.ts` (or the loader's skill test file Task 1 names), `packages/integrations/delegate/README.md`, `docs/agent.md`, `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Plan 190 Task 5.
  - Test Cases to Write:
    - `child_approval_request_reaches_parent_host`: an inherited `approval` in `ask` mode, scripted host approves, the child's edit lands; fails if the child suspends.
    - `child_suspends_when_parent_host_unavailable`.
    - `forwarded_request_names_child`.
    - `child_inherits_parent_skills_by_default`, `child_skills_none`, `child_skills_named_subset`.
    - `identical_skill_reregistration_is_noop`, `same_name_different_body_is_skill_conflict`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — child behavior, config field, kernel registration rule.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md` (Safety: approvals now reach the parent host; Configuration: `skills`); `docs/agent.md` "Tools and skills": the idempotent re-registration rule; `CHANGELOG.md` (Changed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Host forwarding.** `buildAgent` reads `prism.host.ui` once and, when it exists, passes `host: { ui: childHostUi(name, ui) }` to the child's `createAgent`. The wrapper keeps the request's shape and prefixes `[<child>] ` into every user-visible field — `title`, plus `detail` when the kind has one and `message` for `notify`, which carries no title. `package`/`sessionId` are left alone because the kernel overwrites them (Task 1 (c)); a forwarded request therefore reports `package: "@arnilo/prism-delegate"` and the child's name only in text, as planned. The package declares `"host-ui"`, which `packageConformance` requires (the review's capability list omitted it).
  - **Approvals.** With a parent `host.ui`, an inherited `approval`/`ask` reaches the person: `child_approval_request_reaches_parent_host` drives a `tool.call` `ask` inside the child with a scripted confirm, the child completes, and no suspension happens. The existing `delegate_child_ask_suspends_not_approved` still proves the no-host path (suspended, pending count in the status line). `forwarded_request_names_child` asserts `[reviewer] Approve tool "child_tool"` in the title and `[reviewer] ` in the detail.
  - **Skills.** `DelegateChildConfig.skills?: "inherit" | "none" | readonly string[]` (schema `anyOf`), resolved per delegation from `prism.skills.list()`: `"inherit"` (default) or `"none"`, otherwise the named subset in the configured order; an unknown name throws `DelegateError("Unknown skill for the child: <name>")` and the tool reports it. The child's `createAgent` gets `skills: { add: selected }`.
  - **Kernel rule.** `isSameSkill(a, b)` (exported from `src/skills.ts`) compares `name`, `path`, and `instructions`. `createSkillRegistry.register` returns early on a match, so `AgentConfig.skills.add` and `skills.dirs` (merged into `add`) accept an identical re-registration. The packages loader's `registerSkill` applies the same check against either the owning package's registered skill or the host's entry, so `prism.skills.register` and `skills.addDir` do too. A same-name skill with a different path or body is still `skill_conflict`. Both users are real: a host `skills.dirs` plus `@arnilo/prism-context-files`, and a child inheriting both the parent's skills and that package.
  - **Coverage.** 32 delegate tests pass, including `child_inherits_parent_skills_by_default`, `child_skills_none`, `child_skills_named_subset`, `child_skills_unknown_name_fails_delegation`, plus the three host-forwarding tests. Kernel: `identical_skill_reregistration_is_noop` (two packages plus the host registering one `SKILL.md`, then a different body and a different path both `skill_conflict`) in `package-contributions.test.ts`; the two older conflict tests (`skill_and_provider_conflicts_fail_closed`, `strict mode rejects duplicate skill names`) now use a different body, because identical registrations are the new no-op.
  - **Docs.** README: the `skills` config row and the Safety section (approvals reach the parent host, labelled, and the child cannot answer its own; without a host the child suspends). `docs/agent.md`: the `skills` field row states the idempotence rule and a paragraph names all three registration paths and both duplicate sources. `CHANGELOG.md` (Changed).
  - **Release gate.** `bun scripts/release.mjs gate --update-baseline` passes after a kernel `budgets.json` rebaseline (the comment records the `isSameSkill` rule as the only growth): 1129189 packed / 3682866 unpacked / 38409 source lines; file count and root exports unchanged. The delegate baseline gains the `skills` config field and `childHostUi`-driven behavior has no export delta.

- [x] Task 5: Worktree isolation for coding children
  - Acceptance Criteria:
    - Functional: `DelegateChildConfig.isolation?: "none" | "worktree"` (default `"none"`). With `"worktree"`, the delegate adds an inline package to the child's `createAgent` that consumes the child's `workspace` service; after the child session opens, it calls `worktree.create({ sessionId })` so every inherited coding tool runs in the worktree (Task 1 (d)). No `workspace` service in the child fails the delegation with `DelegateError` `isolation_unavailable` before the child runs, and the tool result says which package provides the service.
    - Functional: `WorkspaceWorktree` gains `parentBranch: string`, recorded by `worktree.create` from the main tree's checked-out branch (Task 1 (d): the service exposes no such accessor, and `merge` only accepts a **branch name** — it matches `refs/heads/<into>`). The reference-host/`prism-workflows` behavior is unchanged; the addition is recorded in `scripts/compat-baseline/arnilo__prism-tools-coding.txt` with a `--update-baseline` note, and the delegate never runs git itself.
    - Functional: When the child finishes with `completed`, the delegate merges with `workspace.merge(path, { into: worktree.parentBranch, commit: { message: "delegate(<child>): <first line of input>" } })`. A clean merge disposes the worktree and returns `merge: { status: "merged", commit, files }`. A conflict returns `merge: { status: "conflict", files, branch }`; a dirty or missing target returns `merge: { status: "refused", reason, branch }`. In both cases the worktree is disposed but its branch is kept. A child that fails, is cancelled, or hits a limit returns `merge: { status: "skipped", branch }` with its branch kept and nothing merged.
    - Functional: Parallel async children each get their own worktree (bounded by the child service's `maxWorktrees`); merges run one at a time in completion order.
    - Performance: One `git worktree add` and one merge per isolated delegation; nothing for `isolation: "none"`. The README states it.
    - Code Quality: The delegate names the `workspace` service, never the `tools-coding` package (the same service contract `prism-workflows` uses). The merge result is part of the `delegate`/`delegate_wait` `value` and summarized in the result's status line. The inline package is appended after the inherited ones in the child's `createAgent` (services are provided by the inherited package's `definition`, so load order is the only requirement). `tools-coding` registers no `onDispose` for active worktrees (Task 1 (d)), so the delegation's existing `finally` disposes the worktree on every path — completed, failed, cancelled, and a merge refusal — before `agent.dispose()`.
    - Security: The child's tools cannot write the parent's tree (the bound-session hard deny, `packages/tools/coding/README.md` "Worktree roots for one session"). The delegate never pushes, never resolves a conflict, and never deletes an unmerged branch. A sandboxed child (`workspace_sandbox_unsupported`) fails with `isolation_unavailable` instead of running unisolated.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/workspace/{service,merge}.ts`; `packages/tools/coding/README.md` "Workspace service"; `packages/integrations/workflows/src/nodes/agent-node.ts:58-140`; Task 1 (d).
    - Options Considered:
      - Leave changes on the branch and let the parent model merge with `git`. Rejected: every parent would re-implement the merge, and plan 189 removed the git tools that would do it safely.
      - A `delegate_merge` tool. Rejected: one more tool for a step that has a deterministic default.
      - Rewrite the inherited package's `root` config to the worktree. Rejected: the delegate would have to know which config key means "root" in which package.
    - Chosen Approach:
      - Bind through the child's own `workspace` service and merge with its compare-and-swap merge, keeping branches whenever anything is not clean.
    - API Notes and Examples:
      ```ts
      children: { coder: { inherit: ["@arnilo/prism-tools-coding"], isolation: "worktree" } }
      // delegate → { status: "completed", text, merge: { status: "merged", commit: "ab12…", files: ["src/a.ts"] } }
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/isolation.ts` (new), `src/{runtime,config,tools}.ts`, `src/__tests__/isolation.test.ts` (new, in a temp git repository), `examples/delegate.ts` (an isolated coding child, offline on the mock provider), `examples/README.md`, `scripts/e2e-coverage.json` (the example), `packages/integrations/delegate/README.md`, `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`
      - `packages/tools/coding/src/workspace/service.ts` (`parentBranch` on the handle), its service test, `packages/tools/coding/README.md` (the handle fields), `scripts/compat-baseline/arnilo__prism-tools-coding.txt`
    - References:
      - Plan 165 Task 7 (worktree routing), plan 169 (agent nodes).
  - Test Cases to Write:
    - `isolated_child_edits_only_its_worktree`: the parent tree is untouched until merge.
    - `isolated_child_clean_merge_lands_on_parent_branch`.
    - `isolated_child_conflict_keeps_branch_and_tree_unchanged`.
    - `isolated_child_dirty_target_refused`.
    - `failed_child_skips_merge_keeps_branch`.
    - `parallel_isolated_children_merge_in_completion_order`.
    - `isolation_without_workspace_service_fails_before_run`; `isolation_under_sandbox_fails_closed`.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/delegate.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config field and result field.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md`: "Worktree isolation" (binding, merge outcomes, kept branches, cost); `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **`parentBranch` costs no git process.** `worktree.create`/`rebind` already run `git worktree list`; the main tree's entry there carries `branch refs/heads/<name>`, so the handle records it from that output (`HEAD` when the main tree is detached, which the delegate refuses). No `rev-parse` was added, so one isolated delegation is still `worktree add` + merge.
  - **Binding through the child's own service.** `isolationProbe(capture)` is an inline `definePackage` appended last in the child's `packages` (after the bridge and the inherited instances) whose `setup` does `services.consume("workspace")`; services exist only after the earlier `setup` calls, so load order is what makes it reach the child's coding instance. `run()` checks the capture *after* `createAgent` and before `agent.session()`, so a child with no service fails with `isolation_unavailable: child <name> has no "workspace" service; … for example @arnilo/prism-tools-coding …` and never opens a session. `worktree.create({ sessionId: session.id })` runs before `session.run`, so the inherited routing (`workspace.bound(sessionId)`) sends every coding tool to the worktree.
  - **Deviation — `DelegateConfig.ownership`.** A child agent cannot infer the parent's scope (no `OwnershipScope` on `SessionContext`, `ToolExecutionContext`, or `PackageAPI`), and an inherited coding `write` is a durable `local_mutation` effect: without a scope the child's first write fails with `ownership is required for a durable tool effect`, and with a principal it fails as `ERR_PRISM_CODING_PRINCIPAL_REQUIRED`. The package therefore takes `ownership` (schema-validated) and passes it to each child's `createAgent`, mirroring `RunWorkflowOptions.ownership`; the parent's `principal` was already forwarded. Without this, "delegation for coding workflows" could not write a file.
  - **Deviation — `workspace.commit(path, { message })`.** "Its branch is kept" is empty if the child's work is uncommitted: the branch still points at the base commit, so `dispose`'s `git branch -d` deletes it and `force` disposal destroys the edits. The service gains a `commit` method (stage all, `writeTree`, `commitTree` on the branch, compare-and-swap `updateRef`, no merge; a clean worktree creates nothing and returns its tip) and the delegate commits a skipped/conflicted/refused child's pending changes before disposing. `requireIdentity` moved from `merge.ts` to an export so both paths share the identity rule. Both additions are in the `tools-coding` README and compat baseline.
  - **Merging.** `settle()` runs inside a per-runtime promise chain, so two children finishing together never race a compare-and-swap. Outcomes: `merged { commit, files }` (files from `workspace.diff` before disposal), `conflict { files, branch }`, `refused { reason, branch }` (a `workspace_dirty_target`, a detached parent `HEAD`, or any merge error), `skipped { branch }` (failed, cancelled, or limited). The status line appends `, merged <sha7> (N files)`, `, merge conflict: <files> (branch <b> kept)`, `, merge refused: <reason> (branch <b> kept)`, or `, branch <b> kept` — text, like every other Task 2 result, because `value` drops the text parts.
  - **Disposal.** The delegation's `finally` disposes the worktree before `session.close()`/`agent.dispose()`, force-disposing a kept branch's worktree (the branch is what survives); a merged branch is deleted by the service.
  - **Tests.** `src/__tests__/isolation.test.ts` (real temp repository, real `tools-coding`, mock provider): `isolated_child_edits_only_its_worktree` (the parent tree has no child file while the child runs, then a clean merge), `isolated_child_clean_merge_lands_on_parent_branch` (subject `delegate(coder): write the file`, branch deleted, tree clean), `isolated_child_conflict_keeps_branch_and_tree_unchanged`, `isolated_child_dirty_target_refused`, `failed_child_skips_merge_keeps_branch` (`maxTurns: 1`), `parallel_isolated_children_merge_in_completion_order` (both merges land, each on the last), `isolation_without_workspace_service_fails_before_run`, `isolation_under_sandbox_fails_closed`. The sandbox case uses a service that answers `worktree.create` with `workspace_sandbox_unsupported` instead of a real docker/native backend: the mapping is what the acceptance pins, and a real backend is environment-dependent. The parallel test asserts no lost update (two linear merge commits) rather than a fixed order, because which child finishes first is scheduling. 40 delegate tests and 628 `tools-coding` tests pass.
  - **Example.** `examples/delegate.ts` gains `demoIsolated()`: a throwaway `git init` repo in the OS temp dir, a `coder` child with `isolation: "worktree"`, the parent's `statusLine` and `main`'s new subject printed, the repo removed afterwards. It is now in `scripts/e2e-coverage.json` and the `docs.test.ts` demos list (it was in neither before), and `examples/README.md` describes both halves.
  - **Docs.** Delegate README gains `isolation` and `ownership` rows and a "Worktree isolation" section (binding, merge outcomes, kept branches, cost, the one-at-a-time merge); `examples/README.md`; `tools-coding` README rows for `parentBranch` and `commit`; both CHANGELOGs. No root CHANGELOG entry, matching the plan's docs assessment for this task.
  - **Release gate.** `bun scripts/release.mjs gate --update-baseline` then a clean `gate` pass. Baselines: delegate (+`DelegationMerge`/`IsolationWorkspace`/`IsolatedWorktree`, `isolationProbe`, `mergeMessage`), `tools-coding` (+`requireIdentity`). No kernel growth.
  - **Known limit.** A child whose worktrees are created but whose merge is refused keeps the branch; the branch name and reason are in the status line, and the delegate never pushes, resolves a conflict, or deletes an unmerged branch.

- [x] Task 6: Children from subagent files
  - Acceptance Criteria:
    - Functional: New config `agentsRoot?: string` and `defaultInherit?: string[]`. When `agentsRoot` is set, setup reads `<agentsRoot>/.agents/agents/*.md` then `<agentsRoot>/.claude/agents/*.md` with `parseAgentFile` (plan 190 Task 2). Each file becomes a child: `name`, `description`, body as `instructions`, `model` when it is a model ref the parent can resolve (Claude aliases such as `sonnet` or `inherit` mean the parent session's model), `inherit: defaultInherit` (required when `agentsRoot` is set; setup fails naming the field otherwise), and `tools` mapped through Task 1 (f)'s name map into `tools.only`.
    - Functional: A configured `children` entry wins over a file with the same name; `.agents` wins over `.claude`; each skipped duplicate notes `info`. A malformed file, or a `tools` list that maps to no registered tool, notes `warn` and is skipped. Unknown tool names in a list that maps partly are dropped with one `info` note.
    - Functional: Files are read only from the configured `agentsRoot`; there is no home-directory scan.
    - Performance: One `readdir` per directory and one read per file at setup.
    - Code Quality: The tool-name map is a frozen constant in `src/agent-files.ts`; no other place translates names.
    - Security: File-defined children get only `defaultInherit` packages, narrowed by `tools`, never more; a file cannot name a package. Agent files are instructions; nothing is imported or executed.
  - Approach:
    - Documentation Reviewed:
      - `src/contribution-parsing.ts` (`parseAgentFile` after plan 190 Task 2); Task 1 (f); Claude Code subagent docs (find-docs; record the date).
    - Options Considered:
      - Prism-only `AGENT.md` directories. Rejected: the point is to accept files other agents already have.
      - Let files name packages. Rejected: a repository file could then grant itself packages the host did not choose.
    - Chosen Approach:
      - Read both directory conventions into ordinary children, with the host choosing the package set.
    - API Notes and Examples:
      ```md
      ---
      name: reviewer
      description: Reviews a diff for correctness bugs.
      tools: Read, Grep, Glob
      model: inherit
      ---
      You review diffs. Report each bug with file:line and a one-line fix.
      ```
      ```ts
      delegate({ agentsRoot: process.cwd(), defaultInherit: ["@arnilo/prism-tools-coding"], children: {} })
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/agent-files.ts` (new), `src/{config,index}.ts`, `src/__tests__/agent-files.test.ts` (new), `packages/integrations/delegate/README.md`, `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Plan 190 Task 2; plan 189 Tasks 4 and 8 (final tool names).
  - Test Cases to Write:
    - `claude_subagent_file_becomes_child`: name, description, instructions, `tools.only` mapped.
    - `configured_child_wins_over_file`; `agents_dir_wins_over_claude_dir`.
    - `model_inherit_uses_parent_model`.
    - `unmappable_tools_file_skipped_with_note`; `malformed_agent_file_skipped_with_note`.
    - `agents_root_requires_default_inherit`.
    - `file_child_cannot_exceed_default_inherit`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new config fields.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md`: "Children from subagent files" (directories, fields, tool-name map, precedence); `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **`tools.list()` is unreadable during setup, so the registry check moved to the first run.** The kernel guards `prism.tools.list()` with `state_not_ready` while packages load (`loader.ts` `assertReadable`), so setup cannot ask which tools the agent registers. `resolveAgentChildren` therefore applies the closed `AGENT_TOOL_NAMES` map only: a file whose `tools` list contains no mappable name is skipped with `warn` ("lists only tools this delegate cannot map"), and unmapped names in a partly-mapping list are dropped with one `info`. A *mapped* name the agent does not register cannot be dropped there either, and `RunOptions.tools.only` "fails closed on unknown names", so the runtime drops it once per child on the first delegation (`resolveToolNames` in `runtime.ts`, cached, one note; `warn` when nothing survives). Without that second pass a file child with `tools: Read` over a `defaultInherit` without a coding package would fail every run instead of running without the tool.
  - **Precedence and notes.** `resolveAgentChildren` merges in order: configured `children` (copied first), `.agents/agents`, `.claude/agents`; a duplicate is one `info` note naming the file and whether config or another file won. Read errors other than `ENOENT`/`ENOTDIR`, a parse failure, and an unmappable-only `tools` list are `warn` + skip, so package setup never fails on a bad file. `defaultInherit` is checked in `index.ts` before the scan (setup throws naming the field) and again for `@arnilo/prism-delegate`.
  - **Model handling.** `provider/model` is taken as the child's model unfiltered; `inherit`, the Claude aliases (`sonnet`, `opus`, `haiku`, `fable`), a bare id, and an absent `model` all mean the parent session's model, the bare id with one `info` note. There is no setup-time model catalog, so a ref whose provider the parent does not register is accepted here and fails on the child's first turn with the provider's own error; the README says so.
  - **Fields read.** Only `name`, `description`, the body, `tools`, and `model`; everything else in the frontmatter (`permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, `inherit`, …) is ignored — a file is instructions, and nothing is imported or executed. A file without a description falls back to Task 2's first-sentence rule (then `(no description)` + the existing setup note) rather than being skipped.
  - **Tests.** `src/__tests__/agent-files.test.ts` (10): `claude_subagent_file_becomes_child`, `configured_child_wins_over_file`, `agents_dir_wins_over_claude_dir`, `model_inherit_uses_parent_model_and_a_ref_is_used` (end to end: the child turn's provider request reports model `m` for `inherit` and `other` for `mock/other`), `unmappable_tools_file_skipped_with_note`, `malformed_agent_file_skipped_with_note`, `agents_root_requires_default_inherit` (unit throw + `createAgent` rejects), `file_child_cannot_exceed_default_inherit` (frontmatter `inherit` ignored; `defaultInherit` naming this package rejected), `file_child_runs_with_its_mapped_tools_only` (child turn offered exactly `["read"]`; the tool description lists the file child), `unavailable_tool_names_are_dropped_at_run_time` (`tools: Read, Grep` over a package with neither → `["read"]` and the info note). 50 delegate tests pass; typecheck clean.
  - **Docs.** Delegate README: `agentsRoot`/`defaultInherit` rows and a "Children from subagent files" section (directories, frontmatter table, precedence, skip/drop notes, example file and config). CHANGELOG `Added`. No example change, matching the plan's docs assessment.
  - **Release gate.** `--update-baseline` then a clean pass. Baseline: `AGENT_TOOL_NAMES`, `AgentFileNote`, `resolveAgentChildren`, and `createDelegateRuntime(prism, resolved?)`; no kernel change.
  - **Known limits.** No home-directory scan (deliberate); `.md` files only and no subdirectories; a mapped-but-unregistered tool is reported at the first run, not at setup; and a file cannot set limits, report mode, skills, isolation, or `ownership`.

- [x] Task 7: Children that see the parent's conversation, and children run from code
  - Acceptance Criteria:
    - Functional: **Kernel export `selectTranscript`.** The signature is `selectTranscript(entries: readonly SessionEntry[] | readonly Message[], options: { lastTurns?: number; maxChars: number; maxToolChars?: number; pinned?: readonly Message[] }): TranscriptSlice`, in `src/session/transcript.ts` and exported from `@arnilo/prism`. It returns `{ summaries: string[]; pinned: Message[]; messages: Message[]; turns: number; omittedTurns: number; truncated: boolean }`.
      - **Accepted input.** It accepts branch entries or live messages. `RunEndPayload.history` is a `Message[]`.
      - **Pinned messages.** `pinned` messages are rendered with the same portability rules and always included. They are charged against `maxChars` first and cut last; a pinned message bigger than `maxChars` alone is cut from its end and sets `truncated`. A pinned message that also falls inside the selected turns is not repeated.
      - **What it keeps.** It walks the branch the way `rebuildSessionContext` does (a compaction entry's summary replaces what it covers) and keeps only `message`, `summary`, and `compaction` summaries. Every other kind is dropped: `package_state`, `custom`, `event`, `external_state`, `metadata`, `suspended_run`, `label`, and `model_change`.
      - **What a turn is.** A turn starts at a `user` message.
      - **Portability.** The output is portable to any provider and any tool set:
        - Each message keeps its role (`user` or `assistant`) and only text content.
        - A tool call becomes `[tool_call <name> <JSON args, first 200 chars>]` in its assistant message.
        - A tool result becomes `[tool_result <name>: <text, first maxToolChars chars (default 2,000)>]` in a user-role message.
        - Consecutive same-role messages are merged.
        - `thinking` blocks and provider metadata are dropped. Images become `[image omitted]`.
        - An assistant tool call with no result, such as the in-flight `delegate` call (Task 1 (h)), is dropped.
      - **Bounds.** Turns are taken newest first: up to `lastTurns`, or all of them, until `maxChars` is reached. A newest turn that alone exceeds `maxChars` is cut from its oldest end and `truncated` is set. Summaries count toward `maxChars` and are cut last.
    - Functional: **Delegate config.** `DelegateChildConfig.context?: "none" | "summary" | { lastTurns: number; maxChars?: number }` (default `"none"`).
      - `lastTurns` must be an integer from 1 to 50.
      - `maxChars` defaults to 24,000 and is capped at 120,000. A larger value is clamped, and setup notes `info` once.
      - Anything else fails config validation.
      - File-defined children (Task 6) use `"none"`. A configured child with the same name can set `context`.
    - Functional: **Seeding.** At delegation start, for a child whose `context` is not `"none"`, the delegate:
      1. reads `context.session.entries()` once;
      2. calls `selectTranscript`;
      3. seeds the child's memory store with the result, using fresh entry ids, the child session's id, and the ownership metadata Task 1 (h) names: one `summary` entry per summary, then one `message` entry per message;
      4. opens the child with `agent.session({ id })`. The child's first request carries the seeded history followed by the `input` brief.

      The delegate declares the `"session-state"` capability. When the parent branch carries an `ownership` stamp, the child's `createAgent` gets `ownership: <that scope>` (read from the seeded entries' `metadata`, since `agent.session({ id })` fails closed with `SessionNotFoundError` when the branch is outside the child's scope, Task 1 (h)); a parent without a stamp passes none. No entry is rewritten.
      `context.session.entries()` during the `delegate` call ends with the assistant message that carries the call and no result; `selectTranscript` drops that call (the rule above), so the child never receives an unmatched `tool_use`.
    - Functional: **`"summary"`.**
      - The delegate makes one `prism.models.client(<child model>).generate` call. Its system prompt is a fixed summarization instruction ("Summarize this conversation for a sub-agent: the goal, decisions, facts established, files touched, and open problems. Under 4,000 characters."). Its input is `selectTranscript(entries, { maxChars: 48_000 })`, rendered as one user message.
      - The answer is capped at 4,000 chars and seeded as one `summary` entry.
      - If the summary call fails, the delegation fails before the child runs: `status: "failed"`, `error: "context_unavailable: <reason>"`. It never runs blind in place of the configured context.
    - Functional: **The parent sees which children see the conversation.** Task 2's description sentence becomes `The child sees only your input unless its line says it sees this conversation.` A child line gets a suffix: ` (sees the last <N> turns of this conversation)` or ` (sees a summary of this conversation)`. Without a session (no `context.session`), a child with `context` fails with `context_unavailable` and never silently runs blind.
    - Functional: The `delegate` result value gains `context: { mode, turns, omittedTurns, truncated }` for children with `context`.
    - Functional: **`delegate` service.**
      - Setup calls `prism.services.provide("delegate", service)`. The `DelegateService` interface is exported from the package and has two methods:
        - `start({ child, input, mode, session, principal?, signal? })`, which returns the same `DelegationOutcome`, or `{ delegationId, status: "running" }`;
        - `wait(delegationId, session, signal?)`.
      - It wraps the same runtime the tools use, so concurrency, limits, `context`, approvals (Task 4), isolation (Task 5), result caps (Task 2), and entry removal (Task 3) are identical.
      - `start` without a `session` throws `DelegateError` `session_required`.
      - The service is provided even when every child is hidden.
    - Functional: **`hidden` children.**
      - With `DelegateChildConfig.hidden?: boolean` (default `false`), a hidden child is left out of the `delegate` description and its `child` enum. A `delegate` call naming it gets the existing "Unknown child" failure. Only the service can start it.
      - When every child is hidden, the `delegate`, `delegate_wait`, and `delegate_cancel` tools are not registered, and setup notes `info`. Today's "no children" warning still applies only when `children` is empty.
      - File-defined children (Task 6) are never hidden.
    - Performance:
      - `"none"` reads nothing.
      - `{ lastTurns }` costs one branch read per delegation. The child's history grows by at most `maxChars` (about `maxChars / 4` tokens), and that is re-sent on every child turn.
      - `"summary"` adds one model call per delegation, with up to 48,000 chars in and 4,000 out.
      - The README's Cost section states all three, and that `"none"` is the default.
    - Code Quality:
      - The selection and rendering rules live only in `selectTranscript`. Neither the delegate nor the advisor re-implements them.
      - Seeding reuses the `fork()` re-id pattern (`src/agent-session/session.ts:766-808`).
      - No new `PackageAPI` member.
    - Security:
      - The model cannot widen what a child sees. `context` comes from host config only, and the `delegate` tool has no argument for it.
      - Seeded entries come from the already-redacted branch (Task 1 (h)).
      - Non-message entries never reach the child. Without this, a `package_state` copy would hydrate the parent's package state into inherited packages, and a `suspended_run` copy would resume the parent's run.
      - The child cannot write to the parent's session, because it has its own store.
      - The README warns that a child on a different provider receives the parent's transcript.
      - The service runs only configured children: a caller cannot pass a package set, model, or limits, so a package holding the service gains no capability the host did not configure.
      - A hidden child cannot be reached by the model.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/src/{runtime,config,tools,index}.ts` (`buildAgent` `runtime.ts:86-121`, `run` `runtime.ts:123-190`); `src/session-context.ts:9-27`; `src/session-stores.ts:156-188, 257`; `src/agent-session/session.ts:766-808`; `src/contracts-core/agent.ts:260-275`; Task 1 (h).
    - Options Considered:
      - **Rely on the host's `tool.call` `rewrite` to paste context into `input`.** Rejected as the default. It works without SDK changes, but every host re-implements the slicing, the history arrives as one flat user message, and nothing tells the parent model which children see the conversation.
      - **`session.fork()` the parent and run the child on the fork.** Rejected for three reasons. The fork lives in the parent's store and agent, not the child's. It copies `package_state`. It keeps provider-bound blocks that a child on another provider cannot replay.
      - **Copy messages verbatim, tool calls and all.** Rejected. A child with `tools.only` or a different provider can reject historical tool calls for tools it does not have, and the in-flight `delegate` call has no result.
      - **Put the slicing in the delegate package.** Rejected. The advisor (Task 8) needs the same rules, and a package must not depend on another package's internals.
      - **Per-delegation `context` argument on the tool.** Rejected. It would let the model widen what a child sees beyond the host's choice.
      - **Hosts build their own validator agents with `createAgent` inside a hook.** Rejected. That re-implements the provider bridge, inheritance, limits, approvals, and isolation the delegate already owns.
      - **A service that accepts an ad-hoc child definition.** Rejected. A package holding the service could then grant itself packages the host did not configure.
    - Chosen Approach:
      - A kernel `selectTranscript` (two users) with pinned messages.
      - A host-configured `context` per child, seeded through the child's own store and session open.
      - The same runtime exposed as a `delegate` service, following the `prism-workflows` precedent, for hidden or visible configured children.
    - API Notes and Examples:
      ```ts
      delegate({
        children: {
          reviewer: { description: "Reviews the current change.", inherit: ["@arnilo/prism-tools-coding"], context: { lastTurns: 6 } },
          researcher: { description: "Researches a question.", inherit: ["@arnilo/prism-tools-web"], context: "summary" },
        },
      });
      // delegate → { status: "completed", text, context: { mode: "lastTurns", turns: 6, omittedTurns: 14, truncated: false } }

      // From code (a hook or another package): a hidden child the model never sees.
      // children: { verifier: { inherit: ["@arnilo/prism-tools-coding"], hidden: true, context: { lastTurns: 4 } } }
      const service = prism.services.consume<DelegateService>("delegate");
      const outcome = await service?.start({ child: "verifier", input: brief, mode: "sync", session: context.session, signal: context.signal });
      ```
    - Files to Create/Edit:
      - `src/session/transcript.ts` (new): `selectTranscript` and `TranscriptSlice`.
      - `src/index.ts`: root export.
      - `src/__tests__/transcript.test.ts` (new).
      - `src/__tests__/public-export-contract.test.ts`: root-export freeze, deliberately.
      - `packages/integrations/delegate/src/context.ts` (new): seeding and the summary call.
      - `packages/integrations/delegate/src/service.ts` (new): `DelegateService` over the runtime.
      - `packages/integrations/delegate/src/{config,runtime,tools,index}.ts`: config schema (`context`, `hidden`), capability, description suffix, result `context`, and `services.provide("delegate", …)`.
      - `packages/integrations/delegate/src/__tests__/context.test.ts` (new); `src/__tests__/service.test.ts` (new).
      - `packages/integrations/delegate/README.md`.
      - `docs/agent.md` ("Sessions": `selectTranscript`).
      - `examples/delegate.ts`: one child with `context: { lastTurns: 2 }`, offline on the mock provider.
      - `scripts/compat-baseline/arnilo__prism.txt` and `scripts/compat-baseline/arnilo__prism-delegate.txt`.
      - `CHANGELOG.md`.
    - References:
      - Task 1 (h); Task 2 (description text); Task 6 (file children default to `"none"`).
  - Test Cases to Write:
    - `select_transcript_keeps_last_n_turns`: 10 turns with `lastTurns: 3` gives 3 turns and `omittedTurns: 7`. Fails if the cut counts messages instead of turns.
    - `select_transcript_respects_max_chars_newest_first`: oldest turns drop first. A newest turn bigger than the cap is cut from its oldest end with `truncated: true`.
    - `select_transcript_drops_non_message_entries`: `package_state`, `custom`, `suspended_run`, and `event` never appear.
    - `select_transcript_uses_compaction_summary`: entries behind a compaction appear only as its summary.
    - `select_transcript_renders_tool_activity_as_text`: no `tool_call` blocks and no `tool` role in the output. A tool result longer than `maxToolChars` is cut.
    - `select_transcript_drops_dangling_tool_call_and_thinking`.
    - `select_transcript_pinned_survives_cut`: with `lastTurns: 1` on 20 turns, the pinned first-turn message is still present. It is charged first and not duplicated when it is inside the selected turns. Fails if pinning is applied after the cut.
    - `select_transcript_accepts_live_messages`: a `Message[]` input gives the same slice as the equivalent entries.
    - `delegate_service_runs_configured_child`: same outcome shape as the tool.
    - `delegate_service_shares_concurrency_and_limits`: tool and service calls together never exceed `maxConcurrent`.
    - `delegate_service_requires_session`.
    - `delegate_service_rejects_unknown_child`: no ad-hoc definition is possible.
    - `hidden_child_absent_from_tool_and_unreachable_by_model`.
    - `all_hidden_children_registers_no_tools_but_provides_service`.
    - `child_with_last_turns_sees_parent_history`: the mock provider records the child's first request. It contains the parent's earlier user text and then the brief. Fails if the child starts blind.
    - `child_without_context_starts_blind`: the default is unchanged.
    - `child_summary_context_makes_one_call_and_seeds_summary`: exactly one extra provider call, and the summary appears in the child's request.
    - `summary_failure_fails_delegation_before_child_runs`: `context_unavailable`, and the child model is never called.
    - `context_without_session_fails_closed`.
    - `seeded_child_never_hydrates_parent_package_state`: an inherited package with session state sees its `initial` value, not the parent's.
    - `delegate_description_marks_children_that_see_conversation`.
    - `context_max_chars_above_cap_clamped_with_note`; `context_invalid_shape_fails_config_validation`.
    - `secret_in_parent_history_never_reaches_child_unredacted`: a resolved secret in a parent tool result arrives in the child's request redacted.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers the updated `examples/delegate.ts`.
    - Run `bun scripts/release.mjs gate --update-baseline`. The note records the root `selectTranscript`/`TranscriptSlice` addition and the `DelegateChildConfig.context`/`hidden` and `DelegateService` diff, attributed to this task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new root export; new delegate config fields (`context`, `hidden`), a new result field, and a new capability; a new `delegate` service and `DelegateService` type.
    - Docs pages to create/edit:
      - `docs/agent.md` "Sessions": `selectTranscript` (what it keeps, rendering, bounds, `pinned`).
      - `packages/integrations/delegate/README.md`:
        - Configuration (`context`, `hidden`);
        - What it changes (the `delegate` service and its two methods);
        - Cost (three modes);
        - Safety (what is never copied; cross-provider exposure; the service runs only configured children);
        - Capabilities (`session-state`).
      - `CHANGELOG.md` (Added).
    - `docs/index.md` update: no. Both pages are already indexed and their scope sentences do not change.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **File placement.** `selectTranscript` lives in `src/agent-session/transcript.ts`, not the planned `src/session/transcript.ts`: the kernel has no `src/session/` directory, and the module's neighbours are `session.ts` and `session-stores.ts` (`rebuildSessionContext` is what it reuses). Root export and public-export freeze unchanged in shape (`selectTranscript`, `TranscriptOptions`, `TranscriptSlice`).
  - **How it slices.** It reuses `rebuildSessionContext` for the branch walk (compaction summary replaces what it covers, `summaries` collected), so the selection rules are one implementation. A `Message[]` input is detected by the absence of `kind` and skips the walk. Turn segmentation happens after rendering, because a dropped dangling call must not leave an empty turn.
  - **Deviations from the written criteria.**
    1. **No `value.context`.** Task 2 made every delegate result text-only (`value` drops the text parts), so the context is reported in the status line: `, saw the last 6 turns, 14 earlier omitted` or `, saw a summary of this conversation`. The outcome still carries `context: { mode, turns, omittedTurns, truncated }` for the service caller.
    2. **Ownership stamping.** Seeded entries are created by the delegate (fresh ids, chained `parentId`, the child session id) and get `metadata` = `config.ownership` when it is set; without a stamp `agent.session({ id })` would reject the branch with `SessionNotFoundError` for a scoped agent. The delegate therefore takes no ownership from the parent branch: it stamps what the host configured, which is the same scope the child appends under.
    3. **`allowHidden` on `DelegateStartInput`** (not on the service API): the runtime refuses a hidden child unless the internal flag is set, so the model-facing tool cannot reach it while `service.start` can. The service's public input has no such field.
    4. **Summary call.** `prism.models.client(<child model>).generate({ messages: [one user message] })`, reading `content_delta` text events (the same shape `context/engineering`'s `createModelSummarize` uses), capped at 4,000 chars; a provider `error` event throws. Any failure, and a child with `context` but no session, becomes `status: "failed"`, `error: "context_unavailable: …"`, before the child agent is built.
  - **Setup.** The package declares `session-state`. The service is always provided (also when every child is hidden), `onDispose` aborts it, and the tools are skipped with one `info` note when `runtime.childNames` is empty. The description's first sentence is now `The child sees only your input unless its line says it sees this conversation.`, and each line ends with the context suffix.
  - **Tests.** Kernel `src/__tests__/transcript.test.ts` (11): last-N turns, max-chars newest-first, a newest turn cut, non-message entries dropped (`package_state`/`custom`/`event`/`suspended_run`), compaction summary, tool activity rendered as text with `maxToolChars`, dangling call + thinking dropped, pinned survives the cut and is not repeated, oversized pinned cut, live messages equal entries. Delegate `src/__tests__/context.test.ts` (9) and `src/__tests__/service.test.ts` (8): history seeded, blind default, one summary call, summary failure before the child runs, no package-state hydration, redacted secret, description suffixes, clamp + note, invalid shapes, service start/async-wait/unknown-child/session-required/concurrency/shared capabilities, hidden child unreachable by model but startable, all-hidden registers no tools but provides the service. 67 delegate tests, 259 packaging/install-smoke and the docs suite pass.
  - **Docs.** `docs/agent.md` gains "Handing a conversation to another agent" under Sessions. Delegate README gains `context`/`hidden` rows, "Context" and "The `delegate` service" sections, the cost table and two Safety bullets (host-only config; `session-state`). Root CHANGELOG entry for `selectTranscript`; delegate CHANGELOG `Added`. `examples/delegate.ts` gives the reviewer `context: { lastTurns: 2 }` and reports `sawParent`.
  - **Release gate.** `--update-baseline` then a clean pass. Kernel baselines raised (`packedBytes` 1133248, `unpackedBytes` 3695232, `fileCount` 358, `sourceLines` 38612) with the `budgets.json` reason; the delegate baseline gains `DELEGATE_SERVICE`, `DelegateService`, `createDelegateService`, `resolveChildContext`, `buildSeededContext`, the context constants and `SUMMARY_INSTRUCTION`.
  - **Known limits.** The summary mode is one call with no retry (fail closed is the contract); a `lastTurns` child re-sends its seeded history on every turn by design; `context` is not available to a file-defined child (Task 6 config only sets what a file can express) unless a configured child of the same name overrides it, which is the documented precedence.

- [x] Task 8: `@arnilo/prism-advisor` — a second opinion, and completion validation
  - Acceptance Criteria:
    - Functional: **Package and config.** A new package lives at `packages/integrations/advisor` (`@arnilo/prism-advisor`, `requires: { api: 1 }`). Config:
      - `model`: `ModelRef`, required. Setup fails naming the field if it is missing.
      - `instructions?`: string. A default advisor prompt applies when it is absent.
      - `context?: { lastTurns?: number; maxChars?: number }`: defaults 6 and 24,000, hard cap 120,000.
      - `adviceMaxChars?`: default 4,000, hard cap 16,000.
      - `tool?`: boolean, default `true`.
      - `triggers?: { beforeTools?: string[]; beforeFinish?: boolean }`: both off by default.
      - `maxConsultsPerRun?`: default 3, hard cap 20.
      - `validate?: { criteria?: string; engine?: "model" | { child: string }; onError?: "continue" | "end"; maxRounds?: number; context?: { lastTurns?: number; maxChars?: number } }`: off by default.
        - `engine` defaults to `"model"`.
        - `onError` defaults to `"continue"`.
        - `maxRounds` defaults to 2, hard cap 10.
        - `context` defaults to that of the advisor.
        - `triggers.beforeFinish` and `validate` together fail config validation, naming both fields. Both are `run.end` reviews, and "the first continue wins" would make one of them silently inert.

      Out-of-range values are clamped with one `info` note. Unknown keys fail config validation. A model the agent cannot resolve gives `status.note("warn", …)` and no registrations, not a throw.
    - Functional: **One consult** works like this:
      1. Take `selectTranscript(<branch>, context)` (Task 7). The branch is `session.entries()` for the tool and `tool.call` triggers, and `RunEndPayload.history` for `run.end`, which needs no store read.
      2. Render it as text in one user message, followed by the question.
      3. Make exactly one `prism.models.client(model).generate` call, with the advisor system prompt and no tools.
      4. Cap the answer at `adviceMaxChars`.

      The advisor never runs an agent loop, never calls tools, and never writes to the session.
    - Functional: **`advise` tool** (when `tool: true`):
      - Arguments: `{ question: string }`. The description reads: `Ask a second model for advice on your current approach. It sees the recent conversation; state the specific question.`
      - The result text is the advice plus `[advisor: <model>, <tokens> tokens]`.
      - Past `maxConsultsPerRun`, it returns an error result naming the cap.
    - Functional: **`beforeTools` trigger** (a `tool.call` decide hook, for the named tools only):
      - The consult asks for JSON `{ "verdict": "proceed" | "revise", "advice": string }` about the pending call (name and args).
      - `proceed` returns `"allow"`.
      - `revise` returns `{ deny: "Advisor: <advice>" }`, so the model sees the advice as the tool result (Task 1 (i)).
      - A retry of the same tool with the same arguments hash in the same run is allowed without a second consult. A `revise` therefore cannot loop.
      - An unparseable verdict, a model error, a timeout, or the cap being reached all return `"allow"` and emit the event with `status: "skipped"`.
    - Functional: **`beforeFinish` trigger** (a `run.end` decide hook):
      - At the loop's natural end, one consult reviews the final answer against the transcript.
      - `revise` returns `{ continue: { reason: "Advisor review", steer: "<advice>" } }`. It is bounded by `limits.maxContinuations` and `maxConsultsPerRun`.
      - `proceed`, an error, or the cap ends the run normally.
    - Functional: Every consult emits a `package.event` `advisor.consult` with `{ trigger: "tool" | "beforeTools" | "beforeFinish", status: "ok" | "skipped" | "capped", verdict?, totalTokens? }`. It never contains the transcript or the advice text.
    - Functional: **Run task capture.** When `validate` is set, a `run.input` transform hook records the run's input messages per `runId` in agent state (`prism.state.agent`) and returns the input unchanged (Task 1 (j)). The entry is dropped when the run ends. A run whose input was not captured, such as one resumed after a restart, uses the first user message of `RunEndPayload.history`, and the event says `task: "inferred"`.
    - Functional: **`validate` round** (a `run.end` decide hook):
      1. Build the slice with `selectTranscript(payload.history, { ...validate.context, pinned: <captured task> })`.
      2. Ask for JSON `{ "verdict": "complete" | "incomplete", "missing": string[], "evidence": string }`, judged against the task and `criteria`.
      3. With `engine: "model"`, make one `prism.models.client(model).generate` call with no tools.
      4. With `engine: { child }`, call the `delegate` service (Task 7), using `prism.services.consume` at call time, with `mode: "sync"`, the hook's session and signal, and a fixed brief. The brief holds the task, `criteria`, the final answer, the instruction to check the evidence with the child's tools before answering, and the JSON shape. The host configures that child, typically `hidden: true` with read-only tools and its own `context`.
      5. Map the verdict:
         - `complete`: end the run; emit `verified`.
         - `incomplete` with rounds left: `{ continue: { reason: "Validator: task incomplete", steer: "Missing: <missing, one per line>. Finish these, then state the evidence." } }`; emit `incomplete`.
         - `incomplete` with no rounds left: end the run; emit `unverified`.
    - Functional: **Validation fails closed.** A model or child error, a timeout, an unparseable verdict, a missing service or unknown child (`validator_engine_unavailable`), or `maxConsultsPerRun` being reached never gives `verified`.
      - With `onError: "continue"` and rounds left, the hook continues with the steer `Validation could not run (<reason code>). Check your work explicitly and state the evidence.` and emits `error`.
      - Otherwise the run ends and the event is `error`.
      - Validation rounds are counted per run, separately from `maxConsultsPerRun`, and both are bounded by `limits.maxContinuations`. The README states that the effective cap is the smaller of `maxRounds` and the continuations left.
    - Functional: **`validator.verdict` event.** Every round emits `{ round, verdict: "verified" | "incomplete" | "unverified" | "error", engine: "model" | "child", task: "captured" | "inferred", missing?: string[], reasonCode?, totalTokens? }`.
      - `missing` holds at most 5 items of at most 200 chars each, and is redacted by `events.emit`.
      - The event never carries the transcript, the evidence text, or the final answer.
      - A host treats a run as done only when the run's last `validator.verdict` is `verified`. The README shows the subscription.
    - Performance:
      - Each consult is one model call: at most about `context.maxChars / 4` tokens in, plus `adviceMaxChars / 4` tokens out. The `run.end` trigger needs no store read.
      - By default, only the `advise` tool is on, and it costs nothing until the model calls it.
      - The README states the worst case per run (`maxConsultsPerRun` calls) and that `beforeTools` adds a full model call's latency before every listed tool.
      - `validate` costs nothing unless set. With `engine: "model"`, each round is one model call. With `engine: { child }`, each round is one delegation, bounded by that child's limits (Task 3's defaults: up to 500,000 tokens). The README states both and recommends tight `limits` on a validator child.
      - Task capture keeps one message list per active run in memory.
    - Code Quality:
      - The transcript slice comes from `selectTranscript` only.
      - No kernel change beyond Task 7's export.
      - The advisor does not import `@arnilo/prism-delegate` at runtime. It reaches the delegate only through the `delegate` service, via a local structural type checked by the test that loads the delegate package as a devDependency.
      - The package follows the new-package layout in `references/prism.md` §4.
    - Security:
      - **Not a security gate.** The advisor is advisory: every failure is "allow" or "end normally", and the README says safety belongs to `@arnilo/prism-approval` and policy packages, not to the advisor. Hooks never throw from an advisor failure, so an advisor outage cannot block a run.
      - **What it sees.** The advisor sees only the redacted branch slice.
      - **What it can do.** It has no tools and cannot act.
      - **Bounded by config.** The model cannot raise `maxConsultsPerRun` or `context`.
      - **Re-entry.** If Task 1 (i) finds that `models.client` runs model hooks, the advisor's own call is marked so its triggers never fire on it.
      - **Validation is not advice.** It fails closed: no `verified` without a parsed `complete` verdict, and errors are reported, never passed.
      - **What the validator child can do.** It gets only its configured packages through the service (Task 7). The advisor cannot add tools or packages to it.
      - **Child verdicts are untrusted output.** A malformed or oversized verdict is an `error`, never `verified`.
      - **Prism cannot fail a run from `run.end`.** The README says plainly that the host must gate on `validator.verdict`, and that a run reporting `completed` alone does not mean verified.
  - Approach:
    - Documentation Reviewed:
      - `src/hooks/types.ts:104-109, 135-154, 174-185`; `src/packages/api.ts:110-170`; `packages/integrations/delegate/src/{index,tools}.ts` (package and tool shape to mirror); `packages/integrations/hooks-json/src/compile.ts:407-422` (`Stop` on `run.end`); `packages/tools/coding/src/agent/goal-verify.ts` (fixed checks plus approval); Task 1 (i), (j); Task 7.
    - Options Considered:
      - **Leave it to hosts (a tool plus hooks in each host).** Rejected by owner decision 2026-10-23. Every host would rebuild the same slice, prompt, verdict parsing, retry guard, and cap.
      - **An advisor as a delegate child.** Rejected as the mechanism. A child is a full agent loop with tools and limits. An advisor is one call, and with Task 7 a reviewer child is already possible for hosts that want an advisor with tools. The README's "Advisor or delegate child?" section explains when to use which.
      - **Put it in the kernel.** Rejected. The tool, hooks, and `models.client` already express it, and it is a capability an agent may or may not have (`references/prism.md` §1).
      - **Make an advisor failure fail closed (deny).** Rejected. That would turn a second opinion into a gate whose outage blocks every listed tool, and approval and policy packages already own gating.
      - **A `stall` trigger (after N failed tool calls).** Not in this task. The two triggers above cover the requested review points.
      - **A separate `@arnilo/prism-validator` package.** Rejected by owner decision 2026-10-23. It would duplicate the slicing, verdict parsing, caps, and model resolution, and a second package would need its own enforcement rows.
      - **Reuse `beforeFinish` as the validator.** Rejected. It fails open, cannot check evidence, slices only the newest turns (so the task can be lost), and shares the advice cap.
      - **A kernel `RunResult` verdict field set from `run.end`.** Rejected. A package event already carries it, and no second user needs a kernel field (`references/prism.md` §1).
      - **Fixed checks inside the validator (run tests).** Rejected. JSON hooks' `Stop` command and the coding package's goal-verify (`packages/tools/coding/src/agent/goal-verify.ts`) already run fixed checks. A validator child with read-only coding tools covers checks that need judgment. The README shows how to combine them.
    - Chosen Approach:
      - A small integration package: one tool, two opt-in hooks, one model call per consult, capped per run.
      - A `validate` role on `run.end` with a captured task, a model or hidden-child engine through the `delegate` service, fail-closed verdicts, and a `validator.verdict` event the host gates on.
    - API Notes and Examples:
      ```ts
      import advisor from "@arnilo/prism-advisor";
      advisor({
        model: "hyper/<strong-model>",
        context: { lastTurns: 8 },
        triggers: { beforeTools: ["shell", "write"], beforeFinish: true },
        maxConsultsPerRun: 4,
      });
      // model: advise({ question: "Is patching the parser or the caller the right fix?" }) → "Patch the caller: … [advisor: hyper/<strong-model>, 3,912 tokens]"

      // Validation by a hidden child that checks the evidence:
      delegate({ children: { verifier: { inherit: ["@arnilo/prism-tools-coding"], tools: { only: ["read", "grep", "glob", "shell"] }, hidden: true, limits: { maxTotalTokens: 100_000 } } } });
      advisor({ model: "hyper/<strong-model>", tool: false, validate: { engine: { child: "verifier" }, criteria: "Tests pass and the changelog is updated.", maxRounds: 2 } });
      // host: agent.events → package.event "advisor/validator.verdict" { round: 1, verdict: "incomplete", missing: ["CHANGELOG.md not updated"] } … { round: 2, verdict: "verified" }
      ```
    - Files to Create/Edit:
      - `packages/integrations/advisor/{package.json,tsconfig.json,README.md,CHANGELOG.md,LICENSE}` (new; `package.json` mirrors `packages/integrations/delegate/package.json`).
      - `packages/integrations/advisor/src/{index,config,consult,tool,triggers,verdict,validate,task-capture}.ts` (new). `validate.ts` declares a local structural type for the two `DelegateService` methods it calls, so the package has no runtime import of `@arnilo/prism-delegate`.
      - `packages/integrations/advisor/src/__tests__/{package,consult,triggers,validate}.test.ts` (new). `validate.test.ts` loads the real delegate package as a devDependency, which also proves the structural type matches `DelegateService`.
      - Enforcement rows from Task 1 (i): `scripts/package-truth.mjs` (and the generated `scripts/package-truth.json`), `scripts/independent-packages.json` (`$comment`: lockstep until Phase 11), `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`, the coverage and release-evidence rows Task 1 (i) confirms, `scripts/compat-baseline/arnilo__prism-advisor.txt` (new), `docs/index.md` (README link and package table row), and `docs/release.md` if it lists packages.
      - `examples/advisor.ts` (new, offline on the mock provider: one `advise` call and one `beforeFinish` revise→continue), `examples/validator.ts` (new, offline: a hidden `verifier` child returns `incomplete` then `complete`, and the host prints the `validator.verdict` events), `examples/README.md`, `examples/tsconfig.json`, and `scripts/e2e-coverage.json`.
      - `bun.lock` (the workspace is added by the existing `packages/integrations/*` glob).
      - `CHANGELOG.md`.
    - References:
      - Task 7 (`selectTranscript`); Task 1 (i); the 2026-10-23 advisor discussion (host-built vs SDK).
  - Test Cases to Write:
    - `advisor_package_conformance`: the package conformance suite from `@arnilo/prism/testing`.
    - `advise_tool_makes_one_call_with_transcript_slice`: the mock provider sees exactly one request, with no tools, containing recent parent text and the question.
    - `advise_result_capped_and_status_line`.
    - `consult_cap_per_run_enforced`: the fourth call with `maxConsultsPerRun: 3` returns an error result and makes no provider call.
    - `before_tools_revise_denies_with_advice`: the model receives `Advisor: …` as the tool result.
    - `before_tools_proceed_allows`; `before_tools_ignores_unlisted_tools`.
    - `before_tools_retry_same_args_skips_consult`: fails if a revise can loop.
    - `before_finish_revise_continues_with_steer`; `before_finish_respects_max_continuations`.
    - `advisor_failure_never_blocks`: a provider error or unparseable verdict gives allow or a normal end, with `status: "skipped"`.
    - `missing_model_fails_setup_naming_field`; `unresolvable_model_notes_warn_and_registers_nothing`.
    - `advisor_event_carries_no_transcript_or_advice`.
    - `advisor_never_reenters_its_own_triggers` (per Task 1 (i)).
    - `validate_model_complete_ends_run_verified`; `validate_incomplete_continues_with_missing_steer`.
    - `validate_exhausted_rounds_emits_unverified`: the run ends after `maxRounds` incomplete verdicts and the last event is `unverified`. Fails if the run reports `verified` or loops.
    - `validate_judges_against_captured_task`: on a 30-turn run with `lastTurns: 2`, the validator's request still contains the run's original input. Fails if the task is cut.
    - `validate_task_inferred_after_resume`: no captured input gives the first user message of `history` and `task: "inferred"`.
    - `validate_child_engine_checks_evidence`: a hidden child reads a file with its own tool before answering. Its tool call is visible in the child's events; the parent's tools are not used.
    - `validate_child_missing_service_or_unknown_child_is_error`: `validator_engine_unavailable`, never `verified`.
    - `validate_fails_closed_on_error_and_garbage_verdict`: both `onError` modes are covered, and neither gives `verified`.
    - `validate_rounds_independent_of_consult_cap`.
    - `validate_respects_max_continuations`.
    - `before_finish_and_validate_together_fail_config`.
    - `validator_event_carries_no_transcript_or_answer`: `missing` is capped at 5 × 200 chars.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/advisor.ts` and `examples/validator.ts`.
    - Run `bun scripts/release.mjs gate --update-baseline`. The note records the new `arnilo__prism-advisor.txt` baseline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new package.
    - Docs pages to create/edit:
      - `packages/integrations/advisor/README.md`, using the package page structure. It covers:
        - Install and Configuration;
        - What it changes: the tool, the `tool.call`, `run.end`, and `run.input` hooks, and the `advisor.consult` and `validator.verdict` events;
        - Capabilities;
        - "Cost, security, and failure behavior": per-consult cost and the worst case per run; advice is not a security gate; validation fails closed; the host gates on `validator.verdict`;
        - "Completion validation": the model or child engine, rounds, task capture, combining with JSON hooks' `Stop` and coding goal-verify;
        - "Advisor or delegate child?";
        - Example.
      - `CHANGELOG.md` (Added).
    - `docs/index.md` update: yes. One package link (`@arnilo/prism-advisor`: a second model's advice, and completion validation by a model or a delegate child) and the package table row.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Package.** `packages/integrations/advisor` (`@arnilo/prism-advisor` 0.13.0, `requires: { api: 1 }`, capabilities `models` and `session-state`). Files: `config.ts` (types, schema, clamps), `consult.ts` (one provider call, slice, text rendering, per-run ledger, retry key), `tool.ts` (`advise`), `triggers.ts` (`beforeTools`, `beforeFinish`), `task-capture.ts`, `validate.ts`, `verdict.ts` (JSON parsing and caps), `index.ts`. 33 tests across `package`, `consult`, `triggers`, `validate`.
  - **Deviations from the written criteria.**
    1. **Task capture is on `run.input`, after the plan's own follow-up.** The first implementation used `turn.before`, because `run.input`'s payload is a bare `Message[]` and transform hook contexts carried `sessionId: ""`/`runId: ""`; it read the branch at turn 1 instead. The follow-up in Further Actions item 1 then gave transform dispatch an identity (`HookBus.transform(name, value, { sessionId, runId })`, passed for `run.input`, `message.append`, `context.build`, `model.request`, `model.response`), so capture is back on `run.input`: it sees the exact input the run was given (a steer cannot replace it, and `run.started` remains the reset point for per-run state), spends no branch read, and no longer needs `context.session` for capture. Empty input (a resume, a bare `run("")`) is still not captured, which keeps the `task: "inferred"` path reachable and tested.
    2. **`model` is not `required` in the JSON schema.** `packageConformance`'s `config_schema_valid` validates the schema's *defaults*, and a required property with no default fails it (as it would for any package whose one required field is a free-form ref). Setup throws `AdvisorConfigError("model is required: …")` instead, so a missing model still fails setup naming the field, and conformance passes.
    3. **Validation rounds do not spend `maxConsultsPerRun`.** They have their own round counter (`round = payload.continuations + 1`), so a chatty `advise` cannot starve a fail-closed gate, and the README states the effective cap is the smaller of `maxRounds` and the continuations left. The plan's "or `maxConsultsPerRun` being reached never gives `verified`" is therefore vacuous for validation; a validator failure still never verifies.
    4. **`validate` and `triggers.beforeFinish` together** are rejected in setup (`AdvisorConfigError` naming both), because `run.end` is first-continue and one review would be silently inert.
    5. **A transform hook with no run identity captures nothing** (`context.runId === ""` is skipped), so a session-level dispatch never records a task.
    6. **The consult ledger's maps are bounded (16 runs per map)** rather than deleted at run end: there is no run-start hook to reset them, and a run's counts must survive its own `run.end` continuations. The validator's captured task is forgotten on every terminal verdict.
  - **Behavior.** A consult is charged only when the model is actually called, so a failing advisor does not exhaust a run's budget. Every advisor failure is `allow`/end-normally with `status: "skipped"`; the cap is `status: "capped"`. `advise` over the cap is an error result naming `maxConsultsPerRun`. `beforeTools` marks only revised `(tool, args)` pairs, so the identical retry is allowed with no second call. `validate` pins the captured task into the slice; `missing` reaches the model as the steer and the event capped at 5 × 200 chars; `engine: { child }` reaches the `delegate` service through a local structural type (no runtime import), and a missing service, unknown child, non-`completed` child, or unparseable child verdict is `error`, never `verified`.
  - **Docs.** Package README (Install, Configuration, What it changes, Capabilities, `advise`, Review triggers, Completion validation, Advisor or delegate child?, Cost/security/failure, Example), package CHANGELOG, root CHANGELOG entry, `docs/index.md` link and package table, `docs/release.md` rows (regenerated), `examples/advisor.ts` and `examples/validator.ts` with `examples/README.md`, `examples/tsconfig.json`, `scripts/e2e-coverage.json` and the demos list in `docs.test.ts`.
  - **Enforcement rows.** `scripts/package-truth.mjs` and the regenerated `package-truth.json` / `docs/_evidence/phase54-package-map.md`, `scripts/independent-packages.json` (lockstep comment only; the list stays empty), `scripts/coverage-thresholds.json` (lines 94.19, functions 96.22 — measured 97.19 / 99.22, threshold = recompute − 3pp), `scripts/release-evidence.json`, `src/__tests__/packaging.test.ts` (45 packages), `src/__tests__/install-smoke.test.ts`, and the new `scripts/compat-baseline/arnilo__prism-advisor.txt`.
  - **Pre-existing red meta-tests fixed while touching them** (they were already failing on this tree and would have hidden the new package's rows): `scripts/phase24-truth.test.mjs` counts were stale since the Liquid provider (now 45/44/5/1/38/44), `scripts/phase54-package-map.test.mjs` did not classify `@arnilo/prism-provider-liquid`, and `scripts/e2e-coverage.json` still annotated the deleted coding `review.test.ts` (live surfaces 78, pending 4).
  - **Verification.** advisor `typecheck` clean; 33 package tests; `src/__tests__/packaging.test.ts` + `install-smoke.test.ts` 264; `docs.test.ts` + `examples-boundary.test.ts` 66 (both new examples run); the phase23/24/54 and e2e-coverage meta-tests green; `release.mjs gate --update-baseline` then a clean `gate` over 45 packages. Kernel budget raised only for the root CHANGELOG entry (1134019 packed / 3697392 unpacked), with the reason recorded in `scripts/budgets.json`.
  - **Known limits.** `beforeTools` consults are sequential and add a model call's latency to every listed tool; the retry guard ignores rewrites, so a rewritten-then-revised call can consult again (a new args hash); a validator child's own `context` and `limits` are the host's responsibility; `validate` cannot make the kernel mark a run verified — the host must read the last `validator.verdict` (documented plainly in the README).

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun --cwd packages/integrations/delegate run build && bun --cwd packages/integrations/delegate test --timeout=0`
- `bun test --timeout=0 src/__tests__/skills.test.ts src/__tests__/transcript.test.ts src/__tests__/public-export-contract.test.ts`
- `bun --cwd packages/integrations/advisor run typecheck && bun --cwd packages/integrations/advisor test --timeout=0`
- `bun test --timeout=0 src/__tests__/packaging.test.ts`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`

## Compromises Made

- **The delegation result is text.** `value` and its text parts cannot coexist (the kernel drops text when `value` is present), so paging, the status line, merge notes and context notes all ride the result text. A machine consumer uses the `delegate` service instead, which returns the structured outcome.
- **A delegate child has no ownership of its own.** `DelegateConfig.ownership` exists because a child cannot infer the parent's scope and an inherited coding write is a durable effect; the host must set it, mirroring `RunWorkflowOptions.ownership`.
- **Context seeding costs a branch read per delegation.** `context: { lastTurns }` reads `session.entries()` every time and re-sends the slice on every child turn; `"summary"` adds a model call. Both are documented in the README's cost table rather than cached, because caching would need invalidation the kernel does not offer.
- **The advisor's task capture is a `turn.before` hook, not `run.input`.** `run.input` has no run id in its hook context, so the capture reads the branch at turn 1 instead.
- **The advisor cannot make the kernel mark a run verified.** `run.end` cannot change the run result, so a host gates on the last `validator.verdict`; the README states this plainly instead of implying `completed` means verified.
- **Validation rounds are not counted against `maxConsultsPerRun`.** A gate must not be starved by advisory consults, so rounds have their own counter bounded by `maxRounds` and `limits.maxContinuations`.

## Further Actions

1. **[x] A run id in transform-hook contexts (high) — done 2026-10-24.** `HookBus.transform(name, value, identity?)` supplies `context.sessionId`/`context.runId` when the payload is a bare value, and the kernel passes the run's identity for `run.input` (start input and mid-run steers), `message.append`, `context.build`, `model.request`, and `model.response` (payload-supplied ids still win). `@arnilo/prism-advisor` captures the task on `run.input` again — the exact input the run was given, no branch read. Reset needs no new hook: `run.started` is already an observe hook carrying the run id. Documented in `docs/hooks.md`; covered by `transform_dispatch_carries_run_identity` and `steer_run_input_carries_the_run_identity`.
2. **A `delegate` outcome that a host can gate on without parsing text (medium).** A structured `value` cannot coexist with text today; a host that wants both keeps the service.
3. **Retry-guard precision for `beforeTools` (low).** The guard keys on the resolved arguments, so a policy rewrite between the revise and the retry earns a second consult. Including the rewritten-args hash would close it, at the cost of consulting on every rewrite.
4. **A real timeout for advisor and validator calls (low).** Today a hanging provider is bounded only by the run's signal; a per-consult `AbortSignal.timeout` would make `reasonCode: "timeout"` real instead of theoretical.
5. **Surface `missing` on the continuation itself (low).** The steer text carries the list; a structured continuation field would let a host render it without parsing the message.
