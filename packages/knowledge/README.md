# @arnilo/prism-knowledge

> **Experimental in 0.13.0.** Install with `bun add @arnilo/prism-knowledge@experimental`. Outside the [stability promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md) of the stable packages: its API, config, preset contents and defaults may change or be removed in any release until it graduates. Graduation is the memory track's final step, which sets the first stable version.

```sh
bun add @arnilo/prism-knowledge@experimental
```

```ts
import wiki from "@arnilo/prism-knowledge/wiki";
import rag from "@arnilo/prism-knowledge/rag";
```

Import the [wiki](wiki/README.md) or [RAG](rag/README.md) explicitly; there is no root entry. The wiki reads memory through its existing read-only port. Web ingestion requires the optional `@arnilo/prism-tools` peer; PostgreSQL requires `pg`. Neither capability loads into a host by default.
