export * from "./agent/recovery.js";
export {
  type AcpAuthorization,
  type AcpCodingContext,
  type AcpCodingSeams,
  type AcpSessionBinding,
  type CreatePrismAcpAgentOptions,
  createPrismAcpAgent,
} from "./agent.js";
export {
  type AcpCapabilitiesOptions,
  type AcpCapabilitiesSource,
  type AcpCommand,
  type AcpCommandsSeam,
  type AcpMcpSeams,
  type AcpSessionStoreSeams,
  type AcpSessionSummary,
  type AcpUsageSeam,
  resolveAcpAgentCapabilities,
} from "./capabilities.js";
export { type CodingToolProjectionOptions, createCodingToolProjection } from "./coding-projection.js";
export { AcpError, type AcpErrorCode } from "./errors.js";
export { type AcpClientFilesystem, type AcpClientFilesystemOptions, createAcpClientFilesystem } from "./fs-client.js";
export {
  type AcpEventMapper,
  type AcpEventMapperOptions,
  type AcpLifecycleMapper,
  createAcpEventMapper,
  createAcpLifecycleMapper,
} from "./mapper.js";
// biome-ignore lint/style/useExportType: same compat-surface statement-shape freeze as above
export {
  type AcpConfigOption,
  type AcpConfigOptionsSeam,
  type AcpModesSeam,
  type AcpSessionMode,
} from "./modes.js";
export { type AcpPromptMedia, type AcpPromptOptions, type AcpPromptResult, projectAcpPrompt } from "./prompt.js";
export { type AcpSessionStore, type PersistedAcpRunRef, type PersistedAcpSession, validateActiveRunRef } from "./session-store.js";
export {
  type AcpClientTerminal,
  type AcpClientTerminals,
  type AcpClientTerminalsOptions,
  createAcpClientTerminals,
} from "./terminal-client.js";
