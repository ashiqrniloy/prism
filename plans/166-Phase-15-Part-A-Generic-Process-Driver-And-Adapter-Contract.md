# Phase 15 Part A — Generic process driver and the adapter contract

## Objectives

- Review the adapter contract against the three integration shapes recorded in roadmap §2.12.4 before any code starts, and re-verify and date the vendor facts the Part B authoring guide will cite.
- Close the run-time seams a generic driver needs that plans 164 and 165 recorded as missing: reading the agent's tool and skill registries, reaching the host port and services from a driver run, and locating the `prism relay` command.
- Ship `@arnilo/prism-driver-process` (`packages/drivers/process/`) with the `AgentAdapter` contract, `processDriver(adapter)`, and the `jsonl-stream` and `json-rpc` transports.
- Make the driver do the shared work once: policy, profile, and `requires` checks before spawning; per-run broker, `serveTools`, relay descriptor, and materialization through the adapter's `configure`; `observe`, `ask`, `run.end`, and `steers()` wiring; the abort ladder; resume strategies; signal classification; and lossless capture.
- Ship `extendAdapter(base, overrides)`.

## Expected Outcome

- `import { processDriver, adapterDriver, extendAdapter, type AgentAdapter } from "@arnilo/prism-driver-process"` works. `processDriver(adapter)` is a package definition that claims `slot:loop`, and `processDriver(adapter)(spec)` is a package instance whose config is the adapter's `ExternalAgentSpec` plus the driver's own keys.
- Before spawning, a run passes the policy guard, the profile checks, `requires`, and the isolation check (a `workspace-files` adapter under strict isolation with no bound worktree fails with `worktree_required`). Each run then gets a run directory, a callback broker, a relay descriptor carrying the adapter's fail-closed response, `serveTools` when the spec selects Prism tools or a permission tool, and the adapter's `configure` output (`args`, `env`, `files`, `overlays`).
- Under `jsonl-stream`, the driver writes encoded input to stdin and ends a turn on the frame the adapter marks. Under `json-rpc`, it runs a JSON-RPC 2.0 peer over stdio: every server-to-client request goes to an adapter handler, and an unknown one fails the run.
- Decoded activity reaches `run.observe`. Gating goes through `run.ask` via the relay or a request handler. Stop callbacks reach `run.end`. `session.steer()` input is delivered according to the descriptor's `steer` mode. Abort runs the adapter's ladder within the grace timeout. `store`, `vendor`, and `none` resume work through K5 `external_state` entries. Rate-limit, quota, billing, and auth signals stop or defer the run and are never retried. Unmapped frames reach `agent.raw` under `capture: "all"` and are counted otherwise.
- The probed binary path and version, the adapter name and revision (and the base adapter's, for an extension), and the effective policy appear in `agent.inspect()` status notes and in the driver's service `inspect()`.
- `extendAdapter(base, overrides)` replaces or wraps parts of an adapter, the driver re-checks the merged descriptor, and `inspect()` names both the base and the extension.
- No vendor or binary name appears in `packages/drivers/process/src/`.

This plan implements roadmap **Phase 15 — Generic process driver and the adapter contract**, Part A. Part B (plan 167) ships `adapterConformance`, `recordFixtures`, the scripted-CLI additions they need, the three offline reference adapters, the external-host proof, the authoring guide, `examples/custom-adapter.ts`, and the Phase 15 Done record. **Task 1 is the phase review for both parts**, as the roadmap requires ("record any change in the plan before code starts"); Part B opens with an entry check. Task 2 is a kernel contract change (registry reads and `DriverRunContext` additions) that the roadmap does not list. It is planned here because plans 164 and 165 both recorded the missing seam, and Task 1 must confirm it or re-cut the plan before Task 2 starts. Prism ships no vendor adapter: every adapter in this plan is an inline test adapter over the neutral reference dialects. This plan does not bump versions, publish, deprecate on npm, or edit released `/docs`.

## Tasks

- [x] Task 1: Phase 15 review — the adapter contract against the three integration shapes (read-only)
  - Acceptance Criteria:
    - Functional: **Entry check.** Confirm from source and the plan 164 and 165 notes that the Phase 13 and 14 contracts the driver builds on shipped as recorded, citing `file:line` for each: `defineDriver`/`driverPackage`/`createDriverLoop` (`src/driver-kit/define.ts:73,157,206`), `DriverDescriptor`/`AuthMode`/`DriverRequires` (`src/driver-kit/descriptor.ts:5,22,52`), `createPolicyGuard` and `noteLimit` (`src/driver-kit/guard.ts:51-60,72`), `createProfiles` (`src/driver-kit/profiles.ts:91`), `createRunDirectory`/`assertIsolation`/`materializeSkills` (`src/driver-kit/materialize.ts:47,97,140`), `createCallbackBroker`/`HookCodec`/`HookEvent`/`HookAnswer` (`src/driver-kit/broker.ts:23-80`), `RelayAnswer`/`RelayDescriptor` (`src/driver-kit/relay-protocol.ts:19-30`), `bridgeTools` (`src/driver-kit/bridge.ts:31`), `McpEndpoint` (`src/driver-kit/mcp-endpoint.ts:6`), the process helpers (`src/driver-kit/process/*.ts`: `readJsonl`, `createJsonRpcPeer` with `onUnhandled`, `createStdinWriter`, `signalLadder`, `redactedStderr`, `buildChildEnv`, `probeBinary`), `serveTools`/`ServeToolsOptions` (`packages/hosts/mcp-server/src/serve-tools.ts:66`, `types.ts:183`), and the `workspace` service's `worktree.bound(sessionId)` (`packages/tools/coding/README.md`, "Workspace service").
    - Functional: **The three shapes.** For each shape in §2.12.4, write the adapter it implies against the recommended contract (API Notes below) and confirm every Phase 15 Scope item maps to a contract member or the driver. Record each mapping row in the Notes:
      - (A) a flag-configured stream CLI: one process, JSONL in and out, configuration by flags and a settings file, relay command-hook gating with input rewrite, MCP tools, skills as a wrapped plugin layout, sub-agents nested by a parent tool id, `store` resume from an archived transcript, SIGINT then SIGTERM.
      - (B) a JSON-RPC app-server: `initialize`/`initialized`, thread start/resume, `turn/start`/`turn/steer`/`turn/interrupt`, approval requests answered through `run.ask`, user-input and elicitation requests through `host.ui`, client tool calls through `bridgeTools`, notifications as activity, `vendor` resume by thread id, a status RPC.
      - (C) a workspace-file-configured stream CLI: configuration written as a worktree overlay (agent file, hooks file, rules, skills directory, MCP config), relay gating without rewrite where the fail-closed response is a printed deny, `next-turn` steer, thinking as token counts only, stdin close then a signal.
    - Functional: Decide, with evidence (recommended answers below; record the decision and any amendment to Tasks 2–7 and plan 167):
      - (a) **Registry reads.** `RunController` exposes no registry by design (`src/loop/types.ts:113-118`), and `PackageAPI.tools`/`skills` only register (`src/packages/api.ts:89-98`). Plan 164 Task 6 deviation 1 and plan 165 Task 1 decision (a) record the gap; `bridgeTools` documents a `DriverRunContext.tools` member that does not exist (`src/driver-kit/bridge.ts:21`, plan 165 Further Actions P3). §2.12.7 says `prismTools` and `skills` select "from this Agent's" registries. Recommended: a kernel addition, `PackageAPI.tools.list()` and `PackageAPI.skills.list()`/`get(name)`, read-only and effective (host, kernel, and package contributions minus `disable`), throwing `state_not_ready` during `setup` like `packages.instances` (`api.ts:83`). Proof that nothing existing expresses it: no hook payload carries the registry, no slot owns it, and `services` would need every tool package to publish its own list. Generic: needed by every driver package (through `driverPackage`) and by any `serveTools` caller.
      - (b) **Driver run context.** Recommended: `DriverRunContext` gains `tools` (definitions read through (a)), `skills` (the registry read through (a), typed `Pick<SkillRegistry, "get" | "list">` as `materializeSkills` takes it), `host` (the package's `HostPort`, so `json-rpc` request handlers can route questions and elicitation to `host.ui`), and `services: { consume<T>(name): T | undefined }` (so the driver can find the `workspace` service's bound worktree). All four already exist on the `PackageAPI` that `driverPackage.setup` receives (`define.ts:216`); only (a) is new.
      - (c) **Relay command.** Plan 164's example hardcodes `dist/cli.js` (`examples/external-agent.ts`), and `serveTools` requires `relay.command` from the caller (`types.ts:198`). Recommended: `relayCommand(): readonly string[]` in the driver kit, returning `[process.execPath, <the kernel's own cli.js>]` resolved from `import.meta.url`. A driver appends `relay hook --run <dir>` or `relay mcp --run <dir>`.
      - (d) **Profile part of the adapter.** The roadmap's `profile` member (home variable, protected paths and variables, login and status commands, status parser) is already split across `descriptor.auth.modes[]` (`homeEnv`, `protected`, `login`, `status`, `descriptor.ts:5-19`) and `DriverDefinition.parseStatus` (`define.ts:59`). Recommended: `AgentAdapter.profile` is `{ parseStatus }` only, and the rest stays in `descriptor.auth.modes`, so the guard reads one source.
      - (e) **Lifecycle handshake.** Shape (B) needs requests before the first prompt (`initialize`, thread start or resume), which the roadmap's `encode` list (prompt, steer, stop-continue) does not cover. Recommended: an optional `open(ctx)` on the adapter, returning the frames (`jsonl-stream`) or requests (`json-rpc`) to send after spawn and before the first prompt; its results feed `decode`'s session-id signal.
      - (f) **Process lifetime.** The loop slot is invoked per run, and the kernel has no per-session loop lifetime. Recommended: one vendor process per run. Conversation continuity across runs comes from the adapter's session strategy (`store` restores the archived state into a new process; `vendor` passes the recorded session id; `none` starts fresh each run, stated in the README). A per-session process cache goes to Further Actions.
      - (g) **Where `inspect()` shows the driver.** `agent.inspect()` has no driver section (`src/agent/inspect.ts:42-69`); plan 164 Task 4 deviation 2 put profiles on `guard.inspect()` behind the `driver-kit:<name>` service. Recommended: one `info` status note at `setup` (adapter name and revision, base adapter if extended, binary path and version, transport, capture mode, deployment), which reaches `agent.inspect().statusNotes`, plus a `driver-process:<name>` service whose `inspect()` returns the same record with the effective policy and isolation. No kernel change.
      - (h) **`steer_unsupported`.** K2 says `steers()` throws `steer_unsupported` where the vendor cannot take input mid-turn and the descriptor does not allow queueing; `rg steer_unsupported src` finds no producer. Recommended: the driver owns it. Under `steer: "none"`, a queued steer is not delivered and the driver observes a `notice` (`level: "warn"`, `code: "steer_unsupported"`), so it is not dropped silently. Under `next-turn`, it is held and sent as the next prompt.
      - (i) **`serveTools` dependency.** `@arnilo/prism-mcp-server` brings `@modelcontextprotocol/server` (`packages/hosts/mcp-server/package.json:21-25`). Recommended: a regular dependency, imported dynamically only when the spec has `prismTools` or a permission tool, with a "not loaded unless used" test. Confirm a native package may depend on a host library. Nothing in `references/prism.md` §1 forbids it, and `prism-mcp-server` uses only the public kernel API.
      - (j) **`adapterConformance` placement (Part B).** The roadmap puts it in `/testing`, but it must call `processDriver`, and the kernel never imports a package (`references/prism.md` §1). Recommended: `@arnilo/prism-driver-process/testing` (a package subpath) owns `adapterConformance`; kernel `/testing` owns the vendor-neutral `recordFixtures` and the scripted-CLI additions. The Done criterion "imports only `@arnilo/prism`, `/driver-kit`, `/testing`, and `@arnilo/prism-driver-process`" is read as including that package's public subpath, which is not an internal import. Record this as a roadmap conflict for the user to confirm.
      - (k) **Fixture recording.** Recommended: `recordFixtures.command(command, logPath)` returns a tee wrapper argv (a stdlib Bun script that copies stdin and stdout lines to a log and passes them through unchanged), which a host sets as the adapter's binary for one live run. `recordFixtures.finish(logPath, out, { redact })` writes a redacted fixture file. The binary itself is unmodified (§2.12.5 rule 1), and the driver needs no recording mode.
      - (l) **Scripted CLI configuration discovery (Part B).** The scripted binary finds its hook command and MCP endpoint only from `--hook-command`/`--mcp-endpoint` flags (`src/testing/scripted-cli.ts` `binarySource`). Shapes (A) and (C) carry them in a settings file and a worktree overlay. Recommended: an optional serialized `locate({ argv, env, cwd, readFile })` on `ScriptedDialect` that returns `{ hookCommand?, endpoint?, loaded: string[] }`, plus a `{ raw: string }` script step for replaying recorded lines. `loaded` lists the hooks, skills, and MCP servers the dialect found, including any from a fake user home, which the isolation leg checks.
    - Functional: **Re-verify and date the §2.12.4 and §2.12.5 facts** that the guide's worked mappings cite, using find-docs or a web fetch of each linked source. For each fact, record one of: unchanged, changed (with the new text), or unverifiable. Cover at least: headless flags and stream message types, the gating hook contract and exit-code semantics, whether HTTP hooks are non-blocking on failure, status and login commands, home relocation variables, resume flags, app-server request and notification names, `agy` stream-json input and output shapes, hooks decisions, the relocatable-home question (§2.12.11), and the three vendors' subscription terms rows. A changed fact that breaks a shape's mapping is a finding.
    - Functional: Record the failing-test baseline (`bun run typecheck`, `src/driver-kit src/testing`, `packages/hosts/mcp-server`, `packages/tools/coding`, `src/__tests__/docs.test.ts`, `bun scripts/release.mjs gate`) and compare it with plan 165's close. Green for Tasks 2–7 then means no new failure beyond this list.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut the plan. Never improvise a seam inside a later task.
    - Performance: n/a — read-only.
    - Code Quality: Every decision cites its source span or dated URL.
    - Security: Confirm that every path the driver will write (run directory, overlay files, archived-state restore files) is built only through `createRunDirectory`'s containment (`materialize.ts:36-41`) or `writeExcludeBlock`, never from adapter-supplied absolute paths. Confirm the relay's fail-closed response comes only from the adapter's declared `hooks.failClosed` and is written before spawn.
  - Approach:
    - Documentation Reviewed:
      - roadmap §1.4, §2.12.4–§2.12.11, §2.12.16, §2.13.1, Phase 15 Scope and Done, Phases 13–16 re-scope table
      - plans 164 and 165 (Notes, Compromises, Further Actions); `plans/backlog.md` entries sourced from them
      - `docs/next/drivers.md`, `docs/next/loop.md`, `docs/next/packages.md`
      - the vendor sources linked in §2.12.4 and §2.12.5 (fetched and dated in the Notes)
    - Options Considered:
      - Skip the review and treat the roadmap contract as final. Rejected: the roadmap requires the review, and (a), (e), (j), and (l) are already visible gaps.
      - Defer the vendor re-verification to Part B's guide task. Rejected: a changed fact can change the contract, so it must be known before Task 3.
    - Chosen Approach:
      - Read the shipped spans, sketch the three adapters against the contract, decide (a)–(l), re-verify the facts, and amend Tasks 2–7 and plan 167 in place.
    - API Notes and Examples:
      ```ts
      // The contract Task 3 implements (confirmed by Task 1, with amendments F1-F5 marked).
      interface EncodeContext { readonly sessionId?: string; readonly turnId?: string }                      // F1
      type OutboundFrame = JsonValue | { method: string; params?: JsonValue; notify?: boolean; onResult?(result: JsonValue): Decoded | undefined }; // F1 (json-rpc form)
      interface AgentAdapter {
        readonly name: string;                       // package name, e.g. "@acme/prism-adapter-foo"
        readonly revision: string;
        readonly descriptor: DriverDescriptor;
        readonly transport: "jsonl-stream" | "json-rpc";
        readonly vendor?: JsonSchema;                 // validates ExternalAgentSpec.vendor
        readonly binary: { readonly command: readonly string[]; readonly versionArgs?: readonly string[]; version(stdout: string): string | undefined };
        readonly profile: { readonly parseStatus: ParseStatus };
        configure(spec: ExternalAgentSpec, ctx: ConfigureContext): Promise<LaunchPlan> | LaunchPlan; // ctx.hook: { argv, command } (F5); returns { args, env, files, overlays }
        open?(ctx: OpenContext): readonly OutboundFrame[];                                              // ctx: EncodeContext + resume + selected tools (F1)
        readonly encode: { prompt(input: AgentInput, ctx: EncodeContext): OutboundFrame; steer?(message: Message, ctx: EncodeContext): OutboundFrame; continue?(reason: string, ctx: EncodeContext): OutboundFrame };
        decode(frame: JsonValue): Decoded;            // { activity: ExternalActivity[]; turnEnd?; sessionId?; turnId? (F1); stop?; unmapped? }
        readonly hooks?: { readonly codec: HookCodec; readonly failClosed: RelayAnswer; readonly timeoutMs?: number };
        readonly permissionTool?: string;             // F4: passed to serveTools({ permissionTool })
        readonly requests?: Readonly<Record<string, RequestHandler>>; // json-rpc only
        readonly session: { readonly strategy: "store" | "vendor" | "none"; archive?(ctx: { runDir; home; cwd; sessionId? }): Promise<JsonValue[]>; restore?(entries, ctx): Promise<RestorePlan> }; // F3
        readonly abort: readonly AbortStep[];          // { rpc: method; params?(ctx: EncodeContext) } | { closeStdin: true } | { signal: "SIGINT" | "SIGTERM" }
        notices?(activity: ExternalActivity): LimitSignal | undefined;
      }
      ```
      ```bash
      graft callers driverPackage --depth all
      graft callers bridgeTools --depth all
      rg -n steer_unsupported src packages
      ```
    - Files to Create/Edit:
      - `plans/166-Phase-15-Part-A-Generic-Process-Driver-And-Adapter-Contract.md`: Notes and amendments only.
      - `plans/167-Phase-15-Part-B-Adapter-Conformance-Reference-Adapters-And-Authoring-Guide.md`: amendments only, where a decision changes a Part B task.
    - References:
      - plan 164 Task 1 and plan 165 Task 1 (review pattern); plan 164 Task 6 deviation 1; plan 165 Further Actions P2/P3
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only. The dated vendor facts are recorded in the Notes for plan 167's guide task.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-11):
    - **Verdict: proceed. No re-cut.** The contract holds for all three shapes with seven amendments (F1–F7), all recorded in Tasks 2, 3, and 6 above. None changes a task's goal, the package layout, or plan 167's task list. Open for the user: decision (j), which is a roadmap conflict (below).
    - **Entry check.** Every named Phase 13/14 contract exists as plans 164 and 165 recorded. Cites below are current; four moved from the plan's text (marked →).
      - `defineDriver` `define.ts:73`, `createDriverLoop` `:157`, `driverPackage` `:206`, `setup` `:216`; `DriverRunContext` `:30-39` (→ was `19-28`) has only `run, spec, config, binary, descriptor, lease`, so `tools`, `skills`, `host`, `services` are confirmed absent.
      - `AuthMode` `descriptor.ts:5`, `DriverDescriptor` `:22`, `DriverRequires` `:52`; `permissionCallback` is a boolean (`:35`).
      - `PolicyGuard` `guard.ts:51`, `createPolicyGuard` `:72`; `createProfiles` `profiles.ts:91`; `createRunDirectory` `materialize.ts:47`, `contain` `:36`, `assertIsolation` `:97`, `materializeSkills` `:140`.
      - `HookEvent` `broker.ts:23`, `createCallbackBroker` `:80`; `RelayAnswer` `relay-protocol.ts:19`; `bridgeTools` `bridge.ts:31`; `McpEndpoint` `mcp-endpoint.ts:6`.
      - Process helpers (`env.ts:22`, `jsonl.ts:20`, `json-rpc.ts:37`, `probe.ts:8`, `signals.ts:12`, `stderr.ts:9`, `stdin.ts:10`) all exist.
      - `serveTools` `serve-tools.ts:66`, `ServeToolsOptions` `types.ts:183`, `relay.command` is `types.ts:200` (→ was `198`), `permissionTool` `:196`.
      - `workspace` service `worktree.bound(sessionId)`: `packages/tools/coding/README.md:118`.
      - `PackageAPI.tools`/`skills` are `api.ts:107-116` (→ was `89-98`); `packages.instances` doc is `:101`. `RunController` says "no registry" at `loop/types.ts:113-118` (confirmed). `AgentInspection.statusNotes` is `inspect.ts:63,124`.
    - **The three shapes.** Each row maps a Phase 15 Scope item to the contract member or driver step that carries it.

      | Scope item | (A) flag-configured stream CLI | (B) JSON-RPC app-server | (C) workspace-file stream CLI |
      | --- | --- | --- | --- |
      | transport | `jsonl-stream` | `json-rpc` | `jsonl-stream` |
      | configuration | `configure` → `args` (`--settings`, `--mcp-config`, `--strict-mcp-config`, `--setting-sources`, `--plugin-dir`, `--tools`) plus `files` in the run directory; `CLAUDE_CONFIG_DIR` from the mode's `homeEnv` | `configure` → `args` (`app-server`), `env`; thread options go in `open` | `configure` → `overlays` into the bound worktree (agent file, `hooks.json`, rules, skills dir, MCP config) with exclude blocks; `workspace-files` isolation |
      | handshake | none | `open`: `initialize`, `initialized` (notify), then `thread/start` or `thread/resume`; `onResult` records the thread id; `capabilities.experimentalApi` is the adapter's `initialize` params | none |
      | prompt / steer | `encode.prompt`; `steer` mid-turn (stream-json stdin) | `turn/start`; `turn/steer` needs the turn id → `EncodeContext.turnId` (F1) | `encode.prompt`; `next-turn` steer held by the driver (Task 4) |
      | gating | `hooks.codec` over `hook.command` (F5); `failClosed` = exit 2; `updatedInput` → `rewrite: true` | no `hooks`; approvals are server requests → `requests[...]` → `ask` (Task 5) | `hooks.codec`; `failClosed` = exit 0 + printed deny; `rewrite: false` (a rewrite is `rewrite_unsupported`) |
      | questions / elicitation | `AskUserQuestion` via the permission tool (`permissionTool`, F4) | `item/tool/requestUserInput`, `mcpServer/elicitation/request` → `host.ui` (Task 2 `host`) | none declared |
      | Prism tools | `serveTools` endpoint → `--mcp-config` | `bridgeTools` through the `item/tool/call` handler, plus `dynamicTools` in `open` (needs the tool definitions in `OpenContext`, F1) | `serveTools` endpoint → worktree MCP config overlay |
      | skills | `materializeSkills` into a wrapped plugin dir → `--plugin-dir` | `skills/extraRoots/set` as an `open` request, or none | `materializeSkills` into the overlay's skills dir |
      | sub-agents | `decode` maps `parent_tool_use_id` to a nested `subagent` activity | `collabToolCall` items → `subagent` | `subagent_info` → `subagent` |
      | thinking | `decode`: deltas | summary/raw deltas | token counts only → descriptor `tokens-only` |
      | resume | `store`: `archive` reads the transcript under `home`, `restore` writes it into the run directory, `args: [--resume, <abs path>]` (F3) | `vendor`: `ctx.resume.sessionId` → `thread/resume` | `vendor` (`--conversation <id>`) |
      | abort | `[{ signal: SIGINT }, { signal: SIGTERM }]` | `[{ rpc: "turn/interrupt", params }, { closeStdin }, { signal: SIGTERM }]` (F1) | `[{ closeStdin }, { signal: SIGTERM }]` |
      | end of run | `result` → `turnEnd`, then graceful stdin close (F2) | `turn/completed` → `turnEnd`, then stdin close | `result` → `turnEnd`, then stdin close |
      | signals | `system/api_retry` categories → `notices` | rate-limit notifications / `error` items → `notices` | `result.status` → `notices` |
      | status | descriptor `auth.modes[].status` + `profile.parseStatus` | same (`codex login status`; the `account/read` RPC is not needed) | same |

      Every Scope item maps. The gaps found while mapping are F1–F5 and F7 below.
    - **Decisions (a)–(l).** Evidence is in the cited spans or the dated facts below.
      - (a) **Confirmed, amended (F6).** No registry on `RunController` (`loop/types.ts:113-118`), none on `PackageAPI` (`api.ts:107-116`), and no hook payload or service carries it. The effective merge is `agentToolList`/`agentSkillSource` (`runtime-registry.ts:93,115`) and needs an `Agent`, which does not exist when `loadPackages` runs (`create-agent.ts:108`). So Task 2 adds a late-bound `LoadPackagesOptions.registry` reader. Reads exclude the session-conditional `when` filter.
      - (b) **Confirmed.** `host` and `services.consume` already exist on the `PackageAPI` that `driverPackage.setup` receives (`define.ts:216`). `bridge.ts:21` already documents the missing `DriverRunContext.tools`.
      - (c) **Confirmed, amended (F5, F7).** `examples/external-agent.ts:65` and `examples/serve-tools.ts:65` hardcode `dist/cli.js`. `relayCommand()` resolves `../cli.js`, falling back to `../cli.ts` under Bun in the source layout. The package also builds `hook.command`, the quoted string that shapes A and C need.
      - (d) **Confirmed.** `homeEnv`, `protected`, `login`, `status` sit on `AuthMode` (`descriptor.ts:5-22`); `parseStatus` is on `DriverDefinition` (`define.ts:59`). `AgentAdapter.profile` is `{ parseStatus }` only.
      - (e) **Confirmed, expanded (F1, F2).** Shape B needs `open`, a way to carry the thread and turn ids into later requests, and a graceful end-of-run shutdown that is not the abort ladder.
      - (f) **Confirmed.** One process per run. Codex's docs require `initialize` once per connection (app-server docs, fetched 2026-10-11), so a per-session cache would also need connection reuse; that stays in Further Actions.
      - (g) **Confirmed.** `AgentInspection.statusNotes` (`inspect.ts:63,124`) is the only place a package reaches `agent.inspect()`; no kernel change.
      - (h) **Confirmed.** `grep -rn steer_unsupported src packages --include=*.ts` outside tests returns nothing, so the driver owns it (Task 4).
      - (i) **Confirmed with a caution.** `@arnilo/prism-mcp-server` has runtime dependencies `@arnilo/prism-mcp ^0.12.1`, `@modelcontextprotocol/server 2.0.0`, and `zod`, plus peers. A native package depending on a host library is allowed (`references/prism.md` §1 names no ban, and the host library uses only the public kernel API). The 0.12-line `@arnilo/prism-mcp` dependency is pre-existing and rides along at install time. Dynamic import plus the load-cost test is the guard.
      - (j) **Unchanged recommendation; needs user confirmation.** `adapterConformance` in `@arnilo/prism-driver-process/testing`, because the kernel may not import a package. This conflicts with the roadmap placing it in `/testing`. Plan 167 Task 1 already stops if the user chooses otherwise.
      - (k), (l) **Confirmed.** `ScriptedDialect` (`src/testing/scripted-cli.ts:92-99`) has no `locate`, and the binary reads only `--hook-command`/`--mcp-endpoint` (`:223-225`), so (l) stays a Part B task as written. `ScriptedInput` kinds (`user | steer | answer | interrupt`) suffice for all three shapes because the wire format lives in dialect functions.
    - **Amendments (F1–F7).**
      - F1 `EncodeContext {sessionId, turnId}`, json-rpc `OutboundFrame` with `onResult`, `Decoded.turnId`, `AbortStep.rpc.params` (Task 3). Evidence: shape B's `turn/steer` and `turn/interrupt` carry `threadId`/`turnId` (app-server docs).
      - F2 Graceful post-turn shutdown (Task 6). Without it a finished run leaves a process waiting on stdin.
      - F3 `archive`/`restore` get `{runDir, home, cwd, sessionId}`, and archived paths are checked against `protected.paths` (Task 6).
      - F4 `permissionTool?` on the adapter, passed to `serveTools` (Task 3). The plan's pipeline already wired a permission tool but the contract had no member for it.
      - F5 `ConfigureContext.hook.command` quoted string (Task 3).
      - F6 Late-bound registry reader in `loadPackages`/`create-agent.ts` (Task 2).
      - F7 `relayCommand` source-layout fallback (Task 2).
      - The `adapter_invalid` rule for `permissionCallback` now checks `hooks`/`requests`/`permissionTool` (Task 3), because the descriptor flag is a boolean.
    - **Security confirmations.**
      - `RunDirectory.writeFile` goes through `contain(root, rel)` (`materialize.ts:61-65`), and `overlay` runs `contain(wt, file.path)` after `resolveGitExclude` validates the exclude location (`:68-82`). `contain` rejects empty, absolute, and `..` paths (`:36-41`). Restore files use `writeFile`, overlays use `overlay`; `writeExcludeBlock` is `git-exclude.ts:106`. No adapter-supplied absolute path is written.
      - The relay's fail-closed response is validated and copied in `createCallbackBroker` (`broker.ts:81-92`) and put in the descriptor the broker writes at start (`:237`). The pipeline creates the broker before it spawns, so it exists before spawn, and it comes only from `hooks.failClosed`. A throwing codec answers `failClosed` (`:134-136`).
    - **Vendor facts, fetched 2026-10-11** (`read_url_content` with plain-text extraction of each linked page, plus a search-level pass by a research subagent). `unchanged` means the claim was found in the fetched page.

      | Fact (roadmap) | Verdict | Source |
      | --- | --- | --- |
      | `claude -p` with `--input-format stream-json`, `--output-format stream-json`, `--verbose`, `--include-partial-messages`, `--forward-subagent-text` (v2.1.211+) | unchanged | code.claude.com/docs/en/headless |
      | `system/api_retry` event and its fields | unchanged (event and fields confirmed; each category name, e.g. `billing_error`, not re-read) | same |
      | `--permission-prompts host\|none`; `--permission-prompt-tool` | unchanged | same |
      | `--bare`, `--safe-mode`, `CLAUDE_CONFIG_DIR`, `--resume <id>` | unchanged by search summary (cli-reference not re-read); `--resume <absolute .jsonl path>`, `--session-id`, `--fork-session`, exit 143 unverifiable | code.claude.com/docs/en/cli-reference |
      | Command hook exit 2 blocks; other non-zero codes are non-blocking; `permissionDecision` allow/deny/ask/defer | unchanged | code.claude.com/docs/en/hooks |
      | HTTP hook failure is non-blocking | **unchanged by default, with a new option:** since v2.1.295 `onFailure: "block"` makes a failed hook (HTTP included) block. The default is `"continue"`. Not a mapping break: the relay stays the gate, and the guide may mention the option. | same (HTTP hook field table) |
      | `mcp_tool` hooks; `Stop` continues; `updatedInput` | `mcp_tool` non-blocking errors unchanged; `updatedInput` and `Stop` continue not re-read | same |
      | `claude auth status` JSON, `claude auth login`, `setup-token` | partly verified (JSON default and a `--text` flag; `authMethod`/`configDirectory` fields and exit code unverified) | search summary |
      | Codex app-server: `initialize` once per connection then `initialized`; `thread/start`/`resume`/`fork`; `turn/start`/`steer`/`interrupt` (`threadId`, `turnId`); `turn/completed` | unchanged | learn.chatgpt.com/docs/app-server |
      | Server requests: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`, `item/tool/call` | unchanged in kind; **names carry the `item/` prefix** (the roadmap writes `tool/requestUserInput`) | same |
      | `dynamicTools` on `thread/start` and `item/tool/call` | unchanged; **explicitly experimental and requires `capabilities.experimentalApi = true`** | same |
      | `skills/extraRoots/set`, `account/read`, `account/login/start`, `generate-ts` | unchanged | same |
      | `CODEX_HOME`, `codex login status`, `auth.json`, `chatgptAuthTokens` | unverifiable (no change seen) | auth page not re-read |
      | `agy` stream-json: input `{event:"user",message:{content}}`; output `init`, `step_update`, `result` (`conversation_id`, `status`, `usage.thinking_tokens`) | unchanged for `init`/`step_update`/`result` and the `usage` token fields; `subagent_info`, the absence of thinking text, and `control_request` rejection not found in the extracted text | antigravity.google/docs/cli/headless |
      | `agy -p` one-shot and `--output-format json` | **new, additive:** documented; the driver does not use it | same |
      | `agy` hooks decisions (`deny_unless_prior_grant`, `Stop` continue, `IsSkillFile`) | **unverifiable:** the page body does not render without JavaScript | antigravity.google/docs/hooks |
      | `agy` install and auth, keyring, `GEMINI_API_KEY` | unverifiable (same reason) | antigravity.google/docs/cli/install |
      | Relocatable home for `agy` (§2.12.11, "to verify") | unverifiable; stays "to verify" | none found |
      | Terms rows (Anthropic, OpenAI, Google), §2.12.5 | unchanged in substance by search summary; exact quotes **not re-read** | code.claude.com/docs/en/legal-and-compliance, learn.chatgpt.com/docs/auth, antigravity.google/terms |

      No changed fact breaks a shape's mapping. Part B Task 8 must re-read the unverifiable rows (`agy` hooks, install, relocatable home, the three terms pages, Claude `cli-reference` and `--resume <path>`) in a browser-capable session before the guide cites them. It must also use the `item/` request names and the `experimentalApi` caveat.
    - **Failing-test baseline (2026-10-11), identical to plan 165's close.** `bun run typecheck` exit 0. `src/driver-kit src/testing` 73 pass / 0 fail. `packages/hosts/mcp-server` 41 pass / 0 fail (plan 165 recorded 34 at its Task 8; no failure either way). `packages/tools/coding` 585 pass / 0 fail. `src/__tests__/docs.test.ts` 164 pass / 6 fail, the same six pre-existing failures. `bun scripts/release.mjs gate` exit 1 only on the blocked Postgres evidence (`PRISM_TEST_POSTGRES_URL` not set), no compat error. Tasks 2–7 are green when they add no failure beyond these six docs failures and the Postgres block.

