# Prism 0.0.6+ Roadmap

Updated: 2026-07-19

## Objectives

- Make Prism safe for multi-tenant production use before expanding its feature surface.
- Close confirmed security, correctness, resource-exhaustion, persistence, and protocol defects at their shared boundaries.
- Reach competitive SDK parity for guardrails, durable agent interruption, run budgets, telemetry, evaluations, and interoperability.
- Add focused personal-agent, coding-agent, work-agent, and enterprise-agent capabilities as optional packages over existing Prism primitives.
- Add bounded web research, interactive browser automation, and OfficeCLI-powered Word/Excel/PowerPoint work with Outlook/Gmail and cloud-workspace connectors.
- Preserve Prism as a lightweight host-owned harness: core stays dependency-free at runtime, integrations stay optional, and no second agent/workflow/runtime abstraction is introduced.
- Reduce package, test, documentation, and implementation complexity before a 1.0 commitment.

## Expected Outcome

- 0.0.6 removes current release blockers, including cross-tenant workflow cancellation and unbounded coding/MCP/credential paths.
- 0.0.7 provides secure run lifecycle primitives: typed guardrails, universal limits, durable interruption/resume, and a secure composition helper.
- 0.0.8 standardizes production telemetry/evaluations, completes bounded MCP/A2A interoperability, and adds Exa/Brave search plus Firecrawl-backed fetch/extraction tools.
- 0.0.9 makes coding, Playwright browser automation, and OfficeCLI document work safe inside one disposable execution boundary.
- 0.0.10 adds enterprise identity, policy, audit, provider governance, deployment seams, and least-privilege Microsoft 365/Google Workspace connectors for Outlook, Gmail, calendars, files, and tasks.
- 0.0.11 adds durable personal/work-agent conversations, AG-UI, and human co-work review for browser and Office artifacts, with broader channels and device capabilities remaining opt-in.
- 0.0.12 closes provider, memory, and RAG ecosystem gaps.
- 0.0.13 consolidates packages/code/docs and establishes measurable 1.0 readiness gates.
- Demand-gated 0.1.x work may add product/control-plane features without moving them into core.

## Baseline

- 30 publishable packages: core plus 29 workspaces; 24 code packages and 6 manifest/profile packages.
- 189 production TypeScript files / 26,280 lines; 28,983 test lines; 42,074 docs and plan lines.
- `npm run sdk:ready`: 1,785 tests, 1,760 pass, 25 explicit live skips, 0 fail; all builds and 30 dry-run packs pass within the five-minute CI backstop on the 2026-07-19 release-candidate environment.
- Root package: 466.5 kB packed / 1.7 MB unpacked (241 files). Workspace install baseline: 73 MB.
- `npm audit`: zero known vulnerabilities across 223 installed dependencies. This is not a substitute for SAST, secret scanning, SBOM, or live integration testing.
- Live provider, PostgreSQL, keychain, and external A2A tests require configured services/credentials and are not part of this baseline unless a release gate explicitly provisions them.

## Product Boundaries

- **Harness, not application framework:** hosts own product UI, auth, deployment, provider selection, credentials, storage, and business policy.
- **One runtime:** agent interruption, approvals, schedules, replay, and persistence extend existing sessions, checkpoints, leases, and workflows; no parallel durable engine.
- **Core stays dependency-free:** library/protocol/provider dependencies belong in optional packages.
- **Explicit activation:** no provider, credential store, memory worker, server, connector, sandbox, telemetry exporter, schedule, or remote agent starts by import or discovery.
- **Secure trust boundaries:** ownership, validation, permission, redaction, abort, and finite resource limits are mandatory where untrusted or remote data enters.
- **One reference adapter first:** add adapter families only from measured demand. Direct Anthropic/Google and enterprise-cloud providers are exceptions because their identity and protocol semantics are materially distinct.
- **No adapter zoo:** one `@arnilo/prism-web-tools` package covers host-selected Exa, Brave, and Firecrawl roles; one `@arnilo/prism-work-tools` package exposes OfficeCLI, Microsoft 365, and Google Workspace subpaths until dependency/adoption evidence requires a split; one Playwright reference implementation precedes remote-browser vendors.
- **Cheapest safe web path:** search API → bounded fetch/extraction → browser automation; browser use is reserved for interactive, authenticated, or JavaScript-heavy workflows.
- **Artifacts are not SaaS connectors:** OfficeCLI edits local `.docx`/`.xlsx`/`.pptx` artifacts; Microsoft 365 and Google Workspace adapters own mail, calendar, cloud-file, and task APIs. Neither impersonates the other.
- **Host-controlled executables:** Prism never silently installs, updates, discovers, or executes arbitrary OfficeCLI/M365/GWS commands; hosts pin binaries/versions, paths, identities, roots, and allowed operations.
- **No speculative product layer:** Studio, hosted cloud, managed observability, broad channel catalogs, desktop OS control, and visual workflow builders remain demand-gated 0.1.x work.

## Release Order and Gates

1. Releases execute in order. A release does not start while an earlier P0/P1 acceptance criterion is open.
2. 0.0.6 is mandatory before any multi-tenant production recommendation.
3. 0.0.7 primitives precede coding, personal, and enterprise feature packages so those packages reuse one guardrail/limit/interruption model.
4. 0.0.8 telemetry and trace-evaluation contracts precede persona-specific autonomous execution; web providers must pass bounded transport, citation, credential-redaction, cost, and hostile-content tests.
5. 0.0.9 coding, browser, and OfficeCLI execution must pass adversarial filesystem/network/process/resource tests before background, interactive-browser, or document-generation workflows are advertised.
6. 0.0.10 enterprise providers and Microsoft 365/Google Workspace connectors must use authenticated identity, least-privilege scopes, idempotent side-effect patterns, and host-owned credentials.
7. 0.0.11 channel/device/co-work features remain optional and cannot broaden user consent, memory, network, file, Office-document, browser, or tool permissions.
8. 0.0.12 adds provider/vector/document adapters only after conformance and adoption review.
9. 0.0.13 may delete or consolidate surfaces; compatibility decisions and migration notes are required before 1.0.
10. Every release requires `npm run sdk:ready`, Node 20/current compatibility, packed-install checks, dependency audit, relevant live suites, secret scan, tarball review, and `git diff --check`.

## Phase Planning Workflow

1. This roadmap is the source backlog and release boundary; roadmap edits do not create separate execution plans.
2. Before implementation begins, create one numbered plan for the next authorized phase, carrying that phase's objectives, acceptance criteria, approach, tests, documentation work, and release gate into executable tasks.
3. Execute and record evidence in that phase plan, then mark the roadmap phase complete only after its checks pass.
4. Do not create cross-phase roadmap-rewrite or feature-summary plans; later phases remain only in this roadmap until they become the next implementation target.

## Tasks

