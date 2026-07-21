import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { name, version, description } from "../index.js";

describe("prism", () => {
  it("should export name and version", () => {
    assert.equal(name, "prism");
    assert.equal(version, "0.0.96");
    assert.equal(typeof description, "string");
  });
});
