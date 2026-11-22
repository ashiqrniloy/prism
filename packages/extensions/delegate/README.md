# @arnilo/prism-extensions/delegate

Sub-agents as a tool for `@arnilo/prism`. A `delegate` tool runs a named child as a session of the parent's own agent, linked to the parent session and limited to the tools of the packages it inherits, and returns the child's answer as the tool result.

## Install

```bash
prism add @arnilo/prism-extensions/delegate
```

```ts
import { createAgent } from "@arnilo/prism";
import delegate from "@arnilo/prism-extensions/delegate";

const agent = await createAgent({
  model: "mock/main",
  packages: [
    mockProvider(),
    toolsCoding({ root: process.cwd(), readOnly: true }),
    delegate({
      children: { reviewer: { inherit: ["@arnilo/prism-tools/coding"], instructions: "Review the diff." } },
    }),
  ],
});
```

Or in the manifest:

```jsonc
{ "name": "@arnilo/prism-extensions/delegate", "version": "^0.13.0", "integrity": "sha512-…", "capabilities": ["models", "background", "session-state", "sessions"],
  "config": { "children": { "reviewer": { "inherit": ["@arnilo/prism-tools/coding"], "instructions": "Review the diff.", "report": "milestones" } } } }
```

## What it changes

- A child is a session of the agent that loaded this package, opened with `PackageAPI.sessions.open` and linked to the calling session (`SessionLinks`; `depth` is the caller's plus one). No second agent is built, so no package's `setup` runs per delegation, and the child holds no provider bridge or credential: it runs on the agent's own providers.
- The child's transcript is in the agent's store and stays after the delegation: `agent.sessions.list({ parentSessionId })` lists it, and `agent.session({ id })` opens it.
- `inherit` chooses the child's **tools**, not its packages: the child may call the tools the inherited packages registered (`PackageAPI.tools.list()` names each tool's package), narrowed by `tools.only`. `inherit: []` gives no tools.
- **Every loaded package's hooks apply to a child**, inherited or not: approval, governance, hooks-json, context-files, compaction and observability gate and see child sessions like any other. A package that should skip children checks `session.depth` (`(context.session?.depth ?? 0) > 0` in a hook); `@arnilo/prism-extensions/advisor` does. `@arnilo/prism-memory-system` does not skip them yet (tracked in `plans/backlog.md`), so a child session gets its own memory tiers.
- The child's turns are charged to the parent's run (`RunOptions.chargeTo`): the parent's token and cost limits bound the tree, and the child's usage also appears in the parent run's usage.
- The child runs under the parent session's ownership scope and the calling run's principal and interactivity.
- With `maxDepth` above 1, a child may delegate again (see [Depth and queueing](#depth-and-queueing)); every level is charged to all its ancestors' runs.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `delegate` | `child`, `input`, `mode?: "sync" \| "async"` | `sync` returns the child's answer, then a status line such as `[child reviewer: completed, 12 turns, 41,203 tokens]`; that answer ends with the tool call. A `sync` child that suspends suspends the parent run (see [Approvals inside a child](#approvals-inside-a-child)). `async` returns `[child reviewer: running, delegationId dlg_…]` and runs as the parent session's background work, ending with it. |
| `delegate_wait` | `delegationId`, `offset?` | The same text result. `offset` reads the next slice of a long answer; the truncation hint names the next offset. A suspended child reports `suspended`, its pending count and its session id (`[child reviewer: suspended, 1 turn, 1 pending, session session_…]`). The entry is dropped once its answer was fully served, or when the parent session closes. |
| `delegate_cancel` | `delegationId` | `cancelling`, or `terminal` when it already ended. |

All three declare `effects: ["external"]`, so `tool.call` gates (approval, governance) see them. An unknown child, an unknown or foreign `delegationId`, a call from a session at `maxDepth`, or a call that waited `queueTimeoutMs` for a slot without one freeing is a tool error. A delegation id is only usable from the session that started it.

## Skill

The package ships one skill, `delegating-work` (a child sees only the brief, never put a secret in it, do a one- or two-call job yourself, check the answer before repeating it). It is loaded from `skills/delegating-work`, progressive by default, and declares `requiresTools: delegate delegate_wait delegate_cancel` (the three are always registered together), so a config with no visible child, or a request that narrows the tools away, does not list it. Cost: one catalog line (about 190 bytes). Turn it off with `disable.skills: ["delegating-work"]`. Its effect is measured on one hazard (`delegate-trivial-no-child`: 9/9 with the skill, 1/9 without) and not in the pooled score; see [the evidence](../../../docs/_evidence/skill-evals/211/v3/delegating-work.preload.md).

It tells the model that a child holds only what the brief and any forwarded context carry, and never to put a secret or credential in a brief. A child at `maxDepth` never gets `delegate`, so `skills: "inherit"` leaves this skill out of it (it keeps only skills whose `requiresTools` the child's tools hold); a child below `maxDepth` gets the three tools, and the skill with them.

## Configuration

| Field | Description |
| --- | --- |
| `children.<name>.inherit` | Package names loaded in the agent whose registered tools the child may call. `[]` gives no tools. A name that is not loaded fails the delegation. Listing `@arnilo/prism-extensions/delegate` fails `createAgent`. Hooks of every loaded package apply to the child either way. |
| `children.<name>.description` | One line the parent model reads to choose this child; it appears in the `delegate` tool description. Defaults to the first sentence of `instructions`; without either, `(no description)` and a setup note. |
| `children.<name>.instructions` | The child's instructions, after the report contract ("Finish with a concise report for the parent…"), which is always prepended. They replace the agent's own instructions and system-prompt layers for the child's run (`systemPrompt: { source: "run", mode: "replace" }`); package context (`AGENTS.md`, memory) still applies. |
| `children.<name>.model` | The child's model (`RunOptions.model`). Defaults to the parent session's model. It resolves through the agent's providers, so the child holds no credential. A child resumed after a suspension continues on the agent's model: a durable resume refuses a per-run model. |
| `children.<name>.tools.only` | Narrows the inherited tools to these names. A name no inherited package registers is dropped with one note. |
| `children.<name>.limits` | Any `RunLimits` axis (`maxTurns`, `maxToolCalls`, `maxTotalTokens`, `maxWallTimeMs`, `maxToolRounds`, `maxCost`, `maxContinuations`, …; not `backgroundSettleMs`), `null` where the kernel accepts it. A value above a delegate ceiling (`ceilings`) fails `createAgent` with `DelegateCeilingError`; nothing is clamped. Unset ceilinged axes default to 50 turns, 200 tool calls, 500,000 tokens and 15 minutes. |
| `children.<name>.resultMaxChars` | Cap on the answer text the parent sees. Default 12,000, at most `ceilings.resultMaxChars`. A longer answer ends with a `delegate_wait` offset hint; the delegation keeps up to `ceilings.retainedResultChars` to page. |
| `children.<name>.report` | `on-complete` (default), `milestones` (each child turn), or `stream` (each turn and tool, plus bounded [`delegate.activity`](#delegateactivity-events) events). |
| `children.<name>.skills` | `"inherit"` (default) gives the child every agent skill whose `requiresTools` its tools hold, `"none"` gives none, and a name list gives exactly those (`RunOptions.skills`). An unknown name fails the delegation. |
| `children.<name>.isolation` | `"worktree"` runs the child in its own git worktree of the agent's `workspace` service and merges its branch into the parent's current branch when it completes. `"none"` (default) leaves the child in the agent's tree. See [Worktree isolation](#worktree-isolation). |
| `agentsRoot` | A directory holding subagent files: `<agentsRoot>/.agents/agents/*.md` then `<agentsRoot>/.claude/agents/*.md`, each becoming a child. No home-directory scan. See [Children from subagent files](#children-from-subagent-files). |
| `defaultInherit` | The packages file-defined children inherit. Required when `agentsRoot` is set; a file never names a package. |
| `children.<name>.context` | `"none"` (default), `"summary"`, or `{ lastTurns, maxChars? }` (`lastTurns` ≥ 1, `maxChars` default 24,000; the host's value is the cap). How much of the parent's conversation the child is given. Host config only: the tool has no argument for it. See [Context](#context). |
| `children.<name>.hidden` | `true` leaves the child out of the `delegate` description and `child` enum, so the model cannot reach it; only the `delegate` service can start it. A file-defined child is never hidden. |
| `ownership` | Retired: a child session inherits the parent session's ownership scope. Setting it fails the load with a message saying so. |
| `maxDepth` | How deep the tree may grow: 1 (default, a child never sees `delegate`), 2 or 3. See [Depth and queueing](#depth-and-queueing). |
| `maxConcurrent` | Running delegations at once across the whole tree (every depth, sync and async). Default 4. |
| `queueTimeoutMs` | How long a call over `maxConcurrent` waits for a slot, in call order, before it fails. Default 30,000; `0` fails at once. |
| `activityFlushMs` | How often a `report: "stream"` child's buffered `delegate.activity` text is flushed. Default 1,000. |
| `ceilings` | Host-only ceilings over every child's config: `maxTurns` (200), `maxToolCalls` (1,000), `maxTotalTokens` (2,000,000), `maxWallTimeMs` (3,600,000), each raisable or `null` (no ceiling); `resultMaxChars` (64,000); `retainedResultChars` (256,000, at least `resultMaxChars`). A child value above one fails the load. The model's `delegate` arguments never reach a limit. |
| `announceAsync` | `true` (default): when a run is about to end with async delegations of its session still running or unread, ask for one `run.end` continuation naming them. See [Async children at run end](#async-children-at-run-end). |

## Depth and queueing

`maxDepth` bounds the delegation tree. A session at depth `d` (`SessionContext.depth`: 0 for a root, the parent's plus one for a child) sees `delegate`, `delegate_wait` and `delegate_cancel` only while `d < maxDepth`:

- The tools are registered with a `when` predicate on `session.depth`, so a session at `maxDepth` is neither shown nor allowed to call them.
- This package is never inherited, so a child below `maxDepth` gets the three tools appended to its allow-list (and the `delegating-work` skill with them under `skills: "inherit"`).
- The runtime checks the calling session's depth too, so the `delegate` service refuses with `depth_exceeded` from a session at `maxDepth` (fail closed).
- The cap is 3: a nested approval's attribution carries two path entries per level, and every level's turns are charged to each ancestor's run.

`maxConcurrent` counts running delegations across the tree, because every level runs on the same agent and so through the same runtime. A call over the limit waits for a slot up to `queueTimeoutMs`, in call order (a new call never overtakes one already waiting). On timeout, or when the calling tool call is aborted while it waits, it fails with the same `DelegateError` (`At most N delegations may run at once…`) and never starts a child. An async call returns `running` only once it holds a slot. A waiting call holds no model call. A resumed child (after a suspension) takes its slot without waiting, because it continues a call that already had one.

With `maxDepth` above 1, keep `maxConcurrent` at least `maxDepth`: a sync child that delegates holds its own slot while its grandchild waits for one, so with too few slots the grandchild times out. Setup notes it (`warn`) when `maxConcurrent < maxDepth`.

```jsonc
{ "config": { "maxDepth": 2, "maxConcurrent": 4, "queueTimeoutMs": 30000,
              "children": { "worker": { "inherit": ["@arnilo/prism-tools/coding"], "report": "stream" } } } }
```

## Async children at run end

An async child outlives the tool call that started it, and a model that forgets it ends the run without its answer. When a run reaches `run.end` while async delegations of its session (started by the `delegate` tool, not the service) are still running or finished but unread, the package asks for one continuation whose steer names them (at most 8, then a count) and says to call `delegate_wait` or `delegate_cancel`.

- Each delegation is named at most once. A cancelled one, and one whose answer `delegate_wait` already served, is never named.
- The kernel caps continuations with `limits.maxContinuations`; an aborted run gets none.
- `announceAsync: false` turns it off. Cost: one more model turn per run that ends with unread async children; nothing otherwise.

## Worktree isolation

`isolation: "worktree"` is for a child that edits files. The delegate consumes the agent's `workspace` service at call time and binds one worktree to the child's session, so every coding tool already runs there for that session (the same routing plan 165 added); the delegate names the `workspace` service, never the `tools-coding` package.

- No `workspace` service on the agent fails the delegation with `isolation_unavailable` before the child runs, naming a package that provides one. A sandboxed coding instance refuses the binding (`workspace_sandbox_unsupported`) and fails the same way instead of running unisolated.
- When the child completes, its branch is merged into the parent's checked-out branch (`WorkspaceWorktree.parentBranch`, recorded at creation) with the commit subject `delegate(<child>): <first line of the input>`. A child that fails, is cancelled, or hits a limit merges nothing.
- The result's status line carries the outcome: `merged <sha> (N files)`, `merge conflict: <files> (branch <b> kept)`, `merge refused: <reason> (branch <b> kept)`, or `branch <b> kept`. A conflict or refusal leaves both trees exactly as they were; the delegate never resolves a conflict, never pushes, and never deletes an unmerged branch.
- Before a branch is kept, its worktree's pending changes are committed onto it, so a kept branch carries the child's edits and not just its commits.
- The worktree is disposed on every path, after a merge or after the branch is recorded; a merged branch is deleted by the service, an unmerged one stays.
- A suspended isolated child keeps its worktree bound while this process runs, so its resume continues there; the parent session's close records and releases it (`branch kept`). A resume in a new process finds no worktree and fails closed (`isolation_unavailable`) instead of running in the parent's tree.
- Parallel isolated children each get their own worktree (bounded by the service's `maxWorktrees`), and merges run one at a time so two compare-and-swap ref updates never race.
- Cost: one `git worktree add` and one merge per isolated delegation; nothing for `isolation: "none"`.

```ts
children: { coder: { inherit: ["@arnilo/prism-tools/coding"], isolation: "worktree" } }
// delegate → { status: "completed", text, merge: { status: "merged", commit: "ab12…", files: ["src/a.ts"] } }
```

## Context

A child sees only its `input` brief unless its config says otherwise. `context` is the host's choice, per child; the model cannot widen it.

| Value | What the child gets | Cost |
| --- | --- | --- |
| `"none"` (default) | The brief only. | Nothing. |
| `{ lastTurns }` | The last N turns of the parent's branch, rendered portable by the kernel's `selectTranscript` (text only, tool calls and results as text, thinking and provider metadata dropped), seeded into the child session when it opens (`sessions.open({ seed })`). | One branch read per delegation; up to `maxChars` (about `maxChars / 4` tokens) re-sent on every child turn. |
| `"summary"` | One summarization call over up to 48,000 chars of the same slice, capped at 4,000 chars, seeded as one summary entry. | One extra model call per delegation. |

- Only messages and summaries travel. A `package_state` entry never reaches the child, so an inherited package starts from its own `initial` state; a `suspended_run` entry never reaches it either. The parent's entries are already redacted (the kernel redacts at append), so the child receives `[REDACTED]` where the parent did.
- A seeded child is its own session, so it never writes to the parent's branch, forked or otherwise.
- A child on a different provider receives the parent's transcript as text: no tool blocks and no signatures survive, but the content is the parent's conversation. Choose `"summary"` for a child you would not hand the raw history.
- The `delegate` tool description says so: a child's line ends `(sees the last N turns of this conversation)` or `(sees a summary of this conversation)`.
- `context.session.entries()` during the `delegate` call ends with the assistant message carrying the call and no result; `selectTranscript` drops that call, so a child never sees an unmatched tool call.
- Without a session, or when the summarization call fails, a child configured with `context` fails as `context_unavailable` before it runs. It never runs blind in place of the configured context.

```ts
children: {
  reviewer: { inherit: ["@arnilo/prism-tools/coding"], context: { lastTurns: 6 } },
  researcher: { inherit: [], context: "summary" },
}
// status line: [child reviewer: completed, 4 turns, saw the last 6 turns, 14 earlier omitted]
```

## The `delegate` service

Package setup provides a `delegate` service, the same runtime the tools use (same concurrency, limits, `context`, approvals, isolation, result caps). It exists so a package can run a configured child the model never sees, such as a verifier:

```ts
const service = prism.services.consume<DelegateService>("delegate");
const outcome = await service?.start({ child: "verifier", input: brief, mode: "sync", session: context.session, signal: context.signal });
await service?.wait(delegationId, context.session);
```

- `start({ child, input, mode, session, principal?, signal? })` needs the caller's session as the kernel handed it (`session_required` otherwise; the child is linked to it and charged to its run) and returns the same outcome shape as the tool, or `{ delegationId, status: "running" }` for `mode: "async"`. A suspended outcome carries the child's `sessionId`, `runId` and `pending`.
- `wait(delegationId, session, signal?)` awaits one delegation of that session.
- It only starts children the host configured: a caller cannot pass a package set, model, or limits, so holding the service grants no capability the host did not configure.
- A hidden child is only reachable here. When every child is hidden, the three tools are not registered and setup notes why; the service is still provided.

## Children from subagent files

`agentsRoot` turns the files other agents already keep into children, so a repository's reviewer does not have to be restated in configuration. Setup reads `<agentsRoot>/.agents/agents/*.md` and then `<agentsRoot>/.claude/agents/*.md` (one `readdir` per directory, one read per file, nothing outside `agentsRoot`). Each file's `name`, `description`, and body become the child's name, description, and instructions; the rest of the frontmatter is read as follows:

| Frontmatter | Effect |
| --- | --- |
| `tools` | A comma string (`Read, Grep`) or a list. Mapped once through the frozen map `Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Grep`→`grep`, `Glob`→`glob`, `Bash`→`shell`, then `tools.only`. A file whose list maps to nothing is skipped with a `warn` note; unmapped names in a partly-mapping list are dropped with one `info` note. |
| `model` | `provider/model` is used as-is through the parent's providers. `inherit`, `sonnet`, `opus`, `haiku`, `fable`, a bare id, or no `model` means the parent session's model; a bare id adds an `info` note. |

Everything else (`permissionMode`, `mcpServers`, `hooks`, `maxTurns`, …) is ignored: a file is instructions, and nothing in it is imported or executed. `inherit` is always `defaultInherit` — a file cannot grant itself packages, and a `defaultInherit` listing `@arnilo/prism-extensions/delegate` fails `createAgent`.

A configured `children` entry wins over a file with the same name, and `.agents/agents` wins over `.claude/agents`; each duplicate is one `info` note. A malformed or unreadable file, and a file that selects no known tool, is skipped with a `warn` note. A mapped tool no inherited package registers is dropped at the child's first run with one note, because `RunOptions.tools.only` fails closed on an unknown name.

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
delegate({ children: {}, agentsRoot: process.cwd(), defaultInherit: ["@arnilo/prism-tools/coding"] })
```

## Approvals inside a child

A child's `ask` (from any `tool.call` hook of any loaded package) is handled like the parent's own, and the child inherits the calling run's `interactive`:

- **Interactive parent with a host UI:** the ask reaches the host as a request whose `sessionId` is the child's session, so a host tells a child's request from the parent's by session (and `agent.sessions.list({ parentSessionId })`).
- **Headless parent (`interactive: false`, or no host UI), `sync` call:** the child suspends, and so does the parent run. `run.suspended` lists the child's decisions under parent-level approval ids, each with `attribution.path` `[delegateCallId, childSessionId]`. `session.resume(decisions)` on the parent routes them to the child through the tool's `resumeNested` (kernel plan 232 Task 3): the child resumes and the `delegate` call settles with its answer, or the parent suspends again. Sticky `allow_for_run` / `reject_for_run` decisions cover the same child's later asks.
- This works after a restart: the suspended child is recorded on the parent session (`package_state`), and `resumeNested` reopens it from the store (`sessions.open({ parent, id })`).
- **`async` call:** the child suspends on its own. `delegate_wait` reports `suspended` with the child session id, and the `finished` step carries its approval ids; the host resumes that session directly with `agent.session({ id }).resume(decisions)`.
- An unknown or no longer configured child, or a missing record, fails the resume closed: the `delegate` call gets an error result.

## `delegate.step` events

Child progress is reported as `package.event` named `delegate.step` with `{ origin, phase, turn?, status?, totalTokens?, sessionId?, approvalIds? }`. `phase` is `started`, `milestone`, `finished`, or `error`. `finished` names the child session, and for a suspended child its pending approval ids (at most 16), which is what a host needs to resume an async child. `origin` is the K3 record for the child (`{ kind: "prism", agent, agentId, delegationId, depth }`, `depth` the child session's depth), so a UI routes a subagent's activity with the same code it uses for a vendor agent. The payload holds ids and counters only: never the input, output, or tool arguments.

## `delegate.activity` events

With `report: "stream"`, the child's activity is also reported as `package.event` named `delegate.activity`:

| `kind` | Fields |
| --- | --- |
| `tool.started` | `tool`, `toolCallId`, `status: "started"` |
| `tool.finished` | `tool`, `toolCallId`, `status` (`finished`, `error`, `blocked`), `durationMs` |
| `text` | `text` (the child's streamed text, at most 2 KiB), `droppedChars?` |

Every event also carries `origin` (as on `delegate.step`) and `parentSessionId`, the session the delegation was started from. Package events are agent-wide (the kernel emits them with an empty `sessionId`), so a host routes a child's activity to the parent's view by `parentSessionId` and `origin.delegationId`.

- Text is buffered and flushed at most once per second (`DEFAULT_ACTIVITY_FLUSH_MS`), before each tool start or finish, and when the leg ends. The buffer keeps at most one event's worth; the rest is counted in `droppedChars`, not kept.
- An event never carries a tool's arguments or result. The text is the child's own output, redacted by the agent's redactor like every package event.
- `milestones` and `on-complete` emit no `delegate.activity` events.
- `@arnilo/prism-extensions/observability` records each one as a span event with `kind`, `tool` and `status`, never the text.

## Cost

Each delegation opens one session on the agent (no agent build and no package `setup`) plus the child's own model calls; its transcript is written to the agent's store. Every loaded package's per-run hooks also run for the child (context-files reads `AGENTS.md` again, for example). No child runs unless the model calls `delegate`. Concurrency is capped by `maxConcurrent` across the tree. Several `delegate` calls of one model turn run at once (`tools.concurrency`, default 4, equal to the default `maxConcurrent`); a call over the limit waits up to `queueTimeoutMs` for a slot (it holds no model call while it waits) and then fails with "At most 4 delegations may run at once, and no slot freed within 30000 ms".

`report: "stream"` emits two `delegate.activity` events per child tool call and at most one per second of child text (each at most 2 KiB), plus one `delegate.step` milestone per child tool call; `on-complete` (default) emits none of these. The child session is closed when the delegation ends and stays in the store.

A child's model turns are charged to the calling session's active run (`RunOptions.chargeTo`), so they count against that run's token and cost limits and appear in its usage; a breach there fails the child. An async child that outlives the parent's run is charged to no run after that point. The outcome's `usage` is the child's own: it is already inside the parent's, so do not add the two.

A `context` child also costs what its mode costs: `{ lastTurns }` reads the branch once and re-sends up to `maxChars` on every child turn; `"summary"` adds one model call with up to 48,000 chars in and 4,000 out. `"none"` costs nothing.

The parent's context grows by at most `resultMaxChars` per delegation (12,000 chars, roughly 3,000 tokens, by default) — one verbose child cannot flood the conversation it was meant to keep out. Raise it per child when a parent needs the whole answer; `delegate_wait { offset }` pages the rest without changing the cap.

## Safety

- A child never gains a tool its inherited packages did not register: `RunOptions.tools.only` is enforced at dispatch, not only in what the model is shown. Its principal and ownership scope are the parent's.
- A child cannot have a narrower **package** set than the parent, only a narrower tool and skill set: every loaded package's gates (approval, governance, hooks-json) bind it, which is stricter than a child agent that left governance out.
- `context` is host config: the model has no argument that widens what a child sees, and a hidden child cannot be reached by the model at all.
- The package declares `models`, `background`, `session-state`, and `sessions`. `session-state` lets it read the parent's branch for `context` and record a suspended child on the parent session; `sessions` lets it open and reopen child sessions.
- Nothing is approved on a child's behalf; see [Approvals inside a child](#approvals-inside-a-child).
- Child limits stay under the host's `ceilings`: a configured value above one fails the load (it is never clamped), and the defaults are sized for a real coding task (50 turns, 200 tool calls, 500,000 tokens, 15 minutes); lower them per child when that is too much. On the shared axes these now equal the kernel's defaults; an axis the child config leaves unset takes the kernel default (49 tool rounds, no input-token cap). Before plan 229, a child also inherited the kernel's old 8 tool rounds and 40,000 input tokens, so its 500,000-token total could not be reached.
