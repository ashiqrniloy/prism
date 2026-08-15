# Process sessions

## What it does

`createProcessSessions` is an optional host-activated registry in `@arnilo/prism-coding-agent` for **long-running** child processes: start, cursor-paged output, input, wait, signal/kill, and release (detach). Sessions have bounded lifetime (sweep on registry access — no import-time timers), ownership/identity attribution, durable metadata (command fingerprint without env/secrets), and typed `CodingProcessEvent`s via a host callback. Reuses `ExecutionPolicy`, `killProcessTree`, and `OutputAccumulator` (including spill + `readRaw` cursor paging). Optional duck-typed `sandbox` backend uses `startProcess` when present; one-shot adapters fail closed. Nothing spawns on import or construction.

| Export | Purpose |
| --- | --- |
| `createProcessSessions(options)` | Build a `ProcessSessions` registry bound to one workspace `cwd`. |
| `ProcessSessions` | `start`, `get`, `cancelOwned`, `markUnknown`, `reconcile`, `dispose`. |
| `ProcessSession` | Handle: `output` / `input` / `wait` / `signal` / `kill` / `release` / `metadata`. |
| `ProcessSessionState` | `starting` \| `running` \| `exited` \| `killed` \| `released` \| `expired` \| `unknown`. |
| `ProcessSandboxBackend` | Duck-typed optional sandbox (`startProcess?`, `status?`); mirrors coding-security `SandboxProcessHandle`. |
| `CodingProcessEvent` | Host-sink events (`process_started` / `_exited` / `_killed` / `_released` / `_expired` / `_unknown`). |
| `ProcessSessionError` | Typed fail-closed errors (`ERR_PRISM_PROCESS_*`). |
| `resolveProcessSessionLimits` / `DEFAULT_MAX_PROCESS_*` / `HARD_MAX_PROCESS_*` | Session count, input bytes, lifetime, chunk/total output caps. |

## When to use it

Use when a host needs attachable long-running processes (watch modes, language servers, interactive CLIs) that one-shot `shell` cannot model. Do not use as a job-control language. `pty: true` (host-selected PTY) requires a `ptyBackend` passed to `createProcessSessions`; without one it fails closed before spawn with `ERR_PRISM_PROCESS_PTY_UNSUPPORTED`. Pass a sandbox with `startProcess` for contained long-running work; omit `sandbox` for native spawn.

```ts
import { createProcessSessions } from "@arnilo/prism-coding-agent";

const sessions = createProcessSessions({ cwd: workspaceRoot, policy, sandbox, onEvent });
const p = await sessions.start({ command: "npm", args: ["test", "--", "--watch"] });
const out = await p.output({ cursor: 0, maxBytes: 8192 });
await p.input("q\n");
await p.wait({ timeoutMs: 5000 });
await sessions.dispose();
```

## Inputs / request

`createProcessSessions` options:

