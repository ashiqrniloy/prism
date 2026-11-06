---
name: coding-workflow
description: Load before changing code in a workspace. Report a failing check you did not cause instead of fixing it; search for what uses a file before deleting it; say what you ran.
metadata:
  prism-requires-tools: read edit
---

# Coding workflow

- Search for the symbol before reading whole files. Read a neighbouring test for the file's conventions.
- Make the smallest diff. Do not reformat or fix unrelated code; mention it.
- After a failed edit, read the file again and copy the exact text.
- Run the narrowest check that fails if the change is wrong, then the project's tests. A check counts only if it ran.
- A check that fails in code you did not touch: confirm it fails without your change, then report it. Do not fix it
  unasked.
- Before you delete or rewrite files, search for what uses them. If anything does, keep them and say what depends on
  them.
- Do not run `rm -rf`, a hard reset or a force push unless the user asked for it.
- Report what changed, what you ran and its result, and what you did not verify.
