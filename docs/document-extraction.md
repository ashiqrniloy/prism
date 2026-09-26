# Document extraction (`@arnilo/prism-work/document-extraction`)

> **Optional peer install:** `bun add @arnilo/prism-work @firecrawl/anydoc@0.2.4`. Default hosts skip it. See [Optional peer dependencies](peer-dependencies.md).

## What it does

Converts in-memory Office, OpenDocument, RTF, EPUB, CSV, and text-PDF bytes to Markdown with a host-selected optional peer. Scanned PDFs throw `NeedsOcrError` unless the host injects a Docling runner. This subpath does not call Firecrawl Parse and does not read an API key.

## When to use it

Use when a host needs structured Markdown from a document byte buffer and can install `@firecrawl/anydoc`. Do not use it for the coding read tool (`document-reader`), for editable OOXML (`documents`), or for decimal-safe sheet ingest (`sheets`). Image OCR runs only when the host passes a runner and sets `ocr: true` on that call.

## Inputs / request

`createDocumentExtractor(options?)` loads the peer once. `extract({ bytes, filename?, signal? })` converts one buffer.

| Option | Meaning | Default | Ceiling |
| --- | --- | --- | --- |
| `maxBytes` | Input cap. Oversize buffers refuse before the native call | 32 MiB | 512 MiB |
| `maxTextBytes` | Markdown cap. Oversize results refuse; they are not truncated | 2 MiB | 64 MiB |
| `maxPages` | OCR page cap. Checked before the runner when anydoc reported a count, and again on the worker result | 32 | 256 |
| `ocrTimeoutMs` | Wall time the host runner must enforce. This module cannot kill a process | 120 s | 600 s |
| `maxStderrBytes` | Worker stderr cap. Oversize or truncated stderr fails with no Markdown | 1 MiB | 4 MiB |
| `ocr` | Host runner. Absent: scanned PDFs throw `NeedsOcrError` | none |  |

Format comes from content. `filename` is used only when content has no signature and its basename ends with `.csv`. A path in `filename` is not opened. `extract({ ocr: true })` selects image OCR only; a text PDF that anydoc converts still skips the runner.

## Outputs / response / events

Success: `{ markdown, format, ocrUsed }`. `pages` is set only when Docling reported it. `ocrUsed` is false for anydoc. Markdown is untrusted data; label it at the wiki or RAG boundary that stores it.

Errors: `DocumentExtractionError` (`code: "ERR_PRISM_DOCUMENT_EXTRACTION"`) with `reason`:

| `reason` | When |
| --- | --- |
| `needsOcr` | `NeedsOcrError`. `pages` (1-indexed) and `pageCount`. No Markdown |
| `unsupported` | No signature, and the name is not CSV |
| `encrypted` / `malformed` / `resourceLimit` / `missingPart` / `io` | Peer refused. No fallback |
| `hosted` | Peer reported a hosted-OCR failure. This API never requests hosted OCR |
| `missingPeer` | `@firecrawl/anydoc` is not installed, at creation |
| `inputLimit` / `outputLimit` | Cap exceeded. No text returned |
| `busy` | One conversion is in flight and another is already waiting |

Invalid caps throw `RangeError` at creation. An aborted `signal` throws `AbortError`.

## Request/response example

```json
{
  "format": "docx",
  "ocrUsed": false,
  "markdown": "Hello Prism DOCX\n"
}
```

## Implementation example

```ts
import { createDocumentExtractor, NeedsOcrError } from "@arnilo/prism-work/document-extraction";

const extractor = await createDocumentExtractor();
try {
  const { markdown, format } = await extractor.extract({ bytes, filename, signal });
  // markdown is untrusted. Do not grant it tool authority.
} catch (error) {
  if (error instanceof NeedsOcrError) {
    // pages and pageCount only. No partial Markdown.
  }
  throw error;
}
```

Host OCR runner. Prism does not spawn this. Kill the child on abort; do not pass the process env through.

