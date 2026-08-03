import type { AgentIdentity, JsonObject, OwnershipScope, ToolDefinition } from "@arnilo/prism";

export type WorkProvider = "microsoft365" | "google-workspace";

export type Microsoft365Capability = "mail" | "calendar" | "files" | "tasks" | "todo" | "planner" | "teams";

export type Microsoft365Op =
  | "version"
  | "mail.list"
  | "mail.get"
  | "mail.send"
  | "calendar.list"
  | "calendar.add"
  | "file.list"
  | "file.add"
  | "file.copy"
  | "file.share"
  | "todo.list"
  | "todo.add"
  | "todo.complete"
  | "planner.list"
  | "planner.add"
  | "planner.complete";

export type GoogleWorkspaceCapability = "mail" | "calendar" | "files" | "tasks" | "docs" | "sheets" | "slides";

export type GoogleWorkspaceOp =
  | "version"
  | "mail.list"
  | "mail.get"
  | "mail.send"
  | "calendar.list"
  | "calendar.add"
  | "file.list"
  | "file.add"
  | "file.share"
  | "task.list"
  | "task.add"
  | "task.complete"
  | "docs.create"
  | "sheets.create"
  | "slides.create";

export interface WorkLimits {
  readonly maxPaginationPages?: number;
  readonly maxItemsPerPage?: number;
  readonly maxAggregateItems?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxAttachmentBytes?: number;
  readonly maxFileBytes?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly timeoutMs?: number;
  readonly maxConcurrency?: number;
  readonly maxRetries?: number;
  readonly maxIdempotencyKeyBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonProperties?: number;
}
export type ResolvedWorkLimits = Required<WorkLimits>;

export interface WorkCitation {
  readonly citationId: string;
  readonly provider: WorkProvider;
  readonly resourceId?: string;
  readonly url?: string;
}

export interface WorkMailMessage extends WorkCitation {
  readonly subject?: string;
  readonly preview?: string;
  readonly from?: string;
  readonly to?: readonly string[];
  readonly receivedAt?: string;
  readonly isDraft?: boolean;
  readonly changeKey?: string;
  readonly untrusted: true;
}

export interface WorkCalendarEvent extends WorkCitation {
  readonly subject?: string;
  readonly start?: string;
  readonly end?: string;
  readonly changeKey?: string;
  readonly untrusted: true;
}

export interface WorkFileItem extends WorkCitation {
  readonly name?: string;
  readonly size?: number;
  readonly eTag?: string;
  readonly mimeType?: string;
  readonly untrusted: true;
}

export interface WorkTaskItem extends WorkCitation {
  readonly title?: string;
  readonly status?: string;
  readonly changeKey?: string;
  readonly untrusted: true;
}

export interface WorkPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly truncated?: boolean;
  readonly untrusted: true;
}

export interface WorkDraft {
  readonly draftId: string;
  readonly provider: WorkProvider;
  readonly op: string;
  readonly identityKey: string;
  readonly payload: JsonObject;
  readonly createdAt: string;
  readonly status: "pending" | "approved" | "executed" | "rejected";
  readonly concurrencyToken?: string;
}

/** Bounded summary retained after an approved external mutation. */
export interface WorkMutationResult {
  readonly draftId: string;
  readonly resourceId?: string;
}

export interface WorkMutationFailure {
  readonly code: string;
  readonly reference?: string;
}

export type WorkMutationStatus = "in_progress" | "completed" | "failed_retryable" | "failed_terminal" | "unknown";

export interface WorkMutationKey {
  /** Active host-verified identity; its exact owner/principal scopes this mutation. */
  readonly identity: AgentIdentity;
  readonly key: string;
  readonly op: string;
  readonly signal?: AbortSignal;
}

export interface WorkMutationBeginInput extends WorkMutationKey {
  readonly claimTtlMs?: number;
  readonly maxAttempts?: number;
}

export interface WorkMutationTransitionInput extends WorkMutationKey {
  readonly claimToken: string;
  readonly expectedVersion: number;
}

