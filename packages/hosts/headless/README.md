# @arnilo/prism-headless

Host library routing Prism `HostUi` requests through ordered routes. Import it in your host; it is not a native package and does not belong in an agent's `packages` list. It registers no tools, hooks, slots, commands, or services.

## Install

```sh
bun add @arnilo/prism @arnilo/prism-headless
```

## Host example

Run `bun examples/headless-host.ts` from the repository for an offline host using a disconnected `remoteHostUi()`, a scripted paired Telegram channel, and `policyDefault()`. It persists an unanswered approval in SQLite, answers a fresh channel offer through `resumeWhenAnswered`, and runs one cron workflow on a fake clock. Assertions verify routing order, no tool execution before approval, one approved execution, the next deadline, and an indexed child under the schedule session. Its dummy bot token is an `env:` ref; the transport never contacts Telegram.

## What it changes

The host chooses where people answer requests and when agent or workflow runs start. Agent tool policy and kernel validation still govern execution. Routing exhausts to `unavailable`; only approval asks and elicitations then suspend durably. The library supplies no provider, store, transport, or background process.

## Routing

```ts
import { routeHostUi, policyDefault } from "@arnilo/prism-headless";

const ui = routeHostUi([
  { name: "client", ui: attachedClient, kinds: ["confirm", "select", "input", "terminal", "notify"] },
  { name: "channel", ui: channelUi, kinds: ["confirm", "select", "input"], timeoutMs: 120_000 },
  policyDefault(),
]);
// Pass host: { ui } when creating your agent.
const answers = await ui.answers();
```

Routes are plain `HostUi`s, tried sequentially once per request. `unavailable`, a thrown error, an invalid response, or a timeout moves to the next route. The first `answered` or `dismissed` response wins. Exhausting routes returns `unavailable`.

| `HostUiRoute` field | Default | Meaning |
| --- | --- | --- |
| `name` | required | Unique, nonempty route label, recorded in the log. Use a non-sensitive label. |
| `ui` | required | Public `HostUi` implementation. |
| `kinds` | all except `secret`, `terminal` | Allowed request kinds. Secret and terminal always require explicit inclusion. |
| `timeoutMs` | no timeout | Integer from 1 to 600,000 milliseconds. |

`HostUi.request` has no cancellation signal. A timeout cannot cancel the underlying prompt: a late response is logged as `late` and discarded. A late rejection records `error`. Routes should expire their own prompts. Offering a suspended decision again later can produce a duplicate prompt. The approval package first prompts inline, and an unavailable answer becomes a kernel approval ask, which can prompt again before suspension. The offline example deliberately shows both timeouts and a fresh resume offer. Hosts should expire or correlate prompts; a late inline reply is discarded and cannot resume the run.

## Policy default

`policyDefault(answers?)` returns the route named `policy`. Each kind defaults to `"unavailable"`; `"dismiss"` declines it, and `notify: "ack"` acknowledges a notification. `confirm: "allow"` throws `HeadlessError` with code `policy_allow_refused`. Unknown actions or kinds throw `invalid_policy`. Defaults never approve. Like any route, the policy needs explicit `kinds` if you want it to receive secret or terminal requests.

| `policyDefault` setting | Default | Meaning |
| --- | --- | --- |
| `answers[kind]` | `"unavailable"` | Per-kind action; `"dismiss"` returns dismissed. |
| `answers.notify` | `"unavailable"` | Also accepts `"ack"` to acknowledge. |
| `answers.confirm` | `"unavailable"` | `"allow"` is refused; policy never approves. |

## Answer log

| `routeHostUi` option | Default | Meaning |
| --- | --- | --- |
| `limits.maxAnswers` | 1,000 | Maximum in-memory records and returned rows; integer 1–100,000. |
| `answerLog` | absent | Optional `CheckpointStore` from `@arnilo/prism-workflows`. |
| `ownership` | absent | Exact tenant/account/user scope for persisted rows; when resuming, these fields must match the authority’s agent scope. |
| `resumeAuthority` | absent | `createResumeAuthority(agent)`; required for `resumeWhenAnswered`. |

