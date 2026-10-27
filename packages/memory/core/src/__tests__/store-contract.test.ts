/**
 * Plan 188.11 Task 4: the `VectorStore` and `Embedder` contracts are frozen at API level 1. A later capability is an
 * optional method or a declared flag, never a new required member, so a store written against 0.13.0 keeps working.
 */
import { expect, test } from "bun:test";
import type { Embedder, VectorStore } from "../index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type RequiredKeys<T> = { [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K }[keyof T];

// A new required member changes these unions and fails the typecheck of this file.
const vectorStoreRequired: Equal<RequiredKeys<VectorStore>, "upsert" | "query" | "delete"> = true;
const embedderRequired: Equal<RequiredKeys<Embedder>, "id" | "dimensions" | "embed"> = true;
const embedderMembers: Equal<keyof Embedder, "id" | "dimensions" | "available" | "embed"> = true;

test("vector_store_required_methods_frozen", () => {
  expect(vectorStoreRequired).toBe(true);
});

test("embedder_contract_frozen", () => {
  expect(embedderRequired && embedderMembers).toBe(true);
});
