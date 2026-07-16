import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";

export class InitUsageError extends Error {}

export type InitProvider = string;

export interface InitOptions {
  readonly directory: string;
  readonly provider: InitProvider;
  readonly withWorkflows: boolean;
  readonly withEvals: boolean;
  readonly force: boolean;
  readonly help: boolean;
}

export interface InitRuntime {
  readonly stdout: Writable;
  readonly stderr: Writable;
  /** Override template root (tests). Defaults to package `templates/init`. */
  readonly templatesRoot?: string;
  /** Override package version stamped into generated package.json. */
  readonly packageVersion?: string;
  /** Working directory used to resolve relative destinations. Defaults to process.cwd(). */
  readonly cwd?: string;
}

export interface InitResult {
  readonly targetDir: string;
  readonly writtenFiles: readonly string[];
  readonly provider: InitProvider;
  readonly withWorkflows: boolean;
  readonly withEvals: boolean;
  readonly totalBytes: number;
}

interface ProviderSpec {
  readonly id: string;
  readonly packageName?: string;
  readonly envKey?: string;
  readonly envPlaceholder?: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly imports: string;
  readonly providerExpression: string;
  readonly modelExpression: string;
}

let cachedCatalog: ReadonlyMap<string, ProviderSpec> | undefined;
let cachedProviderIds: readonly string[] | undefined;

function providersCatalogPath(templatesRoot: string): string {
  return join(templatesRoot, "providers.json");
}

function loadProvidersCatalog(templatesRoot = defaultTemplatesRoot()): ReadonlyMap<string, ProviderSpec> {
  if (cachedCatalog && templatesRoot === defaultTemplatesRoot()) return cachedCatalog;
  const raw = JSON.parse(readFileSync(providersCatalogPath(templatesRoot), "utf8")) as Record<string, ProviderSpec>;
  const map = new Map<string, ProviderSpec>();
  for (const [id, spec] of Object.entries(raw)) {
    if (!id || typeof spec !== "object" || spec === null) {
      throw new Error(`Invalid init provider catalog entry: ${id}`);
    }
    map.set(id, { ...spec, id });
  }
  if (map.size === 0) throw new Error("Init provider catalog is empty");
  if (templatesRoot === defaultTemplatesRoot()) {
    cachedCatalog = map;
    cachedProviderIds = Object.freeze([...map.keys()]);
  }
  return map;
}

/** Provider ids supported by `prism init --provider`. Loaded from templates data. */
export function listInitProviders(templatesRoot?: string): readonly string[] {
  if (!templatesRoot && cachedProviderIds) return cachedProviderIds;
  return Object.freeze([...loadProvidersCatalog(templatesRoot).keys()]);
}

/** @deprecated Prefer listInitProviders(); retained for tests that import the name. */
export const INIT_PROVIDERS: readonly string[] = listInitProviders();

export function getInitUsage(templatesRoot?: string): string {
  const providers = listInitProviders(templatesRoot).join("|");
  return `Usage: prism init <dir> [options]

Create a minimal TypeScript Prism project with one explicit provider and an offline mock test.

Arguments:
  <dir>                      Destination directory (created if missing)

Options:
  --provider <name>          Provider id (${providers}). Default: mock
  --with-workflows           Add optional workflows dependency and example
  --with-evals               Add optional evals dependency and example
  --force                    Overwrite existing generated files
  -h, --help                 Show this help

Examples:
  prism init my-agent
  prism init my-agent --provider openai
  prism init my-agent --provider openai --with-workflows
`;
}

export const initUsage = getInitUsage();

export function parseInitArgs(argv: readonly string[], templatesRoot?: string): InitOptions {
  let directory: string | undefined;
  let provider: InitProvider = "mock";
  let withWorkflows = false;
  let withEvals = false;
  let force = false;
  let help = false;
  const providers = listInitProviders(templatesRoot);

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
    if (arg === "--with-workflows") {
      withWorkflows = true;
      continue;
    }
    if (arg === "--with-evals") {
      withEvals = true;
      continue;
    }
    if (arg === "--provider") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new InitUsageError("Missing value for --provider");
      }
      i += 1;
      if (!providers.includes(value)) {
        throw new InitUsageError(
          `Unknown provider: ${value}. Expected one of ${providers.join(", ")}`,
        );
      }
      provider = value;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new InitUsageError(`Unknown flag: ${arg}`);
    }
    if (directory !== undefined) {
      throw new InitUsageError(`Unexpected argument: ${arg}`);
    }
    directory = arg;
  }

  if (!help && directory === undefined) {
    throw new InitUsageError("Missing destination directory");
  }

  return {
    directory: directory ?? ".",
    provider,
    withWorkflows,
    withEvals,
    force,
    help,
  };
}

