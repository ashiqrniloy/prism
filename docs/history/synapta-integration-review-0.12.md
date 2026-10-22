# Synapta → Prism integration review

## Scope and conclusion

Reviewed local working trees: Synapta `6078398` plus existing uncommitted changes; Prism `949323af` (`0.11.1`) before this review's fixes. Synapta's execution-worker still pins the Prism family to **0.9.0**. These are source observations, not claims about deployed or published artifacts. Synapta was not edited. Existing unrelated Prism files were left untouched.

**Recommendation: improve Prism's host integration contracts, not its orchestration breadth.** Synapta needs a bounded, inspectable in-turn engine under its own authority. Most foundations already exist; several needs are adoption/composition gaps rather than missing SDK features.

This is a targeted review and set of recommendations, not an approved implementation roadmap or exhaustive security audit. No live provider, Synapta cluster, database, or browser journey was exercised.

Paths prefixed `synapta-core/` below are relative to `~/Projects`; other paths are relative to Prism.

## 1. Synapta's agentic system

| Surface | Mechanism | Authority / durability |
| --- | --- | --- |
| Ask | Fresh Prism session, browser-supplied user/assistant text history, host-owned Decision OS reads, evidence/output checks; model-less desk answers available | Effect-free; cannot propose or commit |
| Do | Temporal investigation Activity runs a host step loop; one Prism run per business step; host tools explore, clarify, paint a StepPlan, and propose | Kernel freezes typed commands into an immutable digest; human decision and current-state authorization precede commit |
| Run | Compile committed commands into recipe IR, then replay with Temporal | Not prompt replay or generated Temporal workflow code |
| Operating | Compiled event/schedule/queue/metric watches; deterministic matcher starts bounded work | Kernel fire identity, same-transaction outbox, JetStream delivery, Temporal waits; no model in matcher |
| Authoring | Separate Prism/AG-UI loop with PostgreSQL sessions, progressive disclosure, compaction and evals | Produces workflow IR, not a business commit; not Agent home's default path |

Decision OS supplies typed objects/links, governed metrics, authorized extracts and bounded computation, inert knowledge, and proposal verbs. A host classifier narrows tools by plane; it is distinct from provider/model selection. Guidance and playbooks grant no authority. Reads and effects remain constrained by **user ∩ agent ∩ task**, with current commit-time rechecks.

Do currently narrows turns, tool calls, and wall time across step runs, but keeps token ceilings per run. Its transcript store is process-local, action-scoped and LRU-bounded; Temporal/kernel durability does not make that transcript durable. Observational-memory attachment runs at step boundaries without observer workers or a recall tool.

**Evidence:** `synapta-core/docs/architecture/synapta-agent-mechanism.md:19–58, 113–150, 232–299, 366–421`; `synapta-core/services/execution-worker/src/do-host.ts:435–455, 1337–1669`; `synapta-core/docs/architecture/target-execution-architecture.md:80–176`.

### Roadmap implications

Synapta's intended product is an accountable operating layer over existing systems, with a native business suite as an optional consolidation path:

- **P02:** observability and Harness Studio before wider dependence on agents: effective run bundles, traces, evaluation, reviewed configuration changes and rollback.
- **P03–P06:** semantic onboarding → secure Data/Knowledge → accounting/CRM/email adapters → a verified overdue-receivables journey. Sending a reminder is explicitly not collecting payment.
- **P07–P09:** reports/documents, complete Integration Exchange, then bounded standing authority. Aggregate limits, revocation, uncertainty and outcome verification become mandatory.
- **P10–P18:** native service-company operations and finance, lakehouse/Gold semantics, broader functions and regulated domains, with profile-specific production evidence.

Near-term plans also name proposal-payload provenance (156), ledger-only Do telemetry and transcript durability decisions (157), behavioral evals (159), knowledge revocation (161), and a shadow-tested System One decision layer (163). These are not all implemented simply because underlying Prism primitives exist.

**Evidence:** `synapta-core/roadmap.md:34–88, 146–168, 301–466, 468–637`; respective plan introductions.

## 2. Confirmed Prism defects fixed

All changes are local, dependency-free, and include regression checks.

### F1 — Run-bundle audit omitted policies that actually executed

**Impact:** P02 could record an incomplete effective configuration. With agent policies plus run policies, execution applied both, while `snapshotRunBundle()` reported only the run list. An empty run list also hid agent policies.

**Fix:** snapshot concatenates agent then run policies, matching execution order. This repairs reporting, not authorization enforcement; runtime enforcement was already correct.

