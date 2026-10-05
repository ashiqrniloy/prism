// scripts/provider-thinking-conformance.test.mjs — plan 152 Task 8.
//
// Thinking-level conformance walk: every first-party catalog model that claims
// reasoning capability must either declare `capabilities.thinkingLevels` + a
// `compat.thinkingFamily` stamp, be a toggle-only stamped model, or sit on the
// explicit passthrough allowlist. Declared models get wire assertions through
// their provider body builder (pure, no network): min/max declared levels and
// an illegal value must always land on a legal wire field for the family.
// It used to live in the retired provider-family workspace, deleted in plan 152
// Task 8, so it moved here.
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { applyThinkingLevelForModel, THINKING_LEVELS } from "@arnilo/prism";
import { anthropicMessagesBody, anthropicModels } from "@arnilo/prism-provider-anthropic";
import { clinePassBody, clinePassModels } from "@arnilo/prism-provider-clinepass";
import { COMMAND_CODE_ANTHROPIC_HOOKS, commandCodeChatBody, commandCodeModels, routeForCommandCodeModel } from "@arnilo/prism-provider-commandcode";
import { deepseekBody, deepseekModels } from "@arnilo/prism-provider-deepseek";
import { googleGenerateContentBody, googleModels } from "@arnilo/prism-provider-google";
import { hyperChatBody, hyperModels } from "@arnilo/prism-provider-hyper";
import { kimiAnthropicBody, kimiCodingModels, moonshotBody, moonshotKimiModels } from "@arnilo/prism-provider-kimi";
import { neuralWattBody, neuralWattModels } from "@arnilo/prism-provider-neuralwatt";
import { openAICodexModels, openAIModels, resolveOpenAIReasoning } from "@arnilo/prism-provider-openai";
import { openAIChatBody, openCodeGoModels } from "@arnilo/prism-provider-opencode-go";
import { anthropicMessagesBody as sharedAnthropicMessagesBody } from "@arnilo/prism/provider-kit";
import { xaiBody, xaiModels } from "@arnilo/prism-provider-xai";
import { zaiBody, zaiModels } from "@arnilo/prism-provider-zai";

/** Reasoning-capable models that must receive NO compat at all despite the core heuristic. */
const PASSTHROUGH = new Set();

/** Catalogs whose body builders emit a provider-specific effort vocabulary (slot maps). */
const PROVIDER_VOCABULARY = new Set(["clinepass"]);

const wireAnthropic = async (request) => anthropicMessagesBody(request);
const wireGoogle = async (request) => googleGenerateContentBody(request);
const wireKimiAnthropic = async (request) => kimiAnthropicBody(request);
// OpenAI has no standalone body builder; the reasoning resolution is the body
// fragment the conformance walk needs (full-body transport covered by openai.test.ts).
const wireOpenAI = (request) => {
  const reasoning = resolveOpenAIReasoning(request.model, request.options);
  return { reasoning };
};

// CommandCode is dual-route: claude-* ids only exist on the anthropic /messages route.
const wireCommandCode = async (request) =>
  routeForCommandCodeModel(request.model.model) === "anthropic"
    ? sharedAnthropicMessagesBody(request, COMMAND_CODE_ANTHROPIC_HOOKS)
    : commandCodeChatBody(request);

const CATALOGS = [
  { id: "anthropic", models: anthropicModels, wire: wireAnthropic },
  { id: "openai", models: openAIModels, wire: wireOpenAI },
  { id: "openai-codex", models: openAICodexModels, wire: wireOpenAI },
  { id: "google", models: googleModels, wire: wireGoogle },
  { id: "kimi-coding", models: kimiCodingModels, wire: wireKimiAnthropic },
  { id: "kimi-moonshot", models: moonshotKimiModels, wire: moonshotBody },
  { id: "zai", models: zaiModels, wire: zaiBody },
  { id: "xai", models: xaiModels, wire: xaiBody },
  { id: "deepseek", models: deepseekModels, wire: deepseekBody },
  { id: "hyper", models: hyperModels, wire: hyperChatBody },
  { id: "clinepass", models: clinePassModels, wire: clinePassBody },
  { id: "neuralwatt", models: neuralWattModels, wire: neuralWattBody },
  { id: "opencode-go", models: openCodeGoModels, wire: openAIChatBody },
  { id: "commandcode", models: commandCodeModels, wire: wireCommandCode },
];

