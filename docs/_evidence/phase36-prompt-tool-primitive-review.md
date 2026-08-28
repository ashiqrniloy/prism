# Phase 36 prompt/tool primitive review

## Scope and result

This is a review-only task. No production source, prompt layout, canonicalization, or provider adapter was changed.

The current pipeline already has one input/prompt assembly seam and one tool dispatch seam. Keep those seams. Defer layout changes until the provider-specific message projections are covered. Plan one strict core canonical-JSON primitive for later schema/cache identity work; do not sort semantic message or tool arrays.

Validation performed:

```text
npm run build                         PASS
node /tmp/phase36-measure.mjs         PASS (fake fetch; no provider/network calls)
```

## End-to-end ownership and order

| Stage | Owner | Observed order and boundary |
| --- | --- | --- |
| Run setup | `RuntimeAgentSession.runInternal()` | Resolves provider, rebuilds branch history, resolves active tools and skills, redacts and guardrails the new input, appends it, then runs auto-compaction before loop assembly. `src/agent-session/session.ts:287-464`, `src/agent-session/session.ts:1692-1746`, `src/session-stores.ts:133-162` |
| Base prompt/context selection | Runtime | Composes `AgentConfig.instructions` plus `AgentConfig.systemPrompt`/`RunOptions.systemPrompt`; host context providers precede active skill context providers; run options override injector list and input layout. `src/agent-session/session.ts:430-464` |
| Loop seam | `LoopContext` | The runtime owns provider calls, retry, redaction, persistence, events, and dispatch. A loop only calls `assemble`, `generate`, `dispatchToolCall`, `appendMessage`, and event helpers. `src/contracts-core/loop.ts:8-43` |
| Turn input assembly | `assembleProviderInput()` | Folds provider-only tool results/history, runs selected injectors against redacted input/history, composes injector instructions, resolves context, applies budget, runs `input_assembly`, runs `prompt_build`, invokes one prompt builder, checks model modalities, and returns `ProviderRequest`; it does not call a provider. `src/input.ts:167-302` |
| Input builder | `createDefaultInputBuilder()` | Builds instruction, summary, history, input, attachment/resource, and tool-result groups, then flattens them. It deliberately does not run `input_assembly`; runtime owns that hook. `src/input.ts:105-113`, `src/input.ts:304-349` |
| Injectors | `runInstructionInjectors()` | Runs in caller order after tool-result folding. Only `instructions` and `contextBlocks` are accepted. Instructions become package prompt contributions; blocks are appended after provider blocks and before context middleware. `src/instruction-injection.ts:26-43`, `src/input.ts:181-206` |
| Context | `resolveContextProviders()` | Runs providers sequentially in caller order, appends injector blocks, then runs `context` middleware. In the budget path this happens before `input_assembly`; without a budget it happens after `input_assembly`. `src/input.ts:117-134`, `src/input.ts:222-251`, `src/input.ts:275-292` |
| Prompt builder | `createDefaultPromptBuilder()` | Prepends rendered context, selected/progressively disclosed skills, and a text `Available tools` catalog only when the model does not declare tool support; then appends assembled messages. Tool schemas remain in `ProviderRequest.tools`. `src/input.ts:136-155` |
| Provider request | Runtime `ctx.generate()` | Applies provider-request policies, then `provider_request` middleware, then runtime redaction, then retry around the current provider turn. `src/agent-session/session.ts:1460-1493`, `src/agent-session/session.ts:1675-1686` |
| Provider wire projection | Provider package | OpenAI Responses projects all messages into `input` and emits `tools` after it; Anthropic extracts system messages into `system` and sends non-system messages plus tools; Gemini extracts system messages into `systemInstruction` and sends non-system contents plus tools; OpenAI-compatible sends chat `messages` plus tools. `packages/provider-openai/src/responses.ts:262-292`, `packages/provider-anthropic/src/messages.ts:46-72`, `packages/provider-google/src/generate-content.ts:30-67`, `src/providers/openai-compatible.ts:229-246` |
| Tool execution | `dispatchToolCall()` | Provider calls are inert until loop dispatch. Guardrails, active registry lookup, trust, permission, validation, execution policy/effect claim, execution, redaction, and ledger/transcript handling remain separate from prompt serialization. `src/tools.ts:148-326` |
| Compaction/retry | Runtime | Auto-compaction runs before the first provider turn and rebuilds live history from summary plus retained messages; retry wraps only a provider request after assembly and does not retry observable output or tool failures. `src/agent-session/session.ts:1692-1746`, `src/session-stores.ts:133-162`, `src/agent-session/session.ts:1460-1493` |

