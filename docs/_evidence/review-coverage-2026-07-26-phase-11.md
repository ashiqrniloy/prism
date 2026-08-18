# Phase 11 (0.0.16) Review Coverage — Primitive, Duplication, and Adoption Freeze

Frozen: 2026-07-26. Input to Plan 079 Tasks 1–4 and 8. Rule: extract/delete
only entries below; candidates with <2 real consumers are marked DO-NOT-EXTRACT.

## 1. Baseline metrics (2026-07-26, working tree at 0.0.15)

- Publishable manifests: **43** (root + 42 workspaces).
- Root `@arnilo/prism`: **659,478 packed / 2,310,686 unpacked / 281 files**.
- Root startup `import('./dist/index.js')`: **≈38 ms** (cold process, dev box).
- Aggregate packed bytes (all 43): **≈1,284 kB** (sum of dry-run sizes below).
- Benchmark medians (`scripts/benchmark-0.0.15.mjs`, 100 iterations each, network-free, 0 backpressure / 0 resource-limit signals):

| Scenario | throughput/s | p50 ms | p95 ms | mem bytes |
|---|---|---|---|---|
| openai-hosted-continuation | 5,386.0 | 0.1317 | 0.2907 | 15,442,224 |
| openai-realtime-envelope | 880.3 | 1.1293 | 1.2399 | 12,079,536 |
| ai-sdk-v4-stream-mapping | 22,403.0 | 0.0230 | 0.0734 | 14,836,824 |
| provider-package-metadata | 55,829.2 | 0.0065 | 0.0394 | 16,065,952 |
| rag-parse-replace-rerank-retrieve | 4,800.3 | 0.1432 | 0.4064 | 13,945,384 |
| memory-retention-export-rebuild | 8,763.2 | 0.0686 | 0.1892 | 14,030,704 |

These are the Task 8 budget baseline; regressions fail beyond tolerance.

### Per-manifest packed/unpacked/files (dry-run)

| Package | packed | unpacked | files |
|---|---|---|---|
| @arnilo/prism | 659,478 | 2,310,686 | 281 |
| coding-agent | 84,664 | 372,278 | 54 |
| workflows | 38,714 | 191,585 | 40 |
| browser | 31,439 | 142,700 | 34 |
| server | 32,624 | 169,483 | 26 |
| memory | 25,418 | 112,903 | 34 |
| coding-security | 25,835 | 109,459 | 26 |
| session-store-postgres | 24,374 | 122,075 | 24 |
| supervisor | 23,881 | 112,357 | 26 |
| mcp | 23,637 | 102,512 | 26 |
| session-store-sqlite | 23,438 | 118,936 | 22 |
| credentials-node | 20,950 | 88,681 | 36 |
| provider-openai | 18,241 | 70,965 | 20 |
| ag-ui | 18,214 | 76,661 | 28 |
| rag | 17,815 | 73,372 | 32 |
| work-tools | 17,092 | 86,151 | 24 |
| compaction-observational-memory | 17,091 | 77,588 | 46 |
| provider-neuralwatt | 16,750 | 62,915 | 18 |
| evals | 15,930 | 67,816 | 34 |
| provider-opencode-go | 14,286 | 57,007 | 18 |
| provider-kimi | 12,774 | 51,937 | 16 |
| provider-openrouter | 11,449 | 40,024 | 16 |
| compaction-llm | 11,158 | 40,553 | 24 |
| web-tools | 10,636 | 40,094 | 22 |
| provider-anthropic | 9,135 | 34,184 | 16 |
| provider-zai | 9,090 | 34,369 | 12 |
| provider-ai-sdk | 9,013 | 32,509 | 16 |
| provider-alibaba | 8,546 | 30,939 | 12 |
| policy | 8,524 | 34,512 | 22 |
| provider-google | 8,442 | 31,291 | 14 |
| observability-opentelemetry | 7,786 | 29,349 | 8 |
| model-router | 7,419 | 28,372 | 14 |
| provider-ollama | 6,821 | 22,917 | 10 |
| tool-validator-json-schema | 5,232 | 17,621 | 8 |
| provider-bedrock | 4,652 | 12,933 | 10 |
| provider-azure | 3,529 | 9,547 | 8 |
| provider-vertex | 3,186 | 8,281 | 8 |
| prism-all | 1,838 | 5,101 | 3 |
| prism-providers | 1,598 | 5,087 | 3 |
| prism-compaction | 1,261 | 3,377 | 3 |
| prism-code | 1,206 | 2,998 | 3 |
| prism-sdk | 1,152 | 2,969 | 3 |
| prism-base | 1,149 | 2,882 | 3 |

## 2. Hotspot files — cohesive domains and consumers

