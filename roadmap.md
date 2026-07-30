# Prism Enterprise and Coding Harness Completion Roadmap

Updated: 2026-07-30
Baseline: `@arnilo/prism` **0.0.18** (Phase 1 exit gate passed)
Status: Phase 1 complete; Phase 2+ pending exit gates

## Objectives

- Repair confirmed release, documentation, dependency, repository-search, write-atomicity, and context-budget defects before expanding functionality.
- Make skill and context assembly progressive: descriptions first, bodies on demand, priority-aware budgeting, and fail-safe skill activation defaults.
- Close coding-tool capability gaps that raise agent error rates (search modes, glob, read-before-write, bounded delete/move) before heavier coding intelligence.
- Make existing enterprise contracts production-usable across restarts and multiple replicas.
- Provide durable event delivery, explicit side-effect recovery, and extensible checkpoint/resume semantics without adding a second runtime.
- Complete observational memory as an explicitly activated, source-faithful lifecycle with recent exact messages, an incremental observation log, reflections, and bounded raw-source retrieval.
- Complete coding-harness primitives for safe repository intelligence, long-running processes, editor interoperability, forge workflows, and controlled network access.
- Add narrow enterprise integration adapters for OIDC/JWKS identity, external policy engines, MCP authorization, bounded OpenAPI operations, and artifact storage.
- Wire the third-party Caveman and Ponytail behavior projects into optional Prism packages so a host can opt into their modes, skills, commands, and lifecycle hooks without Prism reimplementing them.
- Reach a measurable 0.1.0 production-readiness floor backed by protected integration, security, compatibility, packaging, and performance evidence.
- Preserve Prism as a host-owned harness: optional integrations stay outside dependency-free core and no hosted product/control plane is introduced.

## Expected Outcome

- Every default and protected release gate passes from a clean checkout with no stale plan/review assumptions.
- Coding write/edit paths are crash-safe; context budgets drop oldest history first; default input layout favors prompt-cache stability.
- Active skills expose name+description to the model by default; full instruction bodies load on demand; runtime skill registries do not silently activate every registered skill.
- Coding agents can glob files, search in files-only/count modes, optionally require read-before-write, and use bounded delete/move without shelling out to `rm`/`mv`.
- Policy, evaluation, connector-idempotency, and model-governance state can survive process restarts and remain consistent across replicas.
- Agent streams reconnect on another replica without rerunning completed work or depending on sticky sessions.
- Tool side effects have explicit idempotency and unknown-outcome recovery semantics rather than an undocumented exactly-once implication.
- Custom agent loops can participate in durable suspension/resume through versioned snapshot and restore hooks.
- Observational memory runs through the agent lifecycle without manual flush/compact choreography, preserves exact recent messages and full raw history, and keeps every observation/reflection traceable to bounded current-branch source evidence.
- Approvals support batches, partial decisions, rich rejection context, sticky run-scoped policy, elicitation, and nested-agent propagation.
- Coding hosts can use bounded ignore-aware search, optional language intelligence, managed process sessions, forge operations, constrained egress, and complete ACP capability negotiation.
- Enterprise hosts can adopt reference OIDC, policy, MCP OAuth, OpenAPI, and artifact-store adapters without moving authentication databases or business policy into Prism.
- Hosts that opt in can load Caveman and Ponytail as Prism extensions that contribute modes, skills, commands, and prompt injection through existing contribution contracts, with no duplicated upstream content and no implicit activation.
- 0.1.0 ships only after observational-memory, skills progressive disclosure, coding-tool safety, Node, PostgreSQL, keychain, provider, MCP, A2A, browser, sandbox, ACP, and supply-chain evidence is recorded.

## Current Baseline and Confirmed Gaps

### Existing strengths to preserve

- Dependency-free core runtime with explicit provider, tool, credential, extension, and persistence activation.
- Durable sessions, run ledger, checkpoints, leases, workflow coordinator, schedules, conversations, memory consent, artifacts, and replay contracts.
- Multi-tenant identity propagation, ownership assertions, policy records, model governance, retention, legal hold, quota, and audit/export seams.
- Forty-four publishable packages covering providers, MCP, A2A, AG-UI/ACP, workflows, browser automation, coding tools/security, evaluations, observability, RAG, memory, work tools, and SQL persistence.
- Docker reference containment, deny-by-default browser/network posture, bounded coding tools, structured Git operations, guardrails, run limits, and durable approval.
- Full workspace package tests currently pass independently; core/package conformance coverage is substantial.

### Confirmed defects and release blockers

1. `node --test dist/__tests__/docs.test.js` currently has nine failures:
   - three pre-existing failures follow deletion of `plans/`, `code-reviews/`, and `bug-reports/`: a local link still targets deleted plan 072, one assertion requires `plans/README.md`, and one assertion scans a nonexistent `plans/` directory;
   - six legacy phase-evidence assertions expect the roadmap content intentionally replaced by this document and must be retired or rewritten around maintained behavior/docs.
2. `@modelcontextprotocol/sdk` is pinned to 1.29.0. `npm audit` reports two moderate findings through its HTTP stack; 1.30.0 is the available fix baseline.
3. Root documentation contradicts shipped behavior:
   - browser automation is described as a non-goal although `@arnilo/prism-browser` ships;
   - provider-family counts do not match the fourteen provider adapters;
   - readiness text still describes an older release state.
4. HEAD is five commits beyond `v0.0.17`; current HEAD has no matching signed release tag or publication evidence.
5. Protected PostgreSQL, keychain, provider, Docker/Playwright, CodeQL, provenance, and live protocol gates have not been recorded for current HEAD.
6. Model-supplied JavaScript regular expressions execute synchronously in `packages/coding-agent/src/repository.ts`. Deadline checks cannot interrupt catastrophic backtracking inside `RegExp.exec()`.
7. `write` and `edit` overwrite targets with non-atomic `fsWriteFile`; a crash mid-write can leave a truncated/corrupted source file.
8. Context-budget history eviction pops newest messages first (`groups.history.pop()`), discarding the most relevant recent turn before older history.
9. Default `inputLayout` is `legacy`, which places transient user input before stable attachments/tool results and defeats prompt-cache prefix stability unless hosts know to set `cache_aware`.

### Skill and context progressive-disclosure gaps

- `Skill.description` is never rendered into provider input; only full `instructions` bodies are injected as system messages every turn for active skills.
- No on-demand skill-load mechanism exists; large skill registries (including future Caveman/Ponytail wiring) pay full instruction tokens every turn.
- Runtime `SkillRegistry` without explicit `activeSkills`/`skills` defaults to `configured.list()` (all skills), contradicting declarative `AgentDefinition` safe default of no skills active.
- `ContextBlock.priority` is unused by `applyContextBudget`; context/skill blocks drop LIFO all-or-nothing with no description-only fallback.
- Tool results stay verbatim in history until compaction; there is no mid-flight summarization of stale large tool outputs between compaction cycles.

### Coding tool capability gaps

- `repo_search` has no `files_with_matches` or `count` output mode; “which files contain X” returns full match content and wastes tokens.
- No bounded `glob`/pattern file-finder tool; agents fall back to `shell find` or manual `repo_list` filtering.
- No optional read-before-write soft guard; models can overwrite files never read in the current session.
- No bounded `delete`/`move` tools; destructive renames and deletes go through high-risk shell with no undo/confirmation shape.
- No PDF/document reader in coding tools (demand-gated; agents must shell out today).
- Fuzzy `edit` match success without an ambiguous-match warning to the model is an accepted tradeoff that must be documented loudly.

### Observational memory gaps

- `createObservationalMemoryRuntime()` runs only when a host manually calls `flush()`; extension registration does not connect observation, reflection, or compaction to completed agent turns.
- `compactAfterTokens` is resolved as a setting but is never consumed. Core auto-compaction uses `thresholdEntries` before provider input and neither invokes the observer nor honors the observational-memory token threshold.
- Observation coverage starts after the last raw source id, so later flushes may feed observational-memory bookkeeping entries back to the observer and create recursive self-observation.
- Reflection and drop coverage ids are recorded but unused; the same active observation pool may be reflected repeatedly, and a successful observer pass that emits no facts does not advance coverage.
- Reflection recall resolves only active observations. Once normal pool reduction drops a supporting observation, its reflection can no longer recover that observation or its raw source evidence even though both remain in the append-only ledger.
- Compaction's `fullFold` marker does not itself reduce or hard-bound rendered memory; failed/no-op reflection or dropping can leave summaries and folded payloads growing without an effective token ceiling.
- `flush()` can append and checkout while a session run is active because no run-lifecycle guard or atomic session-owned custom append primitive coordinates it with the current branch.
- One worker model/prompt serves observer, reflector, and dropper; the observer prompt is coding-specific despite the package being generic.
- Recall is exact-id only and host-supplied entry loading must preserve current-branch ownership. There is no bounded raw-message paging mode comparable to Mastra's source retrieval.
- Existing unit coverage passes, but the live suite is skipped and no end-to-end test proves completed turn → observation → reflection/compaction → next-turn memory → raw-source recall.

### Third-party integration gaps

- Prism has no package that wires the upstream Caveman project (skills, commands, activation/config/mode-tracker hooks, rules, cavecrew agents) into its extension, skill, command, system-prompt, instruction-injector, and lifecycle contracts.
- Prism has no package that wires the upstream Ponytail project (six skills, mode commands, activate/config/instructions/mode-tracker/subagent hooks, statusline) into the same contracts.
- Both upstream projects ship pi/Claude/Codex adapters but no Prism adapter; a host who wants caveman terseness or ponytail laziness in a Prism harness must hand-wire prompts and skills today.
- Any wiring must not reimplement upstream prompt fragments, skill bodies, hook logic, or rule text; it must load them from the installed upstream package and map them to Prism contributions.

### Enterprise harness gaps

- Policy decisions have memory/JSONL stores only.
- Evaluation records have a memory store only.
- Work-tool external mutation deduplication has a memory store only.
- Model-router rate, budget, and circuit state is process-local.
- Live AgentEvent broadcasting is process-local and cannot reconnect across replicas.
- Workflow polling exists, but no durable shared agent event source/backplane exists.
- Tool dispatch documents an ambiguous crash window after marking a tool dispatched and before learning its outcome.
- Only built-in loop strategies support durable run state; custom loops cannot snapshot and restore.
- `IdentityVerifier` is a host seam with no bounded OIDC/JWKS reference adapter.
- `PolicyEvaluator` has no reference OPA or Cedar mapping.
- MCP authorization is host-callback based but lacks full protected-resource metadata and OAuth/OIDC discovery support.
- Internal enterprise REST APIs require custom tools; no bounded host-selected OpenAPI operation adapter exists.
- Artifact metadata is durable, but production blob/object storage remains entirely host-written.

### Coding agent harness gaps

- ACP advertises only close-session capability; filesystem, terminal, MCP configuration, loading, modes, extra directories, locations, diffs, rich prompt content, and sticky permission decisions are absent.
- Repository traversal does not consume `.gitignore`/Git tracked-file semantics.
- Repository intelligence has no symbols, definitions, references, diagnostics, rename, or optional LSP integration.
- Shell is one-shot; there is no PTY or managed long-running/background process lifecycle.
- Local Git operations stop at bounded PR handoff; no GitHub/GitLab/Bitbucket issue, push, pull-request, review, or checks adapter exists.
- Sandbox networking is correctly deny-by-default, but no reference allow-list egress proxy/policy makes networked coding practical.
- Generic middleware exists, but coding hosts lack typed file, worktree, process, check, configuration, and task lifecycle events and ACP modes.
- Durable approval is binary and sequential rather than batched, partially resolvable, sticky, richly elicited, and nested-agent aware.
- Near-term coding-tool progressive-disclosure and soft-safety gaps (search output modes, glob, read-before-write, bounded delete/move) are tracked under Phase 4; heavier intelligence remains Phase 9.

## Product Boundaries

