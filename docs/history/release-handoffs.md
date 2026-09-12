# Release handoffs (archive)

Operator publish handoffs per release line, kept verbatim. Not read on the hot path.

### 0.6.0 publish handoff (plan 071 Task 16)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.6.0** is the first published cut after **0.5.6**: the 0.5.7 cut was never published and is **superseded** by this one (registry preflight `node scripts/release.mjs check --lockstep --version 0.6.0` reports all **10/10 packages available**, so there is no published 0.5.7 to replace or deprecate). The graph is **10 publishable manifests** at exact **0.6.0** with internal ranges `^0.6.0`: root `@arnilo/prism` plus 9 workspace packages (3 `prism-*` family packages, 6 capability packages, 19 provider adapter subpaths inside the providers family).

Host-visible delta (full detail in [migrate-to-0.6.md](../../docs/migrate-to-0.6.md)): the runtime floor moves to **Node `>=22`** (Node 20 is upstream EOL since 2026-04-30) and the never-published 0.5.7 content ships here — third-party floors (`pg ^8.23`, `playwright-core 1.63.0`, `@ai-sdk/provider 4.0.13`, `@agentclientprotocol/sdk` exact `1.4.0`, `@office-open/* 0.14.5`, `zod ^4.6.2`), the removed `@arnilo/prism-office` `playwright-core` peer, five additive host knobs, and the durable-tool-round / strict-provider tool-result fixes. No import path, store schema, event shape, or public signature was removed: the compat baselines were regenerated and reviewed as **+70 public names, zero removals** (32 declaration-site moves from the module splits).

Evidence recorded for the tree under publication: `scripts/release-evidence.json` — **42 surfaces, 11 pass, 31 protected with reasons, `blocked: false`** (`test:postgres durable conformance` is a real pass, count 91, env **name** only); `npm test` 5/5 stages (core count 3716, skip 33); combined coverage core 92.13% lines against the 60/70/75 gate with all nine workspace suites above their lines thresholds; `security:threat-suites` 83/83; `npm audit --audit-level=moderate` 0; SBOM regenerated (`npm sbom --sbom-format spdx > security-artifacts/sbom.spdx.json`, 172 packages, 10 licenses, `verify-sbom` clean); tracked-source secret scan 2166 files, 0 findings.

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL protected suite green (test:postgres) and CodeQL SAST green on the release commit
#  3. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)
#  4. branch protection: the compatibility leg is named node22-compat (renamed from node20-compat)

git diff --check
npm ci
# sdk:ready phases, as .github/workflows/release.yml runs them (env scoped to release:gate only):
npm run typecheck && npm run lint && npm run format:check
npm test && npm run test:coverage && npm run pack:dry-run
PRISM_TEST_POSTGRES_URL=... npm run release:gate
npm run security:threat-suites

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.6.0 -m "0.6.0"
node scripts/release.mjs publish --lockstep --version 0.6.0

# First-party package tags: push in batches of <=3 per push (tag-push storms; VENT 26-08-29).
```

Rollback pins the previous published line — `@arnilo/prism@0.5.6` and its siblings, exact pins per package. **Never pin 0.5.7: it does not exist on the registry.** Persisted shapes are unchanged across 0.5.6 → 0.6.0, so a pin rollback loses only the Node floor, the peer floors, and the new knobs.

### 0.3.2 independent workflow patch (plan 045)


`@arnilo/prism-workflows@0.3.2` is the independent bounded-loop release: durable iteration checkpoints, tool-body resume, replay events, redaction/bounds, and the frozen `maxNodes`/`maxIterations` accounting rule. The root remains `@arnilo/prism@0.3.3`; no generic checkpoint-store or SQL migration is required. Publish from a clean commit tagged `@arnilo/prism-workflows@0.3.2` after the independent release gate; local preview is:

```bash
npm run release:check -- --allow-dirty --allow-untagged
npm run release:publish -- --dry-run --allow-dirty --allow-untagged
```

Rollback restores `@arnilo/prism-workflows@0.3.1`; persisted checkpoints remain readable because iteration records are additive.

`--allow-dirty` and `--allow-untagged` exist only for local preview; real publication and CI never pass them. npm registry calls occur only in these release preflight/publication commands, never build/test/package discovery.

Optional live smoke tests stay separate from SDK readiness because they require credentials and network access:

```bash
PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present
```

### 0.1.0 publish handoff (plan 012 Task 7)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.0** (Phase 12, plan 012) is the release-candidate hardening cut of the **0.0.28** graph: no new packages, public exports, schema migrations, or runtime dependencies (freeze manifest `scripts/phase12-freeze-manifest.json`). At this line the canonical statement read **49 publishable manifests**: the root `@arnilo/prism` core package plus **48 workspace packages** — 14 provider adapters, 9 `prism-*` family/profile packages, and 25 capability packages. Publishable graph stays **49** publishable manifests (root + 48 workspace packages) at exact **0.1.0**. Store compatibility with 0.0.28: **compatible, no migration** ([migration](../migration.md) `0.0.28 → 0.1.0`); the full `0.0.17 → 0.1.0` upgrade matrix is in the same page. All evidence for the tree under publication is recorded in [0.1.0 readiness](0.1.0-readiness.md) (capacity envelopes, restart-recovery, e2e journeys, threat-suites leg, audit at moderate).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
node --test scripts/benchmark-0.1.0.test.mjs   # frozen 0.1.0 capacity envelope contract
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.0 --report /tmp/prism-0.1.0-preflight.json
npm run release:publish -- --version 0.1.0 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.0-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.0 -m "Prism 0.1.0"
git verify-tag v0.1.0
git push origin v0.1.0        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.0 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.0` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.0` is store-compatible with `0.0.28` in both directions (no migration ran), so an operator may defer adoption of `0.1.0` without a database rollback.

### 0.1.1 publish handoff (plan 013 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.1** (plan 013) is the post-release hardening patch on the frozen 0.1.x line: five scoped fixes — build single-flight (clean removed from `npm run build`; standalone `npm run clean`), deterministic MCP SSE relay test (`relayStatelessBody` internal export in `@arnilo/prism-mcp`, not in the package entry surface), combined core + workspace coverage summary (`scripts/coverage-summary.mjs`, appended to `test:coverage`), canonical manifest-count narrative (49 publishable manifests = root + 48 workspace packages), and ACP modes/config ownership-scoped persistence guidance (the agent never persists them; host stores MUST key by `sessions.ownership`). Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.1**. Store compatibility with 0.1.0: **compatible, no migration** ([migration](../migration.md) `0.1.0 → 0.1.1`); declaration surface additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.1 with zero breaking deltas).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.1 --report /tmp/prism-0.1.1-preflight.json
npm run release:publish -- --version 0.1.1 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.1-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.1 -m "Prism 0.1.1"
git verify-tag v0.1.1
git push origin v0.1.1        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.1 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.1` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.1` is store-compatible with `0.1.0` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback.

### 0.1.2 publish handoff (plan 014 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.2** (plan 014) is the Alibaba Cloud provider enrichment patch on the frozen 0.1.x line: `createAlibabaEmbedder` over the OpenAI-compatible `POST {base}/embeddings` (structural `Embedder`, no new dependency), video input via `video_url` content parts on Qwen-VL models (gated on the `file` input capability), a verified compatible-mode surface decision table in [providers/alibaba.md](../providers/alibaba.md) (document input and rerank deferred as demand-gated follow-ups), and an opt-in `PRISM_LIVE_DASHSCOPE_KEY` live probe. Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.2**. Store compatibility with 0.1.1: **compatible, no migration**; declaration surface additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.2 with zero breaking deltas).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.2 --report /tmp/prism-0.1.2-preflight.json
npm run release:publish -- --version 0.1.2 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.2-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.2 -m "Prism 0.1.2"
git verify-tag v0.1.2
git push origin v0.1.2        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.2 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.2` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.2` is store-compatible with `0.1.1` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback.

### 0.2.4 publish handoff (plan 024 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.4** (plan 024) is the package-documentation-and-compatibility-truth cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.4: delta is the version literal only — no export changes; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase24-freeze-manifest.json`). Documentation/compatibility truth, **no runtime contract change and no migration**: (1) **umbrella wording matches manifests** — before: `@arnilo/prism-providers` claimed to install every one of the 14 first-party provider adapters while its `dependencies` shipped 11, and `@arnilo/prism-all` claimed to install every first-party package while 5 packages were unreachable from its install set. After: `prism-providers` states **11 of 14** (Azure, Bedrock, Vertex are added separately by `prism-all`; its install list was corrected from 9 to the full 11 — alibaba and ollama were missing from the docs), and `prism-all` states **20 direct / 43 transitive** packages with the complete omission set named (document-reader, OpenAPI tools, NATS, Caveman, Ponytail). **No `dependencies` array changed in 0.2.4** — the manifests were already truthful; only the claims were wrong. Membership itself is 0.3.0 scope (§0.3.0 "Umbrella membership fix"). (2) **generated tables from one source of truth** — `node scripts/package-truth.mjs` reads every manifest and emits `scripts/package-truth.json` (counts 50/49/14/9/26, provider/family/capability membership, umbrella + profile closures, peer policy); all count/closure/current-line docs literals are derived from it and the gates fail on drift (plain JS consumer example):

```js
import { readFileSync } from "node:fs";
const truth = JSON.parse(readFileSync("scripts/package-truth.json", "utf8"));
console.log(truth.counts.publishable, truth.umbrella["prism-all"].closure); // 50 43
```

(3) **peer-version policy Decision A (exact pins)** — every code package peers the bare exact current version `@arnilo/prism@0.2.4` (no `~`/`^`/`>=`/`*`) through 0.2.x with the atomic-upgrade rule: all `@arnilo/prism-*` packages move at the same version; a partial upgrade fails clearly at install time with `ERESOLVE unable to resolve dependency tree` naming the conflicting peer (never a silent install of a pair that was never tested); the range widens to `^1.0.0` at the 1.x stable release after the 1.0 readiness gates go operator-green. Third-party `@arnilo/prism-*` adapters declare the same exact peer on the documented current version. (4) **docs semantic, not phrase-only** — the structural docs tests derive every count/closure/current-line assert from the generated artifact (an editorial reword that keeps the derived value passes; a wrong value fails), the stale `0.2.8` stray roadmap section was removed, and `docs/0.1.0-readiness.md`/`docs/index.md` current-line blocks advance to 0.2.4 with **0.1.7** recorded as the terminal 0.1.x baseline (0.1.1/0.1.0 tables demoted to historical record). Release graph stays **50** publishable manifests at exact **0.2.4**; zero new runtime dependency names (core remains dependency-free); 43 code packages + 6 pure-manifest family/profile. Regression surface: `phase24-truth` (12, incl. built-dist version + docs current-line + umbrella wording freeze + gate accounting), packed plain-JS truth conformance in install-smoke (providers tarball = exactly 11 provider deps; prism-all tarball = generated 20 deps + 43-member closure; packed current-line equals docs), and the Task 3 packed ERESOLVE refusal proof. Exit gate green: npm test core + workspace + script gates, `sdk:ready` exit 0, audit 0 moderate, secret scans 0 findings, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.4 (version literal only), release-evidence manifest with zero blocked surfaces; evidence in `scripts/phase24-baseline.json` `exitGate`. **Rollback notes.** Rollback = restore the 0.2.3 manifests/tag. Nothing persisted changes shape and no runtime behavior changed, so downgrade is store-safe; the only visible deltas are the version literal and the corrected docs wording (the old umbrella claims reappear if you revert the docs — the truth tests fail red until the wording is restored).

