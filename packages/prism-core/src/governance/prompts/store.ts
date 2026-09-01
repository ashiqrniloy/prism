import { diffPromptRecords } from "./diff.js";
import { PromptNotFoundError, PromptValidationError } from "./errors.js";
import { type PromptLimits, resolvePromptLimits, resolvePromptPageLimit } from "./limits.js";
import { comparePromptPosition, decodePromptCursor, encodePromptCursor } from "./pagination.js";
import type {
  PromptDiffInput,
  PromptListQuery,
  PromptOwnership,
  PromptRecord,
  PromptResolveInput,
  PromptStore,
  PromptStoreOptions,
  PutPromptInput,
} from "./types.js";
import {
  type NormalizedOwnership,
  normalizeOwnership,
  normalizeStoredPrompt,
  preparePrompt,
  requireLabel,
  requireName,
  requireVersion,
  scopeKey,
} from "./util.js";

export function createMemoryPromptStore(optionsOrInitial: PromptStoreOptions | readonly PromptRecord[] = {}): PromptStore {
  const options: PromptStoreOptions = Array.isArray(optionsOrInitial)
    ? { initial: optionsOrInitial as readonly PromptRecord[] }
    : (optionsOrInitial as PromptStoreOptions);
  const limits = resolvePromptLimits(options.limits);
  const fallback = normalizeOwnership(options.ownership);
  const records = new Map<string, Map<number, PromptRecord>>();
  const latest = new Map<string, PromptRecord>();
  const latestByLabel = new Map<string, Map<string, PromptRecord>>();

  for (const initial of options.initial ?? []) {
    const scope = normalizeOwnership(initial);
    const record = normalizeStoredPrompt(
      {
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        user_id: scope.userId,
        name: initial.name,
        version: initial.version,
        body: initial.body,
        hash: initial.hash,
        labels: initial.labels,
        metadata: initial.metadata,
        created_at: initial.createdAt,
      },
      limits,
    );
    const versions = records.get(scopeKey(scope, record.name)) ?? new Map<number, PromptRecord>();
    if (versions.has(record.version)) throw new PromptValidationError(`duplicate prompt version: ${record.name}@${record.version}`);
    const key = scopeKey(scope, record.name);
    versions.set(record.version, record);
    records.set(key, versions);
    if (!latest.has(key) || latest.get(key)!.version < record.version) latest.set(key, record);
    const labeled = latestByLabel.get(key) ?? new Map<string, PromptRecord>();
    for (const label of record.labels) {
      if (!labeled.has(label) || labeled.get(label)!.version < record.version) labeled.set(label, record);
    }
    latestByLabel.set(key, labeled);
  }

  const resolvePrompt = (input: PromptResolveInput): PromptRecord | null => {
    input.signal?.throwIfAborted();
    const scope = normalizeOwnership(input, fallback);
    const name = requireName(input.name, limits);
    const label = input.label === undefined ? undefined : requireLabel(input.label, limits);
    const versions = records.get(scopeKey(scope, name));
    if (!versions) return null;
    if (input.version !== undefined) {
      const record = versions.get(requireVersion(input.version));
      return record && (label === undefined || record.labels.includes(label)) ? record : null;
    }
    return label === undefined
      ? (latest.get(scopeKey(scope, name)) ?? null)
      : (latestByLabel.get(scopeKey(scope, name))?.get(label) ?? null);
  };

  return {
    async put(input: PutPromptInput): Promise<PromptRecord> {
      const scope = normalizeOwnership(input, fallback);
      const name = requireName(input.name, limits);
      const key = scopeKey(scope, name);
      const versions = records.get(key) ?? new Map<number, PromptRecord>();
      let version = 0;
      for (const candidate of versions.keys()) version = Math.max(version, candidate);
      version += 1;
      const record = preparePrompt(input, version, scope, limits, options.now ?? Date.now);
      versions.set(version, record);
      records.set(key, versions);
      latest.set(key, record);
      const labeled = latestByLabel.get(key) ?? new Map<string, PromptRecord>();
      for (const label of record.labels) labeled.set(label, record);
      latestByLabel.set(key, labeled);
      return record;
    },

    async list(query: PromptListQuery = {}) {
      query.signal?.throwIfAborted();
      const scope = normalizeOwnership(query, fallback);
      const name = query.name === undefined ? undefined : requireName(query.name, limits);
      const label = query.label === undefined ? undefined : requireLabel(query.label, limits);
      const order = query.order === "desc" ? "desc" : "asc";
      const cursor = decodePromptCursor(query.cursor, scope, { name, label, order }, limits);
      const pageSize = resolvePromptPageLimit(query.limit, limits);
      const all: PromptRecord[] = [];
      for (const versions of records.values()) {
        for (const record of versions.values()) {
          if (scopeKey(normalizeOwnership(record), record.name) !== scopeKey(scope, record.name)) continue;
          if (name !== undefined && record.name !== name) continue;
          if (label !== undefined && !record.labels.includes(label)) continue;
          if (comparePromptPosition(record.name, record.version, cursor, order) <= 0) continue;
          all.push(record);
        }
      }
      all.sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        const byVersion = a.version - b.version;
        const result = byName || byVersion;
        return order === "asc" ? result : -result;
      });
      const items = all.slice(0, pageSize);
      const next = all[pageSize];
      return {
        items: Object.freeze(items),
        ...(next === undefined
          ? {}
          : { nextCursor: encodePromptCursor(scope, { name, label, order }, items.at(-1)!.name, items.at(-1)!.version) }),
      };
    },

    async resolve(input: PromptResolveInput): Promise<PromptRecord | null> {
      return resolvePrompt(input);
    },

    async diff(first: PromptDiffInput | string, fromVersion?: number, toVersion?: number, ownership?: PromptOwnership) {
      const input =
        typeof first === "string"
          ? {
              name: first,
              fromVersion: requireVersion(fromVersion, "fromVersion"),
              toVersion: requireVersion(toVersion, "toVersion"),
              ...(ownership ?? {}),
            }
          : first;
      input.signal?.throwIfAborted();
      const from = resolvePrompt({ ...input, version: input.fromVersion });
      const to = resolvePrompt({ ...input, version: input.toVersion });
      if (!from || !to) throw new PromptNotFoundError(`${input.name}@${from ? input.toVersion : input.fromVersion} not found`);
      return diffPromptRecords(from, to, limits.maxDiffLines);
    },
  };
}

export function createPromptStoreOptions(options: PromptStoreOptions = {}): {
  readonly limits: PromptLimits;
  readonly ownership: NormalizedOwnership;
  readonly now: () => number;
} {
  return Object.freeze({
    limits: resolvePromptLimits(options.limits),
    ownership: normalizeOwnership(options.ownership),
    now: options.now ?? Date.now,
  });
}
