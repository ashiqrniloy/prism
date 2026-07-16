import { createSecretRedactor, type JsonObject, type JsonValue, type SecretRedactor } from "@arnilo/prism";
import { MemoryAbortError, MemoryLimitError, MemoryScopeError, MemoryValidationError } from "./errors.js";
import type { MemoryScope } from "./types.js";

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MemoryAbortError();
}

export function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MemoryValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

export function requireScope(scope: MemoryScope, requireThread = false): Required<MemoryScope> | MemoryScope {
  const tenantId = requireNonEmptyString(scope.tenantId, "tenantId");
  const resourceId = requireNonEmptyString(scope.resourceId, "resourceId");
  if (requireThread) {
    const threadId = requireNonEmptyString(scope.threadId, "threadId");
    return { tenantId, resourceId, threadId };
  }
  if (scope.threadId !== undefined) {
    return { tenantId, resourceId, threadId: requireNonEmptyString(scope.threadId, "threadId") };
  }
  return { tenantId, resourceId };
}

export function scopeKey(scope: MemoryScope): string {
  const base = `${scope.tenantId}\0${scope.resourceId}`;
  return scope.threadId === undefined ? `${base}\0` : `${base}\0${scope.threadId}`;
}

export function assertSameScope(expected: MemoryScope, actual: MemoryScope, label: string): void {
  if (expected.tenantId !== actual.tenantId || expected.resourceId !== actual.resourceId) {
    throw new MemoryScopeError(`${label} crossed tenant/resource boundary`);
  }
  if (expected.threadId !== undefined && expected.threadId !== actual.threadId) {
    throw new MemoryScopeError(`${label} crossed thread boundary`);
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertSafeJsonKey(key: string): void {
  if (key === "__proto__" || key === "prototype" || key === "constructor") {
    throw new MemoryValidationError(`Forbidden JSON key: ${key}`);
  }
}

export function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function mergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = { ...cloneJsonObject(base) };
  for (const [key, value] of Object.entries(patch)) {
    assertSafeJsonKey(key);
    if (
      isPlainObject(value) &&
      isPlainObject(result[key])
    ) {
      result[key] = mergeJsonObjects(result[key] as JsonObject, value as JsonObject);
    } else {
      result[key] = value as JsonValue;
    }
  }
  return result;
}

export function byteLengthOfJson(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function assertByteLimit(value: unknown, maxBytes: number, label: string): void {
  const size = byteLengthOfJson(value);
  if (size > maxBytes) throw new MemoryLimitError(`${label} exceeds ${maxBytes} bytes (${size})`);
}

export function assertTextLimit(text: string, maxChars: number, label: string): void {
  if (text.length > maxChars) throw new MemoryLimitError(`${label} exceeds ${maxChars} characters`);
}

export function resolveRedactor(
  redactor?: SecretRedactor,
  secrets?: readonly (string | undefined)[],
): SecretRedactor | undefined {
  if (redactor) return redactor;
  if (!secrets || secrets.length === 0) return undefined;
  return createSecretRedactor(secrets);
}

export function redactJson<T>(value: T, redactor?: SecretRedactor): T {
  return redactor ? redactor.redact(value) : value;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return Number.NEGATIVE_INFINITY;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new MemoryValidationError("chunk size must be positive");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function renderTemplate(template: string, value: JsonObject): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => {
    const resolved = readPath(value, path);
    if (resolved === undefined || resolved === null) return "";
    return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });
}

function readPath(value: JsonObject, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (!isPlainObject(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export function latestUserText(messages: readonly { readonly role: string; readonly content: readonly unknown[] }[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    const text = contentToText(message.content);
    if (text.trim()) return text;
  }
  return undefined;
}

export function contentToText(content: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (!isPlainObject(block)) continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}
