# Prism Roadmap — SDK kernel and native packages

Updated: **2026-09-30**

Shipped baseline: `@arnilo/prism` **0.12.1** and the 0.12.1 family packages. `@arnilo/prism-agent-sdk` **0.1.0** is published. Its unreleased in-tree Phase 1 work (plan 142) is covered under [In-flight work](#in-flight-work). `@arnilo/prism-code` **0.4.1** is the terminal lab.

Target: `@arnilo/prism` **0.13.0**, an SDK kernel that everything else extends through packages.

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

A package that is installed and listed is active. The host does not wire it up.

A **manifest** that Prism maintains records which packages are installed, with their versions, integrity hashes, config, enabled state, and slot ownership. Hosts can load packages from the manifest or pass them in code.

The **host** is the program embedding the SDK: Prism Code, a server, a bot. The host chooses packages, overrides their config, can disable any single contribution, assigns contested slots, and answers requests that need a person through one host port.

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
   ┌────────────┼──────────────┬───────────────┬───────────────┬──────────────┬─────────────┐
 provider-*   tools-*       memory-*        store-*         approval       mcp        third-party
                                                            governance     hooks-json   packages

 Surfaces (host libraries, not packages): acp · ag-ui · mcp-server · channels — take an Agent, serve it.
```

### 1.4 Rules for every phase

- **The kernel knows no package names.** `src/` never imports an `@arnilo/prism-*` package. A repo test enforces this.
- **Installed = listed = active.** Nothing loads unless the host lists it, either in code or through a manifest the host chose to load. A loaded package needs no host wiring.
- **Replacing the loop cannot bypass safety gates.** Tools execute only through `RunController.executeTools`, which always fires `tool.call`. Model calls go only through `RunController.turn`, which always fires `context.build`, `model.request`, and `model.call`.
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
- **No compatibility aliases.** 1.0 is a deliberate break from 0.12. Old config fields are removed, not aliased.
- **Docs follow releases, and are written as the API lands.** `/docs` documents the released contract. `PRODUCT.md` and this roadmap describe the target until 1.0 publishes.
  - Kernel API pages are written into `docs/next/` in the task that ships the API. They are not linked from `docs/index.md` and not packed, and the publish phase promotes them into `/docs`.
  - Each native package's `README.md` is its page, written in the task that creates the package.
  - User-visible changes go under `## [Unreleased]` in `CHANGELOG.md` as they land.
  - A phase is done when its API has its staged page or README, an example, and, where applicable, a conformance suite in `@arnilo/prism/testing`.

---

## Part 2 — Architecture

### 2.1 Kernel responsibilities

| Area | In the kernel | Not in the kernel |
| --- | --- | --- |
| Agent / session | `createAgent`, `Agent`, `Session`, run/stream/steer/abort/resume, fork, messages, session index | Protocol surfaces |
| Loop | `LoopStrategy` contract, `RunController` primitives, a default tool loop | Workflows, generate-validate-revise, plan/execute/verify |
| Hooks | Typed hook bus: observe, transform, decide, around | Hook-file formats (hooks.json) |
| Slots | `loop`, `compaction`, `store`, `credentials`, with defaults | Alternative implementations |
| Models | `ModelProvider` contract, provider registry, `ModelRef`, streaming normalization, retry/backoff, usage and stop-reason normalization, built-in `openai-compatible` provider, `models.client` | Vendor adapters, OAuth flows, model catalogs |
| Credentials | `CredentialResolver` contract, `env:` resolver default | Keyring, encrypted vaults |
| Tools | `ToolDefinition`, registry, JSON-schema argument validation, dispatch, effect annotations | Any concrete tool, sandboxing, approval policy |
| Skills | `Skill`, registry, `SKILL.md` directory discovery, progressive/eager disclosure, `load_skill` | Wiki or bundled skill sets |
| Commands | Host-invokable command registry and dispatch | Slash palette rendering |
| Packages | `definePackage`, loader, config validation, dependency order, capabilities, services, session state, background tasks | — |
| Manifest | Format, scopes, load, install/remove/enable/configure, `prism` CLI | Package registry or marketplace |
| Store | `SessionStore` contract, in-memory store, entry types including package state and suspended runs | JSONL, SQLite, Postgres |
| Compaction | Slot, `compaction.when` trigger, deterministic no-model default (drop oldest whole turns, record a marker) | LLM summaries, observational memory |
| Safety floor | Hard limits (turns, tool rounds, bytes, wall time, continuations), abort, redaction, suspend/resume of pending decisions | Cost policy, approval modes, governance, identity verification |
| Host port | `HostUi` request/response contract | Rendering |
| Events | `AgentEvent` catalog, package events | Exporters |

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
  testing/        subpath: mock provider, test agent, conformance suites
```

Published entry points:

- `@arnilo/prism`: everything a host or package author needs.
- `@arnilo/prism/provider-kit`: shared helpers for provider packages.
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
  readonly model: ModelRef;                       // "anthropic/claude-sonnet-4-5" | { provider, model, options? }
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

export interface RunOptions {
  readonly model?: ModelRef;                           // per-run model switch; same provider registry
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
  | { kind: "notify"; level: "info" | "warn" | "error"; message: string };
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
| `tool.call` | decide | `{ name, args, effects, session }` → `allow` \| `{ deny }` \| `{ ask }` \| `{ rewrite }` \| `{ respond }` | any deny wins; then any ask; then rewrites applied in order and re-validated; then the first respond; else allow | `PermissionPolicy`, tool-input guardrails, approval |
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
  /** per call: tool.call → tool.execute → tool.result → message.append; may suspend on ask */
  executeTools(calls: readonly ToolCall[], options?: { concurrency?: number }): Promise<readonly ToolResult[]>;
  append(message: Message): Promise<void>;    // message.append
  end(): Promise<{ stop: true } | { continue: string }>; // run.end
  emit(name: string, data: JsonValue): void;  // package.event
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
    { "name": "@arnilo/prism-provider-anthropic", "version": "^1.0.0", "integrity": "sha512-…", "capabilities": ["models"] },
    { "name": "@arnilo/prism-tools-coding", "version": "^1.0.0", "integrity": "sha512-…",
      "config": { "root": "." } },
    { "name": "@arnilo/prism-approval", "version": "^1.0.0", "integrity": "sha512-…",
      "config": { "mode": "ask" } },
    { "name": "@arnilo/prism-tools-web", "version": "^1.0.0", "integrity": "sha512-…", "optional": true,
      "config": { "backend": "brave", "apiKey": "env:BRAVE_API_KEY" } },
    { "name": "@arnilo/prism-memory-observational", "version": "^1.0.0", "integrity": "sha512-…", "enabled": false,
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

### 2.9 Native package catalog

Native packages are ordinary packages. None is installed by default.

| Package | What it does | Mechanisms | Built from (0.12.1) |
| --- | --- | --- | --- |
| `@arnilo/prism-provider-{anthropic, openai, google, azure, bedrock, vertex, deepseek, xai, zai, alibaba, kimi, clinepass, commandcode, hyper, laya, neuralwatt, ollama, opencode-go, openrouter, typesafe, ai-sdk}` | One vendor each: wire adapter, model catalog and discovery, auth methods, OAuth over `host.ui` | `providers.register`, credentials | `prism-providers` subpaths; `prism-code` `providers.ts`, `oauth.ts` |
| `@arnilo/prism-credentials-keyring` | OS keyring and encrypted credential store | `credentials` slot | `prism-core/credentials`, `prism-code` `credentials.ts` |
| `@arnilo/prism-tools-coding` | fs, edit, grep, shell, sandbox, execution policy, git, checks, todo with a continuation stop hook, `ask_user` | tools, `tool.call` hard denies, `run.end`, `host.ui` | `prism-coding-tools/agent`, `/security` |
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
| `@arnilo/prism-store-{jsonl, sqlite, postgres}` | Durable session stores (Postgres loads `pg` only in its own package) | `store` slot | `node/session-store-jsonl`, `prism-core/sessions` |
| `@arnilo/prism-mcp` | MCP client: servers, trust over `host.ui`, header refs, status/reconnect as commands and events | tools, commands, events | `mcp` client, SDK MCP plane, `prism-code` `mcp.ts` |
| `@arnilo/prism-hooks-json` | Claude/Codex-compatible `hooks.json` mapped onto hooks | hooks | `hooks` |
| `@arnilo/prism-governance` | Policy engine and OPA, identity verification and principal enforcement, audit | `tool.call`, `run.input`, `model.request`, observe | `prism-core/governance/policy`, `src/identity.ts`, `secure-agent.ts`, field policy and evidence modules |
| `@arnilo/prism-guardrail-packs` | Versioned rule packs | `tool.call`, `tool.result` | `src/guardrail-packs` |
| `@arnilo/prism-model-router` | Route turns across models | `model.call` | `prism-core/governance/model-router` |
| `@arnilo/prism-observability` | OpenTelemetry export | observe | `prism-core/governance/observability` |
| `@arnilo/prism-workflows` | Declarative multi-step workflows | `loop` slot | `prism-core/runtime/workflows` |
| `@arnilo/prism-delegate` | Sub-agents as a tool, inheriting a chosen package set | tools, `createAgent` | `src/delegated-agent-step.ts` |

Host libraries (not packages):

| Library | Built from |
| --- | --- |
| `@arnilo/prism-acp` | `ag-ui/acp`, `acp-agent`, `prism-code` `acp.ts` |
| `@arnilo/prism-ag-ui` | `ag-ui` |
| `@arnilo/prism-mcp-server` | `mcp` server |
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

The phase that moves each remaining 0.12.1 runtime module out of the kernel decides where it goes or whether it is deleted. This covers `artifacts`, `devices`, `feedback`, `rpc`, `run-bundle`, `run-ledger`, `leases`, `conversations`, `use-case-model`, `cache-telemetry`, and the speech, transcription, video, moderation, batch, and realtime contracts.

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
  version: "1.0.0",
  requires: { prism: "^1.0" },
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
  version: "1.0.0",
  requires: { prism: "^1.0" },
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

---

## Part 3 — Versions and in-flight work

### Version targets

| Package | Target | When |
| --- | --- | --- |
| `@arnilo/prism` | **1.0.0**, the kernel | Phase 11, once. No publish per phase. `next` pre-release tags are optional for lab testing. |
| Native packages and host libraries | **1.0.0** each, `requires.prism: "^1.0"` | Alongside the kernel in Phase 11. After that, each is versioned independently. |
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

- `@arnilo/prism-store-jsonl`, `-sqlite`, `-postgres`.
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

**Goal.** MCP, `hooks.json` (done in Phase 2), governance, guardrail packs, routing, observability, workflows, and delegation as packages.

**Why.** These exercise the remaining hook kinds: `model.call` around for routing, the `loop` slot for workflows, and observe for telemetry. They also move identity verification out of the kernel.

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
- **`observability`** (OTel; no phone-home).
- **`workflows`**, which also hosts `generate-validate-revise`.
- **`delegate`**, where sub-agents inherit a chosen package subset.
- Governance and identity modules leave the kernel.

**Done.**

- An untrusted MCP server never spawns, and a header ref is never echoed.
- A workflows example replaces the loop while `approval` still gates its tools.
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

### Phase 11 — Kernel freeze and 0.13.0

**Goal.** Ship `@arnilo/prism` 0.13.0 as a minimal, dependency-free kernel with its native packages, and make the docs describe it.

**Why.** Earlier phases move modules out as their packages land. This phase sweeps what remains, freezes the public surface, and publishes once.

**Scope.**

- **Sweep** the remaining non-kernel modules (§2.9, "decides where it goes"): move each to a package or delete it.
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

- `@arnilo/prism` 0.13.0 and the native packages are published.
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

Phase 11 needs Phases 0–10. Phase 12 needs Phase 11, but the lab may adopt `next` builds from Phase 4 onward to find gaps early.

Each phase, when started, becomes a numbered file in `plans/` in the repo's task format. This roadmap is the cut line.

## Out of scope

- Sandboxing or isolating package code. Packages are trusted, in-process code.
- A package registry or marketplace beyond npm, and loading packages from arbitrary URLs.
- Node.js as a supported runtime.
- A TUI, GUI, or slash-palette rendering in the kernel.
- A god config that names every package's options. Package config belongs to packages.
- Compatibility aliases for 0.12 configuration.
