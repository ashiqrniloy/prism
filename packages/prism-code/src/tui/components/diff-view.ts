import { DiffRenderable, type RenderContext, type SyntaxStyle } from "@opentui/core";

/**
 * Unified read-only diff renderable shared by tool cards and the approval prompt.
 * `patch` must already be sanitized and size-bounded by the reducer.
 */
export function createDiffRenderable(renderer: RenderContext, patch: string, syntaxStyle?: SyntaxStyle): DiffRenderable {
  return new DiffRenderable(renderer, {
    diff: patch,
    view: "unified",
    wrapMode: "word",
    showLineNumbers: true,
    ...(syntaxStyle ? { syntaxStyle } : {}),
  });
}

export function updateDiffRenderable(renderable: DiffRenderable, patch: string): void {
  if (renderable.diff !== patch) renderable.diff = patch;
}
