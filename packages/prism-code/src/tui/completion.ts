import { execFileSync } from "node:child_process";
import { closeSync, type Dirent, openSync, readdirSync, readSync, realpathSync, type Stats, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ContentBlock, Message } from "@arnilo/prism";

/** Attachments are bounded like the `read` tool; a file larger than this is truncated with a marker. */
export const MAX_ATTACHMENT_BYTES = 64 * 1024;
/** Prefix of one attachment block; stored history can skip these when rendering the prompt. */
export const ATTACHMENT_MARKER = "[attached file: ";
/** Completion lists are always a small window; ranking does the rest. */
export const COMPLETION_LIMIT = 8;
const MAX_INDEXED_FILES = 50_000;

export interface CompletionContext {
  readonly kind: "command" | "path";
  /** Text typed after `/` or `@`. */
  readonly query: string;
  /** Buffer offset where the completed value replaces the typed prefix. */
  readonly start: number;
  /** Buffer offset of the cursor (replace end). */
  readonly end: number;
}

/**
 * The command/path completion token around `cursor`, or undefined when the caret is not inside one.
 * Commands only complete as the entire first line (`/mo`); paths complete after any whitespace.
 */
export function completionContext(text: string, cursor: number): CompletionContext | undefined {
  const before = text.slice(0, cursor);
  if (/^\/[^\s]*$/.test(before)) {
    return { kind: "command", query: before.slice(1), start: 0, end: cursor };
  }
  const match = /(^|\s)@([^\s]*)$/.exec(before);
  if (match) {
    return { kind: "path", query: match[2] ?? "", start: match.index + (match[1]?.length ?? 0), end: cursor };
  }
  return undefined;
}

/** Higher is better; `null` means no match. Prefix > substring > in-order subsequence. */
export function fuzzyScore(query: string, target: string): number | null {
  const lowered = query.toLowerCase();
  if (lowered.length === 0) return 0;
  const haystack = target.toLowerCase();
  if (haystack.startsWith(lowered)) return 3;
  const at = haystack.indexOf(lowered);
  if (at >= 0) return at === 0 ? 3 : 2;
  let matched = 0;
  for (let index = 0; index < haystack.length && matched < lowered.length; index++) {
    if (haystack[index] === lowered[matched]) matched += 1;
  }
  return matched === lowered.length ? 1 : null;
}

export interface FileIndexEntry {
  readonly path: string;
  readonly lower: string;
}

/** Precomputed lowercase names keep 50k-path filtering well inside one frame. */
export function buildFileIndex(paths: readonly string[]): FileIndexEntry[] {
  return paths.slice(0, MAX_INDEXED_FILES).map((path) => ({ path, lower: path.toLowerCase() }));
}

export function filterFileIndex(entries: readonly FileIndexEntry[], query: string, limit: number = COMPLETION_LIMIT): FileIndexEntry[] {
  if (query.length === 0) return entries.slice(0, limit);
  const lowered = query.toLowerCase();
  const prefix: FileIndexEntry[] = [];
  const substring: FileIndexEntry[] = [];
  const subsequence: FileIndexEntry[] = [];
  for (const entry of entries) {
    if (entry.lower.startsWith(lowered)) {
      prefix.push(entry);
    } else if (entry.lower.includes(lowered)) {
      if (substring.length < limit) substring.push(entry);
    } else if (subsequence.length < limit && isSubsequence(lowered, entry.lower)) {
      subsequence.push(entry);
    }
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...substring, ...subsequence].slice(0, limit);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let matched = 0;
  for (let index = 0; index < haystack.length && matched < needle.length; index++) {
    if (haystack[index] === needle[matched]) matched += 1;
  }
  return matched === needle.length;
}

export interface CompletionItem {
  readonly name: string;
  readonly value: string;
  readonly description?: string;
  /** Match text when it differs from the display name (commands match without the leading `/`). */
  readonly matchKey?: string;
  readonly score?: number;
}

export function filterCompletionItems<T extends CompletionItem>(items: readonly T[], query: string, limit: number = COMPLETION_LIMIT): T[] {
  if (query.length === 0) return items.slice(0, limit);
  const ranked: T[] = [];
  for (const item of items) {
    const score = fuzzyScore(query, item.matchKey ?? item.name);
    if (score !== null) ranked.push({ ...item, score });
  }
  ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return ranked.slice(0, limit);
}