| File | Lines | Cohesive domain candidates | Consumers (≥2 = extract) | Decision |
|---|---|---|---|---|
| `src/contracts.ts` | 2,041 | limits, ownership, events, tools, stores, credentials, content types | root index + nearly every package via `@arnilo/prism` | EXTRACT by domain into `src/contracts/*.ts` + facade; pure types/values only |
| `src/agents.ts` | 1,455 | agent creation, secure composition, run wiring, steering | root index, server, examples | EXTRACT creation vs secure-composition vs run-wiring |
| `packages/workflows/src/run.ts` | 1,279 | limit accounting, node dispatch, suspend/resume CAS, approval contains-check | workflows index, coding-agent goal-verify | EXTRACT limit accounting + dispatch; keep CAS in run |
| `packages/server/src/handler.ts` | (route hub) | conversations, artifacts, replay, drain, health already split into siblings | server index | SPLIT remaining monolith routes into existing sibling modules; no new package |
| `packages/session-store-{sqlite,postgres}/src/persistence.ts` + `row-mappers.ts` | 409+409 row-mappers | row codecs, migration catalog, lifecycle | both stores | SHARE codecs (see §3); keep engine DDL separate |

DO-NOT-EXTRACT (single consumer or already cohesive): `src/content.ts` media
bounds (one owner), `src/cli-init.ts`/`src/cli-runner.ts` (CLI-only),
`packages/server/src/{health,drain,replay}.ts` (already split).

## 3. Confirmed duplication — survivor table

| Duplicate | Locations (evidence) | Survivor | Parity test required | Security-sensitive |
|---|---|---|---|---|
| `resolveRedactor` | `packages/workflows/src/checkpoint-core.ts:27`, `packages/evals/src/util.ts:62`, `packages/memory/src/util.ts:88`, `packages/rag/src/util.ts:40` — 4 near-identical copies | one shared helper in existing core redaction module (`src/redaction.ts`) re-exported for packages | yes: identical resolution on undefined/custom/redacted fixtures | yes — redaction |
| `cleanJson` (provider compat cleanup) | local `function cleanJson` in each `packages/provider-*/src/models.ts` (kimi:285, openai:192, + 8 others) | provider-primitives shared helper (existing shared-transport package) | yes: golden output per provider compat block | no |
| Row codecs | `session-store-sqlite/src/row-mappers.ts` (409 L) vs `session-store-postgres/src/row-mappers.ts` (409 L) | one codec module shared via existing `@arnilo/prism/testing/persistence-schema` seam or a small shared module in an existing persistence package | yes: round-trip edge rows (nulls, unicode, big ints, timestamps) both engines | no |
| Checkpoint logic | `src/checkpoints.ts` (165), `session-store-sqlite/src/checkpoints.ts` (175), `session-store-postgres/src/checkpoints.ts` (145), `workflows/src/checkpoint-core.ts` (160), `workflows/src/checkpoints.ts` (215) | core contract stays; store copies reduce to engine SQL over shared codec; workflows keeps CAS-specific core | yes: CAS/fencing decisions identical | yes — ownership/fencing |
| Executable runner | `execFile` in `coding-agent/src/git-exec.ts`, `coding-security/src/{docker-sandbox,sandbox-fs-operations,sandbox}.ts`; `spawn` in `work-tools/src/cli.ts` | one bounded argument-array runner in `coding-security` (owns containment); work-tools keeps spawn only if streaming NDJSON requires it (record decision) | yes: timeout/abort/kill/arg-injection fixtures | yes — process/containment |
| Path containment (FS) | survivor `packages/coding-security/src/path-containment.ts` (`isPathInside`, `isPathInsideReal`, `assertPathInsideRoots`) | keep; core `src/node/*` + `src/cli-*.ts` use policy-level checks, NOT duplicated FS containment (initial grep overcount — verified) | n/a (no real core copy) | yes |
| Origin/network containment | `packages/browser/src/network.ts`, `packages/browser/src/uploads.ts` | distinct domain (URL origin, not FS); DO-NOT-MERGE with FS containment | keep separate tests | yes |
| Approval logic | `coding-security/src/approval.ts`, workflows run/replay, `src/artifacts.ts`, `src/devices.ts` | shared approval *types* in core; decision engines stay domain-specific (coding vs workflow vs artifact) — extract only the record shape | yes: record shape parity | yes — approvals |
| Cursor encode/decode | store-specific cursors in sqlite/postgres search + policy/audit export | shared opaque-cursor helper only if ≥3 call sites converge after codec share; otherwise DO-NOT-EXTRACT | conditional | no |
| Ownership key/projection | `src/identity.ts`, `src/checkpoints.ts`, store checkpoints | core `identity.ts` survivor; stores consume | yes: projection fixtures | yes — tenancy |

## 4. Profile adoption evidence and recommendation

Internal graph: profiles depend on packages; **no package or example imports a
profile** (examples import concrete packages, e.g. `@arnilo/prism-compaction-llm`).
Docs mention profiles in 10+ pages (install guidance). External registry
dependent counts are an operator lookup at Task 4 (recorded here as pending).

