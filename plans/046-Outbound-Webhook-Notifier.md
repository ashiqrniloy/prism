# 046 — Outbound Webhook Notifier Seam

Adoption-list item #7 (LangSmith webhooks, CrewAI AMP event streaming).
Roadmap phase: **0.3.x**.
Baseline: `@arnilo/prism-server` **0.3.0**.
Target: a small `WebhookNotifier` in `@arnilo/prism-server` — host-registered outbound URLs receiving signed, filtered lifecycle events (run/workflow completed, failed, suspended-for-approval), with bounded retries, DNS-pinned fetch, and deny-by-default egress semantics.

## Objectives

- Let hosts wire agent/workflow outcomes into external systems (PagerDuty, Slack, Next services) without bespoke code, through a Prism-native, signed, bounded notifier.
- Reuse proven primitives: core `pinnedFetch` (DNS pinning, redirect re-validation), audit-export HMAC/signing patterns, egress-policy deny-by-default posture.
- No new package: the notifier belongs in `@arnilo/prism-server` (the outbound companion of its inbound routes).

## Expected Outcome

- Hosts register URLs + event filters; on run/workflow terminal or suspension events, Prism POSTs a bounded, redacted, HMAC-signed JSON envelope; consumers verify the signature.
- Deliveries are at-least-once with bounded retries and visible failure records (no silent drops, no exactly-once claim).
- No listener, no network activity unless the host explicitly registers an endpoint (explicit activation preserved).

## Tasks

- [x] Task 1 — Primitive Review and Notifier Contract
  - Acceptance Criteria:
    - Functional: inventory `src/pinned-fetch.ts` (`pinnedFetch` — DNS-pinned, redirects rejected), `packages/policy` audit signing (canonical signed-manifest precedent), `packages/server/src/` handler/event seams (where run/workflow lifecycle events are observable), `packages/coding-security/src/egress` (deny-by-default policy shapes). Contract: `createWebhookNotifier({ targets, signer, redactor, limits })` with `notify(event)` and a host-facing subscription wiring (server handler adapter + workflow event-bus adapter documented).
    - Performance: delivery off the critical path (fire-and-forget with bounded queue); event queue bounded (frozen cap, drop-oldest rejected → drop-newest with visible counter — decide and freeze).
    - Code Quality: pure envelope builder (testable); no `fetch` outside `pinnedFetch`.
    - Security: URLs host-registered only; private/metadata IP targets rejected (reuse egress policy logic); payloads redacted through host `redactor` before signature; HMAC key host-supplied, never logged.
  - Approach:
    - Documentation Reviewed:
      - `src/pinned-fetch.ts`, `docs/audit-export.md` (HMAC/signature envelope patterns), `packages/coding-security/src/egress/policy.ts`, `docs/server.md`, `docs/workflows.md` (event bus).
    - Options Considered:
      - New package `@arnilo/prism-webhooks`: rejected — the server package already owns the HTTP boundary and the egress posture; one more package for ~200 lines splits review surface.
      - Generic pub/sub adapter: rejected — YAGNI; targets are HTTP webhooks.
      - `WebhookNotifier` in `@arnilo/prism-server`: chosen.
    - Chosen Approach:
      - Notifier module + wiring adapters; envelope: `{ id, event, runId?, workflowRunId?, status, redactedPayload, timestamp }` signed with HMAC-SHA-256 (`X-Prism-Signature: sha256=<hex>`), timestamp header for replay protection.
    - API Notes and Examples:
      ```ts
      import { createWebhookNotifier } from "@arnilo/prism-server";
      const notifier = createWebhookNotifier({
        targets: [{ url: "https://ops.example/hook", events: ["run.failed", "workflow.suspended"] }],
        signer: { key: hostHmacKey }, redactor, limits: { retries: 3, timeoutMs: 5_000 },
      });
      serverHandler.onLifecycleEvent(notifier.notify); // or workflow bus wiring
      ```
    - Files to Create/Edit:
      - `packages/server/src/webhooks.ts` (new notifier, envelope/signature helpers, event adapters, bounded single-attempt queue), `packages/server/src/index.ts` (export).
      - `packages/server/src/__tests__/webhooks.test.ts` (redaction/signature, registration SSRF, queue-overflow coverage).
      - `docs/server.md`, `docs/index.md` (API contract, wiring, trust boundary, navigation).
  - Test Cases to Write:
    - Completed: envelope redaction precedes HMAC signing; the host verifier accepts the body and rejects a tampered body.
    - Completed: private-IP and metadata targets fail at registration; the shared `pinnedFetch` suite covers redirect rejection and runtime DNS pinning.
    - Completed: a full queue drops newest delivery and exposes `diagnostics().dropped`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new server-package export.
    - Docs pages to create/edit: `docs/server.md` — "Outbound webhooks" section (full API-page structure sections).
    - `docs/index.md` update: yes — Server/API entry description extended.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion:
    - Reviewed `pinnedFetch` (public-address DNS pinning and all-redirect rejection), server direct/session and workflow `onEvent` seams, workflow event bus, and egress deny defaults. Added the server-local HMAC notifier with required redaction, host-registered HTTPS targets, bounded drop-newest queue/diagnostics, and documented session-factory/workflow-event wiring. Retries and durable failure records remain Task 2.

