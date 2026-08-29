import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalizeJsonSchema } from "../providers/schema.js";

describe("canonicalizeJsonSchema", () => {
  it("sorts object keys and required names without mutating the caller", () => {
    const schema = {
      type: "object",
      required: ["z", "a"],
      properties: { z: { type: "string" }, a: { type: "number" } },
    };
    const canonical = canonicalizeJsonSchema(schema) as {
      properties: object;
      required: string[];
    };
    assert.deepEqual(Object.keys(canonical), ["properties", "required", "type"]);
    assert.deepEqual(Object.keys(canonical.properties), ["a", "z"]);
    assert.deepEqual(canonical.required, ["a", "z"]);
    assert.deepEqual(schema.required, ["z", "a"]);
    assert.deepEqual(Object.keys(schema.properties), ["z", "a"]);
  });

  it("preserves semantic array order and does not sort enum/examples/prefixItems", () => {
    const schema = {
      type: "object",
      enum: ["z", "a"],
      examples: ["keep", "order"],
      prefixItems: [{ type: "string" }, { type: "number" }],
      properties: {
        tup: { type: "array", items: [{ type: "string" }, { type: "number" }] },
      },
    };
    const canonical = canonicalizeJsonSchema(schema) as typeof schema;
    assert.deepEqual(canonical.enum, ["z", "a"]);
    assert.deepEqual(canonical.examples, ["keep", "order"]);
    assert.deepEqual(canonical.prefixItems, [{ type: "string" }, { type: "number" }]);
    assert.deepEqual(canonical.properties.tup.items, [{ type: "string" }, { type: "number" }]);
  });

  it("insertion order of properties does not change JSON.stringify", () => {
    const left = canonicalizeJsonSchema({
      type: "object",
      properties: { b: { type: "string" }, a: { type: "number" } },
      required: ["b", "a"],
    });
    const right = canonicalizeJsonSchema({
      required: ["a", "b"],
      properties: { a: { type: "number" }, b: { type: "string" } },
      type: "object",
    });
    assert.equal(JSON.stringify(left), JSON.stringify(right));
  });

  it("does not resolve $ref", () => {
    const schema = { $ref: "#/$defs/t", $defs: { t: { type: "string" } } };
    assert.deepEqual(canonicalizeJsonSchema(schema), {
      $defs: { t: { type: "string" } },
      $ref: "#/$defs/t",
    });
  });
});
