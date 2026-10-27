/**
 * Background tasks a package starts through `SessionContext.background` (roadmap §2.6). The session
 * tracks each one, reports it as `background.*` events, and settles them in `close()` within a bound,
 * then aborts the rest.
 */
import type { AgentEvent, ErrorInfo } from "../contracts.js";
export interface BackgroundTrackerOptions {
    readonly sessionId: string;
    /** Delivers a `background.*` event. Redaction is the caller's: events can fire between runs. */
    readonly emit: (event: AgentEvent) => void;
    /** An error as event data, already redacted. */
    readonly errorInfo: (error: unknown) => ErrorInfo;
}
export interface BackgroundTracker {
    /** Runs `task` and reports it. Throws once `settle` has begun: a closing session takes no new work. */
    start(owner: string | undefined, name: string, task: (signal: AbortSignal) => Promise<unknown>): void;
    /** Waits up to `timeoutMs` for running tasks, then aborts what is left and reports it `aborted`. */
    settle(timeoutMs: number): Promise<void>;
}
export declare function createBackgroundTracker(options: BackgroundTrackerOptions): BackgroundTracker;
