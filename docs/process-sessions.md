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

Use when a host needs attachable long-running processes (watch modes, language servers, interactive CLIs) that one-shot `shell` cannot model. Do not use as a job-control language or PTY emulator — `pty: true` fails closed with `ERR_PRISM_PROCESS_PTY_UNSUPPORTED` until a platform capability is wired. Pass a sandbox with `startProcess` for contained long-running work; omit `sandbox` for native spawn.

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

`ProcessStartRequest`:

| Field | Purpose |
| --- | --- |
| `command` / `args?` | Executable + argv (not a shell string). |
| `cwd?` | Relative/absolute path contained under registry `cwd`. |
| `env?` | Extra env merged onto `process.env` (never in fingerprint). |
| `pty?` | Default false; unsupported → `ERR_PRISM_PROCESS_PTY_UNSUPPORTED`. |
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

Events: `process_started`, `process_exited`, `process_killed`, `process_released`, `process_expired`, `process_unknown`.

Errors: `ERR_PRISM_PROCESS_POLICY`, `ERR_PRISM_PROCESS_OWNERSHIP`, `ERR_PRISM_PROCESS_STATE`, `ERR_PRISM_PROCESS_LIMIT`, `ERR_PRISM_PROCESS_PTY_UNSUPPORTED`, `ERR_PRISM_PROCESS_UNSUPPORTED`.

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
