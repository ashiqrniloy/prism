// host-selected pty backend contract (plan 026 Task 1): explicit capabilities,
// bounded geometry/TERM, attach timeout, resize rate limit, backend metadata caps
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
