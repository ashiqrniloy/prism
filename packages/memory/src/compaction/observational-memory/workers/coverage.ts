import type { CoverageTier } from "../types.js";

export function coverageTier(covered: number, total: number): CoverageTier {
  if (covered <= 0 || total <= 0) return "none";
  return covered >= total ? "full" : "partial";
}
