import {
  acceptDeviceChunk,
  assertDeviceAdmit,
  type DeviceAdmitRequest,
  type JsonObject,
  type RealtimeEvent,
  type RealtimeSession,
  type ResolvedDevicePolicy,
  type ToolCallContent,
  type ToolResult,
  type Usage,
} from "@arnilo/prism";

export const DEFAULT_REALTIME_TRANSCRIPT_CHARS = 8_192;
export const HARD_REALTIME_TRANSCRIPT_CHARS = 65_536;
export const HARD_REALTIME_PENDING_CALLS = 32;
export const HARD_REALTIME_TOOL_OUTPUT_BYTES = 65_536;

export type RealtimeVoiceErrorCode = "ERR_PRISM_REALTIME_CONSENT" | "ERR_PRISM_REALTIME_LIMIT";

export class RealtimeVoiceError extends Error {
  constructor(
    readonly code: RealtimeVoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RealtimeVoiceError";
  }
}

export interface RealtimeVoiceExecuteContext {
  readonly signal: AbortSignal;
}

export interface RealtimeVoiceSnapshot {
  readonly pendingCallIds: readonly string[];
  readonly completedCallIds: readonly string[];
  readonly cancelledCallIds: readonly string[];
  readonly unknownCallIds: readonly string[];
  readonly interrupted: boolean;
  readonly consent: boolean;
  readonly effectAfterInterrupt: boolean;
  readonly usage?: Usage;
  readonly usageMissing: boolean;
}

export interface RealtimeVoiceBridge {
  sendAudio(chunk: Uint8Array, options?: { readonly signal?: AbortSignal }): Promise<void>;
  interrupt(options?: { readonly signal?: AbortSignal }): Promise<void>;
  revokeConsent(): Promise<void>;
  run(signal?: AbortSignal): Promise<RealtimeVoiceSnapshot>;
  snapshot(): RealtimeVoiceSnapshot;
  close(reason?: string): Promise<void>;
}

export interface RealtimeVoiceBridgeOptions {
  readonly session: RealtimeSession;
  readonly policy: ResolvedDevicePolicy;
  readonly admit: DeviceAdmitRequest;
  readonly execute: (call: ToolCallContent, context: RealtimeVoiceExecuteContext) => Promise<ToolResult>;
  readonly recordUsage?: (usage: Usage) => void | Promise<void>;
  readonly onTranscript?: (text: string, role: "user" | "assistant") => void | Promise<void>;
  readonly onEvent?: (event: RealtimeEvent) => void;
  /** Default false: transcripts are not retained or forwarded to `onTranscript`. */
  readonly retainTranscripts?: boolean;
  readonly maxTranscriptChars?: number;
  /** Task 21 names-only grant. Omitted = all host tools; empty = none. */
  readonly toolNames?: readonly string[];
  /** Reject provider-hosted tools instead of treating them as already executed. */
  readonly strictGovernance?: boolean;
  /** Reconnect: skip these call ids (no replay). */
  readonly seenCallIds?: ReadonlySet<string>;
  readonly completeTool?: (callId: string, output: string) => Promise<void>;
}

interface PendingCall {
  readonly abort: AbortController;
  status: "queued" | "executing";
}

