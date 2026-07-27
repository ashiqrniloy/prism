import type { AgentEvent, SecretRedactor, ToolCallContent, ToolResult } from "@arnilo/prism";
import type { CoWorkEvent, CoWorkKind } from "./types.js";

/** Host-owned allow-list. All callbacks receive redacted Prism values. */
export interface AgUiProjection {
  /** Return a safe display string to expose tool arguments; absent means omit them. */
  toolArguments?(call: ToolCallContent): string | undefined;
  /** Return a safe display string to expose a tool result; absent means status only. */
  toolResult?(result: ToolResult): string | undefined;
  /** Return a safe, JSON-serializable application-state addition; absent exposes status only. */
  state?(event: AgentEvent): unknown;
  /** Return a safe, JSON-serializable co-work payload; absent exposes the redacted event fields. */
  coWork?(event: CoWorkEvent): unknown;
  /** Reserved for host-owned path projection in handlers; mapper never exposes paths itself. */
  path?(value: string): string | undefined;
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

/**
 * Validates, host-projects, redacts, and byte-caps one co-work event into a safe JSON
 * payload shared by the AG-UI and ACP mappers. Malformed or oversized events fail closed
 * (undefined) so they are dropped rather than leaked. Pure: no side effects, so replay
 * from a cursor never duplicates work.
 */
export function projectCoWorkEvent(event: CoWorkEvent, options: CoWorkProjectionOptions): Record<string, unknown> | undefined {
  if (!isCoWorkEvent(event)) return undefined;
  try {
    const shaped = options.projection?.coWork?.(event) ?? event;
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
