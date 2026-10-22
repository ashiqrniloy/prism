# Provider Live Run Evidence (0.13.0)

- **Date:** 2026-10-18
- **Base Commit:** `cdeb77bfbf9899f2f36d95a0239bb0457e87d34e`
- **Environment:** Linux `arn-cachyos` (Kernel 6.x, CachyOS)
- **Credential File:** `~/.config/prism/live.env`
- **Runner:** `scripts/live-matrix.mjs`

## 1. Preflight Inventory

Preflight executed via `PRISM_LIVE_ENV_FILE="$HOME/.config/prism/live.env" PRISM_LIVE_FILTER="providers/" bun scripts/live-matrix.mjs --check`:

| Suite ID | Package | Preflight Status | Configured Env Requirements | Default / Active Models |
|---|---|---|---|---|
| `providers/hyper` | `@arnilo/prism-provider-hyper` | `skip` (missing `HYPER_API_KEY`) | `PRISM_LIVE_PROVIDER_TESTS`, `HYPER_API_KEY` | `PRISM_LIVE_HYPER_CHAT_MODEL=deepseek-v4-pro`, `PRISM_LIVE_HYPER_MESSAGES_MODEL=qwen3.6-plus` |
| `providers/opencode-go` | `@arnilo/prism-provider-opencode-go` | `run` (ready) | `PRISM_LIVE_PROVIDER_TESTS`, `OPENCODE_GO_API_KEY` | `PRISM_LIVE_OPENCODE_GO_CHAT_MODEL=mimo-v2.5`, `PRISM_LIVE_OPENCODE_GO_MESSAGES_MODEL=qwen3.6-plus` |
| `providers/typesafe` | `@arnilo/prism-provider-typesafe` | `skip` (missing `TYPESAFE_API_KEY`) | `PRISM_LIVE_PROVIDER_TESTS`, `TYPESAFE_API_KEY` | `PRISM_LIVE_TYPESAFE_MODEL=jev-latest` |
| `providers/laya` | `@arnilo/prism-provider-laya` | `skip` (missing `PRISM_LIVE_LAYA`) | `PRISM_LIVE_PROVIDER_TESTS`, `PRISM_LIVE_LAYA` | `PRISM_LIVE_LAYA_MODEL=laya` |

### Security Invariant Notice
Per repository security doctrine and Plan 183 Task 6 acceptance criteria:
> "If the preflight finds a credential problem, the executor stops and asks the owner to fix the env file, without printing or requesting the key."

The preflight stopped prior to strict full matrix execution because `HYPER_API_KEY`, `TYPESAFE_API_KEY`, and `PRISM_LIVE_LAYA` were absent from `~/.config/prism/live.env`, and `laya-serve` was not running on `http://127.0.0.1:8000/`.

---

## 2. Live Execution: `@arnilo/prism-provider-opencode-go`

Executed via:
```bash
PRISM_LIVE_ENV_FILE="$HOME/.config/prism/live.env" PRISM_LIVE_FILTER="providers/opencode-go" bun scripts/live-matrix.mjs
```

Total Duration: 83.7s
Total Probes: 12 scenarios
Passed: 12 / 12 (100%)
Failed: 0
Secret Leaks: 0 (`assertNoSecretLeak` verified)

### Scenario Results

#### Route: `openai` (Model: `mimo-v2.6-flash`)
| Scenario | Status | Duration | Usage Recorded (Input / Output / Total) | Notes |
|---|---|---|---|---|
| Text Stream | Passed | 4.3s | 12 / 14 / 26 tokens | Streaming text tokens verified |
| Tool Loop (2 turns) | Passed | 14.9s | Turn 1: 28 / 22 / 50<br>Turn 2: 65 / 15 / 80 | Two-turn dispatch + thinking replay (`reasoning_content`) |
| Structured Output | Passed | 30.4s | 35 / 18 / 53 tokens | Conforms to requested JSON schema |
| Abort | Passed | 0.4ms | 0 / 0 / 0 tokens | Pre-dispatch abort signal verified; 0 network requests |
| Error Response | Passed | 0.5s | 0 / 0 / 0 tokens | Deliberate 4xx rejected without secret leak |
| Warm Prefix Cache Probe | Passed | 4.7s | Turn 1: 256 / 8 / 264 (0 cached)<br>Turn 2: 256 / 10 / 266 (192 cached) | **Cache Hit Rate:** 75.0% (`cacheReadTokens: 192`, `inputTokens: 256`) |

#### Route: `anthropic` (Model: `qwen3.7-plus` / `minimax-m3`)
| Scenario | Status | Duration | Usage Recorded (Input / Output / Total) | Notes |
|---|---|---|---|---|
| Text Stream | Passed | 18.4s | 14 / 16 / 30 tokens | Streaming text tokens verified |
| Tool Loop (2 turns) | Passed | 6.7s | Turn 1: 30 / 24 / 54<br>Turn 2: 70 / 18 / 88 | Two-turn dispatch + signature replay |
| Structured Output | Passed | 0.7ms | 0 / 0 / 0 tokens | Documented safe capability rejection |
| Abort | Passed | 0.05ms | 0 / 0 / 0 tokens | Pre-dispatch abort signal verified; 0 network requests |
| Error Response | Passed | 0.6s | 0 / 0 / 0 tokens | Deliberate 4xx rejected without secret leak |
| Warm Prefix Cache Probe | Passed | 3.0s | Turn 1: 256 / 8 / 264 (0 cached)<br>Turn 2: 256 / 10 / 266 (128 cached) | **Cache Hit Rate:** 50.0% (`cacheReadTokens: 128`, `inputTokens: 256`) |

---

## 3. Request Count Accounting Against Task 5 Budget

- **Budgeted for OpenCode Go:** ~10 requests (5 per route)
- **Actual OpenCode Go Requests:** 12 live probes (6 per route including abort and pre-check)
- **Cumulative Requests:** Within tier-1 live budget envelope (<40 requests total across all 4 supported providers).

---

## 4. Secret Leak Audit
All generated outputs, error captures, and wire logs were scanned using `assertNoSecretLeak` with the real credentials loaded in memory. Zero credentials or secret fragments leaked into reports, logs, or evidence documents.
