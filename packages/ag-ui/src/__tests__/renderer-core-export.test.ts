import assert from "node:assert/strict";
import { EventType, type AGUIEvent } from "@ag-ui/core";
import { describe, it } from "node:test";
// Synapta FR (0.0.27): the DOM-free core must be importable from the
// `@arnilo/prism-ag-ui/renderer` subpath entry, not just dist/renderer/core.js.
import { A2UI_VERSION, A2UiSurfaceState, createA2UiRenderer, readA2UiBatch, reduceA2UiOps, resolvePointer } from "../renderer/index.js";
import { resolveAgUiA2UiLimits } from "../a2ui.js";
import { DEFAULT_AG_UI_LIMITS } from "../limits.js";

const limits = resolveAgUiA2UiLimits({});

function event(ops: unknown[]): AGUIEvent {
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: "m1",
    activityType: "a2ui-surface",
    content: { a2ui_operations: ops },
    replace: true,
  };
}

describe("A2UI renderer subpath core exports", () => {
  it("exports the DOM-free core values from the renderer entry", () => {
    assert.equal(typeof reduceA2UiOps, "function");
    assert.equal(typeof readA2UiBatch, "function");
    assert.equal(typeof resolvePointer, "function");
    assert.equal(typeof A2UiSurfaceState, "function");
    assert.equal(A2UI_VERSION, "v0.9");
    assert.equal(typeof createA2UiRenderer, "function"); // unchanged sibling export
  });

  it("drives the surface state machine DOM-free via the subpath entry", () => {
    const surfaces = new Map<string, A2UiSurfaceState>();
    const batch = readA2UiBatch(
      event([
        { version: "v0.9", createSurface: { surfaceId: "chat", catalogId: "catalog" } },
        {
          version: "v0.9",
          updateComponents: { surfaceId: "chat", components: [{ id: "c1", component: "Text", props: { text: "hello" } }] },
        },
      ]),
    );
    assert.ok(batch);
    const result = reduceA2UiOps(surfaces, batch.ops, limits, DEFAULT_AG_UI_LIMITS, batch.replace);
    assert.equal(result.error, undefined);
    const surface = surfaces.get("chat");
    assert.ok(surface);
    assert.equal(surface.components.get("c1")?.type, "Text");
    assert.equal(resolvePointer({ hello: "world" }, "/hello"), "world");
  });
});
