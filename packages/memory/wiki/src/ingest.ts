import { Buffer as NodeBuffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { assertSsrfAllowedUrl, MediaContentError } from "@arnilo/prism";
import { MemoryLimitError, MemoryValidationError } from "@arnilo/prism-memory-core";
import type { OntologySourceResult } from "@arnilo/prism-memory-fabric";
import { HARD_MAX_DOCUMENT_BYTES_CAP, pdfParser } from "@arnilo/prism-memory-rag";
import type {
  WikiExtensionOptions,
  WikiIngestFetch,
  WikiIngestInput,
  WikiIngestOptions,
  WikiIngestResult,
  WikiStagedSource,
} from "./types.js";

const DEFAULT_MAX_INPUT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_EXTRACT_BYTES = 2 * 1024 * 1024;

const TEXT_MEDIA_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
};

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function hashContent(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Single display line: control chars and newlines become spaces. */
function toSingleLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

/** Directory-safe slug: `[^a-z0-9-_]` → `-`, collapsed, capped, never empty. */
export function ingestSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

/** The directory under the stage root that holds one folder per ingested source. */
export const SOURCES_DIR = "sources";

/** Wiki-extension options → `ingestWikiSource` options (the extension owns workspace trust, not callers). */
export function ingestOptionsFrom(options: WikiExtensionOptions): WikiIngestOptions {
  return {
    workspaceRoot: options.workspaceRoot,
    fetchUrl: options.fetchUrl,
    ...(options.maxInputBytes === undefined ? {} : { maxInputBytes: options.maxInputBytes }),
    ...(options.maxExtractBytes === undefined ? {} : { maxExtractBytes: options.maxExtractBytes }),
  };
}

const BRIEF_PREVIEW_CHARS = 8192;
const IMAGE_INLINE_BYTES = 256 * 1024;

/** The ingest brief: where the source went, what happens to it next, and a capped extract preview (the kernel labels it untrusted). */
export function renderIngestBrief(result: WikiIngestResult): string {
  const next = result.indexed
    ? [
        `Indexed as ${result.scope}-scope file note \`${result.noteId}\`; cite that id in any claim that rests on this source.`,
        result.subject === undefined
          ? "It is not bound to a subject yet: the next concept pass proposes one or declines. Run `/wiki:consolidate` to file it now."
          : `Bound to subject \`${result.subject}\`, which is queued for the next concept pass. Run \`/wiki:consolidate\` to file it now.`,
      ]
    : [
        `Not indexed: the trust scan refused the text (${result.refused}). The files are staged but the source is not offered to the concept pass.`,
      ];
  return [
    `Ingested source \`${result.id}\` staged at \`${result.rawDir}\`.`,
    ...(result.url ? [`Source URL: ${result.url}`] : []),
    `Original: \`${result.sourcePath}\``,
    `Extract: \`${result.extractPath}\`${result.truncated ? " (truncated)" : ""}`,
    "",
    "The original is immutable; leave the staged files untouched.",
    ...next,
    "",
    // The kernel envelopes this brief (UNTRUSTED_EXTERNAL_TRUST); a second banner here would duplicate it.
    "Extract preview:",
    "",
    result.extract.slice(0, BRIEF_PREVIEW_CHARS),
  ].join("\n");
}

/** Image sources: inline small images (base64), omit for huge ones — the brief already carries the path pointer. */
export async function ingestImageBlock(
  staged: Pick<WikiStagedSource, "id" | "mediaType" | "sourcePath">,
  stageRoot: string,
): Promise<{ type: "image"; mimeType: string; data: string; name: string } | undefined> {
  if (!staged.mediaType?.startsWith("image/")) return undefined;
  const abs = resolve(stageRoot, staged.sourcePath);
  const info = await stat(abs).catch(() => undefined);
  if (!info || info.size > IMAGE_INLINE_BYTES) return undefined;
  return { type: "image", mimeType: staged.mediaType, data: (await readFile(abs)).toString("base64"), name: staged.id };
}

function utcStamp(iso: string): string {
  return iso.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
}

function fileExtension(filename: string | undefined): string {
  return extname(filename ?? "")
    .toLowerCase()
    .replace(/^\./, "");
}

/** Staged filename for a fetched URL: the pathname's extension wins (`doc.pdf`), else `source.md`. */
function urlFilename(url: string): string {
  const base = basename(new URL(url).pathname);
  return fileExtension(base) ? base : "source.md";
}

/** Default title for a URL source: pathname basename without extension, else the hostname.
 *  Tolerant of malformed URLs — the SSRF check reports those properly later. */
function urlTitle(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "ingest";
  }
  const base = basename(parsed.pathname).replace(/\.[^.]+$/, "");
  try {
    return decodeURIComponent(base || parsed.hostname);
  } catch {
    return base || parsed.hostname;
  }
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Stage a source under `<stageRoot>/sources/<utc>-<slug>/` (the original, immutable, and a utf8 `extract.md`).
 * `stageRoot` is the fabric's `tools.root`, so the extract is a fabric `file` note and the same jail covers it.
 * No LLM, no network.
 *
 * Content source precedence: `path` > `bytes` > `url` > `text` (at most one is used; `path` stages the
 * file itself). `filename` supplies the extension for `bytes`/`text` inputs (default `txt`).
 *
 * Extraction matrix (no new deps):
 * - text formats (.txt/.md/.json/.csv/.html): utf8 decode
 * - .pdf: the rag PDF parser; a PDF it cannot read fails closed
 * - images: stub extract naming the source — no OCR, the model must view the image
 * - `url`: host `fetchUrl` hook only (never fetched here; SSRF-checked first) or fail closed
 * - anything else: fail closed
 */
export async function ingestWikiSource(input: WikiIngestInput, options: WikiIngestOptions = {}): Promise<WikiStagedSource> {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const maxExtractBytes = options.maxExtractBytes ?? DEFAULT_MAX_EXTRACT_BYTES;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stageRoot = resolve(options.stageRoot ?? workspaceRoot);
  const ingestRoot = join(stageRoot, SOURCES_DIR);

  if (!input.path && input.bytes === undefined && input.url === undefined && !(typeof input.text === "string" && input.text.length > 0)) {
    throw new MemoryValidationError("ingest requires text, path, bytes + filename, or url + fetchUrl hook");
  }

  const title = toSingleLine(
    input.title ?? (input.path ? basename(input.path) : input.filename) ?? (input.url ? urlTitle(input.url) : undefined) ?? "ingest",
  );
  if (!title) throw new MemoryValidationError("ingest title must not be empty");

  // Read bytes + determine the staged extension.
  let bytes: NodeBuffer;
  let filename: string;
  let sourceUrl: string | undefined;
  if (input.path) {
    const sourcePathInput = input.path;
    if (sourcePathInput.includes("\0")) throw new MemoryValidationError("ingest path must not contain NUL");
    filename = basename(sourcePathInput);
    const realInput = await realpath(resolve(workspaceRoot, sourcePathInput)).catch(() => {
      throw new MemoryValidationError(`ingest path does not exist: ${toSingleLine(sourcePathInput)}`);
    });
    const realRoot = await realpath(workspaceRoot);
    if (realInput !== realRoot && !realInput.startsWith(realRoot + sep)) {
      throw new MemoryValidationError(`ingest path escapes the workspace: ${toSingleLine(input.path)}`);
    }
    bytes = NodeBuffer.from(await readFile(realInput));
  } else if (input.bytes !== undefined) {
    if (input.filename?.includes("\0")) throw new MemoryValidationError("ingest filename must not contain NUL");
    filename = input.filename ?? "source.txt";
    bytes = NodeBuffer.from(input.bytes);
  } else if (input.url !== undefined) {
    sourceUrl = input.url;
    try {
      assertSsrfAllowedUrl(sourceUrl);
    } catch (error) {
      const code = error instanceof MediaContentError ? error.code : "ssrf_denied";
      throw new MemoryValidationError(`ingest url rejected (${code}): ${error instanceof Error ? error.message : "ssrf policy"}`);
    }
    if (!options.fetchUrl) {
      throw new MemoryValidationError(
        "ingest url requires the web.fetch service — no loaded package provides it, and the wiki package never fetches itself",
      );
    }
    const fetched: WikiIngestFetch | null = await options.fetchUrl({ url: sourceUrl });
    if (!fetched || (fetched.text === undefined && fetched.bytes === undefined)) {
      throw new MemoryValidationError(`fetchUrl hook returned no content for ${toSingleLine(sourceUrl)}`);
    }
    filename = fetched.filename ?? urlFilename(sourceUrl);
    bytes = fetched.bytes !== undefined ? NodeBuffer.from(fetched.bytes) : NodeBuffer.from(fetched.text ?? "", "utf8");
  } else {
    if (input.filename?.includes("\0")) throw new MemoryValidationError("ingest filename must not contain NUL");
    filename = input.filename ?? "source.txt";
    bytes = NodeBuffer.from(input.text ?? "", "utf8");
  }

  if (bytes.byteLength > maxInputBytes) {
    throw new MemoryLimitError(`ingest input exceeds ${maxInputBytes} bytes`);
  }

  const ext = fileExtension(filename) || "txt";
  const mediaType = TEXT_MEDIA_TYPES[`.${ext}`] ?? IMAGE_MEDIA_TYPES[`.${ext}`] ?? (ext === "pdf" ? "application/pdf" : undefined);

  // Stage directory first (id/paths are known before extraction; the image stub names the source).
  const now = new Date();
  const base = `${utcStamp(now.toISOString())}-${ingestSlug(title)}`;
  let id = base;
  if (
    await stat(join(ingestRoot, base))
      .then(() => true)
      .catch(() => false)
  ) {
    id = `${base}-${hashContent(bytes).slice(0, 8)}`;
  }
  const rawDir = join(ingestRoot, id);
  const sourceAbsPath = join(rawDir, `source.${ext}`);
  const extractAbsPath = join(rawDir, "extract.md");
  const sourceRelPath = toPosix(relative(stageRoot, sourceAbsPath));

  // Extract text per the matrix. No host extractor: PDF uses the built-in parser, CSV/text decode as
  // UTF-8, images get the no-OCR stub, and anything else fails closed.
  const image = Boolean(IMAGE_MEDIA_TYPES[`.${ext}`]);
  let extract: string;
  if (mediaType && TEXT_MEDIA_TYPES[`.${ext}`]) {
    try {
      extract = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new MemoryValidationError(`ingest source is not valid UTF-8: ${toSingleLine(filename)}`);
    }
  } else if (mediaType === "application/pdf") {
    // ponytail: built-in parser is capped at the RAG hard cap (8 MiB).
    const parsed = await pdfParser.parse(
      { uri: "wiki:ingest", mediaType, data: bytes },
      { maxBytes: Math.min(maxInputBytes, HARD_MAX_DOCUMENT_BYTES_CAP) },
    );
    extract = parsed.text;
  } else if (image) {
    extract = [
      `# Ingested image: ${title}`,
      "",
      `No text extraction was performed (no OCR). The original image is staged at \`${sourceRelPath}\`.`,
      "View the image directly (multimodal read) to analyze its content.",
      "",
    ].join("\n");
  } else {
    throw new MemoryValidationError(`unsupported ingest format: ${toSingleLine(filename)}`);
  }

  // Cap the extract (byte-safe-ish: a split multi-byte tail degrades to a replacement char).
  const extractBuffer = NodeBuffer.from(extract, "utf8");
  const truncated = extractBuffer.byteLength > maxExtractBytes;
  const extractText = truncated ? extractBuffer.subarray(0, maxExtractBytes).toString("utf8") : extract;

  // The staged tree must stay inside the stage root even when `sources/` is a symlink.
  await mkdir(stageRoot, { recursive: true });
  await mkdir(rawDir, { recursive: true });
  const realStage = await realpath(stageRoot);
  const realRaw = await realpath(rawDir);
  if (realRaw !== realStage && !realRaw.startsWith(realStage + sep)) {
    throw new MemoryValidationError("ingest staging directory escapes the fabric root");
  }
  await writeFile(sourceAbsPath, bytes, { mode: 0o644 });
  await writeFile(extractAbsPath, extractText, { encoding: "utf8", mode: 0o644 });

  return {
    id,
    rawDir: toPosix(relative(stageRoot, rawDir)),
    sourcePath: sourceRelPath,
    extractPath: toPosix(relative(stageRoot, extractAbsPath)),
    contentHash: hashContent(NodeBuffer.from(extractText, "utf8")),
    keywords: image ? sourceKeywords(title, "") : sourceKeywords(title, extractText),
    ...(mediaType ? { mediaType } : {}),
    ...(sourceUrl ? { url: sourceUrl } : {}),
    extract: extractText,
    truncated,
  };
}

const STOP_WORDS = new Set(
  "about above after again also and any are because been before being between both but can could did does doing down during each few for from further had has have having her here hers him his how into its itself just more most not off once only other our out over own same she should some such than that the their them then there these they this those through too under until very was were what when where which while who whom why will with would you your".split(
    " ",
  ),
);

/**
 * Enrichment keywords for the `file` note, with no model call: the title's words first, then the extract's most
 * frequent words. They let an unbound source cluster with related notes and help the deterministic binding.
 */
export function sourceKeywords(title: string, extract: string, limit = 8): readonly string[] {
  const words = (text: string): string[] => text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  const out = new Set<string>();
  for (const word of words(title)) if (!STOP_WORDS.has(word)) out.add(word);
  const counts = new Map<string, number>();
  for (const word of words(extract.slice(0, 20_000))) if (!STOP_WORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const ranked = [...counts].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [word] of ranked) out.add(word);
  return [...out].slice(0, limit);
}

/**
 * Stage a source and index its extract as a fabric `file` note (one staged write, one index, no model call). The
 * fabric binds the note when exactly one subject fits and marks that concept for the next pass; an unbound note is
 * offered to the pass as a cluster candidate. Fails closed, before anything is fetched or written, when the fabric
 * has no `tools.root`.
 */
export async function ingestSource(input: WikiIngestInput, options: WikiExtensionOptions, signal?: AbortSignal): Promise<WikiIngestResult> {
  const port = options.port?.();
  const root = port?.sourceRoot();
  if (port === undefined || root === undefined) {
    throw new MemoryValidationError(
      "wiki_ingest needs the fabric's tools.root: sources are staged under <tools.root>/sources and indexed as file notes",
    );
  }
  const staged = await ingestWikiSource(input, { ...ingestOptionsFrom(options), stageRoot: root });
  const indexed: OntologySourceResult = await port.indexSource({
    path: staged.extractPath,
    text: staged.extract,
    contentHash: staged.contentHash,
    keywords: staged.keywords,
    ...(signal === undefined ? {} : { signal }),
  });
  const { keywords: _keywords, contentHash: _contentHash, ...rest } = staged;
  return {
    ...rest,
    scope: indexed.scope,
    indexed: indexed.indexed,
    ...(indexed.id === undefined ? {} : { noteId: indexed.id }),
    ...(indexed.subject === undefined ? {} : { subject: indexed.subject }),
    ...(indexed.refused === undefined ? {} : { refused: indexed.refused }),
  };
}
