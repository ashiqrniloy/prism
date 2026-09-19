# Attention compiler

## What it does

`createAttentionCompiler(options?, context?)` returns a validated, frozen configuration for the opt-in attention compiler: a per-turn gate that **measures** the assembled input against a host ratio of the model input cap and **rewrites nothing** until that ratio is reached.

The compiler is a gate, not a mixer. Once over the ratio it mutates a **history clone** monotonically — oldest `thinking` blocks first, then oldest fold-eligible tool results — so prompt-cache prefixes survive and the session store, observational-memory ledger, and input history array are never touched. Still over after every eligible row → `AttentionBudgetError` instead of silently dropping constitution.

The whole request (instruction groups, summaries, history, input, attachments, in-flight tool results, context blocks, skill catalog, tool declarations) is measured **once per turn**; each mutation then subtracts its own delta instead of re-measuring, so a turn costs one extra pass over the assembled input.

Current status: `createAttentionCompiler` and the two stages ship today, wired through `AgentConfig` / `AgentDefinition` and overlayed per run by `RunOptions`, and also available directly on `assembleProviderInput`. The field is opt-in everywhere: omitted, the request bytes are unchanged and no frontier is allocated.

Context blocks are measured, never repacked: the compiler sees whatever providers returned, tagged
however they tagged it. A memory fabric's provider is one such source — it contributes the same
`working-memory` / `semantic-memory` blocks `createMemory` resolves (see
[Memory fabric](memory-fabric.md)), and turning the compiler on or off changes their cost, never
their identity. The observational-memory ledger it protects stays the session's episodic record,
written (if at all) by that subpath's own workers; the compiler only ever mutates its history clone,
so neither OM nor a typed-notes layer is rewritten here. There is no layer id, handle, or per-source
quota in this seam.

## When to use it

Use it when a host runs long sessions with prompt caching and wants a deterministic, dependency-free gate that keeps a request inside the model input cap **without** reordering or deleting history:

- thinking-heavy agent loops where old reasoning blocks are pure attention waste;
- long tool loops where old grep/dump results crowd out recent context;
- hosts that want an explicit `AttentionBudgetError` signal (compact now) rather than silent eviction.

Do not use it as a replacement for compaction or for `applyContextBudget` eviction: compaction is the boundary operation that writes a summary, the compiler only rewrites what this turn sends.

## Inputs / request

### Enabling it

| Surface | Value | Meaning |
| --- | --- | --- |
| `AgentConfig.attentionCompiler` | `true \| AttentionCompilerOptions` | `true` uses the defaults below. Omitted (or `false`) keeps today's request bytes. |
| `AgentDefinition.attentionCompiler` | same | Copied onto the resolved config by `resolveAgentDefinition`; it changes nothing else about the definition. |
| `RunOptions.attentionCompiler` | `false \| true \| AttentionCompilerOptions` | `false` disables the compiler for that run, `true` is a no-op, and an object is a **narrowing overlay** on the agent setting. |

```ts
const agent = createAgent({ model, provider, attentionCompiler: true });
await agent.createSession({ id: "s" }).run("long task");
await session.run("cheap run", { attentionCompiler: { triggerRatio: 0.95, compactRatio: 0.99 } });
```

The agent setting is resolved with the run's model at run start, before any provider turn, so a malformed setting or a widening overlay fails the run immediately instead of on the turn that crosses the ratio:

- **Allowed in the overlay:** `triggerRatio` / `compactRatio` at or above the agent setting, `keepLast` / `thinkingKeepTurns` at or below it, and extra `excludeTools` (unioned with the agent list, never removed).
- **Rejected:** a lower gate ratio, more protected rows, and `maxInputTokens` / `reserveTokens` / `trigger` — cap inputs and fold axes are agent-config only, because moving either moves the gate itself. Raising `triggerRatio` at or above the agent's `compactRatio` needs `compactRatio` raised in the same overlay.
- **Enabling from a run is rejected:** a run may disable or relax the compiler, never switch it on where the agent config left it off.

The **sticky frontier is session-owned and created lazily** the first time an enabled run assembles a request: one `{ thinking, toolCallIds }` set pair per session, shared across runs, provider rounds, and branches, so a stub or strip made once stays applied even on a later under-ratio turn. A durable run with `persistSessionState: true` writes its bounded snapshot into the checkpoint and restores it on resume, so a resumed process keeps its stubs instead of re-deciding its first turn from the ratio.

