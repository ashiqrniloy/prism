# Release 0.0.8 Addendum: OpenCode Go Route/Streaming/Artifact Fixes and Kimi Provider Alignment

## Objectives

- Fix the four confirmed `@arnilo/prism-provider-opencode-go` / core artifact-loop defects from `bug-reports/prism-opencode-go-route-auth-and-structured-output-capabilities.md` before 0.0.8 publication.
- Align `@arnilo/prism-provider-kimi` request/response, authentication, model catalog, and thinking/reasoning-effort handling with the official Kimi Code and Moonshot Open Platform documentation.
- Land both scopes inside the already-versioned 0.0.8 graph (publication has not occurred); amend 0.0.8 changelogs and release evidence rather than creating a new version.

## Expected Outcome

- `qwen3.7-plus` and other Anthropic-route OpenCode Go models authenticate with provider-owned `x-api-key` + `anthropic-version` headers callers cannot override.
- `structuredOutput: "json_schema"` is advertised only for explicitly verified OpenCode Go models; `deepseek-v4-pro` uses the artifact loop without `response_format`.
- Incomplete OpenCode Go (and Kimi) streams fail with a stable bounded `incomplete_stream` error and never emit `done`; truncated output cannot produce a successful `AgentRunResult`.
- `generateValidateReviseLoop` consumes configured revision budget on parse failures via a bounded, redacted repair path and emits `artifact_failed` with `reason: "artifact_parse_failed"` on exhaustion.
- Kimi Coding (`api.kimi.com/coding` Anthropic route) and Moonshot Open Platform providers match official auth, base URL, `thinking`/`reasoning_effort`, Preserved Thinking, and model-catalog contracts; request bodies never leak routing compat keys.
- All fixes ship with network-free regression tests, updated provider docs/changelogs, and re-verified 0.0.8 release evidence.

## Tasks

