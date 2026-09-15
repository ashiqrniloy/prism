import { tokenizeLexical } from "../vector-memory.js";

/** 072 invariant body: wrap with `defineScorer({ invariant: true, score: ... })`. Score 0 is not mean-able. */
export function caseConclusionsNotProcedures(
  environment: { readonly procedures?: readonly string[] } | undefined,
  caseTokens: readonly string[],
): { readonly score: number; readonly metadata: { readonly invariant: true } } {
  const denied = new Set(caseTokens.flatMap((token) => [...tokenizeLexical(token)]));
  for (const procedure of environment?.procedures ?? []) {
    for (const token of tokenizeLexical(procedure)) {
      if (denied.has(token)) return { score: 0, metadata: { invariant: true } };
    }
  }
  return { score: 1, metadata: { invariant: true } };
}
