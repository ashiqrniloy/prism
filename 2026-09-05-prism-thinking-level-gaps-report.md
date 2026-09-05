# Prism defect report / feature request: portable thinking-level contract gaps

**Reporter:** Clay project
**Affected versions:** `@arnilo/prism` 0.4.0, `@arnilo/prism-providers` 0.4.0
**Scope:** `thinking.js` helpers (`applyThinkingLevel`, `thinkingCompatFor`, `thinkingFamilyForModel`, `THINKING_LEVELS`) and per-provider request builders that consume `options.compat`
**Reference doc:** `docs/thinking-and-reasoning.md`

## Summary

The portable `ThinkingLevel` contract works for the providers whose resolvers read the compat patch, but we found one silent-drop defect, one helper that can produce wire-rejected bodies, and one contract hole: **a host cannot determine which thinking levels a given model accepts**. Details and evidence below; each item lists exact shipped-code locations from the published 0.4.0 tarball.

Verified first (not a defect): the per-turn path is real. `session.run(input, { providerOptions: applyThinkingLevel(...) })` → `resolveRunProviderOptions` merges config + run `providerOptions` (`prism/dist/agent-session/session.js:356`, `structured-output.js:48`) → `request.options.compat` → provider resolver → official body field. OpenAI Responses, OpenRouter, Z.AI, Kimi, DeepSeek, Anthropic, and ClinePass all forward correctly today.

---

## Defect 1 — Portable thinking levels silently no-op for Google/Gemini

`thinkingFamilyForModel` has no Google heuristic. Gemini models carry `compat.thinkingConfig` (an object) — but the first heuristic only matches `compat.thinking` (`prism/dist/thinking.js:55`), `thinkingConfig` is not checked. Gemini models also don't set `capabilities.reasoning`, so inference falls through to `noop`, and `applyThinkingLevel` then sends nothing.

Meanwhile the Google provider *does* read a portable per-turn level — `googleThinkingConfig` accepts `compat.thinkingLevel` (`prism-providers/dist/google/thinking.js:6-31`) — but **no `thinkingCompatFor` family produces that key**. The three families map to `reasoning.effort`, `reasoning_effort`, and `thinking.type`; none reaches `generationConfig.thinkingConfig.thinkingLevel`.

Net effect: a host following the documented contract (`applyThinkingLevel(undefined, level, thinkingFamilyForModel(geminiModel))`) gets a silent no-op — level chosen in the UI, nothing on the wire. Silent drops are the worst failure mode here: the user believes effort was applied.

**Suggested fix:** add a `google` family to `thinkingCompatFor` → `{ thinkingLevel: level }`, and a Google heuristic to `thinkingFamilyForModel` (existing `compat.thinkingConfig` object → `google`). Alternative: reuse the existing `thinkingConfig` model-default key so per-turn merge lands in the same object.

## Defect 2 — `thinking_type` family produces a wire-rejected Anthropic body for non-`none` levels

`thinkingCompatFor("thinking_type", level)` returns `{ thinking: { type: "enabled" } }` for any non-`none` level (`prism/dist/thinking.js:22`). Anthropic's official Messages API requires `budget_tokens` alongside `type: "enabled"`; `anthropicThinking` forwards the object as-is (`prism-providers/dist/anthropic/thinking.js:5-14`) and `anthropicMessagesBody` spreads it into the body (`messages.js:24`) — no default budget is injected. The request fails with a 400.

The docs compound this: the family table recommends `thinking_type` for the Anthropic-routed providers (`opencode-go` "Anthropic route"), so the documented happy path can produce a rejected request. The working Anthropic path is actually the `reasoning_effort` alias (`anthropicEffort` reads `compat.reasoning_effort` → body `effort`, adaptive depth — `anthropic/thinking.js:16-24`), which the family table does not surface for Anthropic.

**Suggested fix:** either inject a default `budget_tokens` when a `thinking_type` patch reaches an Anthropic body, or (better) stop recommending `thinking_type` for Anthropic-routed providers and map them to `reasoning_effort`/`effort`; ideally both, with the docs table corrected.

