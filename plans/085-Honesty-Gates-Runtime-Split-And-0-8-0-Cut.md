# Honesty Gates, Channel Runtime Split, and 0.8.0 Cut

Status: complete (2026-09-18). Owns the **0.8.0 lockstep cut** that [080 Task 10](080-Messaging-Channel-Followons-And-0-8-0-Cut.md) left open. 080 Tasks 1–9, [081](081-Connected-Apps-Mcp-Host-And-Work-Http.md), [082](082-Package-Evidence-Generation-And-Connected-App-Follow-Up-Review.md), [083](083-Prism-Work-Package-Sandbox-And-Skills.md), and [084](084-Host-Long-Run-Durability-Steering-And-Honesty-Surfaces.md) are already on this 0.7.0 tree as unreleased work; this plan does not re-implement them. Publication stays operator-authorized.

Derived from the 2026-09-17 Prism codebase review (suggested order items 1–7). Research updated: 2026-09-17; Task 0 completed 2026-09-17.

## Objectives

- Make release/coverage/wiki evidence **this-tree honest**: a Postgres/NATS pass is a run against this commit, the coverage artifact names live packages, and the wiki isolation gate does not flake under `npm test` load.
- Pin the observational-memory worker as **tool-only** and stop classifying its errors by English message prefix.
- Stop pretending a swallowed channel lease `releaseLease` succeeded.
- Split `packages/prism-channels/src/runtime.ts` (2018 lines) so no file in that split exceeds 800 lines, with `createMessagingRuntime` still the only public export.
- Delete vacuous provider `index.test.ts` source-regex tests; wire or delete the unused `_` bindings they were hiding from.
- One `retryableAdmission` helper; table-driven work-tool registration. No new public symbols.
- Cut **0.8.0** (lockstep, current-contract docs, protected verification, operator handoff) covering 079–085. Registry/tag writes stay out of this plan.

## Expected Outcome

After Tasks 1–6, `npm test` is green without nested-runner flakes, `scripts/coverage-summary.json` keys match live `package.json` names, `release:gate` cannot report Postgres pass from a stale phase baseline, OM workers ignore non-tool events on purpose, a failed lease release leaves the in-memory lease held, `runtime.ts` is no longer a 2000-line closure, and provider/work diffs are deletions plus one registrar.

After Tasks 7–8 the tree is publish-ready at **0.8.0** across all **11** manifests. An operator can follow `docs/history/release-handoffs.md` to tag and publish; this plan does not write the registry.

## Tasks

- [x] **Task 0 — Primitive review and non-goals freeze**
  - Acceptance Criteria:
    - Functional: `docs/history/085-honesty-and-cut-primitive-review.md` inventories (with file:line) the skip-manifest Postgres inherit, coverage artifact `@arnilo/prism-office` vs live `@arnilo/prism-work`, wiki nested `node --test` flake, OM worker `event.type !== "tool_call"` continue, `releaseLease` catch-swallow, `createMessagingRuntime` nested helpers, eleven provider `index.test.ts` source-regex files, `_fetchUrl` / `_bearerHeaders` / `_assignable`, duplicated `retryableAdmission`, and `pushM365Tools` / `pushGwsTools`. Each review item 1–6 maps to Tasks 1–6. Item 7 non-goals are written as a table (out of this plan). 0.8.0 inventory lists 079–085 surfaces the cut changelog must name. 080 Task 10 is marked superseded-by-this-plan in the evidence doc (checkbox stays for Task 7 to tick).
    - Performance: review is docs + existing probes only; no new runtime cost. Record current packed/export ceilings for `@arnilo/prism-channels`, `@arnilo/prism-memory`, `@arnilo/prism-work`, `@arnilo/prism-providers` as the Task 7 baseline.
    - Code Quality: no new public symbols. Evidence cites file:line and current Node 24 / Prism docs, not training memory.
    - Security: threat rows for (1) inherited Postgres pass hiding SQL defects, (2) lease-release swallow double-running a binding, (3) OM text-as-observation silently dropped if we later “keep text” without a writer. Deny-by-default and fail-closed store semantics stay.
  - Approach:
    - Documentation Reviewed:
      - [docs/testing.md](../docs/testing.md) isolation rules; [docs/release-and-install.md](../docs/release-and-install.md) 11-package inventory; [docs/compaction-observational-memory.md](../docs/compaction-observational-memory.md) worker limits; [docs/messaging-channel-operations.md](../docs/messaging-channel-operations.md) lease claim/release; [docs/messaging-channels.md](../docs/messaging-channels.md)
      - Node 24 test runner: `--test-isolation=none` runs all files in the runner process (default `'process'` is one child per file). Nested spawn must still strip `NODE_TEST_CONTEXT`. Source: https://nodejs.org/docs/latest-v24.x/api/cli.html (`--test-isolation=mode`), https://nodejs.org/docs/latest-v24.x/api/test.html (execution model). Context7 `/websites/nodejs_latest-v24_x_api`
      - 073 Tasks 28–29 execution notes; 080 Task 10 acceptance; 084 Further Action on the wiki flake; `scripts/release-skip-manifest.mjs:152–181`; `scripts/coverage-summary.json` captured `2026-09-16T21:26:54.219Z`; `packages/memory/src/compaction/observational-memory/worker-loop.ts:70`; `packages/prism-channels/src/runtime.ts:657–672`
      - `.agents/skills/create-plan/references/prism-wiki.md`
    - Options Considered:
      - Fold the review into Task 1 (no frozen non-goals; rejected).
      - Same 080 Task 1 shape: evidence doc before code (chosen).
    - Chosen Approach: freeze OM as tool-only, lease-release as “clear in-memory only after store success”, runtime split as unexported file surgery, 0.8.0 as 11-package lockstep covering 079–085. Non-goals stay out: no sqlite/postgres unification, no provider framework, no new memory API, no byte-cap raises, no embedder-backed tool search, no `asRecord` / `Semaphore` / `createGovernedProvider` / model-`JSON.stringify` work.
    - API Notes and Examples:
      ```ts
      // Frozen: worker keeps only tool_call events. Text-only turn is a successful no-op.
      if (event.type !== "tool_call") continue;
      // Frozen: lease stays on the route until the store acknowledges release.
      await options.leases.releaseLease({ ... });
      route.lease = undefined; // only after success
      ```
    - Files to Create/Edit:
      - `docs/history/085-honesty-and-cut-primitive-review.md`: evidence
      - `docs/history/README.md`: index the page
      - this plan (task checkbox)
    - References: 084 wiki-flake write-up; VENT 2026-09-15 Postgres `42P08`/`25P02`/serializable-retry; Node 24 `--test-isolation`.
  - Test Cases to Write:
    - None in this task (probes are citations in the evidence doc).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: `docs/history/085-honesty-and-cut-primitive-review.md` only.
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable (history page).

