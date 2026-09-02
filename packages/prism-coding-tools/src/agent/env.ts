/**
 * Child environment allow-list builder (P1 hardening).
 *
 * Fail-closed: nothing from `process.env` reaches a child process unless its
 * name is explicitly listed in `inherit`. Callers that need host values
 * (PATH, locale) enumerate them here; provider-approved extras come through
 * `set`. Never pass `process.env` through to a spawn.
 */

/** Default vars safe to inherit for agent/process/LSP/PTY children. */
export const DEFAULT_CHILD_ENV_INHERIT: readonly string[] = ["PATH", "LANG", "LC_ALL", "HOME", "TERM"];

export interface ChildEnvOptions {
  /** Names copied from `process.env` (absent values are skipped). */
  readonly inherit?: readonly string[];
  /** Explicit values added verbatim (overrides an inherited name). */
  readonly set?: Readonly<Record<string, string>>;
}

export function buildChildEnv({ inherit = [], set }: ChildEnvOptions = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of inherit) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  if (set) Object.assign(env, set);
  return env;
}
