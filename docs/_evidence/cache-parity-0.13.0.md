# Cache parity, 0.13.0 first run (plan 215 Task 24)

Date 2026-11-08. Prism commit `bc87e539` plus the uncommitted working tree (the in-flight 0.13.0 work, this task's fixes below, and the memory-track changes; the parity runs use the reference host's default coding worker, which loads no memory package). Reference harness: pi **1.5.0** (`@earendil-works/pi-coding-agent`) with `pi-commandcode-provider` **0.8.0** and `pi-ollama-cloud` **0.13.1**. Kilo CLI **7.8.18**. Runner: `scripts/cache-parity/live.mjs` (manifest row `release/cache-parity`), gate logic `parityGate` in `scripts/cache-parity/metrics.mjs`. Every run is kept under `docs/_evidence/cache-parity/`.

## Verdict

**The gate passes on the final code: all four enabled cells are `pass`** (Prism's median `hitRate` ≥ pi's, no `usage_mismatch`, no `inconclusive`). The first run did **not** pass; it found three defects, listed under "Findings", which are fixed and re-measured. Per the owner amendment (2026-11-08) Command Code and Ollama Cloud do not gate 0.13.0 (plans 205 and 206 gate their own releases); the three defects were in the reference host, the wire proxy, and shared kit usage mapping, so they are fixed here.

| Cell | Model | Verdict | Prism hitRate median (range) | pi hitRate median (range) | First-turn-excluded (Prism / pi) | Requests per run, median (Prism / pi) | Solved (Prism / pi) | Requests used | Report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Command Code chat | `minimax/minimax-m3.1-flash` | **pass** | 0.848 (0.843–0.883) | 0.779 (0.756–0.814) | 0.908 / 0.852 | 10 / 6 | 3/3 / 3/3 | 49 of 120 | `commandcode-minimax-minimax-m3.1-flash-2026-11-08-2` |
| Command Code Responses | `gpt-5.6-luna` | **pass** | 0.836 (0.789–0.864) | 0.739 (0.737–0.769) | 0.907 / 0.814 | 8 / 5 | 3/3 / 3/3 | 40 of 120 | `commandcode-gpt-5.6-luna-2026-11-08-3` |
| Command Code Messages | `claude-haiku-5-5` | **pass** | 0.742 (0.695–0.790) | 0.680 (0.676–0.683) | 0.879 / 0.810 | 5 / 4 | 2/3 / 3/3 | 28 of 120 | `commandcode-claude-haiku-5-5-2026-11-08-3` |
| Ollama Cloud (native route) | `gemma4:31b` | **pass** | 0.866 (0.844–0.891) | 0.860 (0.813–0.901) | 0.947 / 0.908 | 9 / 6 | 3/3 / 3/3 | 50 of 120 | `ollama-cloud-gemma4-31b-2026-11-08-2` |

How to read it:

