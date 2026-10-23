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
| `identity: { profile: "local-operator" }` | `principal: { kind, id }` — opaque to the kernel; enforcement lives in the packages that need it |
| `stopHooks: [...]` | a package's `run.end` hook, or `AgentConfig.hooks` |
| `store: "memory"` | the store slot default; list a store package for anything durable |

`createAgent` rejects with `model_required` when no model is given and the `loop` slot's strategy does not declare `usesModel: false`. There is no default model or provider.

## Removed config fields → the package that owns them

The 0.12 config fields and registries are removed, not aliased. Each maps to a hook or a package:

| 0.12 field | 0.13 home |
| --- | --- |
| `contextBudget`, `toolResultFold`, `toolsDisclosure`, `toolsSearch`, `attentionCompiler` | `@arnilo/prism-context-engineering` (`context.build`) |
| `middleware` (`provider_request`, `tool_call`, `tool_result`, …) | the matching hook: `model.request`, `tool.call`, `tool.result` |
| `guardrails` (4 stages) | `@arnilo/prism-guardrail-packs` (`tool.call`, `tool.result`, `run.input`, `model.response`) |
| `stopHooks` | `run.end` (`@arnilo/prism-tools-coding`'s continuation stop hook is the reference) |
| `turnPolicy` / `TurnPolicyOptions` | `turn.before`, cost policy |
| `providerRequestPolicies` | `model.request` |
| `instructionInjectors`, `context`, `promptBuilder`, `inputBuilder` | `context.build` (`@arnilo/prism-context-files`, `@arnilo/prism-context-engineering`) |
| `toolNarrowing` | `RunOptions.tools.only` (a run narrows; a package registers tools) |
| `permission` / `PermissionPolicy` | `@arnilo/prism-approval` (`tool.call`); hard denies stay in `@arnilo/prism-tools-coding` |
| `loop` options (`AgentLoopStrategy`) | the `loop` slot; `@arnilo/prism-driver-process` and `@arnilo/prism-workflows`' `workflowLoop` claim it |
| `identity`, `resolveRunIdentity` | `@arnilo/prism-governance` |
| `beforeProviderTurn` | `model.call` (around) |
| `forwardAgentEvents` | the `observe` hook for every `AgentEvent` type |

## defineAgent / @arnilo/prism-agent-sdk → createAgent

`@arnilo/prism-agent-sdk` (last published 0.1.0) is retired, and so is the 0.12 `ExtensionAPI` registration surface (its 21 `register*` methods did nothing until the host copied them into `createAgent`). Its planes map as follows:

| 0.12 SDK plane | 0.13 home |
| --- | --- |
| `defineAgent({ skills })` | kernel skills (`AgentConfig.skills`) |
| `defineAgent({ instructions })` | `@arnilo/prism-context-files` (`AGENTS.md` / `SYSTEM.md` layering) |
| `defineAgent({ hooks })` | `@arnilo/prism-hooks-json` or a host `hooks` registration |
| `defineAgent({ mcp })` | `@arnilo/prism-mcp` |
| `defineAgent({ tools })` | `packages: [...]` plus `tools: { add }` / `disable.tools` |
| presets | removed; there is no preset registry |

## 0.12 family package → native package map

| 0.12 package | 0.13 package(s) |
| --- | --- |
| `@arnilo/prism-providers` | `@arnilo/prism-provider-{hyper, liquid, opencode-go, typesafe, laya}` (the 17 other 0.3 vendors are not shipped in 0.13.0; write a package on `@arnilo/prism/provider-kit`) |
| `@arnilo/prism-core` | the kernel `@arnilo/prism` plus the native packages below |
| `@arnilo/prism-coding-tools` | `@arnilo/prism-tools-coding`, `@arnilo/prism-tools-openapi`, `@arnilo/prism-tools-computer-use`, `@arnilo/prism-approval`, `@arnilo/prism-devtools` |
| `@arnilo/prism-web-tools` | `@arnilo/prism-tools-web`, `@arnilo/prism-tools-browser` |
| `@arnilo/prism-memory` | `@arnilo/prism-memory-{core, fabric, rag, wiki, compaction, observational}` |
| `@arnilo/prism-work` | `@arnilo/prism-tools-work` |
| `@arnilo/prism-hooks` | `@arnilo/prism-hooks-json` |
| `@arnilo/prism-office` (retired in 0.8) | `@arnilo/prism-tools-work` |
| `@arnilo/prism-agent-sdk` | retired; `@arnilo/prism` plus the native packages |
| `@arnilo/prism-acp-agent` | `@arnilo/prism-acp` (`serveAcp`) |
| `@arnilo/prism-code` | retired; the private reference host `apps/prism-agent` |
| `@arnilo/prism-all` | retired; install the packages you list |
| `@arnilo/prism-mcp`, `@arnilo/prism-ag-ui`, `@arnilo/prism-channels`, `@arnilo/prism-evals`, `@arnilo/prism-workflows`, `@arnilo/prism-model-router` | the same name, reused by the 0.13 package or host library |

## Removed root exports and where each went

| Removed from `@arnilo/prism` | 0.13 home |
| --- | --- |
| `thinking`, `cache-helpers`, `provider-request-policy`, `structured-output` helpers (`applyCacheControl`, `applyDefaultProviderRequestOptions`, the structured-output validators) | `@arnilo/prism/provider-kit` |
| `createEventMultiplexer` | `@arnilo/prism-workflows` |
| `runCheckpointRestoreHooks` | `@arnilo/prism-workflows` (`CheckpointRestoreAudit` stays on the kernel) |
| `CheckpointStore`, `LeaseStore`, their record/key/query types, `createMemoryCheckpointStore`, `createMemoryLeaseStore`, `CheckpointConflictError`, `LeaseConflictError` | `@arnilo/prism-workflows`; SQLite and Postgres store packages provide the durable services |
| `AgentConfig.runState`, `RunOptions.runState`, `AgentRunStateOptions`, `createAgentRunLifecycle`, `resumeAgentRun`, `resumeAgentRunStream`, `loadAgentRunState` | deleted; resume through the store slot's `suspended_run` entry and `session.resume(decisions)` |
| `prepareRunFeedback` | `@arnilo/prism-store-codecs` |
| `describeStorage` | `@arnilo/prism-governance` |
| `resolveDevicePolicy` | `@arnilo/prism-tools-computer-use` |
| `checkCitationIntegrity` | `@arnilo/prism-evals` |
| `createWorkflowInstrumentation`, `createTimelineFolder`, `createWorkflowTimelineFolder`, `projectAgentTimeline`, `projectTraceTimeline`, `projectWorkflowTimeline`, `TimelineError`, `summarizeTimeline`, `summarizeSession`, `addUsage`, `capToolCounts`, `createRagTelemetry` | `@arnilo/prism-observability` |
| `defineWorkflow`, `buildGraph`, `functionNode`, `agentNode`, `fanOutNode`, `joinNode`, `loopNode`, `conditionalNode`, `routeNode`, `workflowNode`, `runWorkflow`, `resumeWorkflow`, `suspend`, `replayWorkflow`, `createWorkflowCheckpoints`, `serializeWorkflowGraph`, `workflowGraphToMermaid`, `projectWorkflowGraphRun`, `createWorkflowEventBus` | `@arnilo/prism-workflows` |
| `snapshotRunBundle`, `resolveUseCaseModel`, `createCacheTelemetry`, `createProviderCapture`, `createMemoryPersistenceLifecycle`, `resolveAgentDefinition`, `discoverAgentBundles`, `createStaticSettingsProvider`, `createBatchedRunLedger` | deleted; no 0.13 replacement |
| `createMemoryAgentEventSource` | `@arnilo/prism/testing` |
| `runRpcServer`, `parseRpcRequest` | `@arnilo/prism-remote` (`serveAgent`, `connectAgent`) |
| `runPromptMode`, `CLI_PROVIDERS` | deleted; the `prism` bin is the manifest CLI plus `prism relay` |
| `isNodeErrorCode` | `@arnilo/prism-tools-coding` |
| `DelegationTelemetry.childId`, the `prism.delegation.child` attribute | `origin` on the event and `prism.origin.*` span attributes |
| `CommandDefinition`, `CommandExecutionContext`, `CommandDrivers`, `CommandWorkflowRun`, `CommandResult` | `PackageCommand` / `PackageCommandContext` — a package registers `{ name, description, args?, run(args, { session, host, agent }) }`, and the host-driver seam (`startRun`, `startWorkflow`, `steer`) is gone |
| `SpeechProvider`, `TranscriptionProvider`, `BatchJobsProvider`, `ModerationProvider`, `RealtimeSession`, `VideoGenerationProvider` | deleted from kernel; implement vendor-specific APIs in provider or host packages |
| Subpaths `./node/config`, `./node/settings`, `./node/agent-definitions`, `./node/contribution-discovery`, `./testing/agent-event-source-conformance`, `./testing/persistence-schema`, `./testing/feedback` | deleted; `./provider-kit`, `./driver-kit`, `./manifest`, and `./testing` remain |

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
import hyper from "@arnilo/prism-provider-hyper";
import coding from "@arnilo/prism-tools-coding";

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

A 0.12 host that read a literal key from config must move it to a ref. Config and the manifest carry `env:` or `keyring:` refs, resolved at the provider edge. A literal secret in config now fails closed, and secrets never appear in argv, logs, events, `inspect()`, or errors.

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
