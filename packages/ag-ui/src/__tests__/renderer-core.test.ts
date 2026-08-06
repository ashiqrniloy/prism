import assert from "node:assert/strict";
import { EventType, type AGUIEvent } from "@ag-ui/core";
import { describe, it } from "node:test";
import { A2UiSurfaceState, readA2UiBatch, reduceA2UiOps, resolvePointer, type A2UiSurfaceModel } from "../renderer/core.js";
import { resolveAgUiA2UiLimits } from "../a2ui.js";
import { DEFAULT_AG_UI_LIMITS } from "../limits.js";

const limits = resolveAgUiA2UiLimits({});

function op(key: string, body: unknown): Record<string, unknown> {
  return { version: "v0.9", [key]: body };
}
function createSurface(surfaceId: string, catalogId = "catalog"): Record<string, unknown> {
  return op("createSurface", { surfaceId, catalogId });
}
function updateComponents(surfaceId: string, components: unknown[]): Record<string, unknown> {
  return op("updateComponents", { surfaceId, components });
}
function updateDataModel(surfaceId: string, path: string | undefined, value: unknown): Record<string, unknown> {
  return op("updateDataModel", { surfaceId, ...(path === undefined ? {} : { path }), ...(value === undefined ? {} : { value }) });
}
function deleteSurface(surfaceId: string): Record<string, unknown> {
  return op("deleteSurface", { surfaceId });
}

function reduce(
  ops: readonly unknown[],
  replace = false,
  extra: { maxSurfacesPerRun?: number; maxOperationsPerMessage?: number; maxComponentDepth?: number } = {},
) {
  const surfaces = new Map<string, A2UiSurfaceState>();
  const result = reduceA2UiOps(surfaces, ops, resolveAgUiA2UiLimits(extra), DEFAULT_AG_UI_LIMITS, replace);
  return { surfaces, result };
}

function snapshot(surfaceId: string, ops: unknown[]): AGUIEvent {
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: `a2ui-surface-${surfaceId}-tool`,
    activityType: "a2ui-surface",
    content: { a2ui_operations: ops },
    replace: true,
  };
}
function delta(surfaceId: string, ...adds: unknown[]): AGUIEvent {
  return {
    type: EventType.ACTIVITY_DELTA,
    messageId: `a2ui-surface-${surfaceId}-tool`,
    activityType: "a2ui-surface",
    patch: adds.map((value) => ({ op: "add", path: "/a2ui_operations/-", value })),
  };
}

