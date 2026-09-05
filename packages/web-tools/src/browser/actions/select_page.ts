import { BrowserError } from "../errors.js";
import type { BrowserActRequest, BrowserActResult } from "../types.js";
import type { ActionContext, RunSession } from "./types.js";

export async function selectPage(ctx: ActionContext, session: RunSession, request: BrowserActRequest): Promise<BrowserActResult> {
  const id = request.pageId;
  if (typeof id !== "string" || !id) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "select_page requires pageId");
  }
  const page = session.pages.get(id);
  if (!page || page.closed) {
    throw new BrowserError("ERR_PRISM_BROWSER_STATE", `Unknown or closed pageId ${id}`);
  }
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, "select_page", {
    pageId: id,
    pageKind: page.kind,
  });
  session.activePageId = id;
  return ctx.resultFor(session, "select_page", page);
}
