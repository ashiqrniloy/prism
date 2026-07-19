export const DEFAULT_MAX_WORKER_TURNS = 16;
export const HARD_MAX_WORKER_TURNS = 64;
export const DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN = 32;
export const HARD_MAX_WORKER_TOOL_CALLS_PER_TURN = 256;
export const DEFAULT_MAX_WORKER_TOOL_CALLS = 128;
export const HARD_MAX_WORKER_TOOL_CALLS = 1024;
export const DEFAULT_MAX_WORKER_ARGUMENT_BYTES = 64 * 1024;
export const HARD_MAX_WORKER_ARGUMENT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_WORKER_RESULT_BYTES = 64 * 1024;
export const HARD_MAX_WORKER_RESULT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_WORKER_MESSAGE_BYTES = 1024 * 1024;
export const HARD_MAX_WORKER_MESSAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_WORKER_ERROR_BYTES = 1024;
export const HARD_MAX_WORKER_ERROR_BYTES = 8 * 1024;
const MAX_WORKER_JSON_DEPTH = 64;

export interface MemoryWorkerLimitOptions {
  readonly maxTurns?: number;
  readonly maxToolCallsPerTurn?: number;
  readonly maxToolCalls?: number;
  readonly maxArgumentBytes?: number;
  readonly maxResultBytes?: number;
  readonly maxMessageBytes?: number;
  readonly maxErrorBytes?: number;
}

export interface ResolvedMemoryWorkerLimits {
  readonly maxTurns: number;
  readonly maxToolCallsPerTurn: number;
  readonly maxToolCalls: number;
  readonly maxArgumentBytes: number;
  readonly maxResultBytes: number;
  readonly maxMessageBytes: number;
  readonly maxErrorBytes: number;
}

const SPECS = {
  maxTurns: [DEFAULT_MAX_WORKER_TURNS, HARD_MAX_WORKER_TURNS],
  maxToolCallsPerTurn: [DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN, HARD_MAX_WORKER_TOOL_CALLS_PER_TURN],
  maxToolCalls: [DEFAULT_MAX_WORKER_TOOL_CALLS, HARD_MAX_WORKER_TOOL_CALLS],
  maxArgumentBytes: [DEFAULT_MAX_WORKER_ARGUMENT_BYTES, HARD_MAX_WORKER_ARGUMENT_BYTES],
  maxResultBytes: [DEFAULT_MAX_WORKER_RESULT_BYTES, HARD_MAX_WORKER_RESULT_BYTES],
  maxMessageBytes: [DEFAULT_MAX_WORKER_MESSAGE_BYTES, HARD_MAX_WORKER_MESSAGE_BYTES],
  maxErrorBytes: [DEFAULT_MAX_WORKER_ERROR_BYTES, HARD_MAX_WORKER_ERROR_BYTES],
} as const;

export function resolveMemoryWorkerLimits(input: MemoryWorkerLimitOptions = {}): ResolvedMemoryWorkerLimits {
  return Object.fromEntries(Object.entries(SPECS).map(([name, [fallback, hardCap]]) => {
    const value = input[name as keyof MemoryWorkerLimitOptions] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > hardCap) {
      throw new RangeError(`${name} must be a positive safe integer at most ${hardCap}`);
    }
    return [name, value];
  })) as unknown as ResolvedMemoryWorkerLimits;
}

export function measureWorkerJson(value: unknown, maxBytes: number, label: string): number {
  const active = new WeakSet<object>();
  let bytes = 0;
  const add = (amount: number): void => {
    bytes += amount;
    if (bytes > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  };
  const walk = (current: unknown, depth: number): void => {
    if (depth > MAX_WORKER_JSON_DEPTH) throw new Error(`${label} exceeds JSON depth ${MAX_WORKER_JSON_DEPTH}`);
    if (current === null) return add(4);
    if (typeof current === "string") return add(Buffer.byteLength(JSON.stringify(current), "utf8"));
    if (typeof current === "boolean") return add(current ? 4 : 5);
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error(`${label} contains a non-finite number`);
      return add(Buffer.byteLength(String(current), "utf8"));
    }
    if (!current || typeof current !== "object") throw new Error(`${label} contains a non-JSON value`);
    if (active.has(current)) throw new Error(`${label} contains a cycle`);
    active.add(current);
    try {
      if (Array.isArray(current)) {
        add(2);
        for (let index = 0; index < current.length; index += 1) {
          if (index) add(1);
          walk(current[index] ?? null, depth + 1);
        }
        return;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} contains a non-JSON object`);
      add(2);
      let count = 0;
      for (const key in current as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        const item = (current as Record<string, unknown>)[key];
        if (item === undefined) continue;
        if (count++) add(1);
        add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        walk(item, depth + 1);
      }
    } finally {
      active.delete(current);
    }
  };
  walk(value, 0);
  return bytes;
}

export function joinWorkerText(parts: Iterable<string>, maxBytes: number, label: string): string {
  let output = "";
  for (const part of parts) {
    const nextBytes = Buffer.byteLength(output, "utf8") + (output ? 1 : 0) + Buffer.byteLength(part, "utf8");
    if (nextBytes > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
    output += `${output ? "\n" : ""}${part}`;
  }
  return output;
}

export function truncateWorkerText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), "utf8") <= maxBytes) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1]!)) low -= 1;
  return text.slice(0, low);
}
