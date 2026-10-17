# Phase 10 Part B — Channels, evals, devtools, and the surface gate

## Objectives

- Check that Part A left the contracts Part B builds on: the allow-list, the approval mapping, the routing `HostPort` pattern, and the Task 1 (j) findings. Re-measure what Part B moves.
- Move `@arnilo/prism-channels` to `packages/hosts/channels` as a host library. `connectTelegram(agent, …)` and `connectSignal(agent, …)` serve one `Agent` through the public `Session`, and chat approvals answer the kernel's suspensions.
- Make evaluations the host library `@arnilo/prism-evals`, out of `@arnilo/prism-core/governance/evals`. Failure injection becomes hooks and a store wrapper on a host-built agent instead of an agent-like object.
- Make the dev inspector the host library `@arnilo/prism-devtools`, out of `@arnilo/prism-coding-tools/dev`, with its own bin. The kernel `prism dev` loader, which names packages as strings, is deleted.
- Add the repo-wide surface gate: no host library imports a name outside the allow-list, and no surface builds an agent outside `createAgent`. Record the Phase 10 Done criteria.

## Expected Outcome

- `connectTelegram(agent, { token: "env:TELEGRAM_BOT_TOKEN", … })` and `connectSignal(agent, { … })` return a handle with `handle(update)` / `start()` / `close()`. Each chat binds to one Prism session. A gated tool call becomes a chat approval message. The reply resolves the suspension through `session.resume(decisions)`. Pairing, admission, delivery journal, and limits behave as in 0.12.1. The bot token is a ref and never appears in events or errors.
- `@arnilo/prism-evals` exports datasets, scorers, judges, experiments, thresholds, trajectories, and scenarios as in 0.12.1. A scenario that needs failure injection takes an agent factory and adds `failureInjection(options)` (an `AgentConfig.hooks` function: `tool.call` deny and a `tool.execute` around for unknown effects) and `failingStore(store)`. No evals code spreads an `Agent` into a new object.
- `@arnilo/prism-devtools` exports `serveDevtools(agent, { port })`: the inspector UI over `agent.inspect()`, `agent.subscribe()`, `agent.sessions`, and session `entries()`, plus replay and compare. Its `prism-devtools` bin serves a manifest-built agent. `prism dev` and `src/cli-dev.ts` are gone.
- `src/__tests__/host-surface-gate.test.ts` scans every `packages/hosts/*/src` module (tests excluded). It fails on an `@arnilo/prism` import outside `scripts/host-surface-allowlist.json`, on a deep kernel path, and on any construction of an `Agent` other than a `createAgent` call: an object spread of an agent, a `defineAgent`, or a class implementing `Agent`.
- The Phase 10 Done criteria hold: `examples/acp.ts` serves ACP in-process against the mock provider with approval over ACP, and the repo search in Task 5 finds no surface constructing its own agent outside `createAgent`.

This plan implements roadmap **Phase 10 — Surfaces and host libraries**, Part B. It **depends on plan 161** (Part A), whose Task 1 is the review for both parts. This plan opens with an entry check instead of a second review. It adds no kernel contract. If the entry check finds that one is needed, it stops, and the addition goes back to plan 161 Task 1 (c) as an amendment. This plan does not bump versions, publish, deprecate on npm, or edit released `/docs`. `CheckpointStore`, which channels' durable state still uses, is allow-listed and tagged for Phase 16. Evals' `workflow-experiment.ts` follows the workflows runtime and stays in `prism-core` until Phase 16. Lab impact (probe 12): `packages/prism-code` imports none of channels, evals, or devtools (the entry check confirms it with `rg`), so no lab module becomes deletable.

## Tasks

