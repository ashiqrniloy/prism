# Coding execution approval and sandboxing

## What it does

`@arnilo/prism-coding-security` is an optional package that supplies structured execution policy for `@arnilo/prism-coding-agent` tools and one disposable Docker/OCI sandbox reference. It complements name-based `PermissionPolicy` at dispatch time with path/command context checked **inside** each tool before side effects, and optionally contains untrusted coding work in a host-invoked container.

| Export | Purpose |
| --- | --- |
| `createCodingApprovalPolicy(options)` | Returns an `ExecutionPolicy` with trusted roots, read-only mode, command allow/deny rules, approval caching, and timeout/abort-aware approval waits. |
| `createSandboxBashOperations(adapter)` | Maps a host-owned `SandboxAdapter` to coding-agent `BashOperations` for delegated shell execution. |
| `createSandboxCodingComposition(cwd, options)` | Authoritative construction: returns `{ tools, composition }` with required `workspaceMode` (`"host"` \| `"sandbox"`), fail-closed mixed wiring, and containment metadata. |
| `createSandboxReadOnlyComposition(cwd, options)` | Same contract for read-only tools (`read`/`repo_list`/`repo_search`). |
| `createSandboxCodingTools` / `createSandboxReadOnlyTools` | Thin wrappers that return `tools` only (compat); still require `workspaceMode`. |
| `createSandboxFilesystemOperations` / `createSandboxRepositoryOperations` | Optional execFile-backed FS/list/search backends for a disposable sandbox tree. |
| `createDockerSandbox(options)` | Creates one disposable non-root Docker container with read-only root/source, bounded tmpfs workspace, typed `execFile`, import/export, and stop/kill/cleanup. |
| `createNativeSandbox(options)` | Linux-only network-free backend: every command runs in a fresh network namespace (`unshare`), POSIX `ulimit` hard caps, cwd-in-root containment; fails closed at creation on platforms/privileges that cannot deny egress. Reports truthful capability metadata (`networkIsolated`/`egressRestricted` true, `filesystemIsolated`/`processIsolated`/`privilegeIsolated` false). Docker remains the stronger, documented reference backend. |
| `SandboxProcessHandle` | Optional long-running process handle (`write`/`signal`/`kill`/`release`/`wait`) returned by `DisposableSandbox.startProcess?`. |
| `createEgressPolicy(options)` | Deny-all allow-list policy: exact host/port/protocol rules plus frozen `npm-registry` / `github` presets; SHA-256 fingerprint. |
| `createAllowListEgressProxy(options)` | HTTP forward proxy + CONNECT tunnel enforcing the policy: pinned DNS (rebinding defense), private/metadata IP denial, redirect re-validation + hop cap, byte/time caps, per-decision audit, attestation for sandbox composition. |
| `composeEgressSandboxNetwork(attestation, name)` | Validated custom Docker network carrying proxy attestation; recorded as `prism.egress.*` container labels. |
| `assertEgressAttestation(attestation)` | Fail-closed validation of proxy attestation evidence. |
| `assertPathInsideRoots`, `isPathInsideReal` | Symlink-aware path containment helpers. |
| `evaluateCommandRules`, `hasShellMetacharacters` | Command classification helpers. |

Core contracts live in `@arnilo/prism`:

```ts
import type { ExecutionAction, ExecutionPolicy, ExecutionDecision } from "@arnilo/prism";
```

## When to use it

Use this package when coding tools need path scoping, human approval, command rules, or a pluggable sandbox backend. Wire the returned policy through `createCodingTools(cwd, { executionPolicy })` or per-tool `executionPolicy` options.

Use `createDockerSandbox()` when the host wants a production-reference containment boundary. Prism does **not** claim OS-level isolation unless the host constructs this adapter (or supplies an equivalent custom `DisposableSandbox`). Default policy denies shell/write/edit/delete/move without an `approve` callback and rejects paths outside configured roots. Coding shell definitions are marked `exclusive: true`, matching the approval policy's shell decision, so a single-shot turn containing shell work runs sequentially even when `toolConcurrency > 1`. Non-shell turns retain configured parallelism.

