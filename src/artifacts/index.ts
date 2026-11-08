/**
 * `@arnilo/prism/artifacts`: durable artifact review records, body-store contract, and citation
 * binding shared by work tools, web tools, RAG citations, and evals (plan 215 Task 26).
 */
export type {
  ArtifactApproval,
  ArtifactApprovalState,
  ArtifactBodyErrorCode,
  ArtifactBodyPresignOptions,
  ArtifactBodyRef,
  ArtifactBodyStore,
  ArtifactBodyTransferOptions,
  ArtifactCitation,
  ArtifactDecisionState,
  ArtifactDeliveryToken,
  ArtifactRecord,
  ArtifactRevision,
  CitationSupport,
} from "./artifacts.js";
export {
  ARTIFACT_BODY_ERROR_CODES,
  ARTIFACT_CHECKPOINT_NAMESPACE,
  ArtifactBodyStoreError,
  ArtifactError,
  artifactApprovalState,
  artifactCheckpointKey,
  citationBindingDigest,
  HARD_CITATION_EXCERPT_BYTES,
} from "./artifacts.js";
