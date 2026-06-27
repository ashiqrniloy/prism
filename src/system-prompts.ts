import type { SystemPromptConfig, SystemPromptContribution } from "./contracts.js";

export interface ComposeSystemPromptOptions {
  readonly base?: string | readonly string[];
}

// ponytail: Phase 31 — user (SYSTEM.md global) is the base layer; app (AGENTS.md project) sits above package.
// Behavioral change from Phase 14: `source: "user"` is now the global base (rank 0), not a high-priority caller override.
// Documented layering arrow: SYSTEM.md (user) → package → AGENTS.md (app) → host config → run.
const sourceRank = new Map<string, number>([["user", 0], ["package", 1], ["app", 2], ["run", 3]]);

export function composeSystemPrompt(contributions: SystemPromptConfig = [], options: ComposeSystemPromptOptions = {}): string | undefined {
  const parts = baseParts(options.base);
  if (contributions === false) return joinPrompt(parts);

  const layers = [...asContributions(contributions)]
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => rank(a.layer) - rank(b.layer) || a.index - b.index);

  for (const { layer } of layers) {
    if (layer.mode === "disable") {
      parts.length = 0;
      continue;
    }
    if (!layer.text) continue;
    if (layer.mode === "replace") parts.splice(0, parts.length, layer.text);
    else if (layer.mode === "prepend") parts.unshift(layer.text);
    else parts.push(layer.text);
  }

  return joinPrompt(parts);
}

export function mergeSystemPromptConfig(config: SystemPromptConfig | undefined, override: SystemPromptConfig | undefined): SystemPromptConfig {
  if (override === false) return config ? [] : [];
  return [...asContributions(config), ...asContributions(override)];
}

function asContributions(value: SystemPromptConfig | undefined): readonly SystemPromptContribution[] {
  if (value === undefined || value === false) return [];
  return isContributionArray(value) ? value : [value];
}

function isContributionArray(value: SystemPromptContribution | readonly SystemPromptContribution[]): value is readonly SystemPromptContribution[] {
  return Array.isArray(value);
}

function baseParts(base: ComposeSystemPromptOptions["base"]): string[] {
  return (typeof base === "string" ? [base] : base ?? []).filter((text) => text.length > 0);
}

function rank(layer: SystemPromptContribution): number {
  return sourceRank.get(layer.source ?? "") ?? 10;
}

function joinPrompt(parts: readonly string[]): string | undefined {
  return parts.length ? parts.join("\n\n") : undefined;
}