- **Harness, not hosted platform:** hosts own product UI, authentication UX, user directory, deployment, incident response, provider selection, business policy, and final storage topology.
- **One runtime:** new durability, event, approval, coding, and protocol capabilities extend current sessions, ledgers, checkpoints, leases, workflows, tools, and events.
- **Core stays dependency-free:** database drivers, OIDC/JWT libraries, policy engines, LSP clients, forge clients, PTY implementations, proxies, and object-store SDKs remain optional packages or host adapters.
- **One reference implementation first:** ship PostgreSQL before Redis/Kafka, one forge before three, one policy engine before several, and one object store before an adapter catalog.
- **Explicit activation:** no listener, worker, provider, credential resolver, indexer, LSP server, process session, network proxy, or remote service starts by import or discovery.
- **No exactly-once claim:** side effects are at-least-once with idempotency and explicit unknown-outcome recovery.
- **No regex-as-containment claim:** remove unsafe model-facing regex execution or isolate it in a terminable boundary.
- **No automatic capability escalation:** ACP, MCP, OpenAPI, forge, network, and policy integrations expose only host-selected capabilities and recheck identity/policy at execution.
- **No speculative product layer:** Studio, visual workflows, hosted cloud, managed observability, broad channels/devices, desktop control, and remote browser vendors stay demand-gated.

## Priority and Dependency Rules

1. Phase 1 blocks every later phase.
2. Phase 2 repairs observational-memory correctness and lifecycle integration before production topology work depends on memory behavior or compatibility.
3. Phase 3 skills/context progressive disclosure precedes Caveman/Ponytail wiring so large skill bodies are not injected every turn by default.
4. Phase 4 coding-tool capability gaps ship before heavier coding intelligence so agents reduce shell/`find`/`rm` error surface with bounded native tools.
5. Phase 5 third-party behavior integrations are optional, ship off the 0.1.0 critical path, and must wire—never reimplement—their upstream packages through existing Prism contribution contracts; they consume Phase 3 skill progressive-disclosure contracts.
6. Phase 6 production stores precede distributed delivery and idempotency so later state has durable implementations.
7. Phase 7 event delivery and side-effect recovery precede richer approvals and editor reconnect semantics.
8. Phase 8 durable extensibility and approval contracts precede ACP expansion so protocol decisions map to one shared model.
9. Phase 9 coding primitives precede full ACP exposure; ACP must map existing primitives, not create a second filesystem/process/runtime.
10. Phase 10 completes ACP and coding-host lifecycle behavior after the underlying coding capabilities exist.
11. Phase 11 enterprise adapters consume durable stores, event delivery, approval, and idempotency from earlier phases.
12. Phase 12 is a release-candidate hardening phase, not a feature catch-all.
13. Phase 13 capabilities require named demand, an operational owner, threat model, measurable acceptance criteria, and their own numbered execution plan.

## Phase Planning Workflow

1. This roadmap defines scope, order, and exit criteria. It is not an implementation log.
2. Before implementation, create one numbered executable plan for the first incomplete phase only.
3. That plan must inventory reusable primitives, freeze public API changes, list exact files, define adversarial tests first, and follow `.agents/skills/create-plan/references/prism-wiki.md`.
4. Implement only the active phase. Later phases remain backlog; do not scaffold their packages or APIs early.
5. Mark a phase complete only after its focused tests, `npm run sdk:ready`, release checks, documentation, and listed protected evidence pass.
6. Record actual compromises and follow-up work in the phase plan and update this roadmap with concise completion evidence.

## Tasks

