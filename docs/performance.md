# Performance limits

Evaluation defaults are finite: 100 trace rows × 20 pages and 4 MiB aggregate trace data; one model-judge attempt with 30-second/16-KiB bounds; 8 comparison candidates, 1-MiB candidate results, 10,000 dataset items, and 4-MiB serialized reports. Hard caps are exported by `@arnilo/prism-evals`; overflow fails rather than truncating grading evidence.

## What it does

This page states Prism runtime limits that keep slow consumers and long sessions from becoming unbounded memory or latency problems.

## Release 0.0.12 frontend interoperability caps and evidence

`@arnilo/prism-ag-ui` uses finite handler/projection limits, all defaults / hard: request 64 KiB / 1 MiB; input 128 / 1024 messages and 64 KiB / 1 MiB text; event 64 KiB / 1 MiB; error 8 KiB / 64 KiB; replay cursor 4 / 16 KiB; replay page 100 / 500; subscriber queue 128 / 4096; stream 10,000 / 100,000 events and 10 / 64 MiB; request wall time 120 seconds / 30 minutes. Tool arguments/results/progress, frontend tools, and mutable frontend state default to zero exposure; hosts may only add bounded safe projection.

Reconnect is one ownership-scoped redacted durable page plus an optional bounded live subscriber. It is at-least-once at a page boundary, never a polling loop or terminal-run rerun. ACP uses the same event/byte/queue caps. Coding compaction reuses LLM summary/reserve/error/file-operation bounds (16,384 / 131,072 summary and reserve tokens; 1 / 8 KiB summary errors) and makes no additional provider call.

Run `node scripts/benchmark-0.0.12.mjs`; `PRISM_BENCH_ITERATIONS` accepts 10–100,000 (default 100). Schema/bounds test: `node --test scripts/benchmark-0.0.12.test.mjs`. Default mode is network-free and reports mapper/handler/replay throughput and p50/p95, peak emitted queue rows, event bytes, heap, and coding-preparation overhead. Bounds and hostile-input fixtures—not these host-local timings—are release gates.

2026-07-22 baseline: Node v24.18.0, Linux x64, 100 iterations/scenario, network=false, credentials=false.

| Scenario | mode | ops/s | p95 ms | heap bytes | peak queue events | event bytes | cost USD | backpressure | resource limits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AG-UI mapper | in-process | 23,561 | 0.0398 | 12,029,512 | 2 | 166 | 0 | 0 | 0 |
| AG-UI handler | web-in-process | 1,401 | 2.2651 | 19,545,416 | 5 | 508 | 0 | 0 | 0 |
| AG-UI replay | memory-page | 6,094 | 0.3047 | 19,098,240 | 2 | 243 | 0 | 0 | 0 |
| Coding compaction preparation | in-process | 75,515 | 0.0291 | 20,585,408 | 1 | 208 | 0 | 0 | 0 |

No network, credentials, provider summary call, durable database, or live subscriber is involved. These values are dated local comparison evidence, not portable thresholds.

## Release 0.0.11 session search / context budget / steer caps

Finite caps (defaults / hard) — full matrix in [Phase 6 evidence](review-coverage-2026-07-22-phase-6.md):

| Resource | Default / hard |
| --- | --- |
| Session search page | 20 / 100 |
| Search query string | 4 KiB / 16 KiB |
| Search snippet | 512 B / 4 KiB |
| Memory linear sessions / entries / bytes | 1000/5000 · 10000/50000 · 8 MiB/64 MiB |
| FTS candidates | 1000 / 5000 |
| Context budget tokens / bytes | caller-set / hard 2_000_000 tokens · 32 MiB |
| Context omission rows | 256 / 1024 |
| Pending steers | 8 messages / 64 KiB |

Run `node scripts/benchmark-0.0.11.mjs`; `PRISM_BENCH_ITERATIONS` accepts 10–100,000 (default 100). Schema/bounds test: `node --test scripts/benchmark-0.0.11.test.mjs`. Default mode is network-free: memory-linear `searchSessions` (label + query) plus assembler `contextBudget` eviction/fit. Emits environment, scenario mode, throughput, p50/p95 latency, heap, disk bytes, process counts, zero external cost, backpressure, and resource-limit signals. Search never default-scans an unbounded store; budget fails closed on mandatory prefix overflow; steer overflow fails closed. These are evidence fields, not CI timing gates.

## Release 0.0.10 reproducible workspace-mode evidence

Run `node scripts/benchmark-0.0.10.mjs`; `PRISM_BENCH_ITERATIONS` accepts 10–100,000 (default 100). Schema/bounds test: `node --test scripts/benchmark-0.0.10.test.mjs`. Default mode is network-free: host-composition write/read/list plus sandbox-fake composition write/read/list/search (in-memory `DisposableSandbox`). Emits environment, scenario mode, throughput, p50/p95 latency, heap, disk bytes, process counts, zero external cost, backpressure, and resource-limit signals. Optional `PRISM_BENCH_DOCKER=1` (with `PRISM_TEST_DOCKER_*`) appends real local Docker composition rows. Unified workspace mode reuses existing sandbox/repo hard caps and adds no unbounded host↔container sync. These are evidence fields, not CI timing gates.

