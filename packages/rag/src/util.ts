import { createSecretRedactor, type JsonObject, type JsonValue, type Message, type SecretRedactor } from "@arnilo/prism";
import { RagAbortError, RagLimitError, RagScopeError, RagValidationError } from "./errors.js";
import type { RagScope } from "./types.js";

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RagAbortError();
}

export function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new RagValidationError(`${label} must be a non-empty string`);
  return value;
}

export function requireSourceId(value: unknown): string {
  const sourceId = nonEmpty(value, "sourceId");
  if (sourceId.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(sourceId)) {
    throw new RagValidationError("sourceId must be <= 256 URL-safe identifier characters");
  }
  return sourceId;
}

export function requireScope(scope: RagScope): RagScope {
  return {
    tenantId: nonEmpty(scope.tenantId, "tenantId"),
    resourceId: nonEmpty(scope.resourceId, "resourceId"),
    corpusId: nonEmpty(scope.corpusId, "corpusId"),
  };
}

export function assertScope(expected: RagScope, actual: { tenantId: string; resourceId: string; threadId: string }): void {
  if (
    actual.tenantId !== expected.tenantId
    || actual.resourceId !== expected.resourceId
    || actual.threadId !== expected.corpusId
  ) {
    throw new RagScopeError("vector hit crossed tenant/resource/corpus boundary");
  }
}

export function resolveRedactor(
  redactor?: SecretRedactor,
  secrets?: readonly (string | undefined)[],
): SecretRedactor | undefined {
  return redactor ?? (secrets?.length ? createSecretRedactor(secrets) : undefined);
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

export function assertBytes(value: unknown, limit: number, label: string): void {
  const bytes = byteLength(value);
  if (bytes > limit) throw new RagLimitError(`${label} exceeds ${limit} bytes (${bytes})`);
}

export function latestUserText(messages: readonly Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const text = message.content
      .filter((block): block is Extract<(typeof message.content)[number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (text.trim()) return text;
  }
  return undefined;
}

export function jsonEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => jsonEqual(left[key], right[key]));
  }
  return false;
}

export function matchesFilter(metadata: JsonObject | undefined, filter: JsonObject | undefined): boolean {
  if (!filter) return true;
  if (!metadata) return false;
  return Object.entries(filter).every(([key, value]) => jsonEqual(metadata[key], value));
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function truncateUtf8(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  let output = "";
  let bytes = 0;
  for (const character of text) {
    const size = byteLength(character);
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
}
