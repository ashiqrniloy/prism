# @arnilo/prism-caveman

Optional Caveman behavior integration for Prism (**0.0.22**).

Importing is inert: no skills, commands, timers, or network until the host loads the extension via `kernel.load([createCavemanExtension(...)])`.

## Requirements

- A local checkout of [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) (not published on npm).
- Host-supplied `upstreamPath` pointing at that checkout (must contain a `skills/` directory).
- Session callbacks (`appendEntry`, `getEntries`) for level persistence — same pattern as observational memory `attach`.
- Peer `@arnilo/prism@0.0.22`.

## Quick start

```ts
import { createCavemanExtension } from "@arnilo/prism-caveman";
import { createExtensionKernel, createLoadSkillTool, createLoadedSkillSet, createSkillRegistry } from "@arnilo/prism";

const caveman = createCavemanExtension({
  upstreamPath: "/path/to/caveman",
  defaultLevel: "full",
  appendEntry: (entry, options) => store.append(entry, options),
  getEntries: () => session.entries(),
});

await kernel.load([caveman]);
// Select instruction injector "caveman-mode" on runs that should receive level slices.
// Register createLoadSkillTool + skillsDisclosure: "progressive" for catalog-only skill bodies.
```

Registers upstream skills, level commands, `caveman-mode` injector (filtered `skills/caveman/SKILL.md`), and session custom `caveman-level` persistence.

Full API docs: [docs/caveman.md](../../docs/caveman.md). Demo: `node examples/caveman-ponytail.ts`.
