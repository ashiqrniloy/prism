// host-selected pty backend contract (plan 026 Task 1): explicit capabilities,
// bounded geometry/TERM, attach timeout, resize rate limit, backend metadata caps.
// durable process recovery seam (plan 026 Task 5): versioned recovery records,
// attach-if-attested recovery backend, ERR_PRISM_RECOVERY_* failures
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
  ProcessSessions,
  ProcessSessionState,
  ProcessStartRequest,
  ProcessTerminalRequest,
  ProcessTerminalResize,
  ResolvedProcessSessionLimits,
} from "./types.js";
export { ProcessSessionError, resolveProcessSessionLimits } from "./types.js";
export { createProcessSessions } from "./sessions.js";
export {
  PROCESS_RECOVERY_CATEGORY,
  PROCESS_RECOVERY_LEASE_NAMESPACE,
  PROCESS_RECOVERY_NAMESPACE,
  PROCESS_RECOVERY_SCHEMA_VERSION,
  ProcessRecoveryError,
  acquireRecordLease,
  attachWithTimeout,
  buildProcessRecoveryRecord,
  deleteProcessRecoveryRecord,
  isOwnershipConflict,
  loadProcessRecoveryRecord,
  loadProcessRecoveryRecords,
  releaseRecordLease,
  resolveProcessRecoveryLimits,
  saveProcessRecoveryRecord,
  validateBackendRef,
  validateProcessRecoveryRecord,
} from "./recovery.js";
export type {
  ProcessRecoveryErrorCode,
  ProcessRecoveryLimits,
  ProcessRecoveryRecord,
  ProcessRecoveryRecordReport,
  ProcessRecoveryReport,
  ResolvedProcessRecoveryLimits,
  RecoveryRecordPage,
} from "./recovery.js";
export type { ProcessRecoveryBackend, ProcessRecoveryOutcome } from "./recovery.js";
