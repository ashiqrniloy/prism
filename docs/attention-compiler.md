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
- **Rejected:** a lower gate ratio, more protected rows, and `maxInputTokens` / `reserveTokens` — cap inputs are agent-config only, because moving the cap moves the gate itself. Raising `triggerRatio` at or above the agent's `compactRatio` needs `compactRatio` raised in the same overlay.
- **Enabling from a run is rejected:** a run may disable or relax the compiler, never switch it on where the agent config left it off.

The **sticky frontier is session-owned and created lazily** the first time an enabled run assembles a request: one `{ thinking, toolCallIds }` set pair per session, shared across runs, provider rounds, and branches, so a stub or strip made once stays applied even on a later under-ratio turn. It lives in memory only — a resumed process simply re-decides from the ratio it sees.

`AttentionCompilerOptions` (all optional):

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `triggerRatio` | `number` | `0.75` | Fraction of `inputCap` that enables mutation; must be in `(0, 1)` (exclusive). |
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

**Public surface.** `createAttentionCompiler(options?: AttentionCompilerOptions, context?)` is the factory; `AttentionCompilerOptions` carries the gate ratios, sticky-stage tuning (`thinkingKeepTurns`, `keepLast`), `excludeTools`, and `reserveTokens`. `resolveInputCap(options?: AttentionInputCapOptions, model?)` is the cap resolver, `compileAttention(options: AttentionCompileOptions)` is the per-turn call `assembleProviderInput` makes (`AttentionCompileOptions` also carries `fold`, `frontier`, `redactor`, `signal`, and the `turn`/`sessionId`/`runId` telemetry ids), and `createAttentionTruncationTrigger(options?: AttentionTruncationTriggerOptions)` builds the host-programmable compaction trigger.

Input cap resolution: `maxInputTokens` when set, otherwise `contextWindow - (maxOutputTokens ?? 0) - reserveTokens`. Both `resolveInputCap(options?, model?)` and the compiler fail closed with a `TypeError` when neither source is present, when a declared limit is malformed, or when the computed cap is not positive.

Turn options, passed to `assembleProviderInput`:

| Field | Type | Meaning |
| --- | --- | --- |
| `attentionCompiler` | `AttentionCompilerOptions \| AttentionCompiler` | Raw options are validated for that call; a resolved handle reuses one validation. The session passes the run's resolved handle so a tuning typo fails before the first provider turn. |
| `attentionSticky` | `AttentionStickyFrontier` | `{ thinking, toolCallIds }` sets from `createAttentionStickyFrontier()`. The session supplies its own; a direct `assembleProviderInput` caller owns it, and omitting it makes each call mutate for its turn only. |
| `onAttentionReport` | `(report: AttentionReport) => void` | Called once per **mutated** turn, before `input_assembly` middleware; silent under the ratio. The session uses it to emit `attention_compiled`. |

`attentionCompiler` and `contextBudget` are **mutually exclusive** — a compiler-on turn that is still over throws `AttentionBudgetError` rather than evicting through the budget, so passing both fails closed with a `TypeError`.

## Outputs / response / events

`createAttentionCompiler` returns an `AttentionCompiler`: `inputCap`, `reserveTokens`, `triggerRatio`, `compactRatio`, `thinkingKeepTurns`, `keepLast`, and a frozen, de-duplicated `excludeTools`. It performs no I/O and calls no provider.

`compileAttention` always returns an `AttentionReport` beside `mutated`; under the ratio `mutated` is `false`, the same groups object comes back, and nothing is emitted:

| Field | Type | Meaning |
| --- | --- | --- |
| `used` | `number` | Estimated tokens measured before this turn's mutation. |
| `usedAfter` | `number` | Estimated tokens of the same request after the mutation, so `used` → `usedAfter` is the per-turn cost curve. |
| `inputCap` | `number` | Resolved cap the ratio was compared against. |
| `triggerRatio` | `number` | Configured ratio. |
| `droppedThinkingTurns` | `number` | Thinking turns absent from this request — rows re-applied from the sticky frontier count again. |
| `stubbedToolResults` | `number` | Tool results stubbed in this request — re-applied rows count again. |
| `stubbedBytes` | `number` | Payload bytes those stubs took out of the request (message bytes minus the stub header). |
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

`compileAttention({ compiler, groups, context?, skills?, tools?, fold?, frontier?, redactor?, signal?, turn?, sessionId?, runId? })` is what `assembleProviderInput` calls; it returns `{ groups, mutated, report }`. Under the ratio it returns the **same groups object** it was given; when it mutates it returns new `history` / `toolResults` arrays and never writes into the caller's arrays.

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
- The frontier is bounded (256 thinking keys, 256 tool-call ids, newest kept) and lives on the session, so it survives turns and runs. A durable run with `persistSessionState: true` also writes it into the checkpoint (`sessionState.attentionSticky`) and restores it on resume, so a resumed run keeps its stubs instead of re-deciding its first turn from the ratio; a malformed or hand-edited frontier is dropped entry by entry, never fatal to a resume.
- A compiler-on turn assembles from the default message groups (instructions, summaries, history, input, attachments, tool results) exactly like a `contextBudget` turn, so a custom `inputBuilder` is not consulted while the compiler is on.
- Compaction timing is programmable per agent through `CompactionOptions.trigger` (`threshold_entries` | `input_ratio` | `custom`); omitting it keeps today's `thresholdEntries` gate. `assertCompactionTrigger(trigger)` validates a trigger independently of the compiler.
- The gate is opt-in per agent/run; omit the option for current assembly bytes.

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
- [`CompactionOptions`](compaction-and-retry.md): `trigger` is the host compact-when seam; `thresholdEntries` remains the default gate.
- [`observational-memory`](compaction-observational-memory.md): host `shouldCompact` / trigger overrides `compactAfterTokens` for post-run compaction.
- [`provider caching`](provider-caching.md): why mutations are monotonic and in-place.
- [`AttentionReport` measurements](_evidence/phase74-attention-measurements.md): the hermetic fixture behind the savings, cache, resume, and truncation numbers.
- [Memory fabric](memory-fabric.md): a context source whose blocks are measured like any other (`working-memory` / `semantic-memory` tags, no layer id).
- [`thinking and reasoning`](thinking-and-reasoning.md): the `thinking` blocks the first stage strips.
