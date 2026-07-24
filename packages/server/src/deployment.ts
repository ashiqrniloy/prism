import type { LeaseRecord, LeaseStore, OwnershipScope } from "@arnilo/prism";
import { PrismServerError } from "./types.js";

/** Lease namespace for process-role election (coordinator vs worker hosts). */
export const PRISM_DEPLOYMENT_LEASE_NAMESPACE = "prism.server.deployment";

export interface PrismDeploymentLeaseOptions {
  readonly leases: LeaseStore;
  /** Stable process / replica id. */
  readonly ownerId: string;
  /**
   * Role key within the deployment namespace.
   * Convention: `coordinator` for schedule/admission leadership; workers omit or use host-defined keys.
   */
  readonly key: string;
  readonly ownership?: OwnershipScope;
  readonly ttlMs?: number;
}

export interface PrismDeploymentLease {
  readonly namespace: typeof PRISM_DEPLOYMENT_LEASE_NAMESPACE;
  readonly key: string;
  readonly ownerId: string;
  tryAcquire(signal?: AbortSignal): Promise<LeaseRecord | null>;
  renew(token: string, signal?: AbortSignal): Promise<LeaseRecord | null>;
  release(token: string, signal?: AbortSignal): Promise<boolean>;
  get(signal?: AbortSignal): Promise<LeaseRecord | null>;
}

/**
 * Thin LeaseStore wrapper for worker/coordinator election.
 * Workers run `createWorkflowCoordinator` (workflows package) for queued runs;
 * a single coordinator replica holds this lease before ticking schedules / admitting drain decisions.
 * No embedded listener or container orchestrator.
 */
export function createPrismDeploymentLease(options: PrismDeploymentLeaseOptions): PrismDeploymentLease {
  if (!options.ownerId) throw new PrismServerError("ownerId is required", 500, "ERR_PRISM_SERVER_CONFIG");
  if (!options.key) throw new PrismServerError("key is required", 500, "ERR_PRISM_SERVER_CONFIG");
  const ttlMs = options.ttlMs ?? 30_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new PrismServerError("ttlMs must be a positive safe integer", 500, "ERR_PRISM_SERVER_CONFIG");
  }
  const ownership = options.ownership ?? {};
  const base = {
    namespace: PRISM_DEPLOYMENT_LEASE_NAMESPACE,
    key: options.key,
    ownerId: options.ownerId,
    ...ownership,
  };

  return {
    namespace: PRISM_DEPLOYMENT_LEASE_NAMESPACE,
    key: options.key,
    ownerId: options.ownerId,
    tryAcquire(signal) {
      return options.leases.tryAcquireLease({ ...base, ttlMs, signal });
    },
    renew(token, signal) {
      return options.leases.renewLease({ ...base, token, ttlMs, signal });
    },
    release(token, signal) {
      return options.leases.releaseLease({ ...base, token, signal });
    },
    get(signal) {
      return options.leases.getLease({
        namespace: PRISM_DEPLOYMENT_LEASE_NAMESPACE,
        key: options.key,
        signal,
        ...ownership,
      });
    },
  };
}
