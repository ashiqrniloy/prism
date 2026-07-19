# Use-case model selection

## What it does

Prism separates the **session chat model** (`AgentConfig.model` / `RunOptions.model`) from **use-case models** used by background or adjacent LLM jobs (observational memory workers, LLM compaction summarizers, declarative agents, supervisor children, evals). Hosts bind `{ model?, provider?, providerOptions?, thinkingLevel? }` per use case. When the use-case omits `model`, resolution falls back to the active session model. Workers never write `model_change` session entries for their own jobs.

## When to use it

- Observational memory should run a cheaper/faster model than the chat session (or inherit the session model when unset).
- LLM compaction should summarize with an explicit `summaryModel`, falling back to a host-supplied session `model`.
- Declarative agents, supervisor children, evals, and RPC/CLI runs already own their models — document them as use-case sites that stay separate from a parent session.
- Memory/RAG `Embedder` selection is related but **not** a chat `ModelConfig` binding.

## Contract

| Layer | Surface |
| --- | --- |
| Binding | `UseCaseModelBinding`: `{ model?, provider?, providerOptions?, thinkingLevel?, requireExplicitModel? }` |
| Resolver | `resolveUseCaseModel({ configured, sessionModel, requireExplicitModel?, … })` → `{ model, source }` or `undefined` |
| Binding helper | `resolveUseCaseModelBinding(binding, sessionModel)` |
| Credential id | `useCaseCredentialProviderId(resolved, binding?)` — always the **resolved** `model.provider` |
| Escape hatch | `requireExplicitModel: true` skips session fallback (OM historical `missing_model`) |

```ts
import { resolveUseCaseModel, applyThinkingLevel, thinkingFamilyForModel } from "@arnilo/prism";

// Prefer an explicit worker; otherwise inherit the session/agent model.
const resolved = resolveUseCaseModel({
  configured: settings.workerModel,       // optional use-case ModelConfig
  sessionModel: agent.config.model,       // host-supplied; AgentSession does not expose agent
  thinkingLevel: settings.thinkingLevel,
});
if (!resolved) {
  // skip — neither configured nor session model (or requireExplicitModel)
}

const family = thinkingFamilyForModel(resolved.model);
const providerOptions = resolved.thinkingLevel
  ? applyThinkingLevel(resolved.providerOptions, resolved.thinkingLevel, family === "noop" ? "reasoning_effort" : family)
  : resolved.providerOptions;
```

### Precedence

1. `configured` / `binding.model` → `source: "configured"`
2. Else `sessionModel` when `requireExplicitModel` is not set → `source: "session"`
3. Else `undefined` (package skips or throws)

Resolution is O(1) and network-free. It does not mutate session history.

## Binding sites

| Site | How hosts bind | Session fallback |
| --- | --- | --- |
| Observational memory | `workerModel` / settings `workerModel` + runtime `sessionModel` | Yes — pass `sessionModel: agent.config.model`; `requireExplicitModel` restores skip |
| LLM compaction | `summaryModel` with `model` as fallback slot | Yes — `resolveUseCaseModel({ configured: summaryModel, sessionModel: model })` |
| `RunOptions.model` | Per-run override on the **session** | N/A — this *is* the session/run model (writes `model_change`) |
| Declarative `AgentDefinition` | Definition `model` / registry resolve | Definition-scoped (independent agent) |
| Supervisor children | Child `createSession` / child `AgentConfig.model` | Independent child session |
| Evals / workflows / RPC / CLI | Caller `runOptions.model` | Caller-owned |
| Structured output | Reuses session/run model | Same as run |
| Memory / RAG | Host `Embedder` | Not a chat model — see [Working and semantic memory](working-and-semantic-memory.md) |

## Observational memory

```ts
createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  workerProvider,
  sessionModel: agent.config.model, // enables fallback when workerModel unset
  // workerModel: { provider: "neuralwatt", model: "glm-5.2-fast" }, // optional override
  overrides: { thinkingLevel: "low", observeAfterTokens: 1 },
});
```

- Default: no `workerModel` + `sessionModel` set → workers use the session model.
- Explicit `workerModel` (or settings `workerModel`) always wins.
- `requireExplicitModel: true` (runtime or settings) → `skipped: "missing_model"` when no worker model, even if `sessionModel` is set.
- Neither worker nor session model → `skipped: "missing_model"`.
- Default credential request uses the **resolved** model's `provider` id.

## LLM compaction

```ts
createLlmCompactionStrategy({
  provider: summaryProvider,
  summaryModel: { provider: "example", model: "cheap-summary" }, // optional
  model: agent.config.model, // session fallback when summaryModel omitted
  thinkingLevel: "low",
});
```

`summaryModel` wins; otherwise `model` is required. Thinking maps into `compat` via `applyThinkingLevel` ([Thinking and reasoning](thinking-and-reasoning.md)).

## Security

- Credential requests for worker calls must target the **resolved** model’s provider — not ambient session credentials for a different provider unless the host wires that explicitly.
- Pass known secrets into worker/compaction options so prompts, ledger custom entries, and errors stay redacted.
- Background workers must not append `model_change` entries or otherwise rewrite the chat session’s model timeline.

## Related pages

- [Thinking and reasoning](thinking-and-reasoning.md) — per-turn `thinkingLevel` → `compat`
- [Observational memory compaction package](compaction-observational-memory.md)
- [LLM compaction package](compaction-llm.md)
- [Agent/session runtime](agent-session-runtime.md) — `RunOptions.model` / `model_change`
- [Working and semantic memory](working-and-semantic-memory.md) — `Embedder` (non-chat)
- Evidence matrix: [Review coverage (2026-07-17 provider validation)](review-coverage-2026-07-17-provider-validation.md)
