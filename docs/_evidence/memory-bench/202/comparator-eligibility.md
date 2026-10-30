# Task 4.2 comparator eligibility correction

Executed 2026-10-28, offline. No answer or judge calls were purchased.

The original BEAM cells labelled `full` and `full-truncated` both capped input at
134,976 tokens and truncated 36 of 40 questions. Their shared selection policy
makes them equivalent-policy repeats. Neither the accuracy difference nor the
zero-score abilities prove degradation under complete-history delivery. Original
reports and summaries remain preserved under
[exploratory-original-2026-10-28](exploratory-original-2026-10-28/PROVENANCE.md).
No historical score has been corrected or promoted to acceptance.

The harness now rejects a `full` request locally when selecting its actual dated
messages would remove history. It records `comparator_ineligible` without a
verdict or answer/judge call. `full-truncated` keeps the bounded selection and
records removed source messages, all removed messages, estimated tokens removed,
and a hash of the selected context. System blocks, the final question, output
reservation and request headroom remain protected. Reports include effective
input cap, policy, model limits and generation parameters; no credentials or
source text are added to evidence. Comparator policy versioning prevents reuse
of old truncating `full` checkpoints.

Baseline reporting retains ineligible counts, excludes unproven/incomplete `full`
cells from comparator gaps, and marks identical rendered-context executions on
the same model configuration as repeats rather than independent treatments.
Completeness is local request evidence: character estimates do not establish
provider token counts, and provider errors do not establish successful delivery.

Regression coverage: oversized full history makes zero provider calls; the
bounded arm records the source removal; matching contexts share a hash; historical
or incomplete full-history cells cannot produce acceptance gaps; equivalent arms
are marked as repeats; old policy checkpoints cannot resume; unscored ineligible
rows have no accuracy. Task 4 remains paused for Tasks 4.3–4.8.

Verification: `timeout 900 bun test --timeout=0 scripts/memory-bench` passed
(290 pass, 2 environment-dependent skips, 0 fail). Offline CLI smoke and Biome
checks passed; Biome retains an existing unused-parameter warning in
`run.test.mjs`. Workspace typecheck was attempted and failed on the existing
Hyper `models.ts:172` TS2345 (`number | undefined` passed as `number`), also
surfacing through credentials-keyring and prism-agent. No public export changed.