`await ui.answers({ sessionId?, limit? })` returns the latest retained rows, oldest first. A row holds only `{ route, kind, status, sessionId?, approvalId?, at }`. Status is `answered`, `dismissed`, `unavailable`, `late`, or `error`. Each attempted route records a row, including a timeout as `unavailable`; skipped routes record nothing. A later settlement creates another row. Inline `HostUi` requests do not carry an approval id, so inline rows omit `approvalId`.

No request title, tool arguments, answer value, secret ref, or error message is recorded. Metadata identifiers and route labels are host supplied and should not contain secrets. Returned rows are copies.

With `answerLog`, each record adds one awaited checkpoint write in namespace `headless.answers`; `answers()` reads paginated checkpoint rows, so a new router can read the same log after a restart. Reads enforce exact ownership even when the store treats omitted query fields as wildcards. Persistent retention belongs to the host/store; `maxAnswers` bounds the router's memory and returned rows, not durable storage. Without `answerLog`, there is no persistence cost. Write failures reject the request; failures writing late settlements surface on `answers()`.

## Suspension and later answers

Only approval asks and elicitations suspend durably when no route answers; other package requests fail closed under their own contracts. Configure a persistent store on the agent to recover after restart.

Create one authority for the agent and share it with every router and `serveAgent` that can resume it:

```ts
import { createResumeAuthority, routeHostUi } from "@arnilo/prism-headless";

// agent was created with host.ui: routeHostUi(routes), for inline routing.
const resumeAuthority = createResumeAuthority(agent);
const ui = routeHostUi(routes, { resumeAuthority });
const session = await agent.session({ id: suspendedId });
const outcome = await ui.resumeWhenAnswered(session, undefined, { signal });
if (outcome.status === "resumed") {
  for await (const event of outcome.events) render(event);
}
// If this agent is also served remotely:
// serveAgent(agent, { transport, hostUi: clientUi, resumeAuthority });
```

`resumeWhenAnswered(session, pending?, { signal? }?)` reopens the id through the authority's agent, checks its scoped session index, and reads the current branch tip via the public suspended-entry parser. It skips package-state entries; an older suspension below another entry is already resolved. The caller's session object never supplies entries or executes a resume. Optional `pending` must match the current approval ids; authoritative descriptors supply the prompts and schemas.

Each pending decision is offered sequentially through the configured kind-filtered routes. Approvals use `confirm`; an elicitation with one required string-enum property uses `select`; other object schemas use `input` with a JSON object answer. The kernel revalidates elicitation values before dispatch. Prompts contain the redacted reason and elicitation schema, never tool arguments. Dismissal becomes `reject_once` with reason `dismissed via <route>`. Every attempt records its `approvalId` without storing the answer value.

Resume offers ignore `timeoutMs`. There is no polling: a route that never answers waits until the supplied signal aborts. Routes that all return unavailable yield `{ status: "unavailable" }` and leave the suspension intact. Aborting returns `{ status: "aborted" }`; a late settlement is discarded and logged. `HostUi` has no cancellation port, so the underlying route can remain pending and must manage its own resource expiry. A fresh offer after an inline timeout may display the prompt twice.

With no pending suspension the result is `{ status: "already_resolved" }`. Once every decision has an answer, it returns `{ status: "resumed", events }`. Consume the stream promptly: validation and execution start on iteration, and a competing resume can still win before iteration. Concurrent offers on one router fail with `resume_busy`. The shared authority claims each session before asynchronous preparation and holds the claim until the stream finishes or is closed; another resume fails with `resume_busy`, or the kernel's stale-decision error after completion. Validation failures release the claim and leave the suspension pending.

After restart, recreate the agent, authority, and router over the same durable store and call the same method. The authority keeps only an in-process guard, adds no model calls or durable writes, and reads the session index/branch before resume; optional answer logging retains its per-attempt checkpoint-write cost. Use one authority per agent across every resume entry point. Direct `session.resume`, independent authorities, and separate processes bypass that guard and are not coordinated. Channel bindings and scheduling are separate capabilities.

## Failures and security

Construction rejects empty routes (`no_routes`), duplicate labels (`duplicate_route`), unknown kinds (`unknown_kind`), invalid timeouts (`invalid_timeout`), invalid limits (`invalid_limit`), and malformed routes (`invalid_route`). Missing resume authority rejects with `resume_authority_required`; a foreign id or mismatched ownership rejects with `session_not_found` before any offer; stale supplied ids reject with `stale_decisions`. Route errors are treated as unavailable without logging their messages. Configure finite timeouts for routes that might never settle. The library opens no network connection and adds no kernel contract.

