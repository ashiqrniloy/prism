# Prism Agent SDK (`@arnilo/prism-agent-sdk`)

## Objectives

- Ship a new package `@arnilo/prism-agent-sdk` that systematically assembles an agentic runtime from existing Prism seams: one `defineAgent(config)` call returns configured agent + session factory + disposal, with **no new runtime mechanics** — assembly only over `createAgent` / `createAgentSession` / registries / loaders that already exist.
- Make every capability plane optional and replaceable: tools (plane factories, name-based exclude, name-keyed replace, host additions), skills (`.agents/` discovery), instructions (`AGENTS.md`/`SYSTEM.md` loaders), MCP client bridges, hooks (`hooks.json`), session stores, agent loop. `planes: {}` + no MCP = bare loop + session (the "disable everything" case).
- Define a deterministic tool-plane resolution pipeline (`plane factories → exclude → replace → add → MCP bridges → registry`) as the non-opinionated core that Prism Code (plan 135) and third-party agent apps build on.
- Keep `@arnilo/prism` untouched: the SDK is a host-facing consumer of public exports only; no runtime internals imported, client-neutrality gate stays green for root.
- Expose reusable, opt-in composition for host-provided commands and session capabilities so Prism Code can reuse wiki commands, web tool planes, coding compaction and observational memory without putting TUI, login, credential storage, or provider-specific routing into the SDK.

## Expected Outcome

- `bun add @arnilo/prism-agent-sdk`; `defineAgent(barePreset({ model, provider }))` yields a runnable agentic loop with zero tools; `defineAgent(codingPreset(...))` yields the full coding plane; a config that excludes `shell`, replaces `read`, and adds one host tool resolves deterministically and dispatches through the normal tool harness.
- Tool plane has a documented, tested ordering contract; replacement by name preserves ACP `tool_call` classification (tools carry explicit `kind`).
- Skills, instruction layers, hooks, and MCP servers wire through config objects that delegate to `discoverContributions`, `loadSystemPromptFiles` / node `agent-definitions`, `@arnilo/prism-hooks`, and `connectMcpTools` respectively — the SDK re-implements none of them.
- `docs/agent-sdk.md` follows the required API page structure, `docs/index.md` gains one entry, `examples/agent-sdk-*.ts` typechecks, package builds/tests/packs like every other workspace package, and `release:gate` is green with compat baseline regenerated for the new package.
- Hosts may supply web tool planes (`createObscuraWebTools` or `createWebTools`) and wiki `CommandDefinition`s without the SDK importing web/wiki packages by default. Prism Code owns login, live model selection, persistent credentials, session picker and UI.

## Tasks

