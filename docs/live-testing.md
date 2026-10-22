# Live and end-to-end testing

## What it does

Prism's default network-free tiers are `bun run test`, per-package `bun test`, and
packed-consumer journeys. The opt-in live matrix exercises public surfaces with
real credentials. This page lists commands, credentials and guarantees: missing
credentials skip suites; secrets stay out of the repo, logs and reports.

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
| `providers/hyper` | active | `PRISM_LIVE_PROVIDER_TESTS` + `HYPER_API_KEY` | `PRISM_LIVE_HYPER_CHAT_MODEL` (default `deepseek-v4-pro`), `PRISM_LIVE_HYPER_MESSAGES_MODEL` (default `qwen3.6-plus`) | Hyper key; dual-route tier-1 live scenarios (chat & messages). | ~10 requests across both routes incl. prefix cache probe; sub-cent. |
| `providers/opencode-go` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OPENCODE_GO_API_KEY` | `PRISM_LIVE_OPENCODE_GO_CHAT_MODEL` (default `mimo-v2.5`), `PRISM_LIVE_OPENCODE_GO_MESSAGES_MODEL` (default `qwen3.6-plus`) | OpenCode Go key; dual-route tier-1 live scenarios (chat & messages). | ~10 requests across both routes incl. prefix cache probe; sub-cent. |
| `providers/typesafe` | active | `PRISM_LIVE_PROVIDER_TESTS` + `TYPESAFE_API_KEY` | `PRISM_LIVE_TYPESAFE_MODEL` (default `jev-latest`) | TypeSafe key; System One tier-1 live scenarios (decision model). | ~3 requests; sub-cent. |
| `providers/laya` | active | `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_LIVE_LAYA` | `PRISM_LIVE_LAYA_MODEL` (default `laya`) | Local laya-serve instance on loopback (default http://127.0.0.1:8000); System One tier-1 live scenarios. | ~3 requests; local server, free. |
| `web-tools/brave` | active | `PRISM_LIVE_WEB` + `PRISM_BRAVE_SEARCH_TOKEN` | — | Brave Search token, least-privilege plan; 1 result per query. | 1 search request. |
| `web-tools/exa` | active | `PRISM_LIVE_WEB` + `PRISM_EXA_API_KEY` | — | Exa key; 1 result per query. | 1 search request. |
| `web-tools/firecrawl` | active | `PRISM_LIVE_WEB` + `PRISM_FIRECRAWL_API_KEY` | — | Firecrawl key; bounded 64 KiB markdown fetch. | 1 fetch request. |
| `tools-browser/browser-live` | active | any of: `PRISM_LIVE_PLAYWRIGHT` / `PRISM_TEST_PLAYWRIGHT` | — | Real Chromium, no secret; needs Playwright browsers installed. | Local browser session, no API spend. |
| `web-tools/obscura-live` | active | `PRISM_LIVE_OBSCURA` + `PRISM_OBSCURA_BIN` | — | Local obscura CLI binary; suite fails closed if flag set without binary. | Local process, no API spend. |
| `memory/observational-live` | planned | `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS` + `OPENAI_API_KEY` | `PRISM_LIVE_OPENAI_MODEL` (not wired yet) | Reuses the OpenAI key as the compaction worker provider. | A few small summarization requests. |
| `memory/compaction-llm-live` | active | `PRISM_LIVE_COMPACTION_TESTS` | — | Stub leg today: live summary-provider checks are wired by plans/064 Task 6 (provider key + model env TBD there). The compactor now calls through `prism.models.client`, so the leg would reuse the agent's provider. | n/a until wired. |
| `work/libreoffice-golden` | active | `PRISM_TEST_LIBREOFFICE` | — | Local LibreOffice binary renders golden documents; no secret. | Local process, no API spend. |
| `work/drawio-live` | active | any of: `PRISM_LIVE_DRAWIO_URL` / `PRISM_TEST_DRAWIO_URL` | — | Operator-hosted drawio export service URL (not a secret). | 1-2 export requests to your own service. |
| `coding-tools/docker-sandbox` | active | `PRISM_TEST_DOCKER_SANDBOX` + `PRISM_TEST_DOCKER_BIN` + `PRISM_TEST_DOCKER_IMAGE` + `PRISM_TEST_DOCKER_USER` | — | Local Docker daemon + pinned minimal sandbox image; no secret. | Local containers, no API spend. |
| `coding-tools/e2b-sandbox-live` | active | `PRISM_TEST_E2B_API_KEY` | — | E2B API key; least privilege: one throwaway sandbox, no production templates. | 1 create + 2 exec + filesystem-only pause + connect/resume + kill. |
| `work/mistral-ocr-live` | active | `PRISM_TEST_MISTRAL_API_KEY` | — | Mistral OCR API key; least privilege: one throwaway 2-page sample PDF, no Files API upload. | 1 OCR request against mistral-ocr-latest. |
| `core/postgres` | active | `PRISM_TEST_POSTGRES_URL` | — | Postgres state-store persistence over the real wire (migrations, tenant-scoped queries, checkpoint/lease services). | Bounded insert/query cycles against the configured Postgres. |
| `core/keychain` | active | `PRISM_TEST_KEYCHAIN` | — | Real OS keychain; writes throwaway test entries only. | Local, no API spend. |
| `canaries/deployed` | active | `PRISM_LIVE_CANARIES`; optional: `PRISM_CANARY_TIMEOUT_MS` `PRISM_CANARY_REPORT` | — | Deployed prism provider/MCP/A2A endpoints; script itself validates all PRISM_CANARY_* URL/token vars and credential-free HTTPS. | 1-4 bounded requests (64 KiB JSON cap) against your deployments. |
| `calibration/vendor-count-tokens` | active | `PRISM_LIVE_PROVIDER_TESTS`; any of: `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `PRISM_LIVE_ANTHROPIC_MODEL` (default `claude-haiku-4-5`), `PRISM_LIVE_GOOGLE_MODEL` (default `gemini-2.5-flash-lite`) | Count-only token requests (no generation) on non-sensitive fixture text, using the chat key each vendor already needs. | 3 token-count requests per credentialed vendor (prose, CJK, chat transcript); no generation, no streaming. |
| `cli/live-journey` | planned | `PRISM_LIVE_PROVIDER_TESTS` + `OPENAI_API_KEY` | — | Packed CLI: init/provider-add/print/json/rpc over a real provider; transcript secret-scanned. | 1 pack + install, offline scaffold tests, <=3 wire prompts on the selected provider model (wire legs skip on 401/403). |
| `memory/rag-rerankers-live` | active | any of: `PRISM_TEST_TEI_RERANKER_URL` / `PRISM_TEST_HOSTED_RERANK_URL`; optional: `PRISM_TEST_HOSTED_RERANK_URL` | `PRISM_LIVE_TEI_RERANKER_MODEL` (default `(endpoint default model)`), `PRISM_LIVE_HOSTED_RERANK_MODEL` (default `(endpoint default model)`) | Real TEI / OpenAI-compatible rerank endpoints; each leg self-skips when its endpoint env is unset. | 1 rerank request per configured endpoint (≤2 total). |
| `memory/local-rerank-live` | active | `PRISM_TEST_LOCAL_RERANK`; optional: `PRISM_TEST_LOCAL_RERANK_CACHE_DIR` | `PRISM_LIVE_LOCAL_RERANK_MODEL` (default `Xenova/bge-reranker-base`) | In-process cross-encoder (transformers.js, q8/cpu) plus a semantic embedder on this machine; no service and no credential. Weights come from the documented model ids into a host cache dir; a cold run downloads a ≈280 MB reranker and a ≈23 MB embedder. | Two model downloads on a cold cache (≈280 MB reranker + ≈23 MB embedder); zero network after load, no API spend. ≈50 s wall clock after the cache is warm (the recall legs score 24 × 96 query/document pairs three times). |
| `memory/drive-sync-live` | active | `PRISM_TEST_DRIVE_ACCESS_TOKEN`; optional: `PRISM_TEST_DRIVE_FOLDER_ID` `PRISM_TEST_DRIVE_SHARED_DRIVE_ID` | — | Delegated Drive readonly token; least privilege: one throwaway folder. Folder/shared-drive ids optional. | <=2 Drive list/changes pages plus file media for that page; replay must not re-embed. |
| `tools-openapi/openapi-live` | active | `PRISM_LIVE_OPENAPI_TOOLS` | — | Real public OpenAPI 3.1 spec (warnely.com) + real GET tool calls; no credential. | 3 HTTP requests against example.com-class public hosts (plan budget ≤5). |
| `tools-computer-use/computer-use-live` | active | `PRISM_TEST_COMPUTER_USE` + `PRISM_COMPUTER_USE_BIN` | — | Real host computer-use-linux MCP binary over stdio; real tool inventory + one bounded read-only screenshot. | Local desktop only; ≤30s ceiling. |
| `mcp/client-smoke` | active | `PRISM_TEST_MCP_CLIENT` | — | Real @modelcontextprotocol/client SDK over a real stdio subprocess serving a plain SDK McpServer. | Local only; ≤30s. |
| `acp/in-process` | active | — (hermetic leg) | — | In-process serveAcp over TransformStreams. Approval resumes through session/request_permission. | Local only; ≤30s. |
| `cli/journey` | active | `PRISM_LIVE_PROVIDER_TESTS`; any of: `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `KIMI_API_KEY` / `ZAI_API_KEY` / `OPENCODE_API_KEY` / `NEURALWATT_API_KEY` / `DASHSCOPE_API_KEY` / `OLLAMA_API_KEY` | — | First init-catalog provider credential present in the environment. | 4-5 one-shot requests on the default catalog model. |
| `memory/postgres` | active | `PRISM_TEST_POSTGRES_URL` | — | Postgres memory store + pgvector index round-trips on the operator database, including durable deletion propagation (1,000 derived rows tombstoned in one transaction) and grant-change re-pointing. | Bounded insert/query cycles against the configured Postgres. |
| `memory/wiki` | active | — (hermetic leg) | — | Wiki lifecycle over real fs trees (init/refresh/lint/search fallback; qmd child-process client degrades without the binary). | Hermetic; no network. |
| `coding-tools/lsp-forge` | active | — (hermetic leg) | — | LSP/language-intelligence + forge suites: real child-process spawns over the real LSP/forge wire protocols against fixture binaries. | Hermetic; no network. |
| `ag-ui/conformance` | active | — (hermetic leg) | — | AG-UI + ACP conformance suites: real-event replay over the acp/a2a/ag-ui protocol surfaces (fixture agents, real event-source wire semantics). | Hermetic; no network. |
| `provider-kit/conformance` | active | — (hermetic leg) | — | Thinking coverage: first-party reasoning catalog models declare capabilities.thinkingLevels + a compat.thinkingFamily stamp and emit a legal effort field on the wire. | free |
| `channels/telegram-live` | active | `PRISM_LIVE_TELEGRAM` + `TELEGRAM_BOT_TOKEN`; optional: `PRISM_LIVE_TELEGRAM_CHAT_ID` | — | Operator-owned Telegram bot token. getMe + 1s poll; send only if PRISM_LIVE_TELEGRAM_CHAT_ID names a chat you operate. Never creates contacts. | 1 getMe + 1 getWebhookInfo (+ optional 1 sendMessage). |
| `channels/signal-live` | active | `PRISM_LIVE_SIGNAL` + `PRISM_LIVE_SIGNAL_SOCKET` + `PRISM_LIVE_SIGNAL_ACCOUNT` + `PRISM_LIVE_SIGNAL_TERMS_VERSION`; optional: `PRISM_LIVE_SIGNAL_RECIPIENT_UUID` | — | Existing private signal-cli v0.14.8 Unix socket and account you already operate. Never registers or links. Send only to PRISM_LIVE_SIGNAL_RECIPIENT_UUID. | 1 subscribeReceive + health (+ optional 1 send). |
| `release/memory-bench` | active | `PRISM_LIVE_MEMORY_BENCH_MANUAL` + `OPENCODE_GO_API_KEY` | `PRISM_LIVE_MEMORY_BENCH_MODEL` (default `mimo-v2.5`) | Manual-only pinned memory benchmark; full context, OM, fabric, fabric-agentic and OM+fabric over LongMemEval-S, LoCoMo (comparison only), MemoryAgentBench-CR and the lifecycle suite. | One durable campaign journal with a finite ceiling; 12M per LongMemEval arm, 2M per lifecycle arm, 5M elsewhere, plus one-question overshoot; includes workers, judges, retries and warm-cache replays. Every attempt keeps its reservation until a matched report reconciles it; --manifest is dry-run. Never scheduled. |
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

## Recording wire fixtures

Offline tests replay real provider streams without network or credentials using recorded wire fixtures. The recording tool is `scripts/wire-proxy.mjs`, a Bun HTTP proxy:

```sh
bun scripts/wire-proxy.mjs --upstream https://hyper.charm.land/v1 --listen 127.0.0.1:8787 \
  --record packages/providers/hyper/src/__tests__/wire/anthropic \
  --secret-env HYPER_API_KEY \
  --usage-log /tmp/hyper-usage.jsonl
