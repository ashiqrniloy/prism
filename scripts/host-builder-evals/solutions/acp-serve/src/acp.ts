import type { Agent, ModelSpec, PackageInput } from "@arnilo/prism";
import { createAgent } from "@arnilo/prism";
import { acpHost, serveAcp } from "@arnilo/prism-hosts/acp";
import approval from "@arnilo/prism-extensions/approval";
import { toolsCoding } from "@arnilo/prism-tools/coding";

export interface AcpHostOptions {
  readonly model: ModelSpec;
  readonly providers: readonly PackageInput[];
  readonly root: string;
  readonly stream: Parameters<typeof serveAcp>[1]["stream"];
}

export async function createAcpHost(options: AcpHostOptions): Promise<{ agent: Agent; close(): Promise<void> }> {
  const agent = await createAgent({
    model: options.model,
    ownership: { tenantId: "local" },
    principal: { kind: "user", id: "local" },
    host: acpHost(),
    packages: [...options.providers, toolsCoding({ root: options.root }), approval({ mode: "ask" })],
  });
  const server = serveAcp(agent, { stream: options.stream });
  return {
    agent,
    async close() {
      await server.close();
      await agent.dispose();
    },
  };
}
