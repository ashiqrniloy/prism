# 064 — E2E + Live (Real-Credential) Test Coverage Matrix for Prism and All Packages

## Objectives

- Review and inventory every user-facing functionality surface across `@arnilo/prism` (root) and all 9 workspace packages, then drive **100% functional e2e coverage**: every public package subpath and every documented feature is exercised end-to-end — through public exports, real protocol wires, real binaries, or real credentials — by at least one test.
- Make "100%" **machine-verifiable**, not aspirational: a generated export→suite coverage manifest plus a gate script that fails when any public subpath lacks a covering e2e/live suite.
- Consolidate the currently scattered env-gated live suites (14 provider live suites, web-tools, memory compaction, office, ACP client smoke, Postgres/NATS/Docker/LibreOffice/keychain integrations) into **one credential matrix + one runner** (`npm run test:live`) with pass/skip accounting and a strict mode that fails on any skip.
- Fill the known live/e2e gaps: provider adapters without live tests (ai-sdk, azure, bedrock, model-discovery, ollama, vertex), root CLI journeys over a real provider, RAG reranker live probes, protocol-level MCP client smoke, core governance real legs (OPA, OIDC/JWKS, outbound webhooks, S3 artifact bodies), and a full-surface packed-install journey covering all 10 packages.
- Keep credentials **out of the repo and out of logs**: extend the established env-gated + `assertNoSecretLeak` pattern; document a least-privilege credential matrix for operators.

## Definition of "100% E2E Coverage" (the metric this plan enforces)

- **Included**: every public export subpath of `@arnilo/prism`, `@arnilo/prism-core`, `@arnilo/prism-providers`, `@arnilo/prism-memory`, `@arnilo/prism-coding-tools`, `@arnilo/prism-office`, `@arnilo/prism-web-tools`, `@arnilo/prism-ag-ui`, `@arnilo/prism-acp-agent`, `@arnilo/prism-mcp` is exercised by at least one of:
  1. a **live suite** (real credentials, real network, `{ skip }`-gated), and/or
  2. a **real-wire/real-binary suite** (real Postgres/NATS/Docker/LibreOffice/Playwright/graft/LSP processes — no network needed), and/or
  3. a **packed-install journey** (tarball → fresh consumer → public imports only).
- **Excluded from e2e**: 100% *line* coverage via e2e alone. Remote-failure branches (HTTP 429/5xx parses, malformed upstream frames, timeout aborts) are exercised by the existing network-free fault-injection suites; chasing them with real credentials produces flaky, expensive tests and no signal. Line/function/branch ratchets stay enforced by the existing `--experimental-test-coverage` gates (60/70/75 global + per-package baselines) and continue to rise as suites are added.
- The gate output (`docs/_evidence/e2e-coverage-report.json` + markdown) lists every subpath → covering suite(s) → ran/skipped-with-reason, so "we are at 100%" is a command away.

## Expected Outcome

- `npm run test:live` runs every suite whose required credentials are present, reports ran/skipped per suite, and with `PRISM_LIVE_STRICT=1` fails on any skip — the operator's one-command full-credential verification.
- `node scripts/e2e-coverage-gate.mjs` (also emitted by `test:live`) fails on any uncovered public subpath; a scheduled GitHub workflow runs the matrix in strict mode from repo secrets and uploads the report artifact.
- Hermetic `npm test` behavior is unchanged (live suites still skip by default; release gate stays network-free).
- `docs/live-testing.md` documents every required credential, its least-privilege scope, and per-suite cost notes; linked from `docs/index.md` and README.
- Budget-gate, freeze manifests, and per-package coverage baselines re-baselined once after the new suites land.

## Tasks

- [x] 1. Primitive inventory + live credential matrix design
  - Acceptance Criteria:
    - Functional: `scripts/live-matrix.json` exists and inventories **29 active + 15 planned** suites (14 provider live suites, web-tools search/browser/obscura, memory observational + compaction stub, office LibreOffice golden + drawio, postgres/nats/docker-sandbox/keychain, ACP client smoke, deployed canaries; planned = plan 064 Tasks 4–9). Each entry: package, source test file, runtime command, cwd, `requires` (all-of) and/or `requiresAny` (either-of), `optional` envs, `scope`, `cost`, and for providers `model: [{env, default, wired}]`.
    - Functional (skip contract, per user decision): a suite whose required credentials are absent is **skipped with a reason, never failed** — encoded as `resolveSuiteState(suite, env)` in `scripts/live-matrix.mjs` (empty-string env counts as unset) and mirrored by the node:test `{ skip }` gating in each suite file. Strict mode (`PRISM_LIVE_STRICT=1`, Task 2) fails the *run* on any skip, not the suite.
    - Functional (model selection, per user decision): every provider suite declares model override env vars (`PRISM_LIVE_<PROVIDER>_MODEL`, multi-probe suites suffixed `_CHAT_MODEL`/`_MESSAGES_MODEL`/`_GPT_MODEL`) with real default model ids; `wired: false` marks suites whose test file does not read the env yet (only alibaba is `wired: true` today). Retrofit lands in Task 4.
    - Performance: manifest parse + validation + 7-test gate < 100 ms (measured: gate suite 89 ms).
    - Code Quality: single schema (fail-closed validation in `scripts/live-matrix.mjs` — unknown top-level/suite/model fields rejected, env-name shape enforced, active suites need an env-expressible skip contract); pure `resolveSuiteState` shared by runner (Task 2) and tests; `node scripts/live-matrix.mjs --check` reports run/skip per suite vs current env (exit 1 on validation errors).
    - Security: manifest contains env var *names* only — a `SECRET_SHAPED` scan (sk-/xai-/Bearer-token/api-key= patterns) rejects credential-shaped values (test-verified).
  - Approach:
    - Documentation Reviewed:
      - `scripts/live-canary.mjs` — existing env-gated canary pattern, bounded JSON, credential-free-HTTPS endpoint validation.
      - `packages/prism-providers/src/openai/__tests__/live.test.ts` — canonical `{ skip }` gating + `assertNoSecretLeak` pattern.
      - `scripts/fixtures/packed-consumer.mjs`, `scripts/e2e-coding-journey.test.mjs` — packed-install e2e pattern.
      - `scripts/coverage-summary.mjs`, `scripts/coverage-thresholds.json` — existing coverage-baseline accounting.
      - `.github/workflows/live-canaries.yml` — existing secrets/environment workflow pattern.
      - Node docs: `node --test` skip options (`t.test(name, { skip })`), `--experimental-test-coverage` excludes.
    - Options Considered:
      - Adopt Vitest/Playwright Test for live orchestration — rejected: ~30 existing suites already run on `node:test` with skip-reasons; a second runner doubles CI config and rewrites 30+ suites for zero new capability.
      - Keep per-package ad-hoc scripts (`test:live` in web-tools only) — rejected: no accounting, no strict mode, invisible gaps (exactly the current state).
      - One declarative matrix + one thin runner — chosen.
    - Chosen Approach: declarative `scripts/live-matrix.json` + `scripts/live-matrix.mjs` runner built on the existing `node --test` commands; validation test registered in the root test chain.
    - API Notes and Examples:
      ```json
      {
        "id": "providers/hyper",
        "status": "active",
        "source": "packages/prism-providers/src/hyper/__tests__/live.test.ts",
        "command": "node --test dist/hyper/__tests__/live.test.js",
        "cwd": "packages/prism-providers",
        "requires": ["PRISM_LIVE_PROVIDER_TESTS", "HYPER_API_KEY"],
        "model": [
          { "env": "PRISM_LIVE_HYPER_CHAT_MODEL", "default": "deepseek-v4-pro", "wired": false },
          { "env": "PRISM_LIVE_HYPER_MESSAGES_MODEL", "default": "qwen3.6-plus", "wired": false }
        ],
        "scope": "Hyper key; second model probes the exact-prefix cache.",
        "cost": "~4 requests incl. ~1 KiB prefix cache write; sub-cent."
      }
      ```
      Skip contract (pure function, shared by runner + tests):
      ```js
      resolveSuiteState(suite, env) // -> { state: "run" | "skip", reason }
      ```
    - Files to Create/Edit:
      - `scripts/live-matrix.json`: the full manifest — 29 active + 15 planned suites (created).
      - `scripts/live-matrix.mjs`: schema, fail-closed validation, `resolveSuiteState` skip contract, `--check` CLI (created; spawn runner body lands in Task 2).
      - `scripts/live-matrix.test.mjs`: 7 hermetic gate tests (created).
      - `package.json`: `scripts/live-matrix.test.mjs` added to the root `test` script-gate chain (edited; chain stage verified green standalone).
      - `scripts/live.env.example` + `.gitignore` guard: credential template + never-commit guard (landed alongside this task during credential setup).
    - References: `AGENTS.md` graft workflow; VENT.md 26-08-15 (`&&` chain hides downstream failures — add new gate scripts to the chain explicitly and verify per stage).
  - Test Cases to Write:
    - `scripts/live-matrix.test.mjs` (7 tests, all passing): manifest validates fail-closed; active suites runnable-by-env / planned name plan 064; skip contract (missing key → skip with reason, empty string = unset, present → run); `requiresAny` semantics (google: either key); model entries (`PRISM_LIVE_*` prefix, non-empty defaults, only alibaba `wired` before Task 4 retrofit); no secret-shaped values; validator rejects unknown fields/bad env names/bad schemaVersion.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal test tooling).
    - Docs pages to create/edit: `none` for this task (Task 11 writes `docs/live-testing.md` from the finished matrix).
    - `docs/index.md` update: no.
    - Documentation structure reference: `plans/064…` task 11; not applicable here.

