# Release 0.0.26 — Coding intelligence, managed processes, forge, and safe egress primitives

Roadmap phase: Phase 9 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.25** (Phase 8 exit gate passed 2026-08-06).
Target: `@arnilo/prism` **0.0.26**.
Prerequisite: Phase 8 complete; Phase 10 ACP expansion remains out of scope.
Scope extension (2026-08-06): ships the three remaining Phase 8 deferred AG-UI interop items — A2A server-side exposure (Task 13), reference frontend renderer for AG-UI/A2UI surfaces (Task 14), and async `AgUiProjection` hooks (Task 15).
Consuming-app FR coverage: FR-3, FR-4, FR-5 (`prism-ag-ui-a2ui-generative-ui.md`), FR-6, FR-7 (`prism-agent-event-source-export-and-location.md`).

## Objectives

- Supply the coding capabilities editors and autonomous coding loops need before exposing them through ACP (Phase 10 maps these primitives; it must not create a second filesystem/process/runtime).
- Add ignore-aware repository enumeration, optional LSP-backed language intelligence, managed long-running process sessions, one reference forge adapter, and one reference allow-list egress composition.
- Keep every capability optional and built over existing repository, execution-policy, sandbox, event, credential, approval, and tool-effect primitives; core stays dependency-free; no listener/server/proxy/indexer starts by import or discovery.
- Cover the deferred consuming-app feature requests in 0.0.26: FR-3 reasoning encrypted-value helper, FR-4 MCP Apps UI-initiated mutation retry through `ToolEffectStore`, FR-5 NATS JetStream `AgentEventSource`, and FR-6/FR-7 durable `AgentEventSource` root export + placement answer.
- Cover the three remaining Phase 8 deferred AG-UI interop items: A2A server-side exposure (remote A2A clients invoke a local AG-UI-fronted agent), a reference framework-free frontend renderer for AG-UI/A2UI surfaces, and async `AgUiProjection` hooks so hosts can call `session.entries()` directly — all opt-in, additive, and built over the shipped AG-UI handler/mapper/supervisor A2A handler.

## Non-goals

- Tree-sitter/indexing platform or in-house language parsing (large duplicate ecosystem; rejected by roadmap).
- Shell-emulated process sessions (cannot attach/input/release reliably; rejected).
- GitLab/Bitbucket or any second forge in this phase (adapter zoo; one reference forge first).
- Unrestricted sandbox networking, an in-package firewall, or a generic proxy product.
- ACP capability exposure of these primitives (Phase 10).
- PDF/document reader and trash/recovery semantics (Phase 4 non-goals, still demand-gated).
- New publishable package by default; package/subpath placement is decided by Task 0 primitive/package-size review. Exception: FR-5 NATS adapter ships as a new sibling package (Task 12) because no existing package is a natural home.
- WebSocket/binary AG-UI transport (still not requested; unchanged from Phase 8).

## Expected Outcome

- Repository listing/search can use Git tracked/unignored enumeration with nested ignore rules, retaining the bounded native walker as fallback outside Git repositories; ignored/private paths stay excluded unless host-approved.
- A host-activated language-intelligence contract provides workspace symbols, definitions, references, diagnostics, hover, and rename/workspace edits through one bounded LSP protocol client and host-selected servers.
- A `ProcessSession` contract supports start, incremental output, input, status, wait, signal/kill, release, and bounded background lifetime, integrated with sandbox workspace, identity, execution policy, output accumulator, run cancellation, durable metadata, and Phase 7 unknown-outcome semantics; PTY is optional and platform capability is explicit.
- One GitHub forge adapter provides issue context, authenticated push, pull-request create/update, review comments, check/status retrieval, and bounded handoff reconciliation with least-privilege credentials, idempotency, and approval integration.
- One allow-list egress composition enforces exact host/port/protocol policy with DNS rebinding defense, redirect limits, byte/time caps, registry/source-host presets, audit, and contained-proxy attestation; egress defaults to none.
- The durable `AgentEventSource` is importable from the `@arnilo/prism-session-store-postgres` root (FR-6), its intended home and migration path are documented (FR-7), and a NATS JetStream-backed sibling adapter provides durable consumer, per-subject replay, and at-least-once delivery with stable event IDs (FR-5).
- AG-UI hosts get a bounded reasoning encrypted-value helper (FR-3) and MCP Apps UI-initiated mutations are recorded in `ToolEffectStore` for idempotent retry and unknown-outcome reconciliation (FR-4).
- Remote A2A 1.0 clients can invoke a local AG-UI-fronted agent through a server-side adapter over the existing supervisor A2A handler (cards, task lifecycle, streaming, push), with AG-UI authorization/projection/replay semantics and no second runtime (Task 13).
- A reference framework-free renderer consumes AG-UI streams and renders A2UI v0.9 surfaces client-side from a host catalog, enforcing the same frozen caps as the server painter and never executing remote HTML (Task 14).
- `AgUiProjection` hooks accept async values so projectors like `messagesFromSession` can call `session.entries()` directly; sync-only hosts keep identical behavior (Task 15).
- Primitive review is accepted; network-free and protected GitHub/LSP/sandbox/proxy suites, large-repository/process/network benchmarks, and the full release gate pass for 0.0.26.

## Tasks

- [x] Task 0 — Primitive review, adversarial matrix, limits, and public API freeze
  - Acceptance Criteria:
    - Functional: inventory maps `RepositoryOperations` (`packages/coding-agent/src/repository.ts:168`), `list`/`search`/`glob` tools, `GitOperations` (`packages/coding-agent/src/git.ts:126`), `git-exec.ts`, `createShellTool` (`packages/coding-agent/src/shell.ts:306`), `output-accumulator.ts`, `execution-policy.ts`, `limits.ts`, `DisposableSandbox.exec`/`execFile` (`packages/coding-security/src/sandbox.ts:56-69`), `sandbox-coding-operations.ts`, credential contracts, Phase 7 `ToolEffectStore`/event source, and Phase 8 shared pending-decision approval model to every Phase 9 requirement.
    - Functional: freeze records exact Git-aware enumeration fallback rules, language-intelligence contract types and LSP transport seam, `ProcessSession` lifecycle states and PTY capability shape, forge adapter operations and handoff reconciliation contract, egress policy/preset/attestation shapes, tool schemas, typed coding events, errors, package/subpath placement, and defaults before implementation.
    - Functional: freeze explicitly excludes non-goals above, a second forge, a generic parser framework, an in-package firewall, ACP exposure, and any exactly-once process or forge claim.
    - Performance: freeze names default/hard caps for enumeration entries/depth/time, LSP message bytes/diagnostic counts/pending requests, process output bytes/chunk rate/session count/lifetime, forge page counts/payload bytes, proxy request/response bytes/time/concurrency, and benchmark volumes/p95 ceilings for large repositories, long-running output, and network backpressure.
    - Code Quality: review confirms existing repository/execution-policy/sandbox/credential/approval/effect contracts suffice with additive primitives; rejects a second runtime, per-forge generic abstraction beyond proven common operations, and a new package unless package-budget evidence requires it.
    - Security: freeze requires ignored/private path exclusion unless host-approved, host-selected LSP servers/commands only, bounded/redacted process I/O, least-privilege forge scopes with credentials never in model context/argv, egress default-deny with exact allow rules, and fail-closed behavior on attestation, ownership, or policy mismatch.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 9, Product Boundaries, Priority Rules; `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/browser-automation.md`, `docs/tool-effects.md`, `docs/agent-events.md`, `docs/credentials-and-redaction.md`.
      - LSP 3.17 specification: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>.
      - Git `ls-files`/`check-ignore` semantics: <https://git-scm.com/docs/git-ls-files>, <https://git-scm.com/docs/git-check-ignore>.
      - GitHub App auth and pull/check APIs: <https://docs.github.com/en/apps>, <https://docs.github.com/en/rest/pulls>.
    - Options Considered:
      - Ship each capability as its own package: package-count and release-cost growth against roadmap "no new package by default"; reject unless budget evidence forces it.
      - Extend `packages/coding-agent` + `packages/coding-security` in place with new subpaths: chosen, subject to package-budget check.
      - Host-supplied LSP client library dependency: core dependency-free boundary and audit findings argue for one bounded in-package JSON-RPC client; decide finally at freeze.
      - Generic `ForgeOperations` abstraction with three hypothetical providers: speculative; reject in favor of a GitHub adapter behind a narrow contract shaped only by proven operations.
    - Chosen Approach:
      - One freeze document section per capability recording contracts, caps, event names, and placement; every later task implements only frozen shapes.
      - Compose over `GitOperations`, `ExecutionPolicy`, `DisposableSandbox`, output accumulator, credential, approval, and `ToolEffectStore` primitives; add only generic reusable gaps (e.g. typed coding lifecycle events) to shared contracts.
    - API Notes and Examples:
      ```ts
      // Illustrative; Task 0 freezes exact signatures before Task 1.
      const repo = createGitAwareRepositoryOperations({ cwd, fallback: nativeRepository });
      const language = createLanguageIntelligence({ transport: lspTransport, workspaceRoot });
      const proc = await sessions.start({ command: "npm", args: ["test", "--", "--watch"], pty: false });
      const forge = createGitHubForge({ credentials, repository, approval, idempotencyStore });
      ```
    - Files to Create/Edit:
      - `plans/009-…md` freeze section updates only; no runtime code in this task.
    - References:
      - Existing primitives listed in Functional criteria above.
      - Phase 7/8 plans: `plans/007-Release-0-0-24-Distributed-Events-and-Recoverable-Tool-Effects.md`, `plans/008-Release-0-0-25-Durable-Loops-and-Human-in-the-Loop.md`.
  - Test Cases to Write:
    - Freeze conformance fixture: every frozen export name/cap/event appears in a machine-checkable manifest consumed by Tasks 1–7 tests.
    - Package-budget script run over proposed placement; result recorded in freeze.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; freeze defines all new public surfaces.
    - Docs pages to create/edit: none in this task; docs land in Tasks 1–8 per frozen surfaces.
    - `docs/index.md` update: no (deferred to capability tasks).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 0 completion record — 2026-08-06

#### Reviewed primitive and package inventory

| Existing primitive/path | Verified behavior and Phase 9 decision |
| --- | --- |
| `RepositoryOperations` (`packages/coding-agent/src/repository.ts:168-172`) | Contract is exactly `list`/`search`/`glob` with per-request limits, `AbortSignal`, `deadlineMs`. Git-aware enumeration slots in as a `RepositoryOperations`-compatible factory wrapping the native ops as fallback; `ToolsOptions.repository.operations` (`index.ts:349`) is already the injection seam. No contract change. |
| Repository limits (`repository.ts` `resolveRepositoryLimits`, `limits.ts:26-51`) | Depth/entries/files/results/concurrency/scan/file/match/time caps with hard ceilings already enforced. Git enumeration inherits all of them; only new cap is `lsFilesOutputBytes`. |
| `GitOperations` (`git.ts:126-167`) + `BoundGitRunner` (`git-exec.ts:227-230`) | Runner is bound to an absolute git path or sandbox `execFile`, with fixed argv construction, `maxOutputBytes`, `timeoutMs`. `git ls-files`/`rev-parse` enumeration reuses this runner; no new spawn path. `PrHandoff` (`git.ts:113-124`) already exists — the forge adapter builds handoff reconciliation on it, not beside it. |
| `createShellTool` (`shell.ts:306`) + `BashOperations` (`shell.ts:65-68`) | One-shot by design (`waitForChildProcess`, `killProcessTree` exist but no attach/input). Confirms roadmap: shell cannot emulate process sessions; `ProcessSession` is a new contract that reuses `ExecutionPolicy` gating and `OutputAccumulator`. |
| `OutputAccumulator` (`output-accumulator.ts:41`) | Rolling tail + temp-file spill with line/byte/total caps (`DEFAULT_MAX_TOTAL_OUTPUT_BYTES` 64 MiB / hard 1 GiB). Reused per process session; no new buffering code. |
| `enforceExecutionPolicy` (`execution-policy.ts`) + core `ExecutionPolicy` (`src/execution-policy.ts:20-43`) | Single `check(action)` gate with decision modification; `createCodingApprovalPolicy` (coding-security `approval.ts:77`) already layers cached approvals on it. Process start, LSP workspace edits, and forge mutations route through this same gate; no new authority. |
| `atomicWriteUtf8File` (`atomic-write.ts:9`) + `withFileMutationQueue` (`file-mutation-queue.ts:46`) | Atomic temp+rename writes under per-file serialization. LSP rename/workspace edits apply through exactly these; approval happens before enqueue. |
| `DisposableSandbox` (`sandbox.ts:63-73`) | `exec`/`execFile` are one-shot (return `exitCode`); `status`/`stop`/`kill`/`close` manage the container, not processes. Additive optional `startProcess` capability returns a `SandboxProcessHandle`; absence fails closed. No change to existing methods. |
| `DockerNetworkConfig` (`docker-sandbox.ts:35-51`) | Already supports `mode: "none"` or `custom` with an attestation seam (`browserEgress: { proxyEndpoint, denyDirectEgress: true }`, enforced by `assertBrowserSandboxNetwork`). Phase 9 egress attestation mirrors this exact shape for coding sandboxes instead of inventing a second attestation contract. |
| Core `AgentEvent` union (`src/contracts.ts:883-935`) | Generic agent/turn/message/tool events only; **no typed coding lifecycle events exist**. Phase 9 exports a package-level `CodingProcessEvent` union from `@arnilo/prism-coding-agent` delivered via host callback — core union untouched; Phase 10 maps these to ACP. |
| `ToolEffectStore` (`src/contracts.ts:1142-1176`) | `begin`/`markDispatched`/`complete`/`fail`/`markUnknown`/`resolveUnknown` give claim + unknown-outcome recovery. Forge mutations and sandbox-loss process reconciliation consume this; no exactly-once claim added. |
| `CredentialResolver` (`src/contracts.ts:2403-2405`) | Host-owned resolution seam. GitHub App installation token resolves through it; tokens travel via git `GIT_CONFIG_*` env injection and HTTP `Authorization` header — never argv, logs, events, or model-visible output. |
| Phase 8 pending-decision model (`plans/008`) | Approval-gated forge mutations and LSP renames use the shared decision vocabulary when running inside a durable agent run; standalone hosts keep `createCodingApprovalPolicy`. No Phase 9-specific approval fork. |

#### Public API freeze

Complete Phase 9 surface. Names, states, error codes, events, presets, package locations, and defaults are frozen and machine-checked against `scripts/phase9-freeze-manifest.json`; Tasks 1–6 may add implementation-private helpers only. Amendments require a recorded freeze amendment here.

**Placement (package-budget evidence):** no new publishable package — manifest count stays 47. New modules: `packages/coding-agent/src/{git-aware-repository.ts,language/,process/,forge/}` and `packages/coding-security/src/egress/`. Baseline evidence 2026-08-06: `budget-gate.test.mjs` 7/7 green at 0.0.25 budgets; `@arnilo/prism-coding-agent` packs at 95.5 kB / 70 files; coding-agent src 648 kB, coding-security src 196 kB. Aggregate budgets regenerate at Task 8 per established per-phase convention.

