import { bounded, resolveA2ALimits } from "./a2a-parts.js";
import { A2AError } from "./errors.js";
import type { A2ALimits, A2APushConfig, A2ATaskEvent } from "./a2a-types.js";

export interface A2APushDelivery {
  deliver(input: { readonly config: A2APushConfig; readonly event: A2ATaskEvent; readonly idempotencyKey: string; readonly attempt: number; readonly signal: AbortSignal }): Promise<void>;
}
export interface DeliverA2APushEventOptions {
  readonly signal?: AbortSignal;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly limits?: A2ALimits;
}

/** Explicit host call; stores no timer/config/event and performs no network I/O itself. */
export async function deliverA2APushEvent(delivery: A2APushDelivery, config: A2APushConfig, event: A2ATaskEvent, options: DeliverA2APushEventOptions = {}): Promise<{ readonly attempts: number }> {
  const limits = resolveA2ALimits(options.limits);
  const maxAttempts = options.maxAttempts ?? 1, timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new A2AError("Invalid A2A push delivery limits", 400, "ERR_PRISM_A2A_CONFIG");
  bounded(event, limits.maxEventBytes, "A2A push event");
  if (!event.eventId || Buffer.byteLength(event.eventId) > limits.maxCursorBytes) throw new A2AError("Invalid A2A push event id", 400, "ERR_PRISM_A2A_PUSH");
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("A2A push delivery timed out", "AbortError")), timeoutMs);
    try { controller.signal.throwIfAborted(); await Promise.race([delivery.deliver({ config, event, idempotencyKey: event.eventId, attempt, signal: controller.signal }), new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }))]); return { attempts: attempt }; }
    catch (error) { last = error; if (controller.signal.aborted || attempt === maxAttempts) break; }
    finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
  }
  throw new A2AError(last instanceof DOMException && last.name === "AbortError" ? "A2A push delivery timed out" : "A2A push delivery failed", 502, "ERR_PRISM_A2A_PUSH");
}
