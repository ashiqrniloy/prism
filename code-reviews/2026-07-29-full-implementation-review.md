# Prism full implementation review — 2026-07-29

## Scope and method

Reviewed the working tree at `0.0.16` (commit `dba764c`), core `src/` (61 files, ~13.5k
lines) plus a targeted pass over the first-party workspaces (`packages/*`, ~46k production
lines across 41 packages). Every core module was read in full; packages were reviewed by
structure, hotspot greps (unbounded buffers, swallowed errors, timer lifecycle, unsafe
parsing), and full reads of the highest-risk files (`coding-agent/shell.ts`,
`server/handler.ts`, `mcp/bridge.ts`, `provider-openai/responses.ts`, workflow run/replay
entry points, SQLite/Postgres persistence branch readers).

Verification performed:

- `npm run build` — clean, all workspaces.
- `node --test dist/__tests__/*.test.js` — **1261 tests, 0 fail, 0 skip**.

Prior review (`code-reviews/2026-07-22-...`) covered competitive positioning; this review
covers implementation quality only: defects, gaps, enhancements, and
elegance/performance opportunities. Each finding states *why* it is a gap and *why* the
change is warranted.

## Executive summary

The codebase is in strong shape: fail-closed security posture, bounded resources nearly
everywhere, recursive-CTE branch reads in both DB stores, SSRF/magic-byte media defenses,
and a passing test suite. Findings below are mostly narrow defects and polish, not
architectural problems. The two findings worth fixing first are the durable run-state
save/load byte-limit mismatch (states can be saved that can never be resumed — A1) and
the durable-resume + input-guardrail-interrupt dead end (A2), both in the durable-run
path.

| # | Area | Severity | Kind |
|---|------|----------|------|
| A1 | Durable run-state byte limit mismatch (save vs load) | High | Defect |
| A2 | Resumed durable run + input guardrail `interrupt` hard-fails | High | Defect |
| A3 | Agent fingerprint omits instructions/skills/provider options | Medium | Gap |
| A4 | Guardrail `interrupt` unsupported at tool/output stages | Medium | Gap |
| A5 | Memory session store: cross-session `expectedParentId` accepted | Medium | Defect |
| A6 | Blocked steer message fails the entire run | Medium | Gap |
| B1 | Retry: no jitter, no `Retry-After` honoring | Medium | Enhancement |
| B2 | `input_assembly` middleware skipped by custom InputBuilder | Medium | Defect |
| B3 | Middleware `next()` + return-value ambiguity | Low | Gap |
| B4 | Extension kernel: no unload/rollback/ordering | Low | Enhancement |
| B5 | CLI flags `--config/--resource/--extension/--tool` recorded but inert | Low | Gap |
| C1 | Context budget eviction is O(n²) | Medium | Performance |
| C2 | Batched run ledger: batch counters are dead code | Low | Elegance |
| C3 | Default prompt builder duplicates tool list as text | Low | Performance |
| C4 | Event multiplexer ordering inconsistent under parked waiter | Low | Defect |
| C5 | Guardrail failure cause discarded | Low | Observability |
| C6 | Memory checkpoint store unbounded | Low | Hardening |
| C7 | Credential store name-only fallback crosses providers | Low | Security note |
| C8 | Minor nits | Low | Elegance |

---

## A. Defects and correctness gaps

### A1 — Durable run-state can be saved at a size that can never be resumed

**Where:** `src/agent-run-state.ts` — `saveAgentRunState` vs `parseAgentRunState`.

`saveAgentRunState` bounds state with `input.maxStateBytes`, which the host may raise up
to `HARD_MAX_AGENT_RUN_STATE_BYTES` (1 MB). `parseAgentRunState` (called by
`loadAgentRunState` on resume) always re-bounds with `DEFAULT_MAX_AGENT_RUN_STATE_BYTES`
(256 KB):

```ts
return boundState({ ...state, version } as StoredAgentRunState, DEFAULT_MAX_AGENT_RUN_STATE_BYTES);
```

**Why this is a defect:** any run configured with `maxStateBytes > 256 KB` whose
suspended state lands between 256 KB and its configured cap persists successfully, then
throws `AgentRunStateError("Agent run state exceeds 262144 bytes")` on every resume
attempt. The interruption is unrecoverable — the exact failure durable runs exist to
survive.

