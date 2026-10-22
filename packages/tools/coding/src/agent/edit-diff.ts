/**
 * Shared diff computation utilities for the edit and similar tools.
 *
 * Behavioral port of pi's core/tools/edit-diff for @arnilo/prism-tools-coding.
 * The `diff` package provides unified-patch / display-diff generation.
 * Exact matching, BOM/line-ending handling and the changed-line preview are
 * dep-free.
 */
import * as Diff from "diff";

export interface Edit {
  oldText: string;
  newText: string;
}

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

interface TextReplacement {
  matchIndex: number;
  matchLength: number;
  newText: string;
}

/** Apply replacements right to left so earlier offsets stay valid. */
function applyReplacements(content: string, replacements: TextReplacement[]): string {
  let result = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i];
    result =
      result.substring(0, replacement.matchIndex) + replacement.newText + result.substring(replacement.matchIndex + replacement.matchLength);
  }
  return result;
}

/** Strip UTF-8 BOM if present, return both the BOM (if any) and the text without it. */
export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

function countOccurrences(content: string, oldText: string): number {
  let count = 0;
  let index = content.indexOf(oldText);
  while (index !== -1) {
    count++;
    index = content.indexOf(oldText, index + oldText.length);
  }
  return count;
}

const READ_LINE_PREFIX = /^\d+\t/;

/**
 * Every non-empty line of `oldText` starts with `12\t`-style numbering: the model pasted `read`
 * output instead of the file text. Reported, never stripped — a file line may really start that way.
 */
function looksReadPrefixed(oldText: string): boolean {
  const lines = oldText.split("\n").filter((line) => line.length > 0);
  return lines.length > 0 && lines.every((line) => READ_LINE_PREFIX.test(line));
}

function getNotFoundError(path: string, content: string, oldText: string, editIndex: number, totalEdits: number): Error {
  const base =
    totalEdits === 1
      ? `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`
      : `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`;
  if (looksReadPrefixed(oldText)) {
    return new Error(`${base} oldText includes read line-number prefixes ("12\\t"); remove them.`);
  }
  // Cheap first-line substring scan: collect up to 3 unique nearby lines so the model can correct
  // its oldText. No extra file read — `content` is the already-loaded target. Needle is clipped to
  // 16 chars (min 4) to avoid noise from tiny/short oldText.
  const firstLine = oldText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return new Error(base);
  const needle = firstLine.slice(0, 16);
  if (needle.length < 4) return new Error(base);
  const lines = content.split("\n");
  const seen = new Set<string>();
  const nearby: string[] = [];
  for (let i = 0; i < lines.length && nearby.length < 3; i++) {
    if (lines[i].includes(needle)) {
      const snippet = lines[i].slice(0, 120);
      if (seen.has(snippet)) continue;
      seen.add(snippet);
      nearby.push(`  L${i + 1}: ${snippet}`);
    }
  }
  if (nearby.length === 0) return new Error(base);
  return new Error(`${base}\nNearby:\n${nearby.join("\n")}`);
}

function getDuplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
    );
  }
  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
  );
}

function getEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(`oldText must not be empty in ${path}.`);
  }
  return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

function getNoChangeError(path: string, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
    );
  }
  return new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

interface MatchedEdit {
  editIndex: number;
  matchIndex: number;
  matchLength: number;
  newText: string;
}

export interface AppliedEditsResult {
  baseContent: string;
  newContent: string;
}

/**
 * Apply one or more exact-text replacements to LF-normalized content.
 *
 * All edits are matched against the same original content and must match
 * exactly, unique, and disjoint; a miss throws with a Nearby hint. Replacements
 * are applied in reverse order so offsets remain stable.
 */
export function applyEditsToNormalizedContent(normalizedContent: string, edits: Edit[], path: string): AppliedEditsResult {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));
  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i].oldText.length === 0) {
      throw getEmptyOldTextError(path, i, normalizedEdits.length);
    }
  }
  const matchedEdits: MatchedEdit[] = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i];
    const matchIndex = normalizedContent.indexOf(edit.oldText);
    if (matchIndex === -1) {
      throw getNotFoundError(path, normalizedContent, edit.oldText, i, normalizedEdits.length);
    }
    const occurrences = countOccurrences(normalizedContent, edit.oldText);
    if (occurrences > 1) {
      throw getDuplicateError(path, i, normalizedEdits.length, occurrences);
    }
    matchedEdits.push({ editIndex: i, matchIndex, matchLength: edit.oldText.length, newText: edit.newText });
  }
  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matchedEdits.length; i++) {
    const previous = matchedEdits[i - 1];
    const current = matchedEdits[i];
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
      );
    }
  }
  const newContent = applyReplacements(normalizedContent, matchedEdits);
  if (normalizedContent === newContent) {
    throw getNoChangeError(path, normalizedEdits.length);
  }
  return { baseContent: normalizedContent, newContent };
}

