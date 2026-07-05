# Phase 38 — Explicit capability activation and API cleanup

## Objectives
- Make declarative agent capability activation fail closed: omitted `tools` / `skills` means no tools or skills unless the host opts into legacy all-in-scope behavior.
- Keep runtime skill activation explicit in app-facing APIs and docs; preserve fail-closed `toolNames` enforcement.
- Audit inert `AgentConfig` fields (`extensions`, `settings`, `credentials`) and either wire, deprecate, or document them as host-owned.
- Add strict or deterministic duplicate-registration behavior where silent overwrite can over-grant or shadow contributions.
- Ship migration notes for apps relying on permissive all-tools/all-skills defaults.

## Expected Outcome
- `resolveAgentDefinition()` never grants every in-scope host tool when `AgentDefinition.tools` is omitted by default.
- Declarative `skills` remain opt-in by name; runtime docs emphasize `RunOptions.activeSkills` / `RunOptions.skills` for per-run activation.
- Public config fields either affect runtime or are clearly marked as inert/host-owned/deprecated.
- Registry factories can reject duplicate providers, models, tools, skills, and generic contributions where hosts request strict registration.
- Docs under `/docs` and `docs/index.md` explain explicit activation, duplicate policy, and migration from legacy defaults.

## Tasks

- [x] Task 1 — Primitive review: capability activation, inert config fields, and registry duplicate seams
  - Acceptance Criteria:
    - Functional: Inventory `resolveAgentDefinition`, runtime skill selection, `AgentConfig` field consumption, provider/model/tool/skill/contribution registries, docs claims, and tests that currently depend on all-in-scope tools/skills or last-write-wins registration.
    - Performance: Review confirms planned changes stay at registry lookup/list complexity already present and add no filesystem/network/background work.
    - Code Quality: Review identifies the smallest shared option/types to add and rejects per-agent or per-registry bespoke logic where one generic option works.
    - Security: Review maps every over-grant/shadow path to a fail-closed default or explicit opt-in.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 38 deliverables and acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/agent-definitions.md`, `docs/context-and-skills.md`, `docs/contribution-registries.md`, `docs/agent-session-runtime.md`, `docs/provider-layer.md`, `docs/tools.md`.
      - `src/agent-definitions.ts`, `src/agents.ts`, `src/contracts.ts`, `src/contributions.ts`, `src/providers.ts`, `src/models.ts`, `src/tools.ts`, `src/skills.ts`.
    - Options Considered:
      - Keep permissive omitted-tools default and document caveat: rejected — roadmap acceptance requires an agent cannot accidentally receive every host tool/skill by omission.
      - Add a new capability policy framework: rejected — one explicit legacy opt-in flag is enough.
      - Add strict duplicate options only to generic contribution registries: rejected — provider/model/tool/skill registries also shadow unsafe names.
    - Chosen Approach:
      - Record current behavior and exact callers first, then change defaults with minimal options and migration docs.
    - API Notes and Examples:
      ```ts
      // Expected post-review direction: omitted tools means none.
      resolveAgentDefinition({ name: "safe", model }, { registries }).config.tools?.list(); // [] or undefined
      ```
    - Files to Create/Edit:
      - `plans/039-explicit-capability-activation-and-api-cleanup.md`: record review outcome before implementation.
    - References:
      - `roadmap.md` Phase 38.
      - `src/agent-definitions.ts` `resolveTools()` / `resolveSkills()`.
      - `src/contracts.ts` `AgentConfig`, `RunOptions`, `AgentDefinitionResolutionContext`.
      - `src/contributions.ts` `createContributionRegistry()`.
  - Test Cases to Write:
    - none (review task).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — review gates public runtime/config/registry behavior changes.
    - Docs pages to create/edit:
      - `plans/039-explicit-capability-activation-and-api-cleanup.md`: review notes only.
    - `docs/index.md` update: no; handled in Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Reviewed the Phase 38 capability/config/registry seams and confirmed Task 1 needs no code change; it is an inventory gate for Tasks 2–7.
    - **Capability activation inventory:**
      - `src/agent-definitions.ts:35-44` builds declarative `AgentConfig`; `resolveTools()` at `src/agent-definitions.ts:83-96` is the unsafe path: when `AgentDefinition.tools` is omitted and a host tool source exists, it calls `asToolRegistry(source)` and activates every scoped tool. This is the exact over-grant to remove in Task 2.
      - `resolveSkills()` at `src/agent-definitions.ts:119-130` already treats omitted `AgentDefinition.skills` as none. Named skills route through `resolveActiveSkills()`, so `toolNames` enforcement is already fail-closed for declarative agents.
      - `src/node/agent-definitions.ts:228-252` builds bundle-local union tool/skill registries, then passes `tools: tools.length > 0 ? tools : options.tools` and `skillsRegistry: skills.length > 0 ? createSkillRegistry(skills) : options.skillsRegistry` into `resolveAgentDefinition()`. Because parsed `def.tools` / `def.skills` are name lists, bundle tool/skill activation is explicit when frontmatter names exist. Risk remains only when a bundle omits `tools` but `options.tools` is passed: current `resolveTools()` grants all `options.tools`.
      - Runtime tool activation is already explicit: `src/agents.ts:143` calls `activeTools(this.agent.config.tools)`, and `activeTools()` at `src/agents.ts:562-566` returns an empty registry/list when no tools are configured.
      - Runtime skill activation is explicit per run when a `SkillRegistry` is configured: `src/agents.ts:328-336` uses `RunOptions.activeSkills` with `resolveActiveSkills()`, `RunOptions.skills` for plain-array overrides, else all configured skills. This matches current docs but Task 3 should add/keep runtime regressions around `RunOptions.skills: []` and inactive-tool fail-fast.
      - Current tests depending on permissive declarative tools: `src/__tests__/agent-definitions.test.ts:267-272` (`passes host tool scope through when agent declares no tools`) must be rewritten into legacy-opt-in coverage. Bundle tests at `src/__tests__/node-agent-definitions.test.ts:400-434` already verify named explicit tools only.
    - **Inert `AgentConfig` field inventory:**
      - `src/contracts.ts:204-235` exposes `AgentConfig.extensions`, `settings`, and `credentials`.
      - `src/agents.ts` consumes many config fields (`store`, `provider`, `providerSource`, `tools`, `context`, `skills`, builders, middleware, `resourceLoader`, `permission`, provider options/policies, prompts, redactor, ledger, ownership, compaction, retry, metadata, validator, instruction injectors, loop), but grep found no runtime read of `agent.config.extensions`, `agent.config.settings`, or `agent.config.credentials`.
      - `docs/agent-session-runtime.md:124-138` already says `createAgent()` does not load `AgentConfig.extensions`, resolve credentials, or read settings. Task 4 should make this contract explicit in type JSDoc and related docs rather than wiring hidden extension/settings/credential work into every run.
      - Security decision: keep `credentials` edge-owned by provider packages/request policies; do not resolve credentials eagerly from runtime because that would risk events/stores/prompts seeing secrets.
    - **Registry duplicate/shadow inventory:**
      - `src/contributions.ts:36-56` generic `createContributionRegistry()` uses `Map.set()`; docs say `register()` stores or replaces and `list()` is insertion order. Tests depending on replacement: `src/__tests__/contributions.test.ts:102-112`, `src/__tests__/contributions-discovered.test.ts:80-93`, and `src/__tests__/extensions.test.ts:126-136`.
      - `src/providers.ts:12-31`, `src/models.ts:12-32`, `src/tools.ts:29-49`, and `src/skills.ts:8-28` all silently replace by id/name/key through `Map.set()`. Tests depending on deterministic replacement include `src/__tests__/tools.test.ts:27-38` and `src/__tests__/skills.test.ts:15-26`; provider/model tests currently do not cover duplicate behavior.
      - `docs/provider-layer.md:93-103` explicitly says array provider resolver uses last duplicate id wins; `docs/contribution-registries.md:29-42` and `docs/tools.md:23-35` document replacement. Task 5 must keep default replacement for compatibility but add strict duplicate options for host-selected safety.
      - Existing bundle resolver already has one strict duplicate seam: `src/node/agent-definitions.ts` union helpers throw duplicate skill/tool names across scopes; docs and tests (`src/__tests__/node-agent-definitions.test.ts:437+`) already cover this. Do not replace it with generic last-write-wins.
    - **Smallest primitive decisions for later tasks:**
      - Add one explicit migration opt-in on `AgentDefinitionResolutionContext` (planned name: `activateAllCapabilities?: true`) rather than a capability policy framework or magic `"*"` names. Default should be omitted tools/skills = none; legacy opt-in may call the current `asToolRegistry(source)` path.
      - Add one shared duplicate policy shape across registry factories, e.g. `{ duplicate?: "replace" | "error" }`, defaulting to `"replace"`. Implementation is one O(1) `Map.has()` before `set()` per registration; no extra scans.
      - Use type/doc comments to mark `AgentConfig.extensions`, `settings`, and `credentials` as host-owned/inert unless a later task finds a concrete existing runtime seam. Do not auto-load extensions, read settings, or resolve credentials in `createAgent()` / `session.run()`.
    - **Performance boundary confirmed:** planned changes stay in existing in-memory registry lookup/list paths: named capability resolution remains linear in requested names plus active tool names; strict duplicates add one `Map.has()`; omitted capability lists can avoid registry scans. No filesystem, network, watchers, background workers, provider calls, or token budgeting are required.
    - **Security boundary confirmed:** over-grant paths are omitted declarative `tools` with in-scope host tools and silent duplicate shadowing in registries. Both map to fail-closed defaults or explicit opt-in (`activateAllCapabilities`, strict duplicate policy). Inert config fields map to docs/type clarity, not hidden runtime execution.

- [x] Task 2 — Make declarative agent tools and skills explicit by default
  - Acceptance Criteria:
    - Functional: `AgentDefinition.tools === undefined` resolves to no active tools by default; `AgentDefinition.skills === undefined` resolves to no active skills; named tools/skills still resolve fail-closed; hosts can opt into legacy all-tools/all-skills behavior explicitly if needed for migration.
    - Performance: Named resolution remains linear in requested names plus active tool list; omitted lists avoid unnecessary registry scans unless legacy opt-in is set.
    - Code Quality: Behavior is centralized in `resolveAgentDefinition()` and typed options, with no hidden registry globals.
    - Security: Omitted capability lists cannot accidentally activate every host-scoped tool or skill.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-definitions.md` activation and scope notes.
      - `docs/context-and-skills.md` runtime active-skill semantics.
      - `src/agent-definitions.ts` `resolveTools()` / `resolveSkills()`.
      - `src/__tests__/agent-definitions.test.ts` current permissive-default tests.
    - Options Considered:
      - Breaking default only, no escape hatch: rejected — migration notes ask for apps relying on old defaults.
      - `activateAllCapabilities?: true` on `AgentDefinitionResolutionContext`: chosen if review confirms no better existing host-owned place; explicit, local, and not persisted in definitions.
      - Magic `tools: ["*"]`: rejected — string names should stay literal and fail closed.
    - Chosen Approach:
      - Add the smallest explicit legacy opt-in to `AgentDefinitionResolutionContext`, change omitted `tools` to no active registry, keep `skills` omitted as none, and preserve named resolution errors.
    - API Notes and Examples:
      ```ts
      resolveAgentDefinition(def, { registries }); // omitted tools/skills => none
      resolveAgentDefinition(def, { registries, activateAllCapabilities: true }); // migration-only legacy behavior
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add typed opt-in field if review confirms name.
      - `src/agent-definitions.ts`: change omitted `tools` handling and keep named fail-closed behavior.
      - `src/__tests__/agent-definitions.test.ts`: update/add explicit activation tests.
      - `docs/agent-definitions.md`: document new default and opt-in.
    - References:
      - `roadmap.md` Phase 38 first acceptance item.
      - `src/agent-definitions.ts` `resolveTools()` currently converts omitted names + source into all tools.
  - Test Cases to Write:
    - Omitted `tools` with in-scope tools returns an agent with no active tools by default.
    - Omitted `skills` with in-scope skills returns no active skills by default.
    - Named `tools: ["echo"]` activates only `echo`.
    - Named missing tool/skill throws before any provider turn.
    - Legacy opt-in activates all in-scope tools and docs mark it migration-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — changes declarative agent default capability activation and may add a resolution option.
    - Docs pages to create/edit:
      - `docs/agent-definitions.md`: explicit activation default, legacy opt-in, examples.
      - `docs/context-and-skills.md`: clarify declarative skills are inactive unless listed or run-selected.
      - `docs/migration.md`: migration note if file exists; otherwise add section to `docs/agent-definitions.md`.
    - `docs/index.md` update: yes; update Agent definitions entry if wording changes and add migration entry only if `docs/migration.md` is created.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Implemented fail-closed declarative capability defaults in `src/agent-definitions.ts`: omitted `AgentDefinition.tools` now produces no active tools, and omitted `AgentDefinition.skills` now produces no active skills.
    - Added `AgentDefinitionResolutionContext.activateAllCapabilities?: true` in `src/contracts.ts` as migration-only opt-in; `src/node/agent-definitions.ts` forwards the same option from `resolveAgentBundle()`.
    - Preserved named fail-closed resolution: explicit tool names still resolve from active scope and unknown tool/skill names still throw before provider turns; `resolveActiveSkills()` still enforces `toolNames` against active tools.
    - Added regression coverage in `src/__tests__/agent-definitions.test.ts` for omitted tools/skills defaulting to none and legacy opt-in activating all scoped tools/skills; added `src/__tests__/node-agent-definitions.test.ts` coverage for bundle-level default and forwarded legacy opt-in.
    - Updated `docs/agent-definitions.md`, `docs/context-and-skills.md`, and `docs/index.md` with explicit activation defaults, migration-only opt-in, and no new `docs/migration.md` because no migration page exists.
    - Verification: `npm run build:core` passed; `node --test dist/__tests__/agent-definitions.test.js dist/__tests__/node-agent-definitions.test.js` passed (34 tests).

- [x] Task 3 — Lock runtime skill activation docs and tests around explicit selection
  - Acceptance Criteria:
    - Functional: Runtime behavior remains: `RunOptions.activeSkills` selects by name from `SkillRegistry`, `RunOptions.skills` overrides plain arrays, and `toolNames` enforcement fails before provider calls; docs no longer imply skills can activate tools or auto-grant access.
    - Performance: Active skill selection remains `Map` lookup plus active-tool set construction; no skill ranking, scanning discovery roots, or token budgeting added.
    - Code Quality: Tests cover runtime behavior through `createAgent()` / `session.run()` instead of only helper-level tests.
    - Security: A skill requiring an inactive/missing tool fails closed and writes no session entries/provider request.
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md` runtime skill selection section.
      - `docs/tools.md` active tool allow/deny language.
      - `src/agents.ts` skill selection path.
      - `src/skills.ts` `resolveActiveSkills()`.
    - Options Considered:
      - Change runtime default to no skills for all `AgentConfig.skills`: rejected unless Task 1 finds roadmap requires it; this phase targets app-facing explicit activation without breaking direct `AgentConfig.skills` use unnecessarily.
      - Add per-skill permission model: rejected — permissions stay host/tool owned.
      - Add regression-only docs/tests: chosen unless review finds code drift.
    - Chosen Approach:
      - Keep code if already correct; add missing runtime tests and tighten docs wording.
    - API Notes and Examples:
      ```ts
      await session.run("summarize", { activeSkills: ["summary"] });
      await session.run("plain", { skills: [] }); // explicit no skills for this run
      ```
    - Files to Create/Edit:
      - `src/__tests__/agents.test.ts`: runtime active-skill / inactive-tool regression if missing.
      - `docs/context-and-skills.md`: explicit activation wording.
      - `docs/tools.md`: cross-reference skill `toolNames` as requirement only.
    - References:
      - `src/agents.ts` runtime skill selection.
      - `src/skills.ts` `resolveActiveSkills()`.
  - Test Cases to Write:
    - Same agent can run once with `activeSkills: ["summarize"]` and once with `activeSkills: ["translate"]`; inactive skill context/instructions do not appear.
    - `RunOptions.skills: []` disables plain-array configured skills for a run.
    - Skill demanding an inactive tool throws before provider generate and before store append.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — clarifies runtime skill activation and fail-closed tool requirements.
    - Docs pages to create/edit:
      - `docs/context-and-skills.md`: explicit runtime selection and `toolNames` enforcement.
      - `docs/tools.md`: skill `toolNames` cannot grant permissions.
    - `docs/index.md` update: no unless navigation text needs explicit activation wording; Task 7 handles final docs audit.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Kept runtime selection semantics intact: `RunOptions.activeSkills` selects by name from `SkillRegistry`; `RunOptions.skills` overrides plain-array configured skills; no runtime default change for direct `AgentConfig.skills`.
    - Moved runtime active tool/skill resolution in `src/agents.ts` before appending run input so `toolNames` failures happen before provider calls and before session-store writes.
    - Extended `src/__tests__/agents.test.ts` to verify `RunOptions.skills: []` disables plain-array configured skills and inactive-tool skill selection leaves provider turns at zero and session store empty.
    - Existing runtime tests already cover same-session runs with different `activeSkills`, inactive skill instructions/context omission, and skill context merge order; these continued to pass.
    - Tightened `docs/context-and-skills.md` with `skills: []` example and explicit selection wording; tightened `docs/tools.md` to state skill `toolNames` requirements do not register, permit, execute, or grant tools.
    - Verification: `npm run build:core` passed; `node --test dist/__tests__/agents.test.js dist/__tests__/docs.test.js` passed (103 tests); full `npm test` exited 0.

