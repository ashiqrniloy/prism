import type { SessionEntry } from "@arnilo/prism";
import {
  HARD_MAX_RECALL_PAGE_LIMIT,
  isEligibleObservationSourceEntry,
  recallObservationalMemoryBranchPage,
  resolveRecallPageLimit,
  serializeSessionEntry,
} from "../compaction/observational-memory/index.js";
import { MemoryValidationError } from "../errors.js";
import { assertNotAborted } from "../util.js";
import { tokenizeLexical } from "../vector-memory.js";
import type {
  MemoryFabric,
  MemoryFabricConversationHit,
  MemoryFabricConversationSearchOptions,
  MemoryFabricConversationSearchResult,
  MemoryFabricObservationSource,
} from "./types.js";

/** Matching messages one conversation search returns by default. */
export const DEFAULT_CONVERSATION_SEARCH_TOP_K = 5;

function resolveSearchTopK(topK: number | undefined): number {
  if (topK === undefined) return DEFAULT_CONVERSATION_SEARCH_TOP_K;
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > HARD_MAX_RECALL_PAGE_LIMIT) {
    throw new RangeError(`Conversation search topK must be a positive safe integer at most ${HARD_MAX_RECALL_PAGE_LIMIT}`);
  }
  return topK;
}

/** Query-term coverage in [0,1]: the share of query terms the message text contains. */
function lexicalCoverage(queryTokens: ReadonlySet<string>, text: string): number {
  const tokens = tokenizeLexical(text);
  let matched = 0;
  for (const term of queryTokens) if (tokens.has(term)) matched += 1;
  return matched / queryTokens.size;
}

export function createFabricConversationSearch(deps: {
  readonly observational?: MemoryFabricObservationSource;
}): MemoryFabric["searchConversation"] {
  return async function searchConversation(
    query: string,
    searchOptions: MemoryFabricConversationSearchOptions = {},
  ): Promise<MemoryFabricConversationSearchResult> {
    const source = deps.observational;
    if (source === undefined) throw new MemoryValidationError("conversation search requires an observational memory session");
    assertNotAborted(searchOptions.signal);
    const queryTokens = tokenizeLexical(query);
    if (queryTokens.size === 0) {
      throw new MemoryValidationError("conversation search query needs at least one term of two or more characters");
    }
    const pageLimit = resolveRecallPageLimit(searchOptions.limit);
    const topK = resolveSearchTopK(searchOptions.topK);
    const entries = await source.session.entries();
    const messages = entries.filter(isEligibleObservationSourceEntry);

    const scored: { readonly entry: SessionEntry; readonly score: number }[] = [];
    for (const entry of messages) {
      const score = lexicalCoverage(queryTokens, serializeSessionEntry(entry));
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score || b.entry.timestamp.localeCompare(a.entry.timestamp) || a.entry.id.localeCompare(b.entry.id));

    const hits: MemoryFabricConversationHit[] = [];
    for (const { entry, score } of scored) {
      if (hits.length >= topK) break;
      assertNotAborted(searchOptions.signal);
      // The page is the observational-memory branch page: same cursor semantics, same page limit.
      const page = recallObservationalMemoryBranchPage(entries, {
        cursor: entry.id,
        limit: pageLimit,
        direction: searchOptions.direction,
        detail: searchOptions.detail,
      });
      if (!page.found) continue;
      hits.push({ entryId: entry.id, score, timestamp: entry.timestamp, page });
    }
    return { hits, scanned: messages.length };
  };
}
