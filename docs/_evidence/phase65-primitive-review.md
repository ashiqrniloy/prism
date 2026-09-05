# Phase 65 — Primitive review: thinking-effort primitives inventory + adapter design record

Primitive review for `plans/065-Provider-Thinking-Effort-Coverage.md` Task 1:
inventory every existing thinking/effort primitive, fix the adapter contract, and
assign primitives to the later tasks — so no task invents a primitive an existing
one already covers, and no provider-local logic gets duplicated into core.

## Inventory

### Core (`@arnilo/prism`)

| Module | Location | Verdict |
| --- | --- | --- |
| `THINKING_LEVELS` + `ThinkingLevel` | `src/thinking.ts:13-15` | **Reuse** — the portable ladder `none < minimal < low < medium < high < xhigh < max`. |
| `ThinkingCompatFamily` | `src/thinking.ts:19` | **Extend** — add `google`, `output_config_effort`; keep `openai_reasoning`, `reasoning_effort`, `thinking_type`, `noop` (back-compat; `thinking_type` is a live heuristic path for `compat.thinking`, do not remove). Family names must avoid the core boundary guard's forbidden provider literals (`core-boundaries.test.ts` bans `anthropic`, `zai`, `kimi`, `opencode`, … in `src/` runtime), so the effort family is named for its wire shape, `output_config_effort`, not the provider. |
| `isThinkingLevel` | `src/thinking.ts:22-24` | **Reuse** — declared-set membership check for known levels. |
| `normalizeThinkingLevel` | `src/thinking.ts:27-31` | **Reuse** — canonicalizes case/whitespace; opaque passthrough preserved. |
| `thinkingCompatFor` | `src/thinking.ts:34-56` | **Extend** — add cases for `google` → `{ thinkingLevel: level }` and `output_config_effort` → `{ output_config: { effort: level } }`. |
| `applyThinkingLevel` | `src/thinking.ts:60-86` | **Keep** — legacy family-first helper, unchanged for back-compat. New model-aware `applyThinkingLevelForModel` builds on `thinkingCompatFor` + `mergeProviderRequestOptions`. |
| `thinkingFamilyForModel` | `src/thinking.ts:89-106` | **Rewrite** — stamp-first (`compat.thinkingFamily`), Google heuristic (`compat.thinkingConfig` object → `google`), keep provider-id heuristics as fallback. |
| `mergeProviderRequestOptions` | `src/provider-request-policy.ts:49-75` | **Reuse** — the per-turn-wins compat merge the adapter and all providers already rely on. |
| `ModelConfig.compat` / `ModelCapabilities` | `src/contracts-core/content.ts:110-123` / `123-150` | **Extend** — add `capabilities.thinkingLevels?: readonly string[]`; stamp lives in `compat.thinkingFamily` (routing/behavior patch, like every other `compat` key). |
| Exports | `src/index.ts:615-623` | **Extend** — export the new helpers + new families. |
| `use-case-model.ts` | `src/use-case-model.ts:20` | **Reuse** — portable `thinkingLevel` field on use-case models feeds the adapter. |
| OpenAI-compatible base body | `src/providers/openai-compatible.ts` | **Keep unchanged** — does not spread `compat` (verified gap); wrappers own the mapping (task 6). |
| Conformance suite | `src/testing/provider-conformance.ts` | **Reuse** — task 15 extends it for thinking assertions. |

### Per-provider resolvers (`packages/prism-providers/src/*/thinking.ts`)

