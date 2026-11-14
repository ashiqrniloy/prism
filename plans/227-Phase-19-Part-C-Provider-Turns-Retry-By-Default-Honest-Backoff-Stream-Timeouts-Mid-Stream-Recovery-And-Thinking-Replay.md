# Phase 19 Part C — provider turns: retry by default, honest backoff, stream timeouts, mid-stream recovery, and thinking replay

## Objectives

- Survive ordinary provider trouble without host configuration. Today retry is off unless `AgentConfig.retry` is set (`mergeRetry`, `src/models/retry.ts`), and probe `p9-retry` failed a run on a single 429.
- Back off for as long as the provider asks. The default policy caps every delay, including a `Retry-After` hint, at 1,000 ms (`src/models/retry.ts:40`); the probe retried a 20 s hint after 1.1 s.
- Classify failures by their code, not their wording. Any message containing "abort" is treated as permanent (`src/models/retry.ts:63`), so "socket connection aborted" was not retried; 409 is treated as transient (`:28`); the Anthropic codec marks `rate_limit_error` permanent (`src/provider-kit/codecs/anthropic-messages.ts`, the `error` event branch).
- Stop waiting on a dead connection. The routed provider's `fetch` and the SSE reader have no connect or idle timeout (`src/provider-kit/routed-provider.ts`, `src/provider-kit/transport.ts` `readSseEvents`), so a stalled stream holds the run until the wall limit.
- Recover from a stream that drops after output began. A failure after the first event is final today (`final: failure?.observable`, `src/agent-session/session/provider-round.ts` `generateWithRetry`).
- Stop replaying another provider's reasoning as assistant text on the Anthropic route (`src/provider-kit/codecs/anthropic-messages.ts:364`).

## Expected Outcome

- With no `retry` configured, a transient failure before output is retried up to 4 attempts with exponential backoff and jitter; `retry: false` disables it. A `Retry-After` of up to `maxRetryAfterMs` (default 60 s) is honored in full; a longer hint fails the turn with `failureClass: "rate_limited"` and the hint in the error, without sleeping.
- One `Retry-After` parser serves every provider (seconds, HTTP date, and `retry-after-ms`).
- A provider request fails with `code: "ETIMEDOUT"` and `failureClass: "transient"` when no response headers arrive within `connectMs` (default 60 s) or no bytes arrive for `idleMs` (default 300 s). Both are retried like any transient failure.
- A transient failure after output began re-opens the turn: the failed attempt ends with `turn.completed { error }`, the next starts with `turn.started { attempt, retry }`, and the first-party host libraries discard the failed attempt's deltas. `retry.afterOutput: false` restores the 0.14.0 behavior.
- On the Anthropic route, a thinking block with no signature for that route is omitted from the replayed assistant message.

This plan implements roadmap **Phase 19 Part C**. It changes kernel contracts (retry defaults, `RetryOptions`, provider request timeouts, the turn-retry event sequence, codec output), so **Task 1 is the phase review**. It runs after plan 226. No version bump or publish. Live checks are opt-in through `bun run test:live` and are not part of `bun run test`.

