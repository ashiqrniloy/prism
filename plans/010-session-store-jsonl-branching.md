# Phase 7 — Sessions, Branching, and Stores

## Objectives
- Add durable session memory without introducing hidden provider, credential, filesystem, or extension globals.
- Provide a replaceable async `SessionStore` path with an in-memory implementation and an explicit Node JSONL adapter.
- Store branch-aware session entries for messages, model changes, labels, custom data, summaries, and compaction markers.
- Let sessions resume from a leaf, fork old paths, clone branch history, and rebuild provider context from the current branch.
- Document every new public store/session API and behavior under `/docs` as it lands.

## Expected Outcome
- Root exports include branch-aware session entry helpers, `createMemorySessionStore()`, and any small option types needed for store-backed sessions.
- The optional Node subpath exports `createJsonlSessionStore()` and does not run unless a host imports it explicitly.
- `AgentSession` can rebuild history from a selected leaf, append new entries without mutating old branches, and expose minimal branch navigation/resume/fork/clone behavior.
- Stores receive only session entries and never receive provider credentials or credential resolvers.
- `npm run build`, `npm run typecheck`, and `command npm test` pass without network or new dependencies.

## Tasks

- [x] Inventory existing session/store primitives and lock the minimal Phase 7 surface
  - Acceptance Criteria:
    - Functional: Existing `AgentSession`, `AgentSessionConfig.store`, `AgentConfig.store`, `SessionEntry`, `SessionStore`, `StoreFactory`, `AgentEvent`, input assembly, runtime history, docs, tests, and Phase 7 roadmap requirements are inventoried; the task records the smallest generic additions needed for stores, branching, resume, fork, clone, and context rebuild.
    - Performance: Inventory adds no runtime code, dependency, filesystem access, network call, provider call, watcher, retry loop, queue worker, or test slowdown.
    - Code Quality: The locked surface rejects a database abstraction, migration layer, query language, locking service, event-sourcing framework, CLI/RPC protocol, compaction strategy implementation, and hidden global store registry.
    - Security: Design keeps stores host-selected, credentials outside entries, filesystem access confined to an explicit Node subpath, and branch helpers data-only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 7 and non-negotiable boundaries: host controlled, defaults replaceable, secrets never enter history/events, docs ship with APIs.
      - `plans/009-agent-session-runtime.md` closeout: Phase 6 deliberately deferred durable store, replay, branching, compaction, CLI/RPC, hidden registries, settings reads, and credential resolution.
      - `src/contracts.ts` `AgentConfig.store`, `AgentSessionConfig.store`, `AgentSession`, `RunOptions`, `AgentEvent`, `SessionEntry`, `SessionStore`, `StoreFactory`, `CompactionStrategy`, `CredentialResolver`, and `ModelConfig`.
      - `src/agents.ts` current in-memory `history`, live-only subscriber, per-run metadata merge, provider/tool loop, abort behavior, and no store use.
      - `src/input.ts` history, summaries, and tool-result assembly inputs so persisted branch history can feed existing provider-input assembly.
      - `src/redaction.ts` and `docs/credentials-and-redaction.md` for secret/error boundaries.
      - `docs/agent-session-runtime.md`, `docs/public-contracts.md`, `docs/contribution-registries.md`, `docs/node-filesystem-config.md`, `docs/index.md`, and `docs/api-page-template.md`.
      - `src/node/config.ts` and `package.json` optional Node subpath pattern.
      - `node_modules/@types/node/fs/promises.d.ts` module notes: promise FS APIs use the Node threadpool and concurrent modifications on the same file are not synchronized/threadsafe; `mkdir`, `appendFile`, `readFile`, and `rename` signatures are available without dependencies.
      - `package.json` scripts and `tsconfig.json` strict `NodeNext`/declaration settings.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
      - Project pattern/wiki directories: none present under `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/`.
    - Options Considered:
      - Add a full database-backed persistence layer now: rejected; Phase 7 only needs a replaceable async store contract plus memory/JSONL defaults.
      - Store complete provider requests/prompts: rejected; context providers, system instructions, metadata, and host data may contain sensitive or transient content.
      - Store only assistant messages: rejected; resume and branch rebuild need user, assistant, tool, model-change, summary/compaction, label, and custom entries.
      - Put JSONL in the root export: rejected; filesystem access should stay explicit like `prism/node/config`.
      - Add generic branch/path helpers plus thin runtime methods: preferred; helpers stay reusable for later compaction/CLI/RPC without building those phases now.
    - Chosen Approach:
      - Add one root module for store helpers and memory store, tentatively `src/session-stores.ts`.
      - Extend contracts minimally: branch-aware entry kinds/fields, optional list options, current-leaf config, and small session branch/fork/clone option types.
      - Let `AgentSession` use a host-supplied store when present and otherwise use a per-session memory store; no global default store.
      - Keep JSONL as `prism/node/session-store-jsonl` with `node:fs/promises` only in that subpath.
      - Leave compaction strategy and retry policy behavior to Phase 8; Phase 7 only stores summary/compaction entries created by callers or later phases.
    - API Notes and Examples:
      ```ts
      import { createAgent, createMemorySessionStore, rebuildSessionContext } from "prism";

      const store = createMemorySessionStore();
      const agent = createAgent({ model, provider, store });
      const session = agent.createSession({ id: "s1", leafId: "entry_1" });
      const context = rebuildSessionContext(await store.list("s1"), { leafId: "entry_1" });
      ```
    - Files to Create/Edit:
      - `plans/010-session-store-jsonl-branching.md`: record inventory and locked API before implementation.
      - Expected later files: `src/contracts.ts`, `src/session-stores.ts`, `src/agents.ts`, `src/index.ts`, `src/node/session-store-jsonl.ts`, `package.json`, `src/__tests__/session-stores.test.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/public-contracts.test.ts`, `src/__tests__/docs.test.ts`, `docs/session-stores-and-branching.md`, `docs/node-jsonl-session-store.md`, `docs/agent-session-runtime.md`, `docs/public-contracts.md`, `docs/contribution-registries.md`, `docs/credentials-and-redaction.md` if security guidance changes, and `docs/index.md`.
    - References:
      - `roadmap.md` Phase 7 deliverables and acceptance.
      - `plans/009-agent-session-runtime.md` further actions for durable session storage and branching.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Inventory Result / Locked Surface:
      - Reuse as-is: `AgentConfig.store`, `AgentSessionConfig.store`, `SessionStore.append()`, `SessionStore.list(sessionId)`, optional `SessionStore.get(id)`, `StoreFactory`, `CompactionContext.entries`, `CompactionResult.entries`, `Message`, `AgentEvent`, `RunOptions.model`, metadata fields, credential/redaction helpers, contribution store-factory registration, and existing docs/export checks.
      - Reuse as-is: `assembleProviderInput()` with `history`, `summaries`, and `toolResults`; `RuntimeAgentSession` provider/tool loop, run exclusivity, abort bridge, live subscribers, metadata merge, configured builders/context/skills/tools/middleware, and fail-closed missing-provider behavior.
      - Keep `SessionStore` append/list/get only. Do not add database queries, migrations, transactions, deletion/update APIs, locks, watchers, background queues, retry policy, schema registry, CLI/RPC protocol, or hidden global store registry.
      - Add the smallest branch-aware entry surface: stable `id`, optional `parentId`, `sessionId`, `timestamp`, `kind`, optional `runId`, optional metadata, and typed payload fields for messages, model changes, labels, custom data, summaries, and compaction markers. Preserve existing `message`, `event`, `summary`, and `metadata` compatibility where practical.
      - Add pure reusable helpers only: create entries with injectable id/time, list branch leaves, get a leaf path, rebuild provider context from a leaf, and fail clearly on duplicate ids or missing parents. Helpers do not read credentials/settings/files or call providers/tools.
      - Add `createMemorySessionStore(initialEntries?)` as the root default in-memory store. It is per-host/per-session selection, not a global default registry.
      - Add minimal `AgentSessionConfig.leafId` plus `AgentSession` branch methods only as needed for resume/checkout/fork/clone/entries. Runtime precedence is session store first, then agent store, then a private memory store.
      - Runtime persistence stores normalized session entries only: user input messages, assistant messages, tool-result messages, model-change entries, and later caller/runtime summary or compaction entries. Do not store provider objects, credential resolvers, resolved credentials, full provider requests, settings, or hidden metadata.
      - Fork is branch selection for the next append in the same session; clone copies the selected branch to a new session id with regenerated ids and remapped parents; neither mutates old paths.
      - JSONL is locked to explicit Node subpath `prism/node/session-store-jsonl`, using `node:fs/promises` and caller-provided paths only. Root exports stay filesystem-free.
      - Phase 7 explicitly rejects: full database abstraction, migration layer, query language, locking service, event-sourcing framework, compaction strategy implementation, retry/backoff framework, CLI/RPC session protocol, settings/credential resolution, provider-specific persistence, app tools, and extension auto-loading.
  - Test Cases to Write:
    - None for this inventory-only plan edit; no source or docs API files change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; later implementation tasks must document public APIs and runtime behavior they add.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public APIs are implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add branch-aware session entry contracts and pure branch helpers
  - Acceptance Criteria:
    - Functional: `SessionEntry` can represent messages, events, model changes, labels, custom entries, summaries, and compaction entries with `id`, `parentId`, `sessionId`, timestamps, optional `runId`, and optional metadata; helpers can list branch leaves and rebuild a deterministic current-branch context from a leaf.
    - Performance: Branch rebuild is O(n) over entries returned by the store and uses `Map`/arrays only; no provider calls, filesystem access, network access, timers, or dependencies are added.
    - Code Quality: Helpers are pure data functions with strict TypeScript types, stable timestamp/id injection for tests, and no runtime coupling to providers, tools, CLI/RPC, compaction strategies, or JSONL.
    - Security: Helpers do not read settings/credentials, do not accept credential resolvers, and do not add hidden metadata to entries.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` current `SessionEntry`/`SessionStore` shape and existing agent/session contracts.
      - `src/input.ts` default input builder fields for `history`, `summaries`, and `toolResults`.
      - `docs/public-contracts.md` public contract inventory and examples.
      - `docs/api-page-template.md` required API page structure.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add separate interfaces for every entry kind: rejected initially; a discriminated `kind` plus optional payload fields keeps the public surface small.
      - Encode labels/model changes/custom data only inside `data`: rejected; typed common fields make docs/tests clearer and avoid host guessing.
      - Add store-side branch queries to the required contract: rejected; all stores can implement append/list/get, and pure helpers can derive branches from `list()`.
    - Chosen Approach:
      - Extend `SessionEntry.kind` to include `"compaction"`, `"model_change"`, `"label"`, and `"custom"` while preserving existing `"message"`, `"event"`, `"summary"`, and `"metadata"` compatibility.
      - Added small exported types `CreateSessionEntryOptions`, `SessionBranchOptions`, `SessionBranch`, and `SessionContextSnapshot`; no `SessionListOptions` was needed.
      - Added pure helpers in `src/session-stores.ts`: `createSessionEntry()`, `getSessionBranchEntries()`, `listSessionBranches()`, and `rebuildSessionContext()`.
      - Treat missing parents or duplicate ids as invalid input and fail clearly instead of silently corrupting a branch.
    - API Notes and Examples:
      ```ts
      const entry = createSessionEntry({
        sessionId: "s1",
        parentId: "entry_parent",
        kind: "label",
        label: "investigation",
      });
      const snapshot = rebuildSessionContext(entries, { leafId: entry.id });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: extended `SessionEntry`; no `SessionStore.list()` option was needed for pure helpers.
      - `src/session-stores.ts`: add pure branch/context helpers and entry creation helper.
      - `src/index.ts`: export new helpers and option types from the root package.
      - `src/__tests__/session-stores.test.ts`: add pure helper tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for new entry kinds and helpers.
      - `docs/session-stores-and-branching.md`: document branch-aware entries and helper APIs.
      - `docs/public-contracts.md`: update session/store contract section and examples.
      - `docs/index.md`: add a session memory/stores navigation entry.
      - `src/__tests__/docs.test.ts`: add docs/export checks for new public helpers.
    - References:
      - `roadmap.md` Phase 7 session-entry deliverables.
      - `docs/api-page-template.md` and `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `session_entry_helper_creates_typed_label_model_custom_summary_and_compaction_entries`: validates entry kinds and required fields. Implemented in `src/__tests__/session-stores.test.ts`.
    - `rebuild_session_context_uses_only_current_leaf_path`: validates old branches are excluded from provider context. Implemented in `src/__tests__/session-stores.test.ts`.
    - `list_session_branches_returns_leaf_paths_without_mutating_entries`: validates branch navigation data. Implemented in `src/__tests__/session-stores.test.ts`.
    - `rebuild_session_context_rejects_missing_parent_or_duplicate_id`: validates fail-closed branch corruption handling. Implemented in `src/__tests__/session-stores.test.ts`.
    - `public_contracts_accept_branch_aware_session_entries`: compile/runtime coverage in `src/__tests__/public-contracts.test.ts`. Implemented.
    - `npm run typecheck`: passed.
    - `command npm test`: passed with 138 tests, 28 suites, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; changes public session/store contracts and adds root helper APIs.
    - Docs pages to create/edit:
      - `docs/session-stores-and-branching.md`: create detailed API page for session entries, branch helpers, and context rebuild.
      - `docs/public-contracts.md`: update `SessionEntry`, `SessionStore`, and helper examples.
      - `docs/index.md`: add `Session memory and stores - Store session entries, rebuild branch context, and navigate branches`.
    - `docs/index.md` update: Yes; add the session memory/stores entry and remove/adjust the matching future-area placeholder.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement `MemorySessionStore` and store factory behavior
  - Acceptance Criteria:
    - Functional: `createMemorySessionStore(initialEntries?)` returns an async `SessionStore` with `append()`, `list(sessionId)`, and `get(id)`; entries retain append order, multiple sessions are isolated, branch parent links are preserved, and all Phase 7 entry kinds round-trip.
    - Performance: Store lookup by id is O(1), list by session is O(n) for that session, and the implementation uses in-memory `Map`/arrays only with no timers, workers, filesystem, network, or dependencies.
    - Code Quality: The implementation is small, deterministic, strictly typed, and reusable through existing `StoreFactory`; it does not duplicate branch-helper logic.
    - Security: The store stores only entries explicitly appended by the caller/runtime and does not receive providers, settings, credential resolvers, or resolved credential values.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `SessionStore`, `StoreFactory`, and `SessionEntry` contracts after the prior task.
      - `src/contributions.ts` / `docs/contribution-registries.md` store factory contribution support.
      - `docs/session-stores-and-branching.md` draft API page from the prior task.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Use one array and scan for every operation: rejected for `get(id)` because a `Map` is just as small and avoids avoidable O(n) lookup.
      - Add deletion/update APIs: rejected; Phase 7 only needs append/list/get for branch preservation.
      - Deep-clone every entry on append/list: rejected unless tests show mutation risk; entries are readonly by contract and hosts own payload values.
    - Chosen Approach:
      - Implement `createMemorySessionStore()` in `src/session-stores.ts` with a `Map<string, SessionEntry>` plus `Map<string, SessionEntry[]>`.
      - Reject duplicate entry ids to avoid ambiguous branches.
      - Did not export a `memoryStoreFactory`; hosts can wrap `createMemorySessionStore()` in a `StoreFactory` when needed.
    - API Notes and Examples:
      ```ts
      const store = createMemorySessionStore();
      await store.append(createSessionEntry({ sessionId: "s1", kind: "custom", data: { ok: true } }));
      const entries = await store.list("s1");
      ```
    - Files to Create/Edit:
      - `src/session-stores.ts`: add `createMemorySessionStore()`.
      - `src/index.ts`: export `createMemorySessionStore()`.
      - `src/__tests__/session-stores.test.ts`: add memory store round-trip/isolation tests.
      - `src/__tests__/public-contracts.test.ts`: add compile coverage for memory store as `SessionStore`/`StoreFactory` if applicable.
      - `docs/session-stores-and-branching.md`: document memory store behavior and limits.
      - `docs/contribution-registries.md`: no change; no store factory example changed.
      - `src/__tests__/docs.test.ts`: add docs/export check for `createMemorySessionStore()`.
    - References:
      - `roadmap.md` Phase 7 deliverable: `MemorySessionStore` and async `SessionStore` implementation.
      - `plans/005-extension-kernel-and-contribution-registries.md` store factory contribution decisions.
  - Test Cases to Write:
    - `memory_session_store_round_trips_all_entry_kinds`: validates append/list/get. Implemented in `src/__tests__/session-stores.test.ts`.
    - `memory_session_store_isolates_session_ids`: validates no cross-session leakage. Implemented in `src/__tests__/session-stores.test.ts`.
    - `memory_session_store_rejects_duplicate_entry_ids`: validates branch ids remain unambiguous. Implemented in `src/__tests__/session-stores.test.ts`.
    - `memory_session_store_preserves_branch_parent_links`: validates branch helpers work over stored entries. Implemented in `src/__tests__/session-stores.test.ts`.
    - `public_contracts_can_use_memory_store_as_session_store`: validates root export and type shape. Implemented in `src/__tests__/public-contracts.test.ts`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed with 143 tests, 28 suites, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds a root default store implementation.
    - Docs pages to create/edit:
      - `docs/session-stores-and-branching.md`: document `createMemorySessionStore()`, ordering, duplicate-id behavior, and in-memory limits.
      - `docs/contribution-registries.md`: update related APIs only if a store factory example is added.
    - `docs/index.md` update: No new entry if the session memory/stores page was already added in the prior task; ensure link text remains accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Wire store-backed runtime persistence, resume, fork, clone, and branch navigation
  - Acceptance Criteria:
    - Functional: `AgentSession` uses `AgentSessionConfig.store` before `AgentConfig.store` and otherwise a per-session memory store; sessions can resume from `leafId`, rebuild history from the current branch, append new entries under the current leaf, checkout an older leaf, fork without changing old paths, and clone the current branch into a new session id.
    - Performance: Runtime loads and rebuilds only the selected session's entries per run/checkout/clone, uses no background worker/watcher/retry/cache, and does not add provider turns beyond existing Phase 6 behavior.
    - Code Quality: Runtime reuses branch helpers and existing input assembly/tool dispatch; new methods are minimal and documented; no CLI/RPC, compaction strategy, database adapter, hidden registry, or extension auto-loading is added.
    - Security: Store entries do not include credential resolvers, resolved credentials, provider objects, full provider requests, or hidden settings; stores receive only sanitized session-entry payloads created from user/assistant/tool/model/label/custom/summary/compaction data.
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` provider/tool loop, `history`, metadata merge, abort, and subscriber cleanup.
      - `src/input.ts` `assembleProviderInput()` use of `history`, summaries, and tool results.
      - `src/tools.ts` `ToolResult` and tool-result message conversion needs.
      - `docs/agent-session-runtime.md` runtime behavior and non-goals.
      - `docs/session-stores-and-branching.md` branch helpers/memory store docs from prior tasks.
      - `docs/credentials-and-redaction.md` guidance that secrets must not enter prompts/events/session entries.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Persist every `AgentEvent` by default: rejected for now; message/model/branch entries are enough for resume, and hosts can append custom/event entries if they need a full event log.
      - Persist full assembled provider input: rejected; it can include generated context and transient host metadata.
      - Queue concurrent runs per branch: rejected; Phase 6 already fails concurrent runs fast, and Phase 7 should keep that behavior.
      - Make `fork()` copy entries immediately: rejected; fork should simply move the next parent to an old leaf in the same session, preserving old paths.
    - Chosen Approach:
      - Added minimal `AgentSessionConfig.leafId` and runtime state for `currentLeafId`.
      - Added minimal `AgentSession` methods: `entries()`, `checkout(leafId?)`, `fork(options?)`, and `clone(options?)`; kept `prompt()` as an alias for `run()`.
      - Normalized run input into storable user messages before provider assembly; appended assistant messages and tool-result messages as they occur; appended a model-change entry when `RunOptions.model` differs from the agent model.
      - Before every run, call `rebuildSessionContext(await store.list(sessionId), { leafId: currentLeafId })` and pass rebuilt messages/summaries into existing `assembleProviderInput()`.
      - Implemented clone by copying the selected branch into a new session id with regenerated entry ids and remapped `parentId` values.
    - API Notes and Examples:
      ```ts
      const session = agent.createSession({ id: "s1", store, leafId: "entry_old" });
      await session.checkout("entry_old");
      const fork = session.fork();
      await fork.run("Try a different answer");
      const clone = await session.clone({ id: "s2" });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `AgentSessionConfig.leafId` and minimal `AgentSession` branch/store method types plus option types.
      - `src/agents.ts`: select stores, rebuild history from leaf, append entries, update current leaf, implement checkout/fork/clone/entries.
      - `src/session-stores.ts`: add any missing message/clone helper needed by runtime.
      - `src/__tests__/agents.test.ts`: add runtime persistence/resume/fork/clone/checkout/security tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for new session methods/options.
      - `docs/agent-session-runtime.md`: document store-backed history, resume, branch methods, and unchanged concurrency/abort behavior.
      - `docs/session-stores-and-branching.md`: document runtime use of stores and branch semantics.
      - `docs/public-contracts.md`: update `AgentSession`, `AgentSessionConfig`, `SessionEntry`, and `SessionStore` examples.
      - `docs/credentials-and-redaction.md`: no change; existing guidance already says secrets must not enter session entries.
    - References:
      - `roadmap.md` Phase 7 acceptance: context rebuild from current leaf, branching preserves old paths, stores receive no provider credentials.
      - `plans/009-agent-session-runtime.md` Phase 6 runtime decisions.
  - Test Cases to Write:
    - `agent_session_persists_user_assistant_and_tool_messages_to_store`: validates durable message entries and current leaf updates. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_resumes_history_from_leaf`: validates provider request history is rebuilt from stored entries. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_checkout_old_leaf_creates_new_branch_without_mutating_old_path`: validates branch preservation. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_fork_uses_same_session_store_and_selected_leaf`: validates fork behavior without copying old entries. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_clone_copies_current_branch_to_new_session_id`: validates clone id remapping and old session preservation. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_model_override_appends_model_change_entry`: validates model-change entries. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_store_entries_do_not_include_provider_credentials`: validates credential resolver/provider credential values are not passed to the store. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_abort_does_not_append_partial_next_turn`: validates abort keeps branch state consistent. Implemented in `src/__tests__/agents.test.ts`.
    - `public_contracts_cover_agent_session_branch_methods`: compile/runtime coverage in `src/__tests__/public-contracts.test.ts`. Implemented.
    - `npm run typecheck`: passed.
    - `command npm test`: passed with 149 tests, 28 suites, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; changes `AgentSession` behavior and adds resume/branch methods and store persistence semantics.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: update runtime session methods, store-backed history, resume/fork/clone/checkout examples, and non-goals.
      - `docs/session-stores-and-branching.md`: document how runtime appends entries and rebuilds current-branch context.
      - `docs/public-contracts.md`: update session and store contracts/examples.
      - `docs/credentials-and-redaction.md`: update only if new guidance is needed for session entries.
    - `docs/index.md` update: No new entry if the session memory/stores page is already linked; ensure Agent/session runtime entry still describes stored sessions accurately.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add explicit Node JSONL session store adapter subpath
  - Acceptance Criteria:
    - Functional: `prism/node/session-store-jsonl` exports `createJsonlSessionStore(pathOrOptions)`; it appends one JSON-serialized `SessionEntry` per line, creates parent directories when requested/needed, lists entries by `sessionId`, supports `get(id)`, tolerates a missing store file as empty, and round-trips branches across a new store instance.
    - Performance: Reads are linear in file size, appends are serialized per store instance, and implementation uses only Node built-ins; no watcher, database, lockfile package, streaming parser, compression, or dependency is added.
    - Code Quality: The adapter is isolated under `src/node/`, exported only through a package subpath, validates parsed lines enough to fail clearly on invalid JSON/non-object entries, and reuses branch helpers/tests instead of duplicating branch logic.
    - Security: The adapter reads/writes only the caller-provided path, does not discover files, does not load executable code, does not resolve credentials, and error messages do not include file contents.
  - Approach:
    - Documentation Reviewed:
      - `docs/node-filesystem-config.md`, `src/node/config.ts`, and `package.json` for optional Node subpath export pattern.
      - `node_modules/@types/node/fs/promises.d.ts`: `mkdir({ recursive: true })`, `appendFile()`, `readFile({ encoding: "utf8" })`, `rename()`, and the warning that concurrent file modifications are not synchronized/threadsafe.
      - `node_modules/@types/node/test.d.ts` and existing `src/__tests__/*.test.ts` for `node:test` style.
      - `docs/session-stores-and-branching.md` for store semantics.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add JSONL adapter to root exports: rejected; explicit Node subpath keeps filesystem use opt-in.
      - Use a lockfile package: rejected; no new dependency for the initial adapter.
      - Stream parse JSONL: rejected until files are too large for linear `readFile()` tests/use.
      - Rewrite the file on every append: rejected; JSONL append is smaller and preserves crash-readable history.
    - Chosen Approach:
      - Added `src/node/session-store-jsonl.ts` with `createJsonlSessionStore()` returning `SessionStore`.
      - Used `mkdir(dirname(path), { recursive: true })` before append by default, `appendFile(path, line, "utf8")`, and a per-instance promise chain to serialize appends.
      - Used `readFile(path, "utf8")`, split non-empty lines, `JSON.parse()`, and minimal shape checks before returning entries.
      - Added `package.json` export `./node/session-store-jsonl` and docs/tests for the subpath.
    - API Notes and Examples:
      ```ts
      import { createJsonlSessionStore } from "prism/node/session-store-jsonl";

      const store = createJsonlSessionStore("./sessions.jsonl");
      await store.append(entry);
      const entries = await store.list(entry.sessionId);
      ```
    - Files to Create/Edit:
      - `src/node/session-store-jsonl.ts`: implement explicit Node JSONL adapter.
      - `package.json`: add `./node/session-store-jsonl` export.
      - `src/__tests__/session-stores.test.ts` or `src/__tests__/node-session-store-jsonl.test.ts`: add JSONL adapter tests.
      - `src/__tests__/docs.test.ts`: add subpath/docs export checks.
      - `docs/node-jsonl-session-store.md`: create detailed API page for the Node adapter.
      - `docs/session-stores-and-branching.md`: link JSONL as an optional store implementation.
      - `docs/index.md`: add `Node JSONL session store - Persist session entries to caller-named JSONL files` under session memory/stores or configuration/node utilities.
      - `docs/public-contracts.md`: update related API links if needed.
    - References:
      - `roadmap.md` Phase 7 deliverable: JSONL session store adapter.
      - `docs/node-filesystem-config.md` explicit Node subpath precedent.
  - Test Cases to Write:
    - `jsonl_session_store_round_trips_entries_across_instances`: validates persistence and new instance reload. Implemented in `src/__tests__/node-session-store-jsonl.test.ts`.
    - `jsonl_session_store_lists_only_requested_session_id`: validates session isolation. Implemented in `src/__tests__/node-session-store-jsonl.test.ts`.
    - `jsonl_session_store_get_returns_entry_by_id`: validates lookup. Implemented in `src/__tests__/node-session-store-jsonl.test.ts`.
    - `jsonl_session_store_missing_file_is_empty`: validates first-run behavior. Implemented in `src/__tests__/node-session-store-jsonl.test.ts`.
    - `jsonl_session_store_rejects_invalid_json_line`: validates fail-clear corruption handling. Implemented in `src/__tests__/node-session-store-jsonl.test.ts`.
    - `jsonl_session_store_serializes_appends_and_writes_json_lines`: validates per-store append serialization and JSONL line format. Implemented in `src/__tests__/node-session-store-jsonl.test.ts`.
    - `jsonl_session_store_rejects_duplicate_entry_ids`: validates unambiguous branch ids. Implemented in `src/__tests__/node-session-store-jsonl.test.ts`.
    - `jsonl_session_store_package_subpath_is_declared`: validates `package.json` export and docs. Implemented in `src/__tests__/node-session-store-jsonl.test.ts` and `src/__tests__/docs.test.ts`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed with 157 tests, 29 suites, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds a public package subpath and Node filesystem store behavior.
    - Docs pages to create/edit:
      - `docs/node-jsonl-session-store.md`: document API, JSONL format, examples, explicit path requirement, concurrency ceiling, and security notes.
      - `docs/session-stores-and-branching.md`: list JSONL adapter as optional Node implementation.
      - `docs/index.md`: add `Node JSONL session store - Persist session entries to caller-named JSONL files`.
    - `docs/index.md` update: Yes; add navigation for the new Node subpath page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Final verification and session-store wiki consistency
  - Acceptance Criteria:
    - Functional: All Phase 7 acceptance scenarios pass; public root exports and Node subpath compile; docs link every new public store/session API, branch behavior, JSONL adapter, and security boundary.
    - Performance: Full test suite remains under the roadmap target of 10 seconds locally, uses no network, and adds no dependency, watcher, or long-running timer.
    - Code Quality: `npm run build`, `npm run typecheck`, and `command npm test` pass; tests use existing `node:test` style and no fixtures/frameworks beyond small temporary files for JSONL.
    - Security: Tests/docs confirm no built-in app tools, no hidden provider/tool/store globals, no automatic credential resolution, explicit JSONL paths only, and no provider credentials in session store entries.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md` and `.agents/skills/create-plan/references/prism-wiki.md` for required page structure.
      - `docs/index.md` navigation groups and Future API areas.
      - `docs/session-stores-and-branching.md` and `docs/node-jsonl-session-store.md` once created.
      - `src/__tests__/docs.test.ts` documentation checks.
      - `package.json` `build`, `typecheck`, and `test` scripts.
    - Options Considered:
      - Add a docs generator: rejected; existing lightweight docs tests are enough.
      - Add CLI/RPC golden session fixtures now: rejected; CLI/RPC is Phase 9 and release fixtures are Phase 11.
      - Add compaction strategy tests now: rejected; Phase 8 owns compaction behavior, Phase 7 only stores summary/compaction entries.
    - Chosen Approach:
      - Run the existing validation commands after implementation.
      - Ensure docs tests cover new docs pages, root exports, and Node subpath export.
      - Review store entries produced by runtime tests for credential/provider-object leakage.
      - Fill `Compromises Made` and `Further Actions` only after implementation and tests pass.
    - API Notes and Examples:
      ```sh
      npm run build && npm run typecheck && command npm test
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: add checks for new docs pages and exports if earlier tasks did not.
      - `docs/session-stores-and-branching.md`: final corrections if verification finds gaps.
      - `docs/node-jsonl-session-store.md`: final corrections if verification finds gaps.
      - `docs/index.md`: final navigation corrections if needed.
      - `plans/010-session-store-jsonl-branching.md`: mark completed tasks and fill closeout sections after all checks pass.
    - References:
      - `roadmap.md` Phase 7 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run build`: validates emitted JS/types and package exports.
    - `npm run typecheck`: validates strict TypeScript types.
    - `command npm test`: validates runtime, stores, JSONL, docs, and public contracts.
    - `docs_index_links_session_store_pages`: validates new docs navigation.
    - `docs_reference_existing_session_store_exports`: validates docs do not mention missing exports/subpaths.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No new API by verification alone; it validates docs for APIs added by earlier tasks.
    - Docs pages to create/edit:
      - `docs/session-stores-and-branching.md`: update only if verification finds missing/incorrect store or branch documentation.
      - `docs/node-jsonl-session-store.md`: update only if verification finds missing/incorrect Node adapter documentation.
      - `docs/index.md`: update only if navigation is missing or stale.
    - `docs/index.md` update: No unless verification finds navigation missing.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
