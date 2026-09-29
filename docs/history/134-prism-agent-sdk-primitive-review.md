# Plan 134 Primitive Review: Agent SDK Assembly Seams

Plan: [134-Prism-Agent-SDK.md](../../plans/134-Prism-Agent-SDK.md) Task 1  
Date: 2026-09-27  
Baseline: Release `0.12.0` line in progress  
Scope: Inventory of assembly seams the SDK consumes, public-export verification, assembler-precedent analysis, trust-boundary restating.

---

## 1. Seam Inventory

Every seam the SDK must consume, with source location, brief signature, and public-export status against the published `exports` map in each package's `package.json`.

### 1.1 Root package (`@arnilo/prism`) — root `.` subpath exports

| Seam | Definition | Signature (brief) | Public |
|---|---|---|---|
| `createAgent` | `src/agent-session/create-agent.ts:5` | `(config: AgentConfig) → Agent` | ✅ via `src/index.ts` → `.` |
| `createAgentSession` | `src/agent-session/session.ts:14` | `(config: AgentSessionConfig & { agent }) → AgentSession` | ✅ via `src/index.ts` → `.` |
| `createToolRegistry` | `src/tools.ts:110` | `(tools?: ToolDefinition[], options?: ToolRegistryOptions) → ToolRegistry` | ✅ via `src/index.ts` → `.` |
| `filterTools` | `src/tools.ts:135` | `(tools, filter?: ToolFilterInput) → ToolDefinition[]` | ✅ via `src/index.ts` → `.` |
| `selectRunTools` | `src/tools.ts:183` | `(listed, requested, checkpoint?) → { tools, grant }` | ⚠️ **internal** — not in `src/index.ts` |
| `resolveLoop` | `src/agent-loops.ts:398` | `(options, config) → AgentLoopStrategy` | ✅ via `src/index.ts` → `.` |
| `singleShotLoop` | `src/agent-loops.ts:34` | `const AgentLoopStrategy` | ✅ via `src/index.ts` → `.` |
| `createSkillRegistry` | `src/skills.ts:12` | `(skills?: Skill[], options?) → SkillRegistry` | ✅ via `src/index.ts` → `.` |
| `resolveActiveSkills` | `src/skills.ts:37` | `(options: ResolveActiveSkillsOptions) → Skill[]` | ✅ via `src/index.ts` → `.` |
| `registerDiscoveredContributions` | `src/contributions.ts:124` | `(registries, contributions[]) → void` | ✅ via `src/index.ts` → `.` |
| `createContributionRegistries` | `src/contributions.ts:92` | `(options?) → ContributionRegistries` | ✅ via `src/index.ts` → `.` |
| `DuplicateRegistrationOptions` | `src/registry-options.ts:3` | `{ duplicate?: "replace" \| "error" }` | ✅ via `src/index.ts` → `.` |
| `createExtensionKernel` | `src/extensions.ts:111` | `(options?) → ExtensionKernel` | ✅ via `src/index.ts` → `.` |
| `activateKernel` | `src/extensions.ts` | `(kernel) → ActivatedKernelConfig` | ✅ via `src/index.ts` → `.` |

### 1.2 Root package — node subpath exports

| Seam | Definition | Subpath | Public |
|---|---|---|---|
| `discoverContributions` | `src/node/contribution-discovery.ts:26` | `./node/contribution-discovery` | ✅ |
| `loadSystemPromptFiles` | `src/node/system-project-prompts.ts:35` | `./node/system-prompts` | ✅ |
| `discoverAgentBundles` | `src/node/agent-definitions.ts:114` | `./node/agent-definitions` | ✅ |
| `resolveAgentBundle` | `src/node/agent-definitions.ts:196` | `./node/agent-definitions` | ✅ |
| `registerDiscoveredInstructionInjectors` | `src/node/instruction-injectors.ts:73` | `./node/instruction-injectors` | ✅ |
| `createPathTrustPolicy` | `src/node/trust.ts:48` | `./node/trust` | ✅ |
| `createJsonlSessionStore` | `src/node/session-store-jsonl.ts:45` | `./node/session-store-jsonl` | ✅ |

