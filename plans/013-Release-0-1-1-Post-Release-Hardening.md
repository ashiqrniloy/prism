# Release 0.1.1 — Post-release hardening and tooling fixes

Roadmap phase: 0.1.x stabilization line, milestone **0.1.1 — Post-release hardening and tooling fixes** (`roadmap.md`, "0.1.1 — Post-release hardening and tooling fixes").
Baseline: `@arnilo/prism` **0.1.0** (Phase 12 release-candidate hardening; signed tag `v0.1.0`; `npm run sdk:ready` green; `npm audit --audit-level=moderate` 0 vulns; 317 locked deps; 49 publishable manifests = root + 48 workspace packages).
Target: `@arnilo/prism` **0.1.1** (additive/non-breaking patch; no new packages, public exports, schema migrations, or runtime dependencies).
Prerequisite: 0.1.0 exit gate passed; `scripts/phase12-freeze-manifest.json` frozen; `docs/public-contracts.md` 0.1.x contract surface frozen; `docs/migration.md` 0.0.28 → 0.1.0 section present.

0.1.1 is a **hardening patch, not a feature release** (roadmap priority rule 1: 0.1.x hardening precedes new 0.1.x providers precedes 0.2.0 modules). Every change is additive or non-breaking vs the frozen `docs/public-contracts.md` 0.1.x surface, or carries a tested refusal/migration path. No new packages, subpaths, public exports, tool contracts, events, or configuration surfaces are planned.

## Objectives

- Close the four residual tooling/lifecycle defects carried as compromises from plans 007/008/010/011 and surfaced in the 2026-08-09 post-0.1.0 review: the concurrent `npm test`/`build` `dist/`-deletion race, the untested MCP SSE relay path, the core-only headline coverage gate, and the contradictory manifest-count narrative across docs.
- Add the ACP modes/config ownership-scoped persistence guidance flagged by the post-0.1.0 security review, so a host that persists `modeId`/`configValues` cannot leak cross-session/cross-tenant state.
- Keep the 0.1.x additive-only compat promise intact: `scripts/compat-baseline` stays green (zero breaking declaration deltas at the 0.1.1 bump); `release:gate` passes; `npm audit` stays at 0 moderate-or-higher.
- Record each fix as retained evidence with a docs tripwire so it cannot silently regress on a later 0.1.x cut.

## Non-goals

- New model providers, packages, subpaths, public exports, events, tool contracts, or configuration surfaces (those are 0.1.3+ / 0.2.0).
- The live-canary matrix, live-NATS suite, and `prism-providers` umbrella membership fix — those are 0.1.2 / 0.1.3.
- A durable ACP session store or native sandbox backend (0.2.0 Module E, demand-gated).
- Splitting `src/agents.ts` / `src/contracts.ts`, removing deprecated inert options, or any breaking public-API change (0.2.0 Modules B/C).
- Switching the root build to `tsc --build` composite project references (large build-graph change; 0.2.0 candidate).
- Turning a hardening blocker into a skip to ship the patch number.

## Expected Outcome

- Concurrent `npm test` and `npm run build` (or two `npm test`, or `npm run typecheck` + `npm test`) cannot corrupt `dist/`: no process deletes `dist/` mid-build; `npm run clean` still exists as an explicit one-shot for branch switches and post-deletion hygiene.
- The stateless MCP SSE relay path (`createPrismMcpWebHandler` → `ReadableStream` relay → `boundResponse` event-stream short-circuit) is covered by a deterministic, CI-safe test asserting chunk order and client-disconnect cancellation; no long-lived stream is held open in `npm test`.
- `npm run test:coverage` reports a combined core + workspace coverage summary without weakening the core gate thresholds; per-package suites keep owning their coverage.
- Exactly one canonical manifest-count statement lives in `docs/release-and-install.md` (49 publishable manifests = root + 48 workspace packages, broken down by category); every other doc/README uses the same wording or links to it; a docs tripwire asserts the canonical tokens and rejects drift.
- `docs/acp.md` documents that the agent does not persist modes/config (defaults per session) and that any host persistence MUST be ownership-scoped, with an ownership-scoped example and a cross-tenant refusal example; a test fixture asserts cross-tenant mode/config load is rejected.
- `npm run sdk:ready` green from a clean checkout at 0.1.1; `release:check -- --version 0.1.1` green; `release:publish -- --version 0.1.1 --dry-run --allow-untagged` deterministic; `npm audit --audit-level=moderate` 0; compat baseline additive-only.

## Tasks