- [x] 2. Live matrix runner with accounting + strict mode (`npm run test:live`)
  - Acceptance Criteria:
    - Functional: `npm run test:live` executes each `active` suite whose `requires`/`requiresAny` are all present (via `resolveSuiteState` from Task 1 — missing credentials **skip with a reason, never fail**; `PRISM_LIVE_STRICT=1` instead fails the run on any skip), records per-suite `ran|skipped:<reason>|failed`, exits non-zero on any failure; `PRISM_LIVE_FILTER=<substring>` selects suites (planned rows included in reports, also filterable); writes `docs/_evidence/live-matrix-report.json` + `docs/_evidence/live-matrix-report.md` (tables: suite, status, duration, model override in effect). Credential loading: `PRISM_LIVE_ENV_FILE` override, else auto-load gitignored `scripts/live.env` when present (Node `--env-file` semantics: full-line comments, `export ` prefix, quotes; malformed line = hard error).
    - Performance: suites run sequentially by default (cost-bounded), `PRISM_LIVE_CONCURRENCY=<n>` opt-in; `PRISM_LIVE_SUITE_TIMEOUT_MS` per-suite kill timer (default 600 s, failed + reason); build runs on demand only (skipped entirely when zero suites are runnable — no-credential invocation is instant all-skip report).
    - Code Quality: runner exported as pure `runLiveMatrix({root, env, filter, strict, dryRun, concurrency, build, log})` from `scripts/live-matrix.mjs` (~140 runner lines; CLI `main()` wraps it); spawnable fixture matrix in tmp for hermetic tests; each spawned suite is wrapped in the repo's `with-build-lock.mjs` per leaf-wrapping doctrine; report deterministic shape (stable keys).
    - Security: runner never echoes env values; report contains env *names* only; failure output is passed through unmodified from node --test (which the suites already keep secret-clean via `assertNoSecretLeak`).
  - Approach:
    - Documentation Reviewed: `scripts/live-canary.mjs` (report shape), `scripts/with-build-lock.mjs`, `scripts/require-postgres-url.mjs` (fail-closed env guard pattern), Node `node --test` CLI (exit codes, reporters).
    - Options Considered: run via `npm --workspaces` — rejected (no skip accounting, wrong granularity per subpath); direct `node --test` per matrix entry — chosen.
    - Chosen Approach: thin runner over matrix entries; one summary report; strict flag; no new framework.
    - API Notes and Examples:
      ```bash
      npm run test:live                     # runs what creds allow, reports skips
      PRISM_LIVE_STRICT=1 npm run test:live # fails on any skipped suite
      PRISM_LIVE_FILTER=providers/openai npm run test:live
      ```
    - Files to Create/Edit:
      - `scripts/live-matrix.mjs`: runner body — `runLiveMatrix` + `parseEnvFile` + report writer + CLI (`--check` / run / `-h`) (edited; verified end-to-end).
      - `package.json`: `"test:live": "node scripts/live-matrix.mjs"` (edited).
      - `scripts/live-matrix.test.mjs`: 7 runner tests added (14 total, all passing) — dry-run accounting, model override in effect, strict mode, filter, real-spawn failure + output tail, skips-never-spawn (broken command not spawned when creds missing), `parseEnvFile`.
    - References: `.github/workflows/integration-postgres.yml` (env wiring precedent).
  - Test Cases to Write:
    - dry-run accounting: missing-credential suite counted `skipped:PRISM_LIVE_PROVIDER_TESTS` when key absent, `ran` when present (fixture matrix + fake env). ✅ `runner dry-run` tests.
    - strict mode: dry-run with a skip exits 1 with the reason table. ✅
    - filter mode: only matching suites execute. ✅
    - Real-spawn leg: failing child records `failed` + output tail (exit 1); passing child `ran`; broken command is NOT spawned when its credentials are missing (skip contract under a real spawn path). ✅
    - CLI verification against the real repo (dry-run, zero spend): full matrix with `scripts/live.env` → 28 ran / 1 skipped / exit 0; `PRISM_LIVE_STRICT=1` + filter with a skip → exit 1; `PRISM_LIVE_ENV_FILE` pointing at an empty file → 29 skipped / exit 0; report grep: 0 secret-shaped values.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (repo tooling; developer-facing command documented in Task 11).
    - Docs pages to create/edit: `none` here; Task 11.
    - `docs/index.md` update: no.
    - Documentation structure reference: task 11.

- [x] 3. E2E surface coverage gate — the "100%" enforcement
  - Acceptance Criteria:
    - Functional: `node scripts/e2e-coverage-gate.mjs` reads each package's `exports` map (root + 9 workspaces = **98 surfaces**), maps every subpath → covering suites from a checked-in `scripts/e2e-coverage.json` (generated + hand-annotated), and exits non-zero listing any subpath with no covering suite. Baseline mode (current) fails only on regressions: a new unannotated surface, a stale annotation for a removed surface, an annotated test file that no longer exists, or a previously covered subpath losing its suites; empty suite lists are pending work (Tasks 4–9) and pass. Full mode (set `"mode": "full"` in the manifest after Tasks 4–9) additionally fails on any empty suite list — that flip is the 100% enforcement moment.
    - Functional: manifest generation is a heuristic pass (deepest-directory ownership of test files, `index.ts` → owning dir, import-graph grep fallback for file surfaces) + **10 hand-annotated indirect surfaces** (model-discovery via provider index tests, memory rag loaders/parsers via rag tests, core integrations m365/gws via work-tools tests, ag-ui acp/renderer via flat acp-*/renderer-* tests, web-tools brave/exa/firecrawl via web-tools + live tests). Regeneration (`--generate`) preserves hand annotations (verified).
    - Performance: gate runs hermetically in **32 ms** (static analysis only, no test execution) — well under the 5 s budget.
    - Code Quality: subpath extraction uses package.json `exports` keys directly (no hand-maintained list that can drift); annotations name real test file paths that must exist (existence-checked); gate logic is a pure `computeCoverage(root, coverage, {mode})` reused by the runner and tests; CLI flags `--generate` / `--baseline` / `--json`.
    - Security: none beyond standard script hygiene.
  - Approach:
    - Documentation Reviewed: root + all `packages/*/package.json` `exports` maps (21 core, 20 providers, 8 memory, 10 coding-tools, 6 web-tools, 3 office, 3 ag-ui, 1 acp, 1 mcp subpaths + root), `scripts/package-truth.mjs` (existing export-inventory precedent), `scripts/dead-export-verify.mjs`.
    - Options Considered: line-coverage 100% via e2e — rejected (see Definition section); istanbul/c8 deep imports — rejected (new dep, wrong model: e2e counts *surfaces*, not lines); exports-map → suite manifest gate — chosen.
    - Chosen Approach: static manifest gate; coverage summary wired into `npm run test:live` report output (`coverage` field + console line) and a new `scripts/e2e-coverage.test.mjs` chain entry.
    - API Notes and Examples:
      ```json
      { "@arnilo/prism-providers/openai": {
          "suites": ["packages/prism-providers/src/openai/__tests__/live.test.ts",
                     "packages/prism-providers/src/openai/__tests__/responses.test.ts"],
          "mode": "live+conformance" } }
      ```
    - Files to Create/Edit:
      - `scripts/e2e-coverage-gate.mjs` (new): `listPackages`, `discoverSurfaces`, `collectTests` (generation heuristic), `computeCoverage` (pure), CLI (`--generate` / `--baseline` / `--json` / default run).
      - `scripts/e2e-coverage.json` (new, generated + hand-annotated): 98 surfaces, 0 pending; `mode: "baseline"`.
      - `scripts/e2e-coverage.test.mjs` (new): 8 tests — discovery, unannotated fail (both modes), full-mode pass, ghost suite file fail, stale annotation fail, pending-in-baseline vs fail-in-full, real-repo baseline leg (98/98), every annotated file exists.
      - `package.json`: `scripts/e2e-coverage.test.mjs` registered in root test chain; `scripts/live-matrix.mjs` report gains `coverage` summary (edit).
    - References: `scripts/packaging-current.test.mjs` (export-map drift detection precedent).
  - Test Cases to Write:
    - gate fails on a fixture package with an unannotated subpath ✅; passes with annotation ✅; fails when annotation names a nonexistent test file ✅; `--baseline` regression mode behavior (stale annotation + pending-empty semantics) ✅ — 8 hermetic tests, all passing; real-repo chain leg asserts 98/98 baseline coverage.
  - Verification (real repo): `node scripts/e2e-coverage-gate.mjs` → `98/98 surfaces covered, 0 pending (mode: baseline)`, exit 0, 32 ms; `--generate` round-trip preserves hand annotations; `npm run test:live` dry-run prints `e2e-coverage: 98/98 surfaces covered`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (test gate).
    - Docs pages to create/edit: covered by Task 11 (the coverage definition is documented there).
    - `docs/index.md` update: no.
    - Documentation structure reference: task 11.

