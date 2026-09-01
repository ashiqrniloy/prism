import { PromptLimitError } from "./errors.js";
import type { PromptDiff, PromptDiffLine, PromptRecord } from "./types.js";

export function diffPromptRecords(from: PromptRecord, to: PromptRecord, maxLines: number): PromptDiff {
  const left = from.body.split("\n");
  const right = to.body.split("\n");
  if (left.length > maxLines || right.length > maxLines) {
    throw new PromptLimitError(`diff input exceeds ${maxLines} lines`);
  }

  const width = right.length + 1;
  const lcs = Array.from({ length: left.length + 1 }, () => new Uint16Array(width));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = left[i] === right[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const lines: PromptDiffLine[] = [];
  let added = 0;
  let removed = 0;
  let truncated = false;
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      truncated = !push(lines, { type: "context", text: left[i]! }, maxLines) || truncated;
      i += 1;
      j += 1;
    } else if (j >= right.length || (i < left.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      removed += 1;
      truncated = !push(lines, { type: "remove", text: left[i]! }, maxLines) || truncated;
      i += 1;
    } else {
      added += 1;
      truncated = !push(lines, { type: "add", text: right[j]! }, maxLines) || truncated;
      j += 1;
    }
  }

  return Object.freeze({
    name: from.name,
    from: Object.freeze({ name: from.name, version: from.version, hash: from.hash }),
    to: Object.freeze({ name: to.name, version: to.version, hash: to.hash }),
    lines: Object.freeze(lines),
    added,
    removed,
    truncated,
  });
}

function push(lines: PromptDiffLine[], line: PromptDiffLine, maxLines: number): boolean {
  if (lines.length >= maxLines) return false;
  lines.push(line);
  return true;
}
