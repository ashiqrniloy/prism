import type { DeletionPropagationHandler } from "@arnilo/prism-memory-core";
import type { FabricOntology } from "./port.js";

/** Service name under which the fabric offers the concept deletion handler to a host that builds a propagator. */
export const MEMORY_FABRIC_CONCEPT_HANDLER_SERVICE = "memory.fabric.concept-deletion";

/**
 * The ontology leg of a deletion-propagation pass (plan 207 Task 2). The propagator tombstones through the store,
 * not through the fabric's own `forget`, so this handler runs the same deterministic cascade for the lineage-closed
 * ids: every claim citing a propagated id is removed, with its other citations. It returns the items removed.
 */
export function createConceptDeletionHandler(ontology: Pick<FabricOntology, "retract">): DeletionPropagationHandler {
  return {
    kind: "concepts",
    async delete(context) {
      const report = await ontology.retract(
        { ids: context.ids, reason: context.reason === "legal_hold" ? "legal_hold" : "forgotten" },
        { resourceId: context.scope.resourceId, ...(context.signal === undefined ? {} : { signal: context.signal }) },
      );
      return report.removed;
    },
  };
}