/** Generate a standard unified patch. */
export function generateUnifiedPatch(path: string, oldContent: string, newContent: string, contextLines = 4): string {
  return Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
    context: contextLines,
    headerOptions: Diff.FILE_HEADERS_ONLY,
  });
}

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface EditDiffResult {
  diff: string;
  firstChangedLine: number | undefined;
}

/**
 * Generate a display-oriented diff string with line numbers and context.
 * Returns both the diff string and the first changed line number (in the new file).
 */
export function generateDiffString(oldContent: string, newContent: string, contextLines = 4): EditDiffResult {
  const parts = Diff.diffLines(oldContent, newContent) as DiffPart[];
  const output: string[] = [];
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;
  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const raw = part.value.split("\n");
    if (raw[raw.length - 1] === "") {
      raw.pop();
    }
    if (part.added || part.removed) {
      // Capture the first changed line (in the new file).
      if (firstChangedLine === undefined) {
        firstChangedLine = newLineNum;
      }
      for (const line of raw) {
        if (part.added) {
          const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
          output.push(`+${lineNum} ${line}`);
          newLineNum++;
        } else {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(`-${lineNum} ${line}`);
          oldLineNum++;
        }
      }
      lastWasChange = true;
    } else {
      // Context lines - only show a few before/after changes.
      const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
      const hasLeadingChange = lastWasChange;
      const hasTrailingChange = nextPartIsChange;
      if (hasLeadingChange && hasTrailingChange) {
        if (raw.length <= contextLines * 2) {
          for (const line of raw) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        } else {
          const leadingLines = raw.slice(0, contextLines);
          const trailingLines = raw.slice(raw.length - contextLines);
          const skippedLines = raw.length - leadingLines.length - trailingLines.length;
          for (const line of leadingLines) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;
          for (const line of trailingLines) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        }
      } else if (hasLeadingChange) {
        const shownLines = raw.slice(0, contextLines);
        const skippedLines = raw.length - shownLines.length;
        for (const line of shownLines) {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${lineNum} ${line}`);
          oldLineNum++;
          newLineNum++;
        }
        if (skippedLines > 0) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;
        }
      } else if (hasTrailingChange) {
        const skippedLines = Math.max(0, raw.length - contextLines);
        if (skippedLines > 0) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;
        }
        for (const line of raw.slice(skippedLines)) {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${lineNum} ${line}`);
          oldLineNum++;
          newLineNum++;
        }
      } else {
        // Skip these context lines entirely.
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }
      lastWasChange = false;
    }
  }
  return { diff: output.join("\n"), firstChangedLine };
}

/** Lines of `value` when split like the diff does (a trailing newline is not a line). */
function diffLineCount(value: string): number {
  if (value.length === 0) return 0;
  const lines = value.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

export interface ChangedLinePreview {
  /** `read`-style `N\ttext` lines around each changed region. */
  text: string;
  /** Changed lines left out by the cap. */
  more: number;
}

/**
 * Preview of the new file around its changed lines: `read`'s `N\ttext` format,
 * `contextLines` lines either side of each region, at most `maxLines` lines
 * total. `more` counts the changed lines the cap left out.
 */
export function generateChangedLinePreview(
  oldContent: string,
  newContent: string,
  contextLines = 2,
  maxLines = 40,
): ChangedLinePreview {
  const parts = Diff.diffLines(oldContent, newContent) as DiffPart[];
  const changed: number[] = [];
  let newLineNumber = 1;
  for (const part of parts) {
    const count = diffLineCount(part.value);
    if (part.added) {
      for (let i = 0; i < count; i++) changed.push(newLineNumber + i);
      newLineNumber += count;
    } else if (!part.removed) {
      newLineNumber += count;
    }
  }
  if (changed.length === 0) return { text: "", more: 0 };
  const newLines = newContent.split("\n");
  // A trailing newline is not an extra line (same rule as `read`).
  const lastLine = newLines[newLines.length - 1] === "" ? newLines.length - 1 : newLines.length;
  const windows: Array<[number, number]> = [];
  for (const line of changed) {
    const start = Math.max(1, line - contextLines);
    const end = Math.min(lastLine, line + contextLines);
    const last = windows[windows.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
      continue;
    }
    windows.push([start, end]);
  }
  const shown: string[] = [];
  const shownChanged = new Set<number>();
  for (const [start, end] of windows) {
    for (let line = start; line <= end; line++) {
      if (shown.length >= maxLines) break;
      shown.push(`${line}\t${newLines[line - 1]}`);
      if (changed.includes(line)) shownChanged.add(line);
    }
    if (shown.length >= maxLines) break;
  }
  return { text: shown.join("\n"), more: changed.length - shownChanged.size };
}
