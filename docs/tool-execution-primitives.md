# Tool execution primitives

## What it does

This page freezes the reusable tool validation, parallel dispatch, MCP bridge, and coding execution-policy designs for Plan 055. It inventories existing `@arnilo/prism` tool harness seams, `@arnilo/prism-coding-agent` behavior, extension/contribution boundaries, and the MCP mapping surface Tasks 1–6 will implement against.

Implementation is **shipped** for JSON Schema tool argument validation (Plan 055 Task 1), parallel single-shot tool dispatch (Task 2), the MCP client bridge (Task 3), coding execution policy (Task 4), and bounded image reads (Task 5). Task 6 verification evidence is recorded in [review coverage](review-coverage-2026-07-14.md).

## When to use it

- **Core and package authors** extending tool dispatch should reuse the seams documented here instead of adding MCP-specific branches to core or duplicating validation in the agent loop.
- **Host apps** wire JSON Schema validation through the existing `ToolValidator` / `dispatchToolCall({ validate })` path (Phase 25) and opt into parallelism, MCP tools, and coding execution policy through the frozen APIs below.
- **Security reviewers** use the threat model and conformance matrix on this page as the acceptance baseline for Plan 055 Tasks 1–6.

## Inputs / request

| Surface | Input |
| --- | --- |
| JSON Schema validation | `ToolDefinition.parameters` plus bounded validator options |
| Parallel dispatch | `single-shot` loop `toolConcurrency`; optional `ToolDefinition.exclusive` |
| MCP | Explicit server id, transport, timeout/cache/result bounds |
| Coding policy | `ExecutionAction`, roots/rules, approval callback, optional sandbox |
| Image reads | Path plus `maxImageBytes` and optional `transformImage` |

## Outputs / response / events

All paths converge on normal `ToolResult` values and `tool_execution_*` events. Validation/permission/policy failures block handlers before side effects. Parallel handlers may finish out of order, but transcript `tool_result` messages append in provider call order; any exclusive tool serializes only its turn.

## Request/response example