| Provider | Exports | Wire field | Verdict |
| --- | --- | --- | --- |
| anthropic | `anthropicThinking`, `anthropicEffort`, `anthropicPreserveThinking`, `stripAnthropicOwnedCompat` | `thinking`, `effort` (→ must become `output_config.effort`) | **Extend** — `anthropicEffort` gains `compat.output_config.effort` read; generation-aware thinking mapping; strip `output_config` (task 3). |
| clinepass | `CLINEPASS_THINKING_MAPS`, `clinePassThinkingSlot`, `clinePassThinkingLevelMap`, `clinePassReasoningEffort` | `reasoning_effort` | **Reuse resolver** — slot maps stay the wire authority; derive declared levels + stamp (task 8). |
| commandcode | `commandCodePreserveThinking`, `stripCommandCodeOwnedCompat` | route-dependent | **Extend** — per-upstream stamps/levels + resolved anthropic-route fields (task 11). |
| deepseek | `mapDeepseekEffort`, `deepseekThinking`, `deepseekReasoningEffort`, `deepseekReplayThinking` | `thinking`, `reasoning_effort` | **Reuse table** — `mapDeepseekEffort` is the documented snap table (overrides generic); pin + declared levels (task 7). |
| google | `googleThinkingConfig`, `googlePreserveThinking`, `stripGoogleOwnedCompat` | `generationConfig.thinkingConfig` | **Extend** — clamp `thinkingLevel` to declared set + 2.5 none→budget-0 policy (task 5). `googleThinkingConfig` already reads `compat.thinkingLevel` ✓. |
| hyper | `hyperReasoningEffort`, `hyperThinking`, `hyperPreserveThinking`, `stripHyperOwnedCompat` | `reasoning_effort` / anthropic route | **Extend** — snap to declared `thinkingLevels`, drop-outside-set → snap; anthropic-route hooks (task 10). |
| kimi | `kimiThinking`, `kimiReasoningEffort`, `kimiPreserveThinking`, `stripKimiThinkingCompat` | `thinking` (K2.x), `reasoning_effort` (K3) | **Extend** — snap to declared set (K3 medium→high etc.); declared levels + stamp (task 7). |
| neuralwatt | `neuralWattReasoningEffort`, `neuralWattThinkingTokenBudget`, `neuralWattChatTemplateKwargs`, `neuralWattToolChoice`, `neuralWattPreserveThinking`, `neuralWattClearThinking`, `stripNeuralWattOwnedCompat` | `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs` | **Extend** — snap when declared, passthrough else (task 13). |
| opencode-go | `openCodeGoPreserveThinking`, `openCodeGoThinking`, `openCodeGoReasoningEffort`, `openCodeGoReasoning`, `stripOpenCodeGoOwnedCompat` | route-dependent | **Extend** — per-upstream stamps/levels + shared-route switch (tasks 3, 11). |
| openrouter | `resolveOpenRouterReasoning`, `openRouterPreserveThinking`, `stripOpenRouterOwnedCompat` | `reasoning.effort` | **Extend** — snap to API-derived `supported_efforts` (task 9). |
| xai | `xaiReplayThinking` | — (currently none) | **Extend** — add `reasoning_effort` wire (grok-4.3/4.5/4.6) + per-model map (task 7). |
| zai | `zaiThinking`, `zaiReasoningEffort`, `zaiToolStream`, `zaiClearThinking`, `zaiPreserveThinking` | `thinking`, `reasoning_effort` | **Extend** — snap per GLM table; 5.3 constraints (task 7). |
| shared | `anthropicMessagesBody`, `anthropicMessagesEvents` (hooks) | — | **Extend** — `thinking`/`effort` hook slots emit resolved fields (task 3). |
| model-discovery | meta `list*Models` forwarder | — | **Reuse** — inherits each provider's mapping; no independent wire. |
| ai-sdk | host-owned `LanguageModelV4` | — | **Noop** — deliberate, docs note only (task 17). |

### Precedents that must be reused, not duplicated

- **Hyper `compat.effortLevels`** (`hyper/models.ts`) — the existing declared-set precedent on `compat`; the new `capabilities.thinkingLevels` is its capability-side mirror.
- **ClinePass slot maps** (`clinepass/thinking.ts`) — the existing per-model legality-table precedent; derived into declared levels (task 8), resolver untouched.
- **DeepSeek `mapDeepseekEffort`** (`deepseek/thinking.ts`) — the existing documented snap-table precedent.
- **phase55 `AnthropicMessagesRouteHooks`** (`shared/anthropic-messages.ts`) — hook-based shared serializer; task 3 adds `thinking`/`effort` hooks in the same pattern (no provider-name branching in shared code).

