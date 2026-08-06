/**
 * Task 14: reference framework-free frontend renderer for AG-UI/A2UI surfaces.
 * `createA2UiRenderer({ stream, catalog?, limits? })` consumes an AG-UI event
 * stream (SSE or in-memory AsyncIterable) and renders `a2ui-surface` activity
 * into DOM surfaces from a host component catalog, enforcing the same frozen
 * A2UI caps as the server painter.
 */
import { type AGUIEvent } from "@ag-ui/core";
import { AgUiError } from "../errors.js";
import { type AgUiA2UiLimitOptions, resolveAgUiA2UiLimits, type ResolvedAgUiA2UiLimits } from "../a2ui.js";
import { DEFAULT_AG_UI_LIMITS } from "../limits.js";
import { renderA2UiSurface, DEFAULT_A2UI_CATALOG, type A2UiCatalog, type Dom, type DomNode } from "./bind.js";
import { A2UiSurfaceState, readA2UiBatch, reduceA2UiOps, type A2UiRenderError, type A2UiSurfaceModel } from "./core.js";
export type {
  A2UiComponentModel,
  A2UiRenderError,
  A2UiSurfaceModel,
  A2UiReduceResult,
} from "./core.js";
export type { A2UiCatalog, A2UiComponentRenderer, A2UiRenderContext, Dom, DomNode, RenderA2UiSurfaceOptions } from "./bind.js";

export interface CreateA2UiRendererOptions {
  /** AG-UI event stream: SSE via `@ag-ui/client`, or any AsyncIterable. */
  readonly stream: AsyncIterable<AGUIEvent>;
  /** Host component catalog; defaults to the built-in text/container set. */
  readonly catalog?: A2UiCatalog;
  /** A2UI caps; defaults clamp into the frozen hard limits. */
  readonly limits?: AgUiA2UiLimitOptions;
  /** Receives user actions emitted by interactive catalog components. */
  readonly onAction?: (action: { type: "a2ui-action"; surfaceId: string; actionName: string; payload?: unknown }) => void;
  /** Receives bounded drop-closed error events (host logging). */
  readonly onError?: (error: A2UiRenderError) => void;
  /** DOM binding; defaults to `document` in browsers. Required to mount. */
  readonly dom?: Dom;
}

export interface A2UiRenderer {
  /** Detached DOM node for a surface, kept in sync with the stream. */
  surface(surfaceId: string): Promise<DomNode>;
  /** Snapshot of the current renderer model (DOM-free). */
  model(): readonly A2UiSurfaceModel[];
  /** Stop consuming the stream and detach all mounted surfaces. */
  dispose(): Promise<void>;
}

export function createA2UiRenderer(options: CreateA2UiRendererOptions): A2UiRenderer {
  const a2uiLimits = resolveAgUiA2UiLimits(options.limits);
  const catalog = options.catalog ?? DEFAULT_A2UI_CATALOG;
  const dom = options.dom ?? (typeof document === "undefined" ? undefined : browserDom());
  const surfaces = new Map<string, A2UiSurfaceState>();
  const mounts = new Map<string, DomNode>();
  const waiters = new Map<string, Array<() => void>>();
  let disposed = false;
  let iterator: AsyncIterator<AGUIEvent> | undefined;
  let drain: Promise<void> | undefined;

  const resolveWaiters = (surfaceId: string): void => {
    const list = waiters.get(surfaceId);
    if (!list) return;
    waiters.delete(surfaceId);
    for (const resolve of list) resolve();
  };

  const renderMount = (surfaceId: string): void => {
    const mount = mounts.get(surfaceId);
    if (!mount) return;
    const state = surfaces.get(surfaceId);
    if (!state) {
      mount.replaceChildren(); // deleteSurface detaches content
      return;
    }
    mount.replaceChildren(renderA2UiSurface(state, catalog, dom!, { onAction: options.onAction }));
  };

  const onBatch = (): void => {
    for (const surfaceId of [...mounts.keys()]) renderMount(surfaceId);
  };

  const consume = async (): Promise<void> => {
    iterator = options.stream[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done || disposed) return;
        const batch = readA2UiBatch(next.value);
        if (!batch) continue;
        const result = reduceA2UiOps(surfaces, batch.ops, a2uiLimits, DEFAULT_AG_UI_LIMITS, batch.replace);
        if (result.error) options.onError?.(result.error);
        for (const surfaceId of result.changed) resolveWaiters(surfaceId);
        onBatch();
      }
    } catch (error) {
      if (!disposed) {
        options.onError?.({
          code: "ERR_PRISM_A2UI_STREAM",
          message: error instanceof Error ? error.message : "A2UI stream failed",
        });
      }
    }
  };

  return {
    surface(surfaceId) {
      if (!dom) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "renderer requires a DOM binding (browser or options.dom)");
      const existing = mounts.get(surfaceId);
      if (existing) return Promise.resolve(existing);
      if (disposed) return Promise.reject(new AgUiError("ERR_PRISM_AG_UI_LIMIT", "renderer disposed"));
      const mount = dom.createElement("div");
      mount.setAttribute("class", "a2ui-surface-host");
      mount.setAttribute("data-surface-id", surfaceId);
      mounts.set(surfaceId, mount);
      const state = surfaces.get(surfaceId);
      if (state) {
        renderMount(surfaceId);
        return Promise.resolve(mount);
      }
      drain ??= consume();
      return new Promise<DomNode>((resolve, reject) => {
        const list = waiters.get(surfaceId) ?? [];
        list.push(() => {
          renderMount(surfaceId);
          resolve(mount);
        });
        waiters.set(surfaceId, list);
        if (disposed) {
          waiters.delete(surfaceId);
          reject(new AgUiError("ERR_PRISM_AG_UI_LIMIT", "renderer disposed"));
        }
      });
    },
    model() {
      return [...surfaces.values()];
    },
    async dispose() {
      disposed = true;
      for (const surfaceId of [...waiters.keys()]) resolveWaiters(surfaceId);
      for (const mount of mounts.values()) mount.replaceChildren();
      mounts.clear();
      if (iterator) await iterator.return?.();
      if (drain) await drain;
    },
  };
}

function browserDom(): Dom {
  const doc = document;
  return {
    createElement: (tag) => doc.createElement(tag) as unknown as DomNode,
    createTextNode: (text) => doc.createTextNode(text) as unknown as DomNode,
  };
}