export function createRealtimeVoiceBridge(options: RealtimeVoiceBridgeOptions): RealtimeVoiceBridge {
  assertDeviceAdmit(options.policy, options.admit);
  const maxTranscriptChars = cap(
    "maxTranscriptChars",
    options.maxTranscriptChars ?? DEFAULT_REALTIME_TRANSCRIPT_CHARS,
    HARD_REALTIME_TRANSCRIPT_CHARS,
  );
  const allow = options.toolNames ? new Set(options.toolNames) : undefined;
  const seen = new Set(options.seenCallIds ?? []);
  const pending = new Map<string, PendingCall>();
  const completed: string[] = [];
  const cancelled: string[] = [];
  const unknown: string[] = [];
  let consent = true;
  let interrupted = false;
  let dropAudio = false;
  let effectAfterInterrupt = false;
  let usage: Usage | undefined;
  let closed = false;
  let running: Promise<RealtimeVoiceSnapshot> | undefined;

  function snapshot(): RealtimeVoiceSnapshot {
    return {
      pendingCallIds: [...pending.keys()],
      completedCallIds: [...completed],
      cancelledCallIds: [...cancelled],
      unknownCallIds: [...unknown],
      interrupted,
      consent,
      effectAfterInterrupt,
      ...(usage ? { usage } : {}),
      usageMissing: usage === undefined,
    };
  }

  async function finishTool(call: ToolCallContent, result: ToolResult): Promise<void> {
    const output = toolOutput(result);
    const complete = options.completeTool ?? ((callId, body) => options.session.completeTool?.(callId, body) ?? Promise.resolve());
    await complete(call.id, output);
    completed.push(call.id);
  }

  function rejectCall(call: ToolCallContent, reason: string, kind: "cancelled" | "unknown"): void {
    if (kind === "cancelled") cancelled.push(call.id);
    else unknown.push(call.id);
    void finishTool(call, {
      toolCallId: call.id,
      name: call.name,
      error: { name: "Error", message: reason, code: kind === "cancelled" ? "unknown_tool" : "unknown" },
    }).catch(() => undefined);
  }

  async function dispatch(call: ToolCallContent): Promise<void> {
    if (seen.has(call.id)) return;
    seen.add(call.id);
    if (pending.size >= HARD_REALTIME_PENDING_CALLS) {
      unknown.push(call.id);
      return;
    }
    if (call.authority === "provider-hosted") {
      if (options.strictGovernance) unknown.push(call.id);
      return;
    }
    if (allow && !allow.has(call.name)) {
      rejectCall(call, "unknown_tool", "cancelled");
      return;
    }
    if (interrupted || !consent) {
      cancelled.push(call.id);
      return;
    }
    const abort = new AbortController();
    pending.set(call.id, { abort, status: "queued" });
    try {
      if (abort.signal.aborted || interrupted) {
        cancelled.push(call.id);
        return;
      }
      const slot = pending.get(call.id);
      if (!slot) return;
      slot.status = "executing";
      const result = await options.execute(call, { signal: abort.signal });
      if (interrupted || abort.signal.aborted) {
        if (!result.error) effectAfterInterrupt = true;
        unknown.push(call.id);
        return;
      }
      await finishTool(call, result);
    } catch (error) {
      if (interrupted || abort.signal.aborted) {
        unknown.push(call.id);
        return;
      }
      await finishTool(call, {
        toolCallId: call.id,
        name: call.name,
        error: { name: "Error", message: error instanceof Error ? error.message : "tool failed" },
      });
    } finally {
      pending.delete(call.id);
    }
  }

  function abortPending(kind: "cancelled" | "unknown"): void {
    for (const [id, slot] of pending) {
      slot.abort.abort();
      if (slot.status === "queued") {
        if (kind === "cancelled") cancelled.push(id);
        else unknown.push(id);
        pending.delete(id);
      }
    }
  }

  async function handle(event: RealtimeEvent): Promise<void> {
    if (event.type === "audio_delta" && dropAudio) return;
    if (event.type === "interrupted") {
      interrupted = true;
      dropAudio = true;
      abortPending("cancelled");
    } else if (event.type === "tool_call") {
      void dispatch(event.call);
    } else if (event.type === "usage") {
      usage = event.usage;
      await options.recordUsage?.(event.usage);
    } else if (event.type === "transcript_delta" && options.retainTranscripts) {
      const text = event.text.length > maxTranscriptChars ? event.text.slice(0, maxTranscriptChars) : event.text;
      await options.onTranscript?.(text, event.role);
    }
    if (event.type !== "audio_delta" || !dropAudio) options.onEvent?.(event);
  }

  return {
    async sendAudio(chunk, sendOptions) {
      if (!consent) throw new RealtimeVoiceError("ERR_PRISM_REALTIME_CONSENT", "microphone consent revoked");
      assertDeviceAdmit(options.policy, options.admit);
      const accepted = acceptDeviceChunk(options.policy, chunk.byteLength);
      if (!accepted.accepted) return;
      dropAudio = false;
      interrupted = false;
      await options.session.sendAudio(chunk, sendOptions);
    },
    async interrupt(interruptOptions) {
      interrupted = true;
      dropAudio = true;
      abortPending("cancelled");
      await options.session.interrupt(interruptOptions);
    },
    async revokeConsent() {
      consent = false;
      interrupted = true;
      dropAudio = true;
      abortPending("cancelled");
      await options.session.close("consent_revoked");
    },
    run(signal) {
      if (running) return running;
      running = (async () => {
        const onAbort = () => {
          void options.session.close("aborted");
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          for await (const event of options.session.events()) {
            if (closed || signal?.aborted) break;
            await handle(event);
            if (event.type === "session_closed") break;
          }
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
        return snapshot();
      })();
      return running;
    },
    snapshot,
    async close(reason) {
      closed = true;
      abortPending("unknown");
      await options.session.close(reason);
    },
  };
}

function cap(name: string, value: number, hard: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > hard) {
    throw new RealtimeVoiceError("ERR_PRISM_REALTIME_LIMIT", `${name} must be a positive safe integer at most ${hard}`);
  }
  return value;
}

function toolOutput(result: ToolResult): string {
  const body = result.error
    ? JSON.stringify({ error: result.error.message ?? "error" })
    : JSON.stringify((result.value as JsonObject | undefined) ?? {});
  return Buffer.byteLength(body) > HARD_REALTIME_TOOL_OUTPUT_BYTES ? JSON.stringify({ error: "truncated" }) : body;
}
