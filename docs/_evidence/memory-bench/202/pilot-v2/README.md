# Task 4.7 — preserved pilot v2

This corrected rerun preserves its frozen manifest and immutable results.
Eleven cells completed, two full-truncated cells were equivalent-policy repeats,
one preset ordering evaluation lost a terminal judge stream, and 38 remained
unstarted when the entry point stopped. No outcome is omitted.

[V3](../pilot-v3/README.md) is the versioned continuation: it validates unchanged
product, criteria, question set, answer configuration and judge templates before
reusing the eleven valid rows. It rejudges the saved failed answer and attempts
the remaining cells. Its manifest pins these exact v2 results by hash.

V2 consumed 53 wire attempts, 504,867 reported input and 61,817 reported output
tokens over 14.6 minutes. Missing usage retains the full journal reservation.
The final report includes those failed-call costs and the original outcomes;
there is no silent score replacement or refund. Private checkpoints are in
`.cache/memory-bench/audit/4.7-v2/`.