```ts
// @arnilo/prism-coding-agent — Git-aware enumeration (Task 1)
export interface GitAwareRepositoryOptions {
  readonly git?: CreateGitRunnerOptions | BoundGitRunner;   // default: resolve /usr/bin/git via createBoundGitRunner
  readonly fallback?: RepositoryOperations;                  // default: native ops for cwd
  /** Host-config only, never model-settable. Default false: ignored paths stay excluded. */
  readonly includeIgnored?: boolean;
}
export function createGitAwareRepositoryOperations(cwd: string, options?: GitAwareRepositoryOptions): RepositoryOperations;
// Detection: cached `git rev-parse --is-inside-work-tree` per instance; non-Git or spawn failure at
// detection -> fallback. Inside a Git repo, enumeration = `git ls-files --cached --others
// --exclude-standard -z` (one invocation); includeIgnored adds one `git ls-files -o -i
// --exclude-standard -z` invocation, flagged in results. Git exec failure after successful
// detection -> RepositoryError (fail closed; no silent mid-session fallback). Content scanning,
// limits, symlink/binary/path policy stay in the existing search/glob implementations.
```

```ts
// @arnilo/prism-coding-agent — language intelligence (Task 2)
export interface LanguageServerSpec {
  readonly command: string;                       // host allow-listed; never model-supplied
  readonly args?: readonly string[];
  readonly languages: readonly string[];          // e.g. ["typescript", "typescriptreact"]
  readonly env?: Readonly<Record<string, string>>;
}
export interface LanguageLocation { readonly file: string; readonly line: number; readonly character: number; }
export interface LanguageWorkspaceEdit { readonly edits: readonly { file: string; newText: string; range: unknown }[]; }
export interface LanguageIntelligence {
  workspaceSymbols(query: string, opts?: { signal?: AbortSignal }): Promise<readonly LanguageSymbol[]>;
  definitions(loc: LanguageLocation, opts?: { signal?: AbortSignal }): Promise<readonly LanguageLocation[]>;
  references(loc: LanguageLocation, opts?: { signal?: AbortSignal }): Promise<readonly LanguageLocation[]>;
  diagnostics(file?: string, opts?: { signal?: AbortSignal }): Promise<readonly LanguageDiagnostic[]>;
  hover(loc: LanguageLocation, opts?: { signal?: AbortSignal }): Promise<{ text: string } | undefined>;
  /** Applies through ExecutionPolicy + approval + atomic-write + mutation queue. */
  rename(loc: LanguageLocation & { newName: string }, opts?: { signal?: AbortSignal }): Promise<LanguageWorkspaceEdit>;
  dispose(): Promise<void>;                       // stops all spawned servers; bounded
}
export function createLanguageIntelligence(options: {
  readonly workspaceRoot: string;
  readonly servers: Readonly<Record<string, LanguageServerSpec>>;  // keyed by server name
  readonly limits?: LanguageIntelligenceLimits;
  readonly policy?: ExecutionPolicy;
  readonly processes?: ProcessSessions;           // optional: register servers as managed sessions
}): LanguageIntelligence;
export class LanguageIntelligenceError extends Error {
  readonly code: "ERR_PRISM_LSP_FRAMING" | "ERR_PRISM_LSP_SERVER" | "ERR_PRISM_LSP_TIMEOUT"
    | "ERR_PRISM_LSP_LIMIT" | "ERR_PRISM_LSP_UNSUPPORTED" | "ERR_PRISM_LSP_WORKSPACE";
}
// Transport: in-package minimal JSON-RPC over child stdio with LSP Content-Length framing (LSP 3.17);
// NO vscode-languageserver-protocol dependency (freeze decision: dependency-free posture, caps stay
// authoritative). Lazy per-server start on first use; nothing spawns on import. File URIs confined to
// workspaceRoot; server-advertised edits outside root or without textDocument/rename capability fail
// closed (ERR_PRISM_LSP_WORKSPACE / ERR_PRISM_LSP_UNSUPPORTED).
```

```ts
// @arnilo/prism-coding-agent — managed process sessions (Task 3)
export type ProcessSessionState = "starting" | "running" | "exited" | "killed" | "released" | "expired" | "unknown";
export interface ProcessStartRequest {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;                          // within workspace root
  readonly env?: Readonly<Record<string, string>>;
  readonly pty?: boolean;                         // default false; true + unsupported -> ERR_PRISM_PROCESS_PTY_UNSUPPORTED
  readonly lifetimeMs?: number;                   // bounded by caps
}
export interface ProcessSession {
  readonly id: string;
  readonly state: ProcessSessionState;
  output(request?: { cursor?: number; maxBytes?: number }): Promise<ProcessOutputChunk>;
  input(data: string | Uint8Array): Promise<void>;            // fails closed when stdin closed/state not running
  wait(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ProcessExitResult>;
  signal(name: "SIGTERM" | "SIGINT" | "SIGHUP"): Promise<void>;
  kill(): Promise<void>;
  release(): Promise<void>;                       // detach; forbids re-attach by any other owner
}
export type CodingProcessEvent =
  | { readonly type: "process_started" | "process_exited" | "process_killed" | "process_released" | "process_expired" | "process_unknown";
      readonly sessionId: string; readonly processId: string; readonly owner: string;
      readonly exitCode?: number | null; readonly at: string };
export function createProcessSessions(options: {
  readonly cwd: string;
  readonly policy?: ExecutionPolicy;
  readonly limits?: ProcessSessionLimits;
  readonly onEvent?: (event: CodingProcessEvent) => void;     // host-owned sink; no core AgentEvent change
  readonly ownership?: OwnershipScope;
}): ProcessSessions;
export class ProcessSessionError extends Error {
  readonly code: "ERR_PRISM_PROCESS_POLICY" | "ERR_PRISM_PROCESS_OWNERSHIP" | "ERR_PRISM_PROCESS_STATE"
    | "ERR_PRISM_PROCESS_LIMIT" | "ERR_PRISM_PROCESS_PTY_UNSUPPORTED" | "ERR_PRISM_PROCESS_UNSUPPORTED";
}
// Expiry sweep runs on registry access (no import-time timers). Durable metadata per session: id,
// command fingerprint (SHA-256 of argv, no env/secrets), owner, workspace, policy decision,
// start/exit timestamps, terminal state. Unknown-outcome: backend loss -> "unknown" +
// process_unknown event; never a fabricated exitCode. Run cancellation kills owned sessions unless
// started with release-on-cancel (frozen option, default kill).
```

```ts
// @arnilo/prism-coding-security — sandbox long-running capability (Task 4)
export interface SandboxProcessHandle {
  write(data: Uint8Array): Promise<void>;
  signal(name: string): Promise<void>;
  kill(): Promise<void>;
  release(): Promise<void>;
  wait(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ exitCode: number | null }>;
}
// SandboxAdapter gains ADDITIVE optional member:
//   startProcess?(request: SandboxExecFileRequest): Promise<SandboxProcessHandle>;
// Absence = one-shot-only adapter -> ProcessSessions start() over that sandbox fails closed with
// ERR_PRISM_PROCESS_UNSUPPORTED. Docker adapter implements it only when the container runtime
// supports `docker exec -d` + attach semantics within existing limits; capability is detected, never
// assumed. No changes to existing exec/execFile/status/stop/kill/close.
```

```ts
// @arnilo/prism-coding-agent — reference GitHub forge (Task 5)
export interface ForgeOperations {
  issueContext(input: { number: number }): Promise<ForgeIssueContext>;
  push(input: { refspec?: string }): Promise<{ remoteRef: string }>;
  createPullRequest(input: { head: string; base: string; title: string; body: string }): Promise<ForgePullRequest>;
  updatePullRequest(input: { number: number; title?: string; body?: string; state?: "open" | "closed" }): Promise<ForgePullRequest>;
  createReviewComment(input: { number: number; path: string; line: number; body: string }): Promise<{ id: number }>;
  checks(input: { ref: string }): Promise<readonly ForgeCheck[]>;
  reconcileHandoff(input: { base: string; head: string }): Promise<ForgeHandoffReport>;
}
export function createGitHubForge(options: {
  readonly credentials: CredentialResolverSource;  // GitHub App installation token preferred; PAT allowed
  readonly repository: string;                     // "owner/repo", bound per instance
  readonly git: CreateGitRunnerOptions | BoundGitRunner;
  readonly policy?: ExecutionPolicy;               // mutations gated here
  readonly effectStore: ToolEffectStore;           // REQUIRED: idempotency + unknown-outcome recovery
  readonly limits?: ForgeLimits;
}): ForgeOperations;
export class ForgeError extends Error {
  readonly code: "ERR_PRISM_FORGE_AUTH" | "ERR_PRISM_FORGE_API" | "ERR_PRISM_FORGE_STALE"
    | "ERR_PRISM_FORGE_RATE_LIMIT" | "ERR_PRISM_FORGE_LIMIT" | "ERR_PRISM_FORGE_OWNERSHIP";
}
// HTTP: Node >=20 global fetch with AbortSignal timeout and a bounded streaming reader; NO octokit
// dependency (freeze decision). Push reuses BoundGitRunner; the token reaches git via GIT_CONFIG_COUNT/
// GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n env (http.extraHeader) — never argv, never persisted. Every
// mutation = effectStore.begin(key) -> execute -> complete/fail; retry returns the existing record.
// reconcileHandoff composes PrHandoff + PR/check state; bounded report, no auto-merge.
```

```ts
// @arnilo/prism-coding-security — allow-list egress (Task 6)
export interface EgressRule { readonly host: string; readonly port: number; readonly protocol: "https" | "http" | "ssh" | "git"; }
export type EgressPreset = "npm-registry" | "github";
export function createEgressPolicy(input: {
  readonly allow?: readonly EgressRule[];
  readonly presets?: readonly EgressPreset[];
}): EgressPolicy;   // presets expand to explicit frozen rule lists at construction; default posture deny-all
export function createAllowListEgressProxy(options: {
  readonly policy: EgressPolicy;
  readonly audit: (record: EgressAuditRecord) => void | Promise<void>;
  readonly limits?: EgressLimits;
}): EgressProxy;     // explicit start()/stop(); nothing listens on construction or import
export class EgressError extends Error {
  readonly code: "ERR_PRISM_EGRESS_DENIED" | "ERR_PRISM_EGRESS_DNS" | "ERR_PRISM_EGRESS_LIMIT"
    | "ERR_PRISM_EGRESS_POLICY" | "ERR_PRISM_EGRESS_ATTESTATION";
}
// CONNECT + forward HTTP(S) only; TLS passthrough (no interception). DNS answers resolved once per
// connection, pinned, and rechecked against private/metadata ranges (rebinding defense); redirects
// re-validated against policy per hop within the redirect cap. Preset lists frozen in the manifest:
// npm-registry = registry.npmjs.org:443/https; github = api.github.com, github.com,
// codeload.github.com, objects.githubusercontent.com :443/https. Sandbox attestation mirrors
// DockerNetworkConfig.browserEgress: { proxyEndpoint, denyDirectEgress: true } — no second
// attestation contract.
```

#### Frozen limits and performance gate

| Surface | Default | Hard cap / rule |
| --- | ---: | ---: |
| Git enumeration `ls-files` stdout bytes; invocations per enumeration | 8 MiB; 1 (+1 with includeIgnored) | 64 MiB; 2 (manifest `gitEnumeration`) |
| Repository depth/entries/files/results/scan/match/time | existing `limits.ts:26-51` | existing hard caps, unchanged |
| LSP message bytes; diagnostics/file; pending requests; results/query | 4 MiB; 200; 32; 500 | 32 MiB; 1000; 128; 5000 |
| LSP request timeout; restarts per server; servers per workspace | 30 s; 3 (then fail closed); 4 | 120 s; 3; 8 |
| Process sessions per run; input write bytes; lifetime | 8; 64 KiB; 4 h | 32; 1 MiB; 24 h |
| Process output chunk; total output per session | 50 KiB; 64 MiB | 1 MiB; 1 GiB (existing accumulator ceilings) |
| Forge pages/op; payload bytes; comments/review; concurrency; timeout | 10; 1 MiB; 100; 4; 30 s | 100; 8 MiB; 1000; 8; 120 s |
| Egress connections; request/response bytes; transfer time; rules; redirect hops | 32; 64 MiB; 10 min; 128; 5 | 256; 1 GiB; 1 h; 1024; 10 |

Benchmark gate (Task 7): enumeration p95 ≤ 2 s on a 100k-file synthetic repository (≤ 2 git invocations); process session streaming 1 GiB spill stays within accumulator caps, chunk-page p95 ≤ 10 ms; LSP 1000-diagnostic normalization p95 ≤ 100 ms; forge 100-page pagination bounded with no per-page duplication; proxy 64 MiB download completes within byte/time caps with resident buffering ≤ 2× maxBytes under backpressure.

#### Adversarial and protocol matrices

| Area | Required adversarial proof | Frozen response |
| --- | --- | --- |
| Git enumeration | Nested/global/`info/exclude` negation vs `git ls-files` ground truth; symlink escape; `.git` internals; path outside root; model-supplied git flags; detection flapping | Fixed argv only; results re-validated against root/containment before exposure; exec failure post-detection -> `RepositoryError`; includeIgnored is host config, never a tool argument. |
| LSP | Malformed/oversized frame; header injection; URI outside workspace; server crash loop; rename across 1000 files; model-supplied server command | Framing parser bounded per message cap -> `ERR_PRISM_LSP_FRAMING`; URIs canonicalized + root-checked; restart budget 3 then `ERR_PRISM_LSP_SERVER`; commands host allow-listed; edits gated by policy/approval before any write. |
| Process | Wrong-owner/cross-run handle access; orphan after run cancel; expiry during active output read; stdin flood; released-session re-attach; sandbox loss mid-run | Ownership checked per operation -> `ERR_PRISM_PROCESS_OWNERSHIP`; cancel kills owned sessions; input byte cap; release is terminal for attachment; backend loss -> state `unknown` + event, never fabricated exitCode. |
| Forge | Token in argv/logs/events/model output; idempotency-key retry after crash; stale head (422); rate-limit storm; wrong repo/tenant; approval denied | `GIT_CONFIG_*` env injection + redaction sweep; effectStore claim returns existing record on retry; typed `ERR_PRISM_FORGE_STALE`/`_RATE_LIMIT`; repository bound at construction; denied -> no request attempted. |
| Egress | DNS rebinding (answer flips to private IP); literal-IP bypass; redirect chain escape; CONNECT to unlisted port; metadata IP 169.254.169.254; direct container egress | Pinned+rechecked DNS -> `ERR_PRISM_EGRESS_DNS`; policy evaluated on every hop; deny-all default; attestation requires `denyDirectEgress: true` or sandbox composition fails closed `ERR_PRISM_EGRESS_ATTESTATION`. |
| Activation | Import of any new module; construction without activation | Zero spawns, listeners, timers, or network on import/construction; explicit start/dispose only (LSP lazy-on-first-use, proxy explicit start, sweeper on access). |

**Freeze conformance fixture:** `scripts/phase9-freeze-manifest.json` created (exports, states, events, error codes, presets, caps). Tasks 1–7 tests assert implementation surfaces match it exactly.

- [x] Task 1 — Git-aware repository enumeration with bounded native fallback
  - Acceptance Criteria:
    - Functional: repository list/search/glob can enumerate via Git tracked + unignored files honoring nested `.gitignore`, global excludes, and `.git/info/exclude`; tracked-but-ignored files remain visible per Git semantics; outside a Git repository (or on Git failure) the existing bounded native walker is used unchanged.
    - Functional: enumeration integrates with existing path/policy limits; ignored/private paths stay excluded from `repo_list`, `repo_search`, and `glob` results unless an explicit host-approved option includes them; symlink, binary, and worktree cases match current fail-closed behavior.
    - Performance: enumeration is O(tracked files) via `git ls-files`/`check-ignore` batching, never per-file subprocess; entry/depth/byte/time caps from Task 0 freeze hold on large repositories; fallback walker keeps current ceilings.
    - Code Quality: Git enumeration lives behind `RepositoryOperations`-compatible contracts; native walker is not rewritten; no `.gitignore` parser is hand-rolled when Git itself answers.
    - Security: no path outside workspace root is emitted; `.git` internals never listed; Git command arguments are fixed (no model-supplied flags); host approval required to surface ignored paths.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`; `packages/coding-agent/src/repository.ts`, `list.ts`, `search.ts`, `glob.ts`, `glob-match.ts`, `git-exec.ts`, `limits.ts`.
      - <https://git-scm.com/docs/git-ls-files> (`--cached`, `--others`, `--exclude-standard`, `-z`), <https://git-scm.com/docs/git-check-ignore>.
    - Options Considered:
      - Parse `.gitignore` rules in TypeScript: rule parity with real Git is a known trap (negation, nested, global); reject.
      - `git ls-files --cached --others --exclude-standard -z` for enumeration plus batched `check-ignore` where needed: chosen.
      - Replace native walker entirely: breaks non-Git workspaces; reject.
    - Chosen Approach:
      - Add a Git-aware enumeration provider behind the existing repository contract with explicit fallback detection; reuse `git-exec.ts` bounded execution and existing limit plumbing.
      - Inject a `RepositoryWalk` into `createLocalRepositoryOperations` so list/search/glob keep shared limit/abort/content logic; Git walk synthesizes directory entries from `ls-files` paths.
    - API Notes and Examples:
      ```ts
      const ops = createGitAwareRepositoryOperations(cwd, { fallback: nativeRepositoryOps });
      await ops.list({ root: cwd, path: ".", maxDepth: 3 }); // tracked + unignored, or native fallback
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/git-aware-repository.ts` (new), `repository.ts`, `limits.ts`, `index.ts` exports, package tests.
      - `docs/coding-agent-tools.md`, `docs/index.md`, package README/CHANGELOG.
    - References:
      - `packages/coding-agent/src/repository.ts:168`, `git.ts:126`, `git-exec.ts`, `limits.ts`.
  - Test Cases to Write:
    - Nested `.gitignore`, global excludes, `.git/info/exclude`, negation rules, tracked-but-ignored file: results match `git ls-files` ground truth.
    - Non-Git directory and Git-exec failure: native fallback with identical limits and no behavior change.
    - Symlink escape, `.git` internals, path outside root: fail closed; include-ignored requires host approval.
    - Large synthetic repository (frozen entry count): enumeration within time/entry caps; single batched Git invocation, no per-file spawn.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; enumeration source and ignored-path visibility change behind a new optional factory.
    - Docs pages to create/edit: `docs/coding-agent-tools.md` (Git-aware enumeration section, fallback, approval for ignored paths).
    - `docs/index.md` update: yes; Coding tools entry notes ignore-aware enumeration.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 1 completion record — 2026-08-06

- Shipped `createGitAwareRepositoryOperations(cwd, options?)` in `packages/coding-agent/src/git-aware-repository.ts`; exports + `parseGitLsFilesZ` helper; `DEFAULT_MAX_LS_FILES_OUTPUT_BYTES` / `HARD_MAX_LS_FILES_OUTPUT_BYTES` in `limits.ts`.
- `createLocalRepositoryOperations(limits?, walk?)` accepts injectable `RepositoryWalk` so Git enumeration reuses list/search/glob limit, abort, and content-scan paths without rewriting the native walker.
- Detection: cached `rev-parse --is-inside-work-tree`; non-Git / detection error → `fallback` (default native). Post-detection `ls-files` failure → `RepositoryError` (fail closed).
- Enumeration: fixed `git ls-files --cached --others --exclude-standard -z`; optional second `-o -i --exclude-standard -z` only when host sets `includeIgnored: true`.
- Tests: `git-aware-repository.test.ts` 7/7 (gitignore nesting, tracked-but-ignored, includeIgnored host-only, fallback, fail-closed, symlink/.git exclusion, search/glob + single ls-files invocation + entry cap). Repository/glob regression 25/25 green.
- Docs: `docs/coding-agent-tools.md` Git-aware section + export table; `docs/index.md` Coding tools blurb; package README/CHANGELOG Unreleased.

- [x] Task 2 — Language intelligence contract with host-selected LSP client
  - Acceptance Criteria:
    - Functional: a `LanguageIntelligence` contract exposes workspace symbols, definitions, references, diagnostics, hover, and rename/workspace edits; each operation maps to LSP 3.17 methods over one bounded JSON-RPC client (Content-Length framing) with host-selected server command/args per language.
    - Functional: workspace edits route through existing atomic write/edit and approval paths; rename applies only policy-checked in-workspace edits; diagnostics are capped and normalized across servers.
    - Functional: no server starts by import; servers spawn only on explicit host configuration, are tracked as managed processes (Task 3 contract where applicable), and stop on release/dispose.
    - Performance: frozen caps on message bytes, diagnostics per file, pending requests, symbol/reference result counts, and per-request timeout/abort; server crash triggers bounded restart or fail-closed, never unbounded respawn.
    - Code Quality: contract is server-agnostic and generic (reusable by future modes); no language-specific logic beyond a host-provided server map; no parser framework invented.
    - Security: server commands/args are host-allow-listed and never model-supplied; file URIs confined to workspace root; LSP payloads treated as untrusted (size/type validated); edits require the same policy/approval as write/edit tools.
  - Approach:
    - Documentation Reviewed:
      - LSP 3.17: initialize/initialized, `textDocument/{definition,references,hover,rename,publishDiagnostics}`, `workspace/symbol`, `workspace/applyEdit`: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>.
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`; `packages/coding-agent/src/atomic-write.ts`, `edit.ts`, `execution-policy.ts`, `output-accumulator.ts`.
    - Options Considered:
      - Depend on `vscode-languageserver-protocol` npm package: adds dependency against dependency-free posture and hides bounds; reject in favor of a small in-package client (final call confirmed at freeze).
      - In-package minimal JSON-RPC/LSP framing client with host-supplied server spawn: chosen.
      - Tree-sitter native indexing: rejected non-goal.
    - Chosen Approach:
      - `createLanguageIntelligence({ workspaceRoot, servers: { typescript: { command, args } }, limits })`; lazy per-language server start; requests carry abort/timeout; edits flow through mutation queue + approval.
    - API Notes and Examples:
      ```ts
      const lang = createLanguageIntelligence({ workspaceRoot, servers, limits });
      await lang.definitions({ file: "src/a.ts", line: 10, character: 4 });
      await lang.rename({ file: "src/a.ts", line: 10, character: 4, newName: "x" }); // approval-gated edits
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/language/` (client, contract, diagnostics normalize, edit bridge), `index.ts` exports, fake-LSP fixtures + tests.
      - New `docs/language-intelligence.md`, `docs/coding-agent-tools.md` cross-link, package README/CHANGELOG.
    - References:
      - `packages/coding-agent/src/atomic-write.ts`, `file-mutation-queue.ts`, `execution-policy.ts`; Task 3 process contract for server lifecycle.
  - Test Cases to Write:
    - Fake LSP server fixture: framing round-trip, malformed/oversized message rejected, initialize handshake, server crash → bounded restart/fail-closed.
    - Definitions/references/symbols/hover happy paths; diagnostics cap and normalization across two fake server dialects.
    - Rename applies multi-file edits atomically through approval; out-of-workspace URI or model-supplied server command fails closed.
    - Timeout/abort mid-request; pending-request cap; no provider/tool/timer activity on package import.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new contract, client, tools, and configuration surface.
    - Docs pages to create/edit: new `docs/language-intelligence.md` (full API page structure), `docs/coding-agent-tools.md`.
    - `docs/index.md` update: yes; add Language intelligence entry under Tools.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 2 completion record — 2026-08-06

- Shipped `packages/coding-agent/src/language/` (`framing.ts`, `client.ts`, `types.ts`, `intelligence.ts`, `index.ts`): `createLanguageIntelligence`, frozen error codes, limit resolve helpers.
- In-package LSP 3.17 Content-Length JSON-RPC client; host `servers` map; lazy spawn; `dispose()` kills children. No `vscode-languageserver-protocol`.
- Rename: `assertExecutionAllowed` (`kind: "edit"`, `operation: "rename"`) → `withFileMutationQueue` → `atomicWriteUtf8File`. Diagnostics capped/normalized from `publishDiagnostics`.
- Caps in `limits.ts`: `DEFAULT_MAX_LSP_*` / `HARD_MAX_LSP_*` / `LSP_RESTARTS_PER_SERVER` match `scripts/phase9-freeze-manifest.json`.
- Deferred: `processes?: ProcessSessions` optional wiring on language intelligence (available; host may compose). No ToolDefinition wrappers (contract-only).
- Tests: `language-intelligence.test.ts` 10/10 (framing, ops, diag dialects/cap, rename policy, workspace/unsupported fail-closed, abort/maxServers, crash restart budget). Fake fixture: `src/__tests__/fixtures/fake-lsp.mjs`.
- Docs: `docs/language-intelligence.md`; `docs/index.md` Tools entry; `docs/coding-agent-tools.md` export + non-goals; README/CHANGELOG Unreleased.

- [x] Task 3 — `ProcessSession` contract and managed process lifecycle
  - Acceptance Criteria:
    - Functional: `ProcessSession` supports `start`, incremental `output` (cursor/poll), `input` (stdin write), `status`, `wait` (exit), `signal`/`kill`, and `release` (detach without kill); sessions have bounded background lifetime with explicit sweep on expiry; PTY is an optional capability flag with explicit unsupported-platform result.
    - Functional: session registry enforces per-run/per-session ownership; run cancellation kills or releases owned sessions per frozen policy; concurrent session count, output bytes/chunk rate, and input bytes stay within Task 0 caps via the existing output accumulator.
    - Functional: durable metadata records session id, command fingerprint, owner, workspace, policy decision, start/exit timestamps, and terminal status; no claim that processes survive host/container loss.
    - Performance: output streaming is bounded and non-blocking to the agent loop; `wait` supports timeout/abort; orphan cleanup is O(owned sessions).
    - Code Quality: contract composes existing `ExecutionPolicy`, shell argv handling, and output accumulator; no process scheduler, job control language, or PTY emulation invented; PTY (if shipped) is host/platform capability, not a new dependency without freeze approval.
    - Security: command/args validated by execution policy exactly as one-shot shell; stdin/output redacted per credential contracts; wrong-owner or cross-session access fails closed; released sessions cannot be re-attached by another run/tenant.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`; `packages/coding-agent/src/shell.ts:306`, `output-accumulator.ts`, `execution-policy.ts`, `limits.ts`.
      - Node `child_process.spawn` stdio/signal/detach semantics (Node 20/current docs).
    - Options Considered:
      - Emulate sessions via repeated one-shot shell + log files: cannot input/attach reliably; rejected by roadmap.
      - In-memory registry with durable metadata records over existing session stores: chosen.
      - Mandatory PTY via native dependency: platform/dependency cost; optional capability only.
    - Chosen Approach:
      - `createProcessSessions({ cwd, policy, accumulator, limits })` returning start/handle API; handles are ownership-scoped; output ring buffer + cursor paging; expiry sweeper triggered on access (no implicit timers on import).
    - API Notes and Examples:
      ```ts
      const sessions = createProcessSessions({ cwd, policy, limits });
      const p = await sessions.start({ command: "npm", args: ["test", "--", "--watch"] });
      const out = await p.output({ cursor: 0, maxBytes: 8192 });
      await p.input("q\n"); await p.wait({ timeoutMs: 5000 }); // or p.signal("SIGTERM") / p.release()
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/process/` (contract, registry, handle, metadata), `index.ts` exports, tests with fake commands.
      - New `docs/process-sessions.md`, `docs/coding-agent-tools.md` cross-link, package README/CHANGELOG.
    - References:
      - `packages/coding-agent/src/shell.ts`, `output-accumulator.ts`, `execution-policy.ts`; Phase 7 run-cancellation contracts in `src/agents.ts`.
  - Test Cases to Write:
    - Start → incremental output paging → input → wait exit code; signal/kill terminates; release detaches and forbids re-attach by other owner.
    - Orphan cleanup after run cancellation; expiry sweep after frozen lifetime; output overflow spills per cap; input bytes cap.
    - Wrong-owner/wrong-session access fails closed; policy-denied command never spawns; redaction applies to captured output.
    - PTY requested on unsupported platform → explicit unsupported result, no crash; no timers/processes on package import.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new process-session contract, registry, and configuration surface.
    - Docs pages to create/edit: new `docs/process-sessions.md` (full API page structure), `docs/coding-agent-tools.md`.
    - `docs/index.md` update: yes; add Process sessions entry under Tools.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 3 completion record — 2026-08-06

- Shipped `packages/coding-agent/src/process/` (`types.ts`, `sessions.ts`, `index.ts`): `createProcessSessions`, frozen states/events/error codes, `resolveProcessSessionLimits`.
- Native `spawn` + `killProcessTree`; `OutputAccumulator` + new `readRaw(cursor, maxBytes)` for cursor-paged output; expiry sweep on access; durable metadata with SHA-256 command fingerprint (no env).
- `cancelOwned` kills by default; `releaseOnCancel` / `{ release: true }` detaches; `markUnknown` never fabricates `exitCode`; `pty: true` → `ERR_PRISM_PROCESS_PTY_UNSUPPORTED`.
- Caps in `limits.ts`: `DEFAULT_MAX_PROCESS_*` / `HARD_MAX_PROCESS_*` match `scripts/phase9-freeze-manifest.json`.
- Deferred: Docker `startProcess` (capability not yet viable); ToolDefinition wrappers; PTY; in-registry `ToolEffectStore` claims (host wires via `process_unknown` + exported helpers).
- Tests: `process-sessions.test.ts` 10/10 (lifecycle, release, cancelOwned, expiry/ownership, policy/PTY/caps, markUnknown/cwd, sandbox parity, one-shot fail-closed, sandbox-loss/reconcile).
- Docs: `docs/process-sessions.md`; `docs/coding-security.md` (`SandboxProcessHandle`); `docs/index.md`; README/CHANGELOG Unreleased.

- [x] Task 4 — Process sessions through sandbox, identity, cancellation, and unknown-outcome semantics
  - Acceptance Criteria:
    - Functional: process sessions run inside the active workspace/sandbox mode: native sessions honor `ExecutionPolicy`; sandboxed sessions map to `DisposableSandbox.exec`/`execFile`-compatible long-running handles or fail closed with explicit unsupported capability when the adapter is one-shot only.
    - Functional: sessions carry tenant/identity attribution; sandbox loss or host restart transitions sessions to a typed `unknown` terminal state using Phase 7 unknown-outcome recovery semantics; reconciliation never reports a lost process as cleanly exited.
    - Functional: typed coding lifecycle events (process start/exit/kill/release/expire, frozen in Task 0) emit through the existing event contracts with ownership and redaction.
    - Performance: sandbox session limits match Task 3 caps; reconciliation is O(owned sessions) and bounded in time.
    - Code Quality: integration is an adapter over Task 3 contract + `sandbox-coding-operations.ts`; no sandbox-only second process API; no changes to `DisposableSandbox` unless primitive review proves a generic long-running-handle gap.
    - Security: sandbox capability is detected, not assumed; identity/policy rechecked at every handle operation; audit records owner, policy decision, and terminal/unknown outcome.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-security.md`, `docs/tool-effects.md`, `docs/agent-events.md`; `packages/coding-security/src/sandbox.ts:56-69`, `sandbox-coding-operations.ts`, `docker-sandbox.ts`, `approval.ts`.
      - Phase 7 unknown-outcome recovery contracts (`docs/tool-effects.md`, `ToolEffectStore`).
    - Options Considered:
      - Extend `DisposableSandbox` with streaming exec handles for all adapters: may force Docker-only capability; decide via capability flag instead.
      - Capability-flagged long-running sandbox handle with explicit unsupported result elsewhere: chosen.
      - Pretend sandbox sessions survive container loss: rejected; explicit unknown outcome.
    - Chosen Approach:
      - Add optional long-running exec capability to the sandbox adapter contract (fail-closed default); Task 3 registry consumes either native or sandbox backend through one seam; terminal-state reconciliation on startup/resume.
    - API Notes and Examples:
      ```ts
      const sessions = createProcessSessions({ cwd, policy, sandbox, limits });
      // !sandbox.startProcess → start() fails closed with ERR_PRISM_PROCESS_UNSUPPORTED
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/sandbox.ts` (capability seam), `packages/coding-agent/src/process/` backend bridge, tests.
      - `docs/process-sessions.md`, `docs/coding-security.md`, changelogs.
    - References:
      - `packages/coding-security/src/sandbox.ts`; Phase 7 plan Task on tool effects: `plans/007-…md`.
  - Test Cases to Write:
    - Sandboxed long-running session: output/input/kill parity with native backend (fake sandbox adapter).
    - One-shot-only adapter: start fails closed with typed unsupported result; no fallback to unsafe path.
    - Sandbox loss mid-session → `unknown` terminal state, audit entry, no fabricated exit code; startup reconciliation marks orphans unknown.
    - Identity/policy recheck per operation; cross-tenant handle access fails closed; events emitted with redacted payloads.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; sandbox adapter capability surface and process-session backend behavior change.
    - Docs pages to create/edit: `docs/process-sessions.md` (sandbox backend section), `docs/coding-security.md`.
    - `docs/index.md` update: yes; Coding security entry notes process-session sandbox integration.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 4):**
  - Shipped: `SandboxProcessHandle` + optional `DisposableSandbox.startProcess?` in coding-security; `ProcessSandboxBackend` duck type + `sandbox`/`identity`/`reconcile()` on `createProcessSessions`.
  - Behavior: sandbox without `startProcess` → `ERR_PRISM_PROCESS_UNSUPPORTED` (no native fallback); `status` loss → all running → `unknown`; `reconcile()` for host resume; policy recheck on input/signal/kill; identity projects default owner.
  - Deferred: Docker `startProcess` implementation (adapter remains one-shot); in-package `ToolEffectStore` begin/complete (host listens to `process_unknown`); ToolDefinition wrappers; PTY.
  - Tests: `process-sessions.test.ts` 10/10.
  - Docs: `docs/process-sessions.md`, `docs/coding-security.md`, `docs/index.md`, both package CHANGELOGs.

- [x] Task 5 — Reference GitHub forge adapter with idempotent handoff
  - Acceptance Criteria:
    - Functional: one forge adapter provides issue context read, authenticated push (through existing `GitOperations`/credential injection), pull-request create/update, review comments, and check/status retrieval against GitHub; bounded handoff reconciliation reports push/PR/check state without duplicating merged work.
    - Functional: mutations flow through Phase 8 approval and Phase 7 `ToolEffectStore` idempotency keys; retry after crash does not duplicate PRs/comments; stale head/base and 422/rate-limit responses map to typed bounded errors.
    - Functional: credentials resolve through existing credential contracts (GitHub App installation token preferred; PAT supported); tokens never appear in argv, logs, model context, or stored events.
    - Performance: frozen caps on pages fetched, payload bytes, comment/diff sizes, and request concurrency; backoff on rate limit within deadline.
    - Code Quality: contract is narrow (only the proven operations above); no multi-forge generic abstraction; fake-GitHub conformance suite proves behavior before any live canary.
    - Security: least-privilege scopes documented; repository/tenant binding checked per call; host approval required for push/PR mutations; egress (if sandboxed) routes through Task 6 policy.
  - Approach:
    - Documentation Reviewed:
      - GitHub Apps auth: <https://docs.github.com/en/apps>; pulls/checks/issues REST: <https://docs.github.com/en/rest/pulls>.
      - `docs/coding-agent-tools.md`, `docs/credentials-and-redaction.md`, `docs/tool-effects.md`; `packages/coding-agent/src/git.ts:126`, `git-tools.ts`, `git-exec.ts`.
    - Options Considered:
      - Octokit dependency: heavy for six operations and hides retry/bounds; prefer minimal fetch-based client with frozen caps (final call at freeze with budget evidence).
      - GitHub-first narrow adapter: chosen.
      - GraphQL for everything: REST matches documented operations with simpler auditing; chosen.
    - Chosen Approach:
      - `createGitHubForge({ credentials, repository, approval, idempotencyStore, limits })`; push reuses `git-exec` with credential helper injected via environment, never argv; API calls via bounded authenticated fetch wrapper.
    - API Notes and Examples:
      ```ts
      const forge = createGitHubForge({ credentials, repository: "org/repo", approval, idempotencyStore });
      await forge.createPullRequest({ head, base, title, body }); // approval + idempotency key
      const checks = await forge.checks({ ref });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/forge/` (contract, github adapter, http wrapper, reconcile), `index.ts` exports, fake-GitHub fixtures + tests.
      - New `docs/forge-integration.md`, `docs/coding-agent-tools.md` cross-link, package README/CHANGELOG.
    - References:
      - `packages/coding-agent/src/git.ts`, `git-tools.ts`; Phase 7/8 approval and effect contracts.
  - Test Cases to Write:
    - Fake GitHub fixture: PR create/update, review comment, checks pagination, issue context; idempotency-key retry does not duplicate; 422/stale-head and rate-limit typed errors.
    - Push with injected credential: token absent from argv/logs/events/model-visible output; wrong repository/tenant fails closed.
    - Handoff reconciliation: pushed branch + open PR + green checks vs diverged/closed states, bounded report.
    - Approval denied → no mutation attempted; egress policy (Task 6) denies non-GitHub hosts.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new forge contract, adapter, tools/events, and credential usage.
    - Docs pages to create/edit: new `docs/forge-integration.md` (full API page structure), `docs/coding-agent-tools.md`.
    - `docs/index.md` update: yes; add Forge integration entry under Tools.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 5):**
  - Shipped: `src/forge/` (`types.ts` + `github.ts` + `index.ts`) with all frozen exports (`createGitHubForge`, `ForgeOperations`, `ForgeIssueContext`, `ForgePullRequest`, `ForgeCheck`, `ForgeHandoffReport`, `ForgeError`) and all six `ERR_PRISM_FORGE_*` codes; `DEFAULT/HARD_MAX_FORGE_*` limits added to `limits.ts`.
  - Behavior: `issueContext`/`checks` read-only; `push` reuses `BoundGitRunner` with `GIT_CONFIG_COUNT/KEY_n/VALUE_n` env `http.extraHeader` (base64 `x-access-token:<token>`), never argv; mutations gated by `ExecutionPolicy` (kind `forge`, risk `high`; denial propagates `ERR_PRISM_EXECUTION_DENIED`, no request attempted) then `effectStore.begin → markDispatched → execute → complete/fail`; completed replay returns the stored result (no duplicate PR/comment); 422 `already exists` on PR create fetches the open PR; 422 otherwise → `ERR_PRISM_FORGE_STALE`; 403 rate-limit/429 → backoff (Retry-After) then `ERR_PRISM_FORGE_RATE_LIMIT`; bounded streaming body (payloadBytes) → `ERR_PRISM_FORGE_LIMIT`; credentials resolved per call (`provider: "github"`) → missing token `ERR_PRISM_FORGE_AUTH`; durable context (`identity`/`ownership`/`sessionId`/`runId`) required for mutations, tenant mismatch fails at construction `ERR_PRISM_FORGE_OWNERSHIP`.
  - `reconcileHandoff`: compare + PR + check state → `ForgeHandoffReport` (pushed/ahead/behind/upToDate/merged/commits/changedPaths/diffstat/warnings); 404 head → `pushed: false`; never auto-merges.
  - Deferred: octokit (freeze), multi-forge abstraction (freeze), ToolDefinition wrapper tools, live canary (`PRISM_LIVE_GITHUB_TESTS`, Task 7), Task 6 egress routing.
  - Tests: `forge-github.test.ts` 13/13 (fake in-process GitHub HTTP server + fetch patch; idempotent retry, stale 422, rate-limit backoff, policy denial pre-network, tenant binding, pagination dedupe, reconcile merged/unpushed, payload cap). Full package suite 282/282; budget gate 7/7.
  - Docs: `docs/forge-integration.md` (new), `docs/coding-agent-tools.md`, `docs/index.md`, `packages/coding-agent/README.md`, `CHANGELOG.md`.

- [x] Task 6 — Allow-list egress composition with rebinding defense and attestation
  - Acceptance Criteria:
    - Functional: an opt-in egress proxy enforces exact host/port/protocol allow rules; default posture is deny-all; package-registry and source-host presets expand to explicit rule lists (no wildcards beyond frozen preset definitions).
    - Functional: DNS resolution pins and rechecks answers (rebinding defense); redirects are capped and re-validated against policy; private/metadata IP ranges are denied unless explicitly allowed; request/response bytes and total time respect frozen caps.
    - Functional: every allowed/denied decision writes an audit record; when composed with the Docker sandbox, attestation evidence shows proxy enforcement inside containment (no direct container egress bypass).
    - Performance: frozen caps on concurrent connections, bytes/s, and rule-eval cost (O(rules) exact match or precompiled table); backpressure behavior benchmarked.
    - Code Quality: composition over a selected proxy mechanism documented at freeze; no in-package firewall, TLS interception, or generic forward-proxy product; policy is data, not code.
    - Security: TLS passes through without interception; policy reload is explicit; audit contains no secrets; bypass attempts (literal IP, DNS rebinding, redirect chains, CONNECT to unlisted port) fail closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-security.md`, `docs/host-security.md`, `docs/browser-automation.md` (existing deny-by-default posture), `packages/coding-security/src/docker-sandbox.ts`, `docker-cli.ts`, `sandbox-limits.ts`.
      - Docker networking/resource controls documentation at implementation time; selected proxy mechanism docs recorded at freeze.
    - Options Considered:
      - Unrestricted sandbox networking with audit: rejected by roadmap.
      - HTTP/HTTPS forward proxy with exact allow rules + pinned DNS + Docker network isolation: chosen.
      - eBPF/iptables in-package firewall: platform complexity beyond harness scope; reject.
    - Chosen Approach:
      - `createEgressPolicy({ allow: [...], presets: ["npm-registry", "github"] })` + `createAllowListEgressProxy({ policy, audit, limits })`; sandbox composition wires proxy as the only network path and records attestation.
    - API Notes and Examples:
      ```ts
      const egress = createAllowListEgressProxy({
        policy: createEgressPolicy({ allow: [{ host: "api.github.com", port: 443, protocol: "https" }], presets: ["npm-registry"] }),
        audit, limits,
      });
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/egress/` (policy, presets, proxy, dns-pin, audit), `docker-sandbox.ts` composition hook, `index.ts` exports, tests.
      - `docs/coding-security.md` egress section, `docs/host-security.md` cross-link, package README/CHANGELOG.
    - References:
      - `packages/coding-security/src/docker-sandbox.ts`, `sandbox-limits.ts`, `approval.ts`.
  - Test Cases to Write:
    - Exact allow/deny matrix incl. port/protocol mismatch; DNS rebinding (answer flips to private IP) denied; redirect chain re-validation and cap; metadata IP (169.254.169.254) denied.
    - Package download within byte/time caps succeeds; oversized/slow-loris responses hit caps; CONNECT to unlisted port fails closed.
    - Audit records allow+deny with no secrets; sandbox attestation proves proxied-only egress; direct-bypass attempt from inside fake container denied.
    - Proxy import/start inert until host activation; policy reload requires explicit call.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new egress policy/proxy/attestation configuration surface.
    - Docs pages to create/edit: `docs/coding-security.md` (egress section), `docs/host-security.md`.
    - `docs/index.md` update: yes; Security entry notes allow-list egress.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 6):**
  - Shipped: `packages/coding-security/src/egress/` (`types.ts`, `limits.ts`, `policy.ts`, `dns-pin.ts`, `proxy.ts`, `index.ts`) with all frozen exports (`createEgressPolicy`, `createAllowListEgressProxy`, `EgressRule`, `EgressPolicy`, `EgressPreset`, `EgressProxy`, `EgressAuditRecord`, `EgressError`), both presets, and all five `ERR_PRISM_EGRESS_*` codes; frozen `DEFAULT/HARD_MAX_EGRESS_*` caps (32/256 connections, 64 MiB/1 GiB request+response bytes, 600 s/1 h transfer time, 128/1024 rules, 5/10 redirect hops).
  - Behavior: deny-all default; exact host/port/protocol match, no wildcards; presets expand to explicit rule lists; SHA-256 policy fingerprint; proxy inert until `start()` (no bind/resolve on import); HTTP absolute-form forwarding + CONNECT tunnels with TLS pass-through (no interception); DNS resolved once, pinned, connected socket remote address verified against pinned set (rebinding defense); private/link-local/metadata ranges denied unless `allowPrivate: true` on the matching rule; plain-HTTP redirects followed up to `redirectHops` with per-hop policy re-validation (unlisted/non-http hops fail closed); request/response byte caps and total transfer-time cap cut oversized/slow-loris transfers; every allow/deny writes an `EgressAuditRecord` (no headers/bodies/tokens); `reloadPolicy` is the only rule-change path and bumps `policyVersion`; `attestation()` returns `{ proxyEndpoint, denyDirectEgress: true, policyFingerprint, policyVersion, startedAt }`.
  - Sandbox composition: `composeEgressSandboxNetwork(attestation, name)` + `assertEgressAttestation` in `docker-sandbox.ts`; custom networks carry validated `egress` attestation recorded as `prism.egress.endpoint/fingerprint/policyVersion/denyDirect=1` container labels; malformed attestation fails closed. Attestation is evidence, not enforcement — host must restrict the Docker network so the proxy is the only reachable path (documented; mirrors `browserEgress` posture).
  - Deferred: in-package firewall/iptables/eBPF (rejected at freeze), TLS interception (rejected), bytes/sec rate limiter (frozen caps cover via transferTimeMs + responseBytes), live proxy canary (Task 7), forge-through-proxy wiring example (Task 7 packed examples).
  - Tests: `egress.test.ts` 23/23 (policy matrix, presets, fingerprint, private/metadata ranges, rebinding assert, allow/deny HTTP, redirect chain + unlisted hop + hop cap, response-byte cap, transfer-time cap, CONNECT tunnel + unlisted port + private denial, inert-until-start, reload, concurrency cap, limits validation, attestation validation, sandbox label recording). Full coding-security suite 77 pass + 1 protected Docker skip; budget gate 7/7.
  - Docs: `docs/coding-security.md` (egress section), `docs/host-security.md`, `docs/index.md`, `packages/coding-security/README.md`, `CHANGELOG.md`.

