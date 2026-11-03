import type { FabricOntologyPort, OntologySourceInput } from "@arnilo/prism-memory-fabric";

/** A `memory.fabric` stand-in for the ingest tool and command: a stage root and a recording `indexSource`. */
export function sourcePort(root: string, indexed: OntologySourceInput[] = []): () => FabricOntologyPort {
  const port = {
    sourceRoot: () => root,
    async indexSource(input: OntologySourceInput) {
      indexed.push(input);
      return { indexed: true, scope: "project" as const, id: `note-${indexed.length}` };
    },
  };
  return () => port as unknown as FabricOntologyPort;
}
