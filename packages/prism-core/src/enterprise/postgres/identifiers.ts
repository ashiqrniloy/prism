import { EnterprisePostgresError } from "./errors.js";

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Validate host-supplied schema identifiers before SQL construction. */
export function validateIdentifier(value: string): void {
  if (!IDENTIFIER_RE.test(value)) {
    throw new EnterprisePostgresError("PostgreSQL identifier is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG");
  }
}

/** Quote a validated PostgreSQL identifier. */
export function quoteIdentifier(value: string): string {
  validateIdentifier(value);
  return `"${value}"`;
}

/** Qualified fixed enterprise table name. */
export function qualifyTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

/** Stable per-schema advisory-lock key. */
export function schemaAdvisoryLockKey(schema: string): number {
  validateIdentifier(schema);
  let hash = 0;
  for (let index = 0; index < schema.length; index += 1) hash = (hash * 31 + schema.charCodeAt(index)) | 0;
  return hash;
}

/** Separate namespace from session-store migrations. */
export const ENTERPRISE_MIGRATION_LOCK_NAMESPACE = 0x656e7472;
