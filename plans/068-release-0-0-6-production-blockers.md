# Release 0.0.6 — Close Production Release Blockers

## Objectives

- Implement only Phase 1 from `roadmap.md`: close confirmed multi-tenant, resource-exhaustion, credential, protocol, persistence, validation, and identifier defects before feature expansion.
- Fix each defect at its shared boundary so every caller receives the same finite, fail-closed behavior.
- Preserve Prism's dependency-free core and optional-package architecture while preparing a verifiable 0.0.6 release candidate.

## Expected Outcome

- Cross-owner workflow cancellation is impossible for active and durable runs, duplicate active-run registration cannot overwrite another run, and durable workflow compatibility uses an explicit revision.
- Coding tools, credential stores, MCP, compaction workers, A2A streaming, persistence migrations, JSON Schema validation, vectors, and generated identifiers have finite validated limits and adversarial regression coverage.
- Public behavior, migration guidance, package changelogs, and release metadata describe 0.0.6 accurately; the complete offline SDK gate and relevant live integration gates pass before release.

## Tasks

- [x] Review existing primitives and freeze Phase 1 invariants before implementation
  - Acceptance Criteria:
    - Functional: every Phase 1 finding maps to one shared owner, existing primitive, minimal gap, implementation task, focused test, documentation page, and release gate; no Phase 2 guardrail/run-budget or later persona feature enters this plan.
    - Performance: current defaults/hard caps and measured 2026-07-19 baseline are recorded; each unbounded path has a proposed finite default, hard cap, and bounded failure mode before code changes.
    - Code Quality: existing ownership, limit validation, abort composition, redaction, bounded readers, file mutation queue, checkpoint/migration conformance, and package test helpers are reused; any new helper must serve at least two callers or stay package-local.
    - Security: trust boundaries cover active workflow state, host files/processes/temp files, encrypted vaults/keychain workers, MCP endpoints/results, provider output, A2A frames, database schema state, tool schemas, vectors, and identifiers.
  - Approach:
    - Documentation Reviewed:
      - Phase 1 and Phase Planning Workflow in `roadmap.md`.
      - `docs/workflows.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/credential-storage.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/host-security.md`, `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/migration.md`, and `docs/release-and-install.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`; no `.agents/skills/project-patterns/` directory exists.
    - Options Considered:
      - Patch only reproduced call sites: shortest immediate diff but leaves sibling callers vulnerable; rejected.
      - Replace subsystems or add a universal security framework: duplicates working primitives and expands scope; rejected.
      - Freeze invariants, then harden each existing shared boundary with one adversarial regression matrix: chosen.
    - Chosen Approach:
      - Build a traceability table in this task's completion evidence before implementation and amend later task file/test lists if the caller audit finds a missing shared path.
      - Grep all callers before changing a primitive; preserve low-level compatibility only where it does not retain the defect.
    - API Notes and Examples:
      ```text
      finding → callers → shared boundary → finite invariant → focused test → docs → release gate
      ```
    - Files to Create/Edit:
      - `plans/068-release-0-0-6-production-blockers.md`: append primitive/caller matrix and any evidence-based task corrections during execution.
      - No production or public documentation files in this review task.
    - References:
      - 2026-07-19 full-package audit and confirmed active workflow cancellation reproduction summarized in `roadmap.md`.
      - Existing shared primitives: `packages/workflows/src/util.ts`, `packages/coding-agent/src/output-accumulator.ts`, `src/content.ts`, `packages/supervisor/src/limits.ts`, `packages/memory/src/limits.ts`, and `src/testing/persistence-schema.ts`.
  - Test Cases to Write:
    - Traceability check: every Phase 1 roadmap acceptance item has exactly one owning task and no implementation task depends on Phase 2 work.
    - Caller audit: all callers of changed shared functions are listed before their task starts.
    - Limit matrix check: every configurable count/byte/time/concurrency value names a finite default and hard cap.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; this task reviews and freezes implementation boundaries only.
    - Docs pages to create/edit:
      - `none`: public behavior changes are documented in their implementation tasks.
    - `docs/index.md` update: no; no public surface changes in this task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Scope and baseline:
      - Phase boundary is frozen to roadmap Phase 1. Typed guardrails, universal run budgets, durable agent interruption, secure-agent composition, telemetry/eval expansion, protocol feature expansion, and persona packages remain Phase 2+.
      - Latest pre-0.0.6 full gate: `npm run sdk:ready` completed in 78 seconds; 1,698 tests, 1,673 pass, 25 explicit live skips, 0 fail; all 30 dry-run packs passed. Core packed at about 430 KiB/1.5 MiB unpacked/228 files.
      - Supply-chain baseline: `npm audit` reported 0 vulnerabilities across 223 dependencies; Node 20 remains minimum; CI backstops remain 60 seconds for default offline tests and 5 minutes for `sdk:ready`.
      - Code baseline: 189 production TypeScript files/26,280 lines and 78 package test files/12,817 lines. Phase-boundary/docs tests are additional; no coverage threshold is inferred from line counts.
    - Traceability matrix:

      | Finding / trust boundary | Current shared primitive and callers | Minimal gap / frozen invariant | Owning task | Focused tests | Public docs | Release gate |
      | --- | --- | --- | --- | --- | --- | --- |
      | Active/durable workflow ownership, limits, definition identity | `active-runs.ts`; `ownershipMatches`; `hashWorkflowDefinition`; `defineWorkflow`; run/coordinator/replay/status callers | Active identity stores exact ownership; authorize before abort; duplicate exact key fails; partial ownership matching remains query semantics only; explicit non-empty revision enters recursive hash; every workflow limit/runtime concurrency is finite and hard-capped | Workflow task | two-owner cancel/collision; revision mismatch; invalid-limit matrix | `workflows.md`, `host-security.md`, `migration.md` | workflow focused suite, server/command integration, full gate |
      | Host file/process/temp-file resources | `ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`, `OutputAccumulator`, `withFileMutationQueue`, `AbortSignal` | Stream text; bound scans/images/edit targets/write+edit payloads/counts; finite shell wall/output; kill tree; `0600` spill; delete unpublished spills; retain completed spill only as explicit host-owned result | Coding task | sparse/huge line; oversized writes/edits; quiet/infinite shell; spill mode/cleanup | `coding-agent-tools.md`, `coding-security.md`, `host-security.md`, `migration.md` | coding-agent/security suites, packed API check |
      | Encrypted vault/KDF/keychain | versioned AES-GCM envelope, scrypt parameter floor, atomic `0600` write, zeroing, typed keychain errors | Validate encoded/decoded sizes and KDF work/memory before allocation; async scrypt; verify existing file mode; keychain native call leaves event loop and is terminable on timeout | Credential task | hostile envelope/KDF; event-loop probe; Unix mode; worker hang/crash | `credential-storage.md`, `host-security.md`, `migration.md` | credential suite plus opt-in OS keychain gate |
      | MCP discovery/result/network | SDK v1.29 Client/transport timeout+signal, content mapper, bridge cache, core SSRF concepts | Bound cursor/pages/tools/metadata/schema/result JSON and refresh atomically; exact HTTPS origin, no redirects, public pinned resolution, explicit loopback HTTP only | MCP task | cursor cycles; aggregate overflow; alternate result branches; private/redirect/DNS fixtures | `mcp-tools.md`, `host-security.md`, `migration.md` | MCP suite and packed public import |
      | Provider/worker output and A2A frames | compaction serializer/cap, OM max turns/redaction utility, A2A byte/event/time limits | Incremental bounded retention; finite provider tokens; OM call/argument/result/message/error ceilings with redaction; one decoder with LF/CRLF SSE parser and final flush | Compaction/OM/A2A task | endless deltas/calls; secret failures; every UTF-8/CRLF split; existing stream limits | `compaction-llm.md`, `compaction-observational-memory.md`, `a2a.md`, `host-security.md`, `migration.md` | three package suites and full gate |
      | Database migration/schema drift | shared schema/migration contract, adapter transaction/advisory lock, canonical table/index model | Checksummed ordered history; legacy-null backfill only after full shape verification; bounded catalog/PRAGMA extraction checks columns, keys, constraints, and indexes | Persistence task | history drift; every schema-shape mutation; concurrent reopen; live PostgreSQL | persistence pages and `migration.md` | SQLite suite, PostgreSQL live matrix, full gate |
      | Tool schemas, vectors, security IDs | strict Ajv/prototype+remote-ref guards/instance bounds; memory dimension limits; Node crypto already used by leases/server/providers | Bound schema walk/compile cache/options before Ajv; reject every non-finite vector at embed/store/query boundary; replace exactly six insecure production ID helpers with Node crypto | Validator/vector/ID task | schema attacks/LRU; NaN/Infinity matrix; source/runtime ID guard | `tools.md`, `tool-execution-primitives.md`, memory/PostgreSQL pages, `host-security.md`, `migration.md` | validator, memory/live pgvector, core/workflow/eval suites |
      | Integrated 0.0.6 artifact | existing `sdk:ready`, release scripts, Node 20 import, packed install, PostgreSQL CI | No publish/tag; exact 0.0.6 graph and docs only after prior tasks pass; no blocker waiver | Release-candidate task | complete offline/live/negative release matrix | `index.md`, release/migration docs, all pages above | final RC matrix |

    - Caller and primitive inventory frozen before implementation:
      - Workflow active registry: production mutators are `run.ts` (`register`/`unregister`) and `status.ts` (`abort`); public access is re-exported by `index.ts`. Remote cancel callers are `commands.ts` and `packages/server/src/handler.ts`. Definition hashes are created/checked by `run.ts`, `coordinator.ts`, and `replay.ts`; nested workflows recurse through `run.ts`. `checkpoint-core.ts`, run resume, replay, and status use partial `ownershipMatches`; exact cancellation gets a separate helper so scoped load/list semantics do not break.
      - Coding I/O: `OutputAccumulator` is consumed only by `shell.ts`; `BashOperations` is also adapted by `packages/coding-security/src/sandbox.ts`. `ReadOperations`, `WriteOperations`, and `EditOperations` are consumed by their matching tools and composed by `createCodingTools`/`createReadOnlyTools`/`createAllTools`. `withFileMutationQueue` is shared by write/edit. `computeEditDiff`/`computeEditsDiff` are non-exported and test-only; remove their unbounded filesystem preview path instead of adding a second bounded reader.
      - Credentials: `encryptBytes`/`decryptBytes` are public and called internally only by encrypted-store load/persist/rotation; `assertScryptParameters` is public and called by resolve/encrypt/decrypt. `assertRestrictiveFileMode` exists but is test-only. Keychain `withTimeout` wraps only get/set/delete and cannot interrupt synchronous native calls.
      - MCP: `connectMcpTools` owns transport creation; connect/attach both create bridge state; refresh is the sole production caller of public `listAllMcpTools`; mapped tool execution is the sole caller of remote `callTool`; `content.ts` bounds only content blocks. `createMcpTransport` and list/map helpers are public, so new limits must be explicit arguments/options rather than hidden bridge-only state.
      - Compaction/A2A: extension registration and direct callers share `createLlmCompactionStrategy`; both summary paths share `runSummaryProvider`. Observer, reflector, and dropper are the only `runMemoryWorkerLoop` callers. `createA2AClient().stream()` owns the defective decoder; existing A2A default/hard limits remain authoritative.
      - Persistence: both migration adapters consume `createPersistenceMigrationContract`, `assertMigrationUpAndReopen`, and `assertAdapterSchemaMatchesModel`; each adapter alone extracts dialect catalog state. Shared schema types currently omit defaults/check constraints and migration checksums, so extend that primitive rather than duplicate expected shape in adapters.
      - Validator/memory/IDs: both JSON Schema factories share one argument validator/cache. `embedBatched` feeds both memory index/query; external vector stores can receive records directly, so in-memory and PostgreSQL upsert/query also validate. Insecure production ID helpers are exactly `src/agents.ts`, `src/agent-loops.ts`, `src/session-stores.ts`, `src/tools.ts`, `packages/workflows/src/util.ts`, and `packages/evals/src/util.ts`; evaluation sampling randomness is not an ID.
    - Frozen default/hard-cap matrix (all values are positive safe integers; invalid values reject, never clamp/fallback):

      | Boundary / option | Default | Hard cap / exact rule | Bounded failure |
      | --- | ---: | ---: | --- |
      | Workflow `maxNodes` | 1,000 | 10,000 | definition error before graph allocation |
      | Workflow `maxFanOut` | 64 | 1,024 | definition/runtime limit error before scheduling children |
      | Workflow `maxConcurrency` / run `concurrency` | 8 | 256 | definition/run setup error |
      | Workflow node output | 4 MiB | 16 MiB | reject redacted output before checkpoint/event retention |
      | Workflow checkpoint | 1 MiB | 8 MiB | reject redacted checkpoint before save |
      | Nested depth / state bytes / state history / replay depth | 8 / 64 KiB / 32 / 8 | existing 32 / 512 KiB / 128 / 32 | existing typed workflow limit errors |
      | Node retries / timeout | 0 / no timeout | 100 / 86,400,000 ms | definition error; explicit no-timeout remains host choice, not an accepted infinite number |
      | Coding display lines / bytes | 2,000 / 50 KiB | 100,000 / 1 MiB | option construction error |
      | Text read scan bytes | 64 MiB | 1 GiB | bounded read error with continuation guidance; first-page reads do not scale with total file size |
      | Image bytes | 10,000,000 | 32 MiB | reject by stat/buffer before base64/transform |
      | Write input | 8 MiB | 64 MiB | reject before policy metadata/filesystem mutation |
      | Edit target / aggregate edit input / edit count | 8 MiB / 2 MiB / 100 | 64 MiB / 16 MiB / 1,000 | reject before file read/matching/write |
      | Shell wall time | 600 s | 3,600 s | kill process tree; bounded error/tail |
      | Shell total raw output | 64 MiB | 1 GiB | kill process tree; delete unpublished spill; bounded error/tail |
      | Credential envelope / decrypted vault | 4 MiB / 3 MiB | 16 MiB / 12 MiB | reject before JSON/base64/KDF or vault parse |
      | Scrypt | N=32,768, r=8, p=1, key=32 | N≤262,144; r≤32; p≤16; key exactly 32; `128*N*r≤256 MiB`; `N*r*p≤2,097,152` | typed KDF error before worker-pool work |
      | Keychain timeout / operation payload | 5 s / 3 MiB | 60 s / 12 MiB | terminate worker and return typed timeout |
      | MCP list pages / tools | 20 / 500 | 100 / 5,000 | close refresh attempt; preserve previous tools |
      | MCP cursor / name / description | 4 KiB / 256 B / 16 KiB | 16 KiB / 1 KiB / 64 KiB | discovery error before cache commit |
      | MCP schema per tool / aggregate | 256 KiB / 4 MiB | 1 MiB / 16 MiB | discovery error before mapping/compile/cache commit |
      | MCP result / JSON depth / JSON properties | existing 10,000,000 B / 64 / 10,000 | 16 MiB / 128 / 100,000 | bounded tool error before `ToolResult` retention |
      | MCP call timeout / list cache TTL / HTTP response | 60 s / 30 s / 16 MiB | 30 min / 24 h / 64 MiB | abort request/refresh; reject response before full retention |
      | LLM compaction summary / reserve / error text | 16,384 tokens / 16,384 tokens / 1 KiB | 131,072 tokens / 131,072 tokens / 8 KiB | stop retaining/abort or drain; redacted bounded error |
      | OM turns / calls per turn / calls total | 16 / 32 / 128 | 64 / 256 / 1,024 | deterministic worker limit error |
      | OM argument / result / message total / error text | 64 KiB / 64 KiB / 1 MiB / 1 KiB | 1 MiB / 1 MiB / 8 MiB / 8 KiB | redact, reject before message/provider reuse |
      | A2A request/response/event/stream/events/concurrency/timeout/card | existing 64 KiB / 1 MiB / 64 KiB / 10 MiB / 10,000 / 16 / 120 s / 64 KiB | existing 1 MiB / 8 MiB / 1 MiB / 64 MiB / 100,000 / 256 / 30 min / 1 MiB | existing A2A typed limit errors; parser adds no unbounded buffer |
      | JSON Schema errors/depth/properties/string/array | 8 / 64 / 1,000 / 1,000,000 / 10,000 | 100 / 128 / 10,000 / 8 MiB / 100,000 | reject options/instance before Ajv execution |
      | JSON Schema bytes/depth/nodes/refs/cache | 256 KiB / 64 / 10,000 / 256 / 256 | 1 MiB / 128 / 100,000 / 1,024 / 4,096 | reject before stringify/compile; LRU evicts oldest compiled schema |
      | Memory vector dimensions/elements | existing ≤4,096 | every element must be `Number.isFinite`; dimensions 1..4,096 | typed validation error before score/SQL serialization |
    - Documentation review outcome:
      - Current docs accurately describe existing defaults but overstate bounded shell output (`coding-agent-tools.md`), truthful keychain timeout (`credential-storage.md`), workflow limit completeness (`workflows.md`), and host-only MCP URL safety (`mcp-tools.md`). Implementation tasks own those corrections.
      - `docs/a2a.md` already publishes existing A2A hard limits; parser fix must not change them. Persistence pages publish schema version 3 and checksum guidance but adapters do not enforce checksum/full shape. Release docs contain older measured counts and are updated only in final RC task.
      - No public docs or `docs/index.md` changed in this review-only task.
    - Checks run:
      - Repository-wide `rg` caller audits above covered production TypeScript while separating tests and public barrel exports.
      - Traceability validation confirms every Phase 1 roadmap acceptance item maps to exactly one implementation task plus final release gate; no Phase 2 term is an implementation dependency.
      - Limit validation confirms every newly introduced count/byte/time/concurrency option has one finite default, one finite hard cap, and a pre-allocation/pre-mutation failure point.

