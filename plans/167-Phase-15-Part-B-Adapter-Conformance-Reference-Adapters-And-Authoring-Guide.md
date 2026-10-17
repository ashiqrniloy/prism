# Phase 15 Part B — Adapter conformance, reference adapters, and the authoring guide

## Objectives

- Check that Part A left the adapter contract, `processDriver`, and the kernel seams as its review decided.
- Extend the `/testing` scripted CLI so it can stand in for binaries configured through settings files and workspace files, replay recorded frames, and report what it loaded from a fake user home. Add `recordFixtures` so a host can capture frames from the binary it pins.
- Ship `adapterConformance`, which runs `driverConformance` against `processDriver(adapter)` plus the adapter-level legs.
- Ship three offline reference adapters in `examples/adapters/`, one per integration shape in roadmap §2.12.4, each passing `adapterConformance`.
- Prove that a host outside the repo can write and test an adapter using only public imports.
- Write the authoring guide (the package README and `docs/next/agent-adapters.md`), with the vendor research moved in as dated, non-normative worked mappings.
- Ship `examples/custom-adapter.ts` and record the Phase 15 Done criteria.

## Expected Outcome

- `createScriptedCli` accepts dialects with a serialized `locate` (configuration discovery from argv, env, and files) and scripts with `{ raw }` steps. Its record lists what it loaded, including anything planted in a fake user home. `recordFixtures.command(...)` and `recordFixtures.finish(...)` turn one live run into a redacted fixture file.
- `adapterConformance(adapter, { dialect, fixtures })` from `@arnilo/prism-driver-process/testing` passes for `examples/adapters/stream-cli.ts`, `rpc-server.ts`, and `workspace-config.ts`, offline.
- An adapter written in a temporary workspace passes `adapterConformance` while importing only `@arnilo/prism`, `@arnilo/prism/driver-kit`, `@arnilo/prism/testing`, and `@arnilo/prism-driver-process` (including its `/testing` subpath, per plan 166 Task 1 (j)).
- `docs/next/agent-adapters.md` and `packages/drivers/process/README.md` teach the contract, transport choice, spec and activity mapping, the hook codec and its fail-closed response, honest auth policy, fixture recording, and `adapterConformance` in the host's CI. They carry dated worked mappings for the three researched binaries and warn that binaries and terms change and that the adapter's author owns compliance.
- `bun examples/custom-adapter.ts` runs offline under the demo gate. It extends the `rpc-server` reference adapter, edits in a worktree under `approval`, and prints the captured activity.
- The Phase 15 Done criteria are recorded in Task 10's note.

This plan implements roadmap **Phase 15 — Generic process driver and the adapter contract**, Part B. It **depends on plan 166** (Part A), whose Task 1 is the review for both parts. This plan opens with an entry check instead of a second review. If the entry check finds a contract missing, it stops, and the change goes back to plan 166 as an amendment. Placement follows plan 166 Task 1 (j) and (l): `adapterConformance` lives in the package's `/testing` subpath because the kernel never imports a package, and `recordFixtures` and the scripted-CLI additions are vendor-neutral kernel `/testing` code. The reference adapters are examples: unpublished, offline, and written with neutral identifiers. Their headers point to the guide's worked mappings instead of naming a vendor. The guide is the one place vendor names appear, and the vendor-name scan exempts it. This plan does not bump versions, publish, deprecate on npm, or edit released `/docs`.

## Tasks

- [x] Task 1: Part B entry check — the adapter contract as shipped (read-only)
  - Acceptance Criteria:
    - Functional: Confirm from source and plan 166's task notes that each Part A contract shipped as plan 166 Task 1 decided, citing `file:line`: `AgentAdapter` and its part types, `adapterDriver`, `processDriver`, `extendAdapter`, the `ProcessDriverError` codes, the `driver-process:<name>` service `inspect()`, `PackageAPI.tools.list`/`skills.list`/`get`, the `DriverRunContext` additions, and `relayCommand`.
    - Functional: Confirm plan 166 Task 1 decisions (j), (k), and (l) still hold against the shipped code, and that the user confirmed (j) (the `/testing` subpath placement). If the user chose otherwise, amend Tasks 3 and 7 before they start.
    - Functional: Confirm that the vendor facts plan 166 Task 1 re-verified are recorded with dates and sources, ready for Task 8.
    - Functional: Record the failing-test baseline and compare it with plan 166's close.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every confirmation cites its span.
    - Security: Confirm that `driverConformance`'s `credential_canary` and `no_secret` legs run unchanged against `adapterDriver(adapter)`. Record whether the atime limitation (`plans/backlog.md`, "Canary cannot see silent reads on atime-less filesystems") still applies on this host.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 15 Scope and Done; plan 166 (all notes); `packages/drivers/process/README.md`
    - Options Considered:
      - A second full review. Rejected: plan 166 Task 1 covered both parts.
    - Chosen Approach:
      - Read the shipped spans and amend Tasks 2–10 in place.
    - API Notes and Examples:
      ```bash
      graft skeleton packages/drivers/process/src/adapter.ts
      graft callers adapterDriver --depth all
      ```
    - Files to Create/Edit:
      - `plans/167-Phase-15-Part-B-Adapter-Conformance-Reference-Adapters-And-Authoring-Guide.md`: Notes and amendments only.
    - References:
      - plan 164 Task 1 (entry-check pattern)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-11):
    - **Verdict: proceed; no contract re-cut.** Part A's shipped source matches its Task 1 decisions and Tasks 2–7 execution notes. Only this plan is edited; no production code, tests, exports, fixtures, or config change. Tasks 2–10 remain open. Whole-plan failures below, including two newly observed coding-tools failures, are the verification baseline, not evidence of release readiness. They do not invalidate a later adapter task.
    - **Contract inventory (current spans).** `packages/drivers/process/src/adapter.ts:18-124` defines `ProcessDriverConfig`, `EncodeContext`, `RpcFrame`/`OutboundFrame`, `Decoded`, launch/restore/resume/session/configure/open/request contexts, `RequestHandler`, `AbortStep`, `AdapterIdentity`, and `AgentAdapter`; `:126-206` validates it. This includes F1's session/turn IDs and `onResult`, F3's archive context, F4's `permissionTool`, and F5's hook argv/command. Public type/value exports are `packages/drivers/process/src/index.ts:1-5`. `adapterDriver` (`driver.ts:33-64`) delegates descriptor/profile/config/probe/run to `defineDriver`; `processDriver` (`:66-90`) delegates to `driverPackage` and adds inspection. The per-run pipeline (`:103-213`) wires isolation, broker, tools, skills, materialization, protected env, and cleanup. JSON-RPC is implemented at `transports/json-rpc.ts:8`; shared turn handling at `turn.ts:8`. F2's separate abort/graceful paths are `abort.ts:17-73`; F3's contained restore, protected-path check, and per-turn archive are `session.ts:6-72` (paths are checked, not the provenance of opaque transcript strings).
    - **Extension, errors, inspection.** `extend.ts:24-54` implements required identity, one-level object/descriptor merges, explicit function replacement or wrapping, array replacement, ancestry, validation, and policy narrowing; `:57-72` rejects widening. These match Part A Task 7's clarified contract, rather than an implicit function-replacement guess. `errors.ts:1-18` has exactly `vendor_request_unhandled`, `vendor_request_failed`, `vendor_limit`, `adapter_invalid`, and `vendor_process_exited`; no temporary `transport_unsupported`. `driver.ts:85-87` provides `driver-process:<name>.inspect()` and the status note; `inspect.ts:4-33` includes identity/ancestry, binary, transport, capture, deployment, isolation, effective auth policy, and acknowledgements.
    - **Kernel seams.** `src/packages/api.ts:89-105` exposes `tools.list`, `skills.list`, and `skills.get`; `src/packages/loader.ts:629-633,703-720` enforces post-setup reads and frozen copies. `src/driver-kit/define.ts:20-42` carries effective tools/skills, host, and service consumption; `:224-226` supplies late-bound registry readers. `src/driver-kit/relay-command.ts:10-19` resolves the absolute kernel CLI with the Bun-only source fallback (F7); `src/driver-kit/index.ts:14` exports it. Package API and driver context/relay tests passed in the affected run below. No additional kernel seam is required.
    - **Decisions (j), (k), (l).** Plan 166 Task 1 (`plans/166-Phase-15-Part-A-Generic-Process-Driver-And-Adapter-Contract.md:146-147`) left (j) awaiting confirmation. In this task's conversation on 2026-10-11 the user answered **“Confirm the proposed placement”**: `adapterConformance` belongs in `@arnilo/prism-driver-process/testing`; vendor-neutral `recordFixtures` and scripted-CLI additions belong in kernel `/testing`. This resolves the roadmap Phase 15 `/testing` placement conflict without a kernel-to-package import. Tasks 3 and 7 already name the confirmed subpath and need no amendment. (k) remains an external tee wrapper, with no production recording knob. (l) remains necessary: `src/testing/scripted-cli.ts:67-78,145-155,223-226` has no `locate`/raw step and discovers hook/endpoint only through argv. Tasks 2 and 3 retain that work; it is not missing Part A implementation.
    - **Dated research handoff.** Plan 166 Task 1's dated source table (`:160-184`, fetched 2026-10-11) records verified, partly verified, and unverifiable facts with source domains/paths for all three shapes and terms. It is ready as a research ledger, not as fully verified guide text. Task 8 already requires browser re-verification of the unresolved hook/install/home/auth/CLI/terms rows, `item/` request prefixes, the experimental-API caveat, and the HTTP-hook failure option. No vendor fact was newly verified or promoted to normative guidance here. Roadmap Phase 15 Scope/Done (`roadmap.md:2094-2190`) and the package README's contract, lifetime, security, transports, and extension sections were reviewed.
    - **Security proof.** The unchanged `src/testing/driver-conformance.ts:394-430` legs were run through `driverConformance(adapterDriver(adapter), ...)` using a temporary extension of Part A's neutral test adapter (`packages/drivers/process/src/__tests__/fixtures/test-adapter.ts:5`). The probe adds a protected credential path and env, hook codec/argv, and mid-turn steering; it does not edit the runner or repository. `/tmp/part-b-entry-conformance.ts` and `/tmp/part-b-entry-conformance.log` record **12 passed / 1 skipped** (only `resume`, declared `none`), including both `credential_canary` and `no_secret`. The canary leg explicitly reports **no atime**, so the existing `plans/backlog.md:914` limitation still applies: silent reads may pass; access errors and protected-env inheritance are checked. The host probe is the runner's own `driver-conformance.ts:566-580`. This is one neutral stream-adapter proof; Task 3 and the reference-adapter tasks still own coverage of both transports and integration shapes.
    - **Baseline checks.** Root `bun run typecheck` (including core build/workspaces/examples) and process-package `bun run typecheck` passed. `bun test --timeout=0 packages/drivers/process/src/__tests__ src/driver-kit src/testing src/__tests__/package-api-reads.test.ts src/__tests__/driver-kit-vendor-neutral.test.ts`: **179 passed / 0 failed, 22 files**. MCP server: **41 passed / 0 failed**, matching Part A's entry baseline. Public exports: **107 passed / 0 failed** (`/tmp/part-b-entry-exports.log`). Docs: **164 passed / 6 failed**, matching Part A Task 7's close: local markdown links; install/coverage/SQL docs; manifest provider kinds; connector-sidecar docs; runtime-validator/tool-scoping docs; context/skills activation docs. `bun scripts/release.mjs gate` still exits 1 before compatibility checks because `PRISM_TEST_POSTGRES_URL` is unset. Initial sandbox test attempts were stopped after socket denials; the cited successful runs used permitted local sockets. Logs are `/tmp/part-b-entry-{typecheck,package-typecheck,tests-permitted,mcp,docs,release}.log`. No compatibility baseline regeneration or retirement sweep is needed for this plan-only edit.

    - **Baseline difference and limits.** `cd packages/tools/coding && bun test --timeout=0`: **583 passed / 2 skipped / 2 failed**, versus Part A Task 1's 585 passed / 0 failed. Both failures reproduce in the focused `src/agent/__tests__/process-sessions.test.ts` run (**9 passed / 2 failed**): `start → output paging → input → wait exit` and `sandbox startProcess: output/input/kill parity` receive empty output instead of `hello`/`sbx` (`:84,428`). Cause is not established; do not call them flakes or silently inherit a green coding-tools baseline. Logs: `/tmp/part-b-entry-{coding,process-sessions}.log`. No code is changed to address them in this read-only task. The optional packaging comparison was interrupted before completion (the first restricted attempt also hit npm dry-run/cache permissions); Part A Task 7's four packaging/dependency-tree failures remain recorded but were not re-established here. Full packaging verification remains for the whole-plan gate.