- [x] Task 1: Part B entry check — channels, evals, and devtools after Part A (read-only)
  - Acceptance Criteria:
    - Functional: Confirm from source and plan 161's Notes:
      - `scripts/host-surface-allowlist.json` exists, and its phase tags match plan 161 Task 1 (a)
      - the approval mapping (plan 161 Task 1 (b)) and the kernel-ask distinction (1 (c)) as shipped in `@arnilo/prism-acp`
      - the routing `HostPort` pattern (`acpHost`, `mcpHost`) that channels reuses
      - plan 161 Task 1 (j): channels' agent resolution, approval store, and lifecycle use. Evals' agent-like object, `workflow-experiment.ts`'s workflow imports, and the `prism-core` modules that import evals (`governance/prompts/promotion.ts`, `enterprise/postgres/{types,evaluations}.ts`). Devtools' `runtime/server` and `governance/observability` imports. `src/cli-dev.ts`.
    - Functional: Decide, with evidence:
      - (a) **Channels agent model.** Today `resolveAgent` maps agent aliases to agents (`packages/prism-channels/src/types.ts:405`). Recommended: one `Agent` per `connect*` call, matching roadmap §2.8. A host serving several agents calls `connect*` once per agent and routes updates itself. Record what the alias feature loses.
      - (b) **Channels approvals.** Recommended: run turns with `interactive: false`. Map `RunResult.pending` to the existing approval store's chat prompt (`packages/prism-channels/src/approvals.ts`) and the reply to `session.resume(decisions)`. Keep the store on `CheckpointStore` (allow-listed, Phase 16 tag).
      - (c) **Evals split.** Which modules move to `@arnilo/prism-evals`. Whether `workflow-experiment.ts` stays in `prism-core` (recommended, because it drives `runtime/workflows`, which Phase 16 re-scopes). Whether the `prism-core` importers repoint to `@arnilo/prism-evals` or move. Plan 161 Task 1 found a fourth relative importer: `packages/prism-core/src/governance/observability/timeline.ts:21` (`EvaluationTrace`). Repoint it with `promotion.ts` and `enterprise/postgres/{types,evaluations}.ts`.
      - (d) **Devtools transport.** Recommended: `Bun.serve` directly instead of `@arnilo/prism-core/runtime/server`'s `PrismRequestHandler`. Timeline views: `projectAgentTimeline` stays in `prism-core` for Phase 16. Recommended: devtools renders the raw event list and drops the timeline panel until Phase 16 moves the projector to `@arnilo/prism-observability`. Record that.
      - (e) **`prism dev`.** `src/cli-dev.ts:33-46` is the host-library string load to delete. It is not the only kernel string: `src/cli-providers.ts:17` builds `@arnilo/prism-provider-${id}` for the installer and stays (Phase 5). The surface gate scans `packages/hosts/*/src`, not those kernel strings.
    - Functional: Re-measure the importers of every name Part B retires (`createMessagingRuntime`, `MessagingRuntimeOptions`, `resolveAgent` in channels types, `wrapAgentWithFailureInjection`, `@arnilo/prism-core/governance/evals`, `@arnilo/prism-coding-tools/dev`, `@arnilo/prism-coding-tools/dev/cli`, `createPrismDevInspector`, `createDevRouter`, `runDevCli`, `runDevCommand`/`prism dev`) per workspace, with the command. Assign each file to Task 2, 3, or 4.
    - Functional: Record the failing-test baseline and compare it with plan 161's close.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites its command.
    - Security: Confirm no channel option, eval judge config, or devtools option carries a literal secret field after the decisions. The Telegram token and the Signal account credential are refs.
  - Approach:
    - Documentation Reviewed:
      - plan 161 Task 1 Notes and the shipped `packages/hosts/{acp,mcp-server}`
      - `packages/prism-channels/src/{types,runtime-turn,approvals,telegram,signal}.ts`
      - `packages/prism-core/src/governance/evals/**`, `packages/prism-coding-tools/src/dev/**`, `src/cli-dev.ts`
    - Options Considered:
      - Fold this into plan 161 Task 1. Rejected: Part A's tasks can change the allow-list and the mapping Part B relies on.
    - Chosen Approach:
      - Re-read the cited spans, re-run the counts, and amend Tasks 2–5 in place.
    - API Notes and Examples:
      ```bash
      graft callers createMessagingRuntime --depth all
      graft callers wrapAgentWithFailureInjection --depth all
      graft callers createPrismDevInspector --depth all
      ```
    - Files to Create/Edit:
      - `plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md`: Notes and amendments only.
    - References:
      - plan 160 Task 1 (entry-check pattern)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - **Read-only execution.** Verified contracts, baseline, retired symbol counts, and decisions. Verdict: no later task is invalidated. Proceed with Tasks 2–5 as planned.
    - **Confirmed contracts from Part A:**
      - `scripts/host-surface-allowlist.json` exists and matches plan 161 Task 1 (a) exactly (`frozen`: 34 names; `phase11`: 24 names; `phase16`: `CheckpointStore`, `LeaseStore`, `LeaseRecord`).
      - Approval mapping & kernel-ask distinction: shipped in `@arnilo/prism-acp` (`packages/hosts/acp/src/{serve,host,permission}.ts`) and `@arnilo/prism-mcp-server`. Turns run with `interactive: false` (or `HostUi` answers `unavailable` when `request.package === undefined`), yielding `RunResult.pending` with `PendingDecision[]`. Approvals map fail-closed (`allow_once`↔`allow_once`, `allow_always`↔`allow_for_run`, `reject_once`↔`reject_once`, `reject_always`↔`reject_for_run`, with cancel/unknown falling back to `reject_once`, never allow), and resume via `session.resume(decisions, { interactive: false })`.
      - Routing `HostPort` pattern: `acpHost` and `mcpHost` use a module-scoped `WeakSet` brand (`brandAcpHost`/`brandMcpHost`) and dispatch based on the kernel-stamped `request.sessionId`.
      - Task 1 (j) items confirmed in source:
        - Channels: `resolveAgent` maps alias -> `Agent` (`packages/prism-channels/src/types.ts:405`); approvals use `CheckpointStore` (`approvals.ts:4`); `createAgentRunLifecycle` is imported in `runtime-turn.ts:1`.
        - Evals: `wrapAgentWithFailureInjection` spreads `{ ...agent, config }` or calls `createAgent(config)` (`scenarios.ts:262-275`); `workflow-experiment.ts` drives `runtime/workflows` and stays in `prism-core`.
        - Four `prism-core` relative importers of evals: `governance/prompts/promotion.ts:2`, `governance/observability/timeline.ts:21` (`EvaluationTrace`), `enterprise/postgres/types.ts:5`, `enterprise/postgres/evaluations.ts:10`.
        - Devtools: `packages/prism-coding-tools/src/dev/server.ts:30-31` imports `governance/observability` and `runtime/server`; `src/cli-dev.ts:33-46` is the loader to delete while `src/cli-providers.ts:17` stays.
        - Lab impact (probe 12): `rg 'prism-channels|governance/evals|prism-evals|coding-tools/dev|prism-dev' packages/prism-code` found 0 matches. No lab module becomes deletable.
    - **Decisions (a)–(e):**
      - **(a) Channels agent model:** One `Agent` per `connect*` call (`connectTelegram(agent, options)`, `connectSignal(agent, options)`), matching roadmap §2.8 and the other host libraries. Dynamic agent resolution via aliases (`resolveAgent`) within a single bot connection is removed; hosts multiplexing multiple agents call `connect*` once per agent and handle external routing.
      - **(b) Channels approvals:** Turns run with `interactive: false`. A suspended run produces `RunResult.pending`, which the approval store (`approvals.ts`) formats into a chat approval action. The user's callback/reply maps to `session.resume(decisions)`. Kept on `CheckpointStore` (allow-listed under `phase16`).
      - **(c) Evals split:** All modules in `packages/prism-core/src/governance/evals/` (`citations.ts`, `comparison.ts`, `curate.ts`, `dataset.ts`, `erp-invariants.ts`, `errors.ts`, `experiment.ts`, `feedback.ts`, `index.ts`, `judge.ts`, `limits.ts`, `scenarios.ts`, `score.ts`, `scorer.ts`, `store.ts`, `threshold.ts`, `trace.ts`, `trajectory.ts`, `types.ts`, `util.ts`, and `__tests__/`) move to `packages/hosts/evals/src/`. `workflow-experiment.ts` stays in `prism-core` because it drives `runtime/workflows` (re-scoped in Phase 16). The four relative importers in `prism-core` (`promotion.ts`, `timeline.ts`, `postgres/{types,evaluations}.ts`) and `workflow-experiment.ts` repoint their imports to `@arnilo/prism-evals`.
      - **(d) Devtools transport:** Devtools serves directly on `Bun.serve` instead of `@arnilo/prism-core/runtime/server`'s `PrismRequestHandler`. The timeline panel and its `projectAgentTimeline` import are dropped for Phase 10 until Phase 16 moves timeline projection to `@arnilo/prism-observability`. Pre-existing `ui.test.ts` 500 error on `./inspector.js` asset serving will be resolved in `packages/hosts/devtools` by emitting or bundling the script cleanly.
      - **(e) `prism dev`:** Delete `src/cli-dev.ts` and dispatch in `src/cli-runner.ts` / `src/cli.ts`. `src/cli-providers.ts:17` remains for Phase 5 installer support.
    - **Retired symbol importer counts & assignments:**
      Command: `rg -l -F <name> src packages scripts examples docs -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**' -g '!plans/**'`
      - `createMessagingRuntime` (25): `packages/prism-channels` (9: `index.ts`, `runtime.ts`, 5 tests, README, CHANGELOG) -> Task 2; `examples` (5: `messaging-outbox.ts`, `messaging-agent.ts`, `signal-agent.ts`, `telegram-agent.ts`, README) -> Task 2; `scripts` (5: `budgets.json`, `arnilo__prism-channels.txt`, 3 fixtures) -> Task 2; `docs` (6: `migrate-to-0.8.md`, `messaging-channels.md`, `messaging-channel-operations.md`, `enterprise-postgres-state.md`, `telegram-channel.md`, `signal-channel.md`) untouched.
      - `MessagingRuntimeOptions` (18): `packages/prism-channels` (10: `types.ts`, `telegram.ts`, `index.ts`, `runtime-types.ts`, `runtime.ts`, 3 tests, README, CHANGELOG) -> Task 2; `examples` (2: `telegram-agent.ts`, `signal-agent.ts`) -> Task 2; `scripts` (2: `budgets.json`, `arnilo__prism-channels.txt`) -> Task 2; `docs` (4) untouched.
      - `resolveAgent` (in channels) & `agentAliases`: `packages/prism-channels` (8) -> Task 2; `examples` (2: `messaging-outbox.ts`, `messaging-agent.ts`) -> Task 2; `scripts` (2 fixtures) -> Task 2; `docs` (1) untouched.
      - `wrapAgentWithFailureInjection` (9): `packages/prism-core` (3: `scenarios.ts`, `index.ts`, `scenarios.test.ts`) -> Task 3; `packages/prism-coding-tools` (1: `eval-compare.test.ts`) -> Task 3; `examples` (1: `behavior-evaluation.ts`) -> Task 3; `scripts` (2: `e2e-070-host-completeness-journey.mjs`, `arnilo__prism-core.txt`) -> Task 3; `docs` (2) untouched.
      - `@arnilo/prism-core/governance/evals` (26): `packages/prism-core` (README, plus 4 relative importers + `workflow-experiment.ts`) -> Task 3; `packages/prism-coding-tools` (1: `eval-compare.test.ts`) -> Task 3; `packages/tools/{browser,coding}` (2 eval fixtures) -> Task 3; `src/__tests__/install-smoke.test.ts` (1) -> Task 3; `examples` (6: `run-feedback.ts`, `guardrail-packs.ts`, `evals.ts`, `evaluation-gate.ts`, `behavior-evaluation.ts`, `coding-browser-evaluation.ts`) -> Task 3; `scripts` (4) -> Task 3; `docs` (11) untouched.
      - `@arnilo/prism-coding-tools/dev` (12): `packages/prism-coding-tools` (3: README, `cli.ts`, `index.ts`) -> Task 4; `src` (2: `cli-dev.ts`, `install-smoke.test.ts`) -> Task 4; `scripts` (1 fixture) -> Task 4; `docs` (6) untouched.
      - `@arnilo/prism-coding-tools/dev/cli` (5): `packages/prism-coding-tools` (2: README, `cli.ts`) -> Task 4; `src/cli-dev.ts` -> Task 4; `scripts` (1 fixture) -> Task 4; `docs` (2) untouched.
      - `createPrismDevInspector` (13): `packages/prism-coding-tools` (8: `cli.ts`, `index.ts`, 5 tests, conformance) -> Task 4; `scripts` (4) -> Task 4; `docs` (1) untouched.
      - `createDevRouter` (4): `packages/prism-coding-tools` (2: `server.ts`, `index.ts`) -> Task 4; `scripts` (2) -> Task 4.
      - `runDevCli` (9): `src` (2: `cli-dev.ts`, `cli-dev.test.ts`) -> Task 4; `packages/prism-coding-tools` (3: `cli.ts`, test) -> Task 4; `scripts` (3) -> Task 4; `docs` (2) untouched.
      - `prism dev` / `runPrismDevSubcommand` (14): `src` (3: `cli-runner.ts`, `cli-dev.ts`, `cli-dev.test.ts`) -> Task 4; `packages/prism-coding-tools` (5) -> Task 4; `scripts` (1 baseline) -> Task 4; `docs` (6) untouched.
    - **Security:**
      - Telegram bot token and Signal account credentials: refs (`env:`/`keyring:`). Literal values fail `connect*` with named errors (`ERR_PRISM_CHANNEL_TOKEN_LITERAL`). `env:` refs resolve via `process.env`; custom/keyring refs resolve via `agent.config.slots?.credentials` if provided. Resolved values are passed to `agent.config.redactor` and asserted never to appear in events, logs, or chat replies.
      - Evals judge model configs use `ModelRef` strings, never raw secrets.
      - Devtools loopback binding default; remote binding requires token ref and authenticates each request; route data redacted via agent redactor.
    - **Baseline vs plan 161 close:**
      - `bun run build:core`: exit code 0.
      - `bun run typecheck`: exits 1 on the exact same 2 pre-existing errors from plan 160/161 (`@arnilo/prism-tools-coding` on `ExecutionAction`/`ExecutionDecision`/`ExecutionPolicy`, and `@arnilo/prism-tools-web` on `src/obscura/__tests__/browser.test.ts`). All 59 other packages typecheck cleanly (`@arnilo/prism-channels`, `@arnilo/prism-core`, `@arnilo/prism-coding-tools`, `@arnilo/prism-acp`, `@arnilo/prism-ag-ui`, `@arnilo/prism-mcp-server`, `@arnilo/prism-acp-agent` all pass).
      - `node scripts/release.mjs gate`: exits 1 on `@arnilo/prism-tools-coding` declaration emit (pre-existing blocker).
      - `packages/prism-channels`: `bun test` passes (186 pass, 6 skip, 0 fail).
      - `packages/prism-core` evals: `bun test src/governance/evals` passes (64 pass, 0 fail).
      - `packages/prism-coding-tools` dev: `bun test src/dev` 39 pass, 1 fail (`ui.test.ts` pre-existing 500 error due to `src/dev/ui/inspector.js` not found when running from source; Task 4 resolves this).
    - **Verdict:**
      - All acceptance criteria are met. No finding invalidates Tasks 2–5. Proceed with Task 2.

