import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventType, type AGUIEvent } from "@ag-ui/core";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createA2UiRenderer } from "../renderer/index.js";
import { DEFAULT_A2UI_CATALOG, renderA2UiSurface, type Dom, type DomNode } from "../renderer/bind.js";
import { A2UiSurfaceState, reduceA2UiOps } from "../renderer/core.js";
import { resolveAgUiA2UiLimits } from "../a2ui.js";
import { DEFAULT_AG_UI_LIMITS } from "../limits.js";

const limits = resolveAgUiA2UiLimits({});

/** Minimal in-memory DOM stub: no jsdom, no browser. */
class StubNode implements DomNode {
  nodeType = 1;
  nodeName = "STUB";
  textContent: string | null = null;
  children: StubNode[] = [];
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, (event: unknown) => void>();
  appendChild(child: DomNode): void {
    this.children.push(child as StubNode);
  }
  replaceChildren(...children: DomNode[]): void {
    this.children = children.map((c) => c as StubNode);
  }
  removeChild(child: DomNode): void {
    this.children = this.children.filter((c) => c !== child);
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, listener);
  }
  get text(): string {
    return this.children.map((c) => (c.nodeType === 3 ? (c.textContent ?? "") : c.text)).join("");
  }
  get first(): StubNode | undefined {
    return this.children[0];
  }
  click(): void {
    this.listeners.get("click")?.({ type: "click" });
  }
}

const stubDom: Dom = {
  createElement: () => new StubNode(),
  createTextNode: (text) => {
    const node = new StubNode();
    node.nodeType = 3;
    node.nodeName = "#text";
    node.textContent = text;
    return node;
  },
};

function model(surfaceId: string, components: unknown[], dataModel?: unknown): A2UiSurfaceState {
  const surfaces = new Map<string, A2UiSurfaceState>();
  const ops: unknown[] = [
    { version: "v0.9", createSurface: { surfaceId, catalogId: "catalog" } },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];
  if (dataModel !== undefined) ops.push({ version: "v0.9", updateDataModel: { surfaceId, path: "/", value: dataModel } });
  reduceA2UiOps(surfaces, ops, limits, DEFAULT_AG_UI_LIMITS, true);
  return surfaces.get(surfaceId)!;
}

function snapshot(surfaceId: string, ops: unknown[]): AGUIEvent {
  return { type: EventType.ACTIVITY_SNAPSHOT, messageId: `a2ui-surface-${surfaceId}-tool`, activityType: "a2ui-surface", content: { a2ui_operations: ops }, replace: true };
}
function delta(surfaceId: string, ...adds: unknown[]): AGUIEvent {
  return { type: EventType.ACTIVITY_DELTA, messageId: `a2ui-surface-${surfaceId}-tool`, activityType: "a2ui-surface", patch: adds.map((value) => ({ op: "add", path: "/a2ui_operations/-", value })) };
}

