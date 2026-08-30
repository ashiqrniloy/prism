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

- [x] Task 1 — Primitive Review: Inspector as Composition, Not Runtime (2026-09-05)
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
  - Completion Evidence (2026-09-05):
    - Package shipped: `packages/prism-dev/` (`@arnilo/prism-dev` `0.0.1`; peers `@arnilo/prism`/`@arnilo/prism-ag-ui`/`@arnilo/prism-server` all `^0.3.0`; zero runtime dependencies; `packages/prism-dev/src/index.ts` implements `createPrismDevInspector` + `DevInspectorError`; `README.md` carries the composition-only boundary note + loopback policy + seam table with exact export names).
    - Seam inventory (exact exports consumed; also in `docs/dev-inspector.md`): `createPrismHandler`, `PrismAgentExposure`, `PrismAgentEventResolutionInput`, `PrismRequestHandler`, `PrismServerAuthorizer`, `PrismServerAuthorization`, `PrismServerLimits` (`@arnilo/prism-server`); `AgentEventSource` (`page`/`subscribe`), `Agent`, `AgentRunRef`, `SecretRedactor`, `isLoopbackAddress`, `isLoopbackHostname` (core peer); `@arnilo/prism-ag-ui/renderer` projection (Task 3); run-ledger records and pending-decision resume reached only via the server seams (no direct ledger use; zero new primitives). Session construction reuses the bare-`Agent` `createSession()` path the server itself takes for `Agent` entries.
    - Tests (`packages/prism-dev/src/__tests__/`): `composition.test.ts` — source import scan pinned to the seam allow-list (no core-internals `src/` imports, node builtins only besides peers), manifest truth (peers `^0.3.0`, no runtime deps, prism-all omission), boot under 1s envelope (measured ~5ms), and a mock-provider direct run through the composed handler; `bind.test.ts` — default loopback bind, non-loopback fail-closed (`ERR_PRISM_DEV_REMOTE_BIND`) without `remoteAuthorize` (+ real `authorize`), and `listen()` refusing when the opt-in callback resolves `false`. 7/7 pass.
    - Independent release posture validated: `peerDependencies["@arnilo/prism"] = "^0.3.0"` satisfies `satisfiesInternalRange("^0.3.0", 0.3.2)` (root) / 0.3.1 (server) / 0.3.0 (ag-ui); `src/__tests__/release.test.ts` `validateReleaseIndependent` over the real graph passes with the new package; `npm pack --dry-run` clean (6 files, no tests/maps/source).
    - Docs: new `docs/dev-inspector.md` (full API-page structure), `docs/index.md` entry under CLI/RPC, `docs/release-and-install.md` package list + dev-only exception note, `README.md` prism-all omission row, plan-035 evidence matrix row (`docs/_evidence/phase35-ai-runtime-package-matrix.md`, 61 rows), `scripts/package-truth.json` regenerated (61/60/17/10/33).
    - Truth gates updated following the existing per-package flag pattern (`hasDesktopPackage` etc.): `scripts/phase24-truth.test.mjs`, `scripts/phase29-freeze.test.mjs`, `scripts/phase30-freeze.test.mjs`, `scripts/phase27-release.test.mjs`, `scripts/phase13..21-freeze.test.mjs` (filesystem-coherence exclusions + phase-16 lockfile name-set), `scripts/benchmark-multi-agent.test.mjs` (61 inventory rows), `src/__tests__/release.test.ts` (61 manifests), `src/__tests__/docs.test.ts` (61 dirs / omission map).
    - Full `npm test` green (core 1695/1695, script gates all green, all workspace suites incl. the new package pass; `biome lint .` 0 diagnostics).