- [x] Task 1 (P0 prerequisite): Primitive review — inventory assembly seams the SDK consumes
  - Acceptance Criteria:
    - Functional: review doc at `docs/history/134-prism-agent-sdk-primitive-review.md` inventories, with file:line references: `createAgent`/`createAgentSession` (`src/index.ts` exports), `createToolRegistry`/`filterTools`/`selectRunTools` (`src/tools.ts:110`,`:135`,`:183`), `resolveLoop`/`singleShotLoop` (`src/agent-loops.ts`), `createSkillRegistry`/`resolveActiveSkills` (`src/skills.ts:12`,`:37`), `discoverContributions` (`src/node/contribution-discovery.ts:15-46`), `registerDiscoveredContributions` (`src/contributions.ts`), `loadSystemPromptFiles` (`src/node/system-project-prompts.ts` via `./node/system-prompts`), `discoverAgentBundles` + `AGENTS.md` loading (`src/node/agent-definitions.ts:28`,`:323`), `registerDiscoveredInstructionInjectors` (`./node/instruction-injectors`), `createPathTrustPolicy` (`./node/trust`), `connectMcpTools` (`packages/mcp/src/bridge.ts:44`), hooks adapter (`packages/hooks`), session stores (`./node/session-store-jsonl`, `@arnilo/prism-core/sessions/sqlite`), coding tool factories (`packages/prism-coding-tools/agent`).
    - Functional: doc states which seams are already public subpath exports vs internal-only (verifies each import resolves from the published export map, not repo-relative paths); any internal-only seam needed by the SDK is flagged with a proposed minimal public-export addition as a follow-up, not absorbed silently.
    - Code Quality: doc records the assembly precedent — `src/cli-runner.ts` (~L382-421: trust policy, `.agents` discovery, AGENTS.md auto-load) and `packages/acp-agent/src/index.ts` (config → wiring) — as the two existing assemblers this package generalizes.
    - Security: doc restates trust boundaries the SDK must preserve: workspace/app-config roots trust-gated independently, discovery output inert until host registers it, MCP allow policy fail-closed, no credential material in SDK config beyond refs.
  - Approach:
    - Documentation Reviewed:
      - `docs/customization.md` (full seam table), `docs/coding-agent-tools.md` (factory inventory), `docs/agent-loops.md`, `docs/acp-agent.md` (config-as-trust-boundary pattern), `.agents/skills/create-plan/references/prism-wiki.md` (review doc placement in `docs/history/`)
      - `src/cli-runner.ts:L43-90` (CliOptions discovered-contribution threading), `packages/acp-agent/src/config.ts` (unknown-key rejection precedent)
    - Options Considered:
      - Write the package first, review after. Rejected: rule 6 requires primitive-first for new packages; cli-runner/acp-agent divergence must be caught before a third assembler appears.
      - Extend root `src/` with the assembly directly. Rejected: root stays client-neutral (`scripts/check-client-neutrality.mjs`); the SDK is a node host concern and several existing `node/` subpaths prove the layering.
    - Chosen Approach: standalone review doc; conclusions constrain Task 2-4 design; deviations recorded in task notes.
    - API Notes and Examples: none — analysis only.
    - Files to Create/Edit:
      - `docs/history/134-prism-agent-sdk-primitive-review.md`: new review document
    - References:
      - `docs/history/130-cyclic-workflows-primitive-review.md`, `docs/history/133-review-remediation-primitive-review.md` (house format)
  - Test Cases to Write:
    - none — documentation task
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — analysis only, except flagged export additions recorded as follow-ups if found.
    - Docs pages to create/edit: `docs/history/134-prism-agent-sdk-primitive-review.md` (history archive per wiki rules).
    - `docs/index.md` update: no — history archive, no navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (current-line vs history rule).

