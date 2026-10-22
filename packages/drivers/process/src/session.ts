import { resolve } from "node:path";
import type { JsonValue } from "@arnilo/prism";
import { DriverError, type DriverRunContext, isInside, resolveProtected } from "@arnilo/prism/driver-kit";
import type { AgentAdapter, EncodeContext, ProcessDriverConfig, ResumeContext, SessionContext } from "./adapter.js";

export async function processSession(
  adapter: AgentAdapter,
  ctx: DriverRunContext<ProcessDriverConfig>,
  context: SessionContext,
  redact: <T>(value: T) => T,
) {
  const strategy = adapter.session.strategy;
  const state = ctx.run.state("vendor-session");
  const revision = ctx.run.state("driver-revision");
  const major = /^(?:v)?(\d+)/.exec(ctx.binary.version)?.[1] ?? ctx.binary.version;
  const protectedPaths = adapter.descriptor.auth.modes
    .flatMap((mode) => mode.protected.paths)
    .map((path) => resolveProtected(path, context.home));
  const check = (value: JsonValue): void => {
    if (typeof value === "string") {
      // Plain content is opaque; declared path values are checked without opening credentials.
      const targets = [resolve(context.home, value), resolve(context.cwd, value), resolve(context.runDir.path, value)];
      if (value.startsWith("~/")) targets.push(resolveProtected(value, context.home));
      if (targets.some((target) => protectedPaths.some((path) => isInside(path, target))))
        throw new DriverError("profile_invalid", "vendor archive names a protected credential path");
    } else if (Array.isArray(value)) for (const item of value) check(item);
    else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value)) {
        check(key);
        check(item);
      }
  };
  let resume: ResumeContext = { entries: [] };
  if (strategy !== "none") {
    const versions = await revision.load();
    const prior = versions.at(-1) as { binaryMajor?: string; revision?: string } | undefined;
    const entries = await state.load();
    if (entries.length && prior && (prior.binaryMajor !== major || prior.revision !== adapter.revision))
      throw new DriverError("driver_revision_mismatch", "stored process state belongs to another binary major or adapter revision");
    if (entries.length && !prior) throw new DriverError("driver_revision_mismatch", "vendor state has no recorded driver revision");
    if (!prior || prior.binaryMajor !== major || prior.revision !== adapter.revision)
      await revision.append([{ binaryMajor: major, revision: adapter.revision }]);
    if (strategy === "vendor") {
      const sessionId = entries.at(-1);
      if (sessionId !== undefined && typeof sessionId !== "string")
        throw new DriverError("profile_invalid", "vendor session ID must be a string");
      resume = { entries, ...(typeof sessionId === "string" ? { sessionId } : {}) };
    } else if (entries.length) {
      for (const entry of entries) check(entry);
      const restore = await adapter.session.restore?.(entries, context);
      if (!restore) throw new DriverError("profile_invalid", "store resume needs session.restore");
      if (restore.overlays?.length || restore.env) throw new DriverError("profile_invalid", "restore may return only files and args");
      for (const file of restore.files ?? []) {
        check(resolve(context.runDir.path, file.path));
        await context.runDir.writeFile(file.path, file.content);
      }
      resume = { entries, ...(restore.args ? { args: restore.args } : {}) };
    }
  }
  return {
    resume,
    async archive(encoding: EncodeContext) {
      if (strategy === "none") return;
      if (strategy === "store") {
        if (!adapter.session.archive) throw new DriverError("profile_invalid", "store resume needs session.archive");
        const entries = await adapter.session.archive({ ...context, ...encoding });
        for (const entry of entries) check(entry);
        await state.append(redact(entries));
      }
    },
  };
}
