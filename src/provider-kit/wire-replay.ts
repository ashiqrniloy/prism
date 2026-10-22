import type { ModelProvider, ProviderEvent, ProviderRequest, Usage } from "../contracts.js";
import { assertProviderStreamConforms } from "./conformance.js";

/**
 * A single HTTP exchange recorded from a provider endpoint.
 *
 * Captures request details, response status, content type, and raw response body.
 * Secret-bearing headers like Authorization and other transport headers are excluded.
 */
export interface RecordedExchange {
  readonly method?: string;
  readonly path: string;
  readonly requestBody?: unknown;
  readonly status?: number;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly responseBody: string;
}

/**
 * Options for stream conformance testing against recorded wire fixtures.
 */
export interface RecordedStreamConformanceOptions {
  readonly provider: ModelProvider;
  readonly request: ProviderRequest;
  readonly recording: RecordedExchange | readonly RecordedExchange[];
  readonly expect?: {
    readonly text?: string;
    readonly usage?: Usage;
  };
}

/**
 * Creates a fetch implementation that replays recorded exchanges in order.
 * Fails fast if the request path or method diverges from the recording.
 */
export function replayFetch(
  exchanges: RecordedExchange | readonly RecordedExchange[],
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const list = Array.isArray(exchanges) ? [...exchanges] : [exchanges];
  let cursor = 0;

  return async function replay(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const exchange = list[cursor++];
    if (!exchange) {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      throw new Error(`replayFetch: no more recorded exchanges (call #${cursor} to ${target})`);
    }

    const url =
      typeof input === "string"
        ? new URL(input, "http://127.0.0.1")
        : input instanceof URL
          ? input
          : new URL(input.url, "http://127.0.0.1");

    const actualPath = url.pathname + (url.search || "");
    const expectedPath = exchange.path;

    if (expectedPath && actualPath !== expectedPath && url.pathname !== expectedPath) {
      throw new Error(`replayFetch: unexpected path: expected ${expectedPath}, got ${actualPath}`);
    }

    const method = init?.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET");
    if (exchange.method && method && exchange.method.toUpperCase() !== method.toUpperCase()) {
      throw new Error(`replayFetch: unexpected method: expected ${exchange.method}, got ${method}`);
    }

    if (init?.signal?.aborted) {
      throw init.signal.reason ?? new Error("aborted");
    }

    const status = exchange.status ?? 200;
    const contentType =
      exchange.contentType ??
      exchange.headers?.["content-type"] ??
      (typeof exchange.responseBody === "string" && exchange.responseBody.startsWith("data:")
        ? "text/event-stream"
        : "application/json");

    const responseHeaders = new Headers();
    responseHeaders.set("content-type", contentType);

    const bodyText = typeof exchange.responseBody === "string" ? exchange.responseBody : JSON.stringify(exchange.responseBody ?? "");

    return new Response(bodyText, {
      status,
      headers: responseHeaders,
    });
  };
}

/**
 * Asserts that a provider stream replaying recorded fixtures conforms to the provider protocol.
 * Verifies terminal event ordering, expected text, and usage accounting against the recorded exchange.
 */
export async function assertRecordedStreamConforms(
  options: RecordedStreamConformanceOptions,
): Promise<readonly ProviderEvent[]> {
  const recording = Array.isArray(options.recording) ? options.recording[0] : options.recording;
  const events = await assertProviderStreamConforms({
    provider: options.provider,
    request: options.request,
    expect: options.expect,
  });

  if (recording && recording.status !== undefined && recording.status >= 400) {
    const terminal = events.at(-1);
    if (!terminal || terminal.type !== "error") {
      throw new Error(`Provider stream expected to end with error event for recorded status ${recording.status}`);
    }
  }

  return events;
}
