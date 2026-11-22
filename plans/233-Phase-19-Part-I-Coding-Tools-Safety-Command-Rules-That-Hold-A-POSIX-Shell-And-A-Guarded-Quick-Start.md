# Phase 19 Part I — coding tools safety: command rules that hold, a POSIX shell, and a guarded quick start

## Objectives

- Make `commandRules` do what the docs say. `evaluateCommandRules` returns at the first configured rule that matches (`packages/tools/coding/src/security/command-rules.ts:41`), so an `allow` rule shadows the built-in denies. Probe `p7-rules`: with `{ match: "git", decision: "allow" }`, `git status && sudo rm -rf /` was allowed. The README says the built-ins "always apply and cannot be bypassed".
- Honor the documented `/pattern/` form of `match`. The config doc allows it (`packages/tools/coding/src/config.ts`, `ToolsCodingCommandRule`), but `toCommandRules` passes the string through as a literal substring (`packages/tools/coding/src/index.ts:79`), so such a deny rule never fires.
- Stop presenting the built-in pattern list as stronger than it is. `rm -fr /`, `doas`, `su -c`, and a pipe into `zsh` all pass it (same probe).
- Run model-written commands in a POSIX shell. `getShellConfig` uses `$SHELL` first (`packages/tools/coding/src/agent/shell.ts:126`); under fish or nushell, ordinary bash syntax fails.
- Stop the quick start from running unguarded. `coding({ root })` registers `shell`, `write`, and `edit` on the host with `sandbox: "none"` (`config.ts:230`) and no approval; the only signal is a `warn` status note (`packages/tools/coding/src/index.ts`, end of `setup`).

## Expected Outcome

- Every rule that matches is considered, and the strictest decision wins: `deny`, then `requireApproval`, then `allow`. The built-in denies are evaluated first and no rule can override them.
- A `match` written as `/pattern/flags` is compiled as a regular expression at setup; an invalid one fails the load. Any other string stays a substring match.
- The built-in list catches the reordered and renamed forms above, and the README says plainly that it is a tripwire and the sandbox is the control.
- `shell` runs in `bash` when present, else `sh`; `$SHELL` is used only when it is a POSIX-family shell. `shell.path` overrides.
- With `sandbox: "none"` and no policy package loaded, `shell` and writes outside the roots ask through `tool.call`. Installing `@arnilo/prism-extensions/approval` or `governance` hands the decision to that package.

This plan implements roadmap **Phase 19 Part I**. It changes one package's config semantics and adds a small service handshake between packages; it adds no kernel contract and creates no package, so **there is no phase review task**. Each task's assumptions are cited from code read on 2026-11-13. It runs after plan 232. No version bump or publish.

Cost knobs: none. The guarded default adds one `host.ui` confirm per gated call when no policy package is installed; `guard: "off"` removes it and is documented.

## Tasks

