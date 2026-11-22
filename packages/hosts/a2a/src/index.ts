/**
 * `@arnilo/prism-hosts/a2a`: A2A 1.0 interop for one Prism `Agent` over JSON-RPC.
 * `serveA2A` serves the agent to A2A peers; `connectA2A` returns an `Agent` proxy for a remote A2A agent. Importing this module opens no socket and starts no timer.
 */
export type {
  A2AAgentCapabilities,
  A2AAgentCard,
  A2AAgentCardSignature,
  A2AAgentExtension,
  A2AAgentInterface,
  A2AAgentSkill,
} from "./card.js";
export { type A2AEndpoint, type ConnectA2AOptions, connectA2A } from "./connect.js";
export {
  A2A_CARD_PATH,
  A2A_PROTOCOL_VERSION,
  type A2AArtifact,
  type A2AMessage,
  type A2APart,
  type A2ARole,
  type A2AStreamResponse,
  type A2ATask,
  type A2ATaskArtifactUpdateEvent,
  type A2ATaskState,
  type A2ATaskStatus,
  type A2ATaskStatusUpdateEvent,
  PRISM_DECISIONS_EXTENSION,
} from "./codec.js";
export {
  A2A_ERROR_CODES,
  A2A_LITERAL_SECRET_CODE,
  A2AClientError,
  type A2AClientErrorCode,
  A2AConfigError,
  A2AError,
  type A2AErrorName,
  A2ALiteralSecretError,
} from "./errors.js";
export { A2A_LIMITS, type A2ALimitName, type A2ALimitOptions, type ResolvedA2ALimits } from "./limits.js";
export { type A2AAuthorization, type A2AAuthorizeInput, type A2AHandler, type ServeA2AOptions, serveA2A } from "./serve.js";
