import {
  type Agent,
  type AgentEvent,
  type Decision,
  type OwnershipScope,
  resolveCeilings,
  type RunOptions,
  type RunStateBounds,
  runStateBounds,
  type Session,
} from "@arnilo/prism";
import { HeadlessError } from "./errors.js";

/** Share this instance with every router and serveAgent that can resume this agent. */
export interface ResumeAuthority {
  readonly ownership: OwnershipScope;
  /** The agent's run-state bounds (from its ceilings), so a raised `ceilings.runStateBytes` still reads its suspensions. */
  readonly runStateBounds?: RunStateBounds;
  session(id: string): Promise<Session>;
  resume(id: string, decisions: readonly Decision[], options?: RunOptions): AsyncIterable<AgentEvent>;
}

export function createResumeAuthority(agent: Agent): ResumeAuthority {
  const ownership = Object.freeze({ ...agent.config.ownership });
  const resuming = new Set<string>();
  const session = async (id: string): Promise<Session> => {
    if (!(await agent.sessions.get(id))) throw new HeadlessError("session_not_found");
    return agent.session({ id });
  };
  return {
    ownership,
    runStateBounds: runStateBounds(resolveCeilings(agent.config.ceilings)),
    session,
    async *resume(id, decisions, options) {
      // Claim before any await: the kernel's asynchronous resume preparation cannot arbitrate this race.
      if (resuming.has(id)) throw new HeadlessError("resume_busy");
      resuming.add(id);
      try {
        yield* (await session(id)).resume(decisions, options);
      } finally {
        resuming.delete(id);
      }
    },
  };
}
