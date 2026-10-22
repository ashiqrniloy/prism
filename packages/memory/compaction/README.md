# @arnilo/prism-memory-compaction

LLM summarization compaction as a Prism package. The default export is a `definePackage` definition
that claims the `compaction` slot and summarizes the history a cut drops with one model call per
compaction, then appends a standard `compaction` entry. Raw history stays in the session store.

**Installing the package is the opt-in.** Without it the kernel's deterministic compactor makes no
model call at all. With it, the cost is one summary call per compaction (two when a single oversized
turn has to be split), never one per turn, and nothing is called or resolved during `setup`.

## Install

```bash
prism add @arnilo/prism-memory-compaction
```

```jsonc
// manifest entry, with every config field
{
  "name": "@arnilo/prism-memory-compaction",
  "version": "^0.13.0",
  "integrity": "sha512-…",
  "config": { "model": "anthropic/claude-haiku-4-5", "profile": "coding" }
}
```

```ts
import memoryCompaction from "@arnilo/prism-memory-compaction";

const agent = await createAgent({ model: "mock/main", packages: [memoryCompaction({ profile: "coding" })] });
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | `"provider/model"` \| model object | the session's model | Summary model. A model object is a `ModelRef`, not a credential: the provider's key comes from the credentials slot like any run. |
| `profile` | `"default"` \| `"coding"` | `"default"` | `"coding"` adds read/modified file reporting to the summary and keeps the latest plan turn (`todo_write` result) out of the cut, so a long run's plan survives compaction. |
| `keepRecentTokens` | `integer` 0…131072 | `20000` | Tokens of recent history the cut keeps verbatim. |
| `maxSummaryTokens` | `integer` 1…131072 | `16384` | Summary cap in tokens, and the per-call provider output budget. |
| `summaryPrompt` | `string` | the package's summarization prompt | Replaces the summarization system prompt. The split-turn prompt stays the package's own. |

An unknown key fails `createAgent` with the kernel's config error naming the key. Every key is
optional: with no config the compactor summarizes with the session's own model.

## What it changes

- Claims the `compaction` slot through `prism.slots.compaction.provide`. A host's direct
  `AgentConfig.slots.compaction` assignment still wins, and `AgentConfig.compaction` keeps sizing the
  cut (`keepRecentEntries`, `maxSummaryChars`, `secrets`).
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
agent.subscribe(); // package.event { package: "@arnilo/prism-memory-compaction", name: "compaction.fallback", data: { strategy, reason } }
```

## Events and slots

| Surface | Name | Payload |
| --- | --- | --- |
| slot | `compaction` | a `Compactor` named `llm-compaction`, or `coding` for the coding profile |
| event | `compaction.fallback` | `{ strategy, reason }` — the reason is redacted and at most 1 KiB |

## Cost, security, and failure behavior

Installing the package is the opt-in: without it the kernel compactor makes no model call. Each
compaction makes one model call (two when one oversized turn has to be split) through
`prism.models.client`. A failed summary falls back to the kernel compactor and never fails the run.
The package has no secret config field; the key is the credentials slot's, and the summary is
redacted before it is stored or emitted.

## Requirements

`capabilities: ["models", "slot:compaction"]`, `requires.api: 1`. No runtime
dependencies.
