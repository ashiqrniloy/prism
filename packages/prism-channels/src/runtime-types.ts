import type { OwnershipScope, SecretRedactor } from "@arnilo/prism";
import type { ChannelDeliveryJournal } from "./delivery.js";
import type { ChannelStateStore } from "./state.js";
import type {
  ChannelAuthorization,
  ChannelInboundEvent,
  ChannelOperationRecord,
  MessagingRuntimeOptions,
  ResolvedChannelLimits,
} from "./types.js";

export const MAX_ID_BYTES = 256;
export const MAX_ERROR_BYTES = 512;
export const TRUNCATION_MARKER = "…[truncated]";
export const GENERIC_FAILURE = "The request failed before it produced an answer.";
export const HELP_TEXT = "Commands: /help, /status, /new, /agent <alias>, /cancel.";
export const COMMAND_NAMES: ReadonlySet<string> = new Set(["help", "status", "new", "agent", "cancel"]);
export const MAX_ATTACHMENT_REFS = 8;
export const MAX_ATTACHMENT_META_BYTES = 256;
export const UNSUPPORTED_MEDIA_NOTICE = "That attachment cannot be processed by the selected agent.";

export interface Turn {
  readonly event: ChannelInboundEvent;
  readonly authorization: ChannelAuthorization;
  readonly ownership: OwnershipScope;
  readonly alias: string;
  readonly operationId: string;
  cancelled: boolean;
  controller?: AbortController;
  opVersion?: number;
  opRecord?: ChannelOperationRecord;
  lease?: RouteLease;
}

export interface RouteLease {
  readonly key: string;
  token: string;
  fencingToken: number;
  expiresAt: number;
}

export interface RouteState {
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly threadId?: string;
  readonly alias: string;
  generation: number;
  sessionId?: string;
  leafId?: string;
  suspended: boolean;
  suspendedRun?: { readonly operationId: string; readonly runId: string; readonly sessionId: string };
  resuming: boolean;
  pumping: boolean;
  hydrated: boolean;
  bindingVersion?: number;
  ownershipHint?: OwnershipScope;
  lease?: RouteLease;
  readonly queue: Turn[];
  active?: Turn;
}

export interface Counters {
  admitted: number;
  denied: number;
  unsupported: number;
  duplicates: number;
  completed: number;
  failed: number;
  cancelled: number;
  suspended: number;
  deliveries: number;
  deliveryFailures: number;
  truncated: number;
  storageFailures: number;
  leaseLosses: number;
}

export interface RuntimeContext {
  readonly options: MessagingRuntimeOptions;
  readonly limits: ResolvedChannelLimits;
  readonly redactor: SecretRedactor | undefined;
  readonly journal: ChannelStateStore | undefined;
  readonly replies: ChannelDeliveryJournal | undefined;
  readonly approvals: ReturnType<typeof import("./approvals.js").createChannelApprovalStore> | undefined;
  readonly leaseOwnerId: string;
  readonly counters: Counters;
  readonly routes: Map<string, RouteState>;
  readonly currentAliases: Map<string, string>;
  readonly seenEvents: Map<string, { ids: Set<string>; order: string[] }>;
  readonly inflight: Set<Promise<void>>;
  readonly slotWaiters: (() => void)[];
  activeRuns: number;
  stopped: boolean;
}