- [x] Phase 1 — Release 0.0.6: close production release blockers
  - Acceptance Criteria:
    - Functional: active workflow cancellation validates exact ownership before aborting and cannot collide or overwrite across tenants; all workflow options use validated finite hard caps and durable definitions include an explicit revision/fingerprint.
    - Functional: coding reads stream within input limits; shell execution has default/hard wall-time and total-output limits; spill files use restrictive permissions and have cleanup behavior; write/edit reject oversized input and target files before allocation.
    - Functional: credential envelopes reject oversized files/base64/KDF parameters before expensive work, encrypted stores enforce restrictive Unix modes, scrypt is asynchronous, and keychain timeout behavior is truthful and enforceable.
    - Functional: MCP discovery detects repeated cursors and bounds pages/tools/schema/description/result bytes; HTTP transport is HTTPS-by-default with explicit loopback development escape hatch and exact-origin/redirect/egress controls.
    - Functional: LLM compaction and observational-memory workers bound generated output/tool calls and redact failures; A2A uses one streaming UTF-8 decoder and supports CRLF SSE; SQLite/PostgreSQL verify migration name/version/checksum and full schema shape.
    - Functional: security-sensitive IDs use `crypto.randomUUID()`/`randomBytes`; JSON-schema validator options, schema sizes, instance limits, and compile cache are finite; memory rejects non-finite vectors.
    - Performance: no public byte/time/concurrency option accepts `Infinity`, NaN, unsafe integers, or values above hard caps; large-file, infinite-output, endless-cursor, hostile-KDF, and unbounded-provider tests remain bounded in time, memory, and disk.
    - Code Quality: fixes live in shared active-run, coding I/O, credential envelope, MCP, workflow-limit, provider-output, SSE, migration, validation, and vector boundaries rather than caller-specific guards.
    - Security: reproduced attacker-owned cancellation returns not-found/forbidden without affecting the victim; network and file operations fail closed; secrets never appear in worker/protocol errors or temporary files.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/credential-storage.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/host-security.md`, database persistence and migration pages.
      - MCP security best practices: <https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices>.
      - Node.js `crypto`, `fs`, streams, `TextDecoder`, `AbortSignal`, HTTP/TLS, DNS, and scrypt APIs for supported Node versions.
    - Options Considered:
      - Patch only demonstrated callers: smaller immediate diffs but leaves sibling paths vulnerable; rejected.
      - Replace existing subsystems: high risk and duplicates working primitives; rejected.
      - Harden shared boundaries and add one adversarial regression per defect: chosen.
    - Chosen Approach:
      - Add ownership to active-run records/keys and reject duplicate registration; authorize before abort.
      - Stream and cap coding I/O, use restrictive temp files, and retain shell as a bounded escape hatch.
      - Validate cheap envelope/network/protocol metadata before decoding, resolving, allocating, or invoking expensive operations.
      - Add explicit workflow revision instead of hashing `Function.toString()`.
    - API Notes and Examples:
      ```ts
      defineWorkflow({ id: "publish", revision: "2026-07-19.1", nodes });

      createShellTool(cwd, {
        timeout: 600,
        maxTotalOutputBytes: 64 * 1024 * 1024,
      });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/active-runs.ts`, `status.ts`, `run.ts`, `define.ts`, `limits.ts`, `util.ts`, `types.ts`, tests.
      - `packages/coding-agent/src/read.ts`, `shell.ts`, `output-accumulator.ts`, `write.ts`, `edit.ts`, tests.
      - `packages/credentials-node/src/envelope.ts`, `encrypted-store.ts`, `file-io.ts`, `keychain-store.ts`, tests.
      - `packages/mcp/src/bridge.ts`, `transport.ts`, related types/tests.
      - `packages/compaction-llm/src/strategy.ts`, observational-memory worker/runtime utilities and tests.
      - `packages/supervisor/src/a2a-client.ts` and tests.
      - SQLite/PostgreSQL migration/schema/conformance files.
      - JSON-schema validator, memory/vector, and ID-generation callers/tests.
    - References:
      - Confirmed current-build exploit: attacker ownership canceled an active victim run with `wasActive: true` and victim received `ERR_PRISM_WORKFLOW_ABORTED`.
      - 2026-07-19 full-package performance/security/code-quality audit.
  - Test Cases to Write:
    - Two-tenant same workflow/run ID start/cancel/duplicate-registration race.
    - Multi-gigabyte sparse read, infinite shell output, timeout, abort, disk cap, restrictive spill mode, cleanup, and oversized write/edit.
    - Oversized vault/KDF/base64, insecure permissions, event-loop responsiveness, keychain worker timeout.
    - Endless/repeated MCP cursor, aggregate schema/result overflow, private/redirected HTTP endpoint, allowed loopback development endpoint.
    - Infinite provider output/tool-call list, redacted OM error, split UTF-8/CRLF A2A stream, migration drift/checksum mismatch, non-finite vector, validator hard-cap rejection.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; ownership, limits, workflow revision, coding tools, credential opening, MCP transport, migrations, and protocol behavior change.
    - Docs pages to create/edit:
      - `docs/workflows.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/credential-storage.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/host-security.md`, persistence/migration pages, `docs/migration.md`.
    - `docs/index.md` update: yes; update Workflow, Tools, Security/auth/trust, MCP, A2A, and Persistence entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Plan 068 completed all Phase 1 shared-boundary fixes, documentation, and 30-package `0.0.6` version graph.
    - `npm run sdk:ready` passed with 1,767 tests (1,742 pass, 25 explicit live skips, 0 fail); Node 20 build/public-import, packed offline consumer, PostgreSQL/pgvector (31 checks), audit, dependency graph, registry preflight, and 30-package provenance dry-run passed.
    - No commit, tag, or publication was created. Release host still must provide a working OS keychain for the explicit `PRISM_TEST_KEYCHAIN=1` round-trip before publication.

- [x] Phase 2 — Release 0.0.7: secure run lifecycle, guardrails, budgets, and durable interruption
  - Acceptance Criteria:
    - Functional: typed input, output, tool-input, and tool-output guardrails run in documented order, support tripwires, produce redacted attributable decisions, and cannot be bypassed by retries, revisions, delegation, MCP, or workflows.
    - Functional: shared `RunLimits` bounds turns, provider attempts, tool rounds/calls, wall time, request/response bytes, input/output/total tokens, and optional cost; terminal results/events identify the breached limit.
    - Functional: ordinary agent runs can serialize, suspend for approval/input, survive restart, and resume exactly once through existing checkpoint/CAS/fencing primitives; workflows remain the deterministic graph layer rather than a second run engine.
    - Functional: `createSecureAgent()` or equivalent composition helper wires required tool schemas, JSON-schema validation, finite limits, deny-by-default permission/trust policies, redaction, ownership, and approval defaults while low-level `createAgent()` remains explicit and backward-compatible.
    - Performance: limits are O(1) to update per event/attempt; serialized state is versioned and byte-bounded; suspension consumes no worker or polling slot.
    - Code Quality: supervisor budgets, workflow suspension, tool policy, provider accounting, and checkpoint contracts are reused instead of copied; guardrail stages are typed primitives, not middleware naming conventions.
    - Security: persisted run state excludes resolved credentials and raw secrets, resume reauthorizes current identity/policy, and guardrail/policy errors fail closed without exposing blocked content.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/workflows.md`, `docs/coding-security.md`, `docs/runs-and-usage.md`, `docs/host-security.md`.
      - OpenAI Agents guardrails and human-in-the-loop: <https://openai.github.io/openai-agents-js/guides/guardrails/> and <https://openai.github.io/openai-agents-js/guides/human-in-the-loop/>.
      - LangGraph persistence: <https://docs.langchain.com/oss/javascript/langgraph/persistence>.
    - Options Considered:
      - Document generic middleware recipes: no enforceable ordering/tripwire contract; rejected.
      - Add a new durable-agent service: duplicates sessions/workflows/checkpoints; rejected.
      - Add typed stages and resumable run state over current runtime/checkpoint primitives: chosen.
    - Chosen Approach:
      - Introduce the minimum `Guardrail`, `RunLimits`, `AgentRunState`, `interrupt()`, and `resumeRun()` contracts.
      - Reuse current ledgers, usage, checkpoints, ownership, redaction, policy, and workflow resume CAS.
      - Provide secure composition as an opt-in helper/profile, not a mandatory global container.
    - API Notes and Examples:
      ```ts
      const agent = createSecureAgent({
        provider,
        model,
        tools,
        limits: { maxTurns: 16, maxToolCalls: 32, maxTotalTokens: 50_000 },
        guardrails: { input: [piiGuard], toolInput: [commandGuard] },
      });

      const resumed = await resumeAgentRun(checkpoint, { approved: true }, {
        ownership,
        expectedVersion,
      });
      ```
    - Files to Create/Edit:
      - Core contracts/runtime/agent-loop/tool-dispatch/checkpoint/testing exports and tests.
      - Workflow suspension and supervisor budget helpers where primitives are generalized.
      - Server/MCP commands for authorized run status/resume only after primitive completion.
      - Secure composition examples and docs.
    - References:
      - Existing `CheckpointStore`, `LeaseStore`, workflow suspend/resume, execution policies, redactor, usage records, and supervisor budgets.
  - Test Cases to Write:
    - Guardrail ordering, parallel guardrail failure, tripwire cancellation, retry/revision/tool/delegation coverage, redaction, and malformed result.
    - Every run-limit boundary, combined token/cost accounting, timeout/abort race, and one terminal limit event.
    - Suspend/restart/authorized resume, duplicate/stale/wrong-owner resume, changed policy, changed definition, secret-free serialized state.
    - Secure helper default-deny behavior and low-level backward compatibility.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new core guardrail, limit, run-state, interruption, resume, and secure-composition APIs.
    - Docs pages to create/edit:
      - `docs/guardrails.md`, `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/runs-and-usage.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/server.md`, `docs/mcp-tools.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; add Guardrails and update Agent/session runtime and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-19):
    - Plan 069 completed typed guardrails, O(1) RunLimits accounting, bounded/redacted durable built-in agent runs with CAS resume, opt-in `createSecureAgent()`, and explicitly selected server/MCP lifecycle exposure. No default route/tool, credential persistence, or ambiguous tool replay was added.
    - Versioned all 30 publishable manifests, exact internal ranges, lockfile records, runtime metadata, release/package tests, and changelogs to `0.0.7`; added network-free durable-approval example and complete migration/release guidance.
    - `npm run sdk:ready` passed: 1,785 tests (1,760 pass, 25 explicit live skips, 0 fail), typecheck, offline packed consumer, docs/export/secret/tarball guards, and 30 dry-run packs. Core artifact: 241 files, 466.5 kB packed, 1.7 MB unpacked.
    - Docker Node 20.20.2 build/public-import, `npm audit --audit-level=high` (0 vulnerabilities), `npm ls --all --depth=0`, exact 30-package registry preflight, and 30/30 provenance/public/latest publish dry-run passed. No commit, tag, or publication was created. PostgreSQL/provider/keychain live gates remain explicit release-host/CI prerequisites.

- [ ] Phase 3 — Release 0.0.8: production telemetry, evaluations, protocols, and web research
  - Acceptance Criteria:
    - Functional: OpenTelemetry spans form real agent → provider/tool/guardrail/delegation hierarchies, propagate context, and use applicable GenAI/MCP semantic conventions without placing prompts, IDs, comments, or secrets in metric labels.
    - Functional: evaluations grade final results and complete traces, support deterministic/function and optional model judges, pairwise comparison, datasets, regression thresholds, and CI release gates.
    - Functional: MCP supports bounded tools, resources, prompts, roots, sampling, elicitation, notifications, Streamable HTTP sessions, and host-owned OAuth/auth integration where supported by the pinned SDK; unsupported capabilities fail explicitly.
    - Functional: A2A adds durable task status/cancel, richer file/data/artifact parts, reconnect/replay, and optional push notification hooks while retaining explicit authorization, card verification, and transport bounds.
    - Functional: optional `@arnilo/prism-web-tools` exports `web_search`, `web_fetch`, and `web_extract`; hosts wire Brave or Exa for discovery and Firecrawl for Markdown/structured extraction without letting the model select providers or credentials.
    - Functional: normalized search results retain title, canonical URL, snippet/highlights, publication/retrieval time, provider, and citation identity; fetch/extract results are schema-validated, byte-bounded, and marked as untrusted external content.
    - Functional: official Exa/Firecrawl MCP servers may be documented as prototypes through the hardened MCP bridge, but production first-party tools use narrow Prism schemas and direct bounded adapters rather than exposing arbitrary remote capabilities.
    - Functional: CI adds SAST, dependency review, secret scanning, SBOM/license policy, artifact attestation, scheduled dependency updates, and restricted nightly live canaries.
    - Performance: ledger adapters can batch or buffer high-frequency deltas with documented durability semantics; session summaries/history are cached per run; PostgreSQL/provider/MCP/A2A/web load benchmarks publish throughput, p95 latency, memory, disk, cost, and backpressure results; web tools cap queries, results, URLs, redirects, response/Markdown/extraction bytes, concurrency, and wall time.
    - Code Quality: telemetry/eval/protocol/web conformance helpers are reusable; Exa, Brave, and Firecrawl adapters share only bounded transport and normalized public result contracts; no vendor-specific observability exporter or web client enters core.
    - Security: telemetry is metadata-safe, remote protocol sessions bind authorization to exact origin/session/ownership, web API origins and redirects are exact-policy checked, credentials never enter prompts/results, private/internal URLs require explicit host policy, fetched content is prompt-injection-capable untrusted data, live-canary credentials are least-privilege, and CI artifacts contain no secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/observability.md`, `docs/evaluations.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/performance.md`, `docs/release-and-install.md`.
      - OpenTelemetry GenAI conventions: <https://opentelemetry.io/docs/specs/semconv/gen-ai/>.
      - OpenAI Agents tracing: <https://openai.github.io/openai-agents-js/guides/tracing/>.
      - Exa Search and Contents: <https://exa.ai/docs/reference/search> and <https://exa.ai/docs/reference/get-contents>.
      - Firecrawl Search and Scrape: <https://docs.firecrawl.dev/features/search> and <https://docs.firecrawl.dev/features/scrape>.
      - Brave Search API: <https://brave.com/search/api/>.
      - Official Exa and Firecrawl MCP servers for prototype/reference integration; current MCP and A2A specifications at implementation time.
    - Options Considered:
      - Build a Prism observability backend: product scope and vendor duplication; rejected.
      - Write every streamed delta synchronously to durable storage: simplest semantics but poor remote-store throughput; retain as strict mode, add explicit batched mode.
      - Add bounded standards-based contracts and host exporters: chosen.
      - Expose search, fetch, extraction, and browser behavior as one generic mega-tool: coarse permissions and provider leakage; rejected.
      - Add three narrow web tools with host-selected adapters and use browser automation only when fetch/extraction cannot complete the task: chosen.
    - Chosen Approach:
      - Upgrade existing OTel/evals/MCP/supervisor packages in place.
      - Complete a primitive review of `ToolDefinition`, `CredentialResolver`, `ResourceLoader`, provider request policies, bounded body readers, content SSRF controls, redaction, run limits, and MCP before creating web package surface.
      - Implement Exa, Brave, and Firecrawl over native `fetch` and existing bounded transport primitives where possible; add no vendor SDK dependency unless current API behavior cannot be represented safely.
      - Keep provider routing host-owned: Brave for conventional discovery, Exa for semantic/research search, Firecrawl for JavaScript/PDF-aware Markdown or named-schema extraction; search and fetch stay separate to control credits/context.
      - Add optional adapter-level batching with flush/ack/crash semantics rather than weakening the ledger contract silently.
      - Keep live suites separate from deterministic default tests but mandatory in protected scheduled/release environments.
    - API Notes and Examples:
      ```ts
      const ledger = createBatchedRunLedger(store, {
        maxBatchEntries: 128,
        maxDelayMs: 25,
        durability: "flush_on_terminal",
      });

      const webTools = createWebTools({
        search: createBraveSearch({ credentials }),
        fetch: createFirecrawlFetch({ credentials }),
        extractors: { product: productSchema },
      });

      await assertEvaluationThreshold(report, { minimumMean: 0.9, maximumFailures: 0 });
      ```
    - Files to Create/Edit:
      - `packages/observability-opentelemetry`, `packages/evals`, `packages/mcp`, `packages/supervisor` sources/tests/docs.
      - New `packages/web-tools` package with Exa, Brave, and Firecrawl adapter subpaths, normalized contracts, tools, fake-server conformance, README, and pack tests.
      - Core tracing context and ledger adapter seams only where required.
      - Session runtime snapshot caching and persistence benchmark helpers.
      - `.github/workflows/*`, release scripts, dependency/SBOM/security configuration.
    - References:
      - Existing Prism telemetry abstractions, evaluation store, MCP SDK bridge/server, A2A client/server/card, run ledger, and persistence conformance.
  - Test Cases to Write:
    - Trace parenting/context propagation, terminal cleanup, guardrail/delegation spans, low-cardinality metric assertions, exporter failure isolation.
    - Trace grader/tool-selection/approval/handoff scoring, pairwise judge, sampling, timeout, CI threshold failure.
    - MCP capability/session/auth/overflow/SSRF matrix and A2A durable-task/reconnect/rich-part/cancel matrix.
    - Web adapter normalization, credential/redaction, citations, retry/rate-limit/cost metadata, abort, redirects, hostile JSON/HTML, result/schema/aggregate overflow, private URL policy, named extraction schema, and network-free fake-server conformance; restricted live Exa/Brave/Firecrawl smoke tests.
    - Search→fetch routing and prompt-injection fixtures prove external text never gains authority; browser is not invoked for content available through bounded fetch.
    - Ledger crash-before-flush/terminal-flush/order/backpressure tests; cached snapshot query-count test; repeatable PostgreSQL and protocol load scenarios.
    - CI secret/SBOM/license/provenance negative fixtures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; telemetry, evaluations, MCP/A2A, ledger batching, and CI/release behavior change.
    - Docs pages to create/edit:
      - `docs/observability.md`, `docs/evaluations.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/web-tools.md`, `docs/performance.md`, persistence pages, `docs/release-and-install.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes; update Observability, Evaluations, MCP, A2A, Persistence, and Release entries; add Tools → Web search, fetch, and extraction.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 4 — Release 0.0.9: production coding, browser, and Office-work execution
  - Acceptance Criteria:
    - Functional: one reference disposable sandbox enforces read-only base filesystem, explicit writable workspace, network deny-by-default, CPU/memory/process/disk/wall-time limits, secret allow-list, and cooperative/forced termination.
    - Functional: bounded native list/search and structured Git status/diff/commit/branch/worktree operations cover common repository research without routing every operation through a shell.
    - Functional: coding runs support durable plans/todos, checkpoints, diagnostics, hooks, test/lint/security commands, patch rollback, background branch execution, and host-owned PR creation.
    - Functional: optional `@arnilo/prism-browser` provides bounded `browser_open`, `browser_snapshot`, `browser_act`, and `browser_close` tools over Playwright; one isolated `BrowserContext` is owned by a run, stateful actions are exclusive/ordered, and role/label/snapshot references precede CSS selectors.
    - Functional: browser policy distinguishes observation from side effects; authenticated/JavaScript-heavy workflows support navigation, click, type, select, check, scroll, wait, bounded screenshots, approved uploads/downloads, and popups without exposing `page.evaluate`, arbitrary JavaScript, extensions, devtools, or local browser profiles.
    - Functional: optional `@arnilo/prism-work-tools/officecli` wraps a pinned host-supplied iOfficeAI OfficeCLI binary/SDK for `.docx`, `.xlsx`, and `.pptx` create/read/query/edit/batch/merge/validate/render operations; model-facing inspect, mutate, and render tools use argument arrays/objects rather than unrestricted command strings.
    - Functional: Office work follows inspect → DOM edit → validate/issues → screenshot render → multimodal look/fix → save/close; named schemas/help are lazily discovered and bounded; stable element IDs, atomic batches, template merge, and replayable dumps are used where safer than repeated mutations.
    - Functional: edit/write and Office operations remain serialized per real path and gain transactional backup/rollback where a multi-file task requests it; shell remains an explicit escape hatch.
    - Performance: repository walks, searches, diagnostics, output, background jobs, worktrees, browser actions/pages/downloads/screenshots, Office files/schemas/batches/renders/resident sessions, and render-look-fix cycles have finite counts/bytes/time; benchmarks publish p95 repository, browser, document-open/edit/save, and render latency plus memory/disk/process use.
    - Code Quality: reusable coding/browser/Office tools compose through existing tool, permission, execution-policy, run-state, sandbox, file-mutation, resource/image, and event primitives; no bespoke persona runtime, Git shell-string builder, browser planner, Office document model, or one-implementation abstraction is introduced.
    - Security: sandbox containment—not command regexes—enforces filesystem/network/process boundaries; Git and Office operations use argument arrays/typed objects; browser egress denies private/local/file/devtools origins and handles DNS rebinding through an isolated proxy/firewall; OfficeCLI auto-install/auto-update, generic MCP/CLI passthrough, `raw`/`raw-set`, plugins, and `watch` server are denied by default; symlink/TOCTOU, malicious OOXML, prompt-injection, secret, upload/download, and process escape tests fail closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/guardrails.md`, `docs/workflows.md`, `docs/host-security.md`.
      - GitHub coding agent concepts: <https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent>.
      - Playwright BrowserContext and network routing: <https://playwright.dev/docs/browser-contexts> and <https://playwright.dev/docs/network>.
      - iOfficeAI OfficeCLI README, SKILL, runtime schemas, Node SDK, MCP server, security policy, and release artifacts pinned from tested release/commit; current research snapshot: <https://github.com/iOfficeAI/OfficeCLI/tree/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1>.
      - OfficeCLI agent workflow, schemas, resident/batch editing, rendering, stable paths, marks, and raw XML boundaries: <https://github.com/iOfficeAI/OfficeCLI/blob/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1/SKILL.md#L26-L63>, <https://github.com/iOfficeAI/OfficeCLI/blob/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1/SKILL.md#L92-L194>, <https://github.com/iOfficeAI/OfficeCLI/blob/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1/README.md#L251-L339>, and <https://github.com/iOfficeAI/OfficeCLI/blob/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1/schemas/README.md#L1-L22>.
      - OfficeCLI Node SDK lifecycle/`autoInstall: false`, unbounded reply-read caveat, and generic MCP command surface: <https://github.com/iOfficeAI/OfficeCLI/blob/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1/sdk/node/README.md#L45-L86>, <https://github.com/iOfficeAI/OfficeCLI/blob/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1/sdk/node/index.d.ts#L25-L38>, <https://github.com/iOfficeAI/OfficeCLI/blob/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1/src/officecli/McpServer.cs#L204-L222>, and <https://github.com/iOfficeAI/OfficeCLI/blob/b72c44ecbe6e76a1279cd3c0d27455c225a96dd1/src/officecli/McpServer.cs#L535-L563>.
      - OCI/Docker or selected remote-sandbox API documentation at implementation time.
    - Options Considered:
      - Expand regex command deny lists: cannot provide containment; rejected.
      - Add separate tools for every Unix command: adapter bloat; rejected.
      - Expose Playwright `page` or OfficeCLI's built-in single generic MCP command directly: maximum flexibility but coarse permissions and easy bypass of path/action policy; rejected for production defaults.
      - Reimplement OOXML or browser automation in Prism: duplicates mature engines; rejected.
      - Ship one real sandbox plus small bounded repository/Git, Playwright, and typed OfficeCLI tool sets: chosen.
    - Chosen Approach:
      - Perform a dedicated primitive review of shell/read/write/edit, `ToolDefinition`, permission/execution policy, file queue, `ResourceLoader`, image content, event progress, run state, MCP, and sandbox capabilities before adding coding/browser/work package surface; generalize only primitives reused by at least two domains.
      - Prefer Node filesystem/process APIs and `execFile` argument arrays; use shell only for host-approved arbitrary commands.
      - Use Playwright as an optional peer/host-created browser or remote endpoint so browser binaries never enter core or aggregate packages; block service workers when routing must observe all requests and run behind real egress containment.
      - Prefer OfficeCLI's typed Node resident SDK for hot paths only when an external sandbox watchdog can terminate a blocked reply; otherwise use bounded one-shot process execution. Set absolute `binary`, `autoInstall: false`, `autoUpdate=false` in an isolated HOME/config, finite flush/idle policy, and close/kill cleanup on terminal/abort.
      - Generate/validate Prism operation schemas from pinned OfficeCLI `help <format> <verb> <element> --json` capability output; expose L1 inspection and L2 DOM operations, with L3 raw XML requiring a separate explicit host capability if ever enabled.
      - Keep OfficeCLI marks/static HTML/PNG as artifact/review primitives; do not expose its unauthenticated local `watch` server from Prism. Keep GitHub/GitLab API integration host-owned until measured demand justifies an optional package.
    - API Notes and Examples:
      ```ts
      const tools = [
        ...createCodingTools(workspace, {
          sandbox,
          executionPolicy,
          limits: { maxSearchResults: 1_000, maxFileBytes: 8 * 1024 * 1024 },
        }),
        ...createBrowserTools({ browser, sandbox, networkPolicy, approval }),
        ...createOfficeTools({
          binary: "/opt/officecli/officecli",
          sandbox,
          roots: [workspace],
          autoInstall: false,
        }),
      ];
      ```
    - Files to Create/Edit:
      - `packages/coding-agent` repository/search/Git/plan/rollback tools, types, tests, README.
      - `packages/coding-security` sandbox implementation/adapters, policy integration, tests, README.
      - New `packages/browser` Playwright adapter/tools, session/context lifecycle, egress/download/upload policy, tests, README, and pack checks.
      - New `packages/work-tools` OfficeCLI subpath with executable/SDK adapter, schema/version compatibility, inspect/edit/render tools, document-session cleanup, artifact metadata, tests, README, and pack checks.
      - Optional new sandbox package only if runtime dependencies or platform separation require it after primitive review.
      - Coding/browser/Office examples, skills, evaluation datasets, CI workflows, docs.
    - References:
      - Existing `ExecutionPolicy`, coding approval policy, shell/read/write/edit tools, mutation queue, workflow state/checkpoints, evals, and secure run lifecycle.
  - Test Cases to Write:
    - Sandbox filesystem/network/process/resource escape attempts, fork bomb, disk fill, secret filtering, timeout/kill, cleanup.
    - Symlink loops, ignored/binary/large files, bounded search ordering, abort, Unicode paths, Git argument injection, dirty-worktree protection.
    - Plan/todo restart, hook failures, diagnostics truncation, atomic rollback, concurrent worktrees, canceled background task, PR handoff payload.
    - Browser context/cookie isolation, role/snapshot actions, redirects/DNS rebinding/private origin, service workers, popup/tab/action limits, timeout/abort/cleanup, prompt injection, secret injection, upload roots, download quarantine, high-impact approval, and prohibited evaluate/devtools/local-profile paths against local fixtures.
    - OfficeCLI version/schema mismatch, absent binary with auto-install disabled, malicious/symlinked/oversized artifact, path escape, locked file, resident hang/abort/kill/flush/close, concurrent same-file edits, bounded help/get/query/dump/render, atomic batch rollback, structured business error, auto-update denial, raw/plugin/watch denial, and `.docx`/`.xlsx`/`.pptx` inspect-edit-validate-render-save journeys.
    - Office delivery evaluations check schema validation, issue scan, placeholder scan, screenshots/contact sheets, bounded revise cycles, and byte-identical source on failed atomic edits; restricted pinned-binary matrix runs outside default network-free suite.
    - Curated coding regressions plus optional SWE-bench-compatible external harness; no network in default suite.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; sandbox and coding tool/profile surfaces expand.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/browser-automation.md`, `docs/work-tools.md`, `docs/officecli.md`, `docs/workflows.md`, `docs/evaluations.md`, `docs/host-security.md`, `docs/performance.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Tools and Security entries; add Coding-agent workflow, Browser automation, and Office document work guidance.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 5 — Release 0.0.10: enterprise identity, policy, provider governance, and work connectors
  - Acceptance Criteria:
    - Functional: authenticated `Principal` and `AgentIdentity` contexts support tenant, sponsor/owner, delegated actor, scopes, credential references, issued/expiry times, revocation, and immutable propagation through runs, tools, workflows, MCP, A2A, persistence, and telemetry.
    - Functional: a policy-decision ledger records allow/deny/modify/approval decisions, policy version, actor, target, reason, expiry, and evidence references; hosts can export to append-only/WORM storage without storing unrestricted payloads.
    - Functional: model governance supports allow-lists, provider/region/data-residency policy, routing, fallback, circuit breaking, retries, token/cost budgets, rate limits, and attributable selection diagnostics.
    - Functional: direct Azure OpenAI/Foundry, AWS Bedrock, and Google Vertex enterprise adapters use host workload identity/credential callbacks and preserve region/private-endpoint semantics; direct Anthropic/Google model protocol work may land here or in 0.0.12 but cannot block enterprise-cloud identity support.
    - Functional: server exposes health/readiness, host auth/rate-limit adapters, graceful drain, event replay, and worker/coordinator deployment contracts; queue adapters are added only when PostgreSQL polling/load measurements justify them.
    - Functional: `@arnilo/prism-work-tools/microsoft365` and `/google-workspace` provide separately activatable, identity-scoped tools for Outlook/Gmail search/read/draft/send, calendars, OneDrive/SharePoint/Drive files, and tasks; Teams/Planner/To Do and Docs/Sheets/Slides cloud operations are capability-gated rather than advertised as universal parity.
    - Functional: connector mutation flows create durable drafts/proposals first and send/share/delete/accept only after attributable approval; persisted operation/draft/resource IDs and provider concurrency tokens prevent retries from duplicating mail, meetings, uploads, shares, or range writes.
    - Functional: CLI for Microsoft 365 and Google Workspace CLI may serve as host-installed execution adapters, but Prism exposes only hard-coded typed operation templates through `execFile` argument arrays; no model-controlled command, generic Graph/Discovery request, login, tenant-admin command, debug output, or credential-store access is available.
    - Functional: retention, deletion, legal-hold/export hooks, optional host KMS/envelope encryption, extension allow-list/signature policy, and tenant-level quotas are available for persisted prompts, memory, checkpoints, feedback, work artifacts, connector operations, and audit records.
    - Performance: policy/identity checks add bounded overhead; routers have bounded attempts; connector pagination/items/body/attachment/file/output/process/time/rate/cost limits are finite; deployment tests cover multi-process ownership/fencing/failover and publish capacity limits.
    - Code Quality: identity, policy, audit, routing, deployment, and work connectors are narrow optional contracts/packages over existing ownership/persistence/provider/server/credential/tool seams; Microsoft and Google common-denominator operations share public result shapes without hiding provider-specific capability differences; no mandatory control plane or global container.
    - Security: identity is authenticated rather than caller-asserted metadata; delegation only narrows scopes; credentials remain late-bound and never enter CLI arguments/model context; per-tool least-privilege OAuth scopes, isolated per-identity CLI config directories, side-effect approvals, external-recipient/share policy, attachment scanning, and provider/audit tenant/residency/retention policy fail closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/host-security.md`, `docs/credential-storage.md`, `docs/server.md`, `docs/workflows.md`, `docs/observability.md`, persistence and provider docs.
      - Microsoft Entra Agent ID governance: <https://learn.microsoft.com/en-us/entra/id-governance/agent-id-governance-overview>.
      - CLI for Microsoft 365 authentication, JSON output, Outlook/OneDrive/SharePoint/Teams/Planner/To Do commands: <https://pnp.github.io/cli-microsoft365/>.
      - Google Workspace CLI dynamic Discovery-based APIs, JSON/NDJSON, `--dry-run`, auth, Gmail/Calendar/Drive/Docs/Sheets/Slides skills: <https://github.com/googleworkspace/cli>.
      - Selected Microsoft Graph, Google Workspace, and cloud provider workload-identity/regional endpoint documentation at implementation time.
    - Options Considered:
      - Build user authentication and identity database into Prism: application/control-plane scope; rejected.
      - Continue using optional ownership strings as identity: insufficient provenance, delegation, expiry, and revocation; rejected.
      - Add verified host-supplied identity/policy contracts and reference adapters: chosen.
      - Give models generic M365/GWS command access: broad tenant/admin authority, schema drift, and command injection risk; rejected.
      - Build direct Microsoft/Google API clients for every workload immediately: large maintenance surface before usage evidence; rejected in favor of narrow host-installed CLI adapters first, with direct APIs promoted where identity/idempotency semantics require them.
    - Chosen Approach:
      - Extend ownership with an authenticated identity context while keeping host verification mandatory.
      - Complete a primitive review of credential resolution, OAuth stores, tool permission/guardrail stages, durable approvals, run identity, command execution, audit, and idempotency storage before expanding `packages/work-tools` connector subpaths.
      - Hosts install, pin, authenticate, and isolate CLI for Microsoft 365 and `gws`; Prism disables interactive login/telemetry/debug, validates versions/capability schemas at startup, emits JSON only, strictly parses one response/NDJSON page stream, and never falls back across identities or plaintext credentials.
      - Expose read-only bundles independently from mutations; separate draft from send, list/read from update/delete/share, and use provider dry-run/ETag/precondition support where available.
      - Keep policy engines, KMS, WORM stores, queues, and cloud auth replaceable; ship at most one reference adapter per seam.
      - Use current provider resolver/request-policy/persistence/lease/server primitives as implementation base.
    - API Notes and Examples:
      ```ts
      const identity = await identityVerifier.verify(request);
      const decision = await policy.evaluate({ identity, action, resource, context });
      const provider = await router.resolve({ model, identity, residency: "eu", maxCostUsd: 0.25 });
      const workTools = createWorkTools({
        microsoft365: createMicrosoft365CliAdapter({ binary: m365, identity }),
        googleWorkspace: createGoogleWorkspaceCliAdapter({ binary: gws, identity }),
        approval,
        idempotencyStore,
      });
      ```
    - Files to Create/Edit:
      - Core identity/policy metadata contracts only where all packages require propagation.
      - Optional enterprise identity/policy/audit/router packages after primitive review.
      - Provider cloud packages, server deployment adapters, persistence retention/encryption/export hooks, tests/docs.
      - `packages/work-tools` Microsoft 365 and Google Workspace subpaths, typed operation/result contracts, read/mutation bundles, command adapters, identity/scope/idempotency/audit integration, fake executables/API fixtures, README, and pack checks.
      - Profile manifests only after size/adoption review.
    - References:
      - Existing ownership scopes, permission/trust/request policies, credential resolver, provider resolver, run ledger/feedback, checkpoints/leases, server authorization, OTel.
  - Test Cases to Write:
    - Expired/revoked/wrong-tenant identity, delegated scope narrowing, policy-version changes, approval attribution, audit immutability/export.
    - Router outage/fallback/circuit/retry/budget/residency/rate-limit matrix and provider diagnostic redaction.
    - Cloud workload identity mocks plus credential-gated live canaries; no static credentials in fixtures.
    - Fake M365/GWS executable tests for argument injection, version/schema drift, mixed/malformed/oversized JSON and NDJSON, debug/telemetry denial, timeout/abort/process kill, pagination, isolated config/identity, least scopes, and absent credential behavior.
    - Outlook/Gmail search/read/draft/approved-send, calendar list/create/update, cloud-file search/read/upload/move/share, task list/create/complete, duplicate retry/idempotency, stale ETag, external recipient/share denial, attachment limits/scanning, and provider capability mismatch; restricted tenant canaries use disposable test resources.
    - Multi-process failover/drain/replay, quota contention, retention/delete/legal hold, encryption key rotation, unsigned extension denial.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; enterprise identity, policy, audit, routing, cloud-provider, server, persistence, and extension surfaces are new or changed.
    - Docs pages to create/edit:
      - `docs/agent-identity.md`, `docs/policy-and-audit.md`, `docs/model-routing.md`, `docs/work-tools.md`, `docs/work-connectors.md`, `docs/host-security.md`, `docs/credential-storage.md`, `docs/server.md`, provider/cloud pages, persistence/retention pages, `docs/migration.md`.
    - `docs/index.md` update: yes; add Identity/governance, Model routing, and Work connectors entries; update Security, Providers, Server, Persistence, Credentials, and Observability.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 6 — Release 0.0.11: personal/work-agent conversations, co-work review, and frontend interoperability
  - Acceptance Criteria:
    - Functional: a durable conversation service creates, lists, continues, branches, archives, exports, and deletes user-scoped threads; clients reconnect and replay bounded ordered events without rerunning completed work.
    - Functional: an AG-UI adapter maps Prism messages, tool calls, approvals, state, errors, and reconnectable events to standard bidirectional frontend events without coupling core to a UI framework.
    - Functional: personal memory exposes consent, source, visibility, correction, retention, deletion, and per-user/profile/thread controls; proactive schedules/events require explicit user enablement and revocable capabilities.
    - Functional: a durable artifact service records source/output Office files, MIME/hash/version, producer run, citations/data sources, validation/issues, render previews, approval state, and final delivery; users can compare revisions, select stable document elements, request changes, approve/reject marked edits, and recover the last validated artifact.
    - Functional: AG-UI maps OfficeCLI static HTML/PNG previews, stable element paths/marks, browser snapshots, connector drafts, approvals, progress, and artifact download links into reconnectable co-work events without exposing OfficeCLI's local watch server or filesystem paths.
    - Functional: OAuth connector flows establish scoped Microsoft 365 and Google Workspace credentials for Outlook/Gmail and related workloads; Slack/Teams chat channels are added only after web/AG-UI demand is measured.
    - Functional: realtime voice and desktop OS/computer-control adapters remain optional, isolated, approval-aware, observable, and disabled by default; delivered Playwright browser tools compose with conversations only through existing sandbox, egress, secret-injection, approval, and run-limit policies.
    - Performance: thread/event pages, replay windows, memory injection, connector payloads, Office artifacts/revisions/previews, browser snapshots/actions, audio, screenshots, and device streams have finite byte/time/rate/version limits and reconnect backpressure; render-look-fix and browser loops consume shared turn/tool/token/cost budgets.
    - Code Quality: conversation/artifact APIs reuse sessions/branches/checkpoints/events/server/resources; frontend/channel/device adapters remain separate packages; work-agent composition reuses web, browser, OfficeCLI, and connector tools without a second runtime or mandatory UI/connector framework.
    - Security: authenticated user identity owns every thread/memory/artifact/connector/browser/device action; consent and permission are rechecked; artifact links are authorized and expiring; OAuth tokens, local paths, injected browser secrets, and document-private data never enter model context, events, telemetry, or unauthorized export payloads.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/server.md`, `docs/session-stores.md`, `docs/working-and-semantic-memory.md`, `docs/credential-storage.md`, `docs/workflows.md`, `docs/host-security.md`.
      - AG-UI overview/specification: <https://docs.ag-ui.com/introduction>.
      - OfficeCLI interactive selection/marks, static HTML/PNG rendering, stable paths, validation/issues, save/close, and specialized office skills from the pinned tested release.
    - Options Considered:
      - Build Prism Studio/chat UI first: product scope before stable protocol; rejected.
      - Add many chat channels independently: duplicated auth/events/state; rejected.
      - Add durable conversation and AG-UI primitives, then measured connectors: chosen.
      - Embed or proxy OfficeCLI `watch` directly: creates an unauthenticated process-local server and volatile selection/mark state; rejected.
      - Build a separate work-agent runtime: duplicates sessions, approvals, workflows, and tools; rejected.
    - Chosen Approach:
      - Extend server/session/persistence APIs for user-owned conversations, artifact metadata/revisions, authorized artifact delivery, and event replay.
      - Add optional AG-UI and connector packages over secure run state and enterprise identity; compose `createWorkTools()` with ordinary Prism agents rather than introducing `WorkAgent`.
      - Render Office artifacts to bounded static HTML/PNG/contact sheets, map selected stable paths and proposed marks into durable Prism state/approvals, then apply accepted edits through atomic OfficeCLI batches and re-run the delivery gate.
      - Persist browser workflow checkpoints as verified URLs/domain state and host data, not serialized browser internals; after interruption reload and verify before any side effect.
      - Gate browser/voice/computer use behind explicit sandbox, consent, limits, and approval policies.
    - API Notes and Examples:
      ```ts
      const thread = await conversations.create({ identity, title: "Quarterly review" });
      const artifact = await artifacts.attach({ threadId: thread.id, uri, identity });
      return agui.handle(request, { threadId: thread.id, artifactId: artifact.id, identity });
      ```
    - Files to Create/Edit:
      - Server/session/persistence conversation APIs and conformance tests.
      - Optional AG-UI package and OAuth connector seam/reference adapter.
      - Server/session/persistence artifact metadata, revisions, review marks/selections, approvals, delivery, and conformance tests; OfficeCLI/Playwright/work-tool composition examples and evaluations.
      - Memory consent/lifecycle APIs; optional channel/voice/desktop-control packages only after review.
      - Examples and docs.
    - References:
      - Existing session branch/history, workflow schedules, event multiplexer, server handler, identity, credentials OAuth, memory scopes, run interruption.
  - Test Cases to Write:
    - Create/continue/reconnect/replay/branch/archive/export/delete, wrong-user access, duplicate request idempotency, event-gap recovery.
    - AG-UI message/tool/state/approval/error mapping, disconnect/resume, overflow/backpressure, malformed client event.
    - Memory consent/revoke/correct/delete/retention and connector token isolation/refresh/revocation.
    - Office artifact attach/revision/hash/compare/authorized-download, static preview, reconnectable review selection/mark, approve/reject/apply, concurrent reviewer conflict, failed edit rollback, final validate/issues/visual/save gate, and local-path redaction.
    - Browser checkpoint reload/verify, side-effect non-replay, conversation disconnect/resume, secret isolation, approval, stream bounds, sandbox/network policy, and redacted telemetry.
    - Voice/desktop-device denial, approval, stream bounds, sandbox/network policy, and redacted telemetry.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; conversation, AG-UI, memory-consent, connector, and optional device APIs.
    - Docs pages to create/edit:
      - `docs/conversations.md`, `docs/ag-ui.md`, `docs/work-artifacts-and-review.md`, `docs/work-tools.md`, `docs/officecli.md`, `docs/browser-automation.md`, `docs/working-and-semantic-memory.md`, `docs/credential-storage.md`, `docs/server.md`, `docs/workflows.md`, `docs/host-security.md`, optional connector/device pages, `docs/migration.md`.
    - `docs/index.md` update: yes; add Conversations, Work artifacts/review, and Frontend interoperability; update Tools, Memory, Credentials, Server, and Security.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 7 — Release 0.0.12: provider, memory, and RAG ecosystem parity
  - Acceptance Criteria:
    - Functional: direct Anthropic and Google adapters support their native reasoning, caching, tools, structured output, media, usage, credentials, discovery, and error semantics; all first-party providers run shared offline conformance and restricted live canaries.
    - Functional: OpenAI supports justified hosted tools, response continuation, and realtime APIs without forcing hosted-tool semantics into core; AI SDK adapter has a tested supported-version matrix and complete supported content/tool/metadata mapping.
    - Functional: Kimi, ZAI, OpenRouter, OpenCode Go, and NeuralWatt expose attributable model discovery/cache/reasoning/routing metadata and share serializers only where wire semantics are truly identical.
    - Functional: RAG supports atomic source replacement, deletion, document-loader/parser seams with focused text/Markdown/HTML/PDF reference adapters, reranking, citation provenance, ingestion status, and prompt-injection/content-trust metadata; public web ingestion reuses bounded `@arnilo/prism-web-tools` fetch results/citations rather than creating a second crawler.
    - Functional: memory supports finite-vector validation, retention/deletion/export, source/consent metadata, index rebuild, and production adapter conformance; additional vector stores are demand-gated.
    - Performance: provider streams, hosted tools, realtime sessions, document parsing, chunking, embedding, reranking, retrieval, and index rebuilds have finite byte/token/time/concurrency limits with published benchmarks.
    - Code Quality: provider wire duplication is reduced through proven shared transport/serialization primitives; document and vector ecosystems use existing `Embedder`, `VectorStore`, `ResourceLoader`, and context contracts.
    - Security: provider credentials remain host-owned; remote documents use SSRF/content bounds; retrieved content remains untrusted inert context; source replacement/deletion cannot cross ownership/corpus scope.
  - Approach:
    - Documentation Reviewed:
      - Provider package/conformance docs, `docs/multimodal-content.md`, `docs/working-and-semantic-memory.md`, `docs/rag.md`, `docs/resource-loading.md`, `docs/host-security.md`.
      - Current official OpenAI, Anthropic, Google, AI SDK, and existing-provider API documentation at implementation time.
    - Options Considered:
      - Depend only on AI SDK for Anthropic/Google/cloud access: broad coverage but hides provider-specific identity/cache/tool/reasoning semantics; rejected for major providers.
      - Add every provider/vector/parser: maintenance burden; rejected.
      - Add major direct providers and narrow reusable ingestion/reranking seams: chosen.
    - Chosen Approach:
      - Run primitive and wire-semantic review before each adapter; share only exact behavior.
      - Keep parsers/loaders/rerankers optional and bounded; ship minimal reference adapters rather than a document framework.
      - Reuse web-tool normalized documents, trust metadata, citations, and provider policy for web ingestion; Office artifacts enter through authorized artifact/resource loaders, never implicit local-file discovery.
      - Require credentialed canaries for advertised live features while retaining network-free conformance.
    - API Notes and Examples:
      ```ts
      await replaceSource({ sourceId, loader, chunker, embedder, store, scope });
      const context = await retrieveContext(query, { reranker, topK: 5, scope });
      ```
    - Files to Create/Edit:
      - New direct provider packages and existing seven provider packages/conformance/docs.
      - `packages/provider-ai-sdk`, `packages/rag`, `packages/memory`, resource-loading and testing helpers.
      - Live-canary workflows and provider compatibility matrix.
    - References:
      - Existing provider transport/model/cache/thinking/discovery primitives, AI SDK adapter, memory/RAG contracts, PostgreSQL pgvector adapter, media SSRF loader.
  - Test Cases to Write:
    - Every provider: text/tool/reasoning/cache/media/structured-output/usage/error/abort/discovery/credential conformance plus restricted live smoke.
    - Hosted-tool/realtime/continuation lifecycle and disconnect/budget behavior.
    - Atomic source replace failure/retry/delete, parser bombs/oversize/abort, reranker timeout/order, citation provenance, injection metadata.
    - Memory retention/delete/export/rebuild, finite vectors, cross-tenant/corpus isolation, production adapter parity.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; provider packages/features and memory/RAG ingestion/retrieval lifecycle expand.
    - Docs pages to create/edit:
      - Provider pages and compatibility matrix, `docs/provider-conformance.md`, `docs/multimodal-content.md`, `docs/rag.md`, `docs/working-and-semantic-memory.md`, `docs/resource-loading.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Provider/model connection, Input/context/RAG, Memory, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 8 — Release 0.0.13: simplify the package and establish 1.0 readiness
  - Acceptance Criteria:
    - Functional: public packed imports, generated projects, examples, Node compatibility, PostgreSQL/keychain/live-provider suites, and cross-package journeys pass with no workspace-relative imports.
    - Functional: profile package adoption data determines whether `prism-all`, `prism-base`, `prism-code`, `prism-compaction`, `prism-providers`, and `prism-sdk` remain; `web-tools`, `browser`, and `work-tools` stay optional and are split/merged only from measured dependency/adoption data; low-value profiles are replaced by install recipes with migration guidance.
    - Functional: package/API compatibility checks detect removed exports, changed declarations, version-range drift, migration drift, and tarball-content regressions before publish.
    - Performance: root/aggregate tarballs, install size, startup, run/stream/tool/workflow/database/protocol benchmarks have approved budgets; unnecessary historical review content is excluded from published artifacts.
    - Code Quality: cohesive domains are extracted from `src/contracts.ts`, `src/agents.ts`, `packages/workflows/src/run.ts`, server handler, and database persistence files; duplicate path containment, provider/web JSON cleanup, redactor resolution, row codecs, ownership, cursor, checkpoint, executable-runner, artifact-bound, and approval logic are removed.
    - Code Quality: implementation-text phase tests become behavior/type/export tests; `docs.test.ts` is reduced; completed plans/reviews are archived/indexed; formatting/linting and coverage thresholds are enforced with the smallest suitable tooling.
    - Code Quality: dependency major upgrades (`@types/node`, `diff`, TypeScript, or successors) are isolated, compatibility-tested changes rather than release-bundled churn.
    - Security: final gates include SAST, audit, dependency tree, license/SBOM, provenance, secret scan, sandbox/protocol/tenant threat suites, live integrations, and signed deterministic publication.
  - Approach:
    - Documentation Reviewed:
      - All public docs, package READMEs/changelogs/manifests, release scripts/workflows, current plans/reviews, TypeScript/Node/dependency migration notes at implementation time.
      - `docs/release-and-install.md`, `docs/migration.md`, `docs/public-contracts.md`, `docs/performance.md`.
    - Options Considered:
      - Rewrite hotspots into new class hierarchies: churn without deletion; rejected.
      - Keep all profile/history/test surfaces permanently: release and maintenance tax; rejected where adoption/behavior evidence is absent.
      - Extract pure shared domains, delete duplication, and enforce measurable gates: chosen.
    - Chosen Approach:
      - Split only proven cohesive areas and preserve public exports through compatibility facades where needed.
      - Prefer deletion, shared pure functions, Node/TypeScript tooling, and install recipes over abstractions or more packages.
      - Treat 0.0.13 as a 1.0 readiness review, not an automatic 1.0 release.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm run test:postgres
      npm run test:live
      npm run release:check -- --version 0.0.13
      npm run release:publish -- --version 0.0.13 --dry-run --allow-untagged
      ```
    - Files to Create/Edit:
      - Core/workflow/server/persistence/provider shared-domain sources and tests.
      - Profile manifests, lockfile, release scripts/workflows, package docs/changelogs.
      - Test/tooling configuration, docs navigation, plan/review archive indexes.
    - References:
      - 2026-07-19 hotspots and duplication audit; current deterministic release/provenance pipeline; all package conformance suites.
  - Test Cases to Write:
    - API declaration/export/package-version diff fixtures and migration compatibility from 0.0.5 through 0.0.13.
    - Shared-helper adapter parity; deleted-duplication behavioral equivalence.
    - Profile fresh-install/import and install-recipe tests; tarball allow/deny lists.
    - Coverage/lint/format negative fixtures; docs links/examples; Node supported-version matrix; full security/live/performance release matrix.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: potentially yes; package consolidation, compatibility, migrations, and internal refactors require exact review.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`, `docs/migration.md`, `docs/public-contracts.md`, `docs/performance.md`, affected API pages, package READMEs/changelogs, plan/review archive indexes.
    - `docs/index.md` update: yes; remove retired package entries, repair navigation, and verify every retained public surface is linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 9 — Demand-gated 0.1.x: product and ecosystem expansion
  - Acceptance Criteria:
    - Functional: only adoption-backed capabilities proceed: Studio/control plane, visual workflow editor, hosted cloud, managed observability, broader Slack/Teams/chat/channel catalog, voice/device vendors, desktop OS control, remote-browser vendors, extra web/Office/SaaS providers, advanced GraphRAG/semantic chunking, additional databases/vector stores/providers, framework-specific server adapters, or cron-expression support.
    - Performance: every accepted capability has explicit scale/cost/latency/storage budgets and does not expand default core/install/runtime cost.
    - Code Quality: product services consume stable 0.0.x/1.0 APIs and remain optional; no capability is added merely for comparison-table parity.
    - Security: hosted/device/channel/remote-browser/additional-connector capabilities complete dedicated identity, tenancy, consent, egress, sandbox, retention, audit, abuse, supply-chain, and incident-response threat reviews.
  - Approach:
    - Documentation Reviewed:
      - Adoption telemetry/issues, production benchmark reports, ecosystem requests, relevant protocol/vendor docs, and completed 0.0.13 readiness review.
    - Options Considered:
      - Prebuild a complete agent platform: high maintenance and conflicts with Prism's harness boundary; rejected.
      - Keep a demand-gated backlog with explicit entry criteria: chosen.
    - Chosen Approach:
      - Require a named user, concrete integration, operational owner, and measurable acceptance criteria before promoting any item into a numbered release plan.
    - API Notes and Examples:
      ```text
      demand evidence → primitive review → threat model → optional package/service → conformance → release gate
      ```
    - Files to Create/Edit:
      - None until a capability passes entry criteria; create a dedicated numbered plan when it does.
    - References:
      - Product boundaries and persona outcomes in this roadmap.
  - Test Cases to Write:
    - Defined in each promoted capability plan; no speculative scaffolding or placeholder package tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no until a capability is promoted.
    - Docs pages to create/edit:
      - `none` until promotion; then follow `.agents/skills/create-plan/references/prism-wiki.md`.
    - `docs/index.md` update: no until public behavior exists.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Package Coverage Ledger

| Package | Planned release(s) | Required outcome |
|---|---|---|
| `@arnilo/prism` | 0.0.6-0.0.13 | Secure IDs/limits, guardrails, run budgets/state, trace context, identity propagation, hotspot split |
| `@arnilo/prism-provider-openai` | 0.0.12 | Hosted tools, continuation/realtime where justified, live canary |
| `@arnilo/prism-provider-ai-sdk` | 0.0.12 | Supported-version matrix and full conformance |
| `@arnilo/prism-provider-kimi` | 0.0.12 | Live cache/reasoning/discovery tests; exact shared serializers |
| `@arnilo/prism-provider-zai` | 0.0.12 | Live cache/reasoning/discovery tests; exact shared serializers |
| `@arnilo/prism-provider-openrouter` | 0.0.10/0.0.12 | Routing metadata/policy integration and live tests |
| `@arnilo/prism-provider-opencode-go` | 0.0.12 | Dual-route conformance and live tests |
| `@arnilo/prism-provider-neuralwatt` | 0.0.12 | Metadata/telemetry validation and live tests |
| New direct Anthropic/Google providers | 0.0.12 | Native major-provider protocol coverage |
| New Azure/AWS/Vertex providers | 0.0.10 | Enterprise identity, region, private-endpoint semantics |
| `@arnilo/prism-compaction-llm` | 0.0.6 | Bounded provider output and attributable usage/trace |
| `@arnilo/prism-compaction-observational-memory` | 0.0.6/0.0.12 | Bounded/redacted workers; lifecycle integration |
| `@arnilo/prism-coding-agent` | 0.0.6/0.0.9 | Resource-safe tools and repository/Git coding harness |
| `@arnilo/prism-coding-security` | 0.0.6/0.0.9 | Real sandbox; policy remains defense-in-depth |
| `@arnilo/prism-credentials-node` | 0.0.6/0.0.10 | Bounded nonblocking stores and enterprise credential identity |
| `@arnilo/prism-evals` | 0.0.8 | Trace grading, judges, datasets, CI thresholds |
| `@arnilo/prism-mcp` | 0.0.6/0.0.8 | Secure bounded transport/discovery and broader protocol parity |
| `@arnilo/prism-memory` | 0.0.6/0.0.11/0.0.12 | Finite vectors, consent/lifecycle, production conformance |
| `@arnilo/prism-observability-opentelemetry` | 0.0.8 | Standard trace hierarchy and GenAI/MCP semantics |
| `@arnilo/prism-rag` | 0.0.12 | Atomic ingestion/deletion, loaders, reranking, trust metadata |
| `@arnilo/prism-server` | 0.0.7-0.0.11 | Resume, protocol, deployment, identity, conversation, AG-UI seams |
| `@arnilo/prism-session-store-sqlite` | 0.0.6/0.0.13 | Migration drift protection and shared codecs |
| `@arnilo/prism-session-store-postgres` | 0.0.6/0.0.8/0.0.10/0.0.13 | Drift protection, load benchmarks, enterprise lifecycle, shared codecs |
| `@arnilo/prism-supervisor` | 0.0.6/0.0.8/0.0.10 | Correct A2A streams/tasks and identity-aware delegation |
| `@arnilo/prism-tool-validator-json-schema` | 0.0.6/0.0.7 | Finite validation/cache options and secure-helper default |
| `@arnilo/prism-workflows` | 0.0.6/0.0.7/0.0.10/0.0.11 | Tenant isolation, revisions/limits, shared durable interruption, identity, artifact/review approvals |
| New `@arnilo/prism-web-tools` | 0.0.8/0.0.12 | Exa/Brave search, Firecrawl fetch/extraction, normalized citations/trust, RAG reuse |
| New `@arnilo/prism-browser` | 0.0.9/0.0.11 | Sandboxed Playwright contexts/actions, egress and side-effect policy, conversation composition |
| New `@arnilo/prism-work-tools` | 0.0.9-0.0.11 | OfficeCLI Word/Excel/PowerPoint artifacts; Microsoft 365/Google Workspace connectors; co-work review |
| `@arnilo/prism-all`, `@arnilo/prism-base`, `@arnilo/prism-code`, `@arnilo/prism-compaction`, `@arnilo/prism-providers`, `@arnilo/prism-sdk` | 0.0.13 | Adoption-based consolidation; retain only useful bundles; do not absorb browser binaries or work CLIs |

## Persona Outcomes

### Personal agent

- Durable reconnectable conversations, AG-UI, user-controlled memory, bounded web research, OAuth connectors, proactive schedules, and optional browser/voice/device tools.
- Prism supplies SDK/service primitives, not a mandatory chat product.

### Coding agent

- Real disposable containment, bounded repository/Git and Playwright tools, durable plans and approvals, hooks/diagnostics, rollback, worktrees/background runs, PR handoff, and coding evaluation harness.
- Shell stays available but is no longer the safest or primary repository/browser interface.

### Work agent

- Exa/Brave/Firecrawl research, sandboxed website interaction, OfficeCLI-native Word/Excel/PowerPoint inspect-edit-render delivery loops, Outlook/Gmail/calendar/file/task connectors, durable drafts/approvals, and AG-UI artifact review.
- Prism composes ordinary tools/sessions/workflows; it does not add a parallel `WorkAgent` runtime, unrestricted Office/SaaS command shell, or mandatory co-work application.

### Enterprise agent

- Authenticated agent/workload identity, scoped delegation, policy decisions, audit export, retention/encryption hooks, model routing/residency/budgets, enterprise cloud providers, identity-scoped Microsoft 365/Google Workspace work operations, standard telemetry/evals, deployment/failover, and tenant-safe persistence/protocols.
- Queue/control-plane/vendor adapter expansion requires measured need.

## Release Validation Checklist

Every numbered release must satisfy:

- [ ] All release tasks and focused adversarial tests pass.
- [ ] `npm run sdk:ready` passes with zero unexplained skips/failures.
- [ ] Node 20 and current-supported Node public imports pass.
- [ ] Relevant PostgreSQL/keychain/provider/MCP/A2A/web-provider/Playwright/OfficeCLI/work-connector/sandbox live suites pass in protected environments.
- [ ] Web/API costs and citations, browser/Office process cleanup, Office artifact validation/visual delivery gates, connector side-effect approvals/idempotency, and pinned executable/version/schema checks pass.
- [ ] `npm audit`, dependency tree, SAST, secret scan, SBOM/license, provenance, native-binary checksum/license, and tarball checks pass.
- [ ] Performance and package-size changes are measured and justified.
- [ ] Public docs, examples, migration notes, package READMEs/changelogs, and `docs/index.md` match behavior.
- [ ] Internal versions/ranges and profile contents are consistent.
- [ ] Release dry-run and fresh packed-install/cross-package journey pass.
- [ ] No release blocker is deferred solely to preserve a version/date.

## Compromises Made

- To be filled after release tasks are completed and verified.

## Further Actions

- To be filled after each release with measured gaps, rationale, owner, and priority.
