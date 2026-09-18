// Plan 079 Task 2: transport-neutral channel contracts. Frozen symbol names come from the
// Task 1 review (docs/history/079-messaging-primitive-review.md); option fields may grow in
// later tasks without renaming. Nothing here resolves credentials, reads the environment,
// opens sockets or starts a listener — hosts compose adapters and call `admit`.
import type { Agent, AgentIdentity, CheckpointStore, LeaseStore, OwnershipScope, SecretRedactor } from "@arnilo/prism";

/** What the host is being asked to authorize for one inbound event. */
export type ChannelAction = "message" | "command" | "approval" | "notify";

/** Bounded denial reasons. Never carries message text or transport payloads. */
export type ChannelDenialReason =
  | "malformed"
  | "oversized"
  | "rejected"
  | "revoked"
  | "authorization_failed"
  | "capacity"
  | "stopped"
  | "awaiting_decision"
  /** The durable journal is configured but unavailable; admission fails closed instead of running unclaimed. */
  | "unavailable";

/** Bounded unsupported reasons for authorized humans (no model call). */
export type ChannelUnsupportedReason = "unknown_command" | "invalid_argument" | "unknown_alias" | "unsupported_media";

export type ChannelAdmissionStatus = "accepted" | "denied" | "unsupported";

/** Admission outcome returned before the transport acknowledges receipt. */
export interface ChannelAdmission {
  readonly status: ChannelAdmissionStatus;
  readonly reason?: ChannelDenialReason | ChannelUnsupportedReason;
  /** Stable operation id for correlation; present on accepted ordinary turns. */
  readonly operationId?: string;
  /** True when this exact connection + event id was already admitted in-process. */
  readonly duplicate?: boolean;
}

export interface ChannelCapabilities {
  /** Telegram advances a poll offset; Signal has no transport acknowledgment step. */
  readonly acknowledgement: "telegram_offset" | "none";
  readonly controls: "callback" | "command";
  /** Platform text ceiling for one outbound message, in UTF-16 code units. */
  readonly maxTextCodeUnits: number;
}

/** One parsed inbound transport event. Transport fields are never authority. */
/** One opaque, transport-parsed approval action. The token never selects a session or agent. */
export interface ChannelApprovalControl {
  readonly token: string;
  readonly outcome: ChannelApprovalOutcome;
}

export type ChannelApprovalOutcome = "allow_once" | "reject_once";

export interface ChannelInboundEvent {
  readonly connectionId: string;
  /** Stable platform conversation key (chat id, Signal conversation/service id). */
  readonly externalConversationId: string;
  /** Stable platform actor key (Telegram user id, Signal service id/UUID) — never a display name. */
  readonly externalActorId: string;
  /** Transport acknowledgment unit: Telegram `update_id`, signal-cli envelope timestamp/id. */
  readonly eventId: string;
  readonly text: string;
  /**
   * Media the transport observed on this event: identifiers only, never bytes. Bytes exist only for
   * the duration of one bounded adapter fetch (or one `MessagingRuntimeOptions.fetchAttachment`
   * call) and are never journaled, logged, or retained on disk.
   */
  readonly attachments?: readonly ChannelAttachmentRef[];
  /** Opaque transport control parsed by the adapter; never becomes model input. */
  readonly approval?: ChannelApprovalControl;
  /** Transport thread id (Telegram forum topic / group reply thread). It is part of the session and reply-binding key. */
  readonly threadId?: string;
  readonly receivedAt?: string;
  /** Untrusted transport fields for host authorization context only. */
  readonly claims?: Readonly<Record<string, unknown>>;
}

/** Modality of one transport attachment reference. `image` is the only kind that can become model input. */
export type ChannelAttachmentKind = "image" | "document" | "voice";

/** One attachment *reference* on an inbound event: never the bytes, never a URL, never model-selected. */
export interface ChannelAttachmentRef {
  readonly kind: ChannelAttachmentKind;
  /** Transport file handle (Telegram `file_id`). Only the current event's refs are ever fetched. */
  readonly transportFileId: string;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly fileName?: string;
}

/** Bounded bytes returned by one attachment fetch; they never enter the journal or a reply. */
export interface ChannelAttachmentBytes {
  readonly bytes: Uint8Array;
  readonly mimeType?: string;
  readonly fileName?: string;
}