## Release 0.0.9 reproducible coding/browser evidence

Run `node scripts/benchmark-0.0.9.mjs`; `PRISM_BENCH_ITERATIONS` accepts 10–100,000 (default 100). Schema/bounds test: `node --test scripts/benchmark-0.0.9.test.mjs`. Default mode is network-free fake/in-process only and emits environment, scenario mode, throughput, p50/p95 latency, heap, disk bytes, process counts, zero external cost, backpressure, and resource-limit signals for repository list/search, Git status, and browser open/snapshot/action/close. Optional `PRISM_BENCH_DOCKER=1` (with `PRISM_TEST_DOCKER_*`) and `PRISM_BENCH_PLAYWRIGHT=1` append real local Docker / protected Playwright rows. These are evidence fields, not CI timing gates.

2026-07-21 baseline: Node v24.18.0, Linux x64, 100 iterations/scenario, network=false, credentials=false, docker=false, playwright=false.

| Scenario | mode | ops/s | p95 ms | heap bytes | disk bytes | processes | cost USD | backpressure | resource limits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| repo-list | fake-in-process | 1,343 | 1.11 | 14,747,560 | 0 | 1 | 0 | 0 | 0 |
| repo-search | fake-in-process | 380 | 3.72 | 16,093,176 | 0 | 1 | 0 | 0 | 0 |
| git-status | fake-in-process | 479 | 2.62 | 13,821,688 | 0 | 1 | 0 | 0 | 0 |
| browser-open-snapshot-action-close | fake-in-process | 17,141 | 0.11 | 18,590,488 | 0 | 1 | 0 | 0 | 0 |

Rows exercise shipped repository/Git helpers and fake Playwright APIs only. Real Docker sandbox and Playwright browser timings remain explicit protected-gate evidence (`PRISM_TEST_DOCKER_SANDBOX=1`, `PRISM_LIVE_PLAYWRIGHT=1` / `PRISM_BENCH_DOCKER=1` / `PRISM_BENCH_PLAYWRIGHT=1`) because this release-candidate host did not enable those gates for the dated baseline. No live claim is inferred from skipped gates.

## Release 0.0.8 reproducible synthetic evidence

Run `node scripts/benchmark-0.0.8.mjs`; `PRISM_BENCH_ITERATIONS` accepts 10–100,000. Script uses no network/credentials and emits environment, throughput, p50/p95 latency, heap, synthetic disk bytes, zero external cost, and backpressure signals. These are evidence fields, not CI timing gates.

2026-07-20 baseline: Node v24.18.0, Linux x64, 1,000 operations/scenario.

| Scenario | ops/s | p95 ms | heap bytes | disk bytes | cost USD | backpressure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| provider envelope | 675,430 | 0.0026 | 10,974,296 | 0 | 0 | 0 |
| actual `createBatchedRunLedger` enqueue/flush | 514,493 | 0.0023 | 12,601,840 | 0 | 0 | 7 |
| one-entry snapshot-cache hit | 4,582,216 | 0.0001 | 10,072,656 | 0 | 0 | 0 |
| actual in-memory OTel agent span start/end | 295,372 | 0.0049 | 10,357,048 | 0 | 0 | 0 |
| PostgreSQL-ledger-shaped file workload | 494,403 | 0.0009 | 11,584,760 | 54,890 | 0 | 7 |
| MCP envelope | 1,243,254 | 0.0008 | 12,915,288 | 0 | 0 | 0 |
| A2A envelope | 961,492 | 0.0007 | 10,425,024 | 0 | 0 | 0 |
| web-tools envelope | 1,388,694 | 0.0007 | 11,734,208 | 0 | 0 | 0 |

Ledger and OTel rows exercise shipped implementations; cache row isolates the runtime's one-entry lookup shape. Provider/PostgreSQL/MCP/A2A/web rows remain local serialization/file envelopes and prove repeatability/schema/backpressure instrumentation only—not external latency, throughput, or billing. Real PostgreSQL correctness runs in protected CI; provider/MCP/A2A/web timings and costs remain explicit protected live-canary/release-host evidence because this release-candidate host has no credentials/endpoints. No live claim is inferred from skipped gates.

Security automation is isolated from `npm test`: CodeQL/supply-chain jobs have 10-minute backstops, dependency review and live workflow have 5-minute job backstops, live probe step has 3 minutes, SBOM is capped at 16 MiB/10,000 packages, packed release/security tarballs at 128 MiB aggregate, secret scan at 100,000 files/16 MiB each, and retained security/canary reports expire after 7 days. Live canaries issue four probes plus at most one MCP cleanup, cap responses at 64 KiB and requests at 15 seconds (30 seconds hard), and never enter `sdk:ready`.

