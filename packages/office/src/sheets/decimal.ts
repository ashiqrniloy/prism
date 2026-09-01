/**
 * Decimal normalization and validation utilities for financial safety.
 *
 * CRITICAL SAFETY INVARIANT:
 * Money is always represented as exact decimal strings. Floating-point conversions
 * (Number(), parseFloat(), unary +) are strictly forbidden on decimal value paths.
 */

const CANONICAL_DECIMAL_REGEX = /^-?\d+(\.\d+)?$/;
const SCIENTIFIC_NOTATION_REGEX = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;

const CURRENCY_SYMBOLS_PREFIX = /^(?:[$€£¥₹元₩₱฿₫]|USD|EUR|GBP|CAD|AUD|JPY|INR|CNY|CHF)\s*/i;
const CURRENCY_SYMBOLS_SUFFIX = /\s*(?:[$€£¥₹元₩₱฿₫]|USD|EUR|GBP|CAD|AUD|JPY|INR|CNY|CHF)$/i;

/**
 * Checks if a string is already in canonical decimal format (e.g. "1234.56", "-0.05", "42").
 */
export function isCanonicalDecimal(str: string): boolean {
  return CANONICAL_DECIMAL_REGEX.test(str);
}

/**
 * Checks if a string contains scientific notation (e.g. "1.23e5", "4.56E-3").
 */
export function isScientificNotation(str: string): boolean {
  return SCIENTIFIC_NOTATION_REGEX.test(str.trim());
}

/**
 * Checks if a string contains explicit currency symbols or currency ISO codes.
 */
export function isCurrencyString(str: string): boolean {
  const trimmed = str.trim();
  return (
    CURRENCY_SYMBOLS_PREFIX.test(trimmed) ||
    CURRENCY_SYMBOLS_SUFFIX.test(trimmed) ||
    trimmed.startsWith("($") ||
    trimmed.startsWith("(€") ||
    trimmed.startsWith("(£")
  );
}

export interface NormalizedDecimalResult {
  /** Canonical decimal string (e.g. "1234.56", "-1234.56", "42"). */
  readonly value: string;
  /** True if currency symbols, grouping separators, or accounting parentheses were detected. */
  readonly isMoney: boolean;
}

/**
 * Normalizes a raw string representation of a decimal or currency number into a canonical decimal string.
 * Returns `null` if the string cannot be safely and unambiguously normalized.
 *
 * @param input Raw token or cell text.
 * @returns Canonical decimal string result or `null`.
 */
export function normalizeDecimal(input: string): NormalizedDecimalResult | null {
  let str = input.trim();
  if (str === "") return null;

  // Explicitly reject scientific notation from decimal normalization (must be flagged as ambiguous/string)
  if (SCIENTIFIC_NOTATION_REGEX.test(str)) {
    return null;
  }

  let isNegative = false;
  let isMoney = false;

  // 1. Accounting-style parenthesis negative: (1,234.56) or ($1,234.56)
  if (str.startsWith("(") && str.endsWith(")")) {
    isNegative = true;
    isMoney = true;
    str = str.slice(1, -1).trim();
  }

  // 2. Standard leading/trailing negative signs
  if (str.startsWith("-") || str.startsWith("−")) {
    isNegative = true;
    str = str.slice(1).trim();
  } else if (str.endsWith("-") || str.endsWith("−")) {
    isNegative = true;
    str = str.slice(0, -1).trim();
  }

  // 3. Strip currency symbols
  if (CURRENCY_SYMBOLS_PREFIX.test(str)) {
    isMoney = true;
    str = str.replace(CURRENCY_SYMBOLS_PREFIX, "").trim();
  }
  if (CURRENCY_SYMBOLS_SUFFIX.test(str)) {
    isMoney = true;
    str = str.replace(CURRENCY_SYMBOLS_SUFFIX, "").trim();
  }

  // Negative sign could have been nested inside currency symbol e.g. $-100
  if (str.startsWith("-") || str.startsWith("−")) {
    isNegative = true;
    str = str.slice(1).trim();
  }

  // 4. Pure integer digits: "12345"
  if (/^\d+$/.test(str)) {
    const val = (isNegative ? "-" : "") + str;
    return { value: val, isMoney };
  }

  // 5. US/UK thousands grouping: "1,234,567.89" or "1,234"
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(str)) {
    const val = (isNegative ? "-" : "") + str.replace(/,/g, "");
    return { value: val, isMoney: true };
  }

  // 6. Indian thousands grouping: "1,00,000.50" or "10,00,000"
  if (/^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/.test(str)) {
    const val = (isNegative ? "-" : "") + str.replace(/,/g, "");
    return { value: val, isMoney: true };
  }

  // 7. EU thousands grouping with comma decimal: "1.234.567,89" or "1.234"
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
    const val = (isNegative ? "-" : "") + str.replace(/\./g, "").replace(/,/g, ".");
    return { value: val, isMoney: true };
  }

  // 8. Standard single dot decimal without thousands: "1234.56" or ".56"
  if (/^\d*\.\d+$/.test(str)) {
    const canonicalStr = str.startsWith(".") ? `0${str}` : str;
    const val = (isNegative ? "-" : "") + canonicalStr;
    return { value: val, isMoney };
  }

  // 9. Single comma decimal without thousands: "1234,56" or ",56"
  if (/^\d*,\d+$/.test(str)) {
    const canonicalStr = str.startsWith(",") ? `0.${str.slice(1)}` : str.replace(/,/, ".");
    const val = (isNegative ? "-" : "") + canonicalStr;
    return { value: val, isMoney };
  }

  return null;
}
