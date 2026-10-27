import { type JsonObject, type SecretRedactor } from "@arnilo/prism";
import type { MemoryScope } from "./types.js";
export declare function assertNotAborted(signal?: AbortSignal): void;
export declare function requireNonEmptyString(value: unknown, label: string): string;
export declare function requireScope(scope: MemoryScope, requireThread?: boolean): Required<MemoryScope> | MemoryScope;
export declare function scopeKey(scope: MemoryScope): string;
export declare function assertSameScope(expected: MemoryScope, actual: MemoryScope, label: string): void;
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export declare function assertSafeJsonKey(key: string): void;
export declare function cloneJsonObject(value: JsonObject): JsonObject;
/**
 * Deep-merge `patch` over `base`. Delegates to the core config merger (plan 070 Task 11)
 * so JSON-only traversal, unsafe-key rejection (`__proto__`/`prototype`/`constructor`,
 * path-qualified at every depth) and cloning live in one implementation: patch values are
 * cloned, so the result never aliases the caller's patch. Failures are re-wrapped as
 * `MemoryValidationError` to keep this module's error taxonomy (`code: "validation"`).
 */
export declare function mergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject;
export declare function byteLengthOfJson(value: unknown): number;
export declare function assertByteLimit(value: unknown, maxBytes: number, label: string): void;
export declare function assertTextLimit(text: string, maxChars: number, label: string): void;
export declare function redactJson<T>(value: T, redactor?: SecretRedactor): T;
export declare function assertFiniteVector(value: unknown, label: string, expectedLength?: number): asserts value is readonly number[];
/**
 * A stored record's embedding: finite (and `expectedLength` wide when given), or empty for a
 * lexical-only record, which must then carry no `embedderId`.
 */
export declare function assertRecordEmbedding(record: {
    readonly embedding: unknown;
    readonly embedderId?: string;
}, expectedLength?: number): void;
export declare function cosineSimilarity(a: readonly number[], b: readonly number[]): number;
export declare function chunkArray<T>(items: readonly T[], size: number): T[][];
export declare function renderTemplate(template: string, value: JsonObject): string;
export declare function latestUserText(messages: readonly {
    readonly role: string;
    readonly content: readonly unknown[];
}[]): string | undefined;
export declare function contentToText(content: readonly unknown[]): string;
