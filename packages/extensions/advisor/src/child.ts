import type { HookContext } from "@arnilo/prism";

/**
 * A child session (opened by `delegate` or another package through `PackageAPI.sessions.open`): the advisor skips it,
 * because an advisor per child multiplies model calls. The parent run's advisor still reviews what the child returned.
 */
export function isChildSession(context: Pick<HookContext, "session">): boolean {
  return (context.session?.depth ?? 0) > 0;
}
