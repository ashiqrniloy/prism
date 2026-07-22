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