### Current message order

`createDefaultPromptBuilder()` means final default provider messages are:

```text
context blocks -> skill catalog/body -> text tool catalog (text-only/unknown models) -> input-builder messages
```

For the input-builder messages:

| Layout | Order |
| --- | --- |
| `cache_aware` (code default) | instructions -> attachments/resources -> summaries -> history -> tool results -> current input |
| `legacy` | instructions -> summaries -> history -> current input -> attachments/resources -> tool results |

The stable system instructions are therefore not first in the final default message list when context or skills exist. This is the key reason Task 4 must change ordering deliberately rather than treating the existing `cache_aware` label as proof of a stable prefix. The code defaults to `cache_aware` in `src/input.ts:105-113` and `src/input.ts:196-197`; the final paragraph of `docs/input-and-prompt-assembly.md` still says cache-aware mode is opt-in, which is stale and contradictory.

## Existing primitive inventory

| Primitive | Location/use | Finding |
| --- | --- | --- |
| `sortJson()` | `src/input.ts:466-480`, called only by `renderPromptTemplate()` | Recursively sorts object keys and preserves array order. Private template-value formatting helper; no hash, cycle check, finite-number check, or trust-boundary limit. Not suitable as provider/schema identity primitive. |
| Strict `canonicalJson()` | `packages/policy/src/canonical.ts:28-79` | The strongest existing implementation: sorted object keys, preserved arrays, finite-number/undefined/BigInt/function/symbol/cycle rejection, and UTF-8 bytes. It is policy-package-local and throws `PolicyError`; core cannot import it without reversing the package dependency direction. |
| Workflow `stableStringify()` | `packages/workflows/src/util.ts:11-24` | Sorted object keys and preserved arrays, but relies on `JSON.stringify(sortValue())`; unsupported values are not uniformly rejected. Workflow-local fingerprint/checkpoint helper. |
| Coding checkpoint `stableStringify()` | `packages/coding-agent/src/coding-checkpoint.ts:769-791` | Package-local fingerprint helper with finite/unsupported checks, but JSON.stringify still defines undefined behavior and its error type is coding-agent-specific. |
| Other canonical copies | `packages/ag-ui/src/effect-recovery.ts:88-98`, `packages/supervisor/src/a2a-card.ts:138-154`, `packages/enterprise-postgres/src/erp-messaging.ts:400-409` | Multiple local implementations have different rejection/coercion rules. Do not add another provider-local copy. |
| Cache controls | `src/cache-helpers.ts:24-112` | `sanitizeCacheKey`, retention mapping, breakpoint selection, and `applyCacheControl()` already provide the cache-control seam. They preserve message order and add markers only; they do not canonicalize or hash. Breakpoint locations are positional/role-based (`system_prompt`, `tools`, `stable_context`, `last_stable_message`, `last_user_message`, `message_id`). |
| Prompt builders | `src/input.ts:105-155` | One default input builder and one default prompt builder; custom builders are explicit. Keep one assembly path and keep middleware ownership in the assembler/runtime. |
| Tool schema hash | `packages/tool-validator-json-schema/src/json-schema.ts:174-176`, used at `:218` | `stableSchemaHash()` is currently only `JSON.stringify(schema)`, so logically identical schemas with different insertion order miss the LRU cache. Schema byte/depth/property/ref/keyword/forbidden-key limits still run before compilation at `:114-172`; argument bounds run at `:178-203`. |
| OpenAI cache mapping | `packages/provider-openai/src/cache.ts:7-24` | Uses legacy `cacheKey`/`sessionId` and `cacheRetention`; it does not read nested `cache.key`/`cache.retention`. This is a provider-parity mapping gap, not a reason to sort messages. |

