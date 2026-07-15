# Tool Validation, MCP, Parallelism, and Execution Safety

## Objectives

- Validate model-supplied tool arguments against declared JSON Schema before execution.
- Add MCP client interoperability and opt-in deterministic parallel tool execution.
- Add first-class approval/sandbox policy for dangerous coding tools and bound image reads.

## Expected Outcome

- Invalid tool calls become safe tool errors without invoking handlers.
- Prism can discover/call MCP tools over stdio and Streamable HTTP through an optional package.
- Independent calls can run concurrently while transcripts remain deterministic.
- Shell/write/edit/read operations can be constrained by command/path/risk policy and approval.

## Tasks

- [x] 0. Review existing tool, permission, extension, and transport primitives
  - Acceptance Criteria:
    - Functional: Inventory covers `ToolDefinition.parameters`, dispatch/validation, `PermissionPolicy`, extensions/contributions, abort, events, coding-tool path/shell controls, and MCP mapping needs.
    - Performance: Design identifies one schema compilation/cache point and bounded parallelism; avoids per-call recompilation.
    - Code Quality: Generic core primitives are separated from MCP/coding package policy; no MCP-specific core contracts or coding-specific permission branches.
    - Security: Threat model covers untrusted schemas/servers, subprocess/HTTP transport, tool-name collisions, command injection, symlink/path escape, approvals, output limits, and cancellation.
  - Inventory result (2026-07-14):
    - **Core harness (shipped):** `ToolDefinition.parameters` is metadata only; `dispatchToolCall` in `src/tools.ts` enforces lookup → filter → object args → `assertPermission(tool:execute)` → optional `ToolValidator` → `execute`, with middleware `tool_call`/`tool_result` and ledger/events. Phase 25 already threads `AgentConfig.validator` / `RunOptions.validate` through `src/agents.ts`.
    - **Loop (shipped, sequential):** `singleShotLoop` in `src/agent-loops.ts` dispatches tool calls one at a time; `maxToolRounds` defaults to `1`. Plan 053 transcript ordering prerequisite (R-002) is **implemented**.
    - **Permission (shipped, name-only):** `PermissionPolicy` in `src/security.ts` keys `kind:target:action`; no structured command/path context.
    - **Extensions (shipped, inert):** `ExtensionAPI.registerTool` contributes to `ContributionRegistries.tools`; `createExtensionKernel({ permission })` gates `extension:<name>:setup`. No transport or MCP code in core.
    - **Coding-agent gaps:** `packages/coding-agent` allows absolute paths outside cwd, arbitrary shell via `-c`, full image read + base64 (`autoResizeImages` no-op, R-011), bounded text/shell output only. No execution-policy seam.
    - **Gaps → Tasks 1–5:** JSON Schema adapter (C-001), `toolConcurrency` on single-shot loop (C-007), `@arnilo/prism-mcp` optional package (C-003), core `ExecutionPolicy` + coding adapter (C-006), `maxImageBytes`/`transformImage` on read (R-011).
    - Decision record: `docs/tool-execution-primitives.md`.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md`, `docs/tool-conformance.md`, `docs/host-security.md`, `docs/extensions.md`, `docs/contribution-registries.md`, `docs/coding-agent-tools.md`.
      - MCP TypeScript SDK v1.29.0 docs: `Client`, `StdioClientTransport`, Streamable HTTP, `listTools`, `callTool`, timeout/AbortSignal, close.
    - Options Considered:
      - Add behavior directly to loop/MCP package: duplicates generic validation/permission needs.
      - Define reusable validator/execution-policy seams first: chosen.
    - Chosen Approach:
      - Write primitive decision record and conformance matrix before contracts/packages.
    - API Notes and Examples:
      ```ts
      interface ToolArgumentValidator { validate(schema: JsonObject, value: unknown): ValidationResult }
      ```
    - Files to Create/Edit:
      - `docs/tool-execution-primitives.md`, `docs/review-coverage-2026-07-14.md`, `docs/index.md`.
    - References:
      - Review capability gaps #1, #3, #6, #7 and coding-tool security finding.
  - Test Cases to Write:
    - Matrix includes malformed args, schema cache, abort, duplicate names, approval denial, path escape, MCP timeout, and deterministic parallel result ordering.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no implementation yet.
    - Docs pages to create/edit: `docs/tool-execution-primitives.md`, `docs/review-coverage-2026-07-14.md`.
    - `docs/index.md` update: yes — Tools → Execution primitives.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 1. Add host-injected tool argument validation with a standards adapter
  - Acceptance Criteria:
    - Functional: Runtime validates parsed arguments before handler invocation; invalid arguments return attributable tool errors; missing validator has explicit policy; optional standards adapter supports declared JSON Schema dialect/features.
    - Performance: Schemas compile once per tool definition/registry generation; validation has configured depth/size bounds.
    - Code Quality: Core exposes tiny validator interface and uses existing `validate` hook compatibly; concrete validator dependency stays optional package.
    - Security: Reject prototype-pollution keys, unsafe refs/remote schema loading, oversized/deep values, and malformed schemas; handlers never run after failure.
  - Implementation result (2026-07-14):
    - Core: `ToolArgumentValidator`, `ToolArgumentValidationResult`, `createToolParameterValidator()` in `src/tools.ts`; exported from `@arnilo/prism`.
    - Package: `@arnilo/prism-tool-validator-json-schema` with `createJsonSchemaArgumentValidator()` and `createJsonSchemaToolArgumentValidator()` (Ajv 8, in-memory compile cache, instance bounds, remote `$ref` rejection).
    - Dispatch unchanged: validation still flows through existing `ToolValidator` after permission, before `execute`; `validation_failed` + redaction preserved.
    - `missingSchema: "allow" | "reject"` explicit policy for tools without `parameters`.
  - Approach:
    - Documentation Reviewed:
      - Existing `ToolDefinition`/dispatcher contracts; `docs/tools.md`; current JSON Schema validator library docs/version selected during execution.
    - Options Considered:
      - Mandatory core dependency: rejected.
      - Host-injected interface + optional `@arnilo/prism-tool-validator-json-schema`: chosen.
    - Chosen Approach:
      - Reuse existing `ToolValidator` / `dispatchToolCall({ validate })` seam; add `ToolArgumentValidator` interface in core and `createJsonSchemaToolArgumentValidator()` in optional package with per-`(toolName, schemaHash)` compile cache (Task 0 design).
    - API Notes and Examples:
      ```ts
      const validate = createJsonSchemaToolArgumentValidator();
      createAgent({ model, validator: validate });
      ```
    - Files to Create/Edit:
      - `src/tools.ts` (`ToolArgumentValidator`, optional `createToolParameterValidator` helper); `src/index.ts` exports.
      - New `packages/tool-validator-json-schema/**`; root workspace/build/install files.
      - `docs/tools.md`, `docs/tool-conformance.md`, `docs/host-security.md`, `docs/tool-execution-primitives.md`, `docs/index.md`.
    - References:
      - Task 0 design; review capability gap #1; `src/tools.ts` dispatch order.
  - Test Cases to Write:
    - Valid/invalid/nested/ref/oversized args, malformed schema, cache reuse, no invocation after failure, redacted diagnostic.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — validator extension point/package and dispatch behavior.
    - Docs pages to create/edit: `docs/tools.md`, `docs/tool-conformance.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes — validator setup under Tools.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Add bounded deterministic parallel tool-call execution
  - Acceptance Criteria:
    - Functional: Configured independent calls execute concurrently up to limit; results/events/transcript are emitted in original call order; sequential remains default; abort/error policies are explicit.
    - Performance: Demonstrate latency reduction with delayed independent calls; no more than configured concurrency; queues bounded by calls in one turn.
    - Code Quality: Use native promises and existing dispatcher; no scheduler class; option merges follow current loop config.
    - Security: Permission and argument validation complete per call before execution; abort cancels pending work; dangerous calls can force sequential policy.
  - Implementation result (2026-07-14):
    - `AgentLoopOptions` single-shot branch: optional `toolConcurrency` (default `1`).
    - `LoopContext.toolConcurrency` threaded from `resolveToolConcurrency(RunOptions.loop ?? AgentConfig.loop)`.
    - `dispatchToolCallsInOrder()` in `src/agent-loops.ts`: bounded worker pool, ordered transcript append, abort between worker claims.
    - Sequential default preserved; concurrency capped at `calls.length`.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-loops.md`, `docs/tools.md`, existing abort/retry/event ordering contracts.
    - Options Considered:
      - Always parallel: unsafe behavior change.
      - Opt-in `toolConcurrency` with ordered `Promise.all`: chosen.
    - Chosen Approach:
      - Extend single-shot `AgentLoopOptions` with `toolConcurrency` (default `1`); `singleShotLoop` uses index slots + bounded workers; results/transcript in call order (Task 0 design). Plan 053 R-002 prerequisite is met.
    - API Notes and Examples:
      ```ts
      loop: { strategy: "single-shot", toolConcurrency: 4 }
      // maxToolRounds remains on AgentConfig / RunOptions (default 1)
      ```
    - Files to Create/Edit:
      - `src/contracts.ts` (`AgentLoopOptions`, `LoopContext.toolConcurrency`), `src/agent-loops.ts`, `src/agents.ts`, tests.
      - `docs/agent-loops.md`, `docs/tools.md`, `docs/performance.md`, `docs/tool-execution-primitives.md`, `docs/index.md`.
    - References:
      - Task 0 design; review capability gap #7; `src/agent-loops.ts` sequential loop.
  - Test Cases to Write:
    - Concurrency limits 1/2/N, ordered outputs despite reverse completion, abort, denial, exclusive call, mixed failure.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — loop option and execution semantics.
    - Docs pages to create/edit: `docs/agent-loops.md`, `docs/tools.md`, `docs/performance.md`.
    - `docs/index.md` update: yes — tool execution configuration.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 3. Add first-party MCP client bridge package
  - Acceptance Criteria:
    - Functional: Package connects over stdio and Streamable HTTP, paginates/list tools, maps schemas/descriptions, invokes tools, maps text/image/resource content and errors, handles list-changed, timeout/abort, and closes transports.
    - Performance: Tool list is cached with invalidation; result/content sizes and request timeouts are bounded; no orphan subprocesses/readers.
    - Code Quality: MCP dependency is isolated to `@arnilo/prism-mcp`; bridge returns ordinary `ToolDefinition`s and uses core validation/permission primitives.
    - Security: Stdio command/env/cwd and remote URL/auth require explicit trusted config; name collisions are namespaced; server output is untrusted/bounded/redacted; SSRF guidance is documented.
  - Implementation result (2026-07-14):
    - Package: `@arnilo/prism-mcp` with `connectMcpTools()`, `attachMcpToolBridge()`, stdio + Streamable HTTP transports via official SDK v1.29.
    - Prefixed tool names (`mcp:<serverId>:<name>`), paginated `listTools`, TTL cache + `notifications/tools/list_changed` invalidation, bounded `maxResultBytes`, per-call timeout/abort.
    - Content mapping: text/image blocks; resource/audio/link summarized as text; `isError` → `ToolResult.error`.
    - Docs: `docs/mcp-tools.md`; packaging/install-smoke lists updated.
  - Approach:
    - Documentation Reviewed:
      - MCP TypeScript SDK v1.29.0 `/modelcontextprotocol/typescript-sdk/v1.29.0`: `Client.connect/close`, `StdioClientTransport`, Streamable HTTP, paginated `tools/list`, `tools/call`, `RequestOptions.signal/timeout`.
      - MCP protocol tool schema/content/error semantics current at implementation.
    - Options Considered:
      - Implement JSON-RPC/transports manually: rejected.
      - Official SDK in optional package: chosen.
    - Chosen Approach:
      - Wrap official MCP TypeScript SDK in `@arnilo/prism-mcp`; map remote tools to prefixed `ToolDefinition`s (`mcp:<serverId>:<name>`); rely on core dispatch for permission + JSON Schema validation (Task 0 design).
    - API Notes and Examples:
      ```ts
      const bridge = await connectMcpTools({ serverId: "fs", transport: { type: "stdio", command: "node", args: ["server.js"] } });
      agent.registerTools(bridge.tools);
      await bridge.close();
      ```
    - Files to Create/Edit:
      - New `packages/mcp/{package.json,tsconfig,src/**,tests,README.md,CHANGELOG.md}` as `@arnilo/prism-mcp`.
      - Root workspace/lock/build/install/package files; umbrella inclusion decision.
      - `docs/mcp-tools.md`, `docs/tools.md`, `docs/host-security.md`, `docs/tool-execution-primitives.md`, `docs/index.md`.
    - References:
      - Task 0 design; MCP TypeScript SDK v1.29.0; review capability gap #3.
  - Test Cases to Write:
    - Mock stdio/HTTP servers: pagination, call success/error, list-changed, image/resource mapping, timeout/abort/close, collision, oversized output, hostile URL/config.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package/tool source/lifecycle.
    - Docs pages to create/edit: `docs/mcp-tools.md`, `docs/tools.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes — Tools → MCP client bridge.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 4. Add approval and sandbox policy package for coding tools
  - Acceptance Criteria:
    - Functional: Hosts can approve/deny/modify shell command and filesystem operations using structured action metadata; path scopes, command allow/deny rules, read-only mode, per-run/session approval caching, and pluggable sandbox execution are supported.
    - Performance: Noninteractive policy checks add negligible overhead; approval waits are abortable and timeout-bounded.
    - Code Quality: Generic execution-policy contract lives in core; coding classifications/adapters live in optional package; one implementation can wrap existing coding tools without forks.
    - Security: Defaults deny out-of-scope absolute paths, symlink escapes, shell metacharacter/escalation patterns selected by policy, and writes/shell without approval; no claim of OS isolation unless sandbox adapter provides it.
  - Implementation result (2026-07-14):
    - Core: `ExecutionAction`, `ExecutionPolicy`, `ExecutionDecision`, `assertExecutionAllowed()`, `checkExecution()`, `applyExecutionDecision()`, `ExecutionDeniedError` in `src/execution-policy.ts`.
    - Coding-agent: optional `executionPolicy` on each tool factory and `ToolsOptions`; `enforceExecutionPolicy()` helper checks policy inside `execute` before side effects; supports `modified` command/path fields.
    - Package: `@arnilo/prism-coding-security` with `createCodingApprovalPolicy()` (roots, approve, readOnly, commandRules, approval cache/timeout), path containment helpers, default deny patterns, metacharacter approval, and `createSandboxBashOperations()`.
    - Docs: `docs/coding-security.md`; packaging/install-smoke lists updated.
  - Approach:
    - Documentation Reviewed:
      - `docs/host-security.md`, `docs/coding-agent-tools.md`, `src/security.ts`, coding tool sources.
    - Options Considered:
      - Tool-name permission only: insufficient context.
      - Structured pre-execution action policy + optional process sandbox adapter: chosen.
    - Chosen Approach:
      - Add core `ExecutionPolicy` / `ExecutionAction` in `src/security.ts` (or `src/execution-policy.ts`); coding tools call policy inside `execute` before side effects; optional `@arnilo/prism-coding-security` supplies approval/path/command rules (Task 0 design). Keep `PermissionPolicy` name-based at dispatch.
    - API Notes and Examples:
      ```ts
      createCodingTools(cwd, { executionPolicy: createCodingApprovalPolicy({ roots: [cwd], approve }) });
      ```
    - Files to Create/Edit:
      - `src/security.ts` (or `src/execution-policy.ts`), contracts/exports/tests.
      - `packages/coding-agent/src/{shell,read,write,edit}.ts` and tests.
      - New `packages/coding-security/**` as `@arnilo/prism-coding-security`.
      - `docs/host-security.md`, `docs/coding-agent-tools.md`, `docs/settings-auth-trust-security.md`, `docs/tool-execution-primitives.md`, `docs/index.md`.
    - References:
      - Task 0 design; review capability gap #6; coding-tool absolute-path/shell risk.
  - Test Cases to Write:
    - Path/symlink escape, shell approval/denial/modification, timeout/abort, cache scope, read-only, sandbox error, metadata redaction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — execution policy and coding-tool options/package.
    - Docs pages to create/edit: `docs/host-security.md`, `docs/coding-agent-tools.md`, `docs/settings-auth-trust-security.md`.
    - `docs/index.md` update: yes — Security/auth/trust → Coding execution approval and sandboxing.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. Bound coding-agent image reads and resolve no-op resize option
  - Acceptance Criteria:
    - Functional: Image reads enforce configurable finite byte/dimension policy; oversize returns clear result; `autoResizeImages` is implemented via optional transformer or deprecated/removed through documented compatible path.
    - Performance: Reject by stat before read where possible; avoid unnecessary duplicate/base64 buffers; benchmark boundary image.
    - Code Quality: No image-processing dependency in base package unless chosen after measured need; transformer extension is generic enough for alternate implementations.
    - Security: Decompression bombs/oversized content are bounded; MIME detection does not trust extension alone; path approval from Task 4 applies.
  - **Result:** `packages/coding-agent/src/read.ts` adds `DEFAULT_MAX_IMAGE_BYTES` (10 MB), `maxImageBytes`, `transformImage`, and `ReadOperations.statFile` for stat-first rejection before read; post-read and post-transform size checks; deprecated `autoResizeImages` (ignored without `transformImage`); image metadata `{ mimeType, resized, bytes }`. Tests in `read.test.ts` cover below/at/above limits, stat-before-read, spoofed extension, transformer success/failure, and deprecated flag. Docs: `docs/coding-agent-tools.md`, `docs/performance.md`, `docs/tool-execution-primitives.md`, `docs/index.md`, `docs/review-coverage-2026-07-14.md`.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/read.ts`, tests, README; `docs/coding-agent-tools.md`.
    - Options Considered:
      - Pretend raw bytes are resize: rejected.
      - Finite reject default + optional transformer: chosen.
    - Chosen Approach:
      - Add `maxImageBytes` and optional `transformImage`; deprecate no-op flag unless transformer can honor it.
    - API Notes and Examples:
      ```ts
      createReadTool(cwd, { maxImageBytes: 10_000_000, transformImage });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/read.ts`, exports/types/tests/README/changelog.
      - `docs/coding-agent-tools.md`, `docs/performance.md`.
    - References:
      - Review image-read P2 finding.
  - Test Cases to Write:
    - Below/at/above size, spoofed extension, abort, transformer success/failure, no raw bytes after rejection.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — read-tool options/limits.
    - Docs pages to create/edit: `docs/coding-agent-tools.md`, `docs/performance.md`.
    - `docs/index.md` update: yes — coding tools entry mentions bounded media reads.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Verify tool ecosystem and security phase
  - Acceptance Criteria:
    - Functional: Core/tool/MCP/coding conformance and package install tests pass; review matrix closes all 055 rows.
    - Performance: Validation cache, parallelism, MCP limits, and image bounds benchmarks meet tasks.
    - Code Quality: Public exports/types/docs and lifecycle cleanup pass; no duplicate execution path introduced.
    - Security: Threat-model tests, secret scans, malicious MCP/schema/path/command cases, and audit pass.
  - Verification result (2026-07-14):
    - `npm run sdk:ready` pass: typecheck + 1,305 tests (1,280 pass / 25 live skips / 0 fail) + all workspace `pack:dry-run`.
    - Focused Plan 055 matrix pass (342 tests): core tools/loops/execution-policy/export/install/packaging + `@arnilo/prism-tool-validator-json-schema` (12), `@arnilo/prism-mcp` (11), `@arnilo/prism-coding-security` (10), coding-agent read/shell/execution-policy.
    - `npm audit --audit-level=high` → 0 vulnerabilities; workspace tree clean (`ajv@8`, `@modelcontextprotocol/sdk@1.29.0`).
    - Review matrix rows C-001 / C-003 / C-006 / C-007 / R-011 marked **implemented** with evidence in `docs/review-coverage-2026-07-14.md`.
  - Approach:
    - Documentation Reviewed:
      - Tasks 0-5 docs, `docs/tool-conformance.md`, release gates.
    - Options Considered:
      - Final-only validation: rejected.
      - Phase conformance plus Plan 058 rerun: chosen.
    - Chosen Approach:
      - Run focused and aggregate package gates, dry-run/install new packages, and record evidence.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-14.md`; plan completion evidence.
    - References:
      - Plan 058.
  - Test Cases to Write:
    - No new cases; execute all 055 matrices.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: `docs/review-coverage-2026-07-14.md` evidence.
    - `docs/index.md` update: no additional entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Core remains dependency-free. Optional tool packages are available atomically and through `prism-base`/`prism-code`/`prism-sdk`; `prism-all` intentionally includes the complete graph.
- Exclusive dispatch uses a static `ToolDefinition.exclusive` marker because policy decisions cannot safely be discovered after parallel side effects begin. Dynamic policies must expose the marker before dispatch.
- `autoResizeImages` remains a deprecated no-op unless `transformImage` is supplied — no image-processing dependency in `@arnilo/prism-coding-agent`.
- Permission denial during a parallel batch remains covered by per-call blocked results, ordered transcript slots, and the packed coding-policy composition fixture rather than another duplicate dispatcher suite.

## Further Actions

- Resolved by Plan 058 Task 1: packed JSON Schema + MCP + parallel dispatch + coding approval and hung-call timeout fixtures pass.
- Resolved by Plan 058 Task 2: schema-cache and parallel-overlap measurements are published.
- Resolved by Plan 058 Task 3: exclusive shell turns serialize without lowering later non-exclusive concurrency.
- Resolved by Plan 058 Task 5: family/profile graph is frozen and `prism-all` reaches all 24 packages.
- No post-0.0.4 action remains from Plan 055.
