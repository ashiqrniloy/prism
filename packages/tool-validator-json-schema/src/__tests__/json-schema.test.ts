import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry, dispatchToolCall } from "@arnilo/prism";
import type { JsonObject, ToolArgumentValidator, ToolDefinition } from "@arnilo/prism";
import {
  createJsonSchemaArgumentValidator,
  createJsonSchemaToolArgumentValidator,
} from "../json-schema.js";

const context = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };

function echoTool(parameters?: ToolDefinition["parameters"]): ToolDefinition {
  return {
    name: "echo",
    parameters,
    execute(args, ctx) {
      return { toolCallId: ctx.toolCallId, name: "echo", value: args };
    },
  };
}

describe("createJsonSchemaArgumentValidator", () => {
  const schema = {
    type: "object",
    properties: { text: { type: "string" }, count: { type: "number" } },
    required: ["text"],
    additionalProperties: false,
  } satisfies JsonObject;

  it("accepts valid arguments", () => {
    const validator = createJsonSchemaArgumentValidator();
    const result = validator.validate(schema, { text: "hi", count: 2 });
    assert.equal(result.ok, true);
  });

  it("rejects missing required fields", () => {
    const validator = createJsonSchemaArgumentValidator();
    const result = validator.validate(schema, { count: 2 });
    assert.equal(result.ok, false);
    assert.match(result.errors?.[0]?.message ?? "", /required/i);
  });

  it("rejects additional properties when schema forbids them", () => {
    const validator = createJsonSchemaArgumentValidator();
    const result = validator.validate(schema, { text: "hi", extra: true });
    assert.equal(result.ok, false);
  });

  it("rejects remote schema refs", () => {
    const validator = createJsonSchemaArgumentValidator();
    const result = validator.validate(
      { type: "object", properties: { x: { $ref: "https://example.com/schema.json" } } },
      { x: 1 },
    );
    assert.equal(result.ok, false);
    assert.match(result.errors?.[0]?.message ?? "", /remote \$ref/i);
  });

  it("rejects prototype-pollution keys in schemas", () => {
    const validator = createJsonSchemaArgumentValidator();
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"object"}}}');
    const result = validator.validate(schema, {});
    assert.equal(result.ok, false);
    assert.match(result.errors?.[0]?.message ?? "", /forbidden JSON key/i);
  });

  it("rejects oversized argument strings", () => {
    const validator = createJsonSchemaArgumentValidator({ maxStringLength: 4 });
    const result = validator.validate({ type: "object" }, { text: "toolong" });
    assert.equal(result.ok, false);
    assert.match(result.errors?.[0]?.message ?? "", /maximum length/i);
  });

  it("reuses compiled validators for identical schemas", () => {
    const validator = createJsonSchemaArgumentValidator();
    assert.equal(validator.validate(schema, { text: "a" }).ok, true);
    assert.equal(validator.validate(schema, { text: "b" }).ok, true);
    assert.equal(validator.validate({ ...schema }, { text: "c" }).ok, true);
  });

  it("returns compile errors for malformed schemas", () => {
    const validator = createJsonSchemaArgumentValidator();
    const result = validator.validate({ type: "object", properties: { x: { type: "not-a-type" } } }, { x: 1 });
    assert.equal(result.ok, false);
    assert.ok(result.errors?.[0]?.message);
  });
});

describe("createJsonSchemaToolArgumentValidator", () => {
  it("blocks dispatch before execute when arguments are invalid", async () => {
    let called = false;
    const registry = createToolRegistry([
      {
        ...echoTool({
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        }),
        execute: () => {
          called = true;
          return { toolCallId: "call_1", name: "echo" };
        },
      },
    ]);
    const validate = createJsonSchemaToolArgumentValidator();
    const result = await dispatchToolCall({
      call: { type: "tool_call", id: "call_1", name: "echo", arguments: {} },
      registry,
      context,
      validate,
    });

    assert.match(result.error?.message ?? "", /required/i);
    assert.equal(called, false);
  });

  it("allows tools without parameters by default", async () => {
    let called = false;
    const registry = createToolRegistry([
      {
        ...echoTool(),
        execute: () => {
          called = true;
          return { toolCallId: "call_1", name: "echo", value: {} };
        },
      },
    ]);
    const result = await dispatchToolCall({
      call: { type: "tool_call", id: "call_1", name: "echo", arguments: {} },
      registry,
      context,
      validate: createJsonSchemaToolArgumentValidator(),
    });

    assert.equal(result.error, undefined);
    assert.equal(called, true);
  });

  it("rejects tools without parameters when missingSchema is reject", async () => {
    const registry = createToolRegistry([echoTool()]);
    const result = await dispatchToolCall({
      call: { type: "tool_call", id: "call_1", name: "echo", arguments: {} },
      registry,
      context,
      validate: createJsonSchemaToolArgumentValidator({ missingSchema: "reject" }),
    });

    assert.match(result.error?.message ?? "", /no parameters schema/i);
  });

  it("composes with a host validator via adapter reuse", async () => {
    const adapter: ToolArgumentValidator = createJsonSchemaArgumentValidator();
    const registry = createToolRegistry([
      echoTool({ type: "object", properties: { text: { type: "string" } }, required: ["text"] }),
    ]);
    const result = await dispatchToolCall({
      call: { type: "tool_call", id: "call_1", name: "echo", arguments: { text: "ok" } },
      registry,
      context,
      validate: (tool, args) => {
        const check = adapter.validate(tool.parameters!, args);
        return check.ok ? undefined : check.errors?.[0]?.message;
      },
    });

    assert.equal(result.error, undefined);
    assert.deepEqual(result.value, { text: "ok" });
  });
});
