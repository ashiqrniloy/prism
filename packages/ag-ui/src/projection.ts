import type { Message as AgUiMessage, Interrupt } from "@ag-ui/core";
import type { AgentEvent, SecretRedactor, ThinkingContent, ToolCallContent, ToolResult } from "@arnilo/prism";
import type { CodingLifecycleEvent, FileChangedEvent } from "@arnilo/prism-coding-agent";
import { assertBoundedJson } from "./input.js";
import type { ResolvedAgUiLimits } from "./limits.js";
import type { CoWorkEvent, CoWorkKind } from "./types.js";

export interface AgUiActivitySnapshot {
  readonly type: "snapshot";
  readonly messageId: string;
  readonly activityType: string;
  readonly content: Record<string, unknown>;
  readonly replace?: boolean;
}

export interface AgUiActivityDelta {
  readonly type: "delta";
  readonly messageId: string;
  readonly activityType: string;
  readonly patch: readonly unknown[];
}

export interface AgUiReasoningProjection {
  /** Visible, host-approved reasoning summary. Prism never exposes thinking by default. */
  readonly text?: string;
  /** Opaque value already encrypted for this AG-UI client; never inferred from a Prism signature. */
  readonly encryptedValue?: string;
}

export interface AgUiRawProjection {
  readonly event: unknown;
  readonly source?: string;
}

export interface AgUiCustomProjection {
  readonly name: string;
  readonly value: unknown;
}

/** Value or promise of it; hooks may call async host APIs like `session.entries()`. */
export type Awaitable<T> = T | Promise<T>;

/** Host-owned allow-list. All callbacks receive redacted Prism values. Sync hooks keep exact behavior; async hooks are awaited in event order (never `Promise.all`). */
export interface AgUiProjection {
  /** Return a safe display string to expose tool arguments; absent means omit them. */
  toolArguments?(call: ToolCallContent): Awaitable<string | undefined>;
  /** Return a safe display string to expose a tool result; absent means status only. */
  toolResult?(result: ToolResult): Awaitable<string | undefined>;
  /** Return safe file locations for a tool-call update; absent means no locations. */
  toolLocations?(result: ToolResult): Awaitable<readonly { path: string; line?: number }[] | undefined>;
  /** Return one safe file diff for a tool-call update; absent means no diff. */
  toolDiff?(result: ToolResult): Awaitable<{ path: string; oldText?: string; newText: string } | undefined>;
  /** Return safe display text for a coding lifecycle event (worktree/process fallbacks); absent means omit the update. */
  lifecycle?(event: CodingLifecycleEvent): Awaitable<string | undefined>;
  /** Return one safe file diff for a `file_changed` lifecycle event; absent means locations only. */
  fileDiff?(event: FileChangedEvent): Awaitable<{ path: string; oldText?: string; newText: string } | undefined>;
  /** Legacy run-status state addition used for suspension/resume snapshots. */
  state?(event: AgentEvent): Awaitable<unknown>;
  /** Return a complete safe state replacement for a `STATE_SNAPSHOT`. */
  stateSnapshot?(event: AgentEvent): Awaitable<unknown>;
  /** Return an RFC 6902 patch for a `STATE_DELTA`; absent means no delta. */
  stateDelta?(event: AgentEvent): Awaitable<readonly unknown[] | undefined>;
  /** Return a complete safe transcript for `MESSAGES_SNAPSHOT`; host preserves AG-UI message IDs. */
  messages?(event: AgentEvent): Awaitable<readonly AgUiMessage[] | undefined>;
  /** Return one safe activity snapshot or delta. */
  activity?(event: AgentEvent): Awaitable<AgUiActivitySnapshot | AgUiActivityDelta | undefined>;
  /** Explicitly reveal a safe reasoning summary or pre-encrypted client value. */
  reasoning?(content: ThinkingContent, event: AgentEvent): Awaitable<AgUiReasoningProjection | undefined>;
  /** Explicitly expose a bounded raw event wrapper. */
  raw?(event: AgentEvent): Awaitable<AgUiRawProjection | undefined>;
  /** Explicitly expose one bounded named `CUSTOM` value. */
  custom?(event: AgentEvent): Awaitable<AgUiCustomProjection | undefined>;
  /** Return safe interrupt additions. Core decision/CAS fields remain adapter-owned. */
  interrupt?(event: Extract<AgentEvent, { readonly type: "agent_suspended" }>): Awaitable<readonly Interrupt[] | undefined>;
  /** Return a safe, JSON-serializable co-work payload; absent exposes the redacted event fields. */
  coWork?(event: CoWorkEvent): Awaitable<unknown>;
  /** Reserved for host-owned path projection in handlers; mapper never exposes paths itself. */
  path?(value: string): Awaitable<string | undefined>;
}

