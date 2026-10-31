# Phase 11 Part AF — host builder kit: a skill and an MCP server for agents that build hosts

## Objectives

- Make it easy for a coding agent (Claude Code, Codex, Cursor, or a Prism agent) to build or change a Prism host correctly, against the Prism version the project actually has installed.
- Ship a `prism-host-builder` skill: Prism's host-building judgment in Agent Skills format, readable by every major coding agent. It covers choosing packages and host libraries, where code belongs, recipes that point to CI-tested examples, pitfalls and error codes, security, verification, and upgrades.
- Ship a read-only, network-free, model-free stdio MCP server for what static docs cannot do:
  - exact API lookup for the installed version
  - error-code explanation
  - example search
  - version-exact docs
  - checks on the host's own code: build the agent and return `inspect()`, verify the manifest, run package conformance
- Ship an installer that puts the skill and the MCP server entry into the agent's own project configuration.
- Keep all of it from drifting: every symbol, path, example and error code the kit names is checked against the tree in `release:gate`.
- Measure whether the kit helps a builder agent, and publish only the claims that pass.

## Expected Outcome

- `@arnilo/prism-host-builder` (`packages/hosts/host-builder`) is published in lockstep with the kernel. It contains:
  - `skills/prism-host-builder/` (`SKILL.md` + `references/`)
  - generated `data/` indexes (API, error codes, examples)
  - a `prism-host-builder` bin with `mcp` and `install` subcommands
- `bunx prism-host-builder mcp` serves these tools over stdio:
  - `prism_api`
  - `prism_errors`
  - `prism_examples`
  - `prism_docs`
  - `prism_inspect_host`
  - `prism_check_manifest`
  - `prism_check_package`

  It also serves the docs as `prism-docs://` resources and three prompts (`build-host`, `add-capability`, `upgrade-host`). A mismatch between the installed `@arnilo/prism` version and the index version fails closed, naming both versions.
- `bunx prism-host-builder install --target claude|codex|cursor|agents [--mcp]` copies the skill and, where the target has a project-level JSON config, adds the MCP entry without touching other entries. It never overwrites a different file without `--force`.
- `host_builder_kit_matches_surface` runs in `release:gate`. It typechecks every TypeScript block in the skill, resolves every `node_modules/@arnilo/...` path against packed tarball contents, checks that every example path is in the example execution gate, and that every error code exists. A rename that plan 185 or any later plan makes therefore fails the gate until the kit is updated in that same task.
- `examples/host-builder-agent.ts` shows a Prism agent using the kit: the skill discovered by `context-files`, and the server connected through `@arnilo/prism-mcp`.
- The builder evaluation on fixture workspaces (arms: no kit, skill only, skill + MCP) is recorded in `docs/_evidence/host-builder/212/`, and the README's claims are limited to the criteria that passed.

