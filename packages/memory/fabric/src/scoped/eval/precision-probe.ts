type Recall = {
  recall(query: string): Promise<{ readonly hits: readonly { readonly id: string }[] }>;
};

export async function probePrecisionAt3(
  policy: Recall,
  queries: readonly { readonly query: string; readonly relevantIds: readonly string[] }[],
): Promise<{ readonly precisionAt3: number }> {
  if (queries.length === 0) return { precisionAt3: 0 };
  let sum = 0;
  for (const item of queries) {
    const relevant = new Set(item.relevantIds);
    const hits = (await policy.recall(item.query)).hits.slice(0, 3);
    sum += hits.filter((hit) => relevant.has(hit.id)).length / 3;
  }
  return { precisionAt3: sum / queries.length };
}
