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
  return isPlainObject(value) && isJsonValue(value) && isSafeJsonValue(value);
}

export function assertJsonObject(value: unknown, label = "value"): asserts value is JsonObject {
  if (!isPlainObject(value) || !isJsonValue(value)) throw new Error(`${label} must be a JSON object`);
  assertSafeJsonValue(value, label);
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

function mergeObjects(base: JsonObject, override: JsonObject, path = "config"): JsonObject {
  const result: Record<string, JsonValue> = { ...cloneJsonObject(base, path) };
  for (const [key, value] of Object.entries(override)) {
    const childPath = `${path}.${key}`;
    assertSafeJsonKey(key, childPath);
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value)
      ? mergeObjects(current as JsonObject, value as JsonObject, childPath)
      : cloneJsonValue(value, childPath);
  }
  return result;
}

function cloneJsonObject(value: JsonObject, path = "value"): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    assertSafeJsonKey(key, childPath);
    result[key] = cloneJsonValue(entry, childPath);
  }
  return result;
}

function cloneJsonValue(value: JsonValue, path = "value"): JsonValue {
  if (Array.isArray(value)) return value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`));
  if (isPlainObject(value)) return cloneJsonObject(value as JsonObject, path);
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

function isSafeJsonValue(value: JsonValue): boolean {
  try {
    assertSafeJsonValue(value, "value");
    return true;
  } catch {
    return false;
  }
}

function assertSafeJsonValue(value: JsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    assertSafeJsonKey(key, childPath);
    assertSafeJsonValue(entry, childPath);
  }
}

function assertSafeJsonKey(key: string, path: string): void {
  if (!isSafeJsonKey(key)) throw new Error(`${path} uses forbidden JSON key: ${key}`);
}

function isSafeJsonKey(key: string): boolean {
  return key !== "__proto__" && key !== "prototype" && key !== "constructor";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
