import type { JsonObject } from "../contracts.js";
import type { Capability } from "../packages/capabilities.js";
import { merge as mergeConfig, resolvePackageConfig } from "../packages/config.js";
import { PackageLoadError } from "../packages/errors.js";
import { SLOT_NAMES, type SlotName } from "../slots/index.js";
import { importDefinition } from "./definition.js";
import { type ManifestConfigErrorCode, ManifestError } from "./errors.js";
import type { ManifestRecord, ManifestScope, PrismManifestV1 } from "./format.js";
import { verifyInstalled } from "./integrity.js";
import { type MergedManifest, mergeManifestScopes, type ResolvedManifestEntry } from "./merge.js";
import { EMPTY_MANIFEST, readManifest, type ScopeDirs, scopeDirs, writeManifest } from "./store.js";

export interface MaintainLocation {
  /** Project root. Default: the current directory. */
  readonly root?: string;
  /** Prism home for the user scope. Default: `$PRISM_HOME`, else `~/.prism`. */
  readonly home?: string;
}

export interface MaintainOptions extends MaintainLocation {
  /** The scope whose manifest file is edited. */
  readonly scope: ManifestScope;
}

/** One entry of the merged view. Config keys are listed; values never are. */
export interface ListedPackage {
  readonly name: string;
  readonly version: string;
  /** The scope that holds the install. */
  readonly scope: ManifestScope;
  readonly enabled: boolean;
  readonly optional: boolean;
  readonly capabilities: readonly Capability[];
  /** Top-level keys of the entry's merged `config`. */
  readonly configKeys: readonly string[];
  /** The slots this package owns. */
  readonly slots: readonly SlotName[];
}

export interface ListedManifest {
  readonly packages: readonly ListedPackage[];
  readonly slots: Partial<Record<SlotName, string>>;
}

/** What `verify` found wrong with one entry. The message never carries a config value. */
export interface VerifyIssue {
  readonly code: ManifestError["code"];
  readonly message: string;
}

export interface VerifyResult {
  readonly name: string;
  readonly scope: ManifestScope;
  readonly enabled: boolean;
  readonly ok: boolean;
  readonly issues: readonly VerifyIssue[];
  /** `false` when the entry's code was not imported (disabled, or a project entry the host did not trust). */
  readonly configChecked: boolean;
}

export interface VerifyOptions extends MaintainLocation {
  /**
   * Project packages are imported to read their config schema only if this resolves `true`; otherwise they
   * get the integrity check alone. Disabled entries are never imported.
   */
  readonly trustProject?: () => boolean | Promise<boolean>;
}

interface Scopes {
  readonly dirs: Record<ManifestScope, ScopeDirs>;
  readonly manifests: Record<ManifestScope, PrismManifestV1 | undefined>;
}

async function readScopes(location: MaintainLocation): Promise<Scopes> {
  const where = (scope: ManifestScope) =>
    scopeDirs({
      ...(location.root !== undefined ? { root: location.root } : {}),
      ...(location.home !== undefined ? { home: location.home } : {}),
      scope,
    });
  const dirs = { user: where("user"), project: where("project") };
  return { dirs, manifests: { user: await readManifest(dirs.user), project: await readManifest(dirs.project) } };
}

function mergeScopes(dirs: Scopes["dirs"], manifests: Scopes["manifests"]): MergedManifest {
  return mergeManifestScopes({
    user: manifests.user,
    project: manifests.project,
    userPath: dirs.user.manifestPath,
    projectPath: dirs.project.manifestPath,
  });
}

function missing(name: string, scope: ManifestScope): ManifestError {
  return new ManifestError("package_missing", `Package ${name.slice(0, 64)} is not listed in any manifest scope.`, {
    scope,
    package: name,
  });
}

