# @prism/compaction-observational-memory

Optional observational-memory compaction package for Prism.

Importing it is inert: it starts no workers, reads no settings or credentials, and makes no provider calls. Hosts can explicitly create a runtime to run observer/reflector/dropper workers against a supplied session/store/provider, and select the fast compaction strategy when desired.

```ts
import {
  createObservationalMemoryCommands,
  createObservationalMemoryCompactionStrategy,
  createObservationalMemoryRuntime,
  createRecallMemoryTool,
} from "@prism/compaction-observational-memory";

const memory = createObservationalMemoryRuntime({
  session,
  store,
  workerProvider,
  workerModel: { provider: "mock", model: "memory" },
  overrides: { observeAfterTokens: 10_000 },
});

await memory.flush();
await session.compact({ strategy: createObservationalMemoryCompactionStrategy() });

const getEntries = (sessionId: string) => sessions.get(sessionId)?.entries() ?? [];
const recall = createRecallMemoryTool({ getEntries });
const commands = createObservationalMemoryCommands({ getEntries });
```

## Security and performance

- No package discovery or automatic activation.
- No credential or environment reads on import.
- Workers run only after explicit runtime activation and `flush()`.
- Compaction renders existing memory without a provider call.
- Extension setup registers inert contributions only.
- Recall tool is exact-id only; commands read only host-supplied entries.
- No network, filesystem, worker, timer, vector store, or semantic search by default.
