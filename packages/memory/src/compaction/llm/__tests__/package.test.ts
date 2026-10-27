import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { packageConformance } from "@arnilo/prism/testing";
import { llmCompaction } from "../index.js";

describe("llm compaction package", () => {
  it("llm_compaction_passes_package_conformance", async () => {
    const result = await packageConformance(llmCompaction);
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  });
});