- [x] Task 2: `@arnilo/prism-channels` — `connectTelegram` and `connectSignal` over one `Agent`
  - Acceptance Criteria:
    - Functional: `packages/prism-channels` moves with `git mv` to `packages/hosts/channels` as a TypeScript-source package. The name stays `@arnilo/prism-channels`, and the `./telegram` and `./signal` subpaths point at `src/`.
    - Functional: `connectTelegram(agent, options)` and `connectSignal(agent, options)` build the adapter, state store, journal, pairing, and admission from options and return `{ handle(update), start(), close() }`. A chat binds to `agent.session({ id })`, with the binding persisted in the channel state store. A turn runs `session.run(text, { interactive: false })`.
      - `suspended` → one approval prompt per pending decision through the approval store. The reply maps to `allow_once`/`reject_once` (and `allow_for_run` when the adapter offers it), then `session.resume(decisions)`.
      - `completed`/`stopped` → reply delivery through the journal.
      - `failed` → the redacted error message.
    - Functional: `createMessagingRuntime`, `resolveAgent`, agent aliases (per Task 1 (a)), and `createAgentRunLifecycle` use (`runtime-turn.ts:1`) are deleted. The transport-neutral pieces (`createChannelStateStore`, `createChannelDeliveryJournal`, `createChannelPairingStore`, limits, adapters, `createTelegramWebhookHandler`) keep their exports. Every importer Task 1 named is migrated in this task: `examples/{messaging-agent,messaging-outbox,telegram-agent,signal-agent}.ts`, `scripts/fixtures/messaging-soak.mjs`, and the scripts counted.
    - Functional: Repo-wide grep for `createMessagingRuntime|MessagingRuntimeOptions|agentAliases` finds only released `/docs` (listed) and baselines.
    - Performance: Limits and pruning defaults are unchanged (`packages/prism-channels/src/limits.ts`). One session per chat, with no agent per chat. The live tests (`test:live`) and the Postgres integration keep their opt-in gates.
    - Code Quality: Imports only allow-listed names. Constructs no agent. The runtime split modules (`runtime-{admit,core,reconcile,turn}.ts`) keep their structure. Only the turn driver changes.
    - Security:
      - The Telegram bot token and the Signal account credential are refs (`env:`/`keyring:`), resolved through `agent`'s credentials. A literal value fails `connect*` with a named error.
      - Admission and pairing still gate every update before a session opens.
      - An approval reply from a user other than the bound principal, or for an unknown approval id, is rejected and the tool never runs.
      - Tests assert the token never appears in events, errors, or delivered messages.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-channels/src/{runtime,runtime-turn,runtime-types,approvals,identity,types}.ts`
      - plan 161 Task 2 (suspension → protocol approval → resume)
    - Options Considered:
      - Keep `resolveAgent` with aliases. Rejected: the roadmap signature is `connectTelegram(agent, …)`, and a resolver that picks agents is host routing, not a surface.
      - Answer approvals inline through a chat `HostUi`. Rejected: a chat reply can arrive minutes later or after a restart. Suspension persists through the store slot, and resume works from a new process.
    - Chosen Approach:
      - Keep the durable channel machinery. Replace the lifecycle turn driver with `Session` plus suspension and resume. Bind one agent per connection.
    - API Notes and Examples:
      ```ts
      import { connectTelegram } from "@arnilo/prism-channels/telegram";
      const bot = await connectTelegram(agent, { token: "env:TELEGRAM_BOT_TOKEN", pairing: { ttlMs: 600_000 } });
      Bun.serve({ port: 8080, fetch: (req) => bot.handle(req) });
      ```
    - Files to Create/Edit:
      - `packages/hosts/channels/**`: moved. `src/runtime.ts` and `src/runtime-turn.ts` rewritten. `src/{telegram,signal}.ts` gain `connect*`. `src/types.ts` drops `resolveAgent` and aliases.
      - Root `package.json` `workspaces`: `packages/prism-channels` removed.
      - Importers listed above, plus `examples/tsconfig.json`.
      - Enforcement rows: `scripts/package-truth.mjs` and regenerated `package-truth.json`, `src/__tests__/{packaging,release}.test.ts`, `scripts/independent-packages.json`, `scripts/compat-baseline/arnilo__prism-channels.txt` regenerated, `scripts/{budgets,coverage-thresholds,live-matrix,e2e-coverage}.json`, `scripts/phase54-package-map.mjs` and evidence, `scripts/phase24-truth.test.mjs`, `scripts/version-literal-gate.test.mjs`, `bun.lock`.
      - `CHANGELOG.md`.
    - References:
      - plan 161 Task 2, plan 153 (store slot suspension across restart)
  - Test Cases to Write:
    - `connect_telegram_turn_runs_bound_session`: two messages in one chat continue one session.
    - `connect_telegram_approval_reply_resumes`: an approve reply runs the gated tool once, and a deny reply does not.
    - `channels_approval_survives_restart`: suspend, rebuild the agent and connection over the same stores, reply, and the tool runs once.
    - `channels_approval_foreign_user_rejected`
    - `connect_rejects_literal_token`
    - `channels_never_emit_token`
    - `connect_signal_turn_and_approval`: the same two behaviors over the Signal adapter fixture.
    - The moved state, recovery, pairing, and Postgres integration suites pass from the new location.
    - `channels_host_library_uses_public_api`: allow-list scan plus no `createAgent`.
    - `examples_demos_run_to_completion_and_emit_no_secret` passes for the four messaging examples.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new entry points and removed runtime.
    - Docs pages to create/edit:
      - `packages/hosts/channels/README.md`: host-library page (`connectTelegram`, `connectSignal`, approvals, pairing, limits, ref-only secrets, example).
      - Released `docs/messaging-channels.md`, `docs/telegram-channel.md`, `docs/signal-channel.md`, `docs/messaging-channel-operations.md`: untouched.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate with `node scripts/release.mjs gate --update-baseline`. Record the diff and attribution in the task note.
  - Notes (executed 2026-10-10):
    - **What changed.** Moved `packages/prism-channels` to `packages/hosts/channels` using `git mv`. Package now publishes TypeScript source directly (`"exports": { ".": "./src/index.ts", "./telegram": "./src/telegram.ts", "./signal": "./src/signal.ts" }`, no `dist/`, no build script). Root `package.json` workspaces updated from `packages/prism-channels` to `packages/hosts/channels`. Deleted `createMessagingRuntime`, `resolveAgent`, `agentAliases` (Task 1 (a)), and `createAgentRunLifecycle` turn driver usage.
    - **Runtime & Connectors.** Implemented `connectTelegram(agent, options)` and `connectSignal(agent, options)` returning `ChannelConnectionHandle` (`{ handle, start, close, stop, drain }`). Created `createChannelRuntime(agent, options)` to drive chat turns over `agent.session({ id })` using `session.run(text, { interactive: false })`.
    - **Approvals & Suspension.** Runs resulting in `pending` suspensions generate approval requests via `createChannelApprovalStore`; inbound chat approval replies (or callbacks) resolve the pending run via `session.resume(decisions, { interactive: false })`. Route state persists pending `approvalId` across restarts. Fixed `session.ts` (`prepareResume`/`continueSuspendedRun`) to pass ownership scopes to checkpoint CAS saves.
    - **Secret Refs.** Added `packages/hosts/channels/src/secret-ref.ts`: Telegram bot token and Signal account credentials require `env:` or `keyring:` refs (`resolveChannelSecretRef`). Literal tokens throw `ChannelTokenLiteralError` (`ERR_PRISM_CHANNEL_TOKEN_LITERAL`). Added `createChannelRedactor` to assert and prevent secret emission into replies, errors, or events. Added `createMemoryCheckpointStore` and `createMemoryLeaseStore` in `src/memory-stores.ts` for standalone memory-backed deployments.
    - **Identity & Authorization.** Populated default identity in `runtime-core.ts` with `tenantId`, `userId`, `issuedAt`, and `verified: true` to satisfy `assertIdentityActive` during turns.
    - **Callers and Examples migrated.**
      - `examples/telegram-agent.ts`: uses `connectTelegram(agent, { token: "env:TELEGRAM_BOT_TOKEN" })`.
      - `examples/signal-agent.ts`: uses `connectSignal(agent, { account: "env:SIGNAL_ACCOUNT" })`.
      - `examples/messaging-agent.ts`: migrated to `createChannelRuntime(agent, ...)`.
      - `examples/messaging-outbox.ts`: migrated to `createChannelRuntime(agent, ...)`.
      - `examples/README.md`: updated descriptions.
      - `examples/tsconfig.json`: paths point to `packages/hosts/channels/src`. `npx tsc -p examples/tsconfig.json --noEmit` exits 0.
      - `scripts/fixtures/messaging-restart-worker.mjs`, `scripts/fixtures/messaging-soak.mjs`, `scripts/fixtures/e2e-full-surface-journey.mjs`, `scripts/e2e-full-surface.test.mjs`, `scripts/tooling-gate.test.mjs`, `scripts/run-all-tests.test.mjs`, `src/__tests__/install-smoke.test.ts`, and `src/__tests__/packaging.test.ts` updated to reference `@arnilo/prism-channels` at `packages/hosts/channels`.
    - **Tests & Conformance.** Created `packages/hosts/channels/src/__tests__/connect.test.ts` with 8 comprehensive test cases (`connect_telegram_turn_runs_bound_session`, `connect_telegram_approval_reply_resumes`, `channels_approval_survives_restart`, `channels_approval_foreign_user_rejected`, `connect_rejects_literal_token`, `channels_never_emit_token`, `connect_signal_turn_and_approval`, `channels_host_library_uses_public_api` verifying host-surface allowlist and zero `createAgent` calls). Entire test suite in `packages/hosts/channels` passes (101 pass, 3 skip).
    - **Baselines & Gate.** Regenerated `scripts/package-truth.json` via `scripts/package-truth.mjs`. Regenerated compat baseline `scripts/compat-baseline/arnilo__prism-channels.txt` via `node scripts/release.mjs gate --package @arnilo/prism-channels --update-baseline --skip-tarball`. Compat diff reflects retirement of `createMessagingRuntime`, `MessagingRuntimeOptions`, `MessagingRuntimeDrainResult`, `resolveAgent`, and `agentAliases`, and introduction of `connectTelegram`, `connectSignal`, `createChannelRuntime`, `createMemoryCheckpointStore`, `createMemoryLeaseStore`, `resolveChannelSecretRef`, `createChannelRedactor`, and identity helpers. Grep for retired symbols across non-doc files only returns historical notes and baselines.

- [x] Task 3: `@arnilo/prism-evals` out of `@arnilo/prism-core/governance/evals`
  - Acceptance Criteria:
    - Functional: `packages/hosts/evals` exists (`"name": "@arnilo/prism-evals"`, `"exports": { ".": "./src/index.ts" }`, peer `@arnilo/prism`, README, CHANGELOG, LICENSE). The modules Task 1 (c) assigned move with `git mv` from `packages/prism-core/src/governance/evals/`, with their tests. Exports keep their 0.12 names and signatures, except the failure-injection change below.
    - Functional: `wrapAgentWithFailureInjection(agent, injection)` is deleted (`scenarios.ts:262-275`). Two pieces replace it:
      - `failureInjection(injection)` returns an `AgentConfig.hooks` function: `tool.call` denies `denyTools`, and a `tool.execute` around returns an unknown-effect result for `unknownEffect` without running the mutating `execute`
      - `failingStore(store)` wraps a `SessionStore` for `failStore`, so the run fails at its first append

      Scenario runners that took an agent take an `(extra: Pick<AgentConfig, "hooks" | "slots">) => Promise<Agent>` factory, so the host builds the agent through `createAgent`.
    - Functional: The `@arnilo/prism-core/governance/evals` subpath is removed. The `prism-core` modules that import evals (`governance/prompts/promotion.ts`, `governance/observability/timeline.ts`, `enterprise/postgres/{types,evaluations}.ts`) import `@arnilo/prism-evals` instead. `workflow-experiment.ts` stays in `prism-core` per Task 1 (c), importing the moved types. Every importer Task 1 named is migrated in this task: `examples/{evals,behavior-evaluation,evaluation-gate,coding-browser-evaluation,run-feedback}.ts`, scripts and fixtures, and `prism-core` tests.
    - Functional: Repo-wide grep for `governance/evals|wrapAgentWithFailureInjection` finds only released `/docs` (listed) and baselines.
    - Performance: No behavior change in scoring or judging. A judge's model calls are unchanged, and the README states the per-case judge cost and the deterministic scorers that avoid it.
    - Code Quality: Imports only allow-listed names (feedback and persistence records carry the Phase 11 tag). Constructs no agent, and no `{ ...agent }` spread remains.
    - Security: The failure-injection deny goes through `tool.call`, so it composes with approval and governance and never widens them. Judge model refs are refs. Redaction of traces is unchanged, and the moved redaction tests pass.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-core/src/governance/evals/{index,scenarios,experiment,judge,trace,trajectory,workflow-experiment}.ts`
      - `src/hooks/types.ts:196-209` (`tool.call` decide, `tool.execute` around)
      - `docs/next/hooks.md`, `docs/next/slots.md`
    - Options Considered:
      - Keep `wrapAgentWithFailureInjection` and rebuild the agent inside with `createAgent(agent.config)`. Rejected: a resolved config does not round-trip packages (their `setup` ran already), and a surface must not build agents.
      - Make failure injection a `definePackage`. Rejected: a host library exporting a package blurs §2.8. A `hooks` function plus a store wrapper is all a host needs.
    - Chosen Approach:
      - Move the library. Express failure injection with hooks and a store wrapper on a host-built agent.
    - API Notes and Examples:
      ```ts
      import { failureInjection, failingStore, runScenario } from "@arnilo/prism-evals";
      await runScenario(scenario, (extra) => createAgent({ model, packages, ...extra }), {
        hooks: failureInjection({ denyTools: ["shell"] }),
      });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/**`: new. Moved modules and tests. `src/failure-injection.ts` new.
      - `packages/prism-core/{package.json,README.md,src/governance/prompts/promotion.ts,src/enterprise/postgres/{types,evaluations}.ts,src/governance/evals/workflow-experiment.ts}`: subpath removed, imports repointed.
      - Importers listed above.
      - Enforcement rows: the Task 2 set, with `scripts/compat-baseline/arnilo__prism-evals.txt` new and `arnilo__prism-core.txt` regenerated.
      - `CHANGELOG.md`.
    - References:
      - plan 160 Task 2 (moving a `prism-core` governance subpath out)
  - Test Cases to Write:
    - `failure_injection_denies_through_tool_call`: a denied tool never executes, and `tool.call` observers see the deny.
    - `failure_injection_unknown_effect_skips_execute`: the mutating `execute` is never called, and the result is unknown, never success.
    - `failing_store_fails_first_append`
    - `scenario_runner_builds_agent_through_factory`: the factory is called once per scenario, and no agent is spread.
    - The moved evals suites pass from `packages/hosts/evals`. The `prism-core` prompt-promotion and Postgres evaluation tests pass against the new import.
    - `evals_host_library_uses_public_api`: allow-list scan plus no `createAgent` and no object spread of an `Agent`.
    - `examples_demos_run_to_completion_and_emit_no_secret` passes for the evals examples.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new library; failure injection reshaped.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: host-library page (datasets, scorers, judges and their cost, scenarios with the factory, failure injection, example).
      - `packages/prism-core/README.md`: evals subpath removed, with a pointer.
      - Released `docs/evaluations.md`: untouched.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate with `node scripts/release.mjs gate --update-baseline`. Record the moved and removed exports, attributed to this plan.
  - Notes (executed 2026-10-10):
    - **What changed.** Created host library `packages/hosts/evals` (`@arnilo/prism-evals`) exporting datasets, scorers, judges, experiments, and scenarios. Source files and tests moved from `packages/prism-core/src/governance/evals/` to `packages/hosts/evals/src/` via `git mv`. Root `package.json` workspaces already include `packages/hosts/*`. Removed `./governance/evals` subpath export from `packages/prism-core/package.json` and updated `packages/prism-core/README.md`. Preserved `workflow-experiment.ts` and its unit tests in `packages/prism-core/src/governance/evals/`, repointing their imports to `@arnilo/prism-evals`.
    - **Failure Injection Architecture.** Deleted `wrapAgentWithFailureInjection(agent, injection)`. Implemented two clean primitives in `packages/hosts/evals/src/failure-injection.ts`:
      - `failureInjection(injection)`: Hook returning `tool.call` decision (denying tools matching `denyTools` with reason `Hook denied tool execution (eval failure injection)`) and `tool.execute` around wrapper returning an `unknown-effect` result for tools matching `unknownEffect` without running mutating execute.
      - `failingStore(store)`: Wraps a `SessionStore` to reject on `append` when `failStore` is enabled.
      - Updated `runScenario` to accept `AgentFactory: (extra: Pick<AgentConfig, "hooks" | "slots">) => Promise<Agent>` so the host constructs the agent directly via `createAgent` instead of mutating or wrapping an existing instance.
    - **Cyclic Build Decoupling.** Decoupled `packages/hosts/evals` from static `@arnilo/prism-core` compile-time dependencies to prevent TS5055 declaration emit conflicts when `@arnilo/prism-core` consumes `@arnilo/prism-evals`: locally declared `ExecutionStep`, `ExecutionTimeline`, and `TimelineFolder` types in `packages/hosts/evals/src/types.ts` and dynamically resolved `createTimelineFolder`, `projectTraceTimeline`, and `createJsonSchemaArgumentValidator`.
    - **Callers & Importers Migrated.**
      - `packages/prism-core`: `governance/prompts/promotion.ts`, `governance/observability/timeline.ts`, `enterprise/postgres/{types,evaluations}.ts`, `governance/evals/workflow-experiment.ts`, `runtime/__tests__/realtime.test.ts`, and core tests migrated to `@arnilo/prism-evals`.
      - `examples/`: `evals.ts`, `behavior-evaluation.ts`, `evaluation-gate.ts`, `coding-browser-evaluation.ts`, `guardrail-packs.ts`, and `run-feedback.ts` migrated to `@arnilo/prism-evals` and factory pattern. `tsc -p examples --noEmit` exits 0.
      - `packages/prism-coding-tools`: updated `devDep` to `@arnilo/prism-evals` and repointed `src/dev/__tests__/eval-compare.test.ts`.
      - `packages/tools/browser`: updated `devDep` and repointed `src/__tests__/eval-fixtures.test.ts`.
      - `packages/tools/coding`: updated `devDep` and repointed `src/agent/__tests__/eval-fixtures.test.ts`.
      - `scripts/`: `e2e-070-host-completeness-journey.mjs`, `e2e-full-surface-journey.mjs`, `e2e-full-surface.test.mjs`, and `phase27-erp-journey.test.mjs`.
      - `src/__tests__/install-smoke.test.ts`: added `@arnilo/prism-evals` package entry and updated composition import.
    - **Tests & Conformance.** Implemented and verified test suite in `packages/hosts/evals/src/__tests__/scenarios.test.ts`:
      - `failure_injection_denies_through_tool_call`: denied tool never executes; observers see deny in messages.
      - `failure_injection_unknown_effect_skips_execute`: mutating execute skipped; outcome marked unknown.
      - `failing_store_fails_first_append`: store append fails with injected error.
      - `scenario_runner_builds_agent_through_factory`: agent built via factory per scenario turn, no agent spread.
      - `evals_host_library_uses_public_api`: scans all imports from `@arnilo/prism` against `scripts/host-surface-allowlist.json`, ensuring zero `createAgent` calls and zero `{ ...agent }` object spreads.
      - Entire `packages/hosts/evals` suite passes (65 pass, 0 fail across 7 files).
      - Core test suite passes (`bun run --filter @arnilo/prism-core test`: 434 pass, 48 skip, 0 fail).
    - **Baselines & Gate.**
      - Regenerated `scripts/package-truth.json` via `node scripts/package-truth.mjs`.
      - Generated `scripts/compat-baseline/arnilo__prism-evals.txt` via `node scripts/release.mjs gate --package @arnilo/prism-evals --update-baseline --skip-tarball`.
      - Regenerated `scripts/compat-baseline/arnilo__prism-core.txt` via `node scripts/release.mjs gate --package @arnilo/prism-core --update-baseline --allow-break --skip-tarball`, reflecting removal of `./governance/evals` export and `wrapAgentWithFailureInjection`.
      - Both packages pass release gate checks cleanly (`updated: false`).

- [x] Task 4: `@arnilo/prism-devtools` out of `@arnilo/prism-coding-tools/dev`; retire `prism dev`
  - Acceptance Criteria:
    - Functional: `packages/hosts/devtools` exists (`"name": "@arnilo/prism-devtools"`, `"exports": { ".": "./src/index.ts" }`, `"bin": { "prism-devtools": "./bin/prism-devtools.ts" }`). The `prism-coding-tools/src/dev/**` modules move with `git mv`.
    - Functional: `serveDevtools(agent, { port?, hostname? })` replaces `createPrismDevInspector`. It serves the inspector UI on `Bun.serve` (Task 1 (d)), bound to `127.0.0.1` by default, with JSON routes for:
      - `agent.inspect()`
      - `agent.sessions` list and get
      - `session.entries()`
      - a server-sent stream of `agent.subscribe()` plus the selected session's `subscribe()`
      - replay and compare over stored entries

      `createDevRouter` and the `PrismRequestHandler` dependency are deleted. The timeline panel is removed per Task 1 (d) and recorded in Further Actions for Phase 16.
    - Functional: The `prism-devtools` bin parses `--root`, `--model`, `--trust-project`, and `--port`, builds the agent with `loadManifest` and `createAgent`, and calls `serveDevtools`.
    - Functional: The kernel `src/cli-dev.ts` and the `prism dev` subcommand are deleted, with the `src/cli.ts` dispatch entry and their tests. The `./dev` and `./dev/cli` subpaths leave `@arnilo/prism-coding-tools`. Every importer Task 1 named is migrated in this task.
    - Functional: Repo-wide grep for `prism-coding-tools/dev|prism-dev/cli|createPrismDevInspector|createDevRouter|runDevCli|prism dev\b` finds only released `/docs` (listed: `docs/dev-inspector.md`, `docs/cli-rpc.md`) and baselines.
    - Performance: The inspector loads nothing until `serveDevtools` is called. Event streaming is bounded by the existing UI buffer limits (recorded in the README).
    - Code Quality: Imports only allow-listed names. Constructs no agent outside the bin's `createAgent` call. The bin is a host, and the gate in Task 5 allows `createAgent` in `bin/` only.
    - Security: Binds loopback by default. A non-loopback `hostname` requires an explicit `token` option (a ref), checked on every route. Without one, `serveDevtools` throws a named error. Entries and events are served redacted, and a test asserts that a secret in the agent's secret set never appears in any route's body.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-coding-tools/src/dev/{index,server,cli,replay,compare,composition}.ts`, `src/dev/ui/**`
      - `src/cli-dev.ts:33-46`, `src/cli.ts`
      - `docs/next/agent.md` (`inspect`, `subscribe`, `sessions`, `entries`)
    - Options Considered:
      - Keep `prism dev` in the kernel CLI, loading `@arnilo/prism-devtools` by name. Rejected: the kernel would name a package (roadmap §1.4), and the `prism` bin is the manifest CLI.
      - Keep `PrismRequestHandler` from `prism-core`. Rejected: it couples a host library to a 0.12 family package that Phase 11 deprecates, and `Bun.serve` covers the routes.
    - Chosen Approach:
      - Move the library, serve it on `Bun.serve` over the public `Agent`, ship its own bin, and delete the kernel loader.
    - API Notes and Examples:
      ```ts
      import { serveDevtools } from "@arnilo/prism-devtools";
      const devtools = serveDevtools(agent, { port: 4319 });
      console.log(devtools.url);
      ```
    - Files to Create/Edit:
      - `packages/hosts/devtools/**`: new. Moved modules, `src/serve.ts` new, `bin/prism-devtools.ts` new.
      - `packages/prism-coding-tools/{package.json,README.md}`: `./dev`, `./dev/cli` removed.
      - `src/cli-dev.ts` (deleted), the `prism dev` dispatch in `src/cli-runner.ts` (the plan said `src/cli.ts`; the dispatch lived in `cli-runner.ts`), `src/__tests__/cli-dev.test.ts` (deleted), and `src/__tests__/cli-retired-dev.test.ts` (new).
      - `scripts/phase40-security.test.mjs` (deleted; not in the original list). Its dev-inspector legs are re-expressed in `packages/hosts/devtools/src/__tests__/serve.test.ts`, and its decision-resume leg retires with the decision route (see Notes).
      - `packages/hosts/devtools/src/ui/{inspector,assets}.ts` rewritten (the old page drove prompt, decision, and timeline panels that this task removes); `src/bun.d.ts` (ambient `Bun` declarations; see Notes).
      - Importers named by Task 1.
      - Enforcement rows: the Task 2 set, with `scripts/compat-baseline/arnilo__prism-devtools.txt` new, `arnilo__prism-coding-tools.txt` and `arnilo__prism.txt` regenerated.
      - `CHANGELOG.md`.
    - References:
      - plan 150 (manifest CLI scope)
  - Test Cases to Write:
    - `devtools_inspect_route_matches_agent_inspect`
    - `devtools_streams_agent_and_session_events` (amended: the agent feed is asserted through `session.opened`; the session feed is asserted as wired, because it sees only its own `Session` instance; see Notes)
    - `devtools_entries_redacted`: a secret never appears in any route body.
    - `devtools_non_loopback_requires_token`: it throws without a token, and requests without the token get 401.
    - `devtools_bin_serves_manifest_agent`
    - `kernel_cli_has_no_dev_command` (in `src/__tests__/cli-retired-dev.test.ts`): `prism dev` exits 2 with `Unknown flag: dev`.
    - The moved replay and compare suites pass.
    - `devtools_host_library_uses_public_api`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new library and bin; `prism dev` removed.
    - Docs pages to create/edit:
      - `packages/hosts/devtools/README.md`: host-library page (`serveDevtools`, the bin, routes, security, example).
      - `packages/prism-coding-tools/README.md`: dev subpaths removed, with a pointer.
      - `docs/next/manifest.md`: if it lists `prism` subcommands, confirm `dev` is absent (it is the manifest CLI page).
      - Released `docs/dev-inspector.md`, `docs/cli-rpc.md`: untouched.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate with `node scripts/release.mjs gate --update-baseline`. Record the diff (kernel CLI exports included) and attribution in the task note.
  - Notes (executed 2026-10-10):
    - **What changed.**
      - Kernel: deleted `src/cli-dev.ts` and `src/__tests__/cli-dev.test.ts`. `src/cli-runner.ts` loses the `dev` dispatch, the `loadDevCli` runtime hook, and the `prism dev` usage line. New `src/__tests__/cli-retired-dev.test.ts`: `prism dev` exits 2 with `Unknown flag: dev`.
      - `packages/hosts/devtools` (`@arnilo/prism-devtools`): `git mv` of `compare.ts`, `replay.ts`, `ui/inspector.ts`, `ui/assets.ts`, and `__tests__/eval-compare.test.ts`; the first three rewritten against the public API. Deleted: `index.ts`, `server.ts`, `cli.ts`, `composition.ts`, and the `bind`, `cli`, `composition`, `server-routes`, and `ui` tests. New: `package.json` (bin `prism-devtools`), `tsconfig.json`, `LICENSE`, `README.md`, `CHANGELOG.md`, `src/{index,serve,security,errors,args}.ts`, `src/bun.d.ts`, `bin/prism-devtools.ts`, and tests `serve`, `ui`, `bin`, `public-api`, with the acp-agent mock-provider fixture copied into `src/__tests__/fixtures/`.
      - `packages/prism-coding-tools`: removed `./dev`, `./dev/cli`, the `prism-dev` bin, and the devDependencies only the inspector used (`ag-ui`, `evals`, `mcp`, `tools-work`). Conformance test, README (a "moved" table), and CHANGELOG (Unreleased → Removed) updated. `dist/` rebuilt clean (see baselines).
      - Sweep edits: `src/__tests__/install-smoke.test.ts` (devtools package entry; `inspectDevInspector` replaced by a `serveDevtools` inspection-route check), `scripts/fixtures/e2e-full-surface-journey.mjs` (dev section → devtools), `scripts/e2e-full-surface.test.mjs` (package list), `scripts/e2e-coverage.json` (`./dev` and `./dev/cli` keys removed; `cli-dev.test.ts` → `cli-retired-dev.test.ts`), `scripts/phase{20,21,26}-freeze.test.mjs` (legacy `packages/prism-dev/` mapping repointed to `packages/hosts/devtools/src/`), `package.json` (threat-suite list), `scripts/package-truth.mjs` and `README.md` (coding-tools family note).
    - **Server design (what the code does).** `serveDevtools(agent, { port, hostname, token })` on `Bun.serve`. Routes under `/api/`: `inspect`, `sessions` (list and get), `sessions/:id/entries`, `replay` (paged over `session.entries()`, starts no run), `events` (SSE: `agent` and `session`), `compare` (POST). Every JSON body and SSE event passes `agent.config.redactor`. Loopback by default; a non-loopback `hostname` requires a `token` ref (`env:NAME`), resolved before the listener exists; a literal token is refused. A set token guards every route, including the page.
    - **Amendments to the approach (applied above).**
      1. **Session feed.** A `Session`'s subscribers belong to that object, and `agent.session()` builds a new one on each call. The `?session=` feed therefore sees only runs on the `Session` the route opened (`acrossRuns: true`). Runs on another instance of the same id are not visible through the public API. The agent feed carries `session.opened`/`session.closed`. A cross-instance session feed needs a kernel change, so it goes to Further Actions.
      2. **Browser module.** Transpiled at serve time with `Bun.Transpiler` (cached), not emitted by `tsc`. The package ships source, so there is no `dist/`. This is the "emit or bundle cleanly" option from Task 1 (d).
      3. **Bun globals.** `src/bun.d.ts` declares the `Bun.serve` and `Bun.Transpiler` members used. `@types/bun` is not loaded: its `fetch` declaration conflicts with `typeof fetch` in the workspace sources that `eval-compare.test.ts` imports into this program (`preconnect` errors in `governance`, `mcp`, `rag`).
      4. **Routes and UI.** The plan's route list has no prompt, run, or decision routes, so none are built. The old page's prompt and decision panels go with them, and the timeline panel is removed per Task 1 (d). The page has inspection, sessions, entries (replay pages), live events (500-row cap), and compare.
      5. **Tokens.** `env:` refs only. `keyring:` refs are not supported in this package.
      6. **`phase40-security.test.mjs` deleted.** Legs: D1 bind is covered by `binds loopback by default` and `devtools_non_loopback_requires_token`; D2 redaction by `devtools_entries_redacted`; D3 ownership by the unknown-session 404; D4 decision-resume retires with the decision route.
    - **Count pins (stale before this task; the devtools package moved them).** The generator reports 60 publishable manifests. `src/__tests__/release.test.ts` pinned 58 and `docs/release-and-install.md`'s prose said 58 (33 capabilities). Both are updated to the generated 60 (35 capabilities). `docs.test.ts`'s retired-name guard no longer lists `@arnilo/prism-evals`: Task 3 reintroduced that name as the live evals library, so the guard's premise no longer holds.
    - **Generated docs (disclosure).** `node scripts/package-truth.mjs --emit-docs` regenerated `docs/index.md`, `docs/release-and-install.md`, `docs/provider-packages.md`, `docs/_evidence/phase54-package-map.md`, and `docs/_evidence/phase74-attention-measurements.md`. The package tables in the first three had been stale since earlier tasks (39 manifests in `docs/index.md`). Two evidence files already had uncommitted edits when this session started, and regenerating overwrote them; git has no copy of that prior content. The phase54 evidence fails its own renderer check both before and after this regeneration (the committed copy also differs from the renderer by 70 lines).
    - **`bun.lock`.** `bun install` regenerated the lock for the whole workspace. Most of the diff is stale entries from earlier moves (`agent-sdk`, `context/*`, `credentials/keyring`) that the lock never recorded, plus the devtools entry and the removed coding-tools devDependencies.
    - **Baselines.** The gate reads `dist/` when it exists, and the stale `dist/` folders still held retired surface, so each package's `dist/` was removed and rebuilt before its baseline was regenerated.
      - `arnilo__prism-devtools.txt`: new, 30 lines.
      - `arnilo__prism-coding-tools.txt` (`--allow-break`): 906 names removed, 0 added, 13 lines remain (the impeccable surface). Of the removed names, 33 are dev surface from this task (`createPrismDevInspector`, `createDevRouter`, `runDevCli`, `Dev*` types, the timeline reducers). The other 873 are the coding, agent, security, and openapi surface moved out in plans 154 and 155, which the baseline had never recorded.
      - `arnilo__prism.txt` (`--allow-break`): 183 names removed, 5 added. Two removals are this task's: `defaultLoadDevCli` and `runPrismDevSubcommand`. The other 181 are names with no remaining export in `src/` (identity, attention, field policy, context budget, secure agent, host composition, and others), which earlier plans moved out without regenerating. The 5 additions (`DEFAULT_INPUT_RESERVE_TOKENS`, `InputCapOptions`, `PackageConfigSource`, `SessionLog`, `createSessionLog`) came from earlier work. A clean root `dist/` build was required for this result, and `build:core` passes.
      - Re-run after regeneration: all three gates report `updated: false`.
    - **Findings for Task 5 (gate).**
      - `packages/hosts/*/bin/` imports `createAgent` and `@arnilo/prism/manifest`, as `acp-agent` already does. The gate needs an explicit `bin/` exemption for `createAgent`, and a decision on the `manifest` subpath, which is neither a deep path nor an allow-listed name.
      - `@arnilo/prism` names devtools uses: `Agent`, `AgentEvent`, `SessionEntry`, `SecretRedactor`, `isSessionNotFound`, `isLoopbackHostname` (plus `createAgent` in the bin). Do not prune these.
      - `packages/hosts/devtools/src/__tests__/public-api.test.ts` is a per-library scan. Task 5 deletes it with the others.
      - `@arnilo/prism-core` and `@arnilo/prism-governance` are still runtime `dependencies` of coding-tools, but nothing in its `src/` imports them any more. Removing them changes the install graph, so it is left for Further Actions.
    - **Sweep result.** `rg` for `prism-coding-tools/dev|prism-dev/cli|createPrismDevInspector|createDevRouter|runDevCli|prism dev|cli-dev|inspectDevInspector` over `src packages scripts examples` finds only: CHANGELOG history, the coding-tools README "moved" table (intentional), `scripts/unused-sweep-report.txt` (a generated report), and `scripts/phase54-package-map.mjs` with its test. The phase54 map records the 0.3-to-0.4 migration (`prism-dev` → `coding-tools/dev`), so it stays as history. `docs/next/manifest.md` has no `dev` subcommand. Released `docs/` pages are untouched except the generated tables above.
    - **Verification.**
      - `packages/hosts/devtools`: `bun run typecheck` clean; `bun test src`: 34 pass, 0 fail (route parity with `inspect()`, SSE, redaction, replay paging without runs, 404/400 mapping, CSP, loopback default, non-loopback token, literal and unset token refs, the bin serving a manifest-built agent, trust gating, public-API scan).
      - `packages/prism-coding-tools`: typecheck clean; conformance test 5 pass; `bun run build` clean.
      - Kernel: `bun run build:core` clean (after fixing one install-smoke syntax slip); `src/__tests__/cli-retired-dev.test.ts` and `cli.test.ts`: 15 pass.
      - `install-smoke.test.ts`: 13 of 15 pass. The devtools composition check passes. The two failures predate this task: `@arnilo/prism-core/governance/observability` imports `@arnilo/prism-observability`, which is not in the packed set, and `security22.mjs` imports `@arnilo/prism-model-router`, also not packed. Both packages exist in the workspace (`packages/integrations/observability`, `packages/policy/model-router`).
      - `docs.test.ts` + `packaging.test.ts` + `release.test.ts`: 485 pass, 11 fail. Every failure predates this task: `phase72-primitive-review.md` links `governance/evals/types.ts` (Task 3 moved it); `ManifestContributionKind` is not exported from `src/index.ts`; `packages/memory/package.json` is missing (the open-connector check); `RunOptions` per-run tools and `activeSkills` contract assertions; plan 057 expects 36 retired packages in the phase54 evidence and finds 35; `packages/hosts/evals/CHANGELOG.md` lacks the `0.1.0` anchor (Task 3; the release-graph check stops on it); `npm ls` reports `@arnilo/prism-core` invalid from `packages/hosts/ag-ui` (a file link); `packages/tools/work` lacks the `./diagrams` export the plan 054 check expects. `examples_demos_run_to_completion_and_emit_no_secret` failed once under load (30 s budget); it passes in 8.6 s on an idle machine.
      - `scripts/e2e-coverage.test.mjs`: 6 pass; 2 fail on `src/__tests__/cli-instruction-sources.test.ts`, which is deleted in the working tree (` D`, from before this task). The removed `./dev` keys and the renamed kernel test path add no new errors.
      - Freeze and package-map scripts (`phase20/21/26-freeze`, `phase54-package-map`): 48 pass, 17 fail. The failures are count and classification checks on packages from other tasks (`@arnilo/prism-observability` unclassified; the manifest-count allow-list omits 59 and 60) and the evidence renderer mismatch above. None names the repointed paths.
    - **Environment steps.** Removed the stale root and coding-tools `dist/` and rebuilt them. Removed 106 untracked `.js` files (tsc emit output for `.ts` sources in `examples/` and `packages/**/src`) that were present before my first emit. They most likely came from this session's earlier timed-out runs of the examples test, which skip its cleanup; I did not verify that origin. They regenerate on the next run. Tracked files are unchanged.

- [x] Task 5: Repo-wide surface gate and the Phase 10 Done record
  - Acceptance Criteria:
    - Functional: `src/__tests__/host-surface-gate.test.ts` scans every non-test module under `packages/hosts/*/src`:
      - `host_libraries_import_only_allowlisted_kernel_names`: every named import from `@arnilo/prism` or `@arnilo/prism/testing` is in `scripts/host-surface-allowlist.json`. Deep paths (`@arnilo/prism/src/…`, relative paths into the repo root `src/`) fail.
      - `host_libraries_construct_no_agent`: no `createAgent(` call, `defineAgent(` call, object spread of a value typed or named as an agent, or class `implements Agent` under `src/`. `createAgent` is allowed only under `packages/hosts/*/bin/` and in tests.
      - `host_surface_allowlist_entries_are_used_and_tagged`: every allow-list entry outside the JSON `frozen` array carries an owning phase (11 or 16), and every entry is imported by at least one host library, so stale entries fail. `frozen` is plan 161 Task 1 (a)'s array, including payload types of frozen members (`Message`, `ApprovalOutcome`, …), not only `ROOT_TYPES`.
    - Functional: The per-library scans added in plan 161 and Tasks 2–4 are deleted in favor of this gate, so there is one source of truth.
    - Functional: The Phase 10 Done criteria are recorded in this task's note with evidence:
      - `bun examples/acp.ts` output: serves ACP in-process against the mock provider, approval over ACP
      - the repo search, with its command and output: `rg -n 'createAgent\(|defineAgent\(|\.\.\.agent\b' packages/hosts -g '!**/__tests__/**' -g '!**/bin/**'` finds nothing, and the gate test passes
      - a confirmation that each of the six libraries (`acp`, `ag-ui`, `mcp-server`, `channels`, `evals`, `devtools`) and the `acp-agent` binary exist under `packages/hosts/`, with their READMEs
    - Functional: `plans/README.md` rows for 161 and 162 are set to `complete (<date>)`.
    - Performance: The gate is a static scan of fewer than 200 files. It reads source and imports nothing.
    - Code Quality: The gate reads the same JSON allow-list that the README of each library links to. There is no second list.
    - Security: The gate is the enforcement of "No surface imports kernel internals". A surface that reached `dispatchToolCall` or a run lifecycle would bypass `tool.call`, so the gate fails the build instead.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/kernel-imports-no-package.test.ts` (scan pattern), plan 161 Task 1 (a), roadmap Phase 10 Done
    - Options Considered:
      - Keep per-library scans only. Rejected: a new host library would need to remember to add one. A directory-wide gate covers it automatically.
      - A TypeScript-program-based check. Rejected: the kernel gate's regex-over-source pattern is enough for named imports and calls, and it adds no dependency.
    - Chosen Approach:
      - One directory-wide static gate over `packages/hosts/*`, driven by the shared allow-list.
    - API Notes and Examples:
      ```bash
      bun test --timeout=0 src/__tests__/host-surface-gate.test.ts
      ```
    - Files to Create/Edit:
      - `src/__tests__/host-surface-gate.test.ts`: new.
      - `scripts/host-surface-allowlist.json`: entries pruned to the used set.
      - Per-library `*_uses_public_api` tests: deleted.
      - `plans/README.md`, this plan's Notes.
    - References:
      - plan 160 Task 5 (Done-record pattern)
  - Test Cases to Write:
    - The three gate tests above. Each is proved to fail by a temporary fixture under a test-only temp directory: an allow-list miss, a `createAgent` call in `src/`, and an unused allow-list entry. The fixture is not committed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — a repo gate.
    - Docs pages to create/edit: none — the host-library READMEs already link the allow-list (Tasks 2–4 and plan 161).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - **What changed.**
      - `src/__tests__/host-surface-gate.test.ts` (new): one static scan over every non-test module in `packages/hosts/*/src` and `bin/` (138 modules, 7 libraries). It reads `scripts/host-surface-allowlist.json`, the same file the libraries link to. Three tests: `host_libraries_import_only_allowlisted_kernel_names`, `host_libraries_construct_no_agent`, `host_surface_allowlist_entries_are_used_and_tagged`. The import test also fails if a `packages/hosts/*` directory contributes no module, so the scan cannot pass vacuously.
      - Per-library scans deleted in favor of the gate: `packages/hosts/{acp,ag-ui,devtools}/src/__tests__/public-api.test.ts` (whole files) and the cases `channels_host_library_uses_public_api` (`connect.test.ts`), `mcp_server_host_library_uses_public_api` (`server.test.ts`), and `evals_host_library_uses_public_api` (`scenarios.test.ts`). Imports left unused by those cases were dropped.
      - Allow-list pruned per plan 161 Task 1 (a): `isLoopbackAddress` and `trimTrailingSlashes` removed from `phase11` (25 → 23; Task 1 recorded 24, which miscounted). Every remaining `phase11`/`phase16` name is imported by a host library. `phase16` is unchanged (`CheckpointStore`, `LeaseStore`, `LeaseRecord`).
      - `src/__tests__/packaging.test.ts`: the hand-maintained package list lacked `@arnilo/prism-evals` and `@arnilo/prism-devtools` (added by Tasks 3 and 4), so the plan 054 count check failed at 60 published manifests against 58 listed. Added both entries (devtools with `sourceBin`) and moved the 0.4 lockstep pin from 58 to 60.
      - `packages/hosts/evals/CHANGELOG.md`: the top header `## [0.12.1] - 2026-10-10` became `## [Unreleased]` (nothing is released by this plan). Added the `## [0.0.28] - 2026-08-08` and `## [0.1.0] - 2026-08-09` sections the release and docs checks require, matching devtools and acp.
      - Relative links in moved host docs repointed to the real depth: `packages/hosts/ag-ui/CHANGELOG.md` (6 links to `docs/`), `packages/hosts/channels/README.md` (4 links to `examples/`), `packages/hosts/evals/README.md` (the allow-list link). Released `docs/messaging-channels.md` and `docs/messaging-channel-operations.md` got a link-target change only, to `packages/hosts/channels/README.md`; their content is untouched.
      - `docs/_evidence/phase72-primitive-review.md`: four links repointed to the moved files. The `ScorerInput` anchor moved from `L22–28` to `L62–68` and the `EvaluationTrace` anchor from `L166–187` to `L234–256`, because the moved `types.ts` shifted; the old anchors no longer described those types. The `ag-ui-mapper.ts#L48–L453` anchor is kept, but the moved file differs from HEAD, so that anchor is unverified.
      - Dead imports removed from `packages/hosts/{channels,evals}/src/__tests__` (`readdir`, `readFile`, `fileURLToPath`).
    - **Findings that affect later work.**
      - Host sources name kernel types through type-position dynamic imports, `import("@arnilo/prism").Name` (ag-ui `replay.ts:43`, evals `threshold.ts:49`, `types.ts:352–372`). A scanner that reads only static imports misses them, so the gate reads the member name from these forms. All of those names are allow-listed.
      - The gate sees literal specifiers only. Evals reaches `@arnilo/prism-core` through computed specifiers (`const pkg = "@arnilo/prism-core/…"` then `import(pkg)`: `experiment.ts:102`, `score.ts:100`, `scenarios.ts:159`, `trajectory.ts:370`), and the scan cannot see that. See Further Actions.
    - **Amendments to the approach (applied to the text above).**
      1. The scan covers `bin/` as well as `src/`. A bin is the one place `createAgent` is allowed, and its imports are checked like any host module's, except that `createAgent` is exempt from the allow-list there.
      2. `frozen` is exempt from the usage check. The text asked that every entry be imported by a host library, but seven frozen names have no host import: `AgentInspection`, `RunOptions`, `RunLimits`, `CommandDefinition`, `PackageCommandInfo`, `JsonValue`, `ToolKind`. They are types of frozen members (the Phase 4 freeze), so host code reaches them through those members. Pruning them would reopen the freeze. The usage check covers the tagged `phase11`/`phase16` extras, which is the pruning plan 161 Task 1 (a) assigned to this task.
      3. `@arnilo/prism/manifest` is the one allowed kernel subpath. It is the public manifest loader (root `exports`), used by the `acp-agent` and `devtools` bins and by `acp-agent/src/index.ts`. It is not a deep path, and its names are not allow-listed. `@arnilo/prism/testing`, `provider-kit`, `node/*`, and `src/*` fail in host modules.
      4. A relative import that leaves its own `packages/hosts/<lib>` fails. This generalizes the plan's "into the repo root `src/`" rule.
      5. `PRISM_HOST_GATE_ROOT` points the scan at a fixture tree. It exists only to prove each rule fails. Normal runs leave it unset.
    - **Fixture proofs** (temporary trees under the session scratchpad; not committed):
      - A violating `src/bad.ts` in a fixture library. Test 1 failed with five findings: `createAgentRunLifecycle` not allow-listed, a type-form `import("@arnilo/prism").NotAllowedName`, the deep path `@arnilo/prism/src/manifest/index`, `@arnilo/prism/testing`, and a relative import into `../../../../../src/helper`. Test 2 failed with four findings: `createAgent(` outside a bin, `defineAgent(`, `...agent` spread, and `implements Agent`. A `bin/ok.ts` in the same fixture that calls `createAgent` and imports `@arnilo/prism/manifest` passed both tests.
      - Stale allow-list. The real `packages/hosts` symlinked into a fixture root, with `NeverImportedName` added to `phase11` and `AlsoUnusedName` to `phase16`. Test 3 failed with exactly those two findings.
    - **Sweep result.**
      - `rg -n -t ts 'createAgent\(|defineAgent\(|\.\.\.agent\b' packages/hosts -g '!**/__tests__/**' -g '!**/bin/**'`: no matches (exit 1). This is the source reading of the Done criterion.
      - The criterion's literal command, without `-t ts`, returns 8 hits. All are in READMEs and CHANGELOGs and show or describe the app's own `createAgent({...})` call before it hands the agent to the library. None is in source. Two bin calls are the allowed construction sites: `packages/hosts/devtools/bin/prism-devtools.ts:21` and `packages/hosts/acp-agent/bin/prism-acp-agent.ts:22`.
      - Retired-name sweep (`createMessagingRuntime|governance/evals|wrapAgentWithFailureInjection|prism-coding-tools/dev|createPrismDevInspector|createDevRouter|runDevCli|prism dev\b`, excluding dist, node_modules, history, _evidence, CHANGELOG): hits are released `/docs` (intended), the `prism-coding-tools` README "moved" table (intended), `packages/prism-core/README.md:39` (pointer), `core-conformance.test.ts:111` (asserts the subpath is gone), `scripts/phase54-package-map.mjs` (history map), `scripts/compat-baseline/arnilo__prism-dev.txt` (retired package baseline). Still open: the freeze tests (`phase19/20/21/26-freeze.test.mjs`) map `packages/evals/` to `packages/prism-core/src/governance/evals/`, and `scripts/e2e-coverage.json:634` lists `prism-core` governance/evals test paths that moved. See Further Actions.
    - **Done record (Phase 10, the three items Task 5 names).**
      - `bun examples/acp.ts` (exit 0): `{ executed: 1, stopReason: "end_turn", loadSession: true }`. The gated `delete_file` ran once: the client answered `session/request_permission` with `allow_once` over ACP, in-process against the mock provider.
      - The repo search and the gate: the source search above is empty, and `src/__tests__/host-surface-gate.test.ts` passes 3 of 3.
      - The six libraries and the acp-agent binary exist with READMEs: `packages/hosts/{acp,ag-ui,mcp-server,channels,evals,devtools,acp-agent}/README.md`. `devtools` and `acp-agent` have a `bin/`.
      - Scope of this record: it covers the three items Task 5 lists. I did not re-read the roadmap's Phase 10 Done section for other criteria.
    - **Baselines.** No export moved in this task, so no compat baseline was regenerated.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `cd packages/hosts/channels && bun run typecheck && bun run test`
