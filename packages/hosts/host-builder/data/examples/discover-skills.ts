import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderRequest } from "@arnilo/prism";
import { createAgent, providerDone } from "@arnilo/prism";
import { contextFiles } from "@arnilo/prism-extensions/context-files";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMockProvider } from "@arnilo/prism/testing";

// Workspace skill discovery through `@arnilo/prism-extensions/context-files`, end-to-end with the mock
// provider. The package scans the standard project skill roots (`.agents/skills`, `.claude/skills`)
// for `<name>/SKILL.md`, registers what it finds, and the mock agent renders the instruction from
// the discovered skill — proving no manual contribution scan or host registration was needed.
const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, "example-workspace");

export async function demo(): Promise<{
  discoveredSkill: string | undefined;
  skillInstructionInInput: boolean;
}> {
  const captured: ProviderRequest[] = [];
  const provider = createMockProvider([providerDone()], {
    onRequest: (request) => {
      captured.push(request);
    },
  });
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [provider]), contextFiles({ root: workspaceRoot })],
    // Eager disclosure puts the discovered skill's instructions in the first request; the default
    // progressive mode would list it and wait for `load_skill`.
    skills: { disclosure: "eager" },
  });

  // The skill was registered during package setup, before the first turn.
  const skill = agent.skills.find((entry) => entry.name === "greeter");
  const session = await agent.session();

  // Fire run() (resolves into closeSubscribers) and drain the event stream in
  // parallel — subscribe() only ends once run completes and closes the stream.
  const done = session.run("Hi");
  for await (const _event of session.subscribe()) {
    void _event;
  }
  await done;

  const input =
    captured[0]?.messages
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
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