Web tools default/hard ceilings are query 4/16 KiB, results 10/20, URLs 5/20, request 256 KiB/1 MiB, response/aggregate 2/16 MiB, Markdown 1/8 MiB, extraction 256 KiB/1 MiB, schema 64/256 KiB, concurrency 4/16, retries 2/4, polling 20/100, and wall time 60 seconds/30 minutes. Bounds charge before request, retention, retry, or polling; overflow fails rather than truncating citation/extraction evidence.

Docker sandbox defaults/hard caps from `@arnilo/prism-coding-security`: startup 30 s/120 s; wall 20 min/30 min; idle 5 min/15 min; CPUs 2/8; memory 2 GiB/16 GiB (swap equal to memory); PIDs 256/1,024; FDs 1,024/8,192; workspace/tmp/download tmpfs 1 GiB/8 GiB, 256 MiB/2 GiB, 64 MiB/512 MiB; commands 100/256 with concurrent execs 1/8; env 64/256 names and 64 KiB/256 KiB values; export 50,000/250,000 entries and 256 MiB/2 GiB bytes with 16/64 retained artifacts; stop grace 5 s/30 s and cleanup 30 s/120 s. Caps validate before `docker create`/exec/export; overflow aborts and cleans the recorded container. Output still streams into the coding-agent `OutputAccumulator` ceilings (64 MiB/1 GiB).

Repository list/search defaults/hard caps from `@arnilo/prism-coding-agent`: depth 32/128; entries/files 10,000/100,000; page/results 1,000/10,000; search scan 64 MiB/1 GiB aggregate and 8 MiB/64 MiB per file; matches 1,000/10,000; pattern 512 B/4 KiB; line 50 KiB/1 MiB; context 5/20; wall 30 s/300 s; concurrency config 8/32. Walks stream via `opendir`/`lstat`, never follow symlink escapes, and stop immediately on aggregate limits or abort.

Structured Git/check/handoff defaults/hard caps: paths 1,000/10,000; refs 1 KiB/4 KiB; commit message 64 KiB/256 KiB; inline Git output 4 MiB/64 MiB; diff lines 10,000/100,000; changed files 1,000/10,000; patch input 16 MiB/64 MiB; worktrees 4/16; named checks 8/32 names, concurrency 1/4, timeout 10 min/60 min, diagnostic lines 2,000/100,000, output 4 MiB/64 MiB; PR handoff JSON 256 KiB/1 MiB with 100/1,000 commits. Git tools use typed argument arrays (never shell), disable hooks/credential prompts/external diff by default, and emit host-owned PR handoff data only — no push/network/PR client.

Durable coding plan/checkpoint defaults/hard caps: plan Markdown 256 KiB/1 MiB; todos 1,000/10,000 with 512 B/4 KiB text; checkpoint metadata 64 KiB/512 KiB; artifact references 16/64 at 256 MiB/2 GiB each; check summaries 1 KiB/8 KiB. Checkpoints store URI/hash/summaries/fingerprints only; resume revalidates workspace root, base branch, plan hash, and tool/policy/image fingerprints before import.

Browser automation defaults/hard caps from `@arnilo/prism-browser`: pages 4/16; actions 100/256; queued actions 16/64; snapshot refs 2,000/10,000; depth 30/100; snapshot bytes 256 KiB/2 MiB; navigation 30 s/120 s; action 10 s/60 s; wait 30 s/120 s; run wall 20 min/30 min; popups 4/16; dialogs 16/64; listeners 64/256; action input 64 KiB/256 KiB; close grace 5 s/30 s; network requests 1,000/10,000 with 10/32 redirects per request and 8/32 WebSockets; screenshots 16/64 with 16/64 megapixels and 10 MiB/32 MiB encoded; uploads 8/32 files, 16 MiB/64 MiB each, 64 MiB/256 MiB aggregate; downloads 8/32 files, 32 MiB/256 MiB each, 64 MiB/512 MiB aggregate. Caps charge before context/page/action/queue/snapshot/network/artifact retention. Host supplies Playwright and egress proxy attestation; package import launches nothing.

Current surfaces:

- `SubscribeOptions` for bounded live `AgentEvent` subscriber queues.
- Bounded provider transport primitives (`readSseEvents`, `readBoundedResponseText`) used by every first-party provider package — see [Provider primitives](provider-primitives.md).
- `SessionStore.readBranchPath(query)` for branch reads that avoid full-session scans.
- `ProductionPersistenceStore` cursor queries for entries, events, runs, tool calls, and usage.
- JSONL and memory stores documented as development/local adapters, not production multi-writer stores.

## When to use it

Use these limits when embedding Prism in a UI, API server, job worker, or multi-tenant app that may have slow event consumers or long-lived sessions.

Do not treat Prism's live event subscribers as a durable queue. Use `RunLedger` / database persistence for replay, audit, billing, and timelines.

## Inputs / request

```ts
import { createAgent, type SubscribeOptions } from "@arnilo/prism";

const options: SubscribeOptions = {
  maxQueuedEvents: 256,
  overflow: "close",
};

const events = session.subscribe(options);
```

