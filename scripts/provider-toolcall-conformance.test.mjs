// scripts/provider-toolcall-conformance.test.mjs — plan 152 Task 8.
//
// Tool-call reliability catalog walk. `strict` is allowed only where a provider
// suite proves parallel calls, schema-shaped args, and empty args; all other
// tool-capable static catalog entries are deliberately explicit unknowns.
// It used to live in the retired provider-family workspace, deleted in plan 152
// Task 8, so it moved here.
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { hyperModels } from "@arnilo/prism-provider-hyper";
import { openCodeGoModels } from "@arnilo/prism-provider-opencode-go";

const CATALOGS = [
  { id: "hyper", models: hyperModels },
  { id: "opencode-go", models: openCodeGoModels },
];

const STRICT_CATALOGS = new Set();
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
      { tools: true },
    ];
    assert.equal(capabilities[2]?.toolCallStrictness, undefined);
  });
});
