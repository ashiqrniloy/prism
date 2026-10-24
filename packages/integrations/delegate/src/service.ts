import type { Principal, SessionContext } from "@arnilo/prism";
import { DelegateError, type DelegateRuntime, type DelegationOutcome } from "./runtime.js";

/**
 * The delegate runtime as a service, for a package that needs a configured child the model never sees
 * (a verifier, an advisor). It only starts children the host configured: no package set, model, or limit
 * can be passed in, so holding this service grants nothing the host did not choose.
 */
export interface DelegateService {
  /** `mode: "async"` returns `{ delegationId, status: "running" }`; `"sync"` resolves the outcome. */
  start(input: {
    readonly child: string;
    readonly input: string;
    readonly mode: "sync" | "async";
    readonly session: SessionContext;
    readonly principal?: Principal;
    readonly signal?: AbortSignal;
  }): Promise<DelegationOutcome | { readonly delegationId: string; readonly status: "running"; readonly child: string }>;
  /** Awaits one delegation of this session. An unknown id or another session's id is `Unknown delegation`. */
  wait(delegationId: string, session: SessionContext, signal?: AbortSignal): Promise<DelegationOutcome>;
}

export const DELEGATE_SERVICE = "delegate";

/** `session_required` for a caller without a session: a delegation is always scoped to one. */
export function createDelegateService(runtime: DelegateRuntime): DelegateService {
  return {
    async start(input) {
      if (input.session === undefined || input.session === null) throw new DelegateError("session_required: delegate.start needs the calling session");
      return runtime.start({
        child: input.child,
        input: input.input,
        mode: input.mode,
        parentSessionId: input.session.id,
        parentRunId: "",
        session: input.session,
        ...(input.principal === undefined ? {} : { principal: input.principal }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        allowHidden: true,
      });
    },
    wait(delegationId, session, signal) {
      if (session === undefined || session === null) throw new DelegateError("session_required: delegate.wait needs the calling session");
      return runtime.wait(delegationId, session.id, signal);
    },
  };
}
