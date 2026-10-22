import { releaseDownload } from "../downloads.js";
import { BrowserError } from "../errors.js";
import type { BrowserActRequest, BrowserActResult } from "../types.js";
import type { ActionContext, RunSession } from "./types.js";

export async function downloadRelease(ctx: ActionContext, session: RunSession, request: BrowserActRequest): Promise<BrowserActResult> {
  if (!ctx.downloads) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "downloads are not configured");
  }
  const downloadId = request.downloadId ?? session.lastDownloadId;
  if (!downloadId) {
    throw new BrowserError("ERR_PRISM_BROWSER_STATE", "No downloadId available");
  }
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, "download_release", { resource: downloadId });
  const meta = await releaseDownload(downloadId, ctx.downloads, session.downloadBudget);
  const page = ctx.resolvePage(session, request.pageId);
  return {
    ...ctx.resultFor(session, "download_release", page),
    download: ctx.toDownloadInfo(meta),
  };
}
