# 040 — Dev Inspector: `prism dev` Local Playground Server

Adoption-list item #1 (parity with Mastra Studio / LangGraph Studio / CrewAI Studio).
Roadmap phase: **0.3.x** (demand-gated; this plan records the demand-gate activation rationale).
Baseline: `@arnilo/prism` **0.3.0**+; all prism packages independent-versioned (Decision B).
Target: `@arnilo/prism-dev` **0.0.1** (peer `@arnilo/prism` `^0.3.0`) plus a `prism dev` CLI subcommand composition.

## Demand-gate rationale (recorded, per roadmap "no speculative product layer")

Studio is demand-gated in `roadmap.md` product boundaries. The gate now has evidence to activate: every direct competitor (Mastra Studio, LangGraph Studio, CrewAI Studio) routes new-user evaluation through a local dev inspector, and Prism hosts currently must build their own trace viewer before they can iterate on prompts. This plan stays inside the boundary: the inspector is a **loopback-only composition of existing seams** (server routes, AG-UI renderer, `AgentEventSource` replay, run ledger) — no hosted service, no new runtime, no second protocol. It is to the server what `@arnilo/prism-acp-agent` is to ACP: a thin packaging of already-public contracts.

## Objectives

- Ship an optional `@arnilo/prism-dev` package with a `prism dev` entrypoint that boots a loopback-only inspector over a host's already-configured agent.
- Provide a minimal single-page inspector UI (event timeline, tool calls, token/cost usage, suspend/resume of HITL decisions, replay of completed runs) built on the existing AG-UI reference renderer and durable event replay.
- Zero changes to Prism core runtime behavior; server, AG-UI, and event-source seams are consumed, not extended.
- Fail closed: loopback bind by default, no remote exposure, no credentials handled by the inspector itself.

## Expected Outcome

- `cd my-agent && npx @arnilo/prism-dev` (or `prism dev` when installed) starts an inspector at `http://127.0.0.1:<port>` against the scaffold's agent.
- The inspector can: send a prompt, watch normalized `AgentEvent`s stream live, inspect tool call args/results (redacted), see usage per run, resume suspended approvals, and replay a finished run from the durable event source without re-execution.
- Package publishes independently at `0.0.1` without bumping other monorepo packages (`validateReleaseIndependent`).
- Core test suite untouched; new tests live in the package.

## Tasks

