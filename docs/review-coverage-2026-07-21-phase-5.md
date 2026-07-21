# Review coverage — 2026-07-21 Phase 5

Working evidence for Plan 073 Task 0. Freezes Phase 5 / Release **0.0.10** scope, workspace-mode contract, primitive ownership, reused finite limits, threats, tests, docs, and release gates before implementation.

**Evidence frozen:** 2026-07-21. **Prism source:** `5fc05437224f347b00fb6124d1783eb2cd3a9b25` (Task 0 freeze). **Release target:** 0.0.10 (Task 7 retargeted graph from post-ship `0.0.96` → exact `0.0.10`). **Default test rule:** network-free fakes/fixtures; real Docker remains `PRISM_TEST_DOCKER_SANDBOX=1` protected gate.

## Status legend

| Status | Meaning |
| --- | --- |
| `existing` | Current public contract covers the requirement. |
| `extend` | Owning task extends an existing optional package/contract. |
| `compose` | Existing public primitives suffice; package-local glue / docs / examples only. |
| `out-of-scope` | Coding-harness P1/P2 or later release; must not land in 0.0.10 tasks. |

## Frozen product decision

0.0.10 closes **coding-harness P0 correctness** only: one explicit workspace mode so disposable sandbox shell and filesystem tools share one tree, fail-closed mixed wiring, tree-identity metadata on import/export/resume, docs that forbid treating host mode as containment.

**Not in 0.0.10** (owned by later phases — do not implement here):

| Deferred item | Owner phase |
| --- | --- |
| Session search/index | 0.0.11 Phase 6 |
| Token/context budgeting + omission reporting | 0.0.11 Phase 6 |
| Native Anthropic provider | 0.0.11 Phase 6 |
| Native Google provider | 0.0.11 Phase 6 |
| Goal→verify coding loop helper/example | 0.0.11 Phase 6 |
| Additional subscription OAuth adapters | 0.0.12 Phase 7 |
| AG-UI/ACP-facing event adapter | 0.0.12 Phase 7 |
| Coding-aware compaction preset | 0.0.12 Phase 7 |
| Enterprise identity / work connectors | 0.0.13+ |
| New sandbox runtime, K8s/remote scheduler, automatic image pull, writable bind-mount as a third named mode | never in 0.0.10 |

## Frozen external revisions

| Surface | Frozen reference | Compatibility decision |
| --- | --- | --- |
| Prism | [`5fc05437224f347b00fb6124d1783eb2cd3a9b25`](../plans/073-release-0-0-10-coding-harness-unified-workspace.md) | Caller/limit claims below checked against post-0.0.9 tree. |
| Node.js | Local reference `v24.18.0`; release support remains Node 20 and current | FS/exec backends use `node:child_process` argument arrays, streams, `AbortSignal`, path, crypto hashes only. |
| Docker CLI/Engine | Local reference client/server `29.6.1`; same Phase 4 docs | Reuse `createDockerSandbox` flags/limits; no new daemon features required for FS backends. |
| Git | Local reference `git version 2.55.0` | Reuse `createGitTools` + `execFile` binder; same cwd/tree as sandbox mode. |

## Frozen workspace-mode contract

| Decision | Frozen choice |
| --- | --- |
| Modes in 0.0.10 | Exactly `"host" \| "sandbox"`. No `"shared_mount"` / future aliases until a later release updates this page. |
| `workspaceMode` default | **Required.** Missing/undefined throws at construction. No soft-default to host (would preserve the footgun for Docker users). |
| Escape hatch | `allowMixedWorkspaceWiring: true` (name frozen). Without it, sandbox shell + host-mutating FS/list/search backends throw. With it, composition records explicit warnings; containment claim is false. |
| Sandbox auto-wire prerequisite | Auto FS/repo backends (Task 2) require `DisposableSandbox` (`execFile`). Bare `SandboxAdapter` (exec-only) may be used in sandbox mode **only** when the host supplies agreeing custom `read`/`write`/`edit`/`repository.operations`. |
| Host mode shell | May still use `options.sandbox` for shell only when FS backends are local host ops — that is **mixed wiring** and needs the escape hatch, **or** host mode with **no** sandbox (local shell + local FS). Preferred host mode: no sandbox adapter. |
| Same-tree bind-mount | Host responsibility under escape hatch; Prism does **not** claim disposable containment for that wiring in 0.0.10. |
| Construction API | Package-local `createSandboxCodingComposition(cwd, options) → { tools, composition }` is the authoritative path. `createSandboxCodingTools` / `createSandboxReadOnlyTools` remain thin wrappers returning `tools` only (compat). |
| Composition metadata | `ToolDefinition` has **no** metadata field. Warnings/mode/containment live on `SandboxCodingComposition` (`workspaceMode`, `containmentClaim: boolean`, `mixedWiringAllowed: boolean`, `warnings: readonly string[]`, `workspaceRoot`, optional `treeIdentity`). Do not add core `ToolDefinition.metadata`. |
| Containment claim | `containmentClaim === true` only when `workspaceMode === "sandbox"`, mixed wiring is denied, and FS/repo backends target the disposable tree. Host mode and escape-hatch mixed wiring always `false`. |