export interface ChannelAuthorizeInput {
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly eventId: string;
  /** Bounded inbound text (the channel input cap is enforced before this call). */
  readonly text: string;
  readonly action: ChannelAction;
  readonly threadId?: string;
  readonly receivedAt: string;
  readonly claims?: Readonly<Record<string, unknown>>;
}

/**
 * Host-verified grant for one observed sender. `identity` must satisfy
 * `assertIdentityActive` (host-verified, unexpired, unrevoked); ownership is always
 * derived with `ownershipFromIdentity`, never read from the event or from a narrowing guess.
 */
export interface ChannelAuthorization {
  readonly identity: AgentIdentity;
  /** Agent aliases this actor may address; unknown aliases fail closed. */
  readonly agentAliases: readonly string[];
  /** Alias used when the binding has no current selection. Defaults to the first alias. */
  readonly defaultAgentAlias?: string;
  /** Host grant revision, re-read on every event; a changed revision is a new authorization. */
  readonly grantRevision: string;
  /**
   * Opt-in for host-initiated notices (`MessagingRuntime.notify`) to this actor.
   * Missing is treated as `false`; inbound messages never need it.
   */
  readonly notifications?: boolean;
}

export interface ChannelAgentResolverInput {
  readonly agentAlias: string;
  readonly identity: AgentIdentity;
  readonly ownership: OwnershipScope;
  readonly connectionId: string;
  readonly externalConversationId: string;
}

/**
 * Host-initiated unicast notice. There is deliberately no fan-out field: the notice goes to
 * exactly one already-bound conversation/thread pair owned by `identity` (a group thread with
 * several bound actors, or any unbound pair, is denied). `notifyId` is the idempotency key.
 */
export interface ChannelNotifyInput {
  readonly identity: AgentIdentity;
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly threadId?: string;
  readonly notifyId: string;
  readonly text: string;
}

export interface ChannelBindingInput {
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly threadId?: string;
  readonly identity: AgentIdentity;
  readonly ownership: OwnershipScope;
  readonly agentAlias: string;
  /** Incremented by `/new`; part of the default session derivation. */
  readonly generation: number;
}

/** Owned Prism session (and optional branch leaf) for one binding. */
export interface ChannelBinding {
  readonly sessionId: string;
  readonly leafId?: string;
}

/** Opaque adapter presentation payload; values are server-issued controls, never model output. */
export interface ChannelReplyControl {
  readonly label: string;
  readonly value: string;
}

/** Outbound message addressed to the bound destination. */
export interface ChannelReply {
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly text: string;
  readonly kind: "final" | "notice";
  readonly controls?: readonly ChannelReplyControl[];
  /** Destination thread (Telegram `message_thread_id`); replies go to the topic the event came from. */
  readonly threadId?: string;
  /** Transport event/message id being answered, when known. */
  readonly inReplyTo?: string;
}

export interface ChannelSendResult {
  readonly delivered: boolean;
  readonly messageId?: string;
  /** Bounded reason when `delivered` is false (transport error class, not payload). */
  readonly reason?: string;
}

/** Channel-imposed caps; store/platform ceilings stay below the hard caps recorded in Task 1. */
export interface ChannelLimits {
  readonly maxInputBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxPendingPerBinding?: number;
  readonly maxPendingPerProcess?: number;
  readonly maxActiveSessions?: number;
  readonly maxRoutes?: number;
  readonly maxSeenEventsPerConnection?: number;
  readonly stopDeadlineMs?: number;
  /** Journal/reply retention in days; `prune` deletes older settled records. */
  readonly retentionDays?: number;
  /** Checkpoint list page size for journal sweeps. */
  readonly maxJournalPage?: number;
  /** Per-record bound on a journal value, enforced before save. */
  readonly maxJournalRecordBytes?: number;
  /** Lease TTL used when a `LeaseStore` is configured. */
  readonly leaseTtlMs?: number;
  /** Short-lived approval-control validity. */
  readonly approvalTtlMs?: number;
  /** Per-attachment byte ceiling for one `getFile` download (default 1 MiB, hard 4 MiB). */
  readonly maxAttachmentBytes?: number;
}

export interface ResolvedChannelLimits {
  readonly maxInputBytes: number;
  readonly maxResponseBytes: number;
  readonly maxPendingPerBinding: number;
  readonly maxPendingPerProcess: number;
  readonly maxActiveSessions: number;
  readonly maxRoutes: number;
  readonly maxSeenEventsPerConnection: number;
  readonly stopDeadlineMs: number;
  readonly retentionDays: number;
  readonly maxJournalPage: number;
  readonly maxJournalRecordBytes: number;
  readonly leaseTtlMs: number;
  readonly approvalTtlMs: number;
  readonly maxAttachmentBytes: number;
}

