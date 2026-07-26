import { MemoryValidationError } from "./errors.js";
import type { MemoryVectorOrder, MemoryVectorRecord } from "./types.js";

interface MemoryCursor {
  readonly order: MemoryVectorOrder;
  readonly value: number;
  readonly sequence: number;
  readonly id: string;
}

export function encodeMemoryCursor(record: MemoryVectorRecord, order: MemoryVectorOrder): string {
  const value = order === "sequence" ? record.sequence : Date.parse(record.createdAt);
  if (!Number.isFinite(value)) throw new MemoryValidationError("record.createdAt must be a valid timestamp");
  return Buffer.from(JSON.stringify({ order, value, sequence: record.sequence, id: record.id })).toString("base64url");
}

export function decodeMemoryCursor(cursor: string | undefined, order: MemoryVectorOrder): MemoryCursor | undefined {
  if (cursor === undefined) return undefined;
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 4096) {
    throw new MemoryValidationError("memory cursor must be a non-empty string up to 4096 characters");
  }
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<MemoryCursor>;
    if (
      value.order !== order
      || !Number.isFinite(value.value)
      || !Number.isInteger(value.sequence)
      || typeof value.id !== "string"
      || value.id.length === 0
    ) throw new Error("invalid cursor");
    return value as MemoryCursor;
  } catch {
    throw new MemoryValidationError("memory cursor is invalid");
  }
}

export function compareMemoryRecord(
  record: MemoryVectorRecord,
  cursor: MemoryCursor | undefined,
  order: MemoryVectorOrder,
): number {
  const value = memoryOrderValue(record, order);
  if (!cursor) return 1;
  return value - cursor.value || record.sequence - cursor.sequence || record.id.localeCompare(cursor.id);
}

export function compareMemoryRecords(a: MemoryVectorRecord, b: MemoryVectorRecord, order: MemoryVectorOrder): number {
  return memoryOrderValue(a, order) - memoryOrderValue(b, order) || a.sequence - b.sequence || a.id.localeCompare(b.id);
}

function memoryOrderValue(record: MemoryVectorRecord, order: MemoryVectorOrder): number {
  const value = order === "sequence" ? record.sequence : Date.parse(record.createdAt);
  if (!Number.isFinite(value)) throw new MemoryValidationError("record.createdAt must be a valid timestamp");
  return value;
}
