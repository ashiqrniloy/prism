import { createHash } from "node:crypto";
import type {
  AudioContent,
  ContentBlock,
  DocumentContent,
  FileContent,
  JsonObject,
  Message,
  ModelCapabilities,
  ModelConfig,
} from "../contracts.js";
import {
  assertMessagesSupportModelCapabilities,
  contentBlockInputModality,
  DEFAULT_MAX_MEDIA_ITEM_BYTES,
  resolveMediaContentBlock,
  resolveMediaContentBlocks,
  type MediaContentBlock,
  type ModelInputCapability,
  type ResolveMediaContentOptions,
  type ResolvedMediaContent,
  UnsupportedModalityError,
} from "../content.js";

/** Default upload-cache entry cap per provider media session. */
export const DEFAULT_PROVIDER_UPLOAD_CACHE_ENTRIES = 32;
/** Inline OpenAI file_data ceiling before preferring Files API upload. */
export const DEFAULT_OPENAI_INLINE_FILE_BYTES = 4 * 1024 * 1024;

export interface ProviderMediaScope {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly tenantId?: string;
}

export interface BoundedUploadCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  keys(): readonly string[];
  clear(): void;
}

export function assertProviderMediaCapability(
  modality: ModelInputCapability,
  capabilities: ModelCapabilities,
  model: ModelConfig,
): void {
  const supported = capabilities.input;
  if (supported?.length && !supported.includes(modality)) {
    throw new UnsupportedModalityError(modality, model);
  }
}

export function rejectProviderMediaBlock(
  part: ContentBlock,
  capabilities: ModelCapabilities,
  model: ModelConfig,
): never {
  const modality = contentBlockInputModality(part);
  if (modality) assertProviderMediaCapability(modality, capabilities, model);
  throw new Error(`Provider ${model.provider} does not support ${part.type} content blocks`);
}

export function createBoundedUploadCache<T>(maxEntries = DEFAULT_PROVIDER_UPLOAD_CACHE_ENTRIES): BoundedUploadCache<T> {
  const map = new Map<string, T>();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      else if (map.size >= maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(key, value);
    },
    keys() {
      return [...map.keys()];
    },
    clear() {
      map.clear();
    },
  };
}

export function providerUploadCacheKey(scope: ProviderMediaScope, fingerprint: string): string {
  const prefix = [scope.tenantId, scope.sessionId, scope.runId].filter((value): value is string => !!value).join(":");
  return prefix ? `${prefix}:${fingerprint}` : fingerprint;
}

export function mediaFingerprint(mediaType: string, bytes: Uint8Array, name?: string): string {
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `${mediaType}:${name ?? ""}:${hash}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function isPdfMediaType(mediaType: string): boolean {
  const normalized = mediaType.toLowerCase();
  return normalized === "application/pdf" || normalized.endsWith("+pdf");
}

export function openAIAudioFormat(mediaType: string): string {
  const normalized = mediaType.toLowerCase();
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("flac")) return "flac";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a";
  return "wav";
}

export function serializeOpenAIResponsesInputFile(options: {
  readonly filename: string;
  readonly fileData?: string;
  readonly fileId?: string;
}): JsonObject {
  if (options.fileId) {
    return { type: "input_file", file_id: options.fileId };
  }
  if (!options.fileData) {
    throw new Error("OpenAI Responses file block requires inline file_data or uploaded file_id");
  }
  return { type: "input_file", filename: options.filename, file_data: options.fileData };
}

export function serializeOpenAIResponsesInputAudio(options: { readonly data: string; readonly format: string }): JsonObject {
  return { type: "input_audio", input_audio: { data: options.data, format: options.format } };
}

export function serializePdfDocumentWireBlock(options: {
  readonly mediaType: string;
  readonly data: string;
  readonly title?: string;
}): JsonObject {
  if (!isPdfMediaType(options.mediaType)) {
    throw new Error(`PDF document blocks require application/pdf media type, got ${options.mediaType}`);
  }
  return {
    type: "document",
    source: { type: "base64", media_type: options.mediaType, data: options.data },
    ...(options.title ? { title: options.title } : {}),
  };
}

export async function resolveProviderMediaBlock(
  block: AudioContent | FileContent | DocumentContent,
  options: ResolveMediaContentOptions = {},
): Promise<ResolvedMediaContent> {
  return resolveMediaContentBlock(block, options);
}

/** Resolve every media block once and enforce aggregate request bounds before provider I/O. */
export async function resolveProviderMediaMessages(
  messages: readonly Message[],
  model: ModelConfig,
  options: ResolveMediaContentOptions = {},
): Promise<ReadonlyMap<MediaContentBlock, ResolvedMediaContent>> {
  assertMessagesSupportModelCapabilities(model, messages);
  const blocks = messages.flatMap((message) => message.content.filter(isMediaContentBlock));
  const resolved = await resolveMediaContentBlocks(blocks, options);
  return new Map(blocks.map((block, index) => [block, resolved[index]!]));
}

function isMediaContentBlock(block: ContentBlock): block is MediaContentBlock {
  return contentBlockInputModality(block) !== undefined;
}

export function defaultProviderFilename(block: MediaContentBlock, fallback: string): string {
  if ("name" in block && block.name) return block.name;
  if (block.type === "document") return "document.pdf";
  if (block.type === "audio") return `audio.${openAIAudioFormat(declaredMediaType(block))}`;
  return fallback;
}

function declaredMediaType(block: MediaContentBlock): string {
  if ("mediaType" in block && block.mediaType) return block.mediaType;
  if (block.type === "image" && block.mimeType) return block.mimeType;
  return "application/octet-stream";
}

export const DEFAULT_PROVIDER_MEDIA_ITEM_BYTES = DEFAULT_MAX_MEDIA_ITEM_BYTES;
