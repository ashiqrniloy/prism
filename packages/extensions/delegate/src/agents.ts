import type { Agent } from "@arnilo/prism";

/** A host-supplied child agent: the agent, or a factory called once, at the first delegation that names it. */
export type DelegateAgentSource = Agent | (() => Agent | Promise<Agent>);

/**
 * The `delegate.agents` service: the agents `children.<name>.agent` names. A child that names an agent no one
 * registered fails its delegation (`unknown_agent`). Registering a name twice fails, so a package cannot swap the
 * agent a host chose.
 */
export interface DelegateAgentRegistry {
  register(name: string, agent: DelegateAgentSource): void;
  has(name: string): boolean;
}

export const DELEGATE_AGENTS_SERVICE = "delegate.agents";

export function createAgentRegistry(onError: (message: string) => Error) {
  const sources = new Map<string, DelegateAgentSource>();
  const resolved = new Map<string, Promise<Agent>>();
  const registry: DelegateAgentRegistry = {
    register(name, agent) {
      if (typeof name !== "string" || name.length === 0) throw onError("delegate.agents.register needs a name");
      if (typeof agent !== "function" && (agent === null || typeof agent !== "object" || typeof agent.session !== "function")) {
        throw onError(`delegate.agents.register(${name}) needs an Agent or a function returning one`);
      }
      if (sources.has(name)) throw onError(`A delegate agent named ${name} is already registered`);
      sources.set(name, agent);
    },
    has: (name) => sources.has(name),
  };
  return {
    registry,
    /** The agent for `name`; a factory runs once and its result (or failure) is kept. */
    resolve(name: string): Promise<Agent> {
      const cached = resolved.get(name);
      if (cached) return cached;
      const source = sources.get(name);
      if (source === undefined) return Promise.reject(onError(`unknown_agent: no delegate agent named ${name} is registered`));
      const agent = Promise.resolve(typeof source === "function" ? source() : source);
      resolved.set(name, agent);
      return agent;
    },
  };
}