- [x] Task 2: `/testing` — scripted-CLI configuration discovery, raw replay, fake-home isolation, and `recordFixtures`
  - Acceptance Criteria:
    - Functional: `ScriptedDialect` gains an optional `locate(input: { argv, env, cwd, readFile }) => { hookCommand?, endpoint?, loaded: string[] }`, serialized into the binary like the dialect's other functions and checked by `defineScriptedDialect`. When present, it replaces the fixed `--hook-command`/`--mcp-endpoint` argv parsing in `binarySource` (`src/testing/scripted-cli.ts:185-417`). When absent, behavior is unchanged, and the two reference dialects keep their argv convention. `readFile` returns `undefined` for a missing file, never throws.
    - Functional: The binary records `{ event: "loaded", items: string[] }` from `locate`'s `loaded` list.
    - Functional: `ScriptStep` gains `{ raw: string }`, which writes the line verbatim to stdout without `frames()`. `validateScript` accepts exactly one of `out`, `hook`, `mcp`, `raw`, or `wait`.
    - Functional: `createScriptedCli` gains an optional `home` option (a directory the binary sees as `HOME`), so a test can plant a hook, a skill, or an MCP server there. The directory is caller-owned; `cli.env.HOME` points to it, and the conformance harness owns and removes its temporary planted home.
    - Functional: `driverConformance`'s `strict_isolation` leg keeps its `assertIsolation` checks (`src/testing/driver-conformance.ts:375-391`). When the dialect has `locate`, it also plants one hook, one skill, and one MCP server under a fake home, runs a turn under `isolation: "strict"`, and fails if `loaded` names any planted item. `fixtures.home` optionally supplies the three `{ path, content }` entries for a dialect-specific layout; by default they are `.scripted/hook.json`, `.scripted/skills/planted/SKILL.md`, and `.scripted/mcp.json`. Loaded items are relative or absolute file paths. Workspace-file drivers receive an isolated Git workspace through a test-only `workspace` service in every leg.
    - Functional: `recordFixtures.command(command, logPath)` returns an argv that runs a stdlib Bun tee script. The script spawns `command`, passes stdin, stdout, stderr, and the exit code through unchanged, and appends `{ dir: "in" | "out", line }` records to `logPath`. `recordFixtures.finish(logPath, outPath, { redact?, secrets? })` writes a fixture file `{ version: 1, turns: [{ input: string[], output: string[] }] }`, splitting turns on input lines. It applies `redact` per line and replaces every `secrets` value and every bearer-token-shaped value with `[redacted]`. `recordFixtures.load(path)` returns the fixture and fails closed on an unknown version.
    - Performance: `locate` runs once per binary start. The tee adds one pipe hop and is used only when a host records.
    - Code Quality: All additions are vendor-neutral and stay in `src/testing/`. The existing tests keep passing unchanged, which shows the argv convention is the default. The vendor-name scan covers these files.
    - Security: The tee never writes the environment to the log. `finish` refuses to write a fixture in which a `secrets` value survives redaction (`fixture_secret`). The harness fake home is a temp directory removed when the leg closes, including on failure. `createScriptedCli.dispose` removes its generated files without deleting a caller-supplied home.
  - Approach:
    - Documentation Reviewed:
      - plan 166 Task 1 (k) and (l); `src/testing/scripted-cli.ts` (`ScriptedDialect` `:67-74`, `binarySource` argv parsing `:219-226`, `validateScript` `:145`); `src/testing/driver-conformance.ts:375-391`
      - roadmap Phase 15 Scope (`recordFixtures`), §2.12.16 "Vendor churn"
    - Options Considered:
      - Teach the scripted binary each shape's config files directly. Rejected: that would put a dialect's file layout into kernel `/testing`; `locate` keeps it in the adapter author's dialect.
      - Record fixtures inside the driver (a `record` config key). Rejected: it adds a production knob, and the tee wraps the unmodified binary without the driver knowing.
    - Chosen Approach:
      - An optional serialized `locate`, a `raw` step, a `home` option, and a tee-based recorder, all opt-in with unchanged defaults.
    - API Notes and Examples:
      ```ts
      const tee = recordFixtures.command(["my-agent", "--stream"], "/tmp/session.log");
      // set the adapter's binary to `tee` for one live run, then:
      await recordFixtures.finish("/tmp/session.log", "fixtures/my-agent-2.3.json", { secrets: [apiKey] });
      ```
    - Files to Create/Edit:
      - `src/testing/scripted-cli.ts`: `locate`, `raw`, `home`, the `loaded` record.
      - `src/testing/record-fixtures.ts` (new), `src/testing/index.ts`.
      - `src/testing/driver-conformance.ts`: the planted-home check in `strict_isolation`.
      - `src/testing/__tests__/scripted-cli.test.ts`, `src/testing/__tests__/record-fixtures.test.ts` (new), `src/testing/__tests__/driver-conformance.test.ts`, `src/testing/__tests__/reference-driver.ts` (strict and deliberately inherited homes, workspace-files descriptor).
      - `scripts/compat-baseline/arnilo__prism.txt`, `scripts/budgets.json`, `src/__tests__/public-export-contract.test.ts`: regenerated through `bun scripts/release.mjs gate --update-baseline` when its evidence prerequisites are available; otherwise use its declared-surface extractor for the root only and record the blocked gate. The public export test checks the built `/testing` subpath. The task note records the diff.
      - `docs/next/testing.md`, `CHANGELOG.md`.
    - References:
      - plan 164 Task 7 (scripted CLI), plan 165 Task 3 (MCP steps)
  - Test Cases to Write:
    - `locate_finds_hook_command_in_settings_file`: a dialect reading a JSON file named by `--settings` drives a gate through the relay.
    - `locate_absent_keeps_argv_convention`: the reference dialects are unchanged.
    - `raw_step_writes_line_verbatim`.
    - `strict_isolation_leg_fails_when_planted_item_loaded`: a deliberately leaky driver (one that passes the real home) fails the leg, and a strict one passes.
    - `record_fixtures_tee_is_transparent`: output and exit code are identical with and without the tee.
    - `record_fixtures_finish_splits_turns_and_redacts`.
    - `record_fixtures_refuses_surviving_secret`.
    - `record_fixtures_load_rejects_unknown_version`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New `/testing` exports and dialect members.
    - Docs pages to create/edit:
      - `docs/next/testing.md`: `locate`, `raw`, `home`, `recordFixtures`.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`


  - Notes (executed 2026-10-12):
    - Implemented optional serialized `locate({ argv, env, cwd, readFile })`, validated at dialect definition and invoked once at startup. It replaces both fixed flag lookups and records loaded file paths. Missing/unreadable files return `undefined`; reference dialects retain their existing argv behavior. Added validated raw steps and caller-owned `home` via `cli.env.HOME`.
    - Kept the isolation eligibility assertions and added a real strict turn against a temporary planted host home. `fixtures.home` supplies dialect-specific hook/skill/MCP file layouts, with containment checks; default paths are documented above. The harness restores HOME and removes planted data on success or failure. Workspace-files descriptors get a temporary Git workspace via a test-only service in every leg, since the earlier materialization/gating legs also require one. Setup failures clean up the generated CLI and profile root. The negative regression passes only when the inherited-home driver is rejected in `strict_isolation`; the strict positive driver uses the workspace-files descriptor.
    - Added the stdlib tee and `recordFixtures.command`/`finish`/`load` under kernel `/testing`. The tee preserves forwarded bytes (including CRLF), stderr, a non-zero exit, and partial final lines, while logging only stdin/stdout wire lines. Finish masks supplied secrets and bearer shapes, checks final JSON and decoded lines for surviving supplied secrets before writing, and load validates version and turn shape. New output files use mode 0600. Startup output occupies an empty-input turn; each subsequent input line starts a turn, including RPC responses/notifications. Raw logs remain sensitive and must be removed after use.
    - Tests were added before implementation. The settings-file discovery test invokes `prism relay hook` through a real broker; unchanged stream/RPC and MCP tests verify the default flags. New tests cover verbatim raw output and invalid steps, locate validation/context, inherited-home rejection, tee transparency, segmentation/redaction, surviving-secret refusal, invalid records, and unknown/malformed fixtures. `docs/next/testing.md`, `CHANGELOG.md`, and the built public-subpath contract test are updated.
    - Validation: `bun run typecheck` passed (core/family builds, all workspace typechecks, examples; `/tmp/task2-typecheck-final.log`). `bun test --timeout=0 src/testing src/driver-kit packages/drivers/process/src/__tests__ src/__tests__/driver-kit-vendor-neutral.test.ts src/__tests__/public-export-contract.test.ts`: **289 passed / 0 failed**, 23 files (`/tmp/task2-validation.log`). Local process pipes and relay sockets require the permitted test run; the sandbox-only attempt produced EPERM. Focused formatting and lint completed with no errors. Vendor-neutrality includes all new testing implementation files. No name was retired, so no retirement sweep is needed.
    - Baseline: `bun scripts/release.mjs gate --update-baseline` and the final normal gate both stop before compatibility checks at the unchanged `PRISM_TEST_POSTGRES_URL` evidence prerequisite (`/tmp/task2-release-{update,final}.log`). Used the same `extractDeclaredSurface`/`serializeSurface` helpers against the successfully built root `dist` to regenerate only `arnilo__prism.txt`: **+3 / -0 / 0 changed**, `recordFixtures`, `type RecordedFixture`, `type RecordFixtureOptions`. A second extraction reports no drift. The export counter measures **1718**, of which this task adds three names; removing those names yields 1715 versus the previous recorded ceiling 1713. Updated the budget with that distinction, rather than attributing the pre-existing two-name difference to this task. No dependency or production driver recording option was added. The focused per-package export-budget test still fails for untouched packages only: MCP 149/122 (+27), tools-work 454/452 (+2), and channels 123/106 (+17), recorded in `/tmp/task2-budget.log`. A direct `checkExportBudget` confirms the root passes at 1718/1718; those other ceilings were not raised.
    - Ownership clarification: deleting an arbitrary supplied `home` in `createScriptedCli.dispose()` could destroy caller data. The CLI owns only its generated directory; conformance owns and removes the planted home when its leg closes. Later reference adapters must implement `locate` honestly and supply their actual home layouts via `fixtures.home`; no generic harness can discover an undeclared vendor layout. Task 3 should forward this fixture option. The Phase 15 guide and whole-plan readiness remain Tasks 3–10.

- [x] Task 3: `adapterConformance` in `@arnilo/prism-driver-process/testing`
  - Acceptance Criteria:
    - Functional: Forward `fixtures.home` to `driverConformance` so each reference dialect can plant its actual hook/skill/MCP layout; `locate.loaded` reports relative or absolute paths as Task 2 defines.
    - Functional: `adapterConformance(adapter, { dialect, fixtures })` runs `driverConformance(adapterDriver(adapter), { dialect, fixtures })` and then these adapter legs, returning every leg's result. A failing leg throws `AdapterConformanceError` naming it.
      - `fixture_replay`: when `fixtures.recorded` is given, each recorded turn's output lines are replayed as `{ raw }` steps. Every line produces an observed activity, an `agent.raw` event (`capture: "all"`), or a turn signal. The leg fails on a line that produces none of these.
      - `unmapped_to_raw`: a line `decode` marks unmapped reaches `agent.raw` under `capture: "all"` and is counted under `"mapped"`.
      - `fail_closed_response`: with the broker's socket removed, the relay's output equals the adapter's declared `hooks.failClosed`, and the binary does not run the tool. Skipped, with a reason, for an adapter without relay hooks.
      - `unknown_request_fails` (`json-rpc` only): a server request with no handler fails the run with `vendor_request_unhandled`.
      - `abort_within_grace`: run on the adapter's own transport and abort ladder.
      - `resume_strategy`: `store` resumes in a new process from the store; `vendor` passes the recorded id; `none` starts fresh.
      - `hosted_acknowledgement`: for each mode that permits `hosted`, a hosted run without the mode's acknowledgements fails with `plan_login_not_permitted`, and with them it starts.
      - `limit_signal`: a decoded `rate_limit` notice stops the run without a second spawn.
    - Functional: `fixtures` extends `DriverConformanceFixtures` with `recorded?: string` (a fixture path from `recordFixtures.finish`) and `scriptFor?(activity) => ScriptStep[]`, which maps neutral activity to the adapter's wire for the kit legs when the dialect's `frames` cannot.
    - Functional: `package.json` gains `"./testing": "./src/testing.ts"`. The package root does not import `/testing`, and a test asserts it.
    - Performance: Each leg builds and disposes its own binary, profile root, and agent, as `driverConformance` does. A full run on one adapter stays within the package suite's timeout, and the time is recorded in the note.
    - Code Quality: The package's `/testing` imports only the public kernel subpaths (`@arnilo/prism`, `/driver-kit`, `/testing`) and its own root. It adds no vendor name.
    - Security: The canary and `no_secret` legs come unchanged from `driverConformance`. `fixture_replay` loads only fixtures that passed `recordFixtures.load`.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 15 Scope (`/testing` additions) and Done; plan 166 Task 1 (j)
      - `src/testing/driver-conformance.ts:42-185` (options, legs, error type)
    - Options Considered:
      - `adapterConformance` in kernel `/testing`, taking the driver factory as a parameter. Rejected: an awkward API, and it still couples kernel testing code to the package's contract types.
      - Put it in the package root export. Rejected: production imports would load test code.
    - Chosen Approach:
      - A package `/testing` subpath that composes the kernel's `driverConformance` with adapter legs.
    - API Notes and Examples:
      ```ts
      import { adapterConformance } from "@arnilo/prism-driver-process/testing";
      const result = await adapterConformance(myAdapter, {
        dialect: myDialect,
        fixtures: { config: (cli) => ({ binary: cli.command[0], args: cli.command.slice(1) }), recorded: "fixtures/my-agent-2.3.json" },
      });
      ```
    - Files to Create/Edit:
      - `packages/drivers/process/src/testing.ts` (new), `packages/drivers/process/package.json` (`./testing` export)
      - `src/testing/driver-conformance.ts`, `src/testing/scripted-cli.ts`: minimal prerequisites for mapping neutral output through `fixtures.scriptFor` and interpreting exit-zero printed denial through serialized `hook.allowed` (the exit-code default is unchanged).
      - `docs/next/testing.md`: document those testing-only extension points.
      - `packages/drivers/process/src/__tests__/adapter-conformance.test.ts` (new): runs it on Part A's test adapters for both transports, plus deliberately broken adapters.
      - `src/__tests__/packaging.test.ts` (the subpath), `scripts/compat-baseline/arnilo__prism-driver-process.txt` (regenerated; diff in the note)
      - `packages/drivers/process/README.md` ("Testing your adapter"), `CHANGELOG.md`
    - References:
      - plan 164 Task 7 (`driverConformance`)
  - Test Cases to Write:
    - `adapter_conformance_passes_for_jsonl_and_json_rpc_test_adapters`.
    - `fixture_replay_fails_on_silently_dropped_line`: an adapter whose `decode` returns empty activity, with no `unmapped` flag, for a recorded line fails `fixture_replay`.
    - `fail_closed_leg_catches_wrong_declared_response`: an adapter whose relay prints something other than its declared `failClosed` fails.
    - `unknown_request_leg_catches_default_allow`: a `json-rpc` adapter with a catch-all handler that allows fails.
    - `hosted_ack_leg_catches_missing_check`.
    - `testing_subpath_not_imported_by_root`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new package subpath.
    - Docs pages to create/edit:
      - `packages/drivers/process/README.md`: "Testing your adapter" (dialect, fixtures, legs, CI usage).
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-12):
    - Added the isolated `@arnilo/prism-driver-process/testing` export with `adapterConformance`, `AdapterConformanceError`, `AdapterConformanceFixtures`, and `AdapterConformanceOptions`. It forwards the kernel fixtures, including `home`, and preserves kernel canary/no-secret checks. All kernel failures are wrapped with their original leg name. Eight adapter legs cover actual replay (including decoder delivery and invalid-line raw capture), capture modes, exact declared relay response with the socket removed, unknown requests, the transport's abort ladder, two-process resume with actual archived/restored state or recorded vendor id, every hosted mode's acknowledgement guard, and one-spawn rate limits. Each leg owns and removes its temporary CLI/profile/agent state; resume deliberately shares the session store within its leg.
    - Small prerequisites: kernel `driverConformance` now maps its neutral `out` steps through optional `fixtures.scriptFor`. Command-hook dialects gain serialized `hook.allowed({ exitCode, stdout })`; both the scripted binary and the kernel deny/fail-closed assertions use it. This is necessary for Task 6's exit-zero printed denial. Without it, the harness would report that declaration as an allow. Defaults and production code are unchanged. Tasks 4–6 should set this parser for printed-deny dialects; the package README and `docs/next/testing.md` document it. No dependency added and no retired names.
    - Tests: affected kernel testing/driver-kit/process/vendor-neutral run passed **189 / 0** across 23 files (`/tmp/task3-suite.log`). Final expanded adapter suite passed **11 / 0** in **51.14 s** (`/tmp/task3-final-adapter.log`); new conformance tests use the kernel suite's 180-second overall timeout because combined runs take longer under contention (internal startup and abort bounds are unchanged); individual complete runs on the two neutral adapters took **4.94 s** (JSONL) and **4.57 s** (RPC). Tests additionally cover dropped recorded lines, valid/invalid/unmapped replay, wrong fail-closed declaration, default-allow request tables, acknowledgement refusal/admission, `store`/`vendor` resume, printed deny, `scriptFor`, and export isolation. The hosted guard test would fail if the shared policy check were removed; the guard is not replaced with a fake implementation.
    - Build and root/workspace typecheck passed; process-package typecheck passed. Public-export contract tests passed **107 / 0** in the combined export run; that run also recorded a driver startup timeout during concurrent workspace build (117 passed / 1 failed overall). The subsequent isolated adapter run above passed. Do not run workspace declaration builds concurrently with the subprocess timing checks. Focused packaging subpath assertion passed **1 / 0** (`/tmp/task3-packaging.log`); the full packaging suite and docs suite retain the Task 1 baseline and are not claimed green. Vendor-name scan of `packages/drivers/process/src` returned no hits.
    - Final combined check after the last changes: **299 passed / 2 failed, 301 tests, 24 files, 423.84 s** (`/tmp/task3-verified.log`). All **11 adapter tests**, the new parser-validation test, and the **107 public-export tests** passed. The two failures were existing `invalid_json_is_unmapped_and_does_not_end_turn` and `relay_rewrite_support_false`, each receiving `driver_unavailable` from the binary probe. Both passed immediately in a focused rerun (**2 / 0**, `/tmp/task3-probe-rerun.log`). The broad run is not claimed green; the probe-refusal cause is not established, and production probe limits were not changed. Final process-package typecheck passed. Task 10 must re-establish the whole-plan gate in its target environment.
    - Compatibility: `bun scripts/release.mjs gate --update-baseline` remains blocked before compatibility checks by missing `PRISM_TEST_POSTGRES_URL` (`/tmp/task3-release.log`). Used the gate's `extractDeclaredSurface`/`serializeSurface` on a successful package declaration emit and the built root to regenerate only the affected baselines. Package baseline diff: **+ `AdapterConformanceError`, + `adapterConformance`; zero removed/changed names** (`/tmp/task3-baseline.log`). Root baseline: zero delta. The extractor does not enumerate interface declarations; both fixture/options interfaces are present in the emitted `/testing` declarations. Full release readiness and whole-plan verification remain Task 10.

- [x] Task 4: Reference adapter `examples/adapters/stream-cli.ts` (flag-configured stream CLI)
  - Acceptance Criteria:
    - Functional: An adapter for shape (A) in plan 166 Task 1. Transport `jsonl-stream`. `configure` writes a settings file (hooks naming the relay command, the system prompt replace or append file) and an MCP config file (the `serveTools` endpoint, strict), and passes flags for built-in tool allow and deny, the model, and effort. Skills use a wrapped layout: `materializeSkills` output wrapped as a plugin directory with a manifest file. Sub-agents are written as a definitions file, and their activity is decoded as nested `subagent` scopes keyed by a parent tool id.
    - Functional: Gating is a relay command hook with input rewrite (`controls.rewrite: true`). The fail-closed response is a non-zero exit (`{ exitCode: 2, stdout: "" }`). A `stop` hook supports continue.
    - Functional: Resume is `store`: `archive` reads the transcript file the binary writes in the run directory; `restore` writes it back and passes a resume-file flag. Abort is SIGINT, then SIGTERM. Steer is `mid-turn`.
    - Functional: The adapter decodes every frame type of its dialect: init, assistant text and thinking blocks and deltas, tool use and result, retry with categories (rate limit, billing, auth) classified by `notices`, permission denied, result with usage and a session id. Anything else is unmapped.
    - Functional: `examples/adapters/stream-cli.dialect.ts` defines its scripted dialect with `defineScriptedDialect`, including `locate` (reading the settings and MCP config files). A recorded fixture `examples/adapters/fixtures/stream-cli.json` (hand-written in the recorded format) covers one full turn.
    - Functional: `adapterConformance(streamCli, { dialect, fixtures })` passes offline. That includes the planted-home isolation check, the non-zero-exit fail-closed form, and `store` resume in a new process.
    - Performance: n/a beyond the conformance runtime, which the note records.
    - Code Quality: Neutral identifiers and flag names (`--settings`, `--mcp-config`), with no vendor name (the extended scan covers `examples/adapters/`). The header comment points to the guide's worked mapping A. It imports only the four public specifiers plus Node built-ins.
    - Security: The descriptor declares an account mode limited to `local` with protected paths and env, and an api-key mode. `isolation: "flags"`, with the profile home relocated through `homeEnv`.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.4 (the first binary), §2.12.7 mapping and capture tables, §2.12.11 first column; plan 166 Task 1 notes (re-verified facts, shape A mapping)
    - Options Considered:
      - Reuse the neutral `jsonl-stream` dialect. Rejected: the reference must show a real-looking frame set, a settings-file configuration, and a decode table.
    - Chosen Approach:
      - A self-contained adapter plus dialect plus fixture, run by a shared conformance script (Task 6 creates it).
    - API Notes and Examples:
      ```ts
      export const streamCli = { name: "@example/prism-adapter-stream-cli", revision: "1", transport: "jsonl-stream", descriptor, binary, profile, configure, encode, decode, hooks, session, abort, notices } satisfies AgentAdapter;
      ```
    - Files to Create/Edit:
      - `examples/adapters/stream-cli.ts`, `stream-cli.dialect.ts`, `fixtures/stream-cli.json` (new)
      - `src/__tests__/driver-kit-vendor-neutral.test.ts`: also scans `examples/adapters/`.
      - `packages/drivers/process/src/__tests__/stream-cli.test.ts` (new): immediate conformance and adapter-specific proof.
      - `examples/README.md`: reference adapter entry.
    - References:
      - plan 166 Tasks 3–6
  - Test Cases to Write:
    - `stream_cli_passes_adapter_conformance` runs immediately in the process package; Task 6's `reference_adapters_pass_adapter_conformance` will also cover it through the shared runner.
    - `stream_cli_rewrite_reaches_binary` checks `updatedInput` in the binary record; `stream_cli_subagent_nesting` checks nested origin depth 1 and the parent tool id.
    - Focused tests cover replace/append prompt files, strict MCP config, tool/model/effort flags, wrapped skills, transcript restore/archive, stop continuation, status parsing, retry categories, unknown/raw frames, honest inherited-home discovery versus strict flags, and hosted refusal for the local-only account.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — an unpublished example.
    - Docs pages to create/edit:
      - `examples/README.md`: a line for `adapters/stream-cli.ts`.
      - Task 8's guide links it.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-12):
    - Added the unpublished, neutral `streamCli` adapter, its independently serialized scripted dialect, and a hand-authored recorded-format full-turn fixture. Configuration writes relay hook settings, replace/append prompt files, strict MCP endpoint config (with an env-name reference, never a bearer value), built-in tool/model/effort flags, sub-agent definitions, and a plugin containing a manifest and copies of the already materialized skill tree. Both auth modes relocate `STREAM_HOME`; the account mode permits only local deployment and declares protected credential paths/env. Offline fixtures explicitly select the key mode, so no installed binary or real login is required.
    - The wire table handles initialization, assistant text/thinking blocks and deltas, tools/results, retry and permission notices, sub-agent scopes keyed by parent tool id, additional activity notifications, and result usage/session IDs. Unknown frames remain unmapped. Raw notifications use a payload envelope so their own `type` cannot collide with the transport's end marker. Relay answers preserve `updatedInput`, deny with exit 2 when unavailable, and support stop continuation. Steer is mid-turn; the abort ladder is SIGINT then SIGTERM.
    - Store resume archives the binary-owned transcript in the private run directory. Restore writes the latest complete snapshot and returns `--resume-file`; the scripted binary appends to that restored transcript in the next process. The conformance resume leg proves two process starts with actual archived/restored entries. The dialect reads settings, prompt, MCP, plugin/skill, agent-definition and resume files and reports loaded paths. Exported `streamCliFixtures.home` names its actual `.stream-cli/` hook, skill and MCP layout; the focused discovery test proves inherited-home reporting and strict suppression rather than an always-empty `loaded` list. Task 6 can reuse `streamCliDialect` and `streamCliFixtures` in the shared runner.
    - Added immediate proof in `packages/drivers/process/src/__tests__/stream-cli.test.ts` rather than deferring all reference checks to Task 6. Computed, typed imports keep unpublished example sources out of the process package's declaration `rootDir`. Seven tests cover conformance, rewrite delivery to the binary record, nested origin depth/parent id, all requested configuration and transcript files, stop/status/notice/raw behavior, fake-home discovery, and local-account hosted refusal before spawn. Added the example README entry and extended the vendor-neutrality test to `examples/adapters/`.
    - **Validation:** final focused command `bun test --timeout=0 packages/drivers/process/src/__tests__/stream-cli.test.ts packages/drivers/process/src/__tests__/adapter-conformance.test.ts --test-name-pattern 'stream_cli|adapter_conformance_passes_json_rpc'`: **8 passed / 0 failed**, with 10 unrelated tests filtered (`/tmp/task4-focused-final.log`). Stream adapter conformance reports **19 passed / 2 expected skips**: `deployment` because the fixture key mode permits hosted use (the separate account test proves refusal), and `unknown_request_fails` because JSONL has no server RPC requests. This includes planted-home isolation, credential canary/no-secret, non-zero fail-closed relay, abort, raw capture, rate-limit handling and two-process store resume. Conformance took **5.66 s** in the broad run and **96.01 s** in the final focused run; the existing 180-second test timeout was sufficient. The documented canary limitation on filesystems without observable atime is unchanged.
    - **Broader evidence and limits:** the affected process-package/vendor-neutral suite recorded **112 passed / 1 failed** across 14 files (`/tmp/task4-suite-final.log`). The sole failure was the existing `adapter_conformance_passes_json_rpc` test's `unknown_request_fails` leg; it passed in the earlier broad run and in the final isolated command above. Its cause is not established; the broad run is not claimed green and no RPC production code or timing bound was changed. All seven stream adapter tests passed in that broad run. Final `bun run typecheck` passed, including core/family builds, workspace checks and examples (`/tmp/task4-typecheck-last.log`); direct process/example checks also passed. Focused Biome checks passed with no diagnostics, and the vendor-name scan of `packages/drivers/process/src examples/adapters` returned no hits.
    - No dependency, public export, compatibility baseline, or retired name changed; no release baseline regeneration or retirement sweep is required. No live binary was tested: this task deliberately ships an offline reference. The shared runner, guide, external-host proof, and whole-plan/release gates remain Tasks 6–10.

- [x] Task 5: Reference adapter `examples/adapters/rpc-server.ts` (JSON-RPC app-server)
  - Acceptance Criteria:
    - Functional: An adapter for shape (B). Transport `json-rpc`. `open` sends `initialize` and `initialized`, then a thread start (or a resume with the recorded thread id), each as a notification carrying the experimental capability and the `dynamicTools` from `OpenContext.tools`; `configure` writes the replaced or appended instructions, the model, and the approval policy into the config file it names with a flag, because `OpenContext` has no `spec` (amended 2026-10-12; finding F8 below). `encode` builds `turn/start`, `turn/steer` (`mid-turn`), and a continuation turn.
    - Functional: `requests` handles approval requests through `ask`, a user-input question through `host.ui`, and a client tool call through `bridge`. Any other method fails the run (the driver's rule).
    - Functional: Notifications decode to text and reasoning deltas, plan updates, file changes with diffs, compaction, token usage, and rate-limit notices. Anything else is unmapped. Status for the profile is a status command whose JSON `parseStatus` reads.
    - Functional: Resume is `vendor` (the thread id). Abort is an `rpc` interrupt, then closing stdin, then SIGTERM. `builtinTools: "partial"` and `subagents: false` are declared honestly.
    - Functional: `examples/adapters/rpc-server.dialect.ts` and `fixtures/rpc-server.json` are added. `adapterConformance` passes offline, including `unknown_request_fails` and abort within grace on `json-rpc`.
    - Performance: n/a beyond the conformance runtime.
    - Code Quality: Neutral method and identifier names, as in Task 4. Its header points to worked mapping B.
    - Security: An account mode limited to `local`, a hosted-capable token mode (an api-key kind) with a required acknowledgement, and a plain api-key mode, so the `hosted_acknowledgement` leg exercises a real declaration. (The token mode cannot be an account kind: the leg's admitted run needs no sign-in, and an account mode refuses a signed-out profile.)
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.4 (the second binary), §2.12.11 second column; plan 166 Task 1 notes (shape B mapping)
    - Options Considered:
      - Answer approvals with a fixed policy instead of `ask`. Rejected: the reference must show approvals routed through the host's gate.
    - Chosen Approach:
      - As Task 4, for the `json-rpc` shape.
    - API Notes and Examples:
      ```ts
      requests: { "item/approval": ({ params, ask }) => …, "user/input": ({ params, host }) => …, "item/tool/call": ({ params, bridge }) => … }
      ```
    - Files to Create/Edit:
      - `examples/adapters/rpc-server.ts`, `rpc-server.dialect.ts`, `fixtures/rpc-server.json` (new)
      - `packages/drivers/process/src/__tests__/rpc-server.test.ts` (new): the adapter-specific tests below.
    - References:
      - plan 166 Task 5
  - Test Cases to Write:
    - Covered by Task 6's `reference_adapters_pass_adapter_conformance` (rpc-server case). Adapter-specific: `rpc_server_question_routes_to_host_ui` and `rpc_server_client_tool_call_fires_tool_call`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — an unpublished example.
    - Docs pages to create/edit:
      - `examples/README.md`: a line for `adapters/rpc-server.ts`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-12):
    - Added the unpublished, neutral `rpcServer` adapter (`examples/adapters/rpc-server.ts`), its independently serialized scripted dialect (`rpc-server.dialect.ts`), and a hand-authored recorded-format fixture (`fixtures/rpc-server.json`). The wire is `json-rpc` over stdio: server notifications `item/agentMessage/delta`, `item/reasoning/delta`, `item/started` (`toolCall`), `item/toolCall/progress`, `item/completed` (`toolResult`/`agentMessage`/`skill`), `item/fileChange` (with `diff`), `turn/plan/updated`, `item/subagent`, `thread/compacted`, `notice`, `thread/tokenUsage/updated`, `item/raw`, and `turn/completed`; unknown methods stay unmapped for `capture: "all"`. `requests` answers `item/approval` through `ask`, `user/input` through `host.ui`, and `item/tool/call` through `bridge`; every other method fails the run with `vendor_request_unhandled`. Resume is `vendor`; the thread id is decoded from each notification's `threadId`. Abort is `turn/interrupt` (notification), then `closeStdin`, then SIGTERM. `builtinTools: "partial"`, `subagents: false`, `skills: false`, and `rewrite: false` are declared honestly.
    - **Finding F8 (contract gap, amend Task 5 text; candidate for Further Actions).** The task text said `open` carries the replaced/appended instructions, model, and approval policy. `OpenContext` is `{sessionId?, turnId?, resume, tools}` — it has no `spec`, no run directory, and no launch plan, so a stateless adapter cannot see those values in `open`. The reference adapter writes them into the config file named by `--config` in `configure` and `open` sends only the experimental capability and `dynamicTools`. A later contract change could add `spec` to `OpenContext`; Task 8's guide must state the split as shipped. This is a text amendment, not a production change.
    - **Auth modes.** The account mode is `local`-only. The hosted-capable token mode is an `api-key` kind with `hostedAcknowledgements`, and the third mode is a plain api-key. An account kind cannot satisfy the `hosted_acknowledgement` leg's admitted run: an account profile with no signed-in status fails `auth_required` (`src/driver-kit/profiles.ts:140-172`, `guard.ts:104`), and conformance creates profiles without a login. `fixtures.mode: "key"` keeps the conformance profile sign-in-free; the `deployment` leg is therefore skipped, as for `stream-cli`.
    - **Isolation and config discovery.** `locate` reads the run's `--config` and its instructions file, the `--mcp-config` file, and (only without `--no-user-config`) the user-level `.rpc-server/` config, skill, and MCP paths. `rpcServerFixtures.home` names that layout, so the planted-home check proves user-level files are not loaded under strict isolation. The dialect's `frames` includes `threadId`/`turnId` on every notification, which is how the `vendor` resume leg records and replays a thread id without a request round trip the scripted binary cannot answer.
    - **Validation.** `bunx tsc -p examples/tsconfig.json --noEmit` and `cd packages/drivers/process && bun run typecheck` passed. `bun test --timeout=0 packages/drivers/process/src/__tests__/rpc-server.test.ts packages/drivers/process/src/__tests__/stream-cli.test.ts`: **10 passed / 0 failed**. `bun test --timeout=0 .../adapter-conformance.test.ts .../json-rpc.test.ts .../rpc-server.test.ts`: **32 passed / 0 failed** (`/tmp/task5-rpc-tests.log`). `bun test --timeout=0 src/__tests__/driver-kit-vendor-neutral.test.ts`: **2 passed / 0 failed** (the scan now covers the new example and dialect).
    - **Conformance (run manually; Task 6 adds the shared runner).** `adapterConformance(rpcServer, { dialect: rpcServerDialect, fixtures: rpcServerFixtures })` returned 21 legs: **19 passed / 2 skipped** — `fail_closed_response` (the adapter uses `requests`, not relay hooks) and `deployment` (the `key` fixture mode permits hosted). That includes `unknown_request_fails`, `abort_within_grace`, `resume_strategy` (two processes, recorded thread id), `hosted_acknowledgement` (token mode refused without its acknowledgement, admitted with it), `strict_isolation`, `credential_canary`, `no_secret`, `fixture_replay`, `unmapped_to_raw`, and `limit_signal`. Final clean run: `/tmp/task5-rpc-conformance.json`, exit 0, **7.5 s** (an earlier clean run took 35.9 s under load). The canary reports the same no-atime caveat as Task 1 (the `plans/backlog.md:914` limitation still applies).
    - **Contention caveat.** Two of three manual conformance runs failed the `abort` leg with `abort took 6466/7958ms, over the 1000ms grace bound` and one with `the binary never started`, while a heavy unrelated Rust/cc1plus build held the host at ~70% CPU. The same startup/abort flakiness is recorded in the Task 1 and Task 4 notes; it is not caused by this adapter, and the clean run above passes every leg. Do not run this conformance concurrently with a workspace or native build; Task 10 must re-establish it in the target environment.
    - **Baseline and sweep.** No kernel, package source, export, or config changed; no compatibility baseline or export budget is affected and no name was retired, so no regeneration or retirement sweep is required. The examples are unpublished and outside the demo gate (`scripts/examples-execution.test.mjs` scans only `examples/*.ts`). Task 6 still owns `conformance.ts`, `reference-adapters.test.ts`, and the `scripts/e2e-coverage.json` entry.

- [x] Task 6: Reference adapter `examples/adapters/workspace-config.ts` (workspace-file-configured stream CLI) and the shared conformance runner
  - Acceptance Criteria:
    - Functional: An adapter for shape (C). Transport `jsonl-stream`. `configure` writes overlays into the bound worktree: an agent definition file (frontmatter tool list, body as the replaced prompt), a hooks file naming the relay, an always-on rule for an appended prompt, a skills directory, and an MCP config. Each is excluded through `.git/info/exclude`. A run under strict isolation without a bound worktree fails with `worktree_required`.
    - Functional: Gating is a relay command hook without rewrite (`controls.rewrite: false`). The fail-closed response is a printed deny with exit 0 (`{ exitCode: 0, stdout: "{\"decision\":\"deny\",\"reason\":\"prism relay unavailable\"}" }`). Steer is `next-turn`. Thinking capture is `tokens-only`, so usage carries thinking tokens and no thinking text is observed. Abort is closing stdin, then SIGTERM. Resume is `vendor` (a conversation id).
    - Functional: `examples/adapters/workspace-config.dialect.ts` has a `locate` that reads the overlay files from `cwd`, and the user-level equivalents from `HOME`. That is what the planted-home check catches when isolation is wrong.
    - Functional: `examples/adapters/conformance.ts` runs `adapterConformance` for all three reference adapters and prints one JSON summary per adapter (leg names and statuses). `packages/drivers/process/src/__tests__/reference-adapters.test.ts` spawns it and asserts every leg passed or was skipped with a reason that the test allows by name.
    - Performance: The note records the full runner's time. If it exceeds the package suite's timeout, the test gets its own timeout, and the reason is recorded.
    - Code Quality: As Task 4. Its header points to worked mapping C.
    - Security: An account mode limited to `local`, with no `hostedAcknowledgements` (hosted refused), plus an api-key mode that permits both deployments. The planted-home check proves user-level hooks are not loaded under strict isolation.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.4 (the third binary), §2.12.7 materialization, §2.12.11 third column; plan 165 Task 2 (worktree-aware exclude blocks); plan 166 Task 1 notes (shape C mapping, relocatable-home finding)
    - Options Considered:
      - Write overlays into the main checkout. Rejected: §2.12.7 requires a worktree under strict isolation.
    - Chosen Approach:
      - As Task 4, with a bound worktree from the `workspace` service in the conformance fixtures.
    - API Notes and Examples:
      ```bash
      bun examples/adapters/conformance.ts   # {"adapter":"stream-cli","legs":[...]} ×3
      ```
    - Files to Create/Edit:
      - `examples/adapters/workspace-config.ts`, `workspace-config.dialect.ts`, `fixtures/workspace-config.json`, `conformance.ts` (new)
      - `packages/drivers/process/src/__tests__/reference-adapters.test.ts` (new)
      - `examples/README.md`, `scripts/e2e-coverage.json` (`@arnilo/prism-driver-process` surfaces mapped to the runner and test)
    - References:
      - plan 165 Tasks 2 and 6 (`workspace` service)
  - Test Cases to Write:
    - `reference_adapters_pass_adapter_conformance`: one case per adapter.
    - `workspace_config_requires_worktree_under_strict`.
    - `workspace_config_fail_closed_is_printed_deny`.
    - `workspace_config_next_turn_steer`.
    - `workspace_config_thinking_tokens_only`: no `thinking` content is persisted, and usage carries the thinking-token count.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — unpublished examples and a test.
    - Docs pages to create/edit:
      - `examples/README.md`: lines for `adapters/workspace-config.ts` and `adapters/conformance.ts`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-12):
    - Added the unpublished, neutral `workspaceConfig` adapter (`examples/adapters/workspace-config.ts`), its independently serialized scripted dialect (`workspace-config.dialect.ts`), and a hand-authored recorded-format fixture (`fixtures/workspace-config.json`). Shape C is `jsonl-stream` with `isolation: "workspace-files"`: `configure` returns overlays written into the bound worktree (`.agents/agents/<name>.md` with the built-in `tools` frontmatter and the replaced prompt as the body, `.agents/rules/prism-append.md` and `.agents/rules/prism-deny.md`, one `.agents/agents/<sub>.md` with `subagent: true` per sub-agent, `.agents/hooks.json` naming the relay argv, `.agents/mcp.json`, a `.agents/skills/<name>/SKILL.md` per selected skill plus a skill manifest, and a `.agents/manifest.json` inventory), all excluded through `.git/info/exclude` by `RunDirectory.overlay`. A strict run without a bound worktree fails `worktree_required` from `assertIsolation`. Gating is a relay command hook with `controls.rewrite: false`; the fail-closed response is the printed deny `{ exitCode: 0, stdout: '{"decision":"deny","reason":"prism relay unavailable"}' }`, so the dialect's serialized `hook.allowed` reads `decision === "allow"` instead of the exit code. Steer is `next-turn`, thinking is `tokens-only`, abort is `closeStdin` then `SIGTERM`, and resume is `vendor` (`--conversation <id>`). The account mode is `local`-only with no acknowledgements (hosted refused); the `key` api-key mode permits both deployments, so `fixtures.mode: "key"` keeps the conformance profile sign-in-free and skips `deployment`.
    - Added `examples/adapters/conformance.ts`, which runs `adapterConformance` for all three reference adapters and prints one `{ adapter, legs }` JSON line each, and `packages/drivers/process/src/__tests__/reference-adapters.test.ts`, which spawns it (`bun examples/adapters/conformance.ts`, 300 s test timeout because the three runs take ~21 s) and asserts every leg passed or was skipped with a reason allowed by name per adapter. Adapter-specific tests cover the worktree requirement, the printed-deny fail-closed shape, `next-turn` steer delivery, `tokens-only` thinking, `locate` overlay reporting versus planted-home suppression, overlay materialization, and the local-account hosted refusal before spawn.
    - **Kernel harness amendment (Task 6, no new export).** `driverConformance`'s `steer` leg required a `steer` input to reach the binary. A `next-turn` adapter holds the steer and sends it as the next prompt, so the binary records a `user` input; the leg now also accepts a `user` input carrying the steer text when `descriptor.controls.steer === "next-turn"`. A `mid-turn` adapter's `steer` frame is still required. The change is confined to `src/testing/driver-conformance.ts`; no production code, export, or baseline changed. `CHANGELOG.md` records it beside the Task 3 adapter-conformance entry.
    - **Finding F9 (`tokens-only` has no home in `Usage`; candidate for Further Actions).** `Usage` (`src/contracts-core/content.ts:223`) has no `thinkingTokens` field, so the adapter reports the vendor's thinking-token count on its `usage` activity (a pass-through cast) and the run's `createUsageAccumulator` sums only the four token fields and `totalTokens`, dropping it. The reference adapter is honest at its own boundary; a later contract change could add `thinkingTokens` to `Usage` if the total must carry it. This is a note, not a production change.
    - **Overlay inventory.** `locate` receives only `readFile`, not `readdir`, so the adapter writes a `.agents/manifest.json` listing every overlay path it wrote and `locate` reports each listed path. The hooks file stores the relay argv as an array so `locate` can return `hookCommand` without shell-quoting; a real vendor hooks file takes a command string (Task 8's worked mapping C states the difference). This is the same self-declaration shape Task 4's plugin manifest uses.
    - **Validation.** `bunx tsc -p examples/tsconfig.json --noEmit` and `cd packages/drivers/process && bun run typecheck` passed. `bun examples/adapters/conformance.ts` exited 0 in **21.3 s**: `stream-cli` 19 passed / 2 skipped (`deployment`, `unknown_request_fails`), `rpc-server` 18 passed / 3 skipped (`deployment`, `fail_closed`, `fail_closed_response`), `workspace-config` 19 passed / 2 skipped (`deployment`, `unknown_request_fails`) — 21 legs each, including `abort_within_grace`, `resume_strategy`, `hosted_acknowledgement`, `strict_isolation`, `credential_canary`, `no_secret`, `fixture_replay`, `unmapped_to_raw`, `fail_closed_response` (printed deny), `limit_signal`, and `steer` through the held prompt. Output: `/tmp/task6-conformance.out`. `bun test --timeout=0 packages/drivers/process/src/__tests__/reference-adapters.test.ts`: **8 passed / 0 failed** (`reference_adapters_pass_adapter_conformance` 20.8 s). Affected kernel-testing/process/vendor-neutral suite: **45 passed / 0 failed**, 7 files. Biome passed on all five changed TypeScript files with no diagnostics.
    - **`scripts/e2e-coverage.json`.** Regenerated with `bun scripts/e2e-coverage-gate.mjs --generate` because the checked-in manifest was stale against the live `exports` maps (the in-progress migration deleted packages and added others). The `@arnilo/prism-driver-process` `.` surface lists `examples/adapters/conformance.ts` and the package tests, and `./testing` lists `adapter-conformance.test.ts`. The regeneration removed the unannotated-surface errors; `scripts/e2e-coverage.test.mjs` still fails on seven pre-existing stale suite annotations for test files the migration deleted and on its hardcoded `108`-surface expectation (`discoverSurfaces` reports `107`), none of which involve `@arnilo/prism-driver-process`. Task 10's whole-plan gate owns that drift.
    - **Baseline and sweep.** No package source, export, or config changed; no compatibility baseline, export budget, or retired name is affected, so no regeneration or retirement sweep is required. The examples remain unpublished and outside the demo gate (`scripts/examples-execution.test.mjs` scans only `examples/*.ts`). The guide, package README, external-host proof, custom-adapter example, and whole-plan/release gates remain Tasks 7–10.

- [x] Task 7: External-host proof — an adapter in a temporary workspace using only public imports
  - Acceptance Criteria:
    - Functional: `packages/drivers/process/src/__tests__/external-host.test.ts` creates a temp directory with a `package.json` and `node_modules/@arnilo/prism` and `node_modules/@arnilo/prism-driver-process` linked to the repo's kernel and package. It writes a small adapter and dialect there (a copy of the neutral test adapter, as a host would write it), runs `adapterConformance` on it with `bun`, and asserts exit 0 and every leg passing or allowed-skipped.
    - Functional: The test parses the written files' import specifiers and asserts the set is a subset of `@arnilo/prism`, `@arnilo/prism/driver-kit`, `@arnilo/prism/testing`, `@arnilo/prism-driver-process`, `@arnilo/prism-driver-process/testing`, and `node:*`. A relative import into the repo fails the test.
    - Functional: The kernel is resolved through its `package.json` `exports` (built `dist`), not `src/`, so a non-exported internal path would fail to resolve.
    - Performance: One conformance run. The test removes its temp directory.
    - Code Quality: No helper from the repo's tests is imported into the temp workspace.
    - Security: The temp workspace gets its own profile root, and no real home is touched.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 15 Done (the temporary-workspace criterion); `src/__tests__/external-agent-example.test.ts` (spawn pattern); the package `postinstall` link convention (`packages/integrations/delegate/package.json`)
    - Options Considered:
      - Check the import graph statically only. Rejected: the Done criterion requires the adapter to pass `adapterConformance` from outside.
      - `bun add` from a packed tarball. Rejected: slower, and it needs a registry-shaped pack. Symlinks to the built exports prove the same boundary.
    - Chosen Approach:
      - A temp workspace with linked packages, an import-specifier allow-list, and a real conformance run.
    - API Notes and Examples:
      ```ts
      const allowed = /^(@arnilo\/prism(\/(driver-kit|testing))?|@arnilo\/prism-driver-process(\/testing)?|node:.+)$/;
      ```
    - Files to Create/Edit:
      - `packages/drivers/process/src/__tests__/external-host.test.ts` (new)
      - `packages/drivers/process/src/__tests__/fixtures/external-host/` (adapter and dialect sources the test copies; new)
    - References:
      - plan 166 Task 1 (j)
  - Test Cases to Write:
    - `external_host_adapter_passes_with_public_imports_only`.
    - `external_host_rejects_internal_import`: a variant that imports `@arnilo/prism/dist/driver-kit/define.js` fails to resolve or fails the allow-list.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — a test.
    - Docs pages to create/edit: none — the guide (Task 8) links the test as the template for a host's CI.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-12):
    - Added `packages/drivers/process/src/__tests__/external-host.test.ts` plus the host's own sources under `fixtures/external-host/` (`dialect.ts`, `adapter.ts`, `run.ts`). The test builds a temp workspace with a `package.json`, symlinks `node_modules/@arnilo/prism` to the repo root and `node_modules/@arnilo/prism-driver-process` to the package, copies the fixture sources in verbatim, scans every copied file's import specifiers, and runs `bun run.ts` once. The fixture sources are also typechecked in-repo (the package `tsconfig` includes `src/**/*`), so the template and its copy are the same valid text; nothing imports a repo test helper.
    - **Import boundary.** The allow-list is `@arnilo/prism`, `@arnilo/prism/driver-kit`, `@arnilo/prism/testing`, `@arnilo/prism-driver-process`, `@arnilo/prism-driver-process/testing`, and `node:*`. Relative `./` imports are accepted only when the resolved file stays inside the workspace; a `../` escape is refused. `external_host_rejects_internal_import` appends `import "@arnilo/prism/dist/driver-kit/define.js"` to the copied adapter and proves it both fails the allow-list and fails `exports` resolution (`createRequire(<workspace>/package.json).resolve` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` on Node, `MODULE_NOT_FOUND` on Bun).
    - **Kernel resolves through `exports`, not `src`.** The same `createRequire` resolution asserts `@arnilo/prism` resolves to `<repo>/dist/index.js` and not a `src/` path, and the test asserts that file exists (the package test script builds the kernel first). This is the criterion the symlink proves: a non-exported internal path cannot resolve.
    - **The neutral host adapter.** Copied from the kernel suite's neutral adapter (`fixtures/test-adapter.ts` overlaid as in `adapter-conformance.test.ts`'s `adapter(false)`): command hooks with `failClosed { exitCode: 2 }`, `steer: mid-turn`, `permissionCallback: true`, one api-key mode permitting `local` and `hosted` with `hostedAcknowledgements: ["test-terms"]`, `protected.env: ["BLOCKED_TOKEN"]`, and `session.strategy: "none"`. Its expected skips are therefore `deployment` (the mode permits hosted), `resume` (the descriptor declares no resume), `fixture_replay` (no recorded fixture is supplied), and `unknown_request_fails` (not a JSON-RPC transport) — 17 passed / 4 skipped of 21 legs. The test asserts every leg is passed or in that skip set and that `abort_within_grace`, `credential_canary`, `no_secret`, `resume_strategy`, `hosted_acknowledgement`, `limit_signal`, `fail_closed_response`, `steer`, and `gating` all pass.
    - **Isolation.** The temp workspace gets its own profile root: the harness's `open` creates a fresh `mkdtemp` root per leg and points `profilesRoot` at it, so no real home or profile is read or written. The test removes the workspace in `finally`. No dependency is added and no production or kernel code changes.
    - **Validation.** `cd packages/drivers/process && bun run typecheck` passed. `bunx biome check` on the four new files is clean. `bun test --timeout=0 src/__tests__/external-host.test.ts`: **2 passed / 0 failed** (the conformance run and the internal-import refusal). `src/__tests__/driver-kit-vendor-neutral.test.ts`: **2 passed / 0 failed** (the new sources stay vendor-free). `scripts/e2e-coverage.test.mjs`: **6 passed / 2 failed**, the same pre-existing stale-annotation and `108`-vs-`107` failures recorded in Task 6, with no new failure; `scripts/e2e-coverage.json` now lists `external-host.test.ts` in the `@arnilo/prism-driver-process` `.` surface.
    - **Contention caveat.** The run is wall-clock sensitive: under load average > 100 the kernel `abort` leg failed with "the binary never started" (the unmodified neutral kernel test also took 85 s instead of ~5 s in the same window), and a rerun at load ~42 passed all 21 legs. This is the pre-existing abort-leg flake recorded in Tasks 5 and 6, not an adapter or boundary defect. The test's own timeout is 300 s; the conformance run is the single run the criterion budgets.

