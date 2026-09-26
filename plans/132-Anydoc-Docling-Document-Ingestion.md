# Plan 132: Local Document Ingestion with anydoc and Docling OCR, then Release 0.12.0

Owns the 0.12.0 cut transferred from [Plan 129](129-Release-0-12-0.md). Complete
Plans [127](127-Bun-Runtime-Concurrency-Performance.md) and
[128](128-Test-Import-Migration.md), plus Tasks 1–4 here, before version bump/readiness/publish.
Plan 129 is a historical pointer, not a second release queue.

## Objectives

- Offer hosts an opt-in, bounded document-to-Markdown route in `@arnilo/prism-work`: local anydoc conversion first; locally deployed Docling OCR only for scanned PDFs or explicitly selected images.
- Use that route for `@arnilo/prism-memory/wiki` source ingestion and, through its existing parser seam, RAG. Preserve original bytes, untrusted-content labeling, and host control of execution.
- Keep `@arnilo/prism-work/documents`' editable OOXML models, default document reader, Firecrawl web adapters, and existing Mistral OCR untouched.
- Ship this capability in 0.12.0 alongside the Bun-only runtime/SQLite migration: version, document, verify, then publish the same source tree.

## Expected Outcome

- A host with optional `@firecrawl/anydoc` and a locally provisioned Docling worker can ingest supported Word, spreadsheet, presentation, OpenDocument, RTF, EPUB, CSV, and text-based PDF sources as structured Markdown; scanned PDFs and explicitly enabled images use Docling OCR.
- No OCR service call, Python/model install, network fetch, or extra cost occurs on default paths. A missing dependency, encrypted/unsupported document, failed/partial OCR, or exceeded cap fails explicitly rather than indexing incomplete content.
- Wiki still writes immutable `source.*` and bounded `extract.md`; RAG can consume the same host-selected converter without depending on either external package.
- **Not a universal-format guarantee:** encrypted files, unsupported inputs, inaccurate OCR, unavailable languages/models, and pathological documents can still fail; coverage is validated against a fixture matrix, not asserted from vendor marketing.
- Tag `v0.12.0` and publish provenance-attested artifacts containing the new work subpath/Docling helper and Bun-only migration; a clean Bun consumer imports them without installing Python or enabling OCR.

## Tasks

