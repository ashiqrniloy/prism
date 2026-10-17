# Phase 13 Part B — Driver kit, `prism relay`, and driver conformance

## Objectives

- Check that Part A left the K1–K6 contracts the driver kit builds on, and re-measure what Part B adds.
- Add the vendor-neutral `@arnilo/prism/driver-kit` subpath: `ExternalAgentSpec`, `DriverDescriptor`, `defineDriver`, `driverPackage`, and the `requires` check.
- Ship the process and protocol helpers, the normalization helpers, and the standard `agent.*` event helpers.
- Make auth policy data on the descriptor, and add profiles and the policy guard that enforces §2.12.5 rules 1–4 plus the declared policy.
- Add the configuration materializer, with `materializeSkills` and its neutral `skill-dirs` layout.
- Add the per-run callback broker, `bridgeTools`, and the `prism relay` bin, which fails closed without knowing the vendor.
- Add `createScriptedCli` with the `jsonl-stream` and `json-rpc` reference dialects, `defineScriptedDialect`, and `driverConformance` with the credential canary to `/testing`.
- Ship `examples/external-agent.ts` and record the Phase 13 Done criteria.

## Expected Outcome

- `import { defineDriver, driverPackage, effectsTable, bridgeTools, materializeSkills, createCallbackBroker, createProfiles, … } from "@arnilo/prism/driver-kit"` works. The subpath has no runtime dependency, imports only Node built-ins and the kernel, and is not loaded by the root entry.
- A driver package built with `driverPackage(defineDriver({ name, vendor, revision, descriptor, config, start }))` claims `slot:loop`, sets `usesModel: false` and `runModel` from the descriptor, validates its config (which extends `ExternalAgentSpec`, with `vendor` options validated by the driver's own schema), and probes its binary at `setup`. A missing binary is a status note, and a run on it fails with `driver_unavailable`. The probed version joins the loop `revision`, and a major-version mismatch on resume fails with `driver_revision_mismatch`. `requires` misses fail `createAgent` with `driver_capability_missing`, naming the control.
- Profiles (`create`, `ensure`, `login` through a K6 `terminal` request, `status`, `bind`, `remove`) live under a host-chosen root (default `~/.prism/profiles/<driver>/<name>/`). The policy guard fails closed with `credential_required`, `plan_login_not_permitted`, `profile_principal_mismatch`, `auth_required`, or `profile_busy`. It never opens a protected credential path or accepts a protected variable as a credential ref. `inspect()` shows the probed binary path and version, the auth method last reported, the deployment, acknowledgements, and `maxConcurrentRuns`, with no secret.
- The materializer writes a per-run directory, files, and worktree overlays with `.git/info/exclude` entries, and removes all of them on dispose. A `workspace-files` driver under strict isolation with no worktree fails with `worktree_required`.
- The broker listens on loopback HTTP (per-run bearer token) and a per-run Unix socket, writes the relay descriptor before the process starts, routes hook events to `run.ask`/`run.end`/`run.observe`, accepts an MCP route for Phase 14's `serveTools`, and closes on run end. `prism relay hook --run <dir>` prints the broker's codec-encoded answer, or the descriptor's fail-closed response when the broker is down or slow. `prism relay mcp --run <dir>` bridges stdio MCP to the broker.
- `createScriptedCli({ dialect: "jsonl-stream" | "json-rpc" | defineScriptedDialect(…), script })` is a fake binary that `driverConformance(driver, { dialect, fixtures })` drives through every §2.12.10 case, including the canary file at each declared protected credential path.
- `bun examples/external-agent.ts` runs offline under the examples execution gate and shows every behavior Phase 13 Scope lists. The Phase 13 Done criteria are recorded in Task 8's note.

This plan implements roadmap **Phase 13 — External-agent kernel primitives and driver kit**, Part B. It **depends on plan 163** (Part A), whose Task 1 is the review for both parts. This plan opens with an entry check instead of a second review. If the entry check finds a kernel contract missing, it stops, and the addition goes back to plan 163 as an amendment. The driver kit is a **kernel subpath** (§2.12.8, following `provider-kit`), not a native package, so no new workspace, `package-truth.mjs` count, or `independent-packages.json` decision is needed; the subpath's enforcement rows are the `package.json` export, the export-contract and packaging tests, `scripts/e2e-coverage.json`, and the `arnilo__prism` baseline. Prism ships no vendor adapter: every driver in this plan is inline test or example code against the scripted CLI, and a repo test forbids vendor and binary names in `src/driver-kit/`, `src/testing/`, and the relay. This plan does not bump versions, publish, deprecate on npm, or edit released `/docs`.

## Tasks

- [x] Task 1: Part B entry check — K1–K6 as shipped (read-only)
  - Acceptance Criteria:
    - Functional: Confirm from source and plan 163's Task 8 note that each K1–K6 contract shipped as plan 163 Task 1 decided: `LoopStrategy.usesModel`/`runModel`, `RunController.model`, `observe`/`ask`/`steers`/`end` result, narrowed `emit`, re-entrant `executeTools` with `origin`, `EventOrigin`, `SessionOptions.parent` and `createSessionIndex`, `run.state(key)`, and the `terminal` request. Cite `file:line` for each.
    - Functional: Confirm plan 163 Task 1 (j): the Node built-ins the kit needs, the dynamic-import dispatch for `prism relay` in `src/cli.ts`, and the `ask` per-call support flags (`rewrite`, `respond`) that the descriptor's `controls.rewrite` feeds.
    - Functional: Decide, with evidence:
      - (a) **Auth policy shape.** §2.12.10's `auth: { subscription, apiKey }` is the 2026-10-04 shape; Phase 13 Scope replaces it with a list of modes. Recommended: `auth: { modes: readonly AuthMode[] }`, where `AuthMode = { name; kind: "account" | "api-key"; deployments: readonly ("local" | "hosted")[]; hostedAcknowledgements?: readonly string[]; protected: { paths: readonly string[]; env: readonly string[] }; login?: readonly string[]; status?: readonly string[]; homeEnv?: string }`. Paths are relative to the profile home or `~`-anchored. The Phase 13 Scope is authoritative over §2.12.10 (the roadmap's re-scope note says so).
      - (b) **Status command parsing.** The status command is vendor-specific output. Recommended: the driver supplies `parseStatus(result: { exitCode; stdout }) => { signedIn: boolean; method?: string }`; the kit runs the command and never stores stdout. Confirm the guard redacts stdout before any error message.
      - (c) **Broker MCP route.** Phase 14 owns `serveTools`. Recommended: the broker exposes `broker.route("mcp", handler)` taking a `(request: Request) => Promise<Response>` web handler, so Phase 14 plugs `createPrismMcpWebHandler` in without the kit importing `prism-mcp-server`. Phase 13 tests it with a stub handler.
      - (d) **Hook codec contract.** Recommended: `hookCodec: { decode(stdin: string): HookEvent; encode(answer: HookAnswer): { exitCode: number; stdout: string } }`, where `HookEvent` is `{ kind: "pre-tool"; request: ExternalToolRequest } | { kind: "stop"; reason?: string } | { kind: "observe"; activity: ExternalActivity }`. The broker runs `decode` → primitive → `encode` and sends the encoded answer to the relay, which prints it verbatim.
      - (e) **Rate-limit signals.** Recommended: the driver maps vendor signals to `observe({ kind: "notice", code: "rate_limit" | "quota" | "billing" | "auth", … })`; the guard treats those codes as stop-or-defer (`deferUntil?` on the notice) and never retries.
      - (f) **Repo vendor-name test scope.** Confirm the forbidden list (`claude`, `codex`, `agy`, `antigravity`, `gemini`, case-insensitive, word-bounded) and the scanned paths (`src/driver-kit/`, `src/testing/`, `src/relay*`/`src/cli-relay.ts`), and that no current `src/testing/` file trips it.
    - Functional: Record the failing-test baseline and compare it with plan 163's close.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every decision cites its source span.
    - Security: Confirm the protected-path canary can be enforced: list every `fs` call the kit will make and confirm each takes a path built only from the profile root, run dir, or worktree, never from a protected list entry.
  - Approach:
    - Documentation Reviewed:
      - roadmap §1.4, §2.12.5 rules 1–4, §2.12.7, §2.12.10, §2.12.16, Phase 13 Scope and Done
      - plan 163 Notes; `docs/next/{loop,host,events}.md` as updated by plan 163
    - Options Considered:
      - A second full review. Rejected: plan 163 Task 1 covered both parts.
    - Chosen Approach:
      - Read the shipped spans, decide (a)–(f), and amend Tasks 2–8 in place.
    - API Notes and Examples:
      ```bash
      graft skeleton src/loop/types.ts
      graft callers createRunController --depth 2
      rg -n -i '\b(claude|codex|agy|antigravity|gemini)\b' src/testing src/cli-relay.ts  # not src/cli*.ts: cli-providers.ts:31 holds a model id
      ```
    - Files to Create/Edit:
      - `plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md`: Notes and amendments only.
    - References:
      - plan 162 Task 1 (entry-check pattern)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - **Verdict: proceed.** K1–K6 are shipped as plan 163 decided; no finding invalidates Tasks 2–8. Four amendments (marked **AMEND**) below.
    - **K1–K6 as shipped (source spans):**
      - K1: `LoopStrategy.usesModel?: false` / `runModel?: "passthrough" | "none"` `src/loop/types.ts:173,175`; `RunController.model?` `:124`; `model_required` / `invalid_run_model_mode` raised at `createAgent` after the loop resolves, `src/agent-session/create-agent.ts:124-131`.
      - K2: `executeTools(calls, { concurrency?, origin? }): Promise<readonly ToolResult[]>` `types.ts:131` (impl `run-controller.ts:240`); `state(key)` `types.ts:142` (`run-controller.ts:548`); `end(): Promise<RunEndResult>` `types.ts:154` (`RunEndResult` `:24-ish`, `{continue:false}|{continue:true;reason}`); `observe(activity)` `:155` (impl `run-controller.ts:367`); `ask(request, support?)` `:161` (impl `:490`, maps `suspend` to `approval_pending` for resumable loops, `:495`); `steers()` `:164`; narrowed `emit(name, data)` `:166` (impl `run-controller.ts:554`, via `packageEventFor` with the loop owner). `ExternalActivity` `types.ts:41`, `ExternalToolRequest` `:80`, `ExternalToolDecision` `:91`, `ExternalAskSupport` `:97` (`rewrite`, `respond`), `EXTERNAL_ACTIVITY_EVENTS` `:103` (re-exported `src/loop/index.ts:15`).
      - K3: `EventOrigin` `src/contracts-protocol.ts:195`; `AgentEvent = AgentEventPayload & { origin? }` `:444`; `ToolCallHookPayload.origin?` `src/hooks/types.ts:101`; `ChildEventOrigin` gone.
      - K4: `SessionOptions.parent`/`actor`, `SessionActor`, summary link fields `src/contracts-core/session.ts:101-150`; `createSessionIndex` exported `src/index.ts:572` (`src/agent/sessions.ts`).
      - K5: `external_state` entries behind `run.state(key)` (`run-controller.ts:548`); tests `external-state.test.ts`.
      - K6: `HostUiTerminalRequest` `src/host/types.ts:57-63`, answer `{ exitCode }` `:91`.
    - **Task 1 (j):** Node built-ins all in use under `src/` (plan 163 Task 1 (j)). `src/cli.ts:3` is still the static `import { runCli } from "./cli-runner.js"` and `src/cli-relay.ts` does not exist, so Task 6 owns the dynamic dispatch exactly as written. `ask` support flags `rewrite`/`respond` are `ExternalAskSupport` `types.ts:97-100`, default unsupported, deny reasons `rewrite_unsupported`/`respond_unsupported`; the descriptor's `controls.rewrite` (and `respond`) feed them.
    - **Decisions:**
      - (a) Adopt `auth: { modes: readonly AuthMode[] }` with the recommended `AuthMode` shape; Phase 13 Scope beats §2.12.10. `protected.paths` entries are relative to the profile home or `~`-anchored and are matched, never opened.
      - (b) Adopt `parseStatus({ exitCode, stdout }) => { signedIn, method? }` on the driver; the kit keeps only `signedIn`, `method`, and a timestamp. **AMEND Task 4:** the status command's stdout is redacted before it reaches `parseStatus`'s error path, and discarded after parsing; a throwing `parseStatus` yields `auth_required` with no stdout in the message.
      - (c) Adopt `broker.route("mcp", handler)` over a web `(Request) => Promise<Response>`. The kit must not import `prism-mcp-server`; Task 6's stub-handler test stands in.
      - (d) Adopt the `hookCodec` shape. Its `HookEvent` reuses `ExternalToolRequest` and `ExternalActivity` from `src/loop/types.ts:41,80` (already root-exported types); `HookAnswer` is `ExternalToolDecision` plus `{ end: RunEndResult }`. **AMEND Task 6:** `approval_pending` (`run-controller.ts:495`) must reach `encode` as a deny whose text says approval is pending, not a generic deny.
      - (e) Adopt: rate-limit/quota/billing/auth are `notice` activity codes (`types.ts:73`-region `notice` shape has `code`, no `deferUntil`). **AMEND Task 4:** `deferUntil` is not in `ExternalActivity`'s `notice` today; the guard carries it in the notice `message` parse or the driver passes it to the guard directly (`guard.noteLimit({ code, deferUntil? })`), with no kernel change. The guard watches the driver's own call, not the event stream.
      - (f) Scan paths: `src/driver-kit/`, `src/testing/`, `src/cli-relay.ts`, `src/relay*`. Verified now: `rg -i '\b(claude|codex|agy|antigravity|gemini)\b' src/testing` has no hits; `src/driver-kit/` and `src/cli-relay.ts` do not exist yet. `src/cli-providers.ts:31` is excluded by design.
    - **Failing-test baseline (re-run today, tree unchanged from plan 163's close):** `bun run typecheck` fails only in `@arnilo/prism-tools-web` (`obscura/__tests__/browser.test.ts`) and `@arnilo/prism-tools-coding` (`security/approval.ts` `ExecutionAction`/`ExecutionDecision`/`ExecutionPolicy`), identical to plan 163's baseline. Kernel suites hook-invariants, conformance-helpers, host-ui, session-index, driver-primitives, external-state, event-origin, package-conformance: 80 pass, 0 fail. jsonl store: 42 pass. sqlite store: 37 pass, 1 fail (`names the Bun runtime…`, the same pre-existing failure as plan 163). Postgres, `packaging.test.ts`, `docs.test.ts` and the release gate were not re-run; plan 163 recorded them red/skipped for pre-existing reasons. **Rule for Tasks 2–8:** green means no new failure beyond plan 163's list plus the two above.
    - **Security (canary enforceability):** the fs calls the kit will make are: profile root `mkdir`/read/write of `profile.json` (Task 4), run directory create/write/remove (Task 5), worktree overlay write and `.git/info/exclude` edit (Task 5), `relay.json` write and socket path in the run directory (Task 6), and the binary probe via `spawn`, not fs (Task 2). Every path is built from the profile root, run dir, or worktree plus a validated relative name. **AMEND Task 4/5:** route all kit fs access through one `safeJoin(root, rel)` that rejects `..`, absolute paths, and any result inside a declared `protected.paths` entry, and make the canary's fs spy wrap that module's injected `fs` (Task 5 already injects `fs`); a `protected` entry is only ever compared as a string.
    - **Files amended:** Tasks 4, 5, 6 text via the AMENDs above (applied when each task starts). No code was changed.

- [x] Task 2: `@arnilo/prism/driver-kit` subpath — spec, descriptor, `defineDriver`, `driverPackage`, and `requires`
  - Acceptance Criteria:
    - Functional: `ExternalAgentSpec` (§2.12.7, with `vendor?: Record<string, JsonValue>`), `DriverDescriptor` (§2.12.10 with `auth` per Task 1 (a)), `defineDriver({ name, vendor, revision, descriptor, config, start })`, and `driverPackage(driver)` are exported from `@arnilo/prism/driver-kit`.
    - Functional: `driverPackage` returns a `definePackage` package that provides `slot:loop` with a `LoopStrategy` whose `usesModel: false`, `runModel: descriptor.models`, and `revision` joins `driver.revision` with the probed binary major version. Its config schema is `ExternalAgentSpec`'s schema extended by the driver's `config` schema; the spec's `vendor` object is validated by the driver's schema. Unknown keys fail closed.
    - Functional: At `setup` the package probes the binary (`start.probe()`: path on `PATH` or configured, version). A missing binary emits `status.note` and registers the loop; a run on it fails with `driver_unavailable`. A resume whose stored revision has a different binary major fails with `driver_revision_mismatch`.
    - Functional: `requires: { systemPrompt?, builtinTools?, gated?, steer?, resume?, thinking?, skillActivation?, subagents?, accountSignIn? }` in the package config is checked against the descriptor at `setup`; a miss fails `createAgent` with `driver_capability_missing` naming the control.
    - Functional: `package.json` gains `"./driver-kit"` (types and default, mirroring `./provider-kit`). `docs/next/drivers.md` is created with the spec, descriptor, `defineDriver`, and `requires` sections.
    - Functional: A repo test `driver_kit_names_no_vendor` scans `src/driver-kit/`, `src/testing/`, and the relay sources for the Task 1 (f) list and fails on any hit.
    - Performance: The root entry does not import `src/driver-kit/`; a test asserts the root import graph excludes it. Probing spawns one short process per `setup`, bounded by a timeout (default 5 s).
    - Code Quality: `src/driver-kit/` imports only `src/` kernel modules and Node built-ins; the "kernel imports no package" gate stays green. No vendor names in types, comments, or defaults.
    - Security: The child environment for the probe is built by the Task 3 builder (non-secret paths only). The probe's stdout is used only for the version string.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.7 (agent definition), §2.12.10; §1.4 (fail closed on missing control)
      - `src/provider-kit/index.ts`, `src/provider-kit/package.ts` (subpath and package-helper precedent); `src/packages/define.ts`; `src/packages/schema.ts`
    - Options Considered:
      - A native package `@arnilo/prism-driver-kit`. Rejected: §2.12.8 places it in the kernel, as `provider-kit`, so driver packages need no second dependency.
      - Validate `vendor` options in the kit. Rejected: they are driver-specific by definition.
    - Chosen Approach:
      - A kernel subpath mirroring `provider-kit`, with `defineDriver` as a typed constructor and `driverPackage` wrapping `definePackage`.
    - API Notes and Examples:
      ```ts
      const driver = defineDriver({
        name: "example-driver", vendor: "example", revision: "1",
        descriptor: { vendor: "example", usesModel: false, models: "passthrough", controls: { /* … */ }, capture: { /* … */ }, auth: { modes: [/* … */] } },
        config: { type: "object", properties: { binary: { type: "string" } } },
        start: { probe: async (cfg) => ({ path: cfg.binary ?? "example-cli", version: "1.2.0" }), run: async (ctx) => { /* spawn, map, gate */ } },
      });
      await createAgent({ packages: [driverPackage(driver)], packageConfig: { "example-driver": { name: "planner", profile: "me" } } });
      ```
    - Files to Create/Edit:
      - `src/driver-kit/index.ts`, `src/driver-kit/spec.ts`, `src/driver-kit/descriptor.ts`, `src/driver-kit/define.ts`, `src/driver-kit/errors.ts`, `src/driver-kit/__tests__/`.
      - `package.json`: `./driver-kit` export.
      - `tsconfig.json` / build include if subpaths are listed (tentative; `provider-kit` precedent decides).
      - `src/__tests__/public-export-contract.test.ts`, `src/__tests__/packaging.test.ts`: the subpath.
      - `src/__tests__/driver-kit-vendor-neutral.test.ts`: the vendor-name scan.
      - `scripts/e2e-coverage.json`: `@arnilo/prism` → `./driver-kit` suites.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate (`node scripts/release.mjs gate --update-baseline`); the note records the added subpath names.
      - `scripts/budgets.json`: export-count reason line.
      - `docs/next/drivers.md` (new), `CHANGELOG.md`.
    - References:
      - plan 151 Task 4 (`provider-kit` subpath), plan 146 (package loader)
  - Test Cases to Write:
    - `driver_package_claims_loop_and_is_model_less`: `createAgent` with no model succeeds; `inspect()` shows the slot owner.
    - `driver_config_extends_spec`: unknown spec key → config error; bad `vendor` option → the driver schema's error.
    - `missing_binary_is_status_note_then_driver_unavailable`.
    - `revision_major_mismatch_on_resume`.
    - `requires_miss_fails_create_agent`: one case per control.
    - `driver_kit_not_loaded_by_root_entry`.
    - `driver_kit_names_no_vendor`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new kernel subpath.
    - Docs pages to create/edit:
      - `docs/next/drivers.md` (new, API page structure): spec, descriptor, `defineDriver`, `driverPackage`, `requires`, errors.
      - `docs/next/packages.md`: link to the driver kit for loop-slot packages.
    - `docs/index.md` update: no — staged page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-10):
    - **Shipped:** `src/driver-kit/{spec,descriptor,define,errors,index}.ts`; `package.json` `./driver-kit`; `src/driver-kit/__tests__/driver-kit.test.ts` (6 cases) and `src/__tests__/driver-kit-vendor-neutral.test.ts` (`driver_kit_names_no_vendor`, `driver_kit_not_loaded_by_root_entry`); `docs/next/drivers.md` (spec, descriptor, `defineDriver`/`driverPackage`, `requires`, errors); `docs/next/packages.md` link; CHANGELOG; `public-export-contract` row. Task 1 (a) adopted: `auth: { modes: AuthMode[] }`.
    - **Deviation (revision):** the loop `revision` is the driver's own, not `revision+version`. `assemble.ts:670` compares revision for exact equality and throws `ERR_PRISM_LOOP_REVISION` before `restore`, which would reject every minor upgrade and preempt `driver_revision_mismatch`. The binary's major travels in `snapshot()`; `restore()` raises `driver_revision_mismatch`. Tasks 4–7 should treat `createDriverLoop(definition, config, binary)` as the seam where the guard and materializer hook in before `start.run`.
    - **Deviation (probe):** the driver supplies `start.probe`; the kit bounds it (`probeTimeoutMs`, default 5 s) and treats undefined/throw/timeout as missing. The kit does not spawn the probe itself, so the "probe env from the Task 3 builder" criterion moves to Task 3: ship a `probeBinary` helper there that uses `buildChildEnv`.
    - **Errors at setup** surface as `PackageLoadError` `setup_failed` with `driver_capability_missing: …<key>` in the message (the loader wraps non-`PackageLoadError` throws); `DriverError.code` is only visible for run-time failures.
    - **Export count:** `scripts/budgets.json` `@arnilo/prism` 1570 → 1603. The measured count was already 1585 before this task (plan 163's additions were never folded in); this task adds 18.
    - **Baseline:** `node scripts/release.mjs gate --update-baseline` fails midway on `@arnilo/prism-tools-coding` (pre-existing, `ExecutionAction`/`ExecutionDecision`/`ExecutionPolicy` missing) and had rewritten 19 other baseline files and created 17 new ones. I reverted all of that (`git checkout -- scripts/compat-baseline`, deleted the 17 files it created) and added only the 9 new `arnilo__prism.txt` lines by hand: `DriverError`, `EMPTY_VENDOR_SCHEMA`, `EXTERNAL_AGENT_SPEC_KEYS`, `assertDriverDescriptor`, `assertDriverRequires`, `createDriverLoop`, `defineDriver`, `driverPackage`, `externalAgentSpecSchema`. Interface/type-only exports are not listed in this baseline. Regenerate properly once the tools-coding typecheck is fixed.
    - **Not done / n/a:** `scripts/e2e-coverage.json` takes no row (`./provider-kit` has none either; the surface check reports no driver-kit error). `docs/release-and-install.md` got one table row because `docs.test.ts` requires every export specifier there (the plan said no released-doc edits).
    - **Checks:** `bun test src/driver-kit src/__tests__/driver-kit-vendor-neutral.test.ts`: 8 pass. `bun run typecheck`: no driver-kit errors; the existing tools-web/tools-coding errors remain. Related suites (kernel-imports, public-export-contract, agent-surface-freeze, packaging, docs, core-boundaries) show only failures that predate this task: packaging dependency tree and compiled-output checks, core-boundaries `src/contracts.ts mentions workflow`, and seven docs.test cases (broken `spawn-agent-tool.ts` link, retired names, and so on). I did not compare each against a clean tree.

- [x] Task 3: Process, protocol, normalization, and `agent.*` event helpers
  - Acceptance Criteria:
    - Functional: Process and protocol helpers:
      - `readJsonl(stream, { maxLineBytes, maxLines? })`: an async iterator of parsed lines; an over-long line fails with `jsonl_line_too_long`; malformed JSON yields a `{ kind: "invalid", raw }` item (redacted, bounded) rather than throwing.
      - `createJsonRpcPeer({ readable, writable, onRequest, onNotification })`: JSON-RPC 2.0 over JSONL; client→server `request`/`notify`, and server→client requests answered through `onRequest`; an unhandled server request is answered with a JSON-RPC error and reported to the caller (the driver decides to fail the run).
      - `createStdinWriter(writable)`: `write(message)` awaits `drain` on backpressure; `close()` ends stdin.
      - `signalLadder(child, { graceMs })`: SIGINT → SIGTERM → SIGKILL with grace timeouts; resolves with the exit code or signal.
      - `redactedStderr(stream, redactor, { maxBytes })`: a bounded ring of redacted stderr for error reports.
      - `buildChildEnv({ base, paths, apiKeys })`: an environment built only from an allow-listed base (`PATH`, `HOME`, `LANG`, `TERM`, …), non-secret paths, and resolved API-key refs; never the parent's full `process.env`.
    - Functional: Normalization helpers: `effectsTable(entries)` (unknown names get every `ToolEffect`), `mapDiff(unifiedDiff)` → `agent.file` activities, `mapUsage`, `mapPlan`, and `subagentScopes()` (open/close nested scopes by id and parent tool call).
    - Functional: The standard `agent.*` event names and data constructors from plan 163 Task 4 are re-exported (not redefined), with a type guard per name for consumers.
    - Performance: `readJsonl` holds at most one line plus the buffer bound in memory. The ladder never leaves a child running past `graceMs * 2` after abort.
    - Code Quality: Each helper is a small pure function or a thin stream wrapper with no driver state. No vendor frame shapes.
    - Security: `buildChildEnv` never copies a variable named in a mode's `protected.env`; a test sets one in the parent and asserts its absence. Stderr is redacted before it is stored or thrown.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.10 "Process and protocol helpers", "Normalization helpers"; §2.12.9 abort rule
      - JSON-RPC 2.0 specification (jsonrpc.org, 2013 edition)
      - Node `child_process` and `stream` APIs as implemented by Bun 1.4.2 (find-docs for `drain` and signal semantics)
    - Options Considered:
      - Depend on a JSON-RPC library. Rejected: the kernel has no runtime dependencies (§1.4).
      - Pass `process.env` through and strip secrets. Rejected: a deny-list leaks unknown secrets; an allow-list fails closed.
    - Chosen Approach:
      - Hand-written, bounded helpers in `src/driver-kit/process/` and `src/driver-kit/normalize/`.
    - API Notes and Examples:
      ```ts
      const peer = createJsonRpcPeer({ readable: child.stdout, writable: child.stdin, onRequest: async (method, params) => answer(method, params) });
      const effects = effectsTable({ read_file: ["read"], write_file: ["write"] });
      effects("unknown_tool"); // every effect
      ```
    - Files to Create/Edit:
      - `src/driver-kit/process/{jsonl,json-rpc,stdin,signals,stderr,env}.ts`, `src/driver-kit/normalize/{effects,diff,usage,plan,subagents}.ts`, `src/driver-kit/events.ts`, tests in `src/driver-kit/__tests__/`.
      - `src/driver-kit/index.ts`: exports.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate; diff in the note.
      - `docs/next/drivers.md`: helpers section. `CHANGELOG.md`.
    - References:
      - `src/provider-kit/transport.ts` (bounded stream precedent)
  - Test Cases to Write:
    - `jsonl_bounds_and_invalid_lines`.
    - `json_rpc_server_to_client_request_answered` and `json_rpc_unhandled_request_errors`.
    - `stdin_writer_waits_for_drain`.
    - `signal_ladder_escalates` (a child ignoring SIGINT and SIGTERM is killed within the bound).
    - `child_env_excludes_protected_and_parent_secrets`.
    - `effects_table_unknown_gets_every_effect`.
    - `diff_usage_plan_subagent_mappers`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new driver-kit exports.
    - Docs pages to create/edit:
      - `docs/next/drivers.md`: "Process and protocol helpers", "Normalization", "`agent.*` events".
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-10):
    - **Shipped:** `src/driver-kit/process/{jsonl,json-rpc,stdin,signals,stderr,env,probe,index}.ts`, `src/driver-kit/normalize/{effects,diff,usage,plan,subagents,index}.ts`, `src/driver-kit/events.ts`; exported from `index.ts`. Tests: `src/driver-kit/__tests__/helpers.test.ts` (11 cases covering every listed test name). `docs/next/drivers.md` (process, normalization, `agent.*` sections), CHANGELOG.
    - **Added `probeBinary`** (moved here from Task 2, which left the probe to the driver): spawns with `buildChildEnv`, uses stdout only for the first line, 5 s default bound. `buildChildEnv` also takes `modes` so `protected.env` is blocked from every source (base, paths, apiKeys).
    - **Deviation:** `readJsonl` also takes a sync iterable (for tests). `subagentScopes()` returns activity builders plus `active()`; the nested origin itself stays in the run controller (`run-controller.ts:430-450`), so the helper adds no second scope store. `DriverError` gained the code `jsonl_line_too_long`.
    - **Findings for later tasks:** `redactedStderr` takes `{ redact }` (matches `SecretRedactor`). The relay (Task 6) can reuse `readJsonl` for its socket framing.
    - **Baseline/budget:** 17 value lines added by hand to `scripts/compat-baseline/arnilo__prism.txt` (no removals; `--update-baseline` still blocked by the tools-coding typecheck); `scripts/budgets.json` `@arnilo/prism` export count 1603 → 1630 (measured with `measureExportCounts`).
    - **Checks:** `bun test src/driver-kit src/__tests__/driver-kit-vendor-neutral.test.ts`: 19 pass. `bun run typecheck`: no driver-kit errors (pre-existing tools-web/tools-coding errors remain). Broader suites (docs, packaging, export-contract, budget-gate) not re-run in this task beyond the above.