- [x] Task 4 — Resolve inert `AgentConfig` fields: `extensions`, `settings`, `credentials`
  - Acceptance Criteria:
    - Functional: Each field is classified and implemented accordingly: runtime-consumed, deprecated, or documented host-owned. No docs claim runtime use for a field that runtime ignores.
    - Performance: No extension loading, settings lookup, or credential resolution is added to each run unless the field is deliberately wired and tested.
    - Code Quality: If a field stays host-owned, docs and type comments say so; if deprecated, tests/types keep compatibility until removal policy is documented.
    - Security: `credentials` are not resolved eagerly or serialized into events/stores; `extensions` do not auto-execute from `AgentConfig` unexpectedly.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AgentConfig` fields.
      - `src/agents.ts` config consumption.
      - `docs/agent-session-runtime.md`, `docs/extensions.md`, `docs/credentials-and-redaction.md`, `docs/settings-auth-trust-security.md`.
    - Options Considered:
      - Wire all three into runtime now: rejected unless review proves existing seams need it; auto-running extensions/settings/credentials risks hidden work.
      - Remove fields immediately: rejected if exported public contracts would break users; prefer docs/deprecation first.
      - Document as host-owned/inert where true: likely chosen for `extensions` and `settings`; `credentials` may stay provider/request-policy owned if already used elsewhere.
    - Chosen Approach:
      - Audit with grep, then make the smallest truthful change: type doc comments and docs updates for host-owned fields, or wire exactly one existing seam if a field already has a clear runtime call site.
    - API Notes and Examples:
      ```ts
      // Host-owned extension setup: run extension setup before createAgent().
      const kernel = createExtensionKernel();
      await kernel.load(extension);
      const agent = createAgent({ model, provider, tools: kernel.registries.tools.list() });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: JSDoc/deprecation tags or typed field changes if needed.
      - `src/agents.ts`: only if wiring a field through an existing runtime seam.
      - `src/__tests__/public-contracts.test.ts` or targeted tests: verify behavior/docs contract.
      - `docs/agent-session-runtime.md`, `docs/extensions.md`, `docs/credentials-and-redaction.md`, `docs/settings-auth-trust-security.md`: align field semantics.
    - References:
      - `roadmap.md` Phase 38 inert-field deliverable.
      - `src/contracts.ts` `AgentConfig.extensions`, `settings`, `credentials`.
  - Test Cases to Write:
    - If fields stay inert/host-owned: a contract/doc regression test asserts docs mention host-owned semantics.
    - If `credentials` is wired: runtime resolves credentials only at provider edge and redacts errors/events.
    - If `extensions` is wired: extension setup is explicit and does not auto-load filesystem packages.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — clarifies or changes `AgentConfig` public fields.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: config field consumption table.
      - `docs/extensions.md`: extension setup is host-owned unless wired.
      - `docs/credentials-and-redaction.md`: credential resolver ownership and edge resolution.
      - `docs/settings-auth-trust-security.md`: settings provider ownership.
    - `docs/index.md` update: yes if page descriptions need host-owned config wording; Task 7 handles final docs audit.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Classified all three fields as host-owned metadata, not deprecated and not runtime-consumed: `AgentConfig.extensions`, `AgentConfig.settings`, and `AgentConfig.credentials` remain preserved on `agent.config` for compatibility, but `createAgent()` / `session.run()` do not execute or resolve them.
    - Added JSDoc in `src/contracts.ts` documenting that `extensions` are not loaded/run, `settings` are not read, and `credentials` are not resolved by the runtime.
    - Added runtime regression in `src/__tests__/agents.test.ts`: running an agent with these fields does not call `Extension.setup()`, `settings.get()`, or `credentials.resolve()`, and the unused credential value is not serialized into the session store.
    - Added docs regression in `src/__tests__/docs.test.ts` requiring host-owned/inert wording across runtime, extensions, credentials, settings/security, and public-contract docs.
    - Updated `docs/agent-session-runtime.md` with a field behavior table; updated `docs/extensions.md`, `docs/credentials-and-redaction.md`, `docs/settings-auth-trust-security.md`, and `docs/public-contracts.md` to align field semantics.
    - Performance/security outcome: no extension loading, settings lookup, credential resolution, filesystem scan, package import, background worker, or per-run secret handling path was added.
    - Verification: `npm run build:core` passed; `node --test dist/__tests__/agents.test.js dist/__tests__/docs.test.js` passed (105 tests); full `npm test` exited 0.

