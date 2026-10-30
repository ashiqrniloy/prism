# Laguna compatibility probe — 2026-10-29

**Verdict: partial pass; not ready to replace Glyph.** Model: `commandcode/poolside/laguna-s-2.1-free`. No campaign was resumed or changed. All probes assert that the baseline manifest, summary, campaign journal and resume manifest remain byte-identical.

| Check | Result |
| --- | --- |
| Imported assistant history, Chat | Pass: recovered the supplied synthetic token without imported reasoning traces. |
| Complete development history, Chat | Pass: accepted all 238 messages (119 assistant), removed none, and produced the requested confirmation. Raw input: 153,772 tokens. No benchmark question was scored and no gold/annotations were supplied. |
| Tool call and result handling | Blocked: upstream refused generation. Zero tools executed. |
| Follow-up recall and stopping after a tool | Unverified: no successful tool exchange exists. |
| Imported history, advertised Responses route | One HTTP 429; one completed response failed the synthetic token-recall check. Cause undiagnosed. |

Eleven physical requests across both routes produced three successful generations and eight HTTP 429 responses stating that the upstream model provider was temporarily unavailable. This is an availability finding, not evidence that Laguna cannot call tools. Each diagnostic declaration precedes its calls; 429 retries are disabled. Requests used temperature zero, 2,048 output tokens, provider-default reasoning and at most eight turns. Private prompts/results and wire logs remain in `.cache/memory-bench/audit/laguna-*`; public reports contain counts and configuration only.

One preliminary large-history attempt hit the kernel's default cumulative input limit. The final local probe matches the benchmark's disabled cumulative input/total limits while retaining the model's 256,000-token context bound, per-wire reservations, output, turn and wall bounds. The final history request passed. No repository implementation was changed.

**Accounting finding:** successful Chat wire records contain real `rawUsage.prompt_tokens` / `completion_tokens`, but the normalized counters are zero. Across all three successful generations, raw records report **153,940 input / 41 output / 64 cache-read tokens**. The original normalized reports are retained as evidence and must not be treated as measured consumption. The diagnostic retains conservative bounds of **2,816,000 input / 22,528 output tokens**, with no refund. A usage-normalization correction and regression proof are required before activating this route in the baseline.

[Reconciled summary and source hashes](laguna-compatibility-summary-2026-10-29.json) lists every attempt. No held-out request, judge request, paid fallback, accuracy comparison or final lever claim occurred. Existing Task 4 results remain intact.

Next: retry only the bounded Chat tool/follow-up checks when upstream capacity is available, reconcile usage normalization, then reassess readiness. The existing OpenRouter judge-quota blocker remains independent of Laguna.
