import { resolve } from "node:path";
import { assertSkillsMarker, resolvePeerPackageRoot } from "../upstream/index.js";

export {
  MAX_CONFIG_FILE_BYTES,
  MAX_INJECTED_INSTRUCTION_BYTES,
  MAX_SKILL_FILE_BYTES,
  readBoundedFile,
  redactPaths,
  SKILLS_DIR_NAME,
  UpstreamResolveError,
} from "../upstream/index.js";

export const PONYTAIL_PEER_PACKAGE = "@dietrichgebert/ponytail";

export interface ResolveUpstreamRootOptions {
  /** Optional host-owned path; falls back to optional peer ${PONYTAIL_PEER_PACKAGE}. */
  readonly upstreamPath?: string;
  readonly packageName?: string;
}

/** Resolve Ponytail upstream root from `upstreamPath` or optional peer package. */
export function resolveUpstreamRoot(options: ResolveUpstreamRootOptions = {}): string {
  const packageName = options.packageName ?? PONYTAIL_PEER_PACKAGE;
  const raw = options.upstreamPath?.trim();

  const root = raw ? resolve(raw) : resolvePeerPackageRoot(packageName);
  assertSkillsMarker(root);
  return root;
}
