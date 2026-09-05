import { BrowserError } from "../errors.js";
import { normalizeTarget, requireUniqueLocator } from "../targets.js";
import type { BrowserActionName, BrowserActRequest, BrowserActResult, PlaywrightLocator } from "../types.js";
import type { ActionContext, ActionHandler, RunSession } from "./types.js";

async function withLocator(
  ctx: ActionContext,
  session: RunSession,
  request: BrowserActRequest,
  action: BrowserActionName,
  run: (unique: PlaywrightLocator, timeout: number) => Promise<void>,
): Promise<BrowserActResult> {
  const page = ctx.resolvePage(session, request.pageId);
  if (!request.target) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `${action} requires target`);
  }
  const target = normalizeTarget(request.target);
  if ("ref" in target && !request.snapshotId) {
    throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "ref actions require snapshotId");
  }
  const locator = await ctx.resolveTargetForAction(session, page.page, target, request.snapshotId);
  const unique = await requireUniqueLocator(locator);
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, action, { pageId: page.pageId });
  await run(unique, ctx.limits.actionTimeoutMs);
  ctx.invalidateSnapshot(session);
  return ctx.resultFor(session, action, page);
}

function requireText(text: unknown): string {
  if (typeof text !== "string") {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "text is required");
  }
  return text;
}

export const click: ActionHandler = (ctx, session, request) =>
  withLocator(ctx, session, request, "click", (unique, timeout) => unique.click({ timeout }));

export const fill: ActionHandler = (ctx, session, request) =>
  withLocator(ctx, session, request, "fill", async (unique, timeout) => {
    const text = requireText(request.text);
    ctx.assertInputBytes(text);
    await unique.fill(text, { timeout });
  });

export const type: ActionHandler = (ctx, session, request) =>
  withLocator(ctx, session, request, "type", async (unique, timeout) => {
    const text = requireText(request.text);
    ctx.assertInputBytes(text);
    if (unique.pressSequentially) await unique.pressSequentially(text, { timeout });
    else if (unique.type) await unique.type(text, { timeout });
    else await unique.fill(text, { timeout });
  });

export const select: ActionHandler = (ctx, session, request) =>
  withLocator(ctx, session, request, "select", async (unique, timeout) => {
    const values = request.values;
    if (!values || values.length === 0) {
      throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "select requires values");
    }
    for (const v of values) ctx.assertInputBytes(v);
    await unique.selectOption([...values], { timeout });
  });

export const check: ActionHandler = (ctx, session, request) =>
  withLocator(ctx, session, request, "check", (unique, timeout) => unique.check({ timeout }));

export const uncheck: ActionHandler = (ctx, session, request) =>
  withLocator(ctx, session, request, "uncheck", (unique, timeout) => unique.uncheck({ timeout }));