## Adapter design record

Authoritative contract for tasks 2+. Each later task cites this record.

### 1. Model metadata

```
ModelConfig.capabilities.thinkingLevels?: readonly string[]   // declared legal levels, ascending ladder order
ModelConfig.compat.thinkingFamily?: ThinkingCompatFamily       // explicit stamp; inference is stamp-first
```

- `thinkingLevels` is **advisory metadata** (host-facing legality), never a trust boundary — host `compat` stays passthrough-visible in `options.compat` for audit.
- `thinkingFamily` is a `compat` key like any other and must be stripped from every provider body (extend each `strip*OwnedCompat` list) so the stamp never reaches the wire.
- Stamps go on featured tables **and** discovery (`list*Models()`) mapping — same path used for OpenRouter/Hyper API-derived levels.

### 2. Level ordering + snap semantics

Ordering: `none < minimal < low < medium < high < xhigh < max`. Declared set `S` is an ordered subset.

For requested level `L` against model `M`:

| Case | Behavior |
| --- | --- |
| `L ∈ S` | forward `L` unchanged |
| `S` empty (undeclared) + `M` reasoning-capable | passthrough (forward-compat) |
| `S` empty + not reasoning-capable | options unchanged (no invented field) |
| `L` ranks below `min(S)` | **snap up to `min(S)`** (cannot-disable safety — never silently disable) |
| otherwise | **snap to the nearest declared level by ladder distance; ties break up** (toward more thinking) |

**Provider-documented snap tables override the generic rule.** DeepSeek (`medium/xhigh → high`), Z.AI GLM-5.2 (`low/medium → high`, `xhigh → max`, `minimal/none → off`), and ClinePass slot maps are upstream-verified and stay the wire authority in their resolvers; their declared levels are the host-facing mirror. This is the resolution of the plan's inconsistent wording ("snap down" vs "K3 medium → high"): generic = nearest/tie-up, tables win where documented.

### 3. Family table

| Family | `thinkingCompatFor` output | Read by |
| --- | --- | --- |
| `openai_reasoning` | `{ reasoning: { effort } }` | openai responses, openrouter, gateway openai routes |
| `reasoning_effort` | `{ reasoning_effort }` | chat-completions providers, hyper, gateway openai-chat routes |
| `thinking_type` | `{ thinking: { type: enabled/disabled } }` | **legacy heuristic path only** — never recommended for Anthropic (defect 2); kept for back-compat |
| `google` *(new)* | `{ thinkingLevel }` | `googleThinkingConfig` (already reads `compat.thinkingLevel` ✓) |
| `output_config_effort` *(new)* | `{ output_config: { effort } }` | `anthropicEffort` — **must gain `compat.output_config.effort` read (task 3)**; emits the live wire field, not the dead top-level `effort`. Named for the Anthropic Messages / anthropic-format wire shape, not the provider, to pass the core boundary guard (`core-boundaries.test.ts` bans the `anthropic` literal in `src/`). |
| `noop` | `{}` | ai-sdk and host-owned adapters |

**Not a core family:** Qwen/alibaba (`enable_thinking`) — single consumer, violates the `≥2 packages` rule in `src/thinking.ts`. Package-local resolver keyed off declared levels (task 12). Revisit only if a second package needs it.

### 4. `parseThinkingLevel(value)` trichotomy

| Input | Result |
| --- | --- |
| known level (case-insensitive) | canonical `ThinkingLevel` |
| other non-empty string | `{ opaque: value }` (forward-compat passthrough) |
| `undefined` / `null` / empty / non-string | `undefined` (fail-closed) |

### 5. `applyThinkingLevelForModel(options, level, model)` resolution order

1. Family = `compat.thinkingFamily` stamp → `thinkingFamilyForModel` inference → `capabilities.reasoning` fallback → `noop`.
2. Snap `L` to declared `thinkingLevels` (section 2).
3. Merge via `mergeProviderRequestOptions` (per-turn wins) using `thinkingCompatFor(family, snapped)`.
4. Non-reasoning model (no stamp, no levels, no reasoning) → return options unchanged.

