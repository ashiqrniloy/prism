/** Shared egress types: typed errors and audit records. */

export type EgressErrorCode =
  | "ERR_PRISM_EGRESS_DENIED"
  | "ERR_PRISM_EGRESS_DNS"
  | "ERR_PRISM_EGRESS_LIMIT"
  | "ERR_PRISM_EGRESS_POLICY"
  | "ERR_PRISM_EGRESS_ATTESTATION";

export class EgressError extends Error {
  readonly code: EgressErrorCode;
  constructor(code: EgressErrorCode, message: string) {
    super(message);
    this.name = "EgressError";
    this.code = code;
  }
}

export interface EgressAuditRecord {
  readonly id: string;
  readonly ts: string;
  readonly decision: "allow" | "deny";
  readonly host: string;
  readonly port: number;
  readonly protocol: "http" | "https";
  readonly reason?: string;
  readonly bytes?: number;
  readonly durationMs?: number;
  readonly clientAddress?: string;
}
