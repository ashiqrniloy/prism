/**
 * Plan 040 Task 4 — `prism dev` delegation into `@arnilo/prism-dev`.
 * The core deliberately holds no compile-time dependency on the dev package
 * (dev-only surface, omitted from umbrellas): the subcommand resolves the
 * package from the current project's own `node_modules` and hands the CLI
 * over. Unresolvable → actionable install hint, exit 2.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";
import type { Writable } from "node:stream";
import { pathToFileURL } from "node:url";

export interface DevCliModule {
  runDevCli(argv: readonly string[], runtime: { stdout: Writable; stderr: Writable; cwd?: string }): Promise<number>;
}

export type PrismDevLoader = () => Promise<DevCliModule | undefined>;

export interface PrismDevSubcommandRuntime {
  readonly stdout: Writable;
  readonly stderr: Writable;
  /** Test injection: overrides project-level `@arnilo/prism-dev` resolution. */
  readonly loadDevCli?: PrismDevLoader;
}

const installHint =
  "prism dev requires the dev inspector package in this project.\n" +
  "  npm install --save-dev @arnilo/prism-coding-tools\n" +
  "(Scaffolded projects from newer `prism init` templates already include it.)\n";

/**
 * Default loader: resolve `@arnilo/prism-coding-tools/dev/cli` (or `@arnilo/prism-dev/cli`)
 * from the project the user is standing in, falling back to this CLI's own installation.
 */
export const defaultLoadDevCli: PrismDevLoader = async () => {
  const specifiers = ["@arnilo/prism-coding-tools/dev/cli", "@arnilo/prism-dev/cli"];
  for (const specifier of specifiers) {
    try {
      const require = createRequire(join(process.cwd(), "package.json"));
      const resolved = require.resolve(specifier);
      const mod = (await import(pathToFileURL(resolved).href)) as Partial<DevCliModule>;
      if (typeof mod.runDevCli === "function") return mod as DevCliModule;
    } catch {
      try {
        const mod = (await import(specifier)) as Partial<DevCliModule>;
        if (typeof mod.runDevCli === "function") return mod as DevCliModule;
      } catch {
        // try next specifier
      }
    }
  }
  return undefined;
};

/** Runs the `prism dev` subcommand by delegating into the resolved package. */
export async function runPrismDevSubcommand(argv: readonly string[], runtime: PrismDevSubcommandRuntime): Promise<number> {
  const load = runtime.loadDevCli ?? defaultLoadDevCli;
  const mod = await load();
  if (!mod || typeof mod.runDevCli !== "function") {
    runtime.stderr.write(installHint);
    return 2;
  }
  return mod.runDevCli(argv, { stdout: runtime.stdout, stderr: runtime.stderr });
}
