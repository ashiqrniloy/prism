export { assertSafeArgv, createCliRunner, parseCliJson, parseCliNdjson } from "./cli.js";
export { WorkToolError } from "./errors.js";
export {
  buildGoogleWorkspaceArgv,
  createGoogleWorkspaceCliAdapter,
  DEFAULT_GWS_OPS,
  GATED_GWS_OPS,
} from "./google-workspace.js";
export { createMemoryIdempotencyStore, identityKey } from "./idempotency.js";
export { DEFAULT_WORK_LIMITS, HARD_WORK_LIMITS, resolveWorkLimits } from "./limits.js";
export {
  buildMicrosoft365Argv,
  createMicrosoft365CliAdapter,
  DEFAULT_M365_OPS,
  GATED_M365_OPS,
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
  WorkMutationBeginInput,
  WorkMutationFailure,
  WorkMutationKey,
  WorkMutationRecord,
  WorkMutationStatus,
  WorkMutationTransitionInput,
  Microsoft365Adapter,
  Microsoft365Capability,
  Microsoft365Op,
  ResolvedWorkLimits,
  WorkApprovalGate,
  WorkCalendarEvent,
  WorkCitation,
  WorkCliExecResult,
  WorkCliRunner,
  WorkDraft,
  WorkFileItem,
  WorkLimits,
  WorkMailMessage,
  WorkMutationResult,
  WorkPage,
  WorkProvider,
  WorkTaskItem,
  WorkTokenProvider,
  WorkToolSet,
  WorkToolsOptions,
} from "./types.js";
export const packageName = "@arnilo/prism-work-tools";
