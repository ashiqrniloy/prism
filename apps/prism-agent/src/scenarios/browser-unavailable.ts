import { mockProvider, providerDone } from "@arnilo/prism/testing";
import { createResearchWorker, type HostConfig } from "../host/index.js";

export async function browserUnavailable(config: HostConfig): Promise<{ noted: boolean; browserTools: readonly string[] }> {
  const agent = await createResearchWorker(config, { packages: [mockProvider([[providerDone()]])] });
  try {
    const view = agent.inspect();
    return {
      noted: view.statusNotes.some(
        (note) => note.package === "@arnilo/prism-tools-browser" && /playwright-core|launch failed/.test(note.message),
      ),
      browserTools: view.tools.filter((tool) => tool.name.startsWith("browser_")).map((tool) => tool.name),
    };
  } finally {
    await agent.dispose();
  }
}