- [x] Task 0 — Freeze record, scope gate, and baseline evidence
  - Acceptance Criteria:
    - Functional: a `scripts/phase13-freeze-manifest.json` (or an extension of the existing freeze pattern) declares 0.1.1 as a hardening patch: allowed changes (the five fixes + docs/evidence scripts), forbidden changes (new packages/exports/subpaths/migrations/runtime deps/0.1.3+ items), and a deviation log (empty at freeze; any later deviation carries task + change + rationale, schema-enforced).
    - Functional: baseline evidence recorded before any task: `npm test` pass count, `npm run test:coverage` headline numbers, `npm audit` result, `release:check`/`release:gate` status at 0.1.0, and the current manifest-count strings grep'd across `README.md` + `docs/*.md` (the audit list Task 4 reconciles).
    - Performance: freeze adds no new long-running work; reuses the existing `scripts/budget-gates.mjs` / `scripts/phase12-freeze.test.mjs` pattern.
    - Code Quality: one machine-checked manifest + schema test following the plan 010/011/012 freeze pattern, wired into the `npm test` script list; no new test framework.
    - Security: freeze restates the 0.1.x audit policy target (`--audit-level=moderate`), the additive-only compat promise vs `scripts/compat-baseline`, and the signed-tag + npm OIDC publication as operator steps.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` 0.1.1 milestone + Release Validation Checklist + Versioning Policy; `scripts/phase12-freeze-manifest.json` + `scripts/phase12-freeze.test.mjs` (the established freeze pattern); `docs/public-contracts.md` (frozen 0.1.x surface); `docs/migration.md` (`0.0.28 → 0.1.0` section); `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Reuse `scripts/phase12-freeze-manifest.json` with a `0.1.1` block: couples a release-contract freeze to a patch; reject — a separate `phase13-freeze-manifest.json` keeps the 0.1.0 release contract frozen and the 0.1.1 hardening scope gated independently.
      - Prose-only scope gate in this plan: not machine-checkable; reject (plan 010/011/012 precedent is manifest + test).
    - Chosen Approach:
      - `scripts/phase13-freeze-manifest.json` + `scripts/phase13-freeze.test.mjs` validating the allowed/forbidden scope, the empty deviation log schema, the audit/compat/tag policy, and (as each task lands) the per-task evidence tokens; wired into the `npm test` script list after the phase12 freeze tests. Baseline evidence recorded in `scripts/phase13-baseline.json` (pass counts, coverage headlines, audit result, manifest-count string audit) for regression comparison at the exit gate.
    - API Notes and Examples:
      ```jsonc
      // scripts/phase13-freeze-manifest.json (illustrative; finalized in Task 0)
      { "release": "0.1.1", "line": "0.1.x", "type": "hardening-patch",
        "allowed": ["build-single-flight", "mcp-sse-relay-test", "coverage-summary",
                    "manifest-count-narrative", "acp-modes-config-ownership-guidance",
                    "docs", "evidence-scripts"],
        "forbidden": ["new-packages", "new-public-exports", "new-subpaths",
                      "schema-migrations", "runtime-dependencies", "providers", "0.2.0-modules"],
        "compat": { "baseline": "scripts/compat-baseline", "delta": "additive-only" },
        "audit": { "level": "moderate" }, "deviations": [] }
      ```
    - Files to Create/Edit:
      - `scripts/phase13-freeze-manifest.json` (new), `scripts/phase13-freeze.test.mjs` (new), `scripts/phase13-baseline.json` (new, baseline evidence), `package.json` (`test` script: add the phase13 freeze test).
    - References:
      - `scripts/phase10-freeze-manifest.json` / `phase11-freeze-manifest.json` / `phase12-freeze-manifest.json` patterns; `scripts/budget-gates.mjs`; roadmap Release Validation Checklist.
  - Test Cases to Write:
    - Freeze schema validation: allowed/forbidden disjoint, deviation entries structured, audit/compat policy present, baseline evidence file present.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal freeze only).
    - Docs pages to create/edit: none (per-task docs follow).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 0 completion record

  - **Scope-gate manifest** `scripts/phase13-freeze-manifest.json`: a hardening-patch scope gate (NOT a release-contract support matrix — that stays frozen at `scripts/phase12-freeze-manifest.json`). Declares `release: 0.1.1`, `line: 0.1.x`, `type: hardening-patch`, `baseline: 0.1.0`. `hardeningFreeze.active: true` with the five allowed fixes (build single-flight, mcp sse relay test, coverage summary, manifest-count narrative, acp modes/config ownership guidance) plus `documentation` and `release tooling and evidence scripts`; `forbiddenChanges` lists new packages/exports/subpaths/migrations/runtime-deps, new model providers (0.1.3+), every 0.2.0 module family, the live-canary/live-NATS matrix (0.1.2), and the `prism-providers` umbrella fix (0.1.3). `deviations: []` (empty at freeze, schema-enforced — each later deviation needs `task` + `change` + `rationale`). `compat.promise` additive-only with zero breaking deltas at the 0.1.1 bump against `scripts/compat-baseline` (baselineRelease `0.1.0`). `supportMatrix` points at the phase 12 manifest (0.1.1 changes none of it). `releasePolicy`: moderate audit, signed `v0.1.1` tag, npm OIDC provenance, operator-gated publication. `tasks`: seven per-task evidence tokens with `task0: done` and `task1`–`task6: pending`.
  - **Baseline evidence** `scripts/phase13-baseline.json` captured 2026-08-09 at 0.1.0 (Node v24.18.0, linux-x64) for regression comparison at the Task 6 exit gate: `npm test` rc=0, core 1416/1416 pass / 0 fail; `npm audit --audit-level=moderate` 0 vulnerabilities; core coverage lines 91.67% / branches 83.72% / functions 91.23% (thresholds 60/75/70, all pass; scope is core-only per the plan 010 compromise — Task 3 adds the combined summary); `release:gate --version 0.1.0` 49 packages, 0 breaking deltas, `updated: false`; `release:check --version 0.1.0` blocked by the dirty tree (uncommitted Task 0 files) — green at clean `v0.1.0` per plan 012 Task 7. `manifestCount` coherent with the real filesystem: 49 publishable = root `@arnilo/prism` + 48 workspace (14 provider + 9 `prism-*` + 25 capability), with the six contradictions Task 4 will reconcile audited (the `docs/migration.md` historical lines marked OUT OF SCOPE).
  - **Schema gate** `scripts/phase13-freeze.test.mjs` (15 tests, build-free — reads only the two JSON files + `package.json` + the filesystem): manifest release/line/type/baseline; hardening freeze active with the five allowed fixes and forbidden 0.1.3+/0.2.0 items; allowed/forbidden disjoint; deviation log a structured empty array; compat promise additive-only with zero breaking deltas and the `scripts/compat-baseline` dir present; support-matrix pointer references the phase 12 manifest; release policy (moderate audit, `v0.1.1` signed tag, npm OIDC, operator publication); seven per-task tokens with Task 0 done and Tasks 1–6 pending; security policy (blocked-gate `never a passing skip`, moderate audit); baseline coherence (green npm test + audit, coverage above thresholds, 49 packages / 0 breaking deltas, manifest-count matches `packages/*/package.json` + `provider-*` + `prism-*` counts, root name `@arnilo/prism`, dirty-tree `release:check` block recorded, baseline file newer than the phase 12 manifest).
  - **Wiring**: `package.json` `test` script — added `scripts/phase13-freeze.test.mjs` immediately after `scripts/phase12-freeze.test.mjs` in the script-gates `node --test` invocation.
  - **Observed the Task 1 race in passing**: a concurrent `release:gate` (run while `npm test`'s `npm run build` was mid-`clean`) reported `compat: ... has no dist/ — run npm run build first` for eight workspace packages — the destructive `rm -rf dist packages/*/dist` deleting `dist/` mid-build. Re-running `release:gate` after `npm test` completed (dist stable) returned 49 packages / 0 breaks. This is the exact defect Task 1 removes by dropping `clean` from `build`.
  - Evidence: `node --test scripts/phase13-freeze.test.mjs` 15/15 pass; full `npm test` rc=0 — core **1416/1416**, script-gates group **94/94** (79 prior + 15 new phase 13 tests), all workspace suites fail 0.

- [x] Task 1 — Build single-flight: remove `clean` from `npm run build`
  - Acceptance Criteria:
    - Functional: `npm run build` no longer deletes `dist/`; concurrent `npm run build` + `npm test` (and two `npm test`, and `npm run typecheck` + `npm test`) cannot corrupt `dist/` — the destructive `rm -rf dist packages/*/dist` race from plans 007/008 is gone.
    - Functional: `npm run clean` still exists as an explicit one-shot for branch switches and post-source-deletion hygiene; documented in `docs/release-and-install.md` and the root `package.json` script comment.
    - Functional: a fresh `npm run clean && npm run build` produces a byte-identical `dist/` graph to the pre-change `npm run build` (tsc overwrites per-file outputs); `npm test`, `npm run typecheck`, `npm run sdk:ready`, and `npm run pack:dry-run` all green.
    - Functional: orphaned-output safety is self-checking — a deleted `src/__tests__/*.test.ts` leaves an orphan `dist/__tests__/*.test.js` whose now-broken imports make `node --test dist/__tests__/*.test.js` fail loudly (no silent stale test); tarball `files` allowlists already filter any orphan from packed output. A `ponytail:` comment names the ceiling and the `tsc --build` upgrade path (0.2.0).
    - Performance: incremental `tsc` is faster than clean+full-compile; no measurable build-time regression (assert non-regression vs the Task 0 baseline build time).
    - Code Quality: one-line `package.json` script change (`build` drops the `npm run clean && ` prefix); no new scripts, no lockfile dependency, no single-flight lockfile (concurrent `tsc` is write-only and idempotent on identical input, so serialization is unnecessary — documented in the approach).
    - Security: removing `clean` does not weaken tarball content gates (`release-gate.test.mjs` tarball deny/allow lists still enforced); no credential or secret surface touched.
  - Approach:
    - Documentation Reviewed:
      - `package.json` (`build` = `npm run clean && npm run build:core && npm run build --workspaces --if-present`; `build:core` = `tsc`; `clean` = `rm -rf dist packages/*/dist`; `typecheck`/`test`/`sdk:ready` all invoke `npm run build`); root `tsconfig.json` (bare `tsc`, non-`--build`); workspace `package.json` build scripts (`tsc -p tsconfig.json`); `scripts/budget-gates.mjs` (pack/startup measurement); `scripts/release-gate.test.mjs` (tarball content gates); plans 007/008 single-flight compromise notes; roadmap 0.1.1 + 0.2.0 Module F (`tsc --build` candidate).
    - Options Considered:
      - Single-flight lockfile around `build` (wait-or-skip with a success marker): fixes the race but adds ~40 lines of lock logic + a stale-marker edge case; rejects the coalescing-skip complexity. Over-engineering given that the only destructive operation is `clean`, and concurrent `tsc` is write-only + idempotent on identical input (two processes writing `dist/agents.js` with identical bytes end consistent regardless of interleaving; tsc reads only `src`, never `dist`, during emit).
      - Switch root to `tsc --build` (composite project references): auto-cleans orphaned outputs and is incremental, but requires `composite: true` + `references` across 48 packages — a large build-graph change that risks breaking the workspace build and the pack/startup budgets; defer to 0.2.0 Module F.
      - Remove `clean` from `build`, keep `clean` standalone (chosen): the destructive `rm -rf` is the sole cause of the mid-write corruption; removing it from the `build` path eliminates the race with a one-line change. Orphan outputs are self-checking (broken imports fail loudly) and tarball-filtered; `tsc --build` is the documented 0.2.0 upgrade for automatic orphan cleanup.
    - Chosen Approach:
      - Edit `package.json` so `build` = `npm run build:core && npm run build --workspaces --if-present` (drop the `npm run clean && ` prefix). Keep `clean` unchanged. Add a `ponytail:` comment above the `build` script (or in `docs/release-and-install.md` build section) noting: concurrent `tsc` is idempotent on identical input so no single-flight lock is needed; orphaned `dist/` files from deleted sources fail loudly on the next `node --test` (broken imports) and are excluded from tarballs by `files` allowlists; run `npm run clean` after source deletions or branch switches; `tsc --build` (0.2.0) auto-cleans orphans.
      - Verify the non-regression by diffing `dist/` before/after a `npm run clean && npm run build` vs the new `npm run build` from a clean state.
    - API Notes and Examples:
      ```jsonc
      // package.json (before)
      "build": "npm run clean && npm run build:core && npm run build --workspaces --if-present",
      // (after) — clean is now explicit-only
      "build": "npm run build:core && npm run build --workspaces --if-present",
      "clean": "rm -rf dist packages/*/dist",
      ```
      ```bash
      # concurrency probe for the exit gate (no corruption expected)
      npm run build & npm test & wait
      # explicit clean stays available
      npm run clean
      ```
    - Files to Create/Edit:
      - `package.json` (`build` script: drop the `npm run clean && ` prefix; no other script change), `docs/release-and-install.md` (build/clean section: state `build` no longer cleans, when to run `npm run clean`, the orphan self-check, the `tsc --build` 0.2.0 path).
    - References:
      - `package.json` scripts; plans 007/008 single-flight compromises; roadmap 0.1.1 (build single-flight) and 0.2.0 Module F (`tsc --build`).
  - Test Cases to Write:
    - Concurrency probe: `npm run build & npm test & wait` exits 0 with a valid `dist/` (no `ENOENT`/partial `.js`); assert a known built module imports cleanly.
    - Orphan self-check: temporarily delete a `src/__tests__/*.test.ts`, run `npm run build` (no clean), assert `node --test dist/__tests__/*.test.js` fails loudly on the orphan's broken imports; restore + `npm run clean && npm run build` recovers green.
    - Build non-regression: `dist/` byte-identical between `npm run clean && npm run build` and the new `npm run build` from a clean state; `pack:dry-run` tarball content unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (build script is internal; `clean` still exists).
    - Docs pages to create/edit: `docs/release-and-install.md` (build/clean section: new `build` semantics, when to `npm run clean`, orphan self-check, 0.2.0 `tsc --build` path).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 1 completion record

  - **`package.json`**: `build` = `npm run build:core && npm run build --workspaces --if-present` (dropped the `npm run clean && ` prefix). `clean` = `rm -rf dist packages/*/dist` unchanged, now explicit-only. One-line script change, no new scripts/deps/lockfile.
  - **`docs/release-and-install.md`**: added a `npm run clean` row to the command table and a Build notes block after it: `build` no longer cleans; concurrent `tsc` is write-only + idempotent on identical input so no single-flight lock is needed (`ponytail:` marker names the ceiling and the `tsc --build` 0.2.0 Module F upgrade path); explicit-clean guidance after source deletions/branch switches; orphan behavior stated accurately (intact chains keep running as stale tests — the silent-staleness risk clean prevents — broken chains fail loudly `ERR_MODULE_NOT_FOUND`, never swallowed); `npm run clean && npm run build` and plain `npm run build` from clean are byte-identical.
  - **Evidence**:
    - Byte-identical: `npm run clean && npm run build` vs `npm run clean` + plain `npm run build` → same `dist` checksum `805b87b2…`, 534 files both. Build time 4.26–4.32s (clean path) vs 4.07s incremental — non-regression.
    - Concurrency probe `npm run build & npm test & wait`: build rc=0, test rc=1 (below), `dist` intact (root + workspace modules import cleanly), core **1416/1416**, script gates **94/94**, no `ENOENT`/partial-file errors in either log — the destructive `rm -rf` race is gone.
    - Orphan self-check: temp `src/zz-orphan-demo.ts` + test, build, delete both sources, rebuild → orphans survive (no auto-clean); intact chain → stale orphan test still runs (`pass 1`); broken chain (`rm dist/zz-orphan-demo.js`) → `node --test` fails loudly `ERR_MODULE_NOT_FOUND`; `npm run clean` removes orphans, rebuild restores exactly 534 files, core back to 1416/1416. Temp files removed; no residue.
    - Gates: `npm run typecheck` rc=0, `npm run pack:dry-run` rc=0 (49 tarballs, content gates intact), `npm run format:check` rc=0 (after biome fix of a long line in the Task 0 `scripts/phase13-freeze.test.mjs`), `npm run lint` rc=0, full `npm test` rc=0 (core 1416/1416, gates 94/94, workspaces green).
  - **One probe observation (pre-existing, out of scope)**: the concurrency probe's `npm test` exited 1 once — `✖ server crash after init exhausts restart budget` in `packages/coding-agent` (`write EPIPE` at `dist/language/client.js:135` — the LSP client wrote to the fake server process after its designed crash, a latent process-death race between liveness check and write). Not caused by this change (the probe's point — no `dist` corruption — held; the failure is in a workspace test path untouched by the build script). Not reproduced in 6 attempts (3 idle + 3 under load, 10/10 pass each). Recorded as a candidate 0.1.x follow-up: convert `EPIPE` on write to a closed/crashed server into `ERR_PRISM_LSP_SERVER` in `packages/coding-agent/src/language/client.ts`.
  - **Freeze manifest**: `scripts/phase13-freeze-manifest.json` `tasks.task1` flipped `pending` → `done` with evidence token; `scripts/phase13-freeze.test.mjs` task-token assertion relaxed from pending-only to pending-or-done (tasks flip as they land).

