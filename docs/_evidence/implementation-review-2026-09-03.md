# Prism implementation review — 2026-09-03

## Executive verdict

Prism has strong security intent, broad conformance coverage, explicit host boundaries, and unusually disciplined limits/redaction. Main problem is scope: **143,437 production TypeScript lines across 781 files**, roughly **6,000 export statements**, 10 publishable packages, 19 provider adapters, and years of phase/freeze machinery still active in current gates. It is capable, but harder to audit and evolve than necessary.

Recommended order:

1. Close production CodeQL true positives.
2. Finish removal of delegated CLI adapter and publish a breaking/removal note.
3. Delete historical freeze machinery from current gates; keep only current invariants.
4. Reduce public surface using usage/compat evidence.
5. Add missing provider-neutral generation modalities only after core surface shrinks.

**Release posture:** suitable for controlled personal/coding use with host policy; not ready for broad enterprise claims until production CodeQL findings close and protected PostgreSQL/NATS/sandbox suites become required CI evidence.

## Work completed during review

- Deleted `@arnilo/prism-antigravity-agent`: source, tests, workspace, lockfile entry, dedicated docs/evidence/probe/freeze plan, packaging/install rows, and host-conformance branch.
- Current package graph: **10 publishable manifests** (root + 9 workspaces).
- Kept only historical migration/changelog references identifying package as removed; no runtime/import/install surface remains.
- Updated dependencies:
  - Graft `0.13.0` → `0.16.0`
  - AG-UI `0.0.57` → `0.0.59`
  - AI SDK provider `4.0.4` → `4.0.10`
  - Office Open `0.12.3` → `0.13.1`
  - `fast-xml-parser` `4.5.0` → `5.11.1`
  - Biome `2.5.5` → `2.5.11`
  - transitive `fast-uri` / `qs` via `npm audit fix`
- `npm audit`: **0 vulnerabilities** after update.
- Fixed `scripts/package-truth.mjs` writing `scripts/package-truth.json` merely when imported.
- Removed two production unused variables/duplicate expressions.
- Replaced Dev inspector internal-error reflection with fixed external messages, addressing local CodeQL stack/error exposure paths.

## 1. Capability placement: SDK versus host

### Keep in Prism core

These are reusable AI-runtime contracts rather than app behavior:

- `AIProvider`, model/capability metadata, normalized streaming events, usage, cancellation, retry classification.
- Agent/session loop, tool schema/dispatch, guardrail seams, context/prompt assembly, structured output.
- Generic stores: sessions, checkpoints, leases, events, effects, feedback.
- Generic identity/ownership, policy hooks, redaction, telemetry, evaluation contracts.
- Conformance helpers for providers, stores, tools, effects, and extensions.

### Host-owned; Prism should expose contracts/adapters only

| Capability | Current location | Recommendation |
|---|---|---|
| Shell, process, Git, repository I/O, LSP, worktrees | `packages/prism-coding-tools/src/agent` | Keep optional. Host supplies commands, cwd, credentials, process backend, approvals. Never activate from core config discovery. |
| Docker/native sandbox, egress proxy | `packages/prism-coding-tools/src/security` | Reference adapters only. Host owns container runtime, kernel features, network policy, and attestation. |
| Linux desktop input/control | `packages/prism-coding-tools/src/computer-use-linux` | Host plugin; deny by default. |
| Dev inspector | `packages/prism-coding-tools/src/dev` | Development-only export. Keep out of production umbrella/import paths. |
| Caveman/Ponytail/Impeccable behavior packs | `packages/prism-coding-tools/src/{caveman,ponytail,impeccable}` | Host-installed skills/config, not AI runtime capabilities. Consider removing from Prism package if independent upstream packages remain authoritative. |
| Keychain, OAuth establishment, env/files | `packages/prism-core/src/credentials` | Host adapter. Core should retain credential/redaction interfaces only. |
| SQLite/PostgreSQL/NATS and enterprise PostgreSQL | `packages/prism-core/src/{sessions,enterprise}` | Optional persistence adapters. Host owns connection lifecycle, migration approval, TLS, backups, HA. |
| Microsoft 365 / Google Workspace commands | `packages/prism-core/src/integrations` | Host/business plugin. Do not imply universal AI capability. |
| Browser/Obscura processes | `packages/web-tools/src/{browser,obscura}` | Host plugin. Host owns binary/browser context, egress, downloads, credentials. |
| Office document parsing/rendering | `packages/office` | Optional domain package; not base SDK. |
| MCP, ACP, AG-UI, A2A | protocol packages/subpaths | Optional interop adapters over core contracts. |
| RAG, Graft, Wiki, compaction workers | `packages/memory` | Optional memory/context package. Host owns corpus, embedder, index, retention, consent. |

