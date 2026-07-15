import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertStructuredOutputRequestSupported,
  modelSupportsStructuredOutput,
  resolveRunProviderOptions,
  StructuredOutputError,
  validateStructuredOutputOptions,
} from "../structured-output.js";

const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };

describe("structured output", () => {
  it("validates schema size and prototype-pollution keys", () => {
    assert.throws(
      () => validateStructuredOutputOptions({ name: "answer", schema: { type: "object", constructor: "evil" } }),
      (error: Error) => error instanceof StructuredOutputError && error.code === "invalid_schema",
    );
    const large = "x".repeat(70_000);
    assert.throws(
      () => validateStructuredOutputOptions({ name: "answer", schema: { blob: large } }),
      (error: Error) => error instanceof StructuredOutputError && error.code === "schema_too_large",
    );
  });

  it("rejects unsupported models before provider fetch", () => {
    assert.throws(
      () => assertStructuredOutputRequestSupported(
        { provider: "demo", model: "plain", capabilities: { output: ["text"] } },
        { structuredOutput: { name: "answer", schema } },
      ),
      (error: Error) => error instanceof StructuredOutputError && error.code === "unsupported_model",
    );
    assert.ok(modelSupportsStructuredOutput({ structuredOutput: "json_schema" }));
  });

  it("merges native loop structured output into run provider options", () => {
    const merged = resolveRunProviderOptions(
      {
        loop: {
          strategy: "generate-validate-revise",
          validator: () => ({ ok: true }),
          structuredOutput: { name: "answer", schema, strict: true },
        },
      },
      {},
    );
    assert.deepEqual(merged?.structuredOutput, { name: "answer", schema, strict: true });
  });

  it("artifact-loop mode keeps provider options without injecting loop schema", () => {
    const merged = resolveRunProviderOptions(
      {
        providerOptions: { sessionId: "s1" },
        loop: {
          strategy: "generate-validate-revise",
          validator: () => ({ ok: true }),
          structuredOutput: { name: "answer", schema },
          structuredOutputMode: "artifact-loop",
        },
      },
      {},
    );
    assert.equal(merged?.structuredOutput, undefined);
    assert.equal(merged?.sessionId, "s1");
  });
});