| Profile | Deps | Role | Recommendation |
|---|---|---|---|
| `prism-all` | 19 | everything incl. browser/ag-ui/work-tools/policy/router/cloud | RETAIN as canonical umbrella; only place browser/work-tools live |
| `prism-providers` | 11 | all 11 provider adapters | RETAIN (docs/install recipes rely on it; enrollment point for new providers) |
| `prism-sdk` | 5 | base + credentials + mcp + otel + workflows | RETAIN if registry dependents >0, else recipe |
| `prism-code` | 4 | base + coding-agent + coding-security + mcp | RETAIN (coding-harness persona entry) |
| `prism-base` | 3 | prism + compaction profile + validator | MERGE-CANDIDATE: only consumed by prism-code/prism-sdk; recipe = 3 installs |
| `prism-compaction` | 2 | llm + observational-memory | RETIRE-CANDIDATE: examples already import concrete packages; recipe = 2 installs |

Decision rule for Task 4: retire when (a) zero external registry dependents AND
(b) recipe ≤3 concrete installs. `prism-compaction` meets (b) now; `prism-base`
meets (b). Confirm (a) with operator registry query before deletion; otherwise
keep with deprecation notice.

## 5. Tarball artifact diet findings

- Root `files` ships **all of `docs/`**: 108 docs files including **11 `review-coverage-*.md`** totaling **283,022 bytes** of historical review content in every root tarball.
- Workspace packs are clean (`dist` minus tests/maps + README/CHANGELOG); profiles pack README/CHANGELOG only.
- Task 1 deny list must block `docs/review-coverage-*` (and any future `plans/`, `code-reviews/`, `bug-reports/`, `scripts/benchmark-*` — none currently packed) from root tarball; keep canonical `docs/` pages shipped.
- Estimated root tarball saving from review exclusion alone: ≈283 kB unpacked (≈4% of 2.31 MB unpacked; larger share of packed bytes since markdown compresses poorly relative to minified JS — measure in Task 8).

## 6. Freeze statement

Tasks 1–4 and 8 may act only on entries in §2–§5. New extraction/deletion
targets discovered during implementation require a dated addendum to this file
before code changes. Baseline numbers in §1 are the budget reference.

## Addendum 2026-07-26 — Task 2 hotspot extraction re-graded DO-NOT-EXTRACT

Per the freeze rule, Task 2 implementation inspected all four hotspots against
the ≥2-consumer rule. Result: the qualified set is empty. Evidence:

| Hotspot | Inspection result | Decision |
|---|---|---|
| `src/contracts.ts` (2,041 L) | Flat type + section-bound constant catalog (33 const/fn exports bound to adjacent types, e.g. search limits with search types); 62 internal importers all use the module as one contract surface. Splitting yields facade-only churn, zero deletion, zero consumer benefit. | DO-NOT-EXTRACT |
| `src/agents.ts` (1,455 L) | Only 4 public exports (`createAgent`, `createAgentSession`, `resumeAgentRun`, `resumeAgentRunStream`); external modules (`secure-agent.ts`, `agent-run-lifecycle.ts`, `agent-definitions.ts`) import exactly those. ~20 private helpers are single-consumer; `createUsageAccumulator`/merge* not duplicated anywhere. | DO-NOT-EXTRACT |
| `packages/workflows/src/run.ts` (1,279 L) | 4 public exports + private scheduler internals; not imported by path outside the package index. Run-limit accounting already centralized in `src/run-limits.ts` (0.0.7) — no live duplication to extract toward. | DO-NOT-EXTRACT |
| `packages/server/src/handler.ts` (757 L) | Schedule routes (lines ~87–145) share 10 private request helpers (`ownedSignal`, `readJsonObject`, `readRequiredId`, `readPositiveInteger`, `readOptionalObject`, `readScheduleStatus`, `sameOwnership`, …) with workflow/agent/conversation routes (21 shared-helper use sites). Existing siblings (`conversations.ts`, `artifacts.ts`, `replay.ts`) split stateful services, not routes. Moving schedule routes requires a helper-module refactor touching every route block — net churn exceeding the 58-line win. | DO-NOT-EXTRACT |

The §2 "EXTRACT" grades are superseded by this addendum. Task 2's structural
intent is instead satisfied by: (a) the Task 1 compat gate freezing the public
surface these files export, and (b) Task 3 deleting the confirmed §3
duplication into shared survivors. The plan's Task 2 acceptance criterion
"files shrink" conflicts with its own "only domains with ≥2 consumers" rule;
the constraining rule wins (recorded in plan Compromises).

## Addendum 2026-07-26 (2) — Task 3 duplication cluster verdicts

Per the freeze rule, each §3 duplication cluster was inspected before action.
Two clusters consolidated, three declined with evidence:

| Cluster | Verdict | Evidence |
|---|---|---|
| `resolveRedactor` (plan: ×4) | **CONSOLIDATED** → `src/redaction.ts`, exported from `@arnilo/prism` | 4 copies confirmed (workflows/checkpoint-core, evals/util, memory/util, rag/util); 3 identical `(redactor?, secrets?)`, 1 options-shaped. Workflows call site adapted to the shared signature. Not publicly exported from any package index → deletion non-breaking; new root export `resolveRedactor` added to `FROZEN_VALUE_EXPORTS` deliberately. |
| Row codecs (plan: sqlite/postgres) | **CONSOLIDATED** → new `@arnilo/prism-session-store-codecs` | `session-store-{sqlite,postgres}/src/row-mappers.ts` were 409 L each, 97% identical — complete diff = 6 hunks, all the `redacted` boolean representation (SQLite INTEGER vs Postgres BOOLEAN). Shared `createSessionRowMappers<R>(codec)` factory; sqlite injects `{encode: b => b?1:0, decode: v => v===1}`, postgres identity. Both 409-L files deleted; 16/16 sqlite + 6/6 postgres roundtrip tests green through the shared codecs. Package is an internal implementation detail: not enrolled in `prism-all`/families. |
| `cleanJson` (plan: ×10) | **DO-NOT-CONSOLIDATE** | 9 live copies (not 10), each a private one-liner in standalone provider packages that share zero first-party code by design (independent installability). 7 strip `undefined`; neuralwatt + openrouter strip `undefined` **and `null`** — a deliberate wire-shape difference per OpenAI-compatible API quirk. The plan's survivor `provider-primitives` does not exist; creating a package + 9 dependency edges to share a one-liner with semantic variants is net complexity. Duplication-by-design at a trust/isolation boundary. |
| Checkpoint codecs (plan: ×5, 860 L) | **ALREADY CONSOLIDATED** | Single source `packages/workflows/src/checkpoint-core.ts` (`prepareCheckpointRecord`, `parseCheckpointValue`) consumed by the checkpoint adapters; the "5 copies" were JSON.stringify/parse call sites, not codec functions. Stale Task 0 count. |
| Executable runners (plan: ×5) | **DO-NOT-CONSOLIDATE** | Each `spawn` site encodes distinct security invariants: docker container argv (`docker-cli.ts`), git argv allowlist `SAFE_GIT_CONFIG_ARGS` ("never invokes a shell", `git-exec.ts`), shell policy/rendering (`coding-agent/shell.ts`), and the `SandboxExecRequest` adapter boundary (`sandbox.ts`) which is already the abstraction (git-exec is documented to swap onto it). A common runner would be a lowest-common-denominator that dilutes per-domain hardening. Security-boundary code; strongest skip case. |

Net: 2 of 5 clusters consolidated (the two with genuine mass and a clean seam),
818 duplicated lines deleted (2 × 409 row mappers), 4 private `resolveRedactor`
copies removed. Graph 43 → 44 manifests; all tripwire assertions (frozen export
surface, packaging list, install-smoke, release graph, docs counts, plans
index) updated deliberately and green (1286/1286 root tests).

## Addendum 2026-07-26 (3) — Task 4 profile decisions: all six RETAIN

Task 0 reported `prism-compaction` and `prism-base` as "zero dependents".
That measurement grepped code imports; profiles are manifest-only packages
(no code, never imported in `src`). Re-measured against manifest dependency
edges, docs, and examples, every profile is load-bearing in the composition
DAG. Decision: **retain all six**, zero retirements.

| Profile | Workspace dependents | Docs / examples | Bundles | Decision |
|---|---|---|---|---|
| `prism-all` | — (top umbrella, by design) | 8 docs | code + sdk + providers + 16 optional packages | **RETAIN** — the one-command install; exact-family pinned by packaging tests |
| `prism-code` | prism-all | 4 docs | base + coding-agent + coding-security + mcp | **RETAIN** — coding-product profile |
| `prism-sdk` | prism-all | 5 docs | base + credentials-node + mcp + otel + workflows | **RETAIN** — application-server profile |
| `prism-base` | prism-code, prism-sdk | 1 doc | core + compaction + tool-validator-json-schema | **RETAIN** — shared base of both product profiles; retiring would duplicate its 3 deps into code and sdk |
| `prism-compaction` | prism-base | 9 docs, 4 examples | compaction-llm + compaction-observational-memory | **RETAIN** — highest doc/example adoption of any profile; standalone recipe added |
| `prism-providers` | prism-all | 3 docs | all 11 first-party providers | **RETAIN** — provider umbrella |

The composition is a clean layered DAG (`all → {code, sdk, providers, …}`,
`code/sdk → base → compaction`); no node is removable without moving its
dependencies up (churn, not reduction). Optional packages (`web-tools`,
`browser`, `ag-ui`, `work-tools`) stay outside the code/sdk profiles —
enforced by the packaging test's exact-family assertions, which remain green
under retain-all (no manifest changes).