`SubscribeOptions` fields:

| Field | Default | Purpose |
| --- | --- | --- |
| `maxQueuedEvents` | `1024` | Maximum events queued for one subscriber while it is not awaiting `next()`. Values below `1` are clamped to `1`. |
| `overflow` | `"close"` | Overflow policy: `"close"`, `"drop_oldest"`, or `"drop_newest"`. |

## Outputs / response / events

On default overflow, the affected subscriber receives one `event_subscriber_overflow` event and then finishes:

```json
{
  "type": "event_subscriber_overflow",
  "sessionId": "session_1",
  "droppedEvents": 257,
  "maxQueuedEvents": 256,
  "overflow": "close"
}
```

`drop_oldest` keeps the newest queued events. `drop_newest` ignores incoming events while the queue is full. These policies are live-view policies only; they do not affect `RunLedger` writes or stored session entries.

## Request/response example

```json
{
  "subscribe": { "maxQueuedEvents": 256, "overflow": "close" },
  "store": "database-backed SessionStore with readBranchPath",
  "eventLedger": "cursor-paginated by runId and sequence"
}
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
});

const session = agent.createSession();
const reader = (async () => {
  for await (const event of session.subscribe({ maxQueuedEvents: 256, overflow: "close" })) {
    if (event.type === "event_subscriber_overflow") break;
    render(event);
  }
})();

await session.run("Hi");
await reader;

function render(_event: unknown) {}
```

For production branch reads, implement `SessionStore.readBranchPath` instead of loading every entry:

```ts
const store = {
  async append(entry, options) { /* transaction + parent/idempotency checks */ },
  async list(sessionId) { /* development fallback only */ return []; },
  async readBranchPath(query) {
    // Use one ancestor query / recursive CTE and return a cursor page.
    return { items: [], nextCursor: undefined };
  },
};
```

## Extension and configuration notes

- `SubscribeOptions` is per subscriber. One slow UI can be closed or dropped without affecting other subscribers, the active run, ledger writes, or session storage.
- `RunLedger` remains the durable event/timeline surface. Hosts may batch inside their ledger adapter, but Prism awaits ledger writes at safe boundaries; preserve per-run event order before acknowledging a batch.
- Database-backed stores should implement `readBranchPath` and cursor-paginated `ProductionPersistenceStore` queries. Memory and JSONL stores intentionally use full-session/file reads.
- Cursor pagination should use indexed keys, not offsets: `(run_id, sequence)` for events, `(session_id, started_at, id)` for runs, `(run_id, recorded_at, id)` for usage, and `(session_id, timestamp, id)` for entries.
- Hosts own queue sizes, page-size caps, database indexes, connection pools, transaction timeouts, retention jobs, partitioning, and multi-process coordination.

## Security and performance notes

- Overflow events contain only counts and policy, never message text, tool arguments, prompts, provider payloads, or credentials.
- Runtime event payloads can be large (`Message`, content deltas, tool results, summaries, artifact metadata). Size queues by events and keep payload size in mind.
- `toolConcurrency` on the single-shot loop bounds in-flight tool dispatches per provider turn to `min(toolConcurrency, calls.length)`. Independent slow tools can overlap; transcript appends remain ordered. Default `1` preserves sequential behavior.
- `read` image bounds: default `maxImageBytes` is 10 MB (`DEFAULT_MAX_IMAGE_BYTES`). Oversize images are rejected by `stat` before read when possible; hosts may supply `transformImage` for resize/re-encode without adding image-processing deps to the base package.
- Live subscriber queues are bounded by default. Durable replay belongs to host storage.
- `SessionStore.list(sessionId)` is a full-session read. It is fine for memory/JSONL development stores, but production adapters should use `readBranchPath` for provider context and branch views.
- The JSONL store rereads/parses the file for validation/list/get and serializes appends only within one process. It has no cross-process lock, pagination, migrations, tenant isolation, or retention.
- Recommended database indexes: session id, run id, parent id, branch leaf id, timestamps, tenant/account/user, event type, entry kind, `(run_id, sequence)` for event timelines, and `(run_id, recorded_at, id)` for usage. Allocate event `sequence` per run for stable timeline pagination.
- Provider SSE parsing defaults: 256 KiB per completed event, 512 KiB incomplete buffer, 64 KiB error response bodies. Override per call via `BoundedStreamLimits` on `@arnilo/prism/providers/transport`.

### Provider-phase benchmark snapshot (2026-07-14)

Node v24.18.0, Linux x86_64, AMD Ryzen 9 PRO 7940HS; local synthetic streams, no network or exporter I/O:

| Case | Result |
| --- | --- |
| `readSseEvents`, 16 MiB total as 4 KiB events | 380 MiB/s, +1.7 MiB end-of-run heap delta |
| 100 provider deltas with 1 ms transport delay, no telemetry | 107.97 ms median |
| Same run, disabled adapter attached | 107.25 ms median (-0.67%, noise) |
| Same run, enabled no-op exporter | 107.22 ms median (-0.70%, noise) |

