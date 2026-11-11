# Changelog

## [Unreleased]

Consolidated eighteen extension packages into exported subpaths.

### ./context-engineering

## [Unreleased]

### Changed

- The `compaction.when` handler abstains (`undefined`) below `attention.compactRatio` instead of owning the decision (plan 194 Task 2), so a host trigger or the kernel `thresholdEntries` fallback still fires; past the ratio it asks for compaction as before.
- The fold stub now names the tool, the call id, and the original payload size and tells the model it may re-run the tool (plan 194 Task 4); the attention compiler's own stub is unchanged.
### Added

- `accounting` and `context.accounted` (plan 194 Task 5): one estimate pass per provider request with per-source counts (system, instructions, skills, history, tool results, folded, input, prefix blocks, tail blocks), counts and source names only. Any configured stage emits the event.
- `blocks.maxShare` (plan 194 Task 5): caps injected prefix and tail context blocks at a fraction of the model input cap, dropping whole blocks by lowest priority then latest-added and reporting each drop. Mutually exclusive with `budget`; the system prompt and instruction layers are never counted or dropped.
- `fold.clearAtLeastTokens`, `fold.keepLast` and `fold.excludeTools` (plan 194 Task 4): cache-aware fold batching with a per-session cleared-id frontier, so the provider prefix moves once per batch instead of once per turn. `0` keeps the previous per-turn behavior.
- `assertToolDisclosureConforms` and `ToolDisclosureConformanceOptions` (plan 158 Task 8): the tool-disclosure conformance helper moves here with the activation tool it asserts (the kernel's `@arnilo/prism/testing/tool-conformance` keeps the dispatch/validation probes). The package now also exports its own `ToolSearchState` type rather than reading the kernel's.


- `@arnilo/prism-extensions/context-engineering` (plan 158 Task 7): the four context-engineering stages as one
  package on the lockstep line, built from the retired kernel modules `context-budget.ts`,
  `tool-result-fold.ts`, `tool-search.ts`, `attention-compiler.ts`, and
  `contracts-core/attention.ts`. One `context.build` handler composes the configured stages in a
  fixed order — fold → tool search → attention or budget — at the lowest first-party priority, so a
  budget sees every block another handler added this turn. The kernel modules stay in place for one
  task (the plan's duplication window) and are deleted in Task 8.
- Config is `{ budget?, fold?, toolSearch?, attention? }`, every stage off unless configured. A
  package with no config registers no hook and no tool, so the request bytes are unchanged.
  `budget` and `attention` are mutually exclusive and fail the load with a message naming both.
- Budget: the whole draft is measured (messages, context blocks, tool declarations) and droppable
  rows are evicted oldest-first, tool results before other history, then the lowest-priority context
  block. The leading system block is the mandatory prefix — never dropped, and an unfittable prefix
  rejects the transform with the 0.12 `context budget exceeded: mandatory prefix cannot fit` message.
  `budget.reportOmissions` emits a `context.omissions` package event.
- Fold: old tool-result messages are rewritten in the provider view only. `summarize` is `"truncate"`
  (deterministic, no model call) or `{ model }` (one call per newly folded result, cached per session
  by tool-call id in the session's own state). The store keeps the full result.
- Tool search: `toolSearch.disclosure: "search"` narrows `draft.tools` to the activated and top-k set
  and registers `search_tools`. The index is built from `draft.tools`, so a tool the kernel hid with a
  `when` predicate or `disable.tools` can never be returned; activations are session state.
- Attention: the ported compiler strips old thinking and stubs old tool results past `triggerRatio`,
  fails closed with `AttentionBudgetError` when the gate still fires, keeps its sticky frontier and
  fold ledger in session state, and emits `attention.compiled` as a package event. `compaction.when`
  requests compaction past `compactRatio`.
- The algorithms are exported as a library (`applyDraftBudget`, `compileAttention`,
  `createAttentionCompiler`, `foldToolResultHistory`, `selectDisclosedTools`, the frontier and ledger
  codecs, and the truncation follow-up policy), so a host can compose its own handler.
- `RESERVED_TOOL_NAMES` drops `search_tools` (the kernel no longer generates it exclusively): the
  package owns the activation tool now, and the 0.12 run-assembly path that still appends its own
  `search_tools` fails closed with a duplicate tool when a host configures both.
- Two kernel helpers were dropped with the port rather than copied: `foldToolResults` /
  `foldToolResultValue` (an in-flight entry point whose age gate is always zero, so it never folds)
  and the kernel run-overlay helpers (`resolveRunAttentionCompiler`, `mergeAttentionRunOverlay`),
  whose run field is deleted in Task 8.

## [0.1.0] - 2026-08-09

### Added

- Initial package scaffold on the lockstep release line.

## [0.0.28] - 2026-08-08

### Added

- Package created in the pre-release manifest sweep.

### ./context-files

## [Unreleased]

### Fixed

- A `grep` or `glob` call whose `path` names a single file no longer fails the run with `ENOTDIR` (`stat '<file>/AGENTS.md'` in the `context.build` hook). The nested-instructions hook now uses the file's directory for these two tools, and treats `ENOTDIR` on a probe as "no instructions here". Found by the host-builder evaluation (plan 215 Task 20), where it ended 5 of 9 builder runs that searched a source file.

### Added

- Nested instruction files (plan 190 Task 7): a directory deeper than `root` contributes its
  `AGENTS.md` (or `CLAUDE.md` when absent) just in time, as one extra text part on the first coding
  tool result that touches its subtree — not a system-prompt change and not a new message. `read`,
  `edit`, `write`, and `diagnostics` use `path`; `grep`/`glob` use their directory `path`; `move`
  uses `from`/`to`; paths outside `root` are ignored. The first insertion's bytes are frozen in
  package session state, so a later file edit cannot rewrite an earlier message; compaction removes
  the anchor and the next touch reinserts the current file. Config `nested` defaults to `true`;
  `false` restores root-only behavior, and `{ maxFileBytes, maxFiles }` lowers the defaults
  (16 KiB / 16 files; hard caps 64 KiB / 16). Over a limit the file is skipped with one
  `status.note("info", …)`; a realpath escaping the trusted roots is skipped with a warning. The
  shared tool-result serializer now appends trailing text parts so both the OpenAI Chat and
  Anthropic Messages codecs carry the insertion. The package now declares `session-state`.

 `contextFiles({ root })` scans the standard project roots
  `<root>/.agents/skills` and `<root>/.claude/skills`, plus `<globalRoot>/.agents/skills`,
  `<globalRoot>/.claude/skills` and `<globalRoot>/.codex/skills` when `globalRoot` is set. Each
  `<name>/SKILL.md` is parsed with `parseSkillFile` and registered through `prism.skills.register`;
  roots are de-duplicated by realpath, the project root wins a global duplicate, and custom
  `skills.roots` replace the defaults. A malformed, oversized, untrusted or conflicting skill is
  skipped with one `status.note` naming its path, never a failed setup. Config also accepts
  `CLAUDE.md` as the per-directory fallback when `AGENTS.md` is absent.
- `@arnilo/prism-extensions/context-files` (plan 154 Task 7): the instruction-file plane as a source-exported
  package on the lockstep line, built from the retired kernel `node/instruction-sources` and
  `node/system-prompts` adapters and the agent-SDK instructions plane. One `context.build` transform
  (`@arnilo/prism-extensions/context-files:context.build`) composes `SYSTEM.md` (`source: "user"`) and
  `AGENTS.md` / explicit `files` (`source: "app"`) over the agent's base instructions through the
  kernel's `composeSystemPrompt`, so the 0.12 rank order is preserved with no copy of the composer.
- Config is `{ root (required), agentsMd?, systemMd?, globalRoot?, trustedRoots?, files?, skills? }`. There is
  no home-directory scan unless `globalRoot` is set, and a missing `root` fails the load naming the
  field instead of a schema `required`.
- Trust: a candidate file is loaded only when its realpath is inside a trusted root; a symlinked
  `AGENTS.md` / `SKILL.md` escaping the roots is skipped with a `status.note("warn", …)` naming the path. A global
  `SYSTEM.md` outside `workspaceRoot` stays user-owned and ungated. A missing file is silent.
- Caching: files are read once per session into agent state keyed by path and mtime; a new run
  re-checks mtimes (one `stat` per candidate path) and re-reads only what changed.
- Library exports for hosts that compose the prompt themselves: `readContextFileLayers` /
  `resolveContextFileLayers` and `resolveInstructionSources` / `resolveInstructionSource`.

## [0.1.0] - 2026-08-09

### Added

- Initial package scaffold on the lockstep release line.

## [0.0.28] - 2026-08-08

### Added

- Package created in the pre-release manifest sweep.

### ./keyring

## [Unreleased]

### Added

- New package (plan 152 Task 7): `@arnilo/prism-extensions/keyring` claims the `credentials` slot
  with the OS keyring (`@napi-rs/keyring`, imported lazily) or an encrypted file
  (`backend: "file"` with `file.path` + `file.keyRef`), resolves `keyring:<name>` refs, and delegates
  `env:` refs to `prism.slots.credentials.default`. `store`/`delete` persist host-captured `secret`
  answers and provider OAuth tokens. An unavailable backend records a `warn` status note, still
  claims the slot, answers `undefined` for reads, and throws `KeyringUnavailableError` on writes —
  never a plaintext fallback. Moves the credential stores out of
  `@arnilo/prism-core/credentials/node` (`keychain-store`, `encrypted-store`, `file-store`,
  `envelope`, `file-io`, `vault`, `types`, `limits`, `errors`, `resolver`, and the host KMS
  envelope); `prism-core` drops its `@napi-rs/keyring` dependency and keeps OIDC, OAuth2, workload
  scopes, the M365/Google Workspace providers, and the work-token helper.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.

### ./advisor

## [Unreleased]

### Changed

- Task capture runs on `run.input` (it now receives the run id on its hook context) instead of re-reading the session branch from a `turn.before` hook: the validator pins the input the run was actually given, a mid-run steer cannot replace it, and no branch read is spent. Requires a kernel whose transform hooks carry `context.runId` (0.13.0 line, plan 191 follow-up).

### Added

- `@arnilo/prism-extensions/advisor` (plan 191 Task 8): a second model's advice and completion validation as one integration package.
  - The `advise` tool makes one `models.client` call, with no tools, over `selectTranscript(<branch>, context)` and the question; the result is the advice plus `[advisor: <model>, <tokens> tokens]`, capped by `adviceMaxChars` (4,000 default, 16,000 ceiling).
  - `triggers.beforeTools` consults before each named tool: a `revise` verdict denies the call with `Advisor: <advice>` as the result, and a retry of the same tool with the same arguments is allowed without a second consult, so a revise cannot loop.
  - `triggers.beforeFinish` reviews the final answer at the natural end of a run and continues with the advice as a steer.
  - `validate` adds completion validation on `run.end`: a captured (or inferred) task pinned into the slice, an `incomplete`/`complete` verdict from a model engine or a hidden `delegate` child through the `delegate` service, `missing` items as the continuation steer, and `unverified` after `maxRounds` (2 default, 10 ceiling). It fails closed: errors, timeouts, unparseable verdicts and an unavailable engine never yield `verified`.
  - Events: `advisor.consult` and `validator.verdict`, neither carrying the transcript, the advice, or the final answer. `maxConsultsPerRun` (3 default, 20 ceiling) caps consults per run; validation rounds are counted separately.
  - Every failure of an advisor consult allows the tool call or ends the run normally: an advisor outage cannot block work. `triggers.beforeFinish` and `validate` together are a config error, because the first `run.end` continuation wins.

### ./delegate

## [Unreleased]

### Added

- **`delegating-work` skill (plan 215 Tasks 9 and 11).** The package registers a bundled skill from `skills/delegating-work` with `skills.addDir` (first in `setup`), and `package.json` `files` lists `skills`. It declares `prism-requires-tools: delegate delegate_wait delegate_cancel`, so a config with only hidden children, or a request without the tools, does not list it. The body is eight lines: a child sees only the brief, never put a secret in it, do a one- or two-call job yourself, read the status line, check a claim before repeating it, send a second brief rather than the same one, cancel what you no longer need. Kept on a measured hazard effect, not a pooled gain: `delegate-trivial-no-child` 9/9 with the skill against 1/9 without across three runs, the other 14 items at ceiling (owner override of the pooled ship rule; evidence in `docs/_evidence/skill-evals/211/v3/`).
- `children.<name>.skills: "inherit"` (the default) now leaves out a parent skill that requires `delegate`: a child never sees that tool, and an inherited skill would add the `load_skill` bridge to a child that could not use it.

- Delegate children are choosable and bounded (plan 191 Task 2): `children.<name>.description` turns the `delegate` description into one `- <name>: <description>` line per child (falling back to the first sentence of `instructions`, else `(no description)` with a setup note), the schema documents `child`, `input` (a self-contained brief) and `mode`, the child's instructions always start with the report contract, and every result is the child's answer plus one status line.
- `children.<name>.resultMaxChars` (default 12,000, at most 64,000) caps the answer the parent sees; a longer one ends with a `delegate_wait { offset }` hint and the delegation keeps up to 256,000 chars (`HARD_RETAINED_RESULT_CHARS`) to page. New exports: `DEFAULT_RESULT_MAX_CHARS`, `HARD_MAX_RESULT_MAX_CHARS`, `HARD_RETAINED_RESULT_CHARS`, `resolveResultMaxChars`, `DEFAULT_CHILD_INSTRUCTIONS`.
- `@arnilo/prism-extensions/delegate` (plan 160 Task 4): native package adding `delegate`, `delegate_wait`, and `delegate_cancel` tools. Each child runs as its own `createAgent` over the packages named in its `inherit`, reports `delegate.step` package events, and ends or is disposed with the delegation or the parent session. Replaces the in-process supervisor, `createSpawnAgentTool`, and `createDelegatedAgentStep`.
- `@arnilo/prism-extensions/observability` (plan 160 Task 3): native package turning run, turn, and tool events into OpenTelemetry spans and metrics through observe handlers. Moved the agent-event instrumentation (`createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi`, `createInMemoryTelemetry`) out of `@arnilo/prism-core/governance/observability`. Exports nothing itself.

### Added

- Children can see the parent's conversation (plan 191 Task 7): `children.<name>.context` is `"none"` (default), `"summary"`, or `{ lastTurns, maxChars? }`. A `lastTurns` child is seeded from the parent's branch with the kernel's new `selectTranscript` (portable text, tool activity rendered inline, dangling calls and thinking dropped), under its own session id in its own memory store; a `"summary"` child gets one summarization call instead. Only messages and summaries travel, so inherited package state never hydrates from the parent. A child configured with `context` fails `context_unavailable` instead of running blind, and the tool description marks which children see the conversation. New exports: `DelegateContextConfig`, `resolveChildContext`, `DEFAULT_CONTEXT_MAX_CHARS`, `HARD_CONTEXT_MAX_CHARS`, `HARD_CONTEXT_LAST_TURNS`, `SUMMARY_INSTRUCTION`, `ContextUsed`.
- The delegate runtime is provided as the `"delegate"` service (`DelegateService`: `start`, `wait`) for a package that runs a configured child the model never sees. `children.<name>.hidden: true` keeps a child out of the tool and its `child` enum; when every child is hidden the tools are not registered and the service still is. The package declares `session-state` for the branch read.
- Children from subagent files (plan 191 Task 6): `agentsRoot` reads `<root>/.agents/agents/*.md` then `<root>/.claude/agents/*.md` with `parseAgentFile`, so an existing Claude Code subagent file becomes a delegate child; `defaultInherit` (required with `agentsRoot`) is the only package set such a child gets. `name`, `description`, and the body are the child; `tools` maps through the frozen `AGENT_TOOL_NAMES` (`Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Grep`→`grep`, `Glob`→`glob`, `Bash`→`shell`) into `tools.only`; `model` is `provider/model`, and an alias or bare id means the parent's model. Configured children win, then `.agents`, then `.claude`; duplicates are an `info` note. A malformed file or a `tools` list that maps to nothing is skipped with a `warn` note, and a mapped tool the agent does not register is dropped at the first run with one note.
- `children.<name>.isolation: "worktree"` (plan 191 Task 5): the child runs in its own worktree of the inherited coding package's repository, bound to its session, and its branch is merged into the parent's checked-out branch when it completes. The merge outcome (`merged`/`conflict`/`refused`/`skipped`, with the kept branch) is summarized in the result's status line. `WorkspaceWorktree.parentBranch` records the merge target; `workspace.commit` records a kept worktree's pending changes on its branch. A child without a `workspace` service, or a sandboxed one, fails with `isolation_unavailable` before running.
- `ownership` config: the scope child agents append under.

### Changed

- Children reach the parent's host (plan 191 Task 4): `buildAgent` passes `host: { ui }` built from `prism.host.ui`, prefixing `[<child>] ` into the request's `title`, `detail`, and `message`. An `ask` inside a child is now answered by the person instead of suspending the child, and the package declares the `host-ui` capability.
- `children.<name>.skills` (default `"inherit"`): the child gets the parent's skills at delegation time, `"none"`, or the named subset. An unknown name fails the delegation.
- Kernel: registering a skill whose name is taken by a skill with the same `path` and the same `instructions` is a no-op instead of `skill_conflict`, for `prism.skills.register`, `AgentConfig.skills.add`, and `skills.dirs`. A same-name skill with a different path or body is still a conflict.

- Delegation budgets finish the work (plan 191 Task 3): `DEFAULT_CHILD_LIMITS` is now 50 turns / 200 tool calls / 500,000 tokens / 15 minutes and `HARD_CHILD_LIMITS` 200 / 1,000 / 2,000,000 / 60 minutes. The old defaults could not complete a coding task: plan 189's tool schemas alone cost several thousand tokens per call.
- `mode: "async"` always runs as the parent session's background work and ends with it; `mode: "sync"` stays part of the calling tool call and aborts with it.
- A delegation entry leaves the map when its retained answer was fully served (a `delegate_wait` with no `nextOffset`, or an untruncated sync return) and when the parent session closes. A truncated sync result keeps its entry so the paging hint can be followed.

### Removed

- `children.<name>.budgetShare` (use `limits` directly) and `children.<name>.lifetime` (use `mode`), plus the `DelegateLifetime` type and `resolveChildLimits`'s `budgetShare` parameter. A config that still sets either fails `createAgent` with the kernel's config error.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./hooks-json

## [0.9.0] - 2026-09-21

### Added

- New capability package (plan 106 R4): `parseHooksConfig()` validates the Claude flat
  and Codex `{ "hooks": { ... } }` shapes and rejects unknown events, unsupported
  handler types, shell interpolation, and bad timeouts with `ERR_PRISM_HOOKS_CONFIG`.
- `createHooksExtension()` compiles the config onto public seams — `session_start`
  context injection, `UserPromptSubmit` input guardrail, `PreToolUse`/`PostToolUse`
  middleware plus guardrails, and a `Stop` stop hook — with `command` handlers spawned
  shell-free and `mcp_tool` handlers delegating to a host-provided client.
- Hash-pinned handler trust (`hookCommandHash()`, host-configurable algorithm), a
  logged `"all"` escape hatch, seconds-based timeouts, Codex-style context spill to
  `<tmpdir>/hook_outputs/`, and detached `async` handler delivery.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package's first published version is 0.10.0, the lockstep cut that adds it to the release graph.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate 0.9.0.

### ./mcp

## [Unreleased]

### Changed
- **Native package (plan 159 Task 4).** The package now default-exports a `definePackage` definition (`capabilities: ["host-ui", "credentials"]`). `mcp({ servers })` connects each allowed server during `setup`, registers the discovered tools with `effects: ["external"]` (or `["read"]` with `readOnly: true`), and closes every bridge on dispose. A project-declared server connects only after `host.ui` `confirm` answers yes; a connect failure is a `failed` status plus an `mcp.status` event and a `warn` note. Header values and secret stdio `env` values are `env:`/`keyring:` refs resolved through the credentials slot. `mcp:status`, `mcp:reconnect { id }`, and `mcp:close { id? }` are package commands.
- **Server half moved (plan 159 Task 3).** `createPrismMcpServer`, `createPrismMcpWebHandler`, and `servePrismMcpStdio` now live in `@arnilo/prism-mcp-server`.

## [0.4.0] - 2026-09-01

- Plan 054: family ships as part of the 11-package 0.4 lockstep; peer `@arnilo/prism@^0.4.0`.

# Changelog
## [Unreleased] — 2026-07-28 adoption (plan 063)

### Changed
- **Modular TypeScript SDK v2 (plan 063 task 1):** `@modelcontextprotocol/sdk` 1.30.0 → exact pins `@modelcontextprotocol/client` + `@modelcontextprotocol/server` 2.0.0. All client/server/transport/auth imports moved to the modular packages; `CompatibilityCallToolResultSchema` (`toolResult` member) is gone from the client codec; unknown tools now error (`-32602`) instead of `isError` results; OAuth persistence is SDK issuer-stamped (`StoredOAuthTokens`/`StoredOAuthClientInformation`) with issuer-keyed reads.
- **Modern client negotiation + subscriptions (plan 063 task 2):** `connectMcpTools`/`connectMcpCapabilities` gain `protocolVersion` (`"legacy" | "auto | {pin}`) with one bounded `server/discover` probe per auto connection; the bridge exposes the negotiated `protocolEra`/`protocolVersion`; modern tool calls emit SDK-managed standard headers with `Mcp-Param-*` mirrors from retained `x-mcp-header` declarations; SDK `listChanged` + explicit-cursor list APIs + `callTool({toolDefinition})` replace custom wire handling; SEP-2549 list-cache hints honored (`ttlMs` ceiling = min(hint, configured), absent/zero = refetch-always), cache is private per principal by default.
- **MRTR auto-fulfilment (plan 063 task 3):** elicitation works across eras — legacy `elicitation/create` dispatch, or SDK `input_required` auto-fulfilment on 2026-07-28 (`inputRequired: {autoFulfill: true, maxRounds}` capped by the new `maxMrtrRounds` option, default and hard cap 10). Roots/sampling callbacks are `@deprecated` (SEP-2577) and kept for legacy callers.
- **Dual-era serving (plan 063 task 4):** `createPrismMcpWebHandler(factory)` serves 2026-07-28 via SDK `createMcpHandler` (fresh `McpServer` per request) with the stateless fallback for 2025 traffic, and gains `fetch`/`close`/`notify`/`bus` lifecycle; host/origin allowlists run before body parsing and auth; `servePrismMcpStdio` replaces hand-wired stdio; `cacheHints` option emits SEP-2549 hints. `relayStatelessBody` removed (obsolete).
- **OAuth 2026-07-28 conformance (plan 063 task 5):** `finishAuth(URLSearchParams)` validates persisted `state` fail-closed then RFC 9207 `iss`; issuer-keyed credential storage; CIMD preferred, DCR deprecated (`application_type` defaults `"native"`); explicit `onInsufficientScope: "reauthorize" | "throw"`; server challenges carry the configured scope.
- **Tool schema fidelity + no-arg prompts (found by the official conformance suite, plan 063 task 7):** registered tool `inputSchema` now reaches the wire verbatim via SDK `fromJsonSchema` (`$schema`/`$defs`/`$ref`/`additionalProperties` survive the `tools/list` round-trip; AJV-backed argument validation); prompt `argsSchema` defaults to `{}` so callers may omit the arguments object.

### Added
- `scripts/mcp-conformance-2026.mjs` deterministic official-conformance runner with the recorded boundary baseline (`scripts/mcp-conformance-2026-baseline.yaml`); conformance matrix and performance record in `docs/mcp-tools.md` / `docs/migration.md` (plan 063 task 7). Tasks (`io.modelcontextprotocol/tasks`) intentionally not advertised; draft vocabulary fails closed.

## [0.2.1] - 2026-08-13

### Changed
- 0.2.1 (plan 021): transport pinning lifted to the core pinnedFetch primitive — createSecureMcpFetch and OAuth discovery re-route through it with byte-identical McpBridgeError/McpOAuthError behavior and redirects rejected; boundResponse/defaultResolver/isLoopbackAddress/isLoopbackHostname/normalizeHostname/raceAbort/requestPinned/resolvePinnedAddress remain exported as re-exports from @arnilo/prism (same names/signatures).



## [0.1.1] - 2026-08-10

### Changed
- Stateless SSE relay extracted into `relayStatelessBody` (internal module export, not in the package entry surface) with deterministic unit + E2E tests (`src/__tests__/sse-relay.test.ts`); behavior-preserving.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Added
- MCP OAuth client/server integration (RFC 9728 + RFC 8414 discovery, PKCE, token refresh, RFC 7591 DCR, RFC 8707 resource binding, RFC 7009 revocation): `createMcpClientAuth`, `McpClientAuthOptions`, `McpClientAuthState` persistence seam, `McpOAuthRegistrationStrategy` (static | dcr), `McpOAuthError` (ERR_PRISM_MCP_OAUTH_*), `createMcpOAuthFetch`/`createMcpOAuthTransport` (SSRF-checked, DNS-pinned, redirect-free, byte-bounded discovery fetch; bearer tokens never leave the allowed server origin), `protectedResource` option on `createPrismMcpWebHandler` serving `/.well-known/oauth-protected-resource` with `WWW-Authenticate` challenges on unauthenticated requests.
- `createPrismMcpWebHandler` stateless mode now requires a server factory and creates a fresh SDK transport per request (SDK stateless transports cannot be reused); `McpProtectedResource.resource` is required (RFC 9728, SDK PRM schema).

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Changed
- Released with exact 0.0.26 graph.

## [0.0.25] - 2026-08-06

### Added
- `mcpElicitationDecision` / `mcpElicitationResultFromDecision` map MCP elicitation onto the shared pending-decision model (humanInteraction fail-closed).

### Changed
- Released with exact 0.0.25 graph.

See [migration guide](../../docs/migration.md) for the 0.0.24 → 0.0.25 notes.

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` (memory + PostgreSQL LISTEN/NOTIFY), recoverable `ToolEffectStore`, and AG-UI MCP/MCP Apps/A2A fronting for Phase 7.

### Changed
- Publishable graph remains **47** manifests at **0.0.24**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.23 → 0.0.24 notes.

## [0.0.23] - 2026-08-03

### Changed
- Released with exact 0.0.23 graph.

## [0.0.22] - 2026-07-31

### Changed
- Released with exact 0.0.22 graph.

## [0.0.21] - 2026-07-31

### Changed
- Released with exact 0.0.21 graph.

## [0.0.20] - 2026-07-31

### Changed
- Released with exact 0.0.20 graph.

## [0.0.19] - 2026-07-30

### Changed
- Released with exact 0.0.19 graph.

## [0.0.18] - 2026-07-30

### Changed
- Dependency: `@modelcontextprotocol/sdk` 1.29.0 → 1.30.0 (clears moderate `@hono/node-server` path-traversal advisory on the MCP HTTP stack).

## [0.0.17] - 2026-07-29

### Changed
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Changed

- Released with exact 0.0.14 graph.

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Changed

- Released with exact 0.0.11 graph.

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

## [0.0.8] - 2026-07-20

- Pinned official MCP SDK 1.29.0 and added bounded capability bridge for resources, prompts, roots, sampling, and form/URL elicitation with stable unsupported errors.
- Added explicitly selected, per-call-authorized server resources/prompts and official list-change capability declarations.
- Added opt-in Streamable HTTP sessions bound on every request to host-validated principal identity; stateless mode remains default and Last-Event-ID replay remains unsupported.

## [0.0.7] - 2026-07-19

- `CreatePrismMcpServerOptions.guardrails` applies shared core tool-input/output guardrails to registered Prism tools; commands remain explicit host callbacks.
- `CreatePrismMcpServerOptions.limits` applies shared core tool-call accounting to registered Prism tools.
- Explicit `agentRuns` capabilities register bounded `agent.<id>.status` and `agent.<id>.resume` tools backed by core durable lifecycle CAS; no lifecycle tool is registered by default.

## [0.0.6] - 2026-07-19

- Added finite page/tool/cursor/metadata/schema/JSON/result/client-option limits and atomic discovery refresh using raw SDK list/call requests.
- Streamable HTTP now requires exact HTTPS origins, rejects credentials/fragments/redirects/private or mixed DNS, pins a validated address for every request, and bounds responses; plaintext is loopback-only and explicit.
- Structured content, compatibility `toolResult`, content blocks, and remote error summaries now enter Prism through one aggregate byte/depth/property boundary.

## [0.0.5] - 2026-07-16

- Added explicit authorized Prism tool/command MCP server registration and bounded Web-standard Streamable HTTP handling.

## [0.0.4] - 2026-07-14

- Added stdio/Streamable HTTP transports, paginated listing/cache refresh, deterministic name collision checks, bounded result mapping, abort forwarding, and attributable call timeouts.

## [0.0.3]

- Initial release: `connectMcpTools` MCP client bridge for Plan 055 Task 3.

### ./observability

## [Unreleased]

### Added

- Trace-context propagation (`propagateTraceContext`, plan 214 Task 4): one `model.request` transform injects
  the active chat/run span as W3C `traceparent`/`tracestate` through the API's `propagation.inject`, writing only
  those two headers, never overwriting a caller's value, and falling back to the span ids when no propagator is
  registered or it throws. `usageMetadata` names dotted `Usage.metadata` paths exported as `prism.usage.<path>`
  scalars on the chat span (`content: "metadata"`, subject to `fieldPolicy`). Both default off and cost no request.
  `rawOpenTelemetrySpan`, `injectTraceContext`, `activeTraceSpan` and `formatTraceparent` are exported for hosts.
- `@arnilo/prism-extensions/observability` (plan 160 Task 3): native package turning run, turn, and tool events into OpenTelemetry spans and metrics through observe handlers. Moved the agent-event instrumentation (`createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi`, `createInMemoryTelemetry`) out of `@arnilo/prism-core/governance/observability`. Exports nothing itself.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./workflows

## [Unreleased]

### Added

- `@arnilo/prism-extensions/workflows` (plan 168 Task 2): native package porting the 0.12 graph workflow engine out of `@arnilo/prism-core/runtime/workflows`. Definitions, revision hash, limits, Kahn and superstep scheduling, `functionNode`, `conditionalNode`, `routeNode`, `joinNode`, `loopNode`, `workflowNode`, checkpoints, suspend/resume, replay, and graph export. The `toolNode` kind is retired; a definition using `kind: "tool"` fails `defineWorkflow` with `WorkflowDefinitionError`. Sagas, schedules, the coordinator, swarm, commands, active-run status, and the 0.12 event facade stay behind. The package provides a `workflows` service and consumes `checkpoints`/`leases`, falling back to the in-memory defaults with an `info` status note.

- The `checkpoints` and `leases` service contracts (plan 168 Task 3): `CheckpointStore`, `LeaseStore`, their key/record/input/query types, `CheckpointConflictError`/`CHECKPOINT_CONFLICT_CODE`, `LeaseConflictError`/`LEASE_CONFLICT_CODE`, and the bounded in-memory defaults `createMemoryCheckpointStore`/`createMemoryLeaseStore`. `@arnilo/prism-extensions/workflows/testing` exports `checkpointConformance` and `leaseConformance`.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./approval

## [Unreleased]

### Added

- `@arnilo/prism-extensions/approval` (plan 154 Task 6): `deny` / `ask` / `edits` / `auto` over tool effects and roots, as one `tool.call` handler. An `ask` confirms through `host.ui` or suspends the run. An always answer is a follow-up `select` stored as a per-session grant.

### Changed

- The `tool.call` handler passes the payload's `sessionId` to `coding.targets` (plan 165 Task 7), so "inside roots" follows the calling session: a session bound to a worktree reports that worktree as its root, and a write to the package root from that session counts as outside. Sessions with no worktree are unchanged.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./governance

## [Unreleased]

### Added

- `@arnilo/prism-extensions/governance` (plan 159 Task 6): the `packages/prism-core/src/governance/policy` surface (evaluator, OPA REST adapter, memory/file decision ledgers, approvals, audit export, canonical JSON, limits) moved out of `@arnilo/prism-core`'s `./governance/policy` and `./governance/policy/opa` subpaths, and composed into one package: a `tool.call` gate (deny by default, inline rules or OPA, `approval` → `{ ask }`), opt-in `run.input` / `model.request` gates, an observe-side audit ledger, and the `governance.policy` / `governance.audit` services.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./guardrail-packs

## [Unreleased]

### Added

- `@arnilo/prism-extensions/guardrail-packs` (plan 159 Task 5): the built-in guardrail packs (`coding-standard`, `destructive-commands`, `validation-respect`, `secrets-hygiene`) moved out of the kernel, as restrictive-only `tool.call` / `tool.result` rules with their state in `state.session("packs")` so an `ask` rule survives a durable resume. Pack refs are package config (`guardrailPacks({ packs })`), not a `SessionOptions.guardrailPacks` session option.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./model-router

## [Unreleased]

### Added

- `@arnilo/prism-extensions/model-router` (plan 160 Task 2): native model router package over `model.call`. Routes turns between candidate models using ordered or cost/latency selection, admits budgets atomically, enforces rate and circuit limits, and falls through to fallback candidates on errors before output. Retired the `@arnilo/prism-core/governance/model-router` subpath and `createGovernedProvider`/`providerSource` facades.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./store-codecs

## [Unreleased]

### Changed

- `rowToSessionEntry` keeps any numeric `schema_version` instead of dropping everything but `1`, so a SQL store
  returns an entry from a newer schema unchanged (plan 215 Task 29, `docs/compatibility.md`).

### Added

- `@arnilo/prism-extensions/store-codecs` (plan 153 Task 4): the row codecs, cursor codecs, ownership-scope
  helpers, and SQL query-semantics helper moved out of `@arnilo/prism-core/sessions/codecs` and
  `@arnilo/prism-core/sessions/query-semantics` into a plain library workspace that the SQL store
  packages share. It default-exports no `definePackage` and claims no slot.
- `@arnilo/prism-core/sessions/codecs` is deleted, so the SQL codecs now have exactly one home.
  `@arnilo/prism-core` depends on this package while its Postgres tree is still in the family package
  (it moves to `@arnilo/prism-extensions/store-postgres` in plan 153 Task 5).

### Changed

- The checkpoint and lease conflict errors are defined here instead of imported from `@arnilo/prism`
  (plan 168 Task 4): `CheckpointConflictError`/`CHECKPOINT_CONFLICT_CODE` and
  `LeaseConflictError`/`LEASE_CONFLICT_CODE`. The **code** is the cross-package contract, so consumers
  match `error.code` and a store package never loads the workflows engine.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Prior line. See the root `CHANGELOG.md`.

### ./store-jsonl

## [Unreleased]

### Added

- Forward compatibility (plan 215 Task 29): a line of an unknown `kind` with a valid envelope, or with a
  `schemaVersion` newer than the kernel's, is returned unchanged as an opaque entry instead of being reported in
  `errors`. The store warns once through the new `logger` option (`createJsonlSessionStore({ dir, logger })`;
  the package passes `prism.log`). A structurally invalid line is still an error. See `docs/compatibility.md`.
- `@arnilo/prism-extensions/store-jsonl` (plan 153 Task 3): the JSONL session store moved out of the kernel's
  `./node/session-store-jsonl` subpath. The package default-exports a `definePackage` definition with
  `capabilities: ["slot:store"]` and config `{ dir }`, and claims the slot with
  `prism.slots.store.provide(createJsonlSessionStore({ dir }))`.
- One JSONL file per session (`<dir>/<sessionId>.jsonl`) instead of the 0.12 single caller-named file.
  `listSessions` and `deleteSession` join the store, and `searchSessions`/`list`/`get` work across the
  directory.
- `listSessions` samples the first and last line of each file (never the transcript) and applies the
  ownership scope from those lines; `deleteSession` removes one file and refuses a session outside the
  scope.
- A session id outside the accepted alphabet fails closed with `JsonlSessionStoreError`
  (`invalid_session_id`) before any filesystem call, covering `..` and path separators.
- Exact-retry dedup survives a restart: the keys live in `<dir>/.idempotency.json`, written atomically
  and read fail-soft.
- `readJsonlSessionEntries(path)` is a named export, so a host can parse a file (quarantining bad
  lines) without constructing a store.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.

## [0.0.28] - 2026-08-08

- Prior release anchor carried by the lockstep line.

### ./store-postgres

## [Unreleased]

### Added

- `@arnilo/prism-extensions/store-postgres` (plan 153 Task 5): the PostgreSQL session store moved out of
  `@arnilo/prism-core/sessions/postgres` into a source-exported package on the lockstep line. The
  default export is a `definePackage` definition (`capabilities: ["slot:store", "credentials"]`, config
  `{ url, schema?, pool? }` with `url` a ref-only `x-prism-secret`, and the `postgresStore({ url })`
  instance shorthand) whose `setup` resolves the `url` ref through `prism.credentials.resolve` and
  claims the slot with the persistence object. `pg` is a dependency of this package alone and loads
  lazily; the kernel and `@arnilo/prism-core` never load it. A missing `url` (without a caller-owned
  pool) fails the load with a field-naming error rather than a schema `required`.
- The store gained `listSessions` (one indexed page on `prism_sessions(updated_at, id)`, keyset
  cursor, ownership scope from entry metadata, leaf id plus message count per page),
  `deleteSession` (one transaction, fail-closed scope check, no row left behind), and
  `mergeSessionMetadata` (the session-record merge the kernel's title path writes through).

### Changed

- `setup` registers `prism.services.provide("checkpoints", …)` and `prism.services.provide("leases", …)`
  over the same pool the store slot uses (plan 168 Task 4), so a listed workflows package gets durable
  checkpoints and leases with no second connection. The store contracts (`CheckpointStore`,
  `LeaseStore`) now come from `@arnilo/prism-extensions/workflows` as `import type` only.

## [0.1.0] - 2026-08-09

- Initial `@arnilo/prism-extensions/store-postgres` package skeleton.

## [0.0.28] - 2026-08-08

- Pre-release line, kept for the lockstep changelog anchors the docs gate pins.

### ./store-sqlite

## [Unreleased]

### Added

- `@arnilo/prism-extensions/store-sqlite` (plan 153 Task 4): the SQLite session store moved out of
  `@arnilo/prism-core/sessions/sqlite` into a source-exported package on the lockstep line. The
  default export is a `definePackage` definition (`capabilities: ["slot:store"]`, config
  `{ path, busyTimeoutMs? }`, and the `sqliteStore({ path })` instance shorthand) whose `setup` claims
  the slot with the `SessionStore` facet of `createSqlitePersistence`. A missing `path` fails the load
  with a field-naming error rather than a schema `required` (plan 152 Task 6's config rule).
- The store gains the two optional `SessionStore` capabilities: `listSessions` (one indexed page on
  `prism_sessions(updated_at, id)`, newest-first with a keyset cursor, entry-metadata ownership scope,
  and the title/`workspaceRoot`/message-count/tip summary fields, with one leaf and one count query per
  page) and `deleteSession` (one transaction over entries, FTS rows, idempotency keys, branches, runs,
  events, tool calls, usage, and the record row; fail-closed and non-enumerating for an absent,
  entry-less, or foreign-scope session). The store now passes `storeConformance` with `reopen` and
  `exerciseConcurrentParentAppend`.
- Companion stores stay named exports from the same package (`createSqliteCheckpointStore`,
  `createSqliteLeaseStore`, `createSqlitePersistenceLifecycle`, the migration and DDL constants, and
  the migration appliers) because they share one database and one migration history; their contracts
  are the `checkpoints`/`leases` service contracts in `@arnilo/prism-extensions/workflows` (plan 168 Task 4).
- `@arnilo/prism-core/sessions/sqlite` and `/sessions/codecs` are deleted with no alias. The shared
  codecs now live in `@arnilo/prism-extensions/store-codecs`; importers migrate to the packages
  (`@arnilo/prism-core` keeps the codecs as a dependency for its Postgres tree until plan 153 Task 5).

### Changed

- `setup` registers `prism.services.provide("checkpoints", …)` and `prism.services.provide("leases", …)`
  over the same `SqlitePersistence` it puts in the store slot (plan 168 Task 4), so a listed workflows
  package gets durable checkpoints and leases with no second `Database`. The store contracts
  (`CheckpointStore`, `LeaseStore`) now come from `@arnilo/prism-extensions/workflows` as `import type` only.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Prior line. See the root `CHANGELOG.md`.

### ./compaction

## [Unreleased]

### Changed

- `trigger` (plan 157 Task 5): set it to a JSON-safe `CompactionTrigger` and the package registers it as the session's `compaction.when` vote, so the auto gate travels with the package instead of the host. Past the gate it returns `{ compact: true }`, below it `{ compact: false }` (plan 194 Task 2), so the kernel's `compaction.thresholdEntries` fallback — now used only when every handler abstains — cannot override it. Omitted, no handler is registered and the fallback owns the decision. The model-ref config key now accepts a model object as well as a `"provider/model"` string (the outer schema node stays open so the `anyOf` branch validates the keys).

### Added

- The LLM compactor's stored `compaction` entry now carries `data.trigger` (`"manual"`, `"auto"`, or `"overflow"`), matching the kernel compactor, so a host can tell why a branch was compacted (plan 194 Task 3). Progress events (`compaction.completed`) carry the same value.
- `@arnilo/prism-extensions/compaction` (plan 157 Task 3): the LLM summarization compactor moved out of
  `@arnilo/prism-memory`'s `./compaction/llm` subpath into a source-exported package on the lockstep
  line. The default export is a `definePackage` definition that claims the `compaction` slot and
  summarizes the dropped history with one model call per compaction, through
  `prism.models.client(config.model ?? ctx.session.model)`. Config: `{ model?, profile?, keepRecentTokens?, maxSummaryTokens?, summaryPrompt? }`.
  Installing the package is the opt-in; without it the kernel's deterministic compactor makes no
  model call.
- The `compaction.fallback` package event: a failed summary falls back to
  `prism.slots.compaction.default` with a redacted, bounded reason instead of failing the run or
  leaving the branch uncompacted. An aborted signal still propagates and appends nothing.
- The coding profile keeps the latest plan turn (`todo_write` result plus its call) out of the cut,
  so the plan survives any number of compactions.

### Removed

- `@arnilo/prism-memory`'s `./compaction/llm` subpath and the inert `llmCompaction` package. The
  moved module surface (`prepareLlmCompaction`, `serializeCompactionConversation`,
  `collectFileOperations`, the limits and token estimators, the prompts) stays available as named
  exports of the new package's modules for tests and hosts that build their own compactor.
- The `provider`, `summaryProvider`, `summaryModel`, `credential`, `credentialRequest`,
  `providerOptions`, `requestTransforms`, `thinkingLevel`, and `maxOutputTokens` compactor options.
  The model call is the kernel's (`models.client`), the credential is the credentials slot's, and
  the request budget is derived from `maxSummaryTokens`.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The LLM compactor shipped inside `@arnilo/prism-compaction-llm` and then `@arnilo/prism-memory`'s
`./compaction/llm` subpath before this package existed; see those packages' changelogs for the
pre-split history.