### 6. Rules enforced across tasks

- **Providers own the wire field; core owns level legality.** Core never emits a provider wire field directly beyond `thinkingCompatFor` patch shapes; resolvers read `compat` and map to official fields exactly as today.
- No second options tree; no new dependency; `compat`-patch architecture retained.
- Snap, never silently drop, never forward verbatim-illegal — the report's two failure modes.

## Primitive assignments per task

| Task | Consumes (reuse) | Adds |
| --- | --- | --- |
| 2 core contract | `THINKING_LEVELS`, `isThinkingLevel`, `normalizeThinkingLevel`, `thinkingCompatFor`, `mergeProviderRequestOptions` | `capabilities.thinkingLevels`, `compat.thinkingFamily`, `google`/`output_config_effort` families, `parseThinkingLevel`, `isSupportedThinkingLevel`, `snapThinkingLevel`, `thinkingLevelsForModel`, `applyThinkingLevelForModel` |
| 3 anthropic + shared route | `anthropicEffort`, `anthropicThinking`, `AnthropicMessagesRouteHooks` | `output_config.effort` read/emit, generation-aware thinking, hook slots |
| 4 openai | `applyThinkingLevelForModel` snap | family tables + stamps in catalog |
| 5 google | `googleThinkingConfig` | level sets + 2.5 budget policy + stamps |
| 6 azure/vertex/bedrock | — | openAI-compat body-extra wiring |
| 7 kimi/zai/deepseek/xai | `mapDeepseekEffort` (table), generic snap | declared levels + stamps + xai wire |
| 8 clinepass | `CLINEPASS_THINKING_MAPS` | derived declared levels + stamp |
| 9 openrouter | generic snap | API-derived levels |
| 10 hyper | generic snap | API-derived levels + anthropic hooks |
| 11 commandcode/opencode-go | task 3 hooks, generic snap | per-upstream stamps + route resolution |
| 12 alibaba | generic level→on/off | package-local resolver + levels |
| 13 ollama/neuralwatt | generic snap | declared levels when known |
| 14 memory workers | `applyThinkingLevelForModel` | helper swap (replaces `thinkingFamilyForModel` guess) |
| 15 conformance | `thinkingLevelsForModel`, conformance suite | catalog-wide assertions + evidence |
| 17 docs | all | api-page rewrite + provider pages |

## Consumers confirmed (task 14 target)

- `packages/memory/src/compaction/llm/strategy.ts:168-177` — `thinkingFamilyForModel` + `applyThinkingLevel(options, level, family)`.
- `packages/memory/src/compaction/observational-memory/worker-loop.ts:50-58` — same pattern.
- `src/use-case-model.ts:20` — portable `thinkingLevel` field source.

## Decisions (resolved plan ambiguities)

1. **Snap semantics** — generic nearest/tie-up + provider tables override (section 2); fixes the plan's internal wording conflict.
2. **No core `qwen` family** — single consumer; package-local (section 3).
3. **`thinking_type` retained** — live `compat.thinking` heuristic path; not removed, but never the Anthropic recommendation.
4. **`RunOptions.thinkingLevel` not added** — YAGNI; hosts use `applyThinkingLevelForModel` (task 14 records).
5. **xAI supersession** — prior "replay-only" assumption (never send `reasoning_effort`) is wrong; grok-4.3/4.5/4.6 docs accept `reasoning_effort`. Heuristic 6 in `thinkingFamilyForModel` (`capabilities.reasoning → reasoning_effort`) becomes moot for xai once stamps land.

## Follow-up

- `thinking_type` family: revisit removal when `compat.thinking`-keyed models are migrated off it (no in-repo consumers found that need it on Anthropic).
- Anthropic top-level `effort` vs `output_config.effort`: live probe (task 16) decides whether a dual-emit shim is needed before release.