Do **not** create more packages immediately. Current family/subpath consolidation is sufficient. Enforce inert imports and document ownership. Split only when bundle/runtime evidence shows subpaths are insufficient.

## 2. Code quality, dead code, duplication, complexity

### Strengths

- Core root remains low-dependency and uses Web-standard requests/responses in major boundaries.
- Extensive input limits, redaction, ownership, egress, and fail-closed checks.
- Provider family already centralizes shared serializers instead of copying them.
- Biome lint currently reports zero findings.
- Test code is substantial: 105,877 TypeScript test lines across 429 files before delegated-adapter deletion.

### Highest-value simplifications

1. **Delete historical freeze tests from current `npm test`.** `scripts/phase13-*` through `phase30-*` repeatedly calculate package counts and exception lists. They caused most removal churn. Preserve immutable evidence under docs/git history; replace executable historical branches with three current tests:
   - workspace/lock/package-truth consistency,
   - current export/pack/install consistency,
   - release/security gates.
2. **Reduce public API.** `scripts/unused-report.json` lists **87 dead-export candidates**. It is a naive scan, so verify package downloads/import telemetry and compatibility baselines, then deprecate/remove confirmed unused exports in one breaking cut.
3. **Break large state machines by responsibility, not abstractions:**
   - `packages/prism-coding-tools/src/agent/process/sessions.ts` — 1,333 lines; one 1,200-line closure.
   - `packages/prism-core/src/runtime/workflows/saga.ts` — 1,198 lines.
   - `packages/web-tools/src/browser/manager.ts` — 1,130 lines; `performAction` spans ~329 lines.
   - `src/agent-session/session.ts` — 1,847 lines; `runInternal` spans ~841 lines.
   Extract existing cohesive phases (persistence/recovery, action dispatch, forward/compensation, provider/tool rounds). Do not introduce interfaces with one implementation.
4. **Stop generated-artifact import side effects.** Fixed for `package-truth.mjs`; apply same CLI-main guard rule to every importable script.
5. **Remove stale compatibility prose.** Active docs still mix 0.3-era package names and current 0.4 families. Generate current package tables from `package-truth.json`; keep history only in changelog/migration pages.

### Duplication assessment

- Highest duplication is process, not runtime logic: package-count branches, legacy exceptions, release snapshots, and repeated docs assertions.
- SQLite/PostgreSQL persistence files are similarly sized (~1,035/1,050 lines) but dialect/transaction behavior differs. Share only pure codecs/validation already proven identical; do not force a generic database abstraction.
- Provider request shapes legitimately differ. Continue sharing bounded transport and protocol serializers; avoid a universal provider mapper.

## 3. Bugs and defects

### Open security defects

See [`codeql-current-2026-09-03.md`](./codeql-current-2026-09-03.md). Highest priority:

- Prototype-polluting document patch assignment.
- Polynomial decimal/currency regexes.
- Browser-upload and coding-effect filesystem TOCTOU.
- Executable-script insecure temporary files/races.
- DR clear-text logging.

### Correctness/maintenance defects found

- **Import side effect:** importing `scripts/package-truth.mjs` rewrote tracked JSON. Fixed with direct-execution guard.
- **Stale truth duplicated in prose/tests:** package removal initially broke hard-coded 11-package/54-retired assertions across docs and tests. Current truth should be generated, not copied.
- **Dev error leakage:** internal errors were reflected in 500 responses. Fixed with constant messages.
- **Two dead production bindings:** duplicate `skills` path computation and unused Dev inspector port binding. Removed.
- **Dependency/test matrix drift:** AI SDK peer was updated before packed-smoke fixture/version matrix, causing `ERESOLVE`. Fixed by updating matrix and fixture together. This coupling should be one generated version constant.

## 4. Hardening backlog

### P0 before enterprise release

- Reject prototype-special keys at every dynamic assignment boundary.
- Replace or tightly bound attacker-controlled regex parsing.
- Convert security-sensitive check-then-use filesystem flows to handle/descriptor operations.
- Push current branch and require CodeQL re-analysis; dismiss only documented false positives.
- Require PostgreSQL/NATS protected integration jobs on protected branches.
- Require sandbox/browser threat suite on a supported Linux runner.

### P1

- Treat every subprocess environment as an allow-list; retain absolute command and cwd containment.
- Require explicit egress policy for browser, provider discovery, MCP, webhooks, OAuth/JWKS, and OpenAPI calls.
- Keep external error payloads fixed; route redacted diagnostics to host telemetry.
- Enforce tenant/identity scope in production store factories; no implicit global account.
- Add migration rollback/restore drills to release evidence, not only documentation.
- Pin security-critical direct dependencies; automate weekly audit + compatibility test updates.