`AttentionCompilerOptions` (all optional):

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `triggerRatio` | `number` | `0.75` | Fraction of `inputCap` that enables mutation; must be in `(0, 1)` (exclusive). The reference ratio the report carries and `compactRatio` is checked against. |
| `trigger` | `AttentionTriggerInput` | — | Fold axes (plan 086 T2). **Replaces** the `triggerRatio` axis when set; omitted keeps it alone, so behavior is unchanged. See [Trigger axes](#trigger-axes). |
| `compactRatio` | `number` | `0.9` | Where compaction should fire relative to the compiler; must exceed `triggerRatio`. |
| `thinkingKeepTurns` | `number` | `1` | Newest thinking-bearing assistant turns kept intact. |
| `keepLast` | `number` | `3` | Newest tool results kept full. |
| `excludeTools` | `readonly string[]` | `[]` | Tool names whose results are never stubbed, whatever the ratio. |
| `maxInputTokens` | `number` | — | Host cap; when set it wins over `model.limits.contextWindow`. |
| `reserveTokens` | `number` | `1024` | Output + next-turn headroom subtracted from the window. |

`AttentionCompilerContext`:

| Field | Type | Meaning |
| --- | --- | --- |
| `model` | `{ limits?: ModelLimits }` | Source of `contextWindow` / `maxOutputTokens` when `maxInputTokens` is absent. |
| `compactionTrigger` | `CompactionTrigger` | Optional: validated here so an unknown trigger `type` fails at create time, not on the first turn. An `input_ratio` trigger must exceed `triggerRatio`. |
| `runInputBudget` | `number \| null` | Cumulative run input budget the `run_input_ratio` axis folds against — pass the resolved `RunLimits.maxInputTokens`. `null` or omitted means the run declares no budget, so that axis falls back to the input cap. Distinct from `maxInputTokens`, which caps a single request. |

**Public surface.** `createAttentionCompiler(options?: AttentionCompilerOptions, context?)` is the factory; `AttentionCompilerOptions` carries the gate ratios, the optional `trigger` axes, sticky-stage tuning (`thinkingKeepTurns`, `keepLast`), `excludeTools`, and `reserveTokens`. `resolveInputCap(options?: AttentionInputCapOptions, model?)` is the cap resolver, `compileAttention(options: AttentionCompileOptions)` is the per-turn call `assembleProviderInput` makes (`AttentionCompileOptions` also carries `fold`, `frontier`, `redactor`, `signal`, `runInputTokens`, and the `turn`/`sessionId`/`runId` telemetry ids), and `createAttentionTruncationTrigger(options?: AttentionTruncationTriggerOptions)` builds the host-programmable compaction trigger. The frozen handle carries the normalized `trigger` axes, the resolved `runInputBudget`, and `durable`, so a caller can never resolve one and evaluate against another.

Input cap resolution: `maxInputTokens` when set, otherwise `contextWindow - (maxOutputTokens ?? 0) - reserveTokens`. Both `resolveInputCap(options?, model?)` and the compiler fail closed with a `TypeError` when neither source is present, when a declared limit is malformed, or when the computed cap is not positive.

Turn options, passed to `assembleProviderInput`:

| Field | Type | Meaning |
| --- | --- | --- |
| `attentionCompiler` | `AttentionCompilerOptions \| AttentionCompiler` | Raw options are validated for that call; a resolved handle reuses one validation. The session passes the run's resolved handle so a tuning typo fails before the first provider turn. |
| `attentionSticky` | `AttentionStickyFrontier` | `{ thinking, toolCallIds }` sets from `createAttentionStickyFrontier()`. The session supplies its own; a direct `assembleProviderInput` caller owns it, and omitting it makes each call mutate for its turn only. |
| `runInputTokens` | `number` | Run input tokens already charged by provider usage this run (default 0), so the cumulative `run_input_ratio` axis can project this turn onto the spend. The session passes the run limit counter. |
| `onAttentionReport` | `(report: AttentionReport) => void` | Called once per **mutated** turn, before `input_assembly` middleware; silent under the ratio. The session uses it to emit `attention_compiled`. |

`attentionCompiler` and `contextBudget` are **mutually exclusive** — a compiler-on turn that is still over throws `AttentionBudgetError` rather than evicting through the budget, so passing both fails closed with a `TypeError`.

### Trigger axes

`trigger` replaces `triggerRatio` as the gate (plan 086 T2). It takes one axis, one predicate function, or an array of them; an array is **any-of**, and the first axis that fires is the one attributed on the report.

| Kind | Fires when | Folds to | Fails closed? |
| --- | --- | --- | --- |
| `{ kind: "input_ratio", ratio }` | the assembled request reaches `ratio × inputCap` — the legacy `triggerRatio` axis | `ratio × inputCap` | yes |
| `{ kind: "run_input_ratio", ratio }` | `runInputTokens + estimatedInputTokens` reaches `ratio × runInputBudget`, so a run capped below the model window folds before the cap kills it | every eligible row (a cumulative gate has no per-request target) | **no** — the spend is already booked; folding only slows the counter, and the run limit owns the cap |
| `{ kind: "token_floor", tokens }` | the assembled request reaches `tokens` tokens, whatever the cap | `tokens` | yes |
| `{ kind: "predicate", shouldFold }` (or a bare function) | `shouldFold(state)` returns `true` | every eligible row | yes |

```ts
// The synapta Plan 118 shape: a 1M-window model under a 500k run input cap, where the legacy
// 0.75 × window gate (745k) could never open before the run died at its cap.
const compiler = createAttentionCompiler(
  { trigger: { kind: "run_input_ratio", ratio: 0.75 }, keepLast: 3 },
  { model, runInputBudget: 500_000 },
);

// Any-of, attributed in order: the floor is reported when both would fire.
createAttentionCompiler({ trigger: [{ kind: "token_floor", tokens: 120_000 }, { kind: "input_ratio", ratio: 0.9 }] }, { model });

// Host predicate: synchronous, evaluated at most twice per turn (once to decide, once to
// confirm the stages settled it) with a frozen `AttentionTriggerState`.
createAttentionCompiler(
  { trigger: (state) => state.estimatedInputTokens > 150_000 && state.turn > 5 },
  { model },
);
```

`AttentionTriggerState` is frozen and carries estimates only: `estimatedInputTokens` (this turn's assembled request), `inputCapTokens`, `runInputBudgetTokens` (absent when the run declares none), `runInputTokens` (charged spend so far), and `turn`. A predicate that returns a non-boolean — including a `Promise` from an `async` function — fails closed with a `TypeError` naming the option, rather than silently never firing.

Predicate axes run **host-supplied code**, under the same trust as `CompactionTrigger.custom`: the compiler passes host data in and takes a boolean out, never credentials or payloads. Keep them synchronous and side-effect free; they see token estimates and ids, never message text.

Rules that hold for every axis:

- **Config-time validation.** Unknown kinds, a ratio outside `(0, 1)`, a non-positive `token_floor.tokens`, an empty array, and a predicate that is not a function all throw a `TypeError` naming the option (`attentionCompiler.trigger`, or `attentionCompiler.trigger[1]` inside an array).
- **Gate is agent-config only.** A run overlay may not set `trigger`, `maxInputTokens`, or `reserveTokens` — the gate and the cap move together, so moving either belongs in the agent config.
- **One evaluation per turn.** The axes are evaluated at turn start against the measured request and once more after the stages. The per-row loop then compares numbers, so a predicate costs two calls a turn no matter how many rows are eligible.
- **Sticky and monotonic as ever.** An axis only decides *whether* to fold; the stages still stop as soon as a target is reached, and mutations stay applied on later under-gate turns.
- **`run_input_ratio` needs its budget.** With `compactAfterTokens`-style run limits declared (`RunLimits.maxInputTokens`, which defaults to `40_000` and kills the run cumulatively), pass the resolved value as `runInputBudget`. Without one the axis is the per-request `input_ratio` comparison.
- **`triggerRatio` stays the reference.** Omitted alongside `trigger`, it takes the first `input_ratio` axis's ratio so `compactRatio` and the report still describe the real fold point; with no `input_ratio` axis it keeps the default `0.75` as the compaction reference.

Runnable end to end: [`examples/attention-budget-axes.ts`](../examples/attention-budget-axes.ts) runs the scenario both axes exist for — a 1M window, a 500k run budget, 24 provider turns. The window axis would need 743k tokens and never gets near (`maxUsed` ≈ 7k, so it never fires); cumulative spend crosses 1 % of the budget on turn 6, the gate opens there, and the run finishes having spent 36k of its 500k with the newest 2 rows raw and every older body a stub. `src/__tests__/attention-compiler-budget.test.ts` asserts the same numbers, including that the first fold could only be explained by carried-over spend.

## Outputs / response / events

`createAttentionCompiler` returns an `AttentionCompiler`: `inputCap`, `reserveTokens`, `triggerRatio`, `compactRatio`, `thinkingKeepTurns`, `keepLast`, and a frozen, de-duplicated `excludeTools`. It performs no I/O and calls no provider.

`compileAttention` always returns an `AttentionReport` beside `mutated`; under the ratio `mutated` is `false`, the same groups object comes back, and nothing is emitted:

| Field | Type | Meaning |
| --- | --- | --- |
| `used` | `number` | Estimated tokens measured before this turn's mutation. |
| `usedAfter` | `number` | Estimated tokens of the same request after the mutation, so `used` → `usedAfter` is the per-turn cost curve. |
| `inputCap` | `number` | Resolved cap the ratio was compared against. |
| `triggerRatio` | `number` | Configured ratio — the reference axis, whether or not a `trigger` replaced the gate. |
| `firedAxis` | `AttentionTriggerKind?` | Axis that opened the gate on this turn, in configured order; absent on an under-gate turn. Plan 087 attribution reads this. |
| `droppedThinkingTurns` | `number` | Thinking turns absent from this request — rows re-applied from the sticky frontier count again. |
| `stubbedToolResults` | `number` | Tool results stubbed in this request — re-applied rows count again. |
| `stubbedBytes` | `number` | Payload bytes those stubs took out of the request (message bytes minus the stub header). |
| `newFoldedBodies` | `number` | Folded bodies this turn added to the ledger: the `summarize` calls the cache saved, and the durable-fold checkpoint signal. `0` on a turn that only re-applied stored bodies. |
| `truncated` | `boolean` | `true` when the gate stopped with eligible rows left, so the sticky frontier is partial. |
| `runId` / `sessionId` | `string?` | Owning run/session when known. |

Telemetry: a session emits **one `attention_compiled` per mutated turn** and nothing on an under-ratio turn or when the compiler is off. The payload is counts only — `sessionId`, `runId`, `used`, `usedAfter`, `inputCap`, `triggerRatio`, `droppedThinkingTurns`, `stubbedToolResults`, `stubbedBytes`, `truncated` — never message text or stub bodies, so it is safe in a redacted ledger and folds into an `attention` step of the [execution timeline](execution-timeline.md). A run that fails closed raises `AttentionBudgetError` instead, which surfaces as the run's `error` event. Direct `assembleProviderInput` callers get the same data through `onAttentionReport`.

Stage order once the gate opens (C4):

1. **Thinking** — strip every `thinking` block from assistant turns except the newest `thinkingKeepTurns`, oldest turn first.
2. **Tool results** — stub the oldest tool-result rows beyond the newest `keepLast`, oldest first, across history and the in-flight results of the current turn.

Each stage stops as soon as the estimate is back under `triggerRatio`; rows left eligible make `AttentionReport.truncated` `true`. A stub keeps the call identity and drops the payload:

```text
Tool result read_file [call_1]: omitted 41_982 bytes (sha256 3f9a1c2b4d5e6f70a1b2c3d4e5f6a7b8)
```

Never stubbed: rows named in `excludeTools`, tool **errors**, results stamped as a decision/approval payload (`approval`, `approvalId`, `prismApproval`, `decision`, `decisions`, `pendingDecisions`, `elicitation` metadata), rows the host fold's own age/byte gates exclude, and any row whose stub would cost more than the payload it replaces. When `toolResultFold.summarize` is configured, that function produces the stub body for the rows the compiler picked (capped by its `maxSummaryBytes`); otherwise the deterministic digest above is used.

`compileAttention({ compiler, groups, context?, skills?, tools?, fold?, frontier?, attentionFold?, redactor?, signal?, turn?, runInputTokens?, sessionId?, runId? })` is what `assembleProviderInput` calls; it returns `{ groups, mutated, report }`. Under the ratio it returns the **same groups object** it was given; when it mutates it returns new `history` / `toolResults` arrays and never writes into the caller's arrays.

Errors:

| Error | Code | Raised when |
| --- | --- | --- |
| `AttentionBudgetError` | `attention_budget_exceeded` | Still over `triggerRatio` after every eligible stage — host should compact, not delete. |
| `TypeError` | — | Invalid option, unknown compaction trigger `type`, or an unresolvable input cap. Use `isAttentionBudgetError` to narrow. |

## Request/response example

```json
{
  "triggerRatio": 0.75,
  "thinkingKeepTurns": 1,
  "keepLast": 3,
  "excludeTools": ["submit_payment"],
  "reserveTokens": 1024,
  "durable": false,
  "compaction": {
    "trigger": {
      "type": "custom",
      "shouldCompact": "host function — sees sessionId, entryCount, estimatedInputTokens, inputCapTokens"
    }
  }
}
```

## Implementation example

```ts
import { createAttentionCompiler, resolveInputCap } from "@arnilo/prism";

const compiler = createAttentionCompiler(
  {
    triggerRatio: 0.75,
    thinkingKeepTurns: 1,
    keepLast: 3,
    excludeTools: ["submit_payment"],
    reserveTokens: 1024,
  },
  { model: { limits: { contextWindow: 200_000, maxOutputTokens: 8_192 } } },
);

compiler.inputCap; // 200000 - 8192 - 1024

// Host-programmable compact-when, validated at create:
createAttentionCompiler(
  { triggerRatio: 0.75 },
  { model: { limits: { contextWindow: 200_000 } }, compactionTrigger: { type: "input_ratio", ratio: 0.9 } },
);

// Shared cap helper for hosts that only need the number:
resolveInputCap({ reserveTokens: 1024 }, { limits: { contextWindow: 200_000, maxOutputTokens: 8_192 } });
```

Run it through assembly — this is the raw seam; sessions do it for you. Pass the same frontier on every turn so an over-ratio turn stays shrunk afterwards (the session keeps one per session).

```ts
import { assembleProviderInput, createAttentionStickyFrontier } from "@arnilo/prism";

const attentionSticky = createAttentionStickyFrontier();

const request = await assembleProviderInput({
  model,
  input: "continue",
  history,           // session history snapshot; never mutated
  tools,
  turn,
  attentionSticky,
  attentionCompiler: {
    triggerRatio: 0.75,
    thinkingKeepTurns: 1,
    keepLast: 3,
    excludeTools: ["submit_payment"],
  },
});

// Under the ratio: identical to the same call without `attentionCompiler`.
// Over the ratio: old `thinking` blocks are gone, old tool bodies are stubs,
// and the session store still holds every original payload.
```

## Compact-when: where the compiler hands off

The compiler never compacts. It mutates a clone of the request for one turn, and `session.compact()` keeps its task-boundary rule (it throws while a run is in flight). Compaction stays where it was: `CompactionOptions.trigger`, `session.compact()`, or the observational-memory attach loop.

What the compiler does contribute is the *number*. `session.autoCompact()` decides an `input_ratio` trigger with `resolveInputCap` — the same helper that resolves the compiler's `inputCap` — and `AttentionCompilerOptions.compactRatio` / `createAttentionCompiler(options, { compactionTrigger })` exist so a host can express "shrink at 0.75, compact at 0.9" with one validated pair: a compaction `input_ratio` at or below the compiler's `triggerRatio` is rejected, because the compiler has already tried the cheap stages at that point.

```ts
const agent = createAgent({
  model,
  provider,
  attentionCompiler: { triggerRatio: 0.75, keepLast: 3 },
  compaction: { trigger: { type: "input_ratio", ratio: 0.9 } },
});
```

Ordering per run: auto-compaction is evaluated once, after the run input is appended and before provider input assembly; the compiler then runs inside assembly on whatever survived. After a compaction the next request is the frozen prefix plus the fresh summary plus the recent tail, and the compiler treats that summary and prefix as untouchable — it may still strip thinking or stub tool results in the **kept tail** when the estimate is over the ratio again. When the observational-memory strategy wrote that summary while work scopes were open, the summary is already the **projected** working set (leaf scope + ancestors), not the full ledger.

### Acting on `truncated`

`truncated: true` says the gate ran out of *eligible* rows: stubs cannot hold the request under the ratio, so the honest answer is a new prefix at the next task boundary rather than a silent eviction. `createAttentionTruncationTrigger` turns that signal into a drop-in trigger — feed it every `attention_compiled` event and hand `trigger` to the same `CompactionOptions.trigger` seam:

```ts
const truncation = createAttentionTruncationTrigger({ threshold: 2 }); // consecutive truncated turns
const agent = createAgent({
  model,
  provider,
  attentionCompiler: true,
  compaction: { trigger: truncation.trigger },
});
session.subscribe((event) => {
  if (event.type === "attention_compiled") truncation.observe(event);
});
```

It fires **once per armed streak** at the next compaction decision (auto-compact before the next `run()`, or a host attach loop's post-run gate), and a mutated turn that was *not* truncated clears the streak because the pressure was relieved. `streak()` reads the current count and `reset()` clears an armed streak (for instance after a host-initiated `session.compact()`). The threshold is validated at create, so a typo fails at config time.

See [Compaction and retry policies](compaction-and-retry.md) for the trigger union and its fail-closed rules.

## Extension and configuration notes

- `excludeTools` is fail closed: entries are validated as non-empty bounded strings, de-duplicated, and frozen; a named tool is never stubbed even when the request stays over the ratio.
- The compiler never orchestrates other levers: `toolResultFold.summarize` still wins for fold-eligible rows when a host supplies it, `applyContextBudget` keeps working unchanged for compiler-off agents, and compaction stays a task-boundary operation (`session.compact()` still throws while a run is in flight).
- Sticky means sticky: a stripped thinking turn is never restored and a stubbed call id is never un-stubbed, even on a later under-ratio turn — restoring either would rewrite the cached prefix. Pass no `attentionSticky` for one-shot assemblies.
- The frontier is bounded (256 thinking keys, 256 tool-call ids, newest kept) and lives on the session, so it survives turns and runs. A durable run with `persistSessionState: true`, or any run with `durable: true`, also writes it into the checkpoint (`sessionState.attentionSticky`) and restores it on resume, so a resumed run keeps its stubs instead of re-deciding its first turn from the ratio; a malformed or hand-edited frontier is dropped entry by entry, never fatal to a resume.
- A compiler-on turn assembles from the default message groups (instructions, summaries, history, input, attachments, tool results) exactly like a `contextBudget` turn, so a custom `inputBuilder` is not consulted while the compiler is on.
- Compaction timing is programmable per agent through `CompactionOptions.trigger` (`threshold_entries` | `input_ratio` | `custom`); omitting it keeps today's `thresholdEntries` gate. `assertCompactionTrigger(trigger)` validates a trigger independently of the compiler.
- The gate is opt-in per agent/run; omit the option for current assembly bytes.

### Durable folding

`durable: true` puts the fold state on disk (plan 086 T3), so a run that dies mid-investigation resumes
with the rows it had already folded instead of re-deciding them from the ratio.

```ts
const agent = createAgent({
  // ...
  attentionCompiler: {
    trigger: { kind: "run_input_ratio", ratio: 0.75 },
    keepLast: 2,
    durable: true,
  },
  runState: { checkpoints, definitionRevision: "1" }, // the write target; `persistSessionState` not required
  toolResultFold: { summarize: hostSummarize },        // optional: bodies become durable too
});

// After a crash the worker resumes where the fold left off:
await resumeAgentRun(agent, { runId, sessionId }, { decision: "continue", expectedVersion }, { checkpoints, definitionRevision: "1" });
```

- **One write per fold, never per turn.** The checkpoint is written after the turn's request is assembled and before the provider sees it, only on turns that added folded bodies. A turn that re-applies what the ledger already holds writes nothing.
- **The fold ledger.** Each folded body is stored once, keyed by tool call id (newest 64, 4 KiB each), and re-applied on every later turn: the host `summarize` runs once per row instead of once per turn, and a sticky row stays byte-identical for the provider cache. Bodies are already redacted and capped by the fold that produced them.
- **Independent of `persistSessionState`.** That option governs skill and tool-activation state. `durable` is its own opt-in for the fold ledger plus its sticky frontier (`sessionState.attentionFold` / `attentionSticky`), because a resumed run needs both: the frontier decides *what* stays folded, the ledger decides *what body* it was folded to.
- **Restore is fault-tolerant.** A malformed ledger shape starts from an empty ledger, and a malformed entry is dropped one by one — the row simply re-folds on the next over-gate turn. A hand-edited checkpoint never blocks a resume.
- **Sizing.** Off by default. On, it costs one checkpoint write per fold turn plus `bodies × (body ≤ maxSummaryBytes)` bytes in the run state (default cap: 64 bodies), and it makes the fold the run's first crash-recovery point when `checkpointPolicy` is `"decision"`.
- **Requires a durable run.** `durable: true` without `runState` (a checkpoint store) throws `AgentRunStateError` at run start, before the first provider turn. A run overlay may not set `durable`.
- **Still projection-only.** Durability changes *where the projection is remembered*, not what the store holds: the session store, observational-memory ledger, and semantic stores keep every original payload for recall, branching, and audit.

## Security and performance notes

- Validation is synchronous with no provider I/O, and the returned handle plus `excludeTools` are frozen.
- Reports and trigger contexts carry ids, counts, and token estimates only — never message text, tool payloads, or secrets.
- Stub text is `name` + `toolCallId` + byte count + a SHA-256 digest of the already-redacted payload: deterministic, model-free, and impossible to invert back into the payload. The digest is taken over redactor output when a redactor is configured, and the assembled request is redacted again at the provider edge.
- Projection-only, and **a stub is not a delete**: the session store, observational-memory ledger, and semantic stores are never rewritten, so recall, branching, and post-hoc audit still see every original payload. Observational-memory context blocks are never dropped, stubbed, or reordered.
- Compaction stays a task boundary: the compiler never writes the store and never triggers compaction mid-run (`session.compact()` still refuses while a run is active), and it never rewrites observational memory.
- Telemetry stays payload-free: the `attention_compiled` event carries `used`, `usedAfter`, `inputCap`, `triggerRatio`, `droppedThinkingTurns`, `stubbedToolResults`, `stubbedBytes`, and `truncated` only.
- `applyContextBudget` is not the compiler's last resort — overflowing after all eligible stages throws `AttentionBudgetError` so the frozen prefix (system instructions, `AGENTS.md`, skill catalog, tool declarations) cannot be silently evicted.
- Measured on the hermetic fixture in [`docs/_evidence/phase74-attention-measurements.md`](_evidence/phase74-attention-measurements.md): 63.7 % fewer input tokens, one cache bust on the turn the gate trips (compiler-off is append-only), and a volatile provider block that re-sends everything behind it every turn — which is why pinning a block stays a host recipe (`resolve` once per session) rather than compiler behavior. Regenerate with `node scripts/benchmark.mjs --scenario attention-compiler`.

## Related APIs

- [`assembleProviderInput`](input-and-prompt-assembly.md): the compose path the compiler pre-passes when enabled.
- [`toolResultFold`](input-and-prompt-assembly.md): host summarizer that wins over the deterministic stub for eligible rows.
- [`CompactionOptions`](compaction-and-retry.md): `trigger` is the host compact-when seam; `thresholdEntries` remains the default gate. For fold state that outlives a crash, see [Durable folding](#durable-folding).
- [`observational-memory`](compaction-observational-memory.md): host `shouldCompact` / trigger overrides `compactAfterTokens` for post-run compaction.
- [`provider caching`](provider-caching.md): why mutations are monotonic and in-place.
- [`AttentionReport` measurements](_evidence/phase74-attention-measurements.md): the hermetic fixture behind the savings, cache, resume, and truncation numbers.
- Example: [`examples/attention-budget-axes.ts`](../examples/attention-budget-axes.ts) — budget-capped long run where only the cumulative axis can open the gate.
- [Memory fabric](memory-fabric.md): a context source whose blocks are measured like any other (`working-memory` / `semantic-memory` tags, no layer id).
- [`thinking and reasoning`](thinking-and-reasoning.md): the `thinking` blocks the first stage strips.