- [x] Enforce workflow ownership, duplicate safety, finite limits, and explicit revisions
  - Acceptance Criteria:
    - Functional: active-run records retain full `OwnershipScope`; registry identity includes ownership; duplicate registration for the same owned workflow/run fails instead of overwriting; cancel finds and authorizes the exact owned run before aborting; durable cancel applies the same exact-owner rule.
    - Functional: `WorkflowDefinition` has a non-empty explicit `revision`; definition hashing includes revision recursively; resume, cancel, replay, coordinator, and nested workflows reject revision/hash mismatch before mutation.
    - Performance: every `WorkflowLimits` field and runtime `concurrency` is a positive safe integer within a named hard cap; `Infinity`, NaN, zero, negative, unsafe integers, and oversized values fail during definition/run setup; registry lookup remains O(1).
    - Code Quality: one exact ownership helper and one workflow-limit validator serve active status/cancel, definition, run, coordinator, replay, and nested paths; no caller-specific cancellation guard or function-source hashing is added.
    - Security: tenant-only cancellation cannot target a run owned by tenant+account/user; same workflow/run IDs may coexist only under distinct exact ownership keys without status/list leakage; failure messages reveal no foreign run existence beyond the package's chosen not-found/forbidden policy.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md` sections for ownership, cancel, resume, replay, nested workflows, limits, checkpoints, and coordinators.
      - `packages/workflows/src/active-runs.ts`, `status.ts`, `run.ts`, `define.ts`, `limits.ts`, `util.ts`, `coordinator.ts`, `replay.ts`, and `types.ts` plus every caller of active-run and definition-hash helpers.
      - Node.js crypto `randomUUID()` API: <https://nodejs.org/api/crypto.html#cryptorandomuuidoptions>.
    - Options Considered:
      - Load durable checkpoint before every active cancel: authorizes correctly but makes local cancellation depend on storage and still permits registry collisions; rejected.
      - Keep the current key and add ownership only to cancel arguments: duplicate owners can overwrite each other; rejected.
      - Key and store active runs by canonical exact ownership, reject duplicate exact registration, and compare before abort: chosen.
      - Hash `Function.toString()`: unstable across builds and incomplete for closed-over behavior/tool identity; rejected in favor of host-authored revision.
    - Chosen Approach:
      - Add package-local canonical ownership key/exact comparison helpers; require cancellation ownership whenever an active or durable run is owned.
      - Add `revision` to definition input/output and hash payload; validate all limits through one table of defaults/hard caps before graph construction or scheduling.
    - API Notes and Examples:
      ```ts
      const workflow = defineWorkflow({
        id: "publish",
        revision: "2026-07-19.1",
        nodes,
        limits: { maxNodes: 256, maxFanOut: 32, maxConcurrency: 4 },
      });

      await cancelWorkflowRun({
        workflowId: workflow.id,
        runId,
        workflow,
        checkpoints,
        ownership: { tenantId: "t1", userId: "u1" },
      });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/active-runs.ts`: store/canonicalize exact ownership and reject duplicate registrations.
      - `packages/workflows/src/status.ts`: authorize before active abort and align durable cancellation.
      - `packages/workflows/src/types.ts`, `define.ts`, `limits.ts`: explicit revision and complete finite hard-cap validation.
      - `packages/workflows/src/util.ts`, `run.ts`, `coordinator.ts`, `replay.ts`, `nodes.ts`: propagate ownership/revision and consume shared validation/hash helpers.
      - `packages/workflows/src/index.ts`: export changed public types/constants only when needed by hosts.
      - `packages/workflows/src/commands.ts` and `packages/server/src/handler.ts`: propagate exact ownership plus current definition/revision into remote cancellation.
      - `packages/workflows/src/__tests__/active-runs.test.ts` (new), `run.test.ts`, `define.test.ts`, `composition-replay.test.ts`, `coordinator.test.ts`, `commands.test.ts`, and `packages/server/src/__tests__/server.test.ts`: regression matrix.
      - `packages/workflows/README.md`, `packages/workflows/CHANGELOG.md`, and `packages/server/CHANGELOG.md`.
    - References:
      - Root cause: `abortActiveWorkflowRun()` currently runs before checkpoint loading/ownership comparison, while registry key is only `workflowId::runId`.
      - `ownershipMatches()` is partial-match semantics and must not be reused as exact active-run identity without tightening.
  - Test Cases to Write:
    - Cross-owner cancel: tenant-only, wrong account, wrong user, missing ownership, and attacker-owned checkpoint cannot abort or mutate victim active/durable runs.
    - Registry collision/race: exact duplicate registration fails; distinct exact owners with same workflow/run IDs remain isolated; unregister removes only the owned record.
    - Revision matrix: empty/missing revision fails; changed parent/nested revision rejects resume/cancel/replay; unchanged revision reopens successfully.
    - Limit matrix: every definition/runtime field rejects NaN, Infinity, unsafe integer, zero, negative, and hard-cap+1; accepted boundary values execute.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; workflow definitions gain revision semantics, limits reject previously accepted invalid values, and cancel ownership becomes exact.
    - Docs pages to create/edit:
      - `docs/workflows.md`: revision, exact cancellation ownership, duplicate active-run behavior, and complete limit table.
      - `docs/migration.md`: 0.0.6 workflow revision requirement and cancellation behavior.
      - `docs/host-security.md`: exact workflow ownership requirement.
    - `docs/index.md` update: yes; update Workflow and Security/auth/trust descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Ownership and active identity:
      - `ActiveWorkflowRun` now stores exact copied `OwnershipScope` and recursive `definitionHash`; its O(1) map key includes workflow ID, run ID, and a collision-safe canonical tenant/account/user tuple.
      - Exact duplicate registration throws `ERR_PRISM_WORKFLOW_ALREADY_ACTIVE`; distinct exact owners can hold the same workflow/run IDs. Public get/list/abort/unregister operations select only exact ownership.
      - `cancelWorkflowRun()` now requires the current `workflow`, computes its hash before mutation, and checks exact active or durable ownership plus hash before abort, cancellation request, or checkpoint save. Command and Web handler callers resolve/forward their registered definition.
      - Regression tests reproduce tenant-only/wrong-user/missing-owner isolation for active and durable runs, duplicate registration, distinct-owner coexistence, hash mismatch, list isolation, and exact unregister.
    - Revisions and durable identity:
      - `DefineWorkflowInput`/`WorkflowDefinition` require a trimmed non-empty `revision`; deterministic hashes include parent revision and every nested workflow hash.
      - Resume, replay, coordinator, nested execution, and cancellation consume the shared recursive hash path. No caller-specific function-source hashing or duplicate revision guard was added.
      - All tracked TypeScript workflow definitions/examples/install smokes now declare explicit revisions. Migration docs state that pre-0.0.6 hashes cannot match automatically and require completion before upgrade or a deliberate host-owned evidence rewrite.
    - Finite limits:
      - One workflow limit table validates all nine `WorkflowLimits` fields. Named hard caps are exported for nodes (10,000), fan-out (1,024), concurrency (256), node output (16 MiB), checkpoint (8 MiB), and existing nested/state/history/replay ceilings.
      - Runtime concurrency, coordinator concurrency/page size, checkpoint adapter byte options, fan-out node overrides, retries (0–100), timeout (1 ms–24 h when supplied), and internal nested cursors reject non-finite/unsafe/out-of-range input before scheduling or persistence.
      - Runtime concurrency and node fan-out are additionally narrowed by the workflow-level ceiling instead of overriding it.
    - Minimal implementation:
      - Shared changes are in `limits.ts`, `define.ts`, `types.ts`, `util.ts`, `active-runs.ts`, `status.ts`, `run.ts`, `checkpoint-core.ts`, `coordinator.ts`, `commands.ts`, package exports, and the server cancel call. `nodes.ts` and `replay.ts` needed no guard because definition validation/hash reuse already covers them.
      - New `active-runs.test.ts` provides the focused security check; definition, run, composition/replay, coordinator, command, server, example, and install-smoke fixtures cover propagation.
    - Documentation completed:
      - Updated `docs/workflows.md`, `docs/migration.md`, `docs/host-security.md`, `docs/index.md`, workflow primitives example, package README/changelog, and server changelog.
      - Workflow docs now publish required revision semantics, exact cancellation API, duplicate behavior, complete default/hard-cap table, checkpoint migration consequence, and security boundary.
    - Verification:
      - Workflow build/typecheck and 59 tests pass; server build and 8 tests pass; docs suite passes 84/84.
      - Full `npm run sdk:ready` passes: 1,703 tests, 1,678 pass, 25 explicit live skips, 0 fail; all workspace builds and dry-run packs pass.
      - Workflow dry-run pack contains 38 release files (36.0 KiB packed/178.0 KiB unpacked) with no tests, maps, source, or internal files.
      - `git diff --check` passes. No live provider or database credential was required for this package-local identity/limit change.

