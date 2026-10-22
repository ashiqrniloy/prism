/**
 * The `compaction` slot implementation. It summarizes from the session's ledger rather than from the
 * raw transcript, and delegates to the kernel default when this session has observational memory off
 * (or when the context carries no session, which means the slot was not resolved to this package).
 */
import type { CompactionContext, CompactionResult, Compactor, SessionContext, SessionLog, JsonValue } from "@arnilo/prism";

import { type ResolvedMemoryObservationalConfig, OBSERVATIONS_POOL_MAX_TOKENS } from "./config.js";
import { ledgerOf } from "./state.js";
import { createObservationalMemoryCompactor } from "./strategy.js";

export interface ObservationalCompactorOptions {
  readonly log: SessionLog<JsonValue>;
  readonly config: ResolvedMemoryObservationalConfig;
  /** The kernel default, used whenever this compactor must not act. */
  readonly fallback: Compactor;
  readonly isEnabled: (session: SessionContext) => boolean;
  readonly secrets?: readonly (string | undefined)[];
}

export function createObservationalCompactor(options: ObservationalCompactorOptions): Compactor {
  const memory = createObservationalMemoryCompactor({
    keepRecentEntries: options.config.context.recentMessages,
    observationsPoolMaxTokens: OBSERVATIONS_POOL_MAX_TOKENS,
    advertiseRecall: options.config.recall,
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    ledgerOf: (context) => ledgerFor(options, context),
  });
  return {
    name: "observational-memory",
    async compact(context: CompactionContext): Promise<CompactionResult> {
      const session = context.session;
      if (!session || !options.isEnabled(session)) return options.fallback.compact(context);
      const coversUpToId = ledgerFor(options, context).latestObservationCoverageId;
      const result = await memory.compact(context);
      await options.log.append(session, {
        type: "om.compacted",
        coversUpToId: coversUpToId ?? null,
      });
      return result;
    },
  };
}

function ledgerFor(options: ObservationalCompactorOptions, context: CompactionContext) {
  const session = context.session;
  if (!session) throw new TypeError("observational memory compaction needs the owning session context");
  return ledgerOf(options.log.entries(session));
}
