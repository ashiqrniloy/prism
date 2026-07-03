// ponytail: dependency-free conformance helper for the CompactionStrategy
// adapter contract. The core default strategy and the first-party LLM
// compaction package both implement CompactionStrategy; adapter authors call
// this once to assert the summary-result shape, secret redaction, and
// abort-observation invariants that compaction.test.ts and the LLM
// compaction package's strategy tests already check. Throws plain Error; no
// test runner, no network, no real credentials.

import type { CompactionContext, CompactionStrategy, SessionEntry } from "../contracts.js";
import { createSessionEntry } from "../session-stores.js";

export interface CompactionConformanceOptions {
  /** Secret strings that must not appear in the summary or returned entries. */
  readonly secrets?: readonly string[];
  /** When true, asserts the strategy observes an already-aborted signal. */
  readonly exerciseAbort?: boolean;
}

/**
 * Assert that a `CompactionStrategy` satisfies the core adapter contract:
 * `compact()` returns a `CompactionResult` with a non-empty summary, known
 * secrets are redacted from the summary and any returned entries, and (when
 * requested) an already-aborted signal is observed. Throws on the first
 * violation; returns the result when the strategy conforms.
 */
export async function assertCompactionStrategyConforms(
  strategy: CompactionStrategy,
  options: CompactionConformanceOptions = {},
): Promise<{ summary: string }> {
  const secrets = options.secrets ?? [];
  const entries: readonly SessionEntry[] = [
    createSessionEntry({ sessionId: "s", kind: "message", message: { role: "user", content: [{ type: "text", text: `old ${secrets[0] ?? "history"}` }] } }),
    createSessionEntry({ sessionId: "s", kind: "message", message: { role: "assistant", content: [{ type: "text", text: "recent" }] } }),
  ];

  const context: CompactionContext = {
    sessionId: "conformance",
    entries,
    keepRecentEntries: 1,
    trigger: "manual",
    secrets,
  };

  const result = await strategy.compact(context);
  if (!result.summary || typeof result.summary !== "string") {
    throw new Error("CompactionStrategy must return a non-empty string summary");
  }
  for (const secret of secrets) {
    if (secret && result.summary.includes(secret)) {
      throw new Error(`CompactionStrategy leaked a secret into the summary: ${secret.slice(0, 8)}...`);
    }
  }
  if (result.entries) {
    for (const secret of secrets) {
      if (secret && JSON.stringify(result.entries).includes(secret)) {
        throw new Error(`CompactionStrategy leaked a secret into returned entries: ${secret.slice(0, 8)}...`);
      }
    }
  }

  if (options.exerciseAbort) {
    const controller = new AbortController();
    controller.abort(new Error("aborted"));
    let observed = false;
    try {
      await strategy.compact({ ...context, signal: controller.signal });
    } catch {
      observed = true;
    }
    if (!observed) {
      throw new Error("CompactionStrategy did not observe an already-aborted signal");
    }
  }

  return { summary: result.summary };
}