```bash
# Operator prerequisites recorded: clean tree at the v0.2.4 tag candidate, GPG key, npm OIDC publisher.
node scripts/release.mjs bump --from 0.2.3 --to 0.2.4   # already applied by Task 6; idempotent
npm test                                        # core + workspace suites + all script gates (incl. phase24-truth)
npm run security:threat-suites                  # phase8-11 + phase20 + phase21 + phase22 + phase23 public-entry conformance
PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@127.0.0.1:54329/prism_test npm run sdk:ready
node scripts/release.mjs gate --version 0.2.4   # plain reviewed gate at 0.2.4: version literal only, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.4 --report /tmp/prism-0.2.4-preflight.json
npm run release:publish -- --version 0.2.4 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.4-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): the durable state-concurrency legs (Postgres `prism_phase24_*` schemas — `npm run test:postgres` under `PRISM_TEST_POSTGRES_URL`; absent credentials record **blocked** per the release skip manifest), the phase24 package-truth conformance over built dist + packed tarballs, and the live canaries (provider OIDC/OPA, MCP, A2A, Brave — always `protected` rows in the manifest, never `pass`). The release skip manifest names every skip class with its required env; missing protected evidence records 0.2.4 as **blocked**, never a passing skip.

### 0.2.6 publish handoff (plan 026 Task 8)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.6** (plan 026) is the fully-featured coding-agent-readiness cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.6: expected deltas are the version literal plus the Task 1–6 additive exports — PTY backend/handle types, indexed-search seam, workspace lifecycle, process/ACP recovery, review manifest + diagnostics; zero removals; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase26-freeze-manifest.json` records per-task evidence tokens, state machines, caps, the demand registry, and deviations D-T3-1/D-T5-1/D-T7-1). Seven roadmap items, **no runtime contract change, additive migration**: (1) **host-selected PTY/interactive terminal backend** (`pty-backend`) — `createProcessSessions` gains an optional `ptyBackend` with explicit `capabilities.resize`; `pty: true` without a backend fails byte-compatibly with `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before spawn; bounded geometry/TERM/attach/resize-rate/metadata caps, generic backend errors that never leak backend text, NUL rejected as a policy error, backend loss surfaces as `unknown` with `exitCode: null`; the protected PTY leg (`scripts/phase26-pty-protected.test.mjs`, gated by `PRISM_TEST_PTY_BACKEND`) passed 4/4 against a real PTY host (python3 `pty.fork` + `TIOCSWINSZ`). (2) **scalable indexed code-search seam** (`indexed-search`) — `createIndexedRepositoryOperations` composes a host-owned incremental index with bounded literal search as the unchanged default; `indexed_literal`/`semantic` fail closed on stale/failed/unsupported/untrusted indexes (`ERR_PRISM_INDEX_*`), no silent semantic-to-literal downgrade, results labeled `untrusted_index`; 100k-entry benchmark p95 ≤ 250 ms, 1k-file update ≤ 1 s, heap ≤ 64 MiB. (3) **ownership-scoped multi-repository/worktree lifecycle** (`workspace-lifecycle`) — `createCodingWorkspaceLifecycle` over CheckpointStore CAS + LeaseStore fencing (`prism.coding-agent.workspace.v1`), locked worktrees with `prism-workspace:` reasons, credential-free remote fingerprints, idempotent create, verify revalidation, cleanup refusal matrix, `ERR_PRISM_WORKSPACE_*`; `GitOperations` gains worktree `lock`/`unlock` + `fingerprint()`. (4) **forge breadth demand-gated** (`forge-breadth`) — GitLab/Bitbucket stay **deferred** in the demand registry with no named consumer; no adapter source ships; activation requires a recorded named consumer/date/use case. (5) **durable ACP/live-task and managed-process recovery** (`durable-recovery`) — bounded process intent/metadata persisted before spawn (`prism.coding-agent.process.v1`), serialized per-record CAS transition writes, attach-if-attested `recover()` reporting `attached|terminal|unknown` with no fabricated exit code and no PID probing; per-record leases fence replicas (memory + real Postgres two-replica conformance 8/8); ACP `activeRun` refs (additive optional, 0.2.5 records stay readable) + `createAcpRunRecovery` status re-resolution and durable fence-checked cancellation (`prism.coding-agent.cancel.v1`) that never replays a pending/dispatched tool. (6) **bounded patch review and incremental diagnostics** (`review-diagnostics`) — `createCodingPatchReviewManifest` + `assertCodingPatchAccepted` (pending/accepted/rejected/superseded bound to digest + revision + identity, stale acceptance refused, never auto-applies/commits/pushes/merges) composed over the server `ArtifactService`; `normalizeDiagnostics`/`diagnosticDelta` with deterministic added/removed/unchanged deltas and host-supplied check parsers; opt-in LSP `syncDocument`/`diagnosticDelta` (monotonic versions, resultId reuse) — LSP stays strictly opt-in, nothing spawns from tool factories or agent assembly. (7) **protected real coding journey** (`coding-journey`) — `scripts/phase26-coding-journey.test.mjs` packs 10 packages into a fresh consumer and drives real host services (provider call, digest-pinned Docker sandbox, Postgres worktree lifecycle, provider-driven ACP edit with policy approval, named check + `diagnosticDelta`, patch review over the server artifact store, cross-replica process recovery, durable cancellation, real GitHub push/lookup-before-create PR/reconcile/cleanup, host Playwright inspection, host PTY adapter in the frozen profile) under frozen wall/cleanup ceilings with run-suffix side effects and per-step idempotent cleanup; missing credentials/services or skipped substeps record **blocked**, never a passing skip; the retained `scripts/phase26-coding-journey-report.json` (timings/states/ids only) gates release evidence (pass/blocked/protected). Release graph stays **50** publishable manifests at exact **0.2.6**; zero new runtime dependency names (core remains dependency-free); 43 code packages + 6 pure-manifest family/profile.

**Measured reductions and deltas (recorded in `scripts/phase26-baseline.json` `exitGate`).** New error families: `ERR_PRISM_PROCESS_PTY_*`, `ERR_PRISM_INDEX_*`, `ERR_PRISM_WORKSPACE_*`, `ERR_PRISM_RECOVERY_*`, `ERR_PRISM_REVIEW_*` — all additive, all fail closed. New protected env names (never values): `PRISM_TEST_PTY_BACKEND`, `PRISM_TEST_POSTGRES_URL`, `PRISM_TEST_DOCKER_BIN`, `PRISM_TEST_DOCKER_IMAGE`, `PRISM_LIVE_PLAYWRIGHT`, `PRISM_CODING_FORGE_REPOSITORY`, `PRISM_CODING_FORGE_TOKEN`, `PRISM_CODING_PROVIDER`, `PRISM_CODING_JOURNEY`. Coverage stayed above the recorded 0.2.5 floors. **Rollback notes.** Rollback = restore the 0.2.5 manifests/tag. Three new versioned checkpoint namespaces exist (`prism.coding-agent.process.v1`, `prism.coding-agent.workspace.v1`, `prism.coding-agent.cancel.v1`) plus the additive optional ACP `activeRun` ref; before downgrading, stop all 0.2.6 workers and mark active PTY/process/recovery records unknown (a crashed 0.2.6 replica that resumes on 0.2.5 fails closed — recovery never fabricates an exit code or re-spawns without host attestation). No 0.2.5 persisted shape changed, so an ordinary downgrade is store-safe; the added exports simply disappear.

```bash
# Operator prerequisites recorded: clean tree at the v0.2.6 tag candidate, GPG key, npm OIDC publisher.
node scripts/release.mjs bump --from 0.2.5 --to 0.2.6   # already applied by Task 8; idempotent
npm test                                        # core + workspace suites + all script gates (incl. phase26-freeze + phase26-index-benchmark)
npm run security:threat-suites                  # phase8-11 + phase20-25 public-entry conformance
PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@127.0.0.1:54329/prism_test npm run test:postgres
node --test scripts/phase26-recovery-conformance.test.mjs   # protected: memory + real Postgres two-replica recovery/workspace conformance
node --test scripts/phase26-pty-protected.test.mjs          # protected: real PTY host (PRISM_TEST_PTY_BACKEND)
PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@127.0.0.1:54329/prism_test npm run sdk:ready
node scripts/release.mjs gate --version 0.2.6   # plain reviewed gate at 0.2.6: version literal + additive exports only, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.6 --report /tmp/prism-0.2.6-preflight.json
npm run release:publish -- --version 0.2.6 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.6-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): the durable recovery/workspace conformance legs (real Postgres two-replica split-brain fence, cross-replica cancellation, terminal-before-recovery), the protected PTY leg (real PTY host adapter), the protected real coding journey (`scripts/phase26-coding-journey-report.json` — pass/blocked/protected, never a passing skip; runs in `.github/workflows/coding-journey.yml` with real provider/Docker/Playwright/GitHub/Postgres/PTY services), and the live canaries (provider OIDC/OPA, MCP, A2A, Brave — always `protected` rows in the manifest, never `pass`). The release skip manifest names every skip class with its required env; missing protected evidence records 0.2.6 as **blocked**, never a passing skip.

### 0.3.0 lockstep cut and independent publication (plan 030 Task 9)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.3.0** is the last lockstep cut: all **56** publishable manifests are `0.3.0`, and every internal `@arnilo/*` dependency, optional dependency, and peer dependency uses `^0.3.0`. This cut adds the optional host-owned `@arnilo/prism-computer-use-linux` wrapper, `read.findText`, loud edit fuzzy matches/miss context, and ACP editor-buffer wiring; the desktop package stays outside umbrella profiles. Peer policy is now **Decision B**: packages may move independently inside the 0.x caret window (`>=0.3.0 <0.4.0`).

After the signed `v0.3.0` cut, publication is package-tag driven: `@arnilo/<package>@<version>` publishes only changed packages at that version. The lockstep core artifact is `arnilo-prism-0.3.0.tgz`; later package artifacts carry their own name and version. A generic `v*` tag is not a publication trigger after this cut. The one emergency lockstep path remains explicit: `--lockstep --version 0.3.0`.

```bash
# one manifest bump + one lockfile regeneration for the final cut
node scripts/release.mjs bump --from 0.2.9 --to 0.3.0 --ranges caret
node scripts/package-truth.mjs
node scripts/release.mjs check --lockstep --version 0.3.0 --allow-dirty --allow-untagged
# later checks default to independent mode
npm run release:check -- --allow-dirty --allow-untagged
```

For a later coding-agent-only patch, bump its manifest with `bump --package @arnilo/prism-coding-agent --type patch`, regenerate the lockfile, commit, and push `@arnilo/prism-coding-agent@0.3.1`. The default independent check validates the mixed graph; the package tag publishes only that package in dependency order. Resume skips only a matching already-published manifest and refuses a same-version registry collision with different internal release fields.

**Rollback notes.** Before publication, restore the 0.2.9 manifests/tag. After publication, roll forward with an additive 0.3.x package patch; npm unpublish is not a rollback strategy.

### 0.3.1 independent RAG engine patch (plan 034 Task 12)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.3.1** is the first Decision B independent patch: only `@arnilo/prism-memory`, `@arnilo/prism-rag`, and `@arnilo/prism-observability-opentelemetry` move `0.3.0 → 0.3.1`. Internal `^0.3.0` ranges stay. Root current line remains **0.3.0**.

```bash
node scripts/release.mjs bump --package @arnilo/prism-memory --type patch
node scripts/release.mjs bump --package @arnilo/prism-memory/rag --type patch
node scripts/release.mjs bump --package @arnilo/prism-core/governance/observability --type patch
node scripts/release.mjs gate --update-baseline --skip-tarball   # review Embedder.id; scanner is additive-only
node scripts/release.mjs check --allow-dirty --allow-untagged
# publish tags (operator handoff; not this task):
#   git tag @arnilo/prism-memory@0.3.1 && git tag @arnilo/prism-memory/rag@0.3.1
#   git tag @arnilo/prism-observability-opentelemetry@0.3.1 && git push --tags
```

**Compat.** Baselines regenerated with `--update-baseline`. Expected deltas are additive exports (`createPostgresVectorStore`, `createTeiReranker`, `createRagTelemetry`, multi-scope `scopes`, `HARD_RETRIEVE_SCOPE_CAP`, fusion/hash/generation helpers). `Embedder.id` is a TypeScript implementer break documented in `docs/migration.md` `0.3.0 → 0.3.1`; the name-level scanner does not see interface members, so `--allow-break` is not required. `RagProvenance` gained `tenantId`/`resourceId`/`corpusId` (additive interface members, invisible to scanner). **Store:** additive Postgres DDL; 0.3.0 rows remain readable. **Rollback:** restore the 0.3.0 package versions. Publication remains the operator handoff — this task does not publish.

### 0.3.1 changed-package cut (plan 039 Task 8)


**Decision: GO when the operator prerequisites below are recorded.** The plan 039 cut is the first Decision B **root** patch: the baseline is the plan 035 completion parent `c600eaa`; 30 packages publish in dependency order — root `@arnilo/prism` plus 27 changed workspace packages move to **0.3.1** (`@arnilo/prism-rag` moves 0.3.1 → 0.3.2), and `@arnilo/prism-obscura` publishes new at its reviewed initial **0.3.0**. Every unchanged package stays byte-identical (peers keep the `^0.3.0` window; republished packages carry `^0.3.1` root peers — both satisfy the root). Additive-only compat (version literal + plan 036/037 additive exports + the obscura CDP/browser surface; baselines regenerated with `--update-baseline`, no `--allow-break`, no migration).

