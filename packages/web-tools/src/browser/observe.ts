/**
 * Bounded console + network observation ring (0.1.4, plan 016 Task 4).
 * CDP Runtime/Network events are recorded per page into bounded rings with
 * drain-on-read semantics. Bodies, cookies, and auth headers are NEVER captured.
 */
import type { CdpConsoleEntry, CdpNetworkEntry, PlaywrightCdpSession } from "./types.js";

export interface ObservationRing {
  recordConsole(entry: CdpConsoleEntry): void;
  recordNetwork(entry: CdpNetworkEntry): void;
  /** Return entries since the previous drain and clear; truncated reflects eviction. */
  drain(): { console: readonly CdpConsoleEntry[]; network: readonly CdpNetworkEntry[]; truncated: boolean };
}

export function createObservationRing(options: { maxConsoleEntries: number; maxNetworkRequests: number }): ObservationRing {
  const consoleEntries: CdpConsoleEntry[] = [];
  const networkEntries: CdpNetworkEntry[] = [];
  let consoleSeq = 0;
  let networkSeq = 0;
  let truncated = false;

  function push<T>(list: T[], entry: T, cap: number): void {
    list.push(entry);
    if (list.length > cap) {
      list.shift();
      truncated = true;
    }
  }

  return {
    recordConsole(entry) {
      consoleSeq += 1;
      push(consoleEntries, { ...entry, seq: consoleSeq }, options.maxConsoleEntries);
    },
    recordNetwork(entry) {
      networkSeq += 1;
      push(networkEntries, { ...entry, seq: networkSeq }, options.maxNetworkRequests);
    },
    drain() {
      const out = {
        console: consoleEntries.splice(0),
        network: networkEntries.splice(0),
        truncated,
      };
      truncated = false;
      return out;
    },
  };
}

const MAX_URL_BYTES = 2_048;
const MAX_ERROR_TEXT_BYTES = 512;
const MAX_METHOD_BYTES = 32;
const MAX_ARG_PREVIEW_BYTES = 512;
const MAX_ARGS = 4;

export type CdpConsoleType = CdpConsoleEntry["type"];

/** CDP console API types that map 1:1; the rest collapse to "other". */
const CONSOLE_TYPES = new Set<string>(["log", "error", "warning", "info", "debug", "assert", "exception"]);

function consoleTypeOf(raw: unknown): CdpConsoleType {
  if (typeof raw !== "string") return "other";
  if (raw === "warning") return "warning";
  if (CONSOLE_TYPES.has(raw)) return raw as CdpConsoleType;
  return "other";
}

function previewOf(object: {
  readonly type?: string;
  readonly subtype?: string;
  readonly value?: unknown;
  readonly description?: string;
}): string {
  let text: string;
  if (object.value !== undefined) {
    try {
      text = JSON.stringify(object.value);
    } catch {
      text = String(object.value);
    }
  } else if (typeof object.description === "string" && object.description.length > 0) {
    text = object.description;
  } else {
    text = object.type ?? "object";
  }
  return truncateUtf8(text, MAX_ARG_PREVIEW_BYTES);
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return text;
  return `${buf.subarray(0, maxBytes).toString("utf8")}…`;
}

function truncateText(text: string | undefined, maxBytes: number): string | undefined {
  if (text === undefined) return undefined;
  return truncateUtf8(text, maxBytes);
}

/**
 * Install CDP Runtime/Network observation handlers on a page session.
 * Returns the unsubscribe function. Event params are treated as untrusted.
 */
export function installCdpObservation(session: PlaywrightCdpSession, ring: ObservationRing): () => void {
  const onConsole = (params: Record<string, unknown>) => {
    const type = consoleTypeOf(params.type);
    const args = Array.isArray(params.args) ? (params.args as Array<Record<string, unknown>>).slice(0, MAX_ARGS).map(previewOf) : [];
    ring.recordConsole({ seq: 0, type, args });
  };
  const onException = (params: Record<string, unknown>) => {
    const details = params.exceptionDetails as Record<string, unknown> | undefined;
    const exception = details?.exception as Record<string, unknown> | undefined;
    const description = truncateText(
      typeof exception?.description === "string" && exception.description.length > 0
        ? exception.description
        : typeof details?.text === "string"
          ? details.text
          : undefined,
      MAX_ARG_PREVIEW_BYTES,
    );
    const url = truncateText(typeof details?.url === "string" ? details.url : undefined, MAX_URL_BYTES);
    ring.recordConsole({
      seq: 0,
      type: "exception",
      args: description !== undefined ? [description] : [],
      ...(url !== undefined ? { text: url } : {}),
    });
  };
  const onRequest = (params: Record<string, unknown>) => {
    const request = params.request as Record<string, unknown> | undefined;
    const url = truncateText(typeof request?.url === "string" ? request.url : undefined, MAX_URL_BYTES) ?? "";
    const method = truncateText(typeof request?.method === "string" ? request.method : undefined, MAX_METHOD_BYTES);
    ring.recordNetwork({
      seq: 0,
      phase: "request",
      requestId: typeof params.requestId === "string" ? params.requestId.slice(0, 128) : "",
      url,
      ...(method !== undefined ? { method } : {}),
    });
  };
  const onResponse = (params: Record<string, unknown>) => {
    const response = params.response as Record<string, unknown> | undefined;
    const url = truncateText(typeof response?.url === "string" ? response.url : undefined, MAX_URL_BYTES) ?? "";
    ring.recordNetwork({
      seq: 0,
      phase: "response",
      requestId: typeof params.requestId === "string" ? params.requestId.slice(0, 128) : "",
      url,
      ...(typeof response?.status === "number" ? { status: response.status } : {}),
    });
  };
  const onFailed = (params: Record<string, unknown>) => {
    ring.recordNetwork({
      seq: 0,
      phase: "failed",
      requestId: typeof params.requestId === "string" ? params.requestId.slice(0, 128) : "",
      url: "",
      ...(truncateText(typeof params.errorText === "string" ? params.errorText : undefined, MAX_ERROR_TEXT_BYTES)
        ? { errorText: truncateText(typeof params.errorText === "string" ? params.errorText : undefined, MAX_ERROR_TEXT_BYTES) }
        : {}),
    });
  };

  session.on("Runtime.consoleAPICalled", onConsole);
  session.on("Runtime.exceptionThrown", onException);
  session.on("Network.requestWillBeSent", onRequest);
  session.on("Network.responseReceived", onResponse);
  session.on("Network.loadingFailed", onFailed);

  return () => {
    session.off?.("Runtime.consoleAPICalled", onConsole);
    session.off?.("Runtime.exceptionThrown", onException);
    session.off?.("Network.requestWillBeSent", onRequest);
    session.off?.("Network.responseReceived", onResponse);
    session.off?.("Network.loadingFailed", onFailed);
  };
}
