# Phase 19 Part D — event delivery: live streaming under caps, subscriber coalescing, and cheap byte accounting

## Objectives

- Keep streaming when a host sets a token or cost cap. Any finite `maxOutputTokens`, `maxTotalTokens`, or `maxCost` on the agent or the run sets `activeLimitOutputBuffer` (`src/agent-session/session/assemble.ts:722`), and every `message.delta` of a turn is then held until the turn ends (`src/agent-session/session/provider-round.ts:325-393`). Probe `p5-stream`: four deltas produced 150 ms apart all arrived at 755 ms.
- Stop a slow consumer from ending a run. A subscriber queue has no backpressure; at 1,024 queued events the default `close` policy throws (`src/agent-session/event-subscriber.ts`), and `session.stream()` then aborts the run (`src/agent-session/session.ts:713`).
- Stop serializing data only to count its bytes. Each provider attempt stringifies the whole request (`provider-round.ts:303`), each stream event is stringified again (`:351`), and the SSE reader re-encodes its whole buffer per chunk (`ensureBufferLimit`, `src/provider-kit/transport.ts:215`).

## Expected Outcome

- Deltas reach subscribers as they arrive, whatever limits are set. `limits.bufferOutput: true` restores the held-until-turn-end delivery for a host that needs it.
- A lagging subscriber's adjacent `message.delta` text and thinking deltas are merged in its queue, and only the newest `tool.progress` per call is kept. The default queue bound is 4,096. Overflow now needs that many events that cannot be merged, and it still fails the iterator loudly.
- A run streamed through `session.stream()` is aborted when the consumer stops, and is **not** aborted by an overflow: the iterator throws `SubscriberOverflowError` and the run continues to its result.
- Request and response byte limits are enforced from sizes the kernel already has (memoized per message; raw chunk lengths), with no extra `JSON.stringify` on the hot path.

This plan implements roadmap **Phase 19 Part D**. It changes kernel behavior on a public surface (event delivery timing, `SubscribeOptions`, a run limit field), so **Task 1 is the phase review**. It runs after plan 227. No version bump or publish.

