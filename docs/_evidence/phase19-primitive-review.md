# Phase 19 (0.1.7) primitive review — prompt-cache telemetry, router selection, async-hooks closeout, provider scaffold

Evidence file for plan 019 Task 1 (performance-and-dx). Reviewed 2026-08-12 at
HEAD 2ebc08e (0.1.6 baseline). Scope: the four roadmap 0.1.7 items. Method:
reuse-first inventory of what already exists, then a written gap analysis per
item; a new primitive is proposed only where a real gap exists, and each new
seam ships with its concrete first consumer in the same task (no
single-consumer extraction).

The preserved surface from the phase-19 freeze manifest (`src/cache-helpers.ts`,
`src/provider-events.ts`, `src/cli-init.ts`, `packages/model-router/src/state.ts`)
is intentionally NOT the place where 0.1.7 logic lands: it is byte-immutable for
the whole phase, so every item below consumes those primitives without editing
them.

---

## 1. Prompt-cache telemetry surface per provider (Task 2)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `Usage.cacheReadTokens` / `cacheWriteTokens` / `cacheRead` / `cacheWrite` | `src/contracts-core.ts:153-164` | Per-call cache token counters already produced by every provider adapter; the raw signal this item aggregates. |
| `ModelCacheCapabilities` (`cache?`) | `src/contracts-core.ts:128` | Per-model cache support; lets the aggregator distinguish "no cache support" from "zero cache traffic". |
| `PromptCacheKind` (`implicit` / `openai_key` / `cache_control` / `provider_specific` / `none`) + `PromptCacheHints` (`cacheRetention`/`cacheKey`/`cache`) | `src/contracts-core.ts:261,302-304` | The host-facing cache configuration surface hosts tune while watching the telemetry. |
| `cacheHitRate` / `cacheSavings` / `cacheUsageReport` / `sanitizeCacheKey` / `mapCacheRetention` / `applyCacheControl` | `src/cache-helpers.ts:24-80` | The math: hit rate, savings estimate (needs `ModelConfig`), and the per-call `CacheUsageReport` shape. Reused as-is; byte-immutable. |
| `ProviderEvent { type: "usage", usage }` | `src/contracts-protocol.ts:44` | The per-call event stream hosts already receive; the aggregator's input. |
| Run-ledger usage rows (`StoredUsage`, `usage` on run/event records) | `src/contracts-protocol.ts:527-536,574` | Alternative input for hosts that replay ledgers instead of subscribing to events; same `Usage` shape. |
| Cache plumbing in adapters (`applyCacheControl` in `openai-primitives`, provider-anthropic `messages.ts`, provider-google `generate-content.ts`, etc.) | core + `packages/provider-*` | Proof the per-call signal is already wired end to end at 0.1.6; the aggregator only observes it. |

### Gap analysis

**Already achievable today:** any host can accumulate `usage.cacheReadTokens`
per provider/model by hand, and `cacheUsageReport` gives the per-call report
shape.

**The gap:** there is no aggregation surface. A host that wants a per-provider
hit rate across a multi-day run must write its own accumulator, its own
cardinality bound, and its own report shape — and every host would write a
slightly different one. Nothing emits aggregate per-provider/model cache
statistics.

### New primitive (one, generic, dependency-free)

`createCacheTelemetry()` in new `src/cache-telemetry.ts`, exported from the
package entry: an explicit-activation aggregator consuming `Usage` + model
identity (from the `usage` `ProviderEvent` or ledger records) and returning
per-provider/model reports with hit rate, cache-read/write token totals, and
savings estimates (reusing `cacheHitRate`/`cacheSavings`/`cacheUsageReport`
math). Cardinality-bounded with an `__overflow__` bucket (`ponytail:` comment
naming the ceiling). Reports carry token counters and rates only — no prompt
content, no cache keys, no identity fields.

It ships with its first consumer in Task 2 (module + tests + docs in one task);
it is NOT extracted for a single consumer today — the consumer IS the task.

### Trust boundaries (risks → tests in Task 2)

