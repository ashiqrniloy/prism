import type { AgentRunRef, OwnershipScope } from "@arnilo/prism";

/** Result of host authorization. Prism never derives ownership from client identifiers. */
export interface AgUiAuthorization {
  readonly ownership?: OwnershipScope;
}

/** Host-owned correlation between AG-UI selectors and a durable Prism run. */
export interface AgUiRunReference {
  readonly ref: AgentRunRef;
  readonly agentId?: string;
}

/**
 * Co-work event kinds projected over the durable-resume stream (Phase 9 / 0.0.14).
 * Producer outputs (progress/snapshot/draft/download-link) and reviewer requests
 * (approval) flow as redacted, bounded metadata — never file bodies, paths, or secrets.
 */
export type CoWorkKind =
  | "artifact.progress"
  | "artifact.approval.requested"
  | "draft.connector.pending"
  | "browser.snapshot"
  | "artifact.download.link";

/** Thread/artifact context threaded through the handler so hosts render co-work review. */
export interface CoWorkContext {
  readonly threadId: string;
  readonly artifactId?: string;
  /** Redacted actor reference (e.g. `user:user-1`); never a raw credential. */
  readonly identity?: string;
}

export type CoWorkEvent =
  | {
      readonly kind: "artifact.progress";
      readonly artifactId: string;
      readonly version: number;
      readonly status: string;
      readonly progress?: number;
    }
  | {
      readonly kind: "artifact.approval.requested";
      readonly artifactId: string;
      readonly version: number;
      readonly reviewer?: string;
      readonly reason?: string;
    }
  | {
      readonly kind: "draft.connector.pending";
      readonly connectorId: string;
      readonly scope: string;
      readonly status: string;
    }
  | {
      readonly kind: "browser.snapshot";
      readonly snapshotId: string;
      readonly summary: string;
    }
  | {
      readonly kind: "artifact.download.link";
      readonly artifactId: string;
      readonly version: number;
      readonly link: string;
      readonly expiresAt: string;
    };
