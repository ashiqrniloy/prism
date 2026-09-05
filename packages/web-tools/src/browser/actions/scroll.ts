import { BrowserError } from "../errors.js";
import { normalizeTarget, requireUniqueLocator } from "../targets.js";
import type { BrowserActRequest, BrowserActResult } from "../types.js";
import type { ActionContext, RunSession } from "./types.js";

export async function scroll(ctx: ActionContext, session: RunSession, request: BrowserActRequest): Promise<BrowserActResult> {
  const page = ctx.resolvePage(session, request.pageId);
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, "scroll", { pageId: page.pageId });
  if (request.target) {
    const target = normalizeTarget(request.target);
    const locator = await ctx.resolveTargetForAction(session, page.page, target, request.snapshotId);
    const unique = await requireUniqueLocator(locator);
    await unique.scrollIntoViewIfNeeded?.({ timeout: ctx.limits.actionTimeoutMs });
  } else if (page.page.mouse?.wheel) {
    const amount = Number.isSafeInteger(request.amount) ? Number(request.amount) : 600;
    const delta = request.direction === "up" ? -Math.abs(amount) : Math.abs(amount);
    await page.page.mouse.wheel(0, delta);
  } else {
    throw new BrowserError("ERR_PRISM_BROWSER", "scroll requires a target or page.mouse.wheel support");
  }
  ctx.invalidateSnapshot(session);
  return ctx.resultFor(session, "scroll", page);
}