- `cd packages/hosts/evals && bun run typecheck && bun run test`
- `cd packages/hosts/devtools && bun run typecheck && bun run test`
- `cd packages/prism-core && bun run build && bun run test`
- `cd packages/prism-coding-tools && bun run build && bun run test`
- `bun test --timeout=0 src/__tests__/host-surface-gate.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/packaging.test.ts src/__tests__/release.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun examples/acp.ts`
- `node scripts/release.mjs gate`
- `rg -n 'createMessagingRuntime|governance/evals|wrapAgentWithFailureInjection|prism-coding-tools/dev|createPrismDevInspector' src packages scripts examples docs -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**'` (only released `/docs` and baselines)

### Results (run 2026-10-10)

- `bun run build:core`: exit 0.
- `bun run typecheck`: 60 of 62 workspace packages exit 0. `@arnilo/prism-tools-web` (`src/obscura/__tests__/browser.test.ts`) and `@arnilo/prism-tools-coding` (`src/security/approval.ts`) fail as they did at plan 161 close. Neither is touched by this plan.
- `packages/hosts/channels`: typecheck clean; `bun test` 100 pass, 3 skip, 0 fail.
- `packages/hosts/evals`: typecheck clean; `bun test` 64 pass, 0 fail.
- `packages/hosts/mcp-server`: typecheck clean; `bun test` 23 pass, 0 fail.
- `packages/hosts/{acp,ag-ui,devtools,acp-agent}`: `bun test` 40, 92, 33, and 6 pass, 0 fail.
- `packages/prism-core` and `packages/prism-coding-tools` are unchanged in this task; their build and test lines were run at Tasks 2–4.
- `bun test src/__tests__/host-surface-gate.test.ts`: 3 pass.
- `bun test src/__tests__/release.test.ts`: 8 pass, 0 fail. It failed on the evals changelog anchor before this task (fixed).
- `bun test src/__tests__/packaging.test.ts`: 312 pass, 1 fail. The failure is `npm ls --all --depth=0`, which reports `invalid` `file:../../prism-core` devDependencies in `hosts/ag-ui`, `hosts/devtools`, `hosts/evals`, and `prism-coding-tools`. Those devDependencies are real: they serve test imports and the evals runtime resolution. This condition predates this plan (Task 4 recorded it).
- `bun test src/__tests__/docs.test.ts`: 164 pass, 6 fail. Fixed in this task: the evidence links, the evals changelog, and the moved-README links. Still failing: `docs/multi-agent-patterns.md` and `docs/supervisors.md` link to `examples/spawn-agent-tool.ts`, which is not in the tracked tree (removed in WIP commit `72a4f9df`); the phase54 retired-package count (35, expected 36, Task 4); `ManifestContributionKind` is not exported from `src/index.ts`; the `RunOptions` per-run tools and `activeSkills` assertions; and the plan 081 open-connector check, which failed without an assertion line in the log and was not diagnosed this session. These are not from this plan.
- `node scripts/release.mjs gate`: exit 1 at the `@arnilo/prism-tools-coding` declaration emit, the same blocker Task 1 recorded. The gate stops there, so later steps did not run.

