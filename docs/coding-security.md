# Coding execution approval and sandboxing

## What it does

`@arnilo/prism-coding-security` is an optional package that supplies structured execution policy for `@arnilo/prism-coding-agent` tools. It complements name-based `PermissionPolicy` at dispatch time with path/command context checked **inside** each tool before side effects.

| Export | Purpose |
| --- | --- |
| `createCodingApprovalPolicy(options)` | Returns an `ExecutionPolicy` with trusted roots, read-only mode, command allow/deny rules, approval caching, and timeout/abort-aware approval waits. |
| `createSandboxBashOperations(adapter)` | Maps a host-owned `SandboxAdapter` to coding-agent `BashOperations` for delegated shell execution. |
| `assertPathInsideRoots`, `isPathInsideReal` | Symlink-aware path containment helpers. |
| `evaluateCommandRules`, `hasShellMetacharacters` | Command classification helpers. |

Core contracts live in `@arnilo/prism`:

```ts
import type { ExecutionAction, ExecutionPolicy, ExecutionDecision } from "@arnilo/prism";
```

## When to use it

Use this package when coding tools need path scoping, human approval, command rules, or a pluggable sandbox backend. Wire the returned policy through `createCodingTools(cwd, { executionPolicy })` or per-tool `executionPolicy` options.

Prism does **not** claim OS-level isolation unless the host provides a sandbox adapter. Default policy denies shell/write/edit without an `approve` callback and rejects paths outside configured roots. Coding shell definitions are marked `exclusive: true`, matching the approval policy's shell decision, so a single-shot turn containing shell work runs sequentially even when `toolConcurrency > 1`. Non-shell turns retain configured parallelism.

## Inputs / request

| Option | Default | Purpose |
| --- | --- | --- |
| `roots` | required | Realpath-contained filesystem roots. |
| `readOnly` | `false` | Deny shell/write/edit actions. |
| `commandRules` | `[]` | Ordered allow/deny/approval command classification. |
| `approve` | none | Host callback for actions not statically allowed; omission fails closed. |
| `approvalCacheScope` | `"none"` | Optional `run` or `session` decision cache scope. |
| `approvalTimeoutMs` | `30000` | Bound approval wait; caller abort also cancels it. |

## Outputs / response / events

`createCodingApprovalPolicy()` returns an `ExecutionPolicy`. Allowed checks return `ExecutionDecision { allowed: true }`; denied checks include a stable reason; shell decisions set `exclusive: true`. Sandbox adapters return coding-agent-compatible `BashOperations` and never grant policy approval themselves.

## Request/response example

```json
{
  "action": { "kind": "shell", "operation": "execute", "command": "npm test", "paths": [] },
  "decision": { "allowed": true, "exclusive": true }
}
```

## Implementation example

```ts
import { createCodingTools } from "@arnilo/prism-coding-agent";
import { createCodingApprovalPolicy, createSandboxBashOperations } from "@arnilo/prism-coding-security";

const policy = createCodingApprovalPolicy({
  roots: [workspaceRoot],
  approve: async ({ action, signal }) => ui.confirm(action, { signal }),
  approvalCacheScope: "run",
  approvalTimeoutMs: 60_000,
});

const tools = createCodingTools(workspaceRoot, {
  executionPolicy: policy,
  shell: {
    operations: createSandboxBashOperations(mySandboxAdapter),
  },
});
```

## Extension and configuration notes

Policies are ordinary host values: attach one globally through `createCodingTools()` or per tool. `SandboxAdapter` is replaceable and host-owned; approval policy and sandboxing are separate layers. Use run-scoped approval caching unless a wider host identity/lifecycle is explicit.

## Security and performance notes

Containment resolves symlinks and rejects paths outside roots. Command rules are not a shell parser; shell metacharacters require approval. Approval waits and subprocess execution honor abort/timeouts. Path checks and cache lookup are local; sandbox latency belongs to the supplied adapter.

## Related APIs

- [Coding agent tools](coding-agent-tools.md)
- [Host security guide](host-security.md)
- [Tool execution primitives](tool-execution-primitives.md)
- [Security/auth/trust](settings-auth-trust-security.md)