**0.13.0 release path — plan 212, step 17h (owner decision 2026-10-31: host adoption ships in 0.13.0).** Start this plan when plan 211 is complete; when it is complete, continue with plan 184. It runs after 211 because the skill tells builders how package skills and `requiresTools` work (211 Task 2), and its examples index includes `examples/package-skills.ts`. It runs before 185 so the new package is in the tree at freeze time and is frozen with the rest, which follows the precedent of plan 205's amendment to 185. The drift gate means plan 185's surface reduction and shape retirements (Tasks 2–3) must update the kit in the same task; Task 2 records that amendment in plan 185. Task 1 is the phase review, because this plan creates a package. It bumps no version and publishes nothing (plan 187 publishes). Unusually, Task 5 executes host code (the user's agent factory), and Task 8 has a paid, owner-gated run.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Placement.** Why this is a host library under `packages/hosts/`. Precedent: `@arnilo/prism-devtools`, a developer tool over the public `Agent` surface with a bin (`packages/hosts/devtools/package.json`). Why it is not kernel: the kernel has zero runtime dependencies, and MCP needs `@modelcontextprotocol/server`. Why it is not a package: it adds nothing to an agent. Also check the roadmap's §2 host-library lists (`roadmap.md:109`, `:634`) and record whether they need the new row (the Phase 11 bullet is added by this plan; a §2 table row is added in Task 2 if the review says so).
      - (b) **Sources of truth** the generators read, at `file:line`:
        - the compat-baseline generator behind `bun scripts/release.mjs gate --update-baseline`; Task 2 reuses its in-memory export model, not the `.txt` text, so plan 185's shape-format change does not break the index
        - `scripts/compat-baseline/` (101 files)
        - error codes: 370 distinct `ERR_PRISM_*` literals today, plus the kernel's short codes such as `skill_conflict`, `state_not_ready`, `ManifestErrorCode`, and plan 211's `skill_unavailable`. Record where each family is declared and decide the index's code universe.
        - `examples/` (876 KB; about 110 files), `scripts/e2e-coverage.json` and the example execution gate
        - `docs/` as shipped in the kernel tarball (`package.json` `files`), and each package README
      - (c) **Builder failure evidence.** What agents and new hosts get wrong, cited from:
        - the reference host's build (plans 172–173, including their empty gap logs and the workaround grep)
        - `docs/migrate-to-0.13.md` (retired names agents trained on 0.12 will reach for)
        - `docs/host-security.md`
        - the backlog's host-facing entries
        - the slot-conflict rule (`apps/prism-agent/README.md`, "Both memory packages claim the `compaction` slot")

        Each becomes a skill section or a Task 8 item.
      - (d) **Coding-agent conventions**, via the find-docs skill, with sources and dates. For Claude Code, Codex, Cursor and Prism (`contextFiles`, plan 190 Task 5): the project-level skill directory and the project-level MCP configuration file, format and key (for example `.mcp.json` `mcpServers`). For each target, whether the installer may write the config (JSON it can merge losslessly) or must print a snippet (TOML or anything else, since the package takes no TOML dependency).
      - (e) **MCP serving.** `servePrismMcpStdio(server | factory)` (`packages/hosts/mcp-server/src/server.ts:205`) on `@modelcontextprotocol/server` 2.0.0 (`packages/hosts/mcp-server/package.json:22`) is reusable for a non-agent server. Record the tool, resource and prompt registration API of that SDK version via find-docs.
      - (f) **Checking host code.** What `createAgent` does at build time that could touch the network or secrets: provider discovery, credential resolution, MCP client spawn. From that, the child-process runner's environment allowlist, timeout and output caps for Task 5. Also how `packageConformance` (`src/testing/index.ts`) and the manifest `verify` (`src/manifest/index.ts`, used by `prism verify`) are invoked programmatically.
      - (g) **Tarball size.** The packed size of `data/` (indexes plus example sources, excluding `examples/fixtures`, `examples/example-workspace` and `examples/instruction-injection-workspace` unless an indexed example needs them) and the `scripts/budgets.json` entry it needs.
      - (h) **Verdict.**
    - Performance: n/a (read-only).
    - Code Quality: No code or file changes outside this plan.
    - Security: The review names every trust boundary the package crosses:
      - executing host code (Task 5)
      - writing agent config files (Task 6)
      - reading project files (the docs resources read only from the installed `node_modules/@arnilo/*`)
      - the stdio channel (local only, no listener)
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 11 ("Host adoption kit"), §2.13 (host layout); `PRODUCT.md`
      - `apps/prism-agent/README.md`, `docs/index.md`, `docs/host.md`, `docs/packages.md`, `docs/testing.md`, `docs/release.md`
      - `packages/hosts/mcp-server/README.md`, `packages/hosts/devtools/README.md`
    - Options Considered:
      - Start building without a review. Rejected: a new package requires one (`references/prism.md` §2), and the installer depends on facts about third-party tools that must be verified and dated.
    - Chosen Approach:
      - A read-only inventory that fixes the generators' inputs, the code universe and the targets.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers servePrismMcpStdio --depth all
      timeout 60 rg -o '"ERR_PRISM_[A-Z0-9_]+"' src packages --glob '!**/node_modules/**' --glob '!**/__tests__/**' | sort -u | wc -l
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - plan 190 (skill directories), plan 205's amendment to plan 185 (in-tree packages join the freeze)
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none (read-only task).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: The package and its generated reference indexes
  - Acceptance Criteria:
    - Functional:
      - `packages/hosts/host-builder/` is created with:
        - `package.json`: `@arnilo/prism-host-builder` 0.13.0; `exports: { ".": "./src/index.ts" }`; `bin: { "prism-host-builder": "./bin/prism-host-builder.ts" }`; `files` with `src`, `bin`, `data`, `skills`, `README.md`, `CHANGELOG.md`, `LICENSE`; peer `@arnilo/prism >=0.13.0 <1.0.0`; dependency `@arnilo/prism-mcp-server`
        - `src/index.ts`, `bin/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `tsconfig.json`, `bunfig.toml`, `src/__tests__/`
        - a bin that prints usage for `--help` and fails with exit code 2 on an unknown subcommand
      - `scripts/host-builder-index.mjs` generates `data/api.json`, `data/errors.json` and `data/examples.json` plus `data/examples/<path>` sources. It writes deterministic, sorted output and takes `--check` to verify without writing.
        - `api.json`, per public export of `@arnilo/prism`, its subpaths and every published package:
          - name, kind, signature (from the baseline generator's model, Task 1 (b))
          - the docs pages and READMEs that mention it in backticks
          - the examples that import it
        - `errors.json`, per code: the owning package, the declaring file and line, the error class, the docs pages that mention it, and a one-line meaning taken from the declaration's doc comment. A code without a doc comment is listed with `meaning: null` and reported, so the review in Task 3 can add one.
        - `examples.json`, per example in the execution gate: path, title (first doc-comment line), imported packages, and whether it needs credentials (from the e2e coverage file).
        - Each file records `prismVersion` and a content hash.
      - Enforcement rows (`references/prism.md` §3 probe 11):
        - root `package.json` `workspaces` (already globbed by `packages/hosts/*`; verify)
        - the `scripts/package-truth.mjs` counts
        - the `src/__tests__/packaging.test.ts` package list
        - `scripts/independent-packages.json` (decision: lockstep with the kernel, since the indexes describe one kernel version)
        - a new `scripts/compat-baseline/arnilo__prism-host-builder.txt` via `bun scripts/release.mjs gate --update-baseline` (diff in the note: one new file)
        - a `docs/index.md` link under "Host libraries"
        - a `scripts/budgets.json` entry from Task 1 (g)
      - `plans/185-…md` gets an amendment line: `@arnilo/prism-host-builder` is in the tree at freeze time and joins the freeze; any task that renames, removes or reshapes a public export also updates the host-builder kit (`bun scripts/host-builder-index.mjs` plus the skill text), because `host_builder_kit_matches_surface` (Task 3) fails otherwise.
    - Performance: The generator runs in under 20 s. The indexes load lazily, on the first MCP tool call that needs them, not at bin start.
    - Code Quality: The generator reuses the baseline generator's export model instead of parsing TypeScript itself. No TypeScript compiler dependency at runtime. `data/` is generated, never hand-edited, and the freshness test enforces it.
    - Security: The generator reads only `src/`, `packages/*/src`, `docs/`, the package READMEs and `examples/`. Copied example sources are scanned with `redactSecrets`, and a hit fails generation. No `live.env` or `_evidence` content enters `data/`.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (b), (g); `packages/hosts/devtools/package.json` (bin precedent); `scripts/independent-packages.json`; `scripts/package-truth.mjs`
    - Options Considered:
      - **Parse `.d.ts` files at runtime from the installed `node_modules`.** Rejected: it needs the TypeScript compiler (a heavy dependency) and is slow on every call. A build-time index is exact for a lockstep version.
      - **Link examples to GitHub instead of shipping sources.** Rejected: the server must work offline and version-exact.
      - **Put the kit in the kernel tarball (`skills/` plus a `prism mcp` subcommand).** Rejected: MCP needs a runtime dependency that the zero-dependency kernel forbids, and every host would pay the tarball bytes.
    - Chosen Approach:
      - A lockstep host library whose data is generated from the same models the release gate already trusts.
    - API Notes and Examples:
      ```bash
      timeout 60 bun scripts/host-builder-index.mjs           # regenerate packages/hosts/host-builder/data
      timeout 60 bun scripts/host-builder-index.mjs --check   # CI: fail if stale
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/**` (new)
      - `scripts/host-builder-index.mjs` (new), `scripts/host-builder-index.test.mjs` (new)
      - `scripts/package-truth.mjs`, `src/__tests__/packaging.test.ts`, `scripts/independent-packages.json`, `scripts/budgets.json`
      - `scripts/compat-baseline/arnilo__prism-host-builder.txt` (new, generated)
      - `docs/index.md`
      - `plans/185-Phase-11-Part-L-Kernel-Surface-Reduction-Shape-Freeze-And-Forward-Compatibility.md`: amendment line
      - `roadmap.md` §2 host-library rows (tentative: per Task 1 (a))
      - `CHANGELOG.md`
    - References:
      - `packages/hosts/devtools/` (layout), `scripts/compat-baseline/`
  - Test Cases to Write:
    - `host_builder_index_is_fresh`: `--check` passes on the tree and fails after a fixture adds an export without regenerating.
    - `host_builder_index_deterministic`: two runs produce byte-identical output.
    - `host_builder_index_rejects_secret_in_example`: a fixture example containing a key-shaped literal fails generation.
    - `host_builder_bin_usage`: `--help` exits 0; an unknown subcommand exits 2.
    - `packaging.test.ts` lists the package; the tarball contains `data/api.json` and `skills/prism-host-builder/SKILL.md`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new published package and bin.
    - Docs pages to create/edit:
      - `packages/hosts/host-builder/README.md`: package page structure. Install (as a dev dependency); bin usage; what it serves; cost (no model calls, no network); security (what it executes and where it writes)
      - `docs/index.md`: one link under "Host libraries"
      - `CHANGELOG.md`
    - `docs/index.md` update: yes — "`@arnilo/prism-host-builder`: Skill, MCP server, and installer that help coding agents build and change Prism hosts against the installed version."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The `prism-host-builder` skill and the drift gate
  - Acceptance Criteria:
    - Functional:
      - `skills/prism-host-builder/SKILL.md` has:
        - a description that triggers on building, changing, upgrading or debugging a Prism host or package
        - a body of at most 8 KiB, covering the workflow (orient, choose, build, verify) and a map of the references
      - `references/`:
        - `choosing.md`: decision trees for the host library (headless, acp, ag-ui, mcp-server, channels, remote, devtools), store, memory set and slot owners, approval and governance, and provider
        - `layout.md`: what belongs in the kernel, in a package, or in the host (from `apps/prism-agent/README.md`, "Where things go"); the public-surface rule
        - `recipes.md`: one entry per common change, each naming the CI-tested example to copy and the docs page, never restating the example's code
        - `pitfalls.md`: failure modes from Task 1 (c), with error codes and fixes
        - `security.md`: a condensed `docs/host-security.md` checklist; secret refs only; project trust
        - `verification.md`: typecheck, `inspect()`, `packageConformance`/`loopConformance`/`storeConformance`, the MCP tools
        - `upgrading.md`: how to read `docs/migrate-to-*.md`, the retired-name map
      - Every doc reference is a project-relative path into the installed tarballs (`node_modules/@arnilo/prism/docs/<page>.md`, `node_modules/@arnilo/<pkg>/README.md`), so a copied skill reads version-exact docs. The skill names the MCP tools as optional accelerators; every procedure also works without the server.
      - It passes plan 211's `package_skills_conform` as a package skill. The package does not register it into agents (it has no `setup`); the installer copies it.
      - `host_builder_kit_matches_surface` (`src/__tests__/host-builder-kit.test.ts`) checks:
        - (1) every fenced `ts` block in the skill and its references is extracted and typechecked against the workspace, with the `examples/tsconfig.json` settings; a block marked `<!-- no-check -->` must give its reason
        - (2) every `node_modules/@arnilo/<pkg>/<path>` reference exists in that package's packed file list
        - (3) every `examples/<path>` reference is in `data/examples.json`
        - (4) every `ERR_PRISM_*` or short error code mentioned exists in `data/errors.json`
        - (5) no name from `scripts/retired-tool-names.json` (plan 211) or the retired-name tables of `docs/migrate-to-0.13.md` appears outside `upgrading.md`'s from-columns

        It runs in `release:gate`.
      - Every `errors.json` code with `meaning: null` that the skill or a pitfall references gets a doc comment at its declaration in this task.
    - Performance: The gate runs in under 60 s (one `tsc --noEmit` over the extracted blocks).
    - Code Quality: The skill holds judgment and pointers; facts that change (signatures, options) live in the docs and the indexes and are linked, not copied. That is what keeps the drift surface small.
    - Security: The security reference never weakens a fail-closed rule. The gate scans the skill for secret-shaped literals.
  - Approach:
    - Documentation Reviewed:
      - `apps/prism-agent/README.md`, `docs/host-security.md`, `docs/migrate-to-0.13.md`, `examples/README.md`, `templates/README.md`
      - Task 1 (c); plan 211 Task 3 (authoring contract)
    - Options Considered:
      - **One large `SKILL.md`.** Rejected: progressive disclosure inside the skill (body plus `references/`) keeps the loaded cost small. Plan 190 Task 6 already makes `references/` readable.
      - **An `llms.txt` index.** Rejected: `docs/index.md` already ships in the tarball and serves as the index; the skill points to it.
      - **Restate example code in recipes.** Rejected: it duplicates tested code into untested text, which is the drift the gate exists to prevent.
    - Chosen Approach:
      - A judgment-and-pointer skill, with a gate that compiles its code and resolves its pointers.
    - API Notes and Examples:
      ```markdown
      ---
      name: prism-host-builder
      description: Use when building, changing, upgrading, or debugging a host or package on the Prism agent SDK (@arnilo/prism) — choosing packages, wiring createAgent, serving it, and verifying it.
      ---
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/skills/prism-host-builder/SKILL.md` and `references/*.md` (new)
      - `src/__tests__/host-builder-kit.test.ts` (new); the `release:gate` stage list
      - declaration files gaining doc comments (tentative: those Task 1 (b) flags)
      - `packages/hosts/host-builder/README.md`, `CHANGELOG.md`
    - References:
      - `examples/tsconfig.json`; `scripts/e2e-coverage.json`
  - Test Cases to Write:
    - `host_builder_kit_matches_surface`: passes on the tree. Fixture variants fail on:
      - a block importing a nonexistent export
      - a path missing from a tarball
      - an unindexed example
      - an unknown error code
      - a retired name outside `upgrading.md`
    - `host_builder_skill_conforms`: the skill passes `package_skills_conform`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — published skill content.
    - Docs pages to create/edit: the package README ("The skill" section); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: The MCP server — lookup tools, docs resources, prompts
  - Acceptance Criteria:
    - Functional:
      - `prism-host-builder mcp [--root <dir>]` serves over stdio through `servePrismMcpStdio` (`packages/hosts/mcp-server/src/server.ts:205`). Tools:
        - `prism_api({ symbol?, query?, package? })`: an exact symbol lookup, or a lexical query over names and signatures; returns signature, package, subpath, docs pages and examples
        - `prism_errors({ code })`: meaning, owning package, declaring `file:line`, related docs, and fixes from `pitfalls.md` when listed
        - `prism_examples({ query?, package? })`: ranked examples; `{ path }` returns the source
        - `prism_docs({ query })`: lexical search over the installed `node_modules/@arnilo/prism/docs/*.md` and `node_modules/@arnilo/*/README.md` under `--root`, returning heading-anchored excerpts
      - Resources: `prism-docs://<package>/<path>` for each installed docs page and README.
      - Prompts:
        - `build-host`: load the skill, choose with `choosing.md`, verify
        - `add-capability`
        - `upgrade-host`: read the installed version, the migration notes, the retired-name check
      - **Version check.** Each tool call resolves the `@arnilo/prism` version installed under `--root` and compares it with the indexes' `prismVersion`. On mismatch, or when Prism is not installed, the call returns a tool error (`ERR_PRISM_HOST_BUILDER_VERSION`) naming both versions and the fix (`bun add -d @arnilo/prism-host-builder@<installed>`). `--allow-version-mismatch` turns the error into a warning field on every result.
      - Every result is bounded (proposed 64 KiB, set in Task 1) and truncation is marked. Unknown symbols, codes or paths return a "not found" result with the nearest matches, never an exception.
    - Performance: Indexes load once, lazily. A lookup answers in under 50 ms after load (measured). The docs search builds its lexical index on first use and caches it for the process.
    - Code Quality: Plain functions in `src/lookup/*.ts`, so tests call them without MCP. `src/server.ts` only registers them. No embeddings and no model calls (the same rule as memory, release-decisions 2026-10-24). No network.
    - Security:
      - Read-only.
      - Docs resources resolve only inside `<root>/node_modules/@arnilo/` after `realpath`; a symlink escaping it is refused.
      - The `path` argument of `prism_examples` resolves only to entries in `examples.json`; anything else is "not found".
      - No tool reads arbitrary project files.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (e) (MCP SDK 2.0.0 tool, resource and prompt API, via find-docs)
      - `packages/hosts/mcp-server/src/server.ts:205`, `packages/integrations/mcp/README.md` (client side, for Task 7)
    - Options Considered:
      - **A docs-only MCP server.** Rejected: it would be worse than the files the agent can already read. The server earns its place with version checks and exact lookups.
      - **Streamable HTTP.** Rejected: stdio is local with no listener, and every target agent supports it.
      - **Ranking the docs search with embeddings.** Rejected: no embeddings by project rule, and lexical search suffices for API names.
    - Chosen Approach:
      - Thin MCP registration over pure, tested lookup functions.
    - API Notes and Examples:
      ```json
      { "mcpServers": { "prism": { "command": "bunx", "args": ["prism-host-builder", "mcp"] } } }
      ```
      ```ts
      // prism_api({ symbol: "createAgent" }) →
      // { package: "@arnilo/prism", signature: "createAgent(config: AgentConfig): Promise<Agent>", docs: ["node_modules/@arnilo/prism/docs/agent.md#…"], examples: ["examples/sdk-basics.ts", …] }
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/src/{server.ts,lookup/api.ts,lookup/errors.ts,lookup/examples.ts,lookup/docs.ts,version.ts}` (new)
      - `packages/hosts/host-builder/bin/prism-host-builder.ts`: the `mcp` subcommand
      - `src/__tests__/{lookup,server,version}.test.ts` (new)
      - `scripts/compat-baseline/arnilo__prism-host-builder.txt`: regenerated if `src/index.ts` exports change (diff in the note)
      - README, `CHANGELOG.md`
    - References:
      - `packages/hosts/mcp-server/src/__tests__` (in-process transport pattern)
  - Test Cases to Write:
    - `prism_api_exact_and_query`, `prism_errors_known_and_unknown`, `prism_examples_path_outside_index_not_found`, `prism_docs_returns_anchored_excerpt`.
    - `version_mismatch_fails_closed` and `version_mismatch_allowed_warns`.
    - `docs_resource_symlink_escape_refused`.
    - `results_bounded_and_marked`.
    - `server_lists_tools_resources_prompts`: an in-process MCP client sees exactly the declared set.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the bin's MCP surface.
    - Docs pages to create/edit: README ("MCP server": tools, resources, prompts, version rule, bounds); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Checking the host's own code — inspect, manifest, conformance
  - Acceptance Criteria:
    - Functional:
      - The server takes check targets only from its start flags, never from tool arguments:
        - `--entry <file>#<export>`, repeatable: an async function returning an `Agent`
        - `--package <file>#<export>`, repeatable: a package factory or definition
        - `--trust-project`
      - Tools:
        - `prism_inspect_host({ entry })`: `entry` is one of the configured names. The tool runs the factory in a child `bun` process and returns `agent.inspect()` (packages, tools, skills with `requiresTools`, hooks, slot owners, status notes) and `dispose()`s the agent.
        - `prism_check_manifest()`: runs the manifest verification `prism verify` performs, respecting `--trust-project`, and returns the structured result.
        - `prism_check_package({ package })`: runs `packageConformance` from `@arnilo/prism/testing` on the configured package and returns each check's result.
      - The child runner sets `PRISM_HOST_BUILDER_CHECK=1`. The README documents the convention that an inspection factory uses the mock provider (`mockProvider` from `@arnilo/prism/testing`) so no model is called. A run that emits any model request event fails with `ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL`.
      - When no targets are configured, these tools list as available but return a result saying how to configure targets. They never guess an entry.
    - Performance:
      - Each check is one child process with a default 30 s timeout (cap 120 s, flag `--check-timeout`) and a 1 MiB output cap.
      - On timeout the child is killed and the result says so.
      - No process outlives the call (asserted).
      - Cost knob: a check builds the host's agent once per call, at whatever cost its setup has, and this is stated in the README.
    - Code Quality: One runner (`src/check/runner.ts`) shared by the three tools. Results are typed, and the runner adds no shape of its own beyond `{ ok, result | error, timedOut, truncated }`.
    - Security:
      - **Executing host code is the trust boundary.** It happens only for paths the user passed at server start, each `realpath`ed inside `--root`. A path outside the root, or a symlink escaping it, is refused at start with `ERR_PRISM_HOST_BUILDER_ENTRY`.
      - The child's environment is an allowlist: `PATH`, `HOME`, `TMPDIR`, `PRISM_HOME` and `--pass-env NAME` additions; provider keys are absent by default.
      - Every result passes `redactSecrets` (`src/index.ts:365`). A test plants a secret in the factory's config and asserts it never appears in the result.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (f); `docs/agent.md` (`inspect()`, `src/__tests__` for `AgentInspection`), `docs/testing.md` (`packageConformance`), `docs/manifest.md` (`verify`)
      - `packages/hosts/devtools/README.md` (reads `inspect()` without starting runs)
    - Options Considered:
      - **Import the entry in the server process.** Rejected: host code could hang, leak handles or mutate globals, and one bad call would take down the server.
      - **Accept entry paths as tool arguments.** Rejected: that lets any MCP caller make the server execute any file. Configuration at start keeps the user in control.
      - **Reuse devtools' JSON API.** Rejected: it needs a running agent and a listener. A one-shot child is simpler and leaves nothing running.
    - Chosen Approach:
      - User-configured targets, a bounded child process, an environment allowlist, and redacted typed results.
    - API Notes and Examples:
      ```bash
      bunx prism-host-builder mcp --entry src/agent.ts#createInspectionAgent --package src/my-package.ts#default
      ```
      ```ts
      // src/agent.ts (host convention)
      export async function createInspectionAgent() {
        return createAgent({ model: "mock/demo", packages: [mockProvider(), ...hostPackages()] });
      }
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/src/check/{runner.ts,child.ts,inspect.ts,manifest.ts,conformance.ts}` (new); `src/server.ts`; `bin/prism-host-builder.ts` (flags)
      - `src/__tests__/check-*.test.ts` and fixtures (new)
      - README ("Checking your host"), `CHANGELOG.md`
    - References:
      - `src/testing/index.ts` (`packageConformance`, `mockProvider`); `src/cli-manifest.ts` (`verify`)
  - Test Cases to Write:
    - `inspect_host_returns_inspection`, `inspect_host_secret_never_in_result`.
    - `inspect_host_timeout_kills_child`: a fixture factory hangs.
    - `entry_outside_root_refused_at_start`, `entry_not_configured_returns_guidance`.
    - `check_model_call_fails`: a fixture factory runs a turn on a real-shaped provider stub.
    - `check_env_allowlist`: a variable outside the allowlist is absent in the child.
    - `check_package_reports_conformance_failures`, `check_manifest_respects_trust_flag`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — bin flags and three tools.
    - Docs pages to create/edit: README ("Checking your host": the factory convention, flags, environment allowlist, cost); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The installer
  - Acceptance Criteria:
    - Functional:
      - `prism-host-builder install --target <t> [--mcp] [--root <dir>] [--force] [--dry-run]`. Targets come from Task 1 (d): `claude`, `codex`, `cursor`, `agents` (generic `.agents/skills`, which Prism's `contextFiles` also discovers), and `prism`.
      - It copies `skills/prism-host-builder/` into the target's project skill directory.
      - With `--mcp` and a JSON config target, it merges `{ prism: { command: "bunx", args: ["prism-host-builder", "mcp"] } }` under the target's server key, preserving every other key and the file's formatting style (2-space JSON). For a non-JSON target it prints the exact snippet and the file it belongs in, and writes nothing.
      - For `prism`, it prints the `skills.dirs` and `@arnilo/prism-mcp` config a Prism builder agent needs.
      - Each install writes a `.prism-host-builder.json` stamp next to the copied skill (version and content hash). A re-install of the same version is a no-op. A different version replaces the skill only if the on-disk files still match the old stamp's hash, so local edits are never silently overwritten; otherwise it fails with `ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT` unless `--force` is given.
      - An existing `prism` server entry in the config that differs is a conflict under the same rule.
      - `--dry-run` prints the plan and writes nothing.
    - Performance: Local file copies only; under 1 s.
    - Code Quality: Targets are a table of `{ skillDir, config?: { file, key, format } }` in one file, so adding a target is one row. No TOML or YAML dependency.
    - Security:
      - Writes only inside `--root` (realpath-checked).
      - Never writes user-global config.
      - Never writes a secret: the entry has no env and no token.
      - A malformed existing JSON config is refused (`ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG`), never rewritten.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (d) (target conventions, dated); plan 190 Task 5 (`contextFiles` skill roots)
    - Options Considered:
      - **Kernel `prism skills install`.** Rejected: the kernel CLI manages the package manifest; copying a third package's skill into vendor agents' config is that package's job, and kernel growth needs proof that a package cannot do it.
      - **Write user-global config (`~/.claude`, `~/.codex`).** Rejected: the kit is version-exact per project, and a global install would serve one project's version to all of them.
    - Chosen Approach:
      - A project-scoped, table-driven installer with conflict detection by content stamp.
    - API Notes and Examples:
      ```bash
      bunx prism-host-builder install --target claude --mcp
      bunx prism-host-builder install --target codex --mcp --dry-run   # prints the TOML snippet if Codex config is TOML
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/src/install/{targets.ts,install.ts}` (new); `bin/prism-host-builder.ts`
      - `src/__tests__/install.test.ts` (new)
      - README ("Installing into your coding agent"), `CHANGELOG.md`
    - References:
      - `packages/context/files/src/skills.ts:47` (Prism's discovery roots)
  - Test Cases to Write:
    - `install_copies_skill_per_target`.
    - `install_merges_mcp_json_preserving_entries`.
    - `install_non_json_target_prints_snippet_writes_nothing`.
    - `install_same_version_noop`, `install_upgrade_replaces_unmodified`, `install_local_edits_conflict`, `install_force_overwrites`.
    - `install_malformed_config_refused`, `install_outside_root_refused`, `install_dry_run_writes_nothing`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a CLI subcommand that writes files.
    - Docs pages to create/edit: README; `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: A Prism agent as the builder — example and walkthrough
  - Acceptance Criteria:
    - Functional:
      - `examples/host-builder-agent.ts` builds a Prism agent on the mock provider with:
        - `tools-coding` (root: a temp copy of `examples/example-workspace` or a new fixture workspace)
        - `contextFiles`, which discovers the installed `prism-host-builder` skill under `.agents/skills`
        - `@arnilo/prism-mcp`, connected to `prism-host-builder mcp` over stdio
      - A scripted turn loads the skill, calls `prism_api({ symbol: "createAgent" })` and `prism_inspect_host`, and prints the results.
      - `apps/prism-agent/README.md` gains a short "Building a host with an agent" section pointing to the package and the example. The reference host's code does not change.
      - Root `README.md` gains one line under its host-building section linking the package.
    - Performance: The example spawns one MCP server and one check child and exits within the example gate's timeout.
    - Code Quality: Public surface only. The example is listed in `examples/README.md` and `scripts/e2e-coverage.json`.
    - Security: No secret in output (`examples_demos_run_to_completion_and_emit_no_secret`). The MCP server is spawned with the start flags of Task 5, never from model output.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/mcp/README.md` (stdio client config, trust), `packages/context/files/README.md`, `examples/connected-slack-mcp.ts`, `examples/mcp-trust.ts`
    - Options Considered:
      - **Make the reference host itself a builder.** Rejected: the reference host proves the SDK for product-shaped hosts; a builder is a developer workflow, and an example demonstrates it without widening the host.
    - Chosen Approach:
      - One example under the execution gate, plus pointers from the two guides hosts already read.
    - API Notes and Examples:
      ```bash
      timeout 180 bun examples/host-builder-agent.ts
      ```
    - Files to Create/Edit:
      - `examples/host-builder-agent.ts` (new), `examples/README.md`, `scripts/e2e-coverage.json`
      - `apps/prism-agent/README.md`, `README.md`
      - `packages/hosts/host-builder/data/examples.json` (regenerated: the new example)
      - `CHANGELOG.md`
    - References:
      - `examples/mcp-server.ts`, `examples/discover-skills.ts`
  - Test Cases to Write:
    - The example runs under the execution gate.
    - `host_builder_index_is_fresh` stays green after regeneration.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API.
    - Docs pages to create/edit: `apps/prism-agent/README.md`, `README.md`, `examples/README.md`, `CHANGELOG.md`.
    - `docs/index.md` update: no (the walkthrough and package are already linked).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Builder evaluation and claims (owner gate, paid)
  - Acceptance Criteria:
    - Functional:
      - `scripts/host-builder-evals/criteria.json` is committed before any paid run. It defines:
        - 6–8 fixture tasks under `scripts/host-builder-evals/workspaces/`, from Task 1 (c), for example:
          - create a minimal headless host
          - gate coding writes with approval
          - add SQLite persistence with resume
          - serve the agent over ACP
          - add fabric memory with the compaction slot assigned
          - write a package with a conformance test
          - upgrade a 0.12-shaped host to 0.13
        - per task, hidden acceptance tests the builder never sees
        - scorers:
          - `typecheck_passes`
          - `acceptance_tests_pass`
          - `public_surface_only` (the reference-host allowlist check applied to the workspace)
          - `no_retired_names`
          - tool-call and token cost
        - arms: `none`, `skill`, `skill+mcp`
        - the builder: a Prism agent with `tools-coding` (shell enabled inside the workspace), `contextFiles`, and `@arnilo/prism-mcp` in the `skill+mcp` arm
        - trials: 3 per item
        - claim rules:
          - a claim ("the skill improves X", "the MCP server improves X over the skill") is published only when `compareExperiments` shows a significant improvement at alpha .05
          - a significant regression in any arm against `none` blocks the plan until that component is fixed and re-measured once; if it still regresses, the owner decides and the decision is recorded
      - `scripts/host-builder-evals/run.mjs` runs offline (scripted provider: checks fixtures, hidden tests and scorer wiring) and live. The live run uses Hyper and OpenCode Go only, after the owner approves a dry-run cost estimate recorded in the task note.
      - The evidence is written to `docs/_evidence/host-builder/212/`. The README's "What it changes" states only the passed claims, each linked to its evidence.
    - Performance: The offline suite runs in under 120 s. The live run reports cost and wall time per arm.
    - Code Quality: Reuses `@arnilo/prism-evals` (`runExperiment`, `compareExperiments`) and plan 211's skill-eval runner structure, with no new statistics code. Workspaces are fixtures, outside every tarball.
    - Security: Builders run in temp copies of the workspaces with `tools-coding` rooted there and approval auto-allowing only inside the root. No network tool is loaded. Keys come from `scripts/live.env` refs, and the evidence passes a no-secret assertion.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/evals/README.md` ("Experiments", "Comparing two runs", "Gating a release"); plan 211 Task 8; `docs/live-testing.md`
    - Options Considered:
      - **Use Claude Code or Codex as the builder.** Rejected for the gate: it needs a vendor adapter Prism does not ship (roadmap §2.12, hosts write adapters) and a user subscription. A Prism builder on the release providers is reproducible. The kit itself targets those agents through the installer.
      - **No eval; ship on review.** Rejected: the repo publishes no capability claim without measured evidence.
    - Chosen Approach:
      - Hidden-test grading on fixture workspaces, three arms, pre-registered claim rules.
    - API Notes and Examples:
      ```bash
      timeout 600 bun scripts/host-builder-evals/run.mjs --offline
      timeout 3600 bun scripts/host-builder-evals/run.mjs --live --providers hyper,opencode-go
      ```
    - Files to Create/Edit:
      - `scripts/host-builder-evals/{criteria.json,run.mjs,run.test.mjs}` (new), `scripts/host-builder-evals/workspaces/**` (new)
      - `docs/_evidence/host-builder/212/*` (new, evidence)
      - `packages/hosts/host-builder/README.md` (claims), `docs/live-testing.md`, `CHANGELOG.md`
    - References:
      - `scripts/host-surface-allowlist.json`, `src/__tests__/reference-host-boundary.test.ts` (`public_surface_only`)
  - Test Cases to Write:
    - `host_builder_eval_criteria_preregistered`.
    - `host_builder_eval_offline_runs_every_workspace`.
    - `hidden_tests_not_in_builder_workspace`: the builder's copy contains no acceptance test file.
    - `host_builder_eval_evidence_contains_no_secret`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API; published claims.
    - Docs pages to create/edit: package README (claims with evidence links); `docs/live-testing.md`; `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 300 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 120 bun scripts/host-builder-index.mjs --check`
- `timeout 600 bun run --filter @arnilo/prism-host-builder test`
- `timeout 600 bun test --timeout=0 src/__tests__/host-builder-kit.test.ts src/__tests__/package-skills.test.ts src/__tests__/docs.test.ts src/__tests__/packaging.test.ts`
- `timeout 180 bun examples/host-builder-agent.ts`
- `timeout 600 bun scripts/host-builder-evals/run.mjs --offline`
- `timeout 600 bun run --filter @arnilo/prism-agent test`
- `timeout 1800 bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
