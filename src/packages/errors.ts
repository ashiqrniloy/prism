/** Stable code of a {@link PackageLoadError}. Later loader tasks extend this union. */
export type PackageLoadErrorCode =
  /** A config key the package's schema does not declare. */
  | "config_unknown_key"
  /** A config value that breaks the schema (type, enum, range, length, shape) or is not JSON. */
  | "config_invalid"
  /** A literal in an `x-prism-secret` field. Only `env:` and `keyring:` refs are accepted. */
  | "secret_literal"
  /** A config schema that uses a keyword outside the supported subset, or a malformed keyword. */
  | "config_schema_unsupported"
  /** The definition is malformed: name, version, `requires`, capabilities, `setup`, or a reserved name. */
  | "definition_invalid"
  /** The kernel version does not satisfy `requires.prism`. */
  | "kernel_range"
  /** `requires.api` is not an API level this kernel supports. */
  | "kernel_api"
  /** A required package is not loaded, or its version does not satisfy the range. */
  | "missing_package"
  /** A required service is provided by no loaded package. */
  | "missing_service"
  /** Two packages provide the same service name. */
  | "service_conflict"
  /** `requires.packages` forms a cycle. */
  | "dependency_cycle"
  /** The same package name is listed twice. */
  | "duplicate_package"
  /** A call needs a capability the package did not declare. */
  | "capability_missing"
  /** `setup` threw, or a `packages` entry failed to load. */
  | "setup_failed"
  /** A tool name is already taken by another package, the host's `AgentConfig.tools`, or a reserved kernel name. */
  | "tool_conflict"
  /** A skill name is already taken by another package or the host's `AgentConfig.skills`. */
  | "skill_conflict"
  /** A provider id is already registered by another package. */
  | "provider_conflict"
  /** A command name is already registered by another package. */
  | "command_conflict"
  /** `agent.commands.run` named a command no loaded package registered. */
  | "unknown_command"
  /** Command arguments broke the command's `args` schema. */
  | "command_args_invalid"
  /** `AgentConfig.disable` names an id that no tool, hook, command, or skill carries. */
  | "unknown_disable_id"
  /** A `host.ui` `secret` request carried a `ref` that is not an `env:`/`keyring:` ref. */
  | "invalid_secret_ref"
  /** A session state value is not JSON (a function, class instance, cycle, or non-finite number). */
  | "state_not_json"
  /** A session state value is over the 64 KiB bound. */
  | "state_too_large"
  /** An `external_state` append would pass the per-key entry or byte cap, or one entry is over 64 KiB. */
  | "external_state_limit"
  | "terminal_env_secret"
  /** `SessionState.get` ran before the session read its branch. */
  | "state_not_ready"
  /** A queried package is not loaded. */
  | "unknown_package"
  /** A queried package is disabled. */
  | "package_disabled"
  /** A package queried its own instance. */
  | "self_instance"
  /** Tool or contribution registration attempted after package setup was complete. */
  | "registration_closed";

export interface PackageLoadErrorOptions {
  readonly package?: string;
  /** JSON pointer into the config (`/apiKey`), when the failure has a location. */
  readonly path?: string;
}

/**
 * A package failed to load. Fails closed with a stable `code`. The message holds the path and the
 * rule that failed, never the offending value, so a literal secret is never echoed.
 */
export class PackageLoadError extends Error {
  readonly code: PackageLoadErrorCode;
  readonly package?: string;
  readonly path?: string;

  constructor(code: PackageLoadErrorCode, message: string, options: PackageLoadErrorOptions = {}) {
    super(message);
    this.name = "PackageLoadError";
    this.code = code;
    if (options.package !== undefined) this.package = options.package;
    if (options.path !== undefined) this.path = options.path;
  }
}