## Scheduling

`createScheduler` drives agents and workflows through their public APIs. It starts no model run or timer until `trigger()` or `start()` is called.

```ts
import { createScheduler } from "@arnilo/prism-headless";

const scheduler = createScheduler({
  checkpoints, // CheckpointStore supplied by the host's store package
  ownership: { tenantId: "ops" }, // must exactly match every target agent
  targets: {
    report: { kind: "agent", agent: reporter, input: "Write today's report" },
    nightly: { kind: "workflow", agent: host, command: "nightly-build", input: { goal: "nightly" } },
    // A package command, run on its own: no model turn, no prompt.
    maintain: { kind: "command", agent: fabric, command: "memory:maintain", input: {} },
  },
});
await scheduler.schedule({ id: "daily-report", target: "report", cron: "0 9 * * *", tz: "UTC" });
await scheduler.schedule({ id: "build-once", target: "nightly", at: "2026-12-01T02:00:00Z" });
await scheduler.schedule({ id: "maintain-daily", target: "maintain", cron: "0 3 * * *", tz: "UTC" });
scheduler.start();
const firing = await scheduler.trigger("nightly", { input: { goal: "manual" } });
// Later, before shutting down the host:
await scheduler.stop();
```

The workflow target's `command` must already be registered on `agent` using `workflowCommand(prism, "nightly-build", definition, { args: schema })` from `@arnilo/prism-workflows`. Declare the input properties in that command's schema. The scheduler invokes `agent.commands.run` on the schedule session; the command supplies the real package and session context to `startWorkflow`. It does not register commands or construct agents. Workflow input is a JSON object; agent input is a string, with optional `runOptions` on the target.

The command target runs **one registered package command** on the schedule session and nothing else: no model turn, no prompt, no agent loop. Register the command in a package (or on the host with `prism.commands.register`) and name it; `{ kind: "command", agent, command, input: {} }` passes `input` as the command's arguments, validated by the command's own schema before it runs. The firing status comes from the command's result — a `status` from `completed`/`stopped`/`suspended`/`failed`/`aborted`/`succeeded`/`denied`, else `ok: false` ⇒ `failed`, else `completed` — and a throw records `failed` without persisting the error or the result. This is how a package with a maintenance-style pass (`memory:maintain` in `@arnilo/prism-memory-fabric`) runs nightly without spending a model call.

| `createScheduler` option | Default | Meaning |
| --- | --- | --- |
| `checkpoints` | required | Ownership-scoped `CheckpointStore` with atomic version CAS. |
| `targets` | required | Named agent, workflow-command, or package-command targets. |
| `ownership` | required | Exact tenant/account/user scope, including omitted fields. Use `{}` for unscoped agents. |
| `leases` | absent | Optional ownership-scoped `LeaseStore`; acquire before claim, renew while running, release afterward. |
| `missed` | `"skip"` | On start, skip overdue occurrences or coalesce the gap with `"run-once"`. |
| `limits.firingLeaseMs` | 30,000 | Lease TTL in ms, integer 1–86,400,000; renew every TTL/3. |
| `clock` | system clock | `{ now(): number, sleep(ms, signal): Promise<void> }`; sleep must settle and clean up on abort. |
| `limits.maxSchedules` | 1,000 | Integer 1–10,000, excluding deleted tombstones; admission is serialized within an instance. |
| `limits.maxConcurrentFirings` | 4 | Integer 1–1,000; includes scheduled and manually triggered firings. |

Cron uses `Bun.cron.parse` exclusively with an explicit time zone (default `UTC`), including Bun's daylight-saving behavior. Invalid expressions, expressions with no occurrence in Bun's search horizon, and invalid zones are rejected. One-offs accept an ISO date string at or after now, `Date`, or epoch milliseconds (also at or after now). Supply exactly one of `cron` and `at`. Schedule ids must be nonempty and at most 256 characters.

