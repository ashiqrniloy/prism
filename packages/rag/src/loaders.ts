import type { ResourceLoadContext, ResourceLoader } from "@arnilo/prism";
import { RagLimitError, RagValidationError } from "./errors.js";
import { resolveRagLimits } from "./limits.js";
import type { DocumentLoader, DocumentLoadOptions, LoadedDocument } from "./types.js";
import { nonEmpty } from "./util.js";

export interface ResourceDocumentLoaderOptions {
  readonly loader: ResourceLoader;
  readonly context?: ResourceLoadContext;
}

export interface WebFetchDocument {
  readonly citationId: string;
  readonly provider: string;
  readonly url: string;
  readonly markdown: string;
  readonly retrievedAt: string;
  readonly untrusted: true;
}

export interface WebFetchAdapter {
  fetch(url: string, options?: { readonly signal?: AbortSignal }): Promise<WebFetchDocument>;
}

export interface WebFetchDocumentLoaderOptions {
  readonly fetcher: WebFetchAdapter;
}

export function createResourceDocumentLoader(options: ResourceDocumentLoaderOptions): DocumentLoader {
  return {
    async load(uri, loadOptions = {}) {
      nonEmpty(uri, "uri");
      const context = { ...options.context, ...(loadOptions.signal ? { signal: loadOptions.signal } : {}) };
      const resource = await options.loader.load(uri, context);
      if (resource.text === undefined && resource.data === undefined) throw new RagValidationError("resource has no text or data");
      const document: LoadedDocument = Object.freeze({
        uri: resource.uri,
        ...(resource.mediaType ? { mediaType: resource.mediaType } : {}),
        ...(resource.text !== undefined ? { text: resource.text } : { data: new Uint8Array(resource.data!) }),
      });
      assertDocumentBytes(document, loadOptions.maxBytes);
      return document;
    },
  };
}

export function createWebFetchDocumentLoader(options: WebFetchDocumentLoaderOptions): DocumentLoader {
  return {
    async load(uri, loadOptions = {}) {
      const url = publicWebUrl(uri);
      const document = await options.fetcher.fetch(url, { signal: loadOptions.signal });
      publicWebUrl(document.url);
      if (!document.untrusted || !document.markdown) throw new RagValidationError("web fetcher returned an invalid untrusted document");
      const loaded: LoadedDocument = Object.freeze({
        uri: document.url,
        sourceId: document.citationId,
        mediaType: "text/markdown",
        text: document.markdown,
        metadata: {
          web: {
            citationId: document.citationId,
            provider: document.provider,
            url: document.url,
            retrievedAt: document.retrievedAt,
          },
          untrusted: true,
        },
      });
      assertDocumentBytes(loaded, loadOptions.maxBytes);
      return loaded;
    },
  };
}

function assertDocumentBytes(document: LoadedDocument, maxBytes: number | undefined): void {
  const limit = resolveRagLimits({ maxDocumentBytes: maxBytes }).maxDocumentBytes;
  const bytes = document.data ?? Buffer.from(document.text ?? "", "utf8");
  if (bytes.byteLength > limit) throw new RagLimitError(`document exceeds ${limit} bytes`);
}

function publicWebUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RagValidationError("web document URI must be an absolute HTTP(S) URL");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || privateOrLocalHost(host)) {
    throw new RagValidationError("web document URI must use a public hostname without credentials");
  }
  url.hash = "";
  return url.toString();
}

function privateOrLocalHost(host: string): boolean {
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":")) return true; // Require fetcher DNS policy for hostnames; never fetch IP literals.
  return false;
}
