import { setTimeout as sleep } from "node:timers/promises";
import { BrowserError } from "../errors.js";
import type { BrowserActRequest, BrowserActResult } from "../types.js";
import type { ActionContext, RunSession } from "./types.js";

export async function wait(
  ctx: ActionContext,
  session: RunSession,
  request: BrowserActRequest,
  signal: AbortSignal | undefined,
): Promise<BrowserActResult> {
  ctx.chargeAction(session);
  const page = ctx.resolvePage(session, request.pageId);
  const timeout = clampTimeout(request.timeoutMs, ctx.limits.waitTimeoutMs);
  if (typeof request.url === "string" && request.url) {
    ctx.assertInputBytes(request.url);
    if (!page.page.waitForURL) {
      throw new BrowserError("ERR_PRISM_BROWSER", "Page does not support waitForURL");
    }
    await page.page.waitForURL(request.url, { timeout });
  } else if (typeof request.text === "string" && request.text) {
    ctx.assertInputBytes(request.text);
    const locator = page.page.getByText(request.text, { exact: false });
    const start = Date.now();
    while (Date.now() - start < timeout) {
      ctx.throwIfAborted(signal);
      if ((await locator.count()) > 0) break;
      await sleep(50);
    }
    if ((await locator.count()) === 0) {
      throw new BrowserError("ERR_PRISM_BROWSER", `wait text not found within ${timeout}ms`);
    }
  } else {
    await sleep(Math.min(timeout, ctx.limits.waitTimeoutMs));
  }
  return ctx.resultFor(session, "wait", page);
}

function clampTimeout(value: number | undefined, hard: number): number {
  if (value === undefined) return hard;
  if (!Number.isSafeInteger(value) || value < 1 || value > hard) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `timeoutMs must be 1..${hard}`);
  }
  return value;
}
