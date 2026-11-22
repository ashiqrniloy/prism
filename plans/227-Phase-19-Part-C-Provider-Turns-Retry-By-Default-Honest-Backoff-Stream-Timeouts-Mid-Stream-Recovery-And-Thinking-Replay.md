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

- [x] Task 1: Phase review (read-only)
  - Notes (executed 2026-11-15) — read-only; the only file changed is this plan. A throwaway probe (scratchpad, not committed) printed the real event sequence and Bun's fetch errors; Bun 1.4.4 (the floor).
    - **(a) Retry paths.** Three retry layers, and one of them overlaps:
      - `retryLoop` (`src/models/retry.ts:109`) is the single loop. Callers: `generateWithRetry` (`provider-round.ts:276-315`, policy from `mergeRetry(agent.config.retry, options.retry)` at `:287`) and `generatePackageCall`'s `open` (`src/packages/loader.ts:804`, policy from `mergeRetry(hostConfig.retry, undefined)` at `:736`; the plan's `:710` is stale). The package-call path retries only until the first event (`open` reads `iterator.next()` at `loader.ts:789-792`); a later failure becomes a redacted `error` event.
      - `postSystemOne` (`src/provider-kit/systemone.ts:258-285`) is a second loop that builds its own `createDefaultRetryPolicy({maxAttempts: maxRetries+1, transientCodes: [status]})` (`:293`), default 2 retries (`:172`). It is for decision calls, outside `retryLoop`. It passes `baseDelayMs`/`maxDelayMs` as `undefined` (`:296-297`), so **changing the `createDefaultRetryPolicy` defaults in Task 2 silently changes SystemOne from 100 ms/1 s to 500 ms/30 s**. A decision model reached through `generate()` (`ollama-cloud/provider.ts:~87`, `decision.generate`) can also sit inside `generateWithRetry`, which is a double layer. Task 2 must pin SystemOne's values (or route it through the same policy deliberately), and the task note must say which.
      - No provider package under `packages/providers/*/src` has its own retry loop. They only call `readRetryAfterMs`: `commandcode/provider.ts:92`, `hyper/provider.ts:91`, `kilo/provider.ts:143`, `litellm/provider.ts:81`, `ollama-cloud/models.ts:391` and `native.ts:283`, `openrouter/provider.ts:68`; plus `systemone.ts:272`. `hyper` additionally gates the hint on `RETRYABLE_STATUSES` (`hyper/provider.ts:93,101`). `openai-codex/errors.ts` only classifies. So "own-retry removal" in Task 2 reduces to SystemOne.
      - `mergeRetry` (`retry.ts:86-90`) collapses `false` and `undefined` into `undefined`, and `retryLoop` reads `undefined` as "no policy" (`:111`). The default-on change needs a three-way result (off / default / explicit); package calls pass `hostConfig.retry`, so they get the default for free once that is fixed.
      - A retry wait aborts on the run signal (`waitForRetry`, `retry.ts:71-75`, `{signal}`); `RunLimitTracker.onExceeded` aborts the run controller (`assemble.ts:726-731`), so a wall-limit breach ends the wait. Existing test: `agents.test.ts` "retry backoff honors abort signal".
      - `RetryOptions` (`src/contracts-core/compaction.ts:209`) has no `factor`/`jitter`; those stay internal to the default policy.
    - **(b) Classification.**
      - `isTransientErrorInfo` (`retry.ts:62-68`): permanent on `name === "AbortError"` **or any message matching `/aborted|abort/i`**; `quota` permanent; then code set (`TRANSIENT_CODES` `:17-35`, includes `ENOTFOUND` and 409); then message regex `/timeout|temporar|rate.?limit|overload|unavailable/i`. It does not read `failureClass` except `quota`, so `auth`, `permanent` and `context_overflow` are only safe because their codes (401/403/400…) happen to be outside the set.
      - `classifyProviderFailure` (`transport.ts:50-66`): 401/403 → auth; 429 → `quota`/`rate_limited` by body regex; overflow by body on 400/413/422; other status ≥500 transient, ≥400 permanent; no status → transient only for `ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT` on the error or its `cause` (`:38,61`; note it lacks `ECONNABORTED`, `EPIPE`, `ENOTFOUND`); a quota body with no status → quota; else `unknown`. `ENOTFOUND` is in the retry set but not in the classifier set: the two lists disagree. Task 2 must collapse them into one.
      - `httpStatusError` (`transport.ts:83-90`) sets numeric `code`, `retryAfterMs` from `parseRetryAfterMs(response.headers.get("retry-after"))` (`:115-121`, seconds or HTTP date, **no `retry-after-ms`**, returns `seconds * 1000` unrounded). `readRetryAfterMs` (`retry-http.ts:30-34`) is a second parser (seconds only, rounds, case-insensitive record or `Headers`, accepts a body value, **no HTTP date**). Two parsers with different coverage, as the plan says. `providerHttpError` (`retry-http.ts:56-72`) builds the redacted error and `failureClass`.
      - Codec stream errors: Anthropic `error` event (`anthropic-messages.ts:199-208`): `code = vendorError.type`, transient only for `overloaded_error|api_error`, **everything else, including `rate_limit_error`, is `permanent`** (confirms plan). OpenAI Chat (`openai-chat.ts:482-490,677-687`): a top-level `error` frame or `finish_reason: "error"` → `streamErrorEvent`, `code` is the numeric status when the frame has one, else none, so classification falls to `unknown` and the retry policy's message regex. Responses `response.failed` (`openai-responses.ts:466-470,547-562`): `code` is the wire string (e.g. `rate_limit_exceeded`, `server_error`) or a number; `failureClass` comes from `providerError` → `classifyProviderFailure`, which returns `unknown` for a string code. `rate_limit_exceeded` is not in `TRANSIENT_CODES` (`rate_limit` is), so a Responses rate limit in-stream is **not** retried today except through the message regex.
      - **Bun 1.4.4 `fetch` failures (measured):** refused → `TypeError`, `code: "ECONNREFUSED"`; DNS → `TypeError`, `code: "ENOTFOUND"`, `syscall: "getaddrinfo"`; reset before headers, reset mid-body and a clean TCP FIN mid-chunked-body → all `TypeError`, `code: "ECONNRESET"` (a FIN mid-body does **not** end the stream cleanly, so the codecs' own "stream ended without completion" check is a second line of defense, not the first); caller abort → `AbortError`, **numeric `code: 20`**; `AbortSignal.timeout` → `TimeoutError`, numeric `code: 23`. Two consequences for Task 2: the transient set needs `ENOTFOUND`'s status (retry it? it is in today's set, keep) and the abort rule must read `name`, never a code, because 20/23 are not HTTP statuses and `readHttpStatus` (`transport.ts:92-99`) already ignores them (range 100-599). The probe's "socket connection aborted" (`ECONNABORTED`) did not reproduce on Linux; the Task 2 test builds that error by hand.
    - **(c) Every `fetch` on the provider path.** Routed (one place to put timeouts): `routed-provider.ts:239-245` (every `createRoutedProvider` user: `commandcode`, `hyper`, `kilo`, `litellm` via `observingFetch` at `litellm/provider.ts:124-136`, `ollama-cloud` openai route, `openai-codex`, `opencode-go`, `openrouter`, and `createBuiltinProvider` `src/models/builtin.ts:26`). **Not routed:** (1) the Ollama native codec `ollama-cloud/native.ts:147` (`/api/chat`, streams NDJSON through `readNdjsonLines`, not `readSseEvents`), (2) SystemOne `postSystemOne` `systemone.ts:262` (used by `laya`, `liquid`, `typesafe`, `ollama-cloud` decisions), which already has a whole-call deadline in `systemone-decisions.ts:98-99`. Catalog and quota fetches (`*/models.ts`, `hyper/quota.ts:31`, `litellm/spend-logs.ts:142`, `ollama-cloud/models.ts:250,268,327,381`, `openai-codex/oauth.ts:249,495,505`, `kilo/auth.ts:233`) are not turn requests; Task 3 leaves them alone and says so. Consequence for Task 3: the helper must wrap both the routed fetch/stream and `native.ts`'s NDJSON reader, so it has to be reader-agnostic (wrap the `Response.body` stream, not `readSseEvents`).
    - **(d) What a failed attempt leaves behind** (probe, pre-output 503 then success; and post-output error):
      - Pre-output retry sequence: `turn.started{md.attempt=1}` → `turn.completed{error, usage}` → `turn.started{attempt=1, retry}` → `turn.started{md.attempt=2}` → deltas → `turn.completed` → `message.completed`. **A retry emits two `turn.started`**: the `onRetry` marker (`provider-round.ts:304-313`, `attempt` is the *failed* attempt's number) and the next attempt's own opener (`:335-341`, no top-level `attempt`, `metadata.attempt = n+1`). The plan's "next starts with `turn.started { attempt + 1, retry }`" is not what the code does. Task 4 settles one event: the attempt's own opener carries `attempt` and `retry`, and `onRetry` stops emitting (updating `agents.test.ts:1926`, which asserts `attempt === 1 && retry.delayMs === 0`, in the same task).
      - Nothing is appended on failure: the assistant message is appended by the caller only after `generateProviderTurn` returns; the failure path emits `turn.completed{error}` and throws `ProviderTurnFailure(info, started)` (`:470-491`). Post-output probe: `message.delta` → `turn.completed{error}` → `run.failed`; `RunResult.text` is `""`. So the history is already clean; only event consumers see the dead attempt's deltas.
      - **Usage on a failed attempt is an estimate today.** `recordTurnUsage()` runs in the catch (`:469`) and, with no reported usage, `estimateTurnUsage` (`:196-203`) projects `{estimated: true}` input tokens into the limits, run usage and ledger (`meterUsage` `:129-161`). The only skip is the overflow case (`:468`). So a pre-output 503 already bills an estimate, and the probe's failed `turn.completed` carries `usage`. Task 4's "an estimate is not projected for a failed attempt" is therefore a behavior change for *every* failed attempt, not just after output; it also changes `maxInputTokens`/`maxCost` accounting for retried runs. Decision for Task 4: skip the estimate when the attempt failed with a transient error that will be retried; a final failure keeps today's accounting. Recorded as an amendment below.
      - `activeLimitOutputBuffer` (`assemble.ts:738`, `provider-round.ts:352-356`): when a run has `maxOutputTokens`/`maxTotalTokens`/`maxCost`, deltas are buffered in `bufferedOutput` and emitted only after usage is recorded and the limit check passes (`:428`). On a failed attempt the buffer is dropped, so **limit-capped runs never show a failed attempt's deltas**; uncapped runs do. Mid-stream recovery therefore changes what a consumer sees only for uncapped runs, and the discard rule must hold for both.
      - `maxProviderAttempts` is charged per attempt (`:329`), so mid-stream retries count against it with no new limit; `maxRequestBytes` is charged per attempt too (`:330`).
    - **(e) Host delta consumers.**
      - `ag-ui` (`ag-ui-mapper.ts:346-371,427-431`): maps `turn.started` to `STEP_STARTED turn:N`, text deltas to `TEXT_MESSAGE_CONTENT` on `activeMessage`, and `turn.completed` to `STEP_FINISHED` plus an AG-UI error if `event.error`. It does not reset: a failed attempt's text stays in the open message and the retry's text appends to it. AG-UI has no retract; the fix is to end the message (`TEXT_MESSAGE_END`), emit a `prism.retry` custom event, and open a new message on the next delta — or hold deltas until the attempt settles. Also `turn.completed{error}` is surfaced as an AG-UI `RUN_ERROR` even when the retry succeeds; that already misleads clients on pre-output retries.
      - `acp` (`acp/src/mapper.ts:266-312`): `agent_message_chunk`/`agent_thought_chunk` are append-only and ACP has no retract; the comment at `:308-312` says retryable turn failures "stay silent here and may recover" (true only before output). `textDeltaSeen` is not reset on a failed attempt. **A host that cannot retract must buffer.** Recommended for Task 4: the ACP mapper holds each attempt's text and thought deltas until `turn.completed` without `error`, then flushes (streaming latency per turn is lost; ACP clients get whole-turn chunks); this is the only correct option for a protocol with no undo. Needs an owner call only if the streaming loss is unacceptable.
      - `channels` (`runtime-turn.ts:394-426`): `createPreview` keeps a cumulative `text` reset only on `run.started` (the doc comment says it also resets per assistant message; the code does not). A failed attempt's text stays in the preview and the retry's text is appended. Fix: reset on `turn.completed{error}`.
      - `remote` (`remote/src/serve.ts:485`): forwards `session.stream()` events verbatim to a remote client; the discard rule is documentation-only there, so `docs/events.md` and the remote README carry it. `devtools` (`serve.ts:181-185`): SSE passthrough of `agent.subscribe()`/`session.subscribe()`, no accumulation; its UI, if any, needs checking in Task 4 (no `delta` handling found under `packages/hosts/devtools/src`). `mcp-server` (`serve.ts:150`) and `headless` (`scheduler/firing.ts:32`) use `session.run()` and read `RunResult`, so they never see a delta. `evals` (`experiment.ts:319-320`) counts `turn.started` into `startedTurns` against `turn.completed`: the double `turn.started` per retry (see (d)) inflates `startedTurns`; a one-event fix in Task 4 corrects it. `apps/prism-agent/src/cli/run.ts:55-60` prints every event as JSON lines, no accumulation.
      - **`apps/prism-agent/src/adapters/stream-cli.ts` is not a consumer.** It maps an *external worker's* stream-JSON frames into `ExternalActivity` (`:170-200`), i.e. input, not kernel events. Task 4 drops it from the file list and drops the `reference_host_stream_cli_discards_failed_attempt` test; the reference host's consumer is `cli/run.ts` (passthrough, nothing to fix).
    - **(f) Thinking replay per codec; `resolvePreserveThinking`** (`thinking.ts:271-282`) returns `false` when compat sets it false, `true` when it is true, else `model.capabilities?.reasoning === true`: **default on for any reasoning-capable model**.
      - Anthropic (`anthropic-messages.ts:358-366`): redacted → `redacted_thinking`; signed and `preserveThinking` → `thinking`; **everything else, including `preserveThinking: false`, becomes a `text` block with the reasoning** (the plan's `:364` is `:363`-`:365` now). That also happens when the signature was produced by another route. The plan says omit only when "unsigned or not preserved"; confirmed: both are in the else. A second spot, `text()` (`:433-440`), returns thinking text only when `preserveThinking && !redacted`; it is the plain-text flattening used elsewhere in the file, check at Task 5 start whether it can reach the wire for assistant history (it does not read the signature).
      - OpenAI Chat (`openai-chat.ts:363-406`): default `reasoningReplay: "fold"` (`:175,321`) with `preserveThinking` **folds the reasoning text into the assistant message as plain text**, the same conversion, deliberately and documented as a replay mode (`reasoning_content`, `reasoning_details`, `drop` are the others). It is on by default for reasoning-capable models. Whether the default should be `drop` is an owner call, not this plan: it changes every Chat-wire provider's body. Task 5 changes Anthropic only and records this as a Further Action.
      - Responses (`openai-responses.ts:286-295`): replays a reasoning item only when `replayReasoningItem(part.data, model.provider)` accepts it (own provider, encrypted payload); a foreign block, and a summary with no payload, is dropped, and thinking in non-assistant messages is ignored (`:321`). Already correct; no change.
    - **Security.** Fields that can carry provider response text into events: `ErrorInfo.message` and `cause` (both through `redactSecrets`, `redaction.ts:176-181`); **`ErrorInfo.code` and `name` are copied unredacted** (`redaction.ts:167,175`): Anthropic's `code` is `vendorError.type` and Responses' `code` is the wire string, both provider-controlled text. A secret echoed in a wire `code` would reach events. Task 2 bounds this by mapping unknown wire codes to a closed `failureClass` and capping `code` to a short token pattern (`/^[A-Za-z0-9_.:-]{1,64}$/`, else dropped) in `errorToErrorInfo`; the parser itself returns a number, so moving it adds no new text path. `retryAfterMs` is a finite number. `redactSecrets` stays in `errorToErrorInfo`/`providerHttpError`/`readBoundedResponseText`; the new timeout error (Task 3) carries a kind and duration only.
    - **Amendments to Tasks 2–5** (applied below): Task 2 pins SystemOne's old delays, makes `mergeRetry` three-way, fixes `classifyProviderFailure`/`TRANSIENT_CODES` into one set, caps `code` in `errorToErrorInfo`, and adds the Responses `rate_limit_exceeded` mapping. Task 3 wraps the response body stream (so Ollama NDJSON is covered) and leaves catalog/quota fetches alone. Task 4 uses one `turn.started` per attempt, skips the estimate for a retried failure, buffers in ACP, resets AG-UI and channels, and drops `stream-cli.ts`. Task 5 changes Anthropic only.
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

- [x] Task 2: Retry is on by default, classifies by code, and waits as long as the provider asks
  - Notes (executed 2026-11-15)
    - **What changed.**
      - `src/models/retry.ts`: defaults 4 attempts / 500 ms base / factor 2 / 30 s cap / ±25% jitter (module constants, not exported). `maxRetryAfterMs` (default 60,000, clamped to 600,000): a hint at or under it is returned as `delayMs` exactly (rounded, no jitter, not capped by `maxDelayMs`); a longer hint returns `{ retry: false }`, so the turn fails with the original `ErrorInfo` (failureClass and `retryAfterMs` intact; `errorFromInfo` now copies `retryAfterMs` onto the thrown error so `RunResult.error.retryAfterMs` carries the hint). `isTransientErrorInfo` reads `name`, `failureClass`, `code` only: `AbortError` → false; `quota|auth|permanent|context_overflow` → false; `code` in the set → true; else `failureClass` `transient|rate_limited` → true; message regexes removed. 409 removed from the set. `mergeRetry` is three-way: `undefined` = off (`false` at run, or at agent with no run override), `{}` = default, otherwise merged options. Package calls (`loader.ts:736`, `mergeRetry(hostConfig.retry, undefined)`) get the default with no change there.
      - One network set, `TRANSIENT_NETWORK_CODES` (internal export of `retry.ts`: `ECONNRESET`, `ECONNREFUSED`, `ECONNABORTED`, `ETIMEDOUT`, `EAI_AGAIN`, `ENETUNREACH`, `ENOTFOUND`, `EPIPE`, `UND_ERR_CONNECT_TIMEOUT`), imported by `transport.ts`'s `classifyProviderFailure`, which also maps stream wire codes without a status (`rate_limit_error`, `rate_limit_exceeded` → `rate_limited`; `overloaded_error`, `api_error`, `server_error` → `transient`) through a private table. The Anthropic `error` event now takes its class from `classifyProviderFailure` (`unknown` → `permanent`, as before for other vendor types). Responses `response.failed` needed no codec edit: its string `code` now classifies through the same table.
      - `parseRetryAfterMs(source, bodyRetryAfter?, now?)` in `transport.ts` is the one parser (`retry-after-ms`, then `retry-after` seconds or HTTP date, then a body value in seconds; `Headers`, a header record or one raw value; whole ms). `readRetryAfterMs` deleted from `retry-http.ts`; callers moved: `systemone.ts`, `hyper`, `openrouter`, `commandcode`, `kilo`, `litellm`, `ollama-cloud` (`native.ts`, `models.ts`). `redaction.ts`'s private reader was renamed `readErrorRetryAfterMs` so the retired name has no live spelling.
      - `errorToErrorInfo` keeps a string `code` only when it matches `/^[A-Za-z0-9_.:-]{1,64}$/` (numbers must be finite); `redactSecrets` still covers `message`/`cause` in the same function, so error text still meets redaction in one place.
      - **SystemOne's loop stays.** `postSystemOne` is used by `decide()` calls that never pass through `retryLoop`, so removing it would leave decisions with no retry. It now pins its own delays (100 ms base, 1 s ceiling, `max(base, maxDelay)` as before) and caps the hint at that ceiling before the shared policy sees it, so decisions keep the pre-plan behavior apart from the hint no longer being jittered.
      - `RetryOptions.maxRetryAfterMs`, `DefaultRetryPolicyOptions.maxRetryAfterMs`; `ErrorInfo.failureClass`/`retryAfterMs` doc comments now say what the policy does with them.
    - **Tests.** New `src/__tests__/retry-defaults.test.ts` (14): `single_429_is_retried_by_default`, `default_policy_has_four_attempts_and_exponential_backoff`, `retry_false_disables_default_retry` (agent and run, and a run re-enabling it), `retry_after_within_bound_is_honored_exactly` (20 s on the policy, no fake clock needed since the policy returns the delay; a 40 ms hint end-to-end), `retry_after_beyond_bound_fails_without_sleeping` (also the 600 s hard cap, and `RunResult.error` keeps `failureClass`/`retryAfterMs`), `econnaborted_is_transient`, `http_409_is_not_retried`, `abort_error_is_never_retried`, `retry_wait_ends_on_run_abort`, `quota_and_auth_are_never_retried`, `parse_retry_after_forms`, `anthropic_rate_limit_error_is_rate_limited`, `responses_wire_codes_classify_like_anthropic`, `unsafe_wire_code_never_reaches_error_info`. Updated: `retry.test.ts` (the hint test now asserts exact, uncapped, unjittered, and the past-bound stop; the message test asserts wording is not read), `retry-http.test.ts` and `provider-transport.test.ts` (moved to `parseRetryAfterMs`), `provider-kit.test.ts` and `public-export-contract.test.ts` (inventory minus `readRetryAfterMs`).
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`). This task: `./provider-kit readRetryAfterMs` **removed**; `./provider-kit parseRetryAfterMs` signature `(value: string | null, now?)` → `(source: RetryAfterSource, bodyRetryAfter?: unknown, now?)`; `+ ./provider-kit RetryAfterSource` (type); `RetryOptions` and `DefaultRetryPolicyOptions` gain `maxRetryAfterMs?`. The same regeneration also wrote entries that belong to earlier uncommitted work, not this task: plan 226 Tasks 2–4 (`AgentConfig.tools.validation`/`concurrency`, `RunOptions.tools.concurrency`, `DispatchToolCallOptions.validation`, `ToolArgumentValidation`, `ToolDefinition.timeoutMs`/`validateArguments`, `RunLimits`/`ResolvedRunLimits.maxToolTimeMs`, `RunLimitName`) and plan 218.2 Tasks 2–5 in `arnilo__prism-memory-system.txt` (`MemoryDurable`, `MemoryEventStatus`, `MemoryObservation`, `MemorySessionConfig`, `ObservationalMemoryLedger`, `ResolvedMemorySystemConfig`, `WmRecordedData`).
    - **Sweep.** `bun scripts/retired-names.mjs --generate` added `readRetryAfterMs`; `bun scripts/retired-names.mjs`: 0 hits in 2,059 files.
    - **Budgets and generated files.** `scripts/budgets.json` kernel ceilings rebaselined with a reason: 1,288,841 packed, 4,173,653 unpacked, 42,176 source lines, 1,550 counted exports (+1 internal `TRANSIENT_NETWORK_CODES`, +1 type `RetryAfterSource`, −1 `readRetryAfterMs`); `exportCounts["@arnilo/prism"]` 1,550. `bun scripts/host-builder-index.mjs`, `bun scripts/package-truth.mjs --emit-docs` and `bun scripts/host-builder-evals/run.mjs --register` re-run.
    - **Checks.** `bun run typecheck` green; `bunx biome lint` clean on the changed files; `bun test src/__tests__/docs.test.ts` 69 pass; `@arnilo/prism-ai` 300 pass (provider conformance included), `@arnilo/prism-agent` 66 pass, `@arnilo/prism-extensions` 1,080 pass. `@arnilo/prism-hosts` 922 pass / 1 fail and `@arnilo/prism-tools` 1,266 pass / 2 fail: the failures are wall-clock budgets (`prism_api … under 50 ms`, `hard_deny_decision_budget`, the office max-page envelope) that run no retry code; `prism_api` passes alone, `hard_deny_decision_budget` (a realpath loop) misses 50 ms on this machine alone too. `bun test src/__tests__`: 4,892 pass / 4 fail. The four are `hard_deny_decision_budget` and the governance field-policy microbenchmark (wall-clock budgets), and the two `@arnilo/prism-tools/browser` tests that this directory pulls in through `release.test.ts`. Both browser tests pass when their files run alone, and none of the four run retry code. A first full run also had an unnamed 120 s hook timeout and a remote-conformance timing miss; neither recurred, and `remote/conformance.test.ts` passes alone.
    - **`bun scripts/release.mjs gate` fails on one check, by the plan's own constraint:** `ranges: @arnilo/prism-ai changed since v0.13.0 but version is still 0.13.0 (bump required)`. The provider sources had to move off `readRetryAfterMs`, and this plan does no version bump. Every other gate check passes. The release plan that ships 227 bumps `@arnilo/prism-ai`; until then the gate reports this line.
    - **Findings for later tasks.**
      - Task 3: Bun's `AbortSignal.timeout` throws `TimeoutError` (`code: 23`), which the classifier does not retry (not `AbortError`, no transient code or class). The timeout helper must throw its own error with `code: "ETIMEDOUT"` and `failureClass: "transient"`, as the task says; do not rely on `TimeoutError`.
      - Task 4: `retryLoop` already routes through `isTransientErrorInfo`; replacing `final: failure?.observable` with "observable and not `afterOutput !== false` and transient" is the only change the loop needs. `mergeRetry({}...)` now always yields an object for the default, so `retry?.afterOutput` reads safely.
      - Double layer that stays: a decision model reached through `generate()` (`ollama-cloud/provider.ts:75`, `decision.generate`) retries 429/5xx up to 3 times inside one turn attempt, and the turn now retries by default up to 4, so a dead decision endpoint costs up to 12 requests. Recorded in Further Actions.
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
      - *(Task 1 amendments)* `mergeRetry` returns three states (off / default / explicit) so `false` and `undefined` differ for agent, run and `hostConfig.retry`. `postSystemOne` (`systemone.ts:293`) keeps its own delays by passing them explicitly (it must not inherit 500 ms/30 s), and the note says whether its loop stays. One transient set serves both `isTransientErrorInfo` and `classifyProviderFailure` (`ENOTFOUND` and `ECONNABORTED`/`EPIPE` are in both or neither). The Responses stream code `rate_limit_exceeded` and `server_error` map to `rate_limited`/`transient` as the Anthropic codes do. `errorToErrorInfo` keeps `code` only when it matches `/^[A-Za-z0-9_.:-]{1,64}$/` (provider text never reaches events through `code`).
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

- [x] Task 3: Connect and idle timeouts on provider streams
  - Notes (executed 2026-11-15)
    - **What changed.**
      - `src/contracts-core/provider.ts`: `ProviderRequestTimeouts { connectMs?: number | null; idleMs?: number | null }` and `ProviderRequestOptions.timeouts`. `mergeProviderRequestOptions` (`provider-request-policy.ts`) merges it field by field and adds the key only when a side has it (no `timeouts: undefined` on merged options). Defaults live with the helper, not in the policy: `applyDefaultProviderRequestOptions` does not stamp them, so a request without `timeouts` stays byte-identical and the helper applies 60,000 / 300,000.
      - `src/provider-kit/transport.ts`: `fetchWithStreamTimeouts(input, init, { fetch, timeouts })` (name settled). The connect timer races the fetch (a timeout wins even over a transport that ignores its signal) and is cleared on headers. The body is re-streamed through `idleTimedBody`: one timer per request, created on the first read and `refresh()`ed per read (Bun 1.4.4 measured: `refresh()` re-arms a fired timer, not a cleared one, so the callback checks a `pending` flag instead of clearing), armed only while a read is pending, so a slow consumer never trips it. A timeout aborts the inner controller and errors the stream with a private `ProviderTimeoutError` (`code: "ETIMEDOUT"`, `failureClass: "transient"`, `timeout: "connect" | "idle"`, `timeoutMs`; the message names the kind and duration, no body). The caller's `init.signal` is forwarded to the inner controller and wins: once it fired, a timer is a no-op, so a run abort surfaces as `AbortError`. A non-positive or non-finite value throws a `RangeError` before the fetch. `cancel()` cancels the source and releases its lock (`ollama_native_early_done_cancels_stream` asserts `body.locked === false`).
      - Callers (every turn fetch from Task 1(c)): `createRoutedProvider` (`routed-provider.ts`, step 8, so every routed provider and `createBuiltinProvider`/`createOpenAICompatibleProvider`), `postSystemOne` (`systemone.ts`, new `SystemOneClientOptions.timeouts`, per attempt; `askSystemOneDecisions` keeps its whole-call `timeoutMs`), `createSystemOneDecisionProvider.generate` passes `request.options?.timeouts`, and `ollamaCloudNativeEvents` (`packages/providers/ollama-cloud/src/native.ts`). `openai-codex` is routed and needed no edit (the plan's file list named it). Left alone, as not turn requests: every `*/models.ts` catalog fetch, `hyper/quota.ts`, `litellm/spend-logs.ts`, `ollama-cloud/models.ts` balance/show/tags, `openai-codex/oauth.ts`, `kilo/auth.ts`.
      - `src/provider-kit/conformance.ts`: private `assertStalledStreamTimesOut` runs a stalled connect and a silent body (30 ms timeouts, 5 s guard) and requires a terminal `ETIMEDOUT` / `transient` error. `providerConformance` runs it once per recorded run (the first scenario's request, with `sessionId` filled for providers that require it); `systemOneConformance` runs it and reports a `stalled-stream` scenario. Not in `providerConformance`'s non-recorded mode: there the factory is called with no fetch and uses the test's own fake, so the check cannot inject a stall. Every provider package has a recorded or SystemOne conformance run, so all eleven are covered.
    - **Tests.** New `src/__tests__/stream-timeouts.test.ts` (10): `no_headers_within_connect_timeout_is_etimedout`, `connect_timeout_wins_against_a_transport_that_ignores_its_signal`, `stalled_stream_fails_after_idle_timeout` (output began, then silence), `ping_frames_keep_the_stream_alive` (SSE comments and `event: ping` every 30 ms under a 60 ms idle limit, 150 ms stream), `slow_consumer_is_not_an_idle_stream`, `timeouts_null_disable`, `invalid_timeout_fails_before_fetch`, `run_abort_is_reported_as_abort_not_timeout` (before headers and while reading), `stream_timeout_is_retried_by_default_policy` (agent with `providerOptions.timeouts.idleMs: 30`, first body silent, second answers; completes with 2 calls), `timeouts_merge_per_field_across_agent_and_run`. `provider_conformance_stalled_stream` is the new conformance case itself, exercised by every provider package's existing conformance test (`@arnilo/prism-ai` 300 pass). Updated: `openai-compatible.test.ts` "passes abort signal to fetch" asserted signal identity; fetch now sees the helper's composed signal, so it asserts the caller's abort reaches it. `provider-kit.test.ts` and `public-export-contract.test.ts` inventories gain `fetchWithStreamTimeouts`.
    - **Baseline diff** (this task only, against a pre-task copy of `scripts/compat-baseline`): additive. `+ . ProviderRequestTimeouts`; `. ProviderRequestOptions` gains `timeouts?: ProviderRequestTimeouts`; `+ ./provider-kit fetchWithStreamTimeouts`, `+ ./provider-kit FetchWithStreamTimeoutsOptions`; `./provider-kit SystemOneClientOptions` gains `timeouts?`. No removals.
    - **Budgets and generated files.** `scripts/budgets.json` kernel ceilings rebaselined with a reason: 1,293,418 packed, 4,188,314 unpacked, 42,437 source lines, 1,553 counted exports (+3: `fetchWithStreamTimeouts`, `FetchWithStreamTimeoutsOptions`, `ProviderRequestTimeouts`); `exportCounts["@arnilo/prism"]` 1,553. `host-builder-index.mjs`, `package-truth.mjs --emit-docs`, `host-builder-evals/run.mjs --register` re-run.
    - **Checks.** `bun run typecheck` green; `bunx biome lint` clean on the changed files; `docs.test.ts` 69 pass; `bun scripts/retired-names.mjs` 0 hits (no name retired); `@arnilo/prism-ai` 300 pass, `@arnilo/prism-agent` 66 pass, `@arnilo/prism-hosts` 923 pass, `@arnilo/prism-extensions` 1,080 pass. `bun test src/__tests__`: 4,892 pass / 14 fail on the full run; one was this task's (`passes abort signal to fetch`, fixed above). The rest pass alone or are Task 2's known wall-clock budgets: `packaging.test.ts` (5 s timeouts under load; 80 pass with `tool-argument-validation.test.ts` alone), `examples_demos_run_to_completion_and_emit_no_secret` (passes alone), `apps/prism-agent` `external.test.ts` (4 pass alone), remote conformance (passes in the hosts suite), and `hard_deny_decision_budget`, the field-policy microbenchmark, `validates a large argument object quickly`, and the two `@arnilo/prism-tools/browser` tests. `bun scripts/release.mjs gate` reports only the known `@arnilo/prism-ai` bump line from Task 2.
    - **Findings for later tasks.**
      - Task 4: an idle timeout fires after output began with `failureClass: "transient"`, so it is exactly the case Task 4 re-opens; `stalled_stream_fails_after_idle_timeout` already produces the "deltas then a transient error" event shape its tests need.
      - A provider's `fetch` no longer sees `request.signal` itself but a composed signal that follows it. A third-party test asserting signal identity will need the same change as `openai-compatible.test.ts`; the CHANGELOG entry says so.
  - Acceptance Criteria:
    - Functional:
      - `ProviderRequestOptions.timeouts: { connectMs?, idleMs? }`, defaults 60,000 and 300,000, each `null` to disable. `AgentConfig.providerOptions` and `RunOptions.providerOptions` set them.
      - No response headers within `connectMs`, or no bytes for `idleMs` while the body is read, aborts that request and yields a provider `error` event with `code: "ETIMEDOUT"`, `failureClass: "transient"`, and which timeout fired. SSE comments and `ping` frames count as bytes.
      - The helper is in `provider-kit` and every `fetch` Task 1(c) lists uses it, including the non-routed ones.
      - The run's own abort still wins and is reported as an abort, not a timeout.
      - *(Task 1 amendment)* The helper wraps the response body stream, not `readSseEvents`, so the Ollama native NDJSON reader (`native.ts:147`) gets the same idle timer. Catalog, quota, OAuth and spend-log fetches are not turn requests and are left alone (listed in the task note). SystemOne keeps its whole-call deadline and also gets the connect/idle timers on `postSystemOne`'s fetch.
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
      - `src/provider-kit/provider-request-policy.ts`: merge (the defaults live in the helper; see the task note)
      - `packages/providers/ollama-cloud/src/native.ts`: the one non-routed provider fetch from Task 1(c) (`openai-codex` is routed)
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

- [x] Task 4: A stream that drops after output began is retried
  - Notes (executed 2026-11-15)
    - **What changed.**
      - `src/models/retry.ts`: `retryLoop`'s attempt callback now gets a `RetryProbe` (`willRetry(info, final?)`, internal export). It asks the policy once per attempt, and the loop reuses that answer when the attempt throws, so a stateful custom policy is still consulted exactly once. `final` from `classify` still short-circuits. `RetryLoopOptions` is otherwise unchanged; the package-call caller (`loader.ts`) ignores the probe and still retries only before its first event.
      - `src/contracts-core/compaction.ts`: `RetryOptions.afterOutput?: boolean` (default `true`), documented as run turns only.
      - `src/agent-session/session/provider-round.ts` `generateWithRetry`: `final: failure?.observable` became `isFinal(info, observable) = observable && (afterOutput === false || !isTransientErrorInfo(info))`, so the retry decision stays in `retryLoop` and the policy. "Transient" here means `isTransientErrorInfo` (network codes, 408/425/429/5xx, `failureClass` `transient`/`rate_limited`), not just `failureClass: "transient"`. A custom `policy` cannot retry a non-transient failure after output. The strict usage refusal (`usage_missing`, observable, no class) stays final, as `usage-estimation-strict.test.ts` requires. `onRetry` no longer emits. It stores `{ delayMs, error }`, and the next attempt's own `turn.started` carries `attempt` (that attempt's number) and `retry`. The first attempt's `turn.started` is unchanged (no top-level `attempt`; `metadata.attempt: 1`). The plan's example `turn.started {turn: 3, attempt: 1}` is written as `metadata.attempt: 1` in `docs/events.md`.
      - `generateProviderTurn` takes a trailing `attemptContext: { retry?, willRetry? }` (internal function, not in the compat baseline). In the failure path, an attempt with no reported usage asks `willRetry` before recording usage: if the attempt will be retried, no estimate is projected (it is not in the limits, run usage, ledger or `turn.completed.usage`). Reported usage is recorded once. A final failure keeps its estimate. A throwing policy reads as "not retried" there, and the loop then calls it again and propagates the error as before.
      - Nothing else was needed for "nothing appended / no partial tool call": the content and calls of an attempt are local to `generateProviderTurn` and are returned only on success (Task 1(d)).
      - `src/testing/loop-conformance.ts`: `assertDroppedStreamRecovery(strategy)` (public on `./testing`): text, a complete `echo` call and a partial call, then `ECONNRESET`. It requires completion with the second attempt's text, two attempts, no tool execution and no `dropped-` text in the branch.
      - Hosts. **AG-UI** (`ag-ui-mapper.ts`): `turn.completed { error }` no longer calls `error()`. Before this task it emitted a terminal `RUN_ERROR` and set `terminal`, so even a *pre-output* retry ended the AG-UI stream and dropped the successful attempt. It now ends the open text and reasoning messages, and the retry's `turn.started` emits `prism.retry` `{ turn, attempt, delayMs, error: { message, code?, failureClass? }, discardMessageIds }` (behind `includeCustomEvents`, like every `prism.*` custom). A final failure still gets one `RUN_ERROR` from `run.failed`. **ACP** (`mapper.ts`): text and thought chunks between `turn.started` and `turn.completed` are held and flushed on a clean completion, and dropped (with `textDeltaSeen`/`thoughtDeltaSeen` reset) on `error`. Deltas outside an attempt pass through, so direct mapper callers keep streaming. **Channels** (`runtime-turn.ts` `createPreview`): the preview snapshots its text at `turn.started` and restores it on `turn.completed { error }`, so the next cumulative preview replaces the failed attempt's text. The stale doc comment ("resets on each new assistant message") was corrected. **remote/devtools**: forward events unchanged. The rule is in `docs/events.md` and the remote README; devtools has no delta consumer under `src` (only a test fixture). **evals**: no code change; `startedTurns === completedTurns` now holds on retried runs.
    - **Tests.** New `src/__tests__/mid-stream-retry.test.ts` (9): `transient_drop_after_output_is_retried` (full event trace, uncapped and `maxOutputTokens`-capped; the capped run shows no failed-attempt deltas), `idle_timeout_after_output_is_retried` (Task 3's idle timer on a routed Chat provider after one delta), `failed_attempt_appends_nothing`, `after_output_false_keeps_failure_final`, `permanent_failure_after_output_is_final` (400 `permanent`, 401 `auth`, `unknown`), `partial_tool_call_from_failed_attempt_is_not_dispatched` (a complete and a partial call, the tool never runs, no `tool.started`), `retry_emits_one_turn_started_per_attempt` (started = completed = 2), `failed_attempt_with_retry_projects_no_usage_estimate` (no estimate on the retried attempt, reported usage counted once at 7 + 10, the final failure keeps `estimated: true`), and `loop_conformance_dropped_stream`. Hosts: `ag_ui_mapper_discards_failed_attempt_text` (AG-UI schema-valid, no `RUN_ERROR`, two messages, `prism.retry` names the first; a final failure still gives one `RUN_ERROR`), `acp_discards_failed_attempt_text`, `channel_draft_resets_on_failed_attempt`. Updated in `agents.test.ts`: the pre-output retry test asserts `attempt === 2` and exactly two `turn.started` (was `attempt === 1`, the old marker); "does not retry after observable output" now sets `afterOutput: false`. `public-export-contract.test.ts` gains `assertDroppedStreamRecovery`.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`; this task only): `. RetryOptions` gains `afterOutput?: boolean`; `+ ./testing assertDroppedStreamRecovery`. Additive, no removals. The rest of the regenerated diff belongs to plan 226, plan 218.2 and Tasks 2–3, as recorded in Task 2.
    - **Budgets and generated files.** `scripts/budgets.json` kernel ceilings rebaselined with a reason: 1,296,492 packed, 4,197,883 unpacked, 42,530 source lines, 1,555 counted exports (+1 `assertDroppedStreamRecovery`, +1 internal type `RetryProbe`); `exportCounts["@arnilo/prism"]` 1,555. `host-builder-index.mjs`, `package-truth.mjs --emit-docs` and `host-builder-evals/run.mjs --register` re-run.
    - **Docs.** `docs/events.md` (table rows and a new "Failed attempts" section with the discard rule and sequence), `docs/models.md` ("Retry": `afterOutput` row, the after-output paragraph, cost and usage), `docs/loop.md` (what `turn()` hides from a loop, and the new conformance helper), READMEs of `ag-ui`, `acp`, `channels` and `remote`, `CHANGELOG.md` `## [Unreleased]`.
    - **Checks.** `bun run typecheck` green; `bunx biome lint` clean on the changed files; `bun scripts/retired-names.mjs` 0 hits in 2,059 files; `docs.test.ts` 68 pass / 1 fail under load (`examples_demos_run_to_completion_and_emit_no_secret`, a 60 s timeout while the suites ran beside it; passes alone, as recorded in Task 3); `@arnilo/prism-extensions`, `@arnilo/prism-ai`, `@arnilo/prism-agent`: no failures; `@arnilo/prism-hosts`: one failure, `prism_api … under 50 ms` (the Task 2 wall-clock budget, no retry code). `bun test src/__tests__`: 4,915 pass / 3 fail: `hard_deny_decision_budget` and the two `@arnilo/prism-tools/browser` tests that this directory pulls in, all known from Task 2 and none running retry code. `bun scripts/release.mjs gate` reports only the known `@arnilo/prism-ai` bump line.
    - **Findings.**
      - The retry notice now arrives when the next attempt starts, after the wait, not before it. A host that showed "retrying in N s" during a long `Retry-After` wait (up to `maxRetryAfterMs`, 60 s by default) learns of the retry only when the wait ends. It sees `turn.completed { error }` at once. Recorded in Further Actions.
      - `evals` `costComplete` stays `false` for a run with any retried attempt, because the failed attempt's `turn.completed` has no priced usage. Before this task it carried an estimate, which also made it `false`, so this is unchanged and correct: a failed attempt's billing is unknown.
      - Task 5 is unaffected.
  - Acceptance Criteria:
    - Functional:
      - With `retry.afterOutput` not `false`, a failure with `failureClass: "transient"` (including Task 3's timeouts) after the first event is retried under the same policy and attempt budget as a failure before output.
      - The failed attempt emits `turn.completed` with `error`; the next attempt emits `turn.started` with the same `turn`, `attempt + 1`, and `retry`. No `message.completed` is emitted for a failed attempt and nothing is appended to the branch.
      - `docs/events.md` states the rule a consumer follows: discard the deltas of a turn attempt that ends with `error`. Every first-party consumer Task 1(e) lists follows it in this task.
      - Usage the provider reported for the failed attempt is recorded once; an estimate is not projected for it.
      - A non-transient failure after output stays final, as today.
      - *(Task 1 amendments)* A retry emits **one** `turn.started` per attempt, carrying `attempt` and `retry`; `onRetry` stops emitting its own marker (today a retry emits two, and `evals` `startedTurns` over-counts). `agents.test.ts:1926` moves in the same task. The usage estimate is skipped for any attempt that fails transiently and will be retried (today every failed attempt projects an estimate through `recordTurnUsage`, `provider-round.ts:469`); a final failure keeps today's accounting. Hosts that cannot retract text buffer per attempt: ACP flushes each attempt's text/thought deltas on `turn.completed` without `error`; AG-UI ends the open message and emits a `prism.retry` custom event, and no longer reports a retried attempt's `error` as `RUN_ERROR`; channels reset the preview on `turn.completed{error}`. `remote` and `devtools` forward events and take the rule from `docs/events.md`. The `apps/prism-agent/src/adapters/stream-cli.ts` edit and the `reference_host_stream_cli_discards_failed_attempt` test are dropped (that adapter reads an external worker's frames; the reference host's `cli/run.ts` only prints events). Limit-capped runs already drop a failed attempt's buffered deltas (`activeLimitOutputBuffer`), so the tests cover capped and uncapped runs.
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
      - `src/models/retry.ts`: the `RetryProbe` passed to each attempt (the policy is asked once per attempt, early enough to skip the estimate)
      - `src/contracts-core/compaction.ts`: `RetryOptions.afterOutput`
      - `packages/hosts/{ag-ui,acp,channels}/src/…`: discard on a failed attempt (`mcp-server`, `headless`, `devtools`, `remote` and the reference host read results or forward events; the rule is documented, per Task 1(e))
      - `packages/hosts/evals/src/experiment.ts`: no change expected once a retry emits one `turn.started`; the test confirms
      - `src/testing/loop-conformance.ts`: a dropped-stream case (`assertDroppedStreamRecovery`, exported from `./testing`; baseline regenerated)
      - `docs/loop.md`: what `turn()` hides from a loop
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
    - `idle_timeout_after_output_is_retried`, `loop_conformance_dropped_stream`.
    - `retry_emits_one_turn_started_per_attempt` (replaces the double marker; evals `startedTurns` equals completed turns).
    - `failed_attempt_with_retry_projects_no_usage_estimate`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an event-sequence guarantee and an option
    - Docs pages to create/edit:
      - `docs/events.md`: the discard rule, with the sequence above
      - `docs/models.md`: `retry.afterOutput` and its cost
      - `packages/hosts/{ag-ui,acp,channels,remote}/README.md`: one line each
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 5: Reasoning that a route cannot verify is not replayed as text
  - Notes (executed 2026-11-15)
    - **What changed.** `src/provider-kit/codecs/anthropic-messages.ts` `toMessage`: the `else` branch that pushed a non-redacted thinking block as `{ type: "text", text }` is gone. A thinking block now reaches the wire only as `redacted_thinking` (redacted) or as `thinking` with its signature (`preserveThinking` on and `signature` set); anything else is omitted. The existing `content.length > 0 ? content : [{ type: "text", text: "" }]` fallback keeps an emptied assistant message valid. The codec reads `request.messages` and builds new objects, so stored history is untouched (the test asserts it).
    - **`text()` helper** (`anthropic-messages.ts:435`): its only caller is `systemCacheControlField(messages, (m) => text(m, preserveThinking))` (`:129`), which flattens **system** messages into the top-level `system` field. It never sees assistant history, so it is not a replay path. Left unchanged.
    - **Per-codec rule** (now a table in `docs/provider-kit.md`, "Thinking replay per codec"): Anthropic as above. Responses unchanged (own-provider encrypted payload only, per Task 1(f)). OpenAI Chat unchanged, by the Task 1 amendment: `reasoningReplay` decides, and the default `fold` still writes reasoning into `content` as text (the owner call stays in Further Actions). *(Superseded 2026-11-15 by the Further Action: the default is now `drop`.)* The same doc's `fold` bullet said `<thought>...</thought>`; the code (`openai-chat.ts:399-400`) pushes a plain text part, so the bullet was corrected.
    - **Body-size delta.** On the codec test fixture (system, user, assistant with a 70-char unsigned reasoning block plus "answer", user), measured with the old and new codec: 363 → 268 bytes (−95, the reasoning text plus a `{"type":"text","text":…}` wrapper). The saving is linear in replayed reasoning, for every turn of a cross-provider session.
    - **Tests** (`src/__tests__/anthropic-messages.test.ts`). `anthropic_unsigned_thinking_replays_as_text`, which asserted the old fallback, was replaced by `unsigned_thinking_is_omitted_on_anthropic_route` (also covers a signed block with `preserveThinking: false`, and that `request.messages` is unchanged), `signed_thinking_is_replayed_when_preserved` (signed kept, unsigned sibling dropped), `message_with_only_unsigned_thinking_stays_valid` (roles alternate, placeholder content), and `prefix_stability_holds_after_omission` (two consecutive requests pass `assertWireSegmentsStable(anthropicSegments(…))`, and the reasoning never appears in the body). No other test in the tree asserted the fallback (`commandcode`, `provider-conformance`, `openai-chat-codec`, `thinking`, `tool-name-replay`, `cache-helpers`, `provider-usage`, `prefix-stability-conformance`, `scripts/provider-tool-result-wire.test.mjs` all pass).
    - **Baseline.** No export or declaration changed; no regeneration. **Sweep.** No name retired; `bun scripts/retired-names.mjs` 0 hits in 2,059 files.
    - **Budgets.** `scripts/budgets.json` kernel `packedBytes`/`unpackedBytes` rebaselined with a reason: 1,297,205 / 4,200,038 (prior 1,296,492 / 4,197,883). The growth is the CHANGELOG entry and the provider-kit doc table that ship in the pack. Source lines and counted exports unchanged. `host-builder-index.mjs`, `package-truth.mjs --emit-docs` and `host-builder-evals/run.mjs --register` re-run with no diff.
    - **Finding (not fixed, in Further Actions).** "Signed" means `signature` is set, not that this route produced it. The OpenAI Chat codec stores a coalesced `reasoning_details` list as JSON in `ThinkingContent.signature` (`openai-chat.ts:555`). If a session moves from a Chat-wire reasoning provider to the Anthropic route with `preserveThinking` on, that block goes out as `thinking` with a foreign signature, which the vendor rejects. `ThinkingContent` has no provenance field (the Responses codec keeps provenance inside `data`), so the fix needs a contract decision.
  - Acceptance Criteria:
    - Functional:
      - On the Anthropic Messages route, a non-redacted thinking block is serialized as `thinking` only when `preserveThinking` is true and it carries a signature; otherwise it is omitted. It is never serialized as a `text` block.
      - An assistant message left with no content after the omission keeps the existing empty-text placeholder, so the request stays valid.
      - The other two codecs are changed only if Task 1(f) finds the same conversion; the task note records each codec's rule.
      - Stored history is unchanged; only the wire body differs.
      - *(Task 1 amendment)* `preserveThinking: false` also omits (today it falls into the same text fallback). Responses already drops foreign and payload-less reasoning and needs no change. OpenAI Chat's default `reasoningReplay: "fold"` is the same conversion by design and is **not** changed here; it goes to Further Actions as an owner call because it alters every Chat-wire provider's body. The `text()` helper (`anthropic-messages.ts:433`) is checked for any wire path at the start of the task.
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

Results (run 2026-11-15, after Task 5):
- `build:core`, `typecheck`, `retry-defaults` + `mid-stream-retry` (23 pass), `@arnilo/prism-ai` (300 pass), `@arnilo/prism-agent` (66 pass), `retired-names` (0 hits in 2,059 files): green.
- `docs.test.ts`: 68 pass / 1 fail (`examples_demos_run_to_completion_and_emit_no_secret`, 61 s). It passes alone, as recorded in Tasks 3–4.
- `bun scripts/release.mjs gate`: only the known `ranges: @arnilo/prism-ai … (bump required)` line (Compromises Made).
- `@arnilo/prism-hosts` alone: 923 pass / 3 fail (`abort_within_grace_json-rpc`, `abort_during_final_flush_still_runs_abort_ladder`, `remote_conformance_defaults_to_every_transport_under_ten_seconds`). All are timing budgets; the driver-process and remote files pass when run alone.
- `bun run test`: exit 1. Rerun alone, these pass: `tool-search` 1024-tool scoring, `scheduler-leases` `crash_after_claim_is_not_replayed`, driver-process `abort_within_grace_*`, remote conformance, `benchmark-multi-agent` scenario registry. Known wall-clock budgets from Task 2: `hard_deny_decision_budget`, `session_turn_overhead_within_frozen_ceilings`. **Not this plan:** the export-count gate (`@arnilo/prism-memory-system` 1,147 vs 1,124), the non-null budget for `packages/memory/system/src/session` (159 vs 114), and `markdown_store_write_amplification_within_budget` (memory-bench) all come from plan 218.2's uncommitted memory work. The same run found Task 4's AG-UI test over its non-null count (34 vs 32). That was fixed here by switching the test to optional chaining, so `packages/hosts/ag-ui/src` is back at 32.

## Compromises Made

- Task 2: SystemOne keeps its own retry loop (`postSystemOne`), with its pre-plan delays pinned, because `decide()` calls never pass through `retryLoop`. The cost is two retry layers on the `generate()` path (see Further Actions).
- Task 3: the stalled-stream conformance case runs only in `providerConformance`'s recorded mode and in `systemOneConformance`. In non-recorded mode the factory uses the test's own fetch, so the check cannot inject a stall. Every first-party provider has a recorded or SystemOne run.
- Task 4: the ACP mapper holds each attempt's text and thought chunks until the attempt completes, because ACP cannot retract a chunk. ACP clients get whole-attempt chunks instead of token streaming.
- Task 5: the Anthropic rule trusts the presence of `signature`, not its origin. A foreign signature (a Chat-wire `reasoning_details` list) is still replayed as `thinking` when `preserveThinking` is on.
- `bun scripts/release.mjs gate` reports `@arnilo/prism-ai` needs a version bump. This plan does no bump.

## Further Actions

- [x] Found in Task 1, for the owner (not in this plan's scope): the OpenAI Chat codec's default `reasoningReplay: "fold"` replays reasoning text as assistant text for every reasoning-capable Chat-wire provider (`openai-chat.ts:175,375,399`). Same defect class as Task 5's Anthropic fix; changing the default alters every Chat-wire body. Priority: medium.
  - Notes (executed 2026-11-15, on the owner's instruction):
    - **Change.** `reasoningReplay` now defaults to `"drop"` in `openAIChatBody` (`openai-chat.ts:175`) and in the `serializeOpenAIChatMessage` helper (both its legacy and options signatures, `:310,321`). `"fold"` is unchanged as an explicit opt-in; the JSDoc says so. No new option, no export change.
    - **Who changes.** Only Chat-wire routes that set no replay mode: the kernel's built-in `openai-compatible` provider (`src/models/builtin.ts`), `createOpenAICompatibleProvider` (which does not forward `reasoningReplay`), and custom `createRoutedProvider` routes. Every shipped provider package sets its own (`ollama-cloud` drop, `kilo`/`openrouter`/`commandcode` reasoning_details, `litellm`/`opencode-go`/`hyper`/Command Code `beam` reasoning_content), so their bodies are unchanged.
    - **Tests.** New `openai_chat_default_replay_drops_reasoning_text` (`src/__tests__/openai-chat-codec.test.ts`): with `preserveThinking` on and no mode, a text message, a tool-call message, and a thinking-only message carry no reasoning (`content` `"answer"`, `null`, `""`). `openai_chat_fold_mode_never_sends_reasoning_details` now passes `reasoningReplay: "fold"` explicitly. `openai-primitives` already sets each mode explicitly.
    - **Docs.** `docs/provider-kit.md` replay bullets (`drop` default, `fold` opt-in) and the paragraph under the "Thinking replay per codec" table. CHANGELOG `[Unreleased]` entry.
    - **Budgets.** `scripts/budgets.json` kernel `packedBytes`/`unpackedBytes` rebaselined with a reason: 1,297,551 / 4,201,285 (prior 1,297,205 / 4,200,038), CHANGELOG and docs text. Source lines and exports unchanged. `host-builder-index.mjs`, `package-truth.mjs --emit-docs`, `host-builder-evals/run.mjs --register` re-run.
    - **Checks.** `openai-chat-codec` + `openai-primitives` (32 pass); `docs.test.ts` + `packages/providers` (401 pass); `src/__tests__` + `packages/providers` combined run 4,917 pass / 3 unrelated fails (two browser-package tests that pass alone, and the field-policy microbenchmark timing). `bun scripts/release.mjs gate`: only the known `@arnilo/prism-ai` bump line. `bun run typecheck`: only `@arnilo/prism-memory-system` `session/__tests__/strategy.test.ts:303-304`, from plan 218.2's uncommitted memory work.
    - **Follow-up (same day, owner): `createOpenAICompatibleProvider` forwards `reasoningReplay`.** The factory had no way to pick a replay mode, so a generic endpoint that expects `reasoning_content` back (for example DeepSeek's thinking mode in a tool loop) could not opt in once the default became `drop`. Added an optional `reasoningReplay` on `OpenAICompatibleProviderOptions` (`src/provider-kit/openai-compatible.ts`) passed to the route's codec; unset keeps the codec default. A custom `serializeMessage` still wins. Test first: `openai_compatible_forwards_reasoning_replay` (`src/__tests__/openai-compatible.test.ts`) encodes a tool-loop turn with and without `"reasoning_content"`. Docs: one line under the `reasoningReplay` bullets in `docs/provider-kit.md`; CHANGELOG entry extended with an "Added" sentence.
      - Baseline diff (`bun scripts/release.mjs gate --update-baseline`): `./provider-kit OpenAICompatibleProviderOptions` gains `readonly reasoningReplay?: OpenAIChatCodecOptions["reasoningReplay"]`. No removals from this change. The same run also rewrote `scripts/compat-baseline/arnilo__prism-memory-system.txt` (`MemoryDurable`, `MemoryEventStatus` added; `MemoryObservation`, `MemorySessionConfig`, `ObservationalMemoryLedger`, `ResolvedMemorySystemConfig`, `WmRecordedData` changed), which belongs to plan 218.2's uncommitted memory work, not this change.
      - Budgets re-rebaselined in the same note: 1,298,069 packed / 4,202,777 unpacked / 42,533 source lines (+3 for the option). Generated files re-run (`host-builder-index.mjs`, `package-truth.mjs --emit-docs`, `host-builder-evals/run.mjs --register`).
      - Checks: `openai-compatible`, `openai-chat-codec`, `openai-primitives`, `provider-kit`, `public-export-contract`, `prefix-stability-conformance`, `docs.test.ts`, `packages/providers`, `packages/hosts/host-builder`: 580 pass / 1 fail (`examples_demos_run_to_completion_and_emit_no_secret`, 60 s timeout; passes alone in 41 s, as recorded in Tasks 3–5). `bun run typecheck` clean. `bun scripts/release.mjs gate`: only the known `@arnilo/prism-ai` bump line.
    - Backlog entry closed.
- Found in Task 2: a SystemOne decision model served through `generate()` (`ollama-cloud/provider.ts:75`) keeps `postSystemOne`'s own retry (2 retries) inside each turn attempt, and the turn now retries by default (4 attempts), so up to 12 requests on a dead endpoint. Fix: pass `maxRetries: 0` on the `generate()` path and let `retryLoop` own it, keeping the SystemOne loop for `decide()`. Priority: low.
- Found in Task 4: with one `turn.started` per attempt, the retry notice (`turn.started.retry`) arrives after the backoff wait, not before it. A host that wants to show "retrying in N s" during a long `Retry-After` wait (up to 60 s by default) has only the failed attempt's `turn.completed { error }` until then. Fix if hosts ask: an additive `turn.completed.retry: { delayMs }` when the loop has already decided to retry (the decision is known before that event since Task 4's probe). Priority: low.
- Found in Task 2: `scripts/release.mjs gate` reports `@arnilo/prism-ai` needs a version bump (its providers moved to `parseRetryAfterMs`); the release plan that ships 227 must bump it. Priority: high at release time.
- Found in Task 5: thinking signatures carry no provenance. `ThinkingContent.signature` holds an Anthropic signature on the Messages route and a JSON `reasoning_details` list on the Chat route (`openai-chat.ts:555`), so the Anthropic codec cannot tell its own signature from a foreign one. Fix: record the producing provider/route on the block (an additive `ThinkingContent` field, or provenance inside `data` as Responses does) and replay `thinking` only for this route's own signatures. Priority: medium (a cross-provider session with `preserveThinking` on gets a vendor 400).
