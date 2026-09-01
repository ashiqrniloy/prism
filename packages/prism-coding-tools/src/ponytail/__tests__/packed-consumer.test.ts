import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPonytailExtension } from "../index.js";

describe("packed consumer import", () => {
  it("public_dot_export_resolves_factory", () => {
    assert.equal(typeof createPonytailExtension, "function");
  });
});
