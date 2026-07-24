# Phase 8 — Release 0.0.13: Enterprise Identity, Policy, Provider Governance, and Work Connectors

## Objectives

- Extend ownership with authenticated `Principal` / `AgentIdentity` that hosts verify; propagate immutably through runs, tools, workflows, MCP, A2A, persistence, and telemetry.
- Ship optional policy-decision ledger + export hooks (allow/deny/modify/approval) without embedding a control plane or unrestricted payload store.
- Add model governance (allow-lists, residency, routing, fallback, circuit break, retries, token/cost budgets, rate limits) with attributable selection diagnostics.
- Ship direct Azure OpenAI/Foundry, AWS Bedrock, and Google Vertex adapters on host workload-identity/credential callbacks; keep 0.0.11 consumer Anthropic/Google packages separate.
- Extend `@arnilo/prism-server` with health/readiness, host auth/rate-limit adapters, graceful drain, event replay, and worker/coordinator deployment contracts (queues only if Postgres polling justifies them).
- Create `@arnilo/prism-work-tools` with separately activatable `/microsoft365` and `/google-workspace` connectors: least-privilege scopes, draft-then-approve mutations, idempotent side effects, hard-coded CLI `execFile` templates only.
- Add retention/deletion/legal-hold/export, optional host KMS/envelope encryption, extension allow-list/signature policy, and tenant quotas for persisted enterprise surfaces.
- Version, document, benchmark, and release-validate the graph as **0.0.13**.

## Expected Outcome

- Core exports authenticated identity metadata contracts and fail-closed propagation; hosts supply verifiers. Caller-asserted identity metadata is rejected.
- Optional `@arnilo/prism-policy` records redacted policy decisions and supports append-only/WORM export without storing unrestricted prompts/tool bodies.
- Optional `@arnilo/prism-model-router` selects providers under allow-list/residency/budget/rate/circuit rules and emits attributable diagnostics; OpenRouter routing metadata integrates when policy-authorized.
- `@arnilo/prism-provider-azure`, `@arnilo/prism-provider-bedrock`, and `@arnilo/prism-provider-vertex` use late-bound host credential callbacks and preserve region/private-endpoint semantics.
- Server exposes optional health/readiness/drain/replay/deployment seams over existing authorize/ownership/lease primitives; no mandatory global container.
- `@arnilo/prism-work-tools` exposes typed Outlook/Gmail/calendar/file/task tools; mutations create durable drafts first; retries use operation/draft/resource IDs + provider concurrency tokens; CLI adapters never accept model-controlled commands or credentials in argv.
- Persistence hooks cover retention, delete, legal-hold/export, optional envelope encryption, extension signature allow-lists, and tenant quotas.
- Network-free identity/policy/router/connector/deployment benchmarks, `npm run sdk:ready`, supply-chain checks, exact pack graph, and 0.0.13 publish dry-runs pass.

## Tasks

