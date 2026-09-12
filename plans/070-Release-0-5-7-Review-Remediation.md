# 070 — 0.5.7 Review Remediation: Concurrency, Dedup, Splits, And Dependency Refresh

Roadmap phase: **0.5.x**.
Baseline: `@arnilo/prism` **0.5.6** (all 10 publishable manifests lockstep).
Status: **Planned** (2026-09-09 comprehensive review of the 0.5.6 tree).

Remediation of the 2026-09-09 comprehensive implementation review. The review
found the codebase disciplined (zero `@ts-ignore`, near-zero `any`, typed error
codes, deny-by-default security, clean `npm audit`, DNS-pinned fetch); this
plan lands the confirmed defects, the proven duplications, the god-file splits,
the stale tooling evidence, the dependency refresh, and the additive host
configurability gaps — in priority order. No new packages, no new contribution
kinds, no capability expansion.

1. **P0 defects** — concurrent tool dispatch drops sibling results (poisons
   strict-provider histories); ponytail/graft peer-gated suites silently skip.
2. **Proven dedup** — `Semaphore` ×4, `upstream.ts` ×3 (+ graft variant), deep-merge ×2, retry classification ×2.
3. **God-file splits** — `runtime/server/artifacts.ts` (1039), `enterprise/postgres/model-router.ts` (990), `mcp/server.ts` OAuth section.
4. **Tooling truth** — stale `coverage-thresholds.json` (22 retired package names), freeze-count deltas ×~10 scripts, `&&`-chain test hiding.
5. **Dependency refresh** — pg, playwright-core, office-open, zod, ai-sdk, ACP SDK 1.4, biome; `@types/node` ↔ engines decision.
6. **Additive host config** — browser idle TTL, SsrfPolicy CIDR, injectable token estimator, snapshot cache TTL, tunable linear-search caps.

## Objectives

- Fix the concurrent-dispatch failure path so every dispatched tool call has a
  persisted result (real or synthetic error) before the run errors out.
- Make every peer-gated first-party suite actually run in CI and dev by
  installing the missing optional peers as devDependencies (pdf-parse/mammoth
  precedent, 0.5.0).
- Collapse proven-identical copies (semaphore, upstream resolver, deep merge,
  retry classification) into single parametrized modules behind unchanged
  public surfaces.
- Split `artifacts.ts`, `model-router.ts`, and `mcp/server.ts` along their
  existing internal seams using the 0.1.4 barrel-re-export compat pattern.
- Make release evidence truth again: coverage thresholds name only live
  packages; freeze counts come from one source; `npm test` reports every
  failing stage.
- Adopt the safe dependency bumps and decide the `@types/node` ↔ engines
  alignment; add a release-lint that keeps internal peer ranges lockstep.
- Add the five additive configuration knobs the review identified, each with
  DEFAULT/HARD validation, without changing any existing default.

## Expected Outcome

- `npm test` green with all stages reporting; ponytail upstream conformance and
  graft CLI suites execute (not skip) in dev and CI.
- A failing sibling in a `toolConcurrency > 1` run leaves the session with an
  error `ToolResult` for every unanswered call; the next provider request is
  valid on strict APIs (OpenAI Responses, Anthropic).
- One `Semaphore` implementation (abort-aware) in `prism-coding-tools`; one
  upstream resolver shared by caveman/ponytail/impeccable; public exports and
  behavior unchanged.
- `artifacts.ts`, `model-router.ts`, `mcp/server.ts` split into submodules;
  imports and public symbols identical (compat baseline green, budget-gate
  re-baselined per release convention).
- `scripts/coverage-thresholds.json` contains exactly the 9 live workspace
  names; a gate assertion fails if a row names a retired package.
- Dependency set current within the cut; `@types/node` pinned to the oldest
  supported Node major or engines deliberately bumped, decision recorded.
- New options `idleRunTtlMs`, SsrfPolicy CIDR allow-lists, injectable estimator,
  `snapshotCacheTtlMs`, tunable linear-search caps — all optional, defaults
  byte-identical to 0.5.6 behavior.
- Release 0.5.7 lockstep: 10 manifests bumped, internal first-party ranges
  normalized to `^0.5.7`, CHANGELOG + `docs/index.md` current line updated.

## Tasks

