import { accessSync, constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

export class ProviderAddUsageError extends Error {}

export interface ProviderAddOptions {
  /** npm-validated provider/package name; also the target directory name. */
  readonly name: string;
  readonly baseUrl: string;
  /** Shell-safe identifier, e.g. `ACME_API_KEY`. Never a secret value. */
  readonly envKey: string;
  readonly model: string;
  readonly force: boolean;
  readonly help: boolean;
}

export interface ProviderAddRuntime {
  readonly stdout: Writable;
  readonly stderr: Writable;
  /** Override template root (tests). Defaults to package `templates/provider`. */
  readonly templatesRoot?: string;
  /** Override package version stamped into the generated package.json. */
  readonly packageVersion?: string;
  /** Working directory used to resolve relative destinations. Defaults to process.cwd(). */
  readonly cwd?: string;
}

export interface ProviderAddResult {
  readonly targetDir: string;
  readonly writtenFiles: readonly string[];
  readonly name: string;
  readonly totalBytes: number;
}

const NPM_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_NAME_LENGTH = 214;
const DEFAULT_BASE_URL = "https://api.example.com/v1";

export function getProviderAddUsage(): string {
  return `Usage: prism providers add <name> [options]

Scaffold an OpenAI-compatible provider package (manifest, provider, models, cache
helpers, conformance test, docs stub) into ./<name>.

Arguments:
  <name>                       npm-validated package/provider name (lowercase)

Options:
  --base-url <url>             Default Chat Completions base URL (default: ${DEFAULT_BASE_URL})
  --env-key <name>             Credential environment-var identifier (default: <NAME>_API_KEY)
  --model <id>                 Starter model id (default: <name>-large)
  --force                      Overwrite existing generated files
  -h, --help                   Show this help

Examples:
  prism providers add acme --base-url https://api.acme.example/v1 --env-key ACME_API_KEY --model acme-large
`;
}

export const providerAddUsage = getProviderAddUsage();

export function parseProviderAddArgs(argv: readonly string[]): ProviderAddOptions {
  let name: string | undefined;
  let baseUrl = DEFAULT_BASE_URL;
  let envKey: string | undefined;
  let model: string | undefined;
  let force = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--base-url" || arg === "--env-key" || arg === "--model") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new ProviderAddUsageError(`Missing value for ${arg}`);
      }
      i += 1;
      if (arg === "--base-url") {
        baseUrl = value;
      } else if (arg === "--env-key") {
        envKey = value;
      } else {
        model = value;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ProviderAddUsageError(`Unknown flag: ${arg}`);
    }
    if (name !== undefined) {
      throw new ProviderAddUsageError(`Unexpected argument: ${arg}`);
    }
    name = arg;
  }

  if (!help && name === undefined) {
    throw new ProviderAddUsageError("Missing provider name");
  }

  return {
    name: name ?? "provider",
    baseUrl,
    envKey: envKey ?? `${(name ?? "provider").replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_API_KEY`,
    model: model ?? `${name ?? "provider"}-large`,
    force,
    help,
  };
}

export async function runProviderAddCommand(argv: readonly string[], runtime: ProviderAddRuntime): Promise<number> {
  let options: ProviderAddOptions;
  try {
    options = parseProviderAddArgs(argv);
  } catch (error) {
    write(runtime.stderr, `${error instanceof Error ? error.message : String(error)}\n${getProviderAddUsage()}`);
    return 2;
  }

  if (options.help) {
    write(runtime.stdout, getProviderAddUsage());
    return 0;
  }

  try {
    validateProviderName(options.name);
    validateBaseUrl(options.baseUrl);
    if (!ENV_KEY_PATTERN.test(options.envKey)) {
      throw new ProviderAddUsageError(`Invalid --env-key: ${options.envKey} (must be a shell-safe identifier)`);
    }
    const result = await createProviderProject(options, runtime);
    write(
      runtime.stdout,
      [
        `Scaffolded provider package in ${result.targetDir}`,
        `  name: ${result.name}`,
        `  files: ${result.writtenFiles.length}`,
        `  bytes: ${result.totalBytes}`,
        "",
        "Next:",
        `  cd ${result.name}`,
        "  npm install",
        "  npm test",
        "  Replace the starter model metadata and docs stub with docs-verified values before publishing.",
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ProviderAddUsageError) {
      write(runtime.stderr, `${message}\n${getProviderAddUsage()}`);
      return 2;
    }
    write(runtime.stderr, `${message}\n`);
    return 1;
  }
}

export async function createProviderProject(
  options: ProviderAddOptions,
  runtime: ProviderAddRuntime = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<ProviderAddResult> {
  validateProviderName(options.name);
  const cwd = runtime.cwd ?? process.cwd();
  const targetDir = resolve(cwd, options.name);
  const templatesRoot = runtime.templatesRoot ?? defaultProviderTemplatesRoot();
  const version = runtime.packageVersion ?? (await readPackageVersion());

  await assertDestinationWritable(targetDir, options.force);

  const tokens = buildTokens({ ...options, version });
  const planned = planProviderFiles(templatesRoot, options.name);

  if (!options.force) {
    for (const file of planned) {
      const dest = join(targetDir, file.relativePath);
      if (await exists(dest)) {
        throw new ProviderAddUsageError(`Refusing to overwrite existing file: ${file.relativePath} (pass --force to overwrite)`);
      }
    }
  }

  const writtenFiles: string[] = [];
  let totalBytes = 0;

  for (const file of planned) {
    const dest = join(targetDir, file.relativePath);
    assertPathInside(targetDir, dest);
    const raw = await readFile(file.sourcePath, "utf8");
    const content = applyTokens(raw, tokens);
    await mkdir(dirname(dest), { recursive: true });
    await assertNoSymlinkEscape(targetDir, dirname(dest));
    await writeFile(dest, content, "utf8");
    writtenFiles.push(file.relativePath);
    totalBytes += Buffer.byteLength(content, "utf8");
  }

  return {
    targetDir,
    writtenFiles,
    name: options.name,
    totalBytes,
  };
}

export function defaultProviderTemplatesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "provider");
}