- [x] Task 5 — Add strict duplicate registration options for unsafe registries
  - Acceptance Criteria:
    - Functional: Provider, model, tool, skill, and generic contribution registries support a strict option that throws on duplicate ids/names/keys; default behavior is deterministic and documented for compatibility.
    - Performance: Duplicate checks are O(1) `Map.has()` before `set()` and do not change lookup/list complexity.
    - Code Quality: Option shape is consistent across registry factories; duplicate error messages include registry label/key.
    - Security: Hosts can prevent silent shadowing of providers/models/tools/skills/contributions in strict mode.
  - Approach:
    - Documentation Reviewed:
      - `docs/contribution-registries.md` last-write-wins text.
      - `docs/provider-layer.md` provider/model registry behavior.
      - `docs/tools.md` tool registry behavior.
      - `docs/context-and-skills.md` skill registry behavior.
      - `src/contributions.ts`, `src/providers.ts`, `src/models.ts`, `src/tools.ts`, `src/skills.ts`.
    - Options Considered:
      - Flip all registries to strict by default: rejected for compatibility; docs can recommend strict for external apps.
      - Add only generic registry strictness: rejected — provider/model/tool/skill shadowing also matters.
      - One shared `{ duplicate?: "replace" | "error" }` option: chosen if review confirms ergonomic; avoid multiple booleans.
    - Chosen Approach:
      - Add tiny duplicate-policy options to factories, reuse helper/error wording where cheap, keep current default replace behavior, and update tests/docs.
    - API Notes and Examples:
      ```ts
      const tools = createToolRegistry([], { duplicate: "error" });
      tools.register(echo);
      tools.register(echo); // throws Duplicate tool: echo
      ```
    - Files to Create/Edit:
      - `src/contributions.ts`: generic duplicate option.
      - `src/providers.ts`: provider duplicate option.
      - `src/models.ts`: model duplicate option.
      - `src/tools.ts`: tool duplicate option.
      - `src/skills.ts`: skill duplicate option.
      - `src/__tests__/contributions.test.ts`, `src/__tests__/registries.test.ts`, `src/__tests__/tools.test.ts`, `src/__tests__/skills.test.ts`: strict duplicate tests.
      - `docs/contribution-registries.md`, `docs/provider-layer.md`, `docs/tools.md`, `docs/context-and-skills.md`: document policy.
    - References:
      - `roadmap.md` Phase 38 registry duplicate policy deliverable.
  - Test Cases to Write:
    - `createContributionRegistry({ duplicate: "error" })` throws on same key.
    - `createProviderRegistry([], { duplicate: "error" })` throws on same provider id, including duplicates supplied at construction.
    - `createModelRegistry([], { duplicate: "error" })` throws on same `provider/model`.
    - `createToolRegistry([], { duplicate: "error" })` and `createSkillRegistry([], { duplicate: "error" })` throw on same name.
    - Default factories preserve replace behavior and insertion/list determinism.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — adds registry duplicate-policy options and documents default/strict behavior.
    - Docs pages to create/edit:
      - `docs/contribution-registries.md`: generic strict option and migration advice.
      - `docs/provider-layer.md`: provider/model strict option.
      - `docs/tools.md`: tool registry strict option.
      - `docs/context-and-skills.md`: skill registry strict option.
    - `docs/index.md` update: yes; Task 7 finalizes navigation summaries if needed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Added shared duplicate-policy primitive in `src/registry-options.ts`: `{ duplicate?: "replace" | "error" }`, exported as `DuplicateRegistrationOptions` / `DuplicateRegistrationPolicy`.
    - Added strict duplicate support to `createContributionRegistry()`, `createContributionRegistries()`, `createProviderRegistry()`, `createModelRegistry()`, `createToolRegistry()`, and `createSkillRegistry()` while keeping default `"replace"` compatibility behavior.
    - Duplicate errors include label and key: `Duplicate provider: <id>`, `Duplicate model: <provider>/<model>`, `Duplicate tool: <name>`, `Duplicate skill: <name>`, and generic `Duplicate <label>: <key>`.
    - Performance outcome: strict mode adds one O(1) `Map.has()` before existing `Map.set()` only; lookup/list complexity unchanged.
    - Security outcome: hosts can opt into strict mode to prevent silent shadowing across providers/models/tools/skills/contributions.
    - Tests added for constructor-time and register-time duplicates plus default replacement determinism in `src/__tests__/registries.test.ts`, `src/__tests__/contributions.test.ts`, `src/__tests__/tools.test.ts`, and `src/__tests__/skills.test.ts`; docs coverage added in `src/__tests__/docs.test.ts`.
    - Docs updated in `docs/contribution-registries.md`, `docs/provider-layer.md`, `docs/tools.md`, and `docs/context-and-skills.md` with default/strict behavior and `Map.has()` performance notes.
    - Verification: `npm run build:core` passed; `node --test dist/__tests__/registries.test.js dist/__tests__/contributions.test.js dist/__tests__/tools.test.js dist/__tests__/skills.test.js dist/__tests__/docs.test.js` passed (80 tests); full `npm test` exited 0.

