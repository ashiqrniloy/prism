import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createContributionRegistries,
  registerDiscoveredContributions,
  createSkillRegistry,
  createAgent,
  createMockProvider,
  providerDone,
} from "@arnilo/prism";
import { discoverContributions } from "@arnilo/prism/node/contribution-discovery";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";
import type { ProviderRequest } from "@arnilo/prism";

// Workspace contribution discovery, end-to-end with the mock provider.
// Scans a committed example workspace for a SKILL.md, registers the realized
// skill, then runs a mock agent with `activeSkills: ["greeter"]` and prints
// the assembled provider input — proving the skill instructions reached the
// model request without any network or real credentials.
const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, "example-workspace");

export async function demo(): Promise<{
  discoveredSkill: string | undefined;
  skillInstructionInInput: boolean;
}> {
  // 1. Discover: scan <workspace>/.agent/skills/<name>/SKILL.md.
  //    Trust gate fails closed — workspace contributions are never auto-trusted.
  const trust = createPathTrustPolicy({ trustedRoots: [workspaceRoot] });
  const discovered = await discoverContributions({
    kinds: ["skill"],
    workspaceRoot,
    trust,
  });

  // 2. Register: realized Skill objects land in the skills registry; other
  //    kinds (tool/context/agent/instructions) register as descriptor stubs.
  //    Discovery never imports or executes contribution code.
  const registries = createContributionRegistries();
  registerDiscoveredContributions(registries, discovered);
  const skill = registries.skills.list()[0];

  // 3. Run: mock provider captures the assembled request so we can prove the
  //    skill instructions were injected via activeSkills: ["greeter"].
  const captured: ProviderRequest[] = [];
  const provider = createMockProvider([providerDone()], {
    onRequest: (request) => {
      captured.push(request);
    },
  });
  const session = createAgent({
    model: { provider: "mock", model: "demo" },
    provider,
    skills: createSkillRegistry([skill!]),
  }).createSession();

  // Fire run() (resolves into closeSubscribers) and drain the event stream in
  // parallel — subscribe() only ends once run completes and closes the stream.
  const done = session.run("Hi", { activeSkills: ["greeter"] });
  for await (const _event of session.subscribe()) {
    void _event;
  }
  await done;

  const input = captured[0]?.messages
    .flatMap((m) => m.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n") ?? "";

  return {
    discoveredSkill: skill?.name,
    skillInstructionInInput: /Greet the user by name/.test(input),
  };
}

// Runnable smoke test: `node examples/discover-skills.ts`. Network-free.
export async function main(): Promise<void> {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