/** npm package-name rules plus traversal refusal. Throws `ProviderAddUsageError` on violation. */
export function validateProviderName(name: string): void {
  if (name.length === 0) throw new ProviderAddUsageError("Missing provider name");
  if (name.includes("\0")) throw new ProviderAddUsageError("Invalid provider name");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ProviderAddUsageError(`Invalid provider name: ${name} (max ${MAX_NAME_LENGTH} chars)`);
  }
  if (!NPM_NAME_PATTERN.test(name) || name.includes("..")) {
    throw new ProviderAddUsageError(
      `Invalid provider name: ${name} (npm names are lowercase, start with a letter/digit, and contain only letters, digits, -, _, .)`,
    );
  }
}

function validateBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ProviderAddUsageError(`Invalid --base-url: ${baseUrl} (must be an http(s) URL)`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderAddUsageError(`Invalid --base-url: ${baseUrl} (must be an http(s) URL)`);
  }
}

function buildTokens(input: {
  readonly name: string;
  readonly baseUrl: string;
  readonly envKey: string;
  readonly model: string;
  readonly version: string;
}): Record<string, string> {
  const pascal = input.name
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return {
    __PROVIDER_ID__: input.name,
    __PROVIDER_UPPER__: input.name.replace(/[^a-z0-9]+/gi, "_").toUpperCase(),
    __PROVIDER_PASCAL__: pascal,
    __PACKAGE_NAME__: input.name,
    __PRISM_VERSION__: input.version,
    __BASE_URL__: input.baseUrl.replace(/\/+$/, ""),
    __ENV_KEY__: input.envKey,
    __MODEL_ID__: input.model,
  };
}

function planProviderFiles(templatesRoot: string, name: string): readonly { relativePath: string; sourcePath: string }[] {
  const files: { relativePath: string; sourcePath: string }[] = [
    { relativePath: "package.json", sourcePath: join(templatesRoot, "package.json.tmpl") },
    { relativePath: "tsconfig.json", sourcePath: join(templatesRoot, "tsconfig.json.tmpl") },
    { relativePath: "README.md", sourcePath: join(templatesRoot, "README.md.tmpl") },
    { relativePath: "CHANGELOG.md", sourcePath: join(templatesRoot, "CHANGELOG.md.tmpl") },
    { relativePath: "src/index.ts", sourcePath: join(templatesRoot, "src/index.ts.tmpl") },
    { relativePath: "src/provider.ts", sourcePath: join(templatesRoot, "src/provider.ts.tmpl") },
    { relativePath: "src/models.ts", sourcePath: join(templatesRoot, "src/models.ts.tmpl") },
    { relativePath: "src/cache.ts", sourcePath: join(templatesRoot, "src/cache.ts.tmpl") },
    { relativePath: "src/__tests__/provider.test.ts", sourcePath: join(templatesRoot, "src/tests/provider.test.ts.tmpl") },
    { relativePath: `docs/providers/${name}.md`, sourcePath: join(templatesRoot, "docs/providers/NAME.md.tmpl") },
  ];
  for (const file of files) {
    try {
      accessSync(file.sourcePath, fsConstants.R_OK);
    } catch {
      throw new Error(`Missing provider template: ${file.sourcePath}`);
    }
  }
  return files;
}

function applyTokens(template: string, tokens: Record<string, string>): string {
  let out = template;
  for (const [token, value] of Object.entries(tokens)) {
    out = out.split(token).join(value);
  }
  if (/__[A-Z0-9_]+__/.test(out)) {
    const leftover = out.match(/__[A-Z0-9_]+__/g) ?? [];
    throw new Error(`Unresolved provider template tokens: ${Array.from(new Set(leftover)).join(", ")}`);
  }
  return out;
}

async function readPackageVersion(): Promise<string> {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
  if (!pkg.version) throw new Error(`Missing version in ${pkgPath}`);
  return pkg.version;
}

async function assertDestinationWritable(targetDir: string, force: boolean): Promise<void> {
  if (!(await exists(targetDir))) {
    await mkdir(targetDir, { recursive: true });
    return;
  }
  const entries = await readdir(targetDir);
  if (entries.length > 0 && !force) {
    throw new ProviderAddUsageError(`Destination is not empty: ${targetDir} (pass --force to overwrite generated files)`);
  }
}

function assertPathInside(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new ProviderAddUsageError(`Refusing to write outside destination: ${candidate}`);
}

/** Refuse writes whose real parent directory escapes the real target (symlinked dirs). */
async function assertNoSymlinkEscape(targetDir: string, parentDir: string): Promise<void> {
  const realTarget = await realpath(targetDir);
  const realParent = await realpath(parentDir);
  if (realParent !== realTarget && !realParent.startsWith(realTarget + sep)) {
    throw new ProviderAddUsageError(`Refusing to write through a symlinked directory: ${parentDir}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function write(stream: Writable, text: string): void {
  stream.write(text);
}