```bash
node scripts/release.mjs changed --baseline c600eaa18f65b56764ec2fb408ec813536eff6f7   # 30 packages
# per-package: node scripts/release.mjs bump --package <name> --type patch (applied by plan 039 task 8)
node scripts/release.mjs gate --update-baseline --skip-tarball
node scripts/release.mjs check --independent --baseline c600eaa18f65b56764ec2fb408ec813536eff6f7
node scripts/release.mjs publish --independent --baseline c600eaa18f65b56764ec2fb408ec813536eff6f7 --dry-run
# publish tags (operator handoff; not this task): push the 30 annotated
# `<name>@<version>` package tags (e.g. @arnilo/prism@0.3.1,
# @arnilo/prism-obscura@0.3.0, @arnilo/prism-rag@0.3.2) — release.yml's publish
# job runs deterministic release:publish in dependency order with OIDC provenance.
```

**Compat.** Baselines regenerated (`--update-baseline`): version literal, obscura `connectObscuraCdp`/`createObscuraWebTools` types, plan 036/037 additive exports. **Rollback:** restore the pre-cut manifests/tags. Publication remains the operator handoff — this task does not publish.

### 0.3.2 changed-package cut (plan 050 Task 12)


**Decision: GO when the operator prerequisites below are recorded.** The plan 050 cut covers the clay-integration-findings remediation and the OKF wiki adoption: baseline `edb4fcf` (the parent of the plan 050 implementation work); five packages publish in dependency order — root `@arnilo/prism` (FEATURE-1 agent-definition model override fallback, FEATURE-3 command driver hooks, FEATURE-2/6 docs+example, DOCS-1 contracts), `@arnilo/prism-coding-agent` (BUG-1 `allowCustom` default + optional `toolCallId`), `@arnilo/prism-supervisor` (BUG-2 child-factory `Agent` guard, FEATURE-4 opt-in child event passthrough), `@arnilo/prism-wiki` (OKF v0.2 bundle emission, 0.0.2 → 0.0.3), and `@arnilo/prism-acp-agent` (sqlite `:memory:` pass-through fix, 0.0.x-style patch 0.3.1 → 0.3.2). Every unchanged package stays byte-identical; docs-only packages (`@arnilo/prism-workflows`, `@arnilo/prism-compaction-observational-memory`) do not bump. Republished packages carry `^0.3.2` root peers; unchanged packages keep their window peers. Docs-only change on the root: none of the deltas are breaking (additive fields and fail-closed guards), compat additive-only, no migration.

```bash
node scripts/release.mjs changed --baseline edb4fcf   # 5 packages
# per-package: node scripts/release.mjs bump --package <name> --type patch (regenerates the lockfile)
npm run sdk:ready   # blocked only by the protected PRISM_TEST_POSTGRES_URL row (pre-existing)
node scripts/release.mjs check --independent --baseline edb4fcf --allow-dirty --allow-untagged
node scripts/release.mjs publish --independent --baseline edb4fcf --dry-run
# publish tags (operator handoff; not this task): push the 5 annotated
# `<name>@<version>` package tags (e.g. @arnilo/prism@0.3.2,
# @arnilo/prism-wiki@0.0.3) — release.yml's publish job runs deterministic
# release:publish in dependency order with OIDC provenance.
```

**Rollback:** restore the pre-cut manifests/tags. No persisted shape changed (BUG-1/BUG-2 guards and the acp-agent `:memory:` fix are fail-closed tightenings). Publication remains the operator handoff — this task does not publish.

### 0.4.0 publish handoff (plan 054 Task 9)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.4.0** is the package-consolidation lockstep cut: 10 active manifests (root + 9 workspace families/interop/office) at **0.4.0** with `@arnilo/prism@^0.4.0` peers. 55 retired 0.3 names are not republished as shims. After the 0.4 tarballs and `docs/migrate-to-0.4.md` are public, `node scripts/phase54-legacy-registry.mjs --apply --confirm` tags each retired name `legacy` and deprecates `<0.4.0`. Store compatibility with 0.3.3: **compatible, no persisted-shape migration**. Rollback = exact 0.3 pins.

```bash
npm run sdk:ready
npm run release:check -- --lockstep --version 0.4.0 --allow-dirty --allow-untagged
npm run release:publish -- --lockstep --version 0.4.0 --dry-run --allow-dirty --allow-untagged --report release-artifacts/publish-dry-run.json
node scripts/phase54-legacy-registry.mjs --dry-run
# operator: clean tree, tag v0.4.0, publish, then --apply --confirm
```

**Rollback notes.** Rollback = restore 0.3.x exact pins. No store migration.

### 0.3.3 publish handoff (plans 041-044 Task 3)


