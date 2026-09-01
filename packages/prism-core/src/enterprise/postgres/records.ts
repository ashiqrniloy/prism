import type { OwnershipScope } from "@arnilo/prism";
import { EnterprisePostgresError } from "./errors.js";

const MAX_CURSOR_BYTES = 4096;
const MAX_OWNER_BYTES = 512;

export interface StoreOwner extends OwnershipScope {
  readonly tenantId: string;
}

interface RecordCursor {
  readonly createdAt: string;
  readonly id: string;
  readonly order: "asc" | "desc";
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
}

export function requireStoreOwner(scope: OwnershipScope): StoreOwner {
  if (!scope.tenantId?.trim()) ownershipError();
  if (Buffer.byteLength(scope.tenantId, "utf8") > MAX_OWNER_BYTES) ownershipError();
  for (const value of [scope.accountId, scope.userId]) {
    if (value !== undefined && (!value.trim() || Buffer.byteLength(value, "utf8") > MAX_OWNER_BYTES)) ownershipError();
  }
  return {
    tenantId: scope.tenantId,
    ...(scope.accountId !== undefined ? { accountId: scope.accountId } : {}),
    ...(scope.userId !== undefined ? { userId: scope.userId } : {}),
  };
}

export function ownerParams(owner: StoreOwner): [string, string, string] {
  return [owner.tenantId, owner.accountId ?? "", owner.userId ?? ""];
}

export function encodeRecordCursor(createdAt: string, id: string, owner: StoreOwner, order: "asc" | "desc"): string {
  return Buffer.from(JSON.stringify({ createdAt, id, order, ...owner }), "utf8").toString("base64url");
}

export function decodeRecordCursor(cursor: string, owner: StoreOwner, order: "asc" | "desc"): Pick<RecordCursor, "createdAt" | "id"> {
  if (!cursor || Buffer.byteLength(cursor, "utf8") > MAX_CURSOR_BYTES) cursorError();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as RecordCursor;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !validText(parsed.createdAt) ||
      !validText(parsed.id) ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      parsed.order !== order ||
      parsed.tenantId !== owner.tenantId ||
      parsed.accountId !== owner.accountId ||
      parsed.userId !== owner.userId
    ) {
      cursorError();
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch (error) {
    if (error instanceof EnterprisePostgresError) throw error;
    cursorError();
  }
}

export function asTimestamp(value: unknown, label: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) boundsError(`${label} is invalid`);
  return date.toISOString();
}

export function requiredText(value: unknown, label: string, maxBytes = MAX_OWNER_BYTES): string {
  if (!validText(value) || Buffer.byteLength(value, "utf8") > maxBytes) boundsError(`${label} is invalid`);
  return value;
}

export function optionalText(value: unknown, label: string, maxBytes = MAX_OWNER_BYTES): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredText(value, label, maxBytes);
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function isSqlState(error: unknown, state: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === state);
}

export function storeError(error: unknown): EnterprisePostgresError {
  if (error instanceof EnterprisePostgresError) return error;
  return new EnterprisePostgresError(
    "Enterprise PostgreSQL store operation failed",
    isSqlState(error, "40001") || isSqlState(error, "40P01")
      ? "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE"
      : "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA",
  );
}

export function boundsError(message: string): never {
  throw new EnterprisePostgresError(message, "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS");
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ownershipError(): never {
  throw new EnterprisePostgresError("Exact tenant ownership is required", "ERR_PRISM_ENTERPRISE_POSTGRES_OWNERSHIP");
}

function cursorError(): never {
  throw new EnterprisePostgresError("Cursor is invalid for this owner/query", "ERR_PRISM_ENTERPRISE_POSTGRES_OWNERSHIP");
}
