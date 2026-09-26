# Document ingestion primitive review (plan 132 Task 1)

Plan: [132-Anydoc-Docling-Document-Ingestion.md](../../plans/132-Anydoc-Docling-Document-Ingestion.md) Task 1
Date: 2026-09-26
Baseline: `@arnilo/prism` 0.11.1, Bun 1.4.2, glibc 2.44, x86_64
Scope: where a host Markdown converter fits, and what anydoc 0.2.4 / Docling 2.130.0 actually do on this runtime. Research only. No package change.

Probes lived in `/tmp/prism-132-probe` and `/tmp/prism-132-docling`. Not committed.

## Seams

| Seam | What it does today | Converter fit |
| --- | --- | --- |
| `parseDocument` / `importDocument` | ZIP-magic OOXML into an editable `DocumentModel` (`doc`/`sheet`/`deck` only). | Do not use. Different product. |
| `createDocumentReader` / `DocumentParser` | Literal text for the coding read tool. `extract` must return `pages: number` and refuse over `maxPages`. Default peers: pdf-parse, mammoth, in-package xlsx/pptx. Mistral OCR is opt-in and posts to `api.mistral.ai`. | Do not wrap anydoc. Success Markdown has no page count, so a `pages` field would be invented. Leave the reader and Mistral OCR untouched. |
| Wiki `extractDocument` | `{ bytes, filename, mediaType, title } → { text, format } \| null`. | Host adapter maps `{ markdown, format }` to `{ text, format }`. Do not change the hook signature. `ocrUsed` / `pages` do not fit this return; RAG metadata can carry them. |
| RAG `Parser` | `replaceDocument({ parser })` calls `parser.parse` and indexes `text` plus metadata. No office parser. `pdfParser` is uncompressed BT/ET text only. | Host parser. No `@arnilo/prism-memory` → `@arnilo/prism-work` dependency (memory peers are only `@arnilo/prism`). |
| `WorkSandbox.execFile` | `file`, `args`, `cwd`, `env`, `timeout`, `signal`, `onData`. No stdin. Capabilities fail closed to all-false if metadata is incomplete. Env strip is only `M365_` / `GOOGLE_`. Package does not enforce network isolation. | Not the Docling runner. A host callback must supply stdin bytes, kill-on-abort, and stdout/time caps. No new core primitive. |

Wiki routing today (`packages/memory/src/wiki/ingest.ts`):

- `.txt` `.md` `.json` `.csv` `.html` `.htm`: UTF-8 decode. Hook never runs. `.csv` therefore never becomes an anydoc table unless Task 4 tries the hook first when the host set one.
- `.pdf`: RAG `pdfParser` first (hard cap 8 MiB, 256 pages). Hook only if that throws. A mixed PDF with text operators succeeds here and never asks for OCR.
- `.png` `.jpg` `.jpeg` `.gif` `.webp`: stub extract. Hook never runs.
- anything else (docx, xlsx, pptx, odt, rtf, epub, …): hook, or fail closed.

RAG limits that matter: `HARD_MAX_PARSE_MS_CAP` is 30_000 and is not raised by `replaceDocument` itself (built-in parsers enforce it). Do not raise it for OCR. Prefetch models off the request path. Small warm scans fit 30s; a 2 GiB RSS OCR process does not belong in default CI.

Trust stays at existing boundaries: wiki tool/command `trust: "untrusted_external"`; RAG `retrieveContext` trust `{ untrusted, inert, injectionCapable }`. The converter does not grant authority.

## Frozen result

One work-family result. Not a document model.

```ts
interface DocumentExtractionResult {
  readonly markdown: string;
  readonly format: string;
  readonly ocrUsed: boolean;
  readonly pages?: number; // omit unless the engine reported it
}
```

- anydoc success: `ocrUsed: false`, omit `pages`.
- anydoc `needsOcr`: throw. No markdown. Carry `pages: number[]` and `pageCount` on the error. Do not copy `error.message` into logs (it is page numbers today; do not depend on that).
- Docling success only: `ocrUsed: true`, `pages` from `document.num_pages()`.
- Any other Docling status, including `partial_success`: throw. No text returned.

`needsOcr` is the only OCR fallback. `encrypted`, `malformed`, `unsupported`, `resourceLimit`, `missingPart`, `io`, `hosted` never call Docling.

