# Live release acceptance, 0.13.0 (plan 215 Task 34)

> Task 10 rerun, 2026-11-11: cache parity, both release journeys and all in-scope providers pass on candidate `2cd2b553` under the owner's amended scope. Owner sign-off and publication are pending. See the candidate record below. The original run remains unchanged.

- **Run:** 1, the first acceptance run. Task 39 repeats it on the release commit.
- **Dates:** 2026-11-08 23:55 to 2026-11-09 02:40 (+06:00).
- **Commit:** `2fd3c592` plus the uncommitted 0.13.0 working tree (the in-flight memory rename and this task's edits listed under "Changes made during the run").
- **Operator:** the repository owner (git user Niloy Rahman); executed by Claude Code. Credentials: `~/.config/prism/live.env` (mode 0600, outside the repository). No key was printed or requested in chat.
- **Runner:** `scripts/live-matrix.mjs` in strict mode (`PRISM_LIVE_STRICT=1`), one invocation per filter. Each invocation's report is kept in [`live-release-acceptance-0.13.0/`](live-release-acceptance-0.13.0/), numbered in run order; `live-matrix-report.{json,md}` hold the last invocation (run 10).

## Verdict

**Not green. The release acceptance does not pass yet.** Two blockers remain:

1. **Three T1 providers are blocked by their accounts, not by Prism:** Hyper (no credits, HTTP 402), Kilo (negative balance, HTTP 402) and OpenCode Go (monthly usage limit, HTTP 429). Each refusal arrives as a well-formed `error` stream terminal, so it is classified `env/operator`. The owner must top up or renew each account before Task 39.
2. **Cache parity fails one cell.** Ollama Cloud is `behind` on the gate's inclusive hit rate, while Prism leads on the first-turn-excluded rate (see "Cache parity"). Classified `gate/metric`, not a lever defect. This needs an owner decision before Task 39.

Everything else passes: Ollama Cloud (now including the `clef` decision model), OpenRouter, Command Code (after a vendor-drift fixture fix), and both release journeys.

## Scope by owner decision (2026-11-08)

When the offline preflight reported the gaps, the owner directed: **"Use clef from ollama cloud for decision models. Ignore the rest."** So, for this run:

- **Decision-model coverage** comes from Ollama Cloud's `clef:27b` over `/v1/systemone`, using the same shared System One scenarios the TypeSafe, Liquid and Laya rows run. These rows were out of scope:
  - `providers/typesafe`: `TYPESAFE_API_KEY` absent.
  - `providers/liquid`: `LIQUID_API_KEY` absent.
  - `providers/laya`: `laya-serve` not installed.
  - `providers/liquid-local`: `llama-server` not installed.
- **Also out of scope:**
  - `providers/openai-codex`: `PRISM_TEST_KEYCHAIN` unset.
  - `providers/litellm`: the local pool was not started.

  Their rows stay in the manifest. A strict `providers/` run still selects them, so Task 39 must either provide them or record the same owner scope.

## Preflight

| Command | Result |
| --- | --- |
| `bun scripts/live-preflight.mjs --suite providers/` (offline) | exit 2: the six out-of-scope rows above plus the LiteLLM pool; every in-scope key present, 7 keys not committed. |
| `bun scripts/live-preflight.mjs --suite providers/{ollama-cloud,hyper,opencode-go,openrouter,commandcode,kilo} --probe` | **pass**. Catalog probes: Hyper 18, OpenCode Go 30, OpenRouter 425, Kilo 380, Command Code 96, Ollama Cloud 26 models. Hyper, OpenRouter and Kilo report "public catalog; key not validated", which is why the billing failures surfaced only in the strict runs. |
| `PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_RELEASE_JOURNEY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe` | **pass**. `pi 1.5.0`; the `commandcode` and `ollama-cloud` pi extensions are ready; Command Code (96) and Ollama Cloud (26) probes pass. |

## T1: provider rows (`PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/<id> bun run test:live`)

The runner does not count requests. **Usage requests** counts the requests whose usage the shared scenarios logged; the kernel smokes, abort, error-response and decision-only requests are not in it. Input tokens are summed over those same requests. The manifest `cost` column holds each row's budget.

| Run | Row | Models | Tests (pass / skip / fail) | Usage requests | Input tokens | Duration | Leak scan | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | `providers/ollama-cloud` | `gemma4:31b` (native + OpenAI routes), `gpt-oss:20b` (cache), `clef:27b` (decisions) | 18 / 0 / 0 | 9 | 676 | 52.3 s | pass | **pass** |
| 02 | `providers/hyper` | `deepseek-v4-pro` (chat), `qwen3.6-plus` (messages) | 6 / 0 / 6 | 0 | 0 | 4.5 s | pass | `env/operator`: HTTP 402 `billing_error`, "You don't have any credits yet" |
| 03 | `providers/opencode-go` | `mimo-v2.5`, `qwen3.6-plus` | 6 / 0 / 6 | 0 | 0 | 4.8 s | pass | `vendor`: HTTP 410 `ModelDeprecated` (`mimo-v2.5` → `mimo-v2.6-flash`) |
| 07 | `providers/opencode-go` (rerun) | `mimo-v2.6-flash`, `qwen3.7-plus` (env overrides) | 6 / 0 / 6 | 0 | 0 | 5.2 s | pass | `env/operator`: HTTP 429 `GoUsageLimitError` (monthly) |
| 04 | `providers/openrouter` | `recursive/flint-v1.0:free` | 5 / 1 / 0 | 4 | 443 | 20.0 s | pass | **pass** (skip = the separately gated paid cache probe) |
| 05 | `providers/commandcode` | `minimax/minimax-m3.1-flash`, `gpt-5.6-luna`, `claude-haiku-5-5` | 19 / 3 / 1 | 10 | 2,519 | 32.9 s | pass | `vendor`: the ZDR fixture model `poolside/laguna-s-2.1-free` was retired on 2026-11-04 (HTTP 403) |
| 10 | `providers/commandcode` (rerun) | as run 05; ZDR fixture `stealth/glyph-cluster:free` | 20 / 3 / 0 | 10 | 2,528 | 30.4 s | pass | **pass** (skips = cache scenarios not selected on the three routes) |
| 06 | `providers/kilo` | `google/gemma-4-26b-a4b-it`, `openai/gpt-6-luna`, `anthropic/claude-haiku-5.5` | 11 / 3 / 9 | 0 | 0 | 7,545.6 s wall* | pass | `env/operator`: HTTP 402 `usage_limit_exceeded` ("Low Credit Warning", negative balance) |

\* The Kilo test times add up to about 75 s, and the slowest single test was 72.6 s. The wall time spans the host clock crossing midnight, and the runner's 600 s kill timer never fired, which is consistent with a host suspend during the run. This is likely, not proven.

Every failing test on Hyper, Kilo and OpenCode Go is a generation request the account refused. The tests that pass on those rows need no generation: abort before fetch, error response, and structured-output rejection. The scenarios ran their leak scans, which passed.

T1 history and the per-provider detail of earlier runs: [`provider-live-0.13.0.md`](provider-live-0.13.0.md).

### Ollama Cloud decision model (`clef:27b`)

The shared System One scenarios all pass:

- a schema-valid decision;
- `decide` returning raw answers for every question type;
- tools rejected before fetch;
- abort observed before the first request;
- a leak-free error response.

Usage: 150 input and 0 output tokens per decision request (input-only billing).

## T2: release journeys (`PRISM_LIVE_STRICT=1 PRISM_LIVE_RELEASE_JOURNEY=1 PRISM_LIVE_FILTER=release/journey- bun run test:live`, run 08)

Budget per provider: 36 requests and 80k input tokens.

| Row | Model | Tests | Requests / budget | Input tokens / budget | Catalog requests | Duration | Leak scan | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `release/journey-commandcode` | `Qwen/Qwen3.7-Flash` | 13 / 0 / 0 | 26 / 36 | 16,555 / 80,000 | 1 | 108.4 s | pass | **pass**; thinking produced and replayed (scenario 2) |
| `release/journey-ollama-cloud` | `gemma4:31b` | 13 / 0 / 0 | 26 / 36 | 10,757 / 80,000 | 27 | 39.5 s | pass | **pass**; no thinking produced, so scenario 2's replay leg is vacuous on this model (Task 32 finding 4) |

Per scenario, as requests / input tokens / ms:

| Scenario | Command Code | Ollama Cloud |
| --- | --- | --- |
| 1 stream contract | 1 / 639 / 4,390 | 1 / 409 / 1,449 |
| 2 tool loop | 2 / 1,365 / 5,013 | 2 / 888 / 2,158 |
| 3 approval suspend/resume across processes | 2 / 1,404 / 3,521 | 2 / 923 / 1,627 |
| 4 gate integrity | 4 / 3,194 / 29,909 | 2 / 933 / 3,117 |
| 5 rewrite re-gate | 2 / 1,416 / 11,733 | 4 / 2,188 / 3,573 |
| 6 ownership isolation | 2 / 1,307 / 5,231 | 2 / 847 / 1,941 |
| 7 limits | 3 / 2,017 / 5,441 | 3 / 1,312 / 4,874 |
| 8 compaction | 6 / 3,161 / 29,136 | 6 / 1,916 / 6,930 |
| 9 remote, two principals | 2 / 1,394 / 3,064 | 2 / 913 / 2,445 |
| 10 abort | 2 / 658 / 10,665 | 2 / 428 / 2,540 |

## Cache parity (`PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live`, run 09)

Harnesses: Prism `2fd3c592` plus the working tree; pi `1.5.0`. Reports: [`cache-parity/`](cache-parity/). Method and Task 24 history: [`cache-parity-0.13.0.md`](cache-parity-0.13.0.md).

| Cell | Model | Verdict | Prism hitRate median (range) | pi hitRate median (range) | First-turn-excluded (Prism / pi) | Requests per run, median (Prism / pi) | Solved (Prism / pi) | Requests used / ceiling | Report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Command Code chat | `minimax/minimax-m3.1-flash` | **pass** | 0.844 (0.844–0.870) | 0.780 (0.751–0.789) | 0.914 / 0.839 | 8 / 6 | 3/3 / 3/3 | 44 / 120 | `commandcode-minimax-minimax-m3.1-flash-2026-11-08-3` |
| Command Code Responses | `gpt-5.6-luna` | **pass** | 0.808 (0.784–0.865) | 0.737 (0.735–0.737) | 0.887 / 0.814 | 7 / 5 | 3/3 / 3/3 | 38 / 120 | `commandcode-gpt-5.6-luna-2026-11-08-4` |
| Command Code Messages, attempt 1 | `claude-haiku-5-5` | inconclusive | 0.789 (0.702–0.837) | 0.676 (0.655–0.687) | 0.870 / 0.804 | 6 / 4 | 1/3 / 3/3 | 30 / 120 | `commandcode-claude-haiku-5-5-2026-11-08-4` |
| Command Code Messages, attempt 2 (the one allowed rerun) | `claude-haiku-5-5` | **pass** | 0.749 (0.703–0.795) | 0.675 (0.672–0.676) | 0.875 / 0.800 | 5 / 4 | 2/3 / 3/3 | 30 / 120 | `commandcode-claude-haiku-5-5-2026-11-08-5` |
| Ollama Cloud (native) | `gemma4:31b` | **behind** | 0.850 (0.849–0.883) | 0.890 (0.867–0.892) | **0.943 / 0.925** | 8 / 8 | 3/3 / 3/3 | 50 / 120 | `ollama-cloud-gemma4-31b-2026-11-08-3` |

Total: 192 requests across both harnesses. Gate: `{"pass":false,"failures":[{"id":"ollama-cloud/chat","verdict":"behind"}]}`.

**Ollama Cloud `behind`: classified `gate/metric`, owner decision needed.**

- Task 24 measured this cell at 0.866 against 0.860 and called it "parity, not a lead". Run 09 measures 0.850 against 0.890, and the ranges overlap.
- On the warm-prefix (first-turn-excluded) view Prism leads, 0.943 to 0.925.
- What changed is pi's run length: its median went from 6 to 8 requests per run. Each extra warm request raises an inclusive rate, and Prism's larger cold first turn (13 tools against pi's 4) weighs on its own inclusive rate.
- This task changed no request-lever code. Neither side sends a cache lever on this route (Task 24 levers note). The working tree is bulk WIP, so "unchanged since Task 24" cannot be proven from the commit log.

The gate reruns only `inconclusive` cells, so the cell was not rerun to look for a pass. Options for the owner, before Task 39:

- (a) keep the inclusive rule and record the cell as known parity-level variance (plans 205 and 206 already gate Command Code and Ollama Cloud on their own releases, per the Task 24 amendment);
- (b) gate this no-lever route on the first-turn-excluded rate;
- (c) rerun the cell at Task 39 under the current rule.

## Failure classification summary

| Class | Count | Items |
| --- | --- | --- |
| `prism` | 0 | none: no Prism defect surfaced, so no owning plan task is reopened |
| `env/operator` | 3 | Hyper (credits), Kilo (balance), OpenCode Go (monthly limit) |
| `vendor` | 2 | the Command Code ZDR fixture model was retired (fixed, rerun green); OpenCode Go retired `mimo-v2.5`, and `qwen3.6-plus` is gone from its catalog (the package's static catalog and the manifest defaults are stale) |
| `gate/metric` | 1 | Ollama Cloud cache-parity cell `behind` at parity-level variance |
| out of scope (owner) | 6 rows | TypeSafe, Liquid, Laya, liquid-local, OpenAI Codex, LiteLLM |

## Changes made during the run

- `packages/providers/ollama-cloud/src/__tests__/live.test.ts`: `runSystemOneLiveScenarios` over `clef:27b` (`PRISM_LIVE_OLLAMA_CLOUD_DECISION_MODEL`). The variable is registered in `scripts/live-matrix.json` (model list, scope, cost) and `scripts/live.env.example`. `docs/live-testing.md` is regenerated.
- `packages/providers/commandcode/src/__tests__/live-agent.test.ts`: the non-ZDR fixture is `stealth/glyph-cluster:free`, overridable with `PRISM_LIVE_COMMANDCODE_NON_ZDR_MODEL`. On 2026-11-09 both free models in the catalog answered 422 `cmd_zdr_no_providers`. The variable is registered in the manifest and the env template.
- `src/testing/provider-live-scenarios.ts`: the text and tool-loop scenarios now name the provider's terminal `error` event (masked) instead of reporting an "empty" answer, which is what made runs 02, 03, 06 and 07 classifiable. Test: `live_scenarios_name_the_provider_error_instead_of_an_empty_answer` in `src/__tests__/provider-live-scenarios.test.ts`.

## Secret scan

`assertNoSecretLeak` (from `@arnilo/prism/provider-kit`) ran over 13 files: this file, `live-matrix-report.{json,md}`, and the ten reports in `live-release-acceptance-0.13.0/`. The needles were all 12 values in the env file that are at least 8 characters long. Result: **no hit**.

## Task 10 release candidate (2026-11-11)

Candidate: `2cd2b553` (`chore(release): prepare seven-bundle 0.13.0 candidate`). The owner authorized committing the entire checkout, including memory-track changes, and required the existing cache-parity gate to pass. No metric waiver or threshold change was made. Credentials stayed in the existing private env file.

- **Cache parity: pass.** Strict `release/cache-parity`: one suite ran, zero skipped, zero failed; all four cells passed on their first attempt. [Gate](cache-parity/gate-2026-11-11.json), [matrix report](live-release-acceptance-0.13.0/task10-2026-11-11-cache-parity.json). Across both harnesses, the four cells used 176 requests within their existing per-cell ceilings. This supersedes the earlier `behind` blocker for this candidate only; it does not change the historical result.

  | Cell | Prism median hit rate | pi median hit rate | Verdict |
  | --- | ---: | ---: | --- |
  | Command Code chat | 0.794 | 0.733 | pass |
  | Command Code Responses | 0.868 | 0.737 | pass |
  | Command Code Messages | 0.726 | 0.685 | pass |
  | Ollama Cloud chat | 0.897 | 0.853 | pass |

- **Release journeys: pass.** Strict `release/journey-` with `PRISM_LIVE_RELEASE_JOURNEY=1`: both Command Code and Ollama Cloud ran, zero skipped, zero failed. [Matrix report](live-release-acceptance-0.13.0/task10-2026-11-11-journeys.json).
- **Providers: not green.** Strict `providers/`: four suites ran, five skipped, three failed. Command Code, Ollama Cloud and OpenRouter passed. Hyper returns 402 (no credits) and its Messages fixture model `qwen3.6-plus` returns 404. Kilo returns 402 (negative balance). OpenCode Go returns 410 for retired `mimo-v2.5`. [Matrix report](live-release-acceptance-0.13.0/task10-2026-11-11-providers.json).
- **OpenCode Go replacement check: still blocked.** With the existing `PRISM_LIVE_OPENCODE_GO_CHAT_MODEL=mimo-v2.6-flash` override, the vendor's stated replacement returns 429 (`GoUsageLimitError`, 5-hour limit). Its Messages route returns 400 (model unavailable). The suite has six passing and six failing tests; no default or model fixture was changed. [Matrix report](live-release-acceptance-0.13.0/task10-2026-11-11-opencode-go-replacement.json).
- **Carried scope:** TypeSafe, Liquid, Laya, local Liquid, Codex and LiteLLM remain under the 2026-11-08 owner scope above. Five matrix rows skip for missing prerequisites. LiteLLM is marked run by the matrix but its two tests skip; its pool is unavailable. This is not evidence that LiteLLM passed.
- **Owner scope amendment (2026-11-11):** ignore Hyper's blocked tests, test Kilo with a specific free model, and require OpenCode Go to pass. The owner subsequently confirmed OpenCode Go's five-hour limit had reset. The earlier failed runs above remain historical evidence, not passing runs.
- **Kilo free-model rerun: pass.** `nvidia/nemotron-3.5-super-vl:free` on Chat, Responses and Messages: 20 tests pass, three separate warm-prefix probes skip, zero fail. The strict matrix row runs with zero skipped suites. Includes the three kernel smoke sessions. [Report](live-release-acceptance-0.13.0/task10-2026-11-11-kilo-free.json). This is no claim about paid Kilo models or cache parity.
- **OpenCode Go after reset: pass.** Current catalog models `mimo-v2.6-flash` (Chat) and `qwen3.7-plus` (Messages): all 12 tests pass, zero skips/failures, including both warm-prefix probes. The existing model overrides select them; no default fixture was changed. [Report](live-release-acceptance-0.13.0/task10-2026-11-11-opencode-go-reset.json).
- **Scoped live verdict: pass.** Command Code, Ollama Cloud and OpenRouter passed in the original candidate provider run; Kilo and OpenCode Go pass in the follow-up strict runs. Hyper and the six previously scoped-out rows remain excluded by owner decision. Cache parity's four cells and both release journeys pass without a waiver.
- **Release status:** owner acceptance signature, clean final release-commit verification and bootstrap/trusted-publisher setup remain pending. No tag, publish, deprecation, provenance verification or Phase 11 Done record is claimed.
