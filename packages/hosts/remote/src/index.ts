export { type AttributionSource, attribute } from "./attribution.js";
export { type ConnectAgentOptions, type ConnectEndpoint, connectAgent } from "./connect.js";
export {
  createDispatcher,
  type Dispatcher,
  type DispatcherContext,
  type DispatcherOptions,
  type RemoteHandler,
  type RemoteNotificationHandler,
} from "./dispatcher.js";
export { isRemoteErrorCode, RemoteError, type RemoteErrorCode } from "./errors.js";
export { remoteHostUi } from "./host-ui.js";
export { type OversizeFrame, readJsonlFrames } from "./jsonl.js";
export {
  REMOTE_LIMITS,
  type RemoteLimitName,
  type RemoteLimitOptions,
  type ResolvedRemoteLimits,
  resolveRemoteLimits,
} from "./limits.js";
export { createSessionMirror, type SessionMirror } from "./mirror.js";
export { pendingDecisionsOf } from "./pending.js";
export {
  CLIENT_METHODS,
  type HostUiRequestParams,
  type HostUiRequestResult,
  type InitializeParams,
  type InitializeResult,
  isSupportedProtocol,
  KNOWN_CAPABILITIES,
  knownCapabilities,
  REMOTE_PROTOCOL,
  type RemoteCapabilities,
  type RemoteCapabilityName,
  type RemoteClientMethod,
  type RemoteMethods,
  type RemoteNotifications,
  type RemoteRunOptions,
  SERVER_NOTIFICATIONS,
  SERVER_REQUESTS,
} from "./protocol.js";
export { type RemoteResumeAuthority, type ServeAgentOptions, type ServedAgent, type ServeTransport, serveAgent } from "./serve.js";
export type { StdioEndpoint } from "./stdio-client.js";
export {
  createMemoryTransportPair,
  type RemoteTransport,
  type StdioTransportOptions,
  stdioTransport,
  type WritableLike,
} from "./transport.js";

export type { NetworkEndpoint } from "./transports/client.js";
export type { Authenticate, NetworkTransport } from "./transports/network.js";
