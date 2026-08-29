# 049 — Template Gallery: `prism init --template` (Deep Research First)

Adoption-list item #10 (Mastra `create-mastra --template deep-search`, LangGraph templates).
Roadmap phase: **0.3.x**.
Baseline: `@arnilo/prism` **0.3.0**+; `templates/init` and `templates/provider` scaffolds exist; `src/cli-init.ts` owns scaffolding.

## Objectives

- Add a `--template` flag to `prism init` selecting an opinionated, runnable starting project from a template gallery living in `templates/`.
- Ship one flagship template first — `deep-research` — exercising the most seams in one demo: web-tools search/fetch, browser automation optional, workflows with bounded refinement, RAG citations, HITL clarify, budget caps, and an offline mock test.
- Every template must pass the same bar as `templates/init`: offline `npm test` green with the mock provider, compile-checked, no secrets.

## Expected Outcome

- `npx --package @arnilo/prism prism init my-research --template deep-research` scaffolds a project whose agent does plan → search → extract → refine (bounded loop) → cite → deliver, with an offline mock test and a README mapping each component to its Prism doc page.
- Template registry is data-only (manifest in `templates/`), matching contribution-discovery conventions: no auto-discovery at runtime; `prism init` reads the local directory only.
- Template list command surfaces available templates (`prism init --list-templates`).

## Tasks

- [ ] Task 1 — Primitive Review: Template Mechanism Over Existing Scaffold
  - Acceptance Criteria:
    - Functional: inventory `src/cli-init.ts` (current scaffold flow, provider selection, offline test generation) and `templates/init`/`templates/provider` (directory conventions, manifest shape). Confirm: templates are static directories + a data manifest; `--template <name>` selects the root; unknown name fails closed with the available list.
    - Performance: scaffold time within existing init envelope.
    - Code Quality: template directories carry the same manifest validation as current scaffolds; no runtime logic differences between templates (only file trees + manifest).
    - Security: templates are inert scaffolds — no postinstall scripts, no network at init, no secrets; template manifests validated with existing prototype-pollution rejection (config conventions).
  - Approach:
    - Documentation Reviewed:
      - `src/cli-init.ts`, `templates/init/`, `templates/provider/`, `docs/cli-rpc.md` (init section), `docs/contribution-discovery.md` (manifest conventions).
    - Options Considered:
      - Remote template registry (like `create-mastra`): rejected — supply-chain surface; local gallery only.
      - Local `templates/` directory + data manifest: chosen — consistent with init scaffold and contribution conventions.
    - Chosen Approach:
      - `templates/<name>/` directories + `templates/<name>/manifest.json`; `--list-templates` reads the directory; validation reuses manifest parsing.
    - API Notes and Examples:
      ```bash
      npx --package @arnilo/prism prism init my-research --template deep-research
      npx --package @arnilo/prism prism init my-research --list-templates
      ```
    - Files to Create/Edit:
      - `src/cli-init.ts` (flag + registry), `templates/deep-research/` (new).
  - Test Cases to Write:
    - Unknown template → fail-closed with available names.
    - `--list-templates` output stable and manifest-driven.
    - Scaffolded deep-research project passes its own offline `npm test` (existing init smoke-test pattern).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — CLI flag + new scaffold surface.
    - Docs pages to create/edit: `docs/cli-rpc.md` (init template section), template gallery section.
    - `docs/index.md` update: yes — CLI/RPC entry extended.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2 — `deep-research` Flagship Template
  - Acceptance Criteria:
    - Functional: scaffolded agent flow: (1) planning agent emits a typed research plan (structured output), (2) search step via `@arnilo/prism-web-tools` (mock-backed in offline test; real keys documented as opt-in), (3) bounded refine loop (node `retries` now / plan-045 loop node when shipped — link it), (4) citations wired to the RAG/source-citation seam, (5) HITL clarify via the durable pending-decision tool (`createAskUserDecisionTool`), (6) run budget caps set in config. README maps each component to its doc page.
    - Performance: offline test suite completes within existing scaffold test envelope (mock provider; no network).
    - Code Quality: project typechecks; example-grade code (no `any`); manifest lists the exact optional packages (web-tools, rag, workflows) with `^` peer ranges.
    - Security: no credentials at init; web-tools configured with late host credential resolvers (documented env pattern from existing examples); untrusted search results flow through the documented untrusted-content boundary; egress policy noted for browser paths.
  - Approach:
    - Documentation Reviewed:
      - `docs/web-tools.md`, `docs/rag.md` (citations), `docs/workflows.md`, `docs/coding-agent-tools.md` (`createAskUserDecisionTool` — durable suspend glue), `docs/host-security.md` (untrusted external content), `examples/` for wiring idioms.
    - Options Considered:
      - Ship 4 templates at once (rag-chat, crew, coding): rejected — one flagship first, gallery grows on demand (roadmap discipline).
      - Deep-research only: chosen — exercises the most seams; it is every competitor's marquee demo.
    - Chosen Approach:
      - One template, maximal seam coverage, offline-testable.
    - API Notes and Examples:
      ```bash
      cd my-research && npm install && npm test   # offline mock run green
      # README: swap mock for a real provider + web-tools credentials
      ```
    - Files to Create/Edit:
      - `templates/deep-research/` (agent code, workflow, test, README, manifest, package.json template), `templates/README.md` (gallery index).
  - Test Cases to Write:
    - Scaffold → install → offline test green (CI leg mirroring existing init smoke test).
    - Citation fixture: mock search results render with attributable citations (no fabricated sources).
    - HITL fixture: clarify decision suspends and resumes offline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — scaffolded project is a public artifact of the CLI.
    - Docs pages to create/edit: `docs/cli-rpc.md`, `docs/web-tools.md` cross-link from template README, `docs/release-and-install.md` (scaffold contents note).
    - `docs/index.md` update: no (Task 1 entry covers).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3 — Docs Truth, README, and Release
  - Acceptance Criteria:
    - Functional: root README "Quick start" gains the template line; `docs/release-and-install.md` records that templates ship inside the `@arnilo/prism` tarball within existing budget ceilings (verify tarball size gate).
    - Performance: tarball size within frozen budget; init + test within envelopes.
    - Code Quality: docs tripwires green; template listed consistently everywhere `prism init` is documented.
    - Security: supply-chain note — template files are covered by existing release secret-scan; no postinstall anywhere.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`, `scripts/` budget gates, root README.
    - Options Considered / Chosen Approach: minimal additive docs.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `README.md`, `docs/release-and-install.md`, `docs/cli-rpc.md` final pass.
  - Test Cases to Write: docs tripwire; tarball budget gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — README/docs claims.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass. (Known constraint: single-template gallery at start — additional templates demand-gated.)

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.