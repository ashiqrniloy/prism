# Phase 30 — Primitive Review (Task 1)

**Scope gate:** does 0.3.0 need any new core primitive? Review inventories existing seams against each workstream and records implement-or-defer for every deferred alternative. Evidence file; no public API, no `/docs` page.

**Verdict: zero new core primitives (no core primitive added).** Every workstream composes over existing contracts. The only new code lives in packages (desktop wrap, ACP operations adapter) and scripts (release.mjs dual-mode).

---

## Existing primitives (verified against source)

### Desktop / device — `src/devices.ts` (0.0.14 contract)

- `DeviceKind = "voice" | "desktop-control"` — desktop-control is already a named kind.
- `DeviceAdapter` interface: `kind`, `enabled` (deny-by-default), `requireApproval`, `limits?`, `sandbox?`, `network?`.
- `resolveDevicePolicy(adapter, options)` → `ResolvedDevicePolicy` (validates caps; anything but explicit `true` → disabled).
- `assertDeviceAdmit(policy, { approved, activeSessions })` — fail-closed gate: requires enabled + sandbox + approval + under session budget + bound to shared `RunLimits`.
- `acceptDeviceChunk(policy, bytes)` — stream bound; oversize → `{ accepted: false, marker: "dropped_oversize" }`.
- `redactDeviceTelemetry(redactor, telemetry)` — metadata-safe passthrough.
- `runDevicePolicyConformance(adapter, options)` — fixture runner for vendor adapters.
- Caps: chunk **1 MiB default / 8 MiB hard**; concurrent sessions **1 default / 4 hard**.
- `DevicePolicyError` codes: `_DISABLED`, `_APPROVAL`, `_SESSIONS`, `_CHUNK`, `_RUN_LIMITS`, `_INPUT`.

### MCP bridge — `packages/mcp/src/`

- `connectMcpTools({ serverId, transport })` (bridge.ts) — lists tools, wraps as Prism `ToolDefinition`s, bounded result bytes, name prefixing on collision. Exported from `index.ts`.
- `createMcpTransport(config)` (transport.ts) — stdio/SSE/streamable transport factory. Exported from `index.ts`.

### Execution policy — `src/execution-policy.ts` (core)

- `assertExecutionAllowed(action, decision)` — throws `ExecutionDeniedError` when `decision.allowed` is false.
- `ExecutionDeniedError` — exported from `src/index.ts` alongside `applyExecutionDecision`, `checkExecution`.

### Coding operations — `packages/coding-agent/src/`

- `ReadOperations` (read.ts:215): `readText(absolutePath, options: ReadTextOptions)`, `statFile`, optional `detectImageMimeType`. `ReadTextOptions` already carries `line`/`limit` — a `findText` tool parameter can page `readText` without changing this interface.
- `WriteOperations` (write.ts:34): `writeFile(absolutePath, content, { maxBytes, signal })`, `mkdir`.
- `EditOperations` (edit.ts:74): `readFile`, `writeFile`, `statFile`. Edit already calls `ops.statFile` then `applyEditsToNormalizedContent` then `ops.writeFile`.
- `createCodingTools(cwd, options?)` (index.ts:613) — returns `readonly ToolDefinition[]`; no auto-registration. `options.read.operations` / `options.write.operations` / `options.edit.operations` inject custom ops.

### ACP client filesystem — `packages/ag-ui/src/acp/fs-client.ts`

- `AcpClientFilesystem` (fs-client.ts:14): `readTextFile({ path, line?, limit? })`, `writeTextFile({ path, content })`. Per-method capability gating (`ERR_PRISM_ACP_CAPABILITY`), `maxTextBytes` payload cap.
- `createAcpClientFilesystem(client, sessionId, options?)` — constructs the adapter from an AG-UI client.

### ACP agent seams — `packages/ag-ui/src/acp/agent/types.ts`

- `AcpSessionBinding.tools?: ToolRegistry` (types.ts:31) — per-session tool override. **Exists today, unused by spawnable agent.**
- `AcpCodingContext.filesystem?: AcpClientFilesystem` (types.ts:35).
- `AcpCodingSeams.filesystem?: (client, sessionId) => AcpClientFilesystem | Promise<…>` (types.ts:42) — factory called only when the client advertised fs.

### Spawnable agent — `packages/acp-agent/src/index.ts`

