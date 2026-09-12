/**
 * Barrel for the runtime/server artifact split (plan 070 Task 8). Every symbol
 * previously exported from this module is re-exported here from its new home: limits +
 * resolver in artifacts-limits.ts, the durable service + validation in artifacts-service.ts,
 * delivery-link sign/verify in artifacts-delivery-links.ts, and the HTTP adapter in
 * artifacts-handler.ts.
 *
 * Deliberately NOT `export *`: star re-exports would surface the split modules' internals
 * (`bounded`, `ID_PATTERN`) through artifacts.d.ts and change the declared surface — the
 * promise here is an identical surface (0.1.4 barrel convention).
 */

export {
  signArtifactDeliveryLink,
  verifyArtifactDeliveryLink,
} from "./artifacts-delivery-links.js";
export type {
  ArtifactAuthorizationInput,
  ArtifactAuthorizer,
  ArtifactOperation,
  CreateArtifactHandlerOptions,
} from "./artifacts-handler.js";
export { createArtifactHandler } from "./artifacts-handler.js";
export type {
  ArtifactLimits,
  ResolvedArtifactLimits,
} from "./artifacts-limits.js";
export {
  DEFAULT_ARTIFACT_CITATION_BYTES,
  DEFAULT_ARTIFACT_CITATIONS,
  DEFAULT_ARTIFACT_HASH_BYTES,
  DEFAULT_ARTIFACT_LIST_PAGE_LIMIT,
  DEFAULT_ARTIFACT_MIME_BYTES,
  DEFAULT_ARTIFACT_NOTE_BYTES,
  DEFAULT_ARTIFACT_PREVIEW_BYTES,
  DEFAULT_ARTIFACT_RECORD_BYTES,
  DEFAULT_ARTIFACT_REQUEST_BYTES,
  DEFAULT_ARTIFACT_REVISIONS,
  DEFAULT_ARTIFACT_TITLE_BYTES,
  DEFAULT_ARTIFACT_URI_BYTES,
  DEFAULT_ARTIFACTS_PER_THREAD,
  DEFAULT_DELIVERY_LINK_TOKEN_BYTES,
  DEFAULT_DELIVERY_LINK_TTL_SECONDS,
  HARD_ARTIFACT_CITATION_BYTES,
  HARD_ARTIFACT_CITATIONS,
  HARD_ARTIFACT_HASH_BYTES,
  HARD_ARTIFACT_LIST_PAGE_LIMIT,
  HARD_ARTIFACT_MIME_BYTES,
  HARD_ARTIFACT_NOTE_BYTES,
  HARD_ARTIFACT_PREVIEW_BYTES,
  HARD_ARTIFACT_RECORD_BYTES,
  HARD_ARTIFACT_REQUEST_BYTES,
  HARD_ARTIFACT_REVISIONS,
  HARD_ARTIFACT_TITLE_BYTES,
  HARD_ARTIFACT_URI_BYTES,
  HARD_ARTIFACTS_PER_THREAD,
  HARD_DELIVERY_LINK_TOKEN_BYTES,
  HARD_DELIVERY_LINK_TTL_SECONDS,
  resolveArtifactLimits,
} from "./artifacts-limits.js";
export type {
  ArtifactAttachInput,
  ArtifactCompareInput,
  ArtifactCompareResult,
  ArtifactDecisionEvent,
  ArtifactDecisionInput,
  ArtifactDeliveryInput,
  ArtifactDeliveryResult,
  ArtifactListInput,
  ArtifactRefInput,
  ArtifactReviseInput,
  ArtifactService,
  ArtifactServiceInput,
  CreateArtifactServiceOptions,
} from "./artifacts-service.js";
export { createArtifactService } from "./artifacts-service.js";
