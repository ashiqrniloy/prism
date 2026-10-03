import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "bun:test";
import { packageConformance } from "@arnilo/prism/testing";
import { impeccable } from "../extension.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../fixtures/impeccable/upstream-minimal");

describe("impeccable package conformance", () => {
  it("impeccable_passes_package_conformance", async () => {
    const result = await packageConformance(impeccable({ upstreamPath: fixtureRoot }));
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  });
});