**Decision: GO when the operator prerequisites below are recorded.** The plan 041-044 cut covers the four outstanding feature plans on the 0.3.x line: baseline `1171575` (the plan-040 commit, parent of all four plans' uncommitted implementation work). Six publishable changes in dependency order — root `@arnilo/prism` **0.3.2 → 0.3.3** (progressive tool loading `search_tools` disclosure + `toolsSearch`/`toolsDisclosure` config, run-ledger `promptVersion` ref with `PERSISTENCE_SCHEMA_VERSION` 8 → 9, docs for the prompt registry and composite memory scoring, memory package truth), `@arnilo/prism-session-store-codecs` / `@arnilo/prism-session-store-sqlite` / `@arnilo/prism-session-store-postgres` **0.3.0 → 0.3.1** (nullable `prompt_version` column + additive checked migrations), `@arnilo/prism-evals` **0.3.0 → 0.3.1** (trace-to-dataset curation `datasetFromRuns`), and `@arnilo/prism-memory` **0.3.1 → 0.3.2** (composite recall scoring `RecallOptions.scoring`, `importance` record field + ADD COLUMN, `importanceFrom` write hook). `@arnilo/prism-prompts` publishes new at its reviewed initial **0.0.1** (independent host opt-in like the versioned prompt registry — not in `prism-all`, no first-party dependency). Unchanged packages stay byte-identical; `@arnilo/prism-dev`/`@arnilo/prism-graft`/`@arnilo/prism-ponytail` stay at their reviewed initial versions. Republished set keeps the `^0.3.0` Decision B root-peer window; unchanged packages keep their window peers. Additive-only compat (new exports + the two documented literal changes: `PERSISTENCE_SCHEMA_VERSION` literal and the CLI `usage` string; baselines regenerated with `--update-baseline`, no `--allow-break`, no migration).

```bash
node scripts/release.mjs changed --baseline 1171575   # root + memory + evals + 3 stores (+ prompts as new)
PRISM_TEST_POSTGRES_URL=... node scripts/release-skip-manifest.mjs
PRISM_TEST_POSTGRES_URL=... npm run release:gate
node scripts/release.mjs check --independent --baseline 1171575 --allow-dirty --allow-untagged
node scripts/release.mjs publish --independent --baseline 1171575 --dry-run --allow-dirty --allow-untagged
# publish tags (operator handoff; not this task): push the annotated
# `<name>@<version>` package tags — release.yml's publish job runs
# deterministic release:publish in dependency order with OIDC provenance.
```

### 0.2.9 publish handoff (plan 029 Task 10)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.9** (plan 029) is the provider-adoption and behavior-packages cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.9: expected deltas are the version literal plus the new provider/OAuth/impeccable exports and the form-urlencoded `pollDeviceCodeToken` options; zero removals; baselines regenerated with `--update-baseline`, no `--allow-break`). Ships `@arnilo/prism-providers/deepseek`, `@arnilo/prism-providers/xai` (API key + SuperGrok RFC 8628), `@arnilo/prism-providers/clinepass`, and `@arnilo/prism-impeccable`. Ponytail peer `^4.9.0` (bare `/ponytail` reports status). Caveman registers extra `SKILL.md`. SuperGrok is host-invoked; Cline WorkOS, DeepSeek `/anthropic`, grok-cli file scan, harness/Cordis/Muse, Caveman 2 engine, and Impeccable live detector stay out. Release graph is **55** publishable manifests at exact **0.2.9** (root + 54 workspace). Store compatibility with 0.2.8: **compatible, no migration**.

**Rollback notes.** Rollback = restore the 0.2.8 manifests/tag. No persisted 0.2.8 shape changed; the added packages simply disappear.

```bash
node scripts/release.mjs bump --from 0.2.8 --to 0.2.9   # already applied by Task 10; idempotent
npm test
PRISM_CLIENT_NAMES=<names> node scripts/check-client-neutrality.mjs
npm run sdk:ready
node scripts/release.mjs gate --version 0.2.9
npm run pack:dry-run
npm audit --audit-level=moderate
node scripts/scan-secrets.mjs && npm sbom --sbom-format spdx > security-artifacts/sbom.spdx.json && node scripts/verify-sbom.mjs
npm run release:check -- --version 0.2.9 --report /tmp/prism-0.2.9-preflight.json
npm run release:publish -- --version 0.2.9 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.9-dry-run.json
```

Protected evidence stays the same classes as 0.2.8 plus SuperGrok live login (`PRISM_LIVE_XAI_OAUTH`) — always `protected`, never a silent pass. Publication remains the operator handoff (signed `v0.2.9` tag + npm OIDC).

### 0.2.8 publish handoff (plan 028 Task 18)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.8** (plan 028) is the ACP adoption-fixes cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.8: expected deltas are the version literal plus the plan 028 additive exports — `ToolKind`/`kind` on `ToolDefinition`, `AgentFinishReason`, `createCodingToolProjection`/`AgUiProjectedImage`/`AgUiProjectedToolResult`, `AcpCommand`/`AcpCommandsSeam`, `ERR_PRISM_ACP_RUN`, `acpImageBytes`/`acpCommandsPerUpdate`, and the new `@arnilo/prism-acp-agent` package; zero removals; baselines regenerated with `--update-baseline`, no `--allow-break`). Client names are scrubbed; `scripts/check-client-neutrality.mjs` is part of `release:gate`. ACP B1–B5 and F1–F10 as recorded in `plans/028-Release-0-2-8-ACP-Adoption-Fixes.md`. Release graph is **51** publishable manifests at exact **0.2.8** (root + 50 workspace). Store compatibility with 0.2.7: **compatible, no migration**.

**Rollback notes.** Rollback = restore the 0.2.7 manifests/tag. No persisted 0.2.7 shape changed; the added exports and `@arnilo/prism-acp-agent` simply disappear.

```bash
node scripts/release.mjs bump --from 0.2.7 --to 0.2.8   # already applied by Task 18; idempotent
npm test
PRISM_CLIENT_NAMES=<names> node scripts/check-client-neutrality.mjs
npm run sdk:ready
node scripts/release.mjs gate --version 0.2.8
npm run pack:dry-run
npm audit --audit-level=moderate
node scripts/scan-secrets.mjs && npm sbom --sbom-format spdx > security-artifacts/sbom.spdx.json && node scripts/verify-sbom.mjs
npm run release:check -- --version 0.2.8 --report /tmp/prism-0.2.8-preflight.json
npm run release:publish -- --version 0.2.8 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.8-dry-run.json
```

Protected evidence stays the same classes as 0.2.7 (Postgres durable legs, live canaries). Missing protected evidence records **blocked**, never a passing skip. Publication remains the operator handoff (signed `v0.2.8` tag + npm OIDC).

### 0.2.7 publish handoff (plan 027 Task 10)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.7** (plan 027) is the enterprise ERP production-readiness cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.7: expected deltas are the version literal plus the plan 027 additive exports — ERP outbox/inbox + dispatcher, saga engine, SoD approvals, audit export, field policy, ERP invariant evals; zero removals; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase27-freeze-manifest.json` records per-task evidence tokens, state machines, caps, the demand registry, measured HA/DR/classification/journey numbers, and the explicit 0.3.0 blocker). Nine roadmap items, **no exactly-once claim, additive forward-only migrations**: (1) **transactional outbox/inbox** (`erp-messaging`, Task 1) — `ErpOutboxStore`/`ErpInboxStore` + bounded `ErpOutboxDispatcher` with claim-token CAS, `FOR UPDATE SKIP LOCKED`, `ON CONFLICT DO NOTHING` idempotent append, at-least-once delivery with explicit unknown-outcome, dead-letter/replay requiring verified tenant `AgentIdentity`; migration `004_erp_messaging` (`prism_erp_outbox`/`prism_erp_inbox`, 14+4 columns, 3 partial indexes). (2) **saga compensation and reconciliation** (`saga`, Task 2) — `defineSaga`/`runSaga`/`resumeSaga` over existing CheckpointStore + LeaseStore (`prism.workflow.saga`), reverse-order compensation, unknown-outcome detection, manual resolution requiring verified identity + bounded reason + audit ref, stable tenant-scoped operation keys, redacted snapshots, `MAX_SAGA_STEPS=100`. (3) **multi-party and separation-of-duties approvals** (`approvals`, Task 3) — `ApprovalStore` with role/quorum rules, requester/approver separation, any-party-veto rejection, delegated authority (max depth 8), expiry checked at every protected transition, atomic grant consumption in the host transaction, `policyRevision` pin denying on mismatch; migration `005_erp_approvals` (`prism_erp_approvals`, JSONB decisions, `FOR UPDATE` row lock). (4) **tamper-evident audit export** (`audit-export`, Task 4) — `createAuditExporter` with WORM-then-SIEM ordering, hash-chained record envelopes (genesis 0x64 zeros), `verifyAuditBatch` independent verification, `AuditCursorStore` CAS, SIEM best-effort pending replay (8-entry cap), legal-hold flag preservation, RFC 8785 canonical JSON for digests; Prism does not certify NIST/SIEM/WORM compliance programs. (5) **secret-manager adapters demand-gated** (Task 5) — Vault/AWS/Azure/GCP stay **deferred** behind the demand gate (no named consumer; no adapter ships; `scripts/phase27-demand-gate.mjs` enforces zero ambient discovery). (6) **HA registries and recovery** (`ha-dr`, Task 6) — two-replica drill on real Postgres proves failover within lease TTL+5s (measured 4100 ms vs 9000 ms ceiling), idempotent outbox re-append on uncertain-commit replay, stale fence/revision write rejection, exactly-one lease owner, tenant isolation fail-closed. (7) **backup, restore, and migration rollback evidence** (Task 7) — `pg_dump`/`pg_restore` custom-format backup (108,291 B / 122 ms / 382 ms restore), 0.2.6→0.2.7 migration forward+rollback rehearsed (5 migrations), PITR RPO 0 s / RTO 1 s (recovery 1163 ms); production rollback is roll-forward repair only (no down migrations). (8) **field-level data classification and redaction** (`field-policy`, Task 8) — `applyFieldPolicy`/`FieldPolicy`/`createProtectedFieldPolicy` at the redaction, audit-export, and OpenTelemetry seams; unknown-label deny-on-outbound fail-closed default, sparse-copy walker, measured overhead peak 99.8% of the redactor-walk baseline (cap 110%). (9) **ERP release journey** (`erp-evals`, Task 9) — `erpInvariantDataset` + `createErpInvariantScorers` (8 hard 0/1 gates consuming structured facts only) + `scripts/phase27-erp-journey.test.mjs` exercising identity/policy/budget/SoD-approval/outbox/saga-compensation/audit-export/legal-hold/classification/failover/restore end-to-end (4815 ms, all 8 invariants pass). Release graph stays **50** publishable manifests at exact **0.2.7**; zero new runtime dependency names (core remains dependency-free); 43 code packages + 6 pure-manifest family/profile.

**Measured reductions and deltas (recorded in `scripts/phase27-release-evidence.json`).** New error families: `ERR_PRISM_ENTERPRISE_POSTGRES_CONFLICT` (outbox), `ERR_PRISM_SAGA_*`, `ERR_PRISM_FIELD_POLICY` — all additive, all fail closed. New protected env names (never values): `PRISM_TEST_POSTGRES_URL` (HA/DR/journey), `PRISM_DR_TARGET_URL` + `PRISM_PITR_URL` (DR drill). Coverage stayed above the recorded floors (policy 92.66% vs 90.78% threshold, evals 91.75% vs 87.63%, core 91.09%). **Rollback notes.** Rollback = restore the 0.2.6 manifests/tag. The two new ERP migrations (`004_erp_messaging`, `005_erp_approvals`) are forward-only; before downgrading, stop all 0.2.7 workers (outbox dispatcher, saga engine, audit exporter) and drop the `prism_erp_outbox`/`prism_erp_inbox`/`prism_erp_approvals` tables (they hold no 0.2.6 data). No 0.2.6 persisted shape changed, so an ordinary downgrade is store-safe; the added exports and ERP tables simply disappear. **"ERP production ready" remains blocked until the 0.3.0 live-service matrix is recorded** — passing 0.2.7 gates unblocks the release cut, not the 0.3.0 live-service matrix.

```bash
# Operator prerequisites recorded: clean tree at the v0.2.7 tag candidate, GPG key, npm OIDC publisher.
node scripts/release.mjs bump --from 0.2.6 --to 0.2.7   # already applied by Task 10; idempotent
npm test                                        # core + workspace suites + all script gates (incl. phase27-freeze + phase27-release + phase27-ha/erp-journey protected legs)
npm run security:threat-suites                  # phase8-11 + phase20-26 public-entry conformance
PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@127.0.0.1:54329/prism_test npm run test:postgres
node --test scripts/phase27-ha.test.mjs          # protected: real Postgres two-replica failover drill
node --test scripts/phase27-dr.test.mjs          # protected: backup/restore/PITR + 0.2.6->0.2.7 migration rehearsal (PRISM_DR_TARGET_URL + PRISM_PITR_URL)
node --test scripts/phase27-erp-journey.test.mjs  # protected: ERP release journey (8 invariant scorers)
PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@127.0.0.1:54329/prism_test npm run sdk:ready
node scripts/release.mjs gate --version 0.2.7   # plain reviewed gate at 0.2.7: version literal + additive exports only, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.7 --report /tmp/prism-0.2.7-preflight.json
npm run release:publish -- --version 0.2.7 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.7-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): the HA failover drill (real Postgres two-replica split-brain fence, idempotent outbox replay, stale-write rejection), the DR drill (pg_dump/restore + PITR + 0.2.6→0.2.7 migration rehearsal), the ERP release journey (`docs/_evidence/phase27-erp-journey.json` — 8 invariant scorers, pass/blocked/protected, never a passing skip), the protected Postgres enterprise-state legs, and the live canaries (provider OIDC/OPA, MCP, A2A, Brave — always `protected` rows in the manifest, never `pass`). The release skip manifest names every skip class with its required env; missing protected evidence records 0.2.7 as **blocked**, never a passing skip. The final evidence manifest `scripts/phase27-release-evidence.json` records commit, tool versions, test totals, coverage, timings, budgets, known limitations, and the explicit 0.3.0 blocker + pending operator sign-off.

### 0.2.5 publish handoff (plan 025 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.5** (plan 025) is the maintainability-and-bounded-performance cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.5: expected deltas are the version literal plus 105 additive internal-helper exports from the splits/dedup — 84 Task 1 cross-family helpers across `@arnilo/prism`/`prism-coding-agent`/`prism-workflows`/`prism-server`/`prism-ag-ui` and 21 `prism-session-store-codecs` helpers — zero removals; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase25-freeze-manifest.json`). Internal-only refactoring and bounded-performance work, **no runtime contract change and no migration**: (1) **god-module splits, compat-preserving** — the six remaining implementation god-modules split along cohesive boundaries into internal family files behind preserved barrels (0.1.4 precedent): `src/contracts-core.ts` (1,719 L → 10 families, max 403 L), `src/agent-session.ts` (2,049 L → 4 modules; the 1,686-L `RuntimeAgentSession` class is kept intact — a single TS class cannot span files without exporting private methods, recorded reason), `packages/workflows/src/run.ts` (1,227 L → 6 families, max 417 L), `packages/server/src/handler.ts` (1,005 L → 8 families, max 444 L), `packages/coding-agent/src/repository.ts` (974 L → 7 families, max 299 L), `packages/ag-ui/src/acp/agent.ts` (836 L → 8 families, max 386 L). No `exports` map gained a subpath; `ponytail:` comments preserved verbatim; every package verified with **zero breaking compat deltas** (`scripts/phase25-compat-diff.mjs`). (2) **persistence-mechanics dedup** — 21 pure helpers (ownership scope/assertion, checkpoint stale/encode/decode, branch cursors, lifecycle quota/reason/page-limit, search metadata/clipping, deepFreeze/string-array/throwIfAborted, feedback row mapping) moved into the dependency-free `packages/session-store-codecs` (426 → 624 L, stdlib only, no SQL dialect leakage); the adapters shrank 273 lines total (postgres 1,104 → 1,041, sqlite 1,088 → 1,010); SQL fragments, DDL templates, and query execution stay per-adapter; no persisted-shape change; cross-store conformance proves identical semantics before/after. (3) **quadratic accumulation removed** — the per-push `Buffer.concat` loops in language framing (`LspFrameReader`) and tar parsing (`summarizeTarStream`) became chunk-array readers (two-phase header parse + offset-advance `drop`, `take`/`drop` sliding window); caps and fail-closed overflow behavior byte-identical; framing measured **~100–200× faster at N=4000 chunks** (1,298.4 ms → 11.2 ms) and tar linear at 8 MiB; CLI capture (`collectOutput`) audited — already linear since plan 020; the near-limit probe `scripts/phase25-bounded-accumulation.test.mjs` (10 tests) is wired into the npm test gate segment and asserts linear copying by byte-count instrumentation. (4) **dead-code cleanup, internal-only** — the 62 `dead-exports.mjs` candidates triaged into 2 removals (`PostgresPersistenceCloseOptions`, `SqlitePersistenceCloseOptions` — internal type aliases never re-exported from their adapter indexes) + 60 allow-listed with reasons in `docs/_evidence/phase25-dead-exports-triage.md` (37 test-used false positives, 20 dead-but-compat-tracked deferred to the 0.3.0 breaking cut, 3 public type aliases deferred); the named-internal audit (`agent-session`/`cache-telemetry`/`skill-load`) recorded as clean at 0.2.4; no public export removed, so **no `docs/migration.md` removal note is required** (this section records the no-runtime-contract-delta statement instead). (5) **coverage close, behavior-backed** — 76 focused regressions (approval 43 — the untested `agent-approval.ts` resolve/validate/pending paths; conversations 22 — cursor codec + thread projection; artifacts 6 — approval-state/checkpoint-key/error codes; tool-effect-store conformance 5 — violation throws + option defaults; compaction relies on its 17 existing package suites); core coverage rose **90.53/84.20/90.54 → 91.43/84.80/91.60** lines/branches/functions (gate 60/70/75; all 39 non-protected packages above their evidence thresholds). Release graph stays **50** publishable manifests at exact **0.2.5**; zero new runtime dependency names (core remains dependency-free); 43 code packages + 6 pure-manifest family/profile.

**Measured reductions and deltas (recorded in `scripts/phase25-baseline.json` `exitGate`).** File-size/complexity: the six monoliths (totaling ~8.2 kL) split into families with max sizes 299–444 L (the 1,686-L class exception recorded); the adapters shrank 273 L (net −75 with the codecs growth). Tree-shaking/startup: no regression — root packed bytes unchanged (800,042), startup `importMs` within the 250 ms ceiling, the +30 root `fileCount` (326 → 356) is Task 1 split `dist` files (`.map` excluded) re-baselined with a dated `$comment`. Near-limit perf: framing linear at 4,000 chunks (~100–200× faster), tar linear at 8 MiB, both with byte-identical caps and fail-closed overflow. Coverage: core +0.90/+0.60/+1.06 lines/branches/functions with 76 behavior-backed tests (no line-count padding). **Rollback notes.** Rollback = restore the 0.2.4 manifests/tag. Nothing persisted changes shape, no default or behavior changed, and the only public-surface deltas are additive; downgrade is store-safe and code-safe — the only visible deltas are the version literal and the extra exports (a 0.2.4 consumer can downgrade without code changes; the added helpers simply disappear).