### Primitive decision

Later implementation tasks should add or promote **one** strict core canonical JSON/string primitive only if the cross-package use is confirmed. It should:

- sort object keys recursively and preserve array order, message order, tool order, and breakpoint order;
- reject cycles, non-finite numbers, undefined, BigInt, functions, and symbols rather than silently changing identity;
- be applied only after existing redaction and bounded-input checks, with existing depth/byte limits retained;
- serve schema cache keys and stable prompt/cache digests, without becoming a tool-authority or permission mechanism;
- replace package-local copies only where the dependency graph permits, rather than introducing a sixth serializer.

Task 4 should use this primitive for identity/digest assertions, not sort semantic message arrays. The OpenAI nested cache-key/retention mapping should be handled in the provider parity work (Plan 037).

## Serialized request measurement

### Method

The fixture assembled one `cache_aware` request containing stable system/developer instructions, one context block, one progressive skill, one attachment, one summary, two history messages, one tool result, one current input, and one declared tool. Tool-capable model metadata was used, so the text tool catalog was omitted and the declared schema stayed in `request.tools`. A fake `fetch` captured each provider body.

For each provider shape:

- `A` = baseline;
- `A'` = identical second assembly;
- `B` = only current user input changed;
- `C` = only dynamic context block changed;
- `D` = only the skill changed from catalog-only to loaded body;
- `sha256` = SHA-256 of `JSON.stringify(capturedBody)` encoded as UTF-8;
- `LCP` = byte length of the longest common prefix of the two JSON strings.

`LCP` is a reproducible serialized-byte diagnostic, not a provider token-cache guarantee. No credentials or network response data are included in the digest.

