/**
 * Tool-call reliability catalog walk. `strict` is allowed only where a provider
 * suite proves parallel calls, schema-shaped args, and empty args; all other
 * tool-capable static catalog entries are deliberately explicit unknowns.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelCapabilities, ModelConfig } from "@arnilo/prism";
import { anthropicModels } from "../anthropic/index.js";
import { clinePassModels } from "../clinepass/index.js";
import { commandCodeModels } from "../commandcode/index.js";
import { deepseekModels } from "../deepseek/index.js";
import { googleModels } from "../google/index.js";
import { hyperModels } from "../hyper/index.js";
import { kimiCodingModels, moonshotKimiModels } from "../kimi/index.js";
import { neuralWattModels } from "../neuralwatt/index.js";
import { openAICodexModels, openAIModels } from "../openai/index.js";
import { openCodeGoModels } from "../opencode-go/index.js";
import { xaiModels } from "../xai/index.js";
import { zaiModels } from "../zai/index.js";

interface Catalog {
  readonly id: string;
  readonly models: readonly ModelConfig[];
}

const CATALOGS: readonly Catalog[] = [
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
    const capabilities: readonly ModelCapabilities[] = [
      { tools: true, toolCallStrictness: "strict" },
      { tools: true, toolCallStrictness: "lenient" },
      { tools: true, toolCallStrictness: "legacy" },
      { tools: true },
    ];
    assert.equal(capabilities[3]?.toolCallStrictness, undefined);
  });
});
