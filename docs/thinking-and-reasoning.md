# Thinking and reasoning

## What it does

Prism keeps thinking/reasoning **provider-owned on the wire** while giving hosts one portable way to set effort per turn. Model defaults live on `ModelConfig.compat` (and `capabilities.reasoning` where declared). Per-turn overrides live on `ProviderRequestOptions.compat` and win through existing `mergeProviderRequestOptions`. Shared helpers map a portable `ThinkingLevel` into the official compat fields each family already reads — they do **not** invent a second options tree.

## When to use it

- Session runs: pass `providerOptions.compat` (or `applyThinkingLevel`) on `RunOptions`.
- Use-case workers (LLM compaction, observational memory): pass `thinkingLevel`; packages map it into `compat` via the shared helpers.
- Provider authors: keep reading official fields from `options.compat` / `model.compat`; add package-local escape hatches only when the official API has unique knobs.

## Contract

| Layer | Surface |
| --- | --- |
| Model default | `ModelConfig.compat` (+ `capabilities.reasoning` when the model can reason) |
| Per-turn override | `ProviderRequestOptions.compat` (request wins over model via merge) |
| Portable level | `ThinkingLevel`: `none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max` |
| Helpers | `thinkingCompatFor`, `applyThinkingLevel`, `thinkingFamilyForModel`, `isThinkingLevel`, `normalizeThinkingLevel`, `THINKING_LEVELS` |
| Not used | Inert `options.extra.thinkingLevel` — providers do not read `extra` for effort |

```ts
import { applyThinkingLevel, thinkingCompatFor, thinkingFamilyForModel } from "@arnilo/prism";

// Per-turn override on a session run (OpenAI / OpenRouter family)
await session.run(input, {
  providerOptions: applyThinkingLevel(undefined, "low", "openai_reasoning"),
});

// Equivalent explicit compat
await session.run(input, {
  providerOptions: { compat: thinkingCompatFor("openai_reasoning", "low") },
  // → { reasoning: { effort: "low" } }
});

// Use-case worker: family from model metadata (or pass an explicit family)
const family = thinkingFamilyForModel(model);
await runObserver({
  ...,
  providerOptions: applyThinkingLevel(base, "low", family === "noop" ? "reasoning_effort" : family),
});
```

## Compat families

Core maps only shapes shared by ≥2 packages (or an explicit no-op). Unique knobs stay package-local.

| Family | Compat patch | Used by (official fields) |
| --- | --- | --- |
| `openai_reasoning` | `{ reasoning: { effort } }` | OpenAI Responses `reasoning.effort`; OpenRouter `reasoning.effort` |
| `reasoning_effort` | `{ reasoning_effort }` | Z.AI `reasoning_effort`; NeuralWatt `reasoning_effort`; Kimi K3 `reasoning_effort` |
| `thinking_type` | `{ thinking: { type: "enabled" \| "disabled" } }` | Z.AI `thinking.type`; Kimi K2.x `thinking.type` (`none` → `disabled`) |
| `noop` | `{}` | AI SDK / host-owned adapters — effort is host-model settings |

`applyThinkingLevel` defaults `family` to `reasoning_effort` when omitted. For `openai_reasoning`, an existing `compat.reasoning.summary` (or other reasoning keys) is preserved when merging `effort`.

### Recommended family by first-party package

| Package | Recommended family | Notes |
| --- | --- | --- |
| `@arnilo/prism-provider-openai` | `openai_reasoning` | First-class body `reasoning` from model + per-turn compat merge; `summary`/`mode`/`context` via compat |
| `@arnilo/prism-provider-openrouter` | `openai_reasoning` | First-class `resolveOpenRouterReasoning` merge; prefer `reasoning` object over legacy `reasoning_effort` shorthand; `preserveThinking` replays as body `reasoning` |
| `@arnilo/prism-provider-zai` | `reasoning_effort` (+ optional `thinking_type`) | Official `thinking` / `reasoning_effort` / `tool_stream` / `clear_thinking`; Preserved Thinking via `reasoning_content` |
| `@arnilo/prism-provider-neuralwatt` | `reasoning_effort` | Budgets / `preserve_thinking` / `clear_thinking` / `chat_template_kwargs` stay package-local on `compat` |
| `@arnilo/prism-provider-kimi` | K3: `reasoning_effort`; K2.x: `thinking_type` | K2.7-code thinking is always on; do not send conflicting `thinking` + `reasoning_effort` |
| `@arnilo/prism-provider-opencode-go` | Anthropic route: thinking blocks (`thinking_type` family); OpenAI route: `reasoning_content` preserve + optional `thinking`/`reasoning_effort`/`reasoning` passthrough | Official dual endpoints; MiniMax/Qwen → Anthropic, others → OpenAI |
| `@arnilo/prism-provider-ai-sdk` | `noop` | Host `LanguageModelV4` owns reasoning settings |

`thinkingFamilyForModel` infers family from existing `compat` shape, then safe provider heuristics (`openai*` → `openai_reasoning`, `neuralwatt` → `reasoning_effort`), then `capabilities.reasoning` → `reasoning_effort`, else `noop`. Docs and packages may map other provider ids explicitly; core avoids provider-specific literals beyond those heuristics.

## Merge order

1. `ModelConfig.compat` / model defaults inside the provider
2. `ProviderRequestOptions.compat` from agent / session policies
3. Per-turn `RunOptions.providerOptions` or use-case `applyThinkingLevel` patch (wins)

Providers already prefer `request.options.compat.*` over `request.model.compat.*`.

## Use-case workers

LLM compaction and observational memory accept `thinkingLevel?: string`. They call `applyThinkingLevel` into `compat` (not `extra.thinkingLevel`). When model inference returns `noop`, an explicit `thinkingLevel` still falls back to `reasoning_effort` so the host setting is never inert. Model selection for those workers (including session-model fallback) is documented in [Use-case model selection](use-case-model-selection.md).

## Non-reasoning models

- Helper with `noop`: returns options unchanged — no invented body fields.
- Helper with a real family on a model that rejects the field: provider/API error — hosts should gate on `capabilities.reasoning` or package docs.
- `thinking_type` + `none` sets `{ type: "disabled" }`; other levels set `{ type: "enabled" }` without encoding effort (compose with `reasoning_effort` when the API supports both).

## Related pages

- [Use-case model selection](use-case-model-selection.md) — session vs worker/summary model binding
- [Provider packages](provider-packages.md) — package boundaries and discovery
- [Provider caching](provider-caching.md) — cache retention can disable thinking on some providers (e.g. Z.AI when `cacheRetention: "none"`)
- [Provider request policies](provider-request-policies.md) — `mergeProviderRequestOptions`
- [Agent/session runtime](agent-session-runtime.md) — prior-reasoning preservation across turns
- Per-provider pages under [docs/providers](providers/)
- Evidence matrix: [Review coverage (2026-07-17 provider validation)](review-coverage-2026-07-17-provider-validation.md)
