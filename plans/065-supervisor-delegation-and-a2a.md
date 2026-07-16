# Optional Supervisor Delegation and A2A Interoperability

## Objectives
- Add one independently installable `@arnilo/prism-supervisor` package for bounded local child delegation without changing core agent behavior.
- Add protocol-versioned A2A 1.0 card, JSON-RPC/SSE server, signing/verification, and explicit remote client APIs in the same optional package.
- Preserve ownership, permission, memory/resource, credential, cancellation, redaction, and network trust boundaries.

## Expected Outcome
- Hosts can delegate to explicit child descriptors with derived resource/thread IDs, narrowing-only policy composition, lifecycle hooks, bounded recursion/concurrency/time/tool/turn/token use, result return, and event subscription.
- Hosts can explicitly expose selected agents through A2A 1.0 or call allow-listed remote agents after card/auth/signature validation, with bounded untrusted payloads and streams.
- Core, workflows, server, and profile bundles remain unchanged and do not load supervisor/A2A code when absent.

## Tasks

- [x] Inventory existing primitives and current A2A protocol requirements
  - Acceptance Criteria:
    - Functional: map local delegation to `AgentSession`, `AgentRunResult`, `RunOptions`, `PermissionPolicy`, ownership, redaction, memory scope, and event primitives; map A2A to web-standard `Request`/`Response`.
    - Performance: identify existing bounded queues and run controls before adding code.
    - Code Quality: add no core primitive unless an actual generic gap remains; record A2A 1.0 wire/version choices from current specification rather than Mastra types.
    - Security: identify privilege amplification, recursive/cyclic delegation, budget exhaustion, memory/credential leakage, SSRF, card impersonation/replay/tamper, malformed remote data, and abort boundaries.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/public-contracts.md`, `docs/host-security.md`, `docs/working-and-semantic-memory.md`, `docs/server.md`, `docs/workflows.md`.
      - `src/contracts.ts`, `src/security.ts`, `src/event-multiplexer.ts`, `packages/server/src/handler.ts`, `packages/memory/src/types.ts`.
      - A2A Protocol latest specification at `https://a2a-protocol.org/latest/specification` via Context7 `/websites/a2a-protocol`: protocol version 1.0, `/.well-known/agent-card.json`, `JSONRPC` supported interface, `SendMessage`, `SendStreamingMessage`, SSE, RFC 7515 JWS card signatures, RFC 8785 canonical payload.
    - Options Considered:
      - Core-owned dynamic supervisor: rejected because it broadens every agent's trust/runtime surface.
      - Static workflows only: retained for known deterministic graphs but insufficient for runtime-selected delegation.
      - Separate supervisor and A2A packages: rejected initially because both are tiny adapters over the same bounded delegation/result boundary; split only if dependencies diverge.
      - One optional zero-dependency package: chosen.
    - Chosen Approach:
      - Reuse agent/session/result/policy/event/web APIs; package owns only delegation and A2A wire contracts.
    - API Notes and Examples:
      ```ts
      const supervisor = createSupervisor({ children: { research: { createSession } } });
      const result = await supervisor.delegate({ childId: "research", input: "Check sources" });
      ```
    - Files to Create/Edit:
      - `plans/065-supervisor-delegation-and-a2a.md`: executable plan.
    - References:
      - Roadmap Phase 13 and review threat matrix F-012.
  - Test Cases to Write:
    - Primitive boundary/source tests prove core has no supervisor/A2A import.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit: none for inventory.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add bounded local supervisor delegation
  - Acceptance Criteria:
    - Functional: explicit child allow-list, derived resource/thread IDs, result return, nested delegated callback, cancellation, before/after hooks, and child failures work; hook changes can only narrow configured budgets/policies.
    - Performance: hard caps cover depth, active children, input bytes, turns, tool calls, tokens, timeout, and queued events; cycles and concurrency overflow fail before child execution.
    - Code Quality: strict package-owned contracts, no `any`, no core changes, and one shared delegation execution path.
    - Security: parent + child + hook policies compose with logical AND; child session factory receives scope but no credentials; resource/thread IDs are package-derived; secrets are redacted before hooks/events/errors.
  - Approach:
    - Documentation Reviewed:
      - Core `Agent`, `AgentSession`, `AgentRunResult`, `AgentRunError`, `PermissionPolicy`, `RunOptions`, and event multiplexer APIs.
      - Memory `MemoryScope` tenant/resource/thread isolation contract.
    - Options Considered:
      - Accept raw child `Agent`: easy but cannot guarantee host-created memory context uses derived resource IDs.
      - Require `createSession(context)`: chosen; host receives mandatory derived scope and nested delegate callback and resolves child credentials/context at the owning boundary.
    - Chosen Approach:
      - `createSupervisor()` returns `delegate()` and bounded `subscribe()`. A per-chain context carries immutable path/depth and nested delegate callback. Clone child config through its factory, compose permission checks, pass capped `maxToolRounds`, and abort on timeout/token limit.
    - API Notes and Examples:
      ```ts
      const supervisor = createSupervisor({
        ownership: { tenantId: "t", userId: "u" },
        children: {
          research: { createSession: ({ resourceId, threadId }) => makeResearchSession(resourceId, threadId) },
        },
        limits: { maxDepth: 2, maxActiveChildren: 2, maxTokens: 20_000 },
      });
      ```
    - Files to Create/Edit:
      - `packages/supervisor/src/types.ts`, `limits.ts`, `errors.ts`, `supervisor.ts`, `index.ts`.
      - `packages/supervisor/src/__tests__/supervisor.test.ts`.
  - Test Cases to Write:
    - Success/failure/abort and before reject/modify/after hooks.
    - Nested success, cycle/depth rejection, concurrency overflow, timeout, input/turn/tool/token ceilings.
    - Exact ownership-derived memory IDs, narrowing policy, hook/event/error redaction, and credential-free child context.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional supervisor API.
    - Docs pages to create/edit: `docs/supervisors.md`, `docs/host-security.md`, `docs/working-and-semantic-memory.md`.
    - `docs/index.md` update: yes; Multi-agent entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add A2A 1.0 cards, signing, server, and explicit remote client
  - Acceptance Criteria:
    - Functional: create/sign/verify cards; serve well-known card; authorize `SendMessage` and bounded `SendStreamingMessage`; map text messages/results/errors; invoke explicit remote endpoint and verify its card when configured.
    - Performance: request/response/event/stream bytes, event count, concurrency, timeout, and card age are bounded; stream backpressure uses web streams.
    - Code Quality: package-owned minimal A2A 1.0 types and JSON-RPC mapper; no protocol SDK or server framework dependency; unsupported parts/methods fail closed.
    - Security: ES256 algorithm pinned, canonical card excludes signatures, expiry checked, tamper rejected, auth host-owned, origins allow-listed before fetch, credentials resolved after serialization, remote data redacted/validated/untrusted, abort reaches fetch/session.
  - Approach:
    - Documentation Reviewed:
      - A2A latest specification: Agent Card supported interfaces/version 1.0, well-known path, JSON-RPC `SendMessage`/`SendStreamingMessage`, SSE task updates, JWS signatures.
      - Web Crypto `subtle.sign/verify` and web-standard `Request`/`Response` already available on supported Node 20.
    - Options Considered:
      - Add A2A SDK dependency: rejected; package only needs a narrow protocol subset and dependency would dominate its size.
      - Add routes to `@arnilo/prism-server`: rejected; A2A must remain absent unless supervisor package is installed.
      - Package-owned web handler/client: chosen.
    - Chosen Approach:
      - Minimal current-version JSON-RPC binding, text parts only, task result mapping, optional SSE streaming, injectable fetch/auth, exact origin allow-list, ES256 JWS helpers using WebCrypto.
    - API Notes and Examples:
      ```ts
      const handler = createA2AHandler({ card, agents: { research: exposure }, authorize });
      const remote = createA2AClient({ endpoint, allowedOrigins: [new URL(endpoint).origin] });
      ```
    - Files to Create/Edit:
      - `packages/supervisor/src/a2a-types.ts`, `a2a-card.ts`, `a2a-server.ts`, `a2a-client.ts`.
      - `packages/supervisor/src/__tests__/a2a.test.ts`.
  - Test Cases to Write:
    - Card sign/verify, tamper, wrong algorithm/key, and expiry.
    - Well-known discovery, unauthorized/unknown agent/method, message success/failure, stream ordering and ceilings.
    - Client origin rejection before fetch, card mismatch/signature failure, auth timing, malformed/oversized response/stream, timeout/abort, remote error.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; A2A protocol API and routes.
    - Docs pages to create/edit: `docs/a2a.md`, `docs/server.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes; Interoperability entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Register/package/document the optional package and examples
  - Acceptance Criteria:
    - Functional: package is independently installable and registered in every workspace/pack/install/docs/release/example mapping; profile bundles exclude it pending Phase 14 review.
    - Performance: packed size and dependency delta are reported; no package loads or worker starts from core/profile imports.
    - Code Quality: public exports, README/changelog, API pages, migration/release docs, and runnable examples agree.
    - Security: package artifact contains no credentials/fixtures/internal tests and documentation makes auth/TLS/allow-list responsibilities explicit.
  - Approach:
    - Documentation Reviewed:
      - Existing package registration tests and `docs/release-and-install.md` publisher order.
      - Prism Wiki API page structure.
    - Options Considered:
      - Include in `prism-all`: deferred to Phase 14 size/use review, matching other new optional packages.
    - Chosen Approach:
      - Add 30th publishable package to six hardcoded registration locations and profile exclusion lists.
    - API Notes and Examples:
      ```bash
      npm install @arnilo/prism-supervisor @arnilo/prism
      ```
    - Files to Create/Edit:
      - `packages/supervisor/package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`.
      - Root workspace/package tests, `examples/tsconfig.json`, `docs/release-and-install.md`, `docs/index.md`.
      - `docs/supervisors.md`, `docs/a2a.md`, related security/memory/server/workflow docs, root README/changelog/migration/review coverage.
      - `examples/supervisor-a2a.ts`, `examples/README.md`.
  - Test Cases to Write:
    - Package build/test/typecheck/pack/import smoke and profile exclusion.
    - Example typecheck/run and docs contract checks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; all new APIs documented.
    - Docs pages to create/edit: `docs/supervisors.md`, `docs/a2a.md`, and cross-references listed above.
    - `docs/index.md` update: yes; Multi-agent and interoperability navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Validate Phase 13 and update roadmap/plan evidence
  - Acceptance Criteria:
    - Functional: complete offline local+A2A journey passes through packed public imports; existing workflow/server/core tests remain green.
    - Performance: synthetic delegation/A2A timings, all ceilings, tarball size, test count, and network-free runtime are recorded.
    - Code Quality: build, typecheck, tests, all packs, docs, examples, `git diff --check`, strict scans, and audit pass.
    - Security: full supervisor/A2A threat suite passes; no high/critical vulnerability or secret artifact appears.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 13 and release gate scripts.
    - Options Considered:
      - Live endpoint as release gate: rejected; offline conformance is authoritative, live smoke remains optional.
    - Chosen Approach:
      - Run focused checks, synthetic benchmarks, then `npm run sdk:ready` and audit; mark roadmap and plan only after success.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready && npm audit --audit-level=high
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `plans/065-supervisor-delegation-and-a2a.md`, `docs/performance.md`, `docs/review-coverage-2026-07-15.md`.
  - Test Cases to Write:
    - Existing core/workflow/server regressions plus all focused package tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no additional API; evidence/status updates only.
    - Docs pages to create/edit: `docs/performance.md`, roadmap/review coverage.
    - `docs/index.md` update: no beyond prior task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Supervisor and A2A ship together because both remain zero-runtime-dependency adapters around `AgentRunResult`/web primitives. Split only if a future protocol SDK or transport dependency would burden local delegation.
- `createSupervisor()` is an imperative bounded delegation primitive, not an LLM router or supervisor-agent loop. Hosts/models can expose `delegate()` through their own tool; deterministic workflows remain preferred for known graphs.
- Child scope isolation is enforced by unique IDs supplied to `createAgent(context)`, but host child code still constructs its own memory/context. Prism cannot prove a malicious factory did not ignore those IDs; child factories are trusted capability boundaries.
- Tool calls are denied before side effects at the exact ceiling. Token counts arrive from providers after generation, so terminal token enforcement can overshoot by one provider turn; an over-limit result is never returned.
- Delegations are in-process and non-durable. No second run/checkpoint engine, background worker, delegation transcript store, or resume protocol was added.
- A2A implements the current protocol-1.0 JSONRPC text subset only. File/data parts, push notifications, durable task get/list/cancel/resubscribe, gRPC, HTTP+JSON binding, automatic endpoint/JWK discovery, and a generic adapter zoo are absent.
- Card signing uses package-local canonical JSON + WebCrypto ES256 rather than a JOSE dependency. Trusted keys are host-provisioned; `jku` is never fetched. Replay protection beyond card expiry and request authentication remains an edge responsibility.
- Remote/live A2A endpoints are not a release gate. Offline handler/client/signature conformance is authoritative; live credential/endpoint smoke remains operator-run.
- Package remains outside all profiles pending Phase 14 size/use review.

## Further Actions
- Priority medium: run official A2A protocol conformance tooling against the packed handler/client and record any protocol-1.0 interoperability deltas before stable 1.x.
- Priority medium: add durable A2A task persistence/get/cancel/resubscribe only when a host needs long-running remote work; reuse checkpoint/lease stores rather than a new engine.
- Priority medium: add data/file artifact adapters behind explicit media limits and host loading policy if text-only interoperability becomes insufficient.
- Priority medium: add a documented tool wrapper around `Supervisor.delegate()` if multiple hosts repeat the same dynamic model-routing integration.
- Priority low: split A2A into its own package only if transport/protocol dependencies diverge from local supervisor needs.
- Priority low: add an optional host replay/idempotency adapter for A2A requests if edge gateways cannot provide it.
- Priority low: review supervisor profile inclusion during Phase 14; default remains explicit install.