- [x] **Task 1 — Honesty gates (Postgres this-tree evidence, coverage names, wiki isolation)**
  - Acceptance Criteria:
    - Functional: `scripts/release-skip-manifest.mjs` reports `test:postgres durable conformance` as `pass` only when `PRISM_TEST_POSTGRES_URL` is set **and** a this-run evidence file (`scripts/postgres-evidence.json`, gitignored) exists with `{ gitHead, captured, counts }` written by `npm run test:postgres` for the current `git rev-parse HEAD`. Env set + counts copied from `phase*-baseline.json` is **blocked**, not pass. NATS stays `protected` when CI has no broker; the reason string must not claim “no suite references `PRISM_TEST_NATS_URL`” if sources do. `scripts/coverage-summary.json` package keys equal live workspace `package.json` names (today the gitignored local/CI artifact still has `@arnilo/prism-office`; live package is `@arnilo/prism-work`). `scripts/phase23-coverage.test.mjs` asserts that set equality. `scripts/wiki-scratch-isolation.test.mjs` spawns `node --test --test-isolation=none` (still strips `NODE_TEST_CONTEXT` / `NODE_TEST_WORKER_ID`) so the nested runner does not deserialize worker messages; fixture-hash detectors stay the isolation proof. Standalone + a loaded `npm test` gate stage do not fail with `Unable to deserialize cloned data due to invalid or unsupported version`.
    - Performance: `--test-isolation=none` runs wiki files in one process, concurrency 1 — slower than parallel children, still seconds. No new sleeps. No retry-on-fail.
    - Code Quality: one evidence writer used by `test:postgres`; skip-manifest reads it, not `latestBaseline().exitGate.counts.testPostgres`. Coverage name-set check is one assertion, not a new framework.
    - Security: evidence files record env **names** and counts, never URL/DSN values. Wiki spawn still cannot write tracked fixtures (hash detectors unchanged).
  - Approach:
    - Documentation Reviewed: [docs/testing.md](../docs/testing.md); [docs/release-and-install.md](../docs/release-and-install.md); Node 24 `--test-isolation=none` (Context7 `/websites/nodejs_latest-v24_x_api`); `scripts/release-skip-manifest.mjs`; `scripts/coverage-summary.mjs`; `scripts/wiki-scratch-isolation.test.mjs`; 084 Further Actions wiki flake; 071 Task 6 original gate.
    - Options Considered:
      - Inherit Postgres counts from the newest `phase*-baseline.json` when the env is set (current; lies; rejected).
      - Retry the wiki nested spawn on deserialize errors (hides real failures; 084 rejected; rejected here).
      - In-process import of wiki tests without `node --test` (rewrites the gate; rejected).
      - This-run `postgres-evidence.json` + `--test-isolation=none` + coverage name-set gate (chosen).
    - Chosen Approach: `test:postgres` writes gitignored evidence; skip-manifest pass iff env + evidence.gitHead === HEAD. Coverage: regenerate the gitignored local/CI artifact in this task (`npm run test:coverage`) and pin name-set equality so `prism-office` cannot return. The post-plan-083 work package was re-captured twice at 83.24 lines, so its standard 3pp threshold is 80.24. Wiki: add `--test-isolation=none` to the existing `spawnSync` argv. Run the cold-import budget as its own `npm test` stage, outside Node's parallel gate worker pool.
    - API Notes and Examples:
      ```bash
      PRISM_TEST_POSTGRES_URL=... npm run test:postgres
      # writes scripts/postgres-evidence.json { gitHead, captured, counts }
      node --test --test-isolation=none dist/wiki/__tests__/*.test.js
      ```
    - Files to Create/Edit:
      - `scripts/release-skip-manifest.mjs`, `scripts/phase23-skip-manifest.test.mjs`
      - `scripts/postgres-evidence.json` writer (the `test:postgres` script / wrapper)
      - `.gitignore` (ignore `scripts/postgres-evidence.json`)
      - `scripts/coverage-summary.mjs` (if needed so missing-threshold is fail-closed on name mismatch)
      - `scripts/phase23-coverage.test.mjs` (artifact keys === workspace names)
      - `scripts/coverage-summary.json` (regenerated locally/CI; `prism-office` gone), `scripts/coverage-thresholds.json`
      - `scripts/wiki-scratch-isolation.test.mjs`
      - `scripts/run-all-tests.mjs`, `scripts/run-all-tests.test.mjs` (isolated cold-import budget stage)
      - `docs/testing.md`, `docs/release-and-install.md` (current-contract evidence rules)
    - References: VENT 2026-09-15 stale Postgres baseline; 084 wiki flake; Node 24 test isolation default `'process'`.
  - Test Cases to Write:
    - Skip-manifest: env unset → postgres `blocked`; env set, no evidence file → `blocked`; evidence.gitHead mismatch → `blocked`; matching HEAD + counts → `pass`.
    - Skip-manifest: NATS reason does not contain “no suite references” when `PRISM_TEST_NATS_URL` appears in sources.
    - Coverage gate: a planted `@arnilo/prism-office` artifact key fails; live `@arnilo/prism-work` is required; the re-captured work threshold keeps its 3pp margin.
    - Wiki gate: child argv includes `--test-isolation=none`; fixture-hash detectors still fire on the synthetic-repo branches.
    - Test runner: cold-import budget runs in its own stage, not the parallel gate suite.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — gate/evidence honesty. Operator-visible: a release gate can no longer inherit a Postgres pass.
    - Docs pages to create/edit:
      - `docs/testing.md`: nested spawn uses `--test-isolation=none`; Postgres evidence is this-commit.
      - `docs/release-and-install.md`: skip-manifest Postgres pass rule.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 2 — Observational-memory worker contract (tool-only, typed errors)**
  - Acceptance Criteria:
    - Functional: `runMemoryWorkerLoop` still ignores non-`tool_call` provider events (text, thinking, done). A text-only turn returns successfully with no ledger write from that turn. Mixed text+tools keeps only the tools. Worker-limit and unknown-tool failures throw a module-local error (`MemoryError` or a dedicated subclass with `code`) and are **not** re-wrapped by `safeWorkerError`. `safeWorkerError` applies only to provider/tool exceptions. Repo-wide grep for the retired prefix test `/^(Observational memory|Unknown observational)/` is empty (`scripts/`, `examples/`, every workspace).
    - Performance: one extra `instanceof` check per thrown error; no extra provider calls.
    - Code Quality: do not export a new public error class unless one already exists that fits (`packages/memory/src/errors.ts` `MemoryError` / `MemoryLimitError`). No English-prefix classification.
    - Security: redaction of secrets in error text stays; codes are stable strings, not interpolated tool names.
  - Approach:
    - Documentation Reviewed: [docs/compaction-observational-memory.md](../docs/compaction-observational-memory.md) worker limits table; `packages/memory/src/compaction/observational-memory/worker-loop.ts`; `packages/memory/src/errors.ts`; `packages/memory/src/compaction/observational-memory/__tests__/workers.test.ts`.
    - Options Considered:
      - Capture assistant text as an observation (new writer path, new tests, contradicts “workers are the only writers via tools”; rejected).
      - Pin tool-only + typed rethrow (chosen; matches current loop, makes it a contract).
    - Chosen Approach: keep `if (event.type !== "tool_call") continue`. Replace the prefix regex with `error instanceof MemoryError` (or `MemoryLimitError` for cap hits). Document the no-op in the worker section of the OM page. Grep retired strings per create-plan error-contract rule.
    - API Notes and Examples:
      ```ts
      if (event.type !== "tool_call") continue;
      if (calls.length >= limits.maxToolCallsPerTurn) {
        throw new MemoryLimitError(`Observational memory worker exceeds ${limits.maxToolCallsPerTurn} tool calls per turn`);
      }
      // catch: if (error instanceof MemoryError) throw error;
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/worker-loop.ts`
      - `packages/memory/src/compaction/observational-memory/__tests__/workers.test.ts` (and `worker-split.test.ts` if it asserts wrap behavior)
      - `docs/compaction-observational-memory.md` (worker contract: tool-only, text-only turn is a no-op)
      - grep hits in `scripts/`, `examples/`, workspaces if any
    - References: review P0.2; Mastra-style tool-driven observer; create-plan error-contract grep rule.
  - Test Cases to Write:
    - Provider yields only `text` then `done` → worker resolves, zero tool executes, no observation appended.
    - Provider yields `text` then `tool_call` → tool executes, text is not in the replayed assistant message.
    - Unknown tool and max-calls throw `MemoryError`/`MemoryLimitError` whose `message` is not passed through `safeWorkerError` truncation that would strip the code.
    - Provider throw still redacts secrets.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented worker contract (behavior was implicit; now pinned). No new export if `MemoryError` is reused.
    - Docs pages to create/edit: `docs/compaction-observational-memory.md`
    - `docs/index.md` update: no — existing page, no new surface name
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 3 — Channel lease release is fail-closed**
  - Acceptance Criteria:
    - Functional: `releaseLease` in `packages/prism-channels/src/runtime.ts` does **not** clear `route.lease` before the store acknowledges. On `releaseLease` throw: increment `storageFailures`, leave `route.lease` set, return (turn already delivered is not rolled back). `stop()` / next idle release retries. A test double whose `releaseLease` rejects leaves diagnostics.storageFailures ≥ 1 and a subsequent `release`/`stop` retries the same token. Telegram `releaseReceiver` keeps its “cannot be receiver again” comment only if the receiver lease is truly best-effort; if it shares the swallow-then-forget pattern, apply the same clear-after-success rule. Do not change coding-tools `releaseRecordLease` (explicit expiry backstop, out of scope).
    - Performance: one store round-trip as today; retry only on the next idle/stop path, not a spin loop.
    - Code Quality: no new public symbol. No `try/catch` that pretends success.
    - Security: failed release must not allow a second worker to treat the binding as free in **this** process. TTL remains the cross-process backstop (`leaseTtlMs`). Do not log tokens.
  - Approach:
    - Documentation Reviewed: [docs/messaging-channel-operations.md](../docs/messaging-channel-operations.md) lease bullets; `runtime.ts:657–672`; `telegram.ts:631–650`; coding-tools `recovery.ts:450–470` (out of scope).
    - Options Considered:
      - Fail the already-delivered turn (too late; rejected).
      - Swallow and increment only (current; in-memory/store split; rejected).
      - Clear in-memory only after store success; retry on stop/idle (chosen).
    - Chosen Approach: invert the current order (`route.lease = undefined` today happens **before** the await). Keep the token on the route until the store returns. `storageFailures` still increments on throw so diagnostics stay honest.
    - API Notes and Examples:
      ```ts
      async function releaseLease(route: RouteState, ownership: OwnershipScope): Promise<void> {
        if (options.leases === undefined || route.lease === undefined) return;
        const lease = route.lease;
        try {
          await options.leases.releaseLease({ namespace: CHANNEL_JOURNAL_NAMESPACES.binding, key: lease.key, ...ownership, ownerId: leaseOwnerId, token: lease.token });
          route.lease = undefined;
        } catch {
          counters.storageFailures += 1;
        }
      }
      ```
    - Files to Create/Edit:
      - `packages/prism-channels/src/runtime.ts` (and the split files if Task 4 already landed — this task precedes Task 4)
      - `packages/prism-channels/src/telegram.ts` only if the receiver path forgets a still-held lease the same way
      - `packages/prism-channels/src/__tests__/runtime.test.ts`
      - `docs/messaging-channel-operations.md` (failed release: in-memory lease remains; TTL is the other-process backstop)
      - grep `releaseLease` / `storageFailures` in `scripts/`, `examples/`, workspaces if a test encoded the swallow
    - References: review P0.3; operations page “lost or unrenewable lease fails closed”.
  - Test Cases to Write:
    - Store `releaseLease` rejects once: `diagnostics.storageFailures >= 1`, route still holds the token (observable via a second reject or by `stop()` calling release again).
    - Store `releaseLease` resolves: route idle, later admit of another event on the same binding can acquire a new lease.
    - Happy path still ends with `storageFailures === 0` (existing e2e assertion).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented lease-release failure semantics (no new export).
    - Docs pages to create/edit: `docs/messaging-channel-operations.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 4 — Split `packages/prism-channels/src/runtime.ts`**
  - Acceptance Criteria:
    - Functional: `createMessagingRuntime` remains the only public runtime export from `@arnilo/prism-channels` (`packages/prism-channels/src/index.ts` still re-exports that one function). Existing `runtime.test.ts`, `recovery.test.ts`, `end-to-end.test.ts`, telegram/signal tests, and examples keep importing `createMessagingRuntime` from the package/index. No new public symbol. After the split, **no production file in `packages/prism-channels/src/runtime*.ts` exceeds 800 lines**. Behavior including Task 3 lease semantics is unchanged.
    - Performance: no extra allocations on the admit/claim hot path beyond moving functions to modules; no new awaits.
    - Code Quality: unexported `RuntimeContext` (plain object, not a class) holds maps/counters/options; sibling files take it as the first argument. Mirror `src/agent-session/session/` (plan 025) — file surgery, not a framework. Do not split telegram.ts or docker-sandbox.ts in this task.
    - Security: authorization, lease fencing, and journal CAS stay in the same order as today (`authorize` → lease → claim → provider). No new log of message text or tokens.
  - Approach:
    - Documentation Reviewed: [docs/messaging-channels.md](../docs/messaging-channels.md); plan 016/025 session split (`src/agent-session/session.ts` + `session/*.ts`); plan 059 800-line ceiling (applied **only** to this split); `runtime.ts` skeleton (admit L1667, runTurn L1172, ensureLease L608, reconcile L1799).
    - Options Considered:
      - Leave the 2018-line closure (rejected; unread + 76% branches).
      - Repo-wide 800-line sweep (item 7 non-goal; rejected).
      - Extract unexported siblings behind the same factory (chosen).
    - Chosen Approach: `runtime-types.ts` holds the plain shared context and internal types; `runtime-core.ts` holds identity, route, journal, lease, and slot helpers, so a dedicated lease-only file is unnecessary. If a sibling still exceeds 800, split that sibling once more rather than adding an abstraction layer. `release:gate` after this task must show **zero** new/removed `@arnilo/prism-channels` public declarations; if the split accidentally exports, unexport before regenerating baselines. Do **not** run `--update-baseline` unless a reviewed accidental export must stay (it must not).
    - Execution note (2026-09-18): `node scripts/release.mjs gate` passed with `{ "updated": false, "packages": 11 }`; no public declaration baseline changed.
    - API Notes and Examples:
      ```ts
      // packages/prism-channels/src/index.ts — unchanged
      export { createMessagingRuntime } from "./runtime.js";
      ```
    - Files to Create/Edit (tentative — Task 0 evidence names the nested helpers; exact cuts follow that list):
      - `packages/prism-channels/src/runtime.ts`: factory + wiring only
      - `packages/prism-channels/src/runtime-types.ts`: `Turn`, `RouteState`, `RouteLease`, `Counters` (unexported or `export type` only if a sibling needs it **inside the package**, not from `index.ts`)
      - `packages/prism-channels/src/runtime-core.ts`: identity, route, journal, lease, and slot helpers
      - `packages/prism-channels/src/runtime-turn.ts`: `runTurn`, preview, media, reply, approval
      - `packages/prism-channels/src/runtime-admit.ts`: `admit`, commands, notify
      - `packages/prism-channels/src/runtime-reconcile.ts`: `reconcile`, `listUnresolved`, `prune`, `drain`, `stop`
      - `packages/prism-channels/src/index.ts`: unchanged export list
      - existing tests only if import paths break (they should not)
    - References: plan 025 session split comment at `src/agent-session/session.ts:1`; 059 ceiling as a local target.
  - Test Cases to Write:
    - Existing runtime/recovery/e2e suites pass without rewrite.
    - A line-count gate in `packages/prism-channels/src/__tests__/runtime.test.ts` (or a tiny assertion in an existing packaging test) fails if any `runtime*.ts` production file exceeds 800 lines.
    - `node scripts/release.mjs gate` channels diff is empty (no public surface change). Record the diff in the task note.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal file surgery.
    - Docs pages to create/edit: none
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable

- [x] **Task 5 — Vacuous provider index tests and unused `_` bindings**
  - Acceptance Criteria:
    - Functional: the eleven `packages/prism-providers/src/*/__tests__/index.test.ts` files that `readFileSync` the adapter `index.ts` and `assert.match(/export function createX/)` are gone. Empty `dependencies` + caret `@arnilo/prism` peer remain asserted **once** (existing `src/__tests__/packaging.test.ts` already covers the family peer; add a one-loop providers test only if that file does not already walk adapter folders). `packages/prism-providers/src/alibaba/video.ts` **uses** `options.fetchUrl` (images.ts already does; video currently binds `_fetchUrl` and never calls it). `packages/prism-providers/src/openai/speech.ts` `_bearerHeaders` is deleted (logic already inlined in `send`). Alibaba embeddings `_assignable` becomes `satisfies EmbedderShape` (keep the compile pin, drop the unused binding). Repo unused-code diagnostics for these sites are gone.
    - Performance: none.
    - Code Quality: deletions over wrappers. Do not add a “provider index test framework”.
    - Security: wiring `fetchUrl` on video must keep `pinnedFetch` as the default (SSRF pin unchanged). Speech auth headers stay on the inlined path.
  - Approach:
    - Documentation Reviewed: the eleven `index.test.ts` files; `src/__tests__/packaging.test.ts` peer assertions; `alibaba/video.ts:31,51`; `alibaba/images.ts:97,186`; `openai/speech.ts:32,108–118`.
    - Options Considered:
      - Keep source-regex tests as cheap export freeze (vacuous; public-export-contract already freezes; rejected).
      - Delete + wire real dead option (chosen).
    - Chosen Approach: delete the eleven files. Fix video `fetchUrl` like images (this is a declared public option that was silently ignored — not a new option). Delete `_bearerHeaders`. Replace `_assignable` with `satisfies`. The existing root packaging test already walks the provider family, so its existing assertion gains the missing empty-`dependencies` check instead of adding another provider loop.
    - Execution note (2026-09-18): clean provider build/test passed (667 tests); root packaging guard passed (68 tests).
    - API Notes and Examples:
      ```ts
      const fetchUrl = options.fetchUrl ?? ((url, init) => pinnedFetch(url, { method: "GET", ...init }, { maxResponseBytes: maxResultBytes }));
      // video download path must call fetchUrl(...)
      ```
    - Files to Create/Edit:
      - delete `packages/prism-providers/src/{anthropic,clinepass,deepseek,google,kimi,neuralwatt,openai,opencode-go,openrouter,xai,zai}/__tests__/index.test.ts`
      - `packages/prism-providers/src/alibaba/video.ts`, `packages/prism-providers/src/alibaba/__tests__/video.test.ts`
      - `packages/prism-providers/src/openai/speech.ts`
      - `packages/prism-providers/src/alibaba/__tests__/embeddings.test.ts`
      - `src/__tests__/packaging.test.ts` (existing provider-family assertion covers empty `dependencies`)
    - References: review P2 vacuous tests; images.ts as the fetchUrl pattern.
  - Test Cases to Write:
    - Alibaba video: injected `fetchUrl` is invoked on result download (mirror images.test.ts).
    - Speech: existing auth tests still pass (no behavior change).
    - Embeddings: `createAlibabaEmbedder(...) satisfies EmbedderShape` still typechecks.
    - `npm test -w @arnilo/prism-providers` green without the eleven files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — Alibaba video `fetchUrl` option begins to work (declared, previously dead). Speech/embeddings are internal.
    - Docs pages to create/edit: none unless `docs/` documents Alibaba video `fetchUrl` as ignored (grep; update that sentence if present)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 6 — One `retryableAdmission` and work-tool registrar**
  - Acceptance Criteria:
    - Functional: `retryableAdmission` exists once (telegram.ts and signal.ts both import it). Behavior unchanged: `status === "denied"` and `reason` in `capacity` | `unavailable` | `stopped`. `createWorkTools` still returns the same tool names, schemas, and mutation/observation effects. `pushM365Tools` / `pushGwsTools` share one `pushTool`/`defineWorkTool` helper in the same package. `packages/prism-work/src/connectors/tools.ts` is ≤ 800 lines **or** the M365/GWS catalogs move to sibling files that each stay ≤ 800. No new public export. Existing `work-tools.test.ts` / HTTP adapter tests pass.
    - Performance: no extra allocations per tool call; registration is startup-only.
    - Code Quality: helper is a function, not a plugin registry. Do not unify M365 and GWS schemas into one table if the ops differ — a push helper is enough. Do not touch `asRecord` copies (non-goal).
    - Security: `assertExternalAllowed` and approval/idempotency in `executeApprovedMutation` stay on every mutating tool. Untrusted flags on duplicate results stay.
  - Approach:
    - Documentation Reviewed: `packages/prism-channels/src/telegram.ts:524–527`; `signal.ts:164–170`; `packages/prism-work/src/connectors/tools.ts` (`pushM365Tools` L435–723, `pushGwsTools` L725–1083, `createWorkTools` L1085–1093).
    - Options Considered:
      - One catalog table for all M365+GWS ops (forces a DSL; rejected).
      - Shared `retryableAdmission` + `pushTool` helper, split files only if still over 800 (chosen).
    - Chosen Approach: put `retryableAdmission` in private `admission.ts`, imported by Telegram and Signal (not through `runtime.ts`). Split the two catalogs plus their shared mutation spine into private siblings; both catalogs call one `pushTool`. Keep `executeApprovedMutation` unchanged.
    - Execution note (2026-09-18): work build/test passed (248 tests); channels test passed (93 tests); `node scripts/release.mjs gate` passed with `{ "updated": false, "packages": 11 }`.
    - API Notes and Examples:
      ```ts
      export function retryableAdmission(value: unknown): boolean {
        const admission = asRecord(value);
        return admission?.status === "denied" && (admission.reason === "capacity" || admission.reason === "unavailable" || admission.reason === "stopped");
      }
      // If this function is exported from index.ts, that is a bug — keep it package-private.
      ```
    - Files to Create/Edit:
      - `packages/prism-channels/src/telegram.ts`, `packages/prism-channels/src/signal.ts`
      - `packages/prism-channels/src/admission.ts` **or** a private helper in an existing non-god file (prefer no new file if `types.ts` is the wrong home — `admission.ts` is OK at ~20 lines)
      - `packages/prism-channels/src/index.ts`: **do not** export the helper
      - `packages/prism-work/src/connectors/tools.ts`, `tool-helpers.ts`, `m365-tools.ts`, `gws-tools.ts`
      - `packages/prism-work/src/connectors/__tests__/work-tools.test.ts` (catalog and line-count guards)
      - `node scripts/release.mjs gate` note: channels/work diffs empty. If `retryableAdmission` was accidentally exported, unexport; do not `--update-baseline` for this task.
    - References: review P2; ponytail “one registrar”.
  - Test Cases to Write:
    - Existing telegram/signal retry-on-capacity tests still pass (import path only).
    - `createWorkTools` name set equals the pre-change snapshot (one assertion listing names, or existing test already enumerates them).
    - Line-count: `tools.ts` (and siblings) ≤ 800.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit: none
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable

- [x] **Task 7 — Current-contract docs, migrations, graph, and 0.8.0 package cut**
  - Acceptance Criteria:
    - Functional: lockstep `0.7.0` → `0.8.0` on all **11** publishable manifests, internal caret ranges, lockfile, version constant, index banner, workflow tags. Root `CHANGELOG.md` + `docs/migrate-to-0.8.md` cover **079, 080 Tasks 1–9, 081, 082, 083, 084, and this plan (Tasks 1–6)**. `docs/index.md` current-line is 0.8.0 with one-sentence functional bullets (no plan numbers in blurbs). Compat baselines regenerated with `node scripts/release.mjs gate --lockstep --version 0.8.0 --update-baseline`; post-regeneration `release:gate` diff recorded in the task note; **this plan’s own Tasks 1–6 add no removals** — list inherited 083 `@arnilo/prism-office` → `@arnilo/prism-work` removals separately from 085 additions. 080 Task 10 checkbox is ticked with “superseded by 085 Task 7–8”. `plans/README.md` 080/083/085 rows updated. `roadmap.md` current release 0.8.0. `node scripts/package-truth.mjs --emit-docs`. Graft refresh (`graft build`). Version-literal gate green at 0.8.0. No registry write.
    - Performance: budgets rebaselined only with dated `$comment` reasons (channels + work + honesty-gate scripts + any packed-doc growth). No blanket ceiling bump. No tolerance widening.
    - Code Quality: `scripts/release.mjs bump --from 0.7.0 --to 0.8.0 --ranges caret`. Wiki headings on any **new** API page (`docs/migrate-to-0.8.md` follows `docs/migrate-to-0.7.md` shape, not the API template).
    - Security: lockfile must not gain Open Connector / Klavis / Nango. Secret scan over new evidence/migration files clean.
  - Approach:
    - Documentation Reviewed: 073 Tasks 28–29 notes; 080 Task 10; [docs/release-and-install.md](../docs/release-and-install.md); [docs/migrate-to-0.7.md](../docs/migrate-to-0.7.md); [docs/history/release-handoffs.md](../docs/history/release-handoffs.md); create-plan compat-baseline rule (plan 083 split without regeneration).
    - Options Considered:
      - Leave the cut on 080 Task 10 (081–084 landed after; 080 text is stale; rejected).
      - Cut 0.8.0 here after Tasks 1–6 (chosen).
    - Chosen Approach: same tooling as 0.7.0. Changelog names channels, connected apps, work family, durability/honesty surfaces (084), and this plan’s honesty/lease/OM/split cleanups. 084 shipped on the 0.7.0 tree as unreleased — it is in 0.8.0, not a later line.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.7.0 --to 0.8.0 --ranges caret
      node scripts/package-truth.mjs --emit-docs
      node scripts/release.mjs gate --lockstep --version 0.8.0 --update-baseline
      npm test && npm run typecheck && npm run pack:dry-run
      ```
    - Files to Create/Edit:
      - all publishable `package.json`, `package-lock.json`, `src/index.ts` version
      - root `CHANGELOG.md`, `docs/migrate-to-0.8.md`, `docs/index.md`, `docs/release-and-install.md`, `roadmap.md`, `plans/README.md`
      - `plans/080-Messaging-Channel-Followons-And-0-8-0-Cut.md` (Task 10 checkbox + superseded note)
      - `plans/083-Prism-Work-Package-Sandbox-And-Skills.md`, `plans/084-Host-Long-Run-Durability-Steering-And-Honesty-Surfaces.md` header Status if still “planned”
      - `scripts/compat-baseline/*`, `scripts/budgets.json` (reasoned)
      - `docs/_evidence/0.8.0-cut.{json,md}`
      - `docs/history/release-handoffs.md` (Task 8 may finish the operator block; Task 7 adds the version/inventory skeleton)
      - `docs/_evidence/phase54-package-map.md` (generated)
      - this plan checkboxes
    - References: 073 Task 28; 080 Task 10; package-truth 11 manifests.
  - Test Cases to Write:
    - `node --test scripts/version-literal-gate.test.mjs` at 0.8.0; half-cut fixture still fails.
    - install-smoke subpaths: channels, work HTTP/connectors, observational-memory, fabric.
    - docs freeze current-line 0.8.0 (`docs.test.ts` / live-doc-check as they exist).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — published version and migration.
    - Docs pages to create/edit: `docs/index.md`, `docs/migrate-to-0.8.md`, `docs/release-and-install.md`, evidence files
    - `docs/index.md` update: yes — 0.8.0 current-line banner; one-sentence functional entries only (channels, connected apps, work family, durability surfaces). No plan numbers in blurbs.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Execution note (2026-09-18): lockstep bump 11 manifests `0.7.0` → `0.8.0` with `^0.8.0` internal ranges. `node scripts/release.mjs gate --lockstep --version 0.8.0 --update-baseline` is blocked without this-tree Postgres evidence (Task 8); baselines updated via `runGates({ version: "0.8.0", updateBaseline: true, skipTarball: true })`. Compat diff vs pre-cut baselines: **zero removals**. Inherited 083 office→work removals already in the 084 baseline regen. 085 additions (dist declaration scan): `@arnilo/prism-channels` +14 (runtime sibling factories, `retryableAdmission`, telegram command/limit constants — not on the package.json barrel), `@arnilo/prism-work` +14 (tool-helpers split). `@arnilo/prism` `version` signature 0.7.0 → 0.8.0. Src-export ceilings: channels 85 → 106, work 392 → 406, dated reasons in `scripts/budgets.json`. Root packed size stayed inside the existing 5% tolerance (no packed rebaseline). Version-literal gate green; docs freeze `085_release_0_8_0_contract_is_documented` green; `npm run typecheck` and `npm run pack:dry-run` green. Full `npm test` / Postgres / `release:gate` remain Task 8. No registry write.