export interface WorkMutationRecord extends OwnershipScope {
  readonly principalId: string;
  readonly key: string;
  readonly op: string;
  readonly status: WorkMutationStatus;
  readonly attempt: number;
  readonly version: number;
  readonly claimToken?: string;
  readonly result?: WorkMutationResult;
  readonly failure?: WorkMutationFailure;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
}

export interface IdempotencyStore {
  /** Reconciliation read. Normal execution starts with {@link begin}. */
  get(input: WorkMutationKey): Promise<WorkMutationRecord | undefined>;
  begin(input: WorkMutationBeginInput): Promise<{ readonly outcome: "acquired" | "existing"; readonly record: WorkMutationRecord }>;
  complete(input: WorkMutationTransitionInput & { readonly result: WorkMutationResult }): Promise<WorkMutationRecord>;
  fail(
    input: WorkMutationTransitionInput & { readonly status: "failed_retryable" | "failed_terminal"; readonly failure: WorkMutationFailure },
  ): Promise<WorkMutationRecord>;
  markUnknown(input: WorkMutationTransitionInput & { readonly failure?: WorkMutationFailure }): Promise<WorkMutationRecord>;
  resolveUnknown(
    input: WorkMutationKey & {
      readonly expectedVersion: number;
      readonly status: "failed_retryable" | "failed_terminal";
      readonly failure?: WorkMutationFailure;
    },
  ): Promise<WorkMutationRecord>;
}

export interface WorkApprovalGate {
  /** Return true when host already authorized this draft/mutation. */
  isApproved(input: { draftId: string; op: string; identity: AgentIdentity }): Promise<boolean> | boolean;
}

export interface ExternalRecipientPolicy {
  /** Return true when address/domain may receive external share/mail. Default deny. */
  allow(address: string): boolean;
}

export interface WorkCliExecResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WorkCliRunner {
  exec(argv: readonly string[], options?: { signal?: AbortSignal; env?: Readonly<Record<string, string>> }): Promise<WorkCliExecResult>;
}

/**
 * Late-bound, per-identity connector token source. Returns env vars to inject (e.g.
 * `{ M365_ACCESSTOKEN: "…" }`) or undefined when the credential is missing/expired/revoked,
 * which fails the call closed. Tokens never appear in argv or model context.
 */
export interface WorkTokenProvider {
  tokenEnv(
    identity: AgentIdentity,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, string>> | undefined> | Readonly<Record<string, string>> | undefined;
}

export interface Microsoft365Adapter {
  readonly provider: "microsoft365";
  readonly identity: AgentIdentity;
  readonly allowedOps: ReadonlySet<Microsoft365Op>;
  ensureReady(signal?: AbortSignal): Promise<string>;
  runOp(op: Microsoft365Op, args: JsonObject, signal?: AbortSignal): Promise<unknown>;
  createDraft(op: Microsoft365Op, payload: JsonObject): WorkDraft;
  getDraft(draftId: string): WorkDraft | undefined;
  markDraft(draftId: string, status: WorkDraft["status"], concurrencyToken?: string): WorkDraft;
}

export interface GoogleWorkspaceAdapter {
  readonly provider: "google-workspace";
  readonly identity: AgentIdentity;
  readonly allowedOps: ReadonlySet<GoogleWorkspaceOp>;
  ensureReady(signal?: AbortSignal): Promise<string>;
  runOp(op: GoogleWorkspaceOp, args: JsonObject, signal?: AbortSignal): Promise<unknown>;
  createDraft(op: GoogleWorkspaceOp, payload: JsonObject): WorkDraft;
  getDraft(draftId: string): WorkDraft | undefined;
  markDraft(draftId: string, status: WorkDraft["status"], concurrencyToken?: string): WorkDraft;
}

export interface WorkToolsOptions {
  readonly microsoft365?: Microsoft365Adapter;
  readonly googleWorkspace?: GoogleWorkspaceAdapter;
  readonly approval?: WorkApprovalGate;
  readonly idempotencyStore?: IdempotencyStore;
  readonly externalRecipients?: ExternalRecipientPolicy;
  /** Optional attachment/file scan before inbound use. Required for inbound attachment bytes. */
  readonly scanAttachment?: (input: { bytes: number; name?: string }) => Promise<void> | void;
}

export type WorkToolSet = readonly ToolDefinition[];