- [x] Task 2 — Inspector Server: SSE Streaming, HITL Resume, Run Replay Endpoints (2026-09-05)
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
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-09-05):
    - Files: `packages/prism-dev/src/server.ts` (data-defined route table `ROUTES` + `createDevRouter`, `DevDecisionRequest`/`DevDecisionOutcome` typed payloads re-exported from the package index) and `packages/prism-dev/src/replay.ts` (`replayRunPage` over `createPrismAgentEventReplay`). `index.ts` derives the exposure capability id from the host agent's `config.id ?? name` (the lifecycle seam asserts `state.agentId === capabilityId`), wires `agentRuns` lifecycle only when the host passes its `checkpoints` store (`createAgentRunLifecycle({ checkpoints, resolveAgent })` — the inspector constructs no runtime), and defaults the loopback authorizer to `{ tenantId: "local", userId: "local" }` so durable event ownership scoping passes.
    - Routes (each adapts to the server seam or pages the source; unmatched → raw `/{basePath}/*`): `POST /prompt` → URL-rewrite into the handler's direct run; `GET /events?runId=` → handler durable SSE route (`Last-Event-ID` + `?cursor=` seam-handled; missing runId → `400 ERR_PRISM_DEV_ROUTE`); `GET /runs/:id/replay?cursor=` → `replayRunPage` (no session, no provider; host `authorize` consulted with the `agent.events` operation; identity projected onto ownership via `assertIdentityActive`/`assertIdentityMatchesOwnership`; response `{ items, nextCursor?, terminal }`, redactor applied on send like the SSE route); `POST /runs/:runId/decisions/:decisionId` → handler resume route with a single-entry core decision batch (`{ decisions: [{ approvalId, outcome }], expectedVersion? }`) — core boundary rejects unknown discriminants/stale versions fail-closed before any state write.
    - Tests (`packages/prism-dev/src/__tests__/server-routes.test.ts`, 5/5): prompt adapter end-to-end; durable SSE in append order + `Last-Event-ID` reconnect (exactly the post-cursor events — no duplicates, no loss, mock provider untouched); paged replay with `cursor` paging, terminal flag, host redactor applied (secret absent from the page), unknown run → `404`; replay without an event source → documented `404`, never a re-run; HITL — suspended approval resumed `allow_once` with the tool executed exactly once, `sideways` outcome → `400 ERR_PRISM_SERVER_RESUME` fail-closed before the valid decision applies with the unchanged `expectedVersion`. Full package suite 12/12.
    - Security: every rendered payload passes the host redactor (SSE via handler `options.redactor`, replay page via `redactor.redact` on send; stored records were redacted-at-append by the source seam); ownership scoping enforced by the source seam (foreign cursors/ownership fail closed) and `resolveRun` refusing unknown selectors; decision validation is core's own (0.2.0 regression intact).
    - Performance: replay pages bounded by deployment limits (`maxReplayEvents` default 100, `maxReplayCursorBytes` passthrough); SSE bounded by the server's existing stream limits; no unbounded buffering anywhere.
    - Docs: `docs/dev-inspector.md` HTTP-surface section (route table, reconnect semantics, decision example), README endpoint summary, CHANGELOG 0.0.1 wording covers Tasks 1–2.

