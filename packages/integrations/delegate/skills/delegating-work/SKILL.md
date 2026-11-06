---
name: delegating-work
description: Load before using delegate. The child sees only your brief: put in the data it needs and no secret. Do one- or two-step jobs yourself, and check the child's answer before repeating it.
metadata:
  prism-requires-tools: delegate delegate_wait delegate_cancel
---

# Delegating work

- The child starts with only your brief (plus any context the status line says was forwarded). State the goal, the
  exact data or paths it needs, and what to return.
- Never put a secret, token, credential or key in a brief, even when it sits in the same file as the data the child
  needs. Copy only the lines it needs.
- Do a job of one or two tool calls yourself. Delegate a bounded job that would flood this conversation.
- Read the status line: `completed` is an answer; `suspended` or a limit stop means no answer or a partial one.
- Check a claim ("tests pass", "no other callers") with one cheap check before you repeat it.
- If the answer is thin, send a second brief that says what was missing. Do not resend the same one.
- Start only as many children as there are independent parts. Cancel one whose result you no longer need.
- A worktree status of `conflict` or `refused` means the child's branch was not merged: tell the user.