- [x] Task 8: The authoring guide — the package README and `docs/next/agent-adapters.md`, with dated worked mappings
  - Acceptance Criteria:
    - Functional: **(Amendment from plan 166 Task 1, 2026-10-11.)** The guide documents the amended contract: `EncodeContext`, json-rpc `OutboundFrame.onResult`, `permissionTool`, `hook.command`, the `{ runDir, home, cwd, sessionId }` archive context, and the graceful post-turn shutdown versus `abort`. Before any worked mapping cites them, the guide's author re-reads in a browser-capable session the rows plan 166 Task 1 marked unverifiable: `agy` hooks and install pages, the `agy` relocatable-home question, the three terms pages (exact quotes), Claude `cli-reference` (`--resume <path>`, `--session-id`, exit 143), and Codex auth (`CODEX_HOME`, `chatgptAuthTokens`). The mappings use Codex's `item/`-prefixed request names, state that `dynamicTools` is experimental and needs `capabilities.experimentalApi`, and mention Claude hooks' `onFailure: "block"` (v2.1.295+) next to the HTTP-hook warning.
    - Functional: `docs/next/agent-adapters.md` follows the API page structure and covers:
      - the contract, member by member
      - choosing a transport
      - mapping each `ExternalAgentSpec` field (prompt, tools, built-in tools, skills and layouts, sub-agents, model and effort, limits, isolation)
      - mapping each `ExternalActivity` kind, and when to mark a frame unmapped
      - writing the hook codec and choosing its fail-closed response (exit code versus printed deny) for the binary's hook semantics
      - `requests` handlers
      - resume strategies
      - the abort ladder
      - declaring the auth policy honestly (modes, deployments, acknowledgements, protected paths and env, login and status)
      - `extendAdapter`
      - recording fixtures and running `adapterConformance` in the host's CI, with the external-host test as the template
    - Functional: A "Worked mappings (non-normative)" section moves in the vendor research from roadmap §2.12.4, §2.12.5, §2.12.7's mapping and capture tables, and §2.12.11. It has one subsection per researched binary, mapped to reference adapters A, B, and C, and each fact carries the date plan 166 Task 1 verified it and its source link. A banner states that vendor binaries and terms change, that these mappings are not legal advice, and that the adapter's author is responsible for complying with the vendor's terms (§2.12.16).
    - Functional: `packages/drivers/process/README.md` is completed to the package page structure and links the guide, the reference adapters, and `docs/next/drivers.md`. `docs/next/drivers.md` gains a "Writing an adapter instead" pointer.
    - Functional: The roadmap's §2.12.4, §2.12.5 (vendor rows), §2.12.7 (vendor tables), and §2.12.11 each gain a one-line pointer to the guide's worked mappings and their verification date. The research text stays as the 2026-10-04 record.
    - Functional: `PRODUCT.md`'s "Vendor coding agents" row is corrected: the `@arnilo/prism-driver-{claude-code, codex, antigravity}` row becomes `@arnilo/prism-driver-process` (a generic driver that runs a host-written adapter for any coding-agent binary, with no vendor adapter shipped). A repo-wide grep for `prism-driver-claude-code`, `prism-driver-codex`, `prism-driver-antigravity`, and `prism-driver-{` over `src/ packages/ apps/ scripts/ examples/ docs/ PRODUCT.md README.md` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) returns no hits.
    - Functional: The vendor-name scan exempts only `docs/next/agent-adapters.md` and the package README's link text, and still covers `packages/drivers/process/src/` and `examples/adapters/`.
    - Performance: The guide states the per-run process spawn, the `capture: "all"` event cost, and the per-turn `store` archive write, each with the default that avoids it.
    - Code Quality: Each code sample in the guide compiles: the samples are extracted to `packages/drivers/process/src/__tests__/guide-samples.test.ts`, or each one is shown verbatim from a reference adapter.
    - Security: The guide's auth-policy section states rules 1–4 (enforced by the guard for every adapter) and that rules 5–6 are the adapter's declaration. Its fail-closed section warns never to gate through an HTTP hook whose failure is non-blocking.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (API page and package page structures)
      - roadmap §2.12.4, §2.12.5, §2.12.7, §2.12.11, §2.12.16; plan 166 Task 1 notes (verified facts)
      - `docs/next/drivers.md`; `PRODUCT.md`
    - Options Considered:
      - Delete the research from the roadmap. Rejected: the roadmap is the design record; a pointer avoids two normative copies while keeping the history.
      - Ship the worked mappings as code. Rejected: Prism ships no vendor adapter (§2.13).
    - Chosen Approach:
      - One guide page in `docs/next/` (kernel-train home) plus the package README, with the research moved in, dated, and fenced as non-normative.
    - API Notes and Examples:
      ```md
      > Worked mappings are non-normative research, verified on <date> against the linked sources. Vendor binaries and terms change. The adapter's author is responsible for complying with the vendor's terms.
      ```
    - Files to Create/Edit:
      - `docs/next/agent-adapters.md` (new), `docs/next/drivers.md`
      - `packages/drivers/process/README.md`
      - `roadmap.md` (pointer lines only), `PRODUCT.md`
      - `src/__tests__/driver-kit-vendor-neutral.test.ts` (scope and exemption)
      - `packages/drivers/process/src/__tests__/guide-samples.test.ts` (new, if the samples are extracted)
      - `CHANGELOG.md`
    - References:
      - plan 164 Task 8 (`docs/next/drivers.md`)
  - Test Cases to Write:
    - `guide_samples_typecheck`: when samples are extracted.
    - `no_stale_vendor_driver_package_names`: the repo-wide grep above, as a test in `driver-kit-vendor-neutral.test.ts`.
    - `docs_next_excluded_from_index`: the existing `docs.test.ts` exclusion keeps passing with the new page.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior. This task is the documentation for Part A and Part B.
    - Docs pages to create/edit:
      - `docs/next/agent-adapters.md` (new)
      - `docs/next/drivers.md`
      - `packages/drivers/process/README.md`
      - `PRODUCT.md`
      - `roadmap.md` (pointers)
      - `CHANGELOG.md`
    - `docs/index.md` update: no — `docs/next/` pages are not indexed during the train.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-12):
    - **Guide.** `docs/next/agent-adapters.md` (new) covers the contract member by member, the transport choice, the `ExternalAgentSpec` and `ExternalActivity` mappings, the hook codec and its fail-closed response, `requests` handlers, resume strategies, the abort ladder, the auth-policy rules 1–6, `extendAdapter`, and recording fixtures plus running `adapterConformance` in a host's CI. Every TypeScript sample is either a verbatim excerpt of a compiled source (`examples/adapters/*.ts`, `examples/adapters/conformance.ts`) or one of two synthesized samples extracted to `packages/drivers/process/src/__tests__/guide-samples.test.ts` (`guide_samples_typecheck`). `docs/next/drivers.md` gains a "Writing an adapter instead" pointer; the package README gains the canonical `Install`, `Configuration`, `What it changes`, `Capabilities`, `Cost, security, and failure behavior`, and `Example` headings plus a `Related` section linking the guide, `docs/next/drivers.md`, and the three reference adapters.
    - **Worked mappings.** The "Worked mappings (non-normative)" section carries roadmap §2.12.4, §2.12.5, §2.12.7, and §2.12.11 as one subsection per binary (Claude Code → shape A, Codex → shape B, Antigravity CLI → shape C), each fact dated 2026-10-11 and linked to its source, with the required banner (non-normative, vendor terms change, not legal advice, the adapter's author owns compliance). The roadmap sections keep the 2026-10-04 research and gain a one-line pointer to the guide and its verification dates.
    - **Re-verification (2026-10-12, browser fetch of each linked source).** Claude `cli-reference`: `--resume` takes an id, a name, or an absolute `.jsonl` path; `--session-id` takes a UUID; `--fork-session` unchanged. Claude `headless`: SIGTERM exits 143 (confirmed), `--bare` never reads OAuth/keychain (confirmed). Claude legal: the four quoted conditions confirmed verbatim. Codex app-server: `initialize` once per connection, `thread/resume`, `turn/steer`, `turn/completed`, the `item/`-prefixed request names, `dynamicTools` experimental + `capabilities.experimentalApi = true`, and the experimental `chatgptAuthTokens` all confirmed; the "local or open-source application" and "never been permitted for commercial or hosted services" sentences confirmed. Codex auth: `CODEX_HOME` and `CODEX_HOME/auth.json` confirmed. `agy` hooks: `PreToolUse` decisions including `deny_unless_prior_grant`, `Stop` `decision: "continue"`, `IsSkillFile`, and no documented input rewrite confirmed. `agy` install: keyring sign-in and the `GEMINI_API_KEY` + `modelProvider: "gemini"` setup confirmed. Google terms: the "products not provided by us" / OpenClaw OAuth sentence confirmed verbatim. The `agy` relocatable-home question stays unverifiable (no home variable documented). No re-verified fact broke a shape's mapping.
    - **PRODUCT.md and the stale-name grep.** The "Vendor coding agents" row now names `@arnilo/prism-driver-process` (a generic driver, no vendor adapter shipped). `src/__tests__/driver-kit-vendor-neutral.test.ts` gains `no_stale_vendor_driver_package_names`, which walks `src packages apps scripts examples docs PRODUCT.md README.md` (skipping `node_modules`, `.git`, `dist`, `plans`, `docs/history`, `docs/_evidence`) and asserts no `prism-driver-{claude-code,codex,antigravity,{` hit; the `driver_kit_names_no_vendor` scan documents that `docs/next/agent-adapters.md` and the package README are the only vendor-naming docs and keeps covering `packages/drivers/process/src/` and `examples/adapters/`.
    - **Validation.** `cd packages/drivers/process && bun run typecheck` passed; biome clean on the changed TypeScript. `bun test --timeout=0 src/__tests__/docs.test.ts`: **164 passed / 6 failed**, the same six pre-existing failures as plan 166 Task 1's baseline (the link failure is `docs/multi-agent-patterns.md` → `../examples/spawn-agent-tool.ts`), so the new page, README links, `PRODUCT.md`, and roadmap pointers add no failure. `driver-kit-vendor-neutral.test.ts`: **3 passed / 0 failed**. `guide-samples.test.ts`: **1 passed / 0 failed**. `scripts/e2e-coverage.test.mjs`: **6 passed / 2 failed**, the same pre-existing stale-annotation and `108`-vs-`107` drift, with `guide-samples.test.ts` added to the driver-process `.` surface.
    - **Baseline and sweep.** No package source, export, config, or production code changed; no compatibility baseline, export budget, or retired name is affected. `CHANGELOG.md` records the guide. The custom-adapter example and the whole-plan/release gates remain Tasks 9–10.

- [x] Task 9: `examples/custom-adapter.ts`
  - Acceptance Criteria:
    - Functional: Offline. A host extends `examples/adapters/rpc-server.ts` with `extendAdapter`: an extra flag, a decoder for a frame the base sends to `agent.raw` (it becomes `agent.file`), and a narrowed policy (api-key mode only). It defines a custom agent with `processDriver(extended)({ name, profile, systemPrompt: { replace }, prismTools: ["edit"], skills: ["review-notes"] })` alongside `@arnilo/prism-tools-coding` and `@arnilo/prism-approval` (`mode: "ask"`).
    - Functional: The run binds a `workspace` worktree to the session. The scripted binary (the rpc-server dialect) edits a file through the bridged `edit` tool under approval, with one call allowed and one declined through a scripted `HostUi`. The example prints JSON with the captured activity (event names with `origin`), the decisions, the worktree diff with the overlay excluded, `agent.inspect().statusNotes` naming the base and the extension, and the materialized skill.
    - Functional: The example is added to the demo gate list in `src/__tests__/docs.test.ts` (`examples_demos_run_to_completion_and_emit_no_secret`) with structural assertions on its output, to `examples/README.md`, and to `scripts/e2e-coverage.json`.
    - Performance: The note records its runtime. Plan 165's raised demo-gate timeout (60 s) is checked first. If the three driver demos exceed it, the example gets its own test with its own timeout instead of raising the shared one again (plan 165 Further Actions P1).
    - Code Quality: It imports only `@arnilo/prism`, `/driver-kit`, `/testing`, `@arnilo/prism-driver-process`, `@arnilo/prism-tools-coding`, `@arnilo/prism-approval`, the reference adapter, and Node built-ins. No vendor name.
    - Security: No real secret. The secret-shape check in the demo gate passes. The bearer token never appears in the output.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 15 Scope (Example); `examples/serve-tools.ts` (worktree, approval, scripted `HostUi` pattern); `src/__tests__/docs.test.ts:3530-3745` (demo gate)
    - Options Considered:
      - Extend `stream-cli` instead. Rejected: the roadmap names `rpc-server`.
    - Chosen Approach:
      - Compose the Part A and Part B pieces exactly as a host would, and print evidence the gate asserts.
    - API Notes and Examples:
      ```bash
      bun run build:core && bun examples/custom-adapter.ts
      ```
    - Files to Create/Edit:
      - `examples/custom-adapter.ts` (new)
      - `src/__tests__/docs.test.ts` (demo list and assertions)
      - `examples/README.md`, `scripts/e2e-coverage.json`
      - `CHANGELOG.md`
    - References:
      - plan 165 Task 8 (`serve-tools.ts`)
  - Test Cases to Write:
    - The demo-gate assertions: the extension decoder produced `agent.file`; one `edit` was allowed and one declined; the diff excludes the overlay; the status notes name both adapters; no token is in the output.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — an example.
    - Docs pages to create/edit:
      - `examples/README.md`
      - `packages/drivers/process/README.md` "Example" links it.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-12):
    - **What shipped.** `examples/custom-adapter.ts` (new) derives `custom-adapter` (revision `2`) from `examples/adapters/rpc-server.ts` (revision `1`) with `extendAdapter`: `configure` wraps the base plan with `--custom-flag` and one `.rpc-server/extended.json` overlay; `decode` wraps the base and turns the base's `item/raw`/`custom-file` frame into an `agent.file` activity; `descriptor.auth.modes` filters the base's modes to the two `api-key` kinds (dropping the account mode), which passes `assertNarrowerPolicy`. The derived adapter runs through `processDriver(extended)({...})` with `@arnilo/prism-tools-coding` (its `workspace` service and per-session worktree routing) and `@arnilo/prism-approval` in `ask` mode, on a scripted `rpc-server` dialect binary with `prismTools: ["edit"]` and `skills: ["review-notes"]`.
    - **Approach changes from the task text.** (1) The bridged `edit` reaches the vendor through the process driver's own `serveTools` loopback-HTTP MCP endpoint (the driver serves `spec.prismTools` and passes `ctx.endpoint` to `configure`, which the base writes as `--mcp-config`), so the vendor script uses `{ mcp: ... }` steps rather than a `json-rpc` `item/tool/call` request — the scripted binary cannot emit arbitrary server requests, and this is the same path `examples/serve-tools.ts` exercises. (2) The custom frame is emitted as an ordinary raw activity step and the extension's decoder intercepts the wire notification, which is exactly "a frame the base sends to `agent.raw`". (3) The overlay is written by the driver through `RunDirectory.overlay`, which removes it and its exclude line when the run's run directory is disposed, so the demo samples `existsSync(worktree/OVERLAY)` from the event pump while the vendor runs and reports `{ presentDuringRun: true, excluded: true }` instead of checking after `session.run` returns. (4) The extended adapter is named `custom-adapter` (not `@example/prism-adapter-rpc-server-custom`) and the temp/profile roots are shortened, because the profile home plus run id plus relay socket must stay under the 103-byte Unix `sun_path` (`broker_unavailable` was the first failure).
    - **Files.** Created `examples/custom-adapter.ts`. Edited `src/__tests__/docs.test.ts` (demo list + structural assertions), `examples/README.md` (demo bullet + adapters list), `packages/drivers/process/README.md` (`Related` link), `scripts/e2e-coverage.json` (`@arnilo/prism-driver-process` `.` surface, after `examples/adapters/conformance.ts`), and `CHANGELOG.md`.
    - **Demo-gate assertions.** `status === "completed"`; `adapter === { name: "custom-adapter", revision: "2", base: "@example/prism-adapter-rpc-server", baseRevision: "1" }`; `extraFlag === true`; activity names `["agent.file", "message.delta", "tool.completed", "tool.started"]` all with `kind: "external", depth: 0`; the first `edit` result is not an error and says `Successfully replaced`, the second is `isError` with `denied`; host prompts `{ confirm: 2, select: 1 }`; `worktreeFile === "edited"`; `diff === { changes: ["modified a.txt"], truncated: false }`; `overlay === { path: ".rpc-server/extended.json", presentDuringRun: true, excluded: true }`; `materializedSkills === ["review-notes"]`.
    - **Performance.** Standalone `bun examples/custom-adapter.ts` runs in ~0.5 s; the whole `examples_demos_run_to_completion_and_emit_no_secret` loop ran in 16.2 s, inside plan 165's existing 60 s timeout, so the example needs no test of its own and the shared timeout is untouched (plan 165 Further Actions P1 satisfied).
    - **Validation.** `bunx tsc -p examples --noEmit` passed; `biome check` clean on both changed TypeScript files (the 3 warnings are pre-existing `docs.test.ts` unused-variable suggestions). `bun test --timeout=0 src/__tests__/docs.test.ts`: **164 passed / 6 failed**, the same six pre-existing failures as the Task 8 baseline (link, install/coverage/SQL docs, provider primitives, open-connector sidecar, runtime validator seam, context/skills selection), with the demo gate itself passing. `driver-kit-vendor-neutral.test.ts`: **3 passed / 0 failed**. `scripts/e2e-coverage.test.mjs`: **6 passed / 2 failed**, the same pre-existing stale-annotation and `108`-vs-`107` drift.
    - **Baseline and sweep.** No package source, export, config, or production code changed; no compatibility baseline or export budget is affected. The example is neutral (no vendor name) and passes the vendor-name scans. `CHANGELOG.md` records it. The Phase 15 Done record and whole-plan/release gates remain Task 10.