- [x] Phase 1 — Release 0.0.18: restore release integrity and close confirmed defects
  - **Completion evidence (2026-07-30):** `plans/001-Release-0-0-18-Restore-Integrity.md` Tasks 0–9 done. `npm run sdk:ready` green; `npm audit --audit-level=moderate` 0 vulns; docs 105/105; coding-agent 204/204; MCP 38/38; `release:check --version 0.0.18` + 44-package pack dry-run pass. Shipped: MCP SDK 1.30.0, `repo_search` literal-only, atomic write/edit, oldest-first history eviction, `cache_aware` default layout, README/readiness alignment.
  - Objectives:
    - Restore all default release gates after historical planning/review content was intentionally deleted.
    - Remove known dependency and synchronous-regex security exposure.
    - Make root documentation and version/release provenance truthful.
    - Close coding write/edit crash-corruption and context-assembly correctness bugs that affect every agent run.
  - Acceptance Criteria:
    - Functional: docs tests no longer require deleted directories; every local Markdown link resolves; no plan-history content is restored unless explicitly selected as maintained documentation.
    - Functional: MCP package uses a non-vulnerable supported SDK version and preserves bounded tools/resources/prompts, Streamable HTTP, stateful sessions, authorization callbacks, and package exports.
    - Functional: model-facing repository search cannot execute uninterruptible catastrophic JavaScript regular expressions on the main thread; literal search behavior remains compatible.
    - Functional: `write` and `edit` persist via same-filesystem temp write + `rename` (or documented equivalent); a crash mid-write cannot leave a truncated target; abort still fails closed before rename.
    - Functional: context-budget history eviction drops oldest history messages first while preserving instruction/summary prefix; newest turns are retained preferentially under pressure.
    - Functional: default `inputLayout` is `cache_aware` (or an equally cache-stable layout); `legacy` remains explicitly selectable for hosts that require the prior order; migration notes call out the default change.
    - Functional: README, docs index, package counts, browser status, readiness page, changelogs, runtime version, manifests, lockfile, and release scripts agree on supported behavior and target version.
    - Performance: literal search and any retained regex backend remain within existing byte/file/match/time ceilings; atomic write adds no unbounded temp retention; SDK upgrade adds no unbounded HTTP/session state or material package-size regression.
    - Code Quality: stale tests are removed or rewritten around current maintained artifacts rather than recreating deleted history; dependency and layout changes are minimal and isolated.
    - Security: `npm audit --audit-level=moderate` has no known fixable MCP HTTP advisory; regex execution cannot block the main event loop indefinitely; write temp paths stay inside the approved workspace; tarball and secret scans remain clean.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/docs.test.ts`, `docs/release-and-install.md`, `docs/0.1.0-readiness.md`, `docs/mcp-tools.md`, `docs/coding-agent-tools.md`, `docs/context-and-skills.md`, `docs/agent-session-runtime.md`, `README.md`.
      - MCP TypeScript SDK authorization and Streamable HTTP documentation: <https://github.com/modelcontextprotocol/typescript-sdk>.
      - MCP authorization and security requirements: <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization> and <https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices>.
      - Node.js `fs.rename`/`writeFile` atomicity notes and worker/process APIs if regex mode is retained outside the main thread.
      - `src/context-budget.ts`, `src/input.ts`, `src/agents.ts` for layout defaults and history eviction order.
    - Options Considered:
      - Restore deleted plans/reviews: preserves old tests but restores large unmaintained history; reject unless maintainers choose archival history as a product requirement.
      - Keep synchronous regex with heuristic pattern validation: cannot prove bounded execution; reject.
      - Remove model-facing regex mode and retain literal search: smallest secure default; preferred.
      - Isolate regex in a terminable worker/backend: retain only if current users require regex mode and compatibility cost is accepted.
      - Keep non-atomic overwrite and document risk: reject; crash corruption is a reliability defect.
      - Keep newest-first history eviction for cache prefix: reject; front-drop preserves prefix equally while retaining recent relevance.
      - Document `cache_aware` without changing default: insufficient; quiet footgun remains.
    - Chosen Approach:
      - Update docs tests to validate current maintained docs rather than deleted planning directories.
      - Upgrade the MCP SDK by the smallest compatible version step and run package conformance before broader changes.
      - Prefer deleting model-facing regex mode. If compatibility evidence blocks removal, require a host-supplied or terminable regex backend and never execute it synchronously in core tool flow.
      - Implement same-directory temp + `fs.rename` for write/edit (and pluggable ops equivalents); document fuzzy-edit ambiguity tradeoff loudly.
      - Change history eviction to drop from the front (oldest); add a focused regression test.
      - Flip default `inputLayout` to `cache_aware`; keep `legacy` as an explicit opt-in.
      - Correct documentation from generated/current package inventory where feasible instead of maintaining duplicate hand counts.
    - API Notes and Examples:
      ```ts
      createRepoSearchTool(cwd, { modes: ["literal"] });
      // Optional regex support, if retained, must be a host-supplied bounded backend.
      const session = agent.createSession({ inputLayout: "legacy" }); // opt-in prior order
      // write/edit: temp in same dir → rename; callers see identical ToolResult shape.
      ```
    - Files to Create/Edit (tentative):
      - `src/__tests__/docs.test.ts`, broken docs link sources, `README.md`, `docs/index.md`, `docs/0.1.0-readiness.md`.
      - `package.json`, `package-lock.json`, `packages/mcp/package.json`, MCP source/tests/docs only where SDK compatibility requires it.
      - `packages/coding-agent/src/repository.ts`, `write.ts`, `edit.ts`, search/write/edit tool schema/tests/docs/changelog/migration notes.
      - `src/context-budget.ts`, `src/input.ts`, `src/agents.ts`, focused context-budget and input-layout tests.
      - Root/workspace manifests, changelogs, release metadata for 0.0.18.
    - References:
      - Current failures in compiled `dist/__tests__/docs.test.js`, sourced from `src/__tests__/docs.test.ts`.
      - `packages/coding-agent/src/repository.ts:308-319`, `packages/coding-agent/src/write.ts`, `packages/coding-agent/src/edit.ts`.
      - `src/context-budget.ts` history `pop()` eviction; `src/agents.ts` / `src/input.ts` `inputLayout ?? "legacy"`.
      - `docs/mcp-tools.md` pinned-version and session behavior.
  - Test Cases to Write:
    - Docs tests from a checkout with no `plans/`, `code-reviews/`, or `bug-reports/` directories.
    - MCP stateless/stateful session, auth isolation, origin, body, cursor, reconnect, and unsupported-capability regression tests after upgrade.
    - Evil-regex fixture demonstrating main thread remains responsive or regex mode is rejected.
    - Literal search Unicode, binary, symlink, abort, scan cap, match cap, and deadline regressions.
    - Write/edit crash simulation: kill between temp write and rename leaves original intact; successful path replaces atomically; abort before rename leaves target unchanged.
    - Context budget over-limit fixture: oldest history drops first; newest tool/user turns remain; instructions/summaries preserved.
    - Default layout is `cache_aware`; explicit `legacy` restores prior message order; cache-prefix ordering regression for attachments/toolResults before input.
    - README/package-count/browser/readiness assertions derived from current manifests/exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; repository regex mode may be removed or made host-supplied, MCP dependency behavior is updated, write/edit durability changes, default input layout changes, and release docs change.
    - Docs pages to create/edit: `docs/coding-agent-tools.md`, `docs/mcp-tools.md`, `docs/context-and-skills.md`, `docs/agent-session-runtime.md`, `docs/migration.md`, `docs/0.1.0-readiness.md`, `docs/release-and-install.md`, `README.md`.
    - `docs/index.md` update: yes; repair links and update Tools, MCP, Context/skills, Runtime, Release/install, and browser descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Compiled docs tests, relevant package tests, `npm run sdk:ready`, audit, package budget, secret/SBOM/license checks, Node 20/current imports, `git diff --check`, and 44-package dry-run pack all pass from a clean checkout.

- [ ] Phase 2 — Release 0.0.19: complete observational memory lifecycle and source-faithful retrieval
  - Objectives:
    - Upgrade `@arnilo/prism-compaction-observational-memory` from manually coordinated primitives into one explicitly activated session-memory composition.
    - Match Mastra's useful four-part memory model: recent exact messages, an incremental observation log, reflections over that log, and retrieval of the exact raw sources behind compressed memory.
    - Close every confirmed observational-memory correctness, coverage, lifecycle, configuration, branch-isolation, genericity, and resource-bound gap without adding a second session store or deleting raw history.
  - Acceptance Criteria:
    - Functional: one host activation connects completed agent turns to observation and connects configured token pressure to reflection and compaction; callers do not need to remember a separate `flush()` plus `session.compact()` sequence.
    - Functional: observation processes only eligible unobserved user, assistant, and tool message entries from the current branch; observational-memory records, compaction records, and unrelated internal bookkeeping are excluded while durable scan coverage still advances across them.
    - Functional: a successful observer pass advances coverage even when it finds no durable fact; restart, retry, and duplicate lifecycle delivery do not re-observe an already covered source range or append duplicate logical records.
    - Functional: provider context contains a bounded exact recent-message window in original role/tool-call/tool-result order plus the active observation/reflection projection; older raw entries remain unchanged in the session store and are omitted only from normal provider context.
    - Functional: observation records retain bounded source entry ids/ranges, timestamps, relevance, and deterministic lineage; reflection records retain complete supporting-observation lineage and process only observations newer than their durable coverage boundary unless an explicit full rebuild is requested.
    - Functional: dropped observations disappear from active context but remain recoverable as historical support; recalling a reflection after its supporting observations are dropped still returns those observations and their available raw source entries with dropped/missing status.
    - Functional: retrieval supports exact observation/reflection id lookup and bounded current-branch raw-message paging around a source cursor, including full-detail selection for text and tool-result parts; unknown, sibling-branch, wrong-session, and unauthorized sources fail closed.
    - Functional: observer and reflector may use separate host-selected providers/models, instructions, thinking/model settings, token thresholds, and credential policies; pool reduction is an explicit policy, and any retained model-assisted dropper is separately configurable; legacy single-worker configuration has a documented compatibility mapping or migration error.
    - Functional: every public setting has an observable effect or is removed. Observation-message, reflection-observation, recent-message, compaction, pool-target, and hard-block thresholds use one documented token-counting seam with a bounded deterministic fallback.
    - Functional: lifecycle work cannot append or checkout concurrently with an active conflicting run; append/coverage updates are session-owned, parent/CAS checked, abortable, and safe across checkout, fork, clone, restart, and duplicate invocation.
    - Functional: import and extension setup remain inert; no worker, provider request, tool, timer, or compaction starts until a host explicitly attaches/activates observational memory for an agent/session.
    - Performance: source selection and ledger folding are O(branch entries); each worker input/output, rendered projection, folded payload, recent-message window, source page, cursor, tool result, turn count, and concurrent job count has soft/default and immutable hard caps.
    - Performance: exceeding memory limits forces bounded synchronous reduction or fails with a typed result before provider input; `fullFold` cannot merely relabel an oversized payload, and compaction never emits an unbounded summary.
    - Code Quality: a primitive review first determines whether existing middleware/events/session append/compaction contracts can provide safe post-run integration; only generic reusable core hooks are added if package-only composition cannot meet ordering and ownership requirements.
    - Code Quality: observer instructions are domain-neutral by default and host-customizable; observation, reflection, dropping, rendering, retrieval, and lifecycle orchestration remain separately testable without duplicating the agent loop.
    - Security: source loading and recall enforce current session branch and ownership, secrets are redacted before worker/provider/persistence/tool output, model-supplied ids are allow-listed against eligible source/support sets, and memory workers cannot activate arbitrary tools or credentials.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md`, `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/session-stores-and-branching.md`, `docs/context-and-skills.md`, and package README/changelog.
      - Current package implementation: `runtime.ts`, `settings.ts`, `ledger.ts`, `projection.ts`, `strategy.ts`, `render.ts`, `recall.ts`, `tool.ts`, `serialize.ts`, extension, workers, and tests.
      - Mastra Observational Memory guide and API reference: <https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/docs/memory/observational-memory.mdx> and <https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/reference/memory/observational-memory.mdx>.
      - Mastra incremental observation/lifecycle sources: <https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observational-memory.ts> and <https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/processor.ts>.
    - Options Considered:
      - Keep documented manual `flush()` and compaction choreography: leaves dead settings, race hazards, and easy host omission; reject as the default complete composition while retaining low-level primitives for advanced hosts.
      - Start workers or timers during extension setup: violates Prism explicit-activation and import-safety boundaries; reject.
      - Add a parallel memory database or delete compacted session entries: duplicates the session source of truth and weakens audit/raw recall; reject.
      - Clone Mastra resource-scoped cross-thread memory and semantic search in this phase: broadens tenancy, consent, vector-store, and retention scope beyond the requested four-part floor; defer behind explicit host retrieval adapters and demand.
      - Compose a host-activated controller over current session entries, compaction, tools, and the smallest safe generic lifecycle primitive proven necessary by review: chosen.
    - Chosen Approach:
      - Treat raw current-branch session message entries as immutable source of truth. Store only bounded append-only observation/reflection/drop/coverage records and standard compaction entries alongside them.
      - Maintain two independent durable cursors: raw-source coverage for observation and observation-log coverage for reflection. Coverage advances on successful empty passes and excludes internal memory records without losing chronology.
      - Build provider context from active reflections/observations followed by a configurable exact recent-message suffix; compaction changes projection only, never raw retention.
      - Resolve recall from the full ledger, not only active observations. Return bounded source entries or selected message parts and explicitly report dropped and missing lineage.
      - Preserve exact-id recall as the cheapest reliable path and add current-branch cursor paging for Mastra-style raw-source access. Keep thread listing, resource-wide sharing, and semantic search optional/demand-gated rather than silently widening scope.
      - Make synchronous threshold behavior deterministic first. Background buffering, idle activation, or provider-change activation may be added only if they preserve the same durable coverage/CAS semantics and require no implicit scheduler.
    - API Notes and Examples:
      ```ts
      // Illustrative; primitive review freezes final names and attachment shape.
      const observationalMemory = createObservationalMemory({
        observation: { provider, model: observerModel, messageTokens: 30_000 },
        reflection: { provider, model: reflectorModel, observationTokens: 40_000 },
        context: { recentMessages: 8, compactAfterTokens: 81_000 },
        retrieval: { currentBranchMessages: true, pageLimit: 20 },
      });

      const session = observationalMemory.attach(agent.createSession({ id: "session-1" }));
      await session.run("Continue from our previous findings");
      // Completed-turn observation and due compaction are coordinated automatically.
      ```
    - Files to Create/Edit (tentative):
      - `packages/compaction-observational-memory/src/runtime.ts`, `settings.ts`, `types.ts`, `ledger.ts`, `projection.ts`, `strategy.ts`, `render.ts`, `recall.ts`, `tool.ts`, `serialize.ts`, `extension.ts`, workers, exports, and all package tests.
      - `packages/compaction-observational-memory/README.md`, `CHANGELOG.md`, `package.json` only if exports/scripts change.
      - Core `src/agents.ts`, `src/contracts.ts`, `src/middleware.ts`, contribution contracts, and focused tests only if primitive review proves a generic lifecycle/session-append gap.
      - `docs/compaction-observational-memory.md`, `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/index.md`, `docs/migration.md`, examples, and package/profile manifests if activation changes.
    - References:
      - `packages/compaction-observational-memory/src/runtime.ts:80-201` manual flush and worker thresholds.
      - `packages/compaction-observational-memory/src/settings.ts` currently unused `compactAfterTokens`.
      - `packages/compaction-observational-memory/src/recall.ts:36-37` active-only reflection support lookup.
      - `packages/compaction-observational-memory/src/workers/observer.ts:50-51` coding-specific prompt and serialized source input.
      - `src/agents.ts:503` and `src/agents.ts:1262-1269` entry-count auto-compaction timing.
  - Test Cases to Write:
    - End-to-end completed turn → threshold observation → due reflection/compaction → next-turn exact recent messages plus memory → observation and reflection raw-source recall.
    - Threshold edge cases immediately below/at/above observation, reflection, compaction, pool target, and hard-block limits using the configured token counter and fallback.
    - Observer receives only eligible unobserved messages after memory/compaction records; successful zero-observation pass advances durable coverage; restart and duplicate callback do not repeat work.
    - Reflection consumes only uncovered active observations; repeated flush with no new observations makes no worker call; full rebuild is explicit and deterministic.
    - Reflection recall after all supporting observations are dropped still returns support and raw evidence; missing/pruned sources and dropped state are reported without fabrication.
    - Recent exact-message projection preserves user/assistant/tool-call/tool-result ordering, selected multimodal metadata, and configured count/token limits while old raw entries remain listable in storage.
    - Current-branch message paging supports forward/backward bounded cursors and selected full-detail parts; sibling branch, wrong session/tenant, malformed cursor/id, oversized result, and unavailable source fail closed.
    - Separate observer/reflector model/provider/instruction/credential settings route correctly; legacy mapping, missing credentials, timeout, abort, worker overflow, and redacted errors remain bounded.
    - Concurrent run/observation/checkout/fork/clone and failed append/CAS scenarios preserve one valid branch and never move checkout to an unowned append.
    - Oversized active pool, no-op reflector/dropper, huge tool result, and repeated compaction stay within summary/data/input/output hard caps.
    - Import, extension setup, passive mode, and unattached configuration make zero provider calls and start no timers/workers.
    - Protected live canary verifies one real observer model and one separately configured reflector model; absence of credentials is a blocked protected gate, not an unexplained skip.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; observational-memory lifecycle, settings, model selection, compaction timing, projection, retrieval tool, branch behavior, and possibly generic agent lifecycle hooks change.
    - Docs pages to create/edit: `docs/compaction-observational-memory.md`, `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/migration.md`, package README/changelog, and one complete four-layer example.
    - `docs/index.md` update: yes; update Compaction/session memory with explicit Recent exact messages, Observation log, Reflections, and Raw-source retrieval descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`; every changed API page follows its required API-page sections.
  - Exit Gate:
    - Primitive review is accepted; package unit/integration/live tests, core lifecycle/compaction regressions, branch/ownership/adversarial/resource tests, packed public example, `npm run sdk:ready`, package budget, docs links, declarations, changelog/migration, and full release gate pass with no unexplained observational-memory skip.

- [ ] Phase 3 — Release 0.0.20: skills and context progressive disclosure
  - Objectives:
    - Make skill assembly progressive: always expose name+description for selected skills; load full instruction bodies only on demand or when host opts into eager injection.
    - Align runtime `SkillRegistry` activation with declarative safe defaults (no silent activate-all).
    - Honor `ContextBlock.priority` during context-budget eviction; prefer dropping low-priority / bodies before high-priority descriptions.
    - Optionally summarize stale large tool results between compaction cycles without inventing a second memory system.
  - Acceptance Criteria:
    - Functional: provider input for active skills includes a bounded `name: description` catalog every turn (or on first turn + when catalog changes); full `instructions` are not injected every turn unless the host selects eager mode or the skill was loaded for the run.
    - Functional: a host-activated skill-load tool or equivalent `InstructionInjector`/`RunOptions` path loads a skill body by exact name into the current run; unknown names, inactive tools required by the skill, and oversized bodies fail closed with bounded errors.
    - Functional: when `AgentConfig.skills` is a `SkillRegistry` and neither `RunOptions.activeSkills` nor `RunOptions.skills` is provided, default activation is empty (or requires explicit `activateAllSkills` / equivalent opt-in); declarative agents remain unchanged.
    - Functional: `applyContextBudget` drops lowest-priority context/skill blocks first; when a skill body is present, eviction may demote to description-only before removing the skill entirely.
    - Functional: optional mid-flight tool-result summarization (host-gated) replaces eligible aged tool messages with a one-line header + stable ref while preserving raw entries in the session store; disabled by default.
    - Performance: description catalog size is O(active skills) with byte/count caps; skill-load is O(1) lookup; priority eviction is O(n log n) or better over block count; no provider call for summarization unless host supplies a summarizer and opt-in is set.
    - Code Quality: reuse `Skill`, `InstructionInjector`, `ContextProvider`, and `ContextBlock` contracts; no parallel skill system; primitive review precedes any new contribution type.
    - Security: skill-load cannot grant tools/permissions beyond host-active tools; loaded instructions are bounded/untrusted text; summarizer output is treated as untrusted and size-capped; no cross-session skill leakage.
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md`, `docs/agent-session-runtime.md`, `docs/extensions.md`, `docs/migration.md`.
      - `src/input.ts` (`skillMessages`, `assembleProviderInput`), `src/skills.ts` / `resolveRunSkills`, `src/context-budget.ts`, `src/contracts.ts` (`Skill`, `ContextBlock`).
      - Claude Code / pi skill progressive-disclosure patterns as behavioral reference only (not a port requirement).
    - Options Considered:
      - Keep full instructions every turn and document the cost: rejected; Caveman/Ponytail make this acute.
      - Route all heavy skills only through `InstructionInjector`: works for mode slices but leaves `Skill` progressive disclosure broken; incomplete alone.
      - Description catalog + on-demand load tool + safe registry default + priority-aware eviction: chosen.
      - Automatic LLM summarization of every old tool result: rejected as default; opt-in host summarizer only.
    - Chosen Approach:
      - Render skill catalog from `description` (fallback short placeholder if empty) for selected skills.
      - Add opt-in `createLoadSkillTool` (or run-scoped load API) that materializes `instructions` into the active run contribution set.
      - Change registry default to require explicit activation; migration flag for prior activate-all hosts.
      - Sort context/skill eviction by ascending priority then LIFO; support description-only demotion.
      - Optional tool-result fold behind a host callback and age/size thresholds; store retains raw history.
    - API Notes and Examples:
      ```ts
      await session.run("…", {
        activeSkills: ["ponytail"], // registry: only these; no implicit all
        skillsDisclosure: "progressive", // default: catalog + load-on-demand
      });
      // Model sees: Skill ponytail: Forces the laziest solution…
      // Model calls load_skill { name: "ponytail" } → instructions enter subsequent turns.
      ```
    - Files to Create/Edit (tentative):
      - `src/input.ts`, `src/skills.ts`, `src/context-budget.ts`, `src/contracts.ts`, `src/agents.ts`, focused tests.
      - Optional coding-agent or core skill-load tool export; docs/examples/migration.
      - `docs/context-and-skills.md`, `docs/agent-session-runtime.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - `src/input.ts` skillMessages currently instructions-only; A2A card already uses `description`.
      - `resolveRunSkills` activate-all when registry configured without `activeSkills`.
      - `ContextBlock.priority` currently decorative in budget eviction.
  - Test Cases to Write:
    - Catalog includes name+description; instructions absent until load or eager opt-in.
    - Skill-load exact name success; unknown name / inactive required tool / oversized body fail closed.
    - Registry without activeSkills injects zero skill instructions by default; explicit activate-all restores prior behavior.
    - Budget pressure drops low-priority blocks first; skill demotes to description before full drop.
    - Eager mode regression: hosts that set eager injection still get full bodies every turn.
    - Optional tool-result summarization: aged large tool message replaced in provider view; raw store entry intact; disabled default.
    - Packed example with many skills stays under frozen prompt-prefix budget until load.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; skill activation defaults, prompt assembly, optional skill-load tool, context-budget eviction, migration for activate-all hosts.
    - Docs pages to create/edit: `docs/context-and-skills.md`, `docs/agent-session-runtime.md`, `docs/migration.md`, examples, changelogs.
    - `docs/index.md` update: yes; Context and skills entry must describe progressive disclosure and activation defaults.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Core skill/context/budget tests, migration note, packed progressive-disclosure example, `npm run sdk:ready`, docs links, and full release gate pass.

- [ ] Phase 4 — Release 0.0.21: coding-tool capability gaps for least-error agent operation
  - Objectives:
    - Add bounded native tools that reduce shell/`find`/`rm`/`mv` round-trips and blind overwrites.
    - Keep each addition optional, ExecutionPolicy-gated, and within existing coding-agent bounds.
    - Defer PDF/document reading and PTY/process sessions to later demand-gated or Phase 9 work.
  - Acceptance Criteria:
    - Functional: `repo_search` supports `outputMode: "content" | "files_with_matches" | "count"` with identical path/policy/limit fail-closed behavior; files-only and count modes omit match body text from model content.
    - Functional: bounded `glob` (or equivalent) tool finds paths by pattern with depth/entry/result/time caps, exclude list, symlink fail-closed, and pagination; no shell `find` required for common cases.
    - Functional: optional `requireReadBeforeWrite` (session-scoped) rejects `write`/`edit` on paths not read earlier in the current branch/run unless host override/force flag is set; clear model-visible error.
    - Functional: bounded `delete` and `move` tools enforce ExecutionPolicy, workspace containment, abort, and confirmation metadata; no trash daemon required—document host undo responsibility; refuse symlink escapes.
    - Functional: fuzzy-edit ambiguous-match behavior is documented; when match confidence is below an existing guard threshold, the tool already fails—docs state the silent-fuzzy success tradeoff explicitly.
    - Performance: glob/search modes stay within existing repository scan ceilings; delete/move are O(1) fs ops with path checks only; no background indexers.
    - Code Quality: extend `RepositoryOperations` / coding tools rather than new packages; reuse path-utils, mutation queue, and ExecutionPolicy.
    - Security: patterns cannot escape workspace; delete/move never follow symlinks out of root; read-before-write state is session-owned and not forgeable via model-supplied claims alone.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`.
      - `packages/coding-agent/src/repository.ts`, `write.ts`, `edit.ts`, `path-utils.ts`, ExecutionPolicy contracts.
    - Options Considered:
      - Teach models to use shell for glob/delete/move: rejected; higher error and policy surface.
      - Full trash/versioning subsystem: rejected; YAGNI until hosts demand it.
      - Hard-require read-before-write always: too breaking; optional host flag chosen.
      - Native bounded glob + search output modes + optional soft guard + delete/move tools: chosen.
    - Chosen Approach:
      - Add `outputMode` to search schema and serialization paths.
      - Add `createGlobTool` with picomatch-free or already-available matcher if present; else minimal safe glob subset (no brace explosion); prefer stdlib/`path` + existing walk.
      - Track read paths in session/run metadata for optional guard.
      - Add delete/move tools with policy risk `high` and exclusive serialization via mutation queue.
    - API Notes and Examples:
      ```ts
      createRepoSearchTool(cwd, { outputMode: "files_with_matches" });
      createGlobTool(cwd, { pattern: "src/**/*.ts", maxResults: 200 });
      createWriteTool(cwd, { requireReadBeforeWrite: true });
      createDeleteTool(cwd); createMoveTool(cwd);
      ```
    - Files to Create/Edit (tentative):
      - `packages/coding-agent/src/repository.ts`, new `glob.ts`, `delete.ts`/`move.ts` or single `fs-ops.ts`, `write.ts`, `edit.ts`, tool factories, tests, exports, README/CHANGELOG.
      - `docs/coding-agent-tools.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - Full analysis B1 already Phase 1; this phase is D5–D8 only.
      - Existing `repo_list` walker for glob reuse; `withFileMutationQueue` for delete/move.
  - Test Cases to Write:
    - Search content/files_with_matches/count parity on limits, binary skip, symlink deny, abort.
    - Glob depth/result/exclude/symlink/hidden/pagination and ReDoS-safe pattern rejection if patterns compile to regex.
    - Read-before-write: unread path denied; after read allowed; force override; cross-branch non-leak.
    - Delete/move containment, policy deny, abort, exclusive queue with concurrent edit.
    - Docs assert fuzzy-edit ambiguity tradeoff and non-goals (no PDF, no trash daemon).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; coding tool schemas/factories and optional write guard.
    - Docs pages to create/edit: `docs/coding-agent-tools.md`, `docs/migration.md`, package README/changelog.
    - `docs/index.md` update: yes; Coding tools entry lists glob, search modes, delete/move, read-before-write option.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Coding-agent unit/integration tests, policy/adversarial path tests, `npm run sdk:ready`, docs links, and full release gate pass.

- [ ] Phase 5 — Release 0.0.22: third-party behavior integrations (Caveman, Ponytail)
  - Objectives:
    - Add `@arnilo/prism-caveman` and `@arnilo/prism-ponytail` as optional third-party integration packages that wire the upstream Caveman and Ponytail projects into a Prism-powered harness.
    - Map every upstream hook, skill, command, rule, and mode-lifecycle behavior to Prism's existing extension, system-prompt, instruction-injector, skill, command, context-provider, settings, and middleware contracts.
    - Never reimplement Caveman or Ponytail: load prompt fragments, skill bodies, hook logic, and rules from the installed upstream package and adapt them into Prism contributions.
    - Keep both packages inert until a host explicitly loads the extension; no implicit prompt injection, mode activation, config write, timer, or status rendering.
    - Consume Phase 3 progressive-disclosure skill contracts so large upstream SKILL.md bodies are cataloged by description and loaded on demand (or via mode-scoped InstructionInjector slices), not injected every turn by default.
  - Acceptance Criteria:
    - Functional (Caveman): the extension registers the `caveman` skill and companion skills (`caveman-commit`, `caveman-review`, `caveman-stats`, `caveman-compress`, `caveman-help`, `cavecrew`) as Prism `Skill` contributions whose `instructions` are the upstream `SKILL.md` bodies and whose `toolNames` match upstream declarations.
    - Functional (Caveman): the `/caveman`, `/caveman-commit`, `/caveman-review`, `/caveman-stats`, `/caveman-compress`, and `/caveman-init` commands are registered as Prism `CommandDefinition`s; `/caveman [lite|full|ultra|wenyan|wenyan-lite|wenyan-ultra|micro|off]` changes the active level, and `caveman-config`/`caveman-stats`/`caveman-compress` invoke the corresponding upstream skill behavior through Prism command dispatch.
    - Functional (Caveman): upstream `caveman-activate`, `caveman-config`, and `caveman-mode-tracker` hooks map to Prism `session_start` (restore level from session custom entries or host config), `prompt_build`/`before_agent_start` (inject the active level's system-prompt fragment), and `input` middleware (detect `normal mode`/`stop caveman` deactivation); the active level persists as a session custom entry and is restored on resume.
    - Functional (Ponytail): the extension registers `ponytail` and the five companion skills (`ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review`) as Prism `Skill` contributions sourced from upstream `SKILL.md`.
    - Functional (Ponytail): the `/ponytail` command supports `lite|full|ultra|off`, `status`, and `default <mode>` subcommands, and `/ponytail-review`, `/ponytail-audit`, `/ponytail-gain`, `/ponytail-debt`, `/ponytail-help` alias commands are registered and dispatch the matching skill.
    - Functional (Ponytail): upstream `ponytail-activate`, `ponytail-config`, `ponytail-instructions`, `ponytail-mode-tracker`, and `ponytail-subagent` hooks map to Prism lifecycle/middleware; the active mode's instructions are injected through an `InstructionInjector` that calls upstream `getPonytailInstructions` and `filterSkillBodyForMode`, and mode persists as a session custom entry restored on resume; `stop ponytail`/`normal mode` deactivation is honored.
    - Functional (both): mode state is per-session via session custom entries (`ponytail-mode`, `caveman-level`) with a host-configurable default resolved through a `SettingsProvider` and/or bounded config file; no TUI status bar is rendered because Prism is a harness, not a terminal host—status is exposed as extension events/metadata for the host to render.
    - Functional (both): prompt fragments, skill bodies, and rule text are loaded from the resolved upstream package (optional peer dependency where published, otherwise a host-supplied upstream path); if upstream is absent, `setup` fails closed with a bounded redacted error rather than registering empty contributions.
    - Functional (both): registered skills participate in Phase 3 progressive disclosure (description catalog + on-demand or injector-scoped body); mode-specific slices continue to use `InstructionInjector` + upstream `filterSkillBodyForMode` / level fragments rather than dumping full SKILL.md every turn.
    - Functional (both): a primitive review confirms Prism's existing `Extension`, `Skill`, `CommandDefinition`, `SystemPromptContribution`, `InstructionInjector`, `ContextProvider`, `SettingsProvider`, middleware, and session-custom-entry contracts suffice; no new core primitive is added unless the review proves a gap.
    - Performance: injected prompt additions are bounded and sourced from upstream constants; skill/context resolution is O(registered skills); mode tracking is O(1) per turn; no timers, watchers, file watchers, or background workers start by default.
    - Code Quality: each package is independently installable, tree-shakeable, side-effect-free on import, and contains no duplicated upstream prompt/skill/rule content; the compaction-observational-memory extension is the reference package pattern.
    - Security: injected upstream content is treated as untrusted text and bounded before injection; config read/write is size-limited and confined to host-owned paths; no credential, network, or filesystem mutation beyond config persistence; mode persistence respects session ownership and redaction.
  - Approach:
    - Documentation Reviewed:
      - `docs/extensions.md`, `docs/context-and-skills.md`, `docs/agent-session-runtime.md`, `docs/compaction-and-retry.md`, `docs/migration.md`, and package README/changelog patterns.
      - Prism contracts: `Extension`, `ExtensionAPI`, `Skill`, `CommandDefinition`, `SystemPromptContribution`, `InstructionInjector`, `ContextProvider`, `SettingsProvider`, `MiddlewareHookName`, `ExtensionLifecycleEventName`, and session custom entries.
      - Upstream Caveman repository: `skills/`, `commands/`, `src/hooks/`, `src/rules/`, `agents/`, and `plugins/caveman/` at <https://github.com/juliusbrussee/caveman>.
      - Upstream Ponytail repository: `skills/`, `hooks/`, `commands/`, and `pi-extension/index.js` at <https://github.com/DietrichGebert/ponytail>.
      - Installed pi adapters on this machine under `~/.pi/agent/git/.../ponytail/pi-extension/index.js` and `.../pi-caveman/extensions/caveman.ts` as the reference wiring for pi events, commands, mode tracking, and prompt injection.
    - Options Considered:
      - Reimplement Caveman/Ponytail prompts and skills inside Prism: rejected by constraint and because upstream evolves independently.
      - Shell out to upstream install scripts/hook shells: rejected; Prism is a harness SDK, not a shell host, and hooks are JS modules.
      - Vendor/fork upstream content into the Prism package: rejected; drift and maintenance burden.
      - Declare upstream as optional peer dependency (Ponytail publishes `@dietrichgebert/ponytail`) or resolve a host-supplied upstream path (Caveman is not a published npm package), then import its prompt builders and load `SKILL.md`/rules via a resource loader and map them to Prism contributions: chosen.
    - Chosen Approach:
      - Each package exports `createCavemanExtension(options)` / `createPonytailExtension(options)` returning a Prism `Extension` whose `setup(api)` registers contributions by loading from the resolved upstream path.
      - Skills: read upstream `SKILL.md`, strip frontmatter, register `Skill` with `instructions` and `toolNames`.
      - Commands: register Prism `CommandDefinition`s that parse arguments, mutate mode state, persist a session custom entry, and dispatch alias commands to skill invocation.
      - Prompt injection: register `SystemPromptContribution` and/or `InstructionInjector` that returns the upstream prompt fragment for the active level/mode; for Ponytail use upstream `getPonytailInstructions(mode)` and `filterSkillBodyForMode`.
      - Lifecycle: subscribe `session_start` to restore mode from session entries or config default; `input` middleware to detect deactivation commands; persist mode via a host-supplied session append callback (session custom entry).
      - Config: register a `SettingsProvider` and bounded file read/write for the default level/mode and status toggle, mirroring upstream config resolution order.
      - No status bar rendering; expose mode/active state through extension events/metadata for the host.
    - API Notes and Examples:
      ```ts
      import { createCavemanExtension } from "@arnilo/prism-caveman";
      import { createPonytailExtension } from "@arnilo/prism-ponytail";

      const caveman = createCavemanExtension({
        upstreamPath: "/path/to/juliusbrussee-caveman", // or rely on optional peer dep
        defaultLevel: "full",
        showStatus: false, // host renders status from events
      });

      const ponytail = createPonytailExtension({
        upstreamPath: "/path/to/dietrichgebert-ponytail", // or optional peer dep @dietrichgebert/ponytail
        defaultMode: "full",
        quietStartup: true,
      });

      await kernel.load([caveman, ponytail]);
      ```
    - Files to Create/Edit (tentative):
      - `packages/caveman/`: `src/extension.ts`, `src/skills.ts`, `src/commands.ts`, `src/mode.ts`, `src/config.ts`, `src/prompts.ts`, `src/index.ts`, `package.json`, `README.md`, `CHANGELOG.md`, `tsconfig.json`, tests, and docs.
      - `packages/ponytail/`: same file set plus `src/instructions.ts` wrapping upstream `getPonytailInstructions`/`filterSkillBodyForMode`.
      - `docs/caveman.md`, `docs/ponytail.md`, `docs/extensions.md`, `docs/context-and-skills.md`, `docs/index.md`, `docs/migration.md`.
      - Root workspace manifests and optional profile inclusion only after install-size review; no core `src/` changes unless primitive review requires a generic lifecycle/session-append hook.
    - References:
      - `src/extensions.ts` (ExtensionAPI, createExtensionKernel), `src/contracts.ts` (Skill, CommandDefinition, SystemPromptContribution, InstructionInjector, ContextProvider, SettingsProvider, ExtensionLifecycleEventName), `src/middleware.ts` (MiddlewareHookName).
      - `packages/compaction-observational-memory/src/extension.ts` as the reference optional-extension package pattern.
      - Installed pi adapters: `~/.pi/agent/git/github.com/DietrichGebert/ponytail/pi-extension/index.js` and `~/.pi/agent/git/github.com/jonjonrankin/pi-caveman/extensions/caveman.ts`.
      - Upstream repos: <https://github.com/juliusbrussee/caveman>, <https://github.com/DietrichGebert/ponytail>.
    - Test Cases to Write:
      - Upstream absent: `setup` fails closed with a bounded redacted error and registers no contributions.
      - Caveman level set/restore/persist: `/caveman ultra` updates mode, persists a session custom entry, restores on `session_start`, and injects the `ultra` prompt fragment on `prompt_build`.
      - Ponytail mode set/restore/persist: `/ponytail lite`, `status`, `default full`, session resume, and `InstructionInjector` returns the `lite` instructions with mode-specific skill filtering.
      - Deactivation: `normal mode` and `stop caveman`/`stop ponytail` turn the mode off and stop injection without erasing session history.
      - Skill registration bodies equal upstream `SKILL.md` content (no duplication, no truncation) for every Caveman and Ponytail skill.
      - Alias commands dispatch the correct skill and are inert until the host selects them.
      - No provider call, timer, file watcher, or network access occurs on import or extension setup.
      - Config read/write is bounded, confined to host-owned paths, and survives restart only when the host supplies a writable path.
      - Mode persistence respects session ownership and redaction; cross-session/cross-tenant mode leakage is impossible.
      - Packed-install consumer loads both extensions through public exports only and observes opt-in prompt injection.
    - Documentation/Wiki Assessment:
      - Public API or behavior impacted: yes; two new optional packages export extension factories, skills, commands, prompt-injection, and settings behavior.
      - Docs pages to create/edit: create `docs/caveman.md` and `docs/ponytail.md` following the Prism wiki API-page structure; edit `docs/extensions.md`, `docs/context-and-skills.md`, `docs/index.md`, `docs/migration.md`, and both package READMEs/changelogs.
      - `docs/index.md` update: yes; add Caveman and Ponytail entries under a new Third-party integrations group and link them from Extensions/plugins and Context and skills.
      - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Primitive review accepted; both package test suites, packed-install fixture, no-core-regression check, `npm run sdk:ready`, package budget, docs links/examples, declarations, changelog/migration, and full release gate pass with both extensions inert until explicitly loaded.

- [ ] Phase 6 — Release 0.0.23: production enterprise state adapters
  - Objectives:
    - Make existing policy, evaluation, connector-idempotency, and model-governance contracts durable and replica-consistent.
    - Reuse existing PostgreSQL lifecycle, ownership, migrations, codecs, and conformance patterns rather than creating a universal state abstraction.
  - Acceptance Criteria:
    - Functional: PostgreSQL implementations exist for `PolicyDecisionStore`, `EvaluationStore`, and work-tool `IdempotencyStore`; records survive restart and retain exact tenant/ownership filtering.
    - Functional: model-router budget, rate, and circuit state uses a replaceable store with atomic cross-replica updates, expiry, bounded key cardinality, and deterministic eviction/cleanup semantics.
    - Functional: work-tool idempotency can distinguish absent, in-progress, completed, failed-retryable, failed-terminal, and unknown outcomes without storing secrets or unrestricted payloads.
    - Functional: schema migrations are versioned, checksum-protected, idempotent, and covered by the existing PostgreSQL migration/conformance approach.
    - Performance: indexes support ownership/time/idempotency lookup without full-table scans; contention and cleanup benchmarks publish p95 latency and storage growth at agreed replica/key volumes.
    - Code Quality: each adapter implements its existing domain contract; shared row codecs/ownership/cursor helpers are reused only where behavior is identical.
    - Security: all queries require tenant ownership, unique constraints prevent cross-replica duplicate commits, sensitive model/tool content is not added to governance records, and SQL parameters are bound.
  - Approach:
    - Documentation Reviewed:
      - `docs/policy-and-audit.md`, `docs/evaluations.md`, `docs/work-tools.md`, `docs/model-routing.md`, PostgreSQL session/run/checkpoint persistence docs and conformance tests.
      - PostgreSQL transaction, unique constraint, `INSERT ... ON CONFLICT`, row-locking, advisory-lock, and expiry/index documentation for the supported server range.
    - Options Considered:
      - Add Redis first: new operational dependency before measured need; reject.
      - Build one generic key/value state API: erases domain-specific atomicity and retention; reject.
      - Add direct PostgreSQL adapters behind current contracts: chosen.
    - Chosen Approach:
      - Follow the current PostgreSQL package's migration and bounded-query patterns.
      - Keep memory/file adapters for tests and single-process use, clearly labeled non-production.
      - Add a narrow router-state contract only because router mutation semantics are not represented by an existing store.
    - API Notes and Examples:
      ```ts
      const policyStore = createPostgresPolicyDecisionStore({ pool });
      const evaluationStore = createPostgresEvaluationStore({ pool });
      const idempotencyStore = createPostgresIdempotencyStore({ pool });
      const router = createModelRouter({ stateStore: createPostgresModelRouterStateStore({ pool }) });
      ```
    - Files to Create/Edit (tentative):
      - Existing policy, evals, work-tools, and model-router types/exports/tests/docs.
      - PostgreSQL adapter files under the owning package or `session-store-postgres` only after package-boundary review.
      - SQL migrations, codec/conformance helpers, package manifests/changelogs, profiles only if intentionally exposed.
    - References:
      - `packages/policy/src/store.ts`.
      - `packages/evals/src/store.ts`.
      - `packages/work-tools/src/idempotency.ts`.
      - `packages/model-router/src/router.ts:163-165`.
  - Test Cases to Write:
    - Restart persistence and wrong-tenant denial for every store.
    - Concurrent duplicate policy/evaluation/idempotency writes from multiple clients.
    - Connector crash states and duplicate retry with the same idempotency key.
    - Atomic router budget consumption, shared rate windows, circuit open/half-open/close, expiry, contention, and clock-boundary behavior.
    - Migration from current schema, checksum drift, rollback/failure cleanup, and bounded pagination.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new production adapters and router-state configuration.
    - Docs pages to create/edit: `docs/policy-and-audit.md`, `docs/evaluations.md`, `docs/work-tools.md`, `docs/model-routing.md`, PostgreSQL/persistence docs, `docs/migration.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes; update Governance, Evaluations, Work tools, Model routing, and Persistence entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Network-free conformance, disposable PostgreSQL tests, restart/multi-client contention tests, migration checks, storage/performance budget, `npm run sdk:ready`, and package/release gates pass.

