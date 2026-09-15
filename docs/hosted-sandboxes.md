# Hosted sandboxes

## What it does

`createE2BSandbox` / `connectE2BSandbox` map one hosted vendor (E2B) onto the existing `DisposableSandbox` contract: `execFile`, optional `startProcess` / `attachProcess`, `pause` / `resume`, and explicit `kill`. Prism does not run hosted compute. The host owns the E2B account, template, API key, and lifecycle. Pause is the snapshot. `keepMemory: false` is filesystem-only: resume reboots and running processes are gone. `Sandbox.connect` auto-resumes a paused sandbox; this adapter never calls it unless the host calls `resume()` or passes `resume: true`.

## When to use it

Use this adapter when coding or process work should run in an E2B cloud sandbox rather than Docker. Use `createDockerSandbox` when you need a local digest-pinned container with `network: none`. Do not assume E2B isolation matches Docker: default capabilities report `networkIsolated` and `egressRestricted` false (E2B sandboxes have internet).

## Inputs / request

| Field | Required | Notes |
| --- | --- | --- |
| `apiKey` | unless `client` | Resolved at the SDK edge only. Never logged. |
| `client` | unless `apiKey` | Host-injected `e2b` `Sandbox` surface for tests or a pinned SDK. |
| `template` | no | Default `base`. Host-owned image/template. |
| `workdir` | no | Default `/workspace`. |
| `timeoutMs` / `limits.wallTimeMs` | no | Passed to E2B as sandbox timeout (idle/cost budget). |
| `onTimeout` | no | `kill` (default) or `pause`. `autoResume` is always false. |
| `labels` | no | Stored as E2B metadata for reconnect attestation. No secrets. |
| `expectedLabels` (connect) | no | Fail-closed mismatch → wrong owner. |
| `resume` (connect) | no | Default false. Paused sandboxes stay paused until `resume()`. |
| `capabilities` | no | Full host attestation; omitted fields resolve false. |

Optional peer: `e2b@2.49.1` (MIT). Install it or pass `client`.

## Outputs / response / events

`createE2BSandbox` returns a `DisposableSandbox`:

- `id` is the E2B sandbox id (non-secret reconnect identity).
- `pause({ keepMemory })` → `{ kind: "memory" \| "filesystem", state: "paused" }`. HTTP 503 (`ServiceBusyError`) leaves the sandbox **running**.
- `resume()` calls `Sandbox.connect` (explicit).
- `startProcess` refs are `prism-e2b-proc:<base64url>`. Filesystem-only pause makes `attachProcess` return null.
- `stop()` pauses with memory. `kill()` / `close()` destroy the sandbox. `close({ export })` is unsupported (pause is the snapshot).
- Default capabilities: workspace coherent, filesystem isolated from the host, process isolated; **not** network/egress/privilege isolated.

## Request/response example

```json
{
  "template": "base",
  "timeoutMs": 600000,
  "onTimeout": "kill",
  "labels": { "app.owner": "alice" },
  "pause": { "keepMemory": false }
}
```

## Implementation example

```ts
import { connectE2BSandbox, createE2BSandbox } from "@arnilo/prism-coding-tools/security";

const sandbox = await createE2BSandbox({
  apiKey: process.env.E2B_API_KEY,
  labels: { "app.owner": "alice" },
  timeoutMs: 10 * 60_000,
});
await sandbox.execFile({ file: "/bin/echo", args: ["ok"], cwd: "/workspace" });
await sandbox.pause!({ keepMemory: false });

const again = await connectE2BSandbox({
  apiKey: process.env.E2B_API_KEY,
  sandboxId: sandbox.id,
  expectedLabels: { "app.owner": "alice" },
});
await again.resume!();
await again.kill();
```

## Extension and configuration notes

- Detect `pause` / `startProcess` like Docker: `typeof sandbox.pause === "function"`. Absence is not an error on other backends.
- `createE2BProcessRecoveryBackend(sandbox, { expectedSandboxId, expectedWorkspace, expectedLabels })` is the attested `ProcessRecoveryBackend`. `createProcessSessions({ sandbox })` still auto-wires `attachProcess` when present.
- `lifecycle.autoResume` is forced false. Activity (exec, file, HTTP) must not resume paused work.
- Paused E2B sandboxes persist until `kill()`. There is no vendor TTL; the host must delete.

## Security and performance notes

- Attest vendor isolation; do not copy Docker `network: none` claims. Override `capabilities` only when the host actually restricted the template/network.
- API keys belong in `apiKey` or the injected client, never metadata, refs, labels, argv, or logs. Errors pass through `createSecretRedactor`.
- Process refs carry sandbox id, pid, command fingerprint, and workspace — no secrets.
- Pause duration is vendor-bound (about 4s per GiB RAM). Command output, env, and concurrent execs use the same sandbox limit caps as Docker (`maxOutputBytes`, `maxCommands`, `maxConcurrentExecs`).
- A 503 pause refusal is not success: status stays `running`.
- Filesystem-only resume is a reboot: in-memory state and processes are gone; do not auto-restart them.

## Related APIs

- [Coding execution approval and sandboxing](coding-security.md)
- [Process sessions](process-sessions.md)
- [Optional peer dependencies](peer-dependencies.md)
- [Live testing](live-testing.md)
