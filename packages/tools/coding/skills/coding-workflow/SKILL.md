---
name: coding-workflow
description: Load before changing code in a workspace. A failing check you did not cause is reported, not fixed; deleting or rewriting files that something still uses needs the user's word; a check counts only if it ran. Covers locating the code, the smallest diff, verifying, and reporting what ran.
metadata:
  prism-requires-tools: read edit
---

# Coding workflow

1. **Locate.** Find the code before you open files: search for the symbol or message, then `read` the match and the
   code around it. Read a neighbouring test so the change follows the file's conventions.
2. **Change.** Make the smallest diff that works. Do not reformat, rename, or fix unrelated code; mention it instead.
   Use `edit` for existing files. After a miss, `read` the file again and copy the text; do not guess it.
3. **Verify.** Run the narrowest check that fails if the change is wrong (the one test, then the package's type or
   lint check). A check counts only if it ran.
4. **Report.** Say what changed, what you ran and the result, and what you did not verify.

## When it goes wrong

- The same fix fails twice: stop, re-read the error and the code, and change the hypothesis before the next edit.
- A check fails in code you did not touch: confirm it fails without your change, then report it. Do not fix it unasked.
- A decision belongs to the user (a public API, a dependency, a destructive change): ask before you act.
- Before you delete or rewrite files, search for what still uses them (`grep` the name). If anything does, do not
  delete: tell the user what depends on it and what you would remove instead.

## If `grep` or `glob` is available

- Search by literal with `grep` before you read whole files. Use `glob` for file names.

## If `shell` is available

- Use it for builds, tests, and git, not for jobs the file tools already do.
- Do not run a destructive command (`rm -rf`, a hard reset, a force push) unless the user asked for it. An approval
  prompt is not a reason to try one.

## If `shell_output` is available

- Start anything long-running (a server, a watcher, the full suite) with `background: true`. Poll with
  `shell_output` and a wait, and kill the process when you are done.

## If `coding_check` is available

- Prefer it to a raw shell command for the checks the project declares.

## If `diagnostics` is available

- Run it on each file you edited in a language that has a server, before the wider check.

## If `git_diff` is available

- Read your own diff before you report. Keep the diff to the task.

## If `git_commit` is available

- Commit only when the user asked for it, and describe the change, not the process.

## If `todo_write` is available

- For work of three or more steps, keep the list current: one item in progress, finished items marked at once.

## If `ask_user_decision` is available

- Use it for a choice with real trade-offs. Give each option its pros and cons.
