# Phase 11 Part M — live release acceptance on real providers (Hyper and OpenCode Go)

## Objectives

- Define how Prism accepts a release against real model providers: tiers, entry criteria, credential handling, cost budget, run procedure, evidence, failure triage, and sign-off.
- Add a pre-flight check that proves a live run is safe to start (credential file outside the repo, owner-only permissions, required variables present, key valid) without ever printing a secret.
- Add one provider-agnostic SDK journey that exercises the whole public contract end to end: agent loop, tools, approvals, suspend/resume across processes, gate integrity, ownership isolation, limits, compaction, the remote host, and abort. Run it unchanged on **Charm Hyper** and on **OpenCode Go**, so acceptance does not depend on one vendor's behaviour. Scan every artifact for secret leaks.
- Make the strict acceptance run a pre-flight step of the 0.13.0 publish (plan 187 Task 2). The run covers both journeys, the tier-1 rows of all four shipped providers (plan 183), and the cache-parity gate (plan 184).

## Expected Outcome

- `docs/live-testing.md` has a "Release acceptance on live providers" section that an operator can follow alone.
- `bun scripts/live-preflight.mjs --suite release/` prints a pass/fail table for every release row and exits non-zero on any unsafe condition.
- `apps/prism-agent/src/__tests__/live-provider-journey.test.ts` runs ten scenarios per provider, selected by `PRISM_LIVE_JOURNEY_PROVIDER` (`hyper` | `opencode-go`). It skips (never fails) without credentials.
- `scripts/live-matrix.json` has active rows `release/journey-hyper` and `release/journey-opencode-go`; the generated table in `docs/live-testing.md` lists them next to `providers/*` (plan 183) and `release/cache-parity` (plan 184).
- `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/,providers/ bun run test:live` passes once before publish. `docs/_evidence/live-release-acceptance-0.13.0.md` records, per provider: model ids, request counts, durations, the leak-scan result, and the cache-parity verdict. It never contains a secret.