- [x] Bound coding-agent file input, shell lifetime, output, spill files, and mutations
  - Acceptance Criteria:
    - Functional: text reads stream or page without loading the entire file; images remain bounded before base64; edit rejects oversized target files before read; write/edit reject oversized input and excessive edit counts before filesystem mutation.
    - Functional: shell has finite default and hard wall-time plus finite total captured/spilled-output limit; exceeding either kills the process tree and returns an attributable bounded error with partial tail metadata.
    - Performance: multi-gigabyte sparse files, infinite output, one huge line, distant offsets, and custom-operation paths keep heap and disk within configured hard caps; output accounting is streaming UTF-8-safe and O(total bytes) time/O(display cap) memory.
    - Code Quality: one validated coding-limit helper and existing file mutation queue/output accumulator are reused; local streaming operations remain replaceable without retaining an unbounded `readFile()` fallback in the default path.
    - Security: spill files are atomically/randomly created with Unix `0600`, never contain data beyond total-output cap, and have documented ownership/cleanup; abort/error paths close handles, kill subprocesses, and remove unpublished temporary files.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, and `docs/host-security.md`.
      - Node.js file streams/FileHandle APIs: <https://nodejs.org/api/fs.html#filehandlecreatereadstreamoptions>; child process API: <https://nodejs.org/api/child_process.html>; TextDecoder streaming: <https://nodejs.org/api/util.html#class-utiltextdecoder>.
      - `packages/coding-agent/src/read.ts`, `shell.ts`, `output-accumulator.ts`, `truncate.ts`, `write.ts`, `edit.ts`, operation seams, and aggregators.
    - Options Considered:
      - Reject text files by `stat` size: bounded but breaks paginated reads of large files; rejected.
      - Keep full-file reads and truncate afterward: current memory-exhaustion defect; rejected.
      - Stream text to requested offset/limits while retaining only bounded output, and stat before image/edit reads: chosen.
      - Stop writing spill output but leave process running: bounds disk but wastes CPU and wall time; rejected.
    - Chosen Approach:
      - Add validated defaults/hard caps for text/image/edit/write bytes, edit count, shell timeout, display output, and total output.
      - Evolve `ReadOperations`/`EditOperations` minimally to support stat/bounded streaming; local defaults use standard-library handles/streams.
      - Extend `OutputAccumulator` with total-byte overflow and cleanup lifecycle; compose an owned abort controller so overflow terminates local/custom operations that honor `signal`.
    - API Notes and Examples:
      ```ts
      const tools = createCodingTools(workspace, {
        shell: { timeout: 600, maxTotalOutputBytes: 64 * 1024 * 1024 },
        read: { maxBytes: 50 * 1024, maxScanBytes: 64 * 1024 * 1024 },
        write: { maxInputBytes: 8 * 1024 * 1024 },
        edit: { maxFileBytes: 8 * 1024 * 1024, maxInputBytes: 2 * 1024 * 1024, maxEdits: 100 },
      });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/limits.ts` and `bounded-file.ts`: shared finite limit validation and cap-enforcing local file reads.
      - `packages/coding-agent/src/read.ts`, `write.ts`, `edit.ts`: finite options, stat/stream checks, abort-safe operation seams.
      - `packages/coding-agent/src/edit-diff.ts`: remove non-exported, test-only filesystem preview helpers instead of retaining a second unbounded read path; keep pure diff/matching primitives.
      - `packages/coding-agent/src/shell.ts`, `output-accumulator.ts`, `truncate.ts`: default/hard timeout, total output cap, process abort, restrictive spill and cleanup.
      - `packages/coding-agent/src/index.ts`: thread shared/per-tool options and exports.
      - `packages/coding-agent/src/__tests__/read.test.ts`, `write.test.ts`, `edit.test.ts`, `edit-diff.test.ts`, `shell.test.ts`, `output-accumulator.test.ts`, `aggregators.test.ts`.
      - `packages/coding-agent/README.md`, `packages/coding-agent/CHANGELOG.md`.
      - `packages/coding-security/src/sandbox.ts` and tests only if the `BashOperations` signal/limit contract must be propagated.
    - References:
      - Current text `read` calls `ops.readFile()` before offset/truncation; current edit reads entire target; current shell timeout is optional and spill output has no total disk ceiling.
      - Existing `withFileMutationQueue()` remains the serialization boundary.
  - Test Cases to Write:
    - Sparse multi-gigabyte text file: first page and distant offset return bounded output without heap proportional to file size.
    - Huge line/invalid offsets/abort: UTF-8 boundaries and continuation hints remain correct; all handles close.
    - Infinite stdout/stderr and quiet infinite command: total-output and default timeout independently kill the process tree and cap spill size.
    - Spill lifecycle: mode is `0600`, random exclusive creation prevents collisions, close errors are handled, unpublished files are removed, documented retained file can be explicitly cleaned.
    - Write/edit bounds: oversized UTF-8 input, too many edits, oversized target, symlink-resolved path, and abort fail before mutation; existing exact/fuzzy behavior remains unchanged at limits.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; coding options/default timeout/output behavior and operation seams change.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: finite option tables, streaming reads, shell termination, spill retention/cleanup.
      - `docs/coding-security.md`: resource limits complement approval/sandbox policy.
      - `docs/host-security.md`: coding tools remain host access and require containment despite new bounds.
      - `docs/migration.md`: changed shell default and custom operation interface migration.
    - `docs/index.md` update: yes; update Tools and Security/auth/trust entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Shared finite boundaries:
      - Added package-local `limits.ts`; one `validateCodingLimit()` rejects non-safe, non-positive, and above-hard-cap values for display, text scan, image, write/edit, shell timeout, and total output options. Public default/hard constants are exported from the package barrel.
      - Added `readFileBounded()` in `bounded-file.ts`; image and edit paths share its cap-enforcing chunk loop, abort checks, and guaranteed handle close. Stat remains an early rejection/diagnostic but no TOCTOU replacement can make the subsequent local read unbounded.
      - Removed the non-exported `computeEditDiff()`/`computeEditsDiff()` filesystem preview helpers and their two tests instead of maintaining a second target-read path.
    - Bounded reads and mutations:
      - Default text reads use an explicit file-handle loop, retain only one page, stop at line/byte/request limits, and reject when reaching the 64 MiB default scan ceiling before the requested offset/page (1 GiB hard cap). Exact totals are emitted only when the bounded read reaches EOF.
      - `ReadOperations` now requires bounded `readText()` and `statFile()`; operation results are checked against requested byte/line limits. Image reads are stat-first and bounded again during read and after transform.
      - Write UTF-8 input defaults to 8 MiB (64 MiB hard) and fails before policy or filesystem work. Edit defaults to 8 MiB target, 2 MiB aggregate old/new text, and 100 replacements (hard: 64 MiB/16 MiB/1,000); count/input fail before policy and target size fails before target read/matching/write.
      - Write/edit operation methods receive the current `AbortSignal`; edit's required `statFile()` keeps local and remote seams explicit. Existing `withFileMutationQueue()` remains the sole same-path serialization owner.
    - Bounded shell and spill lifecycle:
      - Shell now has a 600-second default and 3,600-second hard timeout for both factory and request values. Quiet infinite commands are process-tree-killed without requiring a request timeout.
      - Combined stdout/stderr defaults to 64 MiB total (1 GiB hard). `OutputAccumulator` accepts no byte beyond the cap, keeps a streaming UTF-8 display tail, and aborts the composed operation signal on overflow or spill failure.
      - Spill files use 128-bit random names, exclusive creation, Unix `0600`, synchronous zero-queue writes, and finite accepted length. Successful truncated calls publish a host-owned `fullOutputPath`; abort, timeout, output overflow, spawn/storage error, and outer failure close and remove unpublished spills.
      - Error results include bounded partial-tail/truncation metadata, retained-byte count, and attributable output-limit/storage flags; non-zero process exit remains a normal result.
    - Adversarial regressions:
      - A 4 GiB sparse file first page reads at most one 64 KiB chunk; a 50,000-line distant offset stays inside its scan cap; huge-line, scan-overflow, invalid offset/option, and hostile custom over-return paths remain bounded.
      - UTF-8 write overflow, edit count/input/target overflow, symlink target size, invalid limit matrices, custom backends, and abort-before-mutation preserve existing files and avoid operation calls where required.
      - Infinite local/custom output stops exactly at 4 KiB in focused fixtures; quiet command default timeout kills at one second; spill tests verify exact cap, Unix `0600`, explicit retention, cleanup, unsafe prefix rejection, and split UTF-8 reconstruction.
    - Documentation completed:
      - Updated package README/changelog plus `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/migration.md`, and `docs/index.md` with complete defaults/hard caps, operation migration, temp-file ownership, and the limits-not-sandbox boundary.
      - Node file-handle range/stream, exclusive file flags, child-process termination, and streaming decoder behavior were rechecked against current Node documentation before implementation.
    - Verification:
      - Coding-agent build/typecheck and 140 tests pass; coding-security build and 11 tests pass; docs suite passes 84/84.
      - Full `npm run sdk:ready` passes: 1,713 tests, 1,688 pass, 25 explicit live skips, 0 fail; all workspace builds/typechecks and dry-run packs pass.
      - Coding-agent dry-run pack contains 30 release files (36.4 KiB packed/142.0 KiB unpacked) with no tests, maps, or TypeScript source.
      - `git diff --check` passes. No live provider, database, keychain, or external sandbox was required for this local coding-resource task.