describe("A2UI renderer core", () => {
  it("applies a full op sequence to the model", () => {
    const { surfaces, result } = reduce([
      createSurface("chat"),
      updateComponents("chat", [
        { id: "root", component: "Column", children: ["title"] },
        { id: "title", component: "Text", text: "Hello" },
      ]),
      updateDataModel("chat", "/", { user: "alice" }),
    ]);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.changed, ["chat"]);
    const surface = surfaces.get("chat");
    assert.ok(surface);
    assert.equal(surface.catalogId, "catalog");
    assert.equal(surface.components.size, 2);
    assert.deepEqual(surface.components.get("title"), { id: "title", type: "Text", props: { text: "Hello" } });
    assert.deepEqual(surface.dataModel, { user: "alice" });
  });

  it("upserts components by id and patches the data model by JSON pointer", () => {
    const { surfaces, result } = reduce([
      createSurface("s"),
      updateComponents("s", [{ id: "root", component: "Text", text: "a" }]),
      updateDataModel("s", "/user/name", "bob"),
    ]);
    assert.equal(result.error, undefined);
    const surface = surfaces.get("s")!;
    assert.deepEqual(surface.dataModel, { user: { name: "bob" } });
    const second = reduceA2UiOps(
      surfaces,
      [updateComponents("s", [{ id: "root", component: "Text", text: "b" }])],
      limits,
      DEFAULT_AG_UI_LIMITS,
    );
    assert.equal(second.error, undefined);
    assert.equal(surfaces.get("s")!.components.size, 1, "upsert, not duplicate");
    assert.equal(surfaces.get("s")!.components.get("root")!.props.text, "b");
  });

  it("defaults data-model path to / and deletes when value is omitted", () => {
    const { surfaces } = reduce([
      createSurface("s"),
      updateDataModel("s", undefined, { a: 1, b: 2 }),
      updateDataModel("s", "/a", undefined),
    ]);
    assert.deepEqual(surfaces.get("s")!.dataModel, { b: 2 });
  });

  it("replaces a surface's model on snapshot batches (streaming cumulative ops)", () => {
    const { surfaces } = reduce(
      [createSurface("s"), updateComponents("s", [{ id: "root", component: "Text", text: "first" }]), updateDataModel("s", "/", { n: 1 })],
      true,
    );
    const result = reduceA2UiOps(
      surfaces,
      [createSurface("s"), updateComponents("s", [{ id: "root", component: "Text", text: "second" }]), updateDataModel("s", "/", { n: 2 })],
      limits,
      DEFAULT_AG_UI_LIMITS,
      true,
    );
    assert.equal(result.error, undefined);
    const surface = surfaces.get("s")!;
    assert.equal(surface.components.size, 1, "cumulative snapshot replaces, no duplicates");
    assert.equal(surface.components.get("root")!.props.text, "second");
    assert.deepEqual(surface.dataModel, { n: 2 });
  });

  it("appends ops on delta batches", () => {
    const { surfaces } = reduce([
      createSurface("s"),
      updateComponents("s", [{ id: "root", component: "Column", children: ["a"] }]),
      updateComponents("s", [{ id: "a", component: "Text", text: "x" }]),
    ]);
    const result = reduceA2UiOps(
      surfaces,
      [updateComponents("s", [{ id: "b", component: "Text", text: "y" }])],
      limits,
      DEFAULT_AG_UI_LIMITS,
    );
    assert.equal(result.error, undefined);
    assert.equal(surfaces.get("s")!.components.size, 3);
  });

  it("drops the whole batch closed on too many operations", () => {
    const ops = [createSurface("s"), updateComponents("s", [{ id: "root", component: "Text", text: "x" }])];
    const { surfaces, result } = reduce(ops, false, { maxOperationsPerMessage: 1 });
    assert.equal(result.changed.length, 0);
    assert.equal(surfaces.size, 0, "nothing partial applied");
    assert.equal(result.error!.code, "ERR_PRISM_A2UI_LIMIT");
  });

  it("drops the whole batch closed on an invalid operation", () => {
    const cases: unknown[] = [
      [createSurface("s"), { version: "v0.9", updateComponents: { components: [] } }], // missing surfaceId
      [createSurface("s"), { version: "v0.9", updateComponents: { surfaceId: 5, components: [] } }], // bad surfaceId
      [createSurface("s"), { version: "v0.9", bogus: { surfaceId: "s" } }], // unknown op key
      [{ version: "v0.9", createSurface: { surfaceId: "s" }, updateComponents: { surfaceId: "s", components: [] } }], // two keys
      [createSurface("s"), updateComponents("s", [{ id: 5, component: "Text" }])], // bad component id
    ];
    for (const ops of cases as readonly (readonly unknown[])[]) {
      const { surfaces, result } = reduce(ops);
      assert.equal(surfaces.size, 0, `case ${JSON.stringify(ops).slice(0, 80)} must not apply`);
      assert.equal(result.error!.code, "ERR_PRISM_A2UI_OP");
    }
  });

  it("fails closed on the surface cap and on excessive depth", () => {
    const { surfaces, result } = reduce([createSurface("a"), createSurface("b"), createSurface("c")], false, { maxSurfacesPerRun: 2 });
    assert.equal(result.error!.code, "ERR_PRISM_A2UI_LIMIT");
    assert.equal(surfaces.size, 0);

    const deep = { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/x", value: nest(40) } };
    const deepResult = reduce([createSurface("s"), deep], false, { maxComponentDepth: 8 });
    assert.equal(deepResult.result.error!.code, "ERR_PRISM_A2UI_OP", "op beyond component depth drops closed");
  });

  it("requires createSurface before updates and tolerates duplicate createSurface", () => {
    const { surfaces, result } = reduce([updateComponents("s", [{ id: "root", component: "Text" }])]);
    assert.equal(result.error!.code, "ERR_PRISM_A2UI_OP");
    assert.equal(surfaces.size, 0);

    const dup = reduce([createSurface("s"), createSurface("s"), updateComponents("s", [{ id: "root", component: "Text" }])]);
    assert.equal(dup.result.error, undefined);
    assert.equal(dup.surfaces.get("s")!.components.size, 1);
  });

  it("deleteSurface removes the model and is a safe no-op when absent", () => {
    const { surfaces, result } = reduce([createSurface("s"), deleteSurface("s")]);
    assert.equal(result.error, undefined);
    assert.equal(surfaces.size, 0);
    const missing = reduceA2UiOps(surfaces, [deleteSurface("s")], limits, DEFAULT_AG_UI_LIMITS);
    assert.equal(missing.error, undefined);
    assert.deepEqual(missing.changed, []);
  });

  it("readA2UiBatch extracts snapshots and deltas and ignores unrelated events", () => {
    assert.deepEqual(readA2UiBatch(snapshot("s", [createSurface("s")]))!.ops.length, 1);
    assert.equal(readA2UiBatch(snapshot("s", [createSurface("s")]))!.replace, true);
    assert.deepEqual(readA2UiBatch(delta("s", updateComponents("s", [{ id: "a", component: "Text" }])))!.ops.length, 1);
    assert.equal(readA2UiBatch(delta("s", updateComponents("s", [{ id: "a", component: "Text" }])))!.replace, false);
    assert.equal(
      readA2UiBatch({ type: EventType.ACTIVITY_SNAPSHOT, messageId: "m", activityType: "other", content: { a: 1 }, replace: true }),
      undefined,
    );
    assert.equal(
      readA2UiBatch({
        type: EventType.ACTIVITY_DELTA,
        messageId: "m",
        activityType: "a2ui-surface",
        patch: [{ op: "replace", path: "/a2ui_operations/0", value: 1 }],
      }),
      undefined,
    );
    assert.equal(readA2UiBatch({ type: EventType.TEXT_MESSAGE_START, messageId: "m", role: "assistant" }), undefined);
  });

  it("resolvePointer follows JSON pointers including escapes", () => {
    const model = { user: { name: "alice" }, list: [10, 20], "a/b": 1 };
    assert.equal(resolvePointer(model, "/user/name"), "alice");
    assert.equal(resolvePointer(model, "/list/1"), 20);
    assert.equal(resolvePointer(model, "/a~1b"), 1);
    assert.equal(resolvePointer(model, "/missing"), undefined);
    assert.equal(resolvePointer(model, "user"), undefined);
  });

  it("model snapshots reflect live state", () => {
    const { surfaces } = reduce([createSurface("s"), updateComponents("s", [{ id: "root", component: "Text", text: "hi" }])]);
    const models: A2UiSurfaceModel[] = [...surfaces.values()];
    assert.equal(models.length, 1);
    assert.equal(models[0]!.surfaceId, "s");
  });
});

function nest(depth: number): unknown {
  let value: unknown = "leaf";
  for (let i = 0; i < depth; i += 1) value = { child: value };
  return value;
}