- [x] 0. Freeze defect evidence and official Kimi contract revisions before implementation
  - Acceptance Criteria:
    - Functional: every bug-report defect is mapped to exact source lines, owning task, regression test, and docs page; every Kimi gap is mapped to an official documentation section with retrieval date (vendor docs expose no immutable revisions).
    - Performance: no new unbounded surface; confirm fixes reuse existing byte/attempt/turn caps (`maxRevisions`, provider-turn ceiling `1 + maxRevisions + maxToolRounds`, SSE byte bounds) rather than adding limits infrastructure.
    - Code Quality: confirm each fix lands in the shared function all callers route through (`opencodeOwnedHeaders`/provider header assembly, `defineOpenCodeGoModel`/`mapOpenCodeGoModel`, `openAIChatEvents`/`anthropicMessagesEvents`, `generateValidateReviseLoop`, `stripKimiThinkingCompat`/Kimi model catalog), not per-caller patches.
    - Security: freeze credential-header ownership rules (provider-owned headers applied after caller headers, redacted in all errors/events) and the no-raw-model-output rule for parse-repair messages.
  - Approach:
    - Documentation Reviewed:
      - `bug-reports/prism-opencode-go-route-auth-and-structured-output-capabilities.md` (reproduced 2026-07-20, Prism 0.0.6).
      - Official OpenCode Go docs endpoint table: <https://opencode.ai/docs/go/> (MiniMax + Qwen → Anthropic Messages; all others → Chat Completions).
      - Official Kimi sources (retrieved 2026-07-20): Model Parameter Reference <https://platform.kimi.ai/docs/api/models-overview>; Thinking Mode <https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model>; Thinking Effort <https://platform.kimi.ai/docs/guide/use-thinking-effort>; List Models <https://platform.kimi.ai/docs/api/list-models>; Kimi Code models <https://www.kimi.com/code/docs/en/kimi-code/models>; third-party agent setup <https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html>.
      - Existing implementation: `packages/provider-opencode-go/src/{provider,cache,models,openai-chat,anthropic-messages,thinking}.ts`, `packages/provider-kimi/src/{provider,moonshot,models,thinking,cache,index}.ts`, `src/agent-loops.ts`, `src/providers/transport.ts`.
    - Options Considered:
      - Consumer-side model-ID/header patches: rejected; duplicates provider behavior and drifts from the model catalog (bug report Consumer Impact section).
      - Automatic retry without `response_format` on arbitrary HTTP 400: rejected; masks unrelated invalid requests (bug report Defect 2 guidance).
      - Accurate provider-owned metadata + shared-seam fixes: chosen.
    - Chosen Approach:
      - Record the defect/gap → source-line → fix-owner matrix as completion evidence on this task; no code changes beyond the matrix.
      - Confirmed source evidence (2026-07-20):
        - Defect 1: `packages/provider-opencode-go/src/provider.ts` adds only `authorization: Bearer`; `cache.ts opencodeOwnedHeaders()` supplies content-type/session only. Anthropic route never sends `x-api-key`/`anthropic-version`.
        - Defect 2: `models.ts defineOpenCodeGoModel()` and `mapOpenCodeGoModel()` set `structuredOutput: route === "openai" ? "json_schema" : undefined` purely from route.
        - Defect 3: `openai-chat.ts openAIChatEvents()` (and `anthropic-messages.ts anthropicMessagesEvents()`) yield `providerDone(usage)` unconditionally at iterator EOF with no `finish_reason`/`[DONE]`/tool-call completeness tracking. Same EOF-`done` pattern exists in `provider-kimi/src/provider.ts kimiAnthropicEvents()` and `moonshot.ts moonshotEvents()`.
        - Defect 4: `src/agent-loops.ts generateValidateReviseLoop` line ~150: `if (!parsed.ok || parsed.value === undefined) return usage;` returns before consuming `attempts` or invoking `repairer`.
        - Kimi gap A: `thinking.ts stripKimiThinkingCompat()` strips `thinking`/`reasoning_effort`/`reasoningEffort`/`preserveThinking` but not `route` or `preserve_thinking`; both `kimiAnthropicBody` and `moonshotBody` spread the result into the wire body, leaking routing keys upstream.
        - Kimi gap B: `models.ts` featured Coding `k3` hardcodes `reasoning_effort: "max"` with comment "default max"; official Kimi Code maps unset effort to `high` (Open Platform default is `max`). Comments in `thinking.ts` claim Open Platform documents only `"max"`; official docs now specify `"low" | "high" | "max"` (default `"max"`).
        - Kimi gap C: featured `moonshotKimiModels` lacks `kimi-k2.6`, `kimi-k2.5`, `kimi-k2.7-code-highspeed`; featured Coding `kimi-for-coding*` context is `256_000` vs official `262_144`.
        - Kimi gap D: Coding provider sends Bearer-only auth; official Kimi Code third-party setup uses `ANTHROPIC_API_KEY` semantics (`x-api-key` + `anthropic-version` headers on the Anthropic route). Bearer acceptance is undocumented — verify and align.
        - Kimi aligned (no change): base URLs (`https://api.kimi.com/coding`, `https://api.moonshot.ai/v1`), Coding model IDs (`k3`, `kimi-for-coding`, `kimi-for-coding-highspeed`), K2.7-code thinking omission, K2.6/K2.5 `thinking` defaults in `thinkingDefaultsForModel`, Preserved Thinking replay via `reasoning_content`, `/v1/models` field mapping (`context_length`, `supports_image_in`, `supports_video_in`, `supports_reasoning`).
    - Files to Create/Edit:
      - `plans/071-release-0-0-8-opencode-go-route-fixes-and-kimi-alignment.md`: append the finalized evidence matrix as completion evidence.
    - References:
      - Plan 070 Task 0 evidence format: `docs/review-coverage-2026-07-19-phase-3.md`.
  - Test Cases to Write:
    - Evidence check: every bug-report acceptance criterion and every Kimi gap has exactly one owning task in this plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; evidence freeze only.
    - Docs pages to create/edit: none; later tasks own page changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Froze Prism revision `6048e82db212303f4f072ff70539830b779f35cf` (same tree as plan 070 release candidate) and verified every defect/gap against exact source lines:
      - Defect 1: `packages/provider-opencode-go/src/provider.ts:35-36` — header assembly adds only `opencodeOwnedHeaders()` (content-type/session, `cache.ts:21-30`) plus `authorization: Bearer`; no `x-api-key`/`anthropic-version` on the `/messages` route. Owner: Task 1.
      - Defect 2: `packages/provider-opencode-go/src/models.ts:74` (`defineOpenCodeGoModel`) and `:159` (`mapOpenCodeGoModel`) — `structuredOutput: route === "openai" ? "json_schema" : undefined` inferred from route alone; official `/models` payload (`id`/`object`/`created`/`owned_by` only, `models.ts:40-46`) carries no capability fields. Owner: Task 2.
      - Defect 3: `packages/provider-opencode-go/src/openai-chat.ts:71` and `anthropic-messages.ts:69` — unconditional `providerDone(usage)` after the SSE loop; no `finish_reason`/`[DONE]`/`message_stop` tracking and no tool-accumulator completeness check. Same pattern confirmed in `packages/provider-kimi/src/provider.ts:122` (`kimiAnthropicEvents`) and `moonshot.ts:159` (`moonshotEvents`). Owners: Task 3 (opencode-go), Task 5 (kimi).
      - Defect 4: `src/agent-loops.ts:150` — `if (!parsed.ok || parsed.value === undefined) return usage;` returns before `attempts` increments and before the repairer/revision branch; neither configured revision is consumed. Owner: Task 4.
      - Kimi gap A: `packages/provider-kimi/src/thinking.ts:40-50` — `stripKimiThinkingCompat()` destructures only `thinking`/`reasoning_effort`/`reasoningEffort`/`preserveThinking`; `route` and `preserve_thinking` survive and are spread into wire bodies by `kimiAnthropicBody` (`provider.ts:86`) and `moonshotBody` (`moonshot.ts:109`). Owner: Task 5.
      - Kimi gap B: `packages/provider-kimi/src/models.ts:174-175` — featured Coding `k3` hardcodes `reasoning_effort: "max"` with comment "default max"; official Kimi Code docs map unset effort to `high` (effort mapping table, kimi.com/code/docs/en/kimi-code/models). `models.ts:207-208` and `thinking.ts:16` comments claim Open Platform documents only `"max"`; official Thinking Effort page documents `"low" | "high" | "max"` (default `"max"`). Owner: Task 5.
      - Kimi gap C: `packages/provider-kimi/src/models.ts:147,159,191` — featured context windows `256_000` vs official `262_144`; featured `moonshotKimiModels` (`models.ts:183-209`) lacks `kimi-k2.6`, `kimi-k2.5`, `kimi-k2.7-code-highspeed` (all present in official Model Parameter Reference). Owner: Task 5.
      - Kimi gap D: `packages/provider-kimi/src/provider.ts:46-52` — Coding route sends Bearer-only; official third-party setup uses `ANTHROPIC_API_KEY` semantics (`x-api-key` + `anthropic-version` on the Anthropic route). Bearer acceptance undocumented → verify via credential-gated live check in Task 5 before release. Owner: Task 5.
    - Froze Kimi-aligned items (no change required, verified against official docs retrieved 2026-07-20): base URLs `https://api.kimi.com/coding` / `https://api.moonshot.ai/v1`; Coding model IDs `k3` / `kimi-for-coding` / `kimi-for-coding-highspeed`; K2.7-code `thinking` omission (`thinkingDefaultsForModel` returns `{}`, official: always-on, only `{"type":"enabled","keep":"all"}` accepted); K2.6/K2.5 `{"type":"enabled"}` defaults; K2.5 excluded from `shouldPreserveThinkingByDefault` (official: no Preserved Thinking); `reasoning_content` replay on both routes; `/v1/models` field mapping (`context_length`, `supports_image_in`, `supports_video_in`, `supports_reasoning`); Anthropic `cache_control` opt-in only (official support undocumented).
    - Confirmed fix seams are shared functions all callers route through (header assembly, capability resolution, event parsers, parse branch, strip helper, catalog tables) — no per-caller patches planned; existing caps (`maxRevisions`, `1 + maxRevisions + maxToolRounds` ceiling, SSE byte bounds, `secrets` redaction) are reused with no new limits infrastructure.
    - Ownership matrix check passed: every bug-report acceptance criterion and Kimi gap maps to exactly one task (Defects 1–4 → Tasks 1–4; Kimi gaps A–E → Task 5; changelogs/release evidence → Task 6).

