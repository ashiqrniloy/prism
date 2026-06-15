import type { ErrorInfo } from "./contracts.js";

const REDACTED = "[REDACTED]";

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
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(error.message, secrets),
      cause: error.cause ? redactSecrets(String(error.cause), secrets) : undefined,
    };
  }

  return { message: redactSecrets(String(error), secrets) };
}
