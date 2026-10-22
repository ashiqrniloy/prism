import type { DriverBinary } from "./define.js";
import type { AuthMode } from "./descriptor.js";
import { DriverError } from "./errors.js";
import { isInside, resolveProtected, type ProfileRecord, type Profiles } from "./profiles.js";

export interface PolicyGuardOptions {
  readonly vendor: string;
  readonly modes: readonly AuthMode[];
  readonly profiles: Profiles;
  /** Default `"local"`. */
  readonly deployment?: "local" | "hosted";
  /** Terms the host has acknowledged for a hosted deployment. */
  readonly acknowledgements?: readonly string[];
  /** The principal the host runs as; compared with the profile's bound principal. */
  readonly principal?: string;
  /** Recorded for `inspect()`. The kit never writes into the binary's directory. */
  readonly binary?: DriverBinary;
  /** Default 2. */
  readonly defaultMaxConcurrentRuns?: number;
}

export interface RunRequest {
  readonly profile: string;
  /** Config values scanned for credential refs and protected paths. */
  readonly config?: unknown;
}

export interface RunLease {
  readonly profile: string;
  readonly home: string;
  readonly record: ProfileRecord;
  readonly mode: AuthMode;
  /** Idempotent. */
  release(): void;
}

export type LimitSignal = { readonly code: "rate_limit" | "quota" | "billing" | "auth"; readonly deferUntil?: string };

export interface InspectedProfile {
  readonly profile: string;
  readonly binary?: DriverBinary;
  readonly authMethod?: string;
  readonly signedIn?: boolean;
  readonly principal?: string;
  readonly deployment: "local" | "hosted";
  readonly acknowledgements: readonly string[];
  readonly maxConcurrentRuns: number;
  readonly activeRuns: number;
}

export interface PolicyGuard {
  /** Fails closed before a run starts, or returns a lease the run releases when it ends. */
  acquire(request: RunRequest): Promise<RunLease>;
  /**
   * The driver reports a vendor limit it saw. The guard never retries: `stop` ends the run,
   * `defer` carries when the host may start another. A sign-in loss clears the cached status.
   */
  noteLimit(profile: string, signal: LimitSignal): { readonly action: "stop" | "defer"; readonly deferUntil?: string };
  inspect(): readonly InspectedProfile[];
}

const REF = /^(env|keyring):(.+)$/;

/** String leaves of a config value, bounded in depth. */
function* leaves(value: unknown, depth = 0): Generator<string> {
  if (typeof value === "string") yield value;
  else if (depth < 8 && Array.isArray(value)) for (const item of value) yield* leaves(item, depth + 1);
  else if (depth < 8 && value !== null && typeof value === "object") for (const item of Object.values(value)) yield* leaves(item, depth + 1);
}

/** Active runs per profile home, shared by every guard in the process so two agents on one profile share one cap. */
const activeByHome = new Map<string, number>();

/** One module: reads only the descriptor's auth modes and the profile record. */
export function createPolicyGuard(options: PolicyGuardOptions): PolicyGuard {
  const deployment = options.deployment ?? "local";
  const acknowledgements = options.acknowledgements ?? [];
  const protectedEnv = new Set(options.modes.flatMap((mode) => mode.protected.env));
  const seen = new Map<string, { record: ProfileRecord; max: number }>();

  const rejectCredentials = (config: unknown, home: string): void => {
    for (const text of leaves(config)) {
      const ref = REF.exec(text);
      if (ref !== null && protectedEnv.has((ref[2] as string).trim())) {
        throw new DriverError("credential_required", `a credential ref names a protected variable (${ref[2]}); use an API-key ref`);
      }
      if (text.startsWith("/") || text.startsWith("~") || text.startsWith("./")) {
        for (const mode of options.modes) {
          for (const entry of mode.protected.paths) {
            if (isInside(resolveProtected(entry, home), resolveProtected(text, home))) {
              throw new DriverError("credential_required", "a config path points inside a protected credential location");
            }
          }
        }
      }
    }
  };

  const checkAuth = async (record: ProfileRecord, mode: AuthMode): Promise<ProfileRecord> => {
    if (mode.kind !== "account") return record;
    let current = record;
    // Status runs only when nothing is cached, or on recovery from a signed-out result.
    if (current.auth?.signedIn !== true) current = await options.profiles.status(record.name);
    if (current.auth?.signedIn !== true) {
      const how = mode.login === undefined ? "sign in with the vendor's own tool" : `run: ${mode.login.join(" ")}`;
      throw new DriverError("auth_required", `profile "${record.name}" is signed out; ${how}`);
    }
    return current;
  };

  return {
    async acquire(request) {
      const { profile } = request;
      const stored = await options.profiles.read(profile);
      if (stored === undefined) throw new DriverError("auth_required", `profile "${profile}" does not exist; create it first`);
      const mode = options.profiles.modeOf(stored);
      const home = options.profiles.homeOf(profile);
      rejectCredentials(request.config, home);
      if (stored.principal !== undefined && stored.principal !== options.principal) {
        throw new DriverError("profile_principal_mismatch", `profile "${profile}" is bound to another principal`);
      }
      if (!mode.deployments.includes(deployment)) {
        throw new DriverError("plan_login_not_permitted", `auth mode "${mode.name}" is not permitted for ${deployment} deployments`);
      }
      if (deployment === "hosted") {
        const missing = (mode.hostedAcknowledgements ?? []).filter((term) => !acknowledgements.includes(term));
        if (missing.length > 0) {
          throw new DriverError("plan_login_not_permitted", `auth mode "${mode.name}" needs acknowledgements before hosted use: ${missing.join(", ")}`);
        }
      }
      const max = stored.maxConcurrentRuns ?? options.defaultMaxConcurrentRuns ?? 2;
      const running = activeByHome.get(home) ?? 0;
      if (running >= max) throw new DriverError("profile_busy", `profile "${profile}" already has ${running} active runs (maximum ${max})`, undefined, profile);
      activeByHome.set(home, running + 1);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        const left = (activeByHome.get(home) ?? 1) - 1;
        if (left <= 0) activeByHome.delete(home);
        else activeByHome.set(home, left);
      };
      try {
        const record = await checkAuth(stored, mode);
        seen.set(profile, { record, max });
        return { profile, home, record, mode, release };
      } catch (error) {
        release();
        throw error;
      }
    },
    noteLimit(profile, signal) {
      if (signal.code === "auth") {
        const entry = seen.get(profile);
        if (entry !== undefined) seen.set(profile, { ...entry, record: { ...entry.record, auth: { signedIn: false, checkedAt: new Date().toISOString() } } });
        return { action: "stop" };
      }
      if (signal.deferUntil !== undefined) {
        return { action: "defer", deferUntil: signal.deferUntil };
      }
      return { action: "stop" };
    },
    inspect() {
      return [...seen.entries()].map(([profile, { record, max }]) => ({
        profile,
        ...(options.binary === undefined ? {} : { binary: options.binary }),
        ...(record.auth?.method === undefined ? {} : { authMethod: record.auth.method }),
        ...(record.auth === undefined ? {} : { signedIn: record.auth.signedIn }),
        ...(record.principal === undefined ? {} : { principal: record.principal }),
        deployment,
        acknowledgements,
        maxConcurrentRuns: max,
        activeRuns: activeByHome.get(options.profiles.homeOf(profile)) ?? 0,
      }));
    },
  };
}