Nine measured runs per telemetry mode after warm-up; table reports median. A zero-I/O burst of 5,000 deltas measured 1.06 ms without telemetry and 2.09 ms with the adapter: about 1 ms absolute adapter cost, but a large percentage against an unrealistically tiny baseline. No span is created for message deltas. Add subscriber-side event filtering only if measured high-frequency in-memory streams make that ceiling material.

Configured overflow behavior is enforced by `src/__tests__/provider-transport.test.ts` for event, incomplete-buffer, response-body, argument, and abort limits.

### 0.0.4 release audit snapshot (2026-07-14)

Node v24.18.0 on the same Linux x86_64 / Ryzen 9 PRO 7940HS host. Results are medians of 7-9 warm runs unless the row describes file/database appends. Synthetic operations use local memory/files only. These numbers are release ceilings and comparison points, not cross-machine guarantees.

| Surface | Workload | Result | 0.0.4 release threshold |
| --- | --- | --- | --- |
| Run ledger | One mock run, 500 text deltas, 510 total records | 1.19 ms with in-memory ledger vs 0.17 ms without; +1.02 ms absolute; event append max concurrency 1 | < 10 ms with zero-I/O adapter; event appends remain serialized |
| JSONL store | 500 sequential label appends, including fail-closed reread/validation | 141.10 ms; 3,544 appends/s | < 500 ms; development/single-process only |
| JSON Schema compile cache | 5,000 validations through one warm adapter | 4.97 ms; 0.99 µs/validation | < 25 µs/validation |
| JSON Schema cold compile | 100 new adapters + first validation | 249.89 ms; 2.50 ms/compile | Warm cache must remain at least 20x faster than cold compile |
| Parallel tools | Six independent 20 ms calls | concurrency 1: 121.12 ms; concurrency 2: 60.92 ms; 1.99x speedup | concurrency 2 < 75% of sequential; configured worker cap remains enforced |
| SQLite session store | 1,000 sequential transactional label appends | 31.84 ms; 31,405 appends/s | < 250 ms on local SSD/tmp storage |
| Secret redaction | 10,000 shallow objects containing one known secret | 4.79 ms; 2.09 million objects/s | < 25 ms |
| Credential KDF | Default scrypt + AES-256-GCM encryption | 48.09 ms median | 20-250 ms; security floor stays `N >= 16,384` |
| Workflow runner | Existing bounded 1,000-node DAG fixture | 27.68 ms in aggregate release gate | < 1 s; no rescan failure |

Provider SSE remained at the frozen 380 MiB/s / +1.7 MiB heap snapshot. Media and MCP retain 10 MB defaults and finite timeout/total-byte guards; their malicious-input and oversize fixtures pass. PostgreSQL latency remains environment-dependent and is gated by transactional conformance in CI rather than a hardware-specific wall-clock assertion.

The ledger percentage overhead is intentionally not a threshold: its no-ledger baseline is below 1 ms, making the percentage unstable while absolute added latency remains about 1 ms. JSONL's append path is intentionally O(n²) across repeated appends because it rereads for corruption/conflict checks; move production or high-volume workloads to SQLite/PostgreSQL rather than weakening validation.

### 0.0.5 Phase 0 baseline (2026-07-15)

Scope froze at commit `f5128a816ae204c52f3e2f089de71c99bd5de6d4`. Measurement host: Node v24.18.0, npm 11.16.0, Linux 7.1.3 x86_64, AMD Ryzen 9 PRO 7940HS (16 logical CPUs). Supported package runtime remains Node >=20. These are dated local comparison points, not portable CI wall-clock assertions.

| Surface | Workload | Result |
| --- | --- | --- |
| Network-free tests | `npm test` | 25.750 s; 1,475 tests, 1,450 pass, 25 explicit live skips, 0 fail |
| Release readiness | `npm run sdk:ready` | 54.341 s; typecheck, tests, examples, builds, and 24 dry-run packs pass |
| Provider/agent stream | One mock run with 5,000 one-character text deltas and a concurrently drained 8,192-event subscriber | 3.78 ms median |
| Tool dispatch | Six independent 20 ms tools, concurrency 1 | 121.05 ms median |
| Tool dispatch | Same calls, concurrency 2 | 60.65 ms median (2.00x speedup) |
| Workflow runner | Existing bounded 1,000-node chain, configured concurrency 8 | 9.66 ms median |
| Package artifacts | All 24 dry-run tarballs | 542,993 packed bytes; 2,084,900 unpacked bytes aggregate |
| Root artifact | `@arnilo/prism@0.0.4` dry-run tarball | 346.0 kB packed; 1.3 MB unpacked; 196 files |
| Installed workspace | Current root `node_modules` | 72 MiB |

