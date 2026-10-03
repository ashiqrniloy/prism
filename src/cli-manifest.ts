import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { assignSlot, configure, install, list, ManifestError, type ManifestScope, remove, setEnabled, verify } from "./manifest/index.js";
import { redactSecrets } from "./redaction.js";
import { SLOT_NAMES, type SlotName } from "./slots/index.js";

/** Subcommands this module owns. `runCli` dispatches on this set and nothing else. */
export const MANIFEST_COMMANDS: ReadonlySet<string> = new Set([
  "add",
  "remove",
  "list",
  "enable",
  "disable",
  "config",
  "slot",
  "verify",
  "new",
]);

export interface ManifestCliRuntime {
  readonly stdout: Writable;
  readonly stderr: Writable;
  /** Project root and base for relative paths. Default: the current directory. */
  readonly cwd?: string;
  /** Prism home for the user scope. Default: `$PRISM_HOME`, else `~/.prism`. */
  readonly home?: string;
  /** The `bun` executable `add` and `remove` spawn. Test seam. */
  readonly bun?: string;
  /** Environment of the spawned `bun`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam: pretend the host is not Bun. */
  readonly isBun?: boolean;
}

export const manifestUsage = `       prism add <spec> [--user|--project] [--version <range>]   install a package and record it
       prism remove <name> [--user|--project]
       prism list [--json]                                        merged user + project view
       prism enable|disable <name> [--user|--project]
       prism config <name> <key>=<value>... [--user|--project]    values are JSON when they parse, else text
       prism slot <slot> <owner> | --clear [--user|--project]     slots: ${SLOT_NAMES.join(", ")}
       prism verify [--json] [--trust-project]                    re-hash every install and re-check config
       prism new package <name> [--dir <path>]                    scaffold a package
`;

class UsageError extends Error {}

interface Parsed {
  readonly positional: readonly string[];
  readonly scope: ManifestScope;
  readonly json: boolean;
  readonly clear: boolean;
  readonly trustProject: boolean;
  readonly version?: string;
  readonly dir?: string;
}

