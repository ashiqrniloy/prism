# @arnilo/prism-tools-computer-use

The first-party Linux desktop tools as a Prism package. The default export is a `definePackage`
definition whose `setup` resolves the host-owned `computer-use-linux` MCP binary on `PATH`,
connects over stdio, registers the upstream desktop tools, and registers the bundled
`computer-use-linux` skill.

## Install

```bash
prism add @arnilo/prism-tools-computer-use
bun add -g @agent-sh/computer-use-linux   # the host-owned binary; Prism never downloads it
```

```jsonc
// manifest entry
{
  "name": "@arnilo/prism-tools-computer-use",
  "version": "^0.13.0",
  "integrity": "sha512-…",
  "config": {
    "display": ":0",
    "device": { "enabled": true, "requireApproval": true, "sandbox": "linux-desktop" },
    "runLimits": { "maxTurns": 32, "maxToolCalls": 200 }
  }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `command` | `string` | `"computer-use-linux"` | Absolute path or a bare name resolved against absolute `PATH` entries. A missing command writes a `warn` note and registers nothing. |
| `args` | `string[]` | `["mcp"]` | MCP server arguments. |
| `display` | `string` | none | Sets `DISPLAY` in the child environment. |
| `includeSetupTools` | `boolean` | `false` | Exposes the host-only `setup_accessibility` / `setup_window_targeting` tools. |
| `approved` | `boolean` | `false` | Host approval for mutating calls. Mutating calls are denied in-tool until this is `true`. |
| `device.enabled` | `boolean` | `false` | Deny-by-default: device admission fails unless this is explicitly `true`. |
| `device.requireApproval` | `boolean` | `true` | Admission requires `approved` when set. |
| `device.sandbox` | `string` | none (required) | Host-owned sandbox identifier; admission fails closed without it. |
| `device.network` | `string` | none | Host-owned egress policy identifier. |
| `device.limits` | `{ maxChunkBytes?, maxConcurrentSessions? }` | device defaults | Stream and session caps. |
| `runLimits` | `object` | none (required) | Shared run accounting the device session must consume. |

A missing `device.sandbox`, a missing `runLimits`, or an unresolvable `command` writes a `warn`
status note and registers nothing; it never throws. A host or test may supply its own MCP bridge by
providing the `computer-use.mcp` service; the bundled path dynamically imports
`@arnilo/prism-mcp`'s `connectMcpTools`.

## What it changes

`resolveDevicePolicy` and `assertDeviceAdmit` live in this package. A disabled device, a missing sandbox, or a missing approval fails closed.

Registers the known upstream tools, each declaring `effects: ["external"]`:

| tool group | effects | notes |
| --- | --- | --- |
| read observations (`doctor`, `list_apps`, `list_windows`, `focused_window`, `get_app_state`, `screenshot`) | `["external"]` | admitted device, no per-call approval |
| mutators (`activate_window`, `move_window`, `resize_window`, `scroll`, `click`, `drag`, `press_key`, `type_text`, `perform_action`, `set_value`) | `["external"]` | admitted device plus `approved`; serialized through one mutex |
| `setup_accessibility`, `setup_window_targeting` | `["external"]` | host-only; registered only with `includeSetupTools: true` |

Also registers the bundled `computer-use-linux` skill (`skills/computer-use-linux/SKILL.md`).

## Capabilities

None. The package uses no gated `PackageAPI` member; the kernel redacts tool results through its own
redactor.

## Cost, security, and failure behavior

- Construction fails closed on non-Linux hosts and requires an explicitly enabled `desktop-control`
  device with a sandbox and shared run limits before connecting.
- Mutating calls are high-risk external mutations: they declare `effects: ["external"]` so the host
  approval hook gates them, and they additionally pass in-tool device admission — so an `approval`
  `auto` mode still cannot bypass `approved: false` or a missing sandbox.
- Observation results are marked `untrusted_external`, so the kernel wraps them in its envelope
  (`docs/tools.md`); screenshot/app-state payloads pass `acceptDeviceChunk` and oversize payloads
  become `dropped_oversize`.
- Importing the package is inert: `@arnilo/prism-mcp` is imported dynamically only during `setup`.

## Example

```ts
import toolsComputerUse from "@arnilo/prism-tools-computer-use";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [
    toolsComputerUse({
      display: ":0",
      device: { enabled: true, requireApproval: true, sandbox: "linux-desktop" },
      runLimits: { maxTurns: 32, maxToolCalls: 200 },
    }),
  ],
});
```

The 0.12 factory names stay exported: `createComputerUseLinuxTools`, `loadComputerUseLinuxSkill`,
`classifyComputerUseLinuxTool`, `isComputerUseLinuxTool`, `resolveCommand`, the
`COMPUTER_USE_LINUX_*` lists, and `MAX_SKILL_FILE_BYTES`.

## License

MIT
