// host-selected pty backend contract (plan 026 Task 1): explicit capabilities,
// bounded geometry/TERM, attach timeout, resize rate limit, backend metadata caps.
// durable process recovery seam (plan 026 Task 5): versioned recovery records,
// attach-if-attested recovery backend, ERR_PRISM_RECOVERY_* failures

export type {
  ProcessRecoveryBackend,
  ProcessRecoveryErrorCode,
  ProcessRecoveryLimits,
  ProcessRecoveryOutcome,
  ProcessRecoveryRecord,
  ProcessRecoveryRecordReport,
  ProcessRecoveryReport,
  RecoveryRecordPage,
  ResolvedProcessRecoveryLimits,
} from "./recovery.js";
export {
  acquireRecordLease,
  attachWithTimeout,
  buildProcessRecoveryRecord,
  deleteProcessRecoveryRecord,
  isOwnershipConflict,
  loadProcessRecoveryRecord,
  loadProcessRecoveryRecords,
  PROCESS_RECOVERY_CATEGORY,
  PROCESS_RECOVERY_LEASE_NAMESPACE,
  PROCESS_RECOVERY_NAMESPACE,
  PROCESS_RECOVERY_SCHEMA_VERSION,
  ProcessRecoveryError,
  releaseRecordLease,
  resolveProcessRecoveryLimits,
  saveProcessRecoveryRecord,
  validateBackendRef,
  validateProcessRecoveryRecord,
} from "./recovery.js";
export { createProcessSessions } from "./sessions.js";
export type {
  CodingProcessEvent,
  CreateProcessSessionsOptions,
  ProcessExitResult,
  ProcessOutputChunk,
  ProcessPtyBackend,
  ProcessPtyHandle,
  ProcessPtyStartRequest,
  ProcessSandboxBackend,
  ProcessSandboxHandle,
  ProcessSandboxStartRequest,
  ProcessSession,
  ProcessSessionLimits,
  ProcessSessionMetadata,
  ProcessSessionState,
  ProcessSessions,
  ProcessStartRequest,
  ProcessTerminalRequest,
  ProcessTerminalResize,
  ResolvedProcessSessionLimits,
} from "./types.js";
export { ProcessSessionError, resolveProcessSessionLimits } from "./types.js";
