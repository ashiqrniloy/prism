# Linux desktop control

## What it does

`@arnilo/prism-computer-use-linux` wraps the host-owned [`computer-use-linux`](https://github.com/agent-sh/computer-use-linux) MCP binary as Prism `ToolDefinition`s. It connects over stdio only when `createComputerUseLinuxTools()` is called, keeps upstream tool names, filters unknown tools, and composes desktop admission, execution approval, result bounds, serialization, redaction, and trust labeling over Prism's existing seams.

The package also exports `loadComputerUseLinuxSkill()`, which loads the short Prism-authored desktop procedure bundled at `skills/computer-use-linux/SKILL.md`. It does not resolve or vendor an upstream skill tree.

## When to use it

Use this package when a Linux host has installed and configured `computer-use-linux` and an agent must inspect or operate that host's desktop. Use the generic [Device adapters](device-adapters.md) contract when implementing another vendor adapter or when the host needs only admission and stream-bound primitives.

Do not use it as a desktop launcher, a cross-platform adapter, or a permission bypass. The host owns the binary, desktop session, sandbox, approval decision, and execution policy.

## Inputs / request

`createComputerUseLinuxTools(options)` accepts:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `command` | `string` | `computer-use-linux` | Host-owned executable. |
| `args` | `readonly string[]` | `["mcp"]` | MCP server arguments. |
| `cwd`, `env`, `stderr` | stdio transport options | omitted | Host-owned process configuration. |
| `serverId` | `string` | `computer-use-linux` | Bridge/error metadata identifier. |
| `device` | `DeviceAdapter` | required | Must be enabled `desktop-control` with a sandbox. |
| `runLimits` | `RunLimits` | required | Shared run accounting required by device admission. |
| `executionPolicy` | `ExecutionPolicy` | omitted | High-risk mutator approval/policy seam. |
| `approved` | `boolean` | `false` | Host approval for mutating calls. |
| `includeSetupTools` | `boolean` | `false` | Explicitly expose host setup tools. |
| `redactor` | `SecretRedactor` | omitted | Redacts returned external data. |
| `platform` | `NodeJS.Platform` | `process.platform` | Test/host seam; production must be Linux. |
| `connect` | MCP bridge factory | `connectMcpTools` | Test seam; not needed in production. |

`loadComputerUseLinuxSkill()` takes no arguments and reads only the package-local skill file. The file is capped at 64 KiB.

## Outputs / response / events

| Export | Result |
| --- | --- |
| `createComputerUseLinuxTools` | `{ tools, close }`; `tools` contains known upstream tools returned by the bridge. |
| `tools` | Read observations (`doctor`, app/window discovery, `get_app_state`, `screenshot`) plus mutators; setup tools are excluded by default. |
| `close()` | Closes the MCP bridge and its host-owned process transport. |
| `loadComputerUseLinuxSkill` | Prism `Skill` with name `computer-use-linux` and bounded instructions. |
| `COMPUTER_USE_LINUX_*` constants | Read, mutating, setup, known-name, and skill-name lists for host filtering and registration. |
| `MAX_SKILL_FILE_BYTES` | 64 KiB bundled-skill read ceiling. |
| Tool result | External data with `metadata.trust = "untrusted_external"`; screenshot/app-state oversize results become `dropped_oversize`. |

Mutating calls are serialized through one mutex and run `assertDeviceAdmit` plus `assertExecutionAllowed` before the remote MCP call. Read observations bypass per-call approval but still require an admitted device.

## Request/response example

```json
{
  "command": "computer-use-linux",
  "args": ["mcp"],
  "device": {
    "kind": "desktop-control",
    "enabled": true,
    "requireApproval": true,
    "sandbox": "linux-desktop"
  },
  "runLimits": {
    "maxTurns": 32,
    "maxToolCalls": 200
  },
  "approved": false,
  "includeSetupTools": false
}
```

## Implementation example

```ts
import { createToolRegistry, type Skill } from "@arnilo/prism";
import {
  createComputerUseLinuxTools,
  loadComputerUseLinuxSkill,
} from "@arnilo/prism-computer-use-linux";

async function installDesktop(hostSkills: { register(skill: Skill): void }, hostApproved: boolean) {
  const desktop = await createComputerUseLinuxTools({
    device: {
      kind: "desktop-control",
      enabled: true,
      requireApproval: true,
      sandbox: "linux-desktop",
    },
    runLimits: { maxTurns: 32, maxToolCalls: 200 },
    approved: hostApproved,
  });
  const tools = createToolRegistry(desktop.tools);
  hostSkills.register(loadComputerUseLinuxSkill());

  // Keep `desktop` alive while the run can call `tools`; close it at run end.
  return { tools, close: () => desktop.close() };
}
```

## Extension and configuration notes

- Install and configure the host binary separately: `npm install -g @agent-sh/computer-use-linux` or another host-managed installation. Prism has no runtime dependency on that binary and never downloads it.
- The factory exposes unprefixed upstream names. Unknown or future upstream names are omitted until Prism classifies them.
- `setup_accessibility` and `setup_window_targeting` are host-only and omitted unless `includeSetupTools: true` is explicitly selected. The bundled skill never instructs agent turns to perform setup.
- `connect` is an injectable bridge factory for fake MCP tests. The package's normal path uses `connectMcpTools` with stdio `{ command, args: ["mcp"] }`.
- `loadComputerUseLinuxSkill()` is inert beyond reading its packaged file; it does not discover peers, resolve paths, or connect to MCP.

## Security and performance notes

- Construction fails closed on non-Linux hosts and requires `DeviceAdapter.kind = "desktop-control"`, explicit `enabled: true`, a sandbox, and shared `RunLimits` before connecting.
- Mutators are high-risk external mutations: they require device admission, host approval when configured, and `ExecutionPolicy`; input calls are serialized to prevent concurrent desktop state changes.
- Observation results are untrusted external content and pass the optional host redactor. Screenshot/app-state payloads pass `acceptDeviceChunk`; oversize payloads are replaced with `dropped_oversize`, not forwarded.
- Imports are inert. The default setup surface is off, the skill file is capped at 64 KiB, and no full upstream skill tree is shipped.
- The host must keep credentials, desktop session state, binary paths, sandbox identity, and approval state outside model-controlled arguments.

## Related APIs

- [Device adapters](device-adapters.md): generic admission, shared limits, chunk bounds, and telemetry redaction contract.
- [MCP client bridge](mcp-tools.md): host-owned MCP transport and bounded tool mapping.
- [Tools](tools.md): registry and dispatch lifecycle for the returned `ToolDefinition`s.
- [Context and skills](context-and-skills.md): explicit skill registration, activation, and progressive disclosure.
- [Host security](host-security.md): trust, approval, sandbox, and untrusted external-content boundaries.
- [Upstream computer-use-linux](https://github.com/agent-sh/computer-use-linux): host binary and desktop prerequisites.