- [x] Task 3 — Inspector UI Page (Event Timeline, Tool Inspection, Usage, Decisions) (2026-09-05)
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
  - Completion Evidence (2026-09-05):
    - Files: `packages/prism-dev/src/ui/inspector.ts` (framework-free browser module — the package's own tsc emits it as a standalone ES module with zero runtime imports; the one DOM module), `packages/prism-dev/src/ui/assets.ts` (inlined page template + strict-CSP serving of page/scripts/config), `packages/prism-dev/src/server.ts` (three new data-table routes: `GET /`, `GET /assets/inspector.js`, `GET /config`). No build bundler and no runtime framework dependency; package dependency tree unchanged (zero runtime deps, peers `^0.3.0` untouched). The AG-UI renderer stays server-side projection as planned (Task 1 seam note stands); the UI folds the server's already-normalized `AgentEvent` SSE frames via a pure `projectEvent` fold (`applyAgentEvent`), so unknown event types render as notes instead of dropping.
    - Page: prompt box → `POST {basePath}/agents/{id}/stream` (server SSE seam, redacted frames) → live timeline; expandable tool call args/results (`<details>`, status ok/error/blocked); per-run usage totals (`provider_turn_finished.usage` + terminal `agent_finished.usage`, input/output/total/cost); decision cards from `agent_suspended` (`PendingDecision.approvalId` + scope tool name + `expectedVersion` from the event's version; legacy single-approval fallback) posting `POST /runs/:runId/decisions/:approvalId`; run selector (session runs by id/status) plus durable run load via `GET {basePath}/events?runId=…` over `EventSource` (seam's own `Last-Event-ID` reconnect; absent event source surfaces honestly instead of faking replay).
    - Performance: single static assets from the package, zero external/CDN references (string-scanned in tests); windowed rendering — pure `visibleItems` slice (last `MAX_RENDERED_WINDOW` = 400 rows, hidden-count line) + incremental DOM append with rAF-coalesced redraws; test measures a 1200-event fold under 250ms.
    - Security: CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'` + `nosniff` + `no-store` on both assets; page fetches only same-origin (`/config` bootstrap); no `eval`/`new Function`; no markup assembly anywhere — dynamic payloads reach the DOM via text nodes only (redacted strings render as-is).
    - Tests (`packages/prism-dev/src/__tests__/ui.test.ts`, 11/11): asset serving (status/content-type/CSP assertions incl. `default-src 'none'`/`script-src 'self'`/`connect-src 'self'`, nosniff/no-store, module + config bodies, external-origin scan = none, `eval`/`inner`-markup scan = none) and projection fixtures (text-delta merge, thinking separate, tool start→finish/error/blocked with args-as-rendered-string, usage summing across turns + terminal, decisions render + legacy fallback + resume/deny clearing, fatal error status, non-streaming `message_finished` safety net with delta dedupe, 1200-event window + fold speed, unknown-type notes, malformed-payload tolerance). Full package suite 23/23, `biome check` clean.
    - Docs: `docs/dev-inspector.md` UI walkthrough section (panels, CSP, windowing, durable-load semantics), README per-task surface line, CHANGELOG 0.0.1 wording covers Tasks 1–3.

- [x] Task 4 — `prism dev` CLI Composition + Scaffold Integration (2026-09-05)
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
  - Completion Evidence (2026-09-05):
    - Files: `packages/prism-dev/src/cli.ts` (bin entry: `runDevCli(argv, { stdout, stderr, cwd?, signal? })` — resolves the scaffold contract `dist/agent.js` → `createAppAgent()`, composes `createPrismDevInspector`, prints `prism dev → http://127.0.0.1:<port>`, SIGINT drains and exits `0`; no remote-auth flag — a non-loopback `--host` surfaces `ERR_PRISM_DEV_REMOTE_BIND` from the fail-closed constructor and exits `1`); `packages/prism-dev/package.json` (`"bin": {"prism-dev": "dist/src/cli.js"}` + `"./cli"` export for programmatic delegation); `src/cli-dev.ts` (new — `runPrismDevSubcommand` + `defaultLoadDevCli`: resolves `@arnilo/prism-dev/cli` from the project's own `node_modules` via `createRequire(cwd/package.json)`, falls back to this CLI's own install; unresolvable → install hint, exit `2`; core holds no compile-time dev-package dependency — dynamic import + structural `DevCliModule` type only, satisfying "no new core dependency"); `src/cli-runner.ts` (`prism dev` routed pre-parse like `init`/`providers add`, `loadDevCli` test override on `CliRuntime`, usage line added); `templates/init/package.json.tmpl` (`"dev": "prism dev"` — additive only, no default provider change).
    - Tests: `packages/prism-dev/src/__tests__/cli.test.ts` (4) — boots the scaffolded mock agent (scratch project with the real scaffold layout), prints a loopback URL, start-to-listen under 1s (≈29ms measured), `/config` answers 200, abort closes within bounded time and the listener actually closes; non-loopback `--host` refused before bind (exit `1`, no URL printed); missing/not-built scaffold → exit `2` + build hint; help/unknown-flag/bad-port validation; `src/__tests__/cli-dev.test.ts` (3) — delegation passthrough with injected loader, install-hint failure path, usage documents the subcommand; `src/__tests__/cli-init.test.ts` — scaffold asserts `scripts.dev === "prism dev"` (additive). prism-dev package suite 27/27 after these additions.
    - Security: no `--host` escape hatch for remote binds (fail-closed before bind in the inspector constructor); the CLI never reads `process.env` for secrets — provider key closures stay in the scaffold's own agent file; scaffold `.env.example` handling unchanged. Composition guard updated: `src/` builtins allow-list now `[fs, http, path, process, stream, url]` — still zero third-party runtime dependencies, peers untouched.
    - Performance: start-to-listen approx 29ms in tests including one dynamic module import plus the loopback bind (budget 1s excluding provider network).
    - Docs: `docs/cli-rpc.md` (new `prism dev` section — delegation model, flag table, exit codes, scaffold contract), `docs/dev-inspector.md` (Quickstart subsection), `docs/release-and-install.md` (bin + `./cli` export lines; manifest counts unchanged — still 61 publishable, umbrella omission already recorded in Task 1), `docs/index.md` entry description refreshed, prism-dev README surface line + CHANGELOG 0.0.1 wording covers Tasks 1–4.

- [x] Task 5 — Release, Docs Truth, and Package-Graph Integration (2026-09-05)
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
  - Completion Evidence (2026-09-05):
    - Independent release path: `scripts/phase40-release-dry-run.mjs` runs the existing release machinery (`release.mjs` exports `validateReleaseIndependent` + `runRelease`) with its documented injectable seams — changed-set (`gitDiff`) scoped to `packages/prism-dev` only (sibling versions untouched: `validateReleaseIndependent` enforces internal dep ranges + per-package lockfile/manifest agreement across all 61 manifests), registry `fetcher` stubbed 404 (0.0.1 unpublished), and the REAL `npm publish --dry-run` (offline) proving tarball packability. Report retained at `docs/_evidence/phase40-dev-inspector-publish-dry-run.json`: `order: ["@arnilo/prism-dev"]`, `version: "independent"`, `dryRun: true`, single package status `"dry-run"`, plus in-script asserts that no sibling manifest was mutated (byte-identical before/after). Baseline: `e5e4ee6` (the pre-plan-040 commit; `@arnilo/prism-dev` absent → no bump required, publishes new at `0.0.1`). The full-CLI `check` intentionally stops at `@arnilo/prism@0.3.2` (already on the registry) — same constraint as every post-publish tree; the single-package cut is the operator handoff.
    - Tarball: `npm pack --dry-run` → `arnilo-prism-dev-0.0.1.tgz`, 24.1 kB packed / 81.3 kB unpacked, 16 files (dist incl. `cli.js` + `ui/`, README, CHANGELOG; tests/maps excluded) — within the budget gates (`scripts/budget-gate.test.mjs` green in `npm test`).
    - Security: `security:threat-suites` extended with the dev-inspector leg (`scripts/phase40-security.test.mjs`, D1–D4 with gate accounting): loopback-only bind (non-loopback refuses before any listener, stable `ERR_PRISM_DEV_REMOTE_BIND`), host redactor scrubs secret literals from server-rendered replay payloads, ownership-scoped replay (foreign selectors + source-less replay refuse 404 without re-execution), fail-closed decision resume (unknown outcome discriminant → 400 without version consumption or tool execution; valid `allow_once` applies exactly once). Full leg: `npm run security:threat-suites` → 64/64 pass. `npm audit --audit-level=moderate` → 0 vulnerabilities. `docs/host-security.md` gains the dev-surface boundary entry + named-leg description.
    - Docs truth: catalog/description pages finalized across Tasks 1–4 (`docs/index.md` entry, `docs/release-and-install.md` canonical counts 61 + dev-only exception paragraph + bin/`./cli` shipment lines, `docs/dev-inspector.md` full review incl. Quickstart/UI/HTTP sections, `docs/cli-rpc.md` `prism dev` subcommand). Docs-truth tests green (`docs.test.ts`, `release.test.ts`, `phase24-truth`, `phase30-freeze` windows) — all 56 `npm test` groups `fail 0` (one unrelated first-run timing flake in `field-policy.test.js` re-ran green in isolation, matching the recorded flake pattern from plan 039).
    - Note: publication remains the operator handoff (039/050 precedent) — push the `@arnilo/prism-dev@0.0.1` package tag; `release.yml` validates the clean tagged tree, runs the gate stack, and publishes with OIDC provenance. This task does not touch the registry.

## Compromises Made

- AG-UI renderer stays server-side projection only (Task 1/3): the UI folds the server's already-normalized redacted `AgentEvent` frames instead of re-deriving AG-UI ops client-side — same runtime guarantees, one less browser dependency; revisit only if a client needs AG-UI op-level replay.
- The inspector UI is framework-free DOM (no bundler): the package's own tsc emits the page module as a standalone ES module; add a bundler only if the page grows beyond a single module.
- Release cut surface: `scripts/phase40-release-dry-run.mjs` scopes the changed set to the dev package via the documented `gitDiff` seam instead of bumping root for docs-only changes (plan-050 precedent: docs-only root changes ride in the baseline commit and publish with the next root release). The full `release.mjs check` cannot complete on any post-publish tree (root 0.3.2 is on the registry), so the machine evidence for this cut is the scoped dry run + real tarball pack + budget/audit/threat gates.

## Further Actions

- Operator: push `@arnilo/prism-dev@0.0.1` with the next batched tag push (`release.yml` publishes with provenance; registry manifest is verified after). Batch ≤3 tags per push per the VENT.md 26-08-29 note.
- Optional (non-blocking): if the inspector page grows past one module, evaluate a tiny bundler and/or wire the AG-UI renderer client-side for op-level replay (see Compromises). Priority: low.
- Optional: fold `scripts/phase40-release-dry-run.mjs` into a reusable `release.mjs --dry-run --package <name>` single-package mode if more independent new-package cuts follow. Priority: medium.