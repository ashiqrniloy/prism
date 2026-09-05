/**
 * Live reranker probes (plans/064 Task 6): operator-deployed TEI and
 * OpenAI-compatible rerank endpoints over the real wire.
 *
 * Skip-not-fail: each leg skips when its endpoint env var is unset — a missing
 * endpoint is an unavailable credential, never a failure (matrix
 * `memory/rag-rerankers-live` requiresAny over both endpoint vars).
 * One rerank request per leg (≤2 total, within the plan's ≤3 budget);
 * responses are checked conformance-style: permutation-only reorder (same hit
 * references, same id set), scores non-increasing, credential never appears in
 * any error transcript.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOpenAiCompatibleReranker } from "../hosted-rerankers.js";
import { createTeiReranker } from "../tei-reranker.js";
import type { RagHit } from "../types.js";
import { reliefHit } from "./rerank-fixtures.js";

const TEI_URL = process.env.PRISM_TEST_TEI_RERANKER_URL;
const TEI_KEY = process.env.PRISM_TEST_TEI_RERANKER_KEY;
const TEI_MODEL = process.env.PRISM_LIVE_TEI_RERANKER_MODEL;
const HOSTED_URL = process.env.PRISM_TEST_HOSTED_RERANK_URL;
const HOSTED_KEY = process.env.PRISM_TEST_HOSTED_RERANK_KEY;
const HOSTED_MODEL = process.env.PRISM_LIVE_HOSTED_RERANK_MODEL;

/** Non-sensitive probe inputs by construction (plan security criterion). */
const QUERY = "capital of France";
const HIT_TEXTS = ["Paris is the capital of France.", "The Eiffel Tower stands in Paris.", "Sourdough bread needs a long ferment."];
function probeHits(): RagHit[] {
  return HIT_TEXTS.map((text, i) => ({ ...reliefHit(`src#000${i + 1}`, 0, i), text }));
}

/** Leg bodies must never surface the credential in errors or results. */
async function assertNoKeyLeak(key: string | undefined, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (key) {
      assert.ok(!String(error).includes(key), "error transcript must not contain the credential");
    }
    throw error;
  }
}

/** Conformance assertions shared by both adapters against real responses. */
function assertPermutation(before: readonly RagHit[], after: readonly RagHit[]): void {
  assert.equal(after.length, before.length);
  assert.deepEqual(
    after.map((h) => h.id).sort(),
    before.map((h) => h.id).sort(),
    "rerank must return the same hit ids exactly once (permutation-only)",
  );
  const refs = new Set(before);
  for (const hit of after) assert.ok(refs.has(hit), "rerank must return the same object references — provenance untouched");
  for (let i = 1; i < after.length; i += 1) {
    assert.ok(after[i - 1]!.score >= after[i]!.score, `scores must be non-increasing (${after[i - 1]!.score} < ${after[i]!.score})`);
  }
}

describe("rag rerankers live (operator endpoints)", () => {
  it("TEI reranker orders real hits", {
    skip: !TEI_URL && "set PRISM_TEST_TEI_RERANKER_URL to probe a deployed TEI /rerank endpoint",
  }, async () => {
    // The TEI adapter is credential-free by design; an optional gateway key
    // rides a trusted custom transport (the adapter's documented seam).
    const transport = TEI_KEY
      ? (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
          fetch(input, { ...init, headers: { ...init?.headers, authorization: `Bearer ${TEI_KEY}` } })
      : undefined;
    const reranker = createTeiReranker({
      baseUrl: TEI_URL!,
      model: TEI_MODEL,
      allowLoopback: true,
      fetch: transport,
    });
    const hits = probeHits();
    await assertNoKeyLeak(TEI_KEY, async () => {
      assertPermutation(hits, await reranker.rerank({ query: QUERY, hits }));
    });
  });

  it("OpenAI-compatible hosted reranker orders real hits", {
    skip: !HOSTED_URL && "set PRISM_TEST_HOSTED_RERANK_URL (+ PRISM_TEST_HOSTED_RERANK_KEY) to probe a hosted /rerank endpoint",
  }, async () => {
    const reranker = createOpenAiCompatibleReranker({
      baseUrl: HOSTED_URL!,
      apiKey: HOSTED_KEY,
      model: HOSTED_MODEL,
      allowLoopback: true,
    });
    const hits = probeHits();
    await assertNoKeyLeak(HOSTED_KEY, async () => {
      assertPermutation(hits, await reranker.rerank({ query: QUERY, hits }));
    });
  });
});
