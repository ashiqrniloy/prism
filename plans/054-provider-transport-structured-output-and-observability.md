# Provider Transport, Structured Output, and Observability

## Objectives

- Eliminate duplicated/unbounded provider protocol code and complete OpenAI OAuth device flow.
- Add native provider structured-output controls with capability-aware fallback.
- Add provider/tool observability hooks without leaking content or credentials.

## Expected Outcome

- All first-party providers consume shared bounded transport/serialization primitives and retain conformance.
- Providers expose native JSON-schema output where supported; artifact repair remains fallback.
- Runs expose standardized timing, request ID, retry, usage/cost/energy, and tracing hooks.

## Tasks

- [x] 0. Review existing provider primitives and freeze reusable capability design
  - Acceptance Criteria:
    - Functional: Inventory maps every `safeText`, SSE reader, argument parser, tool/message serializer, retry metadata path, structured-output option, and telemetry event across root and provider packages.
    - Performance: Proposed primitives specify finite frame/body limits and avoid extra buffering/copies.
    - Code Quality: Design introduces only generic primitives proven by at least two providers; provider-specific request/event mapping remains local.
    - Security: Trust boundaries, redaction order, header ownership, URL/error handling, and observability data classification are documented.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-layer.md`, `docs/provider-conformance.md`, `docs/provider-packages.md`, `docs/provider-request-policies.md`, all `docs/providers/*.md`.
      - WHATWG streams/TextDecoder APIs available on Node >=20; existing package source/tests.
    - Options Considered:
      - New generic transport framework/package: excess abstraction.
      - Small core provider utility subpaths used through existing peer dependency: chosen.
    - Chosen Approach:
      - Produce decision table for bounded SSE frames, bounded response text, JSON object arguments, and OpenAI-style serialization; separately define capability/options/events for structured output and telemetry.
    - API Notes and Examples:
      ```ts
      for await (const event of readSseEvents(body, { maxEventBytes })) consume(event.data);
      ```
    - Files to Create/Edit:
      - `docs/provider-primitives.md`: inventory, existing coverage, gaps, selected generic APIs.
      - `docs/index.md`: add provider primitives entry.
      - `docs/review-coverage-2026-07-14.md`: map provider findings/capabilities to 054.
    - References:
      - Review provider duplication, unbounded streams, native structured output, resilient transport, observability gaps.
  - Test Cases to Write:
    - Design fixtures list chunk/multiline/limit/error/redaction cases every migrated provider must pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no implementation yet; design freezes later public capability.
    - Docs pages to create/edit: `docs/provider-primitives.md`, `docs/review-coverage-2026-07-14.md`.
    - `docs/index.md` update: yes — Provider and model connection → Provider primitives.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 1. Implement bounded SSE, response-text, argument, and OpenAI serialization primitives
  - Acceptance Criteria:
    - Functional: Shared APIs support LF/CRLF, comments, multiline `data:`, final event, UTF-8 chunk splits, abort/cancel, bounded response text, JSON-object arguments, and validated OpenAI-style messages/tools.
    - Performance: Incremental O(bytes) parsing, finite configurable defaults, no full stream accumulation.
    - Code Quality: Stdlib-only, typed errors with provider-safe metadata, public subpaths covered by export/install tests.
    - Security: Oversized remote input terminates deterministically; helpers never include authorization headers/full sensitive bodies in errors.
  - Approach:
    - Documentation Reviewed:
      - Task 0 design; Node >=20 web stream APIs; `docs/public-contracts.md` export conventions.
    - Options Considered:
      - External SSE dependency: unnecessary for small protocol surface.
      - Native incremental parser: chosen.
    - Chosen Approach:
      - Add narrowly scoped `@arnilo/prism/providers/transport` and `/openai` exports; keep defaults calibrated and overrideable.
    - API Notes and Examples:
      ```ts
      const detail = await readBoundedResponseText(response, { maxBytes: 64 * 1024 });
      const args = parseJsonObjectArguments(raw, { toolName });
      ```
    - Files to Create/Edit:
      - `src/providers/transport.ts`, `src/providers/openai-primitives.ts` (tentative names).
      - Root `package.json` exports; public export/install/packaging tests.
      - `src/__tests__/provider-transport.test.ts`, `src/__tests__/openai-primitives.test.ts`.
      - `docs/provider-primitives.md`, `docs/public-contracts.md`, `docs/release-and-install.md`, `docs/index.md`.
    - References:
      - Task 0 primitive inventory; `src/providers/openai-compatible.ts`.
  - Test Cases to Write:
    - Split UTF-8, multiline events, comments, EOF, abort, oversize frame/body, malformed args/messages.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — reusable provider subpaths.
    - Docs pages to create/edit: `docs/provider-primitives.md`, `docs/public-contracts.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes — document imports and limits.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Migrate every first-party provider and remove duplicated protocol helpers
  - Acceptance Criteria:
    - Functional: OpenAI-compatible, OpenAI, OpenCode Go, OpenRouter, ZAI, Kimi, and NeuralWatt preserve request/event/telemetry behavior while using bounded helpers; NeuralWatt comment telemetry remains supported.
    - Performance: No provider retains an unbounded frame/error reader; baseline stream throughput does not regress over 10%.
    - Code Quality: Remove dead duplicate `sse.ts`, `safeText`, `parseArgs`, `toTool`, and serializers where shared behavior is exact; document deliberate provider-specific variants.
    - Security: API-key redaction, auth-header precedence, abort, reader release, and bounded failures pass in each package.
  - Approach:
    - Documentation Reviewed:
      - Each provider README/docs/test suite; Task 1 APIs; provider conformance docs.
    - Options Considered:
      - One bulk generic provider: would erase protocol differences.
      - Shared leaf helpers with local adapters: chosen.
    - Chosen Approach:
      - Migrate one package at a time, run package conformance, then delete only exact duplicates.
    - API Notes and Examples:
      ```ts
      for await (const { data } of readSseEvents(response.body, limits)) {
        yield mapProviderEvent(JSON.parse(data));
      }
      ```
    - Files to Create/Edit:
      - `src/providers/openai-compatible.ts` and tests/docs.
      - `packages/provider-{openai,opencode-go,openrouter,zai,kimi,neuralwatt}/src/**` and package tests/READMEs.
      - `docs/providers/*.md`, `docs/provider-conformance.md`, `docs/performance.md`.
    - References:
      - Review duplicate-helper and unbounded-stream findings.
  - Test Cases to Write:
    - Shared protocol matrix runs against all providers; package-specific cache/reasoning/energy mappings remain unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — bounded protocol errors/limits for every provider.
    - Docs pages to create/edit: all affected `docs/providers/*.md`, `docs/provider-conformance.md`, `docs/performance.md`.
    - `docs/index.md` update: yes — update provider descriptions with resilient transport.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 3. Complete abortable OpenAI device-code OAuth polling and secret handling
  - Acceptance Criteria:
    - Functional: Login polls through pending/slow-down to success, respects interval/expiry, aborts promptly, and classifies terminal failures.
    - Performance: No busy loop; requests are bounded by expiry and server-directed delay.
    - Code Quality: Shared token parser serves authorization-code, refresh, and device exchanges; deterministic tests use injected fetch/time seam only as needed.
    - Security: Authorization/device/access/refresh tokens are redacted from all response-derived errors.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-openai/src/oauth.ts`, `docs/providers/openai.md`; RFC 8628 §§3.2-3.5; RFC 7636.
    - Options Considered:
      - Host-managed polling: contradicts provider login API.
      - Provider-owned bounded polling: chosen.
    - Chosen Approach:
      - Parse `interval`/`expires_in`, use abortable timers, increase delay on `slow_down`, and redact all temporary/permanent secrets.
    - API Notes and Examples:
      ```ts
      await setTimeout(intervalMs, undefined, { signal });
      ```
    - Files to Create/Edit:
      - `packages/provider-openai/src/oauth.ts`, OAuth tests, package README.
      - `docs/providers/openai.md`, `docs/credentials-and-redaction.md`.
    - References:
      - Review OAuth P1 finding.
  - Test Cases to Write:
    - Pending→success, slow-down, expiry, abort, terminal error, and echoed-secret cases.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — completed OAuth login/abort behavior.
    - Docs pages to create/edit: `docs/providers/openai.md`, `docs/credentials-and-redaction.md`.
    - `docs/index.md` update: yes — update OpenAI auth description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 4. Add capability-aware native structured-output requests
  - Acceptance Criteria:
    - Functional: Provider request options express JSON object/schema output; capability metadata identifies support; OpenAI-family and any other supporting first-party providers map options correctly; unsupported providers fail clearly or use explicitly selected artifact-loop fallback.
    - Performance: Native mode avoids repair turns when provider returns valid output; no schema compilation in transport.
    - Code Quality: Generic contracts contain provider-neutral schema/name/strict fields; provider-specific wire formats stay local; existing options remain source compatible.
    - Security: Schemas are JSON-safe, size-bounded, prototype-pollution keys rejected, and provider errors do not echo sensitive generated content.
  - Approach:
    - Documentation Reviewed:
      - `docs/structured-output.md`, `docs/model-registry.md`, provider request/capability contracts and provider docs current at implementation time.
    - Options Considered:
      - Put provider wire `response_format` in core: leaks vendor shape.
      - Provider-neutral structured-output option mapped by capable providers: chosen.
    - Chosen Approach:
      - Extend `ProviderRequestOptions`/model capabilities; map to provider APIs; integrate artifact loop as documented fallback, not automatic hidden behavior.
    - API Notes and Examples:
      ```ts
      providerOptions: { structuredOutput: { name: "answer", schema, strict: true } }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts` or cohesive extracted provider contracts, `src/config.ts`, merge/tests.
      - Supporting provider package request mappers/tests.
      - `docs/structured-output.md`, `docs/provider-layer.md`, `docs/model-registry.md`, provider pages, `docs/index.md`.
    - References:
      - Review capability gap #2.
  - Test Cases to Write:
    - Supported mapping, unsupported rejection/fallback, option merge, schema limit/pollution, valid native result with zero revisions.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new provider option/capability.
    - Docs pages to create/edit: `docs/structured-output.md`, `docs/provider-layer.md`, `docs/model-registry.md`, relevant provider pages.
    - `docs/index.md` update: yes — structured-output entry includes native/fallback modes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. Add provider/tool observability hooks and optional OpenTelemetry adapter
  - Acceptance Criteria:
    - Functional: Runs expose request/provider/model IDs, latency, retries, rate-limit hints, token/cache/cost/energy usage, tool duration/result status, and errors through stable redacted events; optional adapter emits spans/metrics without changing core behavior.
    - Performance: Disabled hooks allocate no per-delta span; enabled overhead is benchmarked under 5% excluding exporter I/O.
    - Code Quality: Existing agent events/middleware/usage are extended rather than introducing a second event bus; OpenTelemetry dependency exists only in optional package.
    - Security: Prompt/content/tool payloads and credentials are opt-in and redacted by default; high-cardinality IDs are not metric labels.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md`, `docs/middleware-hooks.md`, `docs/runs-and-usage.md`, NeuralWatt telemetry implementation; current OpenTelemetry JS semantic conventions must be verified during execution.
    - Options Considered:
      - Hard dependency in core: rejected.
      - Stable core signals + `@arnilo/prism-observability-opentelemetry`: chosen.
    - Chosen Approach:
      - Extend existing events/metadata minimally, add optional adapter package consuming them, and document safe defaults.
    - API Notes and Examples:
      ```ts
      const telemetry = createOpenTelemetryMiddleware({ tracer, meter });
      session.run(input, { middleware: [telemetry] });
      ```
    - Files to Create/Edit:
      - Core event/usage/middleware contracts and tests (exact modules after Task 0 inventory).
      - New `packages/observability-opentelemetry/{package.json,src,index tests,README,CHANGELOG}`.
      - Root workspaces/lock/tsconfig/build tests; `packages/prism-all` inclusion decision documented.
      - `docs/observability.md`, `docs/agent-events.md`, `docs/middleware-hooks.md`, `docs/runs-and-usage.md`, `docs/index.md`.
    - References:
      - Review capability gap #8; existing NeuralWatt cost/energy events.
  - Test Cases to Write:
    - Successful/error/retry/tool spans, usage metrics, disabled overhead, redaction, no content by default, exporter failure isolation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — events and new optional package.
    - Docs pages to create/edit: `docs/observability.md`, `docs/agent-events.md`, `docs/middleware-hooks.md`, `docs/runs-and-usage.md`.
    - `docs/index.md` update: yes — Agent/session runtime → Observability.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Verify provider phase across packages
  - Acceptance Criteria:
    - Functional: Core/provider conformance, OAuth, native structured output, observability, install/export, and offline tests pass.
    - Performance: Record stream throughput/memory and disabled telemetry benchmarks; enforce configured bounds.
    - Code Quality: Duplicate-helper scan confirms only documented variants remain; all new package/public exports have smoke tests/docs.
    - Security: Malicious stream/body/schema and secret-canonical tests pass; audit has no high/critical issues.
  - Approach:
    - Documentation Reviewed:
      - Tasks 0-5 docs and root release gates.
    - Options Considered:
      - Final-release-only validation: rejected.
      - Package-by-package plus aggregate gate: chosen.
    - Chosen Approach:
      - Run every provider suite, conformance matrix, package dry-run/install smoke, audit, and update review matrix.
    - API Notes and Examples:
      ```bash
      npm test && npm run test:packages && npm run test:install
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-14.md`: aggregate gate, audit, scan, and security evidence.
      - `docs/performance.md`: dated transport and telemetry benchmark snapshot.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`: keep model-discovery fixture aligned with shipped structured-output capability.
    - References:
      - Plan 058 final gate.
  - Test Cases to Write:
    - No new cases; execute all 054 tests and cross-provider conformance.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: `docs/review-coverage-2026-07-14.md` evidence.
    - `docs/index.md` update: no additional entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- NeuralWatt comment-frame parsing uses the generic `readSseEvents` `comments` field; no second core export.
- Structured-output and observability contracts are frozen in `docs/provider-primitives.md` (Tasks 4–5 implemented).
- Task 1 ships `readSseData` as a migration alias; provider packages migrate in Task 2.
- `parseJsonObjectArguments` reports `invalid_json_arguments` for malformed/non-object JSON.
- OpenTelemetry `attachSession` observes the full event stream. A zero-I/O 5,000-delta burst adds about 1 ms (1.06 ms → 2.09 ms), while a realistic delayed stream remains within benchmark noise; subscriber filtering is deferred until a measured workload needs it.
- Live provider tests require credentials and remain intentionally skipped in the offline aggregate gate (25 skips); all deterministic provider fixtures pass.

## Further Actions

- Resolved by Plan 058 Tasks 1 and 8: packed provider integration, Node 20/24 imports, transport fixtures, and release artifacts pass. Live-provider smoke remains an operator-only non-blocking check because no release credentials were supplied.
- Post-0.0.4 / P3: add subscriber-side event filtering only if a measured high-frequency in-memory workload exceeds the documented OpenTelemetry burst ceiling.
