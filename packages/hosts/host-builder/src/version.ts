import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HostBuilderError } from "./errors.js";

/** The `@arnilo/prism` version installed under `root`, or `undefined` when it is not installed or unreadable. */
export function installedPrismVersion(root: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "node_modules", "@arnilo", "prism", "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export interface VersionCheck {
  /** Set only when a mismatch was allowed: the text to put on every result. */
  readonly warning?: string;
}

/**
 * Compares the project's installed `@arnilo/prism` with the version the indexes describe. A mismatch, or no
 * install at all, fails with `ERR_PRISM_HOST_BUILDER_VERSION` naming both versions and the fix, unless
 * `allowMismatch` turns it into a warning. The indexes are exact for one version, so a lookup against another
 * would answer with the wrong contract.
 */
export function checkVersion(root: string, indexVersion: string, allowMismatch: boolean): VersionCheck {
  const installed = installedPrismVersion(root);
  if (installed === indexVersion) return {};
  const fix = installed === undefined ? `bun add -d @arnilo/prism@${indexVersion}` : `bun add -d @arnilo/prism-hosts@${installed}`;
  const message =
    installed === undefined
      ? `@arnilo/prism is not installed under ${root}; the indexes describe ${indexVersion}. Fix: ${fix}`
      : `@arnilo/prism ${installed} is installed under ${root}; the indexes describe ${indexVersion}. Fix: ${fix}`;
  if (allowMismatch) return { warning: `version mismatch allowed: ${message}` };
  throw new HostBuilderError("ERR_PRISM_HOST_BUILDER_VERSION", message);
}
