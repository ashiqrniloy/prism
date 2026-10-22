import type { PackageLoadErrorCode } from "../packages/errors.js";

/** The package-config codes `configure` and `verify` reuse from the loader, so there is one table. */
export type ManifestConfigErrorCode = Extract<
  PackageLoadErrorCode,
  "config_unknown_key" | "config_invalid" | "secret_literal" | "config_schema_unsupported"
>;

/** Stable code of a {@link ManifestError}. */
export type ManifestErrorCode =
  | ManifestConfigErrorCode
  /** A top-level or entry field the format does not declare. */
  | "manifest_unknown_field"
  /** `version` is missing or is not `1`. */
  | "manifest_version"
  /** The same package name is listed twice in one scope. */
  | "manifest_duplicate"
  /** A `slots` owner is not a listed, enabled entry. */
  | "manifest_slot_owner"
  /** The manifest breaks the format: shape, name, range, integrity, capabilities, or a partial entry. */
  | "manifest_invalid"
  /** The installed tree does not match the recorded hash, holds a symlink, or is over the size bound. */
  | "integrity_mismatch"
  /** A package is listed or named but not installed in its managed directory. */
  | "package_missing"
  /** The installed default export is not a valid package definition. */
  | "not_a_package"
  /** The installed package could not be imported. */
  | "import_failed"
  /** `bun` is missing, exited non-zero, or the install spec is not acceptable. */
  | "install_failed"
  /** The command needs the Bun runtime, and the host is running under another one. */
  | "bun_required"
  /** The installed definition declares capabilities that differ from the recorded ones. */
  | "capabilities_drift"
  /** The host's `trustProject` callback threw. */
  | "trust_failed";

export interface ManifestErrorOptions {
  readonly scope?: "user" | "project";
  /** The manifest file. */
  readonly path?: string;
  /** The field inside the manifest, as a JSON pointer. */
  readonly field?: string;
  readonly package?: string;
  readonly dependency?: string;
}

/**
 * A manifest failed to parse, merge, or verify. Fails closed with a stable `code`. The message names
 * the scope, the file, and the field, never a `config` value, so a literal secret is never echoed.
 */
export class ManifestError extends Error {
  readonly code: ManifestErrorCode;
  readonly scope?: "user" | "project";
  readonly path?: string;
  readonly field?: string;
  readonly package?: string;
  readonly dependency?: string;

  constructor(code: ManifestErrorCode, message: string, options: ManifestErrorOptions = {}) {
    super(message);
    this.name = "ManifestError";
    this.code = code;
    if (options.scope !== undefined) this.scope = options.scope;
    if (options.path !== undefined) this.path = options.path;
    if (options.field !== undefined) this.field = options.field;
    if (options.package !== undefined) this.package = options.package;
    if (options.dependency !== undefined) this.dependency = options.dependency;
  }
}