Cost knobs: none added. `limits.bufferOutput` trades streaming for the guarantee that no output of a turn that breaches a cap is delivered; `docs/agent.md` states it.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Why output is buffered.** The plan and commit that introduced `activeLimitOutputBuffer`, what a breach looks like to a subscriber with and without the buffer, and which tests pin the buffered order.
      - (b) **Every consumer of `SubscriberOverflowError` and of the `overflow` option**, in `src/`, `packages/hosts/*`, `apps/prism-agent`, and examples; and both abort-on-close sites (`src/agent-session/session.ts:596`, `:713`).
      - (c) **Event volume.** Events per turn by type for one recorded coding turn (deltas, `tool.progress`), to size the default bound and confirm which types dominate.
      - (d) **Whether a merged delta is distinguishable.** Every consumer that counts deltas or relies on delta boundaries (`packages/hosts/ag-ui`, `acp`, `channels` drafts, `evals` timelines, `observability`).
      - (e) **Byte accounting.** What `maxRequestBytes` and `maxResponseBytes` protect (`src/run-limits.ts`, the per-frame comment in `charge`), every `jsonBytes` call, and the message-estimate memo that can be reused (`messageEstimateMemo`, `provider-round.ts`).
    - Performance: Records a baseline: time spent in `jsonBytes` and `byteLength` for a 200 KiB request streamed as 2,000 deltas, from `scripts/benchmark-session-turn.test.mjs` or a one-off measurement.
    - Code Quality: Findings are written against the task they change.
    - Security: Records whether the buffer is relied on as a disclosure control anywhere (a host that must not show output past a budget).
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 (events, subscribe), `docs/events.md`, `docs/agent.md`, `docs/performance.md`
      - `src/agent-session/event-subscriber.ts`, `provider-round.ts`, `src/provider-kit/transport.ts`
    - Options Considered:
      - Skip — rejected: (a) and (d) can change the defaults of Tasks 2 and 3.
    - Chosen Approach:
      - Inventory and one measurement, then confirm or re-cut.
    - API Notes and Examples:
      ```bash
      git log -S activeLimitOutputBuffer --oneline -- src
      graft grep "SubscriberOverflowError"
      ```
    - Files to Create/Edit:
      - `plans/228-…md`: the task note
    - References:
      - Evaluation probe `p5-stream`, finding K14
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Deltas are delivered live when a cap is set
  - Acceptance Criteria:
    - Functional:
      - `message.delta` events are emitted as the provider yields them, with any limits configured.
      - `RunLimits.bufferOutput` (boolean, default `false`, agent or run; `true` at either layer wins) restores delivery at turn end.
      - A cap breach is reported exactly as today: one `run.failed` with `limit` and `attribution`. With live delivery, the breaching turn's deltas have already been delivered; `docs/events.md` says so.
      - `turn.completed` still follows the turn's last delta.
    - Performance: No added work per delta; the buffered path allocates only when `bufferOutput` is `true`.
    - Code Quality: `activeLimitOutputBuffer` is derived from the one field, not from which limits are finite.
    - Security: A host that used the buffer as a disclosure control sets `bufferOutput: true`; the changelog names this under Changed, and Task 1(e)'s Security finding decides whether a migration note is needed.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session/assemble.ts:715-725`, `provider-round.ts:320-395`, `persist.ts:265`
      - `src/contracts-core/run-limits.ts`, `docs/agent.md` (limits)
    - Options Considered:
      - Stop the stream mid-turn on an estimated breach — rejected: an estimate would fail runs that are within budget.
      - Keep buffering for `maxCost` only — rejected: the cost is known only at turn end either way.
    - Chosen Approach:
      - Live by default, explicit opt-in to buffer.
    - API Notes and Examples:
      ```ts
      createAgent({ model, limits: { maxOutputTokens: 100_000 } });                       // streams
      createAgent({ model, limits: { maxOutputTokens: 100_000, bufferOutput: true } });   // 0.14.0 delivery
      ```
    - Files to Create/Edit:
      - `src/contracts-core/run-limits.ts`, `src/run-limits.ts`: the field and its resolution
      - `src/agent-session/session/assemble.ts`: derive the flag
      - `src/__tests__/run-limits.test.ts` and a new streaming case beside the provider-round tests
      - `scripts/compat-baseline/*.txt`: regenerated (`bun scripts/release.mjs gate --update-baseline`), additive diff in the task note
    - References:
      - Probe `p5-stream`
  - Test Cases to Write:
    - `deltas_arrive_live_with_token_caps`: the probe; arrival times track production times.
    - `buffer_output_true_holds_deltas_until_turn_end`.
    - `cap_breach_reports_once_under_live_delivery`.
    - `buffer_output_narrows_true_wins_across_layers`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — delivery timing and a limit field
    - Docs pages to create/edit:
      - `docs/agent.md`: `limits.bufferOutput`
      - `docs/events.md`: delivery under caps
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: A lagging subscriber is coalesced, and overflow no longer aborts the run
  - Acceptance Criteria:
    - Functional:
      - `SubscribeOptions.overflow` gains `"coalesce"`, the new default. While a subscriber is not awaiting, a pushed `message.delta` whose content is text (or non-redacted thinking) is merged into the queue's last event when that is a delta of the same kind, run, and origin; a pushed `tool.progress` replaces a queued one for the same `toolCallId`. Nothing else is merged, and order across event types is preserved.
      - `maxQueuedEvents` defaults to 4,096 (hard cap unchanged or raised per Task 1(c)). When the bound is reached by events that cannot be merged, the iterator rejects with `SubscriberOverflowError`, as `close` does today.
      - `"close"`, `"drop_oldest"` and `"drop_newest"` keep their meaning.
      - `session.stream()` and `session.resume()` abort the run when the consumer returns or throws, and do not abort it when the subscriber overflowed. In that case the generator throws the overflow error and the run settles on its own; `RunResult` is still available through `session.run`-style awaiting documented in `docs/agent.md` (the note says how a host gets the result after an overflow: `session.messages()` and the ledger).
      - The first-party consumers Task 1(d) lists behave the same with merged deltas, or are fixed in this task.
    - Performance: Queue operations are O(1); the queue no longer uses `Array.prototype.shift` on a large array (a ring or head index). A consumer that sleeps 50 ms per event through a 5,000-delta turn does not overflow.
    - Code Quality: Merging is a pure function of two events, unit-tested on its own.
    - Security: Merging happens after redaction (subscribers receive redacted events), so no secret can be reassembled across a redaction boundary; a test pins a secret split across two deltas.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/event-subscriber.ts` (whole file), `src/agent-session/session.ts:560-600`, `:689-720`
      - `src/contracts-core/agent.ts:318-329` (`SubscribeOptions`)
      - `src/redaction.ts` (`redactAgentEvent`) for the split-secret case
    - Options Considered:
      - Make `emit` await the consumer — rejected: every emit site is synchronous, and one slow subscriber would pace the run and every other subscriber.
      - Only raise the bound — rejected: a slower consumer still overflows.
    - Chosen Approach:
      - Merge what can be merged, bound the rest, and separate "consumer stopped" from "consumer overflowed".
    - API Notes and Examples:
      ```ts
      for await (const event of session.stream(input, { overflow: "coalesce", maxQueuedEvents: 4096 })) render(event);
      ```
    - Files to Create/Edit:
      - `src/agent-session/event-subscriber.ts`: the policy, the queue
      - `src/agent-session/session.ts`: the two `finally` blocks
      - `src/contracts-core/agent.ts`: the policy union and default
      - `packages/hosts/*/src/…`: fixes from Task 1(d), if any
      - `src/__tests__/event-subscriber.test.ts` (new or extended)
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding "a slow stream consumer aborts the run"
  - Test Cases to Write:
    - `lagging_subscriber_merges_adjacent_text_deltas`: final text equals the unmerged text.
    - `tool_progress_keeps_latest_per_call`.
    - `non_mergeable_events_keep_order_and_count`.
    - `overflow_still_rejects_the_iterator`.
    - `overflow_does_not_abort_the_run`: the run completes and its messages are in the store.
    - `consumer_break_still_aborts_the_run`.
    - `split_secret_is_not_reassembled_by_merging`.
    - `slow_consumer_5000_deltas_does_not_overflow`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a default policy and stream abort semantics
    - Docs pages to create/edit:
      - `docs/events.md`: "Subscribers and backpressure"
      - `docs/agent.md`: `SubscribeOptions`, and what happens to a run after an overflow
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Byte limits are enforced without re-serializing
  - Acceptance Criteria:
    - Functional:
      - `maxRequestBytes` is charged from a per-message byte size memoized by message object (the same pattern as the token-estimate memo), plus the tools and options sizes computed once per assembly. The charged value is within 2% of `jsonBytes(request)` and never lower than the true serialized size by more than that margin; the limit's meaning (a per-frame safety cap) is unchanged.
      - `maxResponseBytes` is charged from content lengths of the event (text length, argument text length, a fixed overhead per event), not from `JSON.stringify`.
      - The SSE reader tracks its buffered byte count from chunk `byteLength`s and consumed block sizes; it never re-encodes the buffer.
      - Limits still trip on an oversized request, an oversized frame, and an oversized SSE buffer, with the same error codes.
    - Performance: On Task 1's baseline workload, time in byte accounting drops by at least 80%; the numbers go in the task note and `docs/performance.md`.
    - Code Quality: One sizing helper per direction; no duplicated estimate logic between tokens and bytes.
    - Security: The caps remain process-safety limits: a test proves a 65 MiB frame still fails closed.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session/provider-round.ts:160-185` (the memo), `:303`, `:351`
      - `src/provider-kit/transport.ts:154`, `:204-260`
      - `src/run-limits.ts` (`HARD_RUN_LIMITS`, `charge`)
      - `docs/performance.md`
    - Options Considered:
      - Count bytes in the codec, where the body is already serialized — rejected: the kernel does not see a provider's body, and non-routed providers would not report it.
      - Drop the request-byte charge — rejected: it is the guard against a runaway assembly.
    - Chosen Approach:
      - Memoized sizes on the kernel side, raw chunk lengths in the transport.
    - API Notes and Examples:
      ```ts
      // internal
      const bytes = requestBytes(request);        // memoized per message
      limits.charge("maxRequestBytes", bytes);
      ```
    - Files to Create/Edit:
      - `src/agent-session/helpers.ts` (where `jsonBytes` lives) and `provider-round.ts`
      - `src/provider-kit/transport.ts`: incremental buffer accounting
      - `scripts/benchmark-session-turn.test.mjs`: a budget for byte accounting
      - `src/__tests__/run-limits.test.ts`, `src/__tests__/` transport tests
    - References:
      - Evaluation finding K14
  - Test Cases to Write:
    - `request_bytes_within_two_percent_of_serialized_size`: across fixtures with unicode, images, and tool schemas.
    - `oversized_request_still_fails_closed`.
    - `oversized_frame_still_fails_closed`.
    - `sse_buffer_limit_holds_without_reencoding`: multi-byte characters split across chunks.
    - `benchmark_byte_accounting_budget`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — same limits, same codes
    - Docs pages to create/edit:
      - `docs/performance.md`: the measured cost before and after
      - `CHANGELOG.md`: `## [Unreleased]`, Performance
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/run-limits.test.ts src/__tests__/event-subscriber.test.ts`
- `bun test --timeout=0 scripts/benchmark-session-turn.test.mjs`
- `bun run --filter @arnilo/prism-hosts test`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
