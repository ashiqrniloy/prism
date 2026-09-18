/**
 * Decimal normalization and validation utilities for financial safety.
 *
 * CRITICAL SAFETY INVARIANT:
 * Money is always represented as exact decimal strings. Floating-point conversions
 * (Number(), parseFloat(), unary +) are strictly forbidden on decimal value paths.
 *
 * All checks are linear scans bounded by MAX_DECIMAL_INPUT_LENGTH to eliminate
 * polynomial ReDoS. No regex with nested quantifiers is used on attacker-controlled
 * strings.
 */

const MAX_DECIMAL_INPUT_LENGTH = 8192;

const CURRENCY_TOKENS = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "INR",
  "CNY",
  "CHF",
  "$",
  "€",
  "£",
  "¥",
  "₹",
  "元",
  "₩",
  "₱",
  "฿",
  "₫",
] as const;

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isWs(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

function allDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) if (!isDigit(s[i]!)) return false;
  return true;
}

function hasCurrencyPrefix(s: string): boolean {
  const up = s.toUpperCase();
  for (const tok of CURRENCY_TOKENS) {
    if (up.startsWith(tok.toUpperCase())) return true;
  }
  return false;
}

function hasCurrencySuffix(s: string): boolean {
  const up = s.toUpperCase();
  for (const tok of CURRENCY_TOKENS) {
    if (up.endsWith(tok.toUpperCase())) return true;
  }
  return false;
}

function stripCurrencyPrefix(s: string): { rest: string; stripped: boolean } {
  const up = s.toUpperCase();
  for (const tok of CURRENCY_TOKENS) {
    const tUp = tok.toUpperCase();
    if (up.startsWith(tUp)) {
      let rest = s.slice(tok.length);
      let i = 0;
      while (i < rest.length && isWs(rest[i]!)) i++;
      rest = rest.slice(i);
      return { rest, stripped: true };
    }
  }
  return { rest: s, stripped: false };
}

function stripCurrencySuffix(s: string): { rest: string; stripped: boolean } {
  const up = s.toUpperCase();
  for (const tok of CURRENCY_TOKENS) {
    const tUp = tok.toUpperCase();
    if (up.endsWith(tUp)) {
      let rest = s.slice(0, s.length - tok.length);
      let i = rest.length - 1;
      while (i >= 0 && isWs(rest[i]!)) i--;
      rest = rest.slice(0, i + 1);
      return { rest, stripped: true };
    }
  }
  return { rest: s, stripped: false };
}

// --- canonical / scientific helpers (linear, bounded) ---

/**
 * Checks if a string is already in canonical decimal format (e.g. "1234.56", "-0.05", "42").
 */
export function isCanonicalDecimal(str: string): boolean {
  if (str.length === 0 || str.length > MAX_DECIMAL_INPUT_LENGTH) return false;
  let i = 0;
  if (str[0] === "-") {
    i = 1;
    if (i >= str.length) return false;
  }
  let digits = 0;
  while (i < str.length && isDigit(str[i]!)) {
    digits++;
    i++;
  }
  if (digits === 0) return false;
  if (i === str.length) return true;
  if (str[i] !== ".") return false;
  i++;
  digits = 0;
  while (i < str.length && isDigit(str[i]!)) {
    digits++;
    i++;
  }
  return digits > 0 && i === str.length;
}

/**
 * Checks if a string contains scientific notation (e.g. "1.23e5", "4.56E-3").
 */
export function isScientificNotation(str: string): boolean {
  const s = str.trim();
  if (s.length === 0 || s.length > MAX_DECIMAL_INPUT_LENGTH) return false;
  let i = 0;
  if (s[i] === "+" || s[i] === "-") i++;
  let intDigits = 0;
  while (i < s.length && isDigit(s[i]!)) {
    intDigits++;
    i++;
  }
  if (intDigits === 0) return false;
  if (i < s.length && s[i] === ".") {
    i++;
    let frac = 0;
    while (i < s.length && isDigit(s[i]!)) {
      frac++;
      i++;
    }
    if (frac === 0) return false;
  }
  if (i >= s.length) return false;
  if (s[i] !== "e" && s[i] !== "E") return false;
  i++;
  if (i < s.length && (s[i] === "+" || s[i] === "-")) i++;
  let exp = 0;
  while (i < s.length && isDigit(s[i]!)) {
    exp++;
    i++;
  }
  return exp > 0 && i === s.length;
}