### 1.3 Workspace packages

| Seam | Package | Definition | Subpath | Public |
|---|---|---|---|---|
| `connectMcpTools` | `@arnilo/prism-mcp` | `packages/mcp/src/bridge.ts:49` | `.` | ✅ |
| `McpToolBridge` (type + `.close()`) | `@arnilo/prism-mcp` | `packages/mcp/src/types.ts:389` | `.` | ✅ |
| `createHooksExtension` | `@arnilo/prism-hooks` | `packages/hooks/src/compile.ts:182` | `.` | ✅ |
| `parseHooksConfig` | `@arnilo/prism-hooks` | `packages/hooks/src/schema.ts` | `.` | ✅ |
| `hookCommandHash` | `@arnilo/prism-hooks` | `packages/hooks/src/compile.ts` | `.` | ✅ |
| `createSqlitePersistence` | `@arnilo/prism-core` | `packages/prism-core/src/sessions/sqlite/persistence.ts:125` | `./sessions/sqlite` | ✅ |
| `createCodingTools` | `@arnilo/prism-coding-tools` | `packages/prism-coding-tools/src/agent/index.ts:251` | `./agent` | ✅ |
| `createReadTool`, `createShellTool`, etc. | `@arnilo/prism-coding-tools` | `packages/prism-coding-tools/src/agent/index.ts` | `./agent` | ✅ |
| `createReadOnlyTools`, `createAllTools` | `@arnilo/prism-coding-tools` | `packages/prism-coding-tools/src/agent/index.ts` | `./agent` | ✅ |
| `createGitTools` | `@arnilo/prism-coding-tools` | `packages/prism-coding-tools/src/agent/index.ts` | `./agent` | ✅ |
| `ExecutionPolicy` (type) | `@arnilo/prism-coding-tools` | `packages/prism-coding-tools/src/security/` | `./security` | ✅ |

---

## 2. Internal-Only Seams — Follow-Up Required

Only one seam from the plan's acceptance-criteria list is **not** a public export:

| Seam | Location | Status | Proposed Action |
|---|---|---|---|
| `selectRunTools` | `src/tools.ts:183` | Internal — absent from `src/index.ts` re-exports | **Follow-up**: determine whether the SDK needs `selectRunTools` directly. If yes, add to `src/index.ts` exports (alongside `createToolRegistry` / `filterTools`) with a separate PR prior to SDK implementation. If the SDK delegates run-tool selection to `createAgentSession` / the agent loop (which already calls it internally), no export is needed — the SDK never touches it. |

**Decision**: The SDK should **not** call `selectRunTools` directly. Run-tool selection is an internal concern of the agent loop during `session.run()` / `session.prompt()`. The SDK's `resolveToolPlane` (Task 2) works at the registry level (`createToolRegistry`), and per-run tool selection stays inside the loop. No new export needed.

---

## 3. Assembly Precedents

Two existing assemblers wire these seams today. The SDK generalizes both.

### 3.1 `src/cli-runner.ts` (L320–451, L475–526)

**What it assembles**: CLI prompt execution — trust policy, `.agents/` contribution discovery, AGENTS.md/SYSTEM.md prompt layers, extension loading, then agent + session.

**Seams called** (in order):
1. `createPathTrustPolicy` (L387) — trusted roots = `[workspaceRoot]` + opt-in `agentsConfig` dir + opt-in `agentsMdFile` dir
2. `discoverContributions` (L389) — if `--discover` and not `--no-discovery`
3. `createContributionRegistries` (L393) + `registerDiscoveredContributions` (L394) — skills + instruction injectors registered
4. `registerDiscoveredInstructionInjectors` (L397) — instruction injectors from `.agents/`
5. `discoverAgentBundles` (L404) — if `--agents-config` provided
6. `resolveCliInjectors` (L409–411) — resolves `--instruction` names against discovered injectors
7. `loadSystemPromptFiles` (L420–428) — AGENTS.md (trust-gated) + SYSTEM.md (global root); skipped in RPC mode
8. `loadCliExtensions` (L435) — if `--extension` specifiers present
9. `createSkillRegistry` (L523) — from discovered + extension skills
10. `createAgent` (L515–525) — model + provider + instructions + system prompt layers + skills + extension tools/context/middleware
11. `.createSession()` (L525) — session from agent

