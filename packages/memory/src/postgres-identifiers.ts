import { MemoryValidationError } from "./errors.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value) || value.length > 63) {
    throw new MemoryValidationError(`${label} must be a safe SQL identifier`);
  }
  return value;
}

export function quoteIdentifier(value: string): string {
  validateIdentifier(value, "identifier");
  return `"${value}"`;
}

export function qualifyTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}
