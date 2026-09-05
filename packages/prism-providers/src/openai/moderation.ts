/** OpenAI moderation adapter — plan 061 Task 6 (`POST /v1/moderations`).
 *
 * Category mapping is a data-driven table (plan acceptance criterion): raw
 * OpenAI category names map onto the provider-neutral vocabulary; any raw
 * category missing from the table passes through untouched so hosts never lose
 * provider signals. Scores/flagged booleans are provider output verbatim — no
 * local thresholds.
 */
import {
  assertModerationSupported,
  type JsonObject,
  type ModerationCategoryResult,
  ModerationError,
  type ModerationProvider,
  type ModerationRequest,
  type ModerationResult,
  modelSupportsModeration,
  redactSecrets,
  resolveCredentialValue,
} from "@arnilo/prism";
import { readBoundedResponseJson } from "@arnilo/prism/providers/transport";

export const OPENAI_MODERATION_DEFAULT_MODEL = "omni-moderation-latest";
/** Conservative input ceiling — OpenAI documents no hard prompt limit for moderation. */
export const OPENAI_MODERATION_INPUT_MAX_CHARS = 100_000;
/** Per-response JSON read bound for classification payloads. */
export const OPENAI_MODERATION_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface OpenAIModerationOptions {
  readonly id?: string;
  readonly apiKey?: Parameters<typeof resolveCredentialValue>[0];
  /** Explicit base URL; defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  /** Default classification model when the request omits one. */
  readonly model?: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Raw OpenAI category → provider-neutral key. Everything absent passes through. */
const NEUTRAL_CATEGORY_MAP: Readonly<Record<string, string>> = {
  harassment: "harassment",
  "harassment/threatening": "harassment/threatening",
  hate: "hate",
  "hate/threatening": "hate/threatening",
  illicit: "illicit",
  "illicit/violent": "illicit/violent",
  "self-harm": "self-harm",
  "self-harm/instructions": "self-harm/instructions",
  "self-harm/intent": "self-harm/intent",
  sexual: "sexual",
  "sexual/minors": "sexual/minors",
  violence: "violence",
  "violence/graphic": "violence/graphic",
};

function classifyEntry(
  entry: { flagged?: unknown; categories?: unknown; category_scores?: unknown },
  raw: object,
  model: string,
): ModerationResult {
  if (typeof entry.flagged !== "boolean" || entry.categories === null || typeof entry.categories !== "object") {
    throw new ModerationError("response_malformed", "OpenAI moderation response missing flagged/categories fields");
  }
  const rawJson = raw as unknown as JsonObject;
  const categories = entry.categories as Record<string, unknown>;
  const scores = (entry.category_scores ?? {}) as Record<string, unknown>;
  const mapped: Record<string, ModerationCategoryResult> = {};
  for (const [rawName, rawFlagged] of Object.entries(categories)) {
    if (typeof rawFlagged !== "boolean") continue;
    const score = scores[rawName];
    mapped[NEUTRAL_CATEGORY_MAP[rawName] ?? rawName] = {
      score: typeof score === "number" ? score : 0,
      flagged: rawFlagged,
    };
  }
  return {
    flagged: entry.flagged,
    categories: mapped,
    raw: rawJson,
    model,
  };
}

/** Create an OpenAI-compatible `ModerationProvider`. Credentials resolve per call
 *  and are redacted from every thrown error; scores are provider output — core
 *  applies no thresholds. */
export function createOpenAIModerationProvider(options: OpenAIModerationOptions): ModerationProvider {
  const id = options.id ?? "openai";
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const defaultModel = options.model ?? OPENAI_MODERATION_DEFAULT_MODEL;

  const headers: Record<string, string> = { "Content-Type": "application/json", ...options.headers };

  async function moderateOne(input: string, model: string, signal?: AbortSignal): Promise<ModerationResult> {
    if (input.length === 0) throw new ModerationError("empty_input", "moderation input must not be empty");
    if (input.length > OPENAI_MODERATION_INPUT_MAX_CHARS) {
      throw new ModerationError("input_too_large", `moderation input exceeds ${OPENAI_MODERATION_INPUT_MAX_CHARS} characters`);
    }
    const apiKey = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
    if (!apiKey) throw new ModerationError("request_failed", "OpenAI moderation requires an API key (apiKey option or credential source)");
    const requestHeaders = { ...headers, Authorization: `Bearer ${apiKey}` };
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/moderations`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ model, input }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ModerationError("request_failed", `OpenAI moderation request failed: ${redactSecrets(String(error), [apiKey])}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ModerationError(
        "request_failed",
        `OpenAI moderation request failed with status ${response.status}: ${redactSecrets(text || response.statusText, [apiKey])}`,
      );
    }
    let payload: Record<string, unknown>;
    try {
      payload = (await readBoundedResponseJson(response, { maxResponseBodyBytes: OPENAI_MODERATION_MAX_RESPONSE_BYTES })) as Record<
        string,
        unknown
      >;
    } catch (error) {
      if (error instanceof ModerationError) throw error;
      throw new ModerationError(
        "response_malformed",
        `OpenAI moderation response was not valid JSON: ${redactSecrets(String(error), [apiKey])}`,
      );
    }
    const results = payload.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new ModerationError("response_malformed", "OpenAI moderation response missing results array");
    }
    return classifyEntry(results[0] as never, payload, model);
  }

  return {
    id,
    async moderate(request: ModerationRequest) {
      const model = request.model ?? defaultModel;
      if (typeof request.input === "string") return moderateOne(request.input, model, request.signal);
      const results: ModerationResult[] = [];
      for (const input of request.input) {
        results.push(await moderateOne(input, model, request.signal));
      }
      return results;
    },
  } as ModerationProvider;
}

/** Capability guard re-export for parity with the other OpenAI adapters. */
export { assertModerationSupported, modelSupportsModeration };