**Key patterns**:
- Discovery is **opt-in** (`--discover`), not default; `--no-discovery` hard-disables
- Trust roots **expand by explicit user act** (naming a flag = trusting its parent dir)
- State threaded as immutable `options = { ...options, ... }` reassignment — no globals
- Provider resolution is **separate** from assembly (L475–504) — `defaultCreateSession` resolves credential/module, then passes `providerInstance` to `agentSession()`

### 3.2 `packages/acp-agent/src/index.ts` (L233–365) + `config.ts`

**What it assembles**: ACP server agent — model/provider, identity, store, tool registry, agent, session factory, lifecycle.

**Seams called** (in order):
1. Provider resolution (L239–274) — lazy provider via `createLazyProvider()` (no upfront credential validation)
2. `OwnershipScope` / `AgentIdentity` construction (L277–286)
3. Store selection — `createSqlitePersistence` (L290) or `createMemorySessionStore` (L294)
4. `createToolRegistry(createCodingTools(config.cwd))` (L298) — single default registry
5. `createAgent` (L299–308) — model + provider + store + tools + ownership + identity + run state
6. Session factory (L329–351) — per-session agent forking: ACP filesystem adapters carry session IDs, so `createToolRegistry` + `createCodingTools` + `createAgent` are called **per session** when `input.coding.filesystem` is present
7. `createAgentRunLifecycle` (L325) + `createPrismAcpAgent` (L326–363) — ACP protocol wiring

**Key patterns**:
- **Fail-closed config** (`config.ts:129–132`): `rejectUnknown(record, knownKeys, source)` throws on any unrecognized key — typo in `mcp.allow` cannot fail silently
- **Lazy provider** — no network call until first `generate()` request
- **Per-session tool forking** — when ACP filesystem operations override read/write/edit, a new `createToolRegistry` + `createAgent` is built per session; the SDK must support this pattern (session-level tool override) without mandating it
- **No discovery** — the ACP agent does not run `.agents/` discovery or load AGENTS.md; it accepts `config.mcp` as an explicit server list with `allow` validation

### 3.3 Divergence the SDK Must Resolve

| Concern | cli-runner | acp-agent | SDK design |
|---|---|---|---|
| Tool registry | Deferred to `agentSession`; no explicit registry | `createToolRegistry(createCodingTools(...))` explicit | SDK: explicit `resolveToolPlane` (Task 2) builds registry; host-managed |
| Discovery | Opt-in via `--discover` flag | None | SDK: `skills.workspaceRoot` opt-in; off by default |
| Trust policy | `createPathTrustPolicy` with expanding roots | Implicit (config file trust boundary) | SDK: explicit `trust` parameter required when discovery enabled |
| MCP | Not wired | `config.mcp` with `allow` validation | SDK: `mcp.servers` with per-server `allow` (fail-closed) |
| Hooks | Not wired (extension kernel handles it) | Not wired | SDK: `hooks.file` config → `parseHooksConfig` + `createHooksExtension` + kernel |
| Instructions | `loadSystemPromptFiles` + `resolveCliInjectors` | Not wired | SDK: `instructions.agentsMd` + `instructions.systemMd` config |
| Session forking | Single session | Per-session tool rebuild | SDK: `createSession` returns real `AgentSession`; per-session tool override is host responsibility |
| Provider | CLI resolves credential/module | Lazy via `createLazyProvider` | SDK: host-supplied `AIProvider` — SDK never resolves credentials |

---

## 4. Trust Boundaries the SDK Must Preserve

1. **Workspace/app-config roots trust-gated independently.** `createPathTrustPolicy` accepts explicit `trustedRoots`. The SDK must require a `TrustPolicy` when skill discovery or instruction loading is enabled. Default: workspace root only, never home directory. Each additional root is an explicit host decision.

