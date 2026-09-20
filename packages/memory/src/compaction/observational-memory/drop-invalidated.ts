/**
 * Plan 102 Task 2: the observational-memory layer's deletion-propagation handler.
 *
 * Revocation never reaches OM writers directly. Register this handler on a
 * `createDeletionPropagator` and one propagation pass folds the session ledger
 * once, drops every active observation that rests on a tombstoned record id,
 * and writes a single `om.observations.dropped` entry through the shared
 * `appendCustomEntry` seam. No store query and no per-id scan: the ledger is
 * the `sourceEntryIds` ↔ observation-id mapping.
 *
 * `coversUpToId` is omitted on purpose — a tombstone set is not a coverage
 * position, and the token-budget dropper keeps owning that cursor.
 */
import type { DeletionPropagationHandler } from "../../propagation.js";
import { type CustomEntryAppendOptions, appendCustomEntry } from "./append-custom.js";
import { activeObservations, foldObservationalMemoryLedger, observationBlockedByInvalidation } from "./ledger.js";
import { OBSERVATIONS_DROPPED } from "./types.js";

/**
 * Returns a `DeletionPropagator` handler (`kind: "observational"`) that drops
 * active observations whose id or `sourceEntryIds` intersect the tombstone set.
 * Pass the same `{ session, appendEntry }` pair the runtime was built with.
 */
export function createObservationalMemoryDropHandler(options: CustomEntryAppendOptions): DeletionPropagationHandler {
  return {
    kind: "observational",
    async delete({ ids }) {
      const ledger = foldObservationalMemoryLedger(await options.session.entries());
      const invalidated = new Set(ids);
      const dropped = activeObservations(ledger).filter((observation) => observationBlockedByInvalidation(observation, invalidated));
      if (dropped.length === 0) return 0;
      await appendCustomEntry(options, {
        type: OBSERVATIONS_DROPPED,
        observationIds: dropped.map((observation) => observation.id),
      });
      return dropped.length;
    },
  };
}
