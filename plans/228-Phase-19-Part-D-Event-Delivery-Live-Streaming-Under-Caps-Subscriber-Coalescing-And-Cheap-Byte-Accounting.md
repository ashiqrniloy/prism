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

- [x] Task 1: Phase review (read-only)
  - Notes (executed 2026-11-15): read-only. The only file changed is this plan. Throwaway scripts (scratchpad, not committed) made one live recording per model and one microbenchmark, on Bun 1.4.4. Line numbers have drifted since the plan was written. Current spans: the buffer flag is set at `assemble.ts:737-740` (plan `:722`); the buffered delivery is `provider-round.ts:370-375,424-436,447` (plan `:325-393`); the request charge is `:348` (plan `:303`); the event charge is `:405` (plan `:351`); `ensureBufferLimit` is `transport.ts:441-445` (plan `:215`); the abort-on-close blocks are `session.ts:618-624` (`resume`) and `:738-744` (`stream`) (plan `:596`, `:713`).
    - **(a) Why output is buffered.**
      - *Origin.* Commit `6048e82d` (2026-07-19, "Phase 0.0.7 completed") added it, under plan `069-release-0-0-7-secure-run-lifecycle.md`. That plan's run-limits task says to "charge reported usage/cost before output exposure or another turn" (its line 234). Its limits table says to charge final usage "before content exposure or next work" (line 117). In 0.0.7, `bufferOutput` was `activeGuardrails.output.length || activeLimitOutputBuffer`, so guardrail output checks shared the buffer. Kernel guardrails have since gone. Today the limit flag is the only input (`provider-round.ts:371`).
      - *Buffered (today).* `emitOutput` pushes into `bufferedOutput` (`:372-375`). The buffer is flushed only after `recordTurnUsage()` passes (`:447`). A breach throws from `RunLimitTracker.exceed` (`run-limits.ts:313`) inside `recordTurnUsage`. The catch then emits `turn.completed{error, stopReason:"abort"}` and drops the buffer. The run then emits one `run.failed{limit, attribution}`. **A subscriber sees `turn.started` → `turn.completed{error}` → `run.failed` and no deltas from the breaching turn.**
      - *Live (Task 2).* The sequence becomes `turn.started` → deltas → `turn.completed{error}` → `run.failed`. That is the same shape as a failed attempt after output (plan 227 Task 4). The first-party hosts already discard such deltas: AG-UI through its `discarded` set (`ag-ui-mapper.ts:451-452,363`), and channels by resetting `text = attemptStart` on `turn.completed{error}` (`runtime-turn.ts:410-412`). Nothing is appended to the session, because the assistant message is appended only after `generateProviderTurn` returns.
      - *Tests that pin buffered delivery.* `run-limits.test.ts:207` ("emits one terminal breach and withholds configured-token-budget output") asserts no `message.delta` under `maxOutputTokens: 1`. `:235` ("does not buffer … when token caps are disabled (null)") pins the inverse. No test pins arrival *timing*. Task 2 must change `:207` to set `bufferOutput: true`, and add the live counterpart.
    - **(b) Consumers of `SubscriberOverflowError` / `overflow` / `maxQueuedEvents`.**
      - *Kernel.* `EventSubscriber` (`event-subscriber.ts:26-96`) uses `queue.shift()` at `:53` and `:78`, and `waiters.shift()` at `:67`. It has **no hard cap**: any finite value ≥1 is accepted, and a non-finite value falls back to 1024 (`:41-42`).
      - *Where `EventSubscriber` is used.* There are three sites: `session.subscribe()`, `session.stream()`/`resume()` through `createSubscriber` (`session.ts:599,717`), and **`agent.subscribe()`** (`create-agent.ts:90-96`). The plan does not list the agent-level site, but it receives the same redacted events (`session.ts:909-917`), so Task 3's policy reaches it too.
      - *Abort-on-close.* Both `finally` blocks call `this.abort(...)` whenever the run has not settled (`session.ts:620-623`, `:740-743`). An overflow currently gets there because `push` closes the subscriber (`event-subscriber.ts:88`). The consumer's `for await` then rejects, and the `finally` aborts the run.
      - *Explicit `"close"` callers.* `packages/hosts/ag-ui/src/handler.ts:262-263` streams with `overflow: "close"` and `maxQueuedEvents` at **128 by default** (`limits.ts:24`; hard cap 4096 at `:25`). So **a slow AG-UI SSE client aborts the run after 128 queued events**, and Task 3's new default would not reach it. Tests that pass `"close"`: `agent-run-state.test.ts:59,120`, `agent-surface.test.ts:391`.
      - *Tests that rely on the default being `close`.* `agents.test.ts:91` (`maxQueuedEvents: 2`, expects `SubscriberOverflowError`) and `session-subscriber-ownership.test.ts:105` (`maxQueuedEvents: 1`). Both use mergeable events or a default policy. Task 3 must pin `overflow: "close"` in both, or feed them events that cannot be merged.
      - *`drop_oldest` callers.* `remote/src/serve.ts:243` (subscribe), `benchmark-scenarios/multi-agent-runtime.mjs:161`, `leak-sessions.test.ts:27,36`, `agents.test.ts:107`, `session-subscriber-ownership.test.ts:120`.
      - *Remote host.* `remote/serve.ts:366,485` streams with `maxQueuedEvents: 1000` (`REMOTE_LIMITS`, `remote/limits.ts:10`) and the default policy. Server-side, it gets `coalesce` from Task 3. The client side uses its own `createChannel` (`remote/channel.ts:3-40`; `connect.ts:196`, `session-proxy.ts:186`), with the policy union `close|drop_oldest|drop_newest` and a default of `"close"`. **This is a separate queue that would not coalesce.** It is out of this plan's file list; see the amendment.
      - *Workflows.* `createEventMultiplexer` (`workflows/event-multiplexer.ts:1,46`) has its own `EventOverflowPolicy` and its own queue, and is unaffected. It forwards `subscribeOptions` to the kernel (`WorkflowEventMergeOptions`).
      - *`apps/prism-agent`.* No hits.
      - *Examples.* `examples/workflow-event-sink.ts:62` (`maxQueuedEvents: 256`, default policy).
      - *Docs stating the old default.* `docs/performance.md:444-497` (`1024`, `"close"`), `docs/events.md:134-135`, `packages/hosts/devtools/README.md:85` (default 1024).
    - **(c) Event volume.** No Prism event recording existed: `prism_agent_events` in `~/.prism/sessions/sessions.db` is empty, and its entries are test fixtures. So one live coding run per model was recorded on OpenCode Go (owner choice). Each run read two files, edited one, wrote a JSDoc and explained the changes, with `read`/`write`/`edit` only:

      | model | wall | events | `message.delta` (text / thinking / tool_call_delta / tool_call) | `tool.progress` | other | delta text p50 / p90 / max chars |
      | --- | --- | --- | --- | --- | --- | --- |
      | `deepseek-v4.1-flash` | 18.3 s | 126 | 103 (59 / 16 / 24 / 4) | 0 | 4 turns × (started, completed, message.completed, tool.started, tool.completed) + run.started/completed | 13 / 23 / 35 |
      | `mimo-v2.6-flash` | 26.0 s | 117 | 94 (54 / 4 / 32 / 4) | 0 | same | 14 / 31 / 114 |

      - **Deltas are 80–82% of all events.** There were about 15–20 per tool turn and about 50 in the final prose turn. **`tool.progress` is 0.** No first-party tool calls `context.progress`: the only emitters are `tools.ts:413-424` (a tool's own `progress` callback) and `run-controller.ts:539` (external-driver activity).
      - **Bound sizing.** A whole four-turn coding run is ~120 events, so 4,096 is ~30× a run. Overflow needs ~4,000 unmerged events (sustained long output into a stalled consumer), and coalescing collapses that to one event per text/thinking run. The kernel keeps **no hard cap** (as today). AG-UI's hard cap is already 4096, equal to the new default.
      - `tool_call_delta` is 26–34% of deltas. Task 3 does not merge it, as the plan says, and at this volume it does not need to.
    - **(d) Whether a merged delta is distinguishable.** No first-party consumer counts deltas or relies on their boundaries for meaning. **But two consumers truncate each delta.**
      - `ag-ui` (`ag-ui-mapper.ts:63-66,369-386`): each text delta becomes one `TEXT_MESSAGE_CONTENT` via `text()`, which **truncates to `min(maxTextBytes, maxEventBytes-512)`**, i.e. ~63.5 KiB by default (`limits.ts:4,6`). Thinking goes through `reasoning()`, capped at `maxReasoningBytes`. Merging lowers the count against `maxStreamEvents` (10,000, `limits.ts:20`), which helps. **A merged delta over ~63 KiB would lose text.**
      - `acp` (`acp/src/mapper.ts:17-20,277-287`): one `agent_message_chunk`/`agent_thought_chunk` per delta. `text()` **truncates to `min(maxTextBytes, maxEventBytes)`**, 64 KiB by default (`acp/limits.ts:6`). **Same risk.**
      - `channels` (`runtime-turn.ts:394-426`): accumulates `text += delta` and re-renders the preview. Boundary-agnostic, so it behaves the same.
      - `observability`: `index.ts:132` deliberately does not map `message.delta`; `timeline.ts:625-627` ignores deltas and `tool.progress`. Unaffected.
      - `evals`: no delta or progress handling under `packages/hosts/evals/src` (it counts `turn.*`, per plan 227). Unaffected.
      - `ag-ui` projector `createActivityFromToolProgressProjection` (`projectors.ts:129-160`) diffs against the last progress per call. Keeping only the newest progress yields a correct snapshot/delta. Unaffected.
      - `devtools`, `remote`: passthrough.
      - `memory-system` (`ltm/index.ts:565`, `ltm/provider.ts:38`) observes `message.delta` through **hooks**, not subscribers. Merging does not affect it. Under Task 2's live delivery it also observes a breaching turn's deltas, which matches an uncapped failed attempt today.
      - Examples (`session.ts:27`, `openai-compatible.ts:57`, `custom-tools-skills-context.ts:83`) concatenate text. `external-agent.ts:490-491` and `build-workflow.ts:281` test only that a delta exists. Unaffected.
    - **(e) Byte accounting.**
      - *What the caps protect.* `maxRequestBytes`/`maxResponseBytes` are **per-frame** process-safety caps: the default is 8 MiB and the hard cap 64 MiB (`run-limits.ts:19-20,49-50`). `null` is rejected (`:163-166`), and the charge is compared to `delta`, not to the cumulative total (`:272-274`, "so one giant provider frame cannot OOM the host").
      - *`jsonBytes` calls.* `jsonBytes` (`helpers.ts:147-154`) has exactly two calls: `provider-round.ts:348` (the whole `ProviderRequest`, once per attempt) and `:405` (every provider event). **It is also the run's JSON-serializability guard**: it throws `TypeError("Provider request or event must be JSON-serializable for run limits")` (`:152`). No test pins that message.
      - *Reusable memo.* `messageEstimateMemo` (`provider-round.ts:211-231`) is a `Map<family, WeakMap<Message, number>>` of per-message token shares. A byte memo needs no family key, so it is one `WeakMap<Message, number>`.
      - *SSE reader.* `byteLength` (`transport.ts:380-382`) **allocates a `TextEncoder` and encodes the whole string on every call**. `ensureBufferLimit` (`:441-445`) runs it over the whole buffer after every chunk, and `yieldCompleteEvents` (`:447-461`) re-runs `buffer.match(/\r?\n\r?\n/)` from offset 0 on every chunk. **Both are quadratic in a frame that spans many chunks.**
      - *Tests that pin exact byte values.* `run-limits.test.ts:167-188` asserts `observed === Buffer.byteLength(JSON.stringify(event))` for a `😀` delta, and Task 4 must relax it to the sizer's value. Also `run-limits.test.ts:190-203` (per-frame) and `provider-transport.test.ts:130` (`sse_buffer_overflow`).
      - *Known cost.* `scripts/budgets.json:384` and `docs/performance.md:821` already record that **82% of per-run time in the 1,000-run session-turn-overhead variant is `jsonBytes` serializing the request**, and that it drives `growthRatio`.
    - **Performance baseline** (scratchpad `bench-bytes.ts` and `bench-sse-big.ts`; Bun 1.4.4; mean of 30–50 reps after warm-up):

      | workload | cost today |
      | --- | --- |
      | `jsonBytes(request)`, 219.5 KiB request (80 unicode messages + 20 tool schemas), once per attempt | 0.51 ms |
      | `jsonBytes(event)` × 2,000 text deltas | 0.40 ms |
      | `readSseEvents`, 2,000 one-frame chunks (116 KiB) | 6.7 ms total, of which `byteLength` buffer + block ≈ 0.63 ms |
      | **one 240 KB frame in 235 × 1 KiB chunks** | **19.9 ms** |
      | **one 240 KB frame in 938 × 256 B chunks** | **72.8 ms** (≈ 51 ms re-encoding + 10 ms delimiter re-scan) |
      | one 500 KB frame in 489 × 1 KiB chunks | 77.2 ms |

      - On the plan's workload, byte accounting costs ~1.5 ms per turn, about 0.9 ms kernel-side and 0.6 ms transport-side.
      - The real costs are (1) the request stringify, which grows with context every turn (≈ 2.3 ms/MiB, so ~19 ms per attempt at the 8 MiB cap) and dominates long sessions per `budgets.json:384`, and (2) the quadratic SSE reader on large frames (tool arguments, base64 images).
      - Task 4's "≥ 80% drop" is measured on all three: the 2,000-delta turn, the 240 KB/256 B frame, and the session-turn-overhead `growthRatio`.
    - **Security.**
      - **No host relies on the buffer as a disclosure control.** Nothing in `packages/`, `apps/prism-agent` or `docs/*.md` documents or assumes that output past a budget is withheld. The only statement is plan 069's design intent, and `docs/` never stated it. Kernel guardrails, its other user, are gone.
      - Task 2 therefore needs a `CHANGELOG.md` *Changed* entry naming `bufferOutput: true`, plus the `docs/events.md` sentence. No migration-guide section is needed.
      - Subscribers receive events already redacted: `dispatchEvent` (`session.ts:914-917`) and `observeOnly` (`:908-911`, for agent subscribers) both call `redactAgentEvent` before `push`. Merging two already-redacted texts cannot produce anything the consumer would not get by concatenating them itself, so the split-secret test pins that redaction is not *weakened* by merging.
    - **Amendments to Tasks 2–4** (applied below):
      - **Task 2:** use the current line spans; rewrite `run-limits.test.ts:207` to set `bufferOutput: true`; document the live breach shape as deltas → `turn.completed{error}` → `run.failed`, with the discard rule from plan 227; the changelog entry is enough, with no migration note.
      - **Task 3:**
        - Merge with the same rule as `pushCoalescedContent` (`provider-round.ts:43-58`), extracted into one pure helper that both use. Thinking merges only when neither side is `redacted`, the signature is carried over, and neither side has a `data` payload.
        - **Cap a merged delta at 16 KiB of text** so the AG-UI and ACP per-delta truncation can never cut a merged delta.
        - Switch the AG-UI handler to `overflow: "coalesce"` and raise its `DEFAULT_MAX_QUEUED_EVENTS` from 128 to 4096 (the hard cap).
        - Cover `agent.subscribe()`.
        - Pin `"close"` in `agents.test.ts:91` and `session-subscriber-ownership.test.ts:105`.
        - Update `docs/performance.md:444-497` and the devtools README.
        - The kernel keeps no hard cap.
        - The remote client channel is left as a Further Action.
      - **Task 4:**
        - The message sizer still stringifies each *new* message once (memoized), and tools/options once per assembly, so the serializability guard survives.
        - Relax `run-limits.test.ts:167-188` to the sizer's value.
        - The SSE fix must also scan only the new text for the frame delimiter, not just stop re-encoding.
        - Hoist one `TextEncoder`.
        - Add the large-frame case and `growthRatio` to the benchmark.
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

- [x] Task 2: Deltas are delivered live when a cap is set
  - Notes (executed 2026-11-15):
    - **What changed.**
      - `RunLimits.bufferOutput?: boolean` and `ResolvedRunLimits.bufferOutput: boolean` (`src/contracts-core/run-limits.ts`). `bufferOutput` is excluded from `RunLimitName`, so it is not a counter axis.
      - `resolveRunLimits` (`src/run-limits.ts`) resolves it as `base?.bufferOutput === true || override?.bufferOutput === true`. `validateLimits` rejects a non-boolean value with `TypeError("bufferOutput must be a boolean")`.
      - `executeRun` (`assemble.ts:737-738`) now sets `session.activeLimitOutputBuffer = resolvedLimits.bufferOutput`. The finite-cap derivation (`hasFiniteTokenCap` over `maxOutputTokens`/`maxTotalTokens`/`maxCost`) is gone.
      - `generateProviderTurn` (`provider-round.ts:370-375,447`) allocates `bufferedOutput` only when buffering, and the live path is a plain `session.emit`.
    - **Tests.**
      - `src/__tests__/run-limits.test.ts`:
        - The old `:207` case is renamed `buffer_output_true_holds_deltas_until_turn_end: emits one terminal breach and withholds the breaching turn's output`, and now sets `bufferOutput: true`.
        - The defaults fence gains `bufferOutput: false`.
        - A new `describe("live delivery under caps (plan 228 Task 2)")` holds `deltas_arrive_live_with_token_caps` (four deltas 60 ms apart spread ≥120 ms under `maxOutputTokens` + `maxTotalTokens`; `turn.completed` follows the last delta), `buffer_output_true_holds_deltas_until_turn_end` (all four land within 30 ms, immediately before `turn.completed`), `cap_breach_reports_once_under_live_delivery` (delta < `turn.completed{error}` < one `run.failed{limit, attribution}`; no assistant message stored) and `buffer_output_narrows_true_wins_across_layers`.
      - **Extra file, not in the plan's list:** `src/__tests__/mid-stream-retry.test.ts` (`transient_drop_after_output_is_retried`) pinned "limit-capped runs buffer and drop" a failed attempt's deltas. Its capped case now sets `bufferOutput: true`.
    - **Findings.**
      - The live-timing test uses token caps only. `maxCost` against the mock model, which has no price, fails the run closed, which is unrelated to delivery.
      - Nothing found invalidates Tasks 3–4.
    - **Docs.**
      - `docs/events.md`: the capped-run sentence under "Failed attempts" is removed, and a new "Delivery under caps" section gives the breach shape, the discard rule and `bufferOutput`.
      - `docs/agent.md`: a `limits.bufferOutput` paragraph after the limits-narrowing paragraph.
      - `CHANGELOG.md`: an `[Unreleased]` Changed/Added entry.
    - **Budgets.** In `scripts/budgets.json`, kernel `packedBytes`/`unpackedBytes`/`sourceLines` are rebaselined to 1299240 / 4205926 / 42545 (+1171 / +3149 / +12), with a reason comment.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`; additive, no removals).
      - Attributed to this task, in `scripts/compat-baseline/arnilo__prism.txt`:
        - `RunLimits` gains `readonly bufferOutput?: boolean`.
        - `ResolvedRunLimits` gains `readonly bufferOutput: boolean`.
        - `RunLimitName`'s `Exclude` gains `"bufferOutput"`.
        - `AgentConfig`/`RunOptions` lines change through their `RunLimits` reference.
        - `packages/hosts/host-builder/data/api.json` is regenerated.
      - The same regeneration also absorbed earlier unbaselined additive changes:
        - plan 226: `AgentConfig.tools.validation`/`concurrency`, `DispatchToolCallOptions.validation`, and `"maxToolTimeMs"` in `RunLimitName`
        - plan 227: `DefaultRetryPolicyOptions.maxRetryAfterMs`, `ProviderRequestOptions.timeouts`, `ProviderRequestTimeouts`
        - plan 218.2: memory-system `MemoryDurable`, `MemoryEventStatus`, the `MemoryObservation` signals, `stm.autoChunkBytes`, `wm.protectRequestPasses`, and the `wmPasses`/`recordedAtWmPass`/`protectionLapsed` ledger fields
    - **Checks.**
      - Pass:
        - `bun run typecheck`
        - `run-limits.test.ts`: 25 pass
        - `mid-stream-retry`, `docs.test.ts`, `public-export-contract.test.ts`: 143 pass together with `run-limits.test.ts`
        - `bun run --filter @arnilo/prism-agent test`: 66 pass
      - `bun scripts/release.mjs gate`: the only failure is the preexisting `@arnilo/prism-ai … bump required`. This plan does no version bump.
      - `bun test src` (6,926 tests; it also picks up package tests by path): 5 failures, all accounted for:
        - `mid-stream-retry`: fixed above.
        - The two browser-package tests: pass when run alone.
        - `hard_deny_decision_budget` (coding-tools matcher timing, 129 ms vs 50 ms): load, unrelated.
        - `remote_conformance_*` (10 s timing budget): load.
      - `@arnilo/prism-hosts`: 925 pass and 1–2 `remote_conformance_*` timing failures under load. Run alone, `remote` conformance passed 6/6 on 3 of 4 runs. The machine's load average was 26–32. `remote` sets no caps.
  - Acceptance Criteria:
    - Functional:
      - `message.delta` events are emitted as the provider yields them, with any limits configured.
      - `RunLimits.bufferOutput` (boolean, default `false`, agent or run; `true` at either layer wins) restores delivery at turn end.
      - A cap breach is reported exactly as today: one `run.failed` with `limit` and `attribution`. With live delivery, the breaching turn's deltas have already been delivered, followed by `turn.completed{error}` and `run.failed`. This is the failed-attempt shape from plan 227, and the same discard rule applies. `docs/events.md` says so. (Task 1(a).)
      - `turn.completed` still follows the turn's last delta.
    - Performance: No added work per delta; the buffered path allocates only when `bufferOutput` is `true`.
    - Code Quality: `activeLimitOutputBuffer` is derived from the one field, not from which limits are finite.
    - Security: A host that used the buffer as a disclosure control sets `bufferOutput: true`. The changelog names this under Changed. Task 1 found no host that relies on the buffer, so no migration note is needed.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session/assemble.ts:737-740`, `provider-round.ts:370-375,424-436,447`, `persist.ts:266`
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
      - `src/__tests__/run-limits.test.ts`: `:207` ("withholds configured-token-budget output") now sets `bufferOutput: true`; new `live delivery under caps` describe with the four cases below
      - `src/__tests__/mid-stream-retry.test.ts`: the capped case of `transient_drop_after_output_is_retried` sets `bufferOutput: true` (found during execution)
      - `scripts/budgets.json`: kernel size ceilings rebaselined
      - `scripts/compat-baseline/*.txt`, `packages/hosts/host-builder/data/api.json`: regenerated (`bun scripts/release.mjs gate --update-baseline`), additive diff in the task note
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

- [x] Task 3: A lagging subscriber is coalesced, and overflow no longer aborts the run
  - Notes (executed 2026-11-15):
    - **What changed.**
      - New `src/agent-session/coalesce.ts` holds the one merge rule:
        - `mergeContentBlocks(last, next, maxChars?)` merges text with text, and thinking with thinking when neither side is `redacted` and neither has `data`. It carries the signature over.
        - `mergeDeltaEvents(last, next)` also requires the same `sessionId`, `runId` and origin (shallow compare), under `MAX_COALESCED_DELTA_CHARS` = 16,384 UTF-16 units (≤ 48 KiB UTF-8, under the 63.5/64 KiB AG-UI/ACP per-delta truncation).
        - Both are pure.
      - `pushCoalescedContent` (`provider-round.ts`) now calls `mergeContentBlocks` with no cap. **Behavior fix:** assembly no longer merges a thinking block that carries `data`. Before, the merge dropped the `data`.
      - `EventSubscriber` (`event-subscriber.ts`), rewritten:
        - The queue is a head-indexed array, compacted when the consumed prefix dominates. The waiter list is head-indexed too, so there is no `Array.prototype.shift`.
        - Under `coalesce`, a pushed delta merges into the tail slot. A pushed `tool.progress` for a queued `toolCallId` leaves a hole at the old slot and is appended. So "newest per call" holds without reordering it ahead of events that came between. A `toolCallId → absolute index` map plus a `base` offset survives compaction.
        - `size` counts live events, so holes do not count toward the bound.
        - `overflowed` getter added. `DEFAULT_MAX_QUEUED_EVENTS = 4096`, default policy `coalesce`, still no hard cap.
        - `coalesce` overflow behaves exactly like `close`: one `SubscriberOverflowError`, waiters rejected, `onClose`.
      - `SubscriberOverflowPolicy` (`contracts-core/agent.ts`) gains `"coalesce"`. The `SubscribeOptions` docs give the new defaults.
      - `session.ts` `stream()`/`resume()` `finally` blocks: when `subscriber.overflowed`, the generator does not abort. It attaches `runPromise.catch` so a rejection is never unhandled, and lets the run settle. Otherwise it aborts as before.
      - `agent.subscribe()` already builds an `EventSubscriber`, so it gets the new default with no code change. It carries only agent-scoped events (`session.*`, `background.*`, `package.status`), never `message.delta`, so for it the change is the policy and the 4,096 bound.
      - AG-UI: the handler streams with `overflow: "coalesce"`, and `DEFAULT_MAX_QUEUED_EVENTS` goes from 128 to 4096 (= its hard cap). `resumeSource` passes no policy and so gets the kernel default.
      - **Extra file, not in the plan's list:** `packages/hosts/remote/src/channel.ts`. `Overflow` gains `"coalesce"`, because `connect.ts:196`/`session-proxy.ts:186` forward `SubscribeOptions.overflow` and failed typecheck. The client channel treats `"coalesce"` as `"close"`, which is documented on the type. Its own default stays `"close"`. The Further Action stays open. Server-side `remote/serve.ts` streams with the kernel default, now `coalesce`.
    - **Tests.**
      - New `src/__tests__/event-subscriber.test.ts` (15 pass):
        - merge-helper units (thinking `redacted`/`data`, across run/session/origin, no mutation)
        - `defaults to coalesce with a 4096 bound`
        - `lagging_subscriber_merges_adjacent_text_deltas`
        - `tool_progress_keeps_latest_per_call`
        - `non_mergeable_events_keep_order_and_count`
        - `overflow_still_rejects_the_iterator`
        - `merged_delta_never_exceeds_16_kib`
        - the other policies keep their meaning
        - a 100k-event linear-queue check
        - `split_secret_is_not_reassembled_by_merging`: a merged text equals what a fast consumer concatenates, a whole secret inside one delta stays masked, and merging adds no secret occurrence
        - `overflow_does_not_abort_the_run`: an `acrossRuns` watcher sees `run.completed`, and the assistant message is stored
        - `consumer_break_still_aborts_the_run`
        - `slow_consumer_5000_deltas_does_not_overflow`: 50 ms per event, `maxQueuedEvents: 64`, all text arrives
        - `agent_subscribe_coalesces`: 600 sessions opened and closed into an undrained agent subscriber give 1,200 events, which overflowed the old 1024/`close` default
      - `packages/hosts/ag-ui/src/__tests__/handler.test.ts`: `ag_ui_slow_client_does_not_abort_the_run`. 500 deltas, client idle 100 ms, then `RUN_FINISHED`, the full text, and the stored assistant message. Checked against the old `close`/128 config: it fails there.
      - Pinned `overflow: "close"`: `agents.test.ts:91`, `session-subscriber-ownership.test.ts:105`.
      - **Extra file, not in the plan's list:** in `run-limits.test.ts`, Task 2's `arrivals` helper now subscribes with `overflow: "close"`. `buffer_output_true_holds_deltas_until_turn_end` times four individual deltas, and the buffered burst is exactly what `coalesce` merges (it saw 2, not 4).
    - **Findings.**
      - Under `coalesce`, a buffered (`bufferOutput: true`) turn's deltas reach a lagging subscriber merged, since they arrive in one burst. That is expected. A host that needs delta boundaries passes `overflow: "close"`, and `docs/events.md` says so.
      - Nothing found invalidates Task 4.
    - **Docs.**
      - `docs/events.md`: new "Subscribers and backpressure" (policy table, merge rule, redaction note, stop vs. overflow, and how a host gets the result after an overflow: `session.messages()`, an `acrossRuns` subscriber's terminal event, and the ledger; a new `run()` rejects until the run settles). The fail-closed note is updated.
      - `docs/agent.md`: the `agent.subscribe()` default, and the `stream()` row (options, stop aborts, overflow does not).
      - `docs/performance.md` subscriber table and outputs section. **This also removes a stale `event_subscriber_overflow` JSON example**: nothing emits that event (`graft grep` finds no hits).
      - `packages/hosts/devtools/README.md:85`, `packages/hosts/ag-ui/README.md` (queue 4096/4096, coalesced).
      - `CHANGELOG.md` `[Unreleased]` Changed entry.
    - **Budgets.** In `scripts/budgets.json`, kernel `packedBytes`/`unpackedBytes`/`fileCount`/`rootExports`/`sourceLines` are rebaselined to 1303007 / 4217639 / 370 / 1559 / 42710 (+3767 / +11713 / +1 / +4 / +165). `exportCounts["@arnilo/prism"]` goes to 1559. Each has a reason entry. The +4 exports are internal module exports of `coalesce.ts` and `DEFAULT_MAX_QUEUED_EVENTS`; there is no root export.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`; additive, no removals). Attributed to this task:
      - `scripts/compat-baseline/arnilo__prism.txt`: `SubscriberOverflowPolicy` changes from `"close" | "drop_oldest" | "drop_newest"` to `"coalesce" | "close" | "drop_oldest" | "drop_newest"`.
      - `scripts/compat-baseline/arnilo__prism-hosts.txt`: `./ag-ui DEFAULT_MAX_QUEUED_EVENTS` changes from `128` to `4096`.
      - `packages/hosts/host-builder/data/api.json` is regenerated.
    - **Checks.**
      - Pass:
        - `bun run typecheck`
        - `event-subscriber.test.ts` (15)
        - `run-limits.test.ts` (25)
        - `agents`, `session-subscriber-ownership`, `leak-sessions`, `agent-run-state`, `agent-surface`, `mid-stream-retry`, `public-export-contract` together with the above
        - AG-UI + remote package tests (166)
        - `bun run --filter @arnilo/prism-agent test` (66)
        - `docs.test.ts` required headings
      - `bun scripts/release.mjs gate`: the only failure is the preexisting `@arnilo/prism-ai … bump required`.
      - `@arnilo/prism-hosts`: 926 pass. The failures are timing budgets under load average ~30: `prism_api … under 50 ms`, and the two `remote_conformance_*` ten-second budgets. `remote` alone passes 77/77.
      - `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret` fails the same way with this task's changes stashed. It is preexisting and unrelated.
      - `scripts/budget-gate.test.mjs`: 2 failures **not from this task**, both from the uncommitted memory-system work in the tree:
        - `@arnilo/prism-memory-system` exports 1146 vs 1124
        - non-null assertions in `packages/memory/system/src/session`, 159 vs 114
      - Whole-suite result: see Task 4's checks (run once for the plan).
  - Acceptance Criteria:
    - Functional:
      - `SubscribeOptions.overflow` gains `"coalesce"`, the new default. It applies to `session.subscribe()`, `stream()`/`resume()`, and `agent.subscribe()` (`create-agent.ts:90-96`).
        - **What merges.** While a subscriber is not awaiting, a pushed `message.delta` whose content is text, or thinking with neither side `redacted` and no `data`, is merged into the queue's last event. The last event must be a delta of the same kind, run, and origin, and the merged text must stay **≤ 16 KiB**. That cap keeps AG-UI/ACP per-delta truncation at 64 KiB from ever cutting merged text (Task 1(d)). A pushed `tool.progress` replaces a queued one for the same `toolCallId`.
        - Nothing else is merged, and order across event types is preserved.
        - The merge rule is the one in `pushCoalescedContent` (`provider-round.ts:43-58`), extracted into one pure helper that both sites use.
      - `maxQueuedEvents` defaults to 4,096. The kernel keeps no hard cap, as today (Task 1(c): a whole coding run is ~120 events). When the bound is reached by events that cannot be merged, the iterator rejects with `SubscriberOverflowError`, as `close` does today.
      - The AG-UI handler (`packages/hosts/ag-ui/src/handler.ts:262-263`) streams with `overflow: "coalesce"`. Its `DEFAULT_MAX_QUEUED_EVENTS` goes from 128 to 4096, its hard cap (`limits.ts:24-25`). Today a slow AG-UI client aborts the run after 128 queued events.
      - Tests that depend on `close` being the default pin `overflow: "close"`: `agents.test.ts:91`, `session-subscriber-ownership.test.ts:105`.
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
      - `src/agent-session/coalesce.ts` (new): the shared pure merge helper
      - `src/agent-session/event-subscriber.ts`: the policy, the queue
      - `src/agent-session/session.ts`: the two `finally` blocks
      - `packages/hosts/remote/src/channel.ts`: `Overflow` accepts `"coalesce"` (treated as `"close"`), found during execution
      - `src/__tests__/run-limits.test.ts`: the `arrivals` timing helper pins `overflow: "close"`, found during execution
      - `scripts/budgets.json`: kernel size and export ceilings rebaselined
      - `src/contracts-core/agent.ts`: the policy union and default
      - `src/agent-session/session/provider-round.ts`: `pushCoalescedContent` uses the shared merge helper
      - `packages/hosts/ag-ui/src/handler.ts`, `limits.ts`: the policy and default from Task 1(b)
      - `src/__tests__/event-subscriber.test.ts` (new or extended); `agents.test.ts`, `session-subscriber-ownership.test.ts` (pin `"close"`)
      - `docs/performance.md` (subscriber table, `:444-497`), `packages/hosts/devtools/README.md:85`, `packages/hosts/ag-ui/README.md`: the new defaults
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
    - `merged_delta_never_exceeds_16_kib`.
    - `agent_subscribe_coalesces`.
    - `ag_ui_slow_client_does_not_abort_the_run`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a default policy and stream abort semantics
    - Docs pages to create/edit:
      - `docs/events.md`: "Subscribers and backpressure"
      - `docs/agent.md`: `SubscribeOptions`, and what happens to a run after an overflow
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 4: Byte limits are enforced without re-serializing
  - Notes (executed 2026-11-15):
    - **What changed.**
      - `src/agent-session/helpers.ts` gains one sizer per direction next to `jsonBytes`:
        - `requestBytes(request)`: a `WeakMap<object, number>` (`partBytesMemo`) holds the serialized size of each message, tool definition and context block, keyed by identity. The `messages`/`tools`/`context` arrays are summed from it plus brackets and commas. The small remaining fields (`model`, `options`, `metadata`, …) are stringified per call, and the `{"key":…}` framing is added. **The value is exact** (equal to `jsonBytes(request)`) for plain JSON data, not just within 2%. Each new part is still stringified once through `jsonBytes`, so the serializability `TypeError` survives (pinned by `request_bytes_still_guard_serializability`).
        - `providerEventBytes(event)`: a text, thinking or `tool_call_delta` event is charged at the `Buffer.byteLength` of its strings plus `PROVIDER_EVENT_OVERHEAD_BYTES` (64). Other events (a whole `tool_call`, media blocks, usage, done, errors) and any non-string field fall back to `jsonBytes`.
      - `provider-round.ts` charges `maxRequestBytes` with `requestBytes(request)` and `maxResponseBytes` with `providerEventBytes(event)`. `jsonBytes` is no longer called there directly.
      - `src/provider-kit/transport.ts` `readSseEvents`:
        - `append(text)` adds the decoded chunk's UTF-8 length to `bufferBytes` and checks `maxBufferBytes`.
        - It tests for `\r?\n\r?\n` only in `scanTail + text`, where `scanTail` holds the last 3 scanned characters. The buffer (a rope) is flattened and scanned only when a frame is complete.
        - Each consumed frame subtracts its own bytes plus the delimiter. `ensureBufferLimit` is gone.
        - `byteLength` is now `Buffer.byteLength` (see the deviation below).
    - **Deviation from the criteria.**
      - *`Buffer.byteLength` instead of a hoisted `TextEncoder`.* It was about 2× cheaper per call and does not allocate: 0.35 vs 0.60 (hoisted) vs 0.72 ms (per call) for 4,000 short strings. `provider-kit/media.ts` already uses `Buffer`.
      - *The decoded chunk's UTF-8 length instead of raw chunk `byteLength`.* With invalid UTF-8, the decoder turns a 1-byte sequence into U+FFFD (3 bytes). Subtracting consumed frames at their decoded size would then drift the count *down* without bound, so a crafted stream could defeat `maxBufferBytes`. Counting decoded text on both sides stays exact.
    - **Response sizer meaning.** `maxResponseBytes` now counts the UTF-8 bytes an event carries, not its JSON text: escaping inside strings (`"` → `\"`) is not counted. For text deltas the charge is ≥ the serialized size, because the 64-byte allowance covers the framing. A tool-argument delta full of quotes can be charged below its JSON size. The cap bounds what the host holds, so this is the intended meaning. `docs/performance.md` and the changelog state it.
    - **Tests.**
      - `src/__tests__/run-limits.test.ts`:
        - The `:167` UTF-8 case is renamed "…at their sized byte length" and pins `PROVIDER_EVENT_OVERHEAD_BYTES + 4` for `😀` (≥ the serialized length).
        - New `describe("byte accounting without re-serializing (plan 228 Task 4)")`:
          - `request_bytes_within_two_percent_of_serialized_size`: unicode, escapes, an image, tool schemas, context, options/metadata, an `undefined` field, and empty messages. All are exact, and a repeat call is memoized.
          - `request_bytes_still_guard_serializability`
          - `oversized_request_still_fails_closed`
          - `oversized_frame_still_fails_closed`: a 65 MiB text frame under `maxResponseBytes` set to the 64 MiB hard cap
          - a sizer unit for multibyte text and argument deltas
      - `src/__tests__/provider-transport.test.ts`, new `describe("SSE reader byte accounting (plan 228 Task 4)")`:
        - `sse_buffer_limit_holds_without_reencoding`: emoji split mid-character across four chunks. 46 bytes overflows at 45 and passes at 48. 200 frames pass through a 32-byte buffer, so consumed bytes are released.
        - `sse_large_frame_in_small_chunks_is_linear`: `\r\n\r\n` split at each offset 1–3, plus a 240 KB vs 960 KB frame in 256 B chunks, which must cost < 9× + 20 ms (quadratic is 16×).
      - `scripts/benchmark-session-turn.test.mjs`: `benchmark_byte_accounting_budget`. On Task 1's workload, timed best-of and interleaved, the kernel-side sized/serialized time ratio must be ≤ `scripts/budgets.json#byteAccounting.ceilings.maxSizedToSerializedRatio` (0.2 = the ≥ 80% drop).
    - **Measurements** (Bun 1.4.4; load average 28–106 throughout, so ranges; scratchpad `bench228t4.ts`, `sse2.ts`, which compare against the pre-change `readSseEvents` from `HEAD`):

      | workload | before | after | drop |
      | --- | --- | --- | --- |
      | `maxRequestBytes`, 217.6 KiB request, one new message per attempt | 1.15–1.37 ms | 0.017–0.026 ms | ~98% |
      | `maxResponseBytes`, 2,000 text deltas | 0.85–1.07 ms | 0.18–0.31 ms | ~75–80% |
      | 2,000-delta turn, kernel side (request + deltas) | 2.0–2.4 ms | 0.20–0.34 ms | ~86–90% |
      | SSE byte counting per call (4,000 short strings) | 0.72 ms | 0.35 ms | ~50% |
      | `readSseEvents`, one 240 KB frame in 938 × 256 B chunks | 236–390 ms (72.8 ms unloaded, Task 1) | 4.0–8.9 ms | ~97% |
      | `readSseEvents`, 2,000 one-frame chunks (whole reader) | 14.6 / 26.5 ms median | 14.8 / 26.6 ms median | parse-dominated, unchanged |
      | session-turn-overhead, 1,000 runs, memory `growthRatio` (3 runs each) | 3.8 / 17.4 / 25.2 | 2.1 / 3.4 / 2.4 | — |
      | same, memory last-20 p50 | 72.8 / 74.1 / 122.9 ms | 21.8 / 21.3 / 9.4 ms | ~80–90% |

      - Small-frame SSE byte accounting drops only ~50%, because each chunk and each frame is still counted once. That count is the cap itself. Its share of the reader is small: parsing and stream overhead dominate.
      - The `sessionTurnOverhead.maxGrowthRatio` ceilings stay at 10. The measurements are too noisy under this load to tighten them, and `budgets.json` records the numbers.
    - **Docs.**
      - `docs/performance.md`: a new "Byte accounting (plan 228)" section with the before/after table.
      - `docs/performance.md`: the plan 036 paragraph no longer claims `Buffer.byteLength(JSON.stringify(…))`.
      - `docs/performance.md`: the session-turn-overhead bullet records the growth fix.
      - `CHANGELOG.md`: an `[Unreleased]` Performance entry.
    - **Budgets.** In `scripts/budgets.json`:
      - New `byteAccounting.ceilings.maxSizedToSerializedRatio` = 0.2.
      - Kernel `packedBytes`/`unpackedBytes`/`rootExports`/`sourceLines` are rebaselined to 1306026 / 4225853 / 1562 / 42803 (+3019 / +8214 / +3 / +93), and `exportCounts["@arnilo/prism"]` to 1562, with reason entries. The +3 exports are internal (`requestBytes`, `providerEventBytes`, `PROVIDER_EVENT_OVERHEAD_BYTES`); there is no root export.
      - The `sessionTurnOverhead` comment is updated.
    - **Baseline diff.** None: no public surface changed. `bun scripts/release.mjs gate` reports only the preexisting `@arnilo/prism-ai … bump required`.
    - **Checks.**
      - Pass:
        - `bun run build:core`, `bun run typecheck`
        - `run-limits` (30), `provider-transport` (48), `event-subscriber`, `mid-stream-retry`, `docs.test.ts`, `public-export-contract`, `benchmark-session-turn` (4): 232 pass together
        - `@arnilo/prism-hosts` 927/927 on rerun (the first run had one load-timing flake at load average ~40–106)
        - `@arnilo/prism-agent` 66/66
      - `scripts/budget-gate.test.mjs`: only the two preexisting memory-system failures from Task 3's note remain (exports 1146 vs 1124; non-null assertions 159 vs 114).
      - Full suite (`bun run test`, background task `bdr436lpb`, 2026-11-15 ~21:30 local): exit 1, with 17 failing tests.
        - Those 17 are: Kilo `kilo_missing_credential_notes_and_registers`, Obscura workflow conformance, `examples_demos_run_to_completion_and_emit_no_secret` (60 s timeout), `host_builder_index_is_fresh`, `host_eval_suite_*` (2), `multi-agent-runtime` budgets, the non-null-assertion budget, `orchestrated_workflow_runs_end_to_end`, package-truth/phase54 evidence (2), the per-package export-count budget, the `post_publish_smoke` specs, `research_report_citations_resolve`, `validates a large argument object quickly`, `hard_deny_decision_budget`, and url validation. `@arnilo/prism-agent` was 62 pass / 4 fail.
        - That run overlapped plan 229 Task 2's own build and test runs in the same tree. It shared the build lock and `dist`, and the machine was under load, so most of these failures are contention: timeouts and timing budgets.
        - The next full run, after plan 229 Task 2 regenerated the host-builder index and package-truth evidence, failed on only four tests:
          - the two preexisting memory-system budgets (exports 1146 vs 1124; non-null assertions 159 vs 114);
          - the load-sensitive `multi-agent-runtime` `contextBudget-10k-history` p95 (1119 ms > 1000 ms, load/cpu 1.7);
          - the host-builder eval lock's `indexes` hash, which was then updated.
        - `@arnilo/prism-agent` passes on its own: 66 pass, 1 skip, 0 fail.
        - None of the failures is in byte accounting.
  - Acceptance Criteria:
    - Functional:
      - `maxRequestBytes` is charged from a per-message byte size memoized by message object (one `WeakMap<Message, number>`, the same pattern as `messageEstimateMemo`, `provider-round.ts:211-231`), plus the tools and options sizes computed once per assembly.
        - Each new message is still stringified once. That keeps the JSON-serializability guard (`helpers.ts:152`) for every part of the request.
        - The charged value is within 2% of `jsonBytes(request)`, and never lower than the true serialized size by more than that margin.
        - The limit's meaning, a per-frame safety cap, is unchanged.
      - `maxResponseBytes` is charged from content lengths of the event (the UTF-8 length of the text, thinking and argument strings, plus a fixed overhead per event), not from `JSON.stringify`. `run-limits.test.ts:167-188`, which pins the exact serialized length, is relaxed to the sizer's value.
      - The SSE reader tracks its buffered byte count from each decoded chunk's UTF-8 length and consumed block sizes, and never re-encodes the buffer. (Amended in execution: raw chunk `byteLength`s drift down under invalid UTF-8, see the note.) It searches for the frame delimiter only in the newly appended text plus a 3-character overlap, not from offset 0. `byteLength` no longer builds a `TextEncoder` per call (`transport.ts:380-382`); it uses `Buffer.byteLength`, which is cheaper than a hoisted encoder (amended in execution).
      - Limits still trip on an oversized request, an oversized frame, and an oversized SSE buffer, with the same error codes.
    - Performance: On Task 1's baseline workloads, time in byte accounting drops by at least 80%. The baselines are: the 2,000-delta turn at ~1.5 ms; one 240 KB frame in 256 B chunks through `readSseEvents` at 72.8 ms; and the session-turn-overhead memory `growthRatio`, where `budgets.json:384` attributes 82% of per-run time to `jsonBytes`. The numbers go in the task note and `docs/performance.md`.
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
    - `sse_large_frame_in_small_chunks_is_linear`: a 240 KB frame in 256 B chunks, and a delimiter split across chunks.
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

- (Task 2) Live delivery means a breaching turn's deltas reach subscribers before `run.failed`. A host that must not show them sets `limits.bufferOutput: true`. Task 1 found no first-party host that relies on the buffer.
- (Task 3) The remote client channel accepts `"coalesce"` but treats it as `"close"`. See Further Actions.
- (Task 4) `maxResponseBytes` counts the UTF-8 bytes an event's strings carry plus 64 bytes of framing. It does not count JSON escaping inside strings, so a quote-heavy tool-argument delta is charged below its serialized size. The cap is a memory bound, not a wire-size bound.
- (Task 4) SSE byte counting still costs one `Buffer.byteLength` per chunk and per frame. That is ~50% cheaper than before, not 80%, on many tiny frames, where parsing dominates the reader anyway. Counting raw chunk bytes would be cheaper but drifts low under invalid UTF-8, which would defeat the cap.
- (Task 4) The session-turn-overhead `maxGrowthRatio` ceilings stay at 10. The machine's load (average 28–106) made the measurements too noisy to tighten them.

## Further Actions

- (Task 4) Re-measure session-turn-overhead on an idle machine, and lower `scripts/budgets.json#sessionTurnOverhead.ceilings.maxGrowthRatio` (memory measured 2.1–3.4 under load) so that a return of O(request) work per attempt fails the gate. Low priority: the `byteAccounting` ratio gate already catches a reverted sizer.
- (From Task 1(b), updated by Task 3) The `remote` client-side queue (`packages/hosts/remote/src/channel.ts`, `connect.ts:196`, `session-proxy.ts:186`) defaults to `"close"`. It accepts `"coalesce"` since Task 3 but treats it as `"close"`, so a slow remote consumer still fails its iterator at 1,024 events. Medium priority. Give the channel the merge rule (`mergeDeltaEvents` in `src/agent-session/coalesce.ts` is internal; the remote package would need it exported, for example on `@arnilo/prism/provider-kit` or a host-facing subpath) and make `"coalesce"` its default.