## anydoc 0.2.4 on Bun 1.4.2

Published package, not GitHub `main`. `engines.node` is `>= 20`. No Bun engine field. N-API optional packages:

`darwin-x64`, `darwin-arm64`, `linux-x64-gnu`, `linux-arm64-gnu`, `linux-x64-musl`, `linux-arm64-musl`, `win32-x64-msvc`.

No FreeBSD, Android, riscv, or Windows ARM binary. This host loaded `@firecrawl/anydoc-linux-x64-gnu/anydoc.linux-x64-gnu.node` (glibc; ldd: libc, libm, libpthread, libgcc_s, libdl). `bun add` also installed the musl package; the loader did not map it. Do not assume npm's optional-platform filter.

`toMarkdownBytes(bytes, format?, options?)` is the JS wrapper. Native conversion ignores `options`. `options.ocr === 'hosted'` catches `needsOcr` and POSTs the whole file to `https://api.firecrawl.dev/v2/parse` (or `FIRECRAWL_API_URL`). Default is reject. Probe monkeypatched `fetch`; default calls made zero network attempts.

| Case | Result |
| --- | --- |
| `formatFromBytes` DOCX / text PDF / scan PDF | `docx` / `pdf` / `pdf` |
| `formatFromBytes` CSV and PNG | `null` |
| `formatFromPath('notes.csv')` / `formatFromExtension('.csv')` | `csv` |
| DOCX 939 B | `Hello Prism DOCX\n` (17 B). Isolated convert 0.57 ms, VmHWM 58 732 KiB |
| CSV explicit `'csv'` | GFM table, 55 B, 0.14 ms |
| CSV omitted or `null` format | `code: 'unsupported'`. No OCR |
| text PDF 872 B, 2 pages | `## Hello Prism PDF page 1\n\n## Hello Prism PDF page 2\n` (53 B). Isolated convert 2.13 ms, VmHWM 61 872 KiB. Warm in-process 0.78 ms |
| image-only PDF 3007 B | `needsOcr`, `pages: [1]`, `pageCount: 1`, message `page 1 of 1 needs OCR`. No markdown. Isolated 2.02 ms |
| mixed PDF (2 text pages + 1 scan) | `needsOcr`, `pages: [3]`, `pageCount: 3`. No partial markdown |
| PNG / garbage | `unsupported` |
| `toDocument` DOCX | `{ blocks, notes, assets }` only. No pages |
| `toDocument` PDF | `unsupported` — PDF has no document model |

Import of the native module: ~5–8 ms. Import-only VmHWM 56 212 KiB. No `AbortSignal`. Native work is not preemptable.

Not attested by this probe: `encrypted` (no fixture), `resourceLimit` (no bomb), `hosted` (must not be called). Markdown-only API cannot attest success page count, which pages were text vs image, layout boxes, encryption-on-success, truncation, or asset bytes.

## Docling 2.130.0

`requires_python` is `>=3.10,<4`. This host is CPython 3.14.7. `docling==2.130.0` imports. Standard extra is `docling-slim[standard]==2.130.0` (torch, rapidocr 3.9.2). onnxruntime is not in that extra.

Default PyPI torch for cp314 is the CUDA build and pulls nvidia wheels (cublas/nccl/cusolver, multi-GB). Probe killed that install and used `torch==2.14.0+cpu` and `torchvision==0.29.0+cpu` from `https://download.pytorch.org/whl/cpu`. `torch.cuda.is_available()` was false. Task 3 docs must say CPU index unless the host pins a GPU build. Python stays host-provisioned, not an npm dependency.

`OcrAutoOptions` (the default, `do_ocr=True`) on Linux tries nemotron, then rapidocr/onnxruntime, then easyocr, then rapidocr/torch. This process logged `Auto OCR model selected rapidocr with torch.` Pin `RapidOcrOptions(backend="torch")`. Do not leave auto: another host extra selects a different engine. Docstring that says "EasyOCR if GPU else Tesseract" is stale.

Prefetch: `download_models(artifacts, with_easyocr=False, with_picture_classifier=False)` took 149.9 s and wrote 1 405 021 041 bytes (`du` 1.4 G): layout heron, tableformer, code-formula, RapidOcr torch `ch` models, and RapidOcr onnx `ch` models (downloaded even though the selected backend was torch). Hugging Face warned about unauthenticated requests during prefetch. Runtime must set `artifacts_path` to that directory. `enable_remote_services=False` did not raise.