/** `git ls-files` (tracked + untracked, honoring ignore files), falling back to a bounded walk. */
export function loadRepoFileIndex(cwd: string): FileIndexEntry[] {
  const gitPaths = gitLsFiles(cwd);
  if (gitPaths) return buildFileIndex(gitPaths);
  return buildFileIndex(walkFiles(cwd));
}

function gitLsFiles(cwd: string): string[] | undefined {
  try {
    const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return output.split("\n").filter((line) => line.length > 0);
  } catch {
    return undefined;
  }
}

function walkFiles(cwd: string): string[] {
  const files: string[] = [];
  const queue: string[] = [""];
  while (queue.length > 0 && files.length < MAX_INDEXED_FILES) {
    const dir = queue.shift();
    if (dir === undefined) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(cwd, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const rel = dir ? join(dir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") queue.push(rel);
      } else if (entry.isFile()) {
        files.push(rel);
        if (files.length >= MAX_INDEXED_FILES) break;
      }
    }
  }
  return files;
}

/** `@path` mentions in a prompt, in order, duplicates removed. */
export function parseAtMentions(text: string): string[] {
  const mentions: string[] = [];
  const pattern = /(^|\s)@([^\s@]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const mention = match[2];
    if (mention && !mentions.includes(mention)) mentions.push(mention);
  }
  return mentions;
}

export interface PromptInputResult {
  readonly input: string | Message;
  readonly references: readonly string[];
  /** Mentions that were refused or unreadable; the prompt still runs without them. */
  readonly skipped: readonly string[];
}

/**
 * Turns `@path` mentions into attachment blocks. Paths must realpath inside `cwd` (a symlink
 * pointing out of the repository is refused) and each file is bounded by `MAX_ATTACHMENT_BYTES`.
 */
export function buildPromptInput(text: string, cwd: string): PromptInputResult {
  const mentions = parseAtMentions(text);
  if (mentions.length === 0) return { input: text, references: [], skipped: [] };

  let root: string;
  try {
    root = realpathSync(cwd);
  } catch {
    return { input: text, references: [], skipped: mentions };
  }

  const blocks: ContentBlock[] = [];
  const references: string[] = [];
  const skipped: string[] = [];
  for (const mention of mentions) {
    const absolute = isAbsolute(mention) ? mention : resolve(root, mention);
    let real: string;
    try {
      real = realpathSync(absolute);
    } catch {
      skipped.push(mention);
      continue;
    }
    if (real !== root && !real.startsWith(`${root}${sep}`)) {
      skipped.push(mention);
      continue;
    }
    let stats: Stats;
    try {
      stats = statSync(real);
    } catch {
      skipped.push(mention);
      continue;
    }
    if (!stats.isFile()) {
      skipped.push(mention);
      continue;
    }
    const { content, truncated } = readBounded(real, stats.size);
    const label = relative(root, real) || mention;
    const suffix = truncated ? `\n… [truncated at ${MAX_ATTACHMENT_BYTES} bytes]` : "";
    blocks.push({ type: "text", text: `${ATTACHMENT_MARKER}${label}]\n${content}${suffix}` });
    references.push(label);
  }

  if (blocks.length === 0) return { input: text, references, skipped };
  const message: Message = {
    role: "user",
    content: [{ type: "text", text }, ...blocks],
    metadata: { attachments: references },
  };
  return { input: message, references, skipped };
}

function readBounded(path: string, size: number): { content: string; truncated: boolean } {
  const limit = Math.min(size, MAX_ATTACHMENT_BYTES);
  const buffer = Buffer.allocUnsafe(Math.max(limit, 1));
  let bytesRead = 0;
  try {
    const fd = openSync(path, "r");
    try {
      bytesRead = readSync(fd, buffer, 0, limit, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return { content: "", truncated: false };
  }
  return { content: buffer.subarray(0, bytesRead).toString("utf8"), truncated: size > MAX_ATTACHMENT_BYTES };
}