- [x] Task 1: Review extraction primitives and verify runtime/dependency feasibility
  - Acceptance Criteria:
    - Functional: record current `documents/parse`, `document-reader`, wiki PDF/image/unknown hooks, RAG `Parser`, and sandbox seams; identify exactly where a host-selected Markdown converter fits. Confirm anydoc's `needsOcr` error, format detection/CSV behavior, and Markdown output under Prism's supported Bun runtime; confirm Docling `DocumentStream`, page limit, success status, and offline OCR on a real scanned fixture before freezing the API.
    - Performance: record baseline time, memory, output size, and model cold-start for small text PDF, office file, scanned PDF, and image; establish bounded regression thresholds for later tasks rather than adopting upstream benchmark claims.
    - Code Quality: decide one shared conversion result (`markdown`, source format, OCR-used flag, actual pages only when known); avoid an alternate editable document model and avoid a new memory-to-work dependency.
    - Security: inventory native-binary compatibility, Python/model supply chain, sandbox/egress requirements, page and byte caps, `needsOcr`-only fallback, and behavior on partial OCR or PDF with mixed text/scanned pages. Record which properties cannot be attested by anydoc's Markdown-only API.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-work/src/document-reader/index.ts`, `packages/prism-work/src/documents/parse.ts`, `packages/prism-work/src/sandbox/composition.ts`, `packages/memory/src/wiki/ingest.ts`, `packages/memory/src/rag/types.ts`, `docs/document-reader.md`, `docs/wiki.md`, `docs/rag.md`.
      - [anydoc Node API and error codes](https://github.com/firecrawl/anydoc/blob/main/node/README.md), [Node declarations](https://github.com/firecrawl/anydoc/blob/main/node/anydoc.d.ts), [supported formats and OCR boundary](https://github.com/firecrawl/anydoc/blob/main/README.md).
      - [Docling advanced options: streams, limits, offline models](https://docling-project.github.io/docling/usage/advanced_options/), [Docling converter reference](https://docling-project.github.io/docling/reference/document_converter/), [CLI OCR options](https://docling-project.github.io/docling/reference/cli/).
    - Options Considered:
      - Replace `parseDocument` or default `DocumentReader`: loses editable fidelity or changes page-cap semantics; reject.
      - Reuse Wiki `extractDocument` and RAG `Parser` with a new work-family converter: smallest compatible surface; choose.
    - Chosen Approach: write a short primitive review and a disposable runtime probe; settle format routing and documented limitations before package changes. No new core primitive unless probe proves a reusable missing seam.
    - Findings (2026-09-26, evidence in `docs/history/132-document-ingestion-primitive-review.md`):
      - No new core primitive. `WorkSandbox.execFile` has no stdin, so Docling uses a host runner callback. Do not wrap anydoc as `DocumentParser` (success has no page count).
      - Shared result: `{ markdown, format, ocrUsed, pages? }`. Omit `pages` unless the engine reported it. Wiki hook stays `{ text, format }`.
      - anydoc 0.2.4 on Bun 1.4.2: CSV needs an explicit format; `needsOcr` has `pages` and `pageCount` and no markdown (mixed PDF included); default path made no network call. Never expose `ocr: 'hosted'`.
      - Docling 2.130.0 on Python 3.14: pin `RapidOcrOptions(backend="torch")` (auto selected that only after nemotron/onnxruntime/easyocr were absent). CPU torch index, not the default CUDA wheel. Prefetch ~1.4 GiB / 150 s. Accept only `ConversionStatus.SUCCESS` — `raises_on_error` still returns `partial_success`. `DocumentStream` plus explicit `max_num_pages` / `max_file_size`.
      - Wiki: hook-first for PDF and for `.csv` when a host extractor is set. Images never call the hook today. No-hook behavior stays.
    - API Notes and Examples:
      ```ts
      // Existing host seams; no change required to either interface.
      createWikiExtension({ extractDocument: async ({ bytes, filename }) => /* converted result or null */ null });
      // replaceDocument({ ..., parser: hostSelectedParser });
      ```
    - Files to Create/Edit:
      - `docs/history/132-document-ingestion-primitive-review.md`: inventory, dependency/Bun probe, fixture results, threat model, and accepted scope.
    - References: `packages/memory/src/wiki/types.ts`, `packages/memory/src/rag/parsers.ts`, `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - Probe: real anydoc on Bun with DOCX, CSV (explicit format), text PDF, and scanned PDF; record exact errors and supported native targets.
    - Probe: Docling with prefetched models, remote services disabled, scanned PDF/image, page limit, and partial/failed conversion status.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — research only.
    - Docs pages to create/edit: `docs/history/132-document-ingestion-primitive-review.md` (historical evidence, not a current API page).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (current-line vs history).

- [x] Task 2: Build optional, local anydoc Markdown extractor in work family
  - Acceptance Criteria:
    - Functional: exported host-selected converter accepts bytes and an optional filename; detects signed formats from content, uses filename only for signature-less CSV, returns bounded Markdown and provenance; throws a distinct `needsOcr` signal for scanned PDFs. Never silently falls back on encrypted, malformed, resource-limit, or unsupported errors.
    - Performance: input <= 32 MiB and output <= 2 MiB by default (configurable only within documented hard ceilings); cap input before native invocation, enforce output after invocation, limit in-flight conversions and honor abort before/after native work. Measure peak memory and elapsed time against Task 1 baseline; native work cannot be preempted by an AbortSignal alone, so document that ceiling.
    - Code Quality: lazy-load optional peer only on extractor creation; no anydoc import at work-family or `documents` module load; expose a single cohesive API, no generic provider registry.
    - Security: conversion is local with no hosted OCR option; no environment API key read, executable macro handling, or implicit network access. Map upstream error codes to stable, content-free Prism errors and label output untrusted at consuming boundaries.
  - Approach:
    - Documentation Reviewed: [anydoc `toMarkdownBytes`, `formatFromBytes`, `formatFromPath`, `needsOcr`](https://github.com/firecrawl/anydoc/blob/main/node/README.md); [anydoc Node options: `ocr: 'reject'` default](https://github.com/firecrawl/anydoc/blob/main/node/anydoc.d.ts); `packages/prism-work/src/document-reader/index.ts`.
    - Options Considered:
      - Depend on anydoc for all work hosts: unnecessary native dependency; reject.
      - Optional peer behind a dedicated work subpath: host-selected and isolated; choose.
    - Chosen Approach: create `@arnilo/prism-work/document-extraction` with optional peer `@firecrawl/anydoc@0.2.4`, one byte-oriented conversion operation, strict byte limits, and explicit `needsOcr` classification (`pages`, `pageCount`, no markdown). CSV is explicit format only (`formatFromBytes` is null). Never pass `ocr: 'hosted'` or read `FIRECRAWL_API_KEY`. Do not add `DocumentParser` integration — Task 1 showed success Markdown has no page count, so `maxPages` cannot be enforced truthfully. Retain reader defaults and `documents` contracts. Later-task anydoc budget: under 500 ms and 128 MiB VmHWM for fixtures under 10 KiB.
    - API Notes and Examples:
      ```ts
      import { toMarkdownBytes, formatFromBytes, formatFromPath } from '@firecrawl/anydoc';
      const format = formatFromBytes(bytes) ?? (filename?.toLowerCase().endsWith('.csv') ? formatFromPath(filename) : null);
      if (format === null) throw new Error('unsupported format');
      const markdown = await toMarkdownBytes(bytes, format); // never { ocr: 'hosted' }
      ```
    - Files to Create/Edit:
      - `packages/prism-work/src/document-extraction/index.ts`: bounded public API and error classification.
      - `packages/prism-work/src/document-extraction/__tests__/anydoc.test.ts`: opt-in, formats, errors, caps, abort and import isolation.
      - `packages/prism-work/package.json`: new isolated subpath, optional peer and dev dependency; add built tests to package test command.
      - `bun.lock`: dependency resolution if required by package install.
      - `docs/document-extraction.md`, `docs/index.md`, `packages/prism-work/README.md`: public API, install, limits and navigation.
      - Also: `docs/peer-dependencies.md`, `docs/release-and-install.md`, `packages/prism-work/CHANGELOG.md`, `scripts/package-truth.mjs` (inventory note), `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`. Those lists freeze the subpath and peer set.
    - References: `packages/prism-work/src/document-reader/errors.ts`, `docs/peer-dependencies.md`.
  - Test Cases to Write:
    - Real fixtures for DOCX/PPTX/XLSX/CSV/PDF plus representative legacy/ODF fixture; assert heading/table/slide-text preservation rather than vendor benchmark score.
    - `needsOcr` retains original diagnostic category; unsupported/encrypted/corrupt input never invokes OCR; oversized input/output and missing optional peer fail closed; imports of unrelated subpaths work without peer.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new optional extraction subpath.
    - Docs pages to create/edit: `docs/document-extraction.md`, `docs/peer-dependencies.md`, `packages/prism-work/README.md`.
    - `docs/index.md` update: yes — link under documents/sheets/diagrams with one current-contract sentence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Offer host-run Docling OCR as narrow, offline fallback
  - Acceptance Criteria:
    - Functional: first-party Docling helper converts bounded scanned PDF or image bytes to Markdown; reports actual PDF pages and refuses unsuccessful/partial conversions. Work-family orchestration invokes it only on anydoc `needsOcr` for PDFs or when host explicitly selects image OCR; no fallback for other errors or successful local conversions.
    - Performance: default one OCR job in flight, bounded input/output, page count, worker wall time, and worker stdout/stderr; cold model startup and CPU/RAM cost documented. Abort terminates worker through host runner; no uncapped queue or orphan process.
    - Code Quality: Python/Docling remain host-provisioned, not npm dependencies. First-party helper has a fixed JSON success/error protocol and uses stream bytes, not document URLs; host-supplied process/sandbox runner owns lifecycle and isolation. No duplicate conversion engine.
    - Security: host pins Python/Docling/model versions, runs untrusted inputs in a contained worker with egress disabled and prefetched artifacts, passes no ambient secrets, rejects path/URL input and remote services/plugins, enforces filename/format allow-list, and scrubs temporary material. Distinguish failed/partial OCR from valid empty text; never send documents to Firecrawl Parse by default.
  - Approach:
    - Documentation Reviewed: [Docling `DocumentStream`, `max_num_pages`, `max_file_size`, `artifacts_path`](https://docling-project.github.io/docling/usage/advanced_options/), [Docling converter reference](https://docling-project.github.io/docling/reference/document_converter/), [Docling CLI local OCR, `--ocr-mode`, `--enable-remote-services` default false](https://docling-project.github.io/docling/reference/cli/); [anydoc scanned PDF behavior](https://github.com/firecrawl/anydoc#ocr); `docs/work-sandbox.md`.
    - Options Considered:
      - anydoc `ocr: 'hosted'`: sends entire PDF to Firecrawl Parse; reject as default privacy/cost policy.
      - Spawn Python directly inside Prism process by default: weak isolation for untrusted documents; reject.
      - Ship a small Python helper and host-injected contained runner: local control without Python in npm graph; choose.
    - Chosen Approach: helper reads bounded stdin PDF/image bytes (not `WorkSandbox.execFile` — that request has no stdin). Construct `DocumentStream(name, BytesIO)`; name suffix is `.pdf` or an allow-listed image. Pin `RapidOcrOptions(backend="torch")` with `artifacts_path` from `download_models` (layout, tableformer, code-formula, RapidOcr torch `ch` models; ~1.4 GiB). `enable_remote_services=False`. Do not leave `OcrAutoOptions` (this host selected torch only because nemotron, onnxruntime, and easyocr were absent). `convert(..., max_num_pages, max_file_size)` — both default to `sys.maxsize`. Accept only `ConversionStatus.SUCCESS`; `raises_on_error=True` still returns `partial_success` (timeout probe). `pages` from `document.num_pages()`. Images use `ImageFormatOption`, PDFs `PdfFormatOption`. Host pins `docling==2.130.0` and CPU torch (`https://download.pytorch.org/whl/cpu`) unless it explicitly wants CUDA; default PyPI torch pulls nvidia wheels. Later-task OCR budget after prefetch: under 30 s and 4 GiB VmHWM for inputs under 100 KiB. PDF vs PNG markdown is not byte-identical.
    - API Notes and Examples:
      ```python
      from io import BytesIO
      from docling.datamodel.base_models import DocumentStream, InputFormat, ConversionStatus
      from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
      from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
      opts = PdfPipelineOptions(
          artifacts_path='/opt/docling/models',  # download_models(); ~1.4 GiB
          enable_remote_services=False,
          ocr_options=RapidOcrOptions(backend='torch'),  # not OcrAutoOptions
          document_timeout=120,
      )
      converter = DocumentConverter(
          allowed_formats=[InputFormat.PDF, InputFormat.IMAGE],
          format_options={
              InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
              InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts),
          },
      )
      result = converter.convert(
          DocumentStream(name='input.pdf', stream=BytesIO(pdf_bytes)),  # suffix selects format; no URL
          max_num_pages=32,  # default is sys.maxsize
          max_file_size=8 * 1024 * 1024,
          raises_on_error=False,  # True still returns partial_success
      )
      if result.status != ConversionStatus.SUCCESS:
          raise RuntimeError('OCR failed or incomplete')
      markdown = result.document.export_to_markdown()
      pages = result.document.num_pages()
      ```
    - Files to Create/Edit:
      - `packages/prism-work/docling/ocr.py`: packaged, fixed-protocol local Docling worker (PDF and explicitly supported image inputs).
      - `packages/prism-work/src/document-extraction/index.ts`: opt-in OCR fallback and host-runner contract.
      - `packages/prism-work/src/document-extraction/__tests__/docling.test.ts`: runner/protocol/routing/security tests.
      - `packages/prism-work/package.json`: include helper in package files.
      - `docs/document-extraction.md`, `docs/work-sandbox.md`, `packages/prism-work/README.md`: provisioning, sizing, containment and runner example.
      - Also: `docs/index.md`, `packages/prism-work/CHANGELOG.md`, `src/__tests__/packaging.test.ts` (pack list includes `docling/ocr.py`).
    - References: `packages/prism-work/src/document-reader/mistral-ocr.ts` (separate existing OCR choice); `packages/prism-work/src/sandbox/composition.ts` (host-selected isolation capabilities).
  - Test Cases to Write:
    - Fake runner verifies zero invocations for local text PDF and anydoc errors other than `needsOcr`; scanned/mixed PDF and explicit image OCR invoke it once.
    - Runner timeout/abort, excessive stdout, nonzero exit, malformed response, missing models, partial conversion and over-page input fail without staged partial text; real gated offline fixture checks no network and no hosted API requests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — opt-in OCR/runner surface and resource cost.
    - Docs pages to create/edit: `docs/document-extraction.md` (one OCR job per scanned document, cold-start/CPU cost; default no OCR), `docs/work-sandbox.md`.
    - `docs/index.md` update: yes — update document-extraction entry to include optional local OCR.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Wire opt-in Wiki/RAG ingestion and verify packed host journey
  - Acceptance Criteria:
    - Functional: host composition uses the new converter via Wiki `extractDocument` and RAG `Parser` without new memory dependency. With a host extractor, Wiki tries it **before** its limited PDF built-in (mixed PDFs otherwise index text pages and skip the scan) and **before** CSV UTF-8 passthrough (`.csv` never reaches the hook today). A declined/failed explicitly selected PDF, CSV, or image extraction refuses rather than falling back. With no hook, existing PDF, CSV, and image behavior is unchanged. Explicitly selected image OCR replaces image stub only on success. Source remains immutable and `extract.md` remains UTF-8, capped, and labeled untrusted.
    - Performance: retain Wiki 32 MiB input / 2 MiB extract defaults and RAG parser limits; record extraction duration and OCR count without document bodies. Require bounded run time and memory evidence for packed end-to-end fixtures.
    - Code Quality: adapt result to existing Wiki and RAG interfaces; no new CLI option, hosted API, or duplicate ingestion pipeline. Keep package imports isolated; only introduce memory changes needed for hook precedence/image selection.
    - Security: reject partial OCR and oversized results before Wiki writes source/extract or RAG indexes chunks; avoid fetching links embedded in Markdown, preserve URL SSRF check and `untrusted_external` metadata. Staged raw source and extracts must never carry worker secrets.
  - Approach:
    - Documentation Reviewed: `packages/memory/src/wiki/ingest.ts`, `packages/memory/src/wiki/types.ts`, `packages/memory/src/rag/types.ts`, `packages/memory/src/rag/sources.ts`, `docs/wiki.md`, `docs/rag.md`, `docs/document-reader.md`.
    - Options Considered:
      - Import work package directly into memory: violates family isolation; reject.
      - Change the host-facing Wiki hook signature: not needed; reject.
      - Host adapter plus minimal hook-precedence fix: choose.
    - Chosen Approach: expose a documented host composition that translates `{ markdown, format }` to Wiki `{ text, format }` and RAG `{ text, metadata }`. When the host extractor is set, call it before the PDF built-in and before CSV UTF-8 passthrough; null/failure on those selected inputs writes no `source.*` or `extract.md`. No-hook paths stay as they are. Do not raise RAG `HARD_MAX_PARSE_MS_CAP` (30 s) — small warm scans fit, but Docling RSS was ~2 GiB, so default CI uses a fake runner and the packed OCR fixture stays gated. Add a real packed-consumer test using a prefetched local worker; leave standalone `prism-wiki ingest` unchanged until a host-owned injection mechanism exists.
    - API Notes and Examples:
      ```ts
      // Illustrative host composition; exact factory name finalized after Task 1.
      const extractDocument = async ({ bytes, filename }: WikiIngestHookInput) => {
        const result = await converter.convert({ bytes, filename });
        return result ? { text: result.markdown, format: result.format } : null;
      };
      const wiki = createWikiExtension({ extractDocument });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/wiki/ingest.ts`: opt-in PDF hook precedence and explicit image OCR selection; no default change.
      - `packages/memory/src/wiki/__tests__/ingest.test.ts`: PDF/mixed/image, hook refusal, staging and caps.
      - `scripts/document-ingestion-packed.test.mjs`: cross-package packed host journey (or existing packed-consumer suite if more economical).
      - `docs/wiki.md`, `docs/rag.md`, `docs/document-extraction.md`, `docs/index.md`: integration, limits, trust and navigation.
      - `packages/memory/README.md`, `packages/prism-work/README.md`: optional host wiring.
      - Also: `packages/memory/src/wiki/types.ts` (`ocrImages`), `packages/memory/CHANGELOG.md`, `packages/prism-work/CHANGELOG.md`, `packages/prism-work/src/document-extraction/__tests__/ingest-adapter.test.ts`. `createDocumentIngest` lives on the extraction subpath so memory does not import work. Compat diff: additions only, no baseline regen. `release:gate` still stops on the pre-existing blocked postgres evidence surface.
    - References: `packages/memory/src/wiki/tools/ingest.ts`, `packages/memory/src/wiki/commands/ingest.ts`, `packages/memory/src/wiki/cli.ts`; `scripts/packaging-current.test.mjs`.
  - Test Cases to Write:
    - Wiki stages real text PDF, mixed/scanned PDF, CSV, and image with hook; without hook preserves PDF/CSV/image prior behavior. When hook rejects or returns null on selected PDF/CSV/image, no `source.*`, `extract.md`, or wiki log is written.
    - RAG indexes converted Markdown with provenance and untrusted metadata, never indexes failed/partial OCR; packed test confirms optional peer absence does not break unrelated work/memory imports.
    - Run targeted work/memory tests, typecheck, package dry run and `release:gate`; inspect API diff for additions only. If any public export is removed or renamed during execution, explicitly regenerate compat baseline with `node scripts/release.mjs gate --update-baseline`, review `scripts/compat-baseline/` and post-regeneration `release:gate` diff, separating inherited removals from this plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — opt-in Wiki PDF/image behavior and documented RAG composition.
    - Docs pages to create/edit: `docs/wiki.md`, `docs/rag.md`, `docs/document-extraction.md`, `docs/index.md` (current behavior only; any release narrative belongs in `CHANGELOG.md`).
    - `docs/index.md` update: yes — update Wiki/RAG and document-extraction entries with one-sentence current contracts.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Version bump and lockfile truth (transferred from Plan 129 Task 1)
  - Notes (executed): `bun scripts/release.mjs bump --from 0.11.1 --to 0.12.0 --ranges caret` moved all 12 manifests and 11 internal caret ranges, then `bun install --lockfile-only`. Dropped 10 stale lock aliases that still pinned the published `@arnilo/prism@0.11.1` peer (does not satisfy `^0.12.0`). Hand claims: `src/index.ts` version, `docs/index.md` current line, `docs/release-and-install.md` current peer/tarball lines, `.github/workflows/release.yml` tag list plus both `if:` conditions and the publish shell test, compat baseline `version` signature only. `bun scripts/package-truth.mjs --emit-docs` refreshed generated inventory. `@firecrawl/anydoc@0.2.4` stays an optional peer; `docling/ocr.py` is in the work dry-run tarball `arnilo-prism-work-0.12.0.tgz`. `bun audit --audit-level=moderate` clean. `release:check --allow-dirty --allow-untagged` reports all 12 `available`. No tag, commit, or publish.
  - Acceptance Criteria:
    - Functional: after Tasks 1–4 and Plans 127–128, bump all 12 publishable manifests to `0.12.0`; regenerate `bun.lock` once with the chosen optional `@firecrawl/anydoc` version included. `scripts/bun-lock.mjs` and `bun run release:check -- --allow-dirty --allow-untagged` pass with correct peer ranges and no registry collision.
    - Functional: update version-literal gates and refresh `scripts/package-truth.mjs --emit-docs` evidence from the final package graph, including the new subpath, optional peer and packaged helper.
    - Performance: no new startup costs in default package imports; lockfile/manifest changes do not introduce mandatory Python/model dependencies.
    - Code Quality: one consistent version cut, no premature release commit from Plan 129; release package metadata matches built artifact.
    - Security: lock and audit optional native peer, verify helper is packaged only in work family and no network OCR or Python is invoked during install/import.
  - Approach:
    - Documentation Reviewed: `scripts/release.mjs` (`regenerateLockfile`, `validateRelease*`); `packages/prism-work/package.json`; [Bun install/lockfile reference](https://bun.sh/docs/pm/lockfile); Plan 129's original release scope and plan 120 Task 9 cut procedure.
    - Options Considered: version before integration — stale lock and release evidence; reject. Bump after Task 4 — choose.
    - Chosen Approach: perform a single family-wide minor bump after implementation and dependency resolution, then regenerate derived truth.
    - API Notes and Examples: `bun install --lockfile-only && bun run release:check -- --allow-dirty --allow-untagged`.
    - Files to Create/Edit: 12 publishable `package.json` manifests, `bun.lock`, `scripts/package-truth.json` and generated docs evidence, plus version-literal gate fixtures named by failing tests.
    - References: `scripts/version-literal-gate.test.mjs`, `scripts/truth-current.test.mjs`, Plan 129 Task 1 (transferred).
  - Test Cases to Write:
    - Existing version/lockfile/package-truth gates validate final version and optional-peer packaging; clean import of unrelated work subpaths needs no anydoc installation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — released version and new optional package surface.
    - Docs pages to create/edit: release narrative in Task 6; package API contract stays in `docs/document-extraction.md`.
    - `docs/index.md` update: Task 6 (history link; current document-extraction link already in Task 2).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: 0.12.0 migration note, CHANGELOG and documentation voice (transferred from Plan 129 Task 2)
  - Notes (executed): `docs/history/migrate-to-0.12.0.md` covers Bun `>=1.4.2`, Node import failure, `bun add`, `bun:sqlite` Blob/bigint/`undefined`/`get()` mapping, retired `better-sqlite3`, scaffold `packageManager`, release-host `npm pack`/`publish`/`sbom`, and optional anydoc/Docling (no default upload, one OCR job, prefetch). Root `CHANGELOG.md` Unreleased became `## [0.12.0] - 2026-09-26`. `docs/index.md` links the note once. Current `node --test` / `node scripts/` on the named pages became Bun; `benchmark-0.0.*` transcripts keep the command plus `Node-era command`. `docs/migrate-to-0.6.md` `npm test` wording stayed. `src/__tests__/docs.test.ts` pins the link, phrases, and voice.
  - Acceptance Criteria:
    - Functional: `docs/history/migrate-to-0.12.0.md` covers Bun `>=1.4.2` runtime requirement and Node-host failure modes, `bun add`, `bun:sqlite` migration including Blob/bigint mapping, retired `better-sqlite3` peer, scaffold changes, release-host npm exception, and optional anydoc/Docling prerequisites (not required for default hosts).
    - Functional: `CHANGELOG.md` 0.12.0 entry covers both Bun-only migration and new optional local document/OCR route; `docs/index.md` links migration note once from history and documents current extraction contract without release narrative in the API page.
    - Functional: finish Plan 129's current-command voice pass (`node --test`/`node scripts/...` → Bun) in `docs/performance.md`, `docs/mcp-tools.md`, `docs/disaster-recovery.md`, `docs/attention-compiler.md`, `docs/rag.md`, `docs/operations.md`, `docs/openapi-tools.md`, `docs/model-registry.md`, `docs/evaluations.md`, `docs/computer-use-linux.md`, `docs/cli-rpc.md`, `docs/runs-and-usage.md`, usage headers in `scripts/*.mjs`, and `docs/migrate-to-*.md`. Preserve historic transcript commands with an era marker; keep 0.6.0 historical wording.
    - Performance: docs state one OCR job per scanned document, model cold-start/CPU and default no-OCR cost.
    - Code Quality: `src/__tests__/docs.test.ts` checks migration link and current Bun commands; version story belongs in history/CHANGELOG, current contract belongs in API docs.
    - Security: migration guidance states OCR never uploads by default, prefetched model and sandbox/egress requirements, and optional peer trust boundary.
  - Approach:
    - Documentation Reviewed: `docs/history/migrate-to-0.11.md`, `docs/migrate-to-0.5.md`, `docs/document-extraction.md` (Task 2), `.agents/skills/create-plan/references/prism-wiki.md`, Plan 129 Task 2.
    - Options Considered: release recap in API pages — reject per plan 068. One history note and current-line API page — choose.
    - Chosen Approach: write migration from final built package truth, then run docs phrase/link and voice gates.
    - API Notes and Examples: `bun add @arnilo/prism-work @firecrawl/anydoc` is optional; Python/Docling is provisioned only by OCR hosts.
    - Files to Create/Edit: `docs/history/migrate-to-0.12.0.md`, `CHANGELOG.md`, `docs/index.md`, `src/__tests__/docs.test.ts`, current-command pages named above, affected `docs/migrate-to-*.md`, `scripts/*.mjs` usage comments, `docs/document-extraction.md` if installation guidance needs adjustment.
    - References: Plan 125 Task 5 release-host exception and its Plan 129 Task 2 follow-ups; Plan 129 Task 2 (transferred).
  - Test Cases to Write:
    - Docs link and phrase pins cover migration and both features; voice gate excludes only explicitly marked historical transcripts; no current instructions use retired Node commands.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — 0.12.0 installation/migration guidance and current extraction contract.
    - Docs pages to create/edit: history note, `docs/document-extraction.md`, `docs/index.md`, named current-command pages.
    - `docs/index.md` update: yes — one-sentence history link; retain Task 2's current-contract navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7: Verify complete 0.12.0 readiness (transferred from Plan 129 Task 3)
  - Notes (executed): `bun run sdk:ready` on the final Tasks 1–6 tree passes every stage: typecheck, lint, format, `bun run test` (build, performance budget, root suites 2125 tests, sqlite suites, gate suites, build race, workspace suites, examples execution, branch coverage), `test:coverage` (core lines 94.46/functions 95.29 against gates 91.48/92.21, per-package lines thresholds enforced), `pack:dry-run` all 12, then `release:gate` fails closed only on the documented evidence blocker: `bun run test:postgres` prints `PRISM_TEST_POSTGRES_URL is required for bun run test:postgres` and `bun scripts/blocked-gate.mjs` lists 6 protected legs (phase12-restart-recovery, phase22-conformance, phase26-recovery-conformance, phase26-pty-protected, phase27-dr, phase26-coding-journey; 3 release-profile). Packed artifacts: `scripts/document-ingestion-packed.test.mjs` 2 pass (`docling/ocr.py` in the work tarball, no static anydoc import in work/memory dist, wiki+RAG host wiring, real gated OCR leg 8.2 s) and `install-smoke` 15/15 including the work tarball's document subpaths. API diff 0 removed / 0 changed / +25 in `@arnilo/prism-work` — additions only, no `--update-baseline` and no `scripts/compat-baseline/` edit. Evidence label is already `core bun run test` in `scripts/release-skip-manifest.mjs` and `scripts/phase23-skip-manifest.test.mjs`; the `sdk:ready` chain has no `npm run` (pack/publish stay npm on the release host). Budgets: export ceiling `@arnilo/prism-work` 419→442 with a new reason entry (plan 132 Tasks 2–4 document-extraction); suite-budget pin `< 240s` (baseline 200s) unchanged and respected. Security: `security:threat-suites` 83/83, `bun audit --audit-level=moderate` clean over 174 packages, helper/runner contain no token, URL, proxy, or remote-model path, publish argv check (provenance only under `GITHUB_ACTIONS`) plus `release.mjs publish --dry-run --lockstep --version 0.12.0` 12/12 dry-run. Gate fixes required on inherited state: packed-install consumers (`scripts/fixtures/packed-consumer.mjs`, `src/__tests__/install-smoke.test.ts`, `scripts/packaging-current.test.mjs`) pin `overrides` to their tarballs because internal `^0.12.0` ranges are unpublished pre-release; `scripts/dead-exports.mjs` skips `node_modules` (dangling `.bin` links from stale nested 0.11.1 installs crashed the scan); `anydoc.test.ts` dropped its `globalThis.fetch` patch per the network-free guard; `scripts/e2e-coverage.json` regenerated (`./document-extraction` → 111 surfaces, count test updated); inherited dirty-tree files formatted so `format:check` could pass. No edits from Plan 129, no commit, tag, or publish.
  - Acceptance Criteria:
    - Functional: on the final Tasks 1–6 tree run `bun run sdk:ready` end to end (typecheck/lint/format/test/coverage, pack dry-run, `release:gate`), plus `bun run test:postgres` when `PRISM_TEST_POSTGRES_URL` exists or the documented blocked-gate otherwise. Verify packaged `@arnilo/prism-work/document-extraction`, `docling/ocr.py`, and Wiki/RAG host wiring from packed artifacts; no pre-132 readiness transcript counts.
    - Functional: inspect public API diff: new exports are additive; no baseline regeneration for additions. For any removal/rename, attribute it to this plan versus inherited work, list changed `scripts/compat-baseline/` files, run `node scripts/release.mjs gate --update-baseline` on the release host only after review, then record post-regeneration `release:gate` diff.
    - Functional: replace pinned `core npm test` release-evidence label with `core bun run test` in `scripts/release-skip-manifest.mjs`, `scripts/phase23-skip-manifest.test.mjs`, and evidence format before readiness transcript; confirm no `npm run` links in `sdk:ready` chain.
    - Performance: respect plan 124 suite-budget method; include new tests and measured OCR cost in re-measured suite gate, never silently re-pin an existing ceiling.
    - Code Quality: no edits from Plan 129 executed separately; all gates run against same candidate tree and packed bytes.
    - Security: `security:threat-suites` and `bun audit --audit-level=moderate` pass; packaged helper has no unexpected credentials/remote-model path; verify publish dry-run provenance flags.
  - Approach:
    - Documentation Reviewed: `scripts/release.mjs` gate/publish flow, `docs/release-and-install.md`, `scripts/post-publish-smoke.mjs`, Plan 129 Task 3.
    - Options Considered: run readiness before Task 4 or skip optional peer package test — reject as false confidence. Verify the final candidate once — choose.
    - Chosen Approach: run existing release scripts and packed tests, capture evidence and review actual API delta.
    - API Notes and Examples: `bun run sdk:ready && bun run release:gate`.
    - Files to Create/Edit: `scripts/release-skip-manifest.mjs`, `scripts/phase23-skip-manifest.test.mjs`, associated evidence format; `scripts/compat-baseline/` and a task note only if an attributed removal requires regeneration.
    - References: Plan 129 Task 3 (transferred); `scripts/packaging-current.test.mjs`.
  - Test Cases to Write:
    - Existing release/compat/security gates; packed Bun import works with and without optional peer; Docling worker only invoked on explicit OCR path; Postgres evidence or blocked-gate transcript.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification of Tasks 2–6.
    - Docs pages to create/edit: none unless gates reveal incorrect current contract; test evidence stays in task note.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 8: Publish 0.12.0 and smoke-test Bun consumer (transferred from Plan 129 Task 4)
  - Notes (local half executed; registry cut blocked on the release host): `scripts/post-publish-smoke.mjs` gained the work-family legs this task asked for — default `./documents` and `./document-extraction` imports with the optional peer absent, `createDocumentExtractor` failing closed as `missingPeer` with no document content in the message, wiki `extractDocument` and RAG `Parser` seams composing through `createDocumentIngest`, `docling/ocr.py` present in the packed work tarball, no `engines.node` and no retired sqlite driver in any installed manifest, anydoc declared as an optional peer and never a dependency, Bun-only engines. `bun scripts/post-publish-smoke.mjs --local` passes against the 0.12.0 tarballs: 13 base checks, 15 work checks, 2 opt-in checks (odt converts locally, `ocrUsed === false`), zero Python/model/hosted paths touched; the `bun add @firecrawl/anydoc@0.2.4` step resolved from cache in 37 ms. Publish argv was verified in Task 7 (`--provenance` only under `GITHUB_ACTIONS`); `release.yml` keeps `id-token: write`, both `attest-build-provenance` steps, the `NPM_TOKEN` env and `release-artifacts/publish-report.json` retention. Blocked in this environment: `npm whoami` returns ENEEDAUTH (no token, no `~/.npmrc`), the candidate tree is uncommitted (926 paths) so `release.mjs publish` refuses it, `git tag -l v0.12.0` is empty, and provenance needs the GitHub OIDC identity — the registry cut must run as `release.yml` publish on the release host. Finding to settle before that run: the uncommitted Plan 125/126 edit deletes the `actions/setup-node` step whose `registry-url` wrote `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`; npm 12.1.0 has no `NODE_AUTH_TOKEN` reader (verified in its bundled `npm-registry-fetch/lib/auth.js`), so the token path needs that `.npmrc` provisioning restored unless 0.12.0 publishes through npm OIDC trusted publishing. Auth plumbing was not edited — release-host decision.
  - Acceptance Criteria:
    - Functional: only after Task 7 passes, publish via `scripts/release.mjs publish` on release host in existing deterministic/resumable order, provenance-attest artifacts under `GITHUB_ACTIONS`, create `v0.12.0` and independent package tags, and retain publish report in `release-artifacts/`.
    - Functional: `post-publish:smoke` installs registry artifacts with `bun add`; `--local` mode tests packed tarballs pre-publish. Consumer imports new subpath with optional peer installed, while default Prism/work import works without anydoc, Python, models or OCR service; verify helper present in published work tarball and Wiki/RAG opt-in composition works.
    - Functional: shipped manifests have no `better-sqlite3` references or `engines.node`; published work manifest declares optional anydoc peer, not mandatory OCR dependency.
    - Performance: default consumer startup/import does not load model or native anydoc package when extraction is unused.
    - Code Quality: publish once from Task 7's verified candidate; publish failure resumes using existing release script, not a second plan.
    - Security: provenance attestations present, `NPM_TOKEN` scope unchanged, no secrets or model downloads in artifact/install smoke.
  - Approach:
    - Documentation Reviewed: `scripts/release.mjs`, `scripts/post-publish-smoke.mjs`, `docs/release-and-install.md`, Plan 125 Task 5 release-host boundary, Plan 129 Task 4.
    - Options Considered: `bun publish` — lacks required provenance; reject. Existing release host npm publish — choose.
    - Chosen Approach: dry-run release once, publish with existing pipeline, smoke registry bytes including new optional feature and Bun migration.
    - API Notes and Examples: `bun run release:publish -- --dry-run --allow-dirty --allow-untagged` then real cut after gate.
    - Files to Create/Edit: `scripts/post-publish-smoke.mjs` if new manifest/subpath assertions are absent; otherwise none, publish transcripts in task note.
    - References: `release.yml` publish job; Plan 129 Task 4 (transferred).
  - Test Cases to Write:
    - Registry Bun consumer checks default import without optional dependencies, opt-in subpath import with anydoc, packaged helper, no `engines.node`/`better-sqlite3`, and provenance report.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — publishing verified 0.12.0 candidate.
    - Docs pages to create/edit: none; release narrative already in Task 6 history/CHANGELOG.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
