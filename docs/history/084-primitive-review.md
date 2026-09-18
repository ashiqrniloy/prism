# Host long-run durability, steering, and honesty primitive review

Plan 084 Task 0 freezes the vocabulary, symbol inventory, threat posture, and packed baseline for Tasks 1–8. Evidence only: no public symbol, dependency, runtime path, or doc contract changes here.

Reviewed tree: `a7915d6c` with 304 dirty files (0.8.0 line in progress), root package version `0.7.0`. Every span below was verified against this revision, not from memory. Where the plan text drifted, [Plan corrections found during review](#plan-corrections-found-during-review) records the correction the implementation tasks must follow.

## Sources reviewed

Current contracts: [agent session runtime](../agent-session-runtime.md) (§Mid-run steer `90`, §Durable interruption `182`), [agent loops](../agent-loops.md), [AG-UI](../ag-ui.md), [host compositions](../host-compositions.md), [guardrails](../guardrails.md), [runs and usage](../runs-and-usage.md), [model registry](../model-registry.md), [provider layer](../provider-layer.md), [provider conformance](../provider-conformance.md), [execution timeline](../execution-timeline.md), [thinking and reasoning](../thinking-and-reasoning.md), [options index](../options-index.md).

Host evidence for the seven gaps: `~/Projects/synapta-core/docs/architecture/prism-070-and-agent-desk-review.md` §8, `plans/117-Prism070Adoption.md`, `docs/architecture/synapta-agent-mechanism.md` §9.2 (`Do` bounds and restart behavior), §9.8 (L0/L1/L2 autonomy law), Plan 111 T21 (`ERR_PRISM_AG_UI_INPUT` relay shim, `429 GoUsageLimitError` opacity), Plan 110 F9 (live `Do` run died at `maxTurns: 4`).

## Existing primitives and compatibility freeze

| Existing contract | Evidence | Later use / compatibility rule |
| --- | --- | --- |
| Durable resume validates revision, fingerprint, `expectedVersion`, ownership/fencing, and requires `status === "suspended"`. | `src/agent-run-lifecycle.ts:112` (`resumeAgentRun`), `:176-195` (`prepareAgentRunResume`; the hard gate is `state.status !== "suspended"` at `:191`); `src/agent-approval.ts:54` (`assertValidAgentRunResume`) | Task 1 adds a running-state resume path gated on a new explicit resume action. The suspension gate and CAS semantics stay; only a validated checkpoint-only path is added. |
| Resume vocabulary is approval-shaped: legacy `decision?: "approve" | "deny"` plus batched `RunDecision[]` whose outcome is `ApprovalOutcome = "allow_once" | "allow_for_run" | "reject_once" | "reject_for_run"`. | `src/contracts-run-state.ts:221-227` (`AgentRunResume`), `:26` (`ApprovalOutcome`), `:68-79` (`RunDecision`) | Task 1 must **not** add `"continue"` to `ApprovalOutcome` or to `AgUiInterruptResolution` (`packages/ag-ui/src/handler.ts:96`, `"approve" | "deny"`). It is a third resume action beside the legacy pair, resolved before decision work and never applied as a sticky/approval outcome. |
| Checkpoint persistence lives in one save path with redaction, `expectedVersion`, fencing, and byte caps; session-state payload carries loaded skills, activated tools, attention sticky frontier, and optional skill bodies. | `src/agent-run-state.ts:189` (`saveAgentRunState`); `src/agent-session/session/persist.ts:14-52` (`persistDurable`); `src/contracts-run-state.ts:177-196` (`AgentRunStateOptions`, `persistSessionState:192`, `includeSkillBodies:195`) | Task 1 reuses `saveAgentRunState` unchanged; `checkpointPolicy` only decides *when* it is called. No second checkpoint format, no new store interface. |
| Loop strategies call an optional steer seam at turn boundaries; the public session queue is bounded by count and bytes, and rejected steers emit a typed event. | `src/agent-loops.ts:34` (`singleShotLoop`), `:45,161` (drain points), `:395` (`resolveLoop`); `src/contracts-core/loop.ts:37-40` (`hasPendingSteers`/`applyPendingSteers`); `src/agent-session/session.ts:209` (`steer`); `src/contracts-run-state.ts:322,326` (caps); `src/contracts-protocol.ts:276` (`steer_rejected`) | Task 2 hooks the same boundary; steer already works and needs no new public surface. Steer caps and the `steer_rejected` event are frozen. |
| The agent fingerprint hashes id, revision, model, instructions, system prompt contributions, skills, tools, guardrails, and loop revision with SHA-256. | `src/agent-run-state.ts:118-156` (`agentFingerprint`) | Task 4's `RunBundleSnapshot` is the inspectable projection of these same inputs with the same digest algorithm — one truth, not two. |
| Run results and ledger records already carry a shared `ErrorInfo` (`name`, `message`, `code`, `retryAfterMs`, `cause`). | `src/contracts-core/content.ts:12-20` (`ErrorInfo`); `src/contracts-run-state.ts:285-307` (`AgentRunResult`, `error:302`, `limit:300`); `src/contracts-protocol.ts:519` (`RunRecord.error`); `src/contracts-protocol.ts:420` (`ToolResult.error`) | Task 6 adds `failureClass?` to `ErrorInfo` — it then flows to result, ledger, and tool results with no extra plumbing. No bespoke result-only field. |
| Provider HTTP errors are built once in the shared retry seam; 429 is already a retryable status with `Retry-After` and redacted bodies. | `src/providers/transport.ts:31` (`ProviderTransportError`); `packages/prism-providers/src/shared/retry-http.ts:12` (`RETRYABLE_STATUSES`), `:31` (`readRetryAfterMs`), `:39` (`parseErrorBody`), `:51` (`providerHttpError`) | Task 6 classifies at `providerHttpError`, from status plus redacted body only. No per-adapter copies, no header/body leakage, `unknown` as default. |
| Guardrail stages are a closed union with per-stage value typing; the runner and its concurrency cap are shared. | `src/contracts-core/run-limits.ts:63` (`GuardrailStage = "input" | "output" | "tool_input" | "tool_output"`), `:92` (`Guardrail`); `src/guardrails.ts:33,48,89` (`RunGuardrailsOptions`, `runGuardrails`, `assertGuardrailsAllowed`) | Task 5 needs **no** new stage — `"output"` already exists and the gap is the missing reusable factory, not a stage. `runGuardrails` stays unchanged. |
| Model capabilities are an advisory metadata bag that hosts read for pinning; provider catalogs stamp `thinkingFamily` derived from conformance runs, walked by a cross-catalog test and rendered into an evidence matrix. | `src/contracts-core/content.ts:123-143` (`ModelCapabilities`); stamps in `packages/prism-providers/src/*/models.ts` (e.g. `packages/prism-providers/src/anthropic/models.ts:131`); `packages/prism-providers/src/__tests__/thinking-conformance.test.ts`; `packages/prism-providers/scripts/generate-thinking-coverage.mjs`; `docs/_evidence/thinking-coverage-2026-09-05.md`; `docs/provider-conformance.md` | Task 7 clones this pattern for a second axis (`toolCallStrictness`). No runtime probes, no vendor marketing claims, absent field = unknown. |
| AG-UI input is fully schema-validated and byte-bounded, but the legacy no-projector path *rejects* client state/tools with `ERR_PRISM_AG_UI_INPUT`; interrupt resolution is deliberately `approve`/`deny` only. | `packages/ag-ui/src/input.ts:27` (`parseAgUiInput`), `:65` (`defaultAgUiInput` — throws when `tools.length !== 0 || !emptyState(state)`); `packages/ag-ui/src/handler.ts:64` (`AgUiInputOptions.project`), `:74` (`AgUiPreparedInput`), `:96` (`AgUiInterruptResolution`), `:160` (`createAgUiHandler`), `:237` (`resolveAgUiCapabilities`) | Task 3 makes server-authoritative mode a sanitize step on `ParsedAgUiInput` (state → `undefined`, tools → `[]`) applied before both the projector and the default path. Bounds and fail-closed parse stay untouched. |
| Composition inspection is zero-network and reports configuration posture without reading stores or emitting secrets. | `src/host-composition.ts:50` (`HostCompositionReport`), `:219` (`inspectHostComposition`), `:380` (`assertHostCompositionReadiness`) | Task 4's snapshot inherits the zero-network and redaction rules; it is a new pure function, not a change to composition inspection. |
| Execution timeline projects steps with kind, status, and a content policy; no stop-reason field exists yet, and no terminal event carries one. | `packages/prism-core/src/governance/observability/timeline-types.ts:19-35`; `timeline.ts`; terminal-ish events today: `turn_finished` (`src/contracts-protocol.ts:208`), `run_limit_exceeded` (`:272`), `queue_updated` (`:273`), `steer_rejected` (`:276`) | Task 2 adds `stopReason` additively to the result, the ledger `RunRecord`, and the timeline projection. No new event type; `run_limit_exceeded` is the vocabulary precedent. |

## Frozen vocabulary (new, additive only)

| Gap | New public surface | Explicitly out |
| --- | --- | --- |
| G1 | `AgentRunStateOptions.checkpointPolicy?: "decision" \| "every-turn"` (default `"decision"`); a third resume action `"continue"` accepted only by `resumeAgentRun`/`resumeAgentRunStream`; `docs/durable-runs.md`; `examples/durable-investigation.ts` | `"continue"` in `ApprovalOutcome`/`AgUiInterruptResolution`/server routes; a second checkpoint format; any auto-replay of ambiguous tool effects |
| G2 | `RunOptions.turnPolicy?: { maxTurns?: number; stop?: (ctx: TurnBoundaryContext) => TurnStopDecision }`; `stopReason: "host_policy"` on result/ledger/timeline | New event type; tool-argument or prompt text in `TurnBoundaryContext`; any change to `resolveRunLimits` narrowing law |
| G3 | `CreateAgUiHandlerOptions.inputPolicy?: { clientState: "honor" \| "ignore" }` (default `"honor"`) | Client-named tool execution; relaxing `parseAgUiInput` bounds; `continue` exposure via AG-UI resume |
| G4 | `snapshotRunBundle({ agent, config?, run? })` → `RunBundleSnapshot` with `schemaVersion` + SHA-256 digest; `docs/run-bundle.md` | Network/store reads; secret or connection-string content; a second hashing vocabulary |
| G5 | `createClaimGroundingGuardrail(options)` in `src/evidence-grounding.ts` (stage `"output"`, already in the union); `docs/guardrails.md` section | New guardrail stage; LLM-judge grounding; `@arnilo/prism-memory` dependency; whole-transcript error payloads |
| G6 | `ProviderFailureClass`; `ErrorInfo.failureClass?` → result/ledger/tool errors; classifier in `providerHttpError` | Per-adapter error types; message-string parsing in hosts; body/header leakage; changed retry counts |
| G7 | `ModelCapabilities.toolCallStrictness?: "strict" \| "lenient" \| "legacy"`; catalog stamps; conformance walk; `docs/_evidence/toolcall-coverage-<date>.md` | Runtime probes; inferred upgrades; new dependency; a twelfth publishable package |

## Later-task mapping

| Task | Frozen primitive or explicit boundary |
| --- | --- |
| 1 (G1) | `saveAgentRunState` (`src/agent-run-state.ts:189`) called at the loop turn boundary when `checkpointPolicy === "every-turn"`; resume accepts a running-state checkpoint only via the new `"continue"` action; fingerprint/`expectedVersion`/ownership gates unchanged; ambiguity law (no auto-replay after unpersisted side effects) documented as the bounded window. |
| 2 (G2) | `turnPolicy.stop` evaluated at the same boundary; `stopReason` additive on `AgentRunResult` (`src/contracts-run-state.ts:285`), `RunRecord` (`src/contracts-protocol.ts:519`), timeline projection; `steer()` and its caps untouched. |
| 3 (G3) | Sanitize `ParsedAgUiInput` before projector/default path when `clientState === "ignore"`; parser bounds and `ERR_PRISM_AG_UI_INPUT`/`ERR_PRISM_AG_UI_LIMIT` semantics unchanged for malformed input. |
| 4 (G4) | New `src/run-bundle.ts` reuse of `agentFingerprint`'s field vocabulary (`src/agent-run-state.ts:118`) plus `ResolvedRunLimits` and provider/loop identities; `SecretRedactor` at the boundary; zero network. |
| 5 (G5) | Factory returning an ordinary `GuardrailDefinition` at the existing `"output"` stage; deterministic numeric attribution from run tool results; no memory-package dependency (citation shapes mirrored, not imported). |
| 6 (G6) | Single classifier beside `providerHttpError`; `failureClass` on `ErrorInfo`; adapters may stamp a provider `code` the classifier weighs; retry policy and budgets unchanged. |
| 7 (G7) | `toolCallStrictness` stamped only from conformance-observed behavior; cross-catalog walk cloned from `thinking-conformance.test.ts`; generator cloned from `generate-thinking-coverage.mjs`. |
| 8 | Additions-only compat diff, `docs/options-index.md` routes for the six new option surfaces, the two new `docs/index.md` entries, packed-size delta vs the baseline below. |

## Threat model and required posture

| Threat | Current protection | Required follow-through |
| --- | --- | --- |
| Forged resume `"continue"` from an untrusted caller | Resume is host-API only today; it already validates fingerprint, revision, ownership/fencing, and `expectedVersion` (`src/agent-run-lifecycle.ts:188-191`). | Task 1 keeps every gate, accepts running-state checkpoints only through the explicit action, and proves server/AG-UI surfaces still expose `approve`/`deny` only (`packages/ag-ui/src/handler.ts:96`). |
| Steer-queue flooding | Bounded queue (`DEFAULT_MAX_PENDING_STEERS = 8`, `DEFAULT_MAX_PENDING_STEER_BYTES = 64 KiB`, `src/contracts-run-state.ts:322,326`) with `steer_rejected` events. | Task 2 does not widen the queue or add a bypass; stop-then-steer tests assert the caps and event behavior survive. |
| AG-UI client-state trust | Client fields are parsed but carry no runtime authority; projection is host-owned (`packages/ag-ui/src/input.ts:27`, `packages/ag-ui/src/handler.ts:64`). | Task 3's `"ignore"` mode drops client state/tools before projection and keeps malformed/oversized envelopes failing closed. Client tool names still cannot reach the registry. |
| Bundle snapshot secret leakage | `SecretRedactor` already guards checkpoint payloads; composition inspection is zero-network (`src/host-composition.ts:219`). | Task 4 applies redaction to every string field, never reads stores/env, and adds a secret-shaped fixture test. |
| Guardrail bypass via missing evidence metadata | Guardrail runner fails closed (`src/guardrails.ts:48-89`). | Task 5 fails any numeric claim when no evidence set exists, never silently passes in flag mode (violation recorded), and bounds the reported span. |
| Error-classification leakage of provider headers/bodies | `providerHttpError` already redacts bodies; `ErrorInfo.message` is bounded (`src/contracts-core/content.ts:12`). | Task 6 classifies from status + redacted body, never copies headers, defaults to `unknown`, and secret-scans fixtures. |
| Crash-window double dispatch | The 0.6.0 contract persists tool results before treating a round as failed; resume never auto-replays an ambiguous side effect. | Task 1's `"every-turn"` policy narrows the ambiguity window to at most one provider turn of thinking and documents that residual window in `docs/durable-runs.md`; no auto-replay is added. |

## Plan corrections found during review

- `packages/prism-ag-ui` does not exist; the package directory is `packages/ag-ui` (name `@arnilo/prism-ag-ui`). Task 3 and Task 8 references use `packages/ag-ui`.
- `saveRunCheckpoint` does not exist; the single save path is `saveAgentRunState` (`src/agent-run-state.ts:189`), driven by `persistDurable` (`src/agent-session/session/persist.ts:14`).
- Resume of a crashed (never-suspended) run is today impossible by construction: `:191` requires `status === "suspended"`. Task 1 must add the running-state acceptance for the new action, and `assertValidAgentRunResume` (`src/agent-approval.ts:54`) must learn the action without touching `ApprovalOutcome`.
- G6 placement is `ErrorInfo.failureClass?` (`src/contracts-core/content.ts:12`), not a bespoke `AgentRunResult` field: `AgentRunResult.error`, `RunRecord.error`, and `ToolResult.error` already share `ErrorInfo`.
- G3 seam is sanitizing `ParsedAgUiInput` before both `project` and `defaultAgUiInput`; changing only `defaultAgUiInput` would leave projector-based handlers accepting unauthoritative client state.
- G5 needs no new stage: `"output"` exists in `GuardrailStage` (`src/contracts-core/run-limits.ts:63`).
- G7's conformance machinery is `packages/prism-providers/src/__tests__/thinking-conformance.test.ts` + `packages/prism-providers/scripts/generate-thinking-coverage.mjs` + `docs/_evidence/thinking-coverage-2026-09-05.md`; there is no `packages/prism/testing/provider-conformance`.

## Task 8 baseline

Measured 2026-09-17 with `npm pack --dry-run --json` at `a7915d6c` (304 dirty files, 0.8.0 line in progress), **after** this review doc landed, so Task 8 compares like-for-like. These are the plan-line reference points Task 8 reports deltas against; they are not new enforced budgets. Current `scripts/budgets.json` root baselines (plan 079 Task 1, 2026-09-15) are `1,247,731 / 4,137,527 / 489`; the root measurement below sits **+4.0% packed** against that baseline (tolerance 5%).

| Package | Packed bytes | Unpacked bytes | Files |
| --- | ---: | ---: | ---: |
| `@arnilo/prism` (root) | 1,297,619 | 4,285,038 | 499 |
| `@arnilo/prism-ag-ui` | 101,715 | 428,130 | 86 |
| `@arnilo/prism-core` | 385,689 | 1,876,362 | 422 |

Pack paths are `packages/ag-ui` and `packages/prism-core`; `@arnilo/prism` is the repo root. This review doc alone accounts for +5,948 packed / +18,060 unpacked / +1 file (`docs/history` is packed into the root tarball). Tasks 1, 4, and 7 add three more docs (`docs/durable-runs.md`, `docs/run-bundle.md`, the tool-call evidence matrix) plus this plan's source growth, so the root baseline will likely need a dated `$comment` rebaseline in Task 8 — the plan 079 Task 1 precedent — rather than being reported as over-tolerance after the fact.

## Existing verification evidence

- Durable run state, resume, and checkpoint primitives: `src/__tests__/agent-run-state.test.ts`, `durable-loops.test.ts`, `checkpoint-event-primitives.test.ts`.
- Steer, limits, guardrails, composition: `src/__tests__/run-limits.test.ts`, `guardrails.test.ts`, `host-composition.test.ts`.
- AG-UI input handling and interrupt resolution: `packages/ag-ui/src/__tests__/` (handler/input suites, A2UI and resume cases).
- Provider retry/error seam: `packages/prism-providers/src/__tests__/` transport and retry suites (`provider-transport`), plus per-provider HTTP adapter tests.
- Conformance walk precedent: `packages/prism-providers/src/__tests__/thinking-conformance.test.ts`.
- Budget/baseline gates: `scripts/budget-gates.mjs` (`measureRootPack`), `scripts/budget-gate.test.mjs`, `scripts/release.mjs gate --update-baseline`.