| Shape | Variant | Body bytes A -> variant | SHA-256 of A | SHA-256 of variant | LCP bytes | Identical |
| --- | --- | ---: | --- | --- | ---: | --- |
| OpenAI Responses | A -> A' | 1246 -> 1246 | `6d159f9688a289f60f29f09e06ca7a1ceca1e661896633a4cce5d2f4fdae24a6` | same | 1246 | yes |
| OpenAI Responses | A -> B (input) | 1246 -> 1254 | `6d159f9688a289f60f29f09e06ca7a1ceca1e661896633a4cce5d2f4fdae24a6` | `acd836815f64d7866694a280c672d755274610add2cbfc5467daea52fe3e2e0e` | 932 | no |
| OpenAI Responses | A -> C (context) | 1246 -> 1247 | `6d159f9688a289f60f29f09e06ca7a1ceca1e661896633a4cce5d2f4fdae24a6` | `50ab951847627bf6207dc5aea485b59db1e07257fd14792f1f600df8fd0d4` | 95 | no |
| OpenAI Responses | A -> D (loaded skill) | 1246 -> 1260 | `6d159f9688a289f60f29f09e06ca7a1ceca1e661896633a4cce5d2f4fdae24a6` | `112b158d17470001ab5eb4ed1aa99321d4fa98ac55dc9d439ffd8bb2b65db63c` | 193 | no |
| Anthropic Messages | A -> A' | 922 -> 922 | `1a137e7496a9e387b6d9c2b974d78306e364de0b4c589274dccfe477aaf2109a` | same | 922 | yes |
| Anthropic Messages | A -> B (input) | 922 -> 930 | `1a137e7496a9e387b6d9c2b974d78306e364de0b4c589274dccfe477aaf2109a` | `c6cd41c261023afa2826caa850de3dde1ea9edf94ba11ee1087873ffad175906` | 442 | no |
| Anthropic Messages | A -> C (context) | 922 -> 923 | `1a137e7496a9e387b6d9c2b974d78306e364de0b4c589274dccfe477aaf2109a` | `7c33b1fa903d0681534428f2e5dda65f2de6bd2805080dc54412782c1cc923cf` | 484 | no |
| Anthropic Messages | A -> D (loaded skill) | 922 -> 936 | `1a137e7496a9e387b6d9c2b974d78306e364de0b4c589274dccfe477aaf2109a` | `2dab341ed85a41250e72eda2fc1bf563f5cb3c8709943a81e36c145fc612d2c3` | 524 | no |
| Gemini generateContent | A -> A' | 854 -> 854 | `5cd38f7c599ba7f04d7d12ebc7ada310d98e7323503507f2963068e6a4e68464` | same | 854 | yes |
| Gemini generateContent | A -> B (input) | 854 -> 862 | `5cd38f7c599ba7f04d7d12ebc7ada310d98e7323503507f2963068e6a4e68464` | `b49ceed722b4702de26e8085dedb41840d2c27fb0a4ffacbf93595ec5f90fedc` | 349 | no |
| Gemini generateContent | A -> C (context) | 854 -> 855 | `5cd38f7c599ba7f04d7d12ebc7ada310d98e7323503507f2963068e6a4e68464` | `efcf7cd31ee7bf389d56ad84584d929965880ae90f47192f23b50bfd24701aee` | 420 | no |
| Gemini generateContent | A -> D (loaded skill) | 854 -> 868 | `5cd38f7c599ba7f04d7d12ebc7ada310d98e7323503507f2963068e6a4e68464` | `9c6b8326d59b77df4b31fc37db29cd27171f4e40036acc2bb3d5f96a1174822b` | 460 | no |
| OpenAI-compatible Chat Completions | A -> A' | 959 -> 959 | `bc9adc454ba2380616286230812773a290dc1236f25b5c8430e465936b170fbe` | same | 959 | yes |
| OpenAI-compatible Chat Completions | A -> B (input) | 959 -> 967 | `bc9adc454ba2380616286230812773a290dc1236f25b5c8430e465936b170fbe` | `7060baf79385aeaeb2895c894e8ec40c7f367b6721c57430535adc0497ce42ed` | 644 | no |
| OpenAI-compatible Chat Completions | A -> C (context) | 959 -> 960 | `bc9adc454ba2380616286230812773a290dc1236f25b5c8430e465936b170fbe` | `ab11ccd5fb0de0a4912428dc6e09c9bad52d00a08a67c24073de66f390cb0057` | 66 | no |
| OpenAI-compatible Chat Completions | A -> D (loaded skill) | 959 -> 973 | `bc9adc454ba2380616286230812773a290dc1236f25b5c8430e465936b170fbe` | `a697b4d5ac3dad8bcd010de83e6cf09201648d1720589f15b5f9d706c0d7a14a` | 133 | no |

The low context/skill LCP values are expected from the current prompt builder: dynamic context and skills are serialized before stable instructions. The figures are evidence for reordering, not evidence that any provider cache hit or missed.

## Tool-schema insertion-order fixture

The two schemas below are semantically identical and differ only in object insertion order:

```ts
const schemaA = {
  type: "object",
  properties: { query: { type: "string" }, limit: { type: "integer" } },
  required: ["query"],
  additionalProperties: false,
};
const schemaB = {
  additionalProperties: false,
  required: ["query"],
  properties: { limit: { type: "integer" }, query: { type: "string" } },
  type: "object",
};
```

Using the current `stableSchemaHash()` behavior (`JSON.stringify(schema)`):