## Capability traceability matrix

| Phase 5 roadmap criterion | Current 0.0.9 surface | Minimum 0.0.10 gap | Status / owner | Required proof | Docs | Release gate |
| --- | --- | --- | --- | --- | --- | --- |
| Explicit workspace mode; default sandboxed composition no longer silently pairs container shell with host FS mutations | `createSandboxCodingTools` wires shell via `createSandboxBashOperations`; read/write/edit/list/search keep host `cwd` (documented split) | Required `workspaceMode`; sandbox mode auto-wires FS/repo or fails closed | `extend` / Task 1 (+ Task 2 backends) | construction matrix: missing mode throws; sandbox without capable backends throws | `coding-security.md`, `migration.md` | offline coding-security tests |
| Sandbox mode: shell + read/write/edit/repo_list/repo_search share one tree | Pluggable `*Operations` exist; no sandbox FS/repo defaults | Exec-backed (or host-supplied) FS + repository ops rooted at sandbox workspace | `extend` / Task 2 | write↔shell byte agreement; list/search agree with shell on same tree | `coding-security.md`, `coding-agent-tools.md` | fake sandbox + opt-in Docker |
| Host mode: all tools on host workspace; no containment claim | `createCodingTools` local defaults; sandbox helper still claims “sandbox” by name while FS is host | Host mode local ops + `containmentClaim: false` | `extend` / Task 1 | host mutations land on host cwd; composition metadata non-isolating | `coding-security.md`, `host-security.md` | offline tests |
| Import/export/close/resume preserve tree identity | `SandboxExportMetadata` `{ sha256, entryCount, byteCount, format }`; export two-pass; import tar summarize; no import hash retained on session; composition cannot refuse unbound FS | Retain/import identity on disposable session/status; composition refuses containment claim when backends unbound | `extend` / Task 4 | import→mutate→export hash change; export continuity; unbound backends fail closed | `coding-security.md`, `host-security.md` | fake CLI + protected Docker |
| Reject unsafe mixed wiring unless escape hatch + surfaced metadata | Split composition is the silent default; no guard | Fail-closed check + `allowMixedWorkspaceWiring` + `composition.warnings` | `extend` / Task 1 | throw without hatch; warn with hatch | `coding-security.md`, `migration.md` | offline tests |
| Performance: no unbounded host↔container sync; reuse entry/byte/time caps; host vs sandbox benchmarks | Existing sandbox/repo/coding hard caps; `scripts/benchmark-0.0.9.mjs` | Reuse caps for FS backends; forbid sync loops; `benchmark-0.0.10` both modes | `extend` / Task 5 | schema/bounds + consistency under caps; concurrent exec still enforced | `performance.md` | benchmark schema test + offline suite |
| One construction path; pluggable backends; no second coding runtime | Aggregators + `*Operations` seams | Composition helper only; no new agent/runtime | `compose` / Tasks 1–3 | package stays optional; core dependency-free | `coding-security.md` | pack/install |
| Git/check runners same tree/cwd in sandbox mode | `createGitTools({ execFile: sandbox.execFile })` documented; not auto-bundled | Documented/binder wiring + consistency test | `compose` / Task 3 | write then git status/diff sees file in sandbox | `coding-agent-tools.md`, `coding-security.md` | offline + fake execFile |
| Security: path containment, policy, digest-pinned non-root Docker remain mandatory for advertised sandbox mode; forbid host-as-contained | Phase 4 Docker reference + approval policy | Docs + `containmentClaim` enforcement; host mode language | `extend` / Tasks 1, 6 | escape/path tests; docs assert host ≠ contained | `host-security.md`, `coding-security.md` | offline + protected Docker |
| Docs/migration: 0.0.9 split superseded | Docs describe split as current | Replace guidance; migration note | `extend` / Task 6 | docs.test / migration assertions | `migration.md`, index summaries | docs tests |
| Version/release 0.0.10 evidence | 32-package `0.0.9` (working tree may show `0.0.10`) | Bump graph, changelogs, `sdk:ready`, release dry-run | `extend` / Task 7 | full release gate | `release-and-install.md` | `sdk:ready` + dry-run |

## Primitive and caller inventory

Frozen at `5fc05437224f347b00fb6124d1783eb2cd3a9b25` (+ this evidence page).