- [x] Task 7 — Cross-cutting conformance, adversarial suites, benchmarks, and packed examples
  - Acceptance Criteria:
    - Functional: one conformance suite composes Git-aware enumeration + language intelligence + process sessions + forge + egress in a single coding scenario (fake LSP/forge/proxy, network-free); every Task 0 frozen cap has at least one adversarial test at/below/above the limit.
    - Functional: the same suite covers the FR additions: AG-UI encrypted-value helper in a projection scenario (FR-3), MCP Apps UI mutation recorded in `ToolEffectStore` with unknown-outcome reconciliation and idempotent retry (FR-4), NATS JetStream event-source replay over a fake/in-process server (FR-5), and the `@arnilo/prism-session-store-postgres` root-export import smoke (FR-6).
    - Functional: packed examples demonstrate opt-in activation of each capability and one composed workflow; examples run in the demo gate without network/credentials.
    - Performance: benchmarks for large-repository enumeration, long-running process output, LSP message volume, forge pagination, and proxy backpressure meet frozen budgets; results recorded as release evidence.
    - Code Quality: no test-only behavior branches; fixtures live under package `__tests__`/examples conventions; protected live suites (GitHub App, real LSP server, sandbox+proxy, real NATS) are gated and fail closed without credentials.
    - Security: adversarial matrix covers symlink/ignore escape, LSP URI escape, process ownership, forge token leakage, egress bypass, cross-tenant access, encrypted-value opacity (no signature inference), MCP Apps effect wrong-owner/claim CAS, and NATS cross-tenant subject access; all fail closed.
  - Approach:
    - Documentation Reviewed:
      - Prior conformance plans: `plans/008-…md` Task 7; `docs/performance.md`; existing benchmark scripts under `scripts/`.
    - Options Considered:
      - Per-package suites only: misses composed regressions; reject.
      - One phase-level conformance + benchmark gate mirroring Phase 8: chosen.
    - Chosen Approach:
      - `scripts/` phase-9 conformance entry + benchmark evidence files; examples registered in the demo gate; live canaries behind env flags (`PRISM_LIVE_GITHUB_TESTS`, `PRISM_LIVE_LSP_TESTS`, sandbox/proxy gate).
    - API Notes and Examples:
      ```bash
      node --test dist/__tests__/phase9-conformance.test.js
      PRISM_LIVE_GITHUB_TESTS=1 GITHUB_APP_TOKEN=… node --test … # blocked gate without credentials
      ```
    - Files to Create/Edit:
      - `scripts/` conformance/benchmark entries, `src/__tests__/` or package `__tests__/` phase-9 suites, `examples/` new composed example(s), demo gate registration.
      - FR additions: `packages/ag-ui/src/__tests__/` (encrypted-value helper, MCP Apps effect retry), `packages/session-store-nats/src/__tests__/` (fake NATS server), `packages/session-store-postgres/src/__tests__/root-exports.test.ts`.
    - References:
      - `plans/008-…md` Task 7 evidence format; `docs/performance.md`.
  - Test Cases to Write:
    - Composed scenario: ignore-aware search → LSP rename (approved) → watch process captures test run → forge PR (fake) → egress allows only github+registry.
    - FR composed scenario: AG-UI projection emits `REASONING_ENCRYPTED_VALUE` from the helper → MCP Apps UI mutation recorded → transport loss marks `unknown` → host reconciles and retries idempotently → NATS replay after reconnect.
    - Limit ladder tests at/below/above every frozen cap; benchmark regression check against frozen budgets.
    - Live canaries fail closed (blocked gate, not silent skip) without credentials/sandbox/NATS.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new surface; validates frozen surfaces.
    - Docs pages to create/edit: `docs/performance.md` benchmark evidence section.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 7):**
  - Shipped: `scripts/phase9-conformance.test.mjs` (8 network-free cases, registered in `npm test`), `scripts/benchmark-0.0.26.mjs` + `scripts/benchmark-0.0.26.json` (5 scenarios, checked by `budget-gate.test.mjs` against the new `budgets.json` `phase9` section), `examples/phase9-coding-intelligence.ts` (packed composed demo, registered in `examples/README.md`), `docs/performance.md` evidence section.
  - Composed scenario: real git repo → ignore-aware enumeration (ignored `run.log` excluded) → approved LSP rename via fake LSP server (policy `allowed: true`, atomic write applied) → managed process session captures output → forge push + PR with idempotent replay (fake GitHub HTTP + fake git runner; token never in argv; replay does not re-POST) → egress proxy with github+registry presets (listed host 200, unlisted 403 `ERR_PRISM_EGRESS_DENIED`).
  - Adversarial matrix: symlink/ignore escape (ignored path + symlink target outside root never listed/searched), LSP URI escape (`ERR_PRISM_LSP_WORKSPACE`), process wrong-owner (`ERR_PRISM_PROCESS_OWNERSHIP`), forge cross-tenant (construction-time `ERR_PRISM_FORGE_OWNERSHIP`) + token hygiene (GIT_CONFIG_* env, never argv), egress private/metadata bypass (169.254.169.254 denied without `allowPrivate`), limit ladder (LSP `maxServers`, process `maxSessions`, egress `maxRules`, forge `pagesPerOperation` — all fail closed at/above caps).
  - Benchmarks (p95, ceilings from Task 0 freeze): enumerationList 299 ms ≤ 2,000 ms (100k-file synthetic repo, 1 git invocation per list, 10k results cap); processChunkPage 0.051 ms ≤ 10 ms (1 GiB produced, 64 MiB retained + spill, 50 KiB pages); lspDiagnosticNormalize 0.210 ms ≤ 100 ms (1,000 diagnostics at hard per-file cap); forgePagination 144 ms ≤ 10,000 ms (100 pages × 100 check-runs, no duplication); proxyDownload 94 ms ≤ 30,000 ms (64 MiB at default response cap, resident buffering ≤ 2× maxBytes). Evidence recorded in `scripts/benchmark-0.0.26.json` and gated by the budget gate (8/8).
  - Freeze amendment (recorded): `CreateGitHubForgeOptions.fetch?` — host-injectable fetch (defaults to `globalThis.fetch`); added so tests inject a mock fetch instead of patching the global (network-free guard) and so hosts can route forge traffic through the egress proxy. Additive only; no frozen export changed.
  - Debt fixed: `forge-github.test.ts` patched `globalThis.fetch`, violating the network-free guard (root suite had not run since Task 5); refactored to inject `fetch` via the new option. `fake-lsp.mjs` gained `FAKE_LSP_DIAG_COUNT` (default 1, output unchanged) for the 1,000-diagnostic benchmark. Docs tripwire updated: LSP is no longer a Phase 4 capability gap (shipped in Task 2), so `No LSP / language-server tools` and `No PDF/trash/PTY/LSP` expectations were removed.
  - FR-dependent conformance items (FR-3 encrypted-value helper, FR-4 MCP Apps effect retry, FR-5 NATS replay, FR-6 root-export smoke) land with Tasks 9–12; the suite and example are structured so those cases append without rework.
  - Verification: full `npm test` green (root 1,404 + gates + phase8/9 conformance + all workspaces); `tsc -p examples` clean; budget gate 8/8; example runs standalone.

