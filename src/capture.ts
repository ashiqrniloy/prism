/** Provider request/response capture middleware (plan 062, review §7 P1):
 *  opt-in observation of already-normalized provider shapes — never raw HTTP.
 *
 *  Request side rides the existing `provider_request` middleware hook; response
 *  side rides the existing subscriber-event seam (`provider_turn_finished`,
 *  which core already redacts). No new seam. Captured entries land in a capped
 *  FIFO ring buffer (`maxEvents`, default 100).
 *
 *  Privacy policy `redact` controls content retention:
 *  - `"all"`: structure only — model id, counts, tool names, usage, latency.
 *  - `"secrets"` (default): also drops message content (the privacy default:
 *    captured buffers carry no conversation text unless the host opts in).
 *  - `"none"`: retains message content for replay debugging.
 *  Secret redaction is unconditional in every mode (replay-safe by
 *  construction): retained material passes through the same `redactSecrets`
 *  helper the logging seams use, so credentials never survive into a buffer
 *  that a host might persist or replay. Provider request/response options and
 *  headers are never captured at all — headers are where credentials ride.
 */
import type { AgentEvent, ProviderRequest } from "./contracts.js";
import type { Middleware } from "./middleware.js";
import { resolveRedactor, type SecretRedactor } from "./redaction.js";

export type CaptureRedaction = "secrets" | "all" | "none";

export interface ProviderCapturePolicy {
  /** Content-retention level; `"secrets"` (default) drops message content. */
  readonly redact?: CaptureRedaction;
  /** Ring-buffer capacity; oldest entries evict first. Default 100. */
  readonly maxEvents?: number;
}

export interface ProviderCaptureOptions {
  readonly policy?: ProviderCapturePolicy;
  /** Secrets redacted from every retained field, matching the logging seams. */
  readonly secrets?: readonly (string | undefined)[];
  readonly redactor?: SecretRedactor;
  readonly now?: () => number;
}

export interface ProviderCaptureEntry {
  readonly kind: "request" | "response";
  readonly at: string;
  readonly redaction: CaptureRedaction;
  readonly provider?: string;
  readonly model?: string;
  readonly messageCount?: number;
  readonly toolNames?: readonly string[];
  /** Message content — present only when the policy retains it (`"none"`), secrets redacted. */
  readonly content?: unknown;
  /** Response entries: normalized usage numbers (never sensitive). */
  readonly usage?: unknown;
  readonly latencyMs?: number;
  readonly error?: unknown;
}

export interface ProviderCapture {
  /** Register on the existing `provider_request` middleware hook. Passes the
   *  request through untouched and records one entry per round. */
  middleware(): Middleware<ProviderRequest>;
  /** Feed `provider_turn_finished` events from the session's existing
   *  subscriber loop (`session.subscribe()`) to record response entries. */
  observeEvent(event: AgentEvent): void;
  /** Ring-buffer snapshot, oldest first. */
  events(): readonly ProviderCaptureEntry[];
  clear(): void;
}

const DEFAULT_MAX_EVENTS = 100;
const HARD_MAX_EVENTS_CAP = 10_000;

function resolveMaxEvents(maxEvents: number | undefined): number {
  const value = maxEvents ?? DEFAULT_MAX_EVENTS;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("maxEvents must be a positive integer");
  return Math.min(value, HARD_MAX_EVENTS_CAP);
}

export function createProviderCapture(options: ProviderCaptureOptions = {}): ProviderCapture {
  const redaction = options.policy?.redact ?? "secrets";
  const maxEvents = resolveMaxEvents(options.policy?.maxEvents);
  const now = options.now ?? Date.now;
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const buffer: ProviderCaptureEntry[] = [];

  const record = (entry: ProviderCaptureEntry): void => {
    buffer.push(entry);
    if (buffer.length > maxEvents) buffer.splice(0, buffer.length - maxEvents);
  };

  return {
    middleware() {
      return (request, next) => {
        const entry: ProviderCaptureEntry = {
          kind: "request",
          at: new Date(now()).toISOString(),
          redaction,
          provider: request.model.provider,
          model: request.model.model,
          messageCount: request.messages.length,
          toolNames: request.tools?.map((tool) => tool.name),
          ...(redaction === "none" && request.messages.length > 0
            ? { content: redactor ? redactor.redact(request.messages) : request.messages }
            : {}),
        };
        record(entry);
        return next(request);
      };
    },
    observeEvent(event) {
      if (event.type !== "provider_turn_finished") return;
      const metadata = (event.metadata ?? {}) as { readonly providerId?: unknown; readonly model?: unknown; readonly latencyMs?: unknown };
      record({
        kind: "response",
        at: new Date(now()).toISOString(),
        redaction,
        provider: typeof metadata.providerId === "string" ? metadata.providerId : undefined,
        model:
          typeof (metadata.model as { model?: unknown } | null | undefined)?.model === "string"
            ? (metadata.model as { model: string }).model
            : undefined,
        usage: event.usage,
        latencyMs: typeof metadata.latencyMs === "number" ? metadata.latencyMs : undefined,
        // Core already redacts emitted errors; redact again so replay safety holds even
        // when a host feeds events captured before redaction.
        error: event.error && redactor ? redactor.redact(event.error) : event.error,
      });
    },
    events() {
      return [...buffer];
    },
    clear() {
      buffer.length = 0;
    },
  };
}
