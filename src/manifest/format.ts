import type { JsonObject } from "../contracts.js";
import type { Capability } from "../packages/capabilities.js";
import { splitSpecifier } from "../packages/define.js";
import { validateJsonSchema } from "../packages/schema.js";
import { parseRange } from "../packages/semver.js";
import type { SlotName } from "../slots/index.js";
import { ManifestError, type ManifestErrorOptions } from "./errors.js";
import { MANIFEST_V1_SCHEMA } from "./schema.js";

export type ManifestScope = "user" | "project";

/** The three fields `install` writes together. */
export interface ManifestInstall {
  /** A semver range. */
  readonly version: string;
  /** SRI `sha512-<base64>` over the installed package tree. */
  readonly integrity: string;
  /** The capabilities the definition declared at install (roadmap §2.7 amendment, plan 150 Task 1(d)). */
  readonly capabilities: readonly Capability[];
}

interface ManifestEntryFields {
  readonly name: string;
  /** Secret fields hold `env:` / `keyring:` refs, checked against the package's own schema at `configure`. */
  readonly config?: JsonObject;
  /** Default `true`. */
  readonly enabled?: boolean;
  /** Default `false`. A missing package or a failed `setup` skips the entry instead of failing the load. */
  readonly optional?: boolean;
}

/** An installed package: the install trio is present. */
export interface ManifestEntry extends ManifestEntryFields, ManifestInstall {}

/** An override of a package listed in another scope: no install trio. Project scope only. */
export interface ManifestOverride extends ManifestEntryFields {
  readonly version?: undefined;
  readonly integrity?: undefined;
  readonly capabilities?: undefined;
}

export type ManifestRecord = ManifestEntry | ManifestOverride;

export interface PrismManifestV1 {
  readonly version: 1;
  /** Load order within the scope. */
  readonly packages: readonly ManifestRecord[];
  /** Slot → owning package name. */
  readonly slots?: Partial<Record<SlotName, string>>;
}

export interface ParseManifestOptions {
  readonly scope: ManifestScope;
  /** The manifest file, for error messages. */
  readonly path: string;
}

/** Cuts and strips a name taken from untrusted input before it enters a message. */
function safe(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "?").slice(0, 64);
}

function fail(
  code: ConstructorParameters<typeof ManifestError>[0],
  options: ParseManifestOptions,
  field: string,
  rest: string,
  pkg?: string,
): never {
  const where: ManifestErrorOptions = { scope: options.scope, path: options.path, field, ...(pkg !== undefined ? { package: pkg } : {}) };
  const body = field !== "" && rest.startsWith(field) ? rest : `${field || "/"} ${rest}`;
  throw new ManifestError(code, `Manifest (${options.scope}, ${safe(options.path)}) ${body}.`, where);
}

export function isInstalledEntry(record: ManifestRecord): record is ManifestEntry {
  return record.version !== undefined;
}

/**
 * Validates one scope's manifest against the v1 schema and the rules the schema cannot express. Fails
 * closed with a {@link ManifestError}; a message names the scope, the file, and the field, never a value.
 * Nothing is imported or read from disk.
 */
export function parseManifest(json: unknown, options: ParseManifestOptions): PrismManifestV1 {
  if (typeof json !== "object" || json === null || Array.isArray(json)) fail("manifest_invalid", options, "", "must be a JSON object");
  if ((json as { version?: unknown }).version !== 1) fail("manifest_version", options, "/version", "must be 1");

  const result = validateJsonSchema(MANIFEST_V1_SCHEMA, json);
  if (!result.ok || result.value === undefined) {
    const first = result.errors[0];
    if (first === undefined) fail("manifest_invalid", options, "", "is invalid");
    const rest = result.errors
      .slice(0, 3)
      .map((error) => `${error.path} ${error.message}`)
      .join("; ");
    fail(first.rule === "unknown_key" ? "manifest_unknown_field" : "manifest_invalid", options, first.path, rest);
  }
  const manifest = result.value as unknown as PrismManifestV1;

  const seen = new Set<string>();
  const rootVersions = new Map<string, string>();
  manifest.packages.forEach((record, index) => {
    const field = `/packages/${index}`;
    if (seen.has(record.name))
      fail("manifest_duplicate", options, `${field}/name`, `lists ${safe(record.name)} more than once`, record.name);
    seen.add(record.name);
    const present = [record.version, record.integrity, record.capabilities].filter((value) => value !== undefined).length;
    if (present !== 0 && present !== 3) {
      fail(
        "manifest_invalid",
        options,
        field,
        `must carry version, integrity, and capabilities together (${safe(record.name)})`,
        record.name,
      );
    }
    if (present === 0 && options.scope === "user") {
      fail("manifest_invalid", options, field, `needs version, integrity, and capabilities (${safe(record.name)})`, record.name);
    }
    if (record.version !== undefined) {
      const { root } = splitSpecifier(record.name);
      const version = rootVersions.get(root);
      if (version !== undefined && version !== record.version) {
        fail("manifest_invalid", options, `${field}/version`, "must match the other entries with the same npm root", record.name);
      }
      rootVersions.set(root, record.version);
      try {
        parseRange(record.version);
      } catch {
        fail("manifest_invalid", options, `${field}/version`, "is not a valid semver range", record.name);
      }
    }
  });

  // A project slot may name a user package, so only the merge can check the project scope.
  if (options.scope === "user") assertSlotOwners(manifest.packages, manifest.slots ?? {}, options);
  return manifest;
}

/** Every slot owner must be a listed, enabled entry. */
export function assertSlotOwners(
  records: readonly { readonly name: string; readonly enabled?: boolean | undefined }[],
  slots: Partial<Record<SlotName, string>>,
  options: Pick<ParseManifestOptions, "path"> & { readonly scope: ManifestScope | "merged" },
): void {
  const enabled = new Set(records.filter((record) => record.enabled !== false).map((record) => record.name));
  for (const [slot, owner] of Object.entries(slots)) {
    if (owner === undefined || enabled.has(owner)) continue;
    const scope = options.scope === "merged" ? undefined : options.scope;
    throw new ManifestError(
      "manifest_slot_owner",
      `Manifest (${options.scope}, ${safe(options.path)}) /slots/${slot} names ${safe(owner)}, which is not a listed, enabled package.`,
      {
        ...(scope !== undefined ? { scope } : {}),
        path: options.path,
        field: `/slots/${slot}`,
        package: owner,
      },
    );
  }
}