**Fix:** thread the configured `maxStateBytes` into the load path (e.g. via
`AgentRunResumeOptions`, or by reading it from the stored record before bounding), or
enforce the same constant on both sides. Cheapest correct fix: bound with
`HARD_MAX_AGENT_RUN_STATE_BYTES` on load — the byte cap on load is a DoS guard, not a
policy decision, and the hard cap already exists for that purpose.

### A2 — Resumed durable run + input guardrail `interrupt` can never be approved

**Where:** `src/agents.ts` — `runInternal`, input guardrail block.

```ts
if (inputGuardrails.terminal?.action === "interrupt" && this.activeDurable) {
  if (!resumed) { ...throw new AgentRunSuspended(...) }
} else {
  assertGuardrailsAllowed(inputGuardrails);
}
```

**Why this is a defect:** on a *fresh* run, an `interrupt` input guardrail suspends the
run for approval. On *resume*, the stored input is replayed through the same guardrails;
if the guardrail still returns `interrupt` (e.g. it always requires human approval for
this class of input), the condition falls through to `assertGuardrailsAllowed`, which
throws `GuardrailError` — the run fails terminally. There is no path where an operator
approval lets the run proceed, because the resumed evaluation can't re-suspend.

**Fix:** treat a repeated `interrupt` on resume as "already approved" (the resume
decision *is* the approval) by skipping the input-stage interrupt conversion when
`resumed` is set — i.e. run `assertGuardrailsAllowed` only for `block`/`tripwire`
actions — or re-suspend again. The first option matches the approval semantics of
`resumeAgentRun`; the second creates an infinite suspend/resume loop and should be
avoided.

### A3 — Agent fingerprint omits behavior-defining configuration

**Where:** `src/agent-run-state.ts` — `agentFingerprint`.

The fingerprint covers `id`, `revision`, `model`, `tools` (name/parameters/exclusive),
`guardrails` (name/stage/revision), and `loop`. It does **not** cover `instructions`,
`systemPrompt`, `skills`, `providerOptions`, `middleware`, or `instructionInjectors`.

**Why this is a gap:** the fingerprint is the resume-time guard that "the agent
definition didn't change underneath a suspended run." System instructions are as
behavior-defining as the model: a host that edits `instructions` without bumping
`definitionRevision` resumes the old checkpoint against a materially different agent,
with no error. The revision field mitigates this only if hosts religiously bump it —
the fingerprint exists precisely because they won't.

**Fix:** include a hash of `instructions`/composed system prompt and skill names in the
fingerprint, or document explicitly in `docs/` that *any* instruction change requires a
`definitionRevision` bump. Hashing is the fail-closed option.

### A4 — Guardrail `interrupt` is unavailable at tool_input / tool_output / output stages

**Where:** `src/guardrails.ts` (`GuardrailError`), `src/tools.ts` (`dispatchToolCall`),
`src/agents.ts` (`generateProviderTurn` output stage).

`interrupt` is honored only at the input stage of durable runs (A2 path) and via
`interruptBeforeTool` in `beforeExecute`. Everywhere else it throws
`ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE` and fails the run.

**Why this is a gap:** the `GuardrailAction` union advertises four actions; one of them
silently degrades to "crash the run" at three of four stages, and there is no type-level
or doc-level narrowing per stage. A host that writes an output-stage approval guardrail
(e.g. "hold responses containing PII for review") gets a runtime failure instead of a
suspension — and only discovers it in production.

**Fix:** for durable runs, route stage-terminal `interrupt` records through
`suspendDurable` (the tool stages have the call context needed for a `tool_approval`-like
interruption), or narrow the contract: make `Guardrail.evaluate` per-stage action types
exclude `interrupt` where unsupported. At minimum, document the per-stage support matrix
in `docs/guardrails.md`.

### A5 — Memory session store accepts a parent from another session

**Where:** `src/session-stores.ts` — `createMemorySessionStore.add`.

```ts
if (options?.expectedParentId !== undefined && !byId.has(options.expectedParentId)) { ...conflict }
```

