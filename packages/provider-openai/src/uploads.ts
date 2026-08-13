import { type CredentialValueSource, resolveCredentialValue } from "@arnilo/prism";
import {
  bytesToBase64,
  createBoundedUploadCache,
  DEFAULT_OPENAI_INLINE_FILE_BYTES,
  DEFAULT_PROVIDER_MEDIA_ITEM_BYTES,
  mediaFingerprint,
  type ProviderMediaScope,
  providerUploadCacheKey,
} from "@arnilo/prism/providers/media";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

export interface OpenAIFileUploadManagerOptions {
  readonly providerId?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly scope?: ProviderMediaScope;
  readonly inlineMaxBytes?: number;
  readonly maxCacheEntries?: number;
  readonly purpose?: string;
}

export interface OpenAIResolvedFileWire {
  readonly filename: string;
  readonly fileData?: string;
  readonly fileId?: string;
  readonly uploaded: boolean;
}

export function createOpenAIFileUploadManager(options: OpenAIFileUploadManagerOptions = {}) {
  const providerId = options.providerId ?? "openai";
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const inlineMaxBytes = options.inlineMaxBytes ?? DEFAULT_OPENAI_INLINE_FILE_BYTES;
  const purpose = options.purpose ?? "user_data";
  const cache = createBoundedUploadCache<string>(options.maxCacheEntries);
  const uploadedIds = new Set<string>();

  async function resolveToken(): Promise<string | undefined> {
    return resolveCredentialValue(options.apiKey, { provider: providerId, name: "apiKey" });
  }

  async function resolveFileWire(
    mediaType: string,
    bytes: Uint8Array,
    filename: string,
    signal?: AbortSignal,
  ): Promise<OpenAIResolvedFileWire> {
    const fingerprint = mediaFingerprint(mediaType, bytes, filename);
    const cacheKey = providerUploadCacheKey(options.scope ?? {}, fingerprint);
    const cached = cache.get(cacheKey);
    if (cached) {
      return { filename, fileId: cached, uploaded: true };
    }

    if (bytes.byteLength <= inlineMaxBytes) {
      return {
        filename,
        fileData: `data:${mediaType};base64,${bytesToBase64(bytes)}`,
        uploaded: false,
      };
    }

    const token = await resolveToken();
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", new Blob([Buffer.from(bytes)], { type: mediaType }), filename);
    const response = await fetchImpl(`${baseUrl}/files`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body: form,
      signal,
    });
    if (!response.ok) {
      const secrets = token ? [token] : [];
      throw new Error(`OpenAI file upload failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`);
    }
    const payload = await readBoundedResponseJson<{ id?: string }>(response, {
      secrets: token ? [token] : [],
      // Fail closed on malformed/oversized upload responses: a missing id
      // must never silently skip the cleanup registry.
      shape: (value) => typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string",
    });
    if (!payload.id) throw new Error("OpenAI file upload response missing id");
    cache.set(cacheKey, payload.id);
    uploadedIds.add(payload.id);
    return { filename, fileId: payload.id, uploaded: true };
  }

  async function cleanup(signal?: AbortSignal): Promise<void> {
    const token = await resolveToken();
    const secrets = token ? [token] : [];
    const ids = [...uploadedIds];
    cache.clear();
    await Promise.all(
      ids.map(async (fileId) => {
        try {
          const response = await fetchImpl(`${baseUrl}/files/${encodeURIComponent(fileId)}`, {
            method: "DELETE",
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
            signal,
          });
          if (response.ok) {
            // Retain the id until the DELETE actually succeeds: a failed or
            // skipped DELETE must leave the id in the registry so a retried
            // cleanup can still remove the remote file (no leak).
            uploadedIds.delete(fileId);
          } else {
            await readBoundedResponseText(response, { secrets });
          }
        } catch {
          // Best-effort cleanup; id stays registered for the next cleanup.
        }
      }),
    );
  }

  return {
    resolveFileWire,
    cleanup,
    inlineMaxBytes,
    maxItemBytes: DEFAULT_PROVIDER_MEDIA_ITEM_BYTES,
  };
}

export type OpenAIFileUploadManager = ReturnType<typeof createOpenAIFileUploadManager>;