/** Replaces the scope's record for `name`, or appends one. */
function withRecord(manifest: PrismManifestV1, record: ManifestRecord): PrismManifestV1 {
  const index = manifest.packages.findIndex((entry) => entry.name === record.name);
  const packages = index === -1 ? [...manifest.packages, record] : manifest.packages.map((entry, at) => (at === index ? record : entry));
  return { ...manifest, packages };
}

/** Validates the merged result, then writes only the edited scope. A rejected edit leaves the file unchanged. */
async function commit(options: MaintainOptions, scopes: Scopes, next: PrismManifestV1): Promise<MergedManifest> {
  const merged = mergeScopes(scopes.dirs, { ...scopes.manifests, [options.scope]: next });
  await writeManifest(scopes.dirs[options.scope], next);
  return merged;
}

/** Loads the entry's definition for its schema. Runs the module, never `setup`. */
async function definitionOf(entry: ResolvedManifestEntry, scopes: Scopes) {
  const dir = scopes.dirs[entry.scope];
  await verifyInstalled(entry, dir.packagesDir, entry.scope);
  return importDefinition(dir.packagesDir, entry, entry.scope);
}

function checkConfig(
  definition: Awaited<ReturnType<typeof definitionOf>>,
  entry: { readonly name: string; readonly config?: JsonObject | undefined },
  scope: ManifestScope,
): void {
  try {
    resolvePackageConfig(definition, { manifest: entry.config ?? {} });
  } catch (error) {
    if (!(error instanceof PackageLoadError)) throw error;
    throw new ManifestError(error.code as ManifestConfigErrorCode, error.message, {
      scope,
      package: entry.name,
      ...(error.path !== undefined ? { field: error.path } : {}),
    });
  }
}

/**
 * Merges `patch` into the entry's `config` in `scope`. The package's definition is imported (its module runs,
 * `setup` does not) and the merged result is validated against its schema, so an unknown key, a schema
 * violation, or a literal in an `x-prism-secret` field is refused before anything is written. In project
 * scope a package installed only in user scope gets an override entry that carries just the patch.
 */
export async function configure(name: string, patch: JsonObject, options: MaintainOptions): Promise<void> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new ManifestError("config_invalid", `Config patch for ${name.slice(0, 64)} must be an object.`, {
      scope: options.scope,
      package: name,
    });
  }
  const scopes = await readScopes(options);
  const current = scopes.manifests[options.scope] ?? EMPTY_MANIFEST;
  const own = current.packages.find((entry) => entry.name === name);
  if (own === undefined && options.scope === "user") throw missing(name, options.scope);
  const before = mergeScopes(scopes.dirs, scopes.manifests).packages.find((entry) => entry.name === name);
  if (before === undefined) throw missing(name, options.scope);

  const definition = await definitionOf(before, scopes);
  const record: ManifestRecord = { ...(own ?? { name }), config: mergeConfig(own?.config ?? {}, patch) };
  const next = withRecord(current, record);
  const after = mergeScopes(scopes.dirs, { ...scopes.manifests, [options.scope]: next }).packages.find((entry) => entry.name === name);
  checkConfig(definition, { name, config: after?.config }, options.scope);
  await commit(options, scopes, next);
}

/**
 * Sets `enabled` for a package in `scope`. In project scope a package listed only in the user manifest gets an
 * override entry `{ name, enabled }`. Disabling a slot owner fails as `manifest_slot_owner`.
 */
export async function setEnabled(name: string, enabled: boolean, options: MaintainOptions): Promise<void> {
  const scopes = await readScopes(options);
  const current = scopes.manifests[options.scope] ?? EMPTY_MANIFEST;
  const own = current.packages.find((entry) => entry.name === name);
  if (own === undefined) {
    const listed = mergeScopes(scopes.dirs, scopes.manifests).packages.some((entry) => entry.name === name);
    if (!listed || options.scope === "user") throw missing(name, options.scope);
  }
  await commit(options, scopes, withRecord(current, { ...(own ?? { name }), enabled }));
}

