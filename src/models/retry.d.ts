import type { ErrorInfo, RetryDecision, RetryOptions, RetryPolicy } from "../contracts.js";
export interface DefaultRetryPolicyOptions {
    readonly name?: string;
    readonly maxAttempts?: number;
    readonly baseDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly transientCodes?: readonly (string | number)[];
    /** Symmetric jitter fraction applied to computed delays (default 0.25 → ±25%).
     *  Prevents thundering-herd retries under a shared outage. Set 0 to disable. */
    readonly jitter?: number;
    /** Random source for jitter (tests); defaults to Math.random. */
    readonly random?: () => number;
}
export declare function createDefaultRetryPolicy(options?: DefaultRetryPolicyOptions): RetryPolicy;
export declare function isTransientErrorInfo(error: ErrorInfo, transientCodes?: ReadonlySet<string | number>): boolean;
export declare function waitForRetry(decision: RetryDecision, signal?: AbortSignal): Promise<void>;
export declare function errorFromInfo(error: ErrorInfo): Error;
export declare function mergeRetry(agent: false | RetryOptions | undefined, run: false | RetryOptions | undefined): RetryOptions | undefined;
export interface RetryLoopOptions {
    readonly retry: RetryOptions | undefined;
    readonly sessionId: string;
    readonly runId: string;
    readonly signal?: AbortSignal;
    /** Failures that skip retry entirely and propagate unchanged (guardrails, a steer interrupt). */
    readonly passthrough?: (error: unknown) => boolean;
    /** The redacted failure, and whether it is final (an already-observable failure is never retried). */
    readonly classify: (error: unknown) => {
        readonly info: ErrorInfo;
        readonly final?: boolean;
    };
    /** Called after the policy decided to retry and before the wait. */
    readonly onRetry?: (info: ErrorInfo, delayMs: number, attempt: number) => void;
}
/**
 * The one retry loop: runs `attempt` until it succeeds, the policy says stop, or the failure is final.
 * Used by run turns (`generateWithRetry`) and by `models.client`, so both honor the same `RetryOptions`.
 */
export declare function retryLoop<T>(attempt: (n: number) => Promise<T>, options: RetryLoopOptions): Promise<T>;
