# @arnilo/prism-extensions/compaction

LLM summarization compaction as a Prism package. The default export is a `definePackage` definition
that claims the `compaction` slot and summarizes the history a cut drops with one model call per
compaction, then appends a standard `compaction` entry. Raw history stays in the session store.

**Installing the package is the opt-in.** Without it the kernel's deterministic compactor makes no
model call at all. Prism ships two compaction systems, and an agent runs one. **Session memory**
(`@arnilo/prism-memory-system` with `enabled: true`) is the recommended one: it records the session as it happens,
removes only what it has recorded, and `recall` returns the originals. **This package** is the alternative: it replaces
session memory with one summary of what the cut drops. Listing both fails `createAgent`. To keep this package beside the
memory system's long-term memory, set the memory system's `context.compaction: false`. With it, the cost is one summary call per compaction (two when a single oversized
turn has to be split), never one per turn, and nothing is called or resolved during `setup`.

## Install

```bash
prism add @arnilo/prism-extensions/compaction
```

```jsonc
// manifest entry, with every config field
{
  "name": "@arnilo/prism-extensions/compaction",
  "version": "^0.13.0",
  "integrity": "sha512-…",
  "config": { "model": "anthropic/claude-haiku-4-5", "profile": "coding" }
}
```

```ts
import memoryCompaction from "@arnilo/prism-extensions/compaction";

const agent = await createAgent({ model: "mock/main", packages: [memoryCompaction({ profile: "coding" })] });
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | `"provider/model"` \| model object | the session's model | Summary model. A model object is a `ModelRef`, not a credential: the provider's key comes from the credentials slot like any run. |
| `profile` | `"default"` \| `"coding"` | `"default"` | `"coding"` adds read/modified file reporting to the summary and keeps the latest plan turn (`todo_write` result) out of the cut, so a long run's plan survives compaction. |
| `keepRecentTokens` | `integer` ≥ 0 | 20% of the model's input cap, at most `20000` (`20000` when no cap resolves) | Tokens of recent history the cut keeps verbatim. |
| `maxKeptShare` | `number` 0.01–1 | `0.4` | Largest share of the model's input cap the kept tail may take. Past it the oldest kept entries are summarized instead, so a compacted request fits after a turn with one very large tool output. `1` lets the tail take the whole cap. |
| `maxSummaryTokens` | `integer` ≥ 1 | `16384` | Summary cap in tokens, and the per-call provider output budget. |
| `trigger` | `CompactionTrigger` | none: the kernel's trigger decides (80% of the input cap unless `AgentConfig.compaction` sets one) | The package's own `compaction.when` gate. |
| `summaryPrompt` | `string` | the package's summarization prompt | Replaces the summarization system prompt. The split-turn prompt stays the package's own. |
| `maxChunks` | `integer` ≥ 1 | `6` | Summary calls per compaction when the history does not fit the summary model's input cap (see [Oversized histories](#oversized-histories)). |
| `reserveTokens` | `integer` ≥ 1 | `16384` | Tokens kept free for the summary call's own prompt and output. |
| `maxErrorBytes` | `integer` ≥ 1 | `1024` | Bytes of a failed summary call's error kept in the fallback note. |
| `maxToolResultChars` | `integer` ≥ 0 | `2000` | Characters of one tool result in the serialized history. |
| `maxTextBlockChars` | `integer` ≥ 0 | `8000` | Characters of one text, thinking or tool-call block in the serialized history; `0` disables the cut. |

Every bound is the host's: there is no hidden ceiling above a configured value.

An unknown key fails `createAgent` with the kernel's config error naming the key. Every key is
optional: with no config the compactor summarizes with the session's own model.

## What it changes

- Claims the `compaction` slot through `prism.slots.compaction.provide`. A host's direct
  `AgentConfig.slots.compaction` assignment still wins, and `AgentConfig.compaction` keeps sizing the
  cut (`keepRecentEntries`, `maxSummaryChars`, `secrets`).
- With `trigger` set, registers the session's `compaction.when` vote: `{ compact: true }` past the
  gate and `{ compact: false }` below it, so the kernel's fallback trigger — which only runs on
  unanimous abstention — cannot override the package's gate. An `input_ratio` or `custom` gate reads
  the session model's window, else its provider's catalog (once per provider per agent, at the first
  check), so a bare `"provider/model"` ref works.
- Without `trigger` the package registers no vote, and the kernel's trigger decides when this
  compactor runs: `AgentConfig.compaction.trigger` or `thresholdEntries` when set, else 80% of the
  model's input cap (`DEFAULT_COMPACTION_TRIGGER`). Each compaction costs one summary call, as before.
  The default is a safety net against provider rejection; for a model whose quality drops well before
  its window fills, set a measured `threshold_tokens` trigger (see `docs/slots.md`).
- Calls the model through `prism.models.client(config.model ?? ctx.session.model)`, so the summary
  rides the agent's provider resolution, retry policy, and credentials slot. It never takes a
  provider or a key as config.
- Redacts with `ctx.secrets` before anything is summarized, returned, or emitted, and bounds the
  summary, the prompt, and every error message.

### Fallback

A summary-model failure never fails a run and never leaves the branch uncompacted. The compactor
falls back to `prism.slots.compaction.default` and emits `package.event` `compaction.fallback` with
the redacted, bounded reason. An aborted signal is the caller's stop, so it propagates and appends
nothing.

```ts
agent.subscribe(); // package.event { package: "@arnilo/prism-extensions/compaction", name: "compaction.fallback", data: { strategy, reason } }
```

### Oversized histories

The summary request must fit the **summary** model's own input cap: its context window (from the
model ref, else its provider's catalog) less the call's output budget and the kernel's 1,024-token
reserve. When the serialized history fits, the compactor makes one call, exactly as before. When it
does not, it splits the history at message boundaries into chunks sized to that cap and summarizes
them in order as a rolling summary: each call receives the previous call's summary as
`<previous-summary>`, and the last summary is the result. There is no separate merge call, so the
result can never overflow a merge request.

| | Calls per compaction |
| --- | --- |
| History fits the summary model's cap, or the model declares no window | 1 |
| History larger than the cap | `ceil(history tokens / chunk tokens)`, at most `maxChunks` (default 6) |
| Split turn (one oversized turn straddles the cut) | one more call for the turn prefix |

Past `maxChunks` the newest chunks are summarized and the summary opens with
`[Earlier history omitted: the oldest N of M chunks were not summarized (maxChunks K).]`. A failing
chunk fails the compaction once: the package falls back to the kernel compactor as below.

The serialization caps each text block, thinking block, and tool-call argument string at 8,000
characters, and each tool result at 2,000, with a `[..., N characters truncated]` marker, so one huge
block cannot fill a chunk. Redaction runs over every chunk request and over the final summary.

## Events and slots

| Surface | Name | Payload |
| --- | --- | --- |
| slot | `compaction` | a `Compactor` named `llm-compaction`, or `coding` for the coding profile |
| event | `compaction.fallback` | `{ strategy, reason }` — the reason is redacted and at most 1 KiB |

## Cost, security, and failure behavior

Installing the package is the opt-in: without it the kernel compactor makes no model call. Each
compaction makes one model call (two when one oversized turn has to be split; up to `maxChunks` when
the history does not fit the summary model's window, see [Oversized histories](#oversized-histories)) through
`prism.models.client`, passing the compacting session when the slot has one, so the summary runs `model.request`/`model.call` and counts against the run's limits. A failed summary falls back to the kernel compactor and never fails the run.
The package has no secret config field; the key is the credentials slot's, and the summary is
redacted before it is stored or emitted.

## Requirements

`capabilities: ["models", "slot:compaction"]`, `requires.api: 2`. No runtime
dependencies.
