/** Provider-neutral moderation classification contract (plan 061 Task 6).
 *
 * Scores and flagged booleans are provider output — core bakes in no policy:
 * thresholds, blocking, and routing stay host-owned (see docs/host-security.md).
 * Category keys use the provider-neutral vocabulary below; raw provider
 * categories that have no neutral mapping pass through untouched.
 */
import type { JsonObject, ModelCapabilities, ModelConfig } from "./content.js";

/** Provider-neutral category vocabulary (canonical names; adapters map their raw
 *  categories onto these — unknown raw categories pass through as-is). */
export const MODERATION_CATEGORIES = [
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/instructions",
  "self-harm/intent",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic",
] as const;

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export type ModerationErrorCode =
  | "empty_input"
  | "input_too_large"
  | "unsupported_model"
  | "request_failed"
  | "response_malformed"
  | "unsupported_operation";

export class ModerationError extends Error {
  readonly code: ModerationErrorCode;

  constructor(code: ModerationErrorCode, message: string) {
    super(message);
    this.name = "ModerationError";
    this.code = code;
  }
}

export function modelSupportsModeration(capabilities?: ModelCapabilities): boolean {
  return capabilities?.moderation === true;
}

export function assertModerationSupported(model: ModelConfig): void {
  if (!modelSupportsModeration(model.capabilities)) {
    throw new ModerationError("unsupported_model", `Model ${model.provider}/${model.model} does not declare the moderation capability`);
  }
}

export interface ModerationRequest {
  /** One input per call, or a batch where the provider allows it (results match
   *  input arity and order). */
  readonly input: string | readonly string[];
  readonly model?: string;
  readonly signal?: AbortSignal;
}

/** Per-category verdict: provider-reported score in [0,1] plus the provider's own
 *  flagged decision — never a locally recomputed threshold. */
export interface ModerationCategoryResult {
  readonly score: number;
  readonly flagged: boolean;
}

export interface ModerationResult {
  /** True when the provider flagged any category for this input. */
  readonly flagged: boolean;
  /** Category verdicts keyed by provider-neutral name (unknown raw categories pass through). */
  readonly categories: Readonly<Record<string, ModerationCategoryResult>>;
  /** Provider-native category/score fields, unmodified, for host-side audits. */
  readonly raw?: JsonObject;
  readonly model?: string;
  readonly id?: string;
}

export interface ModerationProvider {
  readonly id: string;
  moderate(request: ModerationRequest): Promise<ModerationResult | readonly ModerationResult[]>;
}