2. **Discovery output is inert until host registers it.** `discoverContributions` returns `DiscoveredContribution[]` — descriptor-only entries with no `import()` or execution. The SDK calls `registerDiscoveredContributions` to register them into `ContributionRegistries`, but tool/context/instructions kinds remain descriptors until the host resolves their `declaration.module`. Skills are fully realized at discovery time.

3. **MCP allow policy fail-closed.** Every `McpServerSpec` must carry an explicit `allow` decision (reuse `prism-acp-agent` semantics: http/sse origin/subtree match, `"stdio"` marker for stdio transport). The SDK must not default-allow any MCP server. `connectMcpTools` connects eagerly at `defineAgent` time; denied servers fail before session creation.

4. **No credential material in SDK config beyond refs.** The SDK accepts `AIProvider` (host-constructed, already authenticated) and optional `credentialRef` strings for delegation. API keys, tokens, and secrets never appear in SDK config objects, logs, or error messages. Provider resolution stays host-side.

5. **Hooks file path trust-checked.** The `hooks.file` config value names a filesystem path. The SDK must validate it against the trust policy before reading. Hooks commands execute in the host process scope — the `hookCommandHash` trust gate (known-command hashes) is the hooks package's concern, not the SDK's, but the SDK must thread the trust context through.

6. **Extension kernel isolation.** The CLI loads `--extension` modules via `loadCliExtensions` with explicit allow-list containment (cwd-relative or named packages). The SDK does not load extensions — it accepts `ToolDefinition[]` and `Extension[]` from the host. Module loading is app-side.

---

## 5. Import Map — SDK Package Dependencies

The SDK (`packages/agent-sdk`) will import from these published subpaths only:

```
@arnilo/prism               → createAgent, createAgentSession, createToolRegistry,
                               filterTools, resolveLoop, singleShotLoop,
                               createSkillRegistry, resolveActiveSkills,
                               registerDiscoveredContributions, createContributionRegistries,
                               DuplicateRegistrationOptions, createExtensionKernel, activateKernel
@arnilo/prism/node/trust     → createPathTrustPolicy
@arnilo/prism/node/contribution-discovery → discoverContributions
@arnilo/prism/node/system-prompts → loadSystemPromptFiles
@arnilo/prism/node/agent-definitions → discoverAgentBundles, resolveAgentBundle
@arnilo/prism/node/instruction-injectors → registerDiscoveredInstructionInjectors
@arnilo/prism/node/session-store-jsonl → createJsonlSessionStore (optional, for preset convenience)
@arnilo/prism-mcp            → connectMcpTools, McpToolBridge
@arnilo/prism-hooks           → parseHooksConfig, createHooksExtension, hookCommandHash
@arnilo/prism-core/sessions/sqlite → createSqlitePersistence (optional, for preset convenience)
@arnilo/prism-coding-tools/agent → createCodingTools, createGitTools, individual factories
@arnilo/prism-coding-tools/security → ExecutionPolicy (type-only for preset config)
```

No repo-relative or `dist/`-reaching imports. No internal-only seam is required (§2).

---

## 6. Conclusions Constraining Tasks 2–5

1. **`resolveToolPlane` (Task 2)** operates on `ToolDefinition[]` arrays from plane factories. It does not call `selectRunTools` (internal loop concern). It feeds `createToolRegistry` at the end. `DuplicateRegistrationOptions` passthrough covers duplicate policy.

2. **`defineAgent` (Task 3)** is straight-line wiring: trust → discover → register → load prompts → connect MCP → build tool registry → `createAgent` → return session factory + dispose. Ordering matches cli-runner §3.1 with acp-agent's fail-closed config discipline.

3. **Presets (Task 4)** are config-factory objects returning partial `defineAgent` configs. `codingPreset` calls `createCodingTools` and optionally `createGitTools`. `barePreset` returns empty planes. Merge is shallow object merge with array concatenation for `exclude`/`add`.

4. **All seams are public** — no `src/` or `dist/` path hacking needed. The SDK can ship without modifying root or sibling packages.

5. **Per-session tool forking** (acp-agent pattern) is host-owned, not SDK-mandated. `createSession` returns a real `AgentSession`; hosts that need per-session tool registries can build them on top.
