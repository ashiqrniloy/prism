import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { ModelCapabilities, ModelProvider } from "../contracts.js";

type RetiredFlag = "speech" | "transcription" | "imageGeneration" | "videoGeneration" | "moderation" | "batchJobs";
type RetiredMethod = "speech" | "transcribe" | "images" | "video" | "moderation" | "batch" | "realtime";

describe("retired modalities", () => {
  it("model_provider_contract_has_no_retired_capability", () => {
    const flagLeak: Extract<keyof ModelCapabilities, RetiredFlag> extends never ? true : never = true;
    const methodLeak: Extract<keyof ModelProvider, RetiredMethod> extends never ? true : never = true;
    assert.equal(flagLeak, true);
    assert.equal(methodLeak, true);
    const provider: ModelProvider = { id: "x", async *generate() {} };
    assert.equal("speech" in provider, false);
    assert.equal(typeof provider.embeddings, "undefined");
  });
});
