import { redactSecrets } from "prism";
import type { MemoryObservation, MemoryReflection } from "./types.js";

export function renderObservationalMemory(
  reflections: readonly MemoryReflection[],
  observations: readonly MemoryObservation[],
  secrets: readonly (string | undefined)[] = [],
): string {
  const lines = [
    "# Observational Memory",
    "Use these source-backed memories when relevant. To inspect evidence, call recall with a 12-character id; do not guess ids.",
    "",
    "## Reflections",
    ...(reflections.length ? reflections.map((item) => `- [${item.id}] ${item.content}`) : ["- none"]),
    "",
    "## Observations",
    ...(observations.length ? observations.map((item) => `- [${item.id}] (${item.relevance}) ${item.content}`) : ["- none"]),
  ];
  return redactSecrets(lines.join("\n"), secrets);
}
