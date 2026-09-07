import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderRequest, ProviderRequestOptions } from "../contracts.js";
import { applyDefaultProviderRequestOptions, applyThinkingLevelForModel, ProviderRequirementError } from "../index.js";

const req = (options?: ProviderRequestOptions): ProviderRequest => ({
  model: { provider: "mock", model: "demo" },
  messages: [],
  options,
});

describe("applyDefaultProviderRequestOptions", () => {
  it("empty options + sessionId sets sessionId and cacheKey", () => {
    const next = applyDefaultProviderRequestOptions(req(), { sessionId: "s1" });
    assert.equal(next.options?.sessionId, "s1");
    assert.equal(next.options?.cacheKey, "s1");
  });

  it("host sessionId wins; cacheKey fills from host sessionId", () => {
    const next = applyDefaultProviderRequestOptions(req({ sessionId: "host", headers: { "x-demo": "1" } }), {
      sessionId: "ctx",
    });
    assert.equal(next.options?.sessionId, "host");
    assert.equal(next.options?.cacheKey, "host");
    assert.equal(next.options?.headers?.["x-demo"], "1");
  });

  it("host cacheKey wins even when different from sessionId", () => {
    const next = applyDefaultProviderRequestOptions(req({ sessionId: "s1", cacheKey: "custom" }), { sessionId: "ctx" });
    assert.equal(next.options?.sessionId, "s1");
    assert.equal(next.options?.cacheKey, "custom");
  });

  it("missing ctx.sessionId + empty options leaves request unchanged", () => {
    const request = req();
    assert.equal(applyDefaultProviderRequestOptions(request), request);
    assert.equal(applyDefaultProviderRequestOptions(request, { sessionId: "" }), request);
  });

  it("does not sanitize; om: prefix survives", () => {
    const next = applyDefaultProviderRequestOptions(req(), { sessionId: "om:abc-1" });
    assert.equal(next.options?.sessionId, "om:abc-1");
    assert.equal(next.options?.cacheKey, "om:abc-1");
  });

  const defaults = [{ location: "system_prompt" }, { location: "last_stable_message" }];

  it("cache_control model + empty options sets default breakpoints and short retention", () => {
    const next = applyDefaultProviderRequestOptions({
      ...req(),
      model: { provider: "mock", model: "demo", cache: { kind: "cache_control" } },
    });
    assert.deepEqual(next.options?.cache?.breakpoints, defaults);
    assert.equal(next.options?.cacheRetention, "short");
    assert.equal(next.options?.sessionId, undefined);
  });

  it("explicitBreakpoints model gets the same cache defaults", () => {
    const next = applyDefaultProviderRequestOptions({
      ...req(),
      model: { provider: "openai", model: "gpt-5.6", cache: { kind: "openai_key", explicitBreakpoints: true } },
    });
    assert.deepEqual(next.options?.cache?.breakpoints, defaults);
    assert.equal(next.options?.cacheRetention, "short");
  });

  it("cache.mode off and cacheRetention none skip defaults", () => {
    const model = { provider: "mock", model: "demo", cache: { kind: "cache_control" as const } };
    const off = applyDefaultProviderRequestOptions({ ...req({ cache: { mode: "off" } }), model });
    assert.equal(off.options?.cache?.breakpoints, undefined);
    assert.equal(off.options?.cacheRetention, undefined);
    const none = applyDefaultProviderRequestOptions({ ...req({ cacheRetention: "none" }), model });
    assert.equal(none.options?.cache?.breakpoints, undefined);
    assert.equal(none.options?.cacheRetention, "none");
  });

  it("host breakpoints stay unchanged; host retention wins", () => {
    const model = { provider: "mock", model: "demo", cache: { kind: "cache_control" as const } };
    const host = [{ location: "last_user_message" as const }];
    const next = applyDefaultProviderRequestOptions({
      ...req({ cache: { breakpoints: host }, cacheRetention: "long" }),
      model,
    });
    assert.deepEqual(next.options?.cache?.breakpoints, host);
    assert.equal(next.options?.cacheRetention, "long");
  });

  it("implicit model gets no breakpoints", () => {
    const next = applyDefaultProviderRequestOptions({
      ...req(),
      model: { provider: "mock", model: "demo", cache: { kind: "implicit" } },
    });
    assert.equal(next.options?.cache?.breakpoints, undefined);
    assert.equal(next.options?.cacheRetention, undefined);
  });

  it("fills cache defaults even when sessionId already set", () => {
    const next = applyDefaultProviderRequestOptions({
      ...req({ sessionId: "s1", cacheKey: "s1" }),
      model: { provider: "mock", model: "demo", cache: { kind: "cache_control" } },
    });
    assert.equal(next.options?.sessionId, "s1");
    assert.deepEqual(next.options?.cache?.breakpoints, defaults);
    assert.equal(next.options?.cacheRetention, "short");
  });

  it("thinkingLevel patches after session/cache and matches applyThinkingLevelForModel", () => {
    const request: ProviderRequest = {
      model: { provider: "openai", model: "gpt" },
      messages: [],
    };
    const next = applyDefaultProviderRequestOptions(request, { sessionId: "s1", thinkingLevel: "low" });
    assert.equal(next.options?.sessionId, "s1");
    assert.deepEqual(next.options?.compat, applyThinkingLevelForModel(undefined, "low", request.model).compat);
  });

  it("thinkingLevel wins over stale host compat", () => {
    const next = applyDefaultProviderRequestOptions(
      {
        model: { provider: "openai", model: "gpt" },
        messages: [],
        options: { compat: { reasoning: { effort: "high", summary: "auto" } } },
      },
      { thinkingLevel: "low" },
    );
    assert.deepEqual(next.options?.compat?.reasoning, { effort: "low", summary: "auto" });
  });

  it("omitted thinkingLevel invents no compat on noop model", () => {
    const next = applyDefaultProviderRequestOptions(req(), { sessionId: "s1" });
    assert.equal(next.options?.compat, undefined);
  });

  it("thinkingLevel snaps to declared set", () => {
    const model = {
      provider: "openai",
      model: "gpt",
      capabilities: { reasoning: true, thinkingLevels: ["low", "medium", "high"] as const },
    };
    const next = applyDefaultProviderRequestOptions({ model, messages: [] }, { thinkingLevel: "max" });
    assert.deepEqual(next.options?.compat, applyThinkingLevelForModel(undefined, "max", model).compat);
    assert.equal((next.options?.compat?.reasoning as { effort?: string } | undefined)?.effort, "high");
  });
});

describe("ProviderRequirementError", () => {
  it("code is ERR_PRISM_PROVIDER_REQUIREMENT", () => {
    const error = new ProviderRequirementError("OpenCode Go requires sessionId", {
      requirement: "sessionId",
      providerId: "opencode-go",
    });
    assert.equal(error.code, "ERR_PRISM_PROVIDER_REQUIREMENT");
    assert.equal(error.requirement, "sessionId");
    assert.equal(error.providerId, "opencode-go");
    assert.equal(error.name, "ProviderRequirementError");
    assert.equal(error.message.includes("sk-"), false);
  });
});
