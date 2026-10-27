/**
 * Timeline projection is the only reason evals needs `@arnilo/prism-observability`, so it is an
 * optional peer loaded on demand. A host that scores text only never installs it, and a host that
 * asks for a timeline without it gets a named error instead of a module-resolution stack.
 */
import { EvalError } from "./errors.js";

type Observability = typeof import("@arnilo/prism-observability");

/** The two projections evals needs from the optional peer. */
export type TimelineTools = Pick<Observability, "createTimelineFolder" | "projectTraceTimeline">;

const TIMELINE_PACKAGE = "@arnilo/prism-observability";

let importer = (): Promise<Observability> => import("@arnilo/prism-observability");

/** @internal Test seam: production always resolves through this module's literal import. */
export function setTimelineImporterForTests(next?: () => Promise<Observability>): void {
  importer = next ?? ((): Promise<Observability> => import("@arnilo/prism-observability"));
}

/**
 * Load the optional observability peer. Called only on the timeline path, so text-only scoring and
 * experiments never touch it.
 */
export async function loadTimeline(): Promise<TimelineTools> {
  let module: Observability;
  try {
    module = await importer();
  } catch (cause) {
    throw new EvalError(
      `timeline projection requires the optional peer ${TIMELINE_PACKAGE}; install it to score timelines`,
      "ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE",
      { cause },
    );
  }
  return { createTimelineFolder: module.createTimelineFolder, projectTraceTimeline: module.projectTraceTimeline };
}
