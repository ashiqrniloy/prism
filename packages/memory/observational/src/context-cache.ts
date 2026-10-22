import type { JsonValue, SessionContext, SessionLog } from "@arnilo/prism";
import type { ResolvedMemoryObservationalConfig } from "./config.js";
import { observationalMemoryBlock } from "./context.js";
import { activeObservations, activeReflections, recordData, type ObservationalMemoryLedger } from "./ledger.js";
import { boundMemoryPayload, HARD_MAX_FOLDED_PAYLOAD_BYTES } from "./memory-bounds.js";
import { ledgerOf } from "./state.js";

type ContextMode = "none" | "own-compaction" | "pinned";
interface Pin {
  type: "om.context.pinned";
  compactionEntryId: string;
  coversUpToId?: string;
  ledger: ObservationalMemoryLedger;
}
function latestPin(records: readonly JsonValue[]): Pin | undefined {
  return [...records].reverse().find((value) => typeof value === "object" && value !== null && !Array.isArray(value) && value.type === "om.context.pinned") as unknown as Pin | undefined;
}

/** Observe hooks are not awaited: publish the pending pin synchronously for context.build. */
export function createCompactionContextCache(log: SessionLog<JsonValue>, config: ResolvedMemoryObservationalConfig) {
  const sessions = new Map<string, { pending: Promise<void>; mode: ContextMode; ledger?: ObservationalMemoryLedger; entryId?: string }>();
  const snapshot = (ledger: ObservationalMemoryLedger): ObservationalMemoryLedger => ({
    ...boundMemoryPayload(activeObservations(ledger), activeReflections(ledger), [], config.dropper.targetTokens, HARD_MAX_FOLDED_PAYLOAD_BYTES),
    ...(ledger.taskState ? { taskState: ledger.taskState } : {}),
    ...(ledger.latestObservationCoverageId ? { latestObservationCoverageId: ledger.latestObservationCoverageId } : {}),
  });
  const reconcile = (session: SessionContext, captured?: ObservationalMemoryLedger) => {
    let state = sessions.get(session.id);
    if (!state) {
      state = { pending: Promise.resolve(), mode: "none" };
      sessions.set(session.id, state);
    }
    const current = state;
    current.pending = current.pending.then(async () => {
      const entries = await session.entries();
      const entry = [...entries].reverse().find((entry) => entry.kind === "compaction");
      const index = entry ? entries.indexOf(entry) : -1;
      if (!entry || current.entryId === entry.id) return;
      const own = (entry.data as { strategy?: string } | undefined)?.strategy === "observational-memory";
      if (own) {
        current.mode = "own-compaction";
        current.ledger = undefined;
      } else {
        const pin = latestPin(log.entries(session));
        if (pin?.compactionEntryId === entry.id) current.ledger = pin.ledger;
        else {
          // Reopen recovery reconstructs the ledger as it stood before this compaction.
          const ledger = captured ?? snapshot(ledgerOf(entries.slice(0, index).map((item) => recordData(item) as JsonValue)));
          await log.append(session, JSON.parse(JSON.stringify({
            type: "om.context.pinned", compactionEntryId: entry.id,
            coversUpToId: ledger.latestObservationCoverageId, ledger,
          })) as JsonValue);
          current.ledger = ledger;
        }
        current.mode = "pinned";
      }
      current.entryId = entry.id;
    });
    // Keep failures observable to context.build without an unhandled observe-hook rejection.
    void current.pending.catch(() => {});
    return current;
  };
  return {
    forget(session: SessionContext) { sessions.delete(session.id); },
    completed(session: SessionContext) {
      const captured = snapshot(ledgerOf(log.entries(session)));
      reconcile(session, captured);
    },
    async blocks(session: SessionContext) {
      const state = sessions.get(session.id) ?? reconcile(session);
      await state.pending;
      return state.mode === "pinned" && state.ledger
        ? observationalMemoryBlock(state.ledger, { advertiseRecall: config.recall, maxTaskStateBytes: config.worker.maxTaskStateBytes })
        : [];
    },
    mode(session: SessionContext): ContextMode {
      return sessions.get(session.id)?.mode ?? "none";
    },
  };
}
