/**
 * Audit sink over the moved `PolicyDecisionStore`: one append per decision when `audit` is set, and a
 * cursor export the host can drain into WORM/SIEM. The store holds redacted records only — the
 * prepare path rejects any payload-like key, so raw tool arguments never enter it.
 */

import type { GovernanceAuditConfig } from "./config.js";
import { createFilePolicyDecisionStore, createMemoryPolicyDecisionStore, type PolicyDecisionStore } from "./policy/index.js";

export interface GovernanceAudit {
  readonly store: PolicyDecisionStore;
  /** Default `true` when `audit` is set: a failed append denies the call. */
  readonly required: boolean;
  /** Page size for `governance.audit.export()`. */
  readonly pageSize?: number;
}

/** Build the configured store. A `file` store without `path` throws (config fails closed at setup). */
export function createAudit(config: GovernanceAuditConfig): GovernanceAudit {
  if (config.store === "file") {
    if (!config.path?.trim()) throw new Error('governance audit.store "file" requires audit.path');
    return {
      store: createFilePolicyDecisionStore({ path: config.path }),
      required: config.required ?? true,
      pageSize: config.export?.pageSize,
    };
  }
  return { store: createMemoryPolicyDecisionStore(), required: config.required ?? true, pageSize: config.export?.pageSize };
}
