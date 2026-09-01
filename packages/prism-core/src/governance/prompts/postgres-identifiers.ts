import { PromptValidationError } from "./errors.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validatePromptIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value) || value.length > 63) throw new PromptValidationError(`${label} must be a safe SQL identifier`);
  return value;
}

export function quotePromptIdentifier(value: string): string {
  validatePromptIdentifier(value, "identifier");
  return `"${value}"`;
}

export function qualifyPromptTable(schema: string, table: string): string {
  return `${quotePromptIdentifier(schema)}.${quotePromptIdentifier(table)}`;
}