- [x] Task 4: Auth policy, profiles, and the policy guard
  - Acceptance Criteria:
    - Functional: The descriptor's `auth.modes` (Task 1 (a)) is validated at `defineDriver`: a mode with `kind: "account"` must declare `protected` paths or env; a hosted deployment requires its listed acknowledgements.
    - Functional: `createProfiles({ root, driver })` provides `create(name, { mode, principal?, maxConcurrentRuns? })`, `ensure(name)` (create if missing, check status, sign in through K6 if needed), `login(name)` (a `terminal` request with the mode's `login` command and `homeEnv` set to the profile home; with `unavailable`, a `notify` naming the exact command), `status(name)` (runs the mode's `status` command, parsed by the driver's `parseStatus`, Task 1 (b)), `bind(name, principal)`, `remove(name)`. The profile record (§2.12.7) is JSON in the profile directory and holds no secret.
    - Functional: The guard runs before every run and enforces:
      - rule 1: the probed binary path and version are recorded in `inspect()`; the kit never writes into the binary's directory
      - rule 2: a credential ref (`env:NAME`, `keyring:name`) naming a protected variable, or a config path inside a protected path, fails with `credential_required` (API keys stay ordinary refs); the kit opens no protected path
      - rule 3: a profile bound to another principal fails with `profile_principal_mismatch`
      - rule 4: more than `maxConcurrentRuns` (default 2) concurrent runs on one profile fails with `profile_busy`; `notice` activities with `rate_limit`/`quota`/`billing` stop or defer the run (Task 1 (e)) and never retry
      - declared policy: an account mode used with `deployment: "hosted"` when the mode does not list `hosted`, or without its acknowledgements, fails with `plan_login_not_permitted`; a signed-out profile fails with `auth_required`, naming the login command
    - Functional: `inspect()` shows, per profile in use: binary path and version, auth method last reported, bound principal id, deployment, acknowledgements, `maxConcurrentRuns`.
    - Performance: `status` runs only in `ensure` and on `auth_required` recovery, not on every run (the record caches the last result with a timestamp). The concurrency counter is in-process.
    - Code Quality: The guard is one module that reads only the descriptor and the profile record; no vendor branches.
    - Security: The canary: a test places a file at each declared protected path and protected env var, runs `create`/`ensure`/`login`/`status`/a run through the scripted CLI, and asserts (with an `fs` spy on the kit's module and a Bun file-open trace where available) that none is opened or read. Terminal output never reaches the kit (K6). Status stdout is redacted and discarded after parsing.
  - Approach:
    - Documentation Reviewed:
      - roadmap §1.4 (subscription credentials), §2.12.5 "What Prism enforces" rules 1–4, §2.12.7 "Profiles", §2.12.10 "Profiles", §2.12.16
      - plan 163 Task 8 (`terminal`), `src/credentials/` (ref resolution)
    - Options Considered:
      - Hardcode per-vendor deployment rules (§2.12.5 rules 5–6). Rejected by the 2026-10-10 re-scope: the adapter declares them.
      - Store the last status output. Rejected: it may contain account identifiers; only `signedIn` and `method` are kept.
    - Chosen Approach:
      - Auth policy as descriptor data, a profile store on the filesystem under the host's root, and one guard evaluated before spawn.
    - API Notes and Examples:
      ```ts
      const profiles = createProfiles({ root: "/tmp/prism-profiles", driver });
      await profiles.create("me", { mode: "account", principal: { id: "u1" } });
      await profiles.ensure("me"); // terminal sign-in through host.ui when signed out
      ```
    - Files to Create/Edit:
      - `src/driver-kit/auth.ts`, `src/driver-kit/profiles.ts`, `src/driver-kit/guard.ts`, tests.
      - `src/driver-kit/define.ts`: auth validation; the loop calls the guard before `start.run`.
      - `src/agent/inspect.ts` only if plan 163 left no slot-owner inspection seam (tentative; the entry check decides).
      - baseline regenerate; diff in the note. `docs/next/drivers.md`, `CHANGELOG.md`.
    - References:
      - plan 151 Task 6 (credentials slot and `Secret`)
  - Test Cases to Write:
    - `account_mode_hosted_not_permitted`.
    - `hosted_requires_acknowledgements`.
    - `profile_principal_mismatch`.
    - `profile_busy_over_cap`.
    - `auth_required_names_login`.
    - `protected_env_ref_is_credential_required`.
    - `login_uses_terminal_and_notify_fallback`.
    - `rate_limit_notice_stops_without_retry`.
    - `credential_canary_never_opened`.
    - `inspect_shows_profile_without_secret`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — profiles, auth policy, guard errors.
    - Docs pages to create/edit:
      - `docs/next/drivers.md`: "Auth policy", "Profiles and sign-in", "Policy guard" with the rules, errors, and the statement that the driver's author owns the vendor's terms.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-10):
    - **Shipped:** `src/driver-kit/{profiles,guard}.ts`; auth-mode validation in `descriptor.ts` (`assertDriverDescriptor`); `parseStatus` on `DriverDefinition`; `driverPackage` builds profiles and the guard at `setup`, runs `guard.acquire` before `start.run`, releases the lease in `finally`, and provides the `driver-kit:<name>` service. Tests: `src/driver-kit/__tests__/auth.test.ts` (12 cases, every listed name plus mode validation and path containment); `driver-kit.test.ts` now creates its profile. `docs/next/drivers.md` (auth policy, profiles, guard, errors), CHANGELOG.
    - **Deviations:** (1) Deployment, acknowledgements, principal, and profile root are driver-package config keys (`deployment`, `acknowledgements`, `principal`, `profilesRoot`), since the run controller exposes no principal; a driver config may not redefine them. (2) `inspect()` is `guard.inspect()` on the `driver-kit:<name>` service, not `agent.inspect()`: no seam exists and none was added. (3) `noteLimit` is on the guard (Task 1 (e)) and returns `stop` or `defer`; nothing retries. (4) A missing profile fails with `auth_required`, so every run on a driver package needs `profiles.create` first. (5) New `profile_invalid` code for bad names and path escapes. (6) `{binary}` as the first argv element of `login`/`status` is replaced with the probed binary path. (7) The canary uses an injected `fs` spy on the profile store (the status command is a separate child); no Bun file-open trace.
    - **Findings for later tasks:** Task 5 should route its fs through the same `safeJoin` idea (the one in `profiles.ts` is private to a profile directory; export a shared helper if reusing). `DriverRunContext.lease` gives Task 5 the profile `home` for `createRunDirectory`.
    - **Baseline/budget:** hand-added `createPolicyGuard`, `createProfiles`, `isInside`, `resolveProtected` and updated the `createDriverLoop` signature in `scripts/compat-baseline/arnilo__prism.txt` (sorted, no removals); `scripts/budgets.json` `@arnilo/prism` 1630 → 1648 (measured).
    - **Checks:** `bun test src/driver-kit src/__tests__/driver-kit-vendor-neutral.test.ts src/__tests__/public-export-contract.test.ts`: 137 pass, 0 fail. `bun run typecheck`: no driver-kit errors (pre-existing errors elsewhere remain). `docs.test`, packaging, and the release gate were not re-run.

- [x] Task 5: Configuration materializer and `materializeSkills`
  - Acceptance Criteria:
    - Functional: `createRunDirectory(profile, runId)` creates a private (`0700`) per-run directory under the profile; `writeFile(rel, content)` refuses paths that escape it.
    - Functional: `overlay(worktree, files)` writes files into a worktree and appends each path to `.git/info/exclude` (creating it if needed, never duplicating lines). Dispose removes the files and the exclude lines it added, and the run directory.
    - Functional: `materializeSkills(selection, layout?)` reads the selected skills from the agent's kernel skills registry (`"all"` or names; an unknown name fails with `unknown_skill`) and writes the neutral `skill-dirs` layout (one `<name>/SKILL.md` directory per skill, with its resources) and returns `{ root, pathToSkill: Map<string, string> }`. A `layout` callback receives that result and may wrap it (for example as a plugin manifest or a settings entry) and return extra files.
    - Functional: Under `isolation: "strict"`, a driver whose descriptor says `isolation: "workspace-files"` and whose run has no worktree fails with `worktree_required`. `isolation: "inherit"` is recorded in `inspect()`.
    - Performance: Materialization writes only selected skills, once per run. Dispose is idempotent and runs on run end, abort, and agent dispose.
    - Code Quality: Pure filesystem helpers with an injected `fs` for tests; no vendor layout built in.
    - Security: The run directory and overlay paths are built only from the profile root, the run id, and the worktree; writes outside them throw. File modes are private. Skill content is copied, never symlinked.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.7 "Isolation", "Configuration materialization"; §2.12.10 "Configuration materializer"
      - `src/skills.ts`, `src/skill-load.ts` (registry and `SKILL.md` loading)
    - Options Considered:
      - Leave overlays to Phase 14's `workspace` service. Rejected: Phase 13 Scope puts overlays and `.git/info/exclude` in the kit; Phase 14's `excludeOverlay` can reuse this helper.
      - Symlink skills. Rejected: a vendor binary could follow a link out of the run directory.
    - Chosen Approach:
      - Small helpers in `src/driver-kit/materialize.ts` with a dispose stack.
    - API Notes and Examples:
      ```ts
      const dir = await createRunDirectory(profile, run.session.id);
      const skills = await materializeSkills(spec.skills ?? [], (out) => [{ path: "plugin.json", content: JSON.stringify({ skills: out.root }) }]);
      ```
    - Files to Create/Edit:
      - `src/driver-kit/materialize.ts`, `src/driver-kit/skills.ts`, tests.
      - baseline regenerate; diff in the note. `docs/next/drivers.md`, `CHANGELOG.md`.
    - References:
      - plan 148 Task 6 (kernel skills registry)
  - Test Cases to Write:
    - `run_directory_private_and_contained`.
    - `overlay_writes_exclude_and_cleans_up` (a real `git init` temp repo; `git status --porcelain` is clean during the run and after dispose).
    - `materialize_skills_skill_dirs_layout_and_path_map`.
    - `materialize_skills_layout_callback_wraps`.
    - `unknown_skill_fails`.
    - `workspace_files_strict_without_worktree_is_worktree_required`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new driver-kit exports.
    - Docs pages to create/edit:
      - `docs/next/drivers.md`: "Isolation and materialization".
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-10):
    - **Shipped:** `src/driver-kit/materialize.ts` (`createRunDirectory`, `materializeSkills`, `assertIsolation`, option/result types), exported from `index.ts`; `DriverError` gains `worktree_required` and `unknown_skill`. Tests: `src/driver-kit/__tests__/materialize.test.ts` (6 cases, every listed name; the overlay case uses a real `git init` repo). `docs/next/drivers.md` "Isolation and materialization" and the errors list; CHANGELOG.
    - **Deviations:** (1) Signatures take explicit inputs instead of ambient state: `createRunDirectory(profileHome, runId, { fs? })` (the dir is `<profileHome>/runs/<runId>`; Task 6 passes `profiles.homeOf(name)`'s parent or the lease home) and `materializeSkills(dir, registry, selection, layout?)`, since the run controller exposes no skills registry. (2) `assertIsolation(descriptor, { isolation, worktree })` is a standalone check; wiring it into `driverPackage` before `start.run` (it needs the run's worktree, which no kernel seam exposes) is left to the driver's `run`/Task 8 example, and `inspect()` recording of `inherit` is the returned `isolation` field. (3) Skills without a `path` are written from `instructions` with a frontmatter header; those with a `path` have their whole directory copied (symlinks skipped, 256-file cap).
    - **Baseline/budget:** hand-added `assertIsolation`, `createRunDirectory`, `materializeSkills` to `scripts/compat-baseline/arnilo__prism.txt` (sorted, no removals); `scripts/budgets.json` `@arnilo/prism` 1648 -> 1657 (measured).
    - **Checks:** `bun test src/driver-kit`: 35 pass, 0 fail. `bun run typecheck`: no driver-kit errors. docs/packaging/release gate not re-run.

