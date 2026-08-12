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

// Allow-list egress (deny-all; inert until start):
import { createEgressPolicy, createAllowListEgressProxy, composeEgressSandboxNetwork } from "@arnilo/prism-coding-security";
const egressPolicy = createEgressPolicy({ presets: ["npm-registry"], allow: [{ host: "api.github.com", port: 443, protocol: "https" }] });
const proxy = createAllowListEgressProxy({ policy: egressPolicy, audit: (record) => host.recordEgress(record) });
await proxy.start();
const network = composeEgressSandboxNetwork(proxy.attestation(), "egress-net");
// Host must restrict the network so the proxy is the only reachable path.

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

`workspaceMode` is required (`"host"` | `"sandbox"`). Mixed sandbox-shell + host-FS wiring throws unless `allowMixedWorkspaceWiring: true` (warnings; all capabilities false). Every composition carries a frozen `SandboxCapabilities` object (`workspaceCoherent`, `filesystemIsolated`, `networkIsolated`, `processIsolated`, `privilegeIsolated`, `egressRestricted`): workspace coherence derives from wiring, isolation derives only from validated adapter capability metadata, omission/malformed metadata resolves false, and the deprecated `containmentClaim` is a conservative projection — authorize from the individual capabilities, never the boolean alone. Built-ins report truthfully: Docker claims filesystem/process isolation and network isolation only for mode `none`; native reports `filesystemIsolated`/`processIsolated`/`privilegeIsolated` false and is never a security boundary for untrusted code. Prefer `createSandboxCodingComposition()` for metadata; `createSandboxCodingTools()` returns tools only. Approval caching defaults to `none`. Docker reference requires a host-pinned image digest, absolute Docker executable, and never pulls images or inherits host environment.

Protected real-Docker checks: `PRISM_TEST_DOCKER_SANDBOX=1 PRISM_TEST_DOCKER_BIN=/usr/bin/docker PRISM_TEST_DOCKER_IMAGE='name@sha256:...' npm test -w @arnilo/prism-coding-security`.

See [Coding execution approval and sandboxing](../../docs/coding-security.md), [Coding agent tools](../../docs/coding-agent-tools.md), and [Host security](../../docs/host-security.md).
