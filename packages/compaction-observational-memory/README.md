# @arnilo/prism-compaction-observational-memory

Optional observational-memory compaction package for Prism.

Importing it is inert: no workers, settings reads, credentials, or provider calls until `createObservationalMemory().attach()` or `createObservationalMemoryRuntime().flush()`.

## Four layers

1. **Recent exact messages** — bounded suffix in provider context (`context.recentMessages`)
2. **Observation log** — source-backed facts from the observer worker
3. **Reflections** — consolidations from the reflector worker
4. **Raw-source retrieval** — exact-id recall and cursor paging on the current branch

## Quick start

```ts
import { createObservationalMemory } from "@arnilo/prism-compaction-observational-memory";

const om = createObservationalMemory({
  observation: { provider: observerProvider, model: observerModel },
  reflection: { provider: reflectorProvider, model: reflectorModel },
  context: { compactAfterTokens: 81_000, recentMessages: 8 },
});
const attached = om.attach(session, {
  appendEntry: (entry, options) => store.append(entry, options),
  sessionModel: agent.config.model,
});
await attached.session.run("Continue from prior work");
```

Runnable network-free demo: `node examples/observational-memory-lifecycle.ts` (from repo root).

See [docs/compaction-observational-memory.md](../../docs/compaction-observational-memory.md) and [docs/migration.md](../../docs/migration.md) (`0.1.4 → 0.1.5` for the removed flat keys / worker aliases, `0.0.18 → 0.0.19` for the original nesting migration).
