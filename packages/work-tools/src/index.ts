export { WorkToolError } from "./errors.js";
export { DEFAULT_WORK_LIMITS, HARD_WORK_LIMITS, resolveWorkLimits } from "./limits.js";
export { createMemoryIdempotencyStore, identityKey } from "./idempotency.js";
export { assertSafeArgv, createCliRunner, parseCliJson, parseCliNdjson } from "./cli.js";
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
export {
  buildMicrosoft365Argv,
  createMicrosoft365CliAdapter,
  DEFAULT_M365_OPS,
  GATED_M365_OPS,
} from "./microsoft365.js";
export {
  buildGoogleWorkspaceArgv,
  createGoogleWorkspaceCliAdapter,
  DEFAULT_GWS_OPS,
  GATED_GWS_OPS,
} from "./google-workspace.js";
export type {
  ExternalRecipientPolicy,
  GoogleWorkspaceAdapter,
  GoogleWorkspaceCapability,
  GoogleWorkspaceOp,
  IdempotencyRecord,
  IdempotencyStore,
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
  WorkToolSet,
  WorkToolsOptions,
  WorkTokenProvider,
} from "./types.js";
export const packageName = "@arnilo/prism-work-tools";
