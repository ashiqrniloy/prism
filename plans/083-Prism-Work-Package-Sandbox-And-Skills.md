# 083 — `@arnilo/prism-work`: one work family, sandbox, vendored OSS skills

Status: complete (implementation 2026-09-17; ships in **0.8.0** via [085](085-Honesty-Gates-Runtime-Split-And-0-8-0-Cut.md)). Breaking import map is the 0.8.0 host-visible cut. No 12th publishable package: **replace** `@arnilo/prism-office` so the active count stays **11**.

Closes the Work-agent gaps from the 2026-09-17 review (P0–P3) plus three maintainer constraints:

1. Consolidate work connectors, document-reader, and office into **one** family package with subpaths; delete `@arnilo/prism-office`; remove those surfaces from `@arnilo/prism-core` and `@arnilo/prism-coding-tools`.
2. Give Prism agents a **dedicated work sandbox** whose image contains the binaries the office skills actually run.
3. **Do not author `SKILL.md` bodies.** Vendor existing OSI-licensed skills that already ship in a production agent. Bind them to Prism tools in a loader.

## Skills Prism will ship (locked)

**Pack:** [Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent) `skills/productivity/{docx,xlsx,powerpoint,pdf}` — MIT (`LICENSE` Copyright 2025 Nous Research). Used by Hermes. Scripts are argparse CLIs around `python-docx` / `openpyxl` / `python-pptx` plus optional LibreOffice.

| Skill name | Path in upstream | What it runs |
|---|---|---|
| `docx` | `skills/productivity/docx` | `docx_create.py` / `docx_read.py` / `docx_edit.py` / `docx_template.py` / `docx_revisions.py` / `docx_comments.py` / `docx_validate.py` |
| `xlsx` | `skills/productivity/xlsx` | `xlsx_create.py` / `xlsx_read.py` / `xlsx_edit.py` / `xlsx_restructure.py` / `xlsx_recalc.py` / CSV interop |
| `powerpoint` | `skills/productivity/powerpoint` | `pptx_create.py` / `pptx_read.py` / `pptx_edit.py` / `pptx_from_template.py` / `pptx_render.py` |
| `pdf` | `skills/productivity/pdf` | `pdf_create.py` / `pdf_read.py` / `pdf_merge.py` / `pdf_split.py` / `pdf_fill_form.py` / `pdf_make_form.py` / `pdf_form_layout.py` / `pdf_secure.py` / `pdf_watermark.py` / `pdf_stamp.py` / `pdf_page_image.py` / `pdf_meta.py` / `extract_pymupdf.py` / `extract_marker.py` / `_raster.py` |

**How they ship:** verbatim vendor copy at a **pinned git SHA** under `packages/prism-work/vendor/hermes-agent/`. Loader (`loadWorkSkills`) calls existing `parseSkillFile`, overlays Prism `toolNames` in **TypeScript**, never edits vendored markdown. `THIRD_PARTY_NOTICES` + `vendor-lock.json`.

**Will not ship:**

