import { captureBoundedScreenshot } from "../screenshot.js";
import type { BrowserActRequest, BrowserActResult } from "../types.js";
import type { ActionContext, RunSession } from "./types.js";

export async function screenshot(
  ctx: ActionContext,
  session: RunSession,
  request: BrowserActRequest,
  signal: AbortSignal | undefined,
): Promise<BrowserActResult> {
  const page = ctx.resolvePage(session, request.pageId);
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, "screenshot", { pageId: page.pageId, url: ctx.safeUrl(page.page) });
  const shot = await captureBoundedScreenshot({
    page: page.page,
    limits: ctx.limits,
    budget: session.screenshotBudget,
    fullPage: request.fullPage,
    clip: request.clip ? { ...request.clip } : undefined,
    signal,
  });
  return {
    ...ctx.resultFor(session, "screenshot", page),
    screenshotBytes: shot.bytes,
    image: shot.image,
  };
}