Cost knobs: default retry adds at most three provider requests per failed turn, only on failure; mid-stream recovery adds one request per dropped stream and re-bills the input tokens of that turn. Both are stated in `docs/models.md` with the switches that turn them off.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Retry paths.** `retryLoop` and `createDefaultRetryPolicy` (`src/models/retry.ts`), the run-turn caller (`generateWithRetry`, `src/agent-session/session/provider-round.ts`), the package-call caller (`src/packages/loader.ts:710`), and every provider package that retries on its own (grep `retry` under `packages/providers/*/src`), so a request is never retried at two layers.
      - (b) **Failure classification.** `classifyProviderFailure` and `httpStatusError` (`src/provider-kit/transport.ts`), `providerHttpError` and `readRetryAfterMs` (`src/provider-kit/retry-http.ts`), `parseRetryAfterMs` (`transport.ts`), `isTransientErrorInfo` (`src/models/retry.ts:62-68`), the per-codec stream error mapping (Anthropic `error` event, OpenAI Chat mid-stream error frames, Responses `response.failed`), and what Bun's `fetch` throws for a reset, a refused connection, and a DNS failure (name and `code`).
      - (c) **Every `fetch` on the provider path** with whether it passes through `createRoutedProvider`: the built-in provider, each package under `packages/providers`, `systemone*`, the Ollama native codec, the Codex Responses path.
      - (d) **What a failed attempt leaves behind.** Whether any message is appended, which events were emitted, what usage was recorded, and how `activeLimitOutputBuffer` interacts (`provider-round.ts`), for a failure before and after the first event.
      - (e) **How each first-party host library consumes deltas** and whether it already resets on a re-opened turn: `packages/hosts/ag-ui/src/ag-ui-mapper.ts`, `acp/src/serve.ts`, `remote`, `channels` drafts, `mcp-server`, `devtools`, and `apps/prism-agent/src/adapters/stream-cli.ts`.
      - (f) **Thinking replay per codec.** What each of the three codecs does with a thinking block that has no signature or reasoning payload valid for its route, and what `resolvePreserveThinking` (`src/provider-kit/thinking.ts:271`) returns by default.
    - Performance: n/a — read-only.
    - Code Quality: Findings are written against the task they change.
    - Security: Records which error fields can carry provider response text into events, and that `redactSecrets` still covers them after Task 2 moves the parser.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.1, Phase 5; `docs/models.md`, `docs/provider-kit.md`, `docs/events.md`
      - `src/models/retry.ts`, `src/provider-kit/transport.ts`, `routed-provider.ts`, `retry-http.ts`
    - Options Considered:
      - Skip — rejected: (c) decides whether timeouts can live in one place, and (e) decides whether mid-stream recovery can default on.
    - Chosen Approach:
      - Inventory, then confirm or re-cut Tasks 2–5.
    - API Notes and Examples:
      ```bash
      graft callers retryLoop --depth all
      graft grep "fetch(" --in packages/providers/
      ```
    - Files to Create/Edit:
      - `plans/227-…md`: the task note
    - References:
      - Evaluation probe `p9-retry`, findings K8–K10, K20, C2, C3
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Retry is on by default, classifies by code, and waits as long as the provider asks
  - Acceptance Criteria:
    - Functional:
      - `AgentConfig.retry` omitted means the default policy: 4 attempts, base 500 ms, factor 2, cap 30 s, ±25% jitter. `retry: false` (agent or run) disables retry. An explicit `RetryOptions` behaves as today, with the new defaults for fields it omits.
      - `RetryOptions.maxRetryAfterMs` (default 60,000; hard cap 600,000). A hint at or under it is the delay, exactly, with no jitter and not capped by `maxDelayMs`. A longer hint does not sleep: the turn fails with the original error and `failureClass` unchanged.
      - A retry wait ends at once when the run is aborted or its wall limit passes.
      - Transience is decided from `failureClass`, `code`, and `name`: `AbortError` and the run's own abort are permanent; `ECONNRESET`, `ECONNREFUSED`, `ECONNABORTED`, `ETIMEDOUT`, `EAI_AGAIN`, `ENETUNREACH`, `UND_ERR_CONNECT_TIMEOUT`, `EPIPE` and Bun's equivalents from Task 1(b) are transient; 409 is not. The message regexes are removed.
      - `failureClass: "quota"`, `"auth"`, `"permanent"` and `"context_overflow"` are never retried.
      - `readRetryAfterMs` is deleted in favor of one `parseRetryAfterMs` that reads `retry-after-ms`, then `retry-after` (seconds or HTTP date), then a caller-supplied body value. Every caller moves in this task.
      - The Anthropic stream `error` event maps `rate_limit_error` to `rate_limited` and `overloaded_error` / `api_error` to `transient`.
      - Package model calls (plan 225 Task 5) use the same default.
    - Performance: No extra request on a successful turn. A failed turn costs at most `maxAttempts - 1` extra requests.
    - Code Quality: One classifier (`isTransientErrorInfo`) and one header parser; provider packages that retried themselves stop, or the task note says why one must keep its own.
    - Security: The wait is bounded by `maxRetryAfterMs`, so a hostile `Retry-After` cannot pin a run. Error text still passes `redactSecrets` in one place.
  - Approach:
    - Documentation Reviewed:
      - `src/models/retry.ts` (whole file), `src/provider-kit/retry-http.ts`, `transport.ts` (`parseRetryAfterMs`, `classifyProviderFailure`)
      - `src/contracts-core/compaction.ts:209` (`RetryOptions`), `src/contracts-core/agent.ts:96`
      - `docs/models.md` ("Retry")
    - Options Considered:
      - Keep retry opt-in and document it — rejected: the owner asked for the default fixed.
      - Sleep for any `Retry-After` — rejected: an unbounded wait is a denial of service on the run.
    - Chosen Approach:
      - Default policy on, hints honored within a stated bound, classification from structured fields.
    - API Notes and Examples:
      ```ts
      interface RetryOptions { readonly maxRetryAfterMs?: number; readonly afterOutput?: boolean /* Task 4 */ }
      createAgent({ model });                 // retries transient failures
      createAgent({ model, retry: false });   // never retries
      ```
    - Files to Create/Edit:
      - `src/models/retry.ts`: defaults, classifier, hint handling, `mergeRetry` (`undefined` → default)
      - `src/contracts-core/compaction.ts`: `RetryOptions` fields
      - `src/provider-kit/transport.ts`, `retry-http.ts`: one parser; remove `readRetryAfterMs`
      - `src/provider-kit/codecs/anthropic-messages.ts`: error classes
      - `packages/providers/*/src/*.ts`: callers of `readRetryAfterMs`, and own-retry removal per Task 1(a)
      - `src/__tests__/retry-defaults.test.ts`: new
      - `scripts/compat-baseline/*.txt` regenerated (`readRetryAfterMs` removed from `@arnilo/prism/provider-kit`); `bun scripts/retired-names.mjs --generate`; the diff and its attribution in the task note
    - References:
      - Probe `p9-retry`
  - Test Cases to Write:
    - `single_429_is_retried_by_default`: the probe's first case now completes.
    - `retry_false_disables_default_retry`.
    - `retry_after_within_bound_is_honored_exactly`: a 20 s hint waits 20 s on a fake clock.
    - `retry_after_beyond_bound_fails_without_sleeping`.
    - `econnaborted_is_transient`, `http_409_is_not_retried`, `abort_error_is_never_retried`.
    - `retry_wait_ends_on_run_abort`.
    - `quota_and_auth_are_never_retried`.
    - `parse_retry_after_forms`: `retry-after-ms`, seconds, HTTP date, malformed.
    - `anthropic_rate_limit_error_is_rate_limited`.
    - `no_retired_name_in_live_tree` stays green after `readRetryAfterMs` is removed.
    - Provider conformance (`@arnilo/prism/provider-kit`) passes for every provider package.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a default, two options, one removed export
    - Docs pages to create/edit:
      - `docs/models.md`: "Retry" rewritten (defaults, bounds, cost)
      - `docs/provider-kit.md`: one parser; classification table
      - `docs/agent.md`: `retry`
      - `CHANGELOG.md`: `## [Unreleased]`, Changed and Removed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Connect and idle timeouts on provider streams
  - Acceptance Criteria:
    - Functional:
      - `ProviderRequestOptions.timeouts: { connectMs?, idleMs? }`, defaults 60,000 and 300,000, each `null` to disable. `AgentConfig.providerOptions` and `RunOptions.providerOptions` set them.
      - No response headers within `connectMs`, or no bytes for `idleMs` while the body is read, aborts that request and yields a provider `error` event with `code: "ETIMEDOUT"`, `failureClass: "transient"`, and which timeout fired. SSE comments and `ping` frames count as bytes.
      - The helper is in `provider-kit` and every `fetch` Task 1(c) lists uses it, including the non-routed ones.
      - The run's own abort still wins and is reported as an abort, not a timeout.
    - Performance: One timer per request, re-armed per chunk without allocation; no added latency on a healthy stream.
    - Code Quality: One exported helper (`fetchWithStreamTimeouts`, name settled in review); no per-provider timeout code.
    - Security: A timeout error carries the timeout kind and duration, no response body.
  - Approach:
    - Documentation Reviewed:
      - `src/provider-kit/routed-provider.ts` (the fetch and the stream dispatch), `transport.ts` (`readSseEvents`, `readBoundedResponseText`)
      - `src/provider-kit/systemone-decisions.ts` (the one existing deadline, as the shape to follow)
      - Bun `fetch` and `AbortSignal.any` behavior at the pinned Bun floor (1.4.4), through the find-docs skill
    - Options Considered:
      - `AbortSignal.timeout` for the whole request — rejected: a long healthy stream would be cut.
      - Timeouts on `ModelSpec` — rejected: they are request policy, and `ProviderRequestOptions` already merges agent and run layers.
    - Chosen Approach:
      - A connect timer cleared on headers and an idle timer re-armed per chunk, both feeding one composed signal.
    - API Notes and Examples:
      ```ts
      createAgent({ model, providerOptions: { timeouts: { connectMs: 30_000, idleMs: 120_000 } } });
      ```
    - Files to Create/Edit:
      - `src/provider-kit/transport.ts`: the helper and the idle-aware reader
      - `src/provider-kit/routed-provider.ts`, `systemone*.ts`: use it
      - `src/contracts-core/provider.ts`: `timeouts`
      - `src/provider-kit/provider-request-policy.ts`: defaults and merge
      - `packages/providers/{ollama-cloud,openai-codex,…}/src/*.ts`: the non-routed fetches from Task 1(c)
      - `src/provider-kit/conformance.ts`: a stalled-stream case
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding K10
  - Test Cases to Write:
    - `no_headers_within_connect_timeout_is_etimedout`.
    - `stalled_stream_fails_after_idle_timeout`: a body that stops mid-stream.
    - `ping_frames_keep_the_stream_alive`.
    - `timeouts_null_disable`.
    - `run_abort_is_reported_as_abort_not_timeout`.
    - `stream_timeout_is_retried_by_default_policy`.
    - `provider_conformance_stalled_stream`: every provider package passes the new conformance case.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a request option and a default
    - Docs pages to create/edit:
      - `docs/models.md`: "Timeouts"
      - `docs/provider-kit.md`: the helper, and the rule that a provider's own fetch must use it
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: A stream that drops after output began is retried
  - Acceptance Criteria:
    - Functional:
      - With `retry.afterOutput` not `false`, a failure with `failureClass: "transient"` (including Task 3's timeouts) after the first event is retried under the same policy and attempt budget as a failure before output.
      - The failed attempt emits `turn.completed` with `error`; the next attempt emits `turn.started` with the same `turn`, `attempt + 1`, and `retry`. No `message.completed` is emitted for a failed attempt and nothing is appended to the branch.
      - `docs/events.md` states the rule a consumer follows: discard the deltas of a turn attempt that ends with `error`. Every first-party consumer Task 1(e) lists follows it in this task.
      - Usage the provider reported for the failed attempt is recorded once; an estimate is not projected for it.
      - A non-transient failure after output stays final, as today.
    - Performance: One extra provider request per dropped stream; nothing on a healthy turn.
    - Code Quality: The retry decision stays in `retryLoop`; the `observable` flag is replaced by the classification, not special-cased beside it.
    - Security: A partial tool call from a failed attempt is never dispatched.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session/provider-round.ts` (`generateWithRetry`, `generateProviderTurn`, `ProviderTurnFailure`), `src/agent-session/helpers.ts`
      - `docs/events.md` (`turn.started`, `turn.completed`, `message.delta`)
      - Task 1(d) and (e)
    - Options Considered:
      - Resume the stream from the partial output — rejected: no supported route offers it.
      - Default off — rejected: a dropped stream then still fails a long run; the kernel's own host libraries are fixed in the same task.
    - Chosen Approach:
      - Re-open the turn with the event sequence that already exists for pre-output retries, and make the discard rule explicit.
    - API Notes and Examples:
      ```text
      turn.started {turn: 3, attempt: 1} → message.delta… → turn.completed {turn: 3, error}
      turn.started {turn: 3, attempt: 2, retry} → message.delta… → turn.completed {turn: 3} → message.completed
      ```
    - Files to Create/Edit:
      - `src/agent-session/session/provider-round.ts`: classification instead of `observable`
      - `src/models/retry.ts`: `afterOutput`
      - `packages/hosts/{ag-ui,acp,channels,mcp-server,devtools}/src/…`, `apps/prism-agent/src/adapters/stream-cli.ts`: discard on a failed attempt
      - `src/testing/loop-conformance.ts`: a dropped-stream case
      - `src/__tests__/mid-stream-retry.test.ts`: new
    - References:
      - Evaluation finding K9
  - Test Cases to Write:
    - `transient_drop_after_output_is_retried`: two deltas then a reset; the run completes with the second attempt's text only in `RunResult.text`.
    - `failed_attempt_appends_nothing`.
    - `after_output_false_keeps_failure_final`.
    - `permanent_failure_after_output_is_final`.
    - `partial_tool_call_from_failed_attempt_is_not_dispatched`.
    - `ag_ui_mapper_discards_failed_attempt_text`, `acp_discards_failed_attempt_text`, `channel_draft_resets_on_failed_attempt`.
    - `reference_host_stream_cli_discards_failed_attempt`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an event-sequence guarantee and an option
    - Docs pages to create/edit:
      - `docs/events.md`: the discard rule, with the sequence above
      - `docs/models.md`: `retry.afterOutput` and its cost
      - `packages/hosts/{ag-ui,acp,channels}/README.md`: one line each
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Reasoning that a route cannot verify is not replayed as text
  - Acceptance Criteria:
    - Functional:
      - On the Anthropic Messages route, a non-redacted thinking block is serialized as `thinking` only when `preserveThinking` is true and it carries a signature; otherwise it is omitted. It is never serialized as a `text` block.
      - An assistant message left with no content after the omission keeps the existing empty-text placeholder, so the request stays valid.
      - The other two codecs are changed only if Task 1(f) finds the same conversion; the task note records each codec's rule.
      - Stored history is unchanged; only the wire body differs.
    - Performance: Fewer replayed tokens on cross-provider sessions; the task note records the body-size delta on one recorded fixture.
    - Code Quality: One rule per codec, stated in `docs/provider-kit.md`.
    - Security: Reasoning text from one provider is no longer shown to another as if the assistant had said it.
  - Approach:
    - Documentation Reviewed:
      - `src/provider-kit/codecs/anthropic-messages.ts:355-366`, `src/provider-kit/thinking.ts:271-282`
      - `src/testing/prefix-stability-conformance.ts` (the body change must not break prefix stability within one route)
      - Anthropic Messages thinking-block rules, through the claude-api skill
    - Options Considered:
      - Keep the text fallback behind a compat flag — rejected: no caller is known to need it; Task 1(f) reopens this if one is found.
    - Chosen Approach:
      - Omit.
    - API Notes and Examples:
      ```ts
      // before: { type: "text", text: part.text }   after: (nothing)
      ```
    - Files to Create/Edit:
      - `src/provider-kit/codecs/anthropic-messages.ts`
      - `src/__tests__/` codec tests beside the existing Anthropic body tests
    - References:
      - Evaluation finding C2
  - Test Cases to Write:
    - `unsigned_thinking_is_omitted_on_anthropic_route`.
    - `signed_thinking_is_replayed_when_preserved`.
    - `message_with_only_unsigned_thinking_stays_valid`.
    - `prefix_stability_holds_after_omission`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — wire bytes on one route
    - Docs pages to create/edit:
      - `docs/provider-kit.md`: thinking replay rule per codec
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/retry-defaults.test.ts src/__tests__/mid-stream-retry.test.ts`
- `bun run --filter @arnilo/prism-ai test`
- `bun run --filter @arnilo/prism-hosts test`
- `bun run --filter @arnilo/prism-agent test`
- `bun scripts/retired-names.mjs`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