| Primitive / symbol | Existing contract / callers | Phase 5 disposition |
| --- | --- | --- |
| `createSandboxCodingTools` / `createSandboxReadOnlyTools` | Defined `packages/coding-security/src/sandbox-coding-operations.ts`; exported from package index; **callers:** package tests only (no examples/src production caller yet) | Extend with required `workspaceMode`, mixed-wiring guard, sandbox auto-wire; wrappers over composition helper |
| `createSandboxBashOperations` | `sandbox.ts`; used by composition, approval tests, sandbox-coding tests | Reuse for shell wiring; unchanged contract |
| `SandboxAdapter` / `DisposableSandbox` / `createDockerSandbox` | `sandbox.ts`, `docker-sandbox.ts`; Docker tests | Reuse. Sandbox-mode auto FS requires `DisposableSandbox.execFile`. No new core sandbox type |
| `SandboxExportMetadata` | `{ sha256, entryCount, byteCount, format: "tar" }` on close export | Reuse shape for tree identity; Task 4 may expose import/last-export on status/composition |
| `ReadOperations` / `WriteOperations` / `EditOperations` | `packages/coding-agent/src/{read,write,edit}.ts`; local defaults; custom ops optional | Reuse contracts. Task 2 implements sandbox-backed adapters in **coding-security** only |
| `RepositoryOperations` / `createLocalRepositoryOperations` | `repository.ts`; list/search tools | Reuse. Task 2 adds sandbox-backed repo ops in coding-security |
| `BashOperations` / `createLocalBashOperations` | `shell.ts` | Reuse |
| `createGitTools` / `resolveGitRunner` / `execFile` option | `git-tools.ts`, `git-exec.ts`; coding-agent git tests | Reuse. Task 3 documents/binds same workspace root; optional thin coding-security binder only if ≥2 non-test call sites |
| `ExecutionPolicy` / path containment / approval | coding-security + coding-agent | Reuse; mandatory for advertised sandbox mode |
| `ToolDefinition` | Core `src/contracts.ts` — name/description/parameters/exclusive/execute only | **No** new metadata field. Composition descriptor stays package-local |
| Core agent/session/workflow runtimes | Unchanged | **No** second coding runtime; no core primitive promotion |

### Primitive decision

**No new core primitive authorized.**

Authorized package-local work (`@arnilo/prism-coding-security` unless noted):

1. `workspaceMode` + `allowMixedWorkspaceWiring` + `SandboxCodingComposition` + `createSandboxCodingComposition`.
2. `createSandboxFilesystemOperations` / `createSandboxRepositoryOperations` (names may shorten in impl; stay package-local).
3. Optional `bindSandboxGitOptions` only if examples + package tests both need identical wiring (else docs-only).
4. Minimal `DisposableSandbox` status/identity fields for import/export continuity (Task 4) — still coding-security local.

Promote to core only with ≥2 non-test consumers outside coding-security **and** migration/conformance evidence. One-consumer interfaces, sync daemons, Merkle indexes, and third workspace modes are rejected for 0.0.10.

## Frozen capability boundary

| Surface | Supported in 0.0.10 | Explicitly unsupported |
| --- | --- | --- |
| Workspace modes | `host`, `sandbox`; required option; fail-closed mixed wiring; escape hatch with warnings | Soft-default mode; silent split-brain; named `shared_mount` mode; claiming containment for host/escape-hatch |
| Sandbox FS | ExecFile-backed read/write/edit/list/search against disposable tree; host-supplied custom ops | Unbounded bidirectional sync loops; new transport protocol; automatic host write-back |
| Docker reference | Existing digest-pinned, non-root, network-none, finite tmpfs, import/export | Image pull/build, daemon provisioning, K8s, Docker socket exposure |
| Git/checks | Same-tree via `execFile` + cwd; optional binder | Auto-include Git in default coding tool set; push/PR/network |
| Artifacts / identity | Existing export metadata + retained import/export hashes for resume checks | Full workspace in checkpoints; secret-bearing identity blobs |

## Frozen finite limits and charging points

**Rule:** Reuse Phase 4 / shipped coding-security and coding-agent defaults and hard caps. Task 2–5 **must not** raise hard caps or add unbounded sync. Charge before each sandbox FS/repo/exec operation against the same counters.

### Sandbox and workspace (reuse `sandbox-limits.ts`)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | --- | --- | --- |
| Startup / wall / idle | 30 s / 120 s; 20 min / 30 min; 5 min / 15 min | Existing create/exec | Task 4/Docker session |
| CPU / memory / PIDs / FDs | 2 / 8; 2 GiB / 16 GiB; 256 / 1,024; 1,024 / 8,192 | Before `docker run` | existing |
| Workspace / tmp / download tmpfs | 1 GiB / 8 GiB; 256 MiB / 2 GiB; 64 MiB / 512 MiB | Before create / write overflow | existing |
| Commands / concurrent execs | 100 / 256; 1 / 8 | Before each exec **including FS-backend execFile** | Task 2 must share queue |
| Command/FS output | 64 MiB / 1 GiB | Stream before retain | Task 2 + output accumulator |
| Import/export entries/bytes / retained artifacts | 50,000 / 250,000; 256 MiB / 2 GiB; 16 / 64 | Before retain; two-pass hash verify | Task 4 |
| Stop grace / cleanup | 5 s / 30 s; 30 s / 120 s cleanup | Terminal paths | existing |

