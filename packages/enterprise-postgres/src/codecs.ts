import { EnterprisePostgresError } from "./errors.js";

const MAX_JSON_DEPTH = 64;
const MAX_JSON_PROPERTIES = 10_000;

/** Encode bounded JSON before any enterprise row insert. */
export function encodeBoundedJson(value: unknown, maxBytes: number, label: string): string {
  assertBoundedJson(value, maxBytes, label);
  return JSON.stringify(value);
}

/** Decode and validate stored JSON before exposing it to a caller. */
export function decodeBoundedJson(value: unknown, maxBytes: number, label: string): unknown {
  if (typeof value !== "string") throw boundsError(`${label} is not stored JSON`);
  try {
    const decoded: unknown = JSON.parse(value);
    assertBoundedJson(decoded, maxBytes, label);
    return decoded;
  } catch (error) {
    if (error instanceof EnterprisePostgresError) throw error;
    throw boundsError(`${label} is invalid stored JSON`);
  }
}

function assertBoundedJson(value: unknown, maxBytes: number, label: string): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw boundsError(`${label} byte limit is invalid`);
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw boundsError(`${label} is not serializable`);
  }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > maxBytes) throw boundsError(`${label} exceeds byte limit`);

  let properties = 0;
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length) {
    const [entry, depth] = stack.pop()!;
    if (depth > MAX_JSON_DEPTH) throw boundsError(`${label} exceeds depth limit`);
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") continue;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw boundsError(`${label} contains non-finite number`);
      continue;
    }
    if (typeof entry !== "object") throw boundsError(`${label} is not JSON`);
    if (Array.isArray(entry)) {
      for (const child of entry) stack.push([child, depth + 1]);
      continue;
    }
    const object = entry as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw boundsError(`${label} contains forbidden key`);
      properties += 1;
      if (properties > MAX_JSON_PROPERTIES) throw boundsError(`${label} exceeds property limit`);
      stack.push([object[key], depth + 1]);
    }
  }
}

function boundsError(message: string): EnterprisePostgresError {
  return new EnterprisePostgresError(message, "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS");
}
