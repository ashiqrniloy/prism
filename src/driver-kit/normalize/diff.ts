import type { ExternalActivity } from "../../loop/index.js";

/** One `file` activity: the driver kit's canonical description of a changed file (plan 165 Task 6 reuses it). */
export type FileActivity = Extract<ExternalActivity, { kind: "file" }>;

const stripPrefix = (path: string): string => path.replace(/^[ab]\//, "");

/** Splits a unified diff into one `file` activity per file section (`source: "diff"`), keeping each section as `diff`. */
export function mapDiff(unifiedDiff: string): FileActivity[] {
  const sections: string[] = [];
  for (const line of unifiedDiff.split("\n")) {
    if (line.startsWith("diff --git ") || (sections.length === 0 && line.startsWith("--- "))) sections.push(line);
    else if (sections.length > 0) sections[sections.length - 1] += `\n${line}`;
  }
  const out: FileActivity[] = [];
  for (const section of sections) {
    const oldPath = /^--- (?:a\/)?(\S+)/m.exec(section)?.[1];
    const newPath = /^\+\+\+ (?:b\/)?(\S+)/m.exec(section)?.[1];
    const gitHeader = /^diff --git a\/(\S+) b\/(\S+)/.exec(section);
    const created = /^--- \/dev\/null/m.test(section) || /^new file mode/m.test(section);
    const deleted = /^\+\+\+ \/dev\/null/m.test(section) || /^deleted file mode/m.test(section);
    const from = gitHeader?.[1] ?? (oldPath && oldPath !== "/dev/null" ? stripPrefix(oldPath) : undefined);
    const to = gitHeader?.[2] ?? (newPath && newPath !== "/dev/null" ? stripPrefix(newPath) : undefined);
    const path = deleted ? from : (to ?? from);
    if (!path) continue;
    const moved = !created && !deleted && from !== undefined && to !== undefined && from !== to;
    out.push({
      kind: "file",
      path,
      change: created ? "created" : deleted ? "deleted" : moved ? "moved" : "modified",
      diff: section.trimEnd(),
      source: "diff",
    });
  }
  return out;
}