Install recipes already exist in `docs/release-and-install.md` (one
`npm install` line per profile + optional packages); the only gap was a
standalone `prism-compaction` recipe, added. Task 0's adoption table is
corrected by this addendum.

## Addendum 2026-07-26 (4) — Task 5 test hygiene

**Sub-part A (phase tests) — DONE.** All 12 `src/__tests__/phaseNN-*.test.ts`
(1,062 L) deleted. Every genuine invariant preserved, deduplicated, and renamed
into three behavior/invariant files (no test name asserts "phase N did X"):

- `core-boundaries.test.ts` — source/contract scans: no provider-specific
  literals in core (was triplicated across phase11/12/12-primitives → 1), no
  consuming-app imports/mentions (was 7× across phase24/27/28/29/
  30/31/32 → 1), zero core runtime deps, no first-party provider import, no
  default observational-memory, generic cache kinds, domain-vocabulary scans on
  every anchored contract seam (resolver/loop/artifact/event/injector/
  system-prompt/validators), InstructionContribution carries no privilege
  fields, AGENTS.md/SYSTEM.md isolated to loader+CLI, prompt modules import no
  node builtins.
- `package-setup-boundaries.test.ts` — provider packages set up network-free and
  register auth; compaction-llm and observational-memory set up inert (no
  provider invocation during setup).
- `contribution-security-boundaries.test.ts` — injectors grant no other
  contribution kinds, cannot dispatch unregistered tools, cannot bypass the
  validator, their output is redacted in requests/events, and honor only
  instructions/contextBlocks/when/predicate; the prompt-file loader never
  executes discovered content and honors trust gating + redaction.

Redundant assertions deleted (not converted): export-presence text greps
(subsumed by the stricter `FROZEN_VALUE_EXPORTS` snapshot in
`public-export-contract.test.ts`), docs-index-link checks (subsumed by
`docs.test.ts` apiPages), package exports/files-minimal checks (subsumed by
`packaging.test.ts`), docs/fixtures secret scans (subsumed by
`scripts/scan-secrets.mjs` + docs.test), and live-test-text hygiene checks
(subsumed by the supply-chain live-canary policy test). Full suite green at
1312/1312 after the change.

**Sub-part B (docs.test reduction) — evidence: already at target, no reduction.**
`docs.test.ts` is 2,851 L / 501 assertions, of which 735 are
`readFileSync`+`.includes` structural link/phrase tripwires — i.e. it is already
"link/structure assertions", the acceptance target. The prose lives in the docs
pages; docs.test asserts the pages carry the right links/phrases/counts. These
tripwires are the release-safety backbone (package counts, handoff phrases,
`sdk:ready` composition, plans index, frozen export surface — six of them were
exercised by Task 3 alone). Blanket reduction would delete release safety for no
coverage gain; sub-part A's removal of the phase-test docs-link duplicates
confirms docs.test is the canonical survivor, not a reduction target. No change.
Upgrade trigger: if a specific assertion proves redundant with a stronger gate,
delete that one assertion (not the file).

