# 069 — Trusted Extension Activation, Wiki Ingest, And Graft CLI

Roadmap phase: **0.5.x**.
Baseline: `@arnilo/prism` **0.5.5**; `@arnilo/prism-memory` **0.5.5** (`/wiki` + `/graft` subpaths).
Status: **Complete — Tasks 1–11 executed** (2026-09-09).

Four host-facing slices on existing contracts. No new contribution kinds. No marketplace. No MCP auto-start.

1. **Trusted extension activation** — `activateKernel(kernel)` plus CLI `--extension` (allow-listed `import()`, then activate).
2. **Wiki ingest** — `/wiki-ingest` stages an immutable raw source (text, file, image, PDF), then the Karpathy/OKF maintainer skill files it into the wiki.
3. **URL ingest** — same staging path; wiki package does **not** fetch. Host injects `fetchUrl` (Obscura `web_fetch` / `runObscuraCli`, or any other host fetch).
4. **Graft CLI commands** — `/graft-init`, `/graft-build`, `/graft-build-deep` wrap the `@nanonets/graft` CLI. Deep builds use Graft's own LLM client; the host passes provider/model/key. Prism does **not** plug its Agent `provider` into Graft.

## Objectives

- Give embedding hosts a one-call activation helper so third-party `Extension` packages wire like first-party packages without each host re-copying `kernel.registries.*.list()`.
- Let the `prism` CLI load **trusted** extension modules via `--extension` and activate them into `createAgent()`. Fail closed. No auto-discovery of npm packages.
- Ship `/wiki-ingest` on `@arnilo/prism-memory/wiki` so a host/user can pass a message, file, image, or **URL** and have it staged into the Karpathy raw layer and filed by the maintainer skill. Wiki never ships a HTTP client; URL ingest requires a host `fetchUrl` hook.
- Ship first-class `/graft-init`, `/graft-build`, `/graft-build-deep` commands that run the graft CLI. Host configures Graft's `--deep` model (`GRAFT_PROVIDER` / `GRAFT_MODEL` / `GRAFT_API_KEY` / optional `GRAFT_BASE_URL`). Fail closed without those settings. No inheritance of host process secrets.
- Keep trust boundaries: extensions stay inert until activation; paths stay inside `workspaceRoot`; wiki command does not call a nested LLM; graft-deep does not use Prism's streaming Provider.

## Expected Outcome

- `activateKernel(kernel)` returns drop-in `createAgent()` fields (`tools`, `skills`, `instructionInjectors`, `context`, `middleware`) plus `commands` for host RPC.
- `prism --extension ./trusted.js --provider mock -p "hi"` loads that module, `kernel.load()`, activates, runs. Bare package names and absolute paths require `PRISM_EXTENSION_ALLOWLIST`. Unknown `--extension` still errors. `--config` / `--resource` / `--tool` stay rejected.
- `/wiki-ingest` with `{ text }` / `{ path }` / `{ url }` writes `raw/ingest/<id>/` (immutable `source.*` + utf8 `extract.md`), returns an ingest brief, and when `context.drivers?.startRun` exists starts a run with `wiki-maintainer` active. `{ url }` without `fetchUrl` fails closed. Without drivers the command still stages and returns the brief (inert-data rule unchanged).
- `prism-wiki ingest --path paper.pdf` stages + parses + prints the raw id (no agent). `prism-wiki ingest --url` is a usage error (standalone CLI has no fetch hook).
- `wiki-maintainer` SKILL.md and `SCHEMA.md` contain an explicit **Ingest** procedure matching Karpathy (one source, update entities/index/log, do not copy raw) and OKF v0.2 (`type`, `sources`, `generated`, `index.md`, `log.md`).
- `/graft-init`, `/graft-build`, `/graft-build-deep` are registered next to the existing `graft` / `graft-build` / `graft-check` / `graft-viz` commands. Deep build passes host `deepModel` into the child as `GRAFT_*` env (and `--provider`/`--model`/`--base-url` argv — never `--api-key`). Structural `graft build` still needs no key.

## Tasks

