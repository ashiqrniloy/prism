import type { ProviderFailureClass } from "@arnilo/prism";
import { providerHttpError } from "@arnilo/prism/provider-kit";
import { OpenAICodexReauthorizeError } from "./oauth.js";

/**
 * Codes a Sign in with ChatGPT response may carry in its body (plan 204 Task 1 research table).
 * Every one maps to a class the shared classifier would already give from the status, except the
 * two that need a different answer: a usage limit must name the plan settings, and an invalid user
 * needs a new sign-in.
 */
export const OPENAI_CODEX_ERROR_CLASSES: Readonly<Record<string, ProviderFailureClass>> = {
  subscription_sharing_usage_limit_exceeded: "quota",
  subscription_sharing_usage_unavailable: "transient",
  subscription_sharing_user_unavailable: "transient",
  subscription_sharing_user_not_eligible: "auth",
  subscription_sharing_unsupported_capability: "permanent",
  subscription_sharing_route_not_supported: "auth",
};

/** Bodies that mean the grant is gone, not that the request was wrong. */
const REAUTHORIZE_CODES = new Set(["subscription_sharing_invalid_user", "invalid_user"]);

/**
 * The usage limit is the one failure a person can act on, so its message says where: ChatGPT
 * Settings → Usage. The status and body stay in the message, and the class stays `quota` (never
 * retried, and the session stops rather than burning the allowance again).
 */
export const USAGE_LIMIT_NOTE = "ChatGPT plan usage limit reached; see ChatGPT Settings → Usage";

/**
 * Reads the provider code out of a failure body: `{"detail": "..."}` admission bodies carry it as
 * prose ending in the code, `{"error": {"code": ...}}` carries it as a field.
 */
export function openAICodexErrorCode(bodyText: string): string | undefined {
  const trimmed = bodyText.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : undefined;
      for (const value of [record.code, nested?.code, record.type, nested?.type]) {
        if (typeof value === "string" && value) return value;
      }
      for (const value of [record.detail, nested?.message, record.message]) {
        const match = typeof value === "string" ? /\b((?:subscription_sharing|chatpass_v2)_[a-z0-9_]+)\b/.exec(value) : null;
        if (match) return match[1];
      }
    }
  } catch {
    // A non-JSON body still carries the code in prose; fall through to the same extraction.
  }
  return /\b((?:subscription_sharing|chatpass_v2)_[a-z0-9_]+)\b/.exec(trimmed)?.[1];
}

/**
 * Builds the failure for a non-2xx Responses response. `providerHttpError` owns the class, the
 * redaction, and the numeric status code the retry policy reads; this only adds the two decisions
 * the status table cannot express.
 */
export function openAICodexHttpError(response: Response, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  const errorCode = openAICodexErrorCode(bodyText);
  if (errorCode && REAUTHORIZE_CODES.has(errorCode))
    return new OpenAICodexReauthorizeError(`openai-codex: the sign-in grant is no longer valid (${errorCode}); sign in with ChatGPT again`);
  const error = providerHttpError("openai-codex", { status: response.status, code: response.status, errorCode }, bodyText, secrets);
  const failureClass = (error as Error & { failureClass?: ProviderFailureClass }).failureClass;
  if (failureClass === "quota" && !error.message.includes(USAGE_LIMIT_NOTE)) error.message = `${error.message} (${USAGE_LIMIT_NOTE})`;
  return error;
}
