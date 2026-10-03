# Architecture — kernel, packages, and the 0.12 → target map

The full design is in `roadmap.md` Part 2 (§2.1–§2.11). This file is the working summary for placing and shaping a change. Read the matching roadmap section when you need exact types.

## Contents

1. Layers
2. Placement rules
3. Hooks and slots in one screen
4. 0.12 → target map
5. Lessons already paid for

## 1. Layers

```
Host (Prism Code, server, bot) ──createAgent({ model, packages, host })──▶ kernel @arnilo/prism
kernel ◀──definePackage({ setup(prism) })── native and third-party packages
Host libraries (acp, ag-ui, mcp-server, channels, evals, devtools) take an Agent and serve it.
```

- **Kernel (`src/`)** holds: agent and session; the loop slot plus the `RunController` primitives; the hook bus; slots; the model core with the built-in `openai-compatible` provider and `provider-kit`; the credentials slot with an `env:` default; the tools, skills, and commands registries; the package loader and manifest; the store contract plus the in-memory store; the deterministic compaction default; limits, redaction, and abort; the `HostUi` port; events. Its layout is in roadmap §2.2.
- **Native packages (`packages/<group>/<name>`)** are Bun-native TypeScript with a default export of `definePackage`. They cover providers, tools, memory, context, stores, policy, and integrations. The catalog is in roadmap §2.9.
- **Host libraries (`packages/hosts/<name>`)** use only the public `Agent` API and implement `HostUi` for their protocol.
- **Lab (`apps/prism-code`)** is the TUI. It implements `HostUi`, renders events and commands, and assembles nothing.

## 2. Placement rules

- Put a change in the kernel only when the default loop, hooks, slots, package system, or safety floor cannot work without it. Otherwise it goes in a package.
- A kernel addition must be generic: named in the roadmap catalog, or needed by at least two packages. Prove that no existing hook, slot, or `PackageAPI` member can express it.
- The kernel imports and names no package. A repo test enforces this once it exists; until then, check it with `graft grep "@arnilo/prism-" --in src/`.
- Vendor wire code goes in `packages/providers/<vendor>`. Wire code shared by providers goes in `@arnilo/prism/provider-kit`.
- Anything that needs a person (approval, question, secret, OAuth URL, trust) goes through `host.ui.request`. A package fails closed when the answer is `unavailable`.

## 3. Hooks and slots in one screen

The full catalog is in roadmap §2.4, the primitives in §2.5, and `PackageAPI` in §2.6.

| Kind | Hooks | Rule |
| --- | --- | --- |
| observe | every `AgentEvent` type (`turn.completed`, `tool.completed`, `message.delta`, `package.event`, …) | Never awaited; a throw becomes a `hook.error` event. |
| transform | `run.input`, `context.build`, `model.request`, `model.response`, `tool.result`, `message.append` | Handlers run in order; a throw fails closed. `context.build` changes only the provider view, never the store. |
| decide | `turn.before` (any stop wins), `tool.call` (any deny wins, then ask, rewrite, respond), `run.end` (first continue wins, capped), `compaction.when` (any compact wins) | A throw fails closed; a throw in `tool.call` counts as a deny. |
| around | `model.call`, `tool.execute` | Nested by priority; `next` is called at most once. |

- **Ordering:** higher `priority` runs first; ties run in package load order; host hooks load last. Registration ids look like `<package>:<hook>[#id]`.
- **`RunController`:** `turn()`, `executeTools()`, `append()`, `end()`, `emit()`. Hooks fire inside these, so a custom loop cannot skip them.
- **`ask` handling:** an `ask` from `tool.call` becomes an inline `host.ui` confirm when a UI is present. Otherwise the run suspends (`status: "suspended"`), and `session.resume(decisions)` continues it.
- **Slots:** `loop`, `compaction`, `store`, `credentials`. Claim one with `prism.slots.<slot>.provide(impl)`. When two packages claim the same slot, loading fails closed unless the host or manifest assigns an owner. `.default` exposes the kernel default for delegation.

## 4. 0.12 → target map

| 0.12 today | Target |
| --- | --- |
| `createAgent` / `AgentConfig` (`src/contracts-core/agent.ts`) | kernel `createAgent` (roadmap §2.3), with 0.12 fields removed |
| `packages/agent-sdk` `defineAgent` and its planes | kernel `createAgent`. Skills plane → kernel skills; instructions plane → `context-files`; hooks plane → `hooks-json`; MCP plane → `mcp`; tool planes → `tools.add` / `disable.tools` plus tool packages; presets removed |
| `MiddlewareRegistry`, `Guardrails`, `StopHook`, `TurnPolicyOptions`, `ProviderRequestPolicy`, `InstructionInjector`, `ContextProvider`, `ToolNarrowing`, `InputBuilder`, `PromptBuilder`, `PermissionPolicy` | hooks (the "Replaces" column in roadmap §2.4) |
| `AgentLoopStrategy` / `LoopContext` (`src/contracts-core/loop.ts`, `src/agent-loops.ts`) | the `loop` slot plus `RunController`. `generate-validate-revise` moves to `workflows` |
| `CompactionStrategy` / `CompactionTrigger` | the `compaction` slot plus the `compaction.when` hook |
| `Extension`, `ExtensionAPI`, `createExtensionKernel`, `activateKernel`, `ContributionRegistries`, `PrismManifest` (`src/extensions.ts`, `src/contributions.ts`, `src/manifests.ts`) | `definePackage` / `PackageAPI` / the manifest. All of these are removed |
| `prism-providers` subpaths | `packages/providers/<vendor>`, with shared code in `provider-kit` |
| `prism-coding-tools`, `web-tools`, `prism-work` | `tools-*` packages plus `approval` |
| `memory` subpaths | `memory-*` packages. Attention compiler, context budget, fold, and tool search → `context-engineering` |
| `prism-core` sessions / governance / credentials / runtime | `store-*`, `governance`, `model-router`, `observability`, `workflows`, `credentials-keyring`, and host libraries |
| `hooks`, `mcp`, `ag-ui`, `prism-channels`, `acp-agent` | `hooks-json`, `mcp` (client), host libraries (`acp`, `ag-ui`, `mcp-server`, `channels`), and a thin ACP bin |
| `packages/prism-code` | `apps/prism-code`, TUI only |

## 5. Lessons already paid for

- Verify each seam against source before building on it. Plan 142 Task 1 found the tool registry's duplicate default is `"replace"`, not fail-closed.
- Update callers in the task that renames. Plan 142 left the root typecheck red for four tasks.
- Regenerate the baseline in the task that moves an export. Plans 083 and 142 missed this.
- Extension contributions that the host must activate by copying are inert (`activateKernel`). Never reintroduce host-activated contributions.
- A capability that needs a host coordinator (0.12 observational memory in `packages/prism-code/src/observational-memory.ts`) signals a missing kernel primitive, such as session state, background tasks, or `models.client`. Fix the primitive; don't add another coordinator.