## Feature request 3 — Declare per-model accepted thinking levels

Model-dependent legality is documented as "provider-owned" (`thinking.js:1-3`), but today it is only *enforced* for ClinePass (`compat.thinkingLevelMap` slot tables — `clinepass/thinking.js:55`), and even there the map is level→slot, not a declared accepted set. For every other provider the portable level forwards verbatim with no model gating. Hosts have no machine-readable answer to "which of `THINKING_LEVELS` may I set for model X?" — the only signals are `capabilities.reasoning` (boolean) and a single default value in `model.compat` (e.g. kimi-k3 `reasoning_effort: "max"`), neither of which enumerates the accepted set.

Concrete cases where Prism forwards values the upstream API does not accept:

- **Kimi K3:** officially `low | high | max`; a host-set `medium`/`xhigh` forwards verbatim via `kimiReasoningEffort` (`kimi/thinking.js:18-22`) → API error.
- **Z.AI:** `reasoning_effort` is GLM-5.2+ only; `zaiReasoningEffort` forwards it for older GLM models too if the host sets it (`zai/thinking.js:28-37`).
- **xai:** replay-only by design; a host following the `capabilities.reasoning → reasoning_effort` inference heuristic sends a field the provider ignores/strips (`thinkingFamilyForModel` heuristic 6).

**Suggested API (feature request):** optional declared levels on the model, e.g. `capabilities.thinkingLevels?: readonly ThinkingLevel[]` (populated by provider packages' model catalogs — the data already exists in their `models.js` tables and doc comments), plus a small validation helper (`isSupportedThinkingLevel(model, level)`) so hosts can fail closed before the request instead of surfacing a provider 400. Provider catalogs that already encode this (ClinePass maps, K3 doc comments, GLM-5.2 gating) become declarative instead of procedural.

## Feature request 4 — Optional validation helper for host-supplied levels

Independent of per-model declarations: `applyThinkingLevel`/`thinkingCompatFor` accept any string (forward-compat passthrough, `normalizeThinkingLevel`). That is a reasonable default, but there is no host-facing way to distinguish "known portable level" from "opaque provider-specific value" at the boundary without reimplementing `isThinkingLevel`. A typed `parseThinkingLevel(value): ThinkingLevel | { opaque: string }` (or equivalent) would let hosts like ours reject unknown levels fail-closed at the daemon boundary while still allowing deliberate forward-compat passthrough.

---

## Evidence index (shipped 0.4.0 dist)

| Claim | Location |
|---|---|
| No google family; inference heuristics end at `capabilities.reasoning` | `prism/dist/thinking.js:53-74` |
| Family patches: `reasoning.effort` / `reasoning_effort` / `thinking.type` only | `prism/dist/thinking.js:19-27` |
| `thinking_type` + non-none → `{type:"enabled"}` without budget | `prism/dist/thinking.js:22` |
| Anthropic body: thinking/effort resolved then spread, no budget injection | `prism-providers/dist/anthropic/messages.js:13-26`, `anthropic/thinking.js:5-24` |
| Anthropic accepts `compat.reasoning_effort` → body `effort` | `anthropic/thinking.js:16-24` |
| Google reads `compat.thinkingLevel` alias | `prism-providers/dist/google/thinking.js:6-31` |
| Kimi K3 `reasoning_effort` verbatim passthrough | `prism-providers/dist/kimi/thinking.js:18-22` |
| Z.AI `reasoning_effort` forwarded regardless of model generation | `prism-providers/dist/zai/thinking.js:28-37` |
| ClinePass per-model slot tables (the existing precedent) | `prism-providers/dist/clinepass/thinking.js:55-77` |
| Per-turn providerOptions merge into request options | `prism/dist/agent-session/session.js:356`, `structured-output.js:48` |

Happy to provide repro snippets against any of these; all were observed against the published npm tarballs, not a fork.
