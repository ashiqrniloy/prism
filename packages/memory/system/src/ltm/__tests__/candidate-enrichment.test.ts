import { expect, test } from "bun:test";
import { lexicalTerms } from "@arnilo/prism-memory-core";
import { exchangeKeywords } from "../exchanges.js";

test("exchange_enrichment_is_deterministic_and_model_free", () => {
  const text = "Alice Smith ran a marathon in Paris on 2026-10-30, covering 42 km.";
  expect(exchangeKeywords(text)).toEqual(exchangeKeywords(text));
  expect(exchangeKeywords(text)).toContain("alice smith");
  expect(exchangeKeywords(text)).toContain("2026-10-30");
  expect(exchangeKeywords(text)).toContain("42 km");
  expect(exchangeKeywords(text)).toContain("exercise");
});

test("enrichment_reaches_lexically_unreachable_round", () => {
  const text = "My flight landed at Heathrow.";
  expect(lexicalTerms(text).has("travel")).toBe(false);
  expect(lexicalTerms(exchangeKeywords(text).join(" ")).has("travel")).toBe(true);
});

test("enrichment stays below two milliseconds per exchange", () => {
  const text = "Alice Smith booked a flight to Paris on 2026-10-30 for her vacation. ".repeat(200);
  for (let i = 0; i < 20; i++) exchangeKeywords(text);
  const start = performance.now();
  for (let i = 0; i < 200; i++) exchangeKeywords(text);
  expect((performance.now() - start) / 200).toBeLessThan(2);
});