```bash
# Operator prerequisites recorded: clean tree at the v0.2.5 tag candidate, GPG key, npm OIDC publisher.
node scripts/release.mjs bump --from 0.2.4 --to 0.2.5   # already applied by Task 6; idempotent
npm test                                        # core + workspace suites + all script gates (incl. phase24-truth + phase25-bounded-accumulation)
npm run security:threat-suites                  # phase8-11 + phase20-24 public-entry conformance
PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@127.0.0.1:54329/prism_test npm run test:postgres   # incl. the cross-store conformance legs
PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@127.0.0.1:54329/prism_test npm run sdk:ready
node scripts/release.mjs gate --version 0.2.5   # plain reviewed gate at 0.2.5: version literal + additive exports only, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.5 --report /tmp/prism-0.2.5-preflight.json
npm run release:publish -- --version 0.2.5 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.5-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): the durable state-concurrency legs + the Task 2 **cross-store conformance** legs (Postgres `prism_phase25_*` schemas — `npm run test:postgres` under `PRISM_TEST_POSTGRES_URL`; absent credentials record **blocked** per the release skip manifest), the phase25 bounded-accumulation near-limit probe over built dist, and the live canaries (provider OIDC/OPA, MCP, A2A, Brave — always `protected` rows in the manifest, never `pass`). The release skip manifest names every skip class with its required env; missing protected evidence records 0.2.5 as **blocked**, never a passing skip.

### 0.2.3 publish handoff (plan 023 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.3** (plan 023) is the build-coverage-and-release-evidence-integrity cut on the 0.2.x review-remediation line. API surface **additive-only** (plain reviewed compat gate at 0.2.3: delta is the version literal only — no export changes; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase23-freeze-manifest.json`). Four tooling/evidence fixes, **no runtime contract change and no migration**: (1) **build serialization** — dependency-free `scripts/with-build-lock.mjs` serializes every emit/test leaf with one `O_EXCL` lockfile at `node_modules/.prism-build.lock` (pid + startedAt, read-back verified, stale-PID reclaim, `PRISM_BUILD_LOCK_TIMEOUT_MS` env override, fail-closed exit 1), so concurrent compilers can never expose a partial live `dist/`; the lock is never held by orchestrator scripts and `PRISM_BUILD_LOCK_HELD=1` prevents accidental nesting. **Caveat:** the lock only guards the wrapped leaves — a direct `tsc` invoked outside the wrapper can still race an importer, exactly like any external writer. (2) **corrected workspace coverage denominators** — workspace coverage runs use package-local `--test-coverage-include=dist/**` (imported core `dist` no longer pollutes package rows), the 60/70/75 core gate is unchanged, per-package line thresholds in `scripts/coverage-thresholds.json` are evidence-based (freeze-run minus 3 pp), env-gated durable-leg packages (`session-store-postgres`, `enterprise-postgres`, `memory`, `session-store-nats`) are `protectedException` rows shown separately, and `scripts/coverage-summary.json` is the machine-readable artifact the release gate reads. (3) **release skip manifest** — `scripts/release-skip-manifest.mjs` records every surface (`pass`/`skip`/`blocked`/`protected`, reason, required env names only) into `scripts/release-evidence.json`; a required surface with absent evidence records `blocked` and `release.mjs gate` fails closed — missing credentials/services can never convert into a green release. (4) **stabilized quality gates** — Biome 2.x `preset` config migration with zero lint diagnostics, the racy 150 ms MCP bridge timing assert replaced by a deterministic barrier, load-sensitive guards carry documented `ponytail:` ceilings, and `lint-report.sarif` + `unused-report.json` are machine-readable and CI-retained. Regression surface: `phase23-build-race` (8), `phase23-coverage` (4), `phase23-skip-manifest` (6), `phase23-quality-gates` (5), `phase23-security` (3, matrix items 4 and 12 by name) + packed plain-JS `security23.mjs` consumer. Exit gate green: npm test core + workspace + script gates, `sdk:ready` exit 0, audit 0 moderate, secret scans 0 findings, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.3, protected Postgres durable conformance evidence, release-evidence manifest with zero blocked surfaces; evidence in `scripts/phase23-baseline.json` `exitGate`. **Rollback notes.** Rollback = restore the 0.2.2 manifests/tag — but that reopens the partial-`dist` race window and the polluted coverage denominator, so prefer fixing the failing host on 0.2.3. Nothing persisted changes shape, so downgrade is store-safe. (CI remediation 2026-08-14: `coding-security` joined the `protectedException` rows — its native-sandbox legs probe `unshare --net` NETNS at load and skip on GitHub Actions runners, so the host-captured freeze threshold can never be met in CI; measured 72.80 lines in CI vs 80.18 on a NETNS-capable host.)

```bash
# Operator prerequisites recorded: clean tree at the v0.2.3 tag candidate, GPG key, npm OIDC publisher.
node scripts/release.mjs bump --from 0.2.2 --to 0.2.3   # already applied by Task 6; idempotent
npm test                                        # core + workspace suites + all script gates (incl. phase23 suites)
npm run security:threat-suites                  # phase8-11 + phase20 + phase21 + phase22 + phase23 public-entry conformance
PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@127.0.0.1:54329/prism_test npm run sdk:ready
node scripts/release.mjs gate --version 0.2.3   # plain reviewed gate at 0.2.3: version literal only, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.3 --report /tmp/prism-0.2.3-preflight.json
npm run release:publish -- --version 0.2.3 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.3-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): the durable state-concurrency legs (Postgres `prism_phase23_*` schemas for sessions/checkpoints/events + enterprise router reservations/idempotency — `npm run test:postgres` under `PRISM_TEST_POSTGRES_URL`), the phase23 public-entry build-race + coverage-denominator conformance, and the live canaries (provider OIDC/OPA, MCP, A2A, Brave — always `protected` rows in the manifest, never `pass`). The release skip manifest names every skip class with its required env; missing protected evidence records 0.2.3 as **blocked**, never a passing skip.

### 0.2.2 publish handoff (plan 022 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.2** (plan 022) is the concurrent-state-and-durability-integrity cut on the 0.2.x review-remediation line. API surface **additive-only** vs 0.2.1 (plain reviewed compat gate at 0.2.2: deltas are the version literal plus `ModelRouterStateStore.reserveBudget`/`commitBudget`/`releaseBudget`, `ModelRouterReservation`, `ModelRouterBudgets.reservationTtlMs`, `ModelRouterLimits.maxRateKeys`/`maxBudgetKeys`, `SessionRecord.version` with `appendSession` `expectedVersion`, `EventMultiplexerError`, and the `@arnilo/prism/testing/state-concurrency-conformance` subpath — no removal; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase22-freeze-manifest.json` records per-task evidence tokens). Four behavior tightenings documented in `docs/migration.md` `0.2.1 → 0.2.2`: (1) **atomic model-budget reservation** — `reserveBudget` at admission (used + reserved + requested <= window max, `{reservationId, fencingToken, admitted, retryAfterMs?}`), `commitBudget`/`releaseBudget` at outcome, TTL expiry (default 60 s) with late commits reconciled as `unknownUsage: true`; rate/budget key maps capped (4,096 default / 65,536 hard) with LRU eviction that never drops a held-reservation row; durable reservations live in a new `reservations` JSONB column (enterprise migration 003). (2) **atomic conversation metadata** — `SessionRecord.version` + `appendSession` `expectedVersion` (`0` create-only, `N>0` exact-CAS update-only, omitted = legacy last-write-wins); stale writes throw `SessionMetadataConflictError` `metadata_conflict` (versions only, HTTP 409); concurrent create/branch/archive single-statement with branch caps inside the CAS, archive wins, deleted rows never resurrect (migration 008). (3) **single-consumer EventMultiplexer** — second concurrent `subscribe()` throws `EventMultiplexerError` `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`. (4) **restart-stable NATS durable identity + bounded non-durable active-run registries** — durable name exactly `prism_<hmac16>`, crash-resume continues from the last ack, orphaned 0.2.1 random-suffixed consumers reclaimed on clean stop; workflow active-run registry sweeps aborted entries and fails closed at the 512 cap. New regression surface: `scripts/phase22-security.test.mjs` (4 blockers + gate accounting over built public entrypoints, wired into `security:threat-suites`), packed plain-JS `security22.mjs` consumer in install-smoke, the `@arnilo/prism/testing/state-concurrency-conformance` harness (7 probes; memory leg in npm test, durable legs in `test:postgres` and the NATS seam; zero timing-only sleeps), and the `scripts/phase22-conformance.test.mjs` gate in the `test:postgres` chain. Store compatibility with 0.2.1: **forward-only migrations** (008 + 003), see `docs/migration.md` for rollback risk. Exit gate green: npm test core + workspace + script gates (incl. phase21-freeze done-phase + phase22 conformance), `sdk:ready` exit 0, audit 0 moderate, secret scans 0 findings, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.2, protected OIDC/OPA evidence + durable state-concurrency evidence; evidence in `scripts/phase22-baseline.json` `exitGate`. Rollback = restore the 0.2.1 manifests/tag — but that reopens all four race windows, so prefer fixing the failing host on 0.2.2.

```bash
# Operator prerequisites recorded: clean tree at the v0.2.2 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates (incl. phase22 conformance)
npm run security:threat-suites                  # phase8-11 + phase20 + phase21 + phase22 public-entry conformance
npm run sdk:ready                               # typecheck, lint, format, test, coverage, pack, release:gate
node scripts/release.mjs gate --version 0.2.2   # plain reviewed additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.2 --report /tmp/prism-0.2.2-preflight.json
npm run release:publish -- --version 0.2.2 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.2-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): live OIDC JWKS through the default pinned path (`createOidcIdentityVerifier` against a real public IdP — real DNS/TLS/JWKS document, e.g. `https://login.microsoftonline.com/common/discovery/v2.0/keys`, success proven by a key-lookup miss after a 200 fetch), live OPA (dockerized `openpolicyagent/opa`, default pinned path fails closed `ssrf_denied`), and the durable state-concurrency legs (Postgres `prism_phase22_*` schemas for sessions/checkpoints/events + enterprise router reservations/idempotency, NATS restart-durable resume against the seam). Missing protected evidence records 0.2.2 as **blocked**, never a passing skip.

### 0.2.1 publish handoff (plan 021 Task 8)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.1** (plan 021) is the provider-completion and outbound-trust-boundaries cut on the 0.2.x review-remediation line. API surface **additive-only** vs 0.2.0 (plain reviewed compat gate at 0.2.1: the only deltas are the version literal and `@arnilo/prism-mcp` transport helpers `boundResponse`/`defaultResolver`/`isLoopbackAddress`/`isLoopbackHostname`/`normalizeHostname`/`raceAbort`/`requestPinned`/`resolvePinnedAddress` becoming re-exports of the lifted core primitives — same names/signatures, no removal; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase21-freeze-manifest.json` machine-checks each task's diff and the preserved surface). Five documented security-motivated behavior tightenings in `docs/migration.md` `0.2.0 → 0.2.1`: (1) **strict stream completion is the shared default** (`strictCompletion: true` in `createOpenAICompatibleProvider`; explicit `false` stays the documented opt-out; truncated streams fail `ProviderTransportError` `incomplete_delta` instead of a successful `providerDone`; applies to Azure/Bedrock/Vertex/OpenRouter/ZAI/NeuralWatt); (2) **bounded success bodies** — additive `readBoundedResponseJson` (65,536-byte ceiling, depth 32, properties 4096, shape gate, abort, redacted errors, `response_body_shape` code) replaces unbounded `response.json()` on all ten model-discovery sites plus NeuralWatt quota, Alibaba embeddings, OpenAI uploads, and both OAuth success paths; (3) **DNS-pinned OIDC JWKS/OPA/content fetch, redirects rejected** — core `pinnedFetch` (one resolve, 1–32 bound, per-candidate SSRF validation, pinned-lookup socket) serves the default JWKS, OPA decision, and content/media paths; 3xx fails `MediaContentError` `redirect`; private/metadata/loopback fails `ssrf_denied`; MCP re-exports the lifted helpers byte-identically; (4) **shared bounded OAuth device/token polling** — core `pollDeviceCodeToken` serves provider-openai and credentials-node with equivalent cadence/backoff/redaction; (5) **edge fixes** — Azure/Vertex credential-once, Bedrock duplicate-case/repeated-query SigV4 canonicalization, OpenAI upload failed-DELETE retention, cache `__overflow__` tokens-only. New regression surface: `scripts/phase21-security.test.mjs` (10 conformance tests over built public entrypoints, wired into `security:threat-suites`) and a packed plain-JS `security21.mjs` consumer in install-smoke. Store compatibility with 0.2.0: **compatible, no migration**. Exit gate green: npm test core + script gates (incl. phase21-freeze done-phase), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.1, live OIDC JWKS + live OPA protected evidence; evidence in `scripts/phase21-baseline.json` `exitGate`. Rollback = restore the 0.2.0 manifests/tag — but rollback restores the five boundary gaps, so hosts should disable truncated-stream acceptance, unbounded-body endpoints, redirect-following fetches, rotating-credential reuse, and upload cleanup at their own boundary if rollback is unavoidable.

