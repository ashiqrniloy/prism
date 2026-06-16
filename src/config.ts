import type { JsonObject, JsonValue } from "./contracts.js";

export interface ConfigLoadContext {
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConfigProvider {
  readonly name: string;
  load(context?: ConfigLoadContext): Promise<JsonObject | undefined> | JsonObject | undefined;
}

export interface ConfigLayer {
  readonly name: string;
  readonly config: JsonObject;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && isJsonValue(value);
}

export function assertJsonObject(value: unknown, label = "value"): asserts value is JsonObject {
  if (!isJsonObject(value)) throw new Error(`${label} must be a JSON object`);
}

export async function loadConfigLayers(
  providers: readonly ConfigProvider[],
  context?: ConfigLoadContext,
): Promise<ConfigLayer[]> {
  const layers: ConfigLayer[] = [];
  for (const provider of providers) {
    const config = await provider.load(context);
    if (config !== undefined) {
      assertJsonObject(config, `config provider ${provider.name}`);
      layers.push({ name: provider.name, config });
    }
  }
  return layers;
}

export function mergeConfigLayers(layers: readonly ConfigLayer[]): JsonObject {
  let merged: JsonObject = {};
  for (const layer of layers) {
    assertJsonObject(layer.config, `config layer ${layer.name}`);
    merged = mergeObjects(merged, layer.config);
  }
  return merged;
}

function mergeObjects(base: JsonObject, override: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = { ...cloneJsonObject(base) };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value)
      ? mergeObjects(current as JsonObject, value as JsonObject)
      : cloneJsonValue(value);
  }
  return result;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = cloneJsonValue(entry);
  return result;
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isPlainObject(value)) return cloneJsonObject(value as JsonObject);
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isPlainObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
