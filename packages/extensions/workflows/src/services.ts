import type { JsonObject, PackageAPI, SessionLog } from "@arnilo/prism";
import { createMemoryWorkflowCheckpoints, createWorkflowCheckpoints } from "./checkpoints.js";
import type { CheckpointStore, LeaseStore } from "./contracts.js";
import { createMemoryLeaseStore } from "./memory-leases.js";
import type { WorkflowCheckpointAdapter } from "./types.js";

/**
 * Service names the workflows package consumes. A store package provides them (roadmap §2.12.13);
 * `@arnilo/prism-extensions/store-sqlite` and `@arnilo/prism-extensions/store-postgres` do.
 */
export const CHECKPOINTS_SERVICE = "checkpoints";
export const LEASES_SERVICE = "leases";
/** The resolved runtime this package provides to hosts and to its own `workflowCommand`/`workflowLoop`. */
export const WORKFLOWS_SERVICE = "workflows";

/** The engine's resolved services: the store-provided ones when present, the in-memory defaults otherwise. */
export interface WorkflowRuntime {
  readonly log: SessionLog<JsonObject>;
  readonly events: PackageAPI["events"];
  /** The workflows package's own host port: `humanGate` requests carry this package's name. */
  readonly host: PackageAPI["host"];
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly leases: LeaseStore;
}

/**
 * Resolve `checkpoints` and `leases` through a package API at call time, so a store package loaded
 * after this one is still visible. Absent services fall back to the in-memory defaults.
 */
export function createWorkflowRuntime(prism: PackageAPI): WorkflowRuntime {
  let memoryCheckpoints: WorkflowCheckpointAdapter | undefined;
  let memoryLeases: LeaseStore | undefined;
  let log: SessionLog<JsonObject> | undefined;
  return {
    events: prism.events,
    host: prism.host,
    get log() {
      return (log ??= prism.state.log<JsonObject>("workflow"));
    },
    get checkpoints() {
      const store = prism.services.consume<CheckpointStore>(CHECKPOINTS_SERVICE);
      return store ? createWorkflowCheckpoints({ store }) : (memoryCheckpoints ??= createMemoryWorkflowCheckpoints());
    },
    get leases() {
      return prism.services.consume<LeaseStore>(LEASES_SERVICE) ?? (memoryLeases ??= createMemoryLeaseStore());
    },
  };
}
