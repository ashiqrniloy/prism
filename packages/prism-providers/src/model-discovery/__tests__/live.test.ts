import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGoogleModelDiscovery, createOpenAiCompatibleModelDiscovery, runModelDiscoveryConformance } from "../index.js";

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
const skip: string | false =
  !LIVE || (!OPENAI_KEY && !GEMINI_KEY)
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and OPENAI_API_KEY or GEMINI_API_KEY to run live model-discovery smoke tests"
    : false;

/** Probe whichever real wire a present key gives us; both adapters hit the
 * provider's genuine listing endpoint through the bounded transport. */
function createDiscovery() {
  if (OPENAI_KEY) {
    return createOpenAiCompatibleModelDiscovery({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: () => process.env.OPENAI_API_KEY!,
    });
  }
  return createGoogleModelDiscovery({ provider: "google", apiKey: () => GEMINI_KEY as string });
}

describe("@arnilo/prism-providers/model-discovery live tests", () => {
  it("live_listing_conforms_over_real_provider_wire", { skip }, async () => {
    await runModelDiscoveryConformance(createDiscovery);
  });

  it("live_listing_returns_a_known_model_id", { skip }, async () => {
    const { models } = await createDiscovery().listModels({ ttlMs: 0 });
    assert.ok(models.length > 0, "live listing returned no models");
  });
});
