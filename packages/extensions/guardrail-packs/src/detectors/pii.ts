/**
 * Personal-data detectors (plan 237 Task 2). Pure data: a global pattern with bounded quantifiers and
 * an optional `accept` check over the matched text. Starts are anchored with lookbehinds, so a long
 * run of word characters is not re-scanned from every position.
 */
import type { ContentDetector } from "./types.js";

/** `local@domain.tld`; the local part starts at a non-address character. */
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;

/**
 * Grouped phone numbers: an optional `+country` prefix, then an area group (parenthesized or followed
 * by a separator), then two digit groups. A bare digit run never matches, so card numbers, ids, and
 * timestamps do not read as phones.
 */
const PHONE = /(?<![\w+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]?\d{3,4}(?![\w])/g;

/** 13–19 digits, optionally grouped by single spaces or dashes; `accept` applies the Luhn checksum. */
const PAYMENT_CARD = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d])/g;

/**
 * National-id shapes: a US SSN (`AAA-GG-SSSS`, excluding the never-issued 000/666/9xx areas and
 * all-zero groups) and a UK National Insurance number (`AB 12 34 56 C`, excluding unused prefixes).
 */
const NATIONAL_ID =
  /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])|(?<![A-Za-z0-9])(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D](?![A-Za-z0-9])/g;

/** The Luhn checksum over the digits of `text` (separators ignored). */
export function luhnValid(text: string): boolean {
  let sum = 0;
  let double = false;
  let digits = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const code = text.charCodeAt(index) - 48;
    if (code < 0 || code > 9) continue;
    digits += 1;
    let value = code;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return digits >= 13 && digits <= 19 && sum % 10 === 0;
}

function phoneDigits(text: string): boolean {
  let digits = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 48 && code <= 57) digits += 1;
  }
  return digits >= 9 && digits <= 15;
}

export const PII_DETECTORS: readonly ContentDetector[] = [
  { id: "email", pattern: EMAIL },
  { id: "phone", pattern: PHONE, accept: phoneDigits },
  { id: "payment-card", pattern: PAYMENT_CARD, accept: luhnValid },
  { id: "national-id", pattern: NATIONAL_ID },
];
