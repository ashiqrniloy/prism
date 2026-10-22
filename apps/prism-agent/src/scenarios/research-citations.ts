import { mockProvider } from "@arnilo/prism/testing";
import { createResearchWorker, type HostConfig } from "../host/index.js";
import { fixtureEmbeddings } from "./fixtures/embeddings.js";
import { fetchBothScript, unknownCitationScript } from "./fixtures/scripts.js";

export interface CitationVerdict {
  readonly verdict: string;
  readonly unresolved: readonly string[];
  readonly ledgerSize: number;
}

async function verify(config: HostConfig, script: ReturnType<typeof fetchBothScript>): Promise<CitationVerdict> {
  const agent = await createResearchWorker(config, {
    packages: [mockProvider(script, { embeddings: fixtureEmbeddings() })],
  });
  try {
    const session = await agent.session({ create: true });
    await session.run("write the report");
    return (await agent.commands.run("research.verify", {}, { session })) as CitationVerdict;
  } finally {
    await agent.dispose();
  }
}

export function researchCitationsPass(config: HostConfig): Promise<CitationVerdict> {
  return verify(config, fetchBothScript());
}

export function researchCitationsFail(config: HostConfig): Promise<CitationVerdict> {
  return verify(config, unknownCitationScript());
}
