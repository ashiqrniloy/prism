# Prism Roadmap — SDK kernel and native packages

Updated: **2026-10-04** (adds custom agents run on vendor coding agents — Claude Code, Codex, Antigravity CLI — driven as unmodified binaries under the user's own subscription where the vendor permits it, and multi-agent orchestration: §2.12 and Phases 13–16, all shipping in 0.13.0; version target set to 0.13.0 everywhere)

Shipped baseline: `@arnilo/prism` **0.12.1** and the 0.12.1 family packages. `@arnilo/prism-agent-sdk` **0.1.0** is published. Its unreleased in-tree Phase 1 work (plan 142) is covered under [In-flight work](#in-flight-work). `@arnilo/prism-code` **0.4.1** is the terminal lab.

Target: `@arnilo/prism` **0.13.0**, an SDK kernel that everything else extends through packages.

**Version.** The release this roadmap targets is **0.13.0**, for the kernel and for every native package and host library, published together in Phase 11. An earlier revision of this file said 0.13.0 in this header and in Phase 11 but 1.0.0 in the version table and the package examples (`requires: { prism: "^1.0" }`). The 1.0.0 entries were left over from the first draft and were corrected on 2026-10-04. 1.0.0 is outside this roadmap.

This roadmap replaces the previous one in full, including its "SDK facade over family packages" direction. [PRODUCT.md](PRODUCT.md) is the short version of this document.

The history of how Prism got here lives in [plans](plans/README.md), [CHANGELOG](CHANGELOG.md), and [documentation history](docs/history/README.md). It is not repeated here.

When a phase starts, it is turned into an execution plan in `plans/`. This file is the target and the cut line, not the task list.

---

## Part 1 — Concept

### 1.1 What Prism becomes

Prism is an SDK for running AI agents on Bun.

The **SDK kernel** (`@arnilo/prism`) does the following, and nothing else:

- takes a message
- runs the agent loop: build context, call the model, dispatch tools, repeat
- gives the agent access to tools and skills
- exposes one programmatic mechanism for changing behavior: hooks, plus slots for whole-component replacement

It includes built-in model communication (an OpenAI-compatible streaming client). Other vendors come from provider packages.

Every other capability is a **package**: coding tools, web tools, work tools, memory systems, stores, policy, MCP, and the vendors themselves.

A package is a Bun-native TypeScript module. It receives the SDK's API when it loads and changes the agent through it:

- adding tools, skills, providers, and commands
- hooking any point in the loop
- keeping per-session state
- running background work
- calling other models
- taking over the whole agent loop
- running a custom agent on a vendor coding agent (Claude Code, Codex, Antigravity CLI), driven as the unmodified vendor binary under the user's own sign-in, as the agent's loop

A package that is installed and listed is active. The host does not wire it up.

A **manifest** that Prism maintains records which packages are installed, with their versions, integrity hashes, config, enabled state, and slot ownership. Hosts can load packages from the manifest or pass them in code.

The **host** is the program embedding the SDK: Prism Code, a server, a bot. The host chooses packages, overrides their config, can disable any single contribution, assigns contested slots, and answers requests that need a person through one host port.

A host can also **orchestrate several agents as one workflow**: its own Prism agents and custom agents that run on vendor coding agents (Claude Code, Codex, Antigravity CLI) under the user's own subscription where the vendor's terms allow it, in one graph with deterministic gates. The host defines those agents' system prompts, tools, skills, and sub-agents, lends them its own Prism tools under its own approval policy, captures everything they do (messages, thinking, skill activation, tool calls, file changes) as attributed events, and keeps every agent's sessions in one Prism store for search. Prism ships the primitives for this; the host ships the product. §2.12 is the design, and Phases 13–16 deliver it.

### 1.2 Why this and not the previous direction

The previous roadmap made the SDK a facade that knew every family package by name: `tools.use: ["coding"]`, 20 hardcoded `provider` ids, `memory: { compaction: "llm" }`, `web.backend`. That design has four problems:

1. **The config is closed.** Adding a capability, or letting a third party add one, means changing the SDK. The goal is the opposite: deep configurability and extension without SDK changes.
2. **Extensions stay inert.** In 0.12.1, extension contributions (`ExtensionAPI`, 21 `register*` methods) do nothing until the host copies them into `createAgent` through `activateKernel()` (`src/extensions.ts:340-363`). A package cannot change behavior just by being installed.
3. **There is no session lifecycle for extensions.** Observational memory needs:
   - per-session state
   - work after each turn and tracked background work
   - a second model
   - a tool
   - a context contribution
   - a compaction replacement
   - commands

   None of that can be expressed through the runtime's seams, so the memory package wraps `session.run`. Prism Code then builds a 385-line `ObservationalMemoryCoordinator`, bolts it on with `(definition as any).omCoordinator`, and implements the `/om` commands in the TUI.
4. **Extension points are fragmented.** 0.12.1 has about eight separate mechanisms:
   - `AgentLoopStrategy`
   - `MiddlewareRegistry` (12 hook names)
   - `StopHook`
   - `TurnPolicyOptions`
   - `Guardrails` (4 stages)
   - `ProviderRequestPolicy`
   - `InstructionInjector`, `ContextProvider`, and `ToolNarrowing`
   - `CompactionStrategy`

   They have different shapes, error rules, and ordering rules. Some declared names are never run: the `tool_call` and `tool_result` middleware hooks are only fed by a notification bridge (`src/extensions.ts:275-276`).

On top of that, the runtime's public surface (137 export statements over about 60 modules) mixes the core loop with attention compilation, field policy, evidence grounding, devices, artifacts, feedback, RPC, and a CLI. It is not a kernel.

The primitives largely exist. This roadmap unifies them into one hook model and one package system, shrinks the kernel to what the loop needs, and turns every family package into a native package built on the same API third parties use.

### 1.3 Architecture at a glance

```
┌──────────────────────────── Host (Prism Code, server, bot, …) ─────────────────────────────┐
│ chooses packages · overrides config · disables contributions · assigns slots · answers UI  │
└───────────────┬────────────────────────────────────────────────────────────────▲───────────┘
                │ createAgent({ model, packages, host, … })                      │ host.ui.request(…)
┌───────────────▼────────────────────────────────────────────────────────────────┴───────────┐
│  SDK kernel — @arnilo/prism                                                                │
│                                                                                            │
│  Agent ─ Session ─ Loop (slot) ──uses──▶ RunController primitives ──fire──▶ Hook bus       │
│                                           turn() · executeTools() · append() · end()       │
│  Models (registry + openai-compatible) · Credentials (slot) · Tools · Skills · Commands    │
│  Store (slot) · Compaction (slot) · Events · Limits · Redaction · Package loader · Manifest │
└───────────────▲────────────────────────────────────────────────────────────────────────────┘
                │ definePackage({ setup(prism) { prism.hooks / slots / tools / … } })
   ┌────────────┼──────────────┬───────────────┬───────────────┬──────────────┬─────────────┬─────────────┐
 provider-*   tools-*       memory-*        store-*         approval       mcp          driver-*      third-party
                                                            governance     hooks-json   (loop slot:   packages
                                                                           workflows    claude-code,
                                                                                        codex,
                                                                                        antigravity)

 Surfaces (host libraries, not packages): acp · ag-ui · mcp-server · channels — take an Agent, serve it.
 Driver kit (kernel subpath @arnilo/prism/driver-kit): the contract a driver package fills to run an external agent as a loop.
```

### 1.4 Rules for every phase

- **The kernel knows no package names.** `src/` never imports an `@arnilo/prism-*` package. A repo test enforces this.
- **Installed = listed = active.** Nothing loads unless the host lists it, either in code or through a manifest the host chose to load. A loaded package needs no host wiring.
- **Replacing the loop cannot bypass safety gates.** Tools execute only through `RunController.executeTools`, which always fires `tool.call`. Model calls go only through `RunController.turn`, which always fires `context.build`, `model.request`, and `model.call`.
- **External activity is attributed, never impersonated.** What an external agent reports doing is recorded through `RunController.observe` with `origin.executedBy: "external"`. Only `RunController` primitives emit catalog events, so no loop or driver can claim that Prism executed or gated something it did not. Tools that Prism serves to an external agent still execute through `executeTools` and still fire `tool.call`.
- **Subscription credentials never pass through Prism.** A person signs in to each vendor binary through the vendor's own flow. Prism drives only the unmodified binary, binds each subscription profile to one principal, paces it as individual use, and refuses any sign-in mode the vendor's terms do not permit for the declared deployment (§2.12.5).
- **A driver that cannot enforce a requested control fails closed.** If the host asks for a control (replacing the system prompt, a built-in tool allow-list, gating an effect before it runs, steering, resume) and the driver's capability descriptor does not offer it, `createAgent` fails and names the missing control.
- **Fail closed.** Each of these is an error, never a warning:
  - an unknown hook name, slot, or config key
  - a slot claimed by two packages with no host assignment
  - a missing required package or service
  - a literal secret in config or the manifest
  - an integrity mismatch
  - an untrusted project manifest
  - a gate hook that throws (this counts as a deny)
- **Secrets stay at the edge.** Config and manifests carry credential refs (`env:NAME`, `keyring:name`), never raw keys. Secrets never appear in events, `inspect()`, or errors.
- **Packages are trusted code.** They run in-process with full Bun privileges. Installing one is the trust decision. Declared capabilities are enforced on SDK-mediated APIs and shown at install time. Prism does not claim to be a sandbox.
- **Bun-native.** The kernel and native packages publish TypeScript source that Bun runs directly. There is no build step to consume them, and Node.js is not a target.
- **Minimal kernel.** The kernel has no runtime dependencies. A module belongs in the kernel only if the default loop, hooks, slots, or package system cannot work without it.
- **No compatibility aliases.** 0.13.0 is a deliberate break from 0.12. Old config fields are removed, not aliased.
- **Docs follow releases, and are written as the API lands.** `/docs` documents the released contract. `PRODUCT.md` and this roadmap describe the target until 0.13.0 publishes.
  - Kernel API pages are written into `docs/next/` in the task that ships the API. They are not linked from `docs/index.md` and not packed, and the publish phase promotes them into `/docs`.
  - Each native package's `README.md` is its page, written in the task that creates the package.
  - User-visible changes go under `## [Unreleased]` in `CHANGELOG.md` as they land.
  - A phase is done when its API has its staged page or README, an example, and, where applicable, a conformance suite in `@arnilo/prism/testing`.

---

## Part 2 — Architecture

### 2.1 Kernel responsibilities

| Area | In the kernel | Not in the kernel |
| --- | --- | --- |
| Agent / session | `createAgent`, `Agent`, `Session`, run/stream/steer/abort/resume, fork, messages, session index, model-less agents whose loop never calls a model (§2.12.9 K1), session links to a parent session and workflow run (K4) | Protocol surfaces |
| Loop | `LoopStrategy` contract, `RunController` primitives (including the driver primitives `observe`, `ask`, `steers`; K2), a default tool loop | Workflows, generate-validate-revise, plan/execute/verify |
| Vendor coding agents | `@arnilo/prism/driver-kit` subpath: `ExternalAgentSpec`, driver contract, capability descriptor, subscription profiles and sign-in handoff, the vendor-terms guard, configuration materializer, callback broker, tool bridge, normalization and protocol helpers, `driverConformance`; the `prism relay` bin (§2.12.10) | Concrete drivers (Claude Code, Codex, Antigravity CLI), installing vendor binaries, holding subscription credentials |
| Hooks | Typed hook bus: observe, transform, decide, around | Hook-file formats (hooks.json) |
| Slots | `loop`, `compaction`, `store`, `credentials`, with defaults | Alternative implementations |
| Models | `ModelProvider` contract, provider registry, `ModelRef`, streaming normalization, retry/backoff, usage and stop-reason normalization, built-in `openai-compatible` provider, `models.client` | Vendor adapters, OAuth flows, model catalogs |
| Credentials | `CredentialResolver` contract, `env:` resolver default | Keyring, encrypted vaults |
| Tools | `ToolDefinition`, registry, JSON-schema argument validation, dispatch, effect annotations | Any concrete tool, sandboxing, approval policy |
| Skills | `Skill`, registry, `SKILL.md` directory discovery, progressive/eager disclosure, `load_skill` | Wiki or bundled skill sets |
| Commands | Host-invokable command registry and dispatch | Slash palette rendering |
| Packages | `definePackage`, loader, config validation, dependency order, capabilities, services, session state, background tasks | — |
| Manifest | Format, scopes, load, install/remove/enable/configure, `prism` CLI | Package registry or marketplace |
| Store | `SessionStore` contract, in-memory store, entry types including package state and suspended runs, session links and list/search filters, `createSessionIndex(store)` for search across agents (K4) | JSONL, SQLite, Postgres; workflow checkpoints and leases |
| Compaction | Slot, `compaction.when` trigger, deterministic no-model default (drop oldest whole turns, record a marker) | LLM summaries, observational memory |
| Safety floor | Hard limits (turns, tool rounds, bytes, wall time, continuations), abort, redaction, suspend/resume of pending decisions | Cost policy, approval modes, governance, identity verification |
| Host port | `HostUi` request/response contract | Rendering |
| Events | `AgentEvent` catalog, package events, `origin` attribution on every event (K3) | Exporters |

### 2.2 Kernel module layout

```
src/
  agent/          createAgent, Agent, inspect, session index
  session/        Session, SessionContext, session state, background tasks, suspend/resume
  loop/           LoopStrategy, RunController, default loop
  hooks/          hook bus, hook catalog and payload types, ordering, error policy
  slots/          slot registry and defaults
  models/         ModelProvider, registry, ModelRef, ModelClient, retry, usage, openai-compatible
  credentials/    CredentialResolver, env resolver
  tools/          ToolDefinition, registry, validation, dispatch
  skills/         Skill, registry, discovery, disclosure, load_skill
  commands/       command registry
  packages/       definePackage, loader, config schema validation, capabilities, services
  manifest/       manifest format, scopes, load, install, CLI
  store/          SessionStore, memory store, entry types
  host/           HostPort, HostUi
  events/         AgentEvent catalog
  safety/         limits, redaction, abort
  provider-kit/   subpath: SSE, HTTP transport, openai-compatible wire mapping, conformance
  driver-kit/     subpath: driver contract, capability descriptor, external-activity normalization, process helpers
  testing/        subpath: mock provider, test agent, conformance suites, scripted external agent, driverConformance
```

Published entry points:

- `@arnilo/prism`: everything a host or package author needs.
- `@arnilo/prism/provider-kit`: shared helpers for provider packages.
- `@arnilo/prism/driver-kit`: the contract and helpers for driver packages that run a custom agent on a vendor coding agent binary as a loop (§2.12.10).
- `@arnilo/prism/manifest`: programmatic manifest maintenance.
- `@arnilo/prism/testing`: mock provider, test agent, and conformance suites.
- The `prism` bin: manifest CLI.

### 2.3 Host-facing API

Sketches of the target shape. Exact types are fixed in each phase's plan.

```ts
export function createAgent(config: AgentConfig): Promise<Agent>;

export interface AgentConfig {
  readonly id?: string;
  readonly name?: string;
  readonly model?: ModelRef;                      // "anthropic/claude-sonnet-4-5" | ModelSpec { provider, model, options?, baseUrl?, credential? }
                                                  // required unless the loop owner declares usesModel: false (a driver; §2.12.9 K1)
  readonly instructions?: string;
  readonly packages?: readonly PackageInput[];    // PackageInstance | PackageDefinition | loadManifest() output
  readonly packageConfig?: Readonly<Record<string, unknown>>; // per package name; wins over manifest and defaults
  readonly tools?: { readonly add?: readonly ToolDefinition[] };
  readonly skills?: {
    readonly dirs?: readonly string[];
    readonly add?: readonly Skill[];
    readonly disclosure?: "progressive" | "eager"; // default progressive; registers load_skill
  };
  readonly hooks?: (hooks: HookRegistrar) => void; // host hooks = an inline, unnamed package loaded last
  readonly slots?: SlotAssignments;                // per slot: owning package name, or a direct implementation
  readonly disable?: {                             // switch off any single contribution by id
    readonly tools?: readonly string[];            // "shell"
    readonly hooks?: readonly string[];            // "@arnilo/prism-memory-observational:context.build"
    readonly commands?: readonly string[];
    readonly skills?: readonly string[];
  };
  readonly limits?: Limits;                        // hard floor; runs may only narrow
  readonly principal?: Principal;                  // opaque to the kernel; packages that need identity enforce it
  readonly host?: HostPort;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Agent {
  readonly id: string;
  session(options?: SessionOptions): Promise<Session>; // new session, or resume { id } through the store slot
  readonly sessions: SessionIndex;                     // list / get / delete / search (store capabilities)
  readonly commands: CommandIndex;                     // list(); run(name, args, { session })
  readonly models: ModelIndex;                         // list() via provider discovery; resolve(ref)
  readonly tools: readonly ToolInfo[];
  readonly skills: readonly SkillInfo[];
  inspect(): AgentInspection;                          // packages, versions, config sources, tools, skills,
                                                       // hooks in execution order, slot owners, status notes
  subscribe(): AsyncIterable<AgentEvent>;              // agent-scoped events (package status, background work)
  dispose(): Promise<void>;                            // closes sessions, disposes packages in reverse load order
}

export interface Session {
  readonly id: string;
  run(input: Input, options?: RunOptions): Promise<RunResult>;
  stream(input: Input, options?: RunOptions): AsyncIterable<AgentEvent>;
  steer(input: Input): void;                           // queue input for the next turn of the active run
  abort(reason?: string): void;
  resume(decisions: readonly Decision[], options?: RunOptions): AsyncIterable<AgentEvent>; // continue a suspended run
  messages(): Promise<readonly Message[]>;
  fork(options?: { readonly at?: string }): Promise<Session>;
  compact(): Promise<void>;                            // run the compaction slot now
  close(): Promise<void>;                              // settle background tasks, fire session.closed
}

export interface SessionOptions {
  readonly id?: string;                                // resume through the store slot
  readonly parent?: {                                  // K4: links persisted on the session record, used by list/search filters
    readonly sessionId: string;
    readonly agentId?: string;
    readonly workflowRunId?: string;
    readonly delegationId?: string;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RunOptions {
  readonly model?: ModelRef;                           // per-run model switch; same provider registry. On a driver agent it is passed
                                                       // through as a hint (descriptor models: "passthrough") or fails closed ("none")
  readonly limits?: Limits;                            // narrow only
  readonly tools?: { readonly only?: readonly string[] };
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface RunResult {
  readonly status: "completed" | "stopped" | "suspended" | "failed" | "aborted";
  readonly stopReason?: string;                        // "end_turn" | "turn_limit" | "hook_stop" | …
  readonly pending?: readonly PendingDecision[];       // present when suspended
  readonly messages: readonly Message[];               // messages appended by this run
  readonly usage?: Usage;
  readonly error?: ErrorInfo;
}
```

**Host port.** This is the only way packages reach a person. It covers approvals, `ask_user`, MCP trust, OAuth URLs, secret entry, and pickers.

```ts
export interface HostPort {
  readonly ui?: HostUi;
  readonly log?: Logger;
}
export interface HostUi {
  request(request: UiRequest): Promise<UiResponse>;
}
export type UiRequest =
  | { kind: "confirm"; title: string; detail?: string }
  | { kind: "select"; title: string; options: readonly UiOption[]; multiple?: boolean }
  | { kind: "input"; title: string; placeholder?: string }
  | { kind: "secret"; title: string; ref: string }      // the host stores it via the credentials slot; never returned to the package
  | { kind: "open-url"; title: string; url: string }
  | { kind: "notify"; level: "info" | "warn" | "error"; message: string }
  | { kind: "terminal"; title: string; command: readonly string[]; env?: Readonly<Record<string, string>>; cwd?: string }; // K6: the host runs a
    // command interactively for the person (e.g. a vendor sign-in); its input and output never reach the kernel or the package
// Every request carries { package, sessionId? }. A response is answered | dismissed | unavailable.
// A host without `ui` answers "unavailable", and packages must fail closed on it.
```

**Events.** Each `AgentEvent` type is also an observe hook of the same name:

- `session.opened`, `session.closed`
- `run.started`, `run.completed`, `run.failed`, `run.suspended`
- `turn.started`, `turn.completed` (with usage)
- `message.delta`, `message.completed`
- `tool.started`, `tool.progress`, `tool.completed`
- `decision.pending`, `decision.resolved`
- `compaction.started`, `compaction.completed`
- `background.started`, `background.completed`, `background.failed`
- `hook.error`
- `package.status`
- `package.event` (`{ package, name, data }`, for namespaced custom events such as `om.status`)

Every event may carry an optional `origin` (K3, §2.12.9) that says which agent produced it and who executed it: `{ kind: "prism" | "external", agent, vendor?, profile?, agentId, delegationId?, parentSessionId?, parentToolCallId?, subagentId?, depth, executedBy? }`. `origin` replaces the 0.12-era `child: { childId, delegationId, depth }` field. It adds no event types: the catalog stays at its frozen count, so a generic UI renders a vendor agent's tool calls, thinking, and sub-agents with the same code it uses for Prism's. Activity with no catalog event (skill activation, file changes, plans, vendor sub-agents, compaction, notices such as rate limits) uses the driver kit's standard `agent.*` package events.

### 2.4 Hooks

Hooks are the target model for changing the runtime loop. There are four kinds. All are registered with `prism.hooks.on(name, handler, { priority?, id?, onError? })`, and the handler's payload and return types come from the hook name.

| Kind | Semantics | Error policy |
| --- | --- | --- |
| **observe** | Notification of an `AgentEvent`. Cannot change anything. Never awaited by the run. | A throw becomes a `hook.error` event; the run continues. |
| **transform** | Handlers run in order. Each receives the current value and may return a replacement (or nothing, to keep it). May `reject` with a reason. | A throw fails the run closed, naming the package and hook. `onError: "ignore"` opts a handler into best effort. |
| **decide** | Each handler returns a decision or nothing. Results combine by a fixed rule for each hook. | A throw fails closed. For `tool.call` a throw is a deny. |
| **around** | `(input, next) => output`. The handler may call `next` zero or one times, and may replace the operation entirely. | A throw fails the operation, then applies that operation's own failure rules. |

Hook catalog:

| Hook | Kind | Payload → result | Combination | Replaces (0.12.1) |
| --- | --- | --- | --- | --- |
| `run.input` | transform | input messages → messages \| reject | ordered | input guardrails, `InputBuilder` |
| `turn.before` | decide | turn counters, usage → `{ stop: reason }` | any stop stops (clean, resumable) | `TurnPolicyOptions.stop`, cost policy |
| `context.build` | transform | `ContextDraft { system[], messages[], tools[], skills[] }` → draft | ordered; affects the provider view only, never the store | `InstructionInjector`, `ContextProvider`, `ToolNarrowing`, skills catalog, `PromptBuilder` |
| `model.request` | transform | `ModelRequest` → request | ordered | `ProviderRequestPolicy`, `provider_request` middleware |
| `model.call` | around | request, next → model event stream | nested by priority | deterministic turns (`beforeProviderTurn`), routing, caching |
| `model.response` | transform | assistant message → message \| reject | ordered | output guardrails |
| `tool.call` | decide | `{ name, args, effects, session, origin? }` (`origin` set for a call served to, or requested by, an external agent; §2.12) → `allow` \| `{ deny }` \| `{ ask }` \| `{ rewrite }` \| `{ respond }` | any deny wins; then any ask; then rewrites applied in order and re-validated; then the first respond; else allow | `PermissionPolicy`, tool-input guardrails, approval |
| `tool.execute` | around | call, next → `ToolResult` | nested by priority | sandbox or remote execution wrappers |
| `tool.result` | transform | `ToolResult` → result | ordered | tool-output guardrails |
| `message.append` | transform | message → message (before persistence) | ordered | redaction extensions |
| `run.end` | decide | transcript view → `{ stop }` \| `{ continue: { reason, steer? } }` | the first continue wins, capped by `limits.maxContinuations` | `StopHook` |
| `compaction.when` | decide | context estimate vs. model input limit → `{ compact: true }` | any compact triggers | `CompactionTrigger` |
| every `AgentEvent` type | observe | event | fan-out | extension event bus, `forwardAgentEvents` |

How an `ask` decision is resolved:

1. If a `HostUi` is present and the run is interactive, the kernel sends a `confirm` request inline.
2. Otherwise the run suspends (`status: "suspended"`, `pending[]`), and the suspension is persisted through the store slot.
3. `session.resume(decisions)` continues the run later, even in a new process.

This single path replaces the separate approval, durable-interrupt, and headless-deny mechanisms.

Ordering: higher `priority` runs first. Ties run in package load order. Host hooks (`AgentConfig.hooks`) load last.

Every registration has an id, `<package>:<hook>[#<id>]`, which is what `disable.hooks` and `inspect()` use.

`message.delta` is on the hot path: its observers run synchronously and must not block.

### 2.5 Loop primitives and the loop slot

The loop only orchestrates; the primitives fire the hooks. That is why a package can replace the whole loop without switching off approval, guardrails, memory, or anything else.

```ts
export interface LoopStrategy {
  readonly name: string;
  readonly revision: string;                  // joins the durable fingerprint for suspended runs
  run(run: RunController): Promise<void>;
  snapshot?(): JsonValue;                     // required, together with restore, for suspendable custom loops
  restore?(state: JsonValue): void;
}

export interface RunController {
  readonly session: SessionContext;
  readonly input: readonly Message[];
  readonly signal: AbortSignal;
  readonly limits: LimitView;
  /** turn.before → context.build → model.request → model.call → model.response → message.append */
  turn(options?: { tools?: readonly string[] | false; model?: ModelRef; system?: string }): Promise<TurnResult>;
  /** per call: tool.call → tool.execute → tool.result → message.append; may suspend on ask.
   *  Returns the results (0.12.1-era code returns void: src/loop/types.ts:42). Re-entrant: safe to call concurrently,
   *  e.g. from callback-broker requests while a driver loop awaits its vendor binary (§2.12.10, §2.12.12). */
  executeTools(calls: readonly ToolCall[], options?: { concurrency?: number; origin?: EventOrigin }): Promise<readonly ToolResult[]>;
  append(message: Message): Promise<void>;    // message.append
  end(): Promise<{ stop: true } | { continue: string }>; // run.end
  emit(name: string, data: JsonValue): void;  // package.event only; catalog events come from the primitives (K2)

  // Driver primitives (§2.12.9 K2). Usable by any loop; drivers are their main users.
  /** Record what a vendor agent did: text and thinking via message.delta/message.append, tool.* events with origin.executedBy "external",
   *  skill/file/plan/subagent/compaction/notice/raw via the driver-kit's standard agent.* package events, usage into RunResult. Never fires tool.call: a reported action already happened. */
  observe(activity: ExternalActivity): Promise<void>;
  /** Gate a vendor agent's own built-in tool before it runs (reached through the callback broker): fires tool.call with origin; ask → inline host.ui or suspension. */
  ask(request: ExternalToolRequest): Promise<ExternalToolDecision>;
  /** Steering input queued by session.steer(), for a loop that does not call turn(). */
  steers(): AsyncIterable<Message>;
  readonly model?: ModelRef;                  // the run's model ref; a driver maps it to its own model flag
}

// Kernel default, in essence:
async function defaultLoop(run: RunController) {
  for (;;) {
    const turn = await run.turn();
    if (turn.stopped) return;
    if (turn.toolCalls.length > 0) { await run.executeTools(turn.toolCalls); continue; }
    if ("continue" in (await run.end())) continue;
    return;
  }
}
```

Slots:

| Slot | Contract | Kernel default |
| --- | --- | --- |
| `loop` | `LoopStrategy` | `defaultLoop` |
| `compaction` | `Compactor { compact(ctx): Promise<CompactionResult> }` | drop the oldest whole turns, keeping tool-call/result pairs, and write a marker entry |
| `store` | `SessionStore` | in-memory |
| `credentials` | `CredentialResolver { resolve(ref, ctx) }` | `env:NAME` only |

A loop that runs a custom agent on a vendor coding agent binary is still a `LoopStrategy`. It comes from a driver package built with `@arnilo/prism/driver-kit`, which adds a capability descriptor (`usesModel: false`, the controls it can enforce, what it can capture, which sign-in modes the vendor permits) that `createAgent` checks against the host's requirements (§2.12.10).

A package claims a slot with `prism.slots.<slot>.provide(impl)`. `prism.slots.<slot>.default` exposes the kernel default so a package can delegate to it.

If two packages claim the same slot, `createAgent` fails closed unless `AgentConfig.slots` (or the manifest's `slots`) names the owner. A direct implementation in `AgentConfig.slots` always wins.

### 2.6 Packages

A package is an npm package whose default export is `definePackage(...)`. It publishes TypeScript source (`"exports": { ".": "./src/index.ts" }`), and Bun runs it as-is.

```ts
export function definePackage<C>(definition: {
  readonly name: string;                            // npm name; the package id everywhere
  readonly version: string;
  readonly description?: string;
  readonly requires?: {
    readonly prism: string;                         // semver range against the kernel
    readonly packages?: Readonly<Record<string, string>>; // loaded first; missing = fail closed
    readonly services?: readonly string[];          // must be provided by some loaded package
  };
  readonly capabilities?: readonly Capability[];    // "models" | "host-ui" | "session-state" | "background"
                                                    // | "credentials" | "slot:loop" | "slot:compaction" | "slot:store" | "slot:credentials"
  readonly config?: JsonSchema;                     // validated before setup; defaults applied; secret fields must be refs
  setup(prism: PackageAPI<C>): void | Promise<void>;
}): PackageDefinition<C>;

// A PackageDefinition is callable: coding({ root }) → PackageInstance. Passing `coding` bare uses defaults.

export interface PackageAPI<C> {
  readonly name: string;
  readonly config: C;                               // defaults ← manifest ← AgentConfig.packageConfig
  readonly hooks: HookRegistrar;
  readonly slots: SlotRegistrar;
  readonly tools: { register(tool: ToolDefinition, options?: { when?: (s: SessionContext) => boolean }): void };
  readonly skills: { register(skill: Skill): void; addDir(path: string): void };
  readonly providers: { register(provider: ModelProvider): void };
  readonly commands: { register(command: CommandDefinition): void };
  readonly models: { client(ref?: ModelRef): ModelClient };               // side calls through the same registry and credentials
  readonly credentials: { resolve(ref: string): Promise<Secret | undefined> };
  readonly state: {
    session<T extends JsonValue>(key: string, initial: T): SessionState<T>; // persisted as package-state entries; restored on resume; forked with the session
    agent<T>(key: string, initial: T): AgentState<T>;                       // process memory, agent lifetime
  };
  readonly services: {
    provide<T>(name: string, implementation: T): void;
    consume<T>(name: string): T | undefined;
    require<T>(name: string): T;
  };
  readonly host: HostPort;                          // host.ui for confirm/select/input/secret/open-url
  readonly events: { emit(name: string, data: JsonValue): void };        // package.event, namespaced by package
  readonly status: { note(level: "info" | "warn", message: string): void }; // shown in inspect() and package.status
  readonly log: Logger;
  onDispose(fn: () => void | Promise<void>): void;
}

// SessionContext (in hook payloads, tool contexts, and `when` predicates) exposes id, principal, metadata,
// model, and background(name, task): a tracked async task that close() settles and events report.
```

**Lifecycle.**

1. Resolve the inputs: code instances, the manifest, or both.
2. Merge config: schema defaults, then manifest config, then `packageConfig`.
3. Validate config.
4. Order packages topologically by `requires.packages`, keeping stable input order.
5. Check the kernel range, required packages, and services.
6. Run `setup` in order.
7. Resolve slot ownership.
8. Build the agent.

Per session, packages see `session.opened` and `session.closed`. `dispose` runs in reverse load order.

A `setup` failure fails `createAgent` closed and names the package. The exception is a manifest entry marked `"optional": true`: its failure is skipped and recorded as a status note.

A package that cannot operate — for example, web tools with no API key — should register nothing and call `status.note(...)` rather than throw.

**Capabilities.** Declared capabilities are enforced on the SDK-mediated APIs. For example, `models.client` requires `"models"` and `slots.loop.provide` requires `"slot:loop"`. They are shown by `prism add` and `inspect()`. They document intent and gate SDK access; they are not a process sandbox.

**Commands.** Commands are host-invoked and never visible to the model:

```ts
{ name, description, args?: JsonSchema, run(args, ctx: CommandContext) }
```

`ctx` carries the session, `host.ui`, and the agent. A name collision fails closed. Hosts list `agent.commands` and render them however they like; a TUI shows them as slash commands.

**Tools.** A kernel `ToolDefinition` carries:

- `name`
- `description`
- `parameters` (JSON Schema)
- `effects`: `"read" | "write" | "execute" | "network" | "external"`. Approval and governance packages decide generically from these instead of from tool names.
- `execute(args, ctx)`. `ctx` carries the session, signal, `host.ui`, and `progress()`.

`when` controls per-session visibility; it replaces host-side `toolNames` filtering. A tool-name collision fails closed.

### 2.7 Manifest and installation

Prism maintains the manifest. Hosts choose whether to read it.

```jsonc
// .prism/packages.json (project) — also ~/.prism/packages.json (user)
{
  "version": 1,
  "packages": [
    { "name": "@arnilo/prism-provider-anthropic", "version": "^0.13.0", "integrity": "sha512-…", "capabilities": ["models"] },
    { "name": "@arnilo/prism-tools-coding", "version": "^0.13.0", "integrity": "sha512-…",
      "config": { "root": "." } },
    { "name": "@arnilo/prism-approval", "version": "^0.13.0", "integrity": "sha512-…",
      "config": { "mode": "ask" } },
    { "name": "@arnilo/prism-tools-web", "version": "^0.13.0", "integrity": "sha512-…", "optional": true,
      "config": { "backend": "brave", "apiKey": "env:BRAVE_API_KEY" } },
    { "name": "@arnilo/prism-memory-observational", "version": "^0.13.0", "integrity": "sha512-…", "enabled": false,
      "config": { "observer": { "model": "anthropic/claude-haiku-4-5" } } }
  ],
  "slots": { "store": "@arnilo/prism-store-jsonl" }
}
```

- **Storage.** Packages are installed with `bun add` into a Prism-managed directory: `.prism/packages/` for project scope, `~/.prism/packages/` for user scope. The loader imports from there. Integrity is checked against the recorded hash before import.
- **Scopes merge user first, then project.** An entry is keyed by package name, and a project entry overrides the user entry's version, config, and enabled flag. Array order is load order within the dependency constraints.
- **Project trust.** A project manifest loads only after the host's trust callback approves it. The callback receives the manifest's package names, versions, and declared capabilities. With no callback, the project scope does not load. This is the same rule as project MCP servers today.
- **Every installed entry records `capabilities` (amended in plan 150).** `install` imports the package once and records what it declares beside `version` and `integrity`, so the project trust prompt can show capabilities before any project code is imported. The loader fails closed with `capabilities_drift` when the installed package declares something else. The sample above omits the field on all but the first entry for brevity; the format requires it with `version` and `integrity` (an override entry in project scope carries none of the three). See `docs/next/manifest.md`.
- **Secret fields accept refs only.** Refs look like `env:NAME` or `keyring:name`. A literal value fails validation.
- **API** (`@arnilo/prism/manifest`):
  - `loadManifest({ root?, scopes?, trustProject? }) → PackageInput[]`
  - `install(name, { scope, version })`
  - `remove`
  - `setEnabled`
  - `configure` (schema-validated)
  - `assignSlot`
  - `list`
- **CLI** (`prism`): `add`, `remove`, `list`, `enable`, `disable`, `config`, `slot`, and `verify` (re-checks integrity and config).

### 2.8 Surfaces are host libraries

ACP, AG-UI, MCP-server, and messaging channels drive an agent from outside. They don't change its behavior, so they are libraries that take an `Agent`, not packages:

- `serveAcp(agent, { stdio })`
- `createAgUiHandler(agent)`
- `serveMcp(agent, …)`
- `connectTelegram(agent, …)`

Each surface implements `HostUi` for its protocol. For example, ACP maps `confirm` to a client permission request. Each surface uses only the public SDK API.

`@arnilo/prism-mcp-server` serves in two ways:

- `serveMcp(agent, …)` serves a whole agent: a prompt goes in and an answer comes out.
- `serveTools(run, …)` serves an allow-list of the running agent's tools, and optionally a permission-prompt tool, over MCP to a vendor coding agent for the length of one run (§2.12.12). Claude Code and the Antigravity CLI take Prism tools this way; Codex can also take them as dynamic tools. Every call goes through `run.executeTools`, so approval, governance, redaction, and persistence still apply.

### 2.9 Native package catalog

Native packages are ordinary packages. None is installed by default.

| Package | What it does | Mechanisms | Built from (0.12.1) |
| --- | --- | --- | --- |
| `@arnilo/prism-provider-{anthropic, openai, google, azure, bedrock, vertex, deepseek, xai, zai, alibaba, kimi, clinepass, commandcode, hyper, laya, neuralwatt, ollama, opencode-go, openrouter, typesafe, ai-sdk}` | One vendor each: wire adapter, model catalog and discovery, auth methods, OAuth over `host.ui` | `providers.register`, credentials | `prism-providers` subpaths; `prism-code` `providers.ts`, `oauth.ts` |
| `@arnilo/prism-credentials-keyring` | OS keyring and encrypted credential store | `credentials` slot | `prism-core/credentials`, `prism-code` `credentials.ts` |
| `@arnilo/prism-tools-coding` | fs, edit, grep, shell, sandbox, execution policy, git, checks, todo with a continuation stop hook, `ask_user`; the `workspace` service (worktree create/dispose, bounded `diff`, merge with conflicts reported; §2.12.14) | tools, `tool.call` hard denies, `run.end`, `host.ui`, `services.provide("workspace")` | `prism-coding-tools/agent`, `/security`, `createCodingWorkspaceLifecycle` |
| `@arnilo/prism-tools-web` | search and fetch: Brave, Exa, Firecrawl, Obscura | tools, `services.provide("web.fetch")` | `web-tools` |
| `@arnilo/prism-tools-browser` | Playwright browser automation | tools | `web-tools/browser` |
| `@arnilo/prism-tools-work` | Office documents, sheets, diagrams, document reader, M365/Google connectors | tools, skills | `prism-work` |
| `@arnilo/prism-tools-computer-use` | Linux desktop control | tools, `tool.call` | `prism-coding-tools/computer-use-linux` |
| `@arnilo/prism-tools-openapi` | Tools generated from OpenAPI specs | tools | `prism-coding-tools/openapi` |
| `@arnilo/prism-approval` | Approval modes `deny` / `ask` / `edits` / `auto` over tool `effects` and roots; hard denies stay on | `tool.call` | `prism-code` `approval.ts`, the policy half of `PermissionPolicy` |
| `@arnilo/prism-context-files` | AGENTS.md / SYSTEM.md layering with a trust policy | `context.build` | SDK instructions plane, `node/instruction-sources`, `node/system-prompts` |
| `@arnilo/prism-context-engineering` | Context budget, tool-result fold, tool search, attention compiler | `context.build`, `compaction.when` | `src/context-budget.ts`, `tool-result-fold.ts`, `tool-search.ts`, `attention-compiler.ts` |
| `@arnilo/prism-memory-compaction` | LLM summary compaction | `compaction` slot, `models` | `memory/compaction/llm` |
| `@arnilo/prism-memory-observational` | Observer and reflector agents on a separate model, observation-based compaction, `recall` tool, per-session toggle, `/om` commands | `compaction` slot, `context.build`, `turn.completed` + background, state, tools, commands, events | `memory/compaction/observational-memory`, `prism-code` `observational-memory.ts` |
| `@arnilo/prism-memory-rag` | Retrieval over indexed sources; owns the embeddings contract | tools, `context.build` | `memory/rag` |
| `@arnilo/prism-memory-wiki` | Wiki ingest and query with bundled skills | tools, skills, commands, consumes `web.fetch` | `memory/wiki`, `prism-code` `wiki.ts` |
| `@arnilo/prism-memory-fabric` | Working, semantic, and scoped memory | tools, `context.build`, state | `memory/fabric`, `memory/scoped`, `memory` core |
| `@arnilo/prism-store-{jsonl, sqlite, postgres}` | Durable session stores (Postgres loads `pg` only in its own package), with session links and list/search filters (K4). SQLite and Postgres also provide the `checkpoints` and `leases` services that workflows use (§2.12.13), and the `external_state` entries that vendor drivers archive and resume from (K5) | `store` slot, services | `node/session-store-jsonl`, `prism-core/sessions`, `src/checkpoints.ts`, `src/leases.ts` |
| `@arnilo/prism-store-codecs` | Row, cursor, and ownership-scope codecs plus dialect-local query semantics shared by the SQLite and Postgres stores; a plain library with no slot and no capability | — | `prism-core/sessions/codecs`, `prism-core/sessions/query-semantics.ts` |
| `@arnilo/prism-mcp` | MCP client: servers, trust over `host.ui`, header refs, status/reconnect as commands and events | tools, commands, events | `mcp` client, SDK MCP plane, `prism-code` `mcp.ts` |
| `@arnilo/prism-hooks-json` | Claude/Codex-compatible `hooks.json` mapped onto hooks | hooks | `hooks` |
| `@arnilo/prism-governance` | Policy engine and OPA, identity verification and principal enforcement, audit | `tool.call`, `run.input`, `model.request`, observe | `prism-core/governance/policy`, `src/identity.ts`, `secure-agent.ts`, field policy and evidence modules |
| `@arnilo/prism-guardrail-packs` | Versioned rule packs | `tool.call`, `tool.result` | `src/guardrail-packs` |
| `@arnilo/prism-model-router` | Route turns across models | `model.call` | `prism-core/governance/model-router` |
| `@arnilo/prism-observability` | OpenTelemetry export; spans carry `origin` attributes, and workflow spans parent their child sessions' spans | observe | `prism-core/governance/observability` |
| `@arnilo/prism-workflows` | Typed graph workflows (DAG and cyclic) that orchestrate any set of `Agent`s, including driver agents, from outside their sessions: `agentNode`, `gateNode`, `humanGate`, routed `fanOut`, checkpoints, suspend/resume, a merged event stream, `workflowCommand`. Also a `workflowLoop` adapter for single-agent workflows in the `loop` slot (§2.12.13) | library over `Agent`/`Session`, `loop` slot, commands, consumes `checkpoints`/`leases`/`workspace` | `prism-core/runtime/workflows` |
| `@arnilo/prism-delegate` | Sub-agents as a tool, inheriting a chosen package set; events carry `origin.kind: "prism"` | tools, `createAgent` | `src/delegated-agent-step.ts` |
| `@arnilo/prism-driver-claude-code` | Custom agents on the user's installed, unmodified `claude` binary (`-p`, `stream-json` in and out) under a subscription profile (`claude auth login` through a host terminal) or an API key: `--system-prompt[-file]`/append, `--tools`/`--disallowedTools`, Prism tools and the permission-prompt tool over MCP (`serveTools`, `--strict-mcp-config`), skills as a generated `--plugin-dir`, `--agents`, `PreToolUse`/`Stop` hooks through `prism relay` (fail closed), every stream message → `observe` (text and thinking deltas, `Skill` activations, nested sub-agents, compaction, retries and rate limits, usage), transcript archived for resume (§2.12.11) | `slot:loop` via driver-kit | new |
| `@arnilo/prism-driver-codex` | Custom agents on the user's `codex` binary through Prism's own TypeScript client of `codex app-server`, under a ChatGPT-plan profile (local deployments; hosted needs Sign in with ChatGPT) or an API key: `baseInstructions`/`developerInstructions`, Prism tools as `dynamicTools` or MCP, skills through extra roots, `turn/steer`/`turn/interrupt`, approval requests → `ask`, every item and delta → `observe` (reasoning, commands, file diffs, plans) (§2.12.11) | `slot:loop` via driver-kit | new |
| `@arnilo/prism-driver-antigravity` | Custom agents on the user's `agy` binary (`stream-json` in and out, generated `--agent`) with configuration written as a worktree `.agents/` overlay: system prompt, tools, rules, skills, MCP, hooks through `prism relay`; `step_update` → `observe` (text deltas, tool calls, `IsSkillFile` skill reads, sub-agent summaries, thinking token counts). Runs under the user's own Google sign-in (Google AI Pro/Ultra quotas) for `deployment: "local"`, or a Gemini API key; account sign-in on a hosted deployment fails closed (§2.12.5, §2.12.11) | `slot:loop` via driver-kit | new |

Host libraries (not packages):

| Library | Built from |
| --- | --- |
| `@arnilo/prism-acp` | `ag-ui/acp`, `acp-agent`, `prism-code` `acp.ts` |
| `@arnilo/prism-ag-ui` | `ag-ui` |
| `@arnilo/prism-mcp-server` (`serveMcp`, and `serveTools` for vendor coding agents, §2.12.12) | `mcp` server (`createPrismMcpServer`, `createPrismMcpWebHandler`, `servePrismMcpStdio`) |
| `@arnilo/prism-channels` (Telegram, Signal) | `prism-channels` |
| `@arnilo/prism-evals` | `prism-core/governance/evals` |
| `@arnilo/prism-devtools` | `prism-coding-tools/dev` |

Retired:

- **`@arnilo/prism-agent-sdk`.** Its planes map as follows:
  - skills → kernel
  - instructions → `context-files`
  - hooks → `hooks-json`
  - MCP → `mcp`
  - tool planes → `tools.add` / `disable.tools` plus tool packages
  - presets → removed
- The 0.12 family packages (`prism-providers`, `prism-coding-tools`, `web-tools`, `memory`, `prism-core`, `prism-work`, `hooks`, `mcp`, `ag-ui`, `prism-channels`) are deprecated on npm once their native replacements ship.

The phase that moves each remaining 0.12.1 runtime module out of the kernel decides where it goes or whether it is deleted. This covers `artifacts`, `devices`, `feedback`, `rpc`, `run-bundle`, `run-ledger`, `conversations`, `use-case-model`, `cache-telemetry`, and the speech, transcription, video, moderation, batch, and realtime contracts.

Two modules already have a destination, set by Phase 16 (§2.12.13). `checkpoints` (`src/checkpoints.ts`) and `leases` (`src/leases.ts`) move into `@arnilo/prism-workflows` as the `checkpoints` and `leases` service contracts, with in-memory defaults. Their SQLite and Postgres implementations go into the store packages. The execution-timeline projector (plan 072) moves to `@arnilo/prism-observability` and groups steps by `origin`.

### 2.10 Repository structure

```
prism/
├─ src/                              @arnilo/prism — the SDK kernel (layout in 2.2)
├─ packages/
│  ├─ providers/<vendor>/            @arnilo/prism-provider-<vendor>
│  ├─ credentials/keyring/           @arnilo/prism-credentials-keyring
│  ├─ tools/{coding,web,browser,work,computer-use,openapi}/
│  ├─ context/{files,engineering}/
│  ├─ memory/{compaction,observational,rag,wiki,fabric}/
│  ├─ stores/{jsonl,sqlite,postgres}/
│  ├─ policy/{approval,governance,guardrail-packs,model-router}/
│  ├─ integrations/{mcp,hooks-json,observability,workflows,delegate}/
│  ├─ drivers/{claude-code,codex,antigravity}/   @arnilo/prism-driver-<name>
│  └─ hosts/{acp,ag-ui,mcp-server,channels,evals,devtools}/   host libraries
├─ apps/prism-code/                  reference host (TUI), @arnilo/prism-code
├─ examples/                         host and package examples, execution-gated
└─ docs/
```

Every package directory has the same shape:

- `package.json` with `"exports": { ".": "./src/index.ts" }` and a `requires` range in the definition
- `src/index.ts` whose default export is `definePackage`
- `src/__tests__/`, which runs the package conformance suite
- `README.md`

### 2.11 Worked examples

**Minimal host.** Built-in model access, no packages.

```ts
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: { provider: "openai-compatible", model: "llama-3.3-70b", baseUrl: "http://localhost:8080/v1", credential: "env:LOCAL_KEY" },
  instructions: "You are terse.",
  tools: { add: [weatherTool] },
});
const result = await (await agent.session()).run("Weather in Oslo?");
```

**Prism Code.** Manifest-driven, TUI-only host.

```ts
const agent = await createAgent({
  model: config.model,
  packages: await loadManifest({ root: cwd, trustProject: (m) => tui.confirmProjectPackages(m) }),
  // the manifest holds: provider-*, tools-coding, approval, tools-web, context-files,
  // hooks-json, memory-observational, store-jsonl
  host: { ui: tuiHostUi },
});
// The TUI renders events (including package.event such as om.status), lists agent.commands
// (which include /om and /om:model from the OM package), answers host.ui requests, and shows
// agent.inspect() as `doctor`. It imports nothing but @arnilo/prism.
```

**The observational memory package.** This replaces the host-side coordinator entirely.

```ts
export default definePackage({
  name: "@arnilo/prism-memory-observational",
  version: "0.13.0",
  requires: { prism: "^0.13" },
  capabilities: ["models", "session-state", "background", "slot:compaction"],
  config: omConfigSchema, // enabled (default false), observer.model, reflector.model, thresholds
  setup(prism) {
    const om = prism.state.session("om", { enabled: prism.config.enabled, ledger: emptyLedger() });
    const on = (s: SessionContext) => om.get(s).enabled;

    prism.tools.register(recallTool(om), { when: on });
    prism.hooks.on("context.build", (draft) => (on(draft.session) ? withObservations(draft, om.get(draft.session)) : draft));
    prism.hooks.on("turn.completed", (event) => {
      if (on(event.session)) event.session.background("om.observe", () => observe(prism.models.client(observerModel(prism, event)), om, event));
    });
    prism.slots.compaction.provide(observationalCompactor(prism, om)); // compacts using observations and reflections
    prism.commands.register({ name: "om", description: "Toggle observational memory for this session", run: (_, ctx) => toggle(om, ctx) });
    prism.commands.register({ name: "om:model", args: modelArgSchema, run: (args, ctx) => setObserverModel(om, args, ctx) });
  },
});
```

If `@arnilo/prism-memory-compaction` is also installed, both packages claim the compaction slot. `createAgent` fails closed until the host or manifest assigns the owner.

**A package that owns the loop.**

```ts
export default definePackage({
  name: "@acme/prism-plan-execute-verify",
  version: "0.13.0",
  requires: { prism: "^0.13" },
  capabilities: ["slot:loop"],
  setup(prism) {
    prism.slots.loop.provide({
      name: "plan-execute-verify",
      revision: "1",
      async run(run) {
        const plan = await run.turn({ tools: false, system: PLAN_PROMPT });
        for (const step of parsePlan(plan)) {
          for (;;) {
            const t = await run.turn({ system: stepPrompt(step) });
            if (t.toolCalls.length === 0) break;
            await run.executeTools(t.toolCalls); // tool.call still fires: approval and governance still apply
          }
        }
        await run.turn({ tools: ["run_checks"], system: VERIFY_PROMPT });
      },
    });
  },
});
```

**Host hooks.** The host is an inline package.

```ts
await createAgent({
  model,
  packages,
  hooks: (hooks) => {
    hooks.on("tool.call", (call) => (call.effects.includes("network") && !allowNetwork ? { deny: "network disabled" } : undefined));
    hooks.on("turn.before", (t) => (t.usage && costOf(t.usage) > budget ? { stop: "budget" } : undefined));
  },
  disable: { tools: ["shell"], hooks: ["@arnilo/prism-context-files:context.build"] },
});
```

**A host orchestrating Prism agents and custom agents on vendor coding agents in one workflow** (the full design is in §2.12):

```ts
import { createAgent, definePackage } from "@arnilo/prism";
import { profiles } from "@arnilo/prism/driver-kit";
import { defineWorkflow, agentNode, gateNode, humanGate, fanOut, workflowCommand } from "@arnilo/prism-workflows";
import sqlite from "@arnilo/prism-store-sqlite";
import toolsCoding from "@arnilo/prism-tools-coding";
import approval from "@arnilo/prism-approval";
import claudeCode from "@arnilo/prism-driver-claude-code";
import codex from "@arnilo/prism-driver-codex";
import workflows from "@arnilo/prism-workflows";

const store = sqlite({ path: ".build/prism.db" });   // one file holds every agent's sessions and vendor state
const shared = { slots: { store: "@arnilo/prism-store-sqlite" }, host: { ui }, principal: user };
const skills = { dirs: ["./skills"] };               // one skill library; drivers materialize what each spec selects

// One-time sign-in per person and vendor, through each vendor's own flow in a host terminal (K6).
// Prism never sees the credentials; the binaries keep them in the profile's home.
await profiles.ensure("claude-code", "alice-claude", { principal: user, deployment: "local", maxConcurrentRuns: 2 });
await profiles.ensure("codex", "alice-codex", { principal: user, deployment: "local", credential: "chatgpt" });

// /build is a host package; the definition is resolved lazily because it references the agents below.
const buildCommand = definePackage({ name: "acme-build", version: "0.13.0", requires: { prism: "^0.13" },
  setup: (prism) => prism.commands.register(workflowCommand("build", () => build)) });

const host = await createAgent({ model: "anthropic/claude-sonnet-4-5", skills,
  packages: [store, toolsCoding({ root }), approval({ mode: "ask" }), workflows, buildCommand], ...shared });

const planner = await createAgent({ skills, packages: [store, toolsCoding({ root }), approval({ mode: "ask" }),
  claudeCode({
    name: "planner", profile: "alice-claude",            // runs on Alice's Claude subscription
    systemPrompt: { replace: PLANNER_PROMPT },
    model: "opus",
    builtinTools: { allow: ["Read", "Grep", "Glob"] },     // its own tools, narrowed
    prismTools: ["repo_search"],                          // served over MCP, gated by approval
    skills: ["architecture-review"],
    requires: { systemPrompt: "replace", builtinTools: "per-tool", thinking: "deltas", subscription: "permitted" },
  })], ...shared });

const uiEngineer = await createAgent({ skills, packages: [store, toolsCoding({ root }), approval({ mode: "ask" }),
  claudeCode({
    name: "ui-engineer", profile: "alice-claude",
    systemPrompt: { replace: UI_ENGINEER_PROMPT },
    builtinTools: { allow: ["Read", "Grep", "Glob"] },
    prismTools: ["edit", "write", "shell", "run_checks"],
    skills: ["design-system", "accessibility"],
    subagents: { reviewer: { name: "reviewer", profile: "alice-claude", systemPrompt: { replace: UI_REVIEW_PROMPT }, builtinTools: { allow: ["Read"] } } },
    requires: { gated: ["write", "execute"] },            // met: built-in writes are removed, Prism's are gated
  })], ...shared });

const validator = await createAgent({ skills, packages: [store, toolsCoding({ root }), approval({ mode: "ask" }),
  codex({
    name: "validator", profile: "alice-codex",            // runs on Alice's ChatGPT plan (local deployment)
    systemPrompt: { append: VALIDATOR_PROMPT },
    prismTools: ["run_checks", "repo_search"],
    skills: ["test-triage"],
    vendor: { sandbox: "read-only", approvalPolicy: "on-request" },
  })], ...shared });

const build = defineWorkflow({ id: "build", revision: "1", limits: { maxSupersteps: 32 }, nodes: {
  research: agentNode({ agent: host, input: (ctx) => ctx.args.goal }),
  plan:     agentNode({ agent: planner, input: (ctx) => planPrompt(ctx.outputs.research) }),
  planOk:   gateNode({ check: (ctx) => validatePlan(ctx.outputs.plan) }),       // deterministic; failure routes back to plan
  approve:  humanGate({ request: { kind: "confirm", title: "Execute this plan?" } }),
  execute:  fanOut({ items: (ctx) => ctx.outputs.plan.tasks, maxConcurrency: 3,  // also capped by alice-claude's maxConcurrentRuns
              route: (task) => agentNode({ agent: task.ui ? uiEngineer : host, worktree: true, input: () => task.prompt }) }),
  merge:    gateNode({ check: (ctx) => ctx.services.workspace.merge(ctx.outputs.execute) }),
  validate: agentNode({ agent: validator, input: (ctx) => validationPrompt(ctx) }),
  tests:    gateNode({ check: () => runTests() }),
}, edges: [["research", "plan"], ["plan", "planOk"], ["planOk", "approve"], ["approve", "execute"],
           ["execute", "merge"], ["merge", "validate"], ["validate", "tests"]] });

// host.commands.run("build", { goal }, { session }) starts it.
// The UI renders one merged stream: run.stream() yields every agent's events, each with `origin` — text and
// thinking deltas, tool calls, agent.skill activations, agent.file changes, vendor sub-agents, rate-limit notices.
// createSessionIndex(store).search({ text: "auth", workflowRunId }) searches every agent's sessions.
```

### 2.12 Vendor coding agents and orchestration

This section is the design input for Phases 13–16. Each phase plan should start from it. The research in §2.12.4 and §2.12.5 was done on 2026-10-04 against the linked sources. Vendor CLIs and terms change quickly, so Phase 15's review re-verifies every claim and records what changed.

#### 2.12.1 The use case

A host uses Prism to build its own agentic loops and graph workflows with deterministic gates. It also defines **custom agents**, each with its own system prompt, tools, skills, sub-agents, and model, and runs them on **vendor coding agents**: Claude Code, Codex, and the Antigravity CLI.

The vendor agents run under the user's own **subscription plan** (Claude Pro/Max, ChatGPT plans that include Codex, Google AI Pro/Ultra) wherever the vendor's terms allow it. Subscription use is the requirement this direction is built around.

Example: the host builds software. It implements a `/build` command that starts a graph workflow:

1. research and investigation
2. planning
3. execution
4. validation and testing

Deterministic gates sit between the steps.

- Planning is delegated to a custom "planner" agent on Claude Code.
- Validation is delegated to a custom "validator" agent on Codex.
- Implementation tasks 2, 5, and 6 are UI tasks and go to a custom "ui-engineer" agent on Claude Code. The host's own Prism agent does the rest.

The host wants to:

- **Define the delegated agents.** System prompt, tools (its own Prism tools as well as vendor built-ins), skills, sub-agents, and model, all chosen per agent.
- **Run them on the user's subscription,** without handling the user's subscription credentials.
- **Own the session data.** Every agent's sessions live in Prism's store and can be searched.
- **Communicate with the agents.** Prompt them automatically, steer, abort, and answer their questions and permission requests.
- **Capture everything they do:** messages, thinking, skill activation, tool calls, file changes, plans, sub-agents, compaction, usage, rate limits, retries, and errors, as attributed events.
- **Show one interface.** The user sees several agents as one unified workflow.

#### 2.12.2 Why the vendor binaries, not the SDKs

An earlier revision of this section, also dated 2026-10-04, built these agents on vendor **SDK runtimes**: the Claude Agent SDK, the Codex app-server protocol, and the Antigravity SDK. The research showed that subscription plans cannot be used on that route for a product:

- **Anthropic** requires API-key or cloud-provider authentication for products built on the Agent SDK.
- **Google's** Antigravity SDK accepts only Gemini API keys or Vertex.

The vendors' own coding-agent **binaries** do support subscription sign-in. Anthropic's terms explicitly allow an end user to sign in to the unmodified Claude Code binary with their own subscription, including where a product runs it (§2.12.5).

So Prism drives the **unmodified vendor binaries** (`claude`, `codex`, `agy`) through their documented headless and programmatic surfaces:

- the user signs in to each binary through the vendor's own flow
- the binary keeps its own credentials
- Prism configures the agent through documented flags and files, and receives structured events

The SDK route is recorded in §2.12.17 as an API-key-only option and is not in 0.13.0.

#### 2.12.3 What already covers it

| Requirement | Covered by | Evidence |
| --- | --- | --- |
| A `/build` command | Kernel command registry and dispatch | §2.6 Commands; `agent.commands.run` (§2.3) |
| Deterministic gates inside one agent | `tool.call`, `run.end`, `turn.before` hooks; `loop` slot | §2.4, §2.5 |
| A graph workflow engine | 0.12 `runWorkflow`: DAG and cyclic graphs; conditional, route, fan-out, join, loop, and nested nodes; checkpoints; suspend/resume; replay; graph export; run overlay | `packages/prism-core/src/runtime/workflows/`, `docs/workflows.md` |
| Sessions in SQLite with search | Phase 6 `store-sqlite` with FTS; `SessionStore.searchSessions` / `listSessions` | plan 153; `src/contracts-core/session.ts:73-80` |
| Approvals and questions to a person | `tool.call` returns `ask`, answered inline through `host.ui` or by suspending the run | §2.4; `docs/next/loop.md` |
| Showing a person a URL | `HostUi` `open-url` | §2.3 Host port |
| Tools with JSON Schema and effects | Kernel `ToolDefinition` registry, validation, `effects` | §2.6 Tools |
| Skills as `SKILL.md` directories | Kernel skills registry, discovery, and disclosure | §2.1; `AgentConfig.skills` |
| Thinking as content | `thinking` content blocks in Prism messages | `src/contracts-core/content.ts:73` |
| Serving Prism tools over MCP | `createPrismMcpServer`, `createPrismMcpWebHandler` (Host/Origin allow-lists, per-request auth), `servePrismMcpStdio` | `packages/mcp/src/server.ts:52` |
| Attributing sub-agent events | Events carry `child: { childId, delegationId, depth }` for in-process delegated Prism children | `src/contracts-protocol.ts:205`; `docs/next/events.md` |
| Worktree isolation | `createCodingWorkspaceLifecycle` | `packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:243` |
| A `hooks.json` command-hook model | `@arnilo/prism-hooks-json` (Claude/Codex-compatible) | §2.9 |

#### 2.12.4 The three binaries (research, 2026-10-04)

**Claude Code: `claude`.** Sources: [CLI reference](https://code.claude.com/docs/en/cli-reference), [headless](https://code.claude.com/docs/en/headless), [hooks](https://code.claude.com/docs/en/hooks).

- **Headless session.**
  - `claude -p --input-format stream-json --output-format stream-json --verbose` keeps one process per conversation and reads prompts from stdin.
  - `--include-partial-messages` adds token deltas.
  - `--forward-subagent-text` adds sub-agent text and thinking, nested by `parent_tool_use_id`.
  - `--include-hook-events` adds hook lifecycle events.
  - `--replay-user-messages` echoes stdin messages.
  - The stream carries the same message types as the Agent SDK:
    - `system/init`: tools, `mcp_servers`, `mcp_server_errors`, plugins, `plugin_errors`, and a `capabilities` list
    - `assistant`: text, thinking, and tool_use blocks
    - `user`: tool results
    - `stream_event`
    - `system/api_retry`, whose error categories include `rate_limit`, `billing_error`, `authentication_failed`, and `oauth_org_not_allowed`
    - `permission_denied`
    - hook events
    - `result`: usage, `total_cost_usd` (a client-side estimate), and `session_id`
- **Defining the agent:**
  - `--system-prompt` / `--system-prompt-file` replace the prompt; `--append-system-prompt[-file]` and `--append-subagent-system-prompt[-file]` append.
  - `--tools` sets the available built-ins, with `""` for none. `--disallowedTools` denies. `--allowedTools` pre-approves.
  - `--mcp-config` with `--strict-mcp-config` uses only the given MCP servers.
  - `--agents` takes sub-agent definitions as JSON or a file. `--plugin-dir` loads a plugin with skills.
  - Also: `--settings` (inline JSON or a file, including hooks), `--setting-sources user,project,local`, `--model`, `--effort`, `--max-turns`, `--max-budget-usd`, `--json-schema`.
- **Gating.**
  - `--permission-prompt-tool <mcp tool>` sends remaining permission prompts to an MCP tool, and `--permission-prompts host|none` controls whether anyone is asked.
  - Hooks in `--settings` can be `command`, `http`, `mcp_tool`, `prompt`, or `agent`.
  - `PreToolUse` returns `permissionDecision` (`allow` / `deny` / `ask` / `defer`) and can set `updatedInput`. A command hook's exit code 2 always blocks.
  - **An HTTP hook that cannot connect or times out is a non-blocking error, and execution continues.** So an HTTP hook cannot be the gate.
  - `Stop` hooks can make the agent continue.
- **Sessions.** `--session-id <uuid>`, `--resume <id | absolute path to a .jsonl transcript>`, `--fork-session`. The transcript lives in the config directory.
- **Stopping.** SIGINT ends the current turn. SIGTERM stops the process, which exits with code 143.
- **Isolation.** `CLAUDE_CONFIG_DIR` selects the config directory, which holds settings, skills, plugins, transcripts, and the login.
  - **`--bare` never reads OAuth credentials or the keychain**, so it cannot be used with a subscription.
  - `--safe-mode` disables plugins and MCP servers, which the bridge needs.
  - Without `--bare`, a `-p` run in a repository runs that repository's `.claude/settings.json` hooks and `.mcp.json` servers unless `--setting-sources` and `--strict-mcp-config` exclude them. Whether the repository's `CLAUDE.md` can be excluded without `--bare` is to verify.
- **Authentication.**
  - `claude auth login` signs in through Anthropic's flow. `--console` switches to API billing.
  - `claude auth status` prints JSON with `authMethod` (`claude.ai`, `oauth_token`, `api_key`, …) and `configDirectory`. It exits 0 when logged in.
  - `claude setup-token` prints a long-lived OAuth token "for CI and scripts".

**Codex: `codex`.** Sources: [app-server](https://learn.chatgpt.com/docs/app-server), [auth](https://learn.chatgpt.com/docs/auth), [TypeScript SDK source](https://github.com/openai/codex/tree/main/sdk/typescript).

- **Two headless surfaces of the same binary.**
  - `codex exec --json` is what the official TypeScript SDK wraps. Its stdin is closed after the prompt, so it has no approvals, steering, deltas, or instructions field.
  - `codex app-server` speaks JSON-RPC 2.0 as JSONL over stdio. OpenAI points to it for integrations that need approvals and streamed events. **Prism uses app-server.**
- **app-server.**
  - Lifecycle: `initialize` / `initialized`; `thread/start` (`baseInstructions`, `developerInstructions`, model, sandbox, approval policy, `config`, experimental `dynamicTools`), `resume`, `fork`, `read`, `list`; `turn/start`, `turn/steer`, `turn/interrupt`; `thread/inject_items`.
  - Items: `agentMessage`, `plan`, `reasoning` (summary and raw content), `commandExecution`, `fileChange` (with diff), `mcpToolCall`, `dynamicToolCall`, `collabToolCall`, `webSearch`, `imageView`, `contextCompaction`.
  - Deltas: agent message, plan, reasoning summary and raw text, command output.
  - Turn-level notifications: `turn/diff/updated`, `turn/plan/updated`, `hook/started` and `hook/completed`, `model/rerouted`, token usage.
  - Requests from the server to the client: command, file, and permission approvals; `tool/requestUserInput`; MCP elicitation; `item/tool/call` for dynamic tools.
  - Skills: `skills/list`, `skills/extraRoots/set`, `skill` input items.
  - Types are generated per version by `codex app-server generate-ts`.
- **Gaps.**
  - The built-in shell and patch tools are core: limited by the sandbox and approvals, not removable.
  - Implicit skill use is only detectable when the model reads a `SKILL.md`.
  - Thread state lives under `CODEX_HOME`.
- **Authentication.**
  - `codex login` (browser) or `codex login --device-auth`, or app-server `account/login/start` with `type: "chatgpt"` or `"chatgptDeviceCode"`, where Codex owns the flow. There is also an `apiKey` mode, and the experimental `chatgptAuthTokens` for hosts that run Sign in with ChatGPT.
  - Status: `account/read` (`authMode`, `planType`) and `codex login status`.
  - Credentials live in `CODEX_HOME/auth.json` or the OS keyring (`cli_auth_credentials_store = file | keyring | auto | ephemeral`).

**Antigravity CLI: `agy`.** Sources: [headless](https://antigravity.google/docs/cli/headless), [installation and auth](https://antigravity.google/docs/cli/install), [hooks](https://antigravity.google/docs/hooks), [custom subagents](https://antigravity.google/docs/subagents), [rules](https://antigravity.google/docs/rules), [CLI features](https://antigravity.google/docs/cli/features).

- **Headless session.** `agy --input-format stream-json --output-format stream-json` keeps one process per conversation.
  - Input is `{ "event": "user", "message": { "content": … } }` with text blocks only. `control_request` and `control_response` are rejected and end the session.
  - Output starts with `init` (`cwd`, `tools`, `permission_mode`, `model`, `agent`) and ends each turn with `result` (`conversation_id`, `status`, `response`, cumulative `usage` including `thinking_tokens`).
  - In between come `step_update` events: `step_type` (`user_input`, `agent_response`, `tool`, `checkpoint`), `state` (`ACTIVE`/`DONE`), `text_delta`, `tool_name`, `tool_info` (`name`, `parameters`, `output`, `error`), `subagent_info` (`type_name`, `role`, `conversation_id`, `log_uri`), and per-step `usage`.
  - **Thinking text is not in the stream**, only its token count.
  - A new prompt waits for the previous turn's `result`. Closing stdin ends the session after the current turn.
  - Flags: `--model`, `--effort`, `--agent`, `--conversation <id>`, `--continue`, `--json-schema`, `--sandbox`, `--print-timeout`.
- **Defining the agent.** Configuration is file-based, not flags:
  - custom agents are Markdown files with YAML frontmatter (`tools`, `subagent: true`) in `.agents/agents/<name>.md`; the body is the system prompt, and `--agent` selects one
  - rules: `AGENTS.md`, `GEMINI.md`, `.agents/rules/*.md`
  - hooks: `.agents/hooks.json`
  - plugins bundle skills, agents, rules, MCP servers, and hooks
  - permission rules (`allow` / `deny` / `ask` with `command(...)`, `write_file(...)`, `mcp(...)`) live in `~/.gemini/antigravity-cli/settings.json`

  Each of these exists at workspace level (`.agents/`) and global level (`~/.gemini/…`).
- **Gating.** `hooks.json` command hooks (`PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`) get JSON on stdin and return JSON on stdout.
  - `PreToolUse` returns `decision` (`allow` / `deny` / `ask` / `deny_unless_prior_grant`) and a `reason`. No input rewrite is documented.
  - `Stop` can return `decision: "continue"` with a reason that is injected.
  - `view_file` carries `IsSkillFile`, which identifies skill reads.
- **Authentication.**
  - Google account sign-in, cached in the OS keyring. Google AI Pro/Ultra quotas apply. Headless mode needs a prior interactive sign-in.
  - Or a Gemini API key: `modelProvider: "gemini"` in settings plus `GEMINI_API_KEY`.

#### 2.12.5 Subscriptions and vendor terms (2026-10-04)

| Vendor | Can the user's subscription drive the binary from a Prism host? | Conditions, quoted from the source |
| --- | --- | --- |
| **Anthropic.** Claude Pro / Max (and Team / Enterprise seats) with `claude` | **Yes, with conditions.** "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code." | From [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance):<br>• Running Claude Code in a product "requires agreeing to our Commercial Terms of Service".<br>• "The Claude Code binary must not be modified", and authentication methods must not be removed or restricted.<br>• "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own … Claude subscription plan credentials".<br>• "Developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow".<br>• "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK".<br>• **Caveat:** the headless page describes `claude -p` as "the Agent SDK via the CLI", and the developer guidance asks products built on the Agent SDK to use API keys. The binary-hosting clause is the one that covers an unmodified binary the user signed into, but this is a policy boundary. A host that distributes commercially should confirm with Anthropic. |
| **OpenAI.** ChatGPT plans with `codex` | **Yes for local or open-source apps; hosted or commercial services need Sign in with ChatGPT.** | From the app-server docs:<br>• "If you've built a local or open-source application using Codex app-server authentication, you can continue using it".<br>• "App-server authentication has never been permitted for commercial or hosted services"; Sign in with ChatGPT (a partner program) supports those.<br>• The [auth](https://learn.chatgpt.com/docs/auth) page: "The ChatGPT desktop app, Codex CLI, and IDE extension support both sign-in methods for local work", and "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs". |
| **Google.** Google AI Pro / Ultra with `agy` | **Yes for local use on the user's own machine. Hosted or commercial services: not without Google's confirmation.** | Google documents driving `agy` programmatically with the user's cached sign-in. [Headless mode](https://antigravity.google/docs/cli/headless): "Run Antigravity CLI non-interactively to script agent tasks, integrate with CI pipelines, and capture machine-readable output"; "Headless mode uses your cached credentials. Authenticate once with an interactive `agy` session first". Its "Drive a session programmatically" section spawns `agy --input-format stream-json --output-format stream-json` from a program.<br>The [Antigravity Terms](https://antigravity.google/terms) say: "You must not abuse, harm, interfere with, or disrupt the Service. This includes, but is not limited to, using the Service in connection with products not provided by us. Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts."<br>**Interpretation (2026-10-04):** the example names third-party software that reuses Antigravity's OAuth to reach the service directly, bypassing `agy`. A person whose own installed, unmodified `agy`, signed in through Google's flow, is driven by a local program through the documented headless interface is the case the headless docs describe; that is the same as a person's own script. The broad "in connection with products not provided by us" clause most plausibly bites when a third-party product runs `agy` as a service for others, or resells or pools access. So: local deployments yes; hosted or commercial deployments only with Google's written confirmation. A Gemini API key is permitted in every deployment. This reading is not legal advice, and the clause is broad enough that a conservative host may choose the API key everywhere. |

**What Prism enforces.** This is the driver kit's terms guard, configured per driver; a violation fails closed:

1. **Unmodified binaries only.** Prism runs the vendor-published binary the user installed. It never patches it, replaces it, or strips one of its authentication methods. The probed path and version are recorded in `inspect()`.
2. **No subscription credentials in Prism.**
   - Sign-in happens only through the vendor's own flow: the vendor login command in a terminal the host gives the user (K6), or a URL the vendor emits, shown with `open-url`.
   - Prism never reads, writes, copies, stores, or relays subscription tokens or token files.
   - `CLAUDE_CODE_OAUTH_TOKEN`, `claude setup-token` output, `auth.json`, and keyring entries are never credential refs.
   - API keys remain ordinary refs.
3. **One end user per subscription profile.** A profile is bound to the `principal` that signed in. Using it for another principal fails with `profile_principal_mismatch`. Prism never pools one subscription across users.
4. **Individual-usage pacing.** Each subscription profile has a concurrency cap (`maxConcurrentRuns`, default 2), which the host can change and which `inspect()` shows. Rate-limit, quota, and billing signals stop or defer the run and surface as `agent.notice`; there is no retry loop.
5. **Deployment declaration.** The host declares `deployment: "local" | "hosted"`.
   - Codex ChatGPT login is accepted only with `"local"`. With `"hosted"` it fails with `plan_login_not_permitted` unless the credential is `chatgptAuthTokens` from Sign in with ChatGPT, or an API key.
   - Claude subscription use with `"hosted"` requires the host to acknowledge Anthropic's Commercial Terms (`terms: { anthropic: "commercial-terms-accepted" }`), recorded in `inspect()`.
6. **Antigravity account sign-in is local only.** `driver-antigravity` accepts the user's own Google sign-in (cached by `agy` in the OS keyring) only with `deployment: "local"`, the same rule as Codex's ChatGPT sign-in. With `deployment: "hosted"`, account mode fails with `plan_login_not_permitted` unless the host records Google's written confirmation (`terms: { google: "<reference>" }`), shown in `inspect()`. A Gemini API key works in every deployment. Phase 15's review re-checks the terms.

These rules encode the current terms. They are not legal advice, and each driver README links the dated sources.

#### 2.12.6 Gaps

- **G1. Nothing can drive a vendor coding agent.**
  - No code drives `claude`, `codex app-server`, or `agy`.
  - "Delegated coding runtimes" (R09) was removed from 0.7.0 in plan 073 and never returned.
  - `prism-delegate` (§2.9) covers in-process Prism sub-agents only.
- **G2. Workflows were scoped as a `loop` slot package.** A loop is one run of one agent in one session. `/build` spans several agents and parallel branches. The 0.12 engine has the right shape because it orchestrates sessions from outside them.
- **G3. Tools cannot be executed through the gates for a caller other than the model loop.** §1.4 requires tools to execute only through `RunController.executeTools`. That is reachable only from a loop, and it returns `void` (`src/loop/types.ts:42`).
- **G4. No honest way to record foreign activity.**
  - `RunController.emit` accepts any `AgentEvent` (`src/loop/run-controller.ts:324`), so a loop could claim a tool ran under Prism's gates when it did not.
  - Steering is applied only inside `turn()` (`src/loop/run-controller.ts:66`).
- **G5. Sessions cannot be linked or searched across agents.**
  - `AgentConfig.model` is required (`src/contracts-core/agent.ts:63`).
  - `SessionListQuery` is scoped to one agent's ownership (`src/contracts-core/session.ts:88`).
  - Nothing links child sessions to a parent or a workflow run.
- **G6. Workflow checkpoints and leases have no 0.13 home** (`src/checkpoints.ts`, `src/leases.ts`).
- **G7. There is no portable agent definition, and nothing writes it into a vendor's configuration.**
  - Two vendors take most configuration as flags and one takes it as files.
  - Nothing isolates a delegated agent from the machine's own `~/.claude`, `CODEX_HOME`, `~/.gemini`, or the repository's agent configuration.
- **G8. The event model cannot carry everything a vendor agent reports:** thinking deltas, skill activation, sub-agent trees, compaction, rate limits and quotas, retries, and unmapped vendor messages.
- **G9. Vendor session state has no place in the store.** Claude's transcript file and Codex's thread are needed for resume, and only exist inside each binary's own home.
- **G10. There is no way to sign a person in to a vendor binary** without Prism touching their credentials. The host port has no "run this command interactively" request, and no model exists for a subscription profile, its owner, or its pacing.
- **G11. There is no callback channel from a vendor binary to Prism.** Vendor hooks and permission prompts call out through command hooks, HTTP hooks, MCP tools, or JSON-RPC requests. Gating needs a channel that **fails closed** when Prism is unreachable, and an HTTP hook does not (§2.12.4).

#### 2.12.7 Design

**An agent on a vendor binary is a Prism `Agent` whose loop is a driver.** A driver package fills the `loop` slot with a `LoopStrategy` that runs one vendor binary process per conversation. The host builds one `Agent` per custom agent.

What that agent inherits unchanged:

- Sessions in the shared store, with search.
- The event stream and `agent.subscribe()`.
- `steer`, `abort`, `close`.
- Limits.
- Suspension and resume.
- `inspect()`, commands, and package state.
- Every hook on the Prism tools the vendor agent calls.

The workflow engine therefore sees only `Agent`s.

**The agent definition.** Every driver accepts `ExternalAgentSpec` (defined in the driver kit):

```ts
interface ExternalAgentSpec {
  readonly name: string;
  readonly systemPrompt?: { readonly replace: string } | { readonly append: string };
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high" | "max";
  readonly prismTools?: readonly string[];              // from this Agent's tool registry, served to the vendor agent over MCP
  readonly builtinTools?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }; // the vendor's own tools
  readonly skills?: readonly string[] | "all";           // from this Agent's kernel skills registry, materialized for the vendor
  readonly subagents?: Readonly<Record<string, Omit<ExternalAgentSpec, "subagents">>>;
  readonly profile: string;                              // the subscription or API-key profile to run under (below)
  readonly isolation?: "strict" | "inherit";            // default strict
  readonly limits?: { readonly maxTurns?: number; readonly maxBudgetUsd?: number };
  readonly vendor?: Readonly<Record<string, JsonValue>>; // vendor-specific options, validated by the driver's schema
}
```

Tools and skills come from the driver agent's own Prism registries, and the spec only selects among them. One tool definition, one approval policy, and one skill library serve the host's Prism agents and every vendor agent.

**Profiles.** A profile is a Prism-managed home directory for one vendor binary that one person has signed into:

- `CLAUDE_CONFIG_DIR` for Claude, `CODEX_HOME` for Codex, the Antigravity home for `agy` (relocation to verify)
- stored under the host's chosen root (default `~/.prism/profiles/<driver>/<name>/`)

A profile records:

- the binary path and version
- the auth method last reported by the vendor's status command (never a secret)
- the bound `principal`
- the deployment mode and the terms acknowledgements
- `maxConcurrentRuns`

Prism creates a profile and asks for a sign-in with `profiles.login(name)`. That runs the vendor's own login command (`claude auth login`, `codex login [--device-auth]`, or an interactive `agy` start) with the profile's home through a K6 `terminal` request, and Prism never reads that terminal's input or output. When the host has no terminal, Prism sends a `notify` with the exact command to run. Codex can also use app-server `account/login/start`, in which case Prism shows only the URL Codex returns.

`profiles.status(name)` runs the vendor status command. A run on a signed-out profile fails with `auth_required` and names the login command. A profile can instead use an API key, as an ordinary credential ref.

**Isolation.** With `isolation: "strict"` (the default), the vendor agent sees only what Prism gives it:

- the profile's home, which contains no user hooks, skills, plugins, or MCP servers
- explicit flags or files
- for Claude, `--setting-sources user` pointing at the profile, `--strict-mcp-config`, and an explicit `--tools`
- for `agy`, configuration written into the delegation's worktree (below)

The repository's own agent instructions (`CLAUDE.md`, `AGENTS.md`) may still load. The descriptor states what each vendor allows to exclude, and the phase review verifies it. `isolation: "inherit"` uses the user's normal vendor home. It is an explicit host choice, shown in `inspect()`.

**Configuration materialization.** For each run, the driver kit writes a run directory under the profile containing:

- the system prompt files
- settings JSON with hooks
- an MCP config naming Prism's per-run tool server
- sub-agent definitions
- a plugin directory with the selected skills

For `agy`, whose configuration is workspace files, the driver writes `.agents/agents/<name>.md`, `.agents/hooks.json`, rules, skills, and the MCP config into the delegation's worktree and adds them to `.git/info/exclude`. A run without a worktree is refused under strict isolation (`worktree_required`). Run directories and overlays are removed on dispose.

**Callback broker.** One per run. It serves:

- the MCP tool server (`serveTools`, §2.12.12)
- the permission-prompt tool
- hook callbacks

It listens on loopback HTTP with a random per-run bearer token, and on a per-run Unix socket for the `prism relay` bin. **Gating hooks always go through `prism relay hook`, a command hook.** It forwards the hook's stdin JSON to the broker and prints the broker's answer. If the broker is unreachable or slow, it exits with code 2 for Claude or prints `deny` for `agy`. Gating therefore fails closed. HTTP hooks are used only for observation.

**How the spec reaches each binary** (Phase 15 re-verifies every cell):

| Spec field | Claude Code (`claude -p`) | Codex (`codex app-server`) | Antigravity (`agy`) |
| --- | --- | --- | --- |
| `systemPrompt.replace` | `--system-prompt-file` | `baseInstructions` | body of the generated `.agents/agents/<name>.md`, selected with `--agent` (replace semantics to verify) |
| `systemPrompt.append` | `--append-system-prompt-file` | `developerInstructions` | a generated always-on rule |
| `prismTools` | `--mcp-config` naming the broker's MCP server, with `--strict-mcp-config` | `dynamicTools` (experimental), or an MCP server through `config` | MCP server in the generated config (location to verify) |
| `builtinTools` | `--tools` and `--disallowedTools` | not removable; sandbox and approval policy | the agent frontmatter `tools` list plus generated permission rules |
| `skills` | a generated plugin through `--plugin-dir` | a generated root through `skills/extraRoots/set` | a generated workspace skills directory (location to verify) |
| `subagents` | `--agents` | not supported (`subagents: false`) | generated agent files with `subagent: true` |
| `model`, `effort` | `--model`, `--effort` | `model`, reasoning effort | `--model`, `--effort` |
| `limits` | `--max-turns` (and `--max-budget-usd`, which is an estimate on a subscription) | kernel wall-time and tool-round limits | `--print-timeout`, plus kernel limits |
| Gating | `PreToolUse` command hook through `prism relay hook` (`allow` / `deny` / `ask` / `defer`, `updatedInput`); `--permission-prompt-tool` for anything left; `--permission-prompts host` | approval requests answered over JSON-RPC | `PreToolUse` command hook through `prism relay hook` (`allow` / `deny`) |
| Continue at stop | `Stop` hook → `run.end` | a new `turn/start` from `run.end` | `Stop` hook `continue` → `run.end` |

**What gets captured.** Every vendor event is normalized through `run.observe`, and nothing is dropped silently:

| Activity | Claude Code | Codex | Antigravity | Prism record |
| --- | --- | --- | --- | --- |
| Assistant text | `text` blocks; `stream_event` deltas | `agentMessage`; deltas | `agent_response` `text_delta` | `message.delta` and `message.completed` |
| Thinking | `thinking` blocks and deltas (the model may summarize or redact) | `reasoning` summary and raw; deltas | **not available**; `thinking_tokens` only | `thinking` content, or usage only |
| Skill activation | `Skill` tool use (`source: "tool"`) | `skill` input (`"explicit"`); a read of a materialized `SKILL.md` (`"path"`) | `view_file` with `IsSkillFile` (`"tool"`) | `agent.skill` |
| Built-in tool calls | `tool_use` / `tool_result`; hook events | `commandExecution`, `fileChange`, `webSearch`, `mcpToolCall` items and deltas | `tool` steps with `tool_info` | `tool.*` with `executedBy: "external"` |
| Prism tool calls | the broker's MCP server | `item/tool/call` or the MCP server | the broker's MCP server | `tool.call` → `tool.execute` → `tool.result`, with `executedBy: "prism"` |
| File changes | Write/Edit inputs; worktree diff | `fileChange` diff; `turn/diff/updated` | write/replace tool parameters; worktree diff | `agent.file` (`"agent"` or `"diff"`) |
| Plans and todos | task tools and messages | `plan`; `turn/plan/updated` | task-management tool steps | `agent.plan` |
| Sub-agents | `parent_tool_use_id` with `--forward-subagent-text` (nested) | `collabToolCall` | `subagent_info` (role, conversation id); inner steps not streamed | nested `origin`; summary-only where the vendor streams no inner steps |
| Permission requests and questions | the relay hook; the permission-prompt tool; `AskUserQuestion` | approval requests; `tool/requestUserInput`; elicitation | the relay hook | `run.ask` or `host.ui`, recorded as `decision.*` |
| Compaction | `compact_boundary`; compaction hooks | `contextCompaction` | `checkpoint` steps | `agent.compaction` |
| Usage | `result` usage and `total_cost_usd` (estimate) | token usage | per-step and cumulative usage, including thinking tokens | `RunResult.usage`, `turn.completed` |
| Rate limits, quotas, retries | `system/api_retry` (`rate_limit`, `billing_error`, …) | rate-limit notifications, `error` items | `result.status` / `error` | `agent.notice`; paced per §2.12.5 rule 4 |
| Anything unmapped | other message types | other notifications | other events | `agent.raw` when `capture: "all"` |

**Sessions and resume:**

- **Claude.** The driver passes `--session-id`, archives the transcript `.jsonl` into K5 after each turn, and resumes with `--resume <path>` from a materialized copy. A Claude conversation therefore resumes from Prism's store on any machine that has a signed-in profile.
- **Codex.** Threads live in the profile's `CODEX_HOME`. The driver archives `thread/read` output into K5 for search and audit; resume uses `thread/resume` in that home.
- **Antigravity.** Resume uses `--conversation <id>` in `agy`'s own store, which the driver records.

#### 2.12.8 Separation of concerns

| Layer | Owns |
| --- | --- |
| **Host** | The `/build` command and graph definition. Deterministic gate functions. Routing rules. Each custom agent's `ExternalAgentSpec`. Which profiles exist and who signs into them. The deployment declaration and terms acknowledgements. A terminal for vendor sign-in. Worktree merge and conflict policy. Answering `host.ui` requests. Rendering the merged stream. Installing the vendor binaries. |
| **Kernel** (`@arnilo/prism`) | Model-less agents (K1). Driver primitives (K2). `origin` and the narrowed `emit` (K3). Session links and search across agents (K4). Vendor-state entries (K5). The `terminal` host request (K6). The `driver-kit` subpath, the `prism relay` bin, and `driverConformance`. All dependency-free. |
| **Packages** | `driver-claude-code`, `driver-codex`, `driver-antigravity`. The MCP tool server (`prism-mcp-server` `serveTools`). The graph runner (`prism-workflows`). The `workspace` service (`tools-coding`). Checkpoint and lease implementations (store packages). Origin-aware telemetry (`prism-observability`). |
| **Out of scope** | Installing or updating vendor binaries. Holding or relaying subscription credentials. Pooling or reselling subscriptions. Any UI. Using an LLM's judgment as a gate. Sandboxing vendor agents beyond their own sandboxes. |

#### 2.12.9 Kernel additions (Phase 13)

**K1. Model-less agents.**

- `AgentConfig.model` becomes optional. It is required unless the loop owner's descriptor declares `usesModel: false`. A missing model with any other loop fails `createAgent` with `model_required`.
- `run.turn()` on a model-less agent fails with `no_model`.
- `RunOptions.model` becomes `run.model`, which the driver maps to the vendor's `--model` when its descriptor says `models: "passthrough"`. With `"none"`, a per-run model fails closed.

**K2. Driver primitives on `RunController`** (the §2.5 sketch):

```ts
type ExternalActivity =
  | { kind: "message.delta"; content: TextContent | ThinkingContent }
  | { kind: "message"; message: Message }
  | { kind: "tool.started"; call: { id: string; name: string; args?: JsonValue }; effects?: readonly ToolEffect[] }
  | { kind: "tool.progress"; toolCallId: string; progress: JsonValue }
  | { kind: "tool.completed"; toolCallId: string; status: "finished" | "error" | "blocked"; result?: JsonValue; error?: string }
  | { kind: "skill"; name: string; source: "native" | "tool" | "explicit" | "path"; resolved: boolean }
  | { kind: "file"; path: string; change: "created" | "modified" | "deleted" | "moved"; diff?: string; source: "agent" | "diff" }
  | { kind: "plan"; entries: readonly { title: string; status: string }[] }
  | { kind: "subagent"; phase: "started" | "completed"; id: string; name?: string; parentToolCallId?: string; result?: string }
  | { kind: "compaction"; phase: "started" | "completed"; summary?: string }
  | { kind: "notice"; level: "info" | "warn" | "error"; code: string; message: string } // rate limit, quota, retry, reroute, auth
  | { kind: "usage"; usage: Usage }
  | { kind: "raw"; vendor: string; type: string; data: JsonValue };

interface ExternalToolRequest { readonly toolCallId: string; readonly name: string; readonly args: JsonValue; readonly effects: readonly ToolEffect[] }
type ExternalToolDecision = { allow: true; args?: JsonValue } | { allow: false; reason: string } | { respond: JsonValue };
```

- **`observe`** records activity:
  - text and thinking go through `message.delta` / `message.append`, so redaction applies, and are persisted with `origin`
  - `tool.*` activity emits the catalog `tool.*` events with `origin.executedBy: "external"`
  - the other kinds emit the driver kit's standard `agent.*` package events: `agent.skill`, `agent.file`, `agent.plan`, `agent.subagent`, `agent.compaction`, `agent.notice`, `agent.raw`
  - `subagent` opens a nested `origin` scope
  - usage folds into `RunResult.usage`
  - observed tool calls count against the tool-call limits
  - `observe` never fires `tool.call`
- **`ask`** gates a vendor tool before it runs:
  - It fires `tool.call` with `origin` and mapped effects. An unknown tool gets every effect.
  - `ask` resolves inline through `host.ui`. Without a UI, it suspends only on drivers that can resume. Otherwise it is a deny with reason `non_interactive`.
  - `rewrite` passes through only where the vendor accepts modified input (Claude `updatedInput`); otherwise it is a deny with `rewrite_unsupported`.
  - `respond` passes through only where the vendor can take a substituted result; otherwise it is a deny.
- **`run.end`** is also reachable from vendor `Stop` hooks. A `continue` decision keeps the vendor agent working, with the reason injected, capped by `limits.maxContinuations`.
- **`steers()`** yields the input queued by `session.steer()`. `steer_unsupported` is thrown where the vendor cannot take input mid-turn and the descriptor does not allow queueing it for the next turn.
- **`executeTools`** returns `ToolResult[]`, takes `origin`, and is re-entrant, so broker callbacks can call it concurrently.
- **`emit` is narrowed to `package.event`.**
- **Abort** must stop the vendor process within the driver's grace timeout: SIGINT, then SIGTERM, for Claude; `turn/interrupt`, then exit, for Codex; stdin close, then a signal, for `agy`.
- **Invariant tests:**
  - a loop cannot emit a catalog event
  - `observe` never fires `tool.call`
  - a non-resumable `ask` without a UI is a deny
  - a concurrent `executeTools` from the broker fires `tool.call`
  - thinking deltas persist as `thinking` content

**K3. `origin` attribution.**

```ts
interface EventOrigin {
  readonly kind: "prism" | "external";
  readonly agent: string;              // spec name, e.g. "ui-engineer"
  readonly vendor?: string;            // "claude-code" | "codex" | "antigravity"
  readonly profile?: string;           // profile name, never credentials
  readonly agentId: string;
  readonly delegationId?: string;
  readonly parentSessionId?: string;
  readonly parentToolCallId?: string;
  readonly subagentId?: string;
  readonly depth: number;
  readonly executedBy?: "prism" | "external";
}
```

- An optional `origin` goes on every event and on the `tool.call` payload.
- `origin` replaces `child` repo-wide. This is a 0.13 break with no alias.
- The catalog count does not change.

**K4. Session links and search across agents.**

- `SessionOptions.parent` (`sessionId`, `agentId`, `workflowRunId`, `delegationId`) is persisted.
- `SessionSummary` gains `agentId`, `parentSessionId`, `workflowRunId`, and `actor` (`{ kind, agent, vendor }`).
- List and search take those filters.
- `createSessionIndex(store, { ownership })` lists and searches a store without an `Agent`.
- Ownership is unchanged.
- `storeConformance` gains the matching legs.

**K5. Vendor-state entries.**

- The `external_state` entry kind: `{ vendor, key, seq, data }`.
- Drivers use `run.state(key).append(entries)` / `load()`, for example to archive Claude transcripts and Codex `thread/read` output.
- Entries are bounded (`external_state_limit`), redacted through the message path, excluded from `messages()`, copied on fork, and deleted with the session.

**K6. Terminal handoff.**

- `HostUi` gains `{ kind: "terminal"; title: string; command: readonly string[]; env?: Readonly<Record<string, string>>; cwd?: string }`. The host runs the command interactively for the person, in a terminal pane, a PTY, or an instruction to run it.
- The response is `answered` (with the exit code), `dismissed`, or `unavailable`.
- The kernel and the requesting package never see the terminal's input or output.
- It requires the `"host-ui"` capability. `env` values are non-secret paths such as `CLAUDE_CONFIG_DIR`.
- `createScriptedHostUi` in `/testing` supports it.

#### 2.12.10 Driver kit (`@arnilo/prism/driver-kit`, Phase 13)

A zero-dependency kernel subpath, following the `provider-kit` precedent.

- **`defineDriver({ name, vendor, revision, descriptor, config, start })` and `driverPackage(...)`.** A driver package claims `slot:loop`, declares a config schema that extends `ExternalAgentSpec`, and probes the binary at `setup`.
  - A missing binary is a status note; a run on it fails with `driver_unavailable`.
  - The binary version joins the loop `revision`. A major-version mismatch on resume fails with `driver_revision_mismatch`.
- **Capability descriptor:**

  ```ts
  interface DriverDescriptor {
    readonly vendor: string;
    readonly usesModel: false;
    readonly models: "passthrough" | "none";
    readonly controls: {
      readonly systemPrompt: readonly ("replace" | "append")[];
      readonly builtinTools: "per-tool" | "partial" | "none";
      readonly clientTools: "mcp" | "native" | "experimental" | "none";
      readonly skills: boolean;
      readonly subagents: boolean;
      readonly permissionCallback: boolean;
      readonly rewrite: boolean;
      readonly continueOnStop: boolean;
      readonly steer: "mid-turn" | "next-turn" | "none";
      readonly resume: "store" | "vendor" | "none";
      readonly isolation: "flags" | "workspace-files" | "none";
    };
    readonly capture: {
      readonly textDeltas: boolean;
      readonly thinking: "deltas" | "final" | "summary" | "tokens-only" | "none";
      readonly skillActivation: "native" | "tool" | "explicit-or-path" | "none";
      readonly toolCalls: boolean;
      readonly fileDiffs: boolean;
      readonly subagents: "full" | "summary" | "none";
      readonly usage: "tokens+cost" | "tokens" | "none";
    };
    readonly auth: {
      readonly subscription: "permitted" | "local-only" | "not-permitted";
      readonly apiKey: boolean;
    };
  }
  ```

- **Host requirements.** `requires: { systemPrompt?, builtinTools?, gated?: ToolEffect[], steer?, resume?, thinking?, skillActivation?, subagents?, subscription? }` is checked against the descriptor. A miss fails `createAgent` with `driver_capability_missing`, naming the control.
- **Profiles.** `profiles.create`, `ensure` (create if missing, check status, and sign in through K6 if needed), `login` (K6), `status`, `bind(principal)`, `remove`. The profile record is described in §2.12.7. The terms guard enforces §2.12.5 rules 1–6:
  - `credential_required`
  - `plan_login_not_permitted`
  - `profile_principal_mismatch`
  - `auth_required`
  - `profile_busy` (over `maxConcurrentRuns`)
- **Configuration materializer.** It writes the per-run directory and the worktree overlays (§2.12.7), writes the `.git/info/exclude` entries, and cleans up on dispose. `materializeSkills` supports the `claude-plugin`, `codex-root`, and `agy-workspace` layouts and returns the path-to-skill map.
- **Callback broker.** Per-run loopback HTTP and Unix socket, with a per-run token. It routes:
  - MCP (to `serveTools`)
  - the permission-prompt tool (to `run.ask`)
  - hook events (to `run.ask`, `run.end`, `observe`)

  It closes on run end.
- **`prism relay` bin** (in the kernel `prism` CLI, no dependencies):
  - `prism relay hook --socket <path> --vendor <v>` forwards one hook's stdin and prints the answer. If the broker is unreachable or too slow, gating events fail closed: exit 2 for Claude, `deny` for `agy`.
  - `prism relay mcp --socket <path>` bridges stdio MCP to the broker for vendors that only take stdio servers.
- **Tool bridge.** `bridgeTools(run, names, { origin })` resolves the allow-list and fails on unknown names. `invoke` calls `run.executeTools`.
- **Normalization helpers.** Per-vendor tool-name → `effects` tables (unknown tools get every effect), plus diff, usage, plan, and sub-agent scope mapping.
- **Process and protocol helpers:**
  - bounded JSONL and JSON-RPC 2.0
  - stdin message writers with backpressure
  - a SIGINT → SIGTERM → SIGKILL ladder with grace timeouts
  - redacted stderr
  - a child environment built only from non-secret paths and resolved API-key refs
- **Conformance.** `/testing` gains `createScriptedCli`, a fake binary per vendor dialect: Claude `stream-json`, Codex app-server JSON-RPC, and `agy` `stream-json`. It replays recorded event shapes and calls hooks through the relay. `driverConformance` covers:
  - flag and file materialization
  - gating through the relay, including fail-closed when the broker is down
  - `observe` mapping for every activity kind
  - `ask`, `steer`, abort, resume
  - profile binding, concurrency, and deployment rules
  - strict isolation
  - no secret in events or `inspect()`
  - no read of vendor credential files: a canary token file in the fake profile must never be opened

#### 2.12.11 Drivers (Phase 15)

| | `driver-claude-code` | `driver-codex` | `driver-antigravity` |
| --- | --- | --- | --- |
| Binary and surface | `claude -p`, `stream-json` in and out | `codex app-server`, JSON-RPC over stdio | `agy`, `stream-json` in and out |
| `systemPrompt` | replace, append | replace, append | replace (to verify), append through a rule |
| `builtinTools` | `per-tool` | `partial` | `per-tool` (frontmatter `tools` plus permission rules) |
| `clientTools` | `mcp` | `experimental` (`dynamicTools`), otherwise `mcp` | `mcp` |
| `skills` / skill activation | yes / `tool` | yes / `explicit-or-path` | yes / `tool` (`IsSkillFile`) |
| `subagents` | yes | no | yes |
| Gating / `rewrite` | relay `PreToolUse` and the permission-prompt tool / yes | approval requests / no | relay `PreToolUse` / no |
| `continueOnStop` | yes | yes (new turn) | yes |
| `steer` | `mid-turn` (stdin queue; verify that mid-turn delivery is not deferred to the next turn) | `mid-turn` (`turn/steer`) | `next-turn` |
| `resume` | `store` (archived transcript) | `vendor` | `vendor` |
| thinking capture | deltas | summary deltas, raw where the model allows | `tokens-only` |
| sub-agent capture | `full` | summary (`collabToolCall`) | `summary` |
| usage | tokens + cost estimate | tokens + rate limits | tokens |
| `isolation` | `flags` (profile `CLAUDE_CONFIG_DIR`, `--setting-sources`, `--strict-mcp-config`, `--tools`) | `flags` (profile `CODEX_HOME`, config overrides) | `workspace-files` (worktree `.agents/` overlay; home relocation to verify) |
| Subscription | `permitted` (§2.12.5, with conditions) | `local-only` (hosted needs Sign in with ChatGPT) | `local-only` (hosted needs Google's confirmation; a Gemini API key works anywhere) |

Driver-specific requirements:

- **`driver-claude-code`:**
  - Never uses `--bare`, which drops the subscription, or `--dangerously-skip-permissions`.
  - Uses `--verbose --include-partial-messages --forward-subagent-text --include-hook-events --permission-prompts host`.
  - Maps every stream message type.
  - Treats `api_retry` with `rate_limit`, `billing_error`, `authentication_failed`, or `oauth_org_not_allowed` as notices that stop or defer the run (§2.12.5 rule 4) instead of retrying.
  - Archives the transcript into K5 after every `result`.
- **`driver-codex`:**
  - Spawns `codex app-server` with the profile's `CODEX_HOME`.
  - Answers every server-to-client request; an unknown one fails the run.
  - Gets profile status from `account/read`.
  - Login goes through `codex login` in a K6 terminal, or `account/login/start`, showing only the vendor URL.
  - Credential modes are `chatgpt` (local deployments), `chatgptAuthTokens` (hosts enrolled in Sign in with ChatGPT), and `apiKey`.
  - `codex exec --json` is rejected: no approvals, steering, or instructions.
- **`driver-antigravity`:**
  - Writes the agent, rules, hooks, skills, and MCP overlays into the worktree.
  - Runs `agy --input-format stream-json --output-format stream-json --agent <generated>`.
  - Gating goes through `prism relay hook`.
  - Credentials: the user's own Google sign-in, done once in an interactive `agy` session through a K6 `terminal` request and then reused from the keyring by headless runs, or a Gemini API key (`modelProvider: "gemini"` in a profile-scoped settings file, plus a `GEMINI_API_KEY` ref).
  - Status: a run that is not signed in exits with `authentication required`. The driver maps this to `auth_required` and names the login step.
  - Profiles: `agy` keeps its sign-in in the OS keyring, not in a relocatable home. Until the phase review confirms whether a relocated home keeps the sign-in, an account profile is the user's own `agy` sign-in, bound to the OS user and the principal, and isolation comes from the worktree overlay.
  - Account mode (the user's own `agy` sign-in) is accepted for `deployment: "local"` under §2.12.5 rule 6, and refused for hosted deployments without a recorded confirmation from Google.
- **Every driver:**
  - publishes TypeScript source
  - spawns the user-installed binary found on `PATH` or at a configured path, after a version probe
  - passes `driverConformance` and package conformance
  - has a live smoke test behind a signed-in test profile (subscription) and an API-key profile, run as protected live legs; missing sign-in or keys block the release
  - has a README with the control and capture matrix, the terms with dated links, pacing guidance, and security posture

#### 2.12.12 Tool and approval bridge (Phase 14)

`@arnilo/prism-mcp-server` gains:

```ts
serveTools(run: RunController, options: {
  readonly tools: readonly string[];                      // allow-list of the running agent's tool names; unknown names fail closed
  readonly permissionTool?: string;                       // also expose a permission-prompt tool (Claude --permission-prompt-tool) backed by run.ask
  readonly transport: "loopback-http" | "stdio-relay";
  readonly resources?: readonly McpResourceInput[];       // e.g. the plan or task spec
  readonly origin: EventOrigin;
  readonly limits?: { readonly maxConcurrentCalls?: number; readonly resultBytes?: number };
}): Promise<{ readonly mcpConfig: JsonValue; close(): Promise<void> }>; // mcpConfig is the vendor-ready server entry
```

- **Every `tools/call` goes through `bridgeTools(...).invoke`**, so through `run.executeTools`. The permission tool goes through `run.ask`. An `ask` without a UI is a deny.
- **Transports.**
  - `loopback-http` binds `127.0.0.1` on an ephemeral port with a per-run bearer token, passed to the vendor as an environment variable and referenced from the generated MCP config. It reuses `createPrismMcpWebHandler`'s Host/Origin gates and bounded bodies.
  - `stdio-relay` uses `prism relay mcp`.
  - Tokens never appear in events, `inspect()`, or errors.
- **Lifetime.** The server closes on run end, abort, or suspension, and late calls are rejected.

#### 2.12.13 Graph workflows across agents (Phase 16)

`@arnilo/prism-workflows` is re-scoped from a `loop` slot package to **a library that orchestrates any `Agent`s from outside their sessions**, with a loop adapter as a secondary face.

- **Port the 0.12 engine** (`packages/prism-core/src/runtime/workflows/`): definitions, revision hash, limits, Kahn and superstep scheduling, node kinds, checkpoints, suspend/resume, replay, graph export, run overlay. The phase review decides whether sagas, schedules, and the coordinator move (with a test consumer) or are deleted.
- **Node kinds:**
  - `agentNode({ agent, session?, input, runOptions?, worktree?, output? })` runs any `Agent`, including vendor-driver agents. It opens the child session with `parent` links (K4). With `worktree: true`, it creates a worktree through the `workspace` service, sets `prism.workspace.root`, and records the worktree diff as `agent.file` (`source: "diff"`).
  - `gateNode({ check })` is deterministic, routes on failure, is bounded by `maxSupersteps` and `maxIterations`, and never calls a model.
  - `humanGate({ request })` uses `host.ui`; without a UI the workflow suspends durably.
  - `fanOut({ items, route, maxConcurrency })` chooses the agent per item. Its concurrency also respects each subscription profile's `maxConcurrentRuns`: an item waits instead of failing with `profile_busy`.
- **The workflow run is a parent session.** Node transitions are persisted and emitted as `workflow.node.started`, `workflow.node.completed`, `workflow.node.failed`, `workflow.gate`, and `workflow.suspended`.
- **One stream for the UI.** `workflowRun.stream()` merges every child session's events, each with `origin`. `steer(nodeId)` and `abort()` reach the children.
- **Durability.** After a process kill, finished nodes are not re-run, suspended children resume, and unfinished nodes re-run under their idempotency policy.
- **Checkpoints and leases (G6)** become service contracts in `prism-workflows`. `store-sqlite` and `store-postgres` implement them, and the kernel copies are deleted.
- **`workflowCommand(name, def | () => def)`** registers `/build`. **`workflowLoop(def)`** remains for single-agent workflows, including generate-validate-revise.

#### 2.12.14 Coding workspace service (Phase 14)

`@arnilo/prism-tools-coding` provides the `workspace` service, ported from `createCodingWorkspaceLifecycle`:

- `worktree.create` returns `{ path, branch, dispose }`.
- `diff` returns a bounded `FileChange[]`.
- `merge` reports conflicts and never resolves them.
- `excludeOverlay(path, files)` writes `.git/info/exclude` entries for driver overlays.

Worktree paths join the coding roots for the delegated session only.

#### 2.12.15 Observability

- Spans carry `origin` attributes: `agent`, `vendor`, `profile`, `executedBy`, `delegationId`, `subagentId`.
- Workflow spans parent their child sessions' spans.
- The execution-timeline projector moves from the 0.12 runtime and groups steps by `origin`.

#### 2.12.16 Security, terms, and limits

- **Terms are enforced in code** (§2.12.5): unmodified binaries, no subscription credentials in Prism, one end user per profile, individual-usage pacing, deployment rules (Codex and Antigravity sign-in local only). The terms can change. Each driver pins the dated sources it was verified against, and a terms change is a release blocker for that driver.
- **Control is uneven, and the descriptor says so.** Claude and Antigravity gate every built-in tool through the relay. Codex gates through approvals and its sandbox, and cannot remove its core tools. `requires` turns a missing control into a `createAgent` failure.
- **Gating fails closed.** Gating hooks run through `prism relay hook`, which blocks when Prism is unreachable. HTTP hooks are never used to gate, because vendors treat their failures as non-blocking.
- **Observed is not executed.** Vendor built-in tool events are reports, marked `executedBy: "external"` and backed by the worktree diff.
- **Thinking** is stored as `thinking` content where the vendor provides it, and treated as data. `agy` provides only token counts.
- **Vendor output is untrusted data.** Gates are deterministic code, and prompts built from vendor output frame it as data.
- **Vendor agents run with their own privileges.** Prism uses each vendor's sandbox where one exists, plus worktrees.
- **Isolation.** Strict by default. Repository-level agent instructions may still load, as the descriptor states.
- **Vendor churn.** Drivers pin and probe binary versions, and record fixtures from real event streams for `createScriptedCli`.
- **Limits.** Wall time and abort are always enforced. Tool-call limits count observed calls. Budget flags are cost estimates on subscriptions. Rate-limit and quota signals stop or defer instead of retrying.
- **Concurrency.** Parallel delegations use separate worktrees and respect profile caps. Merge conflicts are host policy.

#### 2.12.17 Considered and deferred

- **SDK runtimes** (Claude Agent SDK, Antigravity SDK, and the Codex app-server through an SDK). Rejected for 0.13.0 because subscriptions cannot be used on that route for products (§2.12.2). Useful only for API-key deployments; the binary drivers already cover API keys.
- **The Agent SDK's stdio control protocol spoken directly to `claude`.** Rejected: it is undocumented, and it is the Agent SDK surface whose product use requires API keys.
- **Generic ACP client driver and other CLI agents.** Deferred. The driver kit does not preclude them.
- **Hosted agent services** (Anthropic Managed Agents, OpenAI hosted agents). Deferred.

---

## Part 3 — Versions and in-flight work

### Version targets

| Package | Target | When |
| --- | --- | --- |
| `@arnilo/prism` | **0.13.0**, the kernel | Phase 11, once. No publish per phase. `next` pre-release tags are optional for lab testing. |
| Native packages and host libraries | **0.13.0** each, `requires.prism: "^0.13"` | Alongside the kernel in Phase 11, in lockstep. After that, each is versioned independently. On a 0.x kernel a caret range pins the minor (`^0.13` is `>=0.13.0 <0.14.0`), so a kernel 0.14 needs each package to widen its range. |
| External-agent orchestration: the kernel additions and `driver-kit` (Phase 13), `serveTools` and the `workspace` service (Phase 14), `prism-driver-{claude-code, codex, antigravity}` (Phase 15), re-scoped `prism-workflows` (Phase 16) | Same as the kernel and native packages | In the same Phase 11 publish. Phase 11 does not start until Phases 13–16 are done. |
| `@arnilo/prism-agent-sdk` | Deprecated on npm, pointing to `@arnilo/prism` | Phase 11 |
| 0.12 family packages | Deprecated on npm, pointing to their replacements | Phase 11 |
| `@arnilo/prism-code` | **0.5.0**, lab on the kernel only | Phase 12 |

### In-flight work

- **Plan 141 (Phase 0 of the old roadmap)** is superseded. `PRODUCT.md` has been rewritten, so its `docs.test.ts` freeze pins are replaced in the new Phase 0.
- **Plan 142 (Phase 1 of the old roadmap).** Tasks 1–5 are in the tree, unreleased. Finish Task 6 only to restore a green `bun run typecheck` across in-repo callers. Drop Tasks 7–8: they document and exemplify the `defineAgent` surface this roadmap replaces. What carries forward:
  - `agent.session()`, `run`, `stream`, `dispose` become the kernel `Agent`/`Session`.
  - The type re-exports and the mock provider become `@arnilo/prism` and `/testing`.
  - SDK-internal progressive `load_skill` becomes kernel skills.
  - `store: "memory"` becomes the store slot default.
  - `stopHooks` becomes `run.end`.
  - Required `identity` with the `"local-operator"` profile becomes an opaque, optional `principal`. Enforcement moves to the packages that need a verified identity (`tools-coding` durable effects, `governance`).
- **Plans 151–153 (Phases 5–6) are planned, not started.** Phase 13 changes contracts they touch:
  - `AgentConfig.model` becomes optional (K1), in the model layer that plan 151 reshapes.
  - Session links, list/search filters, and `createSessionIndex` (K4) extend the store contract and conformance that plan 153 writes.

  Those plans should leave room for these changes: no new code path that assumes a model is always present, and a store schema that can gain the session-link columns. Phase 13 still owns the changes themselves.
- **Plan 073 R09** ("delegated coding runtimes", removed from 0.7.0) is superseded by Phases 13–16.
- **Old roadmap Phases 2–10** (provider shorthand ids, `tools.use`, `memory.*`, `web.backend`, `agent.serve` / `agent.connect`) are withdrawn. Their capabilities reappear as the native packages and host libraries above.

---

## Part 4 — Phases

Each phase lists its goal, why it exists, its scope, and its done criteria. Execution plans are cut per phase.

### Phase 0 — Reset the offer

**Goal.** Make the repository's stated direction match this architecture before any code changes, so every later plan is cut against one contract.

**Why.** `PRODUCT.md`, the old roadmap, plan 141's test pins, and plan 142's pending tasks all describe the facade design. Implementing against them would build the wrong thing.

**Scope.**

- `roadmap.md` and `PRODUCT.md` rewritten (this change).
- Replace the three "phase 0" pins in `src/__tests__/docs.test.ts`:
  - pin `PRODUCT.md` to its not-shipped banner, the host example, the package example, and the principles
  - pin that `README.md` still links `PRODUCT.md` and `roadmap.md` and presents no unshipped API as available
  - pin that `/docs` pages do not describe the target
- Close plan 142 at Task 6 (green typecheck) and record Tasks 7–8 as dropped.
- Mark plan 141 superseded in `plans/README.md`.
- Move the obsolete backlog entries.
- No `/docs` API page changes.

**Done.**

- `bun test src/__tests__/docs.test.ts` and `bun run typecheck` pass.
- A reader of `PRODUCT.md` understands what Prism is and how packages work without opening any other file.

### Phase 1 — Hook bus, slots, and loop primitives

**Goal.** One interception model inside the runtime, and a loop that can be replaced without bypassing it. This is the foundation every package relies on.

**Why.** The eight fragmented mechanisms (§1.2) cannot be the public extension contract. Packages need one typed, ordered, fail-closed hook model. And a replaceable loop is unsafe unless the gates live in the primitives, not the loop.

**Scope.**

- **Hook bus:**
  - the four kinds (§2.4) and the full hook catalog with typed payloads and results
  - combination rules, priority and load ordering, registration ids
  - error policy per kind, and synchronous observers for `message.delta`
- **Slot registry:** `loop`, `compaction`, `store`, `credentials`, with kernel defaults, `provide` / `default`, and conflict detection.
- **`RunController`:**
  - `turn`, `executeTools`, `append`, `end`, `emit`, each firing its hooks in the documented order
  - `executeTools` implements `ask`: inline `host.ui` when present, otherwise suspension
- **The default loop** is rewritten on `RunController`. `generate-validate-revise` becomes a loop strategy the kernel no longer ships; it moves to `workflows` in Phase 9.
- **Every 0.12.1 mechanism is re-expressed as a hook or slot**, following the "Replaces" column in §2.4. The old config fields and registries are removed, not aliased: `middleware`, `guardrails`, `stopHooks`, `turnPolicy`, `providerRequestPolicies`, `instructionInjectors`, `context`, `toolNarrowing`, `inputBuilder`, `promptBuilder`, `permission`, and `loop` options.
- `ToolDefinition.effects` annotation.
- **Invariant tests:**
  - a custom loop cannot run a tool without `tool.call` firing
  - deny wins over allow and ask
  - the first `run.end` continue wins and is capped
  - an observer throw never fails a run
  - a transform or decide throw fails closed and names the package and hook
  - a suspended run survives a process restart through the store slot
  - `context.build` mutations never reach the store

**Done.**

- Every catalog hook has a test that fires it from the default loop and from a custom loop.
- The hook catalog and slot contracts are frozen for Phase 2.

### Phase 2 — Package system

**Goal.** A listed package is an active package. Packages get the whole `PackageAPI`, so a capability like observational memory can live entirely in a package.

**Why.** This is the core requirement: behavior changes by installing packages, not by host wiring. It also retires `ExtensionKernel` / `activateKernel`, whose contributions stay inert.

**Scope.**

- `definePackage`, the callable `PackageDefinition` / `PackageInstance`, and the `PackageAPI` (§2.6).
- **Config:**
  - JSON Schema validation with defaults (the kernel's own validator, no dependency)
  - merge order: defaults, then manifest, then `packageConfig`
  - secret-field refs only
- **Load checks:**
  - `requires`: kernel semver, packages, services
  - topological ordering
  - capability declaration and enforcement on SDK-mediated APIs
- **Runtime services for packages:**
  - service registry
  - commands registry and dispatch
  - namespaced `package.event`
  - `status.note`
- **Session state and background work:**
  - session state persisted as package-state entries, restored on resume, copied on fork
  - background tasks settled by `session.close` with a bounded timeout, then aborted
- **Lifecycle:** reverse-order dispose. `setup` failure fails closed; `optional` entries are skipped with a status note.
- **Agent config:** `createAgent({ packages, packageConfig, hooks, slots, disable })`. Host hooks are an inline package loaded last. `disable` removes contributions by id before the agent is built.
- **`agent.inspect()`:** packages, versions, config sources (with secret values never shown), tools, skills, hooks in execution order, slot owners, and status notes.
- **Remove** `Extension`, `ExtensionAPI`, `ExtensionKernel`, `activateKernel`, `forwardAgentEvents`, `ContributionRegistries`, `PrismManifest` (the old contribution manifest), `ProviderPackage`, and discovered-contribution descriptors.
- **Package conformance suite** in `@arnilo/prism/testing`: setup/dispose idempotence, no contribution leaks after dispose, valid config schema, declared capabilities cover the APIs used, no secret in `inspect()`.
- **First native package:** `@arnilo/prism-hooks-json`, a pure hook mapping from the 0.12 `hooks` package.

**Done.**

- `hooks-json` passes conformance.
- A test package that owns the loop slot runs end to end.
- A test package using session state survives fork and resume.
- Two packages claiming one slot fail closed until assigned.

### Phase 3 — Agent, session, and host port

**Goal.** The final host-facing surface of `@arnilo/prism`, including the single channel through which packages reach a person.

**Why.** Hosts need a stable `Agent`/`Session`/event contract to build on. Packages need one way to ask for approval, input, secrets, and OAuth, instead of each host inventing callbacks.

**Scope.**

- `createAgent`, `Agent`, `Session`, `RunOptions`, `RunResult` as sketched in §2.3.
- `HostPort` / `HostUi` with the request kinds above. `unavailable` semantics, and packages must fail closed on it.
- Suspension and `session.resume(decisions)` for `ask` decisions without a UI.
- The `AgentEvent` catalog is frozen, and observe hook names equal event types.
- `agent.sessions` over store-slot capabilities; `agent.commands`; `agent.models`.
- The limits floor, and runs only narrow it.
- `principal` is opaque and optional.
- **Type exports:** a host and a package author import everything from `@arnilo/prism`.
- `@arnilo/prism-agent-sdk` stops receiving features. Its remaining tests move to kernel or package suites.
- **Examples:**
  - `examples/session.ts`: one import, mock provider, streamed run
  - `examples/approval.ts`: a tool gated by `ask`, resolved inline with a UI, and suspended and resumed without one
  - `examples/host-hooks.ts`

**Done.**

- The examples run under the execution gate using only `@arnilo/prism` and `@arnilo/prism/testing`.
- No kernel path synthesizes an identity.

### Phase 4 — Manifest and installer

**Goal.** Prism maintains the record of which packages load, and hosts can install, configure, enable, and disable packages without code changes.

**Why.** Your requirement is that the runtime owns the manifest. It is also what lets the reference host become configuration-driven instead of assembling packages by hand.

**Scope.**

- **Manifest format** v1 (§2.7) with a published JSON Schema; user and project scopes; merge rules; slot assignments; `optional` and `enabled` entries.
- **Install:** `bun add` into the Prism-managed package directories; integrity recorded and verified before import.
- **Project trust:** gated by the host callback, with project scope skipped when there is none.
- **Config validation** against each package's schema at `configure` time (install-time validation needs no `setup` run). Secret-ref enforcement.
- **API and CLI:** the `@arnilo/prism/manifest` API and the `prism` CLI (`add`, `remove`, `list`, `enable`, `disable`, `config`, `slot`, `verify`).
- The old `prism init` and `prism providers add` are replaced. Their scaffolding survives as `prism new package <name>`, which creates a package skeleton with conformance tests.

**Done.**

- An example installs a local fixture package, loads it through `loadManifest`, disables it, and reloads without it.
- A tampered integrity hash and an untrusted project manifest both fail closed.
- A literal secret in config is rejected.

### Phase 5 — Models, providers, and credentials

**Goal.** The kernel talks to models itself. Every vendor is a provider package. Packages can call side models through the same registry.

**Why.** You asked for built-in model communication in the SDK, extended by provider packages. Memory (observer and reflector), routing, and delegation all need `models.client` for side calls.

**Scope.**

- **Kernel model layer:**
  - `ModelProvider` contract (id, `generate` streaming, optional `models()` discovery, auth method descriptors)
  - registry and `ModelRef` parsing (`"vendor/model"` or an object)
  - per-run model switch through one per-agent provider cache, so a fixed provider never shadows a run's model
  - retry and backoff
  - usage and stop-reason normalization
  - the built-in `openai-compatible` provider
- **Subpaths:** `@arnilo/prism/provider-kit` (SSE, HTTP transport, OpenAI-compatible wire mapping, provider conformance) and the mock provider in `/testing`.
- **Credentials slot:** `env:` default resolver; OAuth token persistence through the slot.
- **Provider packages:** port each vendor to `@arnilo/prism-provider-<vendor>`. OAuth flows use `host.ui` (`open-url`, `input`) and never open a browser themselves.
- **`@arnilo/prism-credentials-keyring`.**
- **Examples:**
  - an OpenAI-compatible endpoint with no packages
  - the Anthropic package with a per-run model switch
  - a package making a side call via `models.client`

**Done.**

- A host with no provider package can reach any OpenAI-compatible endpoint.
- Loading one provider package never evaluates another.
- Each provider package passes provider conformance.
- `agent.models.list()` returns an empty list, not a throw, when no package offers discovery.

### Phase 6 — Session stores

**Goal.** Durable sessions are store packages filling the `store` slot, including package state and suspended runs.

**Why.** Persistence is not part of the minimal loop. Heavy drivers (`pg`) must load only when their package is listed.

**Scope.**

- `@arnilo/prism-store-jsonl`, `-sqlite`, `-postgres`, and the shared `@arnilo/prism-store-codecs` library.
- A store conformance suite covering append, branch/fork, package-state entries, suspended-run records, search, title, and delete.
- `agent.sessions` features light up according to store capabilities.
- The kernel keeps only the contract and the in-memory store.

**Done.**

- A SQLite example resumes a session, including observational memory state, after a process restart.
- A suspended approval is resumed in a new process.
- An agent without `store-postgres` never loads `pg`.

### Phase 7 — Tool and context packages

**Goal.** Coding, web, browser, work, computer-use, and OpenAPI tools, plus approval policy and instruction files, as native packages.

**Why.** These are the most-used capabilities and the clearest proof that the kernel's tools, hooks, and host-port surface is enough.

**Scope.**

- **`tools-coding`:**
  - fs, edit, grep, shell, sandbox and execution policy
  - git and checks
  - todo plus its continuation `run.end` hook
  - `ask_user` via `host.ui`
  - root-escape hard denies via `tool.call`
  - durable-effect identity enforcement against `principal`
- **`approval`:** modes over `effects` and roots, via `host.ui` confirm or suspension.
- **`tools-web`:**
  - backends selected by config
  - a missing key or binary gives a status note and no tools, not a failure
  - provides `web.fetch`
- **`tools-browser`, `tools-work`, `tools-computer-use`, `tools-openapi`.**
- **`context-files`:** AGENTS.md / SYSTEM.md layers with a trust policy; no home-directory scan unless configured.
- Coding modules leave the kernel and `prism-coding-tools`.

**Done.**

- A coding example edits a file under `approval` in `ask` mode.
- `disable.tools: ["shell"]` removes the shell.
- Installing `tools-coding` loads neither Playwright nor the Office parsers.
- `tools-web` with no key yields a note and a working agent.

### Phase 8 — Memory and context-engineering packages

**Goal.** Memory systems are packages that change the agent's behavior when installed and configured. Observational memory is the flagship proof.

**Why.** This is the case the 0.12 architecture could not express without host coordinators (§1.2).

**Scope.**

- **`memory-observational`:**
  - separate observer and reflector models
  - per-session toggle in session state
  - `/om` and `/om:model` commands
  - `recall` tool visible only when on
  - observation injection in `context.build`
  - background observation after turns
  - observation- and reflection-based compaction in the `compaction` slot
  - status events
- **`memory-compaction`:** LLM summary compaction in the slot.
- **`memory-rag`** (owns embeddings), **`memory-wiki`** (consumes `web.fetch`), **`memory-fabric`** (working, semantic, scoped).
- **`context-engineering`:** context budget, tool-result fold, tool search, attention compiler. Their modules leave the kernel.
- State the cost in each README: extra model calls, off by default.

**Done.**

- On mock providers, an OM example shows the observer running on its own model, compaction using observations, a session toggled by command, and state surviving resume.
- The host code in the example contains no OM logic.
- OM plus `memory-compaction` fails closed until a slot owner is assigned.

### Phase 9 — Integrations, policy, and governance packages

**Goal.** MCP, `hooks.json` (done in Phase 2), governance, guardrail packs, routing, observability, and delegation as packages. Workflows moved to Phase 16, where they are re-scoped to orchestrate several agents (§2.12.10).

**Why.** These exercise the remaining hook kinds: `model.call` around for routing and observe for telemetry. They also move identity verification out of the kernel.

**Scope.**

- **`mcp`:**
  - stdio, URL, or raw transports
  - `allow` fail-closed
  - connect failure is status, not a failed `createAgent`
  - project server trust via `host.ui`
  - header values as credential refs
  - status, reconnect, and close as commands and events
- **`governance`:** policy engine and OPA, identity verification, principal enforcement, audit sink.
- **`guardrail-packs`.**
- **`model-router`.**
- **`observability`** (OTel; no phone-home). Phase 16 adds `origin` attributes and the timeline projector.
- **`delegate`**, where sub-agents inherit a chosen package subset. It moves from `child` to `origin` when Phase 13 lands, whichever phase finishes first.
- Governance and identity modules leave the kernel.

**Done.**

- An untrusted MCP server never spawns, and a header ref is never echoed.
- A deny-by-default governance example blocks a tool.

### Phase 10 — Surfaces and host libraries

**Goal.** ACP, AG-UI, MCP-server, channels, evals, and devtools are libraries over the public `Agent`.

**Why.** Surfaces should reuse the kernel's host port and events, not keep private agent assembly graphs.

**Scope.**

- `@arnilo/prism-acp` (`serveAcp`; `HostUi` mapped to ACP permission and elicitation), `-ag-ui`, `-mcp-server`, `-channels` (Telegram, Signal), `-evals`, `-devtools`.
- `packages/acp-agent` becomes a thin binary over `serveAcp` and a manifest.
- No surface imports kernel internals.

**Done.**

- `examples/acp.ts` serves ACP in-process against the mock provider, with approval over ACP.
- A repo search finds no surface constructing its own agent outside `createAgent`.

### Phases 13–16 — Vendor coding agents and orchestration

These four phases deliver §2.12. They were added on 2026-10-04 and re-scoped the same day: first from CLI agents to SDK runtimes, then to vendor binaries driven under the user's own subscription (§2.12.2). They ship in 0.13.0: Phase 11 needs all of them. They are numbered after Phase 12 so that existing references to Phases 11 and 12 stay valid. They are listed here because they come before Phase 11 in execution order (see [Order](#order)).

Gap coverage:

| Gap / change (§2.12) | Phase |
| --- | --- |
| G1 no vendor-agent driver | 13 (driver kit), 15 (drivers) |
| G2 workflows scoped as a loop | 16 |
| G3 no gated tool execution for non-loop callers | 13 (re-entrant `executeTools`, `bridgeTools`), 14 (`serveTools`) |
| G4 no honest record of foreign activity; no steering for loops without `turn()` | 13 (`observe`, `ask`, `steers`, `origin`, narrowed `emit`) |
| G5 no model-less agents; no session links; no search across agents | 13 (K1, K4) |
| G6 no home for checkpoints and leases | 16 |
| G7 no portable agent definition; no materialization; no isolation | 13 (`ExternalAgentSpec`, configuration materializer, isolation), 15 (per-vendor mapping) |
| G8 vendor activity with no normalized form | 13 (`ExternalActivity`, `agent.*` events), 15 (full mapping per vendor) |
| G9 vendor session state | 13 (K5), 15 (Claude transcript archive, Codex thread archive) |
| G10 no sign-in path; no subscription profile model | 13 (K6 `terminal`, profiles, terms guard), 15 (per-vendor login and status) |
| G11 no fail-closed callback channel | 13 (callback broker, `prism relay`), 14 (`serveTools`, permission tool) |
| Worktree isolation, overlays, and the diff of record | 14 (`workspace` service), 16 (`agentNode` `worktree`) |
| Origin-aware telemetry and timeline | 16 |

### Phase 13 — Vendor-driver kernel primitives and driver kit

**Goal.** The kernel can host an agent whose loop is an unmodified vendor binary running under a person's own subscription, without Prism touching that person's credentials. Every event says who produced it and who executed it, nothing the vendor reports is dropped, gating fails closed, and sessions from several agents can be linked and searched in one store.

**Why.** Gaps G3–G5 and G7–G11 (§2.12.6) are kernel contracts. The subscription terms (§2.12.5) can only be honored if profiles, sign-in, and pacing are enforced below the drivers.

**Depends on.** Phase 3; Phase 5 (K1); Phase 6 (K4, K5).

**Scope.**

- **K1–K5** as specified in §2.12.9:
  - optional model, `run.model`
  - `observe` with every `ExternalActivity` kind
  - `ask`, including `rewrite`/`respond` support flags
  - `run.end` reachable from vendor `Stop` hooks
  - `steers()`, re-entrant `executeTools`, narrowed `emit`
  - `EventOrigin` with `vendor` and `profile`, replacing `child` repo-wide
  - session links, filters, `createSessionIndex`
  - `external_state` entries
  - each item with its conformance legs and the invariant tests
- **K6, terminal handoff:**
  - the `terminal` `HostUi` request kind and its responses
  - `createScriptedHostUi` support
  - `docs/next/host.md` updated
  - the guarantee that the kernel and packages never see terminal input or output
- **`@arnilo/prism/driver-kit`** (§2.12.10):
  - `ExternalAgentSpec`, `defineDriver`, `driverPackage`
  - `DriverDescriptor` (controls, capture, auth) and the `requires` check
  - profiles (`create`, `ensure`, `login` through K6, `status`, `bind`, `remove`)
  - the terms guard (§2.12.5 rules 1–6) with its error codes
  - the configuration materializer and `materializeSkills`
  - the callback broker
  - `bridgeTools`
  - normalization, process, and protocol helpers
  - the standard `agent.*` events
- **`prism relay` bin** in the kernel CLI: `relay hook` (fail-closed per vendor dialect) and `relay mcp`.
- **`/testing`:** `createScriptedCli` (Claude `stream-json`, Codex app-server, and `agy` `stream-json` dialects, calling hooks through the relay) and `driverConformance`, covering the cases in §2.12.10, including the canary credential file that must never be opened.
- **Docs:**
  - `docs/next/drivers.md`: driver kit, spec, descriptor, profiles and sign-in, terms guard, callback broker and relay, `agent.*` events
  - updates to `docs/next/loop.md`, `events.md`, `agent.md`, and `host.md`
- **Example:** `examples/external-agent.ts` (offline). It:
  - creates a profile and signs in through a scripted `terminal` response
  - runs a spec with a replaced prompt, two bridged tools, and one skill against `createScriptedCli`
  - shows text and thinking deltas, a skill activation, and a nested sub-agent
  - gates a vendor write through the relay with a scripted `HostUi`, and shows the relay failing closed when the broker is stopped
  - steers and resumes
  - searches with `createSessionIndex`
  - shows `profile_principal_mismatch` and `profile_busy`

**Done.**

- `driverConformance` passes for all three scripted dialects.
- The invariant tests pass from the default loop and from a driver loop.
- `storeConformance` with the K4 and K5 legs passes on every store.
- No event carries `child`.
- No code path in the kernel or the driver kit opens a vendor credential file (the canary test).
- `bun run typecheck` is green.

### Phase 14 — Tool and approval bridge, and the coding workspace service

**Goal.** Vendor agents call the host's Prism tools and ask the host for permissions over MCP, with every call gated, persisted, and attributed. Delegated work runs in worktrees that also carry driver overlays, and the worktree diff is the record of what changed.

**Why.** Gap G3 and G11 for the MCP path, which Claude Code and `agy` require for Prism tools and which Claude's `--permission-prompt-tool` uses. Worktrees make parallel delegations safe to merge and give `agy` a place for its workspace configuration.

**Depends on.** Phase 13; Phase 7 (`tools-coding`, `approval`); Phase 10 (`@arnilo/prism-mcp-server`).

**Scope.**

- **`serveTools(run, options)`** (§2.12.12):
  - an allow-list that fails closed
  - the optional permission-prompt tool backed by `run.ask`
  - `loopback-http` with a per-run bearer token and `createPrismMcpWebHandler` gates
  - `stdio-relay` through `prism relay mcp`
  - MCP resources, name prefixing, bounds
  - closing on run end, abort, or suspension
  - `mcpConfig` output in each vendor's config shape
- **`workspace` service** in `tools-coding` (§2.12.14): `worktree.create`/`dispose`, bounded `diff`, `merge` with reported conflicts, and `excludeOverlay`.
- **Tests:**
  - a served tool under `approval` in `ask` mode prompts through a scripted `HostUi`, and a deny reaches the client
  - the permission tool maps allow, deny, and `updatedInput`
  - a wrong token, a wrong Origin, and a late call are rejected
  - tools outside the allow-list are invisible
  - no token appears in events
  - worktree create, diff, merge (with a conflict), exclude, and dispose round-trip
- **Docs:** the `prism-mcp-server` README "Serving tools and permissions to a vendor agent", and the `tools-coding` README "Workspace service".
- **Example:** `examples/serve-tools.ts`, with a scripted Claude-dialect CLI calling a served `edit` tool and the permission tool.

**Done.**

- Both transports gate, persist, and attribute calls.
- Unauthenticated and late callers are rejected.
- A fixture run produces a worktree diff with its overlay excluded, and a conflicting merge is reported, not resolved.

### Phase 15 — Vendor drivers: Claude Code, Codex, Antigravity CLI

**Goal.** A host defines a custom agent once and runs it on Claude Code, Codex, or the Antigravity CLI under the user's subscription where the vendor permits it, or under an API key otherwise. Prism captures everything the binary reports and refuses requirements or sign-in modes the binary or the vendor's terms do not allow.

**Why.** Gaps G1, G7–G10 per vendor. This is where the uneven controls (§2.12.11) and the terms (§2.12.5) have to be precise.

**Depends on.** Phases 13 and 14.

**Scope.**

- **Phase review first.** Re-verify §2.12.4, §2.12.5, and the §2.12.11 matrix against each vendor's current documentation and terms, using the `find-docs` skill and primary sources. Pin binary versions. Record every cell with a source link and date in the plan and in each descriptor and README. Run each "to verify" item:
  - Claude: excluding `CLAUDE.md` without `--bare`; delivery of stdin messages mid-turn
  - Codex: dynamic tools; which tools can be disabled
  - `agy`: replace semantics; skills and MCP config locations; home relocation and keyring behavior; interrupt
- **Terms gate.** If a vendor's terms changed, the driver's `auth` descriptor and terms guard are updated before its code ships. The Antigravity local-only reading (§2.12.5) is re-checked against the then-current terms and headless docs. If Google has published guidance on third-party orchestration, it decides the rule.
- **`@arnilo/prism-driver-claude-code`** (`packages/drivers/claude-code/`):
  - `claude -p` with `stream-json` in and out, plus the full flag set in §2.12.7 and §2.12.11
  - a profile `CLAUDE_CONFIG_DIR` with login through `claude auth login` (K6) and status through `claude auth status`
  - gating through the relay `PreToolUse` hook and `--permission-prompt-tool`
  - Prism tools through `serveTools`
  - skills as a generated plugin; sub-agents through `--agents`
  - every stream message mapped (deltas, thinking, `Skill`, nested sub-agents, compaction, retries, permission denials, usage and cost)
  - rate-limit, billing, and auth signals paced, not retried
  - the transcript archived to K5 and resume from it
  - SIGINT/SIGTERM abort
- **`@arnilo/prism-driver-codex`** (`packages/drivers/codex/`):
  - a TypeScript app-server client (`generate-ts` types for the pinned version)
  - a profile `CODEX_HOME`, with login through `codex login` (K6) or `account/login/start` (URL only), and status through `account/read`
  - the credential and deployment rules
  - `baseInstructions`/`developerInstructions`
  - Prism tools through `dynamicTools` or `serveTools`
  - skills through extra roots and `skill` inputs
  - `turn/steer`, `turn/interrupt`
  - approval requests mapped to `run.ask`, and user input and elicitation to `host.ui`
  - every item, delta, and notification mapped, with `turn/diff/updated` as the diff of record
  - the thread archived to K5
- **`@arnilo/prism-driver-antigravity`** (`packages/drivers/antigravity/`):
  - `agy` with `stream-json` in and out and a generated `--agent`
  - worktree overlays (agent, rules, hooks, skills, MCP config) excluded from git
  - gating through the relay `PreToolUse` hook; `Stop` mapped to `run.end`
  - every `step_update` mapped (text deltas, `tool_info`, `IsSkillFile` skill reads, `subagent_info`, checkpoints, usage including thinking tokens)
  - `--conversation` resume
  - credentials: the user's own `agy` sign-in (local deployments) or a Gemini API key; account mode on a hosted deployment without recorded confirmation fails with `plan_login_not_permitted`
- **Every driver:**
  - a config schema extending `ExternalAgentSpec`
  - a binary probe and version in `inspect()`
  - `driverConformance` with fixtures recorded from the real binary
  - package conformance and an effect table
  - live smoke legs: a signed-in subscription profile (Claude, Codex) and an API-key profile (all three), protected
  - a README with the matrix, terms, pacing, and security
- **Examples:**
  - `examples/driver-claude-code.ts` and `examples/driver-codex.ts`: live, on a signed-in subscription profile
  - `examples/driver-antigravity.ts`: live, on the user's own `agy` sign-in (Google AI Pro/Ultra), with an API-key variant

  Each defines a custom agent with a replaced prompt, a bridged Prism tool, and a skill; edits in a worktree under `approval`; and prints the captured activity.

**Done.**

- All three drivers pass `driverConformance` offline.
- Live legs pass on a Claude Pro/Max profile, a ChatGPT-plan Codex profile, a Google AI Pro/Ultra `agy` sign-in, and API-key profiles. Missing sign-in or keys block the release.
- Live Claude, Codex, and `agy` runs on subscription sign-ins capture text, thinking (token counts only for `agy`), a skill activation, a built-in tool call, a gated bridged tool call, and usage.
- The terms guard is proven:
  - Codex `chatgpt` sign-in with `deployment: "hosted"` fails
  - Antigravity account sign-in with `deployment: "hosted"` fails without a recorded confirmation
  - a profile used by a second principal fails
  - a run beyond `maxConcurrentRuns` waits or fails with `profile_busy`
  - no Prism process opens a vendor credential file (canary)
- Strict isolation is proven: a planted user hook, skill, or MCP server in the user's normal vendor home is not loaded.
- A gating hook fails closed when the broker is killed.
- Abort stops the binary within the grace timeout. A Claude conversation resumes in a new process from Prism's store.

### Phase 16 — Graph workflows across agents

**Goal.** A host defines `/build` as a graph of Prism and vendor agents with deterministic gates, runs it as one durable workflow within each subscription's pacing, and renders it from one event stream. Every session is searchable in one store.

**Why.** Gaps G2 and G6, and the end-to-end proof of §2.12.

**Depends on.** Phases 13, 14, and 15; Phase 9 (`observability`); Phase 6.

**Scope.**

- **`@arnilo/prism-workflows` re-scoped** (§2.12.13):
  - the 0.12 engine ported (the review decides on sagas, schedules, and the coordinator)
  - `agentNode` with `parent` links and `worktree`
  - `gateNode`, `humanGate`
  - `fanOut`, which respects each profile's `maxConcurrentRuns`
  - the parent session with `workflow.*` events
  - the merged `stream()`, `steer(nodeId)`, `abort()`
  - resume after a kill
  - `workflowCommand`, `workflowLoop`
- **Checkpoints and leases** as service contracts, with store implementations; the kernel copies are deleted.
- **Observability** (§2.12.15): origin span attributes and the timeline projector.
- **Docs:** the `prism-workflows` and `observability` READMEs.
- **Examples:**
  - `examples/build-workflow.ts`, offline: the §2.11 orchestration example with the host on the mock provider and the planner, UI engineer, and validator on `createScriptedCli` drivers. It runs research → plan → gate (failing once and routing back) → `humanGate` → `fanOut` (tasks 2, 5, and 6 to the UI engineer in worktrees, the rest to the host) → merge gate → validate → tests gate, all in one SQLite file.
  - `examples/build-workflow-live.ts`, on signed-in Claude and Codex subscription profiles.
  - `examples/workflow-loop.ts` (moved from Phase 9).

**Done.**

- `examples/build-workflow.ts` runs offline end to end.
- `createSessionIndex(store).search({ text, workflowRunId })` finds a vendor agent's message and the host's.
- The merged stream carries every agent's events, including vendor sub-agents and thinking, with the correct `origin`.
- `fanOut` never exceeds a profile's cap.
- Kill-and-resume finishes without re-running completed nodes.
- A failing gate routes back within `maxSupersteps`.
- `workflowLoop` gates tools under `approval`.
- The kernel no longer contains `checkpoints` or `leases`.

### Phase 11 — Kernel freeze and 0.13.0

**Goal.** Ship `@arnilo/prism` 0.13.0 as a minimal, dependency-free kernel with its native packages, and make the docs describe it.

**Why.** Earlier phases move modules out as their packages land. This phase sweeps what remains, freezes the public surface, and publishes once.

**Scope.**

- **Sweep** the remaining non-kernel modules (§2.9, "decides where it goes"): move each to a package or delete it. `checkpoints`, `leases`, and the execution timeline are already gone (Phase 16).
- **External-agent orchestration in the release:**
  - the export-surface review covers `driver-kit` and the §2.5/§2.12.9 `RunController` additions, the K6 `terminal` host request, and the `prism relay` bin
  - `release:gate` covers the three drivers, with their live legs as protected checks
  - the examples gallery includes `examples/build-workflow.ts`
- **Kernel constraints:**
  - zero runtime dependencies
  - an export-surface review against §2.3 and §2.6
  - a size budget recorded and enforced by a gate
  - the "kernel imports no package" gate
- **Docs:**
  - promote the `docs/next/` pages into `/docs`
  - retire or replace the 0.12 pages they supersede
  - link each package README as its page
  - write the `docs/index.md` entries
  - no new pages are written in this phase: every page already exists from the phase that shipped its API
- **README and PRODUCT:** `README.md` cuts over to the SDK; `PRODUCT.md` drops its not-shipped banner; the examples gallery leads with host and package examples.
- **Release:**
  - compat baseline regenerated
  - `release:gate` covers every package
  - changelog and migration note from 0.12 `createAgent` / `defineAgent`
  - `prism-agent-sdk` and the 0.12 family packages deprecated on npm
  - a grep over `scripts/`, `examples/`, and every workspace for retired names and error strings

**Done.**

- `@arnilo/prism` 0.13.0 and the native packages are published, including `driver-kit`, the three drivers, the re-scoped `prism-workflows`, and `serveTools`.
- A new reader builds an agent from `README.md` alone.
- `release:gate` is green.

### Phase 12 — Prism Code on the SDK

**Goal.** Prism Code is a reference host. It builds its agent through `createAgent` and the manifest, and owns only the TUI.

**Why.** It proves the architecture end to end. Every capability the lab had before must now come from a package, with the TUI rendering generically.

**Scope.**

- **Move** to `apps/prism-code/`.
- **Agent setup:**
  - `createAgent` with `loadManifest`
  - lab config maps onto the manifest and `packageConfig`
  - first run offers to install a default package set
- **The TUI implements** `HostUi` (approval prompt, `ask_user` picker, secret input, OAuth URL, project trust). It renders `AgentEvent`s including `package.event`, lists `agent.commands` generically, and renders `agent.inspect()` as `doctor`.
- **Delete** providers, credentials, OAuth, sessions policy, compaction selection, OM coordinator, web/wiki resolution, MCP trust logic, approval engine, ACP assembly, tool-module loading, and the headless assembler. A print/json mode may remain as a thin `session.stream` sink.
- **Version** `@arnilo/prism-code` 0.5.0: "reference TUI host for `@arnilo/prism`; not an embedding API."

**Done.**

- `apps/prism-code/src` imports only `@arnilo/prism` (and `@arnilo/prism/manifest`).
- A coding session edits a file under approval.
- `/om` toggles observational memory from the package.
- Disabling a package in the manifest removes its tools and commands on the next launch.

### Order

0 → 1 → 2 → 3, which are strictly sequential: each freezes the contract the next builds on.

After Phase 3, Phases 4 (manifest), 5 (models), and 6 (stores) can run in parallel.

After Phases 5 and 6, Phases 7 (tools), 8 (memory), and 9 (integrations) can run in parallel. Phase 8 depends on Phase 5's `models.client` and Phase 6's persisted package state.

Phase 10 follows Phase 3 and needs Phase 7's `approval` for its approval examples.

External-agent orchestration (§2.12):

- Phase 13 follows Phases 5 and 6. It can run in parallel with Phases 7–10.
- Phase 14 needs Phases 13, 7, and 10.
- Phase 15 needs Phases 13 and 14.
- Phase 16 needs Phases 13, 14, 15, and 9.

The execution order is 13 → 14 → 15 → 16.

Phase 11 needs Phases 0–10 and 13–16. Phase 12 needs Phase 11, but the lab may adopt `next` builds from Phase 4 onward to find gaps early.

Each phase, when started, becomes a numbered file in `plans/` in the repo's task format. This roadmap is the cut line.

## Out of scope

- Sandboxing or isolating package code. Packages are trusted, in-process code.
- A package registry or marketplace beyond npm, and loading packages from arbitrary URLs.
- Node.js as a supported runtime.
- A TUI, GUI, or slash-palette rendering in the kernel.
- A god config that names every package's options. Package config belongs to packages.
- Compatibility aliases for 0.12 configuration.
- Bundling, installing, or updating vendor coding agent binaries (`claude`, `codex`, `agy`). Drivers probe for them and report it; the host or the user installs them.
- Reading, storing, relaying, pooling, or reselling subscription credentials or usage. Users sign in to each vendor binary through the vendor's own flow; Prism only enforces the vendor-terms guard (§2.12.5).
- Modified, patched, or re-wrapped vendor binaries.
- Vendor SDK runtimes, the Agent SDK control protocol, a generic ACP client driver, and hosted agent services in 0.13.0 (§2.12.17).
- Sandboxing vendor coding agents beyond the sandboxes they offer. Prism gates what drivers route to it, and attributes what they report.
- A product-level orchestrator: no built-in `/build`, task classifier, prompt library, or merge-conflict resolver. Hosts compose these from `prism-workflows`, drivers, and gates.
- Gates that use a model's judgment as the deciding check. `gateNode` is deterministic code; a host can run a model in an `agentNode` before a gate.
