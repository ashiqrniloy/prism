# 065 — Full Thinking / Reasoning-Effort Coverage Across All Prism Providers

## Objectives

- Close every gap in the portable `ThinkingLevel` contract identified in `2026-09-05-prism-thinking-level-gaps-report.md` (silent Gemini no-op, Anthropic wire-rejected `thinking_type` bodies, missing per-model legality declarations, missing host validation helper) **plus the additional gaps found in this plan's code audit**: azure/bedrock/vertex never forward thinking compat to the wire, the shared Anthropic-Messages route (hyper/commandcode/opencode-go) drops thinking/effort entirely, xAI never sends `reasoning_effort` although upstream supports it, and the Anthropic effort wire field has moved to `output_config.effort`.
- Guarantee the contract the user mandated: **when a host sets a reasoning/thinking level for a reasoning-capable model, a legal effort field always reaches the provider wire** — never silently dropped, never a value the upstream API rejects (400/500).
- Make per-model accepted levels **machine-readable**: every first-party model catalog declares `capabilities.thinkingLevels`, sourced from live provider APIs where the API exposes them (Hyper `reasoning.effort_levels`, OpenRouter `reasoning.supported_efforts`) and from hardcoded official-docs tables where no enumeration API exists (OpenAI, Anthropic, Google, Kimi, Z.AI, DeepSeek, xAI, Qwen/Alibaba, ClinePass, Ollama).
- Keep provider-owned wire shapes: one **common core adapter** (family + level resolution, snapping, validation) consumed by the existing per-provider `thinking.ts` resolvers — no second options tree, no new dependency.

## Expected Outcome

- `applyThinkingLevelForModel(options, level, model)` (plus `parseThinkingLevel`, `isSupportedThinkingLevel`, `snapThinkingLevel`, `thinkingLevelsForModel`) exported from `@arnilo/prism`; compaction/observational-memory workers and hosts use it so a chosen level is always applied for every reasoning-capable model.
- Every model registered by a `@arnilo/prism-providers` catalog (static featured tables and `list*Models()` discovery) carries `capabilities.thinkingLevels` and a `compat.thinkingFamily` stamp; `thinkingFamilyForModel` is stamp-first, heuristics only as fallback.
- Every provider request builder emits the official effort field for its route (see Research Matrix below), clamped to the model's declared levels; raw compat values that are illegal for the model are snapped or omitted, never forwarded verbatim.
- Anthropic-routed bodies are wire-legal: `output_config.effort` for effort, `thinking: {type:"adaptive"}` on adaptive generations, budget guard for legacy `enabled`; no bare `{type:"enabled"}` without `budget_tokens`.
- A generated evidence matrix (provider × model → family, levels, levels source, wire assertion, test) plus conformance tests prove the coverage; live suites assert upstream acceptance of the emitted fields.
- `docs/thinking-and-reasoning.md` rewritten to the actual contract; per-provider pages updated; `docs/index.md` and `CHANGELOG.md` updated.

## Research Matrix (2026-09-05, per-provider official wire contracts)

Levels source: **API** = live provider model endpoint enumerates accepted efforts; **hardcoded** = official docs tables baked into catalogs (no enumeration API exists).

| Provider (package) | Route / wire field(s) | Accepted levels per model | Source |
| --- | --- | --- | --- |
| openai (Responses) | `reasoning.effort` | gpt-5/gpt-5-mini/gpt-5-nano: minimal, low, medium (default), high; gpt-5.1 (+codex): none (default), low, medium, high; gpt-5.2: none, low, medium (default), high, xhigh; o1/o3/o4-mini: low, medium (default), high; o1-mini: none | hardcoded — https://developers.openai.com/api/docs/guides/reasoning + per-model pages (`/api/docs/models/gpt-5.1`: "Reasoning.effort supports: none (default), low, medium, and high") |
| anthropic (Messages) | `thinking: {type:"adaptive"}` (4.6+, Sonnet 5, Fable/Mythos; recommended; `enabled`+`budget_tokens` rejected on 4.7+), `thinking: {type:"enabled", budget_tokens}` (≤4.5 only), `output_config.effort` (per SDK `MessageCreateParamsBase`: no top-level `effort` field) | low, medium, high (default) everywhere; +max (no xhigh): mythos-preview, opus-4-6, sonnet-4-6; +xhigh+max: fable-5(-1), mythos-5(-1), opus-5, opus-4-8, opus-4-7, sonnet-5; opus-4-5-20251101: low/medium/high only | hardcoded — https://platform.claude.com/docs/en/build-with-claude/effort.md, /extended-thinking, /thinking-troubleshooting |
| google (generateContent) | `generationConfig.thinkingConfig.thinkingLevel` (Gemini 3.x), `thinkingBudget` (2.5: 0 disables on flash/lite, pro cannot disable, -1 dynamic), `includeThoughts` | 3.8/3.7-flash: low, medium (default), high; 3.6/3.5-flash, 3.5/3.1-flash-lite, 3-flash: minimal, low, medium, high; 3.1-pro: low, medium, high (default high); 3.1-flash-lite-image: minimal, high; 3-pro: low, high; 2.5: no thinkingLevel (budget only) | hardcoded — https://ai.google.dev/gemini-api/docs/generate-content/thinking |
| azure (OpenAI-compat chat) | `reasoning_effort` (deployment = OpenAI model) | same as the deployed OpenAI model | hardcoded openai table — https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning |
| vertex (OpenAPI chat) | `reasoning_effort` (gemini: low→1024, medium→8192, high→24576 budget) or `extra_body.google.thinking_config` | gemini: low, medium, high | hardcoded — https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai |
| bedrock (OpenAI-compat `/openai/v1`) | `reasoning_effort` (snake_case; OpenAI models on Bedrock) | same as the upstream OpenAI model | hardcoded openai table — https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-openai.html |
| kimi | K3: top-level `reasoning_effort`; K2.x: `thinking: {type:"enabled"\|"disabled"}` (K2.6 also `keep:"all"`); k2.7-code: always on, only `{type:"enabled",keep:"all"}` accepted | kimi-k3: low, high, max (default max; Kimi Code default high); kimi-k2.6: low, medium, high; k2.5/k2.7-code: on/off | hardcoded — https://platform.kimi.ai/docs/api/models-overview, /guide/use-reasoning-effort |
| zai | `thinking: {type:"enabled"\|"disabled"}`; `reasoning_effort` GLM-5.2+ only | glm-5.2: none/minimal → stop thinking, low/medium → high, high, xhigh → max, max (default); glm-5.3/5.3-flash: low, high, max only, cannot disable thinking; glm-4.5–5.1: auto (enabled), 4.7 forced | hardcoded — https://docs.z.ai/guides/capabilities/thinking |
| deepseek | `thinking: {type:"enabled"\|"disabled"}` + `reasoning_effort` | low, high (default), max; medium/xhigh → high; none → off (thinking toggle) | hardcoded — https://api-docs.deepseek.com/api/create-chat-completion/ |
| xai | `reasoning_effort` (Chat Completions) / `reasoning.effort` (Responses) — **currently never sent by Prism** | grok-4.3: none (default), low, medium, high; grok-4.5: low, medium, high (default high; cannot disable); grok-4.6: low, medium, high (default), xhigh; grok-build: configurable default | hardcoded — https://docs.x.ai/developers/model-capabilities/text/reasoning |
| openrouter | `reasoning: {effort}` (max, xhigh, high, medium, low, minimal, none) or `reasoning.max_tokens` | models API: `reasoning.supported_efforts[]`, `default_effort`, `mandatory` | **API** — https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties (Model.reasoning) |
| hyper | `reasoning_effort` (live catalog `reasoning.effort_levels` + `default_effort_level`; featured snapshot already carries `compat.effortLevels`) | per-model, e.g. deepseek-v4: high, xhigh; gpt-oss-120b: none…max; kimi-k3: low, high, max | **API** — https://hyper.charm.land/docs/models.html (effort levels in `/v1/models`) |
| clinepass | `reasoning_effort` via per-model slot maps (GLM/KIMI/K3/DEEPSEEK/STANDARD; GLM `xhigh` passthrough, never `max`; K3 `high`→`max`) | derived from `CLINEPASS_THINKING_MAPS` | hardcoded slot tables (existing) → invert to declared levels |
| alibaba (Qwen) | `enable_thinking` (hybrid; extra top-level field in OpenAI-compat JSON) + `thinking_budget` (Qwen3.5–3.8, Qwen3-VL, GLM, Kimi series); thinking-only models (Qwen3-Thinking, QwQ) always think | on/off (+ budget passthrough); qwen3.5/3.6/3.7 default on | hardcoded — https://help.aliyun.com/en/model-studio/deep-thinking, https://docs.qwencloud.com/developer-guides/text-generation/thinking |
| ollama | `reasoning_effort` on `/v1/chat/completions` (native `think` field has a disjoint value set — do not mix) | gpt-oss: low, medium, high; qwen3/deepseek-r1: passthrough | hardcoded featured + passthrough — https://docs.ollama.com/api/openai-compatibility, ollama/ollama#14821 |
| neuralwatt | `reasoning_effort` + `thinking_token_budget` (vLLM-style) | catalog `reasoning_effort` default on reasoning models; passthrough | hardcoded catalog + passthrough |
| commandcode (gateway) | route-dependent: anthropic → thinking + `output_config.effort`; openai → `reasoning_effort` / `reasoning` raw passthrough | mirror upstream families: claude-*, gpt-5.6, deepseek-v4, Kimi K2.x/K3, GLM-5.3, MiniMax M3/M2.x, Qwen3.8, gemini-3.x, grok-4.5/4.6, mimo | hardcoded mirror of upstream tables — https://commandcode.ai/docs |
| opencode-go (gateway) | route-dependent (MiniMax/Qwen → Anthropic Messages; others → OpenAI chat) | glm-5.2: reasoning_effort max; glm-5.1/4.x: thinking; kimi-k3: low/high/max; kimi-k2.6/k2.5: thinking; grok-4.5: reasoning_effort; deepseek-v4: low/high/max; minimax-m3/m2.x + qwen3.6/3.7: Anthropic-route `thinking` (verify M3 request schema at impl — docs show thinking content blocks but request-side schema is sparse) | hardcoded mirror — https://opencode.ai/docs/go/ |
| ai-sdk | host-owned `LanguageModelV4` reasoning settings | noop by contract | deliberate — docs note only |
| model-discovery | meta: forwards provider `list*Models` | inherits each provider's mapping | n/a (no independent wire) |