- [x] Task 10: Phase 15 Done record
  - Acceptance Criteria:
    - Functional: The note records evidence (test name, command, or output excerpt) for each roadmap Phase 15 Done criterion:
      - The three reference adapters pass `adapterConformance` offline (Task 6).
      - The external-host adapter passes with only public imports (Task 7).
      - `extendAdapter` replaces a decoder and narrows a policy, and `inspect()` shows both (plan 166 Task 7; Task 9).
      - The policy guard holds against adapter-declared policies: `local`-only account on `hosted` fails with `plan_login_not_permitted`; a hosted mode without its acknowledgement fails; a second principal fails; a run over `maxConcurrentRuns` waits or fails with `profile_busy`; the canary file is never opened (with the atime caveat if it still applies).
      - Strict isolation: a planted home hook, skill, and MCP server are not loaded (Task 2 leg on each reference adapter).
      - Fail closed when the broker is killed, for both a non-zero exit (stream-cli) and a printed deny (workspace-config).
      - Abort within grace on both transports.
      - `store` resume in a new process (stream-cli).
      - Unmapped frames reach `agent.raw` under `capture: "all"`.
      - No vendor or binary name in `packages/drivers/process/src/`.
    - Functional: `plans/README.md` rows for plans 166 and 167 are set to `complete (<date>)`. Compromises Made and Further Actions are filled in both plans and handed off to `plans/backlog.md` (SKILL.md, "Plan end"). Backlog items this phase closed (plan 165 P3 "`bridge.ts`'s doc comment names a seam that does not exist", plan 164 "`DriverRunContext.tools`" deviation) are marked resolved in place, naming the task.
    - Performance: n/a.
    - Code Quality: Every criterion cites a passing test or command. A criterion that cannot be met is recorded as a compromise with its reason, not marked done.
    - Security: The `no_secret` and canary evidence are cited per adapter.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 15 Done; plans 166 and 167 notes
    - Options Considered:
      - n/a.
    - Chosen Approach:
      - Run the whole-plan verification and map each Done line to its evidence.
    - API Notes and Examples:
      ```bash
      bun examples/adapters/conformance.ts
      ```
    - Files to Create/Edit:
      - `plans/166-…md`, `plans/167-…md` (notes, Compromises Made, Further Actions)
      - `plans/README.md`, `plans/backlog.md`
    - References:
      - plan 164 Task 8 (Done-record pattern)
  - Test Cases to Write:
    - n/a — evidence only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none beyond the plan files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-12):
    - **Whole-plan verification (2026-10-12).** `bun run build:core` exit 0. `bun run typecheck` exit 0 (build:core + every workspace typecheck + `tsc -p examples --noEmit`). `bun test --timeout=0 src/testing src/driver-kit src/__tests__/driver-kit-vendor-neutral.test.ts`: **90 passed / 0 failed** (11 files). `cd packages/drivers/process && bun run typecheck && bun run test`: typecheck exit 0; **125 passed / 0 failed** (17 files). `bun examples/adapters/conformance.ts` exit 0 with three JSON summaries (two consecutive clean runs). `bun examples/custom-adapter.ts` exit 0 with the expected JSON. `bun test --timeout=0 src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`: **426 passed / 1 failed** (the pre-existing `npm ls --all --depth=0` workspace-tree guard). `bun test --timeout=0 src/__tests__/docs.test.ts`: **164 passed / 6 failed** (the same six pre-existing docs failures as the Task 8 baseline; the `examples_demos_run_to_completion_and_emit_no_secret` gate passes inside it in 14.5 s, including `examples/custom-adapter.ts`). `rg -n -i '\b(claude|codex|agy|antigravity|gemini)\b' packages/drivers/process/src examples/adapters`: no hits (exit 1). `bun scripts/release.mjs gate`: blocked only by `PRISM_TEST_POSTGRES_URL not set at release-evidence time`, the pre-existing blocker recorded in plan 166 Further Actions P2; no new failure.
    - **Roadmap Phase 15 Done criteria → evidence.**
      - *The three reference adapters pass `adapterConformance` offline.* `bun examples/adapters/conformance.ts` exit 0: `stream-cli` 19 passed / 2 skipped (`deployment`, `unknown_request_fails`), `rpc-server` 18 passed / 3 skipped (`deployment`, `fail_closed`, `fail_closed_response`), `workspace-config` 19 passed / 2 skipped (`deployment`, `unknown_request_fails`). Pinned by `reference_adapters_pass_adapter_conformance` (`packages/drivers/process/src/__tests__/reference-adapters.test.ts`), which spawns the runner and asserts 21 legs per adapter with the per-adapter allowed-skip sets.
      - *An adapter in a temporary workspace passes `adapterConformance` importing only the public specifiers.* `external_host_adapter_passes_with_public_imports_only` and `external_host_rejects_internal_import` (`external-host.test.ts`, 2 passed): a temp workspace symlinks the built kernel and the process package, copies the fixture sources, scans every import specifier against the allow-list (`@arnilo/prism`, `@arnilo/prism/driver-kit`, `@arnilo/prism/testing`, `@arnilo/prism-driver-process`, `@arnilo/prism-driver-process/testing`, `node:*`), resolves `@arnilo/prism` to `dist/index.js`, and rejects `@arnilo/prism/dist/driver-kit/define.js`.
      - *`extendAdapter` replaces a decoder and narrows a policy, and `inspect()` shows both.* `examples/custom-adapter.ts` prints `adapter: { name: "custom-adapter", revision: "2", base: "@example/prism-adapter-rpc-server", baseRevision: "1" }`, an `agent.file` activity from the replaced decoder, and a policy narrowed to the base's api-key modes; pinned by the demo gate's structural assertions and by `extend_replaces_decoder_for_raw_frames`, `extend_narrows_policy_and_hosted_fails`, and `extend_wraps_configure_adds_flag_and_inspect_names_chain` (`extend.test.ts`).
      - *The policy guard holds against adapter-declared policies.* The `deployment` leg (a local-only account on `hosted` refuses with `plan_login_not_permitted`) and the `profile_principal` / `profile_concurrency` legs pass for every reference adapter; `workspace_config_local_account_refuses_hosted_before_spawn` pins the deployment refusal for the workspace adapter; `account_mode_hosted_not_permitted`, `hosted_requires_acknowledgements`, `profile_principal_mismatch`, `profile_busy_over_cap`, and `auth_required_names_login` (`src/driver-kit/__tests__/auth.test.ts`) cover each rule at the guard. The `credential_canary` leg passes with the atime caveat (`credential_canary_never_opened`); on this `noatime` filesystem a silent read would pass, and mode `0000` catches only a non-root read as `EACCES`.
      - *Strict isolation: a planted home hook, skill, and MCP server are not loaded.* The `strict_isolation` leg passes for all three adapters; `rpc_server_locate_reports_inherited_home_and_hides_it_under_strict_flags` and `workspace_config_locate_reports_overlay_and_hides_home` pin it directly.
      - *Fail closed when the broker is killed, for a non-zero exit and for a printed deny.* `fail_closed` passes for `stream-cli` (non-zero exit) and `workspace-config` (printed deny); `fail_closed_response` passes for both; `workspace_config_fail_closed_is_printed_deny` and `printed_deny_and_scriptFor_pass` pin the printed-deny shape.
      - *Abort stops the scripted binary within the grace timeout on both transports.* The `abort` and `abort_within_grace` legs pass for `stream-cli` (jsonl-stream) and `rpc-server` (json-rpc).
      - *`store` resume in a new process.* The `resume` and `resume_strategy` legs pass for `stream-cli` (`session.strategy: "store"`); `rpc-server` and `workspace-config` pass with `vendor`.
      - *Unmapped frames reach `agent.raw` under `capture: "all"`.* The `unmapped_to_raw` leg passes for all three; `fixture_replay_observes_mapped_unmapped_and_invalid_lines` covers the replay path.
      - *No secret in events, the binary record, or the profile record.* The `no_secret` leg passes for `stream-cli`, `rpc-server`, and `workspace-config`; each adapter's auth modes protect paths and env (`RPC_HOME`/`RPC_ACCOUNT_TOKEN`, `RPC_TOKEN`, `RPC_API_KEY`, `WORKSPACE_CONFIG_TOKEN`, `WORKSPACE_CONFIG_API_KEY`) and the driver's redactor covers the broker token and every served env value.
      - *No vendor or binary name in `packages/drivers/process/src/`.* `rg` returns no hits; `driver_kit_names_no_vendor` (in `driver-kit-vendor-neutral.test.ts`, 3 passed) enforces it, and `no_stale_vendor_driver_package_names` keeps retired `prism-driver-<vendor>` names out of the tree.
    - **Flake observed.** One `bun examples/adapters/conformance.ts` run failed the `rpc-server` `unknown_request_fails` leg with `unknown server request did not fail closed`; two immediate reruns passed all 21 legs. Same class as the Task 5/6/7 contention flakes (the machine was loaded by unrelated linker/compiler processes). Recorded as Further Actions P3, not as a Done compromise, because the criterion passes on a clean run. The same contention also timed out the docs demo gate at load ~33 (`tsc -p examples` alone took 33 s wall) and passed in 14.5 s once load fell to ~6; that timeout is the demo gate's 60 s cap under load, not a demo defect.
    - **Plan-end bookkeeping.** `plans/README.md` rows for plans 166 and 167 are set to `complete (2026-10-12)`. Plan 166's `Compromises Made` and `Further Actions` carry `Recorded in plans/backlog.md.`; its P2 whole-plan-verification blocker is carried into `plans/backlog.md`, and its Part B handoff is marked closed by plan 167. Plan 164 Task 6 deviation 1 (`bridgeTools` takes `tools`) and plan 165 Further Actions P3 (`bridge.ts`'s doc comment names a seam that does not exist) are marked resolved in place by plan 166 Task 2. Plan 167's own `Compromises Made` and `Further Actions` are recorded in `plans/backlog.md`.
    - **Baseline/sweep.** No production code changed in this task, and none after Task 6's kernel steer-leg amendment; no compat baseline or export budget moved. The only kernel change in the whole plan is the `src/testing/driver-conformance.ts` steer leg (Task 6) plus its CHANGELOG bullet. The vendor-name scans, `docs.test.ts`, `packaging.test.ts`, `public-export-contract.test.ts`, and the release gate all sit at the plan-166 Task 1 baseline.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/testing src/driver-kit src/__tests__/driver-kit-vendor-neutral.test.ts`
