# Changelog
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