- [ ] Task 1 — Primitive Review: Inspector as Composition, Not Runtime
  - Acceptance Criteria:
    - Functional: Inventory confirms the inspector needs zero new core primitives: `@arnilo/prism-server` agent routes (direct/SSE), `AgentEventSource` page/subscribe/resume, `@arnilo/prism-ag-ui/renderer` projection, run-ledger records, pending-decision resume seams. Document each seam consumed with exact export names.
    - Performance: inspector boot (excl. host agent model calls) under 1s on the 0.1.0 performance envelope hardware assumptions.
    - Code Quality: boundary note in the plan/README declares the package a composition-only consumer; no imports into core; peer range `^0.3.0` validated.
    - Security: inspector binds `127.0.0.1` only by default (opt-in non-loopback refused unless an explicit host authorization callback is supplied); no secret storage; all tool args/results rendered through the host redactor.
  - Approach:
    - Documentation Reviewed:
      - `docs/server.md` — authorized direct/SSE agent routes, health/drain/rate-limit seams.
      - `docs/agent-events.md` — `AgentEventSource` page/subscribe/resume, durable reconnect.
      - `docs/ag-ui.md` — renderer subpath `@arnilo/prism-ag-ui/renderer`.
      - `docs/runs-and-usage.md` — durable run/event/tool/usage persistence.
      - `plans/031-Release-0-3-0-Antigravity-Cli-Prism-Mcp-Blueprint.md` — thin-packaging precedent for delegated composition packages.
      - `scripts/release.mjs` — `validateReleaseIndependent`, `satisfiesInternalRange`.
    - Options Considered:
      - Extend `@arnilo/prism-server` with inspector routes: rejected — server is the production API boundary; a dev surface mixing in would muddy its explicit-bounds contract.
      - Standalone `@arnilo/prism-dev` package consuming server/ag-ui/event seams: chosen — mirrors the acp-agent thin-packaging precedent; install profile stays out of umbrellas.
    - Chosen Approach:
      - Composition-only package: hosts pass an already-built `AgentSession`/agent factory + optional durable `AgentEventSource`; the package wires server handler + renderer + replay endpoints.
    - API Notes and Examples:
      ```ts
      import { createPrismDevInspector } from "@arnilo/prism-dev";
      const inspector = createPrismDevInspector({
        agent,                        // host-built agent (mock or provider-backed)
        eventSource,                 // optional durable AgentEventSource for replay
        host: "127.0.0.1", port: 4311,
      });
      await inspector.listen();      // serves UI + SSE; loopback-only
      ```
    - Files to Create/Edit:
      - `packages/prism-dev/package.json`: `@arnilo/prism-dev` `0.0.1`, peer `@arnilo/prism` `^0.3.0`, peer `@arnilo/prism-server`/`@arnilo/prism-ag-ui` as needed.
      - `packages/prism-dev/src/index.ts`: `createPrismDevInspector`.
      - `packages/prism-dev/README.md`: boundary statement + loopback policy.
  - Test Cases to Write:
    - `composition.test.ts`: package consumes only public exports of core/server/ag-ui (assert via `api-extractor`-style export allow-list or import scan); no `src/` (core internals) imports.
    - Bind test: default listener refuses non-loopback; explicit opt-in requires documented authorization.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new optional package + CLI composition.
    - Docs pages to create/edit: `docs/dev-inspector.md` (full API-page structure per prism-wiki reference).
    - `docs/index.md` update: yes — new entry under "CLI/RPC" or "Testing and examples" with functional description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2 — Inspector Server: SSE Streaming, HITL Resume, Run Replay Endpoints
  - Acceptance Criteria:
    - Functional: `POST /prompt` (via server handler adapter) runs the agent; `GET /events` streams normalized events as SSE with `Last-Event-ID` reconnect; `GET /runs/:id/replay` pages a durable `AgentEventSource` without re-execution; `POST /runs/:runId/decisions/:decisionId` resumes or denies a suspended approval using the same fail-closed decision validation core already enforces.
    - Performance: replay endpoint pages events under existing `AgentEventSource` bounds; no unbounded buffering (streamed).
    - Code Quality: all routes defined as data over the existing server seams; typed request/response payloads; no `any` in exported surface.
    - Security: every rendered tool arg/result passes the host `redactor`; ownership scoping respected (replay refuses foreign-ownership runs); decision resume uses core validation (unknown discriminants rejected before any state write — regression from 0.2.0).
  - Approach:
    - Documentation Reviewed:
      - `docs/server.md`, `docs/agent-events.md`, `docs/agent-session-runtime.md` (durable resume validation), `packages/server/src/` route shapes.
    - Options Considered:
      - Hand-rolled HTTP server: rejected — the server package already provides the framework-free handler contract.
      - Compose `@arnilo/prism-server` handlers behind a tiny router: chosen — reuses authorization and SSE relay semantics already conformance-tested.
    - Chosen Approach:
      - Wire existing server handler for direct/SSE agent runs; add replay + decision endpoints as thin reads over `AgentEventSource` and pending-decision seams.
    - API Notes and Examples:
      ```ts
      // Replay without re-execution
      for await (const page of eventSource.page({ runId, ownership, cursor })) { /* forward as SSE */ }
      ```
    - Files to Create/Edit:
      - `packages/prism-dev/src/server.ts`: route composition.
      - `packages/prism-dev/src/replay.ts`: durable replay paging.
  - Test Cases to Write:
    - Live stream test (mock provider): prompt → SSE event order matches normalized `AgentEvent` order.
    - Reconnect test: client drops, reconnects with `Last-Event-ID`, receives no duplicates/loss.
    - Replay test: finished run replays from a memory `AgentEventSource` with zero provider calls invoked (spy on provider).
    - HITL test: suspended approval resumed via endpoint; unknown decision discriminant rejected fail-closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package HTTP surface.
    - Docs pages to create/edit: `docs/dev-inspector.md` endpoints section.
    - `docs/index.md` update: no (covered by Task 1 entry; adjust description only if scope changes).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3 — Inspector UI Page (Event Timeline, Tool Inspection, Usage, Decisions)
  - Acceptance Criteria:
    - Functional: single served page: prompt box, live event timeline (message deltas, tool calls, turn boundaries), expandable tool call args/results (redacted), per-run usage totals, pending-decision cards with resume/deny, run selector listing recent runs from ledger/event source.
    - Performance: page is a single static asset bundle served from the package; no external CDN fetches (offline-capable); UI renders 1k-event timelines without lockup (virtualized or windowed list).
    - Code Quality: no runtime framework dependency in the package dependency tree beyond dev-only build tooling; DOM code kept in one module.
    - Security: page fetches only from its own origin; no inline eval; CSP header set by the server task; redacted strings rendered as-is (never re-parsed as HTML — escape at insertion).
  - Approach:
    - Documentation Reviewed:
      - `docs/ag-ui.md` reference renderer (`@arnilo/prism-ag-ui/renderer`) for event projection shapes.
      - `packages/ag-ui/src/renderer/core.ts` — `reduceA2UiOps`/projection state model.
    - Options Considered:
      - Reuse the AG-UI reference renderer directly as the whole UI: rejected — renderer projects protocol events, dev inspector needs run/usage/decision panels the protocol doesn't carry.
      - Server-rendered minimal page + small JS module on top of AG-UI renderer for timeline: chosen — no framework dependency; renderer reused for message/tool projection where it fits.
    - Chosen Approach:
      - Static page served by Task 2 routes; timeline subscribes over SSE; decisions post to Task 2 endpoints; tool/usage data from replay payloads.
    - API Notes and Examples:
      ```html
      <!-- served page contract -->
      <script type="module" src="/assets/inspector.js"></script>
      ```
    - Files to Create/Edit:
      - `packages/prism-dev/src/ui/page.html`, `packages/prism-dev/src/ui/inspector.ts`, `packages/prism-dev/src/ui/assets.ts` (inlined static serve).
  - Test Cases to Write:
    - Asset test: page + JS served with correct CSP, no external network references (string scan).
    - Projection test: normalized event fixtures render expected timeline items (headless DOM or pure projection function tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new public API (UI asset only); behavior = served pages.
    - Docs pages to create/edit: `docs/dev-inspector.md` UI walkthrough section.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4 — `prism dev` CLI Composition + Scaffold Integration
  - Acceptance Criteria:
    - Functional: `prism dev` (when `@arnilo/prism-dev` installed) boots the inspector against the current `prism init` scaffold's agent definition; prints the loopback URL; `SIGINT` drains and closes. Scaffolded projects gain a `dev` npm script.
    - Performance: command start-to-listen under 1s excluding provider network.
    - Code Quality: CLI subcommand wiring follows `src/cli.ts` pattern; no new core dependency.
    - Security: refuses to start when a scaffold config names a non-loopback bind without explicit authorization; never reads `process.env` for secrets itself (host agent config owns credentials).
  - Approach:
    - Documentation Reviewed:
      - `src/cli.ts`, `src/cli-init.ts` (scaffold layout), `docs/cli-rpc.md`.
    - Options Considered:
      - Own binary `prism-dev` only: kept as fallback; CLI subcommand additionally, because hosts already invoke `prism` from scaffolds.
      - Both subcommand + programmatic API: chosen.
    - Chosen Approach:
      - `@arnilo/prism-dev` ships the bin; `prism dev` delegates when the package is resolvable; scaffold `package.json` gains `"dev": "prism dev"`.
    - API Notes and Examples:
      ```bash
      cd my-agent && npm run dev   # → http://127.0.0.1:4311
      ```
    - Files to Create/Edit:
      - `packages/prism-dev/src/cli.ts`: bin entry.
      - `src/cli-init.ts`: add `dev` script to scaffold (additive, no default provider change).
  - Test Cases to Write:
    - Scaffold test: generated project contains `dev` script and passes its offline test.
    - CLI test (mock provider): `prism dev` boots, serves, and closes on abort within bounded time.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — CLI surface extension + scaffold change.
    - Docs pages to create/edit: `docs/cli-rpc.md` (subcommand section), `docs/dev-inspector.md` (quickstart), `docs/release-and-install.md` (manifest count + install line).
    - `docs/index.md` update: yes — entry description adjusted to mention `prism dev`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 5 — Release, Docs Truth, and Package-Graph Integration
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-dev` publishes independently at `0.0.1` via existing release scripts; manifest-count tripwires (`docs/release-and-install.md` canonical count) regenerated; package deliberately **omitted from umbrellas** (dev-only surface, mirrors acp-agent/antigravity precedent).
    - Performance: package tarball within existing budget gates.
    - Code Quality: `npm test` green including new package suite; biome/audit clean.
    - Security: `security:threat-suites` extended with a dev-inspector leg: loopback-only bind, redaction of rendered tool payloads, ownership-scoped replay, fail-closed decision resume.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`, `scripts/release.mjs`, `docs/host-security.md` (remote-boundary checklist).
    - Options Considered: umbrella inclusion — rejected (dev-only, matches acp-agent precedent).
    - Chosen Approach: independent 0.0.1, omitted from umbrellas, docs-indexed.
    - API Notes and Examples: n/a (release task).
    - Files to Create/Edit:
      - `docs/dev-inspector.md` (final review), `docs/release-and-install.md`, `docs/index.md`, `docs/host-security.md` (dev surface checklist entry).
  - Test Cases to Write:
    - Docs tripwire: index/release pages list the new package consistently (existing docs-truth tests extended).
    - Release dry-run: `release:check` validates independent publish without touching sibling versions.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — catalog addition.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.