import type { Agent, AgentConfig, Skill } from "../contracts.js";
export { agentRuntime, tryAgentRuntime, type AgentRuntime } from "./runtime-registry.js";
/** Test seam: the kernel version a package's `requires.prism` is checked against. */
export interface CreateAgentInternals {
    readonly kernelVersion?: string;
    /** Reads a `skills.addDir` directory. Defaults to the Node reader, imported only when a package asks. */
    readonly readSkillDir?: (path: string) => Promise<readonly Skill[]>;
    /** The built-in provider's `fetch`. Tests inject one; the default is the global. */
    readonly fetch?: typeof fetch;
}
export declare function createAgent(config: AgentConfig): Promise<Agent>;
/** `createAgent` with internal seams. Not exported from the root. */
export declare function createAgentWith(input: AgentConfig, internals: CreateAgentInternals): Promise<Agent>;
