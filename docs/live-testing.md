# Live and end-to-end testing

## What it does

Prism ships three network-free test tiers by default (`npm test`, per-package `node --test` suites, and packed-consumer journeys) plus an opt-in **live matrix** that runs the same public surface against real credentials. This page documents how to run the live matrix, which credentials each suite needs, and the guarantees the harness gives you: a missing credential skips its suite (never fails), and secrets never enter the repo, logs, or reports.

## When to use it

- Before a release: prove every public export subpath still works over a real wire or real process, not just against fakes.
- After adding a provider or protocol adapter: add a live suite, register it in `scripts/live-matrix.json`, and the coverage gate + doc-check keep the docs honest.
- In CI: scheduled canaries probe deployed endpoints; strict mode is available for release gates.

## Coverage definition (what "100%" means)

- **Functional-surface 100%:** every public export subpath across the ten first-party packages (98 subpaths, tracked in `scripts/e2e-coverage.json`) is exercised by at least one suite — a hermetic unit test, a real-wire live test, a real-binary leg, or the full-surface packed journey (`scripts/e2e-full-surface.test.mjs`). The gate is `node scripts/e2e-coverage-gate.mjs` (baseline mode fails only on regressions).
- **Line-ratchet caveat:** the per-package line-coverage thresholds in `scripts/coverage-thresholds.json` are measured by the network-free `npm test` run only. Live suites intentionally do not contribute to line coverage; 100% functional-surface coverage does not mean 100% line coverage of every branch under live conditions.

## Running the matrix

```sh
npm run test:live                 # run active suites whose credentials are present
node scripts/live-matrix.mjs --check   # validate manifest + per-suite skip/run table (no spawns)
```

| knob | effect |
|---|---|
| `PRISM_LIVE_ENV_FILE` | credential file, loaded with Node `--env-file` semantics. Default: `scripts/live.env` when present. Copy `scripts/live.env.example` to start. |
| `PRISM_LIVE_FILTER=<sub>` | only suites whose id contains `<sub>` |
| `PRISM_LIVE_STRICT=1` | any skip fails the **run** (exit 1), not the suite — for release gates |
| `PRISM_LIVE_DRY_RUN=1` | accounting only, no spawns |
| `PRISM_LIVE_CONCURRENCY=n` | parallel suites (default 1, sequential) |
| `PRISM_LIVE_SUITE_TIMEOUT_MS` | per-suite kill timer (default 600000) |

### Skip-not-fail contract

A suite whose required credentials are absent is **skipped with a reason**, never failed. `scripts/live-matrix.json` encodes the contract per suite (`requires` all-of, `requiresAny` any-of, `optional` extras); `resolveSuiteState()` is the pure implementation the runner and the `--check` table share. Strict mode inverts the semantics deliberately: with `PRISM_LIVE_STRICT=1` a skip fails the run, because a release gate wants proof the credentials were present and the wires were exercised.

### Model selection

Every provider suite reads `PRISM_LIVE_<PROVIDER>_MODEL` to pin the model under test (multi-probe suites suffix `_CHAT_MODEL` / `_MESSAGES_MODEL` / `_GPT_MODEL`). Each manifest row records the wired env var and its cost-bounded default, so cost stays predictable. `wired: false` means the suite does not read that env var yet.

### Report

Each run writes `docs/_evidence/live-matrix-report.{json,md}`: per-suite status/duration/detail, totals, a filter/strict/dry-run annotation, and an e2e surface-coverage summary. The report contains env var **names** and model ids — never secret values.

## Credential matrix

Set only the rows you want to run; everything else skips. Least-privilege scope is mandatory per row: issue the narrowest credential that satisfies the named probe. Credentials live in `scripts/live.env` (gitignored) or `~/.config/prism/live.env` (out-of-repo), never in the repository, test fixtures, or CI logs; the journey suites assert the `assertNoSecretLeak` convention (from `@arnilo/prism/testing/*`) over every transcript they produce, and the manifest validator rejects secret-shaped values.