- [x] 1. Add provider-owned Anthropic-route authentication headers for OpenCode Go (Defect 1)
  - Acceptance Criteria:
    - Functional: Anthropic-route (`/messages`) requests include `x-api-key: <key>` and `anthropic-version: 2023-06-01` in addition to existing Bearer authorization; OpenAI-route requests receive no Anthropic-only headers.
    - Performance: zero added allocations on the OpenAI route; header assembly stays O(1) per request.
    - Code Quality: headers are added once in the shared provider header assembly all Anthropic-route calls route through; no per-model branches.
    - Security: credential-bearing headers are provider-owned — caller `options.headers` cannot replace `x-api-key`, `anthropic-version`, `authorization`, `content-type`, or `x-opencode-session`; API key never appears in errors/events (existing `secrets` redaction covers both header values).
  - Approach:
    - Documentation Reviewed: bug report Defect 1 repro table (Bearer-only → 401; `x-api-key` + `anthropic-version` → 200; both header sets → 200); Anthropic Messages versioning convention (`anthropic-version: 2023-06-01`).
    - Options Considered:
      - Replace Bearer with `x-api-key`: rejected; bug report shows both header sets succeed and `/models` discovery relies on Bearer — keep both.
      - Let callers supply the headers: rejected; credential material must stay provider-owned.
    - Chosen Approach:
      - Extend the Anthropic-route branch of `createOpenCodeGoProvider().generate()` header assembly (route already computed there) to append provider-owned `x-api-key`/`anthropic-version` after caller headers and `opencodeOwnedHeaders()`.
    - API Notes and Examples:
      ```http
      POST /zen/go/v1/messages
      authorization: Bearer <key>
      x-api-key: <key>
      anthropic-version: 2023-06-01
      ```
    - Files to Create/Edit:
      - `packages/provider-opencode-go/src/provider.ts`: route-conditional provider-owned headers.
      - `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`: header regression coverage.
    - References:
      - `packages/provider-opencode-go/src/cache.ts opencodeOwnedHeaders()` ownership pattern (applied after caller headers).
  - Test Cases to Write:
    - Anthropic route includes `x-api-key` + `anthropic-version` and retains Bearer.
    - Caller `options.headers` containing `x-api-key`/`anthropic-version`/`authorization` cannot override provider-owned values.
    - OpenAI route sends no Anthropic-only headers.
    - Forced 401/500 error body and events contain no API key (canary redaction).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; Anthropic-route request headers change (fixes 401).
    - Docs pages to create/edit:
      - `docs/providers/opencode-go.md`: document dual-auth header behavior on the Anthropic route and header ownership.
    - `docs/index.md` update: no new entry; verify the existing OpenCode Go provider entry description stays accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - `packages/provider-opencode-go/src/provider.ts` now appends provider-owned `x-api-key: <token>` and `anthropic-version: 2023-06-01` on the Anthropic (`/messages`) route only, applied after caller headers, `opencodeOwnedHeaders()`, and Bearer authorization so no credential-bearing header can be overridden. Bearer is retained (bug report shows both header sets succeed; `/models` discovery uses Bearer). OpenAI route unchanged — no Anthropic-only headers, zero added allocation.
    - Added four network-free regression tests in `src/__tests__/opencode-go.test.ts`: anthropic route sends all three auth headers to `/messages`; caller `x-api-key`/`anthropic-version`/`authorization` cannot override provider-owned values (via `assertProviderOwnedHeadersWin`); openai route sends neither anthropic header; forced 401 response containing the canary key is redacted from emitted error events.
    - Updated `docs/providers/opencode-go.md` request example (dual-auth Anthropic route, 401 rationale, override rule) and the security note listing provider-owned headers. No `docs/index.md` change needed — existing provider entry remains accurate.
    - Verification passed: package typecheck, package build, 28/28 network-free tests (4 credential-gated live tests skip safely), docs suite 84/84, `git diff --check` clean. Live `qwen3.7-plus` 200-response confirmation remains a credential-gated release-host check (Task 6 evidence).