- [x] 0. Freeze Phase 8 scope, package names, primitive ownership, limits, and evidence matrix
  - Acceptance Criteria:
    - Functional: map every Phase 8 roadmap criterion to an existing primitive, minimum gap, owning task, test, docs page, and release gate; freeze package/subpath names; mark 0.0.14+ conversations/artifacts/channels/devices and 0.1.x control-plane out of scope.
    - Performance: freeze finite policy/identity overhead budgets; router attempt/budget caps; connector pagination/items/body/attachment/file/output/process/time/rate/cost ceilings; deployment ownership/fencing/failover/publish capacity limits.
    - Code Quality: inventory `OwnershipScope`, `CredentialResolver`, `PermissionPolicy`/`TrustPolicy`, `ProviderRequestPolicy`, `ProviderResolver`, guardrails/tool approval, run ledger/feedback, checkpoints/leases, `RetentionPolicy`, server `authorize`, OTel, supervisor/A2A, and command-adjacent coding-security seams; authorize only generic reusable gaps.
    - Security: record that identity is host-verified (not caller-asserted); credentials stay late-bound and never enter CLI argv/model context; M365/GWS expose only hard-coded operation templates; Teams/Planner/To Do and Docs/Sheets/Slides remain capability-gated, not universal parity.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 8, Product Boundaries, Release Order gates 6–7/11; `docs/host-security.md`, `docs/credential-storage.md`, `docs/credentials-and-redaction.md`, `docs/server.md`, `docs/workflows.md`, `docs/observability.md`, `docs/provider-request-policies.md`, `docs/provider-layer.md`, `docs/database-persistence.md`, `docs/runs-and-usage.md`, `docs/supervisors.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/web-tools.md`, `docs/review-coverage-2026-07-22-phase-7.md`.
      - Microsoft Entra Agent ID governance: <https://learn.microsoft.com/en-us/entra/id-governance/agent-id-governance-overview>; agent identity basics: <https://learn.microsoft.com/en-us/entra/agent-id/what-are-agent-identities>.
      - CLI for Microsoft 365: <https://pnp.github.io/cli-microsoft365/> (`@pnp/cli-microsoft365`).
      - Google Workspace CLI: <https://github.com/googleworkspace/cli> (`@googleworkspace/cli` / `gws`).
      - Azure OpenAI/Foundry Entra auth: <https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity>; VNet/private network: <https://learn.microsoft.com/en-us/azure/ai-services/cognitive-services-virtual-networks>.
      - AWS Bedrock IAM: <https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html>; PrivateLink: <https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html>.
      - Vertex AI auth: <https://cloud.google.com/vertex-ai/generative-ai/docs/start/authenticate>; ADC: <https://cloud.google.com/docs/authentication/application-default-credentials>.
      - `.agents/skills/create-plan/references/prism-wiki.md`; no `.agents/skills/project-patterns` or `.agents/skills/project-wiki`.
    - Options Considered:
      - Build user auth DB / control plane into Prism: rejected (product boundary).
      - Keep ownership strings as sole identity: rejected (no provenance/delegation/expiry/revocation).
      - Model-controlled generic M365/GWS commands: rejected (tenant/admin/injection/schema-drift risk).
      - Direct Graph/Workspace SDKs for every workload first: rejected until usage evidence; CLI adapters first.
      - Verified host identity/policy contracts + narrow optional packages + CLI work connectors: chosen.
    - Chosen Approach:
      - Freeze packages: core identity metadata only; `@arnilo/prism-policy`; `@arnilo/prism-model-router`; `@arnilo/prism-provider-azure`; `@arnilo/prism-provider-bedrock`; `@arnilo/prism-provider-vertex`; `@arnilo/prism-work-tools` with `./microsoft365` and `./google-workspace`.
      - Profile manifests (`prism-all` only for new optional packages); `prism-code`/`prism-sdk` stay free of work connectors and enterprise cloud SDKs.
      - Queue adapters deferred unless Task 5 Postgres polling/load evidence requires them.
      - Authorized generic gaps only: identity contracts, side-effect `IdempotencyStore`, retention/legal-hold/export/quota hooks, extension allow-list/signature policy (each ≥2 consumers).
    - API Notes and Examples:
      ```text
      packages (35 → 41 manifests at Task 10):
        @arnilo/prism-policy
        @arnilo/prism-model-router
        @arnilo/prism-provider-azure
        @arnilo/prism-provider-bedrock
        @arnilo/prism-provider-vertex
        @arnilo/prism-work-tools  (+ ./microsoft365, ./google-workspace)
      out of scope: 0.0.14 conversations/artifacts/channels/devices; Studio/control-plane; Office local executables; model-controlled CLI; default queues
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-23-phase-8.md`: criterion/primitive/limit/threat/package evidence matrix.
      - `docs/index.md`: Phase 8 review coverage under Release and install.
      - `src/__tests__/docs.test.ts`: assert freeze page, package names, scope exclusions.
      - `plans/076-release-0-0-13-enterprise-identity-policy-governance-work-connectors.md`: mark Task 0 complete only after freeze evidence lands.
    - References:
      - Current source revision: `5b21f78cde6c4f3c9e7760f153c4bd8670d104e4`.
      - Existing seams: `OwnershipScope`, `CredentialResolver`, tool approval interruptions, `RetentionPolicy`, server `authorize` → ownership, leases/fencing, web-tools subpath pattern.
  - Test Cases to Write:
    - Traceability: each Phase 8 criterion has one owner; 0.0.14+/0.1.x items have none.
    - Primitive review: every new generic core addition has ≥2 consumers; protocol/product-specific code stays package-local.
    - Boundary: no Office package/binary; no model-controlled CLI; consumer Anthropic/Google remain distinct from enterprise cloud adapters.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; freezes package graph, limits, and security boundaries for 0.0.13.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-23-phase-8.md`: scope and evidence matrix.
      - `docs/index.md`: Phase 8 review link.
    - `docs/index.md` update: yes; Release and install → Phase 8 review coverage.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-23):
    - Published `docs/review-coverage-2026-07-23-phase-8.md` freezing package names/subpaths, external Entra/CLI/cloud auth + private-endpoint URLs, primitive inventory, capability/threat/limit matrices, work-connector capability freeze, and Task 1–10 ownership.
    - Authorized only four generic gaps (identity, side-effect idempotency, retention/hold/export/quota, extension signature/allow-list). Queues, Office, auth DB, control plane, and model-controlled CLI remain out of scope.
    - Linked evidence from `docs/index.md`. Added `docs.test.ts` Phase 8 freeze regression (package tokens, deferred items, absent work-tools/azure packages, consumer provider separation).
    - `node --test --test-name-pattern "phase 8 evidence" src/__tests__/docs.test.ts` passed. No public implementation API changes in Task 0.
- [x] 1. Add authenticated `Principal` / `AgentIdentity` contracts and immutable propagation
  - Acceptance Criteria:
    - Functional: core types support tenant, sponsor/owner, delegated actor, scopes, credential references, issued/expiry, revocation; verified identity propagates through runs, tools, workflows, MCP, A2A, persistence records, and telemetry metadata without silent widening.
    - Performance: identity attach/check is O(fields) with frozen byte/field caps; no network I/O in core verification helpers.
    - Code Quality: extend `OwnershipScope` rather than invent parallel tenancy; optional packages consume the same types; no identity database in core.
    - Security: host `IdentityVerifier` is mandatory at trust boundaries; unverified/expired/revoked/wrong-tenant identities fail closed; delegation may only narrow scopes; credential refs never expand to secret material in events/ledger.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `OwnershipScope` and persistence record shapes; `docs/host-security.md`, `docs/public-contracts.md`, `docs/runs-and-usage.md`, `docs/supervisors.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/server.md`.
      - Entra Agent ID governance overview (Task 0 pinned URL).
    - Options Considered:
      - Store full JWTs on every record: payload bloat + secret leakage risk; rejected.
      - Caller-asserted identity headers without verifier: rejected.
      - Host-verified identity context + credential references + immutable propagation helpers: chosen.
    - Chosen Approach:
      - Add `Principal`, `AgentIdentity`, `IdentityVerifier`, and narrow attach/assert helpers in core (`src/identity.ts`).
      - Thread optional `identity` through `RunOptions`/`AgentConfig`/`SecureAgentOptions`/`ToolExecutionContext`, agent run start, tool dispatch, server/MCP/A2A authorize results, and workflow agent nodes.
      - Credentials remain `CredentialResolver` late-bound refs only (`credentialRefs` never expanded).
    - API Notes and Examples:
      ```ts
      const identity = await identityVerifier.verify(request);
      assertIdentityActive(identity, { now: Date.now() });
      // delegation: child.scopes ⊆ parent.scopes; tenantId immutable
      const child = narrowIdentity(identity, { scopes: ["mail.read"] });
      ```
    - Files to Create/Edit:
      - `src/identity.ts`, `src/contracts.ts`, `src/index.ts`, `src/agents.ts`, `src/tools.ts`, `src/secure-agent.ts`.
      - `packages/server`, `packages/mcp`, `packages/supervisor` (A2A), `packages/workflows`.
      - `src/__tests__/identity.test.ts`, public-export and docs tests.
      - `docs/agent-identity.md` plus cross-links in public-contracts, host-security, server, supervisors, mcp-tools, a2a, observability, index.
    - References:
      - Existing exact-owner cancellation and ownership-from-authorize patterns; Phase 8 freeze limits.
  - Test Cases to Write:
    - Expired/revoked/wrong-tenant identity rejected before tool/provider work.
    - Delegation narrows scopes; attempts to widen or change tenant fail.
    - Persistence/telemetry carry identity refs without secret material.
    - MCP/A2A/server refuse unverified identity and cross-tenant propagation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new core identity contracts and propagation rules.
    - Docs pages to create/edit:
      - `docs/agent-identity.md`: new API page.
      - `docs/public-contracts.md`, `docs/host-security.md`, `docs/server.md`, `docs/supervisors.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/observability.md`.
    - `docs/index.md` update: yes; Identity and governance → Agent identity.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-23):
    - Shipped `src/identity.ts` with `Principal`/`AgentIdentity`/`IdentityVerifier`, frozen limits, `assertIdentityActive`, `narrowIdentity`, ownership projection/match/propagation, and `identityTelemetryAttributes`.
    - Optional `identity` on run/agent/secure-agent/tool context; agent run asserts before work and injects redacted telemetry attrs; tools assert before side effects.
    - Server/MCP/A2A authorize paths validate identity↔ownership and forward into runs/tools; workflows pass identity into agent nodes.
    - Docs: `docs/agent-identity.md` + index/governance links; export contract + identity tests green (`dist/__tests__/identity.test.js` 6/6). Related server/mcp/a2a ownership tests still pass.

- [x] 2. Ship optional policy-decision ledger and audit export
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-policy` records allow/deny/modify/approval with policy version, actor, target, reason, expiry, and evidence references; hosts can export to append-only/WORM without unrestricted payloads.
    - Performance: evaluate/append paths bounded by frozen decision/evidence byte caps; export is cursor-paginated.
    - Code Quality: one reference in-memory/file ledger adapter; WORM/KMS remain host-replaceable seams; integrates with existing guardrail/permission/tool-approval decisions.
    - Security: ledger stores redacted/evidence refs only; policy version mismatches fail closed; approvals remain attributable to verified identity.
  - Approach:
    - Documentation Reviewed:
      - `docs/guardrails.md`, `docs/runs-and-usage.md`, `docs/host-security.md`, Task 1 identity contracts.
      - Existing `GuardrailDecision`, permission assert, tool_approval interruption shapes.
    - Options Considered:
      - Mandatory global policy engine: rejected.
      - Reuse RunLedger alone for policy: mixes concerns and lacks decision schema; rejected.
      - Optional narrow policy package over identity + existing decision points: chosen.
    - Chosen Approach:
      - `PolicyEvaluator` + `PolicyDecisionRecord` + `PolicyDecisionStore` + `exportPolicyDecisions` in `@arnilo/prism-policy`.
      - Optional `recordGuardrailDecision` / `recordPermissionDecision` / `recordToolApprovalDecision` bridges; no mandatory core wiring.
      - Memory + JSONL file reference adapters; host supplies real WORM/KMS sink.
    - API Notes and Examples:
      ```ts
      const decision = await policy.evaluate({ identity, action, resource, context });
      await ledger.append(decision); // redacted; evidenceRef only
      for await (const page of exportPolicyDecisions(store, { cursor, limit })) { /* WORM sink */ }
      ```
    - Files to Create/Edit:
      - `packages/policy/**` (package.json, src, tests, README, CHANGELOG).
      - Root workspace entry `packages/policy` (prism-all enrollment still Task 10).
      - `docs/policy-and-audit.md` + index/host-security/guardrails/runs-and-usage links; `docs.test.ts` apiPages.
    - References:
      - Run feedback immutability/delete pattern; Phase 8 freeze limits; Task 1 identity.
  - Test Cases to Write:
    - Allow/deny/modify/approval attribution and policy-version change behavior.
    - Audit immutability and export pagination; unrestricted payload rejection.
    - Missing identity/evidence fails closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional policy/audit package.
    - Docs pages to create/edit:
      - `docs/policy-and-audit.md`.
      - Cross-links from `docs/host-security.md`, `docs/guardrails.md`, `docs/runs-and-usage.md`.
    - `docs/index.md` update: yes; Identity/governance → Policy and audit.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-23):
    - Shipped `@arnilo/prism-policy` with evaluator, `preparePolicyDecision`, memory + JSONL file stores, cursor `exportPolicyDecisions`, and guardrail/permission/tool-approval record helpers.
    - Frozen caps enforced; unrestricted payload keys and policy-version mismatch fail closed; actor refs from verified identity only.
    - Docs: `docs/policy-and-audit.md` + governance index link. Package tests 5/5 green; docs api-pages include policy page.

