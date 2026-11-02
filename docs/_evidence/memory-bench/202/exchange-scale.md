# Exchange store scale — 100k exchanges

Measured 2026-11-02 with:

```sh
PRISM_TEST_POSTGRES_URL=postgres://... bun scripts/memory-bench/exchange-scale.mjs --store sqlite,postgres --exchanges 100000
```

## Environment and method

Bun 1.4.4; Linux-7.3.0-4-cachyos-x86_64-with-glibc2.44; AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics. SQLite used a fresh file under `/tmp` (tmpfs); Postgres
used an isolated throwaway schema on a local PostgreSQL 18.6 server with the `vector` extension.
SQLite writes were one 1,000-row `upsert` batch at a time; the Postgres run used the same batch size.
Query timing starts after seeding. Each store answered 200 lexical queries cycling `token0`..`token999`
with `topK=5`, asserting a nonempty result. Bodies are bounded synthetic exchanges; no model,
embedding service, fabric turn, tool serialization or agent latency is included. This is a store
envelope, not an end-to-end chat latency claim.

## Results

All latency values are milliseconds.

| Store | Exchanges | Seed write total | Query p50 | Query p95 |
| --- | ---: | ---: | ---: | ---: |
| sqlite | 100,000 | 2393 | 0.533 | 1.063 |
| postgres | 100,000 | 21231 | 2.954 | 4.148 |

**Criterion (pre-registered): p95 lexical recall ≤ 100 ms at 100k exchanges on both stores.
PASS**

The SQLite query path was changed during this measurement: it now caches a scope's fallback
generation until a write clears it, and computes coverage from the stored analyzed terms instead of
re-tokenizing every returned record. Before the cache, a scope with no generation pointer paid a full
JSON max scan on every query; the 100k p95 was 156.7 ms. Neither change affects ranking or returned
records.

## Raw output

```json
{
  "schemaVersion": 1,
  "metric": "p95 lexical recall over the vector store",
  "exchanges": 100000,
  "results": [
    {
      "store": "sqlite",
      "exchanges": 100000,
      "writeMs": 2393.4,
      "querySamples": 200,
      "queryP50Ms": 0.533,
      "queryP95Ms": 1.063
    },
    {
      "store": "postgres",
      "exchanges": 100000,
      "writeMs": 21231.11,
      "querySamples": 200,
      "queryP50Ms": 2.954,
      "queryP95Ms": 4.148
    }
  ],
  "criterion": {
    "p95MsMax": 100,
    "pass": true
  }
}
```
