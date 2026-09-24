# Migrate Prism 0.10 to 0.11

> **Status: 0.11.0** (store bounds, in-memory lease fence reset, persona and graft subpath removals).

This document is the host checklist for upgrading from Prism 0.10.0 to 0.11.0.

0.11.0 is a lockstep minor for all **twelve** publishable packages. Node `>=22` stays the floor. No new public export was added by the review remediation. Two store contracts change for every host that uses the built-in memory or JSONL stores, or the in-memory lease store. Three subpaths that the published 0.10.0 tarball still shipped are removed.

---

## Behavior changes

### 1. Idempotency dedup remembers 4,096 keys

The memory session store and the JSONL session store keep the latest 4,096 dedup keys (`sessionId`, `idempotencyKey`, `expectedParentId`). A replay inside that window is still rejected. A replay of a key that has fallen out of the window appends a new entry.

```ts
// before — every dedup key was kept for the life of the store
await store.append(entry); // same idempotencyKey always rejected

// after — only the latest 4,096 keys are remembered
await store.append(older); // appends again once 4,096 newer keys have been seen
```

**Migration actions**
- Do not treat idempotency rejection as permanent across a long-lived process. Persist the business result yourself if a replay after 4,096 later keys must stay a no-op.
- Durable SQLite and Postgres stores are unchanged by this window.

### 2. An evicted in-memory lease starts at fencing 1

`docs/operations.md` used to say every expired row keeps its fencing counter. That remains true for the SQLite and Postgres lease adapters. The in-memory lease store now deletes expired rows once the map reaches 1,024, on write paths only.

```ts
// before — a released key always inherited fencingToken + 1
const again = await leases.tryAcquireLease(sameKey); // fencingToken === previous + 1

// after — a key still in the map inherits + 1; a swept key starts at 1
const swept = await leases.tryAcquireLease(evictedKey); // fencingToken === 1
```

**Migration actions**
- Do not assume an in-memory fencing token grows for the life of the process. A token of 1 can mean "first owner" or "owner after a sweep".
- A released key that has not been swept still inherits `fencingToken + 1`.
- Hosts on SQLite or Postgres need no change.

### 3. Persona and graft subpaths are gone

`@arnilo/prism-coding-tools/caveman`, `@arnilo/prism-coding-tools/ponytail`, and `@arnilo/prism-memory/graft` are not in this line. The published 0.10.0 tarball still had them. Load persona skills with `loadSkillDirectory` from a host extension. Reach graft through a host MCP server or `registerTool` / `registerCommand`. `@arnilo/prism-coding-tools/impeccable` and the memory `/rag`, `/compaction/*`, `/fabric`, `/wiki`, and `/scoped` subpaths are unchanged. The name-level removal list is in [migration.md](migration.md).

### Unchanged for hosts that only call the runtime

`readBranchPath` on the memory store and the JSONL parse cache change cost, not results, except for the same-size/same-mtime JSONL residual named above. Plain-text token estimates share one `ceil(length/4)` helper. Message and entry estimates are unchanged and are not billing numbers.

---

## Upgrade steps

1. Move every `@arnilo/*` dependency and peer to `^0.11.0`.
2. If you import `/caveman`, `/ponytail`, or `/graft`, switch to the host-owned seams before installing.
3. If you persist idempotency by relying on an unbounded in-memory or JSONL dedup set, store the result yourself.
4. If you compare in-memory lease fencing tokens for "never reused", treat a swept key's `1` as a new counter.

## Rollback

Install the published `0.10.0` tarballs. That line still has the three subpaths, an unbounded idempotency set, and no in-memory lease sweep. Do not point `^0.11.0` peers at a `0.10.0` install.
