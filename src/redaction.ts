import type { AgentEvent, ErrorInfo, Message, ProviderRequest, RunLedgerRecord, SessionEntry } from "./contracts.js";
import type { FieldPolicy } from "./field-policy.js";
import { applyFieldPolicy } from "./field-policy.js";

const REDACTED = "[REDACTED]";
// Depth bound matching agent-run-state.ts; hostile deep structures yield a placeholder
// instead of a stack overflow.
const MAX_REDACT_DEPTH = 32;
// Plan 070 Task 9: single-pass fast path. One left-to-right alternation replaces every
// occurrence of every needle in a single scan, instead of one split/join pass per needle.
// It is only equivalent to the ordered reduce below when no needle occurrence can overlap
// another needle's occurrence or a produced placeholder, so `singlePassMatcher` returns
// null for such sets and the loop stays authoritative. Below this length the set check
// costs more than the passes it saves (measured crossover ~4 KB, so the fast path only
// engages with a wide margin).
const SINGLE_PASS_MIN_CHARS = 16 * 1024;
// ponytail: bound the fast path to this needle count. The set check is O(k²) and the
// alternation compile grows with k, so the loop is no slower beyond it. Raise if a host
// redacts with much larger secret sets.
const SINGLE_PASS_MAX_NEEDLES = 32;

export interface SecretRedactor {
  redact<T>(value: T): T;
}

export function createSecretRedactor(secrets: readonly (string | undefined)[]): SecretRedactor {
  return { redact: (value) => redactSecrets(value, secrets) };
}

/** Applies a field policy after secret redaction; identity when absent (compat). */
function afterSecrets<T>(
  value: T,
  redactor: SecretRedactor | undefined,
  policy: FieldPolicy | undefined,
  destination: string,
  labelFor: ((key: string, path: string) => string | undefined) | undefined,
): T {
  const secretRedacted = redactor?.redact(value) ?? value;
  return policy
    ? applyFieldPolicy(secretRedacted, policy, { destination, direction: "outbound", ...(labelFor ? { labelFor } : {}) })
    : secretRedacted;
}

export function redactMessage(
  message: Message,
  redactor?: SecretRedactor,
  fieldPolicy?: FieldPolicy,
  destination = "prompt",
  labelFor?: (key: string, path: string) => string | undefined,
): Message {
  return afterSecrets(message, redactor, fieldPolicy, destination, labelFor);
}

export function redactAgentEvent(
  event: AgentEvent,
  redactor?: SecretRedactor,
  fieldPolicy?: FieldPolicy,
  destination = "telemetry",
  labelFor?: (key: string, path: string) => string | undefined,
): AgentEvent {
  return afterSecrets(event, redactor, fieldPolicy, destination, labelFor);
}

export function redactSessionEntry(
  entry: SessionEntry,
  redactor?: SecretRedactor,
  fieldPolicy?: FieldPolicy,
  destination = "persistence",
  labelFor?: (key: string, path: string) => string | undefined,
): SessionEntry {
  return afterSecrets(entry, redactor, fieldPolicy, destination, labelFor);
}

export function redactProviderRequest(
  request: ProviderRequest,
  redactor?: SecretRedactor,
  fieldPolicy?: FieldPolicy,
  destination = "prompt",
  labelFor?: (key: string, path: string) => string | undefined,
): ProviderRequest {
  return afterSecrets(request, redactor, fieldPolicy, destination, labelFor);
}

export function redactRunLedgerRecord<T extends RunLedgerRecord>(
  record: T,
  redactor?: SecretRedactor,
  fieldPolicy?: FieldPolicy,
  destination = "run-ledger",
  labelFor?: (key: string, path: string) => string | undefined,
): T {
  return afterSecrets(record, redactor, fieldPolicy, destination, labelFor);
}

export function resolveRedactor(redactor?: SecretRedactor, secrets?: readonly (string | undefined)[]): SecretRedactor | undefined {
  return redactor ?? (secrets?.some((secret) => Boolean(secret)) ? createSecretRedactor(secrets) : undefined);
}