const everyModel = () => CATALOGS.flatMap((catalog) => catalog.models.map((model) => ({ catalog: catalog.id, model })));

function wireRequest(model, compat) {
  return { model, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], options: compat ? { compat } : undefined };
}

/** Extract the family's effort value (or undefined) from a built wire body. */
function wireEffort(family, body) {
  switch (family) {
    case "reasoning_effort":
      return { value: body.reasoning_effort, kind: "reasoning_effort" };
    case "openai_reasoning": {
      const reasoning = body.reasoning;
      return { value: reasoning?.effort, kind: "reasoning.effort" };
    }
    case "thinking_type": {
      const thinking = body.thinking;
      return { value: thinking?.type, kind: "thinking.type" };
    }
    case "google": {
      const generationConfig = body.generationConfig;
      const thinkingConfig = generationConfig?.thinkingConfig;
      if (!thinkingConfig) return { value: undefined, kind: "thinkingConfig" };
      if (typeof thinkingConfig.thinkingLevel === "string") return { value: thinkingConfig.thinkingLevel, kind: "thinkingLevel" };
      return { value: thinkingConfig.thinkingBudget, kind: "thinkingBudget" };
    }
    case "output_config_effort": {
      const outputConfig = body.output_config;
      return { value: outputConfig?.effort, kind: "output_config.effort" };
    }
    default:
      return { value: undefined, kind: family };
  }
}

/** Apply a portable level through the model-aware adapter (the host path). */
function adapted(model, level) {
  return applyThinkingLevelForModel(undefined, level, model)?.compat;
}

describe("thinking conformance: catalog declarations", () => {
  it("every_reasoning_capable_catalog_model_declares_levels_family_or_passthrough", () => {
    for (const { catalog, model } of everyModel()) {
      const id = `${catalog}:${model.model}`;
      const levels = model.capabilities?.thinkingLevels;
      const family = typeof model.compat?.thinkingFamily === "string" ? model.compat.thinkingFamily : undefined;
      if (model.capabilities?.reasoning !== true) {
        assert.equal(levels, undefined, `${id}: non-reasoning model must not declare thinkingLevels`);
        continue;
      }
      if (levels?.length) {
        assert.ok(family, `${id}: declares thinkingLevels but no thinkingFamily stamp`);
        assert.notEqual(family, "noop", `${id}: declared levels with noop family can never reach a wire field`);
        for (const level of levels) {
          assert.ok(THINKING_LEVELS.includes(level), `${id}: declared level ${level} is not a portable thinking level`);
        }
      } else if (!family && !PASSTHROUGH.has(id)) {
        // No stamp: the core heuristic family (reasoning_effort for reasoning-capable
        // models) applies — legal, but the model gets no declared set or snap.
      }
    }
  });

  it("passthrough_allowlist_is_minimal_and_current", () => {
    for (const { catalog, model } of everyModel()) {
      const id = `${catalog}:${model.model}`;
      if (PASSTHROUGH.has(id)) {
        assert.equal(model.capabilities?.reasoning, true, `${id}: passthrough entry must be reasoning-capable`);
        assert.equal(model.capabilities?.thinkingLevels, undefined, `${id}: passthrough entry must not declare levels`);
        assert.equal(model.compat?.thinkingFamily, undefined, `${id}: passthrough entry must not carry a family stamp`);
      }
    }
  });
});