```bash
# Operator prerequisites recorded: clean tree at the v0.2.1 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates
npm run security:threat-suites                  # phase8-11 + phase20 + phase21 public-entry conformance
npm run sdk:ready                               # typecheck, lint, format, test, coverage, pack, release:gate
node scripts/release.mjs gate --version 0.2.1   # plain reviewed additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.1 --report /tmp/prism-0.2.1-preflight.json
npm run release:publish -- --version 0.2.1 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.1-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): live OIDC JWKS through the default pinned path (`createOidcIdentityVerifier` against a real public IdP — real DNS/TLS/JWKS document, e.g. `https://login.microsoftonline.com/common/discovery/v2.0/keys`, success proven by a key-lookup miss after a 200 fetch) and live OPA (`docker run -p 127.0.0.1:8181:8181 openpolicyagent/opa run --server`, push a policy, then prove the default pinned path fails closed `ssrf_denied` against the real server; decision-success behavior is covered by the built public conformance suite since the pinned path refuses private addresses by design). Missing protected evidence records 0.2.1 as **blocked**, never a passing skip.

### 0.2.0 publish handoff (plan 020 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.0** (plan 020) is the first cut of the 0.2.x review-remediation line — fail-closed runtime and sandbox security. API surface **additive-only** vs 0.1.7 (plain compat gate at 0.2.0: 0 breaking declaration deltas — the three blockers are behavior tightenings, not removals; `containmentClaim` retained deprecated; baseline text regenerated with `--update-baseline`, no `--allow-break` anywhere; freeze manifest `scripts/phase20-freeze-manifest.json` machine-checks each task's diff stayed inside its allowed files). Shipped: (1) **durable-resume input validation** — `assertValidAgentRunResume` at the top of `prepareAgentRunResume` covers all four public resume entrypoints; unknown legacy decisions (`"sideways"`), malformed batches, oversized reasons/elicitation, duplicate approval ids fail closed `ERR_PRISM_DECISION_*` with zero checkpoint writes/tool calls (server parser stays defense in depth); (2) **work-tool environment isolation** — `createCliRunner` children get a fixed base allow-list + explicit env + forced HOME/telemetry controls + late-bound per-identity tokens, 64-name/64-KiB caps `ERR_PRISM_WORK_ENV`, absolute binary/configDir, linear output capture; (3) **explicit sandbox capabilities** — `SandboxAdapter.capabilities` (six immutable booleans, omission/malformed ⇒ all false), composition capabilities from verified wiring, `containmentClaim` deprecated as the conservative projection; Docker reports only verified controls, native reports filesystem/process/privilege false; docs/coding-security.md capability table, docs/host-security.md authorization guidance. New regression surface: `scripts/phase20-security.test.mjs` (public built entrypoints, wired into `security:threat-suites`), packed plain-JS consumer regressions in install-smoke, and the sandbox-browser workflow's fail-loud 0.2.0 blocker gate recording Docker/native capability evidence — **0.2.0 does not ship while any blocker is skipped**. Store compatibility with 0.1.7: **compatible, no migration** (no persisted-shape change; `docs/migration.md` `0.1.7 → 0.2.0` section). Exit gate green: npm test core + script gates (incl. phase20-freeze done-phase), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.0, Docker daemon + native netns protected evidence; evidence in `scripts/phase20-baseline.json` `exitGate`. Rollback = restore the 0.1.7 manifests/tag — but rollback restores the three defects, so hosts should disable resume side effects and work-tool execution at their own boundary if rollback is unavoidable.

```bash
# Operator prerequisites recorded: clean tree at the v0.2.0 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates
npm run security:threat-suites                  # phase8-11 + phase20 public-entry conformance
npm run sdk:ready                               # typecheck, lint, format, test, coverage, pack, release:gate
node scripts/release.mjs gate --version 0.2.0   # plain reviewed additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.0 --report /tmp/prism-0.2.0-preflight.json
npm run release:publish -- --version 0.2.0 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.0-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): `docker info` + digest-pinned image (e.g. `PRISM_TEST_DOCKER_SANDBOX=1 PRISM_TEST_DOCKER_BIN=/usr/bin/docker PRISM_TEST_DOCKER_IMAGE=ubuntu@sha256:... npm test -w @arnilo/prism-coding-tools/security -- --test-name-pattern "protected Docker"`) and native netns capability (`unshare --net` / `--net --map-root-user` must succeed; T9 native capability test runs, not skips). The sandbox-browser workflow fails loudly when this evidence is missing.

### 0.1.7 publish handoff (plan 019 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.7** (plan 019) is the performance-and-DX patch on the frozen 0.1.x line — **additive-only** vs 0.1.6 (plain compat gate at 0.1.7 passed with 0 breaking declaration deltas; the baseline text was regenerated with `--update-baseline` for the version literal only, no `--allow-break` anywhere; freeze manifest `scripts/phase19-freeze-manifest.json` machine-checks each task's diff stayed inside its allowed files). Shipped: (1) **prompt-cache telemetry surface** — dependency-free `createCacheTelemetry()` aggregator in core, host-activated, per-provider/model request counts + aggregate hit rate + cache-read/write token totals + estimated savings, bounded cardinality (cap 256 distinct keys, `__overflow__` bucket), token counters/rates only (never prompt content, cache keys, or identity), O(1) `record()`; (2) **model-router selection policies** — additive `ModelRouterSelectionPolicy` on `createModelRouter` (default ordered behavior byte-identical) with the reference `createCostLatencySelection` ranking by `ModelCost` then in-memory latency EMA fed from `recordOutcome({ latencyMs })`, permutation-only reorder of already-allowed candidates, misbehavior fails closed `ERR_PRISM_MODEL_ROUTER_POLICY`; (3) **async AgUiProjection closeout** — plan 009 Task 15 surface verified with evidence (`asyncHooks: {verified: true, gapFound: false}` in `scripts/phase19-baseline.json`), no new code; (4) **`prism providers add <name>` scaffold** — new CLI subcommand generating an OpenAI-compatible provider package (manifest, provider via `createOpenAICompatibleProvider`, starter models, cache helpers, offline conformance test, docs stub) with npm-name/traversal/symlink-escape validation and placeholders only — never secrets; scaffold output is host-chosen and never auto-registered. Store compatibility with 0.1.6: **compatible, no migration** (additive-only; no persisted-shape change; `docs/migration.md` gains no entries). Exit gate green: npm test core + script gates (incl. phase19-freeze done-phase), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical, budget/benchmark gates green; evidence in `scripts/phase19-baseline.json` `exitGate`. Rollback = restore the 0.1.6 manifests/tag.

```bash
# Operator prerequisites recorded: clean tree at the v0.1.7 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates
npm run sdk:ready                               # typecheck, lint, format, test, pack, release:gate
node scripts/release.mjs gate --version 0.1.7   # plain additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.7 --report /tmp/prism-0.1.7-preflight.json
npm run release:publish -- --version 0.1.7 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.7-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.7 -m "Prism 0.1.7 — performance and DX (additive)"
git verify-tag v0.1.7
git push origin v0.1.7        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

### 0.1.6 publish handoff (plan 018 Task 7)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.6** (plan 018) is the coding-agent capability-closeouts patch on the frozen 0.1.x line — **additive-only** vs 0.1.5 (plain compat gate at 0.1.6 passed with 0 breaking declaration deltas; the baseline text was regenerated with `--update-baseline` for the version literal only, no `--allow-break` anywhere). Five demand-gated closeouts shipped, each flipped to `demanded` by named demand evidence (operator `arn` for native-sandbox/doc-reader/delete-glob/checkpoint-bodies, a consuming-app user for acp-session-store) before its task landed; the demand-gate registry (`scripts/phase18-freeze-manifest.json`) machine-checks demanded ⇒ implemented, deferred ⇒ untouched. Shipped: (1) **durable ACP session store** — `@arnilo/prism-ag-ui` `AcpSessionStore` host seam (`save`/`loadAll`/`evict`), persisted `{sessionId, ownership, modeId, configValues, cwd, additionalDirectories, updatedAt}`, lazy ownership-scoped restore, fail-closed drops, absent seam = 0.1.5 behavior; (2) **network-free native sandbox** — `createNativeSandbox` in `@arnilo/prism-coding-security` (fresh netns per command via the OS `unshare` binary, chained ulimits with `|| exit 126`, argv-only exec, cwd containment, process-group kill, env allow-list, Linux-only fail-closed); (3) **bounded PDF/Office document reader** — new optional package `@arnilo/prism-document-reader` (the 50th manifest, graph 49 → 50) with optional `pdf-parse`/`mammoth` peers fail-closed at creation, magic-byte gating, null fall-through, caps + redaction at the adapter boundary; (4) **recursive delete + brace-expanding glob** — per-call `recursive: true` with fan-out cap and symlink-unlink-not-follow, host-selected/per-call `braceExpansion` bounded to 128 alternatives / 4096 expanded bytes, fail-closed on overflow/malformed braces; (5) **checkpoint persistence for loaded-skill bodies** — opt-in `includeSkillBodies` on run + resume options (names-only stays default, 0.1.3 shapes byte-identical), ≤64 bodies / ≤256-char names / ≤262144-byte bodies / ≤1 MiB total, `maxStateBytes` refusal, redacted at rest, registry-independent resume render. Store compatibility with 0.1.5: **compatible, no migration** (additive-only; no persisted-shape change; `docs/migration.md` gains no entries). Exit gate green: npm test core 1,433/1,433 + 190 script gates (incl. phase18-freeze done-phase), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical, budget/benchmark gates green; evidence in `scripts/phase18-baseline.json` `exitGate`. Rollback = restore the 0.1.5 manifests/tag.

