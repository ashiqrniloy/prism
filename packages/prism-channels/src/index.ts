// Plan 079 Task 2/3, moved by Task 4: the `@arnilo/prism-channels` surface.
// Transport-neutral contracts plus the Prism execution adapter; Telegram/Signal adapters stay
// in their own subpaths (Tasks 5 and 7) and are never pulled in through this barrel.

export type { ChannelDeliveryJournal, ChannelDeliveryJournalOptions, ChannelReplyKeyInput } from "./delivery.js";
export { createChannelDeliveryJournal, emptyPruneResult, isSettledReply } from "./delivery.js";
export { DEFAULT_CHANNEL_LIMITS, HARD_CHANNEL_LIMITS, resolveChannelLimits } from "./limits.js";
export type {
  ChannelPairingConsumption,
  ChannelPairingGrant,
  ChannelPairingRecord,
  ChannelPairingStore,
  ChannelPairingStoreOptions,
  ConsumeChannelPairingInput,
  CreateChannelPairingInput,
} from "./pairing.js";
export { createChannelPairingStore, DEFAULT_PAIRING_TTL_MS, HARD_PAIRING_TTL_MS } from "./pairing.js";
export { createMessagingRuntime } from "./runtime.js";
export type {
  ChannelBindingKeyInput,
  ChannelBindingRecord,
  ChannelCursorKeyInput,
  ChannelCursorRecord,
  ChannelJournalEntry,
  ChannelJournalNamespace,
  ChannelOperationKeyInput,
  ChannelStateStore,
  ChannelStateStoreOptions,
  StoredChannelRecord,
} from "./state.js";
export { CHANNEL_JOURNAL_NAMESPACES, createChannelStateStore, UNRESOLVED_OPERATION_STATES } from "./state.js";
export type {
  ChannelAction,
  ChannelAdapter,
  ChannelAdmission,
  ChannelAdmissionStatus,
  ChannelAgentResolverInput,
  ChannelApprovalControl,
  ChannelApprovalOutcome,
  ChannelAssistantDelta,
  ChannelAttachmentBytes,
  ChannelAttachmentKind,
  ChannelAttachmentRef,
  ChannelAuthorization,
  ChannelAuthorizeInput,
  ChannelBinding,
  ChannelBindingInput,
  ChannelCapabilities,
  ChannelDenialReason,
  ChannelDiagnostics,
  ChannelInboundEvent,
  ChannelLimits,
  ChannelNotifyInput,
  ChannelOperationRecord,
  ChannelOperationState,
  ChannelPruneResult,
  ChannelReceive,
  ChannelReconcileInput,
  ChannelReconcileOutcome,
  ChannelReconcileResult,
  ChannelReply,
  ChannelReplyControl,
  ChannelReplyRecord,
  ChannelReplyState,
  ChannelSendResult,
  ChannelUnresolvedOperation,
  ChannelUnsupportedReason,
  MessagingRuntime,
  MessagingRuntimeDrainResult,
  MessagingRuntimeOptions,
  ResolvedChannelLimits,
} from "./types.js";
