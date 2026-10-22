import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { redactSecrets } from "../redaction.js";
import { importDefinition } from "./definition.js";
import { ManifestError } from "./errors.js";
import type { ManifestEntry, ManifestRecord, ManifestScope, PrismManifestV1 } from "./format.js";
import { hashPackageClosure, installedPackageDir } from "./integrity.js";
import { EMPTY_MANIFEST, readManifest, type ScopeDirs, scopeDirs, writeManifest } from "./store.js";

/** Where to install, shared by `install` and `remove`. */
export interface InstallLocation {
  readonly scope: ManifestScope;
  /** Project root. Default: the current directory. */
  readonly root?: string;
  /** Prism home for the user scope. Default: `$PRISM_HOME`, else `~/.prism`. */
  readonly home?: string;
  /** The `bun` executable. Default: the running Bun, else `bun` on `PATH`. A test seam. */
  readonly bun?: string;
  /** The child's environment. Default: the parent's, because `bun add` needs registry auth. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface InstallOptions extends InstallLocation {
  /** The semver range to record and to ask for. Default: `^<installed version>`. */
  readonly version?: string;
  /** Resolves a relative `file:` spec. Default: the current directory. */
  readonly cwd?: string;
  /**
   * Called with what the package declares after it is imported and before the manifest is written.
   * Throwing aborts the install and rolls it back. `prism add` prints the capabilities here.
   */
  readonly review?: (entry: ManifestEntry) => void | Promise<void>;
}

const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const REGISTRY_SPEC = /^((?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*)(?:@([A-Za-z0-9^~<>=*.|+_-][A-Za-z0-9^~<>=*.|+_ -]{0,127}))?$/;
const MAX_OUTPUT = 64 * 1024;
const SECRET_ENV = /TOKEN|SECRET|PASSWORD|PASSWD|AUTH|API_?KEY|CREDENTIAL/i;

function fail(code: "install_failed" | "package_missing", scope: ManifestScope, message: string, pkg?: string): never {
  throw new ManifestError(code, message, { scope, ...(pkg !== undefined ? { package: pkg } : {}) });
}

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `bun` with an argument array (no shell), an explicit cwd, and bounded output. */
function runBun(location: InstallLocation, args: readonly string[], cwd: string): Promise<RunResult> {
  const executable = location.bun ?? (process.versions.bun !== undefined ? process.execPath : "bun");
  const env = location.env ?? process.env;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/** Secret-looking values of the child's environment, so stderr can be redacted. */
function envSecrets(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) => SECRET_ENV.test(key) && typeof value === "string" && value.length >= 6)
    .map(([, value]) => value as string);
}

function redactOutput(text: string, location: InstallLocation): string {
  const cleaned = text
    .replace(/(_authToken\s*=\s*)\S+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/[^\n\x20-\x7e]/g, "?");
  return redactSecrets(cleaned, envSecrets(location.env ?? process.env))
    .trim()
    .slice(0, 400);
}

async function bunStep(
  location: InstallLocation,
  args: readonly string[],
  cwd: string,
  scope: ManifestScope,
  what: string,
): Promise<RunResult> {
  let result: RunResult;
  try {
    result = await runBun(location, args, cwd);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return fail("install_failed", scope, missing ? "bun was not found; the manifest installer needs Bun." : `${what} could not start.`);
  }
  if (result.code !== 0) {
    fail(
      "install_failed",
      scope,
      `${what} failed (exit ${result.code ?? "signal"})${redactOutput(result.stderr, location) ? `: ${redactOutput(result.stderr, location)}` : ""}.`,
    );
  }
  return result;
}

interface ManagedPackageJson {
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

async function readManaged(dirs: ScopeDirs): Promise<ManagedPackageJson> {
  try {
    return JSON.parse(await readFile(join(dirs.packagesDir, "package.json"), "utf8")) as ManagedPackageJson;
  } catch {
    return {};
  }
}

/** Creates the scope's private Bun project on first use. */
async function ensureManaged(dirs: ScopeDirs): Promise<void> {
  await mkdir(dirs.packagesDir, { recursive: true, mode: 0o700 });
  try {
    await stat(join(dirs.packagesDir, "package.json"));
  } catch {
    await writeFile(
      join(dirs.packagesDir, "package.json"),
      `${JSON.stringify({ name: "prism-managed-packages", private: true }, null, 2)}\n`,
      {
        mode: 0o600,
        flag: "wx",
      },
    );
  }
}

/**
 * Turns the caller's spec into what `bun add` receives. A `file:` directory is packed into a tarball
 * first, because Bun installs a `file:` directory as symlinks back to the source and a symlinked tree
 * cannot be hashed. Other schemes (git, URLs, aliases) are not accepted.
 */
async function resolveSpec(
  spec: string,
  options: InstallOptions,
  dirs: ScopeDirs,
): Promise<{ readonly add: string; readonly name?: string }> {
  const { scope } = dirs;
  if (typeof spec !== "string" || spec.length === 0 || spec.length > 1024 || /[\0\r\n]/.test(spec) || spec.startsWith("-")) {
    return fail("install_failed", scope, "The install spec is empty, too long, or looks like a command-line flag.");
  }
  if (spec.startsWith("file:")) {
    const target = resolve(options.cwd ?? process.cwd(), spec.slice("file:".length));
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(target);
    } catch {
      return fail("install_failed", scope, `The file: spec ${spec.slice(0, 120)} does not exist.`);
    }
    if (!info.isDirectory()) return { add: `file:${target}` };
    const tarballs = join(dirs.packagesDir, ".tarballs");
    await mkdir(tarballs, { recursive: true, mode: 0o700 });
    const filename = `pack-${randomBytes(6).toString("hex")}.tgz`;
    await bunStep(
      options,
      ["pm", "pack", "--ignore-scripts", "--quiet", "--filename", join(tarballs, filename)],
      target,
      scope,
      "bun pm pack",
    );
    return { add: `file:${join(tarballs, filename)}` };
  }
  const match = REGISTRY_SPEC.exec(spec);
  if (!match) return fail("install_failed", scope, "Only registry names and file: paths can be installed (no URLs, git, or aliases).");
  const [, name, range] = match as unknown as [string, string, string | undefined];
  const version = options.version ?? range;
  return { add: version !== undefined ? `${name}@${version}` : name, name };
}

