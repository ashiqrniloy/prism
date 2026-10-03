import type { JsonObject } from "../contracts.js";
import { merge as mergeConfig } from "../packages/config.js";
import type { SlotName } from "../slots/index.js";
import { ManifestError } from "./errors.js";
import { assertSlotOwners, isInstalledEntry, type ManifestEntry, type ManifestScope, type PrismManifestV1 } from "./format.js";

/** A package after the scopes merge: always installed, with defaults applied. */
export interface ResolvedManifestEntry extends ManifestEntry {
  /** The scope whose directory holds the installed package (the scope that carries the install trio). */
  readonly scope: ManifestScope;
  readonly enabled: boolean;
  readonly optional: boolean;
}

export interface MergedManifest {
  /** Load order: user entries first, then project-only entries. */
  readonly packages: readonly ResolvedManifestEntry[];
  readonly slots: Partial<Record<SlotName, string>>;
}

export interface MergeSources {
  readonly user?: PrismManifestV1 | undefined;
  readonly project?: PrismManifestV1 | undefined;
  /** Manifest files, for error messages. */
  readonly userPath?: string;
  readonly projectPath?: string;
}

/**
 * Merges the user and project scopes keyed by package name. A project entry overrides the user entry's
 * `version` (with its `integrity` and `capabilities`), `config` (deep-merged like `resolvePackageConfig`),
 * `enabled`, and `optional`; project `slots` override user `slots` per slot. A project override of a
 * package no scope installed fails closed.
 */
export function mergeManifestScopes(sources: MergeSources): MergedManifest {
  const projectPath = sources.projectPath ?? "project manifest";
  const byName = new Map<string, ResolvedManifestEntry>();

  for (const record of sources.user?.packages ?? []) {
    if (!isInstalledEntry(record)) continue; // parseManifest rejects these in user scope
    byName.set(record.name, {
      ...record,
      scope: "user",
      enabled: record.enabled !== false,
      optional: record.optional === true,
    });
  }

  for (const record of sources.project?.packages ?? []) {
    const base = byName.get(record.name);
    if (!base && !isInstalledEntry(record)) {
      throw new ManifestError(
        "manifest_invalid",
        `Manifest (project, ${projectPath}) overrides ${record.name.slice(0, 64)}, which no scope installs.`,
        { scope: "project", path: projectPath, package: record.name },
      );
    }
    const install = isInstalledEntry(record) ? record : (base as ManifestEntry);
    const config: JsonObject | undefined =
      base?.config !== undefined && record.config !== undefined ? mergeConfig(base.config, record.config) : (record.config ?? base?.config);
    byName.set(record.name, {
      name: record.name,
      version: install.version,
      integrity: install.integrity,
      capabilities: install.capabilities,
      ...(config !== undefined ? { config } : {}),
      scope: isInstalledEntry(record) ? "project" : (base as ResolvedManifestEntry).scope,
      enabled: record.enabled ?? base?.enabled ?? true,
      optional: record.optional ?? base?.optional ?? false,
    });
  }

  const slots = { ...sources.user?.slots, ...sources.project?.slots };
  const packages = [...byName.values()];
  assertSlotOwners(packages, slots, { scope: "merged", path: sources.projectPath ?? sources.userPath ?? "manifest" });
  return { packages, slots };
}