Synthetic stream/tool/workflow values are medians of seven measured runs after one warm-up and contain no network, database, or exporter I/O. The temporary benchmark reused public `AgentSession`, `dispatchToolCallsInOrder`, and `@arnilo/prism-workflows` APIs; it was not added to CI because this phase records a baseline rather than creating hardware-sensitive tests.

Repository size at the same commit, counted from `src/` and `packages/` while excluding `dist/`:

| Area | Files | Lines |
| --- | ---: | ---: |
| Production TypeScript | 189 | 26,828 |
| Test TypeScript | 144 | 23,535 |
| Documentation Markdown | 70 | 12,662 |
| Numbered plans | 58 | 24,270 |
| TypeScript examples | 39 | 3,134 |

Prism has no project generator before Phase 5, so a generated-Prism-project install/build size is **not applicable** at this baseline. The closest current install figure is the 72 MiB development workspace; it is not a scaffold target. The comparison Mastra default scaffold measured during the review used 439 MB `node_modules`, 300 MB build output, and 427 installed packages. Phase 5 must establish a real generated Prism project baseline and keep unselected storage, telemetry, eval, memory, server, and workflow dependencies absent.

See [Review coverage — 2026-07-15](review-coverage-2026-07-15.md) for scope, primitive, package, and threat-boundary ownership.

### 0.0.5 Phase 2 verification (2026-07-15)

Same Phase 0 host and seven-run warm benchmark. Runtime correctness changes stayed inside frozen ceilings:

| Surface | Result |
| --- | --- |
| Network-free tests | 27.992 s; 1,485 tests, 1,460 pass, 25 explicit live skips, 0 fail |
| `npm run sdk:ready` | 55.598 s; typecheck, examples, tests, builds, and all 24 dry-run packs pass |
| Provider/agent stream, 5,000 deltas | 3.54 ms median (Phase 0: 3.78 ms) |
| Six 20 ms tools, concurrency 1 / 2 | 121.22 ms / 60.63 ms (2.00x speedup retained) |
| Workflow 1,000-node chain | 10.31 ms median (well below 1 s ceiling) |
| Root dry-run tarball | 361.2 kB packed, 1.3 MB unpacked, 197 files |

Usage aggregation performs one constant-size accumulator update per terminal provider turn. Telemetry retains only active span metadata and removes every terminal/detached entry. Complete media resolution is sequential, rejects item count and inline estimates before I/O, and retains at most the request budget plus one per-item-bounded candidate before failing an aggregate overflow. Sandbox output still streams into the existing bounded `OutputAccumulator`; no adapter-side response buffer was added.

### 0.0.5 Phase 4 verification (2026-07-15)

Optional `@arnilo/prism-evals` adds package-local scoring without changing core run latency. Validation stayed within the frozen release gate:

| Surface | Result |
| --- | --- |
| Network-free tests | 1,503 tests, 1,478 pass, 25 explicit live skips, 0 fail |
| `npm run sdk:ready` | typecheck, examples, tests, builds, and all 25 dry-run packs pass |
| Evals dry-run tarball | 35.4 kB unpacked package payload |
| Profile bundles | unchanged; evals remains opt-in until size/use review |

Experiment concurrency is capped at 32 workers and defaults to 1. Scorers operate on `AgentRunResult` references plus dataset item metadata rather than duplicating event ledgers.

### 0.0.5 Phase 5 verification (2026-07-15)

`prism init` lands as a stdlib-only CLI subcommand with checked-in templates under `templates/init/`.

| Surface | Result |
| --- | --- |
| Default generated sources | 8 files / ~3.3 KB |
| Default clean consumer install (`@arnilo/prism` + TypeScript tooling) | ~27.5 MB `node_modules` |
| Mastra comparator | 439 MB install / 300 MB build / 427 packages |
| Default dependencies | `@arnilo/prism` only; no storage, telemetry, eval, memory, server, or workflow packages unless `--with-*` / provider flags select them |
| Offline proof | packed core tarball → `npm install` → `npm run typecheck` → `npm test` (mock provider) |

### 0.0.5 Phase 6 verification (2026-07-15)

Optional `@arnilo/prism-provider-ai-sdk` adapts AI SDK `LanguageModelV4` streams to Prism without adding an AI SDK dependency to core.

| Surface | Result |
| --- | --- |
| Supported specification | `@ai-sdk/provider@^4` (`LanguageModelV4`) |
| Adapter behavior | incremental stream translation; unsupported content fails before `doStream`; abort owned by Prism `request.signal` |
| Network-free tests | 1,522 tests, 1,497 pass, 25 explicit live skips, 0 fail |
| `npm run sdk:ready` | typecheck, examples, tests, builds, and all 26 dry-run packs pass |
| AI SDK adapter dry-run tarball | 6.5 kB packed / 22.5 kB unpacked / 16 files |
| Profile bundles | unchanged; AI SDK adapter remains opt-in until size/use review |
| Publishable graph | 26 packages |

### 0.0.5 Phase 7 verification (2026-07-15)

Optional `@arnilo/prism-memory` adds working memory and semantic recall without changing core session stores.

