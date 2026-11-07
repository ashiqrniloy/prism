/** An index that is missing, unreadable, or written for another Prism version. */
const INDEX = "ERR_PRISM_HOST_BUILDER_INDEX";
/** An example path that is not in the shipped examples index. */
const EXAMPLE = "ERR_PRISM_HOST_BUILDER_EXAMPLE";
/** A project whose installed `@arnilo/prism` is not the version the indexes describe, or has none installed. */
const VERSION = "ERR_PRISM_HOST_BUILDER_VERSION";
/** A check target (`--entry`, `--package`) that is malformed, missing, outside `--root`, or whose export is not what the check needs. */
const ENTRY = "ERR_PRISM_HOST_BUILDER_ENTRY";
/** An inspection factory that ran a session or made an outbound request, which a check refuses. */
const CHECK_MODEL_CALL = "ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL";
/** An install that would overwrite a skill copy or an MCP entry that is not an unmodified earlier install; `--force` overrides. */
const INSTALL_CONFLICT = "ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT";
/** An MCP configuration file the installer cannot merge safely: malformed JSON, or a server key that is not an object. It is never rewritten. */
const INSTALL_CONFIG = "ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG";
/** An install whose root is not a directory, or whose destination resolves outside `--root`. */
const INSTALL_ROOT = "ERR_PRISM_HOST_BUILDER_INSTALL_ROOT";

/** A host-builder failure with a stable code. */
export class HostBuilderError extends Error {
  readonly code:
    | typeof INDEX
    | typeof EXAMPLE
    | typeof VERSION
    | typeof ENTRY
    | typeof CHECK_MODEL_CALL
    | typeof INSTALL_CONFLICT
    | typeof INSTALL_CONFIG
    | typeof INSTALL_ROOT;

  constructor(code: HostBuilderError["code"], message: string) {
    super(message);
    this.name = "HostBuilderError";
    this.code = code;
  }
}
