# Original exploratory run, preserved 2026-10-28

This archive preserves the original Task 4 baseline directory before Task 4.1
changed BEAM normalization. The seven completed reports, two incomplete reports,
their Markdown renderings, manifest and derived summary are byte-for-byte copies.
`provenance.json` records the SHA-256 and byte size of every original file, plus
the seven completed cells' protocol provenance. The regression test verifies them.

These are exploratory results under the original protocol, not corrected-protocol
or BFC/Robust acceptance evidence. The original adapter discarded BEAM source
annotations; literal answer matching left most questions `gold_unknown`. The
original reports also lack `runPathFingerprint` (recorded as null in provenance);
their recorded `protocolHash`, source revision, criteria hash, judge panel and
generation remain in the archive. The recorded source revision does not attest
the dirty working tree's exact source bytes. No missing historical hash is inferred.

The Beam `full` and `full-truncated` cells both used a 134,976-token cap and
truncated 36/40 questions. They do not establish a complete-history comparison.
Existing lever summaries are historical and must not decide later product work.
No score or stage has been recomputed here.

Task 4.1's corrected development inventory is in
[`../beam-source-inventory.json`](../beam-source-inventory.json): 40 questions,
36 non-abstention, 120 resolving references (118 unique message references,
98 round references), rubrics on all 40, zero unknown mappings. Duplicate source
references remain recorded; the evidence set deduplicates them. The inventory
contains ids and counts only. Rubrics and source text remain in private dataset
and audit storage. No held-out text was examined and no provider call was made.
