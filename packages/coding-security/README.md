# @arnilo/prism-coding-security

Optional execution approval, path containment, and sandbox adapters for `@arnilo/prism-coding-agent`, including one disposable Docker/OCI sandbox reference.

## Usage

```ts
import {
  createCodingApprovalPolicy,
  createDockerSandbox,
  createSandboxCodingTools,
} from "@arnilo/prism-coding-security";

const policy = createCodingApprovalPolicy({
  roots: [workspaceRoot],
  approve: async ({ action }) => hostUi.confirm(action),
});

const sandbox = await createDockerSandbox({
  docker: "/usr/bin/docker",
  image: "registry.example/prism-code@sha256:<host-pinned-digest>",
  sourceRoot: workspaceRoot,
  user: "10001:10001",
  network: { mode: "none" },
});

const tools = createSandboxCodingTools(workspaceRoot, {
  sandbox,
  executionPolicy: policy,
  repository: { exclude: [".git", "node_modules", "dist"] },
});
```

Approval caching defaults to `none`. Explicit `run`/`session` caches use real `runId`/`sessionId` values supplied by coding-tool execution context; missing identity disables caching rather than sharing globally. Shared policy also applies through `createReadOnlyTools()`. Prefer `createSandboxCodingTools()` to wire shell through a sandbox while sharing repository list/search options; `createSandboxBashOperations()` remains available for manual shell wiring. Sandbox adapters receive the shell tool's `onData` callback and should stream ordered output while honoring abort/timeout. The Docker reference requires a host-pinned image digest, absolute Docker executable, and never pulls images or inherits host environment.

Protected real-Docker checks: `PRISM_TEST_DOCKER_SANDBOX=1 PRISM_TEST_DOCKER_BIN=/usr/bin/docker PRISM_TEST_DOCKER_IMAGE='name@sha256:...' npm test -w @arnilo/prism-coding-security`.

See [Coding execution approval and sandboxing](../../docs/coding-security.md), [Coding agent tools](../../docs/coding-agent-tools.md), and [Host security](../../docs/host-security.md).
