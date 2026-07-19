import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveUseCaseModel,
  resolveUseCaseModelBinding,
  useCaseCredentialProviderId,
  type ModelConfig,
  type UseCaseModelBinding,
} from "../index.js";

const sessionModel: ModelConfig = { provider: "session-provider", model: "session-model" };
const workerModel: ModelConfig = { provider: "worker-provider", model: "worker-model" };

describe("resolveUseCaseModel", () => {
  it("configured_model_wins_over_session", () => {
    const resolved = resolveUseCaseModel({ configured: workerModel, sessionModel });
    assert.deepEqual(resolved?.model, workerModel);
    assert.equal(resolved?.source, "configured");
  });

  it("falls_back_to_session_when_configured_omitted", () => {
    const resolved = resolveUseCaseModel({ sessionModel, thinkingLevel: "low" });
    assert.deepEqual(resolved?.model, sessionModel);
    assert.equal(resolved?.source, "session");
    assert.equal(resolved?.thinkingLevel, "low");
  });

  it("requireExplicitModel_skips_session_fallback", () => {
    assert.equal(resolveUseCaseModel({ sessionModel, requireExplicitModel: true }), undefined);
    assert.deepEqual(
      resolveUseCaseModel({ configured: workerModel, sessionModel, requireExplicitModel: true })?.model,
      workerModel,
    );
  });

  it("returns_undefined_when_both_missing", () => {
    assert.equal(resolveUseCaseModel({}), undefined);
    assert.equal(resolveUseCaseModel({ requireExplicitModel: true }), undefined);
  });

  it("binding_helper_maps_fields", () => {
    const binding: UseCaseModelBinding = {
      model: workerModel,
      providerOptions: { cacheRetention: "short" },
      thinkingLevel: "medium",
    };
    const resolved = resolveUseCaseModelBinding(binding, sessionModel);
    assert.equal(resolved?.source, "configured");
    assert.equal(resolved?.thinkingLevel, "medium");
    assert.equal(resolved?.providerOptions?.cacheRetention, "short");

    const fallback = resolveUseCaseModelBinding({ thinkingLevel: "high" }, sessionModel);
    assert.equal(fallback?.source, "session");
    assert.equal(fallback?.thinkingLevel, "high");

    assert.equal(resolveUseCaseModelBinding({ requireExplicitModel: true }, sessionModel), undefined);
  });

  it("credential_provider_id_matches_resolved_model", () => {
    const resolved = resolveUseCaseModel({ configured: workerModel, sessionModel });
    assert.equal(useCaseCredentialProviderId(resolved), "worker-provider");
    assert.equal(useCaseCredentialProviderId(undefined, { provider: "hint" }), "hint");
    assert.equal(useCaseCredentialProviderId(undefined), undefined);
  });
});
