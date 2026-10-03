/**
 * Background tasks a package starts through `SessionContext.background` (roadmap §2.6). The session
 * tracks each one, reports it as `background.*` events, and settles them in `close()` within a bound,
 * then aborts the rest.
 */
import type { AgentEvent, ErrorInfo } from "../contracts.js";
import { randomId } from "../agent-session/helpers.js";

const MAX_TASK_NAME = 128;

export interface BackgroundTrackerOptions {
  readonly sessionId: string;
  /** Delivers a `background.*` event. Redaction is the caller's: events can fire between runs. */
  readonly emit: (event: AgentEvent) => void;
  /** An error as event data, already redacted. */
  readonly errorInfo: (error: unknown) => ErrorInfo;
}

interface Running {
  readonly taskId: string;
  readonly name: string;
  readonly owner: string | undefined;
  readonly controller: AbortController;
  readonly startedAt: number;
  done: boolean;
}

export interface BackgroundTracker {
  /** Runs `task` and reports it. Throws once `settle` has begun: a closing session takes no new work. */
  start(owner: string | undefined, name: string, task: (signal: AbortSignal) => Promise<unknown>): void;
  /** Waits up to `timeoutMs` for running tasks, then aborts what is left and reports it `aborted`. */
  settle(timeoutMs: number): Promise<void>;
}

export function createBackgroundTracker(options: BackgroundTrackerOptions): BackgroundTracker {
  const running = new Set<Running>();
  const pending = new Set<Promise<void>>();
  let settling = false;

  const base = (task: Running) => ({
    sessionId: options.sessionId,
    runId: "",
    ...(task.owner === undefined ? {} : { package: task.owner }),
    name: task.name,
    taskId: task.taskId,
  });

  /** Reports a task's end once. A task that was aborted and later rejects is not reported twice. */
  const finish = (task: Running, outcome: { readonly error: unknown } | "completed" | "aborted"): void => {
    if (task.done) return;
    task.done = true;
    running.delete(task);
    if (outcome === "completed") {
      options.emit({
        type: "background.completed",
        ...base(task),
        durationMs: Math.max(0, Math.round(performance.now() - task.startedAt)),
      });
    } else if (outcome === "aborted") {
      options.emit({ type: "background.failed", ...base(task), reason: "aborted" });
    } else {
      options.emit({ type: "background.failed", ...base(task), reason: "error", error: options.errorInfo(outcome.error) });
    }
  };

  return {
    start(owner, name, task) {
      if (typeof name !== "string" || name.length === 0 || name.length > MAX_TASK_NAME) {
        throw new TypeError(`background task name must be 1-${MAX_TASK_NAME} characters`);
      }
      if (typeof task !== "function") throw new TypeError("background task must be a function");
      if (settling) throw new Error(`Session ${options.sessionId} is closing; background task ${name} was not started`);
      const entry: Running = {
        taskId: randomId("bg"),
        name,
        owner,
        controller: new AbortController(),
        startedAt: performance.now(),
        done: false,
      };
      running.add(entry);
      options.emit({ type: "background.started", ...base(entry) });
      const promise: Promise<void> = Promise.resolve()
        .then(() => task(entry.controller.signal))
        .then(
          () => finish(entry, "completed"),
          (error: unknown) => finish(entry, { error }),
        )
        .finally(() => pending.delete(promise));
      pending.add(promise);
    },

    async settle(timeoutMs) {
      settling = true;
      if (running.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      const outcome = await Promise.race([Promise.all([...pending]).then(() => "settled" as const), timedOut]);
      if (timer !== undefined) clearTimeout(timer);
      if (outcome === "settled") return;
      // The bound passed. Abort what is left and report it now: a task that ignores its signal must not hold `close()`.
      for (const task of [...running]) {
        task.controller.abort(new Error("session closed"));
        finish(task, "aborted");
      }
    },
  };
}
