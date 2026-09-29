import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { type PrismCodeConfigLayer, validateGlobalPrismCodeConfigLayer } from "./config.js";
import { PrismCodeConfigError } from "./errors.js";

/** Saved credential-store choice (`state.json.credentialStore`); "auto" is never persisted. */
export type PrismCodeCredentialStoreChoice = "keychain" | "file" | "encrypted-file" | "memory";

/** App-written remembered state. Never contains secrets. */
export interface PrismCodeState {
  readonly lastModel?: { readonly provider: string; readonly model: string };
  readonly lastEffort?: string;
  readonly credentialStore?: PrismCodeCredentialStoreChoice;
}

export interface PrismCodeStateReadResult {
  readonly state: PrismCodeState;
  /** Human-readable note for a recoverable problem (corrupt state backed up, unreadable file). */
  readonly notice?: string;
}

export interface PrismCodeGlobalConfig {
  readonly path: string;
  readonly config: PrismCodeConfigLayer;
}

export function resolvePrismHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PRISM_HOME;
  if (override !== undefined && override.length > 0) {
    if (!isAbsolute(override)) throw new PrismCodeConfigError("PRISM_HOME must be an absolute path");
    return override;
  }
  return join(homedir(), ".prism");
}

/** Lazily create the `0700` home (and tighten an existing home) after ownership is verified. */
export function ensureHomeDir(home: string = resolvePrismHome()): string {
  assertHomeTrusted(home);
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
  } else if (!statSync(home).isDirectory()) {
    throw new PrismCodeConfigError(`PRISM home ${home} is not a directory`);
  }
  if (process.platform !== "win32" && (statSync(home).mode & 0o077) !== 0) {
    chmodSync(home, 0o700);
  }
  return home;
}

function assertHomeTrusted(home: string): void {
  if (process.platform === "win32" || !existsSync(home) || typeof process.getuid !== "function") return;
  const entry = lstatSync(home);
  const target = entry.isSymbolicLink() ? realpathSync(home) : home;
  if (statSync(target).uid !== process.getuid()) {
    const what = entry.isSymbolicLink() ? `symlink target ${target} is` : "directory is";
    throw new PrismCodeConfigError(`refusing PRISM home ${home}: ${what} not owned by the current user`);
  }
}

/** Read `~/.prism/config.json` (global layer, no cwd) or `undefined` when absent. Fails closed on parse/validation errors. */
export function readGlobalConfig(home: string = resolvePrismHome()): PrismCodeGlobalConfig | undefined {
  const path = join(home, "config.json");
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new PrismCodeConfigError(`cannot read config file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new PrismCodeConfigError(`${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path, config: validateGlobalPrismCodeConfigLayer(raw, home, path) };
}

/** Read remembered state. A corrupt file is renamed to `state.json.bak` and ignored, never fatal. */
export function readState(home: string = resolvePrismHome()): PrismCodeStateReadResult {
  const path = join(home, "state.json");
  if (!existsSync(path)) return { state: {} };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { state: {}, notice: `prism-code: cannot read state file ${path}; ignoring it` };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("state must be an object");
    return { state: coerceState(parsed as Record<string, unknown>) };
  } catch {
    const backup = `${path}.bak`;
    try {
      renameSync(path, backup);
    } catch {
      // Best-effort backup: a failed rename must not make startup fatal.
    }
    return { state: {}, notice: `prism-code: corrupt state file ${path}; moved to ${backup} and ignored` };
  }
}

/** Merge `patch` into remembered state and write it `0600`. State is best-effort app data, not config. */
export function writeState(home: string, patch: PrismCodeState): PrismCodeState {
  ensureHomeDir(home);
  const { state: current } = readState(home);
  const next: PrismCodeState = {
    ...current,
    ...(patch.lastModel !== undefined ? { lastModel: patch.lastModel } : {}),
    ...(patch.lastEffort !== undefined ? { lastEffort: patch.lastEffort } : {}),
    ...(patch.credentialStore !== undefined ? { credentialStore: patch.credentialStore } : {}),
  };
  const path = join(home, "state.json");
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return next;
}

function coerceState(raw: Record<string, unknown>): PrismCodeState {
  const lastModel = raw.lastModel;
  const model = typeof lastModel === "object" && lastModel !== null ? (lastModel as Record<string, unknown>) : undefined;
  const provider = typeof model?.provider === "string" ? model.provider : undefined;
  const modelId = typeof model?.model === "string" ? model.model : undefined;
  const credentialStore = raw.credentialStore;
  return {
    ...(provider && modelId ? { lastModel: { provider, model: modelId } } : {}),
    ...(typeof raw.lastEffort === "string" && raw.lastEffort.length > 0 ? { lastEffort: raw.lastEffort } : {}),
    ...(credentialStore === "keychain" || credentialStore === "file" || credentialStore === "encrypted-file" || credentialStore === "memory"
      ? { credentialStore }
      : {}),
  };
}