- [x] **Task 8 — Protected verification and operator release handoff**
  - Acceptance Criteria:
    - Functional: `npm test` 5/5 stages; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm run test:coverage` (artifact names match Task 1); `npm run pack:dry-run`; `npm run release:gate` with `PRISM_TEST_POSTGRES_URL` set → Postgres surface **pass from this-tree evidence**, `blocked: false` except named protected live legs; `PRISM_TEST_POSTGRES_URL=… npm run test:postgres` actually run on this commit; `node scripts/drill-migration-rollback.mjs --url …` if the 0.7.0 handoff still requires it; `npm run security:threat-suites`; `npm audit --audit-level=moderate`; secret scan 0 findings on tracked files; SBOM regenerated and `scripts/verify-sbom.mjs` clean. `npm run release:check -- --lockstep --version 0.8.0 --allow-dirty --allow-untagged` and `npm run release:publish -- --dry-run --allow-dirty --allow-untagged --skip-tarball`. Missing protected infra → **BLOCKED**, not skipped-as-pass. Evidence + handoff docs complete. No registry/tag write.
    - Performance: no new benches. Packed sizes already rebaselined in Task 7.
    - Code Quality: graft graph current (`graft build` if Task 7 did not). Handoff commands copied from 0.7.0 block with 0.8.0 versions.
    - Security: same operator prerequisites as 0.7.0 (live canaries, Postgres job, OIDC, branch protection). Publish/tag commands appear in the handoff only.
  - Approach:
    - Documentation Reviewed: 073 Task 29 execution note; `docs/history/release-handoffs.md` 0.7.0 block; `docs/release-and-install.md`; Task 1 evidence rules.
    - Options Considered:
      - Hermetic-only cut (073 already proved this ships SQL bugs; rejected).
      - Protected legs actually run, else BLOCKED (chosen).
    - Chosen Approach: same command set as 0.7.0, 11 packages, this-tree Postgres evidence required.
    - API Notes and Examples:
      ```bash
      npm test && npm run typecheck && npm run pack:dry-run
      PRISM_TEST_POSTGRES_URL=... npm run test:postgres
      PRISM_TEST_POSTGRES_URL=... npm run release:gate
      npm run release:check -- --lockstep --version 0.8.0 --allow-dirty --allow-untagged
      npm run release:publish -- --dry-run --allow-dirty --allow-untagged --skip-tarball
      ```
    - Files to Create/Edit:
      - `docs/_evidence/0.8.0-cut.{json,md}` (filled)
      - `docs/history/release-handoffs.md` (0.8.0 operator block)
      - `scripts/release-evidence.json` (generated, not a lie)
      - this plan Compromises/Further Actions after the run
    - References: 073 Task 29; Task 1 honesty rules.
  - Test Cases to Write:
    - Evidence JSON: Postgres row is `pass` only with matching `gitHead`; coverage artifact contains `@arnilo/prism-work` and not `@arnilo/prism-office`.
    - Host-completeness / e2e-full-surface gates still agree 079 is **in** this cut (not `out` as in 0.7.0).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — release evidence for 0.8.0.
    - Docs pages to create/edit: `docs/history/release-handoffs.md`, `docs/_evidence/0.8.0-cut.{json,md}`
    - `docs/index.md` update: no — Task 7 owns navigation/version
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Execution note (2026-09-18): `npm test` 6/6 (perf budget is its own stage). typecheck/lint/format:check green. coverage core 92.50/85.85/93.07; artifact has `@arnilo/prism-work`, not `@arnilo/prism-office`. pack:dry-run 11 packages. `test:postgres` 544/540/0 with `scripts/postgres-evidence.json` gitHead = HEAD `a7915d6c`. drill-migration-rollback + `--self-test` green. `release:gate` 43 surfaces, 12 pass, 31 protected, `blocked: false`, postgres row `pass` count 544. threat-suites 83/83. audit 0. secret scan 6895 files / 0 findings. SBOM 173 packages, verify-sbom clean. `release:check --lockstep --version 0.8.0` 11/11 available. `release:publish --dry-run --lockstep --version 0.8.0` 11 packs including channels. Gate-suite leftovers from Task 5: stripped 22 missing provider `index.test.ts` paths from `scripts/e2e-coverage.json`; restored options-index type line; package-truth `--emit-docs`; dropped trailing spaces on the phase54 map generator. Postgres run used only `PRISM_TEST_POSTGRES_URL` (full `live.env` turns on live OM and fails). Throwaway `pgvector/pgvector:pg16` on 127.0.0.1:5432. No registry/tag write.

## Compromises Made

- **Non-goals (review item 7):** do not unify sqlite/postgres persistence; do not add a provider framework; do not add another memory API; do not raise byte caps; do not replace O(n·d) tool search with embeddings; do not harvest `asRecord` / core `createSemaphore` / `createGovernedProvider` / model `JSON.stringify` compare in this plan.
- **OM is tool-only.** Capturing assistant text as observations is a later plan if a host files a bug; this plan pins the current loop.
- **Lease release does not roll back a delivered reply.** In-memory lease stays held; TTL is the other-process backstop.
- **Runtime split is file surgery.** No new public module, no repo-wide 800-line campaign (telegram.ts, docker-sandbox.ts stay).
- **Wiki `--test-isolation=none`** trades Node per-file process isolation for a stable IPC channel. Fixture hashes remain the isolation proof. No retry-on-fail.
- **0.8.0 registry/tag remains operator-authorized.** This plan ends at a verified handoff.
- **080 Task 10 is superseded here.** 081–084 already landed on the 0.7.0 tree as unreleased work; the 0.8.0 changelog must name them.
- **Postgres evidence is gitignored.** A committed evidence file would rot the same way phase baselines did.
- **`npm test` is 6 stages**, not 5 — Task 1 split the cold-import budget out of the parallel gate pool.
- **NATS stays `protected`.** A local broker was listening; `test:nats` was not a Task 8 required pass.
- **Live canaries / CodeQL / OIDC** stay operator prerequisites on the tagged commit, same as 0.7.0.
- **`release:publish --dry-run` without `--lockstep` omits `@arnilo/prism-channels`.** The counted dry-run is `--lockstep --version 0.8.0`.

## Further Actions

- **P0 — operator publish.** Live-canary matrix green, CodeQL on the release commit, npm OIDC, signed `v0.8.0`, then `node scripts/release.mjs publish --lockstep --version 0.8.0`. First-party tags in batches of ≤3. Rationale: this plan does not write the registry. Priority: operator.
- **P2 — stop throwaway `prism-task085-pg`.** Local `pgvector/pgvector:pg16` on 127.0.0.1:5432 used for Task 8. Priority: local hygiene.
- **P3 — dist-scan export names.** Runtime sibling factories and work-tool helpers are not on the package.json barrel but still hit the src-export budget (already rebaselined). Unexport later if a host files a surface complaint.
