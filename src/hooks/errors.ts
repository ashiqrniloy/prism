/** A hook threw, or a registration/option was invalid. Names the owner and hook. */
export class HookError extends Error {
  readonly code: string;
  readonly owner: string;
  readonly hook: string;

  constructor(message: string, options: { readonly owner: string; readonly hook: string; readonly code?: string }) {
    super(message);
    this.name = "HookError";
    this.owner = options.owner;
    this.hook = options.hook;
    this.code = options.code ?? "ERR_PRISM_HOOK";
  }
}

/** A transform handler stopped the chain with `ctx.reject(reason)`. */
export class HookRejectedError extends Error {
  readonly code = "ERR_PRISM_HOOK_REJECTED";
  readonly owner: string;
  readonly hook: string;
  readonly reason: string;

  constructor(reason: string, owner: string, hook: string) {
    super(`Hook ${owner}:${hook} rejected: ${reason}`);
    this.name = "HookRejectedError";
    this.owner = owner;
    this.hook = hook;
    this.reason = reason;
  }
}

/** A registration or dispatch named a hook outside the catalog. */
export class UnknownHookError extends Error {
  readonly code = "ERR_PRISM_UNKNOWN_HOOK";
  readonly hook: string;

  constructor(hook: string) {
    super(`Unknown hook: ${hook}`);
    this.name = "UnknownHookError";
    this.hook = hook;
  }
}