- [x] Task 2: Kernel seams — registry reads for packages, the driver run context, and `relayCommand`
  - Acceptance Criteria:
    - Functional: `PackageAPI.tools.list(): readonly ToolDefinition[]` and `PackageAPI.skills.list(): readonly Skill[]` / `skills.get(name): Skill | undefined` return the agent's effective registries (host, kernel, and package contributions, minus `AgentConfig.disable`). Called during `setup`, each throws `PackageLoadError` `state_not_ready`. Returned arrays and entries are frozen; mutating them fails.
    - Functional: `DriverRunContext` gains `tools`, `skills`, `host`, and `services.consume`, filled by `driverPackage` from its `PackageAPI` at run time (`src/driver-kit/define.ts:19-28,174-184,216-240`). `BridgeToolsOptions.tools`' doc comment (`src/driver-kit/bridge.ts:21`) now names a real member.
    - Functional: `relayCommand()` is exported from `@arnilo/prism/driver-kit` and returns `[process.execPath, <absolute path to the kernel's cli.js>]`. Spawning it with `relay hook --run <dir>` reaches the relay. The path is resolved from the module's own URL, never from `PATH` or `cwd`. **(Task 1 amendment, finding F7.)** In the built layout the module is `dist/driver-kit/relay-command.js` and the target is `../cli.js` (`package.json` `bin`). In the source layout (`src/driver-kit/__tests__`, source-export packages) `../cli.js` does not exist, so it falls back to `../cli.ts`, which only Bun can run; it throws a clear error when `process.execPath` is not Bun in that case. Tests cover both.
    - Functional: `examples/external-agent.ts` and `examples/serve-tools.ts` read `context.tools`/`context.skills` and `relayCommand()` instead of their own tool lists and hardcoded `dist/cli.js`. Both keep passing under the demo gate.
    - Performance: The reads are O(n) snapshots over registries that already exist. No new work runs per model turn.
    - Code Quality: The kernel gains no dependency and names no package. Written proof (Task 1 (a)) is copied into the task note. No compatibility alias.
    - Security: The reads are read-only. A package cannot register, replace, or unhide a disabled tool or skill through them. `relayCommand()` returns a path inside the installed kernel. A test asserts it is absolute and ends in the kernel's `cli.js`.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/api.ts:75-161`, `src/packages/loader.ts:233-960` (`createApi` at `:621`, the disabled sets at `:337`, `skills: () => packageSkills.list()` at `:919`)
      - `src/driver-kit/define.ts`, `src/driver-kit/bridge.ts`, `src/cli.ts` (relay dispatch from plan 164 Task 6)
      - roadmap §2.6 (Tools, Skills), §2.12.7 (spec selects from the agent's registries)
    - Options Considered:
      - `processDriver(adapter, { tools, skills })` factory options. Rejected: the host would duplicate definitions that packages already registered (for example `tools-coding` builds its tools inside `setup`), and the skills registry is not reachable before `createAgent` returns.
      - A registry on `RunController`. Rejected: `RunController` is the gate surface and deliberately exposes no registry (`src/loop/types.ts:113-118`).
      - A `tools`/`skills` service published by each package. Rejected: every tool package would need to opt in, and kernel and host tools would be missing.
    - Chosen Approach:
      - Read-only accessors on `PackageAPI` backed by the loader's existing effective registries, gated like `packages.instances`. `driverPackage` passes them, the host port, and `services.consume` through the run context.
    - API Notes and Examples:
      ```ts
      // inside a driver's start.run
      async run({ run, spec, tools, skills, host, services }) {
        const bridge = bridgeTools(run, spec.prismTools ?? [], { origin, tools });
        const worktree = services.consume<{ worktree: { bound(id: string): { path: string } | undefined } }>("workspace")?.worktree.bound(run.session.id);
        const hook = [...relayCommand(), "relay", "hook", "--run", runDir.path];
      }
      ```
    - Files to Create/Edit:
      - `src/packages/api.ts`: `tools.list`, `skills.list`/`get` signatures and docs.
      - `src/packages/loader.ts`: implement them in `createApi` over a late-bound reader; `state_not_ready` during setup. **(Task 1 amendment, finding F6.)** The loader cannot compute the effective view alone: the merge of the host's `AgentConfig.tools`/`skills` with package contributions, minus `disable`, lives in `agentToolList` and `agentSkillSource` (`src/agent-session/runtime-registry.ts:93,115`), keyed by `Agent`, and `loadPackages` runs before the agent exists (`src/agent-session/create-agent.ts:108`). Add `LoadPackagesOptions.registry?: { readonly tools: () => readonly ToolDefinition[]; readonly skills: () => readonly Skill[] }`, which `create-agent.ts` binds after the agent is built to call those two functions. `createApi` reads it lazily and throws `state_not_ready` until `setupComplete` (`loader.ts:339,892`). The reads return every registered tool, not the session-conditional ones (`PackageToolEntry.when`, `loader.ts:72`); the docs say so.
      - `src/driver-kit/define.ts`: `DriverRunContext` additions; pass them in `createDriverLoop`/`driverPackage`.
      - `src/driver-kit/relay-command.ts` (new) and `src/driver-kit/index.ts`: `relayCommand`.
      - `src/driver-kit/bridge.ts`: doc comment now accurate.
      - `src/__tests__/package-api-reads.test.ts` (new), `src/driver-kit/__tests__/driver-kit.test.ts`, `src/driver-kit/__tests__/relay.test.ts`.
      - `examples/external-agent.ts`, `examples/serve-tools.ts`: use the new members.
      - `src/__tests__/public-export-contract.test.ts`, `scripts/compat-baseline/arnilo__prism.txt`, `scripts/budgets.json`: regenerated through `bun scripts/release.mjs gate --update-baseline`. The task note records the diff, attributing additions to this plan and any removal to its plan.
      - `docs/next/packages.md`, `docs/next/drivers.md`, `CHANGELOG.md`.
    - References:
      - plan 164 Task 6 deviation 1; plan 165 Task 1 (a) and Further Actions P3; plan 159 (`packages.instances` and `state_not_ready` precedent)
  - Test Cases to Write:
    - `package_api_tools_list_returns_effective_registry`: host, kernel, and two packages' tools are listed; a disabled tool is absent. Fails if `disable` is ignored or package tools are missing.
    - `package_api_skills_get_and_list`: a package skill and a host skill are found; a disabled skill returns `undefined`.
    - `package_api_reads_throw_state_not_ready_in_setup`: calling either read inside `setup` throws `state_not_ready`.
    - `package_api_reads_are_frozen`: pushing to the list or mutating an entry throws.
    - `driver_run_context_carries_tools_skills_host_services`: an inline driver's `run` sees a tool registered by another package, a skill, the host port, and a service provided by another package.
    - `relay_command_spawns_the_relay`: `[...relayCommand(), "relay", "hook", "--run", dir]` against a stopped broker prints the descriptor's fail-closed answer.
    - `relay_command_is_absolute_kernel_path`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New `PackageAPI` members, new `DriverRunContext` members, and a new driver-kit export.
    - Docs pages to create/edit:
      - `docs/next/packages.md`: the read accessors and `state_not_ready`.
      - `docs/next/drivers.md`: the run context table and `relayCommand`.
      - `CHANGELOG.md` `## [Unreleased]`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-11):
    - **What changed.** The registry reads (`PackageAPI.tools.list`, `skills.list`/`get`, `LoadPackagesOptions.registry`, the `create-agent.ts` binding) were already in the tree from earlier work, so this task added tests for them and finished the rest. `DriverRunContext` gains `tools`, `skills`, `host`, `services` (`src/driver-kit/define.ts`); `driverPackage` builds a `DriverRuntime` from its `PackageAPI` and `createDriverLoop` takes it as a required fifth argument (`guard` is now `PolicyGuard | undefined`, no alias). `relayCommand()` is in `src/driver-kit/relay-command.ts` and exported from the driver kit. Both examples read `context.tools`/`context.skills` and `relayCommand()`; `external-agent.ts` now registers its skill through `skills: { add }`. Docs: `docs/next/packages.md`, `docs/next/drivers.md` (new "The run context" section), `CHANGELOG.md`.
    - **Tests.** New `src/__tests__/package-api-reads.test.ts` (4 tests), `driver_run_context_carries_tools_skills_host_services` in `driver-kit.test.ts`, `relay_command_is_absolute_kernel_path` and `relay_command_spawns_the_relay` in `relay.test.ts`. `src/driver-kit` + new test: 65 pass. `src/__tests__/public-export-contract.test.ts`, `package-loader`, `package-api-freeze`, `src/testing`, `packages/hosts/mcp-server`: 258 pass in total with the above. `bun run typecheck` clean. `docs.test.ts`: 164 pass / 6 fail, the same six as the Task 1 baseline. Both examples run to the same output as before.
    - **Baseline diff (`scripts/compat-baseline/arnilo__prism.txt`, against the file before this task's regeneration).** `+ relayCommand(): readonly string[]` (this task); `createDriverLoop` gains the required `runtime: DriverRuntime` argument and `guard: PolicyGuard | undefined` (this task, signature change with no alias; its only callers are `driverPackage` and the driver-kit test). `DriverRuntime` and the new `DriverRunContext` members are types and do not appear in the value-surface baseline. The file's diff against `HEAD` is larger because of earlier uncommitted regeneration, not this task.
    - **Finding for later tasks.** `bun scripts/release.mjs gate --update-baseline` runs `checkReleaseEvidence` first and stops on the unset `PRISM_TEST_POSTGRES_URL`, so it never reaches the compat step here (so the Task 1 gate baseline "exit 1" was the evidence block, not a compat result). I regenerated the one baseline by calling `runGates({ updateBaseline: true, skipTarball: true, packageName: "@arnilo/prism" })` from a scratch script. Task 3 will need the same for the new `arnilo__prism-driver-process.txt`, or the Postgres URL set.
    - **Sweep.** No name, error, or config retired; no sweep needed.

- [x] Task 3: `@arnilo/prism-driver-process` — the adapter contract, the run pipeline, and the `jsonl-stream` transport
  - Acceptance Criteria:
    - Functional: The package exports `AgentAdapter` and its part types (as confirmed by Task 1), `adapterDriver(adapter): DriverDefinition`, and `processDriver(adapter)` delegates its loop, schema, probe, profiles, and guard to `driverPackage(adapterDriver(adapter))`, with a package-local setup wrapper for the inspection service and status note. `processDriver(adapter)(spec)` is a package instance whose config is `ExternalAgentSpec` (with `vendor` validated by `adapter.vendor`) plus the driver's own keys: `binary?` (a path override), `args?`, `cwd?`, `capture?: "mapped" | "all"` (default `"mapped"`), and `graceMs?` (default 5000).
    - Functional: An invalid adapter fails at `processDriver` with `ProcessDriverError` `adapter_invalid`, naming the member. Cases: a missing `name`, `revision`, `descriptor`, `binary`, `configure`, `encode.prompt`, `decode`, or `abort`; `requests` on a `jsonl-stream` adapter; `descriptor.controls.permissionCallback` true with none of `hooks`, `requests`, or `permissionTool` (the descriptor flag is a boolean, `descriptor.ts:35`, so the channel is checked on the adapter, not read from the descriptor); `session.strategy` disagreeing with `descriptor.controls.resume`; and `assertDriverDescriptor` failures.
    - Functional: **(Task 1 amendments, findings F1–F5; the contract in API Notes is updated to match.)** (F1) `OutboundFrame` for `json-rpc` is `{ method, params?, notify?, onResult?(result): Decoded | undefined }`, so a thread-start result can supply the session id. (F1) Every `encode.*` and `open` receives `EncodeContext { sessionId?, turnId? }`, and `Decoded` gains `turnId?`, because `turn/steer` and `turn/interrupt` need the in-flight turn id. An `AbortStep` `{ rpc }` takes `params?(ctx: EncodeContext)`. (F4) `AgentAdapter` gains optional `permissionTool?: string`, which the driver passes to `serveTools` (roadmap `ServeToolsOptions.permissionTool`, `types.ts:196`). (F5) `ConfigureContext.hook` is `{ argv, command }`: `argv` is `[...relayCommand(), "relay", "hook", "--run", dir]` and `command` is its POSIX-quoted single string, because shape A's `--settings` hooks and shape C's `hooks.json` take a command string. The quoting helper lives in this package (no kernel change) with a test over spaces, quotes, and `$`. `OpenContext` also carries the selected tool definitions (`dynamicTools` in shape B) and `resume`.
    - Functional: The binary probe runs `adapter.binary.command` (or the `binary` config override) with `versionArgs` through `probeBinary`, and parses the version with `adapter.binary.version`. A missing binary or unparsable version is the kit's status note and `driver_unavailable`.
    - Functional: Per run, in order: the kit's guard lease; `assertIsolation` with the worktree bound to `run.session.id` by the `workspace` service when one is provided (otherwise `cwd`); `createRunDirectory` under the lease home; `createCallbackBroker` with the adapter's hook codec, fail-closed response, and timeout; `serveTools` when `spec.prismTools` is non-empty or the adapter names a permission tool, mounted on the broker with the run's `origin`; `materializeSkills` when `spec.skills` is set, through the layout the adapter's `configure` receives; then `adapter.configure(spec, ctx)` returns `{ args, env, files, overlays }`. Files are written through the run directory, overlays through `RunDirectory.overlay` (with `.git/info/exclude` blocks), and env through `buildChildEnv` with the modes' protected variables removed. Everything is disposed in reverse order in `finally`, whatever the outcome.
    - Functional: `jsonl-stream`: spawn with stdio pipes and the built env; send `open(ctx)` frames, then `encode.prompt(run.input)`, through `createStdinWriter`; read stdout with `readJsonl` (bounded line length); for each frame call `decode`, feed each activity to `run.observe` in order, record a `sessionId` signal, and end the turn on `turnEnd`. An invalid JSON line is unmapped. A process exit before `turnEnd` without abort fails the run with `vendor_process_exited` and the redacted stderr tail.
    - Functional: The `setup` status note and the `driver-process:<name>` service `inspect()` record the adapter name and revision, the binary path and version, the transport, the capture mode, the deployment, and the isolation mode, with no secret.
    - Functional: Enforcement rows: root `workspaces` gains `"packages/drivers/*"`; `scripts/package-truth.mjs` counts and describes the package; `src/__tests__/packaging.test.ts` lists it with `sourceExport: true`; `scripts/independent-packages.json`'s `$comment` records it as lockstep until Phase 11; `scripts/compat-baseline/arnilo__prism-driver-process.txt` is created through `bun scripts/release.mjs gate --update-baseline`; `examples/tsconfig.json` maps the package; `src/__tests__/driver-kit-vendor-neutral.test.ts` also scans `packages/drivers/process/src`.
    - Performance: No module beyond the kernel and Node built-ins loads at import. `@arnilo/prism-mcp-server` is imported only when a run needs `serveTools`. One process is spawned per run (Task 1 (f)), and its cost is stated in the README.
    - Code Quality: Layout `packages/drivers/process/{package.json, src/index.ts, src/__tests__/, README.md, CHANGELOG.md, LICENSE, tsconfig.json, bunfig.toml}`, mirroring `packages/integrations/delegate`. TypeScript source export. No vendor or binary name. The transport is selected by `adapter.transport`, with no per-vendor branches. No speculative transport beyond the two.
    - Security: Gating and secrets reuse the kit (guard, protected env stripping, broker token, redacted stderr). Adapter-returned file paths are relative and contained, and an absolute or escaping path fails with `profile_invalid` from the run directory's containment. The broker token reaches the child only through the env variable the endpoint names. A test asserts it never appears in events, `inspect()`, errors, or the status note.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 15 Scope (driver bullets, adapter contract), §2.12.7 (materialization), §2.12.10
      - `examples/external-agent.ts:160-330` (the inline driver this generalizes: run directory, broker, codec, spawn, frame queue, steer loop, signal ladder)
      - `examples/serve-tools.ts` (worktree binding, `excludeOverlay`, `serveTools` wiring)
      - `src/driver-kit/process/{jsonl,stdin,env,probe,stderr}.ts`; `src/driver-kit/materialize.ts`; `packages/hosts/mcp-server/src/serve-tools.ts`
      - `packages/integrations/delegate/package.json` (package layout precedent)
    - Options Considered:
      - Each adapter implements `start.run` with kit helpers (status quo from Phase 13). Rejected: that is the duplicated work Phase 15 exists to remove.
      - Put `processDriver` in the driver kit. Rejected: roadmap §2.12.8 and §2.13.1 place `driver-process` in a package, and the kit stays a contract.
      - A class-based adapter. Rejected: the roadmap requires plain data and functions, which `extendAdapter` can merge.
    - Chosen Approach:
      - `adapterDriver` builds a `DriverDefinition` whose `start.run` is the shared pipeline. Transports are two internal modules behind one `Transport` interface (`send`, `frames`, `close`), selected by `adapter.transport`.
    - API Notes and Examples:
      ```ts
      import { processDriver } from "@arnilo/prism-driver-process";
      import { myAdapter } from "./my-adapter.ts";

      const agent = await createAgent({
        packages: [toolsCoding({ root }), approval({ mode: "ask" }), processDriver(myAdapter)({ name: "ui-engineer", profile: "me", prismTools: ["edit"], skills: ["review"] })],
        host: { ui },
      });
      ```
    - Files to Create/Edit:
      - `packages/drivers/process/package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `tsconfig.json`, `bunfig.toml` (new)
      - `packages/drivers/process/src/index.ts`, `adapter.ts` (contract types and validation), `driver.ts` (`adapterDriver`, run pipeline), `transports/jsonl-stream.ts`, `transports/types.ts`, `errors.ts` (`ProcessDriverError` codes), `inspect.ts` (new)
      - `packages/drivers/process/src/__tests__/adapter.test.ts`, `pipeline.test.ts`, `jsonl-stream.test.ts`, `load-cost.test.ts`, plus a `fixtures/test-adapter.ts` over the neutral `jsonl-stream` dialect (new)
      - `package.json` (workspaces), `scripts/package-truth.mjs`, `src/__tests__/packaging.test.ts`, `scripts/independent-packages.json`, `scripts/compat-baseline/arnilo__prism-driver-process.txt`, `examples/tsconfig.json`, `src/__tests__/driver-kit-vendor-neutral.test.ts`, `bun.lock`
      - `CHANGELOG.md`
      - `packages/hosts/mcp-server/src/serve-tools.ts`: allow a permission-only endpoint while retaining rejection when both the allow list and permission tool are absent (prerequisite found by the new integration test).
      - `scripts/package-truth.json`, `scripts/phase24-truth.test.mjs`, `scripts/phase54-package-map.test.mjs`, `src/__tests__/public-export-contract.test.ts`, `src/__tests__/docs.test.ts`: inventory and source-export enforcement.
      - Generated inventory blocks in `README.md`, `docs/index.md`, `docs/release-and-install.md`, and `docs/_evidence/phase54-package-map.md`; no hand-authored released API documentation changes.
    - References:
      - plan 164 Task 8 (example driver), plan 165 Task 8 (serve-tools driver), plan 160 Task 4 (package layout)
  - Test Cases to Write:
    - `adapter_invalid_names_the_member`: one case per invalid shape listed above.
    - `process_driver_claims_loop_without_model`: `createAgent` with only the driver package and no model succeeds, and `inspect().slots.loop` names the adapter.
    - `vendor_options_validated_by_adapter_schema`: an unknown `vendor` key fails config validation.
    - `missing_binary_is_status_note_and_driver_unavailable`.
    - `run_pipeline_materializes_files_overlays_and_env`: the scripted binary's record shows the configured args, a written file path, and env names without protected variables; an overlay sits in the bound worktree with its exclude block, and all are removed after the run.
    - `workspace_files_adapter_without_bound_worktree_is_worktree_required`.
    - `adapter_absolute_file_path_is_rejected`.
    - `jsonl_turn_observes_every_activity_in_order`: a scripted turn of text, thinking, tool, skill, and subagent frames produces the matching events in order, then `turnEnd` completes the run.
    - `exit_before_turn_end_is_vendor_process_exited_with_redacted_stderr`.
    - `serve_tools_mounted_only_when_selected` and `mcp_server_not_loaded_without_prism_tools` (load cost).
    - `token_and_secrets_absent_from_events_inspect_and_notes`.
    - `driver_process_names_no_vendor` (the extended repo scan).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new native package.
    - Docs pages to create/edit:
      - `packages/drivers/process/README.md`: package page structure (install, configuration table, what it changes, capabilities, cost, security, and failure behavior, example). Also "The adapter contract" reference and "Process lifetime and resume" with the per-run spawn cost. Part B expands it into the authoring guide.
      - `CHANGELOG.md` `## [Unreleased]`.
    - `docs/index.md` update: generated package inventory only; navigation unchanged.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-11):
    - **What changed.** Created the source-exported `@arnilo/prism-driver-process` package with `AgentAdapter` and its part types, eager member validation, `ProcessDriverError`, `adapterDriver`, `processDriver`, inspection metadata, and the bounded JSONL transport. The shared pipeline uses the kit's profile lease, isolation check, run directory, callback broker, skill materializer, child environment, version probe, stdin writer, stderr redaction, and cleanup ladder. MCP loads only for selected tools or a permission tool. Files and overlays use kit containment and are removed in reverse-order cleanup. `open` precedes the prompt, decoded activities stay ordered, turn/session IDs are tracked, and vendor-strategy session IDs are recorded under `vendor-session`. String-valued JSON frames are JSON-encoded, including embedded newlines.
    - **Contract details for Tasks 5–6.** `RequestHandler` receives one `RequestContext` object (`params`, `run`, `host`, `bridge`, `ask`, selected tools, encoding IDs), matching Task 5's examples. `ConfigureContext` and `OpenContext` carry `ResumeContext { entries, sessionId?, args? }`; entries are empty until Task 6 wires restoration. `RelayAnswer` is derived from the public `HookCodec.encode` return type because the kit does not export that protocol type by name; no kernel change was needed. `permissionTool` maps to `serveTools({ permissionTool: { name, rewrite } })`. Task 4 still owns unmapped accounting, steering, continuations, and limit classification; Task 5 owns JSON-RPC (currently rejected with `transport_unsupported`); Task 6 replaces the interim kit cleanup ladder with the declared abort sequence and graceful post-turn wait, and completes resume. `none` writes no external state.
    - **Prerequisite and enforcement findings.** The permission-only integration test first failed with `serve_tools_empty`: the existing MCP helper rejected every empty allow list. Its shared guard now rejects only when no permission tool is provided; the existing empty-endpoint rejection test still passes. No API signature changed. The driver package and workspace are registered, the lockfile is updated, package truth is regenerated (61 publishable manifests), and source-export, package-map, vendor-neutrality, and load-cost checks cover the new package. Inventory assertions also caught stale metadata from prior package additions (evals/devtools counts and peers, observability/delegate classification); those expectations now match the manifests. Regeneration reports 35 still-retired legacy names, matching the legacy table; the docs assertion was refreshed accordingly. The new package's changelog is checked for its initial Unreleased entry rather than fabricated release history. Generated inventory blocks were refreshed despite the original task's no-docs-index note, because their consistency gates require it; no released API prose or navigation was changed.
    - **Validation.** New package: 30 pass / 0 fail. Affected driver-kit, testing, registry-read, vendor-neutrality, MCP-server, and new-package suites: 153 pass / 0 fail. Root `bun run typecheck` (including build, all workspaces, and examples) and package typecheck pass. Public exports: 107 pass / 0 fail. Package truth and package-map suites: 20 pass / 0 fail. Packaging plus public exports: 424 pass / 1 unrelated failure in `npm ls --all --depth=0`, which reports the existing root self-link as extraneous and existing `prism-core` file links as invalid; all new-package packaging checks pass. Docs with example-install/socket permissions: 164 pass / the same 6 failures recorded in Task 1. Both driver examples complete, including external-agent conformance. Biome and the vendor-name scan pass. No name, error, or config was retired, so no retirement sweep applies.
    - **Compatibility baseline.** `bun scripts/release.mjs gate --update-baseline` still stops at the recorded missing `PRISM_TEST_POSTGRES_URL` evidence. As in Task 2, `runGates({ updateBaseline: true, skipTarball: true, packageName: "@arnilo/prism-driver-process" })` generated the new `scripts/compat-baseline/arnilo__prism-driver-process.txt` successfully. Its nine new rows are `ProcessDriverError`, `ProcessDriverInspection`, `adapterDriver`, `assertAdapter`, `inspectDriver`, `jsonlStream`, `processDriver`, `quoteCommand`, and `type ProcessDriverErrorCode`; no existing baseline row was removed. The root runtime export surface is unchanged.