- [x] Task 1 — Primitive review (activation + ingest)
  - Acceptance Criteria:
    - Functional: Inventory existing primitives and record, per gap, reuse vs reject vs one new helper. Confirm no new `ExtensionAPI` methods, no `CommandExecutionContext` attachments field, no `startRun(ContentBlock[])`, no marketplace, no MCP auto-start, no office/coding-tools dependency on `@arnilo/prism-memory`.
    - Performance: Static review only; no new runtime.
    - Code Quality: Decisions name exact file:line spans. New code allowed later is only `activateKernel` (core helper) and `ingestWikiSource` (wiki package function).
    - Security: Reconfirm fail-closed activation, `import()` allow-list before module evaluation, workspace path containment for ingest, no URL fetch (SSRF), command `metadata.trust: "untrusted_external"`.
  - Approach:
    - Documentation Reviewed:
      - `docs/extensions.md`, `docs/extension-authoring.md`, `docs/middleware-hooks.md`, `docs/cli-rpc.md`
      - `docs/wiki.md`, `docs/document-reader.md`, `docs/rag.md`
      - `src/extensions.ts` (`createExtensionKernel` L109), `src/contracts-core/agent.ts` (`AgentConfig` L52, `CommandDefinition` L161, `CommandDrivers` L189)
      - `src/cli-runner.ts` (`unsupportedFlags` includes `--extension`)
      - `packages/memory/src/wiki/extension.ts`, `commands/{init,refresh,lint}.ts`, `tools/record-insight.ts`, `engine/okf.ts`, `manifest.ts` (`DEFAULT_IGNORE_PATTERNS` includes `.wiki`)
      - `packages/memory/src/rag/parsers.ts` (`textParser`, `markdownParser`, `htmlParser`, `pdfParser` — uncompressed PDF only)
      - `packages/prism-coding-tools/src/document-reader/index.ts` (`createDocumentReader`, optional pdf-parse/mammoth)
      - Karpathy gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f (Ingest / Query / Lint; raw immutable; schema-driven LLM filing; `index.md` + `log.md`)
      - OKF v0.2 SPEC: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md (§3 bundle, §4 frontmatter, §5 `sources`/`generated`, §8 `index.md`, §9 `log.md`)
      - `.agents/skills/create-plan/references/prism-wiki.md`
      - Prior art: `plans/032-Prism-Wiki-Karpathy-LLM-Wiki-Package.md`, `plans/050-Release-0-3-2-Clay-Integration-Findings-And-OKF-Wiki.md`
    - Options Considered:
      - New plugin host (marketplace, `plugin.json`, auto-start MCP, shell hooks): rejected — product-sized, duplicates Claude/Codex, not needed for trusted SDK hosts.
      - Reuse `Extension` + `CommandDefinition` + `CommandDrivers` + RAG parsers + wiki-maintainer skill; add only `activateKernel` and `ingestWikiSource`: chosen.
    - Chosen Approach:
      - Activation gap is host glue, not missing registries. Ingest gap is Karpathy **Ingest** op: current `wiki-refresh` is deterministic compile from utf8 workspace files; it never accepts an upload and never instructs an LLM. Do not put ingest blobs under `.wiki/` (ignored by `scanRawFiles`). Stage under workspace `raw/` (Karpathy raw layer). Do not call an LLM inside the command.
    - API Notes and Examples:
      ```ts
      // existing — host still owns this sequence; Task 2 only shortens the copy step
      await kernel.load([createWikiExtension(opts), createAcmeExtension(opts)]);
      createAgent({
        model, provider,
        tools: kernel.registries.tools.list(),
        skills: kernel.registries.skills.list(),
        instructionInjectors: kernel.registries.instructionInjectors.list(),
        context: kernel.registries.contextProviders.list(),
        middleware: kernel.middleware,
      });
      ```
    - Files to Create/Edit:
      - none (inventory only; decisions live in this plan)
  - Findings (recorded 2026-09-09, all spans verified against working tree):
    - **No new `ExtensionAPI` methods.** Full surface: 20 `register*` methods + `use`/`on` at `src/extensions.ts:118-214`; `createExtensionKernel` at `:109-258`. Ingest needs none of them (no wiki-specific registration exists).
    - **No `CommandExecutionContext.attachments`.** Interface is `sessionId`/`runId`/`signal`/`metadata`/`drivers` at `src/contracts-core/agent.ts:169-177`. Reject attachments; ingest takes `text`/`path`/`bytes` (Task 4 unchanged).
    - **No `startRun(ContentBlock[])`.** `CommandDrivers` at `src/contracts-core/agent.ts:189-197`: `startRun(input: string, options?: RunOptions)`. The ingest brief is a string; image content rides in `CommandResult.content` (`CommandResult` at `:199-205`), not in `startRun`.
    - **`activateKernel` mapping valid.** `AgentConfig` accepts plain arrays/registries: `tools` `agent.ts:59`, `context` `:60`, `skills` `:61` (`SkillRegistry | readonly Skill[]`), `middleware` `:72`, `instructionInjectors` `:96`. Registry key `instructionInjectors` exists at `src/contributions.ts:85`; `list()` at `:59-61` of `src/contributions.ts`. Single-slot `inputBuilder`/`promptBuilder` (`:70-71`), `compaction`/`retry` (`:88-89`) stay host-owned — helper excludes them, as planned.
    - **No marketplace / MCP auto-start.** `unsupportedFlags = {--config, --resource, --extension, --tool}` at `src/cli-runner.ts:156`, rejection at `:188`; no marketplace/install/autostart code paths in the CLI. Provider dynamic-import precedent for Task 3: `factory = (await import(spec.factoryModule))[spec.factoryExport]` at `src/cli-runner.ts:466`. `--discover` remains data-only (flags `:125-127`, `:153`, `:191`).
    - **No office/coding-tools dependency in memory.** `packages/memory/package.json:70-76`: deps = `pg` only; peers = `@arnilo/prism` + optional `@nanonets/graft`. `extractDocument` stays an optional host hook.
    - **Parsers reusable.** `packages/memory/src/rag/parsers.ts:6-8` (`textParser`, `markdownParser`, `htmlParser`), `:11` (`pdfParser`, uncompressed-only). Exported via `@arnilo/prism-memory/rag/parsers` (`packages/memory/package.json` exports map).
    - **Wiki helpers reusable.** `hashContent` `packages/memory/src/wiki/manifest.ts:20`; `prependLog` `packages/memory/src/wiki/engine/okf.ts:167`; `wikiDate` `:235`. `scanRawFiles` ignores `.wiki` (`manifest.ts:6-17`) → raw staging under workspace `raw/ingest/` confirmed. `packages/memory/src/wiki/index.ts` has no ingest export yet (clean slate).
    - Note: `AgentDefinitionResolutionContext.activateAllCapabilities` (`agent.ts:42-50`) is migration-only for agent definitions; irrelevant to `activateKernel` (which copies arrays, never activates).
  - References:
      - `src/contracts-core/agent.ts:52-108`, `src/contracts-core/agent.ts:161-205`
      - `src/cli-runner.ts:156` (`unsupportedFlags`)
      - `packages/memory/src/wiki/manifest.ts:6-17` (`.wiki` ignored)
      - `packages/memory/src/wiki/tools/record-insight.ts` (single-page write; not multi-page ingest)
  - Test Cases to Write:
    - none in this task (decisions consumed by later tasks)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 2 — `activateKernel(kernel)` host helper
  - Acceptance Criteria:
    - Functional: Export `activateKernel(kernel: ExtensionKernel): ActivatedKernelConfig` from `@arnilo/prism` next to `createExtensionKernel`. Copies **array/registry slots** `createAgent()` already accepts: `tools`, `skills`, `instructionInjectors`, `context`, `middleware`. Also returns `commands` for host RPC (not an `AgentConfig` field). Does **not** auto-select single-slot builders (`inputBuilder`, `promptBuilder`, `compaction`, `retry`, provider/model). Empty registries yield empty arrays; middleware is the kernel instance.
    - Performance: `list()` copies only; no I/O; O(n) in contribution count.
    - Code Quality: One function + one exported type. No wrapper class. No options object. Host can still filter the arrays before `createAgent()`.
    - Security: Helper does not `import()`, does not grant permissions, does not activate skills (`RunOptions.activeSkills` stays host-owned). Contributions remain inert until the host passes the returned fields into `createAgent()`.
  - Approach:
    - Documentation Reviewed:
      - `docs/extensions.md`, `docs/extension-authoring.md` (host activation example copies `list()` / `resolve()`)
      - `src/contracts-core/agent.ts` `AgentConfig`
      - `src/index.ts` export of `createExtensionKernel`
      - `examples/graft-extension.ts` (`createToolRegistry(kernel.registries.tools.list())`)
    - Options Considered:
      - `createAgent({ kernel })` implicit load: rejected — plan 031 removed inert `AgentConfig.extensions`; activation must stay explicit.
      - Pure helper returning picked fields: chosen — shortest diff, host can still filter.
    - Chosen Approach:
      - Add `activateKernel` in `src/extensions.ts` (same module as the kernel). Export type + function from `src/index.ts`.
    - API Notes and Examples:
      ```ts
      import { activateKernel, createAgent, createExtensionKernel } from "@arnilo/prism";
      import { createAcmeExtension } from "acme-prism-extension";

      const kernel = createExtensionKernel({ errorPolicy: "throw" });
      await kernel.load([createAcmeExtension()]);
      const activated = activateKernel(kernel);
      const agent = createAgent({
        model, provider,
        tools: activated.tools,
        skills: activated.skills,
        instructionInjectors: activated.instructionInjectors,
        context: activated.context,
        middleware: activated.middleware,
      });
      // host RPC: activated.commands
      ```
    - Files to Create/Edit:
      - `src/extensions.ts`: `ActivatedKernelConfig`, `activateKernel`
      - `src/index.ts`: re-export
      - `src/__tests__/extensions.test.ts`: helper tests
      - `docs/extensions.md`: document helper (Task 2 docs live here so the API ships with its page; Task 3 updates CLI)
      - `docs/extension-authoring.md`: replace the manual `list()`/`resolve()` activation sample with `activateKernel`
      - `examples/extension-package.ts` and/or `examples/extensions.ts`: use the helper
    - References:
      - `docs/extension-authoring.md` Implementation example
      - `src/extensions.ts:109-258`
  - Execution notes (2026-09-09):
    - Implemented as planned: `ActivatedKernelConfig` + `activateKernel` in `src/extensions.ts` (after `createExtensionKernel`, ~L260); exported from `src/index.ts` (type + value blocks). Helper body is six `list()` copies + `kernel.middleware`.
    - Tests added to `src/__tests__/extensions.test.ts` (`activateKernel` describe, 4 tests) — all pass; full core suite 1703/1703.
    - Two repo gates required updates beyond the plan's file list:
      - `src/__tests__/public-export-contract.test.ts`: frozen export surface — added `activateKernel` (values) + `ActivatedKernelConfig` (types). This is the deliberate-add mechanism the freeze test documents.
      - `plans/README.md`: added the 069 row (the `docs.test.ts` "plans index links every active numbered plan" gate was already failing since plan creation).
    - Docs: `docs/extensions.md` (Outputs bullet + helper usage in Implementation example), `docs/extension-authoring.md` (imports/activation block replaced with `activateKernel`, plus one notes bullet — `createToolRegistry`/`createSkillRegistry` imports dropped from the sample). Examples: `examples/extension-package.ts` + `.js` twin (kept in sync) now activate via the helper; example typecheck (`tsc -p examples --noEmit`) clean and the example runs end-to-end under the mock provider.
    - `docs/index.md`: not touched (per plan).
  - Test Cases to Write:
    - `activateKernel_copies_tools_skills_injectors_context_middleware_commands`: load an extension that registers each; arrays match `list()`; middleware is `kernel.middleware`.
    - `activateKernel_empty_kernel_returns_empty_arrays`: no throw.
    - `activateKernel_does_not_pick_promptBuilder_or_provider`: registering those does not put them on the return type / return object.
    - `activateKernel_agent_run_sees_activated_tool`: `createAgent` + mock provider tool call dispatches the copied tool.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported helper.
    - Docs pages to create/edit:
      - `docs/extensions.md`: add `activateKernel` under Inputs / Implementation example
      - `docs/extension-authoring.md`: host activation sample
    - `docs/index.md` update: no — same pages, one-sentence blurbs still accurate (`ordered extension loading, registration, lifecycle events, error isolation`; `publish third-party extensions with host-owned activation and trust boundaries`)
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 3 — CLI `--extension` allow-listed load + activate
  - Acceptance Criteria:
    - Functional: Remove `--extension` from `unsupportedFlags`. Repeatable `--extension <specifier>`. After parse, before `createAgent`, load each specifier, `kernel.load()`, `activateKernel()`, merge into `agentSession()`. Specifier resolution: (1) relative path under `workspaceRoot` / cwd, `realpath` contained, `import(pathToFileURL)`; (2) bare package name or absolute path only if the specifier is in `PRISM_EXTENSION_ALLOWLIST` (comma-separated, exact match). Module must export `createExtension` function, or `default` function, or `{ name, setup }` Extension object. Failed import / bad export / path escape → `CliUsageError`. `--config`, `--resource`, `--tool` stay rejected. `--discover` unchanged (data-only).
    - Performance: One dynamic `import()` per flag; no recursive node_modules walk.
    - Code Quality: Loader is a small function in `src/cli-runner.ts` (or `src/cli-extensions.ts` if `cli-runner.ts` would grow past local style). No new dependency. Factory resolution is a 10-line branch, not a plugin manifest parser.
    - Security: **Allow-list before `import()`**. Relative paths: realpath containment; reject `\0`, `..` escape, and files outside cwd. Do not evaluate `package.json` "prism" keys. Loaded code is trusted host code (same as today's provider factory `import()`). `errorPolicy: "throw"` on the CLI kernel.
  - Approach:
    - Documentation Reviewed:
      - `docs/cli-rpc.md` (explicitly: CLI does not add extension discovery)
      - `src/cli-runner.ts` `parseCliArgs`, `unsupportedFlags`, `defaultCreateSession`, `agentSession`
      - `src/cli-runner.ts` provider factory dynamic import (precedent)
      - `docs/extension-authoring.md` trust: host loads only trusted packages
    - Options Considered:
      - Auto-load any `node_modules/@*/prism-*`: rejected — silent code execution.
      - Repeatable `--extension` + env allow-list + cwd-relative paths: chosen.
    - Chosen Approach:
      - Wire CLI as a thin host: import → `createExtensionKernel({ errorPolicy: "throw" })` → `load` → `activateKernel` → existing `createAgent`. Skip marketplace, `plugin.json`, MCP auto-start.
    - API Notes and Examples:
      ```bash
      # cwd-relative trusted module
      prism --provider mock --extension ./my-ext.js -p "hello"

      # package name requires allow-list
      PRISM_EXTENSION_ALLOWLIST=@acme/prism-foo \
        prism --provider mock --extension @acme/prism-foo -p "hello"
      ```
      ```ts
      // my-ext.js
      export function createExtension() {
        return { name: "my-ext", setup(api) { api.registerSkill({ name: "brief", instructions: "Be brief." }); } };
      }
      ```
    - Files to Create/Edit:
      - `src/cli-runner.ts`: parse `--extension` (repeatable), drop from `unsupportedFlags`, load+activate in session build, help text
      - `src/cli-extensions.ts`: optional extract of resolve/import/allow-list (only if runner file is already too large)
      - `src/__tests__/cli.test.ts` or `src/__tests__/cli-extension.test.ts`
      - `docs/cli-rpc.md`: document `--extension` and allow-list; delete the sentence that the CLI never loads extensions
    - References:
      - `src/cli-runner.ts:156-188`, `src/cli-runner.ts:448-508`
      - provider catalog dynamic import in `defaultCreateSession`
  - Test Cases to Write:
    - `cli_extension_relative_path_activates_skill_or_tool`: fixture module under test dir; `--extension ./fixture.js` registers a tool/skill visible to the mock run.
    - `cli_extension_path_escape_rejected`: `../outside.js` → usage error, no import side effect.
    - `cli_extension_bare_package_without_allowlist_rejected`.
    - `cli_extension_bare_package_with_allowlist_imports` (mock `import` seam or fixture package name if tests already stub import).
    - `cli_extension_bad_export_usage_error`.
    - `cli_config_resource_tool_still_unsupported`.
    - `cli_help_lists_extension`.
  - Execution notes (2026-09-09):
    - Implemented in `src/cli-runner.ts` (no `cli-extensions.ts` needed — loader is ~60 lines): `--extension` moved from `unsupportedFlags` to `valueFlags` (repeatable, parsed into `CliOptions.extensions`); `loadCliExtensions()` + `importTrustedExtension()` + `extensionFromModule()` + `isExtensionObject()` appended after `positiveInt`. Allow-list = exact match against comma-separated `PRISM_EXTENSION_ALLOWLIST`, evaluated **before** `import()`; relative `./`/`../` paths skip the allow-list but must `realpath`-contain inside the working directory (symlink escape rejected); absolute paths = allow-list only (no containment, per plan). Accepted shapes: `createExtension()`, default function, default `{ name, setup }`.
    - Wiring: runCli loads extensions → `options.activatedExtensions` → `agentSession()` merges `tools`/`context`/`middleware` + skills into the `createSkillRegistry` merge; extension injectors merge with `--instruction`/`--injector-file` injectors at run level (`runOptions`) so the two sources compose without double-injection. Commands are returned by `activateKernel` but the CLI has no command surface in print/json mode — left unwired (host RPC owns commands).
    - Tests: new `src/__tests__/cli-extension.test.ts`, 8 tests (repeatability + activation through `createSession` override, symlink-escape rejection via tmpdir symlink, allow-list reject/pass using `@arnilo/prism` as the importable allow-listed specifier, bad export, missing file, `--config/--resource/--tool` still rejected, help text). Existing `cli_parser_rejects_known_but_unsupported_flags_loudly` updated to drop `--extension` from the rejected set.
    - Docs: `docs/cli-rpc.md` — "does not add … extension discovery" sentence replaced with the explicit/allow-listed wording; `--extension` row in the Run/RPC flags table; new "Extension loading (`--extension`)" section with trust model + both example forms. `docs/index.md` CLI/RPC blurb mentions allow-listed `--extension` activation.
    - Verification: full core suite 1711/1711; dead-export/truth/import-hygiene/live-doc gates 15/15; docs suite 152/152.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — CLI flag now does something.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: `--extension`, `PRISM_EXTENSION_ALLOWLIST`, trust note
    - `docs/index.md` update: yes — CLI/RPC blurb currently “print/json modes, LF-delimited RPC, `prism init` scaffold, provider scaffolding.” Change to mention allow-listed `--extension` activation, still one sentence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 4 — `ingestWikiSource`: stage raw + parse extract
  - Acceptance Criteria:
    - Functional: Package function `ingestWikiSource(input, options)` in `@arnilo/prism-memory/wiki`. Requires `text` and/or `path` (or `bytes` + `filename` for in-memory uploads). Writes `raw/ingest/<utc>-<slug>/source.<ext>` (immutable original) and `extract.md` (utf8). Default `ingestRoot` is `raw` under `workspaceRoot` (Karpathy raw layer, **not** inside `.wiki/`, which `scanRawFiles` ignores). Path must `realpath`-contain in `workspaceRoot`. Parse matrix (no new deps):
      - inline `text` / `.txt` / `.md` / `.json` / `.csv` / `.html`: utf8 via existing RAG parsers or `TextDecoder`
      - `.pdf`: `pdfParser` from `@arnilo/prism-memory/rag/parsers` (uncompressed only; compressed PDF fails with a named error unless `options.extractDocument` returns text)
      - images (`.png` `.jpg` `.jpeg` `.gif` `.webp`): **no OCR**; `extract.md` is a stub that names the source file and says the model must view the image
      - unknown binary: fail closed unless `extractDocument` handles it
      - Optional `extractDocument?: (input) => Promise<{ text: string; format: string } | null>` so a host can inject `createDocumentReader().extract` for compressed PDF/DOCX without memory depending on coding-tools/office
      Returns `{ id, rawDir, sourcePath, extractPath, mediaType, extract, truncated }` and appends an `Ingested` line to `.wiki/log.md` via existing `prependLog` **only if** the wiki root already exists (do not scaffold here).
    - Performance: Byte cap default 32 MiB input / 2 MiB extract (same order as document-reader defaults); refuse over cap. Sync-ish fs write; parse bounded by RAG `maxParseMs`.
    - Code Quality: One module `ingest.ts`. Reuse `hashContent`, `prependLog`, `wikiDate`. No LLM. No network. Slug from title/filename sanitized (`[^a-z0-9-_]` → `-`, cap length).
    - Security: Path containment + reject NUL. Do not follow symlinks out of workspace (`fs.realpath`). Do not fetch URLs. Extract/log titles passed through the same single-line sanitizer as `wiki_record_insight`. Staged files mode `0o644`. No secrets in filenames.
  - Approach:
    - Documentation Reviewed:
      - Karpathy gist **Architecture** (raw immutable vs wiki vs schema) and **Ingest**
      - OKF §5.1 `sources[].resource` (bundle-relative path to the raw artifact)
      - `packages/memory/src/rag/parsers.ts`, `docs/document-reader.md`
      - `packages/memory/src/wiki/manifest.ts` ignore `.wiki`
      - `packages/memory/src/wiki/engine/okf.ts` `prependLog`
    - Options Considered:
      - Stage under `.wiki/raw/`: rejected — `.wiki` is ignored by the compiler; also mixes compiled bundle with immutable sources.
      - Stage under workspace `raw/ingest/` + utf8 `extract.md` the compiler/agent can read: chosen.
    - Chosen Approach:
      - Karpathy three layers: raw (`raw/ingest/...`), wiki (`.wiki/`), schema (SKILL + SCHEMA). This task owns only the raw layer + extract. LLM filing is Task 5–6.
    - API Notes and Examples:
      ```ts
      import { ingestWikiSource } from "@arnilo/prism-memory/wiki";

      const staged = await ingestWikiSource(
        { path: "notes/paper.pdf", title: "Paper" },
        { workspaceRoot, wikiRoot: ".wiki" },
      );
      // staged.sourcePath = "raw/ingest/2026-05-01T12-00-00Z-paper/source.pdf"
      // staged.extractPath = "raw/ingest/2026-05-01T12-00-00Z-paper/extract.md"
      ```
    - Files to Create/Edit:
      - `packages/memory/src/wiki/ingest.ts`: stage + parse
      - `packages/memory/src/wiki/types.ts`: `WikiIngestInput`, `WikiIngestResult`, optional `extractDocument` on `WikiExtensionOptions`
      - `packages/memory/src/wiki/index.ts`: export
      - `packages/memory/src/wiki/__tests__/ingest.test.ts`
    - References:
      - `packages/memory/src/rag/parsers.ts:6-11`
      - `packages/memory/src/wiki/manifest.ts:6-17`
      - `packages/prism-coding-tools/src/document-reader/index.ts` (optional host hook shape only)
  - Test Cases to Write:
    - `ingest_text_writes_source_and_extract`: inline text → both files; extract contains text.
    - `ingest_markdown_path_copies_bytes`: workspace file copied; extract utf8.
    - `ingest_pdf_uncompressed_extracts_text`: tiny uncompressed PDF fixture.
    - `ingest_image_stub_extract_no_ocr`: png bytes → extract mentions source path, does not invent body text.
    - `ingest_path_escape_rejected`: `../etc/passwd`.
    - `ingest_oversize_rejected`.
    - `ingest_unknown_binary_rejected_without_hook`.
    - `ingest_extractDocument_hook_used_for_unknown`: hook returns text → extract.md that text.
    - `ingest_missing_wiki_does_not_throw_on_log`: stage succeeds; log skip.
  - Execution notes (2026-09-09):
    - `packages/memory/src/wiki/ingest.ts`: single module, `ingestWikiSource(input, options)` + exported `ingestSlug`. Reuses `hashContent` (manifest.ts), `prependLog`/`wikiDate` (engine/okf.ts), `pdfParser` (rag/parsers.ts), `toSingleLine` sanitizer pattern from `wiki_record_insight`. Content-source precedence documented on the type: `path` > `bytes` > `text`. NUL rejected in path/filename; input path is `realpath`-contained in `realpath(workspaceRoot)` (symlink escape rejected); staged files written mode `0o644`; same-second directory collision disambiguated with an 8-char content-hash suffix.
    - Named errors reused, no new classes: `MemoryValidationError` (missing content, NUL, escape, bad utf8, unsupported format, hook returned null), `MemoryLimitError` (input cap). Built-in PDF path capped at `HARD_MAX_DOCUMENT_BYTES_CAP` (8 MiB) from `rag/limits.js` — the RAG parser rejects options above its hard cap, so a >8 MiB PDF fails with the RAG limit error unless `extractDocument` rescues it (documented `ponytail:` comment).
    - Default `ingestRoot` is `raw/ingest` (plan's example paths `raw/ingest/<utc>-<slug>/source.<ext>` are authoritative; `raw` alone would drop the ingest segment). Log append only when `.wiki/` already exists — never scaffolds.
    - Types added to `packages/memory/src/wiki/types.ts`: `WikiIngestInput`, `WikiIngestHookInput`, `WikiIngestOptions`, `WikiIngestResult`, plus optional `extractDocument` on `WikiExtensionOptions`. Exported via `packages/memory/src/wiki/index.ts` (`export * from "./ingest.js"`).
    - Tests: `packages/memory/src/wiki/__tests__/ingest.test.ts`, 13 tests — all nine planned cases plus compressed-PDF-hook, log-append-when-wiki-exists, title sanitizer/slug, requires-content. Uncompressed PDF fixture string copied from `rag.test.ts`.
    - Verification: memory suite 326/326 (3 skipped as by design); script gates (dead-export/truth/import-hygiene/live-doc) 15/15. Docs intentionally deferred to Task 7 per plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new wiki package export. Docs land with Task 7 so command/tool/CLI share one page update.
    - Docs pages to create/edit:
      - none in this task (Task 7)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 5 — `/wiki-ingest` command, tool, CLI, extension registration
  - Acceptance Criteria:
    - Functional: `createWikiIngestCommand` name `wiki-ingest`. Args `{ text?: string, path?: string, title?: string }` (`additionalProperties: false`); require `text` or `path`. `execute` calls `ingestWikiSource`, returns `CommandResult` with (1) text brief: raw paths, extract preview capped (~8 KiB), Karpathy filing checklist, (2) when source is an image, an `image` `ContentBlock` (`data` or omit if huge — prefer `metadata` path pointer; do not base64 multi-MB files into the result), (3) `metadata.trust: "untrusted_external"`. If `context.drivers?.startRun`, call `startRun(brief, { activeSkills: ["wiki-maintainer"] })` and include `{ runStarted: true }` in `value`; if drivers absent, do not throw. Register command + `wiki_ingest` tool (same function) on `createWikiExtension`. `prism-wiki ingest [--path <file>] [--title <t>] [--wiki-root] [text...]` prints id/paths, exit 0; usage error if neither text nor path. `wiki-init` / refresh / lint unchanged.
    - Performance: Command overhead is ingest I/O only. `startRun` is host-owned; do not wait on an unbounded agent loop inside the command beyond returning the driver promise (driver decides).
    - Code Quality: Command file mirrors `commands/refresh.ts`. Tool file mirrors `tools/record-insight.ts`. No duplicate staging logic.
    - Security: Same containment as Task 4. Tool `execute` uses workspace options from extension, not caller-supplied `workspaceRoot`. Preview redacts nothing extra unless a redactor is later passed; treat extract as untrusted content in the brief (label it). `startRun` input is the brief, not raw bytes.
  - Approach:
    - Documentation Reviewed:
      - `docs/wiki.md` slash commands
      - `docs/extension-authoring.md` Host driver hooks
      - `src/contracts-core/agent.ts` `CommandDrivers.startRun(input: string, options?: RunOptions)`
      - `packages/memory/src/wiki/commands/refresh.ts`, `extension.ts`
      - `packages/memory/src/wiki/cli.ts`
    - Options Considered:
      - Nested LLM inside the command: rejected — duplicates the agent, bypasses host provider/permission, expensive.
      - Stage + brief + optional `drivers.startRun` with `wiki-maintainer`: chosen — matches FEATURE-3 driver pattern from plan 050.
    - Chosen Approach:
      - Automatic filing = host agent following the ingest skill. Command always stages. CLI has no agent, so CLI is stage-only (honest). SDK hosts that inject drivers get a started run.
    - API Notes and Examples:
      ```ts
      // slash / host RPC
      await command.execute(
        { path: "clips/article.md", title: "Article" },
        { drivers: { startRun, startWorkflow, steer } },
      );

      // CLI
      // prism-wiki ingest --path clips/article.md --title Article
      ```
    - Files to Create/Edit:
      - `packages/memory/src/wiki/commands/ingest.ts`
      - `packages/memory/src/wiki/tools/ingest.ts`
      - `packages/memory/src/wiki/extension.ts`: register command + tool
      - `packages/memory/src/wiki/cli.ts`: `ingest` subcommand + help
      - `packages/memory/src/wiki/index.ts`: exports
      - `packages/memory/src/wiki/__tests__/commands.test.ts`
      - `packages/memory/src/wiki/__tests__/tools.test.ts`
      - `packages/memory/src/wiki/__tests__/cli.test.ts`
      - `packages/memory/src/wiki/__tests__/primitive-seams.test.ts`: assert `wiki-ingest` / `wiki_ingest` registered
    - References:
      - `packages/memory/src/wiki/extension.ts:17-65`
      - `packages/memory/src/wiki/commands/init.ts:65+`
      - `docs/extension-authoring.md` Host driver hooks
  - Test Cases to Write:
    - `wiki_ingest_command_stages_text_and_returns_brief`.
    - `wiki_ingest_command_requires_text_or_path`.
    - `wiki_ingest_command_without_drivers_does_not_throw`.
    - `wiki_ingest_command_with_drivers_calls_startRun_and_activeSkills_wiki_maintainer`.
    - `wiki_ingest_tool_same_staging`.
    - `extension_registers_wiki-ingest_and_wiki_ingest`.
    - `cli_ingest_path_exit_0` / `cli_ingest_no_input_nonzero`.
  - Execution notes (2026-09-09):
    - Shared glue lives in `ingest.ts` (Task 4 module, keeps staging cohesive): `ingestOptionsFrom` (extension options → ingest options so callers can never supply `workspaceRoot`), `renderIngestBrief` (paths + filing checklist + extract preview capped at 8 192 chars, labeled `UNTRUSTED EXTERNAL CONTENT`), `ingestImageBlock` (small images ≤ 256 KiB inline as base64 `image` blocks, larger stay path pointers — no multi-MB base64).
    - `commands/ingest.ts`: `createWikiIngestCommand` (name `wiki-ingest`, params `{text,path,title}`, `additionalProperties: false`, requires text or path). Await `context.drivers?.startRun(brief, { activeSkills: ["wiki-maintainer"] })` when present → `value.runStarted: true`; absent → stage-only, no throw. `metadata.trust: "untrusted_external"` + path pointer fields.
    - `tools/ingest.ts`: `createWikiIngestTool` (name `wiki_ingest`) mirrors record-insight; same staging via `ingestWikiSource`, brief returned as text content (+ image block when applicable); missing input throws `Error("Invalid input: ...")` matching record-insight convention.
    - `extension.ts`: registers both + exports `WIKI_INGEST_COMMAND_NAME`/`WIKI_INGEST_TOOL_NAME`; `wiki/index.ts` re-exports `./commands/ingest.js`. `wiki-init`/refresh/lint untouched.
    - `cli.ts`: `prism-wiki ingest [--path <file>] [--title <t>] [--wiki-root <dir>] [text...]` — stage-only (no agent in CLI, honest); prints id/original/extract, exit 0; usage error exit 1 when neither text nor path. Positionals collected into an array so multi-word text works (`query` for search stays first positional).
    - Tests: +4 commands (stage/brief, requires-input, drivers call with captured activeSkills, untrusted label), +3 tools (same staging via files, requires-input, image inline vs pointer threshold using `ingestImageBlock` directly), +2 CLI (path exit 0 with `raw/ingest/…-ingest-note` dir check, no-input nonzero), primitive-seams asserts `wiki_ingest` tool + `wiki-ingest` command registered.
    - Verification: build clean; targeted wiki suites 38/38; full memory suite 335/335 (3 skipped); script gates 15/15. Docs deferred to Task 7 per plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new command/tool/CLI verb. Page update in Task 7.
    - Docs pages to create/edit:
      - none in this task (Task 7)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 6 — Karpathy/OKF ingest instructions (skill + SCHEMA)
  - Acceptance Criteria:
    - Functional: `wiki-maintainer` SKILL.md gains an **Ingest** procedure (separate from compile/refresh). SCHEMA.md template (`renderSchema`) gains the same rules so every scaffolded wiki carries them. Procedure must tell the LLM to:
      1. Read `.wiki/SCHEMA.md` and `.wiki/index.md` first (progressive disclosure / catalog).
      2. Read `extract.md`; if image/PDF, also view/read `source.*`.
      3. Integrate into existing entity/concept/decision pages; create a page only when the concept is new.
      4. Emit OKF v0.2 frontmatter: required `type`; recommended `title`, `description`, `tags`, `sources` (`id` + `resource` pointing at the staged `source.*` path), `generated: { by: prism-wiki/ingest, at: <ISO Z> }`.
      5. Per-claim footnotes keyed to `sources[].id` when a claim is source-specific (OKF §5.1).
      6. Update `.wiki/index.md` listings (markdown links, not `[[wikilinks]]`).
      7. Prepend `.wiki/log.md`: `## YYYY-MM-DD` then `* **Ingested**: ...` (existing `prependLog` shape).
      8. Never copy the raw body into the wiki; never modify files under `raw/`.
      9. On contradiction: update the existing page and log the conflict (existing contradiction protocol).
      10. One source per ingest. Then `wiki-refresh` / `qmd update` if those tools/commands are available.
      Skill description mentions ingest (so progressive disclosure can select it). `wiki-searcher` unchanged.
    - Performance: Prompt-only; no extra tokens forced into every turn (injector stays the short wiki-awareness line).
    - Code Quality: Edit SKILL.md + `renderSchema` strings. No new skill package. Tests assert the procedure headings/keywords exist (same style as `skills.test.ts`).
    - Security: Instructions must not tell the model to follow outbound URLs from the source, execute embedded scripts, or write outside `.wiki/` and `raw/` (raw is read-only for the LLM). Injectors still cannot grant tools.
  - Approach:
    - Documentation Reviewed:
      - Karpathy gist: Ingest flow (summary page, index, entity/concept updates, log; 10–15 pages; human-in-the-loop optional); schema as the discipline file
      - OKF SPEC §§3–5, 8–9
      - `packages/memory/skills/wiki-maintainer/SKILL.md`
      - `packages/memory/src/wiki/engine/okf.ts` `renderSchema`
      - `plans/050` OKF adoption (frontmatter already compiled; ingest instructions were compile-oriented)
    - Options Considered:
      - New `wiki-ingester` skill: rejected — maintainer already owns compile/reconcile; extra skill splits one workflow.
      - Extend `wiki-maintainer` + SCHEMA: chosen.
    - Chosen Approach:
      - Schema file + skill are Karpathy’s “schema” layer. Keep OKF field names already used by `renderConceptFrontmatter`.
    - API Notes and Examples:
      ```markdown
      ### Ingest (`wiki-ingest` / `wiki_ingest`)

      You are filing one new raw source into an OKF v0.2 bundle.
      Raw files are immutable. Wiki pages are compiled knowledge.

      1. Read `.wiki/index.md`, then the staged `extract.md`.
      2. Update or create concept pages with `type`, `sources`, `generated`.
      3. `sources[].resource` = workspace-relative path to `source.*`.
      4. Update `index.md`; prepend `log.md` with **Ingested**.
      5. Do not copy the raw document into the wiki body.
      ```
    - Files to Create/Edit:
      - `packages/memory/skills/wiki-maintainer/SKILL.md`
      - `packages/memory/src/wiki/engine/okf.ts`: `renderSchema` ingest section
      - `packages/memory/src/wiki/skills.ts`: if the in-memory skill copy is generated from the file, keep in sync (or load from the file — do not fork two texts if one source already exists)
      - `packages/memory/src/wiki/__tests__/skills.test.ts`
      - `packages/memory/src/wiki/__tests__/compiler.test.ts` or scaffolder test: new wiki SCHEMA contains Ingest heading
    - References:
      - https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
      - https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
      - `packages/memory/src/wiki/engine/okf.ts:141-164`
  - Test Cases to Write:
    - `wiki_maintainer_skill_contains_ingest_procedure_and_okf_sources`.
    - `scaffold_schema_contains_ingest_and_forbids_raw_mutation`.
    - `skill_description_mentions_ingest` (discovery).
  - Execution notes (2026-09-09):
    - `packages/memory/skills/wiki-maintainer/SKILL.md`: new `### Ingest One Source (wiki-ingest / wiki_ingest)` procedure between the compile and lint sections — all ten mandated steps present (read SCHEMA+index first, read extract.md / view source.* for images+PDFs, integrate-don't-duplicate, OKF v0.2 frontmatter with `sources[].resource` → staged `source.*` and `generated: { by: prism-wiki/ingest }`, per-claim `sources[].id` footnotes, index.md markdown links, `prependLog`-shaped `**Ingested**` entry, never copy raw bodies / `raw/` read-only, contradiction protocol, one source per ingest + refresh). Security line: no URL fetching, no executing embedded content, write only inside `.wiki/`. Description already mentioned ingest — unchanged.
    - `renderSchema` (engine/okf.ts): new `## Ingest Protocol` section between OKF mapping and Formatting Conventions carrying the same rules (staging layout, catalog-first, integrate-first, frontmatter requirements, footnotes, log, raw immutability, contradiction + refresh). Every scaffolded wiki now ships the protocol.
    - `skills.ts`: fallback static `wikiMaintainerSkill` gained instruction line 6 (ingest one-source procedure) so the disk-loaded and fallback texts stay aligned; single text source remains the SKILL.md file (loaded by `loadBundledSkills`).
    - Tests: skills.test.ts +2 (`wiki_maintainer_skill_contains_ingest_procedure_and_okf_sources` asserting the procedure headings/keywords in loaded instructions; `skill_description_mentions_ingest` for both loaded skill and fallback), compiler.test.ts scaffold assertions extended (`## Ingest Protocol`, `read-only`, `sources[].resource`).
    - Verification: build clean; full memory suite 337/337 (3 skipped as by design); script gates 15/15. Docs deferred to Task 7 per plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — shipped skill/schema behavior. Page update in Task 7.
    - Docs pages to create/edit:
      - none in this task (Task 7)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 7 — Wiki + index documentation for ingest
  - Acceptance Criteria:
    - Functional: `docs/wiki.md` documents `/wiki-ingest`, `wiki_ingest`, `prism-wiki ingest`, `ingestWikiSource`, parse matrix, `extractDocument` hook, driver `startRun` behavior, Karpathy/OKF filing rules, raw vs `.wiki` layout. Page keeps the required API sections. `docs/index.md` wiki blurb one sentence, no plan number.
    - Performance: n/a (docs).
    - Code Quality: Current-contract voice (plan 068). No release recap. Examples are copy-pasteable TypeScript/bash.
    - Security: Docs state: no URL ingest, path containment, untrusted extract, allow-listed CLI extensions are Task 3’s page not this one, host must activate wiki tools for the maintainer skill’s `toolNames` if any.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API page template
      - `docs/wiki.md` current slash command list
      - `docs/index.md` Context and skills / LLM Wiki entry
    - Options Considered:
      - New `docs/wiki-ingest.md`: rejected — one wiki surface, one page.
      - Extend `docs/wiki.md`: chosen.
    - Chosen Approach:
      - Add ingest to Inputs (command/tool/CLI/function tables), example JSON, security notes. Update architecture to mention `raw/ingest/` as the drop folder.
    - API Notes and Examples:
      ```bash
      prism-wiki ingest --path notes/paper.pdf --title "Paper"
      ```
      ```json
      { "text": "Ship wiki-ingest to PKM vaults.", "title": "Product note" }
      ```
    - Files to Create/Edit:
      - `docs/wiki.md`
      - `docs/index.md` (wiki blurb)
    - References:
      - `docs/wiki.md`
      - `.agents/skills/create-plan/references/prism-wiki.md`
  - Test Cases to Write:
    - none (docs). Existing doc-structure tests if the repo has them — do not add a docs test unless one already fails.
  - Execution notes (2026-09-09):
    - `docs/wiki.md` (existing section set preserved, required API sections intact):
      - Architecture tier 1 now names the `raw/ingest/<utc>-<slug>/` staging area (`source.*` + `extract.md`).
      - Tools list gains `wiki_ingest` (`{text?, path?, title?}`, exactly one of text/path).
      - Slash Commands gain `/wiki-ingest`: staging + brief + `metadata.trust: "untrusted_external"`; `drivers.startRun(brief, { activeSkills: ["wiki-maintainer"] })` when host injects drivers, stage-only with `runStarted: false` otherwise.
      - Standalone CLI block gains `npx prism-wiki ingest --path notes/paper.pdf --title "Paper"`.
      - Outputs gains `### ingestWikiSource(input, options)` — inputs precedence, full parse matrix (UTF-8 text/markdown/html; uncompressed PDF via RAG parser; compressed PDF/DOCX via host `extractDocument` e.g. `createDocumentReader()`; images stub-extract no OCR; unknown binary fails closed), 32 MiB / 2 MiB caps, realpath containment, log entry only when wiki root exists. Plus a `wiki_ingest` output bullet (paths, preview, `runStarted`).
      - New `## Ingest filing rules (Karpathy/OKF)` section: catalog-first, integrate-don't-duplicate, OKF v0.2 frontmatter + `sources[].id` footnotes, index/log sync, raw immutability, one source per ingest, contradiction protocol, SCHEMA.md `## Ingest Protocol` mirror.
      - Extension notes registration list now includes `wiki_ingest` + `wiki-ingest`.
      - Security notes gain `Ingest boundaries` bullet: no URL ingest (SSRF), workspace-root realpath containment, untrusted-extract labeling, raw layer read-only, no OCR. Existing bullets (immutability, subprocess safety, containment, token budget) untouched.
    - `docs/index.md`: LLM Wiki entry now "optional knowledge compiler emitting OKF bundles, with `/wiki-ingest` raw staging and on-device hybrid search" (one sentence, no plan number).
    - Verification: docs suite 152/152; core 1711/1711; memory 337/337. Three unrelated root-suite failures (budget-gate export ceiling, biome lint run, phase54 package-map evidence) reproduce with the working tree stashed — pre-existing, not from this task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents Tasks 4–6.
    - Docs pages to create/edit:
      - `docs/wiki.md`: ingest API
    - `docs/index.md` update: yes — LLM Wiki entry becomes: optional knowledge compiler emitting OKF bundles, with `/wiki-ingest` raw staging and on-device hybrid search.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 8 — Primitive review (URL ingest + graft CLI commands)
  - Acceptance Criteria:
    - Functional: Inventory existing primitives and record, per gap, reuse vs reject vs one new helper. Confirm: wiki does not import `@arnilo/prism-web-tools`; Graft `--deep` is Graft's LLM client (not Prism `Provider`); `providerEnv` already forwards `GRAFT_*`; `graft-build` already exists with `deep:true`; `graft-init` / `graft-build-deep` commands do not exist; `runGraftJson` JSON-parses stdout (real `graft build`/`graft init` are not JSON).
    - Performance: Static review only.
    - Code Quality: Decisions name exact file:line spans. New code allowed later is only `fetchUrl` (wiki host hook, same shape as `extractDocument`) + `runGraftExit` (non-JSON CLI runner) + typed `deepModel` + three command aliases.
    - Security: URL ingest uses `assertSsrfAllowedUrl` then a host hook (no `fetch` in memory). Graft children still get a fixed-base env (no host-secret inheritance). Deep API key never appears on argv. `graft init` never writes `~/.codex` (`--no-global`). Command argv is host-fixed, not model-supplied.
  - Approach:
    - Documentation Reviewed:
      - Graft README "What runs where" + `.env.example`: https://github.com/trailhq/Graft / https://github.com/NanoNets/Graft/blob/main/.env.example — structural `graft build` is tree-sitter, `$0`, no key; `graft build --deep` calls the host's provider via `GRAFT_PROVIDER` (`openai`|`anthropic`|`litellm`|`orcarouter`), `GRAFT_API_KEY`, `GRAFT_MODEL`, optional `GRAFT_BASE_URL`, or `--provider/--model/--api-key/--base-url`.
      - Graft `init` is TTY-interactive; without TTY it writes nothing unless `--agents` / `--yes`. Flags: `--no-mcp`, `--no-hooks`, `--no-statusline`, `--no-global`, `--no-agents` (Claude Code wiring only).
      - `docs/wiki.md` ingest matrix + "no URL ingest" security bullet (Task 7).
      - `docs/graft.md` commands list (`graft`, `graft-build`, `graft-check`, `graft-viz`) + `providerEnv`.
      - `docs/obscura.md` `createObscuraWebTools` → `web_fetch` via `obscura fetch URL --dump markdown`; `runObscuraCli` + `validateObscuraWebUrl` already exported.
      - `src/content.ts` `assertSsrfAllowedUrl` (http(s), no credentials, deny private hosts).
      - `packages/memory/src/wiki/types.ts` `extractDocument` hook; `WikiIngestInput` is `path` > `bytes` > `text`.
      - `packages/memory/src/graft/types.ts:34-35` `providerEnv` (only `GRAFT_*` keys).
      - `packages/memory/src/graft/cli.ts:18-30` `childEnv`; `:67-160` `runGraftJson` (`JSON.parse` on close).
      - `packages/memory/src/graft/commands.ts:99-105` `handleBuild` (`deep:true` → `--deep`); `:126-180` registered names: `graft`, `graft-build`, `graft-check`, `graft-viz`. No `graft-init`.
      - `packages/memory/src/graft/cli.ts` `DEFAULT_RETRIEVAL_BUDGET_MS = 8000` — too short for `--deep`.
    - Options Considered:
      - Wiki ships `fetch` / depends on `@arnilo/prism-web-tools`: rejected — user constraint; SSRF + browser stack do not belong in memory.
      - Agent calls `web_fetch` then `/wiki-ingest` with the markdown: rejected as the only path — `/wiki-ingest {url}` should work when the host wired a hook.
      - `fetchUrl` host hook (mirror `extractDocument`): chosen.
      - Plug Prism `AgentConfig.provider` into Graft `--deep`: rejected — Graft speaks OpenAI-compatible / native Anthropic chat completions for file summaries; Prism Provider is a streaming agent-turn protocol with tools. A leaky adapter would be worse than env passthrough.
      - New typed `deepModel` + existing `providerEnv`: chosen. Host copies keys if they want the same vendor as the agent.
      - Reuse `runGraftJson` for `init`/`build`: rejected — real CLI prints progress text; parse-error would fail a successful build. Fixture currently JSON-stubs the default branch, which hides this.
    - Chosen Approach:
      - URL ingest = `url` field + `fetchUrl` hook. Wiki calls `assertSsrfAllowedUrl` then the hook. No wiki→web-tools import. Host wires Obscura with already-exported `runObscuraCli` / `validateObscuraWebUrl` (or any other fetch). Standalone `prism-wiki` CLI does not grow a fetch client.
      - Graft commands wrap CLI. Add `runGraftExit` (exit 0 = ok, no JSON). `/graft-build-deep` requires `deepModel` or `GRAFT_{PROVIDER,MODEL,API_KEY}` in `providerEnv`. Key stays in env. Init is non-interactive (`--no-global` always; `--no-mcp --no-hooks --no-statusline` default on because Prism already provides those surfaces) and requires host `initAgents` or `initYes` (no TTY).
    - API Notes and Examples:
      ```ts
      createWikiExtension({
        fetchUrl: async ({ url }) => {
          const run = await runObscuraCli({ command: "obscura", args: ["fetch", url, "--dump", "markdown"] });
          return { text: run.stdout, filename: "source.md" };
        },
      });

      createGraftExtension({
        deepModel: { provider: "openai", model: "gpt-4o-mini", apiKey, baseUrl: "https://openrouter.ai/api/v1" },
        initAgents: ["agents"], // or initYes: true
        appendEntry, getEntries,
      });
      ```
    - Files to Create/Edit:
      - none (inventory only; decisions live in this plan)
    - References:
      - https://github.com/trailhq/Graft README "What runs where", CLI, init flags
      - https://github.com/NanoNets/Graft/blob/main/.env.example
      - `packages/memory/src/graft/cli.ts:13-30`, `:67-160`
      - `packages/memory/src/graft/commands.ts:99-180`
      - `packages/web-tools/src/obscura/web.ts:40-231`
      - `src/content.ts:220-258`
  - Test Cases to Write:
    - none (inventory). Execution notes record the confirmed spans.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (review only).
    - Docs pages to create/edit:
      - none with reason: inventory; docs land in Task 11.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Execution notes (2026-09-09, all spans re-verified against working tree):
    - **Wiki has zero web surface (confirmed clean).** No import of `@arnilo/prism-web-tools`, `node:http(s)`, or `fetch(` anywhere in `packages/memory/src/wiki/` or `packages/memory/package.json`. URL ingest must be a host hook; Task 9 unchanged.
    - **Hook precedent confirmed.** `extractDocument` at `packages/memory/src/wiki/types.ts:100` (`WikiExtensionOptions`) and `:137` (`WikiIngestOptions`); `WikiIngestHookInput` at `:117-118`. `fetchUrl` mirrors this shape exactly — no new injection pattern.
    - **Ingest precedence confirmed.** `packages/memory/src/wiki/ingest.ts:118` requires one of path/bytes/text; branch order `path` `:128` > `bytes` `:140` > `text` `:147`. `url` slots between `bytes` and `text` in Task 9.
    - **SSRF guard exists.** `assertSsrfAllowedUrl` at `src/content.ts:220`: http(s) only, rejects embedded credentials, denies private/metadata hosts. Throws `MediaContentError`; Task 9 maps it to the wiki's `MemoryValidationError` at the command boundary.
    - **Obscura building blocks already exported.** `runObscuraCli` `packages/web-tools/src/obscura/cli.ts:65`, `validateObscuraWebUrl` `:126`, `createObscuraWebTools` (`web.ts`, registers `web_fetch` = `obscura fetch URL --dump markdown`). Host glue is ~4 lines; no `fetchObscuraMarkdown` helper needed in web-tools (Further Actions stays optional).
    - **Graft `--deep` is Graft's LLM client, not Prism's Provider (confirmed).** Upstream README + `.env.example`: `GRAFT_PROVIDER` / `GRAFT_API_KEY` / `GRAFT_MODEL` / optional `GRAFT_BASE_URL`, or `--provider/--model/--api-key/--base-url` argv. Prism `Provider` is a streaming agent-turn protocol with tools — adapter rejected, stands.
    - **providerEnv plumbing exists — `deepModel` only fills four keys.** `ChildEnvOptions.providerEnv` `packages/memory/src/graft/types.ts:7`; `GraftExtensionOptions.providerEnv` `:35` with doc "Never inherited from the host process env" `:34`; allow-list regex `/^GRAFT_[A-Z0-9_]+$/` at `packages/memory/src/graft/cli.ts:27`; fixed base env with `DO_NOT_TRACK=1` default at `:15-30`.
    - **Commands today.** `handleBuild` `packages/memory/src/graft/commands.ts:99-105` maps `deep:true` → `--deep` (`:100`); registered: `graft` (`:128`, subcommands status/build/check/viz), `graft-build` alias (`:172-173`), `graft-check`, `graft-viz`. `graft-init` / `graft-build-deep` do not exist (rg clean).
    - **`runGraftJson` JSON-parses stdout** at `packages/memory/src/graft/cli.ts:152` (`JSON.parse(raw)`, parse failure → `parse-error` even on exit 0). Real `graft build` / `graft init` print human-readable progress → successful run would be misreported. Fixture `bin/graft.mjs` has no `build`/`init` case — falls to `default: send({ stub: true })` JSON, which hid this. Task 10 adds `runGraftExit` (exit 0 = ok, no parse) and grows the fixture with argv/env echo cases.
    - **Budgets.** `DEFAULT_RETRIEVAL_BUDGET_MS = 8000` at `cli.ts:9` — far too short for `--deep` (LLM over the whole graph). Task 10's `buildBudgetMs` (120_000) / `deepBuildBudgetMs` (600_000) confirmed necessary; ask/grep/check stay on 8000.
    - **Init is TTY-interactive upstream.** No TTY → writes nothing unless `--agents` / `--yes`; `--no-global` avoids user-level writes. Prism child has no TTY → host must pass `initAgents` or `initYes`, else the command errors without spawning (fail closed). `--no-mcp --no-hooks --no-statusline` default-on because Prism already provides those surfaces.
    - **Verdict: Tasks 9–11 are buildable as written.** No plan changes needed. One clarification folded into Task 9 text: `assertSsrfAllowedUrl` error type is `MediaContentError` — wiki maps to `MemoryValidationError` at its boundary.

- [x] Task 9 — URL ingest via host `fetchUrl` hook
  - Acceptance Criteria:
    - Functional: `WikiIngestInput.url` accepted. Precedence for the function stays `path` > `bytes` > `url` > `text`; command/tool require **exactly one** of `text`/`path`/`url`. `ingestWikiSource` calls `assertSsrfAllowedUrl(url)` then `options.fetchUrl({ url })`. Missing hook → `MemoryValidationError` naming `fetchUrl`. Hook `null` → fail closed. Returned `text`/`bytes` go through the existing parse matrix + caps. Result includes `url` when staged from a URL. Command/tool gain `url` arg; brief lists the source URL; `metadata.trust: "untrusted_external"` unchanged; `startRun` behavior unchanged. `prism-wiki ingest --url` is a usage error (CLI has no hook). Wiki package does not import web-tools, does not call `fetch`, does not add a HTTP client.
    - Performance: same 32 MiB / 2 MiB caps; hook may enforce its own (Obscura `maxOutputBytes`). No extra every-turn tokens.
    - Code Quality: Reuse `extractDocument` injection pattern. One hook, no fetcher interface hierarchy. SKILL/SCHEMA: user-supplied URL is a valid ingest source; the model still must not fetch URLs *found inside* a source.
    - Security: `assertSsrfAllowedUrl` before the hook (http(s), no credentials, deny private/metadata hosts). Hook owns DNS-pinning / browser SSRF (Obscura already does). Redirects are the hook's problem. Extract remains untrusted. No URL in standalone CLI.
  - Approach:
    - Documentation Reviewed:
      - Task 8 findings; `packages/memory/src/wiki/ingest.ts` `ingestWikiSource`; `commands/ingest.ts` `ingestInput`; `tools/ingest.ts`; `docs/wiki.md` ingest matrix; `docs/obscura.md` `web_fetch`.
    - Options Considered:
      - Depend on web-tools from memory: rejected.
      - New `fetchObscuraMarkdown` helper in web-tools: rejected as required work — `runObscuraCli` is already exported. Hosts copy the 4-line wiring from docs.
      - `fetchUrl` on `WikiExtensionOptions` / `WikiIngestOptions`: chosen.
    - Chosen Approach:
      - Mirror `extractDocument`. Stage fetched bytes/text as `source.md` (or hook `filename`). Brief + `WikiIngestResult.url`. Maintainer skill: `sources[].resource` may be the original URL.
    - API Notes and Examples:
      ```json
      { "url": "https://example.com/rfc.pdf", "title": "RFC" }
      ```
      ```ts
      import { assertSsrfAllowedUrl } from "@arnilo/prism";
      import { runObscuraCli, validateObscuraWebUrl } from "@arnilo/prism-web-tools/obscura";

      const fetchUrl = async ({ url }: { url: string }) => {
        validateObscuraWebUrl(url); // or assertSsrfAllowedUrl — wiki already calls the latter
        const run = await runObscuraCli({ command: "obscura", args: ["fetch", url, "--dump", "markdown"] });
        return { text: run.stdout, filename: "source.md" };
      };
      ```
    - Files to Create/Edit:
      - `packages/memory/src/wiki/types.ts`: `url?` on input/result; `fetchUrl?` on options + `WikiExtensionOptions`.
      - `packages/memory/src/wiki/ingest.ts`: URL branch + SSRF + hook.
      - `packages/memory/src/wiki/commands/ingest.ts`, `tools/ingest.ts`, `cli.ts`: `url` arg; CLI `--url` usage-error.
      - `packages/memory/skills/wiki-maintainer/SKILL.md` + `engine/okf.ts` `renderSchema`: URL is a valid *user-supplied* source; still do not fetch URLs found in the body.
      - `packages/memory/src/wiki/__tests__/ingest.test.ts`, `commands.test.ts`, `tools.test.ts`, `cli.test.ts`.
    - References:
      - `packages/memory/src/wiki/types.ts:100-138` (`extractDocument` precedent)
      - `src/content.ts:220-258` (`assertSsrfAllowedUrl`)
      - `packages/web-tools/src/obscura/cli.ts` (`runObscuraCli`, `validateObscuraWebUrl`)
  - Test Cases to Write:
    - `ingest_url_without_hook_fails_closed`.
    - `ingest_url_ssrf_private_host_rejected` (before hook).
    - `ingest_url_hook_stages_markdown_and_records_url`.
    - `ingest_url_hook_null_fails_closed`.
    - `wiki_ingest_command_url_requires_exactly_one_source`.
    - `cli_ingest_url_usage_error`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new ingest input + host hook.
    - Docs pages to create/edit:
      - `docs/wiki.md`: Task 11.
    - `docs/index.md` update: no in this task (Task 11).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Execution notes (2026-09-09):
    - **Types** (`packages/memory/src/wiki/types.ts`): `WikiIngestInput.url`; `WikiIngestResult.url` (present only for URL-staged sources); `WikiIngestUrlHookInput { url }` (doc: already SSR-checked); `WikiIngestFetch { text?, bytes?, filename? }`; `fetchUrl` on both `WikiExtensionOptions` and `WikiIngestOptions`. Types flow through the existing `export * from "./types.js"`.
    - **Engine** (`ingest.ts`): precedence now `path` > `bytes` > `url` > `text`. URL branch: `assertSsrfAllowedUrl` first (wrapped as `MemoryValidationError` with the machine code, e.g. `ingest url rejected (ssrf_denied): …`); missing hook → `MemoryValidationError` naming `fetchUrl`; hook `null`/empty → fail closed. Staged filename = hook `filename` > URL pathname extension (`doc.pdf`) > `source.md`. Default title = decoded URL pathname basename sans extension, else hostname (tolerant of malformed URLs — SSRF check reports those). Result carries `url`; brief gains a `Source URL:` line; `ingestOptionsFrom` forwards `fetchUrl`. No HTTP client, no web-tools import (verified by import-hygiene gate).
    - **Command + tool**: `url` string/uri parameter added; validation is now *exactly one* of `text`/`path`/`url` (error `/requires exactly one of text, path, or url/`). Trust metadata, `startRun`, image block unchanged.
    - **CLI**: `--url` parses but fails loudly with exit 1 — "requires a host fetchUrl hook — the standalone CLI does not fetch. Use --path or text."
    - **Skill/schema**: `SKILL.md` ingest security line now reads "a `url` source is legitimate only because the host fetched it before staging (its `fetchUrl` hook)"; `renderSchema` Ingest Protocol gained the same line; fallback `wikiMaintainerSkill` instruction 6 synced.
    - **Tests**: 4 new in `ingest.test.ts` (`ingest_url_without_hook_fails_closed`, `ingest_url_ssrf_private_host_rejected_before_hook` — hook throws if reached, `ingest_url_hook_stages_markdown_and_records_url` incl. URL-derived title/slug, `ingest_url_hook_null_fails_closed`), `wiki_ingest_command_requires_exactly_one_source`, `wiki_ingest_tool_requires_exactly_one_source` (renamed from the `text_or_path` pair), `cli_ingest_url_usage_error`. Two pre-existing assertions updated to the new exactly-one message.
    - **Verification**: wiki suites 45/45; full memory suite 334 pass / 0 fail / 3 skipped (pre-existing skips); root build clean; tooling gates (dead-export-verify, truth-current, import-hygiene, live-doc-check, packaging-current) 49/49.

- [x] Task 10 — `/graft-init`, `/graft-build`, `/graft-build-deep`
  - Acceptance Criteria:
    - Functional: Register `graft-init` and `graft-build-deep` (keep existing `graft-build`). `/graft-init` runs `graft init` with host-fixed argv: always `--no-global`; default `--no-mcp --no-hooks --no-statusline`; plus `--agents <ids…>` and/or `--yes` from `GraftExtensionOptions.initAgents` / `initYes`. If neither `initAgents` nor `initYes`, command returns an error (child has no TTY — upstream writes nothing). `/graft-build` runs `graft build` (no key). `/graft-build-deep` runs `graft build --deep --provider <> --model <> [--base-url <>]` with `GRAFT_API_KEY` (and the same provider/model/base URL) in child env. Missing deep settings → error, no spawn. Existing `graft { text: "build", deep: true }` keeps working and uses the same deep path. `runGraftExit` treats exit 0 as success without `JSON.parse`. Deep timeout uses `deepBuildBudgetMs` (default 600_000), structural build uses `buildBudgetMs` (default 120_000); ask/grep stay on `retrievalBudgetMs` (8000).
    - Performance: Deep budget is opt-in and only on those commands. Stdout cap for build/init defaults to 2 MiB (`buildMaxResultBytes`); overflow still kill-and-discard.
    - Code Quality: No new package. Typed `deepModel?: { provider: "openai" | "anthropic" | "litellm" | "orcarouter"; model: string; apiKey: string; baseUrl?: string }` maps onto existing `childEnv` `GRAFT_*` allow-list. Do not invent a Prism→Graft Provider adapter. Command parameters do not accept provider/key (secrets stay out of transcripts). Fixture stub grows `init`/`build` cases that echo argv + env keys (not secret values in assertions — assert presence).
    - Security: Fixed-base child env unchanged (no host env inheritance). API key never on argv (`ps` / logs). `--no-global` always. Model cannot pass extra init flags. `DO_NOT_TRACK=1` default stays. Errors redacted via existing `redactPaths`.
  - Approach:
    - Documentation Reviewed:
      - Task 8 findings; Graft README init/CLI; `.env.example`; `docs/graft.md`; `packages/memory/src/graft/commands.ts`, `cli.ts`, `types.ts`.
    - Options Considered:
      - Let the command accept `--provider/--model/--api-key` from the model: rejected (key in transcript).
      - Drive `--deep` through Prism `createAgent({ provider, model })`: rejected (protocol mismatch).
      - Host `deepModel` + `providerEnv` passthrough: chosen. `deepModel` fills the four `GRAFT_*` keys (wins on conflict).
      - Keep `runGraftJson` for build: rejected against the real CLI.
    - Chosen Approach:
      - `runGraftExit` next to `runGraftJson`. Init/build use it. Tools/check stay JSON. Host configures model once on `createGraftExtension`.
    - API Notes and Examples:
      ```ts
      createGraftExtension({
        deepModel: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          apiKey: process.env.ANTHROPIC_API_KEY!,
        },
        initAgents: ["agents"],
        buildBudgetMs: 120_000,
        deepBuildBudgetMs: 600_000,
        appendEntry, getEntries,
      });
      // /graft-build-deep → argv: build --deep --provider anthropic --model claude-sonnet-4-5
      // env: GRAFT_PROVIDER, GRAFT_MODEL, GRAFT_API_KEY  (no --api-key flag)
      ```
    - Files to Create/Edit:
      - `packages/memory/src/graft/cli.ts`: `runGraftExit`.
      - `packages/memory/src/graft/types.ts`: `GraftDeepModel`, `initAgents`, `initYes`, `initWireMcp?`, `buildBudgetMs`, `deepBuildBudgetMs`, `buildMaxResultBytes`.
      - `packages/memory/src/graft/extension.ts`: map `deepModel` → `providerEnv`.
      - `packages/memory/src/graft/commands.ts`: `handleInit`, `graft-init`, `graft-build-deep`; build uses `runGraftExit` + budgets.
      - `packages/memory/src/graft/__tests__/commands.test.ts` + fixture `graft.mjs` (`init`/`build` echo argv).
      - `packages/memory/src/graft/__tests__/cli.test.ts` or env test: `deepModel` sets `GRAFT_*`; non-`GRAFT_*` still dropped; api key absent from argv.
    - References:
      - Graft `.env.example` (`GRAFT_PROVIDER` / `GRAFT_API_KEY` / `GRAFT_MODEL` / `GRAFT_BASE_URL`)
      - `packages/memory/src/graft/cli.ts:13-30` (`childEnv` allow-list)
      - `packages/memory/src/graft/commands.ts:99-180`
      - `packages/memory/fixtures/graft-package-fixture/bin/graft.mjs`
  - Test Cases to Write:
    - `graft_init_without_agents_or_yes_errors_without_spawn`.
    - `graft_init_passes_no_global_and_host_agents`.
    - `graft_build_uses_runGraftExit_and_does_not_require_json` (fixture prints plain text, exit 0).
    - `graft_build_deep_without_model_fails_closed`.
    - `graft_build_deep_passes_provider_model_baseurl_argv_and_api_key_env_only`.
    - `graft_build_deep_does_not_inherit_process_env_secrets`.
    - `registers_graft_init_and_graft_build_deep`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new commands + `deepModel` / init options.
    - Docs pages to create/edit:
      - `docs/graft.md`: Task 11.
    - `docs/index.md` update: no in this task (Task 11).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Execution notes (2026-09-09):
    - **`runGraftExit`** (`graft/cli.ts`): spawn/collect core extracted into private `runGraftProcess` (shared by `runGraftJson` and `runGraftExit` — no duplicated spawn logic). `runGraftJson` semantics preserved exactly (non-zero exit + valid JSON still returns `ok:false, value` for stale `check`). `runGraftExit` = exit 0 is success, stdout returned raw (no JSON.parse — real `build`/`init` print progress text), failure detail redacted via `redactPaths`. New defaults alongside the existing ones: `DEFAULT_BUILD_BUDGET_MS = 120_000`, `DEFAULT_DEEP_BUILD_BUDGET_MS = 600_000`, `DEFAULT_BUILD_MAX_RESULT_BYTES = 2 MiB`.
    - **Types** (`graft/types.ts`): `GraftDeepProvider` (`openai|anthropic|litellm|orcarouter`), `GraftDeepModel { provider, model, apiKey, baseUrl? }`, and options `deepModel`, `initAgents`, `initYes`, `initWireMcp` (default false), `buildBudgetMs`, `deepBuildBudgetMs`, `buildMaxResultBytes`.
    - **Env merge** (`graft/extension.ts` `deepProviderEnv(deepModel, providerEnv)`): filters both to `GRAFT_*`, deepModel wins on conflict; `resolveExtension` feeds it through the existing `childEnv` fixed-base allow-list and returns `buildTimeoutMs`/`deepBuildTimeoutMs`/`buildMaxResultBytes`/`init {agents, yes, wireMcp}` for the command context. Exported from `graft/index.ts` with `runGraftExit` + the new types.
    - **Commands** (`graft/commands.ts`): `handleBuild` reworked — `deep:true` requires `GRAFT_PROVIDER`/`GRAFT_MODEL`/`GRAFT_API_KEY` in the child env (from deepModel or providerEnv) or errors before spawn; argv is `build --deep --provider <> --model <> [--base-url <>]` — **never `--api-key`**; deep uses `deepBuildTimeoutMs`, structural uses `buildTimeoutMs`, both capped at `buildMaxResultBytes`; success text one line, bounded stdout tail (last 2000 chars) in `value`. New `handleInit`: refuses to spawn without `initAgents`/`initYes` (child has no TTY); argv always `init --no-global`, default `--no-mcp --no-hooks --no-statusline` (opt-out via `initWireMcp`), then `--agents <id>` per host agent and `--yes`. Registered `graft-init` and `graft-build-deep` aliases; main `graft` command gains the `init` subcommand and `build deep:true` shares the deep path. Command parameters accept no provider/key — secrets stay out of transcripts.
    - **Fixture** (`bin/graft.mjs`): `init` and `build` cases print plain text (exercising `runGraftExit`); deep build exits 3 without `GRAFT_PROVIDER/MODEL/API_KEY`; argv + `GRAFT_*` key *names* echoed (never values, so tests assert presence, not secrets).
    - **Tests**: 7 new in `graft/__tests__/commands.test.ts` — registration, init-without-config fails closed, init argv (`--no-global` + `--no-mcp --no-hooks --no-statusline` + `--agents codex`, no `--yes`), structural build via plain-text output (proves no JSON.parse), deep-without-model fails closed, deep argv/env echo via both the alias and main `deep:true` (asserts no `--api-key`, no key value in stdout), and a `childEnv`+`deepProviderEnv` unit test proving process-env secrets (`GRAFT_API_KEY`, `SECRET_SENTINEL`) never leak into the child env.
    - **Verification**: graft suites 58/58 (commands/tools/injector/upstream/edit-watch); full memory suite 342 tests / 339 pass / 0 fail / 3 pre-existing skips; root build clean; tooling gates 49/49.

- [x] Task 11 — Docs for URL ingest + graft CLI commands
  - Acceptance Criteria:
    - Functional: `docs/wiki.md` documents `{ url }`, `fetchUrl` hook, Obscura wiring example, SSRF, CLI `--url` usage error; required API sections stay. `docs/graft.md` documents `/graft-init`, `/graft-build`, `/graft-build-deep`, `deepModel`, budgets, "Prism Provider is not Graft's LLM", `--no-global`. `docs/index.md` one-sentence blurbs, no plan numbers.
    - Performance: n/a (docs).
    - Code Quality: Current-contract voice (plan 068). Copy-pasteable TypeScript. No release recap.
    - Security: Docs state: wiki does not fetch; hook + `assertSsrfAllowedUrl`; untrusted extract; graft key via `deepModel`/`providerEnv` never inherited; key not on argv; init never writes user-level Codex unless host opts into global (we don't).
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`
      - `docs/wiki.md`, `docs/graft.md`, `docs/index.md`, `docs/obscura.md`
    - Options Considered:
      - New pages: rejected — one wiki surface, one graft surface.
      - Extend existing pages: chosen.
    - Chosen Approach:
      - Patch ingest tables + graft command list + implementation examples.
    - API Notes and Examples:
      ```bash
      # structural, no key
      # (slash) /graft-build
      # deep, host-configured model
      # (slash) /graft-build-deep
      ```
    - Files to Create/Edit:
      - `docs/wiki.md`
      - `docs/graft.md`
      - `docs/index.md` (wiki + graft blurbs)
    - References:
      - `docs/wiki.md`, `docs/graft.md`, `docs/obscura.md`
  - Test Cases to Write:
    - none (docs). Existing docs suite must still pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents Tasks 9–10.
    - Docs pages to create/edit:
      - `docs/wiki.md`: URL ingest + `fetchUrl`
      - `docs/graft.md`: init / build / build-deep + `deepModel`
    - `docs/index.md` update: yes — wiki blurb mentions URL ingest via host fetch; graft blurb mentions init/build/deep CLI commands.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Execution notes (2026-09-09):
    - **`docs/wiki.md`**: `wiki_ingest` tool + `/wiki-ingest` rows now list `url?` with exactly-one-of `text`/`path`/`url`; CLI block shows the `--url` usage error (exit 1, wiki never fetches); `ingestWikiSource` section states the new precedence (`path > bytes > url > text`), adds an `url` row to the parse table (SSRF check first, missing/empty hook output fails closed, filename from hook > URL extension > `source.md`), and gained a 9-line Obscura `fetchUrl` wiring snippet (`runObscuraCli` + `validateObscuraWebUrl` — no web-tools dependency in memory). Filing-rules section notes URL sources are legitimate user-supplied origins for `sources[].resource`. Security bullet rewritten: host hook + `assertSsrfAllowedUrl` before it, untrusted extract, CLI `--url` rejection. All required API sections (What/When/Inputs/Outputs/Example/Implementation/Extension/Security/Related) intact.
    - **`docs/graft.md`**: commands list + registered-commands line include `graft-init` and `graft-build-deep`; new "Graph builds and init" subsection documents `/graft-build` (structural, no key, plain-text), `/graft-build-deep` (argv, env-only key, errors before spawn unconfigured), `/graft-init` (`--no-global` always, `--no-mcp --no-hooks --no-statusline` default, requires `initAgents`/`initYes`); options table gains `deepModel` (with the "Prism's Provider is not Graft's LLM" note), `initAgents`/`initYes`/`initWireMcp`, and `buildBudgetMs`/`deepBuildBudgetMs`/`buildMaxResultBytes`; exports table gains `runGraftExit` + `deepProviderEnv`; implementation example shows `deepModel` + `initAgents` wiring; security notes: key env-only (never argv → no `ps`/log leak), separate build budgets, `--no-global` / no user-level state.
    - **`docs/index.md`**: wiki blurb — "text, file, image, or URL via a host `fetchUrl` hook"; graft blurb — init/build/build-deep commands + host-configured `deepModel`. No plan numbers.
    - **Verification**: docs suite 152/152; tooling gates (dead-export-verify, truth-current, import-hygiene, live-doc-check, packaging-current) 49/49. No code changed.

## Compromises Made

- No marketplace, plugin manifest, or `npm i` auto-activation. CLI loads only cwd-relative modules or `PRISM_EXTENSION_ALLOWLIST` specifiers.
- No MCP auto-start from an extension package (existing `@arnilo/prism-mcp` stays host-wired).
- No `CommandExecutionContext.attachments` primitive. Ingest takes `text` / `path` / optional in-memory `bytes` / `url`.
- No nested LLM in `/wiki-ingest`. Filing is the maintainer skill; `startRun` only when the host injects drivers. `prism-wiki ingest` is stage-only.
- No OCR. Images stage + stub extract; model must view the file.
- Compressed PDF / DOCX not a memory dependency. Host may pass `extractDocument` (e.g. `createDocumentReader()`).
- Wiki package does not fetch. URL ingest is a host `fetchUrl` hook (Obscura or otherwise). Standalone `prism-wiki ingest --url` is a usage error.
- Prism does not adapt its streaming `Provider` into Graft `--deep`. Host passes Graft's own `deepModel` / `GRAFT_*`. Structural `graft build` stays keyless.
- `graft init` is non-interactive in Prism (no TTY): requires host `initAgents` or `initYes`; always `--no-global`.
- `activateKernel` does not auto-pick single-slot builders or providers.

## Further Actions

- Fill `--wiki-root`/`--workspace-root` defaults in the `prism-wiki ingest` CLI (currently explicit; other subcommands share the pattern). Low priority.
- `extractDocument` / `fetchUrl` host wiring examples are documented but no shipped host does them yet — add to a future host template. Medium priority.
- Optional `fetchObscuraMarkdown` helper in web-tools if hosts keep copying the 4-line `runObscuraCli` glue. Low priority; `runObscuraCli` already exported.
- If Graft later adds `build --json`, `runGraftExit` can stay (exit 0 is enough). Do not wait on it.
- Three pre-existing root-suite failures unrelated to this plan (budget-gate export ceiling, biome lint diagnostics, phase54 package-map evidence regeneration) should be triaged separately. Medium priority.
- If multi-file ingest demand appears (one message, many sources), add a repeatable CLI flag rather than widening the command schema. Low priority, not requested.