- `createSpawnableAgent(options)` builds **one global** `createToolRegistry(createCodingTools(config.cwd))` (index.ts:62) at process start. Never passes `coding` seams. `createPrismAcpAgent` receives the seams via `AcpAgentOptions.coding` but the spawnable wrapper does not forward them.

### Coding projection — `packages/ag-ui/src/acp/coding-projection.ts`

- `createCodingToolProjection()` — allow-list today is `edit` (diff + `firstChangedLine` location) and `write` (path location). **No `delete`/`move`.** Deny-by-default for everything else.

### Release — `scripts/release.mjs`

- `validateRelease(version)`, `bumpRelease({ from, to })`, `runRelease({ version, resume })`, `assertGitState`, `topologicalOrder`. `bumpRelease` already skips manifests not at `--from`. Peer policy in `scripts/package-truth.json`: `{ decision: "A", spec: "0.2.9", atomicUpgrade: true }`.

---

## Workstream → primitive mapping

| Workstream | Primitive used | New core primitive? |
| --- | --- | --- |
| Desktop admit + chunk | `DeviceAdapter` / `resolveDevicePolicy` / `assertDeviceAdmit` / `acceptDeviceChunk` | no |
| Desktop tool bridge | `connectMcpTools` + `createMcpTransport` (stdio) | no |
| Desktop exec gate | `assertExecutionAllowed` / `ExecutionDeniedError` | no |
| Desktop telemetry | `redactDeviceTelemetry` | no |
| `read.findText` | page existing `ReadOperations.readText` (line/limit) | no interface change |
| `edit` miss context | `getNotFoundError` (edit-diff.ts) + already-loaded content | no |
| `edit` fuzzy flag | thread existing `usedFuzzyMatch` from `applyEditsToNormalizedContent` | no |
| ACP editor ops | map `AcpClientFilesystem` duck type onto `ReadOperations`/`WriteOperations`/`EditOperations` | no — adapter in coding-agent package |
| Spawnable ACP fs | `AcpSessionBinding.tools` + `AcpCodingSeams.filesystem` (both exist) | no |
| `delete`/`move` projection | extend `createCodingToolProjection` allow-list + existing metadata | no |
| Versioning | `scripts/release.mjs` only | no core change |

---

## Deferred alternatives (implement-or-defer)

| Alternative | Decision | Rationale |
| --- | --- | --- |
| Collapse 18 desktop tools → `desktop_act` API | **defer** | Extra Prism surface, drift from upstream names, skill must match 1:1 (D2). Add only if tool-count friction is measured. |
| `@agent-sh/computer-use-linux` as npm optional peer | **defer** | Supply-chain + optional-peer mess. Host owns the binary (D1). Add only if install friction demands a bundled peer. |
| Core device-primitive changes (DesktopRuntime, new caps) | **defer — none needed** | `DeviceAdapter` already names `desktop-control`; caps frozen at 1 MiB / 8 MiB cover screenshots. |
| Extend `ReadOperations` interface with `findText` | **defer — none needed** | Tool can page `readText` (line/limit already present). Interface stays stable. |
| Invent ACP `fs/edit` or terminal `stdin` | **defer** | ACP protocol has no `fs/edit`; edit = client read + local apply + client write. Terminal stays pull-only (D6). |
| Changesets for versioning | **defer** | Extra workflow + dependency. `release.mjs` change detection + topo publish covers it (D9). |
| Desktop in `prism-all` / `prism-code` umbrellas | **defer** | Honesty rule: same as document-reader / NATS / Impeccable. Hosts opt in (D4). |
| `requireReadBeforeWrite` default-on for ACP editor mode | **defer** | Breaking for disk hosts. Docs recommend; host opts in. |

---

## Security posture (restated)

- No implicit desktop activation: import of `@arnilo/prism-computer-use-linux` is inert; `createComputerUseLinuxTools` is the only entry point.
- No ambient binary download: host owns `computer-use-linux`; package never fetches it.
- No permission broadening: device deny-by-default + approval + sandbox + shared RunLimits + chunk cap unchanged.
- ACP image/document paths fail closed on client fs: `detectImageMimeType` returns `null`, no silent disk fallback.
- No new runtime dependency in core; desktop package peers `@arnilo/prism` + `@arnilo/prism-mcp` only.
