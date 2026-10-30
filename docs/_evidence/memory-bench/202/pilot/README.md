# Task 4.7 — superseded pilot v1 and historical completion probe

The primary v1 pilot stopped on a transient judge SSE `502`. Every requested
cell retains its disposition in `results.json`; no v1 score or answer is reused
in the fresh [v2 rerun](../pilot-v2/README.md). The original manifest and results
are preserved unchanged. The [completed report](../pilot-v3/README.md) records the versioned continuation and final scoring.

V1 consumed 72 wire attempts, 858,242 reported input
and 81,736 reported output tokens in 19.9 minutes. Two exchanges lack usage;
the durable journal retains its full 8.5M-token reservation, rather than
refunding it. Reported token totals are lower bounds.

A teardown error in the new entry point (`close` instead of `dispose` on judge
agents) occurred after saving results and reconciling the journal. The process
exited; the v2 entry point repairs cleanup and transient SSE retry handling.
V2 also retains non-text trace events so long text streams cannot crowd out
terminal or tool-call events. Primary cells are rerun under a new frozen hash,
with original call/token/wall allowances reduced by v1's observed use. Final
accounting must include conservative bounds for unreported usage.

`completion.json` is the separate, predeclared subscription probe, under this
v1 manifest: 48 attempts, 2M input, 100K output tokens and 30 minutes, serial.
It used 11 wire attempts and reported 232,530 input / 2,193 output tokens.
Beam reproduced an eight-turn run limit with eight recalls and no answer;
the final five recorded argument sets are identical. Successful recall-result
headers and hits are present in subsequent model requests. No answer retry
occurred. This is a genuine model/product completion failure under the fixed
stop, not missing tool-result delivery or a harness retry loop.

MiniMax's route returned a monthly `GoUsageLimitError`; three transport attempts
produced no model answer. Its historical one-of-forty run limit (eight turns,
21 tool calls) remains historical evidence, not a current reproduced diagnosis.
The probe retains both dispositions and both full journal reservations.
No alternate paid provider or raised turn budget was used.

`historical-completion.json` links the immutable original seven-cell evidence
by hash. `trace-diagnosis.json` contains bounded count/hash classifications,
never source, query or answer text. The v1 trace truncates after 64 events, so
some terminal/tool-call events are absent; replay metrics and final outcomes
remain authoritative. V2 records non-text events instead.

Private traces and answers stay under `.cache/memory-bench/audit/4.7/`.
The judge panel is development-only and not human calibrated under the owner's
waiver. Neither this attempt nor the historical probe establishes acceptance
or a lever decision. Task 4 and readiness Task 4.8 remain separate.
