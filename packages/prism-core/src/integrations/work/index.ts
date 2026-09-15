export { assertSafeArgv, createCliRunner, parseCliJson, parseCliNdjson } from "./cli.js";
export {
  type CheckpointWorkDraftStoreOptions,
  canonicalJson,
  computePayloadDigest,
  createCheckpointWorkDraftStore,
  createMemoryWorkDraftStore,
  draftCheckpointKey,
  extractDraftRecipients,
  type MemoryWorkDraftStoreOptions,
  validateApproval,
  WORK_DRAFT_CHECKPOINT_NAMESPACE,
} from "./drafts.js";
export { WorkToolError } from "./errors.js";
export {
  buildGoogleWorkspaceArgv,
  createGoogleWorkspaceCliAdapter,
  DEFAULT_GWS_OPS,
  GATED_GWS_OPS,
  type GoogleWorkspaceCliAdapterOptions,
} from "./google-workspace.js";
export { createMemoryIdempotencyStore, identityKey } from "./idempotency.js";
export { DEFAULT_WORK_LIMITS, HARD_WORK_LIMITS, resolveWorkLimits } from "./limits.js";
export {
  buildMicrosoft365Argv,
  createMicrosoft365CliAdapter,
  DEFAULT_M365_OPS,
  GATED_M365_OPS,
  type Microsoft365CliAdapterOptions,
} from "./microsoft365.js";
export {
  normalizeCalendarEvent,
  normalizeCalendarPage,
  normalizeFileItem,
  normalizeFilePage,
  normalizeMailMessage,
  normalizeMailPage,
  normalizeTaskItem,
  normalizeTaskPage,
} from "./normalize.js";
export { createWorkTools } from "./tools.js";
export type {
  ExternalRecipientPolicy,
  GoogleWorkspaceAdapter,
  GoogleWorkspaceCapability,
  GoogleWorkspaceOp,
  IdempotencyStore,
  Microsoft365Adapter,
  Microsoft365Capability,
  Microsoft365Op,
  ResolvedWorkLimits,
  SyncWorkDraftStore,
  WorkApprovalCheckInput,
  WorkApprovalGate,
  WorkCalendarEvent,
  WorkCitation,
  WorkCliExecResult,
  WorkCliRunner,
  WorkDraft,
  WorkDraftApproval,
  WorkDraftApproveInput,
  WorkDraftCreateInput,
  WorkDraftMarkInput,
  WorkDraftRefInput,
  WorkDraftStore,
  WorkDraftUpdateInput,
  WorkFileItem,
  WorkLimits,
  WorkMailMessage,
  WorkMutationBeginInput,
  WorkMutationFailure,
  WorkMutationKey,
  WorkMutationRecord,
  WorkMutationResult,
  WorkMutationStatus,
  WorkMutationTransitionInput,
  WorkPage,
  WorkProvider,
  WorkTaskItem,
  WorkTokenProvider,
  WorkToolSet,
  WorkToolsOptions,
} from "./types.js";
export const packageName = "@arnilo/prism-core/integrations/work";