export async function runInitCommand(argv: readonly string[], runtime: InitRuntime): Promise<number> {
  let options: InitOptions;
  try {
    options = parseInitArgs(argv, runtime.templatesRoot);
  } catch (error) {
    write(runtime.stderr, `${error instanceof Error ? error.message : String(error)}\n${getInitUsage(runtime.templatesRoot)}`);
    return 2;
  }

  if (options.help) {
    write(runtime.stdout, getInitUsage(runtime.templatesRoot));
    return 0;
  }

  try {
    const result = await createInitProject(options, runtime);
    write(
      runtime.stdout,
      [
        `Created Prism project in ${result.targetDir}`,
        `  provider: ${result.provider}`,
        `  files: ${result.writtenFiles.length}`,
        `  bytes: ${result.totalBytes}`,
        ...(result.withWorkflows ? ["  optional: workflows"] : []),
        ...(result.withEvals ? ["  optional: evals"] : []),
        "",
        "Next:",
        `  cd ${shellQuote(displayPath(result.targetDir, runtime.cwd ?? process.cwd()))}`,
        "  npm install",
        "  npm test",
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof InitUsageError) {
      write(runtime.stderr, `${message}\n${getInitUsage(runtime.templatesRoot)}`);
      return 2;
    }
    write(runtime.stderr, `${message}\n`);
    return 1;
  }
}

export async function createInitProject(options: InitOptions, runtime: InitRuntime = {
  stdout: process.stdout,
  stderr: process.stderr,
}): Promise<InitResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const targetDir = resolveInitDirectory(options.directory, cwd);
  const templatesRoot = runtime.templatesRoot ?? defaultTemplatesRoot();
  const version = runtime.packageVersion ?? (await readPackageVersion());
  const catalog = loadProvidersCatalog(templatesRoot);
  const provider = catalog.get(options.provider);
  if (!provider) {
    throw new InitUsageError(`Unknown provider: ${options.provider}. Expected one of ${[...catalog.keys()].join(", ")}`);
  }
  const projectName = sanitizePackageName(basenameSafe(targetDir));

  await assertDestinationWritable(targetDir, options.force);

  const tokens = buildTokens({
    projectName,
    version,
    provider,
    withWorkflows: options.withWorkflows,
    withEvals: options.withEvals,
  });

  const planned = await planFiles({
    templatesRoot,
    withWorkflows: options.withWorkflows,
    withEvals: options.withEvals,
  });

  if (!options.force) {
    for (const file of planned) {
      const dest = join(targetDir, file.relativePath);
      if (await exists(dest)) {
        throw new InitUsageError(
          `Refusing to overwrite existing file: ${file.relativePath} (pass --force to overwrite)`,
        );
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
    await writeFile(dest, content, "utf8");
    writtenFiles.push(file.relativePath);
    totalBytes += Buffer.byteLength(content, "utf8");
  }

  return {
    targetDir,
    writtenFiles,
    provider: options.provider,
    withWorkflows: options.withWorkflows,
    withEvals: options.withEvals,
    totalBytes,
  };
}

export function defaultTemplatesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "init");
}

export function isInitProvider(value: string, templatesRoot?: string): value is InitProvider {
  return listInitProviders(templatesRoot).includes(value);
}

function resolveInitDirectory(input: string, cwd: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new InitUsageError("Missing destination directory");
  if (trimmed.includes("\0")) throw new InitUsageError("Invalid destination directory");

  // Reject Windows drive-relative oddities and keep the path normal.
  const normalizedInput = normalize(trimmed);
  if (normalizedInput.split(sep).includes("..") && !isAbsolute(normalizedInput)) {
    // Allow intentional relative parents, but still resolve and validate after join.
  }

  const resolved = resolve(cwd, normalizedInput);
  if (resolved === sep || /^[A-Za-z]:[\\/]?$/.test(resolved)) {
    throw new InitUsageError(`Refusing to scaffold into filesystem root: ${resolved}`);
  }
  return resolved;
}

async function assertDestinationWritable(targetDir: string, force: boolean): Promise<void> {
  if (!(await exists(targetDir))) {
    await mkdir(targetDir, { recursive: true });
    return;
  }

  const entries = await readdir(targetDir);
  if (entries.length > 0 && !force) {
    throw new InitUsageError(
      `Destination is not empty: ${targetDir} (pass --force to overwrite generated files)`,
    );
  }
}