- [x] Task 8 — Documentation, migration, changelogs, compat baseline, and release evidence
  - Acceptance Criteria:
    - Functional: `docs/language-intelligence.md`, `docs/process-sessions.md`, `docs/forge-integration.md` follow the required API page structure; `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/migration.md` (`0.0.25 → 0.0.26`), and `docs/index.md` are updated; docs tripwire asserts Phase 9 coverage.
    - Functional: FR additions documented: `docs/ag-ui.md` (encrypted-value helper FR-3, MCP Apps effect retry FR-4), `docs/agent-events.md` (NATS JetStream adapter FR-5 + durable `AgentEventSource` placement answer FR-7), `docs/migration.md` (FR-6 root-export note + FR-7 migration path from `persistence.events` / `createPostgresAgentEventSource`); tripwire asserts FR coverage.
    - Functional: all workspace manifests/peers/lockfile/`version` export/changelogs move to **0.0.26** (including the new `@arnilo/prism-session-store-nats` manifest); compat baseline regenerated; `plans/README.md` and `roadmap.md` record completion evidence.
    - Performance: release gate, package budget, and benchmark evidence recorded; no unexplained skips in protected GitHub/LSP/sandbox/proxy/NATS suites.
    - Code Quality: docs link/local-reference tests pass from clean checkout; changelog blurbs consistent with prior phases.
    - Security: audit, secret/SBOM/license scans, tarball checks clean; credentials handling in docs examples uses placeholders only.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; `docs/index.md`, `docs/migration.md`, `docs/0.1.0-readiness.md`; `plans/008-…md` Task 8.
    - Options Considered:
      - Single combined docs page for all four capabilities: index discoverability suffers; reject.
      - Three new API pages + updates to existing pages: chosen.
    - Chosen Approach:
      - Follow Phase 8 Task 8 mechanics: version bump sweep, baseline regen, tripwire test, release check/gate, pack dry-run.
    - API Notes and Examples:
      ```bash
      npm run release:check -- --version 0.0.26
      ```
    - Files to Create/Edit:
      - All docs pages above, `docs/index.md`, workspace manifests/lockfile/changelogs, `scripts/compat-baseline/*`, `plans/README.md`, `roadmap.md`.
      - FR additions: `packages/session-store-nats/` (new manifest + README + CHANGELOG), `packages/session-store-postgres/README.md` + `CHANGELOG.md` (root export), `packages/ag-ui/README.md` + `CHANGELOG.md` (helper + effect retry).
    - References:
      - `plans/008-…md` Task 8 completion record.
  - Test Cases to Write:
    - Docs link/local-reference tests; Phase 9 tripwire (language intelligence, process sessions, forge, egress coverage); FR tripwire (encrypted-value helper, MCP Apps effect retry, NATS event source, session-store-postgres root export, placement answer); migration section assertions.
    - `release:check --version 0.0.26`, pack dry-run for all publishable manifests, audit, secret/SBOM/license, Node 20/current import smoke, `git diff --check`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this task is the documentation deliverable.
    - Docs pages to create/edit: all listed above.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 8):**
  - Docs: `docs/migration.md` new `0.0.25 → 0.0.26 coding intelligence, managed processes, forge, and safe egress (additive)` section (six numbered notes + example; no migration steps required — all Phase 9 additions are opt-in factories); `docs/0.1.0-readiness.md` current line → 0.0.26/Phase 9; `docs/release-and-install.md` current-line refs + new `0.0.26 publish handoff` section; `docs/index.md` performance + migration entries; `docs/performance.md` 0.0.26 evidence (Task 7); `docs/host-security.md` egress attestation (Task 6). API pages `language-intelligence.md` / `process-sessions.md` / `forge-integration.md` follow the wiki API-page structure (Tasks 2/3/5).
  - Docs tripwire: new `phase9 coding intelligence processes forge egress docs cover migration limits examples and evidence` test in `src/__tests__/docs.test.ts` (page tokens per capability, migration heading, benchmark evidence, example + freeze-manifest existence); phase8 tripwire current-line assertion moved to 0.0.26/Phase 9; changelog tripwire moved to `## [0.0.26] - 2026-08-06`.
  - Version sweep: all **47** manifests/peers/lockfile/`version` export (`src/index.ts` → `0.0.26`) bumped; `package-lock.json` regenerated (0 stale refs); all 46 package changelogs + root `CHANGELOG.md` carry `0.0.26` sections (coding-agent/coding-security real entries, ag-ui + 44 blurb `Released with exact 0.0.26 graph`); hardcoded version assertions in `src/__tests__/{index,release,install-smoke,packaging,docs}.test.ts` and 12 package skeleton tests updated.
  - Compat baseline: regenerated via `release:gate --update-baseline` (coding-agent +153 lines Phase 9 exports, coding-security egress, core `version`); `release:gate --version 0.0.26` exit 0; `release:check --version 0.0.26` exit 0 with 47/47 `available`.
  - Evidence: full `npm test` green (root 1,404 + gates + phase8/9 conformance + all workspaces); budget gate + tooling gate 14/14; `scan-secrets` 3,583 files / 0 findings; `verify-sbom` 220 packages / 11 licenses; `npm audit` 0 vulnerabilities; `pack:dry-run` exit 0; `git diff --check` clean; import smoke (core `version` 0.0.26 + all Phase 9 factories resolve from dist); lint 0 errors; `format` fixed 22 Phase 9 files (Tasks 1–6 sources had never been format-checked), `format:check` now clean.
  - `plans/README.md` Phase 9 → complete (2026-08-06); `roadmap.md` Phase 9 → `[x]` with Tasks 0–8 shipped note.
  - FR-dependent items deferred to Tasks 9–12 (same pattern as Task 7): `docs/ag-ui.md` (FR-3/FR-4), `docs/agent-events.md` (FR-5/FR-7), migration FR-6/FR-7 notes, `@arnilo/prism-session-store-nats` manifest, and the FR tripwire assertions land with those tasks; the migration section already points at plan 009 Tasks 9–12 for the FR-6/FR-7 answer.
  - Operator handoff (per Phase 8 convention): signed `v0.0.26` tag + `sdk:ready` + publish dry-run from a clean single-flight checkout remain operator-gated.

