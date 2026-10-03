import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ManifestError } from "./errors.js";
import { type ManifestScope, type PrismManifestV1, parseManifest } from "./format.js";

/** Where one scope keeps its manifest and its managed Bun project. */
export interface ScopeDirs {
  readonly scope: ManifestScope;
  /** `<root>/.prism` or the Prism home. */
  readonly base: string;
  /** `<base>/packages.json`. */
  readonly manifestPath: string;
  /** `<base>/packages`: a private Bun project (`package.json`, `bun.lock`, `node_modules/`). */
  readonly packagesDir: string;
}

export interface ScopeLocation {
  readonly scope: ManifestScope;
  /** Project root. Default: the current directory. */
  readonly root?: string;
  /** Prism home. Default: `$PRISM_HOME` (absolute), else `~/.prism`. */
  readonly home?: string;
}

/** The same rule as Prism Code's `resolvePrismHome`, so the lab and the manifest agree on the user scope. */
export function resolveUserHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PRISM_HOME;
  if (override !== undefined && override.length > 0) {
    if (!isAbsolute(override)) throw new ManifestError("manifest_invalid", "PRISM_HOME must be an absolute path.", { scope: "user" });
    return override;
  }
  return join(homedir(), ".prism");
}

export function scopeDirs(location: ScopeLocation): ScopeDirs {
  const base =
    location.scope === "project" ? join(resolve(location.root ?? process.cwd()), ".prism") : (location.home ?? resolveUserHome());
  return { scope: location.scope, base, manifestPath: join(base, "packages.json"), packagesDir: join(base, "packages") };
}

export const EMPTY_MANIFEST: PrismManifestV1 = Object.freeze({ version: 1, packages: Object.freeze([]) as PrismManifestV1["packages"] });

/** Reads and validates one scope's manifest. `undefined` when the file does not exist. */
export async function readManifest(dirs: ScopeDirs): Promise<PrismManifestV1 | undefined> {
  let text: string;
  try {
    text = await readFile(dirs.manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ManifestError("manifest_invalid", `Manifest (${dirs.scope}, ${dirs.manifestPath}) could not be read.`, {
      scope: dirs.scope,
      path: dirs.manifestPath,
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // The parser's message can quote file content, so it is not forwarded.
    throw new ManifestError("manifest_invalid", `Manifest (${dirs.scope}, ${dirs.manifestPath}) is not valid JSON.`, {
      scope: dirs.scope,
      path: dirs.manifestPath,
    });
  }
  return parseManifest(json, { scope: dirs.scope, path: dirs.manifestPath });
}

export interface WriteIo {
  readonly rename?: typeof rename;
}

/** Writes the manifest atomically: a private temp file in the same directory, then a rename. */
export async function writeManifest(dirs: ScopeDirs, manifest: PrismManifestV1, io: WriteIo = {}): Promise<void> {
  // Never write a manifest the reader would refuse.
  parseManifest(JSON.parse(JSON.stringify(manifest)), { scope: dirs.scope, path: dirs.manifestPath });
  await mkdir(dirs.base, { recursive: true, mode: 0o700 });
  const temp = join(dirs.base, `.packages.json.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await (io.rename ?? rename)(temp, dirs.manifestPath);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
