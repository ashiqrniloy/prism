/** create-agent (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import type { Agent, AgentConfig, AgentSession, AgentSessionConfig } from "../contracts.js";
import { RuntimeAgentSession } from "./session.js";

export function createAgent(config: AgentConfig): Agent {
  return {
    config,
    createSession(sessionConfig = {}) {
      return createAgentSession({ ...sessionConfig, agent: this });
    },
  };
}

export function createAgentSession(config: AgentSessionConfig & { readonly agent: Agent }): AgentSession {
  return new RuntimeAgentSession(config);
}
