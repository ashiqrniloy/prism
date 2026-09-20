type Recall = {
  recall(query: string): Promise<{ readonly hits: readonly { readonly id: string }[] }>;
};

export async function probeLocomoRecall(
  policy: Recall,
  seededIds: ReadonlySet<string>,
  questions: readonly { readonly query: string; readonly expectedId: string }[],
): Promise<{ readonly answered: number; readonly total: number; readonly failedClosed: number }> {
  let answered = 0;
  let failedClosed = 0;
  for (const item of questions) {
    if (!seededIds.has(item.expectedId)) {
      failedClosed += 1;
      continue;
    }
    const hits = (await policy.recall(item.query)).hits;
    if (hits.some((hit) => hit.id === item.expectedId)) answered += 1;
  }
  return { answered, total: questions.length, failedClosed };
}
