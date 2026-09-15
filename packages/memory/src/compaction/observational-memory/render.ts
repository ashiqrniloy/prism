import { redactSecrets } from "@arnilo/prism";
import { truncateWorkerText } from "./limits.js";
import { HARD_MAX_RENDERED_MEMORY_BYTES } from "./memory-bounds.js";
import type { WorkScopeOutline } from "./scopes-project.js";
import type { MemoryObservation, MemoryReflection } from "./types.js";

export interface RenderObservationalMemoryOptions {
  readonly secrets?: readonly (string | undefined)[];
  readonly maxBytes?: number;
  readonly outline?: readonly WorkScopeOutline[];
}

function normalizeRenderOptions(
  secretsOrOptions: readonly (string | undefined)[] | RenderObservationalMemoryOptions,
): RenderObservationalMemoryOptions {
  if (Array.isArray(secretsOrOptions)) return { secrets: secretsOrOptions };
  return secretsOrOptions as RenderObservationalMemoryOptions;
}

export function renderObservationalMemory(
  reflections: readonly MemoryReflection[],
  observations: readonly MemoryObservation[],
  secretsOrOptions: readonly (string | undefined)[] | RenderObservationalMemoryOptions = [],
): string {
  const options = normalizeRenderOptions(secretsOrOptions);
  const secrets = options.secrets ?? [];
  const maxBytes = options.maxBytes ?? HARD_MAX_RENDERED_MEMORY_BYTES;
  const lines = [
    "# Observational Memory",
    "Use these source-backed memories when relevant. To inspect evidence, call recall with a 12-character id; do not guess ids.",
    "",
    ...(options.outline?.length
      ? ["## Scope Outline", ...options.outline.map((scope) => `- ${scope.id}${scope.label === undefined ? "" : ` — ${scope.label}`}`), ""]
      : []),
    "## Reflections",
    ...(reflections.length ? reflections.map((item) => `- [${item.id}] ${item.content}`) : ["- none"]),
    "",
    "## Observations",
    ...(observations.length ? observations.map((item) => `- [${item.id}] (${item.relevance}) ${item.content}`) : ["- none"]),
  ];
  return redactSecrets(truncateWorkerText(lines.join("\n"), maxBytes), secrets);
}
