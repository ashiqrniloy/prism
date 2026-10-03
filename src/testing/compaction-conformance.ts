// ponytail: dependency-free conformance helper for the Compactor
// slot contract. The core default compactor and the first-party LLM
// compaction package both implement Compactor; adapter authors call
// this once to assert the summary-result shape, secret redaction, and
// abort-observation invariants that compaction.test.ts and the LLM
// compaction package's compactor tests already check. Throws plain Error; no
// test runner, no network, no real credentials.

import type { CompactionContext, SessionEntry } from "../contracts.js";
import type { Compactor } from "../slots/types.js";
import { createSessionEntry } from "../session-stores.js";

export interface CompactionConformanceOptions {
  /** Secret strings that must not appear in the summary or returned entries. */
  readonly secrets?: readonly string[];
  /** When true, asserts the compactor observes an already-aborted signal. */
  readonly exerciseAbort?: boolean;
}

/**
 * Assert that a `Compactor` satisfies the compaction slot contract:
 * `compact()` returns a `CompactionResult` with a non-empty summary, known
 * secrets are redacted from the summary and any returned entries, and (when
 * requested) an already-aborted signal is observed. Throws on the first
 * violation; returns the result when the compactor conforms.
 */
export async function assertCompactorConforms(
  compactor: Compactor,
  options: CompactionConformanceOptions = {},
): Promise<{ summary: string }> {
  const secrets = options.secrets ?? [];
  const entries: readonly SessionEntry[] = [
    createSessionEntry({
      sessionId: "s",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: `old ${secrets[0] ?? "history"}` }] },
    }),
    createSessionEntry({ sessionId: "s", kind: "message", message: { role: "assistant", content: [{ type: "text", text: "recent" }] } }),
  ];

  const context: CompactionContext = {
    sessionId: "conformance",
    entries,
    keepRecentEntries: 1,
    trigger: "manual",
    secrets,
  };

  const result = await compactor.compact(context);
  if (!result.summary || typeof result.summary !== "string") {
    throw new Error("Compactor must return a non-empty string summary");
  }
  for (const secret of secrets) {
    if (secret && result.summary.includes(secret)) {
      throw new Error(`Compactor leaked a secret into the summary: ${secret.slice(0, 8)}...`);
    }
  }
  if (result.entries) {
    for (const secret of secrets) {
      if (secret && JSON.stringify(result.entries).includes(secret)) {
        throw new Error(`Compactor leaked a secret into returned entries: ${secret.slice(0, 8)}...`);
      }
    }
  }

  if (options.exerciseAbort) {
    const controller = new AbortController();
    controller.abort(new Error("aborted"));
    let observed = false;
    try {
      await compactor.compact({ ...context, signal: controller.signal });
    } catch {
      observed = true;
    }
    if (!observed) {
      throw new Error("Compactor did not observe an already-aborted signal");
    }
  }

  return { summary: result.summary };
}
