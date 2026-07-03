import {
  createAgent,
  createAgentSession,
  createExtensionKernel,
  createMockProvider,
  providerDone,
  providerTextDelta,
  type Extension,
} from "@arnilo/prism";

// Extension package: a host bundles a tool, a skill, and a context provider
// into one `Extension` and loads it through the extension kernel. The
// contributions land in the kernel's inert registries; the host then builds
// an agent from those registries and runs a prompt. No filesystem/shell/
// browser coding tools — only a host-domain `notes/save` tool registered by
// the extension. No network, no credentials.
//
// Distinct from `extensions.ts` (which loads an extension that registers a
// provider) and `provider-registration.ts` (which loads a `ProviderPackage`):
// this shows an extension package bundling tool + skill + context capabilities
// the host wires into an agent.

const notesExtension: Extension = {
  name: "notes-extension",
  setup(api) {
    api.registerTool({
      name: "notes/save",
      description: "Persist a short note string.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute(args, ctx) {
        return { toolCallId: ctx.toolCallId, name: "notes/save", value: { saved: true, text: args.text } };
      },
    });
    api.registerSkill({
      name: "summarize-skill",
      description: "Summarize the pinned workspace note.",
      instructions: "Summarize the workspace context in one sentence.",
      toolNames: ["notes/save"],
    });
    api.registerContextProvider({
      name: "workspace",
      resolve: () => [{ title: "Workspace note", content: "Prism ships an extensible agent SDK." }],
    });
  },
};

export async function demo(): Promise<{ registeredTools: number; registeredSkills: number; registeredContext: number; eventTypes: readonly string[] }> {
  const kernel = createExtensionKernel();
  await kernel.load([notesExtension]);

  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("Summarized."), providerDone()]),
    tools: kernel.registries.tools.list(),
    skills: kernel.registries.skills.list(),
    context: kernel.registries.contextProviders.list(),
  });

  const session = createAgentSession({ agent });
  const eventTypes: string[] = [];
  async function drain(): Promise<void> {
    for await (const event of session.subscribe()) eventTypes.push(event.type);
  }
  await Promise.all([drain(), session.run("Summarize.", { activeSkills: ["summarize-skill"] })]);

  return {
    registeredTools: kernel.registries.tools.list().length,
    registeredSkills: kernel.registries.skills.list().length,
    registeredContext: kernel.registries.contextProviders.list().length,
    eventTypes,
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