<!-- generated:live-matrix:start -->
| suite | status | required credentials | model override | least-privilege scope | cost |
|---|---|---|---|---|---|
| `providers/openai` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OPENAI_API_KEY` | `PRISM_LIVE_OPENAI_MODEL` (default `gpt-5.1`) | Project-scoped chat-completion key; least privilege: restrict to chat models. | 2 requests (1 text, 1 tool-call) on the configured model. |
| `providers/anthropic` | active | `PRISM_LIVE_PROVIDER_TESTS` + `ANTHROPIC_API_KEY` | `PRISM_LIVE_ANTHROPIC_MODEL` (default `claude-haiku-4-5`) | Chat-completion key. | 2 requests. |
| `providers/google` | active | `PRISM_LIVE_PROVIDER_TESTS`; any of: `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `PRISM_LIVE_GOOGLE_MODEL` (default `gemini-2.5-flash-lite`) | Gemini API key (either var). | 2 requests. |
| `providers/alibaba` | active | `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_LIVE_DASHSCOPE_KEY` | `PRISM_LIVE_DASHSCOPE_MODEL` (default `text-embedding-v4`) | DashScope key. | 2 requests (embedding/roundtrip class). |
| `providers/clinepass` | active | `PRISM_LIVE_PROVIDER_TESTS` + `CLINE_API_KEY` | `PRISM_LIVE_CLINEPASS_MODEL` (default `cline-pass/deepseek-v4-flash`) | Cline provider key. | 2 requests. |
| `providers/commandcode` | active | `PRISM_LIVE_PROVIDER_TESTS` + `COMMAND_CODE_API_KEY` | `PRISM_LIVE_COMMANDCODE_CHAT_MODEL` (default `Qwen/Qwen3.8-Flash`), `PRISM_LIVE_COMMANDCODE_MESSAGES_MODEL` (default `claude-haiku-4-5-20251001`), `PRISM_LIVE_COMMANDCODE_GPT_MODEL` (default `gpt-5.6-luna`) | Command Code key; probes three cheap routed models. | 3-4 requests on cheap models. |
| `providers/deepseek` | active | `PRISM_LIVE_PROVIDER_TESTS` + `DEEPSEEK_API_KEY` | `PRISM_LIVE_DEEPSEEK_MODEL` (default `deepseek-v4-flash`) | DeepSeek key. | 2 requests on flash-class model. |
| `providers/hyper` | active | `PRISM_LIVE_PROVIDER_TESTS` + `HYPER_API_KEY` | `PRISM_LIVE_HYPER_CHAT_MODEL` (default `deepseek-v4-pro`), `PRISM_LIVE_HYPER_MESSAGES_MODEL` (default `qwen3.6-plus`) | Hyper key; second model probes the exact-prefix cache. | ~4 requests incl. ~1 KiB prefix cache write; sub-cent. |
| `providers/kimi` | active | `PRISM_LIVE_PROVIDER_TESTS` + `KIMI_API_KEY` | `PRISM_LIVE_KIMI_MODEL` (default `kimi-for-coding`) | Kimi coding-plan credential. | 2 requests. |
| `providers/neuralwatt` | active | `PRISM_LIVE_PROVIDER_TESTS` + `NEURALWATT_API_KEY` | `PRISM_LIVE_NEURALWATT_MODEL` (default `glm-5.2`) | NeuralWatt key. | 2 requests. |
| `providers/opencode-go` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OPENCODE_API_KEY` | `PRISM_LIVE_OPENCODE_MODEL` (default `mimo-v2.5`) | OpenCode Go key. | 2 requests. |
| `providers/openrouter` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OPENROUTER_API_KEY` | `PRISM_LIVE_OPENROUTER_MODEL` (default `anthropic/claude-sonnet-4`) | OpenRouter key (any routed model id). | 2 requests. |
| `providers/xai` | active | `PRISM_LIVE_PROVIDER_TESTS` + `XAI_API_KEY`; optional: `PRISM_LIVE_XAI_OAUTH` | `PRISM_LIVE_XAI_MODEL` (default `grok-4.6`) | xAI key; OAuth leg additionally needs PRISM_LIVE_XAI_OAUTH=1. | 2-3 requests. |
| `providers/zai` | active | `PRISM_LIVE_PROVIDER_TESTS` + `ZAI_API_KEY` | `PRISM_LIVE_ZAI_MODEL` (default `glm-5.2`) | Z.ai key. | 2 requests. |
| `web-tools/brave` | active | `PRISM_LIVE_WEB` + `PRISM_BRAVE_SEARCH_TOKEN` | — | Brave Search token, least-privilege plan; 1 result per query. | 1 search request. |
| `web-tools/exa` | active | `PRISM_LIVE_WEB` + `PRISM_EXA_API_KEY` | — | Exa key; 1 result per query. | 1 search request. |
| `web-tools/firecrawl` | active | `PRISM_LIVE_WEB` + `PRISM_FIRECRAWL_API_KEY` | — | Firecrawl key; bounded 64 KiB markdown fetch. | 1 fetch request. |
| `web-tools/browser-live` | active | any of: `PRISM_LIVE_PLAYWRIGHT` / `PRISM_TEST_PLAYWRIGHT` | — | Real Chromium, no secret; needs Playwright browsers installed. | Local browser session, no API spend. |
| `web-tools/obscura-live` | active | `PRISM_LIVE_OBSCURA` + `PRISM_OBSCURA_BIN` | — | Local obscura CLI binary; suite fails closed if flag set without binary. | Local process, no API spend. |
| `memory/observational-live` | active | `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS` + `OPENAI_API_KEY` | `PRISM_LIVE_OPENAI_MODEL` (not wired yet) | Reuses the OpenAI key as the compaction worker provider. | A few small summarization requests. |
| `memory/compaction-llm-live` | active | `PRISM_LIVE_COMPACTION_TESTS` | — | Stub leg today: live summary-provider checks are wired by plans/064 Task 6 (provider key + model env TBD there). | n/a until wired. |
| `office/libreoffice-golden` | active | `PRISM_TEST_LIBREOFFICE` | — | Local LibreOffice binary renders golden documents; no secret. | Local process, no API spend. |
| `office/drawio-live` | active | any of: `PRISM_LIVE_DRAWIO_URL` / `PRISM_TEST_DRAWIO_URL` | — | Operator-hosted drawio export service URL (not a secret). | 1-2 export requests to your own service. |
| `core/postgres` | active | `PRISM_TEST_POSTGRES_URL` | — | Throwaway PostgreSQL database URL (sessions + enterprise + event-source + memory vector legs). | Local/container DB, no API spend. |
| `core/nats` | active | `PRISM_TEST_NATS_URL` | — | NATS server URL with JetStream enabled. | Local/container server, no API spend. |
| `coding-tools/docker-sandbox` | active | `PRISM_TEST_DOCKER_SANDBOX` + `PRISM_TEST_DOCKER_BIN` + `PRISM_TEST_DOCKER_IMAGE` + `PRISM_TEST_DOCKER_USER` | — | Local Docker daemon + pinned minimal sandbox image; no secret. | Local containers, no API spend. |
| `core/keychain` | active | `PRISM_TEST_KEYCHAIN` | — | Real OS keychain; writes throwaway test entries only. | Local, no API spend. |
| `acp/client-smoke` | active | `PRISM_TEST_ACP_CLIENT` | — | Real ACP SDK client over stdio in a subprocess; sandboxed, policy never disabled. | Local process, no API spend. |
| `canaries/deployed` | active | `PRISM_LIVE_CANARIES`; optional: `PRISM_CANARY_TIMEOUT_MS` `PRISM_CANARY_REPORT` | — | Deployed prism provider/MCP/A2A endpoints; script itself validates all PRISM_CANARY_* URL/token vars and credential-free HTTPS. | 1-4 bounded requests (64 KiB JSON cap) against your deployments. |
| `providers/azure` | active | `PRISM_LIVE_PROVIDER_TESTS` + `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY` + `PRISM_LIVE_AZURE_MODEL` | `PRISM_LIVE_AZURE_MODEL` (default `gpt-5.1`) | Azure OpenAI resource key. | 3-4 requests on the configured deployment. |
| `providers/bedrock` | active | `PRISM_LIVE_PROVIDER_TESTS` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION` | `PRISM_LIVE_BEDROCK_MODEL` (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`) | AWS access key + secret (SigV4). | 3-4 requests on haiku-class model. |
| `providers/vertex` | active | `PRISM_LIVE_PROVIDER_TESTS` + `GOOGLE_VERTEX_PROJECT` + `PRISM_VERTEX_ACCESS_TOKEN` | `PRISM_LIVE_VERTEX_MODEL` (default `gemini-2.5-flash`) | Pre-minted Vertex bearer token (e.g. gcloud auth print-access-token). | 3-4 requests on flash-class model. |
| `providers/ollama` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OLLAMA_BASE_URL` | `PRISM_LIVE_OLLAMA_MODEL` (default `(first model served by OLLAMA_BASE_URL)`) | No credential for local ollama serve; Ollama Cloud key optional via provider options. | 3-4 requests on the first locally pulled model. |
| `providers/ai-sdk` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OPENAI_API_KEY` | `PRISM_LIVE_AISDK_MODEL` (default `gpt-5.1`) | Reuses OPENAI_API_KEY through the real @ai-sdk/openai provider. | 3 requests on gpt-5.1. |
| `providers/model-discovery` | active | `PRISM_LIVE_PROVIDER_TESTS`; any of: `OPENAI_API_KEY` / `GEMINI_API_KEY` | — | Reuses OPENAI_API_KEY or GEMINI_API_KEY for a real listing request. | 2 GET /models requests (second cached in TTL). |
| `cli/live-journey` | planned | `PRISM_LIVE_PROVIDER_TESTS` + `OPENAI_API_KEY` | — | Packed CLI: init/provider-add/print/json/rpc over a real provider; transcript secret-scanned. | 1 pack + install, offline scaffold tests, <=3 wire prompts on the selected provider model (wire legs skip on 401/403). |
| `memory/rag-rerankers-live` | active | any of: `PRISM_TEST_TEI_RERANKER_URL` / `PRISM_TEST_HOSTED_RERANK_URL`; optional: `PRISM_TEST_HOSTED_RERANK_URL` | `PRISM_LIVE_TEI_RERANKER_MODEL` (default `(endpoint default model)`), `PRISM_LIVE_HOSTED_RERANK_MODEL` (default `(endpoint default model)`) | Real TEI / OpenAI-compatible rerank endpoints; each leg self-skips when its endpoint env is unset. | 1 rerank request per configured endpoint (≤2 total). |
| `coding-tools/openapi-live` | active | `PRISM_LIVE_OPENAPI_TOOLS` | — | Real public OpenAPI 3.1 spec (warnely.com) + real GET tool calls; no credential. | 3 HTTP requests against example.com-class public hosts (plan budget ≤5). |
| `coding-tools/computer-use-live` | active | `PRISM_TEST_COMPUTER_USE` + `PRISM_COMPUTER_USE_BIN` | — | Real host computer-use-linux MCP binary over stdio; real tool inventory + one bounded read-only screenshot. | Local desktop only; ≤30s ceiling. |
| `mcp/client-smoke` | active | `PRISM_TEST_MCP_CLIENT` | — | Real @modelcontextprotocol/client SDK over a real stdio subprocess serving createPrismMcpServer. | Local only; ≤30s. |
| `core/opa-live` | active | `PRISM_TEST_OPA_URL` | — | Operator-hosted OPA REST endpoint (optionally token-gated). | <=3 decision requests to the operator OPA endpoint; fail-closed probe never reaches the wire. |
| `core/oidc-live` | active | `PRISM_TEST_OIDC_ISSUER` + `PRISM_TEST_OIDC_AUDIENCE` + `PRISM_TEST_OIDC_TOKEN` | — | Real IdP issuer/JWKS + short-lived test bearer token. | 1 JWKS fetch (cached) + 3 local verify calls; no token endpoint traffic. |
| `core/webhooks-live` | active | `PRISM_TEST_WEBHOOK_URL` | — | Operator-controlled signed webhook receiver. | <=3 webhook deliveries (1 signed target + 1 loopback retry receiver). |
| `core/artifact-bodies-s3-live` | active | `PRISM_TEST_S3_ENDPOINT` + `PRISM_TEST_S3_KEY` + `PRISM_TEST_S3_SECRET` + `PRISM_TEST_S3_BUCKET` | — | Dedicated throwaway S3-compatible bucket. | <=5 S3 requests (put/get/presign/delete x2). |
| `cli/journey` | active | `PRISM_LIVE_PROVIDER_TESTS`; any of: `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `KIMI_API_KEY` / `ZAI_API_KEY` / `OPENCODE_API_KEY` / `NEURALWATT_API_KEY` / `DASHSCOPE_API_KEY` / `OLLAMA_API_KEY` | — | First init-catalog provider credential present in the environment. | 4-5 one-shot requests on the default catalog model. |
| `memory/postgres` | active | `PRISM_TEST_POSTGRES_URL` | — | Postgres memory store + pgvector index round-trips on the operator database. | Bounded insert/query cycles against the configured Postgres. |
| `memory/graft` | active | — (hermetic leg) | — | Graft upstream CLI child-process protocol (real binary spawns against the in-repo fixture graft bin). | Hermetic; no network. |
| `memory/wiki` | active | — (hermetic leg) | — | Wiki lifecycle over real fs trees (init/refresh/lint/search fallback; qmd child-process client degrades without the binary). | Hermetic; no network. |
| `coding-tools/lsp-forge` | active | — (hermetic leg) | — | LSP/language-intelligence + forge suites: real child-process spawns over the real LSP/forge wire protocols against fixture binaries. | Hermetic; no network. |
| `ag-ui/conformance` | active | — (hermetic leg) | — | AG-UI + ACP conformance suites: real-event replay over the acp/a2a/ag-ui protocol surfaces (fixture agents, real event-source wire semantics). | Hermetic; no network. |
| `prism-providers/conformance` | active | — (hermetic leg) | — | Plan-065 machine-checked thinking coverage: every first-party reasoning catalog model declares capabilities.thinkingLevels + a compat.thinkingFamily stamp and emits a legal effort field on the wire (14 catalogs walked hermetically). | free |
<!-- generated:live-matrix:end -->

## Strict CI workflow

The scheduled [`live-canaries` workflow](../.github/workflows/live-canaries.yml) (Tuesdays 05:43 UTC, plus `workflow_dispatch`) runs four restricted protocol canaries — provider, MCP, A2A, and Brave search — from a GitHub `live-canaries` environment, with every value supplied through repository secrets and a 15 s per-canary timeout. It runs `scripts/live-canary.mjs` (gated on `PRISM_LIVE_CANARIES=1`, which requires **all** canary credentials together so A2A never runs standalone) and uploads the status report as a workflow artifact. The full live matrix runs on a weekly schedule (and on demand) via the [`live-matrix` workflow](../.github/workflows/live-matrix.yml): strict-mode filtered run (default `providers/opencode-go`, the credentialed suites) with the report + e2e-coverage evidence uploaded as artifacts; operators also run it from a credentialed checkout with `npm run test:live`, optionally `PRISM_LIVE_STRICT=1` when gating a release.

## Security and performance notes

- Credentials never enter the repo, test fixtures, logs, or reports; only env var names and model ids are persisted. `assertNoSecretLeak` (exported from `@arnilo/prism/testing/*`) runs over live transcripts, and secret-shaped values in `scripts/live-matrix.json` are rejected by the manifest validator.
- Suite costs are bounded and recorded per row; provider model defaults are the cheapest cost-bounded models that satisfy each probe.
- Per-suite `PRISM_LIVE_SUITE_TIMEOUT_MS` kill timers and opt-in `PRISM_LIVE_CONCURRENCY` parallelism keep a stuck wire from stalling the run.
- Packaging tests run under `scripts/with-build-lock.mjs` so parallel suites never race the TypeScript build.

## Extension and configuration notes

- Add a suite: write the env-gated test (skip-not-fail), register it in `scripts/live-matrix.json` (`id`, `package`, `status`, `source`, `command`, `cwd`, `requires`/`requiresAny`, model wiring, least-privilege `scope`, `cost`), then run `node scripts/generate-live-docs.mjs --write` to refresh the table above. `scripts/live-doc-check.test.mjs` fails `npm test` when the doc drifts.
- Add a credential: extend `scripts/live.env.example` and the relevant manifest `requires` list. Prefer `requiresAny` when a probe accepts several interchangeable providers.

## Related APIs

- `@arnilo/prism/testing/*` conformance helpers (`assertProviderStreamConforms`, `assertNoSecretLeak`): the assertion vocabulary live suites reuse.
- `scripts/e2e-coverage-gate.mjs` + `scripts/e2e-coverage.json`: the functional-surface coverage ledger this matrix satisfies.
- [Provider conformance](provider-conformance.md): the network-free contract checks every provider adapter must pass before a live suite is worth running.
