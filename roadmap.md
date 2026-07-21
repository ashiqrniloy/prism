# Prism 0.0.6+ Roadmap

Updated: 2026-07-21

## Objectives

- Make Prism safe for multi-tenant production use before expanding its feature surface.
- Close confirmed security, correctness, resource-exhaustion, persistence, and protocol defects at their shared boundaries.
- Reach competitive SDK parity for guardrails, durable agent interruption, run budgets, telemetry, evaluations, and interoperability.
- Finish coding-harness readiness (unified workspace, session search, context budgets, native major providers, goal/verify loops, subscription OAuth seams, AG-UI event mapping, coding-aware compaction) before enterprise, personal/work, or ecosystem expansion.
- Add focused personal-agent, coding-agent, work-connector, and enterprise-agent capabilities as optional packages over existing Prism primitives.
- Add bounded web research, interactive browser automation, and Outlook/Gmail/cloud-workspace connectors; local Office document execution remains host-selected skill/instruction work outside Prism packaging.
- Preserve Prism as a lightweight host-owned harness: core stays dependency-free at runtime, integrations stay optional, and no second agent/workflow/runtime abstraction is introduced. Hosts own TUI/desktop UI, skill packs, and provider login UX.
- Reduce package, test, documentation, and implementation complexity before a 1.0 commitment.

## Expected Outcome

- 0.0.6 removes current release blockers, including cross-tenant workflow cancellation and unbounded coding/MCP/credential paths.
- 0.0.7 provides secure run lifecycle primitives: typed guardrails, universal limits, durable interruption/resume, and a secure composition helper.
- 0.0.8 standardizes production telemetry/evaluations, completes bounded MCP/A2A interoperability, and adds Exa/Brave search plus Firecrawl-backed fetch/extraction tools.
- 0.0.9 makes coding and Playwright browser automation safe inside one disposable execution boundary.
- 0.0.10 (coding harness P0) unifies sandbox/workspace semantics so shell and filesystem tools share one tree, with fail-closed composition modes and host guidance.
- 0.0.11 (coding harness P1) adds session search/index, token/context budgeting with omission reporting, native Anthropic then Google providers, and a thin goal→verify coding loop helper/example.
- 0.0.12 (coding harness P2) adds additional subscription OAuth adapters behind existing seams, an AG-UI/ACP-facing event adapter for host TUI/desktop apps, and a coding-aware compaction preset.
- 0.0.13 adds enterprise identity, policy, audit, provider governance, deployment seams, and least-privilege Microsoft 365/Google Workspace connectors for Outlook, Gmail, calendars, files, and tasks.
- 0.0.14 adds durable personal/work-agent conversations, artifact co-work review, and memory consent/lifecycle on top of the already-shipped AG-UI adapter; broader channels and device capabilities remain opt-in.
- 0.0.15 closes remaining provider, memory, and RAG ecosystem gaps (hosted tools/realtime, AI SDK matrix, RAG loaders/rerank, memory production conformance).
- 0.0.16 consolidates packages/code/docs and establishes measurable 1.0 readiness gates.
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
- **No adapter zoo:** one `@arnilo/prism-web-tools` package covers host-selected Exa, Brave, and Firecrawl roles; one later `@arnilo/prism-work-tools` package may expose Microsoft 365 and Google Workspace connector subpaths until dependency/adoption evidence requires a split; one Playwright reference implementation precedes remote-browser vendors.
- **Cheapest safe web path:** search API → bounded fetch/extraction → browser automation; browser use is reserved for interactive, authenticated, or JavaScript-heavy workflows.
- **Local Office work stays external:** hosts may select skills/instructions and user-owned tools for local `.docx`/`.xlsx`/`.pptx` work; Prism ships no Office executable, SDK, wrapper, protocol, or runtime package.
- **Artifacts are not SaaS connectors:** Microsoft 365 and Google Workspace adapters own mail, calendar, cloud-file, and task APIs; they do not imply local Office document execution.
- **Host-controlled executables:** Prism never silently installs, updates, discovers, or executes arbitrary M365/GWS commands; hosts pin binaries/versions, paths, identities, roots, and allowed operations.
- **No speculative product layer:** Studio, hosted cloud, managed observability, broad channel catalogs, desktop OS control, and visual workflow builders remain demand-gated 0.1.x work.

## Release Order and Gates

1. Releases execute in order. A release does not start while an earlier P0/P1 acceptance criterion is open.
2. 0.0.6 is mandatory before any multi-tenant production recommendation.
3. 0.0.7 primitives precede coding, personal, and enterprise feature packages so those packages reuse one guardrail/limit/interruption model.
4. 0.0.8 telemetry and trace-evaluation contracts precede persona-specific autonomous execution; web providers must pass bounded transport, citation, credential-redaction, cost, and hostile-content tests.
5. 0.0.9 coding and browser execution must pass adversarial filesystem/network/process/resource tests before background coding or interactive-browser workflows are advertised.
6. 0.0.10–0.0.12 coding-harness readiness (P0 correctness, P1 fundamentals, P2 interoperability including AG-UI) must complete before enterprise identity, work connectors, personal conversations, or remaining ecosystem expansion start.
7. 0.0.13 enterprise providers and Microsoft 365/Google Workspace connectors must use authenticated identity, least-privilege scopes, idempotent side-effect patterns, and host-owned credentials.
8. 0.0.14 channel/device/co-work features remain optional and cannot broaden user consent, memory, network, file, browser, connector, or tool permissions; they reuse the AG-UI adapter shipped in 0.0.12.
9. 0.0.15 adds remaining provider/vector/document adapters only after conformance and adoption review; Anthropic/Google native adapters are already required by 0.0.11 and are not deferred here.
10. 0.0.16 may delete or consolidate surfaces; compatibility decisions and migration notes are required before 1.0.
11. Every release requires `npm run sdk:ready`, Node 20/current compatibility, packed-install checks, dependency audit, relevant live suites, secret scan, tarball review, and `git diff --check`.

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