- [x] Task 1: Command rules — strictest match wins, built-in denies cannot be shadowed, and `/pattern/` is a pattern
  - Acceptance Criteria:
    - Functional:
      - `evaluateCommandRules` checks the built-in deny patterns first and returns `deny` on a hit, whatever the configured rules say.
      - It then evaluates every configured rule and returns the strictest matching decision (`deny` > `requireApproval` > `allow`), with the reason of the rule that decided. With no match, the metacharacter rule and the default apply as today.
      - `ToolsCodingCommandRule.match` of the form `/…/` with optional `i` flag compiles to a `RegExp` at setup. Other flags, an invalid pattern, or a pattern over 512 characters fail `createAgent` with an error naming the rule index. Any other string is a substring match.
      - The same evaluation is used by the hard-deny hook (`packages/tools/coding/src/hard-deny.ts`) and the approval policy (`packages/tools/coding/src/security/approval.ts`), as today.
      - Built-in denies gain: `rm` with both a recursive and a force flag in any order or bundle, aimed at `/`, `~`, or `$HOME`; `sudo`, `doas`, `pkexec`, and `su -c`; a download piped into any shell (`sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`); `bash -c "$(curl …)"` and its `wget` form.
    - Performance: Rules compile once at setup; evaluation is one pass over at most 256 rules.
    - Code Quality: One evaluation function; the built-in list is data with a test per entry.
    - Security: A compiled pattern is length-bounded (512 characters) and rejects nested quantifier shapes (`(a+)+`, `(a*)*`, `(a{2,})+`) with a local linear scan — `guardrail-packs` has only a byte-length bound, no shape check, so there was nothing to import. Deny reasons name the rule, never the command.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/security/command-rules.ts` (whole file), `packages/tools/coding/src/index.ts:77-83`, `packages/tools/coding/src/hard-deny.ts:85-92`, `packages/tools/coding/src/security/approval.ts:98-112`
      - `packages/tools/coding/README.md` (`commandRules` row; "Built-in deny patterns … cannot be bypassed")
      - `packages/extensions/guardrail-packs/src/compile.ts` (pattern compilation and bounds)
    - Options Considered:
      - Keep first-match and document it — rejected: the README promise is the safer contract, and the owner asked for the defect fixed.
      - Parse commands with a shell grammar — rejected: a full parser is out of proportion for a tripwire; the sandbox is the control.
    - Chosen Approach:
      - Built-ins first, strictest of all matches, patterns compiled at setup.
    - API Notes and Examples:
      ```jsonc
      { "commandRules": [
          { "match": "git", "decision": "allow" },
          { "match": "/\\brm\\s+-[a-z]*r[a-z]*f/i", "decision": "deny", "reason": "recursive force delete" } ] }
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/security/command-rules.ts`, `packages/tools/coding/src/security/index.ts` (exports), `packages/tools/coding/src/index.ts`, `packages/tools/coding/src/config.ts`
      - `packages/tools/coding/src/security/__tests__/command-rules.test.ts` (created), `packages/tools/coding/src/__tests__/hard-deny.test.ts` (command no longer a built-in)
      - `scripts/compat-baseline/arnilo__prism-tools.txt` (additive)
      - `packages/tools/coding/README.md`, `docs/coding-security.md`
    - References:
      - Evaluation probe `p7-rules`; findings T1–T3
  - Test Cases to Write:
    - `allow_rule_does_not_shadow_builtin_deny`: the probe's command is denied.
    - `strictest_matching_rule_wins`: an `allow` and a `deny` both match; `deny` wins regardless of order.
    - `slash_pattern_is_compiled_and_matches`: `/rm\s+-rf/` denies `rm  -rf build`.
    - `invalid_pattern_fails_the_load_naming_the_rule`.
    - `plain_string_is_still_a_substring`.
    - `builtin_denies_catch_reordered_and_renamed_forms`: table-driven over the forms listed above.
    - `deny_reason_does_not_echo_the_command`.
    - Tool conformance (`@arnilo/prism/testing`) passes.
  - Notes (executed 2026-11-17):
    - What changed: `packages/tools/coding/src/security/command-rules.ts` rewritten. `BUILTIN_DENY_RULES` is data (`{ id, test }`), evaluated first; a hit returns `deny` with reason `command matches built-in deny rule "<id>"`. Configured rules are all evaluated and the strictest wins (ties keep the first; a `deny` short-circuits); a rule without a `reason` reports `command matches commandRules[i]`. `compileCommandRules` replaces `index.ts`'s `toCommandRules`: `/pattern/` and `/pattern/i` compile to a `RegExp`, other flags / invalid / >512 chars / nested quantifier throw `prism-tools-coding: commandRules[i] …`, which fails `createAgent`. A string is treated as a pattern only when it is `/…/` followed by JS flag letters, so a path like `/usr/bin/sh` stays a substring. `hard-deny.ts` and `approval.ts` call the same `evaluateCommandRules` unchanged.
    - Built-in list: `privilege-escalation` (`sudo`/`doas`/`pkexec`), `su-command`, `chmod-777`, `rm-recursive-force-root` (a linear token scan per `rm` segment: `-rf`, `-fr`, `-r -f`, `-Rfv`, `--recursive --force`, flags after the target; targets `/`, `/*`, `~`, `~/`, `$HOME`, `${HOME}` and quoted forms), `download-piped-to-shell` (any of `sh bash zsh dash ksh fish`, also via `sudo`/`env`/an absolute path), `shell-runs-download` (`bash -c "$(curl …)"`, backticks, `bash <(curl …)`, `eval "$(curl …)"` — beyond the plan's list, same class), `raw-disk-write`, `mkfs`, `dd`. `rm -r /` (no force) and `rm -rf ./build` stay allowed.
    - Tests: new `src/security/__tests__/command-rules.test.ts` (the seven listed cases plus `builtin_denies_leave_ordinary_commands_alone`; the table test asserts every built-in id has an entry). `src/__tests__/hard-deny.test.ts` `hard_deny_command_rule` now uses `terraform destroy`: its old command `rm -rf /` is caught by the built-in first, which is the intended precedence. Tool conformance (`tools_coding_package_conformance`) passes.
    - Checks: `bun run --filter @arnilo/prism-tools test` 1274 pass, 2 fail — both wall-clock budgets (`hard_deny_decision_budget`, the work package's max-page envelope) under load average ~42; `hard_deny_decision_budget` passes alone. `bun run typecheck` green. `bun test --timeout=0 src/__tests__/docs.test.ts` 68 pass, 1 fail: `examples_demos_run_to_completion_and_emit_no_secret` hit its 60 s timeout under the same load; no example uses a command the new rules catch (`examples/guardrail-packs.ts` `rm -rf ./build` stays allowed). Re-run both in the whole-plan verification on a quiet machine.
    - Baseline diff (additive, `scripts/compat-baseline/arnilo__prism-tools.txt`): `+./coding BUILTIN_DENY_RULES`, `+./coding BuiltinDenyRule`, `+./coding CommandRuleSpec`, `+./coding MAX_COMMAND_RULE_PATTERN_LENGTH`, `+./coding compileCommandRules`. No removals. The gate's other note (`@arnilo/prism-ai` changed since v0.13.0, bump required) predates this task.
    - Findings for later: `bun scripts/host-builder-index.mjs --check` reports `api.json`, `errors.json`, `examples.json`, `examples/delegate.ts` stale; all but the `api.json` command-rules entries come from other in-progress work in the tree, so regenerate once in the whole-plan verification (Task 3 also changes `examples/*.ts`). No retired names (`toCommandRules` was internal).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — rule precedence and pattern syntax
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: the `commandRules` row and "Cost, security, and failure behavior" (the list is a tripwire; the sandbox is the control)
      - `docs/coding-security.md`: the same statement
      - `CHANGELOG.md`: `## [Unreleased]`, Security
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 2: `shell` runs in a POSIX shell
  - Acceptance Criteria:
    - Functional:
      - Resolution order: `shell.path` from config (must exist, else the load fails naming the field); `/bin/bash` or `bash` on `PATH`; `$SHELL` when its basename is one of `bash`, `zsh`, `sh`, `dash`, `ksh`; `sh`.
      - The tool description names the resolved shell family ("POSIX shell (bash)") so the model writes for it.
      - Background processes (`createBackgroundProcesses`) and the `native` sandbox backend use the same resolution. The container backends (`docker`, `e2b`) keep the image's `/bin/sh` and the description says `sh`: the host's shell paths do not exist in the container.
      - `inspect()` shows the resolved path as an `info` status note (`shell runs commands in <path> (POSIX shell, <family>)`). A package cannot change the merged config `inspect()` reports, so the note is the package-side surface.
    - Performance: Resolved once at setup.
    - Code Quality: One resolver; the duplicated comment block in `shell.ts`'s header is corrected to the new order.
    - Security: `shell.path` is a host-authored path, validated to exist and to be executable; it is never taken from a tool argument.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/shell.ts:1-30` (header), `:118-131` (`getShellConfig`), `packages/tools/coding/src/index.ts` (`createBackgroundProcesses({ shell: getShellConfig() })`), `packages/tools/coding/src/config.ts` (`ToolsCodingShellConfig`)
    - Options Considered:
      - Keep `$SHELL` first — rejected: a login shell is the person's preference, not the model's dialect.
      - Force `/bin/sh` — rejected: models write bash, and bash is present on the supported platforms.
    - Chosen Approach:
      - Prefer bash, accept POSIX-family `$SHELL`, let the host override.
    - API Notes and Examples:
      ```jsonc
      { "shell": { "path": "/usr/local/bin/bash" } }
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/shell.ts`, `packages/tools/coding/src/config.ts`, `packages/tools/coding/src/index.ts`
      - `packages/tools/coding/src/agent/index.ts` (exports), `packages/tools/coding/src/sandbox.ts`, `packages/tools/coding/src/security/native-sandbox.ts`
      - `packages/tools/coding/src/agent/__tests__/shell-resolution.test.ts`: new
      - `scripts/compat-baseline/arnilo__prism-tools.txt` (additive)
      - `packages/tools/coding/README.md`, `CHANGELOG.md`
    - References:
      - Evaluation finding T5
  - Test Cases to Write:
    - `fish_login_shell_is_not_used`: with `SHELL=/usr/bin/fish`, the resolver returns bash.
    - `posix_login_shell_is_accepted_when_bash_is_absent`.
    - `shell_path_overrides_and_must_exist`.
    - `bash_syntax_runs_under_a_fish_login_shell`: `export A=1 && echo "${A}$((1+1))"` prints `12` (skipped where fish is not installed; the skip is counted in the test output that `scripts/release-skip-manifest.mjs` reads). The plan's original `export A=1 && echo "$A"` also runs under fish ≥ 3, so it could not fail on the old resolver.
    - `background_processes_use_the_same_shell`.
    - Added: `tool_description_names_the_shell_family`, `native_sandbox_execs_the_resolved_shell_after_the_limits`.
  - Notes (executed 2026-11-17):
    - What changed: `getShellConfig(customShellPath?, probe?)` in `packages/tools/coding/src/agent/shell.ts` is the one resolver: `customShellPath` (must be an executable file — `stat` + `X_OK` — else it throws) → `/bin/bash` → `bash` on `PATH` (absolute `PATH` entries only) → `$SHELL` when absolute and its basename is in `POSIX_SHELL_NAMES` → `/bin/sh` → `sh`. `ShellConfig` gains `family`. `ShellResolutionProbe` (env + executable check) lets tests stand in for the filesystem. `createLocalBashOperations` resolves once at construction instead of per command; `createShellTool` accepts a resolved `shell` and a `shellFamily`, and its description reads "Execute a command in a POSIX shell (<family>) …" (`sh` when a custom `operations` backend runs the command). The duplicated header bullet is replaced by the new order.
    - Package (`src/index.ts`): `shell.path` (new, `config.ts` + schema, max 4096) is resolved once in `setup` when the shell can register; a bad path fails `createAgent` with `prism-tools-coding: invalid shell.path: …`. The resolved config feeds the local `shell` tool (every worktree's set), background processes, and `selectCodingSandbox`. Background processes on a container process backend (`e2b`) now get `/bin/sh` explicitly. Before, they got the host's `getShellConfig()` path (possibly `/usr/bin/fish`) to run inside the container. An `info` status note names the resolved shell for local and `native` runs.
    - `native` sandbox (`security/native-sandbox.ts`): `CreateNativeSandboxOptions.shell` (absolute path). With it, a command request runs `/bin/sh -c 'ulimit …; exec "$@"' prism-native-sh <shell> -c <command>`, so the limits still apply in `/bin/sh` and the command is argv to the resolved shell, not concatenated into the wrapper script. Without it the old form stays (the existing T1/T2 tests are unchanged). `sandbox.ts` passes the host shell only for `native` and only when absolute; the composition gets `shellFamily` (`sh` for containers).
    - Tests: new `src/agent/__tests__/shell-resolution.test.ts`, 7 pass, 0 skip here (fish is installed). The fish test fails against the old resolver (checked by stashing `shell.ts`). `bun run --filter @arnilo/prism-tools test`: 1283 pass, 27 skip, 0 fail. `bun run --filter @arnilo/prism-agent test`: 69 pass, 1 skip, 0 fail. `bun run typecheck` is green. `bun test --timeout=0 src/__tests__/docs.test.ts`: 69 pass.
    - Baseline diff (`scripts/compat-baseline/arnilo__prism-tools.txt`, all additive optional members): `+./coding POSIX_SHELL_NAMES`, `+./coding ShellResolutionProbe`; `ShellConfig` gains `family?`, `ShellToolOptions` gains `shell?` and `shellFamily?`, `ToolsCodingShellConfig` gains `path?`, `CreateNativeSandboxOptions` gains `shell?`; `buildNativeSpawnCommand` options gain `shell?`, `createLocalBashOperations` options gain `shell?`, `getShellConfig` gains `probe?`. No removals. Regenerated with `--update-baseline`. The only file that changed is this one, and every changed line is this task's. Remaining gate notes predate this task and are outside the tools package: `@arnilo/prism-ai` bump required, and kernel packed/unpacked bytes over the ceiling (+974 / +2013; no `src/` file was touched here).
    - Findings for later: `packages/hosts/host-builder/data/api.json` lists `ShellToolOptions` and `createLocalBashOperations` with the old shapes. Regenerate it with the whole-plan `host-builder-index` run that Task 1 already deferred. No retired names: `getShellConfig` keeps its name, and the old error text `Custom shell path not found` had no other uses.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a config field and the default shell
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: `shell.path`, the resolution order
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 3: The unsandboxed default asks unless a policy package decides
  - Acceptance Criteria:
    - Functional:
      - `@arnilo/prism-extensions/approval` and `@arnilo/prism-extensions/governance` each provide the service `tool-policy` (a marker object with the package name) during `setup`.
      - `@arnilo/prism-tools/coding` gains `guard: "auto" | "off"` (default `"auto"`). With `"auto"`, `sandbox: "none"`, and no `tool-policy` service present when a call is decided, its `tool.call` handler returns `{ ask }` for `shell`. (`write`, `edit`, `delete`, `move` whose target is outside the roots were already hard-denied by the same handler, and a deny outranks an ask.) Reads and in-root writes are not asked.
      - With a `tool-policy` service present, or `guard: "off"`, or a sandbox backend, the handler adds no ask; hard denies are unchanged.
      - The service is looked up at decision time, so package load order does not matter.
      - An ask follows the kernel path: `host.ui` confirm, or a suspension when no UI answers. `README.md`'s quick start adds `approval({ mode: "edits" })` and says what happens without it.
      - The `warn` status note stays, reworded: "shell asks before each command; add `@arnilo/prism-extensions/approval` or a sandbox to change that".
    - Performance: One service lookup per gated call.
    - Code Quality: The tool package does not reimplement modes, rules, or caching; it asks or it does not. The policy stays in the policy packages.
    - Security: The default moves from allow to ask. `guard: "off"` is an explicit host decision and is visible in `inspect()`.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/index.ts` (`setup`, the hard-deny registration and the final `warn` note), `packages/tools/coding/src/hard-deny.ts`, `packages/tools/coding/src/targets.ts`
      - `packages/extensions/approval/src/index.ts`, `decide.ts`; `packages/extensions/governance/src/index.ts`
      - `src/hooks/bus.ts:76-100` (the `tool-call` combination: a deny wins, then a rewrite, then an ask — an `allow` from another handler does not cancel an ask)
      - `.agents/skills/create-plan/references/prism.md` §4 ("Tool package … Approval is left to `@arnilo/prism-extensions/approval`")
    - Options Considered:
      - Disable `shell` by default — rejected: the coding package without a shell is not the documented product, and hosts would enable it without a gate.
      - Always ask from the coding package — rejected: `approval` in `auto` mode could not allow, because an ask outranks an allow in the combination rule.
      - Make `approval` a required package — rejected: sandboxed and governed hosts do not need it.
    - Chosen Approach:
      - Ask only when nothing else is deciding, detected through a provided service.
    - API Notes and Examples:
      ```ts
      createAgent({ model, packages: [coding({ root })] });                                   // shell asks
      createAgent({ model, packages: [coding({ root }), approval({ mode: "edits" })] });      // approval decides
      createAgent({ model, packages: [coding({ root, guard: "off" })] });                     // host opts out
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/{index,config,hard-deny}.ts`, `README.md`
      - `packages/extensions/approval/src/index.ts`, `packages/extensions/governance/src/index.ts`: provide `tool-policy`; READMEs ("Services provided")
      - `packages/tools/coding/src/__tests__/guard.test.ts`: new
      - `README.md`, `PRODUCT.md` (the example block): the quick start with `approval`
      - `apps/prism-agent/src/host/coding.ts`: already loads `approval`; its suite must stay green
      - `examples/*.ts` that load `coding` without a policy package: add one or set `guard: "off"` with a comment
    - References:
      - Evaluation finding T4
  - Test Cases to Write:
    - `unsandboxed_shell_asks_when_no_policy_package_is_loaded`.
    - `in_root_write_does_not_ask`, `out_of_root_write_is_hard_denied_not_asked` (was `out_of_root_write_asks`: the existing hard deny already refuses every path outside the roots, and a deny outranks an ask, so such a write can never reach an ask).
    - `approval_package_takes_over_the_decision`: with `approval({ mode: "auto" })` listed after `coding`, `shell` runs without an ask.
    - `governance_package_takes_over_the_decision`.
    - Added: `approval_and_governance_load_together` (no `service_conflict`).
    - `guard_off_adds_no_ask`.
    - `sandboxed_shell_adds_no_ask`.
    - `load_order_does_not_matter`: `approval` listed before `coding` (the "after" order is the takeover test above).
    - `no_ui_suspends_instead_of_running`.
    - Added: `guarded_default_warn_note_is_reworded`.
    - `examples_demos_run_to_completion_and_emit_no_secret` passes with the updated examples.
  - Notes (executed 2026-11-17):
    - What changed: `config.ts` gains `guard: "auto" | "off"` (schema enum, default `"auto"`). `hard-deny.ts`: `HardDenyOptions.shouldAsk?: () => boolean`. After the root, read-only, and command-rule denies, a `shell` call returns `{ ask: UNGUARDED_SHELL_ASK }` when `shouldAsk()` is true. The kernel's confirm adds the redacted argument preview, so the reason does not repeat the command. `index.ts` wires `shouldAsk` only for `guard: "auto"` with `sandbox: "none"`. Each call it checks `prism.services.consume("tool-policy") === undefined`, and once it checks that `shell` is in `prism.tools.list()` as this package's tool, so a `shell` removed by `disable.tools` is never asked about. That check was added after `disable_tools_shell_removes_shell` failed: the ask outranked the kernel's `unknown_tool` block. The `warn` note is reworded as specified; with `guard: "off"` it says the guard is off. Exports: `TOOL_POLICY_SERVICE`, `UNGUARDED_SHELL_ASK`.
    - `approval` and `governance` each provide `tool-policy` as a frozen `{ package: <name> }` during `setup`, but only when it is not already provided. With both loaded, the first one set up holds it and the other skips it. Providing it unconditionally would fail the load with `service_conflict` for hosts that list both.
    - Scope note: the ask covers only `shell`. Writes, edits, deletes, and moves outside the roots were already hard-denied by the same handler, so they never reach the ask. This is recorded in the code comment and in the README.
    - Examples: none of the `examples/*.ts` that load `coding` without a policy package (`delegate`, `host-builder-agent`, `package-skills`, `web-no-key`) calls `shell`, so the guarded default does not change what they do. They stay unchanged, with no `guard: "off"` noise, and each one was run directly and exits 0, as do the other nine coding examples. Two test files changed: `shell-background-plugin.test.ts` runs a background shell with no host UI and now sets `guard: "off"` with a comment, and `package.test.ts` `coding_unsandboxed_shell_warns` asserts the new note text.
    - Tests: new `src/__tests__/guard.test.ts`, 11 pass. `bun run --filter @arnilo/prism-tools test`: every failure from this change is fixed. What remains are the wall-clock budgets `hard_deny_decision_budget` (it times the `read` path, which this change does not touch; 111 ms against a 50 ms budget at load average ~35) and the work package's max-page envelope. `bun run --filter @arnilo/prism-extensions test`: one failure, the field-policy microbenchmark (a wall-clock check). Alone, `governance_identity_expiry_denies_tool_call` times out at 5 s with or without the governance change (checked by reverting it), so it was failing before this task. `bun run --filter @arnilo/prism-agent test`: 69 pass, 0 fail. The guardrail-packs and evals guardrail scenario suites, which call `shell`, pass. `bun run typecheck` is green. `security:threat-suites`: 3 failures, all in provider truncated-stream conformance (`strictCompletion`), outside this task. `docs.test.ts`: 68 pass, 1 fail (`examples_demos_run_to_completion_and_emit_no_secret` hit its 60 s timeout under load), so the examples were run directly as described above.
    - Baseline diff (additive, `scripts/compat-baseline/arnilo__prism-tools.txt`): `+./coding TOOL_POLICY_SERVICE`, `+./coding UNGUARDED_SHELL_ASK`; `HardDenyOptions` gains `shouldAsk?`; `ToolsCodingConfig` gains `guard?`. No removals. `--update-baseline` rewrites every baseline file from the current tree. The other baseline files that show as modified carry other in-progress work and no change from this task. The remaining gate notes predate this task: the `@arnilo/prism-ai` bump, and kernel packed/unpacked bytes (+2162 / +5312; no kernel file was touched).
    - Findings for later: `bun scripts/host-builder-index.mjs --check` still reports `api.json`, `errors.json`, `examples.json`, and `examples/delegate.ts` stale. Regenerate them in the whole-plan verification, as Tasks 1 and 2 already deferred. No retired names: the old warn text appeared only in the one test and the README, and both are updated.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a default, a config field, a provided service
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: `guard`, the default behavior
      - `packages/extensions/approval/README.md`, `governance/README.md`: the `tool-policy` service
      - `README.md`, `PRODUCT.md`: the quick start
      - `docs/coding-security.md`
      - `CHANGELOG.md`: `## [Unreleased]`, Security (behavior-changing)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-tools test`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-agent test`
- `bun run security:threat-suites`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
