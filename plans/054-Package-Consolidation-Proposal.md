# 054 — 0.4 package reorganization: 62 current manifests → 11 active packages

Source: maintainer direction (2026-09): consolidate coding tools, web tools, memory/context,
runtime/session/governance; keep interop independent; move compaction into memory; ship the
three office capabilities as one `@arnilo/prism-office` package.

**Decided topology.** `@arnilo/prism` remains the small dependency-free contracts/CLI package.
"With Prism core" means a new **`@arnilo/prism-core` family package**, not literal
`@arnilo/prism/*` exports: putting Node-only runtime, database, security, and optional-driver
code in the root tarball would erase the root package's dependency-free trust boundary. All
families use explicit `exports` subpaths; package roots never barrel-export subpaths that need
an optional peer.

## Current profile contents (0.3.3)

All six current profiles are **pure manifests** (no source). They only install dependency
lists; they neither activate a provider nor initialize a service. `scripts/package-truth.json`
reports their transitive workspace closures; root `@arnilo/prism` is omitted from that JSON
closure because it is not itself a workspace, even where it is a direct dependency.

| Current profile | Direct dependencies | Transitive result / boundary |
|---|---|---|
| `@arnilo/prism-base` | `prism`, `prism-compaction`, `prism-tool-validator-json-schema` | Both compaction strategy packages plus the JSON Schema validator. Current minimal safe install. |
| `@arnilo/prism-code` | `prism-base`, `prism-coding-agent`, `prism-coding-security`, `prism-mcp` | Base closure plus coding agent/security and MCP. No AG-UI, work tools, policy, or browser. |
| `@arnilo/prism-sdk` | `prism-base`, `prism-credentials-node`, `prism-mcp`, `prism-observability-opentelemetry`, `prism-workflows` | Base closure plus Node credentials, MCP, observability, and workflows. No AG-UI, work tools, or policy. |
| `@arnilo/prism-providers` | 14 provider adapters: AI SDK, Alibaba, Anthropic, Clinepass, DeepSeek, Google, Kimi, NeuralWatt, Ollama, OpenAI, OpenCode Go, OpenRouter, xAI, Z.AI | Deliberately omits Azure, Bedrock, Vertex; `prism-all` lists those three directly. |
| `@arnilo/prism-compaction` | `prism-compaction-llm`, `prism-compaction-observational-memory` | Compaction-only convenience manifest. |
| `@arnilo/prism-all` | 21 direct packages: code, SDK, provider family + Azure/Bedrock/Vertex, sessions (SQLite/Postgres), memory/RAG, server/supervisor, web/browser/work tools, AG-UI/ACP, policy/model-router/evals/enterprise Postgres | 47-package closure. It omits Antigravity, Caveman, Computer Use Linux, Dev, Document Reader, Graft, Impeccable, Obscura, OpenAPI tools, Ponytail, Prompts, NATS sessions, and Wiki. |

Source evidence: `src/__tests__/packaging.test.ts:L197-L252`; generated
`scripts/package-truth.json`; `docs/release-and-install.md`.

### 0.4 profile decision

**Delete all npm profile manifests**: `prism-base`, `prism-code`, `prism-sdk`,
`prism-compaction`, and `prism-all`. `prism-providers` stops being a profile and becomes the
provider code family. The five profile names are deprecated at their final 0.3.x versions;
exact existing pins continue to resolve. Documentation replaces them with explicit `npm i`
recipes. This removes pure-manifest bookkeeping without adding a new profile abstraction.

## Target active package set (0.4)

The 62-current-manifest workspace has eight surviving packages, two new family packages, and
one new office package: **11 active packages**. It retires 54 current names. Relative to the
previous planned state (62 current + `prism-office` = 63), this is **63 → 11** (−52).

