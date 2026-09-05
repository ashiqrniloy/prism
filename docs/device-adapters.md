# Device adapters

## What it does

Optional realtime voice and desktop OS / computer-control surface for Prism agents, shipped in 0.0.14 as a **contract + deny-by-default policy** in `@arnilo/prism` (`src/devices.ts`). The first vendor adapter, `@arnilo/prism-coding-tools/computer-use-linux`, wraps the host-owned `computer-use-linux` MCP binary without changing this generic contract. The contract composes over the existing `PermissionPolicy`, `RunLimits`, approval (`tool_approval`), and redactor seams; it adds no second approval runtime and no device framework.

## When to use it

- A host wants to admit a realtime voice or desktop-control device for an agent run and needs a fail-closed policy boundary before writing the vendor adapter.
- You need conformance fixtures (denial, approval, stream bounds, session budget, run accounting, redaction) to validate a future vendor adapter against the deny-by-default contract.
- You must guarantee device side effects never run without explicit consent + sandbox + approval, and never replay after reconnect.

Do **not** use it to broaden consent, memory, network, file, browser, connector, or tool permissions (roadmap gate 8 forbids this).

## Inputs / request

```ts
import type { DeviceAdapter, DevicePolicyOptions, DeviceAdmitRequest } from "@arnilo/prism";

const adapter: DeviceAdapter = {
  kind: "voice",            // "voice" | "desktop-control"
  enabled: false,           // deny-by-default: admit only on explicit true
  requireApproval: true,    // every side effect requires approval
  sandbox: "sandbox-a",     // host-owned sandbox id (required to admit)
  network: "egress-strict", // host-owned network/egress policy id
  limits: { maxChunkBytes: 1_048_576, maxConcurrentSessions: 1 },
};

const options: DevicePolicyOptions = { runLimits: { maxTurns: 8, maxToolCalls: 50 } };
const admit: DeviceAdmitRequest = { approved: true, activeSessions: 0 };
```

## Outputs / response / events

| Export | Purpose |
| --- | --- |
| `resolveDevicePolicy(adapter, options?)` | Resolve caps; reject unknown kinds and caps above the hard ceiling. |
| `assertDeviceAdmit(policy, request)` | Fail-closed admission gate (disabled / unsandboxed / unapproved / over-budget / unaccounted all deny). |
| `acceptDeviceChunk(policy, bytes)` | Stream bound: oversize chunks dropped with `marker: "dropped_oversize"`, never forwarded. |
| `redactDeviceTelemetry(redactor, telemetry)` | Metadata-safe telemetry: apply the host redactor before any emit/persist. |
| `runDevicePolicyConformance(adapter, options?)` | Conformance pair for future vendor adapters; returns `{ passed }`. |
| `DevicePolicyError` | Stable error (`ERR_PRISM_DEVICE_DISABLED` / `_APPROVAL` / `_SESSIONS` / `_CHUNK` / `_RUN_LIMITS` / `_INPUT`). |

## Request/response example

```jsonc
// assertDeviceAdmit on a disabled device throws (fail closed):
// DevicePolicyError: voice device is disabled by default  (ERR_PRISM_DEVICE_DISABLED)

// acceptDeviceChunk(policy, 9_000_000) with a 1 MiB cap:
{ "accepted": false, "bytes": 9000000, "marker": "dropped_oversize" }
```

## Implementation example

```ts
import {
  assertDeviceAdmit,
  acceptDeviceChunk,
  redactDeviceTelemetry,
  resolveDevicePolicy,
  createSecretRedactor,
} from "@arnilo/prism";

const policy = resolveDevicePolicy(
  { kind: "desktop-control", enabled: true, requireApproval: true, sandbox: "sandbox-a" },
  { runLimits: { maxTurns: 8, maxToolCalls: 50 } },
);

// Re-admit on every resume (side effects never replay after reconnect).
assertDeviceAdmit(policy, { approved: hostApprovedSideEffect, activeSessions: currentSessions });

// Stream bound + redaction on each audio/screenshot chunk.
const chunk = acceptDeviceChunk(policy, frameBytes);
if (chunk.accepted) emit(redactDeviceTelemetry(createSecretRedactor([token]), frame));
```

## Extension and configuration notes

- Frozen caps: audio/screenshot/stream chunk **1 MiB / 8 MiB**; concurrent device sessions per identity **1 / 4**. Device wall time / turns / tool calls consume the shared `RunLimits` (admission fails closed without run accounting).
- `enabled` resolves to `true` only on an explicit `true`; any other value is disabled. `requireApproval` stays `true` unless the host explicitly sets `false` (it should not).
- `@arnilo/prism-coding-tools/computer-use-linux` is the first vendor package. It remains optional, Linux-only, host-binary-owned, and outside umbrella profiles; this page stays generic so future voice or desktop vendors can satisfy the same contract via `runDevicePolicyConformance`.

## Security and performance notes

- Deny-by-default: admission requires explicit `enabled`, an explicit `sandbox`, approval (when required), an under-budget session count, and shared `RunLimits` — any missing condition fails closed.
- Side effects never replay after reconnect: hosts must re-admit on every resume/interruption.
- Secrets are isolated from audio/screenshot/stream paths: apply `redactDeviceTelemetry` before any emit/persist; telemetry must be metadata-safe.
- No permission broadening: device adapters cannot widen consent, memory, network, file, browser, connector, or tool permissions (gate 8).

## Related APIs

- [Browser automation](browser-automation.md): verified-state checkpoints + reload/verify-before-side-effect for browser composition.
- [Linux desktop control](computer-use-linux.md): first-party host-owned `computer-use-linux` MCP wrapper using this contract.
- [Conversations](conversations.md): durable threads that own the runs device sessions bind to.
- [Host security](host-security.md): approval, sandbox, and egress trust boundaries device adapters compose over.
- [Performance and resource limits](performance.md): shared `RunLimits` accounting.
- [Migration](migration.md): historical 0.0.14 additive seams and device-vendor deferral; the 0.3.0 desktop wrapper is additive and optional.
