# Changelog

## [0.2.0] - 2026-08-13

### Changed
- **Explicit sandbox capabilities with deprecated containment projection** (plan 020 Task 4): `SandboxAdapter` gains the optional `capabilities` field (`workspaceCoherent`/`filesystemIsolated`/`networkIsolated`/`processIsolated`/`privilegeIsolated`/`egressRestricted`, immutable booleans; omission or malformed metadata resolves every isolation field `false`). `SandboxCodingComposition.capabilities` is resolved from the real shell/filesystem/repository wiring plus validated adapter metadata — never from duck typing. `containmentClaim` is retained as `@deprecated` and equals the conservative projection `workspaceCoherent && filesystemIsolated && networkIsolated && processIsolated`; the Docker built-in reports `privilegeIsolated: false` by default and `networkIsolated: true` only for mode `none`; the native backend reports filesystem/process/privilege `false` (network isolation and egress restriction only). Authorization should consume the individual capabilities; host-mode and mixed wiring report no isolation.

## [0.1.6] - 2026-08-11

### Changed
- **Network-free native sandbox backend** (plan 018 closeout `native-sandbox`): additive `createNativeSandbox({ root, limits })` — spawn + POSIX rlimits + existing path containment, zero new dependencies. Every command runs in a fresh network namespace via the OS `unshare` binary (plain or `--map-root-user`, preflighted once at creation; Linux-only, fail-closed elsewhere), chained `ulimit` caps (`-v`/`-t`/`-n`) with `|| exit 126`, argv-only `exec` (no shell interpolation), cwd containment, process-group kill on timeout/abort, env allow-list (host env never inherited), output cap, `close({export})` tar parity, and a documented honest boundary: egress denial + rlimits + cwd containment only — the process runs as the invoking OS user.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Changed
- Released with exact 0.0.28 graph.

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Added
- Allow-list egress: `createEgressPolicy` (deny-all exact host/port/protocol rules, frozen `npm-registry`/`github` presets, SHA-256 fingerprint), `createAllowListEgressProxy` (HTTP forward proxy + CONNECT tunnel, pinned-DNS rebinding defense, private/metadata IP denial, redirect re-validation + hop cap, request/response byte + transfer-time caps, per-decision `EgressAuditRecord`, `reloadPolicy`, `attestation`), `composeEgressSandboxNetwork` / `assertEgressAttestation` (attestation recorded as `prism.egress.*` container labels), `ERR_PRISM_EGRESS_*` codes, frozen `DEFAULT/HARD_MAX_EGRESS_*` caps. TLS passes through without interception; proxy inert until `start()`.
- Optional `DisposableSandbox.startProcess` / `SandboxProcessHandle` for long-running process sessions (fail closed when absent; Docker adapter not yet capable).

## [0.0.25] - 2026-08-06

### Changed
- Released with exact 0.0.25 graph.

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
- `isMutatingKind` treats `delete` and `move` as mutating (not `glob`).
- Sandbox coding composition requires delete/move backends for full kind; sandbox FS ops expose delete/move.

## [0.0.20] - 2026-07-31

### Changed
- Released with exact 0.0.20 graph.

## [0.0.19] - 2026-07-30

### Changed
- Released with exact 0.0.19 graph.

## [0.0.18] - 2026-07-30

### Changed
- Released with exact 0.0.18 graph.

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

### Changed

- Required `workspaceMode: "host" | "sandbox"` on sandbox coding composition; fail-closed mixed wiring unless `allowMixedWorkspaceWiring`.
- Added `createSandboxCodingComposition` / `createSandboxReadOnlyComposition` with `SandboxCodingComposition` metadata (`containmentClaim`, warnings, optional `treeIdentity`).
- Sandbox mode auto-wires execFile-backed FS/list/search backends so shell and filesystem tools share one disposable tree; host mode never claims containment.
- Import/export surfaces `importIdentity` / `lastExportIdentity` for tree continuity.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Added `createDockerSandbox()` disposable Docker/OCI reference with digest-pinned images, typed `execFile`, bounded workspace import/export, finite resource caps, and idempotent stop/kill/cleanup. Existing `SandboxAdapter` / `createSandboxBashOperations()` remain compatible.
- Added `createSandboxCodingTools()` / `createSandboxReadOnlyTools()` to wire shell through a sandbox adapter while sharing repository list/search options with the host workspace.
- Added `assertBrowserSandboxNetwork()` so custom Docker networks fail closed for browser use without `browserEgress` proxy attestation (`proxyEndpoint` + `denyDirectEgress`).
- Expanded the protected Docker live matrix (`PRISM_TEST_DOCKER_SANDBOX=1`) to assert non-root execution, workspace writability, host-env non-inheritance, network-none, digest pinning, and idempotent cleanup.

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

## [0.0.6] - 2026-07-19

- Released with the exact 0.0.6 first-party package graph.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.

## [0.0.4] - 2026-07-14

- Shell decisions are exclusive; approval caching is scoped, path containment uses strict realpaths/error codes, and sandbox adapters remain host-selected.

## [0.0.3]

- Initial release: `createCodingApprovalPolicy`, path containment helpers, `createSandboxBashOperations`.
