# Migrate Prism 0.12 to 0.13

> **Status: 0.13.0** (the kernel freeze: one package system, one hook model, native packages).

This document is the host checklist for upgrading from Prism 0.12.1 to 0.13.0.

0.13.0 is the kernel freeze. `@arnilo/prism` is a small SDK kernel on Bun — an agent/session runtime, one hook bus, four slots, the package system, and the safety floor. Every capability is a package built on the same API a third party uses, and the kernel never names a package. There are no compatibility aliases: a 0.12 mechanism is replaced and the old one is deleted in the same release. The era index of every migration note is [migration.md](migration.md).

## What a 0.12.1 host must check before upgrading

- **`createAgent` is async and takes `packages`.** `await createAgent({ model, packages: [...] })`. A package changes behavior by being listed; nothing is copied in through `activateKernel()`.
- **`defineAgent` and `@arnilo/prism-agent-sdk` are retired.** Its planes map onto `createAgent` and the native packages (below).
- **The 0.12 family packages are replaced by native packages.** Move every `@arnilo/*` dependency and peer to the native name (below).
- **The eight 0.12 interception mechanisms become hooks.** `middleware`, `guardrails`, `stopHooks`, `turnPolicy`, `providerRequestPolicies`, `instructionInjectors`, `context`, `toolNarrowing`, `inputBuilder`, `promptBuilder`, `permission`, and the `loop` options are removed, not aliased (below).
- **Removed root exports moved or were deleted.** Import the wire helpers from `@arnilo/prism/provider-kit`, and the moved modules from their owning package (below).
- **`prism -p` is gone.** The `prism` bin is the manifest CLI plus `prism relay`; run an agent through the reference host or your own host.
- **`@arnilo/prism-code` is gone from the repository.** The reference host is the private `apps/prism-agent`; see its [walkthrough](../apps/prism-agent/README.md).
- **Secrets are refs.** Config and the manifest carry `env:` / `keyring:` refs; a literal secret fails closed. Secrets never appear in argv, logs, events, `inspect()`, or errors.

## createAgent: 0.12 → 0.13

| 0.12 | 0.13 |
| --- | --- |
| `const agent = createAgent({ ... })` | `const agent = await createAgent({ ... })` — construction is async because packages load and resolve at creation |
| `createAgentSession(...)`, `createExtensionKernel()` | `await agent.session()`; a package registered through `packages: [...]` |
| `tools: { use: ["coding"] }` | `packages: [coding({ root })]` — a package instance, not a name |
| `provider: "anthropic"`, `model: "claude-..."` | `model: "anthropic/claude-sonnet-4-5"` (split on the first `/`) or a `ModelSpec`, plus the provider package |
| `memory: { compaction: "llm" }` | `packages: [compactionLlm()]` |
| `web: { backend: "brave" }` | `packages: [toolsWeb({ backend: "brave" })]` |
| `extensions: [...]`, `activateKernel()` | `packages: [...]` — installed is listed is active |
| `identity: { profile: "local-operator" }` | `principal: { kind, id }` — opaque to the kernel; enforcement lives in the packages that need it. Tools with durable effects (`shell`, `write`, `edit`) in `@arnilo/prism-tools/coding` fail closed with `ERR_PRISM_CODING_PRINCIPAL_REQUIRED` unless the agent has one |
| `stopHooks: [...]` | a package's `run.end` hook, or `AgentConfig.hooks` |
| `store: "memory"` | the store slot default; list a store package for anything durable |

`createAgent` rejects with `model_required` when no model is given and the `loop` slot's strategy does not declare `usesModel: false`. There is no default model or provider.

## Removed config fields → the package that owns them

The 0.12 config fields and registries are removed, not aliased. Each maps to a hook or a package:

