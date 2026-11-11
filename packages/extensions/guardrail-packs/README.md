# @arnilo/prism-extensions/guardrail-packs

Built-in guardrail packs over tool calls and tool results, as one `tool.call` gate and one `tool.result` observer per configured pack. Restrictive only: a pack narrows what the agent may do, never widens it.

## Install

```bash
prism add @arnilo/prism-extensions/guardrail-packs
```

```ts
import guardrailPacks from "@arnilo/prism-extensions/guardrail-packs";
import toolsCoding from "@arnilo/prism-tools/coding";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [
    toolsCoding({ root }),
    guardrailPacks({
      packs: ["destructive-commands", "secrets-hygiene", { id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } }],
    }),
  ],
});
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `packs` | `(string \| { id, version?, options?, rules? })[]` | `[]` | Built-in pack ids and/or inline pack definitions. At most 8. |

An inline pack's `rules` are JSON-only: a `pattern` string (no `RegExp`, no `deny` predicate), a `tool`, an optional `argPath`, an `action` of `deny` / `tripwire` / `ask`, and a `reason`. An unknown pack id, a duplicate rule id, or an invalid pattern fails `createAgent` with `GuardrailPackError` (`ERR_PRISM_GUARDRAIL_PACK`).

### Built-in packs

| Id | Rules |
| --- | --- |
| `destructive-commands` | Refuses force pushes and recursive force deletes in a `shell` command. |
| `secrets-hygiene` | Refuses any tool argument that carries secret-shaped material, without echoing the value. |
| `coding-standard` | Refuses test rewrites and writes outside the configured roots. |
| `validation-respect` | Records a failed validation tool and refuses the next mutation until it passes again. |

## What it changes

Registers a `tool.call` decide handler and a `tool.result` observer per configured pack, plus the `guardrail-packs.describe` service and the `guardrail-packs:describe` command. A rule returns `{ deny }` (block, tripwire) or `{ ask }` (ask). An `ask` confirms through `host.ui` or suspends the run; the pack's state rides `state.session("packs")`, so an `ask` rule stays enforced after `session.resume`.

A rule that throws is a deny. A deny is scoped to the call, not the run. Refusal text names the rule as `pack:<pack>/<rule>` and is capped.

## Failure behavior

Packs never return `allow` to override another handler's deny. `secrets-hygiene` refusals never echo the matched value. An invalid pack configuration fails closed at setup, naming the pack.

## Capabilities

`session-state`.

## Example

`examples/guardrail-packs.ts` runs four network-free demos: two built-in packs refusing a `shell` and a `write` call and naming the rule; the same trajectory graded 0 by `createGuardrailPackScorer()`; an inline `ask` rule suspending a durable run and dispatching on approval; and a secret-shaped argument refused without the token in the refusal.
