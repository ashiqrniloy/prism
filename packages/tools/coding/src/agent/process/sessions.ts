/**
 * Managed ProcessSession registry — native spawn or optional sandbox startProcess.
 */
import { assertNotDisposed, createSessionsHost } from "./sessions-host.js";
import { recoverSessions } from "./sessions-recovery.js";
import { startSession } from "./sessions-spawn.js";
import { cancelOwned, disposeSessions, reconcileAllUnknown, requireRecord, terminateRecord } from "./sessions-teardown.js";
import { type CreateProcessSessionsOptions, ProcessSessionError, type ProcessSessions } from "./types.js";

export function createProcessSessions(options: CreateProcessSessionsOptions): ProcessSessions {
  const host = createSessionsHost(options);
  return {
    start: (request) => startSession(host, request),
    get: (sessionId, owner) => requireRecord(host, sessionId, owner).handle,
    cancelOwned: (owner, cancelOptions) => cancelOwned(host, owner, cancelOptions),
    markUnknown: async (sessionId, owner) => {
      const record = requireRecord(host, sessionId, owner);
      if (record.state !== "running" && record.state !== "starting") {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `cannot mark unknown in state ${record.state}`);
      }
      terminateRecord(host, record, "unknown", null);
    },
    reconcile: async () => {
      assertNotDisposed(host);
      return { markedUnknown: reconcileAllUnknown(host) };
    },
    recover: (recoverOptions) => recoverSessions(host, recoverOptions),
    dispose: () => disposeSessions(host),
  };
}