- [x] Task 4: Gating, stop callbacks, steering, capture, and signal classification
  - Acceptance Criteria:
    - Functional: **Relay gating.** The relay hook command passed to `configure` is `[...relayCommand(), "relay", "hook", "--run", runDir]`. The broker decodes with the adapter's codec, gates `pre-tool` through `run.ask` with `askSupport.rewrite` from `descriptor.controls.rewrite` (the shipped descriptor has no `respond` member, so response substitution remains unsupported), and encodes the answer. A rewrite the descriptor does not support is a deny with `rewrite_unsupported` (the kernel's rule). Adapters map vendor tool names through the kit's `effectsTable` (unknown names get all effects); the driver also replaces an empty callback effect list with `ALL_TOOL_EFFECTS`.
    - Functional: **Fail closed.** With the broker stopped or its socket removed, the relay prints the adapter's declared `failClosed` answer. A test covers both shapes: a non-zero exit, and a zero exit whose stdout is a deny.
    - Functional: **Stop and continue.** A `stop` hook event or a decoded `stop` signal calls `run.end()`. `{ continue: true, reason }` is encoded back (hook) or sent as `encode.continue(reason)` (a new turn), capped by `limits.maxContinuations`. Without `continueOnStop`, the driver never sends a continuation.
    - Functional: **Steer.** A `run.steers()` consumer delivers each message per `descriptor.controls.steer`: `mid-turn` sends `encode.steer` immediately; `next-turn` holds it and sends it as the next prompt after `turnEnd`; `none` observes a `notice` `steer_unsupported` and does not deliver it.
    - Functional: **Capture.** A frame `decode` marks `unmapped` (or an invalid line) is observed as `{ kind: "raw", vendor: descriptor.vendor, type, data }` under `capture: "all"`. Under `"mapped"`, it is counted, and the count is emitted once per run as an `agent.notice` (`code: "unmapped_frames"`, `level: "info"`). No frame is dropped without one of the two. Invalid lines retain the kit's existing redacted 256-character preview; valid unmapped JSON retains the complete value within the 1 MiB line cap.
    - Functional: **Signals.** Each decoded `notice` activity goes to `adapter.notices`. A returned `LimitSignal` calls `guard.noteLimit(profile, signal)`: `stop` aborts the vendor process through the ladder and ends the run with `ProcessDriverError` `vendor_limit` (naming the code); `defer` ends it with the same code carrying `deferUntil`. Nothing is retried.
    - Performance: Frames are handled in order on one queue, so a steer or an activity never overtakes the one before it. The unmapped counter is O(1) per frame. `capture: "all"` emits one event per unmapped frame, and the README states that cost and the `"mapped"` default.
    - Code Quality: Gating, stop, and steer logic is shared by both transports. `json-rpc` (Task 5) reuses it through request handlers.
    - Security: `observe` never fires `tool.call` (the kernel invariant). Only `ask` gates. A throwing codec or adapter `notices` fails closed: the broker answers `failClosed`, and a throwing `notices` stops the run. `rewrite` input passes only where the descriptor declares it.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.9 K2 (`ask`, `run.end`, `steers`), §2.12.5 rule 4, §2.12.7 capture table
      - `src/driver-kit/broker.ts:80-261`, `src/driver-kit/guard.ts:150-160`, `src/loop/run-controller.ts` (`ask`, `end`, `steers`), `examples/external-agent.ts:218-300`
    - Options Considered:
      - Let each adapter decide what to do with unmapped frames. Rejected: "nothing is dropped silently" is a driver guarantee.
      - Retry after a rate-limit `deferUntil`. Rejected: §2.12.5 rule 4 forbids a retry loop.
    - Chosen Approach:
      - One shared run-state module (`turn.ts`) owns the frame queue, the steer consumer, the stop/continue loop, the capture counter, and signal handling. Transports only move frames.
    - API Notes and Examples:
      ```ts
      decode(frame) {
        if (frame.type === "limit") return { activity: [{ kind: "notice", level: "error", code: "rate_limit", message: "limit reached" }] };
        if (frame.type === "done") return { activity: [], turnEnd: true };
        return { activity: [], unmapped: true };
      },
      notices: (activity) => (activity.kind === "notice" && activity.code === "rate_limit" ? { code: "rate_limit" } : undefined),
      ```
    - Files to Create/Edit:
      - `packages/drivers/process/src/turn.ts` (new), `driver.ts`, `transports/jsonl-stream.ts`, `errors.ts`
      - `packages/drivers/process/src/__tests__/gating.test.ts`, `turn.test.ts`, `signals.test.ts` (new; steering and capture cases consolidated in the shared-state suite)
      - `packages/drivers/process/README.md`, `CHANGELOG.md`
    - References:
      - plan 164 Tasks 4 and 6; plan 163 Task 1 (`ask` suspension rule)
  - Test Cases to Write:
    - `relay_gate_allows_and_denies_through_ask`: an allowed and a denied write via the scripted binary's command hook, with a scripted `HostUi`.
    - `relay_fails_closed_with_nonzero_exit` and `relay_fails_closed_with_printed_deny`.
    - `rewrite_unsupported_is_deny` and `rewrite_supported_passes_updated_args`.
    - `stop_continue_is_capped_by_max_continuations`.
    - `steer_mid_turn_delivered_immediately`, `steer_next_turn_held_until_turn_end`, `steer_none_observes_steer_unsupported_notice`.
    - `unmapped_frames_reach_agent_raw_under_capture_all` and `unmapped_frames_counted_under_capture_mapped`.
    - `rate_limit_stops_without_retry` and `quota_defer_carries_defer_until`: the binary is spawned once.
    - `throwing_notices_classifier_stops_the_run`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Gating, steer, capture, and signal behavior of the package.
    - Docs pages to create/edit:
      - `packages/drivers/process/README.md`: "Gating and fail-closed responses", "Steering", "Capture and unmapped frames" (with the `capture: "all"` cost), "Rate limits and quotas".
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-11):
    - **Implementation.** Added `turn.ts` for one ordered queue shared by decoded frames, broker callbacks, and host steering. It handles stop/continue, all three steering modes, raw capture/accounting, session/turn IDs, and notice classification. Broker gating keeps the kernel's rewrite gate and supplies all effects for empty callback effect lists. Stop callbacks use the same descriptor-aware `end` path as decoded stops. Valid raw values and callback observations are redacted.
    - **Limits and cleanup.** Classifiers report to the existing `driver-kit:<name>` guard service. `vendor_limit` carries `deferUntil` both on `ProcessDriverError` and in its message, since the kernel's serialized error record does not preserve arbitrary error properties. The child is stopped without retry; signal/stdin abort steps run before the fallback ladder for classified limits. Classifier exceptions fail the run and reap the child. Task 6 still owns RPC abort steps, the shared hard deadline, and the full abort/resume contract.
    - **Contract findings.** `DriverDescriptor.controls` has no `respond` field; this task leaves response substitution fail-closed rather than adding a kernel API. `readJsonl` deliberately bounds invalid-line previews to 256 characters; capture documents and retains that bound. Updated the acceptance text accordingly. Unknown tool effects remain the codec's mapping responsibility through `effectsTable`, with the driver's conservative empty-list fallback. No adapter API, dependency, or kernel export was added.
    - **Validation.** Root `bun run typecheck` (build, workspaces, examples) and package typecheck pass. Process package plus broker, relay, driver primitives, and vendor-neutrality: **84 pass / 0 fail**. New tests cover allow/deny, supported/unsupported rewrite, codec failures and missing sockets with both fail-closed exit shapes, continuation caps, steering modes, mapped/raw capture, all four limit classes and deferral metadata, and real child termination without another spawn. Existing primitive tests prove `observe` does not fire `tool.call`. Biome passes for all changed TypeScript files. Integration tests ran with local socket permissions after the sandbox refused broker listeners.
    - **Docs and compatibility.** Updated package README and package/root changelogs. No exports moved or were retired, so no baseline regeneration or retirement sweep applies. Consolidated steering/capture tests in `turn.test.ts`; reused existing broker/relay/primitive tests instead of duplicating their infrastructure. Whole-plan docs/release checks remain for later tasks, with the Task 1 baseline unchanged.

