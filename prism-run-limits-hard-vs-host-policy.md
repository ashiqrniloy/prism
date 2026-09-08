# Feature request: split run-limit HARD caps (process safety) from host policy

- **From:** Clay (host of `@arnilo/prism` 0.5.3)
- **Affects:** `@arnilo/prism` `src/run-limits.ts` (`DEFAULT_RUN_LIMITS`, `HARD_RUN_LIMITS`, `HARD_MAX_RUN_COST`, `validateLimits`)
- **Type:** API / policy design, not a Clay-side workaround
- **Ask:** stop treating product-sized numbers as `TypeError` ceilings so a multi-host package can serve chat *and* long autonomous coding

## Summary

Prism today has the right *shape* of run limits (layered counters, `RunLimitError`, optional `maxCost`, `AbortSignal`) and the wrong *ownership*.

`validateLimits` rejects any host-authored value above `HARD_RUN_LIMITS` / `HARD_MAX_RUN_COST` with `TypeError`. Those HARD numbers are **product policy** (64 turns, 30 minutes, 1M cumulative input tokens), not **process safety**. A package that “should support all possible host needs” cannot TypeError a coding host that needs a 3-hour, 200-turn, multi-million-token run.

Ask: keep conservative **defaults** for unconfigured `createAgent()`, keep a true **HARD** only where Node/JSON can OOM, and let the host **raise or disable** every other axis.

## Current behavior (0.5.3)

```ts
// src/run-limits.ts
DEFAULT_RUN_LIMITS = {
  maxTurns: 16,
  maxProviderAttempts: 24,
  maxToolRounds: 8,
  maxToolCalls: 32,
  maxWallTimeMs: 120_000,
  maxRequestBytes: 8 * 1024 * 1024,
  maxResponseBytes: 8 * 1024 * 1024,
  maxInputTokens: 40_000,
  maxOutputTokens: 10_000,
  maxTotalTokens: 50_000,
}

HARD_MAX_RUN_COST = 10_000

HARD_RUN_LIMITS = {
  maxTurns: 64,
  maxProviderAttempts: 256,
  maxToolRounds: 64,
  maxToolCalls: 256,
  maxWallTimeMs: 30 * 60_000,
  maxRequestBytes: 64 * 1024 * 1024,
  maxResponseBytes: 64 * 1024 * 1024,
  maxInputTokens: 1_000_000,
  maxOutputTokens: 250_000,
  maxTotalTokens: 1_000_000,
}
```

`validateLimits` (`src/run-limits.ts` ~L96–106):

- integer axes: `1 ≤ n ≤ HARD_RUN_LIMITS[name]` else `TypeError`
- `maxCost.amount`: `0 ≤ n ≤ HARD_MAX_RUN_COST` else `TypeError`

Omitted keys fill from `DEFAULT_RUN_LIMITS` in `resolveRunLimits`. There is **no** “no cap on this axis” value.

`RunLimitTracker.recordUsage` charges `maxInputTokens` / `maxOutputTokens` / `maxTotalTokens` with **cumulative billed usage** across the run (`usage.inputTokens` etc.), not the live context window. That distinction matters (below).

## Why this blocks hosts

Clay is a coding-agent host. After raising `maxInputTokens` toward Prism HARD (1M), long runs still die with `Run limit exceeded: maxInputTokens`. That is expected under the current contract — and it is the contract that is wrong for this class of job.

Concrete mismatches:

1. **Cumulative tokens ≠ context window.** 40 turns × 80k input/turn ≈ 3.2M billed input. HARD 1M is below a normal multi-file coding session. Per-request window protection already exists separately (`contextBudget`, `ceil(chars/4)` assembler). Using the same 1M number for both jobs is a category error.
2. **`maxProviderAttempts` undercuts turns.** DEFAULT 24 attempts vs 16 turns is fine; Clay currently sets 32 turns and leaves attempts at 24, so attempts fire first. HARD 256 vs HARD 64 turns is the same inversion at the ceiling. Attempts are retries + generates, not a second turn cap.
3. **Wall 30 min is an SLA, not physics.** Devin meters ~15 min/ACU and runs multi-hour jobs; Codex cloud jobs run 1–30+ min; Claude Agent SDK documents multi-dozen-turn coding loops. Overnight / “fix the repo” agents exist. A library must not `TypeError` `maxWallTimeMs: 4 * 60 * 60_000`.
4. **64 turns / 64 tool rounds / 256 tool calls** are coding-session sizes, not DoS bounds. A repo-wide read/grep/edit loop blows 256 calls without being stuck.
5. **`$10k maxCost` is the one HARD that is actually generous — and it is already optional.** That is the right *shape* (host FinOps). The other axes should follow it.

Request/response **byte** HARD (64MB) *is* process safety: JSON.parse of a giant provider frame can OOM the Node process. Keep that family.

## Industry (what other packages do)

