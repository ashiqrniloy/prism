# @arnilo/prism-delegate

Sub-agents as a tool for `@arnilo/prism`. A `delegate` tool runs a named child as its own agent over a chosen subset of the parent's packages and returns the child's answer as the tool result.

## Install

```bash
prism add @arnilo/prism-delegate
```

```ts
import { createAgent } from "@arnilo/prism";
import delegate from "@arnilo/prism-delegate";

const agent = await createAgent({
  model: "mock/main",
  packages: [
    mockProvider(),
    toolsCoding({ root: process.cwd(), readOnly: true }),
    delegate({
      children: { reviewer: { inherit: ["@arnilo/prism-tools-coding"], instructions: "Review the diff." } },
    }),
  ],
});
```

Or in the manifest:

```jsonc
{ "name": "@arnilo/prism-delegate", "version": "^0.13.0", "integrity": "sha512-…", "capabilities": ["models", "background"],
  "config": { "children": { "reviewer": { "inherit": ["@arnilo/prism-tools-coding"], "instructions": "Review the diff.", "report": "milestones" } } } }
```

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `delegate` | `child`, `input`, `mode?: "sync" \| "async"` | `sync` returns the child's answer, then a status line such as `[child reviewer: completed, 12 turns, 41,203 tokens]`; that answer ends with the tool call. `async` returns `[child reviewer: running, delegationId dlg_…]` and runs as the parent session's background work, ending with it. |
| `delegate_wait` | `delegationId`, `offset?` | The same text result. `offset` reads the next slice of a long answer; the truncation hint names the next offset. A suspended child reports `suspended` and its pending count. The entry is dropped once its answer was fully served, or when the parent session closes. |
| `delegate_cancel` | `delegationId` | `cancelling`, or `terminal` when it already ended. |

All three declare `effects: ["external"]`, so `tool.call` gates (approval, governance) see them. An unknown child, an unknown or foreign `delegationId`, or too many running delegations is a tool error. A delegation id is only usable from the session that started it.

## Skill

The package ships one skill, `delegating-work` (a child sees only the brief, never put a secret in it, do a one- or two-call job yourself, check the answer before repeating it). It is loaded from `skills/delegating-work`, progressive by default, and declares `requiresTools: delegate delegate_wait delegate_cancel` (the three are always registered together), so a config with no visible child, or a request that narrows the tools away, does not list it. Cost: one catalog line (about 190 bytes). Turn it off with `disable.skills: ["delegating-work"]`. Its effect is measured on one hazard (`delegate-trivial-no-child`: 9/9 with the skill, 1/9 without) and not in the pooled score; see [the evidence](../../../docs/_evidence/skill-evals/211/v3/delegating-work.preload.md).

It tells the model that a child holds only what the brief and any forwarded context carry, and never to put a secret or credential in a brief. A child never sees `delegate`, so `skills: "inherit"` leaves this skill out of the child (inheriting it would only add the `load_skill` bridge to a child that could never use it); name it in a `skills` list to hand it over anyway.

## Configuration

