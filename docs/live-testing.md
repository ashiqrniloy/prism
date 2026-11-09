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
bun run test:live                      # run active suites whose credentials are present
bun scripts/live-matrix.mjs --check    # validate manifest + per-suite skip/run table (no spawns)
```

| knob | effect |
|---|---|
| `PRISM_LIVE_ENV_FILE` | credential file, loaded with Node `--env-file` semantics. Default: `~/.config/prism/live.env` when present. Copy `scripts/live.env.example` outside the repo (mode `0600`) to start; no runner reads a credential file inside the checkout. |
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

Set only the rows you want to run; everything else skips. Least-privilege scope is mandatory per row: issue the narrowest credential that satisfies the named probe. Credentials live in `~/.config/prism/live.env` (out-of-repo, mode `0600`), never in the repository, test fixtures, or CI logs; the journey suites assert the `assertNoSecretLeak` convention (from `@arnilo/prism/testing/*`) over every transcript they produce, and the manifest validator rejects secret-shaped values.

<!-- generated:live-matrix:start -->
| suite | status | required credentials | model override | least-privilege scope | cost |
|---|---|---|---|---|---|
| `providers/ollama-cloud` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OLLAMA_API_KEY` | `PRISM_LIVE_OLLAMA_CLOUD_MODEL` (default `gemma4:31b`), `PRISM_LIVE_OLLAMA_CLOUD_THINKING_MODEL` (default `gpt-oss:20b`), `PRISM_LIVE_OLLAMA_CLOUD_DECISION_MODEL` (default `clef:27b`) | Ollama Cloud key; native NDJSON and OpenAI-compatible routes. Shared scenarios per route: text, 2-turn tool loop, abort, 3-turn prefix-cache probe, structured output with a concrete prompt, and an unknown model id returning a named error (both via the shared suite's `structuredPrompt`/`errorModel` route hooks). The package adds a 3-turn kernel smoke: tool echo, the tool result read back, then an image turn. A decision model (`clef`) runs the shared System One scenarios over `/v1/systemone`: schema-valid decision, raw `decide` answers, tools rejected before fetch, abort, and a leak-free error response. | ~19 generation requests (6 per route in the shared scenarios, 2 structured-output and 2 unknown-model per route, plus the 3-turn kernel smoke), plus ~3 System One decision requests (input-only billing), plus free discovery metadata only if a model id is not in the static catalog. Separate manual cache probe with --ttft: 4 requests per route, 8 for native + openai, plus catalog discovery per invocation (1 + N free metadata requests, concurrency 4); the pi comparison adds 4 requests. Free-tier session/weekly limits apply. |
| `providers/hyper` | active | `PRISM_LIVE_PROVIDER_TESTS` + `HYPER_API_KEY` | `PRISM_LIVE_HYPER_CHAT_MODEL` (default `deepseek-v4-pro`), `PRISM_LIVE_HYPER_MESSAGES_MODEL` (default `qwen3.6-plus`) | Hyper key; dual-route tier-1 live scenarios (chat & messages). | ~10 requests across both routes incl. prefix cache probe; sub-cent. |
| `providers/opencode-go` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OPENCODE_GO_API_KEY` | `PRISM_LIVE_OPENCODE_GO_CHAT_MODEL` (default `mimo-v2.5`), `PRISM_LIVE_OPENCODE_GO_MESSAGES_MODEL` (default `qwen3.6-plus`) | OpenCode Go key; dual-route tier-1 live scenarios (chat & messages). | ~10 requests across both routes incl. prefix cache probe; sub-cent. |
| `providers/typesafe` | active | `PRISM_LIVE_PROVIDER_TESTS` + `TYPESAFE_API_KEY` | `PRISM_LIVE_TYPESAFE_MODEL` (default `jev-latest`) | TypeSafe key; System One tier-1 live scenarios (decision model), including one raw decide call with noul/choice/score answers. | ~4 requests; sub-cent. |
| `providers/laya` | active | `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_LIVE_LAYA` | `PRISM_LIVE_LAYA_MODEL` (default `laya`) | Local laya-serve instance on loopback (default http://127.0.0.1:8000); System One tier-1 live scenarios, including one raw decide call with noul/choice/score answers. | ~4 requests; local server, free. |
| `providers/openrouter` | active | `PRISM_LIVE_PROVIDER_TESTS` + `OPENROUTER_API_KEY`; optional: `PRISM_LIVE_OPENROUTER_PAID` | `PRISM_LIVE_OPENROUTER_MODEL` (default `recursive/flint-v1.0:free`), `PRISM_LIVE_OPENROUTER_CACHE_MODEL` (default `anthropic/claude-haiku-4.5`) | Pinned free model: text, tools, structured output, abort, leak scan. Paid Anthropic cache only with separate opt-in and spend approval. | ~6 free requests (5 scenarios + catalog discovery) plus up to 4 paid when opted in (currently 2); paid cache under $0.05/run, defaults off. |
| `providers/liquid` | active | `PRISM_LIVE_PROVIDER_TESTS` + `LIQUID_API_KEY` | `PRISM_LIVE_LIQUID_MODELS` (default `d1.1,d1-ultra`) | Liquid key; hosted System One tier-1 live scenarios for d1.1 and d1-ultra, plus one image decide call on d1.1. | ~10 requests (5 per model) + 1 image request; d1.1 $0.02/MTok input, d1-ultra $0.042/MTok, output free; sub-cent. |
| `providers/liquid-local` | active | `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_LIVE_LLAMA_SERVER_URL` | `PRISM_LIVE_LIQUID_LOCAL_MODEL` (default `d1-3B`) | Local llama-server (build b11480 or later) on loopback serving LiquidAI/d1-3B-GGUF:Q8_0; System One tier-1 live scenarios plus one image decide call. | ~5 requests; local server, free. |
| `providers/commandcode` | active | `PRISM_LIVE_PROVIDER_TESTS` + `COMMAND_CODE_API_KEY` | `PRISM_LIVE_COMMANDCODE_CHAT_MODEL` (default `minimax/minimax-m3.1-flash`), `PRISM_LIVE_COMMANDCODE_RESPONSES_MODEL` (default `gpt-5.6-luna`), `PRISM_LIVE_COMMANDCODE_MESSAGES_MODEL` (default `claude-haiku-5-5`), `PRISM_LIVE_COMMANDCODE_NON_ZDR_MODEL` (default `stealth/glyph-cluster:free`) | Three Provider API wires: Chat Completions, Responses, Anthropic Messages, one exemplar each. Per route: text, tool loop, structured output, abort, leak scan. No cache probe: the gateway caches upstream and Chat has no lever. | ~22-27 requests across three wires: the shared text/tool-loop/thinking-replay/structured/abort/error scenarios, one kernel smoke per wire (2 turns + image), and the ZDR pair; under $0.10/run. The 4-request warm-prefix probe lives in plan 184. |
| `providers/openai-codex` | active | `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_TEST_KEYCHAIN`; optional: `PRISM_LIVE_OPENAI_CODEX_CREDENTIAL` | `PRISM_LIVE_OPENAI_CODEX_MODEL` (default `gpt-6.1-sol`) | Sign in with ChatGPT grant from the OS keyring on the stateless Responses route; tier-1 live scenarios incl. prefix cache probe, plus the plan-203 cache probe through the same credential ref. | ~10 requests against ChatGPT plan usage; the cache probe is a separate 4-request run (plus one catalog call) with `bun scripts/cache-parity/provider-probe.mjs --provider openai-codex --model gpt-6.1-sol --credential keyring:openai-codex --turns 4`. |
| `web-tools/brave` | active | `PRISM_LIVE_WEB` + `PRISM_BRAVE_SEARCH_TOKEN` | — | Brave Search token, least-privilege plan; 1 result per query. | 1 search request. |
| `web-tools/exa` | active | `PRISM_LIVE_WEB` + `PRISM_EXA_API_KEY` | — | Exa key; 1 result per query. | 1 search request. |
| `web-tools/firecrawl` | active | `PRISM_LIVE_WEB` + `PRISM_FIRECRAWL_API_KEY` | — | Firecrawl key; bounded 64 KiB markdown fetch. | 1 fetch request. |
| `tools-browser/browser-live` | active | any of: `PRISM_LIVE_PLAYWRIGHT` / `PRISM_TEST_PLAYWRIGHT` | — | Real Chromium, no secret; needs Playwright browsers installed. | Local browser session, no API spend. |
| `web-tools/obscura-live` | active | `PRISM_LIVE_OBSCURA` + `PRISM_OBSCURA_BIN` | — | Local obscura CLI binary; suite fails closed if flag set without binary. | Local process, no API spend. |
| `memory/system-live` | active | `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS` + `OPENCODE_GO_API_KEY` | `PRISM_LIVE_OPENCODE_GO_CHAT_MODEL` (default `mimo-v2.5`) | Live observer and reflector worker calls over the shipped OpenCode Go provider; no fabric or benchmark harness. | A few small summarization requests. |
| `memory/fabric-conversational-live` | planned | any of: `HYPER_API_KEY` / `OPENCODE_GO_API_KEY` | — | Conversational preset across sessions: session A states a fact, session B recalls it through injection or memory.recall, principal C sees none of it (plan 186 Task 3 scenario 11). | ≤ 6 requests, ≤ 20k input tokens. |
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
| `memory/wiki` | active | — (hermetic leg) | — | The wiki, knowledge outside memory, over the real fabric read through memory.ltm and on its own sources without it: wiki:status counts, the scripted concept pass (cited edits, fail-closed answers, repair), the deletion cascade from memory, claim lint and source staging over real fs trees. | Hermetic; no network. |
| `coding-tools/lsp-forge` | active | — (hermetic leg) | — | LSP/language-intelligence + forge suites: real child-process spawns over the real LSP/forge wire protocols against fixture binaries. | Hermetic; no network. |
| `ag-ui/conformance` | active | — (hermetic leg) | — | AG-UI + ACP conformance suites: real-event replay over the acp/a2a/ag-ui protocol surfaces (fixture agents, real event-source wire semantics). | Hermetic; no network. |
| `provider-kit/conformance` | active | — (hermetic leg) | — | Thinking coverage: first-party reasoning catalog models declare capabilities.thinkingLevels + a compat.thinkingFamily stamp and emit a legal effort field on the wire. | free |
| `channels/telegram-live` | active | `PRISM_LIVE_TELEGRAM` + `TELEGRAM_BOT_TOKEN`; optional: `PRISM_LIVE_TELEGRAM_CHAT_ID` | — | Operator-owned Telegram bot token. getMe + 1s poll; send only if PRISM_LIVE_TELEGRAM_CHAT_ID names a chat you operate. Never creates contacts. | 1 getMe + 1 getWebhookInfo (+ optional 1 sendMessage). |
| `channels/signal-live` | active | `PRISM_LIVE_SIGNAL` + `PRISM_LIVE_SIGNAL_SOCKET` + `PRISM_LIVE_SIGNAL_ACCOUNT` + `PRISM_LIVE_SIGNAL_TERMS_VERSION`; optional: `PRISM_LIVE_SIGNAL_RECIPIENT_UUID` | — | Existing private signal-cli v0.14.8 Unix socket and account you already operate. Never registers or links. Send only to PRISM_LIVE_SIGNAL_RECIPIENT_UUID. | 1 subscribeReceive + health (+ optional 1 send). |
| `release/context-rot` | active | `HYPER_API_KEY` + `OPENCODE_GO_API_KEY` | `PRISM_LIVE_CONTEXT_ROT_HYPER_MODEL` (default `deepseek-v4-pro-0813`), `PRISM_LIVE_CONTEXT_ROT_OPENCODE_MODEL` (default `mimo-v2.5`) | Manual-only context-rot curve: 30 deterministic agent-shaped tasks after pinned stale tool history at 0/16k/32k/64k/96k tokens, with and without context-engineering fold batch mode, for one model each on Hyper and OpenCode Go. | About 45M input tokens per model at defaults (900 requests, mostly cache reads); --max-input-tokens defaults to 50M per model and leaves a partial report. Requires HYPER_API_KEY and OPENCODE_GO_API_KEY in the live-canaries environment. |
| `release/skill-evals` | active | `HYPER_API_KEY` + `OPENCODE_GO_API_KEY`; optional: `OPENROUTER_API_KEY` `KILO_API_KEY` `COMMAND_CODE_API_KEY` | `PRISM_LIVE_SKILL_EVAL_HYPER_MODEL` (default `deepseek-v4-pro-0813`), `PRISM_LIVE_SKILL_EVAL_OPENCODE_MODEL` (default `mimo-v2.5`), `PRISM_LIVE_SKILL_EVAL_OPENROUTER_MODEL` (default `nvidia/nemotron-3-ultra-550b-a55b:free`), `PRISM_LIVE_SKILL_EVAL_KILO_MODEL` (default `nvidia/nemotron-3.5-super-vl:free`), `PRISM_LIVE_SKILL_EVAL_COMMANDCODE_MODEL` (default `Qwen/Qwen3.7-Flash`) | Manual-only paired skill evaluations (plan 215 Task 11): web-research, browser-automation and delegating-work (coding-workflow was removed after the v3 evaluation), each with the skill versus the same agent with it disabled, 15 items x 3 trials x 2 arms, on Hyper, OpenCode Go and the free models of OpenRouter, Kilo and Command Code (owner decision 2026-11-05). Web items run against a loopback fixture, never the live web; the browser runs a local Chromium; coding runs in scratch workspaces. | Free models cost nothing; Hyper and OpenCode Go are estimated from a five-item dry run (bun scripts/skill-evals/run.mjs --dry-run --providers ...) and approved by the owner. The criteria are locked (criteria.lock.json) and committed first; a live run refuses to start otherwise. Router aliases openrouter/free and openrouter/auto are refused. |
| `release/memory-bench` | active | `PRISM_LIVE_MEMORY_BENCH_MANUAL` + `OPENCODE_GO_API_KEY` | `PRISM_LIVE_MEMORY_BENCH_MODEL` (default `mimo-v2.5`) | Manual-only pinned memory benchmark; full context, OM, fabric, fabric-agentic and OM+fabric over LongMemEval-S, LoCoMo (comparison only), MemoryAgentBench-CR and the lifecycle suite. | One durable campaign journal with a finite ceiling; 12M per LongMemEval arm, 2M per lifecycle arm, 5M elsewhere, plus one-question overshoot; includes workers, judges, retries and warm-cache replays. Every attempt keeps its reservation until a matched report reconciles it; --manifest is dry-run. Never scheduled. |
| `release/eval-gate` | active | `PRISM_LIVE_EVAL_GATE_MANUAL` + `HYPER_API_KEY` | `PRISM_LIVE_EVAL_GATE_MODEL` (default `deepseek-v4-pro-0813`) | Manual-only reference-host evaluation gate on Hyper over the heldout split (coding approval, denied write, research citations, and web_fetch prompt injection) with trials: 4 and regression comparison against the last stored live report. | 4 heldout items x 4 trials (~32 provider turns); hard ceiling of 2M input tokens enforced by the test. Never scheduled. |
| `release/cache-parity` | active | `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_LIVE_CACHE_PARITY` + `COMMAND_CODE_API_KEY` + `OLLAMA_API_KEY`; optional: `PRISM_LIVE_OPENROUTER_PAID` `OPENROUTER_API_KEY` | `PRISM_LIVE_PARITY_COMMANDCODE_CHAT_MODEL` (default `minimax/minimax-m3.1-flash`), `PRISM_LIVE_PARITY_COMMANDCODE_RESPONSES_MODEL` (default `gpt-5.6-luna`), `PRISM_LIVE_PARITY_COMMANDCODE_MESSAGES_MODEL` (default `claude-haiku-5-5`), `PRISM_LIVE_PARITY_OLLAMA_MODEL` (default `gemma4:31b`) | Manual-only cache parity against pi (headless) on a real coding task: Command Code chat, Responses and Messages, and Ollama Cloud. Passes when Prism's median hitRate is at least pi's on every conclusive cell with no usage_mismatch; an inconclusive cell is rerun once and fails strict mode. Needs `pi` on PATH with pi-commandcode-provider and pi-ollama-cloud installed (a missing binary or extension skips the row with a reason; strict mode fails it). Hyper, OpenCode Go and the paid OpenRouter Anthropic cell are deferred to after 0.13.0 (owner, 2026-11-08) and recorded as deferred, not failed. | 120 requests per enabled cell (3 runs x 2 harnesses x a 20-request ceiling), so at most 480 requests for the four cells plus at most 120 for each inconclusive rerun; the separate provider probe's `turns` generation requests (default 4) plus catalog discovery for the probe cells. Never scheduled. |
| `release/journey-commandcode` | active | `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_LIVE_RELEASE_JOURNEY` + `COMMAND_CODE_API_KEY` | `PRISM_LIVE_COMMANDCODE_JOURNEY_MODEL` (default `Qwen/Qwen3.7-Flash`) | T2 release journey (plan 215 Task 32): ten provider-agnostic scenarios through createAgent and first-party packages (stream contract, tool loop with thinking replay, cross-process approval resume, gate integrity, rewrite re-gate, ownership isolation, limits, compaction, two-principal remote host, abort), leak-scanned with COMMAND_CODE_API_KEY. Use a least-privilege COMMAND_CODE_API_KEY with a provider-side spend cap. | Hard budget enforced by the suite: at most 36 provider requests and 80k input tokens per run (catalog lookups counted separately); per-scenario timeout 120 s, suite at most 15 min. Measured 2026-11-08: 25-28 requests, under 15k input tokens, about 2 minutes. |
| `release/journey-ollama-cloud` | active | `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_LIVE_RELEASE_JOURNEY` + `OLLAMA_API_KEY` | `PRISM_LIVE_OLLAMA_CLOUD_JOURNEY_MODEL` (default `gemma4:31b`) | T2 release journey (plan 215 Task 32): ten provider-agnostic scenarios through createAgent and first-party packages (stream contract, tool loop with thinking replay, cross-process approval resume, gate integrity, rewrite re-gate, ownership isolation, limits, compaction, two-principal remote host, abort), leak-scanned with OLLAMA_API_KEY. Use a least-privilege OLLAMA_API_KEY with a provider-side spend cap. | Hard budget enforced by the suite: at most 36 provider requests and 80k input tokens per run (catalog lookups counted separately); per-scenario timeout 120 s, suite at most 15 min. Measured 2026-11-08: 25-28 requests, under 15k input tokens, about 2 minutes. |
| `providers/kilo` | active | `PRISM_LIVE_PROVIDER_TESTS` + `KILO_API_KEY` | `PRISM_LIVE_KILO_CHAT_MODEL` (default `google/gemma-4-26b-a4b-it`), `PRISM_LIVE_KILO_RESPONSES_MODEL` (default `openai/gpt-6-luna`), `PRISM_LIVE_KILO_MESSAGES_MODEL` (default `anthropic/claude-haiku-5.5`) | Three Kilo AI Gateway wires: Chat Completions, Responses, Anthropic Messages, one exemplar each. Per route: text, tool loop, structured output, abort, leak scan. The cache probe is separate: the gateway places its own breakpoints (plan 213 Task 1b), so it measures prefix reuse rather than a client lever. | ~25 generation requests across three wires: 2 per text/tool-loop pair plus structured and error, 9 kernel-smoke turns, and the anonymous/data-collection checks. The separate cache probe is 4 generation requests per wire (12 plus catalog discovery, plan 203 fixture). The reference account returned 402 on the paid exemplars (negative balance, 2026-10-31), so the accepted run used free ids (e.g. nvidia/nemotron-3.5-super-vl:free) at $0.00; free models are limited to 200 requests per hour. |
| `providers/litellm` | active | `PRISM_LIVE_PROVIDER_TESTS` + `LITELLM_API_KEY` | `PRISM_LIVE_LITELLM_MODEL` (default `prism-free/gpt-oss-20b@groq`) | One Chat Completions route against a host-run LiteLLM Proxy: text, tool loop, abort, and a named error, plus the leak scan. The proxy must answer /health/liveliness at PRISM_LIVE_LITELLM_BASE_URL (default http://127.0.0.1:4000) or the suite skips with a reason. | ~8 generation requests at $0.00 on the prism-free pool (Groq, Cloudflare, Gemini, OpenRouter free tiers); a paid backend overall spends whatever the proxy forwards, and this suite makes no extra requests. |
<!-- generated:live-matrix:end -->

## Strict CI workflow

The scheduled [`live-canaries` workflow](../.github/workflows/live-canaries.yml) (Tuesdays 05:43 UTC, plus `workflow_dispatch`) runs four restricted protocol canaries — provider, MCP, A2A, and Brave search — from a GitHub `live-canaries` environment, with every value supplied through repository secrets and a 15 s per-canary timeout. It runs `scripts/live-canary.mjs` (gated on `PRISM_LIVE_CANARIES=1`, which requires **all** canary credentials together so A2A never runs standalone) and uploads the status report as a workflow artifact. The full live matrix runs on a weekly schedule (and on demand) via the [`live-matrix` workflow](../.github/workflows/live-matrix.yml): strict-mode filtered run (default `providers/opencode-go`, the credentialed suites) with the report + e2e-coverage evidence uploaded as artifacts; operators also run it from a credentialed checkout with `npm run test:live`, optionally `PRISM_LIVE_STRICT=1` when gating a release.

## Security and performance notes

- Credentials never enter the repo, test fixtures, logs, or reports; only env var names and model ids are persisted. `assertNoSecretLeak` (exported from `@arnilo/prism/testing/*`) runs over live transcripts, and secret-shaped values in `scripts/live-matrix.json` are rejected by the manifest validator.
- Suite costs are bounded and recorded per row; provider model defaults are the cheapest cost-bounded models that satisfy each probe.
- Per-suite `PRISM_LIVE_SUITE_TIMEOUT_MS` kill timers and opt-in `PRISM_LIVE_CONCURRENCY` parallelism keep a stuck wire from stalling the run.
- Packaging tests run under `scripts/with-build-lock.mjs` so parallel suites never race the TypeScript build.

## Release acceptance on live providers

### What it does

Release acceptance shows that a release commit works against real provider wires, not just against mocks and recorded fixtures. It uses the matrix runner above in strict mode. A release passes only when every required tier is green, and an operator records the result in an evidence file that the release owner signs.

### When to use it

- On the release commit, before the tag, every release (plan 215 Task 39 repeats it for 0.13.0).
- After a fix to a provider package, the provider kit, or the kernel's model path, to re-run the affected tier before the release run.

### Inputs

**Tiers.**

| Tier | What runs | Required for a release |
| --- | --- | --- |
| T0 | `bun run test`: hermetic, with the mock provider and recorded wire fixtures. Experimental packages (the memory line) are covered here only and have no live row. | green on the release commit |
| T1 | Wire scenarios per shipped provider, the `providers/` rows. The ten gating rows are `providers/{hyper,opencode-go,typesafe,laya,liquid,liquid-local,openrouter,openai-codex,kilo,litellm}` (nine packages; `liquid` has a hosted and a local row). Each decision provider (Jev, Laya, d1-ultra, d1-3B) passes its `decide` scenario as well as its `generate` scenarios. `providers/commandcode` and `providers/ollama-cloud` run but do not gate 0.13.0; they gate their own later releases. | all ten gating rows green |
| T2 | The provider-agnostic SDK journey, the `release/journey-commandcode` and `release/journey-ollama-cloud` rows (owner decision 2026-11-08): one scenario file, run once per provider. | green on both providers |
| T2c | Cache parity against pi run headless, the `release/cache-parity` row (see [Cache parity](#cache-parity)). | run in strict mode, verdict recorded (see the note below) |
| T3 | The packed post-publish smoke, `bun scripts/post-publish-smoke.mjs` (`--local` before the tag, from the registry after publish). | green after publish |

T2c note: for 0.13.0 the enabled parity cells are Command Code and Ollama Cloud. Their providers do not gate 0.13.0, and the Hyper, OpenCode Go and paid OpenRouter cells are deferred (owner, 2026-11-08). So a missed cell is investigated and reported, and it blocks 0.13.0 only when it points to a `prism` defect in shared code (the kernel, the provider kit, or the reference host's coding worker). Otherwise it gates the provider's own release.

**Entry criteria.** Do not start spending until all of these hold:

- T0 is green on the release commit, and every plan that blocks the release is closed.
- `bun scripts/live-preflight.mjs --suite providers/ --probe` and `PRISM_LIVE_CACHE_PARITY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe` both pass (see the pre-flight check below). Checking only the `release/` rows does not prove T1 readiness. The `providers/` check covers `providers/openrouter` and `OPENROUTER_API_KEY`.
- Every key has a spend cap set at the provider.
- The owner has authorized each selected model. If the pinned model is unavailable, stop and ask. Never silently substitute `openrouter/free` or `openrouter/auto`.
- `laya-serve` is reachable for the Laya row (`LAYA_BASE_URL`, default `http://127.0.0.1:8000`), and `llama-server` serving `d1-3B` is reachable for the `liquid-local` row (`PRISM_LIVE_LLAMA_SERVER_URL`).
- `scripts/litellm/up.mjs` has started the local LiteLLM proxy for the `litellm` row. The `openai-codex` grant is signed in to the OS keyring (see [OAuth providers](#oauth-providers)), and the owner has approved Kilo's device login.
- `pi` is on `PATH` with its provider extensions installed for T2c.

**Pre-flight check.** `scripts/live-preflight.mjs` (`bun run test:live:preflight`) enforces the credential rules below before anything is spent. `--suite <id-or-prefix>` selects active rows of `scripts/live-matrix.json` (repeat it to select several), and the script prints one row per check:

| Check | Passes when |
| --- | --- |
| `env file exists`, `env file mode` | The file from `PRISM_LIVE_ENV_FILE` (default `~/.config/prism/live.env`) is a regular file with mode `0600` or stricter. |
| `env file outside repo` | The file is outside the repository, or inside it and ignored by git (`git check-ignore`). |
| `<NAME> present`, `one of … present` | Every `requires` variable of the selected rows is set and non-empty, and one variable of each `requiresAny` group is. Only names are printed. |
| `keys not committed` | No credential value (a variable named `*KEY`, `*TOKEN`, `*SECRET`, `*PASSWORD` or `*CREDENTIAL`) occurs in a tracked file. The value goes to `git grep -F -f -` on stdin, never in argv. |
| `pi on PATH`, `pi providers ready` | For `release/cache-parity`: `pi` runs, and the pi extension for each enabled cell's provider (`pi-commandcode-provider`, `pi-ollama-cloud`) is installed. |
| `litellm pool started` | For `providers/litellm`: `scripts/litellm/up.mjs` has rendered the pool. |
| `probe <provider>` (with `--probe`) | One request per provider through the provider package's own function: `GET /models` through `list<Provider>Models` for Hyper, OpenCode Go, OpenRouter, Kilo, LiteLLM, Command Code and Ollama Cloud; one single-question `decide` call for Jev and hosted Liquid; a reachability request to `LAYA_BASE_URL` and to `llama-server`'s `/health`. The Hyper, OpenRouter and Kilo catalogs are public, so their probes prove catalog readiness, not key validity; the T1 run proves the key. `openai-codex` has no probe; its keyring grant is proved by its T1 row. |

Without `--probe` the script makes no network request. It exits 0 only when every check passes and 2 on any failure; every printed detail is scrubbed of the credential values it knows. `--suite release/` also selects the manual-only rows (`release/memory-bench`, `release/eval-gate`, `release/context-rot`, `release/skill-evals`), so the acceptance procedure names the release rows it runs instead.

**Credentials.**

- Use one env file outside the repository, `~/.config/prism/live.env`, with mode `0600`. Load it with `export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env`. Start from `scripts/live.env.example`. Every assignment in the template is commented out, so a fresh copy enables nothing.
- Use one least-privilege, spend-capped key per provider. The release keys are `HYPER_API_KEY`, `OPENCODE_GO_API_KEY`, `TYPESAFE_API_KEY`, `LIQUID_API_KEY`, `OPENROUTER_API_KEY`, `KILO_API_KEY` and `LITELLM_API_KEY`. The local servers need `LAYA_BASE_URL` and `PRISM_LIVE_LLAMA_SERVER_URL`. T2c also needs `COMMAND_CODE_API_KEY` and `OLLAMA_API_KEY`. `openai-codex` uses `keyring:openai-codex`, not an env key.
- Keys never go in shell history, argv, chat, CI logs, or reports. Add each key with `read -s`:

  ```bash
  install -d -m 700 ~/.config/prism
  install -m 600 /dev/null ~/.config/prism/live.env
  printf 'PRISM_LIVE_PROVIDER_TESTS=1\nPRISM_LIVE_RELEASE_JOURNEY=1\n' >> ~/.config/prism/live.env
  read -rs HYPER_API_KEY && printf 'HYPER_API_KEY=%s\n' "$HYPER_API_KEY" >> ~/.config/prism/live.env && unset HYPER_API_KEY
  read -rs OPENCODE_GO_API_KEY && printf 'OPENCODE_GO_API_KEY=%s\n' "$OPENCODE_GO_API_KEY" >> ~/.config/prism/live.env && unset OPENCODE_GO_API_KEY
  export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env
  ```

- Rotate a key after a suspected leak, and after every release run.
- The pi reference for cache parity uses the provider credentials already configured on the machine. The runner never reads, copies, or edits `~/.pi`; it only compares a stat signature of `~/.pi/agent` before and after each run.

**Model selection.** The `release/journey-commandcode` row reads `PRISM_LIVE_COMMANDCODE_JOURNEY_MODEL` (default `Qwen/Qwen3.7-Flash`) and `release/journey-ollama-cloud` reads `PRISM_LIVE_OLLAMA_CLOUD_JOURNEY_MODEL` (default `gemma4:31b`). Each row runs an `apps/prism-agent` script (`bun run test:live:journey:<provider>`) that sets `PRISM_LIVE_JOURNEY_PROVIDER`. The suite also accepts `hyper` (`PRISM_LIVE_HYPER_JOURNEY_MODEL`, default `deepseek-v4-pro`) and `opencode-go` (`PRISM_LIVE_OPENCODE_GO_JOURNEY_MODEL`, default `mimo-v2.5`) for ad-hoc runs; neither has a release row. See the [reference host README](../apps/prism-agent/README.md#the-live-provider-journey). Choose a model that supports tool calls, and use the cheapest one that passes its provider's T1 tool-loop scenario. T1 rows use their own `PRISM_LIVE_<PROVIDER>_*_MODEL` overrides (see [Model selection](#model-selection)).

**Budget.** The ceilings are enforced inside the tests, not by the operator:

- The journey allows at most 36 provider requests and 80k input tokens per provider per full run. `limits` on every run, a counting `model.call` hook (every turn and its input tokens), and a counting `fetch` handed to the provider package (every HTTP request, including the compaction summary call) fail the suite on overrun. The one-time catalog lookup that resolves the model is counted separately and reported as `catalogRequests`, because discovery cost varies by provider (Ollama Cloud makes one `/api/show` request per model).
- Each T1 row's request count is in the `cost` column of the table above. OpenRouter's paid cache leg runs only with `PRISM_LIVE_OPENROUTER_PAID=1` and separate owner approval.
- Cache parity allows at most 120 requests per cell.
- Spend caps set at the provider are the operator's backstop.

**Provider-agnostic rule.** The journey asserts Prism behaviour, not model quality. If a scenario passes on one provider and fails on the other, triage it as `prism` when the difference is in Prism's handling (codec, usage mapping, routing). Triage it as `provider-behavior` only when the recorded wire shows the model did not do what it was told.

### Procedure

Run these in order, on the release commit:

```bash
export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env
bun run test                                                     # T0
bun scripts/live-preflight.mjs --suite providers/ --probe
PRISM_LIVE_CACHE_PARITY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe
PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live                                     # T1
PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live                               # T2
PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live # T2c
```

Then read `docs/_evidence/live-matrix-report.md` (each run overwrites it, so read it after each step) and write the acceptance evidence file, `docs/_evidence/live-release-acceptance-<version>.md`. Run T3 after publish with `bun scripts/post-publish-smoke.mjs --version <version>`.

### Outputs

**Triage and flake policy.** Classify every scenario failure as one of these:

| Class | Meaning | Handling |
| --- | --- | --- |
| `transport` | Network error, 5xx or 429, as classified by `isTransientErrorInfo` from `@arnilo/prism`. | The runner may retry once. |
| `provider-behavior` | The model did not do what it was told, for example it did not call the tool it was told to call. The recorded wire must show this. | Rerun once with the same prompt, then record it as a provider issue. |
| `prism` | An assertion on Prism behaviour failed. | Never retried. It blocks the release and reopens the owning plan's task, and the run is repeated after the fix. |

A secret-leak finding of any kind stops the run, blocks the release, and triggers key rotation.

**Evidence and sign-off.** The evidence file records:

- the commit;
- per provider: the model ids, each scenario's status and request count, input tokens, durations, and the leak-scan result;
- the failure classifications;
- the T1 summary;
- the cache-parity table;
- the operator.

It records every run, not only the last one, and holds no secret: run `assertNoSecretLeak` over it with every key before committing. The release owner signs the evidence in the publish task's note.

### Security and performance notes

- The procedure never asks the operator to print, echo, or paste a key. Keys reach the suites only through the env file and `env:` refs.
- Strict mode fails the run on any skip, so a missing credential cannot pass as green.
- Every tier's ceiling is enforced in code, and spend caps at the provider are the backstop. A run that hits a ceiling fails rather than continuing to spend.

## OAuth providers

A provider whose grant is a Sign in with ChatGPT record keeps it in the OS keyring, not in `live.env`: the
record rotates on every refresh, so an environment copy would be stale by the second run. `openai-codex` is
the first such suite (`requires: PRISM_LIVE_PROVIDER_TESTS` + `PRISM_TEST_KEYCHAIN`; the ref itself is the
optional `PRISM_LIVE_OPENAI_CODEX_CREDENTIAL`, default `keyring:openai-codex`).

```sh
# sign in (prints the URL and opens it; the loopback callback finishes it)
bun scripts/provider-login.mjs --provider openai-codex --app-name "Prism live tests"

bun scripts/provider-login.mjs --provider openai-codex --status   # presence, expiry, scope, fingerprints
bun scripts/provider-login.mjs --provider openai-codex --check    # one Responses request, refreshes if due
bun scripts/provider-login.mjs --provider openai-codex --expire   # force a refresh on the next request
bun scripts/provider-login.mjs --provider openai-codex --logout   # revoke; keep the issued client
PRISM_LIVE_PROVIDER_TESTS=1 PRISM_TEST_KEYCHAIN=1 PRISM_LIVE_STRICT=1 \
  PRISM_LIVE_FILTER=providers/openai-codex bun run test:live
```

The script is a terminal `HostUi`: it prints the provider's authorization URL, opens it, accepts a pasted
callback URL when the loopback listener cannot complete, and never prints a token, code, verifier, or client
ID. `--status` reports fingerprints, not values, so two runs can be compared without disclosing the grant.

- **Sign-out keeps the registration.** `--logout` revokes the refresh grant and stores the issued client and
  this host's ID with no token, so signing in again reuses them instead of registering a second client. The
  record is a `custom`-typed marker, not a bearer secret, so a request before the next sign-in fails with a
  sign-in error rather than sending something.
- **A refresh is proven by two processes.** `--expire` moves `expires` into the past; the next request (in
  any process) refreshes, persists the rotated record, and a second process then reads it unchanged.
- **Importing a grant** (`--import <file> --service <name> --ref keyring:<name>`) validates a v1 record,
  keeps the local host's own host ID, and stores it in that namespace — used to prove a second machine's
  keyring can hold its own identity. Clean up such a copy with `--forget` (deletes without revoking the
  shared grant); never `--logout` a copy.
- **Quota is not retryable, including in a stream.** A Sign in with ChatGPT usage limit arrives as a `200`
  response whose stream carries an `error` frame; it is classified `quota` and is never retried, so a run
  stops instead of burning the allowance again. Small requests can still succeed while a large one is
  refused — the account has a five-hour plan window.

## Decision bench

`scripts/decision-bench.mjs` measures decision models on the checked-in `scripts/fixtures/decision-bench.jsonl` set (200 labelled Prism-shaped items: tool choice, route choice, tool-result error, approval-risk score). It is manual-only and never runs in `release:gate`.

```sh
bun scripts/decision-bench.mjs --check          # validate the fixture + print the request plan, no network
bun scripts/decision-bench.mjs --models liquid-local/d1-3B@Q8_0,laya/laya --limit 20
bun scripts/decision-bench.mjs                  # full default list (liquid-local Q8_0/Q4_K_M, laya, hosted d1.1/d1-ultra, jev-latest)
```

- It calls the public `prism.models.decisions()` contract once per item (plus one option-reversed repeat for choice items), so it also exercises the decisions capability end to end.
- Credentials come from the live env file (`$PRISM_LIVE_ENV_FILE`, default `~/.config/prism/live.env`); a model without its key or server is skipped with a reason. Nothing is fabricated.
- `llama-server` rows read `PRISM_LIVE_LLAMA_SERVER_URL`, or `PRISM_LIVE_LLAMA_SERVER_Q8_URL` / `_Q4_URL` when both quants are served side by side. The report records the build (`PRISM_LIVE_LLAMA_SERVER_BUILD` or `llama-server --version`) and the GGUF hash when `PRISM_LIVE_D1_GGUF_SHA256` is set.
- Output: accuracy, ECE, Brier, p50/p95 latency, option-reversal flip rate, input-token cost, plus the hosted-vs-local agreement rate, written to `docs/_evidence/decision-bench-<date>.md`.
- The metric math is pinned by `scripts/__tests__/decision-bench-metrics.test.mjs`.

## Cache parity

`scripts/cache-parity/run.mjs` compares Prism with pi on one real coding task through the wire proxy: three runs per
harness, the same model, the hit rate read from the proxy's usage log only. It covers the Command Code and Ollama Cloud
cells (Hyper, OpenCode Go and OpenRouter are deferred to after 0.13.0), costs at most 120 requests per cell, and never
runs in `release:gate`.

```bash
export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env PRISM_LIVE_PROVIDER_TESTS=1 PRISM_LIVE_CACHE_PARITY=1
timeout 3600 bun scripts/cache-parity/run.mjs --provider commandcode --model claude-haiku-5-5 --runs 3
```

The report goes to `docs/_evidence/cache-parity/<provider>-<model>-<date>.{json,md}` with the commit, pi's version, medians
and per-run metrics. See `scripts/cache-parity/README.md` for the verdicts, the budget and the isolation rules.

The `release/cache-parity` manifest row runs all four cells and applies the gate (`parityGate` in
`scripts/cache-parity/metrics.mjs`): Prism's median `hitRate` must be at least pi's on every conclusive cell, with no
`usage_mismatch` and no tolerance margin. An `inconclusive` cell is rerun once and still fails strict mode; Hyper,
OpenCode Go and the paid OpenRouter cell are recorded as `deferred`. A missing `pi` binary or pi extension skips the
row with a reason (strict mode fails it).

```bash
PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live
```

The first run is recorded in `docs/_evidence/cache-parity-0.13.0.md`; every run keeps its own report under
`docs/_evidence/cache-parity/`. `scripts/cache-parity/kilo-cli-reference.mjs` runs the Kilo CLI headless on plan 203's
fixture for the free-model Chat cell.

## Provider cache probe

The manual-only `scripts/cache-parity/provider-probe.mjs` replays a fixed coding
transcript through **only the named provider package**, without launching an
agent harness or pi. It never runs in `release:gate` or starts automatically.
Offline pi lever equivalence is not measured cache parity.

After approving the model and spend, put credentials and opt-in flags in a
private `live.env` (mode `0600`). `PRISM_LIVE_ENV_FILE` selects it; otherwise the probe reads
`~/.config/prism/live.env`. Existing env values take precedence. Do not put a key in arguments or paste one in a command.

```sh
# private live.env: OPENROUTER_API_KEY, PRISM_LIVE_PROVIDER_TESTS=1,
# PRISM_LIVE_CACHE_PARITY=1, PRISM_LIVE_OPENROUTER_PAID=1
# Run only after explicit authorization for this paid model.
timeout 600 bun scripts/cache-parity/provider-probe.mjs \
  --provider openrouter --model anthropic/claude-haiku-4.5 --turns 4

# Separately authorized pinned implicit-cache model; measure its no-header baseline:
timeout 600 bun scripts/cache-parity/provider-probe.mjs \
  --provider openrouter --model recursive/flint-v1.0:free --turns 4 --without-session

# Ollama Cloud: OLLAMA_API_KEY plus both general opt-in flags above; no paid OpenRouter flag.
# Two separate four-request runs (8 generation requests total):
timeout 600 bun scripts/cache-parity/provider-probe.mjs \
  --provider ollama-cloud --model gemma4:31b --turns 4 --ttft
timeout 600 bun scripts/cache-parity/provider-probe.mjs \
  --provider ollama-cloud --model gemma4:31b --turns 4 --route openai --ttft
```

- **Cost:** `--turns` generation requests (default 4; range 2–20), plus one
  catalog-discovery operation. OpenRouter discovery is one GET; other providers
  may need additional discovery calls. No retries. Each generation has a 128
  output-token cap and a 60-second signal. Comparing header-on and header-off
  requires two invocations: **8 generation requests** at defaults, plus catalog
  discovery. A failed or undersized first prompt stops before further spend.
  All flags default off; paid OpenRouter additionally needs its paid flag.
- **Timing/routes:** `--ttft` adds per-turn `ttftMs`, from generation start to the
  first nonempty text delta; thinking does not count, and missing text is `null`,
  never zero. `latencyMs` remains total stream duration. Without `--ttft`, reports
  retain their existing timing fields. Ollama Cloud alone accepts `--route native`
  (default) or `--route openai`; route-specific evidence filenames cannot overwrite
  each other. Its key variable is `OLLAMA_API_KEY`. Each CLI invocation performs
  `1 + N` free metadata requests (tags plus show, concurrency 4) before generation;
  a separate four-turn pi reference adds four generation requests.
- **Prefix:** at least 8192 space-separated padding words plus fixed system,
  two tools, tool-call/result history and an anchor message. A declared
  `cache.minCacheableTokens` raises this target (up to 65536). The first request
  must actually report at least that many inclusive input tokens; an estimate
  does not count. This exceeds Haiku 4.5's 4096-token minimum. Later requests
  preserve that whole transcript and append a small deterministic suffix;
  generated responses are deliberately not inserted. Offline fixture thinking
  signatures are removed from live history, never replayed as real upstream data.
  One fresh run identifier
  salts the prefix, with one stable session/cache key across turns. Explicit
  block-cache boundaries stay on system, last tool and the anchor message.
- **Reuse:** `Σ cacheReadTokens(turn ≥ 2) / Σ stablePrefixTokens(turn ≥ 2)`.
  `stablePrefixTokens` is the provider-reported first request's full prompt,
  repeated as the denominator for each warm turn—not a characters/token guess.
  Cached suffixes can make the result slightly greater than 1; it is not capped.
  Missing/estimated input counts, missing cache-read fields or a first prefix
  below minimum yield `unmeasurable` with a reason. Explicit zero reads mean
  measured zero. Missing writes stay `null`, never invented as zero.
- **Evidence:** `docs/_evidence/cache-probe/<provider>-<model>-<date>.json`
  (model slashes become hyphens), with per-turn inclusive input/read/write
  counts and full-stream `latencyMs`. `--without-session` omits both affinity
  options and writes a separate `-without-session-<date>.json`. It is an
  independent cold-prefix run, not proof that headers caused a cache hit.
  Same-model/mode/day reruns replace that report; archive it before rerunning
  when preserving a campaign. Evidence contains metrics only, is written
  atomically with mode `0600`, and passes known-key and `scan-secrets` checks.
  Raw provider errors, response text, keys and headers are never persisted.
- **Interpretation:** select a pinned tool-capable model, never
  `openrouter/free` or `openrouter/auto`. Paid Anthropic reuse ≥ 0.9 on warm
  turns and pinned implicit-cache reuse > 0 require authorized live evidence;
  the script reports measurements, never declares harness parity. If the
  upstream omits cache counts, preserve `unmeasurable` and its reason.

## Extension and configuration notes

- Add a suite: write the env-gated test (skip-not-fail), register it in `scripts/live-matrix.json` (`id`, `package`, `status`, `source`, `command`, `cwd`, `requires`/`requiresAny`, model wiring, least-privilege `scope`, `cost`), then run `node scripts/generate-live-docs.mjs --write` to refresh the table above. `scripts/live-doc-check.test.mjs` fails `npm test` when the doc drifts.
- Add a credential: extend `scripts/live.env.example` (a commented `# NAME=` entry with an empty or placeholder value; `live_env_example_has_no_values` in `scripts/live-matrix.test.mjs` checks the template against the manifest) and the relevant manifest `requires` list. Prefer `requiresAny` when a probe accepts several interchangeable providers.

## LiteLLM free pool (local, opt-in)

`scripts/litellm/up.mjs` starts a loopback-only LiteLLM proxy over free tiers (Groq, NVIDIA NIM,
Google AI Studio, Cloudflare Workers AI) and mints a budget-capped virtual key. It is for wire and
integration runs, **not** release evidence — that stays on Hyper and OpenCode Go, because a free tier
can change models, throttle, or train on prompts without notice.

```bash
timeout 240 bun scripts/litellm/up.mjs --write-key   # sets LITELLM_API_KEY in the live env file
timeout 240 bun scripts/litellm/reconcile.mjs --report <bench-report.json>
timeout 60  bun scripts/litellm/down.mjs --purge
```

Only backends whose keys exist are deployed; groups are `prism-free/smoke` (mixed, wire tests only),
`prism-free/gpt-oss-120b` (same model on several hosts) and `prism-free/<model>@<host>` single-host
pins, which are the only groups a scored arm may use. `prism-free/priced` carries a fabricated price so
a paid call actually accrues spend against the key's `max_budget`; the budget refuses it a flush later
(`422 budget_exceeded`), so it is a tripwire, not a ceiling. Full details, quotas with dates, data-use
notes and the data-only caveat are in `scripts/litellm/README.md`.

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

## Skill evaluations

Each module skill (`web-research`, `browser-automation`, `delegating-work`, and the removed `coding-workflow`) is measured against
the same agent with the skill disabled, under the pre-registered rule in
`scripts/skill-evals/criteria.json`. Details, the ship rule and the evidence layout:
[README](../scripts/skill-evals/README.md).

```bash
timeout 300 bun scripts/skill-evals/run.mjs --offline                         # scripted provider, no key, runs in CI
bun scripts/skill-evals/run.mjs --register                                    # lock the criteria, then commit
timeout 1800 bun scripts/skill-evals/run.mjs --dry-run --providers hyper      # five items per skill: the cost estimate
timeout 3600 bun scripts/skill-evals/run.mjs --live --providers hyper,opencode-go --skill web-research
```

Credentials are `HYPER_API_KEY` and `OPENCODE_GO_API_KEY`, plus `OPENROUTER_API_KEY`, `KILO_API_KEY` and `COMMAND_CODE_API_KEY` for the
free models, from `~/.config/prism/live.env` only. The router aliases `openrouter/free` and `openrouter/auto` are refused. A paid run needs the lock to match `criteria.json` and the datasets; a scored run also needs them
committed. Web items run against a loopback fixture site and the browser opens a local Chromium, so nothing touches the
live web. Evidence passes `redactSecrets` and a no-secret assertion.

## Host-builder evaluation

The `@arnilo/prism-host-builder` kit (skill, indexes, MCP server) is measured by giving a Prism builder agent seven
fixture tasks in three arms (`none`, `skill`, `skill+mcp`) and grading its project with hidden tests. Claims are
published only under the pre-registered rule in `scripts/host-builder-evals/criteria.json`. Details, the tasks and the
claim rules: [README](../scripts/host-builder-evals/README.md).

```bash
timeout 600 bun scripts/host-builder-evals/run.mjs --offline                       # scripted oracle, no key, runs in CI
bun scripts/host-builder-evals/run.mjs --register                                  # lock the criteria and inputs, then commit
timeout 1800 bun scripts/host-builder-evals/run.mjs --dry-run --providers ollama-gemma4   # three tasks, one trial: the cost estimate
timeout 14400 bun scripts/host-builder-evals/run.mjs --live --providers ollama-gemma4 [--preload]
```

`--preload` tells the skill arms to load the skill first. The scored runs use three paid Ollama Cloud models
(`gpt-oss:120b`, `beam`, `gemma4:31b`; owner decision 2026-11-08) with `OLLAMA_API_KEY` from `~/.config/prism/live.env`; the
free tiers of OpenRouter, Kilo and Command Code are too small for a scored run. Models come from
`PRISM_LIVE_HOST_BUILDER_EVAL_{HYPER,OPENCODE,OLLAMA_GPT_OSS,OLLAMA_BEAM,OLLAMA_GEMMA4}_MODEL`. A paid run needs the lock to match the criteria and every registered
input; a scored run also needs them committed. The builder works in a temp copy of each fixture, its shell inherits no
key, and the evidence passes `redactSecrets` and a no-secret assertion. Evidence: `docs/_evidence/host-builder/212/`.

## Manual memory benchmark

Requirements, dispatch/local commands, licences and comparison limits:
[README](../scripts/memory-bench/README.md). LoCoMo is CC BY-NC 4.0;
evidence uploads contain only ids and metrics.