**Forbidden:** background host↔container watchers, periodic full-tree sync, unbounded `docker cp` retry loops, retaining more than `maxExport*` without export API.

### Repository / read / write / edit (reuse `packages/coding-agent/src/limits.ts`)

| Resource | Default / hard cap | Owner for sandbox backends |
| --- | --- | --- |
| Repo depth / entries / files / results / concurrency | 32 / 128; 10k / 100k; 10k / 100k; 1k / 10k; 8 / 32 | Task 2 |
| Search scan/file/matches/pattern/line/context/time | 64 MiB / 1 GiB; 8 MiB / 64 MiB; 1k / 10k; 512 / 4,096 B; 50 KiB / 1 MiB; 5 / 20; 30 s / 300 s | Task 2 |
| Read text/image; write; edit file/input/edits | existing coding-agent ceilings | Task 2 |
| Git paths/refs/message/output | existing git ceilings | Task 3 |

## Threat and authority matrix

| Boundary | Trusted authority | Untrusted input | Mandatory control | Default / unsupported |
| --- | --- | --- | --- | --- |
| Workspace mode selection | Host sets `workspaceMode` explicitly | Model/tool args cannot change mode | Construction throws if missing; mixed wiring throws without hatch | Silent split-brain unsupported |
| Sandbox containment claim | Host + composition when backends agree on disposable tree | Model claims, host cwd edits under sandbox advertising | `containmentClaim` only when mode=sandbox and backends bound; path containment + Docker policy | Host mode / escape hatch never claim containment |
| Sandbox FS backends | Host-supplied `DisposableSandbox` or custom ops | Paths, symlink targets, archive/exec output | Workspace-root realpath/containment; byte/entry/time caps; share concurrent exec limits | Escape outside `/workspace` denied |
| Mixed wiring escape hatch | Host sets `allowMixedWorkspaceWiring` | Accidental omitted ops | Explicit option + `composition.warnings` | Undocumented mixed wiring unsupported |
| Import/export identity | Host artifact callback + hash verify | Tar headers/content | Existing type checks + two-pass hash; resume compares hashes | Advertise sandboxed coding on unbound host root unsupported |
| Docker/image/secrets | Host digest/CLI/allow-list | Model env/commands | Phase 4 Docker controls unchanged | Pull/build/socket unsupported |
| Git in sandbox | Host `commitIdentity` + `execFile` | Refs/pathspecs/hooks | Existing safe git config; same workspace root | Push/PR/credentials unsupported |

## Validation matrix for Task 0

| Check | Frozen assertion |
| --- | --- |
| Traceability | Every Phase 5 roadmap criterion maps to exactly one primary owner among Tasks 1–7; 0.0.11+ items listed only under out-of-scope. |
| Primitive reuse | No new core primitive. FS/repo helpers stay coding-security-local unless a second non-test consumer appears. |
| Finite resources | Sandbox FS/repo paths reuse existing defaults/hard caps; concurrent exec shared; no sync loops. |
| Security claims | Containment is Docker/host policy + bound backends, not regex; host mode and escape hatch are non-containing by contract. |
| Mode API | `workspaceMode` required; modes `{host,sandbox}` only; escape hatch name `allowMixedWorkspaceWiring`; metadata on `SandboxCodingComposition`, not `ToolDefinition`. |

## Documentation and release ownership

- Task 0 (this page): scope freeze, index link, docs.test evidence assertions.
- Tasks 1–4: implementation; API docs deferred to Task 6 except in-code JSDoc.
- Task 5: adversarial tests, `scripts/benchmark-0.0.10.mjs`, protected Docker extensions.
- Task 6: `docs/coding-security.md`, `docs/coding-agent-tools.md`, `docs/migration.md`, `docs/host-security.md`, `docs/performance.md`, package READMEs/changelogs, index summary tweaks.
- Task 7: version `0.0.10`, `sdk:ready`, pack/install/supply-chain, release dry-run — **done** (1,963 tests / 1,934 pass / 29 skip; 32/32 dry-run; no tag/publish).

No public implementation API changes in Task 0. This page, `roadmap.md` Phase 5, and Plan 073 are the authoritative pre-implementation boundary; later tasks may tighten defaults but cannot raise hard caps, add sync loops, introduce a third mode, or claim host-mode containment without updating tests, docs, and this evidence.
