// scripts/provider-toolcall-conformance.test.mjs — plan 152 Task 8.
//
// Tool-call reliability catalog walk. `strict` is allowed only where a provider
// suite proves parallel calls, schema-shaped args, and empty args; all other
// tool-capable static catalog entries are deliberately explicit unknowns.
// It used to live in the retired provider-family workspace, deleted in plan 152
// Task 8, so it moved here.
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { anthropicModels } from "@arnilo/prism-provider-anthropic";
import { clinePassModels } from "@arnilo/prism-provider-clinepass";
import { commandCodeModels } from "@arnilo/prism-provider-commandcode";
import { deepseekModels } from "@arnilo/prism-provider-deepseek";
import { googleModels } from "@arnilo/prism-provider-google";
import { hyperModels } from "@arnilo/prism-provider-hyper";
import { kimiCodingModels, moonshotKimiModels } from "@arnilo/prism-provider-kimi";
import { neuralWattModels } from "@arnilo/prism-provider-neuralwatt";
import { openAICodexModels, openAIModels } from "@arnilo/prism-provider-openai";
import { openCodeGoModels } from "@arnilo/prism-provider-opencode-go";
import { xaiModels } from "@arnilo/prism-provider-xai";
import { zaiModels } from "@arnilo/prism-provider-zai";

const CATALOGS = [
  { id: "anthropic", models: anthropicModels },
  { id: "openai", models: openAIModels },
  { id: "openai-codex", models: openAICodexModels },
  { id: "google", models: googleModels },
  { id: "kimi-coding", models: kimiCodingModels },
  { id: "kimi-moonshot", models: moonshotKimiModels },
  { id: "zai", models: zaiModels },
  { id: "xai", models: xaiModels },
  { id: "deepseek", models: deepseekModels },
  { id: "hyper", models: hyperModels },
  { id: "clinepass", models: clinePassModels },
  { id: "neuralwatt", models: neuralWattModels },
  { id: "opencode-go", models: openCodeGoModels },
  { id: "commandcode", models: commandCodeModels },
];

// NeuralWatt's provider suite has the full three-part fixture. The remaining
// static catalogs are explicit unknowns until their own fixture earns a stamp.
const STRICT_CATALOGS = new Set(["neuralwatt"]);
const UNSTAMPED_UNKNOWN_CATALOGS = new Set(CATALOGS.map((catalog) => catalog.id).filter((id) => !STRICT_CATALOGS.has(id)));

describe("tool-call conformance: catalog declarations", () => {
  it("every_tools_catalog_model_is_strict_or_explicitly_unstamped_unknown", () => {
    for (const catalog of CATALOGS) {
      for (const model of catalog.models) {
        const id = `${catalog.id}:${model.model}`;
        const strictness = model.capabilities?.toolCallStrictness;
        if (model.capabilities?.tools !== true) {
          assert.equal(strictness, undefined, `${id}: non-tool model must not declare tool-call strictness`);
          continue;
        }
        if (STRICT_CATALOGS.has(catalog.id)) {
          assert.equal(strictness, "strict", `${id}: strict requires the NeuralWatt three-part fixture`);
        } else {
          assert.ok(UNSTAMPED_UNKNOWN_CATALOGS.has(catalog.id), `${id}: unstamped model must be listed as unknown`);
          assert.equal(strictness, undefined, `${id}: untested catalog must remain unknown`);
        }
      }
    }
  });

  it("accepts advisory values and treats absence as forward-compatible unknown", () => {
    const capabilities = [
      { tools: true, toolCallStrictness: "strict" },
      { tools: true, toolCallStrictness: "lenient" },
      { tools: true, toolCallStrictness: "legacy" },
      { tools: true },
    ];
    assert.equal(capabilities[3]?.toolCallStrictness, undefined);
  });
});