- [x] Task 5: The `json-rpc` transport and server-to-client request handlers
  - Acceptance Criteria:
    - Functional: `json-rpc` spawns the binary and runs `createJsonRpcPeer` over stdio. `open(ctx)` requests run in order, and their results go to `decode` for a `sessionId`. Prompts, steers, and continuations are requests built by `encode`. Notifications are decoded into activity and turn signals through Task 4's run state.
    - Functional: Every server-to-client request is answered by `adapter.requests[method]`. A handler receives `{ params, run, host, bridge, ask }`: `ask` routes an approval to `run.ask`, `host.ui` takes questions and elicitation, and `bridge` (from `bridgeTools` over `spec.prismTools`) runs a client tool call through `run.executeTools`. A request whose method has no handler fails the run with `ProcessDriverError` `vendor_request_unhandled`, naming the method. The peer's `onUnhandled` (`src/driver-kit/process/json-rpc.ts:13`) triggers it, after the error response is written.
    - Functional: A handler that throws answers a JSON-RPC error and fails the run with `vendor_request_failed`. An approval handler that cannot reach a UI resolves through the kernel rule: a deny with `non_interactive`, or a suspension on a resumable loop.
    - Performance: Requests are handled concurrently up to 8 handlers (matching `serveTools`' default call bound; the callback broker itself has no handler-count bound). Excess requests receive an error and fail the run. At most 256 notification/result frames wait for consumption. Notifications keep frame order through the shared queue.
    - Code Quality: The transport reuses the kit's peer and Task 4's run state. Request-handler types are exported for adapter authors.
    - Security: An approval answered through a request handler goes through `run.ask`, so `tool.call` fires with `origin`. A bridged client tool call goes through `run.executeTools`. No handler gets the broker token.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.4 (app-server lifecycle, requests), Phase 15 Scope (`json-rpc` bullet, `requests`)
      - `src/driver-kit/process/json-rpc.ts:6-103`; `src/testing/scripted-dialects/json-rpc.ts` (approval requests as `hook.via: "client"`)
    - Options Considered:
      - Default-allow unknown requests. Rejected: Scope says an unknown request fails the run.
      - Give handlers the raw peer. Rejected: handlers would bypass the queue and the `ask` gate.
    - Chosen Approach:
      - A thin transport over `createJsonRpcPeer`, plus a handler context that offers only gated paths.
    - API Notes and Examples:
      ```ts
      requests: {
        "approval/request": async ({ params, ask }) => {
          const decision = await ask({ toolCallId: params.id, name: params.tool, args: params.args });
          return { decision: "allow" in decision && decision.allow ? "accept" : "decline" };
        },
        "tool/call": async ({ params, bridge }) => ({ result: (await bridge.invoke(params.call)).value }),
      },
      ```
    - Files to Create/Edit:
      - `packages/drivers/process/src/transports/json-rpc.ts` (new), `transports/types.ts`, `turn.ts`, `driver.ts`, `errors.ts`; reuse the `RequestContext`/`RequestHandler` types already exported by Task 3.
      - `src/driver-kit/process/json-rpc.ts`, `src/driver-kit/__tests__/helpers.test.ts`: optional concurrent dispatch, post-response error reporting, and malformed/unknown-frame capture (small prerequisite discovered during implementation).
      - `packages/drivers/process/src/__tests__/json-rpc.test.ts` (new), plus a `json-rpc` test adapter fixture
      - `packages/drivers/process/README.md`, `CHANGELOG.md`
    - References:
      - plan 164 Task 3 (peer), Task 7 (`json-rpc` scripted dialect)
  - Test Cases to Write:
    - `json_rpc_open_requests_run_before_prompt`.
    - `json_rpc_approval_request_routes_to_ask`: allow and deny reach the binary's record.
    - `json_rpc_unknown_request_fails_run`: `vendor_request_unhandled` names the method.
    - `json_rpc_handler_throw_fails_run`.
    - `json_rpc_client_tool_call_runs_through_execute_tools`: `tool.call` fires with `origin`.
    - `json_rpc_question_routes_to_host_ui`.
    - `json_rpc_notifications_observed_in_order`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A transport and the handler contract.
    - Docs pages to create/edit:
      - `packages/drivers/process/README.md`: "Transports" and "Server-to-client requests".
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-11):
    - **Implementation.** Added the JSON-RPC stdio transport over `createJsonRpcPeer`, selected by the existing adapter transport field. Opening requests run sequentially; notifications received before each reply are applied before that result and before the next request/prompt. Raw results use `decode`; `onResult` can map or ignore acknowledgements. Normal turn/steer/continuation requests keep the reader active while replies are outstanding. Results and notifications reuse Task 4's ordered frame processing, including stop, capture, IDs, and notice classification. An unmapped `onResult` retains its original raw result for capture.
    - **Gated handlers.** Own-property lookup rejects unknown methods, including inherited object names. Handlers receive the existing public context with descriptor-aware `ask`, host UI, and a `bridgeTools` bridge limited to `spec.prismTools`. The process package declares `host-ui` when handlers exist; the first question test exposed that missing capability. Errors are redacted before the peer writes its error response, then fail the run with `vendor_request_unhandled` or `vendor_request_failed`. Initialization races its pending request against transport failure so a callback error cannot leave it hanging. A fatal request closes admission before another handler can begin. No handler receives the peer or broker token.
    - **Small prerequisite and bounds.** The shipped peer awaited each handler and had no post-response failure callback, so it could not satisfy concurrent requests or fail the driver after writing an error. Added optional `maxConcurrentRequests`, `onRequestError`, and `onInvalid` options; existing callers keep serialized dispatch by default. `onUnhandled` now runs after the error response, also for a handler's `JsonRpcError(-32601)`. The process transport uses 8 concurrent handlers (the existing `serveTools` default) and 256 queued frames, failing closed at either bound. Updated the acceptance text because the broker has no count bound to reuse. Line byte caps are unchanged.
    - **Validation.** Root `bun run typecheck` (build, workspaces, examples), package typecheck, and Biome pass. Broad affected suites (`packages/drivers/process`, `src/driver-kit`, `src/testing`, driver primitives, vendor-neutrality, public exports, MCP server): **307 pass / 0 fail**. After the initialization-order fix, JSON-RPC plus MCP: **57 pass / 0 fail**; after raw-result capture, JSON-RPC plus shared turn state: **28 pass / 0 fail**; the final JSON-RPC suite, including refusal of new handlers after a fatal request: **18 pass / 0 fail**. New tests prove handshake order and session propagation, allow/deny and external origin, no-UI suspension, host questions, bridged tool execution, unknown/inherited methods, throwing/redacted handlers, failure during initialization, ordered notifications, result-only turn completion, capture, and bounded backlog. Peer tests prove response reads continue during concurrent handlers, overflow fails closed, and error responses precede failure callbacks. Socket integration tests used the same local-socket permissions as Task 4.
    - **Docs and compatibility.** Updated package README and package/root changelogs. Request-handler types were already exported, and no export moved or new value export was added; compatibility baselines need no regeneration. Removed the temporary `transport_unsupported` error code now that both transports run; retirement scan over existing `src/`, `packages/`, `scripts/`, `examples/`, and current `docs/` (excluding generated/history/evidence files) has no hits. Task 6 retains full abort/deadline and resume ownership. Whole-plan docs/release verification remains for later tasks.

