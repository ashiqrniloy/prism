/**
 * Plan 089 Task 3: per-query source-grant recheck.
 *
 * Retrieval never trusts a grant snapshot. Every query re-asks the store for each
 * *distinct source* it is about to inject, so a revoke that lands mid-turn (between
 * turns, or while the query is in flight) excludes that source from the result the
 * caller receives. There are two gates: the candidate pre-filter and, when a reranker
 * ran, a fresh recheck of the ranked hits — a revoke during rerank must not leak, so
 * the second gate deliberately re-reads instead of reusing the first decision.
 *
 * Lookups are memoized per source *per gate* (never per hit), bounded by the hit count,
 * and fail closed: `false` and thrown store errors both withhold the hits, recorded once
 * per source in the audit sink instead of aborting the whole query. Abort stays an abort.
 */
import type { RagAccessConstraint, StoreDenial, StoreDenialReason, VectorStore } from "../types.js";
import type { AccessDenial, RagHit, RagScope } from "./types.js";
import { assertNotAborted } from "./util.js";

/** Store errors are audit text, not payloads: cap before they reach the sink. */
const ACCESS_ERROR_MAX = 256;

export interface CreateAccessRecheckOptions {
  readonly store: VectorStore;
  /** Already normalized by `requireRetrieveAuthorization`. */
  readonly authorization: RagAccessConstraint;
  /** Audit sink. Called once per denied source when `report()` flushes. */
  readonly onDenied?: (denial: AccessDenial) => void;
  readonly signal?: AbortSignal;
  /** Redacts store error messages before they reach the audit sink. */
  readonly redact?: (value: string) => string;
}

/** Scope a grant was checked in: `MemoryScope` shape, the vocabulary `checkSourceAccess` and `AccessDenial` use. */
interface GrantScope {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly threadId: string;
}

export interface AccessRecheck {
  /** Pre-filter gate. One lookup per distinct source, reused across that gate's hits. */
  allows(hit: RagHit): Promise<boolean>;
  /** Post-rerank gate: always re-reads, so a grant change during rerank still excludes. */
  allowsAfterRerank(hit: RagHit): Promise<boolean>;
  /**
   * Plan 102 Task 6: what the store's own ACL predicate withheld before any hit existed. These sources
   * join the same per-source report, so a source filtered inside SQL produces one denial event.
   */
  noteStoreDenials(scope: RagScope, denials: readonly StoreDenial[]): void;
  /** Per-source denials for this query, emitted to `onDenied` exactly once. */
  report(): readonly AccessDenial[];
}

const PRE_FILTER = 0;
const AFTER_RERANK = 1;

interface RecheckEntry {
  readonly sourceId: string;
  readonly scope: GrantScope;
  readonly hitIds: Set<string>;
  phase: number;
  decision?: Promise<boolean>;
  allowed?: boolean;
  error?: string;
  /** Set when the store's own predicate reported this source (plan 102 Task 6). */
  storeReason?: StoreDenialReason;
}

/**
 * A store-filtered source is reported with the boundary's own vocabulary: for a source the store
 * withheld, the boundary's `checkSourceAccess` would have failed too, so the event is the one a
 * boundary denial produces. Hosts that need the finer store rule read `VectorQuery.onDeniedSources`.
 */
const STORE_DENIAL_REASON = "no_grant" as const;

/** `\0` cannot appear in a validated tenant/resource/thread/source id. */
function sourceKey(scope: RagScope, sourceId: string): string {
  return `${scope.tenantId}\u0000${scope.resourceId}\u0000${scope.corpusId}\u0000${sourceId}`;
}

export function createAccessRecheck(options: CreateAccessRecheckOptions): AccessRecheck {
  const { store, authorization, signal, redact, onDenied } = options;
  const entries = new Map<string, RecheckEntry>();
  let reported: readonly AccessDenial[] | undefined;

  async function decide(entry: RecheckEntry): Promise<boolean> {
    try {
      assertNotAborted(signal);
      const allowed = await store.checkSourceAccess!(entry.scope, entry.sourceId, authorization, { signal });
      entry.allowed = allowed;
      return allowed;
    } catch (error) {
      // Abort is a caller decision, not a denial: propagate it untouched.
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      entry.allowed = false;
      entry.error = (redact ? redact(message) : message).slice(0, ACCESS_ERROR_MAX);
      return false;
    }
  }

  function check(hit: RagHit, phase: number): Promise<boolean> {
    const key = sourceKey(hit.provenance, hit.sourceId);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        sourceId: hit.sourceId,
        scope: Object.freeze({
          tenantId: hit.provenance.tenantId,
          resourceId: hit.provenance.resourceId,
          threadId: hit.provenance.corpusId,
        }),
        hitIds: new Set(),
        phase,
      };
      entries.set(key, entry);
    }
    if (phase > entry.phase) {
      // A later gate is a new question: drop the earlier answer.
      entry.phase = phase;
      entry.decision = undefined;
      entry.allowed = undefined;
      entry.error = undefined;
    }
    entry.hitIds.add(hit.id);
    entry.decision ??= decide(entry);
    return entry.decision;
  }

  return {
    allows(hit: RagHit): Promise<boolean> {
      return check(hit, PRE_FILTER);
    },
    allowsAfterRerank(hit: RagHit): Promise<boolean> {
      return check(hit, AFTER_RERANK);
    },
    noteStoreDenials(scope: RagScope, denials: readonly StoreDenial[]): void {
      for (const denial of denials) {
        const key = sourceKey(scope, denial.sourceId);
        const existing = entries.get(key);
        if (existing) {
          existing.storeReason ??= denial.reason;
          continue;
        }
        entries.set(key, {
          sourceId: denial.sourceId,
          scope: Object.freeze({ tenantId: scope.tenantId, resourceId: scope.resourceId, threadId: scope.corpusId }),
          hitIds: new Set(),
          phase: PRE_FILTER,
          storeReason: denial.reason,
        });
      }
    },
    report(): readonly AccessDenial[] {
      if (reported) return reported;
      const denials: AccessDenial[] = [];
      for (const entry of entries.values()) {
        const boundaryDenied = entry.allowed === false;
        // A store report stands only while the boundary has not answered for that source: a boundary
        // allow means the caller got hits, so there is nothing withheld to audit.
        if (!boundaryDenied && !(entry.allowed === undefined && entry.storeReason !== undefined)) continue;
        const failed = boundaryDenied && entry.error !== undefined;
        denials.push(
          Object.freeze({
            sourceId: entry.sourceId,
            scope: entry.scope,
            reason: failed ? ("check_failed" as const) : STORE_DENIAL_REASON,
            hits: entry.hitIds.size,
            ...(failed ? { error: entry.error } : {}),
          }),
        );
      }
      reported = Object.freeze(denials);
      for (const denial of reported) onDenied?.(denial);
      return reported;
    },
  };
}