`byId` is global across sessions. An append to session B with `expectedParentId` pointing
at an entry of session A passes validation, creating an entry whose parent is invisible
to `list(B)` — every subsequent branch walk over B throws `Missing session parent`.

**Why this is a defect:** the store accepts a write it cannot later read. The runtime
never does this itself (it always parents at `currentLeafId` of the same session), but
the store is a public contract (`SessionStore`) and DB adapters enforce same-session
parentage structurally; the reference implementation should fail the same way.

**Fix:** also verify `byId.get(expectedParentId)?.sessionId === entry.sessionId`.

### A6 — A single blocked steer message fails the whole run

**Where:** `src/agents.ts` — `applyPendingSteers`.

Steer-time input guardrails are evaluated when the queue drains (`assertGuardrailsAllowed`
inside `applyPendingSteers`). A `block`/`tripwire` on one steered message throws, which
propagates out of the loop and fails the entire run.

**Why this is a gap:** mid-run input is adversarial in exactly the way run-start input
is, but the blast radius differs: at run start, blocking the input *is* blocking the
run; mid-run, one bad steered message destroys all completed work in the run (tool side
effects already happened, but the run result, usage totals, and final message are lost
to the caller as a thrown `AgentRunError`).

**Fix:** on a steer-stage terminal guardrail, drop the offending message and emit a
`guardrail_decision` + `steer_rejected` event instead of throwing; keep `interrupt`
semantics unchanged. If fail-the-run is intentional, document it — today the behavior is
implicit.

---

## B. Enhancements

### B1 — Retry policy: no jitter, no `Retry-After` honoring

**Where:** `src/retry.ts` — `createDefaultRetryPolicy`.

Backoff is `base * 2^(attempt-1)` clamped to `maxDelayMs` — deterministic. Provider error
payloads carrying `Retry-After` (surfaced in `ErrorInfo.code`/metadata by HTTP adapters)
are ignored.

**Why this is an enhancement:** deterministic backoff under a shared outage produces
thundering-herd retries — all sessions retry on the same millisecond boundaries, which
is precisely when 429/503s occur. `Retry-After` is the provider's explicit backpressure
signal; ignoring it extends outages and can trip provider-side rate punishments. Both
are standard practice in provider SDKs.

**Fix:** add ±25–50% jitter to `delayMs`, and let `decide` read a `retryAfterMs` hint
from `context.error` metadata (providers would populate it) capped at `maxDelayMs`.

### B2 — `input_assembly` middleware silently skipped with a custom InputBuilder

**Where:** `src/input.ts` — `assembleProviderInput`.

Non-budget path: middleware runs inside `createDefaultInputBuilder().build`. Budget path:
middleware runs in `assembleProviderInput` itself after flattening. A host-supplied
`InputBuilder` that doesn't honor `context.middleware` (nothing in the `InputBuilder`
contract says it must) silently bypasses every registered `input_assembly` middleware —
including security-relevant ones (PII stripping, policy injection).

**Why this is a defect:** middleware application is a security seam; whether it runs
currently depends on which builder is installed. The budget path already demonstrates the
correct invariant (runtime applies it, always).

**Fix:** move `middleware.run("input_assembly", messages)` out of the default builder
into `assembleProviderInput` after `inputBuilder.build(...)`, unconditionally, and remove
it from the default builder.

### B3 — Middleware `next()` + return-value semantics are ambiguous

**Where:** `src/middleware.ts` — `createMiddlewareRegistry.run`.

If a middleware calls `next(v)` and also returns a value, the return value is silently
discarded. If it calls `next()` twice, the last call wins. Neither is diagnosed.

**Why this is a gap:** the onion-style `(value, next)` signature invites both mistakes;
the silent discard means a middleware author can believe a transform is applied when it
is not — for the `provider_request` and `tool_call` hooks, that is a policy-bypass
class of bug in host code that Prism could prevent.

**Fix:** throw on a second `next()` call, and throw (or warn via `onError`) when a
middleware both calls `next` and returns a different value.

### B4 — Extension kernel: no unload, rollback, or load ordering

**Where:** `src/extensions.ts` — `createExtensionKernel.load`.

Extensions load in array order; a failure mid-list (with `errorPolicy: "event"`) leaves
earlier extensions' contributions registered with no way to undo; there is no dependency
declaration between extensions.