- Implementation: `src/run-bundle.ts:99,142`.
- Runtime contract: `src/agent-session/session.ts:742–763`.
- Regression: `src/__tests__/run-bundle.test.ts`, `records_agent_and_run_request_policies_in_actual_execution_order` executes a real mock-backed run and compares its applied policies with the snapshot.
- Documentation: `docs/run-bundle.md`.

### F2 — System One resolved credentials twice, under different provider names

**Impact:** provider-scoped resolvers could succeed for `laya`/`typesafe`, then fail to resolve under display labels `Laya`/`TypeSafe Jev`. Rotating credentials could also differ between transport and outer error redaction.

**Fix:** resolve once using the configured provider id; pass that resolved value to the shared transport. Authentication and outer error redaction now use the same credential.

- Implementation: `packages/prism-providers/src/shared/systemone-provider.ts:40–51`.
- Regression: `packages/prism-providers/src/laya/__tests__/laya.test.ts`, `laya_resolves_credentials_once_with_provider_id_and_redacts_transport_failures`.
- Both Laya and TypeSafe use this shared implementation.

### F3 — Malformed System One responses became successful decisions

**Impact:** the old transport checked only `model` and an `answers` object. Missing or string-valued noul probabilities could be coerced to booleans; non-finite scores could render invalid semantic values; malformed confidence/probability metadata and negative/string token counts passed the success gate. This is especially unsuitable for Plan 163's confidence gates.

**Fix:** validate answer discriminants and values, finite scores, probability ranges, optional confidence/distributions/legends, and reported token counts before emitting output. Renderer also validates answers and requires own answer properties. Finite rubric scores retain the documented rounding/clamping behavior. Invalid responses fail; they do not become synthetic neutral decisions.

- Implementation: `packages/prism-providers/src/shared/systemone.ts:158–195`; `systemone-schema.ts:102–111`.
- Regressions: shared transport/schema suites plus Laya's malformed-success check.
- Documentation: `docs/providers/typesafe.md`.

This is shape/range validation, not a claim that returned probabilities are empirically calibrated or normalized distributions.

### F4 — A valid choice label disappeared during request construction

**Impact:** assigning the string enum label `__proto__` into a plain criteria object did not create an own property. The advertised choice set could differ from the schema.

**Fix:** construct criteria with `Object.fromEntries`, preserving labels as own data properties. Existing forbidden schema-key validation remains intact; no prototype-pollution bypass was found or enabled.

- Implementation: `packages/prism-providers/src/shared/systemone-schema.ts:195–202`.
- Regression: `preserves_prototype_named_choice_labels_as_own_wire_options`.

## 3. Recommended additions and enhancements

Priorities below express this review's recommendation, not authorization to change Synapta's approved sequence.

### Highest priority — coverage-safe memory compaction

**Observed integration hazard:** Synapta attaches observational-memory compaction without observation workers (`do-host.ts:1480–1507`). Prism's strategy renders existing observations; it does not summarize raw messages. The attach loop ignores a skipped flush and may still compact. With no observations, old messages can leave the next model context behind a summary containing “none”. The original entries remain stored: this is loss of usable context, not physical deletion.

A local two-message probe against Prism reproduced this: after render-only OM compaction retaining one recent entry, an early evidence sentinel was absent from `rebuildSessionContext(...).messages` and `.summaries`. Synapta's current compaction test asserts that a compaction entry exists and a scripted proposal freezes, not that early evidence survives (`do-host.test.ts:842–886`). That does not establish semantic memory retention.

**Prism enhancement:** coverage-aware admission for automatic OM compaction: do not discard an unobserved prefix after a skipped/failed observer pass. Preserve uncovered messages or explicitly refuse/defer compaction. Keep a successful empty observation pass distinct from no observation pass. Make recall guidance conditional on a host-provided recall capability; current renderer advertises `recall` even when Synapta deliberately exposes none.

**Why now:** multi-step evidence reuse underpins P06. A smaller prompt is not proof of preserved evidence. This needs an explicit compatibility decision and semantic retention tests, not a silent change to every caller's compaction policy; it was not patched in this review.

**Reuse:** existing coverage markers, `unscannedEntries`, step-boundary compaction and work scopes. No new memory database, automatic worker, or recall tool.

**Acceptance evidence:** early authorized facts survive the next run or compaction explicitly refuses; missing worker, worker failure, and successful empty observation passes have distinct outcomes; revoked facts stay excluded.

