export type HeadlessErrorCode =
  | "invalid_missed_policy"
  | "unknown_target"
  | "duplicate_schedule"
  | "past_one_off"
  | "invalid_cron"
  | "invalid_timezone"
  | "schedule_limit"
  | "invalid_schedule"
  | "invalid_schedule_state"
  | "schedule_not_found"
  | "scheduler_ownership"
  | "unknown_workflow_command"
  | "unknown_command"
  | "invalid_workflow_result"
  | "firing_limit"
  | "scheduler_stopping"
  | "session_not_found"
  | "resume_authority_required"
  | "resume_busy"
  | "stale_decisions"
  | "no_routes"
  | "duplicate_route"
  | "unknown_kind"
  | "invalid_timeout"
  | "invalid_limit"
  | "invalid_route"
  | "invalid_policy"
  | "policy_allow_refused";

export class HeadlessError extends Error {
  constructor(readonly code: HeadlessErrorCode) {
    super(code);
    this.name = "HeadlessError";
  }
}