- `cd packages/drivers/process && bun run typecheck && bun run test`
- `bun examples/adapters/conformance.ts`
- `bun examples/custom-adapter.ts`
- `bun test --timeout=0 src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `rg -n -i '\b(claude|codex|agy|antigravity|gemini)\b' packages/drivers/process/src examples/adapters` (no hits)
- `bun scripts/release.mjs gate` (no new failure beyond Task 1's baseline)

## Compromises Made

- **The `rpc-server` account-kind auth mode is declared but not exercised by `adapterConformance`.** The account status command cannot run under the harness (`createProfiles` receives no binary, so `{binary}` never resolves), so the conformance fixtures use the api-key mode and the account refusal is pinned only at the guard. Follow-up: "Exercise the `rpc-server` account mode in conformance, or drop it".
- **`capture.thinking: "tokens-only"` cannot persist thinking tokens (Finding F9).** `Usage` has no `thinkingTokens` field, so the tokens `workspace-config.ts` reports on the usage activity are dropped by the run's usage accumulator. Follow-up: "Carry thinking tokens into `Usage`".
- **`OpenContext` carries no agent spec (Finding F8).** `rpc-server.ts` writes instructions, model, and approval policy into the `--config` file from `configure` because `open` cannot see the spec. Follow-up: "Give `OpenContext` the spec".
- **The `credential_canary` leg detects reads by atime, and this filesystem records none.** A silent read would pass; mode `0000` catches only a non-root read as `EACCES`. Carried from plan 164. Follow-up: "Give the canary an atime-independent check".
- **The `unknown_request_fails` conformance leg flaked once under machine load.** It failed on the `rpc-server` adapter and passed on two immediate reruns; the sensitivity is in the harness leg, not the adapter. Follow-up: "De-flake the `unknown_request_fails` conformance leg".

Recorded in plans/backlog.md.

## Further Actions

- **P2 — Restore the whole-plan verification baseline.** The six `docs.test.ts` failures, the `packaging.test.ts` `npm ls` tree failure, the `src/contracts.ts mentions workflow` boundary failure, and the missing `PRISM_TEST_POSTGRES_URL` release evidence are pre-existing and block a clean release gate. What: resolve them and rerun the whole-plan checks. Why: the release gate cannot pass while they stand. (Plan 166's P2, carried forward.)
- **P3 — Exercise the `rpc-server` account mode in conformance, or drop it.** The account status command cannot run under `adapterConformance` because `createProfiles` receives no binary; either give the harness a status-command path or record the mode as guard-only. Why: a declared mode no test exercises can drift.
- **P3 — Carry thinking tokens into `Usage` (Finding F9).** `Usage` has no `thinkingTokens` field, so a `tokens-only` capture adapter cannot persist what it reports. Add the field and sum it, or record the loss. Why: `workspace-config` declares a capture it silently drops.
- **P3 — Give `OpenContext` the spec (Finding F8).** An adapter cannot see `ExternalAgentSpec` in `open`, so it must smuggle instructions, model, and approval policy through `configure`'s config file. Why: a transport whose handshake needs the spec (for example `thread/start` params) cannot express it today.
- **P3 — De-flake the `unknown_request_fails` conformance leg.** It failed once under load and passed twice; remove the timing sensitivity or bound it like the abort leg. Why: a flaky leg makes a green conformance run untrustworthy.
- **P3 — Give the canary an atime-independent check.** Carried from plan 164 and already recorded in `plans/backlog.md` ("Canary cannot see silent reads on atime-less filesystems"); repeated here because Phase 15's Done criterion cites it. Why: on a `noatime` filesystem the protected-path read guarantee is weaker than stated.

Recorded in plans/backlog.md.
