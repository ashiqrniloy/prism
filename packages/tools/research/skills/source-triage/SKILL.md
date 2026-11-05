---
name: source-triage
description: Use after ledger lines appear on tool results. Decides which fetched sources belong in the report.
---

# Source triage

1. Read each `ledger: S<n>` line. That id is the only handle for the source.
2. Keep a source only when it bears on the scoped question.
3. Drop duplicates. The same URL keeps one id.
