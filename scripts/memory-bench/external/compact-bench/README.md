# Compact-Bench adapter (plan 218.1)

Pinned fetch, frozen draw, Prism-as-summarizer adapter, the `seam.py` shim into upstream's own scoring and task
runner, and the OpenCode Go pass-through for the lean screen. Upstream is untrusted code: it lives in
`~/.cache/prism/compact-bench/code-<commit>` and runs with `python3 -I`; nothing upstream is vendored here.

Usage, pins and validation results: `scripts/memory-bench/README.md`, section "External suite: Compact-Bench".
Tests: `bun test scripts/memory-bench/external` (the upstream-parity parts run when the pinned checkout is present).
