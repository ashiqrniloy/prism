# @arnilo/prism-context-engineering

The four context-engineering stages as one package: an input budget, tool-result folding, tool
search, and the attention compiler. The kernel names no package and holds no context-engineering
concept: this package is the whole plane.

One `context.build` handler composes the configured stages in a fixed order — **fold → tool search →
attention or budget** — so the order cannot drift with hook priorities. The handler runs at the
lowest first-party priority (negative), so a budget or an attention pass sees every block another
`context.build` handler added this turn.

## Install

```bash
prism add @arnilo/prism-context-engineering
```

```ts
import contextEngineering from "@arnilo/prism-context-engineering";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [
    contextEngineering({
      fold: { minAgeTurns: 2, summarize: "truncate" },
      toolSearch: { disclosure: "search", topK: 8 },
      attention: { triggerRatio: 0.8, compactRatio: 0.9 },
    }),
  ],
});
```

With no config the package registers nothing at all: no handler, no tool, no `compaction.when`, and
no change to the request bytes.

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `budget.maxInputTokens` | none | Token cap for the whole draft. One of the two caps is required with `budget`. |
| `budget.maxInputBytes` | none | Byte cap for the whole draft. |
| `budget.reportOmissions` | `false` | Emit a `context.omissions` package event for every dropped row. |
| `fold.minAgeTurns` | `2` | A tool result is foldable once its turn is this far behind the current one. |
| `fold.minBytes` | `4096` | Results smaller than this are never folded. |
| `fold.maxSummaryBytes` | `512` | Cap on the stub body (hard cap 4096). |
| `fold.summarize` | `"truncate"` | `"truncate"` keeps the head of the payload with no model call; `{ model }` summarizes with one model call per newly folded result. |
| `toolSearch.disclosure` | `"all"` | `"search"` narrows `draft.tools` to the activated and top-k set and registers `search_tools`. |
| `toolSearch.topK` | `16` | Tools disclosed per turn (clamped to 64). |
| `attention.maxInputTokens` | model window | Host input cap; wins over `model.limits.contextWindow`. |
| `attention.reserveTokens` | `1024` | Output + next-turn headroom subtracted from the window. |
| `attention.triggerRatio` | `0.75` | Fraction of the cap that opens the fold gate. |
| `attention.compactRatio` | `0.9` | Fraction of the cap at which `compaction.when` requests a new prefix. Must exceed `triggerRatio`. |
| `attention.thinkingKeepTurns` | `1` | Newest thinking-bearing assistant turns kept intact. |
| `attention.keepLast` | `3` | Newest tool results kept full. |
| `attention.excludeTools` | `[]` | Tool names whose results are never stubbed. |
| `attention.trigger` | `triggerRatio` | Fold axes (`input_ratio`, `run_input_ratio`, `token_floor`), any-of, first match attributed. |

`budget` and `attention` are **mutually exclusive**: both evict from the same request for the same
reason, and configuring both fails the load with a message naming both.

## What it changes

**Fold.** Old tool-result messages are rewritten in the provider view only. `"truncate"` keeps the
head of the payload, capped at `fold.maxSummaryBytes`; `{ model }` calls the model once per newly
folded result and caches the body per session by tool-call id, so a result is summarized once.
Neither touches the store: `session.messages()` still holds the full result.

**Tool search.** The handler narrows `draft.tools` to the activated set plus the top-k for the turn
and publishes that list as the index `search_tools` scores against. The index is built from
`draft.tools`, so a tool the kernel hid with a `when` predicate or `disable.tools` is not in it and
cannot be returned. Activation is session state, so a reopened session keeps its activations.

**Attention.** Past `triggerRatio` of the input cap the compiler strips thinking from every assistant
turn but the newest `thinkingKeepTurns` and stubs the oldest tool results beyond `keepLast`, oldest
first. A still-firing gate after every eligible row fails the run closed with `AttentionBudgetError`
(the honest answer is a new prefix, not silent deletion). The sticky frontier and the fold ledger
live in the session's own package state, so a reopened session re-applies the same stub bytes. Each
mutated turn emits an `attention.compiled` package event with counts and the measured ratio inputs.
Past `compactRatio`, the `compaction.when` handler asks for compaction.

**Budget.** The whole draft is measured — messages, context blocks another handler added, and tool
declarations. Droppable rows are evicted oldest-first, tool results before other history, then the
lowest-priority context block. The leading system block is the mandatory prefix: it is never dropped,
and when it alone cannot fit the transform rejects and the run fails closed with the kernel's
`context budget exceeded: mandatory prefix cannot fit` message. `budget.reportOmissions` turns the
report into a `context.omissions` package event.

## Cost, security, and failure behavior

- **No model call by default.** `fold.summarize: "truncate"` is deterministic. `{ model }` adds one
  call per newly folded result (never per turn). Tool search adds no model call. Attention may
  request compaction, and each compaction costs whatever the `compaction` slot owner costs.
- **One pass per turn per configured stage.** No stage configured means no handler and no pass.
- **The store keeps the full transcript.** Every stage rewrites a clone of `draft.messages`; the
  provider view is the only thing that changes.
- **No fetch, no filesystem, no credentials.** The package makes no network request, reads no file,
  and holds no secret. `fold.summarize: { model }` resolves through the agent's own providers and
  credential slot.
- **Fail closed.** An unfittable mandatory prefix rejects the transform; a still-firing attention
  gate throws; a malformed persisted frontier or ledger restores nothing rather than a partial state.

## Libraries

The four stages are exported directly for a host that composes its own `context.build` handler:

```ts
import { applyDraftBudget, compileAttention, createAttentionCompiler, foldToolResultHistory, selectDisclosedTools } from "@arnilo/prism-context-engineering";
```

`createContextEngineeringHandler` builds the same composed handler over host-supplied state, and
`contextEngineeringConfigSchema` is the JSON schema the package validates against.

## Capabilities

`models` (only `fold.summarize: { model }` uses it) and `session-state` (the fold cache, the
activated tool set, and the attention frontier/ledger).
