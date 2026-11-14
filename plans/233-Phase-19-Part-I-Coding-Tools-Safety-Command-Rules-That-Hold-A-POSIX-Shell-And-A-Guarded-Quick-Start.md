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

- [ ] Task 1: Command rules — strictest match wins, built-in denies cannot be shadowed, and `/pattern/` is a pattern
  - Acceptance Criteria:
    - Functional:
      - `evaluateCommandRules` checks the built-in deny patterns first and returns `deny` on a hit, whatever the configured rules say.
      - It then evaluates every configured rule and returns the strictest matching decision (`deny` > `requireApproval` > `allow`), with the reason of the rule that decided. With no match, the metacharacter rule and the default apply as today.
      - `ToolsCodingCommandRule.match` of the form `/…/` with optional `i` flag compiles to a `RegExp` at setup. Other flags, an invalid pattern, or a pattern over 512 characters fail `createAgent` with an error naming the rule index. Any other string is a substring match.
      - The same evaluation is used by the hard-deny hook (`packages/tools/coding/src/hard-deny.ts`) and the approval policy (`packages/tools/coding/src/security/approval.ts`), as today.
      - Built-in denies gain: `rm` with both a recursive and a force flag in any order or bundle, aimed at `/`, `~`, or `$HOME`; `sudo`, `doas`, `pkexec`, and `su -c`; a download piped into any shell (`sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`); `bash -c "$(curl …)"` and its `wget` form.
    - Performance: Rules compile once at setup; evaluation is one pass over at most 256 rules.
    - Code Quality: One evaluation function; the built-in list is data with a test per entry.
    - Security: A compiled pattern is length-bounded and rejects nested quantifier shapes the package's existing ReDoS check flags (the same check `guardrail-packs` uses, if it can be imported without a cross-package dependency; otherwise a local length-and-shape bound, stated in the task note). Deny reasons name the rule, never the command.
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
      - `packages/tools/coding/src/security/command-rules.ts`, `packages/tools/coding/src/index.ts`, `packages/tools/coding/src/config.ts`
      - `packages/tools/coding/src/security/__tests__/command-rules.test.ts` (extend or create)
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — rule precedence and pattern syntax
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: the `commandRules` row and "Cost, security, and failure behavior" (the list is a tripwire; the sandbox is the control)
      - `docs/coding-security.md`: the same statement
      - `CHANGELOG.md`: `## [Unreleased]`, Security
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `shell` runs in a POSIX shell
  - Acceptance Criteria:
    - Functional:
      - Resolution order: `shell.path` from config (must exist, else the load fails naming the field); `/bin/bash` or `bash` on `PATH`; `$SHELL` when its basename is one of `bash`, `zsh`, `sh`, `dash`, `ksh`; `sh`.
      - The tool description names the resolved shell family ("POSIX shell (bash)") so the model writes for it.
      - Background processes (`createBackgroundProcesses`) and the sandbox backends use the same resolution.
      - `inspect()`'s package config shows the resolved path.
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
      - `packages/tools/coding/src/agent/__tests__/shell-resolution.test.ts`: new
      - `packages/tools/coding/README.md`
    - References:
      - Evaluation finding T5
  - Test Cases to Write:
    - `fish_login_shell_is_not_used`: with `SHELL=/usr/bin/fish`, the resolver returns bash.
    - `posix_login_shell_is_accepted_when_bash_is_absent`.
    - `shell_path_overrides_and_must_exist`.
    - `bash_syntax_runs_under_a_fish_login_shell`: `export A=1 && echo "$A"` prints `1` (skipped where fish is not installed, with the skip recorded in the skip manifest).
    - `background_processes_use_the_same_shell`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a config field and the default shell
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: `shell.path`, the resolution order
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The unsandboxed default asks unless a policy package decides
  - Acceptance Criteria:
    - Functional:
      - `@arnilo/prism-extensions/approval` and `@arnilo/prism-extensions/governance` each provide the service `tool-policy` (a marker object with the package name) during `setup`.
      - `@arnilo/prism-tools/coding` gains `guard: "auto" | "off"` (default `"auto"`). With `"auto"`, `sandbox: "none"`, and no `tool-policy` service present when a call is decided, its `tool.call` handler returns `{ ask }` for `shell` and for `write`, `edit`, `delete`, `move` whose target is outside the roots. Reads and in-root writes are not asked.
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
    - `in_root_write_does_not_ask`, `out_of_root_write_asks`.
    - `approval_package_takes_over_the_decision`: with `approval({ mode: "auto" })`, `shell` runs without an ask.
    - `governance_package_takes_over_the_decision`.
    - `guard_off_adds_no_ask`.
    - `sandboxed_shell_adds_no_ask`.
    - `load_order_does_not_matter`: `approval` listed after `coding`.
    - `no_ui_suspends_instead_of_running`.
    - `examples_demos_run_to_completion_and_emit_no_secret` passes with the updated examples.
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
