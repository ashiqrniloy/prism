import { resolve } from "node:path";
import { assertSkillsMarker, redactPaths, UpstreamResolveError } from "../upstream/index.js";

export {
  MAX_CONFIG_FILE_BYTES,
  MAX_INJECTED_INSTRUCTION_BYTES,
  MAX_SKILL_FILE_BYTES,
  readBoundedFile,
  redactPaths,
  SKILLS_DIR_NAME,
  UpstreamResolveError,
} from "../upstream/index.js";

export const CAVEMAN_UPSTREAM_PACKAGE = "juliusbrussee/caveman";

export interface ResolveUpstreamRootOptions {
  /** Host-owned absolute or relative path to juliusbrussee/caveman checkout. */
  readonly upstreamPath: string;
}

/** Resolve Caveman upstream root; throws when `upstreamPath` lacks a `skills/` marker. */
export function resolveUpstreamRoot(options: ResolveUpstreamRootOptions): string {
  const raw = options.upstreamPath?.trim();
  if (!raw) {
    throw new UpstreamResolveError(redactPaths(`Caveman upstreamPath is required (${CAVEMAN_UPSTREAM_PACKAGE} is not published on npm)`));
  }

  const root = resolve(raw);
  assertSkillsMarker(root);
  return root;
}
