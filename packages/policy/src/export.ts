import type { PersistencePage } from "@arnilo/prism";
import { resolvePolicyLimits } from "./limits.js";
import type {
  PolicyDecisionRecord,
  PolicyDecisionStore,
  PolicyExportOptions,
  PolicyLimits,
} from "./types.js";

export interface ExportPolicyDecisionsOptions extends PolicyExportOptions {
  readonly store: PolicyDecisionStore;
  readonly limits?: PolicyLimits;
}

/**
 * Cursor-paginated export. Yields pages; optional sink receives each page for host WORM/SIEM.
 * Never full-scans unbounded — page size capped by frozen export limits.
 */
export async function* exportPolicyDecisions(
  options: ExportPolicyDecisionsOptions,
): AsyncGenerator<PersistencePage<PolicyDecisionRecord>, void, unknown> {
  const maxPage = resolvePolicyLimits(options.limits).maxExportPageSize;
  let cursor = options.cursor;
  for (;;) {
    options.signal?.throwIfAborted();
    const page = await options.store.query({
      tenantId: options.tenantId,
      accountId: options.accountId,
      userId: options.userId,
      policyId: options.policyId,
      policyVersion: options.policyVersion,
      cursor,
      limit: options.limit ?? maxPage,
      order: "asc",
      signal: options.signal,
    });
    if (options.sink && page.items.length > 0) await options.sink.write(page.items);
    yield page;
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}
