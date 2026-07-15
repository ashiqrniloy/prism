const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Validate a PostgreSQL identifier (schema/table/column name supplied by the host). */
export function validateIdentifier(name: string): void {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`Invalid PostgreSQL identifier: ${name}`);
  }
}

/** Double-quote a validated PostgreSQL identifier. */
export function quoteIdentifier(name: string): string {
  validateIdentifier(name);
  return `"${name}"`;
}

/** Return `schema.table` with both identifiers quoted and validated. */
export function qualifyTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

/** Stable 32-bit advisory-lock key derived from the schema name. */
export function schemaAdvisoryLockKey(schema: string): number {
  validateIdentifier(schema);
  let hash = 0;
  for (let i = 0; i < schema.length; i += 1) {
    hash = (hash * 31 + schema.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Namespace constant for `pg_advisory_xact_lock(key1, key2)` migration locks. */
export const MIGRATION_LOCK_NAMESPACE = 0x70726973;
