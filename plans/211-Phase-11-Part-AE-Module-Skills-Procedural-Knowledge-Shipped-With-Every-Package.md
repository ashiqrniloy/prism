# Phase 11 Part AE — module skills: procedural knowledge shipped with every package

> **Superseded by plan 215 (2026-11-04).** On the owner's decision to cut one consolidated 0.13.0 release plan after plan 208, with the memory packages published as experimental, every open task here moved to [plan 215](215-Phase-11-Part-AI-Release-0.13.0-Experimental-Memory-Host-Adoption-Cache-Parity-Freeze-Acceptance-And-Publish.md) with its criteria intact; the task lines below name the new numbers. This file is kept as history and is not executed.

## Objectives

- Give an agent built on Prism the procedural knowledge it needs to use each module well (web tools, coding tools, browser, OpenAPI, delegation, office documents, research, memory) without the host writing or shipping any of it.
- Ship that knowledge inside the package that owns the tools, as bundled `SKILL.md` files registered through `PackageAPI.skills.addDir`. The guidance then matches the tool code's version, exists only when the package is loaded, costs one catalog line until it is loaded, and can be turned off with `disable.skills`.
- List a skill only when the tools it teaches are available to the run, so a skill never tells the model to call a tool the host disabled, narrowed away, or hid with `when`.
- Hold every shipped skill to one authoring contract: a sharp "when to use" description, a bounded body, tool names that match the package's registered tools, and no references to retired names.
- Keep the catalog small and cache-stable across the full package set.
- Prove every shipped skill with a paired skill-on / skill-off evaluation, and remove or rewrite a skill that does not help.
- Let a vendor agent driven by a Prism host receive the same skills for the Prism tools it is lent.

## Expected Outcome

- `Skill` gains `requiresTools`. `SKILL.md` declares it Agent-Skills-compatibly as `metadata.prism-requires-tools`. The kernel lists such a skill only in requests whose advertised tools include every name. `load_skill` on an unavailable skill returns a tool error naming the missing tools; it never fails the run. This is the skills counterpart of `PackageToolOptions.when` (`src/packages/api.ts:36`).
- Every package that registers a model-visible tool either ships at least one skill, or the Task 1 ledger records why its tool descriptions are enough. Today's 11 bundled skills (research 4, work 4 vendored from Hermes, wiki 2, computer-use 1) are audited against the contract. The wiki skills, which still teach the retired `wiki_record_insight` tool and `qmd` `vsearch` (`packages/memory/wiki/skills/wiki-searcher/SKILL.md:7,34`), are rewritten or removed to match plans 207 and 210.
- The conformance gate `package_skills_conform` runs in `release:gate` over every package skill. A package skill that names an unregistered tool, a retired tool, or has an oversized description or body fails the gate.
- The reference host's full agent set renders a skill catalog within a recorded entry and byte budget. Plan 184's parity fixtures measure that catalog.
- `scripts/skill-evals/` holds a pre-registered paired evaluation per skill. Its owner-gated paid run on the release-acceptance providers (Hyper and OpenCode Go) produces a ship/rewrite/remove verdict per skill, recorded in `docs/_evidence/skill-evals/211/`.
- `skillResources()` in `@arnilo/prism-mcp-server` turns the skills of the served tools into `serveTools` resources.
- `examples/package-skills.ts` shows package skills appearing in `inspect().skills` and disappearing from the catalog under `tools.only`.

**0.13.0 release path — plan 211, step 17g (owner decision 2026-10-31: host adoption ships in 0.13.0).** Start this plan when plan 210 is complete. When it is complete, continue with plan 212, then plan 184. It runs after 210 because the memory skills (Task 6) must describe the memory surface left by 210's audit and removals; writing them earlier would teach tools that 210 may delete. It runs before 184 because package skills add lines to the system catalog, which sits in the cached prefix that 184's parity runner measures. It runs before 185 because Task 2 adds `Skill.requiresTools` to the kernel surface that 185 freezes. Task 1 is the phase review, because Task 2 changes a kernel contract (the `Skill` type, catalog rendering, and `load_skill`). This plan bumps no version and publishes nothing; package skills ship with 0.13.0 through plan 187. Unusually, Task 8 has a paid, owner-gated run: skills change model behavior, and this repo does not ship a behavior claim without paired evidence (plans 197–201).

## Tasks