**Prism sources:** `packages/memory/src/compaction/observational-memory/strategy.ts:27–91`, `compose.ts:207–226`, `runtime.ts:159–195`, `render.ts:20–45`; `src/session-stores.ts:149–179`.

### Highest priority — confidence-preserving host decision calls

**Already present:** TypeSafe/Jev and Laya providers, shared System One wire client, retries, bounded response parsing and schema-to-question compilation. Do not implement another HTTP client.

**Real gap:** public adapters return schema-shaped text and deliberately discard confidence/distributions and actual responding model. Shared raw client is not a public provider subpath export. Consequently the existing adapters do not fulfill Synapta's Plan 163 shadow classification, confidence gating and calibration needs, despite sharing the wire.

**Smallest addition:** a host-only typed decision call over the existing client, preserving question ids, raw probabilities, actual model version, usage and timing. Keep the existing `AIProvider` adapter for callers wanting only schema values. Add explicit state/question bounds and cancellation/deadline composition. Calibration version and threshold decisions belong in host configuration; forward engine-specific calibration controls only when the supported wire contract is verified.

Do **not** add automatic routing/sufficiency/retrieval hooks to every agent yet. Synapta can invoke one decision call from its own classifier and retain its deterministic fallback. Do not turn timeouts into plausible `0.5` answers: error/unavailable must remain distinguishable from measured uncertainty. Decisions never grant effect authority.

**Why:** immediately removes the need for the interim Synapta client while preserving its core reason to exist. Benchmark savings and provider pricing claims in the feature request were not independently validated here; neither justifies a default rollout or a new billing unit without evidence.

**Evidence:** `synapta-core/plans/163-SystemOneDecisionLayer.md:169–295`; `synapta-core/plans/evidence/163-prism-feature-request.md`; `docs/providers/typesafe.md` “Outputs”; `packages/prism-providers/src/shared/systemone-provider.ts:42–63`.

### High priority — fixed-model aggregate budget composition

**Already present:** `createGovernedProvider`, atomic task reservations, durable router state, unknown-usage settlement, and task attribution. No new scheduler or budget database is needed.

**Observed gap:** Synapta's step loop subtracts turns/tools/time but intentionally resets token ceilings per run (`do-host.ts:1533–1605`). A 500,000-input-token run ceiling is therefore not a 500,000-token action ceiling. Separate attempts, authoring, compaction and embeddings are additional accounting paths.

**Prism enhancement:** a maintained fixed-model composition demonstrating shared task accounting across multiple `session.run()` calls and auxiliary work, with fallback disabled. Expose remaining aggregate liability separately from context-window pressure; do not change attention thresholds just to represent another run's spend. Add a smaller budget-only facade only if this composition proves the existing API is genuinely unsuitable.

**Why:** P09 requires cumulative limits under concurrency; P02/P06 need truthful cost per outcome. A policy-preserving model pin is compatible with accounting, not equivalent to automatic model routing.

**Host gate:** Synapta explicitly withheld governed-router adoption in `plans/executed/122-Prism070ModelRouterBudgets.md:1–17`. Obtain that decision before wiring or migrations. This review does not lift it.

**Acceptance evidence:** concurrent steps/attempts cannot reset a task ceiling; missing usage remains unknown liability; auxiliary calls share the task; changing models or restarting workers cannot reset spend.

**Prism sources:** `docs/model-routing.md`, `packages/prism-core/src/governance/model-router/invocation.ts`, `router.ts:429,543,635`.

### High priority — structured telemetry/evals for host-owned step loops

**Already present:** `ExecutionTimeline`, incremental folders, session summaries, turn budgets/stop reasons, exhaustion details, `snapshotRunBundle`, trajectory and environment scorers, release-eval manifests.

**Prism enhancement:** a reference composition that correlates action/attempt/step → Prism session/run and persists metadata-only timelines into a host ledger. Use existing identities/events first; add correlation fields only where a demonstrated projection loses them. Show a host's external commit/verification evidence alongside Prism runs without pretending those effects occurred inside Prism.

**Why:** Synapta currently compresses Do telemetry to a 480-character trace and competes with business steps for an eight-step snapshot. Plan 157 already proposes a ledger-only channel. Parsing trace prose would duplicate information Prism already exposes structurally. P02 and Plan 159 should share the same projection and hard-invariant scorers.

**Acceptance evidence:** a full eight-step plan loses no trace; live/replayed projections agree; required evidence cannot silently truncate into a passing eval; approval-before-effect and independently verified outcome fail separately from answer quality. No chain-of-thought capture by default.

