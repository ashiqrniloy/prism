import type { SecretRedactor } from "@arnilo/prism";
import { AntigravityAuthenticationError, AntigravityQuotaExhaustedError, AntigravityRunnerError } from "./types.js";

const AUTH_REQUIRED_PATTERNS = [
  /authentication required/i,
  /please run agy login/i,
  /not authenticated/i,
  /login required/i,
  /no valid credentials/i,
  /unauthenticated/i,
  /oauth credentials not found/i,
  /auth token missing/i,
];

const QUOTA_EXHAUSTED_PATTERNS = [
  /quota exceeded/i,
  /quota exhausted/i,
  /rate limit/i,
  /resource exhausted/i,
  /too many requests/i,
  /429/i,
];

const INVALID_MODEL_PATTERNS = [/unknown model/i, /invalid model/i, /model not found/i, /model not supported/i];

const UNSUPPORTED_OPTION_PATTERNS = [/unknown option/i, /unrecognized option/i, /invalid option/i, /unsupported option/i];

export function isAuthenticationErrorText(text: string): boolean {
  if (!text) return false;
  return AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(text));
}

export function isQuotaExhaustedErrorText(text: string): boolean {
  if (!text) return false;
  return QUOTA_EXHAUSTED_PATTERNS.some((pattern) => pattern.test(text));
}

export function isInvalidModelErrorText(text: string): boolean {
  if (!text) return false;
  return INVALID_MODEL_PATTERNS.some((pattern) => pattern.test(text));
}

export function isUnsupportedCliOptionText(text: string): boolean {
  if (!text) return false;
  return UNSUPPORTED_OPTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function redactDiagnosticText(text: string, redactor?: SecretRedactor): string {
  if (!text) return "";
  if (!redactor) return text;
  return redactor.redact(text);
}

export interface DiagnoseCliErrorOptions {
  exitCode: number | null;
  stderr: string;
  stdout?: string;
  resultError?: unknown;
  redactor?: SecretRedactor;
}

export function diagnoseCliError(options: DiagnoseCliErrorOptions): Error {
  const rawStderr = options.stderr ?? "";
  const rawStdout = options.stdout ?? "";
  const resultErrorStr = options.resultError ? String(options.resultError) : "";

  const combined = `${rawStderr}\n${rawStdout}\n${resultErrorStr}`;
  const redactedStderr = redactDiagnosticText(rawStderr, options.redactor);

  if (isAuthenticationErrorText(combined)) {
    return new AntigravityAuthenticationError(
      "Antigravity authentication required: run interactive 'agy' once to authenticate with your Google account. Prism never handles or copies Antigravity credentials.",
    );
  }

  if (isQuotaExhaustedErrorText(combined)) {
    return new AntigravityQuotaExhaustedError(
      `Antigravity quota exhausted or rate-limited: ${redactedStderr.slice(0, 300) || "Rate limit reached"}`,
    );
  }

  if (isInvalidModelErrorText(combined)) {
    return new AntigravityRunnerError(`Invalid or unsupported Antigravity model: ${redactedStderr.slice(0, 300)}`, {
      code: "ERR_PRISM_ANTIGRAVITY_MODEL_ERROR",
      exitCode: options.exitCode,
      stderr: redactedStderr,
    });
  }

  if (isUnsupportedCliOptionText(combined)) {
    return new AntigravityRunnerError(`Antigravity CLI unsupported option or version incompatibility: ${redactedStderr.slice(0, 300)}`, {
      code: "ERR_PRISM_ANTIGRAVITY_VERSION_UNSUPPORTED",
      exitCode: options.exitCode,
      stderr: redactedStderr,
    });
  }

  const message =
    redactedStderr.trim().slice(0, 500) ||
    resultErrorStr ||
    (options.exitCode !== null ? `Antigravity CLI exited with code ${options.exitCode}` : "Antigravity CLI failed");

  return new AntigravityRunnerError(message, {
    code: "ERR_PRISM_ANTIGRAVITY_RUNNER",
    exitCode: options.exitCode,
    stderr: redactedStderr,
  });
}
