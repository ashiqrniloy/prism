/** The memory trust scan (plan 216 Task 3: moved from the fabric so the wiki runs it unchanged without memory). */
import { MemoryValidationError } from "./errors.js";

// Variation selectors (U+FE00-U+FE0F) combine with the preceding character, so they need an
// alternation instead of a character class (biome noMisleadingCharacterClass).
const INVISIBLE = /(?:[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]|[\uFE00-\uFE0F])/;
// `curl -s https://` and other bounded flag forms are commands too; the gap is capped so this
// cannot scan a whole note.
const EXFIL = /\b(?:curl|wget)\b[^\n]{0,80}?https?:\/\/|\bexfiltrat|\/etc\/passwd|\binvoke-webrequest\b/i;
const INJECT =
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b|\bdisregard\s+(?:all\s+)?(?:previous|prior)\s+instructions\b|\byou\s+are\s+now\b|\bsystem\s+prompt\b|\bjailbreak\b/i;

/**
 * Strip only invisible code points that have a normal textual use: emoji variation selectors and
 * ZWJ sequences, spacing/bidi marks next to whitespace or punctuation, the math function-application
 * mark, and a soft hyphen inside mojibake. Deliberately hidden code points between letters (the
 * adversarial shape) survive and are refused. Exchange archive scans and stores this form.
 */
export function normalizeScopedMemoryContent(text: string): string {
  if (typeof text !== "string") return text;
  return text
    .replace(/\u2061/gu, "")
    .replace(/(?<=\p{Extended_Pictographic})\uFE0F/gu, "")
    .replace(/(?<=[0-9#*])\uFE0F(?=\u20E3)/gu, "")
    .replace(/(?<=\p{Extended_Pictographic})\u200D(?=\p{Extended_Pictographic})/gu, "")
    .replace(/(?<=\p{Extended_Pictographic})\u200D(?=$|[^\p{L}])/gu, "")
    .replace(/(^|[\s\p{P}\p{S}])\u200B/gu, "$1")
    .replace(/\u200B(?=$|[\s\p{P}\p{S}])/gu, "")
    .replace(/(?<=[^\x00-\x7F])\u200B|\u200B(?=[^\x00-\x7F])/gu, "")
    .replace(/(^|[\s\p{P}\p{S}])[\u200E\u200F](?=$|[\s\p{P}\p{S}])/gu, "$1")
    .replace(/(^|\n\s*(?:[>*+-]\s+)?)\uFEFF/gu, "$1")
    .replace(/(?<=[\u0080-\u00FF])\u00AD|\u00AD(?=[\u0080-\u00FF])/gu, "");
}

export function scanScopedMemoryContent(
  text: string,
): { readonly ok: true } | { readonly ok: false; readonly class: "prompt-injection" | "exfil" | "invisible-unicode" } {
  if (typeof text !== "string") return { ok: false, class: "prompt-injection" };
  const normalized = normalizeScopedMemoryContent(text);
  if (INVISIBLE.test(normalized)) return { ok: false, class: "invisible-unicode" };
  if (EXFIL.test(normalized)) return { ok: false, class: "exfil" };
  if (INJECT.test(normalized)) return { ok: false, class: "prompt-injection" };
  return { ok: true };
}

export function gateScopedMemoryContent(text: string): void {
  const scan = scanScopedMemoryContent(text);
  if (!scan.ok) throw new MemoryValidationError(`scoped memory refused: ${scan.class}`);
}