- [x] Task 6: Callback broker, `bridgeTools`, and the `prism relay` bin
  - Acceptance Criteria:
    - Functional: `createCallbackBroker(run, { runDir, hookCodec, failClosed: { exitCode, stdout }, timeoutMs, askSupport?, maxBodyBytes? })` (AMEND: `origin` dropped, see Task 6 note) listens on a per-run Unix socket (in the run directory, `0600`) and loopback HTTP on `127.0.0.1` with a random per-run bearer token. Before returning, it writes the relay descriptor (`relay.json`: socket path, timeout, fail-closed response) into the run directory. It routes:
      - hook events: `hookCodec.decode` → `run.ask` (pre-tool), `run.end` (stop), or `run.observe` → `hookCodec.encode` (Task 1 (d))
      - `route("mcp", handler)` (Task 1 (c)): HTTP requests and relayed stdio MCP frames go to the registered web handler; with none registered, MCP requests are refused
      - the permission-prompt tool is reached through the MCP route (Phase 14), so the broker adds no separate permission endpoint
    - Functional: The broker closes on run end, abort, or suspension; later requests are refused. Wrong token or Origin on HTTP → 401/403.
    - Functional: `bridgeTools(run, names, { origin, tools })` resolves names against `tools` (AMEND, see Task 6 note: no kernel read seam for the agent registry), fails with `unknown_tool` on any unknown name, returns the definitions (name, description, schema, effects), and `invoke(call)` calls `run.executeTools([call], { origin })` and returns its result.
    - Functional: `prism relay hook --run <run-dir>` reads `relay.json`, forwards stdin to the socket, and prints the broker's `{ exitCode, stdout }`, exiting with that code. If the descriptor is missing or unreadable, the socket is unreachable, or the answer takes longer than the timeout, it prints the descriptor's fail-closed response (or, with no readable descriptor, exits 2 with an empty stdout). `prism relay mcp --run <run-dir>` bridges stdio JSON-RPC to the broker's MCP route.
    - Functional: `src/cli.ts` dispatches `relay` by dynamic import before loading `cli-runner.ts`. (Plan 163 Task 1: `cli.ts` currently has a static `import { runCli } from "./cli-runner.js"`; it must become a dynamic import behind the `argv[0] === "relay"` check. `dist/cli.js` stays the only bin; `scripts/packaging-current.test.mjs:104` and `e2e-cli-live.test.mjs:81` pin it. Run `ask` per plan 163 Task 4: a resumable loop gets `approval_pending`, so the broker must map that reason to a vendor deny.)
    - Performance: A `prism relay hook` invocation imports only the relay module (a test asserts the module graph); the broker handles concurrent requests without serializing (re-entrant `executeTools`).
    - Code Quality: The relay knows no dialect: it moves bytes and prints what the broker or the descriptor says. The broker reuses plan 163's primitives; no second gating path.
    - Security: Gating fails closed in every failure mode (broker down, slow, crashed mid-request, malformed answer). The token never appears in events, `inspect()`, errors, or the relay descriptor (the relay uses the socket, which is protected by file mode). Request bodies are bounded.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.7 "Callback broker", §2.12.10 "Callback broker", "`prism relay` bin", "Tool bridge"; G3, G11; §2.12.16 "Gating fails closed"
      - `src/cli.ts`, `src/cli-runner.ts:222-229`; `packages/hosts/mcp-server/src/` web handler (for the route contract only, not imported)
    - Options Considered:
      - HTTP hooks for gating. Rejected: vendors treat their failures as non-blocking (§2.12.4).
      - Per-dialect relays. Rejected by the re-scope: the descriptor carries the fail-closed response.
    - Chosen Approach:
      - One broker per run with a codec seam, and a relay that prints a broker answer or the declared fail-closed response.
    - API Notes and Examples:
      ```bash
      echo '{"tool":"write_file","input":{"path":"a.ts"}}' | prism relay hook --run "$RUN_DIR"; echo "exit=$?"
      ```
      ```ts
      const broker = await createCallbackBroker(run, { runDir, hookCodec, failClosed: { exitCode: 2, stdout: "" }, timeoutMs: 10_000, origin });
      const tools = bridgeTools(run, spec.prismTools ?? [], { origin });
      ```
    - Files to Create/Edit:
      - `src/driver-kit/broker.ts`, `src/driver-kit/bridge.ts`, `src/cli-relay.ts`, tests.
      - `src/cli.ts`: `relay` dispatch.
      - `src/__tests__/core-boundaries.test.ts`: allow `src/cli-relay.ts` if the boundary list requires it.
      - baseline regenerate; diff in the note. `docs/next/drivers.md`, `CHANGELOG.md`.
    - References:
      - plan 150 Task 7 (`prism` CLI dispatch)
  - Test Cases to Write:
    - `relay_forwards_and_prints_broker_answer`.
    - `relay_fails_closed_when_broker_stopped` (the invariant test for G11).
    - `relay_fails_closed_on_timeout_and_missing_descriptor`.
    - `relay_imports_only_relay_module`.
    - `broker_routes_pre_tool_to_ask_and_stop_to_end`.
    - `broker_concurrent_callbacks_fire_tool_call` (with plan 163's re-entrancy).
    - `broker_http_rejects_wrong_token_and_origin`.
    - `broker_refuses_after_close`.
    - `broker_mcp_route_stub`.
    - `bridge_tools_unknown_name_fails` and `bridge_tools_invoke_goes_through_tool_call`.
    - `broker_token_never_in_events_or_inspect`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exports and a CLI command.
    - Docs pages to create/edit:
      - `docs/next/drivers.md`: "Callback broker and relay", "Tool bridge".
      - `docs/next/manifest.md` or the CLI section that lists `prism` commands: add `prism relay` (tentative: whichever `docs/next` page documents the CLI).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`


  - Notes (executed 2026-10-10):
    - **Shipped:** `src/driver-kit/relay-protocol.ts` (the wire contract: channel header, descriptor, answer and MCP frame guards; no imports), `src/driver-kit/broker.ts` (`createCallbackBroker`, `HookCodec`, `HookEvent`, `HookDecision`, `HookAnswer`), `src/driver-kit/bridge.ts` (`bridgeTools`), `src/cli-relay.ts` (`runRelay`), `src/cli.ts` (the `relay` branch is a dynamic import; the other branch imports `cli-runner.js` the same way), `errors.ts` (`unknown_tool`, `broker_unavailable`), `index.ts` (broker and bridge exports). Tests: `src/driver-kit/__tests__/broker.test.ts` (11 cases) and `relay.test.ts` (6 cases), covering every listed name except `broker_token_never_in_events_or_inspect` (see below). `docs/next/drivers.md` "Callback broker and relay" and "Tool bridge", the error list, and a `prism relay` row in `docs/next/manifest.md`'s CLI table; CHANGELOG.
    - **Deviations from the plan text:**
      1. **`bridgeTools` takes `tools`.** `RunController` exposes no tool registry, and `PackageAPI.tools` only has `register`. A driver reads no agent list at run time, so the plan's "resolves against the agent's tool registry" has no seam. The driver passes the `ToolDefinition` objects it registers through `prism.tools.register`. Adding `PackageAPI.tools.list()` would be a kernel addition, so it goes back to plan 163 as an amendment, and the user decides (see the final message). **Resolved by plan 166 Task 2 (2026-10-12):** `PackageAPI.tools.list()`/`skills.list()`/`get()` and `DriverRunContext.tools`/`skills` now exist, so a driver reads the effective registry from its context and the deviation is closed.
      2. **`origin` is not on the broker.** `run.ask` and `run.observe` take no origin argument, and the broker dispatches no tools itself, so the option had no use. `bridgeTools` keeps `origin` for `executeTools`.
      3. **`HookDecision` carries `message`.** A deny is `{ allow: false, reason, message }`, where `message` is the text for `approval_pending` ("approval is pending; the run is suspended...") or `non_interactive`. Plan 1 (d) asked for `approval_pending` to reach `encode` as a pending deny, not a generic one. `HookAnswer` also has `{ observed: true }` for an observe callback, which the plan did not name.
      4. **Socket reads go through a `PassThrough`.** Two findings, both reproduced on Node and Bun. First, a net server with the default `allowHalfOpen: false` drops the answer when the relay half-closes after its payload, so the server now sets `allowHalfOpen: true` and ends the socket itself. Second, iterating a socket with `for await` destroys it when iteration finishes, which also drops the answer. Reads now go through `socket.pipe(PassThrough)`.
      5. **Close points.** The broker closes on `run.signal` abort, and it stops answering after an `approval_pending` deny. It does not observe run end itself, since no kernel seam exposes it. The driver calls `close()` in its own `finally`, which Task 8's example must do. Closing destroys open connections immediately, so a callback still in flight at that moment gets the fail-closed answer.
      6. **MCP notifications get no reply.** The handler still receives them; the broker drops whatever body the handler returns for a message with no `id`. JSON-RPC requires this.
    - **Findings for later tasks:**
      - **Task 7 (`createScriptedCli`):** a scripted hook calls `prism relay hook --run <dir>` through the same socket protocol. It needs the relay's header line (`{"channel":"hook"}`) and an answer line; `relay-protocol.ts` has the constants.
      - **Task 8 (example):** register the same `ToolDefinition` objects with `prism.tools.register` and pass them to `bridgeTools`. Call `broker.close()` in `finally`. The example's allow path needs no host UI, because `ask` allows when no `tool.call` hook denies.
      - **Task 8 (Phase 13 Done):** the `driver-kit` tests use fake `RunController`s only for the gate mapping and the bridge's fail-closed checks. The routing, concurrency, HTTP, and relay tests use a real `createAgent` run.
    - **Baseline/budget:** hand-added `bridgeTools` and `createCallbackBroker` to `scripts/compat-baseline/arnilo__prism.txt` (sorted, no removals). `scripts/budgets.json` `@arnilo/prism` 1657 -> 1682 (measured). The measured delta is 25 against 26 declared names in the four new modules; I did not reconcile the difference.
    - **Checks:**
      - `bun run build:core`: passes. `node dist/cli.js relay hook --run /nonexistent` exits `2` with the usage text on stderr, as the plan specifies.
      - `bunx tsc --noEmit -p tsconfig.json`: exit 0. `bun run typecheck` fails only at the workspace stage, in `@arnilo/prism-tools-web` and `@arnilo/prism-tools-coding`, the baseline the plan records.
      - `bun test src/driver-kit src/__tests__/driver-kit-vendor-neutral.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/agent-surface-freeze.test.ts`: 165 pass, 0 fail.
      - `core-boundaries.test.ts`: 13 pass, 1 fail, `src/contracts.ts mentions workflow`. The plan records this as pre-existing (Task 2).
      - `packaging.test.ts`: 312 pass, 1 fail, the `npm ls` dependency tree. The plan records this as pre-existing.
      - `docs.test.ts`: 164 pass, 6 fail (the plan's Task 2 recorded seven; the count moved, and the failures are about page content this task did not touch).
      - `scripts/packaging-current.test.mjs` (under Bun): 183 pass, 2 fail. `install-smoke` no longer covers `@arnilo/prism-delegate`, and the Bun-consumer install test is the slow network install. Neither mentions a driver-kit or relay file. I did not compare them against a clean tree.
      - `scripts/budget-gate.test.mjs`: `@arnilo/prism` passes. The export ceilings for `prism-mcp`, `tools-work`, `tools-coding`, and `channels` fail (other packages). The non-null-assertion count for `src` is above its recorded 570. I removed the four sites this task added, and the rest of the excess is outside this task; I did not attribute it.
      - Biome on the touched files: no errors; one info-level suggestion remains (a template literal in a test).
      - Vendor scan (`rg` over `src/driver-kit src/testing src/cli-relay.ts`): no hits. `driver_kit_names_no_vendor` passes.
      - Sweep: no `child?:` or `ChildEventOrigin` in the new code.
    - **Not verified:** `broker_token_never_in_events_or_inspect` checks `relay.json`, `inspect()`, and a 401 body, but it does not subscribe to events. The broker emits no events itself, and the token reaches no kernel call, so the event surface is untouched by construction, but the test does not prove it.

- [x] Task 7: `/testing` — `createScriptedCli`, reference dialects, and `driverConformance`
  - Acceptance Criteria:
    - Functional: `createScriptedCli({ dialect, script })` returns `{ command: string[]; env; dispose() }` for a fake binary (a Bun script in a temp directory) that replays `script` frames. Two neutral reference dialects ship:
      - `jsonl-stream`: one process per conversation; JSONL user messages in, JSONL activity frames out; tool gating by running a configured hook command (the relay) with JSON on stdin and honoring its exit code and stdout
      - `json-rpc`: a JSON-RPC 2.0 app-server over stdio that sends approval requests to the client and accepts the neutral methods `session.start`, `turn.start`, `turn.steer`, and `turn.interrupt`
    - Functional: `defineScriptedDialect({ name, encodeInput, frames, hook? })` lets a driver author describe their own binary's frames.
    - Functional: `driverConformance(driver, { dialect, fixtures })` runs every §2.12.10 case: flag and file materialization; gating through the relay, including fail-closed with the broker stopped; `observe` mapping for every activity kind; `ask`, `steer`, abort (within the grace bound), resume; profile binding, concurrency, and deployment rules; strict isolation; no secret in events or `inspect()`; and the canary (a file at each declared protected path that must never be opened).
    - Functional: The vendor-name test from Task 2 covers the new files.
    - Performance: Each conformance case uses one scripted process; the suite runs offline. The fake binary starts with no network.
    - Code Quality: Dialect frames are neutral and documented as such; no recorded vendor fixtures ship in the kernel.
    - Security: The scripted CLI never reads the profile's protected paths; the canary asserts the driver under test does not either.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.4 (the three integration shapes, read as transport shapes only), §2.12.10 "Conformance", Phase 13 Scope `/testing`
      - `src/testing/loop-conformance.ts`, `src/testing/store-conformance.ts` (leg pattern), `docs/next/testing.md`
    - Options Considered:
      - Recorded vendor fixtures in the kernel. Rejected: the kernel names no vendor; hosts record their own fixtures (Phase 15).
      - An in-process fake instead of a child process. Rejected: the relay, signals, and backpressure must be exercised for real.
    - Chosen Approach:
      - A generated Bun script per dialect, driven by a frame script, plus a leg-based conformance runner.
    - API Notes and Examples:
      ```ts
      const cli = await createScriptedCli({ dialect: "jsonl-stream", script: [{ out: { type: "text.delta", text: "hi" } }, { hook: { tool: "write_file" } }, { out: { type: "result" } }] });
      await driverConformance(exampleDriver, { dialect: "jsonl-stream", fixtures });
      ```
    - Files to Create/Edit:
      - `src/testing/scripted-cli.ts`, `src/testing/scripted-dialects/{jsonl-stream,json-rpc}.ts`, `src/testing/driver-conformance.ts`, `src/testing/index.ts`, tests.
      - `package.json`: a `./testing/driver-conformance` subpath only if the existing per-suite subpath pattern requires it (tentative; matches `./testing/tool-conformance`).
      - `src/__tests__/public-export-contract.test.ts`, `src/__tests__/packaging.test.ts`, `scripts/e2e-coverage.json`.
      - baseline regenerate; diff in the note. `docs/next/testing.md`, `docs/next/drivers.md` "Conformance", `CHANGELOG.md`.
    - References:
      - plan 147 Task 1 (`/testing` and loop conformance), plan 153 Task 2 (`storeConformance`)
  - Test Cases to Write:
    - `scripted_cli_jsonl_stream_replays_and_calls_hook`.
    - `scripted_cli_json_rpc_sends_approval_request`.
    - `define_scripted_dialect_custom_frames`.
    - `driver_conformance_passes_for_reference_driver` on both dialects (with an inline test driver).
    - `driver_conformance_fails_on_canary_read`: a deliberately bad driver that reads a protected path fails the canary leg.
    - `driver_conformance_fails_when_relay_fails_open`: a bad hook codec that answers allow on error fails the gating leg.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `/testing` exports.
    - Docs pages to create/edit:
      - `docs/next/testing.md`: `createScriptedCli`, dialects, `defineScriptedDialect`, `driverConformance`.
      - `docs/next/drivers.md`: "Conformance".
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-10):
    - **Shipped:** `src/testing/scripted-cli.ts` (`createScriptedCli`, `defineScriptedDialect`, the script, dialect, and record types); `src/testing/scripted-dialects/{jsonl-stream,json-rpc}.ts` (the two reference dialects); `src/testing/driver-conformance.ts` (`driverConformance`, `DriverConformanceError`); exports from `src/testing/index.ts`. Tests: `src/testing/__tests__/scripted-cli.test.ts` (5 cases: the three named cases, method-shorthand rejection, and a bad step) and `driver-conformance.test.ts` (4 cases: the reference driver on both dialects, the canary, and fail-open). `src/testing/__tests__/reference-driver.ts` is a test-only driver, not a test file. Docs: `docs/next/drivers.md` "Conformance", `docs/next/testing.md` (`createScriptedCli`, `driverConformance`), CHANGELOG.
    - **Deviations from the task text:**
      1. The hook command is a driver-supplied flag, `--hook-command <json argv>`, not an env var or a `createScriptedCli` option. The driver knows its run directory; the binary runs that command with the call as JSON on stdin and honors its exit code, the way a vendor reads a hook config. `createScriptedCli` also returns `record()`, which the tests and legs need.
      2. Dialects carry `encodeInput` and `parseFrame` (driver side) and `decodeInput`, `frames`, and `hook` (binary side). The binary inlines the functions from their source, so each must be a self-contained function expression. `defineScriptedDialect` compiles each one alone and rejects method shorthand.
      3. Each leg builds its own binary, profile root, and agent, so no leg leaves state for the next. `fail_closed` is skipped on `json-rpc`: its approvals travel the client channel, so there is no relay to break.
      4. **Canary detection.** The plan's atime detector cannot work on this host: `/tmp` is tmpfs and `/home` is btrfs, and both mount `noatime`, so a read never moves atime. The canary probes atime once per leg. When atime is not recorded, the protected paths are mode `0000`, and a driver that tries to read one fails with `EACCES`, which the run reports. A silent read on a `noatime` filesystem therefore passes the canary. The `no_secret` leg still catches a read whose content reaches events, the binary record, or the profile record. Root bypasses mode `0000`. The leg returns this limit as a `reason` on a passed leg, which is a new `DriverConformanceLeg.reason` field.
      5. `resume` runs when `controls.resume !== "none"`. It suspends on an `ask`, resumes with `allow_once`, and checks that the gate was entered again.
    - **Defects found and fixed while building it:**
      - The binary must install its SIGINT and SIGTERM handlers before it records argv. Otherwise an abort that arrives while Bun is still starting kills the binary unrecorded, and the abort leg reads an empty record. The abort leg also waits for the binary's `argv` record before it aborts.
      - A Unix socket path must fit in 103 bytes. A profile root under `mkdtemp(tmpdir())` plus a full UUID run id overflowed it, and the run failed with `broker_unavailable`. Conformance uses a `dc-` prefix, and the reference driver uses an 8-character run id.
      - `profiles.status` substitutes `{binary}` only as the first argv element, and the binary path is `bun`, not the script. The reference account mode therefore uses `["{binary}", "-e", "process.exit(0)"]` as its status command, and its `parseStatus` maps exit 0 to `signedIn`.
      - Patching `node:fs` in-process does not reach ESM named imports under Bun, so the canary cannot spy on reads.
    - **Findings for Task 8:** see the AMEND in Task 8. Each leg's binary is the same kind of child the example will use, so the example's driver must follow the same `--hook-command` convention.
    - **Performance (plan text, not met as written):** the plan asked for one scripted process per conformance case. A leg spawns one binary per run, one relay per gate call, and one status command for an account mode. The four-test suite takes about 12 s.
    - **Not covered by `driverConformance`:**
      - `no_secret` does not read `inspect()`. No agent-level seam reaches the `driver-kit:<name>` service, so the check covers events, the binary record, and the profile record only.
      - `strict_isolation` checks the descriptor against `assertIsolation`. It cannot verify that the driver calls `assertIsolation` in its own run.
      - `materialization` checks only that a command-hook driver passes `--hook-command`. It does not check file materialization.
      - `observe` checks that each activity kind produces its event, not the event payloads.
    - **Baseline/budget:** hand-added six value lines to `scripts/compat-baseline/arnilo__prism.txt`: `driverConformance`, `DriverConformanceError`, `createScriptedCli`, `defineScriptedDialect`, `jsonRpcDialect`, `jsonlStreamDialect`. `scripts/budgets.json` `@arnilo/prism` moved from 1682 to 1706 (measured). The measured delta is 24 against 21 declared names. The 3-name difference is not reconciled, as in Task 6. `--update-baseline` is still blocked by the tools-coding typecheck.
    - **Checks:**
      - `bun test src/driver-kit src/testing`: 61 pass, 0 fail (this covers Tasks 2–7).
      - `bunx tsc --noEmit -p tsconfig.json`: exit 0.
      - Biome on the touched files: clean.
      - Passing: `public-export-contract`, `driver-kit-vendor-neutral`, `kernel-imports-no-package`, `hook-invariants`, `conformance-helpers`, `host-ui`, `session-index`.
      - `core-boundaries`: 1 fail, `src/contracts.ts mentions workflow`. Pre-existing, recorded in Tasks 2 and 6.
      - `docs.test.ts`: 164 pass, 6 fail. That is the same count as Task 6; the failures are pre-existing (for example, the broken `docs/multi-agent-patterns.md` → `examples/spawn-agent-tool.ts` link). I did not diff the failing names against a clean tree.
      - Vendor scan over `src/testing/`: no hits. `driver_kit_names_no_vendor` passes.

- [x] Task 8: `examples/external-agent.ts`, docs completion, and the Phase 13 Done record (reopened 2026-10-11: the example, docs, and Done record shipped; subtasks 8.1–8.4 close the typecheck, release-gate, and publish criteria) (closed 2026-10-11 by plan 165 Task 1: 8.1–8.4 are checked, `bun run typecheck` is green, and `bun run release:gate` is blocked only on host Postgres evidence)
  - Acceptance Criteria:
    - Functional: `examples/external-agent.ts` runs offline. An inline driver written with `defineDriver` runs against the `jsonl-stream` scripted CLI and:
      - declares an account mode limited to `local`, creates a profile, and signs in through a scripted `terminal` response
      - runs a spec with a replaced prompt, two bridged tools, and one skill
      - shows text and thinking deltas, a skill activation, and a nested sub-agent
      - gates a write through the relay with a scripted `HostUi`, then shows the relay failing closed when the broker is stopped
      - steers and resumes
      - searches with `createSessionIndex`
      - shows `plan_login_not_permitted` on `deployment: "hosted"`, `profile_principal_mismatch`, and `profile_busy`
    - Functional: The example runs under the execution gate (`examples_demos_run_to_completion_and_emit_no_secret`) and imports only `@arnilo/prism`, `@arnilo/prism/driver-kit`, and `@arnilo/prism/testing`.
    - Functional: `docs/next/drivers.md` is complete per the API page structure: driver kit, spec, descriptor and auth policy, profiles and sign-in, policy guard, callback broker and relay, `agent.*` events, conformance. `docs/next/{loop,events,agent,host}.md` link to it.
    - Functional: The Phase 13 Done criteria are recorded in this task's note, each with its evidence:
      - `driverConformance` passes for the example driver on both reference dialects
      - the invariant tests pass from the default loop and from a driver loop
      - `storeConformance` with the K4 and K5 legs passes on every store (Postgres recorded as run or skipped with reason)
      - no event carries `child` (`rg` over the tree)
      - the canary test: no code path in the kernel or the driver kit opens a declared protected credential path
      - `driver_kit_names_no_vendor` passes
      - `bun run typecheck` is green
    - Performance: The example finishes in under 10 s on the scripted CLI.
    - Code Quality: The example's driver is short and commented as a template for the Phase 15 adapter guide; it names no vendor.
    - Security: The example's output contains no token, no protected path content, and no secret (asserted by the gate).
  - AMEND (Task 7 findings): the example's driver must follow the conformance convention, which the example also needs.
    - The driver passes the relay command to the binary as `--hook-command <JSON argv>`, where the argv is `[process.execPath, <cli>, "relay", "hook", "--run", <run dir>]`. A binary that gates without it cannot be conformance-tested.
    - Keep the run id short (8 characters) and the profile root short. A Unix socket path must fit in 103 bytes, so a long `tmpdir()` root plus a full UUID fails with `broker_unavailable`.
    - An account mode needs a `status` command and a `parseStatus`, or every run fails with `auth_required`. The reference driver's account mode is `["{binary}", "-e", "process.exit(0)"]`.
    - The "Phase 13 Done" canary record must say what `driverConformance` cannot see on a `noatime` filesystem: a silent read is caught only when the canary's protected files are mode `0000`, which root bypasses. See Task 7 notes.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 13 Example and Done; `examples/README.md`; `scripts/e2e-coverage.json`
    - Options Considered:
      - Two examples (one per dialect). Rejected: the roadmap names one example; the `json-rpc` dialect is proven by `driverConformance`.
    - Chosen Approach:
      - One end-to-end example plus the Done record.
    - API Notes and Examples:
      ```bash
      bun examples/external-agent.ts
      ```
    - Files to Create/Edit:
      - `examples/external-agent.ts` (new).
      - `examples/README.md`: a demo line; `scripts/e2e-coverage.json`: the example under `@arnilo/prism` `./driver-kit`.
      - `docs/next/drivers.md`, `docs/next/{loop,events,agent,host}.md` cross-links, `CHANGELOG.md`.
      - `plans/README.md`: status of plans 163 and 164.
    - References:
      - `examples/sqlite-resume.ts`, `examples/durable-approval.ts` (gate pattern)
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `external-agent.ts` (existing gate, new row).
    - `external_agent_example_shows_every_scope_behavior`: asserts the example's structured output lists each Scope behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — completes the staged driver-kit docs.
    - Docs pages to create/edit:
      - `docs/next/drivers.md`: completed.
      - `examples/README.md`: example line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-11):
    - **Shipped:**
      - `examples/external-agent.ts`: an inline `defineDriver` over `createScriptedCli` with the `jsonl-stream` dialect (the `json-rpc` dialect is supported by the same driver for conformance). It runs offline, imports only `@arnilo/prism`, `@arnilo/prism/driver-kit`, and `@arnilo/prism/testing`, and prints the run as JSON. The gate reads the JSON and asserts each Scope behavior. `--conformance` runs `driverConformance` on the same driver for both dialects.
      - `src/__tests__/external-agent-example.test.ts` spawns `--conformance` and asserts the legs (the test pattern of `revocation-propagation-example.test.ts`; importing the example from `src/` would break the `src` rootDir).
      - `src/driver-kit/__tests__/driver-kit.test.ts`: `system_prompt_takes_exactly_one_of_replace_or_append`.
      - `src/__tests__/docs.test.ts`: the example joins the `examples_demos_run_to_completion_and_emit_no_secret` demo list, with an assertion block for every Scope behavior. The separate `external_agent_example_shows_every_scope_behavior` name is folded into that gate.
      - `docs/next/drivers.md`: an Example section, the `systemPrompt` rule in Spec, the conformance `--hook-command` and key-mode notes, and the stale "staged in a later task" sentence removed. `docs/next/{loop,events,agent,host}.md` link to it (`events.md` gains a "Driver events" section).
      - `examples/README.md` line; `scripts/e2e-coverage.json` `@arnilo/prism` `./driver-kit` row; `CHANGELOG.md`; `scripts/compat-baseline/arnilo__prism.txt` (one sorted line for `assertSystemPromptShape`); `scripts/budgets.json` `@arnilo/prism` 1706 → 1707 (measured with `measureExportCounts`); `plans/README.md` (163 complete; 164 status below).
    - **Defect found by the example (Task 2):** `ExternalAgentSpec.systemPrompt` was a `oneOf` over object shapes. The package validator rejects every object under `oneOf` (reproduced: `{ replace: "x" }` fails with `unknown key "replace"` and `does not match any allowed shape`), so no driver could accept a `systemPrompt`. The schema now lists `replace` and `append` as optional with `additionalProperties: false`, and `driverPackage` setup enforces exactly one (`assertSystemPromptShape`, `src/driver-kit/spec.ts`). The kernel validator (`src/packages/schema.ts`) is not changed here; see Further Actions.
    - **Choices made while building the example:**
      1. Bridged tools go through the broker's MCP route. A raw `mcp.call` frame makes the driver post `tools/call` to `/mcp`, and `bridgeTools().invoke` runs it through `executeTools`, so `tool.call` fires. The scripted binary never receives the result, because the dialects do not model returning a tool result to the vendor.
      2. Resume: the example resumes through a new agent over the same store, as `examples/approval.ts` does. Re-entering the gate with the same call re-asks it (the conformance `resume` leg only checks re-entry), so the resumed process has nothing left to gate. The example therefore shows suspend → resume → `run.completed`, not re-execution of the approved call.
      3. Sign-in runs the login command for real in the profile home, through a scripted `terminal` answer (`spawnSync`). The status command checks a marker file, and the kit keeps only `signedIn`.
      4. Conformance runs under the key mode (`fixtures.mode: "key"`): the account mode needs a sign-in that conformance's `open()` does not perform. The key mode declares a protected path, so the canary leg runs.
      5. `json-rpc` skips `fail_closed`, a client-request dialect with no relay to break. The reference driver's test skips the same leg.
    - **Phase 13 Done record (evidence):**
      - `driverConformance` passes for the example on both dialects: `external_agent_example_passes_driver_conformance_on_both_dialects` passes. `jsonl-stream`: 13 of 13 legs passed. `json-rpc`: 12 passed, `fail_closed` skipped by design. **Met.**
      - Invariant tests pass from the default loop and from a driver loop: `hook-invariants`, `conformance-helpers`, `host-ui`, and `session-index` pass, 54 of 54, and they run against the default loop. The driver loop is covered by `driverConformance`'s `observe`, `gating`, `steer`, `abort`, and `resume` legs on both dialects. The invariant suites were not re-run against a driver loop. **Partly met.**
      - `storeConformance` with the K4 and K5 legs passes on every store: jsonl 42 of 42; sqlite 37 of 38, with the one failure `names the Bun runtime when the sqlite modules are imported under node`, the same pre-existing failure plan 163 and Task 1 record; Postgres 12 pass, 37 skipped, because `PRISM_POSTGRES_URL` is unset (recorded as skipped with that reason). The `session-index` suite runs `storeConformance` on the memory store and passes. **Met for jsonl and memory; sqlite has one pre-existing failure; Postgres skipped.**
      - No event carries `child`: `rg 'ChildEventOrigin|\bchild\?: '` over `src packages scripts examples docs/next` has one hit, `packages/tools/coding/src/agent/process/sessions-host.ts:73` (`child?: ChildProcessWithoutNullStreams`). It is a process handle, not an event origin, it predates this plan, and this plan did not touch it. **Met, with one non-event hit recorded.**
      - Canary: no kernel or driver-kit code path opens a declared protected credential path. `credential_canary` passes for the example's key mode, and Task 4's `credential_canary_never_opened` covers the account mode. This filesystem records no atime, so a silent read passes; the leg returns that limit as its reason. Protected paths in mode `0000` are caught only as `EACCES`, and root bypasses that mode. **Met, with the recorded limit.**
      - `driver_kit_names_no_vendor` passes (`src/__tests__/driver-kit-vendor-neutral.test.ts`). `rg -i '\b(claude|codex|agy|antigravity|gemini)\b'` over `src/driver-kit src/testing src/cli-relay.ts examples/external-agent.ts` has no hits. **Met.**
      - `bun run typecheck` is green. **Not met.** It fails in `@arnilo/prism-tools-web` (`src/obscura/__tests__/browser.test.ts`: TS2307, TS7006) and in `@arnilo/prism-tools-coding` (`src/security/approval.ts`: `ExecutionAction`, `ExecutionDecision`, `ExecutionPolicy`). Plan 163's baseline records the same two failures. `@arnilo/prism-core` typechecks clean (`bunx tsc --noEmit -p tsconfig.json` exits 0).
    - **Performance:** the example runs in about 4.5 s wall clock on an idle machine, under the 10 s bound. One run during a load average of about 27 took 46 s wall clock at 5% CPU, so it waited on the machine rather than working. Each gate call adds about 0.1 to 0.3 s.
    - **Checks:** see Verification results below.
  - Failure analysis (2026-10-11), the source of subtasks 8.1–8.4:
    - **`bun run typecheck`** fails in two workspaces. Every other workspace, `@arnilo/prism-core` included, exits 0.
      - T1, `@arnilo/prism-tools-coding`: `src/security/approval.ts:2` and `src/security/__tests__/approval.test.ts:7` import `ExecutionAction`, `ExecutionDecision`, and `ExecutionPolicy` from `@arnilo/prism`. Plan 155 Task 6 retired those kernel exports and moved them to the package-local `src/agent/execution-policy.ts:13,22,30`, whose header says so; these two imports were missed.
      - T2, `@arnilo/prism-tools-web`: `src/obscura/__tests__/browser.test.ts:12` imports `createBrowserTools` from `../../browser/index.js`, which no longer exists. `createBrowserTools` moved to `@arnilo/prism-tools-browser` (`packages/tools/browser/src/tools.ts:146`), and that package already carries the same composition test, `src/__tests__/obscura-compose.test.ts` (`tools_browser_composes_obscura_cdp`; 169 against 170 lines). tools-web cannot import tools-browser, which depends on it. The two TS7006 errors at `:120` and `:149` follow from the missing module.
    - **`node scripts/release.mjs gate`** reports only T1. `declarationDir` (`scripts/release-gates.mjs`) throws on the first failed declaration emit instead of collecting it, which hides every later package. Running each stage per package under Bun 1.4.2 (`release.validateIndependent`, `checkReleaseEvidence`, `runGates({ packageName, skipTarball })` for each of the 60 packages, and the tarball deny check) gives:
      - G1, release evidence, ranges, and tarball deny list: pass. `release-skip-manifest.mjs` and `check-client-neutrality.mjs` (the `release:gate` pre-steps) exit 0.
      - G2, declaration emit (1 package): `@arnilo/prism-tools-coding`, which is T1. The emit writes its own tsconfig (`types: ["node"]`, `nodenext`, no `extends`) instead of the package's, so emit and typecheck can disagree. It also leaves `<pkg>/.types/` behind after every run (gitignored, but stale).
      - G3, no compat baseline (17 packages): `prism-acp`, `prism-approval`, `prism-context-engineering`, `prism-context-files`, `prism-delegate`, `prism-devtools`, `prism-governance`, `prism-guardrail-packs`, `prism-mcp-server`, `prism-memory-compaction`, `prism-memory-core`, `prism-memory-fabric`, `prism-memory-observational`, `prism-memory-rag`, `prism-memory-wiki`, `prism-observability`, `prism-tools-browser`. These are native packages from Phases 2–10 that never got a reviewed baseline.
      - G4, surface diff against 0.12-era baselines (13 packages):
        - `@arnilo/prism`: the plan 158/159 moves (field policy, identity, attention compiler, guardrail packs, claim grounding, and others).
        - `prism-core`, `prism-coding-tools`, `prism-agent-sdk`, `prism-code`: 0.12 surfaces the train is deleting (roadmap §1595, §2378).
        - `prism-acp-agent`, `prism-ag-ui`, `prism-mcp`, `prism-channels`: host-library splits (ACP out of ag-ui, the MCP server out of mcp).
        - `prism-evals`, `prism-model-router`: changed type signatures only.
        - `prism-store-sqlite`, `prism-store-postgres`: `ADAPTER_INDEX_NAMES` changed.
        - The gate's own unit test, `compat baselines are current for every package with a built dist/` (`scripts/release-gate.test.mjs`), fails for the same reason (12 pass, 1 fail). Its message already prescribes the fix: review the removals against their owning plans, then regenerate.
      - G5, Node dependence in the gate path:
        - `scripts/release.mjs:1` has a `#!/usr/bin/env node` shebang.
        - The tarball stage runs `npm pack --dry-run --json` (`packedFilePaths`), and so do the root `pack:dry-run` script and 9 package `pack:dry-run` scripts, all run by `sdk:ready` before the gate.
        - Nine current-text lines prescribe `node scripts/release.mjs` (`.agents/skills/create-plan/SKILL.md`, `create-plan/references/prism.md`, `prism-execution/SKILL.md`, `prism-execution/references/release.md`, plus `CHANGELOG.md` and the released `docs/public-contracts.md`).
        - `bun run release:gate` already invokes the script with Bun.
      - G6, lockfile: the working-tree `bun.lock` (uncommitted, +693/−130 against HEAD) has 18 duplicate package keys, for example `@arnilo/prism-coding-tools/@arnilo/prism-core` and `@arnilo/prism-tools-coding/@arnilo/prism-core`. Bun refuses it: `bun pm pack` fails with `Duplicate package path` and `InvalidLockfile`. HEAD's `bun.lock` has none. A Bun tarball stage cannot run until it is regenerated.
  - Subtasks:
    - [x] Task 8.1: tools-coding imports its own execution-policy types (T1, G2)
      - Acceptance Criteria:
        - Functional: `src/security/approval.ts` and `src/security/__tests__/approval.test.ts` import `ExecutionAction`, `ExecutionDecision`, and `ExecutionPolicy` from `../agent/execution-policy.js` and `../../agent/execution-policy.js`. `bun run --filter @arnilo/prism-tools-coding typecheck` exits 0, and the package's declaration emit succeeds. Sweep: `rg 'Execution(Action|Decision|Policy)\b.*from "@arnilo/prism"' src packages apps scripts examples docs` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) has no hits.
        - Performance: n/a — type-only imports.
        - Code Quality: no re-export of the types from the kernel (plan 155 Task 6 retired them); no alias.
        - Security: n/a — no behavior change; the approval policy logic is untouched.
      - Approach: point the two imports at the package-local module that already owns the types. Re-adding the kernel export is rejected, because it reverses plan 155's retirement. Files: the two listed above.
      - Test Cases to Write: none new. The existing `src/security/__tests__/approval.test.ts` cases and the package typecheck are the proof; a wrong path fails the typecheck.
      - Documentation/Wiki Assessment: no public API change; docs none; `docs/index.md` no.
      - Notes (executed 2026-10-11):
        - Changed: `packages/tools/coding/src/security/approval.ts:2` now imports the three types from `../agent/execution-policy.js`; `packages/tools/coding/src/security/__tests__/approval.test.ts:7` imports `ExecutionAction` from `../../agent/execution-policy.js`. The package-local module's header (plan 155 Task 6) was checked: it owns all three types, so there is no re-export and no alias.
        - Typecheck: `bun run --filter @arnilo/prism-tools-coding typecheck` exits 0.
        - Declaration emit: the package has no `dist/`, so the compat stage takes the temp-tsconfig path (`release-gates.mjs:137-167`). Reproducing that exact `bun x tsc -p` config for this package exits 0. Temp config and `.types/` were removed afterwards.
        - Tests: `bun test src/security/__tests__/approval.test.ts` in the package, 13 pass, 0 fail.
        - Sweep: the literal `rg` over `src packages apps scripts examples docs` (with the plan's exclusions) finds no import hits. `apps/` does not exist at the repo root, so rg reports it as missing. The one match is `scripts/compat-baseline/arnilo__prism-agent-sdk.txt:3-39`, a generated 0.12 surface listing that shows `ExecutionPolicy` as an `@arnilo/prism` re-export of `prism-agent-sdk`. It is not an import. Task 8.3 (baseline regeneration, G4) owns it.
        - Baseline diff: none, because no export moved.
    - [x] Task 8.2: remove the duplicate Obscura composition test from tools-web (T2)
      - Acceptance Criteria:
        - Functional: `packages/tools/web/src/obscura/__tests__/browser.test.ts` is deleted. `bun run --filter @arnilo/prism-tools-web typecheck` exits 0. `packages/tools/browser/src/__tests__/obscura-compose.test.ts` still passes and covers what the deleted file asserted; any assertion only the old file made is moved into it first.
        - Performance: n/a.
        - Code Quality: tools-web keeps no import of tools-browser (no dependency cycle); no shim module at `src/browser/index.ts`.
        - Security: n/a.
      - Approach: diff the two files assertion by assertion, move anything missing into `obscura-compose.test.ts`, then delete the tools-web copy. Rejected: adding a tools-browser devDependency to tools-web, which creates a cycle; and restoring a `browser/` re-export in tools-web, which is an alias for a moved export.
      - Test Cases to Write: `tools_browser_composes_obscura_cdp` (existing) must still pass; extend it only with assertions the diff shows are missing.
      - Documentation/Wiki Assessment: no public API change; docs none; `docs/index.md` no.
      - Notes (executed 2026-10-11):
        - Changed: deleted `packages/tools/web/src/obscura/__tests__/browser.test.ts`.
        - Assertion diff: `diff` of the two files shows the bodies are identical apart from imports, the doc comment, and the test name (`connected Obscura browser composes into Prism browser tools end to end` versus `tools_browser_composes_obscura_cdp`). The tools-web copy imported `createBrowserTools` from the deleted `../../browser/index.js` and `connectObscuraCdp` from the local `../cdp.js`; the browser copy imports both from their packages (`../index.js`, `@arnilo/prism-tools-web`). Every assertion in the deleted file, including the browser-list, `browser_open`/`snapshot`/`evaluate`/`observe`/`close` calls, the page-closed check, and the `session.close()` `closeCount` check, is present in `obscura-compose.test.ts`, so nothing was moved.
        - Typecheck: `bun run --filter @arnilo/prism-tools-web typecheck` exits 0 (was TS2307 at `:12` and TS7006 at `:120`/`:149`).
        - Tests: `bun test src/__tests__/obscura-compose.test.ts` in `@arnilo/prism-tools-browser`, 1 pass, 0 fail.
        - Code Quality: no `packages/tools/web/src/browser/` shim; tools-web has no import of `@arnilo/prism-tools-browser` (only comments in `cdp.ts` and `mcp.ts` name it). No dependency cycle.
        - Baseline diff: none, because no export moved.
    - [x] Task 8.3: Bun-only release gate, with the gate fixes folded into the rewrite (G2–G6)
      - Acceptance Criteria:
        - Functional, runtime: `scripts/release.mjs` declares `#!/usr/bin/env bun`. The `gate` mode fails closed under any other runtime with a message naming `bun scripts/release.mjs gate` (`typeof Bun === "undefined"` → exit 1). `bun run release:gate` is the documented entry point.
        - Functional, error collection: the compat stage collects a declaration-emit failure per package, as it already does for diffs, so one run reports every failing package. The emit extends the package's own `tsconfig.json` (falling back to `tsconfig.packages.json`) instead of a hand-written `types: ["node"]` config. It removes `<pkg>/.types/` and the temp tsconfig in `finally`.
        - Functional, tarball: the tarball stage lists the files Bun packs (`bun pm pack --dry-run`, or `bun pm pack --destination <tmp>` plus a tar listing, whichever gives a stable file list on Bun 1.4.2) and keeps the deny list unchanged. The root `pack:dry-run` and the nine package `pack:dry-run` scripts use `bun pm pack --dry-run`. No `npm` call remains in the gate path; the sweep `rg -n '\bnpm (pack|run)\b' scripts/release-gates.mjs package.json packages/*/package.json packages/*/*/package.json` has no hits.
        - Functional, lockfile (prerequisite, G6): `bun.lock` is regenerated with `bun install`, and the gate's lock reader fails closed on a duplicate package key, naming the key, instead of leaving it to whatever Bun or the lock reader does next.
        - Functional, baselines (G3, G4): each of the 30 failing packages is reviewed. The 17 new packages get a baseline. The 13 diverging packages are regenerated with `bun scripts/release.mjs gate --update-baseline`; the task note lists each removal and attributes it to its owning plan (155, 158, 159, 160, 161, 162, 163, 164), or marks it inherited. The hand-added `arnilo__prism.txt` lines from plan 164 Tasks 2–8 are replaced by the generated file. The Task 6 (25 against 26) and Task 7 (24 against 21) export-count differences are reconciled in `scripts/budgets.json`. `compat baselines are current for every package with a built dist/` passes.
        - Functional, sweep (G5): every current-text `node scripts/release.mjs` reads `bun scripts/release.mjs` or `bun run release:gate`: the four skill files and the `[Unreleased]` section of `CHANGELOG.md`. Released `CHANGELOG.md` entries, `docs/public-contracts.md` (released `/docs` stays on 0.12.1 until Phase 11), `plans/`, `docs/history/`, `docs/_evidence/`, and the frozen `scripts/phase*-baseline.json` evidence are left as written.
        - Functional, end state: `bun run release:gate` exits 0 on a clean tree.
        - Performance: the gate run time does not grow beyond today's full-run cost. Emit failures no longer short-circuit, so measure and record the before and after time in the note.
        - Code Quality: `scripts/release-gates.mjs` stays stdlib plus Bun built-ins; no new dependency. `publish`, `check`, `bump`, and `changed` keep their behavior. Only the gate path and the pack scripts change.
        - Security: the gate still fails closed on a removed or changed export without `--allow-break`, on a missing baseline, on a denied tarball path, and on blocked release evidence. A tarball listing failure is an error, never an empty pass.
      - Approach:
        - Documentation Reviewed: `scripts/release.mjs:1-17,499-611`; `scripts/release-gates.mjs` (`declarationDir`, `packedFilePaths`, `runGates`); `scripts/release-gate.test.mjs:199-221`; `docs/release-and-install.md:499-512` (gate description; a released page, so its tarball line changes only in Phase 11); `.github/workflows/release.yml:43-77` (already `bun run release:gate`); `bun pm pack --help` on Bun 1.4.2 (`--dry-run`, `--destination`, no `--json`).
        - Options Considered:
          - Keep Node for the tarball stage. Rejected: Prism targets Bun only.
          - Re-implement npm's packlist rules in JavaScript. Rejected: it would drift from what the packer actually includes.
          - Regenerate every baseline blind. Rejected: removals must be attributed, and `release-gate.test.mjs` already demands a review.
          - Exclude the 0.12 packages the train deletes (`prism-core`, `prism-coding-tools`, `prism-agent-sdk`, `prism-code`) from the gate. Rejected for now: they still ship until Phase 11, so their breaks are regenerated and attributed like the others.
        - Chosen Approach, in order:
          1. Make the gate collect errors and clean up `.types`, so one run reports everything.
          2. Regenerate `bun.lock` and add the duplicate-key check.
          3. Swap the tarball listing and the pack scripts to Bun.
          4. Add the runtime guard and shebang.
          5. Review and regenerate the baselines.
          6. Run the sweep.
        - Decided by the owner (2026-10-11): publication moves to `bun publish` (Task 8.4). The gate's tarball stage therefore packs with `bun pm pack --destination <dir>` and lists the resulting `.tgz` files. Those are the same tarballs Task 8.4 attests and publishes, so the deny check inspects exactly the bytes the registry receives.
        - API Notes and Examples:
          ```bash
          bun run release:gate
          bun scripts/release.mjs gate --update-baseline   # after review
          node scripts/release.mjs gate                    # exits 1: "release gate runs on Bun only: bun scripts/release.mjs gate"
          ```
        - Files to Create/Edit:
          - `scripts/release.mjs`: shebang, Bun guard on `gate`.
          - `scripts/release-gates.mjs`: emit collection and cleanup, emit extends the package tsconfig, Bun tarball listing.
          - `scripts/bun-lock.mjs`: duplicate-key check.
          - `bun.lock`: regenerated.
          - `packages/integrations/hooks-json/tsconfig.json`: corrected `extends` path (prerequisite, see Notes).
          - `package.json` and the nine package `package.json` `pack:dry-run` scripts.
          - `scripts/compat-baseline/*.txt`: 17 new, 13 regenerated.
          - `scripts/budgets.json`: export-count reconciliation.
          - `scripts/release-gate.test.mjs`: new tests.
          - `.agents/skills/create-plan/SKILL.md`, `.agents/skills/create-plan/references/prism.md`, `.agents/skills/prism-execution/SKILL.md`, `.agents/skills/prism-execution/references/release.md`: the gate command.
          - `CHANGELOG.md` `[Unreleased]`.
        - References: plan 125 Task 5 (npm kept as the registry toolchain); plan 083 (the missed regeneration that first turned `release:gate` red); plan 155 Task 6.
      - Test Cases to Write (in `scripts/release-gate.test.mjs`, written before the rewrite):
        - `gate_refuses_non_bun_runtime`: spawn `node scripts/release.mjs gate` and expect exit 1 naming the Bun command. Fails if the guard is removed.
        - `gate_collects_every_emit_failure`: two fixture packages with broken source; one run reports both. Fails if `declarationDir` throws again.
        - `gate_cleans_types_dir`: no `.types/` remains after a run, pass or fail.
        - `gate_tarball_lists_with_bun`: a fixture package with an `__tests__/` file in `files` is denied, through the Bun listing. Fails if the listing returns empty.
        - `gate_rejects_duplicate_lock_keys`: a lock fixture with a duplicated key fails, naming the key.
        - The existing `compat baselines are current for every package with a built dist/` passes after the regeneration.
      - Documentation/Wiki Assessment:
        - Public API or behavior impacted: release tooling only; no package API.
        - Docs pages to create/edit: the four skill files and `CHANGELOG.md` `[Unreleased]`. `docs/release-and-install.md` keeps its npm tarball line until Phase 11 (released page); record that in Further Actions.
        - `docs/index.md` update: no.
        - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      - Notes (executed 2026-10-11):
        - Runtime: `scripts/release.mjs:1` is `#!/usr/bin/env bun`; the `gate` branch fails closed under any other runtime (`typeof Bun === "undefined"` → stderr `release gate runs on Bun only: bun scripts/release.mjs gate`, exit 1) before the evidence preflight. `bun run release:gate` stays the documented entry point.
        - Emit collection and cleanup: `declarationDir` (`scripts/release-gates.mjs:143`) returns `{ distDir }`, `{}`, or `{ error, cleanup }` instead of throwing, and `runGates` pushes the error and continues, so one run names every failing package. The temp config extends the package's own `tsconfig.json` (fallback `tsconfig.packages.json`) instead of a hand-written `types: ["node"]` config; `<pkg>/.types/` and `.types-tsconfig.json` are removed in the loop's `finally`.
        - Tarball: `packedFilePaths` packs with `bun pm pack --destination <tmp>` and lists the real `.tgz` with `tar -tzf`, stripping the `package/` prefix; the deny patterns are unchanged. The root and nine package `pack:dry-run` scripts use `bun pm pack --dry-run`. Sweep `rg -n '\bnpm (pack|run)\b' scripts/release-gates.mjs package.json packages/*/package.json packages/*/*/package.json` has no hits.
        - Lockfile: `bun.lock` regenerated with `bun install --lockfile-only` (Bun reported `InvalidLockfile: Duplicate package path`); no duplicate-key warnings remain. `duplicateLockKeys` in `scripts/bun-lock.mjs` scans strings and object nesting; `parseBunLock` fails closed naming the key (`bun.lock has duplicate keys: <key>`).
        - Baselines: regenerated with `PRISM_RELEASE_POSTGRES_JOB=1 bun scripts/release.mjs gate --update-baseline --skip-tarball` (60 packages, no emit failures). 22 baselines are new on disk (the native packages from Phases 2–10: acp, approval, context-engineering, context-files, delegate, devtools, governance, guardrail-packs, mcp-server, memory-compaction, memory-core, memory-fabric, memory-observational, memory-rag, memory-wiki, observability, tools-browser, tools-coding, tools-computer-use, tools-openapi, tools-web, tools-work) and 14 are modified (not the plan's 17/13 split). The hand-added `arnilo__prism.txt` lines from Tasks 2–8 are replaced by the generated file.
        - Baseline diff (removed/changed/added), attributed: `arnilo__prism.txt` 183/102/96 — plan 155 (execution policy), 158 (context engineering), 159 (governance, field policy/evidence, claim grounding, identity, guardrail packs), 160 (delegate/supervisor, model-router, observability, evals); the changed set is the Phase 13 kernel primitives (plans 163/164). `arnilo__prism-agent-sdk.txt` 2/8/0 — plan 155 Task 6 (`ExecutionPolicy`, `applyMcpApprovalPolicy`) plus plan 161/163 signatures. `arnilo__prism-code.txt` 21/48/13 — plan 161 ACP launcher split. `arnilo__prism-coding-tools.txt` 906/0/0 — plan 160 Task 4 supervisor removal and plan 161 host moves. `arnilo__prism-core.txt` 342/55/6 — plan 159 governance/policy and plan 160 model-router/supervisor/observability/evals. `arnilo__prism-acp-agent.txt` 13/0/2 — plan 161 Task 3 thin launcher. `arnilo__prism-ag-ui.txt` 85/12/0 — plan 161 Task 4 ACP split and host library. `arnilo__prism-channels.txt` 5/36/19 — plan 161/163 host library. `arnilo__prism-evals.txt` 0/34/44 — plan 160 package. `arnilo__prism-mcp.txt` 17/24/25 — plan 159 Task 3 server split. `arnilo__prism-model-router.txt` 0/19/11 — plan 160 Task 2. `arnilo__prism-store-codecs.txt` 0/0/4. `arnilo__prism-store-postgres.txt` and `arnilo__prism-store-sqlite.txt` 0/1/1 — `ADAPTER_INDEX_NAMES`.
        - budgets.json: Task 6's `HookDecision` was already an exported kernel hook-bus type (`src/hooks/types.ts:224`), so the counter's delta is 25 against 26 declared names; Task 7's extra 3 are `ReferenceDriverOptions`, `referenceConfig`, and `referenceDriver` in `src/testing/__tests__/reference-driver.ts` (the counter measures all of `src`, tests included). Both notes now state this instead of "not reconciled".
        - Sweep (G5): the four skill files now read `bun scripts/release.mjs`; `CHANGELOG.md` `[Unreleased]` gains the entry. Released `CHANGELOG.md` lines, `docs/history/`, `docs/_evidence/`, `plans/`, and `docs/public-contracts.md` are left as written.
        - Prerequisite: `packages/integrations/hooks-json/tsconfig.json` extended `../../tsconfig.packages.json`, which resolves to the missing `packages/tsconfig.packages.json`. The emit-extends-package-tsconfig change surfaced it, so the path is corrected to `../../../tsconfig.packages.json`.
        - Tests: `bun test scripts/release-gate.test.mjs` 18 pass, 0 fail, including the five new cases `gate_refuses_non_bun_runtime`, `gate_collects_every_emit_failure`, `gate_cleans_types_dir`, `gate_tarball_lists_with_bun`, and `gate_rejects_duplicate_lock_keys`.
        - Checks: `bun run typecheck` exits 0 (all 25 workspaces). `bun run pack:dry-run` exits 0. `bun test scripts/budget-gate.test.mjs -t "dry pack ships every docs/index.md page"` and `bun test scripts/phase15-freeze.test.mjs -t "phase-review docs are archived"` pass on the Bun listing. `PRISM_RELEASE_POSTGRES_JOB=1 bun run release:gate` exits 0, 60 packages, in 10.97s. Without the CI marker the evidence preflight blocks on `PRISM_TEST_POSTGRES_URL` (pre-existing fail-closed behavior; the release workflow sets it and `PRISM_RELEASE_POSTGRES_JOB=1` at `.github/workflows/release.yml:75`).
        - Performance: the compat-only run (60 declaration emits) took 7.0s; the full gate (60 emits + 60 tarball packs) 10.3–11.0s. Before the rewrite the gate aborted at the first declaration emit (`@arnilo/prism-tools-coding`) and never reached the tarball stage, so there is no comparable full-run before time.
        - Findings affecting later tasks: `bun test scripts/budget-gate.test.mjs -t "per-package export counts"` still fails on the pre-existing `@arnilo/prism-tools-coding` (913 vs 911) and `@arnilo/prism-channels` (123 vs 106) ceilings, stale since plans 157/161 and not touched here; `scripts/version-literal-gate.test.mjs`'s positive control expects 58 manifests against the real 60. Both are recorded in Further Actions.
    - [x] Task 8.4: publish with `bun publish` from the prepacked, attested tarballs (owner decision 2026-10-11)
      - Acceptance Criteria:
        - Functional, registry: packages still go to the npm registry (`registry.npmjs.org`, overridable with `--registry`). Only the client changes. `runRelease` (`scripts/release.mjs:396-463`) publishes each package with `bun publish <release-artifacts/<pkg>.tgz> --access public --tag latest`, in the existing topological order, keeping `--resume` and the publish report. `--dry-run` maps to `bun publish --dry-run`. `publishArgs` loses `--provenance`.
        - Functional, release job (`.github/workflows/release.yml:236-288`):
          - Tarballs are produced once with `bun pm pack --destination release-artifacts` per package, replacing `npm pack --json` and `npm pack --workspaces --json`.
          - `SHA256SUMS`, the secret scan of the unpacked tarballs, the prism-code install smoke, and `actions/attest-build-provenance` all run on those files.
          - The publish step publishes the same files.
          - A test asserts the publish step names a tarball path from `release-artifacts/`, never a package directory, so the attested bytes are the published bytes.
        - Functional, SBOM: `npm sbom` (`release.yml:187,244`) is replaced by a stdlib Bun script that writes SPDX JSON from `bun.lock` plus each installed package's `package.json` `license`. `scripts/verify-sbom.mjs` and `security/license-policy.json` accept its output unchanged. A package with no declared license fails `verify-sbom`, as it does today.
        - Functional, auth: publishing reads the existing `NPM_TOKEN` through `.npmrc` (`release.yml:276-283`). The `${NODE_AUTH_TOKEN}` reference keeps its name, or is renamed with every reference swept. No Node or npm binary is invoked anywhere in the release workflow or `scripts/release*.mjs`; the sweep `rg -n '\bnpm (publish|pack|sbom|view)\b' scripts .github package.json packages/*/package.json packages/*/*/package.json` has no hits outside comments that record history.
        - Functional, retirement: the npm-gap records go: the `scripts/release.mjs:8-12` comment, `release.yml:183,231-232`, and the `tooling-gate.test.mjs:294,401` pins on `bun pack` and `--provenance` as an npm-only gap. They are rewritten to record the new contract: Bun packs and publishes, and provenance is GitHub build attestation.
        - Performance: one pack per package per release (today the tarballs are packed twice, once by `npm pack` and again by `npm publish`).
        - Code Quality: no new dependency; the SBOM writer is stdlib plus Bun built-ins. `check`, `bump`, `changed`, and `gate` keep their behavior.
        - Security:
          - **Accepted loss:** npm registry provenance (the sigstore statement npm attaches with `--provenance`, shown on npmjs.com and checked by `npm audit signatures`). Bun 1.4.2 has no provenance flag (`bun publish --help`).
          - **Kept:** GitHub build-provenance attestations on the exact published tarballs and SBOM, verifiable with `gh attestation verify`. The release notes and `docs/next` release page say consumers verify there.
          - A publish of anything but a tarball attested in the same job fails. `--resume` still compares the registry manifest (`registryManifest`, a `fetch`, no npm) before skipping a version.
      - Approach:
        - Documentation Reviewed: `bun publish --help` and `bun pm pack --help` on Bun 1.4.2 (`[dist]` tarball argument, `--access`, `--tag`, `--dry-run`, `--registry`, `--otp`; no `--provenance`); `scripts/release.mjs:8-12,374-463`; `.github/workflows/release.yml:176-288`; `scripts/verify-sbom.mjs`; `scripts/release-gate.test.mjs:132-143`; `scripts/tooling-gate.test.mjs:294,401-411`.
        - Options Considered:
          - `bun publish` from each package directory. Rejected: Bun repacks, so the attested tarball and the published one could differ, which is today's npm weakness.
          - Keep npm only for publishing. Rejected by the owner: Prism targets Bun only.
          - Drop the SBOM. Rejected: `verify-sbom.mjs` enforces the license policy on every release.
        - Chosen Approach: pack once with Bun, then check, scan, smoke-test, attest, and publish those tarballs. Generate the SBOM from `bun.lock`.
        - API Notes and Examples:
          ```bash
          bun pm pack --destination release-artifacts            # in each package directory
          bun publish release-artifacts/arnilo-prism-0.13.0.tgz --access public --tag latest
          gh attestation verify release-artifacts/arnilo-prism-0.13.0.tgz --owner <github-owner>
          ```
        - Files to Create/Edit:
          - `scripts/release.mjs`: `publishArgs`, `runRelease`, and the header comment.
          - `scripts/sbom.mjs` (new): the SPDX writer.
          - `.github/workflows/release.yml`: pack, sbom, and publish steps; drop the `id-token: write` permission only if attestations no longer need it (`attest-build-provenance` does need it, so it stays).
          - `scripts/release-gate.test.mjs`, `scripts/tooling-gate.test.mjs`: the provenance and npm-gap pins.
          - `.agents/skills/prism-execution/references/release.md`.
          - `CHANGELOG.md` `[Unreleased]`.
          - `docs/next` release page (tentative: whichever staged page owns publishing; `docs/release-and-install.md` is released and changes in Phase 11).
          - `.github/workflows/security.yml`: the supply-chain SBOM and pack steps.
          - `security/license-policy.json`: the `jszip` override follows the locked version.
          - `scripts/budget-gates.mjs`, `scripts/packaging-current.test.mjs`, `scripts/fixtures/packed-consumer.mjs`, `scripts/post-publish-smoke.mjs`, `scripts/prism-code-install-smoke.mjs`: `npm pack` → `bun pm pack`.
          - `docs/next/release.md` (new): the staged pipeline and provenance page.
          - `src/__tests__/release.test.ts`, `src/__tests__/docs.test.ts`: the `publishArgs` and provenance assertions.
          - `docs/host-security.md`: the supply-chain fixture sentence.
        - References: plan 125 Task 5 (the npm decision this reverses); plan 140 Task 2 (install smoke on the packs).
      - Test Cases to Write:
        - `publish_uses_bun_with_prepacked_tarball`: `publishArgs` starts with `publish`, names a `.tgz` path, and never contains `--provenance`. Replaces `publish provenance flag is mandatory in CI and detectable when missing in dry run`. Fails if a package directory or npm sneaks back in.
        - `release_workflow_publishes_attested_tarballs`: parse `release.yml`; the publish step's inputs are the `release-artifacts/*.tgz` that the attest step names. Fails if publish repacks.
        - `release_workflow_runs_no_npm`: no `npm ` command in `release.yml` run blocks.
        - `sbom_from_bun_lock_passes_license_policy`: the generated SPDX passes `verify-sbom.mjs`. A fixture with an undeclared license fails it.
      - Documentation/Wiki Assessment:
        - Public API or behavior impacted: release process only, but consumers verify provenance differently (GitHub attestation instead of npm provenance).
        - Docs pages to create/edit: the `docs/next` release page (how to verify a package); `.agents/skills/prism-execution/references/release.md`; `CHANGELOG.md`. `docs/release-and-install.md` changes in Phase 11.
        - `docs/index.md` update: no.
        - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      - Notes (executed 2026-10-11):
        - Publish: `publishArgs(pkg, version, { dryRun, registry, artifactsDir })` names `release-artifacts/<tarball>` (the `bun pm pack` name: `@arnilo/prism@0.13.0` → `arnilo-prism-0.13.0.tgz`), keeps `--access public --tag latest`, adds `--registry` only when given, and has no `--provenance`. `runRelease` spawns `bun publish` and fails with `bun publish failed for <name>`; `--dry-run` maps through. A new `pack` mode (`bun scripts/release.mjs pack --destination <dir>`) runs `bun pm pack --destination <dir>` in every release package, root included; verified 60 tarballs, every name matching `tarballName`.
        - Workflow: `release.yml` packs once with `release.mjs pack`, writes checksums, generates the SBOM with `scripts/sbom.mjs`, verifies it, secret-scans the unpacked tarballs, smoke-installs, attests the `.tgz` files and the SBOM, then publishes those same files. `security.yml`'s supply-chain job uses `scripts/sbom.mjs` and `release.mjs pack`. Neither workflow invokes npm; `.npmrc`'s `${NODE_AUTH_TOKEN}` is expanded by Bun (verified: `bun publish --dry-run <tarball>` reads an `.npmrc` token, and reports missing authentication without one).
        - SBOM: `scripts/sbom.mjs` walks `bun.lock`'s `packages` map, resolving each logical key to its `node_modules` path (scoped/nested segments consumed two-at-a-time) or its `@workspace:`/`@root:` directory, reads the installed `package.json`, and emits SPDX 2.3 with `name`/`versionInfo`/`licenseDeclared` (missing license → `NOASSERTION`). 261 installed packages; `verify-sbom.mjs` passes. A platform-optional package with no installed `package.json` is skipped, as `npm sbom` does.
        - Policy: `security/license-policy.json`'s `jszip` override moves from `3.10.1` to the locked `3.10.2`; the old key matched no installed package, so the policy could not accept the real tree.
        - Retirement: the `release.mjs` header comment, the `release.yml` npm-toolchain comments, and the `tooling-gate.test.mjs` `bun pack`/`--provenance` pins are rewritten to the Bun-only contract. That test's npm scanner now expects only the plan 054 legacy path (`view`/`dist-tag`/`deprecate`); `NODE_SPAWN_EXCEPTIONS` gains `scripts/release-gate.test.mjs` (the Task 8.3 wrong-runtime probe) and the moved `packages/tools/coding/.../docker-sandbox.test.ts` path. `src/__tests__/release.test.ts` and `src/__tests__/docs.test.ts` assert the new `publishArgs` shape and the absence of `--provenance`, and `docs/host-security.md`'s supply-chain sentence follows.
        - Sweep: `rg -n '\bnpm (publish|pack|sbom|view)\b' scripts .github package.json packages/*/package.json packages/*/*/package.json` now hits only comments, test fixtures that spell the retired shapes, and the plan 054 legacy path (`phase54-legacy-registry.mjs` and `npm-deprecate.yml` use `npm view`/`npm dist-tag`/`npm deprecate`, which Bun 1.4.2 lacks). `release.mjs` and `release.yml` have no npm call.
        - Tests: `bun test scripts/release-gate.test.mjs` 21 pass — the provenance test is replaced by `publish_uses_bun_with_prepacked_tarball`, and `release_workflow_publishes_attested_tarballs`, `release_workflow_runs_no_npm`, and `sbom_from_bun_lock_passes_license_policy` are new. `bun test scripts/budget-gate.test.mjs -t "root tarball"` passes with the Bun `measureRootPack` (packed 1714737, unpacked 5719463, 671 files — inside the +5% band). `bun test --timeout=0 scripts/packaging-current.test.mjs`: 183 pass, 2 pre-existing failures (`acp-agent` `parseConfig` was removed in plan 161; the install-smoke hand list no longer names `@arnilo/prism-delegate`).
        - Docs: new staged `docs/next/release.md` (Bun-only pipeline, `gh attestation verify`, legacy deprecation) and the skill's Publishing bullet rewritten. `docs/release-and-install.md` still describes npm provenance and changes in Phase 11 (Further Actions).

## P1 kernel validator (executed 2026-10-11)

- **Root cause.** `src/packages/schema.ts` ran the object shape keywords (`properties`, `additionalProperties`, `required`) before the `oneOf`/`anyOf` branches. A pure combinator node (`{ oneOf: [...] }`) declares no `properties`, so `additionalProperties` defaulted to `false` and every key failed `unknown_key` before a branch could match. Object branches were unusable: `{ replace: "x" }` failed with `unknown key "replace"` then `does not match any allowed shape`.
- **Fix.** The object branch now runs only when the node declares an object (`type: "object"`, `properties`, `additionalProperties`, or `required`). A combinator-only node leaves the value to its branches; a node that does declare an object keeps the fail-closed `additionalProperties: false` default. `anyOf` object branches were broken the same way and are fixed by the same gate.
- **Schema restored.** `externalAgentSpecSchema`'s `systemPrompt` is a `oneOf` over `{ type: "object", properties: { replace: { type: "string" } }, required: ["replace"], additionalProperties: false }` and the `append` twin. Unknown key, both keys, and neither all fail.
- **`assertSystemPromptShape` deleted.** The schema is now authoritative, so the setup-time workaround (`src/driver-kit/spec.ts`, its `define.ts` call, and the `DriverError` import) is removed. It also only ever covered the top-level spec, while the schema covers every sub-agent spec. Export count 1707 → 1706; `scripts/budgets.json` and `scripts/compat-baseline/arnilo__prism.txt` follow.
- **Tests.** `src/__tests__/package-config.test.ts` gains object `oneOf`/`anyOf` cases plus the `{ type: "object" }` fail-closed control; `src/driver-kit/__tests__/driver-kit.test.ts` gains the empty-object and sub-agent rejections. `docs/next/drivers.md` and `CHANGELOG.md` follow.
- **Evidence.** `bun test --timeout=0 src/__tests__/package-config.test.ts` 9 pass; `bun test --timeout=0 src/driver-kit/__tests__/` 94 pass; `bun run typecheck` exit 0; `PRISM_RELEASE_POSTGRES_JOB=1 bun scripts/release.mjs gate --skip-tarball` exit 0 (60 packages, no removals); `bun test --timeout=0 src/__tests__/external-agent-example.test.ts` 1 pass; `measureExportCounts` reports `@arnilo/prism` 1706.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/driver-kit/__tests__/`
- `bun test --timeout=0 src/__tests__/driver-kit-vendor-neutral.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/core-boundaries.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts src/__tests__/agent-surface-freeze.test.ts`
- `bun test --timeout=0 src/__tests__/hook-invariants.test.ts src/__tests__/conformance-helpers.test.ts src/__tests__/host-ui.test.ts src/__tests__/session-index.test.ts`
- `cd packages/stores/jsonl && bun run test`; `cd packages/stores/sqlite && bun run test`; `cd packages/stores/postgres && bun run test` (plus `bun run test:postgres:run` with `PRISM_POSTGRES_URL`, else recorded as skipped)
- `bun examples/external-agent.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun test --timeout=0 scripts/release-gate.test.mjs`
- `bun run release:gate` (Bun only after Task 8.3; it was `node scripts/release.mjs gate` before)
- `rg -n -i '\b(claude|codex|agy|antigravity|gemini)\b' src/driver-kit src/testing src/cli-relay.ts` (no hits)
- `rg -n 'ChildEventOrigin|\bchild\?: ' src packages scripts examples docs/next -g '!**/dist/**' -g '!**/node_modules/**'` (no hits)

### Verification results (2026-10-11)

- `bun run build:core`: passes (exit 0).
- `bun run typecheck`: fails only in `@arnilo/prism-tools-web` and `@arnilo/prism-tools-coding`, the pre-existing failures from plan 163. `@arnilo/prism-core` passes.
- `bun test --timeout=0 src/driver-kit/__tests__/`, `src/testing`, and `src/__tests__/external-agent-example.test.ts`, with `driver-kit-vendor-neutral.test.ts`: 65 pass, 0 fail.
- Export contract, boundaries, vendor-neutral, kernel imports, and surface freeze: 126 pass, 1 fail. The failure is `core-boundaries`: `src/contracts.ts mentions workflow`, which plan 164 Tasks 2, 6, and 7 each recorded as pre-existing.
- `hook-invariants`, `conformance-helpers`, `host-ui`, `session-index`: 54 pass, 0 fail.
- Stores: jsonl 42 pass; sqlite 37 pass, 1 fail (the pre-existing `names the Bun runtime` test); postgres 12 pass, 37 skipped (`PRISM_POSTGRES_URL` unset).
- `bun examples/external-agent.ts`: exit 0, about 4.5 s wall clock on an idle machine.
- `src/__tests__/docs.test.ts`: 164 pass, 6 fail. `examples_demos_run_to_completion_and_emit_no_secret` passes, including the new example. The six failures sit outside this plan: the `docs/multi-agent-patterns.md` link to `examples/spawn-agent-tool.ts`, the phase 54 evidence count (35 of 36), the `ManifestContributionKind` export, and the `RunOptions` per-run tools and `activeSkills` doc checks. Task 6 recorded the same failure count.
- `node scripts/release.mjs gate`: fails at the compat declaration emit of `@arnilo/prism-tools-coding` (`ExecutionAction`, `ExecutionDecision`, `ExecutionPolicy`), the plan 163 baseline failure. The gate does not reach its later stages.
- Sweeps: vendor names over `src/driver-kit src/testing src/cli-relay.ts examples/external-agent.ts`: no hits. `ChildEventOrigin` and `child?:`: one non-event hit (see the Done record).

## Compromises Made

- **Phase 13 Done is not fully met.** `bun run typecheck` and `node scripts/release.mjs gate` fail on the pre-existing `@arnilo/prism-tools-web` and `@arnilo/prism-tools-coding` errors from plan 163. Plan 164 did not fix them, because they are outside its scope.
- **The "driver loop" invariant criterion is partly met.** The invariant suites run against the default loop. The driver loop is covered by `driverConformance`'s observe, gating, steer, abort, and resume legs, not by re-running the invariant suites on it.
- **The canary sees less on this filesystem.** It records no atime, so a silent read of a protected path passes. The leg reports that as its reason, and mode `0000` catches only a non-root read as `EACCES`.
- **The systemPrompt one-of rule is enforced by the schema (resolved 2026-10-11, P1).** The kernel validator now checks object branches under `oneOf`, `externalAgentSpecSchema` restores the `oneOf` over `{ replace }`/`{ append }`, and `assertSystemPromptShape` is deleted.
- **Bridged tool results do not reach the vendor.** The scripted dialects do not model returning a result, so the example shows the bridge runs through `executeTools` without the binary consuming the result.
- **Resume shows suspend → resume → completed, not re-execution.** The resumed process has no gated call left, so the approved write is not re-run.
- **The compat baseline and budgets were edited by hand.** `node scripts/release.mjs gate --update-baseline` is blocked by the tools-coding typecheck. The export counts from Tasks 6 and 7 (25 against 26 declared names, 24 against 21) are still unreconciled.
- **Postgres K4/K5 legs were not run.** `PRISM_POSTGRES_URL` is unset, so they are recorded as skipped.
- **`json-rpc` skips `fail_closed`.** It is a client-request dialect with no relay, as the reference driver test also skips it.

## Further Actions

- **P1, kernel validator (resolved 2026-10-11).** `src/packages/schema.ts` no longer rejects object branches under `oneOf`/`anyOf`; `externalAgentSpecSchema`'s `systemPrompt` is a `oneOf` over the two object shapes, and `assertSystemPromptShape` is deleted. See the P1 kernel validator section above.
- **P1, green typecheck and gate.** Moved into this plan as Task 8.1, 8.2, 8.3, and 8.4 (2026-10-11).
- **P2, publication packer (resolved 2026-10-11, Task 8.4).** Publication moves through `bun publish` from prepacked, attested tarballs; npm registry provenance is given up and GitHub build attestations remain. Nothing further owed.
- **P2, Phase 11 registry operations without npm.** `npm deprecate` and `npm dist-tag` have no Bun command on 1.4.2. Phase 11 deprecates the 0.12 family packages, so it needs either the npm registry HTTP API from a stdlib script (with the same `NPM_TOKEN`) or a recorded manual step.
- **P3, released gate docs.** `docs/release-and-install.md` still describes the tarball stage as `npm pack --dry-run --json`, the release workflow as npm with `--provenance`, and the SBOM as `npm sbom`. Update it in the Phase 11 publish pass; the staged `docs/next/release.md` already carries the Bun-only contract.
- **P2, driver loop invariants.** Run the invariant suites against a driver package's loop, so the "from a driver loop" criterion is verified and not inferred.
- **P2, Postgres record.** Run `bun run test:postgres:run` with `PRISM_POSTGRES_URL` set, to record the K4/K5 legs on Postgres.
- **P2, canary on atime-less filesystems.** Give the canary a check that does not depend on atime, or run conformance on a filesystem that records atime in CI.
- **P2, Phase 14.** Replace the example's MCP route with `serveTools` (`createPrismMcpWebHandler`). The example's bridged-tool path is the template for Phase 14.
- **P3, sweep naming.** Rename the `child?:` handle in `packages/tools/coding/src/agent/process/sessions-host.ts`, or narrow the sweep to exclude process handles, so the event sweep runs clean.
- **P3, pre-existing docs and boundary failures.** Fix the six `docs.test` failures and the `src/contracts.ts mentions workflow` boundary, all outside this plan.
- **P3, broker token coverage.** `broker_token_never_in_events_or_inspect` checks `relay.json`, `inspect()`, and a 401 body, but it does not subscribe to events. Add a subscription check.
- **P3, pre-existing budget and version-literal drift.** `bun test scripts/budget-gate.test.mjs -t "per-package export counts"` fails on `@arnilo/prism-tools-coding` (913 vs 911) and `@arnilo/prism-channels` (123 vs 106), stale since plans 157/161 and not touched by this plan; `scripts/version-literal-gate.test.mjs`'s positive control expects 58 manifests against the real 60. Rebaseline the two export ceilings with attribution and update the manifest count, outside this plan.