| Field | Description |
| --- | --- |
| `children.<name>.inherit` | Package names loaded in the parent that the child inherits. The child gets exactly these plus a bridge to the parent's providers, and never this package. Listing `@arnilo/prism-delegate` fails `createAgent`. |
| `children.<name>.description` | One line the parent model reads to choose this child; it appears in the `delegate` tool description. Defaults to the first sentence of `instructions`; without either, `(no description)` and a setup note. |
| `children.<name>.instructions` | The child's instructions, after the report contract ("Finish with a concise report for the parent…"), which is always prepended. |
| `children.<name>.model` | The child's model. Defaults to the parent session's model. It resolves through the parent's providers, so the child holds no credential. Do not inherit a provider package. |
| `children.<name>.tools.only` | Narrows the child's run to these tool names. |
| `children.<name>.limits` | `maxTurns`, `maxToolCalls`, `maxTotalTokens`, `maxWallTimeMs`. Values above the hard ceilings are clamped. |
| `children.<name>.resultMaxChars` | Cap on the answer text the parent sees. Default 12,000, at most 64,000. A longer answer ends with a `delegate_wait` offset hint; the delegation keeps up to 256,000 chars to page. |
| `children.<name>.report` | `on-complete` (default), `milestones` (each child turn), or `stream` (each turn and tool). |
| `children.<name>.skills` | `"inherit"` (default) gives the child every skill the parent has at delegation time, `"none"` gives none, and a name list gives exactly those. An unknown name fails the delegation. |
| `children.<name>.isolation` | `"worktree"` runs the child in its own git worktree of the inherited coding package's repository and merges its branch into the parent's current branch when it completes. `"none"` (default) leaves the child in whatever tree the inherited tools use. See [Worktree isolation](#worktree-isolation). |
| `agentsRoot` | A directory holding subagent files: `<agentsRoot>/.agents/agents/*.md` then `<agentsRoot>/.claude/agents/*.md`, each becoming a child. No home-directory scan. See [Children from subagent files](#children-from-subagent-files). |
| `defaultInherit` | The packages file-defined children inherit. Required when `agentsRoot` is set; a file never names a package. |
| `children.<name>.context` | `"none"` (default), `"summary"`, or `{ lastTurns, maxChars? }` (`lastTurns` 1–50, `maxChars` default 24,000, hard cap 120,000). How much of the parent's conversation the child is given. Host config only: the tool has no argument for it. See [Context](#context). |
| `children.<name>.hidden` | `true` leaves the child out of the `delegate` description and `child` enum, so the model cannot reach it; only the `delegate` service can start it. A file-defined child is never hidden. |
| `ownership` | Scope the child agents append under. Set it to the parent agent's `ownership`: a child has no store to infer it from, and an inherited coding tool's durable effect (a write) fails without one. `RunWorkflowOptions.ownership` exists for the same reason. |
| `maxDepth` | Only `1`: a child never sees `delegate`. |
| `maxConcurrent` | Running delegations at once. Default 4, at most 32. |

## Worktree isolation

`isolation: "worktree"` is for a child that edits files. The delegate binds one worktree of the child's own `workspace` service to the child's session, so every inherited coding tool already runs there (the same routing plan 165 added); the delegate names the `workspace` service, never the `tools-coding` package.

- No `workspace` service in the child fails the delegation with `isolation_unavailable` before the child runs, naming a package that provides one. A sandboxed coding instance refuses the binding (`workspace_sandbox_unsupported`) and fails the same way instead of running unisolated.
- When the child completes, its branch is merged into the parent's checked-out branch (`WorkspaceWorktree.parentBranch`, recorded at creation) with the commit subject `delegate(<child>): <first line of the input>`. A child that fails, is cancelled, or hits a limit merges nothing.
- The result's status line carries the outcome: `merged <sha> (N files)`, `merge conflict: <files> (branch <b> kept)`, `merge refused: <reason> (branch <b> kept)`, or `branch <b> kept`. A conflict or refusal leaves both trees exactly as they were; the delegate never resolves a conflict, never pushes, and never deletes an unmerged branch.
- Before a branch is kept, its worktree's pending changes are committed onto it, so a kept branch carries the child's edits and not just its commits.
- The worktree is disposed on every path, after a merge or after the branch is recorded; a merged branch is deleted by the service, an unmerged one stays.
- Parallel isolated children each get their own worktree (bounded by the service's `maxWorktrees`), and merges run one at a time so two compare-and-swap ref updates never race.
- Cost: one `git worktree add` and one merge per isolated delegation; nothing for `isolation: "none"`.

```ts
children: { coder: { inherit: ["@arnilo/prism-tools-coding"], isolation: "worktree" } }
// delegate → { status: "completed", text, merge: { status: "merged", commit: "ab12…", files: ["src/a.ts"] } }
```

## Context

A child sees only its `input` brief unless its config says otherwise. `context` is the host's choice, per child; the model cannot widen it.

| Value | What the child gets | Cost |
| --- | --- | --- |
| `"none"` (default) | The brief only. | Nothing. |
| `{ lastTurns }` | The last N turns of the parent's branch, rendered portable by the kernel's `selectTranscript` (text only, tool calls and results as text, thinking and provider metadata dropped), seeded into the child's own store before its first run. | One branch read per delegation; up to `maxChars` (about `maxChars / 4` tokens) re-sent on every child turn. |
| `"summary"` | One summarization call over up to 48,000 chars of the same slice, capped at 4,000 chars, seeded as one summary entry. | One extra model call per delegation. |

- Only messages and summaries travel. A `package_state` entry never reaches the child, so an inherited package starts from its own `initial` state; a `suspended_run` entry never reaches it either. The parent's entries are already redacted (the kernel redacts at append), so the child receives `[REDACTED]` where the parent did.
- A seeded child is opened under its own session id in its own memory store, so it can never write to the parent's session, forked or otherwise.
- A child on a different provider receives the parent's transcript as text: no tool blocks and no signatures survive, but the content is the parent's conversation. Choose `"summary"` for a child you would not hand the raw history.
- The `delegate` tool description says so: a child's line ends `(sees the last N turns of this conversation)` or `(sees a summary of this conversation)`.
- `context.session.entries()` during the `delegate` call ends with the assistant message carrying the call and no result; `selectTranscript` drops that call, so a child never sees an unmatched tool call.
- Without a session, or when the summarization call fails, a child configured with `context` fails as `context_unavailable` before it runs. It never runs blind in place of the configured context.

```ts
children: {
  reviewer: { inherit: ["@arnilo/prism-tools-coding"], context: { lastTurns: 6 } },
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

- `start({ child, input, mode, session, principal?, signal? })` needs a session (`session_required` otherwise) and returns the same outcome shape as the tool, or `{ delegationId, status: "running" }` for `mode: "async"`.
- `wait(delegationId, session, signal?)` awaits one delegation of that session.
- It only starts children the host configured: a caller cannot pass a package set, model, or limits, so holding the service grants no capability the host did not configure.
- A hidden child is only reachable here. When every child is hidden, the three tools are not registered and setup notes why; the service is still provided.

## Children from subagent files

`agentsRoot` turns the files other agents already keep into children, so a repository's reviewer does not have to be restated in configuration. Setup reads `<agentsRoot>/.agents/agents/*.md` and then `<agentsRoot>/.claude/agents/*.md` (one `readdir` per directory, one read per file, nothing outside `agentsRoot`). Each file's `name`, `description`, and body become the child's name, description, and instructions; the rest of the frontmatter is read as follows:

| Frontmatter | Effect |
| --- | --- |
| `tools` | A comma string (`Read, Grep`) or a list. Mapped once through the frozen map `Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Grep`→`grep`, `Glob`→`glob`, `Bash`→`shell`, then `tools.only`. A file whose list maps to nothing is skipped with a `warn` note; unmapped names in a partly-mapping list are dropped with one `info` note. |
| `model` | `provider/model` is used as-is through the parent's providers. `inherit`, `sonnet`, `opus`, `haiku`, `fable`, a bare id, or no `model` means the parent session's model; a bare id adds an `info` note. |

Everything else (`permissionMode`, `mcpServers`, `hooks`, `maxTurns`, …) is ignored: a file is instructions, and nothing in it is imported or executed. `inherit` is always `defaultInherit` — a file cannot grant itself packages, and a `defaultInherit` listing `@arnilo/prism-delegate` fails `createAgent`.

A configured `children` entry wins over a file with the same name, and `.agents/agents` wins over `.claude/agents`; each duplicate is one `info` note. A malformed or unreadable file, and a file that selects no known tool, is skipped with a `warn` note. A mapped tool the agent does not register is dropped at the child's first run with one note, because `RunOptions.tools.only` fails closed on an unknown name.

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
delegate({ children: {}, agentsRoot: process.cwd(), defaultInherit: ["@arnilo/prism-tools-coding"] })
```

## `delegate.step` events

Child progress is reported as `package.event` named `delegate.step` with `{ origin, phase, turn?, status?, totalTokens? }`. `phase` is `started`, `milestone`, `finished`, or `error`. `origin` is the K3 record for the child (`{ kind: "prism", agent, agentId, delegationId, depth: 1 }`), so a UI routes a subagent's activity with the same code it uses for a vendor agent. The payload holds ids and counters only: never the input, output, or tool arguments.

## Cost

Each delegation builds one child agent (`createAgent` over the inherited packages) plus the child's own model calls. No child runs unless the model calls `delegate`. Concurrency is capped by `maxConcurrent`. The child agent and its session are disposed when the delegation ends.

A `context` child also costs what its mode costs: `{ lastTurns }` reads the branch once and re-sends up to `maxChars` on every child turn; `"summary"` adds one model call with up to 48,000 chars in and 4,000 out. `"none"` costs nothing.

The parent's context grows by at most `resultMaxChars` per delegation (12,000 chars, roughly 3,000 tokens, by default) — one verbose child cannot flood the conversation it was meant to keep out. Raise it per child when a parent needs the whole answer; `delegate_wait { offset }` pages the rest without changing the cap.

## Safety

- A child never gains a package the parent did not load, and its principal is the parent's.
- `context` is host config: the model has no argument that widens what a child sees, and a hidden child cannot be reached by the model at all.
- The package declares `models`, `background`, `host-ui`, and `session-state`; the last is what lets it read the parent's branch for `context`.
- A child's `ask` (from any `tool.call` hook) goes to the parent's host UI, labelled with the child's name: the request's `title`, `detail`, and `message` are prefixed `[<child>] `. The host stamps `package`/`sessionId` itself and a package cannot set them, so text is the only attribution available. The child never sees the host object and cannot answer its own approvals.
- Without a parent `host.ui`, the child suspends: `delegate_wait` returns `suspended` and the pending count. Nothing is approved on the child's behalf, and a suspended child is not resumable through this package.
- Inherited packages' hooks also apply to the parent, because they are loaded in the parent.
- Child limits only narrow: a configured value is clamped to the hard ceilings, and the defaults are sized for a real coding task (50 turns, 200 tool calls, 500,000 tokens, 15 minutes); lower them per child when that is too much.
