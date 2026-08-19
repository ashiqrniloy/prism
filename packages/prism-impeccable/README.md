# @arnilo/prism-impeccable

Optional Impeccable skill wiring for Prism. Host supplies `upstreamPath` to a tree with readable `SKILL.md` (`skills/impeccable/SKILL.md` or `SKILL.md` at the path, e.g. `dist/universal/impeccable`).

```ts
import { createImpeccableExtension } from "@arnilo/prism-impeccable";

await kernel.load([createImpeccableExtension({ upstreamPath: "/path/to/impeccable" })]);
```

No optional peer (`impeccable` on npm is the detector CLI). Does not spawn browsers, run `npx`, or write `PRODUCT.md`/`DESIGN.md`.
