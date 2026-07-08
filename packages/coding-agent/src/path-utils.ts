/**
 * Path resolution helpers.
 *
 * Behavioral port of pi's core/tools/path-utils for @arnilo/prism-coding-agent.
 * stdlib only (node:fs, node:os, node:path, node:url). pi's version delegates
 * homedir/tilde expansion to an internal utils/paths.js; that logic is inlined
 * here as normalizePath/resolvePath so the package stays self-contained.
 */
import { accessSync, constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as nodeResolve } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

interface NormalizePathOptions {
  trim?: boolean;
  normalizeUnicodeSpaces?: boolean;
  stripAtPrefix?: boolean;
  expandTilde?: boolean;
  homeDir?: string;
}

function normalizePath(input: string, options: NormalizePathOptions = {}): string {
  let normalized = options.trim ? input.trim() : input;
  if (options.normalizeUnicodeSpaces) {
    normalized = normalized.replace(UNICODE_SPACES, " ");
  }
  if (options.stripAtPrefix && normalized.startsWith("@")) {
    normalized = normalized.slice(1);
  }
  if (options.expandTilde ?? true) {
    const home = options.homeDir ?? homedir();
    if (normalized === "~") return home;
    if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
      return join(home, normalized.slice(2));
    }
  }
  if (/^file:\/\//.test(normalized)) {
    return fileURLToPath(normalized);
  }
  return normalized;
}

function resolvePath(input: string, baseDir: string = process.cwd(), options: NormalizePathOptions = {}): string {
  const normalized = normalizePath(input, options);
  const normalizedBaseDir = normalizePath(baseDir);
  return isAbsolute(normalized) ? nodeResolve(normalized) : nodeResolve(normalizedBaseDir, normalized);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function expandPath(filePath: string): string {
  return normalizePath(filePath, { normalizeUnicodeSpaces: true, stripAtPrefix: true });
}

/**
 * Resolve a path relative to the given cwd. Handles ~ expansion and absolute paths.
 */
export function resolveToCwd(filePath: string, cwd: string): string {
  return resolvePath(filePath, cwd, { normalizeUnicodeSpaces: true, stripAtPrefix: true });
}

// macOS screenshot / NFD / curly-quote fallbacks for read paths.
function tryMacOSScreenshotPath(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}
function tryNFDVariant(filePath: string): string {
  // macOS stores filenames in NFD (decomposed) form; try converting user input to NFD.
  return filePath.normalize("NFD");
}
function tryCurlyQuoteVariant(filePath: string): string {
  // macOS uses U+2019 in screenshot names; users typically type a straight apostrophe.
  return filePath.replace(/'/g, "\u2019");
}
function fileExists(filePath: string): boolean {
  try {
    accessSync(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveReadPath(filePath: string, cwd: string): string {
  const resolved = resolveToCwd(filePath, cwd);
  if (fileExists(resolved)) return resolved;
  const amPmVariant = tryMacOSScreenshotPath(resolved);
  if (amPmVariant !== resolved && fileExists(amPmVariant)) return amPmVariant;
  const nfdVariant = tryNFDVariant(resolved);
  if (nfdVariant !== resolved && fileExists(nfdVariant)) return nfdVariant;
  const curlyVariant = tryCurlyQuoteVariant(resolved);
  if (curlyVariant !== resolved && fileExists(curlyVariant)) return curlyVariant;
  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) return nfdCurlyVariant;
  return resolved;
}

export async function resolveReadPathAsync(filePath: string, cwd: string): Promise<string> {
  const resolved = resolveToCwd(filePath, cwd);
  if ((await pathExists(resolved))) return resolved;
  const amPmVariant = tryMacOSScreenshotPath(resolved);
  if (amPmVariant !== resolved && (await pathExists(amPmVariant))) return amPmVariant;
  const nfdVariant = tryNFDVariant(resolved);
  if (nfdVariant !== resolved && (await pathExists(nfdVariant))) return nfdVariant;
  const curlyVariant = tryCurlyQuoteVariant(resolved);
  if (curlyVariant !== resolved && (await pathExists(curlyVariant))) return curlyVariant;
  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
  if (nfdCurlyVariant !== resolved && (await pathExists(nfdCurlyVariant))) return nfdCurlyVariant;
  return resolved;
}