```

### Safety and isolation

- **Loopback only:** The proxy listens on loopback interfaces (`127.0.0.1`, `localhost`, `[::1]`) only and refuses any non-loopback address (exits 1).
- **Mandatory secret scanning:** `--secret-env` is mandatory whenever `--record` is active (missing `--secret-env` exits 2). Before any recording file is written to disk, the exchange (request body, response body, path) is scanned for secret values from the named environment variables. A hit immediately aborts the write and exits 3. Response and request IDs are preserved.
- **Zero header logging:** Only the `content-type` response header, method, path, request body, status, and raw response body are saved. Authorization and provider headers are never logged or persisted.
- **Zero response buffering:** Responses are piped directly back to the client while recording tees the stream in the background.
- **Dual usage logging:** `--usage-log <file>` records an independent JSONL log with parsed raw upstream usage and inclusive token metrics across both OpenAI and Anthropic wire formats.

### Fixture layout

Recorded fixtures live under the owning provider package:
```
packages/providers/<vendor>/src/__tests__/wire/<route>/<scenario>.json
```
Each fixture directory includes a `README.md` documenting the recording date, target model, upstream endpoint, and exact command used.

## Related APIs

- `@arnilo/prism/testing/*` conformance helpers (`assertProviderStreamConforms`, `assertNoSecretLeak`): the assertion vocabulary live suites reuse.
- `scripts/e2e-coverage-gate.mjs` + `scripts/e2e-coverage.json`: the functional-surface coverage ledger this matrix satisfies.
- [Provider conformance](provider-kit.md): the network-free contract checks every provider adapter must pass before a live suite is worth running.

## Manual memory benchmark

Requirements, dispatch/local commands, licences and comparison limits:
[README](../scripts/memory-bench/README.md). LoCoMo is CC BY-NC 4.0;
evidence uploads contain only ids and metrics.
