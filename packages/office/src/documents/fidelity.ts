import type { DocumentKind } from "./types.js";

/** Cap on reported lost-structure issues (truncated after this). */
export const HARD_FIDELITY_ISSUES = 256;
const HARD_ZIP_ENTRIES = 8192;

export type ImportFidelityLost = "dropped" | "approximated";

export interface ImportFidelityIssue {
  readonly code: string;
  readonly part?: string;
  readonly lost: ImportFidelityLost;
}

export interface ImportFidelityReport {
  readonly kind: DocumentKind;
  readonly issues: readonly ImportFidelityIssue[];
  readonly truncated: boolean;
}

const EOCD = 0x06054b50;
const CDFH = 0x02014b50;

const RULES: ReadonlyArray<{ readonly match: RegExp; readonly code: string; readonly lost: ImportFidelityLost }> = [
  { match: /(^|\/)vbaProject/i, code: "macros", lost: "dropped" },
  { match: /EncryptionInfo|EncryptedPackage/i, code: "encrypted", lost: "dropped" },
  { match: /^word\/comments/i, code: "comments", lost: "dropped" },
  { match: /^xl\/(comments|threadedComments)/i, code: "comments", lost: "dropped" },
  { match: /^word\/(header|footer)\d/i, code: "headers-footers", lost: "dropped" },
  { match: /\/embeddings\//i, code: "embedded-ole", lost: "dropped" },
  { match: /\/media\//i, code: "media", lost: "dropped" },
  { match: /\/charts\//i, code: "charts", lost: "dropped" },
  { match: /\/diagrams\//i, code: "smartart", lost: "dropped" },
  { match: /^xl\/pivot/i, code: "pivot-tables", lost: "dropped" },
  { match: /^xl\/externalLinks/i, code: "external-links", lost: "dropped" },
  { match: /(^|\/)drawings\//i, code: "drawings", lost: "dropped" },
  { match: /customXml/i, code: "custom-xml", lost: "dropped" },
];

function u16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) return 0;
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (u32(bytes, i) === EOCD) return i;
  }
  return -1;
}

/** Local-file names from the ZIP central directory — no inflate. */
export function listZipEntryNames(bytes: Uint8Array): { readonly names: readonly string[]; readonly zip64: boolean } {
  const eocd = findEocd(bytes);
  if (eocd < 0) return { names: [], zip64: false };
  const entries = u16(bytes, eocd + 10);
  const cdOffset = u32(bytes, eocd + 16);
  if (cdOffset === 0xffffffff || entries === 0xffff) return { names: [], zip64: true };
  const names: string[] = [];
  let off = cdOffset;
  const n = Math.min(entries, HARD_ZIP_ENTRIES);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let i = 0; i < n; i += 1) {
    if (off + 46 > bytes.length || u32(bytes, off) !== CDFH) break;
    const nameLen = u16(bytes, off + 28);
    const extraLen = u16(bytes, off + 30);
    const commentLen = u16(bytes, off + 32);
    const nameStart = off + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > bytes.length) break;
    names.push(decoder.decode(bytes.subarray(nameStart, nameEnd)));
    off = nameEnd + extraLen + commentLen;
  }
  return { names, zip64: false };
}

export function reportImportFidelity(bytes: Uint8Array, kind: DocumentKind): ImportFidelityReport {
  const { names, zip64 } = listZipEntryNames(bytes);
  const issues: ImportFidelityIssue[] = [];
  if (zip64) issues.push({ code: "zip64", lost: "dropped" });
  for (const part of names) {
    if (issues.length >= HARD_FIDELITY_ISSUES) break;
    const rule = RULES.find((candidate) => candidate.match.test(part));
    if (!rule) continue;
    issues.push({ code: rule.code, part, lost: rule.lost });
  }
  return {
    kind,
    issues: Object.freeze(issues.slice(0, HARD_FIDELITY_ISSUES)),
    truncated: issues.length > HARD_FIDELITY_ISSUES || names.length >= HARD_ZIP_ENTRIES,
  };
}