**0.13.0 release path — plan 186 of 181–187.** Start it when plan 185 is complete; when this plan is complete, continue with plan 187. Plans 181–201 run strictly in step order (see `plans/README.md`), and nothing runs in parallel. **Amended 2026-10-19:** plan 201 Task 6 adds the manual live row `release/eval-gate` (the reference host's eval suite on Hyper, with a 2M input-token ceiling). The strict pre-flight runs it alongside the journeys and records its report as the next release's eval baseline.

This plan is a pre-publish part of roadmap **Phase 11**. It adds release methodology, not a kernel contract, so it has no phase review. **Revised 2026-10-16** after the owner decision that 0.13.0 ships four providers (`hyper`, `opencode-go`, `typesafe`/Jev, `laya`) and that acceptance must run on both Hyper and OpenCode Go to show the SDK does not depend on one provider. It was plan 180 until the 2026-10-16 reorder (moved whole; no task had been executed). By the time it starts, everything the journey asserts has landed: the fixed gate, ownership, and isolation (plans 177–178), the API level (plan 179 Task 2), the rebuilt providers and their live rows (plans 182–183), cache parity (plan 184), and the frozen surface (plan 185). Credentials follow the owner's choices of 2026-10-15 and 2026-10-16. `HYPER_API_KEY`, `OPENCODE_GO_API_KEY`, and `TYPESAFE_API_KEY` live in `~/.config/prism/live.env` (mode `0600`), loaded through `PRISM_LIVE_ENV_FILE`. They are never pasted into chat, committed, or written to a report. Laya runs against a `laya-serve` on the dev machine. No version bump or publish. Lab impact: n/a (plan 173 deleted `packages/prism-code`). Cost knobs: every release row is opt-in and bounded; Task 3 states the per-provider request budget. **Amended 2026-10-17** (owner decision: roadmap Phase 18 ships in 0.13.0, plans 195–196): 0.13.0 ships five provider packages, adding `liquid` (hosted `d1-ultra`/`d1` with `LIQUID_API_KEY` in `live.env`, and `liquid-local` `d1-3B` on a `llama-server` on the dev machine). Every decision provider (Jev, Laya, d1-ultra, d1-3B) must pass its `decide` live row as well as its `generate` row.

## Tasks

- [ ] Task 1: The release acceptance methodology
  - Acceptance Criteria:
    - Functional: `docs/live-testing.md` gains a section "Release acceptance on live providers" with these parts:
      - **Tiers.** T0 hermetic (`bun run test`, mock provider and recorded wire fixtures). T1 wire scenarios per shipped provider (`providers/{hyper,opencode-go,typesafe,laya}`, plan 183; `providers/{liquid,liquid-local}`, plan 196), including the `decide` rows of plans 195–196. T2 the SDK journey on Hyper *and* OpenCode Go (`release/journey-*`). T2c cache parity against pi run headless (`release/cache-parity`, plan 184). T3 packed post-publish smoke (`scripts/post-publish-smoke.mjs`). A release needs T0, T1 for all six provider rows (five packages; `liquid` has hosted and local rows), T2 on both providers, and T2c green before the tag, and T3 green after publish.
      - **Entry criteria.** T0 green on the release commit; plans blocking the release closed; `bun scripts/live-preflight.mjs --suite release/` passes; spend caps set on every key; `laya-serve` reachable for the Laya row; `llama-server` serving `d1-3B` reachable for the `liquid-local` row.
      - **Credentials.**
        - One env file outside the repo (`~/.config/prism/live.env`, `chmod 600`), loaded with `export PRISM_LIVE_ENV_FILE=…`.
        - One least-privilege, spend-capped key per provider.
        - Keys never go in shell history (`read -s` example), chat, CI logs, or reports.
        - Rotate a key after a suspected leak and after the release run.
        - The cache-parity reference (pi) uses the provider credentials already configured on the dev machine; the runner never reads, copies, or edits `~/.pi`.
      - **Budget.** The journey's request and token ceilings per provider (Task 3), plan 183's tier-1 counts, plan 184's per-cell ceiling, all enforced in the tests themselves, plus the operator-side spend caps.
      - **Procedure.** Exact commands: preflight → `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live` → `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live` → `PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live` → read `docs/_evidence/live-matrix-report.md` → write the acceptance evidence file.
      - **Model selection.** `PRISM_LIVE_HYPER_JOURNEY_MODEL` and `PRISM_LIVE_OPENCODE_GO_JOURNEY_MODEL`, each with a manifest default. Pick a model that supports tool calls, and the cheapest one that passes its T1 tool-loop scenario.
      - **Provider-agnostic rule.** The journey's assertions are about Prism behaviour. A scenario that passes on one provider and fails on the other is triaged: `prism` if the difference is in Prism's handling (codec, usage, routing), and `provider-behavior` only if the recorded wire shows the model did not do what it was told.
      - **Triage and flake policy.**
        - A scenario failure is classified as `transport` (network, 5xx, 429, classified with `isTransientErrorInfo`), `provider-behavior` (the model did not call the tool it was told to call), or `prism` (an assertion on Prism behaviour failed).
        - Only `transport` may be retried, once, by the runner.
        - `provider-behavior` gets one rerun with the same prompt and is then recorded as a provider issue.
        - A `prism` failure is never retried and blocks the release.
        - Any secret-leak finding stops the run, blocks the release, and triggers key rotation.
      - **Evidence and sign-off.** What the evidence file holds: commit; per provider, the model ids, per-scenario status and request counts, durations, and leak-scan result; the T1 summary; the cache-parity table; the operator. The release owner signs it in the plan 187 Task 2 note.
    - Functional: `scripts/live.env.example` is corrected for Bun (it still shows `node --env-file` and `dist/…` paths). It documents `HYPER_API_KEY`, `OPENCODE_GO_API_KEY`, `TYPESAFE_API_KEY`, `LIQUID_API_KEY`, `LAYA_BASE_URL`, `PRISM_LIVE_LAYA`, `PRISM_LIVE_LLAMA_SERVER_URL`, `PRISM_LIVE_CACHE_PARITY`, and the two journey model variables.
    - Performance: n/a — documentation.
    - Code Quality: The section follows the API page structure where it applies (What it does, When to use it, Inputs, Outputs, Security and performance notes).
    - Security: The procedure never asks the operator to print, echo, or paste a key; every example uses env files or `read -s`.
  - Approach:
    - Documentation Reviewed:
      - `docs/live-testing.md` (current tiers, skip-not-fail contract, strict mode, generated table), `scripts/live-matrix.mjs`, `scripts/live.env.example`, `docs/release.md`, `packages/providers/hyper/src/__tests__/live.test.ts:14-60`, `src/models/retry.ts` (`isTransientErrorInfo`), plans 183 Task 5 and 184 Task 4.
    - Options Considered:
      - Run the SDK journey on one provider only. Rejected by the owner (2026-10-16): acceptance on two gateways with different wire details is what shows the SDK is provider-agnostic.
      - Make T1 optional for unchanged providers. Rejected: only five providers ship, and the owner's rule is that none ships untested.
      - Keep the methodology in this plan only. Rejected: operators run it every release, so it belongs in the docs page.
    - Chosen Approach:
      - Extend the live-testing page with a release section built on the existing runner and strict mode.
    - API Notes and Examples:
      ```bash
      install -m 600 /dev/null ~/.config/prism/live.env
      printf 'PRISM_LIVE_PROVIDER_TESTS=1\nPRISM_LIVE_RELEASE_JOURNEY=1\n' >> ~/.config/prism/live.env
      read -rs HYPER_API_KEY && printf 'HYPER_API_KEY=%s\n' "$HYPER_API_KEY" >> ~/.config/prism/live.env && unset HYPER_API_KEY
      read -rs OPENCODE_GO_API_KEY && printf 'OPENCODE_GO_API_KEY=%s\n' "$OPENCODE_GO_API_KEY" >> ~/.config/prism/live.env && unset OPENCODE_GO_API_KEY
      export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env
      bun scripts/live-preflight.mjs --suite release/
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live
      ```
    - Files to Create/Edit:
      - `docs/live-testing.md`: new section.
      - `scripts/live.env.example`: Bun commands and the variables above.
      - `docs/release.md`: link the acceptance section from the release checklist.
      - `CHANGELOG.md`.
    - References:
      - owner request and credential choice (2026-10-15); owner decisions 2026-10-16 (four providers; acceptance on Hyper and OpenCode Go; cache parity).
  - Test Cases to Write:
    - `live-doc-check` (existing `scripts/live-doc-check.test.mjs`) stays green after the new section.
    - `live_env_example_has_no_values`: the template holds names and placeholders only (the manifest validator's secret-shape rule applied to the file).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — operator methodology.
    - Docs pages to create/edit:
      - `docs/live-testing.md`, `docs/release.md`, `CHANGELOG.md`.
    - `docs/index.md` update: no — the page is already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Live pre-flight check
  - Acceptance Criteria:
    - Functional: `scripts/live-preflight.mjs --suite <id-or-prefix>` reads every matching row's `requires`/`requiresAny` from `scripts/live-matrix.json`. It prints one row per check:
      - the env file resolved from `PRISM_LIVE_ENV_FILE` (or the manifest default) exists, is a regular file, and has mode `0600` or stricter;
      - the env file is outside the repository, or inside it and ignored by git (`git check-ignore`);
      - each required variable is present and non-empty (reported by name only);
      - no required variable's value appears in `git grep` over tracked files (a committed key fails);
      - each required binary is on `PATH` (`pi` for `release/cache-parity`), and `pi auth` reports the `hyper` and `opencode-go` providers ready, without printing credentials;
      - with `--probe`, one authenticated discovery request per provider using that provider package's own function (`listHyperModels`, `listOpenCodeGoModels`; for Laya, one reachability request to `LAYA_BASE_URL`; for Jev and hosted Liquid, the cheapest documented authenticated call; for `liquid-local`, one reachability request to `PRISM_LIVE_LLAMA_SERVER_URL`), so the request path is the shipped one.
    - Functional: Exit 0 only when every check passes; exit 2 on any failure. Output never contains a variable's value: a test seeds fake keys and scans stdout and stderr.
    - Performance: Without `--probe`, no network; with it, one request per provider.
    - Code Quality: Pure check functions with injected fs/env/exec/fetch, so they are unit-tested offline; reuses `resolveSuiteState()` from `scripts/live-matrix.mjs`.
    - Security: The script is the enforcement point for the methodology's credential rules.
  - Approach:
    - Documentation Reviewed:
      - `scripts/live-matrix.mjs` (`resolveSuiteState`, env file loading), `scripts/live-matrix.json` schema, `packages/providers/{hyper,opencode-go}/src/models.ts` (discovery functions).
    - Options Considered:
      - Folding the checks into `live-matrix.mjs`. Rejected: the pre-flight must run before an operator decides to spend money, and its output is a checklist, not a test report.
    - Chosen Approach:
      - A separate, offline-testable script with an opt-in probe per provider.
    - API Notes and Examples:
      ```text
      check                               status  detail
      env file mode                       pass    0600
      env file outside repo               pass    ~/.config/prism/live.env
      HYPER_API_KEY present               pass    (value hidden)
      OPENCODE_GO_API_KEY present         pass    (value hidden)
      keys not committed                  pass
      pi on PATH                          pass    pi 1.3.0
      pi providers ready                  pass    hyper, opencode-go
      probe hyper (GET /models)           pass    200, 14 models
      probe opencode-go (GET /models)     pass    200, 16 models
      probe laya (127.0.0.1:8000)         pass    reachable
      probe liquid-local (127.0.0.1:8080) pass    reachable
      ```
    - Files to Create/Edit:
      - `scripts/live-preflight.mjs` (new), `scripts/live-preflight.test.mjs` (new).
      - `package.json`: `"test:live:preflight": "bun scripts/live-preflight.mjs"`.
      - `docs/live-testing.md`: preflight reference (from Task 1's section).
    - References:
      - Task 1 methodology.
  - Test Cases to Write:
    - `preflight_rejects_world_readable_env_file`, `preflight_rejects_tracked_env_file`, `preflight_reports_missing_vars_by_name`, `preflight_detects_committed_key`, `preflight_never_prints_values`, `preflight_probe_uses_provider_package` (injected fetch, one per provider), `preflight_prefix_selects_all_release_rows`, `preflight_reports_missing_binary`, `preflight_reports_pi_provider_not_ready`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — operator tooling.
    - Docs pages to create/edit:
      - `docs/live-testing.md`: preflight usage.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The provider-agnostic SDK journey
  - Acceptance Criteria:
    - Functional: `apps/prism-agent/src/__tests__/live-provider-journey.test.ts` skips with a reason unless all of these are set: `PRISM_LIVE_PROVIDER_TESTS=1`, `PRISM_LIVE_RELEASE_JOURNEY=1`, `PRISM_LIVE_JOURNEY_PROVIDER` (`hyper` | `opencode-go`), and that provider's key. The fixture maps the provider name to its package instance (`hyper({ apiKey: "env:HYPER_API_KEY" })` or `opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })`) and its model variable. Nothing else in the suite names a provider. Agents are built only through `createAgent` and first-party packages, in a temp git repository, with these scenarios:
      1. **Stream contract.** One text run: event order `run.started → turn.started → message.delta* → message.completed → turn.completed → run.completed`; usage reported (`usage.estimated !== true`) and following the inclusive usage rule (plan 182 Task 4: `cacheReadTokens + cacheWriteTokens ≤ inputTokens`).
      2. **Tool loop.** `toolsCoding({ root })` + `approvalPackage({ mode: "ask", rules: [{ tool: "read" }] })` (a static allow for `read`); the model is told to read `README.md` and quote its first line; the transcript contains the line and a `tool.completed { status: "finished" }`. The second provider request carries the replayed thinking (plan 182 Tasks 6–7) and is accepted.
      3. **Approval suspend and resume across processes.** `sqliteStore({ path })` + the same approval config, so `write` asks; no host UI → `run.suspended`; a second `bun` subprocess opens `agent.session({ id })` over the same database and resumes `allow_once`; the file exists with the requested content.
      4. **Gate integrity, live.** In the same setup, resume with `modifiedArguments` pointing outside the root → `tool.completed { status: "blocked" }`, no file written (plan 177 Task 3).
      5. **Rewrite re-gate, live.** A test package rewrites the model's `write` path outside the root → denied by the coding hard-deny (plan 177 Task 2).
      6. **Ownership isolation.** One agent, two sessions under `{ userId: "a" }` and `{ userId: "b" }`; B's run on A's session id → `SessionNotFoundError`, and A's transcript text never appears in any of B's events (plan 177 Task 4).
      7. **Limits.** `limits: { maxTurns: 1 }` on a prompt that needs a tool → clean stop with `stopReason: "turn_limit"`; a token budget breach → `run.failed` with `limit`.
      8. **Compaction.** `memory-compaction` with a low threshold over a three-turn session → `compaction.completed` with a summary produced by the live model through `prism.models.client`, and the next turn still answers a question about turn one.
      9. **Remote host, two principals.** `serveAgent` on loopback WebSocket with an `authenticate` that maps two tokens to two principals; principal B cannot open A's session and receives none of A's approval requests (plan 178 Task 2).
      10. **Abort.** `session.abort()` during a streaming turn → `run.failed` with an abort code within 5 s, and the session accepts the next run.
    - Functional: Leak scan: after every scenario, `assertNoSecretLeak` from `@arnilo/prism/testing` runs over every event, `agent.inspect()`, every SQLite row (`SELECT *` of every table), the remote wire frames, subprocess stdout/stderr, and thrown error messages, with that provider's key as the needle.
    - Functional: API level: the suite asserts each loaded package reports `requires.api === KERNEL_API_LEVEL` in `agent.inspect()` (plan 179 Task 2).
    - Functional: OpenCode Go's required session correlation is satisfied by the kernel default (`applyDefaultProviderRequestOptions` stamps `sessionId`); the journey does not set it by hand, which proves the default works.
    - Performance: Budget per provider: at most 30 provider requests and 60k input tokens per full run, enforced by `limits` on every run plus a counting `model.call` hook that fails the suite on overrun; per-scenario timeout 120 s; each provider's suite ≤ 15 min. The `apps/prism-agent` README and the manifest rows state the budget.
    - Code Quality: Scenarios share one fixture module. Prompts are fixed strings with a deterministic instruction ("call the read tool with path README.md, then answer with its first line only"). Assertions check Prism behaviour, and model-text assertions are limited to substring presence. The two providers run the same file; a provider-specific branch in a scenario is not allowed (a test greps the scenario file for provider names).
    - Security: Keys are referenced only as `env:` refs; the test reads `process.env.<KEY>` only to seed the leak scan.
  - Approach:
    - Documentation Reviewed:
      - `apps/prism-agent/package.json` (already depends on approval, coding, sqlite, remote, compaction, headless), `apps/prism-agent/src/scenarios/*`, `packages/providers/{hyper,opencode-go}/src/index.ts`, plan 183 Task 5 (tier-1 scenarios), `src/testing/index.ts` (`assertNoSecretLeak`), plans 177–178, 179 Task 2, 182–183, and 185.
    - Options Considered:
      - A new `scripts/live-journey.test.ts` at the repo root. Rejected: the reference host is the roadmap's end-to-end proof (§2.13) and already wires every package the journey needs.
      - Two journey files, one per provider. Rejected: one parameterized file is what proves the journey is provider-agnostic.
    - Chosen Approach:
      - A tier-2 suite in the reference host, provider injected through one fixture, with hard request ceilings, run once per provider.
    - API Notes and Examples:
      ```ts
      const live = journeyProvider(process.env.PRISM_LIVE_JOURNEY_PROVIDER); // { pkg, model, keyEnv }
      const agent = await createAgent({
        model: live.model,           // e.g. "hyper/deepseek-v4-pro" | "opencode-go/kimi-k3"
        packages: [live.pkg, toolsCoding({ root }), approvalPackage({ mode: "ask", rules: [{ tool: "read" }] }), sqliteStore({ path })],
        limits: { maxTurns: 6, maxInputTokens: 20_000 },
      });
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/src/__tests__/live-provider-journey.test.ts` (new), `apps/prism-agent/src/__tests__/live/fixture.ts` (new), `apps/prism-agent/src/__tests__/live/resume-child.ts` (new, the second process).
      - `apps/prism-agent/package.json`: `devDependencies` for `@arnilo/prism-provider-hyper` and `@arnilo/prism-provider-opencode-go` (`workspace:*`).
      - `apps/prism-agent/README.md`: live journey section with the budget and the provider switch.
    - References:
      - plans 177 (Tasks 2–5), 178 (Task 2), 179 (Task 2), 182 (Tasks 4, 6–7), 183 (Tasks 2–3, 5), 185.
  - Test Cases to Write:
    - The ten scenarios above, named `live_journey_<n>_<slug>`, run per provider.
    - `live_journey_skips_without_credentials`: runs in `bun run test`; asserts a clean skip and zero network.
    - `live_journey_budget_guard_trips`: hermetic, with the mock provider forced past the request ceiling.
    - `live_journey_scenarios_name_no_provider`: the scenario module contains no provider id or package name.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — tests.
    - Docs pages to create/edit:
      - `apps/prism-agent/README.md`: live journey section.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Register the suites and wire them into the release
  - Acceptance Criteria:
    - Functional: `scripts/live-matrix.json` gains two rows. `release/journey-hyper`: `package: "@arnilo/prism-agent"`, `status: "active"`, `cwd: "apps/prism-agent"`, `command: "PRISM_LIVE_JOURNEY_PROVIDER=hyper bun test --timeout=0 src/__tests__/live-provider-journey.test.ts"`, `requires: ["PRISM_LIVE_PROVIDER_TESTS", "PRISM_LIVE_RELEASE_JOURNEY", "HYPER_API_KEY"]`, `model: [{ env: "PRISM_LIVE_HYPER_JOURNEY_MODEL", default: "deepseek-v4-pro", wired: true }]`, `scope`, and `cost` from Task 3. `release/journey-opencode-go` is the same with `OPENCODE_GO_API_KEY` and `PRISM_LIVE_OPENCODE_GO_JOURNEY_MODEL`; its default model comes from plan 183 Task 1 (e).
    - Functional: `node scripts/generate-live-docs.mjs --write` refreshes the table; `scripts/live-doc-check.test.mjs` and `scripts/live-matrix.test.mjs` pass.
    - Functional: `scripts/e2e-coverage.json` records the journey as covering the kernel root, `/testing`, both provider packages, and the packages it loads.
    - Functional: Plan 187 Task 2's pre-flight lists as required steps before the owner confirmation: the strict run of `providers/` and `release/` (both journeys and cache parity), and the evidence file. It is edited in this task if not already present.
    - Performance: n/a.
    - Code Quality: No runner changes beyond the manifest rows unless Task 3 needs a longer suite timeout (`PRISM_LIVE_SUITE_TIMEOUT_MS` per-suite override, if the runner lacks one).
    - Security: Each row's `scope` names the least-privilege key and spend cap; the manifest validator's secret-shape rule passes.
  - Approach:
    - Documentation Reviewed:
      - `scripts/live-matrix.json` (row schema), `scripts/generate-live-docs.mjs`, `scripts/e2e-coverage.json`, plan 187 Task 2.
    - Options Considered:
      - A separate release-only runner. Rejected: strict mode plus a filter already expresses "these suites must run".
    - Chosen Approach:
      - Two manifest rows and one plan 187 pre-flight line.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live
      ```
    - Files to Create/Edit:
      - `scripts/live-matrix.json`, `docs/live-testing.md` (generated table), `scripts/e2e-coverage.json`, `plans/187-Phase-11-Part-N-Retired-Name-Sweep-Publish-And-Deprecation.md` (Task 2 pre-flight, if not already edited).
    - References:
      - Task 3; plans 183 Task 6 and 184 Task 4 (their rows).
  - Test Cases to Write:
    - `live-matrix > manifest validates` and `live-doc-check` (existing, green with the rows).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/live-testing.md`: generated table rows.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: First acceptance run and evidence (owner provides the keys)
  - Acceptance Criteria:
    - Functional: Prerequisites: plans 181–185 are complete; the owner confirms that `~/.config/prism/live.env` holds the four keys (`LIQUID_API_KEY` added 2026-10-17) with spend caps; `laya-serve` and `llama-server` (`d1-3B`) are running on the dev machine; `pi` is installed with Hyper and OpenCode Go configured. The executor then:
      1. runs the preflight with `--probe`;
      2. runs the strict `providers/` run, both journeys, and the cache-parity row;
      3. writes `docs/_evidence/live-release-acceptance-0.13.0.md`: commit; per provider, the model ids, per-scenario status, request counts, input tokens, durations, and leak-scan result; failure classifications; the T1 summary (linking `docs/_evidence/provider-live-0.13.0.md`); the cache-parity table (linking `docs/_evidence/cache-parity-0.13.0.md`); the operator.

      The file contains no secret: the task runs `assertNoSecretLeak` over it with every key.
    - Functional: Any `prism`-class failure, on either provider, reopens the owning plan's task; the run is repeated after the fix, and the evidence file records every run.
    - Performance: Record actual request counts against each budget.
    - Code Quality: The evidence file follows the existing `docs/_evidence/` conventions.
    - Security: The executor never prints or asks for a key in chat; if the preflight fails on credentials, the executor stops and asks the owner to fix the env file.
  - Approach:
    - Documentation Reviewed:
      - Task 1 procedure, `docs/_evidence/live-matrix-report.md` format, plans 183 Task 6 and 184 Task 4 evidence files.
    - Options Considered:
      - Waiting for the publish task to run it the first time. Rejected: a failure found during publish pre-flight delays the release more than one found now.
    - Chosen Approach:
      - One full acceptance run as soon as the fixes land; plan 187 Task 2 repeats it on the release commit.
    - API Notes and Examples:
      ```bash
      bun scripts/live-preflight.mjs --suite release/ --probe
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live
      PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live
      ```
    - Files to Create/Edit:
      - `docs/_evidence/live-release-acceptance-0.13.0.md` (new), `docs/_evidence/live-matrix-report.{json,md}` (regenerated by the runner).
    - References:
      - Tasks 1–4; plans 183, 184.
  - Test Cases to Write:
    - n/a — an execution task; its proof is the evidence file and the strict runs' exit codes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/_evidence/live-release-acceptance-0.13.0.md` (evidence, excluded from the published tarball by the root `files` rule `!docs/_evidence`).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run typecheck`
- `bun test --timeout=0 scripts/live-preflight.test.mjs scripts/live-matrix.test.mjs scripts/live-doc-check.test.mjs`
- `bun run --filter @arnilo/prism-agent test` (journey skips cleanly without credentials)
- `node scripts/live-matrix.mjs --check`
- `bun scripts/live-preflight.mjs --suite release/ --probe` (owner-provided keys)
- `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live`
- `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live`
- `PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
