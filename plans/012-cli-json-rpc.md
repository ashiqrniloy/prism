# Phase 9 — CLI and RPC Surfaces

## Objectives
- Add minimal CLI print, JSON event stream, and LF-delimited JSONL RPC modes over the existing `AgentSession` runtime.
- Keep CLI/RPC as adapters: no hidden providers, tools, credentials, stores, extension loading, or TUI in core.
- Define one strict protocol shape that non-Node clients can drive and correlate by request id.
- Document CLI flags, event output, RPC commands, errors, and security boundaries under `/docs`.

## Expected Outcome
- `prism -p "prompt"` runs one session and prints assistant text to stdout.
- `prism --mode json -p "prompt"` writes newline-delimited event envelopes.
- `prism --mode rpc` reads LF-delimited JSON requests from stdin and writes correlated JSON responses/events to stdout.
- CLI flags cover explicit provider/model/session/config/resource/extension/tool/system/context/compaction choices without auto-discovery.
- `npm run build`, `npm run typecheck`, and `command npm test` pass with no network, no new dependency, and no TUI.

## Tasks

- [x] Inventory existing primitives and lock the minimal CLI/RPC surface
  - Acceptance Criteria:
    - Functional: Existing runtime, session store, config, resource, extension, contribution, command, compaction, retry, redaction, CLI bin, docs, and roadmap requirements are inventoried; the task records the smallest generic additions needed for print/json/rpc adapters.
    - Performance: Inventory adds no runtime path, dependency, provider call, filesystem scan, network call, watcher, queue, or test slowdown.
    - Code Quality: Locked surface rejects a TUI, shell/filesystem app tools, global provider lookup, package auto-discovery, MCP bridge, workflow graph engine, and speculative config schema.
    - Security: Design keeps credentials host/config-resolver owned, redacts errors/events where known secrets are supplied, and treats extension/resource paths as explicit user input only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 9 and non-negotiable boundaries: API first/CLI second, host controlled, no built-in app tools, no full TUI, secrets never enter history/events.
      - `src/cli.ts`: current placeholder bin.
      - `package.json`: `bin.prism`, ESM `dist`, Node `>=20`, no test framework dependency.
      - `src/contracts.ts`: `AgentSession`, `RunOptions`, `AgentEvent`, `CommandDefinition`, `CommandResult`, `ConfigProvider`, `ResourceLoader`, `CompactionOptions`, and `RetryOptions`.
      - `docs/agent-session-runtime.md`, `docs/configuration-and-manifests.md`, `docs/node-filesystem-config.md`, `docs/resource-loading.md`, `docs/contribution-registries.md`, `docs/compaction-and-retry.md`, `docs/credentials-and-redaction.md`, and `docs/index.md`.
      - `node_modules/@types/node/readline/promises.d.ts`: `createInterface()` and abort-aware `question()`; JSONL can use Node readline without a dependency.
      - Existing `src/__tests__/*.test.ts` style: `node:test`, `node:assert/strict`, mocked providers, temporary files only where needed.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
      - Project pattern/wiki directories: none present under `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/`.
    - Options Considered:
      - Implement CLI as a separate app package: rejected for Phase 9; roadmap requires core bin surfaces, but they remain adapters over public APIs.
      - Add a TUI or interactive chat loop: rejected; roadmap explicitly says no full TUI in core v1.
      - Auto-load project extensions/tools/resources: rejected; Phase 10 trust controls are not implemented yet.
      - Add a JSON-RPC 2.0 dependency: rejected; LF JSONL with `{ id, command, params }` is enough and easier to test.
    - Chosen Approach:
      - Add internal CLI/RPC adapter modules that accept injected streams and an explicit `AgentSession` factory for tests.
      - Keep `src/cli.ts` as the thin process wrapper.
      - Define reusable exported protocol types only if tests/docs need them; otherwise keep implementation internal and document wire JSON.
      - Require explicit provider/model/session selection from config/flags; fail closed with a clear error when no provider can be built.
    - API Notes and Examples:
      ```sh
      prism -p "hello" --provider openai-compatible --model gpt-4o-mini
      prism --mode json -p "hello"
      printf '{"id":"1","command":"prompt","params":{"input":"hello"}}\n' | prism --mode rpc
      ```
    - Files to Create/Edit:
      - `plans/012-cli-json-rpc.md`: record inventory and locked API before implementation.
      - Expected later files: `src/cli.ts`, `src/cli-runner.ts`, `src/rpc.ts`, `src/contracts.ts` if public protocol/command types change, `src/index.ts` if protocol helpers are exported, `src/__tests__/cli.test.ts`, `src/__tests__/rpc.test.ts`, `src/__tests__/docs.test.ts`, `docs/cli-rpc.md`, `docs/agent-session-runtime.md` if adapter behavior affects runtime docs, `docs/public-contracts.md` if exports change, and `docs/index.md`.
    - References:
      - `roadmap.md` Phase 9 deliverables and acceptance.
      - `plans/011-compaction-strategies-and-retry.md` closeout: runtime now exposes `session.compact()` and retry/compaction events the CLI/RPC can surface.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - None for this inventory-only plan edit; no source or docs API files changed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; later implementation tasks must document CLI/RPC behavior and any exported protocol types.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public behavior is implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add CLI argument parsing and explicit runtime bootstrap
  - Acceptance Criteria:
    - Functional: CLI accepts `-p/--prompt`, `--mode print|json|rpc`, `--provider`, `--model`, `--session`, `--config`, `--resource`, `--extension`, `--tool`, `--system`, `--context`, `--compact`, `--max-tool-rounds`, and `--help`; unknown or malformed flags fail with exit code `2` and usage text.
    - Performance: Parsing is O(n) over argv, uses no dependency, and performs no filesystem/network/provider work until the selected mode runs.
    - Code Quality: Parser is a small typed function with tests; `src/cli.ts` only passes `process.argv`, stdio, env, and exits.
    - Security: CLI does not read config files, import extensions, load resources, resolve credentials, or execute tools unless explicitly named by flags/config.
  - Approach:
    - Documentation Reviewed:
      - `package.json` `bin.prism` and Node `>=20` ESM setup.
      - `docs/node-filesystem-config.md`: config files are caller-named and optional, with no discovery beyond explicit helper use.
      - `docs/resource-loading.md`: resources require host-provided loaders and should not be auto-fetched.
      - `docs/extensions.md`: extensions are host-provided and loaded in order.
      - `docs/tools.md`: selected tools must still be active/allowed before dispatch.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Use `commander`/`yargs`: rejected; no dependency for simple flags.
      - Parse every future config value into a rich schema: rejected; keep only Phase 9 flags and pass JSON-ish values through where already supported.
      - Auto-read `~/.config/prism`: rejected; CLI may offer `--config user` later, but Phase 9 should not hide filesystem access.
    - Chosen Approach:
      - Implement a tiny argv parser with long flags and `-p` only.
      - Normalize mode to `print`, `json`, or `rpc`; default to `print` when `-p` is present and `rpc` only when requested.
      - Add a bootstrap function that converts parsed options into explicit agent/session config using existing public primitives and clear fail-closed errors for missing providers.
    - API Notes and Examples:
      ```ts
      const parsed = parseCliArgs(["-p", "Hi", "--mode", "json", "--model", "mock/demo"]);
      await runCli({ args: parsed, stdin, stdout, stderr, createSession });
      ```
    - Files to Create/Edit:
      - `src/cli.ts`: thin process wrapper and exit-code handling.
      - `src/cli-runner.ts`: parser, usage text, bootstrap, and mode dispatch.
      - `src/__tests__/cli.test.ts`: parser and fail-closed bootstrap tests.
      - `docs/cli-rpc.md`: CLI flags and examples.
      - `docs/index.md`: add CLI/RPC entry.
    - References:
      - `roadmap.md` Phase 9 CLI flags requirement.
      - `docs/node-filesystem-config.md`, `docs/resource-loading.md`, `docs/extensions.md`, `docs/tools.md`.
  - Test Cases to Write:
    - `cli_parser_accepts_prompt_mode_and_core_flags`: validates normalized parse result.
    - `cli_parser_rejects_unknown_or_missing_flag_values`: validates exit-code-2 errors.
    - `cli_bootstrap_fails_without_explicit_provider`: validates no hidden provider/global lookup.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public CLI behavior and flags.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: create detailed CLI/RPC page with flags, examples, behavior, errors, and security notes.
    - `docs/index.md` update: Yes; add `CLI/RPC - Run print/json modes and LF-delimited RPC over the public AgentSession runtime` under a CLI/RPC group.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement print and JSON event stream modes over `AgentSession`
  - Acceptance Criteria:
    - Functional: `prism -p "prompt"` subscribes before running, writes assistant text deltas to stdout, exits `0` on success, non-zero on runtime errors; `--mode json` writes one JSON object per event line and includes run/session ids.
    - Performance: Modes stream as events arrive, buffer only current line/event, and add no timers, queues, workers, or network beyond the configured provider.
    - Code Quality: Both modes share one session-run helper and event serializer; tests use `createMockProvider()` and injected streams.
    - Security: Errors/events use existing `ErrorInfo` shapes and redaction hooks where known secrets are configured; print mode does not dump tool values or metadata by default.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`: subscribe before `run()`, event ordering, abort, compaction/retry events, and run exclusivity.
      - `docs/provider-layer.md`: `createMockProvider()` for deterministic streaming tests.
      - `docs/compaction-and-retry.md`: `compaction_started`, `compaction_finished`, and `retry_scheduled` events.
      - `src/agents.ts`: live-only subscriber closes after run.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Wait for `session.run()` to finish then print final message: rejected; print/json should stream and prove adapter uses `subscribe()`.
      - Emit raw internal provider events: rejected; CLI/RPC surfaces should expose normalized `AgentEvent` only.
      - Pretty-print JSON arrays: rejected; newline JSON is easier for pipes and tests.
    - Chosen Approach:
      - Subscribe, consume events in parallel with `session.run()`, and write text deltas for `message_delta` text blocks in print mode.
      - JSON mode serializes each `AgentEvent` as a single line `{ type: "event", event }`.
      - Convert thrown runtime errors to one stderr line in print mode and one JSON error envelope in JSON mode where possible.
    - API Notes and Examples:
      ```sh
      prism -p "Hi"
      prism --mode json -p "Hi" | while read line; do echo "$line"; done
      ```
    - Files to Create/Edit:
      - `src/cli-runner.ts`: print/json mode runners.
      - `src/__tests__/cli.test.ts`: mocked print/json stream tests.
      - `docs/cli-rpc.md`: print/json event stream examples and error behavior.
      - `docs/agent-session-runtime.md`: add related CLI/RPC link if useful.
    - References:
      - `roadmap.md` Phase 9 acceptance: CLI modes use same `AgentSession` API.
      - `docs/agent-session-runtime.md` event contract.
  - Test Cases to Write:
    - `print_mode_streams_text_deltas_from_mock_provider`: validates stdout text and subscription timing.
    - `json_mode_writes_one_event_per_line`: validates parseable event envelopes and session/run ids.
    - `print_mode_returns_nonzero_on_runtime_error`: validates fail-closed exit behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; implements CLI print/json behavior.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: document print mode, JSON mode, event envelope shape, exit codes, and examples.
    - `docs/index.md` update: Yes if not already done by the CLI parsing task; ensure CLI/RPC entry exists.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement strict LF-delimited RPC protocol
  - Acceptance Criteria:
    - Functional: `prism --mode rpc` reads one JSON request per LF line and supports `prompt`, `steer`, `followUp`, `abort`, `state`, `messages`, `setModel`, `compact`, `switchSession`, `forkSession`, `cloneSession`, and `command`; responses include matching `id`; async session events are emitted separately with enough correlation.
    - Performance: RPC keeps one active run per session, does not queue unbounded work, reads/writes line-by-line, and uses no dependency or background worker.
    - Code Quality: Protocol parsing validates object shape and command names; handlers call existing `AgentSession` and `CommandDefinition` APIs instead of duplicating runtime logic.
    - Security: Invalid JSON, missing ids, unknown commands, unknown command contributions, denied/malformed tool paths, and missing sessions fail closed without executing tools/providers unexpectedly; errors are redacted where known secrets are configured.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AgentSession`, `RunOptions`, `CommandDefinition`, `CommandExecutionContext`, and `CommandResult`.
      - `docs/agent-session-runtime.md`: `prompt`, `abort`, `entries`, `checkout`, `fork`, `clone`, `compact`, and model override behavior.
      - `docs/contribution-registries.md`: command contributions are inert until resolved and executed by the host/adapter.
      - `node_modules/@types/node/readline/promises.d.ts`: line-based stream support with Node stdlib.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Full JSON-RPC 2.0: rejected; the roadmap asks for strict LF JSONL, not a dependency or full spec.
      - Allow concurrent runs per session: rejected; existing runtime fails fast and should remain the source of truth.
      - Implement `steer` as hidden provider interruption: rejected; until runtime has steering primitives, map it to a documented error or follow-up metadata rather than pretending.
    - Chosen Approach:
      - Define minimal envelopes: request `{ id, command, params? }`, response `{ id, ok, result? | error? }`, async event `{ type: "event", sessionId, runId?, event }`.
      - Maintain an in-memory session map for the RPC process; `switchSession`, `forkSession`, and `cloneSession` use existing session APIs.
      - Implement `prompt`/`followUp` via `session.run()`/`prompt()`, `abort` via `session.abort()`, `messages` via `entries()`, `setModel` as next-run model override state, `compact` via `session.compact()`, and `command` via explicitly registered commands.
      - Document unsupported `steer` semantics honestly if no runtime primitive exists after inventory.
    - API Notes and Examples:
      ```json
      {"id":"1","command":"prompt","params":{"input":"Hi"}}
      {"id":"1","ok":true,"result":{"sessionId":"s1"}}
      {"type":"event","sessionId":"s1","runId":"run_1","event":{"type":"message_delta"}}
      ```
    - Files to Create/Edit:
      - `src/rpc.ts`: protocol envelopes, validation, server loop, and handlers.
      - `src/cli-runner.ts`: dispatch `--mode rpc` to RPC server.
      - `src/contracts.ts`: add exported protocol types only if chosen during implementation.
      - `src/index.ts`: export protocol helpers/types only if public.
      - `src/__tests__/rpc.test.ts`: JSONL protocol tests.
      - `src/__tests__/public-contracts.test.ts`: protocol export tests if exports are added.
      - `docs/cli-rpc.md`: RPC protocol and command docs.
      - `docs/public-contracts.md`: update only if protocol types are exported.
    - References:
      - `roadmap.md` Phase 9 RPC commands and acceptance.
      - `docs/agent-session-runtime.md`, `docs/contribution-registries.md`.
  - Test Cases to Write:
    - `rpc_prompt_correlates_response_and_async_events_by_id`: validates response id and event session/run correlation.
    - `rpc_invalid_json_and_unknown_command_fail_closed`: validates no handler execution.
    - `rpc_abort_calls_session_abort`: validates active run cancellation path.
    - `rpc_compact_and_session_branch_commands_use_session_api`: validates compact/switch/fork/clone behavior with memory store.
    - `rpc_command_executes_only_registered_commands`: validates command contribution lookup.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public RPC wire protocol and possibly exported protocol types/helpers.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: document RPC envelopes, commands, correlation, event streaming, errors, and security notes.
      - `docs/public-contracts.md`: update only if protocol types/helpers are exported from root.
    - `docs/index.md` update: Yes if not already done; ensure CLI/RPC entry exists.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add adapter documentation, examples, and export checks
  - Acceptance Criteria:
    - Functional: `/docs/cli-rpc.md` follows the Prism API page structure and covers CLI usage, JSON event mode, RPC protocol, flags, command list, examples, exit codes, and non-goals.
    - Performance: Documentation checks add only small file-read assertions and keep tests under the project target.
    - Code Quality: Docs and examples match actual flags/protocol names; root export checks are updated only for deliberately public types/helpers.
    - Security: Docs explicitly state no built-in app tools, no hidden credential loading, no automatic extension/resource discovery, and no TUI/sandbox promise.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md` and `.agents/skills/create-plan/references/prism-wiki.md` API page requirements.
      - `docs/index.md` functional grouping style.
      - Existing `src/__tests__/docs.test.ts` docs/export consistency checks.
    - Options Considered:
      - Put CLI docs in README only: rejected; roadmap requires `/docs` API pages.
      - Document future trust/auth settings as implemented: rejected; Phase 10 owns those controls.
      - Add large runnable examples: rejected; small command/protocol examples are enough here.
    - Chosen Approach:
      - Create one `docs/cli-rpc.md` page covering the small surface rather than splitting before it grows.
      - Add docs tests that assert the page is linked from `docs/index.md` and mentions implemented modes/commands.
      - Add compile/export checks only if `src/rpc.ts` exposes public helpers or types through `src/index.ts`.
    - API Notes and Examples:
      ```md
      ## Request/response example
      {"id":"1","command":"prompt","params":{"input":"Hi"}}
      ```
    - Files to Create/Edit:
      - `docs/cli-rpc.md`: new CLI/RPC API page.
      - `docs/index.md`: CLI/RPC group link.
      - `docs/agent-session-runtime.md`: related API link to CLI/RPC.
      - `docs/public-contracts.md`: update only for new exports.
      - `src/__tests__/docs.test.ts`: docs consistency checks.
      - `src/__tests__/public-contracts.test.ts`: export checks only if needed.
    - References:
      - `roadmap.md` docs ship with APIs boundary.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `docs_index_links_cli_rpc_page`: validates nav entry.
    - `cli_rpc_docs_cover_modes_flags_and_rpc_commands`: validates docs mention implemented public behavior.
    - `public_contracts_cover_rpc_exports`: only if protocol helpers/types are exported.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; documents public CLI/RPC behavior and any protocol exports.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: create final API page.
      - `docs/agent-session-runtime.md`: add related API link if adapter is implemented.
      - `docs/public-contracts.md`: update only for exported protocol types/helpers.
    - `docs/index.md` update: Yes; add/verify CLI/RPC navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Run final verification and close Phase 9 plan
  - Acceptance Criteria:
    - Functional: CLI print/json/RPC tests pass, documented commands match implementation, and all Phase 9 roadmap acceptance criteria are either met or explicitly recorded as compromises.
    - Performance: Full test suite remains under the roadmap target and uses no network.
    - Code Quality: `npm run build`, `npm run typecheck`, and `command npm test` pass; no new dependency is added unless the plan is updated with rationale.
    - Security: Secret-bearing config/credentials are not printed in docs/tests, invalid RPC/CLI input fails closed, and no app tools or TUI are introduced.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts.
      - `roadmap.md` Phase 9 acceptance.
      - This plan's task acceptance criteria.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Run only targeted tests: rejected for closeout; the public bin/protocol touches exports/docs/runtime.
      - Mark compromises before implementation: rejected; fill them only with actual deviations after checks pass.
    - Chosen Approach:
      - Run `npm run build`, `npm run typecheck`, and `command npm test`.
      - Update task checkboxes only after implementation and checks pass.
      - Fill `Compromises Made` and `Further Actions` with actual results.
    - API Notes and Examples:
      ```sh
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `plans/012-cli-json-rpc.md`: mark completed tasks and fill closeout sections.
    - References:
      - `roadmap.md` Phase 9 acceptance.
      - `package.json` scripts.
  - Test Cases to Write:
    - `npm run build`: validates emitted ESM/declarations/bin.
    - `npm run typecheck`: validates strict TypeScript.
    - `command npm test`: validates full suite.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No new behavior by verification alone; plan closeout records actual state.
    - Docs pages to create/edit:
      - `none`: unless verification finds docs drift that must be fixed before closeout.
    - `docs/index.md` update: No for verification alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- `steer` is documented and implemented as an explicit unsupported RPC error because the current `AgentSession` runtime has no steering primitive. Add real steering only when runtime exposes it.
- The built-in CLI bootstrap only supports an explicit `--provider mock` smoke-test provider; real provider/tool/credential wiring remains host-owned instead of hidden in core.
- RPC request ids are preserved for valid requests; malformed JSON or invalid envelopes return `id: null` because no trusted id exists.

## Further Actions
- High: Phase 10 should add trust/auth controls before CLI imports project extensions, resources, tools, or config automatically.
- Medium: Add a host/CLI package that wires real providers and credentials explicitly on top of these adapters.
- Low: Add real `steer` once the runtime has a small public interruption/steering API.