## Compromises Made

- **Gate covers `@arnilo/prism` only, and literal specifiers only.** Host libraries still reach `@arnilo/prism-core`: `ag-ui` (`a2a.ts`, `a2a-server.ts`), evals through computed specifiers (`import(pkg)` of `governance/observability` and `validation/json-schema`), and devtools tests (`eval-compare.test.ts`). The gate cannot see the computed form. Plan 162 scopes the gate to the kernel name list; Phase 16 retires the `prism-core` runtime these reach into.
- **`frozen` is exempt from the usage check.** Seven frozen names have no host import (`AgentInspection`, `RunOptions`, `RunLimits`, `CommandDefinition`, `PackageCommandInfo`, `JsonValue`, `ToolKind`). They are payload or member types of the Phase 4 freeze. Pruning them would change the freeze.
- **`@arnilo/prism/manifest` is an allowed subpath by decision.** It is the public manifest loader. Its names are not allow-listed.
- **The scan covers `bin/` too,** and `createAgent` is allowed only in `bin/`, which is the plan's rule.
- **`PRISM_HOST_GATE_ROOT` is a test seam** that points the gate at a fixture tree. It is for proofs. Normal runs leave it unset.
- **Released `/docs` got link-target edits only** (`docs/messaging-channels.md`, `docs/messaging-channel-operations.md`). That keeps the docs link check green without changing released content, which the plan said to leave untouched.
- **Evidence records were edited where the docs check requires it.** `docs/_evidence/phase72-primitive-review.md` has its four links repointed and two line anchors recomputed. The `ag-ui-mapper.ts#L48–L453` anchor is unverified. Plain-text citations in `phase104-primitive-review.md` and `0.7.0-host-completeness.json` still name the old paths as history.
- **Packaging and changelog fixes were made in this task.** The evals changelog header changed from `[0.12.1]` to `[Unreleased]` (nothing is released here). The packaging list and lockstep pin were corrected for the two libraries Tasks 3 and 4 added.
- **The Done record interprets the sweep as source.** The literal `rg` finds 8 matches in READMEs and CHANGELOGs, all usage examples in docs. The source search is empty.