export function redactSecrets<T>(value: T, secrets: readonly (string | undefined)[]): T {
  const needles = secrets.filter((secret): secret is string => Boolean(secret));
  if (needles.length === 0) return value;

  // Decided lazily on the first large string, and only once per call: a redaction of many
  // small strings never pays the set check and never regresses against the loop.
  let singlePass: RegExp | null | undefined;
  const redactString = (text: string) => {
    if (text.length >= SINGLE_PASS_MIN_CHARS) {
      if (singlePass === undefined) singlePass = singlePassMatcher(needles);
      if (singlePass) return text.replace(singlePass, REDACTED);
    }
    return needles.reduce((current, secret) => current.split(secret).join(REDACTED), text);
  };

  const redactKey = (key: unknown): string => {
    if (typeof key === "string") return redactString(key);
    return String(key);
  };

  const assignKey = (target: Record<string, unknown>, key: string, value: unknown): void => {
    if (!Object.hasOwn(target, key)) {
      target[key] = value;
      return;
    }
    let suffix = 2;
    while (Object.hasOwn(target, `${key}__${suffix}`)) suffix += 1;
    target[`${key}__${suffix}`] = value;
  };

  // ponytail: active-path WeakSet marks only ancestor cycles as [Circular]; shared
  // references (diamonds) are visited again on separate branches. Map/Set normalize
  // to JSON-shaped output; string keys are redacted like values.
  const redact = (input: unknown, active: WeakSet<object> = new WeakSet(), depth = 0): unknown => {
    if (typeof input === "string") return redactString(input);
    if (input === null || typeof input !== "object") return input;
    if (depth >= MAX_REDACT_DEPTH) return "[MaxDepth]";
    if (input instanceof Date || input instanceof RegExp) return input;
    if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return input;
    if (active.has(input)) return "[Circular]";
    active.add(input);
    try {
      if (Array.isArray(input)) return input.map((item) => redact(item, active, depth + 1));
      if (input instanceof Map) {
        const out: Record<string, unknown> = {};
        for (const [key, item] of input) assignKey(out, redactKey(key), redact(item, active, depth + 1));
        return out;
      }
      if (input instanceof Set) return [...input].map((item) => redact(item, active, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) assignKey(out, redactKey(key), redact(item, active, depth + 1));
      return out;
    } finally {
      active.delete(input);
    }
  };

  return redact(value) as T;
}

function escapeRegExpLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compiled single-pass matcher for `needles`, or null when the set is not provably
 * equivalent to the ordered reduce/split/join in `redactSecrets`. Equivalence holds when
 * no needle occurrence can overlap another needle's occurrence (overlap would make the
 * result depend on which needle is mentioned first rather than on position) and no needle
 * can occur inside or across the edges of a produced "[REDACTED]" placeholder (a later
 * pass would then redact text the single scan never sees). Both checks are conservative:
 * a false negative only costs the fast path.
 */
function singlePassMatcher(needles: readonly string[]): RegExp | null {
  if (needles.length < 2 || needles.length > SINGLE_PASS_MAX_NEEDLES) return null;
  for (const needle of needles) {
    if (needleTouchesPlaceholder(needle)) return null;
  }
  for (const left of needles) {
    for (const right of needles) {
      if (left !== right && needlesOverlap(left, right)) return null;
    }
  }
  return new RegExp(needles.map(escapeRegExpLiteral).join("|"), "g");
}

/** A placeholder-relative occurrence: needle inside "[REDACTED]", or a needle prefix equal
 * to a placeholder suffix / needle suffix equal to a placeholder prefix (a match spanning
 * the placeholder's edge that the ordered passes would create). */
function needleTouchesPlaceholder(needle: string): boolean {
  if (REDACTED.includes(needle)) return true;
  for (let n = 1; n < needle.length; n += 1) {
    if (REDACTED.endsWith(needle.slice(0, n)) || REDACTED.startsWith(needle.slice(n))) return true;
  }
  return false;
}

/** One occurrence of `left` overlapping one of `right`: containment either way, or a proper
 * suffix of `left` equal to a proper prefix of `right` (callers check both directions). */
function needlesOverlap(left: string, right: string): boolean {
  if (right.includes(left)) return true;
  for (let n = 1; n < left.length && n < right.length; n += 1) {
    if (right.startsWith(left.slice(left.length - n))) return true;
  }
  return false;
}

export function errorToErrorInfo(error: unknown, secrets: readonly (string | undefined)[] = []): ErrorInfo {
  const code = readErrorCode(error);
  const retry = readRetryAfterMs(error);
  const retryAfter = retry !== undefined ? { retryAfterMs: retry } : {};
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(error.message, secrets),
      code,
      ...retryAfter,
      cause: error.cause ? redactSecrets(String(error.cause), secrets) : undefined,
    };
  }
  if (error && typeof error === "object" && "message" in error) {
    return { message: redactSecrets(String((error as { message: unknown }).message), secrets), code, ...retryAfter };
  }

  return { message: redactSecrets(String(error), secrets), code, ...retryAfter };
}

function readErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function readRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("retryAfterMs" in error)) return undefined;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