const COWORK_KINDS: readonly CoWorkKind[] = [
  "artifact.progress",
  "artifact.approval.requested",
  "draft.connector.pending",
  "browser.snapshot",
  "artifact.download.link",
];

export interface CoWorkProjectionOptions {
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
  readonly maxBytes: number;
}

/** Validates a host-projected JSON value and returns a detached copy. */
export function projectAgUiJson(value: unknown, maxBytes: number, limits: ResolvedAgUiLimits, name: string): unknown | undefined {
  if (value === undefined) return undefined;
  try {
    assertBoundedJson(value, maxBytes, limits, name);
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return undefined;
  }
}

/** RFC 6902 has a small, exact wire shape; unsupported operations fail closed. */
export function projectAgUiPatch(
  value: readonly unknown[] | undefined,
  maxOperations: number,
  maxBytes: number,
  limits: ResolvedAgUiLimits,
  name: string,
): readonly unknown[] | undefined {
  if (value === undefined || value.length > maxOperations) return undefined;
  const projected = projectAgUiJson(value, maxBytes, limits, name);
  if (!Array.isArray(projected) || projected.some((operation) => !isPatchOperation(operation))) return undefined;
  return projected;
}

/**
 * Validates, host-projects, redacts, and byte-caps one co-work event into a safe JSON
 * payload shared by the AG-UI and ACP mappers. Malformed or oversized events fail closed
 * (undefined) so they are dropped rather than leaked. Pure: no side effects, so replay
 * from a cursor never duplicates work. The `coWork` hook may be async and is awaited.
 */
export async function projectCoWorkEvent(
  event: CoWorkEvent,
  options: CoWorkProjectionOptions,
): Promise<Record<string, unknown> | undefined> {
  if (!isCoWorkEvent(event)) return undefined;
  try {
    const shaped = (await options.projection?.coWork?.(event)) ?? event;
    const redacted = options.redactor?.redact(shaped) ?? shaped;
    const serialized = JSON.stringify(redacted);
    if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > options.maxBytes) return undefined;
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return { kind: event.kind, ...(parsed as Record<string, unknown>) };
  } catch {
    return undefined;
  }
}

function isPatchOperation(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const operation = value as Record<string, unknown>;
  if (typeof operation.op !== "string" || typeof operation.path !== "string" || !validPointer(operation.path)) return false;
  switch (operation.op) {
    case "add":
    case "replace":
    case "test":
      return Object.hasOwn(operation, "value");
    case "remove":
      return true;
    case "move":
    case "copy":
      return typeof operation.from === "string" && validPointer(operation.from);
    default:
      return false;
  }
}

function validPointer(value: string): boolean {
  return value.length <= 4 * 1024 && !/[\0\r\n]/.test(value) && (value === "" || value.startsWith("/"));
}

function isCoWorkEvent(value: unknown): value is CoWorkEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as { kind?: unknown };
  if (typeof event.kind !== "string" || !COWORK_KINDS.includes(event.kind as CoWorkKind)) return false;
  const record = value as Record<string, unknown>;
  const string = (key: string) => typeof record[key] === "string" && (record[key] as string).length > 0;
  const number = (key: string) => typeof record[key] === "number" && Number.isFinite(record[key]);
  switch (event.kind) {
    case "artifact.progress":
      return string("artifactId") && number("version") && string("status") && (record.progress === undefined || number("progress"));
    case "artifact.approval.requested":
      return (
        string("artifactId") &&
        number("version") &&
        (record.reviewer === undefined || string("reviewer")) &&
        (record.reason === undefined || string("reason"))
      );
    case "draft.connector.pending":
      return string("connectorId") && string("scope") && string("status");
    case "browser.snapshot":
      return string("snapshotId") && string("summary");
    case "artifact.download.link":
      return string("artifactId") && number("version") && string("link") && string("expiresAt");
    default:
      return false;
  }
}
