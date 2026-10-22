import type { MemoryFabric, MemoryFabricExplainEntry, MemoryFabricRecallOptions, MemoryNoteHit } from "../types.js";
import { HARD_TOP_K_CAP } from "@arnilo/prism-memory-core";
import { RECALL_OVERSAMPLE } from "@arnilo/prism-memory-core";

type ReadPolicySettings = {
  readonly activation: { readonly topK: number; readonly minSimilarity: number };
};

export interface ScopedMemoryRecallResult {
  readonly hits: readonly MemoryNoteHit[];
  readonly abstained: boolean;
  readonly explain: readonly MemoryFabricExplainEntry[];
}

/**
 * The floor, topK, and abstention. Decay is not applied here (plan 188.4 Task 3, D8): the fabric's
 * ranking already adds retrieval and storage strength as bounded priors in scope sessions, so
 * multiplying calendar-time decay into the score again would let age override relevance.
 */
function applyReadPolicy(
  hits: readonly MemoryNoteHit[],
  explain: readonly MemoryFabricExplainEntry[],
  settings: ReadPolicySettings,
): ScopedMemoryRecallResult {
  // D9: the floor applies in every mode; in lexical mode the score is query coverage.
  // The floor reads the mode's pre-prior similarity: cosine in hybrid, coverage in lexical.
  const admitted = hits.filter((hit) => (hit.similarity ?? hit.coverage ?? hit.score) >= settings.activation.minSimilarity);
  if (admitted.length === 0) return { hits: [], abstained: true, explain: [] };

  const ranked = [...admitted]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, settings.activation.topK);
  const explainById = new Map(explain.map((entry) => [entry.id, entry]));
  return {
    hits: ranked,
    abstained: false,
    explain: ranked.map((hit) => {
      const prev = explainById.get(hit.id);
      return {
        id: hit.id,
        score: hit.score,
        link: prev?.link ?? false,
        valid: prev?.valid ?? true,
        ...(prev?.similarity !== undefined ? { similarity: prev.similarity } : {}),
        ...(prev?.recency !== undefined ? { recency: prev.recency } : {}),
        ...(prev?.importance !== undefined ? { importance: prev.importance } : {}),
      };
    }),
  };
}

/**
 * Recall through the activation floor, topK, and abstention. A retrieval is not a use (D5): the
 * unified lifecycle counts cited notes, so this path writes nothing.
 */
export async function recallScopedMemory(
  input: {
    readonly fabric: MemoryFabric;
    readonly settings: ReadPolicySettings;
    readonly now?: number;
  },
  query: string,
  options: MemoryFabricRecallOptions = {},
): Promise<ScopedMemoryRecallResult> {
  const fetchK = Math.min(HARD_TOP_K_CAP, input.settings.activation.topK * RECALL_OVERSAMPLE);
  const recalled = await input.fabric.recall(query, {
    ...options,
    minSimilarity: Math.max(options.minSimilarity ?? 0.35, input.settings.activation.minSimilarity),
    topK: fetchK,
  });
  return applyReadPolicy(recalled.hits, recalled.explain, input.settings);
}