- [x] Phase 3 — Release 0.0.8: production telemetry, evaluations, protocols, and web research
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
  - Completion Evidence (2026-07-20):
    - Plan 070 completed metadata-safe OTel GenAI hierarchy/trace linkage, bounded trace/model/pairwise evaluations, explicit batched-ledger durability plus session snapshot caching, MCP SDK 1.29.0 capabilities/stateful auth sessions, full A2A 1.0 durable/rich/reconnect/push surfaces, and optional direct Brave/Exa/Firecrawl web tools. Core gained no vendor SDK or protocol/web runtime dependency.
    - Added pinned CodeQL/dependency-review/audit/SPDX/license/secret/attestation workflows, Dependabot, and protected provider/MCP/A2A/web canaries. All 31 manifests, exact internal ranges, lock records, runtime metadata, changelogs, profile/package/install/export guards, migration docs, and release handoff now target `0.0.8`.
    - `npm run sdk:ready` passed in 87 seconds: 1,814 tests (1,789 pass, 25 explicit live skips, 0 fail), complete typecheck/build/examples/docs/package/install matrix, and 31 dry-run packs. Docker Node 20.20.1 built/imported all 21 core exports; disposable pgvector PostgreSQL passed 17 persistence plus 14 memory checks; keychain passed 27/27; audit/SBOM/license/dependency/source/tarball-secret gates were clean.
    - All 31 registry versions were available and deterministic provenance publish dry-run completed 31/31 without publication. Artifacts total 859,670 packed bytes/3,283,647 unpacked bytes/783 files; core is 490,241 bytes/1,735,130 bytes/245 files. Dated local benchmark evidence covers actual batching/OTel/cache paths and provider/PostgreSQL/MCP/A2A/web envelope shapes. No commit, tag, attestation, or package was published; protected CodeQL/dependency review, credentials/endpoints, signed tag, OIDC, and actual canaries/publication remain release-operator gates.

