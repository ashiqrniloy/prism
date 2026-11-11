/**
 * Pending-context queue: hook `additionalContext` accumulated between assemblies and
 * delivered exactly once at the next turn boundary.
 *
 * Oversized payloads follow Codex: spill to `<temp_dir>/hook_outputs/` and inject a
 * pointer instead of the text. That spill is the only filesystem write in this package.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ContextQueue {
  /** Queue injected text; empty/whitespace-only strings are dropped. `limitTokens` overrides the queue default. */
  add(text: string, limitTokens?: number): void;
  /** Take everything queued so far, applying each item's inline cap and spilling when over it. */
  drain(): string;
}

/** Token estimate used for the inline cap: ~4 UTF-16 code units per token. */
export function estimateContextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function defaultHookOutputDir(): string {
  return join(tmpdir(), "hook_outputs");
}

export function createContextQueue(limitTokens: number, outputDir: string = defaultHookOutputDir()): ContextQueue {
  const pending: { text: string; limit: number }[] = [];
  let spilled = 0;
  // Codex applies `additionalContextLimit` per handler, so the cap is checked per queued item.
  const spill = (text: string): string => {
    spilled += 1;
    const file = join(outputDir, `hook-output-${Date.now()}-${spilled}.txt`);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(file, text, "utf8");
    return `Hook output exceeded the inline context limit and was written to ${file}. Read that file before continuing.`;
  };
  return {
    add(text, limit) {
      const trimmed = text.trim();
      if (trimmed !== "") pending.push({ text: trimmed, limit: limit ?? limitTokens });
    },
    drain() {
      if (pending.length === 0) return "";
      return pending
        .splice(0)
        .map((item) => (item.limit === 0 || estimateContextTokens(item.text) <= item.limit ? item.text : spill(item.text)))
        .join("\n\n");
    },
  };
}
