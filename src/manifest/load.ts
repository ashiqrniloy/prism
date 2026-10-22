import type { PackageInput } from "../packages/api.js";
import type { Capability } from "../packages/capabilities.js";
import { bindManifestInstance, definePackage } from "../packages/define.js";
import { KERNEL_API_LEVEL } from "../version.js";
import { importDefinition } from "./definition.js";
import { ManifestError } from "./errors.js";
import type { ManifestScope, PrismManifestV1 } from "./format.js";
import { verifyInstalled } from "./integrity.js";
import { mergeManifestScopes, type ResolvedManifestEntry } from "./merge.js";
import { readManifest, type ScopeDirs, scopeDirs } from "./store.js";

/** What the host's trust callback sees: names, versions, and capabilities. Never config values. */
export interface ManifestTrustRequest {
  /** The project manifest file. */
  readonly path: string;
  readonly packages: readonly {
    readonly name: string;
    readonly version: string;
    readonly capabilities: readonly Capability[];
  }[];
}

export interface LoadManifestOptions {
  /** Project root. Default: the current directory. */
  readonly root?: string;
  /** Prism home for the user scope. Default: `$PRISM_HOME`, else `~/.prism`. */
  readonly home?: string;
  /** Scopes to read. Default: both. */
  readonly scopes?: readonly ManifestScope[];
  /**
   * Called with the project manifest's packages before any project code is imported. The project scope
   * loads only if this resolves `true`. With no callback, or any other answer, it is skipped. A throw
   * fails the load as `trust_failed`.
   */
  readonly trustProject?: (request: ManifestTrustRequest) => boolean | Promise<boolean>;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && new Set(a).size === new Set(b).size && a.every((value) => b.includes(value));
}

/** The trust request for a project manifest: each entry's version and capabilities as they would load. */
function trustRequest(project: PrismManifestV1, user: PrismManifestV1 | undefined, path: string): ManifestTrustRequest {
  return {
    path,
    packages: project.packages.map((record) => {
      const base = user?.packages.find((entry) => entry.name === record.name);
      const source = record.version !== undefined ? record : base;
      return { name: record.name, version: source?.version ?? "", capabilities: [...(source?.capabilities ?? [])] };
    }),
  };
}

/**
 * A stand-in for an `optional` package that is not installed. Its `setup` throws, so the loader records it as
 * skipped with a status note and `agent.inspect()` lists it, instead of the load failing.
 */
function missingStub(entry: ResolvedManifestEntry, message: string) {
  return definePackage({
    name: entry.name,
    version: "0.0.0",
    description: "Not installed.",
    requires: { api: KERNEL_API_LEVEL },
    setup() {
      throw new Error(message);
    },
  });
}

/**
 * Reads the user and project manifests, merges them, and returns every enabled entry as a package
 * instance (roadmap §2.7). The order is: read, merge, drop disabled, verify the installed tree, then
 * import. The project scope is parsed first (parsing imports nothing) so the host can be asked about it, and
 * its packages are imported only after the host says yes.
 *
 * Fails closed with a `ManifestError`: `integrity_mismatch`, `capabilities_drift`, `package_missing`
 * (unless the entry is `optional`, which is skipped with a status note), `not_a_package`, `import_failed`,
 * `trust_failed`, and the parse and merge codes.
 */
export async function loadManifest(options: LoadManifestOptions = {}): Promise<PackageInput[]> {
  const scopes = options.scopes ?? ["user", "project"];
  const dirs: Partial<Record<ManifestScope, ScopeDirs>> = {};
  for (const scope of scopes)
    dirs[scope] = scopeDirs({
      scope,
      ...(options.root !== undefined ? { root: options.root } : {}),
      ...(options.home !== undefined ? { home: options.home } : {}),
    });

  const user = dirs.user ? await readManifest(dirs.user) : undefined;
  let project = dirs.project ? await readManifest(dirs.project) : undefined;

  if (project && dirs.project) {
    let trusted = false;
    if (options.trustProject) {
      try {
        trusted = (await options.trustProject(trustRequest(project, user, dirs.project.manifestPath))) === true;
      } catch {
        // The callback's message is not forwarded: it is host code and may quote anything.
        throw new ManifestError(
          "trust_failed",
          `The trustProject callback threw for ${dirs.project.manifestPath}; the project manifest was not loaded.`,
          {
            scope: "project",
            path: dirs.project.manifestPath,
          },
        );
      }
    }
    if (!trusted) project = undefined;
  }

  const merged = mergeManifestScopes({
    user,
    project,
    ...(dirs.user ? { userPath: dirs.user.manifestPath } : {}),
    ...(dirs.project ? { projectPath: dirs.project.manifestPath } : {}),
  });

  const inputs: PackageInput[] = [];
  for (const entry of merged.packages) {
    if (!entry.enabled) continue;
    const scopeDir = dirs[entry.scope];
    if (!scopeDir) continue;
    const source = {
      kind: "manifest" as const,
      scope: entry.scope,
      assigns: Object.entries(merged.slots)
        .filter(([, owner]) => owner === entry.name)
        .map(([slot]) => slot as never),
      ...(entry.scopes !== undefined ? { scopes: entry.scopes } : {}),
    };
    try {
      await verifyInstalled(entry, scopeDir.packagesDir, entry.scope);
    } catch (error) {
      if (error instanceof ManifestError && error.code === "package_missing" && entry.optional) {
        inputs.push(
          bindManifestInstance(missingStub(entry, error.message), undefined, { optional: true, source: { ...source, assigns: [] } }),
        );
        continue;
      }
      throw error;
    }
    const definition = await importDefinition(scopeDir.packagesDir, entry, entry.scope);
    if (!sameSet(entry.capabilities, definition.capabilities ?? [])) {
      throw new ManifestError(
        "capabilities_drift",
        `Package ${entry.name} (${entry.scope}) declares different capabilities than the manifest recorded; reinstall it to accept the change.`,
        { scope: entry.scope, package: entry.name },
      );
    }
    inputs.push(bindManifestInstance(definition, entry.config, { optional: entry.optional, source }));
  }
  return inputs;
}
