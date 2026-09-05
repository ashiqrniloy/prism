import { BrowserError } from "../errors.js";
import { assertBrowserUrlAllowed } from "../network.js";
import type { BrowserActRequest, BrowserActResult } from "../types.js";
import type { ActionContext, RunSession } from "./types.js";

export async function navigate(
  ctx: ActionContext,
  session: RunSession,
  request: BrowserActRequest,
  signal: AbortSignal | undefined,
): Promise<BrowserActResult> {
  const url = request.url;
  if (typeof url !== "string" || !url) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "navigate requires url");
  }
  ctx.assertInputBytes(url);
  await assertBrowserUrlAllowed(url, ctx.networkPolicy);
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, "navigate", { url, pageId: request.pageId });
  await ctx.navigateActive(session, url, signal, request.pageId);
  const page = ctx.resolvePage(session, request.pageId);
  return ctx.resultFor(session, "navigate", page);
}
