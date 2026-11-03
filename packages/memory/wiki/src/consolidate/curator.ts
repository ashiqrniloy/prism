/**
 * The curator: the in-process state around the concept pass (plan 207 Task 6) — the per-scope lease, the attempts the
 * model answered with nothing, the turn counters that pace the background check, and the last pass for `wiki:status`.
 * `session.background` carries the automatic pass; `wiki:consolidate` runs one inline.
 */
import type { JsonObject, ModelClient, SessionContext } from "@arnilo/prism";
import type { FabricOntologyPort } from "@arnilo/prism-memory-fabric";
import { createWikiLease, runWikiPass, type WikiPassConfig, type WikiPassReport } from "./pass.js";

export const CONSOLIDATE_TASK_NAME = "wiki.consolidate";

export interface CuratorDeps {
  /** Resolved per call: the fabric may be listed after this package. */
  readonly port: () => FabricOntologyPort | undefined;
  readonly client: () => ModelClient;
  readonly config: WikiPassConfig & { readonly minIntervalTurns: number };
  /** Called with every pass that did work (a model call or a write); a quiet pass is not reported. */
  readonly onPass?: (report: WikiPassReport, session: SessionContext | undefined) => void | Promise<void>;
  /** An automatic pass failed outright (the port or the provider threw). The error is not rethrown into a turn. */
  readonly onError?: (error: unknown) => void;
  readonly now?: () => Date;
}

export interface Curator {
  /** A session opened: check for due work now, in the background. */
  opened(session: SessionContext): void;
  /** A turn completed: every `minIntervalTurns`, check for due work in the background. */
  turn(session: SessionContext): void;
  /** Forget a closed session's counter. */
  closed(sessionId: string): void;
  /** One pass now, inline. `undefined` when the fabric port is not available. */
  runNow(options?: { readonly session?: SessionContext; readonly signal?: AbortSignal }): Promise<WikiPassReport | undefined>;
  /** The last pass that did work in this process. */
  last(): WikiPassReport | undefined;
  /** Start times of this process's passes (a quiet check counts), newest first, at most {@link MAX_PASS_STARTS}. */
  passStarts(): readonly string[];
}

const MAX_PASS_STARTS = 32;

const didWork = (report: WikiPassReport): boolean => report.modelCalls > 0 || report.edits > 0 || report.binds > 0 || report.left > 0;

export function createCurator(deps: CuratorDeps): Curator {
  const lease = createWikiLease();
  const declined = new Set<string>();
  const turns = new Map<string, number>();
  let last: WikiPassReport | undefined;
  const starts: string[] = [];

  const run = async (trigger: "auto" | "manual", session: SessionContext | undefined, signal: AbortSignal | undefined) => {
    const port = deps.port();
    if (port === undefined) return undefined;
    const report = await runWikiPass({
      port,
      client: deps.client,
      config: deps.config,
      trigger,
      declined,
      lease,
      ...(deps.now === undefined ? {} : { now: deps.now() }),
      ...(session === undefined ? {} : { sessionId: session.id }),
      ...(signal === undefined ? {} : { signal }),
    });
    starts.unshift(report.at);
    if (starts.length > MAX_PASS_STARTS) starts.length = MAX_PASS_STARTS;
    if (didWork(report)) {
      last = report;
      await deps.onPass?.(report, session);
    }
    return report;
  };

  const schedule = (session: SessionContext): void => {
    session.background(CONSOLIDATE_TASK_NAME, async (signal) => {
      try {
        await run("auto", session, signal);
      } catch (error) {
        if (signal.aborted) return;
        deps.onError?.(error);
      }
    });
  };

  return {
    opened(session) {
      turns.set(session.id, 0);
      schedule(session);
    },
    turn(session) {
      const count = (turns.get(session.id) ?? 0) + 1;
      if (count < deps.config.minIntervalTurns) {
        turns.set(session.id, count);
        return;
      }
      turns.set(session.id, 0);
      schedule(session);
    },
    closed(sessionId) {
      turns.delete(sessionId);
    },
    runNow: (options = {}) => run("manual", options.session, options.signal),
    last: () => last,
    passStarts: () => [...starts],
  };
}

/** A report as plain JSON, for session state and events. */
export const reportJson = (report: WikiPassReport): JsonObject => JSON.parse(JSON.stringify(report)) as JsonObject;