function parse(args: readonly string[], allowed: readonly string[]): Parsed {
  const positional: string[] = [];
  let scope: ManifestScope | undefined;
  let json = false;
  let clear = false;
  let trustProject = false;
  let version: string | undefined;
  let dir: string | undefined;
  const flag = (name: string): void => {
    if (!allowed.includes(name)) throw new UsageError(`Unknown option for this command: ${name}`);
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    flag(arg);
    if (arg === "--user" || arg === "--project") {
      const next = arg === "--user" ? "user" : "project";
      if (scope !== undefined && scope !== next) throw new UsageError("Pass only one of --user and --project.");
      scope = next;
    } else if (arg === "--json") json = true;
    else if (arg === "--clear") clear = true;
    else if (arg === "--trust-project") trustProject = true;
    else if (arg === "--version" || arg === "--dir") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value.`);
      if (arg === "--version") version = value;
      else dir = value;
    }
  }
  return {
    positional,
    scope: scope ?? "project",
    json,
    clear,
    trustProject,
    ...(version !== undefined ? { version } : {}),
    ...(dir !== undefined ? { dir } : {}),
  };
}

function need(parsed: Parsed, count: number, usage: string): readonly string[] {
  if (parsed.positional.length !== count) throw new UsageError(`Usage: prism ${usage}`);
  return parsed.positional;
}

/** `key=value`: the value is JSON when it parses (numbers, booleans, objects), else the raw text. */
function parseAssignment(text: string): readonly [string, unknown] {
  const at = text.indexOf("=");
  if (at <= 0) throw new UsageError("Config arguments are key=value.");
  const key = text.slice(0, at);
  const raw = text.slice(at + 1);
  try {
    return [key, JSON.parse(raw)];
  } catch {
    return [key, raw];
  }
}

function line(stream: Writable, text: string): void {
  stream.write(`${text}\n`);
}

/** Runs one manifest subcommand. Exit codes: 0 ok, 1 a `ManifestError`, 2 usage. */
export async function runManifestCommand(argv: readonly string[], runtime: ManifestCliRuntime): Promise<number> {
  const [command = "", ...rest] = argv;
  const secrets: string[] = [];
  try {
    return await dispatch(command, rest, runtime, secrets);
  } catch (error) {
    if (error instanceof UsageError) {
      line(runtime.stderr, `${error.message}\n${manifestUsage.trimEnd()}`);
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    const where = error instanceof ManifestError ? ` (${error.code})` : "";
    line(runtime.stderr, `prism ${command}: ${redactSecrets(message, secrets)}${where}`);
    return 1;
  }
}

async function dispatch(command: string, args: readonly string[], runtime: ManifestCliRuntime, secrets: string[]): Promise<number> {
  const cwd = runtime.cwd ?? process.cwd();
  const location = { root: cwd, ...(runtime.home !== undefined ? { home: runtime.home } : {}) };
  const out = runtime.stdout;
  const isBun = runtime.isBun ?? process.versions.bun !== undefined;

  if (command === "new") return newPackage(args, runtime, cwd);
  if (!isBun) throw new ManifestError("bun_required", "Manifest commands run under Bun. Launch the CLI with bun.");

  switch (command) {
    case "add": {
      const parsed = parse(args, ["--user", "--project", "--version"]);
      const [spec] = need(parsed, 1, "add <spec> [--user|--project] [--version <range>]");
      const entry = await install(spec as string, {
        ...location,
        scope: parsed.scope,
        cwd,
        ...(parsed.version !== undefined ? { version: parsed.version } : {}),
        ...(runtime.bun !== undefined ? { bun: runtime.bun } : {}),
        ...(runtime.env !== undefined ? { env: runtime.env } : {}),
        review: (reviewed) => {
          const caps = reviewed.capabilities.length > 0 ? reviewed.capabilities.join(", ") : "none";
          line(out, `${reviewed.name} ${reviewed.version} declares capabilities: ${caps}`);
        },
      });
      line(out, `Added ${entry.name} ${entry.version} to the ${parsed.scope} manifest.`);
      return 0;
    }
    case "remove": {
      const parsed = parse(args, ["--user", "--project"]);
      const [name] = need(parsed, 1, "remove <name> [--user|--project]");
      await remove(name as string, {
        ...location,
        scope: parsed.scope,
        ...(runtime.bun !== undefined ? { bun: runtime.bun } : {}),
        ...(runtime.env !== undefined ? { env: runtime.env } : {}),
      });
      line(out, `Removed ${name} from the ${parsed.scope} manifest.`);
      return 0;
    }
    case "enable":
    case "disable": {
      const parsed = parse(args, ["--user", "--project"]);
      const [name] = need(parsed, 1, `${command} <name> [--user|--project]`);
      await setEnabled(name as string, command === "enable", { ...location, scope: parsed.scope });
      line(out, `${command === "enable" ? "Enabled" : "Disabled"} ${name} in the ${parsed.scope} manifest.`);
      return 0;
    }
    case "config": {
      const parsed = parse(args, ["--user", "--project"]);
      const [name, ...pairs] = parsed.positional;
      if (name === undefined || pairs.length === 0) throw new UsageError("Usage: prism config <name> <key>=<value>... [--user|--project]");
      const patch: Record<string, unknown> = {};
      for (const pair of pairs) {
        const [key, value] = parseAssignment(pair);
        // A value the user typed never reaches stderr, even if some lower layer were to echo it.
        const typed = pair.slice(pair.indexOf("=") + 1);
        if (typed.length >= 6) secrets.push(typed);
        patch[key] = value;
      }
      await configure(name, patch as never, { ...location, scope: parsed.scope });
      line(out, `Updated ${Object.keys(patch).join(", ")} for ${name} in the ${parsed.scope} manifest.`);
      return 0;
    }
    case "slot": {
      const parsed = parse(args, ["--user", "--project", "--clear"]);
      const [slot, owner] = parsed.positional;
      if (slot === undefined || parsed.positional.length !== (parsed.clear ? 1 : 2) || (!parsed.clear && owner === undefined)) {
        throw new UsageError("Usage: prism slot <slot> <owner> | prism slot <slot> --clear [--user|--project]");
      }
      if (!(SLOT_NAMES as readonly string[]).includes(slot))
        throw new UsageError(`Unknown slot "${slot.slice(0, 32)}". Slots: ${SLOT_NAMES.join(", ")}.`);
      await assignSlot(slot as SlotName, parsed.clear ? null : (owner as string), { ...location, scope: parsed.scope });
      line(
        out,
        parsed.clear
          ? `Cleared slot ${slot} in the ${parsed.scope} manifest.`
          : `Assigned slot ${slot} to ${owner} in the ${parsed.scope} manifest.`,
      );
      return 0;
    }
    case "list": {
      const parsed = parse(args, ["--json"]);
      need(parsed, 0, "list [--json]");
      const listed = await list(location);
      if (parsed.json) {
        line(out, JSON.stringify(listed, null, 2));
        return 0;
      }
      if (listed.packages.length === 0) line(out, "No packages are installed.");
      for (const pkg of listed.packages) {
        const flags = [pkg.enabled ? "enabled" : "disabled", ...(pkg.optional ? ["optional"] : [])].join(", ");
        const caps = pkg.capabilities.length > 0 ? ` capabilities: ${pkg.capabilities.join(", ")}` : "";
        line(out, `${pkg.name} ${pkg.version} [${pkg.scope}] ${flags}${caps}`);
        if (pkg.configKeys.length > 0) line(out, `  config: ${pkg.configKeys.join(", ")}`);
      }
      for (const [slot, owner] of Object.entries(listed.slots)) line(out, `slot ${slot}: ${owner}`);
      return 0;
    }
    case "verify": {
      const parsed = parse(args, ["--json", "--trust-project"]);
      need(parsed, 0, "verify [--json] [--trust-project]");
      const results = await verify({ ...location, trustProject: () => parsed.trustProject });
      if (parsed.json) line(out, JSON.stringify(results, null, 2));
      else {
        for (const result of results) {
          if (result.ok) line(out, `ok    ${result.name} [${result.scope}]${result.configChecked ? "" : " (integrity only)"}`);
          else {
            line(out, `FAIL  ${result.name} [${result.scope}]`);
            for (const issue of result.issues) line(out, `  ${issue.code}: ${issue.message}`);
          }
        }
      }
      return results.every((result) => result.ok) ? 0 : 1;
    }
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
/** Scaffold file -> template file. The test template is flat because the tarball denies `__tests__` paths. */
const TEMPLATE_FILES: Readonly<Record<string, string>> = {
  "package.json": "package.json.tmpl",
  "src/index.ts": "src/index.ts.tmpl",
  "src/__tests__/package.test.ts": "package.test.ts.tmpl",
  "README.md": "README.md.tmpl",
};

async function newPackage(args: readonly string[], runtime: ManifestCliRuntime, cwd: string): Promise<number> {
  const parsed = parse(args.slice(args[0] === "package" ? 1 : 0), ["--dir"]);
  if (args[0] !== "package") throw new UsageError("Usage: prism new package <name> [--dir <path>]");
  const [name] = need(parsed, 1, "new package <name> [--dir <path>]");
  if (!PACKAGE_NAME.test(name as string) || (name as string).length > 214)
    throw new UsageError("The package name is not a valid npm name.");
  const target = resolve(cwd, parsed.dir ?? basename(name as string));
  try {
    if ((await readdir(target)).length > 0) throw new ManifestError("install_failed", `${target} exists and is not empty.`);
  } catch (error) {
    if (error instanceof ManifestError) throw error;
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const kernel = (JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  for (const [file, template] of Object.entries(TEMPLATE_FILES)) {
    const text = await readFile(join(root, "templates", "package", template), "utf8");
    const body = text.replaceAll("{{name}}", name as string).replaceAll("{{kernelVersion}}", kernel);
    await mkdir(dirname(join(target, file)), { recursive: true });
    await writeFile(join(target, file), body, { flag: "wx" });
  }
  line(runtime.stdout, `Created ${name} in ${target}. Run bun test there, then prism add file:${target}.`);
  return 0;
}
