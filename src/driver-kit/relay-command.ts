import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DriverError } from "./errors.js";

/**
 * The command that runs the kernel's own `prism` CLI: `[process.execPath, <cli path>]`. A driver appends
 * `relay hook --run <dir>` or `relay mcp --run <dir>`. The path comes from this module's URL, never from `PATH` or `cwd`.
 * In the source layout there is no `cli.js`, so it falls back to `cli.ts`, which only Bun can run.
 */
export function relayCommand(): readonly string[] {
  const built = fileURLToPath(new URL("../cli.js", import.meta.url));
  if (existsSync(built)) return [process.execPath, built];
  const source = fileURLToPath(new URL("../cli.ts", import.meta.url));
  if (!existsSync(source)) throw new DriverError("driver_unavailable", "the kernel's cli entry was not found next to the driver kit");
  if (!/(^|[\\/])bun(\.exe)?$/i.test(process.execPath)) {
    throw new DriverError(
      "driver_unavailable",
      "the kernel runs from source here, and only Bun can run its cli.ts; build the kernel or run under Bun",
    );
  }
  return [process.execPath, source];
}