- The Ollama Cloud cell passes by 0.006 and the two ranges overlap; call it parity, not a lead. The other three lead by 0.06–0.10.
- Prism sends **13 tools** and pi sends 4 (the shipped coding worker's own prefix). Prism's runs take more requests (the larger tool surface and its longer loop), which is why its inclusive rate is not directly a "per prompt" comparison; the first-turn-excluded column is the warm-prefix view.
- Messages: one of Prism's three runs did not solve the task. Two of three is the comparability floor, so the cell is conclusive, and the median is over the two solved runs.
- Requests used against the 120-request ceiling per cell: 28–50 (Task 23's per-run ceiling of 20 was never reached). The whole sequence of runs below, valid and invalid, used 38 + 47 + 24 + 49 + 38 + 24 + 40 + 28 + 49 + 50 = 387 requests in total across both harnesses.

## Every run, in order

Two further reports from the first run are **invalid for the reasons below** and are kept as the record, not as results.

| Run | Report | Cell | Result | Why it is or is not a result |
| --- | --- | --- | --- | --- |
| 1 | `commandcode-minimax-minimax-m3.1-flash-2026-11-08` | chat | pass (Prism 0.867, pi 0.783) | Valid. Superseded by run 4 on the final code. |
| 1 | `commandcode-gpt-5.6-luna-2026-11-08` | Responses | `usage_mismatch` | **Invalid.** Prism ran over `/chat/completions` (finding 1) and the proxy read both harnesses' cache counts as 0 (finding 2). |
| 1 | `commandcode-claude-haiku-5-5-2026-11-08` | Messages | `behind` (Prism 0, pi 0.677) | **Invalid.** Prism sent no `cache_control` marker (finding 1). |
| 1 | `ollama-cloud-gemma4-31b-2026-11-08` | Ollama Cloud | pass (Prism 0.894, pi 0.874) | Valid. Superseded by run 4 on the final code. |
| 2 | `commandcode-gpt-5.6-luna-2026-11-08-2` | Responses | pass (0.850 vs 0.735) | **Invalid as a Responses result.** Proxy fixed (finding 2) but Prism still ran over Chat; it measured the Chat wire against pi's Responses wire. |
| 2 | `commandcode-claude-haiku-5-5-2026-11-08-2` | Messages | `behind` (0 vs 0.677) | **Invalid.** Prism still sent no marker; the driver's catalog merge did nothing because the host dropped the fields (finding 1). |
| 3 | `commandcode-gpt-5.6-luna-2026-11-08-3` | Responses | pass | **Final.** Recorded bodies: Prism posts to `/provider/v1/responses` with one stable `prompt_cache_key` per run. |
| 3 | `commandcode-claude-haiku-5-5-2026-11-08-3` | Messages | pass | **Final.** Recorded bodies: `cache_control` on `system[0]` and the last message block, none on tools, no `ttl`; the same placement as pi. |
| 4 | `commandcode-minimax-minimax-m3.1-flash-2026-11-08-2`, `ollama-cloud-gemma4-31b-2026-11-08-2` | chat, Ollama Cloud | pass, pass | **Final.** Re-measured on the final code because the host and driver changes also reach these cells. |

Gate summaries: `gate-2026-11-08.json` (run 1, fail), `-2` (fail), `-3` (pass), `-4` (pass). No `inconclusive` verdict occurred, so no cell needed its one rerun.

## Findings (investigated before any change, `investigate-first`)

1. **The reference host dropped `compat` and `cache` from a config model object** (`apps/prism-agent/src/host/config.ts` `modelRef`). `parseModelRef` keeps every field a model object carries, and Command Code reads the wire from `compat.route` and places `cache_control` only when `cache.kind` is `cache_control`. Without them `gpt-5.6-luna` ran on Chat instead of Responses and `claude-haiku-5-5` ran with no marker, so Prism's Messages hit rate was 0 and its Responses cell compared two different wires. Evidence: the recorded exchange paths and marker lists (`/chat/completions`, `markers: []`) before the fix, and `/responses` plus markers on `system[0]` and the last block after. Fix: `modelRef` passes `compat`, `cache` and `capabilities` through; the runner's driver copies them from the provider's static catalog (`scripts/cache-parity/host-model.ts`). Test: `host_config_keeps_model_compat_and_cache`, `driver_copies_wire_and_cache_fields_from_the_catalog`. This is a reference-host defect, not a kernel or provider one; a host that builds model objects from a catalog is unaffected.
2. **The wire proxy misread two usage shapes** (`scripts/wire-proxy.mjs` `normalizeUsageMetrics`). Command Code Chat puts `cache_creation_input_tokens` at the top level of `usage`, next to `prompt_tokens`; the proxy took that as the Anthropic shape (exclusive `input_tokens`) and under-counted the prompt by the uncached remainder (3274 vs 3277). OpenAI Responses (`input_tokens` inclusive, cache counts under `input_tokens_details`) was also taken as Anthropic, so every Responses request showed 0 cache read and 0 cache write for both harnesses. Fix: detect `prompt_tokens` first, then `input_tokens_details`, then the Anthropic shape. Test: `usage_metrics_read_each_wire_format_inclusively`. The two cells that passed in run 1 (Command Code chat, Ollama Cloud) use shapes the old code already read correctly, and the final run reproduced them.
3. **Prism's usage mappers ignored cache writes on two OpenAI wires** (`src/provider-kit/openai-primitives.ts` `mapOpenAIChatUsage`, `src/provider-kit/codecs/openai-responses.ts` `mapOpenAIResponsesUsage`). Command Code reports writes as a top-level `cache_creation_input_tokens` on Chat and as `input_tokens_details.cache_write_tokens` on Responses; Prism reported `cacheWriteTokens: undefined`, which the cross-check (correctly) flags once the proxy reads them. Writes are a subset of the inclusive `input_tokens` (measured: input 3045, cached 3042 on a warm request, write 3042 on the cold one), so `inputTokens` was already right and only the write count (cost and telemetry) was missing. Fix: both mappers read the write count. Tests: `chat_usage_reads_a_top_level_cache_creation_count`, `responses_usage_reads_cache_write_tokens_as_a_subset_of_input`. No export changed (internal mapper bodies): `bun scripts/release.mjs gate` does not list either mapper. The gate is red for other in-flight edits (see the task note), not for this task.

Plan 182 (the kit's usage contract) and plan 205 (Command Code) are the owning plans. Both were reopened with a one-line note in this task's notes rather than re-executed: the contract (inclusive `inputTokens`, cache counts as subsets) is unchanged, and two mappers learned a vendor field.

Levers compared with pi's (Task 21 (e)), now measured on the wire: Responses `prompt_cache_key` is constant across a run on both sides (Prism's `session_<uuid>`); Messages markers are on the system block and the last message block on both sides, none on tools, no `ttl`; the chat and Ollama Cloud routes send no cache lever on either side.

## Probe cells (carried status)

Probe cells are re-run only if their provider's lever code changed after the recorded run. The commit log is bulk WIP so it cannot prove "unchanged", but this task's only shared-kit edits are two usage-mapper bodies (no request lever), so no probe was re-run. Command Code and Ollama Cloud are now covered by the full coding-task cells above, which supersede their probes.

| Cell | Status | Evidence |
| --- | --- | --- |
| OpenAI Codex (sanctioned route) | Prism probe reuse 0.983. The pi side is `unmeasured` while `pi auth check --provider openai` is `not_ready`. | `docs/_evidence/cache-probe/openai-codex-gpt-6.1-sol-2026-10-25.json` |
| OpenAI Codex (first-party) | Prism leads in every measured shape (0.981 vs 0.481–0.842). | `docs/_evidence/cache-probe/codex-cli-turn2-2026-10-25.json` |
| Command Code Chat / Responses / Messages | Measured in full above; probes 2026-10-27 superseded. | `docs/_evidence/cache-probe/commandcode-*-2026-10-27.json` |
| Ollama Cloud | Measured in full above; four-request probe also passed on both routes. | `docs/_evidence/206-task3-cache-parity.md` |
| Kilo Chat / Responses / Messages | Prism probe on the free model: Chat and Responses 0.506, Messages 0.337. The paid Responses and Messages cells are `unmeasured` (402 on the reference account). | `docs/_evidence/cache-probe/kilo-nvidia-nemotron-3.5-super-vl-free-*2026-10-31.json` |
| Kilo CLI headless reference (owed) | **Run once, 2026-11-08, free-model Chat: reuse 0.858** (cache reads 21 680 on a 25 267-token first request, then 25 350, 25 432, 25 516). | `docs/_evidence/cache-probe/kilo-cli-headless-nvidia-nemotron-3.5-super-vl-free-2026-11-08.json` |
| LiteLLM | No cell (owner decision 2026-10-31): information-only probe. | `docs/_evidence/litellm-live-2026-11-01.md` |

**The Kilo CLI number is not a parity claim.** The CLI sends its own system prompt and 24 tools, so its first request is 25 267 tokens against the probe fixture's 8 570, and the upstream's cached share rises with prefix size (4 336 of 8 570 for Prism's probe, 21 680 of 25 267 for the CLI; both constant across turns 2–4). The two reuse ratios (0.506 and 0.858) are therefore not comparable. A same-prefix comparison needs Prism's coding worker on the same fixture and was not run; nothing here says Prism is ahead of or behind the Kilo CLI. Kilo is not part of this task's enabled gate, and the paid Responses and Messages cells stay `unmeasured`.

## Deferred cells (post-0.13.0)

Recorded as `deferred`, never as failures or passes (`parityGate` skips them):

| Cell | Reason |
| --- | --- |
| Hyper Chat / Messages | No Hyper credits (HTTP 402). Task 21's note has pi's facts. |
| OpenCode Go Chat / Messages | Monthly limit reached (429) and `mimo-v2.5` deprecated (410). |
| OpenRouter Anthropic (`anthropic/claude-haiku-4.5`) | `unmeasurable` until the owner authorizes paid use and sets `PRISM_LIVE_OPENROUTER_PAID=1`. |

## Reproducing

```bash
PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live
# one or two cells after a fix:
PRISM_LIVE_PARITY_CELLS=commandcode/responses,commandcode/messages PRISM_LIVE_STRICT=1 bun scripts/cache-parity/live.mjs
```

Both need `~/.config/prism/live.env` (`COMMAND_CODE_API_KEY`, `OLLAMA_API_KEY`), `pi` on `PATH` with the two extensions installed, and `PRISM_LIVE_PROVIDER_TESTS=1`. `~/.pi/agent` was signature-checked around every run and never changed; no key value appears in any stored report (scanned before write).