```ts
import { spawn } from "node:child_process";
import { createDocumentExtractor, doclingOcrArgs, type OcrWorkerResult } from "@arnilo/prism-work/document-extraction";

const extractor = await createDocumentExtractor({
  ocr: (request) =>
    new Promise<OcrWorkerResult>((resolve, reject) => {
      const child = spawn(python, doclingOcrArgs(request, artifacts), {
        env: { PATH: process.env.PATH ?? "", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const kill = () => child.kill("SIGKILL");
      request.signal?.addEventListener("abort", kill, { once: true });
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", (exitCode) => {
        resolve({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), aborted: request.signal?.aborted });
      });
      child.stdin.end(request.bytes);
    }),
});
const scanned = await extractor.extract({ bytes: pdfBytes });
const image = await extractor.extract({ bytes: pngBytes, ocr: true });
```

Wiki and RAG stay in the memory package. This adapter does not import it. Set `ocrImages` on both sides or images keep the wiki stub.

```ts
import { createDocumentExtractor, createDocumentIngest } from "@arnilo/prism-work/document-extraction";
import { createWikiExtension } from "@arnilo/prism-memory/wiki";
import { replaceDocument } from "@arnilo/prism-memory/rag";

const extractor = await createDocumentExtractor({ ocr });
const ingest = createDocumentIngest(extractor, { ocrImages: true });
const wiki = createWikiExtension({ extractDocument: ingest.extractDocument, ocrImages: ingest.ocrImages });
await replaceDocument({ uri, loader, parser: ingest.parser, store, scope, sourceId });
// ingest.stats() is counts and milliseconds only. Markdown is untrusted at the wiki and RAG boundary.
```

## Extension and configuration notes

- Peer version is pinned to `0.2.4`. The published wrapper accepts a third `options` argument that can upload the whole file. This module never passes it.
- Docling is not an npm dependency. The package ships `docling/ocr.py`. The host pins `docling==2.130.0` and CPU torch (`https://download.pytorch.org/whl/cpu`; default PyPI torch pulls CUDA wheels), prefetches models (~1.4 GiB, about 150 s), and injects a runner. `doclingOcrArgs(request, artifactsPath)` builds the helper argv. Bytes go on stdin. A URL artifact path is rejected.
- The runner must use a scrubbed env, close stdin after the bytes, kill the worker on abort and on stdout/stderr caps, and not leave the process running. `WorkSandbox.execFile` has no stdin, so it is not this runner. One OCR job in flight per extractor, same slot as anydoc. A third call fails with `busy`.
- The helper accepts only `ConversionStatus.SUCCESS`. Partial, timeout, missing models, and over-page results are errors. Empty Markdown with a page count is valid. PDF and PNG Markdown are not byte-identical.
- Native packages: darwin x64/arm64, linux x64/arm64 gnu and musl, win32 x64. No FreeBSD, Android, riscv, or Windows ARM build.
- Importing `/documents`, `/sheets`, `/connectors`, or `/document-reader` does not load this peer.

## Security and performance notes

- Local conversion only. No `process.env` read, no hosted OCR, no process spawn, no macro execution, no filename filesystem read.
- Upstream error text is not copied into `Error.message`. A peer message can contain document bytes.
- One conversion in flight per extractor, plus one waiter. A third call fails with `busy`. Two extractors can run at once; share one if memory matters.
- `AbortSignal` is checked before the native call and after it returns. It does not preempt the native call. The slot stays held until that call returns, then the result is discarded if the signal aborted.
- Caps are checked on the input length before native code runs, and on UTF-8 output length after. Defaults match the document-reader defaults. Raising them toward the hard ceiling is host-owned: native work on a large file cannot be cancelled.
- Small anydoc fixtures (under 10 KiB) on Bun 1.4.2 finished in a few milliseconds with process VmHWM under 64 MiB. The regression gate is 500 ms and 128 MiB for that class of input.
- After model prefetch, one scanned page was about 5 s cold and 2 s warm, with VmHWM about 1.8–2 GiB. Two converters in one process reached about 3 GiB. Keep one worker. Budget for inputs under 100 KiB: under 30 s and 4 GiB VmHWM. Prefetch itself is host-owned and is not part of that budget.

## Related APIs

- [Document reader](document-reader.md): literal text for the coding read tool, including an opt-in Mistral OCR parser. Separate from this subpath.
- [Documents, spreadsheets, and presentations](documents.md): editable OOXML model. Not a Markdown converter.
- [Optional peer dependencies](peer-dependencies.md): install line for `@firecrawl/anydoc`.