/** Points `slot` at `owner` in `scope`, or clears this scope's assignment when `owner` is `null`. */
export async function assignSlot(slot: SlotName, owner: string | null, options: MaintainOptions): Promise<void> {
  if (!SLOT_NAMES.includes(slot)) {
    throw new ManifestError("manifest_invalid", `Unknown slot ${String(slot).slice(0, 64)}; expected one of ${SLOT_NAMES.join(", ")}.`, {
      scope: options.scope,
      field: `/slots/${String(slot).slice(0, 64)}`,
    });
  }
  const scopes = await readScopes(options);
  const current = scopes.manifests[options.scope] ?? EMPTY_MANIFEST;
  const slots: Partial<Record<SlotName, string>> = { ...current.slots };
  if (owner === null) delete slots[slot];
  else slots[slot] = owner;
  const { slots: _drop, ...rest } = current;
  // The merge checks that `owner` is a listed, enabled entry of the merged view, not only of this file.
  await commit(options, scopes, Object.keys(slots).length > 0 ? { ...rest, slots } : rest);
}

/** The merged view. Imports nothing and reads no package file. Config keys are listed, never values. */
export async function list(location: MaintainLocation = {}): Promise<ListedManifest> {
  const scopes = await readScopes(location);
  const merged = mergeScopes(scopes.dirs, scopes.manifests);
  return {
    slots: merged.slots,
    packages: merged.packages.map((entry) => ({
      name: entry.name,
      version: entry.version,
      scope: entry.scope,
      enabled: entry.enabled,
      optional: entry.optional,
      capabilities: entry.capabilities,
      configKeys: Object.keys(entry.config ?? {}),
      slots: (Object.entries(merged.slots) as [SlotName, string][]).filter(([, owner]) => owner === entry.name).map(([slot]) => slot),
    })),
  };
}

function issueOf(error: unknown): VerifyIssue {
  if (error instanceof ManifestError) return { code: error.code, message: error.message };
  throw error;
}

/**
 * Re-checks every entry of the merged view: the installed tree against its hash, then (for enabled entries
 * whose code may run) the capabilities and the config against the package's schema. One entry's failure
 * does not stop the rest. A manifest that does not parse or merge still throws.
 */
export async function verify(options: VerifyOptions = {}): Promise<VerifyResult[]> {
  const scopes = await readScopes(options);
  const merged = mergeScopes(scopes.dirs, scopes.manifests);
  let projectTrusted: boolean | undefined;
  const trusted = async (): Promise<boolean> => {
    if (projectTrusted === undefined) {
      try {
        projectTrusted = (await options.trustProject?.()) === true;
      } catch {
        projectTrusted = false;
      }
    }
    return projectTrusted;
  };

  const results: VerifyResult[] = [];
  const cache = new Map<string, Promise<string>>();
  for (const entry of merged.packages) {
    const issues: VerifyIssue[] = [];
    let configChecked = false;
    try {
      await verifyInstalled(entry, scopes.dirs[entry.scope].packagesDir, entry.scope, { cache });
      if (entry.enabled && (entry.scope === "user" || (await trusted()))) {
        configChecked = true;
        const definition = await importDefinition(scopes.dirs[entry.scope].packagesDir, entry, entry.scope);
        const declared = definition.capabilities ?? [];
        if (declared.length !== entry.capabilities.length || !entry.capabilities.every((capability) => declared.includes(capability))) {
          issues.push({
            code: "capabilities_drift",
            message: `Package ${entry.name} (${entry.scope}) declares different capabilities than the manifest recorded.`,
          });
        }
        checkConfig(definition, entry, entry.scope);
      }
    } catch (error) {
      issues.push(issueOf(error));
    }
    results.push({ name: entry.name, scope: entry.scope, enabled: entry.enabled, ok: issues.length === 0, issues, configChecked });
  }
  return results;
}