**Evidence:** `synapta-core/services/execution-worker/src/do-host.ts:112–311, 914–950, 1508–1530`; `synapta-core/plans/157-DoTransparencyClosure.md:1–24`; `docs/execution-timeline.md`; `docs/evaluations.md`; F1 above.

### High priority — typed proposal provenance, not only answer grounding

**Already present:** tool-input guardrails, artifact citation/review types, claim-grounding output checks and invariant evals.

**Gap named by Synapta:** answer figures are evidence-checked, but schema-valid invented figures or identifiers can reach proposal review. Plan 156 names this asymmetry explicitly.

**Prism enhancement:** a small optional field-evidence verifier/example built on tool-input guardrails: host-selected field paths, typed source references, exact normalized values, source revisions and freshness. Prefer reusable validation over a domain proposal engine. The host must supply authoritative evidence and decide which fields require it.

**Why:** schema validity and an approval digest do not establish factual provenance. Conversely, matching a number in any tool result is not sufficient: currency, units, object identity and revision matter.

**Acceptance evidence:** invented amount/id rejected; correct value attached to wrong object/revision rejected; properly typed authorized evidence accepted. Rust/Synapta still owns money, grant checks, digest freeze and commit-time validation.

**Evidence:** `synapta-core/plans/156-ProposePayloadProvenance.md:1–20`; `synapta-core/services/execution-worker/src/do-host.ts:961–1061`; `docs/guardrails.md`; `docs/work-artifacts-and-review.md`.

### High priority — cross-layer revocation composition

**Already present:** ACL-filtered RAG query legs, access rechecks, lineage tombstones, deletion/repoint handlers and OM invalidation primitives. Do not propose generic “add secure RAG”.

**Prism enhancement:** an executable host composition proving source revoke/delete → retrieval exclusion → derived wiki/OM exclusion → subsequent context assembly. Clearly separate global deletion from a principal losing access. Any new seam should carry host-resolved invalidated ids/access decisions into existing projection paths, not invent another authorization authority.

**Why:** P04/P07 cover reused conversations, wiki pages, extracts and generated artifacts—not only the next vector query. The reviewed automatic OM strategy/attach paths do not themselves consult Synapta's current source grants. Source access rechecks during retrieval cannot authorize an old transcript or report download.

**Host work remains:** current kernel/source checks, source-to-entry/artifact lineage, multi-source page permission intersections, and authorization at render/download/delivery. Synapta Plan 161 owns these application obligations.

**Acceptance evidence:** revoke during rerank, between step runs, and after report generation blocks subsequent exposure; legal-hold retention does not restore retrieval; authorized prior external disclosure is not claimed erased.

**Evidence:** `synapta-core/plans/161-KnowledgeRetrievalAndRevocationClosure.md:249–480`; `docs/rag.md:92–175,224–225`; `packages/memory/src/compaction/observational-memory/strategy.ts:42`.

### Later — connector/outcome and packed compatibility proofs

For P05–P08, extend existing connector/artifact examples with provider rejection, timeout-after-acceptance, receipt reconciliation, stale source revisions, and export revocation. Prism already models unknown effects; do not introduce a second approval ledger around Synapta's authoritative command ledger. Dispatch success and verified business outcome must remain separate.

Maintain a small packed-install consumer contract suite for the Synapta-shaped composition: host tools only, policy-chain snapshot, per-step stop, memory retention, usage/attention trace, revocation, and optional typed decisions. Verify the exact family release under Synapta's selected runtime before upgrading. Its 0.9.0 pin will not receive these local 0.11.1-tree fixes automatically.

**Evidence:** `synapta-core/roadmap.md:363–444`; `docs/work-tools.md:116–135`; `synapta-core/services/execution-worker/package.json`.

## 4. What not to move into Prism

- Temporal ownership, mandate matching, business outcome state machines or the StepPlan authority model.
- OpenFGA task-grant compilation, product allocation/licensing, exact-money invariants or commit authorization.
- Native ERP entities, metrics, lakehouse SQL, domain playbooks or a Synapta-specific supervisor.
- Automatic swarms, model-visible memory/inspection tools, or MCP as an internal bus.
- Implicit source/model fallback that turns unavailable evidence or uncertain effects into success.

These would duplicate authorities Synapta deliberately owns. Generic Prism primitives remain useful without importing every Prism subsystem.

## 5. Verification and remaining limits

Executed:

```sh
npm run build:core
npm run build --workspace @arnilo/prism-providers
npm test --workspace @arnilo/prism-providers
node --test --test-concurrency=1 \
  dist/__tests__/run-bundle.test.js \
  dist/__tests__/guardrail-packs.test.js \
  dist/__tests__/guardrail-pack-durability.test.js \
  dist/__tests__/provider-request-policy.test.js
```