- [x] Task 2: Package scaffold + tool-plane resolver (`resolveToolPlane`)
  - Acceptance Criteria:
    - Functional: new workspace package `packages/agent-sdk` (`@arnilo/prism-agent-sdk`, `type: module`, tsc build via `scripts/with-build-lock.mjs`, tests under `src/__tests__` compiled to `dist` and run with `bun test --parallel=4 --timeout=0 dist`, matches sibling package.json conventions incl. `pack:dry-run`).
    - Functional: `resolveToolPlane(options)` exported with `options: { planes?: Record<string, readonly ToolDefinition[] | (() => readonly ToolDefinition[])>, exclude?: readonly string[], replace?: Readonly<Record<string, ToolDefinition>>, add?: readonly ToolDefinition[] }` → returns ordered `readonly ToolDefinition[]`. Order: planes (declaration order) → drop `exclude` names → swap `replace` entries at their original index → append `add`. Unknown `exclude`/`replace` names fail closed with `AgentSdkConfigError` (`ERR_PRISM_AGENT_SDK_CONFIG`), naming the unknown name. `replace` key must match the replacement's `name` or fail closed (name/shape stability for ACP classification).
    - Functional: duplicate-name policy delegates to `createToolRegistry` (`DuplicateRegistrationOptions`); resolver itself never silently dedupes.
    - Performance: resolution is a single pass, O(tools); zero provider/network at resolution time; resolver is pure (no I/O) — plane factories are called by the caller (`defineAgent`), not mid-pipeline.
    - Code Quality: resolver is one pure function + types module; no class, no global state. Biome clean, typed against root `ToolDefinition` only.
    - Security: planes resolved from host-supplied values only; no filesystem/env access inside resolver; error messages bounded (no config value echo beyond the offending name).
  - Approach:
    - Documentation Reviewed:
      - `src/tools.ts:110-145` (`createToolRegistry` duplicates, `filterTools`), `docs/customization.md` (tool seams), `packages/prism-coding-tools/package.json` (sibling scaffold conventions), `docs/acp-agent.md` (config trust-boundary language for error shaping)
    - Options Considered:
      - Class-based `ToolPlaneBuilder` with chainable methods. Rejected: unrequested abstraction; one pure function covers the pipeline.
      - Set-based include/exclude with wildcard globbing. Rejected: names are already unique ids; exact-name lists are explicit and auditable; globbing added later only if hosts demand it.
      - Allow `replace` to introduce a differently-named tool. Rejected: keeps event/diff/ACP `kind` attribution stable; rename = `exclude` + `add`.
    - Chosen Approach: pure ordered resolver, fail-closed on unknown names, `AgentSdkConfigError` error family established here for the whole package.
    - API Notes and Examples:
      ```ts
      import { resolveToolPlane } from "@arnilo/prism-agent-sdk";
      import { createCodingTools, createReadTool } from "@arnilo/prism-coding-tools/agent";

      const tools = resolveToolPlane({
        planes: { coding: createCodingTools(process.cwd()) },
        exclude: ["shell"],
        replace: { read: createReadTool(process.cwd(), { maxBytes: 1 << 20 }) },
        add: [myLintTool],
      });
      // order preserved: coding tools (minus shell, read swapped in place) then myLintTool
      ```
    - Files to Create/Edit:
      - `packages/agent-sdk/package.json`: new package manifest (deps: `@arnilo/prism`; peer/dev wiring per sibling conventions)
      - `packages/agent-sdk/tsconfig.json`: sibling-pattern tsc config
      - `packages/agent-sdk/src/errors.ts`: `AgentSdkConfigError` (`ERR_PRISM_AGENT_SDK_CONFIG`)
      - `packages/agent-sdk/src/tool-plane.ts`: `resolveToolPlane` + types
      - `packages/agent-sdk/src/index.ts`: barrel
      - `packages/agent-sdk/src/__tests__/tool-plane.test.ts`: resolver tests
      - `package.json` (root): add `packages/agent-sdk` to `workspaces`, add build loop entry, add test aggregation if `scripts/run-all-tests.mjs` enumerates packages
    - References:
      - `src/tools.ts`, `packages/acp-agent/package.json` (bin/scaffold precedent)
  - Test Cases to Write (in `packages/agent-sdk/src/__tests__/tool-plane.test.ts`):
    - exclude removes only the named tool; order of survivors unchanged
    - replace swaps in place at original index; mismatched `name` key fails closed
    - unknown exclude name throws `AgentSdkConfigError` naming the name; unknown replace key same
    - `add` appends after planes; plane declaration order respected across multiple planes
    - duplicate names surface through `createToolRegistry` duplicate handling, not silent resolver dedupe
    - empty options → empty array; no planes + only `add` → add-only registry
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package, new public function; full docs page lands in Task 6.
    - Docs pages to create/edit: none here — `docs/agent-sdk.md` written in Task 6 after the full surface settles.
    - `docs/index.md` update: no — Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: `defineAgent` assembly — skills, instructions, hooks, MCP, stores, loop planes
  - Acceptance Criteria:
    - Functional: `defineAgent(config)` returns `{ agent, createSession(opts?), connectedMcpServerIds, dispose(): Promise<void> }` (`connectedMcpServerIds` readonly, reflecting successfully connected bridges for host status UI, not configured entries). `config` extends the tool-plane options with: `model`, `provider` (host-supplied `AIProvider`; SDK never resolves credentials itself beyond passing `credentialRef` through to host callbacks), `skills?: { workspaceRoot?, trust?, exclude?: readonly string[] }`, `instructions?: { agentsMd?: boolean | { path?: string }, systemMd?: boolean | { globalRoot: string; path?: string } }`, `hooks?: { file: string }`, `mcp?: { servers: readonly McpServerSpec[] }`, `store?`, `loop?`, `middleware?`, `policy?` — each field mapping 1:1 onto existing seams, none re-implemented.
    - Functional: planes default **off** except `instructions.agentsMd` (default on when `workspaceRoot` given — mirrors cli-runner behavior); bare call = loop + session, zero tools, zero discovery.
    - Functional: MCP bridges connect eagerly at `defineAgent`, append bridged tools after the local plane (Task 2 ordering), and `dispose()` closes every bridge (`McpToolBridge.close`) exactly once and is idempotent.
    - Functional: `createSession` returns a real `AgentSession` (`createAgentSession`) with the assembled agent config; per-call `RunOptions` (incl. per-run `loop` override) pass through untouched.
    - Performance: assembly cost is one pass over planes + one discovery scan per configured root (single-level, bounded — existing loader behavior); no hidden background work, no polling; `defineAgent` does no provider call.
    - Code Quality: assembly is straight-line wiring in `src/define-agent.ts`; each plane is a small `assemble<Plane>` helper; no new abstractions (no DI container, no plugin manager — plugin/loading concerns stay with the existing extension kernel when hosts opt into it).
    - Security: skills/instruction discovery always passes an explicit `trust` policy (default: workspace root only, never home dir); MCP servers require an explicit allow decision carried on each `McpServerSpec` (reuse `prism-acp-agent` `mcp.allow` semantics — http/sse origin/subtree match, stdio marker — documented, not re-validated differently); hooks file path is trust-checked before load; SDK stores no secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/customization.md` seam table (all rows this task wires), `docs/acp-agent.md` (mcp.allow table), `docs/context-and-skills.md`, `docs/instruction-injection.md`, `packages/hooks/README.md`, `src/cli-runner.ts:L382-421` (trust + discovery + AGENTS.md ordering)
      - `packages/mcp/src/bridge.ts:44-60` (`ConnectMcpToolsOptions`), `packages/mcp/src/types.ts` (`McpToolBridge`)
    - Options Considered:
      - Lazy MCP connect on first session. Rejected: deferring fail-closed errors (bad server id, denied allow) to run time hides config errors; eager connect fails at startup like acp-agent.
      - SDK-owned plugin/module loading for user tools. Rejected: that is the extension kernel's job (`--extension` precedent); SDK accepts already-imported `ToolDefinition`s, apps (plan 135) handle module loading.
      - Return a subclass/decorated session. Rejected: return the real `AgentSession`; decoration breaks store/lifecycle compatibility.
    - Chosen Approach: thin assembly, eager plane wiring, `dispose` owns bridge cleanup; trust policy required input, never defaulted-open.
    - API Notes and Examples:
      ```ts
      import { defineAgent } from "@arnilo/prism-agent-sdk";
      import { createCodingTools } from "@arnilo/prism-coding-tools/agent";
      import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

      const app = await defineAgent({
        model: { provider: "anthropic", model: "claude-sonnet-4-5" },
        provider: myProvider,
        tools: { planes: { coding: createCodingTools(cwd) }, exclude: ["shell"] },
        skills: { workspaceRoot: cwd, trust: createPathTrustPolicy([cwd]) },
        instructions: { agentsMd: true },
        hooks: { file: ".agents/hooks.json" },
        mcp: { servers: [{ serverId: "web", command: "bunx", args: ["@mcp/web"], allow: "stdio" }] },
      });
      const session = app.createSession();
      for await (const event of session.stream("fix the flaky test")) { /* ... */ }
      await app.dispose();
      ```
      (Exact session/run call shape verified against `src/agent-session.ts` during implementation; example updated to the real method set.)
    - Files to Create/Edit:
      - `packages/agent-sdk/src/define-agent.ts`: `defineAgent` + `AgentSdkDefinition` return type
      - `packages/agent-sdk/src/planes/skills.ts`: skills assembly
      - `packages/agent-sdk/src/planes/instructions.ts`: AGENTS.md/SYSTEM.md assembly
      - `packages/agent-sdk/src/planes/mcp.ts`: server spec validation + `connectMcpTools` fan-out + bridge handles
      - `packages/agent-sdk/src/planes/hooks.ts`: hooks.json adapter wiring
      - `packages/agent-sdk/src/index.ts`: export additions
      - `packages/agent-sdk/package.json`: add workspace deps (`@arnilo/prism-mcp`, `@arnilo/prism-hooks`, `@arnilo/prism-coding-tools` dev/peer per actual imports)
      - `packages/agent-sdk/src/__tests__/define-agent.test.ts`, `src/__tests__/planes.test.ts`: new tests
    - References:
      - `packages/acp-agent/src/config.ts` (fail-closed config semantics), `src/cli-runner.ts`, `examples/sdk-basics.ts`
  - Test Cases to Write:
    - bare `defineAgent` (no planes) runs mock provider end-to-end, zero tools registered
    - `exclude`/`replace`/`add` observable via dispatched tool menu on `provider_turn_finished`-style inspection or registry introspection
    - skills plane: temp `.agents/skills/<name>` discovered, excluded name absent
    - instructions plane: `AGENTS.md` layer present in assembled system prompt; disabled → absent
    - MCP: stdio server stub (mock transport) bridges tools appended after local plane; `connectedMcpServerIds` counts only successful connections; denied `allow` fails at `defineAgent`, no session created
    - `dispose()` closes all bridges; second `dispose()` is a no-op; `createSession` after dispose fails closed
    - per-run `loop` override in `createSession().run(input, { loop })` reaches `resolveLoop`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `defineAgent` is the package's primary API.
    - Docs pages to create/edit: none here — consolidated in Task 6.
    - `docs/index.md` update: no — Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Presets + fail-closed config-object validation
  - Acceptance Criteria:
    - Functional: `barePreset()` (loop + session only) and `codingPreset({ cwd, permissions? })` (coding plane from `createCodingTools`, optional `ExecutionPolicy` passthrough from `@arnilo/prism-coding-tools/security`, AGENTS.md on) exported; both return plain partial `defineAgent` configs that merge with host overrides — preset first, host config wins on conflict, tool-plane fields merge (`exclude`/`add` concatenate, `replace` host-wins).
    - Functional: optional `parseAgentSdkConfig(json)` validates a plain-JSON form of the config (for app config files): unknown keys rejected, every value shape-validated, model/provider excluded (those stay programmatic — JSON form covers planes/skills/instructions/hooks/mcp/loop selection only); error message names the offending key path.
    - Performance: presets are constant-time factory objects; validation is O(config size); no I/O in either.
    - Code Quality: validation lives in `src/config.ts` following `packages/acp-agent/src/config.ts` patterns (unknown-key rejection, bounded messages); preset merge logic is one exported pure function `mergeAgentConfig(base, override)`.
    - Security: JSON form can never name a credential value, a module specifier to import, or a filesystem path outside explicitly declared `workspaceRoot`/`hooks.file` fields — executable/module loading stays app-side.
  - Approach:
    - Documentation Reviewed:
      - `docs/acp-agent.md` config reference (trust-boundary framing), `packages/acp-agent/src/config.ts` (`ConfigError`, unknown-key rejection), `docs/coding-agent-tools.md` (aggregator factories + security policy cross-ref)
    - Options Considered:
      - Presets as concrete `Agent` instances. Rejected: model/provider are host-owned; presets must stay config factories to compose.
      - Full JSON-Schema dependency (ajv/zod). Rejected: sibling packages hand-roll bounded validation; no new dependency for a flat config object.
      - Single universal preset with feature flags. Rejected: `bare`/`coding` named presets document intent; flags = the `tools.planes` field itself.
    - Chosen Approach: config-factory presets + programmatic-first API; JSON validation scoped to app-file needs, no executable surface.
    - API Notes and Examples:
      ```ts
      import { defineAgent, codingPreset, mergeAgentConfig } from "@arnilo/prism-agent-sdk";
      const config = mergeAgentConfig(codingPreset({ cwd }), {
        tools: { exclude: ["shell"], add: [myTool] },
      });
      const app = await defineAgent({ ...config, model, provider });
      ```
      ```ts
      // JSON form (for a future app config file):
      parseAgentSdkConfig({
        planes: { coding: true, git: false },
        exclude: ["shell"],
        skills: { enabled: true },
        mcp: { servers: [{ serverId: "web", command: "bunx", allow: "stdio" }] },
      });
      ```
    - Files to Create/Edit:
      - `packages/agent-sdk/src/presets.ts`: `barePreset`, `codingPreset`, `mergeAgentConfig`
      - `packages/agent-sdk/src/config.ts`: `parseAgentSdkConfig` + JSON types
      - `packages/agent-sdk/src/index.ts`: export additions
      - `packages/agent-sdk/src/__tests__/presets.test.ts`, `src/__tests__/config.test.ts`: new tests
    - References:
      - `packages/acp-agent/src/config.ts`, `packages/prism-coding-tools/src/agent/index.ts` (aggregators)
  - Test Cases to Write:
    - `barePreset` + mock provider runs with empty registry
    - `codingPreset` registers the nine default tools; host `exclude` removes one; host `replace` wins over preset plane
    - `mergeAgentConfig`: scalar override wins, tool-plane fields deep-merge, no shared-reference mutation between base and override
    - `parseAgentSdkConfig`: unknown key rejected with key path; wrong type rejected; `model`/`provider` keys rejected in JSON form (explicit error)
    - git plane opt-in (`planes.git: true`) yields `createGitTools` set, not in `codingPreset` default
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — presets + JSON config are public surface.
    - Docs pages to create/edit: none here — consolidated in Task 6.
    - `docs/index.md` update: no — Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Reusable host command and session-capability composition for Prism Code
  - Acceptance Criteria:
    - Functional: inventory public command registry/dispatch, compaction, context-provider and session-attachment seams before adding SDK surface. Host-supplied `CommandDefinition`s can be registered for host-only dispatch (not model-visible tools); a host-supplied compaction strategy/options reaches `createAgent`; duplicate command names fail closed. Reuse `createContributionRegistries().commands` if sufficient.
    - Functional: demonstrate opt-in `createWebTools({ search: createBraveSearch(...), fetch: createFirecrawlFetch(...) })` OR `createObscuraWebTools({ command: absoluteBinaryPath, nativeTools: false }).tools` through existing tool plane with unique `web_search`/`web_fetch`. Demonstrate four wiki commands from `createWikiExtension` (`wiki-init`, `wiki-refresh`, `wiki-lint`, `wiki-ingest`) via existing extension registration or public command factories. Bare SDK gets none.
    - Functional: assess whether `createObservationalMemory(...).attach(session, { appendEntry, ... })` needs a generic SDK session composition hook for Prism Code. Add only if app would otherwise duplicate assembly; OM worker model/provider stay independent of main model. `createCodingCompactionStrategy()` stays explicit and provider-backed.
    - Performance: bare SDK adds no network/worker activity; optional web/wiki inert until invoked; OM workers and LLM compaction cost only on opt-in calls.
    - Code Quality: no root core dependency on web/memory; no SDK static imports of optional packages if host definitions suffice; commands are distinct from LLM tools.
    - Security: host-only command execution, trust-checked wiki workspace, skill auto-deploy gated by host; web outputs stay `untrusted_external` and retain adapter egress controls; SDK stores no credential values.
  - Approach:
    - Documentation Reviewed:
      - `docs/contribution-registries.md`, `docs/web-tools.md`, `docs/obscura.md`, `docs/wiki.md`, `docs/compaction-llm.md`, `docs/compaction-observational-memory.md`, `docs/agent-session-runtime.md`.
    - Options Considered:
      - Bundle web/wiki/OM by default: rejected — binaries, cost, and side effects in bare assembly.
      - Reuse registries and session APIs, adding a generic hook only for a demonstrated integration gap: chosen over an SDK-specific command/OM engine.
    - Chosen Approach: host-provided definitions and existing registries first; document no-new-primitive conclusion if sufficient. Prism Code plan 135 owns `/` picker, switching, credentials.
    - API Notes and Examples:
      ```ts
      import { createObscuraWebTools } from "@arnilo/prism-web-tools/obscura";
      import { createWikiExtension } from "@arnilo/prism-memory/wiki";
      const web = createObscuraWebTools({ command: "/usr/bin/obscura", nativeTools: false });
      const tools = resolveToolPlane({ planes: { coding: codingTools, web: web.tools } });
      const wiki = createWikiExtension({ workspaceRoot: cwd, autoDeploySkills: false });
      // Host registers wiki commands from wiki.setup(api); never expose commands as LLM tools.
      ```
    - Files to Create/Edit:
      - `packages/agent-sdk/src/define-agent.ts`, `src/index.ts` (tentative: only if existing registries/session seam is insufficient)
      - `packages/agent-sdk/src/__tests__/capabilities.test.ts`: offline composition tests
      - `docs/agent-sdk.md`: examples and opt-in cost/security notes (created in Task 6)
    - References:
      - `src/contracts-core/agent.ts` (`CommandDefinition`, `AgentConfig.compaction`), `src/contributions.ts` (`createContributionRegistries`), `src/extensions.ts` (`registerCommand`), `packages/memory/src/wiki/extension.ts`, `packages/web-tools/src/tools.ts`, `packages/web-tools/src/obscura/web.ts`, `packages/memory/src/compaction/observational-memory/compose.ts`.
  - Test Cases to Write:
    - Bare definition: no commands, web tools, OM workers or network; wiki command executes once with intended workspace; duplicate command rejected.
    - Web plane has exactly one `web_search`/`web_fetch` with Obscura default or Brave+Firecrawl explicit selection; no binary/key initialization without opt-in.
    - Injected coding compaction strategy reaches `session.compact({ strategy })`; OM worker keeps independent model and does not run while disabled.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if new SDK wiring; otherwise examples document existing composition.
    - Docs pages to create/edit: `docs/agent-sdk.md` (Task 6), links to `docs/web-tools.md`, `docs/wiki.md`, `docs/compaction-observational-memory.md`.
    - `docs/index.md` update: yes — Task 6 entry covers optional capabilities, no second entry for unchanged lower-level APIs.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: Docs, example, release wiring, verification
  - Acceptance Criteria:
    - Functional: `docs/agent-sdk.md` written in required API page structure (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs); tool-plane ordering contract and "disable everything = bare loop" guarantee stated explicitly; no release narrative.
    - Functional: `docs/index.md` gains one one-sentence entry under the appropriate live heading; `examples/agent-sdk-coding.ts` (+ compiled `.js`) runs against the mock provider and typechecks under `tsc -p examples --noEmit` (added to examples tsconfig if enumeration requires).
    - Functional: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`, `bun run pack:dry-run` green; `node scripts/release.mjs gate --update-baseline` run to regenerate `scripts/compat-baseline/` for the new package's export surface, and post-regeneration `bun run release:gate` diff is clean — this task's note states which baseline entries are new (this plan) vs inherited.
    - Performance: docs state the assembly-cost contract (single pass per plane, eager MCP connect at startup) and the JSON-validation cost (O(config)); no runtime benchmark needed — assembly path adds no per-turn work.
    - Code Quality: package README.md (`packages/agent-sdk/README.md`) with install + minimal example; CHANGELOG.md entries per sibling convention.
    - Security: docs restate trust gating (skills/instructions/hooks paths), MCP allow default-deny, and "SDK stores no credentials" boundary.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (page structure + index rules), `docs/coding-agent-tools.md` (sibling page style), `docs/index.md` (heading placement), `packages/acp-agent/README.md`
    - Options Considered:
      - Split docs into per-plane pages. Rejected: one page with per-plane sections matches page-template guidance for multi-API pages; split when a plane outgrows a section.
    - Chosen Approach: single `docs/agent-sdk.md`, index entry one sentence, history stays in `docs/history/`.
    - API Notes and Examples: page examples lifted from Tasks 2-5 snippets, verified against final exports.
    - Files to Create/Edit:
      - `docs/agent-sdk.md`: new API page, including readonly connected MCP status for host footer and optional web/wiki/OM composition
      - `docs/index.md`: one entry + current-line package-count correction if it enumerates packages
      - `examples/agent-sdk-coding.ts`, `examples/agent-sdk-coding.js`: mock-provider example
      - `packages/agent-sdk/README.md`, `packages/agent-sdk/CHANGELOG.md`: package docs
      - `scripts/compat-baseline/`: regenerated by `release.mjs gate --update-baseline`
    - References:
      - plan-task rule: baseline regeneration named explicitly for new-package surface changes
    - Baseline Delta Classification:
      - New to Plan 134: `scripts/compat-baseline/arnilo__prism-agent-sdk.txt` (41 symbols for `@arnilo/prism-agent-sdk`).
      - Inherited from concurrent working-tree modifications: additions in `arnilo__prism.txt` (`assertPersistenceBranchQueryConforms`), `arnilo__prism-core.txt`, and `arnilo__prism-work.txt`.
  - Test Cases to Write:
    - `scripts/` examples-level: example file typechecks (existing `tsc -p examples --noEmit` covers once added)
    - docs example snippets correspond 1:1 to real exports (manual check + typecheck of example)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task publishes the surface documentation.
    - Docs pages to create/edit: `docs/agent-sdk.md`, `docs/index.md`.
    - `docs/index.md` update: yes — one sentence, e.g. "**Agent SDK**: `@arnilo/prism-agent-sdk` assembles a configurable agentic runtime (tool planes, skills, instructions, MCP, hooks) over the harness with every plane optional or replaceable."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Re-audit tarball diet and bundle footprint for Agent SDK docs and baseline
  - Priority: P3
  - Compromise: Raised `root.packedBytes` baseline from 1486492 to 1562714 (+5.1%) in `scripts/budgets.json` to accommodate `docs/agent-sdk.md`, compatibility baseline entries, and plan documentation rather than trimming existing docs.
  - Implications: Packed tarball size ceiling increased slightly; future doc additions will need to watch the budget limit closely.
