import type { AuthMode } from "../descriptor.js";

/** Variables a child may inherit from the parent. Everything else is dropped. */
export const DEFAULT_ENV_ALLOWLIST = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ", "USER", "SHELL"] as const;

export interface ChildEnvOptions {
  /** The parent environment to read the allow-list from (default `process.env`). */
  readonly base?: Readonly<Record<string, string | undefined>>;
  readonly allow?: readonly string[];
  /** Non-secret variables such as the profile home or the run directory. */
  readonly paths?: Readonly<Record<string, string>>;
  /** Resolved API-key refs, by variable name. */
  readonly apiKeys?: Readonly<Record<string, string>>;
  /** Auth modes whose `protected.env` names are never copied from any source. */
  readonly modes?: readonly AuthMode[];
}

/**
 * Builds a child environment from an allow-list, never the parent's full environment. A name listed in any mode's
 * `protected.env` is dropped from every source, so a subscription credential cannot leak through the parent.
 */
export function buildChildEnv(options: ChildEnvOptions = {}): Record<string, string> {
  const base = options.base ?? process.env;
  const blocked = new Set((options.modes ?? []).flatMap((mode) => mode.protected.env));
  const env: Record<string, string> = {};
  for (const name of options.allow ?? DEFAULT_ENV_ALLOWLIST) {
    const value = base[name];
    if (value !== undefined && !blocked.has(name)) env[name] = value;
  }
  for (const source of [options.paths, options.apiKeys]) {
    for (const [name, value] of Object.entries(source ?? {})) if (!blocked.has(name)) env[name] = value;
  }
  return env;
}
