import type { JsonObject, ModelConfig, ProviderRequest, ProviderRequestOptions } from "../contracts.js";
/**
 * Portable thinking / reasoning effort levels shared across first-party providers.
 * Model-dependent legality (which values a given model accepts) stays provider-owned.
 */
export declare const THINKING_LEVELS: readonly ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/**
 * Compat mapping families used by ≥2 packages, or explicit no-op for host-owned adapters.
 * Provider packages keep unique escape hatches (budgets, keep/all, tool_stream) local.
 */
export type ThinkingCompatFamily = "openai_reasoning" | "reasoning_effort" | "thinking_type" | "google" | "output_config_effort" | "noop";
export declare function isThinkingLevel(value: unknown): value is ThinkingLevel;
/**
 * Parse a host thinking-level value without guessing: known levels canonicalize to
 * `ThinkingLevel`, unknown non-empty strings pass through as opaque `{ opaque }`
 * (forward-compat passthrough), invalid/empty/non-string input fails closed.
 */
export declare function parseThinkingLevel(value: unknown): ThinkingLevel | {
    readonly opaque: string;
} | undefined;
/**
 * Normalize a host thinkingLevel string. Known levels are lowercased; other non-empty
 * strings pass through as opaque effort values for forward-compatible provider fields.
 */
export declare function normalizeThinkingLevel(level: string): ThinkingLevel | string | undefined;
/**
 * Build the `ProviderRequestOptions.compat` patch for a shared thinking level.
 * Does not invent a second options tree — providers keep reading official fields from `compat`.
 */
export declare function thinkingCompatFor(family: ThinkingCompatFamily, level: ThinkingLevel | string): JsonObject;
/**
 * Merge a shared thinking level into `providerOptions.compat` for the given family.
 * Per-turn patches win over prior compat via {@link mergeProviderRequestOptions}.
 */
export declare function applyThinkingLevel(options: ProviderRequestOptions | undefined, level: ThinkingLevel | string, family?: ThinkingCompatFamily): ProviderRequestOptions;
/**
 * Declared portable thinking levels for a model, if any (ascending ladder order).
 * `undefined` means the provider declares no subset — forward-compat passthrough.
 */
export declare function thinkingLevelsForModel(model: Pick<ModelConfig, "provider" | "compat" | "capabilities">): readonly string[] | undefined;
/**
 * Strict declared-set membership (hosts fail closed on unknown levels).
 * A model that declares no levels supports any value (forward-compat passthrough).
 */
export declare function isSupportedThinkingLevel(model: Pick<ModelConfig, "provider" | "compat" | "capabilities">, level: unknown): boolean;
/**
 * Snap a portable level to a model's declared set (design record §2):
 * in-set → unchanged; below the declared minimum → up to the minimum
 * (never silently disable what cannot be disabled); otherwise nearest declared
 * level by ladder distance with ties breaking up; undeclared levels and
 * undeclared sets pass through. Provider-documented snap tables
 * (deepseek, Z.AI GLM-5.2, clinepass slots) override this generic fallback
 * inside their own resolvers.
 */
export declare function snapThinkingLevel(model: Pick<ModelConfig, "provider" | "compat" | "capabilities">, level: ThinkingLevel | string): ThinkingLevel | string;
/**
 * Model-aware thinking-level application (design record §5). Resolves the family
 * stamp-first (`compat.thinkingFamily` → inference → `capabilities.reasoning`),
 * snaps the level to the model's declared set, and merges the compat patch
 * per-turn-wins. Returns options unchanged for non-reasoning models — never
 * invents a field where the model declares no thinking support.
 */
export declare function applyThinkingLevelForModel(options: ProviderRequestOptions | undefined, level: ThinkingLevel | string, model: Pick<ModelConfig, "provider" | "compat" | "capabilities">): ProviderRequestOptions;
/**
 * Best-effort family inference from model metadata without a second options tree.
 * Prefer an explicit `compat.thinkingFamily` stamp in host/use-case workers when
 * the provider is known; inference is the fallback (stamp-first).
 *
 * Heuristics (ordered):
 * 1. `compat.thinkingFamily` stamp → itself
 * 2. Existing `compat.thinking` object → `thinking_type`
 * 3. Existing `compat.thinkingConfig` object/boolean → `google`
 * 4. Existing `compat.reasoning` → `openai_reasoning`
 * 5. Existing `compat.reasoning_effort` → `reasoning_effort`
 * 6. Provider id starting with `openai` → `openai_reasoning`
 * 7. Provider id `neuralwatt` → `reasoning_effort`
 * 8. `capabilities.reasoning` → `reasoning_effort` (portable string field)
 * 9. Else `noop`
 */
export declare function thinkingFamilyForModel(model: Pick<ModelConfig, "provider" | "compat" | "capabilities">): ThinkingCompatFamily;
/**
 * Standard provider-owned compat keys stripped before request body spread so
 * resolved options/flags are not overwritten by raw passthrough.
 */
export declare const DEFAULT_OWNED_COMPAT_KEYS: readonly ["route", "thinking", "reasoning", "reasoning_effort", "reasoningEffort", "preserveThinking", "preserve_thinking", "output_config", "thinkingFamily", "effortLevels"];
/**
 * Resolves whether to replay historical thinking blocks on the next request.
 * Request compat wins over model compat; defaults to true when reasoning is declared.
 */
export declare function resolvePreserveThinking(request: ProviderRequest): boolean;
export declare const preserveThinking: typeof resolvePreserveThinking;
/**
 * Resolves reasoning effort string snapped to declared thinking levels.
 * Request compat wins over model compat. Undeclared levels pass through.
 */
export declare function resolveReasoningEffort(request: ProviderRequest): string | undefined;
export declare const reasoningEffort: typeof resolveReasoningEffort;
/**
 * Resolves upstream thinking object (e.g. `{ type: "enabled" }` or `{ type: "disabled" }`).
 */
export declare function resolveThinkingObject(request: ProviderRequest): JsonObject | undefined;
export declare const thinkingObject: typeof resolveThinkingObject;
/**
 * Resolves upstream OpenAI-style reasoning object with effort snapped to declared levels.
 */
export declare function resolveReasoningObject(request: ProviderRequest): JsonObject | undefined;
export declare const reasoningObject: typeof resolveReasoningObject;
/**
 * Strips provider-owned compat keys from request options before serializing to wire.
 * Can be called with (compat, extraKeys) or with (keys) returning a function.
 */
export declare function stripOwnedCompat(keys?: readonly string[]): (compat: JsonObject | undefined) => JsonObject | undefined;
export declare function stripOwnedCompat(compat: JsonObject | undefined, extraKeys?: readonly string[]): JsonObject | undefined;