- Consolidate optional peer dependency resolution between Agent SDK and host apps
  - Priority: P3
  - Compromise: Marked `@arnilo/prism-coding-tools`, `@arnilo/prism-hooks`, and `@arnilo/prism-mcp` as peerDependencies of `@arnilo/prism-agent-sdk` to guarantee lockstep versions in consumer workspaces rather than dynamic runtime imports with fallback stubs.
  - Implications: Consumers installing `@arnilo/prism-agent-sdk` must satisfy or accept npm/bun peer dependency warnings unless all three are provided or ignored.
- Recorded in plans/backlog.md.

## Further Actions

- Hot-reload / dynamic update of skills and hooks in live agent session
  - Priority: P2
  - What: Add a runtime mutation method on `AgentSession` or `Agent` to re-discover skills and re-compile hooks without rebuilding the entire `Agent` instance via `defineAgent`.
  - Why: Interactive coding apps like Prism Code (Plan 135) may benefit from on-the-fly editing of `.agents/skills` or `.agents/hooks.json` during a session without tearing down the conversation.
- Structured telemetry and tracing integration for defineAgent assembly
  - Priority: P3
  - What: Expose OpenTelemetry spans or telemetry hooks covering the tool-plane resolution and eager MCP bridge startup phases in `defineAgent`.
  - Why: Allows host applications to monitor startup latency and failures in remote or stdio MCP server handshakes.
- Recorded in plans/backlog.md.