| Risk | Boundary | Test to write in Task 2 |
| --- | --- | --- |
| Unbounded memory from hostile provider/model cardinality | `__overflow__` bucket at the cap | `cache-telemetry overflows into __overflow__ at the cap and stays bounded` |
| Prompt content or cache keys leak into reports | report shape is token counters/rates only | `reports expose only token counters and rates, never keys or content` |
| Aggregator activates on import (implicit activation) | explicit host wiring only | `no telemetry is collected until the host subscribes the aggregator` |
| Aggregate math diverges from per-call math | reuse `cacheHitRate`/`cacheSavings` | `aggregate hit rate equals cacheUsageReport math across a sample run` |

Budget impact: one stdlib-only module; a few KB of dist growth in the
dependency-free core, far under the frozen p95 ceilings. No OTel emission in
0.1.7 (hosts wire the aggregator into `observability-opentelemetry`
themselves; demand-gated).

---

## 2. Model-router cost/latency-aware selection policy (Task 3)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `CreateModelRouterOptions` (allowList, budgets, rateLimit, circuit, stateStore, ordered `fallbacks`, `allowOpenRouterRouting`, `onDiagnostics`, `limits`) | `packages/model-router/src/types.ts:98` | The existing host-configurable surface; the selection hook slots in here additively. |
| Candidate construction: `[request.model, ...(request.fallbacks ?? options.fallbacks ?? [])].slice(0, maxAttempts)` | `packages/model-router/src/router.ts:228` | The fixed ordered candidate chain this item makes reorderable — default stays byte-identical. |
| Governance gates (allow-list, residency, budget, rate limit, circuit) before candidate selection | `router.ts` (resolve flow) | Selection runs AFTER these gates; a policy can only reorder already-allowed candidates. |
| `recordOutcome` (`{ identity, provider, model, success, circuitProbeToken }`) | `router.ts:341-344` | Existing outcome feedback loop; the reference policy's latency EMA feeds from the timing side of this seam (in-memory only). |
| `ModelRouterDiagnostics` + `redactDiagnostics` (maxDiagnosticsBytes) | `types.ts:146`, `router.ts:53` | Diagnostics stay redacted regardless of policy; the policy never changes what diagnostics carry. |
| `ModelRouterStateStore` + durable `createPostgresModelRouterStateStore` | `types.ts:50`, `packages/enterprise-postgres/src/model-router.ts` | Durable rate/budget/circuit state (Phase 6). The selection policy is deliberately stateless w.r.t. the store; the store contract is unchanged. |
| `ModelRouteCandidate` (`{ model, region?, residency? }`) | `types.ts:92` | The per-candidate shape a policy ranks. |
| `ModelRouterResolveResult.providerRequestPolicy` (OpenRouter gate chain) | `types.ts:162-171` | Chainable request policy precedent — selection slots beside it without touching it. |

### Gap analysis

**Already achievable today:** cost/latency-aware *fallback chains* exist
(ordered `fallbacks`), durable governance exists, and hosts receive redacted
diagnostics with per-attempt outcomes.

**The gap:** candidate *ordering* is fixed at construction time. A host cannot
rank candidates by cost or by recent measured latency without reimplementing
the whole resolve loop — there is no seam between the governance gates and
attempt dispatch. `recordOutcome` currently carries no timing, so nothing in
the router knows about latency at all.

### New primitive (one seam + one reference policy, inside the package)

