/**
 * Artifact limits (plan 070 Task 8 split of runtime/server/artifacts.ts, moved verbatim):
 * the Phase 9 freeze numbers, the host-tunable `ArtifactLimits` shape, and the resolver
 * that clamps host input to defaults + hard caps. No imports — this is the leaf module.
 */

/** Phase 9 freeze: artifacts/thread 64/256; revisions 32/128; record 8/64 KiB; preview 16/64 KiB;
 *  citations 32/128 and 2/8 KiB each; mime 128/512 B; hash 256/1 KiB; delivery TTL 5 min/24 h;
 *  delivery token 4/16 KiB. Compare is exactly 2 revisions (hash+metadata only; host renders content). */
export const DEFAULT_ARTIFACTS_PER_THREAD = 64;
export const HARD_ARTIFACTS_PER_THREAD = 256;
export const DEFAULT_ARTIFACT_REVISIONS = 32;
export const HARD_ARTIFACT_REVISIONS = 128;
export const DEFAULT_ARTIFACT_RECORD_BYTES = 8 * 1024;
export const HARD_ARTIFACT_RECORD_BYTES = 64 * 1024;
export const DEFAULT_ARTIFACT_PREVIEW_BYTES = 16 * 1024;
export const HARD_ARTIFACT_PREVIEW_BYTES = 64 * 1024;
export const DEFAULT_ARTIFACT_CITATIONS = 32;
export const HARD_ARTIFACT_CITATIONS = 128;
export const DEFAULT_ARTIFACT_CITATION_BYTES = 2 * 1024;
export const HARD_ARTIFACT_CITATION_BYTES = 8 * 1024;
export const DEFAULT_ARTIFACT_MIME_BYTES = 128;
export const HARD_ARTIFACT_MIME_BYTES = 512;
export const DEFAULT_ARTIFACT_HASH_BYTES = 256;
export const HARD_ARTIFACT_HASH_BYTES = 1024;
export const DEFAULT_ARTIFACT_URI_BYTES = 2 * 1024;
export const HARD_ARTIFACT_URI_BYTES = 8 * 1024;
export const DEFAULT_ARTIFACT_NOTE_BYTES = 1024;
export const HARD_ARTIFACT_NOTE_BYTES = 8 * 1024;
export const DEFAULT_ARTIFACT_TITLE_BYTES = 256;
export const HARD_ARTIFACT_TITLE_BYTES = 2 * 1024;
export const DEFAULT_ARTIFACT_LIST_PAGE_LIMIT = 50;
export const HARD_ARTIFACT_LIST_PAGE_LIMIT = 200;
export const DEFAULT_DELIVERY_LINK_TTL_SECONDS = 300;
export const HARD_DELIVERY_LINK_TTL_SECONDS = 24 * 3600;
export const DEFAULT_DELIVERY_LINK_TOKEN_BYTES = 4 * 1024;
export const HARD_DELIVERY_LINK_TOKEN_BYTES = 16 * 1024;
export const DEFAULT_ARTIFACT_REQUEST_BYTES = 64 * 1024;
export const HARD_ARTIFACT_REQUEST_BYTES = 1024 * 1024;

export interface ArtifactLimits {
  readonly artifactsPerThread?: number;
  readonly revisionsPerArtifact?: number;
  readonly recordBytes?: number;
  readonly previewBytes?: number;
  readonly citations?: number;
  readonly citationBytes?: number;
  readonly mimeBytes?: number;
  readonly hashBytes?: number;
  readonly uriBytes?: number;
  readonly noteBytes?: number;
  readonly titleBytes?: number;
  readonly listPageLimit?: number;
  readonly deliveryLinkTtlSeconds?: number;
  readonly deliveryLinkTokenBytes?: number;
  readonly maxRequestBytes?: number;
}