| Surface | Result |
| --- | --- |
| Contracts | package-owned `Embedder`, `VectorStore`, `WorkingMemoryStore`, `createMemory` |
| Adapters | in-memory reference + PostgreSQL/pgvector production path |
| Injection | existing `ContextProvider` seam; opt-in working-memory processor |
| Profile bundles | unchanged; memory remains opt-in until size/use review |
| Publishable graph | 27 packages |
| Network-free tests | 1,538 tests, 1,513 pass, 25 explicit live skips, 0 fail |
| `npm run sdk:ready` | pass |
| Memory dry-run tarball | 17.9 kB packed / 76.6 kB unpacked / 32 files |

### 0.0.5 Phase 8 verification (2026-07-15)

Durable human suspension extends existing workflow checkpoint JSON/CAS; no worker polling loop, package, dependency, or database migration was added.

| Surface | Result |
| --- | --- |
| Focused workflow suite | 43 tests pass, 0 fail |
| Network-free tests | 1,547 tests, 1,522 pass, 25 explicit live skips, 0 fail |
| `npm run sdk:ready` | typecheck, examples, tests, builds, and all 27 dry-run packs pass |
| Workflow dry-run tarball | 25.7 kB packed / 121.6 kB unpacked / 34 files |
| Coordinator behavior | `suspended` absent from queued/running poll; zero worker/lease retained |
| Storage | existing bounded checkpoint JSON/category; no SQLite/PostgreSQL migration |

### 0.0.5 Phase 9 verification (2026-07-16)

Optional `@arnilo/prism-rag` reuses Phase 7 vector contracts and adds no core path, parser dependency, network loader, or profile activation.

| Surface | Result |
| --- | --- |
| Focused RAG suite | 9 tests pass, 0 fail |
| Network-free tests | 1,561 tests, 1,536 pass, 25 explicit live skips, 0 fail |
| `npm run sdk:ready` | typecheck, examples, tests, builds, and all 28 dry-run packs pass |
| RAG dry-run tarball | 9.0 kB packed / 34.6 kB unpacked / 22 files |
| Index bounds | chunk/document/count/metadata caps; embed batches default 32, hard 128 |
| Retrieval bounds | top-K default 5/hard 32; candidates default 20/hard 128; result 64/512 KiB; context 2,000/8,000 estimated tokens |
| Profile bundles | unchanged; RAG and memory remain explicit opt-ins |

### 0.0.5 Phase 10 verification (2026-07-16)

Optional `@arnilo/prism-server` and MCP server-direction APIs compose existing agent/workflow/tool/SDK primitives; no core path, framework/listener, auth provider, database, or profile activation was added.

| Surface | Result |
| --- | --- |
| Focused server suites | 6 Web handler tests + 4 MCP server tests pass; existing 12 MCP client tests remain green |
| Network-free tests | 1,576 tests, 1,551 pass, 25 explicit live skips, 0 fail |
| `npm run sdk:ready` | typecheck, examples, tests, builds, and all 29 dry-run packs pass |
| Server dry-run tarball | 8.4 kB packed / 34.4 kB unpacked / 12 files |
| MCP dry-run tarball | 11.6 kB packed / 45.0 kB unpacked / 20 files |
| Web handler bounds | request 64 KiB, result 1 MiB, event 64 KiB, stream 10 MiB/10k events, queue 128, concurrency 16, timeout 120 s by default; all have hard caps |
| MCP server bounds | call result 1 MiB, calls 16, timeout 60 s; HTTP request 1 MiB, response 2 MiB, requests 32 by default; all have hard caps |
| Profile bundles | unchanged; server remains explicit opt-in |

### 0.0.5 Phase 11 verification (2026-07-16)

Workflow schedules, background runs, composition, state, and replay reuse the existing workflow package plus generic checkpoint/lease stores. No package, runtime dependency, SQL migration, listener, cron parser, or auto-started worker was added.

| Surface | Result |
| --- | --- |
| Focused workflow/server suites | 54 workflow tests + 8 Web handler tests pass, 0 fail |
| Network-free tests | 1,589 tests, 1,564 pass, 25 explicit live skips, 0 fail |
| `npm run sdk:ready` | typecheck, examples, tests, builds, and all 29 dry-run packs pass |
| Workflow dry-run tarball | 34.7 kB packed / 171.5 kB unpacked / 38 files |
| Server dry-run tarball | 9.9 kB packed / 45.2 kB unpacked / 12 files |
| Synthetic schedule bound | 100 in-memory creates: 1.28 ms; scan 100 / claim+enqueue 16 due fires: 6.64 ms |
| Synthetic composition/replay | depth-8 nested run: 2.73 ms; 100-node source: 35.42 ms; replay 50 nodes: 21.17 ms |
| State/replay ceilings | state 64/512 KiB; history 32/128; nested depth 8/32; replay depth 8/32 default/hard |
| Schedule ceilings | page 100/500; claims 16/256; input 256 KiB/1 MiB; 1s idle timer; 30s fire lease defaults |

