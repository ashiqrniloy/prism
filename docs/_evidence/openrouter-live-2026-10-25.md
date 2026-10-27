# OpenRouter live evidence — 2026-10-25

Plan 203 (`plans/203-Phase-11-Part-AA-OpenRouter-Provider.md`) Task 7, partial: the free tier was
proven end to end; the paid Anthropic cache leg is **blocked on account credits** (see below).

## Environment

- `~/.config/prism/live.env`, mode `0600`, holds `OPENROUTER_API_KEY`, `OPENCODE_GO_API_KEY`, and
  `PRISM_LIVE_PROVIDER_TESTS`; no key, account id, or key label is reproduced here.
- Pinned models after this run: free `recursive/flint-v1.0:free`, cache `anthropic/claude-haiku-4.5`.
- Account state at the end of the run: key `is_free_tier: false`, key spend cap `$50` with
  `$49.94` remaining, account credits `total_credits: 25`, `total_usage: 25.122` (overdrawn).
  Free-model quota counters: `261 / 1000` daily requests used, `739` remaining.
- Spend this run: `$0.0598` (two successful cache turns plus two diagnostic requests), inside the
  approved `< $0.10` envelope. Request counts: 12 free, 8 paid attempts.

## Defect found and fixed (free tier)

`listOpenRouterModels` used the shared 64 KiB response-body cap. The live catalog now carries 466
models and is far larger, so discovery failed with `ProviderTransportError: Response body exceeded
65536 bytes` and every live scenario failed before its first completion.

- Fix: `packages/providers/openrouter/src/models.ts` raises only the catalog read to 4 MiB
  (`OPENROUTER_CATALOG_BYTES`); completions keep the default 64 KiB cap.
- Regression test: `openrouter_catalog_over_request_body_cap_still_parses` builds a 470-entry,
  > 64 KiB catalog and asserts all entries parse. Package suite: 20 pass.

## Free-tier live run

`PRISM_LIVE_FILTER=providers/openrouter bun run test:live` — **1 ran, 0 failed**
(`docs/_evidence/live-matrix-report.md`). Scenarios on `recursive/flint-v1.0:free`, served by
`Recursive`:

| scenario | result | usage |
|---|---|---|
| text | pass | 49 in / 60 out |
| tool-loop (2 turns) | pass | 160/67 then 245/58, thinking replayed |
| structured output (`json_schema`) | pass | 12 in / 672 out |
| abort before first request | pass | no request |
| error response leak scan | pass | invalid request rejected |

Paid cache scenarios skip without `PRISM_LIVE_OPENROUTER_PAID=1`, as designed.

Model repin: the earlier default `google/gemma-4-31b-it:free` returned HTTP 429
"temporarily rate-limited upstream" from Google AI Studio's shared free pool on every attempt at
2026-10-25 08:00–08:20 UTC (also 429 for `google/gemma-4-26b-a4b-it:free`). Prism surfaced that
correctly as `run.failed` with the redacted upstream message. Because the pinned model is a
reasoning model, the live suite now allows 768 output tokens for the free suite (128 truncated JSON
answers); the paid cache suite keeps 128.

## Cache probe

Pinned free model, `provider-probe.mjs --turns 4`, with and without the session key:

| run | requests | stable prefix | reuse | evidence |
|---|---|---|---|---|
| affinity on | 4 | 8406 tokens | `0` (measured) | `docs/_evidence/cache-probe/openrouter-recursive-flint-v1.0-free-2026-10-25.json` |
| affinity off | 4 | 8406 tokens | `0` (measured) | `docs/_evidence/cache-probe/openrouter-recursive-flint-v1.0-free-without-session-2026-10-25.json` |

Both runs report `cacheReadTokens: 0` and `cacheWriteTokens: 0` on every turn. This free pool
advertises no cache pricing in `/models`, so it is a zero-reuse subject; it does not demonstrate
or contradict Prism's `cache_control` levers. The Task 5 implicit-cache threshold (`> 0`) is
therefore **not met by the free pool** and cannot be met by choosing another free model today: no
zero-priced catalog entry advertises `input_cache_read`/`input_cache_write`.

## Paid Anthropic cache leg — deferred (owner decision 2026-10-25)

`PRISM_LIVE_OPENROUTER_PAID=1 PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/openrouter`:

- At 08:14 UTC the two-turn cache probe **passed** on `anthropic/claude-haiku-4.5`: turn 1
  `{read: 0, write: 21604}`, turn 2 `{read: 21604, write: 0}` (reuse 1.0, above the Task 5 paid
  threshold of 0.9). Prism sent `cache_control: {type: ephemeral}` on the stable-prefix message
  (confirmed from the serialized body) and no `prompt_cache_key`.
- Every later paid attempt failed with HTTP 402 from OpenRouter's credit cashier:
  - `Prompt tokens limit exceeded: 19347 > 15535` (cap shrinks with the credit balance),
  - then `This request would exceed your available credits given your current in-flight requests`.

  The account has no credits left (`total_usage` now exceeds `total_credits`); the key's `$50`
  cap is not funded. Smaller prefixes still fail once the balance is negative, so the paid cache
  row cannot pass until the owner adds credits (or raises the funded balance).
- The suite reports such a turn as `{read: 0, write: 0}` rather than a Prism defect: OpenRouter
  answers the streamed request with an error frame, so no usage is reported and the scenario's
  warm-turn assertion fails. That is the intended fail-closed behaviour, not a silent success.

## Leak scan

`bun scripts/scan-secrets.mjs` over the repository is clean, including this file and the two probe
reports: no key, bearer value, account id, or `user_id` appears in any artifact. Redacted upstream
error text is quoted without credentials.

## Status

Free tier: complete (suite, defect fix with regression test, probe with and without affinity). Paid tier:
deferred to the separately gated `PRISM_LIVE_OPENROUTER_PAID=1` runs in the matrix row, plan 184's
parity cell, and plan 186's acceptance run. It is not waived: those runs use this same suite and
probe unchanged once the account is funded. One earlier pass (turn 1 write 21604, turn 2 read 21604)
was observed but not archived, so the paid cache figures are supporting, not conclusive, evidence.