- [x] Task 6: Abort ladder, resume strategies, and the revision check
  - Acceptance Criteria:
    - Functional: On `run.signal` abort, the driver runs `adapter.abort` steps in order (`{ rpc: method }` sends a JSON-RPC notification, `{ closeStdin: true }`, `{ signal }`), waiting up to `graceMs / (steps + 2)` between steps to reserve fallback time, then `signalLadder` to SIGKILL. The process is gone within `graceMs` on both transports.
    - Functional: **`store`.** After each turn, `adapter.session.archive(ctx)` returns entries appended to `run.state("vendor-session")` (K5, bounded and redacted by the kernel). On a run whose session already holds entries, `adapter.session.restore(entries, ctx)` writes files into the run directory and returns extra `args`, which `configure`'s `ctx.resume` receives. A conversation resumes in a new process from Prism's store.
    - Functional: **`vendor`.** A decoded `sessionId` is appended to `run.state("vendor-session")`, and the next run passes it as `ctx.resume.sessionId`.
    - Functional: **`none`.** No state is written, and every run starts fresh.
    - Functional: A resume under a different binary major version fails with `driver_revision_mismatch` (the kit's snapshot check, `define.ts:187-198`). The adapter revision joins the loop `revision`.
    - Functional: **(Task 1 amendment, finding F3.)** `archive(ctx)` and `restore(entries, ctx)` receive `{ runDir, home, cwd, sessionId? }`, where `home` is the lease's profile home and `sessionId` is the one `decode` recorded. A transcript lives under the profile home (shape A: `<config>/projects/<encoded-cwd>/<id>.jsonl`), so the adapter must be able to name it. The driver refuses any archived path that matches a mode's `protected.paths` and fails the run with `profile_invalid`.
    - Functional: **(Task 1 amendment, finding F2.)** After the final `turnEnd` the driver shuts the process down gracefully: close stdin, wait up to `graceMs`, then `signalLadder`. This is separate from `adapter.abort`, which runs on `run.signal` abort and classified vendor limits. Both `jsonl-stream` and `json-rpc` use it.
    - Performance: `archive` runs once per turn. K5's `external_state_limit` bounds storage, and the README states the per-turn write and the adapter-selected `none` strategy that avoids it.
    - Code Quality: Strategies are selected by `adapter.session.strategy`, which Task 3 already checks against the descriptor.
    - Security: Restored files go only into the run directory through its containment. Archived entries pass the kernel's redaction. Declared protected credential paths are rejected in archived strings and keys. Adapters are trusted host code and must exclude credential contents from opaque transcript data; opaque JSON has no source provenance. A test archives a profile home containing a canary file and asserts the canary token is absent from the stored entries.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.7 "Sessions and resume", §2.12.9 K5, Phase 15 Scope (resume, abort)
      - `src/loop/types.ts:133-142` (`state`), `src/driver-kit/process/signals.ts:12`, `src/driver-kit/define.ts:185-198`
    - Options Considered:
      - Keep vendor session state in the profile home only. Rejected: `store` resume must work from Prism's store in a new process.
      - SIGKILL immediately on abort. Rejected: the adapter's graceful steps (an RPC interrupt, closing stdin) let the vendor flush its state.
    - Chosen Approach:
      - Separate K5 keys for vendor entries and revision provenance, with strategy functions on the adapter and a stepwise ladder with a hard deadline.
    - API Notes and Examples:
      ```ts
      session: {
        strategy: "store",
        archive: async ({ runDir }) => [await Bun.file(`${runDir.path}/transcript.jsonl`).text()],
        restore: async ([transcript], { runDir }) => ({ files: [{ path: "transcript.jsonl", content: String(transcript) }], args: ["--resume-file", "transcript.jsonl"] }),
      },
      abort: [{ signal: "SIGINT" }, { signal: "SIGTERM" }],
      ```
    - Files to Create/Edit:
      - `packages/drivers/process/src/abort.ts`, `session.ts` (new), `driver.ts`, `turn.ts`, `adapter.ts` (the existing transport send contract needs no change)
      - `packages/drivers/process/src/__tests__/abort.test.ts`, `resume.test.ts` (new)
      - `src/driver-kit/process/stdin.ts`, `src/driver-kit/__tests__/helpers.test.ts`: idempotent disposal after process shutdown
      - `packages/drivers/process/src/__tests__/fixtures/harness.ts`: cross-agent adapter reuse
      - `packages/drivers/process/README.md`, package and root `CHANGELOG.md`
    - References:
      - plan 163 Task 7 (K5), plan 164 Task 2 (revision snapshot)
  - Test Cases to Write:
    - `abort_within_grace_jsonl` and `abort_within_grace_json_rpc`: a `{ wait: 30000 }` script ends within `graceMs`, and the record shows the ladder's steps in order.
    - `store_resume_restores_into_new_process`: run 1 archives; run 2 (a new agent and process, same store) restores, and the binary record shows the restore args.
    - `vendor_resume_passes_recorded_session_id`.
    - `none_resume_starts_fresh`.
    - `binary_major_change_is_driver_revision_mismatch`.
    - `archive_never_holds_canary`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Resume and abort behavior.
    - Docs pages to create/edit:
      - `packages/drivers/process/README.md`: "Abort" and "Process lifetime and resume" (strategies and their write cost).
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-11):
    - Implemented shared abort and session helpers, graceful final flushing, per-turn archives, automatic restore arguments, vendor-ID resume, and zero state writes for `none`. Abort can preempt final flushing. Store restore rejects environment/overlay changes and confines files to the run directory.
    - Revision provenance uses a separate `driver-revision` K5 key before launch; normal subsequent runs across agents now reject changed binary majors or adapter revisions, supplementing the kit's snapshot check. Adapter revision already participates in loop revision. Existing entries lacking provenance fail closed.
    - Acceptance clarifications: reserve two abort slices for fallback rather than spending the full budget on adapter steps; RPC interrupts are notifications. Classified limits retain Task 4's abort behavior. There is no implicit `none` default: the adapter declares its strategy. Protected path checks and kernel redaction cannot infer the origin of arbitrary opaque strings returned by trusted adapter code; the README states that boundary.
    - Investigation found stdin disposal could hang after graceful shutdown because `end` on a destroyed stream never called its callback. The shared writer now closes idempotently, covered by a regression test. Earlier short-timeout runs also hit startup timeouts under build load; the final serial run used the plan's `--timeout=0`.
    - Verification: 332 tests passed, 0 failed across 26 files: process package, driver-kit, testing/conformance, driver primitives, external state, vendor neutrality, public exports, and MCP server. Root `bun run typecheck` passed; package typecheck passed after the final abort changes. Tests cover both transport deadlines/order, normal flush, abort during flush, new-agent store restore, all strategies, major-version mismatch, protected-path canary, containment, per-turn writes, redaction, and state byte caps.
    - Updated package README and both changelogs. No export moves/removals, retired names, dependency additions, or baseline regeneration. Whole-plan release/docs gates remain in the plan's final verification; Task 7 remains open.