- [x] Task 9 — FR-6/FR-7: Durable `AgentEventSource` root export and placement answer
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-session-store-postgres` root re-exports `createPostgresAgentEventSource`, `ClosablePostgresAgentEventSource`, and `PostgresAgentEventSourceOptions`; `import { createPostgresAgentEventSource } from "@arnilo/prism-session-store-postgres"` type-checks and runs against the packed package (no `dist/...` subpath import).
    - Functional: FR-7 answer recorded: the durable `AgentEventSource` stays in `@arnilo/prism-session-store-postgres` (root export), PostgreSQL LISTEN/NOTIFY remains the reference durable implementation, and the migration path from `persistence.events` / `createPostgresAgentEventSource` (0.0.24/0.0.25) is documented in `docs/migration.md` release notes.
    - Functional: no behavior change to `createPostgresPersistence`; `persistence.events` remains the canonical bundled path.
    - Code Quality: root-export import smoke test in the package test suite (no live Postgres needed for the export surface).
  - Approach:
    - Documentation Reviewed:
      - `prism-agent-event-source-export-and-location.md` (FR-6/FR-7); `packages/session-store-postgres/src/index.ts`, `event-source.ts`.
    - Options Considered:
      - Move the event source to a new package: churn without benefit; the Postgres source is already bundled as `persistence.events`; reject.
      - Re-export from the existing root: chosen (one-line surface fix).
    - Chosen Approach:
      - Add the three exports to `packages/session-store-postgres/src/index.ts`; add a root-import smoke test; document the placement answer and migration path in `docs/migration.md` + package README/CHANGELOG.
    - API Notes and Examples:
      ```ts
      import { createPostgresAgentEventSource } from "@arnilo/prism-session-store-postgres";
      const source = createPostgresAgentEventSource({ pool, schema, cursorSecret });
      ```
    - Files to Create/Edit:
      - `packages/session-store-postgres/src/index.ts`, `src/__tests__/root-exports.test.ts`, README, CHANGELOG, `docs/migration.md`, `docs/agent-events.md`.
    - References:
      - `prism-agent-event-source-export-and-location.md`; `plans/007-…md` Task 4 (event source).
  - Test Cases to Write:
    - Root import smoke: `createPostgresAgentEventSource`/`ClosablePostgresAgentEventSource`/`PostgresAgentEventSourceOptions` resolve from the package root; `persistence.events` unchanged.
    - Migration doc assertions: FR-7 answer present in `docs/migration.md`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; root export surface of `@arnilo/prism-session-store-postgres`.
    - Docs pages to create/edit: `docs/agent-events.md`, `docs/migration.md`, package README/CHANGELOG.
    - `docs/index.md` update: yes (session-store-postgres entry).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 9):**
  - Shipped: `packages/session-store-postgres/src/index.ts` re-exports `createPostgresAgentEventSource`, `ClosablePostgresAgentEventSource`, `PostgresAgentEventSourceOptions` from `./event-source.js`; new `src/__tests__/root-exports.test.ts` (root-import smoke, no live Postgres — construction is lazy, fake pool safe); packed-package root import added to the install-smoke composition (imports from the tarball, constructs + closes the source).
  - FR-7 answer recorded: durable `AgentEventSource` stays in `@arnilo/prism-session-store-postgres` for the 0.0.26 line; PostgreSQL `LISTEN`/`NOTIFY` remains the reference durable implementation; `persistence.events` remains the canonical bundled path (no behavior change to `createPostgresPersistence`). Migration path: no action — both paths keep working; any future relocation ships a replacement export with a deprecation note before removal.
  - Docs: `docs/agent-events.md` new `Placement (FR-7 answer, 0.0.26)` subsection with root-import example; `docs/migration.md` 0.0.26 section gains note 7 (FR-6/FR-7); package README gains `Standalone durable event source` section; package CHANGELOG real 0.0.26 entry (replaces blurb); FR record `prism-agent-event-source-export-and-location.md` status → **answered in 0.0.26 (plan 009 Task 9)**.
  - Tripwire: phase9 docs test now asserts `createPostgresAgentEventSource` + `reference durable implementation` in both `docs/migration.md` and `docs/agent-events.md`.
  - Verification: full `npm test` green (2,742 tests, 0 fail — +1 root-exports test); docs 113/113; session-store-postgres 7/7; install-smoke 6/6 including packed FR-6 import; `git diff --check` clean.

- [x] Task 10 — FR-3: Reasoning encrypted-value helper (`@arnilo/prism-ag-ui`)
  - Acceptance Criteria:
    - Functional: a bounded helper produces the `AgUiReasoningProjection.encryptedValue` from a host-supplied encryption function and the redacted `ThinkingContent`; it never infers an encrypted value from a Prism reasoning signature.
    - Functional: helper output is capped by `maxReasoningBytes`; missing/invalid `encrypt` fails closed; helper is synchronous/pure like other projection callbacks.
    - Functional: exported from the `@arnilo/prism-ag-ui` root; documented in `docs/ag-ui.md`.
  - Approach:
    - Documentation Reviewed:
      - AG-UI spec `REASONING_ENCRYPTED_VALUE`; `packages/ag-ui/src/projection.ts` (`AgUiReasoningProjection`), `ag-ui-mapper.ts` reasoning path.
    - Options Considered:
      - Host hand-rolls encryption in the `reasoning` projection callback: repeated, error-prone; reject.
      - One factory `createReasoningEncryptedValue({ encrypt })` returning a projection fragment: chosen.
    - Chosen Approach:
      - `createReasoningEncryptedValue({ encrypt, content, event })` → `{ encryptedValue }` (or `undefined` when the host declines); `encrypt` is host-owned (client key), output bounded, errors swallowed to default-deny like other projection callbacks.
    - API Notes and Examples:
      ```ts
      import { createReasoningEncryptedValue } from "@arnilo/prism-ag-ui";
      const projection = { reasoning: (content, event) => createReasoningEncryptedValue({ encrypt: hostEncryptForClient, content, event }) };
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/encrypted-value.ts`, `src/index.ts`, `src/__tests__/encrypted-value.test.ts`, `docs/ag-ui.md`, README, CHANGELOG.
    - References:
      - AG-UI spec; `docs/ag-ui.md` projection section.
  - Test Cases to Write:
    - Helper returns bounded encrypted value; caps at `maxReasoningBytes`; missing `encrypt` fails closed; no inference from signatures; mapper emits `REASONING_ENCRYPTED_VALUE` with the helper output.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new ag-ui export.
    - Docs pages to create/edit: `docs/ag-ui.md`, package README/CHANGELOG.
    - `docs/index.md` update: no (ag-ui entry already exists; extend).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 10):**
  - Shipped: `packages/ag-ui/src/encrypted-value.ts` — `createReasoningEncryptedValue({ encrypt, content, event, maxBytes? })` → `AgUiReasoningProjection | undefined`; `encrypt` is host-owned (client key), receives the redacted `ThinkingContent` + Prism event, `undefined` declines; fails closed on missing/throwing/non-string/empty `encrypt`; never infers an encrypted value from a Prism reasoning signature (passes `encrypt` output verbatim); truncates via the existing `truncateUtf8` (exported from `ag-ui-mapper.ts`, reused — no duplicate truncation) to `maxBytes` (default `DEFAULT_MAX_REASONING_BYTES`, clamped to `HARD_MAX_REASONING_BYTES`); synchronous/pure like other projection callbacks. Exported from the package root (`src/index.ts`).
  - Tests: `src/__tests__/encrypted-value.test.ts` 6/6 — bounded value, UTF-8-safe cap (no split code points, 32,760 é survive), fail-closed matrix, verbatim pass-through, mapper emits `REASONING_ENCRYPTED_VALUE` with helper output, mapper emits nothing when helper declines.
  - Docs: `docs/ag-ui.md` new `Reasoning encrypted-value helper (FR-3)` subsection with usage example; package README root-export list entry; package CHANGELOG real 0.0.26 entry (replaces blurb).
  - Tripwire: phase9 docs test asserts `createReasoningEncryptedValue` + `never infers an encrypted value` in `docs/ag-ui.md`.
  - Verification: full `npm test` green (2,748 tests, 0 fail — +6 encrypted-value tests); docs 113/113; ag-ui 59/59; `git diff --check` clean.

- [x] Task 11 — FR-4: MCP Apps UI-initiated mutation retry through `ToolEffectStore`
  - Acceptance Criteria:
    - Functional: `createAgUiMcpAppHandler` accepts an optional `effectStore` plus identity/ownership/sessionId/runId context; every approved `tools/call` records `begin` → `markDispatched` → `complete`/`fail`/`markUnknown` in the store.
    - Functional: a UI mutation whose outcome is unknown after dispatch can be reconciled and retried idempotently via the claim/CAS lifecycle; the proxy itself never auto-retries (host decides).
    - Functional: wrong-owner/absent-store behavior fails closed; effect keys derive from identity + ownership + tool name + arguments hash (reuse Phase 7 `ToolEffectKey` derivation pattern).
    - Functional: exported types documented in `docs/ag-ui.md`; no behavior change when `effectStore` is absent (0.0.25 parity).
  - Approach:
    - Documentation Reviewed:
      - `plans/008-…md` FR-4 deferral note; `src/contracts.ts` `ToolEffectStore`; `packages/ag-ui/src/mcp-apps.ts` `tools/call` path; forge adapter idempotency pattern (Task 5).
    - Options Considered:
      - Auto-retry inside the proxy: violates "never retries UI mutations" and hides host policy; reject.
      - Record effects + expose reconciliation helper: chosen (mirrors forge `reconcileHandoff`).
    - Chosen Approach:
      - Optional `effectStore` + `effectContext` on `CreateAgUiMcpAppHandlerOptions`; `tools/call` wraps the approved call in the claim lifecycle; a `reconcileAppEffect` helper lets the host resolve `unknown` records against the actual outcome; `markUnknown` on transport/abort loss.
    - API Notes and Examples:
      ```ts
      const handler = createAgUiMcpAppHandler({ apps, authorize, context, approveToolCall, allowedOrigins, effectStore, effectContext });
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/mcp-apps.ts`, `src/effect-recovery.ts` (or inline), `src/index.ts`, `src/__tests__/mcp-apps-effect.test.ts`, `docs/ag-ui.md`, README, CHANGELOG.
    - References:
      - `src/contracts.ts:1105-1170`; `plans/009` Task 5 forge idempotency.
  - Test Cases to Write:
    - Approved call records begin/dispatched/complete; failure records `failed_retryable`; abort/transport loss records `unknown`; reconcile resolves unknown → completed and retry is idempotent (CAS); wrong owner fails closed; absent store keeps 0.0.25 behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; `createAgUiMcpAppHandler` options.
    - Docs pages to create/edit: `docs/ag-ui.md`, package README/CHANGELOG.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 11):**
  - Shipped: `packages/ag-ui/src/effect-recovery.ts` — `deriveAppEffectKey` (stable key: identity + ownership + tool name + arguments hash, Phase 7 pattern, `prism:ag-ui-app:v1:` prefix), `hashJson` (sha256 + canonical sort), `reconcileAppEffect` (host helper: resolves `unknown` records against the actual outcome via `resolveUnknown` claim/CAS; returns `undefined` for unrecorded calls; leaves `dispatched`/terminal records untouched), `AgUiMcpAppEffectContext` (required identity + ownership).
  - `createAgUiMcpAppHandler` gains optional `effectStore` + `effectContext` (falls back to `authorization.ownership` + `context.identity`; unresolvable → 403 fail closed). `tools/call` wraps the approved call: `begin` (5 min claim TTL) → `markDispatched` → `complete` (records `ToolResult`) / `fail` `failed_retryable` on call error / `markUnknown` on transport/abort loss (checked both during the call and after it resolves). Existing records: `completed`+result replays the recorded result idempotently (no re-dispatch); `failed_*`/`dispatched`/`unknown` → 409 fail closed until host reconciles. The proxy never auto-retries; absent `effectStore` keeps 0.0.25 parity (no recording).
  - Tests: `src/__tests__/mcp-apps-effect.test.ts` 7/7 — begin/dispatched/complete + idempotent replay, `failed_retryable` on throw, abort → `unknown` + `reconcileAppEffect` → completed + idempotent retry, wrong-owner records separately (store enforces identity↔ownership), unresolvable identity/ownership → 403, absent store 0.0.25 behavior, reconcile returns `undefined`/leaves `dispatched` untouched.
  - Docs: `docs/ag-ui.md` new `UI-initiated mutation retry through ToolEffectStore (FR-4)` subsection with handler + reconcile example; security note updated (records for host-driven retry, never auto-retries); package README root-export entry; package CHANGELOG real 0.0.26 entry.
  - Tripwire: phase9 docs test asserts `reconcileAppEffect` + `never auto-retries` in `docs/ag-ui.md`.
  - Verification: full `npm test` green (2,755 tests, 0 fail — +7 effect tests; one flaky LSP restart test passed in isolation and on re-run); docs 113/113; ag-ui 66/66; `git diff --check` clean.

- [x] Task 12 — FR-5: NATS JetStream `AgentEventSource` adapter
  - Acceptance Criteria:
    - Functional: a new `@arnilo/prism-session-store-nats` package implements `AgentEventSource` over NATS JetStream: durable consumer, per-subject replay, at-least-once delivery with stable event IDs; `append`/`page`/`subscribe`/`cleanup` parity with the Postgres source.
    - Functional: limits reuse `AgentEventSourceOptions` (bounded event/page/cursor/queue/subscriber/retention caps); cursors are resumable across reconnects; ownership scoping matches the Postgres source.
    - Functional: package is optional and inert on import; no NATS connection until `createNatsAgentEventSource` is called; network-free tests use an in-process/fake NATS server.
    - Functional: FR-7 answer updated: Postgres remains the reference durable implementation; NATS is a sibling adapter for JetStream backbones.
  - Approach:
    - Documentation Reviewed:
      - NATS JetStream docs (durable consumers, per-subject replay, at-least-once); `packages/session-store-postgres/src/event-source.ts` as the reference shape; `prism-agent-event-source-export-and-location.md` FR-5.
    - Options Considered:
      - Subpath inside `@arnilo/prism-session-store-postgres`: wrong home (Postgres-specific); reject.
      - New sibling package `@arnilo/prism-session-store-nats` with the official `nats` client: chosen (mirrors `pg` dependency pattern).
    - Chosen Approach:
      - `createNatsAgentEventSource({ connection, stream, limits? })` implementing the `AgentEventSource` contract; JetStream stream/subject layout per tenant/session/run; durable consumer with stable `entryId`; at-least-once redelivery; cleanup via stream purge/age limits.
    - API Notes and Examples:
      ```ts
      import { createNatsAgentEventSource } from "@arnilo/prism-session-store-nats";
      const source = createNatsAgentEventSource({ connection, stream: "prism_agent_events" });
      ```
    - Files to Create/Edit:
      - New `packages/session-store-nats/` (src, tests, package.json, README, CHANGELOG), workspace manifest + lockfile, `docs/agent-events.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - NATS JetStream docs; `packages/session-store-postgres/src/event-source.ts`; `src/contracts.ts:1910-1960`.
  - Test Cases to Write:
    - append/page/subscribe/cleanup parity with the Postgres source (fake NATS server, network-free); per-subject replay; at-least-once redelivery with stable IDs; cursor resumability; limits; ownership scoping; inert import.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new publishable package.
    - Docs pages to create/edit: `docs/agent-events.md`, `docs/migration.md`, `docs/index.md`, package README/CHANGELOG.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 12):**
  - Shipped: new package `@arnilo/prism-session-store-nats` (workspace glob `packages/session-store-*` picked it up; deps `@nats-io/transport-node` + `@nats-io/jetstream` 3.4.0, peer `@arnilo/prism`). `src/jetstream.ts` defines the narrow duck-typed `NatsJetStream` seam (publish/addConsumer/getConsumer/deleteConsumer/getMessage/deleteMessage) + `createNatsJetStream(nc)` adapting the official clients (verified against the 3.4.0 API: `js.publish` msgID dedupe, `jsm.consumers.add`, `js.consumers.get().fetch`, `jsm.streams.getMessage/deleteMessage`).
  - `src/event-source.ts` — `createNatsAgentEventSource({ connection, stream, limits?, cursorSecret? })` implementing the `AgentEventSource` contract: per-run subjects `prism.agent-events.<tenant>.<session>.<run>` (NATS-token validation, fail closed); JetStream per-subject sequence = per-run event sequence; `append` idempotent by `record.id` via `Nats-Msg-Id` (duplicate → stored-content verification, same-id-different-content fails closed); `page` via ephemeral auto-ack consumer from HMAC-signed cursor (limit+1 lookahead, terminal flag); `subscribe` via durable pull consumer (unique name, explicit acks, 30s ack_wait, max_deliver 1000, replay from cursor then live, id dedupe, ends at terminal, consumer deleted in finally); `cleanup` enumerates the tenant prefix and deletes messages older than `before` (ownership-scoped, bounded); account/user enforced at read time (tenant in subject); limits reuse `AgentEventSourceOptions` with Postgres-matching defaults/hards; `maxSubscribers` cap; inert on import; `close()` returns active subscribers.
  - Tests: `src/__tests__/event-source.test.ts` 11/11 network-free over the in-memory `FakeJetStream` (auto-ack for `all`, explicit ack tracking + redelivery counts, `expires` wait): append/page/cursor paging, idempotent append + collision fail-closed, per-subject replay isolation, ownership scoping, subscribe replay-to-live + terminal stop + consumer cleanup, cursor resume (no gap), at-least-once redelivery with stable seqs, cleanup by `before`/ownership, subscriber cap + limit validation, non-redacted/unsafe-identifier rejection, closed fail-closed.
  - Docs: `docs/agent-events.md` new `NATS JetStream adapter (FR-5)` subsection (usage + semantics + stream provisioning); `docs/migration.md` note 8; `docs/index.md` agent-events entry; package README (install/usage/stream provisioning/semantics) + CHANGELOG; FR record `prism-agent-event-source-export-and-location.md` FR-5 → **shipped in 0.0.26 (plan 009 Task 12)**; root CHANGELOG 0.0.26 entries.
  - Release graph: publishable manifests **47 → 48** swept across `release.test.ts`, `docs.test.ts` (2 count assertions + phrase), `docs/release-and-install.md` (manifest list + counts + 0.0.26 decision), `docs/migration.md` 0.0.26 line, `docs/0.1.0-readiness.md`; `release:check` 48/48 available; compat baseline regenerated (`--update-baseline`, new `arnilo__prism-session-store-nats.txt`); `release:gate` exit 0.
  - Tripwire: phase9 docs test asserts `createNatsAgentEventSource` + `at-least-once` in `docs/agent-events.md`.
  - Verification: full `npm test` green (2,766 tests, 0 fail — +11 NATS tests); docs 113/113; release 7/7; install-smoke 6/6 (48 tarballs); budget+tooling gates 14/14; `git diff --check` clean.
  - Deferred: live NATS integration suite (real server, JetStream enabled) mirrors the Postgres `PRISM_TEST_POSTGRES_URL` pattern; stream provisioning stays host-owned (documented required shape: subjects `prism.agent-events.>`, retention limits, dedupe window).

