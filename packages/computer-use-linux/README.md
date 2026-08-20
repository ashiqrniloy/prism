# @arnilo/prism-computer-use-linux

Optional Prism tools for the host-owned [`computer-use-linux`](https://github.com/agent-sh/computer-use-linux) MCP binary. Prism does not download, install, or launch a desktop binary on import; the factory connects only when called.

```bash
npm install @arnilo/prism-computer-use-linux
npm install -g @agent-sh/computer-use-linux
```

```ts
import { createToolRegistry } from "@arnilo/prism";
import { createComputerUseLinuxTools, loadComputerUseLinuxSkill } from "@arnilo/prism-computer-use-linux";

const desktop = await createComputerUseLinuxTools({
  command: "computer-use-linux",
  device: { kind: "desktop-control", enabled: true, requireApproval: true, sandbox: "linux-desktop" },
  runLimits: { maxTurns: 32, maxToolCalls: 200 },
  approved: true, // host approval for mutating calls; keep false until approved
});
const registry = createToolRegistry(desktop.tools);
const skill = loadComputerUseLinuxSkill();
// register `skill` with the host skill registry.
// later: await desktop.close();
```

Default tools use upstream names and omit `setup_accessibility` / `setup_window_targeting`. Set `includeSetupTools: true` only when the host explicitly permits local setup. Read observations still require Linux, an enabled sandboxed device, and shared `runLimits`; mutating calls additionally require `approved: true` and `ExecutionPolicy` approval.

The package wraps the upstream MCP tool surface 1:1, filters unknown tools, serializes input mutations, bounds screenshot/app-state results with Prism's device chunk cap, and marks returned data `trust: "untrusted_external"`. The upstream binary is host-owned and must be installed/configured separately; see [computer-use-linux](https://github.com/agent-sh/computer-use-linux) for desktop prerequisites.

The package also exports `loadComputerUseLinuxSkill()`, which loads the bundled Prism-authored procedure without resolving an upstream skill tree. The package includes `skills/computer-use-linux/SKILL.md`.