| Active package | Subpaths / contents | Current packages absorbed or retained |
|---|---|---|
| `@arnilo/prism` | Root contracts, runtime API, CLI, existing `providers/*`, `testing/*`, `node/*` exports | Retained. Must remain dependency-free at root. |
| `@arnilo/prism-core` | `/runtime/{server,supervisor,workflows}`; `/sessions/{codecs,sqlite,postgres,nats}`; `/governance/{policy,evals,prompts,model-router,observability}`; `/credentials/node`; `/enterprise/postgres`; `/integrations/work`; `/validation/json-schema` | **New.** Absorbs server, supervisor, workflows, four session stores, policy, evals, prompts, model-router, observability, credentials-node, enterprise-postgres, work-tools, tool-validator-json-schema. |
| `@arnilo/prism-providers` | `/ai-sdk`, `/alibaba`, `/anthropic`, `/azure`, `/bedrock`, `/clinepass`, `/deepseek`, `/google`, `/kimi`, `/neuralwatt`, `/ollama`, `/openai`, `/opencode-go`, `/openrouter`, `/vertex`, `/xai`, `/zai` | Retained name, converted from profile to code family. Absorbs all 17 adapter manifests. |
| `@arnilo/prism-coding-tools` | `/agent`, `/security`, `/document-reader`, `/openapi`, `/computer-use-linux`, `/dev`, `/caveman`, `/ponytail`, `/impeccable` | **New.** Absorbs coding-agent, coding-security, document-reader, openapi-tools, computer-use-linux, dev, caveman, ponytail, impeccable. No `prism-personas` package. |
| `@arnilo/prism-web-tools` | Root generic web tools plus `/browser`, `/obscura` | Retained name. Absorbs browser and obscura. Browser remains Playwright-peer gated; Obscura remains host-binary + MCP gated. |
| `@arnilo/prism-memory` | Root memory plus `/rag`, `/compaction/llm`, `/compaction/observational-memory`, `/graft`, `/wiki` | Retained name. Absorbs RAG, both compaction strategies, compaction profile, Graft, Wiki. Preserves `prism-wiki` bin and bundled skills; Graft remains optional-peer gated on `@nanonets/graft`. |
| `@arnilo/prism-mcp` | Existing MCP client/server/OAuth bridge | Retained, classified as interop. Remains separate because web Obscura and coding hosts both consume it. |
| `@arnilo/prism-acp-agent` | ACP adapter | Retained — interop unchanged. |
| `@arnilo/prism-ag-ui` | AG-UI/A2A/A2UI adapter | Retained — interop unchanged. |
| `@arnilo/prism-antigravity-agent` | Antigravity CLI adapter | Retained — interop unchanged. |
| `@arnilo/prism-office` | `/documents`, `/sheets`, `/diagrams` | New, already decided in plans 051–053. `@office-open/{docx,xlsx,pptx}` remain exact regular dependencies; diagrams-only hosts accept the unused office-code footprint. |

### Why `work-tools` is under core, not coding-tools

`@arnilo/prism-enterprise-postgres` currently depends on `@arnilo/prism-work-tools` to create
its work-idempotency store. Keeping work tools inside coding-tools would make
`@arnilo/prism-core/enterprise/postgres` depend on coding-tools, reversing the intended
layering. `/integrations/work` is therefore a core subpath; all other requested coding-agent
surfaces remain under `@arnilo/prism-coding-tools`.

### Required package invariants

- **Physical moves, not wrappers.** Family subpaths compile source moved with `git mv`.
  New families must not import retired `@arnilo/prism-*` package names. Wrapper families plus
  old-name shims would form a dependency cycle; reject it with a source/import graph test.
- **No compatibility shim packages.** This is a pre-1.0 breaking cut. Freeze old packages at
  their final 0.3.x version; exact pins remain valid and upgrades change package name and import
  together. Do not unpublish them.
- **Legacy registry markers.** After 0.4 packages and their migration guide are public, assign
  each of the 54 retired names' final release a `legacy` npm dist-tag and deprecate its entire
  `<0.4.0` range with one short warning containing the exact successor and migration-guide URL.
  Retain `latest` on that final 0.3.x release: npm tags cannot redirect one package name to a
  different family package. npm documents `npm dist-tag add <package>@<version> legacy` and
  version-range `npm deprecate`; deprecation causes an install-time warning, not removal.
- **Optional peers stay optional.** `pg`, `better-sqlite3`, `@nats-io/*`, `playwright-core`,
  `mammoth`, `pdf-parse`, `@nanonets/graft`, and host binaries remain subpath-local,
  fail-closed requirements. No family root import may load any of them.
- **Trust gates stay local.** `coding-tools/security` preserves its sandbox-policy tests;
  `web-tools/browser` preserves egress/upload/download quarantine tests; `web-tools/obscura`
  preserves SSRF/process tests; `core/enterprise/postgres` preserves schema/migration tests.
  A shared tarball never means a shared default capability.
- **Interop stays independent.** MCP, ACP, AG-UI, and Antigravity retain own manifests and
  release cadence; only MCP is reclassified as interop in docs.

## Objectives

- Replace 62 current manifests plus the planned office package with 11 active 0.4 packages
  while retaining import-level granularity through explicit subpaths.
- Apply maintainer groupings: coding tools/personas together; browser/Obscura under web tools;
  RAG/compaction/Graft/Wiki under memory; runtime/sessions/governance under Prism core; interop
  unchanged; one office package.
- Preserve root-core dependency freedom, optional-peer fail-closed behavior, security test
  boundaries, Decision B publication, and every pre-0.4 exact pin.

## Expected Outcome

