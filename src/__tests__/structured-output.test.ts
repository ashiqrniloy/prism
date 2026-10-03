import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  artifactStructuredOutputRequest,
  assertStructuredOutputRequestSupported,
  modelSupportsStructuredOutput,
  resolveRunProviderOptions,
  StructuredOutputError,
  validateStructuredOutputOptions,
  withoutStructuredOutput,
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
      () =>
        assertStructuredOutputRequestSupported(
          { provider: "demo", model: "plain", capabilities: { output: ["text"] } },
          { structuredOutput: { name: "answer", schema } },
        ),
      (error: Error) => error instanceof StructuredOutputError && error.code === "unsupported_model",
    );
    assert.ok(modelSupportsStructuredOutput({ structuredOutput: "json_schema" }));
  });

  it("merges agent and run provider options", () => {
    const merged = resolveRunProviderOptions(
      { providerOptions: { structuredOutput: { name: "answer", schema, strict: true } } },
      { providerOptions: { sessionId: "s1" } },
    );
    assert.deepEqual(merged?.structuredOutput, { name: "answer", schema, strict: true });
    assert.equal(merged?.sessionId, "s1");
  });

  it("withoutStructuredOutput strips schema only", () => {
    const request = {
      model: { provider: "demo", model: "m" },
      messages: [],
      tools: [{ name: "t", description: "t", parameters: { type: "object" }, execute: async () => ({}) }],
      options: { sessionId: "s1", structuredOutput: { name: "answer", schema } },
    };
    const stripped = withoutStructuredOutput(request as never);
    assert.equal(stripped.options?.structuredOutput, undefined);
    assert.equal(stripped.options?.sessionId, "s1");
    assert.equal(stripped.tools?.length, 1);
  });

  it("artifactStructuredOutputRequest restores schema and withdraws tools", () => {
    const request = {
      model: { provider: "demo", model: "m" },
      messages: [],
      tools: [{ name: "t", description: "t", parameters: { type: "object" }, execute: async () => ({}) }],
      options: { sessionId: "s1" },
    };
    const artifact = artifactStructuredOutputRequest(request as never, { name: "answer", schema, strict: true });
    assert.equal(artifact.tools, undefined);
    assert.deepEqual(artifact.options?.structuredOutput, { name: "answer", schema, strict: true });
    assert.equal(artifact.options?.sessionId, "s1");
  });
});