- [x] Phase 4 — Release 0.0.9: production coding and browser execution
  - Acceptance Criteria:
    - Functional: one reference disposable sandbox enforces read-only base filesystem, explicit writable workspace, network deny-by-default, CPU/memory/process/disk/wall-time limits, secret allow-list, and cooperative/forced termination.
    - Functional: bounded native list/search and structured Git status/diff/commit/branch/worktree operations cover common repository research without routing every operation through a shell.
    - Functional: coding runs support durable plans/todos, checkpoints, diagnostics, hooks, test/lint/security commands, patch rollback, background branch execution, and host-owned PR creation.
    - Functional: optional `@arnilo/prism-browser` provides bounded `browser_open`, `browser_snapshot`, `browser_act`, and `browser_close` tools over Playwright; one isolated `BrowserContext` is owned by a run, stateful actions are exclusive/ordered, and role/label/snapshot references precede CSS selectors.
    - Functional: browser policy distinguishes observation from side effects; authenticated/JavaScript-heavy workflows support navigation, click, type, select, check, scroll, wait, bounded screenshots, approved uploads/downloads, and popups without exposing `page.evaluate`, arbitrary JavaScript, extensions, devtools, or local browser profiles.
    - Functional: edit/write and structured Git operations remain serialized per real path and gain transactional rollback where a multi-file task requests it; shell remains an explicit escape hatch.
    - Performance: repository walks, searches, diagnostics, output, background jobs, worktrees, browser actions/pages/downloads/screenshots, workspace import/export, and cleanup have finite counts/bytes/time; benchmarks publish p95 repository, sandbox, and browser latency plus memory/disk/process use.
    - Code Quality: reusable coding/browser tools compose through existing tool, permission, execution-policy, run-state, sandbox, file-mutation, resource/image, and event primitives; no bespoke persona runtime, Git shell-string builder, browser planner, or one-implementation abstraction is introduced.
    - Security: sandbox containment—not command regexes—enforces filesystem/network/process boundaries; Git uses argument arrays/typed objects; browser egress denies private/local/file/devtools origins and handles DNS rebinding through an isolated proxy/firewall; symlink/TOCTOU, prompt-injection, secret, upload/download, and process escape tests fail closed.
    - Security: Office execution is removed by product decision: Prism ships no OfficeCLI/Office SDK/wrapper/package, generic Office MCP/CLI passthrough, Office binary, Office test, Office docs page, or Office release gate.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/guardrails.md`, `docs/workflows.md`, `docs/host-security.md`.
      - GitHub coding agent concepts: <https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent>.
      - Playwright 1.61 BrowserContext, locator, ARIA snapshot, and network routing APIs: <https://playwright.dev/docs/api/class-browsercontext>, <https://playwright.dev/docs/api/class-locator>, <https://playwright.dev/docs/aria-snapshots>, and <https://playwright.dev/docs/network>.
      - Docker CLI container-run/resource/seccomp references: <https://docs.docker.com/reference/cli/docker/container/run/>, <https://docs.docker.com/engine/containers/run/>, and <https://docs.docker.com/engine/security/seccomp/>.
      - Git porcelain/plumbing manuals selected from <https://git-scm.com/docs> for status, diff, ref validation, worktrees, patch checking/application, commit, and bundle.
      - `docs/review-coverage-2026-07-20-phase-4.md`: frozen scope, primitive, limit, threat, and revision evidence.
    - Options Considered:
      - Expand regex command deny lists: cannot provide containment; rejected.
      - Add separate tools for every Unix command: adapter bloat; rejected.
      - Expose Playwright `page`, arbitrary JavaScript, or a generic browser MCP command directly: maximum flexibility but coarse permissions and easy bypass of action policy; rejected for production defaults.
      - Reimplement browser automation in Prism: duplicates a mature engine; rejected.
      - Ship one real sandbox plus small bounded repository/Git and Playwright tool sets: chosen.
    - Chosen Approach:
      - Reuse the frozen primitive decision in `docs/review-coverage-2026-07-20-phase-4.md`: no new core primitive; generalize only package seams with two concrete consumers.
      - Prefer Node filesystem/process APIs and `execFile` argument arrays; use shell only for host-approved arbitrary commands.
      - Use Playwright as an optional peer/host-created browser or remote endpoint so browser binaries never enter core or aggregate packages; block service workers when routing must observe all requests and run behind real egress containment.
      - Keep GitHub/GitLab authentication, push, and PR creation host-owned; Prism emits a bounded PR handoff only.
    - API Notes and Examples:
      ```ts
      const tools = [
        ...createCodingTools(workspace, {
          sandbox,
          executionPolicy,
          limits: { maxSearchResults: 1_000, maxFileBytes: 8 * 1024 * 1024 },
        }),
        ...createBrowserTools({ browser, sandbox, networkPolicy, executionPolicy }),
      ];
      ```
    - Files to Create/Edit:
      - `packages/coding-agent` repository/search/Git/plan/rollback tools, types, tests, README.
      - `packages/coding-security` sandbox implementation/adapters, policy integration, tests, README.
      - New `packages/browser` Playwright adapter/tools, session/context lifecycle, egress/download/upload policy, tests, README, and pack checks.
      - Keep sandbox implementation in `packages/coding-security` unless measured dependency/platform separation proves a package split necessary.
      - Coding/browser examples, evaluation datasets, CI workflows, and docs.
    - References:
      - Existing `ExecutionPolicy`, coding approval policy, shell/read/write/edit tools, mutation queue, workflow state/checkpoints, evals, and secure run lifecycle.
  - Test Cases to Write:
    - Sandbox filesystem/network/process/resource escape attempts, fork bomb, disk fill, secret filtering, timeout/kill, cleanup.
    - Symlink loops, ignored/binary/large files, bounded search ordering, abort, Unicode paths, Git argument injection, dirty-worktree protection.
    - Plan/todo restart, hook failures, diagnostics truncation, atomic rollback, concurrent worktrees, canceled background task, PR handoff payload.
    - Browser context/cookie isolation, role/snapshot actions, redirects/DNS rebinding/private origin, service workers, popup/tab/action limits, timeout/abort/cleanup, prompt injection, secret injection, upload roots, download quarantine, high-impact approval, and prohibited evaluate/devtools/local-profile paths against local fixtures.
    - Curated coding/browser regressions plus optional SWE-bench-compatible external harness; no network in default suite.
    - Scope assertion: no Office package, executable, SDK, wrapper, protocol, test, docs page, binary, or release gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; sandbox and coding tool/profile surfaces expand.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/browser-automation.md`, `docs/workflows.md`, `docs/evaluations.md`, `docs/host-security.md`, `docs/performance.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Tools and Security entries; add Coding-agent workflow and Browser automation guidance.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-21):
    - Plan 072 completed disposable Docker sandbox, bounded repository list/search, structured Git/named checks/PR handoff, durable coding-plan/checkpoint composition, optional `@arnilo/prism-browser` with egress/side-effect/upload/download/screenshot/shared-sandbox policy, adversarial eval fixtures, `scripts/benchmark-0.0.9.mjs`, and protected Docker/Playwright gates. Office execution remains outside Prism packaging by product decision.
    - Versioned all 32 publishable manifests, exact internal ranges, lockfile records, runtime/MCP version metadata, release/package/install/docs guards, and changelogs to `0.0.9`. `@arnilo/prism-browser` is in `@arnilo/prism-all` only (not `@arnilo/prism-code`); activation stays explicit.
    - Synapta pre-ship Defects 1a/1b/2 landed via Plan 072 Tasks 9–13 (malformed tool-call → failed tool result; incomplete deltas → typed `incomplete_delta`; empty/thinking-only artifact candidates → `parse_error` / no silent `succeeded`). `structuredOutput: "final_turn_only"` remains deferred P2.
    - Task 13 RC re-verify: `npm run sdk:ready` passed 1,934 tests (1,905 pass, 29 explicit live skips, 0 fail). Supply chain: audit 0 high, SBOM 185 packages/8 licenses, working-tree secrets 0/2,402, tarball secrets 0/847, `git diff --check` clean. Packed artifacts 972,339 bytes / 3,755,038 unpacked / 847 files; core 519,366 / 1,819,939; browser 29,171 / 132,669 with no Playwright binary/image.
    - Public-registry `release:check` found all 32 `@arnilo/*@0.0.9` versions available. `release:publish --dry-run --allow-dirty --allow-untagged` completed 32/32 deterministic public/latest/provenance dry-runs; no commit, tag, or publication was created. Protected Docker/Playwright live gates, Node 20 CI, PostgreSQL/keychain, CodeQL/dependency review, signed tag, OIDC, and actual publication remain operator prerequisites.

- [ ] Phase 5 — Release 0.0.10: coding harness correctness and unified workspace (P0)
  - Acceptance Criteria:
    - Functional: disposable Docker/sandbox coding composition exposes an explicit workspace mode (`host`, `sandbox`, or future equivalents); default sandboxed composition no longer silently pairs container shell with host filesystem mutations.
    - Functional: in `sandbox` mode, `shell`, `read`, `write`, `edit`, `repo_list`, and `repo_search` observe and mutate one shared tree; Git/check runners targeting the sandbox use the same tree and cwd semantics.
    - Functional: in `host` mode, all coding tools run against the host workspace without claiming disposable containment; docs and APIs make the absence of sandbox isolation explicit.
    - Functional: sandbox import/export, close, and resume paths preserve tree identity (hash/entry metadata) so hosts cannot advertise “sandboxed coding” while edits land only on an unbound host root.
    - Functional: `createSandboxCodingTools` / related helpers reject unsafe mixed wiring (sandbox shell + host-mutating fs backends) unless an explicit documented escape hatch is set and surfaced in metadata.
    - Performance: unified mode adds no unbounded host↔container sync loops; import/export/list/search remain within existing finite entry/byte/time caps; benchmarks cover host vs sandbox modes.
    - Code Quality: one construction path documents mode selection; no second coding runtime; operations backends remain pluggable for custom remote sandboxes that can expose a host-reachable or exec-backed filesystem.
    - Security: path containment, execution policy, and non-root digest-pinned Docker defaults remain mandatory for advertised sandbox mode; docs forbid treating host mode as contained execution.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/review-coverage-2026-07-20-phase-4.md`, Plan 072 Task 1–2 evidence.
      - Current `createDockerSandbox`, `createSandboxCodingTools`, and Git bound-runner composition.
    - Options Considered:
      - Keep split-brain (shell in container, fs on host) and only document it: rejects user/harness correctness requirement; rejected as default.
      - Always bind-mount a writable host workspace as `/workspace`: weaker isolation; allowed only as an explicit host-opted mode if retained.
      - Unified mode with fail-closed composition and pluggable fs backends (exec-backed or shared mount): chosen.
    - Chosen Approach:
      - Add an explicit workspace-mode contract to coding-security composition.
      - Implement sandbox-backed filesystem operations sufficient for read/write/edit/list/search against the disposable tree, or a documented shared-mount mode that keeps one tree without claiming stronger isolation than provided.
      - Update adversarial tests to prove edit-then-shell and list-then-edit consistency inside one mode.
      - Update migration/docs so 0.0.9 split composition is called out as superseded.
    - API Notes and Examples:
      ```ts
      const tools = createSandboxCodingTools(sandbox, {
        workspaceMode: "sandbox", // or "host"
        cwd: workspaceRoot,
        executionPolicy,
      });
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/sandbox-coding-operations.ts`, Docker/fs backend helpers, tests.
      - `packages/coding-agent` operations interfaces only if a shared fs-operations seam is required.
      - `docs/coding-security.md`, `docs/coding-agent-tools.md`, `docs/migration.md`, `docs/host-security.md`.
    - References:
      - Phase 4 sandbox split-architecture decision and adversarial coding eval fixtures.
  - Test Cases to Write:
    - Sandbox mode: write via tool, read via shell (and reverse) sees the same bytes; list/search agree with shell `find`/`grep` equivalents on the same tree.
    - Host mode: tools mutate host cwd; metadata does not claim sandbox isolation.
    - Mixed wiring without escape hatch throws; with escape hatch emits explicit warning metadata.
    - Import/export hash continuity across close; concurrent exec limits still enforced.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; sandbox coding composition semantics change.
    - Docs pages to create/edit: `docs/coding-security.md`, `docs/coding-agent-tools.md`, `docs/migration.md`, `docs/host-security.md`, package READMEs/changelogs.
    - `docs/index.md` update: yes if Coding security/tools summaries change.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 6 — Release 0.0.11: coding harness fundamentals (P1)
  - Acceptance Criteria:
    - Functional: a bounded `SessionIndex` / search seam lists and filters prior sessions by workspace, time range, model/provider, label/summary text, and optional full-text over message/summary content; results return `sessionId` + optional `leafId` for resume/checkout.
    - Functional: SQLite and PostgreSQL session stores implement the search seam with finite page sizes; memory store may provide a linear fallback or explicit unsupported error.
    - Functional: prompt/context assembly supports a token/context budget with deterministic priority eviction and an omission report (what was dropped: skills, context blocks, history, tool results) without deleting raw session history.
    - Functional: `@arnilo/prism-provider-anthropic` ships native Anthropic Messages semantics (tools, caching breakpoints, thinking/reasoning, media, usage, errors, discovery) behind existing provider-package contracts; credentials remain host-owned.
    - Functional: `@arnilo/prism-provider-google` ships native Google Gemini/Generative semantics needed for coding hosts (tools, media, usage, errors, discovery) with the same conformance bar; AI SDK remains an escape hatch, not the primary path.
    - Functional: a thin goal→verify coding helper and example compose existing plan Markdown, coding tools, named checks, workflow suspend/approve, and PR-handoff without a second runtime or Goal database.
    - Performance: session search and budget estimation are finite in bytes/time/pages; provider adapters stream within existing run limits; published network-free benchmarks cover search and budget paths.
    - Code Quality: search/budget live as optional seams over SessionStore and input assembly; Anthropic/Google are optional packages; goal/verify is a helper/example over workflows + coding-agent.
    - Security: search respects store ownership/tenant boundaries; omission reports and search hits never include credentials; provider credentials stay late-bound and redacted.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores.md`, `docs/input-and-prompt-assembly.md`, `docs/provider-packages.md`, `docs/agent-loops.md`, `docs/coding-agent-tools.md`, `docs/workflows.md`.
      - Current Anthropic Messages and Google Gemini API docs at implementation time.
    - Options Considered:
      - Host-only session search outside Prism: duplicates every TUI/desktop; rejected for the index seam.
      - Always-on indexer/watcher: product daemon scope; rejected.
      - Bounded SessionIndex API + DB implementations + optional memory fallback: chosen.
      - Depend only on AI SDK for Anthropic/Google: hides cache/thinking/tool semantics; rejected for major coding providers.
      - New Goal runtime/table: duplicates workflows/plans; rejected in favor of thin composition helper.
    - Chosen Approach:
      - Add `SessionIndex` query types and store methods; implement FTS/metadata search in SQLite/Postgres.
      - Add assembler budget options with priority order (system/AGENTS → skills → context → history/tool results) and structured omission metadata on the assembled request or companion report.
      - Ship direct Anthropic then Google provider packages with shared offline conformance and gated live canaries.
      - Publish `examples/coding-goal-verify.ts` (name may vary) plus an optional exported helper that wires plan file + checks + suspend.
    - API Notes and Examples:
      ```ts
      const hits = await index.search({
        workspaceRoot,
        query: "flaky auth test",
        limit: 20,
      });
      await session.checkout(hits[0]?.leafId);

      const request = await assembleProviderInput({
        ...,
        contextBudget: { maxInputTokens: 32_000, reportOmissions: true },
      });

      await runCodingGoalVerify({ goal: "Fix flaky auth", cwd, checks: ["test"], approval });
      ```
    - Files to Create/Edit:
      - Core session-index contracts; sqlite/postgres search implementations and migrations/tests.
      - Input assembly budget/omission helpers and tests.
      - `packages/provider-anthropic`, `packages/provider-google`, conformance/docs, profile wiring.
      - Coding goal/verify helper and example; docs/migration updates.
    - References:
      - Existing SessionStore branch rebuild, provider package setup API, coding-checkpoint + workflow suspend.
  - Test Cases to Write:
    - Search pagination, ownership isolation, empty index, label/summary/message hits, resume via returned leafId.
    - Budget eviction order, omission report completeness, zero-budget failure, stable cache-prefix behavior when budget allows.
    - Anthropic/Google: text/tool/reasoning/cache/media/usage/error/abort/discovery conformance + restricted live smoke.
    - Goal/verify: failing check suspends; approve resumes; handoff artifact bounded; no credentials in plan state.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; session search, assembly budgets, two provider packages, coding helper.
    - Docs pages to create/edit: `docs/session-stores.md`, `docs/input-and-prompt-assembly.md`, provider pages, `docs/coding-agent-tools.md`, `docs/agent-loops.md`, `docs/migration.md`, examples README.
    - `docs/index.md` update: yes; Providers, Sessions, Input/context, Coding tools.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 7 — Release 0.0.12: coding harness interoperability (P2)
  - Acceptance Criteria:
    - Functional: additional subscription OAuth adapters plug into existing `OAuthProvider` / credential-store seams (Anthropic/Claude subscription or equivalent where the provider documents a supported flow; other providers only when protocol + redaction tests exist); login UX remains host-owned.
    - Functional: an AG-UI adapter package maps Prism messages, tool calls, approvals, state, errors, and reconnectable run events to standard bidirectional frontend events without coupling core to a UI framework; ACP-facing mapping is included where it shares the same event/tool/approval contracts or documented as a thin sibling mapper.
    - Functional: host TUI/desktop apps can stream assistant/tool events, present approvals, and resume interrupted runs through the adapter using existing session/run ledgers.
    - Functional: a coding-aware compaction preset (strategy or OM profile) preferentially retains file paths, diffs/decisions, failing check summaries, and plan/todo state while still writing ordinary compaction entries; raw history remains intact.
    - Performance: AG-UI/ACP mapping and OAuth refresh are finite in bytes/time; compaction preset stays within existing compaction limits; reconnect backpressure uses existing subscriber overflow policy.
    - Code Quality: OAuth adapters live in provider/credentials packages; AG-UI is an optional package over AgentEvent/session/server seams; compaction preset reuses CompactionStrategy / observational-memory — no second memory runtime.
    - Security: OAuth codes/tokens redacted; AG-UI never exposes local filesystem paths, raw credentials, or unrestricted tool argument dumps beyond host policy; compaction summaries are redacted with the active redactor.
  - Approach:
    - Documentation Reviewed:
      - `docs/credentials-and-redaction.md`, `docs/credential-storage.md`, `docs/providers/openai.md` (Codex OAuth pattern), `docs/agent-events.md`, `docs/compaction-and-retry.md`, `docs/compaction-observational-memory.md`, AG-UI spec.
      - Anthropic/other subscription OAuth documentation at implementation time; only ship adapters with verifiable protocol support.
    - Options Considered:
      - Build Prism TUI/Studio in-tree: product scope; rejected (host owns UI).
      - Defer AG-UI to personal-agent release: blocks coding TUI/desktop harness readiness; rejected.
      - Optional AG-UI/ACP event adapter + OAuth adapters + coding compaction preset: chosen.
    - Chosen Approach:
      - Reuse Codex OAuth patterns (device-code/PKCE, abort, redaction, durable store adapter) for each new provider OAuth.
      - Ship `@arnilo/prism-ag-ui` (name finalized at plan time) mapping AgentEvent ↔ AG-UI; document ACP mapping parity or sibling export.
      - Add `createCodingCompactionStrategy()` (or OM coding profile) that structures summaries for coding sessions; hosts still select the strategy explicitly.
    - API Notes and Examples:
      ```ts
      const oauth = createAnthropicOAuthProvider({ ... }); // only if protocol-supported
      await refreshOAuthCredential({ provider: oauth, credentials, store });

      return agui.handle(request, { session, identity });

      await session.compact({ strategy: createCodingCompactionStrategy() });
      ```
    - Files to Create/Edit:
      - Provider OAuth modules/tests; credentials-node store wiring docs.
      - New AG-UI optional package, server/session examples, conformance tests.
      - Coding compaction strategy/profile in coding-agent or compaction-observational-memory; docs/examples.
    - References:
      - OpenAI Codex OAuth, AgentEvent stream, run ledger, default/OM compaction strategies.
  - Test Cases to Write:
    - OAuth login abort, refresh, token redaction, store round-trip; unsupported provider flows are not stubbed as success.
    - AG-UI message/tool/state/approval/error mapping, disconnect/resume, overflow/backpressure, malformed client event.
    - Coding compaction retains path/check/plan signals under byte caps; raw entries remain listable; redactor applied.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; OAuth adapters, AG-UI package, compaction preset.
    - Docs pages to create/edit: `docs/ag-ui.md`, provider OAuth pages, `docs/compaction-and-retry.md`, `docs/credential-storage.md`, `docs/migration.md`, `docs/coding-agent-tools.md`.
    - `docs/index.md` update: yes; Frontend interoperability, Credentials, Compaction, Providers.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 8 — Release 0.0.13: enterprise identity, policy, provider governance, and work connectors
  - Acceptance Criteria:
    - Functional: authenticated `Principal` and `AgentIdentity` contexts support tenant, sponsor/owner, delegated actor, scopes, credential references, issued/expiry times, revocation, and immutable propagation through runs, tools, workflows, MCP, A2A, persistence, and telemetry.
    - Functional: a policy-decision ledger records allow/deny/modify/approval decisions, policy version, actor, target, reason, expiry, and evidence references; hosts can export to append-only/WORM storage without storing unrestricted payloads.
    - Functional: model governance supports allow-lists, provider/region/data-residency policy, routing, fallback, circuit breaking, retries, token/cost budgets, rate limits, and attributable selection diagnostics.
    - Functional: direct Azure OpenAI/Foundry, AWS Bedrock, and Google Vertex enterprise adapters use host workload identity/credential callbacks and preserve region/private-endpoint semantics; consumer Anthropic/Google packages from 0.0.11 remain separate from enterprise-cloud identity adapters.
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

- [ ] Phase 9 — Release 0.0.14: personal/work-agent conversations, co-work review, and channel/device expansion
  - Acceptance Criteria:
    - Functional: a durable conversation service creates, lists, continues, branches, archives, exports, and deletes user-scoped threads; clients reconnect and replay bounded ordered events without rerunning completed work.
    - Functional: personal memory exposes consent, source, visibility, correction, retention, deletion, and per-user/profile/thread controls; proactive schedules/events require explicit user enablement and revocable capabilities.
    - Functional: a durable artifact service records authorized source/output files, MIME/hash/version, producer run, citations/data sources, preview metadata, approval state, and final delivery; users can compare revisions, request changes, approve/reject proposed outputs, and recover the last validated artifact.
    - Functional: the 0.0.12 AG-UI adapter maps browser snapshots, connector drafts, approvals, progress, and authorized artifact download links into reconnectable co-work events without exposing local filesystem paths.
    - Functional: OAuth connector flows establish scoped Microsoft 365 and Google Workspace credentials for Outlook/Gmail and related workloads; Slack/Teams chat channels are added only after web/AG-UI demand is measured.
    - Functional: realtime voice and desktop OS/computer-control adapters remain optional, isolated, approval-aware, observable, and disabled by default; delivered Playwright browser tools compose with conversations only through existing sandbox, egress, secret-injection, approval, and run-limit policies.
    - Performance: thread/event pages, replay windows, memory injection, connector payloads, artifacts/revisions/previews, browser snapshots/actions, audio, screenshots, and device streams have finite byte/time/rate/version limits and reconnect backpressure; review and browser loops consume shared turn/tool/token/cost budgets.
    - Code Quality: conversation/artifact APIs reuse sessions/branches/checkpoints/events/server/resources; frontend/channel/device adapters remain separate packages; work-agent composition reuses web, browser, and connector tools without a second runtime or mandatory UI/connector framework; AG-UI package is extended rather than reimplemented.
    - Security: authenticated user identity owns every thread/memory/artifact/connector/browser/device action; consent and permission are rechecked; artifact links are authorized and expiring; OAuth tokens, local paths, injected browser secrets, and document-private data never enter model context, events, telemetry, or unauthorized export payloads.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/server.md`, `docs/session-stores.md`, `docs/working-and-semantic-memory.md`, `docs/credential-storage.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/ag-ui.md` (from 0.0.12).
      - AG-UI overview/specification: <https://docs.ag-ui.com/introduction>.
      - Existing Prism browser, resource, image, workflow, approval, and connector contracts at Phase 9 implementation time.
    - Options Considered:
      - Build Prism Studio/chat UI first: product scope before stable protocol; rejected.
      - Add many chat channels independently: duplicated auth/events/state; rejected.
      - Add durable conversation/artifact primitives on the already-shipped AG-UI adapter, then measured connectors: chosen.
      - Add a local document executable/runtime to support artifact review: outside Prism product scope; rejected.
      - Build a separate work-agent runtime: duplicates sessions, approvals, workflows, and tools; rejected.
    - Chosen Approach:
      - Extend server/session/persistence APIs for user-owned conversations, artifact metadata/revisions, authorized artifact delivery, and event replay.
      - Compose connector tools with ordinary Prism agents rather than introducing `WorkAgent`.
      - Keep artifact previews/edits host-owned; Prism persists only bounded authorized metadata, revisions, approvals, and delivery references.
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
      - OAuth connector seam/reference adapter for work workloads; AG-UI co-work event extensions.
      - Server/session/persistence artifact metadata, revisions, approvals, delivery, and conformance tests; Playwright/connector composition examples and evaluations.
      - Memory consent/lifecycle APIs; optional channel/voice/desktop-control packages only after review.
      - Examples and docs.
    - References:
      - Existing session branch/history, workflow schedules, event multiplexer, server handler, identity, credentials OAuth, memory scopes, run interruption, 0.0.12 AG-UI adapter.
  - Test Cases to Write:
    - Create/continue/reconnect/replay/branch/archive/export/delete, wrong-user access, duplicate request idempotency, event-gap recovery.
    - AG-UI co-work artifact/browser mapping, disconnect/resume, overflow/backpressure, malformed client event.
    - Memory consent/revoke/correct/delete/retention and connector token isolation/refresh/revocation.
    - Authorized artifact attach/revision/hash/compare/download, reconnectable review, approve/reject, concurrent reviewer conflict, failed update rollback, and local-path redaction.
    - Browser checkpoint reload/verify, side-effect non-replay, conversation disconnect/resume, secret isolation, approval, stream bounds, sandbox/network policy, and redacted telemetry.
    - Voice/desktop-device denial, approval, stream bounds, sandbox/network policy, and redacted telemetry.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; conversation, memory-consent, connector, artifact, and optional device APIs.
    - Docs pages to create/edit:
      - `docs/conversations.md`, `docs/ag-ui.md`, `docs/work-artifacts-and-review.md`, `docs/work-tools.md`, `docs/browser-automation.md`, `docs/working-and-semantic-memory.md`, `docs/credential-storage.md`, `docs/server.md`, `docs/workflows.md`, `docs/host-security.md`, optional connector/device pages, `docs/migration.md`.
    - `docs/index.md` update: yes; add Conversations, Work artifacts/review; update Tools, Memory, Credentials, Server, and Security.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 10 — Release 0.0.15: provider, memory, and RAG ecosystem parity
  - Acceptance Criteria:
    - Functional: OpenAI supports justified hosted tools, response continuation, and realtime APIs without forcing hosted-tool semantics into core; AI SDK adapter has a tested supported-version matrix and complete supported content/tool/metadata mapping.
    - Functional: Kimi, ZAI, OpenRouter, OpenCode Go, and NeuralWatt expose attributable model discovery/cache/reasoning/routing metadata and share serializers only where wire semantics are truly identical; Anthropic/Google native packages from 0.0.11 remain under shared offline conformance and restricted live canaries.
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
      - Depend only on AI SDK for major providers: rejected earlier; Anthropic/Google already direct as of 0.0.11.
      - Add every provider/vector/parser: maintenance burden; rejected.
      - Close remaining hosted-tool/realtime/AI-SDK/RAG/memory gaps with narrow reusable seams: chosen.
    - Chosen Approach:
      - Run primitive and wire-semantic review before each adapter change; share only exact behavior.
      - Keep parsers/loaders/rerankers optional and bounded; ship minimal reference adapters rather than a document framework.
      - Reuse web-tool normalized documents, trust metadata, citations, and provider policy for web ingestion; authorized host artifacts enter through resource loaders, never implicit local-file discovery.
      - Require credentialed canaries for advertised live features while retaining network-free conformance.
    - API Notes and Examples:
      ```ts
      await replaceSource({ sourceId, loader, chunker, embedder, store, scope });
      const context = await retrieveContext(query, { reranker, topK: 5, scope });
      ```
    - Files to Create/Edit:
      - Existing provider packages/conformance/docs; AI SDK matrix.
      - `packages/rag`, `packages/memory`, resource-loading and testing helpers.
      - Live-canary workflows and provider compatibility matrix.
    - References:
      - Existing provider transport/model/cache/thinking/discovery primitives, AI SDK adapter, memory/RAG contracts, PostgreSQL pgvector adapter, media SSRF loader, 0.0.11 Anthropic/Google packages.
  - Test Cases to Write:
    - Remaining providers: text/tool/reasoning/cache/media/structured-output/usage/error/abort/discovery/credential conformance plus restricted live smoke.
    - Hosted-tool/realtime/continuation lifecycle and disconnect/budget behavior.
    - Atomic source replace failure/retry/delete, parser bombs/oversize/abort, reranker timeout/order, citation provenance, injection metadata.
    - Memory retention/delete/export/rebuild, finite vectors, cross-tenant/corpus isolation, production adapter parity.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; provider features and memory/RAG ingestion/retrieval lifecycle expand.
    - Docs pages to create/edit:
      - Provider pages and compatibility matrix, `docs/provider-conformance.md`, `docs/multimodal-content.md`, `docs/rag.md`, `docs/working-and-semantic-memory.md`, `docs/resource-loading.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Provider/model connection, Input/context/RAG, Memory, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 11 — Release 0.0.16: simplify the package and establish 1.0 readiness
  - Acceptance Criteria:
    - Functional: public packed imports, generated projects, examples, Node compatibility, PostgreSQL/keychain/live-provider suites, and cross-package journeys pass with no workspace-relative imports.
    - Functional: profile package adoption data determines whether `prism-all`, `prism-base`, `prism-code`, `prism-compaction`, `prism-providers`, and `prism-sdk` remain; `web-tools`, `browser`, `ag-ui`, and `work-tools` stay optional and are split/merged only from measured dependency/adoption data; low-value profiles are replaced by install recipes with migration guidance.
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
      - Treat 0.0.16 as a 1.0 readiness review, not an automatic 1.0 release.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm run test:postgres
      npm run test:live
      npm run release:check -- --version 0.0.16
      npm run release:publish -- --version 0.0.16 --dry-run --allow-untagged
      ```
    - Files to Create/Edit:
      - Core/workflow/server/persistence/provider shared-domain sources and tests.
      - Profile manifests, lockfile, release scripts/workflows, package docs/changelogs.
      - Test/tooling configuration, docs navigation, plan/review archive indexes.
    - References:
      - 2026-07-19 hotspots and duplication audit; current deterministic release/provenance pipeline; all package conformance suites.
  - Test Cases to Write:
    - API declaration/export/package-version diff fixtures and migration compatibility from 0.0.5 through 0.0.16.
    - Shared-helper adapter parity; deleted-duplication behavioral equivalence.
    - Profile fresh-install/import and install-recipe tests; tarball allow/deny lists.
    - Coverage/lint/format negative fixtures; docs links/examples; Node supported-version matrix; full security/live/performance release matrix.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: potentially yes; package consolidation, compatibility, migrations, and internal refactors require exact review.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`, `docs/migration.md`, `docs/public-contracts.md`, `docs/performance.md`, affected API pages, package READMEs/changelogs, plan/review archive indexes.
    - `docs/index.md` update: yes; remove retired package entries, repair navigation, and verify every retained public surface is linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 12 — Demand-gated 0.1.x: product and ecosystem expansion
  - Acceptance Criteria:
    - Functional: only adoption-backed capabilities proceed: Studio/control plane, visual workflow editor, hosted cloud, managed observability, broader Slack/Teams/chat/channel catalog, voice/device vendors, desktop OS control, remote-browser vendors, extra web/SaaS providers, advanced GraphRAG/semantic chunking, additional databases/vector stores/providers, framework-specific server adapters, or cron-expression support.
    - Performance: every accepted capability has explicit scale/cost/latency/storage budgets and does not expand default core/install/runtime cost.
    - Code Quality: product services consume stable 0.0.x/1.0 APIs and remain optional; no capability is added merely for comparison-table parity.
    - Security: hosted/device/channel/remote-browser/additional-connector capabilities complete dedicated identity, tenancy, consent, egress, sandbox, retention, audit, abuse, supply-chain, and incident-response threat reviews.
  - Approach:
    - Documentation Reviewed:
      - Adoption telemetry/issues, production benchmark reports, ecosystem requests, relevant protocol/vendor docs, and completed 0.0.16 readiness review.
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
| `@arnilo/prism` | 0.0.6-0.0.16 | Secure IDs/limits, guardrails, run budgets/state, session search contracts, context budgets, trace context, identity propagation, hotspot split |
| `@arnilo/prism-provider-openai` | 0.0.12/0.0.15 | Codex OAuth retained; hosted tools/continuation/realtime where justified; live canary |
| New `@arnilo/prism-provider-anthropic` | 0.0.11 | Native Messages/tools/cache/thinking/media/usage; optional subscription OAuth in 0.0.12 if protocol-supported |
| New `@arnilo/prism-provider-google` | 0.0.11 | Native Gemini coding-host semantics; conformance + gated live canary |
| `@arnilo/prism-provider-ai-sdk` | 0.0.15 | Supported-version matrix and full conformance |
| `@arnilo/prism-provider-kimi` | 0.0.15 | Live cache/reasoning/discovery tests; exact shared serializers |
| `@arnilo/prism-provider-zai` | 0.0.15 | Live cache/reasoning/discovery tests; exact shared serializers |
| `@arnilo/prism-provider-openrouter` | 0.0.13/0.0.15 | Routing metadata/policy integration and live tests |
| `@arnilo/prism-provider-opencode-go` | 0.0.15 | Dual-route conformance and live tests |
| `@arnilo/prism-provider-neuralwatt` | 0.0.15 | Metadata/telemetry validation and live tests |
| New Azure/AWS/Vertex providers | 0.0.13 | Enterprise identity, region, private-endpoint semantics |
| `@arnilo/prism-compaction-llm` | 0.0.6 | Bounded provider output and attributable usage/trace |
| `@arnilo/prism-compaction-observational-memory` | 0.0.6/0.0.12/0.0.15 | Bounded/redacted workers; coding-aware preset collaboration; lifecycle integration |
| `@arnilo/prism-coding-agent` | 0.0.6/0.0.9/0.0.10/0.0.11/0.0.12 | Resource-safe tools; unified workspace ops; goal/verify helper; coding compaction preset |
| `@arnilo/prism-coding-security` | 0.0.6/0.0.9/0.0.10 | Real sandbox; unified workspace modes; policy remains defense-in-depth |
| `@arnilo/prism-credentials-node` | 0.0.6/0.0.12/0.0.13 | Bounded nonblocking stores; additional OAuth adapters; enterprise credential identity |
| `@arnilo/prism-evals` | 0.0.8 | Trace grading, judges, datasets, CI thresholds |
| `@arnilo/prism-mcp` | 0.0.6/0.0.8 | Secure bounded transport/discovery and broader protocol parity |
| `@arnilo/prism-memory` | 0.0.6/0.0.14/0.0.15 | Finite vectors, consent/lifecycle, production conformance |
| `@arnilo/prism-observability-opentelemetry` | 0.0.8 | Standard trace hierarchy and GenAI/MCP semantics |
| `@arnilo/prism-rag` | 0.0.15 | Atomic ingestion/deletion, loaders, reranking, trust metadata |
| `@arnilo/prism-server` | 0.0.7-0.0.14 | Resume, protocol, deployment, identity, conversation, AG-UI seams |
| New `@arnilo/prism-ag-ui` | 0.0.12/0.0.14 | Bidirectional AG-UI/ACP-facing event mapping for host TUI/desktop; co-work extensions |
| `@arnilo/prism-session-store-sqlite` | 0.0.6/0.0.11/0.0.16 | Migration drift protection, session search/FTS, shared codecs |
| `@arnilo/prism-session-store-postgres` | 0.0.6/0.0.8/0.0.11/0.0.13/0.0.16 | Drift protection, session search, load benchmarks, enterprise lifecycle, shared codecs |
| `@arnilo/prism-supervisor` | 0.0.6/0.0.8/0.0.13 | Correct A2A streams/tasks and identity-aware delegation |
| `@arnilo/prism-tool-validator-json-schema` | 0.0.6/0.0.7 | Finite validation/cache options and secure-helper default |
| `@arnilo/prism-workflows` | 0.0.6/0.0.7/0.0.11/0.0.13/0.0.14 | Tenant isolation, revisions/limits, goal/verify composition, identity, artifact/review approvals |
| New `@arnilo/prism-web-tools` | 0.0.8/0.0.15 | Exa/Brave search, Firecrawl fetch/extraction, normalized citations/trust, RAG reuse |
| New `@arnilo/prism-browser` | 0.0.9/0.0.14 | Sandboxed Playwright contexts/actions, egress and side-effect policy, conversation composition |
| New `@arnilo/prism-work-tools` | 0.0.13-0.0.14 | Microsoft 365/Google Workspace connectors and co-work review; no local Office runtime |
| `@arnilo/prism-all`, `@arnilo/prism-base`, `@arnilo/prism-code`, `@arnilo/prism-compaction`, `@arnilo/prism-providers`, `@arnilo/prism-sdk` | 0.0.16 | Adoption-based consolidation; retain only useful bundles; do not absorb browser binaries or work CLIs |

## Persona Outcomes

### Personal agent

- Durable reconnectable conversations, AG-UI (from coding-harness 0.0.12), user-controlled memory, bounded web research, OAuth connectors, proactive schedules, and optional browser/voice/device tools.
- Prism supplies SDK/service primitives, not a mandatory chat product.

### Coding agent

- Real disposable containment with **one shared workspace tree**, bounded repository/Git and Playwright tools, durable plans/approvals, goal→verify loops, hooks/diagnostics, rollback, worktrees/background runs, PR handoff, session search/resume, context budgets, coding-aware compaction, native Anthropic/Google providers, subscription OAuth seams, AG-UI/ACP event mapping for host TUI/desktop, and coding evaluation harness.
- Shell stays available but is no longer the safest or primary repository/browser interface.
- Prism does not ship skill packs or a TUI; hosts own `.agents` content and UI chrome.

### Work agent

- Exa/Brave/Firecrawl research, sandboxed website interaction, Outlook/Gmail/calendar/file/task connectors, durable drafts/approvals, and AG-UI artifact review.
- Prism composes ordinary tools/sessions/workflows; it does not add a parallel `WorkAgent` runtime, local Office runtime, unrestricted SaaS command shell, or mandatory co-work application.

### Enterprise agent

- Authenticated agent/workload identity, scoped delegation, policy decisions, audit export, retention/encryption hooks, model routing/residency/budgets, enterprise cloud providers, identity-scoped Microsoft 365/Google Workspace work operations, standard telemetry/evals, deployment/failover, and tenant-safe persistence/protocols.
- Queue/control-plane/vendor adapter expansion requires measured need.
- Enterprise work starts only after coding-harness readiness (0.0.10–0.0.12) completes.

## Release Validation Checklist

Every numbered release must satisfy:

- [ ] All release tasks and focused adversarial tests pass.
- [ ] `npm run sdk:ready` passes with zero unexplained skips/failures.
- [ ] Node 20 and current-supported Node public imports pass.
- [ ] Relevant PostgreSQL/keychain/provider/MCP/A2A/web-provider/Playwright/work-connector/sandbox live suites pass in protected environments.
- [ ] Web/API costs and citations, browser/process cleanup, artifact bounds, connector side-effect approvals/idempotency, and pinned executable/version/schema checks pass.
- [ ] `npm audit`, dependency tree, SAST, secret scan, SBOM/license, provenance, native-binary checksum/license, and tarball checks pass.
- [ ] Performance and package-size changes are measured and justified.
- [ ] Public docs, examples, migration notes, package READMEs/changelogs, and `docs/index.md` match behavior.
- [ ] Internal versions/ranges and profile contents are consistent.
- [ ] Release dry-run and fresh packed-install/cross-package journey pass.
- [ ] No release blocker is deferred solely to preserve a version/date.

## Compromises Made

- 2026-07-21: Coding-harness readiness (unified workspace, session search, context budgets, native Anthropic/Google, goal/verify, subscription OAuth seams, AG-UI/ACP event mapping, coding-aware compaction) was inserted as Releases 0.0.10–0.0.12 before enterprise identity/work connectors. Former 0.0.10–0.0.13 work shifted to 0.0.13–0.0.16. AG-UI moved earlier than personal/work conversations so host TUI/desktop coding apps are unblocked without waiting for enterprise or conversation services.
- Remaining compromises to be filled after each release task is completed and verified.

## Further Actions

- P0: Publish 0.0.9 via operator handoff in `docs/release-and-install.md` (clean protected-branch CI, signed `v0.0.9`, npm auth/OIDC, optional protected Docker/Playwright gates). Plan 072 Tasks 0–13 complete; Synapta Defects 1a/1b/2 fixed; no further code ship gates remain.
- Remaining further actions to be filled after each release with measured gaps, rationale, owner, and priority.
