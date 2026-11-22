import type { AgentEvent, EventOrigin, JsonValue } from "@arnilo/prism";
import { delegateStepData } from "./step.js";

/** The bound on one `delegate.activity` event's text, in UTF-8 bytes. */
export const MAX_DELEGATE_ACTIVITY_TEXT_BYTES = 2_048;
/** How often buffered child text is flushed, at most. */
export const DEFAULT_ACTIVITY_FLUSH_MS = 1_000;

export type DelegateActivityKind = "tool.started" | "tool.finished" | "text";

/**
 * One `delegate.activity` payload: the child's tool start and finish (name, call id, status, duration) or a flushed run of
 * its text. Never a tool's arguments or result.
 */
export interface DelegateActivityInput {
  readonly origin: EventOrigin;
  /** The session the delegation was started from: package events are agent-wide, so a host routes by this. */
  readonly parentSessionId: string;
  readonly kind: DelegateActivityKind;
  readonly tool?: string;
  readonly toolCallId?: string;
  readonly status?: string;
  readonly durationMs?: number;
  readonly text?: string;
  /** Characters of child text dropped between flushes because the buffer was full. */
  readonly droppedChars?: number;
}

function cutUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  // Cut by code point so a surrogate pair is never split.
  let out = "";
  let bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).byteLength;
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out;
}

/** Builds the bounded payload. Ids reuse the `delegate.step` checks; the text is cut to `MAX_DELEGATE_ACTIVITY_TEXT_BYTES`. */
export function delegateActivityData(input: DelegateActivityInput): JsonValue {
  // `origin` and the ids go through the same validator as `delegate.step`.
  const step = delegateStepData({ origin: input.origin, phase: "milestone", sessionId: input.parentSessionId }) as Record<
    string,
    JsonValue
  >;
  const data: Record<string, JsonValue> = {
    origin: step.origin as JsonValue,
    parentSessionId: step.sessionId as JsonValue,
    kind: input.kind,
  };
  if (input.tool !== undefined) data.tool = cutUtf8(input.tool, 128);
  if (input.toolCallId !== undefined) data.toolCallId = cutUtf8(input.toolCallId, 256);
  if (input.status !== undefined) data.status = cutUtf8(input.status, 32);
  if (input.durationMs !== undefined && Number.isFinite(input.durationMs)) data.durationMs = Math.max(0, Math.round(input.durationMs));
  if (input.text !== undefined) data.text = cutUtf8(input.text, MAX_DELEGATE_ACTIVITY_TEXT_BYTES);
  if (input.droppedChars !== undefined && input.droppedChars > 0) data.droppedChars = input.droppedChars;
  return data;
}

/**
 * Turns one child leg's events into `delegate.activity` payloads: one per tool start and finish, and the child's text
 * buffered and flushed at most once per `flushMs` (and once when the leg ends). The buffer holds at most one event's
 * worth of text; the rest is counted, not kept.
 */
export function createActivityReporter(options: {
  readonly origin: EventOrigin;
  readonly parentSessionId: string;
  readonly emit: (data: JsonValue) => void;
  readonly flushMs?: number;
}) {
  const flushMs = options.flushMs ?? DEFAULT_ACTIVITY_FLUSH_MS;
  const base = { origin: options.origin, parentSessionId: options.parentSessionId };
  const send = (input: Omit<DelegateActivityInput, "origin" | "parentSessionId">): void => {
    try {
      options.emit(delegateActivityData({ ...base, ...input }));
    } catch {
      // Reporting is advisory and never fails a delegation.
    }
  };
  let buffer = "";
  let dropped = 0;
  let lastFlush = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (buffer.length === 0 && dropped === 0) return;
    send({ kind: "text", text: buffer, ...(dropped > 0 ? { droppedChars: dropped } : {}) });
    buffer = "";
    dropped = 0;
    lastFlush = Date.now();
  };
  const addText = (text: string): void => {
    // A character is at most 4 bytes: keep at most one event's worth, count the rest.
    const room = MAX_DELEGATE_ACTIVITY_TEXT_BYTES - buffer.length;
    if (room <= 0) dropped += text.length;
    else {
      buffer += text.slice(0, room);
      dropped += Math.max(0, text.length - room);
    }
    if (timer !== undefined) return;
    timer = setTimeout(flush, Math.max(0, lastFlush + flushMs - Date.now()));
  };
  return {
    onEvent(event: AgentEvent): void {
      if (event.type === "tool.started") {
        flush();
        send({ kind: "tool.started", tool: event.call.name, toolCallId: event.call.id, status: "started" });
      } else if (event.type === "tool.completed") {
        flush();
        send({
          kind: "tool.finished",
          ...((event.name ?? event.result.name) === undefined ? {} : { tool: event.name ?? event.result.name }),
          toolCallId: event.toolCallId ?? event.result.toolCallId,
          status: event.status,
          durationMs: event.metadata.durationMs,
        });
      } else if (event.type === "message.delta" && event.content.type === "text") {
        addText(event.content.text);
      }
    },
    /** Flushes what is left; the leg is over. */
    end(): void {
      flush();
    },
  };
}