- [x] Task 1 — Primitive review and seam inventory
  - Completed 2026-09-11 — all decisions resolved and spans verified against the working tree (**0.5.6 @ `983eca4d`**). The inventory disproved the Task 3 premise and corrected Tasks 6, 10, 11, 15, 17, 18 before execution. Recorded below.
  - Acceptance Criteria:
    - Functional: Record, per gap, whether an existing primitive covers it (reuse), a new shared helper is justified (build), or the duplication is data-not-logic (reject). Confirm no task needs a new package, new contribution kind, or public breaking change.
    - Performance: Static review only; no runtime change.
    - Code Quality: Decisions name exact file:line spans verified against the working tree.
    - Security: Reconfirm the security-keeper surfaces stay untouched (ownership/checkpoint guards, `secureCompare`, `zeroBuffer`, sandbox path-escape guard, RAG scope guard, MCP content-bounds guard, secret-leak conformance assert).
  - Approach:
    - Documentation Reviewed:
      - `plans/069-Trusted-Extension-Activation-And-Wiki-Ingest.md` Task 1 (primitive-review format)
      - `.agents/skills/create-plan/references/prism-wiki.md`
      - `roadmap.md` — "Elegance of implementation" and plan 005 deferral note (shared behavior module deferred until third behavior package; three now exist)
      - `docs/public-contracts.md`, `docs/coding-tools.md`, `docs/core.md` (subpath surfaces that must not change)
    - Options Considered:
      - Fix/consolidate ad hoc inside each consumer task: rejected — five tasks would each re-derive the same reuse decisions.
      - One inventory task that fixes decisions once (chosen — same pattern as plan 069 Task 1).
    - Chosen Approach:
      - Inventory seams per review finding, with spans: `Semaphore` copies at `packages/prism-coding-tools/src/security/native-sandbox.ts:587`, `.../security/docker-sandbox.ts:297`, `.../security/egress/proxy.ts:141`, `.../agent/checks.ts:47`; `upstream.ts` at `.../src/{caveman,ponytail,impeccable}/upstream.ts` + `packages/memory/src/graft/upstream.ts`; deep-merge at `src/config.ts` (`mergeObjects`) vs `packages/memory/src/util.ts:59` (`mergeJsonObjects`); retry classification at `packages/prism-providers/src/{hyper,neuralwatt}/retry.ts`.
      - Confirm split seams: `runtime/server/artifacts.ts`, `enterprise/postgres/model-router.ts`, `mcp/server.ts` — the exact section spans are verified and recorded in Findings (below).
    - API Notes and Examples:
      ```ts
      // decision record shape (in this plan's task notes, not code)
      // { seam, spans, decision: reuse|build|reject, consumer tasks }
      ```
    - Files to Create/Edit:
      - none (inventory only; decisions live in this plan)
  - Findings (recorded 2026-09-11, all spans verified against the working tree):
    - **No new package, no new contribution kind, no public breaking change.** Every task lands in the existing 9 workspaces + root; the extension kernel surface (`src/extensions.ts:118-214`) is untouched by all 20 tasks. New public symbols are additive only: `EMPTY_TOOL_RESULT_TEXT` (Task 4), `BrowserLimits.idleRunTtlMs` + `SsrfPolicy.allowedCidrs` (Task 16), estimator/TTL/linear-cap options (Task 18). Task 11's originally proposed new core export was withdrawn — the matching export already exists.
    - **Semaphore: BUILD one shared module; 4 copies confirmed, 3 shapes.** `graft grep "class Semaphore"` → exactly 4: `security/native-sandbox.ts:587-617` (abort-aware, throws `NativeSandboxError`, returned release, `Math.max` clamp), `security/docker-sandbox.ts:297-327` (abort-aware, `DockerSandboxError`, same shape), `security/egress/proxy.ts:141-158` (no abort, returned release, clamp), `agent/checks.ts:47-64` (no abort, **`acquire(): Promise<void>` + separate `release()`** — call-site shape differs, no clamp). Superset = native-sandbox. Decision: shared class with optional `signal` plus an `abortError?: () => Error` factory so both sandbox typed errors survive; checks.ts call sites move to `try/finally` (small diff). Abort stays fail-closed: aborted waiters release nothing; acquired slots are released exactly once.
    - **Upstream: REUSE primitives, KEEP 3 resolvers (not one resolver).** The `resolveUpstreamRoot` variants are not interchangeable: caveman `caveman/upstream.ts:68-77` (`upstreamPath` required, `skills/` marker, returns `string`), ponytail `ponytail/upstream.ts:80-84` + `resolvePeerPackageRoot:70-78` (optional path, peer fallback, returns `string`), impeccable `impeccable/upstream.ts:70-83` (SKILL.md candidate probe, returns `{ root, skillRelativePath }`). Byte-identical across the three: `UpstreamResolveError` (`:14`/`:16`/`:12`), `redactPaths` (caveman `:29-41`, ponytail `:32-44`, impeccable `:32-44`), `readBoundedFile` (`:54`/`:47`/`:47`), `MAX_ERROR_CHARS`, `SKILLS_DIR_NAME`, `assertSkillsMarker` (caveman `:43-51`, ponytail `:60-68`). Decision: `src/upstream/index.ts` holds the primitives + `assertSkillsMarker` + `resolvePeerPackageRoot`; each persona keeps its own thin resolver (≤20 lines; impeccable keeps its candidate probe). `redactPaths`/`UpstreamResolveError`/`readBoundedFile`/`MAX_SKILL_FILE_BYTES` are re-exported publicly **only by `impeccable/index.ts:6-16`** — shared re-exports keep `name`/`code`/`instanceof` intact (`instanceof` becomes true across personas: hardening, not breakage). The graft copy (`packages/memory/src/graft/upstream.ts`, `redactPaths:46-58`, `readBoundedFile:61`, `resolveGraftCli:116`, `GraftResolveError:16`) is **REJECTED for sharing**: different workspace (memory peers only `@arnilo/prism` + optional graft), different contract (CLI resolution, not a skills root), different error class/messages — sharing would require a new package (YAGNI).
    - **Deep merge: REUSE the existing public core export; no new export needed.** Core already ships `mergeConfigLayers` (`src/config.ts:39-46`, root-exported at `src/index.ts:88`) built on validated `mergeObjects` (`:48-60`) with deep `cloneJsonValue` + path-labeled `assertSafeJsonKey` (`:111-117`). Memory's `mergeJsonObjects` (`packages/memory/src/util.ts:59-70`) differs three ways: patch values are assigned by reference (aliasing), keys throw `MemoryValidationError` "Forbidden JSON key" instead of core's path-labeled `Error`, and nested values are not cloned/validated. Decision: memory delegates to `mergeConfigLayers([{ name: "base", config: base }, { name: "patch", config: patch }])`; memory keeps `isPlainObject`/`assertSafeJsonKey`/`cloneJsonObject` (independently used by `schema.ts:22-107`). Value parity test required; the aliasing/deep-validation delta is intentional hardening and is tested (mutating the patch after merge must not change the record).
    - **Retry: PARTIAL build; classifier unification REJECTED.** The two files are not data-different twins: hyper 86 lines vs neuralwatt 130; neuralwatt adds body `retry_after`, `Headers` support, and `retry_strategy` preservation (`cleanStrategy`, `readNumber`). Genuinely duplicated and security-adjacent: `parseErrorBody`, `readHeader`, Retry-After numeric conversion, and the secret-redacting error builders `hyperHttpError`/`neuralWattHttpError` (a redaction fix must be applied twice today). Decision: extract `packages/prism-providers/src/shared/retry-http.ts` (readers + `providerHttpError(providerName, decision, secrets)`); classifiers stay per provider. `parseRetryAfterMs` is already public via `@arnilo/prism/providers/transport` (`package.json:17-19`, `src/providers/transport.ts:55`) — reuse it. Full `RetryTable`/`classifyProviderError`: rejected (wire semantics differ).
    - **Provider cache/telemetry duplication: REJECT.** `cache.ts` files are 18-90 lines of provider-specific wire semantics (e.g. `openai/cache.ts` `prompt_cache_retention` mapping; `anthropic/cache.ts:15-31` `cache_control` gating) and already reuse core helpers (`applyCacheControl`, `sanitizeCacheKey`, `resolveBreakpoint`). Matches `roadmap.md:56` ("keep as-is").
    - **God-file seams confirmed.** `runtime/server/artifacts.ts` (1039): limits `:60-124`, service `:126-571`, delivery links/crypto `:574-662` (timing-safe verify `:595`), handler `:667-806`, routes+validation `:808-1025`. `enterprise/postgres/model-router.ts` (990): factory `:59-484`, `withTransaction:486-514`, circuit `:516-602`+`:346-447`, budget+rate capacity `:604-756`, validation helpers `:804-990`. `mcp/src/server.ts` (872): OAuth/metadata block `:794-872` (`httpError`, `unauthorized`, `normalizeProtectedResource:810-849`, `validateProtectedResourceUrl:851-863`, `McpHttpError:865-872`).
    - **Coverage truth confirmed.** `scripts/coverage-thresholds.json` has **31 rows**: the 9 live workspaces + 22 retired names (`@arnilo/prism-coding-agent`, `prism-caveman`, `prism-ponytail`, `prism-server`, `prism-session-store-sqlite`, …). Gate: `scripts/phase23-coverage.test.mjs`. Live-name partitions are also re-derived inline across the freeze scripts (`phase13-freeze.test.mjs:158-179` `hasCodingTools ? -46 : hasCore ? -14 : 0`).
    - **Peer-gated skip premise DISPROVEN (Task 3 reframed).** Zero tests import or `require.resolve` the real `@dietrichgebert/ponytail` / `@nanonets/graft`; both suites are fixture-based plus fail-closed missing-peer assertions (`ponytail/__tests__/upstream.test.ts:34-38`; fixture-based graft suites). Repo-wide the only skips are env-gated postgres integration (`POSTGRES_URL`) and `computer-use-linux/__tests__/live.test.ts`. Real gap: the **documented peer contracts are never exercised against the real peers** (`docs/ponytail.md:13` `^4.9.0`; `docs/graft.md:17` `^0.16.0`; `memory/src/graft/upstream.ts:13` `GRAFT_PEER_RANGE = "^0.16.0"` vs published 0.18). Task 3 becomes a dev-only real-peer smoke task that feeds Task 12's floor decision.
    - **redactSecrets confirmed.** `src/redaction.ts:89-91` (`needles.reduce((current, secret) => current.split(secret).join(REDACTED), text)`); `scripts/benchmark-scenarios/` has 9 scenarios and none for redaction → Task 9 adds one.
    - **ESM cycle confirmed.** `src/content.ts:5` imports `pinnedFetch`; `src/pinned-fetch.ts:24` imports `assertSsrfAllowedUrl`, `MediaContentError`, and the host/SSRF types from `content.ts`. The fix must move the **implementation** (not just types) of `assertSsrfAllowedUrl` + `MediaContentError` to the leaf and re-export from `content.ts`, because `pinnedFetch` calls it (Task 10 corrected).
    - **Sequential-loop candidates mostly REJECTED.** RAG indexing is already batched (`memory/src/rag/indexing.ts:79-110`: `embedBatchSize` batches, ordered writes, partial-status resume) — reject. Core evals are already parallel (`governance/evals/curate.ts:164` `mapPool`, `comparison.ts:45-55` `mapPool`+`Promise.all`) — reject; remaining loops there are cursor paging (ordering-bound). Postgres persistence has one `for` loop total (`sessions/postgres/persistence.ts:942`, over `pageRows`, no await) — reject. MCP server awaits are registration/setup plus per-request web-handler work (already concurrent per request) — reject. `wiki/skills.ts:74-96,138-141` is small ordered copy/read work — reject. The one surviving candidate is `wiki/engine/linter.ts:34-45,93-125` (per-page `readFile` in serial loops) — **measurement-gated** (Task 17).
    - **Security keepers confirmed untouched by all tasks.** `secureCompare`/`zeroBuffer` `packages/prism-core/src/credentials/node/envelope.ts:182,189`; artifact ownership/approval guards `artifacts.ts:536-570,862,919`; sandbox path-escape `packages/prism-coding-tools/src/security/sandbox-fs-operations.ts:83-94`; RAG scope guard `packages/memory/src/util.ts:16`; MCP content bounds `packages/mcp/src/server.ts:683-785`; delivery-link timing-safe compare `artifacts.ts:595`; secret-leak conformance `scripts/e2e-cli-live.test.mjs:215-216` + `scripts/phase20-security.test.mjs:130`. The artifacts/MCP splits move these verbatim behind barrels.
    - **Release/tooling facts corrected.** 10 publishable manifests at 0.5.6 = root `@arnilo/prism` + 9 workspaces; internal ranges split `^0.5.5` ×7 vs `^0.5.6` ×10 → Task 13 lint. Root `@types/node ^26.1.1` vs `engines >=20`. `npm test` is one long `&&` chain ending in `npm run test --workspaces --if-present` (no aggregation). External peers: **12 declarations across 7 packages, 11 distinct** (`playwright-core` twice: office + web-tools) → Task 19 matrix rows. `docs/peer-dependencies.md`/`docs/options-index.md` do not exist. **`scripts/package-truth.mjs` already exists** (plan 024: `computePackageTruth`/`expandWorkspaceDirs`/`readManifest`; consumed by `packaging-current.test.mjs`, `phase24-truth.test.mjs`) → Task 15 extends and consumes it (do not create). Freeze-script historical deltas are **lineage evidence, not duplication**: keep the deltas, share only the live workspace-shape partition.
    - **Linear-search caps home (Task 18 corrected).** `DEFAULT_/HARD_MAX_SESSION_SEARCH_LINEAR_{SESSIONS,ENTRIES,BYTES}` live in `src/contracts-core/session.ts:74-80`; the store already takes `sessionSearchMode` (`src/session-stores.ts:166-169`) but no numeric overrides — add optional caps to `CreateMemorySessionStoreOptions`, bounded by the HARD constants.
  - References:
      - `packages/prism-coding-tools/src/{caveman,ponytail,impeccable}/upstream.ts`; `packages/memory/src/graft/upstream.ts`
      - `packages/prism-coding-tools/src/security/{native-sandbox.ts:587,docker-sandbox.ts:297,egress/proxy.ts:141}`, `agent/checks.ts:47`
      - `src/config.ts:39-60,105-121`; `packages/memory/src/util.ts:43-70`
      - `packages/prism-providers/src/{hyper,neuralwatt}/retry.ts`; `src/providers/transport.ts:55`; `package.json:17-19`
      - `packages/prism-core/src/runtime/server/artifacts.ts:1,60-124,574-662,667-1025`; `packages/prism-core/src/enterprise/postgres/model-router.ts:59-514`; `packages/mcp/src/server.ts:683-785,794-872`
      - `src/agent-loops.ts:298-343` (Task 2 defect); `src/input.ts:451-459`; `src/redaction.ts:86-135`; `src/content.ts:5,68-73`; `src/pinned-fetch.ts:24`
      - `scripts/coverage-thresholds.json`; `scripts/phase13-freeze.test.mjs:158-179`; `scripts/package-truth.mjs`
      - `roadmap.md:56,407` (plan 005 deferral); `plans/069-Trusted-Extension-Activation-And-Wiki-Ingest.md` Task 1
  - Test Cases to Write:
    - none in this task (decisions consumed by Tasks 2-20)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — inventory only.
    - Docs pages to create/edit: none — decisions recorded in this plan.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 2 — Concurrent dispatch: persist sibling results before failing (P0)
  - Completed 2026-09-11 — `src/agent-loops.ts` `dispatchToolCallsInOrder` now persists rows after `Promise.allSettled` and before rethrowing. Two deviations recorded during execution: (1) **run-control errors are exempt** from the synthetic row (`ERR_PRISM_AGENT_RUN_SUSPENDED` / `ERR_PRISM_DELEGATION_SUSPENDED` / `ERR_PRISM_LOOP_*`) because their resume machinery appends the real result and a synthetic row would duplicate it — new `isRunControlError` mirrors `src/tools.ts`; (2) **abort is covered too** (the `throwIfAborted` in the append loop is gone, so an aborted batch persists completed rows), which updated one existing test that pinned zero rows on abort. Sequential (`concurrency === 1`) dispatch is unchanged, so a sequential dispatch throw still leaves the throwing call unanswered — recorded as a follow-up, not silently fixed here. `docs/tools.md:219` carried the same stale contract sentence as `docs/agent-loops.md` and was updated too.
  - Acceptance Criteria:
    - Functional: When `toolConcurrency > 1` and one dispatched call fails, every other dispatched call in the round gets its result appended (real result if it completed; typed error `ToolResult` if it was cut short) before the loop throws. The session branch never ends a round with unanswered `tool_call` ids. Run-level suspension errors (`AgentRunSuspended`, `ERR_PRISM_DELEGATION_SUSPENDED`, `ERR_PRISM_LOOP_*`) are exempt for the failing call only — their resume machinery appends the real result, so a synthetic row would duplicate it. Aborted batches persist rows the same way.
    - Performance: No change to the sequential (`concurrency === 1`) path; no extra awaits on the success path.
    - Code Quality: Fix lives in `dispatchToolCallsInOrder` (the shared helper) so `singleShotLoop` and every caller inherit it; no per-caller patches.
    - Security: Synthetic error results contain no secrets (reused typed error shape, message from the caught error only).
  - Approach:
    - Documentation Reviewed:
      - `src/agent-loops.ts:298-343` (`dispatchToolCallsInOrder`): Task 1 confirmed the defect is worse than "drops siblings" — `if (stopped) throw firstFailure;` (L338) precedes the append loop (L339-343), so a concurrency>1 failure appends **zero** results for the round; workers also stop consuming new calls. Note `throwIfAborted(ctx.signal)` inside the append loop must not run before results are persisted.
      - `src/agent-session/session/tool-round.ts:302-405` (`bindDispatchToolCall`), `:510-517` (durable replay)
      - `src/input.ts:437-459` (`toToolResultMessage`), `src/agent-loops.ts:345` (`appendToolResultMessage`)
      - `docs/agent-loops.md` (toolConcurrency contract; "Artifact mode always dispatches sequentially")
      - 0.5.3 CHANGELOG entry (content-only tool-result fold) — the adjacent wire-shape fix
    - Options Considered:
      - Catch per-call in the worker and append error results inline: keeps ordering per index but interleaves appends with dispatches (append order ≠ call order under concurrency).
      - Collect all outcomes in `results[]`, then append in call order with synthetic error results for unfinished calls, then throw the first failure (chosen — preserves ordered append, single seam, smallest diff).
    - Chosen Approach:
      - Collect per-index outcomes; after `Promise.allSettled`, append in call order: real results for filled indices, `errorToErrorInfo` rows for the failing index (and for claimed-but-unfilled indices, which cannot occur beyond that one), and a static `tool_call_not_dispatched` row for indices the batch never claimed; then `throw firstFailure`. Sequential path unchanged.
    - API Notes and Examples:
      ```ts
      // shape after fix (illustrative)
      await Promise.allSettled(workers);
      for (let i = 0; i < calls.length; i += 1) {
        const outcome = outcomes[i]!;
        await appendToolResultMessage(
          outcome.status === "ok" ? outcome.result : errorToolResult(calls[i]!, outcome.error),
          ctx,
        );
      }
      if (firstFailure) throw firstFailure;
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`: `failureIndex` tracking + `isRunControlError`/`syntheticFailureResult` helpers + ordered append before rethrow.
      - `src/__tests__/agent-loops.test.ts`: 2 existing tests updated, 3 added.
      - `docs/agent-loops.md:236` and `docs/tools.md:219` (same contract sentence lives in both).
  - Test Cases to Write (done):
    - `src/__tests__/agent-loops.test.ts` — `toolConcurrency: 2`, second of two calls rejects: both calls have appended results, the failure rethrown, appended order matches call order ("waits for in-flight workers, persists answered rows, and stops unclaimed calls after the first failure").
    - One success + one cut-short call that never wrote a result: static `tool_call_not_dispatched` row present for the unanswered call (same test, `c3`; abort variant in "waits for in-flight parallel dispatches, persists completed rows, then surfaces abort").
    - Suspension guard: a `ERR_PRISM_DELEGATION_SUSPENDED` failure gets no synthetic row ("appends no synthetic row for a suspended call the resume machinery will answer").
    - Session-replay check: after the failing round, `session.entries()` contains one `tool_result` per dispatched `tool_call` id ("persists one tool_result per tool_call id when a parallel dispatch fails", end-to-end via `maxToolCalls: 1`).
    - Existing suites green: full core suite 1713 tests, lint, format, import-hygiene, phase8 conformance, phase25 bounded accumulation, workflow-loop benchmark.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — failure-path session content gains synthetic tool results (a correctness fix; providers see complete histories).
    - Docs pages to create/edit: `docs/agent-loops.md:236` (batch sentence rewritten) and `docs/tools.md:219` (the same contract sentence, not listed in the original task — found by grep during execution).
    - `docs/index.md` update: no — no navigation delta; the page already exists.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Real-peer contract smoke tests (dev-only peer install)
  - Completed 2026-09-11 — peers installed as devDependencies only (lockfile entries `dev: true`: ponytail 4.9.0, graft 0.16.0; published `peerDependencies` + `peerDependenciesMeta.optional` unchanged; `npm audit` still 0 vulnerabilities; no static peer import in any `src/`). Two findings from the first real-peer run:
    1. **Defect fixed** — `packages/prism-coding-tools/src/ponytail/upstream.ts:resolvePeerPackageRoot` assumed the peer exports `./package.json`; ponytail 4.9.0's `exports` map only exposes `.` and `./plugin`, so the documented "install the optional peer" path threw `UpstreamResolveError` and every consumer without `upstreamPath` failed closed. Resolution now falls back to the resolved entry and walks up to the manifest that declares the package name (`tryResolve` + `findPackageRoot`). `packages/memory/src/graft/upstream.ts:100` carries the identical assumption but graft 0.16.0 does export `./package.json`, so its copy passes today — Task 6 must put the entry-walk fallback in the shared resolver so graft inherits it.
    2. Cost measured: `npm ci` grows by 1.3 MB (ponytail) + 127 MB (graft, tree-sitter closures) and 41 lockfile entries; test time stays in the existing `node:test` pass (+6 tests, ~100 ms).
    Test-case deviation: the ponytail smoke asserts all six `PONYTAIL_SKILL_NAMES` resolve with instructions (not just "≥1 skill") because `requirePonytailSkills` fails the extension closed when the peer renames one, and it asserts the installed version against the declared range (4.x / 0.16.x) plus a real-file `readBoundedFile` cap/escape case (ponytail's fixture suite had none). No existing test relied on default peer resolution — every call site passes `upstreamPath`/`packageRoot`/`packageName` (verified by grep) — so fixture suites were untouched and stay green.
  - Acceptance Criteria:
    - Functional: `@dietrichgebert/ponytail@^4.9.0` and `@nanonets/graft@^0.16.0` become devDependencies of `@arnilo/prism-coding-tools` and `@arnilo/prism-memory`; new smoke tests resolve the real peer package roots through the shipped resolvers with no explicit path and assert the documented layouts (ponytail `skills/` marker + every required skill parsed; graft manifest `bin` + `peer-bin` kind). These are the first tests to exercise the real peers — Task 1 proved no suite self-skips; the gap is that both are fixture-only, so documented floors and Task 12's 0.18 widening have no evidence base. The ponytail run also forced the resolver fix recorded above: zero-config peer resolution now works for packages whose `exports` map hides `./package.json`.
    - Performance: `npm ci` grows by the two peer trees; tests run in the existing `node:test` pass.
    - Code Quality: Peer declarations in published manifests unchanged (dev-only); resolvers stay optional-gated — no static runtime import of either peer.
    - Security: DevDependencies never ship; `npm audit` stays clean; smoke tests assert bounded reads and never commit peer paths or credentials.
  - Approach:
    - Documentation Reviewed:
      - Task 1 findings (no self-skipping suite; fixture-only coverage; documented contracts `docs/ponytail.md:13`, `docs/graft.md:17`, `memory/src/graft/upstream.ts:13`)
      - 0.5.0 CHANGELOG — pdf-parse/mammoth devDependency precedent
      - `packages/prism-coding-tools/src/ponytail/__tests__/upstream.test.ts`, `packages/memory/src/graft/__tests__/{upstream,cli}.test.ts` (fixture patterns to extend)
    - Options Considered:
      - Leave fixture-only coverage: accepts today's gap, but leaves the documented peer floors (and Task 12's graft decision) unverified.
      - Dev-only install + two smoke tests (chosen — smallest thing that fails when a peer's packaging layout changes).
      - Dedicated CI job installing peers: rejected — local `npm test` still misses it.
    - Chosen Approach:
      - Install the peers at their current declared floors; add one smoke suite per peer that resolves via the real package by default (no `upstreamPath`/`cliPath`), asserts the layout marker/bounds, and keeps the existing fail-closed bogus-package tests.
    - API Notes and Examples:
      ```sh
      npm i -D @dietrichgebert/ponytail@^4.9.0 -w @arnilo/prism-coding-tools
      npm i -D @nanonets/graft@^0.16.0 -w @arnilo/prism-memory
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/package.json`, `packages/memory/package.json` (devDependencies); `package-lock.json` (41 new entries, all `dev: true`).
      - New `packages/prism-coding-tools/src/ponytail/__tests__/real-peer.test.ts`, `packages/memory/src/graft/__tests__/real-peer.test.ts`.
      - `packages/prism-coding-tools/src/ponytail/upstream.ts`: entry-walk peer root fallback — the defect the new smoke test found.
  - Test Cases to Write (done):
    - Ponytail: default resolution finds the real peer root; `skills/` present; `loadUpstreamSkills` parses every required skill within caps; bogus `packageName` still fails closed typed (`real-peer.test.ts`, 4 tests).
    - Graft: `resolveGraftCli()` resolves the real manifest bin (`kind: "peer-bin"` over `process.execPath` + `<peer>/dist/cli.js`); bogus `packageName` still throws `GraftResolveError` (`real-peer.test.ts`, 2 tests).
    - Suites after install + fix: coding-tools 653 pass / 1 pre-existing skip, memory 351 pass / 3 skips, root core 1713 pass, gates 88 pass; lint + format clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — dev-only install; published peer contracts and resolver signatures unchanged (the fix makes the documented zero-config path work instead of throwing).
    - Docs pages to create/edit: none — `docs/ponytail.md:13` already documents the `@dietrichgebert/ponytail@^4.9.0` peer floor and the `upstreamPath` alternative, which the fix now honors.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 4 — Empty tool-result wire edge (strict providers)
  - Completed 2026-09-11 — `toolResultPayload` now returns `EMPTY_TOOL_RESULT_TEXT` (`"(tool completed with no output)"`) when there is no `value`, no non-empty `type:text` content, and no error. Three deviations from the planned shape:
    1. The guard treats `error === null` like `undefined` (JSON round-trip of a host result) so those results also get the sentinel instead of the literal wire string `"null"`; an error-bearing result is still `result: undefined` + `error` unchanged.
    2. The constant is re-exported from the root barrel, so the budget gate, the frozen SDK surface list, and the generated package-map evidence all needed updates: `scripts/budgets.json` rebaselined 1281 → 1282 with a reason entry, `src/__tests__/public-export-contract.test.ts` `FROZEN_VALUE_EXPORTS` +1, `docs/_evidence/phase54-package-map.md` regenerated (declared `@arnilo/prism` exports 907 → 908; this is the only piece of that evidence doc that moved — the peers added in Task 3 do not appear in it).
    3. The first comment draft named providers in `src/input.ts` and tripped `core-boundaries` "no provider-specific literals"; the comment is now provider-neutral.
    Evidence that every wire is covered: `serializeToolResultJson` is the single seam for chat bodies (openai, alibaba, deepseek, kimi moonshot, neuralwatt, opencode-go), the Anthropic body, and the Responses API; `googleGenerateContentBody` writes `functionResponse.response.result` from the block, and `toAiSdkPrompt` read the raw value that used to be `undefined` → empty text output (`""`). New provider suite asserts all four shapes carry the sentinel; the pre-fix `"null"` and `""` payloads are now asserted against. Full `npm test` chain green (core 1716, +3 tests; providers +4).
  - Acceptance Criteria:
    - Functional: A `ToolResult` with `value === undefined` and no non-empty text content serializes to a well-defined non-empty payload on every provider wire (never `undefined`/absent `result` + absent `error`); behavior matches the 0.5.3 fold contract.
    - Performance: No extra serialization passes; fold happens where `toToolResultMessage` already walks content.
    - Code Quality: Fix in `toolResultPayload` (`src/input.ts:451-459`), single seam for all serializers.
    - Security: Fallback payload is a constant; no tool output leakage path changes.
  - Approach:
    - Documentation Reviewed:
      - `src/input.ts:437-459` (`toToolResultMessage`, `toolResultPayload`)
      - 0.5.3 CHANGELOG (content-only fold fix) — same class, empty edge remained
      - `src/tool-result-fold.ts:106-118` (fold path), provider serializers noted in 0.5.3 entry ("serializers join sibling `type:text` blocks when `result` is missing")
      - `packages/prism-providers/src/shared/anthropic-messages.ts` and openai chat/responses body builders (tool result emission)
    - Options Considered:
      - Emit `result: ""` for all-empty results: minimal but Anthropic treats empty tool_result content as invalid in some shapes.
      - Emit a constant sentinel text (e.g. `"(tool completed with no output)"`) only when both `value` and text fold are empty (chosen — always non-empty, host-visible and honest).
    - Chosen Approach:
      - In `toolResultPayload`, when the fold yields an empty string and `result.error === undefined`, return the sentinel constant. Document the constant in `docs/agent-loops.md` (or the tool contracts page) as the empty-output representation.
    - API Notes and Examples:
      ```ts
      export const EMPTY_TOOL_RESULT_TEXT = "(tool completed with no output)";
      // toolResultPayload: text.length > 0 ? text : result.error === undefined ? EMPTY_TOOL_RESULT_TEXT : undefined
      ```
    - Files to Create/Edit:
      - `src/input.ts`: `toolResultPayload` fallback + exported constant.
      - `src/index.ts`: barrel re-export (public surface).
      - `src/__tests__/tool-result-content.test.ts`, `packages/prism-providers/src/__tests__/tool-result-empty-wire.test.ts` (new).
      - `src/__tests__/public-export-contract.test.ts`, `scripts/budgets.json`, `docs/_evidence/phase54-package-map.md` (frozen surface / budget / evidence refresh).
      - `docs/input-and-prompt-assembly.md:91` (owning page — the tool-result message bullet).
  - Test Cases to Write (done):
    - `src/__tests__/tool-result-content.test.ts` — all-empty content `ToolResult` → block `result` is the sentinel and chat `content` is `JSON.stringify(sentinel)` (asserted `!== "null"`, `!== '""'`); empty `type:text` block treated as absent; error-only result unchanged (block `result: undefined`, `error` preserved, chat `content` = JSON of the error); value-present unchanged (pre-existing case).
    - `packages/prism-providers/src/__tests__/tool-result-empty-wire.test.ts` — shared `serializeToolResultJson` + chat message, Anthropic body `content`, Google `functionResponse.response.result`, AI SDK `output.value` all carry the sentinel and are non-empty.
    - Existing suites: full `npm test` chain green end to end (core 1716, providers 667/576 run + 91 peer-gated live skips, gates 209).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported constant + wire shape for all-empty results (additive); budget/freeze artifacts updated as recorded above.
    - Docs pages to create/edit: `docs/input-and-prompt-assembly.md:91` (the bullet that documents tool-result message construction) — chosen over `docs/agent-loops.md` because assembly owns the message shape; one sentence names the constant and why it exists.
    - `docs/index.md` update: no — existing pages; no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
    - Not covered: no live-provider run (all assertions are on body builders); a live route would only confirm the same JSON travels, at API-key cost.

- [x] Task 5 — One abort-aware Semaphore for prism-coding-tools
  - Completed 2026-09-11 — one `Semaphore` in `packages/prism-coding-tools/src/security/semaphore.ts`; the four private copies are gone (net −70 lines across the four consumer files). Design decisions worth recording:
    1. The abort error class is **injected**: `new Semaphore(max, NativeSandboxError)` / `new Semaphore(max, DockerSandboxError)`, defaulting to `Error`. Both sandbox copies threw their own class with message `"sandbox operation aborted"`; importing those classes into `security/semaphore.ts` would add an ESM cycle (`native-sandbox → semaphore → native-sandbox`), so the constructor takes the class. `instanceof` on aborts is preserved exactly; the proxy and check-runner sites never abort and take the default.
    2. `release()` stays public (union of the two existing APIs) because the check runner releases in a `finally` instead of via the returned closure; `acquire` still resolves with the closure for the other three sites. Double release is now idempotent — the active count floors at zero (the check-runner copy decremented unbounded) — pinned by a test.
    3. FIFO wake order, waiter cleanup on abort, reject-before-acquire on an already-aborted signal, and abort-listener detachment are the sandbox copies' behavior (the superset), unchanged.
  - Budget/evidence: the class must be `export`ed to serve four modules, and `measureExportCounts` counts every `export` under `src/` (reachable from the published subpaths or not), so `@arnilo/prism-coding-tools` was rebaselined 951 → 952 with a reason entry and `docs/_evidence/phase54-package-map.md` regenerated (888 → 889). It is intentionally **not** re-exported from `./security/index.ts`, so the published surface is unchanged.
  - Verification beyond the green suite: both invariants were checked with negative fixtures against the built module — swapping the FIFO `waiters.shift()` for `pop()` fails the FIFO test, and dropping the aborted-waiter `splice` (leaked waiter eats the next release) fails the abort test with "release wakes the live waiter, not the aborted one".
  - Deliberately not changed: the check runner still does not pass `context.signal` to `acquire`, so an aborted check waits for a slot and then reports "Operation aborted" (today's behavior). Passing the signal would reject earlier but is a behavior change; left as a follow-up if hosts ask.
  - Acceptance Criteria:
    - Functional: A single abort-aware `Semaphore` (acquire with optional `AbortSignal`, FIFO waiters, waiter cleanup on abort) replaces the four copies; all four call sites' observable behavior preserved (concurrency caps, release semantics, abort propagation where it existed).
    - Performance: No semaphore behavior change; the two copies without abort gain abort support as a strict superset.
    - Code Quality: One class, `prism-coding-tools` internal export (not published surface); no `any`; JSDoc noting FIFO + abort contract.
    - Security: Abort handling stays fail-closed (aborting waiters release nothing; acquired slots always released exactly once).
  - Approach:
    - Documentation Reviewed:
      - Task 1 inventory spans: `native-sandbox.ts:587`, `docker-sandbox.ts:297`, `egress/proxy.ts:141`, `agent/checks.ts:47`
      - Native-sandbox copy (abort-aware — the superset) as reference implementation
      - `packages/prism-coding-tools/src/security/sandbox-limits.ts` (limits-resolution naming pattern to follow)
    - Options Considered:
      - Core (`@arnilo/prism`) export: rejected — all four consumers live in one workspace; publishing a concurrency primitive widens the public surface for no host need (YAGNI).
      - Shared internal module in `prism-coding-tools/src/security/` (chosen — smallest blast radius; checks.ts imports across to `../security/`).
    - Chosen Approach:
      - New `packages/prism-coding-tools/src/security/semaphore.ts` with the native-sandbox semantics (superset); delete the four private classes; import at the four sites.
    - API Notes and Examples:
      ```ts
      // packages/prism-coding-tools/src/security/semaphore.ts
      export class Semaphore {
        constructor(private readonly max: number) {}
        async acquire(signal?: AbortSignal): Promise<() => void>; // release: exactly-once
      }
      ```
    - Files to Create/Edit (done):
      - `packages/prism-coding-tools/src/security/semaphore.ts` (new — class + contract JSDoc).
      - `.../security/native-sandbox.ts`, `.../security/docker-sandbox.ts`, `.../security/egress/proxy.ts`, `.../agent/checks.ts`: adopt (`import { Semaphore } from "./semaphore.js"` / `"../semaphore.js"` / `"../security/semaphore.js"`); local copies deleted.
  - Test Cases to Write (done):
    - `packages/prism-coding-tools/src/security/__tests__/semaphore.test.ts`: cap enforcement (a queued waiter does not wake while the slot is held); FIFO wake order across three waiters; abort (already-aborted signal rejects before taking a slot; a queued waiter aborts, rejects with the injected class + `"sandbox operation aborted"`, and the next release wakes the waiter behind it); extra `release()` ignored and never widens the cap.
    - Existing egress/sandbox/check suites stay green (coding-tools 657 tests; the four affected `security`/`egress`/`checks` suites 102 pass, 1 skipped) and the full `npm test` chain is green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal module, not re-exported from `./security/index.ts`; the abort error classes callers observe are unchanged.
    - Docs pages to create/edit: none — verified no `docs/*.md` page documents these concurrency semaphores (`grep -rn "[Ss]emaphore" docs/` matches only `docs/_evidence/phase18-primitive-review.md`, which mentions "concurrency semaphore" as a threat-model mitigation and needs no edit).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 6 — Shared upstream primitives module (caveman / ponytail / impeccable)
  - Completed 2026-09-11 — `packages/prism-coding-tools/src/upstream/index.ts` (113 lines, ~30 of them contract JSDoc) now owns `UpstreamResolveError`, `redactPaths`, `readBoundedFile`, `assertSkillsMarker`, `resolvePeerPackageRoot` (+ its `tryResolve`/`findPackageRoot` helpers, the Task 3 entry-walk fallback), `MAX_ERROR_CHARS` (private), `SKILLS_DIR_NAME`, and the three caps. The three persona modules keep their own resolver, option/return types, and persona-only constants; everything they exported before they still export (re-export path preserved): caveman 77 → 28 lines, ponytail 87 → 29, impeccable 83 → 50 (−170/+27 across the three).
    1. Deviation from the Task 1 note "each persona keeps its own constants": the caps (`MAX_SKILL_FILE_BYTES`, `MAX_CONFIG_FILE_BYTES`, `MAX_INJECTED_INSTRUCTION_BYTES`) and `SKILLS_DIR_NAME` were byte-identical in all three copies, so their *definitions* moved to the shared module and each persona re-exports them — import sites (`caveman/prompts.ts`, `ponytail/skills.ts`, `impeccable/index.ts`, tests) are unchanged, so compat holds while a cap change is now one edit. Persona-only constants stayed put: `CAVEMAN_UPSTREAM_PACKAGE`, `PONYTAIL_PEER_PACKAGE`, `SKILL_FILE_CANDIDATES`, and each `ResolveUpstreamRootOptions`/return type.
    2. `MAX_ERROR_CHARS` stays **private** in the shared module (only `redactPaths` uses it) rather than becoming another export; `assertSkillsMarker` and `resolvePeerPackageRoot` did become exports (+2 on the src-wide counter), so `@arnilo/prism-coding-tools` was rebaselined 952 → 954 with a reason entry and `docs/_evidence/phase54-package-map.md` regenerated (888 → 891). Nothing new is published: persona subpath barrels are untouched.
    3. Tests: the plan said to move the caveman/ponytail shared cases onto the new module. Not done — those suites also assert persona-level behavior, so the new `src/upstream/__tests__/upstream-primitives.test.ts` (6 cases) covers the primitives directly instead and the three persona suites stayed as they are (they now also exercise the re-export paths). New cases: bounded read cap + `../` escape, redaction of given paths/home + 512-char truncation, `skills/` marker fail-closed then pass, real-peer root discovery for a package that hides `./package.json` (ponytail 4.9 — verified `ERR_PACKAGE_PATH_NOT_EXPORTED`, entry resolves to `.opencode/plugins/ponytail.mjs`, so the test genuinely exercises the entry-walk branch), missing-peer fail-closed, and one-error-class/one-cap identity across personas (`caveman` failure caught by the `impeccable` export, `instanceof` hardening).
    4. Negative fixtures against the built module: deleting the entry-walk fallback fails the peer-root test; deleting the `readBoundedFile` escape guard fails the bounded-read test. Both then restored and rebuilt.
    5. Incidental artifact: running the phase16 freeze/tree-shake gate (it is **not** part of `npm test`) refreshed `scripts/phase16-baseline.json` `treeShake.distJsCount`/`distDtsCount` 79 → 80 — the root `dist/*.js` count, whose recorded 2026-09-02 value predates this task (no root module was added here). Regeneration is idempotent and the gate passes 19/19.
  - Stale cross-reference corrected: the original note said memory's `packages/memory/src/graft/upstream.ts:100` "can reuse it in Task 12". It cannot — Task 1 rejected cross-package sharing (different workspace/contract/error class) and there is no published subpath for the internal module, so the graft copy keeps its own `./package.json` assumption. Checked 2026-09-11: installed graft 0.16.0 and published 0.18.0 both export `./package.json`, so Task 12's floor widen to `^0.18.0` is safe as-is; if a later graft hides it, `graft/upstream.ts` needs the same ~15-line fallback (duplicated deliberately).
  - Acceptance Criteria:
    - Functional: One shared primitives module serves all three behavior packages (`UpstreamResolveError`, `redactPaths`, `readBoundedFile`, caps/markers, `assertSkillsMarker`, `resolvePeerPackageRoot`). The three `resolveUpstreamRoot` functions **stay per persona** — Task 1 verified their signatures/return types differ (`string` vs `{ root, skillRelativePath }`) and caveman has no peer fallback by design. `impeccable/index.ts:6-16` public re-exports (`redactPaths`, `UpstreamResolveError`, `readBoundedFile`, `MAX_SKILL_FILE_BYTES`) are preserved with identical `name`/`code`; `instanceof` becomes cross-persona permissive (hardening). The graft variant (`packages/memory/src/graft/upstream.ts`) is **excluded** (Task 1: different workspace, different contract, different error class).
    - Performance: Same synchronous resolution profile; no new I/O.
    - Code Quality: Per-package constants (`CAVEMAN_UPSTREAM_PACKAGE`, peer names, caps) stay exported from their current modules for compat; only the shared logic moves.
    - Security: `redactPaths` and the byte-limit enforcement (`MAX_SKILL_FILE_BYTES` etc.) live once; marker checks fail closed exactly as today.
  - Approach:
    - Documentation Reviewed:
      - `plans/005-Release-0-0-22-Third-Party-Behavior-Integrations.md` (deferred shared module until third behavior package — now exists)
      - `.../src/caveman/upstream.ts` (77), `.../ponytail/upstream.ts` (87), `.../impeccable/upstream.ts` (83) — Task 1 measured ~50 byte-identical lines (error class, `redactPaths`, `readBoundedFile`, `MAX_ERROR_CHARS`, `SKILLS_DIR_NAME`, `assertSkillsMarker`); the resolvers and their return types/semantics genuinely differ.
    - Options Considered:
      - Keep three copies (per-package contract clarity): rejected — three-way copy of ~50 identical lines; a marker-check/redaction fix in one misses the others (the exact drift mode the review flagged).
      - One parametrized resolver for all three: rejected by Task 1 — return types and peer-fallback semantics genuinely differ.
      - Shared primitives module + per-persona thin resolvers (chosen).
    - Chosen Approach:
      - New `packages/prism-coding-tools/src/upstream/index.ts` holds `UpstreamResolveError`, `redactPaths`, `readBoundedFile`, `MAX_ERROR_CHARS`, `SKILLS_DIR_NAME`, `assertSkillsMarker`, and `resolvePeerPackageRoot`; each persona's `upstream.ts` keeps its own constants + resolver (caveman required-path, ponytail peer-fallback, impeccable candidate probe) and re-exports the shared symbols it exports today. Done as described (see the completion note: the caps/marker moved into the shared module and are re-exported, since they were identical in all three copies).
      - The shared `resolvePeerPackageRoot` is the Task 3 version (manifest lookup → entry walk-up fallback). The follow-on claim in the draft — that memory's graft copy "can reuse it" — was wrong: cross-package sharing was rejected in Task 1 and the module is not published, so only the three personas inherit the fix.
    - API Notes and Examples:
      ```ts
      // caveman/upstream.ts (after)
      export { redactPaths, readBoundedFile, UpstreamResolveError } from "../upstream/index.js";
      export const CAVEMAN_UPSTREAM_PACKAGE = "juliusbrussee/caveman";
      export function resolveUpstreamRoot(options: ResolveUpstreamRootOptions): string { /* required path + marker */ }
      ```
    - Files to Create/Edit (done):
      - `packages/prism-coding-tools/src/upstream/index.ts` (new — primitives + contract JSDoc).
      - `.../src/{caveman,ponytail,impeccable}/upstream.ts`: thin primitive re-exports + per-persona resolvers.
      - `packages/prism-coding-tools/src/upstream/__tests__/upstream-primitives.test.ts` (new); `scripts/budgets.json` + `docs/_evidence/phase54-package-map.md` (export-count refresh).
  - Test Cases to Write (done):
    - `packages/prism-coding-tools/src/upstream/__tests__/upstream-primitives.test.ts` — 6 cases: bounded read (cap, `../` escape), redaction (given paths, homedir → `~`, 512-char truncation), `skills/` marker fail-closed/pass, optional-peer root discovery against the real ponytail peer (hides `./package.json`), missing peer fail-closed, cross-persona `UpstreamResolveError`/cap identity.
    - Persona suites kept (`caveman/__tests__/upstream.test.ts`, `ponytail/__tests__/upstream.test.ts`, `impeccable/__tests__/`) plus `ponytail/__tests__/real-peer.test.ts` from Task 3; coding-tools 663 tests pass (1 skip), full `npm test` chain green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal consolidation; persona exports and their `name`/`code`/cap values are preserved (`docs/caveman.md:117`, `docs/ponytail.md:115`, `docs/impeccable.md:93` already state the caps, which kept their values; verified `grep -rn "UpstreamResolveError|MAX_SKILL_FILE_BYTES|readBoundedFile" docs/` needs no edit).
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 7 — Coverage thresholds truth + live-package gate
  - Completed 2026-09-11 — `scripts/coverage-thresholds.json` recaptured: 31 rows → 9; the 23 retired rows (pre-0.4.0 consolidation names) are gone, rows are sorted by name, `captured: 2026-09-11`, and every number is `min(two back-to-back coverage-summary runs) − 3pp` (the runs differed by ≤ 0.02pp on lines; branches/functions recorded, not gated). Delivered thresholds: acp-agent 91.87, ag-ui 87.46, coding-tools 83.11, mcp 88.83, memory 86.63, office 83.55, providers 92.04, web-tools 83.67; core stays `protectedException`. All nine measured packages sit above their previous thresholds (providers 95.04 measured vs 91.90 gated, memory 89.65 vs 86.10, coding-tools 86.11 vs 83.04 — no silent gate loosening).
    1. Deviation from the draft snippet: the live set for the retired-row check comes from `computePackageTruth().versions` minus the root name (plan-as-written), while the *runner* set check keeps `coverage-summary.mjs`'s own discovery mirrored in the test. Both checks are O(rows).
    2. Discovery widened — the real truth bug behind the 31 rows: `coverage-summary.mjs` found workspaces by a top-level `dist/__tests__` directory, so `@arnilo/prism-acp-agent` (`dist/src/__tests__`) and `@arnilo/prism-office` (`dist/<area>/__tests__`) were **never measured**: office carried a fabricated 75/70/75 row and acp-agent had no row at all. Discovery is now "any `*.test.js` under `dist/`" (recursive), so both are measured: acp-agent 94.87/79.80/94.74, office 86.55/79.90/84.96. Negative fixture: the old filter produces a 7-package artifact, the new one 9. Side benefit verified: `npm run release:evidence` now reports all 9 workspace suites (39 surfaces) instead of silently omitting two.
    3. Gate: new `thresholds JSON names only live workspace packages — no retired rows` test (assertion on the real file + negative fixtures: a retired row is flagged, an empty map passes). It failed on the real 31-row file before pruning, and `coverage-summary.mjs` failed closed (`NO THRESHOLD ENTRY`) on the measured-but-unlisted acp-agent until the row was added.
    4. Adjacent flake fixed (found while validating this task): the `document-reader` "envelope" test asserts `extract ≤ 2000ms` and measured 3441ms under V8 coverage instrumentation (ceiling was calibrated at 162ms idle with 12× headroom and documented as a non-flaky sanity bound) — the coverage gate went red on 2 of 5 runs with `no coverage data (suite failed)`. The test now scales that sanity ceiling when `NODE_V8_COVERAGE` is set (5× the base only under instrumentation to 20s; branch proven by forcing the base to 1ms: the failure message reads `exceeds 10ms` under coverage, `exceeds 1ms` without). Two full `npm run test:coverage` runs green after the fix.
    5. Docs updated (deviation from the draft's "no docs pages"): `docs/release-and-install.md` — core baseline ≈ 92.0/85.0/92.6, new workspace-discovery row, recapture date + retired-row gate, and the protected-exception row corrected to `@arnilo/prism-core` only (the old row named long-retired subpath exemptions and `@arnilo/prism-memory`, which is gated today).
  - Acceptance Criteria:
    - Functional: `scripts/coverage-thresholds.json` contains exactly the 9 live workspace package names with fresh evidence-captured numbers; a gate assertion fails the run if any threshold row names a package absent from the current workspace graph.
    - Performance: Gate check is O(rows) at test time.
    - Code Quality: Thresholds regenerated by `coverage-summary.mjs` output, not hand-edited numbers.
    - Security: No secrets in evidence (already env-names-only manifest discipline).
  - Approach:
    - Documentation Reviewed:
      - `scripts/coverage-thresholds.json` (22 retired names: `prism-coding-agent`, `prism-policy`, `prism-ponytail`, `prism-server`, `prism-session-store-sqlite`, …)
      - `scripts/coverage-summary.mjs` (threshold consumption, L109-125), `scripts/phase23-coverage.test.mjs` (gate)
      - `roadmap.md` 0.2.3 objective ("Workspace coverage summary has the wrong denominator") and VENT 26-09-01/26-09-02 entries (same class, package-count coupling)
    - Options Considered:
      - Hand-prune dead rows: rejected — drifts again on the next consolidation.
      - Regenerate + assert row names ⊆ live workspace names from `package-truth` (Task 15) (chosen — pairs with the single-source-of-truth work).
    - Chosen Approach:
      - Regenerate from two back-to-back `coverage-summary.mjs` runs (min − 3pp); add the live-name assertion to `phase23-coverage.test.mjs` reading the workspace list. Done — plus the discovery widening below, without which "live" and "measured" disagreed for two packages.
      - Discovery fix: `coverage-summary.mjs` now finds workspaces by any `*.test.js` under `dist/` (recursive) rather than requiring a top-level `dist/__tests__` directory, so acp-agent and office are measured like every other package.
    - API Notes and Examples:
      ```js
      // phase23-coverage.test.mjs (shape — as implemented)
      const truth = computePackageTruth();
      const liveWorkspaceNames = new Set(Object.keys(truth.versions).filter((n) => n !== truth.root.name));
      const retiredThresholdRows = (packages) => Object.keys(packages).filter((n) => !liveWorkspaceNames.has(n));
      assert.deepEqual(retiredThresholdRows(thresholds.packages), [], "every threshold row must name a current workspace package");
      ```
    - Files to Create/Edit (done):
      - `scripts/coverage-thresholds.json`: regenerated from two runs (rows pruned, sorted, recaptured).
      - `scripts/phase23-coverage.test.mjs`: live-name assertion + negative fixture, runner-set mirror updated to the widened discovery.
      - `scripts/coverage-summary.mjs`: workspace discovery by dist test files.
      - `packages/prism-coding-tools/src/document-reader/__tests__/index.test.ts`: coverage-aware sanity ceiling (flake fix).
      - `docs/release-and-install.md`: core baseline + gate/discovery/protected-exception rows.
  - Test Cases to Write (done):
    - The gate assertion itself, with a fixture row naming a retired package (`@arnilo/prism-caveman`) — flagged; an empty map — clean; the real file — clean only after pruning.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release tooling (coverage evidence now covers all 9 workspace packages and its file can no longer name retired packages).
    - Docs pages to create/edit: `docs/release-and-install.md` (two coverage rows + core baseline numbers), done — the draft said "none", but that page carries the freeze date, the gate mechanics, and the protected-exception list as live facts.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 8 — Split `runtime/server/artifacts.ts` (1039 lines)
  - Completed 2026-09-11 — moved verbatim behind a barrel: `artifacts-limits.ts` 113, `artifacts-service.ts` 543, `artifacts-delivery-links.ts` 64, `artifacts-handler.ts` 355, `artifacts.ts` 76 (explicit re-export lists). Verbatim proof: the four modules' body lines are a line-for-line multiset match of the original body (952 = 952 lines, zero differing lines) modulo the two deliberate `export` keywords below; the declared surface is unchanged at 54 exports (0 added, 0 omitted), and `server/index.ts` was not touched.
    1. Deviation from `export *` in the draft sketch: the barrel uses explicit lists, following `src/agents.ts` ("Deliberately NOT `export *`: star re-exports would surface the split modules' internal helpers … and change the declared surface"). Two internals are exported for cross-module use and kept out of the barrel: `bounded` (artifacts-limits → the factory's `ttlSeconds` clamp) and `ID_PATTERN` (artifacts-service → the handler's route parser). `@arnilo/prism-core`'s file-count ceiling was rebaselined 1279 → 1280 (only `ID_PATTERN` is a new name; `bounded` already exists elsewhere in the package) with a reason entry, and `docs/_evidence/phase54-package-map.md` was regenerated (prism-core declared-surface line 1174 → 1175). Release-time `--update-baseline` will record that added symbol alongside Tasks 5/6's +3 for coding-tools.
    2. Deviation from "four files each under ~400 lines": `artifacts-service.ts` is 543. The durable factory closure is 318 lines, the request/result types 126, the validation helpers 66, and the helpers are used only by the factory — and the task's own clause "`createArtifactService` … in one module" forces ≥318 lines there. Splitting the type block into a fifth module would land the factory module at ~425 (still over) and cost 7 more internal exports, so the four planned modules were kept and the size miss is recorded instead; extracting the type block is a mechanical follow-up if the factory grows (Further Actions).
    3. Security: `verifyArtifactDeliveryLink` (byte cap → signature length check → `timingSafeEqual` → shape → expiry) and the download-token ownership re-check move verbatim into their new homes; the ownership-mismatch-fails-closed comments moved with them. `assertSafeUri` (local-path refusal) stays in the service's validation block.
    4. Verification: `runtime/server/__tests__/artifacts.test.ts` unmodified 30/30; prism-core 528 tests (519 pass / 9 protected skips); full `npm test` exit 0 (dist stage + budget-gate, dead-export-verify, import-hygiene, phase54 map, packaging-current, truth-current, release-gate, public-export-contract); lint/format/client-neutrality clean; biome-clean on all five files.
  - Acceptance Criteria:
    - Functional: `artifacts.ts` becomes a barrel re-exporting from new submodules (limits, service, delivery links, HTTP handler); every existing import path and public symbol unchanged; compat baseline green.
    - Performance: No behavior change; module init cost identical (same code, new files).
    - Code Quality: Four files each under ~400 lines; the DEFAULT/HARD constants block, `createArtifactService`, link sign/verify, and `createArtifactHandler`/route parsing each in one module; no new exports.
    - Security: `verifyArtifactDeliveryLink` (timing-safe compare) and ownership checks move verbatim.
  - Approach:
    - Documentation Reviewed:
      - `plans/016-Release-0-1-4-God-Module-Split.md` (barrel-re-export compat pattern, budget-gate re-baseline convention)
      - `packages/prism-core/src/runtime/server/artifacts.ts` section map (Task 1 verified: limits `:60-124`; service `:126-571`; delivery links `:574-662`; handler `:667-806`; routes+validation `:808-1025`)
      - `scripts/budget-gate.test.mjs` (root fileCount tolerance — VENT 26-08-15: re-baseline after dist file count changes)
      - `scripts/phase15-16-17` freeze conventions if they pin artifact surface
    - Options Considered:
      - Split only service vs handler (2 files): rejected — the delivery-link crypto and the 20-constant limits block are the independent seams; 2 files still mixes limits+links into one.
      - Four modules + barrel (chosen — matches the file's own private-function boundaries).
    - Chosen Approach:
      - `artifacts-limits.ts`, `artifacts-service.ts`, `artifacts-delivery-links.ts`, `artifacts-handler.ts`; `artifacts.ts` re-exports everything previously exported. Budget-gate re-baselined in the same task (VENT 26-08-15 convention: run `node --test scripts/budget-gate.test.mjs` and re-baseline before declaring done). Done — with explicit re-export lists rather than `export *` (see completion note).
    - API Notes and Examples:
      ```ts
      // artifacts.ts (after) — explicit lists, not `export *` (internals bounded/ID_PATTERN stay out)
      export type { ArtifactLimits, ResolvedArtifactLimits } from "./artifacts-limits.js";
      export { DEFAULT_ARTIFACTS_PER_THREAD, HARD_ARTIFACTS_PER_THREAD, /* … 15 constants */ resolveArtifactLimits } from "./artifacts-limits.js";
      export type { ArtifactService, ArtifactAttachInput, /* … */ } from "./artifacts-service.js";
      export { createArtifactService } from "./artifacts-service.js";
      export { signArtifactDeliveryLink, verifyArtifactDeliveryLink } from "./artifacts-delivery-links.js";
      export { createArtifactHandler } from "./artifacts-handler.js";
      ```
    - Files to Create/Edit (done):
      - `packages/prism-core/src/runtime/server/artifacts{,-limits,-service,-delivery-links,-handler}.ts`: split + barrel.
      - `scripts/budgets.json` (prism-core 1279 → 1280) and `docs/_evidence/phase54-package-map.md` (regenerated).
  - Test Cases to Write:
    - No new tests; existing `runtime/server/__tests__` artifacts suites stay green unmodified (verbatim-move discipline), plus `public-export-contract` baseline. Verified: 30/30 artifacts tests, 528 prism-core tests, full `npm test` exit 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal split behind identical exports (54 → 54 declared names).
    - Docs pages to create/edit: none. `docs/_evidence/module-decomposition-2026-09-03.md:52` lists this file in its >800-line snapshot; that page is explicitly "one-time evidence (no permanent line-count gate)", so it stays as dated lineage and this task is the record that the entry no longer holds.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 9 — Single-pass `redactSecrets` (benchmark-gated)
  - Completed 2026-09-11 — `src/redaction.ts` now redacts large strings in one left-to-right scan (`singlePassMatcher`), with the ordered `reduce(split/join)` loop kept as the authoritative fallback. Measured on the new scenario: 1 MiB transcript × 16 needles **9.39 ms → 0.69 ms p50 (13.7×, floor 5×)** and p95 11.7 ms → 1.28 ms; small entry-shaped object 0.15 ms p50 / 0.22 ms p95. Three deviations from the plan's draft, all forced by measurement or by the byte-identity criterion:
    1. **The draft's equivalence claim was wrong.** "Leftmost-alternation ≡ split/join for disjoint needles" holds only for *non-overlapping* needles: the ordered loop prefers the first-mentioned needle globally, the regex prefers the leftmost match. Counterexamples now pinned as tests: `redactSecrets("xab", ["ab", "xab"])` is `x[REDACTED]` (loop) vs `[REDACTED]` (plain alternation), and `redactSecrets("abc", ["bc", "ab"])` is `a[REDACTED]` vs `[REDACTED]c`. A placeholder edge is the same class of bug (`["[REDACTED]", "RED"]` re-redacts through the placeholder). So the single scan is only used when it is *provably* equivalent — `singlePassMatcher` returns null when any needle can occur inside/across a produced `[REDACTED]`, or when any two needles can overlap (containment either way, or one's proper suffix equal to the other's proper prefix). Offline sweep over 59,400 adversarial (needle set, text) pairs: 0 guarded mismatches, 2,884 mismatches without the guard (~5%).
    2. **Two bounds the draft did not have.** The equivalence check is O(k²) and allocates while slicing, so it costs ~10 µs — about the loop's own cost at ~4 KB. The scan therefore engages only for strings ≥ 16 KB (`SINGLE_PASS_MIN_CHARS`, 4× margin over the measured crossover) and needle sets ≤ 32 (`SINGLE_PASS_MAX_NEEDLES`; beyond that the check and the alternation compile stop paying for themselves). Consequence: anything smaller, or outside the envelope, runs the unchanged loop, so small inputs cannot regress by construction; transcripts spread over many small strings gain nothing.
    3. **No identity cache** (draft: "build once per needles tuple, cache by identity"). The check runs lazily, once per `redactSecrets` call, and only when the call actually sees a ≥16 KB string; the ≥16 KB scan amortizes it, and a WeakMap keyed on a caller-owned array would have to distrust mutation — a silent-stale-redaction hazard on a security path.
    4. `needles.reduce(replaceAll)` was measured first as the zero-risk swap (1.08× on a rope, 1.00× on a flat string — the cost is result allocation, not the scan) and rejected; no dependency was added; `g` flag only (no `u`, matching code-unit `split`/`join` semantics for lone surrogates).
  - Added beyond the draft file list: `scripts/benchmark-redaction.test.mjs` + its `npm test` chain entry, `scripts/budgets.json#redaction` caps, and a `docs/performance.md` section (the plan's "docs: none" assessment was wrong — that page documents every scenario).
  - Acceptance Criteria:
    - Functional: `redactSecrets` output byte-identical to current for all inputs (literal split/join semantics preserved, including overlapping needles in first-mention order and key redaction suffix numbering). Verified byte-identical above and below the threshold, on the scenario fixture, and against the ordered loop for randomized adversarial needle sets/texts (all paths); exotic needles (lone surrogate, astral emoji, `\n`, `\u2028`, NUL, all regex metacharacters) checked equivalent. No needle survives either path.
    - Performance: 13.7× p50 at transcript scale (1 MiB × 16 needles, floor 5×); small-entry p95 0.22 ms with no hot-path change below 16 KB (`scripts/budgets.json#redaction` ceilings 250 ms / 25 ms); frozen p95 ceilings of the 0.1.0 orchestrator untouched (the scenario is registered but deliberately not one of its six legs).
    - Code Quality: no new dependency; stdlib `RegExp` + the existing loop; ~45 lines added to `src/redaction.ts`, no public exports added, no budget rebaseline needed.
    - Security: escaping verified for metacharacters (`.*+?^${}()|[]\\` needles behave literally and `$&`/`$1` needles are not expanded); alternation of escaped literals is linear (no ReDoS); `needleTouchesPlaceholder` is conservative — a false negative only costs the fast path, never correctness; the no-leak and byte-equality checks are asserted by the scenario gate, not just the unit tests.
  - Approach:
    - Documentation Reviewed:
      - `src/redaction.ts:86-135` (`redactString` = `needles.reduce(split/join)`; key-suffix renumbering)
      - `scripts/benchmark-0.1.0.mjs` / `scripts/benchmark-scenarios/` (frozen ceiling harness — add scenario, don't change existing)
      - `docs/credentials-and-redaction.md` (redaction contract — behavior must be documented-identical)
    - Options Considered:
      - Combined escaped-literal alternation `RegExp` with one pass over the string (chosen — stdlib, linear, smallest diff).
      - Keep O(text × needles) (rejected only if benchmark shows the win is not measurable — decision recorded either way; the scenario lands regardless as regression coverage).
    - Chosen Approach:
      - Build the alternation for the needles tuple and use a single `.replace`, **only when the set is provably equivalent to the ordered loop** (`singlePassMatcher`); otherwise the existing reduce/split/join loop runs unchanged. Decision is lazy (first ≥16 KB string) and per call — see the completion note for the guard, the two bounds, and the counterexamples that make the guard necessary.
    - API Notes and Examples:
      ```ts
      // src/redaction.ts (after)
      const singlePass = singlePassMatcher(needles); // RegExp when equivalence is provable, else null
      if (text.length >= SINGLE_PASS_MIN_CHARS && singlePass) return text.replace(singlePass, REDACTED);
      return needles.reduce((current, secret) => current.split(secret).join(REDACTED), text);
      ```
    - Files to Create/Edit (done):
      - `src/redaction.ts`: lazy `singlePassMatcher` + `needleTouchesPlaceholder`/`needlesOverlap`/`escapeRegExpLiteral` (all private; no public surface change).
      - `scripts/benchmark-scenarios/redaction.mjs` (new scenario), `scripts/benchmark.mjs` registration, `scripts/budgets.json#redaction`, `scripts/benchmark-redaction.test.mjs` (gate) + `npm test` chain entry.
      - `docs/performance.md` (scenario section; the draft's "no docs" assessment missed that every scenario is documented there).
  - Test Cases to Write (done):
    - `src/__tests__/credentials-redaction.test.ts` — ordered-semantics pinning incl. both divergence counterexamples and placeholder re-redaction; metacharacter/`$`-needle literals; empty-needle filtering, whitespace needles, key-suffix renumbering after a redacted key; threshold equivalence (±16 KB); needle-envelope fallback (1 needle, 40 needles); randomized adversarial differential against the ordered loop (24 rounds × 2 alphabets × 3 needles, ≥16 KB texts).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — pure performance change, documented contract unchanged.
    - Docs pages to create/edit: `docs/performance.md` (scenario section with the recorded 13.7× and the 16 KB / 32-needle envelope). `docs/credentials-and-redaction.md` documents the contract, not the algorithm, so it is unchanged.
    - `docs/index.md` update: no (existing page).
    - Documentation structure reference: not applicable.

- [x] Task 10 — Break the `content.ts ↔ pinned-fetch.ts` ESM cycle
  - Completed 2026-09-11 — the SSRF gate, `MediaContentError`, and the host/address types now live in a new leaf `src/media-types.ts`; `content.ts` and `pinned-fetch.ts` import from it and neither imports the other's module (verified statically on `src/` **and** on the built `dist/`: `dist/pinned-fetch.js` imports only `node:*` + `./media-types.js`). Declarations moved verbatim; `MediaContentError` is one class object, so every `instanceof` in `packages/*` still matches, and `content.ts` re-exports the five relocated names so the `@arnilo/prism` barrel is unchanged when measured by name. Four deviations from the draft, all recorded below: (1) the leaf needed two helpers the draft did not name — `normalizeHostname` and `isBlockedIp` (the latter used by `content.ts:465` `resolvePublicAddress`, outside the moved block) — and `isBlockedIp` therefore had to be **exported** (+1 root export name, budget rebaselined with a reason); (2) `normalizeHostname`'s two copies (private in `content.ts`, public in `pinned-fetch.ts`) collapsed into the leaf's single implementation, re-exported from `pinned-fetch.ts` and imported privately by `content.ts` — public surfaces unchanged; (3) `export * from "./media-types.js"` was rejected in favour of explicit name re-exports (the repo's barrel convention) because a star re-export would have published `isBlockedIp` in `content.ts`'s runtime surface; (4) the import-hygiene gate is a general static runtime-import cycle detector with a positive control, not a two-file special case (rationale below).
  - Acceptance Criteria:
    - Functional: No import cycle between the two modules; both public surfaces unchanged; behavior identical.
    - Performance: No hot-path change (type-only extraction).
    - Code Quality: Shared types and `MediaContentError` live in one leaf module (`src/media-types.ts`, 144 lines, imports only `node:net`); `madge`-style cycle check added to `import-hygiene` gate so the cycle cannot return. Explicit re-export lists (no `export *`) keep internal helpers off `content.ts`'s surface.
    - Security: No trust-boundary movement — `assertSsrfAllowedUrl` is re-exported from `content.ts` so all import paths (`src/index.ts`, tests, `packages/*`) are unchanged; `src/media-types.ts` is core-internal and not exported from the root barrel. `isBlockedIp` moved with the gate (same predicate, one copy).
  - Approach:
    - Documentation Reviewed:
      - `src/pinned-fetch.ts` module header (deliberate-cycle note) + imports (`assertSsrfAllowedUrl`, `MediaContentError`, `MediaHostAddress`, `MediaHostnameResolver`, `SsrfPolicy`)
      - `src/content.ts:1,68-73,134,220-258,472-535` (the reverse references)
      - `scripts/import-hygiene.test.mjs` (existing import gate to extend)
      - `docs/multimodal-content.md`, `docs/host-security.md` (documents `SsrfPolicy` + pinned fetch; no contract change needed)
    - Options Considered:
      - Leave the documented cycle: rejected — module-init order is a refactor landmine the review flagged; the fix is type movement.
      - Extract `src/media-types.ts` (types + `MediaContentError` + the gate) both modules import (chosen — leaf module, zero behavior).
      - `export * from "../media-types.js"` in both consumers (as the draft sketched): rejected — a star re-export would publish the leaf's internals (`isBlockedIp`) on `content.ts`'s runtime surface, so the explicit-name convention used by every other split barrel (Task 8) applies here.
      - Cycle gate as a two-file special case / as a frozen set of all cycles: rejected in favour of a general detector plus a positive control and a pair assertion — a broken parser must not make the gate pass vacuously, and the two other pre-existing cycles are not this plan's to bless.
    - Chosen Approach:
      - Move the **implementations** of `assertSsrfAllowedUrl` + `MediaContentError` + the host/SSRF type declarations, plus their shared private helpers (`normalizeHostname`, `isBlockedIp` family), to the leaf module; re-export the five public names from `content.ts` so external imports stay valid (`pinned-fetch.ts` imports the gate and the error class by value, so types alone could not break the cycle — Task 1); add a static runtime-import cycle check for the pair to import-hygiene.
    - API Notes and Examples:
      ```ts
      // src/media-types.ts (new leaf) — types + error + gate + its private-IP helpers
      export interface SsrfPolicy { ... }
      export interface MediaHostAddress { ... }
      export type MediaHostnameResolver = ...
      export class MediaContentError extends Error { ... }
      export function assertSsrfAllowedUrl(url: string, policy?: SsrfPolicy): void { ... }
      export function normalizeHostname(value: string): string { ... }
      export function isBlockedIp(hostname: string): boolean { ... }
      // content.ts / pinned-fetch.ts (explicit lists, not `export *`)
      export { assertSsrfAllowedUrl, MediaContentError } from "./media-types.js";
      export type { MediaHostAddress, MediaHostnameResolver, SsrfPolicy } from "./media-types.js";
      ```
      `content.ts` imports `normalizeHostname`/`isBlockedIp` privately (they stay private there); `pinned-fetch.ts` imports `normalizeHostname` **and** re-exports it, because `pinned-fetch.js` has published that name since 0.2.1.
    - Files to Create/Edit (done):
      - `src/media-types.ts` (new, 144 lines): the moved declarations, no imports beyond `node:net`.
      - `src/content.ts`: import from the leaf + explicit re-exports; private `normalizeHostname`/`isBlockedIp`/`isBlockedIpv4`/`isBlockedIpv6`/`parseIpv6Words` deleted (671 → 557 lines).
      - `src/pinned-fetch.ts`: import from the leaf, re-export `normalizeHostname`, local copy deleted, module-header cycle note replaced with the leaf-module note.
      - `scripts/import-hygiene.test.mjs`: `srcRuntimeCycles()` detector + 2 tests (pair assertion with positive control, synthetic-fixture negative fixture).
      - Bookkeeping: `scripts/budgets.json` (`@arnilo/prism` 1282 → 1283 with reason), `scripts/phase16-baseline.json` (regenerated: dist js/d.ts 79 → 81), `docs/_evidence/phase54-package-map.md` (regenerated: root 908 → 909).
  - Test Cases to Write (done):
    - Import-hygiene: fails if `content` ↔ `pinned-fetch` regain a module-scope cycle — the gate detects the whole shipped `src/` runtime import graph and asserts the pair is absent; a positive control asserts the detector still finds the two known pre-existing cycles (`agent-session/create-agent` ↔ `agent-session/session`, `provider-request-policy` ↔ `thinking`, both out of 070 scope), so a parse regression cannot make the gate pass vacuously. The gate is a *pair* assertion, not a frozen cycle set, so it does not bless those two.
    - Synthetic fixture: a temp tree with a value cycle is reported; the same back-edge as `import type` is not (type-only edges are erased and cannot order module init).
    - Existing `content.test.ts`/`pinned-fetch.test.ts` suites green (24 tests) plus the security conformance gates (`phase20-security`, `phase21-security`) that exercise the SSRF gate and `MediaContentError` identity through the barrel.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — re-exports preserve the surface (the barrel names are identical; only the root *source-level* export count moved, which is the budget metric).
    - Docs pages to create/edit: none — verified by grep: the only place the cycle was written down was the `src/pinned-fetch.ts` module header, which now documents the leaf module. `docs/multimodal-content.md` and `docs/host-security.md` describe the SSRF contract, not module layout.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 11 — Shared provider retry HTTP helpers + memory deep-merge delegation
  - Completed 2026-09-11 — `packages/prism-providers/src/shared/retry-http.ts` now owns the HTTP plane (`RETRYABLE_STATUSES`, `readRetryAfterMs`, `parseErrorBody`, the redacting `providerHttpError` builder) and the hyper/NeuralWatt/Command Code classifiers call it; memory's `mergeJsonObjects` delegates to core's public `mergeConfigLayers`. Five deviations from the draft, recorded below: (1) **a third copy existed** — `commandcode/errors.ts` carried the same `RETRYABLE_STATUSES`/`parseErrorBody`/`readHeader`/`readRetryAfterMs`/error-builder bodies as hyper's (Task 1's inventory diffed only hyper vs neuralwatt and missed it), and leaving it would have left the redaction path duplicated exactly as the security criterion forbids — it adopts the shared helpers too; (2) the shared module exports **4** names, not 5: `readHeader`/`readNumber` are module-private (only `readRetryAfterMs` needs them) and the decision shape passed to the error builder is a non-exported interface; (3) `readRetryAfterMs(headers, bodyRetryAfter?)` takes the body fallback as an argument instead of reading `error.retry_after` itself, so NeuralWatt's body field stays a provider-only decision; (4) memory's delegation **re-wraps** core failures as `MemoryValidationError` (core reports a plain `Error`), keeping `code: "validation"` the only observable failure mode of that path; (5) the message for an unsafe key is now core's layer message (`config layer memory patch must be a JSON object`) instead of memory's `Forbidden JSON key: __proto__` — rejection still happens at every depth and fails closed, but the key name is no longer surfaced, which is the price of one shared traversal.
  - Acceptance Criteria:
    - Functional: `hyper`/`neuralwatt` (and `commandcode`) share the HTTP-plane helpers they duplicated (`parseErrorBody`, `readHeader`, Retry-After numeric conversion, secret-redacting error builder), while classifiers and wire semantics stay provider-local (neuralwatt's body `retry_after`, `Headers` support, and `retry_strategy` preservation are provider-only — Task 1 verified; full unification rejected). Memory's `mergeJsonObjects` delegates to core's existing public `mergeConfigLayers`; merged values are value-identical to the previous algorithm and the intentional hardening (patch values cloned, nested unsafe keys rejected, no aliasing) is covered by tests.
    - Performance: No hot-path change (classification runs once per error; merge runs once per patch).
    - Code Quality: `packages/prism-providers/src/shared/retry-http.ts` is the only new module (86 lines); **no new core export** (Task 1: `mergeConfigLayers` already public at `src/index.ts:88`); memory keeps `isPlainObject`/`assertSafeJsonKey`/`cloneJsonObject` for `schema.ts`; hyper 86 → 53, neuralwatt 130 → 81, commandcode 101 → 64 lines.
    - Security: The secret-redaction path lives once (removes the double-maintenance risk); retry decisions still fail closed (unknown → no retry); merge rejects `__proto__`/`prototype`/`constructor` at every depth, and now also rejects non-JSON patch values (undefined, functions, `Date`/`Map`, non-finite numbers) where the old local merge stored them.
  - Approach:
    - Documentation Reviewed:
      - Task 1 findings (diff evidence: 86 vs 130 lines; shared readers vs provider-only `cleanStrategy`/`readNumber`/`Headers` support)
      - `src/providers/transport.ts:55` + `package.json:17-19` (`./providers/transport` public subpath) — `parseRetryAfterMs` is reused, not re-implemented
      - `src/config.ts:39-60,111-121` (`mergeConfigLayers`/`mergeObjects`/`cloneJsonValue`), `packages/memory/src/util.ts:43-70`
      - 0.5.0 CHANGELOG thinking-refactor precedent (per-provider tables + shared core)
    - Options Considered:
      - Full `classifyProviderError(input, RetryTable)`: rejected (Task 1 — classifiers genuinely differ; a forced table would carry provider-specific escapes).
      - Shared HTTP helpers + per-provider classifiers (chosen), adopted by all three copies once `commandcode/errors.ts` showed up in the same diff.
      - Memory: copy core's merge locally (rejected — a second copy); add a new core export (rejected — already public); delegate without re-wrapping (rejected — it would replace `MemoryValidationError`/`code: "validation"` with a bare `Error` on a public path).
    - Chosen Approach:
      - Extract the error-body/header/Retry-After readers and `providerHttpError(providerName, decision, bodyText, secrets)` into `shared/retry-http.ts`; hyper, neuralwatt and commandcode call them (classifiers and wire fields stay provider-local). Memory's `mergeJsonObjects` delegates to `mergeConfigLayers`, re-wrapping core failures as `MemoryValidationError`.
    - API Notes and Examples:
      ```ts
      // packages/prism-providers/src/shared/retry-http.ts
      export const RETRYABLE_STATUSES: ReadonlySet<number>; // 429, 500, 502, 503
      export function readRetryAfterMs(headers: Headers | Record<string, string> | undefined, bodyRetryAfter?: unknown): number | undefined;
      export function parseErrorBody(body: unknown): { error?: Record<string, unknown> } | undefined;
      export function providerHttpError(providerName: string, decision: RetryDecisionFields, bodyText: string, secrets: readonly (string | undefined)[]): Error;
      // packages/memory/src/util.ts
      export function mergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
        try {
          return mergeConfigLayers([{ name: "memory value", config: base }, { name: "memory patch", config: patch }]);
        } catch (error) {
          throw new MemoryValidationError(error instanceof Error ? error.message : "Invalid memory value");
        }
      }
      ```
    - Files to Create/Edit (done):
      - `packages/prism-providers/src/shared/retry-http.ts` (new); `{hyper,neuralwatt}/retry.ts` + `commandcode/errors.ts` adopt it.
      - `packages/memory/src/util.ts`: 12-line delegate (no core change).
      - `docs/provider-primitives.md`: the retry inventory table and its "no generic helper yet" line went stale with this task.
      - Bookkeeping: `scripts/budgets.json` (providers 502 → 506 with reason), `docs/_evidence/phase54-package-map.md` regenerated (providers 470 → 474).
  - Test Cases to Write (done):
    - `packages/prism-providers/src/shared/__tests__/retry-http.test.ts` (7 tests): status table members and non-members; **all three classifiers agree** on the shared table over 10 statuses with `code` = HTTP status and no hint when non-retryable; `Retry-After` from a record, a `Headers` instance, case-insensitive names, fractional seconds and whitespace; absent/malformed/negative values plus the body fallback (only when passed, header wins); `parseErrorBody` envelope shapes; `providerHttpError` message parts, redaction, non-writable numeric `code`, and omitted optional parts.
    - `packages/memory/src/__tests__/util-merge.test.ts` (5 tests): merge values **identical to a reference implementation of the pre-task algorithm** across 10 fixtures (the parity criterion); deep-merge/array-replace behavior; base and patch values cloned (mutating the result cannot reach the caller's patch — the aliasing bug Task 1 found); unsafe keys at depth 1-3 rejected as `MemoryValidationError`; non-JSON values and non-object bases rejected.
    - Existing hyper/neuralwatt/commandcode retry suites green (decisions unchanged: providers 667 tests, 0 fail), memory suite green (351 tests, 0 fail).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — the draft assumed an additive core export `mergeJsonObjects`, but Task 1's chosen approach reuses the already-public `mergeConfigLayers`, so the root surface is untouched; the per-provider subpath barrels keep exactly their previous names, and memory's merge is internal.
    - Docs pages to create/edit: `docs/provider-primitives.md` — its retry/rate-limit inventory table listed only the NeuralWatt classifier and closed with "No generic core helper extracts `Retry-After` … yet"; both statements were stale after this task (deviation from the draft's "configuration/manifests page" note, which described the rejected new-export approach).
    - `docs/index.md` update: no — existing page, one table row added.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
    - Verification note: the full `npm test` chain reached 1722/1722 root tests and 210/213 gate tests with the only failure being `root import startup stays under the sanity ceiling` measured at 272.6-273.3 ms while the host ran `load average 12-23` (three unrelated `rustc` processes at ~88% CPU); the same measurement is 110-140 ms standalone and this task touches no root `src/`. Every other chain segment was run explicitly and passed: gates 13/13 (standalone), build-race 9/9, all 9 workspaces exit 0.

- [x] Task 12 — Dependency bump wave + peer-range decisions
  - Completed 2026-09-11 — every planned range moved in one lockfile pass (`pg`/`@types/pg` 8.23, `playwright-core` 1.63 exact in both consumers, `@office-open/*` 0.14.5, `zod` 4.6.2, `@ai-sdk/{openai,provider}` 4.0.65/4.0.13, ACP SDK 1.4.0 exact, graft peer `^0.16.0 || ^0.18.0`, biome 2.5.13); `npm audit` = 0 vulnerabilities. Three of the bumps were **not** drop-in, and that is the substantive finding of the task: office-open 0.14 broke its parse API, the AI SDK bump needed a matrix row by policy, and the planned graft floor named a version upstream never released. Deviations, in order of consequence:
  - (1) **office-open 0.14.5 is an API break, not a version move.** Upstream made `parseDocument`/`parsePresentation`/`parseWorkbook` return `Promise<…>` and added async-free `parseDocumentSync`/`parsePresentationSync`/`parseWorkbookSync`; it also dropped docx `createWrapThrough`/`createWrapTight`/`SpaceType`. Prism's document adapters now call the new `*Sync` variants, so **no Prism signature changed** (`parseDocxBytes`/`parsePptxBytes`/parse-XLSX wrappers stay synchronous). Verified by tarball diff of `dist/index.d.mts` (0.13.1 vs 0.14.5: only the three `parse*` signatures changed; `parseXlsx`/`parseA1Cell`/`generate*Sync`/xml `Element` identical), by the absence of the removed docx names anywhere in the repo, and by the office golden suite (docx/xlsx/pptx models structurally equal). The three removals cannot affect consumers: Prism's public `.d.ts` re-exports no office-open type.
  - (2) **`@ai-sdk/provider` needed a supported-version matrix row** (repo policy: "adds a matrix row and offline conformance fixture before accepting any new version"). The runtime version gate did its job: seven provider tests failed with `AiSdkProviderError { code: "unsupported_version" }` for `4.0.13` until the row landed. Note for Task 13: both `4.0.10` and `4.0.13` declare `engines.node >= 22` while the repo floor is `>= 20` — pre-existing, unchanged by this bump, and the exact peer stays.
  - (3) **The graft floor is `^0.16.0 || ^0.18.0`, not the planned three-floor range.** Upstream never published 0.17.0 (registry sequence is 0.16.0 → 0.18.0), so `^0.17.0` would be dead weight; the range now names exactly the two released lines Prism validates. Both are smoke-covered by the offline peer-contract suite — `0.16` was the installed devDependency until this task, `0.18` is now (bin `dist/cli.js` discovery + packaged manifest). The suite also gained a permanent drift guard: `GRAFT_PEER_RANGE` must equal the published peer declaration.
  - (4) **The ACP SDK stays an exact pin, bumped to `1.4.0`.** Compatibility *was* verified before deciding (tarball diff of `dist/acp.d.ts` + the SDK's bundled `schema/schema.json`): 1.4.0's only name-level change is stabilizing the SDK's `unstable_createElicitation`/`unstable_completeElicitation` helpers into `createElicitation`/`completeElicitation` — Prism never called the unstable helpers and the wire method names (`CLIENT_METHODS.elicitation_create`) are unchanged; `PROTOCOL_VERSION` is still `1`; `schema.json` gains `compaction` session-update kinds and drops the `env_var` auth variant, neither of which Prism advertises or consumes. Loosening to a caret was rejected on three grounds: protocol SDKs in the freeze manifest are exact-pinned (`@modelcontextprotocol/*`, `@ag-ui/core`), Prism's `.d.ts` re-exports SDK types so consumers' types must match what Prism compiled against, and 1.4.0 itself shows minors do move names on the SDK surface.
  - (5) **Bookkeeping the plan's file list did not name** (each was a gate that failed or would have failed): `scripts/phase12-freeze-manifest.json` (`protocolSdks` pin — asserted verbatim against the manifest — and postgres `driver`), `scripts/phase10-freeze-manifest.json` (`sdk.version`, plus the "ACP SDK exposes no update kind for … compaction" note, now false against 1.4.0), `src/__tests__/docs.test.ts` (live ACP token), `src/__tests__/packaging.test.ts` (playwright/graft peer pins), `src/__tests__/install-smoke.test.ts` (fixture install would ERESOLVE against the new exact peer), `scripts/phase26-coding-journey.test.mjs` (playwright fixture), `biome.json` (`$schema` URL), and the live docs: `release-and-install.md` (upgrade-surface table + Node-20 compat row), `postgres-persistence.md`, `obscura.md`, `browser-automation.md`, `host-security.md`, `acp.md`, `ag-ui.md`, `provider-packages.md`, `provider-conformance.md`, `providers/ai-sdk.md` (matrix), `graft.md` (decision record), and a new `## 0.5.6 → 0.5.7 (peer-range deltas)` section in `migration.md`.
  - (6) **No CHANGELOG entry here** (deviation from this task's doc assessment): plan 070's lockstep-cut task owns the `0.5.7` entry ("records every task delta"), so a partial section would collide with it. Same reason the stored `security-artifacts/sbom.spdx.json` (still listing pre-bump versions) is left to the release task's artifact regeneration. Dated evidence snapshots (`_evidence/review-coverage-2026-07-22-phase-7.md`, `_evidence/codeql-current-2026-09-03.md`, `_evidence/implementation-review-2026-09-03.md`, `docs/history/*`) keep their historical pins untouched.
  - Acceptance Criteria:
    - Functional: `pg`/`@types/pg` 8.23.0/8.23.1 (core peer+dev, memory dep), `playwright-core` 1.63.0 (web-tools dev+peer, office peer), `@office-open/*` 0.14.5 (office; changelog-checked via tarball API diff), `zod` ^4.6.2 (mcp; ag-ui's `^3.25.0 \|\| ^4.0.0` peer unchanged), `@ai-sdk/{provider,openai}` 4.0.13/4.0.65 (providers, + matrix row), `@biomejs/biome` 2.5.13 (dev), ACP SDK exact `1.4.0` (ag-ui + acp-agent, after the compatibility audit above), graft peer `^0.16.0 || ^0.18.0` recorded in `docs/graft.md`.
    - Performance: `npm audit` 0; budget + redaction benchmark gates unchanged and green in the full chain.
    - Code Quality: one lockfile pass after all manifest edits; no skew — playwright-core `1.63.0` in both consumers, `pg` `^8.23.0` in core peer+dev and memory deps, `@types/pg` `^8.23.1` in both, `zod` resolves to a single `4.6.2`, biome 2.5.13 reports 0 findings.
    - Security: `npm audit` 0 vulnerabilities post-bump; office-open 0.14 parser behavior audited by API diff + golden fixtures (all three formats structurally equal).
  - Approach:
    - Documentation Reviewed:
      - `npm outdated` (fresh, 2026-09-11) — matched the review list exactly; `@types/node` left for Task 13
      - Tarball diffs from the registry: `@agentclientprotocol/sdk` 1.3.0 vs 1.4.0 (`dist/acp.d.ts`, `dist/acp.js`, `schema/schema.json`, `schema/v2/schema.unstable.json`), `@office-open/{docx,pptx,xlsx,xml}` 0.13.1 vs 0.14.5 (`dist/index.d.mts`)
      - ACP SDK changelog (1.4.0: "stabilize elicitation APIs", "jsonrpc: report malformed input")
      - Repo freeze/manifest policy: `scripts/phase12-freeze.test.mjs` (protocol pins asserted verbatim), `scripts/phase10-freeze-manifest.json`, `docs/public-contracts.md` protocol table
      - Repo upgrade policy for AI SDK peers: `docs/providers/ai-sdk.md` matrix + "add a matrix row and offline conformance fixture"
    - Options Considered:
      - Bump everything blindly: rejected — office-open 0.14 breaks compilation, which is exactly why the plan split infrastructure from contract deps.
      - ACP caret: rejected (see deviation 4). Graft three-floor range: rejected as dead weight (deviation 3). Office async ripple: rejected — switching Prism's public wrappers to async would break hosts for no functional gain.
    - Chosen Approach:
      - Two-stage as planned: infrastructure bumps, then contract bumps with a go/no-go note each (office-open via golden re-run, ACP via schema+type diff, graft via peer smoke). All manifest edits first, then a single `npm install --no-audit --no-fund` so the lockfile lands once.
    - API Notes and Examples:
      ```jsonc
      // packages/memory/package.json (peer) — 0.17.0 was never released upstream
      "@nanonets/graft": "^0.16.0 || ^0.18.0"
      // packages/prism-providers/src/ai-sdk/types.ts — policy: row + fixture before accepting a version
      { providerVersion: "4.0.13", specificationVersion: "v4" }
      // packages/office/src/documents/translate/docx.ts — 0.14 made parseDocument async; keep our sync surface
      parseDocumentSync as ooParseDocument,
      ```
    - Files to Create/Edit (done): the eight workspace manifests + root `package.json` + `biome.json`; `packages/memory/src/graft/upstream.ts` + its real-peer test; `packages/prism-providers/src/ai-sdk/types.ts`; the three office adapters; `docs/graft.md`, `docs/migration.md`, and the ten other live docs listed in deviation 5; `scripts/phase{10,12}-freeze-manifest.json`, `scripts/phase26-coding-journey.test.mjs`, `src/__tests__/{docs,packaging,install-smoke}.test.ts`; `package-lock.json`.
  - Test Cases to Write (done):
    - No new unit tests; the contract smoke is the gate. Office goldens pass unchanged on 0.14.5 (docx/xlsx/pptx models structurally equal to their `.model.json` fixtures).
    - ACP: ag-ui 226 tests (capability/lifecycle/elicitation mapping), acp-agent 9, plus the SDK-driven gates (`phase10-conformance`, `obscura-host-conformance`, `acp-client-smoke`) green on 1.4.0.
    - MCP conformance on zod 4.6.2 (98 tests in the package + the script gates); memory 351 (graft 0.18 real-peer + pg); providers 674 (AI SDK matrix, 0 fail); office 153.
    - Full chain: root 1722/1722, gate group 213 (211 pass, 2 skipped), build-race 9/9, all 9 workspaces — `npm test` exit 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: peer/dependency ranges moved (not Prism's own exports). Recorded in the new `migration.md` section so hosts on pinned third-party versions know to move.
    - Docs pages to create/edit: the twelve live pages in deviation 5 (deviation from the draft's narrower list — `release-and-install.md`'s upgrade-surface table, the three playwright mentions, the postgres page, the four AI SDK/ACP pages, and `biome.json`'s schema URL were all stale).
    - `docs/index.md` update: no — `migration.md` and `graft.md` are already linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 13 — `@types/node` ↔ engines alignment + lockstep range lint
  - Completed 2026-09-11 — chose option **(a)**: `@types/node` pinned to the oldest supported line for the `engines.node >=20` floor (`^20.19.0`, resolving 20.19.43) in the only two manifests that declare it (root + `packages/prism-coding-tools`), and **`engines` deliberately unchanged**. The pin immediately failed the build on four runnable examples and that failure *was* the defect class this task exists to close; the lockstep lint landed in `validateRelease` (the lockstep validator every gate/publish path routes through) and fails closed on ranges that merely satisfy the cut version. Deviations, in order of consequence:
  - (1) **Option (b) is not justified even though Node 20 is already EOL.** Verified upstream (nodejs/Release README, endoflife.ai): Node 20 ended support **2026-04-30**, Node 22 is maintenance LTS to 2027-04-30, Node 24 active LTS to 2028-04-30. Dropping a supported line means deleting a *measured* CI leg (`node20-compat`), editing the freeze manifest's `supported`/`measuredInCi`/`enginesRange`, and breaking hosts on Node 20 — a support-matrix change that does not belong in a **patch** release. It also would not have closed the drift class by itself: only pinning types to the floor does that, so (b) is strictly more cost for the same safety. Recorded as a follow-up for the next minor (below), not silently dropped.
  - (2) **The pin found a real floor violation in the docs surface: four examples used `import.meta.main`** (`examples/ag-ui-server.ts`, `ag-ui-a2ui.ts`, `ag-ui-mcp-apps.ts`, `durable-loops-and-approvals.ts`). That property exists only on Node ≥22.18/≥24.2, so on the declared Node-20 floor it is merely `undefined` — the examples would silently no-op instead of running — and the docs' "examples need Node >=22.6" note understated the real requirement. All four now use the house guard already used by the other ~30 examples (`import.meta.url === \`file://${process.argv[1]}\``). Verified by executing each: they still print their demo output under native TypeScript stripping, and `docs.test.ts` (which runs the examples) is 152/152.
  - (3) **The strict rule accepts exact pins as well as caret.** The plan's shape was `range === ^version`; upstream of this task, `validateRelease` accepted `0.2.9`-style exact pins (asserted by the retired-but-audit-runnable `scripts/phase30-release.test.mjs`), and `rewriteInternalRanges` only ever writes caret. Rule implemented: `range === version || range === \`^${version}\`` — so the skew this task targets (`^0.5.5` beside `^0.5.6`) fails, while an exact pin at the cut version stays valid. Both forms are covered by tests through the real gate.
  - (4) **Enforcement point is `validateRelease`, not a new assertion in `release-gates.mjs`.** `release.mjs gate --lockstep --version`, the publish/check path (`runRelease`), and `runGates` step 1 all call it, so one change makes every lockstep path fail closed and creates no new import (the file pair already documents avoiding a `release.mjs` ↔ `release-gates.mjs` cycle). Independent mode is untouched — `validateReleaseIndependent` keeps per-package *satisfaction*, which is correct when packages version separately.
  - (5) **Error-message form follows the existing validator.** A standing root test (`src/__tests__/release.test.ts`, `/expected 0\.0\.13/`) caught the first draft's `expected ^0.0.13`, so the message keeps `expected <version>` — consistent with the version-mismatch errors beside it, and the message text is asserted by the new gate test.
  - (6) **The live tree's skew is 7 × `^0.5.5` + 11 × `^0.5.6` = 18 internal ranges** (Task 1 recorded `^0.5.6` ×10 across the workspaces; the 18th is the root manifest's own peer). Left as-is on purpose — the cut rewrites them — and the cut path was proven rather than assumed: on a temp copy of all 10 manifests plus the lockfile, `bumpRelease("0.5.6" → "0.5.7")` + `rewriteInternalRanges("0.5.7", "caret")` then `validateRelease(..., "0.5.7")` **passes**; a bump that forgot `--ranges caret` leaves `^0.5.5` behind and now fails the gate.
  - (7) **Pre-existing failure found in a retired evidence script (not fixed here):** `scripts/phase30-release.test.mjs` "workflow publishes v0.3.0 once and package tags independently" fails because `.github/workflows/release.yml`'s tag list has grown to `v0.5.6` while the assertion still expects only `v0.3.0|v0.4.0|v0.5.0`. 11/12 tests in that file pass, including every lockstep-range test. Logged in Further Actions.
  - Acceptance Criteria:
    - Functional: `@types/node` dev `^20.19.0` in root + `packages/prism-coding-tools` (the only declarers), `engines.node >=20` unchanged in all 10 manifests and the freeze manifest; decision + rationale written into `docs/migration.md`; the release lint requires every `@arnilo/*` range in `dependencies`/`optionalDependencies`/`peerDependencies` to be the cut version exactly and fails closed otherwise.
    - Performance: the lint is pure in-memory work over manifests already loaded by `loadRelease` (O(manifests × dependency fields), no extra I/O, no extra process) inside the gate's existing range step.
    - Code Quality: enforcement lives on the lockstep path only; message form matches the validator's existing style; live skew measured (18 ranges) and the cut path proven to clear it; exact *and* caret pins covered by tests through `runGates`.
    - Security: the drift class is closed — `npm run typecheck` (which compiles `examples/` against the root types) is now floor-accurate, and the four `import.meta.main` uses it caught are gone.
  - Approach:
    - Documentation Reviewed:
      - `npm outdated` / `npm ls @types/node`: `^26.1.1` (26.1.1) at root + `prism-coding-tools`, `engines.node >=20` in all 10 manifests
      - `scripts/release.mjs` (`validateRelease`, `validateReleaseIndependent`, `rewriteInternalRanges`, `satisfiesInternalRange`, the gate/publish mode split), `scripts/release-gates.mjs` (`runGates` step 1 — "lockstep exact-graph, or independent range satisfaction"), `scripts/phase30-release.test.mjs` (lockstep fixtures: exact *and* caret pins)
      - Node support facts: nodejs/Release README + `nodejs.org/en/about/eol` + endoflife.ai (Node 20 EOL 2026-04-30; 22 → 2027-04-30; 24 → 2028-04-30); `import.meta.main` availability (Node 24.2.0 release notes; v22.x backport PR #58693)
      - `docs/migrate-to-0.5.md` (lockstep-range convention), `docs/release-and-install.md` (upgrade-surface table, Node compat matrix + the `docs.test.ts` phrases that pin it)
    - Options Considered:
      - (a) types at the floor, engines unchanged — **chosen**: zero host impact, closes the drift class, no CI/freeze churn.
      - (b) engines to the types target — rejected in deviation 1 (host-breaking patch, loses a measured leg, still needs the types pin).
      - Keeping `@types/node@26` and adding a lint that bans newer APIs — rejected: a bespoke API denylist cannot be complete, and the types package already *is* that lint.
      - Strict caret-only rule / updating the retired phase30 fixture — rejected in deviation 3 (mutating lineage evidence to fit a new rule).
    - Chosen Approach:
      - Patch the two manifests, let the build enumerate the violations (`tsc` found exactly four `import.meta.main` sites), fix them with the in-repo guard, then tighten `validateRelease` one line and prove it with a fixtures-only gate test plus a positive control that the old satisfaction check accepted the skew.
    - API Notes and Examples:
      ```jsonc
      // package.json + packages/prism-coding-tools/package.json
      "@types/node": "^20.19.0",   // tracks the engines floor, not the build machine
      ```
      ```js
      // scripts/release.mjs — validateRelease (lockstep mode)
      if (release.byName.has(name) && range !== version && range !== `^${version}`)
        errors.push(`${pkg.manifest.name} ${field}.${name} is ${range}, expected ${version}`);
      ```
      ```ts
      // examples/*.ts — floor-portable main guard (import.meta.main needs Node >=22.18)
      if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
      ```
    - Files to Create/Edit (done): `package.json`, `packages/prism-coding-tools/package.json`, `package-lock.json`; `examples/{ag-ui-server,ag-ui-a2ui,ag-ui-mcp-apps,durable-loops-and-approvals}.ts`; `scripts/release.mjs`; `scripts/release-gate.test.mjs`; `docs/release-and-install.md`; `docs/migration.md`. No new file: the lint is a change to the existing lockstep validator and the tests extend the existing gate suite.
  - Test Cases to Write (done):
    - `scripts/release-gate.test.mjs`: a minimal tmp release graph (root + 2 workspaces, no dist/exports so the compat gate skips them) driven through the real `runGates` — positive case accepts exact `0.5.7` and caret `^0.5.7`; negative case rejects `^0.5.5` at 0.5.7 and asserts both skewed ranges plus the `ranges:` prefix, with a positive control proving `satisfiesInternalRange("^0.5.5", "0.5.7") === true` so the rejection can only come from the new exact-pin rule.
    - Negative fixture: restoring the previous lax check (`!satisfiesInternalRange(...)`) turns the new test red (9 pass / 1 fail) — the test detects the rule's removal.
    - Regression: `src/__tests__/release.test.ts` 8/8; `scripts/phase30-release.test.mjs` lockstep fixtures pass (caret + exact).
  - Verification (2026-09-11):
    - `npm run build` 0; `npm run typecheck` 0 errors (was 4 before the example guard fix — the only build errors in the whole task); `npm run format:check` clean (1520 files); Biome 0 findings on the touched scripts/examples.
    - Focused: `scripts/release-gate.test.mjs` 10/10 (including the two new gate tests), `dist/__tests__/docs.test.js` 152/152 (executes the examples), `dist/__tests__/release.test.js` 8/8, `scripts/phase30-release.test.mjs` 11/12 (the 12th is the pre-existing workflow-tag drift in deviation 7).
    - Each of the four changed examples executed directly under native TypeScript stripping and still printed its demo output.
    - Live-skew evidence: `validateRelease(loadRelease(root), "0.5.6")` now reports the 7 `^0.5.5` ranges; the temp-copy cut simulation (bump + `--ranges caret`) ends with `validateRelease(..., "0.5.7")` passing.
    - Full `npm test` **exit 0** (root 1722/1722, gate group 215 with 213 pass / 2 skip, build-race 9/9, all 9 workspace suites 0 fail). Two earlier full runs failed only on the pre-existing load-sensitive startup ceiling (median-of-3 wall clock 1104.8 ms / 1108.0 ms while the box carried `load average ~25`; the same gate passed 5/5 standalone group runs at 92-113 ms single-sample, and 583.7 ms test-duration in the green run) — logged in Further Actions as release-blocking.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, dev-tooling and gate only — no Prism import, store, or event change, `engines` unchanged. Host-facing text is the explicit "no floor change in 0.5.7" statement plus the types policy.
    - Docs pages to create/edit: `docs/release-and-install.md` (upgrade-surface row `^20.19.0` / 20.19.43 + the policy clause that dev type packages track the declared floor and that moving the floor is a support-matrix change) and `docs/migration.md` (0.5.6 → 0.5.7 section: the types pin, the Node-20-EOL note with the follow-up decision, and the lockstep-range guarantee).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 14 — Split `model-router.ts` and `mcp/server.ts` OAuth section
  - Completed 2026-09-11 — `enterprise/postgres/model-router/` now holds `index.ts` (1-line public barrel), `state-store.ts` (29), `util.ts` (281), `capacity.ts` (218), `circuit.ts` (212), `reservations.ts` (244), `expiry.ts` (128); `mcp/src/oauth-metadata.ts` (87) carries the RFC 9728 discovery surface and `server.ts` dropped 872 → 803 lines. Every new file is under the 400-line bar. Deviations, in order of consequence:
  - (1) **`capacity.ts` became two files.** The plan bundled "reservations + rate-capacity" into one module; measured with the rate path (`consumeRate`, `enforceRateCapacity`), the budget counters (`readBudget`, `addUsage`, `enforceBudgetCapacity`) and the reservation lifecycle (`reserveBudget`, `commitBudget`, `releaseBudget`, `selectBudget`/`updateBudget`/`findReservation`/`reservationRetryAfterMs`) it lands at ~420 lines, breaking the "<400 lines per new file" criterion. Split at the domain seam: rate/counter capacity stays in `capacity.ts`, the reservation lifecycle in `reservations.ts` (which imports `enforceBudgetCapacity` from `capacity.ts` — one direction, no cycle).
  - (2) **The factory became a 29-line façade.** The plan's API note showed the index barrel but not the factory shape, while the acceptance criterion asks for the implementation to sit *behind* `createPostgresModelRouterStateStore`. All nine method bodies moved verbatim into module functions; the factory now qualifies the three tables once and delegates. Signatures take `Parameters<ModelRouterStateStore["x"]>[0]` / `Awaited<ReturnType<...>>`, so the store contract stays the single source of truth and no input type can drift from it.
  - (3) **One internal import specifier changed.** NodeNext does not resolve directory indexes, so a directory split requires `enterprise.ts` to import `./model-router/index.js`. That is the only importer in the repo; the public subpath `@arnilo/prism-core/enterprise/postgres` and its `.d.ts` surface are untouched (the module was never in the package `exports` map).
  - (4) **`scripts/tooling-gate.test.mjs` scanned a hardcoded file path.** Its "keeps DDL out of the least-privilege enterprise request path" check read `${basePath}/model-router.ts`; after the split that path is a directory, so the scan would have thrown — and had it been left pointing at a bare barrel it would have silently gone vacuous (no SQL left in it). It now walks `model-router/` recursively, and asserts the scanned text contains `prism_model_router_` so the DDL check can never pass by scanning nothing. Also note the plan's "RFC 9207" label was wrong: protected-resource metadata is **RFC 9728** (the code and doc comments already said so).
  - (5) **The 401 challenge moved with the discovery block.** `unauthorized` → `unauthorizedResponse` in the new module, with a module-local `UNAUTHORIZED_BODY` so it does not need `server.ts`'s generic `httpError` (9 non-OAuth call sites) — that keeps the dependency one-way (`server.ts` → `oauth-metadata.ts`) and keeps the 401 body shape defined once. The inlined metadata document literal became `protectedResourceMetadata()`, so the discovery document lives beside the validation that guarantees it. Behavior is byte-identical: same status, same body, same `www-authenticate` challenge, same `cache-control: no-store` on the document.
  - (6) **Export-budget rebaseline: `@arnilo/prism-core` 1280 → 1333, `@arnilo/prism-mcp` 129 → 134.** A cross-file split necessarily exports what used to be file-private (moved helpers, row types, the `RouterTables` seam). The gate counts export *names* per package, so this is the mechanical cost of the split; public barrels remain `createPostgresModelRouterStateStore` and the three MCP entry points. `docs/_evidence/phase54-package-map.md` was regenerated (dist-surface counts moved 1174 → 1223 and 123 → 127).
  - (7) **`scripts/phase16-baseline.json` refreshed** — the committed root counts were stale at 79 JS/79 DTS against a tree that measures 81/81 (drift predating this task; the file is regenerated by `scripts/phase16-tree-shake.mjs`, which the freeze gate runs).
  - Acceptance Criteria:
    - Functional: router split behind the factory into circuit / rate-capacity / reservations / expiry submodules with a 1-line barrel; MCP OAuth discovery (constant, validation, document, challenge) in its own module; public exports and package subpaths unchanged.
    - Performance: identical queries and transaction boundaries (all 34 SQL template literals byte-identical, modulo the table-identifier variable); one extra import hop, no added runtime indirection beyond the delegate call.
    - Code Quality: every new file < 400 lines (largest: `util.ts` at 281); the seams are exactly the private helpers the plan named (`selectCircuit`/`insertCircuit`/`updateCircuit`/`ensureCircuitCapacity`; `reopenExpiredProbes`/`deleteExpiredRouterRows`/`pruneExpiredReservations`; `enforceRateCapacity`/`enforceBudgetCapacity`; `withTransaction`); dependency graph is a DAG (`util` ← `circuit`/`capacity`/`expiry`, `capacity` ← `reservations` ← `state-store` ← `index`).
    - Security: transaction boundaries and SQL moved verbatim; the DDL scan still covers every router source file (now with a non-vacuity assertion); no new cycle, so `scripts/import-hygiene.test.mjs` stays green.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-core/src/enterprise/postgres/model-router.ts` (pre-split function map: `withTransaction` L486, circuit helpers L526-603, capacity/expiry L604-745, row access L746-803, validation/codecs L804-990)
      - `packages/mcp/src/server.ts` (OAuth block L799-863; discovery route L481-492; challenge call sites L499/L502; `httpError` L794 shared by 9 non-OAuth paths)
      - `plans/016-Release-0-1-4-God-Module-Split.md` (barrel compat + budget re-baseline convention), `plans/070` Task 8 (flat-sibling vs directory choice, explicit re-export lists)
      - `scripts/tooling-gate.test.mjs` (hardcoded `model-router.ts` path), `scripts/release-skip-manifest.mjs` / `scripts/enterprise-postgres-sql-inventory.json` (protected classes: request-path verbs only, no file list to update)
    - Options Considered:
      - Keep `model-router.ts` as a flat barrel with `model-router-*.ts` siblings (Task 8's shape): preserved the tooling-gate path, but left that gate scanning a barrel with no SQL (silently vacuous) and diverged from the plan's directory + `index.ts`. Rejected.
      - Verbatim factory in `state-store.ts` (428 lines) with only helpers split out: rejected because the acceptance criterion caps *new* files at 400 lines and the factory would become the new god file.
      - Split router only, leave MCP: rejected — the OAuth section is an isolated ~65-line seam with its own tests (`packages/mcp/src/__tests__/auth.test.ts`).
    - Chosen Approach:
      - Slice the original file by block (python, no retyping), dedent the method bodies, substitute only the table identifier (`circuits`/`rates`/`budgets` → the `table` parameter, `tables.*` in `cleanup`), and let TypeScript + Biome + the existing suites prove the move.
    - API Notes and Examples:
      ```ts
      // enterprise/postgres/model-router/index.ts — the whole public surface
      export { createPostgresModelRouterStateStore } from "./state-store.js";
      ```
      ```ts
      // state-store.ts — façade over the submodules (identical behavior)
      export function createPostgresModelRouterStateStore(pool: Pool, schema: string): ModelRouterStateStore {
        const tables: RouterTables = { rates: qualifyTable(schema, "prism_model_router_rates"), /* … */ };
        return {
          consumeRate: (input) => consumeRate(pool, tables.rates, input),
          /* … */
          cleanup: (input) => cleanup(pool, tables, input),
        };
      }
      ```
      ```ts
      // oauth-metadata.ts — discovery document + challenge, no dependency on server.ts
      export const WELL_KNOWN_OAUTH_PROTECTED_RESOURCE = "/.well-known/oauth-protected-resource";
      export function unauthorizedResponse(resource: NormalizedProtectedResource | undefined, request: Request): Response
      export function protectedResourceMetadata(resource: NormalizedProtectedResource): { authorization_servers; resource; scopes_supported? }
      ```
    - Files to Create/Edit (done): `enterprise/postgres/model-router/{index,state-store,util,circuit,capacity,reservations,expiry}.ts` (directory split; `model-router.ts` deleted), `enterprise/postgres/enterprise.ts` (import specifier), `mcp/src/oauth-metadata.ts` (new), `mcp/src/server.ts`, `scripts/tooling-gate.test.mjs`, `scripts/budgets.json`, `scripts/phase16-baseline.json`, `docs/_evidence/phase54-package-map.md`.
  - Test Cases to Write:
    - No new tests (plan): the existing enterprise router suites, MCP auth/OAuth conformance suites, and package-surface gates cover both splits unmodified.
  - Verification (2026-09-11):
    - **Verbatim proof:** every SQL template literal extracted from the pre-split file and from the new modules is an identical multiset (34/34) once the table identifier is normalized; every SQL-bearing source line of the old file appears unchanged in the new tree. The only old lines with no new counterpart are signatures, the table-qualification consts, the substituted table identifiers, and the inlined metadata document now assembled by `protectedResourceMetadata()`.
    - Build 0 (clean rebuild after `npm run clean`, which also removed the stale `dist/enterprise/postgres/model-router.js`); `npx biome lint .` 0 findings (one now-unused `isLoopbackHostname` import dropped from `server.ts`); `npm run format:check` clean (1527 files).
    - Suites: `@arnilo/prism-core` 528 (519 pass / 0 fail), `@arnilo/prism-mcp` 98/98 (covers the discovery route, challenge header, and scope quoting in `auth.test.ts`), gate group 213/215 with 2 skips and 0 fail (includes `phase11-conformance` OAuth assertions, `e2e-enterprise-journey`, `phase24-truth`, `packaging-current`, `import-hygiene`, `budget-gate`, `tooling-gate`), build-race 9/9, and full `npm test` **exit 0** (root 1722/1722).
    - Live-Postgres router suites (`model-router.integration.test.ts`) cannot run in this environment (`PRISM_TEST_POSTGRES_URL` unset, no local server); the literal-identity check above is the substitute evidence and CI's `test:postgres` leg exercises them. One gate-group run failed only on the known load-sensitive startup ceiling (median 1431 ms at load ~47); the immediate re-run passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — identical exports, identical package subpaths, identical SQL and HTTP responses.
    - Docs pages to create/edit: none (internal structure only; `docs/_evidence/module-decomposition-2026-09-03.md` is a dated snapshot and was left as-is, same call as Task 8).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 15 — Test-chain aggregation + live workspace-shape helper
  - Completed 2026-09-11 — `scripts/run-all-tests.mjs` runs the same five stages (build, root suites, gate suites, build race, workspace suites), always runs all of them, prints one summary table, and exits nonzero if any failed; `package.json` `test` is now `node scripts/run-all-tests.mjs`. `workspaceShape()` was added to the existing `scripts/package-truth.mjs` and the nine `phase13-21` freeze suites now call it instead of re-deriving the partition inline (178 lines of duplicated derivation deleted, frozen delta constants untouched). Deviations, in order of consequence:
  - (1) **Moving the chain out of `package.json` broke the assertions that police it, and they had to move too.** ~10 sites asserted the chain by string-scanning `scripts.test`: `scripts/truth-current.test.mjs` (the 6-gate "release/security gates stay in the npm test run" check plus the "retired historical freeze/release gates stay out" check) and `src/__tests__/docs.test.ts` (benchmark-0.1.0 envelope, the two e2e journeys, and the budget gate). Left alone, the *positive* checks would have failed and — worse — the *negative* checks would have passed vacuously against a one-line string that names no gate at all (the exact "assertion that cannot fail" trap Task 1 was hunting). They now read the **effective chain**: `package.json` `test` plus the runner's stage list, via the exported `effectiveTestChain()` in JS and a 3-line `npmTestChain()` text read in the TS suite (a cross-language import of an `.mjs` from `src/__tests__` would need `allowJs`/type plumbing for no benefit). The same 8 retire-set assertions in `phase15/16/17/18/19/20/21/26-freeze.test.mjs` were switched to `effectiveTestChain()` for the same reason.
  - (2) **There is no shell in the runner, so the dist glob is expanded in JS.** `node --test <dir>` does not search a directory (verified: `MODULE_NOT_FOUND` on Node 24 — directory arguments are treated as module paths) and glob arguments in `--test` only exist from Node 22, while this package still declares `engines.node >=20`. A 12-line `expandGlob()` handles the one shape the chain uses (`<dir>/*.<suffix>`), runs at execution time only (importing the runner never reads the tree), fails closed on no matches, and lets `effectiveTestChain()` keep rendering the familiar `dist/__tests__/*.test.js`. The root-suites stage still reports the same 1722 tests.
  - (3) **`workspaceShape()` drops the historical name exclusions** (`computer-use-linux`, `prism-wiki`, `obscura`, `prism-dev`, `prompts`, `documents`, `sheets`, `diagrams`): none of those directories exists any more, and the `packages/<dir>/package.json` check already excludes a non-package directory. Returns `{ dirs, names, providerDirs, prismDirs, capabilityDirs }` from one `readdirSync` (+ one `existsSync` per entry) and no manifest reads — `dirs` are absolute paths, `names` and the three partitions are directory basenames.
  - (4) **`scripts/run-all-tests.test.mjs` (new) is itself a chain stage**, so the aggregation contract is enforced by the gate it describes: injected-executor fixtures prove a failing stage does not short-circuit (all stages run, every non-zero status is reported, statuses are captured and not just the first), a *throwing* stage counts as a failure instead of aborting the run (the executor now catches), the all-pass path reports none, and the gate policy is asserted with positive controls (protection gates in, retired gates out, `STAGES.length >= 5`, build-race and the runner's own test present). Stage output is inherited unchanged, so each stage's own TAP summary — including its skip lines, the release skip-manifest evidence — still streams per stage.
  - (5) **Runner shape:** `STAGES = [{ name, command, args }]` with `process.execPath` for node stages (no `PATH` dependency), `stdio: "inherit"`, one `spawnSync` per stage, `pass`/`FAIL` + per-stage ms in the table, and only the two dist-consuming stages keep their `with-build-lock.mjs` wrapper (the build-race stage stays unwrapped on purpose — its children must acquire the real lock). `executeStage` maps a null status (signal-killed) to failure.
  - Acceptance Criteria:
    - Functional: `npm test` runs every stage even when an earlier stage fails, reports all failures, exits nonzero if any failed; `scripts/package-truth.mjs` gained `workspaceShape()` (live names + provider/prism/capability partition) and the phase13-21/benchmark-style scripts stopped re-deriving that partition inline; the historical delta constants stayed.
    - Performance: same stages, same commands, one runner; `workspaceShape()` is one `readdirSync`; the runner adds nothing measurable (5 spawns where the chain had 5 segments).
    - Code Quality: plain Node script, stdlib only (`node:child_process`, `node:fs`, `node:path`, plus `readManifest` reused from `package-truth.mjs`); import-safe under the house direct-execution guard (`scripts/import-hygiene.test.mjs` green); no historical counts moved out of the freeze scripts.
    - Security: fails closed — nonzero exit if any stage fails, a stage that cannot even start is a failure, and a dist glob with no matches is an error rather than a vacuous pass.
  - Approach:
    - Documentation Reviewed:
      - Task 1 findings (existing `package-truth.mjs` API: `computePackageTruth`/`expandWorkspaceDirs`/`readManifest`; `phase24-truth`/`packaging-current` consumers; `phase13-freeze.test.mjs:158-179` delta pattern)
      - VENT 26-08-15/26-08-20/26-09-01 (chain hiding, count drift, duplicated deltas); `package.json` `test` (33-file gate segment + build-race + workspaces)
      - `scripts/with-build-lock.mjs` (leaf-only acquisition: never wrap an orchestrator; `PRISM_BUILD_LOCK_HELD` non-nesting guard), `scripts/phase23-build-race.test.mjs` (builds its own leaf commands, does not parse the chain), `scripts/release-skip-manifest.mjs` (reads counts from a baseline JSON, never by running npm test), `scripts/import-hygiene.test.mjs` (importable-script convention)
      - `docs/_evidence/phase23-primitive-review.md` (the dist consumer that must stay behind the lock)
    - Options Considered:
      - Directory argument (`node --test dist/__tests__`): rejected — Node treats it as a module path (reproduced `MODULE_NOT_FOUND`), and glob args need Node >=22.
      - A stage list in a new JSON file (read by both the runner and the TS suite): rejected — a second artifact for data that only the runner needs; `effectiveTestChain()` keeps it in one place.
      - Replace the freeze deltas with computed truth: rejected (Task 1 — they are historical evidence; deleting them erases lineage).
      - Keeping `package.json` as the chain and wrapping it: no form of that aggregates (`&&` is the defect), so the chain had to become data.
      - Runner + shared live-partition helper, deltas untouched (chosen).
    - Chosen Approach:
      - `scripts/run-all-tests.mjs` executes the stage list, aggregates pass/fail, prints one table, exits nonzero on any failure; `package.json` `test` delegates to it. `workspaceShape()` added to the existing `package-truth.mjs`; the phase13-21 freeze suites (and every chain-policing assertion) import from those two modules instead of re-deriving.
    - API Notes and Examples:
      ```js
      // scripts/package-truth.mjs (addition)
      export function workspaceShape(rootDir = DEFAULT_ROOT) {
        // { dirs, names, providerDirs, prismDirs, capabilityDirs }
      }
      ```
      ```js
      // scripts/run-all-tests.mjs
      export const GATE_FILES = [ /* 34 files, this runner's test included */ ];
      export const STAGES = [ /* build, root suites, gate suites, build race, workspace suites */ ];
      export function effectiveTestChain(rootDir = ROOT) {
        return [scripts.test, ...STAGES.map(renderStage)].join(" && ");
      }
      export function runStages(stages = STAGES, { execute, write } = {}) {
        return { results, failed };
      }
      ```
    - Files to Create/Edit (done): `scripts/run-all-tests.mjs` (new), `scripts/run-all-tests.test.mjs` (new), `scripts/package-truth.mjs` (extended, not recreated), `package.json` `test` script, `scripts/phase13-21-freeze.test.mjs` (partition → `workspaceShape()`; retire-set assertions → `effectiveTestChain()`), `scripts/phase26-freeze.test.mjs`, `scripts/truth-current.test.mjs`, `src/__tests__/docs.test.ts`.
  - Test Cases to Write (done):
    - Runner: a failing stage does not short-circuit (both fake stages ran, both reported, non-zero failures collected); a throwing stage is a failure; the all-pass path reports none; the effective chain contains every `GATE_FILES` entry, the package.json delegate, the build-race stage and the workspace stage, and excludes every retired `phase\d+-(freeze|release)` gate.
    - `workspaceShape()` partition matches the live tree: asserted by the nine freeze suites themselves (live-tree assertions green) and by `truth-current`/`phase24-truth`/`packaging-current` staying green (the generated `scripts/package-truth.json` artifact is unaffected — `computePackageTruth` did not change).
  - Verification (2026-09-11):
    - **Aggregation, real chain:** an earlier red run proved it on the real stages — `gate suites` FAIL at 83.1 s while `build race` and `workspace suites` still ran to completion and the process exited 1 with the table naming the failed stage. **Aggregation, real spawn:** `runStages` with `node -e "process.exit(3)"` then a printing stage → both ran, `FAIL fails` / `pass still runs`, `1 of 2 stages failed`, status captured as 3.
    - **No stage dropped:** the set of `scripts/*.test.mjs` in the effective chain vs. the pre-change `package.json` chain → 0 dropped; 2 added (this runner's own test, and Task 9's `benchmark-redaction.test.mjs`, already in the working tree).
    - **Glob equivalence:** the root-suites stage reports 1722/1722 in the green run, same as the shell-glob chain.
    - **`workspaceShape()`:** the nine freeze suites that now use it pass their live-tree assertions (13: 14/15, 14: 16/16, 15: 21/21, 16: 19/19, 17: 20/20, 18: 17/17, 19: 18/18, 20: 22/23, 21: 23/24). The remaining failures are pre-existing and reproduce byte-identically on a pristine `git worktree` of HEAD (phase20/21 shared `docs/index.md` marker drift, phase26's `docs/0.1.0-readiness.md` ENOENT after the plan 068 docs split); phase13's failure is this working tree only, because Task 12 edited `scripts/phase12-freeze-manifest.json`, making it newer than the phase13 baseline the mtime assertion compares against (logged in Further Actions).
    - Incidental (Task 4 leftovers surfaced by `biome check` while verifying this task): two `assist/source/organizeImports` errors in `src/index.ts` and `src/__tests__/tool-result-content.test.ts` were applied (pure name reordering, no surface change — `public-export-contract`, `packaging-current` and the phase54 map stay green). The gated checks (`biome lint`, `format:check`) were already clean.
    - Full `npm test` **exit 0** through the new runner: `pass 4134ms build / pass 13569ms root suites / pass 32851ms gate suites / pass 10432ms build race / pass 22649ms workspace suites` — "all 5 stages passed" (root 1722/1722; gate group 220 tests, 216 pass / 2 skip; build-race 9/9; workspaces 583/674 with 91 skips). Lint clean (`npx biome lint .` 0 diagnostics after dropping two now-unused `pkg` locals in `docs.test.ts`), `scripts/import-hygiene.test.mjs` green, `docs.test.ts` 152/152, `truth-current` 9/9.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — dev tooling. (`npm test` now aggregates; no documented chain internals exist in `docs/`.)
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 16 — Host-hardening additive: ACP round-trip tests, browser idle TTL, SsrfPolicy CIDR
  - Completed 2026-09-11 — all three additions landed with no default change for existing hosts: (1) the acp-agent suite now drives the **spawned bin over stdio with the real `@agentclientprotocol/sdk` client** (initialize → session/new → set_mode → set_config_option → prompt → close) plus refused/cancelled permission outcomes, (2) `BrowserLimitOptions.idleRunTtlMs` (default 0 = off, hard cap = the run wall-time cap) arms one unref'd sweep that disposes untouched runs exactly like `closeRun`, (3) `SsrfPolicy.allowedCidrs` (IPv4 + IPv6) is checked at the URL gate and at every resolved-candidate check. Deviations, in order of consequence:
  - (1) **The plan's "invalid CIDR fails closed at policy construction" has no construction site.** `SsrfPolicy` is a plain host-supplied object everywhere (`content.ts`, `pinned-fetch.ts`, OPA/OIDC/web-tools passthroughs) — there is no constructor or resolver to validate in. The check is therefore validated **eagerly inside `assertSsrfAllowedUrl`** (before the `allowedHostnames` short-circuit, so a malformed list can never be silently ignored) and re-validated at the two resolved-candidate checks that do not go through it... they do go through it: `pinnedFetch`'s candidate loop reuses `assertSsrfAllowedUrl`, and `content.ts`'s `resolvePublicAddress` calls the same shared `isAllowedByCidr` helper. Net: one shared parser, one fail-closed rule, three call sites. The test-case wording was rewritten to match reality rather than inventing a constructor.
  - (2) **Membership is applied after the denied-name list, but validation is not.** "Bypasses only the private-IP block" is enforced by ordering inside `assertSsrfAllowedUrl`: credentials/scheme → denied names (`localhost`, `*.localhost`, `*.local`, `metadata`, `metadata.google.internal`, `instance-data`) → CIDR membership → `isBlockedIp`. The CIDR list is *parsed* first so `{ allowedCidrs: ["bad"] }` fails closed even for a hostname URL or an allow-listed hostname. A CIDR list can never admit a *hostname* (only IP literals and resolved answers); the plan's `metadata.google.internal`-with-`0.0.0.0/0` case is asserted to stay denied.
  - (3) **Family mismatch is skipped, not an error.** A policy listing both `10.0.0.0/8` and `fd00::/8` must serve v4 and v6 targets; only an unparseable entry (bad prefix, non-IP base, `/33`, `/129`, missing prefix) throws `ssrf_denied`. Malformed entries are validated even when the tested family cannot match.
  - (4) **`pinnedFetch` keeps `allowedCidrs` while stripping `allowedHostnames` for candidate checks.** The existing invariant "a hostname allow-list must not whitelist a private resolved address" is unchanged (asserted), but a CIDR is a range rule and *does* apply to resolved answers — so the candidate policy now drops only the hostname list.
  - (5) **Browser: `validate()` gained a 0 floor for `idleRunTtlMs` only** (every other cap keeps "positive safe integer"), and the sweep interval is `ttl / 2`, so a stale run is released in 1.0–1.5 × TTL instead of up to 2 × TTL. `lastUsedAt` is refreshed on enqueue *and* on completion, and the sweep skips any run with `queued > 0`, so in-flight work is never disposed mid-action. Reaping is manager-scoped (one interval, cleared by `manager.close()`), not per-run.
  - (6) **Public-surface cost was rebaselined** (both additive and internal-class exports): root `@arnilo/prism` 1283 → 1284 (`isAllowedByCidr` in the `src/media-types.ts` leaf, shared by the URL gate and both candidate checks; **not** in the root barrel — `SsrfPolicy.allowedCidrs` stays type-only there), `@arnilo/prism-web-tools` 300 → 302 (`DEFAULT_IDLE_RUN_TTL_MS` + `HARD_IDLE_RUN_TTL_MS` re-exported from the browser subpath). `docs/_evidence/phase54-package-map.md` regenerated (`node scripts/phase54-package-map.mjs`). Compat baselines untouched (they are frozen evidence; live gates only compare against them).
  - (7) **The new spawn test asserts rejection, not message text.** The ACP wire layer maps Prism's `AcpError` to a bare `Internal error`, so `set_mode`/`set_config_option` validation failures are asserted as request rejections plus "the rejected writes changed nothing" (`current_mode_update` count 1, `config_option_update` count 1, then a valid write still flips the value back to false). Exact messages stay covered by the in-process ag-ui suite. Also recorded: `session/set_config_option` needs `type: "boolean"` on the wire (the SDK validates params and returns `-32602` without it).
  - Acceptance Criteria:
    - Functional: `acp-agent` has spawn round-trip + mode/config negotiation + permission-denial coverage against the real SDK; `BrowserLimits.idleRunTtlMs` auto-closes untouched runs (context + pages disposed) with later calls failing `ERR_PRISM_BROWSER_STATE`, `closeRun` unchanged, default off; `SsrfPolicy.allowedCidrs` (IPv4 + IPv6 IP-literal ranges) checked after the hostname checks, admitting allow-listed CIDR membership past the private-IP block only, with the trust implication documented.
    - Performance: one unref'd `setInterval` per manager (only when the TTL is enabled); CIDR matching is pure BigInt arithmetic on ≤128 bits, no I/O.
    - Code Quality: additive options follow the existing limits-resolution/`MediaContentError`/`BrowserError` patterns; no new default is on for existing hosts; the CIDR parser lives once in the SSRF leaf module.
    - Security: the reaper bounds contexts leaked by abandoned runs; malformed CIDRs fail closed; metadata-hostname/loopback/credential denials and the hostname allow-list semantics are unchanged and asserted; private answers still fail closed without an explicit range.
  - Approach:
    - Documentation Reviewed:
      - `packages/acp-agent/src/__tests__/agent.test.ts` (existing raw-JSON-RPC bin test, `writeProvider`, fs round-trip), SDK client surface (`client`, `methods`, `ndjsonStream`, `PROTOCOL_VERSION`, `ClientCapabilities.session.configOptions.boolean`, `SetSessionConfigOptionRequest` param schema), `packages/ag-ui/src/acp/agent/{core,permission-elicit,decision,modes}.ts`
      - `packages/web-tools/src/browser/{manager,limits,index}.ts`, `actions/types.ts` (`RunSession`), `__tests__/fake-playwright.ts` (`FakeContext.closed`), `__tests__/browser.test.ts` (fixtures)
      - `src/media-types.ts` (Task 10 leaf: `SsrfPolicy`, `assertSsrfAllowedUrl`, `isBlockedIp`, `parseIpv6Words`), `src/content.ts:459-470` (`resolvePublicAddress`), `src/pinned-fetch.ts:105-125` (candidate policy), `docs/{browser-automation,multimodal-content,host-security}.md`
    - Options Considered:
      - Idle TTL vs document-only discipline: knob chosen (discipline leaves the leak); CIDR allow-list vs telling hosts to use `allowedHostnames` (hostnames cannot express "10.0.0.0/8 but never 169.254.0.0/16"): CIDR chosen.
      - CIDR as a string-prefix check: rejected — `10.0.0.0/8` vs `10.1.2.3` needs real arithmetic, and BigInt covers v4+v6 in one path.
      - Validating CIDRs only when an IP literal is tested: rejected — an off-family policy would silently pass; validation is eager.
      - A per-run timer for the reaper: rejected — N timers for one global rule; one manager-scoped interval.
      - Spawning the bin for the denial test: rejected (the denial/decision path is identical in-process) — the spawn is used where it adds signal (stdio JSON framing + initialize/new/setMode/setConfigOption negotiation).
    - Chosen Approach:
      - `docs/media-types.ts`-leaf CIDR matcher (`isAllowedByCidr` + `parseCidr` + `addressToBigInt`, BigInt) used by the URL gate and both candidate checks; `resolveBrowserLimits`/`RunSession.lastUsedAt`/one unref'd sweep in `createBrowserManager`; new spawn round-trip and denial tests in the acp-agent suite.
    - API Notes and Examples:
      ```ts
      // SsrfPolicy (additive)
      readonly allowedCidrs?: readonly string[]; // "10.0.0.0/8", "fd00::/8" — literals and resolved answers
      // BrowserLimitOptions (additive; ResolvedBrowserLimits.idleRunTtlMs, default 0 = off)
      readonly idleRunTtlMs?: number;
      ```
      ```ts
      // SsrfPolicy + allowedCidrs deny the metadata name even when a /0 range covers its address
      assertSsrfAllowedUrl("http://169.254.169.254/latest/meta-data", { allowedCidrs: ["10.0.0.0/8"] }); // throws ssrf_denied
      assertSsrfAllowedUrl("http://metadata.google.internal/x", { allowedCidrs: ["0.0.0.0/0"] });        // throws ssrf_denied
      ```
    - Files to Create/Edit (done): `src/media-types.ts` (policy field + `isAllowedByCidr`/`parseCidr`/`addressToBigInt`), `src/content.ts` (`resolvePublicAddress` range check), `src/pinned-fetch.ts` (candidate policy keeps `allowedCidrs`), `src/__tests__/{content,pinned-fetch}.test.ts`, `packages/web-tools/src/browser/{limits,manager,index}.ts` + `actions/types.ts`, `packages/web-tools/src/browser/__tests__/browser.test.ts`, `packages/acp-agent/src/__tests__/agent.test.ts`, `scripts/budgets.json`, `docs/_evidence/phase54-package-map.md`, `docs/{browser-automation,multimodal-content,host-security}.md`.
  - Test Cases to Write (done):
    - ACP: spawn round-trip with the real SDK client over stdio (defaults mode negotiated, `availableModes` order, mode switch + `current_mode_update`, boolean config option + `config_option_update`, invalid mode/config-id rejections with no state change, prompt `end_turn`, clean exit 0); refused (`reject-once`) **and** cancelled permission outcomes never reach the client fs and never write disk, while exactly one permission request is raised.
    - Browser: an active run (4 reads spaced under the TTL, with an explicit "loop outlasted the TTL" guard) is never reaped; after going idle the run is reaped, the context is closed, later calls fail `ERR_PRISM_BROWSER_STATE`, and a subsequent run starts normally; TTL 0/absent = no reaper (run survives 500 ms); `resolveBrowserLimits` accepts 0 and rejects `-1`, `1.5`, `NaN`, `HARD + 1`.
    - SSRF: allow-listed v4/v6 literals admitted; uncovered private neighbours (`172.16.0.1`), IPv4-mapped literals (`[::ffff:10.0.0.1]` is an IPv6 address, so a v4 range must not cover it), link-local/metadata literals, and metadata/loopback names denied; unparseable entries fail closed for public URLs, private URLs, hostname URLs and alongside `allowedHostnames`; resolved answers inside a range admitted (`resolvePinnedAddress` + `resolveMediaContentBlock` `requestUrl` seam) while metadata answers, out-of-range answers, hostname-allow-listed private answers and malformed policies stay denied; `/0`-style range still refuses the metadata hostname.
  - Verification (2026-09-11):
    - **Negative controls (both new behaviours):** neutralizing the browser activity clock (both `lastUsedAt` writes) fails "idleRunTtlMs reaps untouched runs…"; switching the denial test's permission outcome to `allow-once` fails "a refused tool must never reach the client fs". Restored → green.
    - Scoped: acp-agent 11/11 (includes the spawn round-trip and the two denial shapes), web-tools browser 17/17, root content 18/18 + pinned-fetch 9/9; `npm run build` (all packages) and `npx biome check .` clean.
    - Budget/evidence: budget gate green after the rebaseline (root 1284, web-tools 302) and the phase54 map regeneration; an intermediate failure — a hand-edited `scripts/budgets.json` missing a closing quote — was caught by every budget consumer (`SyntaxError: Bad control character…`), fixed, and the file re-parsed.
    - Full `npm test` **exit 0**: `pass 3398ms build / pass 13817ms root suites / pass 39361ms gate suites / pass 13378ms build race / pass 24847ms workspace suites` — "all 5 stages passed".
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two additive option surfaces (`SsrfPolicy.allowedCidrs`, `BrowserLimitOptions.idleRunTtlMs`).
    - Docs pages to create/edit: `docs/browser-automation.md` (caps bullet gains "idle run TTL 0 (off)/30min" + a dedicated bullet for the reaper's semantics and failure mode), `docs/multimodal-content.md` + `docs/host-security.md` (`allowedCidrs` + trust note: range override, literals *and* resolved answers, private-IP block only, malformed entries fail closed).
    - `docs/index.md` update: no — existing pages only, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 17 — Wiki linter page-read fan-out (measurement-gated)
  - Completed 2026-09-11 — **the gate failed: measured ceiling 1.38x at realistic page sizes (best case 1.73x on an unrealistic 650-byte-page wiki), so the task closes with no code change.** This is the AC's explicit else-branch ("if the benchmark shows <2x on a synthetic 500-page wiki, record the numbers in this task and close it with no code change"). The rest of this entry is that record.
  - Measurement (probe, not committed: `/tmp/wiki-lint-probe2.mjs`, same fixture the AC describes — synthetic wiki in a temp dir, 500 pages across `entities/decisions/concepts` + `index.md`/`SCHEMA.md`/`log.md`, 200 manifest entities x 2 anchors = 400 workspace source-file reads, valid anchor hashes so the loops run to completion; warm cache, median of 7 after warm-up; `uv_threadpool` default):
    | page size | lint p50 | page reads seq / pooled@16 | anchor reads seq / pooled@16 | single-thread CPU floor | speedup ceiling (both loops pooled) |
    |---|---|---|---|---|---|
    | 652 B (318 KiB, unrealistic-small) | 57.6 ms | 30.8 / 13.6 | 12.3 / 5.1 | 14.5 ms | 1.73x (1.57x @4, 1.70x @8) |
    | 2.2 KB (1.0 MiB, typical) | 59.6 ms | 25.6 / 13.7 | 9.8 / 5.5 | 24.1 ms | **1.38x** (1.33x @4, 1.37x @16) |
    | 20.7 KB (9.8 MiB, large pages) | 138.0 ms | 31.0 / 13.5 | 9.9 / 5.5 | 97.1 ms | 1.19x |
    - Per-loop ceilings at the typical size (i.e. fanning out only one of the two loops): pages-only 1.26x, anchors-only 1.08x — neither loop alone comes close, and the anchors loop is the worse candidate (its per-item CPU work is `hashContent` + line slicing, and it is 400 items of ~40 lines against the same ~5.5 ms pooled floor).
    - Net effect at the typical size: ~15 ms saved on a ~60 ms lint (the I/O wait removed), i.e. the "win" is real but small and sub-quadratic — not the >=2x the AC requires.
  - Why the gate cannot be met by *any* bounded read pool on this workload (the structural reason, measured, not assumed):
    - **The read path is syscall-bound, not thread-bound.** 500 page-cached `readFile`s take 26.6 ms sequentially and bottom out at ~12.7–13.3 ms pooled *regardless of `UV_THREADPOOL_SIZE`* (measured 4/8/16 → 13.3 / 13.3 / 12.7 ms; concurrency 4 already saturates it). Each open+read+close of a small file is ~26 us of kernel+copy work that does not parallelize further, so the pool removes roughly half the read cost and no more.
    - **The scan itself is single-threaded.** The fenced-block/inline-code sanitizer, both `matchAll` scans, frontmatter parsing, the `pageKeySet`/`basenameMap` lookups and `validateAnchor` all run on one thread: 14.5–97.1 ms of the 57.6–138.0 ms total depending on page size. Amdahl caps fan-out at `total / (cpuFloor + pooledIoFloor)` = 1.73x / 1.38x / 1.19x above, and every additional wikilink or longer page pushes the ceiling *down*, never up.
    - Absolute scale check on the real thing: the repo's own `packages/memory/.wiki` (6 pages, 28 KiB) lints in 0.58 ms p50 — 100x its size would still be ~60 ms, i.e. the operation is already fast enough that the ordering-sensitive rework would be buying ~15 ms.
    - The 15-line `mapBounded` + DEFAULT/HARD knob + index-stable assembly + cap=1-equivalence test would therefore be **complexity bought for a measured <2x on a <100 ms command**, exactly what the ladder in the AC's else-branch is designed to prevent. Revisit only if a *thousands*-page wiki becomes normal (then the argument is absolute: 5000 pages ~= 0.6 s, pool saves ~150 ms) or if the per-page CPU work drops far enough that I/O dominates — not on a ratio this size.
  - Acceptance Criteria (as specified; outcome noted):
    - Functional: page-content reads run behind a bounded pool **only if** a benchmark shows a real win — no; gate failed at 1.38x typical / 1.73x best case, so reads stay sequential. Result assembly byte-identity was therefore never at risk (no code was touched).
    - Performance: >=2x wall-clock on the synthetic benchmark with default caps — **not met** (1.38x typical). p95 ceilings elsewhere unchanged (nothing changed).
    - Code Quality: no `mapBounded`, no concurrency knob added; the reject list from Task 1 stands (RAG indexing, evals, postgres/mcp/wiki-skills untouched).
    - Security: read-only, no new I/O surface — trivially satisfied by the no-change outcome.
  - Approach:
    - Documentation Reviewed:
      - Task 1 findings (sequential-loop reject list; surviving candidate `wiki/engine/linter.ts`)
      - `packages/memory/src/wiki/engine/linter.ts` (both sequential loops: anchor validation from the manifest, page discovery + read + sanitize + link scan + inbound counting), `packages/memory/src/wiki/manifest.ts` (`loadManifest`, `validateAnchor`, `hashContent`), `packages/memory/src/wiki/engine/okf.ts` (`parseConceptFrontmatter`, `resolveMarkdownHref`), `packages/memory/src/wiki/commands/lint.ts` (single CLI call site — a human/agent-triggered command, not a hot loop)
      - Benchmark conventions ("measure a shipped path against a local copy of the replaced path, report a same-process ratio"; `scripts/benchmark-scenarios/redaction.mjs`, `scripts/benchmark.mjs` registry, `scripts/benchmark-redaction.test.mjs`)
    - Options Considered:
      - Fan out every loop: rejected in Task 1 (ordering-bound write/status paths elsewhere) — unchanged.
      - Unbounded `Promise.all` reads: rejected (fd/memory exhaustion, no bound to tune).
      - Benchmark-first, bounded read pool only on a measured win (chosen) → measured, does not reach the floor.
      - Adding the scenario to `scripts/benchmark-scenarios/` anyway (to keep the harness for a future revisit): rejected — a registered scenario needs a counterfactual *copy* of the linter's read loop (fixture-drift risk of the kind Task 3 exists to prevent) plus a `>=2x` floor that cannot hold, or a 1.0-floor scenario with nothing to assert. The AC's else-branch asks for the numbers here, not for dead harness.
      - Raising `UV_THREADPOOL_SIZE` as the "fix": rejected on evidence — measured 13.3 vs 12.7 ms pooled at 4 vs 16 threads, and the host, not the library, owns that env var.
    - Chosen Approach:
      - Measure with a throwaway probe (real `WikiLinter` + the pure-I/O components of both loops behind a local bounded pool), across page sizes and threadpool sizes, then close with no code change.
    - API Notes and Examples:
      ```ts
      // NOT added (would have been, had the gate passed):
      const contents = await mapBounded(pages, limits.readConcurrency, (p) => readFile(p, "utf8").catch(() => undefined));
      ```
    - Files to Create/Edit: **none** (gate failed). The probe (`/tmp/wiki-lint-probe2.mjs`) was throwaway; the fixture it builds is fully described above so the numbers can be reproduced without it.
  - Test Cases to Write: **none** — the AC's test cases ("benchmark scenario asserting >=2x and byte-identical gap output", "cap=1 equals sequential order") are conditional on the gate passing. With no code change there is no new behaviour to pin, and `packages/memory/src/wiki/__tests__/linter.test.ts` plus the wiki e2e suites remain green unchanged.
  - Verification (2026-09-11):
    - Probe runs (three page-size profiles x concurrency 4/8/16, plus a standalone `UV_THREADPOOL_SIZE` 4/8/16 sweep) produced the table above; the ceiling was computed as `lintP50 / (cpuFloor + pooledIo @c)` with `cpuFloor = lintP50 - (pageReadsSeq + anchorReadsSeq)`, i.e. optimistically granting the pool its best measured I/O with zero scheduling overhead — the real figure can only be lower.
    - Sanity: the fixture's lint reports exercise both loops (0 dead anchors, 0 broken links, 499 orphans — expected, since every fixture page links to the same target) and 500 pages / 400 anchors are actually read.
    - `packages/memory` build + wiki suites unchanged and green via the full `npm test` (exit 0) recorded in Task 16.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal read scheduling; output identical (and untouched).
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 18 — P3 additive config knobs + typing hygiene
  - Completed 2026-09-11 — the three additive options landed with defaults that preserve 0.5.6 behavior byte-for-byte, and the hygiene half removed 24 non-null assertions across 6 files (9 sites in `packages/ag-ui/src/acp/agent/core.ts`, 15 in `packages/prism-coding-tools/src/agent/process/sessions-spawn.ts`, plus the 3 sibling process modules) via two root-cause seams rather than per-site `if (!x) throw`. Nothing was behaviour-changing on a reachable path; the `as any` half of the AC turned out to be **audit-only** — see deviations.
  - Deviations, in order of consequence:
  - (1) **The `as any` audit found no `as any`.** `grep -rn "as any"` over `packages/office/src/diagrams/embed.ts`, `src/agent-approval.ts`, `packages/prism-coding-tools/src/security/sandbox.ts` returns exactly one hit, and it is a **prose comment** in `src/agent-approval.ts:49` (`untyped callers (plain JavaScript, \`as any\`) cannot make resume fall through to approval`). The review's `as any` evidence does not reproduce at 0.5.6; the AC branch is therefore satisfied by audit with zero edits rather than by "eliminated or justified" edits. Residual (not in AC scope, recorded in Further Actions): `src/agent-approval.ts` still carries 4 non-null-assertion sites (6 occurrences, lines 72/286/287) that the AC did not name.
  - (2) **Assertion counts differ from the AC's (x8 / x7).** Biome `style/noNonNullAssertion` at HEAD reports 9 unique sites in `ag-ui/.../core.ts` and 15 in `sessions-spawn.ts` (the review appears to have counted a subset). All of them are gone now, which over-satisfies the AC instead of matching its numbers exactly.
  - (3) **Root-cause seam instead of per-site guards in the process modules.** The `host.checkpoints!`/`host.leases!`/`host.ownerId!` trio appeared ~20 times across `sessions-spawn.ts`, `sessions-monitor.ts`, `sessions-recovery.ts`, and `sessions-teardown.ts` — every one of them re-proving `createSessionsHost`'s construction-time "any durable seam ⇒ all three" check. Added **one** internal accessor, `durableSeams(host)` in `agent/process/sessions-host.ts`, which returns the narrowed trio or throws the same `ProcessRecoveryError("ERR_PRISM_RECOVERY_UNSUPPORTED", "durable process recovery requires checkpoints, leases, and ownerId together")` that `createSessionsHost` already throws. The AC named only `sessions-spawn.ts`; doing the sibling files with the same helper is a smaller total diff than four separate guard styles and leaves no copy of the pattern behind. It is package-internal (not re-exported from `./process`), costs +1 internal export.
  - (4) **`ag-ui` narrowing needed captured seams, not guards.** `options.sessionStore`/`sessions`/`modes`/`configOptions` are optional and the request guards were runtime checks (`if (options.sessions?.load)`) that TypeScript cannot correlate into the closure bodies. Captured them once as `const sessionStore = options.sessionStore; const sessionsSeam = options.sessions; …` at factory scope, which narrows every handler without a single assertion and without changing any registration condition. `save()` gained `if (!sessionStore) return;` (callers already guard the seam; a storeless host had nothing to persist) — unreachable in the previous code because it was reached only under those guards.
  - (5) **Two unreachable-path guards are genuinely new (both fail closed).** `sessions-spawn.ts` start path re-checks `startPty`/`ptyTerminal` where the pre-existing registration-time guard already rejects a pty request without a backend (message and code unchanged: `ERR_PRISM_PROCESS_PTY_UNSUPPORTED`); the resize path gained `if (!terminal) throw ERR_PRISM_PROCESS_STATE` where the old code would have spread `undefined` and silently dropped the `term` field. Both were previously unrepresentable, and both now fail closed instead of asserting. The `pty/backend` `else` branches became `else if (backend)` — runtime-identical, since the old `!` TypeError was thrown *inside* the surrounding `try { … } catch {}`, i.e. swallowed exactly like the new skip.
  - (6) **`snapshotCacheTtlMs` uses the full range `0..HARD`.** `0` disables the branch cache (a host that wants a fresh store read per `session.snapshot()`), so the validator differs from the repo's usual "positive safe integer": it accepts 0 and caps at `HARD_MAX_SNAPSHOT_CACHE_TTL_MS` (30 s). Default is the previously hardcoded `1_000` via `DEFAULT_SNAPSHOT_CACHE_TTL_MS`. The cache is already invalidated by leaf change (including `checkout`) and by every mutation, so the TTL bounds reuse of an unchanged branch only.
  - (7) **The store search caps reuse the existing contract bounds.** `CreateMemorySessionStoreOptions.search.maxLinear{Sessions,Entries,Bytes}` are validated `1..HARD_MAX_SESSION_SEARCH_LINEAR_*` at **store construction** (fail fast, `TypeError` naming the option) and default to the existing `DEFAULT_MAX_SESSION_SEARCH_LINEAR_*` values, so the no-`search` store is byte-identical. `0` is rejected here (opt out with `sessionSearchMode: "unsupported"`). Recorded nuance: each cap is consulted *before* the entry is read (pre-existing loop shape), so the first entry always fits — the tests assert the second one is excluded.
  - (8) **`tokenEstimator` is threaded through every token decision but never the byte ones.** `ContextBudget.tokenEstimator` + exported `TokenEstimator` type; `estimateMessageTokens` gained an optional estimator (additive); `measureAll`/`dropNext`/`omission` take it. Bytes still come from `estimateTextBytes`, so `maxInputBytes` remains estimator-independent (asserted: a `() => 0` estimator still trips `ContextBudgetError` on a byte cap). Validation is two-layer and fail-closed: `resolveContextBudget` rejects a non-function; the per-call wrapper rejects `NaN`/`Infinity`/negative returns with `TypeError("contextBudget.tokenEstimator must return a non-negative finite number of tokens")` instead of letting unsound eviction decisions through. The omission ledger reports **estimator units** (documented).
  - (9) **Export budgets rebaselined with reasons** (all additive/type-only or internal): root `@arnilo/prism` 1284 → 1287 (`TokenEstimator`, `DEFAULT_SNAPSHOT_CACHE_TTL_MS`, `HARD_MAX_SNAPSHOT_CACHE_TTL_MS`; the three option *fields* add no names), `@arnilo/prism-coding-tools` 954 → 955 (internal `durableSeams`). `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` in `src/__tests__/public-export-contract.test.ts` updated deliberately (that test is the tripwire for exactly this), `docs/_evidence/phase54-package-map.md` regenerated. No new source files, so `scripts/phase16-baseline.json` dist counts are unchanged.
  - Acceptance Criteria (as specified; outcome noted):
    - Functional: (1) injectable token estimator on context-budget assembly — **done**, default `Math.ceil(text.length / 4)`; (2) `snapshotCacheTtlMs` on session creation — **done**, default 1000, `0` disables; (3) in-memory session-store linear caps as store options — **done**, bounded by the existing `HARD_MAX_SESSION_SEARCH_LINEAR_*` constants, defaults unchanged. All additive, all DEFAULT/HARD-validated (estimator validated by type + return value instead of a numeric cap, since it has none).
    - Performance: defaults byte-identical — asserted by fixture parity (`withDefault.report`/`groups` deep-equal the no-option run; store cap defaults asserted equal to the contract constants; default TTL asserted `1_000` and asserted to still serve the cache). Estimator documented as budget-only (never billing) in the type JSDoc and in `docs/input-and-prompt-assembly.md`.
    - Code Quality: non-null assertions eliminated in the two named files (9 + 15 sites, more than the AC's 8 + 7) and in the three sibling process modules via `durableSeams`; `as any` audited (none exist).
    - Security: estimator output influences eviction only — byte caps enforced regardless (asserted), non-finite/negative estimator output fails closed, a malformed CIDR-free… n/a; store caps cannot exceed the contract hard caps and `durableSeams` fails closed rather than asserting.
  - Approach:
    - Documentation Reviewed:
      - `src/context-budget.ts` (`ContextBudget`, `resolveContextBudget`, `estimateTextTokens`/`estimateMessageTokens`, `measureAll`/`dropNext`/`omission`, `assertPositiveCap`), `src/agent-session/session.ts:565-590` (the hardcoded `1_000` + cache invalidation), `src/contracts-core/agent.ts` (`AgentSessionConfig`), `src/session-stores.ts:164-260` (`CreateMemorySessionStoreOptions`, `searchMemorySessionsLinear`), `src/contracts-core/session.ts:74-96` (DEFAULT/HARD search caps)
      - `packages/ag-ui/src/acp/agent/core.ts` (seam registrations), `packages/prism-coding-tools/src/agent/process/{sessions-host,sessions-spawn,sessions-monitor,sessions-recovery,sessions-teardown}.ts`, `packages/prism-coding-tools/src/agent/process/types.ts:340-350` (optional seams)
      - `scripts/budget-gates.mjs:measureExportCounts`, `src/__tests__/public-export-contract.test.ts` (frozen surface lists), `src/__tests__/{context-budget,agents,session-index}.test.ts`
      - Docs option rows: `docs/input-and-prompt-assembly.md` (contextBudget), `docs/agent-session-runtime.md` (`AgentSessionConfig`), `docs/session-stores.md` (memory store options + search caps), `docs/public-contracts.md`
    - Options Considered:
      - Estimator as global override vs per-budget option: per-budget option (host-owned seam, no ambient state) — as planned.
      - Snapshot TTL only tunable upward vs `0` = disabled: full `0..hard` range — a host debugging staleness needs "always rebuild", and it costs one comparison.
      - Rejecting/accepting `0` for store caps: rejected, because "scan nothing" is already expressible as `sessionSearchMode: "unsupported"` and a 0 cap would silently return empty pages.
      - Per-file guards for the durable trio vs one accessor: accessor (one invariant, one error, four call sites).
      - Removing `!` by changing `SessionsHost` to a discriminated union on `durable`: correct typing but a public-shape refactor far beyond hygiene; the accessor gets the same safety inside the file graph.
    - Chosen Approach:
      - Thread a resolved estimator through the assembler's token paths; resolve the TTL once in the session constructor; resolve the three search caps once at store construction; replace assertions with captured narrowed seams (`ag-ui`) and `durableSeams` (`process/*`).
    - API Notes and Examples:
      ```ts
      // 1. context-budget: budget-only estimator (never billing)
      await assembleProviderInput({ model, input, contextBudget: { maxInputTokens: 8_000, tokenEstimator: (text) => myTokenizer.count(text) } });

      // 2. session: tune or disable the branch cache
      const session = agent.createSession({ snapshotCacheTtlMs: 0 }); // 0 = always rebuild; default DEFAULT_SNAPSHOT_CACHE_TTL_MS (1000)

      // 3. memory store: raise the capped linear-scan bounds (<= HARD_MAX_SESSION_SEARCH_LINEAR_*)
      const store = createMemorySessionStore([], { search: { maxLinearSessions: 5_000, maxLinearEntries: 50_000, maxLinearBytes: 64 * 1024 * 1024 } });
      ```
    - Files to Create/Edit (done): `src/context-budget.ts`, `src/agent-session/session.ts`, `src/contracts-core/agent.ts`, `src/session-stores.ts`, `src/index.ts`; hygiene: `packages/ag-ui/src/acp/agent/core.ts`, `packages/prism-coding-tools/src/agent/process/{sessions-host,sessions-monitor,sessions-recovery,sessions-spawn,sessions-teardown}.ts`; tests: `src/__tests__/{context-budget,agents,session-index,public-export-contract}.test.ts`; evidence/config: `scripts/budgets.json`, `docs/_evidence/phase54-package-map.md`; docs: `docs/{input-and-prompt-assembly,agent-session-runtime,session-stores,public-contracts}.md`. No new files.
  - Test Cases to Write (done):
    - Estimator: default (option absent) deep-equals an explicit `estimateTextTokens` run (report + groups); a 10x estimator evicts history a default-budget run would keep and reports omission ledger values in estimator units; byte caps stay estimator-independent (`() => 0` still throws `ContextBudgetError` under `maxInputBytes`); non-function at the budget seam and `NaN`/`Infinity`/`-1` returns fail `TypeError` with the documented message.
    - Snapshot TTL: contract constants asserted (`1_000`/`30_000`); default TTL serves two snapshots from one store read; `0` produces two reads with deep-equal snapshots; `HARD` still one read; `-1`, `1.5`, `NaN`, `HARD + 1` throw `TypeError` at construction.
    - Store caps: contract defaults asserted; lowering `maxLinearSessions` hides a session the default scan reaches and raising it finds it; `maxLinearEntries`/`maxLinearBytes` exclusions asserted; `0`, `HARD + 1`, `1.5`, `NaN`, `-1` throw `TypeError` at construction (not at search time).
    - Hygiene: existing suites green with no behavior change — `packages/prism-coding-tools` process suites 46/46 (`process-sessions`, `process-recovery`, `process-pty`, `process-session-phases`), `ag-ui` ACP suite via the workspace stage.
  - Verification (2026-09-11):
    - **Negative controls (each new option, one line broken at a time):** `measureAll` ignoring the injected estimator → context-budget 12 pass / 2 fail; `resolveSnapshotCacheTtlMs(undefined)` in the constructor → agents 97 pass / 1 fail; `resolveLinearSearchCaps(undefined)` → session-index 5 pass / 1 fail. All restored → 14/0, 98/0, 6/0.
    - Scoped: `src/__tests__/context-budget.test.js` 14/14, `agents.test.js` 98/98, `session-index.test.js` 6/6, `public-export-contract.test.js` 228/228, `docs.test.js` 152/152; `prism-coding-tools` process suites 46/46; `npm run build` (all packages) + `npx biome check .` clean (1530 files, zero findings). Note on the metric itself: `style/noNonNullAssertion` is **not enabled** in `biome.json`, so the counts above come from running the rule explicitly (`--only=style/noNonNullAssertion`); the repo still has 542 pre-existing `!` sites in `src/` and 269 in `packages/prism-coding-tools/src` that this task deliberately did not sweep.
    - Budget/evidence: `measureExportCounts` consistent with the rebaselined ceilings (root 1287, coding-tools 955); phase54 package-map evidence regenerated; frozen export lists updated deliberately (the tripwire fired first — `root export surface is frozen (no silent add/remove)` failed with the +3 delta before the list was updated, which is the intended workflow).
    - Full `npm test` **exit 0**: `pass 2888ms build / pass 12195ms root suites / pass 36560ms gate suites / pass 11752ms build race / pass 24098ms workspace suites` — "all 5 stages passed".
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — three additive option surfaces (`ContextBudget.tokenEstimator`, `AgentSessionConfig.snapshotCacheTtlMs`, `CreateMemorySessionStoreOptions.search`), two new public constants, one new public type.
    - Docs pages to create/edit: `docs/input-and-prompt-assembly.md` (option row + estimator semantics: eviction-only, byte caps unaffected, fail-closed returns), `docs/agent-session-runtime.md` (`snapshotCacheTtlMs` row with default/`0`/hard cap + invalidation guarantee), `docs/session-stores.md` (memory store options row + a raised-cap example next to the opt-out example), `docs/public-contracts.md` (the `AgentSessionConfig` and `SessionSearchUnsupportedError`/`sessionSearchMode` rows).
    - `docs/index.md` update: no — additive rows on existing pages.
    - Deliberately not updated: `docs/migration.md` (no host action is required by additive options; the 0.5.6 → 0.5.7 peer-range section stays focused) and `CHANGELOG.md` (release-note ownership stays with the final release task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 19 — Host onboarding docs: peer/feature matrix + options index
  - Completed 2026-09-11 — `docs/peer-dependencies.md` (11-row machine-checkable matrix: peer → range → optional → declaring package → subpaths it unlocks → install line → network footprint, plus the pin rationale and the supply-chain section) and `docs/options-index.md` (123 public `*Options`/`*Limits`/`*Config` surfaces grouped by the `docs/index.md` navigation sections that own them). Both are new pages, both are linked exactly once from `docs/index.md`, and 11 feature pages now carry a one-line peer banner. The matrix is no longer a claim: `scripts/live-doc-check.test.mjs` grew four tests that assert **exact parity with every workspace peer declaration**, subpath existence in the declaring package's `exports`, install-spec form (exact pins must carry their version, ranges must not), network-flag correctness, and — for the options index — that every named surface is *declared in source* and *mentioned in the page it links to*, with every markdown link resolving.
  - Deviations, in order of consequence:
  - (1) **11 third-party declarations across 6 packages, not "12 across 7".** The AC counted `@arnilo/prism-office`'s optional `playwright-core` peer as a feature-gating declaration. It is not: no office subpath ever imported it at runtime — `@arnilo/prism-office/diagrams` drives a **host-supplied iframe** (`createDrawioEmbed({ iframe, origin })`, `DrawioEmbedFrame`), and the only consumer is the gated live draw.io conformance test (`packages/office/src/diagrams/__tests__/drawio-live.test.ts`, `PRISM_LIVE_DRAWIO_URL`). Documenting it as an optional peer would have told every office host to install a browser they never use, so the declaration moved to `devDependencies` (manifest + `packages/office/README.md` + `docs/release-and-install.md` + the 0.5.7 `docs/migration.md` peer-delta note, where the delta is now "office **drops** the peer"). This is the only manifest change in Task 19; it removes an install-time surface instead of adding one, so it cannot break a host. Verified by office's own suite (151 pass / 2 skipped, the skips being the gated live legs) and by the packaging/pack tests (75/75).
  - (2) **The matrix is declaration-scoped and machine-parseable, not prose.** Seven fixed columns per row and one row per (peer × declaring package) pair is what makes the parity assertion possible in both directions (a new manifest peer without a row fails; a row without a declaration fails). `playwright-core` therefore appears once, and the two NATS packages share an install line on purpose — the gate asserts the *row's* peer spec form and only allows other specs that are themselves matrix peers.
  - (3) **The options index is hand-curated but gate-enforced instead of generated.** The AC allowed either. Generating it would have added a script to maintain for a table that changes when docs change; instead the page is derived once from the live pages' own mentions and then **verified**: 123 surfaces, each (a) matching `*Options|*Limits|*Config`, (b) declared as an interface/type/class/enum somewhere in `src/` or `packages/*/src`, (c) named by the page it links to, (d) listed once. That is generated-equivalent truth with no generator (`ponytail:` hand-curated, the gate is the thing that would fail if it drifts). Two types were unroutable at first (`AgentSessionForkOptions`/`AgentSessionCloneOptions`/`SteerOptions` only appeared in `public-contracts.md`; `ModelLimits`/`AgUiLimitOptions`/`CreateMemorySessionStoreOptions` were only *implied* by field rows), so the owning pages now name them — a real gap in those pages, not just a gate convenience.
  - (4) **The gate went into the existing `live-doc-check.test.mjs`** rather than a new file: it is already in `GATE_FILES` (plan 070 Task 15), its header is now "hermetic doc checks" for both the live-credential matrix and the two new pages, and no chain edit was needed. Six tests total (two pre-existing).
  - (5) **Four additional truth fixes fell out of building the matrix**, each verified against the lockfile or the source tree rather than by eye:
    - `docs/documents.md` documented a **non-existent API** — `getDocumentModelSchema((options: GetDocumentModelSchemaOptions) => Record<string, unknown>)`. The real export is `documentModelSchema(kind: DocumentKind, slice?: string | readonly string[]): JsonSchema` (`packages/office/src/documents/model-schema.ts:534`), with `docModelSchema`/`sheetModelSchema`/`deckModelSchema` as the unsliced schemas. The row now matches the source.
    - `packages/web-tools/src/obscura/cdp.ts` hardcoded `playwright-core@1.61.0` in the peer-missing error message and its doc comment — stale since plan 070 Task 12 moved the pin to 1.63.0. The version is gone from both (the message points at the matrix page), so it cannot drift again.
    - `docs/release-and-install.md`'s upgrade surface had two stale rows: `better-sqlite3 ^12.11.1 → 12.11.1` (manifests and lockfile say `^13.0.3 → 13.0.3`) and `@modelcontextprotocol/sdk 1.29.0` (retired — `@arnilo/prism-mcp` now depends on the SDK v2 split packages `@modelcontextprotocol/client@2.0.0` and `@modelcontextprotocol/server@2.0.0`, both verified in `package-lock.json`).
    - `docs/session-stores.md`, `docs/model-registry.md`, `docs/ag-ui.md`, and `docs/agent-session-runtime.md` now name the option types they document (`CreateMemorySessionStoreOptions`, `ModelLimits`, `AgUiLimitOptions`, `AgentSessionForkOptions`/`AgentSessionCloneOptions`/`SteerOptions`).
  - (6) **Not fixed here (recorded in Further Actions):** `.github/workflows/sandbox-browser.yml` references four retired package names in its build step (`@arnilo/prism-evals`, `prism-workflows`, `prism-coding-agent`, `prism-diagrams`, all absorbed in 0.4), runs the draw.io gate as `npm run test:drawio -w @arnilo/prism-diagrams` (no such workspace, no such script), and keys its Playwright cache on `1.61.0`. That workflow therefore cannot pass as written on push to `main`. Fixing it means re-pointing a live CI job at 0.5.7 package names and verifying it on the runner — not a docs edit, and not verifiable from this workspace — so it is left with an exact replacement mapping in Further Actions.
  - Acceptance Criteria (as specified; outcome noted):
    - Functional: `docs/peer-dependencies.md` lists every peer declaration → subpath it unlocks → install line, including the exact-pin contracts and why (`playwright-core@1.63.0` rides CDP/accessibility shapes; `@ai-sdk/provider@4.0.13` gates on a supported-version matrix; `zod` is required because the pinned ACP SDK peers it) — **done**, with the AC's "12 across 7" corrected to the verified 11 across 6 (deviation 1). The options index links each surface to its owning page — **done** (123 surfaces).
    - Performance: static docs; the gate runs inside the existing `live-doc-check` stage (no new spawns, ~0.5 s) — **done**.
    - Code Quality: the matrix is checked against the manifests both ways and against package `exports`; the options index is checked against source declarations and page mentions; cross-page links resolve — **done**.
    - Security: no secrets; the matrix states which peers are network-touching (`pg`, both NATS packages, `playwright-core`) via a `Network` column the gate pins to that exact set, plus a supply-chain section (host-owned endpoints, no root-import reachability, no implicit installs, no secrets read by peers, neighbours-of-failure behaviour) — **done**.
  - Approach:
    - Documentation Reviewed:
      - Review finding 9.2 (optional-peer discovery burden); `.agents/skills/create-plan/references/prism-wiki.md` (index groupings, one-sentence entries, page structure)
      - `docs/index.md` (navigation sections reused verbatim as the options-index groupings + the exactly-one-link rule enforced by `src/__tests__/docs.test.ts`)
      - All 9 workspace manifests' `peerDependencies`/`peerDependenciesMeta` and `exports` maps; import sites for every peer (`document-reader/index.ts`, `ponytail/upstream.ts`, `memory/src/graft/upstream.ts`, `core/src/sessions/{sqlite,postgres,nats}/*`, `providers/src/ai-sdk/*`, `web-tools/src/{browser,obscura}/*`, `ag-ui` ↔ `@agentclientprotocol/sdk` peers)
      - `scripts/live-doc-check.test.mjs` + `scripts/live-matrix.mjs` (skip-not-fail contract), `scripts/generate-live-docs.mjs`, `src/__tests__/docs.test.ts`, `scripts/phase54-package-map.mjs` (historical registry data, unaffected)
    - Options Considered:
      - Scatter install notes per feature page (previous state) vs one matrix page + banners: matrix page (a host cannot miss what it does not know to search for) — as planned.
      - Generated matrix/options index vs hand-curated + gate: hand-curated + gate (no new script to maintain; the gate supplies the truth guarantee).
      - One row per peer vs one row per declaration: per declaration (a peer can be gated per package with different ranges/optionality — `playwright-core` was exactly that case).
      - Documenting office's test-only peer as a peer vs fixing the manifest: fix the manifest (the page should not have to apologise for a declaration; hosts should not be told to install a browser office never loads).
      - Widening the gate into a general "every API name in every docs table exists in source" check: out of scope here (would flag third-party and prose names); the 123-surface check covers `*Options|*Limits|*Config`, and the phantom-API class is recorded as a follow-up.
    - Chosen Approach:
      - Two new live pages (peer matrix, options index), linked once each from `docs/index.md`; 11 feature-page peer banners; four new tests in the existing hermetic doc gate; the manifest/doc truth fixes above.
    - API Notes and Examples:
      ```bash
      # one install line per capability, straight from the matrix
      npm i @arnilo/prism-core pg                      # sessions/postgres, enterprise/postgres, governance/prompts
      npm i @arnilo/prism-web-tools playwright-core@1.63.0   # exact pin, host-owned browser binary
      ```
      ```ts
      // every indexed surface routes to a page that documents its fields
      const agent = createAgent({ provider, model, limits: { maxTurns: 12 } });     // AgentConfig.limits → RunLimits
      const store = createMemorySessionStore([], { search: { maxLinearSessions: 5_000 } }); // CreateMemorySessionStoreOptions
      ```
    - Files to Create/Edit (done): created `docs/peer-dependencies.md`, `docs/options-index.md`; edited `docs/index.md`, `scripts/live-doc-check.test.mjs`, `packages/office/package.json`, `packages/office/README.md`, `packages/web-tools/src/obscura/cdp.ts`, `docs/documents.md`, `docs/release-and-install.md`, `docs/migration.md`, `docs/session-stores.md`, `docs/model-registry.md`, `docs/ag-ui.md`, `docs/agent-session-runtime.md`, `docs/core.md`, and peer banners in `docs/{browser-automation,obscura,graft,ponytail,document-reader,sqlite-persistence,postgres-persistence,agent-events}.md` + `docs/providers/ai-sdk.md`. No new source files, no new scripts.
  - Test Cases to Write (done):
    - Matrix ↔ manifests: exact parity of (peer × declaring package) sets in both directions; documented range and optional flag equal the manifest's; removing a row fails, adding a phantom row fails.
    - Matrix row semantics: every `Unlocks` subpath exists in that package's `exports`; the install spec carries the exact version for a pinned range and no version for a range peer; any other package named in an install cell must itself be a matrix peer; the `Network` flag must equal the pinned network set.
    - Options index: every surface matches `*Options|*Limits|*Config`, is declared in `src/` or `packages/*/src`, is mentioned by the linked page, and appears exactly once; a surface named outside a group fails; every markdown link in both pages resolves.
  - Verification (2026-09-11):
    - **Negative controls (six, each restored afterwards):** dropping the `zod` row → parity test fails; installing the pinned peer unpinned → install-form fails; renaming `./graft` → subpath test fails with the package's real export list; flipping `pg`'s network flag → network test fails; adding `PhantomTotallyMissingOptions` → declaration test fails; pointing the Workflows entry at `sheets.md` → "does not mention `RunWorkflowOptions`" fails. Restored: 6/6 pass.
    - Scoped: `scripts/live-doc-check.test.mjs` 6/6; `docs.test.js` 152/152 (the exactly-one-index-link rule and the frozen doc assertions hold); `packaging.test.js` + `install-smoke.test.js` 75/75 (peer pins and the office tarball); `@arnilo/prism-office` 151 pass / 2 skipped (both gated live legs); `@arnilo/prism-web-tools` 141 pass / 4 skipped; `scripts/packaging-current.test.mjs` + `scripts/phase54-package-map.test.mjs` 41/41; `npx biome check .` clean (1530 files, zero findings after `--write` organized the new imports).
    - `docs/release-and-install.md` upgrade-surface table re-verified row-by-row against `package-lock.json` (13 rows): only `better-sqlite3` and the MCP SDK rows were stale; the rest (`typescript` 7.0.2, `@types/node` 20.19.43, `biome` 2.5.13, `diff` 9.0.0, `pg` 8.23.0, `ajv` 8.20.0, `zod` 4.6.2, `@napi-rs/keyring` 1.3.0, `@ag-ui/core` 0.0.59, `@agentclientprotocol/sdk` 1.4.0) match the lockfile.
    - Evidence regeneration is content-stable: `scripts/phase54-package-map.mjs` run twice differs only by its `Generated:` timestamp line (its `@arnilo/prism*` counts already carry the Task 14/16/18 modules).
    - Full `npm test` **exit 0**: `pass 2669ms build / pass 10802ms root suites / pass 31673ms gate suites / pass 9789ms build race / pass 22520ms workspace suites` — "all 5 stages passed".
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (docs deliverable + one manifest truth fix): `@arnilo/prism-office` no longer declares an optional `playwright-core` peer; the obscured error message no longer names a version; two doc tables corrected to the real APIs/dependencies. No source API change.
    - Docs pages to create/edit: created `docs/peer-dependencies.md` and `docs/options-index.md`; edited `docs/index.md`, `docs/documents.md`, `docs/release-and-install.md`, `docs/migration.md`, `docs/session-stores.md`, `docs/model-registry.md`, `docs/ag-ui.md`, `docs/agent-session-runtime.md`, `docs/core.md`, plus peer banners on 9 feature pages.
    - `docs/index.md` update: yes — `[Configuration options index](options-index.md)` under **Public contracts** and `[Optional peer dependencies](peer-dependencies.md)` under **Configuration/manifests**, one sentence each, exactly one link per page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 20 — Release 0.5.7: lockstep cut, evidence, and registration
  - Completed 2026-09-11 — **0.5.7 is cut**: all 10 publishable manifests `0.5.6 → 0.5.7`, every internal `@arnilo/*` range `^0.5.7` (Task 13's exact-range lint green), `CHANGELOG.md` 0.5.7 entry, additive 0.5.7 section in `docs/migrate-to-0.5.md`, `docs/index.md` current line + inventory, `plans/README.md` row marked complete. Cut evidence: **1729 tests / 185 suites**, compat surface **+69 declarations / −0 removals**, `npm audit` **0 vulnerabilities**, secret scan **2166 files / 0 findings**, release evidence **39 surfaces / 0 blocked**, SBOM verify **172 packages / 10 licenses**.
  - Cut mechanics (each step verified, not assumed):
    1. `node scripts/release.mjs bump --from 0.5.6 --to 0.5.7 --ranges caret` → 10 manifests + `package-lock.json` (the script rewrites `dependencies`/`optionalDependencies`/`peerDependencies` only; the `file:` devDeps are untouched by design).
    2. `src/index.ts` `version = "0.5.7"` (the script does not touch source literals — the version const is part of the published `.d.ts` surface).
    3. 26 literal sites in tests/scripts (17 package suites' `^0.5.6` peer assertions, `docs.test.ts` ×7, `packaging.test.ts` ×7, `phase24-truth.test.mjs`, `phase34-freeze.test.mjs` ×4, `phase27-release.test.mjs` version list, `benchmark-scenarios/redaction.mjs`).
    4. `node scripts/package-truth.mjs --emit-docs` → artifact + the four generated doc blocks (`README.md`, `docs/index.md`, `docs/release-and-install.md` inventory + providers, `docs/provider-packages.md`).
    5. `.github/workflows/release.yml`: `v0.5.7` added to the `push.tags` trigger and all three publish-job filters (without these the tag would never publish).
    6. Compat baselines regenerated with `node scripts/release.mjs gate --lockstep --version 0.5.7 --update-baseline`, then re-run clean (`"updated": false`); `docs/_evidence/phase54-package-map.md` regenerated; `npm run release:evidence` re-derived at release 0.5.7; `security-artifacts/sbom.spdx.json` regenerated (it was stale since Task 12).
  - Deviations, in order of consequence:
  - (1) **Two *live* gates carried the cut's frozen literals, not just the retired one Task 13 recorded.** The stale `scripts/phase30-release.test.mjs` assertions are still stale (Further Actions), but the same drift sat in gates that actually run: `src/__tests__/release.test.ts` freezes the workflow's `tags:` line as a regex, and `src/__tests__/packaging.test.ts` freezes the provider-family peer as `/^\^0\.5\.7$/`. Both had to be updated or the cut could not pass — and both were invisible to the mechanical `"0.5.6"` sweep because they are escaped regex literals (`0\.5\.6`), which is exactly how a literal sweep silently misses sites. Cost: one full readiness run.
  - (2) **`PRISM_TEST_POSTGRES_URL` must be scoped to the `release:gate` phase only.** The release workflow documents this ("deliberately NOT ambient here") and it is not cosmetic: with the env exported for the whole run, `npm test` fails twice — the credential-gated durable legs, and less gracefully the packed-install enterprise journey, which takes `process.env.PRISM_TEST_POSTGRES_URL !== undefined` as its cue to `await import("pg")` inside a consumer that installed only root/core/coding-tools tarballs (`pg` is a *peer* of core, not a dependency) and dies `ERR_MODULE_NOT_FOUND`. I provisioned `pgvector/pgvector:pg16` locally, ran the durable legs for real (`npm run test:postgres`: 72/72 core, 354 pass / 3 skip memory, 11/11 conformance), regenerated the evidence with the env present, then ran the readiness chain CI-style with the env scoped to `release:gate`. The journey's ungraceful failure with the env ambient is recorded in Further Actions.
  - (3) **The Task 19 doc gate caught a Task 20 regression in my own edit.** The new 0.5.7 current-line bullet linked `options-index.md`, and `docs.test.ts` enforces *exactly one* `docs/index.md` navigation link per page (`2 !== 1`). Fixed by keeping the bullet as prose and the single link in the navigation section — the gate did its job on the first edit after it landed.
  - (4) **Compat baselines were regenerated, not `--allow-break`ed** (plain reviewed delta, house convention): **69 added declarations, 0 removed, 0 remaining after the update** — the five new 0.5.7 root surfaces (`TokenEstimator`, `EMPTY_TOOL_RESULT_TEXT`, `DEFAULT_/HARD_MAX_SNAPSHOT_CACHE_TTL_MS`, `isAllowedByCidr`, `isBlockedIp`), two web-tools idle-TTL constants, and the helpers the split/de-dup modules now export from their new files (model-router 41, MCP OAuth metadata 4, coding-tools 4 — `Semaphore`/`durableSeams`/`resolvePeerPackageRoot`/`assertSkillsMarker`, providers retry-http 4, memory 0). `GRAFT_PEER_RANGE` changed literal (`^0.16.0` → `^0.16.0 || ^0.18.0`), already documented in `docs/migration.md`. `docs/migration.md` mentions 0.5.7, so no break note was needed anywhere.
  - (5) **No budget re-baseline in this task.** Tasks 8/14/16/18 re-baselined `scripts/budgets.json` in the same task that added dist files (VENT 26-08-15 rule); the gate ran green unchanged here, and the 250 ms root-import ceiling did too.
  - (6) **Publication is left to the operator** (plan 070's scope ends at the cut): commit the tree, tag `v0.5.7`, `node scripts/release.mjs publish --lockstep --version 0.5.7` (resumable), batching package-tag pushes ≤3 per push (VENT 26-08-29). `release.mjs check --lockstep --version 0.5.7` reports all 10 packages **available** on the registry; both `check` and `publish` refuse a dirty tree (verified: "release requires a clean git tree"), the one precondition a working tree cannot satisfy.
  - Acceptance Criteria (as specified; outcome noted):
    - Functional: all 10 publishable manifests at 0.5.7 ✓; internal ranges `^0.5.7` ✓ (`release.mjs gate --lockstep --version 0.5.7` clean); `CHANGELOG.md` entry records every task delta ✓ (Fixed 5 / Added 6 / Changed 5 / Removed 1 + lockstep bullet); `docs/migrate-to-0.5.md` gains an additive 0.5.7 section ✓ (section 10, status line, upgrade step 9); `docs/index.md` current line updated ✓; `plans/README.md` row added ✓ (already present, now `complete (2026-09-11)`).
    - Performance: benchmark gates green at frozen ceilings, including the Task 9 redaction scenario (`scripts/benchmark-redaction.test.mjs` in the gate stage) ✓; budget gate green with the re-baselines that landed in the tasks adding dist files ✓.
    - Code Quality: readiness chain green end-to-end — typecheck, lint, format:check, `npm test`, `test:coverage`, `pack:dry-run`, `release:gate`, `security:threat-suites`, every phase `rc=0` ✓; release-skip-manifest re-derived (39 surfaces, 0 blocked) at release 0.5.7 ✓.
    - Security: `npm audit --audit-level=moderate` → 0 vulnerabilities ✓; secret scan over 2166 tracked files → 0 findings ✓; tarball deny-list enforced for all 10 packages inside the gate ✓; SBOM regenerated and license-verified ✓; the review's keeper surfaces (Task 1) are untouched — every security-relevant delta in this cut is additive and fail-closed (the CIDR allow-list rejects unparseable entries, the browser reaper only disposes idle runs, the redaction fast path is byte-identical to the ordered loop).
  - Approach: as planned (one lockstep cut; publish via the existing pipeline with batched tag pushes). Beyond the planned files (`package.json` + `packages/*/package.json`, `CHANGELOG.md`, `docs/migrate-to-0.5.md`, `docs/index.md`, `plans/README.md`), this task also edited the literal sites listed above, `src/index.ts`, `.github/workflows/release.yml`, `scripts/compat-baseline/*` (7 files), `scripts/package-truth.json`, `scripts/release-evidence.json`, `scripts/coverage-summary.json`, `docs/release-and-install.md`, `docs/provider-packages.md`, `README.md`, `docs/_evidence/phase54-package-map.md`, and `security-artifacts/sbom.spdx.json`.
  - Test Cases: the release gates themselves, as planned — no new hand-written suites. Gate evidence: `release.mjs gate --lockstep --version 0.5.7` clean after `--update-baseline`; `release.mjs check --lockstep --version 0.5.7` all-available; `phase23-coverage` + `phase23-skip-manifest` inside `test:coverage`; `truth-current`, `release-gate`, `packaging`, `docs`, and `release` suites inside the root/gate stages.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the release cut (and the `version` literal hosts read).
    - Docs pages to edit: `CHANGELOG.md` (0.5.7), `docs/migrate-to-0.5.md` (section 10 + status + upgrade step), `docs/index.md` (current line + generated inventory), `docs/release-and-install.md` (peer range `^0.5.7`, 8 tarball filenames, generated blocks), `README.md` and `docs/provider-packages.md` (generated blocks), `plans/README.md`.
    - `docs/index.md` update: yes — current line `0.5.7` with the four 0.5.7 highlights; inventory regenerated from the manifests.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Execution Notes

- **Task order is dependency-aware, not strict priority order.** Tasks 2–4 (P0)
  and 7 first; 5–6, 8–11 in parallel after Task 1; Task 3's real-peer devDeps
  feed Task 12's graft-floor decision; 12–13 before 20 (dep bumps precede the
  cut); 16–19 any time before 20. Task 7's live-name assertion reads the
  workspace list from `scripts/package-truth.mjs` (`computePackageTruth`, built on
  the existing `expandWorkspaceDirs`) today, so it does not block on Task 15;
  Task 15's runner lands independently. Task 17 is
  measurement-gated and may close as "no change" with recorded numbers.
- **Compat discipline:** every split/dedup task preserves the public import
  surface via barrel re-exports (0.1.4 pattern); `public-export-contract` and
  compatibility baselines are the regression net; budget-gate re-baselines
  happen in the same task that adds dist files.
- **Out of scope (recorded, not planned):** postgres/sqlite persistence merge
  (dialect split is correct), ag-ui handler split (cohesive), per-provider
  `models.ts` consolidation and `cache.ts`/telemetry consolidation (data + wire
  semantics, not logic; they already use the shared core cache helpers), live-
  canary CI greens (protected gaps are the correct posture), distributed rate
  limiter (host seam exists), the rejected concurrency candidates (RAG indexing,
  evals, postgres, MCP, wiki skills — all already batched/parallel/ordering-
  bound per Task 1), upstream-resolver unification (Task 1: signatures differ),
  retry-classifier unification (Task 1: wire semantics differ), freeze-script
  historical deltas (lineage evidence), any new package or contribution kind.

## Compromises Made

- **Task 17 (wiki linter fan-out) closed as "no change"** — the measured ceiling was 1.38×
  on typical 2.2 KB pages and 1.73× on 650 B pages against a ≥2× gate, with a single-threaded
  CPU floor (~36% of wall time at typical sizes) that I/O concurrency cannot lift. Numbers
  recorded in the task instead of code.
- **Three dedup candidates were rejected on semantics, not effort**: provider `cache.ts`
  (wire-specific cache semantics), the two upstream persona resolvers (signatures differ), and
  the per-provider retry classifiers (classification stays provider-local; only the HTTP
  primitives were shared).
- **`@arnilo/prism-office`'s optional `playwright-core` peer was removed** rather than
  documented: it was test-only (the `/diagrams` embed drives a host iframe), so a patch release
  changes one host-visible install surface. Mitigated by naming it in `docs/migration.md`,
  `docs/migrate-to-0.5.md`, the office README, and the changelog's Removed section.
- **Retired gate drift was recorded, not repaired**: `scripts/phase30-release.test.mjs` (stale
  tag list), the phase13 mtime assertion, and the phase20/21/26 freeze gates that fail on moved
  doc paths keep failing byte-identically on a pristine checkout. They are audit evidence, so
  silently re-baselining them would destroy lineage; each has a concrete fix in Further Actions.
- **The frozen-literal sweep stays manual.** 26 files hardcode the current version, and the
  escaped-regex variants are easy to miss; a version helper derived from the manifests is the
  recorded fix (Further Actions).
- **Publication and the Node-floor raise are deferred by design.** 0.5.7 is a patch: the
  `engines.node >=20` floor is unchanged (Node 20 is EOL; raising it is a minor-release change),
  and publishing/tagging is the operator handoff this repo's release discipline requires.

## Further Actions

All eleven entries below are converted to executable tasks in
[071-Release-0-6-0-Plan-070-Followups.md](071-Release-0-6-0-Plan-070-Followups.md) — the
list is retained here as the finding record, not as a backlog. Mapping:
Node floor → 071 Task 2; non-null assertions → Task 9; `sandbox-browser.yml` → Task 4;
startup budget gate → Task 3; `phase30` → Task 5; browser settle sleep → Task 7; wiki fixture
mutation → Task 6; `phase13` → Task 5; phase20/21/26 drift → Task 5; version literals → Task 1;
`PRISM_TEST_POSTGRES_URL` journey → Task 8. The 0.6.0 cut is 071 Task 10 and supersedes this
plan's unpublished 0.5.7 cut (0.5.7 never reached the registry).

- **Raise the Node floor to a supported line (Task 13 follow-up).** Node 20 went
  end-of-life 2026-04-30 (22 is maintenance LTS to 2027-04-30, 24 active LTS to
  2028-04-30). 0.5.7 deliberately keeps `engines.node >=20` because dropping a
  supported line is host-breaking and belongs in a minor release: the change is
  `engines` in all 10 manifests, the freeze manifest's
  `supported`/`measuredInCi`/`enginesRange` + `docsExamplesMinimum`, removing the
  `node20-compat` release leg, moving `@types/node` to the new floor, and a
  `docs/migration.md` note. Priority: medium (next minor).

- **Residual non-null assertions outside Task 18's named files (Task 18 follow-up).**
  Task 18 cleared the two files the review named plus the four `agent/process/*`
  modules that shared the durable-seam pattern, but the repo has 542 `!` sites in
  `src/` and 269 in `packages/prism-coding-tools/src` under biome's
  `style/noNonNullAssertion` (the rule is not enabled in `biome.json`, so this is
  review-level debt, not lint failure). The next-most-clustered cases are
  `src/agent-approval.ts` (4 sites: lines 72/286/287 — `canonicalToolEffectJson(a
  .actionConstraints![key]!)` and a sibling comparison), `src/agent-loops.ts`,
  `src/agent-tool-dispatch.ts`, and the `packages/prism-coding-tools/src/agent/*`
  tool files (`glob-match.ts`, `language/framing.ts`, `delete.ts`, `git-*.ts`,
  `security/sandbox-tar.ts`, `security/sandbox-fs-operations.ts`). Sweep them with
  the same root-cause approach (narrow once, capture the seam) and enable the rule
  only after the count is zero. Priority: low.

- **`.github/workflows/sandbox-browser.yml` cannot pass as written (found in Task 19).**
  Its build step names four retired packages and the draw.io gate runs a retired
  workspace: `npm run build -w @arnilo/prism-{evals,workflows,coding-agent,diagrams}`
  (lines 38-43) and `npm run test:drawio -w @arnilo/prism-diagrams` (line 119),
  plus a `playwright-chromium-1.61.0` cache key (line 95) after the pin moved to
  1.63.0. The workflow runs on every push to `main` and on a weekly schedule, so
  this is a red job that is easy to mistake for flake. Verified replacement
  mapping: `prism-evals` → `prism-core` (`/governance/evals`), `prism-workflows` →
  `prism-core` (`/runtime/workflows`), `prism-coding-agent` → `prism-coding-tools`
  (`/agent`) — including the `--test-name-pattern "adversarial"` step on line 46 —
  and `prism-diagrams` → `prism-office` (`/diagrams`). The draw.io step is best
  replaced with the matrix entry that already owns the command and cwd:
  `PRISM_LIVE_FILTER=office/drawio-live node scripts/live-matrix.mjs`, which also
  removes the hand-copied command that drifted in the first place. Priority: high
  (release-CI truth; needs a runner to verify).

- **Root import startup budget gate is load-sensitive (found in Tasks 11 and 13).**
  `scripts/budget-gate.test.mjs` compares a median-of-3 wall-clock import time
  against a fixed 250 ms ceiling; under sustained external CPU load it measured
  273 ms (Task 11) and 1104.8 ms (Task 13, `load average ~25` with concurrent
  rustc jobs) while standalone measurements are 92-113 ms, so `npm test` fails on
  a busy machine with no code change. Options: measure a same-run in-process
  baseline and gate the ratio, take more samples with a trimmed mean, or make the
  ceiling load-aware. Priority: high (release-blocking false negative).

- **Retired `scripts/phase30-release.test.mjs` has stale workflow assertions
  (found during Task 13).** "workflow publishes v0.3.0 once and package tags
  independently" still expects the release workflow tag list to be exactly
  `v0.3.0|v0.4.0|v0.5.0`, while `.github/workflows/release.yml` has grown through
  `v0.5.6` (11/12 tests in the file pass). Either relax the assertion to a
  structural one or refresh the fixture; it is audit-runnable evidence, so it
  should not be silently deleted. Priority: low.

- **Browser adversarial eval has a hardcoded settle sleep (found during Task 12).**
  `packages/web-tools/src/browser/__tests__/eval-fixtures.test.ts` waits a fixed
  `setTimeout(r, 20)` for download quarantine before asserting
  `items.length >= 1`, so under CPU load (observed at `load average ~20-38`) the
  `upload-download-screenshot` item scores 0 (`downloads=0; released=false`) and
  the suite flakes. Passes standalone and in the full web-tools suite; replace
  the sleep with a bounded poll on `manager.listDownloads(runId).length`.
  Priority: medium (test robustness only).

- **Test suite mutates tracked wiki fixtures and scaffolds an untracked repo-root `.wiki/` (found during Tasks 12 and 13).** Running the memory wiki suites rewrites three tracked files under
  `packages/memory/.wiki/` (`.manifest.json`, `SCHEMA.md`, `log.md` — the log
  gains today's date heading), and running the root suite scaffolds a fresh
  untracked `.wiki/` at the repository root. Both come from wiki commands whose
  `workspaceRoot` default resolves to `process.cwd()`, so tests write wherever
  they were started. Reverted/deleted by hand here; the fix is an explicit scratch
  root in the offending suites (or a required-explicit-root default) so tests
  cannot dirty the release diff. Priority: medium.

- **`scripts/phase13-freeze.test.mjs` asserts capture order by file mtime (found
  during Task 15).** "phase 13 baseline file is newer than the phase 12 freeze
  manifest" compares `statSync(phase13-baseline.json).mtimeMs` against
  `phase12-freeze-manifest.json`, so the retired gate fails whenever any later
  task edits the phase12 manifest (Task 12's ACP SDK pin did exactly that), and
  the result depends on checkout order. Replace with a content criterion (a
  `captured`/date field comparison) or drop the retired assertion. Priority: low.

- **Retired freeze gates carry known drift (confirmed during Task 15).** phase20
  and phase21 fail on shared `docs/index.md` markers (`fail-closed durable
  resume`, `strict completion`) and phase26 fails with ENOENT on
  `docs/0.1.0-readiness.md` (moved to `docs/history/` by plan 068). All three
  reproduce byte-identically on a pristine HEAD worktree, so they are untouched
  release evidence rather than regressions — but they should either get a
  `docs/history/` path fallback or be explicitly marked superseded. Priority: low.

- **The release cut's version literals are 26 hand-edited sites (found during Task 20).**
  Every cut has to sweep manifests (scripted), `src/index.ts`, 17 package suites' peer
  assertions, `docs.test.ts`/`packaging.test.ts`/`phase24-truth.test.mjs`/`phase34-freeze.test.mjs`/
  `phase27-release.test.mjs`, the benchmark scenario stamp, and the workflow tag lists — and the
  phase27/packaging cases are escaped regexes (`0\.5\.6`), which a plain `grep 0.5.6` sweep
  misses (it cost one full readiness run here). Proposed fix: a `currentVersion()` export from
  `scripts/package-truth.mjs` plus a gate asserting no version literal outside
  `CHANGELOG.md`/`docs/history/`, so the next cut edits one file and the gate names the rest.
  Priority: medium (every future release pays this).

- **`npm test` with `PRISM_TEST_POSTGRES_URL` ambient fails in the packed-install journey
  (found during Task 20).** `scripts/fixtures/e2e-enterprise-journey.mjs` uses the env as its
  cue to `await import("pg")`, but `packed-consumer.mjs` only installs the root/core/coding-tools
  tarballs and `pg` is a *peer* of core, so the import dies `ERR_MODULE_NOT_FOUND` instead of
  skipping the way the workflow comment promises ("env-free they skip"). The env is supposed to
  be scoped to `release:gate`, so this only bites a host who exports it globally — but the
  failure is a module-resolution stack, not a clear skip. Fix: probe resolvability
  (`import.meta.resolve("pg")` in a try/catch) or install `pg` into the consumer when the env is
  set. Priority: low (no CI path hits it).
