# Honesty gates, runtime split, and 0.8.0 cut primitive review

Plan 085 Task 0 freezes evidence, compatibility, scope, and the 0.8.0 changelog inventory for Tasks 1–8. Evidence only: no runtime path, public symbol, dependency, or budget changed here.

Reviewed tree: `a7915d6c`, with the 0.8.0 working tree already dirty from plans 079–084. Root and all eleven publishable manifests still declare `0.7.0`; this is not release evidence.

## Sources reviewed

Current contracts: [testing](../testing.md), [release and install](../release-and-install.md), [observational memory](../compaction-observational-memory.md), [messaging channels](../messaging-channels.md), and [messaging channel operations](../messaging-channel-operations.md).

External contract: Node 24 [`--test-isolation=mode`](https://nodejs.org/docs/latest-v24.x/api/cli.html#--test-isolationmode) and [test execution model](https://nodejs.org/docs/latest-v24.x/api/test.html#test-runner-execution-model), verified 2026-09-17 through Context7 `/websites/nodejs_latest-v24_x_api`. `process` is the default (one child per file); `none` imports all files into the runner process and runs top-level tests serially. The nested wiki child must continue to remove `NODE_TEST_CONTEXT` and `NODE_TEST_WORKER_ID`.

Historical context: [079 review](079-messaging-primitive-review.md), [080 review](080-messaging-followon-primitive-review.md), [081 review](081-connected-apps-primitive-review.md), [083 review](083-prism-work-primitive-review.md), [084 review](084-primitive-review.md), [080 Task 10](../../plans/080-Messaging-Channel-Followons-And-0-8-0-Cut.md), and the [085 plan](../../plans/085-Honesty-Gates-Runtime-Split-And-0-8-0-Cut.md).

## Findings and frozen implementation boundary

| Review item | Evidence | Frozen boundary | Owning task |
| --- | --- | --- | --- |
| 1. Honest release, coverage, and wiki evidence | `scripts/release-skip-manifest.mjs:26-33` selects the newest `phase*-baseline.json`; `:152-180` turns its `testPostgres` count into a pass whenever `PRISM_TEST_POSTGRES_URL` is set. `scripts/coverage-summary.json:1-120` is captured `2026-09-16T21:26:54.219Z`, contains `@arnilo/prism-office`, and lacks live `@arnilo/prism-work` (`packages/prism-work/package.json:2`). `scripts/wiki-scratch-isolation.test.mjs:83-96` strips nested-runner environment but invokes default process isolation. | Postgres pass must require current-HEAD, this-run evidence; coverage keys must equal workspace manifests; use `node --test --test-isolation=none` for the nested wiki child, retaining fixture-hash pollution checks and environment scrubbing. No retry or sleep. | 1 |
| 2. OM worker contract | `packages/memory/src/compaction/observational-memory/worker-loop.ts:68-70` discards every non-tool event; `:91-92` returns when a provider turn made no tool calls. `:71-81` and `:84-88` identify worker failures by English message prefix before redacting other errors. `runMemoryWorkerLoop` has only the three worker callers listed in `workers/{dropper,observer,reflector}.ts`. | Tool-only is intentional: text/thinking/done-only turns are successful no-ops. Keep no text writer. Replace only the prefix-based internal error classification with a typed memory error in Task 2; provider/tool failures still redact. | 2 |
| 3. Channel lease release | `packages/prism-channels/src/runtime.ts:657-672` clears `route.lease` before awaiting the persistent release, then swallows an exception after incrementing `storageFailures`. The only callers are `scheduleRoute` (`:1295-1308`) and `stop` (`:1774-1797`). SQLite’s store release itself is ownership/token fenced (`packages/prism-core/src/sessions/sqlite/leases.ts:92-107`). | A failed store release is not success: retain the in-memory lease until persistent acknowledgement, then clear it. Do not roll back an already delivered reply or add a retry loop; idle/stop may retry and lease TTL remains the cross-process backstop. `telegram.ts:631-650` and `signal.ts:427-442` are receiver-specific best-effort paths, not a reason to weaken runtime fencing. | 3 |
| 4. Runtime decomposition | `createMessagingRuntime` is one 1,878-line closure, `packages/prism-channels/src/runtime.ts:141-2018`, with 80 nested helpers and state interfaces at `:81-139`. It owns authorization, binding/journal, leases, previews/media/replies, approval/resume, admission, drain/stop, and reconciliation. Its callers import only package `index` (examples, runtime/recovery/adapter tests, restart and soak fixtures). | Move private helpers into private sibling modules behind unchanged `createMessagingRuntime`; preserve authorize → lease → claim → provider order and package-index export. This target alone gets the ≤800-line rule—no repository-wide god-file campaign. | 4 |
| 5. Provider test/dead-binding cleanup | Exactly eleven source-regex tests read an adapter `index.ts` and assert an export at line 8: `anthropic`, `clinepass`, `deepseek`, `google`, `kimi`, `neuralwatt`, `openai`, `opencode-go`, `openrouter`, `xai`, and `zai` under `packages/prism-providers/src/*/__tests__/index.test.ts`. `alibaba/video.ts:23-51` declares `fetchUrl` but binds unused `_fetchUrl`; `openai/speech.ts:32-38` has zero-call `_bearerHeaders`; `alibaba/__tests__/embeddings.test.ts:14-18` only uses `_assignable` for a structural pin. | Delete the eleven vacuous tests, retain one real packaging assertion already owned by root packaging tests, make video’s declared `fetchUrl` work while retaining `pinnedFetch` default, delete speech helper, and use `satisfies` for the embedding shape. No provider test framework. | 5 |
| 6. Small dedupe only | `retryableAdmission` is equivalent in Telegram (`packages/prism-channels/src/telegram.ts:524-527`) and Signal (`signal.ts:164-170`); caller paths are Telegram poll/webhook and Signal notification enqueue. `pushM365Tools` (`packages/prism-work/src/connectors/tools.ts:435-723`) and `pushGwsTools` (`:725-1083`) are only called from `createWorkTools` (`:1085-1093`), which is 1,093 lines total. | One private admission predicate; one local tool-push helper, not a cross-provider schema DSL. Preserve `assertExternalAllowed` and `executeApprovedMutation` (`tools.ts:192-199,227-407`) on every mutation. Split work catalog files only if the local helper leaves a file over 800 lines. | 6 |

## Threat posture

| Threat | Current gap | Required posture |
| --- | --- | --- |
| A stale Postgres pass hides SQL/durable-store defects | The skip manifest accepts a historical baseline count once the environment variable exists; it does not bind that count to `HEAD`. | Task 1 records only redacted metadata and counts from the current commit. Missing/mismatched evidence is **blocked**, never inherited pass. NATS remains protected when infrastructure is absent. |
| Swallowed release makes a binding appear free locally | Runtime memory forgets a lease despite the persistent release throwing. A later local scheduling decision is no longer fenced by the held route state. | Task 3 keeps the route lease through a failed store call and proves a later idle/stop path retries it. Ownership/token checks and TTL remain fail-closed. |
| Later “keep text” change silently drops observations | Current worker ignores non-tools; adding text retention without an explicit writer would look like a successful observation while persisting nothing. | Task 2 documents text-only turns as no-op. A future text-observation feature must add a writer, bounded/redacted payload, ledger semantics, and tests in a separate plan. |

## Non-goals frozen out of 085

| Out of scope | Evidence / reason | Reconsider only when |
| --- | --- | --- |
| SQLite/Postgres persistence unification | Separate SQLite migration and Postgres store implementations have distinct transaction and driver contracts (`packages/prism-core/src/sessions/sqlite/migrations.ts:37-74`; `packages/memory/src/postgres.ts:93-246`). | A measured parity defect requires a shared contract, not merely similar code. |
| Provider framework | Twenty provider subpackages already have independent request/auth/conformance choices (`scripts/package-truth.json` `providers`). | A third implementation repeats an identical adapter seam after Task 5 cleanup. |
| Another memory API | Existing observational-memory extension/runtime and `createMemoryFabric` are established public surfaces (`packages/memory/src/compaction/observational-memory/extension.ts:13-24`; `fabric/create.ts:130-469`). | A host has a concrete missing use case neither current surface can express. |
| Byte-cap increases | Hard request/response limits are explicit process-safety boundaries (`src/run-limits.ts:9-22`; `src/__tests__/run-limits.test.ts:55-68`). | Measurement shows a valid bounded payload cannot fit and a corresponding hard-cap/security review approves it. |
| Embedder-backed tool search | Current tool search is bounded lexical scoring (`src/tool-search.ts:226-268`) and has a benchmark budget (`scripts/benchmark-tool-search.test.mjs`). | Tool count/relevance measurements fail the current indexed approach. |
| `asRecord` consolidation | Seven local variants have differing return/validation shapes, including channel and work HTTP code (`packages/prism-channels/src/telegram.ts:175-177`; `packages/prism-work/src/connectors/normalize.ts:3-5`). | A specific correctness defect reaches more than one implementation. |
| Semaphore consolidation | Existing copies serve different package-local roles (e.g. coding-tools `Semaphore`, `packages/prism-coding-tools/src/security/semaphore.ts:18-55`; core artifact transfer `createSemaphore`, `packages/prism-core/src/runtime/server/artifact-bodies.ts:188-203`). | Profiling or a shared fairness/cancellation bug proves a common contract. |
| `createGovernedProvider` work | It is a public governance seam with many direct tests (`packages/prism-core/src/governance/model-router/invocation.ts:87-429`). | A separately scoped governance bug or compatibility request exists. |
| Canonical model comparison | Model-change recording uses `JSON.stringify` in `src/agent-session/session/assemble.ts:223`; unrelated to this cut’s honesty/routing work. | Object key ordering produces a reproducible false model-change record. |

## 0.8.0 cut inventory

Task 7’s changelog and migration must name these working-tree surfaces. “Completed” below means all task checkboxes are checked; 083 and 084 still have stale `Status: planned` headers, which Task 7 must correct before cut evidence is produced.

| Plan | Changelog/migration surface |
| --- | --- |
| 079 | New `@arnilo/prism-channels`: transport-neutral runtime/journal, Telegram adapter, experimental Signal adapter, verified identity, durable approvals, restart/recovery and examples. |
| 080 Tasks 1–9 | Telegram group/topic ownership, draft streaming, bounded attachments/voice, opt-in notifications, ERP outbox composition, SIGTERM/soak, nested test glob, resume signal, and checkpoint scope fixes. |
| 081 | Identity-bound connected-app MCP session, host-selected allowlists, Google Workspace/Microsoft 365 HTTP adapters, Slack MCP wrap, and sidecar example. |
| 082 | Package-truth evidence generation and connected-app follow-up safety review. |
| 083 | `@arnilo/prism-office` replacement with `@arnilo/prism-work` subpaths, work sandbox/composition, file transfer, and vendored Hermes skills. This is the only planned breaking import-map change. |
| 084 | Durable turn checkpoints/continue, turn-stop policy, server-authoritative AG-UI input, run bundle, evidence grounding, typed provider failure classification, and tool-call reliability metadata. |
| 085 Tasks 1–6 | This-tree evidence gates, OM worker contract, fail-closed lease release, private runtime split, provider cleanup, and small channel/work dedupe. |

**080 Task 10 is superseded by 085 Tasks 7–8.** It remains unchecked in `plans/080-Messaging-Channel-Followons-And-0-8-0-Cut.md:427` until Task 7 marks it with that note; this review does not rewrite past completion evidence.

## Task 7 budget baseline

Measured 2026-09-17 using `npm pack --workspace <name> --dry-run --json`, against the reviewed dirty working tree. These measurements are Task 7 delta reference points, **not newly enforced budgets**.

No package-specific packed-size ceiling exists for the four target workspaces. `scripts/budgets.json:3-36` supplies only the root `@arnilo/prism` pack ceiling: 1,320,080 packed bytes, 4,356,107 unpacked bytes, and 505 files, each with 5% tolerance. The historical aggregate ceiling is explicitly obsolete (`scripts/budgets.json` `aggregate.$comment`). Keep that policy unchanged unless Task 7 adds a separately justified package-pack gate.

| Package | Packed bytes | Unpacked bytes | Files | Export ceiling |
| --- | ---: | ---: | ---: | ---: |
| `@arnilo/prism-channels` | 51,593 | 234,935 | 24 | 85 |
| `@arnilo/prism-memory` | 215,525 | 865,582 | 272 | 828 |
| `@arnilo/prism-work` | 176,039 | 765,717 | 176 | 392 |
| `@arnilo/prism-providers` | 157,932 | 759,339 | 234 | 528 |

Export ceilings come from `scripts/budgets.json:39` (memory), `:43` (work), `:55` (channels), and `:59` (providers); they remain unchanged through Tasks 1–6. Task 7 must record every deliberate budget rebaseline with a dated reason, rather than silently raising a tolerance.

## Verification evidence

- `node scripts/package-truth.mjs` confirmed 11 publishable manifests and all target manifests at `0.7.0`.
- Direct artifact probe confirmed the coverage-package mismatch above.
- Direct source probe found all 11 provider source-regex tests and all three unused binding sites.
- `npm pack --workspace <name> --dry-run --json` produced the four baseline rows above without creating tarballs.
- This task intentionally adds no runtime test. Subsequent tasks own the smallest failing checks for their behavior changes.

## Plan corrections found during review

- Task 7 must update both `plans/083-Prism-Work-Package-Sandbox-And-Skills.md` and `plans/084-Host-Long-Run-Durability-Steering-And-Honesty-Surfaces.md` headers from `Status: planned`; their task checkboxes are complete but their header prose is stale.
- The four target packages have export ceilings, but **not** independent packed-size ceilings. Task 7 reports measured package pack deltas against this table while retaining the existing root-pack gate.
- The objective says “table-driven work-tool registration,” but evidence supports only a shared local `pushTool` helper. Task 6 must not introduce a catalog DSL.