- Provider suite: **628 passed, 95 skipped, 0 failed**. Skipped live/environment-dependent tests are not compatibility evidence.
- Runtime/policy suites: **36 passed, 0 failed** with serial file execution.
- Initial parallel runtime check failed the existing 5 ms snapshot benchmark at **7.61 ms**; serial rerun passed. No threshold or assertion was weakened.
- Regression tests first demonstrated the policy-chain omission, double credential resolution, and malformed-answer acceptance; targeted and full provider checks pass after fixes.
- Biome checks and `git diff --check` pass for changed code.
- The render-only OM probe establishes a local composition hazard; no Synapta live incident or production data loss is claimed.

Not run: full Prism release gate, packed-install matrix, live System One servers, Synapta e2e, or cross-replica database fault tests. No package versions, lockfiles, dependencies, approved roadmap statuses, or Synapta files changed.

## 6. Remediation status

These recommendations were executed as plan `plans/122-Synapta-Integration-Review-Remediations.md` (Tasks 1–9, 2026-09-24/25, local `0.11.1` tree); the `CHANGELOG.md` entries drafted there ship in the first release containing that plan. The defects in §2 are fixed in-tree with regression tests, and §4's authority list is unchanged — no Temporal, OpenFGA, commit-authorization, ERP, or implicit-fallback logic moved into Prism. To re-run the compatibility contract against a host-selected family release before upgrading, use the replay recipe in [Test layout and isolation](testing.md#replaying-the-packed-contract-against-a-host-selected-runtime) and append the observed delta block to this section.

| Recommendation | Status | Delivered |
| --- | --- | --- |
| §2 F1 run-bundle policy order | fixed in this tree | Snapshot concatenates agent then run policies in execution order; the packed-install `policy-chain-snapshot` check pins it. |
| §2 F2 single credential resolution | fixed in this tree | One resolve under the configured provider id, reused by transport and outer redaction. |
| §2 F3 malformed-response rejection | fixed in this tree | Answer discriminants, finite scores, probability ranges, optional confidence/distributions/legends, and token counts validated before success. |
| §2 F4 `__proto__` choice labels | fixed in this tree | Criteria built with `Object.fromEntries`; the regression is pinned. |
| §3 coverage-safe memory compaction | implemented (Task 2) | Eligible messages after the coverage cursor are retained past the recent window, the fold boundary stays behind an unscanned prefix, and automatic compaction defers when the observer skipped without a coverage cursor; `advertiseRecall` gates the recall hint. |
| §3 confidence-preserving decision calls | implemented (Task 3) | `@arnilo/prism-providers/decisions` typed call preserves raw probabilities/confidence, responding model, usage, and timing, with explicit bounds, deadline/abort composition, and typed errors; calibration stays host config and timeouts never become plausible answers. |
| §3 fixed-model aggregate budget composition | demonstrated (Task 4) | `examples/model-router-aggregate-budgets.ts` draws three sequential runs plus an auxiliary call on one task ceiling, with renewal fencing, unknown-usage liability, and aggregate-versus-context-window reporting; existing router APIs only. |
| §3 step-loop telemetry/evals | demonstrated (Task 5) | `examples/host-step-loop-timeline.ts` correlates host action/attempt/step ids with Prism session/run ids in a metadata-only NDJSON ledger and keeps external host commit evidence outside Prism effects. |
| §3 typed proposal provenance | implemented (Task 6) | `createFieldEvidenceGuardrail` (`tool_input`, fail-closed) verifies host-selected field paths against host-supplied evidence values, sources, and revisions. |
| §3 cross-layer revocation composition | demonstrated (Task 7) | `examples/revocation-propagation.ts` chains grant loss, lineage-closed deletion, observational-memory withholding on read and write paths, a mid-rerank revoke, and a redacted fail-closed denial. |
| §5 packed compatibility proofs | implemented (Task 8) | `examples/host-composition-compat.ts` runs from packed tarballs against the Synapta-shaped composition; the `0.9.0` pin reports named deltas instead of failing, offline by default. |

**Verification limits, updated.** The full release gate, the PostgreSQL durable conformance run (583 tests, 0 failures), and the packed-install matrix now run locally; the pinned-old-family leg is env-gated and skipped without an explicit opt-in. Still not exercised: live System One servers, Synapta end-to-end, and cross-replica database fault drills. Skipped live legs remain non-evidence, as §5 states.