export interface ResolvedArtifactLimits {
  readonly artifactsPerThread: number;
  readonly revisionsPerArtifact: number;
  readonly recordBytes: number;
  readonly previewBytes: number;
  readonly citations: number;
  readonly citationBytes: number;
  readonly mimeBytes: number;
  readonly hashBytes: number;
  readonly uriBytes: number;
  readonly noteBytes: number;
  readonly titleBytes: number;
  readonly listPageLimit: number;
  readonly deliveryLinkTtlSeconds: number;
  readonly deliveryLinkTokenBytes: number;
  readonly maxRequestBytes: number;
}

export function resolveArtifactLimits(input: ArtifactLimits = {}): ResolvedArtifactLimits {
  return {
    artifactsPerThread: bounded(input.artifactsPerThread, DEFAULT_ARTIFACTS_PER_THREAD, HARD_ARTIFACTS_PER_THREAD, "artifactsPerThread"),
    revisionsPerArtifact: bounded(input.revisionsPerArtifact, DEFAULT_ARTIFACT_REVISIONS, HARD_ARTIFACT_REVISIONS, "revisionsPerArtifact"),
    recordBytes: bounded(input.recordBytes, DEFAULT_ARTIFACT_RECORD_BYTES, HARD_ARTIFACT_RECORD_BYTES, "recordBytes"),
    previewBytes: bounded(input.previewBytes, DEFAULT_ARTIFACT_PREVIEW_BYTES, HARD_ARTIFACT_PREVIEW_BYTES, "previewBytes"),
    citations: bounded(input.citations, DEFAULT_ARTIFACT_CITATIONS, HARD_ARTIFACT_CITATIONS, "citations"),
    citationBytes: bounded(input.citationBytes, DEFAULT_ARTIFACT_CITATION_BYTES, HARD_ARTIFACT_CITATION_BYTES, "citationBytes"),
    mimeBytes: bounded(input.mimeBytes, DEFAULT_ARTIFACT_MIME_BYTES, HARD_ARTIFACT_MIME_BYTES, "mimeBytes"),
    hashBytes: bounded(input.hashBytes, DEFAULT_ARTIFACT_HASH_BYTES, HARD_ARTIFACT_HASH_BYTES, "hashBytes"),
    uriBytes: bounded(input.uriBytes, DEFAULT_ARTIFACT_URI_BYTES, HARD_ARTIFACT_URI_BYTES, "uriBytes"),
    noteBytes: bounded(input.noteBytes, DEFAULT_ARTIFACT_NOTE_BYTES, HARD_ARTIFACT_NOTE_BYTES, "noteBytes"),
    titleBytes: bounded(input.titleBytes, DEFAULT_ARTIFACT_TITLE_BYTES, HARD_ARTIFACT_TITLE_BYTES, "titleBytes"),
    listPageLimit: bounded(input.listPageLimit, DEFAULT_ARTIFACT_LIST_PAGE_LIMIT, HARD_ARTIFACT_LIST_PAGE_LIMIT, "listPageLimit"),
    deliveryLinkTtlSeconds: bounded(
      input.deliveryLinkTtlSeconds,
      DEFAULT_DELIVERY_LINK_TTL_SECONDS,
      HARD_DELIVERY_LINK_TTL_SECONDS,
      "deliveryLinkTtlSeconds",
    ),
    deliveryLinkTokenBytes: bounded(
      input.deliveryLinkTokenBytes,
      DEFAULT_DELIVERY_LINK_TOKEN_BYTES,
      HARD_DELIVERY_LINK_TOKEN_BYTES,
      "deliveryLinkTokenBytes",
    ),
    maxRequestBytes: bounded(input.maxRequestBytes, DEFAULT_ARTIFACT_REQUEST_BYTES, HARD_ARTIFACT_REQUEST_BYTES, "maxRequestBytes"),
  };
}

export function bounded(value: number | undefined, fallback: number, cap: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > cap) {
    throw new RangeError(`${name} must be a positive safe integer <= ${cap}`);
  }
  return resolved;
}
