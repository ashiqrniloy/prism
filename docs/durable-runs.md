# Durable runs

## What it does

Long investigations survive a host process that dies mid-run. With `checkpointPolicy: "every-turn"`, the durable store holds a running-state checkpoint at each provider-turn boundary — after the previous turn's tool results are in the session store, before the next provider request. A restarted worker resumes the *same* run with `decision: "continue"`: no tool is re-dispatched, and the session history is rebuilt from the checkpoint's session/leaf reference instead of being re-run from turn zero.

This is crash recovery for the in-run state, not an orchestrator. The host workflow engine (Temporal, a queue, a supervisor) still owns scheduling, retries, and completion; Prism owns only the run's turns, counters, loop-local state, and sticky attention frontier.

## When to use it

- A `Do`-style investigation can outlive its worker process (deploys, evictions, OOM kills, spot reclamation) and re-running the paid turns is unacceptable.
- The host wants a bounded, explicit recovery point rather than "restart the whole run".
- An external orchestrator needs to resume a single run without replaying its tools.

For approval suspension and batch decisions, see [Agent/session runtime § Durable interruption](agent-session-runtime.md#durable-interruption); `every-turn` is additive to that machinery and uses the same store, redaction, bounds, fingerprint, and CAS.

## Inputs / request

`AgentRunStateOptions` (per-run `RunOptions.runState` or `AgentConfig.runState`):

| Field | Meaning |
| --- | --- |
| `checkpointPolicy` | `"decision"` (default) persists only on suspension/terminal status. `"every-turn"` adds one running-state checkpoint per provider turn. |
| `checkpoints` | The host's `CheckpointStore`; the same store serves suspension, crash recovery, and status. |
| `definitionRevision` | Host-authored revision participating in the fingerprint; a change without a revision bump refuses resume. |
| `persistSessionState` | Also carries loaded-skill names and the attention sticky frontier into each turn checkpoint. |
| `includeSkillBodies` | Alongside `persistSessionState`, carries exact skill instructions. |
| `maxStateBytes` | Save-side byte ceiling (default 256 KB, hard 1 MB). Applies to every turn checkpoint identically. |

Resume uses `resumeAgentRun` / `resumeAgentRunStream` with `{ expectedVersion, decision: "continue" }`. The checkpoint records its own cadence, so a continued run keeps writing turn checkpoints without the host repeating `checkpointPolicy`.

## Outputs / response / events

Each turn checkpoint is a normal durable state (schema v1) carrying status `running`, the current `leafId`, run counters and wall deadline, loop-local state when the loop declares `snapshot`/`restore`, the run's `toolNames` grant, and — with `persistSessionState` — the loaded-skill catalog plus sticky attention frontier. Hard gates are unchanged: CAS `expectedVersion`, ownership/fencing, redaction at the checkpoint boundary, `maxStateBytes`, and the agent fingerprint (`agentFingerprint`) over id, revision, model, instructions, system prompt, skills, tools, guardrails, and loop revision.

A crash leaves the last checkpoint at status `running`. `decision: "continue"` accepts exactly that: a running checkpoint with no interruption and no unresolved pending decisions. Everything else fails closed with `AgentRunStateError` and zero checkpoint writes:

- `expectedVersion` mismatch, ownership/fencing mismatch, revision or fingerprint mismatch (`Stale or non-running agent run resume`, `Agent revision or fingerprint mismatch on resume`).
- Status `suspended` — approvals, elicitations, and input guardrails still require `approve`/`deny` or a `RunDecision` batch; `continue` never bypasses a gate.
- Any interruption, pending decision, or ready-to-dispatch pending call recorded in the state.

The resumed run emits `agent_resumed` with the claimed version, reuses the recorded run counter snapshot, restores loop-local state, and dispatches nothing that was already persisted. Terminal saves then drop the pending markers as before.

**Ambiguity window.** A turn checkpoint is taken between turns, so a crash can lose at most the one provider turn that was in flight; that turn is re-requested on resume. A crash *inside* a tool's side effect is still the pre-existing ambiguous case — an already-marked `dispatched` call is never replayed automatically; resolve it manually or key host effects on `runId`/`toolCallId` idempotency. Counter caveat: the interrupted turn's `maxTurns` charge was already recorded at assembly, and the resumed turn charges once more, so a crash costs one extra turn against a finite `maxTurns` budget.

## Request/response example

```ts
import { createAgent, createMemoryCheckpointStore, providerDone, providerTextDelta, resumeAgentRun } from "@arnilo/prism";

const checkpoints = createMemoryCheckpointStore();
const agent = createAgent({
  id: "investigation",
  model: { provider: "mock", model: "demo" },
  provider: { id: "mock", async *generate() { yield providerTextDelta("done"); yield providerDone(); } },
});

// Worker 1: long run, crash-recoverable between turns.
const session = agent.createSession({ id: "investigation-session" });
const first = await session
  .run("Investigate", { runState: { checkpoints, definitionRevision: "2026-09-20.1", checkpointPolicy: "every-turn" } })
  .catch(() => undefined); // worker died

// Worker 2: same stores, same run, continue from the last turn boundary.
const resumed = await resumeAgentRun(
  agent,
  { runId, sessionId: session.id },
  { decision: "continue", expectedVersion: checkpointVersion },
  { checkpoints, definitionRevision: "2026-09-20.1" },
);
```

The complete network-free demo — one tool execution across the crash, resumed from the turn checkpoint — is [`examples/durable-investigation.ts`](../examples/durable-investigation.ts).

## Extension and configuration notes

- `checkpointPolicy: "decision"` is byte-identical to the pre-0.8 behavior: no turn writes, no extra events, no state fields. Turn checkpoints appear only when the option is set.
- The policy is recorded on the state (when non-default) and restored on resume, so hosts do not thread the option through `AgentRunResumeOptions`.
- Custom loops declared durable via `snapshot`/`restore` hooks keep their loop-local state across a crash resume exactly as they do across a suspension.
- Per-run `toolNames` grants, run counters, and wall deadlines all ride the turn checkpoint; the resumed run cannot widen any of them.

## Security and performance notes

- `"continue"` is a host-API action only. Prism's AG-UI interrupt resolution accepts `approve`/`deny` only, channel adapters resume with `deny`, and there is no server route that forwards an untrusted `continue`; adding one would create an approval-bypass path.
- Every gate that protects a suspension protects a continue resume: exact ownership, fencing token, fingerprint, revision, CAS version, and the absence of unresolved work. A running checkpoint is a recovery point, never an authorization.
- Cost is one bounded checkpoint write per provider turn (same redaction and `maxStateBytes` ceiling as suspension writes). A 40-turn investigation under `"every-turn"` therefore writes 40 checkpoint rows plus the terminal save, while the default `"decision"` policy writes at most one row per approval or suspension. Each row carries the run frontier, counters, run limits, and loop snapshot — not the message history, which stays in the session store and is pointed at by `leafId` — so the store grows with turns, not with turns × transcript; a state that would exceed `maxStateBytes` (default 256 KiB, `DEFAULT_MAX_AGENT_RUN_STATE_BYTES`) fails closed rather than truncating. Pick `"every-turn"` when a worker restart must cost at most one turn of thinking, and leave the default for runs with many cheap turns.
- Checkpoints never contain provider objects, callbacks, signals, credentials, or raw secrets; the payload is bounded and redacted like any other durable state.