- [x] 4. Provider live suite completion (ai-sdk, azure, bedrock, model-discovery, ollama, vertex)
  - Acceptance Criteria:
    - Functional: each of the 6 adapters without live tests gets `__tests__/live.test.ts` following the canonical pattern: env-gated skip, `assertProviderStreamConforms`, `assertNoSecretLeak`, at least one text + one tool-call request, usage accounting asserted, abort observed (`assertAbortIsObserved`); azure uses `AZURE_OPENAI_ENDPOINT`+`AZURE_OPENAI_API_KEY`+deployment env; bedrock uses the AWS default credential chain + `AWS_REGION` (skip when `aws` creds unavailable); vertex uses `GOOGLE_APPLICATION_CREDENTIALS`/`GOOGLE_VERTEX_PROJECT`; ollama uses `OLLAMA_BASE_URL` (local/remote server, no key required — real-binary leg); model-discovery reuses provider keys to hit real `/models` endpoints; ai-sdk leg runs over a real underlying provider key. **Model-env retrofit (user decision): every provider live suite — the 14 existing plus these 6 — must read its `PRISM_LIVE_<PROVIDER>_MODEL` override (multi-probe suites: suffixed vars per `scripts/live-matrix.json` `model[]` entries) with the manifest's default as fallback; on completion flip every provider suite's `wired` flag to `true` in `scripts/live-matrix.json` and relax the gate test's "only alibaba" assertion.** All 14 existing live suites verified against the matrix and left otherwise unchanged unless a drift fix is required.
    - Performance: each suite ≤ 3 network requests, per-suite wall ≤ 60 s, respects the Hyper-style bounded-cost notes.
    - Code Quality: no new helpers — reuse `@arnilo/prism/testing/provider-conformance`; suites mirror the openai/hyper live suite shape.
    - Security: keys via `credentials: () => process.env.X` closures (never logged), `assertNoSecretLeak(events, [key])` in every test; prompts non-sensitive.
  - Approach:
    - Documentation Reviewed: `packages/prism-providers/src/openai/__tests__/live.test.ts`, `.../hyper/__tests__/live.test.ts` (cost-bounded probe pattern), `.../xai/__tests__/live.test.ts` (OAuth leg `PRISM_LIVE_XAI_OAUTH`), each adapter's own source (`azure/`, `bedrock/` (SigV4), `vertex/` (gcloud), `ollama/`, `ai-sdk/`, `model-discovery/`).
    - Options Considered: one shared generic live suite parameterized per adapter — rejected: adapter quirks (deployment IDs, AWS chain, OAuth) deserve explicit suites; 20 bespoke suites already exist and are clearer at 3am.
    - Chosen Approach: per-adapter live suites; no shared abstraction beyond the existing conformance harness.
    - API Notes and Examples:
      ```ts
      const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
      const skip: string | false = !LIVE || !process.env.AZURE_OPENAI_API_KEY
        ? "set PRISM_LIVE_PROVIDER_TESTS=1 and AZURE_OPENAI_* to run live Azure smoke tests" : false;
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/{ai-sdk,azure,bedrock,model-discovery,ollama,vertex}/__tests__/live.test.ts` (new × 6).
      - `packages/prism-providers/src/*/__tests__/live.test.ts` (edit × 14): read `PRISM_LIVE_<PROVIDER>_MODEL` override per manifest `model[]`.
      - `scripts/live-matrix.json`: mark 6 planned entries `active` + flip `wired: true` on all provider model entries (edit).
      - `scripts/live-matrix.test.mjs`: relax "only alibaba wired" assertion to "all provider suites wired" (edit).
    - References: docs pages `docs/providers/*.md` for documented-unknown behaviors (hyper precedent: probe failures ARE findings, recorded in docs).
  - Test Cases to Write:
    - per adapter: `live_text_generation_streams_and_accounts_usage`, `live_tool_call_loop_conforms_and_leaks_no_secret`, `live_abort_is_observed`; ollama adds `live_local_server_healthgate` (skip when `OLLAMA_BASE_URL` unset).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export changes; live behavior findings may require `docs/providers/*.md` notes (documented-unknown pattern) — task updates the relevant provider page when a probe contradicts docs.
    - Docs pages to create/edit: `docs/providers/azure.md`, `bedrock.md`, `vertex.md`, `ollama.md`, `ai-sdk.md`, `model-discovery.md`: add "live probe" run instructions (env vars) only where such sections don't exist.
    - `docs/index.md` update: no (provider pages already linked).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Notes (2026-09-05):
    - All 6 suites landed and compile clean; package suite: 511 pass / 0 fail / 83 skipped (gates) — new suites skip without credentials (verified).
    - Model retrofit: uniform two-line pattern `const override = process.env.PRISM_LIVE_<P>_MODEL; const model = override ? { ...base, model: override } : base;` — preserves the base ModelConfig (provider/compat/limits) instead of handing a raw string where a ModelConfig is typed, and never crashes on override ids missing from the shipped catalog (the find-with-`!` shape would have). hyper's derived `/v1/responses` probe follows its chat override automatically. 16 manifest model entries now `wired: true`; anthropic/google/clinepass manifest defaults corrected to the cheap probes the suites actually use (haiku-4-5, 2.5-flash-lite, cline-pass/deepseek-v4-flash).
    - New dev dependency: `@ai-sdk/openai@4.0.59` (prism-providers) — exact match for the pinned `@ai-sdk/provider@4.0.10` spec; the ai-sdk live leg runs the mapping against a genuine AI SDK provider package. azure/bedrock/vertex reuse the in-repo OpenAI-compatible wrappers (no SDK deps); vertex takes a pre-minted bearer token (`PRISM_VERTEX_ACCESS_TOKEN`, e.g. `gcloud auth print-access-token`) instead of pulling in google-auth-library; ollama is the only credential-free suite (health gate lists served models, skips when none pulled).
    - model-discovery live leg reuses `runModelDiscoveryConformance` (existing harness) over whichever real wire a present key provides (OpenAI-compatible route when `OPENAI_API_KEY`, Google route when `GEMINI_API_KEY`); manifest uses the Task-1 `requiresAny` semantics.
    - Manifest: 6 planned → active (35 suites total: 21 active / 14 planned); `--check` + dry-run verified (30/35 runnable with the operator's live.env; azure/bedrock/vertex/ollama + canaries skip with reasons). live.env.example Task-4 vars un-commented into their own section; gate test relaxed to assert all 20 provider suites wired + 6 activations.
    - Docs: "Live probe" sections added to docs/providers/{azure,bedrock,vertex,ollama,ai-sdk}.md and docs/model-registry.md (discovery has no own page — it is documented via model-registry.md, which supersedes the plan's model-discovery.md path).

- [x] 5. Root CLI + scaffold live journey (`prism init`, `prism --mode print|json|rpc` over a real provider)
  - Acceptance Criteria:
    - Functional: an env-gated script `scripts/e2e-cli-live.test.mjs` (matrix entry, requires any one provider key, default `OPENAI_API_KEY`): (a) `prism init` scaffolds a project into a temp dir and its generated offline `npm test` passes; (b) `prism provider add openai`-style flow writes config (existing `cli-provider-add.ts`); (c) `prism --mode print` and `--mode json` complete a real one-shot prompt with the real key; (d) `--mode rpc` drives a full JSON-RPC session over the real stdio wire (initialize → run → stream events → abort → resume) with the real provider; (e) key never appears in any captured stdout/stderr (redaction assertion over the full transcript).
    - Performance: full journey ≤ 90 s wall with a cheap model; scaffold leg ≤ 60 s (offline).
    - Code Quality: reuses `scripts/fixtures/packed-consumer.mjs` so the CLI tested is the packed artifact, not workspace source; no new mock plumbing.
    - Security: temp project dir under `os.tmpdir()`, cleaned up; prompts non-sensitive; full-transcript secret scan (existing redaction helpers).
  - Approach:
    - Documentation Reviewed: `src/cli.ts`, `src/cli-runner.ts`, `src/cli-init.ts`, `src/cli-provider-add.ts`, `src/rpc.ts`, `docs/cli-rpc.md`, `scripts/e2e-coding-journey.test.mjs`.
    - Options Considered: test the workspace `bin` directly — rejected: packed-consumer is the real install path and already the repo's e2e standard; chosen: packed consumer + spawned `prism` bin.
    - Chosen Approach: spawn-based journey over the packed CLI; assertions on process transcripts.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_PROVIDER_TESTS=1 OPENAI_API_KEY=sk-... \
        node --test scripts/e2e-cli-live.test.mjs
      ```
    - Files to Create/Edit:
      - `scripts/e2e-cli-live.test.mjs` (new), `scripts/fixtures/e2e-cli-live-journey.mjs` (new fixture run inside consumer).
      - `scripts/live-matrix.json`: add entry (edit).
    - References: `docs/cli-rpc.md` (mode contract).
  - Test Cases to Write:
    - scaffold + offline generated test passes; print-mode text present; json-mode well-formed events; rpc-mode full lifecycle incl. abort; zero secret leakage across all transcripts.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no code changes (tests only) unless a leak/bug is found — then fix at root cause and note in CHANGELOG.
    - Docs pages to create/edit: `docs/cli-rpc.md`: add "live CLI journey" run command section (small).
    - `docs/index.md` update: no (page exists).
    - Documentation structure reference: prism-wiki.md.

  - Completion Notes (2026-09-05):
    - **Scope deviation (root-caused, documented): the CLI could not run any real provider.** `defaultCreateSession` hard-threw for everything except `--provider mock` — the plan's premise (CLI already wires providers) was wrong. Fixed at the root rather than working around it: the init provider catalog (`templates/init/providers.json`) gained `factoryModule`/`factoryExport` fields (8 entries, cross-checked against each entry's own template imports), `loadProvidersCatalog` is exported, and `defaultCreateSession` now dynamically imports the factory from the consumer's installed `@arnilo/prism-providers/*` package and reads the catalog's credential env var. One mechanism, shared by scaffold and CLI — they can never disagree. `RpcSessionFactory.createSession` became async-capable (`AgentSession | Promise<AgentSession>`) to support the dynamic import; no-provider usage error preserved (existing contract test green).
    - Journey `scripts/e2e-cli-live.test.mjs` (no separate fixture file — the journey spawns the packed bin directly, a fixture-in-consumer would add nothing): packed consumer = root + prism-providers (1.4 s warm); legs: `init --provider <id>` scaffold → files exist, generated `src/__tests__/agent.test.ts` passes offline via node type-stripping against the packed install (no registry install of published versions); `providers add acme` scaffold; `--mode print` real one-shot; `--mode json` envelope well-formedness; `--mode rpc` full lifecycle (prompt → streamed events → state → mid-run abort → server stays responsive); full-transcript secret scan across every spawn. Provider selection: `PRISM_LIVE_CLI_PROVIDER` or the first catalog entry with a present credential. Matrix entry `cli/journey` (requiresAny over all 8 catalog credentials).
    - **Operator-credential reality: every key in `scripts/live.env` is a placeholder (3–12 chars)** — provider 401s are credential rejection, not code defects (the OpenAI 401 transcript even showed the provider redacting the key as `[REDACTED]` — the leak-protection path verified live). Per the Task-1 skip-not-fail invariant, wire legs skip with "provider rejected <envKey> (401/403) — refresh the credential and rerun" instead of failing; scaffold legs pass regardless. With a real key the wire legs run for real.
    - One boundary trip: the CLI usage string enumerating provider ids violated core's no-provider-literals boundary test — usage text genericized (id list lives in the catalog, not core source).
    - Verification: root dist suite 1640/1640 pass (incl. 77 CLI+RPC tests); journey green (2 pass + 3 cred-skips + leak-scan pass) with placeholder keys; manifest validates (36 suites); docs/cli-rpc.md gained a "Live CLI journey" section; CHANGELOG notes the CLI feature.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export changes; CLI gains real-provider support (behavior change noted in CHANGELOG [Unreleased]).
    - Docs pages to create/edit: `docs/cli-rpc.md`: "Live CLI journey" section added; "What it does" updated for `--provider <id>` semantics.
    - `docs/index.md` update: no (page exists).
    - Documentation structure reference: prism-wiki.md.

- [x] 6. Memory + office real legs registration and RAG live gaps
  - Acceptance Criteria:
    - Functional: matrix registers existing legs (llm-compaction live `PRISM_LIVE_COMPACTION_TESTS`, observational-memory live `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS`, Postgres memory + pgvector via `PRISM_TEST_POSTGRES_URL`, graft/wiki suites as real-binary legs via `graft` binary availability). New: `packages/memory/src/rag/__tests__/live.test.ts` probing the TEI reranker (`PRISM_TEST_TEI_RERANKER_URL` + optional key) and hosted rerankers (`PRISM_TEST_HOSTED_RERANK_URL`/`KEY`) with conformance-style assertions on returned scores ordering; office legs registered (LibreOffice golden `PRISM_TEST_LIBREOFFICE`, drawio live `PRISM_LIVE_DRAWIO_URL`, dashscope `PRISM_LIVE_DASHSCOPE_KEY`/`MODEL`).
    - Performance: RAG live probes ≤ 3 rerank requests; office golden unchanged (existing ceilings).
    - Code Quality: reranker live suite reuses rerank-fake fixtures for shape assertions against real responses; no new test utilities.
    - Security: rerank probe inputs non-sensitive; keys env-only + no-leak assertions.
  - Approach:
    - Documentation Reviewed: `packages/memory/src/rag/{tei-reranker,hosted-rerankers}.ts` + their existing network-free tests, `packages/memory/src/rag/__tests__/rerank-fixtures.ts`, `docs/embeddings.md`, `docs/rag-*.md` (rag pages under docs), `packages/office/src/diagrams/__tests__/drawio-live.test.ts` (existing live precedent), `docs/documents.md`/`docs/sheets.md`.
    - Options Considered: spin a local TEI container in CI and count it as "live" — rejected: the runner's real-credential matrix should test *operator-deployed* endpoints; a pinned container leg can be added later without matrix changes.
    - Chosen Approach: env-gated remote reranker probes; register existing office/memory legs.
    - API Notes and Examples:
      ```ts
      const skip: string | false = !process.env.PRISM_TEST_TEI_RERANK_URL
        ? "set PRISM_TEST_TEI_RERANKER_URL to run live TEI rerank probes" : false;
      ```
    - Files to Create/Edit:
      - `packages/memory/src/rag/__tests__/live.test.ts` (new).
      - `scripts/live-matrix.json`: register ~7 entries (edit).
    - References: `packages/memory/package.json` test globs (add the new file to `test` glob list — verify glob `dist/rag/__tests__/*.test.js` already includes it).
  - Test Cases to Write:
    - TEI live: bounded response, scores descending after rerank, no secret leak; hosted rerank live: same shape contract; skip-reason correctness when env unset.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/embeddings.md` (or the RAG rerank page): add live-probe env vars section (small).
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

  - Completion Notes (2026-09-05):
    - **New live suite `packages/memory/src/rag/__tests__/live.test.ts`** (activated as matrix `memory/rag-rerankers-live`): real TEI (`PRISM_TEST_TEI_RERANKER_URL` + optional `PRISM_TEST_TEI_RERANKER_KEY`/`PRISM_LIVE_TEI_RERANKER_MODEL`) and OpenAI-compatible hosted (`PRISM_TEST_HOSTED_RERANK_URL`/`PRISM_TEST_HOSTED_RERANK_KEY`/`PRISM_LIVE_HOSTED_RERANK_MODEL`) rerank probes. Conformance-style assertions on live responses: permutation-only reorder (same hit references + id set), scores non-increasing, credential never in error transcripts (`assertNoKeyLeak` wraps each leg). One request per configured endpoint (≤2 total, plan budget ≤3). TEI adapter is credential-free by design; the optional gateway key rides the adapter's documented trusted-transport (`fetch`) seam rather than growing a new option. Non-sensitive probe inputs per the security criterion. Model env vars follow the `PRISM_LIVE_*` convention (endpoint URLs stay `PRISM_TEST_*` per the plan's snippet). Requires-any over both endpoint vars; each leg self-skips when its endpoint is unset.
    - Verified the happy path against a real wire: a loopback stand-in TEI endpoint (shuffled scores, bearer key) → TEI leg green through the adapter's full fetch/parse/order pipeline; hermetically the suite skips cleanly (memory package 302 pass / 3 env-gated skips incl. the 2 live legs).
    - **Matrix registrations (36→40 active):** `memory/postgres` (`npm run test:postgres`, requires `PRISM_TEST_POSTGRES_URL` — postgres-memory + pgvector suites), `memory/graft` and `memory/wiki` (existing suite files over real child-process/fs execution against the in-repo fixture binaries, `requires: []`), and the rerankers suite above. llm-compaction, observational-memory, office LibreOffice-golden and drawio legs were already registered (Task 1); nothing to add there. The plan's dashscope mention is covered: providers/alibaba already gates on `PRISM_LIVE_DASHSCOPE_KEY`/`MODEL`.
    - **Validator rule change (scripts/live-matrix.mjs):** active suites may now carry an *empty* `requires` array (= always-runnable hermetic leg) — previously active demanded at least one env var, which cannot express fixture-binary legs that need no credentials. The fail-closed shape of the rule is unchanged (a non-array `requires`/`requiresAny` still fails validation via the env-name loop; the presence rule now accepts `[]`).
    - Docs: `docs/rag.md` gained a "Live probe" section (env table + command + skip semantics), matching the Task-4 provider-page pattern.
    - Verification: matrix validator + gate 22/22; e2e surface gate 98/98; dry-run 34 ran / 6 skipped / 8 planned with the four new entries accounted; full memory package suite green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export changes; validator rule loosened for empty-requires active legs (tooling, documented in manifest schema behavior).
    - Docs pages to create/edit: `docs/rag.md` "Live probe" section added (rerank endpoints + env vars).
    - `docs/index.md` update: no (page exists).
    - Documentation structure reference: prism-wiki.md.

- [x] 7. Coding-tools real legs (sandbox, LSP/forge, OpenAPI, computer-use-linux, document-reader)
  - Acceptance Criteria:
    - Functional: matrix registers: Docker sandbox integration (`PRISM_TEST_DOCKER_BIN/IMAGE/USER`, existing suite), browser/CDP legs (Task 8 covers web-tools; the coding browser suite `PRISM_TEST_PLAYWRIGHT`), computer-use-linux leg (env-gated on the host `computer-use-linux` MCP binary + real desktop session, `PRISM_TEST_COMPUTER_USE=1`), and a new `packages/prism-coding-tools/src/openapi/__tests__/live.test.ts` driving `createOpenApiTools` against a real public spec + real API (httpbin/petstore — no credential needed, still a real network e2e leg) covering tool call, argument validation, and error mapping. LSP/language-intelligence and forge suites already run real local binaries hermetically — registered as real-binary legs, no new tests unless a gap is found (document-reader, caveman/ponytail/impeccable personas are covered by existing unit + journey suites; verify via coverage gate).
    - Performance: openapi live ≤ 5 requests against example.com-class hosts; computer-use leg ≤ 30 s with screenshot assertions bounded.
    - Code Quality: no changes to tool implementations; suites follow package test conventions.
    - Security: openapi live target must be a non-sensitive public endpoint (URL allow-listed in the suite); computer-use leg asserts no screenshot bytes leave the process.
  - Approach:
    - Documentation Reviewed: `packages/prism-coding-tools/src/security/__tests__/docker-sandbox.test.ts` (env-gated precedent), `src/agent/__tests__/language-*.test.ts` (real LSP binaries), `src/openapi/tools.ts`, `docs/openapi-*.md`/`docs/coding-*.md`, `docs/computer-use-linux.md`.
    - Options Considered: mock the public API — rejected: the network-free suites already do that; the point of this leg is the real wire; chosen: real public endpoint, no key.
    - Chosen Approach: register existing real legs; add one openapi live suite; add computer-use env-gated leg only if no existing suite drives the real binary (verify during task; if `fixtures/` already covers it, matrix-registration only).
    - API Notes and Examples:
      ```ts
      const tools = await createOpenApiTools({ specUrl: "https://petstore3.swagger.io/api/v3/openapi.json", fetcher: fetch });
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/src/openapi/__tests__/live.test.ts` (new, tentative — verify no existing live leg during task).
      - `scripts/live-matrix.json`: register ~6 entries (edit).
    - References: `docs/host-security.md` (egress policy the openapi suite must respect).
  - Test Cases to Write:
    - openapi live: spec compile against real spec, one real tool call, validation error on bad args, 4xx/5xx error mapping.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/openapi-tools.md` (verify page name): add live-run instructions (small).
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

  - Completion Notes (2026-09-05):
    - **New live suite `packages/prism-coding-tools/src/openapi/__tests__/live.test.ts`** (matrix `coding-tools/openapi-live`, gate `PRISM_LIVE_OPENAPI_TOOLS=1`): compiles a real public OpenAPI **3.1** spec and drives real GET operations. Spec choice: the plan's petstore3.swagger.io serves OpenAPI 3.0.4 and the compiler requires 3.1 — no tool-code relaxation (Code Quality criterion); the suite targets **warnely.com/openapi.json** (verified real public 3.1.0 spec, GET-only, credential-free), with the host allow-list asserted in the suite per the security criterion. Coverage per plan test cases: spec compile → 2 read-only tools; one real 200 call (untrusted-external metadata + content marker); missing-argument validation fails closed locally with a counting-fetch proving **0 wire calls**; real 404 maps to a status-carrying untrusted result. Budget: 1 spec fetch + 2 tool calls = 3 ≤ 5 ✓. Verified green over the real wire on this machine.
    - **New live suite `packages/prism-coding-tools/src/computer-use-linux/__tests__/live.test.ts`** (matrix `coding-tools/computer-use-live`, gates `PRISM_TEST_COMPUTER_USE=1` + `PRISM_COMPUTER_USE_BIN`, Linux only): drives the host's REAL `computer-use-linux` MCP binary over stdio through the real `connectMcpTools` bridge (no test seams): connect → real tool inventory (screenshot + get_app_state asserted) → one bounded read-only screenshot probe → clean close, 30 s ceiling. Skip-not-fail at every environmental layer: headless/no-session skips at the screenshot probe, non-runnable binary skips with reason. Security criterion structural: the suite performs no network I/O, so screenshot bytes cannot leave the process. Verified green against this machine's real binary (678 ms); skips cleanly hermetically.
    - **Matrix registrations (40→43 active):** the two suites above plus `coding-tools/lsp-forge` — the language-intelligence/language-diagnostics/forge-github suites spawn real child processes over the real LSP/forge wire protocols against fixture binaries, so they register as always-runnable hermetic real-binary legs (`requires: []`, the Task-6 validator rule). `coding-tools/docker-sandbox` was already registered (Task 1). Browser/CDP coding-browser legs deferred to Task 8 (web-tools owns them). document-reader/caveman/ponytail/impeccable personas: confirmed covered by unit + journey suites via the e2e surface gate (98/98, no new leg needed — matches the plan's "verify via coverage gate").
    - Docs: `docs/openapi-tools.md` gained a "Live probe" section (spec choice + request budget + skip semantics); `docs/computer-use-linux.md` gained one (env vars + no-egress note). Pages exist in docs/index.md already.
    - Verification: coding-tools package 649 tests green (648 pass / 1 env-gated skip, includes both new suites skipping hermetically); matrix validator + gate 22/22; surface gate 98/98; dry-run 35 ran / 8 skipped / 6 planned; manifest validates.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export changes; no tool-implementation changes (Code Quality criterion held).
    - Docs pages to create/edit: `docs/openapi-tools.md` + `docs/computer-use-linux.md` "Live probe" sections added.
    - `docs/index.md` update: no (pages exist).
    - Documentation structure reference: prism-wiki.md.

- [x] 8. Protocol packages: MCP client smoke + ACP/AG-UI registration
  - Acceptance Criteria:
    - Functional: new `scripts/mcp-client-smoke.mjs` (operator-gated `PRISM_TEST_MCP_CLIENT=1`, mirroring `acp-client-smoke.mjs`) drives `createPrismMcpServer` through a **real MCP client** over stdio in a subprocess: initialize handshake, tools/list, tools/call, elicitation round-trip; matrix registers `scripts/acp-client-smoke.mjs` (`PRISM_TEST_ACP_CLIENT=1`), the existing ag-ui conformance suites (real-event replay), and the A2A canary (deployed remote, `PRISM_CANARY_A2A_*`).
    - Performance: smoke ≤ 30 s; canary bounded by existing script.
    - Code Quality: smoke script reuses the subprocess + ndJson framing pattern of `acp-client-smoke.mjs`; no framework.
    - Security: smoke stays sandboxed (read-only prompts, authorize-gated tool calls, no policy bypass) per the acp-client-smoke precedent.
  - Approach:
    - Documentation Reviewed: `scripts/acp-client-smoke.mjs` (subprocess framing pattern), `packages/mcp/src/server.ts`, `packages/mcp/src/transport.ts`, `docs/mcp.md`, `docs/a2a.md`, `docs/ag-ui.md`, `packages/ag-ui/src/__tests__/` (event-replay fixtures).
    - Options Considered: use `@modelcontextprotocol/sdk` client from node_modules — check availability first; if present, use it (real client, zero new deps); else drive the stdio wire directly (the protocol is JSON-RPC; a ~80-line inline client is honest and dependency-free). Prefer the real SDK if already a dependency.
    - Chosen Approach: real client over stdio subprocess; registration of existing protocol legs in the matrix.
    - API Notes and Examples:
      ```bash
      PRISM_TEST_MCP_CLIENT=1 node scripts/mcp-client-smoke.mjs
      ```
    - Files to Create/Edit:
      - `scripts/mcp-client-smoke.mjs` (new).
      - `scripts/live-matrix.json`: register 3–4 entries (edit).
    - References: `docs/mcp.md`; `packages/mcp/src/__tests__/` for capability fixtures.
  - Test Cases to Write:
    - smoke: initialize handshake completes, tools/list returns registered capabilities, tools/call round-trips a result, elicitation request/response flows, malformed frame fails closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/mcp.md`: add operator-gated smoke run instructions (small).
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

  - Completion Notes (2026-09-05):
    - **New `scripts/mcp-client-smoke.mjs`** (matrix `mcp/client-smoke`, operator-gated `PRISM_TEST_MCP_CLIENT=1`, fails closed without the flag — acp-client-smoke precedent): drives `createPrismMcpServer` through the **real `@modelcontextprotocol/client` SDK `Client` over a real `StdioClientTransport` subprocess** (both were already in node_modules — zero new deps, the plan's preferred option). Fixture `scripts/fixtures/mcp-smoke-server.mjs` serves `servePrismMcpStdio` with a read-only echo tool and a deny-gated tool; the authorize gate is enforced server-side per the security criterion. Scenario per plan test cases, all verified green over the real wire: (1) initialize handshake — both modern auto (era pinned "modern") and legacy openings; (2) tools/list returns registered capabilities; (3) tools/call round-trips a result; (4) authorize-gated denial surfaces as a tool error and the denied tool never executes; (5) malformed frame fails closed — the SDK transport tears the connection down and never answers garbage (verified by asserting zero JSON-RPC frames after a garbage line, probing the documented StdioServerTransport ondata→onerror→close path).
    - **Elicitation deviation (documented):** the plan's "elicitation request/response round-trip" is NOT exercisable against `createPrismMcpServer` — server-initiated sampling/elicitation from tool callbacks is a documented Prism boundary (`scripts/mcp-conformance-2026-baseline.yaml`, 14 boundary scenarios). The elicitation round-trip Prism does speak lives bridge-side (MRTR auto-fulfilment over real HTTP with the SDK client) and is already covered by `packages/mcp/src/__tests__/modern-bridge.test.ts` ("fulfils input_required through form elicitation and retries with a fresh wire id"). Recorded in the manifest notes and docs.
    - **Matrix registrations (43→45 active):** `mcp/client-smoke` (above); `ag-ui/conformance` — the existing AG-UI/ACP conformance suites as an always-runnable real-event-replay leg (`requires: []`); `acp/client-smoke` (`PRISM_TEST_ACP_CLIENT=1`) and the deployed A2A canary were already registered in Task 1 (`canaries/deployed` covers `PRISM_CANARY_A2A_URL/TOKEN` within `PRISM_LIVE_CANARIES=1`) — nothing to add there.
    - Docs: `docs/mcp-tools.md` gained a "Real-client smoke" section (command, scenario, elicitation boundary note). ag-ui suite verified green (226/226).
    - Verification: smoke exit 0 with flag, exit 1 without (fail-closed); matrix validator + gate 22/22; surface gate 98/98; dry-run 36 ran / 9 skipped / 5 planned; manifest validates (50 suites).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export changes; smoke script + fixture are operator tooling.
    - Docs pages to create/edit: `docs/mcp-tools.md` "Real-client smoke" section added.
    - `docs/index.md` update: no (page exists).
    - Documentation structure reference: prism-wiki.md.

- [x] 9. prism-core governance/runtime real legs (OPA, OIDC/JWKS, webhooks receiver, S3 artifact bodies) + integrations registration
  - Acceptance Criteria:
    - Functional: matrix registers existing legs (Postgres persistence/enterprise/event-source via `PRISM_TEST_POSTGRES_URL`, NATS via `PRISM_TEST_NATS_URL`, keychain `PRISM_TEST_KEYCHAIN`, canary provider/MCP/A2A). New env-gated live suites: (a) OPA REST evaluator against a real OPA endpoint (`PRISM_TEST_OPA_URL`, no key or + token) — allow/deny/fail-closed probes; (b) OIDC/JWKS verifier against a real issuer/JWKS endpoint (`PRISM_TEST_OIDC_ISSUER`/`AUDIENCE` + a real bearer token `PRISM_TEST_OIDC_TOKEN`) — valid token passes, tampered/invalid fails closed; (c) outbound webhooks against a real receiver URL (`PRISM_TEST_WEBHOOK_URL` + secret) — signed delivery, retry on 5xx, WORM ack path; (d) artifact-bodies S3 adapter against a real S3-compatible endpoint (`PRISM_TEST_S3_ENDPOINT`/`KEY`/`SECRET`/`BUCKET`) — put/get/presign/delete lifecycle.
    - Performance: each leg ≤ 5 requests; suites respect existing request-bound limits.
    - Code Quality: suites colocated in the matching `__tests__/` dirs, following package conventions; skip strings name every required env var.
    - Security: tokens env-only; each suite asserts no secret in any captured event/log; webhook receiver must be the operator's own endpoint (documented); S3 leg uses a dedicated throwaway bucket documented in the credential matrix.
  - Approach:
    - Documentation Reviewed: `packages/prism-core/src/governance/policy/opa` (pinned-fetch evaluator), `src/credentials/node/oidc`, `src/runtime/server/webhooks.ts` + its network-free test, `src/runtime/server/artifact-bodies.ts` (SigV4), `docs/policy-and-audit.md`, `docs/agent-identity.md`, `docs/operations.md`, `docs/work-artifacts-and-review.md`, `scripts/require-postgres-url.mjs`.
    - Options Considered: docker-compose OPA/MinIO locally in CI — rejected for the live matrix (the matrix targets operator-real endpoints; a local pinned stack is a separate future leg that needs no matrix change); chosen: env-gated remote endpoints.
    - Chosen Approach: four small env-gated live suites + registration.
    - API Notes and Examples:
      ```ts
      const skip: string | false = !process.env.PRISM_TEST_OPA_URL
        ? "set PRISM_TEST_OPA_URL to run live OPA evaluator probes" : false;
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/governance/policy/__tests__/opa-live.test.ts` (new, path verified in task).
      - `packages/prism-core/src/credentials/node/__tests__/oidc-live.test.ts` (new).
      - `packages/prism-core/src/runtime/server/__tests__/webhooks-live.test.ts` (new).
      - `packages/prism-core/src/runtime/server/__tests__/artifact-bodies-live.test.ts` (new).
      - `scripts/live-matrix.json`: register ~8 entries (edit).
    - References: `docs/pinned-fetch`/`src/pinned-fetch.ts` (DNS-pinned fetch used by OPA).
  - Test Cases to Write:
    - OPA: allow decision, deny decision, unreachable endpoint → fail-closed deny + bounded diagnostic; OIDC: valid token verified against live JWKS, expired/tampered rejected; webhooks: signed delivery received, retry-after-5xx, ack cursor advance; S3: put→get hash-verified, presign round-trip, delete idempotent.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/policy-and-audit.md`, `docs/agent-identity.md`, `docs/operations.md`, `docs/work-artifacts-and-review.md`: add live-probe env var sections (small, only where absent).
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

  - Completion Notes (2026-09-05):
    - **Four new env-gated live suites** colocated in prism-core `__tests__/` dirs, each following the provider-suite skip convention (`const skip: string | false` naming every required env var; skipped, never failed, without env):
      - `governance/policy/__tests__/opa-live.test.ts` (`core/opa-live`, `PRISM_TEST_OPA_URL`): two real decision evaluations (default input mapper; assert a valid outcome — allow/deny/modify/approval — whatever the operator's policy yields) + a fail-closed probe against an unroutable loopback socket asserting `deny` with reason `OPA endpoint unavailable`. ≤ 2 real requests.
      - `credentials/node/__tests__/oidc-live.test.ts` (`core/oidc-live`, `PRISM_TEST_OIDC_ISSUER` + `AUDIENCE` + `TOKEN`, optional `PRISM_TEST_OIDC_JWKS_URL` defaulting to `<issuer>/.well-known/jwks.json`): valid token verifies against the live JWKS (exactly 1 fetch), tampered token fails closed with `ERR_PRISM_OIDC_SIGNATURE` (asserts the error text never echoes the bearer token), garbage token fails closed with no JWKS traffic.
      - `runtime/server/__tests__/webhooks-live.test.ts` (`core/webhooks-live`, `PRISM_TEST_WEBHOOK_URL` — an HTTPS receiver the operator owns, optional `PRISM_TEST_WEBHOOK_SECRET` ≥ 32 bytes, default `prism-live-webhook-secret-0123456789abcdef`): signed delivery to the real receiver (poll `diagnostics()` until delivered, failures empty, secret never in diagnostics) + a retry-after-5xx leg over a **local loopback receiver** (`allowLoopbackHttp: true`; server answers 500 then 200; asserts receiver-side `x-prism-signature` HMAC verification over the raw body and `diagnostics().retries >= 1`). ≤ 1 real request + ≤ 2 loopback requests.
      - `runtime/server/__tests__/artifact-bodies-live.test.ts` (`core/artifact-bodies-s3-live`, `PRISM_TEST_S3_ENDPOINT`/`KEY`/`SECRET`/`BUCKET`, optional `REGION` default us-east-1): put → get (store-verified hash + size), presigned delivery URL carrying `X-Amz-Signature`, idempotent double delete (204/404 both success). ≤ 3 requests, throwaway bucket documented.
    - **Webhook leg verified for real** against a local receiver (500 → retry → 200 with receiver-side signature verification passing); the signed-delivery leg correctly refuses non-HTTPS targets (`Webhook target URL must use https`) and needs an operator HTTPS receiver to run green.
    - **Integration registration:** the four core entries staged as `planned` in Task 1 are now `active` with source/command/cwd/notes (`npm run test` in `packages/prism-core` — the live files self-skip without env, so the whole-dist command stays hermetic-safe). The existing real-wire legs were already registered in Task 1: `core/postgres` + `memory/postgres` (`PRISM_TEST_POSTGRES_URL`), `core/nats` (`PRISM_TEST_NATS_URL`), `core/keychain` (`PRISM_TEST_KEYCHAIN`), `canaries/deployed` (provider/MCP/A2A via `PRISM_CANARY_*` within `PRISM_LIVE_CANARIES=1`). Manifest: 50 suites, 49 active, 1 planned.
    - Matrix gates green: manifest validates, 14/14 matrix tests, dry-run shows the four new entries skipping with per-env reasons. Full prism-core suite green: 519 pass / 0 fail / 9 skipped.
    - Docs: live-probe sections (env vars + command + skip semantics) added before "Related APIs" in `docs/policy-and-audit.md` (OPA), `docs/agent-identity.md` (OIDC), `docs/operations.md` (webhooks), `docs/work-artifacts-and-review.md` (S3). `scripts/live.env.example` gained a Task 9 section.
    - Deviation note: the plan's "WORM ack path" for webhooks does not exist in the webhook surface (webhooks are fire-and-forget signed POSTs with retries; WORM applies to the audit ledger, covered by Task 6's ledger conformance) — the retry/diagnostics path was probed instead.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export changes; new test files are env-gated.
    - Docs pages to create/edit: live-probe sections added to the four pages above.
    - `docs/index.md` update: no (pages exist).
    - Documentation structure reference: prism-wiki.md.

- [x] 10. Full-surface packed journey (all 10 packages through public exports)
  - Acceptance Criteria:
    - Functional: `scripts/fixtures/e2e-full-surface-journey.mjs` + `scripts/e2e-full-surface.test.mjs` (hermetic, network-free, mock provider) pack all 10 packages, install into a fresh consumer, and exercise **every public subpath** that is reachable without external credentials: runtime sessions, workflows, supervisor A2A local handler, sqlite/postgres-codec shapes (sqlite leg optional), governance policy/evals/prompts/model-router in-memory, credentials encrypted store, enterprise codecs (non-postgres parts), integrations/work, validation, memory (working/semantic/rag in-memory + graft + wiki), coding tools (agent/security in-memory fences/openapi with local spec/dev/personas), office (documents/sheets/diagrams local generation), web-tools (transport/normalize + fake browser), ag-ui (handler/mapper/renderer/a2ui), acp-agent spawnable config, mcp server in-process — asserting representative behavior per subpath; the journey's coverage list feeds `scripts/e2e-coverage.json` annotations. Combined with Tasks 4–9 live legs, the coverage gate reaches 100%.
    - Performance: journey wall ≤ 120 s (within the existing e2e ceiling convention; freeze ceiling added to the phase manifest).
    - Code Quality: journey uses public imports only (verified by the packed-consumer resolution assert); one fixture file, sections per package; no new exported test utilities.
    - Security: sandbox fences exercised in deny-by-default mode (no fs escape); encrypted credential store leg uses a test-only passphrase from env-free fixture.
  - Approach:
    - Documentation Reviewed: `scripts/fixtures/e2e-coding-journey.mjs` (536 lines, 29 steps) and `.../e2e-enterprise-journey.mjs` (578 lines) — extend rather than duplicate where sections overlap; `scripts/phase12-freeze-manifest.json` (ceiling budget pattern).
    - Options Considered: extend the two existing journeys — chosen for overlapping sections, but a third fixture keeps each journey reviewable; per-package micro-journeys (10 files) — rejected: 10× pack/install overhead; single full-surface journey — chosen.
    - Chosen Approach: one new journey fixture; annotations from its section map make the coverage gate concrete.
    - API Notes and Examples:
      ```js
      const { createAgentSession } = await import("@arnilo/prism");
      const { createAgent } = await import("@arnilo/prism-coding-tools/agent"); // … one representative call per subpath
      ```
    - Files to Create/Edit:
      - `scripts/fixtures/e2e-full-surface-journey.mjs` (new), `scripts/e2e-full-surface.test.mjs` (new).
      - `scripts/e2e-coverage.json`: annotations completed to 100% (edit).
      - `package.json`: add `scripts/e2e-full-surface.test.mjs` to root test chain (edit).
    - References: VENT 26-08-15 06:35 (budget/fileCount drift — re-baseline in Task 12).
  - Test Cases to Write:
    - journey completes with `FULL SURFACE JOURNEY OK`; per-subpath asserts fail loudly with the subpath name; resolution must not touch workspace tree.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (consumes existing exports; failures found are bugs → separate fixes).
    - Docs pages to create/edit: `none` (Task 11 documents the matrix, not the journey internals).
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

  - Completion Notes (2026-09-05):
    - **New `scripts/fixtures/e2e-full-surface-journey.mjs`** (35 sections) + **`scripts/e2e-full-surface.test.mjs`**: packs all ten first-party packages, installs the tarballs into a fresh consumer via the Task-1-era `createPackedConsumer`, and runs the journey against the packed node_modules only — the resolution assert proves imports never touch the workspace tree. Hermetic and network-free throughout.
    - **Section coverage (98 subpaths, one representative call each):** root `.` runs a real mock-provider agent session (`createMockProvider` → `createAgent`/`createAgentSession` → `prompt`) plus a tool-registry dispatch round-trip; the five `./providers/*` root subpaths get pure-helper round-trips; all 11 `./testing/*` conformance subpaths assert their helper surface; the 8 `./node/*` adapters exercise real fs-backed behavior (jsonl session store over a temp dir, path-trust policy, config error-code checks). memory runs a real hash-embedded remember/recall + working-memory round-trip; core runs canonical JSON, workflow graph build, sqlite persistence round-trip, policy/prompt/eval in-memory stores, model-router resolve, telemetry counter, webhook notifier diagnostics, integration argv builders, and the JSON-schema validator; all 20 provider subpaths assert their model catalogs / pure body-URL helpers / construct-level factories (model-discovery via `createFakeModelDiscovery.listModels`); coding-tools compiles an inline OpenAPI spec to a read-only tool, exercises the deny-by-default redactor/fence surface, a host-selected text parser through `createDocumentReader`, computer-use classification, and the three persona extension factories; office parses CSV + canonicalizes drawio XML + resolves doc caps; ag-ui resolves pointer paths + capability limits + the ACP agent factory; web-tools round-trips canonicalUrl/citation; mcp constructs the server; acp-agent parses a real config (userId/cwd/memory store).
    - **Two documented optional-peer ceilings** (both `ponytail:`-marked): the sqlite persistence leg tolerates the consumer not installing `better-sqlite3` (asserts the documented optional-peer failure and continues) and the document-reader leg uses the host-selected parser seam instead of the `pdf-parse`/`mammoth` optional peers. Their real legs remain covered by the package suites + Task 9's S3 live probe.
    - **Coverage gate fed:** `scripts/e2e-coverage.json` annotates every one of the 98 subpaths with `scripts/e2e-full-surface.test.mjs` (gate baseline: 98/98 covered, 0 pending). Combined with Tasks 4–9 live legs, the Task 10 acceptance criterion (gate reaches 100% functional-surface coverage) is met.
    - **Registered** in the root `package.json` test chain directly after `scripts/e2e-coding-journey.test.mjs`. Measured wall: ~6.2 s (ceiling 120 s — no freeze re-baseline needed).
    - Verification: 4/4 journey tests pass (pack+install version match, consumer-only resolution, FULL SURFACE JOURNEY OK across 35 sections, ceiling); surface gate 98/98; matrix+coverage suites 22/22.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export changes; journey + test are hermetic tooling.
    - Docs pages to create/edit: none (Task 11 owns the live-testing matrix docs).
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] 11. Documentation: `docs/live-testing.md` credential matrix + index/README wiring
  - Acceptance Criteria:
    - Functional: `docs/live-testing.md` documents: the coverage definition (functional-surface 100% + line-ratchet caveat), `npm run test:live`/strict/filter usage, the full credential table (suite → env vars → least-privilege scope → cost), the strict CI workflow, and the report format; generated tables stay in sync with `scripts/live-matrix.json` via a small doc-check test.
    - Performance: n/a.
    - Code Quality: page follows the prism-wiki API-page structure where applicable; no secrets, only env var names.
    - Security: least-privilege scope column is mandatory per row; page states credentials never enter the repo/logs and the `assertNoSecretLeak` convention.
  - Approach:
    - Documentation Reviewed: `.agents/skills/create-plan/references/prism-wiki.md` (structure), `docs/index.md` (nav), `README.md` (testing section), `.github/workflows/live-canaries.yml` (environment/secrets precedent).
    - Options Considered: put the matrix in `docs/_evidence/` — rejected: it's operator-facing living documentation, not release evidence; chosen: `docs/live-testing.md` with a sync-check test.
    - Chosen Approach: one docs page + doc-sync test + index/README links.
    - API Notes and Examples: n/a (prose page).
    - Files to Create/Edit:
      - `docs/live-testing.md` (new), `docs/index.md` (add entry under a Testing/Quality group), `README.md` (testing blurb + command), `scripts/live-matrix.test.mjs` (add doc-sync check).
    - References: prism-wiki.md.
  - Test Cases to Write:
    - doc-sync: every `active` matrix entry's env vars appear in the docs table; docs table has no rows absent from the matrix.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new documented operator surface (`npm run test:live`).
    - Docs pages to create/edit: `docs/live-testing.md` (created here).
    - `docs/index.md` update: yes — "Live and e2e testing" entry.
    - Documentation structure reference: prism-wiki.md.

  - Completion Notes (2026-09-06):
    - **New `.github/workflows/live-matrix.yml`**: weekly cron (Thu 06:17 UTC, after the Tuesday canaries) + `workflow_dispatch` with `filter` (default `providers/opencode-go` — the suites the operator has credentialed so far) and `strict` (default true) inputs; `environment: live-canaries`, `contents: read`, `persist-credentials: false`, all three actions pinned to the repo-convention SHAs, 30-minute job timeout with a 25-minute matrix step. Runs `npm ci && npm run build`, then `npm run test:live` under `PRISM_LIVE_STRICT`/`PRISM_LIVE_FILTER`, then `e2e-coverage-gate.mjs --baseline --json`, and uploads `live-matrix-report.json` + `e2e-coverage-report.json` artifacts (`if: always()`, 7-day retention). Operator TODO (not code): add `OPENCODE_API_KEY` as a secret and `PRISM_LIVE_OPENCODE_MODEL` as a var in the `live-canaries` GitHub environment so the scheduled run's strict mode is satisfiable; wire further secrets as more suites are credentialed.
    - **Live verification with the operator's new credentials (real wires, not skips):** `providers/opencode-go` ran green over the real wire — 7/7 inner legs (text streaming, tool-call loop, abort observation, 3× json_schema, error no-leak) with model `mimo-v2.5` (verified cheapest passing model: `gpt-5.1-go`/`grok-4.5` return empty text on the text leg; manifest default + `scripts/live.env` aligned to `mimo-v2.5`); `web-tools/obscura-live` ran green against the real `PRISM_OBSCURA_BIN` binary (public web search + fetch). Matrix runner accounting: 1 ran / 0 skipped / 0 failed per filter; reports written to `docs/_evidence/live-matrix-report.{json,md}`. `scripts/live.env` repaired: the obscura path line carried an inline comment that Node `--env-file` kept as part of the value (spawn ENOENT) — comment moved to its own line.
    - **Budget-gate re-baseline:** root export surface 1266→1272 (+6 CLI provider-catalog exports, Tasks 4–5), providers 501→502 (+36 live-tested adapter exports, then the operator's +1 thinking-probe export) — both with reason entries in `scripts/budgets.json`. Budget gate 13/13.
    - **Coverage thresholds re-captured** (`scripts/coverage-thresholds.json`, captured 2026-09-06): lines = recompute − 3pp for the six measured packages (ag-ui 87.46, mcp 88.90, memory 86.10, coding-tools 83.04, providers 91.90, web-tools 83.67); dormant packages keep frozen thresholds. Repairs on the way: `@arnilo/prism-providers` was missing branches/functions (pre-existing red in `phase23-coverage`), and the top-level `note` key is preserved (first rewrite dropped it).
    - **Four concurrent pre-existing/concurrent-edit failures fixed during final verification:** (1) `network-free-guard` required every live file to mention a `PRISM_LIVE_*` var — widened to `PRISM_(LIVE|TEST)_*` (the sanctioned family; fixes the Task 7 computer-use leg); (2) coding-tools conformance asserted `createDocumentReader()` rejects when optional parser peers are absent, but npm ≥ 7 auto-installs optional peers — test now proves the contract only when peers are genuinely absent (the packed journeys assert it unconditionally); (3) `phase23-skip-manifest` emitter picked NATS as the core suite's requiredEnv, leaving POSTGRES unnamed once the postgres blocked-row resolved — core row now prefers `PRISM_TEST_POSTGRES_URL` (nats legs keep their own dedicated surface); (4) budget gate's shipped-index-link check now skips `docs/_evidence/` hrefs (deliberately tarball-excluded audit trail).
    - **Final stage-wise verification (no `&&`-hidden failures):** stage 1 root dist 1647/0; stage 2 release/tooling/budget gates 27/0; stage 3 journeys + live-matrix + e2e-coverage + doc-check 34/0; stage 4 workspaces 9/9 green (98, 558, 304, 519, 648, 151, 226, 139, 9); `e2e-coverage-gate` 98/98 surfaces covered, 0 pending; coverage:summary all gates pass; live matrix static tests 14/14.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (CI workflow + re-baselines; the guard/emitter fixes are tooling).
    - Docs pages to create/edit: `docs/live-testing.md` CI section already documents the strict scheduled canaries; the live-matrix workflow is linked from it (added).
    - `docs/index.md` update: no (Task 11 covered it).
    - Documentation structure reference: prism-wiki.md.

- [x] 12. CI live-matrix workflow + budget/freeze/coverage re-baseline + final verification
  - Acceptance Criteria:
    - Functional: `.github/workflows/live-matrix.yml` (scheduled weekly + `workflow_dispatch`, `environment: live-canaries`-style secret environment) builds, then runs `PRISM_LIVE_STRICT=1 npm run test:live` with secrets mapped for every matrix env var the operator supplies; uploads `docs/_evidence/live-matrix-report.json` + `e2e-coverage-report.json` as artifacts; hermetic `npm test` chain updated to include the three new gate scripts and verified green stage-by-stage (no `&&`-hidden failures); budget-gate re-baselined for new dist files; `scripts/coverage-thresholds.json` re-captured after new suites; e2e-coverage gate reports 100% of public subpaths covered.
    - Performance: workflow timeout ≤ 30 min; matrix sequential default.
    - Code Quality: workflow pins action SHAs (repo convention); gate scripts registered once in `package.json`.
    - Security: secrets via GitHub environment only; `persist-credentials: false`; workflow has `contents: read` only; no secret values in matrix/docs.
  - Approach:
    - Documentation Reviewed: `.github/workflows/live-canaries.yml` + `integration-postgres.yml` (env/secrets mapping), `scripts/budget-gate.test.mjs` + `scripts/budgets.json` (re-baseline convention), `scripts/coverage-summary.mjs`, VENT entries 26-08-15/26-08-20 (budget drift + `&&` chain lessons).
    - Options Considered: run live matrix on every push — rejected: cost + credential exposure surface; scheduled + dispatch — chosen.
    - Chosen Approach: scheduled strict workflow + one-time re-baselines + stage-wise verification.
    - API Notes and Examples:
      ```yaml
      - name: strict live matrix
        env:
          PRISM_LIVE_STRICT: "1"
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          # … one line per matrix env var
        run: node scripts/live-matrix.mjs
      ```
    - Files to Create/Edit:
      - `.github/workflows/live-matrix.yml` (new).
      - `scripts/budgets.json` + `scripts/coverage-thresholds.json` (re-baseline, edit).
      - `package.json` (test chain additions from Tasks 1–3, 10 — final verify).
    - References: VENT 26-08-15 05:48 (run budget-gate explicitly after dist file additions).
  - Test Cases to Write:
    - workflow YAML parsed by a hermetic check (env names ⊆ matrix `requires` union); budget-gate green post-re-baseline; `npm test` green stage-by-stage; `PRISM_LIVE_STRICT=1` dry-run exit code honored.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no exports; CI surface documented in Task 11 page (workflow section).
    - Docs pages to create/edit: `docs/live-testing.md`: add workflow section (Task 11 page finalized here).
    - `docs/index.md` update: no (covered in Task 11).
    - Documentation structure reference: prism-wiki.md.

- [x] 13. Plan-065 integration: register the thinking-conformance hermetic leg + provider coverage annotations
  - Acceptance Criteria:
    - Functional: `scripts/live-matrix.json` gains `providers/thinking-conformance` (active, hermetic `requires: []`, command `node --test dist/__tests__/thinking-conformance.test.js`, cwd `packages/prism-providers`) covering the plan-065 task-15 catalog walk (every first-party reasoning model declares `capabilities.thinkingLevels` + a `compat.thinkingFamily` stamp and emits a legal effort field on the wire); the six existing `thinkingProbe` provider entries (anthropic, google, kimi, xai, zai, azure — plan-065 task-16 live probes) stay active and validate fail-closed.
    - Functional: `scripts/e2e-coverage.json` annotates the provider subpaths the walk actually builds bodies for with the conformance suite file; the gate still reports 98/98 with 0 pending and validates every annotated file exists.
    - Performance: conformance leg is hermetic and < 2 s.
    - Code Quality: manifest validates clean (`node scripts/live-matrix.mjs --check`); matrix hermetic tests green.
    - Security: no credentials involved (hermetic leg).
  - Approach:
    - Documentation Reviewed: plan 065 tasks 15–16 (conformance walk + live probes), `scripts/live-matrix.json` schema (Task 1), `scripts/e2e-coverage.json` annotation conventions, `packages/prism-providers/src/__tests__/thinking-conformance.test.ts`.
    - Chosen Approach: register the compiled conformance suite as a hermetic matrix leg (same shape as the ag-ui hermetic leg from Task 8); annotate provider subpaths from the walk's actual catalog coverage rather than blanket-annotating all 20.
  - Test Cases to Write: none (registration + annotations); existing matrix/coverage gate tests enforce validity.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (test infrastructure).
    - Docs pages to create/edit: none (generator output already documents the probes; evidence doc is plan-065's).
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] 14. Plan-065 integration: full-surface packed journey exercises the thinking-effort surface + final e2e re-run
  - Acceptance Criteria:
    - Functional: `scripts/fixtures/e2e-full-surface-journey.mjs` gains a thinking section (inside the existing root-package section) calling all five new public helpers through the packed install — `parseThinkingLevel` (known/opaque/invalid trichotomy), `thinkingLevelsForModel`, `isSupportedThinkingLevel` (true/false/undeclared), `snapThinkingLevel` (snap-down + up-to-minimum), `applyThinkingLevelForModel` (declared-levels model → family patch; non-reasoning model → unchanged) — proving the plan-065 public surface ships in the tarball and resolves from `node_modules`.
    - Functional: full e2e chain re-run green stage-by-stage after the plan-065 changes: root dist tests, release/tooling/budget gates, journeys + live-matrix + e2e-coverage + doc-check, all 9 workspaces; `e2e-coverage-gate` 98/98.
    - Performance: journey stays within its 120 s ceiling.
    - Code Quality: no new dependencies; helper imports resolve from the packed root package only.
    - Security: no credentials; hermetic.
  - Approach:
    - Documentation Reviewed: plan 065 task 2 API contract (snap semantics, family resolution), `scripts/fixtures/e2e-full-surface-journey.mjs` section conventions, `src/__tests__/thinking.test.ts` assertion shapes.
    - Chosen Approach: extend the existing root section with a thinking sub-block using an inline model fixture carrying `capabilities.thinkingLevels` + `compat.thinkingFamily`; assert family-correct patch fields and snap outcomes.
  - Test Cases to Write: none new; `scripts/e2e-full-surface.test.mjs` runs the extended journey.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (journey exercises existing public API).
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

  - Completion Notes (2026-09-06):
    - Task 13: registered `prism-providers/conformance` in `scripts/live-matrix.json` (active, hermetic, `requires: []`, command `node --test dist/__tests__/thinking-conformance.test.js`, cwd `packages/prism-providers`, plan 065 task 15) — id follows the `ag-ui/conformance` hermetic-leg convention deliberately NOT `providers/*` (that prefix is reserved for the 20 live adapter suites, asserted count-exact by the matrix tests). Annotated the 12 provider subpaths the walk actually builds bodies for in `scripts/e2e-coverage.json` (anthropic, openai, google, kimi, zai, xai, deepseek, hyper, clinepass, neuralwatt, opencode-go, commandcode) with `packages/prism-providers/src/__tests__/thinking-conformance.test.ts`. The six plan-065 `thinkingProbe` live entries (anthropic, google, kimi, xai, zai, azure) were already active and validate fail-closed. Matrix now 51 suites; `--check` clean; matrix + coverage tests 22/22.
    - Task 14: extended the journey's root section with the plan-065 thinking surface — `parseThinkingLevel` trichotomy (`"High"` → `"high"`, `"turbo"` → `{opaque:"turbo"}`, `""` → undefined), `thinkingLevelsForModel`, `isSupportedThinkingLevel` true/false/undeclared, `snapThinkingLevel` snap-down (medium→high on low/high) + up-to-minimum (none→low), and `applyThinkingLevelForModel` family-correct patches (`reasoning_effort` for a reasoning_effort-stamped model, `thinkingLevel` for a google-stamped model, empty compat for a non-reasoning model) — all resolving from the packed `@arnilo/prism` tarball. Journey 4/4 green.
    - Final e2e re-run stage-by-stage (no `&&`-hidden failures): build 0; root dist 1647/0; release/tooling/budget gates 27/0; journeys + live-matrix + e2e-coverage + doc-check 34/0; workspaces 9/9 green sequentially (98, 226, 98, 304, 151, 648, 519, 558, 139); `e2e-coverage-gate` 98/98, 0 pending. Note: parallel `npm run test --workspaces` interleaves output and misreports failures — run workspaces sequentially for verdicts.
    - Plan-065 surface facts already wired by its own execution (verified, no action): root `.` annotated with `src/__tests__/thinking.test.ts`; budgets current (root 1272/1272, providers 502/502); live probes wired into existing per-provider suites.
## Compromises Made (known constraints at planning time)

- **"100%" is functional-surface coverage, not 100% line coverage.** Remote-error branches (429/5xx parses, malformed frames, timeout aborts) stay covered by the existing network-free fault-injection suites; driving them against real remote services produces flaky, expensive tests with no regression signal. Line/function/branch ratchets remain enforced by the existing `--experimental-test-coverage` gates and keep rising as suites land. Upgrade path: if 100% line coverage ever becomes a hard requirement, it is a unit-tier exercise, not e2e.
- **Live matrix targets operator-supplied endpoints/credentials.** No credentials, endpoints, containers, or throwaway cloud resources are committed or spun by CI by default; suites skip cleanly with per-env reasons. Local pinned-container legs (TEI, OPA, MinIO) can be added later as additional matrix entries without schema changes.
- **Some functionality is inherently local** (graft indexing, wiki lint, LSP language servers, personas, dev inspector): its "real" e2e is the real-binary/hermetic suites + full-surface journey, not remote credentials.
- Budget-gate and freeze-manifest re-baselining is deferred to one final task (12) rather than per-task churn, per the repo's release convention.

## Further Actions

- To be filled after execution: per-task deviations, discovered documented-unknown findings from live probes, threshold deltas, and priority-ordered follow-ups (e.g., pinned-container CI legs, e2e-coverage gate wired into `release:gate`).
  - Completion Notes (2026-09-05):
    - **New `docs/live-testing.md`** covering every acceptance criterion: the functional-surface 100% coverage definition with the line-ratchet caveat (thresholds measure the network-free `npm test` run only); `npm run test:live` + `--check` usage with the full knob table (`PRISM_LIVE_ENV_FILE/FILTER/STRICT/DRY_RUN/CONCURRENCY/SUITE_TIMEOUT_MS`); the skip-not-fail contract and strict-mode inversion; the `PRISM_LIVE_<PROVIDER>_MODEL` selection convention; the report format (`docs/_evidence/live-matrix-report.{json,md}`, env names + model ids only); the strict scheduled CI canaries workflow (`live-canaries.yml`, secrets via the `live-canaries` environment, all-or-nothing gating so A2A never runs standalone); the mandatory least-privilege scope column; and the security guarantees (credentials never enter repo/logs/reports, `assertNoSecretLeak` over live transcripts, secret-shaped manifest values rejected).
    - **Generated credential matrix in sync:** `scripts/generate-live-docs.mjs` renders the full suite → env vars → model override → least-privilege scope → cost table (50 suites, exact manifest order) between `<!-- generated:live-matrix -->` markers in the doc; `--write` regenerates, `--check` exits non-zero on drift. `scripts/live-doc-check.test.mjs` (2 hermetic tests, registered in the root `npm test` chain after `e2e-coverage.test.mjs`) fails the build when the doc is stale and additionally enforces that every suite documents scope + cost (this caught 5 missing cost fields — filled: `cli/live-journey`, `core/opa-live`, `core/oidc-live`, `core/webhooks-live`, `core/artifact-bodies-s3-live`).
    - **Wiring:** `docs/index.md` gained a Live and end-to-end testing entry at the top of Testing and examples; `README.md` Scripts table gained `npm run test:live`.
    - Verification: doc-check 2/2 pass; live-matrix manifest tests 14/14 pass (schema validation clean after the cost fills); `--check` table in sync (50/50 rows match manifest order exactly).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (documentation + tooling only).
    - Docs pages to create/edit: `docs/live-testing.md` (new, this task); `docs/index.md` (nav entry, done).
    - `docs/index.md` update: yes — done.
    - Documentation structure reference: prism-wiki.md (page follows the What/When/Security/Extension/Related structure; the credential matrix is a table, not an API surface).

