# Coding execution approval and sandboxing

## What it does

`@arnilo/prism-coding-security` is an optional package that supplies structured execution policy for `@arnilo/prism-coding-agent` tools and one disposable Docker/OCI sandbox reference. It complements name-based `PermissionPolicy` at dispatch time with path/command context checked **inside** each tool before side effects, and optionally contains untrusted coding work in a host-invoked container.

| Export | Purpose |
| --- | --- |
| `createCodingApprovalPolicy(options)` | Returns an `ExecutionPolicy` with trusted roots, read-only mode, command allow/deny rules, approval caching, and timeout/abort-aware approval waits. |
| `createSandboxBashOperations(adapter)` | Maps a host-owned `SandboxAdapter` to coding-agent `BashOperations` for delegated shell execution. |
| `createSandboxCodingTools(cwd, options)` | One construction path: full coding tools with shell wired to `options.sandbox` and shared repository options. |
| `createSandboxReadOnlyTools(cwd, options)` | Read-only coding tools (`read`/`repo_list`/`repo_search`) with shared repository options. |
| `createDockerSandbox(options)` | Creates one disposable non-root Docker container with read-only root/source, bounded tmpfs workspace, typed `execFile`, import/export, and stop/kill/cleanup. |
| `assertPathInsideRoots`, `isPathInsideReal` | Symlink-aware path containment helpers. |
| `evaluateCommandRules`, `hasShellMetacharacters` | Command classification helpers. |

Core contracts live in `@arnilo/prism`:

```ts
import type { ExecutionAction, ExecutionPolicy, ExecutionDecision } from "@arnilo/prism";
```

## When to use it

Use this package when coding tools need path scoping, human approval, command rules, or a pluggable sandbox backend. Wire the returned policy through `createCodingTools(cwd, { executionPolicy })` or per-tool `executionPolicy` options.

Use `createDockerSandbox()` when the host wants a production-reference containment boundary. Prism does **not** claim OS-level isolation unless the host constructs this adapter (or supplies an equivalent custom `DisposableSandbox`). Default policy denies shell/write/edit without an `approve` callback and rejects paths outside configured roots. Coding shell definitions are marked `exclusive: true`, matching the approval policy's shell decision, so a single-shot turn containing shell work runs sequentially even when `toolConcurrency > 1`. Non-shell turns retain configured parallelism.

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

### Docker sandbox inputs

| Option | Default | Purpose |
| --- | --- | --- |
| `docker` | required | Absolute host Docker executable. |
| `image` | required | Digest-pinned image (`name@sha256:<64-hex>`). Never pulled (`--pull=never`). |
| `sourceRoot` | required | Absolute host directory imported into `/workspace`. |
| `user` | required | Non-root `uid:gid`. |
| `network` | `{ mode: "none" }` | Default no network; custom mode requires a pre-created network name and does not claim DNS containment. |
| `env` | `{}` | Exact allow-list only; host environment is never inherited. |
| `secrets` | `[]` | Canaries redacted from CLI/adapter errors. |
| `limits` | package defaults | CPU/memory/PID/FD/tmpfs/command/export/time caps validated before create. |

## Outputs / response / events

`createCodingApprovalPolicy()` returns an `ExecutionPolicy`. Allowed checks return `ExecutionDecision { allowed: true }`; denied checks include a stable reason; shell decisions set `exclusive: true`. Sandbox adapters return coding-agent-compatible `BashOperations`, receive `onData(Buffer)` for ordered stdout/stderr forwarding through the shell tool's existing bounded accumulator, and never grant policy approval themselves.

`createDockerSandbox()` returns a `DisposableSandbox`: typed `execFile(file, args)`, shell-compatible `exec`, `status`, cooperative `stop`, forced `kill`, and idempotent `close`. `close({ export })` can stream a bounded workspace tar plus SHA-256/entry/byte metadata through a host callback; checkpoints should retain only host artifact references/hashes, never whole workspaces.

## Request/response example

```json
{
  "action": { "kind": "shell", "operation": "execute", "command": "npm test", "paths": [] },
  "decision": { "allowed": true, "exclusive": true }
}
```

## Implementation example

```ts
import {
  createCodingApprovalPolicy,
  createDockerSandbox,
  createSandboxCodingTools,
} from "@arnilo/prism-coding-security";

const policy = createCodingApprovalPolicy({
  roots: [workspaceRoot],
  approve: async ({ action, signal }) => ui.confirm(action, { signal }),
  approvalCacheScope: "run",
  approvalTimeoutMs: 60_000,
});

const sandbox = await createDockerSandbox({
  docker: "/usr/bin/docker",
  image: "registry.example/prism-code@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sourceRoot: "/srv/jobs/task-1/source",
  user: "10001:10001",
  network: { mode: "none" },
  env: { CI: "1" },
  limits: { cpus: 2, memoryBytes: 2 * 1024 ** 3, maxPids: 256, workspaceBytes: 1024 ** 3 },
});

// Host cwd is the inspected workspace; shell runs inside the sandbox.
const tools = createSandboxCodingTools("/srv/jobs/task-1/source", {
  sandbox,
  executionPolicy: policy,
  repository: { exclude: [".git", "node_modules", "dist"] },
});

await sandbox.execFile({ file: "npm", args: ["test"], cwd: "/workspace" });
await sandbox.close({
  export: async (stream, meta) => hostArtifacts.write(stream, meta),
});
```