## Further Actions

1. **P1 — Unblock `node scripts/release.mjs gate`.** `packages/prism-coding-tools/src/security/approval.ts` imports `ExecutionAction`, `ExecutionDecision`, and `ExecutionPolicy` from `@arnilo/prism`, which no longer exports them. The declaration emit stops the gate here, and it has blocked the gate since plan 160. Find the owning package for those names and repoint the import.
2. **P1 — Extend the host-surface gate to `@arnilo/prism-core` and computed imports.** Host libraries still reach `prism-core` (`ag-ui/src/a2a.ts`, `a2a-server.ts`, and evals' computed `import(pkg)` of `governance/observability` and `validation/json-schema`). Add a rule that host modules may not name `@arnilo/prism-core` and may not dynamic-import computed specifiers. Land it with Phase 16, when the `prism-core` runtime moves.
3. **P2 — Repoint stale path maps.** `scripts/phase19-freeze.test.mjs:58`, `phase20-freeze.test.mjs:65`, `phase21-freeze.test.mjs:72`, and `phase26-freeze.test.mjs:64` map `packages/evals/` to `packages/prism-core/src/governance/evals/`. `scripts/e2e-coverage.json:634` lists `prism-core` governance/evals test paths that moved to `packages/hosts/evals`. Repoint both, then run `scripts/e2e-coverage.test.mjs` and the freeze suites.
4. **P2 — Released `/docs` still describe removed surface.** Examples: `docs/evaluations.md` (`wrapAgentWithFailureInjection`, `@arnilo/prism-core/governance/evals`), `docs/dev-inspector.md` (`prism dev`, `createPrismDevInspector`), `docs/messaging-channels.md` and related pages (`createMessagingRuntime`). Plan 162 left released `/docs` untouched. Rewrite them when the release that retires these names is cut.
5. **P2 — Broken links to `examples/spawn-agent-tool.ts`.** `docs/multi-agent-patterns.md` and `docs/supervisors.md` link to a file that is no longer tracked (removed in WIP commit `72a4f9df`). Restore the example or repoint the links.
6. **P2 — Pre-existing docs failures, not from this plan.** The phase54 retired-package count (35, expected 36); `ManifestContributionKind` not exported from `src/index.ts`; `RunOptions` per-run tools and `activeSkills` contract assertions; the plan 081 open-connector check (`packages/memory/package.json` absent, per Task 4). Triage each against its owning plan.
7. **P3 — Invalid `file:../../prism-core` devDependencies.** `npm ls` reports them invalid in `hosts/ag-ui`, `hosts/devtools`, `hosts/evals`, and `prism-coding-tools`. They serve test imports, so the fix belongs with the Phase 16 removal of the `prism-core` runtime, not a manifest edit now.
8. **P3 — Dead import.** `src/cli-runner.ts` imports `createSkillRegistry` and never uses it. This predates plan 162 (it is already unused at HEAD). Remove it with the next kernel CLI change.
9. **P3 — Verify the `ag-ui-mapper.ts` evidence anchor.** `docs/_evidence/phase72-primitive-review.md` cites `ag-ui-mapper.ts#L48–L453`. The moved file differs from HEAD, so the range may be stale. Recompute it or drop the anchor.
10. **P3 — Evals changelog at release time.** `packages/hosts/evals/CHANGELOG.md` now has `## [Unreleased]` for the Phase 10 change. At release, cut the version header and confirm the `0.0.28`/`0.1.0` sections still match the lockstep convention.
