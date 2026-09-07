# 066 — Provider request construction (session, cache, thinkingLevel) and 0.5.1 lockstep

## Objectives

- Make Prism construct a valid provider request for every Prism-owned generate site so hosts pick provider + model + intent and do **not** attach `createSessionCachePolicy` (or vendor headers) for request success.
- Close the 2026-09-07 defect class: provider-mandatory wire fields (OpenCode Go `x-opencode-session`) and cache/thinking quality knobs are implemented in adapters but only applied when the host opts in; observational-memory workers and LLM compaction bypass the agent-session policy chain.
- Ship P1–P3 in this plan: (P1) deterministic session correlation + adapter fail-fast, (P2) default cache breakpoints/retention from model cache capabilities, (P3) first-class `thinkingLevel` on `AgentConfig` / `RunOptions`.
- Apply the construction helper on **every** first-party provider the way that provider already maps options (no invented Azure/Bedrock/Vertex/AI SDK cache APIs).
- Observational memory uses a **derived** correlation id, fully separate from the agent session (workers may use a different model). LLM compaction uses the **agent session id** so summarization can hit the same prompt cache.
- Core public API changes → lockstep **0.5.1** for all 10 publishable Prism packages.

## Expected Outcome

- `session.run(input)` with no `providerRequestPolicies` sends `options.sessionId` / `options.cacheKey` equal to `session.id`. OpenCode Go always emits `x-opencode-session`. Missing correlation on a raw `provider.generate()` to OpenCode Go fails closed with `ProviderRequirementError` / `ERR_PRISM_PROVIDER_REQUIREMENT` **before fetch**, not as an opaque upstream 400.
- OM worker requests use `om:{session.id}` (sanitized by existing `sanitizeCacheKey` at the adapter). Compaction requests use `context.sessionId` (agent session).
- Cache-control / explicit-breakpoint models get default `{ system_prompt, last_stable_message }` breakpoints and `cacheRetention: "short"` unless the host set `cache.mode: "off"`, `cacheRetention: "none"`, or explicit breakpoints. Implicit / host-owned cache providers emit no new markers.
- `createAgent({ thinkingLevel: "low" })` / `session.run(input, { thinkingLevel: "low" })` calls existing `applyThinkingLevelForModel`; hosts stop hand-merging compat for the portable ladder.
- `createSessionCachePolicy` remains a host overlay (Clay keep-working). Package-policy auto-activation and `AIProvider.generate` wrapping are **not** built.
- All 10 manifests `0.5.0` → `0.5.1`, internal ranges `^0.5.0` → `^0.5.1`. Docs, CHANGELOG, migrate-to-0.5, index, and export contracts match.

## Frozen decisions (do not reopen in later tasks)

| Decision | Value |
| --- | --- |
| Construction vs policy | Kernel **fills missing** `sessionId`/`cacheKey` (and later cache/thinking). Host `providerOptions` then host policies overlay. Policies never required for success. |
| Registry | `registerProviderRequestPolicy` stays unused. Do not auto-activate package policies. |
| Escape hatch | Direct `AIProvider.generate()` is low-level. Prism does not wrap it. OpenCode Go fail-fast is the safety net. |
| OM correlation | `om:{attachedSession.id}` shared by observer/reflector/dropper of that attach. Worker `model`/`provider` stay independently configurable. |
| Compaction correlation | Agent `context.sessionId`. |
| Identity invention | Adapters never mint UUIDs. Empty correlation → omit (most providers) or typed throw (OpenCode Go). |
| Mandate framework | No generic `mandatoryRequestFields` manifest. One typed error + adapter check. |
| Host-owned cache | Azure, Bedrock, Vertex, AI SDK: options may carry sessionId; **no new wire cache fields**. |
| Deferred (pre-existing) | Command Code GPT-5.6 `prompt_cache_key`; Anthropic `tools[]` schema `cache_control`. |

## Tasks