**Why this is an enhancement:** partial-load state is invisible to the host except by
diffing registries, and contribution registries have no unregister. For long-lived hosts
(Gateway-style), "reload one extension" currently means "restart the process." Ordering
matters when extension B's `setup` assumes extension A's contributions exist.

**Fix (lazy version):** add `registries.*.unregister(name)` and return a per-extension
dispose handle from `load`; defer dependency graphs until a second real consumer exists.

### B5 — CLI flags `--config`, `--resource`, `--extension`, `--tool` are parsed but inert

**Where:** `src/cli-runner.ts` — usage text admits: "recorded, not auto-loaded".

**Why this is a gap:** flags that parse successfully but do nothing are worse than
unknown-flag errors — users build invocations around them and get silently different
behavior. Combined with the prior review's finding (shipped binary only runs the mock
provider without a host `createSession`), the CLI's advertised surface exceeds its
functional one.

**Fix:** either wire the flags (load config JSON, register named tools from a discovery
path) or reject them with "not supported in this build" until implemented.

---

## C. Elegance and performance

### C1 — Context-budget eviction re-measures everything per drop

**Where:** `src/context-budget.ts` — `applyContextBudget`.

```ts
while (overBudget(cost(), budget)) { const drop = dropNext(...); ... }
```

`cost()` re-walks and re-encodes every group, context block, skill, and tool on each
iteration. Dropping *k* items from an *n*-message history is O(n·k) text encodings — the
common case (tight budget, long history) is the worst case.

**Fix:** measure once, then subtract each dropped omission's already-computed
`tokenEstimate`/`byteLength`. The omission record already carries both numbers; the loop
becomes O(n + k). Same observable behavior, strictly less work.

### C2 — Batched run ledger: batch-size counters are dead code

**Where:** `src/run-ledger.ts` — `flush`'s inner loop resets `entries`/`bytes` when batch
bounds are hit, but `write(item)` is per-record regardless; `RunLedger` has no batch
append. `maxBatchEntries`/`maxBatchBytes` therefore only influence *when* flush runs
(via `enqueue`), never how many records a flush coalesces.

**Why this matters:** the code implies write coalescing that doesn't happen — a reader
tunes `maxBatchEntries` expecting fewer, larger writes and gets neither. Either add a
batch append (`appendBatch(records)`) to the `RunLedger` contract so the batching is
real, or delete the intra-flush counters and document that batching is time/size-based
write *delay*, not coalescing.

### C3 — Default prompt builder duplicates the tool list as message text

**Where:** `src/input.ts` — `toolMessages` / `createDefaultPromptBuilder`.

Tools go into `request.tools` (native tool-calling channel) *and* into an
`Available tools:` system message. For every tool-capable provider this is double token
spend on every turn, and the two copies can drift (middleware mutates one).

**Fix:** emit the text listing only when the model lacks a tools capability
(`model.capabilities?.tools === false`-style check, mirroring
`modelSupportsStructuredOutput`), or make it opt-in. Keeps the fallback for
text-only/mock providers without taxing the common path.

### C4 — Event multiplexer: sorted delivery is skipped when a consumer is parked

**Where:** `src/event-multiplexer.ts` — `publish` delivers directly to a parked `waiter`,
bypassing the `compare` sort that `subscribe` applies only to the queued path.

**Why this is a defect:** a host supplying `compare` gets sorted delivery only while the
consumer lags; the moment it keeps up, ordering reverts to publish order. Ordering
guarantees that depend on consumer speed are no guarantee.

**Fix:** when `compare` is set, always enqueue and let `subscribe` do the ordered drain
(the waiter path then just wakes the generator).

### C5 — Guardrail evaluation failure discards the cause

**Where:** `src/guardrails.ts` — `evaluate`'s `catch` maps any throw to
`reason: "guardrail_failed"` with no metadata.

**Why this is an enhancement:** a failing guardrail fails closed (correct), but the host
gets a decision event with zero diagnostic content — was it a timeout, a bug, a denied
dependency? The original error is dropped on the floor.

**Fix:** attach a bounded, redacted `error.message` to the record metadata
(`MAX_REASON_BYTES` already exists for this purpose).

