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

`run` caching keys decisions by the tool execution context's `runId`; `session` uses `sessionId`. Coding tools pass both identities to the policy. A missing/empty identity disables caching for that check rather than creating a global bucket. Identical actions in different runs/sessions never share approvals or denials.

## Outputs / response / events

`createCodingApprovalPolicy()` returns an `ExecutionPolicy`. Allowed checks return `ExecutionDecision { allowed: true }`; denied checks include a stable reason; shell decisions set `exclusive: true`. Sandbox adapters return coding-agent-compatible `BashOperations`, receive `onData(Buffer)` for ordered stdout/stderr forwarding through the shell tool's existing bounded accumulator, and never grant policy approval themselves.

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

Policies are ordinary host values: attach one globally through `createCodingTools()`/`createReadOnlyTools()` or per tool. A per-tool policy overrides the shared policy. `SandboxAdapter` is replaceable and host-owned; approval policy and sandboxing are separate layers.

Callback approval remains process-local. For approval that must survive restart, wrap the action in an opted-in workflow `toolNode({ approval: { reason, data?, resumeSchema? } })`. The workflow persists `suspended` state before any tool side effect. After explicit approve, it recomputes the action and invokes this package's current `ExecutionPolicy`; durable approval never populates or bypasses the process-local approval cache. Adapters should emit chunks through `request.onData` as they arrive and honor `request.signal`/`request.timeout`; buffering is unnecessary. Coding-agent composes caller abort with its total-output controller, so ignoring the supplied signal defeats process termination even though Prism stops retaining output at the cap. Default caching is `none`; use run-scoped caching only when repeated approval within one run is desired, and session scope only when that wider lifecycle is intentional.

## Security and performance notes

Containment resolves symlinks and rejects paths outside roots. Command rules are not a shell parser; shell metacharacters require approval. Approval waits and subprocess execution honor abort/timeouts. Coding-agent resource ceilings independently bound text scans, image/edit target reads, write/edit payloads, edit counts, shell wall time, and retained/spilled output. Those ceilings reduce exhaustion risk but do not grant path/command authority or make an unsandboxed shell safe. Durable workflow denial/cancellation is terminal and attributable; approved resume still fails if roots, command rules, read-only mode, or other policy changed while suspended. Cache keys are fixed-size SHA-256 digests of selected identity plus action shape; caches remain process-local, retain at most 1,000 decisions with oldest-entry eviction, and have no default/global mode. Path checks and cache lookup are local; sandbox latency belongs to the supplied adapter.

## Related APIs

- [Coding agent tools](coding-agent-tools.md)
- [Host security guide](host-security.md)
- [Tool execution primitives](tool-execution-primitives.md)
- [Security/auth/trust](settings-auth-trust-security.md)
