/**
 * Parse `git status --porcelain=v2 -z --branch` output into structured records.
 *
 * Paths remain repository-relative as emitted by Git. Leading-dash and control
 * characters are preserved as data; callers must pass paths after `--`.
 */
import { GitError } from "./git-exec.js";

export type GitStatusEntryKind =
  | "ordinary"
  | "rename"
  | "copy"
  | "unmerged"
  | "untracked"
  | "ignored";

export interface GitStatusBranch {
  readonly oid: string | null;
  readonly head: string | null;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly initial: boolean;
}

export interface GitStatusEntry {
  readonly kind: GitStatusEntryKind;
  readonly xy: string;
  readonly path: string;
  readonly origPath?: string;
  readonly score?: string;
}

export interface GitStatusResult {
  readonly branch: GitStatusBranch;
  readonly entries: readonly GitStatusEntry[];
  readonly dirty: boolean;
  readonly truncated: boolean;
}

function splitNulRecords(buffer: Buffer): string[] {
  const text = buffer.toString("utf8");
  if (text.length === 0) return [];
  const parts = text.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function parseAheadBehind(token: string | undefined): { ahead: number | null; behind: number | null } {
  if (!token) return { ahead: null, behind: null };
  // Format: +<ahead> -<behind>
  const match = /^\+(\d+) -(\d+)$/.exec(token);
  if (!match) return { ahead: null, behind: null };
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

/**
 * Parse porcelain v2 NUL-delimited status. `maxEntries` truncates retained
 * entries without failing; callers surface truncation in tool metadata.
 */
export function parsePorcelainV2(
  stdout: Buffer,
  options?: { maxEntries?: number },
): GitStatusResult {
  const records = splitNulRecords(stdout);
  const branch: {
    oid: string | null;
    head: string | null;
    detached: boolean;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
    initial: boolean;
  } = {
    oid: null,
    head: null,
    detached: false,
    upstream: null,
    ahead: null,
    behind: null,
    initial: false,
  };

  const entries: GitStatusEntry[] = [];
  const maxEntries = options?.maxEntries;
  let truncated = false;
  let i = 0;

  while (i < records.length) {
    const record = records[i]!;
    i++;

    if (record.startsWith("# ")) {
      const body = record.slice(2);
      if (body.startsWith("branch.oid ")) {
        const oid = body.slice("branch.oid ".length);
        if (oid === "(initial)") {
          branch.initial = true;
          branch.oid = null;
        } else {
          branch.oid = oid;
        }
      } else if (body.startsWith("branch.head ")) {
        const head = body.slice("branch.head ".length);
        if (head === "(detached)") {
          branch.detached = true;
          branch.head = null;
        } else {
          branch.head = head;
        }
      } else if (body.startsWith("branch.upstream ")) {
        branch.upstream = body.slice("branch.upstream ".length);
      } else if (body.startsWith("branch.ab ")) {
        const ab = parseAheadBehind(body.slice("branch.ab ".length));
        branch.ahead = ab.ahead;
        branch.behind = ab.behind;
      }
      continue;
    }

    if (maxEntries !== undefined && entries.length >= maxEntries) {
      truncated = true;
      continue;
    }

    if (record.startsWith("? ")) {
      entries.push({ kind: "untracked", xy: "??", path: record.slice(2) });
      continue;
    }
    if (record.startsWith("! ")) {
      entries.push({ kind: "ignored", xy: "!!", path: record.slice(2) });
      continue;
    }
    if (record.startsWith("1 ")) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = record.split(" ");
      if (parts.length < 9) throw new GitError(`malformed ordinary status record: ${record}`);
      const xy = parts[1]!;
      const path = parts.slice(8).join(" ");
      entries.push({ kind: "ordinary", xy, path });
      continue;
    }
    if (record.startsWith("2 ")) {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
      const parts = record.split(" ");
      if (parts.length < 10) throw new GitError(`malformed rename/copy status record: ${record}`);
      const xy = parts[1]!;
      const scoreToken = parts[8]!;
      const path = parts.slice(9).join(" ");
      const origPath = records[i];
      if (origPath === undefined) throw new GitError("rename/copy status missing origPath");
      i++;
      const kind: GitStatusEntryKind = scoreToken.startsWith("C") ? "copy" : "rename";
      entries.push({ kind, xy, path, origPath, score: scoreToken });
      continue;
    }
    if (record.startsWith("u ")) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = record.split(" ");
      if (parts.length < 11) throw new GitError(`malformed unmerged status record: ${record}`);
      const xy = parts[1]!;
      const path = parts.slice(10).join(" ");
      entries.push({ kind: "unmerged", xy, path });
      continue;
    }

    throw new GitError(`unrecognized porcelain v2 record: ${record.slice(0, 80)}`);
  }

  const dirty = entries.some((entry) => entry.kind !== "ignored");
  return {
    branch: {
      oid: branch.oid,
      head: branch.head,
      detached: branch.detached,
      upstream: branch.upstream,
      ahead: branch.ahead,
      behind: branch.behind,
      initial: branch.initial,
    },
    entries,
    dirty,
    truncated,
  };
}