## Extension and configuration notes

Policies are ordinary host values: attach one globally through `createCodingTools()`/`createReadOnlyTools()`/`createSandboxCodingTools()` or per tool. A per-tool policy overrides the shared policy. `SandboxAdapter` / `DisposableSandbox` are replaceable and host-owned; approval policy and sandboxing are separate layers. Custom remote sandboxes can implement `DisposableSandbox` without using Docker. `createSandboxCodingTools()` wires shell through the adapter while list/search/read/write/edit keep the host `cwd` unless custom operations are supplied — Docker tmpfs mutations remain inside the container until export. Opt-in structured Git tools from `@arnilo/prism-coding-agent` (`createGitTools`) can target the same disposable sandbox by passing `execFile: sandbox.execFile` and a host `commitIdentity`; Prism still never pushes or opens PRs. Optional `@arnilo/prism-browser` can share the same disposable boundary: use `assertBrowserSandboxNetwork()` before browse-ready custom networks, and `createSharedSandboxBrowserOptions({ workspaceRoot, downloadsRoot, containedProxyAttestation })` so uploads/downloads align with `/workspace` and `/downloads`. Close the browser context before disposing the sandbox.

The Docker reference adapter starts by recorded container ID/label, uses argument arrays only, mounts source read-only, populates a size-bounded tmpfs `/workspace`, drops all capabilities, enables `no-new-privileges`, runs with `--init`, and never exposes the Docker socket, privileged mode, or host PID/IPC namespaces. Image pull/build/update stays outside Prism. Protected real-Docker checks are opt-in via `PRISM_TEST_DOCKER_SANDBOX=1` with host-supplied `PRISM_TEST_DOCKER_BIN` and digest-pinned `PRISM_TEST_DOCKER_IMAGE`.

Callback approval remains process-local. For approval that must survive restart, wrap the action in an opted-in workflow `toolNode({ approval: { reason, data?, resumeSchema? } })`. The workflow persists `suspended` state before any tool side effect. After explicit approve, it recomputes the action and invokes this package's current `ExecutionPolicy`; durable approval never populates or bypasses the process-local approval cache. Adapters should emit chunks through `request.onData` as they arrive and honor `request.signal`/`request.timeout`; buffering is unnecessary. Coding-agent composes caller abort with its total-output controller, so ignoring the supplied signal defeats process termination even though Prism stops retaining output at the cap. Default caching is `none`; use run-scoped caching only when repeated approval within one run is desired, and session scope only when that wider lifecycle is intentional.

## Security and performance notes

Containment resolves symlinks and rejects paths outside roots. Command rules are not a shell parser; shell metacharacters require approval. Approval waits and subprocess execution honor abort/timeouts. Coding-agent resource ceilings independently bound text scans, image/edit target reads, write/edit payloads, edit counts, repository list/search walks, shell wall time, and retained/spilled output. Those ceilings reduce exhaustion risk but do not grant path/command authority or make an unsandboxed shell safe.

Docker sandbox containment—not command regexes—enforces filesystem/network/process boundaries for the reference adapter. Network defaults to none; a custom Docker network still requires a host firewall/proxy for DNS/egress claims. Import rejects symlink escapes, devices, FIFOs, and sockets; export counts entries/bytes and hashes before host retention. Secrets in `secrets` are redacted from adapter errors and never exported as environment metadata. Durable workflow denial/cancellation is terminal and attributable; approved resume still fails if roots, command rules, read-only mode, or other policy changed while suspended. Cache keys are fixed-size SHA-256 digests of selected identity plus action shape; caches remain process-local, retain at most 1,000 decisions with oldest-entry eviction, and have no default/global mode. Path checks and cache lookup are local; sandbox latency belongs to the supplied adapter and Docker daemon.

## Related APIs

- [Coding agent tools](coding-agent-tools.md): durable plan/todo Markdown helpers and `state.coding` checkpoint metadata for restart/resume without a second runtime
- [Workflows](workflows.md): `runWorkflow` / `resumeWorkflow` / `startWorkflowBackground` composition for coding tasks
- [Host security guide](host-security.md)
- [Performance limits](performance.md)
- [Tool execution primitives](tool-execution-primitives.md)
- [Security/auth/trust](settings-auth-trust-security.md)