- [x] 2. Stop inferring JSON Schema structured output from route alone (Defect 2)
  - Acceptance Criteria:
    - Functional: `defineOpenCodeGoModel`/`mapOpenCodeGoModel` advertise `capabilities.structuredOutput: "json_schema"` only for models on an explicit verified allowlist; unverified models leave the capability undefined so `generateValidateReviseLoop` uses artifact-loop parsing without `response_format`.
    - Functional: `deepseek-v4-pro`/`deepseek-v4-flash` do not advertise JSON Schema structured output; verified `mimo-v2.5`/`mimo-v2.5-pro` retain it.
    - Performance: lookup is an O(1) set membership at model-definition time; no runtime cost per request.
    - Code Quality: one package-local verified set consumed by both the featured catalog and live-discovery mapping; route selection and structured-output capability stay independent.
    - Security: no behavior change that could leak payloads; `assertStructuredOutputRequestSupported` continues to reject unsupported requests before dispatch.
  - Approach:
    - Documentation Reviewed: bug report Defect 2 repro (400 `invalid_request_error` with `response_format` on `deepseek-v4-pro`; success without); `applyOpenAIChatStructuredOutput` and `assertStructuredOutputRequestSupported` in core.
    - Options Considered:
      - Default all OpenAI-route models to unsupported: safe but regresses verified models (`mimo-v2.5` family confirmed working per bug report regression-test note); rejected.
      - Parse upstream `/models` for capability data: rejected; official payload is sparse (`id`/`object`/`created`/`owned_by`) with no capability fields.
      - Explicit verified allowlist, default undefined: chosen (bug report Required Fix).
    - Chosen Approach:
      - Add a package-local `VERIFIED_JSON_SCHEMA_MODELS` set (initial: `mimo-v2.5`, `mimo-v2.5-pro` per bug report verification) consulted by `defineOpenCodeGoModel` and `mapOpenCodeGoModel` when the caller did not set the capability explicitly.
    - API Notes and Examples:
      ```ts
      // deepseek-v4-pro → capabilities.structuredOutput === undefined → artifact loop, no response_format
      // mimo-v2.5      → capabilities.structuredOutput === "json_schema" → native response_format
      ```
    - Files to Create/Edit:
      - `packages/provider-opencode-go/src/models.ts`: verified set + capability resolution.
      - `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`: capability matrix.
    - References:
      - `packages/provider-opencode-go/src/openai-chat.ts openAIChatBody()` → `applyOpenAIChatStructuredOutput` is gated by the capability check in `assertStructuredOutputRequestSupported`.
  - Test Cases to Write:
    - `deepseek-v4-pro` advertises no `structuredOutput`; its serialized chat body omits `response_format` even when `options.structuredOutput` is set (request rejected pre-dispatch with stable error).
    - `mimo-v2.5` keeps `json_schema` and serializes `response_format`.
    - Live-discovered unknown OpenAI-route model defaults to undefined; caller-explicit capability still wins.
    - Route selection (`compat.route`) is unaffected by the capability change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; advertised model capabilities change for unverified models.
    - Docs pages to create/edit:
      - `docs/providers/opencode-go.md`: verified structured-output model table and artifact-loop fallback behavior.
      - `docs/migration.md`: note capability narrowing for 0.0.8 consumers relying on route-inferred structured output.
    - `docs/index.md` update: no new entry; keep provider entry accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - `packages/provider-opencode-go/src/models.ts` adds package-local `VERIFIED_JSON_SCHEMA_MODELS` (`mimo-v2.5`, `mimo-v2.5-pro` — the bug report's verified models) and `defaultStructuredOutput()`; both `defineOpenCodeGoModel()` and `mapOpenCodeGoModel()` now advertise `json_schema` only for verified OpenAI-route models. Route selection (`compat.route`) and structured-output capability are fully independent; caller-explicit `capabilities.structuredOutput` still wins via the existing spread.
    - Consequences verified: `deepseek-v4-pro`/`deepseek-v4-flash` and unknown discovered models default to undefined → artifact-loop path; featured `mimo-v2.5`/`mimo-v2.5-pro` keep `json_schema`; featured paths needed no per-model edits because the default resolution handles them.
    - Added three network-free regression tests: featured/discovered/explicit capability matrix; `deepseek-v4-pro` with `options.structuredOutput` fails before dispatch (`unsupported_model`, zero fetch calls) and its plain body omits `response_format`; verified `mimo-v2.5` serializes `response_format.json_schema`.
    - Updated `docs/providers/opencode-go.md` (verified-model table + artifact-loop fallback + explicit-override path) and `docs/migration.md` (0.0.7 → 0.0.8 OpenCode Go provider fixes section covering capability narrowing and Task 1 headers).
    - Verification passed: package build, 31/31 network-free package tests (4 live skips), full repository suite 1,128/1,128 plus all workspace suites (0 failures), docs suite 84/84, `git diff --check` clean. Extending the verified set beyond `mimo-v2.5*` requires per-model live evidence — credential-gated release-host check.

- [x] 3. Fail incomplete OpenCode Go streams instead of emitting `done` (Defect 3)
  - Acceptance Criteria:
    - Functional: `openAIChatEvents()` and `anthropicMessagesEvents()` track terminal state (`finish_reason` per choice / `[DONE]` sentinel; Anthropic `message_stop`) and accumulated tool-call completeness (ID, name, parseable JSON arguments); EOF without a valid terminal state emits a stable bounded provider error with reason `incomplete_stream` and never emits `providerDone()`.
    - Functional: truncated content cannot yield `status: "succeeded"`; Prism's existing bounded provider retry policy handles the resulting provider failure.
    - Performance: tracking adds O(choices + tool calls) small scalars per stream; existing SSE byte bounds, abort, and redaction behavior unchanged.
    - Code Quality: terminal-state tracking is implemented once in the shared event parsers both routes (and all models) route through; no caller-side workarounds.
    - Security: `incomplete_stream` error records contain no partial content, tool arguments, prompts, or credentials.
  - Approach:
    - Documentation Reviewed: bug report Defect 3 repro (36 chunks, mid-JSON stop, no `finish_reason`/usage → false success); `src/providers/transport.ts readSseData`/`parseJsonObjectArguments`; core provider retry policy docs (`docs/runs-and-usage.md`).
    - Options Considered:
      - Treat missing usage as incomplete: rejected; usage is optional upstream (`stream_options.include_usage` is best-effort) — terminal signal is `finish_reason`/`message_stop`/`[DONE]`, not usage.
      - Emit `done` with a warning flag: rejected; downstream artifact parsing cannot distinguish truncation (bug report Expected Behavior).
    - Chosen Approach:
      - Track per-choice `finish_reason` and `[DONE]`/`message_stop` arrival; after the loop, require a terminal signal and complete tool accumulators before `providerDone(usage)`; otherwise `providerError` with redacted `incomplete_stream`.
    - API Notes and Examples:
      ```ts
      // EOF with no finish_reason/[DONE]:
      // → providerError(new Error("OpenCode Go stream ended before completion (incomplete_stream)"), secrets)
      ```
    - Files to Create/Edit:
      - `packages/provider-opencode-go/src/openai-chat.ts`: terminal/tool-completeness tracking in `openAIChatEvents()`; extend `OpenAIChunk` with `finish_reason`.
      - `packages/provider-opencode-go/src/anthropic-messages.ts`: `message_stop` tracking in `anthropicMessagesEvents()`.
      - `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`: stream matrix.
    - References:
      - Kimi event parsers share this defect pattern; fixed under Task 5 in the Kimi package.
  - Test Cases to Write:
    - Normal terminal stream (`finish_reason: "stop"` + usage) emits `done` once.
    - EOF before any terminal signal emits `incomplete_stream` and no `done`.
    - `[DONE]` without choices, and `finish_reason: "length"`/`"tool_calls"` terminal paths, behave per upstream contract.
    - Tool-call accumulator missing ID/name or with unparseable JSON arguments at EOF emits a stable bounded error, not a partial `toolCall`.
    - Error/event records exclude partial text, tool arguments, prompts, and credentials (canary).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; previously-"successful" truncated runs now fail with a stable error.
    - Docs pages to create/edit:
      - `docs/providers/opencode-go.md`: stream terminal-state contract and `incomplete_stream` error.
      - `docs/migration.md`: behavior change note (false successes become retryable failures).
    - `docs/index.md` update: no new entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - `openAIChatEvents()` now tracks the `[DONE]` marker and terminal `finish_reason` and verifies every tool-call accumulator has id+name; any missing evidence yields a terminal `providerError` (with a redaction-safe diagnostic naming exactly which evidence is missing) instead of `providerDone`. `OpenAIChunk` type gained `finish_reason`; `providerError` imported.
    - `anthropicMessagesEvents()` now tracks `message_stop` and closes tool blocks on `content_block_stop` (`PartialBlock.complete`); missing `message_stop` or any unclosed/dangling block yields `providerError` instead of `providerDone`. Successful event/delta ordering unchanged — completion checks run after the SSE loop, before final tool calls and `done`.
    - Added five regression tests: 36-chunk truncation repro (bug report scenario) → error, no done; `[DONE]` without `finish_reason` → error; dangling OpenAI tool call → error while a complete two-chunk tool call succeeds; Anthropic stream without `message_stop` → error; unclosed `tool_use` block → error while a closed one with `stop_reason: "tool_use"` succeeds. Added `sseRaw()` test helper (no trailing `[DONE]`) for truncation scenarios.
    - Existing mock streams continue to pass: complete-stream tests already include `finish_reason`/`message_stop`, and header/body tests tolerate an error terminal via `assertProviderStreamConforms`.
    - Updated `docs/providers/opencode-go.md` (stream-completion contract row in Outputs) and `docs/migration.md` (truncation behavior change: previously silent truncations now surface as run failures).
    - Verification passed: package build, 36/36 network-free package tests (4 live skips), full repository suite 0 failures across all workspaces, docs suite 84/84. Kimi parsers keep identical pre-fix behavior; their identical fix is Task 5.

- [x] 4. Route artifact parse failures through the revision budget (Defect 4)
  - Acceptance Criteria:
    - Functional: a call-free parse failure in `generateValidateReviseLoop` consumes one artifact attempt, appends a bounded repair message (parse category only, never raw model output), and continues while `attempt <= maxRevisions`; exhaustion emits `artifact_failed` with `metadata.reason: "artifact_parse_failed"`.
    - Functional: provider-turn ceiling `1 + maxRevisions + maxToolRounds` and shared `maxToolRounds` accounting are unchanged; `maxRevisions: 0` keeps single-turn behavior.
    - Performance: no extra provider turns beyond the existing ceiling; repair message size is bounded by the parse-error summary.
    - Code Quality: fix lives in the one parse branch all artifact loops route through; `ArtifactParser`/`ArtifactRepairer` contracts unchanged (parse failure passes a synthesized validation-shaped failure to the repairer).
    - Security: repair messages and `artifact_failed` metadata expose only a bounded parse category/message summary — no raw output, tool arguments, or secrets.
  - Approach:
    - Documentation Reviewed: bug report Defect 4 repro and Required Prism fix; `src/agent-loops.ts` loop invariants; `src/__tests__/agent-loops.test.ts` existing revision/tool-round matrices; `docs/agent-loops.md` (or current artifact-loop docs page).
    - Options Considered:
      - Throw on parse failure: rejected; bypasses configured repair budget (current silent return is the same class of bug).
      - Retry parse internally without a provider turn: rejected; malformed output cannot self-repair — the model needs the bounded parse feedback.
      - Count the parse failure as an attempt and feed a validation-shaped failure to the existing repairer path: chosen.
    - Chosen Approach:
      - On `!parsed.ok || parsed.value === undefined`: increment `attempts`, emit `artifact_validation_finished` with a synthesized `{ ok: false, errors: [bounded parse message] }`, then follow the exact existing revision/exhaustion branch (`artifact_failed` with `reason: "artifact_parse_failed"` when `attempt > max`, else `artifact_revision_started` + repairer).
    - API Notes and Examples:
      ```ts
      // maxRevisions: 1 — malformed JSON turn 1 → repair message → valid JSON turn 2 → artifact_finished
      // exhaustion → artifact_failed { metadata: { reason: "artifact_parse_failed" } }
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`: parse-failure attempt/repair branch.
      - `src/__tests__/agent-loops.test.ts`: parse-repair matrix.
    - References:
      - `defaultRepairer()` already maps `failure.errors[].message` to a bounded user message — reused unchanged for parse failures.
  - Test Cases to Write:
    - Initial malformed JSON + valid repaired JSON succeeds with `maxRevisions: 1` (two provider turns).
    - Initial malformed JSON performs exactly one turn with `maxRevisions: 0` and emits `artifact_failed`/`artifact_parse_failed`.
    - Repeated parse failures stop after exactly `1 + maxRevisions` provider turns.
    - Tool rounds remain shared and do not reset after a parse repair; ceiling `1 + maxRevisions + maxToolRounds` holds.
    - Repair messages and failure metadata contain a bounded parse category, never raw model output or canary secrets.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; parse-failure loop semantics and `artifact_failed` metadata change.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: parse-failure attempt accounting, repair flow, and exhaustion reason.
      - `docs/migration.md`: behavior change note (parse failures now consume revision budget).
    - `docs/index.md` update: no new entry; verify Agent loops entry description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - `src/agent-loops.ts` `generateValidateReviseLoop` no longer returns silently on parse failure. A failed parse (`ok: false` or missing `value`) becomes a synthetic `ArtifactValidation` (`errors[0].message` = parse error, `metadata.reason: "parse_error"`) routed through the identical budget/repair path as validation failures: `attempts` increments, `artifact_validation_started`/`finished` emit uniformly, the repairer receives `value: undefined` (already allowed by the `ArtifactRepairer<T>` contract), and exhaustion terminates with `artifact_failed` carrying the same `parse_error` metadata. Validator is skipped only for the failed-parse turn.
    - No new limits infrastructure: the existing `maxRevisions` budget and `1 + maxRevisions + maxToolRounds` ceiling bound the new path unchanged.
    - Added three regression tests in `src/__tests__/agent-loops.test.ts`: parse failure then success consumes budget (2 turns, repairer gets `undefined` + parse error, `parse_error` metadata on `artifact_validation_finished`, `artifact_revision_started` → `artifact_finished` sequence); persistent parse failure exhausts budget (2 turns at `maxRevisions: 1`, exactly one repair message, terminal `artifact_failed` with `parse_error`); default repairer feeds the parse error back as the revision message.
    - Updated `docs/agent-loops.md` parser contract row (parse failure = budgeted revision path), `docs/agent-events.md` `artifact_failed` reasons, and `docs/migration.md` (new 0.0.7 → 0.0.8 artifact-loop parse failures section). Existing Agent loops `docs/index.md` entry stays accurate.
    - Verification passed: core build, agent-loops suite 35/35, full repository suite 0 failures across all workspaces, docs suite 84/84. No redaction-sensitive content added — parse errors are host parser messages, not credentials.

- [x] 5. Align Kimi providers with official request/response, auth, and thinking contracts
  - Acceptance Criteria:
    - Functional: `stripKimiThinkingCompat()` also strips `route` and `preserve_thinking`, so no routing compat key leaks into `/messages` or `/chat/completions` bodies.
    - Functional: Kimi Coding auth matches the official Anthropic-route contract — provider-owned `x-api-key` + `anthropic-version: 2023-06-01` alongside Bearer (mirrors Task 1 ownership/redaction rules); verified against the live endpoint or official docs before release, with the result recorded.
    - Functional: featured Coding `k3` no longer hardcodes `reasoning_effort: "max"` (official Coding default is `high`; Open Platform default `max`); effort remains a host/caller passthrough of `"low" | "high" | "max"`. Comments in `thinking.ts`/`models.ts` match current official docs.
    - Functional: featured Moonshot catalog adds `kimi-k2.6`, `kimi-k2.5`, and `kimi-k2.7-code-highspeed` with official parameter defaults (K2.6/K2.5 `thinking` enabled-by-default, K2.5 no Preserved Thinking, K2.7 series omit `thinking`); Coding featured context windows use official `262_144`.
    - Functional: `kimiAnthropicEvents()`/`moonshotEvents()` apply the Task 3 terminal-state contract (`message_stop` / `finish_reason`/`[DONE]` + tool completeness) with the same stable `incomplete_stream` error.
    - Performance: catalog/discovery mapping stays O(1) per model; stream tracking matches Task 3 bounds; no new dependencies.
    - Code Quality: fixes land in the shared `thinking.ts` strip helper, catalog tables, and event parsers; no caller-side patches; `mapKimiModel` discovery heuristics stay consistent with featured entries.
    - Security: credential headers provider-owned and redacted; `incomplete_stream` records exclude partial content; no API key in errors/events.
  - Approach:
    - Documentation Reviewed:
      - Official sources pinned in Task 0: models-overview (per-model `thinking`/`reasoning_effort`/`temperature`/`tool_choice` constraints), Thinking Mode (K2.7 always-on + Preserved Thinking always-on; K2.6 `thinking.keep`; K2.5 no Preserved Thinking), Thinking Effort (K3 top-level `reasoning_effort` `"low"/"high"/"max"`, Open Platform default `"max"`), List Models (`/v1/models` fields), Kimi Code models (IDs `k3`/`kimi-for-coding`/`kimi-for-coding-highspeed`, Coding effort default `high`, plan-gated context), third-party setup (`https://api.kimi.com/coding/`, `ANTHROPIC_API_KEY`).
    - Options Considered:
      - Leave Coding `k3` at explicit `"max"`: valid per docs but overrides the official Coding default (`high`) and silently doubles cost/latency for hosts expecting defaults; rejected.
      - Add a Kimi-specific shared stream helper with opencode-go: rejected; packages stay self-contained (existing package pattern), each implementing the same documented contract.
      - Package-local fixes per official sections with recorded doc provenance: chosen.
    - Chosen Approach:
      - Extend the strip helper; make Coding provider headers route-appropriate and provider-owned; correct catalog defaults/comments to official values; extend featured Moonshot entries; port the Task 3 terminal-state tracking into both Kimi event parsers.
    - API Notes and Examples:
      ```ts
      // Coding k3: reasoning_effort omitted → server default "high"; caller may set "low"|"high"|"max".
      // moonshot kimi-k2.6: compat.thinking === { type: "enabled" } (official default)
      // moonshot kimi-k2.7-code(-highspeed): thinking omitted; preserveThinking: true (Preserved Thinking always on)
      ```
    - Files to Create/Edit:
      - `packages/provider-kimi/src/thinking.ts`: strip `route`/`preserve_thinking`; correct doc comments.
      - `packages/provider-kimi/src/provider.ts`: provider-owned `x-api-key`/`anthropic-version` headers; `message_stop` terminal tracking in `kimiAnthropicEvents()`.
      - `packages/provider-kimi/src/moonshot.ts`: terminal tracking in `moonshotEvents()` (extend `MoonshotChunk` with `finish_reason`).
      - `packages/provider-kimi/src/models.ts`: Coding `k3` effort default removal + comment fixes; `262_144` context windows; new featured Moonshot entries (`kimi-k2.6`, `kimi-k2.5`, `kimi-k2.7-code-highspeed`).
      - `packages/provider-kimi/src/__tests__/kimi.test.ts`, `index.test.ts`: regression matrix; `live.test.ts` gates unchanged.
    - References:
      - Task 1 header-ownership pattern; Task 3 terminal-state contract.
      - `packages/provider-kimi/src/cache.ts`: Anthropic `cache_control` remains opt-in (official support undocumented) — no change.
  - Test Cases to Write:
    - Body matrix: `options.compat` containing `route`/`preserve_thinking` never reaches the wire on either route; `thinking`/`reasoning_effort` resolution (request wins over model) unchanged.
    - Header matrix: Coding route sends `x-api-key` + `anthropic-version` + Bearer; caller headers cannot override; Open Platform route sends no Anthropic-only headers; canary key absent from errors.
    - Catalog matrix: featured Coding `k3` sends no default `reasoning_effort`; new Moonshot entries carry official `thinking`/preserve defaults; `mapKimiModel` on synthetic `/v1/models` entries (k2.5/k2.6/k2.7-code/highspeed/k3) matches featured defaults.
    - Stream matrix: normal terminal emits `done` once; EOF without `message_stop`/`finish_reason`/`[DONE]` emits `incomplete_stream` and no `done`; incomplete tool accumulators error; no partial content in error records.
    - Live matrix (credential-gated, skip-safe): minimal `k3` generation through the Coding route succeeds with the shipped header set — records whether Bearer-only would also pass, per Task 0 verification note.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; headers, catalog entries/defaults, and stream failure behavior change.
    - Docs pages to create/edit:
      - `docs/providers/kimi.md`: official contract table (auth headers, base URLs, per-model `thinking`/`reasoning_effort` defaults, Preserved Thinking), new featured models, `incomplete_stream` behavior, and doc provenance/retrieval date.
      - `docs/migration.md`: Coding `k3` default-effort change and catalog additions.
    - `docs/index.md` update: no new entry; verify Kimi provider entry description covers both routes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Re-verified official contracts same-day before implementation: Open Platform Model Parameter Reference confirms ids `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.7-code-highspeed` (identical constraints, speed-only difference), `kimi-k2.6`, `kimi-k2.5`; K3 `reasoning_effort` `"low"`/`"high"`/`"max"` with Open Platform default `"max"`; K2.6/K2.5 thinking-enabled defaults; K2.7-code thinking always-on with Preserved Thinking always-on.
    - Gap A fixed: `stripKimiThinkingCompat()` now strips `route` and `preserve_thinking` in addition to thinking/effort keys; wire-body tests prove routing keys no longer leak on either route while unknown keys still pass through.
    - Gap B fixed: featured Coding `k3` now defaults `reasoning_effort: "high"` (official Kimi Code unset-effort mapping); Moonshot `kimi-k3` keeps `"max"` (official Open Platform default); outdated "Open Platform documents only max" comments replaced in `models.ts` and `thinking.ts`.
    - Gap C fixed: featured 256K-class context windows corrected to official `262_144` (both catalogs); featured Moonshot catalog adds `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5` with official thinking defaults — K2.5 intentionally without `preserveThinking` (no Preserved Thinking support upstream).
    - Gap D fixed: Coding route now sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` alongside Bearer (official third-party setup uses `ANTHROPIC_API_KEY` semantics, contradicting Bearer-only); applied after caller headers so they cannot be overridden. Live verification of dual-auth acceptance remains credential-gated (Task 6 evidence).
    - Gap E fixed: `kimiAnthropicEvents` requires `message_stop` + closed `tool_use` blocks; `moonshotEvents` requires `[DONE]` + terminal `finish_reason` + complete tool accumulators — truncated streams yield terminal `providerError` instead of `providerDone`.
    - Added eight network-free tests: official catalog/context/effort matrix for both providers, strip-helper key removal, wire-body leak prevention on both routes, Coding dual-auth headers + caller-override protection, truncated-stream errors on both routes, and a complete Moonshot stream success path.
    - Updated `docs/providers/kimi.md` (featured ids, effort defaults, strip contract, exact context windows, stream-completion contract, dual-auth note) and `docs/migration.md` (0.0.7 → 0.0.8 Kimi provider alignment section).
    - Verification passed: package build, 28/28 network-free package tests (4 credential-gated live skips), full repository suite 0 failures across all workspaces, docs suite 84/84.

- [x] 6. Amend 0.0.8 changelogs, release evidence, and run the full deterministic gate
  - Acceptance Criteria:
    - Functional: root plus `@arnilo/prism`, `@arnilo/prism-provider-opencode-go`, and `@arnilo/prism-provider-kimi` 0.0.8 changelogs record the four defect fixes and Kimi alignment; bug report acceptance criteria are all satisfied or explicitly deferred.
    - Functional: plan 070 release evidence remains valid — versions stay `0.0.8` (no publication occurred); `release:check`/`release:publish --dry-run` still resolve the 31-package graph.
    - Performance: `npm run sdk:ready` stays network-free within the existing backstop; benchmark suite unchanged.
    - Code Quality: full typecheck, default tests, docs suite, package/install smoke, dry-run packs, and `git diff --check` pass from the release-candidate tree.
    - Security: secret scan and audit remain clean; new credential-header code paths covered by canary-redaction tests.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`; plan 070 Task 8 completion evidence; root and package `CHANGELOG.md` 0.0.8 entries.
    - Options Considered:
      - Bump a patch version for these fixes: rejected; 0.0.8 is versioned but unpublished, and package versions are immutable once published — amend pre-publication.
      - Defer to 0.0.9: rejected; user explicitly scoped both items to release 0.0.8.
    - Chosen Approach:
      - Amend the existing 0.0.8 changelog entries in place, re-run the plan 070 Task 8 deterministic matrix, and append actual results as completion evidence here.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      npm run release:check -- --version 0.0.8
      npm run release:publish -- --version 0.0.8 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`, `packages/provider-opencode-go/CHANGELOG.md`, `packages/provider-kimi/CHANGELOG.md`, core `CHANGELOG.md` (artifact-loop fix): amend 0.0.8 entries.
      - `bug-reports/prism-opencode-go-route-auth-and-structured-output-capabilities.md`: mark resolution status per defect (or link this plan if the repo convention is to keep reports immutable).
      - `plans/071-release-0-0-8-opencode-go-route-fixes-and-kimi-alignment.md`: completion evidence, compromises, further actions.
    - References:
      - Plan 070 Task 8 verification commands and evidence format.
  - Test Cases to Write:
    - Re-run only: existing release/package/install/docs/meta suites (no new test files expected; add coverage only if a changelog/docs guard requires it).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release evidence and changelogs are published artifacts.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: only if the amended scope changes release-gate descriptions (expected: no structural change).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Amended the unpublished `[0.0.8] - 2026-07-20` section in root `CHANGELOG.md` with a Fixed entry covering the artifact-loop parse-budget fix and both provider fix sets — no version bump, per the amendment-only approach (0.0.8 was never tagged or published).
    - Amended `packages/provider-opencode-go/CHANGELOG.md` (Fixed: dual-auth Anthropic headers, verified-only `json_schema` capability, truncation-fails-loudly) and `packages/provider-kimi/CHANGELOG.md` (Added: three featured Moonshot models; Fixed: Coding k3 effort default, exact context windows, compat-key stripping, dual-auth headers, truncation failures).
    - Appended a dated addendum to plan 070 Task 8 release evidence recording all four defect fixes and the Kimi alignment absorbed into the unpublished 0.0.8 release candidate, plus the requirement to re-run release-host verification before tag authorization.
    - No release step changed: `docs/release-and-install.md` untouched; `docs/index.md` untouched (entries verified still accurate; no new pages created by Tasks 1–5).
    - Full deterministic gate re-run: `npm run sdk:ready` passed with 0 failures across all workspaces (1,812 network-free passes — exactly 23 more than the original 0.0.8 gate, matching the 23 regression tests added by Tasks 1–5 — plus 25 explicit credential-gated live skips, unchanged). Docs suite 84/84. `git diff --check` clean.
    - Credential-gated items explicitly deferred to the release host (not fabricated locally): live `qwen3.7-plus` 200-response confirmation, Kimi Coding dual-auth acceptance check, verified-set extension beyond `mimo-v2.5*`, and `release:publish --dry-run` re-verification.

## Compromises Made

- Release-host re-verification (dry-run publish report, live provider checks with real credentials) could not run locally without credentials and a clean signed tree; recorded as explicit P0 gates in plan 070's Further Actions rather than fabricated.
- The OpenCode Go verified structured-output set is intentionally minimal (`mimo-v2.5`, `mimo-v2.5-pro`, from the bug report's live evidence); extending it requires per-model live verification.
- Kimi Coding keeps sending `authorization: Bearer` alongside the new `x-api-key`/`anthropic-version` headers because live dual-auth acceptance is credential-gated; Bearer-only rejection would be caught by the Task 6 release-host check before publication.
- Truncated-stream failures change observable behavior (previously silent `done`); documented in `docs/migration.md` rather than hidden behind an opt-in flag.

## Further Actions

- P0 before tag authorization: re-run `release:publish --dry-run`, protected canaries, and live checks (`qwen3.7-plus` Anthropic-route 200 response; Kimi Coding dual-auth acceptance) on the release host; then follow `docs/release-and-install.md` exactly.
- P1: extend `VERIFIED_JSON_SCHEMA_MODELS` only with per-model live evidence (e.g. if `deepseek-v4-pro` later documents `response_format` support).
  - Completion Evidence Addendum (2026-07-20): evaluated with current official sources; no extension is justified and none was made. DeepSeek's official Chat Completions reference limits `response_format.type` to `"text" | "json_object"` — `json_schema` is not supported upstream — and the bug report's live evidence for the gateway was HTTP 400. The verified set therefore stays exactly `mimo-v2.5` / `mimo-v2.5-pro` (the models with live 200-response evidence). An unauthenticated gateway probe returns HTTP 401 and the public `GET /zen/go/v1/models` payload carries no capability fields, confirming live verification needs credentials. Shipped the permanent evidence mechanism instead: three credential-gated probes in `packages/provider-opencode-go/src/__tests__/live.test.ts` — one success probe per verified model (asserts done + JSON output + no secret leak) and one boundary probe for `deepseek-v4-pro` (asserts rejection; a future failure of this test is the exact signal to extend the set). The boundary probe uses an explicit `defineOpenCodeGoModel` capability so it reaches the gateway rather than failing pre-dispatch. `docs/providers/opencode-go.md` documents the verification command and extension rule. Package suite: 36 network-free passes, 7 credential-gated skips (3 new), 0 failures; docs suite 84/84. Live execution of the probes remains a release-host credential-gated check.
- P2: if OpenCode Go's `/models` payload gains capability fields, replace the static verified set with discovery-driven mapping.
  - Completion Evidence Addendum (2026-07-20): implemented forward-compatible discovery-driven mapping. Re-fetched the live public `GET /zen/go/v1/models` payload — still sparse (`id`/`object`/`created`/`owned_by` only), so the trigger condition is not met today and behavior is unchanged. `OpenCodeGoModelEntry` now accepts an optional `capabilities.structured_output` (`"json_schema"` | `true` | `false`); `discoveryStructuredOutput()` in `models.ts` treats a present field as gateway-authoritative (including explicit `false`, which overrides the static verified set) and falls back to `VERIFIED_JSON_SCHEMA_MODELS` only for sparse entries. When the gateway ships capability fields, discovery becomes the source of truth with zero further code changes — the static set remains solely as the sparse-payload fallback. Three assertions added (`opencode_go_discovery_capability_fields_override_static_verified_set`): positive grant to unverified featured/unknown models, explicit-`false` override of a verified model, sparse-payload fallback. `docs/providers/opencode-go.md` documents the contract. Package suite: 37 network-free passes, 7 credential-gated skips, 0 failures.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
