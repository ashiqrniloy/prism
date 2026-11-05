---
name: delegating-work
description: Load before using delegate. A child sees only your brief, so put in the data it needs and never a secret; do a one- or two-step job yourself instead of delegating it; and read the child's status line (completed, suspended, limit) and check its answer before you repeat it.
metadata:
  prism-requires-tools: delegate delegate_wait delegate_cancel
---

# Delegating work

A child is a separate agent with its own turns and tools. It returns one answer, and you cannot talk to it while it
runs. Treat that answer as a report from a colleague: useful, and still yours to check.

## Delegate or do it yourself

- Delegate a bounded job whose steps would flood this conversation (a wide search, a review, an isolated change) or
  that fits a child's tools better than yours.
- Do it yourself when the job is one or two tool calls, when the next step depends on a decision you have not made,
  or when you would have to explain more than the job takes.
- Choose the child from the one-line descriptions in the `delegate` tool. If none fits, do not stretch one to fit.

## Write the brief

The child starts without your reasoning. Unless the host forwards part of this conversation (the result's status
line says so, for example `saw the last 6 turns`), the brief is all it has. Even then, do not rely on the forwarded
part to carry the task. State:

1. The goal in one sentence, and what "done" looks like.
2. The facts it needs: file paths, names, constraints, what you already tried and ruled out.
3. What to return: a verdict, a list, a diff summary. Ask for evidence (paths, line numbers, URLs), not narrative.
4. What it must not do, when that matters (no edits, no network, stay inside one directory).

Put nothing in the brief that the child should not hold. A child inherits only what the brief, the forwarded
context and its own packages carry. Never paste a secret, token, credential, passphrase or private key into a brief,
even when it sits in the same file as the data the child needs: copy only the lines the child needs, and point to
the file or setting by name instead.

## Run and read the result

- `sync` waits and returns the answer. Use `async` only when you have other work to do meanwhile, and then collect
  it with `delegate_wait` using the `delegationId`. Do not start an async child and then wait with nothing else done.
- The status line after the answer says how the child ended. `completed` is an answer. `suspended` means it needed a
  decision that nobody could give; it did not finish. A limit stop or an error means you have a partial result at
  best.
- A long answer ends with a `delegate_wait` offset hint. Read the next slice only if the part you have is not enough.
- Check a claim before you build on it or repeat it to the user, especially "tests pass" and "no other callers".
  Re-run the one cheap check yourself.
- If the answer is wrong or thin, send a second brief that says what was missing. Do not resend the same one.

## Avoid fan-out

- Start only as many children as the independent parts of the job. Split work only on parts that do not need each
  other's results.
- A child cannot delegate further, so do not plan around it doing so.
- Never delegate a job back and forth, or ask a child to supervise another. If two attempts fail, do the work
  yourself or tell the user what blocked it.
- Use `delegate_cancel` on a child whose result you no longer need.

## If the child works in a worktree

When the status line reports a merge, that is the outcome: `merged` landed on your branch; `conflict` or `refused`
kept the child's branch unmerged. Report either to the user rather than retrying silently.