| Runtime | Loop cap | Host can disable / raise past a product HARD? | Economic cap |
|---|---|---|---|
| **Claude Agent SDK** | `maxTurns` default **No limit** | yes (unset = run until model stops) | `maxBudgetUsd`, also **No limit**. Docs: *“Without limits, the loop runs until Claude finishes on its own… Setting a budget is a good default for production.”* |
| **OpenAI Agents SDK** | `max_turns` (default ~10) | **`max_turns=None` disables** | host / gateway $ |
| **Vercel AI SDK** | `ToolLoopAgent` `stopWhen: stepCountIs(20)` | raise, or `isLoopFinished()` (docs warn unbounded) | host |
| **LangGraph** | `recursion_limit` 25 | host raises per invoke | host |
| **CrewAI** | `max_iter` 25 | per-agent | host |
| **Prism 0.5.3** | DEFAULT 16/8/32 + 120s | raise **only up to HARD**, then `TypeError` | optional `maxCost`, HARD $10k |

Consensus:

- **Defaults** protect the unconfigured caller (OWASP LLM10 Unbounded Consumption). Keep them.
- **Host policy** is raise-or-disable. Product HARD as `TypeError` is the unusual, hostile part.
- Production stop condition is an **OR of independent predicates**, checked **before** the next side effect: turns, wall, tokens, **USD**, tool calls, no-progress, cancel.
- Caps are **backstops**. Healthy runs end on model `end_turn`. If HARD fires often, either the cap is wrong or the agent is stuck — **no-progress** is the fix, not 10× HARD.
- Turn caps ≠ authorization (OWASP LLM06 Excessive Agency). Tool permission stays a separate layer.

Task-class envelopes (not one number for all hosts): chat ~8–12 turns; research ~20–40; coding ~50–200+; overnight = hours. Defaults serve the median new user. HARD must not forbid the 95th-percentile coding host.

## Proposed split

### A. True HARD — process integrity only

Uncancellable library ceilings. Job: keep Node alive, not dictate product SLAs.

| Cap | Keep as HARD? | Suggested value |
|---|---|---|
| `maxRequestBytes` | **yes** | keep 64MB; 256MB if multimodal hosts dump images into JSON |
| `maxResponseBytes` | **yes** | same |
| integer validity | **yes** | positive safe integer (or `null`, see C) |
| `maxCost` amount | no product HARD, or keep $10k as a *very* high sanity fence | already optional |
| turns / attempts / tool rounds / tool calls / wall / cumulative tokens | **no** | host policy (C) |

Optional last-resort fork-bomb if a host omits *everything* and also disables defaults: e.g. 1e6 turns. That is not 64. Prefer not to add it if C is implemented (`null` is explicit).

### B. Keep DEFAULT as-is (or close)

`DEFAULT_RUN_LIMITS` is a good accidental-`createAgent()` fence. Order of magnitude matches Vercel-20 / LangGraph-25 / OpenAI-10. Chat hosts can keep it. Coding hosts override.

Do **not** raise defaults to coding-session size. That would surprise every new host with a $47k loop (LLM10).

### C. Host policy = raise without product HARD, or disable

Pick one public contract (preferred first):

**Preferred (Claude-like + explicit disable):**

- omitted key → `DEFAULT_RUN_LIMITS`
- `null` → **no cap on that axis**
- number → that number (positive safe integer); **no product HARD** except A (bytes)

**Acceptable (OpenAI-like):** keep DEFAULT, allow `null` to disable. Same runtime.

Either way: **delete product HARD** on turns, provider attempts, tool rounds/calls, wall, cumulative tokens. `$10k` can stay as a sanity fence or drop; `maxCost` remains optional.

JSON-RPC / Clay note: `null` serializes; `Infinity` does not. Prefer `null`.

### D. Optional host predicates (not replacements, not on by default)

Do **not** replace counters with clever scores as the library default (information-gain / embedding stagnation = false positives on pagination and `npm test` retries).

Add as **optional, off by default**:

| Predicate | Why | Notes |
|---|---|---|
| **`maxCost`** (already exists) | Honest $; industry #1 production cap. Tokens lie across models and cache. | Keep. Document as the recommended production envelope. |
| **Repeated tool fingerprint** | Stops stuck loops at turn 3, not turn 64. Hash `(toolName, canonicalArgs)` and optionally result so polling endpoints with changing results do not false-positive. Halt after N consecutive identical tuples (host sets N, suggest 3). | Follow-up is fine; do not block C on this. |
| **`contextBudget`** (already exists) | Per-request assembly, not cumulative billing. | Keep off unless the host wants drop-history. Document vs `maxInputTokens`. |
| **Per-class tool quota** (mutating vs read) | Side-effect radius. | Host / later; not core HARD. |
| **`AbortSignal`** (already exists) | Kill switch. | Keep. Wall-unbounded runs still need cancel. |

Layered OR stays. Check budget **before** the next provider/tool call.

### E. Coupled counters and token semantics

