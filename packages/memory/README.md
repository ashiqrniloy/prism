# @arnilo/prism-memory-system

> **Stable session memory, experimental tiers.** The session tier (STM, session compaction, `recall`) is under the [stability promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md). Working memory, rehearsal, long-term memory, sleep and the episode scope are experimental config that may change or be removed in any release ([Config stability](system/README.md#config-stability)).

```sh
bun add @arnilo/prism-memory-system
```

```ts
import memory from "@arnilo/prism-memory-system";
import { createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
```

The [memory system](system/README.md) is the default package entry. [Core](core/README.md) is a plain library, with `/core/fabric`, `/core/sqlite` and `/core/postgres` store entries. PostgreSQL requires the optional `pg` peer. Importing an entry loads only its own code and dependencies. The bundle adds no embeddings or default host wiring.