| Field | Type | Purpose |
| --- | --- | --- |
| `cwd` | `string` | Workspace root; session `cwd` must stay inside. |
| `policy?` | `ExecutionPolicy` | Gated before spawn and rechecked on input/signal/kill. |
| `limits?` | `ProcessSessionLimits` | Optional overrides; invalid values fail instead of clamping. |
| `onEvent?` | `(CodingProcessEvent) => void` | Host-owned sink (core `AgentEvent` unchanged); audit owner + terminal/unknown. |
| `ownership?` | `OwnershipScope` | Default owner key for sessions. |
| `identity?` | `AgentIdentity` | When ownership omitted, owner key projects from identity. |
| `sandbox?` | `ProcessSandboxBackend` | When set: require `startProcess` or fail closed; `status` loss → all running → `unknown`. |
| `ptyBackend?` | `ProcessPtyBackend` | Host-selected interactive-terminal backend. `pty: true` delegates only here; absent backend → `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before spawn. Host supplies the PTY engine (e.g. node-pty); Prism never depends on one. |

`ProcessStartRequest`:

| Field | Purpose |
| --- | --- |
| `command` / `args?` | Executable + argv (not a shell string). |
| `cwd?` | Relative/absolute path contained under registry `cwd`. |
| `env?` | Extra env merged onto `process.env` (never in fingerprint). |
| `pty?` | Default false. `true` requires the `ptyBackend` host option (delegated only to it); unsupported host → `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` before spawn. |
| `terminal?` | `{ columns, rows, term? }` for `pty: true`; defaults `120 × 40`, `xterm-256color`. Bounds: columns 1–120 (hard 500), rows 1–40 (hard 200), TERM ≤ 64 bytes (hard 256). |
| `lifetimeMs?` | Bounded by `maxLifetimeMs`. |
| `owner?` | Override owner string. |
| `releaseOnCancel?` | If true, `cancelOwned` releases instead of killing. |

## Outputs / response / events

| Method | Result |
| --- | --- |
| `start` | `ProcessSession` in `running`; emits `process_started`. |
| `output({ cursor, maxBytes })` | `{ data, cursor, eof }` UTF-8 page from byte cursor. |
| `input` | Writes stdin; capped by `maxInputBytes`; fails if not running / stdin closed. |
| `wait` | `{ exitCode, state }` — `exitCode` is `null` for killed/released/expired/unknown. |
| `signal` / `kill` / `release` | Soft signal, hard kill, or detach (no re-attach). |
| `cancelOwned(owner)` | Kill (default) or release owned running sessions. |
| `markUnknown` | Backend-loss terminal state; never fabricates `exitCode`. |
| `reconcile()` | Host resume: mark every running/starting session `unknown` (O(sessions)). |
| `resize?` | Only when `ptyBackend.capabilities.resize` is true: bounded `{ columns, rows }` routed to the live terminal. |

Events: `process_started`, `process_exited`, `process_killed`, `process_released`, `process_expired`, `process_unknown`.

Errors: `ERR_PRISM_PROCESS_POLICY`, `ERR_PRISM_PROCESS_OWNERSHIP`, `ERR_PRISM_PROCESS_STATE`, `ERR_PRISM_PROCESS_LIMIT`, `ERR_PRISM_PROCESS_PTY_UNSUPPORTED`, `ERR_PRISM_PROCESS_PTY_BACKEND`, `ERR_PRISM_PROCESS_PTY_LIMIT`, `ERR_PRISM_PROCESS_UNSUPPORTED`.

## Host-selected PTY backend contract

`ptyBackend` is the host's interactive-terminal capability (plan 026 Task 1):

- **Delegation only.** `pty: true` starts a session exclusively through `ptyBackend.startPty`; the native spawn path never allocates a terminal. A missing backend or one without `startPty` fails closed before any spawn (`ERR_PRISM_PROCESS_PTY_UNSUPPORTED`). The non-PTY path is byte-compatible with the 0.2.5 baseline.
- **Contract.** `startPty({ file, args, cwd, env, columns, rows, term, onData })` returns `{ metadata?, write, signal, kill, release, wait, resize? }`. `capabilities.resize` is explicit — `resize` on the session exists only when declared; never duck-typed. `wait()` resolves on process exit (and rejects on backend loss); the host stops delivering `onData` once the session is terminal.
- **Terminal data is untrusted output.** Control sequences are never parsed or emulated; the host (or an attached terminal client) interprets them. Input is raw terminal bytes; NUL is rejected with a policy error, other control bytes pass through as terminal data.
- **Bounded attach.** `startPty` must settle within `maxPtyAttachTimeoutMs` (30 s default, 120 s hard); overflow removes the session record and fails with `ERR_PRISM_PROCESS_PTY_LIMIT`. Resize is rate-limited (60/min default, 600 hard) and fails with the same code. Backend `metadata` is bounded (`maxPtyBackendMetadataBytes`, 4 KiB default / 16 KiB hard).
- **Backend loss.** A throwing `startPty` or a lost `wait()` surfaces as `ERR_PRISM_PROCESS_PTY_BACKEND` with a generic message (backend error text is never embedded); the session becomes `unknown` with `exitCode: null` — never fabricated.
- **Parity.** Policy, cwd/ownership, cancel/expiry sweeps, input/lifetime/output caps, command fingerprint, events, and redaction behave exactly as non-PTY sessions; PTY sessions count against `maxSessions`.
- **Recovery caveat (phase 26, task 5).** PTY sessions are not durable across restart: no serialized terminal fd or raw output is ever persisted. Restart recovery reports such sessions `unknown` unless a host `recoveryBackend` re-attaches them; there is no exact-process-survival claim.

## Request/response example

```json
{
  "command": "npm",
  "args": ["test", "--", "--watch"],
  "lifetimeMs": 14400000,
  "releaseOnCancel": false
}
```

## Implementation example

```ts
const sessions = createProcessSessions({
  cwd: workspaceRoot,
  ownership: { tenantId: "t1", userId: "u1" },
  sandbox, // DisposableSandbox with startProcess, or omit for native
  limits: { maxSessions: 8 },
  onEvent: (e) => audit.write(e),
  policy: hostExecutionPolicy,
});

const p = await sessions.start({
  command: process.execPath,
  args: ["server.js"],
  lifetimeMs: 3_600_000,
});

let cursor = 0;
for (;;) {
  const chunk = await p.output({ cursor, maxBytes: 50_000 });
  cursor = chunk.cursor;
  if (chunk.eof) break;
}