- [x] 1. Primitive review: request-construction inventory + per-provider expected-wire matrix
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase66-primitive-review.md` inventories existing primitives (`assembleProviderInput` dropping `sessionId`, `applyProviderRequestPolicies` host-only, `createSessionCachePolicy`, unused `registerProviderRequestPolicy`, `mergeProviderRequestOptions`, `applyCacheControl` / `resolveBreakpoint`, `sanitizeCacheKey`, `applyThinkingLevelForModel`, `assertStructuredOutputRequestSupported` / `StructuredOutputError`, per-adapter session/cache maps) and states which **one** new core primitive is required (`applyDefaultProviderRequestOptions` + `ProviderRequirementError`) versus what must stay provider-local (wire headers/body fields).
    - Functional: the record includes the frozen per-provider P1/P2/P3 wire matrix below (copied into the evidence file, not redesigned later).
    - Performance: document-only; no production code.
    - Code Quality: later tasks cite this record; no second options tree; no policy auto-activation; no generate() wrapper.
    - Security: session/cache keys are correlation ids, never secrets; error messages redacted; provider-owned headers stay after caller headers.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-packages.md` (hosts-decide policies, ~L104); `docs/provider-request-policies.md`; `docs/provider-caching.md`; `docs/thinking-and-reasoning.md`; `docs/_evidence/phase37-provider-matrix.md`; `docs/providers/opencode-go.md`; `docs/compaction-llm.md`; `docs/compaction-observational-memory.md`; `docs/use-case-model-selection.md`; `docs/migrate-to-0.5.md`; `2026-09-07` defect analysis in this session; plan 065 primitive-review precedent (`docs/_evidence/phase65-primitive-review.md`).
      - Code: `src/provider-request-policy.ts`, `src/input.ts` (`assembleProviderInput`), `src/agent-session/session.ts` (`applyProviderRequestPolicies`), `src/agent-session/session/assemble.ts`, `src/thinking.ts`, `src/cache-helpers.ts`, `packages/memory/src/compaction/llm/strategy.ts` (`runSummaryProvider`), `packages/memory/src/compaction/observational-memory/worker-loop.ts`, `packages/prism-providers/src/*/cache.ts` and session header helpers.
    - Options Considered:
      - Auto-activate package-registered `createSessionCachePolicy` (rejected — registry unread; OM/compaction still miss; still opt-in-shaped).
      - Wrap every `AIProvider.generate` (rejected — hides missing ids; breaks explicit test requests).
      - Generic mandatory-field manifest (rejected — one boolean today; adapter is source of truth).
      - Kernel fill-if-missing + adapter map/fail-fast (chosen).
    - Chosen Approach: one core helper consumed at every Prism generate site; adapters keep mapping; OpenCode Go throws if still empty; evidence file freezes the per-provider table so Tasks 5–7 do not invent mappings.
    - API Notes and Examples:
      ```ts
      // Target core surface (Task 2 implements):
      applyDefaultProviderRequestOptions(request, {
        sessionId,            // required for Prism-owned sites
        thinkingLevel,        // Task 7; optional
        defaultCache: true,   // Task 6; P2
      }) => ProviderRequest  // fill-if-missing only

      new ProviderRequirementError(message, { providerId, requirement: "sessionId" })
      // error.code === "ERR_PRISM_PROVIDER_REQUIREMENT"
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase66-primitive-review.md`: new evidence record (inventory, rejected options, frozen matrix, per-task primitive assignments).
    - References:
      - Plan 065 Task 1; `docs/_evidence/phase37-provider-matrix.md`; `src/structured-output.ts` fail-fast precedent; OpenCode Go `opencodeSessionId` / `opencodeOwnedHeaders`.
  - Test Cases to Write:
    - None (document task). Tasks 2–7 encode the matrix.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (design record for Task 2 API).
    - Docs pages to create/edit:
      - `docs/_evidence/phase66-primitive-review.md`: evidence, not indexed.
    - `docs/index.md` update: no (evidence artifact).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  Frozen per-provider matrix (copy into the evidence file):

  | Adapter | P1 session/cache-key wire | Mandatory | P2 default cache | P3 thinking (plan 065 already maps; session field must reach it) |
  | --- | --- | --- | --- | --- |
  | openai | `prompt_cache_key` from `cacheKey??sessionId`; `x-client-request-id` from `sessionId` | no | GPT-5.6+ `explicitBreakpoints` → `prompt_cache_breakpoint`; retention 24h still gated | `reasoning.effort` |
  | anthropic | `x-client-request-id` from `sessionId` | no | `cache_control` on `system_prompt` + `last_stable_message` | `thinking` + `output_config.effort` |
  | google | `x-client-request-id` from `sessionId` | no | none (no Prism markers) | `thinkingConfig` |
  | openrouter | `x-session-id` + body `session_id` | no | default breakpoints → **per-message** `cache_control` (replaces no-breakpoint top-level automatic) | `reasoning.effort` |
  | opencode-go | `x-opencode-session` from `cacheKey??sessionId` | **yes** | Anthropic route: `cache_control` markers; OpenAI route: none | route-native |
  | xai | `x-grok-conv-id` from `cache.key??cacheKey??sessionId` | no | implicit; header is the correlation | `reasoning_effort` |
  | alibaba | none | no | only if `model.cache.kind === "cache_control"` | `enable_thinking` |
  | kimi | none extra | no | Anthropic/Coding route: `cache_control`; Moonshot: none | `thinking` / `reasoning_effort` |
  | hyper | Responses: `prompt_cache_key`; chat/Anthropic: no session header | no | Anthropic: `cache_control`; Responses: openai_key rules; chat: implicit | route-native |
  | commandcode | none | no | Anthropic: `cache_control`; OpenAI: implicit (**no** `prompt_cache_key`, existing defer) | route-native |
  | deepseek | none | no | implicit, no markers | `thinking` + `reasoning_effort` |
  | zai | none | no | implicit, no markers | `thinking` + `reasoning_effort` |
  | neuralwatt | none | no | implicit, no markers | `reasoning_effort` |
  | ollama | none | no | implicit, no markers | `reasoning_effort` |
  | clinepass | none; strips `cache_control` | no | implicit, no markers | slot-map `reasoning_effort` |
  | azure | none | no | host-owned, no Prism cache fields | existing `buildBodyExtra` |
  | bedrock | none | no | host-owned | existing `buildBodyExtra` |
  | vertex | none | no | host-owned | existing `buildBodyExtra` |
  | ai-sdk | none | no | host-owned | noop family |