```text
logicallyEqual                         true
hash(schemaA)                          8d2e3571a59674868f6ed8122660b5f1f0ac84c033ba3ca081e46d75e29c8476
hash(schemaB)                          35013120f3cbbcf364d1d99b5d2ee69788e9412f907ff4af207d2622e62aef34
current hashes match                   false
```

A strict canonical serializer would produce the same identity for both while preserving `required` array order:

```text
{"additionalProperties":false,"properties":{"limit":{"type":"integer"},"query":{"type":"string"}},"required":["query"],"type":"object"}
```

This is a cache-compilation correctness issue only. Schema validation bounds and active-tool/permission checks remain mandatory and must run independently of any digest.

## Documentation and provider findings

- OpenAI's current prompt-caching guidance says reusable prefixes require the entire rendered prefix to match, stable instructions/reference material should precede changing content, tool definitions/order/schema changes invalidate later reuse, and actual `cached_tokens`, `cache_write_tokens`, latency, and cost must be measured. Reference: <https://developers.openai.com/api/docs/guides/prompt-caching>.
- Anthropic's current guidance describes ordered `tools -> system -> messages` cache layers, explicit breakpoints on the last stable block, and a five-minute default/one-hour optional TTL. Reference: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>.
- Gemini's current guidance says implicit caching is automatic on supported models, common content should be at the beginning, and `usage.total_cached_tokens` is the runtime diagnostic. Reference: <https://ai.google.dev/gemini-api/docs/caching>.
- The local cache documentation correctly describes provider-owned best-effort behavior, but the input assembly page contains the default-vs-opt-in contradiction noted above.

## Review decision

Task 1 is complete. Task 4 may now change cache-aware ordering, but must preserve the explicit `legacy` branch, provider role/message validity, tool authority, redaction, budget, and middleware order. Task 4/Plan 037 may introduce the single strict core serializer and provider-specific nested cache-hint mapping; no additional provider-local canonicalization helper is justified by this review.

## Phase 36 end-to-end verification

Full release matrix executed on 2026-08-28 (Node v24.19.0, Linux x64) after Tasks 2-6 landed:

```text
npm run build                          PASS
focused root suites (tools, effects,   PASS (178 tests, 25 suites)
  tool-result fold, effect store,
  skills, skill load, skill disclosure,
  agent loops, durable loops,
  compaction, retry, input pipeline,
  context budget, run limits)
npm test                               PASS (dist suites + release/tooling/budget gates +
                                       phase8-34 conformance/freeze/security + benchmark
                                       0.1.0 + multi-agent-runtime + sweep-unused +
                                       e2e enterprise/coding journeys + quality gates +
                                       all workspace test suites)
npm run typecheck                      PASS (build + workspace tsc + examples)
npm run lint                           PASS (biome, no errors)
npm run format:check                   PASS (1247 files checked)
npm run security:threat-suites         PASS (50 tests, 0 fail; phase8-11 conformance +
                                       phase20-23 security suites)
```

Performance acceptance:

- Parallel tools retain >=1.75x speedup at concurrency 2: asserted in `scripts/benchmark-multi-agent.test.mjs:126`, executed inside `npm test`.
- Cache-prefix ordering fixtures and provider cache-behavior suites passed inside `npm test` (phase9/phase26 index benchmarks, budget gates).
- No benchmark ceiling regressed: `scripts/budget-gate.test.mjs` passed within `npm test`; the large-history (p95 3.708 ms) and 5k-delta (p95 5.847 ms) rows from Task 6 stayed within `scripts/budgets.json` ceilings.
- Dead/unused sweep: `scripts/sweep-unused.test.mjs` passed within `npm test`; no duplicate tool-effect, retry, provider-call, or prompt-builder path introduced by Phase 36 changes.

Security acceptance: threat suites (phase8 conformance through phase23 security) confirm tools, approvals, effects, MCP, sandbox, and prompt/context trust boundaries.