`ModelRouterSelectionPolicy` option on `CreateModelRouterOptions` (default
absent ⇒ today's ordered behavior, byte-identical, with a regression test) and
`createCostLatencySelection()` in new `packages/model-router/src/selection.ts`:
ranks candidates by `ModelCost` (input/output/cacheRead) first, then by
recent measured latency via an in-memory EMA fed from `recordOutcome`
timings; cold start falls back to pure-cost order. `ponytail:` comment: EMA is
in-memory and per-router-process; durable latency statistics are demand-gated.

Ships with its first consumer: the reference policy is exported beside the
seam in the same task. No change to `ModelRouterStateStore`, the Postgres
store, or any default behavior.

### Trust boundaries (risks → tests in Task 3)

| Risk | Boundary | Test to write in Task 3 |
| --- | --- | --- |
| Policy widens allow-list/residency/budget decisions | selection runs only over already-allowed candidates | `a selection policy cannot select a candidate the allow-list denies` |
| Default behavior drifts | absent option ⇒ ordered fallbacks unchanged | `default resolution is byte-identical to 0.1.6 (ordered regression)` |
| Latency memory grows unbounded | per-provider/model EMA keyed by existing model id; bounded | `EMA entries stay bounded by candidate model count` |
| Diagnostics leak policy internals or identity | redaction path unchanged, policy never emits | `diagnostics stay redacted and policy-shaped-free` |
| Cost comparison is wrong on edge cases | reuse `ModelCost` fields; total-token guard | `cost ranking handles missing cost fields without NaN` |

Budget impact: model-router package growth is small and the frozen
`budgets.json` gate for the package is unchanged (verified at Task 6); the
policy adds no dependency.

---

## 3. Async `AgUiProjection` hooks closeout (Task 4 — verification only)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `Awaitable<T> = T \| Promise<T>` and every hook typed `Awaitable` (toolArguments, toolResult, toolLocations, toolDiff, lifecycle, fileDiff, state, stateSnapshot, stateDelta, messages, activity, reasoning, raw, custom, interrupt, coWork, path) | `packages/ag-ui/src/projection.ts:41-78` | The async hook surface, shipped 0.0.26 Task 15. |
| `createMessagesFromSessionProjection({ getMessages })` accepting `() => readonly AgUiMessage[] \| Promise<readonly AgUiMessage[]>` | `packages/ag-ui/src/projectors.ts:20` | Async transcript access — the `session.entries()` use case from roadmap item 3 / plan 008. |
| `ag-ui-mapper.ts` awaiting projection callbacks strictly in event order (never `Promise.all`), rejecting failed hooks closed per event | `packages/ag-ui/src/ag-ui-mapper.ts` | Ordering + fail-closed semantics already implemented and documented (`docs/ag-ui.md`, Task 15, 0.0.26). |
| Projector caps `DEFAULT_MAX_PROJECTOR_MESSAGES=128` / `HARD_MAX_PROJECTOR_MESSAGES=1024` | `packages/ag-ui/src/projectors.ts` | Bounded-JSON validation applied to awaited results. |
| Existing ag-ui test suites + docs tripwire | `packages/ag-ui/src/__tests__/`, `docs/ag-ui.md` | The verification target. |

### Gap analysis

**Already achievable today:** every roadmap item-3 capability exists — hooks
are `Awaitable`, `getMessages` may be async, ordering is strict, failures fail
closed, and results are bounded. There is no known gap at 0.1.6.

**The gap:** none identified at review time. This item is verification-only:
targeted ag-ui test runs + a docs cross-check, evidence recorded in
`scripts/phase19-baseline.json` (`asyncHooks.verified`, `gapFound`). If
verification finds a real gap, the smallest additive fix lands in the
tentative allowed test file — the state machine enforces that no test file
appears unless `gapFound` is true.

### New primitive

None. No new seam is proposed for a verification-only item; the roadmap item
closes with recorded evidence.

### Trust boundaries (risks → tests)

| Risk | Boundary | Test to write (only if a gap is found) |
| --- | --- | --- |
| A rejected async `getMessages` leaks a stale snapshot | fail closed per event | `a rejected async getMessages omits the snapshot` |
| Awaited results bypass bounded-JSON validation | caps apply to awaited results too | `awaited projection results stay within projector caps` |

No new trust boundary exists today; this table is the contingency list.

---

## 4. `prism providers add <name>` scaffold (Task 5)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `runInitCommand` / `createInitProject` / `parseInitArgs` / `listInitProviders` / `isInitProvider` / `defaultTemplatesRoot` / `initUsage` | `src/cli-init.ts:78-286` | The init machinery pattern: arg parsing, template expansion, force/overwrite handling, usage text. Reused as the shape for the provider scaffold — byte-immutable. |
| `templates/init/` static tree + `providers.json` catalog | `templates/init/` | The template-catalog precedent (static `.tmpl` files + JSON metadata + optional dirs). |
| CLI dispatch: `runCli` on `argv[0]` (`init` today) | `src/cli-runner.ts` | Where the `providers add` subcommand dispatches; the only allowed edit to the runner (additive branch). |
| `createOpenAICompatibleProvider` + `buildOpenAIChatBody` + `openAIChatEvents` | `@arnilo/prism/providers/openai-compatible` | The base every generated provider reuses — generated `provider.ts` is ~15 lines calling this base. |
| Conformance suite: `assertProviderOwnedHeadersWin`, `assertProviderStreamConforms`, `assertSerializedRequestCoversContent`, `assertToolCallDeltasReconstruct` | `@arnilo/prism/testing/provider-conformance` | The generated conformance test imports these; a scaffolded package passes out of the box. |
| `provider-zai` package (smallest first-party adapter) | `packages/provider-zai/` | The template reference: manifest shape (peer dep on `@arnilo/prism`, `sideEffects: false`), `src/{index,provider,models,thinking}.ts`, `__tests__/`. |

### Gap analysis

**Already achievable today:** a provider adapter is ~30 lines over the
OpenAI-compatible base plus a conformance test, but every new provider
hand-copies that shape. `prism init` generates an agent *project*, not a
provider *package* — there is no generator for provider packages, and the
`providers` CLI namespace does not exist yet (only `argv[0] === "init"` is
dispatched).

**The gap:** no `providers add` subcommand, no provider template tree, no
validation of provider names / output paths / env keys, and no docs stub
generation. The roadmap item asks for exactly this DX.

### New primitive (one CLI command + one static template tree; no runtime primitive)

`prism providers add <name>` via new `src/cli-provider-add.ts` (beside
`cli-init.ts`) with static templates under `templates/provider/` (mirroring
`templates/init/`): generates `package.json` (peer dep `@arnilo/prism`,
`sideEffects: false`), `tsconfig.json`, `README.md`, `CHANGELOG.md`,
`src/index.ts`, `src/provider.ts` (calls `createOpenAICompatibleProvider`),
`src/models.ts`, `src/cache.ts`, a conformance test, and
`docs/providers/<name>.md` stub. Flags: `--base-url`, `--env-key`, `--model`;
`--force` required to overwrite. Output is host-chosen and never auto-registered
into repo workspaces.

No new runtime primitive is extracted: the scaffold generates code that uses
the existing base provider and conformance suite. The "primitive" here is the
template tree + command, and its first consumer is the command itself.

### Trust boundaries (risks → tests in Task 5)

| Risk | Boundary | Test to write in Task 5 |
| --- | --- | --- |
| Malicious provider name (`..`, absolute path, invalid npm name, symlink escape) | fail-closed validation before any write | `scaffold refuses traversal/symlink-escape/absolute/invalid-npm names` |
| Overwrite of existing files without consent | `--force` required | `scaffold refuses to overwrite without --force` |
| Shell-unsafe env key breaks generated `.env`/CI snippets | env-key validation | `scaffold rejects env keys that are not valid shell identifiers` |
| Generated package does not typecheck / fails conformance | fixture test compiles + runs the generated suite | `a scaffolded fixture package typechecks and passes its conformance test` |
| Secrets (API keys) embedded in generated code | templates contain placeholders only, never values | `generated files contain no secret material, only env placeholders` |
| Scaffold touches repo workspaces implicitly | output only where the host asks | `scaffold writes only under the host-chosen directory` |

Budget impact: template files are static text excluded from runtime budgets
(they never load at runtime); the command adds one stdlib-only module to the
CLI. No new dependency.

---

## Decision record

1. **No new primitive is extracted for a single consumer.** The telemetry
   aggregator (Task 2) and the selection seam (Task 3) each ship with their
   first consumer in the same task; the template tree (Task 5) IS the
   artifact. Nothing in 0.1.7 adds an interface with one implementation.
2. **The preserved surface stays untouched.** `cache-helpers.ts` math,
   `provider-events.ts` usage event, `cli-init.ts` machinery, and
   `model-router/state.ts` are consumed, never edited (freeze test enforces).
3. **Defaults are byte-identical.** Absent selection policy ⇒ ordered
   fallbacks exactly as 0.1.6; absent telemetry wiring ⇒ no aggregation;
   scaffold writes nothing without an explicit command.
4. **Governance is not widened.** A selection policy reorders only
   already-allowed candidates; telemetry reports carry no content, keys, or
   identity; scaffold output is host-chosen.
5. **Durability is demand-gated.** Latency EMA is in-memory; OTel emission is
   host-side; durable latency statistics are a 0.2.0 candidate.
6. **Verification closes plan 008.** Async hooks shipped in 0.0.26 Task 15;
   Task 4 records evidence and adds code only if a gap is found (freeze test
   enforces the tentative-file rule).
