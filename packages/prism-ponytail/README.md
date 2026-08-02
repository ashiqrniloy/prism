# @arnilo/prism-ponytail

Optional Ponytail behavior integration for Prism (**0.0.22**).

Importing is inert: no skills, commands, timers, or network until the host loads the extension via `kernel.load([createPonytailExtension(...)])`.

## Requirements

- Optional peer `@dietrichgebert/ponytail@^4.8.4`, **or** host-supplied `upstreamPath` to a Ponytail checkout with `skills/` and `hooks/`.
- Session callbacks (`appendEntry`, `getEntries`) for mode persistence — same pattern as observational memory `attach`.
- Peer `@arnilo/prism@0.0.22`.

## Quick start

```ts
import { createPonytailExtension } from "@arnilo/prism-ponytail";
import { createExtensionKernel, createLoadSkillTool, createLoadedSkillSet, createSkillRegistry } from "@arnilo/prism";

const ponytail = createPonytailExtension({
  upstreamPath: undefined, // resolves optional peer when installed
  defaultMode: "full",
  quietStartup: true,
  appendEntry: (entry, options) => store.append(entry, options),
  getEntries: () => session.entries(),
});

await kernel.load([ponytail]);
```

Commands: `ponytail` (`lite|full|ultra|off`, `status`, `default <mode>`), `ponytail-review`, `ponytail-audit`, `ponytail-gain`, `ponytail-debt`, `ponytail-help`.

Mode persists as session custom `{ type: "ponytail-mode", mode }`. Active mode injects upstream `getPonytailInstructions` via `ponytail-mode` instruction injector. `stop ponytail` / `normal mode` deactivate without erasing history.

Full API docs: [docs/ponytail.md](../../docs/ponytail.md). Demo: `node examples/caveman-ponytail.ts`.