### C6 — Memory checkpoint store is unbounded

**Where:** `src/checkpoints.ts` — `createMemoryCheckpointStore`. No record-count or
value-size caps (contrast: agent-run state has depth/property/byte bounds; the memory
session store has search caps).

**Why this is an enhancement:** it's the reference implementation hosts copy. An
unbounded reference becomes an unbounded production store. A `maxRecords`/LRU or a
per-value byte cap brings it in line with the rest of the codebase's bounded-by-default
posture.

### C7 — Credential store: name-only fallback can cross providers

**Where:** `src/credentials.ts` — `createMemoryCredentialStore.resolve` falls back from
`(provider, name)` to `(name)` for *any* provider.

**Why this is a security note:** a credential stored under bare name `"apiKey"`
(providerless) is silently served to a request scoped to a different provider than the
host intended. Providerless records are useful as defaults, but the fallback should be a
conscious choice.

**Fix:** keep the fallback but document it loudly, or gate it behind
`createMemoryCredentialStore(records, { allowProviderFallback: true })`.

### C8 — Nits

- `src/agents.ts` `jsonBytes`: allocates a `TextEncoder` per call on the hot
  request/response-byte path; hoist a module-level encoder (already done for
  `steerTextEncoder` in the same file).
- `src/agents.ts` `withoutTrailingInput`: compares messages via `JSON.stringify`
  equality — key-order sensitive; a redacted-then-reassembled message with reordered
  keys defeats the dedupe and duplicates trailing input after auto-compaction. Compare
  by entry id (entries have ids) instead of serialized message bodies.
- `src/redaction.ts` `redactSecrets`: no recursion-depth cap; a hostile deep structure
  overflows the stack. Host-controlled data makes this low-risk, but a `MAX_DEPTH`
  matching `agent-run-state.ts`'s 32 costs three lines.
- `src/session-stores.ts` `listSessionBranches`: O(branches × entries) since each leaf
  re-walks the index; fine at current scale, worth a memoized parent-map if branch
  counts grow.
- `packages/provider-openai/src/responses.ts`: `baseUrl.replace(/\/$/, "")` strips one
  trailing slash; `//` survives. Harmless but `replace(/\/+$/, "")` is the same length.
- `packages/coding-agent/src/shell.ts`: `spawnHook` receives a full `{...process.env}`
  clone — secrets included. It is a host hook (trusted), but an `envAllowlist` option
  would let hosts pass a scrubbed environment without re-implementing the hook.

---

## What reviewed clean (no action)

- **SSRF/media pipeline** (`src/content.ts`): scheme allowlist, credential-in-URL
  rejection, private-host/loopback/metadata denial, DNS-pinning hooks, magic-byte
  verification, per-item/request/duration bounds. Thorough.
- **Durable-run CAS**: version + fencing-token + ownership assertions are consistent
  across memory, SQLite, and Postgres stores; `dispatched`-state ambiguity correctly
  requires operator resolution.
- **DB branch reads**: both SQL stores use recursive CTEs (`readBranchPath`), so the
  runtime never full-scans sessions; the core falls back gracefully for stores without
  it.
- **Server handler** (`packages/server`): host allowlist, strict CORS (unknown origin →
  404, not reflection), authorization before rate-limit before drain-admit, ownership
  re-verified against schedule selection. Correct ordering.
- **Config merge**: `__proto__`/`constructor`/`prototype` key rejection and
  JSON-value validation at every layer.
- **Run limits**: fail-closed on missing cost data when `maxCost` is set; snapshot
  validation on durable resume; wall-time deadline survives suspension via `deadlineAt`.
- **Shell tool**: output accumulation with tail retention + spill file, process-group
  kill, post-exit stdio-idle grace, non-zero-exit-is-not-an-error semantics. Careful
  port.

## Suggested priority

1. **A1, A2** — durable-path defects; both are "worked in tests, fails in production"
   class.
2. **B2** — middleware bypass; one-line move with a regression test.
3. **A5, B1, C1** — small, isolated, clearly correct.
4. **A3, A4, A6** — contract-semantics decisions; pick the semantic, then the diff is
   small.
5. Everything in C — opportunistic.