Code-audit gaps confirmed in this repo (2026-09-05, current `main`):

| Gap | Location |
| --- | --- |
| No `google` family; Gemini levels silently no-op via the documented adapter path | `src/thinking.ts` (families), `packages/prism-providers/src/google/thinking.ts` (`thinkingLevel` alias exists but no family produces it) |
| `thinking_type` → bare `{type:"enabled"}` without `budget_tokens` (Anthropic 400); Anthropic effort wire is now `output_config.effort`, Prism emits top-level `effort` | `src/thinking.ts`, `packages/prism-providers/src/anthropic/messages.ts`, `anthropic/thinking.ts` |
| Azure/bedrock/vertex wrap `createOpenAICompatibleProvider` with **no** `buildBodyExtra`/`transformBody`; base `toOpenAIRequest` never spreads `options.compat` → all thinking compat silently dropped | `src/providers/openai-compatible.ts`, `packages/prism-providers/src/{azure,bedrock,vertex}/provider.ts` |
| Shared `anthropicMessagesBody` (hyper, commandcode) spreads `compatRest` but resolves/emits **no** `thinking`/`effort` fields; hyper's `stripHyperOwnedCompat` additionally strips `thinking` from compat | `packages/prism-providers/src/shared/anthropic-messages.ts`, `hyper/thinking.ts`, `commandcode/thinking.ts` |
| opencode-go private Anthropic-route copy has the same omission | `packages/prism-providers/src/opencode-go/anthropic-messages.ts` |
| xai `xaiTransform` emits no `reasoning_effort`; upstream docs say grok-4.3/4.5/4.6 accept it | `packages/prism-providers/src/xai/provider.ts` |
| `kimiReasoningEffort` / `zaiReasoningEffort` forward host values verbatim (e.g. K3 `medium` → API error; GLM-4.6 `reasoning_effort` → not accepted) | `kimi/thinking.ts`, `zai/thinking.ts` |
| Kimi K3 default `reasoning_effort: "high"` on the coding route conflicts with the Open Platform default `max` handling | `kimi/models.ts` vs platform docs |
| No per-model declared levels anywhere except Hyper `compat.effortLevels` and ClinePass slot maps | all `models.ts` |
| `thinkingFamilyForModel` heuristic 6 (`capabilities.reasoning` → `reasoning_effort`) invents fields for xai (historically replay-only) — now moot once xai gets real stamps | `src/thinking.ts` |

---

## Tasks