### P2

- Add fuzz/property checks for XML/CSV/decimal/parser boundaries.
- Add long-run leak tests for sessions, browser pages, process registries, subscribers, and event queues.
- Add package-size and export-count budgets to stop surface regrowth.

## 5. Test coverage assessment

Last captured coverage (`scripts/coverage-summary.json`, before delegated-adapter removal):

| Package | Lines | Branches | Functions | Assessment |
|---|---:|---:|---:|---|
| Root core | 91.47% | 84.77% | 91.60% | Strong |
| AG-UI | 90.46% | 78.39% | 94.46% | Strong lines; improve protocol branches |
| MCP | 90.25% | 73.44% | 91.22% | Branch gap at remote/error boundaries |
| Memory | 88.87% | 81.69% | 90.54% | Strong |
| Coding tools | 85.76% | 76.39% | 89.65% | Good; protected sandbox paths matter more than percentage |
| Core family | 74.23% | 73.32% | 76.33% | Weakest; exception hides DB/NATS/enterprise legs |
| Web tools | 87.16% | 73.55% | 90.58% | Branch gap in browser/network failures |

Coverage volume is not main risk. Missing environment-backed evidence is:

- PostgreSQL session/enterprise state, HA/fencing, migrations.
- NATS restart/cursor behavior.
- Native/Docker sandbox isolation and egress denial.
- Live provider compatibility and secret-leak checks.
- Office golden/render validation.
- Browser live download/upload/network policy.

Make those a small required protected matrix. Raising unit-line targets will not substitute for them.

## 6. Dependency status

Updated and tested in this review: Graft, AG-UI, AI SDK provider, Office Open, fast-xml-parser, Biome, fast-uri, qs. Ponytail is already current at `4.9.0`.

Impeccable is bundled as Prism source/skill integration rather than declared npm dependency; no package version exists to update through lockfile. Decide one ownership model: consume upstream package or own vendored snapshot with recorded upstream commit.

Deferred majors:

| Dependency | Current → latest | Reason |
|---|---|---|
| `@napi-rs/keyring` | 1.3 → 2.0 | Major credential/storage boundary; needs migration and Node matrix. |
| `better-sqlite3` | 12.11 → 13.0 | Major native ABI/runtime support change. |
| `pdf-parse` | 1.1 → 2.4 | Major parser API and engine constraints; document-reader adaptation needed. |
| `@types/better-sqlite3` | 7.6 → 9.6 | Update with runtime adapter major. |

## 7. Missing capabilities for a general TypeScript AI SDK

Prism already covers text/tool agents, structured output, multimodal **input**, reasoning, prompt caching, OpenAI Realtime, memory/RAG, workflows, governance, evaluations, and protocols. Gaps should be added as provider-neutral contracts, then selected adapters:

### P0 general-purpose gaps

1. **Provider-neutral embeddings API** — current first-party concrete implementation is narrow; memory has host contracts. Add one stable embed-many contract with usage/dimensions/batch limits.
2. **Image generation/editing output** — no first-class provider-neutral output contract.
3. **Speech synthesis and transcription** — Realtime transcription exists on one path, but no portable one-shot/streaming API.
4. **Video input/output contract** — Alibaba maps video through `file`; core has no explicit video modality/capability.
5. **Moderation/safety classification API** — guardrails exist, but provider moderation is not normalized.
6. **Asynchronous provider batch jobs** — existing “batch” mostly means local batching; no submit/status/cancel/result contract for provider batch APIs.

### P1 ecosystem gaps

- Provider-neutral reranker implementation adapters (host contract already exists).
- Standard model-list/capability discovery result with provenance and cache TTL.
- Browser/edge-safe low-level package profile if “all software” includes browsers/workers; current product is Node.js-first.
- Standard middleware for request/response capture with explicit privacy policy and replay-safe redaction.
- Cost/catalog freshness service as host adapter; avoid shipping hard-coded pricing as core truth.

### Explicit non-goals

Do not add built-in vector databases, queues, cloud secret managers, Kubernetes controllers, identity providers, or business connectors to core. Contracts plus optional adapters are enough.

## 8. Recommended execution sequence

1. **Security patch:** alerts 91–92, 84–86, 95–96, 67, 72–74, 81–83, 94; re-run CodeQL.
2. **Test-gate cleanup:** retire phase/freeze scripts from current `npm test`; preserve evidence as static history.
3. **Public-surface cut:** verify 87 candidates, deprecate confirmed unused exports, remove in next major.
4. **Protected integration matrix:** PostgreSQL, NATS, sandbox, browser, Office, small live-provider set.
5. **Only then add modalities:** embeddings, image, speech/transcription, video, moderation, provider batch.
