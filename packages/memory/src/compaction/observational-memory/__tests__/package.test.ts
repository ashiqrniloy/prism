import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { packageConformance } from "@arnilo/prism/testing";
import { observationalMemory } from "../index.js";

describe("observational memory package conformance", () => {
  it("observational_memory_passes_package_conformance", async () => {
    const result = await packageConformance(observationalMemory());
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  });
});
