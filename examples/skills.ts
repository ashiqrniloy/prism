import { createSkillRegistry, resolveActiveSkills } from "@arnilo/prism";
import type { Skill } from "@arnilo/prism";

// Skill registry with progressive disclosure: skills activate by name and may
// declare which tool names they need. Skills cannot register missing tools or
// grant permissions by themselves.
export function demo() {
  const summarize: Skill = {
    name: "summarize",
    description: "Summarize the conversation",
    instructions: "Produce a concise summary.",
    toolNames: [],
  };

  const registry = createSkillRegistry([summarize]);
  const active = resolveActiveSkills({ registry, names: ["summarize"], tools: [] });

  return { count: active.length, first: active[0]?.name };
}
