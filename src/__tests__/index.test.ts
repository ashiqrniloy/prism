import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { description, name, version } from "../index.js";

describe("prism", () => {
  it("should export name and version", () => {
    assert.equal(name, "prism");
    assert.equal(version, "0.2.3");
    assert.equal(typeof description, "string");
  });
});