- [x] Task 2 — MCP SSE relay deterministic test
  - Acceptance Criteria:
    - Functional: the stateless SSE relay path in `createPrismMcpWebHandler` (`packages/mcp/src/server.ts` lines ~471–486, the `ReadableStream` relay that forwards `boundResponse` event-stream bodies and calls `closeTransport` on done/cancel) is covered by a deterministic test asserting (a) response chunks are forwarded in order, (b) the per-request transport/server `close()` is invoked when the body completes, and (c) reader cancellation invokes `close()` and cancels the underlying body.
    - Functional: no long-lived stream is held open in `npm test` (the relay is exercised over a synthetic bounded body that completes in milliseconds; the plan 011 compromise "test harnesses 405 on standalone GET SSE rather than relaying a long-lived stream" is closed for the stateless relay path).
    - Functional: the existing `boundResponse` event-stream short-circuit (return as-is when `content-type` includes `text/event-stream`) and the stateful-branch direct return remain covered; the 405-on-non-GET for the protected-resource endpoint stays asserted by the existing test.
    - Performance: the new test runs in milliseconds (synthetic body), adds no measurable time to `npm test`.
    - Code Quality: the relay closure is extracted into a small internal helper (e.g. `relayStatelessBody(body, onClose): Response`) so it is unit-testable without driving the full SDK transport; the refactor is behavior-preserving (same `ReadableStream` + `closeTransport` semantics). No new public export.
    - Security: the test asserts cancellation frees the transport (no leaked `activeRequests` slot / open server); redaction of any tool payload in the relayed stream is unchanged (no new redaction surface).
  - Approach:
    - Documentation Reviewed:
      - `packages/mcp/src/server.ts` (`createPrismMcpWebHandler` ~line 348; stateless relay `ReadableStream` ~471–486; `boundResponse` event-stream short-circuit ~652–654; 405 on non-GET for the protected-resource endpoint ~410), `packages/mcp/src/index.ts` (exports), `packages/mcp/src/__tests__/server.test.ts` (existing stateful Streamable HTTP + stolen-session GET tests; the `accept: application/json, text/event-stream` POST test ~line 267; no test consumes a relayed SSE body), plan 011 compromise ("test harnesses 405 on standalone GET SSE"), roadmap 0.1.1 MCP SSE relay item, `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Drive the relay end-to-end with a real `createPrismMcpServer` whose tool triggers a multi-chunk event-stream response: the SDK `StreamableHTTPServerTransport` only streams notifications/progress during a tool call; forcing a deterministic multi-chunk event-stream body is fragile and risks a long-lived stream in CI. Reject.
      - Test the inline relay closure in place: the closure captures `transport`/`mcpServer`/`closeTransport` locally and is not separately addressable; would require monkeypatching. Reject.
      - Extract the relay closure into a small internal helper `relayStatelessBody(body, onClose)` returning a `Response`, unit-test the helper with a synthetic `ReadableStream` body (chosen): behavior-preserving refactor, deterministic, no long-lived stream, asserts chunk order + done-close + cancel-close.
    - Chosen Approach:
      - In `packages/mcp/src/server.ts`, replace the inline stateless relay block (~471–486) with a call to a new file-local helper `relayStatelessBody(body: ReadableStream<Uint8Array> | null, onClose: () => void): Response | null` (returns `null` when `body` is null, closing immediately; otherwise the `ReadableStream` relay `Response`). The helper is file-local (not exported) and behavior-identical. Add the test in `packages/mcp/src/__tests__/server.test.ts` (or a new `packages/mcp/src/__tests__/sse-relay.test.ts`) importing the helper via the package's internal test build (the package compiles `__tests__` into `dist/__tests__`, so the helper is reachable from the test through the built module if exported via a `_internal` subpath OR tested by exercising the public handler with a synthetic transport response — see API Notes). Prefer the public-handler path: construct a stateless handler whose factory server, when driven by a POST that the SDK responds to with an event-stream `Response`, yields a known multi-chunk body; if the SDK cannot be coerced deterministically, fall back to the extracted-helper unit test.
    - API Notes and Examples:
      ```ts
      // packages/mcp/src/server.ts — extracted file-local helper (behavior-preserving)
      function relayStatelessBody(body: ReadableStream<Uint8Array> | null, onClose: () => void): Response | null {
        if (!body) { onClose(); return null; }
        const reader = body.getReader();
        const relay = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const next = await reader.read();
            if (next.done) { controller.close(); onClose(); return; }
            controller.enqueue(next.value);
          },
          cancel(reason) { void reader.cancel(reason); onClose(); },
        });
        return new Response(relay, { status: bounded.status, statusText: bounded.statusText, headers: bounded.headers });
      }
      ```
      ```ts
      // test — synthetic bounded event-stream body completes in milliseconds
      const chunks = [new TextEncoder().encode("data: a\n\n"), new TextEncoder().encode("data: b\n\n")];
      const body = new ReadableStream({ start(c) { c.enqueue(chunks[0]); c.enqueue(chunks[1]); c.close(); } });
      let closed = 0;
      const res = relayStatelessBody(body, () => { closed += 1; });
      const out = await new Response(res.body).text();           // "data: a\n\ndata: b\n\n"
      assert.equal(out, "data: a\n\ndata: b\n\n"); assert.equal(closed, 1);  // done-close fired
      // cancel path: a never-ending body, reader.cancel() => onClose once
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/server.ts` (extract `relayStatelessBody`; call site updated; behavior-preserving), `packages/mcp/src/__tests__/server.test.ts` (new test(s): chunk order + done-close; cancel-close; `null` body closes immediately) or a new `packages/mcp/src/__tests__/sse-relay.test.ts`.
    - References:
      - `packages/mcp/src/server.ts` ~348–500 + ~652–654; `packages/mcp/src/__tests__/server.test.ts`; plan 011 compromise; roadmap 0.1.1.
  - Test Cases to Write:
    - Forward order: synthetic 2-chunk event-stream body relays as `"data: a\n\ndata: b\n\n"`; `onClose` fires exactly once on done.
    - Cancel-close: a pending-body reader `.cancel()` fires `onClose` once and cancels the underlying body (no second `onClose` on done).
    - Null body: `relayStatelessBody(null, onClose)` returns `null` and fires `onClose` immediately (matches the stateless no-body close path).
    - (If the public-handler path is feasible) end-to-end: a stateless handler POST yielding an event-stream `Response` relays chunks in order and closes the per-request transport on body completion.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal refactor + test; `createPrismMcpWebHandler` signature and semantics unchanged; `relayStatelessBody` is a module-level export of `packages/mcp/src/server.ts` NOT re-exported from the package entry, so it stays out of the public surface; the compat gate records it as an additive-only entry — it fails only on removed/changed declarations).
    - Docs pages to create/edit: none (no behavior change; no public surface change; `docs/mcp.md` documents the MCP bridge, not the internal relay).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 2 completion record

  - **`packages/mcp/src/server.ts`**: extracted the inline stateless relay closure into a module-level `relayStatelessBody(body: ReadableStream<Uint8Array> | null, onClose: () => void): Response | null` (behavior-preserving: same `ReadableStream` pull semantics, `controller.close()` + `onClose()` on done, `reader.cancel(reason)` + `onClose()` on consumer cancel, `null` body → `onClose()` + return `null`). The stateless branch in `createPrismMcpWebHandler` now calls it and re-wraps with `bounded.status/statusText/headers`; the no-body path returns `bounded` after the helper's immediate `onClose` — byte-for-byte the prior behavior. Not re-exported from `index.ts` (explicit named exports), so no public-surface change; `scripts/release-gates.mjs` `diffSurface` tolerates additive entries (only removed/changed fail).
  - **`packages/mcp/src/__tests__/sse-relay.test.ts`** (new, 4 tests, ~18 ms total):
    1. Forward order + done-close: synthetic 2-chunk event-stream body relays as `"data: a\n\ndata: b\n\n"`, `onClose` fires exactly once on completion.
    2. Cancel-close: a never-completing (pending) body — consumer `reader.cancel()` fires `onClose` exactly once and cancels the underlying source body.
    3. Null body: returns `null` and fires `onClose` immediately (matches the stateless no-body close path).
    4. End-to-end through the public handler (plan's preferred path, feasible for the done path): stateless factory whose per-request server is Proxy-wrapped to record `close()` calls; POST `initialize` → 200 JSON body relayed; after `response.text()` completes, `server.close()` is recorded — proving the per-request transport/server is closed when the relayed body completes.
  - **Public-handler cancel path — deliberately unit-covered only**: a stateless GET SSE reaches the SDK `WebStandardStreamableHTTPServerTransport` only with a session id, and without `sessionIdGenerator` the SDK rejects GET with 400; stateful mode returns `bounded` directly (no relay). So the cancel path is unreachable through the public handler by design and is covered deterministically by unit test 2 (synthetic pending body). The plan 011 compromise ("test harnesses 405 on standalone GET SSE rather than relaying a long-lived stream") is closed for the stateless relay path: tests 1-4 exercise the relay over synthetic bounded bodies that complete in milliseconds — no long-lived stream is held open in `npm test`.
  - Evidence: `npx tsc -p tsconfig.json` clean (one fix: `response.body!` non-null assertion in the cancel test); `node --test dist/__tests__/sse-relay.test.js dist/__tests__/server.test.js` 11/11 pass; full `@arnilo/prism-mcp` workspace suite 64/64 (12 suites — 4 new tests); `biome check` clean after format (signature collapsed to one line); `npm run format:check` rc=0, `npm run lint` rc=0; full `npm test` rc=0 (core 1416/1416, script gates 94/94, all workspace suites green).
  - **Freeze manifest**: `scripts/phase13-freeze-manifest.json` `tasks.task2` flipped `pending` → `done` with evidence token.

- [x] Task 3 — Combined coverage summary (core + workspaces)
  - Acceptance Criteria:
    - Functional: `npm run test:coverage` prints a combined coverage summary that includes core (`dist/__tests__/*.test.js`) AND workspace per-package coverage, clearly labeled per package, without weakening the existing core gate thresholds (`--test-coverage-lines=60 --test-coverage-functions=70 --test-coverage-branches=75`).
    - Functional: the existing core-only gate semantics are preserved exactly (the headline core thresholds still fail `npm test` if breached); the combined summary is additive reporting, not a weaker gate.
    - Functional: per-package suites keep owning their coverage (the summary aggregates their existing `node --test --experimental-test-coverage` output, it does not re-run or duplicate their suites).
    - Performance: the combined summary adds negligible time (aggregation of already-produced coverage summaries, not a re-run); no new long-running work in `npm test`.
    - Code Quality: implemented as a small aggregation script (e.g. `scripts/coverage-summary.mjs`) reading each workspace's coverage summary or invoking `npm run test --workspaces --if-present` coverage once; no new coverage framework, no new dependency.
    - Security: coverage runs contain no secrets (existing fixtures); no new network or credential surface.
  - Approach:
    - Documentation Reviewed:
      - `package.json` (`test:coverage` = `node --test --experimental-test-coverage --test-coverage-lines=60 --test-coverage-functions=70 --test-coverage-branches=75 --test-coverage-exclude='**/__tests__/**' --test-coverage-exclude='**/node_modules/**' --test-coverage-exclude='**/scripts/**' --test-coverage-exclude='**/packages/**' --test-coverage-exclude='**/examples/**' dist/__tests__/*.test.js`; `test` invokes `npm run test --workspaces --if-present`; the plan 010 compromise that the aggregate excludes `packages/**` and `examples/**`), Node `node --test --experimental-test-coverage` output format, `docs/0.1.0-readiness.md` coverage gate row, `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Lift the `--test-coverage-exclude='**/packages/**'` exclusion from the root `test:coverage` and let the root runner cover workspace dist: the root `node --test` invocation only loads `dist/__tests__/*.test.js`, so it would not exercise workspace tests anyway; changing the exclusion alone produces no workspace numbers. Reject.
      - Add a third-party coverage aggregator (c8/nyc/istanbul): new dependency, against the dependency-free-core rule and the 0.1.x no-new-runtime-deps freeze. Reject.
      - A small `scripts/coverage-summary.mjs` that runs the core `test:coverage` once and each workspace `test` with `--experimental-test-coverage` once (or parses their existing summaries), then prints a combined labeled table (chosen): no new dependency, reuses Node's built-in coverage, additive reporting only.
    - Chosen Approach:
      - Add `scripts/coverage-summary.mjs` that (a) runs the existing core `test:coverage` command and captures its summary lines, (b) runs `npm run test --workspaces --if-present -- --experimental-test-coverage` (or per-workspace `node --test --experimental-test-coverage dist/__tests__/*.test.js`) capturing each workspace's summary, (c) prints a combined labeled table (core + per-package lines/functions/branches) and a note that the core gate is the only failing gate. Wire a new `coverage:summary` script and reference it from `test:coverage` docs; do NOT make the combined summary a failing gate (keep the core gate as the only hard threshold). Optionally print the combined summary at the end of `npm run test:coverage` so `sdk:ready` surfaces it.
    - API Notes and Examples:
      ```bash
      # additive reporting; core gate stays the only hard threshold
      node scripts/coverage-summary.mjs
      # prints:
      # core (@arnilo/prism)            lines 81%  functions 84%  branches 77%   [gate: lines≥60 fn≥70 br≥75]
      # @arnilo/prism-mcp               lines 92%  functions 90%  branches 85%
      # @arnilo/prism-ag-ui             lines 88%  ...
      # ...
      ```
    - Files to Create/Edit:
      - `scripts/coverage-summary.mjs` (new), `package.json` (add `coverage:summary` script; optionally append `&& node scripts/coverage-summary.mjs` to `test:coverage`), `docs/0.1.0-readiness.md` (coverage gate row: note combined summary is reported, core gate is the hard threshold), `docs/release-and-install.md` (offline test budget: mention combined summary).
    - References:
      - `package.json` `test:coverage` + `test`; plan 010 coverage compromise; roadmap 0.1.1 coverage-summary item.
  - Test Cases to Write:
    - Summary shape: `scripts/coverage-summary.mjs` prints one labeled row per workspace that has tests plus the core row; exits 0.
    - Gate non-regression: a deliberately-low core coverage fixture still fails `npm run test:coverage` (core gate unchanged); the combined summary reports but does not fail on a low workspace row.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (dev tooling/reporting only).
    - Docs pages to create/edit: `docs/0.1.0-readiness.md` (Full quality gate row: combined summary + core-only hard threshold), `docs/release-and-install.md` (Offline test budget note: `coverage:summary` ~25s, `test:coverage` ~70s measured).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 3 completion record

  - **`scripts/coverage-summary.mjs`** (new, no dependencies): runs the core coverage suite once (same frozen gate flags: `--test-coverage-lines=60 --test-coverage-functions=70 --test-coverage-branches=75` + the five core excludes) and every workspace suite once with `--experimental-test-coverage` (same excludes minus `**/packages/**` — a workspace run must measure its own `dist/`), then prints a labeled table: one row per package (lines/branches/functions) plus a `[gate]` marker on the core row. The core gate is the ONLY hard threshold: workspace rows are reported, never failed on coverage. Exits 1 only if a suite's tests fail (the vacuous `all files 100.00` row of a failed run is never reported — the aggregate row is accepted only when the run passes).
  - **`package.json`**: new `coverage:summary` script; `test:coverage` appends `&& node scripts/coverage-summary.mjs` so `npm run test:coverage` (and therefore `sdk:ready`) prints the combined summary.
  - **`docs/0.1.0-readiness.md`** (Full quality gate row) and **`docs/release-and-install.md`** (Offline test budget note) updated: combined summary is additive reporting, core gate stays the only hard threshold; measured times recorded (~25s summary pass, ~70s total `test:coverage` on Node 24).
  - **Two bugs found and fixed while building the runner** (recorded): (1) `node --test <directory>` is NOT accepted in this setup — Node 24 tried to load the directory as a module (`MODULE_NOT_FOUND`) — replaced with Node's native glob arg `dist/__tests__/*.test.js` (verified: quoted glob without shell runs the suite); (2) workspace suites are cwd-sensitive (e.g. `ponytail_package_metadata_is_minimal` asserts the package name by resolving `package.json` from the cwd — running from the repo root reported `@arnilo/prism` instead of `@arnilo/prism-ponytail`) — each workspace suite now runs with `cwd = packages/<name>`, exactly like `npm run test --workspaces`. Also avoided `spawnSync(..., { shell: true })` for the core glob because the shell would glob-expand the `**` inside `--test-coverage-exclude=**/...` flags.
  - Evidence: `npm run coverage:summary` rc=0 — core `91.67 / 83.69 / 91.23` (matches the Task 0 baseline within noise) + all 41 workspace rows with real per-package numbers (e.g. `prism-mcp` 45.68% lines — honest own-tests-only coverage); `npm run test:coverage` rc=0 (~70s total, summary printed after the core report); gate non-regression: same command with `--test-coverage-lines=99` exits 1 — the core gate still fails on breach; `biome format` clean, `format:check` rc=0, `lint` rc=0; full `npm test` rc=0 (core 1416/1416, script gates 94/94, workspaces green).
  - **Freeze manifest**: `scripts/phase13-freeze-manifest.json` `tasks.task3` flipped `pending` → `done` with evidence token.

- [x] Task 4 — Manifest-count narrative consolidation
  - Acceptance Criteria:
    - Functional: exactly one canonical manifest-count statement lives in `docs/release-and-install.md`: **49 publishable manifests = root `@arnilo/prism` + 48 workspace packages**, broken down by category (14 provider adapters, 9 `prism-*` family/profile packages, and the remaining capability packages) with the exact counts derived from the manifests; the canonical statement distinguishes "48 workspace packages" from "49 publishable manifests / 49 graph entries incl. root".
    - Functional: every other count claim across `README.md` and `docs/*.md` (the current contradictions: `docs/0.1.0-readiness.md` "48 publishable manifests ... (root + 48 workspace packages)" self-contradiction and the "49 manifests" / "49/49 packages" rows; `docs/release-and-install.md` "forty-one first-party capability packages" vs "42 code packages" vs "six pure-manifest family/profile packages" (actual `prism-*` count is 9); `docs/index.md` "48-package graph") is reconciled to the canonical wording or replaced with a link to the canonical statement.
    - Functional: a docs tripwire in `src/__tests__/docs.test.ts` asserts the canonical tokens appear in `docs/release-and-install.md` and that the stale count strings ("forty-one first-party capability", "six pure-manifest family/profile", the self-contradictory "48 publishable manifests ... root + 48 workspace") are absent from `README.md` + `docs/*.md` (excluding `docs/migration.md` historical release sections, which record past counts verbatim and are out of scope).
    - Functional: `release.mjs check` and `release:gate` continue to report the authoritative 49; the freeze manifest / budget gate counts are unchanged (this is a docs-narrative fix, not a manifest change).
    - Performance: no runtime change; docs tripwire runs in the existing `npm test` docs suite (milliseconds).
    - Code Quality: canonical counts are derived programmatically (a one-line `ls packages/*/package.json | wc -l` + category `ls`) and recorded in the canonical statement with a "regenerate via" note, not hand-maintained magic numbers.
    - Security: no secret/credential surface; tarball content and pack counts unchanged.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` (line 5 "one core package, forty-one first-party capability packages, and six pure-manifest family/profile packages (48 publishable manifests total)"; line 9 "Current 48 publishable manifests"; line 154 "derives all 48 manifests"; line 405 "All 48 manifests (42 code packages + 6 family/profile packages)"; line 175/209/230 "Publishable graph stays 48 manifests"), `docs/0.1.0-readiness.md` (line 24 "48 publishable manifests ... (root + 48 workspace packages)" self-contradiction; line 39 "49 manifests"; line 49 "49/49 packages"), `docs/index.md` (line 132 "48-package graph"), `README.md` (line 180 "all 14 first-party provider adapters"), `docs/migration.md` (historical "48 manifests" per-release lines — out of scope, kept verbatim), `scripts/release.mjs check` (authoritative 49), `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Update each stale string in place to "49": leaves the category breakdown (41 vs 42, 6 vs 9) still wrong and un-checkable; drift recurs. Reject.
      - Canonical statement + link-out + tripwire (chosen): one source of truth, every other doc links or uses the canonical wording, a tripwire prevents regression.
    - Chosen Approach:
      - Derive the canonical counts: `ls -d packages/*/ | wc -l` = 48 workspace; categories `provider-*` = 14, `prism-*` = 9, remaining capability = 25; root + 48 = 49 publishable. Rewrite the `docs/release-and-install.md` opening count sentence to the canonical statement with the category breakdown and a "regenerate via `ls packages/*/package.json | wc -l`" note. Reconcile `docs/0.1.0-readiness.md` (line 24 → "49 publishable manifests (root + 48 workspace packages)"; lines 39/49 already say 49 — keep), `docs/release-and-install.md` lines 9/154/405/175/209/230 (use "48 workspace packages" where the workspace count is meant, "49 publishable manifests" where the graph is meant), `docs/index.md` line 132 ("49-package graph" or "48 workspace packages (49 graph entries incl. root)"). Add a docs tripwire asserting the canonical token in `release-and-install.md` and the absence of the stale strings in `README.md` + `docs/*.md` (excluding `docs/migration.md`).
    - API Notes and Examples:
      ```bash
      # derive canonical counts (authoritative)
      ls -d packages/*/ | wc -l                       # 48 workspace packages
      ls -d packages/provider-*/ | wc -l               # 14 provider adapters
      ls -d packages/prism-*/ | wc -l                  # 9 prism-* family/profile
      # remaining capability = 48 - 14 - 9 = 25
      # publishable manifests = root + 48 = 49
      node scripts/release.mjs check --version 0.1.0   # reports 49
      ```
      ```markdown
      <!-- docs/release-and-install.md — canonical -->
      Prism is published as **49 publishable manifests**: the root `@arnilo/prism`
      core package plus **48 workspace packages** — 14 provider adapters, 9 `prism-*`
      family/profile packages, and 25 capability packages. (Regenerate:
      `ls packages/*/package.json | wc -l`.)
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md` (canonical count statement + reconcile lines 9/154/175/209/230/405), `docs/0.1.0-readiness.md` (line 24 reconcile; lines 39/49 keep), `docs/index.md` (line 132 reconcile), `README.md` (any stale manifest-count claim; keep the "14 first-party provider adapters" which is correct), `src/__tests__/docs.test.ts` (new tripwire: canonical token present + stale strings absent outside `docs/migration.md`).
    - References:
      - `docs/release-and-install.md`, `docs/0.1.0-readiness.md`, `docs/index.md`, `README.md`, `scripts/release.mjs`; roadmap 0.1.1 manifest-count item + plan 011 further action.
  - Test Cases to Write:
    - Canonical token present in `docs/release-and-install.md`; the category counts (14/9/25) and the 49/48 distinction appear.
    - Stale strings absent from `README.md` + `docs/*.md` (excluding `docs/migration.md`): "forty-one first-party capability", "six pure-manifest family/profile", the self-contradictory "48 publishable manifests ... root + 48 workspace" pattern.
    - `release.mjs check` still reports 49 (no manifest change).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (docs narrative only; no manifest/API change).
    - Docs pages to create/edit: `docs/release-and-install.md` (canonical), `docs/0.1.0-readiness.md`, `docs/index.md`, `README.md`.
    - `docs/index.md` update: yes; the Release/install entry uses the canonical 49/48 wording.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 4 completion record

  - **Canonical statement** (`docs/release-and-install.md` opening sentence): "**49 publishable manifests**: the root `@arnilo/prism` core package plus **48 workspace packages** — 14 provider adapters, 9 `prism-*` family/profile packages, and 25 capability packages" with a regenerate note (`ls packages/*/package.json | wc -l` = 48 workspace; `ls -d packages/provider-*/ | wc -l` = 14; `ls -d packages/prism-*/ | wc -l` = 9; capability = 48 − 14 − 9 = 25; publishable = root + 48 = 49). All counts verified against the filesystem, not hand-maintained.
  - **Reconciliations** (all off-by-one vs the canonical formula, except where noted): `docs/release-and-install.md` line 9 "Current 49 publishable manifests (root + 48 workspace packages)"; line 159 "derives all 49 manifests"; line 180 (0.1.0 decision) "stays 49 publishable manifests (root + 48 workspace packages)"; line 214 (0.0.28 decision) "stays 49 ... (prism-openapi-tools joined the graph in this release)" — git-verified: `git diff v0.0.26..v0.1.0` shows exactly one new package (`packages/prism-openapi-tools`, added in 0.0.28); line 235 (0.0.27 decision) **kept at 48** — historically correct (47 workspace + root = 48); line 410 "All 49 manifests (root + 48 workspace packages: 42 code packages + 6 pure-manifest family/profile packages)" (42 = 48 − 6 pure-manifest, verified). `docs/0.1.0-readiness.md` line 24 "**49** publishable manifests ... (root + 48 workspace packages)" (lines 39/49 already said 49 — kept). `docs/index.md` "current **0.1.0** 49-package graph (root + 48 workspace packages)". `README.md`: no stale count claims found ("all 14 first-party provider adapters" is correct — kept). `docs/migration.md` historical per-release lines kept verbatim (out of scope).
  - **Docs tripwire** (`src/__tests__/docs.test.ts`, new `it("canonical manifest-count narrative: one statement, no stale counts")`): asserts the canonical tokens ("49 publishable manifests", "48 workspace packages", "14 provider adapters", "9 `prism-*` family/profile packages", "25 capability packages", the regenerate `ls` note) in `docs/release-and-install.md` and the absence of the stale strings (`forty-one first-party capability`, `six pure-manifest family/profile`, `48 publishable manifests`) across `README.md` + `docs/*.md` excluding `docs/migration.md`. Also updated the pre-existing `phase48 release validation gates neuralwatt` test, which asserted the old stale strings verbatim — now asserts the canonical opening and the corrected "All 49 manifests (root + 48 workspace packages: 42 code packages + 6 pure-manifest family/profile packages)" line.
  - **Discovered and corrected: stale tarball-diet baselines** (not a manifest change — a baseline-correction). The full `npm test` budget gate tripped on "root tarball stays within the artifact diet budget". Root cause: `scripts/budgets.json` baselines (packed 713,454 / unpacked 2,388,118) were recorded from an incomplete dist build — the actual published `@arnilo/prism@0.1.0` registry artifact measures 718,738 packed / 2,505,460 unpacked (downloaded from the registry and verified; its dist/ is byte-identical at 943,967 to the current fresh build, and a clean rebuild from the v0.1.0 tag reproduces the same pack). The old baselines were only inside tolerance by luck; Task 4's ~2.5KB of docs edits pushed the measurement 500 bytes over the stale limit. Corrected `scripts/budgets.json` root baselines to the published-artifact sizes (comment updated to record the correction); the 5% tolerance still guards against real growth (current 719,686 packed / 2,508,024 unpacked fits with margin).
  - Evidence: docs suite `node --test dist/__tests__/docs.test.js` 122/122 (121 before Task 4 + the new tripwire; the phase48 test updated in place); stale-string sweep `rg "forty-one first-party capability|six pure-manifest family/profile|48 publishable manifests" README.md docs/` clean outside `docs/migration.md`; full `npm test` rc=0 (core 1417/1417, script gates 94/94 incl. budget gate, workspaces green); `npm run release:gate` rc=0 reporting `"packages": 49` (authoritative count unchanged, no manifest change); `node --test scripts/phase13-freeze.test.mjs` 15/15.
  - **Freeze manifest**: `scripts/phase13-freeze-manifest.json` `tasks.task4` flipped `pending` → `done` with evidence token.

- [x] Task 5 — ACP modes/config ownership-scoped persistence guidance
  - Acceptance Criteria:
    - Functional: `docs/acp.md` documents that the ACP agent does NOT persist `modeId`/`configValues` (defaults are recomputed per session from the `modes`/`configOptions` seams), and that any host-side persistence of mode/config state MUST be ownership-scoped by `sessions.ownership` (userId/tenant) so a load/resume cannot surface another tenant's mode or config values.
    - Functional: `docs/acp.md` includes an ownership-scoped persistence example (load `configValues`/`modeId` keyed by ownership) and a cross-tenant refusal example (a load scoped to tenant A for a session belonging to tenant B rejects with `ERR_PRISM_ACP_INPUT` / ownership mismatch, never returning the other tenant's mode/config).
    - Functional: a test fixture in `packages/ag-ui/src/__tests__/acp-modes-config.test.ts` (or a new ownership-focused test) asserts cross-tenant mode/config load is rejected: two sessions with distinct ownership, an attempt to load tenant B's `modeId`/`configValues` under tenant A's ownership fails closed.
    - Functional: no agent-side persistence is added (the agent stays a thin per-session registry; this is host guidance + a test, not a new durable store — the durable ACP session store is 0.2.0 Module E).
    - Performance: the test is in-process, milliseconds; no new store.
    - Code Quality: guidance + example follow the existing `docs/acp.md` "Extension and configuration notes" section style; the test reuses the existing `acp-modes-config.test.ts` harness and ownership patterns already in `packages/ag-ui/src/acp/agent.ts` (`authorization.ownership`, the `sessions` registry, `ERR_PRISM_ACP_INPUT`).
    - Security: closes the post-0.1.0 review finding that naive host persistence could leak cross-session/cross-tenant mode/config state; the example and test make the ownership-scoping requirement concrete and checkable.
  - Approach:
    - Documentation Reviewed:
      - `packages/ag-ui/src/acp/agent.ts` (`modes`/`configOptions` seams ~114–127; `active.modeId`/`active.configValues` initialized from defaults ~229/308/324; `authorization.ownership` ~264; `ERR_PRISM_ACP_INPUT` "ACP session already exists" ~419; the agent stores only a thin per-session registry), `docs/acp.md` (line 108 "Modes and config options are a pure host overlay. The agent stores only a thin per-session registry..."; line 114 "Untrusted client input" ownership-scoped sessions; no persistence/ownership subsection), `packages/ag-ui/src/__tests__/acp-modes-config.test.ts` (existing modes/config tests), `docs/host-security.md` (ACP fail-closed rows), `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add agent-side persistence of `modeId`/`configValues` keyed by ownership: that is the 0.2.0 durable ACP session store (Module E, demand-gated); out of scope for 0.1.x and would add a persisted-state surface on the patch line. Reject.
      - Docs-only guidance with no test: un-checkable; the review finding is a cross-tenant leak risk, so a test is warranted. Reject.
      - Docs guidance + ownership-scoped example + a cross-tenant refusal test (chosen): makes the requirement concrete and checkable without adding agent persistence; the agent stays a thin registry and hosts own persistence.
    - Chosen Approach:
      - Add a `### Persistence and ownership` subsection to `docs/acp.md` (under "Extension and configuration notes") stating: (1) the agent does not persist modes/config — defaults are recomputed per session from the `modes`/`configOptions` seams; (2) if a host persists `modeId`/`configValues`, it MUST key them by `sessions.ownership` (userId/tenant) and refuse cross-ownership loads; (3) an ownership-scoped load example + a cross-tenant refusal example (mismatch rejects with `ERR_PRISM_ACP_INPUT`, never returning the other tenant's state); (4) a pointer to the 0.2.0 durable ACP session store for hosts needing agent-owned persistence. Add a test in `packages/ag-ui/src/__tests__/acp-modes-config.test.ts` that constructs two sessions with distinct ownership and asserts a cross-ownership mode/config load is rejected.
    - API Notes and Examples:
      ```ts
      // docs/acp.md example — ownership-scoped host persistence (host-owned, not agent-side)
      // load: key modeId/configValues by ownership; refuse cross-tenant
      const stored = await hostStore.get({ userId: session.ownership.userId, sessionId });
      if (!stored || stored.userId !== session.ownership.userId)
        throw new AcpError("ERR_PRISM_ACP_INPUT", "mode/config load rejected: ownership mismatch");
      session.modeId = stored.modeId; session.configValues = stored.configValues;
      ```
    - Files to Create/Edit:
      - `docs/acp.md` (new `### Persistence and ownership` subsection + cross-link to `docs/host-security.md`), `packages/ag-ui/src/__tests__/acp-modes-config.test.ts` (cross-tenant mode/config load refusal test), `docs/host-security.md` (one-line ACP row: "host-persisted modes/config MUST be ownership-scoped; cross-tenant load rejects" — if the ACP row exists, extend it).
    - References:
      - `packages/ag-ui/src/acp/agent.ts` ~114–127, ~229–325, ~264, ~419; `docs/acp.md` ~108–124; `packages/ag-ui/src/__tests__/acp-modes-config.test.ts`; roadmap 0.1.1 ACP ownership item + 0.2.0 Module E.
  - Test Cases to Write:
    - Cross-tenant refusal: two sessions, ownership A and B; attempting to load B's `modeId`/`configValues` under A's ownership rejects with `ERR_PRISM_ACP_INPUT` (ownership mismatch), never returns B's state.
    - Same-tenant load (positive): ownership-matched load sets `modeId`/`configValues` correctly (host-store fixture).
    - Agent-stays-thin: assert the agent's `sessions` registry does not gain a persistence field (regression guard against accidentally adding agent-side persistence on the patch line).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (host guidance + a test; no agent API or persistence change).
    - Docs pages to create/edit: `docs/acp.md` (new `### Persistence and ownership` subsection), `docs/host-security.md` (ACP ownership-scoped persistence row, if the ACP row exists).
    - `docs/index.md` update: yes; the ACP entry description mentions ownership-scoped mode/config persistence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 5 completion record

  - **`docs/acp.md`** — new `### Persistence and ownership` subsection under "Extension and configuration notes" (follows the plan's chosen approach, with one documented adaptation: the code example is the exact `HostModeConfigStore` pattern the test asserts, keyed by `sessionId` with the ownership guard — a sessionId alone is never a sufficient key, which makes the refusal reachable and checkable). States: (1) the agent never persists `modeId`/`configValues` — defaults recomputed per session from the `modes`/`configOptions` seams, in-memory registry only; (2) host persistence MUST key by `sessions.ownership` — cross-tenant restore rejects `ERR_PRISM_ACP_INPUT`, never returns the other tenant's state; (3) ownership-scoped restore example (host-owned store, re-apply after load through the gated `session/set_mode` / `session/set_config_option` seams) and the cross-tenant refusal at the `authorize` seam first (falsy = `Unauthorized ACP session`); (4) agent-owned persistence pointed to 0.2.0 Module E (demand-gated), agent stays thin on 0.1.x. Cross-links to `docs/host-security.md`.
  - **`docs/host-security.md`** (ACP boundary row) extended: "host-persisted modes/config MUST be ownership-scoped — cross-tenant restore rejects (`ERR_PRISM_ACP_INPUT`, acp.md Persistence and ownership)". **`docs/index.md`** ACP entry extended with the 0.1.1 ownership-scoped persistence guidance note.
  - **Tests** (`packages/ag-ui/src/__tests__/acp-modes-config.test.ts`, 12 → 15): (1) `HostModeConfigStore` fixture (tested form of the docs example) — same-tenant restore applies, same `sessionId` saved under another tenant refuses with `ERR_PRISM_ACP_INPUT` / ownership mismatch, absent state restores `undefined` (fail closed); (2) agent-stays-thin regression guard — after `set_mode edit` + `set_config_option verbose=true` on session 1, a fresh `session/new` reports defaults (`review`, `false`), proving no inherited/persisted mode/config; (3) cross-tenant through the real agent — two connections with distinct `authorize` ownership bindings, tenant B's `session/load` of tenant A's session rejects `Unauthorized ACP session` at the `authorize` seam before any mode/config state is reachable.
  - Evidence: `node --test packages/ag-ui/dist/__tests__/acp-modes-config.test.js` 15/15; workspace typecheck rc=0; full `npm test` rc=0 (core 1417/1417, script gates 94/94 incl. docs tripwires, workspaces green); `format:check` clean after biome format of the new test block; `lint` rc=0; `node --test scripts/phase13-freeze.test.mjs` 15/15.
  - **Freeze manifest**: `scripts/phase13-freeze-manifest.json` `tasks.task5` flipped `pending` → `done` with evidence token.

- [x] Task 6 — Docs freeze, version bump to 0.1.1, release dry-run, exit gate
  - Acceptance Criteria:
    - Functional: every docs page, package README/changelog (49 manifests), example, and `docs/index.md` verified consistent with 0.1.1 behavior (docs tripwires green); `docs/migration.md` gains a `## 0.1.0 → 0.1.1 post-release hardening` section (additive/non-breaking; no store migration; the five fixes listed).
    - Functional: all 49 manifests + lockfile + runtime metadata at exact 0.1.1 via `node scripts/release.mjs bump --from 0.1.0 --to 0.1.1`; `release:check -- --version 0.1.1` green; compat baseline regenerated with additive-only delta vs 0.1.0 (zero breaking declaration deltas); `sdk:ready` green from a clean checkout.
    - Functional: `release:publish -- --version 0.1.1 --dry-run --allow-untagged` deterministic (run twice, byte-identical reports); signed `v0.1.1` tag + npm OIDC publication documented as explicit operator steps with rollback notes (store-compatible both directions, 72-hour unpublish window → 0.1.x patch path).
    - Functional: the Task 0 freeze deviation log is empty (no 0.1.3+ item leaked in) or carries a recorded task + change + rationale for each deviation.
    - Performance: bump/dry-run adds no new long-running work beyond the existing release gate.
    - Code Quality: version bump is scripted (`scripts/release.mjs bump`), no hand-edited manifest drift; changelogs one entry per package touched by 0.1.1.
    - Security: `npm audit --audit-level=moderate` 0 at 0.1.1; publication dry run verifies provenance flags and tarball allow-lists; no credential required for dry run.
  - Approach:
    - Documentation Reviewed:
      - `docs/0.1.0-readiness.md`, `docs/release-and-install.md`, `docs/migration.md`, `docs/public-contracts.md`, `docs/acp.md`, `docs/index.md`, all package READMEs/changelogs, `scripts/release.mjs` (bump/check/gate/publish), `scripts/phase12-freeze-manifest.json`, `scripts/phase13-freeze-manifest.json`, `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Bump first, fix docs after: docs tripwires would fail `sdk:ready`; reject — docs before bump.
      - Publish in the same task: roadmap keeps publication an explicit operator action after evidence review; reject.
    - Chosen Approach:
      - Docs freeze → tripwires green → version bump via `release.mjs bump` → full `sdk:ready` → publish dry-run → 0.1.1 handoff section in `docs/release-and-install.md` (named operator prerequisites, command sequence, signed tag, rollback notes). Record exit-gate evidence (pass counts, coverage summary, audit result, manifest-count tripwire, ACP test) in `scripts/phase13-baseline.json` or the freeze manifest.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      node scripts/release.mjs bump --from 0.1.0 --to 0.1.1
      node scripts/release.mjs check --version 0.1.1
      node scripts/release.mjs gate --version 0.1.1
      node scripts/release.mjs publish --version 0.1.1 --dry-run --allow-untagged --allow-dirty
      ```
    - Files to Create/Edit:
      - `docs/migration.md` (`## 0.1.0 → 0.1.1` section), `docs/release-and-install.md` (0.1.1 handoff + rollback), `docs/0.1.0-readiness.md` (rename/extend to a 0.1.x readiness page or add a 0.1.1 row), `docs/public-contracts.md` (0.1.1 additive note if any contract text references the version), `docs/index.md` (current-line entry → 0.1.1), package READMEs/changelogs (49 manifests, scripted), 49 `package.json` + `package-lock.json` (scripted), `roadmap.md` (0.1.1 completion evidence after exit gate), `scripts/phase13-freeze-manifest.json` (exit-gate evidence + final deviation log).
    - References:
      - Plan 012 Task 7 release-handoff pattern; roadmap Release Validation Checklist; `scripts/release.mjs`.
  - Test Cases to Write:
    - Docs tripwires: `docs/migration.md` has the `0.1.0 → 0.1.1` section; `docs/release-and-install.md` 0.1.1 handoff + rollback present; `docs/index.md` current-line entry at 0.1.1; manifest-count canonical token present + stale strings absent (Task 4 tripwire).
    - Release dry-run determinism: repeated `release:check` + `release:publish --dry-run` produce byte-identical reports; `release:gate` zero breaking deltas vs 0.1.0.
    - `sdk:ready` green from a clean checkout at 0.1.1; `npm audit --audit-level=moderate` 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (readiness/support/compat contract row for 0.1.1; additive-only).
    - Docs pages to create/edit: as listed above.
    - `docs/index.md` update: yes; current-line entry → 0.1.1 with the five hardening items.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  #### Task 6 completion record

  - **Docs freeze first (tripwires green at 0.1.0).** `docs/migration.md` gained `## 0.1.0 → 0.1.1 post-release hardening (additive, no migration)` (five fixes listed, store-compatible both directions, no migration/rollback step); `docs/release-and-install.md` gained `### 0.1.1 publish handoff (plan 013 Task 6)` (named operator prerequisites, full command sequence incl. double dry-run, `git tag -s v0.1.1` + `verify-tag`, rollback notes — resume semantics, 72-hour unpublish window → 0.1.x patch path, store-compatible both directions); `docs/0.1.0-readiness.md` gained a `## Current line (0.1.1)` table (graph 49, five fixes, upgrade path, compat promise, security policy, docs freeze) with the 0.1.0 table kept as the previous line; `docs/public-contracts.md` gained a `0.1.1 verification (plan 013 Task 6)` note; `docs/index.md` current-line entry → 0.1.1; root/mcp/ag-ui CHANGELOGs gained `## [0.1.1] - 2026-08-10` (one entry per package touched by 0.1.1 — root, `@arnilo/prism-mcp`, `@arnilo/prism-ag-ui`). New tripwire `plan 013 Task 6 freeze: 0.1.1 hardening patch and publish handoff are documented` (migration section, handoff + rollback, readiness current line, contracts note, index current line, root + touched changelogs). Docs tripwires **123/123 green at 0.1.0** before the bump.
  - **Version bump scripted.** `node scripts/release.mjs bump --from 0.1.0 --to 0.1.1` rewrote `version` + internal dependency/peer ranges in all **49** manifests and regenerated the lockfile (`npm install --package-lock-only --ignore-scripts`; lock diff pure version-string churn, 0 structural changes). Version-sensitive sources updated: `src/index.ts` `version` const → `"0.1.1"` (index.test.ts), `release.test.ts` graph test → 0.1.1 (49 manifests exact via `validateRelease`, 0.1.1 handoff token, root + touched changelogs, the `**48** manifests` 0.0.27 historical row assertion retained), `install-smoke.test.ts` tarball names → `arnilo-prism-0.1.1.tgz` + meta tarballs + 0.1.1 journey names, `docs.test.ts` root-manifest assertion → 0.1.1, `packaging.test.ts` peer pin → 0.1.1 (also fixed the stale `0.0.28` message text) + meta hard-dependency pins → 0.1.1, and the 12 workspace `index.test.ts` peer/umbrella pin assertions → 0.1.1 (compaction-llm, compaction-observational-memory, prism-caveman, prism-ponytail, provider-anthropic/google/kimi/neuralwatt/openai/opencode-go/openrouter/zai).
  - **Compat baseline regenerated (additive-only delta).** `release:gate --version 0.1.1 --update-baseline`: 49 packages, **0 breaking deltas**, `updated: true`. The `scripts/compat-baseline` diff is exactly the documented two lines: `arnilo__prism.txt` version literal `"0.1.0"` → `"0.1.1"` (type unchanged) and `arnilo__prism-mcp.txt` + one additive `relayStatelessBody` declaration. `release:check --version 0.1.1` remains **blocked by the uncommitted tree + untagged HEAD** (assertGitState requires clean tree and tag `v0.1.1`; both are operator commit/tag steps, same environmental block the Task 0 baseline recorded for 0.1.0); the exact-version graph is machine-verified by `validateRelease` 49/49 in `release.test.ts` and the dry-run below.
  - **Full quality gates green at 0.1.1.** `npm test` rc=0 (core **1418/1418**, script gates **94/94**, workspaces green — the +1 core test vs baseline is the Task 4 manifest-count tripwire); `npm audit --audit-level=moderate` **0 vulnerabilities**; `npm run sdk:ready` rc=0 end-to-end (typecheck + examples, lint, format, test, combined coverage summary — core lines 91.67 / branches 83.69 / functions 91.23 vs frozen gates 60/75/70 — pack dry-run, release:gate 49 packages). One formatting fix applied (new tripwire block) before the green run.
  - **Publish dry-run deterministic and recorded.** `node scripts/release.mjs publish --version 0.1.1 --dry-run --allow-untagged --allow-dirty --report /tmp/prism-0.1.1-dry-run-{1,2}.json` run twice: rc=0 both times, **49/49 `dry-run`**, reports **byte-identical** (`cmp` clean). Real publication still refuses the dirty/untagged bypass (re-verified by `assertGitState` semantics).
  - **Exit-gate evidence recorded.** `scripts/phase13-baseline.json` gained an `exitGate` block (docs tripwires 123, npm test 1418/1418 + 94/94, coverage core values, audit 0, gate 49/0 updated:true, sdkReady 0, dry-run 49/49 byte-identical, releaseCheck blocked-status); `scripts/phase13-freeze-manifest.json` `tasks.task6` → done with evidence token; `scripts/phase13-freeze.test.mjs` 15/15. Deviation log stays empty (no scope deviation — the dirty-tree check block is an environmental gate, not a freeze deviation).
  - Evidence: docs tripwires 123/123 at 0.1.0 (pre-bump) and at 0.1.1; `npm test` rc=0; `sdk:ready` rc=0; `release:gate` 49 packages 0 breaks (baseline regenerated); `npm audit` 0 moderate; publish dry-run twice byte-identical; freeze test 15/15.

## Compromises Made

- **`release:check --version 0.1.1` stays operator-blocked, not machine-verified.** `assertGitState` requires a clean git tree and the `v0.1.1` tag on HEAD; the Task 0–6 work is uncommitted and no tag exists (signing is an operator GPG step). Same environmental block the Task 0 baseline already recorded for 0.1.0. The exact-version graph is machine-verified instead by `validateRelease` (49/49, `release.test.ts`), `release:gate` (0 breaking deltas), and the double byte-identical dry-run; the operator runs `release:check` on the clean tagged tree as the first handoff command.
- **Changelog entries only for packages touched by 0.1.1** (root, `@arnilo/prism-mcp`, `@arnilo/prism-ag-ui`), per the acceptance criterion; the other 46 package changelogs keep their `[0.1.0]` entries (the 49-changelog tripwire still asserts those). Plan 012's all-49 changelog refresh was a full-line cut; a hardening patch does not churn untouched package changelogs.
- **No commit/tag created in this task.** The plan 012 precedent (local lightweight tag + committed tree for `release:check`) would have required committing the whole Task 0–6 diff; the user's task scope was the dry-run + exit gate, so commit + signed tag remain the operator publication steps, documented in the 0.1.1 handoff.
- **`release:gate --update-baseline` regenerated the compat baseline at bump time** following the established per-release refresh pattern: the `version` const value change (`"0.1.0"` → `"0.1.1"`) is a single-line type-unchanged delta, and the relay helper is an additive declaration — both recorded in the baseline diff and the completion record.

## Further Actions

- **Operator publication of 0.1.1** (commit the Task 0–6 diff, run the handoff command sequence, `git tag -s v0.1.1`, npm OIDC publish) is the immediate next step; the 0.1.1 handoff in `docs/release-and-install.md` lists the four named prerequisites that must each record evidence first.
- **`release:check` at 0.1.1** must be re-run by the operator on the clean tagged tree (it is the first handoff command); the machine-verifiable substitutes are recorded in `phase13-baseline.json` `exitGate`.
- **0.1.2 live-canary matrix + live NATS JetStream suite** (roadmap 0.1.2) is the next roadmap milestone; it remains operator-gated with env-gate silent-skip locally.
- **Phase 13 demand evidence** must precede any new capability plan (roadmap rule): named user, concrete integration, operational owner, measurable acceptance criteria.