import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ToolDefinition } from "@arnilo/prism";
import { AgentSdkConfigError, resolveToolPlane } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub tool for testing — execute always throws (never called). */
function stubTool(name: string, kind?: string): ToolDefinition {
  return {
    name,
    ...(kind ? { kind: kind as ToolDefinition["kind"] } : {}),
    description: `stub:${name}`,
    execute() {
      throw new Error(`stub ${name} should not execute`);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveToolPlane", () => {
  // -- empty / minimal cases ------------------------------------------------

  it("returns empty array for empty options", () => {
    const result = resolveToolPlane();
    assert.deepStrictEqual(result, []);
  });

  it("returns empty array for explicit empty options", () => {
    const result = resolveToolPlane({});
    assert.deepStrictEqual(result, []);
  });

  it("returns empty array for empty planes", () => {
    const result = resolveToolPlane({ planes: {} });
    assert.deepStrictEqual(result, []);
  });

  // -- planes ordering ------------------------------------------------------

  it("preserves plane declaration order across multiple planes", () => {
    const a1 = stubTool("a1");
    const a2 = stubTool("a2");
    const b1 = stubTool("b1");

    const result = resolveToolPlane({
      planes: {
        alpha: [a1, a2],
        beta: [b1],
      },
    });

    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["a1", "a2", "b1"],
    );
  });

  it("calls plane factories and preserves order", () => {
    const calls: string[] = [];
    const a = stubTool("a");
    const b = stubTool("b");

    const result = resolveToolPlane({
      planes: {
        first: () => {
          calls.push("first");
          return [a];
        },
        second: () => {
          calls.push("second");
          return [b];
        },
      },
    });

    assert.deepStrictEqual(calls, ["first", "second"]);
    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["a", "b"],
    );
  });

  // -- add-only (no planes) -------------------------------------------------

  it("returns add-only tools when no planes supplied", () => {
    const extra = stubTool("extra");
    const result = resolveToolPlane({ add: [extra] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "extra");
  });

  // -- exclude --------------------------------------------------------------

  it("exclude removes only the named tool; order of survivors unchanged", () => {
    const a = stubTool("shell");
    const b = stubTool("read");
    const c = stubTool("write");

    const result = resolveToolPlane({
      planes: { coding: [a, b, c] },
      exclude: ["shell"],
    });

    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["read", "write"],
    );
  });

  it("exclude removes multiple tools", () => {
    const tools = [stubTool("a"), stubTool("b"), stubTool("c"), stubTool("d")];

    const result = resolveToolPlane({
      planes: { all: tools },
      exclude: ["b", "d"],
    });

    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["a", "c"],
    );
  });

  it("unknown exclude name throws AgentSdkConfigError naming the name", () => {
    assert.throws(
      () =>
        resolveToolPlane({
          planes: { coding: [stubTool("read")] },
          exclude: ["nonexistent"],
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.strictEqual(err.code, "ERR_PRISM_AGENT_SDK_CONFIG");
        assert.ok(err.message.includes("nonexistent"));
        return true;
      },
    );
  });

  // -- replace --------------------------------------------------------------

  it("replace swaps in place at original index", () => {
    const original = stubTool("read");
    const replacement = stubTool("read");
    (replacement as { description: string }).description = "custom-read";

    const result = resolveToolPlane({
      planes: { coding: [stubTool("shell"), original, stubTool("write")] },
      replace: { read: replacement },
    });

    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["shell", "read", "write"],
    );
    // The replacement is at index 1, not the original.
    assert.strictEqual(result[1].description, "custom-read");
    assert.strictEqual(result[1], replacement);
  });

  it("mismatched replace name key fails closed", () => {
    const wrongName = stubTool("other-name");

    assert.throws(
      () =>
        resolveToolPlane({
          planes: { coding: [stubTool("read")] },
          replace: { read: wrongName },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.ok(err.message.includes("read"));
        assert.ok(err.message.includes("other-name"));
        return true;
      },
    );
  });

  it("unknown replace key throws AgentSdkConfigError naming the name", () => {
    assert.throws(
      () =>
        resolveToolPlane({
          planes: { coding: [stubTool("read")] },
          replace: { missing: stubTool("missing") },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.strictEqual(err.code, "ERR_PRISM_AGENT_SDK_CONFIG");
        assert.ok(err.message.includes("missing"));
        return true;
      },
    );
  });

  // -- add ------------------------------------------------------------------

  it("add appends after planes", () => {
    const plane = [stubTool("read"), stubTool("write")];
    const extra = stubTool("lint");

    const result = resolveToolPlane({
      planes: { coding: plane },
      add: [extra],
    });

    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["read", "write", "lint"],
    );
  });

  // -- combined pipeline: exclude + replace + add ---------------------------

  it("full pipeline: planes → exclude → replace → add", () => {
    const original = stubTool("read");
    const customRead = stubTool("read");
    (customRead as { description: string }).description = "custom";
    const hostTool = stubTool("lint");

    const result = resolveToolPlane({
      planes: {
        coding: [stubTool("shell"), original, stubTool("write"), stubTool("edit")],
      },
      exclude: ["shell"],
      replace: { read: customRead },
      add: [hostTool],
    });

    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["read", "write", "edit", "lint"],
    );
    assert.strictEqual(result[0].description, "custom");
  });

  // -- exclude + replace on the same name is fine: exclude wins -------------

  it("exclude takes precedence over replace for the same name", () => {
    // If a name is in both exclude and replace, exclude drops it first,
    // but unknown-name validation means replace must also know the name.
    // The tool is excluded; replace's entry is effectively unused but valid.
    const tools = [stubTool("a"), stubTool("b")];

    const result = resolveToolPlane({
      planes: { all: tools },
      exclude: ["a"],
      replace: { a: stubTool("a") },
    });

    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["b"],
    );
  });

  // -- duplicates are NOT resolved by the resolver --------------------------

  it("does not deduplicate — duplicates pass through for createToolRegistry", () => {
    const a1 = stubTool("dup");
    const a2 = stubTool("dup");

    const result = resolveToolPlane({
      planes: {
        first: [a1],
        second: [a2],
      },
    });

    // Both survive — deduplication is createToolRegistry's job.
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, "dup");
    assert.strictEqual(result[1].name, "dup");
  });

  it("add can introduce a name already in planes (no resolver dedupe)", () => {
    const result = resolveToolPlane({
      planes: { coding: [stubTool("read")] },
      add: [stubTool("read")],
    });

    assert.strictEqual(result.length, 2);
  });
});
