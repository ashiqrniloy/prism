import { BrowserError } from "../errors.js";
import { normalizeTarget, requireUniqueLocator } from "../targets.js";
import type { BrowserActRequest, BrowserActResult } from "../types.js";
import { approveUploadPaths } from "../uploads.js";
import type { ActionContext, RunSession } from "./types.js";

export async function upload(ctx: ActionContext, session: RunSession, request: BrowserActRequest): Promise<BrowserActResult> {
  if (!ctx.uploads) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "uploads are not configured");
  }
  const page = ctx.resolvePage(session, request.pageId);
  if (!request.target) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "upload requires target");
  }
  const paths = request.paths;
  if (!paths || paths.length === 0) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "upload requires paths");
  }
  for (const p of paths) ctx.assertInputBytes(p);
  const approved = await approveUploadPaths(paths, ctx.uploads, ctx.limits, session.uploadBudget);
  const target = normalizeTarget(request.target);
  if ("ref" in target && !request.snapshotId) {
    throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "ref actions require snapshotId");
  }
  const locator = await ctx.resolveTargetForAction(session, page.page, target, request.snapshotId);
  const unique = await requireUniqueLocator(locator);
  if (typeof unique.setInputFiles !== "function") {
    throw new BrowserError("ERR_PRISM_BROWSER", "Locator.setInputFiles is unavailable");
  }
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, "upload", {
    pageId: page.pageId,
    paths: approved.map((f) => f.path),
  });
  await unique.setInputFiles(
    approved.map((f) => f.path),
    { timeout: ctx.limits.actionTimeoutMs },
  );
  ctx.invalidateSnapshot(session);
  return {
    ...ctx.resultFor(session, "upload", page),
    uploads: approved.map((f) => ({ path: f.name, bytes: f.bytes, sha256: f.sha256 })),
  };
}
