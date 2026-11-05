---
name: research-report
description: Use when writing the report. Every factual claim cites a ledger id with a marker from the cite tool.
metadata:
  prism-requires-tools: cite
---

# Research report

1. Call `cite` with a ledger id. It returns `[[cite:<id>]]` when that id was fetched, and `unknown_source` otherwise.
2. Put that marker next to the claim. Do not invent a marker or an id.
3. A marker the ledger does not hold fails the citation check.
