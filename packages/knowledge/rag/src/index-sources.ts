/**
 * Lazy source indexing for `@arnilo/prism-rag` (plan 158 Task 3, decision (b)).
 *
 * There is no agent-scope background task, so indexing runs on the first `rag_search` or
 * `context.build` call behind a per-agent promise. A local source is read from disk here; a URL source
 * is fetched through the `web.fetch` service and skipped with a note when no package provides one.
 * Nothing in this module runs during `createAgent`.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, basename, resolve } from "node:path";
import type { WebFetchService } from "@arnilo/prism-tools-web";
import type { Embedder } from "@arnilo/prism-memory-core";

import { DEFAULT_RAG_GLOB, type RagSourceConfig } from "./config.js";
import { htmlParser, markdownParser, pdfParser, textParser } from "./parsers.js";
import { replaceDocument, } from "./sources.js";
import type { DocumentLoader, Parser, RagScope, TransactionalVectorStore } from "./types.js";
import { RagValidationError } from "./errors.js";

/** Hard ceiling on files one local source may contribute, so a stray glob cannot walk a filesystem. */
export const HARD_MAX_SOURCE_FILES = 4096;

export interface IndexSourcesOptions {
  readonly sources: readonly RagSourceConfig[];
  readonly embedder: Embedder;
  readonly store: TransactionalVectorStore;
  readonly scope: RagScope;
  readonly webFetch?: WebFetchService;
  readonly signal?: AbortSignal;
  /** Called once per skipped source (missing `web.fetch`, unreadable path). Never throws. */
  readonly onSkip?: (source: RagSourceConfig, reason: string) => void;
}

export interface IndexSourcesResult {
  readonly indexed: number;
  readonly skipped: number;
  readonly files: number;
}

export async function indexSources(options: IndexSourcesOptions): Promise<IndexSourcesResult> {
  let indexed = 0;
  let skipped = 0;
  let files = 0;
  for (const source of options.sources) {
    options.signal?.throwIfAborted();
    if (source.url !== undefined) {
      const fetcher = options.webFetch;
      if (!fetcher) {
        skipped += 1;
        options.onSkip?.(source, "web.fetch is not provided by any loaded package");
        continue;
      }
      const result = await replaceDocument({
        uri: source.url,
        sourceId: source.url,
        loader: createWebFetchLoader(fetcher),
        parser: markdownParser,
        embedder: options.embedder,
        store: options.store,
        scope: options.scope,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      indexed += result.indexed;
      files += 1;
      continue;
    }
    if (source.path === undefined) {
      skipped += 1;
      options.onSkip?.(source, "source needs either path or url");
      continue;
    }
    const targets = await resolveSourceFiles(source, options.signal).catch((error: unknown) => {
      skipped += 1;
      options.onSkip?.(source, error instanceof Error ? error.message : "source could not be read");
      return [] as readonly SourceFile[];
    });
    for (const target of targets) {
      options.signal?.throwIfAborted();
      const result = await replaceDocument({
        uri: target.path,
        sourceId: target.sourceId,
        loader: createFileLoader(),
        parser: parserFor(target.path),
        embedder: options.embedder,
        store: options.store,
        scope: options.scope,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      indexed += result.indexed;
      files += 1;
    }
    if (targets.length === 0) {
      skipped += 1;
      options.onSkip?.(source, `no files matched ${JSON.stringify(source.glob ?? DEFAULT_RAG_GLOB)}`);
    }
  }
  return Object.freeze({ indexed, skipped, files });
}

/** One local file and the URL-safe source id derived from it. */
export interface SourceFile {
  readonly path: string;
  /** Relative to the source root (or the basename for a single-file source); `sourceId`-safe. */
  readonly sourceId: string;
}

/** Absolute local files a source contributes, capped at {@link HARD_MAX_SOURCE_FILES}. */
export async function resolveSourceFiles(source: RagSourceConfig, signal?: AbortSignal): Promise<readonly SourceFile[]> {
  const root = resolve(source.path!);
  const info = await stat(root).catch(() => undefined);
  if (!info) throw new RagValidationError(`source path does not exist: ${root}`);
  if (info.isFile()) return [{ path: root, sourceId: basename(root) }];
  if (!info.isDirectory()) throw new RagValidationError(`source path is neither a file nor a directory: ${root}`);
  const matcher = globToRegExp(source.glob ?? DEFAULT_RAG_GLOB);
  const files: SourceFile[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    signal?.throwIfAborted();
    if (files.length >= HARD_MAX_SOURCE_FILES) throw new RagValidationError(`source exceeds ${HARD_MAX_SOURCE_FILES} files`);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(resolve(dir, entry.name), relative);
      } else if (entry.isFile() && matcher.test(relative)) {
        files.push({ path: resolve(dir, entry.name), sourceId: relative });
      }
    }
  };
  await walk(root, "");
  return files.sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
}

/** Minimal glob (`**`, `*`, `?`, `{a,b}`) over a `/`-joined relative path. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        out += "\\{";
      } else {
        out += `(?:${glob
          .slice(i + 1, end)
          .split(",")
          .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
          .join("|")})`;
        i = end;
      }
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function parserFor(file: string): Parser {
  switch (extname(file).toLowerCase()) {
    case ".md":
    case ".markdown":
    case ".mdx":
      return markdownParser;
    case ".html":
    case ".htm":
      return htmlParser;
    case ".pdf":
      return pdfParser;
    default:
      return textParser;
  }
}

function createFileLoader(): DocumentLoader {
  return {
    async load(uri) {
      const data = new Uint8Array(await readFile(uri));
      return { uri, mediaType: mediaTypeFor(uri), data };
    },
  };
}

function createWebFetchLoader(fetcher: WebFetchService): DocumentLoader {
  return {
    async load(uri, loadOptions = {}) {
      const document = await fetcher.fetch(uri, {
        ...(loadOptions.signal ? { signal: loadOptions.signal } : {}),
        ...(loadOptions.maxBytes ? { maxBytes: loadOptions.maxBytes } : {}),
      });
      return {
        uri: document.url,
        sourceId: document.citationId,
        mediaType: "text/markdown",
        text: document.markdown,
        metadata: { web: { citationId: document.citationId, provider: document.provider, url: document.url, retrievedAt: document.retrievedAt }, untrusted: true },
      };
    },
  };
}

function mediaTypeFor(file: string): string {
  switch (extname(file).toLowerCase()) {
    case ".md":
    case ".markdown":
    case ".mdx":
      return "text/markdown";
    case ".html":
    case ".htm":
      return "text/html";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    default:
      return "text/plain";
  }
}