async function planFiles(options: {
  readonly templatesRoot: string;
  readonly withWorkflows: boolean;
  readonly withEvals: boolean;
}): Promise<readonly { relativePath: string; sourcePath: string }[]> {
  const root = options.templatesRoot;
  const files: { relativePath: string; sourcePath: string }[] = [
    { relativePath: "package.json", sourcePath: join(root, "package.json.tmpl") },
    { relativePath: "tsconfig.json", sourcePath: join(root, "tsconfig.json.tmpl") },
    { relativePath: ".gitignore", sourcePath: join(root, "gitignore.tmpl") },
    { relativePath: ".env.example", sourcePath: join(root, "env.example.tmpl") },
    { relativePath: "README.md", sourcePath: join(root, "README.md.tmpl") },
    { relativePath: "src/agent.ts", sourcePath: join(root, "src/agent.ts.tmpl") },
    { relativePath: "src/index.ts", sourcePath: join(root, "src/index.ts.tmpl") },
    { relativePath: "src/__tests__/agent.test.ts", sourcePath: join(root, "src/tests/agent.test.ts.tmpl") },
  ];

  if (options.withWorkflows) {
    files.push({
      relativePath: "src/workflows-example.ts",
      sourcePath: join(root, "optional/workflows-example.ts.tmpl"),
    });
  }
  if (options.withEvals) {
    files.push({
      relativePath: "src/evals-example.ts",
      sourcePath: join(root, "optional/evals-example.ts.tmpl"),
    });
  }

  for (const file of files) {
    try {
      await access(file.sourcePath, fsConstants.R_OK);
    } catch {
      throw new Error(`Missing init template: ${file.sourcePath}`);
    }
  }
  return files;
}

function buildTokens(input: {
  readonly projectName: string;
  readonly version: string;
  readonly provider: ProviderSpec;
  readonly withWorkflows: boolean;
  readonly withEvals: boolean;
}): Record<string, string> {
  const dependencies: Record<string, string> = {
    "@arnilo/prism": input.version,
  };
  if (input.provider.packageName) {
    dependencies[input.provider.packageName] = input.version;
  }
  if (input.withWorkflows) {
    dependencies["@arnilo/prism-workflows"] = input.version;
  }
  if (input.withEvals) {
    dependencies["@arnilo/prism-evals"] = input.version;
  }

  const dependencyLines = Object.entries(dependencies)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, ver]) => `    ${JSON.stringify(name)}: ${JSON.stringify(ver)}`)
    .join(",\n");

  const envBlock = input.provider.envKey
    ? `# Placeholder only — never commit real secrets.\n${input.provider.envKey}=${input.provider.envPlaceholder ?? ""}\n`
    : `# No API key required for the mock provider.\n# Switch providers with: prism init <dir> --provider openai --force\n`;

  const nextStepsLive = input.provider.envKey
    ? `2. Copy \`.env.example\` to \`.env\` and set \`${input.provider.envKey}\`.\n3. Run \`npm start\` for a live provider call.`
    : `2. Run \`npm start\` (mock provider; no network or credentials).`;

  const optionalDocs = [
    ...(input.withWorkflows
      ? ["- `src/workflows-example.ts` — tiny DAG example using `@arnilo/prism-workflows`."]
      : []),
    ...(input.withEvals
      ? ["- `src/evals-example.ts` — deterministic scorer example using `@arnilo/prism-evals`."]
      : []),
  ].join("\n");

  return {
    __PROJECT_NAME__: input.projectName,
    __PRISM_VERSION__: input.version,
    __PROVIDER_ID__: input.provider.id,
    __PROVIDER_PACKAGE__: input.provider.packageName ?? "",
    __DEPENDENCIES__: dependencyLines,
    __PROVIDER_IMPORTS__: input.provider.imports,
    __PROVIDER_EXPRESSION__: input.provider.providerExpression,
    __MODEL_EXPRESSION__: input.provider.modelExpression,
    __ENV_EXAMPLE__: envBlock,
    __NEXT_STEPS_LIVE__: nextStepsLive,
    __OPTIONAL_DOCS__: optionalDocs.length > 0 ? `${optionalDocs}\n` : "",
    __PROVIDER_README_NOTE__: input.provider.packageName
      ? `Selected provider package: \`${input.provider.packageName}\` (model \`${input.provider.modelName}\`).`
      : "Selected provider: built-in `mock` (offline demos and tests).",
  };
}

function applyTokens(template: string, tokens: Record<string, string>): string {
  let out = template;
  for (const [token, value] of Object.entries(tokens)) {
    out = out.split(token).join(value);
  }
  if (/__[A-Z0-9_]+__/.test(out)) {
    const leftover = out.match(/__[A-Z0-9_]+__/g) ?? [];
    throw new Error(`Unresolved init template tokens: ${Array.from(new Set(leftover)).join(", ")}`);
  }
  return out;
}

async function readPackageVersion(): Promise<string> {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
  if (!pkg.version) throw new Error(`Missing version in ${pkgPath}`);
  return pkg.version;
}

function assertPathInside(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
    throw new InitUsageError(`Refusing to write outside destination: ${candidate}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sanitizePackageName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "prism-agent";
}

function basenameSafe(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "prism-agent";
}

function displayPath(targetDir: string, cwd: string): string {
  const rel = relative(cwd, targetDir);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel || ".";
  return targetDir;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function write(stream: Writable, text: string): void {
  stream.write(text);
}