/**
 * Checks if a string contains explicit currency symbols or currency ISO codes.
 */
export function isCurrencyString(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DECIMAL_INPUT_LENGTH) return false;
  if (hasCurrencyPrefix(trimmed) || hasCurrencySuffix(trimmed)) return true;
  if (trimmed.startsWith("($") || trimmed.startsWith("(€") || trimmed.startsWith("(£")) return true;
  return false;
}

export interface NormalizedDecimalResult {
  /** Canonical decimal string (e.g. "1234.56", "-1234.56", "42"). */
  readonly value: string;
  /** True if currency symbols, grouping separators, or accounting parentheses were detected. */
  readonly isMoney: boolean;
}

// --- grouping helpers (all linear, bounded via length + split) ---

function isPureDigits(s: string): boolean {
  return allDigits(s);
}

function isUSGrouping(s: string): boolean {
  if (s.length === 0 || s.length > MAX_DECIMAL_INPUT_LENGTH) return false;
  const dotIdx = s.indexOf(".");
  if (dotIdx !== -1 && s.indexOf(".", dotIdx + 1) !== -1) return false;
  let intPart: string;
  let fracPart: string | null = null;
  if (dotIdx !== -1) {
    intPart = s.slice(0, dotIdx);
    fracPart = s.slice(dotIdx + 1);
    if (fracPart.length === 0 || !allDigits(fracPart)) return false;
  } else {
    intPart = s;
  }
  if (intPart.length === 0 || !intPart.includes(",")) return false;
  const parts = intPart.split(",");
  if (parts.length < 2) return false;
  const first = parts[0]!;
  if (first.length < 1 || first.length > 3 || !allDigits(first)) return false;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.length !== 3 || !allDigits(p)) return false;
  }
  return true;
}

function isIndianGrouping(s: string): boolean {
  if (s.length === 0 || s.length > MAX_DECIMAL_INPUT_LENGTH) return false;
  const dotIdx = s.indexOf(".");
  if (dotIdx !== -1 && s.indexOf(".", dotIdx + 1) !== -1) return false;
  let intPart: string;
  let fracPart: string | null = null;
  if (dotIdx !== -1) {
    intPart = s.slice(0, dotIdx);
    fracPart = s.slice(dotIdx + 1);
    if (fracPart.length === 0 || !allDigits(fracPart)) return false;
  } else {
    intPart = s;
  }
  if (intPart.length === 0 || !intPart.includes(",")) return false;
  const parts = intPart.split(",");
  if (parts.length < 2) return false;
  const first = parts[0]!;
  if (first.length < 1 || first.length > 2 || !allDigits(first)) return false;
  const last = parts[parts.length - 1]!;
  if (last.length !== 3 || !allDigits(last)) return false;
  for (let i = 1; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (p.length !== 2 || !allDigits(p)) return false;
  }
  return true;
}

function isEUGrouping(s: string): boolean {
  if (s.length === 0 || s.length > MAX_DECIMAL_INPUT_LENGTH) return false;
  const commaIdx = s.indexOf(",");
  if (commaIdx !== -1 && s.indexOf(",", commaIdx + 1) !== -1) return false;
  let intPart: string;
  let fracPart: string | null = null;
  if (commaIdx !== -1) {
    intPart = s.slice(0, commaIdx);
    fracPart = s.slice(commaIdx + 1);
    if (fracPart.length === 0 || !allDigits(fracPart)) return false;
  } else {
    intPart = s;
  }
  if (intPart.length === 0 || !intPart.includes(".")) return false;
  const parts = intPart.split(".");
  if (parts.length < 2) return false;
  const first = parts[0]!;
  if (first.length < 1 || first.length > 3 || !allDigits(first)) return false;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.length !== 3 || !allDigits(p)) return false;
  }
  return true;
}

function isDotDecimal(s: string): boolean {
  if (s.length === 0 || s.length > MAX_DECIMAL_INPUT_LENGTH) return false;
  const dotIdx = s.indexOf(".");
  if (dotIdx === -1) return false;
  if (s.indexOf(".", dotIdx + 1) !== -1) return false;
  if (s.includes(",")) return false;
  const before = s.slice(0, dotIdx);
  const after = s.slice(dotIdx + 1);
  if (after.length === 0 || !allDigits(after)) return false;
  if (before.length === 0) return true;
  return allDigits(before);
}

