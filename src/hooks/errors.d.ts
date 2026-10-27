/** A hook threw, or a registration/option was invalid. Names the owner and hook. */
export declare class HookError extends Error {
    readonly code: string;
    readonly owner: string;
    readonly hook: string;
    constructor(message: string, options: {
        readonly owner: string;
        readonly hook: string;
        readonly code?: string;
    });
}
/** A transform handler stopped the chain with `ctx.reject(reason)`. */
export declare class HookRejectedError extends Error {
    readonly code = "ERR_PRISM_HOOK_REJECTED";
    readonly owner: string;
    readonly hook: string;
    readonly reason: string;
    constructor(reason: string, owner: string, hook: string);
}
/** A registration or dispatch named a hook outside the catalog. */
export declare class UnknownHookError extends Error {
    readonly code = "ERR_PRISM_UNKNOWN_HOOK";
    readonly hook: string;
    constructor(hook: string);
}
/** `tool.execute` is wrap-only: a handler that replaces the call's name or arguments is refused (plan 177 Task 2). */
export declare const HOOK_EXECUTE_REWRITE = "ERR_PRISM_HOOK_EXECUTE_REWRITE";