- [x] Task 7: `extendAdapter(base, overrides)`
  - Acceptance Criteria:
    - Functional: `extendAdapter(base, overrides)` returns a new adapter. `overrides` may replace any member, or wrap a function member with a `(base) => fn` form, for example `decode: (baseDecode) => (frame) => …` or `configure: (baseConfigure) => async (spec, ctx) => ({ ...(await baseConfigure(spec, ctx)), args: [...] })`. Top-level function overrides use `(base) => fn` to wrap and `{ replace: fn }` to replace explicitly. Object members merge one level deep; descriptor sections (`controls`, `capture`, `auth`) merge one level. Arrays (`abort`, auth modes, and other arrays) replace in full. Nested function members replace directly. Wrapping an absent optional function fails with `adapter_invalid`. `name` and `revision` are required in `overrides`.
    - Functional: The merged adapter is validated like any adapter (`adapter_invalid`). A descriptor override may only narrow the base's auth policy: it may remove modes, remove deployments, or add acknowledgements, and widening fails with `adapter_invalid` `policy_widened`. `requires` is re-checked against the merged descriptor at `setup`.
    - Functional: The merged adapter records `extends: { name, revision }`, which the status note and `driver-process:<name>` `inspect()` show next to its own name and revision. Chains are supported and list every base.
    - Performance: Merging runs once at definition time.
    - Code Quality: No inheritance or classes; plain object merge with explicit wrap forms. The base adapter is not mutated, and a test asserts it is frozen.
    - Security: Narrowing-only policy merges keep an extension from enabling a deployment the base author refused. A protected path or variable removed by an override fails with `policy_widened`.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 15 Scope "Extending adapters" and Done (`extendAdapter` replaces a decoder and narrows a policy, and `inspect()` shows both)
      - `src/driver-kit/descriptor.ts:99-124` (`assertDriverDescriptor`)
    - Options Considered:
      - A deep merge of everything. Rejected: merging functions and arrays implicitly hides which side wins.
      - Allow policy widening. Rejected: the base author owns the vendor's terms (§2.12.16), so an extension may only restrict.
    - Chosen Approach:
      - Explicit replace-or-wrap per member, plus a policy comparator that rejects widening.
    - API Notes and Examples:
      ```ts
      const mine = extendAdapter(baseAdapter, {
        name: "@acme/prism-adapter-foo-extended",
        revision: "1",
        configure: (base) => async (spec, ctx) => { const plan = await base(spec, ctx); return { ...plan, args: [...plan.args, "--quiet"] }; },
        decode: (base) => (frame) => (isDiffFrame(frame) ? { activity: [toFileActivity(frame)] } : base(frame)),
        descriptor: { auth: { modes: baseAdapter.descriptor.auth.modes.filter((mode) => mode.kind === "api-key") } },
      });
      ```
    - Files to Create/Edit:
      - `packages/drivers/process/src/extend.ts` (new), `index.ts`, `inspect.ts`
      - `packages/drivers/process/src/__tests__/extend.test.ts` (new), `src/__tests__/public-export-contract.test.ts` (named API expectation)
      - `scripts/compat-baseline/arnilo__prism-driver-process.txt` (regenerated; diff in the note)
      - `packages/drivers/process/README.md`, `CHANGELOG.md`
    - References:
      - Task 3 (validation), Task 1 (contract)
  - Test Cases to Write:
    - `extend_replaces_decoder_for_raw_frames`: a frame the base sends to `agent.raw` becomes an `agent.file` event under the extension.
    - `extend_wraps_configure_adds_flag`.
    - `extend_narrows_policy_and_hosted_fails`: removing hosted from a mode makes `deployment: "hosted"` fail with `plan_login_not_permitted`.
    - `extend_widening_policy_is_rejected`.
    - `inspect_names_base_and_extension`.
    - `extend_does_not_mutate_base`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new export.
    - Docs pages to create/edit:
      - `packages/drivers/process/README.md`: "Extending an adapter".
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-11):
    - Added `extendAdapter`/`AdapterOverrides`, recursive `AdapterIdentity` ancestry, and inspection output for every base. Definition-time shallow merges leave frozen base inputs unchanged. Merged adapters pass the shared validator; setup already checks `requires` through driver-kit. Optional `open`/`notices` now also receive function validation.
    - Resolved two contract ambiguities in the acceptance text and README: bare top-level function overrides wrap; `{ replace: fn }` replaces without executing the replacement at definition time; absent optional functions must use replacement. Arrays replace in full rather than merging by index. Nested function members replace directly.
    - Policy comparison matches modes by name and rejects added modes/deployments, changed auth kind/home relocation variable, removed acknowledgements, and removed protected paths/environment variables with `adapter_invalid: policy_widened`. Tests also cover removed modes and added acknowledgements. Adapters remain trusted host code; post-definition policy mutation is outside the contract.
    - Updated package README and package/root changelogs, plus the public-export contract's named API expectation. No dependency addition, export removal/move, or retired-name sweep was needed. Vendor-neutrality scan has no hits.
    - Root `bun run typecheck` (including core build, workspace and example checks), package typecheck, and Biome passed. Eight new extension tests cover raw-to-file mapping, wrapper flags, one-time factories, chain inspection/status notes, policy refusal, setup `requires`, frozen base immutability, shallow request/object merges, array replacement, and invalid optional functions. Public-export suite: 107 pass, 0 fail. Both whole-plan offline examples passed (reference JSON-RPC conformance has its existing no-relay skip).
    - Final serial affected suites: **220 pass / 0 fail** across 25 files (process package, driver-kit, testing/conformance, package registry reads, vendor-neutrality, MCP server). Together with the export suite, **327 tests passed**.
    - Whole-plan docs: 164 pass / 6 fail, matching Task 1's baseline. The initial concurrent run also timed out a demo; a standalone permitted rerun passed, and the full permitted docs rerun restored the six-failure baseline. Do not overlap its demo compiler with source-package tests: emitted JS creation/cleanup caused transient missing-file imports in an intermediate rerun.
    - Packaging guard exposed four failures outside this task: emitted source JS in the existing MCP client/server and ACP packages, plus existing invalid/extraneous workspace dependency links. Process-package packaging assertions passed. The first broad run additionally failed the expected public export list; adding `extendAdapter` fixed it and all 107 export tests passed on rerun. The release gate still stops at missing Postgres evidence, as in Task 1.
    - `bun scripts/release.mjs gate --update-baseline` is blocked before compatibility work by that evidence check. Regenerated only the process package via the same exported `runGates` engine (`version: "0.12.1"`, `packageName: "@arnilo/prism-driver-process"`, `updateBaseline: true`, `skipTarball: true`); a second comparison with updating disabled passed. Baseline additions below include four existing Task 4–6 internal declarations surfaced by the baseline scanner, plus Task 7's function/type re-export. No removals or changed existing signatures:

    ```diff
    +createTurn	export declare function createTurn(adapter: AgentAdapter, ctx: DriverRunContext<ProcessDriverConfig>, redact: <T>(value: T) => T, beforeNextTurn?: (encoding: import("./adapter.js").EncodeContext) => Promise<void>):
    +extendAdapter	export declare function extendAdapter(base: AgentAdapter, overrides: AdapterOverrides): AgentAdapter
    +jsonRpc	export declare function jsonRpc(child: ChildProcessWithoutNullStreams, adapter: AgentAdapter, ctx: DriverRunContext<ProcessDriverConfig>, encoding: EncodeContext, redact: <T>(value: T) => T): Transport
    +processSession	export declare function processSession(adapter: AgentAdapter, ctx: DriverRunContext<ProcessDriverConfig>, context: SessionContext, redact: <T>(value: T) => T): Promise<
    +processShutdown	export declare function processShutdown(child: ChildProcessWithoutNullStreams, exited: Promise<void>, adapter: AgentAdapter, transport: Transport, encoding: EncodeContext, graceMs: number):
    +type AdapterOverrides	export { type AdapterOverrides, extendAdapter } from "./extend.js"
    ```

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/driver-kit src/testing src/__tests__/package-api-reads.test.ts src/__tests__/driver-kit-vendor-neutral.test.ts`
- `cd packages/drivers/process && bun run typecheck && bun run test`
- `cd packages/hosts/mcp-server && bun run test`
- `bun test --timeout=0 src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun examples/external-agent.ts --conformance && bun examples/serve-tools.ts`
- `rg -n -i '\b(claude|codex|agy|antigravity|gemini)\b' packages/drivers/process/src` (no hits)
- `bun scripts/release.mjs gate` (no new failure beyond Task 1's baseline)

## Compromises Made

- No deferred Task 7 implementation. The ambiguous replace-or-wrap syntax is resolved explicitly: bare top-level function overrides are wrapper factories, `{ replace: fn }` replaces, and arrays replace in full. Nested function members replace directly. This is documented and tested; it avoids executing adapter functions to guess their intent.
- Whole-plan verification remains blocked by existing docs/release evidence and packaging/dependency-tree failures outside Task 7; implementation completion does not imply release readiness. Follow-up recorded in plans/backlog.md.

Recorded in plans/backlog.md.

## Further Actions

- **P2 — Restore Phase 15 Part A whole-plan verification.** Resolve the six existing docs failures, the packaging guard's denied emitted source files in `@arnilo/prism-mcp`, `@arnilo/prism-mcp-server`, and `@arnilo/prism-acp`, and the existing invalid/extraneous workspace dependency links reported by `npm ls`. Supply the required Postgres release evidence before rerunning the full release gate. These are outside the extension implementation; the process package's compatibility check passes independently. Recorded in plans/backlog.md.
- **Part B handoff (plan 167, already planned).** Retain Task 1's unresolved `adapterConformance` placement decision and dated-research follow-ups. Part A does not implement Part B's examples, conformance helpers, or authoring guide. **Closed by plan 167 (2026-10-12):** Part B shipped `adapterConformance`, the three reference adapters, the external-host proof, the authoring guide, and `examples/custom-adapter.ts`; the dated research was re-verified and re-read on 2026-10-12 in the guide's worked mappings.

Recorded in plans/backlog.md.
