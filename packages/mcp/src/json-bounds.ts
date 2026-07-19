import { McpBridgeError } from "./types.js";

export interface JsonBounds {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxProperties: number;
  readonly label?: string;
}

export interface JsonMeasurement {
  readonly bytes: number;
  readonly properties: number;
}

/** Measure JSON-compatible data incrementally without creating a serialized copy. */
export function measureBoundedJson(value: unknown, bounds: JsonBounds): JsonMeasurement {
  const label = bounds.label ?? "MCP JSON";
  let bytes = 0;
  let properties = 0;
  const active = new Set<object>();

  const addBytes = (count: number): void => {
    bytes += count;
    if (bytes > bounds.maxBytes) throw new McpBridgeError(`${label} exceeds ${bounds.maxBytes} bytes`);
  };
  const addProperty = (): void => {
    properties += 1;
    if (properties > bounds.maxProperties) {
      throw new McpBridgeError(`${label} exceeds ${bounds.maxProperties} properties`);
    }
  };

  const walk = (item: unknown, depth: number): void => {
    if (depth > bounds.maxDepth) throw new McpBridgeError(`${label} exceeds depth ${bounds.maxDepth}`);
    if (item === null) { addBytes(4); return; }
    if (typeof item === "string") { addBytes(jsonStringBytes(item)); return; }
    if (typeof item === "boolean") { addBytes(item ? 4 : 5); return; }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new McpBridgeError(`${label} contains a non-finite number`);
      addBytes(Buffer.byteLength(String(item), "utf8"));
      return;
    }
    if (typeof item !== "object") throw new McpBridgeError(`${label} contains a non-JSON value`);
    if (active.has(item)) throw new McpBridgeError(`${label} contains a cycle`);
    active.add(item);
    try {
      if (Array.isArray(item)) {
        addBytes(2);
        for (let index = 0; index < item.length; index += 1) {
          addProperty();
          if (index > 0) addBytes(1);
          walk(item[index], depth + 1);
        }
        return;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new McpBridgeError(`${label} contains a non-plain object`);
      }
      const record = item as Record<string, unknown>;
      addBytes(2);
      let index = 0;
      for (const key in record) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
        addProperty();
        if (index > 0) addBytes(1);
        addBytes(jsonStringBytes(key) + 1);
        walk(record[key], depth + 1);
        index += 1;
      }
    } finally {
      active.delete(item);
    }
  };

  walk(value, 1);
  return { bytes, properties };
}

function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (index + 1 < value.length && low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