1. **`maxProviderAttempts` must not undercut `maxTurns`.** Treat it as retry budget (`turns + per-generate retries`) or require `attempts ≥ turns` when both are set. Do not keep it as a tighter independent HARD.
2. **Document `maxInputTokens` / `maxOutputTokens` / `maxTotalTokens` as Σ billed usage across the run**, not the model window. Window protection = `contextBudget`. Cumulative protection = these counters or `maxCost`.
3. **Wall:** DEFAULT 120s stays. Hosts set 30–120 min or `null` + `AbortSignal`. No 30 min `TypeError`.

## Suggested API sketch

```ts
export interface RunLimits {
  readonly maxTurns?: number | null;
  readonly maxProviderAttempts?: number | null;
  readonly maxToolRounds?: number | null;
  readonly maxToolCalls?: number | null;
  readonly maxWallTimeMs?: number | null;
  readonly maxRequestBytes?: number;      // still HARD-capped
  readonly maxResponseBytes?: number;     // still HARD-capped
  readonly maxInputTokens?: number | null;
  readonly maxOutputTokens?: number | null;
  readonly maxTotalTokens?: number | null;
  readonly maxCost?: { readonly amount: number; readonly currency: string };
}

// validateLimits:
//   null  → store as no-cap (tracker skips that axis)
//   number → safe integer ≥ 1
//            bytes: also ≤ HARD_RUN_LIMITS.maxRequestBytes / maxResponseBytes
//            other axes: no product HARD
//   undefined → inherit DEFAULT at resolve time
```

`RunLimitTracker.charge` / `recordUsage`: if the resolved cap for an axis is `null`, skip `exceed` for that axis. Wall timer: do not arm if `maxWallTimeMs` is `null`.

`HARD_RUN_LIMITS` public export: shrink to bytes-only, or keep the object but document remaining keys as **non-binding** (worse — prefer shrink + changelog).

## Tests (minimum)

- omitted keys still resolve to current DEFAULT
- `maxTurns: null` (and friends) does not `TypeError`; a 100-turn run does not throw `RunLimitError` on turns
- `maxTurns: 10_000` does not `TypeError`
- `maxInputTokens: 5_000_000` does not `TypeError`; cumulative charge still throws `RunLimitError` when *that* cap is exceeded
- `maxRequestBytes` / `maxResponseBytes` above 64MB still `TypeError`
- `maxWallTimeMs: 4 * 60 * 60_000` does not `TypeError`; `null` does not arm the timer
- `maxProviderAttempts` default still 24 when omitted; when host sets `maxTurns: 64` and omits attempts, attempts must not fire at 24 (E)
- existing `RunLimitError` tests for DEFAULT-sized caps still pass

## Compatibility

- **Semver:** this is a behavior change for hosts that *relied* on TypeError above HARD (unlikely). Hosts that pass values inside HARD are unchanged. Treat as **minor** if HARD rejection was never a documented feature, **major** if it was.
- Changelog: “product HARD removed except request/response bytes; `null` disables an axis; DEFAULT unchanged.”
- Clay will set a coding envelope itself (`agent.setRunOptions` + session `limits`). This FR is so that envelope is not illegal.

## Out of scope / what not to do

- Raise 64→128 / 30 min→2 h and call it done. Next host still hits `TypeError`.
- Raise DEFAULT to coding-session size. LLM10.
- Make `ceil(chars/4)` the run cap. Assembler estimate ≠ billing ≠ wall ≠ tools.
- One envelope for chat and overnight coding inside Prism core.
- Trust a system prompt (“stop after 10 steps”).
- Drop all defaults. Unconfigured `createAgent()` must not fork-bomb.
- Block this FR on the fingerprint feature (D). Ship C first.

## Fallback if `null` is rejected

If Prism will not allow unbounded axes, set sanity HARD as DoS theater, not product:

| Cap | Today HARD | Sanity HARD |
|---|---|---|
| turns / tool rounds | 64 | 100_000 |
| tool calls | 256 | 100_000 |
| provider attempts | 256 | 100_000 or `turns + retries` |
| wall | 30 min | 24 h (or no HARD) |
| cumulative input / total tokens | 1M | 100M or no HARD |
| cumulative output | 250k | 10M or no HARD |
| request / response bytes | 64MB | **keep 64MB** (or 256MB) |
| maxCost | $10k | keep or drop HARD |

This unblocks overnight coding without pretending 64 turns is physics. Prefer C (`null`) over this table.

## References

- Prism 0.5.3 `src/run-limits.ts` (`DEFAULT_RUN_LIMITS`, `HARD_RUN_LIMITS`, `validateLimits`, `RunLimitTracker.recordUsage`)
- Prism `src/contracts-core/run-limits.ts` (`RunLimits`)
- [Claude Agent SDK — How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop) (`maxTurns` / `maxBudgetUsd` default **No limit**)
- [OpenAI Agents SDK — Running agents](https://openai.github.io/openai-agents-python/running_agents/) (`max_turns=None` disables)
- [Vercel AI SDK — Loop control](https://ai-sdk.dev/docs/agents/loop-control) (`stepCountIs(20)`, `isLoopFinished()`)
- [OWASP LLM10 Unbounded Consumption](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/)
- Clay host context: coding daemon `createSession` currently cannot legally set overnight / multi-million-token envelopes because of HARD
