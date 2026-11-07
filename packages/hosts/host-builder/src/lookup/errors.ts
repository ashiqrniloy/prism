import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ErrorCodeRecord, ErrorsIndex } from "../indexes.js";
import { nearest } from "./text.js";

export interface PitfallRow {
  readonly code: string;
  readonly whatHappened: string;
  readonly fix: string;
}

export interface ErrorsResult {
  readonly found: boolean;
  readonly matches: readonly ErrorMatch[];
  readonly nearest: readonly string[];
  readonly note?: string;
}

export interface ErrorMatch {
  readonly code: string;
  readonly package: string;
  /** The declaring file and line: `src/driver-kit/errors.ts:26`. */
  readonly declared: string;
  readonly errorClass: string | null;
  readonly meaning: string | null;
  readonly sampleMessage: string | null;
  readonly docs: readonly string[];
  /** From `references/pitfalls.md`, when the skill lists the code. */
  readonly pitfall?: { readonly whatHappened: string; readonly fix: string };
}

const PITFALLS_FILE = new URL("../../skills/prism-host-builder/references/pitfalls.md", import.meta.url);

let pitfallsCache: ReadonlyMap<string, PitfallRow> | undefined;

/** Rows of every markdown table whose first column is a backticked code. */
export function parsePitfalls(markdown: string): Map<string, PitfallRow> {
  const rows = new Map<string, PitfallRow>();
  for (const line of markdown.split("\n")) {
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const code = /^`([A-Za-z0-9_]+)`$/.exec(cells[0] ?? "")?.[1];
    if (code === undefined || rows.has(code)) continue;
    rows.set(code, { code, whatHappened: cells[1] ?? "", fix: cells.slice(2).join(" | ") });
  }
  return rows;
}

/** The pitfalls the skill ships, read once. An absent file (a tree without the skill) yields no rows. */
export function loadPitfalls(): ReadonlyMap<string, PitfallRow> {
  const file = fileURLToPath(PITFALLS_FILE);
  pitfallsCache ??= existsSync(file) ? parsePitfalls(readFileSync(file, "utf8")) : new Map();
  return pitfallsCache;
}

function toMatch(record: ErrorCodeRecord, pitfalls: ReadonlyMap<string, PitfallRow>): ErrorMatch {
  const pitfall = pitfalls.get(record.code);
  return {
    code: record.code,
    package: record.package,
    declared: `${record.file}:${record.line}`,
    errorClass: record.errorClass,
    meaning: record.meaning,
    sampleMessage: record.sampleMessage,
    docs: record.docs,
    ...(pitfall !== undefined ? { pitfall: { whatHappened: pitfall.whatHappened, fix: pitfall.fix } } : {}),
  };
}

/**
 * An error code's meaning, owner, declaration site, docs and the fix `pitfalls.md` lists. The match is exact
 * and case-sensitive. A code can be declared by more than one package, so the result is a list. An unknown code
 * returns `found: false` and the nearest codes, never an exception.
 */
export function lookupError(index: ErrorsIndex, code: string, pitfalls: ReadonlyMap<string, PitfallRow> = loadPitfalls()): ErrorsResult {
  const wanted = code.trim();
  const exact = index.codes.filter((record) => record.code === wanted);
  if (exact.length > 0) return { found: true, matches: exact.map((record) => toMatch(record, pitfalls)), nearest: [] };
  return {
    found: false,
    matches: [],
    nearest: nearest(
      index.codes.map((record) => record.code),
      wanted,
    ),
    note: `no error code "${wanted}"`,
  };
}