export interface MessagingRuntimeDrainResult {
  readonly settled: boolean;
  readonly pending: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

/** Durable lifecycle of one admitted transport event. */
export type ChannelOperationState =
  | "accepted"
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "suspended"
  /** Dead-letter: never claimed, or explicitly reconciled without replay. */
  | "abandoned"
  /** Claimed work whose outcome cannot be proven after a crash; never replayed automatically. */
  | "execution_unknown";

/** Durable delivery state of one staged reply. */
export type ChannelReplyState = "pending" | "delivered" | "delivery_failed" | "delivery_unknown";

/** Journal record for one admitted event; never carries inbound message text. */
export interface ChannelOperationRecord {
  readonly operationId: string;
  readonly eventId: string;
  readonly kind: ChannelAction;
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly threadId?: string;
  readonly agentAlias: string;
  readonly sessionId?: string;
  /** Core run correlation evidence (`AgentRunResult.runId`), durable for reconciliation. */
  readonly runId?: string;
  readonly state: ChannelOperationState;
  readonly replyStaged: boolean;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Bounded error code/class only; message text is never persisted. */
  readonly errorCode?: string;
}

/** Staged outbound reply; the only journal record that holds payload text, bounded and pruned. */
export interface ChannelReplyRecord {
  readonly operationId: string;
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly threadId?: string;
  readonly kind: "final" | "notice";
  readonly text: string;
  readonly controls?: readonly ChannelReplyControl[];
  readonly state: ChannelReplyState;
  readonly attempts: number;
  readonly messageId?: string;
  readonly reason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One operation that still needs host attention (no payload): an unresolved lifecycle state, or
 * a settled operation whose reply was never confirmed (`pending`/`delivery_unknown`/`delivery_failed`).
 */
export interface ChannelUnresolvedOperation {
  readonly operationId: string;
  readonly connectionId: string;
  readonly state: ChannelOperationState;
  readonly replyState?: ChannelReplyState;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ChannelReconcileInput {
  /** Verified caller identity; ownership is derived from it and must match the record exactly. */
  readonly identity: AgentIdentity;
  readonly connectionId: string;
  readonly operationId: string;
  /** Optimistic version read from `listUnresolved`; stale values are rejected. */
  readonly expectedVersion: number;
  /** Required when an effect may already have happened (unknown execution or ambiguous send). */
  readonly acknowledgeDuplicateRisk?: boolean;
}

export type ChannelReconcileOutcome =
  | "abandoned"
  | "execution_unknown"
  | "reply_delivered"
  | "reply_failed"
  /** The resend itself was ambiguous: the reply may or may not have landed. */
  | "reply_unknown"
  | "none";

export interface ChannelReconcileResult {
  readonly status: "resolved" | "not_found" | "conflict" | "denied" | "unavailable";
  readonly outcome?: ChannelReconcileOutcome;
  readonly state?: ChannelOperationState;
  /** Bounded explanation, never a raw error payload. */
  readonly detail?: string;
}

export interface ChannelPruneResult {
  readonly scanned: number;
  readonly deleted: number;
  readonly retained: number;
}

/** Bounded runtime counters; no message text, external ids, tokens or key material. */
export interface ChannelDiagnostics {
  readonly admitted: number;
  readonly denied: number;
  readonly unsupported: number;
  readonly duplicates: number;
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly suspended: number;
  readonly deliveries: number;
  readonly deliveryFailures: number;
  readonly truncated: number;
  /** Journal writes/reads that failed; admission fails closed and is counted here. */
  readonly storageFailures: number;
  /** Lease acquisition/renewal failures, including deferrals to another receiver. */
  readonly leaseLosses: number;
}

/**
 * Adapter intake callback. Returning the optional `ChannelAdmission` lets an adapter retain its
 * transport acknowledgement on capacity/storage failure; legacy callbacks may return nothing.
 */
export type ChannelReceive = (event: ChannelInboundEvent) => unknown;

/**
 * Cumulative assistant text observed so far in the current answer of one running turn. This is a
 * *preview* seam: it is never journaled, never counted as a reply, and never replaces the
 * terminal `ChannelReply` — an adapter may render it (Telegram drafts) or ignore it.
 */
export interface ChannelAssistantDelta {
  readonly connectionId: string;
  readonly externalConversationId: string;
  /** Present when the bound conversation is a thread (e.g. a forum topic). */
  readonly threadId?: string;
  /** Redacted cumulative text of the assistant message being produced; may be truncated by the adapter. */
  readonly text: string;
}

/** Transport implementation contract. Adapters await `admit` before acknowledging receipt. */
export interface ChannelAdapter {
  readonly connectionId: string;
  readonly capabilities: ChannelCapabilities;
  start(receive: ChannelReceive): Promise<void>;
  send(reply: ChannelReply): Promise<ChannelSendResult>;
  stop(): Promise<void>;
}

export interface MessagingRuntimeOptions {
  /** Maps an observed sender + action to a verified grant, or `false` when unknown/denied. */
  readonly authorize: (
    input: ChannelAuthorizeInput,
  ) => ChannelAuthorization | false | undefined | Promise<ChannelAuthorization | false | undefined>;
  /** Host-configured agent for the authorized alias; re-resolved on every turn. */
  readonly resolveAgent: (input: ChannelAgentResolverInput) => Agent | Promise<Agent>;
  /** Host delivery seam, normally the adapter's `send` (Task 4/6) or a durable outbox (Task 3). */
  readonly deliver: (reply: ChannelReply) => ChannelSendResult | Promise<ChannelSendResult>;
  /** Host-owned binding resolver; defaults to a deterministic per-binding session id. */
  readonly resolveBinding?: (input: ChannelBindingInput) => ChannelBinding | Promise<ChannelBinding>;
  readonly limits?: ChannelLimits;
  readonly redactor?: SecretRedactor;
  /** Durable journal: bindings, operation dedup/CAS claim, intake cursor and reply staging. */
  readonly checkpoints?: CheckpointStore;
  /** Optional fencing: one worker per binding; a lost lease fails closed. */
  readonly leases?: LeaseStore;
  /**
   * Opt-in live preview of the answer being produced by the current turn (cumulative, already
   * redacted, same text the terminal reply will carry). Called only while a turn is running and
   * never journaled; a host typically wires it to an adapter method such as Telegram `sendDraft`.
   * Throwing here is ignored — previews can never fail a turn.
   */
  readonly onAssistantDelta?: (delta: ChannelAssistantDelta) => void;
  /**
   * Host media seam, normally an adapter's own `fetchAttachment` (e.g. Telegram `getFile`). Called
   * only with refs of the event being run, only for models that declare image input, and bounded by
   * the adapter's `maxAttachmentBytes`; bytes live for the run call only. Missing seam = images are
   * unsupported (bounded notice, no model call).
   */
  readonly fetchAttachment?: (ref: ChannelAttachmentRef) => Promise<ChannelAttachmentBytes | undefined | null>;
}

export interface MessagingRuntime {
  /** Authorize and admit one event; resolves before the adapter acknowledges transport receipt. */
  admit(event: ChannelInboundEvent): Promise<ChannelAdmission>;
  /**
   * Host-initiated unicast notice to an existing binding. No agent run, no tools, no queue:
   * the destination comes from the stored binding and the grant must carry `notifications: true`.
   */
  notify(input: ChannelNotifyInput): Promise<ChannelAdmission>;
  /** Wait for queued/running work to settle, up to `deadlineMs` (unbounded when omitted). */
  drain(options?: { readonly deadlineMs?: number }): Promise<MessagingRuntimeDrainResult>;
  diagnostics(): ChannelDiagnostics;
  /** Reject new admissions, cancel queued work, abort active runs, wait bounded for settle. */
  stop(): Promise<void>;
  /**
   * Authorized resolution of one dead-letter/unknown operation or undelivered staged reply.
   * Never re-executes model or tool work; a staged reply may be resent with explicit acknowledgment.
   */
  reconcile(input: ChannelReconcileInput): Promise<ChannelReconcileResult>;
  /** Bounded listing of unresolved (`accepted`/`executing`) operations in one ownership scope. */
  listUnresolved(input: { readonly identity: AgentIdentity; readonly limit?: number }): Promise<readonly ChannelUnresolvedOperation[]>;
  /** Delete settled journal records past retention; unresolved work is never pruned. */
  prune(input: { readonly identity: AgentIdentity; readonly now?: string }): Promise<ChannelPruneResult>;
}
