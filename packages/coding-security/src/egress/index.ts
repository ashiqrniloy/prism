/** Egress module entry point: policy, proxy, DNS pinning, limits, attestation. */

export type { AddressResolver } from "./dns-pin.js";
export { assertPinned, isMetadataAddress, isPrivateAddress, normalizeAddress, resolvePinned } from "./dns-pin.js";
export type { EgressLimitOptions, ResolvedEgressLimits } from "./limits.js";
export {
  DEFAULT_MAX_EGRESS_CONCURRENT_CONNECTIONS,
  DEFAULT_MAX_EGRESS_REDIRECT_HOPS,
  DEFAULT_MAX_EGRESS_REQUEST_BYTES,
  DEFAULT_MAX_EGRESS_RESPONSE_BYTES,
  DEFAULT_MAX_EGRESS_RULES,
  DEFAULT_MAX_EGRESS_TRANSFER_TIME_MS,
  HARD_MAX_EGRESS_CONCURRENT_CONNECTIONS,
  HARD_MAX_EGRESS_REDIRECT_HOPS,
  HARD_MAX_EGRESS_REQUEST_BYTES,
  HARD_MAX_EGRESS_RESPONSE_BYTES,
  HARD_MAX_EGRESS_RULES,
  HARD_MAX_EGRESS_TRANSFER_TIME_MS,
  resolveEgressLimits,
} from "./limits.js";
export type { CreateEgressPolicyOptions, EgressPolicy, EgressPreset, EgressProtocol, EgressRule } from "./policy.js";
export { createEgressPolicy, EGRESS_PRESETS } from "./policy.js";
export type {
  CreateAllowListEgressProxyOptions,
  EgressAttestation,
  EgressProxy,
  EgressProxyEndpoint,
  EgressProxyStats,
} from "./proxy.js";
export { createAllowListEgressProxy } from "./proxy.js";
export type { EgressAuditRecord, EgressErrorCode } from "./types.js";
export { EgressError } from "./types.js";
