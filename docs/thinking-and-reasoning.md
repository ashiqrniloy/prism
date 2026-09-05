# Thinking and reasoning

## What it does

Prism gives hosts one portable way to set thinking/reasoning effort per model and per turn, and guarantees the level actually reaches the wire on every provider Prism ships. The single entry point is **`applyThinkingLevelForModel`**: it resolves the model's compat family, snaps the requested level to the model's **declared levels** (`capabilities.thinkingLevels`), and merges the family's compat patch into your base options. Every first-party provider catalog stamps the family and declares the per-model level set; provider resolvers translate the patch into official wire fields. Model defaults live on `ModelConfig.compat`; per-turn overrides live on `ProviderRequestOptions.compat` and win through the existing `mergeProviderRequestOptions` merge.

## When to use it

- Session runs: pass `providerOptions` from `applyThinkingLevelForModel` on `RunOptions` — one call, no per-provider branching.
- Use-case workers (LLM compaction, observational memory): pass `thinkingLevel`; workers call `applyThinkingLevelForModel` with the bound model.
- Hosts building UI: read `model.capabilities.thinkingLevels` (when declared) to render a legal level picker; `isSupportedThinkingLevel` tells you whether a value is declared before sending.
- Provider authors: read official wire fields from the compat patches below; keep unique knobs package-local.

## Inputs / request

| Input | Type | Notes |
| --- | --- | --- |
| `base` | `ProviderRequestOptions \| undefined` | Existing options; the patch is merged on top |
| `level` | `string \| undefined` | Portable `ThinkingLevel` (`none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max`) or an opaque provider-specific string (forward-compat passthrough) |
| `model` | `Pick<ModelConfig, "provider" \| "compat" \| "capabilities">` | Model view used for family resolution, declared levels, and reasoning gating |

## Outputs / response / events

Returns the merged `ProviderRequestOptions` (a new object when a patch applies; `base` unchanged when there is nothing to do — non-reasoning model, `noop` family, or `level` undefined).

## Request/response example

```json
{ "compat": { "reasoning_effort": "high" } }
```

## Implementation example

```ts
import { applyThinkingLevelForModel } from "@arnilo/prism";

// Per-turn override on a session run
await session.run(input, {
  providerOptions: applyThinkingLevelForModel(base, "high", model),
});

// Declared-level-aware UI
const levels = model.capabilities?.thinkingLevels; // e.g. ["low","medium","high","xhigh","max"]
```

## Contract

| Layer | Surface |
| --- | --- |
| Adapter (use this) | `applyThinkingLevelForModel(base, level, model)` — family resolution + snap + merge in one call |
| Model default | `ModelConfig.compat` (+ `capabilities.reasoning`, `capabilities.thinkingLevels` when declared) |
| Per-turn override | `ProviderRequestOptions.compat` (request wins over model via merge) |
| Portable level | `ThinkingLevel`: `none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max` |
| Parse / validate | `parseThinkingLevel` (known level → canonical; other non-empty string → opaque passthrough; empty/non-string → `undefined`), `isSupportedThinkingLevel(model, level)`, `thinkingLevelsForModel(model)`, `snapThinkingLevel(model, level)` |
| Legacy helpers | `thinkingCompatFor`, `applyThinkingLevel`, `thinkingFamilyForModel`, `isThinkingLevel`, `normalizeThinkingLevel`, `THINKING_LEVELS` (still exported; prefer the adapter) |
| Not used | Inert `options.extra.thinkingLevel` — providers do not read `extra` for effort |

## Compat families

Core maps only shapes shared by ≥2 packages (or an explicit no-op). Unique knobs stay package-local. Family inference is **stamp-first**: `compat.thinkingFamily` set by the catalog wins, then compat-shape heuristics, then provider-id heuristics, then `capabilities.reasoning`.

| Family | Compat patch | Used by (official wire fields) |
| --- | --- | --- |
| `openai_reasoning` | `{ reasoning: { effort } }` | OpenAI Responses `reasoning.effort`; OpenRouter `reasoning.effort` |
| `reasoning_effort` | `{ reasoning_effort }` | Z.AI, NeuralWatt, Kimi K3, DeepSeek, xAI, ClinePass, Hyper, Ollama, gateways (OpenAI routes) |
| `thinking_type` | `{ thinking: { type: "enabled" \| "disabled" } }` | Z.AI `thinking.type`; Kimi K2.x; DeepSeek toggle; Qwen `enable_thinking` (via `alibabaEnableThinking`) |
| `google` | `{ thinkingLevel }` | Google `generationConfig.thinkingConfig.thinkingLevel` (3.x) / `thinkingBudget` (2.5) |
| `output_config_effort` | `{ output_config: { effort } }` | Anthropic Messages `output_config.effort`; DeepSeek anthropic-format endpoint |
| `noop` | `{}` | AI SDK / host-owned adapters — effort is host-model settings |

**Removed guidance:** do not use the `thinking_type` family to carry effort on Anthropic-routed providers — `thinking.type` is a toggle, and `enabled` without `budget_tokens` is rejected by current Anthropic APIs. Anthropic effort travels in `output_config.effort` (`output_config_effort` family).

### First-party packages