describe("A2UI renderer binding", () => {
  it("renders the default catalog with text, containers, and data bindings", () => {
    const surface = model("chat", [
      { id: "root", component: "Column", children: ["title", "body"] },
      { id: "title", component: "Text", text: { path: "/title" } },
      { id: "body", component: "Text", text: "plain" },
    ], { title: "Bound!" });
    const node = renderA2UiSurface(surface, DEFAULT_A2UI_CATALOG, stubDom) as StubNode;
    assert.equal(node.attrs.get("data-surface-id"), "chat");
    assert.equal(node.text, "Bound!plain");
  });

  it("renders unknown and missing components as explicit placeholders, never raw HTML", () => {
    const surface = model("s", [
      { id: "root", component: "Column", children: ["weird", "ghost"] },
      { id: "weird", component: "Marquee", html: "<img src=x onerror=alert(1)>" },
    ]);
    const node = renderA2UiSurface(surface, DEFAULT_A2UI_CATALOG, stubDom) as StubNode;
    assert.ok(node.text.includes("unknown component: Marquee"));
    assert.ok(node.text.includes("missing component: ghost"));
    assert.ok(!node.text.includes("<img"), "component payload must never become HTML");
  });

  it("detects circular component references", () => {
    const surface = model("s", [
      { id: "root", component: "Column", children: ["a"] },
      { id: "a", component: "Column", children: ["root"] },
    ]);
    const node = renderA2UiSurface(surface, DEFAULT_A2UI_CATALOG, stubDom) as StubNode;
    assert.ok(node.text.includes("circular component reference"));
  });

  it("emits actions from the default Button", () => {
    const surface = model("s", [{ id: "root", component: "Button", label: "Go", actionName: "go", payload: { x: 1 } }]);
    const actions: unknown[] = [];
    const node = renderA2UiSurface(surface, DEFAULT_A2UI_CATALOG, stubDom, { onAction: (a) => actions.push(a) }) as StubNode;
    node.first!.click();
    assert.deepEqual(actions, [{ type: "a2ui-action", surfaceId: "s", actionName: "go", payload: { x: 1 } }]);
  });

  it("uses host catalog component renderers", () => {
    const surface = model("s", [{ id: "root", component: "MyWidget", value: 42 }]);
    const node = renderA2UiSurface(
      surface,
      {
        MyWidget: (props) => {
          const el = stubDom.createElement("span");
          el.appendChild(stubDom.createTextNode(`host-${String(props.value)}`));
          return el;
        },
      },
      stubDom,
    );
    assert.equal((node as StubNode).text, "host-42");
  });

  it("renders surfaces that lack a root component as a placeholder", () => {
    const surface = model("s", [{ id: "other", component: "Text", text: "x" }]);
    const node = renderA2UiSurface(surface, DEFAULT_A2UI_CATALOG, stubDom) as StubNode;
    assert.ok(node.text.includes("no root component"));
  });

  it("createA2UiRenderer consumes the stream, mounts on demand, and tracks updates", async () => {
    const events: AGUIEvent[] = [
      snapshot("chat", [
        { version: "v0.9", createSurface: { surfaceId: "chat", catalogId: "catalog" } },
        { version: "v0.9", updateComponents: { surfaceId: "chat", components: [{ id: "root", component: "Text", text: "one" }] } },
      ]),
      delta("chat", { version: "v0.9", updateComponents: { surfaceId: "chat", components: [{ id: "root", component: "Text", text: "two" }] } }),
      delta("chat", { version: "v0.9", deleteSurface: { surfaceId: "chat" } }),
    ];
    const renderer = createA2UiRenderer({ stream: asyncGenerator(events), dom: stubDom, onError: () => assert.fail("no errors expected") });
    const mount = (await renderer.surface("chat")) as StubNode;
    await tick();
    assert.equal(mount.text, "two", "snapshot then delta both applied");
    await tick();
    assert.equal(mount.children.length, 0, "deleteSurface detaches content");
    assert.equal(renderer.model().length, 0);
    await renderer.dispose();
  });

  it("drops oversized/invalid streams closed and never throws host-uncaught", async () => {
    const errors: { code: string }[] = [];
    const events: AGUIEvent[] = [
      snapshot("s", [
        { version: "v0.9", createSurface: { surfaceId: "s" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Text", text: "ok" }] } },
      ]),
      snapshot("s", [
        { version: "v0.9", createSurface: { surfaceId: "s" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Text" }] } },
        { version: "v0.9", bogus: { surfaceId: "s" } },
      ]),
      delta("s", { version: "v0.9", updateComponents: { surfaceId: "nope", components: [] } }),
    ];
    const renderer = createA2UiRenderer({ stream: asyncGenerator(events), dom: stubDom, onError: (e) => errors.push(e) });
    const mount = (await renderer.surface("s")) as StubNode;
    await tick();
    await tick();
    await tick();
    assert.equal(mount.text, "ok", "valid batch applied, invalid batch dropped whole");
    assert.deepEqual(errors.map((e) => e.code), ["ERR_PRISM_A2UI_OP", "ERR_PRISM_A2UI_OP"]);
    await renderer.dispose();
  });

  it("a stream that throws reports via onError and stops cleanly", async () => {
    const errors: { code: string }[] = [];
    const renderer = createA2UiRenderer({
      stream: (async function* () {
        yield snapshot("s", [{ version: "v0.9", createSurface: { surfaceId: "s" } }]);
        throw new Error("boom");
      })(),
      dom: stubDom,
      onError: (e) => errors.push(e),
    });
    await renderer.surface("s");
    await tick();
    assert.equal(errors[0]?.code, "ERR_PRISM_A2UI_STREAM");
    await renderer.dispose();
  });

  it("source never uses innerHTML or eval for model content", () => {
    const dir = fileURLToPath(new URL("../../src/renderer/", import.meta.url));
    for (const file of ["core.ts", "bind.ts", "index.ts"]) {
      const source = readFileSync(`${dir}${file}`, "utf8");
      assert.ok(!source.includes("innerHTML"), `${file} must not use innerHTML`);
      assert.ok(!source.includes("eval("), `${file} must not use eval`);
      assert.ok(!source.includes("document.write"), `${file} must not use document.write`);
    }
  });
});

async function* asyncGenerator(events: AGUIEvent[]): AsyncGenerator<AGUIEvent> {
  for (const event of events) {
    yield event;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