- [x] 3. Add model governance router (allow-list, residency, budgets, fallback, circuits)
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-model-router` supports allow-lists, provider/region/data-residency policy, routing, fallback, circuit breaking, retries, token/cost budgets, rate limits, and attributable selection diagnostics; OpenRouter routing metadata participates only under policy.
    - Performance: bounded attempt/fallback count and selection latency; circuit/rate state memory capped per identity/model key.
    - Code Quality: wraps existing `ProviderResolver` / `ProviderRequestPolicy`; no second provider runtime; diagnostics redacted.
    - Security: residency/allow-list denies fail closed; cost/token budget exhaustion stops routing; secrets never appear in diagnostics.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-layer.md`, `docs/provider-request-policies.md`, `docs/providers/openrouter.md`, `packages/provider-openrouter/README.md`, Task 0 limits.
    - Options Considered:
      - Hard-code routing inside each provider package: rejected.
      - Mandatory router for all hosts: rejected.
      - Optional router over resolver + request policies with diagnostics: chosen.
    - Chosen Approach:
      - `createModelRouter({ resolver, allowList, allowedResidencies, budgets, rateLimit, circuit, fallbacks, allowOpenRouterRouting })` wraps `ProviderResolver`.
      - Rich `resolve()` plus sync `providerSource`; returns chainable OpenRouter gate `ProviderRequestPolicy`.
      - Optional `onDiagnostics` for Task 2 policy ledger hooks.
    - API Notes and Examples:
      ```ts
      const provider = await router.resolve({
        model,
        identity,
        residency: "eu",
        maxCostUsd: 0.25,
      });
      ```
    - Files to Create/Edit:
      - `packages/model-router/**`.
      - Root workspace `packages/model-router` (prism-all still Task 10).
      - `docs/model-routing.md` + openrouter / provider-packages / provider-request-policies / index links; docs.test apiPages.
    - References:
      - Existing provider request policy chain and OpenRouter `openRouterRouting` compat fields; Phase 8 freeze limits.
  - Test Cases to Write:
    - Outage/fallback/circuit/retry/budget/residency/rate-limit matrix.
    - Allow-list miss and residency miss deny without calling provider.
    - Diagnostic redaction; OpenRouter metadata honored only when policy permits.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional router package and diagnostics.
    - Docs pages to create/edit:
      - `docs/model-routing.md`.
      - `docs/providers/openrouter.md`, `docs/provider-packages.md`, `docs/provider-request-policies.md`.
    - `docs/index.md` update: yes; Model routing entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-23):
    - Shipped `@arnilo/prism-model-router` with allow-list/residency/budget/rate/circuit/fallback selection, redacted diagnostics, OpenRouter routing gate policy, and `providerSource` facade.
    - Allow-list/residency denies never call underlying resolver; attempts capped 3/8; circuit keys capped with oldest eviction.
    - Docs: `docs/model-routing.md` + governance index link. Package tests 5/5 green.

