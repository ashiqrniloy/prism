import { spawn } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { requestHostUi } from "../host/response.js";
import type { HostPort } from "../host/types.js";
import type { AuthMode, DriverDescriptor } from "./descriptor.js";
import { DriverError } from "./errors.js";
import { buildChildEnv } from "./process/env.js";

/** What the kit asks of the vendor's status command. The driver owns the output format. */
export type ParseStatus = (result: { readonly exitCode: number; readonly stdout: string }) => {
  readonly signedIn: boolean;
  readonly method?: string;
};

/** The profile record (roadmap §2.12.7). It holds no secret and none of the status command's output. */
export interface ProfileRecord {
  readonly name: string;
  readonly mode: string;
  readonly principal?: string;
  readonly maxConcurrentRuns?: number;
  readonly createdAt: string;
  /** The last status result: only `signedIn`, `method`, and when it was checked. */
  readonly auth?: { readonly signedIn: boolean; readonly method?: string; readonly checkedAt: string };
}

/** The slice of `node:fs/promises` the kit uses, injectable so tests can spy on every access. */
export type ProfileFs = Pick<typeof nodeFs, "mkdir" | "readFile" | "writeFile" | "rm" | "readdir">;

export interface ProfilesOptions {
  /** Host-chosen root; default `~/.prism/profiles`. The driver's directory is `<root>/<driver>`. */
  readonly root?: string;
  readonly driver: { readonly name: string; readonly descriptor: DriverDescriptor; readonly parseStatus?: ParseStatus };
  readonly host?: HostPort;
  /** Replaces a leading `{binary}` in a mode's `login` / `status` argv. */
  readonly binary?: string;
  readonly fs?: ProfileFs;
  readonly now?: () => Date;
  /** Status command bound (ms). Default 15 s. */
  readonly statusTimeoutMs?: number;
}

export interface CreateProfileOptions {
  readonly mode?: string;
  readonly principal?: string;
  readonly maxConcurrentRuns?: number;
}

