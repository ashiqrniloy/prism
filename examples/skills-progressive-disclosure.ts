import {
  assembleProviderInput,
  createLoadedSkillSet,
  createLoadSkillTool,
  createSkillRegistry,
  createToolRegistry,
  dispatchToolCall,
  type Skill,
  toolCallContent,
} from "@arnilo/prism";

function catalogSkills(count: number): Skill[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `skill-${i}`,
    description: `Catalog entry ${i}.`,
    instructions: `Full instructions for skill ${i}. `.repeat(24),
  }));
}

// Many-skill catalog under budget, then load one body on demand (no live provider).
export async function demo() {
  const skills = catalogSkills(8);
  const registry = createSkillRegistry(skills);
  const loaded = createLoadedSkillSet();
  const loadSkill = createLoadSkillTool({ registry, loaded });
  const toolRegistry = createToolRegistry([loadSkill]);

  const catalogRequest = await assembleProviderInput({
    model: { provider: "mock", model: "demo" },
    input: "Pick a skill",
    skills,
    skillsDisclosure: "progressive",
    contextBudget: { maxInputTokens: 900, reportOmissions: true },
  });
  const catalogText = catalogRequest.messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");

  const catalogOnly = skills.every(
    (skill) =>
      catalogText.includes(`Skill ${skill.name}: ${skill.description}`) && !catalogText.includes((skill.instructions ?? "").slice(0, 40)),
  );

  await dispatchToolCall({
    call: toolCallContent("call_1", "load_skill", { name: "skill-3" }),
    registry: toolRegistry,
    context: {
      sessionId: "s1",
      runId: "r1",
      toolCallId: "call_1",
      metadata: {
        loadedSkills: loaded,
        activeSkillNames: skills.map((skill) => skill.name),
        activeTools: toolRegistry.list(),
      },
    },
  });

  const loadedRequest = await assembleProviderInput({
    model: { provider: "mock", model: "demo" },
    input: "Use loaded skill",
    skills,
    skillsDisclosure: "progressive",
    loadedSkills: loaded,
  });
  const loadedText = loadedRequest.messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
  const bodyLoaded = loadedText.includes("Full instructions for skill 3.");

  return {
    skillCount: skills.length,
    catalogOnly,
    loadedSkill: "skill-3",
    bodyLoaded,
    loadedCount: loaded.list().length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
