# Prism 0.13.0: no independent completion validation, and `agentNode` worktrees cannot be reused across retries

Host report for `@arnilo/prism-extensions@0.13.0` (with `@arnilo/prism-tools@0.13.0`), requesting fixes in **0.13.1**. Filed by Clay (consumer) on 2026-11-12.

The consumer use case is an **AI Factory**. Each task runs as one workflow over one task session:

1. a worker `agentNode` runs in a git worktree on the branch `factory/<task-id>`;
2. a deterministic checks `gateNode` runs;
3. a validator `gateNode` judges completion;
4. on failure, a back edge returns to `work`, at most twice.

The user watches that one task session live in the UI. Retries must continue in the same session and the same worktree.

The worker runs with every policy limit set to `null` (tasks may run for hours), so retries are bounded only by the workflow's `maxIterations`.

---

## Issue 1: `advisor` validation always shows the validator the worker's own account

### Symptom

Advisor validation cannot be made independent of the worker. Both engines are fed the worker's own account of the work. The `model` engine also gets the conversation.

- `advisor/src/validate.ts`, `validateWithModel` builds its prompt from:
  - `TASK`;
  - `ACCEPTANCE CRITERIA`;
  - `FINAL ANSWER` (the worker's last assistant text);
  - `CONVERSATION`, which is `selectTranscript(payload.history, …)`.
- `validateWithChild` drops the transcript but still passes `FINAL ANSWER`. It runs the child through `delegate` on the worker's session, so the child shares that session's tools, roots and worktree routing.
- The validator exists only as a `run.end` hook (`registerValidation`) inside the worker's own run. It cannot run as a workflow `gateNode`, and it cannot be called with evidence the host assembles itself.
- `AdvisorValidateConfig` has no option to turn off `transcript` or `finalAnswer`. The only knob is `context` (`lastTurns` / `maxChars`), which sizes the transcript slice but cannot remove it.

### Why it matters

A validator that reads the worker's narrative ("I fixed the bug and all tests pass") judges the claim, not the change. That is the failure mode the validator is meant to catch.

- The host needs the validator to see only (a) the task's acceptance criteria and (b) evidence the host assembles itself: the worktree diff and the check output.
- Independence has to be structural, so a test can assert it where the input is built. Prompt discipline is not enough.

Today the host must build a second agent, a `report_verdict` tool, a verdict parser and the fail-closed rules. All of that already exists in `advisor/src/verdict.ts` (`COMPLETE_JSON_INSTRUCTION`, `parseCompletionVerdict`, fail-closed reason codes).

### Requested in 0.13.1

1. **A standalone validation call** that a workflow `gateNode` can use. It should be exported as a function, as an `advisor` service method, or both:

   ```ts
   import { validateCompletion } from "@arnilo/prism-extensions/advisor";

   const verdict = await validateCompletion({
     model,                     // a ModelRef (a different model from the worker's is recommended)
     task: task.description,    // host text
     criteria: task.criteria,   // host text
     evidence: [                // host-assembled, bounded; nothing is read from any session
       { label: "DIFF", text: diffText, truncated },
       { label: "CHECKS", text: checkTail },
     ],
     signal,
   });
   // { verdict: "complete" }
   // | { verdict: "incomplete"; missing: string[] }
   // | { verdict: "error"; reasonCode: "model_error" | "unparseable_verdict" | … }
   ```

   - It needs no session, history or final answer, and it has no tools.
   - It keeps today's guarantees: one model call, fail closed (no `complete` without a parsed verdict), and bounded `missing`.
   - Evidence is size-capped, and a cut is labelled in the prompt.

2. **Input switches on the `run.end` validator**, so in-run validation can be independent too:

   ```ts
   advisor({
     model,
     validate: {
       criteria,
       inputs: { transcript: false, finalAnswer: false },  // the default stays true/true, which is today's behaviour
       evidence: async (payload, session) => [{ label: "DIFF", text: await diffFor(session) }],
     },
   });
   ```

   With the child engine, `inputs.finalAnswer: false` removes `FINAL ANSWER` from the brief.

3. **Docs.** `advisor/README.md` → validate should state exactly what each engine sees, and document the standalone call as the way to validate in a workflow gate.

### Acceptance tests

- `validateCompletion` with a recording provider: the request contains the task, the criteria and each evidence block, and none of the session text.
- `inputs: { transcript: false, finalAnswer: false }`: the recorded model prompt has no `CONVERSATION` and no `FINAL ANSWER` section, and the child brief has no `FINAL ANSWER`.
- Garbage model output gives `error(unparseable_verdict)`, never `complete`.
- Evidence over the cap is truncated and the prompt carries the marker.
- Defaults unchanged: existing `validate` tests pass untouched.

---

## Issue 2: `agentNode({ worktree })` opens a new worktree on every execution and cannot name the branch

### Symptom

`workflows/src/nodes/agent-node.ts`:

```ts
// Set only by `resumeWorkflow` for a node the process died inside; a retry in one run opens a new session.
const priorWorktree = durable?.nodeState.resumeSession ? durable.nodeState.worktree : undefined;
…
} else {
  worktree = await workspace.worktree.create({ sessionId: session.id });
}
```

- **New worktree per execution.** Each time the node runs, including every back-edge iteration from a failing `gateNode` in the same run, it calls `worktree.create`. The work from the previous attempt sits in a different worktree. The retry starts from `HEAD` and loses it.
- **A supplied session doesn't help.** With `session: () => taskSession`, the same session is used every time, but `create` still runs.
  - `prism-tools/coding/src/workspace/service.ts` `create()` does not check whether the session already holds a worktree.
  - Two live records then carry the same `sessionId`, so `bound(sessionId)` returns whichever it finds first and tool routing becomes ambiguous.
  - Each attempt also consumes one of `maxWorktrees`, so a third attempt can fail with `workspace_limit`.
- **No branch or base option.** `AgentNodeWorktree` is `boolean | { dispose?: "keep" | "dispose" }`. The node always gets `prism/<short id>`, although `WorkspaceWorktreeCreate` already accepts `branch` and `base`.

### Why it matters

A gate back edge exists for "fix what the gate found". That only works if the worker continues in the tree it left.

Hosts that show the branch to a user, or let the user merge it, need a predictable branch name.

The workaround is to create and bind the worktree outside the workflow and not use `worktree` on the node. That duplicates the node's own durability: the record in `nodeState.worktree`, rebind on `resumeWorkflow`, `worktree_lost`, and the `agent.file` diff events.

### Requested in 0.13.1

1. **Reuse the worktree for the session.** When the node's session already has a live bound worktree (`workspace.worktree.bound(session.id)`), use it instead of creating one. Do this for back-edge iterations in the same run and for resume.
   - Make reuse the default when `session` is supplied. Alternatively, gate it behind `worktree: { reuse: "session" }`.
   - Only a node that opens a fresh session each time should get a fresh worktree.
2. **Branch and base on the node:**

   ```ts
   agentNode({
     agent: worker,
     session: () => taskSession,
     worktree: {
       branch: (ctx) => `factory/${taskId}`,   // string | (ctx) => string; validated as a git ref
       base: "HEAD",
       dispose: "keep",
       reuse: "session",                        // if not the default
     },
     input: (ctx) => workPrompt(task, ctx),
   });
   ```

3. **Guard in `prism-tools` `worktree.create`.** Creating a worktree for a session that already holds a live one should either return that worktree (same branch) or fail with a closed code such as `workspace_session_bound`. It should never create a second record for the same session.
4. **Docs.** `workflows/README.md` → Agent nodes should describe worktree lifetime across back edges, retries and resume.

### Acceptance tests

- A gate failing once with `onFail: "work"` and a supplied session: the second `work` execution sees the first attempt's file change, `worktree.create` is called once, and the `agent.file` diff covers both attempts.
- `branch: (ctx) => "factory/t1"`: `git worktree list` shows `factory/t1`, and an invalid ref fails at definition or start with a closed code.
- `worktree.create({ sessionId })` twice for one session gives one record (or `workspace_session_bound`), and `bound()` is unambiguous.
- `resumeWorkflow` after a kill during `work` with reuse rebinds the same path, as it does today.
- Defaults unchanged for nodes without `session`: one fresh worktree per fresh session.

---

## Version and compatibility

- Both changes are additive. Existing defaults are kept, except that reuse becomes the default for a supplied session, if you choose that. If so, note it in the CHANGELOG as a behaviour fix, since the old behaviour loses work.
- Clay pins exact versions and will move from 0.13.0 to 0.13.1 for these changes.
