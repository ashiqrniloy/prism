import type { ProviderEvent } from "@arnilo/prism";

/**
 * NeuralWatt energy and cost telemetry.
 *
 * NeuralWatt streams `: energy {...}` and `: cost {...}` as SSE comment lines
 * (lines starting with `:`) before `data: [DONE]`. Standard SSE clients ignore
 * comments, so these values are invisible unless the raw stream is parsed.
 * Non-streaming responses instead carry top-level `energy` and `cost` JSON
 * fields.
 *
 * Prism's core `ProviderEvent` union has no generic telemetry event, so these
 * package-specific types and parsers are the observable seam. Telemetry
 * contains usage/cost numbers only — never prompts, API keys, or headers.
 */

/** Energy attribution reported by NeuralWatt for a single request. */
export interface NeuralWattEnergyTelemetry {
  readonly energy_joules?: number;
  readonly energy_kwh?: number;
  readonly avg_power_watts?: number;
  readonly duration_seconds?: number;
  readonly attribution_method?: string;
  readonly attribution_ratio?: number;
  readonly ratio_was_capped?: boolean;
  readonly uncapped_attribution_ratio?: number;
  readonly uncapped_energy_joules?: number;
  readonly uncapped_energy_kwh?: number;
}

/** Cost breakdown reported by NeuralWatt for a single request. */
export interface NeuralWattCostTelemetry {
  readonly request_cost_usd?: number;
  readonly cache_savings_usd?: number;
  readonly allowance_remaining_usd?: number;
  readonly budget_remaining_usd?: number;
}

/** A package-specific telemetry event yielded alongside standard provider events. */
export interface NeuralWattTelemetryEvent {
  readonly type: "neuralwatt:telemetry";
  readonly energy?: NeuralWattEnergyTelemetry;
  readonly cost?: NeuralWattCostTelemetry;
}

/** Standard provider events plus NeuralWatt telemetry events. */
export type NeuralWattEvent = ProviderEvent | NeuralWattTelemetryEvent;

/**
 * Parse a `: energy {...}` SSE comment payload into typed telemetry.
 * Returns `undefined` when the payload is missing, malformed, or empty so
 * callers can skip non-energy comments without try/catch noise.
 */
export function parseNeuralWattEnergy(payload: string): NeuralWattEnergyTelemetry | undefined {
  const json = safeParse(payload);
  if (!json) return undefined;
  return clean({
    energy_joules: numberOrUndefined(json.energy_joules),
    energy_kwh: numberOrUndefined(json.energy_kwh),
    avg_power_watts: numberOrUndefined(json.avg_power_watts),
    duration_seconds: numberOrUndefined(json.duration_seconds),
    attribution_method: stringOrUndefined(json.attribution_method),
    attribution_ratio: numberOrUndefined(json.attribution_ratio),
    ratio_was_capped: booleanOrUndefined(json.ratio_was_capped),
    uncapped_attribution_ratio: numberOrUndefined(json.uncapped_attribution_ratio),
    uncapped_energy_joules: numberOrUndefined(json.uncapped_energy_joules),
    uncapped_energy_kwh: numberOrUndefined(json.uncapped_energy_kwh),
  }) as NeuralWattEnergyTelemetry;
}

/**
 * Parse a `: cost {...}` SSE comment payload into typed telemetry.
 * Returns `undefined` when the payload is missing, malformed, or empty.
 */
export function parseNeuralWattCost(payload: string): NeuralWattCostTelemetry | undefined {
  const json = safeParse(payload);
  if (!json) return undefined;
  return clean({
    request_cost_usd: numberOrUndefined(json.request_cost_usd),
    cache_savings_usd: numberOrUndefined(json.cache_savings_usd),
    allowance_remaining_usd: numberOrUndefined(json.allowance_remaining_usd),
    budget_remaining_usd: numberOrUndefined(json.budget_remaining_usd),
  }) as NeuralWattCostTelemetry;
}

/**
 * Parse a single SSE comment frame (`: energy {...}` / `: cost {...}`) into a
 * telemetry event. Returns `undefined` for unknown or malformed comments so the
 * SSE reader can skip them without crashing generation.
 */
export function parseNeuralWattComment(text: string): NeuralWattTelemetryEvent | undefined {
  const match = /^(\w+)\s+(.*)$/s.exec(text);
  if (!match) return undefined;
  const [, kind, payload] = match;
  if (kind === "energy") {
    const energy = parseNeuralWattEnergy(payload);
    return energy ? { type: "neuralwatt:telemetry", energy } : undefined;
  }
  if (kind === "cost") {
    const cost = parseNeuralWattCost(payload);
    return cost ? { type: "neuralwatt:telemetry", cost } : undefined;
  }
  return undefined;
}

/**
 * Map a non-streaming NeuralWatt response body (which carries top-level
 * `energy` and `cost` JSON fields) into typed telemetry. Returns an object
 * with optional `energy`/`cost`; both are `undefined` when absent or malformed.
 */
export function mapNeuralWattTelemetry(body: unknown): { readonly energy?: NeuralWattEnergyTelemetry; readonly cost?: NeuralWattCostTelemetry } {
  const json = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    energy: json.energy && typeof json.energy === "object" ? parseNeuralWattEnergy(JSON.stringify(json.energy)) : undefined,
    cost: json.cost && typeof json.cost === "object" ? parseNeuralWattCost(JSON.stringify(json.cost)) : undefined,
  };
}

function safeParse(payload: string): Record<string, unknown> | undefined {
  if (!payload.trim()) return undefined;
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function clean(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