**Sub-part C (archive plans/reviews) — evidence: benefit pre-empted, deferred.**
The stated performance benefit ("archive reduces packed artifact content") is
already delivered by the Task 1 tarball deny list, which excludes `plans/`,
`code-reviews/`, and `docs/review-coverage-*` from every published tarball
(verified: root pack ships 0 review files). Moving 78 completed plans + 12
reviews into `plans/archive/` is repo-tidiness only, with real reference-repair
cost (`docs.test.ts:222` counts plans in `plans/`, "plans index links every
plan" iterates it, `plans/README.md` links each). Deferred as churn with no
artifact benefit. Upgrade trigger: if the plans/ directory itself becomes a
navigation problem, archive with a `docs/reviews-index.md` and repair the three
coupled assertions in the same change.

## Addendum 2026-07-26 (5) — Task 6 formatting / linting / coverage

**Tooling (smallest that holds):** one binary — **Biome 2.5.5** — covers both
lint and format (rejected the ESLint+Prettier multi-plugin stack). Coverage uses
**Node's built-in** `--experimental-test-coverage` with the native
`--test-coverage-{lines,functions,branches}` threshold flags, which exit
non-zero below the minimum — so the coverage gate is **zero custom code** (no
parser, no third-party service). Single root `biome.json`, workspaces inherit;
`@biomejs/biome@^2.5.5` is dev-only and exact-pinned in `package-lock.json`.

**Wiring:** `lint`, `format`, `format:check`, `test:coverage` scripts added;
`sdk:ready` now runs `typecheck → lint → format:check → test → test:coverage →
pack:dry-run → release:gate`. Thresholds: lines 60 / functions 70 / branches 75
(baseline ≈ 64 / 72 / 79 on the core suite). Added ≈ 20s to `sdk:ready`
(lint+format ~1s, coverage ~19s) — under the 60s budget.

**Getting existing code to pass:** `biome check --write --unsafe` normalized 620
files (the acceptance's sanctioned "dedicated format commit"); 17 residual
genuine errors were hand-fixed and 7 rules disabled as documented domain false
positives (control-char regexes and `while((m=re.exec()))` loops in security
code, the workflow DSL `then` field, `noExplicitAny`, etc.). Build and the full
suite stayed green at every step.

**Negative fixtures:** `scripts/tooling-gate.test.mjs` (4 tests, wired into
`npm test`) proves biome rejects a lint error and an unformatted file, accepts a
clean file, and that the coverage threshold flags + `sdk:ready` wiring are
present.

**Deviations (recorded):** (1) coverage scope is the core suite, not all
workspaces — keeps the gate fast and the number meaningful; extend later. (2)
Biome's union/long-line wrapping cannot be config-matched to the prior
hand-formatting, so the repo was normalized to Biome rather than fighting the
formatter. Upgrade triggers: raise the 60/70/75 thresholds as the baseline
climbs; re-enable disabled rules individually with real fixes; extend coverage
to workspaces if the core-only scope stops being representative.

## Addendum 2026-07-26 (6) — Task 7 dependency major-upgrade isolation

**Matrix run for real, both legs.** Installed Node 20.20.2 (LTS iron) via nvm
next to current Node 24.18.0 and verified first-hand:

- **Node 24.18.0** — full `npm run sdk:ready` green (1312/1312, lint 0, format
  clean, coverage 64/72/79 vs 60/70/75).
- **Node 20.20.2** — `tsc` 7.0.2 and `biome` 2.5.5 both run; all 21 root
  `exports` default targets import cleanly (the `node20-compat` smoke); full
  core suite 1311/1312. The lone failure is
  `examples_demos_run_to_completion_and_emit_no_secret`, which executes
  `examples/*.ts` via Node's native TypeScript stripping (Node 22.6+) — a
  test-harness capability, not an SDK runtime incompatibility, and the precise
  reason CI scopes Node 20 to build + import smoke. **No dependency/runtime gap
  on Node 20.**

**Upgrade surface (lockfile-resolved):** dev `typescript` 7.0.2 / `@types/node`
26.1.1 / `@biomejs/biome` 2.5.5; runtime `diff` 9.0.0, `pg` 8.22.0,
`better-sqlite3` 12.11.1, `ajv` 8.20.0, `zod` 4.4.3, `@napi-rs/keyring` 1.3.0,
`@modelcontextprotocol/sdk` 1.29.0, `@ag-ui/core` 0.0.57,
`@agentclientprotocol/sdk` 1.3.0. Core `@arnilo/prism` has zero runtime deps
(asserted by `core-boundaries.test.ts`).

**Documented** in `docs/release-and-install.md` § "Dependency major-upgrade
isolation": the isolation rule (a major bump ships as its own commit/PR with
`sdk:ready` + packed-install evidence, never bundled in a feature release), the
upgrade-surface table, the recorded matrix, the CI enforcement (`verify` Node 24
/ `node20-compat` Node 20 / `supply-chain` audit+SBOM / `publish` needs all
legs), and a 7-step major-upgrade PR checklist.

**No new suite** — the matrix revealed no gap (acceptance: add one only if it
does). The full-suite-on-Node-20 run was diagnostic only and is not claimed as a
supported gate. Upgrade-surface resolved versions are a 2026-07-26 snapshot;
refresh with the lockfile.

## Addendum 2026-07-26 (7) — Task 8 size/startup/benchmark budgets + artifact diet

**Budget fixture + two-layer gate.** `scripts/budgets.json` records measured
baselines + tolerance: root packed 575,680 B / unpacked 2,043,402 B / 270 files
(+5%); aggregate packed 1,217,694 B across 44 manifests (reference only, +10%);
startup `import('./dist/index.js')` ~38 ms baseline with a 250 ms non-flaky
ceiling; and the six network-free scenario medians (0.0.15 baseline, ±25%).

- **Fast gate (every `npm test`)** — `scripts/budget-gate.test.mjs` re-packs the
  root tarball (`npm pack --dry-run --json`) and fails beyond +5% on
  packed/unpacked/file count or above the startup ceiling; validates the
  fixture schema; negative fixtures prove an inflated pack / halved throughput /
  above-ceiling startup each fail. Shared helpers in `scripts/budget-gates.mjs`.
- **Release evidence runner** — `scripts/benchmark-0.0.16.mjs` re-measures pack
  + startup, **spawns `benchmark-0.0.15.mjs`** for the six medians (reused
  unchanged — 0.0.16 added no performance-affecting code), compares all 22
  checks to the fixture, prints the report, exits non-zero on regression.
  Verified **22/22 pass**.

**Benchmark-history consolidation (finding, no code move):** the per-release
`scripts/benchmark-0.0.*.mjs` history never shipped in artifacts — root `files`
is `dist`/`docs`/`templates`/`CHANGELOG.md` only, zero `scripts/` entries packed.
The acceptance's "archived out of artifacts" condition was already satisfied, so
no archive move was needed; `benchmark-0.0.16.mjs` consolidates current evidence
behind one budget-gating runner.

**Artifact diet (from Task 1):** dropping `docs/review-coverage-*.md` (11 files,
283,022 B) took the root tarball from 659,478 / 2,310,686 / 281 (0.0.15) to the
budgeted ≈575,680 / 2,043,402 / 270.

**Docs + tripwire:** `docs/performance.md` § "Release 0.0.16 performance budgets
and artifact diet" (budget table, diet finding, measured evidence, how-to-run);
`docs.test.ts` tripwire asserts that section + the four budget scripts + the
`npm test` wiring. Full suite green (docs.test 105/105, script gates 14/14,
lint + format clean).

**Deviations (recorded):** the gate test is `scripts/budget-gate.test.mjs`
(matches the `scripts/*.test.mjs` gate pattern, avoids a TS↔.mjs boundary); the
six timing medians are gated by the on-demand runner, not CI, because timing is
machine-dependent (codebase convention: evidence, not CI timing gates) — the
deterministic artifact-size gate is the hard CI tripwire; aggregate pack size is
reference-only (43 extra `npm pack` calls are too slow for a unit gate).

## Addendum 2026-07-26 (8) — Task 9 documentation consolidation

**`docs/migration.md`** gained a top "0.0.15 → 0.0.16 simplification, shared
survivors, and release gates (additive, pre-release)" section covering every
consumer-facing change from Tasks 1–4 and 8: the additive `resolveRedactor`
export from `@arnilo/prism` (placeholder example only — no real secrets), the
new internal `@arnilo/prism-session-store-codecs` package (44th manifest, not
family-enrolled), the explicit `cleanJson` DO-NOT-CONSOLIDATE rationale (nine
private one-liners with real wire-shape variants), all six profiles **retained
with zero retirements** (Task 0's "zero dependents" was a manifest-only
measurement error; profiles form a layered DAG), the new standalone
`prism-compaction` install recipe, the smaller root tarball
(659,478 → ≈575,680 packed, 281 → 270 files) + `npm run release:gate`, and the
`scripts/budgets.json` budget gate. The 0.0.6 → 0.0.16 chain is navigable.

**`docs/public-contracts.md`** added `resolveRedactor(redactor?, secrets?)` to
the public-helper enumeration. No retired-package entries to remove (zero
retirements); the page states no manifest count; the internal codecs package is
deliberately not a public-contract surface.

**`docs/index.md`** needed no edit: the Phase 11 review doc is already indexed,
there are no retired entries to delete, and the link checker is green.

**Changelogs:** all **44** manifests (root + 43 packages) received a
`## [0.0.16] - 2026-07-26` entry — substantive for the affected packages (root;
evals/memory/rag/workflows `resolveRedactor` dedup; session-store-sqlite/postgres
codec move) and the convention boilerplate for the rest. Staged ahead of Task 10's
version bump because `release.test.ts` enforces a current-version changelog
section on every publishable package.

**Examples:** `npx tsc -p examples --noEmit` passes. **Verification:** release.test
7/7, docs.test 105/105 (reduced per Task 5, in `sdk:ready`), full `npm test` green,
format:check + lint clean.

**Deviations (recorded):** "retired package entries removed" did not trigger
(Task 4 retired nothing); per-package changelogs were applied to all 44 manifests
(not only "affected") because `release.test.ts` requires a current-version section
on every publishable package — unaffected ones get the one-line boilerplate.

## Addendum 2026-07-26 (9) — Task 10 exact 0.0.16 graph, release gates, final verification

**Exact graph.** All 44 publishable manifests, internal ranges, lockfile
workspace entries, the runtime `version` export, all 44 changelogs, and profile
compositions target exact `0.0.16`. The bump flipped the current-version
tripwires (`index.test.ts`, `packaging.test.ts`, `install-smoke.test.ts`,
`release.test.ts`, and the ten per-package `packages/*/src/__tests__/index.test.ts`
peer/range asserts); historical Phase-9/10 tripwires, changelogs, migration
prose, and `benchmark-0.0.15.mjs` were left intact. `release:check --version
0.0.16` passes (exact versions/ranges/lockfile/access + registry-collision check).

**sdk:ready green (RC=0):** typecheck (workspace build at 0.0.16 + examples
`tsc --noEmit`), lint 0, format clean, full `npm test`, coverage 63.72/79.34/71.73
vs 60/70/75 (passed), pack:dry-run (root 579.2 kB / 2.1 MB / 270 files, within the
+5% budget), release:gate 0 breaks/0 errors. `release:publish --version 0.0.16
--dry-run` validated all 44 in dependency order (44/44 dry-run, no failures).

**Security/supply-chain (local):** `git diff --check` clean; scan-secrets
3095 files / 0 findings; verify-sbom 188 packages / 8 licenses; `npm audit
--audit-level=high` rc=0 (2 moderate, 0 high).

**Two root-cause fixes surfaced by the bump:**
1. *Stale dist:* 12 `dist/__tests__/phaseNN-*.test.js` artifacts (deleted from
   `src` in Task 5, never pruned — `tsc` keeps stale outputs) still pinned 0.0.15
   and failed. Clean `rm -rf dist` + rebuild fixed it (dist 85 == src 85).
2. *Compat baseline drift:* the Task 1 `scripts/compat-baseline/` snapshots
   diffed order-only vs current `.d.ts` (re-export name ordering, shifted after
   the Task 7 TypeScript bump). A full-surface sweep proved **0 removed / 0 added**
   exports across all 44 packages (non-breaking), so the baselines were regenerated
   (`release.mjs gate --update-baseline`) and the gate passed clean. The only genuine
   surface delta is the additive `resolveRedactor` (Task 3), documented in migration.md.

**Docs:** `docs/release-and-install.md` gained "### 0.0.16 publish handoff" and
current-release prose was reconciled to 0.0.16 / 44 manifests / thirty-seven
capability packages (historical 0.0.15 sections preserved); the `docs.test.ts`
package-count tripwire updated thirty-six → thirty-seven.

**Operator-gated (recorded, not faked):** PostgreSQL/keychain/live-provider
suites, CodeQL SAST, signed tag `v0.0.16`, npm auth/OIDC/provenance, and the
protected live-canary matrix remain protected-environment steps; Node 20 compat
was verified in Task 7. No package published by this task.

**Deviations (recorded):** release:check/gate run with `--allow-dirty
--allow-untagged` (tree intentionally uncommitted pre-handoff); baselines
regenerated rather than `--allow-break` (sweep proved zero removals/additions);
`scripts/compat-baseline/` is untracked and MUST be committed with the release.

## Addendum 2026-07-26 (10) — Task 11 0.1.0 readiness gates and Phase 12 handoff

**New page `docs/0.1.0-readiness.md`** (linked from `release-and-install.md`
intro, indexed in `docs/index.md` under Release). One page, command-per-gate,
no new tooling. Contents:

- **Gate table** (gate → command → last evidence 2026-07-26 → owner): sdk:ready,
  release:check, release:gate (frozen API surface + compat), migration docs.test,
  budget gate, benchmark medians, scan-secrets, verify-sbom, npm audit, git diff
  --check, publish dry-run, Node 20 compat — plus the operator-gated legs
  (PostgreSQL, keychain/live-provider, CodeQL, signed publication).
- **Frozen API surface + compat gate** section, incl. the baseline-maintenance
  rule (keep `scripts/compat-baseline/` committed; regenerate only after proving
  zero removed exports).
- **Migration coverage 0.0.5→0.0.16** (one tripwired section per release).
- **Budget table** (root packed/unpacked/files + startup, from `scripts/budgets.json`)
  and the **benchmark median table** (six scenarios, ±25%).
- **Live-suite matrix** and **security matrix**.
- **Remaining for 1.0** (exact operator/protected prerequisites): signed tag +
  commits, npm OIDC provenance/attestation, protected live-canary green,
  PostgreSQL + keychain suites green, CodeQL green, committed compat baselines,
  Phase 12 demand evidence.
- **Phase 12 demand-evidence entry criteria**: named user / concrete integration
  / operational owner / measurable acceptance criteria → demand evidence →
  primitive review → threat model → optional package → conformance → release gate.

**roadmap.md:** Phase 11 → `[x]` with dated evidence (44-manifest graph, additive
`resolveRedactor` only, sdk:ready green, offline gates, security legs,
evidence-rejected hotspot/duplication work, pointer to readiness page,
operator-gated remainder). Phase 12 backlog untouched except a References
cross-link to the readiness page as the floor every promoted capability consumes.

**docs/index.md:** release-and-install entry reconciled to current **0.0.16 /
44-package** graph; the tripwired historical "0.0.15 ... protected live-canary
matrix" phrase preserved (annotated "still standing for 0.0.16"); readiness page
added.

**Verification:** full `npm test` RC=0; docs.test 105/105 (after restoring the
historical canary phrase an over-eager index rewrite had dropped). No new suites
(gate commands tested by Tasks 1–10). No public API/behavior change; no package
published. 0.0.16 remains a readiness review — the 1.0 decision is the operator's
after the protected legs and Phase 12 demand evidence.