function isCommaDecimal(s: string): boolean {
  if (s.length === 0 || s.length > MAX_DECIMAL_INPUT_LENGTH) return false;
  const commaIdx = s.indexOf(",");
  if (commaIdx === -1) return false;
  if (s.indexOf(",", commaIdx + 1) !== -1) return false;
  if (s.includes(".")) return false;
  const before = s.slice(0, commaIdx);
  const after = s.slice(commaIdx + 1);
  if (after.length === 0 || !allDigits(after)) return false;
  if (before.length === 0) return true;
  return allDigits(before);
}

/**
 * Normalizes a raw string representation of a decimal or currency number into a canonical decimal string.
 * Returns `null` if the string cannot be safely and unambiguously normalized.
 *
 * @param input Raw token or cell text.
 * @returns Canonical decimal string result or `null`.
 */
export function normalizeDecimal(input: string): NormalizedDecimalResult | null {
  if (input.length > MAX_DECIMAL_INPUT_LENGTH) return null;
  let str = input.trim();
  if (str === "") return null;
  if (str.length > MAX_DECIMAL_INPUT_LENGTH) return null;

  // Explicitly reject scientific notation from decimal normalization (must be flagged as ambiguous/string)
  if (isScientificNotation(str)) return null;

  let isNegative = false;
  let isMoney = false;

  // 1. Accounting-style parenthesis negative: (1,234.56) or ($1,234.56)
  if (str.startsWith("(") && str.endsWith(")")) {
    isNegative = true;
    isMoney = true;
    str = str.slice(1, -1).trim();
    if (str.length === 0 || str.length > MAX_DECIMAL_INPUT_LENGTH) return null;
  }

  // 2. Standard leading/trailing negative signs
  if (str.startsWith("-") || str.startsWith("−")) {
    isNegative = true;
    str = str.slice(1).trim();
  } else if (str.endsWith("-") || str.endsWith("−")) {
    isNegative = true;
    str = str.slice(0, -1).trim();
  }
  if (str.length === 0) return null;

  // 3. Strip currency symbols
  {
    const pre = stripCurrencyPrefix(str);
    if (pre.stripped) {
      isMoney = true;
      str = pre.rest.trim();
    }
  }
  {
    const suf = stripCurrencySuffix(str);
    if (suf.stripped) {
      isMoney = true;
      str = suf.rest.trim();
    }
  }
  if (str.length === 0) return null;

  // Negative sign could have been nested inside currency symbol e.g. $-100
  if (str.startsWith("-") || str.startsWith("−")) {
    isNegative = true;
    str = str.slice(1).trim();
    if (str.length === 0) return null;
  }

  // 4. Pure integer digits: "12345"
  if (isPureDigits(str)) {
    const val = (isNegative ? "-" : "") + str;
    return { value: val, isMoney };
  }

  // 5. US/UK thousands grouping: "1,234,567.89" or "1,234"
  if (isUSGrouping(str)) {
    const val = (isNegative ? "-" : "") + str.replaceAll(",", "");
    return { value: val, isMoney: true };
  }

  // 6. Indian thousands grouping: "1,00,000.50" or "10,00,000"
  if (isIndianGrouping(str)) {
    const val = (isNegative ? "-" : "") + str.replaceAll(",", "");
    return { value: val, isMoney: true };
  }

  // 7. EU thousands grouping with comma decimal: "1.234.567,89" or "1.234"
  if (isEUGrouping(str)) {
    const val = (isNegative ? "-" : "") + str.replaceAll(".", "").replaceAll(",", ".");
    return { value: val, isMoney: true };
  }

  // 8. Standard single dot decimal without thousands: "1234.56" or ".56"
  if (isDotDecimal(str)) {
    const canonicalStr = str.startsWith(".") ? `0${str}` : str;
    const val = (isNegative ? "-" : "") + canonicalStr;
    return { value: val, isMoney };
  }

  // 9. Single comma decimal without thousands: "1234,56" or ",56"
  if (isCommaDecimal(str)) {
    const canonicalStr = str.startsWith(",") ? `0.${str.slice(1)}` : str.replace(",", ".");
    const val = (isNegative ? "-" : "") + canonicalStr;
    return { value: val, isMoney };
  }

  return null;
}
