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

- [ ] 1. Primitive inventory + live credential matrix design
  - Acceptance Criteria:
    - Functional: `scripts/live-matrix.json` exists, validated by a gate test, listing **every** live/real suite known today (14 provider live suites, web-tools `test:live` 3 legs, memory llm-compaction live, observational-memory live, office LibreOffice golden + drawio live + dashscope, acp-client-smoke, Postgres/NATS/Docker/keychain/Playwright/obscura integration legs, live canaries) plus the planned gap suites with `status: "planned"` entries; each entry carries package, test command, required env vars, least-privilege scope note, and cost note.
    - Performance: manifest parse + validation < 100 ms; the gate test runs hermetically in < 2 s.
    - Code Quality: single schema (TS type in `scripts/live-matrix.mjs`), no per-suite bespoke logic; matrix entries reference existing test files (no new test files in this task).
    - Security: manifest contains env var *names* only, never values; schema validation rejects unknown fields (fail closed).
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
        "package": "@arnilo/prism-providers/openai",
        "command": "node --test dist/openai/__tests__/live.test.js",
        "cwd": "packages/prism-providers",
        "requires": ["PRISM_LIVE_PROVIDER_TESTS", "OPENAI_API_KEY"],
        "scope": "chat completion key; least privilege: project-scoped key",
        "cost": "~1 text + 1 tool-call request on gpt-5-mini class model",
        "status": "active"
      }
      ```
    - Files to Create/Edit:
      - `scripts/live-matrix.json`: the full manifest (new).
      - `scripts/live-matrix.mjs`: schema, validation, runner (new; runner body lands in Task 2).
      - `scripts/live-matrix.test.mjs`: hermetic validation gate (new).
      - `package.json`: add `scripts/live-matrix.test.mjs` to the root `test` script-gate chain (edit).
    - References: `AGENTS.md` graft workflow; VENT.md 26-08-15 (`&&` chain hides downstream failures — add new gate scripts to the chain explicitly and verify per stage).
  - Test Cases to Write:
    - `scripts/live-matrix.test.mjs`: manifest parses, every `command` targets an existing built test file, `requires` entries match `^[A-Z][A-Z0-9_]+$`, planned-vs-active status valid, no secret-looking values (no `sk-`, no `=` in env fields).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal test tooling).
    - Docs pages to create/edit: `none` for this task (Task 11 writes `docs/live-testing.md` from the finished matrix).
    - `docs/index.md` update: no.
    - Documentation structure reference: `plans/064…` task 11; not applicable here.

- [ ] 2. Live matrix runner with accounting + strict mode (`npm run test:live`)
  - Acceptance Criteria:
    - Functional: `npm run test:live` executes each `active` suite whose `requires` are all present (inherited env), records per-suite `ran|skipped:<reason>|failed`, exits non-zero on any failure; `PRISM_LIVE_STRICT=1` exits non-zero on any skip; `PRISM_LIVE_FILTER=<substring>` selects suites; writes `docs/_evidence/live-matrix-report.json` + `docs/_evidence/live-matrix-report.md` (tables: suite, status, duration).
    - Performance: suites run sequentially by default (cost-bounded), `PRISM_LIVE_CONCURRENCY=<n>` opt-in; total runtime bounded by per-suite node --test default timeouts.
    - Code Quality: runner ≤ ~200 lines, no deps beyond node stdlib; reuses `with-build-lock.mjs` for build freshness; report deterministic shape (stable keys).
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
      - `scripts/live-matrix.mjs`: fill runner body (edit, from Task 1 skeleton).
      - `package.json`: `"test:live": "node scripts/live-matrix.mjs"` (edit).
      - `scripts/live-matrix.test.mjs`: runner unit leg — dry-run accounting against a fixture matrix (`PRISM_LIVE_DRY_RUN=1`) (edit).
    - References: `.github/workflows/integration-postgres.yml` (env wiring precedent).
  - Test Cases to Write:
    - dry-run accounting: missing-credential suite counted `skipped:PRISM_LIVE_PROVIDER_TESTS` when key absent, `ran` when present (fixture matrix + fake env).
    - strict mode: dry-run with a skip exits 1 with the reason table.
    - filter mode: only matching suites execute.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (repo tooling; developer-facing command documented in Task 11).
    - Docs pages to create/edit: `none` here; Task 11.
    - `docs/index.md` update: no.
    - Documentation structure reference: task 11.

- [ ] 3. E2E surface coverage gate — the "100%" enforcement
  - Acceptance Criteria:
    - Functional: `node scripts/e2e-coverage-gate.mjs` reads each package's `exports` map (root + 9 workspaces), maps every subpath → covering suites from a checked-in `scripts/e2e-coverage.json` (generated + hand-annotated), and exits non-zero listing any subpath with no covering suite (journey / live / real-wire / conformance-over-real-wire). Baseline lands at 100% only after Tasks 4–9 register their suites; until then the gate runs in `--baseline` mode against the current map and fails only on *regressions* (a previously covered subpath losing coverage or a new subpath landing unannotated).
    - Performance: gate runs hermetically < 5 s (static analysis only, no test execution).
    - Code Quality: subpath extraction uses package.json `exports` keys directly (no hand-maintained list that can drift); annotations name a real test file path that must exist.
    - Security: none beyond standard script hygiene.
  - Approach:
    - Documentation Reviewed: root + all `packages/*/package.json` `exports` maps (21 core, 20 providers, 8 memory, 10 coding-tools, 6 web-tools, 3 office, 3 ag-ui, 1 acp, 1 mcp subpaths + root), `scripts/package-truth.mjs` (existing export-inventory precedent), `scripts/dead-export-verify.mjs`.
    - Options Considered: line-coverage 100% via e2e — rejected (see Definition section); istanbul/c8 deep imports — rejected (new dep, wrong model: e2e counts *surfaces*, not lines); exports-map → suite manifest gate — chosen.
    - Chosen Approach: static manifest gate; wired into `npm run test:live` report output and a new `scripts/e2e-coverage.test.mjs` chain entry.
    - API Notes and Examples:
      ```json
      { "@arnilo/prism-providers/openai": {
          "suites": ["packages/prism-providers/src/openai/__tests__/live.test.ts",
                     "packages/prism-providers/src/openai/__tests__/responses.test.ts"],
          "mode": "live+conformance" } }
      ```
    - Files to Create/Edit:
      - `scripts/e2e-coverage-gate.mjs` (new), `scripts/e2e-coverage.json` (new, generated), `scripts/e2e-coverage.test.mjs` (new).
      - `package.json`: register `scripts/e2e-coverage.test.mjs` in root test chain (edit).
    - References: `scripts/packaging-current.test.mjs` (export-map drift detection precedent).
  - Test Cases to Write:
    - gate fails on a fixture package with an unannotated subpath; passes with annotation; fails when annotation names a nonexistent test file; `--baseline` regression mode behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (test gate).
    - Docs pages to create/edit: covered by Task 11 (the coverage definition is documented there).
    - `docs/index.md` update: no.
    - Documentation structure reference: task 11.

- [ ] 4. Provider live suite completion (ai-sdk, azure, bedrock, model-discovery, ollama, vertex)
  - Acceptance Criteria:
    - Functional: each of the 6 adapters without live tests gets `__tests__/live.test.ts` following the canonical pattern: env-gated skip, `assertProviderStreamConforms`, `assertNoSecretLeak`, at least one text + one tool-call request, usage accounting asserted, abort observed (`assertAbortIsObserved`); azure uses `AZURE_OPENAI_ENDPOINT`+`AZURE_OPENAI_API_KEY`+deployment env; bedrock uses the AWS default credential chain + `AWS_REGION` (skip when `aws` creds unavailable); vertex uses `GOOGLE_APPLICATION_CREDENTIALS`/`GOOGLE_VERTEX_PROJECT`; ollama uses `OLLAMA_BASE_URL` (local/remote server, no key required — real-binary leg); model-discovery reuses provider keys to hit real `/models` endpoints; ai-sdk leg runs over a real underlying provider key. All 14 existing live suites verified against the matrix and left unchanged unless a drift fix is required.
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
      - `scripts/live-matrix.json`: mark 6 planned entries `active` (edit).
    - References: docs pages `docs/providers/*.md` for documented-unknown behaviors (hyper precedent: probe failures ARE findings, recorded in docs).
  - Test Cases to Write:
    - per adapter: `live_text_generation_streams_and_accounts_usage`, `live_tool_call_loop_conforms_and_leaks_no_secret`, `live_abort_is_observed`; ollama adds `live_local_server_healthgate` (skip when `OLLAMA_BASE_URL` unset).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export changes; live behavior findings may require `docs/providers/*.md` notes (documented-unknown pattern) — task updates the relevant provider page when a probe contradicts docs.
    - Docs pages to create/edit: `docs/providers/azure.md`, `bedrock.md`, `vertex.md`, `ollama.md`, `ai-sdk.md`, `model-discovery.md`: add "live probe" run instructions (env vars) only where such sections don't exist.
    - `docs/index.md` update: no (provider pages already linked).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] 5. Root CLI + scaffold live journey (`prism init`, `prism --mode print|json|rpc` over a real provider)
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

- [ ] 6. Memory + office real legs registration and RAG live gaps
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

- [ ] 7. Coding-tools real legs (sandbox, LSP/forge, OpenAPI, computer-use-linux, document-reader)
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

- [ ] 8. Protocol packages: MCP client smoke + ACP/AG-UI registration
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

- [ ] 9. prism-core governance/runtime real legs (OPA, OIDC/JWKS, webhooks receiver, S3 artifact bodies) + integrations registration
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

- [ ] 10. Full-surface packed journey (all 10 packages through public exports)
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

- [ ] 11. Documentation: `docs/live-testing.md` credential matrix + index/README wiring
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

- [ ] 12. CI live-matrix workflow + budget/freeze/coverage re-baseline + final verification
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

## Compromises Made (known constraints at planning time)

- **"100%" is functional-surface coverage, not 100% line coverage.** Remote-error branches (429/5xx parses, malformed frames, timeout aborts) stay covered by the existing network-free fault-injection suites; driving them against real remote services produces flaky, expensive tests with no regression signal. Line/function/branch ratchets remain enforced by the existing `--experimental-test-coverage` gates and keep rising as suites land. Upgrade path: if 100% line coverage ever becomes a hard requirement, it is a unit-tier exercise, not e2e.
- **Live matrix targets operator-supplied endpoints/credentials.** No credentials, endpoints, containers, or throwaway cloud resources are committed or spun by CI by default; suites skip cleanly with per-env reasons. Local pinned-container legs (TEI, OPA, MinIO) can be added later as additional matrix entries without schema changes.
- **Some functionality is inherently local** (graft indexing, wiki lint, LSP language servers, personas, dev inspector): its "real" e2e is the real-binary/hermetic suites + full-surface journey, not remote credentials.
- Budget-gate and freeze-manifest re-baselining is deferred to one final task (12) rather than per-task churn, per the repo's release convention.

## Further Actions

- To be filled after execution: per-task deviations, discovered documented-unknown findings from live probes, threshold deltas, and priority-ordered follow-ups (e.g., pinned-container CI legs, e2e-coverage gate wired into `release:gate`).