- [x] Task 6 — Migration notes and compatibility tests for explicit capability activation
  - Acceptance Criteria:
    - Functional: Migration docs show old behavior, new safe default, and explicit opt-ins for all-tools/all-skills or named activation. Tests cover the documented migration path.
    - Performance: No compatibility shim adds runtime scans unless the explicit legacy opt-in is used.
    - Code Quality: Migration examples compile or are docs-test-covered where existing docs tests support it.
    - Security: Migration docs recommend named capabilities or strict registries over legacy all-in-scope activation.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-definitions.md` examples.
      - `docs/context-and-skills.md` runtime activation examples.
      - `docs/contribution-registries.md` duplicate policy.
      - Existing `docs/migration.md` if present.
    - Options Considered:
      - Create a broad migration guide now: chosen only if `docs/migration.md` exists or docs index already has migration section.
      - Keep migration notes in changed pages: chosen if no migration page exists; fewer files.
      - Runtime warning on legacy opt-in: rejected — libraries should not log by default.
    - Chosen Approach:
      - Add concise migration sections to the docs users will already read, with one explicit code example for named tools/skills and one for legacy opt-in.
    - API Notes and Examples:
      ```ts
      // Before: omitted tools could mean every scoped tool.
      // After: list names explicitly.
      resolveAgentDefinition({ name: "doc", model, tools: ["read"], skills: ["brief"] }, context);
      ```
    - Files to Create/Edit:
      - `docs/agent-definitions.md`: migration section.
      - `docs/context-and-skills.md`: runtime skill activation migration note.
      - `docs/contribution-registries.md`: strict duplicate recommendation.
      - `src/__tests__/docs.test.ts`: update docs requirements if needed.
    - References:
      - `roadmap.md` Phase 38 migration-notes deliverable.
  - Test Cases to Write:
    - Docs test contains/checks explicit capability activation terms on `docs/agent-definitions.md`.
    - Code-level test mirrors migration example: named list activates only named tools/skills; legacy opt-in preserves previous all-in-scope behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents breaking/default behavior and migration path.
    - Docs pages to create/edit:
      - `docs/agent-definitions.md`: primary migration notes.
      - `docs/context-and-skills.md`: active-skill migration note.
      - `docs/contribution-registries.md`: strict duplicates recommendation.
      - `docs/migration.md`: create/edit only if project already uses it for public migration notes.
    - `docs/index.md` update: yes if `docs/migration.md` is created; otherwise Task 7 updates existing descriptions only.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - No `docs/migration.md` existed, so migration notes stayed in the API pages users already read.
    - Added `docs/agent-definitions.md` section `Migration: explicit capability activation` covering old Phase 37 omitted-capability behavior, new safe default (`tools`/`skills` omitted means none), named activation example, and temporary `activateAllCapabilities: true` compatibility shim.
    - Added `docs/context-and-skills.md` migration note for declarative skills and runtime `RunOptions.activeSkills` narrowing.
    - Added `docs/contribution-registries.md` migration-safety note recommending `createContributionRegistries({ duplicate: "error" })` while moving legacy all-in-scope configs to named capabilities.
    - Added code-level migration coverage in `src/__tests__/agent-definitions.test.ts`: named lists activate only named tools/skills, legacy opt-in activates all scoped capabilities, and omitted capabilities do not call `list()` on scoped registries unless `activateAllCapabilities: true` is set.
    - Added docs coverage in `src/__tests__/docs.test.ts` for old/new behavior, named activation, compatibility opt-in, and strict-registry recommendation.
    - Performance/security outcome: no runtime warning/logging or compatibility shim was added; only explicit legacy opt-in list-scans all scoped capabilities, while docs recommend named capabilities plus strict registries over legacy all-in-scope activation.
    - Verification: `npm run build:core` passed; `node --test dist/__tests__/agent-definitions.test.js dist/__tests__/node-agent-definitions.test.js dist/__tests__/docs.test.js` passed (80 tests); full `npm test` exited 0.

- [x] Task 7 — Docs/index audit and final verification
  - Acceptance Criteria:
    - Functional: `/docs` pages and `docs/index.md` agree with implemented behavior for agent definitions, skills, registries, and agent config fields.
    - Performance: Verification uses existing build/test/docs checks; no new slow or network tests.
    - Code Quality: All changed public types are exported consistently and docs examples use current names/options.
    - Security: Final docs state explicit activation, fail-closed missing dependencies, strict duplicate option, and no secret-bearing eager credential behavior.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` required API page structure.
      - `docs/index.md` navigation groups.
      - All docs changed in Tasks 2–6.
    - Options Considered:
      - Add a new docs page solely for capability activation: rejected unless docs become too long; existing agent definitions/context/registries pages already own the APIs.
      - Run full monorepo tests only: rejected if targeted faster checks fail to cover docs; run targeted plus existing default no-network check if affordable.
      - Skip docs index change: rejected — public API/default behavior changes require navigation text audit.
    - Chosen Approach:
      - Update index summaries in place, run build + targeted tests + docs test, then run the smallest existing all-core no-network test command used by prior plans.
    - API Notes and Examples:
      ```sh
      npm run build:core && node --test dist/__tests__/agent-definitions.test.js dist/__tests__/contributions.test.js dist/__tests__/registries.test.js dist/__tests__/tools.test.js dist/__tests__/skills.test.js dist/__tests__/docs.test.js
      ```
    - Files to Create/Edit:
      - `docs/index.md`: update navigation summaries/links for changed pages.
      - `plans/039-explicit-capability-activation-and-api-cleanup.md`: mark completed tasks and record compromises/further actions after verification.
    - References:
      - `docs/index.md`.
      - Prior plan verification pattern from `plans/038-security-boundary-hardening.md`.
  - Test Cases to Write:
    - Existing docs test passes after page updates.
    - Targeted registry/agent/skill/tool tests pass.
    - Full existing core no-network test command passes if runtime budget allows.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — final documentation consistency for all public changes in this plan.
    - Docs pages to create/edit:
      - `docs/index.md`: update Agent definitions, Context and skills, Contribution registries, Agent/session runtime entries if behavior text changes.
      - Any Task 2–6 docs that fail the final audit.
    - `docs/index.md` update: yes; update existing navigation entries, and add `docs/migration.md` only if created.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Audited changed docs and updated `docs/index.md` summaries for agent/session runtime, agent definitions, provider layer, context and skills, tools, contribution registries, security/auth/trust, and credentials/redaction.
    - `docs/index.md` now calls out explicit/fail-closed capability activation, migration-only `activateAllCapabilities`, replace-or-error duplicate policy, strict `duplicate: "error"` mode, host-owned `AgentConfig.settings`/`credentials`, and no eager credential resolution.
    - Added `src/__tests__/docs.test.ts` coverage for the Phase 38 index summary so future docs drift fails tests.
    - Verified public type exports remain consistent through `npm run build:core` and existing docs export checks.
    - Verification: `npm run build:core` passed; targeted command `node --test dist/__tests__/agent-definitions.test.js dist/__tests__/contributions.test.js dist/__tests__/registries.test.js dist/__tests__/tools.test.js dist/__tests__/skills.test.js dist/__tests__/docs.test.js` passed (99 tests); all-core no-network `node --test dist/__tests__/*.test.js` exited 0; full `npm test` exited 0.

## Compromises Made
- No new migration page was created; existing API pages and `docs/index.md` own the behavior, which keeps navigation smaller and avoids one more page to maintain.
- `activateAllCapabilities: true` remains as an explicit migration-only compatibility shim; no warning/logging was added because libraries should not emit unrequested runtime output.

## Further Actions
- Future breaking release: consider removing `activateAllCapabilities` after external apps migrate to named `tools` / `skills` and strict registries.