- [x] Harden encrypted credentials and make keychain timeouts enforceable
  - Acceptance Criteria:
    - Functional: encrypted-store open/rotate reject oversized files, malformed envelope shapes, non-canonical/oversized base64 fields, invalid salt/IV/tag lengths, excessive plaintext/ciphertext, and KDF parameters above named CPU/memory ceilings before expensive work.
    - Functional: encrypted-store KDF work uses asynchronous `node:crypto.scrypt`; existing vault files reopen; newly opened existing files must have restrictive Unix permissions; atomic writes preserve restrictive mode.
    - Functional: keychain operations execute outside the main event loop with a timeout that can terminate/isolate the blocked operation; unsupported platforms, locked stores, timeout, and business errors remain distinguishable.
    - Performance: hostile KDF input cannot allocate above the configured hard memory ceiling; large files/base64 fail before decoding copies; normal scrypt does not block an event-loop responsiveness probe.
    - Code Quality: one envelope parser/limit validator is used by open and rotation; one worker protocol owns keychain get/set/delete; async encryption/decryption API changes are explicit and migration-documented.
    - Security: passphrases, derived keys, decrypted vaults, keychain values, and native error details never enter logs/errors; derived/plaintext buffers are zeroed where ownership permits; permission failure is fail-closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/credential-storage.md`, `docs/host-security.md`, and `docs/migration.md`.
      - Node.js asynchronous scrypt and memory options: <https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback>; worker threads: <https://nodejs.org/api/worker_threads.html>.
      - `packages/credentials-node/src/envelope.ts`, `encrypted-store.ts`, `file-io.ts`, `keychain-store.ts`, `types.ts`, `vault.ts`, and public exports.
    - Options Considered:
      - Keep `scryptSync` behind lower parameters: bounds DoS but still blocks the event loop; rejected.
      - Wrap synchronous `Entry` calls in `Promise.race`: the timer cannot fire while native code blocks; rejected.
      - Add a package-owned worker around synchronous `Entry`: enforceable but duplicates the installed keyring package's native async/cancellation seam and adds a worker artifact/protocol; rejected after caller/dependency audit.
      - Use async scrypt plus `@napi-rs/keyring@1.3.0` `AsyncEntry`/`AbortSignal`, with a main-loop timeout race and finite byte payloads: chosen.
    - Chosen Approach:
      - Define conservative defaults/hard caps for envelope/vault/base64 and scrypt N/r/p/keyLength/memory; validate raw JSON shape and encoded lengths before `Buffer.from()` or KDF.
      - Convert exported encryption/decryption helpers and store callers to Promise-based APIs; preserve envelope version 1 wire compatibility.
      - Run keyring calls through one `AsyncEntry` operation helper; schedule native work outside the JavaScript event loop, pass its abort signal, race a main-loop timeout, use byte secrets, and sanitize every surfaced native error.
    - API Notes and Examples:
      ```ts
      const store = await openEncryptedCredentialStore({
        path: "./credentials.vault",
        getPassphrase,
        limits: { maxFileBytes: 4 * 1024 * 1024, maxScryptMemoryBytes: 256 * 1024 * 1024 },
      });
      const keychain = createKeychainCredentialStore({
        service: "app",
        timeoutMs: 5_000,
        maxPayloadBytes: 3 * 1024 * 1024,
      });

      const envelope = await encryptBytes(plaintext, passphrase, scryptOptions);
      ```
    - Files to Create/Edit:
      - `packages/credentials-node/src/types.ts`, `envelope.ts`, `encrypted-store.ts`, `file-io.ts`, `vault.ts`: limits, strict parser, bounded vault parsing, async KDF, restrictive-mode enforcement.
      - `packages/credentials-node/src/keychain-store.ts`: abort-aware native async timeout/payload boundary.
      - `packages/credentials-node/src/limits.ts`: shared finite defaults/hard caps and validation.
      - `packages/credentials-node/src/index.ts`: export changed async types and public constants; no worker/build artifact is required.
      - `packages/credentials-node/src/__tests__/credentials-node.test.ts`: hostile envelope, responsiveness, mode, worker timeout matrix.
      - `packages/credentials-node/README.md`, `packages/credentials-node/CHANGELOG.md`.
    - References:
      - Current `assertScryptParameters()` has floors but no upper bounds; `readEnvelope()` reads/parses the full file; `openEncryptedCredentialStore()` does not call `assertRestrictiveFileMode()`.
      - Current `withTimeout()` wraps synchronous `Entry` calls on the same event loop and therefore cannot enforce its timer while blocked.
      - Installed keyring v1.3.0 exposes abort-aware `AsyncEntry` methods backed by N-API `AsyncTask`: <https://github.com/Brooooooklyn/keyring-node/blob/e46be75c3ba8d5fde6b88a17c6153b87ffe4b946/src/async_entry.rs#L129-L226>.
  - Test Cases to Write:
    - KDF matrix: floor/boundary/cap+1, non-power-of-two N, overflow product, excessive key length, and valid legacy envelope.
    - Envelope matrix: oversized file/JSON/base64, invalid alphabet/padding, wrong decoded salt/IV/tag lengths, unknown properties/algorithms/version, tampered ciphertext, wrong passphrase.
    - Event-loop probe: timer advances while default scrypt encrypt/decrypt runs; abort/error still zeroes owned buffers.
    - File mode: existing `0644` vault fails on Unix; new/rotated vault and temp file are `0600`; Windows behavior remains documented.
    - Keychain async boundary: success, locked/unavailable mapping, ignored-operation timeout, abort signal, native-style failure, invalid limits, and no leaked key/value in errors; credential-gated live round-trip remains optional.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; credential limit options, async envelope helpers, file-mode enforcement, and truthful abort-aware native keychain timeout behavior change.
    - Docs pages to create/edit:
      - `docs/credential-storage.md`: exact limits, async API, worker timeout, permission and compatibility behavior.
      - `docs/host-security.md`: vault/keychain failure and secret boundaries.
      - `docs/migration.md`: Promise-based envelope helper migration and stricter vault opening.
    - `docs/index.md` update: yes; update Credentials and Security/auth/trust entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Finite encrypted boundary:
      - Added one credential-limit module with validated positive-safe-integer defaults/hard caps: encrypted file 4/16 MiB, decrypted vault 3/12 MiB, scrypt memory estimate 256/256 MiB, keychain payload 3/12 MiB, and keychain timeout 5/60 seconds.
      - `readFileIfExists()` now opens once, verifies the opened Unix file mode before content read, rejects size by descriptor stat, allocates only the bounded snapshot, and always closes. Existing group/other-readable files fail before JSON/passphrase/KDF; Windows retains documented mode semantics.
      - Atomic writes use 128-bit random exclusive temp names, restrictive mode before rename, and unpublished-temp cleanup on failure. Configured group/other permissions fail at construction rather than being silently accepted or repaired.
      - Envelope writes are bounded before filesystem mutation. Failed set/delete/OAuth persistence leaves the prior in-memory vault unchanged.
    - Strict envelope/vault and KDF:
      - One `parseEncryptedEnvelope()` path serves public decrypt, file open/reload, and passphrase rotation. It requires exact version/algorithm/object keys, canonical bounded base64, 16-byte salt, 12-byte IV, at least the 16-byte GCM tag, bounded ciphertext, and validated KDF parameters before scrypt.
      - Scrypt requires power-of-two `N` in 16,384–262,144, `r≤32`, `p≤16`, exact 32-byte key, `N*r*p≤2,097,152`, and `128*N*r` within the configured maximum. Non-finite, unsafe, floor/cap, work, and memory violations fail synchronously with `WeakKdfParametersError`.
      - `deriveKey()`, `encryptBytes()`, and `decryptBytes()` now use callback-based `node:crypto.scrypt`; package public helpers are Promise-based and default scrypt no longer blocks the JavaScript event loop. Envelope version 1 and documented 0.0.5 parameters remain wire-compatible.
      - Vault parse/serialize enforce decrypted byte ceilings, exact root shape, entry kind/field/value shape, and canonical entry keys. Derived keys plus package-owned serialized/decrypted buffers are zeroed in `finally`; passphrase retrieval and native keychain failures are sanitized without echoing host errors.
    - Enforceable keychain timeout without new worker code:
      - Dependency audit found installed `@napi-rs/keyring@1.3.0` already provides `AsyncEntry` methods as N-API `AsyncTask` operations with optional `AbortSignal`. Reusing it is smaller and safer than adding a second Worker protocol/artifact around synchronous `Entry`.
      - One `runKeychainOperation()` helper schedules the native Promise, races a main-loop timer, aborts the N-API operation on timeout, and maps locked/timeout/other native errors to sanitized typed errors. A fake ignored operation proves the timer fires and signal aborts even when operation never settles.
      - Keychain storage uses bounded `Uint8Array` secrets rather than password strings; package-owned byte views are zeroed after parse/write. Invalid timeout/payload options reject before native module operations.
    - Adversarial coverage:
      - 27 credential tests cover authenticated round-trip, wrong key/tamper, strict shape/unknown fields/algorithms/version/base64/lengths, ciphertext/plaintext/file/vault ceilings, KDF floor/boundary/cap/work/memory matrices, event-loop responsiveness, version-1 reopen/rotation, restrictive and permissive Unix modes, atomic cleanup, failed-state rollback, passphrase/native error redaction, keychain timeout/abort/error mapping, invalid keychain limits, and optional live round-trip.
      - The opt-in OS keychain round-trip remains gated by `PRISM_TEST_KEYCHAIN=1`; no live keychain was available or substituted during this offline task.
    - Documentation completed:
      - Updated package README/changelog plus `docs/credential-storage.md`, `docs/host-security.md`, `docs/migration.md`, and `docs/index.md` with exact defaults/hard caps, Promise migration, version-1 compatibility, Unix repair guidance, native async timeout semantics, payload ownership, and platform boundaries.
      - Rechecked Node 20 async scrypt/maxmem, worker/termination, and file APIs plus keyring v1.3.0 declarations/source. The source-backed `AsyncEntry` finding changed the planned implementation before code was finalized.
    - Verification:
      - Credentials package build/typecheck and 27/27 tests pass; docs suite passes 84/84.
      - Full `npm run sdk:ready` passes: 1,725 tests, 1,700 pass, 25 explicit live skips, 0 fail; all workspace builds/typechecks and dry-run packs pass.
      - Credentials dry-run pack contains 24 release files (12.3 KiB packed/54.7 KiB unpacked), including declarations/limits and excluding tests, maps, and TypeScript source.
      - `git diff --check` passes. No provider, database, or OS-keychain credential was required; live keychain behavior remains the explicit Task 11 operator gate.

- [x] Bound MCP discovery/results and secure Streamable HTTP transport defaults
  - Acceptance Criteria:
    - Functional: MCP discovery has finite pages, tools, per-tool name/description/schema bytes, aggregate schema bytes, and cursor bytes; repeated cursors fail immediately; refresh is atomic and preserves the previous valid tool set on failure.
    - Functional: all result branches—including `content`, `structuredContent`, and SDK `toolResult`—share one aggregate byte/depth/property bound before entering `ToolResult`; remote error summaries are bounded and redacted by the host path.
    - Functional: Streamable HTTP is HTTPS-by-default, requires exact allowed origin policy, rejects credentials/fragments and redirects, blocks private/non-public resolution, and permits plaintext only for an explicitly enabled loopback development endpoint.
    - Performance: hostile pagination/schema/result fixtures terminate within configured page/tool/byte/time bounds without unbounded cache/compiler growth; all MCP option values are finite positive safe integers within hard caps.
    - Code Quality: one MCP limits resolver and bounded JSON walker serve list/result branches; SDK v1.29 request timeout/AbortSignal and custom fetch seams are reused rather than adding a second protocol client.
    - Security: SSRF checks apply to every HTTP request, including reconnect/session traffic; authorization headers are never redirected; stdio remains explicit host configuration; no partial hostile refresh replaces trusted tools.
  - Approach:
    - Documentation Reviewed:
      - `docs/mcp-tools.md`, `docs/host-security.md`, and MCP security best practices: <https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices>.
      - `@modelcontextprotocol/sdk` v1.29 documentation resolved as Context7 `/modelcontextprotocol/typescript-sdk/v1.29.0`: cursor pagination, `RequestOptions.signal/timeout`, `StreamableHTTPClientTransport`, and custom fetch support.
      - SDK sources: <https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/protocol.md> and package transport declarations.
      - `packages/mcp/src/bridge.ts`, `content.ts`, `transport.ts`, `constants.ts`, `types.ts`, `server.ts`, and all tests.
    - Options Considered:
      - Trust SDK list/call helpers and bound only mapped text: current schema compilation and alternate result branches bypass aggregate limits; rejected.
      - Replace the SDK: duplicates protocol/session behavior; rejected.
      - Retain SDK transport/client, add bounded list/result processing and a policy-enforcing custom fetch/connection seam: chosen.
    - Chosen Approach:
      - Resolve/validate all client limits once; track seen cursors and cumulative list budgets before mapping/committing refreshed tools.
      - Measure arbitrary JSON through a depth/count/byte-bounded walker without an unbounded `JSON.stringify()` copy.
      - Wrap SDK HTTP fetch with exact-origin, redirect-error, DNS/public-address policy and pinned/host-controlled request behavior; expose an explicit loopback-only development escape hatch.
    - API Notes and Examples:
      ```ts
      const bridge = await connectMcpTools({
        serverId: "docs",
        transport: {
          type: "streamable-http",
          url: "https://mcp.example.test/mcp",
          allowedOrigins: ["https://mcp.example.test"],
        },
        maxListPages: 20,
        maxTools: 500,
        maxToolSchemaBytes: 256 * 1024,
        maxResultBytes: 2 * 1024 * 1024,
      });
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/limits.ts`, `types.ts`: discovery/result/transport defaults, hard caps, and public options.
      - `packages/mcp/src/json-bounds.ts`, `bridge.ts`, `content.ts`: allocation-free bounded JSON measurement, cursor detection, aggregate discovery/result bounds, raw SDK requests, and atomic refresh.
      - `packages/mcp/src/transport.ts`: HTTPS/exact-origin/loopback policy and bounded DNS-pinned custom fetch/request integration.
      - `packages/mcp/src/index.ts`: public types/constants only as required.
      - `packages/mcp/src/__tests__/bridge.test.ts`, `content.test.ts`, `transport.test.ts` (new): hostile discovery/result/transport fixtures; existing server tests remain unchanged.
      - `packages/mcp/README.md`, `packages/mcp/CHANGELOG.md`.
    - References:
      - Current `listAllMcpTools()` loops until falsy cursor with no repetition/page/tool/schema bound.
      - Current `toolResult` returns directly and `structuredContent` is copied into value/metadata outside `mapMcpContentToBlocks()`.
      - Current HTTP transport accepts arbitrary `http:` or `https:` URLs and documents allow-listing as host-only.
  - Test Cases to Write:
    - Discovery: repeated/toggling cursor, endless unique cursors, page/tool/schema/description/aggregate overflow, invalid option values, abort, timeout, atomic refresh rollback.
    - Results: each content kind, structured content, SDK toolResult, deep/wide/cyclic-like hostile objects, aggregate overflow, bounded error summary, secret redaction path.
    - Transport: HTTPS exact origin succeeds; HTTP public host, private IPv4/IPv6, mixed DNS, redirect, credentialed URL, fragment, DNS rebinding fixture fail; explicit loopback development endpoint succeeds only with opt-in.
    - Lifecycle: session/reconnect requests retain policy, signal, timeout, and header isolation; close remains idempotent.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; MCP client limit options and HTTP transport security defaults change.
    - Docs pages to create/edit:
      - `docs/mcp-tools.md`: complete limits and secure transport configuration.
      - `docs/host-security.md`: MCP SSRF/result/schema trust boundary.
      - `docs/migration.md`: HTTP URL and new option migration.
    - `docs/index.md` update: yes; update MCP and Security/auth/trust entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Finite discovery and atomic refresh:
      - Added one MCP client-limit resolver. Defaults/hard caps are pages 20/100, tools 500/5,000, cursor 4/16 KiB, name 256 B/1 KiB, description 16/64 KiB, combined schemas per tool 256 KiB/1 MiB, aggregate schemas 4/16 MiB, JSON depth 64/128, JSON properties 10,000/100,000, result 10,000,000 B/16 MiB, call/list timeout 60 s/30 min, and cache TTL 30 s/24 h. Every option rejects non-finite, unsafe, zero/negative, and cap+1 values; hard boundaries are covered.
      - `listAllMcpTools()` now uses SDK v1.29 raw `client.request({ method: "tools/list" }, ListToolsResultSchema, { signal, timeout, maxTotalTimeout })`. This preserves SDK protocol/session behavior while bypassing `listTools()`'s eager Ajv compilation/cache of remote output schemas.
      - Pagination checks the next cursor before another request, catches same/toggling cycles, and checks page/tool/name/description/input+output schema/depth/property/aggregate budgets before appending. A failed initial connection closes; a failed later refresh leaves the previous tool-array reference and fetch timestamp untouched.
    - One result boundary:
      - Added one incremental JSON walker shared by discovery schemas and all call results. It counts escaped UTF-8 JSON bytes, array/object properties, and depth without `JSON.stringify()` or an `Object.entries()` copy; it rejects cycles, non-plain/non-JSON values, and non-finite numbers as soon as a budget is crossed.
      - Tool calls use raw SDK `tools/call` with `CompatibilityCallToolResultSchema`, finite timeout/abort, and the aggregate walker before creating a Prism result. Modern `content`, `structuredContent`, compatibility `toolResult`, and combinations cannot bypass the same byte/depth/property cap.
      - Structured content is retained once as `ToolResult.value`, not duplicated in metadata. MCP attribution and measured bytes remain metadata. Remote `isError` summaries and thrown SDK messages retain at most 8 KiB or the lower result cap; core dispatch with a host known-secret redactor was regression-tested.
      - Direct content mapping now validates `maxResultBytes` against the same hard cap. Existing UTF-8-safe truncation and image/resource/audio mapping remain compatible.
    - Secure Streamable HTTP default:
      - `streamable-http` now requires at least one exact origin and HTTPS. Endpoint and every custom-fetch invocation reject URL credentials, fragments, origin changes, Host overrides, non-HTTP(S) schemes, and all redirects; authorization therefore cannot follow a redirect or cross origin.
      - Every SDK POST, SSE GET/reconnect, and session DELETE resolves at most 32 addresses, rejects the entire set when any address is private/malformed, then pins the first validated public address through Node HTTP(S) `lookup` while retaining original hostname/SNI. Public plaintext and arbitrary private-network MCP are rejected.
      - `allowLoopbackHttp: true` is the sole plaintext escape hatch: endpoint hostname must be loopback/`localhost`, and every answer must stay loopback on every request. A rebinding fixture succeeds once at loopback then fails when DNS changes to `10.0.0.1`.
      - HTTP response streams default to 16 MiB with a 64 MiB hard cap; declared and chunked overflow cancel/error before SDK JSON/SSE retention. SDK transport close/reconnection and stdio configuration remain unchanged and explicit.
    - Adversarial coverage:
      - MCP tests increased from 16 to 33. Discovery fixtures cover valid pagination, repeated/toggling/endless cursors, page/tool/cursor/name/description/per-tool/aggregate schema/depth/property overflow, invalid/hard-boundary options, abort, and atomic rollback.
      - Result fixtures cover content, structured content, legacy `toolResult`, aggregate combinations, deep/wide/cyclic/non-finite objects, bounded remote errors, host redaction, timeout, list-change refresh, collisions, and normal core dispatch.
      - Loopback-only HTTP fixtures cover exact HTTPS policy construction, public HTTP, credentials/fragments, private IPv4/IPv6/metadata, mixed DNS, DNS rebinding, redirects with authorization, chunked overflow, abort, and repeated POST/GET/DELETE policy/header application. No public network or credential was used.
    - Documentation completed:
      - Updated package README/changelog plus `docs/mcp-tools.md`, `docs/host-security.md`, `docs/migration.md`, and `docs/index.md` with exact default/hard tables, raw SDK request behavior, atomic refresh, result branch ownership, Promise/timeout semantics, exact-origin DNS pinning, response caps, loopback migration, and remaining host trust/redaction boundaries.
      - Rechecked SDK v1.29 through Context7 `/modelcontextprotocol/typescript-sdk/v1.29.0`, installed declarations/source, and official 2025-11-25 MCP security best practices. Implementation follows official HTTPS, loopback-only development HTTP, private-address blocking, redirect denial, and DNS pinning guidance without replacing the SDK.
    - Verification:
      - MCP build/typecheck and 33/33 tests pass; docs suite passes 84/84.
      - Full `npm run sdk:ready` passes: 1,742 tests, 1,717 pass, 25 explicit live skips, 0 fail; all workspace builds/typechecks and dry-run packs pass.
      - MCP dry-run pack contains 24 release files (17.9 KiB packed/75.7 KiB unpacked), including declarations and new bounded helpers, excluding tests, maps, and TypeScript source.
      - `git diff --check` passes. Staging HTTPS interoperability remains an operator integration check, not a network dependency in the offline gate.

- [x] Bound compaction and observational-memory workers and fix A2A streaming UTF-8/SSE parsing
  - Acceptance Criteria:
    - Functional: LLM compaction retains at most a finite generated-text/error budget while streaming and always applies a finite summary output default/hard cap; provider request max tokens cannot become infinite.
    - Functional: observational-memory workers bound tool calls per turn/total, tool argument/result bytes, message growth, and generated errors; unknown/excess calls fail deterministically; all persisted/provider-returned errors and tool-result values are redacted.
    - Functional: A2A client uses one streaming `TextDecoder`, flushes it at end, parses LF and CRLF frame separators/multiline data correctly across arbitrary chunk boundaries, and preserves existing byte/event/terminal-state limits.
    - Performance: infinite provider deltas/tool calls and one-byte/split-multibyte A2A chunks retain bounded memory and terminate by configured limits/abort; valid streams remain incremental.
    - Code Quality: package-local streaming accumulators/parsers replace unbounded arrays and per-chunk decoder creation; existing redaction and finite-limit patterns are reused.
    - Security: raw provider/tool errors, tool results, and malformed remote frames never leak secrets; partial/truncated UTF-8 cannot alter parsed JSON or bypass event limits.
  - Approach:
    - Documentation Reviewed:
      - Compaction sections in `docs/session-stores.md`, `docs/host-security.md`, `docs/a2a.md`, and package READMEs.
      - Encoding Standard `TextDecoder` streaming behavior via Node.js docs: <https://nodejs.org/api/util.html#class-utiltextdecoder>.
      - `packages/compaction-llm/src/strategy.ts`; observational-memory `worker-loop.ts`, `runtime.ts`, `types.ts`, and `workers/*`; `packages/supervisor/src/a2a-client.ts`.
    - Options Considered:
      - Truncate only after joining all deltas/calls: current memory defect; rejected.
      - Buffer complete A2A body then parse: simpler but loses streaming/backpressure; rejected.
      - Incrementally retain bounded text/calls and use one decoder plus a small CRLF-aware SSE frame parser: chosen.
    - Chosen Approach:
      - Add finite defaults/hard caps at package option resolution; stop retaining beyond cap and abort provider work when safe, otherwise drain without growth.
      - Redact before adding worker messages/errors and bound serialized tool results before provider reuse.
      - Keep raw-byte stream totals, decoded frame buffer, and event totals as separate limits.
    - API Notes and Examples:
      ```ts
      createLlmCompactionStrategy({
        summaryModel,
        maxSummaryTokens: 4_096,
      });

      createObservationalMemoryRuntime({
        maxWorkerTurns: 8,
        maxWorkerToolCalls: 64,
        maxWorkerResultBytes: 64 * 1024,
      });
      ```
    - Files to Create/Edit:
      - `packages/compaction-llm/src/limits.ts` (new), `strategy.ts`, `index.ts`, tests, README, CHANGELOG; token estimation itself remains unchanged.
      - `packages/compaction-observational-memory/src/limits.ts` (new), `worker-loop.ts`, `runtime.ts`, `serialize.ts`, `settings.ts`, `index.ts`, `workers/observer.ts`, `workers/reflector.ts`, `workers/dropper.ts`, tests, README, CHANGELOG; memory record types remain unchanged.
      - `packages/supervisor/src/a2a-client.ts`, `src/__tests__/a2a.test.ts`, README, CHANGELOG; existing public A2A limits remain authoritative and unchanged.
    - References:
      - Current compaction accumulates `text: string[]`/`errors: string[]` before `join()`/cap.
      - Current memory worker accumulates every `tool_call`, inserts raw `result.value`/`result.error`, and throws raw provider error messages.
      - Current A2A loop creates `new TextDecoder()` for every chunk and recognizes only `\n\n`.
  - Test Cases to Write:
    - Compaction: endless/oversized deltas, excessive errors, absent max options, hard-cap+1, abort, split Unicode, redacted provider error, valid summary boundary.
    - Observational memory: excessive calls in one/across turns, huge arguments/results, unknown tools, raw secret in provider/tool error, abort, valid observe/reflect/drop journey.
    - A2A: every split point through a multibyte code point and `\r\n\r\n`, multiline data, mixed line endings, decoder flush, oversized frame/stream/event count, truncated final frame, terminal-state enforcement.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; compaction/worker limit options and A2A stream acceptance/error behavior change.
    - Docs pages to create/edit:
      - `docs/compaction-llm.md`: finite generated-summary/output limits.
      - `docs/compaction-observational-memory.md`: worker turn/call/result/error limits and redaction.
      - `docs/a2a.md`: UTF-8/CRLF compatibility and retained stream limits.
      - `docs/host-security.md`: provider/tool/remote error redaction boundaries.
      - `docs/migration.md`: new defaults/options if public configuration changes.
    - `docs/index.md` update: yes; update Compaction/session memory and A2A entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - LLM compaction finite retention:
      - Added one package-local limit validator and exported named defaults/hard caps: summary 16,384/131,072 tokens, reserve 16,384/131,072 tokens, and retained provider error detail 1/8 KiB. `maxOutputTokens` remains a validated compatibility alias; `maxSummaryTokens` wins.
      - Every request starts with finite `model.parameters.maxTokens`. After provider request policies run, missing/non-finite/unsafe/non-positive/above-hard-cap `maxTokens` rejects; a valid policy value can only narrow the configured summary ceiling. Infinite model metadata is ignored in favor of the finite default.
      - Provider text is exact-known-secret redacted while retained, bounded to four UTF-16 code units per summary token, and sliced without leaving a high surrogate. Overflow closes/aborts provider iteration; final history/turn/file composition receives the same exact ceiling. Tiny ceilings prefer the cap over retaining a truncation marker.
      - A derived `maxChars + 1,024` event ceiling terminates endless empty/non-text deltas without another public knob. Provider error events, generator throws, provider-factory failures, and policy failures expose only UTF-8-bounded redacted detail; the unbounded `text[]`/`errors[]` post-join path is gone.
    - Observational-memory worker boundaries:
      - Added one worker-limit resolver with exported defaults/hard caps: turns 16/64, calls per turn 32/256, total calls 128/1,024, arguments 64 KiB/1 MiB, full results 64 KiB/1 MiB, complete transcript 1/8 MiB, and surfaced errors 1/8 KiB. Runtime flat `maxWorker*` options map once into the same limits consumed by direct observer/reflector/dropper calls.
      - `agentMaxTurns` now rejects fractions, non-finite/unsafe/zero/negative/cap+1 values instead of flooring/falling back; runtime `maxWorkerTurns` takes precedence. Calls on the final allowed turn still execute, but no additional provider request starts.
      - Worker prompts serialize/join incrementally within the transcript ceiling. Each raw call/name/id/argument, redacted replay call, cumulative assistant call message, complete returned `ToolResult`, redacted value/error payload, and appended provider message is checked before retention/reuse. The package-local JSON walk has fixed depth 64, no wide-object entry-array copy, and rejects cycles/non-plain/non-JSON/non-finite values.
      - Unknown and excess calls fail before transcript append/tool execution. Provider/tool throws, error events, replayed arguments/results, runtime `lastError`, and debug error data are bounded and exact-known-secret redacted; persisted observation/reflection data retains the existing final redaction pass.
    - Correct incremental A2A SSE:
      - `createA2AClient().stream()` now creates one fatal UTF-8 `TextDecoder`, uses `{ stream: true }` for every body chunk, and flushes once at EOF. Malformed/incomplete UTF-8 fails with package-owned text instead of inserting `U+FFFD` into JSON.
      - A package-local line parser coalesces at 4 KiB, accepts LF/CRLF/mixed blank-line separators, comments/unknown fields, and multiline `data:` values, while retaining only current line/event data. Raw stream bytes, current event bytes, and event count remain separate existing limits; no public A2A default/hard cap changed.
      - Unterminated non-whitespace frames, malformed JSON/RPC/task data, missing terminal state, failed/canceled tasks, and any frame after completion fail. Valid text artifacts remain incremental and receive the existing host redactor before yield.
    - Adversarial coverage:
      - LLM compaction tests increased from 26 to 28: huge/endless text and empty-event streams, provider iterator close, split surrogate deltas, bounded/redacted event and thrown errors, invalid/hard-boundary option matrices, post-policy Infinity, abort, and existing valid history/split-turn/credential flows pass.
      - Observational-memory tests increased from 41 to 46: unknown/per-turn/total call overflow, oversized arguments/results/prompts, bounded redacted provider/tool/runtime errors and result replay, invalid/hard worker limits/settings, abort, transcript ordering, and valid observe/reflect/drop/runtime journeys pass.
      - Supervisor tests increased from 11 to 13: every byte split of a UTF-8+CRLF terminal frame, one-byte chunks, mixed/multiline data, malformed final UTF-8, truncated frame, post-terminal event, event/stream/count overflow, plus existing card/auth/send/server limits pass without network.
    - Documentation completed:
      - Updated all three package READMEs/changelogs plus `docs/compaction-llm.md`, `docs/compaction-observational-memory.md`, `docs/a2a.md`, `docs/host-security.md`, `docs/migration.md`, and `docs/index.md` with complete defaults/hard caps, API examples, precedence, failure/redaction behavior, UTF-8/SSE compatibility, and remaining host boundaries.
      - Context7 did not return an authoritative Node.js documentation library, so official Node `util.TextDecoder` documentation was fetched directly and checked alongside the existing core bounded SSE parser before implementation. No dependency or duplicate general provider transport was added.
    - Verification:
      - Focused build/typecheck and tests pass: LLM compaction 28/28 counted (27 pass, 1 explicit live skip), observational memory 46/46 pass, supervisor 13/13 pass, and docs 84/84 pass.
      - Full `npm run sdk:ready` passes: 1,751 tests, 1,726 pass, 25 explicit live skips, 0 fail; all workspace builds/typechecks and 30 dry-run packs pass.
      - Dry-run packs: LLM compaction 22 files/10.2 KiB packed/36.9 KiB unpacked; observational memory 46 files/16.9 KiB/76.7 KiB; supervisor 22 files/16.2 KiB/72.6 KiB. Tests, maps, and TypeScript source remain excluded.
      - `git diff --check` passes. No provider credentials or public network were used; live provider interoperability remains an explicit Task 11 operator gate.

- [x] Detect migration drift and verify complete SQLite/PostgreSQL schema shape
  - Acceptance Criteria:
    - Functional: migration records carry deterministic checksums; startup rejects unknown, duplicate, out-of-order, version-mismatched, or checksum-mismatched rows before applying new DDL.
    - Functional: known legacy rows with null checksums are accepted only through an explicit one-time compatibility path that verifies complete expected schema shape before transactionally backfilling checksums.
    - Functional: readiness verifies tables, columns, types/affinity, nullability, defaults, primary/unique/foreign-key/check constraints where portable, and required indexes—not names alone—for schema version 3.
    - Performance: schema verification uses bounded catalog/PRAGMA queries at open and no table-data scans; concurrent PostgreSQL migration remains advisory-lock serialized and SQLite remains transaction serialized.
    - Code Quality: checksum/shape expectations live in shared `@arnilo/prism/testing/persistence-schema` contracts; dialect adapters implement only catalog extraction/normalization.
    - Security: drift fails closed before runtime writes; SQL values remain parameterized and configurable PostgreSQL schema identifiers remain validated/quoted; migration errors expose no credentials or row payloads.
  - Approach:
    - Documentation Reviewed:
      - `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/migration.md`, and `docs/release-and-install.md`.
      - PostgreSQL information schema/system catalogs and advisory locks: <https://www.postgresql.org/docs/current/infoschema-columns.html> and <https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS>.
      - SQLite schema PRAGMAs: <https://sqlite.org/pragma.html#pragma_table_info>, <https://sqlite.org/pragma.html#pragma_index_list>, and <https://sqlite.org/pragma.html#pragma_foreign_key_list>.
      - Shared schema model plus both adapters' `migrations.ts`, `ddl.ts`, and integration tests.
    - Options Considered:
      - Continue checking table/index names: misses altered columns/constraints; rejected.
      - Introduce a migration framework/ORM: unnecessary dependency and release surface; rejected.
      - Extend existing shared schema/migration conformance with deterministic DDL checksums and dialect catalog readers: chosen.
    - Chosen Approach:
      - Add checksum to `PersistenceMigrationStep`, derived from canonical checked-in migration content; validate applied history under the existing migration lock/transaction.
      - Normalize SQLite/PostgreSQL catalog output into a shared schema-shape record and compare against the model.
      - Backfill legacy null checksums only after the corresponding full schema version passes shape verification.
    - API Notes and Examples:
      ```ts
      const contract = createPersistenceMigrationContract();
      // Each step includes { name, version, checksum }.
      await createPostgresPersistence({ pool, schema: "prism" }); // fails on drift
      ```
    - Files to Create/Edit:
      - `src/testing/persistence-schema.ts`, `src/__tests__/persistence-schema.test.ts`; existing testing subpath export retained.
      - `packages/session-store-sqlite/src/migrations.ts`, `src/__tests__/sqlite-persistence.test.ts`; checked-in v3 DDL retained after the shared model was corrected to its actual nullable/non-unique definitions.
      - `packages/session-store-postgres/src/migrations.ts`, `src/__tests__/postgres-persistence.test.ts`, `postgres-integration.test.ts`; checked-in v3 DDL retained.
      - Adapter READMEs and CHANGELOGs.
    - References:
      - Current adapters write `checksum = null`; applied-row types load only name/version; readiness filters expected table/index names and does not inspect columns or constraints.
      - Existing `createPersistenceMigrationContract()`, advisory lock, SQLite transaction, and schema model are retained.
  - Test Cases to Write:
    - Migration history: clean install, reopen, concurrent open, unknown/duplicate/out-of-order/name/version/checksum drift, transaction rollback, and valid legacy-null checksum backfill.
    - Schema drift: missing/renamed/wrong-type/nullability/default/PK/FK/unique/index column in isolated fixtures fails readiness.
    - Cross-adapter parity: SQLite and PostgreSQL normalized shape satisfy the same shared model and migration checksums.
    - Live PostgreSQL: fresh schema and upgraded schema pass under `PRISM_TEST_POSTGRES_URL`; no default-suite network dependency.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; adapter startup/migration failure behavior and testing migration contract change.
    - Docs pages to create/edit:
      - `docs/database-persistence.md`: checksum and full-shape contract.
      - `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`: startup verification and legacy backfill.
      - `docs/migration.md`: 0.0.5→0.0.6 adapter upgrade/failure recovery.
    - `docs/index.md` update: yes; update Persistence entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Shared migration contract and history validation:
      - `PersistenceMigrationStep` now carries a deterministic lowercase SHA-256 checksum. Checksums derive from canonical checked-in migration schema content: v1 table/index snapshot excluding later additive elements, v2 usage additions, and v3 feedback table/index additions.
      - New `assertAppliedPersistenceMigrations()` validates only an exact ordered prefix of known name/version/checksum steps. It rejects unknown extra rows, duplicate/reordered/name-version mismatch, checksum mismatch, and mixed/partial legacy null checksums before adapter DDL or runtime writes.
      - The sole compatibility path accepts all-null checksums only for a complete three-step v3 history. Both adapters hold their existing migration transaction/lock, verify full v3 shape, backfill every null checksum with parameterized updates, then re-read/validate. No automatic repair runs for partial legacy state or schema drift.
    - Shared full-shape contract:
      - Added normalized `PersistenceSchemaShape` table/column/foreign-key/index records and `assertPersistenceSchemaShape()`. The shared contract checks every v3 model table's exact column count/name, dialect-compatible type/affinity, nullability, portable default, ordered primary key, required unique keys, required foreign keys, and every named index's table/column/unique definition.
      - SQLite maps raw `TEXT`/`INTEGER`/`REAL` affinities; PostgreSQL maps `text`/`integer`/`boolean`/`double precision`. SQLite JSON/timestamp values and PostgreSQL adapter JSON/timestamp values remain `TEXT` as actually declared by v3 DDL.
      - Corrected three shared-model inaccuracies exposed by strict verification without altering released DDL: `prism_session_entries.schema_version` is nullable, feedback `tenant_id` is required, and the two named idempotency/migration lookup indexes are non-unique because their table primary/unique constraints enforce uniqueness. Partial `prism_runs_tenant_idempotency_unique` remains required and unique as its named index rather than being incorrectly modeled as a table unique constraint.
    - Adapter catalog/readiness behavior:
      - SQLite performs bounded `sqlite_master`, `PRAGMA table_info`, `index_list`/`index_info`, and `foreign_key_list` reads over the fixed v3 contract; no application-table row is scanned. Migration/history/shape verification runs inside its existing serialized transaction.
      - PostgreSQL performs three bounded metadata queries—`information_schema.columns`, `pg_constraint` with ordered `conkey`/`confkey`, and `pg_index`/`pg_attribute`—restricted to fixed expected tables/indexes. It runs while the existing schema-derived `pg_advisory_xact_lock` transaction is held. Configurable schema remains validated/quoted; all values remain parameters.
      - PostgreSQL `name[]` catalog arrays are parsed only as driver arrays or canonical `{identifier,...}` values; malformed catalog values fail closed. No ORM/framework/dependency was introduced.
    - Adversarial and compatibility coverage:
      - Core persistence-schema tests increased from 8 to 10: deterministic/hard-format checks, exact valid history, all-null complete legacy history, checksum/name/version/order/partial-null failures, and full normalized shape/default drift all pass.
      - SQLite tests increased from 11 to 13: fresh/reopen/full conformance remains green; complete null checksum history backfills; tampered checksum and dropped required index reject before adapter use and leave legacy checksums null after rollback.
      - PostgreSQL live integration added a backfill/drop-index journey. A disposable local `postgres:16` container ran all 17 package tests (17 pass) including session-store, ledger, feedback, checkpoint, lease, concurrent advisory-lock, migration reopen, checksum backfill, and shape-drift flows. Offline package tests remain 6 pass plus 1 explicit live suite skip without `PRISM_TEST_POSTGRES_URL`.
    - Documentation completed:
      - Updated both adapter READMEs/changelogs and `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/migration.md`, and `docs/index.md` with checksums, legacy backfill preconditions, full-shape coverage, no-table-scan behavior, drift recovery, and the no-manual-checksum-edit boundary.
      - Context7 verified current PostgreSQL `information_schema` constraints/key columns/advisory-lock behavior and SQLite catalog/PRAGMA inspection before implementation. No dependency lookup result changed runtime code.
    - Verification:
      - `npm run typecheck` and `npm run build` pass across core/examples/workspaces; core persistence-schema 10/10, SQLite 13/13, PostgreSQL offline 6/6 plus one explicit live skip, and docs 84/84 pass.
      - Live PostgreSQL test: disposable Docker `postgres:16`, `PRISM_TEST_POSTGRES_URL=postgres://postgres:***@127.0.0.1:55432/prism npm run test:postgres -w @arnilo/prism-session-store-postgres`, 17/17 pass. Container stopped/removed after test; no production credential used.
      - `git diff --check` passes. Full SDK readiness/pack gate remains Task 11 release-candidate evidence.

- [x] Bound JSON Schema compilation, reject non-finite vectors, and remove insecure identifier fallbacks
  - Acceptance Criteria:
    - Functional: JSON Schema validator rejects invalid option values, oversized/deep/wide schemas, excessive refs/keywords, and cache overflow before Ajv compilation; compiled cache has a finite deterministic eviction policy.
    - Functional: embedding outputs, in-memory vector upserts/queries, and PostgreSQL vector paths reject NaN, positive/negative Infinity, empty/mismatched dimensions, and non-number values before scoring/storage.
    - Functional: run/session/tool/workflow/evaluation identifiers use `crypto.randomUUID()` or `randomBytes()` with no `Math.random()`/timestamp fallback; sampling randomness remains injectable and is not misclassified as an identifier.
    - Performance: schema walk/compile cache and vector validation are bounded by finite safe-integer options; identifier generation remains O(1); no new runtime dependency is added.
    - Code Quality: one schema bounds resolver/walker, one finite-vector assertion, and one core ID helper replace duplicated insecure fallbacks where package boundaries permit; package-local IDs stay package-local rather than creating cross-package coupling.
    - Security: untrusted schemas cannot create unbounded Ajv memory growth or prototype/remote-ref bypass; non-finite values cannot poison similarity ordering/database vectors; security-relevant IDs retain cryptographic unpredictability.
  - Approach:
    - Documentation Reviewed:
      - `docs/host-security.md`, tool validation docs linked from it, working/semantic-memory docs, and public contract/release docs.
      - Ajv strict/options/security guidance: <https://ajv.js.org/options.html> and <https://ajv.js.org/security.html>.
      - Node.js `crypto.randomUUID()`/`randomBytes()`: <https://nodejs.org/api/crypto.html>.
      - `packages/tool-validator-json-schema/src/json-schema.ts`; memory embedder/vector/PostgreSQL paths; all production `Math.random()` identifier callers found by repository scan.
    - Options Considered:
      - Rely on Ajv strict mode and garbage collection: does not bound schema work or cache cardinality; rejected.
      - Clamp invalid values silently: hides hostile/misconfigured inputs; rejected.
      - Validate and reject before compile/store, use a small LRU cache, and use Node crypto directly on supported Node ≥20: chosen.
    - Chosen Approach:
      - Add schema byte/depth/property/ref/keyword and compiled-cache defaults/hard caps; validate all existing instance options with positive safe-integer rules.
      - Export/reuse a finite vector assertion inside memory package for embed/query/upsert/PostgreSQL adapter paths.
      - Replace ID helpers in core and optional packages; retain injected `random()` only for evaluation sampling tests.
    - API Notes and Examples:
      ```ts
      const validate = createJsonSchemaToolArgumentValidator({
        maxSchemaBytes: 256 * 1024,
        maxCompiledSchemas: 256,
        maxDepth: 64,
      });
      ```
    - Files to Create/Edit:
      - `packages/tool-validator-json-schema/src/json-schema.ts`, tests, README, CHANGELOG.
      - `packages/memory/src/embedder.ts`, `vector-memory.ts`, `postgres.ts`, `util.ts` or a package-local validation helper, tests, README, CHANGELOG.
      - `src/ids.ts` (new), `src/agents.ts`, `src/agent-loops.ts`, `src/session-stores.ts`, `src/tools.ts`: private cryptographic core ID helper.
      - `packages/workflows/src/util.ts`, `run.ts`, `packages/evals/src/util.ts`, and all production fallback callers found by the Task 1 audit.
      - Corresponding core/package tests, READMEs, changelogs, migration/security/docs navigation pages.
    - References:
      - Current JSON Schema options are not validated, schema traversal has no size/depth/count cap, and compiled `Map` never evicts.
      - Current vector checks validate lengths but not `Number.isFinite()` elements.
      - Current core/workflow/eval ID helpers include `Math.random()` fallbacks; Node ≥20 is the declared runtime.
  - Test Cases to Write:
    - Schema options: NaN/Infinity/unsafe/zero/negative/hard-cap+1 rejection and boundary acceptance.
    - Schema attacks: deep/wide/oversized/ref-heavy/forbidden-key/remote-ref input, compile exception, cache hit/eviction/order, semantically distinct schemas.
    - Vector matrix: NaN/±Infinity/non-number/empty/wrong-length in embed output, memory upsert/query, and PostgreSQL parameter path; finite boundary vectors preserve ordering.
    - IDs: format/uniqueness smoke and source/runtime guard proving production ID helpers no longer call `Math.random()`; injected evaluation sampler remains deterministic.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; validator options/cache behavior, memory validation errors, and generated identifier implementation change.
    - Docs pages to create/edit:
      - `docs/tools.md` and `docs/tool-execution-primitives.md`: schema/cache limits.
      - `docs/working-and-semantic-memory.md` and `docs/postgres-persistence.md`: finite-vector requirement.
      - `docs/host-security.md`: untrusted schema/vector and cryptographic ID notes.
      - `docs/migration.md`: newly rejected invalid options/data.
    - `docs/index.md` update: yes; update Tools, Memory, and Security/auth/trust entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - JSON Schema compilation boundary:
      - `@arnilo/prism-tool-validator-json-schema` resolves and rejects every existing/new limit at construction: non-finite, unsafe, zero/negative, and above-hard values fail rather than clamp. Existing instance caps are now finite-hard-bound (errors 8/64, depth 64/128, properties 1,000/100,000, strings 1/8 MiB, arrays 10,000/100,000).
      - New pre-Ajv schema walker counts serialized bytes without creating a whole-schema JSON string, depth, object properties, keywords, and `$ref` entries; defaults/hards are 256 KiB/1 MiB, 64/128, 10,000/100,000 properties, 128/1,024 refs, 10,000/100,000 keywords, and a 256/1,024 compiled-schema cache.
      - The walker rejects cycles, non-plain/non-JSON objects, non-finite schema numbers, forbidden keys, and every non-fragment `$ref` before `Ajv.compile()`. It retains only fragment-local references, keeps strict Ajv/schema validation, and retains no remote loader.
      - Compiled validators use one deterministic insertion-ordered Map LRU. Cache hit promotion is delete/reinsert; at capacity, oldest matching Ajv schema is removed before compiling/retaining the replacement. `addUsedSchema: false` prevents untrusted `$id` values accumulating in Ajv's global registry. No new dependency/abstraction was added.
    - Finite-vector boundary:
      - Added/exported one `assertFiniteVector(value, label, expectedLength?)` in memory. It rejects empty arrays, non-number values, NaN, ±Infinity, and mismatched configured dimensions.
      - It now gates host embedder output in `embedBatched`, in-memory vector upsert/query before cosine scoring, pgvector upsert/query before parameter serialization, and parsed PostgreSQL vectors/scores before return. Existing RAG finite validation remains compatible; no silent coercion/filtering occurs.
    - Cryptographic identifier boundary:
      - Added private core `createId(prefix)` backed by Node `randomUUID()` and replaced core session/run/usage/event/tool-call/message helpers in agents, loops, session stores, and tools.
      - Workflow run and tool-call IDs plus evaluation/experiment IDs now use package-local Node `randomUUID()`. The only production `Math.random()` left is `shouldSample`'s documented injectable sampler; it does not create an identifier. All production `Math.random()`/timestamp ID fallbacks are gone.
    - Adversarial coverage:
      - JSON Schema tests now cover invalid value matrices for all 11 limits, deep/wide/oversized/ref-heavy schemas, non-local refs, cache eviction with colliding `$id`, malformed schemas, prototype keys, and existing dispatch behavior (16/16 pass).
      - Memory tests cover direct vectors containing NaN/±Infinity/non-number/empty/wrong dimension, in-memory upsert/query rejection, and hostile embedder output before persistence/scoring (12/12 pass).
      - Core session-store tests add UUID format/uniqueness coverage. Workflow 59/59 and evals 9/9 remain green with opaque UUID output.
    - Documentation completed:
      - Updated validator/memory READMEs and changelogs, root/workflow/evals changelogs, `docs/tools.md`, `docs/tool-execution-primitives.md`, `docs/working-and-semantic-memory.md`, `docs/postgres-persistence.md`, `docs/host-security.md`, `docs/migration.md`, and `docs/index.md` with options/defaults/hard limits, failure behavior, finite vectors, cryptographic opaque IDs, and host trust boundaries.
      - Context7 reviewed Ajv v8.17.1 strict/security/options and `removeSchema()` behavior (`/ajv-validator/ajv/v8.17.1`) before implementation. The Node library lookup did not return a relevant Context7 record; Node 20's already-declared `node:crypto.randomUUID()` was directly typechecked against installed runtime declarations. No third-party API/dependency was introduced.
    - Verification:
      - `npm run build:core`; builds for validator, memory, workflows, and evals; focused validator/memory/workflow/evals suites; full offline `npm test`; and docs 84/84 pass.
      - Production source scan finds no `Math.random()` or timestamp-base36 ID fallback. Sampling's explicitly injected `shouldSample(..., random = Math.random)` is the sole audited exception.
      - `git diff --check` passes. PostgreSQL/pgvector live conformance remains the opt-in Task 11 release-candidate gate; no network/production credential was used.

- [x] Review artifact-loop/tool-dispatch primitives for bounded reuse
  - Acceptance Criteria:
    - Functional: inventory every artifact-loop provider-turn, transcript, dispatch, revision, event, and public-option caller; confirm one existing runtime dispatcher remains authoritative.
    - Performance: identify a finite provider-turn ceiling from existing `maxRevisions` and `maxToolRounds`; do not add a queue, registry, or retry loop.
    - Code Quality: select the smallest change that preserves `singleShotLoop` behavior and keeps tool dispatch sequential in artifact mode.
    - Security: prove calls stay in `LoopContext.dispatchToolCall` and existing redaction/store/ledger/event paths; reject any direct `ToolDefinition.execute` design.
  - Approach:
    - Documentation Reviewed:
      - `feature-requests/prism-tool-calls-in-generate-validate-revise.md`, `docs/agent-loops.md`, `docs/tools.md`, `docs/agent-events.md`, and `docs/structured-output.md`.
      - `src/agent-loops.ts`, `src/agents.ts`, `src/contracts.ts`, and existing loop/runtime tests.
    - Options Considered:
      - Add a second artifact tool dispatcher or registry: duplicates authorization and transcript behavior; rejected.
      - Make artifact tools parallel with single-shot concurrency: exceeds first increment request and complicates event timing; rejected.
      - Reuse `dispatchToolCallsInOrder` with an artifact-only sequential context and one opt-in union field: chosen.
    - Chosen Approach:
      - Add only `toolCalls?: "disabled" | "bounded"` to the existing generate-validate-revise options and pass it into the existing factory.
      - On a bounded tool response, append its assistant message, dispatch through existing helper with concurrency `1`, skip parser/validator, and continue with empty next input. Count tool rounds once per provider response across all artifact candidates.
    - API Notes and Examples:
      ```ts
      await session.run(input, {
        maxToolRounds: 2,
        loop: { strategy: "generate-validate-revise", toolCalls: "bounded", validator },
      });
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`, `src/contracts.ts`, and `src/__tests__/agent-loops.test.ts`: inventory targets and implementation/test seam.
      - `docs/agent-loops.md`, `docs/tools.md`, `docs/structured-output.md`, `docs/agent-events.md`, `docs/index.md`, root `CHANGELOG.md`, and this plan: public behavior/navigation/release record.
    - References:
      - `singleShotLoop` and `dispatchToolCallsInOrder` already route every call through the runtime-owned `LoopContext` dispatcher.
  - Test Cases to Write:
    - Primitive audit: direct and runtime tests prove tool results use the existing dispatcher/transcript helper; no new direct execute path.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; existing generate-validate-revise options gain an explicit opt-in tool mode.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`, `docs/tools.md`, `docs/structured-output.md`, `docs/agent-events.md`: option, transcript/event ordering, shared bounds, and security boundary.
    - `docs/index.md` update: yes; update Agent loops/Tools functional descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Read feature request plus all affected public docs/contracts/runtime paths. `ProviderTurnResult.calls`, `LoopContext.maxToolRounds`, `LoopContext.dispatchToolCall`, `appendMessage`, `emit`, and `dispatchToolCallsInOrder` already provide required bounded behavior.
    - `singleShotLoop` proves dispatch transcribes assistant→tool results and runtime builds `LoopContext.dispatchToolCall` over registry/filter/permission/validator/middleware/redactor/ledger. `generateValidateReviseLoop` alone currently ignores `calls`; no caller needs a new registry, event type, result type, or dispatcher.
    - Chosen minimum: one explicit disabled-by-default union option, loop-local tool/attempt counters, and reuse `dispatchToolCallsInOrder` with concurrency one. Tool call provider turns skip artifact parsing/validation; candidate turns retain existing callbacks/events. This proves max turns `1 + maxRevisions + maxToolRounds`.

- [x] Add bounded tool rounds to `generateValidateReviseLoop`
  - Acceptance Criteria:
    - Functional: default/`"disabled"` behavior remains bit-for-bit current artifact behavior. `"bounded"` persists assistant tool calls, dispatches calls sequentially through `LoopContext.dispatchToolCall`, persists matching results once, and makes them available before next generation.
    - Functional: tool-calling responses skip parsing/validation; call-free responses alone become artifact candidates. Tool calls work before initial candidate and after a repair; `maxRevisions: 0` still permits tool rounds before one candidate.
    - Functional: `maxToolRounds` is run-global across initial/revision candidates. A post-budget tool response executes nothing, emits terminal `artifact_failed` with `{ metadata: { reason: "tool_round_limit" } }`, and returns without another provider turn. Candidate failure retains existing `artifact_failed` behavior.
    - Performance: provider turns are bounded by `1 + maxRevisions + maxToolRounds`; dispatch is sequential, no worker pool/new queue/retry path is added.
    - Code Quality: use existing `dispatchToolCallsInOrder`, `toolResultMessage`, LoopContext, artifact contracts, redaction/event/store/ledger paths. Keep public options discriminated and documented.
    - Security: tools remain inactive unless host registered/filtered them and caller opts into `"bounded"`; unknown/denied/malformed/validator-blocked calls return existing blocked result/events and never invoke host code; abort stops dispatch/follow-up generation.
  - Approach:
    - Documentation Reviewed:
      - Feature request acceptance semantics and non-goals; current public contract/docs above.
      - Existing tool dispatch/lifecycle/ledger tests and `dispatchToolCallsInOrder` implementation.
    - Options Considered:
      - Parse text beside a tool call: ambiguously validates an incomplete artifact; rejected.
      - Spend revision budget for a tool round: violates artifact candidate semantics; rejected.
      - Add an artifact-specific result/event union: existing `ArtifactValidation.metadata` and tool lifecycle events cover required outcome; rejected.
      - One loop-local `toolRounds` counter plus `attempts` counter, reusing the existing dispatcher at concurrency one: chosen.
    - Chosen Approach:
      - Thread optional `toolCalls` into `generateValidateReviseLoop`; resolve absent value to disabled.
      - Refactor loop termination to count provider turns separately from parsed artifact attempts. On a bounded tool response, enforce cap before dispatch, dispatch via `{ ...ctx, toolConcurrency: 1 }`, then continue. On limit exhaustion emit the existing terminal artifact failure with stable metadata.
    - API Notes and Examples:
      ```ts
      loop: {
        strategy: "generate-validate-revise",
        toolCalls: "bounded", // default: "disabled"
        validator,
        maxRevisions: 2,
      }
      // max provider turns: 1 + maxRevisions + maxToolRounds
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: public `toolCalls` option documentation.
      - `src/agent-loops.ts`: bounded sequential orchestration and factory/resolve plumbing.
      - `src/__tests__/agent-loops.test.ts`: direct and runtime regression/adversarial coverage.
      - `docs/agent-loops.md`, `docs/tools.md`, `docs/structured-output.md`, `docs/agent-events.md`: public API, transcript/event ordering, limits, and failure result semantics.
      - `docs/index.md`, `CHANGELOG.md`, `plans/068-release-0-0-6-production-blockers.md`: navigation/release/plan evidence.
    - References:
      - `feature-requests/prism-tool-calls-in-generate-validate-revise.md` acceptance tests 1-11.
      - `src/agent-loops.ts:dispatchToolCallsInOrder`; `src/tools.ts:dispatchToolCall` lifecycle guards.
  - Test Cases to Write:
    - Initial and repair tool lookup: one tool dispatch/result before valid artifact; parser/validator only see call-free candidates, revision/tool counters stay independent.
    - Shared round/turn ceiling and `maxRevisions: 0`: cap provider calls at `1 + maxRevisions + maxToolRounds`; no extra post-cap execution; terminal `tool_round_limit` metadata.
    - Transcript/security: assistant call then matching tool result precede follow-up request exactly once; unknown/denied/malformed/validator-blocked path remains dispatcher-owned/redacted/ledgered.
    - Abort/compatibility: abort in dispatch/follow-up prevents another generate; omitted/disabled mode and call-free ordering remain unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new opt-in `AgentLoopOptions` setting changes artifact-loop tool behavior/events/transcript.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: What/when/inputs/outputs/example/extension/security sections for bounded artifact tools.
      - `docs/tools.md`: artifact-loop availability and unchanged dispatcher guard boundary.
      - `docs/structured-output.md` and `docs/agent-events.md`: candidate-vs-tool-round ordering, ceiling, terminal reason.
      - `CHANGELOG.md`: unreleased feature note.
    - `docs/index.md` update: yes; Agent loops and Tools descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Public API and default:
      - Added `toolCalls?: "disabled" | "bounded"` only to the existing `generate-validate-revise` branch of `AgentLoopOptions` and factory plumbing. Omitted/`"disabled"` preserves the old behavior: calls remain assistant content and are not dispatched.
      - `"bounded"` is explicit and consumes existing run-level `maxToolRounds`; no tool registry, dispatcher, policy, event type, dependency, or parallel artifact-mode API was added.
    - Bounded orchestration:
      - The loop now separates provider `turn`, parsed artifact `attempt`, and shared `toolRounds`. A call-free response alone parses/validates and consumes an artifact attempt; failed candidates alone consume `maxRevisions`.
      - A bounded tool response first persists the assistant tool-call message, then reuses `dispatchToolCallsInOrder(calls, { ...ctx, toolConcurrency: 1 })`, which appends exactly one matching tool-result message through existing `LoopContext.dispatchToolCall`/`appendMessage`. Its next provider request sees this shared transcript and gets empty new input, so no repair/input duplication occurs.
      - The provider loop has no unbounded path: at most `1 + maxRevisions + maxToolRounds` turns. A response requesting calls after the shared cap dispatches nothing and emits existing terminal `artifact_failed` with `{ ok: false, errors: [{ message: "maximum tool rounds exceeded" }], metadata: { reason: "tool_round_limit" } }`; it returns normal last usage rather than throwing.
    - Guard and redaction preservation:
      - Artifact tools retain exact active registry, filtering, permission, object-argument, host validator, middleware, lifecycle-event, ledger, abort, and redaction behavior because every call still routes through runtime-owned `dispatchToolCall`.
      - Runtime integration proves a validation-blocked tool never executes host code and secret-bearing call arguments/validator errors are absent from events, next provider request, and persisted session transcript.
    - Coverage and verification:
      - Core loop tests increased from 27 to 32 and cover initial lookup, two sequential calls despite `toolConcurrency: 2`, initial-only `maxRevisions: 0`, repair lookup/shared bound, exact turn ceiling, post-cap `tool_round_limit`, disabled compatibility, runtime guard/redaction/transcript correctness, and abort before follow-up generation.
      - `npm run build:core`, `node --test dist/__tests__/agent-loops.test.js` (32/32), full offline `npm test` (0 failures; explicit live skips only), and `git diff --check` pass. Full SDK/pack/package gate remains Task 11 final release evidence.
    - Documentation completed:
      - Updated `docs/agent-loops.md`, `docs/tools.md`, `docs/structured-output.md`, `docs/agent-events.md`, and `docs/index.md`; root changelog records the opt-in behavior, candidate/tool budgets, transcript ordering, terminal reason, and unchanged authority boundary.

- [x] Integrate documentation, package versions, and the 0.0.6 release-candidate gate
  - Acceptance Criteria:
    - Functional: all affected public docs, package READMEs/changelogs, root changelog, examples, exports, declarations, package versions/internal ranges, and lockfile describe and resolve as 0.0.6; roadmap Phase 1 is marked complete only after every prior task and gate passes.
    - Performance: adversarial fixtures complete within the existing default test budget or a measured justified revision; `sdk:ready` remains within the five-minute CI backstop; tarball/install size changes are recorded.
    - Code Quality: focused suites, full typecheck/build/offline tests, dry-run packing, Node 20 compatibility, fresh packed install, docs checks, and package graph validation pass with no source-text-only substitute for behavioral regressions.
    - Security: dependency audit/tree, secret scan, tarball deny list, checksum/provenance dry run, PostgreSQL live migration suite, and opt-in keychain gate pass where infrastructure exists; no release blocker is waived to preserve version/date.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, `docs/migration.md`, `docs/index.md`, all pages changed by prior tasks, package manifests/changelogs, `.github/workflows/release.yml`, and `scripts/release.mjs`.
      - Phase 1 Release Validation Checklist in `roadmap.md`.
    - Options Considered:
      - Publish immediately after focused tests: misses cross-package/type/package regressions; rejected.
      - Add a new release framework: unnecessary; rejected.
      - Reuse `sdk:ready`, existing release scripts, Node 20 job, PostgreSQL/keychain gates, and packed-install checks: chosen.
    - Chosen Approach:
      - Update docs/API examples first, then bump all 30 package manifests/internal ranges and lockfile together to 0.0.6 using existing release tooling conventions.
      - Run focused tests after each task, then one final complete release-candidate matrix; do not create/tag/publish without explicit operator authorization.
      - Append measured evidence to this plan and only then update the Phase 1 checkbox in `roadmap.md`.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
      npm run release:check -- --version 0.0.6 --allow-untagged
      npm run release:publish -- --version 0.0.6 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - `docs/index.md`, `docs/migration.md`, `docs/release-and-install.md`, and every docs page assigned above.
      - Root/package `README.md` and `CHANGELOG.md` files affected above.
      - Root and all workspace `package.json` files plus `package-lock.json` for exact 0.0.6 graph.
      - Existing release/package/docs tests and workflows only where changed behavior requires their contract lists.
      - `roadmap.md`: mark Phase 1 complete and append concise verified evidence only after all checks pass.
      - `plans/068-release-0-0-6-production-blockers.md`: mark tasks complete and record actual compromises/further actions.
    - References:
      - Existing `npm run sdk:ready`, `release:check`, `release:publish --dry-run`, packaging/install smoke, Node 20 compatibility, and PostgreSQL integration jobs documented in `docs/release-and-install.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md` API page structure.
  - Test Cases to Write:
    - Focused package suites for workflows, coding-agent/security, credentials-node, MCP, both compaction packages, supervisor, both persistence adapters, JSON Schema validator, memory, and core IDs.
    - Full offline gate: `npm run sdk:ready`, `npm audit`, `npm ls --all`, `git diff --check`.
    - Compatibility/package gate: Node 20 public imports, all 30 dry-run packs, fresh offline packed install, public export/type checks, 0.0.6 version/range graph.
    - Live gate: fresh and upgraded PostgreSQL schemas; OS keychain timeout/round-trip where available; no provider credentials are required for these Phase 1 fixes unless a changed compaction live test is explicitly configured.
    - Negative release fixtures: stale 0.0.5 range, migration drift, leaked secret, shipped test/source/map, or unexplained skipped test fails the gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this task integrates every Phase 1 behavior and release migration into public navigation/release artifacts.
    - Docs pages to create/edit:
      - `docs/index.md`: update Workflow, Tools, Compaction/session memory, Security/auth/trust, MCP, A2A, Persistence, Credentials, Memory, and Release entries.
      - `docs/migration.md`: consolidated 0.0.5→0.0.6 migration.
      - `docs/release-and-install.md`: 0.0.6 package graph, commands, gates, and operator handoff.
      - All task-assigned API pages: verify required wiki section structure and examples.
    - `docs/index.md` update: yes; all changed public surfaces must remain discoverable with functional descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Version/documentation graph:
      - Bumped core and all 29 workspace manifests, every first-party internal dependency/peer range, lockfile workspace records, runtime `version`, MCP client/server metadata, version-sensitive tests, generated-init fixtures, tarball expectations, and all 30 changelogs to exact `0.0.6`. Core `bin.prism` uses npm's valid `dist/cli.js` form; final publish dry-run no longer reports an invalid-bin correction.
      - Updated `docs/release-and-install.md` for the `0.0.6` graph, operator handoff, current RC matrix, and exact package commands; updated `docs/migration.md` with artifact-loop bounded tool migration and `docs/index.md` discovery text. Every package changelog now has a finalized `0.0.6` entry; package READMEs require no version-specific API rewrite.
      - `roadmap.md` marks Phase 1 complete only after this evidence. No commit, tag, or package publication was created.
    - Release-candidate matrix:
      - Node 24 `npm run sdk:ready` passed: 1,767 tests, 1,742 pass, 25 explicit live skips, 0 fail; full typecheck/build/docs/export/install-smoke matrix and all 30 dry-run packs passed. Core pack: 230 files, 445.5 kB packed, 1.6 MB unpacked.
      - Docker Node 20.20.2 built all workspaces and imported every public root export target. Fresh `pgvector/pgvector:pg16` passed 17 PostgreSQL session-store and 14 memory/pgvector integration checks with no skip/failure.
      - Offline packed-consumer smoke, tarball deny-list/secret checks, `npm audit --audit-level=high` (0 vulnerabilities), `npm ls --all --depth=0`, `git diff --check`, `release:check --version 0.0.6 --allow-dirty --allow-untagged` (30 available), and dependency-ordered `release:publish --dry-run` (30/30) passed.
      - `PRISM_TEST_KEYCHAIN=1` did not pass because this host has no usable system-keychain backend: native read returned `undefined` after write, matching the documented upstream read-failure ambiguity. This is not waived; a release operator must rerun the explicit round-trip against a working keychain before tagging/publishing. Provider and external A2A live tests likewise remain credential/endpoint-gated and were not configured.

## Compromises Made

- Task 2 intentionally breaks pre-0.0.6 workflow definitions and checkpoint hashes by requiring explicit revision. No automatic hash rewrite is shipped because it would bless behavior that Prism cannot prove equivalent; hosts must finish old runs or perform a reviewed evidence migration.
- Exact active-run deduplication is process-local. Multi-process coordinators still rely on durable lease/fencing primitives; the same-process takeover test waits for the stale local registry entry to unwind before simulating the replacement process.
- Function bodies, closures, and tool implementation identity remain outside automatic hashing. Host-authored revision is the stable minimum; function-source hashing was rejected as unstable and incomplete.
- Task 3 bounded text pages do not scan the rest of a large file merely to calculate exact total lines; continuation metadata marks totals unknown until EOF. Hosts needing an exact count must page to EOF or use a separate approved index/command.
- Custom coding operation backends remain host code. Prism validates returned page size and supplies finite caps/signals, but cannot prevent an opaque remote backend from allocating excessively or ignoring abort before it returns.
- Shell spill writes are synchronous to provide zero-queue disk backpressure and O(display-cap) heap. Replace with a bounded asynchronous writer only if measured shell throughput shows event-loop impact; never restore an unbounded stream queue.
- Successful truncated shell output is retained for host consumption rather than auto-deleted. The host owns deletion of the explicitly published `metadata.fullOutputPath`; every unsuccessful path removes unpublished spill state.
- Task 4 reuses installed keyring `AsyncEntry` instead of adding the planned Worker file. Its N-API task isolates native work and accepts abort, but an OS backend that ignores cancellation may retain one libuv worker after the JavaScript timeout rejects. Add child-process isolation only if live telemetry shows repeated hangs or worker-pool exhaustion.
- `@napi-rs/keyring@1.3.0` converts per-entry read failures to `undefined` inside its native `get_secret().ok()` implementation, so a locked/unavailable read can remain indistinguishable from a missing entry even though constructor/write/delete/timeout errors stay typed. Do not replace this with unbounded service-wide credential enumeration; upgrade when upstream exposes a result-preserving read API.
- JavaScript passphrases and credential objects are immutable/host-owned and cannot be reliably zeroed. Prism zeroes derived keys and package-owned Buffer/Uint8Array storage, sanitizes errors, and documents host lifecycle responsibility.
- Canonical version-1 envelopes using documented parameters remain compatible; oversized, permissive-mode, malformed, or formerly accepted custom KDF files fail closed with no automatic rewrite or chmod.
- Task 5 deliberately bypasses SDK `listTools()`/`callTool()` output-schema compilation and validation by using raw validated protocol requests. This removes untrusted Ajv compile/cache growth; hosts needing semantic output validation must apply their own bounded trusted-schema validator after the bridge result boundary.
- Secure MCP HTTP pins the first validated public DNS answer and does not retry alternate addresses. Add bounded public-address retry only if staging availability data requires it; never re-resolve between validation and connect.
- The 16 MiB HTTP response default applies to each SSE response, so a valid stream exceeding it fails/reconnects rather than growing forever; hosts may raise it only to the 64 MiB hard cap. Stdio remains a host-selected local process whose SDK framing parses a message before bridge-level schema/result checks, so sandbox and bound untrusted subprocesses outside Prism.
- A host-supplied MCP `resolveHostname` may continue its own ignored work after abort, but no request proceeds after the race rejects. Prism validates every returned answer and owns no general egress proxy; production hosts should retain firewall/proxy policy as defense in depth.
- LLM compaction still uses the documented chars/4 token estimate rather than adding a tokenizer. It now makes that approximation finite and surrogate-safe; add a provider-specific tokenizer only if measured summary quality requires tighter budgeting, never to relax the hard retention cap.
- A custom provider has already allocated each emitted delta/error before Prism receives it. Task 6 bounds retained/copy-forward data and event count, while first-party wire adapters retain their own SSE event limits; hosts must place equivalent bounds inside opaque custom providers.
- The observational-memory JSON walk uses fixed depth 64 instead of another public option. Host worker tools can cause side effects before returning a result that Prism then rejects as oversized/non-JSON; keep these tools narrow/idempotent because result validation cannot roll back external work.
- A worker call emitted on the final allowed turn executes and may record memory, but its tool-result message is not sent in another provider request. This preserves prior `maxTurns` behavior and avoids inventing an extra turn outside the configured budget.
- A2A's parser uses 4 KiB line-fragment coalescing and rejects every frame after terminal completion, including comment/empty frames. Change either only with interoperability evidence; accepting post-terminal keepalives would weaken deterministic terminal enforcement.
- Migration checksums intentionally derive from the shared canonical schema migration model, not byte-identical SQLite/PostgreSQL SQL strings; both dialects then independently verify full live catalog shape. Adding a schema migration must update that canonical step content and both DDLs in the same review, or checksum/history verification correctly changes.
- Schema readiness verifies required v3 artifacts and exact expected column sets for contract tables but permits unrelated host/package tables (for example generic checkpoints/leases). It does not parse index predicates, FK actions, collations, generated expressions, or arbitrary check expressions because v3 has no shared expectation for them; add normalized contract fields only when Prism declares such behavior portable.
- PostgreSQL metadata runs as three fixed catalog queries and accepts only driver-decoded or canonical identifier-array output. Current pg emits either; a custom `Pool` wrapper that changes catalog row shapes fails closed rather than guessing.
- JSON Schema cache identity intentionally remains bounded `JSON.stringify(schema)` rather than canonical semantic normalization. Different property orders may compile separately until LRU eviction; canonicalization would add more traversal/code and cannot make arbitrary JSON Schema semantics equivalent. Hosts with trusted static schemas can reuse the same object/order.
- Finite-vector validation happens at Prism's embedder/store/pgvector boundaries, but it cannot prevent an opaque host embedder from allocating before returning an invalid vector. Hosts still need provider-side response/time limits; Prism rejects the value before scoring, persistence, or SQL.
- Generated IDs change implementation but remain opaque strings. UUID formatting is intentionally not a public validation contract; host-supplied IDs/authorization semantics stay host responsibility.
- Bounded artifact tools are sequential even when `toolConcurrency` is higher. This is intentional first-increment behavior for deterministic transcript/tool side-effect ordering; add bounded parallel dispatch only with a demonstrated read-only workload and explicit event-order contract.
- `tool_round_limit` uses existing `artifact_failed` metadata rather than a new event/result API. Hosts that require a typed terminal run result should subscribe to redacted events or provide a custom loop; do not widen `AgentRunResult` for one loop strategy.
- This RC host has no usable system-keychain backend: `PRISM_TEST_KEYCHAIN=1` writes but native read returns `undefined`. The package remains fail-closed/typed in default coverage; release operators must run the explicit live round-trip on a working backend rather than treating this host result as a pass.

## Further Actions

- Before publication, run `PRISM_TEST_KEYCHAIN=1 npm test --workspace @arnilo/prism-credentials-node` on the tagged release host with a working OS keychain; configure provider/A2A live smokes only when their credentials/endpoints are available.
- Create a clean signed `v0.0.6` tag after protected-branch CI, then use the documented resume-capable provenance workflow. Do not publish from this dirty working tree.
- Add a pre-0.0.6 checkpoint rewrite utility only if a real host cannot drain old workflow runs; require explicit old/new hash evidence and dry-run output rather than an automatic compatibility bypass.