| 0.12 field | 0.13 home |
| --- | --- |
| `contextBudget`, `toolResultFold`, `toolsDisclosure`, `toolsSearch`, `attentionCompiler` | `@arnilo/prism-extensions/context-engineering` (`context.build`) |
| `middleware` (`provider_request`, `tool_call`, `tool_result`, …) | the matching hook: `model.request`, `tool.call`, `tool.result` |
| `guardrails` (4 stages) | `@arnilo/prism-extensions/guardrail-packs` (`tool.call`, `tool.result`, `run.input`, `model.response`) |
| `stopHooks` | `run.end` (`@arnilo/prism-tools/coding`'s continuation stop hook is the reference) |
| `turnPolicy` / `TurnPolicyOptions` | `turn.before`, cost policy |
| `providerRequestPolicies` | `model.request` |
| `instructionInjectors`, `context`, `promptBuilder`, `inputBuilder` | `context.build` (`@arnilo/prism-extensions/context-files`, `@arnilo/prism-extensions/context-engineering`) |
| `toolNarrowing` | `RunOptions.tools.only` (a run narrows; a package registers tools) |
| `permission` / `PermissionPolicy` | `@arnilo/prism-extensions/approval` (`tool.call`); hard denies stay in `@arnilo/prism-tools/coding` |
| `loop` options (`AgentLoopStrategy`) | the `loop` slot; `@arnilo/prism-hosts/driver-process` and `@arnilo/prism-extensions/workflows`' `workflowLoop` claim it |
| `identity`, `resolveRunIdentity` | `@arnilo/prism-extensions/governance` |
| `beforeProviderTurn` | `model.call` (around) |
| `forwardAgentEvents` | the `observe` hook for every `AgentEvent` type |

## defineAgent / @arnilo/prism-agent-sdk → createAgent

`@arnilo/prism-agent-sdk` (last published 0.1.0) is retired, and so is the 0.12 `ExtensionAPI` registration surface (its 21 `register*` methods did nothing until the host copied them into `createAgent`). Its planes map as follows:

| 0.12 SDK plane | 0.13 home |
| --- | --- |
| `defineAgent({ skills })` | kernel skills (`AgentConfig.skills`) |
| `defineAgent({ instructions })` | `@arnilo/prism-extensions/context-files` (`AGENTS.md` / `SYSTEM.md` layering) |
| `defineAgent({ hooks })` | `@arnilo/prism-extensions/hooks-json` or a host `hooks` registration |
| `defineAgent({ mcp })` | `@arnilo/prism-extensions/mcp` |
| `defineAgent({ tools })` | `packages: [...]` plus `tools: { add }` / `disable.tools` |
| presets | removed; there is no preset registry |

## 0.12 family package → native package map

| 0.12 package | 0.13 package(s) |
| --- | --- |
| `@arnilo/prism-providers` | `@arnilo/prism-ai/<vendor>` — install `@arnilo/prism-ai` once, then import or add a provider subpath. All eleven providers, including `commandcode` and `ollama-cloud`, ship at 0.13.0. For other vendors, write a package on `@arnilo/prism/provider-kit`. |
| `@arnilo/prism-core` | the kernel `@arnilo/prism` plus the native packages below |
| `@arnilo/prism-coding-tools` | `@arnilo/prism-tools/coding`, `@arnilo/prism-tools/openapi`, `@arnilo/prism-tools/computer-use`, `@arnilo/prism-extensions/approval`, `@arnilo/prism-hosts/devtools` |
| `@arnilo/prism-web-tools` | `@arnilo/prism-tools/web`, `@arnilo/prism-tools/browser` |
| `@arnilo/prism-memory` | `@arnilo/prism-memory-{core, compaction, system}` (the fabric is `memory-system`'s `ltm`), `@arnilo/prism-knowledge/rag`, `@arnilo/prism-knowledge/wiki` |
| `@arnilo/prism-work` | `@arnilo/prism-tools/work` |
| `@arnilo/prism-hooks` | `@arnilo/prism-extensions/hooks-json` |
| `@arnilo/prism-office` (retired in 0.8) | `@arnilo/prism-tools/work` |
| `@arnilo/prism-agent-sdk` | retired; `@arnilo/prism` plus the native packages |
| `@arnilo/prism-acp-agent` | `@arnilo/prism-hosts/acp` (`serveAcp`) |
| `@arnilo/prism-code` | retired; the private reference host `apps/prism-agent` |
| `@arnilo/prism-all` | retired; install the packages you list |
| `@arnilo/prism-extensions/mcp`, `@arnilo/prism-hosts/ag-ui`, `@arnilo/prism-hosts/channels`, `@arnilo/prism-hosts/evals`, `@arnilo/prism-extensions/workflows`, `@arnilo/prism-extensions/model-router` | the same name, reused by the 0.13 package or host library |

### The retired names are unpublished from npm

The 0.12 family is deleted, not deprecated. On 2026-11-09 the 66 legacy names were unpublished, so a
0.12 host that adds `@arnilo/prism-core` now gets a 404 instead of a deprecation warning. Only
`@arnilo/prism` keeps its 0.12.x line, because it is the kernel. The names 0.13.0 reuses —
`@arnilo/prism-extensions/mcp`, `prism-ag-ui`, `prism-channels`, `prism-evals`, `prism-workflows`,
`prism-model-router`, `prism-provider-openrouter`, `prism-rag`, `prism-wiki`,
`prism-provider-opencode-go` — do not resolve until that publish either. The migration path is the map
above; the inventory, the plan and the commands that ran are under `docs/_evidence/registry/`.

## Memory packages

`@arnilo/prism-memory` is replaced by `@arnilo/prism-memory-system` (root and `/core` store libraries) and `@arnilo/prism-extensions/compaction`, with retrieval and the wiki outside memory as `@arnilo/prism-knowledge/rag` and `@arnilo/prism-knowledge/wiki`. The memory-system and knowledge bundles ship as `0.13.0-experimental.N` on the npm dist-tag `experimental`, outside the stability promise of the stable packages. A `^0.13.0` range never matches a prerelease, so install them with the tag:

```bash
bun add @arnilo/prism-memory-system@experimental
```

Their API, config, preset contents and defaults may change or be removed in any release until they graduate. `@arnilo/prism-extensions/compaction` is stable and is the only memory package the stable core and the reference host's default agents load.

## Fabric: the pinned core is now the standing rules

`@arnilo/prism-memory-fabric` renames its always-loaded core to **standing rules**. 0.13.0 is unpublished and there is no alias for a prerelease name.

| Before | 0.13 |
| --- | --- |
| config `core: false \| { maxTokens, scopes, kinds }` | `rules: false \| { capture, maxTokens, scopes, kinds }`. `maxTokens` defaults to 600, or 2,000 when `capture` is `"confirm"`; hard limit 3,000 (was 1,000). |
| per-scope `core.md`, derived and overwritten on every rebuild | per-scope `rules.md`, **editable**: an added line becomes a pinned human rule, a deleted line retires its note, a changed line supersedes it. Hosts and tools that read `core.md` read `rules.md`. |
| prefix block source `fabric-core`, heading `Core memory (…)` | `fabric-rules`, heading `Standing rules (…)` |
| `createFabricCore`, `resolveFabricCoreOptions`, `FabricCore*` (internal builders) | `createFabricRules`, `resolveFabricRulesOptions`, `FabricRules*` (not part of the stable root export set) |
| decision capture only in the `coding` preset | `rules: { capture: "confirm" }` in any preset; it also captures preferences and procedures. The `coding` preset sets it, adds `procedure` to its kinds, and is revision 2. |
| path-scoped notes could ride in the core | path-scoped rules are not in the block; they load as path cues |

`@arnilo/prism-memory-system/core`'s markdown store: `writeDerivedFile` now keeps a file a person edited (it resolves `false`) instead of overwriting it, accepts `{ replaceEdited: true }`, and the store gains `readDerivedFile(scope, name)`. The `**overwritten**` `log.md` line is gone.

## Fabric: features removed by the plan 210 audit

Plan 210 measured or tested every optional fabric feature. The 14 below are removed from `@arnilo/prism-memory-fabric` (0.13.0 is unpublished, so there is no alias). A host config that still sets one fails closed when the package loads: `Package @arnilo/prism-memory-fabric config is invalid: <path> unknown key "<field>"`. The error names the field; this table is the migration hint. `conversational` and `coding` preset requests are unchanged, except for the three measured behaviour changes listed after the table.

| Removed | Was | Migration |
| --- | --- | --- |
| config `retrieval` (`"hybrid"`) and `limits.maxVectorDimensions`; the `embeddings` service use; `CreateMemoryFabricOptions.retrieval` | an embeddings leg fused with lexical search | none: retrieval is lexical. `createMemory({ embedder })` is a library option and is unchanged; the fabric package no longer reads the `embeddings` service |
| config `linker`, `evolution`, `passive`; `MemoryFabricLinkerOptions`, `MemoryFabricEvolutionOptions` | workers that wrote `related` links and patched neighbour keywords on a write | none; pass explicit `links` to `memory.insert` / `remember` |
| config `consolidate.decider` and `consolidate.model`; `createMemoryFabric({ resolveModelClient })` for the decider, `onDeciderFailure`; the `decide_memory` tool | a model call that chose ADD / UPDATE / SUPERSEDE / NOOP per near-duplicate write | Dice consolidation is the only write-time rule; pass `supersedes` to retire a note |
| `decisions.points` entries `"P1"`, `"P2"`, `"P6"`; `FabricDecisions.applies`, `.supersession`, `TurnDecision.durable`, `SupersessionChoice` | decision-model gates for durable capture, supersession and path-rule applicability | remove them from `points`; `"P3"`, `"P4"`, `"P5"` and `"P7"` stay |
| config `state` and `StateConfig`; `memory.recall` result field `state` | one model call per explicit recall that wrote a current-state table | none; the grouping markers stay |
| config `scoped`; `createScopedMemoryPolicy`, `runScopedMemoryEval`, `ScopedMemory*` types, `.memory/state.json` ledger | the 0.12 scoped policy layer (activation floor, approval, fact block, `gcPass`) | `inject` (relevance floor), the note lifecycle (archive rule) and standing rules cover its parts |
| config `lifecycle.widen`; `memory:maintain` report fields `widened` and `superseded`; note metadata `widenedTo`; `LifecycleNoteView.widen`; `CreateMemoryFabricOptions.openScope` | widening a lesson to the `agent` scope across projects, and narrowing a contradicted wider note | explicit writes choose the scope. The model tools still cannot write `agent`: the error code is now `agent_scope_not_writable` (was `agent_scope_requires_widening`) |
| `similar` links written by consolidation | a link from a near-duplicate insert to its neighbour | none; pass explicit `links` |
| config `recall.supersessionHint` | `"all"` (default) or `"keyed-only"` marker for older group members | none: the `"all"` behaviour is the only one |
| exchange archive keywords (`exchangeKeywords` is no longer written to exchange notes) | deterministic entities, dates and category terms added to each archived exchange | none; the exchange text is indexed as written |
| exchange `dates` resolution (`resolveDates`) and the `memory.recall` tool parameters `from`, `to` and `order` | resolved event dates and a time window / time order on recall | none; `gather` still lists oldest first |

Measured behaviour changes (plan 210 wave 1, each negative for the feature in the leave-one-out arm): exchange keyword enrichment, the timeline (`dates`, `from`, `to`, `order`) and the `keyed-only` supersession marker. `memory.recall` results for exchange notes no longer carry enrichment keywords or resolved dates, and the `memory.recall` tool schema lost `from`, `to` and `order`. Read-time grouping of archived exchanges by shared subject terms read those keywords, so it no longer groups them; keyed notes and `supersedes` edges still group. The `similar` link and the widening wording also change what the model sees in a `memory.insert` result and the `key` parameter description.

Five features are held in the experimental tier (they may change in a minor version): `recall.multiQuery`, `recall.unmatchedTerms`, `recall.stateGrouping`, `delivery.directory` and `navigation.agenticLexical`; see the fabric README's `## Compatibility`.

## Wiki → knowledge outside memory

Plan 216 Task 3 (owner decision 2026-11-08) moved the ontology out of memory. The development line's package names change with no alias: a manifest or host config that still names an old package fails closed with the loader's own `package_missing` or `import_failed` error, which names the package.

| Before | Now |
| --- | --- |
| `@arnilo/prism-memory-wiki` (`packages/memory/wiki`) | `@arnilo/prism-knowledge/wiki` (`packages/knowledge/wiki`); the factory is `wiki(config)` (was `memoryWiki`) |
| `@arnilo/prism-memory-rag` (`packages/memory/rag`) | `@arnilo/prism-knowledge/rag` (`packages/knowledge/rag`); behaviour unchanged |
| the `memory.fabric` service (`MEMORY_FABRIC_SERVICE`, `FabricOntologyPort`, `createFabricOntology`) | `memory.ltm` (`MEMORY_LTM_SERVICE`, `MemoryLtmPort`, `createMemoryLtmPort`): read-only (`scopes`, `scopeId`, `epoch`, `read`, `scanMetadata`, `activity`, `deletions`); the wiki keeps its own concepts |
| `memory.fabric.concept-deletion` (`createConceptDeletionHandler`, `MEMORY_FABRIC_CONCEPT_HANDLER_SERVICE`) | none: the wiki reads memory's deletion feed after every retraction epoch and reads every cited id back when it opens |
| the fabric's `concept` note kind, concept-first `memory.recall`, the concept prior, the directory's concepts line, the passive and path-cue concept pointers, concept sharing (`memory:share`) | concepts live in the wiki's store (markdown under `wiki.root`); `wiki.search` returns them with their cited claims, `wiki.read` drills down, and the wiki adds its own passive pointer. A concept note an older version stored in memory is unreadable there (reason `retired-concept`) |
| fabric config `ontology.bindThreshold`, `ontology.conceptPrior`, `ontology.maxClaimsRendered` | removed; unknown config fails closed. The wiki takes `bindThreshold` and `search.maxClaimsRendered`; the concept prior is gone |
| subject binding at memory write time and through the extractor | the wiki binds at ingest and on its pass; memory keeps a `subject` a writer gives as a topic key, and the extractor's `subject` field is ignored |
| `wiki_ingest` staged under the fabric's `tools.root` as a fabric `file` note | staged under `<wiki.root>/sources/<id>/` and recorded in the wiki's store; no LTM note is written. Keep `wiki.root` outside memory's `tools.root`, which mirrors the files under it as notes |
| the wiki required `memory.fabric` and failed closed without it | no required service: the wiki runs on its own sources without memory, and `wiki:status` says so. A wiki root serves one project's memory; pointing a second project at it fails closed with `MemoryScopeError` |
| `resolveMemoryWorkerLimits`, `measureWorkerJson`, `truncateWorkerText`, `runMemoryWorkerLoop` (and their types) from `@arnilo/prism-memory-observational`; `ObservationalMemoryError`/`ObservationalMemoryLimitError` from the worker loop | `@arnilo/prism-memory-system/core`, with `MemoryWorkerError`/`MemoryWorkerLimitError` |
| `scanScopedMemoryContent` inside the fabric | `@arnilo/prism-memory-system/core` (the wiki runs the same trust scan) |

## Observational memory → `@arnilo/prism-memory-system`

Plan 216 Task 4 (owner decision 2026-11-08) moved the session tiers into the memory system, under the component names of the memory model (STM → WM → rehearsal → LTM). There is no alias: a manifest or host config that still names `@arnilo/prism-memory-observational` fails closed with the loader's own `package_missing` or `import_failed` error, which names the package. The old name was never published.

| Before | Now |
| --- | --- |
| `@arnilo/prism-memory-observational` (`packages/memory/observational`), `memoryObservational(config)` | `@arnilo/prism-memory-system` (`packages/memory/system`), `memorySystem(config)` |
| `memoryObservationalConfigSchema`, `resolveMemoryObservationalConfig`, `MemoryObservationalConfig` and the `MemoryObservational*` config types | `memorySystemConfigSchema`, `resolveMemorySystemConfig`, `MemorySystemConfig`, `MemorySystem*` |
| config `observer.*` (`observer.messageTokens`) | `stm.*` (`stm.triggerTokens`); config validation rejects the old key and `resolveMemorySystemConfig` names the successor |
| config `reflector.*`, `dropper.*` | `wm.*`, `rehearsal.*`; they run today's reflector and dropper until plans 218–219 |
| no way to pass a worker prompt or reasoning level from package config | `stm`/`wm`/`rehearsal` `.instruction` (appended to the default prompt) and `.thinkingLevel` |
| commands `om`, `om:model { observer?, reflector? }`, `om:status`, `om:view` | `memory:session`, `memory:session:model { stm?, wm? }`, `memory:session:status`, `memory:session:view` |
| event `om.status`; background task `om.observe` | `memory.session.status`; `memory.session.observe` |
| state `om` (`observerModel`, `reflectorModel`) and log `ledger` | state `memory.session` (`stmModel`, `wmModel`) and log `memory.session.ledger` |
| ledger record types `om.observations.recorded`, `om.reflections.recorded`, `om.observations.dropped`, `om.task_state.recorded`, `om.folded`, `om.compacted`, `om.context.pinned` | `memory.session.*`. A record under an old type fails closed with `MemorySessionLedgerError` (`retired_ledger_type`): export the session with the old package's `om:view`, or start a new session |
| context block title and compaction strategy `observational-memory`; heading `# Observational Memory`; block metadata `source: "om"` | `session-memory`; `# Session Memory`; `source: "memory.session"` |
| worker tools answered `{ ok: true }` even when nothing was stored | `{ ok: false, reason }` (`empty_content`, `no_valid_ids`, `unknown_id`, …) |
| an unread tail over `worker.maxMessageBytes` failed every pass | the tail is observed in batches with per-batch coverage; an oversized entry is cut with a marker |
| `examples/observational-memory.ts` | `examples/session-memory.ts` |

## Fabric → long-term memory in `@arnilo/prism-memory-system`

Plan 216 Task 5 (owner decision 2026-11-08) moved the fabric into the memory system as its long-term memory, the `ltm` component. There is no alias: a manifest or host config that still names `@arnilo/prism-memory-fabric` fails closed with the loader's own `package_missing` or `import_failed` error, which names the package. The sections above that name `@arnilo/prism-memory-fabric` describe the same fields, now under `ltm`.

| Before | Now |
| --- | --- |
| `@arnilo/prism-memory-fabric` (`packages/memory/fabric`), `memoryFabric(config)` | `@arnilo/prism-memory-system` (`packages/memory/system`, sources under `src/ltm`), `memorySystem({ ltm: config })` with the same fields. Without `ltm`, no long-term memory is set up |
| `memoryFabric(fabricConfig)` and `memorySystem(sessionConfig)` listed side by side | one `memorySystem({ ...sessionConfig, ltm: fabricConfig })`: listing the package twice fails with `duplicate_package` |
| `createMemoryFabric(options)` (direct SDK callers) | `createLongTermMemory(options)`; the options and the returned object are unchanged |
| a retired fabric field failed with `<path> unknown key "<field>"` | the same error at `/ltm/<path>` |
| `packageName` from the fabric root | removed; the package is `@arnilo/prism-memory-system` |
| the fabric's state (`fabric.*` session keys) under `@arnilo/prism-memory-fabric` | the same keys under `@arnilo/prism-memory-system`; state the old package wrote is not read |
| the shared session helpers the fabric imported from the memory-system root (`isMemoryId`, `recordData`, `serializeSessionEntry`, `recallObservationalMemoryBranchPage`, the type guards, token estimates and recall paging) | not exported: long-term memory imports them in-package |
| `memory.*` tools, `memory` commands, presets, stores, the `memory.ltm` service | unchanged: same names and behaviour, and the presets' provider requests are byte-identical |

### Long-term working memory, the episode view and episode merge (removed)

Plan 216 Task 7 (owner decision 2026-11-08) removed three long-term memory features; the working-memory name now belongs to the memory system's WM component. A retired config field fails closed when the package loads (`/ltm/<path> unknown key "<field>"`, or an enum error for a list value); a retired write or store fails with a named `MemoryValidationError` code.

| Removed | Was | Migration |
| --- | --- | --- |
| `kind: "working"`, labeled blocks, `MEMORY_FABRIC_WORKING_KEY`, `FABRIC_BLOCK_LABEL`, `readFabricBlock` | per-thread working memory in long-term memory, sent as the `fabric-working` tail block | write a durable kind (`fact`, `preference`, `procedure`, `decision`) or use the WM component; `remember({ kind: "working" })` fails with `working_memory_retired` |
| the `block` parameter of `memory.insert`, `memory.replace` and `memory.forget`; `working` in `memory.recall` `kinds`; `MemoryFabricForgetInput.block` | edits to a labeled working block | `memory.insert { kind \| path }`, `memory.replace { path \| id }`, `memory.forget { id }`. With `semantic: false` only file paths remain writable |
| config `ltm.workingMemoryTemplate`, `ltm.limits.maxWorkingMemoryBytes`, `"working"` in `ltm.inject.kinds` | the working block's template and byte cap | remove them |
| `Memory.getWorking`, `updateWorking`, `deleteWorking`, `renderWorking`, `createWorkingMemoryProcessor`; `CreateMemoryOptions.workingStore`, `.schema`, `.validateWorkingMemory`, `.workingMemoryTemplate`; `MemoryContextProviderOptions.includeWorking`; `MemoryLimits.maxWorkingMemoryBytes` | the library working-memory API | none in long-term memory; drop the calls and options |
| `WorkingMemoryStore`, `WorkingMemoryRecord`, `WorkingMemoryKey`, `WorkingMemoryUpdateMode`, `WorkingMemoryUpdateOptions`, `WorkingMemoryProcessorOptions`, `renderTemplate` (`@arnilo/prism-memory-system/core`); `createMemoryWorkingStore`, `MemoryWorkingStoreOptions` (`@arnilo/prism-memory-system`); the `workingStore` member of the SQLite, Postgres, markdown and conformance store sets and of `MemoryOkfStores`; `ExportMemoryOkfResult.working` | the working store contract and its drivers | pass only `vectorStore`. A markdown store (or OKF bundle) that still holds `<resource>/working/<thread>.md` fails to open with `working_memory_retired`: export what you need from the file (one fenced JSON block), then move the `working/` directory out of the root. An SQL `working_memory` table is left in place and never read |
| the episode view: `remember({ kind: "episode", id })` over an observational-memory id | a note read from the session ledger without writing a row | none yet: the `episode` kind is reserved for the stored episode (plan 219) and writing it fails with `episode_kind_not_available`. `observational` stays for `reflectionId` promotion and `searchConversation` |
| config `ltm.lifecycle.merge.episodes` (`minCluster`, `model`); `EPISODE_MERGE_TOOL`, `EPISODE_MERGE_SYSTEM`, `episodeClusters`, `summarizeEpisodeCluster`, `MAX_EPISODE_CLUSTER`, `DEFAULT_EPISODE_MIN_CLUSTER`, `EpisodeCluster`, `EpisodeSummary`; `memory:maintain` / `maintain()` report field `episodesMerged` | one model call per episode cluster during maintenance | remove the field; maintenance makes no model call |

The presets' context blocks are unchanged. Their tool schemas changed (the `block` parameters, the `working` kind and the descriptions that named them), so the tool catalogue the model sees changed with them.


### Wiki before plan 216 → ontology tier

`@arnilo/prism-memory-wiki` is no longer a second page store. It is the ontology tier over the fabric: concept notes in the fabric's own store, each claim citing the notes it rests on. It requires `@arnilo/prism-memory-fabric` (with `semantic` memory on) and fails closed with `missing_service` without it. There is no alias for any 0.12 name.

| 0.12 wiki | 0.13 |
| --- | --- |
| `wiki_search` | `memory.recall` (concept notes rank ahead of plain notes whenever the store holds any) |
| `wiki_read_page` | `memory.read` |
| `wiki_record_insight` | `memory.insert` (a `decision` note) |
| `.wiki/` pages, `.manifest.json`, `log.md` | `concept` notes (OKF markdown under the fabric store's `concepts/`) |
| `wiki-init`, `wiki-refresh` | none; the concept pass maintains the ontology from T1 evidence |
| `wiki-lint` | `wiki:lint [scope]`: a read-only report over concept claims (unresolved or stale citations, alias collisions, uncited human claims, ontology gaps); it checks cited claims, not `.wiki/` pages |
| `wiki-ingest` command | `wiki:ingest`; the `wiki_ingest` tool keeps its name and inputs. Sources now stage under `<tools.root>/sources/<id>/` and are indexed as fabric `file` notes (the fabric needs `tools.root`); the result carries `noteId`, `scope`, `indexed` and `subject`, and no longer carries a `.wiki/` filing checklist |
| `wiki-searcher`, `wiki-maintainer` skills, the `wiki-guidance` hook | removed; the fabric's directory and `memory.recall` do the discovery |
| `prism-wiki` bin, `runCli` | removed |
| `createWikiDeletionHandler`, `retireWikiSources`, `repointWikiSources`, `createWikiRepointHandler` | removed; forgetting a cited note removes the claims that cited it inside the fabric (`memory.fabric.concept-deletion` for a host-built propagator) |
| config `wikiRoot`, `rawRoots`, `profile`, `qmdPath`, `autoDeploySkills` | removed; unknown config fails closed. New: `consolidate`, `ingest` |
| code-base mapping (`profile: "codebase"`) | none in this package; use a code-intelligence tool |

## Removed root exports and where each went

| Removed from `@arnilo/prism` | 0.13 home |
| --- | --- |
| `thinking`, `cache-helpers`, `provider-request-policy`, `structured-output` helpers (`applyCacheControl`, `applyDefaultProviderRequestOptions`, the structured-output validators) | `@arnilo/prism/provider-kit` |
| `createEventMultiplexer` | `@arnilo/prism-extensions/workflows` |
| `runCheckpointRestoreHooks` | `@arnilo/prism-extensions/workflows` (`CheckpointRestoreAudit` stays on the kernel) |
| `CheckpointStore`, `LeaseStore`, their record/key/query types, `createMemoryCheckpointStore`, `createMemoryLeaseStore`, `CheckpointConflictError`, `LeaseConflictError` | `@arnilo/prism-extensions/workflows`; SQLite and Postgres store packages provide the durable services |
| `AgentConfig.runState`, `RunOptions.runState`, `AgentRunStateOptions`, `createAgentRunLifecycle`, `resumeAgentRun`, `resumeAgentRunStream`, `loadAgentRunState` | deleted; resume through the store slot's `suspended_run` entry and `session.resume(decisions)` |
| `prepareRunFeedback` | `@arnilo/prism-extensions/store-codecs` |
| `describeStorage` | `@arnilo/prism-extensions/governance` |
| `resolveDevicePolicy` | `@arnilo/prism-tools/computer-use` |
| `checkCitationIntegrity` | `@arnilo/prism-hosts/evals` |
| `createWorkflowInstrumentation`, `createTimelineFolder`, `createWorkflowTimelineFolder`, `projectAgentTimeline`, `projectTraceTimeline`, `projectWorkflowTimeline`, `TimelineError`, `summarizeTimeline`, `summarizeSession`, `addUsage`, `capToolCounts`, `createRagTelemetry` | `@arnilo/prism-extensions/observability` |
| `defineWorkflow`, `buildGraph`, `functionNode`, `agentNode`, `fanOutNode`, `joinNode`, `loopNode`, `conditionalNode`, `routeNode`, `workflowNode`, `runWorkflow`, `resumeWorkflow`, `suspend`, `replayWorkflow`, `createWorkflowCheckpoints`, `serializeWorkflowGraph`, `workflowGraphToMermaid`, `projectWorkflowGraphRun`, `createWorkflowEventBus` | `@arnilo/prism-extensions/workflows` |
| `snapshotRunBundle`, `resolveUseCaseModel`, `createCacheTelemetry`, `createProviderCapture`, `createMemoryPersistenceLifecycle`, `resolveAgentDefinition`, `discoverAgentBundles`, `createStaticSettingsProvider`, `createBatchedRunLedger` | deleted; no 0.13 replacement |
| `createMemoryAgentEventSource` | `@arnilo/prism/testing` |
| `runRpcServer`, `parseRpcRequest` | `@arnilo/prism-hosts/remote` (`serveAgent`, `connectAgent`) |
| `runPromptMode`, `CLI_PROVIDERS` | deleted; the `prism` bin is the manifest CLI plus `prism relay` |
| `isNodeErrorCode` | `@arnilo/prism-tools/coding` |
| `DelegationTelemetry.childId`, the `prism.delegation.child` attribute | `origin` on the event and `prism.origin.*` span attributes |
| `CommandDefinition`, `CommandExecutionContext`, `CommandDrivers`, `CommandWorkflowRun`, `CommandResult` | `PackageCommand` / `PackageCommandContext` — a package registers `{ name, description, args?, run(args, { session, host, agent }) }`, and the host-driver seam (`startRun`, `startWorkflow`, `steer`) is gone |
| `SpeechProvider`, `TranscriptionProvider`, `BatchJobsProvider`, `ModerationProvider`, `RealtimeSession`, `VideoGenerationProvider` | deleted from kernel; implement vendor-specific APIs in provider or host packages |
| Subpaths `./node/config`, `./node/settings`, `./node/agent-definitions`, `./node/contribution-discovery`, `./testing/agent-event-source-conformance`, `./testing/persistence-schema`, `./testing/feedback` | deleted; `./provider-kit`, `./net`, `./artifacts`, `./driver-kit`, `./manifest`, and `./testing` remain |
| `pinnedFetch`, `requestPinned`, `resolvePinnedAddress`, `defaultResolver`, `raceAbort`, `boundResponse`, `isLoopbackAddress`, `isLoopbackHostname`, `normalizeHostname`, `PinnedFetchOptions` | `@arnilo/prism/net` (`assertSsrfAllowedUrl` stays on the root) |
| `ArtifactRecord`, `ArtifactRevision`, `ArtifactApproval`, `ArtifactApprovalState`, `ArtifactDecisionState`, `ArtifactCitation`, `CitationSupport`, `ArtifactDeliveryToken`, `ArtifactBodyRef`, `ArtifactBodyStore`, `ArtifactBodyTransferOptions`, `ArtifactBodyPresignOptions`, `ArtifactBodyErrorCode`, `ARTIFACT_BODY_ERROR_CODES`, `ArtifactBodyStoreError`, `ArtifactError`, `ARTIFACT_CHECKPOINT_NAMESPACE`, `artifactCheckpointKey`, `artifactApprovalState`, `citationBindingDigest`, `HARD_CITATION_EXCERPT_BYTES` | `@arnilo/prism/artifacts` |
| `MODEL_FAMILY_TOKENS`, `ModelFamilyTokens`, `resolveModelFamily`, the `EventSubscriber` class | deleted; kernel-internal (`estimateMessageTokens` and `session.subscribe()` remain) |
| `RunLimitTracker` as a value | type only; build one with `createRunLimitTracker(limits)` |
| `resolveCredentialValue`, `CredentialValueSource` | deleted; a low-level provider factory, discovery helper, or kit client takes `apiKey?: SecretSource` (`() => Promise<string \| undefined>`) from `@arnilo/prism/provider-kit` — build it with `refSource(resolve, "env:…")`; a literal string no longer type-checks. `CredentialRecord` stays on the root |
| `resolveProviderApiKey(source, providerId, resolveCustom?, request?)` | `resolveProviderApiKey(source, resolveCustom?, request?)` on `@arnilo/prism/provider-kit`; `source` is a `SecretSource` |
| `AgentDefinition.create()`, `AgentDefinitionResolutionContext.activateAllCapabilities` | deleted; build the agent with `createAgent()` and list `tools` / `skills` by name |
| `InputAssemblyLayout` `"legacy"`, `RunOptions` / `AgentConfig` `inputLayout: "legacy"` | deleted; `"cache_aware"` is the only layout |
| `ModelCapabilities.toolCallStrictness: "legacy"` | deleted; `"strict"`, `"lenient"`, or absent (unknown) |
| The `RunOptions.maxToolRounds` `TypeError` guard (removed in 0.1.5) | deleted; set `RunOptions.limits.maxToolRounds` |
| `@arnilo/prism-hosts/channels/telegram` `CredentialValueSource`; literal `botToken` / `webhookSecret` | `ChannelSecretSource` (`() => Promise<string>`) on `createTelegramAdapter` / `createTelegramWebhookHandler`; `connectTelegram({ webhookSecret })` takes an `env:`/`keyring:` ref and rejects a literal with `ChannelTokenLiteralError` |
| `@arnilo/prism-tools/web` `WebCredentialSource` (accepted a literal, a callback, or a resolver) | `() => Promise<string \| undefined>`; the package resolves its `x-prism-secret` ref config and builds it |
| Memory internals that were never documented: prompts, `DEFAULT_*` / `MAX_*` / `MIN_*` / `HARD_*` tuning constants, scoring and eviction helpers, the lifecycle / directory / core builders, the observational workers, settings, flush, commands and compactor, and core's cursor codecs and directory scan (`@arnilo/prism-memory-fabric`, `-core`, `-system` roots) | no longer exported; the stable set is listed under `## Compatibility` in each package README |

## Retired interception mechanisms → hooks

The kernel fires exactly one hook model. Every 0.12 mechanism becomes a hook, and a package changes behavior by registering one:

| 0.12 mechanism | Hook |
| --- | --- |
| input guardrails, `InputBuilder` | `run.input` |
| `TurnPolicyOptions.stop`, cost policy | `turn.before` |
| `InstructionInjector`, `ContextProvider`, `ToolNarrowing`, the skills catalog, `PromptBuilder` | `context.build` |
| `ProviderRequestPolicy`, `provider_request` middleware | `model.request` |
| deterministic turns (`beforeProviderTurn`), routing, caching | `model.call` (around) |
| output guardrails | `model.response` |
| `PermissionPolicy`, tool-input guardrails, approval | `tool.call` (decide) |
| sandbox or remote execution wrappers | `tool.execute` (around) |
| tool-output guardrails | `tool.result` |
| redaction extensions | `message.append` |
| `StopHook` | `run.end` |
| `CompactionTrigger` | `compaction.when` |
| extension event bus, `forwardAgentEvents` | the `observe` hook for every `AgentEvent` type |

The gates live in the primitives, not the loop: tools run only through `RunController.executeTools` (which always fires `tool.call`), and model turns only through `RunController.turn`. A custom loop cannot bypass approval, guardrails, or memory.

## `prism -p` → the reference host or your own host

The kernel prompt runner (`prism -p`, `--provider`, `--model`, and the rest of the 0.12 agent flags) and `cli-providers` are gone. The `prism` bin is the manifest CLI (`prism add`, `prism new package`, `prism inspect`) plus `prism relay`. To run an agent, use the reference host or build one:

```ts
import { createAgent } from "@arnilo/prism";
import hyper from "@arnilo/prism-ai/hyper";
import coding from "@arnilo/prism-tools/coding";

const agent = await createAgent({ model: "hyper/claude-sonnet-4-5", packages: [hyper({ apiKey: "env:HYPER_API_KEY" }), coding({ root: process.cwd() })] });
const session = await agent.session();
for await (const event of session.stream("List the files here")) {
  if (event.type === "message.delta" && event.content.type === "text") process.stdout.write(event.content.text);
}
await agent.dispose();
```

## `@arnilo/prism-code` → the reference host

`packages/prism-code` is deleted from the repository. Its behavior lives in `apps/prism-agent`, a private, never-published reference host built only on `@arnilo/prism` and the native packages. The [Prism Agent walkthrough](../apps/prism-agent/README.md) covers its agents, workflow graph, external and remote workers, `HostUi` routing, scheduling, and entry points. `@arnilo/prism-code` 0.4.1 stays on npm as a deprecated package pointing at `@arnilo/prism` and the reference host.

## Secrets are refs

A 0.12 host that read a literal key from config must move it to a ref. Config and the manifest carry `env:` or `keyring:` refs, resolved at the provider edge. A literal secret in config now fails closed, and secrets never appear in argv, logs, events, `inspect()`, or errors. A host that calls a low-level provider factory directly passes a `SecretSource`, never a string:

```ts
import { refSource } from "@arnilo/prism/provider-kit";
createOpenRouterProvider({ apiKey: refSource((ref) => resolver.resolve(ref, {}), "env:OPENROUTER_API_KEY") });
```

```ts
// before — a literal key in config
createAgent({ provider: "anthropic", apiKey: "sk-..." });

// after — a ref, resolved by the provider package
await createAgent({ model: "anthropic/claude-sonnet-4-5", packages: [anthropic({ credential: "env:ANTHROPIC_API_KEY" })] });
```

## Upgrade steps

1. Move every `@arnilo/*` dependency and peer to its native 0.13 name (or to the kernel window `>=0.13.0 <1.0.0` for a package that peers `@arnilo/prism`).
2. `await` every `createAgent` call, and replace `tools.use` / `memory.*` / `web.backend` with the package instances that own them.
3. Replace `defineAgent` and `@arnilo/prism-agent-sdk` with `createAgent` plus the package list.
4. Move every config field in the tables above to its hook or package.
5. Import the wire helpers from `@arnilo/prism/provider-kit` and the moved modules from their owning package.
6. Replace `prism -p` with the reference host or your own host, and move literal secrets to `env:` / `keyring:` refs.
7. Move every durable run to `session.resume(decisions)`, with a decision for every pending request.

## Package authors

A package no longer pins a kernel version. It declares the kernel **API level** it was written
against, and the kernel loads it on any release that supports that level:

```ts
// before — a version range against a 0.x kernel
requires: { prism: "^0.12.0" }

// after — the kernel API level
requires: { api: 1 }
```

`requires.prism` stays optional, for a package that needs a fix from one release. The
`peerDependencies["@arnilo/prism"]` window widens to `>=0.13.0 <1.0.0`, so a kernel 0.14 does not
force a package release. A kernel change that breaks a contract packages implement or call adds API
level 2 instead, and the loader rejects a package targeting a level it does not support with
`kernel_api`. The stability promise is in `docs/compatibility.md`.

## Rollback

0.13.0 is a break, not a compatible widening, so rollback is a downgrade to the 0.12.1 line: restore the `^0.12.1` dependencies and peers, revert `createAgent` to the synchronous call, and restore the 0.12 family packages. Store schemas are unchanged by this cut, so a 0.12.1 host reopens a 0.13.0 store; a durable run suspended on the 0.13 `suspended_run` entry does not resume on 0.12.1, because that path is new.

### Extensions bundle

Install `@arnilo/prism-extensions` once and import its exported subpaths (for example `@arnilo/prism-extensions/store-sqlite`). Manifest entries retain the full subpath specifier. [The bundle page](../packages/extensions/README.md) lists all eighteen packages and optional peers. OS keyring, MCP, Postgres and observability dependencies are host-installed optional peers. No former package name is an alias.

### Tools bundle

Install `@arnilo/prism-tools` once, then import and list `@arnilo/prism-tools/{coding,web,browser,research,openapi,computer-use,work}`. Work libraries use `@arnilo/prism-tools/work/<library>`. Install the [optional Office peers](../packages/tools/README.md#dependencies-and-footprint) to keep Office tools enabled. No alias or compatibility package is shipped.

### Hosts bundle (plan 224 Task 7)

Install `@arnilo/prism-hosts` once and import host libraries through its subpaths; `packages/drivers/process` moved to `packages/hosts/driver-process`. Replace former host package names with `@arnilo/prism-hosts/{acp,ag-ui,channels,devtools,evals,headless,host-builder,mcp-server,remote,driver-process}`. Nested renderer, channel and testing imports keep their suffixes. Run the bins with `bunx --package @arnilo/prism-hosts prism-host-builder` or `bunx --package @arnilo/prism-hosts prism-devtools`. There are no compatibility aliases.

### Experimental bundle entries (plan 224 Task 8)

Install `@arnilo/prism-memory-system@experimental` and `@arnilo/prism-knowledge@experimental`. The memory system stays the default entry; its shared library is `/core` (also `/core/fabric`, `/core/sqlite`, `/core/postgres`). Knowledge uses `/wiki` and `/rag`, with no root barrel. The three former standalone names are retired; use these bundle specifiers in imports and manifest entries. Knowledge pins the memory-system version exactly. No memory behavior changes.
