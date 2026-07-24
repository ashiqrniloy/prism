import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PolicyError } from "./errors.js";
import { resolvePolicyLimits } from "./limits.js";
import {
  ownershipMatches,
  preparePolicyDecision,
  requireOwnership,
  type PreparePolicyDecisionOptions,
} from "./prepare.js";
import type {
  AppendPolicyDecisionInput,
  PolicyDecisionQuery,
  PolicyDecisionRecord,
  PolicyDecisionStore,
  PolicyLimits,
} from "./types.js";

export interface MemoryPolicyDecisionStoreOptions extends PreparePolicyDecisionOptions {
  readonly initial?: readonly PolicyDecisionRecord[];
  readonly limits?: PolicyLimits;
}

function pageLimit(limit: number | undefined, max: number): number {
  if (limit === undefined) return max;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) {
    throw new PolicyError(`limit must be 1..${max}`, "ERR_PRISM_POLICY_BOUNDS");
  }
  return limit;
}

function matchesQuery(record: PolicyDecisionRecord, query: PolicyDecisionQuery): boolean {
  if (query.policyId !== undefined && record.policyId !== query.policyId) return false;
  if (query.policyVersion !== undefined && record.policyVersion !== query.policyVersion) return false;
  if (query.outcome !== undefined && record.outcome !== query.outcome) return false;
  return true;
}

function queryPage(
  records: readonly PolicyDecisionRecord[],
  query: PolicyDecisionQuery,
  maxPageSize: number,
): { items: PolicyDecisionRecord[]; nextCursor?: string; total: number } {
  query.signal?.throwIfAborted();
  const ownership = requireOwnership(query);
  const limit = pageLimit(query.limit, maxPageSize);
  const order = query.order === "desc" ? -1 : 1;
  const sorted = records
    .filter((record) => ownershipMatches(ownership, record) && matchesQuery(record, query))
    .sort((a, b) => order * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
  const start = query.cursor ? sorted.findIndex((record) => record.id === query.cursor) + 1 : 0;
  if (query.cursor && start === 0) throw new PolicyError("Unknown policy cursor", "ERR_PRISM_POLICY_CURSOR");
  const items = sorted.slice(start, start + limit);
  return {
    items,
    nextCursor: start + items.length < sorted.length ? items.at(-1)?.id : undefined,
    total: sorted.length,
  };
}

/** Append-only in-memory ledger (reference adapter). */
export function createMemoryPolicyDecisionStore(options: MemoryPolicyDecisionStoreOptions = {}): PolicyDecisionStore {
  const records = new Map<string, PolicyDecisionRecord>();
  for (const record of options.initial ?? []) records.set(record.id, Object.freeze({ ...record }));
  const limits = resolvePolicyLimits(options.limits);
  const prepareOptions: PreparePolicyDecisionOptions = {
    limits: options.limits,
    requirePolicyVersion: options.requirePolicyVersion,
    now: options.now,
  };
  return {
    async append(input: AppendPolicyDecisionInput) {
      if (records.has(input.id)) throw new PolicyError("Duplicate policy decision id", "ERR_PRISM_POLICY_DUPLICATE");
      const record = preparePolicyDecision(input, prepareOptions);
      records.set(record.id, record);
      return record;
    },
    async query(query) {
      return queryPage([...records.values()], query, limits.maxExportPageSize);
    },
  };
}

export interface FilePolicyDecisionStoreOptions extends PreparePolicyDecisionOptions {
  readonly path: string;
  readonly limits?: PolicyLimits;
}

/** Append-only JSONL file ledger (reference WORM-shaped adapter; host may replace with real WORM/KMS). */
export function createFilePolicyDecisionStore(options: FilePolicyDecisionStoreOptions): PolicyDecisionStore {
  if (!options.path?.trim()) throw new PolicyError("path required", "ERR_PRISM_POLICY_VALIDATION");
  const limits = resolvePolicyLimits(options.limits);
  const prepareOptions: PreparePolicyDecisionOptions = {
    limits: options.limits,
    requirePolicyVersion: options.requirePolicyVersion,
    now: options.now,
  };
  let loaded = false;
  const records = new Map<string, PolicyDecisionRecord>();

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    try {
      const text = await readFile(options.path, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const record = JSON.parse(line) as PolicyDecisionRecord;
        records.set(record.id, Object.freeze(record));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    loaded = true;
  }

  return {
    async append(input) {
      await ensureLoaded();
      if (records.has(input.id)) throw new PolicyError("Duplicate policy decision id", "ERR_PRISM_POLICY_DUPLICATE");
      const record = preparePolicyDecision(input, prepareOptions);
      await mkdir(dirname(options.path), { recursive: true });
      await appendFile(options.path, `${JSON.stringify(record)}\n`, "utf8");
      records.set(record.id, record);
      return record;
    },
    async query(query) {
      await ensureLoaded();
      return queryPage([...records.values()], query, limits.maxExportPageSize);
    },
  };
}