- [x] 1. Primitive review: thinking-effort primitives inventory + adapter design record
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase65-primitive-review.md` inventories every existing thinking primitive (core `THINKING_LEVELS`/`thinkingCompatFor`/`applyThinkingLevel`/`thinkingFamilyForModel`/`normalizeThinkingLevel`/`isThinkingLevel`; the 12 per-provider `thinking.ts` resolvers; `mergeProviderRequestOptions`; Hyper `effortLevels`; ClinePass slot maps; DeepSeek effort snapping) and states exactly which new shared primitives are required and which provider-local logic must **not** be duplicated into core.
    - Functional: design record fixes the adapter contract: `capabilities.thinkingLevels?: readonly string[]` declaration, `compat.thinkingFamily` stamp, level ordering (`none < minimal < low < medium < high < xhigh < max`), snap-down/up-to-minimum semantics, and the rule "provider resolvers own the wire field; core owns level legality".
    - Performance: no production code changes in this task; document-only.
    - Code Quality: every later task cites this record; no new primitive proposed that an existing one already covers (reuse `normalizeThinkingLevel`, `mergeProviderRequestOptions`).
    - Security: record states that declared levels are advisory metadata on `ModelConfig`, never a trust boundary; host-supplied compat stays passthrough-visible in `options.compat` for audit.
  - Approach:
    - Documentation Reviewed:
      - `src/thinking.ts` (current families + heuristics), `src/provider-request-policy.ts` (`mergeProviderRequestOptions`), `docs/thinking-and-reasoning.md`, `packages/prism-providers/src/*/thinking.ts` (12 files), `hyper/models.ts` (`effortLevels` precedent), `clinepass/thinking.ts` (slot-map precedent), `deepseek/thinking.ts` (`mapDeepseekEffort` snapping precedent), `2026-09-05-prism-thinking-level-gaps-report.md`.
    - Options Considered:
      - New provider-agnostic "effort" object tree (rejected — second options tree, exactly what current docs forbid).
      - Per-provider adapters only, no core change (rejected — leaves `applyThinkingLevel` host path broken for google/anthropic, no shared legality enforcement).
      - Core adapter + provider resolvers + per-model declarations (chosen — one legality mechanism, wire shapes stay provider-owned).
    - Chosen Approach: extend the existing `compat`-patch architecture with (a) declared levels, (b) family stamps, (c) a model-aware adapter + snap helper in core; providers keep reading official fields from `compat` exactly as today.
    - API Notes and Examples:
      ```ts
      // Target core surface (task 2 implements):
      model.capabilities.thinkingLevels        // readonly string[], declared per model
      model.compat.thinkingFamily             // explicit stamp, stamp-first inference
      parseThinkingLevel(v)                   // ThinkingLevel | { opaque: string } | undefined
      isSupportedThinkingLevel(model, level) // boolean, declared-set membership
      snapThinkingLevel(model, level)        // nearest declared level (snap down; up to min)
      applyThinkingLevelForModel(opts, level, model) // family from model + snapped level
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase65-primitive-review.md`: new evidence record (inventory, contract, per-task primitive assignments).
    - References:
      - `docs/thinking-and-reasoning.md`; report items 1–4; precedent: `docs/_evidence/phase55-primitive-review.md` (shared Anthropic route extraction record).
  - Test Cases to Write:
    - None (document task); task 2 tests encode the contract decisions recorded here.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (design record for a new public API in task 2).
    - Docs pages to create/edit: `docs/_evidence/phase65-primitive-review.md` (evidence, not indexed).
    - `docs/index.md` update: no (evidence artifact).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Core contract: model-aware thinking adapter, declared levels, new families
  - Acceptance Criteria:
    - Functional: `ModelCapabilities` gains `thinkingLevels?: readonly string[]`; `thinkingCompatFor` supports new families `google` → `{ thinkingLevel: level }` and `output_config_effort` → `{ output_config: { effort: level } }`; `thinkingFamilyForModel` is stamp-first (`compat.thinkingFamily`), adds a Google heuristic (`compat.thinkingConfig` object → `google`), and Anthropic-route heuristics (`provider` `anthropic`/known anthropic-routed gateways do **not** get hardcoded literals — only the stamp; heuristics keep current provider-id rules).
    - Functional: new exports `parseThinkingLevel(value)`, `isSupportedThinkingLevel(model, level)`, `snapThinkingLevel(model, level)`, `thinkingLevelsForModel(model)`, and `applyThinkingLevelForModel(options, level, model)`; the adapter resolves the family (stamp → inference → `capabilities.reasoning` fallback) and snaps the level per the design record (`docs/_evidence/phase65-primitive-review.md` §2: in-set → forward; below-minimum → **up to minimum**; else nearest by ladder distance, ties break up; provider-documented tables — deepseek/zai/clinepass — override the generic rule; undeclared + reasoning-capable → passthrough; non-reasoning model → options unchanged), and never emits a field for a model that declares no levels and no reasoning capability.
    - Functional: `applyThinkingLevel` (legacy) keeps current behavior; the `thinking_type` family for `none` still yields `disabled`; compaction worker fallback semantics (never inert for explicit host levels) are preserved by the new adapter.
    - Performance: pure functions, no I/O; adapter merge ≤ 1 µs typical; no new dependency.
    - Code Quality: exhaustive switch preserved (`never` check); all helpers typed against `ThinkingLevel`; exports added to `src/index.ts`; `src/__tests__/thinking.test.ts` extended; biome lint + tsc clean.
    - Security: `parseThinkingLevel` fail-closed on non-strings/empty; no secret-shaped values involved.
  - Approach:
    - Documentation Reviewed:
      - Report items 1 (google family), 3 (declared levels + `isSupportedThinkingLevel`), 4 (`parseThinkingLevel`); `src/thinking.ts`; `src/contracts.ts` (`ModelCapabilities`); `src/index.ts` export block; `packages/memory/src/compaction/llm/strategy.ts` (adapter consumer); upstream snapping precedents: DeepSeek (`medium/xhigh → high`), Z.AI GLM-5.2 (`low/medium → high`, `xhigh → max`) — snapping is upstream-native, not invented.
    - Options Considered:
      - Error on unsupported level (rejected — makes legal-value snapping impossible for hosts that want "always send something"; hosts get strictness via `isSupportedThinkingLevel` instead).
      - Drop illegal levels silently (rejected — recreates the report's silent-drop failure mode).
      - Snap to nearest legal level (chosen — preserves the mandate "always maintained and sent properly"; matches upstream snapping behavior).
    - Chosen Approach: snap semantics + declared sets + stamp-first inference; legacy helpers untouched for back-compat.
    - API Notes and Examples:
      ```ts
      const opts = applyThinkingLevelForModel(base, "medium", gemini35Flash);
      // → compat: { thinkingLevel: "medium" }   (google family, declared minimal..high)
      const opts2 = applyThinkingLevelForModel(base, "medium", kimiK3);
      // → compat: { reasoning_effort: "high" }   (snapped: K3 declares low/high/max)
      parseThinkingLevel("Max");   // "max"
      parseThinkingLevel("turbo"); // { opaque: "turbo" }
      parseThinkingLevel("");      // undefined
      ```
    - Files to Create/Edit:
      - `src/thinking.ts`: new families, stamps, snap/parse/apply helpers, inference updates.
      - `src/contracts.ts`: `ModelCapabilities.thinkingLevels`.
      - `src/index.ts`: export new helpers + `ThinkingCompatFamily` extension.
      - `src/__tests__/thinking.test.ts`: adapter, snap, parse, family, and regression tests.
    - References:
      - Task 1 design record `docs/_evidence/phase65-primitive-review.md` (inventory, contract, snap semantics, family table); `docs/thinking-and-reasoning.md` (rewrite lands in task 17).
  - Test Cases to Write:
    - `applyThinkingLevelForModel` on a google-stamped model → `thinkingLevel` patch reaches compat (defect 1 regression).
    - Snap down (medium on low/high/max model → high) and snap up to minimum (none on always-on model → low).
    - Undeclared reasoning-capable model → passthrough (forward compat); non-reasoning model → unchanged options.
    - `parseThinkingLevel` known/opaque/invalid trichotomy; `isSupportedThinkingLevel` true/false/undeclared.
    - Stamp beats heuristic; `compat.thinkingConfig` object → `google` family.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public helpers, capability field, families.
    - Docs pages to create/edit: `docs/thinking-and-reasoning.md` (full rewrite in task 17; this task only notes pending).
    - `docs/index.md` update: yes, in task 17 (entry already exists for the page — description update only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 3. Anthropic package + shared Anthropic-Messages route: adaptive thinking, `output_config.effort`, per-model levels
  - Acceptance Criteria:
    - Functional: `anthropicMessagesBody` emits `output_config: { effort }` (read from `compat.effort` / `compat.reasoning_effort` / `compat.output_config.effort`, request-wins); the current top-level `effort` emission is replaced after live verification (task 16 live probe).
    - Functional: `anthropicThinking` maps per model generation: adaptive-generation models (opus-4.6+, sonnet-4-6+, fable/mythos, opus-5) get `{ type: "adaptive" }` when a thinking request arrives without a budget; legacy models (≤ opus-4-5 / sonnet-4-5 / haiku-4-5) get `{ type: "enabled", budget_tokens: <default> }` with a model default budget when none supplied — bare `{type:"enabled"}` without budget can no longer reach the wire (defect 2 fixed at the wire).
    - Functional: shared `anthropicMessagesBody(request, hooks)` gains hook slots `thinking` / `effort` (resolved fields emitted after `compatRest`, same precedence pattern as the anthropic package); hyper + commandcode hooks resolve via their own thinking resolvers; opencode-go's private copy is switched to the shared serializer (deleting the duplicate, per phase55 primitive direction).
    - Functional: `anthropic/models.ts` featured + `mapAnthropicModel` declare `thinkingLevels` and `compat.thinkingFamily: "output_config_effort"` per the Research Matrix; illegal effort values snap via the core helper inside `anthropicEffort`.
    - Performance: no new I/O; body build unchanged cost.
    - Code Quality: `stripAnthropicOwnedCompat` extended to strip `output_config`; hooks typed; existing tests updated; no behavior change for budget-passthrough hosts.
    - Security: no compat keys leak into opaque body spread (strip covers all owned keys).
  - Approach:
    - Documentation Reviewed:
      - https://platform.claude.com/docs/en/build-with-claude/effort.md (per-model effort sets; `output_config.effort`; "adaptive is a mode, not an effort level"; Opus 5 cannot disable at xhigh/max), /extended-thinking (enabled+budget deprecated 4.6, rejected 4.7+), /thinking-troubleshooting; anthropic-sdk-python `message_create_params.py` (no top-level `effort`; `output_config: OutputConfigParam`); DeepSeek Anthropic-format table (`output_config.effort`) corroborating the wire field.
    - Options Considered:
      - Keep top-level `effort` (rejected — current SDK schema + docs show `output_config.effort`; live probe in task 16 confirms before release).
      - Inject default budget only, keep `enabled` (rejected — 4.7+ models reject `enabled` outright; adaptive is required).
      - Per-generation mapping + adaptive default + budget guard (chosen).
    - Chosen Approach: model-generation table in `anthropic/models.ts` drives both the wire shape and declared levels; resolvers centralize the mapping.
    - API Notes and Examples:
      ```json
      // opus-4-8, host sets "medium":
      { "thinking": { "type": "adaptive" }, "output_config": { "effort": "medium" } }
      // opus-4-5 (legacy, no budget supplied):
      { "thinking": { "type": "enabled", "budget_tokens": 1024 } }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/anthropic/thinking.ts`, `messages.ts`, `models.ts` (declared levels + generation table + stamps).
      - `packages/prism-providers/src/shared/anthropic-messages.ts` (hooks + resolved emission).
      - `packages/prism-providers/src/opencode-go/anthropic-messages.ts`: delete (switch to shared).
      - `packages/prism-providers/src/{hyper,commandcode}/thinking.ts` + `provider.ts` hooks; opencode-go route switch.
      - Provider test files under `packages/prism-providers/src/__tests__/` (or per-package `__tests__` as laid out in repo).
    - References:
      - Report defect 2; Research Matrix rows anthropic/hyper/commandcode/opencode-go.
  - Test Cases to Write:
    - Adaptive model + effort only → `output_config.effort` + `thinking: {type:"adaptive"}`.
    - Legacy model + effort → `enabled` + injected default budget.
    - Host passes `{thinking:{type:"enabled"}}` without budget → never on the wire bare (adaptive or budget injected).
    - Shared route (fake hooks) emits resolved thinking/effort; hyper/commandcode bodies contain them; compat keys stripped.
    - Declared levels: `isSupportedThinkingLevel(opus46, "xhigh") === false` and snap `xhigh → high`.
    - opencode-go anthropic-route body identical (golden) to its previous private-copy output except the added resolved fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — wire field change (`effort` → `output_config.effort`), hooks interface, declared levels.
    - Docs pages to create/edit: `docs/providers/anthropic.md`, `docs/providers/hyper.md`, `docs/providers/commandcode.md`, `docs/providers/opencode-go.md` (task 17 batch), migration note in `docs/migrate-to-0.6.md`.
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 4. OpenAI package: per-family effort tables, catalog stamps, Responses clamp
  - Acceptance Criteria:
    - Functional: `openai/models.ts` maps model ids to declared `thinkingLevels` + `compat.reasoning` default effort per the Research Matrix (gpt-5* minimal…high default medium; gpt-5.1 none default; gpt-5.2 none…xhigh default medium; o1/o3/o4-mini low…high default medium; codex variants follow gpt-5.1 table; unknown ids keep heuristic: reasoning-capable → passthrough).
    - Functional: `resolveOpenAIReasoning` snaps the requested effort to the model's declared set (core helper) before merging into the body `reasoning` object; per-turn compat still wins key-by-key; `summary` preservation unchanged.
    - Functional: codex subscription aliases (`gpt-5.1-codex`) get the same stamps.
    - Performance: id-shape checks are regex-free where possible (startsWith/endsWith); no I/O.
    - Code Quality: effort tables colocated with the existing cache-retention heuristics in `openai/models.ts`; tests cover each family; no new dependency.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed:
      - https://developers.openai.com/api/docs/guides/reasoning (values none/minimal/low/medium/high/xhigh/max, "model-dependent", defaults model-dependent); https://developers.openai.com/api/docs/models/gpt-5.1 ("none (default), low, medium, high"); modelparams.dev reasoning_effort table (gpt-5.2 default medium + xhigh; o-series); current `openai/models.ts` heuristics block.
    - Options Considered:
      - Query efforts from an API (rejected — OpenAI has no per-model effort enumeration endpoint; docs confirmed "check the relevant model page").
      - Hardcoded family tables (chosen — the only available source).
    - Chosen Approach: family tables from official model pages, applied both to featured aliases and `listOpenAIModels()` discovery.
    - API Notes and Examples:
      ```json
      { "model": "gpt-5.2", "reasoning": { "effort": "xhigh" } }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/openai/models.ts` (effort tables + stamps), `responses.ts` (snap in `resolveOpenAIReasoning`), `codex.ts` (stamp passthrough if separate), tests.
    - References:
      - Research Matrix row openai; task 2 core helper.
  - Test Cases to Write:
    - gpt-5.1 + "xhigh" → snapped "high"; gpt-5.2 + "xhigh" → forwarded; gpt-5.1 + "none" → forwarded (non-thinking mode).
    - Effort merge preserves `reasoning.summary`; per-turn compat beats model default.
    - `listOpenAIModels`-mapped model carries declared levels.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (declared levels, snapping).
    - Docs pages to create/edit: `docs/providers/openai.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. Google package: per-model thinkingLevel sets, 2.5 budget policy, level clamp
  - Acceptance Criteria:
    - Functional: `google/models.ts` declares `thinkingLevels` per the Research Matrix (3.x rows) and stamps `compat.thinkingFamily: "google"`; 2.5 models declare no `thinkingLevel` levels but document budget support via compat.
    - Functional: `googleThinkingConfig` clamps `thinkingLevel` to the model's declared set (snap via core helper); `none` maps to `thinkingBudget: 0` for models that support disabling (2.5 flash/lite) and to the minimum level for models that cannot disable (2.5 pro, 3.1 pro); unsupported `thinkingLevel` on a 2.5 model is dropped (budget-only models).
    - Functional: a host following the documented adapter path (`applyThinkingLevelForModel(..., geminiModel)`) now lands `generationConfig.thinkingConfig.thinkingLevel` on the wire (defect 1 end-to-end regression).
    - Performance: unchanged (object build only).
    - Code Quality: keep `thinkingConfig` object passthrough precedence (request > model); `stripGoogleOwnedCompat` covers `thinkingFamily` stamp key.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed:
      - https://ai.google.dev/gemini-api/docs/generate-content/thinking (full per-model thinkingLevel table; disable via `thinkingBudget = 0`; 2.5 budget ranges 128–32768 pro / 0–24576 flash / 512–24576 lite; -1 dynamic; includeThoughts summaries); current `google/thinking.ts` alias reads.
    - Options Considered:
      - Map portable levels to numeric budgets everywhere (rejected — 3.x models are level-native; budget is the 2.5-only escape).
      - Level-native for 3.x + budget policy for 2.5 (chosen).
    - Chosen Approach: level tables for 3.x; explicit none→budget-0 policy where disabling is supported.
    - API Notes and Examples:
      ```json
      { "generationConfig": { "thinkingConfig": { "thinkingLevel": "low", "includeThoughts": true } } }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/google/models.ts`, `thinking.ts`, `generate-content.ts` (clamp + none policy), tests.
    - References:
      - Report defect 1; Research Matrix row google.
  - Test Cases to Write:
    - Adapter path: `applyThinkingLevelForModel` on gemini-3.5-flash → wire `thinkingConfig.thinkingLevel`.
    - 3.1-pro + "minimal" → snapped to "low" (minimal unsupported).
    - 2.5-flash + "none" → `thinkingBudget: 0`; 2.5-pro + "none" → level dropped / budget omitted (cannot disable) with min-level semantics documented.
    - Unknown gemini id (discovery-mapped) → passthrough when declared absent, reasoning-gated.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/providers/google.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Azure, Vertex, Bedrock: wire compat through the OpenAI-compatible wrapper
  - Acceptance Criteria:
    - Functional: all three wrappers pass `buildBodyExtra`/`transformBody` so `options.compat.reasoning_effort` (string) and `options.compat.reasoning` (object) reach the chat-completions body — sanitized: only recognized thinking keys spread, everything else dropped (no opaque compat leak); today's silent drop is fixed.
    - Functional: effort values snap to the model's declared levels when the host-registered model carries them; azure deployments map to the OpenAI family table via `defineXModel` stamps or provider-id heuristics; vertex gemini models snap to low/medium/high; bedrock OpenAI models snap to the openai table.
    - Functional: base `createOpenAICompatibleProvider` (core) stays unchanged — wrappers own the mapping (no core behavior change for other consumers).
    - Performance: body build adds one object spread; negligible.
    - Code Quality: one shared helper (in `packages/prism-providers/src/shared/` or a small local util) builds the compat body-extra for the three; each wrapper stays < 10 changed lines; tests per wrapper.
    - Security: sanitized spread — no arbitrary compat keys on the wire; auth/signing paths untouched.
  - Approach:
    - Documentation Reviewed:
      - https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning (reasoning_effort supported for GPT-5/o-series deployments); https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai (reasoning_effort low/medium/high ↔ budgets; conflict rule with `extra_body.google.thinking_config`); https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-openai.html (+ vercel/ai issue evidence that Bedrock expects snake_case `reasoning_effort`); current `src/providers/openai-compatible.ts` body build (compat is not spread by default — the gap).
    - Options Considered:
      - Spread all compat in the core base (rejected — changes every openai-compatible consumer's wire; escape hatches are per-provider by contract).
      - Per-wrapper explicit mapping of thinking fields (chosen — minimal, explicit, no core change).
    - Chosen Approach: shared `openAICompatThinkingExtra(request)` helper wired into all three wrappers.
    - API Notes and Examples:
      ```json
      // Azure gpt-5.1 deployment, host sets "high":
      { "model": "gpt-5.1", "reasoning_effort": "high", ... }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/azure/provider.ts`, `vertex/provider.ts`, `bedrock/provider.ts`; new shared helper (e.g. `packages/prism-providers/src/shared/openai-compat.ts`); tests.
    - References:
      - Code-audit gap table (compat never forwarded); Research Matrix rows azure/vertex/bedrock.
  - Test Cases to Write:
    - Each wrapper: fake fetch asserts `reasoning_effort` present in body when host sets it; absent when not.
    - Snap: azure + gpt-5.1 model + "xhigh" → "high".
    - Unrecognized compat keys (e.g. `route`) do not reach the body.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (previously-dropped compat now applied).
    - Docs pages to create/edit: `docs/providers/azure.md`, `docs/providers/vertex.md`, `docs/providers/bedrock.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 7. Chat-completions effort providers: Kimi, Z.AI, DeepSeek, xAI — clamp + stamps (+ xAI wire field)
  - Acceptance Criteria:
    - Functional (all four): catalogs declare `thinkingLevels` + `compat.thinkingFamily` stamps per the Research Matrix; resolvers snap host-supplied levels per the design record §2 (core helper where no documented table; upstream tables — `mapDeepseekEffort`, Z.AI GLM-5.2 — stay the wire authority) — no verbatim forwarding of values the upstream API rejects (K3 `medium` → `high`; GLM-4.x `reasoning_effort` omitted; GLM-5.3 `medium` → error-safe mapping to `high`; deepseek `medium` → `high` already, now test-pinned).
    - Functional (kimi): K3 `reasoning_effort` low/high/max (default preserved from catalog; coding-route default stays `high`); K2.x `thinking` object; `none` on K3 snaps to `low` (always-on); k2.7-code unchanged (always-on).
    - Functional (zai): `reasoning_effort` emitted only for GLM-5.2+ models; GLM-5.2 documented snapping (minimal/none → thinking disabled; low/medium → high; xhigh → max); GLM-5.3/5.3-flash accept low/high/max only and cannot disable thinking (thinking.type `disabled` never sent for them).
    - Functional (deepseek): declared levels low/high/max; `none` → thinking disabled (existing) — pinned.
    - Functional (xai): `xaiTransform` now emits `reasoning_effort` from compat/model (per-model map: grok-4.3 none/low/medium/high; grok-4.5 low/medium/high; grok-4.6 +xhigh; snap to model map; `reasoning_content` replay untouched); reasoning_effort absent for models without a map unless declared.
    - Performance: id checks constant-time per model.
    - Code Quality: per-provider `thinking.ts` resolvers centralize snapping (one call each); no wire shape changes beyond xai addition; tests per provider.
    - Security: compat strip lists extended with the `thinkingFamily` stamp key so stamps never reach bodies.
  - Approach:
    - Documentation Reviewed:
      - Kimi: https://platform.kimi.ai/docs/api/models-overview (per-model parameter matrix: k3 reasoning_effort low/high/max default max; k2.6 thinking enabled/disabled + keep all; k2.7-code only `{type:"enabled",keep:"all"}`), /guide/use-reasoning-effort. Z.AI: https://docs.z.ai/guides/capabilities/thinking (GLM-5.2 map; GLM-5.3 constraints). DeepSeek: https://api-docs.deepseek.com/api/create-chat-completion/ (low/high/max; medium/xhigh→high). xAI: https://docs.x.ai/developers/model-capabilities/text/reasoning (grok-4.5 default high, cannot disable; grok-4.6 xhigh; grok-4.3 none default), /rest-api-reference/inference/chat (grok-4.3 none/low/medium/high).
    - Options Considered:
      - Reject illegal values with an error (rejected — providers themselves snap; errors break multi-provider hosts).
      - Snap to declared set in each resolver (chosen — matches upstream snapping semantics; "always sent properly" mandate).
    - Chosen Approach: one snapping call in each existing resolver + catalog tables.
    - API Notes and Examples:
      ```json
      // zai glm-5.2, host sets "xhigh" → upstream-legal "max":
      { "model": "glm-5.2", "thinking": { "type": "enabled" }, "reasoning_effort": "max" }
      // xai grok-4.6, host sets "medium":
      { "model": "grok-4.6", "reasoning_effort": "medium" }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/{kimi,zai,deepseek,xai}/models.ts` + `thinking.ts` (+ `xai/provider.ts` transform), tests.
    - References:
      - Report items 3 (K3/Z.AI forwarding), xai row; Research Matrix.
  - Test Cases to Write:
    - K3 + "medium" → "high"; K3 + "none" → "low"; K2.5 + reasoning_effort → omitted (thinking family instead).
    - GLM-4.6 + host reasoning_effort → omitted; GLM-5.2 + "xhigh" → "max"; GLM-5.3 + "minimal" → snapped + no disabled thinking.
    - DeepSeek + "xhigh" → "high" (pinned); + "none" → thinking disabled.
    - xai grok-4.6 + "xhigh" → body has `reasoning_effort: "xhigh"`; grok-4.3 + "xhigh" → "high"; grok-build + level → map default.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new wire field on xai; snapping everywhere).
    - Docs pages to create/edit: `docs/providers/{kimi,zai,deepseek,xai}.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 8. ClinePass: derive declared levels from slot maps
  - Acceptance Criteria:
    - Functional: `defineClinePassModel` (or the featured table) derives `capabilities.thinkingLevels` by inverting the model's `thinkingLevelMap` (declared = slots with non-null values; portable `none` included when the `off` slot is non-null); stamps `compat.thinkingFamily: "reasoning_effort"`.
    - Functional: `clinePassReasoningEffort` behavior unchanged (slot gating already correct); the core snap helper is **not** double-applied (slot map remains the wire authority; declared levels are the host-facing mirror).
    - Performance: map inversion at define time only.
    - Code Quality: no duplication of slot tables; inversion unit-tested against every shipped map.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed:
      - `clinepass/thinking.ts` (GLM/KIMI/K3/DEEPSEEK/STANDARD maps; GLM never `max` — upstream 500), `clinepass/models.ts`; report item 3 (ClinePass as the existing precedent).
    - Options Considered:
      - Hand-declare levels per model (rejected — duplicates the slot tables).
      - Derive from maps (chosen — single source of truth).
    - Chosen Approach: derive + stamp; resolver untouched.
    - API Notes and Examples:
      ```ts
      // glm map { off:"none", low, medium, high, xhigh } → thinkingLevels ["none","low","medium","high","xhigh"]
      // kimi-k3 map { high: "max" } → thinkingLevels ["high"]
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/clinepass/models.ts` (+ tiny helper in `thinking.ts`), tests.
    - References:
      - Research Matrix row clinepass.
  - Test Cases to Write:
    - Every shipped map inverts to the expected declared set; host `isSupportedThinkingLevel(clineGlm, "max") === false`.
    - Wire behavior unchanged for all five maps (existing tests stay green).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (declared levels on models).
    - Docs pages to create/edit: `docs/providers/clinepass.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 9. OpenRouter: API-derived supported efforts + clamp
  - Acceptance Criteria:
    - Functional: `mapOpenRouterModel` reads `reasoning.supported_efforts` → `capabilities.thinkingLevels` and `reasoning.default_effort` → `compat.reasoning.effort` (existing) with `mandatory` respected (mandatory reasoning models get levels that do not include `none`).
    - Functional: `resolveOpenRouterReasoning` snaps `effort` to the model's declared set when present (OpenRouter accepts max/xhigh/high/medium/low/minimal/none globally, but per-model `supported_efforts` is authoritative when present); passthrough when a discovery-mapped model lacks the metadata.
    - Functional: family stamp `openai_reasoning` on mapped models.
    - Performance: mapping is per-entry at discovery; request-time snap is constant.
    - Code Quality: OpenRouter models schema types extended (`supported_efforts`, `mandatory`); live-list test updated to pin the fields.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed:
      - https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties (Model.reasoning: `{ default_effort, default_enabled, mandatory, supported_efforts }`), https://openrouter.ai/docs/guides/best-practices/reasoning-tokens (reasoning.effort value set; effort vs max_tokens exclusivity), current `openrouter/models.ts` reasoning metadata reads.
    - Options Considered:
      - Hardcode levels per upstream family (rejected — OpenRouter exposes per-model efforts via API; user's preferred source).
      - API-derived (chosen).
    - Chosen Approach: read `supported_efforts` at discovery; snap at request.
    - API Notes and Examples:
      ```ts
      // models API entry.reasoning: { default_effort: "medium", supported_efforts: ["low","medium","high"] }
      // → capabilities.thinkingLevels: ["low","medium","high"], compat.reasoning: { effort: "medium" }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/openrouter/models.ts`, `thinking.ts`, tests (incl. live-list env-gated pin).
    - References:
      - Research Matrix row openrouter.
  - Test Cases to Write:
    - Fixture entry with supported_efforts → declared levels + snap ("xhigh" → "high").
    - Entry without reasoning metadata → no levels, passthrough.
    - `mandatory: true` model + "none" → snapped to minimum declared level.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/providers/openrouter.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 10. Hyper: API-derived levels, stamps, anthropic-route effort (depends on 3)
  - Acceptance Criteria:
    - Functional: `listHyperModels` maps catalog `reasoning.effort_levels` → `capabilities.thinkingLevels` (keeping `compat.effortLevels` for back-compat) and stamps `thinkingFamily: "reasoning_effort"`; featured snapshot entries gain `thinkingLevels`.
    - Functional: `hyperReasoningEffort` snapping now also consults declared `thinkingLevels` (existing `effortLevels` clamp retained as the compat mirror); anthropic-route models emit resolved thinking/effort via the task-3 shared hooks (thinking no longer stripped-and-dropped); responses-route passthrough unchanged.
    - Performance: unchanged.
    - Code Quality: single source (catalog field) for both compat and capabilities; tests cover all three routes.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed:
      - https://hyper.charm.land/docs/models.html (live `/v1/models` carries `reasoning.effort_levels` + `default_effort_level`); current `hyper/models.ts` (effortLevels already recorded) and `hyper/thinking.ts` (existing clamp — drop-outside-set behavior replaced by snap).
    - Options Considered:
      - Keep drop-outside-set (rejected — silent drop is the failure mode this plan eliminates).
      - Snap (chosen).
    - Chosen Approach: snap; API-derived levels.
    - API Notes and Examples:
      ```ts
      // deepseek-v4-flash: effortLevels ["high","xhigh"], host sets "max" → "xhigh"
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/hyper/models.ts`, `thinking.ts`, `provider.ts` (hooks), tests.
    - References:
      - Research Matrix row hyper; task 3.
  - Test Cases to Write:
    - Featured model snap both directions; anthropic-route body contains resolved thinking/effort; responses route unchanged.
    - Live-list mapping pins effort_levels → thinkingLevels.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/providers/hyper.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 11. Gateway duo: CommandCode + OpenCode-Go per-upstream stamps, levels, and route-correct fields (depends on 3)
  - Acceptance Criteria:
    - Functional: both catalogs stamp per-upstream `thinkingFamily` + `thinkingLevels` mirroring the Research Matrix (claude-* → `output_config_effort` + anthropic effort sets; gpt-5.6* → `openai_reasoning` + gpt-5.2 table; deepseek-v4 → low/high/max; moonshotai/Kimi-K3 → low/high/max, K2.x → thinking; zai/GLM-5.3 → low/high/max; MiniMax M3/M2.x → anthropic-route `thinking` (M3 request schema verified at implementation against platform.minimax.io; M2.x via anthropic-compat thinking blocks); Qwen3.x → anthropic-route thinking/enable behavior verified; grok-4.5/4.6 → low/medium/high(/xhigh); gemini-3.x → gemini level sets; mimo → passthrough).
    - Functional: OpenAI-route bodies emit `reasoning_effort` / `reasoning` snapped to the model's declared levels (commandcode currently raw-spreads them — keep passthrough but add snapping; opencode-go resolvers gain snapping); Anthropic-route bodies emit resolved thinking/effort via task-3 hooks (commandcode now resolves instead of raw-spreading `thinking`/`reasoning_effort` into Anthropic bodies — the current raw spread of `reasoning_effort` on the Anthropic route is removed).
    - Functional: `stripXOwnedCompat` lists extended (stamps, `output_config`) so no managed key reaches either route.
    - Performance: unchanged.
    - Code Quality: per-model tables colocated in each `models.ts`; upstream families cross-referenced to the source tables from tasks 3–7 rather than re-invented (values duplicated per gateway catalog, provenance comments included).
    - Security: gateway bodies never carry unknown compat keys (both routes).
  - Approach:
    - Documentation Reviewed:
      - https://commandcode.ai/docs and https://opencode.ai/docs/go/ (route tables); https://platform.minimax.io/docs/api-reference/text-anthropic (+ text-openai-api: M3 `thinking` type disabled/enabled on OpenAI-compat; Anthropic-compat recommended for M2.x); Kimi/Z.AI/DeepSeek/xAI/Anthropic/OpenAI/Gemini rows of the Research Matrix (upstream rules mirrored).
    - Options Considered:
      - Passthrough-only gateways (rejected — recreates verbatim-forwarding defects; upstreams differ per model).
      - Per-upstream stamped catalogs + route-correct resolution (chosen).
    - Chosen Approach: stamp the catalog with upstream rules; resolve per route.
    - API Notes and Examples:
      ```json
      // commandcode, claude-opus-4-8, host sets "xhigh":
      { "model": "claude-opus-4-8", "thinking": { "type": "adaptive" }, "output_config": { "effort": "xhigh" } }
      // opencode-go, kimi-k3, host sets "medium" → snapped "high":
      { "model": "kimi-k3", "reasoning_effort": "high" }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/{commandcode,opencode-go}/models.ts`, `thinking.ts`, `provider.ts` (+ `openai-chat.ts` transforms), tests.
    - References:
      - Research Matrix rows commandcode/opencode-go; code-audit gap table (shared-route drop; raw `reasoning_effort` on Anthropic route).
  - Test Cases to Write:
    - Per family: stamped body contains the right field on the right route; illegal values snapped; raw `reasoning_effort` never appears on an Anthropic-route body.
    - MiniMax M3 + Qwen3.7 anthropic-route thinking emission pinned to the verified schema (test fixture mirrors platform docs).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/providers/{commandcode,opencode-go}.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 12. Alibaba (Qwen): enable_thinking / thinking_budget mapping + levels
  - Acceptance Criteria:
    - Functional: `alibabaBody` maps a portable thinking level: `none` → `enable_thinking: false` (hybrid models), other levels → `enable_thinking: true`; thinking-only models (Qwen3-Thinking, QwQ, per catalog) never receive `enable_thinking: false`; `thinking_budget` compat passthrough preserved (Qwen3.5–3.8/Qwen3-VL/GLM/Kimi series) and optionally seeded from level (`minimal` → low default budget) — budget seeding only where docs give a defensible number, else omitted.
    - Functional: `alibaba/models.ts` declares `thinkingLevels` (on/off semantics: `["none","low","medium","high","xhigh","max"]`-style on/off set or minimal set per model family) + `thinkingFamily: "qwen_thinking"`-style stamp (new family emitted by core task 2 only if kept; otherwise a package-local resolver keyed off the stamp-adjacent compat fields — decide in task 1 review) so the documented adapter path reaches `enable_thinking` instead of dead-ending in `reasoning_effort`.
    - Functional: `enable_thinking` request-vs-model precedence preserved (model `parameters.enable_thinking` still wins — legacy order documented in code).
    - Performance: unchanged.
    - Code Quality: `alibabaEnableThinking` extended with level-derived default; strip list covers thinking keys + stamp.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed:
      - https://help.aliyun.com/en/model-studio/deep-thinking (hybrid vs thinking-only; OpenAI-compat `extra_body` → top-level JSON fields for raw clients), https://docs.qwencloud.com/developer-guides/text-generation/thinking (`thinking_budget` supported series; Chat Completions/DashScope only), current `alibaba/provider.ts` (`enable_thinking` handling + precedence comment).
    - Options Considered:
      - New core family for Qwen (only if ≥2 packages need it — check task 1; likely package-local resolver instead).
      - Portable on/off mapping + budget passthrough (chosen).
    - Chosen Approach: package-local resolver; levels declared as on/off; core `google`-style family not extended without a second consumer.
    - API Notes and Examples:
      ```json
      // qwen3.7-max, host sets "none":
      { "model": "qwen3.7-max", "enable_thinking": false }
      // host sets "high":
      { "model": "qwen3.7-max", "enable_thinking": true, "thinking_budget": 8192 }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/alibaba/models.ts`, `provider.ts`, tests.
    - References:
      - Research Matrix row alibaba; report defect 1 class (family dead-end).
  - Test Cases to Write:
    - Hybrid model: none → disabled; any other level → enabled (+ budget when seeded); thinking-only model: `enable_thinking: false` never sent.
    - Adapter path end-to-end: `applyThinkingLevelForModel` on a qwen model → `enable_thinking` lands in body.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/providers/alibaba.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 13. Ollama + NeuralWatt: featured levels + clamp, passthrough otherwise
  - Acceptance Criteria:
    - Functional (ollama): featured catalog declares levels for known models (gpt-oss: low/medium/high; qwen3/deepseek-r1 style models: passthrough note); `ollamaReasoningEffort` snaps when levels declared, passthrough otherwise; native `think` field documented as disjoint (never emitted by this package — OpenAI-compat endpoint only).
    - Functional (neuralwatt): reasoning-capable catalog models declare levels from the catalog default (`reasoning_effort` max etc.); resolver snaps when declared, passthrough otherwise; `thinking_token_budget` untouched.
    - Performance: unchanged.
    - Code Quality: both resolvers get the same single snap call pattern; stamps added.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed:
      - https://docs.ollama.com/api/openai-compatibility + ollama/ollama#14821/#17499 (`reasoning_effort` accepted on `/v1/chat/completions`; value set differs from native `think`), https://docs.ollama.com/capabilities/thinking (native think: bool|low/medium/high/max; gpt-oss low/medium/high); `neuralwatt/models.ts` (reasoning_effort defaults), `neuralwatt/thinking.ts`.
    - Options Considered:
      - Native `think` field (rejected — package targets the OpenAI-compat endpoint; mixing value sets 400s).
      - reasoning_effort passthrough + featured declared sets (chosen).
    - Chosen Approach: declared-when-known, snap, else passthrough.
    - API Notes and Examples:
      ```json
      { "model": "gpt-oss:20b", "reasoning_effort": "medium" }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/{ollama,neuralwatt}/models.ts`, `thinking.ts`/`provider.ts`, tests.
    - References:
      - Research Matrix rows ollama/neuralwatt.
  - Test Cases to Write:
    - ollama gpt-oss + "xhigh" → snapped "high"; unknown model + "medium" → passthrough verbatim.
    - neuralwatt reasoning model + illegal value → snapped to declared set.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/providers/{ollama,neuralwatt}.md` (task 17).
    - `docs/index.md` update: yes (task 17).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 14. Host workers + session path: model-aware adapter everywhere
  - Acceptance Criteria:
    - Functional: `packages/memory` LLM compaction + observational-memory workers call `applyThinkingLevelForModel` (replacing the `thinkingFamilyForModel` + noop-fallback guess) — explicit host `thinkingLevel` reaches the correct family field for every reasoning-capable model, and is omitted (not guessed) for non-reasoning models.
    - Functional: `resolveRunProviderOptions` merge path (session run `providerOptions`) verified unchanged — no double-merge; `RunOptions` gains no new field (hosts use `applyThinkingLevelForModel` directly; a convenience `thinkingLevel` on RunOptions is explicitly rejected in the evidence doc — YAGNI until requested).
    - Performance: adapter is O(1) per request; compaction path unchanged latency.
    - Code Quality: worker diff is a helper swap; existing worker tests updated.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/src/compaction/llm/strategy.ts` (`runSummaryProvider` current family inference + fallback), `src/agent-session/session.js`/`src/agent-session.ts` `resolveRunProviderOptions` merge, `docs/thinking-and-reasoning.md` use-case worker section.
    - Options Considered:
      - Keep family guess + fallback (rejected — the guess is the silent no-op source for google/anthropic-stamped models).
      - Model-aware adapter (chosen).
    - Chosen Approach: swap the helper; one merge, one family, snapped level.
    - API Notes and Examples:
      ```ts
      options: applyThinkingLevelForModel(options.providerOptions, options.thinkingLevel, model)
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/llm/strategy.ts` (+ observational-memory worker equivalent), worker tests.
    - References:
      - Report evidence row "per-turn providerOptions merge"; task 2.
  - Test Cases to Write:
    - Worker with gemini summary model + thinkingLevel "low" → `thinkingLevel` compat (not `reasoning_effort`).
    - Worker with non-reasoning model + thinkingLevel → no invented field.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (worker behavior per model).
    - Docs pages to create/edit: `docs/compaction-llm.md` + `docs/thinking-and-reasoning.md` use-case section (task 17).
    - `docs/index.md` update: no (existing pages).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 15. Conformance + evidence matrix: coverage is machine-checked
  - Acceptance Criteria:
    - Functional: provider-conformance suite (or a new dedicated `thinking-conformance` suite in `packages/prism-providers/src/__tests__/`) walks every first-party catalog model with `capabilities.reasoning` and asserts: declared `thinkingLevels` non-empty (or explicitly marked passthrough), a family stamp present, and — against each provider's body builder with a fake transport — a legal effort field on the wire for representative levels (all/min) and no field for `none`-incapable models.
    - Functional: `docs/_evidence/thinking-coverage-2026-09-05.md` generated table: provider × model → family, declared levels, levels source (API/hardcoded + doc URL), wire assertion test, live test (where a suite exists).
    - Functional: env-gated live probes updated (anthropic output_config.effort acceptance; google thinkingLevel acceptance; xai reasoning_effort acceptance; kimi/zai snap acceptance) — extending the plan-064 live matrix entries, `wired: true`.
    - Performance: conformance suite runtime increase < 2 s (pure builders, no network).
    - Code Quality: one assertion helper shared across provider fixtures; failures list model id + missing element.
    - Security: live probes keep the env-gated skip contract (plan 064); no credentials in repo.
  - Approach:
    - Documentation Reviewed:
      - `src/testing/provider-conformance.ts`, plan 064 `scripts/live-matrix.json` structure, existing live suites for anthropic/google/xai/kimi/zai.
    - Options Considered:
      - Per-provider ad-hoc assertions only (rejected — no single coverage proof).
      - Central conformance walk + evidence matrix (chosen).
    - Chosen Approach: catalog-driven conformance; evidence generated from the same walk.
    - API Notes and Examples:
      ```ts
      for (const model of allFirstPartyReasoningModels()) {
        assertLegalEffortOnWire(model.provider, model, "low");
        assert(model.capabilities.thinkingLevels?.length, `${model.model} declares levels`);
      }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/__tests__/thinking-conformance.test.ts` (new), `docs/_evidence/thinking-coverage-2026-09-05.md` (new), live suite files touched for probes, `scripts/live-matrix.json` (wire flags).
    - References:
      - Research Matrix (source-of-truth column feeds the evidence doc).
  - Test Cases to Write:
    - The conformance walk itself (fails when a catalog model regresses to undeclared levels or a wire omission).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (test infrastructure + evidence).
    - Docs pages to create/edit: `docs/_evidence/thinking-coverage-2026-09-05.md` (evidence, linked from thinking-and-reasoning.md in task 17).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 16. Live verification probes for the riskiest wire changes
  - Acceptance Criteria:
    - Functional: env-gated live tests confirm, with real credentials when available (skip-with-reason otherwise, per plan-064 contract): (a) Anthropic accepts `output_config.effort` (+ rejects or tolerates legacy top-level — determines whether a dual-emit transition shim is needed); (b) Google 3.x accepts `thinkingLevel` values per model; (c) xAI accepts `reasoning_effort` on grok-4.5/4.6; (d) Z.AI GLM-5.3 rejects `thinking.type:"disabled"` (pins the gate); (e) Azure deployment accepts `reasoning_effort`.
    - Functional: findings recorded in the evidence doc; any contract drift (e.g. Anthropic top-level still accepted) adjusts task-3 emission before release.
    - Performance: live-only; hermetic suites untouched.
    - Code Quality: probes live in the existing per-provider live suites; no new network in hermetic CI.
    - Security: env-gated; `assertNoSecretLeak` pattern; skip-with-reason.
  - Approach:
    - Documentation Reviewed:
      - Plan 064 live matrix + skip contract; platform docs from tasks 3–7.
    - Options Considered:
      - Ship on docs alone (rejected — the Anthropic wire-field move and MiniMax M3 request schema are the two least-certain items; live pins them).
      - Live probes (chosen).
    - Chosen Approach: probes in existing suites; evidence doc records accept/reject results.
    - API Notes and Examples:
      ```ts
      test("anthropic accepts output_config.effort", { skip: !process.env.PRISM_LIVE_ANTHROPIC_API_KEY }, ...)
      ```
    - Files to Create/Edit:
      - Existing live suites (`*.live.test.ts`) for anthropic/google/xai/zai/azure; evidence doc appendix.
    - References:
      - Plan 064; task 15.
  - Test Cases to Write:
    - The probes themselves (env-gated).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (verification only; may adjust task-3 emission).
    - Docs pages to create/edit: evidence doc appendix (task 15 file).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 17. Documentation: contract rewrite, provider pages, migration note, changelog
  - Acceptance Criteria:
    - Functional: `docs/thinking-and-reasoning.md` rewritten to the api-page template: adapter contract (`applyThinkingLevelForModel` first), declared-levels capability, snap semantics, family table updated with `google` + `output_config_effort` (+ removal of the `thinking_type` recommendation for Anthropic-routed providers — corrected per report defect 2), per-provider legality matrix link to the evidence doc, non-reasoning model guidance.
    - Functional: every touched provider page (`docs/providers/*.md`) documents the model's declared levels, wire field, and snapping; `docs/providers/ai-sdk.md` documents the deliberate noop; `docs/index.md` descriptions updated; `CHANGELOG.md` entry under 0.5.x/0.6.0; `docs/migrate-to-0.6.md` notes the Anthropic `effort` → `output_config.effort` wire change + xai new field.
    - Performance: n/a.
    - Code Quality: all pages follow the api-page structure; cross-links resolve (`npm run docs:check` if present, else manual link check).
    - Security: no secrets in examples.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (api-page template + index grouping), current `docs/thinking-and-reasoning.md`, `docs/index.md`.
    - Options Considered:
      - Incremental edits (rejected — family table + contract both changed materially).
      - Full rewrite of the hub page + batch provider page updates (chosen).
    - Chosen Approach: rewrite hub, batch per-provider updates, evidence doc linked as the legality matrix.
    - API Notes and Examples:
      ```ts
      import { applyThinkingLevelForModel } from "@arnilo/prism";
      await session.run(input, { providerOptions: applyThinkingLevelForModel(base, "high", model) });
      ```
    - Files to Create/Edit:
      - `docs/thinking-and-reasoning.md`, `docs/providers/{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,commandcode,deepseek,google,hyper,kimi,neuralwatt,ollama,openai,openai-compatible,opencode-go,openrouter,vertex,xai,zai}.md`, `docs/index.md`, `CHANGELOG.md`, `docs/migrate-to-0.6.md`.
    - References:
      - All prior tasks.
  - Test Cases to Write:
    - None (docs); link check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this is the docs task.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — thinking-and-reasoning description + migration entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 18. Final verification + graft refresh
  - Acceptance Criteria:
    - Functional: full `npm test` green (hermetic), `npm run lint`/typecheck green, thinking-conformance green; `graft build` refreshes the graph (AGENTS.md contract for big changes).
    - Performance: no runtime regressions; coverage baselines pass unchanged.
    - Code Quality: no `dist/` artifacts committed; release evidence follows repo convention; **resolve the pre-existing plan-064 live-gate naming conflict** (`packages/prism-coding-tools/src/computer-use-linux/__tests__/live.test.ts` gates on `PRISM_TEST_COMPUTER_USE` but `src/__tests__/network-free-guard.test.ts` demands `/PRISM_LIVE_[A-Z_]+/`; failure predates plan 065, verified unrelated to its tasks).
    - Security: no new dependencies; no credential-shaped strings added.
  - Approach:
    - Documentation Reviewed:
      - `AGENTS.md` (graft refresh requirement), plan execution loop (skill).
    - Options Considered:
      - n/a (verification task).
    - Chosen Approach: run the full gate + graft build; fill `Compromises Made` / `Further Actions` below.
    - API Notes and Examples:
      ```bash
      npm test && npm run lint && graft build
      ```
    - Files to Create/Edit:
      - `graft/` (refreshed graph); `plans/065-Provider-Thinking-Effort-Coverage.md` (checkboxes, compromises, further actions).
    - References:
      - Repo AGENTS.md.
  - Test Cases to Write:
    - None (aggregation).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (verification).
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a (task 17 covers docs).

## Compromises Made

To be filled after tasks are completed and tests pass. Known constraints decided up front:

- Providers without a levels-enumeration API (OpenAI, Anthropic, Google, Kimi, Z.AI, DeepSeek, xAI, Qwen, ClinePass, Ollama, NeuralWatt) get **hardcoded** tables from official docs — they cannot be API-checked; the evidence doc pins each table to its doc URL and live probes (task 16) pin the riskiest ones.
- Task 15 conformance notes: commandcode gemini-3.x no longer declares thinkingLevels — the gateway chat route has no thinking_level wire (family noop), so the declaration could never reach the model (caught by the walk). commandCodeEffort now reads `compat.output_config.effort` so the adapter's output_config_effort patch reaches the shared anthropic route; COMMAND_CODE_ANTHROPIC_HOOKS exported for route-aware wire assertions. OpenAI catalog models gained explicit `openai_reasoning` stamps (previously heuristic-only). xai grok-build and mimo entries stay heuristic-family (core adapter forwards reasoning_effort verbatim when no set is declared; upstream legality for those two is unverified and flagged in the evidence doc). ClinePass wire uses slot-map vocabulary (portable high → wire max), so the walk asserts presence + string type there instead of set membership. Evidence doc is generated from the compiled catalogs by `packages/prism-providers/scripts/generate-thinking-coverage.mjs` — regenerate after catalog changes.
- Gateway catalogs (commandcode, opencode-go) duplicate upstream level sets rather than referencing them at runtime — upstreams are external services; duplication is bounded and provenance-commented.
- Anthropic per-generation adaptive/legacy mapping is a **model table in the catalog**, not a live capability — Anthropic exposes no per-model thinking-mode API.
- Task 3 notes: haiku-4-5 declared `["none","low","medium","high"]` per the matrix's "effort everywhere" reading, but effort support there is undocumented upstream — live probe (task 16) confirms or trims it. Hyper's anthropic-route effort hook still clamps against `compat.effortLevels` (existing chat-route behavior); task 10 replaces drop-outside-set with snap against declared `thinkingLevels`.
- Task 7 notes: GLM-5.3 / 5.3-FLASH are handled in resolvers + discovery stamps but not added to the featured `zaiModels` catalog (official context/output limits not doc-verified at authoring time — add featured entries when limits are confirmed). Unknown non-ladder effort strings pass through on K3/GLM (forward compat — upstreams own their future level names). Z.AI GLM-5.2 `low`/`medium` snap to `high` per the documented upstream mapping even though the values are requestable; declared levels list requestable values, resolvers own the wire mapping. DeepSeek `reasoning_effort: none|off|disabled` now stops thinking only when no request-level `thinking` switch was sent (request switch keeps priority over model defaults).

## Further Actions

To be filled after task completion with improvements, rationale, and priority. Candidates already identified:

- Watch for OpenAI/Anthropic/Google exposing per-model effort enumeration APIs later; when they do, replace the hardcoded tables in the same `list*Models()` mapping path used for OpenRouter/Hyper.
- MiniMax M3 Anthropic-route request schema (task 11) is under-documented upstream; if the live probe finds a different shape, record it in the evidence doc and adjust the resolver.
- Run the task-16 live probes with real credentials and fill the _awaiting live run_ cells in `docs/_evidence/thinking-coverage-2026-09-05.md`; probe 2 (legacy top-level `effort`) decides whether a dual-emit transition shim is needed before release.
- Feature task-16 probe 7 notes a false-positive window: a 404 (GLM-5.3 not provisioned on the account) also satisfies the HTTP ≥ 400 assertion — a clean disable-rejection pin needs the model present.

### Task 18 final verification record (2026-09-06)

- `npm test` exit 0 (build + root 1647/1647, gate scripts 209/209 incl. phase23 build-race 9/9, all 9 workspaces fail-0). One prior red run was self-inflicted: wrapping the whole `npm test` in `with-build-lock` makes the phase23 live-lock tests correctly fail closed — the gate segment must run unwrapped per its own header comment.
- `npm run lint` exit 0 (fixed 17 pre-existing diagnostics from the plan-064 sessions: unused imports/vars in `packages/mcp`, `scripts/e2e-*`, `scripts/live-matrix.mjs`, `scripts/generate-live-docs.mjs` — none in plan-065 code).
- `npm run typecheck` exit 0 (build + workspace typecheck + examples).
- `graft build` refreshed (graph is local-cache; no commit needed).
- Plan-064 live-gate naming conflict resolved: `network-free-guard.test.ts` now accepts `PRISM_(?:LIVE|TEST)_[A-Z_]+` (the computer-use leg gates on `PRISM_TEST_COMPUTER_USE` by design).
- `docs/_evidence/phase54-package-map.md` regenerated (stale after catalog/model edits). Evidence matrix unlinked from `docs/index.md` pack surface (`docs/_evidence` is excluded from `npm pack`; cross-references stay as plain code text, per the phase-27 convention).
- No `dist/` artifacts staged; no new dependencies; no credential-shaped strings added.
- `RunOptions.thinkingLevel` convenience field deliberately not added (YAGNI) — revisit if hosts ask.