- [x] Task 13 — A2A server-side exposure: remote A2A clients invoke a local AG-UI-fronted agent
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-ag-ui` ships a server-side A2A adapter (proposed `createAgUiA2AServer`) that fronts one host-selected local agent exposure as an A2A 1.0 server, reusing `@arnilo/prism-supervisor` `createA2AHandler` transport/lifecycle (agent card, `SendMessage`/`SendStreamingMessage`, `GetTask`/`ListTasks`/`CancelTask`/`SubscribeToTask`, push, frozen `A2ALimits`); remote A2A clients can start a local run and stream mapped AG-UI events as A2A task events.
    - Functional: A2A authorization maps to AG-UI authorization (identity/ownership/approval semantics unchanged); A2A message parts project through the host `input.project` allow-list into AG-UI run input; mapper output (text/activity/state/A2UI) maps to bounded A2A text/status/artifact parts with the same redaction and byte caps as the AG-UI SSE path.
    - Functional: durable replay wiring via `createA2AAgentEventSource` so `afterEventId` cursors resume the local run from the durable `AgentEventSource`; terminal, `INPUT_REQUIRED`, and `AUTH_REQUIRED` states close streams like the existing A2A handler; no second runtime, task store, or worker is created.
    - Functional: no new route is added to `createPrismHandler()` (docs/server.md “A2A routes are not added” decision stays); the adapter ships a documented host mount recipe instead.
    - Code Quality: adapter composes over the existing supervisor A2A handler and the ag-ui mapper/replay; shares frozen `A2ALimits`; network-free tests use a fake A2A client; no new dependency.
    - Security: A2A parts/artifacts remain untrusted and are never promoted to system instructions; raw/data/url parts stay disabled unless the host `parts` policy selects them; authorization re-checked per operation; unknown-owner task lookups stay non-disclosing.
  - Approach:
    - Documentation Reviewed:
      - `docs/a2a.md`, `docs/ag-ui.md`, `docs/ag-ui-adoption.md` (A2A adoption section), `docs/server.md:165`; A2A 1.0 spec streaming rules.
      - `packages/supervisor/src/a2a-server.ts`, `a2a-types.ts`, `a2a-parts.ts` (frozen limits), `a2a-event-source.ts`; `packages/ag-ui/src/a2a.ts` (client-direction adapter).
    - Options Considered:
      - Add an A2A route to `createPrismHandler()`: reverses the documented “A2A stays separately mounted” decision and drags supervisor into the server package; reject.
      - Host-only recipe (mount supervisor `createA2AHandler` with a hand-written session factory): loses AG-UI authorization/projection/replay/A2UI mapping and duplicates the client adapter’s mapping logic; reject.
      - Ship an ag-ui server-side adapter fronting the existing supervisor handler: chosen — completes the bidirectional A2A story opposite `createAgUiA2AAdapter` with no new runtime.
    - Chosen Approach:
      - Add `createAgUiA2AServer` to `@arnilo/prism-ag-ui`: wraps a host-selected local agent exposure (session factory + authorization + projection/redaction + durable replay source), builds supervisor A2A handler options (card from exposure, `tasks` lifecycle from the durable source), maps A2A message → projected AG-UI input and mapped AG-UI events → A2A task events; export from the package root; document the mount recipe.
    - API Notes and Examples:
      ```ts
      const server = createAgUiA2AServer({
        card: agentCard,
        authorize: (input) => a2aAuthToAgUi(input.authorization), // identity/ownership unchanged
        sessionFactory: (authorization) => createAgUiSession(authorization),
        replay: createAgentEventSourceAgUiReplay(persistence.events, { resolveRun, ownership }),
        parts: { allowRaw: false, allowData: false, allowUrl: false },
      });
      // host mounts: new Request(url, init) → server(request)
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/a2a-server.ts` (new), `src/index.ts` exports, `src/__tests__/a2a-server.test.ts`, `docs/a2a.md`, `docs/ag-ui.md`, `docs/migration.md` (0.0.26 note), `docs/index.md`, package README/CHANGELOG.
    - References:
      - `packages/supervisor/src/a2a-server.ts`, `a2a-parts.ts`, `a2a-event-source.ts`; `packages/ag-ui/src/a2a.ts`; `plans/007` A2A task lifecycle; `docs/a2a.md`, `docs/ag-ui-adoption.md`.
  - Test Cases to Write:
    - Network-free: fake A2A client → adapter → local run — `SendMessage` text maps to projected input; streaming task events mirror mapper output (text/status/terminal); `SubscribeToTask` with `afterEventId` resumes from the durable source without duplicate side effects; authorization identity/ownership asserted per operation; denied authorization → non-disclosing `-32001`-style errors; caps (message bytes, history, page size) enforced; raw/data/url parts disabled by default.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new ag-ui export.
    - Docs pages to create/edit: `docs/a2a.md` (server-side exposure + mount recipe), `docs/ag-ui.md`, `docs/migration.md`, `docs/index.md`.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 13):**
  - Shipped: `createAgUiA2AServer` in `@arnilo/prism-ag-ui` (`src/a2a-server.ts`, root export). Non-generic: `A2AAuthorization` (supervisor) is the shared authorization for every AG-UI surface — hosts with richer AG-UI auth perform identity checks inside `authorize` (documented). Lazy `await import("@arnilo/prism-supervisor")` inside the factory keeps plain `@arnilo/prism-ag-ui` imports working without the optional peer.
  - Composition: builds supervisor `createA2AHandler` options — card/parts/push/endpointPath/a2aLimits/redactor passthrough, `authorize` passthrough (returns `{ ownership }`-shaped A2A authorization), stub `exposure` (never used; tasks always present), and a built-in `A2ATaskLifecycle` (host `tasks` option overrides it).
  - Built-in tasks: `start` synthesizes a schema-validated `ParsedAgUiInput` (text parts → user message via `sanitizeMessageId`; non-text parts → `forwardedProps.a2a` JSON-stripped for `input.project`), runs `input.project`/`defaultAgUiInput` + `sessionFactory` + `session.stream` with AG-UI caps, maps events through `createAgUiEventMapper` (threadId=contextId, runId=taskId), and maps AG-UI text/activity/state to bounded A2A artifact updates (text parts truncated to `min(maxPartBytes, maxEventBytes-512)`, artifacts accumulated for the terminal task, `maxArtifacts` cap). Terminal mapping: `agent_finished`→COMPLETED, `agent_suspended`→INPUT_REQUIRED, `agent_denied`/`error`→FAILED(+error metadata), abort→CANCELED. Live stream event ids are "1".."N" with numeric `afterEventId` skip; bounded in-memory registry (512, FIFO eviction with abort) covers `GetTask`/`ListTasks`(contextId filter + `i:<n>` page token)/`CancelTask`(abort → CANCELED); single live consumer per task, further `SubscribeToTask` falls through to durable replay.
  - Durable replay: `durable: { source, resolveTask }` (same contract as supervisor `createA2AAgentEventSource`) — `subscribe` prepends the resolved task (`<id>:task` event id) then replays source records with cursor event ids; stops at a terminal record (pages may contain records appended after the terminal record; the mapper's terminal flag would otherwise swallow later records). `GetTask` on durable-only tasks returns the resolved task; `CancelTask` on durable-only tasks returns undefined (`-32001`). Note: the supervisor handler blocks `SubscribeToTask` for final-terminal tasks by design, so durable replay serves in-flight/resumed runs and non-terminal resolved states.
  - Tests: `src/__tests__/a2a-server.test.ts` 10/10 network-free over the real supervisor handler + client (stub fetch routes to the server): SendMessage terminal task with accumulated text artifacts; SendStreamingMessage via `returnImmediately: true` + `subscribeToTask` (working → artifact updates → COMPLETED with artifacts); ownership/threadId/runId reaching sessionFactory and `input.project`; non-text parts routed to `forwardedProps.a2a` (data part) and rejected without host `parts` policy; authorization refusal → 403; cancel aborts a gated stub session (CANCELED task, GetTask/ListTasks see it); durable replay with cursor event ids; cursor resume without re-emitting earlier events (manual iterator close on a live-in-progress source); host `tasks` override wins.
  - Bugs found during verification: synthesized AG-UI input needed explicit `state: {}` and `forwardedProps: {}` (schema requires the keys); A2A part objects carry `mediaType/filename/metadata: undefined` keys that fail the AG-UI bounded-JSON check (JSON round-trip in forwardedProps); mapper terminal flag swallows records after a terminal record in one page (durable subscribe stops at terminal records).
  - Docs: `docs/a2a.md` new `AG-UI server-side exposure (Task 13, 0.0.26)` section (usage + semantics); `docs/ag-ui.md` adapter cross-link; `docs/migration.md` 0.0.26 note 9; `docs/index.md` a2a entry; package README + CHANGELOG; phase9 docs tripwire asserts `createAgUiA2AServer` + `TASK_STATE_INPUT_REQUIRED` in `docs/a2a.md`; root CHANGELOG 0.0.26 entry.
  - Release graph: compat baseline regenerated (`arnilo__prism-ag-ui.txt` +12 lines, `createAgUiA2AServer` surface recorded); `release:gate` exit 0.
  - Verification: full `npm test` green (2,776 tests, 0 fail — +10 A2A server tests); docs 113/113; `git diff --check` clean.

- [x] Task 14 — Reference frontend renderer for AG-UI/A2UI surfaces (framework-free)
  - Acceptance Criteria:
    - Functional: a framework-free client renderer consumes an AG-UI event stream (SSE or in-memory `AsyncIterable`) and renders `a2ui-surface` activity snapshots/deltas (A2UI v0.9 `createSurface`/`updateComponents`/`updateDataModel`/`deleteSurface`) into DOM surfaces from a host component catalog; no framework dependency and no host build step.
    - Functional: renderer core is DOM-free (pure state machine: operations → surface/component model) so it is testable without a browser; a thin DOM binding layer renders the model; host supplies catalog component renderers (framework-free functions) with a built-in default text/container set.
    - Functional: all server-side caps are enforced client-side too (ops/message 64/512, op bytes 64 KiB/1 MiB, surfaces/run 16/64, depth 32/64); invalid or oversized ops drop closed with a bounded error event; unknown catalog components render an explicit placeholder, never raw HTML.
    - Functional: never executes remote HTML: `createElement`/text nodes only, no `innerHTML` for model content, no `eval`; MCP Apps-style CSP/sandbox guidance documented for hosts embedding it.
    - Code Quality: placement decided by package-budget check — default is a subpath export of `@arnilo/prism-ag-ui` (proposed `@arnilo/prism-ag-ui/renderer`) keeping the publishable graph at 48; a new package only if packed-size/audit evidence forces it. Network-free tests run the DOM-free core plus a minimal in-memory DOM stub for the binding layer; no jsdom dependency.
    - Performance: 1,000-op surface stream projects under a frozen p95 recorded in `scripts/budgets.json` and enforced by the budget gate.
  - Approach:
    - Documentation Reviewed:
      - `docs/ag-ui.md` A2UI painting middleware section; `docs/ag-ui-adoption.md` MCP Apps sandbox/CSP guidance.
      - `packages/ag-ui/src/a2ui.ts` (frozen ops/caps); A2UI v0.9 operation shapes (`@ag-ui/a2ui-middleware`).
    - Options Considered:
      - New browser package: 49th manifest against “no new package by default”; reject unless package-budget evidence forces it.
      - Subpath export in `@arnilo/prism-ag-ui`: chosen default — ag-ui already owns the A2UI surface contract; additive; the main entry stays runtime-agnostic because DOM code lives behind the subpath.
      - Example-only demo: not a shipped deliverable; reject.
    - Chosen Approach:
      - `packages/ag-ui/src/renderer/` behind the `@arnilo/prism-ag-ui/renderer` subpath: `createA2UiRenderer({ stream, catalog, limits })` → DOM-free core (`reduceA2UiOps` operation state machine) + `mountA2UiSurface` DOM binding + default catalog; validation reuses the frozen A2UI caps (shared module with `a2ui.ts`); emits `A2UI_VERSION`-compatible error events for host logging.
    - API Notes and Examples:
      ```ts
      import { createA2UiRenderer } from "@arnilo/prism-ag-ui/renderer";
      const renderer = createA2UiRenderer({ stream: agUiEventStream, catalog: myComponents });
      const surface = await renderer.surface("chat"); // DOM node
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/renderer/{core.ts,bind.ts,catalog.ts,index.ts}`, package `exports` subpath map, `src/index.ts` (type re-exports), `src/__tests__/renderer-core.test.ts`, `src/__tests__/renderer-bind.test.ts`, package README/CHANGELOG, `docs/ag-ui.md`, `docs/migration.md` (0.0.26 note), `docs/index.md`.
    - References:
      - `packages/ag-ui/src/a2ui.ts` + its tests; `docs/ag-ui-adoption.md`; A2UI v0.9 spec.
  - Test Cases to Write:
    - Core: full op sequence → model (create/update/delete surfaces, component updates, data-model patches); caps enforced (ops/bytes/surfaces/depth) with fail-closed drops; unknown component → placeholder; deltas merge correctly across snapshots.
    - Binding: minimal DOM stub — surfaces mount, updates apply, deletes detach; source-level assertion that no `innerHTML`/`eval` is used for model content; oversized/invalid streams never throw host-uncaught.
    - Budget: p95 of a 1,000-op surface stream recorded and gated in `scripts/budgets.json`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new subpath export.
    - Docs pages to create/edit: `docs/ag-ui.md` (renderer section), `docs/migration.md`, `docs/index.md`, package README/CHANGELOG.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 14):**
  - Shipped: `@arnilo/prism-ag-ui/renderer` subpath export (graph stays 48) — `createA2UiRenderer({ stream, catalog?, limits?, onAction?, onError?, dom? })` + DOM-free `reduceA2UiOps` core + `renderA2UiSurface` binding + `DEFAULT_A2UI_CATALOG` (Text/Container/Column/Row/Button), files `src/renderer/{core,bind,index}.ts`. The main entry stays runtime-agnostic: `src/index.ts` re-exports renderer types only (`export type`), DOM code lives behind the subpath; `document` is only touched via `typeof document !== "undefined"` inside the factory.
  - Placement: subpath export of `@arnilo/prism-ag-ui` per the plan (no new package); packaging test auto-verifies the new exports target ships as compiled output; install smoke test now imports `@arnilo/prism-ag-ui/renderer` from a packed install.
  - Core semantics: A2UI v0.9 ops → surface/component model (adjacency list, flat props, `id`/`component` keys, JSON-Pointer data model with `~0`/`~1` escapes, path default `/`, omit-value deletes). Snapshot batches replace a touched surface's model once (streaming mode sends cumulative ops — reset-once-per-surface, duplicate `createSurface` is a no-op); RFC 6902 `add /a2ui_operations/-` deltas append; `deleteSurface` is a safe no-op when absent. Batch fail-closed is atomic: ops/message, op bytes, depth, surface-id shape, and surface-cap checks plus a structural pre-pass (surface exists, component `id`/`type` shape, pointer shape) run before any mutation — an invalid batch changes nothing.
  - Caps: reused the frozen server constants/shared module from `a2ui.ts` (exported `validateA2UiOp` + `truncateA2UiText`): 64/512 ops per message, 64 KiB/1 MiB per op, 16/64 surfaces per run, depth 32/64, all clampable via `limits`; the renderer enforces them client-side on untrusted streams.
  - Binding: `renderA2UiSurface` walks from `id: "root"` with a visited set (circular refs → explicit placeholder) and a depth cap mirroring `HARD_MAX_A2UI_COMPONENT_DEPTH`; unknown catalog types and missing components render explicit `a2ui-placeholder` nodes; `{"path": "/pointer"}` bindings resolve against the per-surface data model; default Button emits `a2ui-action` envelopes via `onAction`. Never executes remote HTML: only `createElement`/`createTextNode`/`appendChild`/`setAttribute`/`addEventListener`; source-level test asserts no HTML-string-assignment/dynamic-evaluation tokens in the module. `Dom`/`DomNode` minimal interfaces make the binding testable with an in-memory stub (no jsdom).
  - Renderer: lazy consumption (first `surface()` starts the drain), `surface(id)` waits for the surface, mounts detach on `deleteSurface`, `dispose()` interrupts the iterator and clears mounts, stream errors report via `onError` (`ERR_PRISM_A2UI_STREAM`) and never throw host-uncaught.
  - Tests: `src/__tests__/renderer-core.test.ts` (13/13) and `src/__tests__/renderer-bind.test.ts` (10/10), network-free, no jsdom — full op sequences, snapshot replace vs delta append, upsert semantics, pointer set/delete and escapes, all caps fail-closed with nothing partial, atomic invalid-batch drops, duplicate createSurface, deleteSurface no-op, batch extraction, end-to-end stream mount/update/delete, oversized-stream drop-closed, throwing-stream recovery, source-level no-HTML assertion. Bugs found during verification: replace-mode reset ran per-op (wiped earlier ops in the same cumulative batch) → reset once per surface; pre-pass ordering (createSurface ops in the same batch must count as known surfaces); pointer set on an undefined root built a detached object → root initialization; deleteSurface left stale mounts → mount clears when the surface disappears.
  - Budget evidence: `rendererStreamOps` benchmark in `scripts/benchmark-0.0.26.mjs` — 1,000-op surface stream applied as 16 snapshot batches of 64 ops (the per-message cap) + full tree render through the default catalog; measured p95 2 ms, frozen ceiling 100 ms in `scripts/budgets.json` `phase9` (`fixture.rendererOps: 1000`, `p95CeilingsMs.rendererStreamOps: 100`), evidence regenerated; budget gate 8/8.
  - Docs: `docs/ag-ui.md` "Reference frontend renderer (Task 14, 0.0.26)" section (usage, semantics, security posture), `docs/migration.md` 0.0.26 note 10, `docs/index.md` ag-ui entry, package README + CHANGELOG, root CHANGELOG; phase9 docs tripwire asserts `createA2UiRenderer` + "never executes remote HTML" in `docs/ag-ui.md`.
  - Release graph: compat baseline regenerated (`arnilo__prism-ag-ui.txt` +33 lines covering the renderer subpath types); `release:gate` exit 0; packaging 239/239; docs 113/113; full `npm test` green (2,802 tests, 0 fail — +23 renderer tests); `git diff --check` clean.

- [x] Task 15 — Async `AgUiProjection` hooks (hosts may call `session.entries()` directly)
  - Acceptance Criteria:
    - Functional: `AgUiProjection` hooks may return a promise (each callback type becomes `T | Promise<T>`); the AG-UI and ACP mappers await hooks in event order (never `Promise.all`), with per-event failure fail-closed exactly like today’s sync throw handling.
    - Functional: `createMessagesFromSessionProjection` accepts an async transcript source (e.g. `async () => session.entries()` mapped through the existing message conversion) and emits `MESSAGES_SNAPSHOT` from it at `agent_started`/`message_finished`/`agent_finished`; no sync `getMessages` callback required for full session history.
    - Functional: sync-only hosts keep exact current behavior (sync hooks short-circuit without `await` overhead); `composeAgUiProjections` first-wins semantics unchanged; caps (`maxMessages` 128/1024, state/patch bytes, activity deltas) unchanged.
    - Code Quality: mapper pipeline stays single-threaded per event; async projection of one event never reorders later events; no new dependency; network-free tests cover mixed sync/async hooks, rejection, and ordering.
    - Performance: sync-path p95 unchanged (budget-gated); async path bounded by the slowest hook per event (documented).
  - Approach:
    - Documentation Reviewed:
      - `plans/008` further actions (async `AgUiProjection` hooks note); `src/agents.ts:1840` (`AgentSession.entries()` is async).
      - `packages/ag-ui/src/projection.ts` (`AgUiProjection`), `projectors.ts` (`createMessagesFromSessionProjection`), `ag-ui-mapper.ts` (`projectedText`/`projectedJson` call sites), ACP mapper (`packages/ag-ui/src/acp/`).
    - Options Considered:
      - Separate async-only hook set (`asyncMessages` etc.): splits the allow-list contract and forces hosts to implement both; reject.
      - Awaitable-returning hooks on the existing `AgUiProjection` shape: chosen — one contract, sync hosts unchanged, async hosts opt in.
    - Chosen Approach:
      - Change `AgUiProjection` callback return types to `Awaitable<T>` (type-level union; no runtime change for sync hosts); mapper `projectedText`/`projectedJson` become async and are awaited in call order; `createMessagesFromSessionProjection` gains `getMessages?: () => readonly AgUiMessage[] | Promise<readonly AgUiMessage[]>` and awaits it; ACP mapper updated to share the async projection path; docs + tripwire.
    - API Notes and Examples:
      ```ts
      const projection = createMessagesFromSessionProjection({
        getMessages: async () => (await session.entries()).map(entryToAgUiMessage),
      });
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/projection.ts`, `projectors.ts`, `ag-ui-mapper.ts`, `src/acp/` mapper, `src/index.ts` (types), `src/__tests__/projection-async.test.ts`, package README/CHANGELOG, `docs/ag-ui.md`, `docs/migration.md` (0.0.26 note).
    - References:
      - `plans/008` Task 3 projectors; `src/agents.ts:1840` `entries()`; `docs/ag-ui.md` projectors section.
  - Test Cases to Write:
    - Async `getMessages` from an `entries()`-shaped async source emits snapshot at `agent_started`/`agent_finished`; rejection → event omitted (fail-closed) and the stream continues; mixed sync/async hooks in one `composeAgUiProjections` resolve in order; async hook rejection does not reorder later events; caps still enforced on awaited values.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; hook return types widened to `Awaitable<T>` (source-compatible for sync hosts).
    - Docs pages to create/edit: `docs/ag-ui.md` (async projection hooks), `docs/migration.md` (0.0.26 note 11), package README/CHANGELOG, root CHANGELOG, `docs/performance.md` (sync-path benchmark evidence).
    - `docs/index.md` update: no (ag-ui entry already exists).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  **Completion record (Task 15):**
  - Shipped: `Awaitable<T>` type (`T | Promise<T>`, exported from `@arnilo/prism-ag-ui` root) — every `AgUiProjection` hook return widened (`toolArguments`, `toolResult`, `state`, `stateSnapshot`, `stateDelta`, `messages`, `activity`, `reasoning`, `raw`, `custom`, `interrupt`, `coWork`, `path`); `projectCoWorkEvent` is now async (awaits the `coWork` hook).
  - Mapper pipeline: `AgUiEventMapper.map`/`mapCoWork` and `AcpEventMapper.map`/`mapCoWork` are now async; `projectedText`/`projectedJson` (AG-UI) and `projected` (ACP) await their callbacks; hooks are awaited strictly in event order (never `Promise.all`); per-event fail-closed identical to sync throw handling (try/catch → omitted value, stream continues). All callers updated: AG-UI handler live/replay/co-work paths, A2A server, ACP agent, interrupt projection.
  - Projectors: `createMessagesFromSessionProjection` `getMessages` accepts `() => readonly AgUiMessage[] | Promise<...>` — an `entries()`-shaped async source emits `MESSAGES_SNAPSHOT` at `agent_started`/`message_finished`; unchanged-transcript dedupe preserved; `composeAgUiProjections` first-wins unchanged (sync and async fragments mix). `agent_finished` is terminal in the mapper (extras skipped by design — unchanged sync behavior), so the final full-history snapshot arrives at the last `message_finished`; the plan's "agent_finished" emission point is satisfied by that refresh and documented.
  - Sync hosts: exact prior behavior — sync return values short-circuit through the same awaited pipeline (one microtask per event), no behavior change; verified by the untouched regression suites (ag-ui 107/107, phase8 conformance, full project run).
  - Tests: new `src/__tests__/projection-async.test.ts` (8/8, network-free): async `getMessages` snapshot at `agent_started` + refresh at `message_finished`; rejection drops closed and stream continues; mixed sync/async composed hooks resolve first-wins; slow async hook does not reorder later events (in-order awaits); async rejection fail-closed per event with sibling hooks still projected; caps enforced on awaited values (oversized async messages drop); ACP mapper awaits async tool hooks with redaction parity; sync-only hooks through the async pipeline.
  - Budget evidence: `agUiMapperSync` benchmark in `scripts/benchmark-0.0.26.mjs` — 4,000 events (text delta / tool start / tool finish / message finish) through the async mapper with sync hooks only; measured p95 30.924 ms, frozen ceiling 100 ms (`fixture.mapperEvents: 4000`, `p95CeilingsMs.agUiMapperSync: 100`); evidence regenerated; budget gate 8/8. Sync-path p95 unchanged claim documented in `docs/performance.md`.
  - Docs: `docs/ag-ui.md` async-hooks section (usage example with `session.entries()`, ordering/fail-closed contract, terminal-event note), `docs/migration.md` note 11, package README + CHANGELOG, root CHANGELOG; phase9 docs tripwire asserts `Awaitable<T>` + `session.entries()` in `docs/ag-ui.md`.
  - Release graph: compat baseline regenerated (`arnilo__prism-ag-ui.txt` +41/−7 covering async mapper/projection types); `release:gate` exit 0; docs 113/113; full `npm test` green (2,810 tests, 0 fail — +8 async projection tests); `git diff --check` clean.

## Exit Gate

- Primitive review accepted; network-free and protected GitHub/LSP/sandbox/proxy suites pass; large-repository/process/network benchmarks meet frozen budgets; FR-3/FR-4/FR-5/FR-6/FR-7 suites pass (encrypted-value helper, MCP Apps effect retry, NATS event source, session-store-postgres root export, placement answer); Tasks 13–15 suites pass (A2A server adapter against a fake A2A client, DOM-free renderer core + stub-DOM binding, async projection ordering/rejection); `npm run sdk:ready`, docs links, declarations, package budget, audit, compat baseline, and full release gate pass for 0.0.26.

## Compromises Made

- **NATS tests are network-free over a fake of the narrow `NatsJetStream` seam, not a real server.** The official client surface is exercised only through the thin `createNatsJetStream` adapter; a live integration suite (real NATS server with JetStream) remains a protected host gate mirroring the Postgres `PRISM_TEST_POSTGRES_URL` pattern. Rationale: JetStream protocol faking in-process is a large lift; the seam is 1:1 with the official API.
- **NATS `append` idempotency is bounded by the stream's dedupe window** (JetStream `Nats-Msg-Id`), unlike Postgres's permanent unique constraint. Duplicate appends verify stored content and fail closed on collision; outside the window a re-append stores a second copy (consumers dedupe by `record.id`).
- **NATS `cleanup` is O(limit) delete-message calls** (enumerate tenant prefix, delete old messages) because JetStream purge cannot filter by timestamp; bounded by the cleanup limit like the Postgres batch delete.
- **NATS `subscribe` resumes via cursors, not durable-name reuse**: each subscription gets a unique durable consumer (concurrent subscribers each see all events, matching Postgres); process-death recovery uses the host-persisted cursor, consistent with the `AgentEventSource` contract.
- **Stream provisioning stays host-owned** (subjects `prism.agent-events.>`, retention limits, dedupe window) — the adapter never creates or mutates the stream, mirroring the Postgres schema requirement.
- **`reconnectInitialMs`/`reconnectMaxMs` are accepted but unused** in the NATS adapter: the official client owns reconnection; the fetch loop retries transparently.
- **Task 13 (A2A server-side exposure):** the adapter is non-generic — `A2AAuthorization` (ownership/identity/metadata) is the shared authorization for every AG-UI surface; hosts with richer AG-UI authorization perform identity checks inside `authorize`. Each live task has a single in-memory stream consumer; concurrent `SubscribeToTask` falls through to durable replay (unavailable without `durable`). The supervisor handler rejects `SubscribeToTask` for final-terminal tasks (A2A spec), so durable replay serves in-flight/non-terminal resolved states and `GetTask` covers finished runs. The live task registry is in-memory only (cap 512, FIFO eviction) — no persistence across restarts. A2A parts keep `raw`/`data`/`url` disabled unless the host `parts` policy selects them, and even then they only reach `input.project` via `forwardedProps.a2a`.
- Tasks 14–15 compromises (renderer placement/budget evidence, async-hook ordering bounds) to be filled after those tasks complete and their tests pass.

## Further Actions

- **Live NATS integration suite** (real server, JetStream enabled) as a protected gate, mirroring `test:postgres`; add `PRISM_TEST_NATS_URL` gating and a `test:nats` script.
- **FR-3/FR-4/FR-5/FR-6/FR-7 are shipped in 0.0.26** (Tasks 9–12). Tasks 13–15 add the remaining Phase 8 deferred AG-UI interop items to the 0.0.26 scope (A2A server-side exposure, frontend renderer, async `AgUiProjection` hooks); after they complete, the only remaining Phase 8 deferred item is WebSocket/binary AG-UI transport (still not requested).
- **Phase 10 (0.0.27)** maps Phase 8/9 capabilities through ACP; the NATS event source and MCP Apps effect recovery are candidates for ACP lifecycle/event exposure only where a current host/protocol consumer exists.
- **Operator handoff** (per Phase 8 convention): signed `v0.0.26` tag + `sdk:ready` + publish dry-run from a clean single-flight checkout remain operator-gated; the release graph is now 48 manifests.