| Package | Family / behavior |
| --- | --- |
| `@arnilo/prism-providers/openai` | `openai_reasoning`; per-family effort tables, Responses-side clamp, `summary` preserved |
| `@arnilo/prism-providers/openrouter` | `openai_reasoning`; API-derived `supported_efforts` levels; `preserveThinking` replays as body `reasoning` / `reasoning_content` |
| `@arnilo/prism-providers/anthropic` | `output_config_effort`; generation-aware `adaptive`/legacy thinking |
| `@arnilo/prism-providers/google` | `google`; 3.x `thinkingLevel` sets, 2.5 budget ranges |
| `@arnilo/prism-providers/zai` | `reasoning_effort` (GLM-5.2/5.3 snap tables) + `thinking_type` toggle; Preserved Thinking via `reasoning_content` |
| `@arnilo/prism-providers/kimi` | K3: `reasoning_effort` (`low/high/max`); K2.x: `thinking_type` |
| `@arnilo/prism-providers/deepseek` | `reasoning_effort` (`low/high/max`) + `thinking_type` toggle; thinking on by default; tool turns must replay `reasoning_content` or the API returns 400 |
| `@arnilo/prism-providers/xai` | `reasoning_effort` with declared per-model ladders; `reasoning_content` replay still required |
| `@arnilo/prism-providers/clinepass` | `reasoning_effort` through per-model slot maps (`compat.thinkingLevelMap`); GLM `xhigh` passthrough, never `max` |
| `@arnilo/prism-providers/neuralwatt` | `reasoning_effort` (`low/medium/high/max`); budgets + preserve/clear thinking stay package-local |
| `@arnilo/prism-providers/hyper` | `reasoning_effort` derived from live `effort_levels`; snap instead of drop; Anthropic route emits `output_config.effort` |
| `@arnilo/prism-providers/commandcode` / `@arnilo/prism-providers/opencode-go` | Gateway level tables (`claude-*` → `output_config_effort`, `gpt-5.6*` → `openai_reasoning`, K3/DeepSeek/GLM → `reasoning_effort`, K2.x/MiniMax/Qwen → `thinking_type`) |
| `@arnilo/prism-providers/alibaba` | `thinking_type` mapped onto Qwen `enable_thinking` (toggle, no effort levels) |
| `@arnilo/prism-providers/ollama` | `reasoning_effort`; `gpt-oss*` declares `low/medium/high`; native `think` field never mixed in |
| `@arnilo/prism-providers/azure` / `.../vertex` / `.../bedrock` | OpenAI-compat sanitized forwarder (`reasoning_effort` / `reasoning` object), snapped to declared levels |
| `@arnilo/prism-providers/ai-sdk` | `noop` — host `LanguageModelV4` owns reasoning settings |

## Declared levels and snapping

Every reasoning-capable model in a first-party catalog declares its legal level set (`capabilities.thinkingLevels`) and, where meaningful, a `compat.thinkingFamily` stamp. The source of truth is the [thinking coverage evidence matrix](_evidence/thinking-coverage-2026-09-05.md) — generated from the compiled catalogs, with per-model source (API-derived vs doc-pinned) and the wire/live test that pins each row.

Snap semantics (`snapThinkingLevel`, applied by the adapter and by provider resolvers when the model declares a set):

1. The requested level is in the declared set → forwarded unchanged.
2. Below the declared minimum (typically `none`/`minimal` on a set without them) → snaps **up** to the minimum.
3. Otherwise → nearest declared level by ladder distance, **ties breaking up**.
4. Provider-documented tables (DeepSeek, Z.AI GLM-5.2/5.3, ClinePass slot maps, Kimi K3) are wire authority and take precedence over the generic rule.
5. Undeclared levels (opaque strings) on a reasoning-capable model → passthrough (forward compat); a non-reasoning model → options unchanged.

OpenRouter and Hyper derive their sets from each provider's models API (`supported_efforts` / `effort_levels`); all other catalogs are doc-pinned because those upstreams expose no enumeration API.

## Extension and configuration notes

- `thinkingFamilyForModel(model)` resolves a family without applying it; hosts that build their own options can use `thinkingCompatFor(family, level)` directly. `compat.thinkingFamily` on a model or request overrides all heuristics.
- For `openai_reasoning`, an existing `compat.reasoning.summary` (or other reasoning keys) is preserved when merging `effort`.
- Package-local knobs (`thinking_budget`, `thinking_token_budget`, `chat_template_kwargs`, `cacheRetention`-coupled switches) remain on `compat` — see each provider page.

## Security and performance notes

- Declared levels prevent 400s from illegal effort values on strict upstreams; snapping is deterministic and ladder-based, never a silent drop.
- `none` semantics are provider-specific (off, or minimum effort where off is unsupported — e.g. Anthropic Opus 5 cannot disable thinking at `xhigh`/`max`, GLM-5.3 cannot disable thinking at all); the per-provider pages call these out.
- No secrets or credentials flow through any helper here; patches are plain compat objects.

## Non-reasoning models

- The adapter returns options unchanged — no invented body fields.
- `thinking_type` + `none` sets `{ type: "disabled" }`; other levels set `{ type: "enabled" }` without encoding effort (compose with `reasoning_effort` when the API supports both).

## Related APIs

- [Provider caching](provider-caching.md) — cache retention can disable thinking on some providers (e.g. Z.AI / DeepSeek when `cacheRetention: "none"`)
- [Provider request policies](provider-request-policies.md) — `mergeProviderRequestOptions`
- [Use-case model selection](use-case-model-selection.md) — session vs worker/summary model binding (workers take `thinkingLevel`)
- [Agent/session runtime](agent-session-runtime.md) — prior-reasoning preservation across turns
- [Provider packages](provider-packages.md) — package boundaries and discovery
- Per-provider pages under [docs/providers](providers/) — declared levels, wire field, and snapping per provider
- [Thinking coverage evidence matrix](_evidence/thinking-coverage-2026-09-05.md) — per-model legality, source, and test pins
- [Review coverage (2026-07-17 provider validation)](_evidence/review-coverage-2026-07-17-provider-validation.md)
