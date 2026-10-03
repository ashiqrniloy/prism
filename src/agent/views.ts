/**
 * The merged tool and skill views behind `agent.tools`, `agent.skills` and `agent.inspect()`: the host's
 * contributions plus every package's, minus `disable`. One reader, so the three never disagree.
 */
import { agentSkillSource, agentToolList, toolOwner, tryAgentRuntime } from "../agent-session/runtime-registry.js";
import type { Agent, SkillInfo, ToolInfo } from "../contracts.js";
import { resolveToolEffects } from "../tools.js";

const HOST = "host";

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/** Tools after `disable`, each with the package that registered it (`host` for the host's own). */
export function toolInfos(agent: Agent): readonly ToolInfo[] {
  return Object.freeze(
    agentToolList(agent).map((tool) =>
      frozen({
        name: tool.name,
        description: tool.description ?? "",
        effects: Object.freeze([...resolveToolEffects(tool)]),
        package: toolOwner(agent, tool.name) ?? HOST,
      }),
    ),
  );
}

/** Skills after `disable`, each with the package that registered it (`host` for the host's own). */
export function skillInfos(agent: Agent): readonly SkillInfo[] {
  const owners = new Map((tryAgentRuntime(agent)?.packages.skillEntries() ?? []).map((entry) => [entry.skill.name, entry.owner]));
  return Object.freeze(
    agentSkillSource(agent).map((skill) =>
      frozen({ name: skill.name, description: skill.description ?? "", package: owners.get(skill.name) ?? HOST }),
    ),
  );
}