```json
{
  "loop": { "strategy": "single-shot", "toolConcurrency": 2 },
  "tool": { "name": "shell", "exclusive": true },
  "result": { "dispatchConcurrencyForTurn": 1 }
}
```

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";
import { createJsonSchemaToolArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";

const agent = createAgent({
  model,
  provider,
  tools,
  validator: createJsonSchemaToolArgumentValidator({ missingSchema: "reject" }),
  loop: { strategy: "single-shot", toolConcurrency: 2 },
});
```

## Inventory (2026-07-14 baseline)

Static review of `src/tools.ts`, `src/security.ts`, `src/agent-loops.ts`, `src/agents.ts`, `src/extensions.ts`, `src/contributions.ts`, `packages/coding-agent/src/**`, and `docs/tools.md`.

### Core tool harness (shipped)

| Surface | Location | Behavior today |
| --- | --- | --- |
| `ToolDefinition` | `src/contracts.ts` | `name`, optional `description`, optional `parameters?: JsonObject`, `execute(args, context)` |
| `ToolRegistry` / `createToolRegistry` | `src/tools.ts` | Insertion-order registry; `duplicate: "replace" \| "error"` |
| `filterTools` | `src/tools.ts` | Exact-name allow/deny; deny wins; multiple filters require every non-empty allow |
| `dispatchToolCall` | `src/tools.ts` | Full lifecycle: lookup → filter → object-args check → permission → validate → execute |
| `ToolValidator` | `src/tools.ts` | `(tool, args, context) => void \| string \| ErrorInfo \| Promise<...>` |
| Runtime threading | `src/agents.ts` | `validate: options.validate ?? agent.config.validator` passed to `dispatchToolCall` |
| `PermissionPolicy` | `src/security.ts` | Keyed `kind:target:action` (tool dispatch uses `tool:<name>:execute`) |
| Abort | `ToolExecutionContext.signal` | Bridged from `RunOptions.signal` / run `AbortController` |
| Events | `AgentEvent` | `tool_execution_blocked`, `tool_execution_started`, `tool_execution_progress`, `tool_execution_finished`, `tool_execution_error` |
| Ledger | `RunLedger` | Optional `ToolCallRecord` rows with redaction |
| Middleware | `MiddlewareRegistry` | `tool_call` before permission/validate; `tool_result` after execute; dispatch re-checks lookup/filter/args after `tool_call` |
| Conformance | `src/testing/tool-conformance.ts` | Blocked-reason matrix + success path |

### Dispatch order (frozen — do not reorder)

```
middleware tool_call
  → registry lookup + filter + JSON-object args
  → assertPermission(tool:execute)
  → ToolValidator (optional)
  → tool.execute
  → middleware tool_result
  → events + ledger
```

Blocked reasons today: `unknown_tool`, `tool_denied`, `invalid_arguments`, `permission_denied`, `validation_failed`.

### Agent loop tool execution (shipped)

| Surface | Location | Behavior today |
| --- | --- | --- |
| `singleShotLoop` | `src/agent-loops.ts` | Sequential `for (const call of calls) await dispatchToolCall(call)` per provider turn |
| `maxToolRounds` | `AgentConfig` / `RunOptions` → `LoopContext` | Default `1` in `RuntimeAgentSession.run()` |
| Transcript ordering | `src/agent-loops.ts` | Tool results appended in call order (Plan 053 R-002 fix shipped) |
| Parallelism | — | **None** — models may emit multiple calls; runtime executes one at a time |

### Extension and contribution boundaries (shipped)

| Surface | Location | Behavior today |
| --- | --- | --- |
| `ExtensionAPI.registerTool` | `src/extensions.ts` | Contributes inert `ToolDefinition` to `ContributionRegistries.tools` |
| Extension setup permission | `createExtensionKernel({ permission })` | `extension:<name>:setup` before `setup()` |
| Activation | Host-owned | Contributions never auto-register into an active `ToolRegistry` or dispatch loop |
| Discovery | `src/node/contribution-discovery.ts` | Opt-in scan; no `import()`, no activation |

No MCP, subprocess transport, or remote tool protocol exists in core.

### Coding-agent package (shipped — policy gaps)

| Tool | Path/shell controls today | Output bounds | Gaps |
| --- | --- | --- | --- |
| `shell` | `spawnHook`, `commandPrefix`, `shellPath`; runs arbitrary `-c` command | `maxLines` / `maxBytes` tail + temp spill; timeout + abort kill process tree | No command allow/deny, approval, or sandbox |
| `read` | `resolveToCwd` / `resolveReadPath` — **absolute paths allowed outside cwd**; no symlink realpath containment | Text: `maxLines` / `maxBytes`; images: `maxImageBytes` (default 10 MB) stat-first reject + optional `transformImage` | No symlink realpath containment in base package |
| `write` | `resolveToCwd` — absolute paths allowed | Per-path `withFileMutationQueue` | No scope/approval |
| `edit` | Same as write | Same queue | No scope/approval |

Package performs **no** `PermissionPolicy`, `ToolValidator`, or trust checks of its own. Hosts must gate registration and dispatch.

### JSON Schema / `parameters` metadata

| Concern | Status |
| --- | --- |
| `ToolDefinition.parameters` | Stored and forwarded to providers; **not validated** by core |
| `ToolValidator` | Host function hook; Phase 25 threads through agent runtime |
| Standards-based schema validation | Optional `@arnilo/prism-tool-validator-json-schema`; host wires it through `ToolValidator` |
| Schema compile cache | Adapter-owned finite LRU; core never compiles schemas |

### MCP mapping (shipped — Task 3)

| MCP concept | Prism mapping (planned) |
| --- | --- |
| `tools/list` `inputSchema` | `ToolDefinition.parameters` |
| `tools/call` arguments | `ToolCallContent.arguments` after provider parse |
| `tools/call` content blocks | `ToolResult.content` (`text`, `image`, resource → host-defined blocks) |
| Tool names | Prefixed `mcp:<serverId>:<name>` to avoid collisions |
| Transports | Stdio + Streamable HTTP via official MCP TypeScript SDK in optional package |
| Lifecycle | Explicit `connect` / `close`; list-changed invalidates cache |

## Gaps and chosen generic APIs (frozen for Task 1+)

### Decision table

| Concern | Option A | Option B | **Chosen** | Rationale |
| --- | --- | --- | --- | --- |
| JSON Schema validation | Mandatory core dependency | Host `ToolValidator` + optional standards adapter package | **B** | Matches Phase 25 seam; keeps core dependency-free |
| Validator interface | New `ToolArgumentValidator` replacing `ToolValidator` | `ToolArgumentValidator` factory → `ToolValidator` | **Factory → `ToolValidator`** | Reuses dispatch order and `validation_failed` events unchanged |
| Schema compile cache | Per-call in core | Once per tool/schema identity in adapter package | **Adapter cache** | Single compilation point; core stays O(validate) only |
| Parallel tool calls | Always parallel | Opt-in `toolConcurrency` on single-shot loop | **Opt-in** | Sequential remains default; transcript order preserved |
| Parallel ordering | Completion order | Original call index slots | **Index slots** | Deterministic history/events despite concurrent execute |
| MCP integration | Core JSON-RPC | Optional `@arnilo/prism-mcp` over official SDK | **Optional package** | No MCP types in core contracts |
| Coding safety | Extend `PermissionPolicy` with tool-name branches | Generic `ExecutionPolicy` + coding adapter package | **ExecutionPolicy in core** | Permission stays name-based; path/command/risk is structured metadata |
| Image bounds | Silent truncate | Stat-first reject + optional `transformImage` | **Reject + optional transform** | Avoid decompression bombs; no fake resize |
| Sandbox | Core process isolation | Pluggable sandbox adapter in optional package | **Pluggable adapter** | Prism does not claim OS isolation unless host provides it |

### Task 1 — JSON Schema validation — **shipped**

Core (`@arnilo/prism`):

```ts
export interface ToolArgumentValidationError {
  readonly path?: string;
  readonly message: string;
}

export interface ToolArgumentValidationResult {
  readonly ok: boolean;
  readonly errors?: readonly ToolArgumentValidationError[];
}

export interface ToolArgumentValidator {
  validate(schema: JsonObject, value: unknown): ToolArgumentValidationResult;
}

export function createToolParameterValidator(
  validator: ToolArgumentValidator,
  options?: { missingSchema?: "allow" | "reject" },
): ToolValidator;
```

Optional package `@arnilo/prism-tool-validator-json-schema`:

```ts
import { createJsonSchemaToolArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";

createAgent({ model, validator: createJsonSchemaToolArgumentValidator() });
```

**Cache key:** stable `JSON.stringify(schema)` in an adapter-owned 256-entry LRU (hard cap 1,024); eviction removes the matching Ajv schema. **Bounds:** schemas default to 256 KiB, depth 64, 10,000 properties/keywords, and 128 refs (hard 1 MiB/128/100,000/1,024); instance depth/properties/string/array limits remain configurable. Every limit rejects non-finite, unsafe, zero/negative, and above-hard values. **Security:** only fragment-local `$ref` is accepted; prototype-pollution keys, cycles, and non-finite schema numbers reject before Ajv compilation.

### Task 2 — Parallel tool execution — **shipped**

```ts
// AgentConfig.loop / RunOptions.loop (single-shot only)
| {
    readonly strategy: "single-shot";
    readonly toolConcurrency?: number; // default 1
  }

// LoopContext
readonly toolConcurrency: number;

export async function dispatchToolCallsInOrder(
  calls: readonly ToolCallContent[],
  ctx: LoopContext,
): Promise<void>;
export function resolveToolConcurrency(...): number;
```

Bounded worker pool: at most `min(toolConcurrency, calls.length)` concurrent `dispatchToolCall` invocations per turn; history/store appends in call order. Abort checks between worker claims and before transcript append.

**Exclusive calls:** `ToolDefinition.exclusive: true` clamps only the containing turn to concurrency `1`. Coding-agent shell definitions carry this marker, matching coding-security's `ExecutionDecision.exclusive: true`; later non-exclusive turns use configured concurrency again. Custom tools whose policy can return an exclusive decision must also expose the static marker so the dispatcher can serialize before execution. Permission and validation still run at dispatch before each side effect.

### Task 3 — MCP client bridge — **shipped**

New optional package `@arnilo/prism-mcp`:

```ts
export interface McpToolBridge {
  readonly tools: readonly ToolDefinition[];
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export async function connectMcpTools(options: {
  readonly serverId: string;
  readonly transport: McpStdioTransport | McpStreamableHttpTransport;
  readonly namePrefix?: string;
  readonly listCacheTtlMs?: number;
  readonly callTimeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly signal?: AbortSignal;
}): Promise<McpToolBridge>;
```

Bridge `execute` delegates to MCP `tools/call`, maps content to `ToolResult`, and relies on core `dispatchToolCall` for permission + JSON Schema validation when the host registers the returned tools.

### Task 4 — Execution policy — **shipped**

Core (`@arnilo/prism`) adds a structured pre-execution seam distinct from name-based `PermissionPolicy`:

```ts
export interface ExecutionAction {
  readonly kind: "shell" | "read" | "write" | "edit" | string;
  readonly operation: string;
  readonly paths?: readonly string[];
  readonly command?: string;
  readonly risk?: "low" | "medium" | "high";
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExecutionPolicy {
  check(action: ExecutionAction): ExecutionDecision | Promise<ExecutionDecision>;
}

export interface ExecutionDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly modified?: Partial<ExecutionAction>;
  readonly exclusive?: boolean;
}

export interface ToolDefinition {
  // ...
  readonly exclusive?: boolean;
}

export async function assertExecutionAllowed(
  policy: ExecutionPolicy | undefined,
  action: ExecutionAction,
): Promise<ExecutionAction>;
```

`@arnilo/prism-coding-agent` tools call `executionPolicy.check()` **inside** `execute` before side effects (after dispatch permission + argument validation). Optional `@arnilo/prism-coding-security` supplies `createCodingApprovalPolicy({ roots, approve, readOnly, commandRules })` with realpath containment, default deny patterns, metacharacter approval, approval caching, and `createSandboxBashOperations()` for pluggable sandbox backends.

**Permission vs execution policy:** `PermissionPolicy` remains `tool:<name>:execute` at dispatch. `ExecutionPolicy` adds command/path context for coding tools only — no MCP-specific branches in core.

### Task 5 — Image read bounds — **shipped**

```ts
export const DEFAULT_MAX_IMAGE_BYTES = 10_000_000;

export interface TransformImageInput {
  readonly buffer: Buffer;
  readonly mimeType: string;
}

export type TransformImage = (input: TransformImageInput) => Promise<Buffer>;

export interface ReadToolOptions {
  readonly maxImageBytes?: number; // default DEFAULT_MAX_IMAGE_BYTES
  readonly transformImage?: TransformImage;
  /** @deprecated Use transformImage instead; ignored when transformImage is absent. */
  readonly autoResizeImages?: boolean;
}
```

Reject oversize images by `stat` before full read where possible; re-check `buffer.length` after read and after `transformImage`. MIME from magic bytes only (existing behavior). `transformImage` is host-owned; base package stays free of image-processing deps. Implemented in `packages/coding-agent/src/read.ts`.

## Conformance and threat-model matrix

Tasks 1–6 must pass this matrix (unit tests + `assertToolDispatchConforms` extensions where applicable):

| # | Scenario | Expected behavior |
| ---: | --- | --- |
| 1 | Args violate declared JSON Schema | `validation_failed`; handler not invoked |
| 2 | Schema compile cache | Second call with same tool/schema does not recompile |
| 3 | Malformed schema / remote `$ref` | Adapter rejects at compile time; no handler invocation |
| 4 | Prototype-pollution keys in args | Rejected before `execute` |
| 5 | Parallel calls, concurrency N | ≤ N in flight; results/transcript in call order |
| 6 | Parallel abort mid-turn | Pending calls cancelled; `context.signal` observed |
| 7 | Permission deny during parallel batch | Blocked call returns error slot; order preserved |
| 8 | MCP tool name collision | Prefix namespaces remote names |
| 9 | MCP oversized result / timeout | Bounded error `ToolResult`; transport closed |
| 10 | MCP list-changed | Cache invalidated; refresh required |
| 11 | Shell path outside roots | `ExecutionPolicy` denies before spawn |
| 12 | Symlink escape under root | Realpath containment denies |
| 13 | Shell metacharacters / escalation pattern | Policy denies or requires approval |
| 14 | Approval denied / timeout | Abortable wait; no side effect |
| 15 | Read image over `maxImageBytes` | Clear error; no base64 in result |
| 16 | Extension-contributed tool | Still requires host activation + dispatch gates |

### Threat model summary

| Threat | Owner | Mitigation |
| --- | --- | --- |
| Untrusted JSON Schema from model/MCP | Adapter + host | Compile bounds, no remote refs, pollution key rejection |
| Untrusted MCP server output | MCP package | Byte limits, redaction, explicit trusted transport config |
| Subprocess via MCP stdio | Host | Explicit command/env/cwd; no auto-launch |
| HTTP SSRF via MCP | Host + docs | URL allow-list guidance; no implicit discovery |
| Tool-name shadowing | Host registry | `duplicate: "error"`; MCP prefix |
| Command injection (shell tool) | Execution policy + host | Approval, allow/deny rules, optional sandbox adapter |
| Path escape (read/write/edit) | Execution policy | Realpath roots; deny absolute out-of-scope |
| Symlink escape | Execution policy | `realpath` containment before read/write |
| Decompression bomb (images) | Read tool | `maxImageBytes` + stat-first reject |
| Unbounded tool output | Coding tools (shipped) | `maxLines`/`maxBytes` accumulators |
| Cancellation | Core (shipped) | `AbortSignal` on context; shell kills process tree |

## Extension and configuration notes

Core remains dependency-free: validators, MCP bridges, coding policy, sandboxes, and image transforms are optional host-wired adapters. Register mapped tools through the normal registry and dispatch path; do not bypass permission or validation gates.

## Security and performance notes

| Concern | Target |
| --- | --- |
| Schema compilation | Once per `(toolName, schemaHash)` in adapter; not per dispatch |
| Validation hot path | O(schema size + instance size) with configured depth/property caps |
| Parallelism | At most `toolConcurrency` concurrent `execute` calls per turn; queue bounded by calls in that turn |
| MCP list cache | TTL + explicit invalidation on `list_changed` |
| Execution policy | Sync fast-path for allow rules; async approval bounded + abortable |
| Image reject | `stat` before read when size known |

## Related APIs

- [MCP client bridge](mcp-tools.md): `@arnilo/prism-mcp` package usage and security
- [Tools](tools.md): registry, dispatch, `ToolValidator`, events, ledger
- [Tool conformance](tool-conformance.md): blocked-reason matrix
- [Agent loops](agent-loops.md): single-shot loop and transcript ordering
- [Host security guide](host-security.md): permission, trust, validation checklist
- [Coding agent tools](coding-agent-tools.md): first-party tool package behavior and limits
- [Extensions](extensions.md): inert tool contributions
- [Review coverage (2026-07-14)](review-coverage-2026-07-14.md): finding → plan traceability

## Task ownership map

| Finding / capability | Plan 055 task | Primitive / doc |
| --- | --- | --- |
| C-001 JSON Schema tool validation | 1 | **shipped** — `ToolArgumentValidator`, `createToolParameterValidator`, `@arnilo/prism-tool-validator-json-schema` |
| C-003 MCP client bridge | 3 | **shipped** — `@arnilo/prism-mcp` |
| C-006 Approval/sandbox for coding tools | 4 | **shipped** — `ExecutionPolicy`, `@arnilo/prism-coding-security` |
| C-007 Parallel tool execution | 2 | **shipped** — `toolConcurrency`, `dispatchToolCallsInOrder`, `resolveToolConcurrency` |
| R-011 Image size / resize option | 5 | **shipped** — `maxImageBytes`, `transformImage`, `DEFAULT_MAX_IMAGE_BYTES` on read tool |
| Phase verification | 6 | **verified** — `npm run sdk:ready` + audit + threat-model fixtures; evidence in review coverage |