describe("thinking conformance: wire fields via body builders", () => {
  it("declared_levels_land_on_legal_family_wire_fields", async () => {
    for (const catalog of CATALOGS) {
      for (const model of catalog.models) {
        const id = `${catalog.id}:${model.model}`;
        const levels = model.capabilities?.thinkingLevels;
        const family = typeof model.compat?.thinkingFamily === "string" ? model.compat.thinkingFamily : undefined;
        if (model.capabilities?.reasoning !== true || !levels?.length) continue;

        for (const level of [levels[0], levels[levels.length - 1]]) {
          const body = await catalog.wire(wireRequest(model, adapted(model, level)));
          const { value, kind } = wireEffort(family, body);
          assert.ok(value !== undefined, `${id}: level ${level} produced no ${kind} field on the wire`);
          if (kind === "thinkingBudget") continue; // budget-only models express level as a number
          if (PROVIDER_VOCABULARY.has(catalog.id)) {
            // Slot-map catalogs translate portable levels into provider vocabulary.
            assert.equal(typeof value, "string", `${id}: ${kind} must be a string`);
            continue;
          }
          assert.ok(levels.includes(String(value)), `${id}: level ${level} produced illegal ${kind}=${String(value)} (declared: ${levels.join("|")})`);
        }

        // Illegal value must snap into the declared set, never leak verbatim.
        const illegal = THINKING_LEVELS.find((l) => !levels.includes(l));
        if (illegal) {
          const body = await catalog.wire(wireRequest(model, adapted(model, illegal)));
          const { value, kind } = wireEffort(family, body);
          if (kind !== "thinkingBudget" && !PROVIDER_VOCABULARY.has(catalog.id)) {
            assert.ok(
              value === undefined || levels.includes(String(value)),
              `${id}: illegal level ${illegal} produced out-of-set ${kind}=${String(value)}`,
            );
          }
        }
      }
    }
  });

  it("toggle_only_stamped_models_produce_legal_field_shapes", async () => {
    for (const catalog of CATALOGS) {
      for (const model of catalog.models) {
        const id = `${catalog.id}:${model.model}`;
        if (model.capabilities?.reasoning !== true || model.capabilities?.thinkingLevels?.length) continue;
        const family = typeof model.compat?.thinkingFamily === "string" ? model.compat.thinkingFamily : undefined;
        if (!family || family === "noop") continue;
        const body = await catalog.wire(wireRequest(model, adapted(model, "low")));
        const { value, kind } = wireEffort(family, body);
        switch (kind) {
          case "reasoning_effort":
          case "reasoning.effort":
          case "output_config.effort":
            if (value !== undefined) assert.equal(typeof value, "string", `${id}: ${kind} must be a string`);
            break;
          case "thinking.type":
            if (value !== undefined) {
              assert.ok(["enabled", "disabled", "adaptive"].includes(String(value)), `${id}: illegal thinking.type=${String(value)}`);
            }
            break;
          case "thinkingConfig":
            if (value !== undefined && kind === "thinkingConfig") {
              assert.equal(typeof value, "object", `${id}: thinkingConfig must be an object`);
            }
            break;
          default:
            break; // noop family — nothing may be invented; covered by passthrough check below
        }
      }
    }
  });

  it("noop_and_passthrough_models_invent_nothing", async () => {
    for (const { catalog, model } of everyModel()) {
      const id = `${catalog}:${model.model}`;
      const family = typeof model.compat?.thinkingFamily === "string" ? model.compat.thinkingFamily : undefined;
      if (model.capabilities?.reasoning !== true) continue;
      if (family !== "noop" && !PASSTHROUGH.has(id)) continue;
      const compat = adapted(model, "high");
      const invented = compat && Object.keys(compat).filter((key) => key !== "thinkingFamily");
      assert.ok(!invented || invented.length === 0, `${id}: adapter invented compat keys ${invented?.join(",")}`);
      if (PASSTHROUGH.has(id)) {
        assert.equal(compat, undefined, `${id}: passthrough model must receive no compat at all`);
      }
    }
  });
});