- [x] 4. Ship Azure OpenAI/Foundry, AWS Bedrock, and Google Vertex enterprise adapters
  - Acceptance Criteria:
    - Functional: three optional packages use host workload identity/credential callbacks; preserve region/private-endpoint semantics; remain separate from `@arnilo/prism-provider-anthropic` / `@arnilo/prism-provider-google` consumer packages.
    - Performance: bounded retries/timeouts; no credential prefetch at import; discovery caller-gated like other providers.
    - Code Quality: reuse shared OpenAI-compatible / provider package patterns where protocol allows; cloud-specific auth stays package-local.
    - Security: no static credentials in fixtures; mocks for workload identity; live canaries credential-gated; errors redacted.
  - Approach:
    - Documentation Reviewed:
      - Task 0 pinned Azure/AWS/Vertex workload-identity and regional endpoint docs.
      - `docs/providers/openai-compatible.md`, `docs/provider-conformance.md`, `docs/provider-packages.md`, existing anthropic/google package boundaries.
    - Options Considered:
      - Fold enterprise cloud into consumer Anthropic/Google packages: rejected (identity semantics differ).
      - One mega enterprise-cloud package: hides distinct auth/region models; rejected.
      - Three narrow provider packages + host credential callbacks: chosen.
    - Chosen Approach:
      - `@arnilo/prism-provider-azure`, `@arnilo/prism-provider-bedrock`, `@arnilo/prism-provider-vertex` wrap `createOpenAICompatibleProvider` with cloud URL/auth.
      - Core adds `chatCompletionsUrl` + `authStyle` on openai-compatible for Azure deployment paths / api-key.
      - Bedrock: host IAM creds + package-local SigV4 (no AWS SDK); Vertex: host ADC bearer; Azure: Entra bearer or api-key.
    - API Notes and Examples:
      ```ts
      createAzureOpenAIProviderPackage({
        endpoint,
        deployment,
        credential: hostWorkloadCredential, // late-bound
        apiVersion,
      });
      ```
    - Files to Create/Edit:
      - `packages/provider-azure/**`, `packages/provider-bedrock/**`, `packages/provider-vertex/**`.
      - `src/providers/openai-compatible.ts` (`chatCompletionsUrl`, `authStyle`).
      - `docs/providers/azure.md`, `bedrock.md`, `vertex.md`, index/provider-packages/openai-compatible/credential-storage/migration/google cross-links; docs.test providerPackagePages + Phase 8 existence asserts.
    - References:
      - Provider conformance harness and OpenAI-compatible transport where applicable; Phase 8 freeze.
  - Test Cases to Write:
    - Workload-identity mocks; missing credential fails closed.
    - Region/private-endpoint configuration preserved on requests.
    - Conformance suite + opt-in live canaries (no secrets in repo).
    - Consumer Anthropic/Google packages unchanged in auth registration.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; three new provider packages.
    - Docs pages to create/edit:
      - `docs/providers/azure.md`, `docs/providers/bedrock.md`, `docs/providers/vertex.md`.
      - `docs/provider-packages.md`, `docs/credential-storage.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; Providers section entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-23):
    - Shipped three packages with host credential callbacks; private/custom endpoints preserved; consumer Anthropic/Google unchanged.
    - Azure Entra/api-key, Bedrock SigV4 OpenAI-compatible runtime, Vertex ADC OpenAPI route. Package tests 3/3 each green.
    - Docs + index/governance provider links; Phase 8 docs test now asserts packages exist.
- [x] 5. Extend server deployment seams (health, drain, auth/rate-limit adapters, worker/coordinator)
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-server` exposes health/readiness, host auth/rate-limit adapters, graceful drain, event replay, and worker/coordinator deployment contracts over existing leases/ownership; queue adapters added only if PostgreSQL polling/load measurements justify them.
    - Performance: health checks are O(1)/bounded; drain stops new admits within frozen deadline; multi-process ownership/fencing/failover tests pass.
    - Code Quality: adapters are optional and host-owned; no embedded listener/container orchestrator.
    - Security: health endpoints reveal no secrets/tenant data by default; drain/replay require authorize + ownership; rate-limit denials attributable.
  - Approach:
    - Documentation Reviewed:
      - `docs/server.md`, `packages/server/src/handler.ts`, lease/checkpoint docs, Postgres persistence load notes from prior phases.
    - Options Considered:
      - Bundle Redis/SQS queue always: rejected until evidence.
      - Host-only health outside Prism: loses shared contract; rejected for optional seams.
      - Optional health/drain/replay/deployment helpers on existing handler: chosen.
    - Chosen Approach:
      - Separate `createPrismHealthHandler` / `createPrismDrainController` / `createPrismEventReplay` / `createPrismDeploymentLease`; wire optional `drain` + `rateLimit` on `createPrismHandler`.
      - Queues deferred: no measured Postgres polling bottleneck; keep `createWorkflowCoordinator` poll path.
    - API Notes and Examples:
      ```ts
      const drain = createPrismDrainController();
      const handler = createPrismHandler({ authorize, agents, drain, rateLimit });
      const health = createPrismHealthHandler({ ready: () => store.ping(), drain });
      ```
    - Files to Create/Edit:
      - `packages/server/src/{drain,health,rate-limit,replay,deployment}.ts`, handler/types/limits/index, tests, README/CHANGELOG.
      - `docs/server.md`, `docs/performance.md`, `docs/migration.md`, `docs/index.md`, Phase 8 evidence queue deferral.
      - `examples/server-deployment-seams.ts`.
    - References:
      - Existing authorize/ownership/SSE/resume routes; workflow lease fencing; Phase 8 freeze limits.
  - Test Cases to Write:
    - Multi-process failover/drain/replay with fencing.
    - Unauthorized health detail and replay denial.
    - Rate-limit adapter short-circuit before session create.
    - Queue adapter absent by default; present only if Task evidence adds it.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional server deployment surfaces.
    - Docs pages to create/edit:
      - `docs/server.md` (expand deployment section).
      - `docs/performance.md` capacity notes.
    - `docs/index.md` update: yes; Server entry text refresh.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-23):
    - Health/livez/readyz + detail auth; drain admit 503; rate-limit 429+Retry-After; ownership-scoped redacted replay; deployment lease fencing.
    - Queues deferred (no Redis/SQS); recorded in Plan Compromises + Phase 8 evidence page.
    - Server tests 13/13 green (9 handler + 4 deployment).