- Hosts install only the families they use and import explicit subpaths, for example:
  ```ts
  import { createAgent } from "@arnilo/prism";
  import { createPostgresPersistence } from "@arnilo/prism-core/sessions/postgres";
  import { createCodingTools } from "@arnilo/prism-coding-tools/agent";
  import { createBrowserTools } from "@arnilo/prism-web-tools/browser";
  import { createLlmCompactionStrategy } from "@arnilo/prism-memory/compaction/llm";
  ```
- `@arnilo/prism` root imports remain dependency-free; missing optional peers fail before an
  external/database/browser operation starts, with an installable-peer error.
- All 54 old package names retain their final 0.3.x tarball and `latest` tag, gain a `legacy`
  tag plus install-time deprecation warning, and are not republished as shims; the detailed
  migration guide maps every old import to its exact 0.4 subpath and rollback path.
- `scripts/package-truth.json`, release/install docs, compatibility baselines, and pack smoke
  tests report 11 active packages after the 0.4 cut.

## Tasks

- [x] Task 1: Freeze the 0.3.3 package/export baseline and record the 0.4 import map
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase54-package-map.md` lists all 62 current manifests, 54 retirements, eight retained names, three new names, every old→new import/subpath mapping, retained CLI/bin names (`prism`, `prism-dev`, `prism-wiki`), and all optional peer/binary requirements; export snapshots are generated before source moves.
    - Performance: n/a (analysis/generation only).
    - Code Quality: The mapping is generated from manifests/export declarations, then reviewed; no hand-maintained second package list.
    - Security: Records every boundary that must remain subpath-local (sandbox, SSRF, browser egress, database migrations, host binaries, optional parsers).
  - Approach:
    - Documentation Reviewed:
      - `scripts/package-truth.mjs`; `src/__tests__/packaging.test.ts:L197-L327`; `docs/release-and-install.md`; current package manifests for browser, Obscura, Graft, Wiki, Dev, and enterprise Postgres.
      - npm package.json documentation (Context7 `/npm/cli`): `peerDependenciesMeta.optional` prevents automatic peer installation; `npm deprecate <pkg>@<range> <message>` emits an install-time warning; `npm dist-tag add <pkg>@<version> legacy` aliases an exact release without changing `latest`.
    - Options Considered:
      - Re-export wrapper families + shim packages — rejected: a family importing old packages while old packages re-export the family forms an npm dependency cycle.
      - Final 0.4 shims — rejected: adds 54 temporary workspace manifests and defeats the stated count reduction; exact 0.3 pins already remain valid.
    - Chosen Approach:
      - Generate baselines, physically move source later, hard-freeze/deprecate old ranges.
    - API Notes and Examples:
      ```bash
      node scripts/phase54-package-map.mjs > docs/_evidence/phase54-package-map.md
      npm dist-tag add @arnilo/prism-provider-openai@0.3.1 legacy
      npm deprecate @arnilo/prism-provider-openai@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/openai. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"
      ```
    - Files to Create/Edit:
      - `scripts/phase54-package-map.mjs`, `docs/_evidence/phase54-package-map.md`, `plans/054-Package-Consolidation-Proposal.md` (record final mapping decision).
    - References:
      - Current profile table above; `scripts/package-truth.json` 0.3.3 closure data.
  - Test Cases to Write:
    - Mapping meta-test: every current manifest appears exactly once as retained, retired, or converted; every exported old symbol has one target subpath; no optional peer/binary is unclassified.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — records breaking package/import migration.
    - Docs pages to create/edit: `docs/_evidence/phase54-package-map.md`.
    - `docs/index.md` update: no — evidence only.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 2: Create `@arnilo/prism-core` for runtime, sessions, governance, and work integration
  - Acceptance Criteria:
    - Functional: New `packages/prism-core` exports exactly the subpaths in the target table; source from 16 packages moves under `src/` with no runtime import of a retired package; `work-tools` lands at `/integrations/work`; `enterprise/postgres` composes only internal core modules; root `@arnilo/prism` remains dependency-free.
    - Performance: Importing `@arnilo/prism-core/runtime/workflows` does not load database drivers, browser code, or the full governance surface; subpath smoke/bundle checks prove this.
    - Code Quality: Session, workflow, policy, evaluation, prompt, model-router, observability, enterprise-postgres, and schema conformance suites run against new imports; package `exports` maps JS and `.d.ts` for every subpath.
    - Security: Database/session drivers stay optional peers and are probed before use; Postgres migration/schema and policy/audit tests are unchanged; no subpath silently falls back to memory or host filesystem state.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores.md`, `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/evaluations.md`, `docs/policy.md`, `docs/model-router.md`, `docs/observability.md`, `docs/runs-and-usage.md`.
      - `packages/enterprise-postgres/src/enterprise.ts:L22-L66` (internal composition), `packages/session-store-postgres/src/persistence.ts:L102-L811` (migration boundary), `packages/document-reader/src/index.ts:L148-L181` (optional-peer fail-closed precedent).
    - Options Considered:
      - Literal `@arnilo/prism/{runtime,sessions,governance}` — rejected: puts privileged/Node-only code and optional peer inventory into the root package.
      - `@arnilo/prism-core` family — chosen: keeps the root's trust/install contract while delivering the requested unified core subpaths.
    - Chosen Approach:
      - `git mv` code/tests; use `peerDependenciesMeta.optional` plus lazy drivers; no catch-all root barrel.
    - API Notes and Examples:
      ```ts
      import { createWorkflowCoordinator } from "@arnilo/prism-core/runtime/workflows";
      import { createPostgresPromptStore } from "@arnilo/prism-core/governance/prompts";
      ```
    - Files to Create/Edit:
      - `packages/prism-core/package.json`, `tsconfig.json`, `src/{runtime,sessions,governance,credentials,enterprise,integrations,validation}/**`, tests/README/CHANGELOG/LICENSE.
      - Move sources/tests from `packages/{server,supervisor,workflows,session-store-*,policy,evals,prompts,model-router,observability-opentelemetry,credentials-node,enterprise-postgres,work-tools,tool-validator-json-schema}/`.
    - References:
      - Target package table; Task 1 generated map.
  - Test Cases to Write:
    - New-subpath conformance suites; driver-absent failure probes; Postgres/SQLite/NATS gated integrations; import-isolation test; source graph test forbidding imports from retired package names.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — all listed runtime/session/governance imports move.
    - Docs pages to create/edit: `docs/{session-stores,database-persistence,sqlite-persistence,evaluations,policy,model-router,observability,runs-and-usage}.md`; new `docs/core.md` subpath map.
    - `docs/index.md` update: yes — new Core runtime, sessions, and governance entry.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 3: Create `@arnilo/prism-coding-tools`, including Caveman, Ponytail, and Impeccable
  - Acceptance Criteria:
    - Functional: New `packages/prism-coding-tools` exports `/agent`, `/security`, `/document-reader`, `/openapi`, `/computer-use-linux`, `/dev`, `/caveman`, `/ponytail`, `/impeccable`; `prism-dev` bin remains available from the family package; no `@arnilo/prism-personas` package exists.
    - Performance: Importing `/agent` never loads sandbox adapters, desktop MCP bridge, document parser peers, or Dev inspector modules; size/import-isolation check passes.
    - Code Quality: Coding-agent/tool conformance, coding-security sandbox composition, document-reader cap/redaction, OpenAPI SSRF/allowlist, Linux device policy, dev inspector, and each persona extension suite pass from their new subpaths.
    - Security: Sandbox security remains independently tested and documented; document parser peers (`mammoth`, `pdf-parse`) and Computer Use Linux/MCP requirements fail closed; persona extensions never gain implicit host access.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md`, `docs/tool-conformance.md`, `docs/caveman.md`, `docs/ponytail.md`, `docs/impeccable.md`, `docs/obscura.md` (boundary wording), and `docs/release-and-install.md`.
      - `packages/coding-security/src/sandbox-coding-operations.ts:L235-L356`; `packages/document-reader/src/index.ts:L148-L181`; `packages/computer-use-linux/src/create.ts:L55-L121`; `packages/prism-dev/package.json` (bin and AG-UI/server peers).
    - Options Considered:
      - Retain `prism-personas` — rejected by maintainer direction; three mode packages live under coding tools.
      - Put work tools here — rejected: enterprise Postgres currently consumes work-idempotency; moving it to core prevents reverse core→coding dependency.
    - Chosen Approach:
      - Physical source move to namespaced directories and strict export map; preserve `prism-dev` bin and each extension's bundled skills/upstream metadata.
    - API Notes and Examples:
      ```ts
      import { createCodingTools } from "@arnilo/prism-coding-tools/agent";
      import { ponytailExtension } from "@arnilo/prism-coding-tools/ponytail";
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/{package.json,tsconfig.json,src/**,README.md,CHANGELOG.md,LICENSE}`.
      - Move code/tests/assets from `packages/{coding-agent,coding-security,document-reader,prism-openapi-tools,computer-use-linux,prism-dev,prism-caveman,prism-ponytail,prism-impeccable}/`.
    - References:
      - Target table; Task 1 export map.
  - Test Cases to Write:
    - Subpath import isolation; retained `prism-dev` bin pack smoke; existing security/document/device/persona suites through new paths; retired-name import graph rejection.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — coding, security, reader, OpenAPI, device, dev, and persona import paths move.
    - Docs pages to create/edit: `docs/tools.md`, `docs/tool-conformance.md`, `docs/caveman.md`, `docs/ponytail.md`, `docs/impeccable.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes — Coding tools family entry with subpaths.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 4: Convert `@arnilo/prism-web-tools` into web/browser/Obscura family
  - Acceptance Criteria:
    - Functional: Existing `packages/web-tools` exports root web tools plus `/browser` and `/obscura`; public symbols, browser egress policy, download/upload quarantine, Obscura SSRF/process/CDP/MCP APIs remain unchanged except import specifier.
    - Performance: Generic web-tools import does not resolve `playwright-core` or spawn/read an Obscura binary; browser and Obscura tests prove their dependency probes are lazy.
    - Code Quality: Browser/Obscura source moves physically; `@arnilo/prism-mcp` remains an explicit peer where Obscura needs it; existing live tests remain opt-in.
    - Security: Browser and Obscura protections are preserved in their own subpath suites; missing Playwright or Obscura binary fails before a browser/process operation; no public host credentials are added to package metadata.
  - Approach:
    - Documentation Reviewed:
      - `docs/web-tools.md`, `docs/browser.md`, `docs/obscura.md`; `packages/browser/package.json` (`playwright-core@1.61.0` optional peer); `packages/obscura/package.json` (MCP/browser/web peer topology); `packages/obscura/src/cli.ts:L126-L133` (SSRF gate).
    - Options Considered:
      - Keep browser/Obscura standalone — rejected by maintainer direction.
      - Make MCP part of web tools — rejected: MCP is shared protocol infrastructure and remains independent interop.
    - Chosen Approach:
      - One family package with peer-gated subpaths and no root re-export of host-integrated modules.
    - API Notes and Examples:
      ```ts
      import { createWebTools } from "@arnilo/prism-web-tools";
      import { createBrowserTools } from "@arnilo/prism-web-tools/browser";
      ```
    - Files to Create/Edit:
      - `packages/web-tools/package.json`, `src/{browser,obscura}/**`, tests/README/CHANGELOG; move `packages/{browser,obscura}/src/**` and required fixture assets.
    - References:
      - Target table; Task 1 import map.
  - Test Cases to Write:
    - Root import without Playwright/Obscura; browser/Obscura missing-peer failure; SSRF/egress/quarantine suites; pack test excludes browser fixtures from root-only docs but includes required runtime code.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — browser/Obscura specifiers move.
    - Docs pages to create/edit: `docs/web-tools.md`, `docs/browser.md`, `docs/obscura.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes — Web tools family entry.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 5: Convert `@arnilo/prism-memory` into memory/RAG/compaction/context family
  - Acceptance Criteria:
    - Functional: Existing `packages/memory` exports root memory plus `/rag`, `/compaction/llm`, `/compaction/observational-memory`, `/graft`, `/wiki`; `prism-wiki` bin and `skills/` ship from the memory tarball; Graft remains optional-peer gated on `@nanonets/graft`; compaction and RAG conformance behavior stays unchanged.
    - Performance: Root memory import does not invoke Graft/QMD/Context7 processes or load RAG/compaction code; test verifies no host-process action until relevant factory/command is called.
    - Code Quality: Memory/RAG/compaction exports preserve type identity; Wiki and Graft extensions retain commands, skills, and instruction injectors; source uses no retired package imports.
    - Security: RAG input caps and scope checks, Graft process timeout/output bounds, and Wiki workspace file boundaries remain independent subpath tests; host binaries are never auto-installed or auto-run.
  - Approach:
    - Documentation Reviewed:
      - `docs/working-and-semantic-memory.md`, `docs/rag.md`, `docs/compaction-and-retry.md`, `docs/compaction-llm.md`, `docs/compaction-observational-memory.md`, `docs/context-and-skills.md`.
      - `packages/prism-graft/package.json` (optional `@nanonets/graft` peer); `packages/prism-graft/src/extension.ts:L61-L168`; `packages/prism-wiki/package.json` and `src/cli.ts:L28-L122` (bin/skills).
    - Options Considered:
      - Keep Graft/Wiki separate — rejected by maintainer direction; both are context/knowledge surfaces.
      - Keep `prism-compaction` profile — rejected; compaction is memory subpaths and profiles are deleted.
    - Chosen Approach:
      - Physical moves under `src/{rag,compaction,graft,wiki}`; preserve `prism-wiki` bin and skills in `files`.
    - API Notes and Examples:
      ```ts
      import { retrieveContext } from "@arnilo/prism-memory/rag";
      import { createObservationalMemoryCompaction } from "@arnilo/prism-memory/compaction/observational-memory";
      ```
    - Files to Create/Edit:
      - `packages/memory/package.json`, `src/{rag,compaction,graft,wiki}/**`, tests, skills, README/CHANGELOG/LICENSE.
      - Move sources/assets from `packages/{rag,compaction-llm,compaction-observational-memory,prism-graft,prism-wiki}/`; remove `packages/prism-compaction/`.
    - References:
      - Target table; Task 1 map.
  - Test Cases to Write:
    - Memory/RAG/compaction conformance through new imports; Graft-peer-absent and Wiki-bin/skill pack smoke; root-memory import isolation; context process limits.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — RAG, compaction, Graft, Wiki imports and package/bin location move.
    - Docs pages to create/edit: `docs/working-and-semantic-memory.md`, `docs/rag.md`, `docs/compaction-and-retry.md`, `docs/compaction-llm.md`, `docs/compaction-observational-memory.md`, `docs/context-and-skills.md`.
    - `docs/index.md` update: yes — Memory and context family entry.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 6: Convert `@arnilo/prism-providers` to 17 physical adapter subpaths
  - Acceptance Criteria:
    - Functional: Existing `packages/prism-providers` exports all 17 adapter subpaths; all adapter source/tests move under the family; Azure, Bedrock, and Vertex cease being special all-only manifests; each factory/model/auth export retains symbols and conformance behavior.
    - Performance: Importing one adapter does not evaluate another; package remains dependency-free except the required Prism peer.
    - Code Quality: Provider conformance runs once per new subpath; no source import references an old provider package; current 14-provider/3-cloud profile distinction disappears because profiles are deleted.
    - Security: Provider credential handling/auth registration semantics are unchanged; no adapter is activated by package install or family-root import.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-packages.md`, `docs/providers/*.md`, `scripts/package-truth.json` provider family/omission list, `@arnilo/prism/testing/provider-conformance` export.
    - Options Considered:
      - Thin exports from old provider workspaces — rejected: retired-name imports create a runtime dependency on packages this proposal removes.
      - Physical source move — chosen.
    - Chosen Approach:
      - `git mv` provider source to family directories and generate the exports/migration table from one provider metadata list.
    - API Notes and Examples:
      ```ts
      import { createOpenAiProvider } from "@arnilo/prism-providers/openai";
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/{package.json,src/**,README.md,CHANGELOG.md,LICENSE}`; move `packages/provider-*/src/**` and tests; `docs/provider-packages.md`, `docs/providers/*.md`.
    - References:
      - Task 1 mapping; current provider-family manifest test.
  - Test Cases to Write:
    - All-17 subpath import and provider-conformance matrix; adapter isolation/tree-shake smoke; source graph forbids old provider imports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — all provider import paths move.
    - Docs pages to create/edit: `docs/provider-packages.md`, all `docs/providers/*.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes — Provider family entry.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 7: Generate and verify legacy npm tags and deprecation warnings
  - Acceptance Criteria:
    - Functional: A generated, reviewable registry plan covers every one of the 54 retired names with its final published version, `legacy` dist-tag command, `<0.4.0` deprecation range, exact 0.4 successor (or profile recipe), and a stable anchor in `docs/migrate-to-0.4.md`; `--dry-run` verifies target versions exist and `latest` remains unchanged; `--apply` adds the tag and warning only after 0.4 packages and guide are public.
    - Performance: The registry operation is release-only; it makes bounded one-package queries/mutations and has no installed-runtime cost.
    - Code Quality: One generated manifest is the only source for tag/deprecation commands and guide mapping; messages use a short, uniform format and no command is hand-copied for 54 packages.
    - Security: `--apply` requires explicit confirmation and npm publish credentials; dry-run logs package/version/message but never tokens; failure report identifies unmodified names for safe resume.
  - Approach:
    - Documentation Reviewed:
      - npm CLI Context7 `/npm/cli` `npm-deprecate` and `npm-dist-tag`: `npm deprecate <pkg>@<range> <message>` emits install warnings; `npm dist-tag add <pkg>@<version> legacy` attaches an alias to an exact version; `latest` remains default for bare installs.
      - `scripts/release.mjs`, `docs/release-and-install.md`, Task 1 export/package map.
    - Options Considered:
      - Unpublish old packages — rejected: breaks reproducible installs and removes the rollback path; npm recommends deprecation when encouraging upgrades.
      - New compatibility/shim releases — rejected: retains 54 active manifests and risks wrapper dependency cycles.
      - Deprecation warnings only — rejected: add the `legacy` tag as an explicit registry lifecycle marker while retaining the warning users see during install.
    - Chosen Approach:
      - Generate a single legacy registry manifest; first dry-run/query it, then run its idempotent apply mode only after the new family packages and guide are public.
    - API Notes and Examples:
      ```bash
      node scripts/phase54-legacy-registry.mjs --dry-run
      npm dist-tag add @arnilo/prism-browser@0.3.1 legacy
      npm deprecate @arnilo/prism-browser@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-web-tools/browser. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#web-browser-and-obscura"
      node scripts/phase54-legacy-registry.mjs --apply --confirm
      ```
    - Files to Create/Edit:
      - `scripts/phase54-legacy-registry.mjs`: generates/verifies/applies tags and deprecation messages from Task 1's map.
      - `release-artifacts/legacy-registry-plan.json`: generated reviewed input/output with names, versions, commands, migration anchors, status, and resume data.
      - `src/__tests__/packaging.test.ts`: validates every retired name has legacy-registry metadata and a successor/recipe anchor.
    - References:
      - Task 1 map; npm deprecation/dist-tag documentation; target active-package table.
  - Test Cases to Write:
    - Fixture registry dry-run: generates exactly 54 distinct tags and `<0.4.0` deprecations without mutating state.
    - Resume/idempotence: already-correct tag/warning is skipped; mismatched tag/warning fails closed; one failed mutation can resume.
    - Message contract: every warning identifies legacy status, exact successor/recipe, and valid migration-guide anchor.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — legacy installs gain an npm warning and a `legacy` dist-tag.
    - Docs pages to create/edit: `docs/migrate-to-0.4.md` (canonical URLs/anchors used by warnings); `docs/release-and-install.md` (legacy lifecycle policy).
    - `docs/index.md` update: yes — migration/compatibility link.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 8: Publish office subpaths and write the detailed legacy-to-0.4 migration guide
  - Acceptance Criteria:
    - Functional: Plans 051–053 land one `packages/office` package with `/documents`, `/sheets`, `/diagrams`; old profile directories (`prism-base`, `prism-code`, `prism-sdk`, `prism-compaction`, `prism-all`) are removed; `docs/migrate-to-0.4.md` gives a complete, copyable migration for all 54 retired package names and the eight unchanged names.
    - Performance: Every guide recipe installs only selected family packages and calls out driver/binary peers; examples never imply browser, database, parser, or host-binary installation for an unrelated subpath.
    - Code Quality: Guide mapping is generated from the same Task 1/Task 7 manifest, has a stable heading anchor for every legacy group, and is checked for stale names/targets; `scripts/package-truth.mjs`, README links, and release docs describe exactly 11 active packages.
    - Security: Guide separately calls out migration of sandbox security, browser/Obscura egress, database/session persistence, document parser, Graft, and host-binary boundaries; rollback instructions never suggest weakening a trust gate.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` current profile commands/all closure; `docs/migration.md`; plans 051–053; Task 7 npm lifecycle references; `docs/{browser,obscura,session-stores,database-persistence,context-and-skills,tools}.md`.
    - Options Considered:
      - Keep a `prism-all` convenience package — rejected: manifest-only maintenance burden and hides optional capability/trust choices.
      - Short rename table only — rejected: insufficient for profile replacement, peer installation, security boundaries, or rollback.
      - Separate 0.4 guide — chosen: stable deprecation-warning URL and one authoritative, task-oriented migration path.
    - Chosen Approach:
      - Docs-first recipes, one office manifest, and a dedicated generated+reviewed `docs/migrate-to-0.4.md` guide.
    - API Notes and Examples:
      ```bash
      # Before: 0.3 coding profile
      npm i @arnilo/prism-code @arnilo/prism-provider-openai

      # After: explicit 0.4 family selection
      npm i @arnilo/prism @arnilo/prism-core @arnilo/prism-coding-tools \
        @arnilo/prism-mcp @arnilo/prism-providers
      ```
      ```ts
      // Before
      import { createOpenAiProvider } from "@arnilo/prism-provider-openai";
      // After
      import { createOpenAiProvider } from "@arnilo/prism-providers/openai";
      ```
    - Files to Create/Edit:
      - `packages/office/**`: per plans 051–053; `/documents`, `/sheets`, `/diagrams` exports.
      - `docs/migrate-to-0.4.md`: What changes; before starting; package status table; all 54 old→new mappings grouped by Providers/Core/Coding/Web/Memory/Profiles; unchanged package table; install/import recipes; peer/binary requirements; security-boundary notes; validation steps; rollback to exact 0.3 pins; legacy warning explanation; FAQ.
      - `docs/{migration,release-and-install,index}.md`, family READMEs, moved API pages, `scripts/package-truth.json`, compat baselines, package/install/docs tests.
    - References:
      - Current profile table; target active-package table; Task 1 mapping; plans 051–053.
  - Test Cases to Write:
    - Guide-link check: every Task 7 warning anchor exists and every mapping target is a declared active export.
    - Recipe install/import smoke for Core, Coding, Web, Memory, Provider, Office, and each profile replacement; peer/binary-required recipes fail with documented error.
    - Stale-name scanner permits retired names only in legacy mapping/deprecation material; generated package truth count equals 11.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — all retired imports/profile installs and office imports change.
    - Docs pages to create/edit: `docs/migrate-to-0.4.md`, `docs/migration.md`, `docs/release-and-install.md`, `docs/index.md`, family package READMEs and moved API pages.
    - `docs/index.md` update: yes — add **Migration and compatibility → Migrate legacy 0.3 packages to 0.4**; replace profile navigation with Core, Coding tools, Web tools, Memory/context, Providers, Interop, Office groups.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 9: 0.4 release verification, publication, and legacy registry cutover
  - Acceptance Criteria:
    - Functional: Build/typecheck/offline tests/pack/release gates pass for the 11 active packages; each active manifest publishes at its 0.4 line with correct `@arnilo/prism` peer range; after package and guide publication, Task 7 applies each `legacy` tag and `<0.4.0` deprecation warning; report proves no retired package is published as a shim and all 54 registry changes completed.
    - Performance: Tarball size and cold-install measurements recorded for root and each family; no family-root import regression against the current 27.5 MB default scaffold budget without an explicit approved baseline update.
    - Code Quality: `npm run sdk:ready`, `npm run release:check`, `npm run release:publish -- --dry-run`, docs truth, import graph, package truth, guide-link, and legacy-registry dry-run gates all green; changelog maps the breaking package cut.
    - Security: Pack review confirms no test fixtures, credentials, `.wiki` output, or unexpected binaries leak; release token is used only for publish/tag/deprecate; required live Postgres/browser tests remain separately gated.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs`, `docs/release-and-install.md`, `docs/0.1.0-readiness.md`, Task 7 npm lifecycle documentation, packaging/install smoke tests.
    - Options Considered:
      - Publish shims with family packages — rejected per Task 1; no compatibility cycle or transient workspace bloat.
      - Apply warnings before publishing guide/new families — rejected: warning would lead users to a missing target or docs page.
      - Atomic all-package 0.4 cut vs Decision B — chosen: publish changed active families in dependency order, retaining Decision B validation; this is one documented breaking migration window.
    - Chosen Approach:
      - Verify active graph; publish families and docs; verify public targets; apply generated legacy tags/deprecations; write resume-safe registry report; then tag release.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm run release:check -- --allow-dirty --allow-untagged
      npm run release:publish -- --dry-run --allow-dirty --allow-untagged
      node scripts/phase54-legacy-registry.mjs --dry-run
      node scripts/phase54-legacy-registry.mjs --apply --confirm
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`, active package changelogs/package manifests, `release-artifacts/legacy-registry-plan.json`, release report/artifacts, `plans/054-Package-Consolidation-Proposal.md` (completion evidence).
    - References:
      - Tasks 7–8; `scripts/release.mjs`.
  - Test Cases to Write:
    - Existing release/pack/install smoke gates plus active-package count, family-root isolation, no-shim-publish, public guide URL/anchor, and completed legacy-registry-report assertions.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — 0.4 breaking package release and legacy install warnings.
    - Docs pages to create/edit: `docs/migrate-to-0.4.md`, `docs/release-and-install.md`, `docs/migration.md`, `CHANGELOG.md`.
    - `docs/index.md` update: yes — final migration link, navigation, and package-count wording verification.
    - Documentation structure reference: prism-wiki.md.

## Compromises Made

- Real npm publish and `legacy`/`deprecate` apply stay gated on a clean tagged tree (`release.mjs` refuses `--allow-dirty` for real publication) plus `docs/migrate-to-0.4.md` on `main` so warning URLs resolve. Verification, 0.4.0 lockstep manifests, dry-run publish of all 11, and legacy dry-run (52 published / 2 unpublished, 0 problems) are done; operator tags `v0.4.0` then `--apply --confirm`.
- Live Postgres/browser stay separately gated. Release-evidence attestation used a dummy `PRISM_TEST_POSTGRES_URL` the same way CI verify does.
- Compat baseline regenerated for the root `version` export `0.3.3` → `0.4.0` only (documented in `docs/migration.md`).
- `@arnilo/prism-prompts` and `@arnilo/prism-dev` were never published; they get no registry mutations.

## Further Actions

- Operator: commit the 0.4 lockstep, push `main` (guide public), tag `v0.4.0`, publish 11 packages, then `node scripts/phase54-legacy-registry.mjs --apply --confirm`. Resume-safe; already-applied entries skip.
- Independent Decision B patches resume inside `^0.4.0`.