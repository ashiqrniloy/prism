import type { TelemetryFieldPolicy } from "./instrumentation.js";

/** Attribute-path rules as JSON: `drop` removes an attribute, `hash` replaces its string value with a token. */
export interface ObservabilityFieldPolicyConfig {
  /** Exact attribute paths, or a prefix ending in `*` (for example `prism.*`). */
  readonly drop?: readonly string[];
  readonly hash?: readonly string[];
}

export interface ObservabilityConfig {
  readonly serviceName?: string;
  /** `none` (default) adds no model-derived attributes; `metadata` adds token counts and stop reasons. Never message text. */
  readonly content?: "none" | "metadata";
  readonly fieldPolicy?: ObservabilityFieldPolicyConfig;
  readonly metrics?: boolean;
  readonly enabled?: boolean;
  /**
   * `true` injects the current span as a W3C `traceparent`/`tracestate` into the outgoing provider
   * request headers, so a gateway or proxy can join its spans to this run's trace. Default `false`.
   */
  readonly propagateTraceContext?: boolean;
  /**
   * Dotted paths into `Usage.metadata` whose scalars are exported as `prism.usage.<path>` on the chat
   * span. An explicit allowlist: nothing is exported by default, and `fieldPolicy` still applies.
   */
  readonly usageMetadata?: readonly string[];
}

const pathList = { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, maxItems: 64 } as const;

export const observabilityConfigSchema = {
  type: "object",
  properties: {
    serviceName: { type: "string", minLength: 1, maxLength: 128 },
    content: { type: "string", enum: ["none", "metadata"] },
    fieldPolicy: {
      type: "object",
      properties: { drop: pathList, hash: pathList },
      additionalProperties: false,
    },
    metrics: { type: "boolean" },
    enabled: { type: "boolean" },
    propagateTraceContext: { type: "boolean" },
    usageMetadata: { type: "array", items: { type: "string", minLength: 1, maxLength: 128 }, maxItems: 32 },
  },
  additionalProperties: false,
} as const;

const matches = (rules: readonly string[] | undefined, path: string) =>
  rules?.some((rule) => (rule.endsWith("*") ? path.startsWith(rule.slice(0, -1)) : rule === path)) ?? false;

/** Maps the JSON rules onto the function-valued policy the instrumentation applies per attribute. */
export function toFieldPolicy(config: ObservabilityFieldPolicyConfig | undefined): TelemetryFieldPolicy | undefined {
  if (!config || (!config.drop?.length && !config.hash?.length)) return undefined;
  return ({ path }) => {
    if (matches(config.drop, path)) return { action: "deny", reason: "fieldPolicy.drop" };
    if (matches(config.hash, path)) return { action: "tokenize", reason: "fieldPolicy.hash" };
    return { action: "allow" };
  };
}