- [x] Task 2 — Retries, Failure Records, and Diagnostics
  - Acceptance Criteria:
    - Functional: at-least-once delivery with bounded exponential retries (frozen caps); terminal failure recorded as bounded diagnostics (`prism.webhook.failed` counters, last error redacted); no retry storm (cap + jitter documented).
    - Performance: retry queue bounded; notifier adds zero latency to the emitting path (enqueue + background flush).
    - Code Quality: delivery state machine typed; abort-aware (session/run abort cancels pending deliveries for that run).
    - Security: retry target re-pinned per attempt; 4xx (except 429) → no retry (permanent failure), 5xx/429/network → retry within caps.
  - Approach:
    - Documentation Reviewed: `src/retry.ts` (existing retry policy shapes), `docs/observability.md` (metrics/diagnostics patterns).
    - Options Considered: durable delivery queue (outbox): rejected for v1 — at-least-once with in-memory bounded queue + visible failure counters; durable outbox documented as the upgrade path if hosts need cross-restart delivery (`ponytail:` comment).
    - Chosen Approach: bounded in-memory queue, documented ceiling.
    - API Notes and Examples: response classification per RFC-idiomatic retry semantics.
    - Files to Create/Edit: `packages/server/src/webhooks.ts` (typed retry state machine, abort-aware queue removal, bounded redacted failure records), `packages/server/src/__tests__/webhooks.test.ts` (network-free retry-state coverage), `packages/server/src/index.ts` (new public diagnostic/delivery option types), `docs/server.md`.
  - Test Cases to Write:
    - Completed: network-free typed state-machine test: 500-then-200 yields one success after one retry; 400 is terminal with no retry; error text is redacted.
    - Completed: abort during a deterministic zero-jitter backoff cancels the pending delivery; retry cap remains bounded.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — retry/diagnostics behavior.
    - Docs pages to create/edit: `docs/server.md` webhooks section (limits/failure table).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion:
    - Reused core `createDefaultRetryPolicy`/`waitForRetry`: three retries after the initial attempt by default (hard cap 10), exponential 100 ms–5 s waits (30 s hard), and ±25% jitter. `pinnedFetch` remains inside every attempt. Added terminal-only `failed`/`prism.webhook.failed` diagnostics, a 32-record (256 hard) redacted failure ring, optional delivery abort signal, and the documented in-memory-outbox ceiling.
    - Passed `npm --workspace @arnilo/prism-server run typecheck`, package build/tests (89), Biome, and docs tests (146).

- [x] Task 3 — Conformance, Threat-Suite Leg, and Release
  - Acceptance Criteria:
    - Functional: server package tests cover registration validation, signature verification, egress denial, retry matrix; `security:threat-suites` gains a webhooks leg (SSRF shapes: private targets, redirects, DNS rebinding via the pinned-fetch fixtures).
    - Performance: no measurable overhead on agent routes when no notifier registered.
    - Code Quality: additive-only export; independent version bump per Decision B.
    - Security: key never in events/logs/telemetry (secret-scan fixture); URLs validated https-only by default (http opt-in documented for local dev).
  - Approach:
    - Documentation Reviewed: `docs/host-security.md` (remote-boundary checklist), `packages/coding-security/src/__tests__/egress.test.ts` (SSRF fixtures to reuse).
    - Options Considered / Chosen Approach: reuse existing egress fixtures; independent bump.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `packages/server/src/__tests__/webhooks.test.ts`, `security/` threat-suite registration, `docs/host-security.md` entry.
  - Test Cases to Write:
    - Completed: SSRF matrix green (registration rejects public HTTP, private, and metadata targets; loopback HTTP needs explicit `allowLoopbackHttp`); secret-scan clean on fixtures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — security surface.
    - Docs pages to create/edit: `docs/host-security.md`, `docs/server.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion:
    - Added `scripts/phase46-webhooks-security.test.mjs` (built-public-entrypoint blockers: registration SSRF, pinned-resolution rebinding rejection, redirect rejection, gate accounting) and registered the leg plus the existing package (`packages/server/dist/__tests__/webhooks.test.js`) and core pinned-fetch (`dist/__tests__/pinned-fetch.test.js`) fixtures in `security:threat-suites` — no fixture rewrite. Added `allowLoopbackHttp` (opt-in loopback HTTP for local dev receivers; HTTPS/public/SSRF registration unchanged) with tests for public-HTTP/private/metadata rejection and the 32-byte key floor. Documented the boundary in `docs/server.md` and `docs/host-security.md`.
    - Release checks only (no publish per instruction): server bumped 0.3.1 → 0.3.2 (Decision B independent line) + changelog; `security:threat-suites`, server typecheck/tests (89), docs tests (146), Biome, examples typecheck, format check, `npm audit --audit-level=moderate` (0 vulnerabilities), and secret scan (0 findings tracked + package) all pass. Durable-outbox ceiling intentionally unchanged.

## Compromises Made

- Delivery queue remains in-memory (`ponytail: in-memory queue, durable outbox via ToolEffectStore pattern if cross-restart delivery is needed`) — visible in diagnostics; durable outbox deferred until a measured need.
- Threat leg reuses existing built fixtures (phase46 blockers + package suite + pinned-fetch suite) instead of duplicating SSRF shapes.
- No npm publish: this task ran release checks (gates + audit + secret scan) without a release as instructed.

## Further Actions

- Publish `@arnilo/prism-server@0.3.2` during the next release window (changelog prepared).
- If cross-restart at-least-once delivery becomes a real adoption requirement, add a durable outbox behind the existing notifier options without changing the notify contract.