function changedDependency(before: Record<string, string>, after: Record<string, string>): string | undefined {
  return Object.keys(after).find((key) => before[key] !== after[key]);
}

/**
 * Installs a package into the scope's managed directory and records it. Runs `bun add`, hashes the
 * installed tree, imports the definition once (this is the user's trust decision, roadmap §1.4), and
 * writes the entry atomically. A default export that is not a package rolls the install back.
 */
export async function install(spec: string, options: InstallOptions): Promise<ManifestEntry> {
  const dirs = scopeDirs(options);
  const { scope } = dirs;
  const manifest = (await readManifest(dirs)) ?? EMPTY_MANIFEST;
  const resolved = await resolveSpec(spec, options, dirs);
  await ensureManaged(dirs);
  const before = { ...(await readManaged(dirs)).dependencies };

  await bunStep(options, ["add", "--ignore-scripts", resolved.add], dirs.packagesDir, scope, "bun add");
  const after = { ...(await readManaged(dirs)).dependencies };
  const name = changedDependency(before, after) ?? resolved.name;
  if (name === undefined || !NAME.test(name))
    return fail("install_failed", scope, "bun add finished but no installed package could be identified.");
  const added = before[name] === undefined;

  const rollback = async (): Promise<void> => {
    if (added) await runBun(options, ["remove", "--ignore-scripts", name], dirs.packagesDir).catch(() => undefined);
  };
  try {
    const dir = installedPackageDir(dirs.packagesDir, name);
    const integrity = await hashPackageClosure(dirs.packagesDir, name, scope);
    const installed = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { version?: unknown };
    if (typeof installed.version !== "string") return fail("install_failed", scope, `Package ${name} has no version.`, name);
    const definition = await importDefinition(dirs.packagesDir, { name, integrity }, scope);
    const range = options.version ?? (installed.version.includes("-") ? installed.version : `^${installed.version}`);

    const entry: ManifestEntry = {
      ...(manifest.packages.find((record) => record.name === name) ?? {}),
      name,
      version: range,
      integrity,
      capabilities: [...(definition.capabilities ?? [])],
    };
    await options.review?.(entry);
    const packages: ManifestRecord[] = manifest.packages.some((record) => record.name === name)
      ? manifest.packages.map((record) => (record.name === name ? entry : record))
      : [...manifest.packages, entry];
    const next: PrismManifestV1 = { ...manifest, packages };
    await writeManifest(dirs, next);
    return entry;
  } catch (error) {
    await rollback();
    throw error;
  }
}

/**
 * Removes a package from one scope: `bun remove`, then the entry and any `slots` assignment that pointed
 * at it. The other scope is not touched.
 */
export async function remove(name: string, options: InstallLocation): Promise<void> {
  const dirs = scopeDirs(options);
  const { scope } = dirs;
  if (typeof name !== "string" || !NAME.test(name)) return fail("install_failed", scope, "The package name is not a valid npm name.");
  const manifest = await readManifest(dirs);
  if (!manifest?.packages.some((record) => record.name === name)) {
    return fail("package_missing", scope, `Package ${name.slice(0, 64)} is not listed in the ${scope} manifest.`, name);
  }
  if ((await readManaged(dirs)).dependencies?.[name] !== undefined) {
    await bunStep(options, ["remove", "--ignore-scripts", name], dirs.packagesDir, scope, "bun remove");
  }
  const slots = Object.fromEntries(Object.entries(manifest.slots ?? {}).filter(([, owner]) => owner !== name));
  const { slots: _drop, ...rest } = manifest;
  await writeManifest(dirs, {
    ...rest,
    packages: manifest.packages.filter((record) => record.name !== name),
    ...(Object.keys(slots).length > 0 ? { slots } : {}),
  });
}
