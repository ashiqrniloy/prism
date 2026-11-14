/**
 * The `workspace` service's error type.
 *
 * Codes are plain `workspace_*` strings, deliberately outside the 0.12 error namespace this plan
 * retires, and messages name the rule, never a config value.
 */
export type WorkspaceServiceErrorCode =
  | "workspace_not_git"
  | "workspace_path_escape"
  | "workspace_limit"
  | "workspace_unknown"
  | "workspace_main_immutable"
  | "workspace_dirty"
  | "workspace_dirty_target"
  | "workspace_identity_missing"
  | "workspace_git_unsupported"
  | "workspace_merge_failed"
  | "workspace_sandbox_unsupported"
  | "workspace_session_bound";

export class WorkspaceServiceError extends Error {
  readonly code: WorkspaceServiceErrorCode;

  constructor(code: WorkspaceServiceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceServiceError";
    this.code = code;
  }
}