`DocumentStream(name, BytesIO)` works. The name suffix selects format (`scan.pdf` → PDF, `scan.png` → IMAGE). Use `ImageFormatOption` for images and `PdfFormatOption` for PDFs, both with the same `PdfPipelineOptions`. Do not pass a path or URL into the helper.

| Case | Result |
| --- | --- |
| Liberation Sans scan PDF, 8215 B, "SCAN 132" | `success`, `num_pages()==1`, markdown `SCAN 132`, 4.85 s (weights loaded in this process) |
| Same page as PNG, 7203 B | `success`, 1 page, markdown `## SCAN 132`, 2.17 s. PDF and PNG markdown are not identical |
| text PDF 872 B | `success`, 2 pages, correct text, 1.38 s. Not the plan route — anydoc handles text PDFs |
| `max_num_pages=1` on 3-page PDF, `raises_on_error=True` | `ConversionError`: status `failure`, `Document has 3 pages, exceeding the max_num_pages limit of 1.` 0.05 s. No text |
| same, `raises_on_error=False` | status `failure`, empty markdown, `FailureCategory.POLICY` |
| `max_file_size=100` | status `failure`, empty markdown, size message. Defaults are `sys.maxsize` — the helper must set both limits |
| `document_timeout=0.001` | status `partial_success`, errors `document timeout exceeded` and a pipeline stage timeout, markdown empty this time. `convert()` does not raise on `PARTIAL_SUCCESS` even when `raises_on_error=True` (`document_converter.py` treats it like success). Source also sets `PARTIAL_SUCCESS` when some pages complete (`standard_pdf_pipeline.py`). Refuse every non-`success` |
| offline rerun | `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `socket.create_connection` raising. `success`, `networkAttempts: []`. `unshare --net` failed with `Operation not permitted`, so this is a process socket guard, not a network namespace |

RSS, one converter, artifacts already on disk: init VmHWM 1 093 704 KiB; after first scan 1 786 460 KiB; after PNG 1 997 992 KiB. A second converter in the same process reached 3 101 088 KiB. Budget one OCR job, not a pool.

A tofu-font ImageMagick page (glyphs missing) still returned `success` with markdown `<!-- image -->\n\n00000000`. `SUCCESS` is not correct text. Keep output untrusted. Do not golden-match OCR except a font-rendered fixture.

## Thresholds for later tasks

This host, small fixtures. Not upstream benchmark claims (anydoc median 4.4 ms, Docling marketing scores).

- anydoc office or text PDF under 10 KiB: under 500 ms, process VmHWM under 128 MiB. Measured 0.6–2.1 ms and 57–62 MiB including Bun.
- anydoc `needsOcr` reject: under 500 ms, zero markdown bytes. Measured ~2 ms.
- Docling OCR under 100 KiB after artifacts are on disk: under 30 s, one-converter VmHWM under 4 GiB. Measured ~5 s cold / ~2 s warm and ~2.0 GiB. A later real fixture that exceeds 2× without a recorded reason fails the task.
- Prefetch (150 s, 1.4 GiB) is provisioning, not a request-path budget.

## Threat notes

- anydoc default path is local. One options flag uploads the whole PDF. The work API must not expose `ocr: 'hosted'` or read `FIRECRAWL_API_KEY`.
- Docling model bytes come from Hugging Face at prefetch. Pin versions. Runtime uses `artifacts_path` and `enable_remote_services=False`. No `remote-serving` extra.
- Over-limit Docling input fails with empty markdown (probed). Partial timeout does not raise. Check `status == success` or a timed-out job can be indexed.
- Mixed PDF: anydoc emits no markdown. Wiki's current PDF built-in can index the text pages and skip the scan. Hook-first when a host extractor is set; null/failure must not fall back.
- Caps before native anydoc (it accepts no abort and no `maxPages`). Caps inside the Docling `convert()` call (`max_num_pages`, `max_file_size`) plus a worker wall clock (`document_timeout`), because defaults are unbounded.
- Worker env is not scrubbed by `assertWorkSandboxEnv` beyond two prefixes. Host runner passes an explicit env, no ambient tokens.
- Helper reads stdin bytes only. No path, no URL, no `HttpSource`.