- [x] 6. Persistence retention, legal-hold/export, optional KMS, extension policy, tenant quotas
  - Acceptance Criteria:
    - Functional: retention, deletion, legal-hold/export hooks, optional host KMS/envelope encryption, extension allow-list/signature policy, and tenant-level quotas apply to persisted prompts, memory, checkpoints, feedback, work artifacts, connector operations, and audit records.
    - Performance: retention sweeps and quota checks are bounded/paginated; encryption envelope sizes reuse credentials-node limits where applicable.
    - Code Quality: extend existing `RetentionPolicy` / store contracts; one reference adapter path; KMS remains host callback.
    - Security: legal-hold blocks delete; unsigned/unallowlisted extensions fail closed; quota exhaustion fails closed; encryption keys never logged.
  - Approach:
    - Documentation Reviewed:
      - `docs/database-persistence.md`, `docs/postgres-persistence.md`, `docs/credential-storage.md`, `packages/credentials-node` envelope helpers, `docs/extensions.md`, Task 2 audit store.
    - Options Considered:
      - Mandatory encryption for all stores: rejected (host chooses).
      - Soft-delete only without legal-hold: insufficient; rejected.
      - Hooked retention/hold/export + optional envelope + extension signature allow-list + quotas: chosen.
    - Chosen Approach:
      - Expand persistence contracts with `lifecycle`; enforce in memory + SQLite + Postgres (schema v5); JSONL remains without lifecycle.
      - Extension kernel checks host allow-list/signature policy before contribution activation.
    - API Notes and Examples:
      ```ts
      await store.applyRetention(policy);
      await store.putLegalHold({ identity, resourceIds, reason });
      await store.exportUnderHold({ identity, cursor, limit }); // redacted
      ```
    - Files to Create/Edit:
      - `src/contracts.ts` retention/hold/quota types as needed.
      - `packages/session-store-postgres/**`, conformance tests, optional credentials-node KMS callback glue.
      - `src/extensions.ts` allow-list/signature policy hooks.
      - Docs: persistence/retention pages, `docs/extensions.md`, `docs/host-security.md`.
    - References:
      - Existing `RetentionPolicy`, feedback `delete()`, credentials-node envelope crypto.
  - Test Cases to Write:
    - Retention/delete vs legal-hold precedence; export pagination.
    - Encryption key rotation with host KMS mock.
    - Unsigned extension denial; tenant quota contention.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; persistence/extension lifecycle surfaces.
    - Docs pages to create/edit:
      - Persistence/retention pages, `docs/extensions.md`, `docs/credential-storage.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; Persistence/Extensions/Security text refresh.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-23):
    - Core `PersistenceLifecycleStore` + memory adapter; SQLite/Postgres schema v5 + `persistence.lifecycle`.
    - Hold blocks retention delete; redacted export; tenant quota fail-closed; extension `loadPolicy`; host KMS wrap in credentials-node.
    - Tests: persistence-lifecycle + extension policy; sqlite lifecycle; credentials KMS round-trip.

- [x] 7. Create `@arnilo/prism-work-tools` shared contracts and Microsoft 365 connector
  - Acceptance Criteria:
    - Functional: package root + `./microsoft365` provide identity-scoped Outlook search/read/draft/send, calendar, OneDrive/SharePoint file, and task tools; Teams/Planner/To Do capability-gated; mutations draft-then-approve; idempotent via operation/draft/resource IDs + concurrency tokens.
    - Performance: finite pagination/items/body/attachment/file/output/process/time/rate/cost limits; process kill on timeout/abort.
    - Code Quality: hard-coded typed `execFile` argv templates only; shared result shapes prepared for GWS parity; mirrors `@arnilo/prism-web-tools` subpath pattern.
    - Security: no model-controlled command, generic Graph request, login, tenant-admin, debug, or credential-store access; least-privilege scopes; isolated per-identity CLI config dirs; external recipient/share policy fail closed; credentials never in argv.
  - Approach:
    - Documentation Reviewed:
      - CLI for Microsoft 365 auth/JSON/Outlook/OneDrive/SharePoint/Teams/Planner/To Do docs (Task 0 pins).
      - `packages/web-tools` layout; Task 1–2 identity/policy; coding-security command allow-list lessons.
    - Options Considered:
      - Full Graph SDK client now: rejected (maintenance before evidence).
      - Shell string concatenation for CLI: rejected (injection).
      - Host-pinned binary + typed argv templates + fake executable tests: chosen.
    - Chosen Approach:
      - `createMicrosoft365CliAdapter({ binary, identity, configDir, allowedOps })` + read vs mutation tool bundles.
      - Startup version/schema validation; JSON/NDJSON strict parse; no cross-identity fallback.
    - API Notes and Examples:
      ```ts
      const workTools = createWorkTools({
        microsoft365: createMicrosoft365CliAdapter({ binary: m365, identity }),
        approval,
        idempotencyStore,
      });
      ```
    - Files to Create/Edit:
      - `packages/work-tools/**` (index, microsoft365, types, limits, fake CLI fixtures, tests, README).
      - `docs/work-tools.md`, `docs/work-connectors.md` (M365 sections; GWS TBD in Task 8).
    - References:
      - Web-tools transport/limits/normalize pattern; durable tool approval interruption.
  - Test Cases to Write:
    - Fake M365 executable: argv injection denial, version/schema drift, malformed/oversized JSON/NDJSON, debug/telemetry denial, timeout/abort/kill, pagination, isolated config, least scopes, absent credential.
    - Outlook search/read/draft/approved-send; calendar list/create/update; file search/read/upload/move/share; task list/create/complete.
    - Duplicate retry/idempotency; stale ETag; external recipient/share denial; attachment limits/scanning.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new work-tools package and M365 subpath.
    - Docs pages to create/edit:
      - `docs/work-tools.md`, `docs/work-connectors.md`.
      - `docs/host-security.md`, `docs/tools.md` cross-links.
    - `docs/index.md` update: yes; Work connectors entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-23):
    - Package `@arnilo/prism-work-tools` + `./microsoft365`; hard-coded PnP CLI argv (`outlook message/mail`, `outlook event`, `file`, `spo file sharinglink`, gated `todo`/`planner`).
    - Draft-then-approve mutations; memory `IdempotencyStore`; isolated `configDir`; forbidden login/debug/anonymous share; external recipient fail-closed.
    - Docs: `docs/work-tools.md`, `docs/work-connectors.md`; tests with fake CLI runner.

- [x] 8. Add Google Workspace connector subpath and shared M365/GWS result parity
  - Acceptance Criteria:
    - Functional: `./google-workspace` provides identity-scoped Gmail search/read/draft/send, Calendar, Drive files, and tasks; Docs/Sheets/Slides capability-gated; same draft-then-approve and idempotency rules as M365; public common-denominator result shapes shared without hiding provider-specific capabilities.
    - Performance: same finite connector ceilings as Task 7; NDJSON page streams strictly parsed.
    - Code Quality: hard-coded `gws` argv templates; no Discovery free-form model calls; shared types in package root.
    - Security: identical fail-closed rules as M365; isolated per-identity config; no login/debug/credential argv.
  - Approach:
    - Documentation Reviewed:
      - Google Workspace CLI Discovery/JSON/NDJSON/dry-run/auth/Gmail/Calendar/Drive docs (Task 0 pins).
      - Task 7 shared contracts and fake-CLI harness.
    - Options Considered:
      - Separate `@arnilo/prism-google-workspace` package: premature split; rejected until adoption evidence.
      - Subpath on `@arnilo/prism-work-tools` with shared shapes: chosen (roadmap Product Boundaries).
    - Chosen Approach:
      - `createGoogleWorkspaceCliAdapter` parallel to M365; map to shared mail/calendar/file/task result types; capability flags for Docs/Sheets/Slides.
    - API Notes and Examples:
      ```ts
      createWorkTools({
        googleWorkspace: createGoogleWorkspaceCliAdapter({ binary: gws, identity }),
        approval,
        idempotencyStore,
      });
      ```
    - Files to Create/Edit:
      - `packages/work-tools/src/google-workspace.ts` (+ tests/fixtures), package exports.
      - Docs updates to `docs/work-tools.md`, `docs/work-connectors.md`.
    - References:
      - Task 7 adapter/idempotency/approval patterns.
  - Test Cases to Write:
    - Fake GWS executable suite mirroring Task 7 adversarial cases.
    - Gmail/Calendar/Drive/Tasks happy paths + idempotency + stale precondition + external share denial.
    - Capability mismatch for Docs/Sheets/Slides when ungated.
    - Shared result-shape contract tests across M365/GWS mappers.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new GWS subpath and shared shapes.
    - Docs pages to create/edit:
      - `docs/work-tools.md`, `docs/work-connectors.md` (complete both providers).
    - `docs/index.md` update: yes if Task 7 left placeholders.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-24):
    - `./google-workspace` hard-coded `gws` argv (gmail list/get/+send, calendar events list/insert, drive files/permissions, tasks; gated docs/sheets/slides).
    - Shared normalizers (`normalize.ts`) for mail/calendar/file/task parity; strict `parseCliNdjson` for `--page-all`.
    - Forbidden `auth`/`schema`/anyone share; draft-then-approve + shared IdempotencyStore; docs + package tests.

- [x] 9. Complete docs, examples, migration notes, package metadata, and index navigation
  - Acceptance Criteria:
    - Functional: docs cover identity, policy/audit, model routing, cloud providers, server deployment, persistence lifecycle, and work connectors; examples compile and run network-free with fakes.
    - Performance: all frozen identity/policy/router/connector/deployment caps documented with benchmark command placeholders.
    - Code Quality: API pages follow Prism wiki structure; package READMEs match packed exports; 0.0.14 deferrals explicit.
    - Security: docs require host verification, least-privilege scopes, draft-then-approve, no credential-in-argv, residency/retention fail-closed.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; existing security/provider/server/persistence pages; Tasks 1–8 APIs.
    - Options Considered:
      - Scatter enterprise guidance only into host-security: poor discoverability; rejected.
      - Canonical identity/policy/routing/work-connector pages plus cross-links: chosen.
    - Chosen Approach:
      - Finish wiki-structured pages listed in roadmap Documentation/Wiki Assessment; add fake identity/policy/work-tools examples.
      - Document 0.0.12 → 0.0.13 migration (additive optional packages; ownership still valid; identity verifier required at new seams).
    - API Notes and Examples:
      ```ts
      // Canonical docs include:
      identityVerifier.verify(...)
      policy.evaluate(...)
      router.resolve(...)
      createWorkTools({ microsoft365, googleWorkspace, approval, idempotencyStore })
      createPrismHealthHandler(...)
      ```
    - Files to Create/Edit:
      - `docs/agent-identity.md`, `docs/policy-and-audit.md`, `docs/model-routing.md`, `docs/work-tools.md`, `docs/work-connectors.md`.
      - Provider cloud pages; `docs/host-security.md`, `docs/credential-storage.md`, `docs/server.md`, persistence/retention, `docs/migration.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/index.md`.
      - Package READMEs/CHANGELOGs; `examples/*` network-free demos; `src/__tests__/docs.test.ts`.
    - References:
      - Roadmap Phase 8 Documentation/Wiki Assessment list.
  - Test Cases to Write:
    - Docs tests assert package/subpath names, caps, security invariants, migration version.
    - Examples typecheck and fake runs succeed offline.
    - Link/export/package README assertions pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; publishes complete usage/security/migration guidance.
    - Docs pages to create/edit: all paths listed above.
    - `docs/index.md` update: yes; add Identity/governance, Model routing, Work connectors; refresh Security, Providers, Server, Persistence, Credentials, Observability.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-24):
    - Migration/performance/release/index: 0.0.13 identity/policy/router/work-connector guidance; 41-package graph; `benchmark-0.0.13.mjs` placeholder; 0.0.14 deferrals explicit.
    - Network-free examples: `enterprise-identity.ts`, `enterprise-policy-audit.ts`, `enterprise-work-connectors.ts`; `server-deployment-seams.ts` indexed in examples README.
    - Docs test: publishable count 41; Task 9 regression for migration tokens + enterprise examples.

- [x] 10. Version graph to 0.0.13, benchmark enterprise paths, and run release validation
  - Acceptance Criteria:
    - Functional: all publishable manifests, internal ranges, lockfile, profile/package/install/export guards, and changelogs target `0.0.13`; new packages enrolled per Task 0 freeze (`prism-all` inclusion rules honored); roadmap Phase 8 marked complete only after gates pass.
    - Functional: `npm run sdk:ready` passes; packed offline consumer tests pass; restricted live canaries remain operator-gated.
    - Performance: `scripts/benchmark-0.0.13.mjs` reports identity/policy/router/connector/deployment overhead against frozen budgets; package/install deltas recorded.
    - Code Quality: publishable package count matches freeze matrix; no 0.0.14 conversation/artifact/channel scope or Office packaging enters the graph.
    - Security: audit, SBOM/license, tracked/tarball secret scans, dependency review inputs, exact dependency graph, tarball review, `git diff --check`, and connector hostile-input fixtures pass.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, roadmap gates, Plan 075 Task 8 command matrix, Task 0 freeze count.
    - Options Considered:
      - Auto-tag/publish: requires operator OIDC; rejected.
      - Exact graph bump + network-free matrix + dry-run publish only: chosen.
    - Chosen Approach:
      - Bump 0.0.13 graph; run sdk:ready, Node 20 compat, packs, benchmark, supply-chain, release check/publish dry-run.
      - Record evidence in this plan and `roadmap.md`; stop before commit/tag/publication unless separately authorized.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      node scripts/benchmark-0.0.13.mjs
      npm audit --audit-level=high
      git diff --check
      npm run release:check -- --version 0.0.13 --allow-dirty --allow-untagged
      npm run release:publish -- --version 0.0.13 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - Root and workspace `package.json` versions/ranges; lockfile; profile manifests.
      - `scripts/benchmark-0.0.13.mjs`; `docs/performance.md`, `docs/release-and-install.md`.
      - `roadmap.md` Phase 8 completion evidence; this plan Task 10 evidence.
    - References:
      - Prior 0.0.12 release validation pattern (Plan 075 Task 8).
  - Test Cases to Write:
    - Exact package count/export/install guards for 0.0.13 graph.
    - Benchmark schema + budget assertions (network-free).
    - Secret scan clean on packed tarballs; connector fakes have no real credentials.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release graph and install docs.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`, `docs/performance.md`, `docs/migration.md`, `roadmap.md`.
    - `docs/index.md` update: yes; Release entry to 0.0.13 / Phase 8 evidence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Task 5: no Redis/SQS/queue adapter. No measured Postgres checkpoint-polling bottleneck; hosts keep `createWorkflowCoordinator` poll path. Revisit only with load evidence.

## Further Actions
- Add queue adapter only after recorded Postgres polling/load measurement justifies it (update Phase 8 evidence + this plan).
- Remaining Phase 8 tasks (6–11) unchanged.
  - Completion Evidence (2026-07-24):
    - Graph bumped to **0.0.13** (41 manifests); `@arnilo/prism-all` enrolls policy/model-router/enterprise providers/work-tools.
    - `scripts/benchmark-0.0.13.mjs` + schema test; `npm run sdk:ready`; `release:check` / `release:publish --dry-run --allow-dirty --allow-untagged` for 0.0.13.
    - Roadmap Phase 8 marked complete; signed tag/publication remain operator prerequisites.