- [ ] Task 1: Phase review (read-only) — Dropped by plan 215 (2026-11-04): carried into plan 215 Task 5 (one consolidated 0.13.0 release plan; owner decision)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Tool and skill ledger.** For each package that registers a model-visible tool, at its registration site, the tools it registers under its default and its fullest config, any `when` gate, and its current skills. Sites: `packages/tools/web/src/index.ts:381`, `packages/tools/coding/src/index.ts:300`, `packages/tools/browser/src/index.ts:111`, `packages/tools/openapi/src/index.ts:111`, `packages/tools/computer-use/src/index.ts:143`, `packages/tools/work/src/index.ts:269`, `packages/tools/research/src/index.ts:93`, `packages/integrations/delegate/src/index.ts:65`, `packages/integrations/advisor/src/index.ts:84`, `packages/memory/fabric/src/index.ts:504` (`when`), `packages/memory/observational/src/index.ts:98` (`when`), `packages/memory/rag/src/index.ts:134`, `packages/context/engineering/src/index.ts:149`, plus `@arnilo/prism-mcp` (external tools, no fixed names) and `packages/memory/wiki` (as left by plans 207 and 210). For each package, a decision: **skill** (the procedure spans several calls, or needs a judgment that one tool description cannot hold), **description only** (a single-call tool whose description already carries when and how), or **none** (no model-visible tool). Give each "skill" row a proposed name and a one-line description draft.
      - (b) **Failure evidence per module.** For each "skill" row, the agent mistakes the guidance must prevent, each cited from recorded evidence. Sources: plan 189 Task 1 (coding-tool ergonomics), plans 192–193 Task 1 notes (web tools), plan 188.8's post-investigation and plans 202/207/209/210 evidence (agentic recall, rules, lessons), plan 191 (delegation), and the reference host scenarios. A mistake with no evidence is marked `hypothesis` and becomes an eval item in Task 8, not skill text.
      - (c) **The kernel skill contract today.** Catalog cap `DEFAULT_MAX_SKILL_CATALOG_ENTRIES = 64`, description truncation at 512 bytes, default body cap 32 KiB, hard cap 256 KiB (`src/skill-disclosure.ts:7-10`). The catalog is one system message (`src/skill-disclosure.ts:99`), drafted per request from `request` (`src/skills-catalog.ts:24`). `parseSkillFile` reads `name`, `description` and `toolNames` from frontmatter (`src/contribution-parsing.ts:496`); `Skill.toolNames` narrows tools while a skill is active (`src/contracts-core/agent.ts:36,355`); it is not a visibility gate. `load_skill` lives at `src/skill-load.ts:189`. Plan 190 added run-scoped compaction re-attach. Record whether a request-time filter keeps plan 190's re-attach, its "previously loaded" line, and eager disclosure correct.
      - (d) **Agent Skills compatibility.** Using the find-docs skill (record source and date), the current Agent Skills frontmatter rules for `metadata` (string-to-string map) and `allowed-tools`, and whether Claude Code and Codex tolerate unknown `metadata` keys. Confirm that `metadata.prism-requires-tools` keeps each skill valid for those agents, which matters for Task 7.
      - (e) **Catalog measurement.** Catalog entries and bytes, and system-prefix bytes, for each `apps/prism-agent` agent today (`src/host/*.ts`), measured with the mock provider. From this, the Task 3 budgets: the maximum package-skill catalog entries and bytes for the reference host's fullest agent, and the per-skill description and body caps. Proposed starting values: description ≤ 300 bytes, Prism-authored body ≤ 8 KiB, with detail moved to `references/`.
      - (f) **Existing skills audit.** For each of the 11 bundled skills, whether it passes the proposed contract. Known findings to confirm: `wiki-searcher` names `wiki_record_insight` and `vsearch`, both retired by plan 207. The four vendored Hermes skills are 9.6–12.5 KB (over 8 KiB) and are pinned by `packages/tools/work/vendor-lock.json`; decide between a recorded vendored-skill exception and a Prism-side wrapper skill. Check whether their tool vocabulary matches `tools-work`'s registered tools.
      - (g) **Cache.** Package skills register in setup order. Confirm the catalog order is deterministic for a fixed package list, and that a `when` flip changes the catalog only on turns where the tool set changes anyway, so it adds no new prefix break.
      - (h) **Verdict.** The plan holds, or the findings that re-cut it.
    - Performance: n/a (read-only).
    - Code Quality: No code or file changes outside this plan.
    - Security: The review confirms package skill directories are package-owned, not project-scoped, so they bypass project trust correctly (`packages/context/files/src/skills.ts:67`, which applies trust only to `origin === "project"`). It also confirms that skill text is never interpolated from user or tool output.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 11 scope ("Host adoption kit"); `PRODUCT.md` (skills with progressive disclosure)
      - `docs/agent.md:20-60` (skills config and disclosure); `docs/packages.md:108-112` (`skills.list/get/register/addDir`)
      - plan 190 (skills compatibility and load path)
    - Options Considered:
      - Skip the review and write skills directly. Rejected: Task 2 changes a kernel contract (`references/prism.md` §2), and the wiki finding shows that skills already drift from their tools.
    - Chosen Approach:
      - A read-only inventory with measured budgets, so that Tasks 3–6 write against numbers and evidence, not taste.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers addDir --depth all
      timeout 60 graft callers skillMessages --depth all
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - `src/skill-disclosure.ts`, `src/skills-catalog.ts`, `src/skill-load.ts`, `src/contribution-parsing.ts:496`, `packages/memory/wiki/src/skills.ts:131`
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none (read-only task).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Skills are listed only when their tools are available (kernel) — Dropped by plan 215 (2026-11-04): carried into plan 215 Task 6 (one consolidated 0.13.0 release plan; owner decision)
  - Acceptance Criteria:
    - Functional:
      - `Skill` gains `readonly requiresTools?: readonly string[]`. `parseSkillFile` reads it from frontmatter `metadata.prism-requires-tools`, a space-separated string as Agent Skills `allowed-tools` is written. A malformed value (not a string, or a token that is not a valid tool name) makes `parseSkillFile` throw. For a package skill, that fails the package's setup, as any `addDir` read failure does (`docs/packages.md:112`). For a discovered skill, `context-files` skips it with a status note.
      - Per request, a skill with `requiresTools` is rendered (catalog line, or body in eager or loaded mode) only when every name is in that request's advertised tools. The advertised tools are what is left after `disable.tools`, `tools.only` / `selectRunTools` (`src/agent-session/session/assemble.ts:325`), and `when` predicates.
      - `load_skill` on a registered but unavailable skill returns a tool error with code `skill_unavailable` that names the missing tools; the run continues. An unknown name keeps its current error.
      - Compaction re-attach (plan 190) never re-attaches an unavailable skill. The "previously loaded" line still names it, so the model can load it again once the tools come back.
      - `inspect().skills` and `PackageAPI.skills.list()` still list every registered skill and include `requiresTools`, so a host can see why one is hidden.
      - A skill without `requiresTools` behaves exactly as today.
      - Retirement sweep: no name retires. Grep `src/ packages/ apps/ scripts/ examples/ docs/` for hand-written `Skill` literals and parsers that should pass the new field through (`packages/memory/wiki/src/skills.ts:146`, `packages/tools/work/src/skills/load.ts:23`, `packages/tools/computer-use/src/skill.ts:10`, `packages/context/files/src/skills.ts:99`), and update them.
    - Performance: The filter is O(skills × required names) per request over in-memory sets; no I/O. A catalog-rendering micro-test records that the filter adds under 1 ms for 64 skills × 8 names. The catalog of an agent whose skills declare nothing is byte-identical to today's (prefix-stability fixture).
    - Code Quality: The filter sits in the kernel's catalog drafting (`src/skills-catalog.ts`, `src/skill-disclosure.ts`), not in a package. One helper decides availability, and catalog, eager bodies, re-attach and `load_skill` all call it. No alias field; `toolNames` keeps its existing meaning.
    - Security: Hiding a skill grants nothing. `requiresTools` never adds a tool, and `toolNames` narrowing is unchanged. A hidden skill's body is never sent. A `when` predicate that throws hides its tool (fail closed, `src/packages/api.ts:38`) and therefore its skills.
  - Approach:
    - Documentation Reviewed:
      - `src/skill-disclosure.ts:94-118`, `src/skills-catalog.ts:24`, `src/loop/request-draft.ts:6-14`, `src/skill-load.ts:5,189`, `src/agent-run-restore.ts:28-33`
      - `src/packages/api.ts:36-41` (`PackageToolOptions.when`), `docs/agent.md:20-60`
      - Agent Skills frontmatter rules (Task 1 (d))
    - Options Considered:
      - **`PackageAPI.skills.register(skill, { when })`, mirroring tools.** Rejected: it duplicates each tool's predicate in its skill, misses `tools.only` and `disable.tools`, and gives skills discovered from disk (with no code) nothing to declare.
      - **A `context.build` transform in each package that strips its own catalog lines.** Rejected: every package would re-parse a kernel-rendered message, and `load_skill` would still serve the body.
      - **Derive availability from the existing `toolNames`.** Rejected: `toolNames` narrows the active tool set, and other agents' `allowed-tools` means "may use", not "requires". Overloading it would hide skills that today list correctly.
      - **Top-level frontmatter key `requires-tools`.** Rejected: it is outside the Agent Skills schema, so validators may reject it. `metadata` is the spec's extension point.
    - Chosen Approach:
      - A declared, data-only requirement checked at render time against the request's tool list, which is already final when the catalog is drafted. Kernel placement proof: no hook, slot, `PackageAPI` member or primitive covers it (see options), and at least five packages need it (web, fabric, observational, delegate, browser; Task 1 (a)).
    - API Notes and Examples:
      ```markdown
      ---
      name: web-research
      description: Use when a task needs current facts from the web — search, read a page, extract a value.
      metadata:
        prism-requires-tools: web_search web_fetch
      ---
      ```
      ```ts
      interface Skill { /* … */ readonly requiresTools?: readonly string[] }
      // load_skill("web-research") with web tools narrowed away:
      // tool error { code: "skill_unavailable", missing: ["web_search", "web_fetch"] }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts` (+ `.d.ts`): `Skill.requiresTools`
      - `src/contribution-parsing.ts`: parse `metadata.prism-requires-tools`
      - `src/skill-disclosure.ts`, `src/skills-catalog.ts`: availability helper; filter catalog and bodies
      - `src/skill-load.ts`: `skill_unavailable`
      - `src/agent-run-restore.ts` and the compaction re-attach site plan 190 added (tentative: Task 1 (c) names it)
      - `packages/memory/wiki/src/skills.ts`, `packages/tools/work/src/skills/load.ts`, `packages/tools/computer-use/src/skill.ts`, `packages/context/files/src/skills.ts`: pass the field through where they build `Skill` by hand
      - `src/__tests__/skill-availability.test.ts` (new)
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`; the task note records the diff (one added interface member, attributed to plan 211)
      - `docs/agent.md`, `docs/tools.md`, `CHANGELOG.md`
    - References:
      - plan 190 Tasks 3–4 (load path, catalog block)
  - Test Cases to Write:
    - `skill_hidden_when_required_tool_absent`: the catalog omits the skill under `tools.only` without its tool. Fails if the filter is skipped.
    - `skill_hidden_when_tool_when_false`: a package tool gated by `when` hides its skill on that turn only.
    - `skill_hidden_when_tool_disabled`: `disable.tools` hides the skill.
    - `load_skill_unavailable_is_tool_error`: returns `skill_unavailable` naming the missing tools; the run completes. Fails if it throws or if it returns the body.
    - `eager_body_not_sent_when_unavailable`: eager mode omits the body.
    - `reattach_skips_unavailable_skill`: after compaction, an unavailable skill is named, not re-sent.
    - `skill_without_requirement_unchanged`: catalog bytes equal a golden from before this change.
    - `requires_tools_malformed_fails_package_setup` and `requires_tools_malformed_discovered_skill_skipped_with_note`.
    - `skill_availability_default_and_custom_loop`: the behavior holds under the default loop and under `loopConformance` with a custom loop (`references/prism.md` §3 probe 2).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new `Skill` field, a frontmatter key, catalog behavior, and a `load_skill` error.
    - Docs pages to create/edit:
      - `docs/agent.md`: skills section — `requiresTools`, availability rules, `skill_unavailable`
      - `docs/tools.md`: how `when`, `tools.only` and `disable.tools` affect skills
      - `CHANGELOG.md`: `## [Unreleased]` entry
    - `docs/index.md` update: no (edits inside indexed pages).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The package skill contract and its gate — Dropped by plan 215 (2026-11-04): carried into plan 215 Task 7 (one consolidated 0.13.0 release plan; owner decision)
  - Acceptance Criteria:
    - Functional:
      - `docs/packages.md` gains "Writing a package skill". It covers:
        - when a package ships a skill versus relying on tool descriptions (Task 1 (a) rule)
        - naming (the package domain first, e.g. `web-research`, `coding-workflow`)
        - the description shape: when to use it, then what it covers, in at most the Task 1 (e) cap
        - the body shape: a short procedure, decision points, failure recovery, and stop conditions, with details in `references/`
        - `requiresTools`
        - optional tools: any tool not in `requiresTools` may appear only under a heading of the form `If \`<tool>\` is available`
        - no secrets, URLs to private systems, or host product opinions
      - `scripts/package-skills-conformance.mjs` plus `src/__tests__/package-skills.test.ts` (`package_skills_conform`) loads every workspace package that ships skills, runs its setup on the mock provider under its fullest test config, and checks every skill. Checks:
        - (1) it parses
        - (2) description and body are within caps
        - (3) every `requiresTools` name is registered by that package, or by a package it declares in `requires`
        - (4) every backticked token in the body that is a tool name known to any workspace package, or listed in `scripts/retired-tool-names.json` (new in this task; there is no retired tool-name inventory today, so seed it from the removals of plan 189 Task 8 — `repo_list`, `repo_search`, `git_branch`, `git_apply`, `git_worktree` — plan 207 — `wiki_record_insight` — and plan 210 Task 7; plan 187's sweep reads it too), is registered by this package or by a declared dependency, and appears under an "If … is available" heading when it is not required
        - (5) the package's `package.json` `files` includes the skill directory
        - (6) no two packages ship the same skill name
      - The test also asserts the reference host catalog budget from Task 1 (e): for each `apps/prism-agent` agent, package-skill catalog entries and bytes are within the recorded maximum. It is wired into `release:gate` (`docs/release.md`, "What the gate runs").
      - Today's 11 skills are brought into conformance in this task, per Task 1 (f):
        - research and computer-use: description and `requiresTools` edits
        - work: the Hermes exception or wrapper decided in Task 1 (f); the vendored bytes stay pinned to `vendor-lock.json`
        - wiki: removed or rewritten to the plan 207/210 surface; if plan 210 removed the wiki's model-visible tools, both wiki skills are deleted and `loadBundledSkills`' fallbacks with them, with a repo-wide grep for `wikiSearcherSkill`, `wikiMaintainerSkill`, `wiki-searcher`, `wiki-maintainer`
    - Performance: The gate runs in under 30 s locally (it builds each package agent once on the mock provider). The test records the timing.
    - Code Quality: One script, reused by the test and by `release:gate`. Budgets live in `scripts/budgets.json` next to the tarball budgets, with a dated `$comment`.
    - Security: The gate fails closed: a package that ships `skills/` but whose skills fail to load fails the gate rather than being skipped. Skill bodies are scanned for `env:`/`keyring:` literals and for strings that `redactSecrets` would mask; any hit fails.
  - Approach:
    - Documentation Reviewed:
      - `docs/packages.md:108-112`; `docs/release.md` ("What the gate runs"); `scripts/budgets.json`
      - `packages/tools/research/src/index.ts:137`, `packages/tools/work/src/index.ts:271`, `packages/tools/computer-use/src/index.ts:144`
    - Options Considered:
      - **Review skills by hand at release.** Rejected: the wiki drift happened under exactly that regime.
      - **A strict whole-word tool-name scan of every backticked token.** Rejected: office skills legitimately backtick argument names (`bold`, `color`). Matching only against the known-tool-name universe plus retired names catches drift without false positives.
    - Chosen Approach:
      - A data-driven gate that loads the real packages, so "registered tools" means what the agent actually gets, not a hand-kept list.
    - API Notes and Examples:
      ```bash
      timeout 120 bun scripts/package-skills-conformance.mjs --json
      ```
    - Files to Create/Edit:
      - `scripts/package-skills-conformance.mjs` (new), `src/__tests__/package-skills.test.ts` (new)
      - `scripts/retired-tool-names.json` (new)
      - `scripts/budgets.json`: `packageSkills` entry
      - `scripts/release.mjs` (tentative: or the gate's stage list file Task 1 identifies): add the stage
      - `docs/packages.md`, `docs/release.md`
      - `packages/tools/research/skills/*/SKILL.md`, `packages/tools/computer-use/skills/computer-use-linux/SKILL.md`, `packages/memory/wiki/skills/**` and `packages/memory/wiki/src/skills.ts`, `packages/tools/work/src/skills/*` (per Task 1 (f))
      - each touched package's `README.md` ("What it changes": skills) and `CHANGELOG.md`
    - References:
      - `packages/memory/wiki/skills/wiki-searcher/SKILL.md:7,34` (drift example)
  - Test Cases to Write:
    - `package_skills_conform`: passes on the tree. Fixture variants make it fail on a skill naming an unregistered tool, a retired tool (`wiki_record_insight`), an over-cap description, a missing `files` entry, or a duplicate name.
    - `optional_tool_outside_conditional_heading_fails`.
    - `reference_host_skill_catalog_within_budget`: fails when one extra 300-byte skill pushes an agent over budget.
    - `skill_body_contains_no_secret_ref`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new authoring contract and gate, and the existing package skills change.
    - Docs pages to create/edit:
      - `docs/packages.md`: "Writing a package skill"
      - `docs/release.md`: the new gate stage
      - READMEs of research, computer-use, work and wiki: skills listed in "What it changes"
      - `CHANGELOG.md`
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Tool package skills — web, coding, browser, OpenAPI, office — Dropped by plan 215 (2026-11-04): carried into plan 215 Task 8 (one consolidated 0.13.0 release plan; owner decision)
  - Acceptance Criteria:
    - Functional:
      - Each package the Task 1 ledger marks "skill" ships its skills under `skills/<name>/SKILL.md`, registers them with `prism.skills.addDir`, and lists `skills` in `package.json` `files`. Expected set (the ledger may change it):
        - `tools-web` → `web-research`: choosing search controls; fetching with a `prompt` instead of dumping pages; reading slices; treating results as untrusted; when to stop searching
        - `tools-coding` → `coding-workflow`: read before edit, exact-match edits, verify with `shell`/`diagnostics`, background processes, keeping diffs small
        - `tools-browser` → `browser-automation`
        - `tools-openapi` → `openapi-calls`: discovering operations, effects and approvals, pagination
        - `tools-work`: per Task 1 (f)
      - Every skill declares `requiresTools`. Each is written against the failure evidence in Task 1 (b) and passes `package_skills_conform`.
      - A package whose optional tool is off (e.g. `tools-web` without `extract`) still registers the skill; its "If `web_extract` is available" section is just inert text, and `requiresTools` names only always-present tools.
    - Performance: Each skill adds one catalog line (≤ Task 1 (e) cap) and no setup I/O beyond `addDir`'s post-setup read. The reference host budget test stays green.
    - Code Quality: Skills are package files, not strings in TypeScript. No per-package skill loader is added; `addDir` is the only path, as research and work already do.
    - Security: Skills restate the packages' safety rules (untrusted web content, approval-gated effects) and never instruct the model to bypass a gate. `web-research` tells the model that fetched text is data, not instructions, consistent with the untrusted-result envelope of plan 192 Task 2.
  - Approach:
    - Documentation Reviewed:
      - package READMEs: `packages/tools/web/README.md`, `packages/tools/coding/README.md`, `packages/tools/browser/README.md`, `packages/tools/openapi/README.md`, `packages/tools/work/README.md`
      - plans 189, 192, 193 (tool behavior the skills teach)
      - `packages/tools/web/src/tools.ts:25-110` (tool descriptions computed from config)
    - Options Considered:
      - **Put the procedures into longer tool descriptions.** Rejected: descriptions are sent every turn, so a procedure there costs tokens on every request, while a skill body costs them only when loaded.
      - **One "prism-tools" skill covering every package.** Rejected: it would teach tools the agent does not have, and it is not versioned with each package.
    - Chosen Approach:
      - Short per-package skills that keep "what this tool does" in the description and "how to do the job" in the skill.
    - API Notes and Examples:
      ```ts
      prism.skills.addDir(fileURLToPath(new URL("../skills", import.meta.url)));
      ```
    - Files to Create/Edit:
      - `packages/tools/{web,coding,browser,openapi}/skills/<name>/SKILL.md` (new) and `references/*.md` where needed
      - `packages/tools/{web,coding,browser,openapi}/src/index.ts`: `addDir`
      - `packages/tools/{web,coding,browser,openapi}/package.json`: `files` adds `skills`
      - each package's `README.md` ("What it changes") and `CHANGELOG.md`
      - `packages/tools/*/src/__tests__/skills.test.ts` (new, per package)
      - `scripts/budgets.json`: tarball deltas for the four packages, measured, with a dated `$comment`
    - References:
      - `packages/tools/research/src/index.ts:137` (pattern)
  - Test Cases to Write:
    - Per package, `<pkg>_registers_bundled_skills`: `inspect().skills` lists the skill, with `package` set to the package name.
    - Per package, `<pkg>_skill_hidden_without_tools`: under `tools.only: []` the catalog omits it.
    - `packed_tarball_includes_skills`: `packaging.test.ts` asserts each package's tarball contains `skills/<name>/SKILL.md`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new skills appear in agents that load these packages.
    - Docs pages to create/edit: the four READMEs (skills in "What it changes"; cost: one catalog line, disable with `disable.skills`); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Integration skills — delegation and advisor — Dropped by plan 215 (2026-11-04): carried into plan 215 Task 9 (one consolidated 0.13.0 release plan; owner decision)
  - Acceptance Criteria:
    - Functional:
      - `delegate` ships `delegation`: when to delegate versus doing the work, writing a self-contained brief, forwarding context (plan 191), reading child results, and avoiding fan-out loops. It is registered with `addDir` and declares `requiresTools` with the delegate tool names.
      - `advisor` ships `ask-advisor` only if Task 1 (a) marked it "skill"; otherwise the ledger's "description only" decision is recorded in the advisor README.
      - `context-engineering`'s `search_tools` and the kernel's own tools get no package skill. The ledger records the reason.
    - Performance: As Task 4.
    - Code Quality: As Task 4.
    - Security: `delegation` states that a child inherits only what the brief and forwarded context carry, and never instructs the model to forward secrets or credentials.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/README.md`, `packages/integrations/advisor/README.md`
      - plan 191 (delegation for coding workflows), advisor package notes in the release-decisions record
    - Options Considered:
      - **A workflows skill.** Rejected: `prism-workflows` registers host commands, not model-visible tools (`apps/prism-agent/README.md`, orchestrator), so the model has nothing to be taught.
    - Chosen Approach:
      - Ship skills only where the model makes a judgment call.
    - API Notes and Examples:
      ```bash
      timeout 120 bun run --filter @arnilo/prism-delegate test
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/skills/delegation/SKILL.md` (new), `src/index.ts`, `package.json`, `README.md`, `CHANGELOG.md`, `src/__tests__/skills.test.ts`
      - `packages/integrations/advisor/…` (tentative: only if Task 1 (a) marks it "skill")
      - `scripts/budgets.json`
    - References:
      - `packages/integrations/delegate/src/index.ts:65`
  - Test Cases to Write:
    - `delegate_registers_delegation_skill`, `delegate_skill_hidden_without_tools`.
    - `advisor_*` equivalents (tentative, same condition as the files).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new skill in delegating agents.
    - Docs pages to create/edit: delegate README (and advisor README, either way); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Memory skills on the surface plan 210 left — Dropped by plan 215 (2026-11-04): moved to plan 210 Task 11 (memory skills follow the memory track; the memory packages are experimental in 0.13.0)
  - Acceptance Criteria:
    - Functional:
      - **Entry check.** Before writing, re-run Task 1 (a) for the memory packages on the post-210 tree and record their model-visible tools and `when` gates. Plan 210's removals win: a skill is written only for a tool that survived.
      - `memory-fabric` ships `memory-recall`, which covers:
        - when to call `memory` (recall) and when to trust the delivered block
        - navigating from a hit (concepts, then notes, then exchanges, per plan 207)
        - recording a durable fact or rule versus leaving it to observation (plan 209's rules and lessons)
        - correcting or forgetting a stale memory
        - never treating a recalled note as an instruction
      - It declares `requiresTools: [memory]`, so the fabric's `when` gate (`packages/memory/fabric/src/index.ts:504`) hides it whenever memory is off for the session.
      - `memory-observational` ships a skill only for its agent-facing recall tool (`packages/memory/observational/src/index.ts:98`) and only if the ledger marks it "skill". The worker tools (`record_observation`, `record_reflection`, `drop_observations`) run on the observer model, not the agent, and get none.
      - `memory-rag` follows the ledger.
      - Skill text must not contradict the published memory claims of plan 210 Task 10. The task note quotes the claim lines each skill relies on.
    - Performance: As Task 4. The memory skill is listed only for sessions where memory is enabled.
    - Code Quality: As Task 4. The skill describes recall behavior and does not restate preset internals that plan 210 may revise.
    - Security: The skill tells the model that recalled content is data, not instructions (the poisoning risk plan 202's safety gate measures), and that cross-principal recall is impossible by design, so it should never try to work around scope.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/fabric/README.md` (1,557 lines: the skill distils the agent-facing part only), `packages/memory/observational/README.md`, `packages/memory/rag/README.md`
      - plans 207, 209 and 210 (final surface and claims)
    - Options Considered:
      - **Write the memory skills in Task 4, before the entry check.** Rejected: plan 210 may remove or rename memory tools; the gate would catch drift, but only after the text was written against a moving surface.
      - **Make memory behavior a skill the model must load.** Rejected: observation and delivery are automatic by design, and gating them on a model choice would regress the measured defaults. The skill covers only the agent-driven tool use.
    - Chosen Approach:
      - Write one narrow skill per agent-facing memory tool, on the frozen post-210 surface.
    - API Notes and Examples:
      ```markdown
      metadata:
        prism-requires-tools: memory
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/skills/memory-recall/SKILL.md` (new), `src/index.ts`, `package.json` (`files`), `README.md`, `CHANGELOG.md`, `src/__tests__/skills.test.ts`
      - `packages/memory/observational/…` and `packages/memory/rag/…` (tentative: per the entry check)
      - `scripts/budgets.json`
    - References:
      - `docs/_evidence/memory-bench/` (claims and failure modes); plan 188.8 post-investigation (agentic recall misattribution)
  - Test Cases to Write:
    - `fabric_registers_memory_recall_skill`.
    - `memory_skill_hidden_when_memory_disabled_for_session`: the `when` gate is false, so the catalog omits it.
    - `memory_skill_names_only_surviving_tools`: covered by `package_skills_conform`, with a fixture naming a 210-removed tool failing.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — memory-enabled agents gain a skill.
    - Docs pages to create/edit: the fabric README (and OM/RAG READMEs if they gain skills); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Skills reach vendor agents through `serveTools` — Dropped by plan 215 (2026-11-04): carried into plan 215 Task 10 (one consolidated 0.13.0 release plan; owner decision)
  - Acceptance Criteria:
    - Functional:
      - `@arnilo/prism-mcp-server` exports `skillResources(skills, servedToolNames)`. It returns one `serveTools` resource (`{ uri: "prism-skill://<name>", name, mimeType: "text/markdown", text }`) per skill whose `requiresTools` is non-empty and a subset of the served tools. The text is the skill's `SKILL.md` content (frontmatter included), so a vendor agent reads standard Agent Skills markdown.
      - Skills with no `requiresTools` are not served: their applicability to the lent tools is unknown.
      - A skill over `serveTools`' 256 KiB resource bound is skipped and reported in a returned `skipped` list, never truncated.
      - `examples/build-workflow.ts`, or the external-worker path of the reference host (`apps/prism-agent/src/host/external.ts`), passes `skillResources(...)` to `serveTools` (the review chooses one, as the documented pattern).
    - Performance: The skills are already in memory and the function is pure. Resources are listed once per served endpoint.
    - Code Quality: A helper next to `serveTools` (`packages/hosts/mcp-server/src/serve-tools.ts:76`) that uses the existing `resources` option (`serve-tools.ts:87`). No new transport or option.
    - Security: Only skills tied to lent tools leave the process, so a host never leaks guidance for tools it did not lend. The helper is a deterministic transform; it sends nothing on its own.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/mcp-server/README.md` ("Serving tools and permissions to an external agent"), `serve-tools.ts:76-140`
      - `docs/agent-adapters.md`
    - Options Considered:
      - **MCP prompts instead of resources.** Rejected: `serveTools` already supports bounded resources, and vendor agents surface resources as readable context. Prompts would add a second channel.
      - **Have the driver write skills into the vendor's skill directory.** Rejected: it writes into a vendor profile home that Phase 15's strict isolation deliberately keeps empty (roadmap Phase 15, "a hook, skill, or MCP server planted in a fake user home is not loaded").
    - Chosen Approach:
      - Reuse the bounded resource channel.
    - API Notes and Examples:
      ```ts
      const served = await serveTools(run, {
        broker, tools: definitions, allow, transport: "loopback-http", origin,
        resources: skillResources(agent.skills, allow).resources,
      });
      ```
    - Files to Create/Edit:
      - `packages/hosts/mcp-server/src/skill-resources.ts` (new), `src/index.ts`, `README.md`, `CHANGELOG.md`, `src/__tests__/skill-resources.test.ts`
      - `scripts/compat-baseline/arnilo__prism-mcp-server.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`; diff in the note (one added export)
      - `examples/build-workflow.ts` or `apps/prism-agent/src/host/external.ts` (tentative, per the review)
    - References:
      - `docs/agent-adapters.md`; roadmap §2.12.12
  - Test Cases to Write:
    - `skill_resources_only_for_served_tools`.
    - `skill_resources_skip_unscoped_skills`.
    - `skill_resources_skip_oversized_and_report`.
    - `served_skill_readable_over_mcp`: an in-process MCP client lists and reads the resource from a `serveTools` endpoint.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new export.
    - Docs pages to create/edit: `packages/hosts/mcp-server/README.md` (a "Lending skills with tools" subsection); `docs/agent-adapters.md` (one paragraph pointing to it); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Paired skill evaluations and the ship rule (owner gate, paid) — Dropped by plan 215 (2026-11-04): carried into plan 215 Task 11 (one consolidated 0.13.0 release plan; owner decision)
  - Acceptance Criteria:
    - Functional:
      - `scripts/skill-evals/criteria.json` is written and committed before any paid run (pre-registration).
        - It defines per skill: a dataset of 8–12 trigger items (the skill should help) and 3–4 non-trigger items (it should not load).
        - Scorers:
          - `task_success`: state grading, or a calibrated rubric judge from plan 199 where state cannot be checked
          - `skill_triggered`: from the timeline; `load_skill` was called on trigger items and not on non-trigger items
          - `tool_misuse`: count of failed or rejected tool calls
        - Arms: `skill` versus `no-skill` (`disable.skills: [name]`), with an identical package set.
        - Ship rule:
          - **ship** when `compareExperiments` shows no significant regression on `task_success` (`maximumRegression`, delta 0, alpha .05) and trigger precision and recall are each ≥ 0.7
          - **rewrite once** otherwise, and re-measure on fresh trials
          - **remove** if the rewrite also fails
      - `scripts/skill-evals/run.mjs` runs the suite with `runExperiment` and `compareExperiments` from `@arnilo/prism-evals`, records `skillsRevision` (`packages/hosts/evals/src/types.ts:594`) and cost, and writes `docs/_evidence/skill-evals/211/<skill>.json` and `.md`.
      - An offline mode runs every item on the scripted provider. It checks the datasets, the arms and the scorer wiring, not model behavior, and runs in CI.
      - **Owner gate:** the paid run uses the release-acceptance providers, Hyper and OpenCode Go, never `openrouter/free` (owner decision 2026-10-24). Before it runs, the task note records the estimated cost from a five-item dry run; the owner approves it. Trials per item are set in `criteria.json` (proposed: 3).
      - Every verdict is applied in this task. A removed skill is deleted, with a grep sweep for its name, and the package README says why. Each kept skill's README line links its evidence file.
    - Performance: The offline suite runs in under 60 s. The paid run's cost and latency are reported per skill, cache-adjusted as in plan 202.
    - Code Quality: Reuse `@arnilo/prism-evals` (`runExperiment`, `compareExperiments`, `assertEvaluationThreshold`); no new statistics code. Datasets live in `scripts/skill-evals/datasets/`, not in package tarballs.
    - Security: Keys come from `scripts/live.env` refs only. Evidence files pass `redactSecrets` and a no-secret assertion. Any web-tool items run against a local fixture server, never the live web, so results are reproducible.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/evals/README.md` ("Experiments", "Comparing two runs", "Gating a release", "Judges")
      - plans 198–200 (statistics, judges, scenario items); `scripts/live.env.example`
    - Options Considered:
      - **Ship skills on review alone.** Rejected: a skill changes behavior, and the repo's rule is that claims stand only on measured evidence (plans 202 and 210).
      - **A single pooled eval across all skills.** Rejected: one harmful skill would hide inside an average. The ship rule is per skill.
      - **Measure on `openrouter/free`.** Rejected by the owner (2026-10-24).
    - Chosen Approach:
      - Pre-registered per-skill paired comparisons with the existing statistics, plus the 210-style "justify or remove" rule.
    - API Notes and Examples:
      ```bash
      timeout 300 bun scripts/skill-evals/run.mjs --offline
      timeout 3600 bun scripts/skill-evals/run.mjs --live --providers hyper,opencode-go --skill web-research
      ```
    - Files to Create/Edit:
      - `scripts/skill-evals/{criteria.json,run.mjs,run.test.mjs}` (new), `scripts/skill-evals/datasets/*.ts` (new)
      - `docs/_evidence/skill-evals/211/*` (new, evidence)
      - package READMEs (evidence links), `CHANGELOG.md`
      - `docs/live-testing.md`: the skill-eval row and its credential scope
      - `scripts/live-matrix.json` (tentative: if the live matrix is the registration point Task 1 finds)
    - References:
      - `packages/hosts/evals/src/types.ts:594`; plan 210 Task 4 (pre-registered decision rules pattern)
  - Test Cases to Write:
    - `skill_eval_criteria_preregistered`: `criteria.json` hash recorded before the first live evidence file's timestamp.
    - `skill_eval_offline_runs_every_dataset`.
    - `skill_eval_arms_differ_only_by_skill`: the arms' package lists and configs are identical except for `disable.skills`.
    - `skill_eval_evidence_contains_no_secret`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — skills may be rewritten or removed by verdict.
    - Docs pages to create/edit: `docs/live-testing.md`; package READMEs (evidence links); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Example, reference host, and hand-off to plan 184 — Dropped by plan 215 (2026-11-04): carried into plan 215 Task 12 (one consolidated 0.13.0 release plan; owner decision)
  - Acceptance Criteria:
    - Functional:
      - `examples/package-skills.ts` runs on the mock provider. It builds an agent with `tools-web` and `tools-coding`, prints `inspect().skills` (showing `package` and `requiresTools`), runs one turn with `tools.only: ["read"]`, and shows `web-research` absent from the catalog and `load_skill("web-research")` returning `skill_unavailable`.
      - The reference host's scenarios stay green with the new catalog. Golden or snapshot fixtures that include the system prefix are regenerated in this task, with the diff attributed in the note.
      - Plan 184's parity fixture set includes at least one agent with package skills (the note names it), so the parity gate measures the shipped catalog.
      - `templates/README.md` gains a "Host skills" note: a host writes its own product rules as `skills.dirs` entries, and package skills cover module usage.
    - Performance: The reference host's per-agent catalog stays within the Task 3 budget (asserted by that test).
    - Code Quality: The example uses only the public surface, and the reference host stays inside its allowlist (`reference_host_imports_only_public_surface`).
    - Security: The example prints no secret (`examples_demos_run_to_completion_and_emit_no_secret`).
  - Approach:
    - Documentation Reviewed:
      - `examples/README.md`, `scripts/e2e-coverage.json`, `apps/prism-agent/README.md`, plan 184 Task 2 (prefix-stability fixture)
    - Options Considered:
      - **Fold the example into `examples/skills.ts`.** Rejected: that example covers host skills; package skills and availability are a separate lesson.
    - Chosen Approach:
      - One focused example, and a fixture hand-off so the cache gate covers the change.
    - API Notes and Examples:
      ```bash
      timeout 120 bun examples/package-skills.ts
      ```
    - Files to Create/Edit:
      - `examples/package-skills.ts` (new), `examples/README.md`, `scripts/e2e-coverage.json`
      - `apps/prism-agent/src/__tests__/*` fixtures (tentative: only those that snapshot the prefix)
      - `plans/184-Phase-11-Part-K-Prompt-Cache-Parity-With-Pi.md`: an amendment line naming the fixture agent with package skills
      - `templates/README.md`, `CHANGELOG.md`
    - References:
      - `examples/skills.ts`, `examples/skills-progressive-disclosure.ts`
  - Test Cases to Write:
    - The example runs under the execution gate.
    - `bun run --filter @arnilo/prism-agent test` passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; it documents Tasks 2–8.
    - Docs pages to create/edit: `examples/README.md` (one line); `templates/README.md`; `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 300 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun test --timeout=0 src/__tests__/skill-availability.test.ts src/__tests__/package-skills.test.ts src/__tests__/docs.test.ts src/__tests__/packaging.test.ts`
- `timeout 600 bun run --filter '@arnilo/prism-tools-*' test`
- `timeout 600 bun run --filter @arnilo/prism-delegate --filter @arnilo/prism-mcp-server --filter '@arnilo/prism-memory-*' test`
- `timeout 600 bun run --filter @arnilo/prism-agent test`
- `timeout 300 bun scripts/package-skills-conformance.mjs --json`
- `timeout 300 bun scripts/skill-evals/run.mjs --offline`
- `timeout 120 bun examples/package-skills.ts`
- `timeout 1800 bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
