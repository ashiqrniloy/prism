# @arnilo/prism-coding-security

Optional execution approval, path containment, and sandbox adapters for `@arnilo/prism-coding-agent`, including one disposable Docker/OCI sandbox reference.

## Usage

```ts
import {
  createCodingApprovalPolicy,
  createDockerSandbox,
  createSandboxCodingComposition,
} from "@arnilo/prism-coding-security";
import { createGitTools } from "@arnilo/prism-coding-agent";

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

// Required workspaceMode. Sandbox: shell + FS share one disposable tree.
const { tools, composition } = createSandboxCodingComposition(workspaceRoot, {
  workspaceMode: "sandbox",
  sandbox,
  executionPolicy: policy,
  repository: { exclude: [".git", "node_modules", "dist"] },
});

// Same-tree Git (opt-in):
createGitTools(composition.workspaceRoot, {
  execFile: sandbox.execFile.bind(sandbox),
  commitIdentity: { name: "bot", email: "bot@example.com" },
});

// Host mode never claims containment:
createSandboxCodingComposition(hostCwd, { workspaceMode: "host", executionPolicy: policy });
```

`workspaceMode` is required (`"host"` | `"sandbox"`). Mixed sandbox-shell + host-FS wiring throws unless `allowMixedWorkspaceWiring: true` (warnings; `containmentClaim: false`). Prefer `createSandboxCodingComposition()` for metadata; `createSandboxCodingTools()` returns tools only. Approval caching defaults to `none`. Docker reference requires a host-pinned image digest, absolute Docker executable, and never pulls images or inherits host environment.

Protected real-Docker checks: `PRISM_TEST_DOCKER_SANDBOX=1 PRISM_TEST_DOCKER_BIN=/usr/bin/docker PRISM_TEST_DOCKER_IMAGE='name@sha256:...' npm test -w @arnilo/prism-coding-security`.

See [Coding execution approval and sandboxing](../../docs/coding-security.md), [Coding agent tools](../../docs/coding-agent-tools.md), and [Host security](../../docs/host-security.md).
