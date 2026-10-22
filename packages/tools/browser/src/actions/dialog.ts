import { BrowserError } from "../errors.js";
import type { BrowserActRequest, BrowserActResult } from "../types.js";
import type { ActionContext, RunSession } from "./types.js";

export async function dialog(ctx: ActionContext, session: RunSession, request: BrowserActRequest): Promise<BrowserActResult> {
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, "dialog", {
    dialogResponse: request.dialogResponse ?? "dismiss",
  });
  const pending = session.pendingDialog;
  if (!pending) {
    throw new BrowserError("ERR_PRISM_BROWSER_STATE", "No pending dialog");
  }
  const response = request.dialogResponse ?? "dismiss";
  if (response === "accept") {
    ctx.assertInputBytes(request.promptText ?? "");
    await pending.accept(request.promptText);
  } else {
    await pending.dismiss();
  }
  session.pendingDialog = undefined;
  ctx.invalidateSnapshot(session);
  const page = ctx.resolvePage(session, request.pageId);
  return { ...ctx.resultFor(session, "dialog", page), dialogHandled: true };
}
