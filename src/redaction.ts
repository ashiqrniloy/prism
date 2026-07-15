import type { AgentEvent, ErrorInfo, Message, ProviderRequest, RunLedgerRecord, SessionEntry } from "./contracts.js";

const REDACTED = "[REDACTED]";

export interface SecretRedactor {
  redact<T>(value: T): T;
}

export function createSecretRedactor(secrets: readonly (string | undefined)[]): SecretRedactor {
  return { redact: (value) => redactSecrets(value, secrets) };
}

export function redactMessage(message: Message, redactor?: SecretRedactor): Message {
  return redactor?.redact(message) ?? message;
}

export function redactAgentEvent(event: AgentEvent, redactor?: SecretRedactor): AgentEvent {
  return redactor?.redact(event) ?? event;
}

export function redactSessionEntry(entry: SessionEntry, redactor?: SecretRedactor): SessionEntry {
  return redactor?.redact(entry) ?? entry;
}

export function redactProviderRequest(request: ProviderRequest, redactor?: SecretRedactor): ProviderRequest {
  return redactor?.redact(request) ?? request;
}

export function redactRunLedgerRecord<T extends RunLedgerRecord>(record: T, redactor?: SecretRedactor): T {
  return redactor?.redact(record) ?? record;
}

export function redactSecrets<T>(value: T, secrets: readonly (string | undefined)[]): T {
  const needles = secrets.filter((secret): secret is string => Boolean(secret));
  if (needles.length === 0) return value;

  const redactString = (text: string) =>
    needles.reduce((current, secret) => current.split(secret).join(REDACTED), text);

  const redactKey = (key: unknown): string => {
    if (typeof key === "string") return redactString(key);
    return String(key);
  };

  const assignKey = (target: Record<string, unknown>, key: string, value: unknown): void => {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = value;
      return;
    }
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(target, `${key}__${suffix}`)) suffix += 1;
    target[`${key}__${suffix}`] = value;
  };

  // ponytail: active-path WeakSet marks only ancestor cycles as [Circular]; shared
  // references (diamonds) are visited again on separate branches. Map/Set normalize
  // to JSON-shaped output; string keys are redacted like values.
  const redact = (input: unknown, active: WeakSet<object> = new WeakSet()): unknown => {
    if (typeof input === "string") return redactString(input);
    if (input === null || typeof input !== "object") return input;
    if (input instanceof Date || input instanceof RegExp) return input;
    if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return input;
    if (active.has(input)) return "[Circular]";
    active.add(input);
    try {
      if (Array.isArray(input)) return input.map((item) => redact(item, active));
      if (input instanceof Map) {
        const out: Record<string, unknown> = {};
        for (const [key, item] of input) assignKey(out, redactKey(key), redact(item, active));
        return out;
      }
      if (input instanceof Set) return [...input].map((item) => redact(item, active));
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) assignKey(out, redactKey(key), redact(item, active));
      return out;
    } finally {
      active.delete(input);
    }
  };

  return redact(value) as T;
}

export function errorToErrorInfo(error: unknown, secrets: readonly (string | undefined)[] = []): ErrorInfo {
  const code = readErrorCode(error);
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(error.message, secrets),
      code,
      cause: error.cause ? redactSecrets(String(error.cause), secrets) : undefined,
    };
  }
  if (error && typeof error === "object" && "message" in error) {
    return { message: redactSecrets(String((error as { message: unknown }).message), secrets), code };
  }

  return { message: redactSecrets(String(error), secrets), code };
}

function readErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}