```bash
# Operator prerequisites recorded: clean tree at the v0.1.6 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates
npm run sdk:ready                               # typecheck, lint, format, test, pack, release:gate
node scripts/release.mjs gate --version 0.1.6   # plain additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.6 --report /tmp/prism-0.1.6-preflight.json
npm run release:publish -- --version 0.1.6 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.6-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.6 -m "Prism 0.1.6 — coding-agent capability closeouts (additive)"
git verify-tag v0.1.6
git push origin v0.1.6        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.6 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.6` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.6` is store-compatible with `0.1.5` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback. The next line **0.1.7** continues the frozen 0.1.x additive promise; the 0.2.0 module line (delegated agents, agent-owned persistence, host-owned seam expansions) is the next documented cut.

### 0.1.5 publish handoff (plan 017 Task 4)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.5** (plan 017) is the **documented breaking cut** on the frozen 0.1.x line — deprecated-option removal, with the removed-symbols list, replacements, before/after examples, dynamic-config refusal behavior, store compatibility, and rollback in the top `docs/migration.md` `0.1.4 → 0.1.5` section. Removed: `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs` (inert in first-party providers; abort/retry lives at the host layer — replacements `RunOptions.signal`/`AgentConfig.retry`/`RunOptions.retry`), `RunOptions.maxToolRounds` (→ `limits.maxToolRounds`; CLI `--max-tool-rounds` unchanged), `ObservationalMemorySettingsInput` pre-0.0.19 flat keys and top-level `workerProvider`/`workerModel` aliases (→ nested `observation`/`reflection`/`dropper` configs; `sessionModel` fallback unchanged), `ReadToolOptions.autoResizeImages` (→ `transformImage`), and `INIT_PROVIDERS` (→ `listInitProviders()`). Every removal **fails closed** for untyped callers with a `TypeError` naming the replacement before any provider call, tool call, filesystem access, compaction, or session append. Compat baselines were regenerated only after the reviewed `--allow-break` break report: `arnilo__prism.txt` (removed `INIT_PROVIDERS` const + `maxToolRounds`/provider-knob member lines — interface members are not baseline text, so the delta is the `INIT_PROVIDERS` line), `arnilo__prism-coding-agent.txt` (`autoResizeImages` is an interface member — baseline delta limited to statement/re-export text if any), `arnilo__prism-compaction-observational-memory.txt` (flat keys and worker aliases are interface members — no baseline line delta expected). Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.5**. Store compatibility with 0.1.4: **compatible, no migration** (removed options were inert aliases; nested replacements resolve to the same active values; `DEFAULT_RUN_LIMITS.maxToolRounds` 8 / hard cap 64 unchanged); zero new dependencies (lockfile name-set unchanged).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.5 --report /tmp/prism-0.1.5-preflight.json
npm run release:publish -- --version 0.1.5 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.5-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.5 -m "Prism 0.1.5 — documented breaking cut: deprecated-option removal"
git verify-tag v0.1.5
git push origin v0.1.5        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.5 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.5` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.5` is store-compatible with `0.1.4` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the cut without a database rollback; code/config using removed keys must be migrated first (removed keys fail closed on 0.1.5).

### 0.1.4 publish handoff (plan 016 Task 6)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.4** (plan 016) is the internal god-module split, compat-preserving on the frozen 0.1.x line: `src/agents.ts` and `src/contracts.ts` reorganized by concern behind barrel re-exports (`contracts-core`/`contracts-run-state`/`contracts-protocol`; `agent-session`/`agent-run-lifecycle`/`agent-approval`/`agent-tool-dispatch` reusing `agent-run-state`/`agent-loops`/`compaction`) with a **byte-identical public entry surface** (0 added/0 removed/0 changed vs the 0.1.3 baseline; the 14 additive union-surface helpers are internal cross-module exports, not consumer-importable — deviation #1), measured tree-shaking improvement (111,049 → 982 B `dist/agents.js`, 9,420 → 418 B `dist/contracts.js`, module count 64 → 70; evidence in `scripts/phase16-baseline.json`), and additive **`@arnilo/prism-browser` Chrome DevTools Protocol capabilities** (Tasks 4-5): `browser_evaluate`, `browser_observe`, `block_urls`/`unblock_urls`/`throttle`/`emulate` act actions, and `{ css }`/`{ xpath }` targets on Chromium hosts — 41 added / 0 removed / 18 changed declaration texts (15 re-export-statement artifacts + 3 optional-member/signature widenings), the documented deviation #2 carve-out; root `arnilo__prism.txt` regenerated with zero breaking deltas. Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.4**. Store compatibility with 0.1.3: **compatible, no migration**; zero new dependencies (lockfile name-set unchanged).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.4 --report /tmp/prism-0.1.4-preflight.json
npm run release:publish -- --version 0.1.4 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.4-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.4 -m "Prism 0.1.4"
git verify-tag v0.1.4
git push origin v0.1.4        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.4 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.4` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.4` is store-compatible with `0.1.3` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback. The next line, **0.1.5**, is the documented breaking cut (deprecated-option removal) with its removed-symbols list landing in `docs/migration.md`.

### 0.1.3 publish handoff (plan 015 Task 5)


**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.3** (plan 015) is the dead-code and deprecation hygiene patch on the frozen 0.1.x line: one parameterized benchmark runner `scripts/benchmark.mjs --scenario <name>` replaces the per-version runners (16 orphaned `benchmark-0.0.{8..16}` runner/test files removed, evidence JSON kept; the CI schema leg runs `scripts/benchmark.test.mjs`), the 12 `docs/review-coverage-2026-07-*.md` evidence files moved to the tarball-excluded `docs/_evidence/` archive, a non-blocking unused-code sweep (`npm run sweep:unused` — tsc `noUnusedLocals`/`noUnusedParameters` over core + all workspace tsconfigs plus a zero-dep dead-export scan; always exits 0, report to `scripts/unused-sweep-report.txt`), and opt-in checkpoint persistence (`persistSessionState: true` on durable run/resume options — loaded-skill name catalog ≤64 names rides the run-state checkpoint and restores on resume, bodies re-resolve from the live registry; `createReadPathSetPersistence` in `@arnilo/prism-coding-agent` persists the read-before-write path set through the host `CheckpointStore`, ≤1024 paths, ownership-scoped). Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.3**. Store compatibility with 0.1.2: **compatible, no migration**; declaration surface additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.3 with zero breaking deltas).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.3 --report /tmp/prism-0.1.3-preflight.json
npm run release:publish -- --version 0.1.3 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.3-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.3 -m "Prism 0.1.3"
git verify-tag v0.1.3
git push origin v0.1.3        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.3 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.3` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.3` is store-compatible with `0.1.2` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback.

### 0.0.28 publish handoff (historical)


**Decision: GO after protected operator prerequisites below.** Release **0.0.28** (Phase 11, plan 011) ships the optional enterprise adapter seams: OIDC/JWKS identity verification (`@arnilo/prism-credentials-node/oidc`), OPA policy evaluation into the durable ledger (`@arnilo/prism-policy/opa`), MCP OAuth client/server support (`@arnilo/prism-mcp`), host-selected OpenAPI operations as effect-gated tools (`@arnilo/prism-openapi-tools`), and an S3-compatible artifact body store behind the new core body contract (`@arnilo/prism-server/artifact-bodies`). Every seam is opt-in and fail-closed; hosts that wire none keep exact prior behavior. Publishable graph stays **49** publishable manifests (root + 48 workspace packages; `prism-openapi-tools` joined the graph in this release). See [migration](../migration.md) `0.0.27 → 0.0.28`.

```bash
git diff --check
npm ci
npm run sdk:ready
node --test scripts/phase11-conformance.test.mjs
node scripts/benchmark-0.0.28.mjs > scripts/benchmark-0.0.28.json
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate -- --version 0.0.28 --allow-break --allow-dirty --allow-untagged
npm run release:check -- --version 0.0.28 --allow-dirty --allow-untagged --report /tmp/prism-0.0.28-preflight.json
npm run release:publish -- --version 0.0.28 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.28-dry-run.json
git tag -s v0.0.28 -m "Prism 0.0.28"
git verify-tag v0.0.28
git push origin v0.0.28
```

### 0.0.27 publish handoff


**Decision: GO after protected operator prerequisites below.** Release **0.0.27** (Phase 10, plan 010) ships complete ACP coding-host interop in `@arnilo/prism-ag-ui/acp`: seam-based capability advertisement, session persistence, modes/config overlays, client fs/terminal adapters, MCP select gate, `CodingLifecycleEvent` → ACP update mapping, four-outcome approvals with elicitation, and frozen caps. Publishable graph stays **48** manifests. See [migration](../migration.md) `0.0.26 → 0.0.27` and [ACP coding-host interop](../acp.md).

```bash
git diff --check
npm ci
npm run sdk:ready
node --test scripts/phase10-conformance.test.mjs
node scripts/benchmark-0.0.27.mjs > scripts/benchmark-0.0.27.json
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate -- --version 0.0.27 --allow-break --allow-dirty --allow-untagged
npm run release:check -- --version 0.0.27 --allow-dirty --allow-untagged --report /tmp/prism-0.0.27-preflight.json
npm run release:publish -- --version 0.0.27 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.27-dry-run.json
git tag -s v0.0.27 -m "Prism 0.0.27"
git verify-tag v0.0.27
git push origin v0.0.27
```

### 0.0.24 publish handoff


**Decision: GO after protected operator prerequisites below.** Release **0.0.24** (Phase 7, plan 007) ships durable `AgentEventSource`, recoverable `ToolEffectStore`, AG-UI 0.0.57 compatibility, and AG-UI MCP/MCP Apps/A2A fronting. Publishable graph stays **47** manifests. Core remains dependency-free; PostgreSQL event source and enterprise `toolEffects` stay opt-in. Delivery is at-least-once — not exactly-once. See [migration](../migration.md) `0.0.23 → 0.0.24` and [tool effects](../tool-effects.md).

```bash
git diff --check
npm ci
npm run sdk:ready
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" node scripts/benchmark-0.0.24.mjs > scripts/benchmark-0.0.24.json
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate
npm run release:check -- --version 0.0.24 --allow-dirty --allow-untagged --report /tmp/prism-0.0.24-preflight.json
npm run release:publish -- --version 0.0.24 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.24-dry-run.json
git tag -s v0.0.24 -m "Prism 0.0.24"
git verify-tag v0.0.24
git push origin v0.0.24
```

### 0.0.23 publish handoff


**Decision: GO after protected operator prerequisites below.** Release **0.0.23** (Phase 6, plan 006) adds `@arnilo/prism-enterprise-postgres`, the optional PostgreSQL composition for policy decisions, evaluation records, work-mutation claim/CAS state, and cross-replica model-router rate/budget/circuit state. The publish graph is **47 manifests** (41 code + 6 family/profile; +1 package). `@arnilo/prism-all` includes it; core remains dependency-free. See [migration](../migration.md#0022--0023-production-enterprise-state-adapters-intentional-pre-10-contract-changes) and [enterprise PostgreSQL state](../enterprise-postgres-state.md).

Intentional pre-1.0 migration points: work idempotency now uses `begin`/CAS transitions and never automatically replays `unknown`; durable router state requires awaited methods plus verified identity and disables `providerSource`. Policy/evaluation/work/router data remain opt-in. No Redis, queue, event delivery, exactly-once effect claim, worker, migration CLI, ORM, or new core API ships.

```bash
git diff --check
npm ci
npm run sdk:ready
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" node scripts/benchmark-0.0.23.mjs
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate
npm run release:check -- --version 0.0.23 --allow-dirty --allow-untagged --report /tmp/prism-0.0.23-preflight.json
npm run release:publish -- --version 0.0.23 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.23-dry-run.json
git tag -s v0.0.23 -m "Prism 0.0.23"
git verify-tag v0.0.23
git push origin v0.0.23
```

`npm publish --dry-run` is non-publishing and applies `publishConfig.access`; the real protected tag workflow is the only publication path, with provenance and resume report. It must run the PostgreSQL suite using a protected, disposable database URL. The recorded benchmark is local/CI comparison evidence, not a portable SLO. npm publication is immutable: a partial publish resumes from the same tag; a confirmed defect requires deprecation plus a fixed version.

### 0.0.22 publish handoff


**Decision: GO after protected operator prerequisites below.** Release **0.0.22** (Phase 5 third-party behavior integrations, plan 005) ships `@arnilo/prism-caveman` and `@arnilo/prism-ponytail` as opt-in behavior packages (upstream Caveman/Ponytail wiring, session mode persistence, progressive disclosure + injector split). Core `@arnilo/prism` runtime is unchanged. The publish graph is **46 manifests** (+2). No intentional pre-1.0 breaks for hosts that do not install the new packages — see [migration](../migration.md) under `0.0.21 → 0.0.22 third-party behavior integrations`.

```bash
git diff --check
npm ci
npm run sdk:ready
node --test scripts/budget-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate
npm run release:check -- --version 0.0.22 --allow-dirty --allow-untagged --report /tmp/prism-0.0.22-preflight.json
npm run release:publish -- --version 0.0.22 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.22-dry-run.json
git tag -s v0.0.22 -m "Prism 0.0.22"
git verify-tag v0.0.22
git push origin v0.0.22
```

### Historical release handoffs


Release-specific migration detail lives in [migration](../migration.md). The current handoff plus the retained protected matrix below supersede 0.0.16–0.0.21 command transcripts.

### Release-integrity evidence matrix (0.0.18 → 0.1.0)


Phase 12 Task 2 (plan 012) closes roadmap defect #4: every release from 0.0.18 onward has a signed tag or a **documented publication-evidence pointer**. Tags below were created as lightweight refs (no GPG signature was available in this environment); each release therefore carries a documented evidence pointer: the roadmap phase completion evidence, benchmark JSON, conformance suite, and/or migration section that records what shipped. The 0.1.0 cut requires the **signed** tag + provenance publication procedure (operator action, see [0.1.0 readiness](0.1.0-readiness.md) "Remaining for 1.0").

| Release | Tag | Evidence pointer |
| --- | --- | --- |
| 0.0.18 | `v0.0.18` (lightweight, at `f627752`) | Roadmap Phase 1 completion evidence; `docs/migration.md` `0.0.17 → 0.0.18`; docs tripwire Phase 1 |
| 0.0.19 | `v0.0.19` (lightweight, at `7574e50`) | Roadmap Phase 2 completion evidence; migration `0.0.18 → 0.0.19` |
| 0.0.20 | `v0.0.20` (lightweight, at `b2cdb2e`) | Roadmap Phase 3 completion evidence; migration `0.0.19 → 0.0.20` |
| 0.0.21 | **no tag** | Roadmap Phase 4 completion evidence (workspace 0.0.21 / 44 manifests, sdk:ready green); migration `0.0.20 → 0.0.21` |
| 0.0.22 | `v0.0.22` (lightweight, at `f9902ed`) | Roadmap Phase 5 completion evidence; 0.0.22 publish handoff above; migration `0.0.21 → 0.0.22` |
| 0.0.23 | `v0.0.23` (lightweight, at `1401b6b`) | Roadmap Phase 6 completion evidence; 0.0.23 publish handoff above; `scripts/benchmark-0.0.23.json`; migration `0.0.22 → 0.0.23` |
| 0.0.24 | `v0.0.24` (lightweight, at `55c4b0e`) | Roadmap Phase 7 completion evidence; 0.0.24 publish handoff above; `scripts/benchmark-0.0.24.json`; `scripts/phase7-conformance.test.mjs`; migration `0.0.23 → 0.0.24` |
| 0.0.25 | `v0.0.25` (lightweight, at `24d7ac0`) | Roadmap Phase 8 completion evidence; `scripts/benchmark-0.0.25.json`; `scripts/phase8-conformance.test.mjs`; migration `0.0.24 → 0.0.25` |
| 0.0.26 | `v0.0.26` (lightweight, at `77fac7e`) | Roadmap Phase 9 completion evidence; `scripts/benchmark-0.0.26.json`; `scripts/phase9-conformance.test.mjs`; migration `0.0.25 → 0.0.26` |
| 0.0.27 | `v0.0.27` (lightweight, at `9d49625`) | Roadmap Phase 10 completion evidence; `scripts/benchmark-0.0.27.json`; `scripts/phase10-conformance.test.mjs`; migration `0.0.26 → 0.0.27` |
| 0.0.28 | **no tag (HEAD is 0.0.28 scope)** | Roadmap Phase 11 completion evidence; 0.0.28 publish handoff above; `scripts/benchmark-0.0.28.json`; `scripts/phase11-conformance.test.mjs`; migration `0.0.27 → 0.0.28` |
| 0.1.0 | `v0.1.0` **signed** (operator action at publication) | Phase 12 plan 012 records; `node scripts/release.mjs publish --version 0.1.0 --dry-run --allow-untagged` semantics verified (dry-run proceeds untagged; real publication refuses `--allow-untagged`/`--allow-dirty`) |

Machine check: `git tag --points-at <commit>` and the roadmap phase completion blocks above are the evidence trail; `node scripts/release.mjs check --version 0.1.0` validates the exact version graph at bump time (plan 012 Task 7).

### 0.0.15 protected live-canary matrix


Default `npm test`, `npm run sdk:ready`, and `benchmark-0.0.15` are network-free. Run live rows only from a protected scheduled/release environment (or an explicitly authorized operator workstation); never place credentials in fixtures, benchmark JSON, pull-request jobs, or package scripts. Use least-privilege keys, one bounded request, and retain only redacted aggregate status. A blank **checked-in gate** means Prism deliberately has no generic credential fixture: host owns that provider/account compatibility probe.

| Surface | Gate and credential | Checked-in/protected command | Canary scope |
| --- | --- | --- | --- |
| OpenAI Responses baseline | `PRISM_LIVE_PROVIDER_TESTS=1` + `OPENAI_API_KEY` | `npm test -w @arnilo/prism-providers/openai` | Bounded text/tool/abort smoke; key never enters events. |
| OpenAI hosted tools + Realtime | `OPENAI_API_KEY`; protected release harness additionally supplies host-owned safety identifier and hosted-tool entitlement | No generic fixture; record result with the release evidence | Provider-hosted `web_search`/similar execution and Realtime audio/interruption need account-specific availability, so fake transport coverage remains default gate. |
| AI SDK adapter | Host-selected AI SDK v4 model factory plus its provider credential | No generic fixture; run host integration in protected release environment | Exact `@ai-sdk/provider@4.0.10` mapping/version check; Prism does not own upstream model credentials. |
| Kimi / Moonshot | `PRISM_LIVE_PROVIDER_TESTS=1` + `KIMI_API_KEY` | `npm test -w @arnilo/prism-providers/kimi` | Coding route; Moonshot entitlement is account-specific. |
| Z.AI | `PRISM_LIVE_PROVIDER_TESTS=1` + `ZAI_API_KEY` | `npm test -w @arnilo/prism-providers/zai` | GLM stream/tool/reasoning smoke. |
| OpenRouter | `PRISM_LIVE_PROVIDER_TESTS=1` + `OPENROUTER_API_KEY` | `npm test -w @arnilo/prism-providers/openrouter` | Routed stream/model metadata smoke; host chooses permitted route. |
| OpenCode Go | `PRISM_LIVE_PROVIDER_TESTS=1` + `OPENCODE_API_KEY` | `npm test -w @arnilo/prism-providers/opencode-go` | OpenAI/Anthropic route selection smoke. |
| Hyper | `PRISM_LIVE_PROVIDER_TESTS=1` + `HYPER_API_KEY` | `npm test -w @arnilo/prism-providers` | Dual-route text/tool/abort smoke + warm-prefix/messages-cache/reasoning-effort probes; bounded to cheap models (plan 055 Task 3). |
| Command Code | `PRISM_LIVE_PROVIDER_TESTS=1` + `COMMAND_CODE_API_KEY` | `npm test -w @arnilo/prism-providers` | Dual-route text/tool/abort smoke + cache/ZDR/reasoning probes; bounded to cheap models (plan 055 Task 5). |
| Alibaba DashScope | Alibaba least-privilege API key | No generic fixture; host compatibility probe in protected release environment | Region/preset/catalog entitlement varies; offline serializer and catalog tests remain default gate. |
| Ollama Cloud/local | Cloud API key or host-local authenticated endpoint | No generic fixture; host compatibility probe in protected release environment | Cloud account and local daemon/model availability are host-owned; no daemon starts during Prism tests. |
| NeuralWatt | `PRISM_LIVE_PROVIDER_TESTS=1` + `NEURALWATT_API_KEY` | `npm test -w @arnilo/prism-providers/neuralwatt` | Stream/retry/quota telemetry smoke. |
| Anthropic | `PRISM_LIVE_PROVIDER_TESTS=1` + `ANTHROPIC_API_KEY` | `npm test -w @arnilo/prism-providers/anthropic` | Restricted one-turn provider smoke. |
| Google | `PRISM_LIVE_PROVIDER_TESTS=1` + `GOOGLE_API_KEY` or `GEMINI_API_KEY` | `npm test -w @arnilo/prism-providers/google` | Restricted one-turn provider smoke. |
| Memory PostgreSQL/pgvector | `PRISM_TEST_POSTGRES_URL` with `vector` extension | `npm run test:postgres -w @arnilo/prism-memory` | Shared memory conformance, export/rebuild pagination, and finite-vector boundary. |

The scheduled/manual `live-canaries` workflow uses protected environment `live-canaries`; release validation uses its protected release environment. Neither workflow receives a broad workspace key. A successful offline benchmark is never evidence that a live row ran; each protected invocation must record its enabled matrix rows and skipped/missing prerequisites.

### Historical release notes


Older 0.0.10–0.0.15 handoffs are summarized in [migration](../migration.md); historical 43-package evidence remains there. The publishable package catalog includes `@arnilo/prism-providers/alibaba`, `@arnilo/prism-providers/ollama`, and `@arnilo/prism-session-store-codecs`; current publication uses the 47-manifest handoff above.

### Supported and measured


| Dimension | Supported | Measured evidence |
| --- | --- | --- |
| Node | 20, 24 (`engines.node >=20`) | `release.yml`: `verify` runs SDK readiness on Node 24; `node20-compat` builds and imports every public root export on Node 20. Docs examples need Node >=22.6 native TypeScript stripping. Node 22 is engines-supported but not measured in CI at freeze. |
| PostgreSQL | 16 | `release.yml` `postgres-integration` job with image `pgvector/pgvector:pg16`; driver `pg@^8.22.0`; schema version 6. The pgvector extension is required only by the `@arnilo/prism-memory` path. Range claims beyond 16 need an added protected leg before they may be documented. |
| Platform | linux-x64 | Every CI leg runs on `ubuntu-latest` (x64). All other OS/arch combinations are untested: run `npm run sdk:ready` on the target platform before production adoption. |
| Providers | all `@arnilo/prism-providers/<adapter>` subpaths plus the OpenAI-compatible transport | Per-package conformance suites in the default network-free `npm test`; live canaries stay credential-gated (`PRISM_LIVE_PROVIDER_TESTS=1`). |
| Protocol SDKs | exact pins below | MCP 38-test suite, AG-UI/ACP/A2A protocol conformance, NATS JetStream event-source conformance. |

| Package | Frozen pin |
| --- | --- |
| `@modelcontextprotocol/client` | `2.0.0` |
| `@modelcontextprotocol/server` | `2.0.0` |
| `@agentclientprotocol/sdk` | `1.3.0` |
| `@ag-ui/core` | `0.0.59` |
| `@nats-io/jetstream` | `^3.4.0` |
| `@nats-io/transport-node` | `^3.4.0` |

### Unsupported combinations


- Node below 20 (engines floor).
- PostgreSQL server majors outside the supported list (only 16 measured at freeze).
- ACP v2 experimental APIs — stable v1 only.
- Cedar policy engine — OPA adapter only.
- Redis/Kafka queues or backplanes — PostgreSQL and NATS JetStream event sources only.
- Forges beyond GitHub.
- Object stores beyond the S3-compatible reference adapter.
- Remote-browser vendors, hosted cloud, Studio/control plane, and channel catalogs (Phase 13 demand-gated).

### Security-support boundary


Audit fixes, dependency updates, and security patches land only for the supported lines above. The 0.1.0 audit target is moderate-or-higher (`releasePolicy.auditLevelTarget` in the freeze manifest); since plan 012 Task 6 both `security.yml` and the `release.yml` supply-chain job enforce `npm audit --audit-level=moderate` (0 vulnerabilities at every severity recorded for the 0.1.0 tree). Unsupported combinations receive no fixes. Supply-chain gates are listed in [host security](../host-security.md).

### 0.0.12 release-candidate verification — 2026-07-22


| Gate | Result |
| --- | --- |
| Package graph | Root + 34 workspaces = 35 publishable manifests at exact `0.0.12`; `@arnilo/prism-ag-ui` is public and reached only through `@arnilo/prism-all`. |
| Protocol and compaction | AG-UI root/`./acp`, core streamed durable resume, and coding compaction import from packed offline consumer; `benchmark-0.0.12` schema passed. |
| SDK readiness | `npm run sdk:ready` passed: typecheck, network-free tests, offline install/export checks, and 35 package dry-run packs. |
| Compatibility and supply chain | Node 20.20.2 imported every core export; audit found 0 high findings (2 moderate MCP-transitive advisories); SPDX/license check covered 192 packages/8 effective licenses. `@ag-ui/core@0.0.59` is an exact MIT override because its published metadata omits `license` while its shipped LICENSE is MIT; other `NOASSERTION` entries still fail. 963 present tracked files had 0 secret findings. |
| Registry/order | Public `release:check` found all 35 `@arnilo/*@0.0.12` versions available. Dependency-ordered `release:publish --dry-run --allow-dirty --allow-untagged` completed 35/35 with explicit public/latest/provenance; no commit, tag, or publication was created. |

A deleted tracked feature-request markdown was intentionally not restored by release work; resolve it before a clean checkout runs the workflow's literal `git ls-files` secret-scan command. Protected live gates, signed tag, OIDC, and actual publication remain operator prerequisites.

### 0.0.11 dependency audit decision (2026-07-22)


`npm audit --audit-level=high` reports 0 vulnerabilities and `npm ls --all --depth=0` resolves the exact 34-package `0.0.11` graph (including `@arnilo/prism-providers/anthropic`, `@arnilo/prism-providers/google`, and `@arnilo/prism-browser`). Locked-install SPDX and `scripts/verify-sbom.mjs` pass. Browser keeps `playwright-core@1.61.0` as an optional peer and ships no browser binary/image; no Office package/binary enters the graph. Host mode never claims disposable containment.

### 0.0.11 release-candidate verification — 2026-07-22


| Gate | Result |
| --- | --- |
| Package graph | Root + 33 workspaces = 34 publishable manifests at exact `0.0.11` with exact internal peer/dependency ranges; Anthropic/Google in `@arnilo/prism-providers` and transitively `@arnilo/prism-all`. |
| Coding harness P1 | SessionIndex/search, contextBudget, steer, ask_user_decision, runCodingGoalVerify; schema v4 FTS migration; `benchmark-0.0.11` search/budget schema green. |
| Providers | Native Anthropic + Google packages offline-conformant; live gates remain `PRISM_LIVE_PROVIDER_TESTS=1` + host keys. |
| SDK readiness | `npm run sdk:ready`: 2,047 tests (2,014 pass / 33 skip / 0 fail); pack 1,041,760 / 4,041,551 / 889 files; core 549,565 / 1,938,287 / 253. |
| Registry/order | Public `release:check` found all 34 `@arnilo/*@0.0.11` versions available. Dependency-ordered `release:publish --dry-run --allow-dirty --allow-untagged` completed 34/34 dry-run with explicit public/latest/provenance; no commit, tag, or publication created. |
