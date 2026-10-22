# @arnilo/prism-evals

Host library providing evaluation, datasets, scorers, judges, experiments, and multi-turn scenarios for Prism agents. It operates over public `Agent` and `Session` surfaces and does not construct an agent directly.

Imports into host libraries are strictly governed by [`scripts/host-surface-allowlist.json`](../../../scripts/host-surface-allowlist.json).

## Capabilities

- **Datasets**: `defineDataset({ id, items })` with revision pins (`validateEvalManifest`, `validateReleaseEvalManifest`).
- **Citation checks**: `checkCitationIntegrity` and `approvalEvidenceIntact` live here. Artifact record types stay on `@arnilo/prism`.
- **Scorers**: deterministic trajectory scorers (`createToolCallMatchScorer`, `createApprovalBeforeEffectScorer`, `createSchemaScorer`, `createCitationIntegrityScorer`, `createErrorClassScorer`), ERP invariant scorers, and custom scorers (`defineScorer`).
- **Judges**: model-based judges (`createModelJudge`, `createComparisonJudge`) evaluating rubrics, pairwise comparisons, and rationale. Judge configs use model refs and carry per-case invocation costs; deterministic scorers should be preferred where feasible to avoid model inference overhead.
- **Experiments**: `runExperiment({ agent, dataset, scorers, trials })` running datasets over agents with bounded concurrency, error handling, trials aggregation, and uncertainty estimation.
- **Multi-Turn Scenarios**: `runScenario(scenario, agentFactory, options)` running conversational clarification, refusal, and multi-turn workflows over host-built agents.
- **Failure Injection**: controlled synthetic testing via `failureInjection(options)` (`AgentConfig.hooks` function denying tools via `tool.call` and marking unknown effects via `tool.execute`) and `failingStore(store)` wrapping a `SessionStore` to fail on first append.

## Usage Example

```ts
import { createAgent } from "@arnilo/prism";
import {
  defineDataset,
  defineScorer,
  runExperiment,
  runScenario,
  failureInjection,
  failingStore,
} from "@arnilo/prism-evals";

// Multi-turn scenario with failure injection
const result = await runScenario(
  {
    turns: [
      { user: "Transfer 50 USD", assertReply: (text) => text.includes("confirm") },
      { user: "Yes, confirm", assertReply: (text) => text.includes("denied") },
    ],
  },
  (extra) => createAgent({
    model: { provider: "mock", model: "demo" },
    ...extra,
  }),
  {
    hooks: failureInjection({ denyTools: ["transfer"] }),
  },
);

console.log("Scenario status:", result.status);
```

## Judge Invocations & Costs

Model judges (`createModelJudge`, `createComparisonJudge`) invoke an LLM for each evaluation item. In large datasets or repeated trials, model judge costs scale linearly with item count (`O(items * trials)`). Prefer deterministic rule and schema scorers (`createToolCallMatchScorer`, `createSchemaScorer`, `createErrorClassScorer`) for continuous CI/regression checks, reserving model judges for semantic quality gates.