export interface Profiles {
  create(name: string, options?: CreateProfileOptions): Promise<ProfileRecord>;
  /** Create if missing, check status, and sign in through `host.ui` when signed out. */
  ensure(name: string, options?: CreateProfileOptions): Promise<ProfileRecord>;
  login(name: string): Promise<ProfileRecord>;
  status(name: string): Promise<ProfileRecord>;
  bind(name: string, principal: string): Promise<ProfileRecord>;
  remove(name: string): Promise<void>;
  /** `undefined` when the profile does not exist. */
  read(name: string): Promise<ProfileRecord | undefined>;
  /** The profile's home directory (the vendor's relocated home). */
  homeOf(name: string): string;
  modeOf(record: ProfileRecord): AuthMode;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RECORD_FILE = "profile.json";
const MAX_STATUS_BYTES = 64 * 1024;

const bad = (message: string): never => {
  throw new DriverError("profile_invalid", message);
};

/** True when `target` is `base` or inside it. A pure string comparison; nothing is opened. */
export function isInside(base: string, target: string): boolean {
  const a = resolve(base);
  const b = resolve(target);
  return b === a || b.startsWith(a.endsWith(sep) ? a : a + sep);
}

/** The absolute form of a protected path entry: `~`-anchored, absolute, or relative to the profile home. */
export function resolveProtected(entry: string, home: string): string {
  if (entry === "~") return homedir();
  if (entry.startsWith("~/")) return join(homedir(), entry.slice(2));
  return isAbsolute(entry) ? entry : join(home, entry);
}

function sanitize(driverName: string): string {
  return driverName.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Profiles under a host-chosen root. Every filesystem access goes through one guarded join. */
export function createProfiles(options: ProfilesOptions): Profiles {
  const fs = options.fs ?? nodeFs;
  const now = options.now ?? (() => new Date());
  const base = join(options.root ?? join(homedir(), ".prism", "profiles"), sanitize(options.driver.name));
  const modes = options.driver.descriptor.auth.modes;
  const dirOf = (name: string): string => {
    if (!NAME.test(name)) bad("profile names are 1-64 characters of letters, digits, '.', '_' or '-'");
    return join(base, name);
  };
  const homeOf = (name: string): string => join(dirOf(name), "home");

  /** The only way the kit forms a path: under the profile directory, never inside a protected entry. */
  const safeJoin = (name: string, rel: string): string => {
    const dir = dirOf(name);
    if (isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) bad("profile paths must stay inside the profile directory");
    const path = join(dir, rel);
    if (!isInside(dir, path)) bad("profile paths must stay inside the profile directory");
    for (const mode of modes) {
      for (const entry of mode.protected.paths) {
        if (isInside(resolveProtected(entry, join(dir, "home")), path)) {
          throw new DriverError("credential_required", "refusing to touch a protected credential path");
        }
      }
    }
    return path;
  };

  const read = async (name: string): Promise<ProfileRecord | undefined> => {
    let text: string;
    try {
      text = (await fs.readFile(safeJoin(name, RECORD_FILE), "utf8")) as string;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    return JSON.parse(text) as ProfileRecord;
  };
  const write = async (record: ProfileRecord): Promise<ProfileRecord> => {
    await fs.writeFile(safeJoin(record.name, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    return record;
  };
  const require = async (name: string): Promise<ProfileRecord> => {
    const record = await read(name);
    if (record === undefined) throw new DriverError("auth_required", `profile "${name}" does not exist; create it first`);
    return record;
  };
  const modeOf = (record: ProfileRecord): AuthMode => {
    const mode = modes.find((candidate) => candidate.name === record.mode);
    if (mode === undefined) throw new DriverError("driver_definition_invalid", `profile "${record.name}" names an unknown auth mode`);
    return mode;
  };
  const argv = (command: readonly string[]): string[] =>
    command.map((part, index) => (index === 0 && part === "{binary}" && options.binary !== undefined ? options.binary : part));

  const runStatus = (record: ProfileRecord, mode: AuthMode): Promise<{ exitCode: number; stdout: string }> =>
    new Promise((resolveResult, reject) => {
      const [command, ...args] = argv(mode.status ?? []);
      const env = buildChildEnv({
        paths: mode.homeEnv === undefined ? {} : { [mode.homeEnv]: homeOf(record.name) },
        modes,
      });
      const child = spawn(command as string, args, { env, stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new DriverError("auth_required", "the status command timed out"));
      }, options.statusTimeoutMs ?? 15_000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < MAX_STATUS_BYTES) stdout += chunk.toString();
      });
      child.on("error", () => {
        clearTimeout(timer);
        reject(new DriverError("auth_required", "the status command could not run"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveResult({ exitCode: code ?? 1, stdout });
      });
    });

  const status = async (name: string): Promise<ProfileRecord> => {
    const record = await require(name);
    const mode = modeOf(record);
    if (mode.kind !== "account" || mode.status === undefined || options.driver.parseStatus === undefined) return record;
    let parsed: ReturnType<ParseStatus>;
    try {
      // The raw output stays in this scope: it is parsed, then dropped. Errors never carry it.
      parsed = options.driver.parseStatus(await runStatus(record, mode));
    } catch (error) {
      if (error instanceof DriverError) throw error;
      throw new DriverError("auth_required", `could not read the sign-in status; run: ${(mode.login ?? []).join(" ")}`);
    }
    const auth = {
      signedIn: parsed.signedIn === true,
      ...(parsed.method === undefined ? {} : { method: parsed.method }),
      checkedAt: now().toISOString(),
    };
    return write({ ...record, auth });
  };

  const login = async (name: string): Promise<ProfileRecord> => {
    const record = await require(name);
    const mode = modeOf(record);
    if (mode.login === undefined) throw new DriverError("auth_required", `auth mode "${mode.name}" declares no login command`);
    const command = argv(mode.login);
    const ui = options.host?.ui;
    const env = mode.homeEnv === undefined ? undefined : { [mode.homeEnv]: homeOf(name) };
    const answer = await requestHostUi(ui, {
      kind: "terminal",
      title: `Sign in (${options.driver.descriptor.vendor})`,
      command,
      ...(env ? { env } : {}),
    });
    if (answer.status !== "answered" || answer.value.exitCode !== 0) {
      if (answer.status === "unavailable") {
        await ui?.request({ kind: "notify", level: "warn", message: `Sign in to profile "${name}" by running: ${command.join(" ")}` });
      }
      throw new DriverError("auth_required", `sign in to profile "${name}" by running: ${command.join(" ")}`);
    }
    return status(name);
  };

  const create = async (name: string, create: CreateProfileOptions = {}): Promise<ProfileRecord> => {
    if ((await read(name)) !== undefined) bad(`profile "${name}" already exists`);
    const mode = create.mode === undefined ? modes[0] : modes.find((candidate) => candidate.name === create.mode);
    if (mode === undefined) bad(`unknown auth mode "${create.mode ?? ""}"`);
    if (create.maxConcurrentRuns !== undefined && (!Number.isInteger(create.maxConcurrentRuns) || create.maxConcurrentRuns < 1)) {
      bad("maxConcurrentRuns must be a positive integer");
    }
    await fs.mkdir(homeOf(name), { recursive: true, mode: 0o700 });
    return write({
      name,
      mode: (mode as AuthMode).name,
      ...(create.principal === undefined ? {} : { principal: create.principal }),
      ...(create.maxConcurrentRuns === undefined ? {} : { maxConcurrentRuns: create.maxConcurrentRuns }),
      createdAt: now().toISOString(),
    });
  };

  return {
    create,
    read,
    homeOf,
    modeOf,
    status,
    login,
    async ensure(name, createOptions) {
      if ((await read(name)) === undefined) await create(name, createOptions);
      const record = await status(name);
      const mode = modeOf(record);
      if (mode.kind === "account" && mode.login !== undefined && record.auth?.signedIn !== true) return login(name);
      return record;
    },
    async bind(name, principal) {
      const record = await require(name);
      if (record.principal !== undefined && record.principal !== principal) {
        throw new DriverError("profile_principal_mismatch", `profile "${name}" is bound to another principal`);
      }
      return write({ ...record, principal });
    },
    async remove(name) {
      await fs.rm(dirOf(name), { recursive: true, force: true });
    },
  };
}
