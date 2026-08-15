# Indexed code search

Optional host-owned incremental search index for `repo_search` (plan 026 Task 2, `@arnilo/prism-coding-agent`). The index is a seam: Prism defines the contract, validates requests and results, and scopes identity and freshness — the host owns persistence, build, watch, and any embedding/ranking engine. There is no bundled index engine, vector store, watcher daemon, or embedding SDK.

## Activation

Nothing starts on import or construction. A host builds and updates the index explicitly through the facade:

```ts
import { createIndexedRepositoryOperations, createGitAwareRepositoryOperations } from "@arnilo/prism-coding-agent";

const operations = createIndexedRepositoryOperations(cwd, {
  index: hostIndex, // RepositoryIndexBackend
  fallback: createGitAwareRepositoryOperations(cwd),
  allowedModes: ["literal", "indexed_literal", "semantic"],
  stale: { maxAgeMs: 60_000, requireSourceRevision: true },
});

await operations.index.update({ repositoryId, worktreeId, sourceRevision, changes });
await operations.index.remove({ paths });
await operations.index.status();
await operations.index.dispose();
```

The returned object is a `RepositoryOperations` with an added `index` facade. `mode: "literal"` routes to the fallback unchanged; `indexed_literal` and `semantic` are served only by the host backend.

## Backend contract

`RepositoryIndexBackend`:

- `capabilities.semantic` — explicit declaration; semantic mode is never duck-typed.
- `update(request)` — add/edit changes with `repositoryId`/`worktreeId`/`sourceRevision` (bounded, never credential-bearing).
- `remove(request)` — drop paths.
- `search(request)` — bounded query with `mode`, optional repo-relative `path` scope, `maxResults`, `signal`, `deadlineMs`.
- `status()` — state `empty | building | ready | stale | failed`, `sourceRevision`, `updatedAt`.
- `dispose()`.

Index state machine is frozen: `empty | building | ready | stale | failed`.

## Mode semantics

- `literal` (default): native bounded substring search; byte-identical behavior to a host without an index.
- `indexed_literal`: host index result, relevance scores.
- `semantic`: host semantic search; requires `capabilities.semantic === true`.

Missing capability, mode not in `allowedModes`, stale revision, or failed index returns a stable `ERR_PRISM_INDEX_*` error. There is **no silent fallback** that changes query meaning — an index result is never replaced by a literal scan behind the caller's back.

`createRepoSearchTool(cwd, { operations, modes })` exposes exactly the modes listed in `modes` (default `["literal"]`); the JSON schema `enum` matches.

## Stale-index and freshness

`stale: { maxAgeMs, requireSourceRevision }`:

- `maxAgeMs` (default 60 000, hard 300 000): queries fail with `ERR_PRISM_INDEX_STALE` when `updatedAt` is absent or older than the window.
- `requireSourceRevision: true`: queries fail when the index does not attest a `sourceRevision`.

State `empty`/`building` also fail stale; state `failed` fails with `ERR_PRISM_INDEX_FAILED`; unknown states fail closed. The stale-index contract refuses to serve rather than silently degrade. Hosts choose the window; the default is deliberately conservative.

## Trust

Index output is untrusted:

- every hit path is containment-checked under the repository root and the requested path scope (absolute paths, `..` escapes, backslashes, and scope escapes fail with `ERR_PRISM_INDEX_UNTRUSTED`);
- scores must be finite and in `[0, 1]`, otherwise fail closed;
- duplicate paths are deduped (first wins);
- snippets are truncated to the byte cap (default 4096, hard 16384);
- result count is capped (default 1000, hard 10000);
- results carry `indexed` provenance (mode/state/sourceRevision/updatedAt) and `untrusted_index: true` — consumers must not treat index text as fact; mutations still require a fresh read/policy.

Backend throws are mapped to generic `ERR_PRISM_INDEX_FAILED` without embedded backend error text; query deadline (default 30 s, hard 120 s) and abort map to `ERR_PRISM_INDEX_TIMEOUT`.

## Update caps

Per update: 1000 changes default / 10000 hard, 16 MiB / 64 MiB total request bytes (paths, old paths, revision, ids). `rename` is routed as remove of the old path plus add of the new; `delete` routes to `remove`. Over-limit updates fail with `ERR_PRISM_INDEX_LIMIT` before any backend call.

## Errors

`ERR_PRISM_INDEX_UNSUPPORTED`, `ERR_PRISM_INDEX_STALE`, `ERR_PRISM_INDEX_FAILED`, `ERR_PRISM_INDEX_LIMIT`, `ERR_PRISM_INDEX_TIMEOUT`, `ERR_PRISM_INDEX_UNTRUSTED` (`IndexError`).

## Scale evidence

`scripts/phase26-index-benchmark.test.mjs` runs in the root test chain: a 100000-file metadata fixture, indexed query p95 ≤ 250 ms, 1000-file batch update ≤ 1 s, peak heap ≤ +64 MiB, semantic query bounded, and the literal baseline unchanged.