Use `createNativeSandbox()` when the host has no container runtime and needs network-free containment (0.1.6, plan 018 closeout `native-sandbox`). Linux only; creation fails closed with a documented error on other platforms or when the OS cannot create a network namespace (no root/CAP_SYS_ADMIN and no unprivileged user namespaces). Every command runs in a fresh netns — **loopback is down**, so even localhost connections fail; hosts that need loopback keep the Docker backend. Containment is egress denial + `ulimit` hard caps (address space from `memoryBytes`, CPU-time wall backstop, fd count from `maxFds`) + cwd-inside-root (`assertPathInsideRoots`, symlink-aware). The native backend does **not** isolate the filesystem: commands run as the invoking OS user with full host-tree access, so pair it with `createSandboxCodingComposition`/`createSandboxFilesystemOperations` (per-op `assertSandboxPath`) and the approval policy, exactly as with any custom `DisposableSandbox`. Its `capabilities` report `networkIsolated: true` and `egressRestricted: true` but `filesystemIsolated`/`processIsolated`/`privilegeIsolated: false` — the native backend is never a containment boundary for untrusted code (see [Sandbox capabilities](#sandbox-capabilities-020-plan-020-task-4)). Host env is never inherited; `env` is an exact allow-list (PATH only by default). No `startProcess` (ProcessSessions fails closed with `ERR_PRISM_PROCESS_UNSUPPORTED`), no CPU-rate/pids/fs-size caps (cgroup-only). Secrets passed as `secrets` are redacted from surfaced errors. See `docs/_evidence/phase18-primitive-review.md` for the full threat model.

Use `createEgressPolicy()` + `createAllowListEgressProxy()` when a coding agent needs outbound network access under an explicit allow list: package installs, forge API calls, or source fetches — never unrestricted egress. The proxy is inert until `start()`; nothing binds or resolves on import or construction.

## Allow-list egress composition

`createEgressPolicy({ allow, presets })` builds a deny-all policy. Rules are exact `{ host, port, protocol }` triples — no wildcards, no CIDR, no regex. Presets (`npm-registry`, `github`) expand to explicit rule lists at construction. The policy exposes a stable SHA-256 `fingerprint` over the canonical rule set.

```ts
import { createEgressPolicy, createAllowListEgressProxy } from "@arnilo/prism-coding-security";

const policy = createEgressPolicy({
  allow: [{ host: "api.github.com", port: 443, protocol: "https" }],
  presets: ["npm-registry"],
});
const proxy = createAllowListEgressProxy({ policy, audit: (record) => host.recordEgress(record) });
const endpoint = await proxy.start(); // 127.0.0.1:0 by default; bind a reachable interface for containers
```

Every request is checked against the policy before any DNS or connect. HTTPS goes through CONNECT tunnels with TLS passed through untouched — no interception, no MITM. DNS answers are resolved once, pinned, and the connected socket's remote address is verified against the pinned set (rebinding defense); private/link-local/metadata ranges (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16` incl. `169.254.169.254`, CGNAT, ULA, `::1`, `fe80::/10`) are denied unless the matching rule sets `allowPrivate: true`. Plain-HTTP redirects are followed up to `redirectHops` with every hop re-validated against policy; redirects to unlisted hosts or non-http targets fail closed. Request/response bytes and total transfer time are capped; oversized or slow-loris transfers are cut with `ERR_PRISM_EGRESS_LIMIT`. Every allow/deny writes an `EgressAuditRecord` (id, ts, decision, host, port, protocol, reason, bytes, duration, client address) — never headers, bodies, or tokens. `reloadPolicy()` is the only way to change rules and bumps `policyVersion`; `attestation()` returns `{ proxyEndpoint, denyDirectEgress: true, policyFingerprint, policyVersion, startedAt }` for sandbox composition.

Sandbox composition: `composeEgressSandboxNetwork(proxy.attestation(), networkName)` returns a custom `DockerNetworkConfig` whose attestation is validated and recorded as `prism.egress.endpoint` / `prism.egress.fingerprint` / `prism.egress.policyVersion` / `prism.egress.denyDirect=1` container labels. The adapter records evidence; the host must actually restrict the Docker network so the proxy is the only reachable path (e.g., a dedicated network with only the proxy container attached). A custom network without valid attestation fails closed for egress claims, mirroring `assertBrowserSandboxNetwork`.

```ts
const network = composeEgressSandboxNetwork(proxy.attestation(), "egress-net");
const sandbox = await createDockerSandbox({ docker, image, sourceRoot, user, network, limits });
```

## Inputs / request

| Option | Default | Purpose |
| --- | --- | --- |
| `roots` | required | Realpath-contained filesystem roots. |
| `readOnly` | `false` | Deny non-`read` actions (including shell/write/edit/delete/move). |
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

### Workspace mode inputs (`createSandboxCodingComposition`)

| Option | Default | Purpose |
| --- | --- | --- |
| `workspaceMode` | **required** | `"host"` (all tools on host cwd; never claims containment) or `"sandbox"` (shell + FS/list/search share one disposable tree). |
| `sandbox` | optional in host; required for sandbox unless custom ops supplied | `SandboxAdapter` / `DisposableSandbox`. |
| `workspaceRoot` | `"/workspace"` in sandbox mode | Tree root used as tool cwd when sandbox backends are bound. |
| `allowMixedWorkspaceWiring` | `false` | Escape hatch: allow sandbox shell + host FS backends. Records `composition.warnings`; forces `containmentClaim: false`. Missing hatch throws. |
| `read`/`write`/`edit`/`repository.operations` | auto-wired from `DisposableSandbox` in sandbox mode | Host may supply custom tree backends instead of auto-wire. |

`0.0.9` silent split (sandbox shell + host FS) is **superseded**. Mixed wiring is never the default.

## Outputs / response / events

`createCodingApprovalPolicy()` returns an `ExecutionPolicy`. Allowed checks return `ExecutionDecision { allowed: true }`; denied checks include a stable reason; shell decisions set `exclusive: true`. Sandbox adapters return coding-agent-compatible `BashOperations`, receive `onData(Buffer)` for ordered stdout/stderr forwarding through the shell tool's existing bounded accumulator, and never grant policy approval themselves.

`createSandboxCodingComposition()` returns `{ tools, composition }` where `SandboxCodingComposition` carries `workspaceMode`, `capabilities`, `containmentClaim` (deprecated), `mixedWiringAllowed`, `warnings`, `workspaceRoot`, and optional `treeIdentity` (from `importIdentity` / `lastExportIdentity`). `capabilities` is a complete, frozen `SandboxCapabilities` object: `workspaceCoherent` derives from actual shell/filesystem/repository wiring; the isolation fields derive only from validated adapter capability metadata, never from `execFile`/`close` duck typing or custom operations being present. Host mode and escape-hatch mixed wiring always report no isolation capability — never treat host mode as contained execution.

### Sandbox capabilities (0.2.0, plan 020 Task 4)

Every sandbox backend and every composition reports a frozen, complete capability object:

| Capability | Meaning | Docker | Native | Custom / omitted |
| --- | --- | --- | --- | --- |
| `workspaceCoherent` | Shell, filesystem, and repository tools observe one workspace tree. | true | true | true only when tree backends are bound and mixed wiring denied |
| `filesystemIsolated` | Sandbox processes cannot touch the host filesystem. | true | **false** (full host-tree access by design) | false unless host attests |
| `networkIsolated` | No reachable network. | true only for `network: { mode: "none" }` | true (fresh netns per command, egress denied, loopback down) | false unless host attests |
| `processIsolated` | Sandbox processes run in a separate process namespace. | true | **false** | false unless host attests |
| `privilegeIsolated` | Sandbox processes cannot obtain host privileges. | **false** (root-in-container without user namespaces is not reliable) | **false** | false unless host attests |
| `egressRestricted` | Any egress is forced through a controlled proxy/firewall. | true for mode `none`, or a custom network carrying a validated `EgressAttestation` | true (no egress at all) | false unless host attests |

Rules:

- **Omission is false.** A `SandboxAdapter` without `capabilities` metadata — or with malformed metadata (non-object, missing fields, non-boolean values, unknown keys) — resolves every isolation field false. `resolveSandboxCapabilities()` validates, copies, and freezes explicit metadata; a backend can never gain a capability by omission, interface shape, or mixed wiring.
- **Explicit metadata is host attestation.** Prism validates shape and freezes the object; the host is responsible for the underlying controls being real.
- **`containmentClaim` is deprecated (0.2.0).** Retained for 0.1.7 compatibility as the conservative projection `workspaceCoherent && filesystemIsolated && networkIsolated && processIsolated` (privilege isolation excluded). It can only be `true` when every required capability is true — never authorize a security-sensitive action from this boolean alone; use `composition.capabilities`.
- **Capability construction is O(1)** — one small frozen object per sandbox/composition; no command, filesystem, Docker, DNS, or network operation.

`createDockerSandbox()` returns a `DisposableSandbox`: typed `execFile(file, args)`, shell-compatible `exec`, `status`, cooperative `stop`, forced `kill`, and idempotent `close`. Import may surface `importIdentity`; successful export updates `lastExportIdentity`. `close({ export })` can stream a bounded workspace tar plus SHA-256/entry/byte metadata through a host callback; checkpoints should retain only host artifact references/hashes, never whole workspaces. Optional `startProcess?(SandboxExecFileRequest)` returns a `SandboxProcessHandle` for long-running work consumed by coding-agent `createProcessSessions({ sandbox })`; absence means one-shot-only — ProcessSessions fails closed with `ERR_PRISM_PROCESS_UNSUPPORTED` (no native fallback). The Docker reference adapter does not implement `startProcess` yet; capability is detected, never assumed. See [Process sessions](process-sessions.md).

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
  createSandboxCodingComposition,
} from "@arnilo/prism-coding-security";
import { createGitTools } from "@arnilo/prism-coding-agent";

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

// Sandbox mode: shell/read/write/edit/list/search/glob/delete/move share one disposable tree.
const { tools, composition } = createSandboxCodingComposition("/srv/jobs/task-1/source", {
  workspaceMode: "sandbox",
  sandbox,
  executionPolicy: policy,
  repository: { exclude: [".git", "node_modules", "dist"] },
});
// composition.capabilities.filesystemIsolated === true for the Docker adapter with network: none
// composition.containmentClaim is deprecated compatibility metadata only

// Same-tree Git/check (opt-in; not folded into coding tools):
const gitTools = createGitTools(composition.workspaceRoot, {
  execFile: sandbox.execFile.bind(sandbox),
  commitIdentity: { name: "bot", email: "bot@example.com" },
});

// Host mode (explicit non-contained): omit sandbox; never claim containment.
const host = createSandboxCodingComposition(hostCwd, { workspaceMode: "host", executionPolicy: policy });
// host.composition.capabilities: workspaceCoherent only; every isolation field false; containmentClaim false

await sandbox.execFile({ file: "npm", args: ["test"], cwd: "/workspace" });
await sandbox.close({
  export: async (stream, meta) => hostArtifacts.write(stream, meta),
});
```

## Extension and configuration notes

Policies are ordinary host values: attach one globally through `createCodingTools()`/`createReadOnlyTools()`/`createSandboxCodingComposition()` or per tool. A per-tool policy overrides the shared policy. `SandboxAdapter` / `DisposableSandbox` are replaceable and host-owned; approval policy and sandboxing are separate layers. Custom remote sandboxes can implement `DisposableSandbox` without using Docker.

`createSandboxCodingComposition()` requires `workspaceMode`. Sandbox mode auto-wires FS/list/search through `DisposableSandbox.execFile` (or host-supplied custom operations) so mutations stay on the disposable tree until export. Host mode runs every coding tool against the host cwd and reports no isolation capability (`containmentClaim` deprecated false). Sandbox shell + host FS throws unless `allowMixedWorkspaceWiring: true` (warnings + all capabilities false). Opt-in structured Git tools (`createGitTools(composition.workspaceRoot, { execFile: sandbox.execFile, commitIdentity })`) share the same tree/cwd; Prism still never pushes or opens PRs. Optional `@arnilo/prism-web-tools/browser` can share the same disposable boundary: use `assertBrowserSandboxNetwork()` before browse-ready custom networks, and `createSharedSandboxBrowserOptions({ workspaceRoot, downloadsRoot, containedProxyAttestation })` so uploads/downloads align with `/workspace` and `/downloads`. Close the browser context before disposing the sandbox.

The Docker reference adapter starts by recorded container ID/label, uses argument arrays only, mounts source read-only, populates a size-bounded tmpfs `/workspace`, drops all capabilities, enables `no-new-privileges`, runs with `--init`, and never exposes the Docker socket, privileged mode, or host PID/IPC namespaces. Image pull/build/update stays outside Prism. Protected real-Docker checks are opt-in via `PRISM_TEST_DOCKER_SANDBOX=1` with host-supplied `PRISM_TEST_DOCKER_BIN` and digest-pinned `PRISM_TEST_DOCKER_IMAGE`.

Callback approval remains process-local. For approval that must survive restart, wrap the action in an opted-in workflow `toolNode({ approval: { reason, data?, resumeSchema? } })`. `ask_user_decision` also maps onto the shared decision model: inside a durable gated agent run its call suspends as a kind-`elicitation` pending decision whose schema carries the choice contract (option-id enums) plus the full question/options UX payload on a Prism-owned schema extension property; the resume decision's `elicitation` payload (a `selectedId`/`selectedIds`/`customText` answer) is validated against the schema and the tool-level answer-shape rules, then resolves the call without invoking the blocking `ask()` callback. The process-local `ask()` path and the workflow suspend/resume path are unchanged. The workflow persists `suspended` state before any tool side effect. After explicit approve, it recomputes the action and invokes this package's current `ExecutionPolicy`; durable approval never populates or bypasses the process-local approval cache. Adapters should emit chunks through `request.onData` as they arrive and honor `request.signal`/`request.timeout`; buffering is unnecessary. Coding-agent composes caller abort with its total-output controller, so ignoring the supplied signal defeats process termination even though Prism stops retaining output at the cap. Default caching is `none`; use run-scoped caching only when repeated approval within one run is desired, and session scope only when that wider lifecycle is intentional.

## Security and performance notes

Containment resolves symlinks and rejects paths outside roots. Command rules are not a shell parser; shell metacharacters require approval. Approval waits and subprocess execution honor abort/timeouts. Coding-agent resource ceilings independently bound text scans, image/edit target reads, write/edit payloads, edit counts, repository list/search walks, shell wall time, and retained/spilled output. Those ceilings reduce exhaustion risk but do not grant path/command authority or make an unsandboxed shell safe.

Docker sandbox containment—not command regexes—enforces filesystem/network/process boundaries for the reference adapter. Network defaults to none; a custom Docker network still requires a host firewall/proxy for DNS/egress claims. Import rejects symlink escapes, devices, FIFOs, and sockets; export counts entries/bytes and hashes before host retention. Secrets in `secrets` are redacted from adapter errors and never exported as environment metadata. Unified workspace mode reuses existing sandbox/repo/coding hard caps and does not introduce unbounded host↔container sync loops. Host mode and `allowMixedWorkspaceWiring` never claim disposable containment. Durable workflow denial/cancellation is terminal and attributable; approved resume still fails if roots, command rules, read-only mode, or other policy changed while suspended. Cache keys are fixed-size SHA-256 digests of selected identity plus action shape; caches remain process-local, retain at most 1,000 decisions with oldest-entry eviction, and have no default/global mode. Path checks and cache lookup are local; sandbox latency belongs to the supplied adapter and Docker daemon.

The protected coding journey (0.2.6, plan 026 Task 7) exercises these boundaries for real at release time: scripts/phase26-coding-journey.test.mjs packs the published packages into a fresh consumer and runs the digest-pinned Docker sandbox, the host Playwright browser, the real forge, durable Postgres checkpoints/leases, and the host PTY adapter (frozen profile) — every missing service records blocked, never a passing skip, and the retained phase26-coding-journey-report.json carries timings/states/ids only (no prompts, source bodies, terminal output, tokens, or browser storage). See docs/release-and-install.md for the operator runbook.

The egress proxy is a policy enforcer, not a firewall: it cannot stop a container whose Docker network reaches the internet directly. Egress attestation (`denyDirectEgress: true`) is a claim the host must make true by network topology; the adapter records it as evidence and fails closed when it is absent or malformed. The proxy performs no TLS interception, no DNS rebinding of its own beyond pinning, and no content filtering; audit records contain no secrets. Frozen caps: 32 concurrent connections (hard 256), 64 MiB request/response bytes (hard 1 GiB), 600 s transfer time (hard 1 h), 128 rules (hard 1,024), 5 redirect hops (hard 10).

## Windows hosts

`createNativeSandbox` is Linux-only. On any other platform (including Windows) it throws at creation and does **not** fall back to an unsandboxed process — egress denial cannot be enforced by construction without a network namespace. Do not catch that error and enable `shell` on the host; keep `shell` disabled, or run the agent inside a Docker container using `createDockerSandbox` and the documented [allow-list egress](#allow-list-egress-composition) policy (`network: none` or an attested custom network). Host-mode tools (`read`/`write`/`edit` under `workspaceMode: "host"`) remain available; they never claim containment.

A native Windows backend (Job objects / AppContainer) is tracked, not scheduled. Until one exists, Windows hosts that need isolation use Docker. Do not weaken the deny-by-default posture to compensate.

## Related APIs

- [Coding agent tools](coding-agent-tools.md): durable plan/todo Markdown helpers and `state.coding` checkpoint metadata for restart/resume without a second runtime
- [Workflows](workflows.md): `runWorkflow` / `resumeWorkflow` / `startWorkflowBackground` composition for coding tasks
- [Host security guide](host-security.md)
- [Performance limits](performance.md)
- [Forge integration](forge-integration.md): GitHub adapter whose mutations can be routed through the egress proxy
- [Tool execution primitives](tool-execution-primitives.md)
- [Security/auth/trust](settings-auth-trust-security.md)
- [ACP coding-host interop](acp.md): when an ACP client supplies fs/terminal methods and MCP servers, the same containment story applies at the protocol boundary — client paths/dirs pass host seams, MCP servers need host `select` approval (never auto-connect), updates are redacted and capped, and mode switches only narrow or host-authorized widen.
