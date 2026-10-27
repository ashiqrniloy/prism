# Plan 188.11 evidence (Phase 11 Part O11)

Offline-only evidence for the memory release readiness work. Every file here is derived from ids,
counts, rates and classes; no corpus or fixture text is stored.

| File | What it shows |
| --- | --- |
| `trust-scan.json` | Task 8's exchange-archive gate measurement: per suite (LongMemEval-S, LoCoMo) the unique exchanges scanned, refusals by class (prompt injection, exfiltration, invisible Unicode, secret), refusals per 1,000 and the questions whose needed session holds a refused exchange; plus detection recall per class over the 34-item adversarial fixture. No threshold is enforced; plan 202 owns the safety gate. |
| `trust-scan.md` | The same counts as a readable table. |
| `limitations.json` | Task 9's twelve known limitations of the conversational preset and OM: id, one-line statement, evidence path and the plan 202 task that owns it. |

Reproduce with:

```sh
timeout 900 bun scripts/memory-bench/trust-scan-audit.mjs --output docs/_evidence/memory-bench/188.11/trust-scan.json
```

The audit makes zero model calls and reads the pinned datasets from the existing memory-bench cache.
The measured false-refusal rate (2.271 per 1,000 on LongMemEval-S) is above the 1-per-1,000 line and
touches three needed sessions; `packages/memory/fabric/README.md` says so where an adopting host reads
it, and the preset stays opt-in.
