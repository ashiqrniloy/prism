import { accessSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { redactPaths, UpstreamResolveError } from "../upstream/index.js";

export { MAX_SKILL_FILE_BYTES, readBoundedFile, redactPaths, UpstreamResolveError } from "../upstream/index.js";

/** Host may point at a skills parent or at the compiled skill directory itself. */
export const SKILL_FILE_CANDIDATES = ["skills/impeccable/SKILL.md", "SKILL.md"] as const;

export interface ResolveUpstreamRootOptions {
  /** Host-owned path to an Impeccable checkout or compiled skill dir. */
  readonly upstreamPath: string;
}

export interface ResolvedImpeccableUpstream {
  readonly root: string;
  readonly skillRelativePath: string;
}

function readableFile(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve Impeccable upstream; throws when `upstreamPath` has no readable `SKILL.md`. */
export function resolveUpstreamRoot(options: ResolveUpstreamRootOptions): ResolvedImpeccableUpstream {
  const raw = options.upstreamPath?.trim();
  if (!raw) {
    throw new UpstreamResolveError("Impeccable upstreamPath is required (npm impeccable is the detector CLI, not a skill tree)");
  }

  const root = resolve(raw);
  for (const relative of SKILL_FILE_CANDIDATES) {
    if (readableFile(join(root, relative))) return { root, skillRelativePath: relative };
  }
  throw new UpstreamResolveError(
    redactPaths("Upstream root is missing a readable SKILL.md (skills/impeccable/SKILL.md or SKILL.md)", [root]),
  );
}
