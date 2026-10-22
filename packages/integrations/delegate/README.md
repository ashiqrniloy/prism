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
| `delegate` | `child`, `input`, `mode?: "sync" \| "async"` | `sync` returns the child's outcome. `async` (and any `lifetime: "session"` child) returns `{ delegationId, status: "running" }`. |
| `delegate_wait` | `delegationId` | The outcome: `status`, `text`, `usage`, and `pending` decisions when the child suspended. |
| `delegate_cancel` | `delegationId` | `cancelling`, or `terminal` when it already ended. |

All three declare `effects: ["external"]`, so `tool.call` gates (approval, governance) see them. An unknown child, an unknown or foreign `delegationId`, or too many running delegations is a tool error. A delegation id is only usable from the session that started it.

## Configuration

| Field | Description |
| --- | --- |
| `children.<name>.inherit` | Package names loaded in the parent that the child inherits. The child gets exactly these plus a bridge to the parent's providers, and never this package. Listing `@arnilo/prism-delegate` fails `createAgent`. |
| `children.<name>.instructions` | The child's instructions. |
| `children.<name>.model` | The child's model. Defaults to the parent session's model. It resolves through the parent's providers, so the child holds no credential. Do not inherit a provider package. |
| `children.<name>.tools.only` | Narrows the child's run to these tool names. |
| `children.<name>.limits` | `maxTurns`, `maxToolCalls`, `maxTotalTokens`, `maxWallTimeMs`. Values above the hard ceilings are clamped. |
| `children.<name>.budgetShare` | Fraction (0, 1] of the default child limits. |
| `children.<name>.lifetime` | `task` (default) ends with the calling tool call. `session` detaches from it and ends when the parent session closes. |
| `children.<name>.report` | `on-complete` (default), `milestones` (each child turn), or `stream` (each turn and tool). |
| `maxDepth` | Only `1`: a child never sees `delegate`. |
| `maxConcurrent` | Running delegations at once. Default 4, at most 32. |

## `delegate.step` events

Child progress is reported as `package.event` named `delegate.step` with `{ origin, phase, turn?, status?, totalTokens? }`. `phase` is `started`, `milestone`, `finished`, or `error`. `origin` is the K3 record for the child (`{ kind: "prism", agent, agentId, delegationId, depth: 1 }`), so a UI routes a subagent's activity with the same code it uses for a vendor agent. The payload holds ids and counters only: never the input, output, or tool arguments.

## Cost

Each delegation builds one child agent (`createAgent` over the inherited packages) plus the child's own model calls. No child runs unless the model calls `delegate`. Concurrency is capped by `maxConcurrent`. The child agent and its session are disposed when the delegation ends.

## Safety

- A child never gains a package the parent did not load, and its principal is the parent's.
- A child's `ask` (from any `tool.call` hook) suspends the child: `delegate_wait` returns `status: "suspended"` with the pending decisions. Nothing is approved on the child's behalf, and a suspended child is not resumable through this package.
- Inherited packages' hooks also apply to the parent, because they are loaded in the parent.
- Child limits only narrow: a configured value is clamped to the hard ceilings, and the defaults are small (8 turns, 32 tool calls, 20,000 tokens, 60 seconds).