await sessions.cancelOwned(p.owner); // run cancellation
await sessions.dispose();
```

## Extension and configuration notes

- Native when `sandbox` omitted; with `sandbox`, capability is `typeof startProcess === "function"` (never assumed).
- One-shot sandbox (no `startProcess`) → `ERR_PRISM_PROCESS_UNSUPPORTED` (no native fallback).
- Sandbox `status` not `running` (or throws) → all live sessions → `unknown`; further `start` fails closed.
- Host restart: call `reconcile()` on a new registry for in-memory orphans, or listen for `process_unknown` and wire Phase 7 `ToolEffectStore.markUnknown` in the host.
- Expiry sweep runs on registry/handle access — no timers at import.
- Command fingerprint is SHA-256 of `[command, ...args]` only (no env).
- Docker reference adapter does not implement `startProcess` yet — fail closed until a capable runtime is wired.

## Durable process recovery (plan 026 Task 5)

Optional, host-activated: pass `checkpoints` + `leases` + `ownerId` (all three
together; a partial recovery configuration fails closed at construction) and
optionally `recoveryBackend` + `recoveryLimits`. With durability configured:

- Intent is persisted BEFORE spawn into the versioned namespace
  `prism.coding-agent.process.v1` (schemaVersion 1, category `coding-process`),
  and every lifecycle transition (running, exited, killed, released, expired,
  unknown) is a CheckpointStore CAS write under a monotonic LeaseStore fencing
  token. Transition writes are serialized per record so CAS order never inverts
  on slow stores.
- `recover()` reconciles durable records against the live registry:
  - records already live here report `attached` without mutation;
  - terminal records report `terminal` with their exit code;
  - `starting|running` records attach-if-attested: a `backendRef` (opaque
    non-secret ref surfaced by a PTY/sandbox handle's optional `ref`) plus a
    host `recoveryBackend.attach(ref)` (bounded attach timeout 30 s default /
    120 s hard) may reattach; otherwise the record atomically becomes `unknown`
    with exit code null — no PID probing, no fabricated exit, no duplicate
    spawn. `recover()` without durability configured throws
    `ERR_PRISM_RECOVERY_UNSUPPORTED`.
- Recovered sessions are live registry sessions: input/signal/kill/release/
  resize/wait reach the attached backend; output streaming is not re-established
  after a restart (the host backend owns any buffered output behind its ref).
- Replica coordination: every mutation takes a per-record lease (30 s default /
  300 s hard); a crashed replica's lease lapses within TTL, a live one renews
  on transitions and releases on terminal transitions. A held lease makes the
  second replica report `unknown` without touching the record; CAS/fence
  conflicts fail closed with `ERR_PRISM_RECOVERY_FENCE`.
- `cancelOwned` after recovery either reaches the attached backend or records
  the durable record unknown — never a fabricated exit.
- Durable records are metadata only: no child/PTY handle, controller, promise,
  raw output, env, token, or credential is ever serialized; forbidden fields,
  corrupt, oversized, or cross-tenant records fail closed (dropped, never
  recovered). Records are capped (32 default / 128 hard; oldest terminal
  records evict beyond the cap; running records are never evicted).
- Errors: `ERR_PRISM_RECOVERY_UNSUPPORTED` / `_LIMIT` / `_OWNERSHIP` / `_FENCE`
  / `_UNKNOWN` / `_UNTRUSTED` / `_TIMEOUT` (`ProcessRecoveryError`).

## Security and performance notes

| Cap | Default | Hard |
| --- | ---: | ---: |
| Sessions per registry | 8 | 32 |
| Input write bytes | 64 KiB | 1 MiB |
| Session lifetime | 4 h | 24 h |
| Output chunk | 50 KiB | 1 MiB |
| Total output / session | 64 MiB | 1 GiB |

- Wrong-owner `get(id, owner)` → `ERR_PRISM_PROCESS_OWNERSHIP`.
- Released sessions reject all further handle ops.
- `cwd` outside workspace → `ERR_PRISM_PROCESS_POLICY`.
- Policy denial before spawn / on mutate → `ERR_PRISM_PROCESS_POLICY`.
- Unknown outcome never invents an exit code.

## Related APIs

- [Coding agent tools](coding-agent-tools.md): one-shot `shell` vs long-running sessions.
- [Language intelligence](language-intelligence.md): LSP servers may later register as managed sessions.
- [Coding security](coding-security.md): `SandboxProcessHandle` / optional `DisposableSandbox.startProcess`.
- [Tool effects](tool-effects.md): unknown-outcome vocabulary mirrored by `markUnknown` / `process_unknown` / `reconcile`.
