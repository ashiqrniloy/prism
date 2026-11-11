#!/usr/bin/env bun
/**
 * `prism-host-builder`: reference indexes for building a Prism host. `info` prints what the installed indexes
 * describe, `install` copies the skill into a coding agent's project, `mcp` serves the lookup tools. Any other
 * command exits 2.
 */
import { resolve } from "node:path";
import { resolveCheckTargets } from "../src/check/targets.js";
import { HostBuilderError, loadHostBuilderIndex } from "../src/index.js";
import { describeInstall, installHostBuilder } from "../src/install/install.js";
import { INSTALL_TARGET_NAMES, isInstallTargetName } from "../src/install/targets.js";

export const USAGE = `Usage: prism-host-builder <command>

Commands:
  info        Print the Prism version and the size of each shipped index.
  install     Copy the skill into a coding agent's project directory, and optionally add the MCP server.
  mcp         Serve the lookup tools, docs resources and prompts over stdio (read-only).
  help        Print this message.

Options:
  -h, --help  Print this message.

install options:
  --target <name>  claude, codex, cursor, agents or prism (required).
  --mcp            Also add the MCP server to the target's project config (JSON), or print the snippet (Codex TOML).
  --root <dir>     The host project (default: the current directory). Nothing outside it is written.
  --force          Overwrite a locally edited skill copy or a different "prism" server entry.
  --dry-run        Print what would change and write nothing.

mcp options:
  --root <dir>              The host project (default: the current directory).
  --allow-version-mismatch  Warn instead of failing when the installed @arnilo/prism is not the version the indexes describe.
  --entry <file>#<export>   An async function returning an Agent, for prism_inspect_host. Repeatable. Runs the host's code.
  --package <file>#<export> A package factory or definition, for prism_check_package. Repeatable. Runs the package's code.
  --trust-project           Let prism_check_manifest import project-scope packages, as prism verify --trust-project does.
  --check-timeout <seconds> Per-check time limit (default 30, at most 120).
  --pass-env <NAME>         Let the check child see this variable. Repeatable. Only PATH, HOME, TMPDIR and PRISM_HOME pass by default.
`;

function usageError(message: string): number {
  console.error(`prism-host-builder: ${message}\n`);
  console.error(USAGE);
  return 2;
}

function install(args: readonly string[]): number {
  let root = process.cwd();
  let target: string | undefined;
  let mcp = false;
  let force = false;
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string;
    if (arg === "--mcp") mcp = true;
    else if (arg === "--force") force = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--target" || arg === "--root") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) return usageError(`${arg} needs a value`);
      if (arg === "--root") root = resolve(value);
      else target = value;
    } else return usageError(`unknown install option "${arg}"`);
  }
  if (target === undefined) return usageError(`install needs --target (${INSTALL_TARGET_NAMES.join(", ")})`);
  if (!isInstallTargetName(target)) return usageError(`unknown install target "${target}" (${INSTALL_TARGET_NAMES.join(", ")})`);
  try {
    for (const line of describeInstall(installHostBuilder({ target, root, mcp, force, dryRun }))) console.log(line);
    return 0;
  } catch (error) {
    if (!(error instanceof HostBuilderError)) throw error;
    console.error(`prism-host-builder: ${error.code}: ${error.message}`);
    return 1;
  }
}

async function mcp(args: readonly string[]): Promise<number> {
  let root = process.cwd();
  let allowVersionMismatch = false;
  let trustProject = false;
  let checkTimeoutSeconds: number | undefined;
  const entries: string[] = [];
  const packages: string[] = [];
  const passEnv: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string;
    if (arg === "--allow-version-mismatch") allowVersionMismatch = true;
    else if (arg === "--trust-project") trustProject = true;
    else if (arg === "--root" || arg === "--entry" || arg === "--package" || arg === "--check-timeout" || arg === "--pass-env") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) return usageError(`${arg} needs a value`);
      if (arg === "--root") root = resolve(value);
      else if (arg === "--entry") entries.push(value);
      else if (arg === "--package") packages.push(value);
      else if (arg === "--pass-env") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return usageError(`--pass-env needs a variable name, got "${value}"`);
        passEnv.push(value);
      } else {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120)
          return usageError("--check-timeout needs a number of seconds from 1 to 120");
        checkTimeoutSeconds = seconds;
      }
    } else return usageError(`unknown mcp option "${arg}"`);
  }
  // Refuse a bad check target now, not on the first tool call.
  try {
    resolveCheckTargets(root, entries, packages);
  } catch (error) {
    if (!(error instanceof HostBuilderError)) throw error;
    console.error(`prism-host-builder: ${error.code}: ${error.message}`);
    return 1;
  }
  // Loaded here so `info` and `--help` do not pay for the MCP SDK.
  const [{ servePrismMcpStdio }, { createHostBuilderMcpServer }] = await Promise.all([
    import("@arnilo/prism-hosts/mcp-server"),
    import("../src/server.js"),
  ]);
  const handle = servePrismMcpStdio(() =>
    createHostBuilderMcpServer({
      root,
      allowVersionMismatch,
      entries,
      packages,
      trustProject,
      passEnv,
      ...(checkTimeoutSeconds === undefined ? {} : { checkTimeoutSeconds }),
    }),
  );
  const stop = () => void handle.close().finally(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdin.once("end", stop);
  // The stdio transport keeps the process alive until the client closes the pipe.
  return await new Promise<number>(() => {});
}

export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (command === "info") {
    try {
      const [api, errors, examples] = await Promise.all([
        loadHostBuilderIndex("api"),
        loadHostBuilderIndex("errors"),
        loadHostBuilderIndex("examples"),
      ]);
      const names = api.packages.reduce((total, pkg) => total + pkg.entries.reduce((sum, entry) => sum + entry.exports.length, 0), 0);
      console.log(
        `prism ${api.prismVersion}: ${api.packages.length} packages, ${names} exports, ${errors.codes.length} error codes, ${examples.examples.length} examples`,
      );
      return 0;
    } catch (error) {
      if (!(error instanceof HostBuilderError)) throw error;
      console.error(`prism-host-builder: ${error.code}: ${error.message}`);
      return 1;
    }
  }
  if (command === "install") return install(argv.slice(1));
  if (command === "mcp") return await mcp(argv.slice(1));
  console.error(command === undefined ? "prism-host-builder: missing command\n" : `prism-host-builder: unknown command "${command}"\n`);
  console.error(USAGE);
  return 2;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