- Anthropic `skills/{docx,xlsx,pptx,pdf}` — [source-available, not open source](https://github.com/anthropics/skills). Cannot redistribute.
- OpenAI curated `doc` / `spreadsheet` — removed from `openai/skills` main (repo deprecated). `pdf` remains; one-pack rule: Hermes only.
- `arih04x/office-skills` (MIT) — no xlsx; docx is .NET OpenXML SDK. Keep as fallback only if Hermes provenance audit fails.
- Hermes SaaS skills (`airtable`, `box`, …).
- Any Prism-written `work-connector` / `office-qa` SKILL.md. Connector procedure already lives in work tool descriptions. Visual QA is the Hermes `pptx_render.py` / LibreOffice path.

Task 7 is a **license + provenance gate**: byte-diff against `anthropics/skills/{docx,xlsx,pptx,pdf}`. Substantial copy → do not vendor; stop the task and record the miss. Do not rewrite the skill.

## Objectives

- One installable family `@arnilo/prism-work` with explicit subpaths for connectors, documents, sheets, diagrams, document-reader, office/work tools, sandbox, and vendored skills.
- Retire `@arnilo/prism-office`. Remove `@arnilo/prism-core/integrations/work*` and `@arnilo/prism-coding-tools/document-reader`. Publishable count remains 11.
- Agents can generate/parse/patch Office files as tools, download tenant files, and publish bytes through existing draft-then-approve `file.add`.
- Agents can run document work inside a host-constructed Docker sandbox whose image includes Python, the three Office libraries, LibreOffice, Poppler, zip, and the vendored scripts. Connector tokens stay on the host by default.
- Ship the four Hermes MIT skills above, unmodified, with a loader and a provenance lock.

## Expected Outcome

A host on the cut after this plan:

```ts
import { createWorkTools, createMicrosoft365HttpAdapter } from "@arnilo/prism-work/connectors";
import { generateDocument } from "@arnilo/prism-work/documents";
import { createDocumentReader } from "@arnilo/prism-work/document-reader";
import { createOfficeTools, createWorkComposition } from "@arnilo/prism-work/tools";
import { loadWorkSkills } from "@arnilo/prism-work/skills";
import { WORK_SANDBOX_IMAGE } from "@arnilo/prism-work/sandbox";
import { createDockerSandbox } from "@arnilo/prism-coding-tools/security";

const sandbox = await createDockerSandbox({ docker, image: WORK_SANDBOX_IMAGE, sourceRoot, user, network: { mode: "none" } });
const { tools, skills, composition } = createWorkComposition({
  sandbox,
  connectors: { microsoft365, idempotencyStore, approval },
});
```

- `office_generate` / `office_parse` / `office_import` / `office_patch` / `office_diff` / `office_preview` exist.
- `gws_file_get` / `m365_file_get` return bytes into the sandbox or an artifact body; `file.add` uploads sandbox/host bytes after approval.
- Gated GWS `docs.update` / `sheets.update` / `slides.update` use fixed request shapes (not free-form `batchUpdate` arrays).
- `loadWorkSkills()` returns `docx`, `xlsx`, `powerpoint`, `pdf` from the vendor tree.
- `@arnilo/prism-office` is gone from packaging truth. Old imports fail at compile time (pre-1.0, no shims).
- Default work sandbox: **no network, no OAuth env**. Graph/Gmail stay on the host HTTP adapters.

## Tasks

- [x] **Task 1 — Primitive, compatibility, and threat-model review**
  - Acceptance Criteria:
    - Functional: `docs/history/083-prism-work-primitive-review.md` inventories current contracts with file:line: `createWorkTools` / adapters / drafts (`packages/prism-core/src/integrations/work/{tools,types,drafts,http,microsoft365-http,google-workspace-http,idempotency}.ts`); `createPostgresIdempotencyStore` (`packages/prism-core/src/enterprise/postgres/work-idempotency.ts`); `generateDocument` / `importDocument` / `patchDocument` (`packages/office/src/documents/{generate,parse,patch}.ts`); `createDocumentReader` (`packages/prism-coding-tools/src/document-reader/index.ts`); `DocumentReader` slot on `createReadTool` (`packages/prism-coding-tools/src/agent/read.ts`); `createDockerSandbox` / `createSandboxCodingComposition` (`packages/prism-coding-tools/src/security/{docker-sandbox,sandbox-coding-operations}.ts`); `parseSkillFile` / `createSkillRegistry` (`src/contribution-parsing.ts`, `src/skills.ts`); `loadComputerUseLinuxSkill` (vendor pattern). Each later task maps to a frozen symbol or an explicit out-of-scope row.
    - Performance: docs + existing probes only. Record packed/export ceilings for `@arnilo/prism-office`, `@arnilo/prism-core`, `@arnilo/prism-coding-tools` as the Task 11 baseline.
    - Code Quality: no new public symbols. No `.agents/skills/project-patterns/` or `project-wiki/` — no extra wiki task.
    - Security: threat rows for (1) sandbox with tenant tokens, (2) LibreOffice macro/OLE, (3) zip symlinks in OOXML, (4) vendoring Anthropic proprietary skills, (5) model-supplied Graph URLs, (6) core runtime-depending on office-open via prism-work, (7) skill scripts executing outside the sandbox.
  - Approach:
    - Documentation Reviewed:
      - [docs/work-tools.md](../docs/work-tools.md), [docs/work-connectors.md](../docs/work-connectors.md), [docs/documents.md](../docs/documents.md), [docs/sheets.md](../docs/sheets.md), [docs/diagrams.md](../docs/diagrams.md), [docs/document-reader.md](../docs/document-reader.md), [docs/coding-security.md](../docs/coding-security.md), [docs/context-and-skills.md](../docs/context-and-skills.md), [docs/core.md](../docs/core.md), [docs/coding-tools.md](../docs/coding-tools.md), [docs/peer-dependencies.md](../docs/peer-dependencies.md), [docs/host-compositions.md](../docs/host-compositions.md), plan [054](054-Package-Consolidation-Proposal.md) (work-under-core layering), plan [081](081-Connected-Apps-Mcp-Host-And-Work-Http.md)
      - Agent Skills standard: https://agentskills.io/
      - Hermes MIT skills: https://github.com/NousResearch/hermes-agent (`skills/productivity/docx|xlsx|powerpoint`)
      - Anthropic proprietary notice: https://github.com/anthropics/skills
      - Docker sandbox image pin: `docs/coding-security.md` (`name@sha256:<64-hex>`, `--pull=never`)
    - Options Considered:
      - 12th package `@arnilo/prism-work` beside office — rejected (count + split).
      - Keep work in core because enterprise-postgres needs `IdempotencyStore` — rejected as a package split; keep the **postgres adapter** in core, type-only coupling (see Chosen).
      - Author Prism SKILL.md files — rejected by maintainer.
      - Vendor Anthropic document skills — rejected (not OSI).
    - Chosen Approach:
      Frozen vocabulary:
      - Package: `@arnilo/prism-work`
      - Subpaths: `/connectors`, `/connectors/microsoft365`, `/connectors/google-workspace`, `/connectors/drafts`, `/documents`, `/sheets`, `/diagrams`, `/document-reader`, `/tools`, `/sandbox`, `/skills`
      - `createOfficeTools`, `createWorkComposition`, `loadWorkSkills`, `WORK_SANDBOX_IMAGE`
      - Layering: `prism-work` depends on `@arnilo/prism` + `@office-open/*` only. **Not** on `prism-core` or `coding-tools`. Host injects `DisposableSandbox` from coding-tools/security. `createPostgresIdempotencyStore` stays in `core/enterprise/postgres` and implements `IdempotencyStore` **structurally** (`import type` only; value imports of `WorkToolError` / limits become local numbers + `EnterprisePostgresError`). Core never runtime-depends on prism-work.
    - API Notes and Examples:
      ```ts
      // Frozen: work tools already only import @arnilo/prism (not core siblings).
      import { createWorkTools } from "@arnilo/prism-core/integrations/work"; // today
      // after Task 2:
      import { createWorkTools } from "@arnilo/prism-work/connectors";
      ```
    - Files to Create/Edit:
      - `docs/history/083-prism-work-primitive-review.md`
      - `docs/history/README.md` (index the page)
      - this plan (checkbox)
    - References: plan 054 “why work-tools is under core”; `packages/prism-core/src/enterprise/postgres/types.ts` `workIdempotency`; `src/__tests__/packaging.test.ts` 11-package list.
  - Test Cases to Write:
    - Probe: work sources import only `@arnilo/prism` (existing).
    - Probe: `createPostgresEnterpriseState().workIdempotency` matches `IdempotencyStore` methods (existing conformance).
    - Probe: packaging count is 11 including `@arnilo/prism-office`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: `docs/history/083-prism-work-primitive-review.md` only.
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable (history page).

- [x] **Task 2 — Create `@arnilo/prism-work`; git mv; delete `@arnilo/prism-office`; strip old subpaths**
  - Acceptance Criteria:
    - Functional: new workspace package `packages/prism-work` (`@arnilo/prism-work`, same lockstep version). Physical `git mv` of `packages/office/src/{documents,sheets,diagrams}`, `packages/prism-core/src/integrations/work`, `packages/prism-coding-tools/src/document-reader` (tests move with source). `packages/office` directory removed. Core exports `./integrations/work*` deleted. Coding-tools export `./document-reader` deleted; `mammoth` / `pdf-parse` peers move to prism-work. `src/__tests__/packaging.test.ts` and `scripts/package-truth.json` still report **11** publishable names, with `@arnilo/prism-work` instead of `@arnilo/prism-office`. `createReadTool({ documentReader })` still accepts a host-injected reader (interface stays on coding-tools; implementation lives in prism-work). `createPostgresIdempotencyStore` still exported from `@arnilo/prism-core/enterprise/postgres` and still satisfies the moved `IdempotencyStore` shape.
    - Performance: packed size of prism-work ≤ office packed + work dist + document-reader dist + 15% (vendor skills land in Task 7). No new runtime on import of `/connectors` (documents deps must not load).
    - Code Quality: explicit `exports` subpaths; package root does not barrel-export optional peers. `git mv` only — no wrappers, no `@arnilo/prism-office` shim. Import graph test: prism-work ↛ prism-core, prism-work ↛ coding-tools, core ↛ prism-work (runtime).
    - Security: optional peers stay fail-closed at subpath (`mammoth`, `pdf-parse` on `/document-reader` only). Office ZIP/caps/redaction tests move and still pass. Work origin pin / env isolation tests move and still pass.
  - Approach:
    - Documentation Reviewed: [docs/core.md](../docs/core.md) subpath table; [docs/coding-tools.md](../docs/coding-tools.md); [docs/release-and-install.md](../docs/release-and-install.md); npm `exports` / `peerDependenciesMeta`; plan 054 physical-move doctrine.
    - Options Considered:
      - Wrapper package re-exporting old names — rejected (054 cycle risk; pre-1.0 cut).
      - core runtime-depends on prism-work for postgres idempotency — rejected (pulls `@office-open/*` into every enterprise host).
    - Chosen Approach: one family package, subpath isolation matching office today. Postgres adapter stays in core with structural typing.
    - API Notes and Examples:
      ```json
      {
        "name": "@arnilo/prism-work",
        "exports": {
          "./connectors": { "types": "./dist/connectors/index.d.ts", "default": "./dist/connectors/index.js" },
          "./connectors/microsoft365": { "types": "./dist/connectors/microsoft365.d.ts", "default": "./dist/connectors/microsoft365.js" },
          "./connectors/google-workspace": { "types": "./dist/connectors/google-workspace.d.ts", "default": "./dist/connectors/google-workspace.js" },
          "./connectors/drafts": { "types": "./dist/connectors/drafts.d.ts", "default": "./dist/connectors/drafts.js" },
          "./documents": { "types": "./dist/documents/index.d.ts", "default": "./dist/documents/index.js" },
          "./sheets": { "types": "./dist/sheets/index.d.ts", "default": "./dist/sheets/index.js" },
          "./diagrams": { "types": "./dist/diagrams/index.d.ts", "default": "./dist/diagrams/index.js" },
          "./document-reader": { "types": "./dist/document-reader/index.d.ts", "default": "./dist/document-reader/index.js" }
        }
      }
      ```
      `/tools`, `/sandbox`, `/skills` exports are added in later tasks; Task 2 may reserve empty modules or wait — prefer add-when-used so Task 2 pack does not export stubs.
    - Files to Create/Edit:
      - `packages/prism-work/package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`, `LICENSE` (MIT, Prism)
      - `packages/prism-work/src/**` via git mv from office, core/integrations/work, coding-tools/document-reader
      - delete `packages/office/**`
      - `packages/prism-core/package.json` (drop work exports; README)
      - `packages/prism-coding-tools/package.json` (drop document-reader export + mammoth/pdf-parse peers)
      - `src/__tests__/packaging.test.ts`, `scripts/package-truth.mjs`, `scripts/package-truth.json`
      - `packages/prism-core/src/enterprise/postgres/{work-idempotency.ts,types.ts,enterprise.ts,__tests__/*}` (type-only / local errors)
      - `packages/prism-coding-tools/src/__tests__/coding-tools-conformance.test.ts` (drop reader export assert or import from prism-work in a work conformance test)
      - workspace root `package.json` workspaces if needed
      - `templates/business-worker/src/{agent.ts,tests/agent.test.ts}.tmpl`, `examples/enterprise-work-connectors.ts`, `examples/behavior-evaluation.ts`, `examples/scanned-document-rag.ts`, `scripts/fixtures/e2e-full-surface-journey.mjs`
    - References: `src/__tests__/packaging.test.ts` package list; office `package.json` dependencies `@office-open/{docx,xlsx,pptx,xml}`, `ajv`, `fast-xml-parser`.
  - Test Cases to Write:
    - Packaging: 11 names; `@arnilo/prism-work` present; `@arnilo/prism-office` absent.
    - Subpath import: `@arnilo/prism-work/connectors` does not load `@office-open/docx` (graph or side-effect probe).
    - Moved suites: office golden/unit, work-tools, document-reader, mistral-ocr still pass from new paths.
    - Core conformance no longer exports `createWorkTools`.
    - `createPostgresIdempotencyStore` still round-trips a begin/complete record (existing store tests).
  - Verification (2026-09-17): `npm run build`; `npm -w @arnilo/prism-work test`; `npm -w @arnilo/prism-core test`; `npm -w @arnilo/prism-coding-tools test`; `node --test dist/__tests__/docs.test.js dist/__tests__/install-smoke.test.js`; package, e2e-coverage, live-matrix, package-map, and budget gates pass. `@arnilo/prism-work` packs to 96,241 bytes (110 files).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package/export map.
    - Docs pages to create/edit:
      - `docs/work-tools.md`, `docs/work-connectors.md`, `docs/documents.md`, `docs/sheets.md`, `docs/diagrams.md`, `docs/document-reader.md`, `docs/core.md`, `docs/coding-tools.md`, `docs/coding-agent-tools.md`, `docs/peer-dependencies.md`, `docs/release-and-install.md`: replace package names/subpaths.
      - `docs/migrate-to-0.7.md` or the live migrate page on the cut: old→new import table (history narrative stays out of API pages).
    - `docs/index.md` update: yes — Documents / Tools / Core entries: office family becomes prism-work; document-reader moves; work tools move.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 3 — `createOfficeTools` + reader xlsx/pptx (P0 / P1 reader gap)**
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-work/tools` exports `createOfficeTools(options)` returning tools `office_parse`, `office_import`, `office_generate`, `office_patch`, `office_diff`, `office_preview`. Args are typed JSON (kind/format + model or bytes as base64 **or** sandbox-relative path when `filesystem` is provided). `office_generate` returns `{ contentHash, byteLength }` and writes bytes to the host `ArtifactBodyStore` or sandbox path — never echoes raw OOXML into the model transcript. `office_import` returns model + fidelity issues. Caps = existing `resolveDocumentCaps`. `createDocumentReader` default parsers: PDF, DOCX (mammoth), plus **xlsx and pptx via `parseDocument` text extraction** (sheet TSV / slide outline), magic-byte gated, same caps. Unsupported buffer still `null`.
    - Performance: generate 200-block doc still under the documents.md 15 ms warm budget when called through the tool (tool wrapper overhead < 5 ms). Preview HTML still size-capped.
    - Code Quality: wrap existing `generateDocument` / `importDocument` / `patchDocument` / `diffDocument` / `renderPreviewHtml` — no second AST. No `any`. Tool `effect`: parse/import/preview/diff `none`; generate/patch `external_mutation` only when writing a sandbox/artifact path.
    - Security: reject non-PK ZIP before parse (existing). Base64 input bounded by `maxBytes`. Paths `assertPathInsideRoots` when filesystem mode. Redactor option threaded. Macros still not executed. Tool results for parse/import marked untrusted.
  - Approach:
    - Documentation Reviewed: [docs/documents.md](../docs/documents.md) generate/parse/patch; [docs/document-reader.md](../docs/document-reader.md); [docs/tools.md](../docs/tools.md) effect kinds; JSON Schema slice `documentModelSchema({ slice })`.
    - Options Considered:
      - Dump full Draft-07 into tool schemas — rejected (too large). Use kind + slice name.
      - Put office tools on coding `read` — rejected (read is text; generate needs its own tools).
    - Chosen Approach: thin tool facade over the moved library. XLSX/PPTX reader uses `parseDocument` then a small `modelToText` (sheet rows / slide titles+bullets), not mammoth.
    - API Notes and Examples:
      ```ts
      import { createOfficeTools } from "@arnilo/prism-work/tools";
      const tools = createOfficeTools({
        caps: { maxBytes: 8 * 1024 * 1024 },
        redactor,
        artifacts: hostArtifactStore, // optional
        filesystem: { root: "/workspace", readFile, writeFile }, // optional sandbox
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-work/src/tools/office.ts`, `packages/prism-work/src/tools/index.ts`
      - `packages/prism-work/src/document-reader/index.ts` (add xlsx/pptx parsers)
      - `packages/prism-work/src/tools/__tests__/office-tools.test.ts`
      - `packages/prism-work/src/document-reader/__tests__/office-parsers.test.ts`
      - `packages/prism-work/package.json` exports `./tools`
    - References: `packages/office/src/documents/generate.ts`; reader magic-byte gating in `document-reader/index.ts`.
  - Test Cases to Write:
    - generate doc model → hash + bytes round-trip parse equal.
    - import of fixture with vba reports fidelity issue, no throw.
    - oversize base64 refuses before unzip.
    - path outside root refuses.
    - reader: xlsx buffer extracts cell text; pptx extracts slide titles; pdf/docx unchanged; random bytes → null.
    - generate does not put raw zip in `ToolResult.content` (hash only + path/artifact ref).
  - Verification (2026-09-17): `npm test` 5/5; `npm -w @arnilo/prism-work test`; `scripts/e2e-coverage.test.mjs` and `scripts/budget-gate.test.mjs` pass. New `/tools` export is package-gated and covered by `office-tools.test.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new tools subpath; reader formats.
    - Docs pages to create/edit: `docs/documents.md` (tools section), `docs/document-reader.md` (xlsx/pptx), new short `docs/work-office-tools.md` **or** fold into documents.md (prefer fold — one page).
    - `docs/index.md` update: yes — documents blurb mentions office tools; document-reader blurb mentions xlsx/pptx text.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 4 — File get + generate-then-upload (P0 glue)**
  - Acceptance Criteria:
    - Functional: new observation tools `m365_file_get` and `gws_file_get` (capability `files`). Args: provider item id + optional sandbox dest path. Implementation uses **hard-coded** Graph/Drive download URLs (same origin pin as HTTP adapters). Bytes land in `ArtifactBodyStore` and/or sandbox path; result is `{ artifact, byteLength, contentHash, untrusted: true }` — no file bytes in the transcript. `m365_file_draft_add` / `gws_file_draft_add` accept `artifact` or sandbox path **in addition to** host-local `filePath`. Draft digest covers content hash. Approval still required before upload.
    - Performance: `maxFileBytes` / `maxAttachmentBytes` already on `WorkLimits`; download aborts at cap. No extra pagination.
    - Code Quality: extend existing adapters; do not add generic Graph. Reuse `createWorkHttpClient`.
    - Security: origins remain allow-listed (`graph.microsoft.com`, Drive/Gmail Google APIs). Model cannot pass a URL. Tokens only in `Authorization`. Downloaded content untrusted. Share still denies `anyone`.
  - Approach:
    - Documentation Reviewed: [docs/work-tools.md](../docs/work-tools.md); Graph drive item content `GET /me/drive/items/{id}/content`; Drive `files.get` `alt=media`; existing `file.add` argv/HTTP.
    - Options Considered:
      - Stream download through the model — rejected.
      - Graph Excel workbook session for online edit — deferred (P2/not this task; tokens + stateful session).
    - Chosen Approach: hard-coded adapter download → bounded bytes → artifact and optional sandbox path → office tools → SHA-256 hash → draft upload. Hosts supply `ArtifactBodyStore`, sandbox filesystem, and optional attachment scanner; no model URL or local path traversal.
    - API Notes and Examples:
      ```http
      GET https://graph.microsoft.com/v1.0/me/drive/items/{id}/content
      Authorization: Bearer <host token>
      ```
      ```http
      GET https://www.googleapis.com/drive/v3/files/{id}?alt=media
      ```
    - Files to Create/Edit:
      - `packages/prism-work/src/connectors/{types,tools,file-bytes,http,microsoft365-http,google-workspace-http,microsoft365,google-workspace,index}.ts`
      - `packages/prism-work/src/tools/{filesystem,office}.ts`
      - `packages/prism-work/src/connectors/__tests__/{microsoft365-http,google-workspace-http}.test.ts`
      - `docs/{work-tools,work-connectors,index}.md`
      - `scripts/budgets.json` (packed baseline) and generated `docs/package-truth.md`
    - References: `createWorkHttpClient` origin set; `HARD_WORK_LIMITS.maxFileBytes`.
  - Test Cases Written:
    - mocked M365/GWS GET returns bytes, stores SHA-256 artifact, and requires the pinned client origin.
    - over-cap download refuses before storage.
    - `file.add` resolves artifact and sandbox-path content without host-local `filePath`.
    - tool schemas expose no model-supplied URL field; draft upload remains approval-gated.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new ops/tools.
    - Docs pages to create/edit: `docs/work-tools.md` op tables; `docs/work-connectors.md`.
    - `docs/index.md` update: yes — work-tools sentence includes file get / artifact upload.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Verification: `npm run build --workspace @arnilo/prism-work`; `npm test --workspace @arnilo/prism-work`; root and workspace suites passed during `npm test`; refreshed root gate suites passed (263 tests, 0 failures, 2 expected protected-environment skips).

- [x] **Task 5 — GWS content update + missing M365 file.copy tool (P0 GWS stub / P1 adapter gaps)**
  - Acceptance Criteria:
    - Functional: gated ops `docs.update` / `sheets.update` / `slides.update` (same gate style as `docs.create`). Tools `gws_docs_draft_update`, `gws_sheets_draft_update`, `gws_slides_draft_update` — draft-then-approve. Request shapes **fixed**:
      - docs: `{ documentId, replaceAllText?: { containsText, replaceText }, insertText?: { locationIndex, text } }` mapped to allow-listed `documents.batchUpdate` requests only.
      - sheets: `{ spreadsheetId, range, values: string[][] }` → `spreadsheets.values.update`.
      - slides: `{ presentationId, insertText: { objectId, text } }` → allow-listed `presentations.batchUpdate`.
      Model cannot send an arbitrary `requests[]`. M365 `file.copy` already in `DEFAULT_M365_OPS` — add `m365_file_draft_copy`. Planner/Teams remain capability-gated and **unimplemented as tools** (out of scope row).
    - Performance: one HTTP call per approved mutation; existing work limits.
    - Code Quality: hard-coded path builders; no Discovery. Same draft digest/approval as send/add.
    - Security: pinned origins (`docs.googleapis.com`, `sheets.googleapis.com`, `slides.googleapis.com`). External share unchanged. Empty-doc create remains; update is additive.
  - Approach:
    - Documentation Reviewed: Google Docs `documents.batchUpdate`; Sheets `values.update`; Slides `presentations.batchUpdate`; [docs/work-connectors.md](../docs/work-connectors.md) “hard-coded operation maps”.
    - Options Considered:
      - Pass-through `requests` array — rejected (generic Graph/Discovery equivalent).
      - M365 Graph Word API — rejected (weak; local OOXML + upload is the path).
    - Chosen Approach: three fixed shapes + existing draft machinery. Planner/Teams stay demand-gated.
    - API Notes and Examples:
      ```ts
      // allowedOps must include "docs.update" or the tool is omitted (same as docs.create).
      createGoogleWorkspaceHttpAdapter({ identity, tokenProvider, accessEnvVar, allowedOps: [...DEFAULT, "docs.create", "docs.update"] })
      ```
    - Files to Create/Edit:
      - `packages/prism-work/src/connectors/{types,google-workspace,google-workspace-http,microsoft365,microsoft365-http,tools}.ts`
      - matching `__tests__`
    - References: `GATED_GWS_OPS`; `DEFAULT_M365_OPS` includes `file.copy`.
  - Test Cases to Write:
    - without gate, tools absent.
    - docs update builds only `replaceAllText`/`insertText` requests; extra fields refused.
    - sheets update posts range+values; no formula eval on host.
    - file.copy draft requires approval; copies via existing adapter op.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new gated ops.
    - Docs pages to create/edit: `docs/work-tools.md`, `docs/work-connectors.md`.
    - `docs/index.md` update: yes — work-tools blurb mentions gated Docs/Sheets/Slides update.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 6 — Work sandbox image + `createWorkComposition` (all document work in-sandbox)**
  - Acceptance Criteria:
    - Functional: `packages/prism-work/sandbox/Dockerfile` builds an image with: Node 22, Python 3.12, `python-docx`, `openpyxl`, `python-pptx` (pinned), LibreOffice writer/calc/impress, `poppler-utils`, `zip`/`unzip`, Liberation fonts, non-root user. `@arnilo/prism-work/sandbox` exports `WORK_SANDBOX_IMAGE` **digest placeholder documented as host-pinned** (tests use a fixture digest string; CI builds and records digest in evidence). `createWorkComposition({ sandbox, connectors?, office?, reader? })` wires sandbox FS/exec (host must pass a `DisposableSandbox` from `createDockerSandbox` with this image, `network: { mode: "none" }`) + `createOfficeTools` filesystem mode + optional host-side `createWorkTools`. Default env allow-list has **no** `M365_*` / `GOOGLE_*` tokens. Composition reports `networkIsolated` from the injected sandbox capabilities (do not lie).
    - Performance: image build is CI/protected, not `npm test`. Composition construct is in-process (no Docker) when tests inject a fake `DisposableSandbox`.
    - Code Quality: do **not** fork `createDockerSandbox`. Do not import `@arnilo/prism-coding-tools` from prism-work — host injects the sandbox. Dockerfile COPY vendored scripts in Task 7; Task 6 can COPY an empty `/opt/prism-work/skills` dir.
    - Security: default network none. Macros: LibreOffice started with `-env:UserInstallation=file:///tmp/lo-profile` and no macro enable flags. Zip bomb: office caps still apply on parse; sandbox export still uses existing export caps. Secrets: token env keys denied by name if present. No `soffice` listening socket.
  - Approach:
    - Documentation Reviewed: [docs/coding-security.md](../docs/coding-security.md) Docker inputs (digest pin, `--pull=never`, user, network none); Hermes prerequisites (Python 3.10+, openpyxl, python-docx, python-pptx, optional soffice/pdftoppm); LibreOffice headless convert as used in `packages/office/src/documents/__tests__/golden.test.ts`.
    - Options Considered:
      - Run Graph/Gmail **inside** the sandbox with tokens — rejected as default (token theft = tenant mail). Optional later `connectorsInSandbox` is out of scope unless a follow-on asks.
      - Slim image without LibreOffice — rejected for this plan (P2 recalc/QA needs it). One image.
      - Depend on coding-tools from prism-work — rejected (layering).
    - Chosen Approach: image + composition helper; host builds/pins; connectors stay host-side; bytes move via sandbox import/export and office filesystem tools.
    - API Notes and Examples:
      ```ts
      import { createDockerSandbox } from "@arnilo/prism-coding-tools/security";
      import { createWorkComposition, WORK_SANDBOX_IMAGE } from "@arnilo/prism-work/sandbox";

      const sandbox = await createDockerSandbox({
        docker: "/usr/bin/docker",
        image: WORK_SANDBOX_IMAGE, // name@sha256:…
        sourceRoot: workdir,
        user: "65532:65532",
        network: { mode: "none" },
      });
      const { tools, composition } = createWorkComposition({ sandbox, connectors });
      ```
      Dockerfile sketch (not a second runtime):
      ```dockerfile
      FROM node:22-bookworm-slim
      RUN apt-get update && apt-get install -y --no-install-recommends \
            python3 python3-pip python3-venv \
            libreoffice-writer libreoffice-calc libreoffice-impress \
            poppler-utils zip unzip fonts-liberation \
          && rm -rf /var/lib/apt/lists/*
      RUN pip3 install --break-system-packages --no-cache-dir \
            python-docx==X openpyxl==Y python-pptx==Z
      USER 65532:65532
      ```
    - Files to Create/Edit:
      - `packages/prism-work/sandbox/{Dockerfile,soffice.sh}`
      - `packages/prism-work/src/sandbox/{index.ts,composition.ts,image.ts}`
      - `packages/prism-work/src/sandbox/__tests__/composition.test.ts`
      - `packages/prism-work/package.json` export `./sandbox`
      - optional `scripts/work-sandbox-image.test.mjs` gated (`PRISM_TEST_WORK_SANDBOX=1`)
    - References: `createSandboxCodingComposition` as the pattern for `{ tools, composition }`; golden test soffice argv.
  - Test Cases to Write:
    - composition with fake sandbox exposes office tools + execFile; env has no token keys.
    - `WORK_SANDBOX_IMAGE` matches `name@sha256:[a-f0-9]{64}` (CI fills digest; unit test accepts fixture).
    - network mode none required to claim `networkIsolated` (reuse capability rules; composition copies sandbox.capabilities).
    - gated: container `python3 -c "import docx, openpyxl, pptx"`; `soffice --version`; `pdftoppm -h`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — sandbox subpath + image contract.
    - Docs pages to create/edit: new `docs/work-sandbox.md` (API page structure); link from coding-security (sibling, not duplicate Docker docs).
    - `docs/index.md` update: yes — Tools: work sandbox page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 7 — Vendor Hermes MIT skills (no SKILL.md authorship)**
  - Acceptance Criteria:
    - Functional: `scripts/vendor-hermes-skills.mjs` copies **only** `skills/productivity/{docx,xlsx,powerpoint,pdf}` plus each folder’s `scripts/` and `LICENSE` from a **pinned SHA** of `NousResearch/hermes-agent` into `packages/prism-work/vendor/hermes-agent/`. Writes `vendor-lock.json` `{ repo, sha, paths[], license: "MIT" }`. `loadWorkSkills()` reads those `SKILL.md` files with `parseSkillFile`, byte-cap like computer-use-linux (64 KiB per file), asserts names `{docx,xlsx,powerpoint,pdf}`, overlays `toolNames` in TS (sandbox exec + office_*). Pack includes `vendor/` (not tests). Provenance job: `diff` / similarity against `anthropics/skills/skills/{docx,xlsx,pptx,pdf}/SKILL.md`; if Jaccard/token overlap on body exceeds a recorded threshold **or** license headers are Anthropic proprietary, the script **fails** and copies nothing.
    - Performance: loader is sync read of four small files; cap 64 KiB each.
    - Code Quality: zero edits to vendored markdown/scripts. Overlay only in `loadWorkSkills`. NOTICE file quotes MIT copyright.
    - Security: strip any upstream env-key instructions at **loader metadata** if they tell the agent to export secrets (do not edit files — if SKILL.md instructs sending secrets outbound, **fail the vendor script** and do not ship). Scripts run only via sandbox `execFile` (argv, no shell). Zip-symlink: existing office parse + sandbox.
  - Approach:
    - Documentation Reviewed: Hermes LICENSE (MIT, 2025 Nous Research); skill frontmatter `license: MIT`; `parseSkillFile` (`src/contribution-parsing.ts`); `loadComputerUseLinuxSkill`; https://agentskills.io/ progressive disclosure; Anthropic README proprietary notice for document skills.
    - Options Considered:
      - Write Prism skills — rejected.
      - Vendor Anthropic — rejected.
      - `arih04x/office-skills` — fallback only if provenance fail.
      - npm dependency on hermes-agent — rejected (whole agent repo).
    - Chosen Approach: sparse vendor + lockfile + license/provenance gate. `toolNames` overlay:
      ```ts
      const WORK_SKILL_TOOLS = {
        docx: ["office_parse", "office_generate", "office_patch", "office_import"],
        xlsx: ["office_parse", "office_generate", "office_patch", "office_import"],
        powerpoint: ["office_parse", "office_generate", "office_patch", "office_import"],
        pdf: ["office_parse", "office_import"],
      } as const;
      // bash/execFile come from host coding tools in the same sandbox; not listed unless those tools are registered.
      ```
    - API Notes and Examples:
      ```ts
      import { loadWorkSkills } from "@arnilo/prism-work/skills";
      import { createSkillRegistry } from "@arnilo/prism";
      const registry = createSkillRegistry(loadWorkSkills(), { duplicate: "error" });
      ```
    - Files to Create/Edit:
      - `scripts/vendor-hermes-skills.mjs` (`JACCARD_MAX = 0.35`; pin `bbaf7af5c83546d19f8060f4097d3bb25cd1a3c3`; measured overlap 0.16–0.25)
      - `packages/prism-work/vendor/hermes-agent/**` (generated by script, committed; SKILL.md + LICENSE + scripts/ only)
      - `packages/prism-work/vendor-lock.json`
      - `packages/prism-work/THIRD_PARTY_NOTICES`
      - `packages/prism-work/src/skills/{load.ts,index.ts,__tests__/load.test.ts}`
      - `packages/prism-work/package.json` files + `./skills` export
      - Dockerfile COPY vendor to `/opt/prism-work/skills`; image build context is `packages/prism-work` (`-f sandbox/Dockerfile`)
    - References: `packages/prism-coding-tools/src/computer-use-linux/skill.ts`; Hermes skill scripts listed in Expected Outcome.
  - Test Cases to Write:
    - `loadWorkSkills()` returns four names; each has description + instructions from file; `toolNames` overlay present.
    - oversize file throws.
    - vendor-lock SHA is 40-hex; LICENSE text contains “MIT License” and “Nous Research”.
    - vendor script dry-run fails if a required path missing at that SHA.
    - pack list includes vendor SKILL.md and excludes `__tests__`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — skills subpath.
    - Docs pages to create/edit: `docs/context-and-skills.md` (Prism ships these four via prism-work); `docs/work-sandbox.md` (scripts live in the image).
    - `docs/index.md` update: yes — context/skills blurb names the four bundled work skills.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 8 — P2 formula recalc + visual QA inside the work sandbox**
  - Acceptance Criteria:
    - Functional: with `PRISM_TEST_WORK_SANDBOX=1`, a test writes a one-formula xlsx via `xlsx_create.py` or `generateDocument`, runs vendored `xlsx_recalc.py` / equivalent `soffice` headless, and reads a numeric cached value back (not `#REF!`). A one-slide pptx runs `pptx_render.py` or `soffice --convert-to pdf` + `pdftoppm` and asserts at least one PNG exists. Missing binaries skip (not fail) on developer machines; protected CI with the image must run them. In-process Prism still **does not** evaluate formulas (`SheetModel` unchanged).
    - Performance: soffice timeout ≤ 60 s (same as golden test). No soffice on the `npm test` default path.
    - Code Quality: no in-process formula engine. Reuse golden-test soffice argv (`--headless`, isolated `UserInstallation`, `--convert-to pdf`).
    - Security: isolated LO profile dir in `/tmp` inside container; deleted after. Network still none (recalc must not fetch external workbook links — if recalc tries, it fails closed; document that ceiling).
  - Approach:
    - Documentation Reviewed: Hermes `xlsx_recalc.py` / `pptx_render.py` behavior; `packages/office/src/documents/__tests__/golden.test.ts`; documents.md “formulas are preserved verbatim”.
    - Options Considered:
      - Graph Excel calculate session — rejected (tokens in a stateful API).
      - JS formula engine — rejected.
    - Chosen Approach: binaries in the Task 6 image + vendored scripts.
    - API Notes and Examples:
      ```bash
      soffice --headless -env:UserInstallation=file:///tmp/lo-profile --convert-to pdf --outdir /tmp/out /workspace/out.xlsx
      pdftoppm -png -r 100 /tmp/out/out.pdf /tmp/out/page
      ```
    - Files to Create/Edit:
      - `packages/prism-work/src/sandbox/__tests__/recalc-render.gated.test.ts` (`PRISM_TEST_WORK_SANDBOX=1`; docker `-f` is context-absolute; `--out` to a uid-65532 file; no in-process formula engine)
      - `scripts/work-sandbox-image.test.mjs` (`-f packages/prism-work/sandbox/Dockerfile`)
      - `docs/work-sandbox.md` (recalc/QA section)
      - `docs/documents.md` (runtime eval still out of process; sandbox path)
    - References: golden test; Hermes xlsx “LibreOffice computes every formula”.
  - Test Cases to Write:
    - gated recalc: `=SUM(1,2)` → 3 after recalc.
    - gated render: pptx → ≥1 png.
    - default `npm test` does not invoke soffice.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented sandbox QA path (behavior of hosted work), not a new JS API.
    - Docs pages to create/edit: `docs/work-sandbox.md`, `docs/documents.md` formula paragraph.
    - `docs/index.md` update: no — no new page; sandbox page already indexed in Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 9 — P1 AST ceilings that skills cannot fix (decimal generate, real lists)**
  - Acceptance Criteria:
    - Functional: `generateXlsxBytes` emits canonical decimal cell values without `Number()` coercion (fix the existing ponytail comment in `translate/xlsx.ts`). Round-trip of `{ type: "decimal", value: "1500000.00" }` preserves the string. Doc lists generate as OOXML numbering (`w:numPr`), not a `• ` prefix, for `list` blocks already in `DocModel`. No charts/pivots/comments/headers — still fidelity-reported drops.
    - Performance: generate budget unchanged (documents.md 15 ms / 100 ms parse).
    - Code Quality: smallest translate-layer fix; no new model kinds.
    - Security: unchanged ZIP caps.
  - Approach:
    - Documentation Reviewed: [docs/documents.md](../docs/documents.md) decimal fidelity ceiling; office `translate/xlsx.ts` ponytail comment; list block in `DocModel`.
    - Options Considered:
      - Full Word numbering engine / chart ML — rejected (YAGNI; skills+python-pptx/openpyxl cover rich files in sandbox).
    - Chosen Approach: two generate bugs only. Rich edits of existing third-party files go through Hermes scripts in the sandbox, not the AST.
    - API Notes and Examples:
      ```ts
      const model = { kind: "sheet", sheets: [{ name: "s", rows: [[{ type: "decimal", value: "1500000.00" }]] }] };
      const { bytes } = await generateDocument(model, { format: "xlsx" });
      const parsed = await parseDocument(bytes, { kind: "sheet" });
      // parsed cell value === "1500000.00"
      ```
    - Files to Create/Edit:
      - `packages/prism-work/src/documents/translate/xlsx.ts` (and docx list translate)
      - existing generate/parse tests + one decimal generate assertion
    - References: sheets ingest already decimal-safe; generate path is the hole.
  - Test Cases to Write:
    - decimal generate round-trip.
    - list block → numbering XML present; no leading `•` in `w:t`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — generate fidelity (behavior of existing API).
    - Docs pages to create/edit: `docs/documents.md` list/decimal sentences (current contract, no “plan 083 adds”).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 10 — P3 legacy binary convert in sandbox only**
  - Acceptance Criteria:
    - Functional: documented sandbox recipe: `soffice --headless --convert-to docx|xlsx|pptx` for `.doc`/`.xls`/`.ppt`, then `office_parse`. Prism AST still refuses non-ZIP packages (`isZipContainer`). Encrypted OOXML still dropped. No new JS parsers for OLE `.doc`.
    - Performance: gated only.
    - Code Quality: no new package API required; a test in the gated sandbox suite is enough.
    - Security: convert inside the work image, network none, isolated LO profile. Do not enable macros.
  - Approach:
    - Documentation Reviewed: documents.md ZIP signature gating; Hermes docx “Not for `.doc`” / xlsx “use LibreOffice to convert first”.
    - Options Considered:
      - antiword / catdoc in-process — rejected.
    - Chosen Approach: soffice in sandbox; AST unchanged.
    - API Notes and Examples:
      ```bash
      soffice --headless -env:UserInstallation=file:///tmp/lo-profile --convert-to docx --outdir /workspace /workspace/legacy.doc
      ```
    - Files to Create/Edit:
      - `packages/prism-work/src/sandbox/__tests__/legacy-convert.gated.test.ts`
      - `docs/work-sandbox.md` (legacy convert)
      - `docs/documents.md` (legacy still not in AST)
    - References: Task 6 image.
  - Test Cases to Write:
    - gated (`PRISM_TEST_WORK_SANDBOX=1`): generate a tiny docx, `soffice --convert-to doc`, then `--convert-to docx`; `parseDocument` accepts the PK zip. No committed OLE fixture.
    - in-process: OLE `.doc` magic bytes still fail `parseDocument` (`isZipContainer` false).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented sandbox behavior.
    - Docs pages to create/edit: `docs/work-sandbox.md`, `docs/documents.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 11 — Docs index, examples, budgets, graft**
  - Acceptance Criteria:
    - Functional: all live docs use `@arnilo/prism-work/...`. `docs/index.md` navigation matches prism-wiki rules (one-sentence current-line blurbs, no plan numbers). `templates/business-worker` and work examples compile against new imports. `scripts/package-truth` 11 packages. Export ceilings recorded vs Task 1 baseline; raise only with evidence. `graft build` after the move. Root `npm test` 5/5.
    - Performance: root packed baseline regression recorded; prism-work pack includes vendor but not tests/maps.
    - Code Quality: no leftover `@arnilo/prism-office` or `prism-core/integrations/work` in `packages/`, `src/`, `docs/` (except history/migrate tables).
    - Security: peer-dependencies matrix moved mammoth/pdf-parse to prism-work; no new network peers.
  - Approach:
    - Documentation Reviewed: prism-wiki.md API page structure; [docs/index.md](../docs/index.md); [docs/peer-dependencies.md](../docs/peer-dependencies.md).
    - Options Considered: n/a (consistency).
    - Chosen Approach: current-line docs only; migration table on the live migrate page.
    - API Notes and Examples:
      ```bash
      rg -n "@arnilo/prism-office|integrations/work|coding-tools/document-reader" packages src docs templates examples
      graft build
      ```
    - Files to Create/Edit:
      - remaining docs/index/migrate/README/CHANGELOG
      - `scripts/budgets.json` if export counts move
      - `docs/history/README.md` already indexed in Task 1
    - References: packaging.test.ts; plan 068 current-line vs history.
  - Test Cases to Write:
    - docs.test / packaging already fail on stale index — keep them green.
    - rg gate or packaging test: retired names absent from publishable exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — navigation.
    - Docs pages to create/edit: `docs/index.md` and any stragglers from Tasks 2–10.
    - `docs/index.md` update: yes — final pass.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Compromises Made

- Anthropic production document skills are proprietary — not shipped. Hermes MIT pack is the OSI stand-in (CLI scripts, not unzip-XML). Provenance gate may block the vendor copy; then this plan stops on Task 7 rather than rewriting skills.
- No Prism-authored work-connector skill. Draft/approve procedure stays in tool descriptions (already reviewable as code).
- Connector HTTP stays on the **host**. Sandbox default has no tokens and no network. “All work processes in one VM including mail send” is a follow-on, not this plan.
- `createPostgresIdempotencyStore` stays in core (structural `IdempotencyStore`) so enterprise-postgres does not install `@office-open/*`.
- In-process formula engine, Graph Word/Excel sessions, Planner/Teams tools, comments/charts/pivots in the AST, OT/CRDT — out of scope. Sandbox Python + LibreOffice is the rich path.
- One work image **with** LibreOffice (large). No slim variant in this plan.
- Pre-1.0: no `@arnilo/prism-office` shim. Exact old pins keep working until hosts upgrade.

## Further Actions

- **P2 Excel numeric cells.** Generated decimal strings round-trip as shared strings, not `t="n"`. Excel SUM on Prism-generated decimals needs sandbox/openpyxl until a zip rewrite lands. Priority: demand-gated.
- **P3 .xls/.ppt gated convert.** Task 10 covers `.doc` round-trip in the work image; other OLE filters untested. Priority: low.
- **Slim work image.** One LibreOffice image ships; a no-LO variant is out of this plan. Priority: size/CI time.
- **Connector HTTP in the sandbox.** Tokens stay on the host. “One VM including mail send” is a follow-on. Priority: product.
- **AST charts/pivots/comments/headers.** Fidelity-reported drops; skills/Python cover the rich path. Priority: demand-gated.
