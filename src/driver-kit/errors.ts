/** Stable code of a {@link DriverError}. */
export type DriverErrorCode =
  /** A run started with no usable vendor binary (missing, or the probe failed or timed out). */
  | "driver_unavailable"
  /** A resumed run was stored under a different major version of the vendor binary. */
  | "driver_revision_mismatch"
  /** `requires` names a control the driver's descriptor does not provide. */
  | "driver_capability_missing"
  /** The descriptor or driver definition is malformed. */
  | "driver_definition_invalid"
  /** A process stream produced a line longer than the configured bound. */
  | "jsonl_line_too_long"
  /** A credential ref or config path names a protected credential location; API keys must stay ordinary refs. */
  | "credential_required"
  /** The auth mode does not permit this deployment, or its acknowledgements are missing. */
  | "plan_login_not_permitted"
  /** The profile is bound to another principal. */
  | "profile_principal_mismatch"
  /** The profile is missing or signed out; the message names the login command. */
  | "auth_required"
  /** More than `maxConcurrentRuns` runs are active on one profile. */
  | "profile_busy"
  /** A profile name or path is malformed or escapes the profile directory. */
  | "profile_invalid"
  /** Strict isolation with a `workspace-files` driver and no worktree. */
  | "worktree_required"
  /** A path is not a git worktree: no `.git`, a malformed `gitdir` line, or a target that is not a git directory. */
  | "worktree_not_git"
  /** A skill selection names a skill the agent has not registered. */
  | "unknown_skill"
  /** A bridged tool name is not in the agent's tool registry, or a call names a tool that was not bridged. */
  | "unknown_tool"
  /** The callback broker cannot listen: the run directory path is too long for a Unix socket, or a listener failed. */
  | "broker_unavailable";

/** A driver failed closed. The message names the control or rule, never a config value. */
export class DriverError extends Error {
  readonly code: DriverErrorCode;
  /** The `requires` key or descriptor control involved, when there is one. */
  readonly control?: string;
  /** The profile involved (set on `profile_busy`), so callers never parse the message. */
  readonly profile?: string;

  constructor(code: DriverErrorCode, message: string, control?: string, profile?: string) {
    super(`${code}: ${message}`);
    this.name = "DriverError";
    this.code = code;
    if (control !== undefined) this.control = control;
    if (profile !== undefined) this.profile = profile;
  }
}
