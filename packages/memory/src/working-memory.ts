import type { JsonObject } from "@arnilo/prism";
import { MemoryConflictError, MemoryValidationError } from "./errors.js";
import {
  assertByteLimit,
  assertNotAborted,
  cloneJsonObject,
  mergeJsonObjects,
  requireScope,
  scopeKey,
} from "./util.js";
import type {
  WorkingMemoryKey,
  WorkingMemoryRecord,
  WorkingMemoryStore,
  WorkingMemoryUpdateOptions,
} from "./types.js";

export interface MemoryWorkingStoreOptions {
  readonly maxWorkingMemoryBytes?: number;
}

export function createMemoryWorkingStore(options: MemoryWorkingStoreOptions = {}): WorkingMemoryStore {
  const maxWorkingMemoryBytes = options.maxWorkingMemoryBytes ?? 256 * 1024;
  const records = new Map<string, WorkingMemoryRecord>();

  return {
    async get(key, getOptions = {}) {
      assertNotAborted(getOptions.signal);
      const scope = requireScope(key);
      return records.get(scopeKey(scope));
    },

    async set(record, setOptions = {}) {
      assertNotAborted(setOptions.signal);
      const scope = requireScope(record);
      if (!Number.isInteger(record.version) || record.version < 1) {
        throw new MemoryValidationError("version must be an integer >= 1");
      }
      assertByteLimit(record.value, maxWorkingMemoryBytes, "working memory");
      records.set(scopeKey(scope), Object.freeze({
        ...scope,
        value: cloneJsonObject(record.value),
        version: record.version,
        updatedAt: record.updatedAt,
      }));
    },

    async update(key, patch, updateOptions: WorkingMemoryUpdateOptions = {}) {
      assertNotAborted(updateOptions.signal);
      const scope = requireScope(key);
      const id = scopeKey(scope);
      const existing = records.get(id);
      if (updateOptions.expectedVersion !== undefined) {
        const currentVersion = existing?.version ?? 0;
        if (currentVersion !== updateOptions.expectedVersion) {
          throw new MemoryConflictError(
            `working memory version conflict: expected ${updateOptions.expectedVersion}, found ${currentVersion}`,
          );
        }
      }
      const mode = updateOptions.mode ?? "merge";
      const nextValue =
        mode === "replace"
          ? cloneJsonObject(patch)
          : mergeJsonObjects(existing?.value ?? {}, patch);
      assertByteLimit(nextValue, maxWorkingMemoryBytes, "working memory");
      const next: WorkingMemoryRecord = Object.freeze({
        ...scope,
        value: nextValue,
        version: (existing?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      });
      records.set(id, next);
      return next;
    },

    async delete(key, deleteOptions = {}) {
      assertNotAborted(deleteOptions.signal);
      const scope = requireScope(key);
      return records.delete(scopeKey(scope));
    },
  };
}

export async function validateWorkingValue(
  value: JsonObject,
  options: {
    readonly schema?: JsonObject;
    readonly validateWorkingMemory?: (
      value: JsonObject,
    ) => void | string | Error | Promise<void | string | Error>;
    readonly validateAgainstJsonSchema: (value: unknown, schema: JsonObject) => void;
  },
): Promise<void> {
  if (options.schema) options.validateAgainstJsonSchema(value, options.schema);
  if (options.validateWorkingMemory) {
    const result = await options.validateWorkingMemory(value);
    if (typeof result === "string") throw new MemoryValidationError(result);
    if (result instanceof Error) throw result;
  }
}
