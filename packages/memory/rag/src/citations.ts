import type { ArtifactCitation } from "@arnilo/prism";
import type { RagCitation } from "./types.js";

/** Project a retrieved RAG citation into the shared artifact evidence shape. Does not refetch. */
export function evidenceFromRagCitation(
  citation: RagCitation,
  input: {
    readonly contentHash: string;
    readonly revision: string;
    readonly excerpt?: string;
    readonly span?: { readonly start: number; readonly end: number };
    readonly uri?: string;
  },
): ArtifactCitation {
  return {
    uri: input.uri ?? `rag:${citation.sourceId}`,
    kind: "rag",
    sourceId: citation.sourceId,
    revision: input.revision,
    contentHash: input.contentHash,
    retrievedAt: citation.provenance.retrievedAt,
    title: citation.id,
    tenantId: citation.provenance.tenantId,
    support: "unverified",
    ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
    ...(input.span === undefined ? {} : { span: input.span }),
  };
}
