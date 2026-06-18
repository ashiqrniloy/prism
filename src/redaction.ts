import type { AgentEvent, ErrorInfo, Message, ProviderRequest, SessionEntry } from "./contracts.js";

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

export function redactSecrets<T>(value: T, secrets: readonly (string | undefined)[]): T {
  const needles = secrets.filter((secret): secret is string => Boolean(secret));
  if (needles.length === 0) return value;

  const redactString = (text: string) =>
    needles.reduce((current, secret) => current.split(secret).join(REDACTED), text);

  const redact = (input: unknown): unknown => {
    if (typeof input === "string") return redactString(input);
    if (Array.isArray(input)) return input.map(redact);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, redact(item)]));
    }
    return input;
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