Synthetic timings are one local Node v24.18.0 run over memory adapters with no network/database I/O; finite limits and behavior tests, not wall-clock numbers, are CI gates.

### 0.0.5 Phase 12 verification (2026-07-16)

Run feedback adds no package or runtime dependency. Memory/SQLite/PostgreSQL implementations share bounded append/query/delete semantics; OTel projection accepts only fixed scalar metadata.

| Surface | Result |
| --- | --- |
| Focused feedback/eval/SQLite/OTel tests | 35 tests pass, 0 fail; PostgreSQL DDL suite passes and live feedback conformance is env-gated |
| Synthetic memory feedback | 1,000 bounded appends: 3.82 ms; 100 filtered 100-row queries over 1,000 records: 11.53 ms |
| Core dry-run tarball | 398.1 kB packed / 1.4 MB unpacked / 219 files |
| Evals dry-run tarball | 9.8 kB packed / 38.4 kB unpacked / 26 files |
| OTel dry-run tarball | 6.3 kB packed / 26.5 kB unpacked / 8 files |
| SQLite/PostgreSQL tarballs | 17.7/18.1 kB packed; 89.8/89.8 kB unpacked |
| Feedback limits | comment 4/16 KiB; tags 16/64; links 16/64; metadata 16/64 KiB; pages 100/500 default/hard |

Metrics came from one local Node v24.18.0 memory-adapter run. SQL correctness/indexing/migration behavior and hard bounds are gates; local timings are not release thresholds.

### 0.0.5 Phase 13 verification (2026-07-16)

Supervisor/A2A stays in one optional zero-runtime-dependency package; core and profile bundles gained no import, listener, worker, protocol SDK, or network activation.

| Surface | Result |
| --- | --- |
| Focused supervisor/A2A suite | 11 tests pass, 0 fail; local delegation, policy/budget/abort/redaction, card signatures, server/client/stream bounds |
| Synthetic local delegation | 100 sequential mock child results: 11.83 ms |
| Synthetic in-process A2A | 100 card discovery + JSON-RPC mock round trips: 34.17 ms |
| Supervisor dry-run tarball | 15.3 kB packed / 69.4 kB unpacked / 22 files |
| Local hard ceilings | depth 16; active 32; message 1 MiB; steps 64; tools 256; tokens 1m; timeout 30m; event queue 4096 |
| A2A hard ceilings | request/card/event 1 MiB; response 8 MiB; stream 64 MiB/100k events; concurrency 256; timeout 30m |

Timings are one local Node v24.18.0 run over mock agents and an in-process fetch adapter. Bounds, protocol validation, signature/auth/origin checks, and offline behavior tests are release gates; timings are not thresholds.

### 0.0.5 Phase 14 release-candidate verification (2026-07-16)

| Surface | Result |
| --- | --- |
| Default network-free test | 32.247 s, below 60 s budget |
| Full SDK readiness | 70.560 s; build/typecheck/examples/tests/30 pack dry-runs |
| Test matrix | 1,618 total; 1,593 pass; 25 explicit live skips; 0 fail |
| Node compatibility | Node 20.20.2 imports 44 built root/package export targets; Node 24.18.0 runs full matrix |
| PostgreSQL/pgvector | 29 live checks pass in fresh `pgvector/pgvector:pg16` container |
| Packed artifact set | 30 tarballs / 699 files; post-bundle snapshot ~690.6 kB packed / 2.64 MB unpacked |
| Core artifact | post-bundle snapshot ~403.7 kB packed / 1.46 MB unpacked / 221 files |
| Generated default project | under 50 KiB source and under 50 MiB installed; packed-core typecheck/test pass |
| Fresh packed journey | 30 packages install/import and Phase 1-13 optional composition pass in ~8.0 s |
| Registry/publish preview | 30/30 versions available; 30/30 dependency-ordered provenance dry-runs pass |

No performance ceiling was raised. Core grew from Phase 0's 346.0 kB packed baseline to ~403.7 kB after documented APIs/templates, while the full package set remains ~690.6 kB packed. Follow-up review includes all six Phase 4-13 capability packages through `prism-all` and AI SDK interoperability through `prism-providers`; focused base/code/SDK profiles remain unchanged and no capability auto-activates. Manifest tarballs remain tiny: providers 1.4 kB and all 1.6 kB packed.

## Related APIs

- [Agent events](agent-events.md): `SubscribeOptions` and `event_subscriber_overflow` event details.
- [Agent/session runtime](agent-session-runtime.md): `session.subscribe()` and runtime event flow.
- [Session stores](session-stores.md): `SessionStore.readBranchPath` and dev-vs-production branch reads.
- [Database persistence](database-persistence.md): cursor queries, reference schema, indexes, and event sequence guidance.
- [Runs and usage ledger](runs-and-usage.md): durable event, tool-call, and usage persistence.
- [Provider primitives](provider-primitives.md): bounded SSE/error-body limits for first-party providers.