`await scheduler.list()` reads persisted state and returns copies of live schedules, including paused and completed ones. Rows use `schemaVersion: 1` in namespace `headless.schedules`, with the input snapshot, next deadline, schedule session id, and latest firing id/status plus its agent session id or workflow run id. Every store operation carries ownership; wildcard list results are filtered to exact scope. Invalid state fails closed. Target agents must retain their session store across restarts, and the host must recreate the same target names and workflow commands.

`pause(id)` suppresses future claims; `resume(id)` enables a paused schedule. A completed one-off cannot resume. `delete(id)` hides the row and prevents further claims, retaining a tombstone so stale readers cannot recreate an old firing. A deleted id may be scheduled again. These changes do not cancel a firing already claimed. Completion merges with current state, preserving concurrent pause/delete changes. Schedule/trigger parents carry `actor: { kind: "prism", agent: agent.id }`, making them durable before the first firing. Agent children link to the schedule parent; workflow runs write on that parent through the command. `trigger` uses a durable per-target triggers parent and returns its firing result without creating a schedule row. Trigger parents are reused after restart.

`start()` is idempotent. It arms one cancellable timer for the earliest eligible deadline and re-arms on local changes; it never polls at a fixed interval. Long system-clock waits re-arm at the platform timer maximum. When concurrency is full, it waits for a firing to settle. Manual triggers at capacity reject with `firing_limit`. `stop()` cancels the timer, drains admitted work, and reports background checkpoint/clock failures. It does not abort targets. A successful stop permits another start. Target execution errors record `failed` without persisting the error message; suspended results record `suspended` and are left for the host to resume. A command target that reports `suspended` is left alone the same way: the scheduler never retries a firing.

Each scheduled firing costs one CAS claim write, one completion write, checkpoint reads, and the target's own work. Creation adds a schedule write and the parent's initial session metadata entry. Input is snapshotted when scheduled, stored as given, and passed through the target's normal validation and policy gates: **never put secrets in schedule input, ids, target names, or workflow command arguments**. There is no scheduler-specific model call or dependency.

## Running more than one process

Pass the shared store's `leases` alongside `checkpoints`. Each scheduler generates a unique owner id. Before advancing a due schedule with CAS, it acquires `headless.firing:<scheduleId>:<dueAt ISO>` in the scheduler's exact ownership scope. The lease token authenticates renewal/release; its fencing counter is recorded in `lastFiring.fencingToken`. Use non-sensitive schedule ids.

With live workers, one process claims and starts each occurrence. The CAS advances before target start: a crash after that write can lose the firing. A durable `lastFiring.status: "running"` is an uncertain attempt and is never automatically replayed. Leases do not make external model/tool effects transactional.

`leases` defaults to omitted; single-process hosts can avoid lease costs and retain CAS protection. Each contender adds one acquire per attempt; the winning firing adds renewals every `limits.firingLeaseMs / 3` and one release. `limits.firingLeaseMs` defaults to 30,000 ms (integer 1–86,400,000). Renewal failure lets the target finish, records `lease_lost`, and never replays that occurrence. A contended lease retries after at most one second.

`missed` defaults to `"skip"`; `"run-once"` is the other accepted value. Each `start()` captures the current time and applies the policy to active schedules whose deadline is strictly earlier:
- `skip`: record `lastFiring.status: "skipped"`, the missed occurrence count and policy, and advance past now (or complete a one-off).
- `run-once`: execute one firing for the gap, recording the missed count and policy, then advance past now.

A deadline exactly at startup time fires normally. Missed counts include occurrences through startup time. During normal running, delayed cron firings coalesce into one firing and advance after now. Manual `trigger()` calls are independent invocations and do not share a scheduled-firing lease.

Each instance sees external schedule changes when it next reads; hosts must coordinate external edits/restart rather than expecting cross-process push notifications. A strict capacity limit across simultaneous creators requires host single-writer admission. Tombstone and trigger-session retention belongs to the host/store.

Scheduler errors include `invalid_missed_policy`, `unknown_target`, `duplicate_schedule`, `past_one_off`, `invalid_cron`, `invalid_timezone`, `schedule_limit`, `invalid_schedule`, `invalid_schedule_state`, `schedule_not_found`, `scheduler_ownership`, `unknown_workflow_command`, `unknown_command`, `firing_limit`, and `scheduler_stopping`. Storage failures propagate; a malformed workflow command result records a failed firing. Error messages contain codes rather than arbitrary input or target exception text.