- [x] 2. Core primitive: `applyDefaultProviderRequestOptions` + `ProviderRequirementError`
  - Acceptance Criteria:
    - Functional: helper fill-if-missing `options.sessionId` and `options.cacheKey` from `ctx.sessionId`; never overwrites host-set values; no-op when `ctx.sessionId` is empty/undefined and request already has none.
    - Functional: `ProviderRequirementError` with frozen `code: "ERR_PRISM_PROVIDER_REQUIREMENT"`, `requirement`, optional `providerId`; message contains no secrets; exported from `@arnilo/prism`.
    - Functional: P2/P3 knobs exist as optional helper flags/fields but **do nothing** until Tasks 6–7 (or are unimplemented parameters not yet wired — prefer not to add dead flags; Task 6/7 extend the same function).
    - Performance: pure merge; no I/O; reuse `mergeProviderRequestOptions`.
    - Code Quality: live next to `createSessionCachePolicy` in `src/provider-request-policy.ts` (or a sibling file re-exported from it); `createSessionCachePolicy` behavior unchanged.
    - Security: no env/credential reads; cache keys treated as non-secrets (same as today).
  - Approach:
    - Documentation Reviewed:
      - `src/provider-request-policy.ts`; `src/structured-output.ts` (`StructuredOutputError`); `src/index.ts` export surface; `src/__tests__/public-export-contract.test.ts`.
    - Options Considered:
      - New module `src/provider-request-defaults.ts` (acceptable if policy file stays small; default is extend `provider-request-policy.ts`).
      - Mutate `createSessionCachePolicy` into the default (rejected — keep overlay semantics for Clay).
    - Chosen Approach: add helper + error beside existing merge; export both; tests are node:test asserts, no extra framework.
    - API Notes and Examples:
      ```ts
      import { applyDefaultProviderRequestOptions, mergeProviderRequestOptions } from "@arnilo/prism";

      const next = applyDefaultProviderRequestOptions(request, { sessionId: session.id });
      // next.options.sessionId === request.options?.sessionId ?? session.id
      // next.options.cacheKey === request.options?.cacheKey ?? next.options.sessionId
      ```
    - Files to Create/Edit:
      - `src/provider-request-policy.ts`: helper (and error, or `src/provider-requirement.ts` if cleaner).
      - `src/index.ts`: export helper, error, types.
      - `src/__tests__/provider-request-policy.test.ts` (or existing policy test file if present): helper tests.
      - `src/__tests__/public-export-contract.test.ts`: add export names.
      - `src/__tests__/public-contracts.test.ts`: add if it enumerates policy helpers.
    - References:
      - Task 1 evidence; `mergeProviderRequestOptions` (`src/provider-request-policy.ts:49-74`).
  - Test Cases to Write:
    - empty options + sessionId → both `sessionId` and `cacheKey` set to that id.
    - host `sessionId` preserved; `cacheKey` filled from host sessionId if cacheKey missing.
    - host `cacheKey` preserved even when different from sessionId.
    - missing ctx.sessionId + empty options → request unchanged.
    - `ProviderRequirementError.code === "ERR_PRISM_PROVIDER_REQUIREMENT"`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new exports).
    - Docs pages to create/edit:
      - `docs/provider-request-policies.md`: add API sections for helper + error (full api-page subsections). Task 8 owns the contract rewrite prose; this task may add a stub or wait until Task 8 — **prefer Task 8 for prose**, this task only if docs.test requires the new export name immediately (it does: `src/__tests__/docs.test.ts` lists public symbols). Include the symbol names here; Task 8 writes the host-facing contract.
    - `docs/index.md` update: no until Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`; `docs/api-page-template.md`.

- [x] 3. P1 choke points: agent session + assembler always stamp `session.id`
  - Acceptance Criteria:
    - Functional: agent `session.run` / `stream` with **zero** `providerRequestPolicies` produces `ProviderRequest.options.sessionId === session.id` and `cacheKey` defaulted to that id before `generateProviderTurn`.
    - Functional: `assembleProviderInput` copies `options.sessionId` into `request.options.sessionId` when the assembler argument is set (fill-if-missing).
    - Functional: host `providerOptions.sessionId` / `cacheKey` and `createSessionCachePolicy({ cacheKey, retention })` still win (policy chain after defaults).
    - Functional: `applyProviderRequestPolicies` may stay host-only; defaults do **not** depend on the unread kernel policy registry.
    - Performance: one merge per turn; no extra provider I/O.
    - Code Quality: call `applyDefaultProviderRequestOptions` once on the agent generate path (after assemble, before or wrapping policies). Do not duplicate stamp logic in `assemble.ts` and `session.ts`.
    - Security: session id is already a public session identifier; do not log full request bodies.
  - Approach:
    - Documentation Reviewed:
      - `src/input.ts` (`assembleProviderInput` returns `options: options.providerOptions`); `src/agent-session/session.ts:461-472`; `src/agent-session/session/assemble.ts` generate loop; `src/agent-session/session/provider-round.ts` (`generateProviderTurn`).
    - Options Considered:
      - Stamp only in assemble (rejected — OM/compaction do not assemble).
      - Stamp only in `generateProviderTurn` (weaker — loops/`ctx.generate` should see stamped request too).
      - Stamp in assemble **and** helper at session policy site (chosen: assembler honesty + session helper with `this.id`; helper is idempotent).
    - Chosen Approach: assembler fill-if-missing from its `sessionId` argument; agent session always runs helper with `sessionId: this.id` then existing policy chain.
    - API Notes and Examples:
      ```ts
      const assembled = await assembleProviderInput({ sessionId: this.id, providerOptions, ... });
      const stamped = applyDefaultProviderRequestOptions(assembled, { sessionId: this.id });
      const { request } = await this.applyProviderRequestPolicies(stamped, ...);
      ```
    - Files to Create/Edit:
      - `src/input.ts`: merge sessionId into request options.
      - `src/agent-session/session.ts` and/or `src/agent-session/session/assemble.ts`: call helper.
      - `src/__tests__/agents.test.ts` (or a focused new test file): no-policy sessionId assertion; overlay cases.
    - References:
      - Task 2 helper; `createSessionCachePolicy` overlay semantics.
  - Test Cases to Write:
    - capturing mock provider: no policies → `request.options.sessionId === session.id`.
    - host `providerOptions.sessionId: "custom"` wins.
    - `createSessionCachePolicy({ cacheKey: "custom", retention: "long" })` still sets cacheKey/retention.
    - assembler-only: `assembleProviderInput({ sessionId: "s1" })` options include `sessionId: "s1"`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (default request construction; additive).
    - Docs pages to create/edit: Task 8 (`docs/agent-session-runtime.md`, `docs/input-and-prompt-assembly.md`).
    - `docs/index.md` update: Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 4. P1 memory sites: OM derived id; compaction = agent session id
  - Acceptance Criteria:
    - Functional: `runMemoryWorkerLoop` / observer / reflector / dropper requests have `options.sessionId === "om:" + attachedSession.id` (and `cacheKey` defaulted) unless host `providerOptions.sessionId` already set.
    - Functional: OM workers may use a different `model`/`provider` than the agent (existing worker config); derived id does not couple models.
    - Functional: `runSummaryProvider` always runs the helper with `context.sessionId` even when `providerRequestPolicies` is empty; compaction cache key matches the agent session.
    - Functional: existing thinkingLevel application on workers still runs (compose with helper; do not drop `applyThinkingLevelForModel`).
    - Performance: no extra generate calls; one merge per worker turn / summary call.
    - Code Quality: pass `sessionId` through `MemoryWorkerLoopOptions` and worker runners from `runtime.ts` (`options.session.id` already available). Do not invent a second session object.
    - Security: derived id is not a credential; keep worker secret redaction.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/src/compaction/observational-memory/worker-loop.ts:52-63`; `runtime.ts` (`session: AgentSession`); `workers/observer.ts` / `reflector.ts` / `dropper.ts`; `packages/memory/src/compaction/llm/strategy.ts:149-201`; `docs/use-case-model-selection.md`.
    - Options Considered:
      - Same id as agent for OM (rejected — user: fully separate, separate model).
      - Per-worker suffix `om:{id}:observation` (rejected for P1 — extra cache fragmentation; add later if collisions appear).
      - `om:{session.id}` shared across OM workers (chosen).
    - Chosen Approach: `const omSessionId = options.providerOptions?.sessionId ?? \`om:${session.id}\`` then helper. Compaction: helper with `context.sessionId` **before** optional strategy policies.
    - API Notes and Examples:
      ```ts
      // runtime flush → worker-loop
      await runMemoryWorkerLoop({
        ...worker,
        sessionId: `om:${options.session.id}`,
      });

      // compaction
      request = applyDefaultProviderRequestOptions(request, { sessionId: context.sessionId });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/worker-loop.ts`
      - `packages/memory/src/compaction/observational-memory/runtime.ts`
      - `packages/memory/src/compaction/observational-memory/workers/{observer,reflector,dropper}.ts` (pass-through if loop takes sessionId)
      - `packages/memory/src/compaction/llm/strategy.ts`
      - `packages/memory/src/compaction/observational-memory/__tests__/workers.test.ts`
      - LLM compaction tests (existing strategy test file)
    - References:
      - Task 2; `sanitizeCacheKey` allows `:`; OpenCode max length still fits `om:` + UUID.
  - Test Cases to Write:
    - OM capturing provider: `options.sessionId === "om:s1"` when attached session id is `s1`.
    - OM host `providerOptions.sessionId` wins.
    - compaction capturing provider: `options.sessionId === context.sessionId` with empty policies.
    - compaction with `createSessionCachePolicy({ cacheKey: "x" })` still overlays.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (worker request options).
    - Docs pages to create/edit: Task 8 (`docs/compaction-observational-memory.md`, `docs/compaction-llm.md`).
    - `docs/index.md` update: Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. P1 adapters: OpenCode Go fail-fast + every provider session mapping verified
  - Acceptance Criteria:
    - Functional: `createOpenCodeGoProvider().generate` without resolvable `cacheKey??sessionId` throws `ProviderRequirementError` **before** `fetch`; no HTTP.
    - Functional: with stamped sessionId, every adapter in the Task 1 matrix emits the documented P1 wire field (or correctly emits none).
    - Functional: provider-owned headers still win over caller `x-opencode-session` / `x-session-id` / `x-client-request-id` / `x-grok-conv-id` (existing tests stay green).
    - Functional: no new session/cache wire fields on azure, bedrock, vertex, ai-sdk, deepseek, zai, neuralwatt, ollama, clinepass, commandcode OpenAI route, alibaba implicit models.
    - Performance: one cheap string check on OpenCode Go; no extra I/O.
    - Code Quality: adapters keep mapping functions; core does not switch on provider id.
    - Security: fail-fast message names the requirement and provider id, not request bodies or keys.
  - Approach:
    - Documentation Reviewed:
      - Task 1 matrix; `packages/prism-providers/src/opencode-go/cache.ts` (`opencodeSessionId`, `opencodeOwnedHeaders`); `provider.ts` generate; openai `promptCacheKey` + responses headers; anthropic/google owned headers; openrouter `openRouterSessionId`; xai `xGrokConvId`; hyper responses tests for `prompt_cache_key`; phase37 matrix.
    - Options Considered:
      - Fail-fast in core helper when a model flag is set (rejected — no mandate manifest).
      - Adapter throw at generate start (chosen).
    - Chosen Approach: OpenCode Go checks `opencodeSessionId` first thing in `generate` (after abort check). Other adapters: add/adjust **offline** tests that a request with only `options.sessionId` (no host cache policy) produces the mapped header/body field. If a listed mapping is missing in code, implement the existing intended map (do not invent new vendor fields).
    - API Notes and Examples:
      ```ts
      const sessionId = opencodeSessionId(request.options);
      if (!sessionId) {
        throw new ProviderRequirementError(
          "opencode-go requires session correlation (options.sessionId → x-opencode-session)",
          { providerId: id, requirement: "sessionId" },
        );
      }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/opencode-go/provider.ts` (and/or `cache.ts`)
      - `packages/prism-providers/src/opencode-go/__tests__/opencode-go.test.ts`
      - Per-adapter tests (add one “sessionId-only maps to wire” case where mapping exists):
        - `packages/prism-providers/src/openai/__tests__/openai.test.ts`
        - `packages/prism-providers/src/anthropic/__tests__/anthropic.test.ts`
        - `packages/prism-providers/src/google/__tests__/google.test.ts`
        - `packages/prism-providers/src/openrouter/__tests__/openrouter.test.ts`
        - `packages/prism-providers/src/xai/__tests__/xai.test.ts`
        - `packages/prism-providers/src/hyper/__tests__/hyper.test.ts` (Responses `prompt_cache_key`)
        - implicit/host-owned suites: assert **absence** of foreign cache/session fields when only sessionId is set (`alibaba`, `kimi` moonshot, `deepseek`, `zai`, `neuralwatt`, `ollama`, `clinepass`, `commandcode` OpenAI, `azure`, `bedrock`, `vertex`, `ai-sdk`)
      - Adapter source files **only if** a matrix mapping is actually missing (tentative: none expected beyond OpenCode Go throw).
    - References:
      - Task 1 matrix; existing owned-header tests (attacker header overwritten).
  - Test Cases to Write:
    - opencode-go: no sessionId → `ProviderRequirementError`, fetch not called.
    - opencode-go: `options.sessionId` only → `x-opencode-session` sanitized.
    - openai: sessionId only → `prompt_cache_key` + `x-client-request-id`.
    - anthropic/google: sessionId only → `x-client-request-id`.
    - openrouter: sessionId only → header + body `session_id`.
    - xai: sessionId only → `x-grok-conv-id`.
    - hyper responses: sessionId only → `prompt_cache_key`.
    - deepseek/zai/neuralwatt/ollama/clinepass/azure/bedrock/vertex/ai-sdk: sessionId only → no new cache wire fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (OpenCode Go fail-closed; others additive headers when session stamped).
    - Docs pages to create/edit: Task 8 (`docs/providers/opencode-go.md` and each provider page’s cache/session note).
    - `docs/index.md` update: Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. P2: default cache breakpoints + short retention
  - Acceptance Criteria:
    - Functional: helper (now with cache defaults) when `model.cache.kind` is `cache_control` **or** `model.cache.explicitBreakpoints` is true, and host did not set `cache.mode: "off"` / `cacheRetention: "none"` / non-empty `cache.breakpoints`: sets `cacheRetention` default `"short"` (if unset) and `cache.breakpoints` to `[{ location: "system_prompt" }, { location: "last_stable_message" }]`.
    - Functional: implicit / `none` / host-owned models: **no** breakpoints added.
    - Functional: host-supplied breakpoints concatenated/respected (do not replace a non-empty list).
    - Functional: every cache_control adapter in the matrix emits markers on those two locations **without** the host passing breakpoints (agent-session path or request that already has cache_aware messages including a system message).
    - Functional: OpenRouter with defaults uses **per-message** markers, not top-level automatic `cache_control` (update tests that currently assert top-level automatic when no breakpoints).
    - Functional: clinepass still strips `cache_control`; openai explicitBreakpoints models get `prompt_cache_breakpoint`; openai non-explicit families do not.
    - Performance: no extra model I/O; breakpoint resolve is existing O(messages).
    - Code Quality: defaults live in the core helper using `model.cache` data only; adapters unchanged except tests / OpenRouter expectation.
    - Security: do not put secrets in cache keys; `sanitizeCacheKey` unchanged.
  - Approach:
    - Documentation Reviewed:
      - `src/cache-helpers.ts` (`applyCacheControl`, `resolveBreakpoint`); `docs/provider-caching.md`; phase37 matrix; OpenRouter `openRouterTopLevelCacheControl`; anthropic/kimi/hyper/commandcode/opencode-go/alibaba `apply*CacheControl` (all no-op when breakpoints empty).
    - Options Considered:
      - Default only inside assembler groups (more precise, but OM/compaction would miss).
      - Default in helper from `model.cache` (chosen — same rule every generate site; `resolveBreakpoint` no-ops missing system messages).
    - Chosen Approach: extend `applyDefaultProviderRequestOptions` with cache fill-if-missing from `request.model.cache`. Agent session, OM, compaction already call the helper (Tasks 3–4).
    - API Notes and Examples:
      ```ts
      applyDefaultProviderRequestOptions(request, { sessionId });
      // cache_control model, empty cache →
      // options.cacheRetention === "short"
      // options.cache.breakpoints === [{ location: "system_prompt" }, { location: "last_stable_message" }]
      ```
    - Files to Create/Edit:
      - `src/provider-request-policy.ts` (helper)
      - `src/__tests__/provider-request-policy.test.ts`
      - Adapter cache tests listed in Task 5 (flip “no breakpoints → no markers” to “kernel defaults → markers” **only** for cache_control / explicitBreakpoints models)
      - `packages/prism-providers/src/openrouter/__tests__/openrouter.test.ts`
      - `packages/prism-providers/src/openai/__tests__/openai.test.ts` (explicit vs implicit families)
      - `docs/_evidence/phase37-provider-matrix.md`: note default breakpoints (Task 8 may own prose; this task updates the matrix row if the freeze test hashes it — check `scripts/phase37-provider-matrix.test.mjs`)
    - References:
      - Task 1 P2 column; `mapCacheRetention`.
  - Test Cases to Write:
    - cache_control model + empty options → two default breakpoints + short retention.
    - `cache.mode: "off"` or `cacheRetention: "none"` → no defaults.
    - host breakpoints non-empty → unchanged.
    - implicit model → no breakpoints.
    - anthropic/opencode-go anthropic/kimi coding/hyper anthropic/commandcode anthropic/alibaba cache_control: system + last-stable markers present without host breakpoints.
    - openrouter: default breakpoints → message markers, `body.cache_control` undefined.
    - openai GPT-5.6+ explicit: `prompt_cache_breakpoint` on selected blocks; older family: none.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (default cache quality).
    - Docs pages to create/edit: Task 8 (`docs/provider-caching.md`, per-provider cache sections, phase37 matrix).
    - `docs/index.md` update: Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 7. P3: first-class `thinkingLevel` on `AgentConfig` / `RunOptions`
  - Acceptance Criteria:
    - Functional: optional `thinkingLevel?: string` on `AgentConfig` and `RunOptions`; run value overrides agent value; passed through helper via `applyThinkingLevelForModel(request.options, level, request.model)`.
    - Functional: `session.run(input, { thinkingLevel: "low" })` with no `providerOptions.compat` produces the same compat patch as today’s `applyThinkingLevelForModel(undefined, "low", model)`.
    - Functional: host `providerOptions` merge **then** thinkingLevel patch (intent wins over stale agent compat); policies still run after and may overlay.
    - Functional: omitted/undefined thinkingLevel → no invented compat (non-reasoning / noop family unchanged).
    - Functional: memory workers already have `thinkingLevel`; keep using it; do not require AgentConfig field there.
    - Performance: existing snap/merge only.
    - Code Quality: no second thinking API; reuse `src/thinking.ts`. Do not add thinkingLevel to `ProviderRequestOptions` (compat remains the wire bag).
    - Security: level is a non-secret enum/string; snap still prevents illegal wire values (plan 065).
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/agent.ts` (`AgentConfig`); `src/contracts-protocol.ts` (`RunOptions`); `src/thinking.ts`; `src/structured-output.ts` (`resolveRunProviderOptions`); `docs/thinking-and-reasoning.md` (currently tells hosts to wrap `providerOptions`).
    - Options Considered:
      - Keep helper-only API (rejected — user P3: host-simple intent).
      - Field on `ProviderRequestOptions` (rejected — that’s the vendor bag; intent belongs on agent/run).
    - Chosen Approach: add the field; agent generate path passes `run.thinkingLevel ?? config.thinkingLevel` into the helper after session/cache defaults.
    - API Notes and Examples:
      ```ts
      createAgent({ model, provider, thinkingLevel: "low" });
      await session.run(input); // low
      await session.run(input, { thinkingLevel: "high" }); // high this run
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`
      - `src/contracts-protocol.ts` (and `src/contracts.ts` re-export if needed)
      - `src/provider-request-policy.ts` helper
      - `src/agent-session/session.ts` / `assemble.ts`
      - `src/__tests__/agents.test.ts` or thinking tests
      - `src/__tests__/public-contracts.test.ts` if it snapshots AgentConfig keys
      - Provider thinking tests: one session-level capturing test is enough in core; per-provider wire remains plan 065 conformance (`thinking-conformance.test.ts`). Add **one** adapter smoke only if a family would not see compat from session options (should not happen).
    - References:
      - Plan 065; `applyThinkingLevelForModel`; Task 1 P3 column.
  - Test Cases to Write:
    - agent thinkingLevel `"low"` → request.options.compat matches `applyThinkingLevelForModel`.
    - run thinkingLevel overrides agent.
    - undefined → no thinking compat invented on a noop/non-reasoning model.
    - `thinkingLevel: "high"` on a catalog model still snaps (reuse a stamped test model).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (`AgentConfig` / `RunOptions`).
    - Docs pages to create/edit: Task 8 (`docs/thinking-and-reasoning.md` primary; `docs/agent-session-runtime.md`).
    - `docs/index.md` update: Task 8 (thinking blurb).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 8. Docs, examples, migration, index
  - Acceptance Criteria:
    - Functional: contract rewrite — Prism enforces request success (session correlation, cache defaults, thinking intent); hosts still own credentials, OAuth, env, extra headers, custom cacheKey, `compat`/`extra` overlays.
    - Functional: every first-party provider page states P1 wire + whether session is mandatory + P2 default cache behavior.
    - Functional: `docs/index.md` navigation blurbs updated for provider-request-policies, thinking, caching, compaction, provider-packages; current line mentions 0.5.1 when Task 10 bumps (this task may say “upcoming 0.5.1” if bump is last — **coordinate**: write 0.5.1 as the release this plan ships).
    - Functional: `docs.test.ts` symbol lists include new exports; docs examples compile against the new contract (no required `createSessionCachePolicy` in provider-package skeleton).
    - Performance: n/a (docs).
    - Code Quality: follow `docs/api-page-template.md` sections for new APIs on existing pages (no extra page unless a page would exceed one concern — keep helper on `provider-request-policies.md`).
    - Security: document that session/cache keys are not secrets; OpenCode Go fail-fast does not leak bodies.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-packages.md:104` and skeleton `registerProviderRequestPolicy`; `docs/provider-request-policies.md`; `docs/thinking-and-reasoning.md`; `docs/provider-caching.md`; `docs/agent-session-runtime.md`; `docs/input-and-prompt-assembly.md`; `docs/compaction-llm.md`; `docs/compaction-observational-memory.md`; `docs/use-case-model-selection.md`; `docs/providers/*.md`; `docs/_evidence/phase37-provider-matrix.md`; `docs/migrate-to-0.5.md`; `docs/migration.md`; `docs/index.md`; `docs/api-page-template.md`; `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - New `docs/provider-request-construction.md` (rejected — helper belongs with policies/caching; avoid index sprawl).
      - Update existing pages (chosen).
    - Chosen Approach: rewrite the hosts-decide sentence; demote `createSessionCachePolicy` to overlay; document OM `om:{id}` vs compaction same-id; thinkingLevel examples replace `applyThinkingLevelForModel` as the **session** entry point (helper remains for custom generate sites).
    - API Notes and Examples:
      ```ts
      // After 0.5.1 — no session cache policy required
      const agent = createAgent({ model, provider, thinkingLevel: "low" });
      const session = agent.createSession();
      await session.run("hello");
      ```
    - Files to Create/Edit:
      - `docs/provider-packages.md`
      - `docs/provider-request-policies.md`
      - `docs/thinking-and-reasoning.md`
      - `docs/provider-caching.md`
      - `docs/agent-session-runtime.md`
      - `docs/input-and-prompt-assembly.md`
      - `docs/compaction-llm.md`
      - `docs/compaction-observational-memory.md`
      - `docs/use-case-model-selection.md`
      - `docs/providers/openai.md`, `anthropic.md`, `google.md`, `openrouter.md`, `opencode-go.md`, `xai.md`, `alibaba.md`, `kimi.md`, `hyper.md`, `commandcode.md`, `deepseek.md`, `zai.md`, `neuralwatt.md`, `ollama.md`, `clinepass.md`, `azure.md`, `bedrock.md`, `vertex.md`, `ai-sdk.md`, `openai-compatible.md`
      - `docs/_evidence/phase37-provider-matrix.md`
      - `docs/migrate-to-0.5.md` (new **0.5.1** section: additive construction; Clay may drop host policy; OpenCode Go typed error vs 400)
      - `docs/migration.md` (pointer)
      - `docs/index.md`
      - `examples/cache-aware-prompt-assembly.ts` (optional sessionId still valid; comment that agent sessions stamp it)
      - `src/__tests__/docs.test.ts` (symbol / snippet assertions)
    - References:
      - prism-wiki requirements; api-page-template; Task 1 matrix.
  - Test Cases to Write:
    - `docs.test.ts` updates for new export names and rewritten snippets (`createSessionCachePolicy` still documented as overlay, not required in package setup skeleton).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (this task **is** the docs).
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — Provider request policies blurb (defaults + overlay); Thinking blurb (`thinkingLevel` on agent/run); Provider packages blurb (Prism constructs valid requests); Compaction blurbs (OM derived id / compaction same id).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 9. Verification gates (pre-bump)
  - Acceptance Criteria:
    - Functional: `npm test` (root + workspaces), `npm run typecheck`, `npm run lint`, `npm run format:check` green.
    - Functional: provider workspace tests green including new session/cache cases; thinking conformance still walks catalog models.
    - Functional: `scripts/phase37-provider-matrix.test.mjs` green if matrix text changed.
    - Performance: no new network in default CI; live tests remain `PRISM_LIVE_PROVIDER_TESTS=1` gated. Optional: one OpenCode Go live smoke that a policy-less `session.run` is not 400 (skip if no key).
    - Code Quality: public export contract and docs tests green; no unused new exports.
    - Security: secret-leak / owned-header tests still green; fail-fast path does not fetch.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts; `scripts/phase37-provider-matrix.test.mjs`; plan 065 conformance file path (`thinking-conformance.test.ts`).
    - Options Considered:
      - Defer live OpenCode Go (default — gated). Record skip.
    - Chosen Approach: full offline gates; live optional.
    - API Notes and Examples:
      ```sh
      npm run typecheck && npm run lint && npm test
      npm test --workspaces --if-present
      ```
    - Files to Create/Edit:
      - none unless a gate forces a freeze-file update (`docs/_evidence/...`).
    - References:
      - Tasks 2–8.
  - Test Cases to Write:
    - none new; run the ones already added.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [x] 10. Lockstep 0.5.1 bump for all Prism packages
  - Acceptance Criteria:
    - Functional: all 10 publishable manifests `0.5.0` → `0.5.1`; internal first-party dependency ranges `^0.5.0` → `^0.5.1`; lockfile regenerated.
    - Functional: `CHANGELOG.md` has a `## [0.5.1]` section describing P1–P3 (construction, OM derived id, compaction same id, thinkingLevel field, OpenCode Go typed requirement error).
    - Functional: `docs/migrate-to-0.5.md` 0.5.1 section finalized; `docs/index.md` current line 0.5.1; `plans/README.md` status for 066 in progress/complete as appropriate at execution time.
    - Functional: `node scripts/release.mjs check --lockstep --version 0.5.1` (or the repo’s equivalent check) passes version consistency.
    - Performance: n/a.
    - Code Quality: no independent Decision B split — user requested lockstep because the change is core API.
    - Security: no credential/registry publish in this task (bump + changelog only unless the user later asks to publish).
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs` (`bumpRelease`, `parseArgs` bump `--from/--to --ranges caret`); `CHANGELOG.md` 0.5.0 style; `docs/migrate-to-0.5.md`; 10 packages: `@arnilo/prism`, `@arnilo/prism-core`, `@arnilo/prism-providers`, `@arnilo/prism-memory`, `@arnilo/prism-coding-tools`, `@arnilo/prism-web-tools`, `@arnilo/prism-office`, `@arnilo/prism-mcp`, `@arnilo/prism-ag-ui`, `@arnilo/prism-acp-agent`.
    - Options Considered:
      - Independent bump of only prism + providers + memory (rejected — user lockstep 0.5.1).
    - Chosen Approach:
      ```sh
      node scripts/release.mjs bump --from 0.5.0 --to 0.5.1 --ranges caret
      ```
      then CHANGELOG + migrate + index; re-run typecheck/docs tests for version strings if any are pinned.
    - API Notes and Examples:
      ```sh
      node scripts/release.mjs bump --from 0.5.0 --to 0.5.1 --ranges caret
      node scripts/release.mjs check --lockstep --version 0.5.1
      ```
    - Files to Create/Edit:
      - `package.json` and `packages/*/package.json` (via bump script)
      - `package-lock.json`
      - `CHANGELOG.md`
      - `docs/migrate-to-0.5.md`
      - `docs/migration.md`
      - `docs/index.md`
      - `plans/README.md` (066 row status)
      - any version-pin in docs tests (`src/__tests__/docs.test.ts`, `scripts/release-gate.test.mjs`) if they freeze 0.5.0
    - References:
      - `scripts/release.mjs:80-95`; 0.5.0 lockstep precedent in CHANGELOG.
  - Test Cases to Write:
    - existing release-gate / docs version assertions updated to 0.5.1.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (release line).
    - Docs pages to create/edit: CHANGELOG, migrate-to-0.5, migration, index.
    - `docs/index.md` update: yes — current line 0.5.1 construction defaults.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Known before execution: no package-policy auto-activation; no `AIProvider.generate` wrapping; no generic mandatory-field schema; Azure/Bedrock/Vertex/AI SDK cache stay host-owned; Command Code GPT-5.6 `prompt_cache_key` and Anthropic tools-schema `cache_control` stay deferred; OM uses one derived id for all workers (`om:{session.id}`), not per-kind suffixes; 0.5.1 is lockstep even for packages with docs-only diffs.
- Task 1: `registerProviderRequestPolicy` confirmed dead for construction (registry unread by agent session; first-party packages never call it). Keep the API; do not revive it as the default path.
- Task 1: `ProviderRequirementError` follows `AgentDecisionError` `ERR_PRISM_*` code shape, not `StructuredOutputError`'s unprefixed codes. Fail-fast *behavior* still follows `assertStructuredOutputRequestSupported`.
- Task 1: OpenRouter today emits top-level automatic `cache_control` when breakpoints are empty. P2 defaults will suppress that (per-message markers instead). Documented in evidence; Task 6 must update `openrouter_no_breakpoints_emits_top_level_automatic_cache_control`.
- Task 1: compaction two-message `last_stable_message` may coincide with `system_prompt`. Leave it; do not special-case.
- Task 1: do not add a dead `defaultCache` flag in Task 2. Task 6 extends the same helper from `request.model.cache`.
- Task 2: empty-string `sessionId`/`cacheKey` treated as missing (`present()`). No trim. No core sanitize (`om:` survives). Helper returns same request object on no-op.
- Task 2: no `defaultCache` / `thinkingLevel` parameters. Tasks 6–7 extend the same function.
- Task 2: docs list the new symbols on `docs/provider-request-policies.md` only. Contract rewrite stays Task 8.
- Task 3: stamp lives in `assembleProviderInput` (honesty) and `applyProviderRequestPolicies` (generate path, even when policy list empty). `assemble.ts` generate loop unchanged. Helper is idempotent.
- Task 4: OM derived id is `om:${session.id}` shared across observer/reflector/dropper. Direct worker calls stamp only when `sessionId` passed. Host `providerOptions.sessionId` still wins. Compaction helper runs before optional policies. Docs stay Task 8.
- Task 5: OpenCode Go throws `ProviderRequirementError` after abort check, before try/fetch (not yielded as `providerError`). Existing anthropic/google/openrouter/xai/hyper-responses tests already proved sessionId-only mapping; added openai sessionId-only + absence sessionId-only on implicit/host-owned adapters. No new wire fields invented. Docs stay Task 8.
- Task 6: cache defaults live in `applyDefaultProviderRequestOptions` from `model.cache` only. Adapters unchanged. Kept OpenRouter/OpenCode-Go empty-breakpoint adapter tests (raw `generate` still top-level automatic / no markers); added kernel-default tests that apply the helper. phase37 matrix left for Task 8 (freeze test does not hash default breakpoints). Kimi featured models stay implicit; kernel-default test uses `cache.kind: cache_control`.
- Task 7: `thinkingLevel?: string` on AgentConfig/RunOptions. Helper applies via `applyThinkingLevelForModel` after session/cache. Session passes `run.thinkingLevel ?? config.thinkingLevel`. Assembler not given a thinking field (generate path is enough). Memory/compaction keep their own thinkingLevel. No `ProviderRequestOptions.thinkingLevel`. Docs stay Task 8.
- Task 8: contract rewrite on provider-packages; `createSessionCachePolicy` demoted to overlay (kept in docs, dropped from package setup skeleton). Index heading `Current line (0.5.1)` while manifests stay 0.5.0 until Task 10. phase37 freeze file got an additive 0.5.1 note (hash test still green). No new docs page.
- Task 9: all offline gates green — `npm run typecheck` (root + workspaces + examples), `npm run lint`, `npm run format:check` (3 files reformatted: `opencode-go/provider.ts` fail-fast throw, `agents.test.ts` breakpoints assert, `docs.test.ts` new assertion), `npm test` full root + workspaces (EXIT 0; one pre-existing EPIPE flake in `language-intelligence.test.js` passed on isolated rerun, full rerun green). Gates forced freeze updates: `docs/_evidence/phase54-package-map.md` regenerated (root export count 901→904 from the three new exports); `scripts/budgets.json` rebaselined — `@arnilo/prism` exportCounts baseline 1272→1275 with plan 066 reason, root packedBytes 1046502→1098881 / unpackedBytes 3529890→3690682 / fileCount 432→441 (Task 8 docs) with plan 066 comments. Live OpenCode Go smoke skipped (key-gated, record: policy-less `session.run` against OpenCode Go needs 0.5.1 publish + host key; deferred).
- Further deviations: Task 10 — `release.mjs check` requires a clean git tree, so version consistency was verified via the equivalent gates (phase24 truth, docs current-line, phase27 version list + regenerated release-evidence, phase34 freeze, truth-current, release-gate) all green after the bump. `src/index.ts` version export bumped alongside manifests (repo precedent). Pre-existing gitignored `scripts/live.env` trips the local phase27 secret scan (static `sk-` sample; not plan-066, absent in CI).

## Further Actions

- Task 10: lockstep 0.5.1 bump executed and verified: `release.mjs bump --from 0.5.0 --to 0.5.1 --ranges caret` (10 manifests + caret internal ranges + lockfile); `release.mjs check` itself requires a clean git tree (blocked by uncommitted plan-066 work — equivalent checks green instead): `src/index.ts` version const → 0.5.1, root dist export test, `docs.test.ts` current-line spin, `phase24-truth` version gate, `phase27-release` version list + regenerated `scripts/release-evidence.json` (0.5.1), `phase34-freeze`, `truth-current`, `release-gate`. Version pins updated: `packaging.test.ts` (peer ^0.5.1, root version, phase48 neuralwatt gate), 11 provider skeleton tests, memory/coding-tools/install-smoke pins, `docs/release-and-install.md` tarball name. `phase54-package-map` evidence regenerated (0.5.1). All gates green: typecheck, lint, format:check, `npm test` EXIT=0 (1675 root + workspaces). Known: `phase27-release` local closeout's secret scan trips on gitignored `scripts/live.env` (pre-existing static-test key, not plan-066, absent in CI).
- Plan 066 complete. Priority: publish/verify live behaviors (OpenCode Go live smoke, real cache hits) after 0.5.1 is on npm.
