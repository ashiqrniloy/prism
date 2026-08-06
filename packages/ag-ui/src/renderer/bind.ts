/**
 * Task 14: thin DOM binding for the A2UI renderer model.
 * Host-supplied catalog component renderers (framework-free functions) and a
 * built-in default text/container set. Never executes remote HTML: only
 * `createElement`/`createTextNode`/`appendChild`; no HTML-string assignment,
 * no dynamic code evaluation.
 */
import type { AgUiA2UiAction } from "../a2ui.js";
import type { A2UiSurfaceModel } from "./core.js";
import { resolvePointer } from "./core.js";

/** Minimal DOM surface the binding needs; testable with a stub, no jsdom. */
export interface DomNode {
  readonly nodeType: number;
  readonly nodeName: string;
  textContent: string | null;
  readonly children: readonly DomNode[];
  appendChild(child: DomNode): void;
  replaceChildren(...children: DomNode[]): void;
  removeChild(child: DomNode): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface Dom {
  createElement(tag: string): DomNode;
  createTextNode(text: string): DomNode;
}

export interface A2UiRenderContext {
  readonly surfaceId: string;
  readonly dataModel: unknown;
  /** Resolve `{"path": "/pointer"}` bindings against the surface data model. */
  readonly resolve: (value: unknown) => unknown;
  /** Render a sibling component by id (children/child references). */
  readonly renderComponent: (id: string) => DomNode;
  readonly emitAction: (action: AgUiA2UiAction) => void;
}

export type A2UiComponentRenderer = (props: Readonly<Record<string, unknown>>, ctx: A2UiRenderContext, dom: Dom) => DomNode;

export type A2UiCatalog = Readonly<Record<string, A2UiComponentRenderer>>;

export interface RenderA2UiSurfaceOptions {
  readonly onAction?: (action: AgUiA2UiAction) => void;
}

const MAX_RENDER_DEPTH = 64; // mirrors HARD_MAX_A2UI_COMPONENT_DEPTH

/** Render one surface model into a detached DOM node. */
export function renderA2UiSurface(
  surface: A2UiSurfaceModel,
  catalog: A2UiCatalog,
  dom: Dom,
  options: RenderA2UiSurfaceOptions = {},
): DomNode {
  const root = dom.createElement("div");
  root.setAttribute("class", "a2ui-surface");
  root.setAttribute("data-surface-id", surface.surfaceId);

  const visited = new Set<string>();
  const ctx: A2UiRenderContext = {
    surfaceId: surface.surfaceId,
    dataModel: surface.dataModel,
    resolve: (value) => resolveBinding(value, surface.dataModel),
    renderComponent: (id) => renderComponent(id, 0),
    emitAction: (action) => options.onAction?.(action),
  };

  const placeholder = (message: string): DomNode => {
    const node = dom.createElement("div");
    node.setAttribute("class", "a2ui-placeholder");
    node.appendChild(dom.createTextNode(message));
    return node;
  };

  function renderComponent(id: string, depth: number): DomNode {
    if (depth > MAX_RENDER_DEPTH) return placeholder("component depth exceeded");
    const component = surface.components.get(id);
    if (!component) return placeholder(`missing component: ${id}`);
    if (visited.has(id)) return placeholder("circular component reference");
    visited.add(id);
    try {
      const renderer = catalog[component.type];
      if (!renderer) return placeholder(`unknown component: ${component.type}`);
      return renderer(component.props, ctx, dom);
    } finally {
      visited.delete(id);
    }
  }

  const rootComponent = surface.components.get("root");
  if (!rootComponent) {
    root.appendChild(placeholder("surface has no root component"));
    return root;
  }
  root.appendChild(renderComponent("root", 0));
  return root;
}

function resolveBinding(value: unknown, dataModel: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const path = (value as { path?: unknown }).path;
    if (typeof path === "string" && path.startsWith("/")) {
      const resolved = resolvePointer(dataModel, path);
      return resolved === undefined ? undefined : resolved;
    }
  }
  return value;
}

/** Built-in framework-free default catalog: Text, Container/Column/Row, Button. */
export const DEFAULT_A2UI_CATALOG: A2UiCatalog = {
  Text: (props, ctx, dom) => {
    const node = dom.createElement("div");
    node.setAttribute("class", "a2ui-text");
    const text = ctx.resolve(props.text);
    node.appendChild(dom.createTextNode(text === null || text === undefined ? "" : String(text)));
    return node;
  },
  Container: container("div"),
  Column: container("div"),
  Row: container("div"),
  Button: (props, ctx, dom) => {
    const node = dom.createElement("button");
    node.setAttribute("class", "a2ui-button");
    const label = ctx.resolve(props.label ?? props.text);
    node.appendChild(dom.createTextNode(label === null || label === undefined ? "" : String(label)));
    const actionName = typeof props.actionName === "string" ? props.actionName : typeof props.name === "string" ? props.name : "click";
    node.addEventListener("click", () => {
      ctx.emitAction({
        type: "a2ui-action",
        surfaceId: ctx.surfaceId,
        actionName,
        ...(props.payload === undefined ? {} : { payload: props.payload }),
      });
    });
    return node;
  },
};

function container(tag: string): A2UiComponentRenderer {
  return (props, ctx, dom) => {
    const node = dom.createElement(tag);
    node.setAttribute("class", "a2ui-container");
    const children = Array.isArray(props.children) ? props.children : props.child !== undefined ? [props.child] : [];
    for (const child of children) {
      if (typeof child === "string") node.appendChild(ctx.renderComponent(child));
    }
    return node;
  };
}