- [ ] Phase 7 — Release 0.0.24: distributed event delivery and recoverable tool effects
  - Objectives:
    - Allow agent streams and subscriptions to reconnect across replicas without rerunning completed work.
    - Define honest, durable side-effect semantics across tools, MCP, browser, work connectors, coding operations, and delegated agents.
  - Acceptance Criteria:
    - Functional: a replaceable durable AgentEvent source can append, page, subscribe, resume from cursor, and hand off from historical replay to live delivery without gaps or duplicates visible to consumers.
    - Functional: a PostgreSQL reference implementation supports multiple producers/consumers, disconnect/reconnect, bounded polling or `LISTEN/NOTIFY` wakeups, consumer cancellation, and cleanup/retention.
    - Functional: server SSE, AG-UI, A2A subscriptions, and authorized run replay can reconnect to a different replica through the shared event source; sticky sessions are optional optimization only.
    - Functional: tool definitions may declare effect/idempotency behavior; dispatch supplies stable `runId`, `toolCallId`, and idempotency key and records pending/completed/failed/unknown outcomes around side effects.
    - Functional: duplicate delivery returns a bounded persisted result/reference where safe; ambiguous outcomes require host resolution or tool-specific reconciliation and are never silently replayed.
    - Performance: event append is amortized O(1); replay/subscription pages, cursor size, retained events, subscriber queue, polling interval, and notification fanout are capped; benchmarks cover sustained streams and reconnect p95.
    - Code Quality: current event ledger, multiplexer, server replay, checkpoint, and work-tool idempotency contracts are extended rather than replaced; transport adapters do not implement private replay loops.
    - Security: every event page/subscription and idempotency record rechecks exact ownership; cursors are opaque/bounded; stored outcomes are redacted and byte-limited; one tenant cannot observe timing or identifiers from another.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md`, `docs/agent-session-runtime.md`, `docs/server.md`, `docs/ag-ui.md`, `docs/a2a.md`, `docs/work-tools.md`, run-ledger and PostgreSQL persistence docs.
      - PostgreSQL `LISTEN/NOTIFY` guidance and current SSE/AG-UI/A2A reconnect protocol requirements.
    - Options Considered:
      - Require sticky sessions: simple but no failover; reject as production completeness.
      - Add Kafka/Redis immediately: operational expansion without evidence; reject.
      - PostgreSQL event source over existing durable ledger plus notification/polling: chosen first reference implementation.
      - Claim exactly-once side effects: impossible across arbitrary external systems; reject.
    - Chosen Approach:
      - Define cursor and replay/live handoff semantics at the shared event-source boundary.
      - Use the durable ledger as source of truth; notifications wake consumers but never replace persisted events.
      - Generalize work-tool idempotency into optional tool-effect metadata while retaining specialized reconciliation hooks.
    - API Notes and Examples:
      ```ts
      const events = createPostgresAgentEventSource({ pool });
      const stream = events.subscribe({ ownership, runId, after: cursor, signal });

      const tool = defineTool({
        name: "mail.send",
        effect: { kind: "external_mutation", idempotency: "required" },
        execute: async (args, context) => send(args, context.idempotencyKey),
      });
      ```
    - Files to Create/Edit (tentative):
      - Core AgentEvent/run-ledger/tool contracts and dispatch implementation.
      - PostgreSQL event source/idempotency persistence and conformance.
      - Server, AG-UI, supervisor/A2A, MCP lifecycle, browser/work-tool adapters and tests.
      - Event/idempotency docs, examples, benchmarks, migration notes.
    - References:
      - `docs/agent-session-runtime.md:173` and documented crash ambiguity at line 190.
      - Existing event multiplexer, run ledger, lifecycle, and work-tool idempotency store.
  - Test Cases to Write:
    - Replica A disconnect followed by replica B replay/live subscription with no gap and deterministic deduplication.
    - Subscriber overflow, slow consumer, cancellation, database outage/recovery, notification loss, retention boundary, and cursor tampering.
    - Crash before dispatch mark, after mark/before side effect, during side effect, after external commit/before local completion, and after local completion.
    - Tool-specific deduplication/reconciliation for mail, file, browser side effect, MCP tool, and custom tool fixtures.
    - Cross-tenant run/cursor/idempotency isolation and redaction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new event-source, tool-effect, idempotency, cursor, and unknown-outcome behavior.
    - Docs pages to create/edit: `docs/agent-events.md`, `docs/agent-session-runtime.md`, `docs/server.md`, `docs/ag-ui.md`, `docs/a2a.md`, `docs/mcp-tools.md`, `docs/work-tools.md`, `docs/browser-automation.md`, persistence docs, `docs/migration.md`.
    - `docs/index.md` update: yes; update Runtime events, Server/API, Interop, Tools, and Persistence entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Multi-process PostgreSQL reconnect and crash-window suites pass; server/AG-UI/A2A/MCP conformance passes; event/idempotency benchmarks stay within approved budgets; full release gate passes.

- [ ] Phase 8 — Release 0.0.25: durable custom loops and complete human-in-the-loop semantics
  - Objectives:
    - Make custom loop extensibility compatible with durable suspension/resume.
    - Replace sequential binary approval limitations with one shared richer approval/elicitation model.
  - Acceptance Criteria:
    - Functional: custom `AgentLoopStrategy` may opt into versioned, bounded, redacted `snapshot` and `restore` hooks; durable execution rejects unsupported strategies before provider work.
    - Functional: loop revision and snapshot schema participate in agent fingerprint compatibility; resume fails closed on missing, changed, oversized, malformed, or unauthorized state.
    - Functional: one run may expose multiple pending approvals from a provider turn or nested agent; callers can approve/reject individually or in a batch with expected version/CAS protection.
    - Functional: decisions support allow once, allow for run, reject once, reject for run, optional modified arguments where policy permits, rich rejection reason, and typed elicitation payloads.
    - Functional: nested agent/tool approvals surface to the root run and resume without losing attribution or approving unrelated pending work.
    - Functional: sticky decisions are serialized in durable run state, scope-match exact tool/effect/identity/action constraints, expire at run end, and are rechecked against current policy on resume.
    - Performance: snapshot/approval state remains within current hard state cap; matching and accounting are O(number of pending approvals) with an explicit finite maximum.
    - Code Quality: workflows, coding `ask_user_decision`, MCP elicitation, ACP permissions, AG-UI interrupts, and browser/work-tool approval use shared contracts instead of protocol-specific approval models.
    - Security: delegation cannot widen approval authority; modified arguments are revalidated through guardrails/schema/policy; stale/batch mismatch fails closed; secrets and rejected content are redacted.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-loops.md`, `docs/agent-session-runtime.md`, `docs/workflows.md`, `docs/ag-ui.md`, `docs/mcp-tools.md`, coding approval/security docs.
      - OpenAI Agents SDK human-in-the-loop and serialized run state: <https://openai.github.io/openai-agents-js/guides/human-in-the-loop/>.
      - Microsoft Agent Framework checkpoint/restore concepts: <https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints>.
      - ACP permission outcome and session-mode documentation: <https://agentclientprotocol.com/protocol/tool-calls>.
    - Options Considered:
      - Keep custom loops non-durable: contradicts extensible production harness goal; reject.
      - Persist arbitrary loop objects/callbacks: unsafe and nonportable; reject.
      - Versioned JSON-compatible snapshot hooks with hard bounds: chosen.
      - Build separate approval stores per protocol: duplicates state and creates inconsistent authority; reject.
    - Chosen Approach:
      - Add the minimum optional durable hooks to the existing loop strategy contract.
      - Generalize the existing run interruption record into a bounded pending-decision set with one CAS state transition path.
      - Keep host UI rendering outside Prism; expose schemas and decisions only.
    - API Notes and Examples:
      ```ts
      const loop: AgentLoopStrategy = {
        revision: "2",
        run,
        snapshot: state => ({ cursor: state.cursor }),
        restore: snapshot => ({ cursor: snapshot.cursor }),
      };

      await resumeAgentRun(checkpoint, {
        decisions: [
          { approvalId: "a1", outcome: "allow_for_run" },
          { approvalId: "a2", outcome: "reject_once", reason: "external recipient" },
        ],
      }, { ownership, expectedVersion });
      ```
    - Files to Create/Edit (tentative):
      - Core loop/run-state/checkpoint/fingerprint/approval/tool-dispatch types and tests.
      - Workflow, AG-UI, ACP, MCP, browser, coding-agent, supervisor delegation, server resume adapters/tests.
      - Migration docs and bounded examples.
    - References:
      - Existing durable run-state hard cap, checkpoint CAS, beforeExecute interrupt, workflow suspension, and coding elicitation helpers.
  - Test Cases to Write:
    - Custom loop suspend/restart/restore, schema/revision drift, state overflow, malformed snapshot, credential/callback rejection.
    - Parallel tool approvals, partial batch, stale version, duplicate decision, sticky exact match/non-match, policy change, and expiry.
    - Nested agent approval propagation and attribution.
    - Modified-argument schema/guardrail/policy rerun.
    - AG-UI, ACP, MCP, workflow, and server mapping parity.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; loop strategy, durable state, approval, resume, protocol event, and decision APIs change.
    - Docs pages to create/edit: `docs/agent-loops.md`, `docs/agent-session-runtime.md`, `docs/workflows.md`, `docs/ag-ui.md`, `docs/mcp-tools.md`, `docs/coding-security.md`, `docs/server.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Agent loops, Runtime, Workflows, Interop, Security, and Server entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Durable custom-loop, approval matrix, nested delegation, all protocol mapping, security, state-size, compatibility, and full release tests pass.

- [ ] Phase 9 — Release 0.0.26: coding intelligence, managed processes, forge, and safe egress primitives
  - Objectives:
    - Supply coding capabilities editors and autonomous coding loops need before exposing them through ACP.
    - Keep each capability optional and built over existing repository, execution-policy, sandbox, event, credential, and approval primitives.
  - Acceptance Criteria:
    - Functional: repository listing/search can use Git tracked/unignored file enumeration and nested ignore rules while retaining a bounded native fallback outside Git repositories.
    - Functional: an optional language-intelligence contract supports workspace symbols, definitions, references, diagnostics, hover, and rename/workspace edits through a host-selected LSP client/server.
    - Functional: a `ProcessSession` contract supports start, incremental output, input, status, wait, signal/kill, release, and bounded background lifetime; PTY behavior is optional and platform capability is explicit.
    - Functional: process sessions integrate with sandbox workspace, identity, execution policy, output accumulator, run cancellation, durable metadata, and unknown-outcome semantics without pretending processes survive host/container loss.
    - Functional: one reference forge adapter supports issue context, authenticated push, pull-request create/update, review comments, check/status retrieval, and bounded handoff reconciliation; GitHub is the first implementation unless adoption evidence selects another forge.
    - Functional: one reference allow-list egress composition supports exact host/port/protocol policy, DNS resolution/rebinding defense, redirects, request/response byte and time limits, package-registry/source-host presets, audit, and contained-proxy attestation.
    - Performance: Git enumeration, LSP messages, diagnostics, process output, forge pagination, and proxy traffic have finite counts/bytes/time/concurrency; benchmarks cover large repositories, long-running output, and network backpressure.
    - Code Quality: a primitive review precedes implementation; no parser framework, process scheduler, generic forge abstraction beyond proven common operations, or in-package firewall is invented.
    - Security: ignored/private paths stay excluded unless host-approved; LSP servers and commands are host-selected; process input/output is bounded/redacted; forge scopes are least privilege; credentials never enter model context/argv; egress defaults to none and exact allow rules.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/browser-automation.md`, structured Git and repository operation sources.
      - Language Server Protocol specification: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>.
      - Git pathspec/check-ignore/ls-files documentation: <https://git-scm.com/docs/git-ls-files> and <https://git-scm.com/docs/git-check-ignore>.
      - GitHub App authentication and pull-request APIs: <https://docs.github.com/en/apps> and <https://docs.github.com/en/rest/pulls>.
      - Docker networking/resource controls and selected proxy implementation documentation at plan time.
    - Options Considered:
      - Build a Tree-sitter/indexing platform first: large duplicate language ecosystem; reject.
      - Use host-selected LSP servers through one bounded protocol client: chosen.
      - Make shell emulate process sessions: cannot attach/input/release reliably; reject.
      - Implement GitHub, GitLab, and Bitbucket together: adapter zoo; reject.
      - Enable unrestricted sandbox networking: reject.
    - Chosen Approach:
      - Use structured Git commands for ignore-aware enumeration; retain current native walker as bounded fallback.
      - Define generic reusable LSP/process primitives only after inventorying current tools/events/resources.
      - Implement one forge and one egress reference composition with fake/local conformance before live canaries.
    - API Notes and Examples:
      ```ts
      const repo = createGitAwareRepositoryOperations({ cwd, fallback: nativeRepository });
      const language = createLanguageIntelligence({ transport: lspTransport, workspaceRoot });
      const process = await sessions.start({ command: "npm", args: ["test", "--", "--watch"], pty: false });
      const forge = createGitHubForge({ credentials, repository, approval, idempotencyStore });
      ```
    - Files to Create/Edit (tentative):
      - Coding-agent repository/Git/process/language/forge contracts, tools, events, tests, exports, README.
      - Coding-security sandbox process and egress composition, tests, docs.
      - Optional package/subpath decisions finalized by primitive/package-size review; no new package by default.
      - Fake LSP/forge/proxy fixtures, examples, benchmarks, live workflows.
    - References:
      - Existing `RepositoryOperations`, `createGitOperations`, `ExecutionPolicy`, `DisposableSandbox.execFile`, output accumulator, credentials, approvals, and event contracts.
  - Test Cases to Write:
    - Nested `.gitignore`, global/exclude rules, tracked ignored file, non-Git fallback, symlink and large repository bounds.
    - LSP framing, malformed/oversized message, diagnostics cap, timeout/abort, workspace edit approval, server crash/restart.
    - Process start/output/input/wait/kill/release, orphan cleanup, timeout, output spill, sandbox loss, wrong-owner access.
    - Forge push/PR/review/check idempotency, stale branch/head, pagination, rate limit, token redaction, wrong repository/tenant, and restricted live GitHub App canary.
    - Proxy exact allow/deny, DNS rebinding, redirects, private metadata IPs, package download size/time, TLS, audit, and sandbox attestation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; repository, language, process, forge, egress, tools, events, and configuration surfaces expand.
    - Docs pages to create/edit: `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/browser-automation.md`, new `docs/language-intelligence.md`, new `docs/process-sessions.md`, new `docs/forge-integration.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; add Language intelligence, Process sessions, Forge integration; update Coding tools/security.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Primitive review accepted; network-free and protected GitHub/LSP/sandbox/proxy suites pass; large-repository/process/network benchmarks meet frozen budgets; full release gate passes.

- [ ] Phase 10 — Release 0.0.27: complete ACP coding-host interoperability and lifecycle events
  - Objectives:
    - Make Prism usable as a complete ACP coding agent without implementing a second coding runtime.
    - Map Phase 8 approval and Phase 9 filesystem/process/language/forge capabilities through negotiated ACP features.
  - Acceptance Criteria:
    - Functional: ACP initialization truthfully advertises only configured filesystem, terminal/process, MCP, session-load/delete, additional-directory, prompt-content, elicitation, and configuration capabilities.
    - Functional: client filesystem read/write and terminal operations map through existing coding operations, execution policy, ownership, sandbox/workspace mode, limits, and approval.
    - Functional: session load/resume, mode switching, current-mode updates, extra workspace directories, locations, diffs/content updates, rich prompt content, and MCP server configuration are supported where the pinned stable ACP SDK specifies them.
    - Functional: permission requests map allow once/for run and reject once/for run without widening the Phase 8 shared approval contract.
    - Functional: typed coding lifecycle events cover file change, worktree create/remove, process start/exit, check start/finish, permission denial, configuration change, task create/complete, compaction, and subagent start/stop only where a current host/protocol consumer exists.
    - Functional: modes can alter system prompt contributions, tool availability, workspace write policy, approval policy, and language/forge capability without changing tenant/identity or bypassing current policy.
    - Performance: protocol payload, diff, location, terminal chunk, configuration, directory, event, and session counts/bytes are finite; slow clients use existing bounded queue/overflow behavior.
    - Code Quality: ACP is a transport adapter over shared primitives; no ACP-only filesystem, terminal, session database, approval store, or event runtime is introduced.
    - Security: all client-provided paths/directories/configuration/MCP servers are untrusted and policy-checked; capability negotiation cannot activate unavailable tools; modes only narrow or explicitly host-authorized-switch capability.
  - Approach:
    - Documentation Reviewed:
      - `docs/ag-ui.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/agent-events.md`, `docs/mcp-tools.md`.
      - ACP initialization, session modes, tool calls, filesystem, terminal, and session documentation: <https://agentclientprotocol.com/protocol/initialization>, <https://agentclientprotocol.com/protocol/session-modes>, and <https://agentclientprotocol.com/protocol/tool-calls>.
      - Stable `@agentclientprotocol/sdk` API at implementation time; experimental v2 remains excluded unless promoted stable and separately reviewed.
    - Options Considered:
      - Expose ACP v2 experimental APIs now: unstable compatibility burden; reject until stable or required by a named editor.
      - Implement editor features inside ACP package: duplicates coding primitives; reject.
      - Extend stable ACP v1 adapter over shared coding/session contracts: chosen.
    - Chosen Approach:
      - Freeze a capability matrix against the pinned SDK and at least one real editor client.
      - Add capabilities incrementally with conformance fixtures and truthful initialization responses.
      - Emit typed shared coding events first, then map them to ACP updates.
    - API Notes and Examples:
      ```ts
      const acp = createPrismAcpAgent({
        sessions,
        coding: { filesystem, processes, language, forge },
        modes: [reviewMode, editMode],
        mcpServers: hostSelectedServers,
      });
      ```
    - Files to Create/Edit (tentative):
      - `packages/ag-ui/src/acp/*`, ACP tests/fixtures/exports/docs/changelog.
      - Core or coding-agent shared event/mode types only after primitive review.
      - Coding-security/process/language/forge adapters only for shared contract integration.
      - Real-client example and optional protected interoperability workflow.
    - References:
      - Current ACP adapter advertises only close-session capability and maps only allow-once/reject-once.
      - Existing AgentEvent mapper, session lifecycle, durable resume, coding tools, and MCP client bridge.
  - Test Cases to Write:
    - Initialization capability matrix for every configured/absent feature.
    - Filesystem/terminal/MCP/session/mode/additional-directory/prompt-content round trips and denial paths.
    - Diff/location mapping, output chunk bounds, reconnect/load after replica change, cancellation, and malformed client input.
    - Sticky permission and partial batch approval mapping.
    - Real stable ACP client smoke against read-only, edit, and sandboxed modes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; ACP capabilities, events, modes, configuration, and coding-host behavior expand.
    - Docs pages to create/edit: `docs/ag-ui.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/agent-events.md`, `docs/mcp-tools.md`, `docs/migration.md`; create `docs/acp.md` if ACP content no longer fits AG-UI page.
    - `docs/index.md` update: yes; add/update ACP under Multi-agent/frontend interoperability and coding host integration.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Stable ACP SDK conformance, real-client smoke, all capability/permission/mode/security tests, payload/performance budgets, package compatibility, and full release gate pass.

- [ ] Phase 11 — Release 0.0.28: enterprise authentication, policy, MCP OAuth, API, and artifact adapters
  - Objectives:
    - Reduce repeated security-critical host plumbing while preserving host ownership of users, login UX, policy authorship, credentials, and storage topology.
    - Provide one bounded reference adapter for each confirmed enterprise integration seam.
  - Acceptance Criteria:
    - Functional: optional OIDC/JWKS identity verification validates pinned issuer, audience, signature, expiry/not-before, clock skew, algorithm, key rotation, revocation callback, tenant mapping, principal/scopes, and bounded claims before creating `AgentIdentity`.
    - Functional: one external policy adapter maps Prism identity/action/resource/context to OPA or Cedar, validates bounded decisions, preserves policy id/version/reason/evidence, supports timeout/failure policy, and records the result through durable Phase 6 storage.
    - Functional: MCP HTTP client/server integration supports protected-resource metadata, `WWW-Authenticate`, OAuth/OIDC authorization-server discovery, PKCE, client registration strategy chosen by host, scope challenges, token refresh/revocation, audience validation, and persisted bounded discovery state.
    - Functional: MCP never passes through tokens issued for another resource and applies SSRF/origin/redirect policy to all discovery endpoints.
    - Functional: optional OpenAPI tooling exposes only host-selected operation IDs with normalized JSON Schema, exact server origin, bounded body/pagination/retry, credential callbacks, approval/effect/idempotency metadata, and no generic arbitrary-request escape hatch.
    - Functional: one production artifact blob adapter stores/reads/deletes bodies by opaque reference with ownership, hash/size/MIME verification, optional encryption/KMS callback, signed delivery integration, retention/legal hold, and no local-path disclosure.
    - Functional: adapters compose with current credentials, identity, policy, event, approval, idempotency, redaction, retention, and audit contracts.
    - Performance: JWKS/discovery/policy/schema caches are bounded with expiry; network requests, redirects, schemas, operations, bodies, pages, artifacts, and retries have finite limits and published p95 targets.
    - Code Quality: adapters remain optional; core gains only reusable contracts proven missing by primitive review; vendor SDK dependencies are avoided when native fetch/crypto/current installed dependencies safely cover requirements.
    - Security: fail closed on unknown issuer/audience/algorithm/key, policy timeout/malformed response, OAuth metadata SSRF, token audience mismatch, OpenAPI origin drift/schema abuse, and artifact hash/ownership mismatch; credentials never enter prompts, telemetry, persisted discovery, or errors.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-identity.md`, `docs/policy-and-audit.md`, `docs/mcp-tools.md`, credential/OAuth docs, `docs/work-artifacts-and-review.md`, `docs/host-security.md`.
      - OpenID Connect Discovery, JWT/JWK, OAuth 2.1/security best-current-practice, RFC 9728 protected-resource metadata, and MCP authorization/security specifications.
      - Current OPA or Cedar SDK/HTTP decision documentation selected by named integration.
      - OpenAPI 3.1 and chosen object-store API documentation.
    - Options Considered:
      - Build login UI, user directory, SAML, or SCIM into Prism: host/product scope; reject.
      - Require every host to implement JWT/JWKS and MCP OAuth correctly: repeated security risk; reject.
      - Ship OPA and Cedar together: unnecessary adapter breadth; select one from demand.
      - Automatically expose complete OpenAPI documents: excessive authority and context; reject.
      - Add multiple object stores: reject; one reference adapter plus host contract.
    - Chosen Approach:
      - Add optional Node packages/subpaths only after package and dependency review.
      - Reuse MCP SDK OAuth helpers where compatible with Prism bounds and host credential policy.
      - Compile only explicitly configured OpenAPI operations during host setup, never model-driven discovery.
      - Keep artifact metadata in current stores and bodies in the selected blob adapter.
    - API Notes and Examples:
      ```ts
      const identityVerifier = createOidcIdentityVerifier({
        issuer: "https://id.example.com/tenant",
        audience: "prism-api",
        mapClaims,
      });

      const tools = createOpenApiTools({
        document,
        operations: ["getCustomer", "createCase"],
        server: "https://api.example.com",
        credentials,
        policy,
      });
      ```
    - Files to Create/Edit (tentative):
      - Optional identity/OIDC adapter package or credentials-node subpath, tests/docs.
      - Policy adapter package/subpath selected during plan, tests/docs.
      - MCP auth client/server/discovery integration, credentials storage, fake authorization server, tests/docs.
      - Optional OpenAPI tools package/subpath, schema normalization, tests/docs.
      - Artifact blob contract/reference adapter and server artifact delivery integration.
      - Manifests/profiles only after install-size and adoption review.
    - References:
      - Existing `IdentityVerifier`, `PolicyEvaluator`, OAuth provider/store, MCP SDK bridge/server, `ArtifactService`, lifecycle retention/legal hold, and signed delivery links.
  - Test Cases to Write:
    - OIDC valid/expired/future/revoked/wrong issuer/audience/algorithm/key, JWKS rotation/outage/cache poisoning, oversized claims, tenant mapping.
    - Policy allow/deny/modify/approval, malformed/oversized/timeout, stale version, evidence bounds, fail-closed behavior, durable ledger.
    - MCP metadata discovery, PKCE/state, scope challenge, refresh, callback, token audience, confused deputy, token passthrough denial, SSRF, redirect, exact origin, discovery cache.
    - OpenAPI operation allow-list, server override denial, schema refs/cycles/size, pagination/retry, side-effect approval/idempotency, credential/redaction, hostile response.
    - Artifact upload/download/delete, hash mismatch, wrong tenant, legal hold, retention, signed link, encryption callback, partial failure, and object-store outage.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; identity, policy, OAuth, MCP, OpenAPI tools, artifact storage, credential, and package surfaces expand.
    - Docs pages to create/edit: `docs/agent-identity.md`, `docs/policy-and-audit.md`, `docs/mcp-tools.md`, credential/OAuth docs, `docs/work-artifacts-and-review.md`, `docs/host-security.md`, `docs/migration.md`; create adapter-specific pages following Prism wiki structure.
    - `docs/index.md` update: yes; update Identity/governance, Security/auth/trust, MCP, Tools, Credentials, Artifacts, and Persistence entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Fake-server conformance and protected OIDC/policy/MCP/object-store integration suites pass; security threat fixtures, cache/resource budgets, audit/SBOM/license, package compatibility, and full release gate pass.

- [ ] Phase 12 — Release 0.1.0: production-readiness candidate and operational proof
  - Objectives:
    - Prove the completed enterprise and coding harness surface works together under supported production topologies.
    - Freeze a truthful compatibility, security, capacity, and operator-support contract for 0.1.x.
  - Acceptance Criteria:
    - Functional: clean packed consumers complete enterprise and coding journeys using only public exports and documented package installations.
    - Functional: multi-replica agent run/reconnect, durable custom loop, batched approval, ACP editor session, sandboxed coding process, forge handoff, OIDC identity, policy decision, MCP OAuth, OpenAPI side effect, artifact delivery, and restart recovery pass end to end.
    - Functional: supported Node/PostgreSQL/provider/protocol/platform matrices and explicit unsupported combinations are documented and machine-checked where practical.
    - Functional: upgrade/migration from 0.0.17 through each roadmap release preserves compatible stores or provides tested migration/refusal behavior.
    - Performance: publish reproducible capacity envelopes for event throughput, reconnect latency, database contention/storage growth, policy/identity overhead, approval state, repository/LSP/process operations, ACP streaming, proxy egress, and package startup/install size.
    - Code Quality: declaration/API compatibility, exact internal ranges, migration checksums, tarball allow/deny lists, docs links/examples, lint/format, coverage, and benchmark regressions are mandatory gates.
    - Security: CodeQL/SAST, dependency review, moderate-or-higher audit policy, secret scan, SBOM/license, provenance, signed tag, tenant/protocol/sandbox/egress/OAuth threat suites, and protected live integrations pass with retained evidence.
  - Approach:
    - Documentation Reviewed:
      - All public docs/package READMEs/changelogs and `docs/0.1.0-readiness.md`.
      - Current Node LTS, PostgreSQL, npm trusted publishing/provenance, GitHub Actions security, and each pinned protocol/SDK compatibility document.
    - Options Considered:
      - Add remaining comparison-table features during RC: destabilizes evidence; reject.
      - Release on network-free tests alone: insufficient for production claims; reject.
      - Freeze features, run protected matrix, fix only blockers/regressions, and publish evidence: chosen.
    - Chosen Approach:
      - Update the readiness document to the concrete capabilities and limits delivered by Phases 1-11.
      - Run repeatable end-to-end fixtures in single-process, multi-process PostgreSQL, and contained coding environments.
      - Treat missing credentials/infrastructure as a blocked release gate, not a passing skip.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm run test:postgres
      npm run test:live
      npm run test:sandbox-browser
      npm run release:check -- --version 0.1.0
      npm run release:publish -- --version 0.1.0 --dry-run --allow-untagged
      ```
    - Files to Create/Edit (tentative):
      - Integration/e2e fixtures, protected workflows, benchmark scripts/results, release scripts, compatibility fixtures.
      - `docs/0.1.0-readiness.md`, `docs/release-and-install.md`, `docs/migration.md`, `docs/performance.md`, `docs/index.md`, package READMEs/changelogs.
      - Manifests/lockfile/runtime metadata for 0.1.0 only after all gates pass.
    - References:
      - Existing `sdk:ready`, `release:gate`, package budget, benchmark, provenance, live-canary, PostgreSQL, keychain, Docker/Playwright, and CodeQL workflows.
  - Test Cases to Write:
    - Packed-install enterprise application fixture and packed-install ACP coding-agent fixture.
    - Replica/process/database restart at each event/tool/approval checkpoint.
    - Node supported-version matrix and clean database migration matrix.
    - Provider/protocol/browser/sandbox/forge/OIDC/policy/object-store credentialed canaries.
    - Capacity/backpressure/failure-injection scenarios with frozen pass/fail thresholds.
    - Supply-chain negative fixtures and deterministic publication dry-run.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; readiness, support, compatibility, migration, performance, and release contracts are frozen.
    - Docs pages to create/edit: all affected public docs, especially `docs/0.1.0-readiness.md`, `docs/release-and-install.md`, `docs/migration.md`, `docs/performance.md`, `docs/public-contracts.md`.
    - `docs/index.md` update: yes; verify every public package/capability is discoverable and no retired/unsupported claim remains.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Every release validation item below passes on protected infrastructure; signed `v0.1.0`, npm OIDC provenance, and publication remain explicit operator actions after evidence review.

- [ ] Phase 13 — Demand-gated post-0.1 ecosystem and product expansion
  - Acceptance Criteria:
    - Functional: only capabilities with a named user, concrete integration, operational owner, and measurable success criteria enter an executable plan.
    - Performance: each promoted item declares scale, latency, storage, cost, package-size, and operational budgets before implementation.
    - Code Quality: promoted services consume stable Prism contracts and remain optional; no core dependency or second runtime is added for comparison-table parity.
    - Security: every hosted/device/channel/remote-browser/new-database capability receives identity, tenancy, consent, egress, retention, audit, abuse, supply-chain, and incident-response review.
  - Candidate Capabilities:
    - Studio/control plane and visual workflow editor.
    - Hosted cloud and managed observability.
    - Slack/Teams/channel catalogs, voice/device vendors, and desktop OS control.
    - Remote-browser/sandbox vendors.
    - Additional forges after GitHub adoption evidence.
    - Additional queues/backplanes after PostgreSQL event-source capacity evidence.
    - Additional policy engines, object stores, databases, vector stores, providers, and framework-specific server adapters.
    - Advanced GraphRAG/semantic chunking and cron-expression support.
  - Approach:
    - Documentation Reviewed:
      - Adoption telemetry/issues, production benchmark results, incident reports, user integration requirements, and relevant vendor/protocol docs at promotion time.
    - Options Considered:
      - Prebuild a complete agent platform: rejected.
      - Demand-gated primitive review and optional implementation: chosen.
    - Chosen Approach:
      - Promote one candidate at a time into its own numbered plan only after entry criteria pass.
    - API Notes and Examples:
      ```text
      named demand → primitive review → threat model → measurable plan → optional implementation → conformance → release gate
      ```
    - Files to Create/Edit:
      - None before promotion.
  - Test Cases to Write:
    - Defined by each promoted plan; no placeholder packages, exports, migrations, or tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no until promotion.
    - Docs pages to create/edit: none until promotion.
    - `docs/index.md` update: no until a public capability ships.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Exit Gate:
    - Not applicable as a combined release; each promoted capability receives an independent gate.

## Cross-Phase Architecture Decisions

### Skills and context progressive disclosure

- Skill catalogs expose `name` + `description` by default; full `instructions` load on demand or via explicit eager mode.
- Runtime skill registries default to no active skills; activate-all is an explicit host opt-in.
- Context-budget eviction honors `ContextBlock.priority` and may demote skill bodies to description-only before full drop.
- Mid-flight tool-result summarization is host-opt-in and never the default memory system; observational memory and compaction remain the durable paths.

### Coding tools

- Native bounded operations precede shell for search modes, glob, delete, and move.
- Write/edit durability is atomic on the same filesystem; optional read-before-write is host-gated soft safety, not a hard universal lock.
- Fuzzy edit remains exact-then-fuzzy with documented ambiguity tradeoff; PDF/document readers stay demand-gated.

### Observational memory

- Raw current-branch session messages remain immutable source of truth; compaction changes provider projection, not retention.
- Normal provider context combines bounded active observations/reflections with a bounded exact recent-message suffix.
- Observation and reflection coverage are independent, durable, idempotent, and advance after successful empty processing.
- Dropping controls active context only; source lineage remains available for bounded current-branch recall until host retention removes raw entries.
- Activation is explicit and makes no import/setup side effects; semantic cross-thread/resource recall requires a separately authorized host adapter and measured demand.

### Third-party behavior integrations

- Integration packages wire upstream projects into Prism contributions; they never reimplement prompt fragments, skill bodies, hook logic, or rules.
- Upstream content is loaded from the installed upstream package (optional peer dependency or host-supplied path) and treated as untrusted, bounded text before injection.
- Mode state is per-session via session custom entries with a host-configurable default; no TUI status rendering is performed by Prism.
- Both packages are optional, host-selected, and off the 0.1.0 critical path; loading them is explicit and produces no implicit provider, network, timer, or filesystem activity.
- Caveman/Ponytail skill registration must use Phase 3 progressive disclosure; mode/level prompt slices stay on InstructionInjector paths.

### Durable state

- Keep domain-specific stores and conformance suites.
- Use PostgreSQL as first distributed reference because Prism already supports it.
- Do not introduce Redis/Kafka or a generic distributed-state package until measured capacity demands it.

### Events and delivery

- Durable ledger remains source of truth.
- Notifications are wakeups only; they never replace persisted ordering/replay.
- Protocol adapters consume one event source and one cursor model.

### Tools and side effects

- Effects are at-least-once.
- Stable idempotency identity is based on authorized run/tool-call context, not model-provided keys alone.
- Unknown outcomes are first-class and require reconciliation or human resolution.
- Argument modification re-enters validation, guardrails, policy, accounting, and approval checks.

### Coding

- Native bounded operations precede shell.
- Phase 4 capability gaps (search modes, glob, read-before-write, delete/move) land before Phase 9 LSP/process/forge/egress.
- Git/LSP/process/forge/egress capabilities remain explicit and separately permissioned.
- ACP maps shared capabilities; it does not own a second filesystem, terminal, session, or approval implementation.
- No index daemon, watcher, language server, process, or network service starts implicitly.

### Enterprise integrations

- Hosts own authentication UX, user directory, SAML/SCIM, policy source, credentials, and deployment.
- Prism may verify OIDC/JWT, call a selected policy engine, perform MCP OAuth, bind selected OpenAPI operations, and store artifacts through optional adapters.
- Tokens are audience-bound and never passed through to unrelated resources.
- Remote metadata, schemas, policy results, and artifact references are untrusted and bounded.

## Release Validation Checklist

Every numbered release must satisfy:

- [ ] Active phase acceptance criteria and focused adversarial tests pass.
- [ ] `npm run sdk:ready` passes with zero unexplained failures/skips.
- [ ] Node 20 and current-supported Node builds and public packed imports pass.
- [ ] Relevant observational-memory, skills progressive-disclosure, coding-tool, PostgreSQL, keychain, provider, MCP, A2A, ACP, OIDC, policy, browser, sandbox, egress, forge, object-store, and work-connector protected suites pass where affected.
- [ ] Multi-process restart, failover, cursor, approval, idempotency, and unknown-outcome tests pass where affected.
- [ ] `npm audit` policy, dependency tree, CodeQL/SAST, dependency review, secret scan, SBOM/license, provenance, and tarball-content checks pass.
- [ ] Performance, storage growth, package size, startup, and install-size changes are measured against frozen budgets.
- [ ] Public docs, examples, migration notes, package READMEs/changelogs, package counts, and `docs/index.md` match behavior.
- [ ] Public declarations/exports, internal versions/ranges, lockfile, migrations, and profile contents are consistent.
- [ ] Fresh packed-install and cross-package enterprise/coding journeys pass.
- [ ] Release dry-run is deterministic; clean protected CI, signed tag, and npm OIDC publication evidence are recorded.
- [ ] No blocker is converted into a skip or deferred only to preserve a release number/date.

## Non-Goals Through 0.1.0

- Prism Studio, visual workflow builder, hosted cloud, or managed telemetry backend.
- Built-in user database, login UI, SAML identity provider, or SCIM server.
- Mandatory Kubernetes, Helm, Terraform, Redis, Kafka, SQS, or vendor control plane.
- Automatic provider, credential, MCP server, OpenAPI operation, LSP server, forge, or network discovery.
- Broad Slack/Teams/channel, voice/device, desktop-control, remote-browser, vector-store, object-store, policy-engine, or forge catalogs.
- Local Office runtime or unrestricted SaaS/Graph/Discovery command shell.
- Built-in Caveman or Ponytail prompt content, skill bodies, hook scripts, or rule text; the integration packages only wire upstream packages and never duplicate them.
- Universal prompt registry, feature-flag service, skills marketplace, or peer-to-peer agent-team runtime.
- Automatic resource-wide/cross-thread semantic observational-memory search without an explicitly configured retrieval adapter, ownership policy, consent model, and vector store.
- Built-in PDF/Office document readers in coding tools without named demand and a bounded host-selected parser adapter.
- Exactly-once execution claims for arbitrary external side effects.

## Compromises Made

- None yet. Record phase-specific deviations only after implementation and verification.

## Further Actions

- Execute `plans/001-Release-0-0-18-Restore-Integrity.md` (Phase 1) — **complete** (exit gate 2026-07-30). Create Phase 2 plan (`0.0.19` observational memory) next.
- Do not create plans or scaffolding for later phases until every earlier exit gate passes.
