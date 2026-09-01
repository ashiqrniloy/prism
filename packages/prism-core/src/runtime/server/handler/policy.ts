/** policy (0.2.5 plan 025 Task 1 split). Moved verbatim from handler.ts; public surface unchanged behind the barrel. */
import { PrismServerError } from "../types.js";

export function assertRequestPolicy(request: Request, hosts?: readonly string[], origins?: readonly string[]): void {
  if (hosts) {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (!hosts.includes(host)) throw new PrismServerError("Forbidden host", 403, "ERR_PRISM_SERVER_HOST");
  }
  const origin = request.headers.get("origin");
  if (origin && origins && !origins.includes(origin)) throw new PrismServerError("Forbidden origin", 403, "ERR_PRISM_SERVER_ORIGIN");
}

export async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new PrismServerError("Request timed out or disconnected", 408, "ERR_PRISM_SERVER_ABORTED");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new PrismServerError("Request timed out or disconnected", 408, "ERR_PRISM_SERVER_ABORTED"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function ownedSignal(request: Request, timeoutMs: number, disconnectAborts: boolean) {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason ?? new Error("request disconnected"));
  if (disconnectAborts) {
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    dispose() {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    },
  };
}
