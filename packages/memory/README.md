# @arnilo/prism-memory-system

> **Experimental in 0.13.0.** Install with `bun add @arnilo/prism-memory-system@experimental`. Outside the [stability promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md) of the stable packages: its API, config, preset contents and defaults may change or be removed in any release until it graduates. Graduation is the memory track's final step, which sets the first stable version.

```sh
bun add @arnilo/prism-memory-system@experimental
```

```ts
import memory from "@arnilo/prism-memory-system";
import { createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
```

The [memory system](system/README.md) is the default package entry. [Core](core/README.md) is a plain library, with `/core/fabric`, `/core/sqlite` and `/core/postgres` store entries. PostgreSQL requires the optional `pg` peer. Importing an entry loads only its own code and dependencies. The bundle adds no embeddings or default host wiring.
