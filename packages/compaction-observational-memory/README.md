# @arnilo/prism-compaction-observational-memory

Optional observational-memory compaction package for Prism.

Importing it is inert: it starts no workers, reads no settings or credentials, and makes no provider calls. Hosts can explicitly create a runtime to run observer/reflector/dropper workers against a supplied session/appendEntry/provider, and select the fast compaction strategy when desired.

Worker model selection follows Prism use-case model selection: pass optional `workerModel`, plus `sessionModel: agent.config.model` so workers fall back to the session model when unset. Use `requireExplicitModel: true` to keep the historical `missing_model` skip.

```ts
import {
  createObservationalMemoryCommands,
  createObservationalMemoryCompactionStrategy,
  createObservationalMemoryRuntime,
  createRecallMemoryTool,
} from "@arnilo/prism-compaction-observational-memory";

const memory = createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  workerProvider,
  sessionModel: agent.config.model,
  // workerModel: { provider: "mock", model: "memory" }, // optional override
  maxWorkerTurns: 8,
  maxWorkerToolCalls: 64,
  maxWorkerResultBytes: 64 * 1024,
  overrides: { observeAfterTokens: 10_000, thinkingLevel: "low" },
});

await memory.flush();
// Defaults: 16 turns, 32 calls/turn, 128 calls total, 64 KiB arguments/results,
// 1 MiB transcript, and 1 KiB surfaced errors. Every limit has a finite hard cap.
await session.compact({ strategy: createObservationalMemoryCompactionStrategy() });

const getEntries = (sessionId: string) => sessions.get(sessionId)?.entries() ?? [];
const recall = createRecallMemoryTool({ getEntries });
const commands = createObservationalMemoryCommands({ getEntries });
```
